import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_RESPONSE,
  STREAMING_BRIDGE_SHORTCUT,
  STREAMING_BRIDGE_SHORTCUT_KEYS,
  createStreamingBridgeSourceIdentity,
  normalizeStreamingBridgePlayerSnapshot,
  parseStreamingBridgeRequest,
  parseStreamingBridgeShortcutMessage,
  sameStreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";
import type {
  StreamingBridgePlayerSnapshot,
  StreamingBridgeRequest,
  StreamingBridgeResponse,
  StreamingBridgeShortcutKey,
  StreamingBridgeShortcutMessage,
  StreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";
import {
  keyboardShortcutLetterFromEvent
} from "../lib/keyboard-shortcuts.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
  normalizeSoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";

export interface StreamingBridgeContentAdapter {
  readonly readSource: () => unknown | Promise<unknown>;
  readonly snapshot: () => (
    StreamingBridgePlayerSnapshot | Promise<StreamingBridgePlayerSnapshot>
  );
  readonly seekAbsolute: (
    targetSeconds: number
  ) => void | Promise<void>;
  readonly setPlaybackRate: (
    playbackRate: 0.25 | 2
  ) => void | Promise<void>;
}

export interface StreamingBridgeContentEndpointOptions {
  readonly allowedParentOrigins: readonly string[];
  readonly adapter: StreamingBridgeContentAdapter;
  readonly hostWindow?: Window;
  readonly createEventId?: () => string;
}

type ResponseErrorCode =
  | "stale-generation"
  | "source-mismatch"
  | "source-unavailable"
  | "player-unavailable"
  | "player-state-transient"
  | "action-failed";

function exactAllowedWebAppOrigin(value: unknown): string {
  const text = String(value || "").trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError("허용할 Kirinuki 웹 origin이 올바르지 않습니다.");
  }
  const loopbackHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (
    text !== url.origin
    || (!loopbackHttp && url.protocol !== "https:")
    || url.username
    || url.password
  ) {
    throw new TypeError(
      "Kirinuki 브리지는 exact loopback HTTP 또는 HTTPS origin만 허용합니다."
    );
  }
  return url.origin;
}

function streamingShortcutKeyFromEvent(
  event: KeyboardEvent
): StreamingBridgeShortcutKey | null {
  const target = event.target as { tagName?: unknown } | null;
  const targetIsVideo = String(target?.tagName || "").toUpperCase() === "VIDEO";
  const key = keyboardShortcutLetterFromEvent(targetIsVideo
    ? {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      repeat: event.repeat,
      isComposing: event.isComposing,
      // The endpoint listens during capture, before a platform player can
      // consume the same video-focused key. Keep Kirinuki's shortcut meaning
      // deterministic while retaining every other IME/modifier/repeat guard.
      defaultPrevented: false,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      target: null
    }
    : event);
  return key && STREAMING_BRIDGE_SHORTCUT_KEYS.includes(
    key as StreamingBridgeShortcutKey
  )
    ? key as StreamingBridgeShortcutKey
    : null;
}

function successResponse(
  request: StreamingBridgeRequest,
  player: StreamingBridgePlayerSnapshot
): StreamingBridgeResponse {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: request.requestId,
    generation: request.generation,
    action: request.action,
    source: request.source,
    ok: true,
    player
  };
}

function failureResponse(
  request: StreamingBridgeRequest,
  code: ResponseErrorCode,
  message: string
): StreamingBridgeResponse {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: request.requestId,
    generation: request.generation,
    action: request.action,
    source: request.source,
    ok: false,
    error: { code, message }
  };
}

async function runAction(
  adapter: StreamingBridgeContentAdapter,
  request: StreamingBridgeRequest
): Promise<StreamingBridgePlayerSnapshot> {
  if (request.action === "seek-absolute") {
    await adapter.seekAbsolute(request.targetSeconds);
  } else if (request.action === "set-playback-rate") {
    await adapter.setPlaybackRate(request.playbackRate);
  }
  const player = normalizeStreamingBridgePlayerSnapshot(await adapter.snapshot());
  if (!player) {
    throw new TypeError("스트리밍 플레이어 snapshot 형식이 올바르지 않습니다.");
  }
  const requestedSoopContentId = request.source.platform === "SOOP"
    ? /^soop:vod:(\d{1,32})$/u.exec(request.source.sessionId)?.[1] || ""
    : "";
  if (
    (request.source.platform === "SOOP"
      && (
        !player.sourceClockIdentity
        || player.sourceClockIdentity.contentId !== requestedSoopContentId
      ))
    || (request.source.platform !== "SOOP" && player.sourceClockIdentity)
  ) {
    throw new TypeError("스트리밍 플레이어의 원본 시계 증명이 맞지 않습니다.");
  }
  return player;
}

class StreamingBridgeContentError extends Error {
  readonly code: ResponseErrorCode;

  constructor(code: ResponseErrorCode, message: string) {
    super(message);
    this.name = "StreamingBridgeContentError";
    this.code = code;
  }
}

/**
 * Installs the endpoint inside a matching platform iframe content script.
 * Requests are accepted only from the direct parent WindowProxy at an exact
 * allowlisted web-app origin. Per-origin generations and request IDs are
 * checked before a serialized player action is executed.
 */
export function installStreamingBridgeContentEndpoint({
  allowedParentOrigins,
  adapter,
  hostWindow = window,
  createEventId = () => `shortcut-${crypto.randomUUID()}`
}: StreamingBridgeContentEndpointOptions): () => void {
  const origins = new Set(allowedParentOrigins.map(exactAllowedWebAppOrigin));
  if (origins.size === 0) {
    throw new TypeError("스트리밍 브리지에 허용된 parent origin이 없습니다.");
  }
  const parentWindow = hostWindow.parent;
  if (parentWindow === hostWindow) {
    return () => undefined;
  }
  const latestGeneration = new Map<string, number>();
  const requestResults = new Map<
    string,
    Map<string, StreamingBridgeResponse | null>
  >();
  let queueTail: Promise<void> = Promise.resolve();
  let disposed = false;
  let activeOrigin = "";
  let activeSource: StreamingBridgeShortcutMessage["source"] | null = null;

  const respond = (
    response: StreamingBridgeResponse,
    targetOrigin: string
  ): void => {
    if (!disposed) {
      parentWindow.postMessage(response, targetOrigin);
    }
  };

  const execute = async (
    request: StreamingBridgeRequest,
    origin: string
  ): Promise<void> => {
    const highest = latestGeneration.get(origin) || 0;
    if (request.generation < highest) {
      respond(failureResponse(
        request,
        "stale-generation",
        "오래된 스트리밍 제어 요청은 실행하지 않았습니다."
      ), origin);
      return;
    }
    try {
      let actualSource: StreamingBridgeSourceIdentity;
      try {
        actualSource = createStreamingBridgeSourceIdentity(
          await adapter.readSource()
        );
      } catch {
        throw new StreamingBridgeContentError(
          "source-unavailable",
          "플랫폼 문서에서 원본 VOD 회차를 일시적으로 확인하지 못했습니다."
        );
      }
      if (!sameStreamingBridgeSourceIdentity(actualSource, request.source)) {
        throw new StreamingBridgeContentError(
          "source-mismatch",
          "임베드 플레이어가 요청한 원본과 다른 회차로 이동했습니다."
        );
      }
      activeOrigin = origin;
      activeSource = request.source;
      if (request.generation < (latestGeneration.get(origin) || 0)) {
        throw new StreamingBridgeContentError(
          "stale-generation",
          "원본 확인 중 무효화된 스트리밍 제어 요청은 실행하지 않았습니다."
        );
      }
      let player: StreamingBridgePlayerSnapshot;
      try {
        player = await runAction(adapter, request);
      } catch (error) {
        if (error instanceof StreamingBridgeContentError) {
          throw error;
        }
        throw new StreamingBridgeContentError(
          "player-state-transient",
          "플랫폼 플레이어 상태가 전환되는 중입니다."
        );
      }
      let sourceAfterAction: StreamingBridgeSourceIdentity;
      try {
        sourceAfterAction = createStreamingBridgeSourceIdentity(
          await adapter.readSource()
        );
      } catch {
        throw new StreamingBridgeContentError(
          "source-unavailable",
          "플랫폼 동작 뒤 원본 VOD 회차를 일시적으로 확인하지 못했습니다."
        );
      }
      if (!sameStreamingBridgeSourceIdentity(sourceAfterAction, request.source)) {
        throw new StreamingBridgeContentError(
          "source-mismatch",
          "플레이어 동작 중 원본이 다른 회차로 이동했습니다."
        );
      }
      if (request.generation < (latestGeneration.get(origin) || 0)) {
        throw new StreamingBridgeContentError(
          "stale-generation",
          "플레이어 동작 중 무효화된 응답은 적용하지 않았습니다."
        );
      }
      const response = successResponse(request, player);
      if (request.generation === (latestGeneration.get(origin) || 0)) {
        requestResults.get(origin)?.set(request.requestId, response);
      }
      respond(response, origin);
    } catch (error) {
      const code = error instanceof StreamingBridgeContentError
        ? error.code
        : "action-failed";
      const message = error instanceof StreamingBridgeContentError
        ? error.message
        : "스트리밍 플레이어 동작이 실패했습니다.";
      const response = failureResponse(request, code, message);
      if (request.generation === (latestGeneration.get(origin) || 0)) {
        requestResults.get(origin)?.set(request.requestId, response);
      }
      respond(response, origin);
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (
      disposed
      || event.source !== parentWindow
      || !origins.has(event.origin)
    ) {
      return;
    }
    const request = parseStreamingBridgeRequest(event.data);
    if (!request) {
      return;
    }
    const highest = latestGeneration.get(event.origin) || 0;
    if (request.generation > highest) {
      latestGeneration.set(event.origin, request.generation);
      requestResults.set(event.origin, new Map());
    }
    const results = requestResults.get(event.origin)
      || new Map<string, StreamingBridgeResponse | null>();
    if (results.has(request.requestId)) {
      const cached = results.get(request.requestId);
      if (cached) {
        respond(cached, event.origin);
      }
      return;
    }
    results.set(request.requestId, null);
    requestResults.set(event.origin, results);
    if (results.size > 512) {
      const oldest = results.keys().next().value;
      if (typeof oldest === "string") {
        results.delete(oldest);
      }
    }
    queueTail = queueTail.then(
      () => execute(request, event.origin),
      () => execute(request, event.origin)
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = streamingShortcutKeyFromEvent(event);
    if (
      disposed
      || !activeOrigin
      || !activeSource
      || !key
    ) {
      return;
    }
    const origin = activeOrigin;
    const source = activeSource;
    const generation = latestGeneration.get(origin) || 0;
    const eventId = String(createEventId() || "").trim();
    if (!eventId || generation <= 0) {
      return;
    }
    event.preventDefault();
    void Promise.resolve(adapter.readSource()).then((value) => {
      const actualSource = createStreamingBridgeSourceIdentity(value);
      if (
        disposed
        || activeOrigin !== origin
        || !activeSource
        || !sameStreamingBridgeSourceIdentity(activeSource, source)
        || (latestGeneration.get(origin) || 0) !== generation
        || !sameStreamingBridgeSourceIdentity(actualSource, source)
      ) {
        return;
      }
      const shortcut: StreamingBridgeShortcutMessage = {
        protocol: STREAMING_BRIDGE_PROTOCOL,
        type: STREAMING_BRIDGE_SHORTCUT,
        eventId,
        generation,
        source,
        key
      };
      const parsedShortcut = parseStreamingBridgeShortcutMessage(shortcut);
      if (parsedShortcut) {
        parentWindow.postMessage(parsedShortcut, origin);
      }
    }).catch(() => {
      // A shortcut is fail-closed when the iframe source changed or cannot be
      // identified. Never reflect frame URL/error details across the bridge.
    });
  };

  hostWindow.addEventListener("message", onMessage);
  hostWindow.addEventListener("keydown", onKeyDown, true);
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    hostWindow.removeEventListener("message", onMessage);
    hostWindow.removeEventListener("keydown", onKeyDown, true);
    latestGeneration.clear();
    requestResults.clear();
  };
}

export interface HtmlVideoStreamingBridgeAdapterOptions {
  readonly readSource: StreamingBridgeContentAdapter["readSource"];
  readonly hostDocument?: Document;
  readonly seekHandoffDurationMs?: number;
  readonly seekVerificationTimeoutMs?: number;
}

export interface SoopVodStreamingBridgeAdapterOptions {
  readonly readSource: StreamingBridgeContentAdapter["readSource"];
  readonly hostDocument?: Document;
  readonly hostWindow?: Window;
  readonly seekVerificationTimeoutMs?: number;
}

interface SoopVodPart {
  readonly id: string;
  readonly index: number;
  readonly order: number;
  readonly duration: number;
  readonly start: number;
  readonly end: number;
}

interface SoopVodClockState {
  readonly contentId: string;
  readonly core: Record<string, unknown>;
  readonly parts: readonly SoopVodPart[];
  readonly partSignature: string;
  readonly playIndex: number;
  readonly video: HTMLVideoElement;
  readonly partTime: number;
  readonly currentTime: number;
  readonly totalDuration: number;
  readonly paused: boolean;
  readonly playbackRate: number;
  readonly readyState: number;
}

const SOOP_VOD_PART_ID_PATTERN = /^[A-Za-z0-9_-]{1,240}$/u;
const SOOP_VOD_CONTENT_ID_PATTERN = /^\d{1,32}$/u;
const SOOP_MAX_PARTS = 512;
const SOOP_MAX_DURATION_SECONDS = 2_592_000;
const SOOP_CONTROLLER_CLOCK_TOLERANCE_SECONDS = 0.75;
const SOOP_MEDIA_DURATION_TAIL_SECONDS = 1.1;
const SOOP_LOGICAL_END_EPSILON_SECONDS = 0.025;
const SOOP_SEEK_TARGET_TOLERANCE_SECONDS = 0.35;
const SOOP_DEFAULT_SEEK_VERIFICATION_TIMEOUT_MS = 2_500;
const SOOP_SEEK_POLL_INTERVAL_MS = 25;
const HTML_VIDEO_DEFAULT_SEEK_VERIFICATION_TIMEOUT_MS = 1_500;
const HTML_VIDEO_SEEK_POLL_INTERVAL_MS = 25;
const HTML_VIDEO_SEEK_STABLE_MS = 250;
const HTML_VIDEO_SEEK_TARGET_TOLERANCE_SECONDS = 0.25;
const HTML_VIDEO_DEFAULT_SEEK_HANDOFF_MS = 5_000;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function soopSourceContentId(value: unknown): string | null {
  try {
    const source = createStreamingBridgeSourceIdentity(value);
    if (source.platform !== "SOOP") {
      return null;
    }
    return /^soop:vod:(\d{1,32})$/u.exec(source.sessionId)?.[1] || null;
  } catch {
    return null;
  }
}

function exactSoopContentId(value: unknown): string | null {
  if (typeof value === "string" && SOOP_VOD_CONTENT_ID_PATTERN.test(value)) {
    return value;
  }
  if (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
  ) {
    return String(value);
  }
  return null;
}

function exactSoopPartId(value: Record<string, unknown>): string | null {
  const legacyId = typeof value.id === "string"
    && SOOP_VOD_PART_ID_PATTERN.test(value.id)
    ? value.id
    : null;
  const fileInfoKey = typeof value.fileInfoKey === "string"
    && SOOP_VOD_PART_ID_PATTERN.test(value.fileInfoKey)
    ? value.fileInfoKey
    : null;
  if (legacyId && fileInfoKey && legacyId !== fileInfoKey) {
    return null;
  }
  return fileInfoKey || legacyId;
}

function normalizedSoopParts(value: unknown): readonly SoopVodPart[] | null {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > SOOP_MAX_PARTS
  ) {
    return null;
  }
  const ids = new Set<string>();
  const parts: SoopVodPart[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isUnknownRecord(item)) {
      return null;
    }
    const id = exactSoopPartId(item);
    const duration = item.duration;
    if (
      !id
      || ids.has(id)
      || item.idx !== index
      || item.file_order !== index + 1
      || !Number.isSafeInteger(duration)
      || Number(duration) <= 0
    ) {
      return null;
    }
    const end = start + Number(duration);
    if (
      !Number.isSafeInteger(end)
      || end > SOOP_MAX_DURATION_SECONDS
    ) {
      return null;
    }
    ids.add(id);
    parts.push(Object.freeze({
      id,
      index,
      order: index + 1,
      duration: Number(duration),
      start,
      end
    }));
    start = end;
  }
  return Object.freeze(parts);
}

function sameSoopPartVector(
  left: readonly SoopVodPart[],
  right: readonly SoopVodPart[]
): boolean {
  return left.length === right.length && left.every((part, index) => {
    const other = right[index];
    return Boolean(
      other
      && part.id === other.id
      && part.index === other.index
      && part.order === other.order
      && part.duration === other.duration
      && part.start === other.start
      && part.end === other.end
    );
  });
}

function soopPartSignature(parts: readonly SoopVodPart[]): string {
  return parts.map(({ id, index, order, duration }) => (
    `${index}:${order}:${duration}:${id}`
  )).join("|");
}

function sameSoopCurrentPart(
  value: unknown,
  expected: SoopVodPart
): boolean {
  if (!isUnknownRecord(value)) {
    return false;
  }
  return exactSoopPartId(value) === expected.id
    && value.idx === expected.index
    && value.file_order === expected.order
    && value.duration === expected.duration;
}

function stableSoopController(controller: Record<string, unknown>): boolean {
  return safelyRead(() => controller.isChangeFileSeeking) === false
    && safelyRead(() => controller.isSeeking) === false
    && safelyRead(() => controller.isPreloadingNextMedia) === false;
}

function configuredSoopTotalDuration(
  config: Record<string, unknown>,
  parts: readonly SoopVodPart[]
): number | null {
  const value = safelyRead(() => config.totalFileDuration);
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > SOOP_MAX_DURATION_SECONDS
  ) {
    return null;
  }
  const vectorTotal = parts.at(-1)?.end || 0;
  return Math.abs(Number(value) - vectorTotal) <= parts.length
    ? Number(value)
    : null;
}

function soopControllerVideo(
  hostDocument: Document,
  value: unknown
): HTMLVideoElement | null {
  const videos = safelyRead(() => [...hostDocument.querySelectorAll("video")]);
  if (!videos || !videos.includes(value as HTMLVideoElement)) {
    return null;
  }
  const video = value as HTMLVideoElement;
  return videoCandidate(video, hostDocument) ? video : null;
}

async function readSoopVodClockState({
  readSource,
  hostDocument,
  hostWindow
}: {
  readonly readSource: StreamingBridgeContentAdapter["readSource"];
  readonly hostDocument: Document;
  readonly hostWindow: Window;
}): Promise<SoopVodClockState | null> {
  const contentId = soopSourceContentId(await readSource());
  const core = safelyRead(() => Reflect.get(hostWindow, "vodCore"));
  if (!contentId || !isUnknownRecord(core)) {
    return null;
  }
  const controller = safelyRead(() => core.playerController);
  const config = safelyRead(() => core.config);
  const coreParts = normalizedSoopParts(safelyRead(() => core.fileItems));
  if (
    !isUnknownRecord(controller)
    || !isUnknownRecord(config)
    || !coreParts
    || typeof safelyRead(() => core.seek) !== "function"
    || exactSoopContentId(safelyRead(() => config.titleNo)) !== contentId
    || configuredSoopTotalDuration(config, coreParts) === null
    || !stableSoopController(controller)
  ) {
    return null;
  }
  const controllerParts = normalizedSoopParts(
    safelyRead(() => controller.fileItems)
  );
  if (!controllerParts || !sameSoopPartVector(coreParts, controllerParts)) {
    return null;
  }
  const playIndexBefore = safelyRead(() => controller.playIdx);
  if (
    !Number.isInteger(playIndexBefore)
    || Number(playIndexBefore) < 0
    || Number(playIndexBefore) >= coreParts.length
  ) {
    return null;
  }
  const part = coreParts[Number(playIndexBefore)];
  const currentPartBefore = safelyRead(() => controller.currentFileItem);
  const playingTimeBefore = safelyRead(() => controller.playingTime);
  const video = soopControllerVideo(
    hostDocument,
    safelyRead(() => controller.media)
  );
  if (
    !part
    || !sameSoopCurrentPart(currentPartBefore, part)
    || typeof playingTimeBefore !== "number"
    || !Number.isFinite(playingTimeBefore)
    || !video
  ) {
    return null;
  }
  const localTime = safelyRead(() => video.currentTime);
  const mediaDuration = safelyRead(() => video.duration);
  const paused = safelyRead(() => video.paused);
  const playbackRate = safelyRead(() => video.playbackRate);
  const readyState = safelyRead(() => video.readyState);
  if (
    typeof localTime !== "number"
    || !Number.isFinite(localTime)
    || localTime < 0
    || localTime > part.duration + SOOP_LOGICAL_END_EPSILON_SECONDS
    || typeof mediaDuration !== "number"
    || !Number.isFinite(mediaDuration)
    || mediaDuration < part.duration
    || mediaDuration - part.duration >= SOOP_MEDIA_DURATION_TAIL_SECONDS
    || typeof paused !== "boolean"
    || typeof playbackRate !== "number"
    || !Number.isFinite(playbackRate)
    || playbackRate <= 0
    || !Number.isInteger(readyState)
    || Number(readyState) < 1
    || Number(readyState) > 4
  ) {
    return null;
  }
  const playIndexAfter = safelyRead(() => controller.playIdx);
  const currentPartAfter = safelyRead(() => controller.currentFileItem);
  const playingTimeAfter = safelyRead(() => controller.playingTime);
  const controllerPartsAfter = normalizedSoopParts(
    safelyRead(() => controller.fileItems)
  );
  const corePartsAfter = normalizedSoopParts(safelyRead(() => core.fileItems));
  const globalTime = part.start + localTime;
  if (
    playIndexAfter !== playIndexBefore
    || !sameSoopCurrentPart(currentPartAfter, part)
    || typeof playingTimeAfter !== "number"
    || !Number.isFinite(playingTimeAfter)
    || Math.abs(playingTimeBefore - globalTime)
      > SOOP_CONTROLLER_CLOCK_TOLERANCE_SECONDS
    || Math.abs(playingTimeAfter - globalTime)
      > SOOP_CONTROLLER_CLOCK_TOLERANCE_SECONDS
    || !controllerPartsAfter
    || !corePartsAfter
    || !sameSoopPartVector(coreParts, controllerPartsAfter)
    || !sameSoopPartVector(coreParts, corePartsAfter)
    || !stableSoopController(controller)
    || safelyRead(() => controller.media) !== video
  ) {
    return null;
  }
  return Object.freeze({
    contentId,
    core,
    parts: coreParts,
    partSignature: soopPartSignature(coreParts),
    playIndex: Number(playIndexBefore),
    video,
    partTime: localTime,
    currentTime: globalTime,
    totalDuration: coreParts.at(-1)?.end || 0,
    paused,
    playbackRate,
    readyState: Number(readyState)
  });
}

function soopSnapshotFromState(
  state: SoopVodClockState
): StreamingBridgePlayerSnapshot {
  const sourceClockIdentity = normalizeSoopVodSourceClockIdentity({
    schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
    platform: "SOOP",
    contentId: state.contentId,
    totalDurationSeconds: state.totalDuration,
    parts: state.parts.map((part) => ({
      id: part.id,
      index: part.index,
      order: part.order,
      durationSeconds: part.duration
    }))
  });
  const currentPart = state.parts[state.playIndex];
  if (!sourceClockIdentity || !currentPart) {
    return unavailableHtmlVideoSnapshot();
  }
  const normalized = normalizeStreamingBridgePlayerSnapshot({
    found: true,
    currentTime: state.currentTime,
    duration: state.totalDuration,
    paused: state.paused,
    playbackRate: state.playbackRate,
    readyState: state.readyState,
    seekableStart: 0,
    seekableEnd: state.totalDuration,
    sourceClockIdentity,
    sourceClockPosition: {
      partId: currentPart.id,
      partIndex: currentPart.index,
      partOrder: currentPart.order,
      partTimeSeconds: state.partTime,
      globalTimeSeconds: state.currentTime
    }
  });
  return normalized || unavailableHtmlVideoSnapshot();
}

function boundedSoopSeekTimeout(value: unknown): number {
  const timeout = value === undefined
    ? SOOP_DEFAULT_SEEK_VERIFICATION_TIMEOUT_MS
    : Number(value);
  if (!Number.isFinite(timeout) || timeout < 25 || timeout > 4_000) {
    throw new TypeError("SOOP seek 검증 제한 시간은 25~4000ms여야 합니다.");
  }
  return Math.round(timeout);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function expectedSoopPlayIndex(
  parts: readonly SoopVodPart[],
  targetSeconds: number
): number {
  if (targetSeconds === (parts.at(-1)?.end || 0)) {
    return parts.length - 1;
  }
  return parts.findIndex(({ end }) => targetSeconds < end);
}

/**
 * SOOP's HTMLVideoElement clock resets for every multipart file. This adapter
 * is intentionally available only in the page's MAIN world: it proves the
 * official part vector and controller state, then exposes one global VOD clock.
 * A missing, malformed, or transitioning controller never falls back to raw
 * HTMLVideoElement.currentTime, including for a single-part VOD.
 */
export function createSoopVodStreamingBridgeAdapter({
  readSource,
  hostDocument = document,
  hostWindow = window,
  seekVerificationTimeoutMs
}: SoopVodStreamingBridgeAdapterOptions): StreamingBridgeContentAdapter {
  const verificationTimeout = boundedSoopSeekTimeout(
    seekVerificationTimeoutMs
  );
  const readState = () => readSoopVodClockState({
    readSource,
    hostDocument,
    hostWindow
  });
  return Object.freeze({
    readSource,
    async snapshot(): Promise<StreamingBridgePlayerSnapshot> {
      try {
        const state = await readState();
        return state
          ? soopSnapshotFromState(state)
          : unavailableHtmlVideoSnapshot();
      } catch {
        return unavailableHtmlVideoSnapshot();
      }
    },
    async seekAbsolute(targetSeconds: number): Promise<void> {
      if (
        typeof targetSeconds !== "number"
        || !Number.isFinite(targetSeconds)
        || targetSeconds < 0
      ) {
        throw new TypeError("SOOP 전역 seek 시간이 올바르지 않습니다.");
      }
      const before = await readState();
      if (!before || targetSeconds > before.totalDuration) {
        throw new StreamingBridgeContentError(
          "player-state-transient",
          "SOOP 공식 전역 재생 시계를 확인하지 못했습니다."
        );
      }
      const seek = safelyRead(() => before.core.seek);
      if (typeof seek !== "function") {
        throw new StreamingBridgeContentError(
          "player-state-transient",
          "SOOP 공식 전역 seek를 확인하지 못했습니다."
        );
      }
      await Promise.resolve(Reflect.apply(seek, before.core, [targetSeconds]));
      const expectedIndex = expectedSoopPlayIndex(before.parts, targetSeconds);
      const deadline = Date.now() + verificationTimeout;
      do {
        const after = await readState();
        if (
          after
          && after.contentId === before.contentId
          && after.partSignature === before.partSignature
          && after.playIndex === expectedIndex
          && Math.abs(after.currentTime - targetSeconds)
            <= SOOP_SEEK_TARGET_TOLERANCE_SECONDS
        ) {
          return;
        }
        await delay(SOOP_SEEK_POLL_INTERVAL_MS);
      } while (Date.now() <= deadline);
      throw new StreamingBridgeContentError(
        "player-state-transient",
        "SOOP 공식 전역 seek 결과를 검증하지 못했습니다."
      );
    },
    async setPlaybackRate(playbackRate: 0.25 | 2): Promise<void> {
      const state = await readState();
      if (!state) {
        throw new StreamingBridgeContentError(
          "player-state-transient",
          "SOOP 공식 전역 재생 시계를 확인하지 못했습니다."
        );
      }
      state.video.playbackRate = playbackRate;
    }
  });
}

function visibleVideoScore(
  video: HTMLVideoElement,
  hostDocument: Document,
  readyState: number
): number {
  let rectangle: DOMRect;
  let style: CSSStyleDeclaration | undefined;
  try {
    rectangle = video.getBoundingClientRect();
    style = hostDocument.defaultView?.getComputedStyle(video);
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
  const width = safelyRead(() => rectangle.width);
  const height = safelyRead(() => rectangle.height);
  const visibility = safelyRead(() => style?.visibility);
  const display = safelyRead(() => style?.display);
  if (
    typeof width !== "number"
    || !Number.isFinite(width)
    || width <= 0
    || typeof height !== "number"
    || !Number.isFinite(height)
    || height <= 0
    || visibility === "hidden"
    || display === "none"
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  const score = width * height
    + (readyState >= 2 ? 1_000_000 : 0);
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}

function semanticAttributeTokens(value: unknown): readonly string[] {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/gu)
    .filter(Boolean);
}

function semanticallyAdvertisingVideo(video: HTMLVideoElement): boolean {
  let element: Element | null = video;
  for (let depth = 0; element && depth < 24; depth += 1) {
    const tokens = ["id", "class", "data-role", "role", "aria-label"]
      .flatMap((name) => semanticAttributeTokens(
        safelyRead(() => element?.getAttribute(name))
      ));
    if (tokens.some((token) => (
      token === "ad"
      || token === "ads"
      || token === "advert"
      || token === "advertisement"
      || token === "advertising"
      || token === "광고"
    ))) {
      return true;
    }
    element = safelyRead(() => element?.parentElement) || null;
  }
  return false;
}

interface VideoCandidate {
  readonly video: HTMLVideoElement;
  readonly duration: number;
  readonly readyState: number;
  readonly visibleScore: number;
}

function videoCandidate(
  video: HTMLVideoElement,
  hostDocument: Document
): VideoCandidate | null {
  if (semanticallyAdvertisingVideo(video)) {
    return null;
  }
  const rawDuration = safelyRead(() => video.duration);
  const rawReadyState = safelyRead(() => video.readyState);
  return {
    video,
    duration: typeof rawDuration === "number" && Number.isFinite(rawDuration)
      ? Math.max(0, rawDuration)
      : 0,
    readyState: typeof rawReadyState === "number"
      && Number.isFinite(rawReadyState)
      ? Math.max(0, rawReadyState)
      : 0,
    visibleScore: visibleVideoScore(
      video,
      hostDocument,
      typeof rawReadyState === "number" && Number.isFinite(rawReadyState)
        ? Math.max(0, rawReadyState)
        : 0
    )
  };
}

function primaryVideo(
  hostDocument: Document,
  previous: HTMLVideoElement | null
): HTMLVideoElement | null {
  const videos = [...hostDocument.querySelectorAll("video")];
  const candidates = videos
    .map((video) => videoCandidate(video, hostDocument))
    .filter((candidate): candidate is VideoCandidate => candidate !== null);
  const visibleCandidates = candidates.filter(({ visibleScore }) => (
    Number.isFinite(visibleScore)
  ));
  const selectableCandidates = visibleCandidates.length > 0
    ? visibleCandidates
    : candidates;
  const retained = previous
    ? selectableCandidates.find(({ video }) => video === previous)
    : null;
  if (retained) {
    return retained.video;
  }
  selectableCandidates.sort((left, right) => (
    right.duration - left.duration
    || right.readyState - left.readyState
    || right.visibleScore - left.visibleScore
  ));
  return selectableCandidates[0]?.video || null;
}

function requirePrimaryVideo(
  selectPrimaryVideo: () => HTMLVideoElement | null
): HTMLVideoElement {
  const video = selectPrimaryVideo();
  if (!video) {
    throw new StreamingBridgeContentError(
      "player-unavailable",
      "현재 프레임에서 스트리밍 영상 요소를 찾지 못했습니다."
    );
  }
  return video;
}

function htmlVideoSnapshotForVideo(
  video: HTMLVideoElement | null
): StreamingBridgePlayerSnapshot {
  if (!video) {
    return unavailableHtmlVideoSnapshot();
  }
  const currentTime = safelyRead(() => video.currentTime);
  const rawDuration = safelyRead(() => video.duration);
  const paused = safelyRead(() => video.paused);
  const playbackRate = safelyRead(() => video.playbackRate);
  const readyState = safelyRead(() => video.readyState);
  const duration = typeof rawDuration === "number"
    && Number.isFinite(rawDuration)
    && rawDuration >= 0
    ? rawDuration
    : null;
  const { seekableStart, seekableEnd } = safeSeekableBounds(video);
  const normalized = normalizeStreamingBridgePlayerSnapshot({
    found: true,
    currentTime,
    duration,
    paused,
    playbackRate,
    readyState,
    seekableStart,
    seekableEnd
  });
  return normalized || unavailableHtmlVideoSnapshot();
}

function safelyRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function unavailableHtmlVideoSnapshot(): StreamingBridgePlayerSnapshot {
  return {
    found: false,
    currentTime: null,
    duration: null,
    paused: null,
    playbackRate: null,
    readyState: null,
    seekableStart: null,
    seekableEnd: null
  };
}

function safeSeekableBounds(video: HTMLVideoElement): {
  readonly seekableStart: number | null;
  readonly seekableEnd: number | null;
} {
  const seekable = safelyRead(() => video.seekable);
  const length = seekable ? safelyRead(() => seekable.length) : undefined;
  if (!Number.isInteger(length) || Number(length) <= 0) {
    return { seekableStart: null, seekableEnd: null };
  }
  const seekableStart = safelyRead(() => seekable?.start(0));
  const seekableEnd = safelyRead(() => seekable?.end(Number(length) - 1));
  if (
    typeof seekableStart !== "number"
    || !Number.isFinite(seekableStart)
    || seekableStart < 0
    || typeof seekableEnd !== "number"
    || !Number.isFinite(seekableEnd)
    || seekableEnd < seekableStart
  ) {
    // MediaSource may replace its TimeRanges between task checkpoints. A
    // transient IndexSizeError must not discard an otherwise valid clock.
    return { seekableStart: null, seekableEnd: null };
  }
  return { seekableStart, seekableEnd };
}

function clampedAbsoluteTarget(
  video: HTMLVideoElement,
  targetSeconds: number
): number {
  const rawDuration = safelyRead(() => video.duration);
  let minimum = 0;
  let maximum = typeof rawDuration === "number"
    && Number.isFinite(rawDuration)
    && rawDuration >= 0
    ? rawDuration
    : Number.POSITIVE_INFINITY;
  const { seekableStart, seekableEnd } = safeSeekableBounds(video);
  if (seekableStart !== null && seekableEnd !== null) {
    minimum = seekableStart;
    maximum = seekableEnd;
  }
  return Math.min(maximum, Math.max(minimum, targetSeconds));
}

function boundedHtmlVideoSeekTimeout(value: unknown): number {
  const timeout = value === undefined
    ? HTML_VIDEO_DEFAULT_SEEK_VERIFICATION_TIMEOUT_MS
    : Number(value);
  if (!Number.isFinite(timeout) || timeout < 300 || timeout > 2_400) {
    throw new TypeError("HTML video seek 검증 제한 시간은 300~2400ms여야 합니다.");
  }
  return Math.round(timeout);
}

function boundedHtmlVideoSeekHandoffDuration(value: unknown): number {
  const duration = value === undefined
    ? HTML_VIDEO_DEFAULT_SEEK_HANDOFF_MS
    : Number(value);
  if (!Number.isFinite(duration) || duration < 300 || duration > 5_000) {
    throw new TypeError("HTML video seek 인계 시간은 300~5000ms여야 합니다.");
  }
  return Math.round(duration);
}

async function verifyStableHtmlVideoSeek({
  selectPrimaryVideo,
  targetSeconds,
  timeoutMs,
  video
}: {
  readonly selectPrimaryVideo: () => HTMLVideoElement | null;
  readonly targetSeconds: number;
  readonly timeoutMs: number;
  readonly video: HTMLVideoElement;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;
  let stableMediaTime: number | null = null;
  do {
    const selected = selectPrimaryVideo();
    const currentTime = selected === video
      ? safelyRead(() => video.currentTime)
      : undefined;
    const seeking = selected === video
      ? safelyRead(() => video.seeking)
      : undefined;
    const readyState = selected === video
      ? safelyRead(() => video.readyState)
      : undefined;
    const paused = selected === video
      ? safelyRead(() => video.paused)
      : undefined;
    const playbackRate = selected === video
      ? safelyRead(() => video.playbackRate)
      : undefined;
    const now = Date.now();
    const usablePlayerState = (
      typeof currentTime === "number"
      && Number.isFinite(currentTime)
      && seeking === false
      && typeof readyState === "number"
      && Number.isFinite(readyState)
      && readyState >= 2
      && typeof paused === "boolean"
      && typeof playbackRate === "number"
      && Number.isFinite(playbackRate)
      && playbackRate > 0
      && playbackRate <= 16
    );
    const initialTargetMatched = usablePlayerState
      && Math.abs(currentTime - targetSeconds)
        <= HTML_VIDEO_SEEK_TARGET_TOLERANCE_SECONDS;
    const elapsedSeconds = stableSince === null
      ? 0
      : Math.max(0, (now - stableSince) / 1_000);
    const allowedAdvance = paused === false && typeof playbackRate === "number"
      ? elapsedSeconds * playbackRate
      : 0;
    const stableTrajectoryMatched = usablePlayerState
      && stableMediaTime !== null
      && currentTime >= stableMediaTime
        - HTML_VIDEO_SEEK_TARGET_TOLERANCE_SECONDS
      && currentTime <= stableMediaTime
        + allowedAdvance
        + HTML_VIDEO_SEEK_TARGET_TOLERANCE_SECONDS;
    if (
      (stableSince === null && initialTargetMatched)
      || (stableSince !== null && stableTrajectoryMatched)
    ) {
      if (stableSince === null) {
        stableSince = now;
        stableMediaTime = currentTime;
      }
      if (now - stableSince >= HTML_VIDEO_SEEK_STABLE_MS) {
        return;
      }
    } else {
      stableSince = null;
      stableMediaTime = null;
    }
    await delay(HTML_VIDEO_SEEK_POLL_INTERVAL_MS);
  } while (Date.now() <= deadline);
  throw new StreamingBridgeContentError(
    "player-state-transient",
    "플랫폼 HTML video의 절대 탐색 결과가 안정적으로 유지되지 않았습니다."
  );
}

/**
 * Small DOM adapter matching the legacy Extension's proven HTMLVideoElement
 * controls. It reads/changes only the live streaming element and never fetches
 * or materializes media.
 */
export function createHtmlVideoStreamingBridgeAdapter({
  readSource,
  hostDocument = document,
  seekHandoffDurationMs,
  seekVerificationTimeoutMs
}: HtmlVideoStreamingBridgeAdapterOptions): StreamingBridgeContentAdapter {
  const handoffDuration = boundedHtmlVideoSeekHandoffDuration(
    seekHandoffDurationMs
  );
  const verificationTimeout = boundedHtmlVideoSeekTimeout(
    seekVerificationTimeoutMs
  );
  let previousPrimaryVideo: HTMLVideoElement | null = null;
  let verifiedSeekHandoff: {
    video: HTMLVideoElement;
    playbackRate: number;
    targetSeconds: number;
    expiresAt: number;
  } | null = null;
  const selectPrimaryVideo = (): HTMLVideoElement | null => {
    previousPrimaryVideo = primaryVideo(hostDocument, previousPrimaryVideo);
    return previousPrimaryVideo;
  };
  return Object.freeze({
    readSource,
    async snapshot(): Promise<StreamingBridgePlayerSnapshot> {
      const video = selectPrimaryVideo();
      const handoff = verifiedSeekHandoff;
      if (!video || !handoff) {
        return htmlVideoSnapshotForVideo(video);
      }
      if (Date.now() > handoff.expiresAt) {
        verifiedSeekHandoff = null;
        return htmlVideoSnapshotForVideo(video);
      }

      const observedTime = safelyRead(() => video.currentTime);
      const clockRolledBehindTarget = (
        typeof observedTime !== "number"
        || !Number.isFinite(observedTime)
        || observedTime < handoff.targetSeconds
          - HTML_VIDEO_SEEK_TARGET_TOLERANCE_SECONDS
      );
      if (video === handoff.video && !clockRolledBehindTarget) {
        return htmlVideoSnapshotForVideo(video);
      }

      // CHZZK can replace only its HTMLVideoElement immediately after a
      // verified seek while keeping the iframe and source identity intact.
      // The replacement starts at 0, so accepting its first snapshot would
      // silently move an E/F/R cut back to the beginning. Transfer the recent
      // app-owned seek once to that exact replacement and require the same
      // stable-player proof before exposing its clock. The short absolute
      // deadline keeps an intentional later reset to 0 fully observable.
      const replacementTarget = clampedAbsoluteTarget(
        video,
        handoff.targetSeconds
      );
      video.playbackRate = handoff.playbackRate;
      video.currentTime = replacementTarget;
      await verifyStableHtmlVideoSeek({
        selectPrimaryVideo,
        targetSeconds: replacementTarget,
        timeoutMs: verificationTimeout,
        video
      });
      if (verifiedSeekHandoff === handoff) {
        verifiedSeekHandoff = {
          ...handoff,
          video
        };
      }
      return htmlVideoSnapshotForVideo(video);
    },
    async seekAbsolute(targetSeconds: number): Promise<void> {
      const video = requirePrimaryVideo(selectPrimaryVideo);
      const target = clampedAbsoluteTarget(video, targetSeconds);
      video.currentTime = target;
      await verifyStableHtmlVideoSeek({
        selectPrimaryVideo,
        targetSeconds: target,
        timeoutMs: verificationTimeout,
        video
      });
      verifiedSeekHandoff = {
        video,
        playbackRate: safelyRead(() => video.playbackRate) || 1,
        targetSeconds: target,
        expiresAt: Date.now() + handoffDuration
      };
    },
    setPlaybackRate(playbackRate: 0.25 | 2): void {
      requirePrimaryVideo(selectPrimaryVideo).playbackRate = playbackRate;
    }
  });
}
