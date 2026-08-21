import {
  localEngineDocumentClientNonce,
  normalizeCaptionAgentEndpoint
} from "./caption-agent.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  normalizeChzzkVodMaterialization
} from "../lib/chzzk-vod-materialization.js";
import {
  SOURCE_PLATFORM_SOOP,
  inferSourceIdentifiers
} from "../lib/source-platform.js";
import {
  normalizeSoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";
import type {
  SoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";
import {
  localMediaEngineTransportFetch
} from "./local-media-engine-transport.js";

export const CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA =
  "chzzk-kirinuki-vod-materialization-request/v3";
export const CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA =
  "chzzk-kirinuki-vod-materialization-status/v1";
export const CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA =
  "chzzk-kirinuki-vod-cache-purge-request/v1";
export const CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA =
  "chzzk-kirinuki-vod-cache-purge-result/v1";
export const CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA =
  "chzzk-kirinuki-vod-consumer-cache-purge-request/v1";
export const CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA =
  "chzzk-kirinuki-vod-consumer-cache-purge-result/v1";
export const CHZZK_VOD_HANDLE_MS = 10_000;
export const KIRINUKI_MEDIA_ENGINE_ENDPOINT =
  "http://127.0.0.1:4319/v1/captions";
export const CHZZK_VOD_POLL_INTERVAL_MS = 500;
export const CHZZK_VOD_MAX_STATUS_BYTES = 2 * 1024 * 1024;

type FetchImplementation = typeof fetch;
type JsonRecord = Record<string, unknown>;

export type ChzzkVodJobState =
  | "queued"
  | "resolving"
  | "planning"
  | "downloading"
  | "verifying"
  | "muxing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChzzkVodClipRequest {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ChzzkVodResumeReference {
  materializationId: string;
  planFingerprint: string;
  contentId: string;
}

export interface ChzzkVodEditableRangeRequest {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ChzzkVodLocalMedia {
  url: string;
  name: string;
  size: number;
  type: "video/mp4";
  lastModified: number;
}

export interface ChzzkVodMaterializationStatus {
  schema: typeof CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA;
  jobId: string;
  state: ChzzkVodJobState;
  progress: number;
  message: string;
  reused: boolean;
  materialization?: unknown;
  media?: ChzzkVodLocalMedia;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Terminal/API failures retain the media engine's stable public code so callers
 * can choose a semantic recovery action without parsing Korean display text.
 */
export class ChzzkVodMaterializationClientError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "ChzzkVodMaterializationClientError";
    this.code = code;
    this.status = status;
  }
}

export interface ChzzkVodCachePurgeResult {
  schema: typeof CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA;
  jobId: string;
  state: "purged";
  alreadyPurged: boolean;
  releasedBytes: number;
  materialization: {
    materializationId: string;
    planFingerprint: string;
  };
  source: {
    platform: "CHZZK" | "YOUTUBE" | "SOOP";
    contentId: string;
    sourceVersionId: string;
  };
}

export interface ChzzkVodConsumerCachePurgeResult {
  schema: typeof CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA;
  jobId: string;
  consumerId: string;
  state: "purged";
  alreadyPurged: boolean;
  releasedBytes: number;
  releasedFiles: number;
  materialization: ChzzkVodCachePurgeResult["materialization"];
  source: ChzzkVodCachePurgeResult["source"];
}

interface MaterializationConnectionOptions {
  endpoint: unknown;
  token: unknown;
  signal?: AbortSignal;
  fetchImpl?: FetchImplementation;
}

export interface StartChzzkVodMaterializationOptions
  extends MaterializationConnectionOptions {
  /** Stable logical edit-session identity. It scopes only local cache files. */
  consumerId: unknown;
  sourceUrl: unknown;
  sourceClockIdentity?: unknown;
  clips: readonly ChzzkVodClipRequest[];
  rightsConfirmed: boolean;
  handleMs?: number;
  editableRanges?: readonly ChzzkVodEditableRangeRequest[];
  resume?: ChzzkVodResumeReference;
  base?: ChzzkVodResumeReference;
}

function normalizedRequestSourceClockIdentity(
  value: unknown,
  sourceUrl: string
): SoopVodSourceClockIdentity | undefined {
  const source = inferSourceIdentifiers(sourceUrl);
  if (source.platform !== SOURCE_PLATFORM_SOOP) {
    if (value !== undefined && value !== null) {
      throw new Error("SOOP이 아닌 원본에는 SOOP VOD 시계 증명을 보낼 수 없습니다.");
    }
    return undefined;
  }
  const identity = normalizeSoopVodSourceClockIdentity(value);
  if (value !== undefined && value !== null && (
    !identity || identity.contentId !== source.contentId
  )) {
    throw new Error(
      "SOOP 공식 VOD part 시계 증명이 현재 원본과 맞지 않습니다."
    );
  }
  // The installed engine derives the complete official part clock itself.
  // A legacy player-derived identity is only an additional exact assertion.
  return identity ?? undefined;
}

export interface WaitForChzzkVodMaterializationOptions
  extends MaterializationConnectionOptions {
  jobId: unknown;
  pollIntervalMs?: number;
  onProgress?: (status: ChzzkVodMaterializationStatus) => void;
}

export interface PurgeChzzkVodMaterializedCacheOptions
  extends MaterializationConnectionOptions {
  mediaUrl: unknown;
  materialization: unknown;
}

export interface PurgeChzzkVodConsumerSessionCacheOptions
  extends PurgeChzzkVodMaterializedCacheOptions {
  consumerId: unknown;
}

const CHZZK_VOD_JOB_STATES = new Set<ChzzkVodJobState>([
  "queued",
  "resolving",
  "planning",
  "downloading",
  "verifying",
  "muxing",
  "completed",
  "failed",
  "cancelled"
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCacheConsumerId(value: unknown): string {
  const consumerId = String(value ?? "").normalize("NFC").trim();
  if (
    !consumerId
    || consumerId.length > 256
    || new TextEncoder().encode(consumerId).byteLength > 1_024
    || /[\u0000-\u001f\u007f-\u009f]/u.test(consumerId)
  ) {
    throw new Error("로컬 VOD 캐시 사용 세션 ID가 올바르지 않습니다.");
  }
  return consumerId;
}

function boundedString(
  value: unknown,
  label: string,
  maximum = 2_048
): string {
  const normalized = String(value || "").trim();
  if (
    !normalized
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(`Kirinuki 내부 미디어 엔진의 ${label} 값이 올바르지 않습니다.`);
  }
  return normalized;
}

function normalizedPublicErrorCode(
  value: unknown,
  fallback = "MATERIALIZATION_FAILED"
): string {
  const code = String(value ?? "").trim();
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(code) ? code : fallback;
}

function normalizeToken(value: unknown): string {
  const token = String(value || "").trim();
  if (!token || token.length > 4_096 || /[\s\u0000-\u001f\u007f]/u.test(token)) {
    throw new Error("Kirinuki 내부 미디어 세션 토큰이 필요합니다.");
  }
  return token;
}

function normalizeJobId(value: unknown): string {
  const jobId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,128}$/u.test(jobId)) {
    throw new Error("로컬 VOD 작업 ID가 올바르지 않습니다.");
  }
  return jobId;
}

function normalizeClipRequests(
  clips: readonly ChzzkVodClipRequest[]
): ChzzkVodClipRequest[] {
  if (!Array.isArray(clips) || clips.length === 0 || clips.length > 500) {
    throw new Error("준비할 VOD 컷은 1개 이상 500개 이하여야 합니다.");
  }
  const ids = new Set<string>();
  return clips.map((clip) => {
    const id = String(clip?.id || "").trim();
    const startMs = Number(clip?.startMs);
    const endMs = Number(clip?.endMs);
    if (
      !id
      || id.length > 160
      || ids.has(id)
      || !Number.isSafeInteger(startMs)
      || !Number.isSafeInteger(endMs)
      || startMs < 0
      || endMs <= startMs
    ) {
      throw new Error("준비할 VOD 컷 범위가 올바르지 않습니다.");
    }
    ids.add(id);
    return { id, startMs, endMs };
  });
}

function normalizeResumeReference(
  value: ChzzkVodResumeReference | undefined
): ChzzkVodResumeReference | undefined {
  if (value === undefined) {
    return undefined;
  }
  const materializationId = String(value.materializationId || "").trim();
  const planFingerprint = String(value.planFingerprint || "").trim();
  const contentId = String(value.contentId || "").trim();
  if (
    !/^[a-f0-9]{32}$/u.test(materializationId)
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
  ) {
    throw new Error("다시 열 로컬 VOD 작업 정보가 올바르지 않습니다.");
  }
  return { materializationId, planFingerprint, contentId };
}

function normalizeEditableRangeRequests(
  ranges: readonly ChzzkVodEditableRangeRequest[] | undefined,
  clips: readonly ChzzkVodClipRequest[]
): ChzzkVodEditableRangeRequest[] | undefined {
  if (ranges === undefined) {
    return undefined;
  }
  if (!Array.isArray(ranges) || ranges.length !== clips.length) {
    throw new Error("확장 편집 범위는 모든 VOD 컷에 정확히 하나씩 있어야 합니다.");
  }
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const ids = new Set<string>();
  return ranges.map((range) => {
    const id = String(range?.id || "").trim();
    const startMs = Number(range?.startMs);
    const endMs = Number(range?.endMs);
    const clip = clipsById.get(id);
    if (
      !clip
      || ids.has(id)
      || !Number.isSafeInteger(startMs)
      || !Number.isSafeInteger(endMs)
      || startMs < 0
      || endMs <= startMs
      || startMs > clip.startMs
      || endMs < clip.endMs
    ) {
      throw new Error("확장 편집 범위가 원래 VOD 선택을 포함하지 않습니다.");
    }
    ids.add(id);
    return { id, startMs, endMs };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function chzzkVodMaterializationEndpoint(endpoint: unknown): string {
  const url = new URL(normalizeCaptionAgentEndpoint(endpoint));
  url.pathname = "/v1/vod/materializations";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function chzzkVodJobEndpoint(endpoint: unknown, jobId: unknown): string {
  const url = new URL(chzzkVodMaterializationEndpoint(endpoint));
  url.pathname = `${url.pathname}/${encodeURIComponent(normalizeJobId(jobId))}`;
  return url.toString();
}

function chzzkVodCachePurgeEndpoint(
  endpoint: unknown,
  jobId: unknown
): string {
  const url = new URL(chzzkVodJobEndpoint(endpoint, jobId));
  url.pathname = `${url.pathname}/cache`;
  return url.toString();
}

function chzzkVodConsumerCachePurgeEndpoint(
  endpoint: unknown,
  jobId: unknown
): string {
  const url = new URL(chzzkVodJobEndpoint(endpoint, jobId));
  url.pathname = `${url.pathname}/session-cache`;
  return url.toString();
}

function cachePurgeRequestIdentity(
  endpoint: unknown,
  mediaUrl: unknown,
  materializationValue: unknown
): {
  jobId: string;
  mediaAccess: string;
  body: Record<string, unknown>;
} {
  const expectedOrigin = new URL(chzzkVodMaterializationEndpoint(endpoint));
  let media: URL;
  try {
    media = new URL(String(mediaUrl || ""));
  } catch {
    throw new Error("삭제할 로컬 VOD 미디어 주소가 올바르지 않습니다.");
  }
  const pathMatch = /^\/v1\/vod\/media\/([a-zA-Z0-9_-]{16,128})$/u
    .exec(media.pathname);
  const mediaAccess = String(media.searchParams.get("access") || "").trim();
  if (
    media.protocol !== "http:"
    || (media.hostname !== "127.0.0.1" && media.hostname !== "localhost")
    || (expectedOrigin.hostname !== "127.0.0.1"
      && expectedOrigin.hostname !== "localhost")
    || media.port !== expectedOrigin.port
    || !pathMatch
    || media.username
    || media.password
    || media.hash
    || [...media.searchParams.keys()].some((key) => key !== "access")
    || !mediaAccess
    || mediaAccess.length > 4_096
    || /[\s\u0000-\u001f\u007f]/u.test(mediaAccess)
  ) {
    throw new Error("삭제할 로컬 VOD 미디어의 보안 범위가 올바르지 않습니다.");
  }
  const jobId = normalizeJobId(pathMatch[1]);
  const materialization = normalizeChzzkVodMaterialization(
    materializationValue
  );
  if (
    !materialization
    || materialization.schema !== CHZZK_VOD_MATERIALIZATION_SCHEMA
    || !materialization.source.sourceVersionId
  ) {
    throw new Error("삭제할 완료 VOD의 exact source identity가 없습니다.");
  }
  return {
    jobId,
    mediaAccess,
    body: {
      schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
      jobId,
      materialization: {
        materializationId: materialization.materializationId,
        planFingerprint: materialization.planFingerprint
      },
      source: {
        platform: materialization.source.platform,
        contentId: materialization.source.contentId,
        sourceVersionId: materialization.source.sourceVersionId
      }
    }
  };
}

function consumerCachePurgeRequestIdentity(
  endpoint: unknown,
  mediaUrl: unknown,
  materializationValue: unknown,
  consumerIdValue: unknown
): {
  jobId: string;
  mediaAccess: string;
  body: Record<string, unknown>;
} {
  const exact = cachePurgeRequestIdentity(
    endpoint,
    mediaUrl,
    materializationValue
  );
  return {
    jobId: exact.jobId,
    mediaAccess: exact.mediaAccess,
    body: {
      ...exact.body,
      schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
      consumerId: normalizeCacheConsumerId(consumerIdValue)
    }
  };
}

function normalizeLocalMedia(
  value: unknown,
  mediaEngineEndpoint: unknown,
  jobId: string
): ChzzkVodLocalMedia {
  if (!isRecord(value)) {
    throw new Error("로컬 VOD 미디어 정보가 없습니다.");
  }
  const expectedOrigin = new URL(
    chzzkVodMaterializationEndpoint(mediaEngineEndpoint)
  );
  let url: URL;
  try {
    url = new URL(String(value.url || ""));
  } catch {
    throw new Error("로컬 VOD 미디어 주소가 올바르지 않습니다.");
  }
  const expectedPath = `/v1/vod/media/${encodeURIComponent(jobId)}`;
  if (
    url.protocol !== "http:"
    || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    || (expectedOrigin.hostname !== "127.0.0.1"
      && expectedOrigin.hostname !== "localhost")
    || url.port !== expectedOrigin.port
    || url.pathname !== expectedPath
    || url.username
    || url.password
    || url.hash
    || [...url.searchParams.keys()].some((key) => key !== "access")
    || !url.searchParams.get("access")
  ) {
    throw new Error("로컬 VOD 미디어 주소의 보안 범위가 올바르지 않습니다.");
  }
  const size = Math.round(Number(value.size));
  const lastModified = Math.round(Number(value.lastModified));
  if (
    !Number.isSafeInteger(size)
    || size <= 0
    || !Number.isSafeInteger(lastModified)
    || lastModified <= 0
    || value.type !== "video/mp4"
  ) {
    throw new Error("로컬 VOD 미디어 메타데이터가 올바르지 않습니다.");
  }
  return {
    url: url.toString(),
    name: boundedString(value.name, "파일명", 240),
    size,
    type: "video/mp4",
    lastModified
  };
}

export function normalizeChzzkVodMaterializationStatus(
  value: unknown,
  mediaEngineEndpoint: unknown
): ChzzkVodMaterializationStatus {
  if (!isRecord(value) || value.schema !== CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA) {
    throw new Error("Kirinuki 내부 미디어 엔진 응답 버전이 맞지 않습니다.");
  }
  const jobId = normalizeJobId(value.jobId);
  const state = String(value.state || "") as ChzzkVodJobState;
  if (!CHZZK_VOD_JOB_STATES.has(state)) {
    throw new Error("로컬 VOD 작업 상태가 올바르지 않습니다.");
  }
  const progressValue = Number(value.progress);
  if (!Number.isFinite(progressValue) || progressValue < 0 || progressValue > 1) {
    throw new Error("로컬 VOD 작업 진행률이 올바르지 않습니다.");
  }
  const normalized: ChzzkVodMaterializationStatus = {
    schema: CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA,
    jobId,
    state,
    progress: progressValue,
    message: boundedString(value.message, "진행 메시지", 500),
    reused: Boolean(value.reused)
  };
  if (value.materialization !== undefined) {
    normalized.materialization = value.materialization;
  }
  if (value.error !== undefined) {
    if (!isRecord(value.error)) {
      throw new Error("로컬 VOD 작업 오류 정보가 올바르지 않습니다.");
    }
    normalized.error = {
      code: normalizedPublicErrorCode(value.error.code),
      message: boundedString(value.error.message, "오류 메시지", 1_000)
    };
  }
  if (value.media !== undefined) {
    normalized.media = normalizeLocalMedia(value.media, mediaEngineEndpoint, jobId);
  }
  if (state === "completed" && (!normalized.media || !normalized.materialization)) {
    throw new Error("완료된 로컬 VOD 작업의 결과가 빠졌습니다.");
  }
  if (state === "failed" && !normalized.error) {
    throw new Error("실패한 로컬 VOD 작업의 오류 정보가 빠졌습니다.");
  }
  return normalized;
}

async function parseStatusResponse(
  response: Response,
  mediaEngineEndpoint: unknown
): Promise<ChzzkVodMaterializationStatus> {
  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentLength = Number(response.headers.get("content-length"));
  if (
    contentType !== "application/json"
    || (Number.isFinite(contentLength) && contentLength > CHZZK_VOD_MAX_STATUS_BYTES)
  ) {
    throw new Error("Kirinuki 내부 미디어 엔진이 올바른 JSON 응답을 보내지 않았습니다.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > CHZZK_VOD_MAX_STATUS_BYTES) {
    throw new Error("Kirinuki 내부 미디어 엔진 응답이 허용 크기를 넘었습니다.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Kirinuki 내부 미디어 엔진 응답 JSON을 읽지 못했습니다.");
  }
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : {};
    throw new ChzzkVodMaterializationClientError(
      typeof error.message === "string" && error.message.trim()
        ? error.message.trim().slice(0, 1_000)
        : `Kirinuki 내부 미디어 엔진 요청이 실패했습니다. (HTTP ${response.status})`,
      normalizedPublicErrorCode(
        error.code,
        "MATERIALIZATION_REQUEST_FAILED"
      ),
      response.status
    );
  }
  return normalizeChzzkVodMaterializationStatus(payload, mediaEngineEndpoint);
}

export function normalizeChzzkVodCachePurgeResult(
  value: unknown
): ChzzkVodCachePurgeResult {
  if (
    !isRecord(value)
    || value.schema !== CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA
    || value.state !== "purged"
    || typeof value.alreadyPurged !== "boolean"
    || !isRecord(value.materialization)
    || !isRecord(value.source)
    || Object.keys(value).some((key) => ![
      "schema",
      "jobId",
      "state",
      "alreadyPurged",
      "releasedBytes",
      "materialization",
      "source"
    ].includes(key))
  ) {
    throw new Error("로컬 VOD 캐시 삭제 응답 버전이 맞지 않습니다.");
  }
  const jobId = normalizeJobId(value.jobId);
  const releasedBytes = Number(value.releasedBytes);
  const materializationId = String(
    value.materialization.materializationId || ""
  ).trim();
  const planFingerprint = String(
    value.materialization.planFingerprint || ""
  ).trim();
  const platform = String(value.source.platform || "").trim().toUpperCase();
  const contentId = String(value.source.contentId || "").trim();
  const sourceVersionId = String(value.source.sourceVersionId || "").trim();
  if (
    !Number.isSafeInteger(releasedBytes)
    || releasedBytes <= 0
    || !/^[a-f0-9]{32}$/u.test(materializationId)
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || !["CHZZK", "YOUTUBE", "SOOP"].includes(platform)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
    || !/^[a-f0-9]{64}$/u.test(sourceVersionId)
  ) {
    throw new Error("로컬 VOD 캐시 삭제 결과 identity가 올바르지 않습니다.");
  }
  return {
    schema: CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA,
    jobId,
    state: "purged",
    alreadyPurged: value.alreadyPurged,
    releasedBytes,
    materialization: { materializationId, planFingerprint },
    source: {
      platform: platform as ChzzkVodCachePurgeResult["source"]["platform"],
      contentId,
      sourceVersionId
    }
  };
}

export function normalizeChzzkVodConsumerCachePurgeResult(
  value: unknown
): ChzzkVodConsumerCachePurgeResult {
  if (
    !isRecord(value)
    || value.schema !== CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA
    || value.state !== "purged"
    || typeof value.alreadyPurged !== "boolean"
    || !isRecord(value.materialization)
    || !isRecord(value.source)
    || Object.keys(value).some((key) => ![
      "schema",
      "jobId",
      "consumerId",
      "state",
      "alreadyPurged",
      "releasedBytes",
      "releasedFiles",
      "materialization",
      "source"
    ].includes(key))
    || Object.keys(value.materialization).some((key) => ![
      "materializationId",
      "planFingerprint"
    ].includes(key))
    || Object.keys(value.source).some((key) => ![
      "platform",
      "contentId",
      "sourceVersionId"
    ].includes(key))
  ) {
    throw new Error("로컬 VOD 세션 캐시 삭제 응답 버전이 맞지 않습니다.");
  }
  const jobId = normalizeJobId(value.jobId);
  const consumerId = normalizeCacheConsumerId(value.consumerId);
  const releasedBytes = Number(value.releasedBytes);
  const releasedFiles = Number(value.releasedFiles);
  const materializationId = String(
    value.materialization.materializationId || ""
  ).trim();
  const planFingerprint = String(
    value.materialization.planFingerprint || ""
  ).trim();
  const platform = String(value.source.platform || "").trim().toUpperCase();
  const contentId = String(value.source.contentId || "").trim();
  const sourceVersionId = String(value.source.sourceVersionId || "").trim();
  if (
    !Number.isSafeInteger(releasedBytes)
    || releasedBytes <= 0
    || !Number.isSafeInteger(releasedFiles)
    || releasedFiles <= 0
    || !/^[a-f0-9]{32}$/u.test(materializationId)
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || !["CHZZK", "YOUTUBE", "SOOP"].includes(platform)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
    || !/^[a-f0-9]{64}$/u.test(sourceVersionId)
  ) {
    throw new Error("로컬 VOD 세션 캐시 삭제 결과 identity가 올바르지 않습니다.");
  }
  return {
    schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA,
    jobId,
    consumerId,
    state: "purged",
    alreadyPurged: value.alreadyPurged,
    releasedBytes,
    releasedFiles,
    materialization: { materializationId, planFingerprint },
    source: {
      platform: platform as ChzzkVodConsumerCachePurgeResult["source"]["platform"],
      contentId,
      sourceVersionId
    }
  };
}

async function parseCachePurgeResponse(
  response: Response
): Promise<ChzzkVodCachePurgeResult> {
  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentLength = Number(response.headers.get("content-length"));
  if (
    contentType !== "application/json"
    || (Number.isFinite(contentLength)
      && contentLength > CHZZK_VOD_MAX_STATUS_BYTES)
  ) {
    throw new Error("Kirinuki 내부 미디어 엔진이 올바른 JSON 응답을 보내지 않았습니다.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > CHZZK_VOD_MAX_STATUS_BYTES) {
    throw new Error("Kirinuki 내부 미디어 엔진 응답이 허용 크기를 넘었습니다.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Kirinuki 내부 미디어 엔진 응답 JSON을 읽지 못했습니다.");
  }
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : {};
    throw new Error(
      typeof error.message === "string" && error.message.trim()
        ? error.message.trim().slice(0, 1_000)
        : `로컬 VOD 캐시 삭제가 실패했습니다. (HTTP ${response.status})`
    );
  }
  return normalizeChzzkVodCachePurgeResult(payload);
}

async function parseConsumerCachePurgeResponse(
  response: Response
): Promise<ChzzkVodConsumerCachePurgeResult> {
  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentLength = Number(response.headers.get("content-length"));
  if (
    contentType !== "application/json"
    || (Number.isFinite(contentLength)
      && contentLength > CHZZK_VOD_MAX_STATUS_BYTES)
  ) {
    throw new Error("Kirinuki 내부 미디어 엔진이 올바른 JSON 응답을 보내지 않았습니다.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > CHZZK_VOD_MAX_STATUS_BYTES) {
    throw new Error("Kirinuki 내부 미디어 엔진 응답이 허용 크기를 넘었습니다.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Kirinuki 내부 미디어 엔진 응답 JSON을 읽지 못했습니다.");
  }
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : {};
    throw new Error(
      typeof error.message === "string" && error.message.trim()
        ? error.message.trim().slice(0, 1_000)
        : `로컬 VOD 세션 캐시 삭제가 실패했습니다. (HTTP ${response.status})`
    );
  }
  return normalizeChzzkVodConsumerCachePurgeResult(payload);
}

function requestHeaders(
  token: unknown,
  protocol = CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
): Record<string, string> {
  return {
    Authorization: `Bearer ${normalizeToken(token)}`,
    "Content-Type": "application/json",
    "X-Kirinuki-Client-Nonce": localEngineDocumentClientNonce(),
    "X-Kirinuki-Protocol": protocol
  };
}

export async function startChzzkVodMaterialization({
  endpoint,
  token,
  consumerId,
  sourceUrl,
  sourceClockIdentity,
  clips,
  rightsConfirmed,
  editableRanges,
  resume,
  base,
  handleMs = CHZZK_VOD_HANDLE_MS,
  signal,
  fetchImpl = fetch
}: StartChzzkVodMaterializationOptions): Promise<ChzzkVodMaterializationStatus> {
  if (!rightsConfirmed) {
    throw new Error("본인 소유 또는 편집 허가를 받은 공개 VOD인지 확인해 주세요.");
  }
  const padding = Number(handleMs);
  if (!Number.isSafeInteger(padding) || padding !== CHZZK_VOD_HANDLE_MS) {
    throw new Error("현재 VOD 편집 여유는 앞뒤 10초만 지원합니다.");
  }
  if (resume && base) {
    throw new Error("VOD 재개와 범위 확장 기준은 동시에 사용할 수 없습니다.");
  }
  const normalizedClips = normalizeClipRequests(clips);
  const normalizedConsumerId = normalizeCacheConsumerId(consumerId);
  const normalizedSourceUrl = String(sourceUrl || "").trim();
  const normalizedSourceClockIdentity = normalizedRequestSourceClockIdentity(
    sourceClockIdentity,
    normalizedSourceUrl
  );
  const normalizedEditableRanges = normalizeEditableRangeRequests(
    editableRanges,
    normalizedClips
  );
  const response = await localMediaEngineTransportFetch(
    chzzkVodMaterializationEndpoint(endpoint), {
    method: "POST",
    headers: requestHeaders(token),
    body: JSON.stringify({
      schema: CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
      consumerId: normalizedConsumerId,
      sourceUrl: normalizedSourceUrl,
      ...(normalizedSourceClockIdentity
        ? { sourceClockIdentity: normalizedSourceClockIdentity }
        : {}),
      clips: normalizedClips,
      ...(normalizedEditableRanges
        ? { editableRanges: normalizedEditableRanges }
        : {}),
      handleMs: padding,
      ...(resume ? { resume: normalizeResumeReference(resume) } : {}),
      ...(base ? { base: normalizeResumeReference(base) } : {}),
      permission: {
        confirmed: true,
        scope: "owned-or-authorized-public-vod"
      }
    }),
    ...(signal === undefined ? {} : { signal }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error"
    }, fetchImpl);
  return parseStatusResponse(response, endpoint);
}

export async function getChzzkVodMaterializationStatus({
  endpoint,
  token,
  jobId,
  signal,
  fetchImpl = fetch
}: MaterializationConnectionOptions & {
  jobId: unknown;
}): Promise<ChzzkVodMaterializationStatus> {
  const response = await localMediaEngineTransportFetch(
    chzzkVodJobEndpoint(endpoint, jobId), {
    // Encrypted loopback control requests carry an authenticated envelope in
    // the request body. Browsers reject bodies on GET, so status polling uses
    // POST just like the encrypted session-status route.
    method: "POST",
    headers: requestHeaders(token),
    ...(signal === undefined ? {} : { signal }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error"
    }, fetchImpl);
  return parseStatusResponse(response, endpoint);
}

export async function cancelChzzkVodMaterialization({
  endpoint,
  token,
  jobId,
  signal,
  fetchImpl = fetch
}: MaterializationConnectionOptions & {
  jobId: unknown;
}): Promise<ChzzkVodMaterializationStatus> {
  const response = await localMediaEngineTransportFetch(
    chzzkVodJobEndpoint(endpoint, jobId), {
    method: "DELETE",
    headers: requestHeaders(token),
    ...(signal === undefined ? {} : { signal }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error"
    }, fetchImpl);
  return parseStatusResponse(response, endpoint);
}

/**
 * Deletes only the exact completed materialization represented by the local
 * media URL and v2 source receipt. A manually selected File/blob URL cannot
 * satisfy this contract and is rejected before any request is sent.
 */
export async function purgeChzzkVodMaterializedCache({
  endpoint,
  token,
  mediaUrl,
  materialization,
  signal,
  fetchImpl = fetch
}: PurgeChzzkVodMaterializedCacheOptions): Promise<ChzzkVodCachePurgeResult> {
  const target = cachePurgeRequestIdentity(
    endpoint,
    mediaUrl,
    materialization
  );
  const response = await localMediaEngineTransportFetch(
    chzzkVodCachePurgeEndpoint(endpoint, target.jobId),
    {
      method: "DELETE",
      headers: {
        ...requestHeaders(token, CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA),
        "X-Kirinuki-Media-Access": target.mediaAccess
      },
      body: JSON.stringify(target.body),
      ...(signal === undefined ? {} : { signal }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    },
    fetchImpl
  );
  const result = await parseCachePurgeResponse(response);
  if (result.jobId !== target.jobId) {
    throw new Error("삭제된 VOD 캐시 작업 ID가 요청 대상과 다릅니다.");
  }
  const requestMaterialization = target.body.materialization as Record<
    string,
    unknown
  >;
  const requestSource = target.body.source as Record<string, unknown>;
  if (
    result.materialization.materializationId
      !== requestMaterialization.materializationId
    || result.materialization.planFingerprint
      !== requestMaterialization.planFingerprint
    || result.source.platform !== requestSource.platform
    || result.source.contentId !== requestSource.contentId
    || result.source.sourceVersionId !== requestSource.sourceVersionId
  ) {
    throw new Error("삭제된 VOD 캐시 source identity가 요청 대상과 다릅니다.");
  }
  return result;
}

/**
 * Deletes every managed VOD cache generation owned by one exact edit-session
 * consumer.  The internal engine authenticates both the bearer session and the
 * current completed media capability before removing the isolated scope.
 */
export async function purgeChzzkVodConsumerSessionCache({
  endpoint,
  token,
  consumerId,
  mediaUrl,
  materialization,
  signal,
  fetchImpl = fetch
}: PurgeChzzkVodConsumerSessionCacheOptions): Promise<ChzzkVodConsumerCachePurgeResult> {
  const target = consumerCachePurgeRequestIdentity(
    endpoint,
    mediaUrl,
    materialization,
    consumerId
  );
  const response = await localMediaEngineTransportFetch(
    chzzkVodConsumerCachePurgeEndpoint(endpoint, target.jobId),
    {
      method: "DELETE",
      headers: {
        ...requestHeaders(
          token,
          CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
        ),
        "X-Kirinuki-Media-Access": target.mediaAccess
      },
      body: JSON.stringify(target.body),
      ...(signal === undefined ? {} : { signal }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    },
    fetchImpl
  );
  const result = await parseConsumerCachePurgeResponse(response);
  const requestMaterialization = target.body.materialization as Record<
    string,
    unknown
  >;
  const requestSource = target.body.source as Record<string, unknown>;
  if (
    result.jobId !== target.jobId
    || result.consumerId !== target.body.consumerId
    || result.materialization.materializationId
      !== requestMaterialization.materializationId
    || result.materialization.planFingerprint
      !== requestMaterialization.planFingerprint
    || result.source.platform !== requestSource.platform
    || result.source.contentId !== requestSource.contentId
    || result.source.sourceVersionId !== requestSource.sourceVersionId
  ) {
    throw new Error("삭제된 VOD 세션 캐시 identity가 요청 대상과 다릅니다.");
  }
  return result;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("작업이 취소되었습니다.", "AbortError"));
      return;
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason || new DOMException("작업이 취소되었습니다.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForChzzkVodMaterialization({
  endpoint,
  token,
  jobId,
  pollIntervalMs = CHZZK_VOD_POLL_INTERVAL_MS,
  onProgress = () => {},
  signal,
  fetchImpl = fetch
}: WaitForChzzkVodMaterializationOptions): Promise<ChzzkVodMaterializationStatus> {
  const interval = Math.max(100, Math.min(5_000, Math.round(pollIntervalMs)));
  for (;;) {
    const status = await getChzzkVodMaterializationStatus({
      endpoint,
      token,
      jobId,
      ...(signal === undefined ? {} : { signal }),
      fetchImpl
    });
    onProgress(status);
    if (status.state === "completed") {
      return status;
    }
    if (status.state === "failed") {
      throw new ChzzkVodMaterializationClientError(
        status.error?.message || "VOD 구간 준비에 실패했습니다.",
        status.error?.code || "MATERIALIZATION_FAILED"
      );
    }
    if (status.state === "cancelled") {
      throw new DOMException("VOD 구간 준비를 취소했습니다.", "AbortError");
    }
    await wait(interval, signal);
  }
}
