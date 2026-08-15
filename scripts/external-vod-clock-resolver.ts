/**
 * Strict orchestration boundary between selected-source parsing and section
 * acquisition. Signed URLs and public headers remain only in `runtime`; the
 * persisted proof set is semantic, bounded and stable across token rotation.
 */
import { createHash } from "node:crypto";

import type {
  ExternalVodDirectClockProof,
  ExternalVodDirectRuntimeInputs,
  ExternalVodDirectSectionEvidence
} from "./external-vod-direct-acquirer.js";
import {
  externalVodDirectClockProofId,
  parseExternalVodDirectSectionEvidence
} from "./external-vod-direct-acquirer.js";
import {
  externalVodHlsPlaylistFingerprintSha256,
  parseExternalVodHlsPersistedClockEvidence
} from "./external-vod-hls-acquirer.js";
import type {
  ExternalVodHlsPersistedClockEvidence,
  ExternalVodHlsTimeline
} from "./external-vod-hls-acquirer.js";
import {
  createExternalVodSectionClockEvidence,
  parseDirectMediaFfprobeClockProof,
  parseVodHlsMediaPlaylist,
  parseYtDlpSelectedInputsDump
} from "./external-vod-clock-proof.js";
import type {
  ExternalVodSelectedDirectInput,
  ExternalVodSelectedDirectInputs
} from "./external-vod-clock-proof.js";
import {
  assertExternalVodTransferUrl,
  fetchExternalVodPlaylist,
  safeExternalVodRequestHeaders,
  secretFreeExternalVodUrlIdentity
} from "./external-vod-transfer.js";
import type { ExternalVodTransferPlatform } from "./external-vod-transfer.js";

export const EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA =
  "chzzk-kirinuki/external-vod-clock-proof-set-v1";
export const EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA =
  "chzzk-kirinuki/external-vod-part-clock-proof-v1";
export const MAX_EXTERNAL_VOD_CLOCK_PARTS = 500;
export const MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_EXTERNAL_VOD_PART_DURATION_TOLERANCE_MS = 1_000;
export const MAX_EXTERNAL_VOD_PART_DURATION_TOLERANCE_MS = 60_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_PUBLIC_ID_PATTERN = /^[^\u0000-\u001f\u007f/?#&=]{1,240}$/u;
const MAX_SEMANTIC_IDENTITY_LENGTH = 16 * 1024;

export interface ExternalVodClockMetadataPart {
  partIndex: number;
  playlistItem?: number;
  partId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
}

export interface ExternalVodHlsSelectedSource {
  kind: "hls";
  platform: "CHZZK" | "SOOP";
  contentId: string;
  partId: string;
  formatIdentity: string;
  timeline: ExternalVodHlsTimeline;
  /** Public CDN headers kept in memory only; never persisted in proof sets. */
  requestHeaders?: Readonly<Record<string, string>>;
}

export interface ExternalVodDirectSelectedSource {
  kind: "direct";
  platform: "YOUTUBE";
  contentId: string;
  partId: string;
  formatIdentity: string;
  clockProof: ExternalVodDirectClockProof;
  runtimeInputs: ExternalVodDirectRuntimeInputs;
}

export type ExternalVodParsedSelectedSource =
  | ExternalVodHlsSelectedSource
  | ExternalVodDirectSelectedSource;

export interface ResolveExternalVodClockProofSetRequest {
  platform: ExternalVodTransferPlatform;
  contentId: string;
  sourceVersionId: string;
  sourceDurationMs: number;
  /** Total metadata part count, even when only acquisition parts are resolved. */
  metadataPartCount: number;
  parts: readonly ExternalVodClockMetadataPart[];
  partDurationToleranceMs?: number;
  signal?: AbortSignal;
}

export interface ExternalVodClockResolverDependencies {
  resolveSelectedPart: (
    part: ExternalVodClockMetadataPart,
    context: {
      platform: ExternalVodTransferPlatform;
      contentId: string;
      signal?: AbortSignal;
    }
  ) => Promise<ExternalVodParsedSelectedSource>;
}

export interface ExternalVodPersistedPartClockProof {
  schemaId: typeof EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA;
  partProofId: string;
  partIndex: number;
  playlistItem: number | null;
  partIdentitySha256: string;
  sourceStartMs: number;
  sourceEndMs: number;
  metadataDurationMs: number;
  resolvedDurationUs: number;
  transport: "HLS" | "DIRECT";
  formatIdentitySha256: string;
  clockProofId: string;
  playlistFingerprintSha256: string | null;
  renditionFingerprintSha256: string | null;
}

export interface ExternalVodPersistedClockProofSet {
  schemaId: typeof EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA;
  proofSetId: string;
  platform: ExternalVodTransferPlatform;
  contentIdentitySha256: string;
  sourceVersionId: string;
  sourceDurationMs: number;
  metadataPartCount: number;
  parts: readonly ExternalVodPersistedPartClockProof[];
}

export interface ExternalVodHlsPartRuntime {
  kind: "hls";
  partIndex: number;
  timeline: ExternalVodHlsTimeline;
  /** Public CDN headers kept in memory only; never persisted in proof sets. */
  requestHeaders: Readonly<Record<string, string>>;
}

export interface ExternalVodDirectPartRuntime {
  kind: "direct";
  partIndex: number;
  clockProof: ExternalVodDirectClockProof;
  runtimeInputs: ExternalVodDirectRuntimeInputs;
}

export type ExternalVodPartRuntime =
  | ExternalVodHlsPartRuntime
  | ExternalVodDirectPartRuntime;

export interface ExternalVodClockProofSetResolution {
  persisted: ExternalVodPersistedClockProofSet;
  authoritative: {
    sourceDurationMs: number;
    parts: readonly ExternalVodClockMetadataPart[];
  };
  runtime: {
    parts: readonly ExternalVodPartRuntime[];
  };
}

/**
 * Runtime timelines used only by the completion-time CHZZK comparison.
 *
 * CHZZK may route the same finite HLS presentation through a different CDN
 * host/path between the acquisition probe and the completion probe. Those
 * locators deliberately remain runtime-only. Supplying both resolutions lets
 * the comparator prove the media-clock topology without treating that route
 * rotation (and IDs derived from it) as a source mutation.
 */
export interface ExternalVodClockProofCompletionContext {
  expectedRuntimeParts: readonly ExternalVodPartRuntime[];
  actualRuntimeParts: readonly ExternalVodPartRuntime[];
}

export interface ResolveExternalVodSelectedSourceDumpRequest {
  platform: ExternalVodTransferPlatform;
  contentId: string;
  partId: string;
  rawSelectedSourceJson: string;
  signal?: AbortSignal;
}

export interface ExternalVodSelectedSourceDumpDependencies {
  fetchImpl?: typeof globalThis.fetch;
  probeDirectInput: (
    input: ExternalVodSelectedDirectInput,
    kind: "video" | "audio",
    signal?: AbortSignal
  ) => Promise<string>;
}

export class ExternalVodClockResolverError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodClockResolverError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodClockResolverError(message, code);
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("외부 VOD 시간축 확인이 취소되었습니다.", "ABORTED");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safePublicId(value: string, label: string, code: string): string {
  if (typeof value !== "string" || !SAFE_PUBLIC_ID_PATTERN.test(value)) {
    fail(`${label} 식별자가 올바르지 않습니다.`, code);
  }
  return value;
}

function sha256Value(value: string, label: string, code: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, code);
  }
  return value;
}

function semanticIdentity(value: string, label: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_SEMANTIC_IDENTITY_LENGTH
    || value.trim() !== value
    || /[\0\r\n]/u.test(value)
    || /(?:^|[?&/;])(?:hdntl|hdnts|token|auth|authorization|signature|sig|expires?)=/iu
      .test(value)
  ) {
    fail(`${label} 의미 식별자가 올바르지 않습니다.`, "INVALID_SELECTED_SOURCE");
  }
  return value;
}

function checkedInteger(
  value: number,
  { minimum, maximum, label, code = "INVALID_CLOCK_METADATA" }: {
    minimum: number;
    maximum: number;
    label: string;
    code?: string;
  }
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, code);
  }
  return value;
}

function normalizedPart(
  part: ExternalVodClockMetadataPart,
  platform: ExternalVodTransferPlatform,
  sourceDurationMs: number,
  metadataPartCount: number
): ExternalVodClockMetadataPart {
  const partIndex = checkedInteger(part.partIndex, {
    minimum: 0,
    maximum: metadataPartCount - 1,
    label: "외부 VOD 파트 순번"
  });
  const sourceStartMs = checkedInteger(part.sourceStartMs, {
    minimum: 0,
    maximum: sourceDurationMs,
    label: "외부 VOD 파트 시작"
  });
  const sourceEndMs = checkedInteger(part.sourceEndMs, {
    minimum: sourceStartMs + 1,
    maximum: sourceDurationMs,
    label: "외부 VOD 파트 끝"
  });
  const durationMs = checkedInteger(part.durationMs, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS,
    label: "외부 VOD 파트 길이"
  });
  if (sourceEndMs - sourceStartMs !== durationMs) {
    fail("외부 VOD 파트의 전역 범위와 길이가 다릅니다.", "INVALID_CLOCK_METADATA");
  }
  const playlistItem = part.playlistItem;
  if (
    platform === "SOOP"
      ? (
        !Number.isSafeInteger(playlistItem)
        || Number(playlistItem) !== partIndex + 1
      )
      : playlistItem !== undefined
  ) {
    fail("외부 VOD 파트의 playlist identity가 올바르지 않습니다.", "INVALID_CLOCK_METADATA");
  }
  return {
    partIndex,
    ...(playlistItem !== undefined ? { playlistItem } : {}),
    partId: safePublicId(part.partId, "외부 VOD 파트", "INVALID_CLOCK_METADATA"),
    sourceStartMs,
    sourceEndMs,
    durationMs
  };
}

function durationTolerance(value: number | undefined): number {
  const tolerance = value ?? DEFAULT_EXTERNAL_VOD_PART_DURATION_TOLERANCE_MS;
  return checkedInteger(tolerance, {
    minimum: 0,
    maximum: MAX_EXTERNAL_VOD_PART_DURATION_TOLERANCE_MS,
    label: "외부 VOD 파트 길이 오차 상한"
  });
}

function authoritativePartForResolvedClock(
  platform: ExternalVodTransferPlatform,
  part: ExternalVodClockMetadataPart,
  resolvedDurationUs: number,
  toleranceMs: number
): ExternalVodClockMetadataPart {
  const metadataDurationUs = part.durationMs * 1_000;
  if (
    !Number.isSafeInteger(resolvedDurationUs)
    || resolvedDurationUs <= 0
  ) {
    fail(
      "선택 미디어의 시간축 길이가 올바르지 않습니다.",
      "SELECTED_SOURCE_DURATION_MISMATCH"
    );
  }
  if (platform === "SOOP") {
    const excessUs = resolvedDurationUs - metadataDurationUs;
    if (excessUs < 0 || excessUs >= 1_000_000) {
      fail(
        "SOOP HLS가 공식 파트 길이를 완전히 덮지 않거나 1초 이상 초과합니다.",
        "SELECTED_SOURCE_DURATION_MISMATCH"
      );
    }
    return part;
  }
  if (
    platform === "YOUTUBE"
    && (
      resolvedDurationUs > metadataDurationUs
      || metadataDurationUs - resolvedDurationUs > toleranceMs * 1_000
    )
  ) {
    fail(
      "YouTube 직접 입력 길이가 플레이어 메타데이터와 허용 범위 이상 다릅니다.",
      "SELECTED_SOURCE_DURATION_MISMATCH"
    );
  }
  const durationMs = Math.floor(resolvedDurationUs / 1_000);
  if (durationMs <= 0) {
    fail("선택 미디어의 안전한 밀리초 길이가 없습니다.", "SELECTED_SOURCE_DURATION_MISMATCH");
  }
  return {
    partIndex: part.partIndex,
    partId: part.partId,
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    durationMs
  };
}

function cloneHlsTimeline(
  timeline: ExternalVodHlsTimeline,
  platform: "CHZZK" | "SOOP"
): ExternalVodHlsTimeline {
  sha256Value(
    timeline.playlistFingerprintSha256,
    "HLS 재생목록",
    "INVALID_SELECTED_SOURCE"
  );
  sha256Value(
    timeline.renditionFingerprintSha256,
    "HLS rendition",
    "INVALID_SELECTED_SOURCE"
  );
  if (
    timeline.hasEndList !== true
    || timeline.hasIndependentSegments !== true
    || !Array.isArray(timeline.segments)
    || timeline.segments.length === 0
    || timeline.segments.length > 20_000
    || !Number.isSafeInteger(timeline.durationUs)
    || timeline.durationUs <= 0
  ) {
    fail("선택한 HLS 시간축이 완전한 VOD가 아닙니다.", "INVALID_SELECTED_SOURCE");
  }
  const playlistUrl = assertExternalVodTransferUrl(platform, timeline.playlistUri);
  const playlistSemanticUri = semanticIdentity(
    timeline.playlistSemanticUri ?? "",
    "HLS 재생목록"
  );
  if (playlistSemanticUri !== secretFreeExternalVodUrlIdentity(playlistUrl)) {
    fail("HLS 재생목록 URL과 의미 식별자가 다릅니다.", "SOURCE_CHANGED");
  }
  const mapUrl = assertExternalVodTransferUrl(platform, timeline.map.uri);
  const mapSemanticUri = semanticIdentity(timeline.map.semanticUri ?? "", "HLS 초기화 조각");
  if (mapSemanticUri !== secretFreeExternalVodUrlIdentity(mapUrl)) {
    fail("HLS 초기화 조각 URL과 의미 식별자가 다릅니다.", "SOURCE_CHANGED");
  }
  let expectedStartUs = 0;
  let previousSequence: number | undefined;
  const seenSemanticUris = new Set<string>();
  const segments = timeline.segments.map((segment) => {
    const sequence = checkedInteger(segment.sequence, {
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      label: "HLS 세그먼트 순번",
      code: "INVALID_SELECTED_SOURCE"
    });
    const startUs = checkedInteger(segment.startUs, {
      minimum: 0,
      maximum: timeline.durationUs,
      label: "HLS 세그먼트 시작",
      code: "INVALID_SELECTED_SOURCE"
    });
    const segmentDurationUs = checkedInteger(segment.durationUs, {
      minimum: 1,
      maximum: MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS * 1_000,
      label: "HLS 세그먼트 길이",
      code: "INVALID_SELECTED_SOURCE"
    });
    if (
      startUs !== expectedStartUs
      || (previousSequence !== undefined && sequence !== previousSequence + 1)
      || startUs + segmentDurationUs > timeline.durationUs
    ) {
      fail("HLS 세그먼트 시간축이 연속적이지 않습니다.", "INVALID_SELECTED_SOURCE");
    }
    const url = assertExternalVodTransferUrl(platform, segment.uri);
    const stableUri = semanticIdentity(segment.semanticUri ?? "", "HLS 세그먼트");
    if (
      stableUri !== secretFreeExternalVodUrlIdentity(url)
      || seenSemanticUris.has(stableUri)
    ) {
      fail("HLS 세그먼트 URL identity가 올바르지 않습니다.", "SOURCE_CHANGED");
    }
    seenSemanticUris.add(stableUri);
    expectedStartUs += segmentDurationUs;
    previousSequence = sequence;
    return {
      sequence,
      startUs,
      durationUs: segmentDurationUs,
      uri: url.href,
      semanticUri: stableUri,
      ...(segment.expectedSha256
        ? {
          expectedSha256: sha256Value(
            segment.expectedSha256,
            "HLS 세그먼트 콘텐츠",
            "INVALID_SELECTED_SOURCE"
          )
        }
        : {})
    };
  });
  if (expectedStartUs !== timeline.durationUs) {
    fail("HLS 세그먼트 합과 전체 길이가 다릅니다.", "INVALID_SELECTED_SOURCE");
  }
  const normalized: ExternalVodHlsTimeline = {
    playlistUri: playlistUrl.href,
    playlistSemanticUri,
    playlistFingerprintSha256: timeline.playlistFingerprintSha256,
    renditionFingerprintSha256: timeline.renditionFingerprintSha256,
    durationUs: timeline.durationUs,
    hasEndList: true,
    hasIndependentSegments: true,
    map: { uri: mapUrl.href, semanticUri: mapSemanticUri },
    segments
  };
  if (
    externalVodHlsPlaylistFingerprintSha256(normalized)
    !== normalized.playlistFingerprintSha256
  ) {
    fail("HLS 재생목록 지문이 시간축 본문과 다릅니다.", "INVALID_SELECTED_SOURCE");
  }
  return normalized;
}

function cloneDirectClockProof(
  proof: ExternalVodDirectClockProof
): ExternalVodDirectClockProof {
  sha256Value(proof.proofId, "직접 미디어 시간축 증명", "INVALID_SELECTED_SOURCE");
  if (
    proof.zeroOrigin !== true
    || proof.video.startUs !== 0
    || !Number.isSafeInteger(proof.playerDurationUs)
    || proof.playerDurationUs <= 0
    || !Number.isSafeInteger(proof.video.durationUs)
    || proof.video.durationUs <= 0
  ) {
    fail("직접 미디어의 0초 원점 증명이 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  sha256Value(
    proof.video.semanticIdentitySha256,
    "직접 비디오 의미 identity",
    "INVALID_SELECTED_SOURCE"
  );
  let audio: ExternalVodDirectClockProof["audio"];
  if (proof.audio !== undefined) {
    if (
      proof.audio.startUs !== 0
      || !Number.isSafeInteger(proof.audio.durationUs)
      || proof.audio.durationUs <= 0
    ) {
      fail("직접 오디오의 0초 원점 증명이 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
    }
    sha256Value(
      proof.audio.semanticIdentitySha256,
      "직접 오디오 의미 identity",
      "INVALID_SELECTED_SOURCE"
    );
    audio = {
      semanticIdentitySha256: proof.audio.semanticIdentitySha256,
      startUs: 0,
      durationUs: proof.audio.durationUs
    };
  }
  const normalized: ExternalVodDirectClockProof = {
    proofId: proof.proofId,
    playerDurationUs: proof.playerDurationUs,
    zeroOrigin: true,
    video: {
      semanticIdentitySha256: proof.video.semanticIdentitySha256,
      startUs: 0,
      durationUs: proof.video.durationUs
    },
    ...(audio ? { audio } : {})
  };
  if (externalVodDirectClockProofId(normalized) !== normalized.proofId) {
    fail("직접 미디어 시간축 증명 ID가 본문과 다릅니다.", "INVALID_SELECTED_SOURCE");
  }
  return normalized;
}

function safeRuntimeRequestHeaders(
  value: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const safe = safeExternalVodRequestHeaders(value);
  return Object.freeze(Object.fromEntries(
    Object.entries(safe).filter(([name]) => name !== "accept-encoding")
  ));
}

/**
 * Production adapter from selector-applied yt-dlp JSON to the injected union.
 * HLS transfer and direct ffprobe execution are kept behind bounded deps.
 */
export async function resolveExternalVodSelectedSourceDump(
  request: ResolveExternalVodSelectedSourceDumpRequest,
  dependencies: ExternalVodSelectedSourceDumpDependencies
): Promise<ExternalVodParsedSelectedSource> {
  abortIfRequested(request.signal);
  const selected = parseYtDlpSelectedInputsDump(
    request.rawSelectedSourceJson,
    {
      platform: request.platform,
      contentId: request.contentId,
      partId: request.partId
    }
  );
  if (selected.kind === "hls") {
    const fetched = await fetchExternalVodPlaylist({
      platform: selected.platform,
      url: selected.playlistUrl,
      requestHeaders: selected.publicHeaders,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    abortIfRequested(request.signal);
    const timeline = parseVodHlsMediaPlaylist(fetched.text, {
      playlistUrl: fetched.finalUrl,
      renditionFingerprintSha256: selected.format.selectedFormatProofId
    });
    return {
      kind: "hls",
      platform: selected.platform,
      contentId: selected.contentId,
      partId: selected.partId,
      formatIdentity: `format:${selected.format.selectedFormatProofId}`,
      timeline,
      requestHeaders: safeRuntimeRequestHeaders(selected.publicHeaders)
    };
  }
  const probe = async (
    input: ExternalVodSelectedDirectInput,
    kind: "video" | "audio"
  ): Promise<string> => {
    assertExternalVodTransferUrl("YOUTUBE", input.url);
    try {
      return await dependencies.probeDirectInput(input, kind, request.signal);
    } catch {
      abortIfRequested(request.signal);
      fail("YouTube 직접 입력 시간축을 확인하지 못했습니다.", "DIRECT_CLOCK_PROBE_FAILED");
    }
  };
  const videoPayload = await probe(selected.video, "video");
  const audioPayload = selected.audio
    ? await probe(selected.audio, "audio")
    : undefined;
  const parsed = parseDirectMediaFfprobeClockProof(
    selected as ExternalVodSelectedDirectInputs,
    {
      video: videoPayload,
      ...(audioPayload ? { audio: audioPayload } : {})
    }
  );
  return {
    kind: "direct",
    platform: "YOUTUBE",
    contentId: selected.contentId,
    partId: selected.partId,
    formatIdentity: `format:${selected.format.selectedFormatProofId}`,
    clockProof: parsed.clockProof,
    runtimeInputs: parsed.runtimeInputs
  };
}

function cloneDirectRuntimeInputs(
  inputs: ExternalVodDirectRuntimeInputs,
  proof: ExternalVodDirectClockProof
): ExternalVodDirectRuntimeInputs {
  if ((inputs.audio === undefined) !== (proof.audio === undefined)) {
    fail("직접 미디어의 증명·실행 오디오 구성이 다릅니다.", "SOURCE_CHANGED");
  }
  const cloneInput = (
    input: ExternalVodDirectRuntimeInputs["video"],
    inputProof: ExternalVodDirectClockProof["video"],
    kind: "video" | "audio"
  ) => {
    const url = assertExternalVodTransferUrl("YOUTUBE", input.url);
    const identity = semanticIdentity(input.semanticIdentity, `직접 ${kind}`);
    if (sha256(identity) !== inputProof.semanticIdentitySha256) {
      fail("직접 미디어 실행 입력이 시간축 증명과 다릅니다.", "SOURCE_CHANGED");
    }
    return {
      url: url.href,
      semanticIdentity: identity,
      publicHeaders: safeRuntimeRequestHeaders(input.publicHeaders)
    };
  };
  return {
    video: cloneInput(inputs.video, proof.video, "video"),
    ...(inputs.audio && proof.audio
      ? { audio: cloneInput(inputs.audio, proof.audio, "audio") }
      : {})
  };
}

function partProofId(
  proof: Omit<ExternalVodPersistedPartClockProof, "partProofId">
): string {
  return sha256(JSON.stringify(proof));
}

export function externalVodClockProofSetId(
  proof: Omit<ExternalVodPersistedClockProofSet, "proofSetId">
): string {
  return sha256(JSON.stringify(proof));
}

async function resolvePart(
  request: ResolveExternalVodClockProofSetRequest,
  part: ExternalVodClockMetadataPart,
  toleranceMs: number,
  dependencies: ExternalVodClockResolverDependencies
): Promise<{
  persisted: ExternalVodPersistedPartClockProof;
  runtime: ExternalVodPartRuntime;
  authoritativePart: ExternalVodClockMetadataPart;
}> {
  abortIfRequested(request.signal);
  let selected: ExternalVodParsedSelectedSource;
  try {
    selected = await dependencies.resolveSelectedPart(part, {
      platform: request.platform,
      contentId: request.contentId,
      ...(request.signal ? { signal: request.signal } : {})
    });
  } catch (error) {
    abortIfRequested(request.signal);
    if (error instanceof ExternalVodClockResolverError) {
      throw error;
    }
    fail("선택 미디어의 시간축을 확인하지 못했습니다.", "SELECTED_SOURCE_RESOLUTION_FAILED");
  }
  abortIfRequested(request.signal);
  if (
    selected.platform !== request.platform
    || selected.contentId !== request.contentId
    || selected.partId !== part.partId
  ) {
    fail("선택 미디어의 플랫폼·콘텐츠·파트 identity가 다릅니다.", "SOURCE_CHANGED");
  }
  const formatIdentity = semanticIdentity(selected.formatIdentity, "선택 포맷");
  const explicitFormatProof = /^format:([a-f0-9]{64})$/u.exec(formatIdentity);
  const formatIdentitySha256 = explicitFormatProof?.[1] ?? sha256(formatIdentity);

  if (selected.kind === "hls") {
    if (request.platform === "YOUTUBE") {
      fail("YouTube strict 취득에는 증명된 직접 입력이 필요합니다.", "UNSUPPORTED_SELECTED_SOURCE");
    }
    const timeline = cloneHlsTimeline(selected.timeline, selected.platform);
    const authoritativePart = authoritativePartForResolvedClock(
      request.platform,
      part,
      timeline.durationUs,
      toleranceMs
    );
    const sectionClock = createExternalVodSectionClockEvidence({
      platform: request.platform,
      contentId: request.contentId,
      partId: part.partId,
      partIndex: part.partIndex,
      ...(part.playlistItem !== undefined ? { playlistItem: part.playlistItem } : {}),
      selectedFormatProofId: formatIdentitySha256,
      timeline
    });
    const withoutId: Omit<ExternalVodPersistedPartClockProof, "partProofId"> = {
      schemaId: EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA,
      partIndex: part.partIndex,
      playlistItem: part.playlistItem ?? null,
      partIdentitySha256: sha256(part.partId),
      sourceStartMs: authoritativePart.sourceStartMs,
      sourceEndMs: authoritativePart.sourceEndMs,
      metadataDurationMs: part.durationMs,
      resolvedDurationUs: timeline.durationUs,
      transport: "HLS",
      formatIdentitySha256,
      clockProofId: sectionClock.evidenceId,
      playlistFingerprintSha256: timeline.playlistFingerprintSha256,
      renditionFingerprintSha256: timeline.renditionFingerprintSha256
    };
    return {
      persisted: { ...withoutId, partProofId: partProofId(withoutId) },
      runtime: {
        kind: "hls",
        partIndex: part.partIndex,
        timeline,
        requestHeaders: safeRuntimeRequestHeaders(selected.requestHeaders ?? {})
      },
      authoritativePart
    };
  }
  if (request.platform !== "YOUTUBE") {
    fail("CHZZK·SOOP strict 취득에는 증명된 HLS 입력이 필요합니다.", "UNSUPPORTED_SELECTED_SOURCE");
  }
  const clockProof = cloneDirectClockProof(selected.clockProof);
  const authoritativePart = authoritativePartForResolvedClock(
    request.platform,
    part,
    clockProof.playerDurationUs,
    toleranceMs
  );
  const runtimeInputs = cloneDirectRuntimeInputs(selected.runtimeInputs, clockProof);
  const withoutId: Omit<ExternalVodPersistedPartClockProof, "partProofId"> = {
    schemaId: EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA,
    partIndex: part.partIndex,
    playlistItem: null,
    partIdentitySha256: sha256(part.partId),
    sourceStartMs: authoritativePart.sourceStartMs,
    sourceEndMs: authoritativePart.sourceEndMs,
    metadataDurationMs: part.durationMs,
    resolvedDurationUs: clockProof.playerDurationUs,
    transport: "DIRECT",
    formatIdentitySha256,
    clockProofId: clockProof.proofId,
    playlistFingerprintSha256: null,
    renditionFingerprintSha256: null
  };
  return {
    persisted: { ...withoutId, partProofId: partProofId(withoutId) },
    runtime: {
      kind: "direct",
      partIndex: part.partIndex,
      clockProof,
      runtimeInputs
    },
    authoritativePart
  };
}

export async function resolveExternalVodClockProofSet(
  request: ResolveExternalVodClockProofSetRequest,
  dependencies: ExternalVodClockResolverDependencies
): Promise<ExternalVodClockProofSetResolution> {
  abortIfRequested(request.signal);
  const contentId = safePublicId(
    request.contentId,
    "외부 VOD 콘텐츠",
    "INVALID_CLOCK_METADATA"
  );
  const sourceVersionId = sha256Value(
    request.sourceVersionId,
    "외부 VOD source version",
    "INVALID_CLOCK_METADATA"
  );
  const sourceDurationMs = checkedInteger(request.sourceDurationMs, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS,
    label: "외부 VOD 전체 길이"
  });
  const metadataPartCount = checkedInteger(request.metadataPartCount, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_CLOCK_PARTS,
    label: "외부 VOD 전체 파트 수"
  });
  if (
    !Array.isArray(request.parts)
    || request.parts.length === 0
    || request.parts.length > metadataPartCount
  ) {
    fail("시간축을 확인할 외부 VOD 파트 목록이 올바르지 않습니다.", "INVALID_CLOCK_METADATA");
  }
  if (request.platform !== "SOOP" && metadataPartCount !== 1) {
    fail("단일 파트 플랫폼의 전체 파트 수가 올바르지 않습니다.", "INVALID_CLOCK_METADATA");
  }
  const parts = request.parts.map((part) => (
    normalizedPart(part, request.platform, sourceDurationMs, metadataPartCount)
  )).sort((left, right) => left.partIndex - right.partIndex);
  if (
    request.platform !== "SOOP"
    && (
      parts.length !== 1
      || parts[0]?.partIndex !== 0
      || parts[0]?.sourceStartMs !== 0
    )
  ) {
    fail("단일 파트 플랫폼의 시간축 파트 범위가 올바르지 않습니다.", "INVALID_CLOCK_METADATA");
  }
  const seen = new Set<number>();
  for (const part of parts) {
    if (seen.has(part.partIndex)) {
      fail("시간축 확인 파트가 중복되었습니다.", "INVALID_CLOCK_METADATA");
    }
    seen.add(part.partIndex);
  }
  const toleranceMs = durationTolerance(request.partDurationToleranceMs);
  const resolved: Array<{
    persisted: ExternalVodPersistedPartClockProof;
    runtime: ExternalVodPartRuntime;
    authoritativePart: ExternalVodClockMetadataPart;
  }> = [];
  for (const part of parts) {
    resolved.push(await resolvePart(
      { ...request, contentId, sourceVersionId, sourceDurationMs, metadataPartCount },
      part,
      toleranceMs,
      dependencies
    ));
  }
  const authoritativeParts = resolved.map(({ authoritativePart }) => authoritativePart);
  const authoritativeSourceDurationMs = request.platform === "SOOP"
    ? sourceDurationMs
    : authoritativeParts[0]?.durationMs;
  if (!authoritativeSourceDurationMs) {
    fail("권위 시간축 전체 길이를 확인하지 못했습니다.", "INVALID_SELECTED_SOURCE");
  }
  const withoutId: Omit<ExternalVodPersistedClockProofSet, "proofSetId"> = {
    schemaId: EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA,
    platform: request.platform,
    contentIdentitySha256: sha256(contentId),
    sourceVersionId,
    sourceDurationMs: authoritativeSourceDurationMs,
    metadataPartCount,
    parts: resolved.map(({ persisted }) => persisted)
  };
  return {
    persisted: { ...withoutId, proofSetId: externalVodClockProofSetId(withoutId) },
    authoritative: {
      sourceDurationMs: authoritativeSourceDurationMs,
      parts: authoritativeParts
    },
    runtime: { parts: resolved.map(({ runtime }) => runtime) }
  };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} 문서가 올바르지 않습니다.`, "INVALID_CLOCK_PROOF_SET");
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} 필드 구성이 올바르지 않습니다.`, "INVALID_CLOCK_PROOF_SET");
  }
}

function parsedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_CLOCK_PROOF_SET");
  }
  return Number(value);
}

function parsedSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, "INVALID_CLOCK_PROOF_SET");
  }
  return value;
}

export function parseExternalVodPersistedPartClockProof(
  value: unknown
): ExternalVodPersistedPartClockProof {
  const parsed = record(value, "외부 VOD 파트 시간축 증거");
  exactKeys(parsed, [
    "schemaId",
    "partProofId",
    "partIndex",
    "playlistItem",
    "partIdentitySha256",
    "sourceStartMs",
    "sourceEndMs",
    "metadataDurationMs",
    "resolvedDurationUs",
    "transport",
    "formatIdentitySha256",
    "clockProofId",
    "playlistFingerprintSha256",
    "renditionFingerprintSha256"
  ], "외부 VOD 파트 시간축 증거");
  if (
    parsed.schemaId !== EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA
    || (parsed.transport !== "HLS" && parsed.transport !== "DIRECT")
  ) {
    fail("외부 VOD 파트 시간축 증거 종류가 올바르지 않습니다.", "INVALID_CLOCK_PROOF_SET");
  }
  const partIndex = parsedInteger(parsed.partIndex, 0, MAX_EXTERNAL_VOD_CLOCK_PARTS - 1, "파트 순번");
  let playlistItem: number | null;
  if (parsed.playlistItem === null) {
    playlistItem = null;
  } else {
    playlistItem = parsedInteger(parsed.playlistItem, 1, MAX_EXTERNAL_VOD_CLOCK_PARTS, "playlist item");
  }
  const sourceStartMs = parsedInteger(
    parsed.sourceStartMs,
    0,
    MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS,
    "파트 시작"
  );
  const sourceEndMs = parsedInteger(
    parsed.sourceEndMs,
    sourceStartMs + 1,
    MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS,
    "파트 끝"
  );
  const metadataDurationMs = parsedInteger(
    parsed.metadataDurationMs,
    1,
    MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS,
    "파트 메타데이터 길이"
  );
  const resolvedDurationUs = parsedInteger(
    parsed.resolvedDurationUs,
    1,
    MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS * 1_000,
    "파트 resolved 길이"
  );
  const authoritativeDurationMs = sourceEndMs - sourceStartMs;
  if (
    authoritativeDurationMs !== metadataDurationMs
    && authoritativeDurationMs !== Math.floor(resolvedDurationUs / 1_000)
  ) {
    fail("파트 증거의 권위 범위와 길이가 다릅니다.", "INVALID_CLOCK_PROOF_SET");
  }
  const playlistFingerprintSha256 = parsed.playlistFingerprintSha256 === null
    ? null
    : parsedSha256(parsed.playlistFingerprintSha256, "HLS 재생목록");
  const renditionFingerprintSha256 = parsed.renditionFingerprintSha256 === null
    ? null
    : parsedSha256(parsed.renditionFingerprintSha256, "HLS rendition");
  if (
    parsed.transport === "HLS"
      ? playlistFingerprintSha256 === null || renditionFingerprintSha256 === null
      : playlistFingerprintSha256 !== null || renditionFingerprintSha256 !== null
  ) {
    fail("파트 전송 종류와 HLS 지문 구성이 다릅니다.", "INVALID_CLOCK_PROOF_SET");
  }
  const withoutId: Omit<ExternalVodPersistedPartClockProof, "partProofId"> = {
    schemaId: EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA,
    partIndex,
    playlistItem,
    partIdentitySha256: parsedSha256(parsed.partIdentitySha256, "파트 identity"),
    sourceStartMs,
    sourceEndMs,
    metadataDurationMs,
    resolvedDurationUs,
    transport: parsed.transport,
    formatIdentitySha256: parsedSha256(parsed.formatIdentitySha256, "포맷 identity"),
    clockProofId: parsedSha256(parsed.clockProofId, "파트 시간축"),
    playlistFingerprintSha256,
    renditionFingerprintSha256
  };
  const expectedId = partProofId(withoutId);
  if (parsedSha256(parsed.partProofId, "파트 증거") !== expectedId) {
    fail("외부 VOD 파트 증거 ID가 본문과 다릅니다.", "INVALID_CLOCK_PROOF_SET");
  }
  return { ...withoutId, partProofId: expectedId };
}

export function assertExternalVodHlsAcquisitionMatchesPartProof(
  partValue: unknown,
  acquisitionValue: unknown
): ExternalVodHlsPersistedClockEvidence {
  const part = parseExternalVodPersistedPartClockProof(partValue);
  const acquisition = parseExternalVodHlsPersistedClockEvidence(acquisitionValue);
  if (
    part.transport !== "HLS"
    || part.partProofId !== acquisition.partProofId
    || part.clockProofId !== acquisition.clockProofId
    || part.playlistFingerprintSha256 !== acquisition.playlistFingerprintSha256
    || part.renditionFingerprintSha256 !== acquisition.renditionFingerprintSha256
    || acquisition.sourceStartUs < 0
    || acquisition.sourceEndUs > part.resolvedDurationUs
  ) {
    fail("HLS 취득 증거가 선택 파트 시간축과 다릅니다.", "SOURCE_CHANGED");
  }
  return acquisition;
}

export function assertExternalVodDirectAcquisitionMatchesPartProof(
  partValue: unknown,
  acquisitionValue: unknown
): ExternalVodDirectSectionEvidence {
  const part = parseExternalVodPersistedPartClockProof(partValue);
  const acquisition = parseExternalVodDirectSectionEvidence(acquisitionValue);
  if (
    part.transport !== "DIRECT"
    || part.partProofId !== acquisition.partProofId
    || part.clockProofId !== acquisition.clockProofId
    || acquisition.sourceStartUs < 0
    || acquisition.sourceEndUs > part.resolvedDurationUs
  ) {
    fail("직접 취득 증거가 선택 파트 시간축과 다릅니다.", "SOURCE_CHANGED");
  }
  return acquisition;
}

export function parseExternalVodPersistedClockProofSet(
  value: unknown
): ExternalVodPersistedClockProofSet {
  const parsed = record(value, "외부 VOD 시간축 증거 세트");
  exactKeys(parsed, [
    "schemaId",
    "proofSetId",
    "platform",
    "contentIdentitySha256",
    "sourceVersionId",
    "sourceDurationMs",
    "metadataPartCount",
    "parts"
  ], "외부 VOD 시간축 증거 세트");
  if (
    parsed.schemaId !== EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA
    || (parsed.platform !== "CHZZK" && parsed.platform !== "YOUTUBE" && parsed.platform !== "SOOP")
    || !Array.isArray(parsed.parts)
    || parsed.parts.length === 0
    || parsed.parts.length > MAX_EXTERNAL_VOD_CLOCK_PARTS
  ) {
    fail("외부 VOD 시간축 증거 세트 종류가 올바르지 않습니다.", "INVALID_CLOCK_PROOF_SET");
  }
  const metadataPartCount = parsedInteger(
    parsed.metadataPartCount,
    1,
    MAX_EXTERNAL_VOD_CLOCK_PARTS,
    "전체 파트 수"
  );
  if (parsed.parts.length > metadataPartCount) {
    fail("증거 파트 수가 전체 파트 수를 넘습니다.", "INVALID_CLOCK_PROOF_SET");
  }
  const sourceDurationMs = parsedInteger(
    parsed.sourceDurationMs,
    1,
    MAX_EXTERNAL_VOD_CLOCK_SOURCE_MS,
    "전체 길이"
  );
  const parts = parsed.parts.map(parseExternalVodPersistedPartClockProof);
  if (parsed.platform !== "SOOP" && (metadataPartCount !== 1 || parts.length !== 1)) {
    fail("단일 파트 플랫폼의 증거 파트 수가 올바르지 않습니다.", "INVALID_CLOCK_PROOF_SET");
  }
  for (const [index, part] of parts.entries()) {
    if (index > 0 && (parts[index - 1]?.partIndex ?? -1) >= part.partIndex) {
      fail("증거 파트 순서가 중복되거나 정렬되지 않았습니다.", "INVALID_CLOCK_PROOF_SET");
    }
    if (part.partIndex >= metadataPartCount) {
      fail("증거 파트 순번이 전체 파트 수를 벗어났습니다.", "INVALID_CLOCK_PROOF_SET");
    }
    if (parsed.platform !== "SOOP" && part.partIndex !== 0) {
      fail("단일 파트 플랫폼의 증거 파트 순번이 올바르지 않습니다.", "INVALID_CLOCK_PROOF_SET");
    }
    if (
      parsed.platform === "SOOP"
        ? part.playlistItem !== part.partIndex + 1
        : part.playlistItem !== null
    ) {
      fail("증거 파트 playlist identity가 플랫폼과 다릅니다.", "INVALID_CLOCK_PROOF_SET");
    }
    if (
      parsed.platform === "YOUTUBE"
        ? part.transport !== "DIRECT"
        : part.transport !== "HLS"
    ) {
      fail("증거 전송 종류가 플랫폼과 다릅니다.", "INVALID_CLOCK_PROOF_SET");
    }
    if (part.sourceEndMs > sourceDurationMs) {
      fail("파트 권위 범위가 전체 길이를 벗어났습니다.", "INVALID_CLOCK_PROOF_SET");
    }
    const metadataDurationUs = part.metadataDurationMs * 1_000;
    if (parsed.platform === "SOOP") {
      const excessUs = part.resolvedDurationUs - metadataDurationUs;
      if (
        part.sourceEndMs - part.sourceStartMs !== part.metadataDurationMs
        || excessUs < 0
        || excessUs >= 1_000_000
      ) {
        fail("SOOP 파트 권위 길이 증거가 올바르지 않습니다.", "INVALID_CLOCK_PROOF_SET");
      }
    } else if (
      part.sourceStartMs !== 0
      || part.sourceEndMs !== Math.floor(part.resolvedDurationUs / 1_000)
      || part.sourceEndMs !== sourceDurationMs
      || (
        parsed.platform === "YOUTUBE"
        && (
          part.resolvedDurationUs > metadataDurationUs
          || metadataDurationUs - part.resolvedDurationUs
            > MAX_EXTERNAL_VOD_PART_DURATION_TOLERANCE_MS * 1_000
        )
      )
    ) {
      fail("단일 파트 권위 길이 증거가 올바르지 않습니다.", "INVALID_CLOCK_PROOF_SET");
    }
  }
  const withoutId: Omit<ExternalVodPersistedClockProofSet, "proofSetId"> = {
    schemaId: EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA,
    platform: parsed.platform,
    contentIdentitySha256: parsedSha256(parsed.contentIdentitySha256, "콘텐츠 identity"),
    sourceVersionId: parsedSha256(parsed.sourceVersionId, "source version"),
    sourceDurationMs,
    metadataPartCount,
    parts
  };
  const expectedId = externalVodClockProofSetId(withoutId);
  if (parsedSha256(parsed.proofSetId, "시간축 증거 세트") !== expectedId) {
    fail("외부 VOD 시간축 증거 세트 ID가 본문과 다릅니다.", "INVALID_CLOCK_PROOF_SET");
  }
  return { ...withoutId, proofSetId: expectedId };
}

function chzzkCompletionSourceChanged(): never {
  fail("CHZZK VOD 선택 미디어 시간축이 작업 중 바뀌었습니다.", "SOURCE_CHANGED");
}

function chzzkCompletionProofFieldsMatch(
  expected: ExternalVodPersistedClockProofSet,
  actual: ExternalVodPersistedClockProofSet
): boolean {
  return expected.platform === "CHZZK"
    && actual.platform === "CHZZK"
    && expected.contentIdentitySha256 === actual.contentIdentitySha256
    && expected.sourceVersionId === actual.sourceVersionId
    && expected.sourceDurationMs === actual.sourceDurationMs
    && expected.metadataPartCount === actual.metadataPartCount
    && expected.parts.length === actual.parts.length
    && expected.parts.every((part, index) => {
      const candidate = actual.parts[index];
      return candidate !== undefined
        && part.schemaId === candidate.schemaId
        && part.partIndex === candidate.partIndex
        && part.playlistItem === candidate.playlistItem
        && part.partIdentitySha256 === candidate.partIdentitySha256
        && part.sourceStartMs === candidate.sourceStartMs
        && part.sourceEndMs === candidate.sourceEndMs
        && part.metadataDurationMs === candidate.metadataDurationMs
        && part.resolvedDurationUs === candidate.resolvedDurationUs
        && part.transport === "HLS"
        && candidate.transport === "HLS"
        && part.formatIdentitySha256 === candidate.formatIdentitySha256
        && part.renditionFingerprintSha256
          === candidate.renditionFingerprintSha256;
      // playlistFingerprintSha256, clockProofId, partProofId and proofSetId
      // include the CDN locator. Their self-consistency is still validated by
      // the parsers above; only equality across the two probes is irrelevant.
    });
}

function chzzkCompletionRuntimeTimelines(
  runtimeParts: readonly ExternalVodPartRuntime[],
  proofSet: ExternalVodPersistedClockProofSet
): ReadonlyMap<number, ExternalVodHlsTimeline> {
  if (!Array.isArray(runtimeParts) || runtimeParts.length !== proofSet.parts.length) {
    chzzkCompletionSourceChanged();
  }
  const timelines = new Map<number, ExternalVodHlsTimeline>();
  for (const runtime of runtimeParts) {
    if (
      !runtime
      || runtime.kind !== "hls"
      || timelines.has(runtime.partIndex)
    ) {
      chzzkCompletionSourceChanged();
    }
    const part = proofSet.parts.find((candidate) => (
      candidate.partIndex === runtime.partIndex
    ));
    if (!part || part.transport !== "HLS") {
      chzzkCompletionSourceChanged();
    }
    const timeline = cloneHlsTimeline(runtime.timeline, "CHZZK");
    if (
      timeline.durationUs !== part.resolvedDurationUs
      || timeline.playlistFingerprintSha256
        !== part.playlistFingerprintSha256
      || timeline.renditionFingerprintSha256
        !== part.renditionFingerprintSha256
    ) {
      chzzkCompletionSourceChanged();
    }
    timelines.set(runtime.partIndex, timeline);
  }
  return timelines;
}

function chzzkCompletionTimelineTopologyMatches(
  expected: ExternalVodHlsTimeline,
  actual: ExternalVodHlsTimeline
): boolean {
  return expected.durationUs === actual.durationUs
    && expected.hasEndList === actual.hasEndList
    && expected.hasIndependentSegments === actual.hasIndependentSegments
    && expected.renditionFingerprintSha256
      === actual.renditionFingerprintSha256
    && expected.segments.length === actual.segments.length
    && expected.segments.every((segment, index) => {
      const candidate = actual.segments[index];
      return candidate !== undefined
        && segment.sequence === candidate.sequence
        && segment.startUs === candidate.startUs
        && segment.durationUs === candidate.durationUs
        && (segment.expectedSha256 ?? null)
          === (candidate.expectedSha256 ?? null);
    });
}

/**
 * Completion-time source check.
 *
 * YouTube direct media and SOOP retain exact proof-set equality. CHZZK also
 * remains exact unless both validated runtime timelines are supplied; only
 * then may CDN locator-derived IDs rotate, while every semantic source,
 * format, duration and segment-clock field stays fail-closed.
 */
export function assertExternalVodClockProofSetUnchanged(
  expectedValue: unknown,
  actualValue: unknown,
  completionContext?: ExternalVodClockProofCompletionContext
): ExternalVodPersistedClockProofSet {
  const expected = parseExternalVodPersistedClockProofSet(expectedValue);
  const actual = parseExternalVodPersistedClockProofSet(actualValue);
  if (
    expected.platform !== "CHZZK"
    || actual.platform !== "CHZZK"
  ) {
    if (expected.proofSetId !== actual.proofSetId) {
      fail("외부 VOD 선택 미디어 시간축이 작업 중 바뀌었습니다.", "SOURCE_CHANGED");
    }
    return actual;
  }
  if (!completionContext) {
    if (expected.proofSetId !== actual.proofSetId) {
      chzzkCompletionSourceChanged();
    }
    return actual;
  }
  if (!chzzkCompletionProofFieldsMatch(expected, actual)) {
    chzzkCompletionSourceChanged();
  }
  const expectedTimelines = chzzkCompletionRuntimeTimelines(
    completionContext.expectedRuntimeParts,
    expected
  );
  const actualTimelines = chzzkCompletionRuntimeTimelines(
    completionContext.actualRuntimeParts,
    actual
  );
  for (const part of expected.parts) {
    const expectedTimeline = expectedTimelines.get(part.partIndex);
    const actualTimeline = actualTimelines.get(part.partIndex);
    if (
      !expectedTimeline
      || !actualTimeline
      || !chzzkCompletionTimelineTopologyMatches(
        expectedTimeline,
        actualTimeline
      )
    ) {
      chzzkCompletionSourceChanged();
    }
  }
  if (expectedTimelines.size !== actualTimelines.size) {
    fail("외부 VOD 선택 미디어 시간축이 작업 중 바뀌었습니다.", "SOURCE_CHANGED");
  }
  return actual;
}
