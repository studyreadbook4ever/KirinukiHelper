import {
  normalizeSoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";
import type {
  SoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";

export const STREAMING_BRIDGE_PROTOCOL = "kirinuki-streaming-bridge/v2";
export const STREAMING_BRIDGE_REQUEST = "KIRINUKI_STREAMING_BRIDGE_REQUEST";
export const STREAMING_BRIDGE_RESPONSE = "KIRINUKI_STREAMING_BRIDGE_RESPONSE";

export const STREAMING_BRIDGE_ACTIONS = Object.freeze([
  "snapshot",
  "seek-absolute",
  "set-playback-rate"
] as const);

export type StreamingBridgeAction = typeof STREAMING_BRIDGE_ACTIONS[number];
export type StreamingBridgePlatform = "CHZZK" | "YOUTUBE" | "SOOP";

/**
 * This is deliberately smaller than an editor SourceRecord. A bridge message
 * never contains a source URL, cookie, gateway credential, local-media token,
 * title, or creator metadata.
 */
export interface StreamingBridgeSourceIdentity {
  readonly platform: StreamingBridgePlatform;
  readonly sessionId: string;
}

export interface StreamingBridgePlayerSnapshot {
  readonly found: boolean;
  readonly currentTime: number | null;
  readonly duration: number | null;
  readonly paused: boolean | null;
  readonly playbackRate: number | null;
  readonly readyState: number | null;
  readonly seekableStart: number | null;
  readonly seekableEnd: number | null;
  /** Present only for a SOOP snapshot proven against the official vodCore. */
  readonly sourceClockIdentity?: SoopVodSourceClockIdentity;
  /** Binds the global player clock to one exact part in sourceClockIdentity. */
  readonly sourceClockPosition?: StreamingBridgeSourceClockPosition;
}

export interface StreamingBridgeSourceClockPosition {
  readonly partId: string;
  readonly partIndex: number;
  readonly partOrder: number;
  readonly partTimeSeconds: number;
  readonly globalTimeSeconds: number;
}

interface StreamingBridgeRequestBase {
  readonly protocol: typeof STREAMING_BRIDGE_PROTOCOL;
  readonly type: typeof STREAMING_BRIDGE_REQUEST;
  readonly requestId: string;
  readonly generation: number;
  readonly source: StreamingBridgeSourceIdentity;
}

export type StreamingBridgeRequest =
  | (StreamingBridgeRequestBase & {
    readonly action: "snapshot";
  })
  | (StreamingBridgeRequestBase & {
    readonly action: "seek-absolute";
    readonly targetSeconds: number;
  })
  | (StreamingBridgeRequestBase & {
    readonly action: "set-playback-rate";
    readonly playbackRate: 0.25 | 2;
  });

interface StreamingBridgeResponseBase {
  readonly protocol: typeof STREAMING_BRIDGE_PROTOCOL;
  readonly type: typeof STREAMING_BRIDGE_RESPONSE;
  readonly requestId: string;
  readonly generation: number;
  readonly action: StreamingBridgeAction;
  readonly source: StreamingBridgeSourceIdentity;
}

export type StreamingBridgeResponse =
  | (StreamingBridgeResponseBase & {
    readonly ok: true;
    readonly player: StreamingBridgePlayerSnapshot;
  })
  | (StreamingBridgeResponseBase & {
    readonly ok: false;
    readonly error: {
      readonly code: string;
      readonly message: string;
    };
  });

type UnknownRecord = Record<string, unknown>;

const SUPPORTED_PLATFORMS = new Set<StreamingBridgePlatform>([
  "CHZZK",
  "YOUTUBE",
  "SOOP"
]);
const SUPPORTED_CONTENT_TYPES = new Set(["vod", "live"]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:%@+-]{3,512}$/u;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9-]{1,63}$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: UnknownRecord,
  required: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function boundedPlainString(value: unknown, maximumLength = 512): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  return normalized
    && normalized.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : "";
}

function normalizedPlatform(value: unknown): StreamingBridgePlatform | null {
  const platform = boundedPlainString(value, 16).toUpperCase();
  return SUPPORTED_PLATFORMS.has(platform as StreamingBridgePlatform)
    ? platform as StreamingBridgePlatform
    : null;
}

function normalizedSessionId(value: unknown): string | null {
  const sessionId = boundedPlainString(value, 512);
  return SESSION_ID_PATTERN.test(sessionId) && !sessionId.includes("://")
    ? sessionId
    : null;
}

function encodedIdentityPart(value: unknown, maximumLength = 256): string {
  const part = boundedPlainString(value, maximumLength);
  return part ? encodeURIComponent(part) : "";
}

function sessionIdMatchesPlatform(
  platform: StreamingBridgePlatform,
  sessionId: string
): boolean {
  if (platform === "YOUTUBE") {
    return /^youtube:(?:vod|live):[A-Za-z0-9_-]{11}$/u.test(sessionId);
  }
  if (platform === "SOOP") {
    return /^soop:vod:\d{1,32}$/u.test(sessionId);
  }
  return /^chzzk:(?:(?:vod|live):\d{1,32}|broadcast:[a-f0-9]{32}:[A-Za-z0-9._%:+-]{1,256})$/iu.test(
    sessionId
  );
}

/**
 * Derives an opaque, non-URL source session identity from the same stable IDs
 * available to both the web app and the platform content script.
 */
export function createStreamingBridgeSourceIdentity(
  value: unknown
): StreamingBridgeSourceIdentity {
  if (!isRecord(value)) {
    throw new TypeError("스트리밍 브리지 원본 회차 정보가 없습니다.");
  }
  const platform = normalizedPlatform(value.platform);
  if (!platform) {
    throw new TypeError("스트리밍 브리지가 지원하지 않는 플랫폼입니다.");
  }
  const suppliedSessionId = normalizedSessionId(value.sessionId);
  if (
    suppliedSessionId
    && sessionIdMatchesPlatform(platform, suppliedSessionId)
  ) {
    return Object.freeze({ platform, sessionId: suppliedSessionId });
  }

  const contentType = boundedPlainString(value.contentType, 16).toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
    throw new TypeError("스트리밍 브리지 원본 종류를 식별하지 못했습니다.");
  }
  if (platform === "SOOP" && contentType !== "vod") {
    throw new TypeError("SOOP 스트리밍 브리지는 VOD 회차만 지원합니다.");
  }
  const rawContentId = boundedPlainString(value.contentId, 256);
  const contentIdIsValid = platform === "YOUTUBE"
    ? /^[A-Za-z0-9_-]{11}$/u.test(rawContentId)
    : /^\d{1,32}$/u.test(rawContentId);
  const contentId = contentIdIsValid
    ? encodedIdentityPart(rawContentId)
    : "";
  let sessionId = "";
  if (contentId) {
    sessionId = `${platform.toLowerCase()}:${contentType}:${contentId}`;
  } else if (platform === "CHZZK" && contentType === "live") {
    const rawChannelId = boundedPlainString(value.channelId, 64);
    const channelId = /^[a-f0-9]{32}$/iu.test(rawChannelId)
      ? encodedIdentityPart(rawChannelId)
      : "";
    const broadcastStartedAt = encodedIdentityPart(
      value.broadcastStartedAt,
      128
    );
    if (channelId && broadcastStartedAt) {
      sessionId = `chzzk:broadcast:${channelId}:${broadcastStartedAt}`;
    }
  }
  if (!normalizedSessionId(sessionId)) {
    throw new TypeError(
      "스트리밍 브리지에 사용할 안정적인 원본 회차 ID가 없습니다."
    );
  }
  return Object.freeze({ platform, sessionId });
}

export function sameStreamingBridgeSourceIdentity(
  left: StreamingBridgeSourceIdentity,
  right: StreamingBridgeSourceIdentity
): boolean {
  return left.platform === right.platform && left.sessionId === right.sessionId;
}

function normalizedRequestId(value: unknown): string | null {
  const requestId = boundedPlainString(value, 160);
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

function normalizedGeneration(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

function parseIdentity(value: unknown): StreamingBridgeSourceIdentity | null {
  if (!isRecord(value) || !hasExactKeys(value, ["platform", "sessionId"])) {
    return null;
  }
  try {
    return createStreamingBridgeSourceIdentity(value);
  } catch {
    return null;
  }
}

function requestBase(value: UnknownRecord): {
  requestId: string;
  generation: number;
  source: StreamingBridgeSourceIdentity;
} | null {
  if (
    value.protocol !== STREAMING_BRIDGE_PROTOCOL
    || value.type !== STREAMING_BRIDGE_REQUEST
  ) {
    return null;
  }
  const requestId = normalizedRequestId(value.requestId);
  const generation = normalizedGeneration(value.generation);
  const source = parseIdentity(value.source);
  return requestId && generation && source
    ? { requestId, generation, source }
    : null;
}

export function parseStreamingBridgeRequest(
  value: unknown
): StreamingBridgeRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const base = requestBase(value);
  if (!base || !STREAMING_BRIDGE_ACTIONS.includes(
    value.action as StreamingBridgeAction
  )) {
    return null;
  }
  const common = {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_REQUEST,
    ...base
  } as const;
  if (
    value.action === "snapshot"
  ) {
    if (!hasExactKeys(value, [
      "protocol", "type", "requestId", "generation", "source", "action"
    ])) {
      return null;
    }
    return { ...common, action: value.action };
  }
  if (value.action === "seek-absolute") {
    if (
      !hasExactKeys(value, [
        "protocol", "type", "requestId", "generation", "source", "action",
        "targetSeconds"
      ])
      || typeof value.targetSeconds !== "number"
      || !Number.isFinite(value.targetSeconds)
      || value.targetSeconds < 0
      || value.targetSeconds > 2_592_000
    ) {
      return null;
    }
    return { ...common, action: value.action, targetSeconds: value.targetSeconds };
  }
  if (value.action === "set-playback-rate") {
    if (
      !hasExactKeys(value, [
        "protocol", "type", "requestId", "generation", "source", "action",
        "playbackRate"
      ])
      || (value.playbackRate !== 0.25 && value.playbackRate !== 2)
    ) {
      return null;
    }
    return { ...common, action: value.action, playbackRate: value.playbackRate };
  }
  return null;
}

function finiteNonNegativeOrNull(value: unknown): number | null | undefined {
  return value === null
    ? null
    : typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
}

function normalizedSourceClockPosition(
  value: unknown,
  identity: SoopVodSourceClockIdentity,
  currentTime: number | null,
  duration: number | null
): StreamingBridgeSourceClockPosition | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "partId",
      "partIndex",
      "partOrder",
      "partTimeSeconds",
      "globalTimeSeconds"
    ])
    || typeof value.partId !== "string"
    || !Number.isSafeInteger(value.partIndex)
    || !Number.isSafeInteger(value.partOrder)
    || typeof value.partTimeSeconds !== "number"
    || !Number.isFinite(value.partTimeSeconds)
    || value.partTimeSeconds < 0
    || typeof value.globalTimeSeconds !== "number"
    || !Number.isFinite(value.globalTimeSeconds)
    || value.globalTimeSeconds < 0
  ) {
    return null;
  }
  const partIndex = Number(value.partIndex);
  const part = identity.parts[partIndex];
  if (
    !part
    || value.partId !== part.id
    || value.partOrder !== part.order
    || value.partTimeSeconds > part.durationSeconds + 0.025
    || currentTime === null
    || duration !== identity.totalDurationSeconds
  ) {
    return null;
  }
  const partStartSeconds = identity.parts
    .slice(0, partIndex)
    .reduce((total, item) => total + item.durationSeconds, 0);
  const expectedGlobalTime = partStartSeconds + value.partTimeSeconds;
  if (
    Math.abs(value.globalTimeSeconds - expectedGlobalTime) > 0.000_001
    || Math.abs(currentTime - value.globalTimeSeconds) > 0.000_001
    || value.globalTimeSeconds > identity.totalDurationSeconds + 0.025
  ) {
    return null;
  }
  return Object.freeze({
    partId: part.id,
    partIndex,
    partOrder: part.order,
    partTimeSeconds: value.partTimeSeconds,
    globalTimeSeconds: value.globalTimeSeconds
  });
}

export function normalizeStreamingBridgePlayerSnapshot(
  value: unknown
): StreamingBridgePlayerSnapshot | null {
  const baseKeys = [
    "found",
    "currentTime",
    "duration",
    "paused",
    "playbackRate",
    "readyState",
    "seekableStart",
    "seekableEnd"
  ];
  if (!isRecord(value) || typeof value.found !== "boolean") {
    return null;
  }
  const hasSourceClockIdentity = Object.prototype.hasOwnProperty.call(
    value,
    "sourceClockIdentity"
  );
  const hasSourceClockPosition = Object.prototype.hasOwnProperty.call(
    value,
    "sourceClockPosition"
  );
  if (
    hasSourceClockIdentity !== hasSourceClockPosition
    || !hasExactKeys(
      value,
      hasSourceClockIdentity
        ? [...baseKeys, "sourceClockIdentity", "sourceClockPosition"]
        : baseKeys
    )
  ) {
    return null;
  }
  const currentTime = finiteNonNegativeOrNull(value.currentTime);
  const duration = finiteNonNegativeOrNull(value.duration);
  const seekableStart = finiteNonNegativeOrNull(value.seekableStart);
  const seekableEnd = finiteNonNegativeOrNull(value.seekableEnd);
  const paused = value.paused === null || typeof value.paused === "boolean"
    ? value.paused
    : undefined;
  const playbackRate = value.playbackRate === null
    ? null
    : typeof value.playbackRate === "number"
      && Number.isFinite(value.playbackRate)
      && value.playbackRate > 0
      ? value.playbackRate
      : undefined;
  const readyState = value.readyState === null
    ? null
    : Number.isInteger(value.readyState)
      && Number(value.readyState) >= 0
      && Number(value.readyState) <= 4
      ? Number(value.readyState)
      : undefined;
  if (
    currentTime === undefined
    || duration === undefined
    || paused === undefined
    || playbackRate === undefined
    || readyState === undefined
    || seekableStart === undefined
    || seekableEnd === undefined
    || (
      value.found
      && (
        currentTime === null
        || paused === null
        || playbackRate === null
        || readyState === null
      )
    )
    || (
      seekableStart !== null
      && seekableEnd !== null
      && seekableEnd < seekableStart
    )
  ) {
    return null;
  }
  const sourceClockIdentity = hasSourceClockIdentity
    ? normalizeSoopVodSourceClockIdentity(value.sourceClockIdentity)
    : null;
  const sourceClockPosition = sourceClockIdentity
    ? normalizedSourceClockPosition(
      value.sourceClockPosition,
      sourceClockIdentity,
      currentTime,
      duration
    )
    : null;
  if (
    hasSourceClockIdentity
    && (
      !value.found
      || !sourceClockIdentity
      || !sourceClockPosition
    )
  ) {
    return null;
  }
  return Object.freeze({
    found: value.found,
    currentTime,
    duration,
    paused,
    playbackRate,
    readyState,
    seekableStart,
    seekableEnd,
    ...(sourceClockIdentity && sourceClockPosition
      ? { sourceClockIdentity, sourceClockPosition }
      : {})
  });
}

export function parseStreamingBridgeResponse(
  value: unknown
): StreamingBridgeResponse | null {
  if (
    !isRecord(value)
    || value.protocol !== STREAMING_BRIDGE_PROTOCOL
    || value.type !== STREAMING_BRIDGE_RESPONSE
    || !STREAMING_BRIDGE_ACTIONS.includes(value.action as StreamingBridgeAction)
    || typeof value.ok !== "boolean"
  ) {
    return null;
  }
  const requestId = normalizedRequestId(value.requestId);
  const generation = normalizedGeneration(value.generation);
  const source = parseIdentity(value.source);
  if (!requestId || !generation || !source) {
    return null;
  }
  const base = {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId,
    generation,
    action: value.action as StreamingBridgeAction,
    source
  } as const;
  if (value.ok) {
    if (!hasExactKeys(value, [
      "protocol", "type", "requestId", "generation", "action", "source",
      "ok", "player"
    ])) {
      return null;
    }
    const player = normalizeStreamingBridgePlayerSnapshot(value.player);
    if (!player) {
      return null;
    }
    const soopContentId = source.platform === "SOOP"
      ? /^soop:vod:(\d{1,32})$/u.exec(source.sessionId)?.[1] || ""
      : "";
    if (
      (source.platform === "SOOP"
        && (
          !player.sourceClockIdentity
          || player.sourceClockIdentity.contentId !== soopContentId
        ))
      || (source.platform !== "SOOP" && player.sourceClockIdentity)
    ) {
      return null;
    }
    return { ...base, ok: true, player };
  }
  if (
    !hasExactKeys(value, [
      "protocol", "type", "requestId", "generation", "action", "source",
      "ok", "error"
    ])
    || !isRecord(value.error)
    || !hasExactKeys(value.error, ["code", "message"])
  ) {
    return null;
  }
  const code = boundedPlainString(value.error.code, 64);
  const message = boundedPlainString(value.error.message, 500);
  if (!ERROR_CODE_PATTERN.test(code) || !message) {
    return null;
  }
  return { ...base, ok: false, error: { code, message } };
}
