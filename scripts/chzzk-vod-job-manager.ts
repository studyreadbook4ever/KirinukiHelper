import {
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink
} from "node:fs/promises";
import path from "node:path";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  canonicalSourceUrl,
  inferSourceIdentifiers,
  sourcePlatformLabel
} from "../src/lib/source-platform.js";
import {
  normalizeSoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import type {
  SoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA,
  createMaterializationClipCoverages,
  materializedEditableBoundsForClip,
  normalizeChzzkVodMaterialization
} from "../src/lib/chzzk-vod-materialization.js";
import {
  normalizeVodConsumerId,
  vodConsumerScopeHash,
  vodConsumerScopeRoot
} from "./vod-consumer-scope.js";

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
export const MAX_CHZZK_VOD_CLIPS = 500;
export const MAX_CHZZK_VOD_SOURCE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_MAX_VOD_JOB_RECORDS = 128;
export const DEFAULT_MAX_QUEUED_VOD_JOBS = 32;
export const DEFAULT_COMPLETED_VOD_JOB_TTL_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_FAILED_VOD_JOB_TTL_MS = 5 * 60 * 1_000;
export const VOD_ARTIFACT_CHUNK_BYTES = 1024 * 1024;
export const VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY = ".purge-quarantine";

export type ChzzkVodJobStage =
  | "queued"
  | "resolving"
  | "planning"
  | "downloading"
  | "verifying"
  | "muxing";

export type ChzzkVodJobState =
  | ChzzkVodJobStage
  | "completed"
  | "failed"
  | "cancelled";

export interface ChzzkVodJobClip {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ChzzkVodMaterializationRequest {
  /** Stable logical edit-session identity used only to isolate local files. */
  consumerId: string;
  sourceUrl: string;
  sourceClockIdentity?: SoopVodSourceClockIdentity;
  clips: ChzzkVodJobClip[];
  editableRanges?: ChzzkVodJobEditableRange[];
  handleMs: typeof CHZZK_VOD_HANDLE_MS;
  resume?: ChzzkVodResumeReference;
  base?: ChzzkVodResumeReference;
}

export interface ChzzkVodJobEditableRange {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ChzzkVodResumeReference {
  materializationId: string;
  planFingerprint: string;
  contentId: string;
}

export interface ChzzkVodRunnerProgress {
  stage: ChzzkVodJobStage;
  progress: number;
  message: string;
}

export interface ChzzkVodRunnerResult {
  manifest: unknown;
  artifactPath: string;
  artifact: {
    hashSha256: string;
    sizeBytes: number;
  };
  reused: boolean;
}

export interface ChzzkVodArtifactVerification {
  hashSha256: string;
  chunkSizeBytes: typeof VOD_ARTIFACT_CHUNK_BYTES;
  chunkHashesSha256: readonly string[];
}

export type ChzzkVodMaterializationRunner = (
  request: ChzzkVodMaterializationRequest & {
    signal: AbortSignal;
    onProgress: (progress: ChzzkVodRunnerProgress) => void;
  }
) => Promise<ChzzkVodRunnerResult>;

interface ChzzkVodJob {
  id: string;
  request: ChzzkVodMaterializationRequest;
  state: ChzzkVodJobState;
  progress: number;
  message: string;
  reused: boolean;
  createdAt: number;
  updatedAt: number;
  lastAccessAt: number;
  accessToken: string;
  controller: AbortController;
  result?: ChzzkVodRunnerResult;
  artifactIntegrity?: Readonly<ChzzkVodRunnerResult["artifact"]>;
  artifactVerificationDigest?: Readonly<ChzzkVodArtifactVerification>;
  verifiedArtifactIdentity?: Readonly<ChzzkVodArtifactIdentity>;
  artifactVerification?: Promise<ChzzkVodArtifactIdentity | null>;
  activeMediaReads: number;
  mediaReadDrainWaiters?: Set<() => void>;
  purging: boolean;
  consumerPurging: boolean;
  purgeOperation?: Promise<ChzzkVodCachePurgeResult>;
  error?: {
    code: string;
    message: string;
  };
}

export interface ChzzkVodCachePurgeIdentity {
  schema: typeof CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA;
  jobId: string;
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

export interface ChzzkVodCachePurgeResult {
  schema: typeof CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA;
  jobId: string;
  state: "purged";
  alreadyPurged: boolean;
  releasedBytes: number;
  materialization: ChzzkVodCachePurgeIdentity["materialization"];
  source: ChzzkVodCachePurgeIdentity["source"];
}

interface ChzzkVodPurgeTombstone {
  accessToken: string;
  identity: Readonly<ChzzkVodCachePurgeIdentity>;
  result: Readonly<ChzzkVodCachePurgeResult>;
  purgedAt: number;
}

export interface ChzzkVodConsumerCachePurgeIdentity {
  schema: typeof CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA;
  jobId: string;
  consumerId: string;
  materialization: ChzzkVodCachePurgeIdentity["materialization"];
  source: ChzzkVodCachePurgeIdentity["source"];
}

export interface ChzzkVodConsumerCachePurgeResult {
  schema: typeof CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA;
  jobId: string;
  consumerId: string;
  state: "purged";
  alreadyPurged: boolean;
  releasedBytes: number;
  releasedFiles: number;
  materialization: ChzzkVodCachePurgeIdentity["materialization"];
  source: ChzzkVodCachePurgeIdentity["source"];
}

export interface ChzzkVodQuarantineScavengeResult {
  releasedBytes: number;
  releasedFiles: number;
  releasedScopes: number;
}

interface ChzzkVodConsumerPurgeTombstone {
  accessToken: string;
  identity: Readonly<ChzzkVodConsumerCachePurgeIdentity>;
  result: Readonly<ChzzkVodConsumerCachePurgeResult>;
  purgedAt: number;
}

interface ChzzkVodConsumerPurgeOperation {
  jobId: string;
  accessToken: string;
  identity: Readonly<ChzzkVodConsumerCachePurgeIdentity>;
  operation?: Promise<ChzzkVodConsumerCachePurgeResult>;
}

export interface ChzzkVodPublicStatus {
  schema: typeof CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA;
  jobId: string;
  state: ChzzkVodJobState;
  progress: number;
  message: string;
  reused: boolean;
  materialization?: unknown;
  media?: {
    url: string;
    name: string;
    size: number;
    type: "video/mp4";
    lastModified: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface ChzzkVodArtifactIdentity {
  size: number;
  mtimeMs: number;
  dev: string;
  ino: string;
  mtimeNs: string;
  ctimeNs: string;
  regular: boolean;
  symlink: boolean;
}

interface ChzzkVodJobManagerOptions {
  runner: ChzzkVodMaterializationRunner;
  /** Exact managed materializer root. Purge is fail-closed when absent. */
  artifactRoot?: string;
  inspectArtifactIdentity?: (
    artifactPath: string
  ) => Promise<ChzzkVodArtifactIdentity>;
  hashArtifact?: (
    artifactPath: string,
    expectedIdentity: Readonly<ChzzkVodArtifactIdentity>,
    signal?: AbortSignal
  ) => Promise<ChzzkVodArtifactVerification>;
  removeConsumerCacheTree?: (targetPath: string) => Promise<void>;
  maximumConcurrentJobs?: number;
  maximumJobRecords?: number;
  maximumQueuedJobs?: number;
  completedTtlMs?: number;
  failedTtlMs?: number;
  randomBytesImpl?: typeof randomBytes;
  now?: () => number;
}

export class ChzzkVodJobManagerError extends Error {
  readonly code:
    | "BUSY"
    | "MEDIA_VERIFICATION_FAILED"
    | "PURGE_FAILED"
    | "PURGE_IDENTITY_MISMATCH"
    | "PURGE_NOT_ALLOWED"
    | "PURGE_UNAVAILABLE";

  constructor(
    message: string,
    code: ChzzkVodJobManagerError["code"]
  ) {
    super(message);
    this.name = "ChzzkVodJobManagerError";
    this.code = code;
  }
}

const ALLOWED_STAGES = new Set<ChzzkVodJobStage>([
  "queued",
  "resolving",
  "planning",
  "downloading",
  "verifying",
  "muxing"
]);
const VOD_CONSUMER_PURGE_QUARANTINE_CHILD_PATTERN =
  /^consumer-([a-f0-9]{64})-([a-f0-9]{32})$/u;
const PUBLIC_MATERIALIZATION_ERROR_CODES = new Set([
  "ALREADY_RUNNING",
  "BUSY",
  "CACHE_INTEGRITY_FAILED",
  "CANCELLED",
  "DISK_SPACE_CHECK_FAILED",
  "DOWNLOAD_FAILED",
  "FETCH_UNAVAILABLE",
  "INVALID_CLIPS",
  "INVALID_BASE_MATERIALIZATION",
  "INVALID_HANDLE",
  "INVALID_SOURCE_URL",
  "LIVE_SOURCE",
  "LOCAL_WRITE_FAILED",
  "LOCK_FAILED",
  "MEDIA_MUX_FAILED",
  "MEDIA_STREAM_MISMATCH",
  "MEDIA_VERIFICATION_FAILED",
  "METADATA_PROBE_FAILED",
  "METADATA_REQUEST_FAILED",
  "NETWORK_REQUEST_FAILED",
  "NO_RANDOM_ACCESS_POINT",
  "PLAYBACK_REQUEST_FAILED",
  "PROCESS_START_FAILED",
  "MATERIALIZATION_QUOTA_EXCEEDED",
  "RESTRICTED_SOURCE",
  "SEGMENT_REQUEST_FAILED",
  "SOURCE_CLOCK_VERIFICATION_FAILED",
  "SOURCE_CHANGED",
  "TOOL_NOT_INSTALLED",
  "UNSUPPORTED_MEDIA",
  "UNSUPPORTED_MPD",
  "VOD_UNAVAILABLE"
]);

/**
 * The strict acquirers intentionally use detailed fail-closed codes internally.
 * Those codes describe implementation details (transport shape, proof document
 * layout, redirect policy, and fragment parsing) and are not a stable browser
 * API. Collapse them into a small semantic surface before a status leaves the
 * loopback companion.
 */
const INTERNAL_MATERIALIZATION_ERROR_CODE_MAP = new Map<string, string>([
  ["ABORTED", "CANCELLED"],

  ["CLOCK_EVIDENCE_MISMATCH", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["CLOCK_PROOF_FAILED", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["CLOCK_PROOF_MISMATCH", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["DIRECT_CLOCK_PROBE_FAILED", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_CLOCK_EVIDENCE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_CLOCK_METADATA", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_CLOCK_PROOF", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_CLOCK_PROOF_SET", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_CLOCK_SOURCE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_DIRECT_CLOCK", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_DIRECT_CLOCK_PROOF", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_DIRECT_EVIDENCE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_HLS_CLOCK_EVIDENCE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_HLS_TIMELINE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_SECTION", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_SELECTED_SOURCE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_SOURCE_CLOCK", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_SOURCE_CLOCK_METADATA", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["INVALID_SOURCE_CLOCK_PROOF", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["NONZERO_DIRECT_ORIGIN", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["SELECTED_SOURCE_DURATION_MISMATCH", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["SELECTED_SOURCE_RESOLUTION_FAILED", "SOURCE_CLOCK_VERIFICATION_FAILED"],
  ["SOURCE_CLOCK_MISMATCH", "SOURCE_CLOCK_VERIFICATION_FAILED"],

  ["HLS_RESOURCE_CHANGED", "SOURCE_CHANGED"],

  ["HLS_FETCH_FAILED", "DOWNLOAD_FAILED"],
  ["INVALID_PLAYLIST_ENCODING", "DOWNLOAD_FAILED"],
  ["INVALID_REDIRECT", "DOWNLOAD_FAILED"],
  ["TOO_MANY_REDIRECTS", "DOWNLOAD_FAILED"],
  ["TRANSFER_FAILED", "DOWNLOAD_FAILED"],
  ["TRANSFER_UNAVAILABLE", "DOWNLOAD_FAILED"],
  ["UNSAFE_DIRECT_HEADERS", "DOWNLOAD_FAILED"],
  ["UNSAFE_DIRECT_URL", "DOWNLOAD_FAILED"],
  ["UNSAFE_HLS_URL", "DOWNLOAD_FAILED"],
  ["UNSAFE_TRANSFER_ENCODING", "DOWNLOAD_FAILED"],
  ["UNSAFE_TRANSFER_HEADERS", "DOWNLOAD_FAILED"],
  ["UNSAFE_TRANSFER_URL", "DOWNLOAD_FAILED"],

  ["HLS_RESOURCE_TOO_LARGE", "MATERIALIZATION_QUOTA_EXCEEDED"],
  ["INVALID_TRANSFER_LIMIT", "MATERIALIZATION_QUOTA_EXCEEDED"],
  ["TRANSFER_TOO_LARGE", "MATERIALIZATION_QUOTA_EXCEEDED"],

  ["INVALID_FMP4_FRAGMENT", "MEDIA_VERIFICATION_FAILED"],
  ["INVALID_FMP4_INIT", "MEDIA_VERIFICATION_FAILED"],

  ["INVALID_HLS_PLAYLIST", "UNSUPPORTED_MEDIA"],
  ["UNSUPPORTED_HLS_PLAYLIST", "UNSUPPORTED_MEDIA"],
  ["UNSUPPORTED_SELECTED_SOURCE", "UNSUPPORTED_MEDIA"],

  ["UNSAFE_OUTPUT_PATH", "LOCAL_WRITE_FAILED"]
]);

const MAPPED_MATERIALIZATION_ERROR_MESSAGES = new Map<string, string>([
  [
    "CANCELLED",
    "VOD 구간 준비가 취소되었습니다."
  ],
  [
    "DOWNLOAD_FAILED",
    "원본 VOD의 필요한 구간을 이 기기로 받지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
  ],
  [
    "LOCAL_WRITE_FAILED",
    "받은 VOD 구간을 이 기기에 안전하게 저장하지 못했습니다. 저장 공간과 권한을 확인한 뒤 다시 시도해 주세요."
  ],
  [
    "MATERIALIZATION_QUOTA_EXCEEDED",
    "준비할 VOD 구간의 크기가 이 기기에서 허용하는 한도를 넘었습니다. 컷 범위를 줄여 다시 시도해 주세요."
  ],
  [
    "MEDIA_VERIFICATION_FAILED",
    "받은 VOD 구간이 선택한 시간 범위와 일치하는지 확인하지 못했습니다. 다시 준비해 주세요."
  ],
  [
    "MEDIA_MUX_FAILED",
    "받은 VOD 구간을 편집용 영상으로 구성하지 못했습니다. 다시 준비해 주세요."
  ],
  [
    "RESTRICTED_SOURCE",
    "이 원본 VOD는 공개 구간을 안전하게 준비할 수 없는 상태입니다. 원본의 공개 여부와 접근 권한을 확인해 주세요."
  ],
  [
    "SOURCE_CHANGED",
    "준비하는 동안 원본 VOD의 재생 정보가 변경되었습니다. 다시 준비해 주세요."
  ],
  [
    "SOURCE_CLOCK_VERIFICATION_FAILED",
    "원본 VOD의 정확한 재생 시간축을 확인하지 못했습니다. 원본을 다시 확인한 뒤 편집 영상을 다시 준비해 주세요."
  ],
  [
    "UNSUPPORTED_MEDIA",
    "이 원본 VOD의 재생 형식에서는 정확한 구간을 안전하게 준비할 수 없습니다."
  ]
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCacheConsumerId(value: unknown): string {
  return normalizeVodConsumerId(value);
}

function redactSecretText(value: unknown): string {
  return String(value || "")
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[주소 숨김]")
    .replace(/(?:inKey|_lsu_sa_|token|signature|access)=?[^\s&"'<>]*/giu, "$1=[숨김]")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function safeMessage(value: unknown, fallback: string, maximum = 500): string {
  return (redactSecretText(value) || fallback).slice(0, maximum);
}

function safeErrorCode(error: unknown): string {
  const internalCode = isRecord(error) ? String(error.code || "").trim() : "";
  const publicCode = INTERNAL_MATERIALIZATION_ERROR_CODE_MAP.get(internalCode)
    ?? internalCode;
  return PUBLIC_MATERIALIZATION_ERROR_CODES.has(publicCode)
    ? publicCode
    : "MATERIALIZATION_FAILED";
}

function safeErrorMessage(error: unknown, publicCode: string): string {
  const internalCode = isRecord(error) ? String(error.code || "").trim() : "";
  const semanticMessage = MAPPED_MATERIALIZATION_ERROR_MESSAGES.get(publicCode);
  if (semanticMessage) {
    return semanticMessage;
  }
  if (INTERNAL_MATERIALIZATION_ERROR_CODE_MAP.has(internalCode)) {
    return "VOD 구간 준비에 실패했습니다. 다시 시도해 주세요.";
  }
  if (publicCode === "MATERIALIZATION_FAILED") {
    return "VOD 구간 준비에 실패했습니다. 다시 시도해 주세요.";
  }
  return safeMessage(
    error instanceof Error ? error.message : error,
    "VOD 구간 준비에 실패했습니다.",
    1_000
  );
}

function normalizeSourceUrl(value: unknown): string {
  const sourceUrl = String(value || "").trim();
  if (!sourceUrl || sourceUrl.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(sourceUrl)) {
    throw new TypeError("VOD 주소가 올바르지 않습니다.");
  }
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new TypeError("VOD 주소가 올바르지 않습니다.");
  }
  const identifiers = inferSourceIdentifiers(url.toString());
  if (
    url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || url.hash
    || identifiers.contentType !== "vod"
    || !identifiers.contentId
    || ![
      SOURCE_PLATFORM_CHZZK,
      SOURCE_PLATFORM_YOUTUBE,
      SOURCE_PLATFORM_SOOP
    ].includes(identifiers.platform)
    || (
      identifiers.platform === SOURCE_PLATFORM_CHZZK
      && Boolean(url.search)
    )
  ) {
    throw new TypeError(
      "지원하는 치지직·YouTube·SOOP 공개 HTTPS VOD 주소만 사용할 수 있습니다."
    );
  }
  const canonical = canonicalSourceUrl(url.toString(), identifiers);
  if (!canonical) {
    throw new TypeError("VOD 주소를 안전한 canonical 주소로 만들지 못했습니다.");
  }
  return canonical;
}

function normalizeClips(value: unknown): ChzzkVodJobClip[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHZZK_VOD_CLIPS) {
    throw new TypeError(`VOD 컷은 1개 이상 ${MAX_CHZZK_VOD_CLIPS}개 이하여야 합니다.`);
  }
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new TypeError("VOD 컷 정보가 올바르지 않습니다.");
    }
    const id = String(entry.id || "").trim();
    const startMs = Number(entry.startMs);
    const endMs = Number(entry.endMs);
    if (
      !id
      || id.length > 160
      || /[\u0000-\u001f\u007f]/u.test(id)
      || ids.has(id)
      || !Number.isSafeInteger(startMs)
      || !Number.isSafeInteger(endMs)
      || startMs < 0
      || endMs <= startMs
      || endMs > MAX_CHZZK_VOD_SOURCE_MS
    ) {
      throw new TypeError("VOD 컷 범위가 올바르지 않습니다.");
    }
    ids.add(id);
    return { id, startMs, endMs };
  });
}

function normalizeResumeReference(
  value: unknown,
  sourceUrl: string
): ChzzkVodResumeReference | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError("다시 열 VOD 로컬 작업 정보가 올바르지 않습니다.");
  }
  const materializationId = String(value.materializationId || "").trim();
  const planFingerprint = String(value.planFingerprint || "").trim();
  const contentId = String(value.contentId || "").trim();
  const sourceContentId = inferSourceIdentifiers(sourceUrl).contentId;
  if (
    !/^[a-f0-9]{32}$/u.test(materializationId)
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
    || contentId !== sourceContentId
    || Object.keys(value).some((key) => ![
      "materializationId",
      "planFingerprint",
      "contentId"
    ].includes(key))
  ) {
    throw new TypeError("다시 열 VOD 로컬 작업 정보가 현재 원본과 맞지 않습니다.");
  }
  return { materializationId, planFingerprint, contentId };
}

function normalizeEditableRanges(
  value: unknown,
  clips: readonly ChzzkVodJobClip[]
): ChzzkVodJobEditableRange[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== clips.length) {
    throw new TypeError("확장 편집 범위는 모든 VOD 컷에 정확히 하나씩 있어야 합니다.");
  }
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const ids = new Set<string>();
  const ranges = value.map((entry) => {
    if (!isRecord(entry)) {
      throw new TypeError("확장 편집 범위가 올바르지 않습니다.");
    }
    const id = String(entry.id || "").trim();
    const startMs = Number(entry.startMs);
    const endMs = Number(entry.endMs);
    const clip = clipsById.get(id);
    if (
      !clip
      || ids.has(id)
      || !Number.isSafeInteger(startMs)
      || !Number.isSafeInteger(endMs)
      || startMs < 0
      || endMs <= startMs
      || endMs > MAX_CHZZK_VOD_SOURCE_MS
      || startMs > clip.startMs
      || endMs < clip.endMs
      || Object.keys(entry).some((key) => !["id", "startMs", "endMs"].includes(key))
    ) {
      throw new TypeError(
        "확장 편집 범위는 원래 선택의 앞뒤 10초를 포함해야 합니다."
      );
    }
    ids.add(id);
    return { id, startMs, endMs };
  });
  return ranges.sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeChzzkVodMaterializationRequest(
  value: unknown
): ChzzkVodMaterializationRequest {
  if (
    !isRecord(value)
    || value.schema !== CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    || Object.keys(value).some((key) => ![
      "schema",
      "consumerId",
      "sourceUrl",
      "sourceClockIdentity",
      "clips",
      "editableRanges",
      "handleMs",
      "resume",
      "base",
      "permission"
    ].includes(key))
  ) {
    throw new TypeError("VOD 준비 요청 버전이 맞지 않습니다.");
  }
  if (
    !isRecord(value.permission)
    || value.permission.confirmed !== true
    || value.permission.scope !== "owned-or-authorized-public-vod"
    || Object.keys(value.permission).some((key) => ![
      "confirmed",
      "scope"
    ].includes(key))
  ) {
    throw new TypeError("본인 소유 또는 편집 허가를 받은 공개 VOD인지 확인해야 합니다.");
  }
  if (Number(value.handleMs) !== CHZZK_VOD_HANDLE_MS) {
    throw new TypeError("현재 VOD 편집 여유는 앞뒤 10초만 지원합니다.");
  }
  const sourceUrl = normalizeSourceUrl(value.sourceUrl);
  const source = inferSourceIdentifiers(sourceUrl);
  const sourceClockIdentity = source.platform === SOURCE_PLATFORM_SOOP
    ? normalizeSoopVodSourceClockIdentity(value.sourceClockIdentity)
    : null;
  if (
    (source.platform === SOURCE_PLATFORM_SOOP
      && (
        !sourceClockIdentity
        || sourceClockIdentity.contentId !== source.contentId
      ))
    || (source.platform !== SOURCE_PLATFORM_SOOP
      && value.sourceClockIdentity !== undefined)
  ) {
    throw new TypeError(
      "SOOP 공식 VOD part 시계 증명이 없거나 현재 원본과 맞지 않습니다."
    );
  }
  const consumerId = normalizeCacheConsumerId(value.consumerId);
  const clips = normalizeClips(value.clips);
  const resume = normalizeResumeReference(value.resume, sourceUrl);
  const base = normalizeResumeReference(value.base, sourceUrl);
  if (resume && base) {
    throw new TypeError("VOD 재개와 범위 확장 기준은 동시에 보낼 수 없습니다.");
  }
  const editableRanges = normalizeEditableRanges(value.editableRanges, clips);
  return {
    consumerId,
    sourceUrl,
    ...(sourceClockIdentity ? { sourceClockIdentity } : {}),
    clips,
    ...(editableRanges ? { editableRanges } : {}),
    handleMs: CHZZK_VOD_HANDLE_MS,
    ...(resume ? { resume } : {}),
    ...(base ? { base } : {})
  };
}

export function normalizeChzzkVodCachePurgeIdentity(
  value: unknown,
  expectedJobId?: string
): ChzzkVodCachePurgeIdentity {
  if (
    !isRecord(value)
    || value.schema !== CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA
    || !isRecord(value.materialization)
    || !isRecord(value.source)
    || Object.keys(value).some((key) => ![
      "schema",
      "jobId",
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
    throw new TypeError("VOD 캐시 삭제 요청 버전이 맞지 않습니다.");
  }
  const jobId = String(value.jobId || "").trim();
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
    !/^[a-zA-Z0-9_-]{16,128}$/u.test(jobId)
    || (expectedJobId !== undefined && jobId !== expectedJobId)
    || !/^[a-f0-9]{32}$/u.test(materializationId)
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || ![
      SOURCE_PLATFORM_CHZZK,
      SOURCE_PLATFORM_YOUTUBE,
      SOURCE_PLATFORM_SOOP
    ].includes(platform)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
    || !/^[a-f0-9]{64}$/u.test(sourceVersionId)
  ) {
    throw new TypeError("VOD 캐시 삭제 대상 identity가 올바르지 않습니다.");
  }
  return {
    schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    jobId,
    materialization: { materializationId, planFingerprint },
    source: {
      platform: platform as ChzzkVodCachePurgeIdentity["source"]["platform"],
      contentId,
      sourceVersionId
    }
  };
}

export function normalizeChzzkVodConsumerCachePurgeIdentity(
  value: unknown,
  expectedJobId?: string
): ChzzkVodConsumerCachePurgeIdentity {
  if (
    !isRecord(value)
    || value.schema !== CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
    || !isRecord(value.materialization)
    || !isRecord(value.source)
    || Object.keys(value).some((key) => ![
      "schema",
      "jobId",
      "consumerId",
      "materialization",
      "source"
    ].includes(key))
  ) {
    throw new TypeError("VOD 세션 캐시 삭제 요청 버전이 맞지 않습니다.");
  }
  const exact = normalizeChzzkVodCachePurgeIdentity({
    schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    jobId: value.jobId,
    materialization: value.materialization,
    source: value.source
  }, expectedJobId);
  return {
    schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
    jobId: exact.jobId,
    consumerId: normalizeCacheConsumerId(value.consumerId),
    materialization: exact.materialization,
    source: exact.source
  };
}

function cachePurgeIdentityMatches(
  left: Readonly<ChzzkVodCachePurgeIdentity>,
  right: Readonly<ChzzkVodCachePurgeIdentity>
): boolean {
  return left.jobId === right.jobId
    && left.materialization.materializationId
      === right.materialization.materializationId
    && left.materialization.planFingerprint
      === right.materialization.planFingerprint
    && left.source.platform === right.source.platform
    && left.source.contentId === right.source.contentId
    && left.source.sourceVersionId === right.source.sourceVersionId;
}

function consumerCachePurgeIdentityMatches(
  left: Readonly<ChzzkVodConsumerCachePurgeIdentity>,
  right: Readonly<ChzzkVodConsumerCachePurgeIdentity>
): boolean {
  return left.consumerId === right.consumerId
    && cachePurgeIdentityMatches({
      schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
      jobId: left.jobId,
      materialization: left.materialization,
      source: left.source
    }, {
      schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
      jobId: right.jobId,
      materialization: right.materialization,
      source: right.source
    });
}

function cachePurgeIdentityForJob(
  job: Readonly<ChzzkVodJob>
): ChzzkVodCachePurgeIdentity | null {
  const materialization = normalizeChzzkVodMaterialization(
    job.result?.manifest
  );
  if (
    !materialization
    || materialization.schema !== CHZZK_VOD_MATERIALIZATION_SCHEMA
    || !materialization.source.sourceVersionId
  ) {
    return null;
  }
  return {
    schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    jobId: job.id,
    materialization: {
      materializationId: materialization.materializationId,
      planFingerprint: materialization.planFingerprint
    },
    source: {
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId: materialization.source.sourceVersionId
    }
  };
}

function consumerCachePurgeIdentityForJob(
  job: Readonly<ChzzkVodJob>
): ChzzkVodConsumerCachePurgeIdentity | null {
  const exact = cachePurgeIdentityForJob(job);
  if (!exact) {
    return null;
  }
  return {
    schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
    jobId: exact.jobId,
    consumerId: job.request.consumerId,
    materialization: exact.materialization,
    source: exact.source
  };
}

function requestFingerprint(request: ChzzkVodMaterializationRequest): string {
  const canonical = JSON.stringify({
    consumerId: request.consumerId,
    sourceUrl: request.sourceUrl,
    sourceClockIdentity: request.sourceClockIdentity ?? null,
    handleMs: request.handleMs,
    clips: [...request.clips].sort((left, right) => (
      left.startMs - right.startMs
      || left.endMs - right.endMs
      || left.id.localeCompare(right.id)
    )),
    editableRanges: request.editableRanges
      ? [...request.editableRanges].sort((left, right) => (
        left.id.localeCompare(right.id)
      ))
      : null,
    resume: request.resume ?? null,
    base: request.base ?? null
  });
  return createHash("sha256").update(canonical).digest("base64url");
}

function manifestMatchesRequest(
  manifest: unknown,
  request: ChzzkVodMaterializationRequest
): boolean {
  const normalized = normalizeChzzkVodMaterialization(manifest);
  if (!normalized) {
    return false;
  }
  const expected = inferSourceIdentifiers(request.sourceUrl);
  if (
    normalized.source.platform !== expected.platform
    || normalized.source.contentId !== expected.contentId
    || normalized.handleMs !== request.handleMs
    || !/^[a-f0-9]{64}$/u.test(normalized.planFingerprint)
    || !/^[a-f0-9]{32}$/u.test(normalized.materializationId)
    || normalized.materializationId !== normalized.planFingerprint.slice(0, 32)
  ) {
    return false;
  }
  const requestedClips = request.clips.map((clip) => ({
    clipId: clip.id,
    sourceStartMs: clip.startMs,
    sourceEndMs: clip.endMs
  }));
  const desired = request.editableRanges?.map((range) => ({
    clipId: range.id,
    editableSourceStartMs: range.startMs,
    editableSourceEndMs: range.endMs
  }));
  let expectedCoverages: ReturnType<typeof createMaterializationClipCoverages>;
  try {
    expectedCoverages = createMaterializationClipCoverages(
      requestedClips,
      normalized.sourceDurationMs,
      request.handleMs,
      desired
    );
  } catch {
    return false;
  }
  if (normalized.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA) {
    if (!normalized.source.sourceVersionId || !normalized.clipRanges) {
      return false;
    }
    const actual = [...normalized.clipRanges]
      .sort((left, right) => left.clipId.localeCompare(right.clipId));
    return actual.length === expectedCoverages.length
      && actual.every((coverage, index) => {
        const expectedCoverage = expectedCoverages[index];
        return expectedCoverage !== undefined
          && coverage.clipId === expectedCoverage.clipId
          && coverage.sourceStartMs === expectedCoverage.sourceStartMs
          && coverage.sourceEndMs === expectedCoverage.sourceEndMs
          && coverage.editableSourceStartMs
            === expectedCoverage.editableSourceStartMs
          && coverage.editableSourceEndMs
            === expectedCoverage.editableSourceEndMs;
      });
  }
  if (
    normalized.schema !== LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA
    || request.editableRanges !== undefined
    || request.base !== undefined
  ) {
    return false;
  }
  const actualClipIds = new Set(
    normalized.windows.flatMap((window) => window.clipIds)
  );
  return actualClipIds.size === expectedCoverages.length
    && expectedCoverages.every((coverage) => {
      if (!actualClipIds.has(coverage.clipId)) {
        return false;
      }
      const bounds = materializedEditableBoundsForClip({
        id: coverage.clipId,
        selectionStartMs: coverage.sourceStartMs,
        selectionEndMs: coverage.sourceEndMs
      }, normalized);
      return bounds !== null
        && bounds.editableSourceStartMs === coverage.editableSourceStartMs
        && bounds.editableSourceEndMs === coverage.editableSourceEndMs;
    });
}

function fileNameFromResult(result: ChzzkVodRunnerResult): string {
  const value = isRecord(result.manifest) && isRecord(result.manifest.artifact)
    ? result.manifest.artifact.name
    : undefined;
  const platform = isRecord(result.manifest) && isRecord(result.manifest.source)
    ? String(result.manifest.source.platform || "")
    : "";
  const fallbackName = `${sourcePlatformLabel(platform) || "VOD"}-선택-구간.mp4`;
  const name = String(value || fallbackName).trim();
  return name && name.length <= 240 && !/[\\/\u0000-\u001f\u007f]/u.test(name)
    ? name
    : fallbackName;
}

function requestPlatformLabel(
  request: ChzzkVodMaterializationRequest
): string {
  try {
    return sourcePlatformLabel(inferSourceIdentifiers(request.sourceUrl).platform);
  } catch {
    return "VOD";
  }
}

function accessTokenMatches(expected: string, supplied: unknown): boolean {
  const suppliedBuffer = Buffer.from(String(supplied || ""));
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function artifactIdentityFromStats(
  status: unknown,
  {
    symlink = false
  }: { symlink?: boolean } = {}
): ChzzkVodArtifactIdentity {
  const bigintStatus = status as unknown as {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    isFile: () => boolean;
  };
  const size = Number(bigintStatus.size);
  return {
    size,
    mtimeMs: Number(bigintStatus.mtimeNs) / 1_000_000,
    dev: bigintStatus.dev.toString(),
    ino: bigintStatus.ino.toString(),
    mtimeNs: bigintStatus.mtimeNs.toString(),
    ctimeNs: bigintStatus.ctimeNs.toString(),
    regular: bigintStatus.isFile(),
    symlink
  };
}

function sameArtifactIdentity(
  left: Readonly<ChzzkVodArtifactIdentity>,
  right: Readonly<ChzzkVodArtifactIdentity>
): boolean {
  return (
    left.regular === right.regular
    && left.symlink === right.symlink
    && left.size === right.size
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
}

async function inspectExactArtifactIdentity(
  artifactPath: string
): Promise<ChzzkVodArtifactIdentity> {
  const pathStatus = await lstat(artifactPath, { bigint: true });
  const identity = artifactIdentityFromStats(pathStatus, {
    symlink: pathStatus.isSymbolicLink()
  });
  if (
    !identity.regular
    || identity.symlink
    || !Number.isSafeInteger(identity.size)
    || identity.size <= 0
  ) {
    throw new ChzzkVodJobManagerError(
      "로컬 편집 미디어가 regular non-symlink 파일이 아닙니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  return identity;
}

async function hashExactArtifact(
  artifactPath: string,
  expectedIdentity: Readonly<ChzzkVodArtifactIdentity>,
  signal?: AbortSignal
): Promise<ChzzkVodArtifactVerification> {
  signal?.throwIfAborted();
  const handle = await open(
    artifactPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = artifactIdentityFromStats(
      await handle.stat({ bigint: true })
    );
    if (
      !sameArtifactIdentity(before, expectedIdentity)
      || !before.regular
      || before.symlink
    ) {
      throw new ChzzkVodJobManagerError(
        "검증 중 로컬 편집 미디어 파일이 바뀌었습니다.",
        "MEDIA_VERIFICATION_FAILED"
      );
    }
    const hash = createHash("sha256");
    const chunkHashesSha256: string[] = [];
    let position = 0;
    while (position < before.size) {
      signal?.throwIfAborted();
      const chunkLength = Math.min(
        VOD_ARTIFACT_CHUNK_BYTES,
        before.size - position
      );
      const buffer = Buffer.allocUnsafe(chunkLength);
      let chunkOffset = 0;
      while (chunkOffset < chunkLength) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(
          buffer,
          chunkOffset,
          chunkLength - chunkOffset,
          position + chunkOffset
        );
        if (bytesRead <= 0) {
          throw new ChzzkVodJobManagerError(
            "로컬 편집 미디어를 끝까지 읽지 못했습니다.",
            "MEDIA_VERIFICATION_FAILED"
          );
        }
        chunkOffset += bytesRead;
      }
      hash.update(buffer);
      chunkHashesSha256.push(
        createHash("sha256").update(buffer).digest("hex")
      );
      position += chunkLength;
    }
    const after = artifactIdentityFromStats(
      await handle.stat({ bigint: true })
    );
    const pathAfterStatus = await lstat(artifactPath, { bigint: true });
    const pathAfter = artifactIdentityFromStats(pathAfterStatus, {
      symlink: pathAfterStatus.isSymbolicLink()
    });
    if (
      !sameArtifactIdentity(after, before)
      || !sameArtifactIdentity(pathAfter, before)
    ) {
      throw new ChzzkVodJobManagerError(
        "검증 중 로컬 편집 미디어 파일이 바뀌었습니다.",
        "MEDIA_VERIFICATION_FAILED"
      );
    }
    return Object.freeze({
      hashSha256: hash.digest("hex"),
      chunkSizeBytes: VOD_ARTIFACT_CHUNK_BYTES,
      chunkHashesSha256: Object.freeze(chunkHashesSha256)
    });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function pathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function purgeExactManagedArtifact(
  artifactPath: string,
  artifactRoot: string,
  expectedIdentity: Readonly<ChzzkVodArtifactIdentity>,
  assertCurrentJob: () => void
): Promise<number> {
  if (!path.isAbsolute(artifactPath) || !path.isAbsolute(artifactRoot)) {
    throw new ChzzkVodJobManagerError(
      "관리형 VOD 캐시의 절대 경로 계약이 올바르지 않습니다.",
      "PURGE_UNAVAILABLE"
    );
  }
  const resolvedRoot = path.resolve(artifactRoot);
  const resolvedArtifact = path.resolve(artifactPath);
  if (!pathWithinRoot(resolvedArtifact, resolvedRoot)) {
    throw new ChzzkVodJobManagerError(
      "현재 작업의 미디어가 관리형 VOD 캐시 경계 밖에 있어 삭제하지 않았습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }

  let canonicalRoot: string;
  let canonicalParent: string;
  try {
    [canonicalRoot, canonicalParent] = await Promise.all([
      realpath(resolvedRoot),
      realpath(path.dirname(resolvedArtifact))
    ]);
  } catch {
    throw new ChzzkVodJobManagerError(
      "관리형 VOD 캐시의 canonical 경로를 검증하지 못해 삭제하지 않았습니다.",
      "PURGE_UNAVAILABLE"
    );
  }
  if (
    canonicalParent !== canonicalRoot
    && !pathWithinRoot(canonicalParent, canonicalRoot)
  ) {
    throw new ChzzkVodJobManagerError(
      "현재 작업의 canonical 미디어 경로가 관리형 VOD 캐시 밖에 있습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      resolvedArtifact,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
    );
    const handleStatus = await handle.stat({ bigint: true });
    const handleIdentity = artifactIdentityFromStats(
      handleStatus
    );
    const pathStatus = await lstat(resolvedArtifact, { bigint: true });
    const pathIdentity = artifactIdentityFromStats(pathStatus, {
      symlink: pathStatus.isSymbolicLink()
    });
    if (
      !handleIdentity.regular
      || handleIdentity.symlink
      || handleStatus.nlink !== 1n
      || pathStatus.nlink !== 1n
      || !sameArtifactIdentity(handleIdentity, expectedIdentity)
      || !sameArtifactIdentity(pathIdentity, expectedIdentity)
    ) {
      throw new ChzzkVodJobManagerError(
        "삭제 직전 로컬 VOD 캐시 identity가 바뀌었거나 외부 hard link와 공유되어 삭제하지 않았습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    assertCurrentJob();
    await unlink(resolvedArtifact);
    // The pre-unlink single-link proof rejects existing external aliases. A
    // final fd-bound link count also keeps byte accounting truthful if a
    // same-user process races a new hard link between that proof and unlink.
    const afterUnlink = await handle.stat({ bigint: true });
    return afterUnlink.nlink === 0n ? handleIdentity.size : 0;
  } catch (error) {
    if (error instanceof ChzzkVodJobManagerError) {
      throw error;
    }
    throw new ChzzkVodJobManagerError(
      "현재 작업의 로컬 VOD 캐시 파일을 안전하게 삭제하지 못했습니다.",
      "PURGE_FAILED"
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

interface ConsumerScopeDirectoryIdentity {
  dev: string;
  ino: string;
  mtimeNs: string;
  ctimeNs: string;
}

interface ConsumerScopeInventory {
  releasedBytes: number;
  releasedFiles: number;
  identity: ConsumerScopeDirectoryIdentity;
}

function directoryIdentity(status: Awaited<ReturnType<typeof lstat>> & {
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}): ConsumerScopeDirectoryIdentity {
  return {
    dev: status.dev.toString(),
    ino: status.ino.toString(),
    mtimeNs: status.mtimeNs.toString(),
    ctimeNs: status.ctimeNs.toString()
  };
}

function sameDirectoryIdentity(
  left: Readonly<ConsumerScopeDirectoryIdentity>,
  right: Readonly<ConsumerScopeDirectoryIdentity>
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryObjectIdentity(
  left: Readonly<ConsumerScopeDirectoryIdentity>,
  right: Readonly<ConsumerScopeDirectoryIdentity>
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function inspectConsumerScopeTree(
  scopeRoot: string
): Promise<ConsumerScopeInventory> {
  const rootStatus = await lstat(scopeRoot, { bigint: true });
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 scope가 안전한 실제 디렉터리가 아닙니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  const inodeRecords = new Map<string, {
    size: number;
    expectedLinks: bigint;
    linksInScope: number;
  }>();
  let releasedFiles = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const status = await lstat(candidate, { bigint: true });
      if (status.isSymbolicLink()) {
        throw new ChzzkVodJobManagerError(
          "VOD 세션 캐시 scope 안에 심볼릭 링크가 있어 삭제하지 않았습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
      if (status.isDirectory()) {
        await walk(candidate);
        continue;
      }
      if (!status.isFile()) {
        throw new ChzzkVodJobManagerError(
          "VOD 세션 캐시 scope 안에 지원하지 않는 파일 유형이 있습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
      const size = Number(status.size);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new ChzzkVodJobManagerError(
          "VOD 세션 캐시 파일 크기를 안전하게 계산하지 못했습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
      releasedFiles += 1;
      if (!Number.isSafeInteger(releasedFiles) || releasedFiles > 1_000_000) {
        throw new ChzzkVodJobManagerError(
          "VOD 세션 캐시 파일 수가 안전한 정리 상한을 넘었습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
      const inodeKey = `${status.dev.toString()}:${status.ino.toString()}`;
      const existing = inodeRecords.get(inodeKey);
      if (existing) {
        if (existing.size !== size || existing.expectedLinks !== status.nlink) {
          throw new ChzzkVodJobManagerError(
            "VOD 세션 캐시 hard-link identity가 검사 중 바뀌었습니다.",
            "PURGE_NOT_ALLOWED"
          );
        }
        existing.linksInScope += 1;
      } else {
        inodeRecords.set(inodeKey, {
          size,
          expectedLinks: status.nlink,
          linksInScope: 1
        });
      }
    }
  };
  await walk(scopeRoot);
  let releasedBytes = 0;
  for (const record of inodeRecords.values()) {
    if (record.expectedLinks !== BigInt(record.linksInScope)) {
      throw new ChzzkVodJobManagerError(
        "VOD 세션 캐시 파일이 scope 밖의 hard link와 공유되어 삭제하지 않았습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    releasedBytes += record.size;
    if (!Number.isSafeInteger(releasedBytes)) {
      throw new ChzzkVodJobManagerError(
        "VOD 세션 캐시 총량을 안전하게 계산하지 못했습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
  }
  const after = await lstat(scopeRoot, { bigint: true });
  const identity = directoryIdentity(rootStatus);
  if (
    !after.isDirectory()
    || after.isSymbolicLink()
    || !sameDirectoryIdentity(identity, directoryIdentity(after))
  ) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 scope가 검사 중 바뀌어 삭제하지 않았습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  return { releasedBytes, releasedFiles, identity };
}

function missingFileSystemEntry(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  );
}

async function removeConsumerCacheTree(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: false, maxRetries: 0 });
}

async function scavengeManagedConsumerQuarantine({
  artifactRoot,
  consumerScopeHash,
  removeTree
}: {
  artifactRoot: string;
  consumerScopeHash?: string;
  removeTree: (targetPath: string) => Promise<void>;
}): Promise<ChzzkVodQuarantineScavengeResult> {
  const emptyResult = (): ChzzkVodQuarantineScavengeResult => ({
    releasedBytes: 0,
    releasedFiles: 0,
    releasedScopes: 0
  });
  const resolvedRoot = path.resolve(artifactRoot);
  if (
    !path.isAbsolute(artifactRoot)
    || (consumerScopeHash !== undefined
      && !/^[a-f0-9]{64}$/u.test(consumerScopeHash))
  ) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine 복구 경계가 올바르지 않습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  let rootStatus: Awaited<ReturnType<typeof lstat>> & {
    dev: bigint;
    ino: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  };
  try {
    rootStatus = await lstat(resolvedRoot, { bigint: true });
  } catch (error) {
    if (missingFileSystemEntry(error)) {
      return emptyResult();
    }
    throw new ChzzkVodJobManagerError(
      "관리형 VOD 상태 root를 안전하게 검사하지 못했습니다.",
      "PURGE_UNAVAILABLE"
    );
  }
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new ChzzkVodJobManagerError(
      "관리형 VOD 상태 root가 안전한 실제 디렉터리가 아닙니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  const quarantineRoot = path.join(
    resolvedRoot,
    VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY
  );
  let quarantineStatus: typeof rootStatus;
  try {
    quarantineStatus = await lstat(quarantineRoot, { bigint: true });
  } catch (error) {
    if (missingFileSystemEntry(error)) {
      return emptyResult();
    }
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine을 안전하게 검사하지 못했습니다.",
      "PURGE_UNAVAILABLE"
    );
  }
  if (
    !quarantineStatus.isDirectory()
    || quarantineStatus.isSymbolicLink()
  ) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine이 안전한 실제 디렉터리가 아닙니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  let canonicalRoot: string;
  let canonicalQuarantineRoot: string;
  try {
    [canonicalRoot, canonicalQuarantineRoot] = await Promise.all([
      realpath(resolvedRoot),
      realpath(quarantineRoot)
    ]);
  } catch {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine canonical 경계를 확인하지 못했습니다.",
      "PURGE_UNAVAILABLE"
    );
  }
  if (
    path.dirname(canonicalQuarantineRoot) !== canonicalRoot
    || path.basename(canonicalQuarantineRoot)
      !== VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY
  ) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine이 정확한 관리형 상태 root 밖에 있습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }

  const entries = (await readdir(quarantineRoot, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const candidates: Array<{
    path: string;
    identity: ConsumerScopeDirectoryIdentity;
    inventory: ConsumerScopeInventory;
  }> = [];
  for (const entry of entries) {
    const match = VOD_CONSUMER_PURGE_QUARANTINE_CHILD_PATTERN.exec(entry.name);
    const candidatePath = path.join(quarantineRoot, entry.name);
    if (
      !match
      || !pathWithinRoot(candidatePath, quarantineRoot)
      || entry.isSymbolicLink()
    ) {
      throw new ChzzkVodJobManagerError(
        "VOD 세션 캐시 quarantine에 소유권을 증명할 수 없는 항목이 있습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    const status = await lstat(candidatePath, { bigint: true });
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new ChzzkVodJobManagerError(
        "VOD 세션 캐시 quarantine 항목이 안전한 실제 디렉터리가 아닙니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    const canonicalCandidate = await realpath(candidatePath);
    if (
      path.dirname(canonicalCandidate) !== canonicalQuarantineRoot
      || path.basename(canonicalCandidate) !== entry.name
    ) {
      throw new ChzzkVodJobManagerError(
        "VOD 세션 캐시 quarantine 항목의 canonical 경계가 올바르지 않습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    if (consumerScopeHash !== undefined && match[1] !== consumerScopeHash) {
      continue;
    }
    const inventory = await inspectConsumerScopeTree(candidatePath);
    candidates.push({
      path: candidatePath,
      identity: inventory.identity,
      inventory
    });
  }
  const afterScan = await lstat(quarantineRoot, { bigint: true });
  if (
    !afterScan.isDirectory()
    || afterScan.isSymbolicLink()
    || !sameDirectoryIdentity(
      directoryIdentity(quarantineStatus),
      directoryIdentity(afterScan)
    )
  ) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine이 검사 중 바뀌어 정리하지 않았습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }

  const result = emptyResult();
  for (const candidate of candidates) {
    const beforeRemoval = await lstat(candidate.path, { bigint: true });
    if (
      !beforeRemoval.isDirectory()
      || beforeRemoval.isSymbolicLink()
      || !sameDirectoryIdentity(
        candidate.identity,
        directoryIdentity(beforeRemoval)
      )
    ) {
      throw new ChzzkVodJobManagerError(
        "VOD 세션 캐시 quarantine 항목이 삭제 직전 바뀌었습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    try {
      await removeTree(candidate.path);
    } catch {
      throw new ChzzkVodJobManagerError(
        "남아 있던 VOD 세션 캐시 quarantine을 안전하게 삭제하지 못했습니다.",
        "PURGE_FAILED"
      );
    }
    result.releasedBytes += candidate.inventory.releasedBytes;
    result.releasedFiles += candidate.inventory.releasedFiles;
    result.releasedScopes += 1;
  }
  return result;
}

async function purgeExactManagedConsumerScope({
  artifactRoot,
  consumerId,
  requiredArtifactPath,
  quarantineNonce,
  assertCurrentConsumer,
  onScopeDetached,
  removeTree
}: {
  artifactRoot: string;
  consumerId: string;
  requiredArtifactPath: string;
  quarantineNonce: string;
  assertCurrentConsumer: () => void;
  onScopeDetached: () => void;
  removeTree: (targetPath: string) => Promise<void>;
}): Promise<{ releasedBytes: number; releasedFiles: number }> {
  const resolvedRoot = path.resolve(artifactRoot);
  const scopeRoot = vodConsumerScopeRoot(resolvedRoot, consumerId);
  const resolvedArtifact = path.resolve(requiredArtifactPath);
  if (
    !path.isAbsolute(artifactRoot)
    || !path.isAbsolute(requiredArtifactPath)
    || !pathWithinRoot(scopeRoot, resolvedRoot)
    || !pathWithinRoot(resolvedArtifact, scopeRoot)
    || !/^[a-f0-9]{32}$/u.test(quarantineNonce)
  ) {
    throw new ChzzkVodJobManagerError(
      "현재 작업의 VOD 파일이 정확한 세션 cache scope 안에 있지 않습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  let canonicalRoot: string;
  let canonicalScopeParent: string;
  try {
    [canonicalRoot, canonicalScopeParent] = await Promise.all([
      realpath(resolvedRoot),
      realpath(path.dirname(scopeRoot))
    ]);
  } catch {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 canonical 경계를 확인하지 못했습니다.",
      "PURGE_UNAVAILABLE"
    );
  }
  if (
    canonicalScopeParent !== canonicalRoot
    && !pathWithinRoot(canonicalScopeParent, canonicalRoot)
  ) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 canonical scope가 관리형 root 밖에 있습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  const inventory = await inspectConsumerScopeTree(scopeRoot);
  assertCurrentConsumer();
  const quarantineRoot = path.join(
    resolvedRoot,
    VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY
  );
  await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
  const canonicalQuarantineRoot = await realpath(quarantineRoot);
  if (!pathWithinRoot(canonicalQuarantineRoot, canonicalRoot)) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine 경계가 관리형 root 밖에 있습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  const quarantinePath = path.join(
    quarantineRoot,
    `consumer-${vodConsumerScopeHash(consumerId)}-${quarantineNonce}`
  );
  if (!pathWithinRoot(quarantinePath, canonicalQuarantineRoot)) {
    throw new ChzzkVodJobManagerError(
      "VOD 세션 캐시 quarantine 경로가 올바르지 않습니다.",
      "PURGE_NOT_ALLOWED"
    );
  }
  assertCurrentConsumer();
  await rename(scopeRoot, quarantinePath);
  onScopeDetached();
  const quarantinedStatus = await lstat(quarantinePath, { bigint: true });
  if (
    !quarantinedStatus.isDirectory()
    || quarantinedStatus.isSymbolicLink()
    || !sameDirectoryObjectIdentity(
      inventory.identity,
      directoryIdentity(quarantinedStatus)
    )
  ) {
    throw new ChzzkVodJobManagerError(
      "격리한 VOD 세션 캐시 identity가 검사 결과와 다릅니다.",
      "PURGE_FAILED"
    );
  }
  assertCurrentConsumer();
  await removeTree(quarantinePath);
  return {
    releasedBytes: inventory.releasedBytes,
    releasedFiles: inventory.releasedFiles
  };
}

function validArtifactIntegrity(
  value: unknown
): value is ChzzkVodRunnerResult["artifact"] {
  return Boolean(
    isRecord(value)
    && /^[a-f0-9]{64}$/u.test(String(value.hashSha256 || ""))
    && Number.isSafeInteger(value.sizeBytes)
    && Number(value.sizeBytes) > 0
  );
}

function validArtifactVerification(
  value: unknown,
  sizeBytes: number
): value is ChzzkVodArtifactVerification {
  if (!isRecord(value)) {
    return false;
  }
  const chunkHashesSha256 = value.chunkHashesSha256;
  return Boolean(
    /^[a-f0-9]{64}$/u.test(String(value.hashSha256 || ""))
    && value.chunkSizeBytes === VOD_ARTIFACT_CHUNK_BYTES
    && Array.isArray(chunkHashesSha256)
    && chunkHashesSha256.length === Math.ceil(
      sizeBytes / VOD_ARTIFACT_CHUNK_BYTES
    )
    && chunkHashesSha256.every((entry) => (
      typeof entry === "string" && /^[a-f0-9]{64}$/u.test(entry)
    ))
  );
}

function terminalJob(job: ChzzkVodJob): boolean {
  return ["completed", "failed", "cancelled"].includes(job.state);
}

function evictableTerminalJob(job: ChzzkVodJob): boolean {
  return terminalJob(job)
    && job.activeMediaReads === 0
    && !job.purging
    && !job.consumerPurging
    && job.purgeOperation === undefined
    && job.artifactVerification === undefined;
}

function waitForActiveMediaReadsToDrain(
  job: ChzzkVodJob,
  timeoutMs = 750
): Promise<boolean> {
  if (job.activeMediaReads === 0) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (drained: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      job.mediaReadDrainWaiters?.delete(onDrain);
      if (job.mediaReadDrainWaiters?.size === 0) {
        delete job.mediaReadDrainWaiters;
      }
      resolve(drained);
    };
    const onDrain = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    (job.mediaReadDrainWaiters ||= new Set()).add(onDrain);
    if (job.activeMediaReads === 0) {
      finish(true);
    }
  });
}

export function createChzzkVodJobManager({
  runner,
  artifactRoot,
  inspectArtifactIdentity = inspectExactArtifactIdentity,
  hashArtifact = hashExactArtifact,
  removeConsumerCacheTree: removeConsumerCacheTreeImpl = removeConsumerCacheTree,
  maximumConcurrentJobs = 1,
  maximumJobRecords = DEFAULT_MAX_VOD_JOB_RECORDS,
  maximumQueuedJobs = DEFAULT_MAX_QUEUED_VOD_JOBS,
  completedTtlMs = DEFAULT_COMPLETED_VOD_JOB_TTL_MS,
  failedTtlMs = DEFAULT_FAILED_VOD_JOB_TTL_MS,
  randomBytesImpl = randomBytes,
  now = Date.now
}: ChzzkVodJobManagerOptions) {
  const jobs = new Map<string, ChzzkVodJob>();
  const purgeTombstones = new Map<string, ChzzkVodPurgeTombstone>();
  const consumerPurgeTombstones = new Map<
    string,
    ChzzkVodConsumerPurgeTombstone
  >();
  const consumerPurgeOperations = new Map<
    string,
    ChzzkVodConsumerPurgeOperation
  >();
  const queue: ChzzkVodJob[] = [];
  const activeRuns = new Set<Promise<void>>();
  const verificationController = new AbortController();
  let quarantineOperationTail: Promise<void> = Promise.resolve();
  let initializationOperation:
    | Promise<ChzzkVodQuarantineScavengeResult>
    | undefined;
  let runningJobs = 0;
  let closing = false;
  const concurrency = Math.max(1, Math.min(4, Math.round(maximumConcurrentJobs)));
  const recordLimit = Math.max(
    concurrency,
    Math.min(4_096, Math.round(maximumJobRecords))
  );
  const queueLimit = Math.max(
    1,
    Math.min(recordLimit, Math.round(maximumQueuedJobs))
  );
  const completedLifetime = Math.max(1_000, Math.round(completedTtlMs));
  const failedLifetime = Math.max(1_000, Math.round(failedTtlMs));
  const managedArtifactRoot = artifactRoot === undefined
    ? null
    : path.resolve(artifactRoot);

  if (
    artifactRoot !== undefined
    && !path.isAbsolute(artifactRoot)
  ) {
    throw new ChzzkVodJobManagerError(
      "관리형 VOD 캐시 root는 정규화된 절대 경로여야 합니다.",
      "PURGE_UNAVAILABLE"
    );
  }

  const runQuarantineOperation = <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    const result = quarantineOperationTail.then(operation, operation);
    quarantineOperationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const initialize = (): Promise<ChzzkVodQuarantineScavengeResult> => {
    if (initializationOperation) {
      return initializationOperation;
    }
    initializationOperation = managedArtifactRoot
      ? runQuarantineOperation(() => scavengeManagedConsumerQuarantine({
        artifactRoot: managedArtifactRoot,
        removeTree: removeConsumerCacheTreeImpl
      }))
      : Promise.resolve({
        releasedBytes: 0,
        releasedFiles: 0,
        releasedScopes: 0
      });
    return initializationOperation;
  };

  const compactQueue = (): void => {
    let nextIndex = 0;
    for (const job of queue) {
      if (job.state === "queued" && jobs.get(job.id) === job) {
        queue[nextIndex] = job;
        nextIndex += 1;
      }
    }
    queue.length = nextIndex;
  };

  const evictExpired = () => {
    const timestamp = now();
    for (const [id, job] of jobs) {
      const lifetime = job.state === "completed"
        ? completedLifetime
        : (job.state === "failed" || job.state === "cancelled")
          ? failedLifetime
          : null;
      const retainedAt = job.state === "completed"
        ? job.lastAccessAt
        : job.updatedAt;
      if (
        lifetime !== null
        && timestamp - retainedAt >= lifetime
        && evictableTerminalJob(job)
        && jobs.get(id) === job
      ) {
        jobs.delete(id);
      }
    }
    for (const [id, tombstone] of purgeTombstones) {
      if (timestamp - tombstone.purgedAt >= completedLifetime) {
        purgeTombstones.delete(id);
      }
    }
    for (const [id, tombstone] of consumerPurgeTombstones) {
      if (timestamp - tombstone.purgedAt >= completedLifetime) {
        consumerPurgeTombstones.delete(id);
      }
    }
    compactQueue();
  };

  const evictOldestTerminal = (): boolean => {
    const candidate = [...jobs.values()]
      .filter(evictableTerminalJob)
      .sort((left, right) => (
        (left.state === "completed" ? left.lastAccessAt : left.updatedAt)
          - (right.state === "completed" ? right.lastAccessAt : right.updatedAt)
        || left.createdAt - right.createdAt
      ))[0];
    if (!candidate) {
      return false;
    }
    if (jobs.get(candidate.id) !== candidate) {
      return false;
    }
    jobs.delete(candidate.id);
    compactQueue();
    return true;
  };

  const invalidateArtifact = (job: ChzzkVodJob): void => {
    job.state = "failed";
    job.progress = 0;
    job.reused = false;
    job.message = "준비된 VOD 미디어 무결성 검증에 실패했습니다.";
    job.error = {
      code: "MEDIA_VERIFICATION_FAILED",
      message: "준비된 로컬 미디어가 receipt와 일치하지 않습니다. 다시 준비해 주세요."
    };
    delete job.result;
    delete job.artifactIntegrity;
    delete job.artifactVerificationDigest;
    delete job.verifiedArtifactIdentity;
    job.accessToken = randomBytesImpl(32).toString("base64url");
    job.updatedAt = now();
  };

  const verifyArtifactNow = async (
    job: ChzzkVodJob
  ): Promise<ChzzkVodArtifactIdentity | null> => {
    if (job.state !== "completed" || !job.result || !job.artifactIntegrity) {
      return null;
    }
    try {
      const artifact = await inspectArtifactIdentity(job.result.artifactPath);
      if (
        !artifact.regular
        || artifact.symlink
        || !Number.isSafeInteger(artifact.size)
        || artifact.size <= 0
        || artifact.size !== job.artifactIntegrity.sizeBytes
      ) {
        throw new ChzzkVodJobManagerError(
          "준비된 로컬 미디어의 파일 유형 또는 크기가 receipt와 다릅니다.",
          "MEDIA_VERIFICATION_FAILED"
        );
      }
      if (
        job.verifiedArtifactIdentity
        && job.artifactVerificationDigest
        && sameArtifactIdentity(job.verifiedArtifactIdentity, artifact)
      ) {
        return artifact;
      }
      const verification = await hashArtifact(
        job.result.artifactPath,
        artifact,
        verificationController.signal
      );
      if (
        !validArtifactVerification(verification, artifact.size)
        || verification.hashSha256 !== job.artifactIntegrity.hashSha256
      ) {
        throw new ChzzkVodJobManagerError(
          "준비된 로컬 미디어의 SHA-256이 receipt와 다릅니다.",
          "MEDIA_VERIFICATION_FAILED"
        );
      }
      job.artifactVerificationDigest = Object.freeze({
        hashSha256: verification.hashSha256,
        chunkSizeBytes: VOD_ARTIFACT_CHUNK_BYTES,
        chunkHashesSha256: Object.freeze([
          ...verification.chunkHashesSha256
        ])
      });
      job.verifiedArtifactIdentity = Object.freeze({ ...artifact });
      return artifact;
    } catch {
      invalidateArtifact(job);
      return null;
    }
  };

  const verifiedArtifact = (
    job: ChzzkVodJob
  ): Promise<ChzzkVodArtifactIdentity | null> => {
    if (job.artifactVerification) {
      return job.artifactVerification;
    }
    const verification = verifyArtifactNow(job);
    job.artifactVerification = verification;
    void verification.finally(() => {
      if (job.artifactVerification === verification) {
        delete job.artifactVerification;
      }
    });
    return verification;
  };

  const startNext = () => {
    while (!closing && runningJobs < concurrency) {
      const job = queue.shift();
      if (!job) {
        return;
      }
      if (job.controller.signal.aborted || job.state === "cancelled") {
        continue;
      }
      runningJobs += 1;
      job.state = "resolving";
      job.message = `${requestPlatformLabel(job.request)} 원본 정보를 확인하는 중`;
      job.updatedAt = now();
      const execution = (async () => {
        try {
          const result = await runner({
            ...job.request,
            signal: job.controller.signal,
            onProgress: (update) => {
              if (job.controller.signal.aborted || !ALLOWED_STAGES.has(update.stage)) {
                return;
              }
              job.state = update.stage;
              job.progress = Math.max(0, Math.min(0.999, Number(update.progress) || 0));
              job.message = safeMessage(update.message, "VOD 구간을 준비하는 중");
              job.updatedAt = now();
            }
          });
          if (job.controller.signal.aborted) {
            job.state = "cancelled";
            job.progress = 0;
            job.message = "VOD 구간 준비를 취소했습니다.";
            return;
          }
          if (
            !result
            || typeof result.artifactPath !== "string"
            || !result.artifactPath
            || result.manifest === undefined
            || !validArtifactIntegrity(result.artifact)
          ) {
            throw new ChzzkVodJobManagerError(
              "완료된 로컬 미디어 receipt가 올바르지 않습니다.",
              "MEDIA_VERIFICATION_FAILED"
            );
          }
          if (!manifestMatchesRequest(result.manifest, job.request)) {
            throw new ChzzkVodJobManagerError(
              "완료된 로컬 미디어 receipt의 원본이 요청한 VOD와 일치하지 않습니다.",
              "MEDIA_VERIFICATION_FAILED"
            );
          }
          const resolvedArtifactPath = path.resolve(result.artifactPath);
          const crossConsumerPathCollision = [...jobs.values()].some((other) => (
            other !== job
            && other.request.consumerId !== job.request.consumerId
            && other.state === "completed"
            && Boolean(other.result)
            && path.resolve(other.result?.artifactPath || "") === resolvedArtifactPath
          ));
          if (crossConsumerPathCollision) {
            throw new ChzzkVodJobManagerError(
              "서로 다른 편집 세션의 VOD 캐시가 같은 파일 경로를 공유해 연결을 거부했습니다.",
              "MEDIA_VERIFICATION_FAILED"
            );
          }
          job.result = {
            manifest: result.manifest,
            artifactPath: result.artifactPath,
            artifact: {
              hashSha256: result.artifact.hashSha256,
              sizeBytes: result.artifact.sizeBytes
            },
            reused: Boolean(result.reused)
          };
          job.artifactIntegrity = Object.freeze({
            hashSha256: result.artifact.hashSha256,
            sizeBytes: result.artifact.sizeBytes
          });
          job.reused = Boolean(result.reused);
          job.state = "completed";
          job.progress = 1;
          job.lastAccessAt = now();
          job.message = result.reused
            ? "이 기기에 준비된 편집용 구간을 다시 연결했습니다."
            : "이 기기에 편집용 구간을 준비했습니다.";
        } catch (error: unknown) {
          if (job.controller.signal.aborted) {
            job.state = "cancelled";
            job.progress = 0;
            job.message = "VOD 구간 준비를 취소했습니다.";
            return;
          }
          job.state = "failed";
          job.progress = 0;
          job.message = "VOD 구간 준비에 실패했습니다.";
          const publicErrorCode = safeErrorCode(error);
          job.error = {
            code: publicErrorCode,
            message: safeErrorMessage(error, publicErrorCode)
          };
        } finally {
          job.updatedAt = now();
          runningJobs -= 1;
          startNext();
        }
      })();
      activeRuns.add(execution);
      void execution.finally(() => activeRuns.delete(execution));
    }
  };

  const create = (rawRequest: unknown): ChzzkVodJob => {
    if (closing) {
      throw new ChzzkVodJobManagerError(
        "로컬 companion이 종료 중이라 새 VOD 작업을 받을 수 없습니다.",
        "BUSY"
      );
    }
    evictExpired();
    const request = normalizeChzzkVodMaterializationRequest(rawRequest);
    if (consumerPurgeOperations.has(request.consumerId)) {
      throw new ChzzkVodJobManagerError(
        "이 편집 세션의 VOD 캐시를 정리하는 중이라 새 작업을 시작할 수 없습니다.",
        "BUSY"
      );
    }
    const fingerprint = requestFingerprint(request);
    const id = `vod_${fingerprint.slice(0, 40)}`;
    const existing = jobs.get(id);
    if (existing && (existing.purging || existing.purgeOperation !== undefined)) {
      throw new ChzzkVodJobManagerError(
        "동일한 로컬 VOD 캐시를 삭제하는 중입니다. 삭제가 끝난 뒤 다시 준비해 주세요.",
        "BUSY"
      );
    }
    if (
      existing
      && existing.state !== "failed"
      && existing.state !== "cancelled"
    ) {
      return existing;
    }
    purgeTombstones.delete(id);
    consumerPurgeTombstones.delete(id);
    while (jobs.size >= recordLimit && evictOldestTerminal()) {
      // Preserve every active record, evicting only the oldest terminal one.
    }
    compactQueue();
    const queuedJobs = queue.length;
    if (jobs.size >= recordLimit || queuedJobs >= queueLimit) {
      throw new ChzzkVodJobManagerError(
        "로컬 VOD 작업 대기열이 가득 찼습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.",
        "BUSY"
      );
    }
    const timestamp = now();
    const job: ChzzkVodJob = {
      id,
      request,
      state: "queued",
      progress: 0,
      message: `${requestPlatformLabel(request)} VOD 구간 준비 대기 중`,
      reused: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAccessAt: timestamp,
      accessToken: randomBytesImpl(32).toString("base64url"),
      controller: new AbortController(),
      activeMediaReads: 0,
      purging: false,
      consumerPurging: false
    };
    jobs.set(id, job);
    queue.push(job);
    startNext();
    return job;
  };

  const get = (jobId: string): ChzzkVodJob | null => {
    evictExpired();
    return jobs.get(jobId) || null;
  };

  const cancel = (jobId: string): ChzzkVodJob | null => {
    const job = jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (
      job.consumerPurging
      || consumerPurgeOperations.has(job.request.consumerId)
    ) {
      throw new ChzzkVodJobManagerError(
        "이 편집 세션의 전체 VOD 캐시를 정리하는 중입니다.",
        "BUSY"
      );
    }
    if (job.state !== "completed" && job.state !== "failed" && job.state !== "cancelled") {
      job.controller.abort(new DOMException("사용자가 작업을 취소했습니다.", "AbortError"));
      job.state = "cancelled";
      job.progress = 0;
      job.message = "VOD 구간 준비를 취소했습니다.";
      job.updatedAt = now();
      compactQueue();
    }
    return job;
  };

  const publicStatus = async (
    job: ChzzkVodJob,
    baseUrl: string
  ): Promise<ChzzkVodPublicStatus> => {
    const assertAvailable = (): void => {
      if (
        jobs.get(job.id) !== job
        || job.purging
        || job.consumerPurging
        || job.purgeOperation !== undefined
      ) {
        throw new ChzzkVodJobManagerError(
          "로컬 VOD 캐시를 삭제하거나 작업 기록을 교체하는 중이라 현재 상태를 제공할 수 없습니다.",
          "BUSY"
        );
      }
    };
    assertAvailable();
    const artifact = job.state === "completed"
      ? await verifiedArtifact(job)
      : null;
    assertAvailable();
    if (job.state !== "completed" || artifact) {
      job.lastAccessAt = now();
    }
    const status: ChzzkVodPublicStatus = {
      schema: CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA,
      jobId: job.id,
      state: job.state,
      progress: job.progress,
      message: job.message,
      reused: job.reused
    };
    if (job.error) {
      status.error = { ...job.error };
    }
    if (job.state === "completed" && job.result) {
      if (!artifact || !job.result) {
        return {
          schema: CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA,
          jobId: job.id,
          state: job.state,
          progress: job.progress,
          message: job.message,
          reused: job.reused,
          ...(job.error ? { error: { ...job.error } } : {})
        };
      }
      const mediaUrl = new URL(`/v1/chzzk-vod/media/${job.id}`, baseUrl);
      mediaUrl.searchParams.set("access", job.accessToken);
      status.materialization = job.result.manifest;
      status.media = {
        url: mediaUrl.toString(),
        name: fileNameFromResult(job.result),
        size: artifact.size,
        type: "video/mp4",
        lastModified: Math.max(1, Math.round(artifact.mtimeMs))
      };
    }
    return status;
  };

  const resolveMedia = async (jobId: string, accessToken: unknown): Promise<{
    artifactPath: string;
    artifactIdentity: Readonly<ChzzkVodArtifactIdentity>;
    artifactIntegrity: Readonly<ChzzkVodRunnerResult["artifact"]>;
    artifactVerification: Readonly<ChzzkVodArtifactVerification>;
    job: ChzzkVodJob;
  } | null> => {
    evictExpired();
    const job = jobs.get(jobId);
    if (
      !job
      || job.state !== "completed"
      || !job.result
      || job.purging
      || job.consumerPurging
      || !accessTokenMatches(job.accessToken, accessToken)
    ) {
      return null;
    }
    const artifactIdentity = await verifiedArtifact(job);
    if (
      !artifactIdentity
      || !job.result
      || !job.artifactIntegrity
      || !job.artifactVerificationDigest
    ) {
      return null;
    }
    job.lastAccessAt = now();
    return {
      artifactPath: job.result.artifactPath,
      artifactIdentity,
      artifactIntegrity: job.artifactIntegrity,
      artifactVerification: job.artifactVerificationDigest,
      job
    };
  };

  const acquireMedia = async (
    jobId: string,
    accessToken: unknown
  ): Promise<Awaited<ReturnType<typeof resolveMedia>> & {
    release: () => void;
  } | null> => {
    const media = await resolveMedia(jobId, accessToken);
    if (
      !media
      || media.job.purging
      || media.job.consumerPurging
      || jobs.get(jobId) !== media.job
    ) {
      return null;
    }
    media.job.activeMediaReads += 1;
    let released = false;
    return {
      ...media,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        media.job.activeMediaReads = Math.max(
          0,
          media.job.activeMediaReads - 1
        );
        if (media.job.activeMediaReads === 0) {
          for (const notify of media.job.mediaReadDrainWaiters || []) {
            notify();
          }
        }
      }
    };
  };

  const purge = async (
    jobId: string,
    accessToken: unknown,
    rawIdentity: unknown
  ): Promise<ChzzkVodCachePurgeResult | null> => {
    evictExpired();
    const identity = normalizeChzzkVodCachePurgeIdentity(
      rawIdentity,
      jobId
    );
    const tombstone = purgeTombstones.get(jobId);
    if (tombstone) {
      if (!accessTokenMatches(tombstone.accessToken, accessToken)) {
        return null;
      }
      if (!cachePurgeIdentityMatches(tombstone.identity, identity)) {
        throw new ChzzkVodJobManagerError(
          "이미 삭제된 VOD 캐시의 identity가 현재 요청과 다릅니다.",
          "PURGE_IDENTITY_MISMATCH"
        );
      }
      return {
        ...tombstone.result,
        alreadyPurged: true
      };
    }

    const job = jobs.get(jobId);
    if (!job || !accessTokenMatches(job.accessToken, accessToken)) {
      return null;
    }
    if (job.consumerPurging || consumerPurgeOperations.has(job.request.consumerId)) {
      throw new ChzzkVodJobManagerError(
        "이 편집 세션의 전체 VOD 캐시를 정리하는 중입니다.",
        "BUSY"
      );
    }
    if (job.state !== "completed" || !job.result) {
      throw new ChzzkVodJobManagerError(
        "완료된 VOD 준비 작업만 캐시를 삭제할 수 있습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    const actualIdentity = cachePurgeIdentityForJob(job);
    if (!actualIdentity || !cachePurgeIdentityMatches(actualIdentity, identity)) {
      throw new ChzzkVodJobManagerError(
        "현재 완료 작업과 캐시 삭제 요청의 원본 identity가 다릅니다.",
        "PURGE_IDENTITY_MISMATCH"
      );
    }
    if (!managedArtifactRoot) {
      throw new ChzzkVodJobManagerError(
        "검증된 관리형 VOD 캐시 root가 없어 삭제 기능을 사용할 수 없습니다.",
        "PURGE_UNAVAILABLE"
      );
    }
    if (job.purgeOperation) {
      return job.purgeOperation;
    }

    const assertCurrentJob = (): void => {
      if (jobs.get(jobId) !== job) {
        throw new ChzzkVodJobManagerError(
          "캐시 삭제 중 작업 기록이 교체되어 현재 편집용 MP4를 삭제하지 않았습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
    };

    job.purging = true;
    const operation = (async (): Promise<ChzzkVodCachePurgeResult> => {
      assertCurrentJob();
      if (!await waitForActiveMediaReadsToDrain(job)) {
        throw new ChzzkVodJobManagerError(
          "로컬 VOD 미디어 읽기가 제한 시간 안에 끝나지 않아 현재 편집용 MP4를 삭제하지 않았습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
      assertCurrentJob();
      const artifactIdentity = await verifiedArtifact(job);
      if (
        !artifactIdentity
        || job.state !== "completed"
        || !job.result
        || job.activeMediaReads > 0
      ) {
        throw new ChzzkVodJobManagerError(
          "삭제 직전 완료된 VOD 캐시의 무결성 또는 사용 상태가 바뀌었습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
      assertCurrentJob();
      const releasedBytes = await purgeExactManagedArtifact(
        job.result.artifactPath,
        managedArtifactRoot,
        artifactIdentity,
        assertCurrentJob
      );
      const result: ChzzkVodCachePurgeResult = {
        schema: CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA,
        jobId,
        state: "purged",
        alreadyPurged: false,
        releasedBytes,
        materialization: { ...identity.materialization },
        source: { ...identity.source }
      };
      assertCurrentJob();
      purgeTombstones.set(jobId, {
        accessToken: job.accessToken,
        identity: Object.freeze({
          ...identity,
          materialization: Object.freeze({ ...identity.materialization }),
          source: Object.freeze({ ...identity.source })
        }),
        result: Object.freeze({
          ...result,
          materialization: Object.freeze({ ...result.materialization }),
          source: Object.freeze({ ...result.source })
        }),
        purgedAt: now()
      });
      assertCurrentJob();
      jobs.delete(jobId);
      compactQueue();
      return result;
    })();
    job.purgeOperation = operation;
    try {
      return await operation;
    } finally {
      if (jobs.get(jobId) === job) {
        job.purging = false;
        if (job.purgeOperation === operation) {
          delete job.purgeOperation;
        }
      }
    }
  };

  const purgeConsumerCache = async (
    jobId: string,
    accessToken: unknown,
    rawIdentity: unknown
  ): Promise<ChzzkVodConsumerCachePurgeResult | null> => {
    evictExpired();
    const identity = normalizeChzzkVodConsumerCachePurgeIdentity(
      rawIdentity,
      jobId
    );
    const tombstone = consumerPurgeTombstones.get(jobId);
    if (tombstone) {
      if (!accessTokenMatches(tombstone.accessToken, accessToken)) {
        return null;
      }
      if (!consumerCachePurgeIdentityMatches(tombstone.identity, identity)) {
        throw new ChzzkVodJobManagerError(
          "이미 삭제된 VOD 세션 캐시의 identity가 현재 요청과 다릅니다.",
          "PURGE_IDENTITY_MISMATCH"
        );
      }
      return {
        ...tombstone.result,
        alreadyPurged: true
      };
    }

    const job = jobs.get(jobId);
    if (!job || !accessTokenMatches(job.accessToken, accessToken)) {
      return null;
    }
    const actualIdentity = consumerCachePurgeIdentityForJob(job);
    if (
      !actualIdentity
      || !consumerCachePurgeIdentityMatches(actualIdentity, identity)
    ) {
      throw new ChzzkVodJobManagerError(
        "현재 완료 작업과 세션 캐시 삭제 요청의 identity가 다릅니다.",
        "PURGE_IDENTITY_MISMATCH"
      );
    }
    if (job.state !== "completed" || !job.result) {
      throw new ChzzkVodJobManagerError(
        "완료된 VOD 준비 작업만 세션 캐시를 삭제할 수 있습니다.",
        "PURGE_NOT_ALLOWED"
      );
    }
    if (!managedArtifactRoot) {
      throw new ChzzkVodJobManagerError(
        "검증된 관리형 VOD 캐시 root가 없어 세션 삭제 기능을 사용할 수 없습니다.",
        "PURGE_UNAVAILABLE"
      );
    }

    const existingOperation = consumerPurgeOperations.get(identity.consumerId);
    if (existingOperation) {
      if (
        existingOperation.jobId === jobId
        && accessTokenMatches(existingOperation.accessToken, accessToken)
        && consumerCachePurgeIdentityMatches(
          existingOperation.identity,
          identity
        )
        && existingOperation.operation
      ) {
        return existingOperation.operation;
      }
      throw new ChzzkVodJobManagerError(
        "이 편집 세션의 전체 VOD 캐시를 이미 정리하는 중입니다.",
        "BUSY"
      );
    }

    const scopeJobs = [...jobs.values()].filter((candidate) => (
      candidate.request.consumerId === identity.consumerId
    ));
    if (
      !scopeJobs.includes(job)
      || scopeJobs.some((candidate) => (
        !terminalJob(candidate)
        || candidate.purging
        || candidate.consumerPurging
        || candidate.purgeOperation !== undefined
      ))
    ) {
      throw new ChzzkVodJobManagerError(
        "이 편집 세션에 준비 중이거나 개별 삭제 중인 VOD 작업이 있습니다.",
        "BUSY"
      );
    }
    const scopeRoot = vodConsumerScopeRoot(
      managedArtifactRoot,
      identity.consumerId
    );
    if (scopeJobs.some((candidate) => (
      candidate.result
      && !pathWithinRoot(
        path.resolve(candidate.result.artifactPath),
        scopeRoot
      )
    ))) {
      throw new ChzzkVodJobManagerError(
        "이 편집 세션의 VOD 작업 경로가 정확한 consumer cache scope와 다릅니다.",
        "PURGE_NOT_ALLOWED"
      );
    }

    const operationDescriptor: ChzzkVodConsumerPurgeOperation = {
      jobId,
      accessToken: job.accessToken,
      identity: Object.freeze({
        ...identity,
        materialization: Object.freeze({ ...identity.materialization }),
        source: Object.freeze({ ...identity.source })
      })
    };
    for (const candidate of scopeJobs) {
      candidate.consumerPurging = true;
    }
    consumerPurgeOperations.set(identity.consumerId, operationDescriptor);

    const assertCurrentConsumer = (): void => {
      const current = consumerPurgeOperations.get(identity.consumerId);
      const currentScopeJobs = [...jobs.values()].filter((candidate) => (
        candidate.request.consumerId === identity.consumerId
      ));
      if (
        current !== operationDescriptor
        || currentScopeJobs.length !== scopeJobs.length
        || scopeJobs.some((candidate) => (
          jobs.get(candidate.id) !== candidate
          || !candidate.consumerPurging
        ))
      ) {
        throw new ChzzkVodJobManagerError(
          "세션 캐시 삭제 중 동일 consumer 작업 집합이 바뀌었습니다.",
          "PURGE_NOT_ALLOWED"
        );
      }
    };

    let scopeDetached = false;
    const operation = (async (): Promise<ChzzkVodConsumerCachePurgeResult> => {
      try {
        assertCurrentConsumer();
        const drained = await Promise.all(
          scopeJobs.map((candidate) => waitForActiveMediaReadsToDrain(candidate))
        );
        if (drained.some((value) => !value)) {
          throw new ChzzkVodJobManagerError(
            "로컬 VOD 미디어 읽기가 제한 시간 안에 끝나지 않아 세션 캐시를 삭제하지 않았습니다.",
            "PURGE_NOT_ALLOWED"
          );
        }
        assertCurrentConsumer();
        const priorVerifications = scopeJobs
          .map((candidate) => candidate.artifactVerification)
          .filter((verification): verification is Promise<ChzzkVodArtifactIdentity | null> => (
            verification !== undefined
          ));
        await Promise.allSettled(priorVerifications);
        assertCurrentConsumer();
        const artifactIdentity = await verifiedArtifact(job);
        if (
          !artifactIdentity
          || job.state !== "completed"
          || !job.result
          || job.activeMediaReads > 0
        ) {
          throw new ChzzkVodJobManagerError(
            "삭제 직전 완료된 VOD 캐시의 무결성 또는 사용 상태가 바뀌었습니다.",
            "PURGE_NOT_ALLOWED"
          );
        }
        assertCurrentConsumer();
        const requiredArtifactPath = job.result.artifactPath;
        const released = await runQuarantineOperation(async () => {
          const recovered = await scavengeManagedConsumerQuarantine({
            artifactRoot: managedArtifactRoot,
            consumerScopeHash: vodConsumerScopeHash(identity.consumerId),
            removeTree: removeConsumerCacheTreeImpl
          });
          const current = await purgeExactManagedConsumerScope({
            artifactRoot: managedArtifactRoot,
            consumerId: identity.consumerId,
            requiredArtifactPath,
            quarantineNonce: randomBytesImpl(16).toString("hex"),
            assertCurrentConsumer,
            onScopeDetached: () => {
              scopeDetached = true;
            },
            removeTree: removeConsumerCacheTreeImpl
          });
          return {
            releasedBytes: recovered.releasedBytes + current.releasedBytes,
            releasedFiles: recovered.releasedFiles + current.releasedFiles
          };
        });
        const result: ChzzkVodConsumerCachePurgeResult = {
          schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA,
          jobId,
          consumerId: identity.consumerId,
          state: "purged",
          alreadyPurged: false,
          releasedBytes: released.releasedBytes,
          releasedFiles: released.releasedFiles,
          materialization: { ...identity.materialization },
          source: { ...identity.source }
        };
        consumerPurgeTombstones.set(jobId, {
          accessToken: job.accessToken,
          identity: operationDescriptor.identity,
          result: Object.freeze({
            ...result,
            materialization: Object.freeze({ ...result.materialization }),
            source: Object.freeze({ ...result.source })
          }),
          purgedAt: now()
        });
        for (const candidate of scopeJobs) {
          jobs.delete(candidate.id);
        }
        compactQueue();
        return result;
      } catch (error) {
        if (scopeDetached) {
          for (const candidate of scopeJobs) {
            if (jobs.get(candidate.id) === candidate) {
              jobs.delete(candidate.id);
            }
          }
          compactQueue();
        }
        if (error instanceof ChzzkVodJobManagerError) {
          throw error;
        }
        throw new ChzzkVodJobManagerError(
          "현재 편집 세션의 로컬 VOD 캐시를 안전하게 삭제하지 못했습니다.",
          "PURGE_FAILED"
        );
      }
    })();
    operationDescriptor.operation = operation;
    try {
      return await operation;
    } finally {
      if (consumerPurgeOperations.get(identity.consumerId) === operationDescriptor) {
        consumerPurgeOperations.delete(identity.consumerId);
      }
      if (!scopeDetached) {
        for (const candidate of scopeJobs) {
          if (jobs.get(candidate.id) === candidate) {
            candidate.consumerPurging = false;
          }
        }
      }
    }
  };

  const close = async (): Promise<void> => {
    closing = true;
    for (const job of jobs.values()) {
      if (!job.controller.signal.aborted && !terminalJob(job)) {
        job.controller.abort(new DOMException("로컬 companion을 종료합니다.", "AbortError"));
        job.state = "cancelled";
        job.progress = 0;
        job.message = "로컬 companion 종료로 VOD 구간 준비를 취소했습니다.";
        job.updatedAt = now();
      }
    }
    if (!verificationController.signal.aborted) {
      verificationController.abort(new DOMException(
        "로컬 companion을 종료합니다.",
        "AbortError"
      ));
    }
    queue.length = 0;
    await Promise.allSettled([...activeRuns]);
    await Promise.allSettled(
      [...consumerPurgeOperations.values()]
        .map((entry) => entry.operation)
        .filter((operation): operation is Promise<ChzzkVodConsumerCachePurgeResult> => (
          operation !== undefined
        ))
    );
    if (initializationOperation) {
      await Promise.allSettled([initializationOperation]);
    }
    await quarantineOperationTail;
  };

  return {
    initialize,
    create,
    get,
    cancel,
    publicStatus,
    resolveMedia,
    acquireMedia,
    purge,
    purgeConsumerCache,
    close,
    get size() {
      return jobs.size;
    },
    get queuedSize() {
      compactQueue();
      return queue.length;
    }
  };
}

export type ChzzkVodJobManager = ReturnType<typeof createChzzkVodJobManager>;
