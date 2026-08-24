/**
 * First-party Kirinuki adapter code. It invokes separately installed yt-dlp
 * and FFmpeg executables; it does not copy, embed, or relicense their source.
 * Exact provenance and runtime terms are recorded in
 * src/lib/third-party-attributions.ts and legal/RUNTIME_DEPENDENCIES.md.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { BigIntStats, Dirent } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  statfs as statFileSystem,
  writeFile
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  DEFAULT_MATERIALIZATION_HANDLE_MS,
  createMaterializationClipCoverages,
  mergeMaterializationClipCoverages,
  normalizeChzzkVodMaterialization
} from "../src/lib/chzzk-vod-materialization.js";
import type {
  ChzzkVodMaterialization,
  LogicalMaterializationWindow,
  MaterializationClipCoverage,
  MaterializationClipRange,
  MaterializationDesiredEditableRange,
  MaterializationWindow
} from "../src/lib/chzzk-vod-materialization.js";
import {
  deriveSoopVodSourceClockIdentity,
  normalizeSoopVodSourceClockIdentity,
  sameSoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import type {
  SoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import {
  acquireExternalVodDirectSection,
  writePrivateNodeRootCaFile
} from "./external-vod-direct-acquirer.js";
import type {
  ExternalVodDirectSectionEvidence
} from "./external-vod-direct-acquirer.js";
import {
  assertExternalVodDirectAcquisitionMatchesPartProof,
  assertExternalVodClockProofSetUnchanged,
  assertExternalVodHlsAcquisitionMatchesPartProof,
  parseExternalVodPersistedClockProofSet,
  resolveExternalVodClockProofSet,
  resolveExternalVodSelectedSourceDump
} from "./external-vod-clock-resolver.js";
import type {
  ExternalVodClockMetadataPart,
  ExternalVodClockProofSetResolution,
  ExternalVodPartRuntime,
  ExternalVodPersistedClockProofSet
} from "./external-vod-clock-resolver.js";
import type {
  ExternalVodSelectedDirectInput
} from "./external-vod-clock-proof.js";
import {
  EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA,
  MAX_EXTERNAL_VOD_HLS_STREAM_EDGE_TOLERANCE_MS,
  acquireExternalVodHlsSection
} from "./external-vod-hls-acquirer.js";
import type {
  ExternalVodHlsPersistedClockEvidence
} from "./external-vod-hls-acquirer.js";
import {
  assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet,
  assertExternalVodSourceClockProofUnchanged,
  createExternalVodSourceClockProof,
  externalVodSourceVersionId,
  parseExternalVodSourceClockProof
} from "./external-vod-source-clock-proof.js";
import type {
  ExternalVodSourceClockProof,
  ExternalVodSourceClockResolution
} from "./external-vod-source-clock-proof.js";
import {
  assertExternalVodTransferUrl,
  fetchExternalVodBytes
} from "./external-vod-transfer.js";
import {
  terminatePosixProcessGroup,
  terminateWindowsProcessTreeWithTaskkill,
  windowsTaskkillOuterGuardTimeoutMs
} from "./process-tree-termination.js";
import {
  MAX_VOD_CONSUMER_ID_LENGTH,
  VOD_CONSUMER_SCOPE_HASH_DOMAIN,
  normalizeVodConsumerId,
  vodMaterializationPathSegment,
  vodConsumerMaterializationDirectory,
  vodConsumerScopeHash,
  vodConsumerScopePathSegment
} from "./vod-consumer-scope.js";

export const LEGACY_EXTERNAL_VOD_CACHE_SCHEMA =
  "chzzk-kirinuki/external-vod-materialization-v1";
export const PROOFLESS_EXTERNAL_VOD_CACHE_SCHEMA =
  "chzzk-kirinuki/external-vod-materialization-v2";
export const EXTERNAL_VOD_CACHE_SCHEMA =
  "chzzk-kirinuki/external-vod-materialization-v3";
export const EXTERNAL_PARTIAL_ROOTS_SCHEMA =
  "chzzk-kirinuki/external-vod-partial-roots-v2";
export const DEFAULT_EXTERNAL_VOD_HANDLE_MS =
  DEFAULT_MATERIALIZATION_HANDLE_MS;
export const DEFAULT_EXTERNAL_VOD_STATE_DIRECTORY_NAME =
  "kirinuki-vod-runtime/vod-fragments";
export const MAX_EXTERNAL_VOD_CONSUMER_ID_LENGTH =
  MAX_VOD_CONSUMER_ID_LENGTH;
/** @deprecated Shared by every VOD platform; retained for receipt/test compatibility. */
export const EXTERNAL_VOD_CONSUMER_SCOPE_DOMAIN =
  VOD_CONSUMER_SCOPE_HASH_DOMAIN;
export const MAX_EXTERNAL_VOD_PARTS = 500;
export const MAX_EXTERNAL_VOD_SOURCE_MS = 7 * 24 * 60 * 60 * 1_000;
/** A single edit may materialize at most six hours after merged handles. */
export const MAX_EXTERNAL_VOD_MATERIALIZED_MS = 6 * 60 * 60 * 1_000;
/** Sections plus the concurrently-present final mux may consume at most 64 GiB. */
export const MAX_EXTERNAL_VOD_WORK_BYTES = 64 * 1024 * 1024 * 1024;
const ATOMIC_DESTINATION_STABILIZATION_ATTEMPTS = 64;
const ATOMIC_DESTINATION_STABILIZATION_MAX_DELAY_MS = 8;
/** Keep this much filesystem capacity unused beyond the conservative estimate. */
export const MIN_EXTERNAL_VOD_DISK_HEADROOM_BYTES = 512 * 1024 * 1024;
const ESTIMATED_EXTERNAL_VOD_WORK_BYTES_PER_SECOND = 2 * 1024 * 1024;
export const DEFAULT_EXTERNAL_PROCESS_TIMEOUT_MS = 30 * 60 * 1_000;
export const EXTERNAL_METADATA_TIMEOUT_MS = 2 * 60 * 1_000;
export const EXTERNAL_FFPROBE_TIMEOUT_MS = 60 * 1_000;
export const MAX_EXTERNAL_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
export const EXTERNAL_PROCESS_KILL_GRACE_MS = 5_000;
export const MAX_EXTERNAL_PROCESS_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_RECEIPT_BYTES = 2 * 1024 * 1024;
export const MAX_SECTION_DURATION_DRIFT_MS = 250;
/**
 * ffmpeg's precise HLS cut can retain up to one second of positive track PTS
 * at a section edge (observed on CHZZK live-rewind MP4), plus the ordinary
 * 250 ms media-duration tolerance. This bound is used only after the complete
 * stream/container timeline has been cross-checked; final mux duration keeps
 * the stricter 250 ms rule.
 */
export const MAX_EXTERNAL_SECTION_STREAM_EDGE_OFFSET_MS =
  MAX_EXTERNAL_VOD_HLS_STREAM_EDGE_TOLERANCE_MS;
export const MAX_EXTERNAL_VOD_WIDTH = 1_920;
export const MAX_EXTERNAL_VOD_HEIGHT = 1_080;
export const MAX_EXTERNAL_VOD_FRAME_RATE = 60;
export const EXTERNAL_RESOURCE_MONITOR_INTERVAL_MS = 250;
export const MAX_EXTERNAL_WORKSPACE_SCAN_DEPTH = 32;
export const MAX_EXTERNAL_WORKSPACE_SCAN_ENTRIES = 20_000;

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const CHZZK_VOD_ID_PATTERN = /^\d+$/u;
const SOOP_VOD_ID_PATTERN = /^\d+$/u;
const SAFE_IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f/?#&=]{1,240}$/u;
const SAFE_OUTPUT_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be"
]);
const CHZZK_VOD_HOSTS = new Set([
  "chzzk.naver.com"
]);
const SOOP_VOD_HOSTS = new Set([
  "vod.sooplive.com",
  "vod.sooplive.co.kr",
  "vod.afreecatv.com"
]);
const PUBLIC_AVAILABILITY = new Set(["public", "unlisted"]);
const ALLOWED_LIVE_STATUS = new Set(["not_live", "was_live"]);
const SAFE_ENVIRONMENT_KEYS = new Set([
  "COMSPEC",
  "ELECTRON_RUN_AS_NODE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR"
]);
const TEMPORARY_ENVIRONMENT_KEYS = new Set(["TEMP", "TMP", "TMPDIR"]);

export const EXTERNAL_VOD_FORMAT_SELECTORS = Object.freeze({
  YOUTUBE:
    // Strict direct-clock acquisition proves and seeks video/audio inputs
    // independently. Do not fall back to a combined progressive stream.
    "bv[ext=mp4][vcodec^=avc1][width<=1920][height<=1080][fps<=60]" +
    "+ba[ext=m4a][acodec^=mp4a]",
  CHZZK:
    // Completed CHZZK live-rewind VODs can expose only a public HLS/fMP4
    // playlist (`vodStatus: NONE`) even though the page is fully playable.
    // yt-dlp reports those renditions as combined MP4/HLS formats, so retain
    // the same ffprobe-enforced caps used for SOOP's metadata-light HLS.
    "b[ext=mp4][vcodec^=?avc][acodec^=?mp4a]" +
    "[width<=?1920][height<=?1080][fps<=?60]/" +
    "best[ext=mp4][vcodec^=?avc][width<=?1920][height<=?1080][fps<=?60]",
  SOOP:
    // SOOP's single HLS format currently omits codec/dimension/fps metadata.
    // `?` caps every value yt-dlp does know while allowing that format to be
    // fetched; mandatory ffprobe validation below rejects any unknown-at-
    // selection stream that is not H.264/AAC and <=1080p/60fps.
    "bv*[vcodec^=?avc][width<=?1920][height<=?1080][fps<=?60]" +
    "+ba[acodec^=?mp4a]/" +
    "b[ext=mp4][vcodec^=?avc][width<=?1920][height<=?1080][fps<=?60]/" +
    "best[ext=mp4][vcodec^=?avc][width<=?1920][height<=?1080][fps<=?60]"
});

export const FORBIDDEN_EXTERNAL_YT_DLP_FLAGS = Object.freeze([
  "--batch-file",
  "--client-certificate",
  "--client-certificate-key",
  "--client-certificate-password",
  "--config-locations",
  "--config-location",
  "--cookies",
  "--cookies-from-browser",
  "--exec",
  "--exec-before-download",
  "--load-info-json",
  "--netrc",
  "--netrc-cmd",
  "--netrc-location",
  "--password",
  "--plugin-dirs",
  "--remote-components",
  "--update",
  "--update-to",
  "--username",
  "--video-password",
  "-U"
]);

export type ExternalVodPlatform = "CHZZK" | "YOUTUBE" | "SOOP";
export type ExternalVodMaterializationPhase =
  | "resolving"
  | "planning"
  | "downloading"
  | "verifying"
  | "muxing"
  | "completed";

export interface ExternalVodSource {
  platform: ExternalVodPlatform;
  canonicalUrl: string;
  contentId: string;
}

export interface ExternalVodClipRange {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ExternalVodEditableRange {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ExternalVodMetadataPart {
  id: string;
  playlistItem?: number;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
}

export interface ExternalVodMetadata extends ExternalVodSource {
  durationMs: number;
  sourceVersionId: string;
  parts: readonly ExternalVodMetadataPart[];
  /** Engine-derived from the complete official yt-dlp SOOP root + entries. */
  sourceClockIdentity?: SoopVodSourceClockIdentity;
}

export interface PlannedExternalVodSection {
  id: string;
  windowIndex: number;
  sectionIndex: number;
  partIndex: number;
  playlistItem?: number;
  sourceStartMs: number;
  sourceEndMs: number;
  partStartMs: number;
  partEndMs: number;
  clipIds: readonly string[];
}

export interface ExternalVodPlan {
  clipRanges: readonly MaterializationClipCoverage[];
  windows: readonly LogicalMaterializationWindow[];
  sections: readonly PlannedExternalVodSection[];
}

export interface ExternalMediaInspection {
  durationMs: number;
  /**
   * Exact per-stream ffprobe timelines when the MP4 exposes them. A container
   * can legitimately span longer than the requested source interval when its
   * audio and video tracks have different positive start timestamps (CHZZK's
   * live-rewind MP4 currently does this at source time zero). Section coverage
   * must therefore be checked against every stream duration, while the
   * container duration remains the authority for final mux playback length.
   */
  streamTimelines?: {
    video: ExternalMediaStreamTimeline;
    audio?: ExternalMediaStreamTimeline;
  };
  videoCodec: "h264";
  audioCodec: "aac" | null;
  width: number;
  height: number;
  frameRate: number;
  audioSampleRate?: number;
  audioChannels?: number;
  audioChannelLayout?: string;
  /**
   * Ephemeral, exact codec-parameter identity used only to decide whether the
   * already-normalized roots can be packet-copied. It is deliberately not
   * persisted: cached roots are re-probed from their actual bytes immediately
   * before concat, and a missing/mismatched value falls back to transcoding.
   */
  packetCopySignature?: string;
}

export interface ExternalMediaStreamTimeline {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface ExternalProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExternalProcessRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  signal?: AbortSignal;
  /** Bounds a single external-tool phase; injected runners may ignore it. */
  timeoutMs?: number;
  /** The default runner recursively polls cwd without following symlinks. */
  workingDirectoryByteLimit?: number;
  /** The default runner keeps this many filesystem bytes free while writing. */
  minimumAvailableDiskBytes?: number;
  /**
   * Maps an already-open regular file into child fd/handle 3. This is used
   * only by the final ffprobe publication check so macOS and Windows retain
   * the same handle-bound TOCTOU protection as Linux.
   */
  inheritedInputFileDescriptor?: number;
}

export type ExternalProcessRunner = (
  command: string,
  args: readonly string[],
  options: ExternalProcessRunOptions
) => Promise<ExternalProcessResult>;

export interface ExternalVodMaterializationProgress {
  phase: ExternalVodMaterializationPhase;
  completedSections: number;
  totalSections: number;
  completedBytes: number;
}

export interface ExternalVodMaterializationRequest {
  /**
   * Stable editor/project identity used only to isolate physical cache files.
   * It is deliberately excluded from semantic materialization fingerprints.
   */
  consumerId: string;
  sourceUrl: string;
  /** Optional legacy SOOP browser clock; engine-derived metadata is authoritative. */
  sourceClockIdentity?: unknown;
  clips: readonly ExternalVodClipRange[];
  editableRanges?: readonly ExternalVodEditableRange[];
  handleMs?: number;
  resume?: ExternalVodMaterializationResumeReference;
  base?: ExternalVodMaterializationResumeReference;
  stateDir?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ExternalVodMaterializationProgress) => void;
}

export interface ExternalVodMaterializationResumeReference {
  materializationId: string;
  planFingerprint: string;
  contentId: string;
}

export interface ExternalVodArtifactReceipt {
  name: string;
  type: "video/mp4";
  hashSha256: string;
  sizeBytes: number;
  durationMs: number;
  /** Per-publication immutable private cache filename. */
  cacheFileName: string;
}

export interface ExternalVodSourceRootReceipt {
  id: string;
  partIndex: number;
  playlistItem?: number;
  sourceStartMs: number;
  sourceEndMs: number;
  partStartMs: number;
  partEndMs: number;
  hashSha256: string;
  sizeBytes: number;
  durationMs: number;
  cacheFileName: string;
  streamSignature: ExternalSectionStreamSignature;
  clockEvidence: ExternalVodPersistedSectionClockEvidence;
}

export type ExternalVodPersistedSectionClockEvidence =
  | ExternalVodHlsPersistedClockEvidence
  | ExternalVodDirectSectionEvidence;

export interface ExternalVodCacheReceipt {
  schemaId: typeof EXTERNAL_VOD_CACHE_SCHEMA;
  canonicalUrl: string;
  sourceVersionId: string;
  sourceClockProof: ExternalVodSourceClockProof;
  acquisitionClockProofSet: ExternalVodPersistedClockProofSet;
  manifest: ChzzkVodMaterialization;
  clips: readonly ExternalVodClipRange[];
  acquiredSections: readonly Omit<
    PlannedExternalVodSection,
    "clipIds"
  >[];
  /** Immutable, source-timeline-addressed inputs used to rebuild generations. */
  sourceRoots: readonly ExternalVodSourceRootReceipt[];
  artifact: ExternalVodArtifactReceipt;
  preparedAt: string;
}

export interface ExternalVodMaterializationResult {
  manifest: ChzzkVodMaterialization;
  receipt: ExternalVodCacheReceipt;
  artifactPath: string;
  reused: boolean;
}

export interface ExternalVodMaterializerDependencies {
  runProcess?: ExternalProcessRunner;
  inspectMedia?: (
    filePath: string,
    options: ExternalProcessRunOptions
  ) => Promise<ExternalMediaInspection>;
  /** Test seam; production always performs a fresh ffprobe of concat inputs. */
  inspectPacketCopyMedia?: (
    filePath: string,
    options: ExternalProcessRunOptions
  ) => Promise<ExternalMediaInspection>;
  hashFile?: (filePath: string, signal?: AbortSignal) => Promise<string>;
  ytDlpBinary?: string;
  ytDlpMode?: ExternalYtDlpMode;
  pythonBinary?: string;
  nodeBinary?: string;
  ffmpegBinary?: string;
  ffprobeBinary?: string;
  fetchImpl?: typeof globalThis.fetch;
  resolveClockProofSet?: (
    metadata: ExternalVodMetadata,
    parts: readonly ExternalVodMetadataPart[],
    context: {
      cwd: string;
      runProcess: ExternalProcessRunner;
      processEnv: NodeJS.ProcessEnv;
      ytDlpBinary: string;
      ytDlpMode: ExternalYtDlpMode;
      pythonBinary?: string;
      nodeBinary: string;
      ffprobeBinary: string;
      tlsCaFile: string;
      fetchImpl?: typeof globalThis.fetch;
      signal?: AbortSignal;
    }
  ) => Promise<ExternalVodClockProofSetResolution>;
  processEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  statFileSystem?: (directory: string) => Promise<{
    bavail: number | bigint;
    bsize: number | bigint;
  }>;
}

export const EXTERNAL_YT_DLP_MODES = Object.freeze([
  "python-zipimport",
  "standalone"
] as const);

export type ExternalYtDlpMode = typeof EXTERNAL_YT_DLP_MODES[number];

type UnknownRecord = Record<string, unknown>;

export class ExternalVodMaterializationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodMaterializationError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodMaterializationError(message, code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as UnknownRecord;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedRequestSourceClockIdentity(
  source: ExternalVodSource,
  value: unknown
): SoopVodSourceClockIdentity | undefined {
  if (source.platform !== "SOOP") {
    if (value !== undefined) {
      fail(
        "SOOP이 아닌 VOD 요청에는 SOOP 시간축 identity를 넣을 수 없습니다.",
        "INVALID_SOURCE_CLOCK"
      );
    }
    return undefined;
  }
  if (value === undefined) {
    return undefined;
  }
  const identity = normalizeSoopVodSourceClockIdentity(value);
  if (!identity || identity.contentId !== source.contentId) {
    fail(
      "선택적으로 전달한 SOOP 레거시 시간축 identity가 올바르지 않습니다.",
      "INVALID_SOURCE_CLOCK"
    );
  }
  return identity;
}

function soopSourceClockIdentitySha256(
  identity: SoopVodSourceClockIdentity | undefined
): string | undefined {
  return identity ? sha256Text(stableJson(identity)) : undefined;
}

function metadataSoopSourceClockIdentity(
  metadata: ExternalVodMetadata,
  legacyIdentity?: SoopVodSourceClockIdentity
): SoopVodSourceClockIdentity | undefined {
  if (metadata.platform !== "SOOP") {
    if (metadata.sourceClockIdentity !== undefined || legacyIdentity !== undefined) {
      fail(
        "SOOP이 아닌 VOD에 SOOP 시간축 identity가 결합되었습니다.",
        "INVALID_SOURCE_CLOCK"
      );
    }
    return undefined;
  }
  const derived = normalizeSoopVodSourceClockIdentity(
    metadata.sourceClockIdentity
  );
  if (!derived || derived.contentId !== metadata.contentId) {
    fail(
      "SOOP 공식 root·entries에서 전체 파트 시간축을 만들지 못했습니다.",
      "INVALID_SOURCE_CLOCK"
    );
  }
  if (
    legacyIdentity
    && !sameSoopVodSourceClockIdentity(derived, legacyIdentity)
  ) {
    fail(
      "SOOP 공식 root·entries 시간축이 레거시 플레이어 시간축과 다릅니다.",
      "SOURCE_CLOCK_MISMATCH"
    );
  }
  return derived;
}

function normalizedExternalVodConsumerId(value: unknown): string {
  try {
    return normalizeVodConsumerId(value);
  } catch {
    fail("외부 VOD 캐시 소비자 식별자가 올바르지 않습니다.", "INVALID_CONSUMER_ID");
  }
}

/**
 * Maps a logical consumer to an opaque cache namespace. The explicit domain
 * separator prevents this digest from being confused with content, plan, or
 * artifact SHA-256 values elsewhere in the materialization protocol.
 */
export function externalVodConsumerScopeHash(value: unknown): string {
  try {
    return vodConsumerScopeHash(normalizedExternalVodConsumerId(value));
  } catch {
    fail("외부 VOD 캐시 소비자 식별자가 올바르지 않습니다.", "INVALID_CONSUMER_ID");
  }
}

function scopedExternalVodJobDirectory({
  stateDirectory,
  consumerScopeHash,
  platform,
  materializationId
}: {
  stateDirectory: string;
  consumerScopeHash: string;
  platform: ExternalVodPlatform;
  materializationId: string;
}): string {
  try {
    return vodConsumerMaterializationDirectory({
      stateDirectory,
      consumerScopeHash,
      platform,
      materializationId
    });
  } catch {
    fail("외부 VOD cache scope 경로가 올바르지 않습니다.", "INVALID_CONSUMER_ID");
  }
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(`${label} 값은 문자열이어야 합니다.`, "INVALID_METADATA");
  }
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    fail(`${label} 값이 안전한 식별자 형식이 아닙니다.`, "INVALID_METADATA");
  }
  return normalized;
}

function parsedSecureUrl(value: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    fail("올바른 공개 CHZZK·YouTube·SOOP VOD 주소가 필요합니다.", "INVALID_SOURCE_URL");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
  ) {
    fail("인증 정보가 없는 HTTPS 공개 VOD 주소만 사용할 수 있습니다.", "INVALID_SOURCE_URL");
  }
  return url;
}

function youtubeContentId(url: URL): string {
  if (url.hostname === "youtu.be") {
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length === 1 ? segments[0] ?? "" : "";
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return "";
  }
  if (url.pathname === "/watch") {
    return url.searchParams.get("v") || "";
  }
  return url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/u)?.[1]
    || "";
}

/** Canonicalizes only finite-video page shapes; live channel URLs never match. */
export function normalizeExternalVodUrl(
  value: unknown,
  expectedPlatform?: ExternalVodPlatform
): ExternalVodSource {
  const url = parsedSecureUrl(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (CHZZK_VOD_HOSTS.has(hostname)) {
    if (expectedPlatform && expectedPlatform !== "CHZZK") {
      fail("요청 플랫폼과 VOD 주소가 일치하지 않습니다.", "PLATFORM_MISMATCH");
    }
    const contentId = url.pathname.match(/^\/video\/(\d+)\/?$/u)?.[1] || "";
    if (!CHZZK_VOD_ID_PATTERN.test(contentId)) {
      fail("단일 CHZZK 공개 VOD 재생 주소가 필요합니다.", "INVALID_SOURCE_URL");
    }
    return {
      platform: "CHZZK",
      canonicalUrl: `https://chzzk.naver.com/video/${contentId}`,
      contentId
    };
  }
  if (YOUTUBE_HOSTS.has(hostname)) {
    if (expectedPlatform && expectedPlatform !== "YOUTUBE") {
      fail("요청 플랫폼과 VOD 주소가 일치하지 않습니다.", "PLATFORM_MISMATCH");
    }
    const contentId = youtubeContentId(url);
    if (!YOUTUBE_VIDEO_ID_PATTERN.test(contentId)) {
      fail("단일 YouTube VOD 영상 주소가 필요합니다.", "INVALID_SOURCE_URL");
    }
    return {
      platform: "YOUTUBE",
      canonicalUrl: `https://www.youtube.com/watch?v=${contentId}`,
      contentId
    };
  }
  if (SOOP_VOD_HOSTS.has(hostname)) {
    if (expectedPlatform && expectedPlatform !== "SOOP") {
      fail("요청 플랫폼과 VOD 주소가 일치하지 않습니다.", "PLATFORM_MISMATCH");
    }
    const normalizedPath = url.pathname.replace(/\/+$/u, "") || "/";
    const contentId = normalizedPath.match(
      /^\/(?:player|PLAYER\/STATION)\/(\d+)$/u
    )?.[1] || "";
    if (!SOOP_VOD_ID_PATTERN.test(contentId)) {
      fail("단일 SOOP 공개 VOD 재생 주소가 필요합니다.", "INVALID_SOURCE_URL");
    }
    return {
      platform: "SOOP",
      canonicalUrl: `https://vod.sooplive.com/player/${contentId}`,
      contentId
    };
  }
  fail("지원하는 CHZZK·YouTube·SOOP 공개 VOD 주소가 아닙니다.", "INVALID_SOURCE_URL");
}

export function createExternalProcessEnvironment(
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  privateWorkingDirectory?: string
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnvironment)) {
    if (value !== undefined && SAFE_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      sanitized[key] = value;
    }
  }
  sanitized.NO_COLOR = "1";
  if (privateWorkingDirectory !== undefined) {
    const privateTemporaryDirectory = path.resolve(privateWorkingDirectory);
    sanitized.TEMP = privateTemporaryDirectory;
    sanitized.TMP = privateTemporaryDirectory;
    sanitized.TMPDIR = privateTemporaryDirectory;
  }
  return sanitized;
}

function flagName(argument: string): string {
  const equals = argument.indexOf("=");
  return equals < 0 ? argument : argument.slice(0, equals);
}

function flagCount(args: readonly string[], name: string): number {
  return args.reduce((count, argument) => (
    count + (flagName(argument) === name ? 1 : 0)
  ), 0);
}

export function assertExternalYtDlpArgsSafe(args: readonly string[]): void {
  for (const required of [
    "--ignore-config",
    "--no-config-locations",
    "--no-plugin-dirs",
    "--no-remote-components",
    "--no-js-runtimes"
  ]) {
    if (
      flagCount(args, required) !== 1
      || args.filter((argument) => argument === required).length !== 1
    ) {
      fail(
        "yt-dlp의 설정·플러그인·원격 실행 구성요소 안전 초기화 옵션은 각각 정확히 한 번 필요합니다.",
        "UNSAFE_PROCESS_ARGS"
      );
    }
  }
  for (const forbidden of FORBIDDEN_EXTERNAL_YT_DLP_FLAGS) {
    if (flagCount(args, forbidden) > 0) {
      fail("쿠키·로그인·외부 설정을 읽는 yt-dlp 옵션은 사용할 수 없습니다.", "UNSAFE_PROCESS_ARGS");
    }
  }
  const jsRuntimeArgumentIndex = args.findIndex((argument) => (
    flagName(argument) === "--js-runtimes"
  ));
  const jsRuntimeArgument = jsRuntimeArgumentIndex >= 0
    ? args[jsRuntimeArgumentIndex] ?? ""
    : "";
  const jsRuntime = jsRuntimeArgument.includes("=")
    ? jsRuntimeArgument.slice(jsRuntimeArgument.indexOf("=") + 1)
    : args[jsRuntimeArgumentIndex + 1] ?? "";
  const nodePath = jsRuntime?.startsWith("node:")
    ? jsRuntime.slice("node:".length)
    : "";
  if (
    flagCount(args, "--js-runtimes") !== 1
    || jsRuntimeArgumentIndex < 0
    || flagCount(args, "--no-js-runtimes") !== 1
    || args.findIndex((argument) => argument === "--no-js-runtimes")
      > jsRuntimeArgumentIndex
    || !nodePath
    || !path.isAbsolute(nodePath)
    || /[\0\r\n,]/u.test(nodePath)
  ) {
    fail(
      "yt-dlp YouTube EJS는 검증된 단일 Node 절대 경로만 사용해야 합니다.",
      "UNSAFE_PROCESS_ARGS"
    );
  }
  const separatorIndex = args.lastIndexOf("--");
  if (
    separatorIndex < 0
    || separatorIndex !== args.length - 2
    || flagCount(args, "--") !== 1
  ) {
    fail("VOD URL은 yt-dlp 옵션과 분리된 마지막 인자여야 합니다.", "UNSAFE_PROCESS_ARGS");
  }
  normalizeExternalVodUrl(args.at(-1));
}

function commonYtDlpArgs(nodeBinary: string = process.execPath): string[] {
  return [
    "--ignore-config",
    "--no-config-locations",
    "--no-plugin-dirs",
    "--no-cache-dir",
    "--no-batch-file",
    "--no-cookies",
    "--no-cookies-from-browser",
    "--no-exec",
    "--no-update",
    "--no-remote-components",
    "--no-js-runtimes",
    "--js-runtimes", nodeRuntimeArgument(nodeBinary),
    "--no-warnings",
    "--quiet"
  ];
}

export function buildExternalMetadataProbeArgs(
  sourceValue: ExternalVodSource | string,
  {
    nodeBinary = process.execPath
  }: {
    nodeBinary?: string;
  } = {}
): string[] {
  const source = typeof sourceValue === "string"
    ? normalizeExternalVodUrl(sourceValue)
    : normalizeExternalVodUrl(sourceValue.canonicalUrl, sourceValue.platform);
  const args = [
    ...commonYtDlpArgs(nodeBinary),
    "--skip-download",
    "--dump-single-json",
    ...(source.platform !== "SOOP"
      ? ["--no-playlist"]
      : [
        "--yes-playlist",
        "--playlist-end",
        String(MAX_EXTERNAL_VOD_PARTS + 1)
      ]),
    "--",
    source.canonicalUrl
  ];
  assertExternalYtDlpArgsSafe(args);
  return args;
}

export const buildExternalVodMetadataProbeArgs =
  buildExternalMetadataProbeArgs;

/**
 * Resolves the exact rendition(s) that a section acquisition would use. The
 * returned JSON is consumed in-memory by the strict clock prover; signed URLs
 * and request headers must never be copied into a receipt or log.
 */
export function buildExternalSelectedSourceProbeArgs({
  source: sourceValue,
  playlistItem,
  nodeBinary = process.execPath
}: {
  source: ExternalVodSource;
  playlistItem?: number;
  nodeBinary?: string;
}): string[] {
  const source = normalizeExternalVodUrl(
    sourceValue.canonicalUrl,
    sourceValue.platform
  );
  if (
    (source.platform === "SOOP") !== (playlistItem !== undefined)
    || (
      playlistItem !== undefined
      && (!Number.isSafeInteger(playlistItem) || playlistItem <= 0)
    )
  ) {
    fail("선택 포맷 probe의 VOD 파트가 올바르지 않습니다.", "INVALID_METADATA");
  }
  const args = [
    ...commonYtDlpArgs(nodeBinary),
    "--skip-download",
    "--dump-single-json",
    "--format", EXTERNAL_VOD_FORMAT_SELECTORS[source.platform],
    ...(source.platform === "SOOP"
      ? [
        "--yes-playlist",
        "--playlist-items", String(playlistItem)
      ]
      : ["--no-playlist"]),
    "--",
    source.canonicalUrl
  ];
  assertExternalYtDlpArgsSafe(args);
  return args;
}

function executableName(value: unknown, fallback: string): string {
  const normalized = String(value || fallback).trim();
  if (!normalized || /[\0\r\n]/u.test(normalized)) {
    fail("로컬 실행 파일 경로가 올바르지 않습니다.", "INVALID_PROCESS_BINARY");
  }
  return normalized;
}

function verifiedAbsoluteToolPath(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (
    !normalized
    || !path.isAbsolute(normalized)
    || /[\0\r\n]/u.test(normalized)
  ) {
    fail(
      `관리형 ${label} 실행 경로는 검증된 절대 경로여야 합니다.`,
      "INVALID_PROCESS_BINARY"
    );
  }
  return path.resolve(normalized);
}

function isolatedYtDlpInvocationArgs(
  ytDlpArtifact: unknown,
  ytDlpArgs: readonly string[]
): string[] {
  return [
    "-I",
    verifiedAbsoluteToolPath(ytDlpArtifact, "yt-dlp artifact"),
    ...ytDlpArgs
  ];
}

function externalYtDlpMode(value: unknown): ExternalYtDlpMode {
  const normalized = String(value || "python-zipimport").trim();
  if ((EXTERNAL_YT_DLP_MODES as readonly string[]).includes(normalized)) {
    return normalized as ExternalYtDlpMode;
  }
  fail(
    "yt-dlp 실행 방식은 python-zipimport 또는 standalone이어야 합니다.",
    "INVALID_PROCESS_BINARY"
  );
}

export function externalYtDlpCommand({
  mode,
  ytDlpBinary,
  pythonBinary,
  args
}: {
  mode: ExternalYtDlpMode;
  ytDlpBinary: unknown;
  pythonBinary?: unknown;
  args: readonly string[];
}): Readonly<{ executable: string; args: readonly string[] }> {
  const resolvedMode = externalYtDlpMode(mode);
  const artifact = verifiedAbsoluteToolPath(
    ytDlpBinary,
    resolvedMode === "standalone"
      ? "yt-dlp standalone"
      : "yt-dlp artifact"
  );
  if (resolvedMode === "standalone") {
    return Object.freeze({
      executable: artifact,
      args: Object.freeze([...args])
    });
  }
  return Object.freeze({
    executable: verifiedAbsoluteToolPath(pythonBinary, "Python"),
    args: Object.freeze(isolatedYtDlpInvocationArgs(artifact, args))
  });
}

function nodeRuntimeArgument(value: unknown = process.execPath): string {
  const normalized = executableName(value, process.execPath);
  if (!path.isAbsolute(normalized)) {
    fail(
      "YouTube EJS용 Node 실행 파일은 검증된 절대 경로여야 합니다.",
      "INVALID_PROCESS_BINARY"
    );
  }
  return `node:${path.resolve(normalized)}`;
}

export function buildExternalConcatArgs({
  concatListPath,
  outputPath,
  durationMs,
  packetCopy = false
}: {
  concatListPath: string;
  outputPath: string;
  durationMs: number;
  packetCopy?: boolean;
}): string[] {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    fail("병합할 로컬 영상 길이가 올바르지 않습니다.", "INVALID_SECTION");
  }
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-y",
    "-fflags", "+genpts",
    "-f", "concat",
    "-safe", "1",
    "-i", path.resolve(concatListPath),
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-sn",
    "-dn",
    ...(packetCopy
      // Every root has already been trimmed and normalized. Re-encoding the
      // entire result here caused the UI to sit at 92% while consuming all CPU.
      // Packet copy is selected only after fresh, exact codec-parameter probes.
      ? ["-c", "copy"]
      : [
        "-c:v", "libx264",
        // A fallback concat is still an intermediate local editing root. Do
        // not make the user wait for archival compression before web editing.
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k"
      ]),
    "-avoid_negative_ts", "make_zero",
    "-t", (durationMs / 1_000).toFixed(3),
    "-movflags", "+faststart",
    "-f", "mp4",
    path.resolve(outputPath)
  ];
}

export const buildExternalVodConcatArgs = buildExternalConcatArgs;

export function compatibleExternalPacketCopySignatures(
  signatures: readonly (string | undefined)[]
): boolean {
  const first = signatures[0];
  return typeof first === "string"
    && first.length > 0
    && signatures.every((signature) => signature === first);
}

function durationMilliseconds(value: unknown, label: string): number {
  const seconds = Number(value);
  const milliseconds = Math.round(seconds * 1_000);
  if (
    !Number.isFinite(seconds)
    || !Number.isSafeInteger(milliseconds)
    || milliseconds <= 0
    || milliseconds > MAX_EXTERNAL_VOD_SOURCE_MS
  ) {
    fail(`${label} 재생 시간을 확인할 수 없습니다.`, "INVALID_METADATA");
  }
  return milliseconds;
}

function assertPublicFiniteVod(record: UnknownRecord, label: string): void {
  if (record.is_live === true) {
    fail(`${label}은 현재 라이브이므로 로컬 VOD로 준비할 수 없습니다.`, "LIVE_SOURCE");
  }
  const liveStatus = typeof record.live_status === "string"
    ? record.live_status
    : "";
  if (liveStatus && !ALLOWED_LIVE_STATUS.has(liveStatus)) {
    fail(`${label}은 완료된 VOD가 아닙니다.`, "LIVE_SOURCE");
  }
  const availability = typeof record.availability === "string"
    ? record.availability
    : "";
  if (availability && !PUBLIC_AVAILABILITY.has(availability)) {
    fail(
      `${label}은 로그인·구독·비공개 접근이 필요한 영상입니다.`,
      "RESTRICTED_SOURCE"
    );
  }
  const ageLimit = Number(record.age_limit || 0);
  if (Number.isFinite(ageLimit) && ageLimit >= 18) {
    fail(`${label}은 성인 인증 없이 사용할 수 있는 공개 VOD가 아닙니다.`, "RESTRICTED_SOURCE");
  }
}

function parseJsonRecord(value: string): UnknownRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("yt-dlp 공개 VOD 메타데이터 JSON을 읽지 못했습니다.", "INVALID_METADATA");
  }
  if (!isRecord(parsed)) {
    fail("yt-dlp 공개 VOD 메타데이터 구조가 올바르지 않습니다.", "INVALID_METADATA");
  }
  return parsed;
}

function assertExternalMetadataIdentity(
  source: ExternalVodSource,
  payload: UnknownRecord
): void {
  const extractor = String(payload.extractor || "").trim().toLowerCase();
  const expectedExtractor = source.platform === "YOUTUBE"
    ? "youtube"
    : source.platform === "CHZZK"
      ? "chzzk:video"
      : "soop";
  if (extractor !== expectedExtractor) {
    fail(
      "yt-dlp 메타데이터가 요청 플랫폼의 고정 extractor에서 오지 않았습니다.",
      "SOURCE_CHANGED"
    );
  }
  const payloadId = String(payload.id || "").trim();
  if (source.platform !== "SOOP") {
    if (payloadId !== source.contentId) {
      fail(
        "VOD 주소와 yt-dlp 메타데이터의 원본 ID가 다릅니다.",
        "SOURCE_CHANGED"
      );
    }
    return;
  }

  // SOOP's extractor intentionally exposes the media-file/part identifier as
  // `id` (for example, `BE689A0E_...`) rather than the numeric player page ID.
  // Bind the request to yt-dlp's resolved page URL and retain `id` only as a
  // source-version/part identity. This mirrors the upstream extractor shape
  // without trusting a CDN URL or weakening the requested-page binding.
  const identityUrls = [payload.webpage_url, payload.original_url]
    .filter((value): value is string => (
      typeof value === "string" && value.trim().length > 0
    ));
  if (identityUrls.length === 0) {
    fail(
      "SOOP VOD 메타데이터에서 요청한 재생 페이지를 확인하지 못했습니다.",
      "SOURCE_CHANGED"
    );
  }
  for (const identityUrl of identityUrls) {
    let resolved: ExternalVodSource;
    try {
      resolved = normalizeExternalVodUrl(identityUrl, "SOOP");
    } catch {
      fail(
        "SOOP VOD 메타데이터의 재생 페이지가 요청 주소와 다릅니다.",
        "SOURCE_CHANGED"
      );
    }
    if (resolved.contentId !== source.contentId) {
      fail(
        "SOOP VOD 메타데이터의 재생 페이지가 요청 주소와 다릅니다.",
        "SOURCE_CHANGED"
      );
    }
  }
}

/**
 * Converts yt-dlp JSON into a secret-free global source timeline. SOOP
 * multi-video entries are intentionally represented as sequential parts so
 * one global user selection can be translated into part-local sections.
 */
export function parseExternalVodMetadata(
  sourceValue: ExternalVodSource | string,
  rawJson: string
): ExternalVodMetadata {
  const source = typeof sourceValue === "string"
    ? normalizeExternalVodUrl(sourceValue)
    : normalizeExternalVodUrl(sourceValue.canonicalUrl, sourceValue.platform);
  const payload = parseJsonRecord(rawJson);
  assertPublicFiniteVod(payload, `${source.platform} VOD`);

  const payloadId = String(payload.id || "").trim();
  assertExternalMetadataIdentity(source, payload);

  const hasEntries = Object.prototype.hasOwnProperty.call(payload, "entries");
  if (
    source.platform === "SOOP"
    && hasEntries
    && !Array.isArray(payload.entries)
  ) {
    fail("SOOP VOD 파트 목록이 올바르지 않습니다.", "INVALID_METADATA");
  }
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const metadataType = typeof payload._type === "string"
    ? payload._type.trim().toLowerCase()
    : "";
  if (source.platform !== "SOOP" && entries.length > 0) {
    fail(`${source.platform} 재생목록이 아닌 단일 공개 VOD만 사용할 수 있습니다.`, "INVALID_METADATA");
  }
  if (
    source.platform === "SOOP"
    && entries.length === 0
    && (
      hasEntries
      || metadataType === "playlist"
      || metadataType === "multi_video"
    )
  ) {
    fail("SOOP VOD의 공식 파트 목록이 비어 있습니다.", "INVALID_METADATA");
  }
  if (entries.length > MAX_EXTERNAL_VOD_PARTS) {
    fail("SOOP VOD 파트 수가 안전한 처리 상한을 넘었습니다.", "INVALID_METADATA");
  }
  if (source.platform === "SOOP" && entries.length > 0) {
    for (const countKey of ["playlist_count", "n_entries"] as const) {
      const declaredCount = payload[countKey];
      if (
        declaredCount !== undefined
        && declaredCount !== null
        && (
          !Number.isSafeInteger(declaredCount)
          || Number(declaredCount) !== entries.length
        )
      ) {
        fail(
          "SOOP VOD가 선언한 파트 수와 받은 공식 파트 목록이 다릅니다.",
          "INVALID_METADATA"
        );
      }
    }
  }

  const parts: ExternalVodMetadataPart[] = [];
  const rootDurationMs = durationMilliseconds(
    payload.duration,
    `${source.platform} VOD`
  );
  let sourceCursorMs = 0;
  if (source.platform === "SOOP" && entries.length > 0) {
    const partIds = new Set<string>();
    for (const [index, entryValue] of entries.entries()) {
      if (!isRecord(entryValue)) {
        fail("SOOP VOD 파트 메타데이터가 올바르지 않습니다.", "INVALID_METADATA");
      }
      assertPublicFiniteVod(entryValue, `SOOP VOD ${index + 1}번 파트`);
      const durationMs = durationMilliseconds(
        entryValue.duration,
        `SOOP VOD ${index + 1}번 파트`
      );
      if (durationMs % 1_000 !== 0) {
        fail(
          "SOOP VOD 공식 파트 길이는 정수 초 단위여야 합니다.",
          "INVALID_METADATA"
        );
      }
      if (
        entryValue.playlist_index !== undefined
        && (
          !Number.isSafeInteger(entryValue.playlist_index)
          || Number(entryValue.playlist_index) !== index + 1
        )
      ) {
        fail(
          "SOOP VOD 공식 파트 순서가 root entries 순서와 다릅니다.",
          "INVALID_METADATA"
        );
      }
      const partId = safeIdentifier(
        String(entryValue.id || ""),
        `SOOP VOD ${index + 1}번 파트 ID`
      );
      if (partIds.has(partId)) {
        fail("SOOP VOD 파트 ID가 중복되어 원본 순서를 증명할 수 없습니다.", "INVALID_METADATA");
      }
      partIds.add(partId);
      if (sourceCursorMs + durationMs > MAX_EXTERNAL_VOD_SOURCE_MS) {
        fail("SOOP VOD 전체 길이가 안전한 처리 상한을 넘었습니다.", "INVALID_METADATA");
      }
      parts.push({
        id: partId,
        playlistItem: index + 1,
        sourceStartMs: sourceCursorMs,
        sourceEndMs: sourceCursorMs + durationMs,
        durationMs
      });
      sourceCursorMs += durationMs;
    }
    // SOOP exposes each entry as an integer second while its root duration is
    // rounded once across the complete multi-video. The root can therefore be
    // ahead of the sum of the individually truncated entries by at most one
    // second per boundary. Keep the ordered entry vector as the canonical
    // player clock, but reject fractional roots and every larger discrepancy
    // so a missing, reordered, or replaced part still fails closed.
    const maximumRootRoundingRemainderMs = (entries.length - 1) * 1_000;
    if (
      rootDurationMs % 1_000 !== 0
      || rootDurationMs < sourceCursorMs
      || rootDurationMs - sourceCursorMs > maximumRootRoundingRemainderMs
    ) {
      fail(
        "SOOP VOD 전체 길이와 공개 파트 합계가 달라 완전한 원본 시간축을 증명할 수 없습니다.",
        "INVALID_METADATA"
      );
    }
  } else {
    const durationMs = rootDurationMs;
    parts.push({
      id: safeIdentifier(payloadId || source.contentId, `${source.platform} VOD ID`),
      ...(source.platform === "SOOP" ? { playlistItem: 1 } : {}),
      sourceStartMs: 0,
      sourceEndMs: durationMs,
      durationMs
    });
    sourceCursorMs = durationMs;
  }

  if (parts.length === 0 || sourceCursorMs <= 0) {
    fail("공개 VOD 재생 파트를 찾지 못했습니다.", "INVALID_METADATA");
  }
  const sourceClockIdentity = source.platform === "SOOP"
    ? deriveSoopVodSourceClockIdentity({
      contentId: source.contentId,
      totalDurationSeconds: sourceCursorMs / 1_000,
      parts: parts.map((part) => ({
        id: part.id,
        durationSeconds: part.durationMs / 1_000
      }))
    })
    : undefined;
  if (source.platform === "SOOP" && !sourceClockIdentity) {
    fail(
      "SOOP VOD 공식 root·entries에서 완전한 정수초 시간축을 만들지 못했습니다.",
      "INVALID_METADATA"
    );
  }
  const sourceVersionId = sha256Text(stableJson({
    version: source.platform === "SOOP" ? 3 : 2,
    platform: source.platform,
    contentId: source.contentId,
    durationMs: sourceCursorMs,
    rootDurationMs,
    ...(source.platform === "SOOP"
      ? { sourceClockIdentity }
      : {
        timestamp: payload.timestamp ?? null,
        releaseTimestamp: payload.release_timestamp ?? null,
        modifiedTimestamp: payload.modified_timestamp ?? null,
        parts: parts.map((part) => ({
          id: part.id,
          durationMs: part.durationMs,
          playlistItem: part.playlistItem ?? null
        }))
      })
  }));
  return {
    ...source,
    durationMs: sourceCursorMs,
    sourceVersionId,
    parts,
    ...(sourceClockIdentity ? { sourceClockIdentity } : {})
  };
}

function normalizeClipRanges(
  clips: readonly ExternalVodClipRange[],
  sourceDurationMs?: number
): {
  publicClips: ExternalVodClipRange[];
  coreClips: MaterializationClipRange[];
} {
  if (!Array.isArray(clips) || clips.length === 0 || clips.length > 500) {
    fail("VOD 편집 컷은 1개 이상 500개 이하여야 합니다.", "INVALID_CLIPS");
  }
  const ids = new Set<string>();
  const publicClips = clips.map((clip, index) => {
    const id = safeIdentifier(clip.id, `VOD 컷 ${index + 1} ID`);
    if (ids.has(id)) {
      fail("VOD 편집 컷 ID는 중복될 수 없습니다.", "INVALID_CLIPS");
    }
    ids.add(id);
    if (
      !Number.isSafeInteger(clip.startMs)
      || !Number.isSafeInteger(clip.endMs)
      || clip.startMs < 0
      || clip.endMs <= clip.startMs
      || clip.endMs > MAX_EXTERNAL_VOD_SOURCE_MS
      || (sourceDurationMs !== undefined && clip.endMs > sourceDurationMs)
    ) {
      fail(`VOD 컷 ${id}의 원본 범위가 올바르지 않습니다.`, "INVALID_CLIPS");
    }
    return {
      id,
      startMs: clip.startMs,
      endMs: clip.endMs
    };
  });
  return {
    publicClips,
    coreClips: publicClips.map((clip) => ({
      clipId: clip.id,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs
    }))
  };
}

function validatedHandleMs(value: unknown): number {
  const handleMs = value === undefined
    ? DEFAULT_EXTERNAL_VOD_HANDLE_MS
    : Number(value);
  if (handleMs !== DEFAULT_EXTERNAL_VOD_HANDLE_MS) {
    fail("외부 VOD 편집 재료는 선택 구간 앞뒤 10초만 지원합니다.", "INVALID_HANDLE");
  }
  return handleMs;
}

function normalizeEditableRanges(
  ranges: readonly ExternalVodEditableRange[] | undefined,
  clips: readonly ExternalVodClipRange[],
  sourceDurationMs: number,
  handleMs: number
): MaterializationDesiredEditableRange[] | undefined {
  if (ranges === undefined) {
    return undefined;
  }
  if (!Array.isArray(ranges) || ranges.length !== clips.length) {
    fail(
      "확장 편집 범위는 모든 VOD 컷에 정확히 하나씩 있어야 합니다.",
      "INVALID_EDITABLE_RANGES"
    );
  }
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const ids = new Set<string>();
  return ranges.map((range, index) => {
    const id = safeIdentifier(range.id, `확장 편집 범위 ${index + 1} ID`);
    const clip = clipsById.get(id);
    if (
      !clip
      || ids.has(id)
      || !Number.isSafeInteger(range.startMs)
      || !Number.isSafeInteger(range.endMs)
      || range.startMs < 0
      || range.endMs <= range.startMs
      || range.endMs > sourceDurationMs
      || range.startMs > Math.max(0, clip.startMs - handleMs)
      || range.endMs < Math.min(sourceDurationMs, clip.endMs + handleMs)
    ) {
      fail(
        "확장 편집 범위는 각 컷의 기존 ±10초를 포함하고 원본 안에 있어야 합니다.",
        "INVALID_EDITABLE_RANGES"
      );
    }
    ids.add(id);
    return {
      clipId: id,
      editableSourceStartMs: range.startMs,
      editableSourceEndMs: range.endMs
    };
  });
}

function splitExternalWindowsOnParts(
  metadata: ExternalVodMetadata,
  windows: readonly LogicalMaterializationWindow[]
): PlannedExternalVodSection[] {
  const sections: PlannedExternalVodSection[] = [];
  for (const [windowIndex, window] of windows.entries()) {
    let sectionIndex = 0;
    for (const [partIndex, part] of metadata.parts.entries()) {
      const sourceStartMs = Math.max(
        window.editableSourceStartMs,
        part.sourceStartMs
      );
      const sourceEndMs = Math.min(
        window.editableSourceEndMs,
        part.sourceEndMs
      );
      if (sourceEndMs <= sourceStartMs) {
        continue;
      }
      sections.push({
        id: `window-${windowIndex + 1}-section-${sectionIndex + 1}`,
        windowIndex,
        sectionIndex,
        partIndex,
        ...(part.playlistItem === undefined
          ? {}
          : { playlistItem: part.playlistItem }),
        sourceStartMs,
        sourceEndMs,
        partStartMs: sourceStartMs - part.sourceStartMs,
        partEndMs: sourceEndMs - part.sourceStartMs,
        clipIds: [...window.clipIds]
      });
      sectionIndex += 1;
    }
    const plannedDurationMs = sections
      .filter((section) => section.windowIndex === windowIndex)
      .reduce((total, section) => (
        total + section.sourceEndMs - section.sourceStartMs
      ), 0);
    if (
      sectionIndex === 0
      || plannedDurationMs
        !== window.editableSourceEndMs - window.editableSourceStartMs
    ) {
      fail("외부 VOD 파트 사이에 시간축 공백이 있습니다.", "INVALID_METADATA");
    }
  }
  return sections;
}

/** Builds exact per-clip coverage and splits its union on SOOP part boundaries. */
export function planExternalVodSections(
  metadata: ExternalVodMetadata,
  clips: readonly ExternalVodClipRange[],
  handleMs = DEFAULT_EXTERNAL_VOD_HANDLE_MS,
  editableRanges?: readonly ExternalVodEditableRange[]
): ExternalVodPlan {
  const validatedHandle = validatedHandleMs(handleMs);
  const { publicClips, coreClips } = normalizeClipRanges(
    clips,
    metadata.durationMs
  );
  const desiredEditableRanges = normalizeEditableRanges(
    editableRanges,
    publicClips,
    metadata.durationMs,
    validatedHandle
  );
  const clipRanges = createMaterializationClipCoverages(
    coreClips,
    metadata.durationMs,
    validatedHandle,
    desiredEditableRanges
  );
  const windows = mergeMaterializationClipCoverages(clipRanges);
  const materializedDurationMs = windows.reduce((total, window) => (
    total + window.editableSourceEndMs - window.editableSourceStartMs
  ), 0);
  if (
    materializedDurationMs <= 0
    || materializedDurationMs > MAX_EXTERNAL_VOD_MATERIALIZED_MS
  ) {
    fail(
      "선택 구간과 앞뒤 여유 구간의 합은 최대 6시간까지 준비할 수 있습니다.",
      "MATERIALIZATION_QUOTA_EXCEEDED"
    );
  }
  const sections = splitExternalWindowsOnParts(metadata, windows);
  return {
    clipRanges: clipRanges.map((range) => ({ ...range })),
    windows: windows.map((window) => ({
      ...window,
      clipIds: [...window.clipIds]
    })),
    sections
  };
}

export const planExternalVodWindows = planExternalVodSections;

export function assertExternalMaterializationByteQuota(
  completedBytes: number,
  nextBytes: number
): number {
  if (
    !Number.isSafeInteger(completedBytes)
    || !Number.isSafeInteger(nextBytes)
    || completedBytes < 0
    || nextBytes < 0
    || completedBytes > MAX_EXTERNAL_VOD_WORK_BYTES - nextBytes
  ) {
    fail(
      "외부 VOD 작업 파일이 64 GiB 안전 상한을 넘었습니다.",
      "MATERIALIZATION_QUOTA_EXCEEDED"
    );
  }
  return completedBytes + nextBytes;
}

function plannedExternalVodDurationMs(plan: ExternalVodPlan): number {
  return plan.windows.reduce((total, window) => (
    total + window.editableSourceEndMs - window.editableSourceStartMs
  ), 0);
}

export async function assertExternalDiskHeadroom(
  directory: string,
  materializedDurationMs: number,
  inspectFileSystem: NonNullable<
    ExternalVodMaterializerDependencies["statFileSystem"]
  > = statFileSystem
): Promise<void> {
  if (
    !Number.isSafeInteger(materializedDurationMs)
    || materializedDurationMs <= 0
    || materializedDurationMs > MAX_EXTERNAL_VOD_MATERIALIZED_MS
  ) {
    fail("외부 VOD 예상 작업 길이가 올바르지 않습니다.", "MATERIALIZATION_QUOTA_EXCEEDED");
  }
  let fileSystem: Awaited<ReturnType<typeof inspectFileSystem>>;
  try {
    fileSystem = await inspectFileSystem(directory);
  } catch {
    fail("외부 VOD 작업 디스크의 여유 공간을 확인하지 못했습니다.", "DISK_SPACE_CHECK_FAILED");
  }
  let availableBytes: bigint;
  try {
    availableBytes = availableFileSystemBytes(fileSystem);
  } catch {
    fail("외부 VOD 작업 디스크의 여유 공간 값이 올바르지 않습니다.", "DISK_SPACE_CHECK_FAILED");
  }
  const estimatedWorkBytes = Math.min(
    MAX_EXTERNAL_VOD_WORK_BYTES,
    Math.ceil(materializedDurationMs / 1_000)
      * ESTIMATED_EXTERNAL_VOD_WORK_BYTES_PER_SECOND
  );
  const requiredBytes = BigInt(estimatedWorkBytes)
    + BigInt(MIN_EXTERNAL_VOD_DISK_HEADROOM_BYTES);
  if (availableBytes < requiredBytes) {
    fail(
      "선택 구간을 안전하게 준비할 디스크 여유 공간이 부족합니다.",
      "INSUFFICIENT_DISK_SPACE"
    );
  }
}

function materializationWindows(
  logicalWindows: readonly LogicalMaterializationWindow[]
): MaterializationWindow[] {
  let mediaCursorMs = 0;
  return logicalWindows.map((window, index) => {
    const durationMs = window.editableSourceEndMs - window.editableSourceStartMs;
    const mapped: MaterializationWindow = {
      id: `window-${index + 1}`,
      editableSourceStartMs: window.editableSourceStartMs,
      editableSourceEndMs: window.editableSourceEndMs,
      fetchedSourceStartMs: window.editableSourceStartMs,
      fetchedSourceEndMs: window.editableSourceEndMs,
      mediaStartMs: mediaCursorMs,
      mediaEndMs: mediaCursorMs + durationMs,
      clipIds: [...window.clipIds]
    };
    mediaCursorMs += durationMs;
    return mapped;
  });
}

export function externalVodPlanFingerprint({
  metadata,
  clips,
  plan,
  handleMs = DEFAULT_EXTERNAL_VOD_HANDLE_MS,
  acquisitionVersion = 3,
  acquisitionClockProofSetId,
  sourceClockIdentitySha256
}: {
  metadata: ExternalVodMetadata;
  clips: readonly ExternalVodClipRange[];
  plan: ExternalVodPlan;
  handleMs?: number;
  acquisitionVersion?: 1 | 2 | 3;
  acquisitionClockProofSetId?: string;
  sourceClockIdentitySha256?: string;
}): string {
  validatedHandleMs(handleMs);
  if (
    acquisitionVersion === 3
    && (
      typeof acquisitionClockProofSetId !== "string"
      || !/^[a-f0-9]{64}$/u.test(acquisitionClockProofSetId)
    )
  ) {
    fail("v3 계획에는 선택 미디어 시간축 증거가 필요합니다.", "INVALID_CLOCK_PROOF");
  }
  const { publicClips } = normalizeClipRanges(clips, metadata.durationMs);
  const fingerprintPayload: UnknownRecord = {
    acquisitionVersion,
    platform: metadata.platform,
    canonicalUrl: metadata.canonicalUrl,
    contentId: metadata.contentId,
    sourceVersionId: metadata.sourceVersionId,
    durationMs: metadata.durationMs,
    handleMs,
    clips: [...publicClips].sort((left, right) => (
      left.id.localeCompare(right.id)
    )),
    windows: plan.windows.map((window) => ({
      editableSourceStartMs: window.editableSourceStartMs,
      editableSourceEndMs: window.editableSourceEndMs,
      clipIds: [...window.clipIds].sort()
    })),
    sections: plan.sections.map((section) => ({
      partIndex: section.partIndex,
      playlistItem: section.playlistItem ?? null,
      sourceStartMs: section.sourceStartMs,
      sourceEndMs: section.sourceEndMs,
      partStartMs: section.partStartMs,
      partEndMs: section.partEndMs
    }))
  };
  if (acquisitionVersion >= 2) {
    fingerprintPayload.clipRanges = [...plan.clipRanges].sort((left, right) => (
      left.clipId.localeCompare(right.clipId)
    ));
  }
  if (acquisitionVersion === 3) {
    fingerprintPayload.acquisitionClockProofSetId = acquisitionClockProofSetId;
    if (metadata.platform === "SOOP") {
      const identityFromParts = metadata.parts.length > 0
        ? deriveSoopVodSourceClockIdentity({
          contentId: metadata.contentId,
          totalDurationSeconds: metadata.durationMs / 1_000,
          parts: metadata.parts.map((part) => ({
            id: part.id,
            durationSeconds: part.durationMs / 1_000
          }))
        })
        : undefined;
      const declaredIdentity = metadata.sourceClockIdentity === undefined
        ? undefined
        : normalizeSoopVodSourceClockIdentity(metadata.sourceClockIdentity);
      if (
        metadata.sourceClockIdentity !== undefined
        && (
          !declaredIdentity
          || !identityFromParts
          || !sameSoopVodSourceClockIdentity(
            declaredIdentity,
            identityFromParts
          )
        )
      ) {
        fail(
          "SOOP 계획의 metadata part와 시간축 identity가 다릅니다.",
          "INVALID_SOURCE_CLOCK"
        );
      }
      const metadataIdentity = declaredIdentity ?? identityFromParts;
      const metadataIdentitySha256 = metadataIdentity
        ? soopSourceClockIdentitySha256(metadataIdentity)
        : undefined;
      const identitySha256 = sourceClockIdentitySha256
        ?? metadataIdentitySha256;
      if (
        typeof identitySha256 !== "string"
        || !/^[a-f0-9]{64}$/u.test(identitySha256)
        || (
          metadataIdentitySha256 !== undefined
          && metadataIdentitySha256 !== identitySha256
        )
      ) {
        fail(
          "SOOP v3 계획에는 공식 root·entries 시간축 지문이 필요합니다.",
          "INVALID_SOURCE_CLOCK"
        );
      }
      fingerprintPayload.sourceClockIdentitySha256 = identitySha256;
    } else if (sourceClockIdentitySha256 !== undefined) {
      fail(
        "SOOP이 아닌 v3 계획에는 SOOP 시간축 지문을 넣을 수 없습니다.",
        "INVALID_SOURCE_CLOCK"
      );
    }
  }
  return sha256Text(stableJson(fingerprintPayload));
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("외부 VOD 로컬 준비가 취소되었습니다.", "CANCELLED");
  }
}

function appendBoundedChunk(
  chunks: Buffer[],
  chunk: Buffer,
  state: { bytes: number }
): boolean {
  state.bytes += chunk.byteLength;
  if (state.bytes > MAX_EXTERNAL_PROCESS_OUTPUT_BYTES) {
    return false;
  }
  chunks.push(chunk);
  return true;
}

async function externalWorkspaceBytes(
  rootDirectory: string,
  byteLimit: number
): Promise<number> {
  const state = { bytes: 0, entries: 0 };
  const inspectDirectory = async (
    directory: string,
    depth: number
  ): Promise<void> => {
    if (depth > MAX_EXTERNAL_WORKSPACE_SCAN_DEPTH) {
      fail(
        "외부 도구 작업 폴더의 중첩 깊이가 안전 상한을 넘었습니다.",
        "MATERIALIZATION_QUOTA_EXCEEDED"
      );
    }
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (depth > 0 && isRecord(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      state.entries += 1;
      if (state.entries > MAX_EXTERNAL_WORKSPACE_SCAN_ENTRIES) {
        fail(
          "외부 도구 작업 폴더의 항목 수가 안전 상한을 넘었습니다.",
          "MATERIALIZATION_QUOTA_EXCEEDED"
        );
      }
      const entryPath = path.join(directory, entry.name);
      let entryStatus: Awaited<ReturnType<typeof lstat>>;
      try {
        entryStatus = await lstat(entryPath);
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (entryStatus.isSymbolicLink()) {
        fail(
          "외부 도구 작업 폴더에 허용되지 않은 심볼릭 링크가 생겼습니다.",
          "UNSAFE_OUTPUT_PATH"
        );
      }
      if (entryStatus.isDirectory()) {
        await inspectDirectory(entryPath, depth + 1);
        continue;
      }
      if (!entryStatus.isFile()) {
        fail(
          "외부 도구 작업 폴더에 허용되지 않은 특수 파일이 생겼습니다.",
          "UNSAFE_OUTPUT_PATH"
        );
      }
      state.bytes = assertExternalMaterializationByteQuota(
        state.bytes,
        entryStatus.size
      );
      if (state.bytes > byteLimit) {
        fail(
          "외부 VOD 작업 파일이 실시간 안전 상한을 넘었습니다.",
          "MATERIALIZATION_QUOTA_EXCEEDED"
        );
      }
    }
  };
  await inspectDirectory(path.resolve(rootDirectory), 0);
  return state.bytes;
}

function availableFileSystemBytes(fileSystem: {
  bavail: number | bigint;
  bsize: number | bigint;
}): bigint {
  let availableBlocks: bigint;
  let blockSize: bigint;
  try {
    availableBlocks = BigInt(fileSystem.bavail);
    blockSize = BigInt(fileSystem.bsize);
  } catch {
    fail(
      "외부 VOD 작업 디스크의 여유 공간 값이 올바르지 않습니다.",
      "DISK_SPACE_CHECK_FAILED"
    );
  }
  if (availableBlocks < 0n || blockSize <= 0n) {
    fail(
      "외부 VOD 작업 디스크의 여유 공간 값이 올바르지 않습니다.",
      "DISK_SPACE_CHECK_FAILED"
    );
  }
  return availableBlocks * blockSize;
}

/** Default process boundary. It never invokes a shell. */
export function windowsProcessTreeTerminationCommand(
  processId: number,
  environment: NodeJS.ProcessEnv = process.env
): Readonly<{ command: string; args: readonly string[] }> {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    fail("Windows 외부 도구 process tree 식별자가 올바르지 않습니다.", "INVALID_PROCESS_BINARY");
  }
  const systemRoot = String(environment.SystemRoot || environment.SYSTEMROOT || "");
  if (
    !systemRoot
    || systemRoot.trim() !== systemRoot
    || !path.win32.isAbsolute(systemRoot)
    || /[\u0000-\u001f\u007f]/u.test(systemRoot)
  ) {
    fail("Windows SystemRoot 경로를 안전하게 확인하지 못했습니다.", "INVALID_PROCESS_BINARY");
  }
  return Object.freeze({
    command: path.win32.join(systemRoot, "System32", "taskkill.exe"),
    args: Object.freeze(["/PID", String(processId), "/T", "/F"])
  });
}

export async function terminateWindowsExternalProcessTree(
  processId: number,
  {
    spawnImpl = spawn,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    timeoutMs = EXTERNAL_PROCESS_KILL_GRACE_MS,
    environment = process.env,
    probeProcessImpl = (pid: number) => process.kill(pid, 0),
    confirmTargetIdentityImpl
  }: {
    spawnImpl?: typeof spawn;
    setTimeoutImpl?: typeof setTimeout;
    clearTimeoutImpl?: typeof clearTimeout;
    timeoutMs?: number;
    environment?: NodeJS.ProcessEnv;
    probeProcessImpl?: (pid: number) => void;
    confirmTargetIdentityImpl?: () => Promise<boolean>;
  } = {}
): Promise<void> {
  const invocation = windowsProcessTreeTerminationCommand(processId, environment);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail("Windows process tree 종료 시간 제한이 올바르지 않습니다.", "INVALID_PROCESS_TIMEOUT");
  }
  await terminateWindowsProcessTreeWithTaskkill({
    processId,
    command: invocation.command,
    args: invocation.args,
    spawnImpl,
    probeProcessImpl,
    ...(confirmTargetIdentityImpl
      ? { confirmTargetIdentityImpl }
      : {}),
    setTimeoutImpl,
    clearTimeoutImpl,
    timeoutMs
  });
}

export async function runExternalProcess(
  command: string,
  args: readonly string[],
  options: ExternalProcessRunOptions,
  {
    spawnImpl = spawn,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    killProcessGroupImpl = (pid, signal) => process.kill(-pid, signal),
    probeProcessGroupImpl = (pid) => process.kill(-pid, 0),
    terminateWindowsProcessTreeImpl = terminateWindowsExternalProcessTree,
    killGraceMs = EXTERNAL_PROCESS_KILL_GRACE_MS,
    platform = process.platform,
    statFileSystemImpl = statFileSystem
  }: {
    spawnImpl?: typeof spawn;
    setTimeoutImpl?: typeof setTimeout;
    clearTimeoutImpl?: typeof clearTimeout;
    killProcessGroupImpl?: (pid: number, signal: NodeJS.Signals) => void;
    probeProcessGroupImpl?: (pid: number) => void;
    terminateWindowsProcessTreeImpl?: typeof terminateWindowsExternalProcessTree;
    killGraceMs?: number;
    platform?: NodeJS.Platform;
    statFileSystemImpl?: (directory: string) => Promise<{
      bavail: number | bigint;
      bsize: number | bigint;
    }>;
  } = {}
): Promise<ExternalProcessResult> {
  abortIfRequested(options.signal);
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXTERNAL_PROCESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail("외부 도구 실행 시간 제한이 올바르지 않습니다.", "INVALID_PROCESS_TIMEOUT");
  }
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs < 0) {
    fail("외부 도구 종료 대기 시간이 올바르지 않습니다.", "INVALID_PROCESS_TIMEOUT");
  }
  if (
    options.workingDirectoryByteLimit !== undefined
    && (
      !Number.isSafeInteger(options.workingDirectoryByteLimit)
      || options.workingDirectoryByteLimit <= 0
      || options.workingDirectoryByteLimit > MAX_EXTERNAL_VOD_WORK_BYTES
    )
  ) {
    fail("외부 도구 작업 폴더 크기 상한이 올바르지 않습니다.", "MATERIALIZATION_QUOTA_EXCEEDED");
  }
  if (
    options.minimumAvailableDiskBytes !== undefined
    && (
      !Number.isSafeInteger(options.minimumAvailableDiskBytes)
      || options.minimumAvailableDiskBytes < 0
    )
  ) {
    fail("외부 도구 디스크 여유 상한이 올바르지 않습니다.", "DISK_SPACE_CHECK_FAILED");
  }
  if (
    options.inheritedInputFileDescriptor !== undefined
    && (
      !Number.isSafeInteger(options.inheritedInputFileDescriptor)
      || options.inheritedInputFileDescriptor < 0
    )
  ) {
    fail("외부 도구에 전달할 파일 디스크립터가 올바르지 않습니다.", "INVALID_PROCESS_BINARY");
  }
  return await new Promise<ExternalProcessResult>((resolve, reject) => {
    const useProcessGroup = platform !== "win32";
    const privateWorkingDirectory = path.resolve(options.cwd);
    const isolatedEnvironment = Object.fromEntries(
      Object.entries(options.env).filter(([key]) => (
        !TEMPORARY_ENVIRONMENT_KEYS.has(key.toUpperCase())
      ))
    );
    const inheritedInputFileDescriptor = options.inheritedInputFileDescriptor;
    const spawnOptions = {
      cwd: privateWorkingDirectory,
      env: {
        ...isolatedEnvironment,
        TEMP: privateWorkingDirectory,
        TMP: privateWorkingDirectory,
        TMPDIR: privateWorkingDirectory
      },
      shell: false as const,
      stdio: inheritedInputFileDescriptor === undefined
        ? ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"]
        : ["ignore", "pipe", "pipe", inheritedInputFileDescriptor] as [
          "ignore",
          "pipe",
          "pipe",
          number
        ],
      windowsHide: true,
      ...(useProcessGroup ? { detached: true } : {})
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(command, [...args], spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const stdoutState = { bytes: 0 };
    const stderrState = { bytes: 0 };
    let settled = false;
    let closed = false;
    let childError: Error | undefined;
    let terminationError: Error | undefined;
    let cleanupError: Error | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let windowsCloseDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let resourceMonitor: ReturnType<typeof setInterval> | undefined;
    let resourceInspectionPromise: Promise<void> | undefined;
    let resourceInspectionError: Error | undefined;
    let processTreeCleanupPromise: Promise<void> | undefined;
    const resourceLimitsEnabled = (
      options.workingDirectoryByteLimit !== undefined
      || options.minimumAvailableDiskBytes !== undefined
    );

    const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
      if (timer !== undefined) {
        clearTimeoutImpl(timer);
      }
    };
    const processId = (): number | undefined => (
      Number.isSafeInteger(child.pid) && Number(child.pid) > 0
        ? Number(child.pid)
        : undefined
    );
    const signalLeader = (signal: NodeJS.Signals): boolean => {
      if (closed) {
        return true;
      }
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    };
    const recordCleanupError = (error: unknown): void => {
      cleanupError ??= error instanceof Error
        ? error
        : new Error("외부 도구 process tree를 종료하지 못했습니다.");
    };
    const ensurePosixProcessGroupCleanup = (
      pid: number
    ): Promise<void> => {
      if (!processTreeCleanupPromise) {
        processTreeCleanupPromise = terminatePosixProcessGroup({
          processGroupId: pid,
          signalProcessGroupImpl: killProcessGroupImpl,
          probeProcessGroupImpl,
          graceMs: killGraceMs,
          setTimeoutImpl
        }).catch(recordCleanupError);
      }
      return processTreeCleanupPromise;
    };
    const ensureWindowsProcessTreeCleanup = (
      pid: number
    ): Promise<void> => {
      if (!processTreeCleanupPromise) {
        const capturedPid = pid;
        processTreeCleanupPromise = terminateWindowsProcessTreeImpl(
          capturedPid,
          {
            setTimeoutImpl,
            clearTimeoutImpl,
            timeoutMs: Math.max(1, killGraceMs),
            confirmTargetIdentityImpl: async () => {
              if (
                closed
                || processId() !== capturedPid
                || child.exitCode != null
                || child.signalCode != null
              ) {
                return false;
              }
              try {
                // ChildProcess.kill(0) probes the retained OS process handle.
                // Combined with the captured numeric PID, this prevents a
                // later taskkill retry from following a reused PID.
                return child.kill(0);
              } catch {
                return false;
              }
            }
          }
        ).catch(recordCleanupError);
      }
      return processTreeCleanupPromise;
    };
    const terminate = (error: Error) => {
      if (terminationError) {
        return;
      }
      terminationError = error;
      if (closed) {
        // A retained handle that has already emitted close no longer binds a
        // numeric PID strongly enough for taskkill. The close finalizer will
        // propagate this termination error without touching a reused PID.
        return;
      }
      const pid = processId();
      if (platform === "win32") {
        if (pid !== undefined) {
          void ensureWindowsProcessTreeCleanup(pid);
        } else {
          // A successfully spawned real ChildProcess has a PID. Retain the
          // exact-handle fallback for malformed injected implementations, but
          // fail closed because descendant cleanup could not be proven.
          recordCleanupError(new Error(
            "Windows 외부 도구의 process tree 식별자를 확인하지 못했습니다."
          ));
          signalLeader("SIGKILL");
        }
        windowsCloseDeadlineTimer = setTimeoutImpl(() => {
          if (settled) {
            return;
          }
          recordCleanupError(Object.assign(
            new Error("Windows 외부 도구 process tree 정리 뒤에도 child가 닫히지 않았습니다."),
            { code: "EPROCESSCLOSEDEADLINE" }
          ));
          settled = true;
          clearTimer(timeoutTimer);
          clearTimer(forceKillTimer);
          if (resourceMonitor !== undefined) {
            clearInterval(resourceMonitor);
          }
          options.signal?.removeEventListener("abort", abortListener);
          void (async () => {
            if (processTreeCleanupPromise) {
              await processTreeCleanupPromise;
            }
            child.stdout?.destroy();
            child.stderr?.destroy();
            (child as typeof child & { unref?: () => void }).unref?.();
            const finalError = terminationError
              ?? childError
              ?? resourceInspectionError
              ?? cleanupError!;
            if (
              cleanupError
              && cleanupError !== finalError
              && finalError.cause === undefined
            ) {
              Object.defineProperty(finalError, "cause", {
                configurable: true,
                value: cleanupError
              });
            }
            reject(finalError);
          })().catch(reject);
        }, windowsTaskkillOuterGuardTimeoutMs(Math.max(1, killGraceMs)));
        return;
      }
      if (useProcessGroup && pid !== undefined) {
        void ensurePosixProcessGroupCleanup(pid);
        return;
      }
      signalLeader("SIGTERM");
      forceKillTimer = setTimeoutImpl(() => {
        signalLeader("SIGKILL");
      }, killGraceMs);
    };
    const normalizedResourceInspectionError = (error: unknown): Error => (
      error instanceof Error
        ? error
        : new ExternalVodMaterializationError(
          "외부 VOD 작업 디스크를 실시간 확인하지 못했습니다.",
          "DISK_SPACE_CHECK_FAILED"
        )
    );
    const validateResourceLimits = async (): Promise<void> => {
      if (options.workingDirectoryByteLimit !== undefined) {
        await externalWorkspaceBytes(
          privateWorkingDirectory,
          options.workingDirectoryByteLimit
        );
      }
      if (options.minimumAvailableDiskBytes !== undefined) {
        const fileSystem = await statFileSystemImpl(privateWorkingDirectory);
        const availableBytes = availableFileSystemBytes(fileSystem);
        if (availableBytes < BigInt(options.minimumAvailableDiskBytes)) {
          throw new ExternalVodMaterializationError(
            "외부 VOD를 쓰는 동안 디스크 안전 여유 공간이 부족해졌습니다.",
            "INSUFFICIENT_DISK_SPACE"
          );
        }
      }
    };
    const startResourceInspection = (): Promise<void> => {
      if (resourceInspectionPromise) {
        return resourceInspectionPromise;
      }
      if (closed) {
        return Promise.resolve();
      }
      const currentInspection = validateResourceLimits()
        .catch((error: unknown) => {
          const normalized = normalizedResourceInspectionError(error);
          resourceInspectionError ??= normalized;
          terminate(normalized);
        })
        .finally(() => {
          if (resourceInspectionPromise === currentInspection) {
            resourceInspectionPromise = undefined;
          }
        });
      resourceInspectionPromise = currentInspection;
      return currentInspection;
    };
    const abortListener = () => {
      const error = Object.assign(
        new Error("외부 VOD 로컬 준비가 취소되었습니다."),
        { code: "ABORT_ERR" }
      );
      terminate(error);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (!appendBoundedChunk(stdout, Buffer.from(chunk), stdoutState)) {
        terminate(Object.assign(
          new Error("외부 도구 출력이 안전한 크기 상한을 넘었습니다."),
          { code: "EOVERFLOW" }
        ));
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (!appendBoundedChunk(stderr, Buffer.from(chunk), stderrState)) {
        terminate(Object.assign(
          new Error("외부 도구 출력이 안전한 크기 상한을 넘었습니다."),
          { code: "EOVERFLOW" }
        ));
      }
    });
    child.once("error", (error) => {
      childError = error;
    });
    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      closed = true;
      settled = true;
      clearTimer(timeoutTimer);
      clearTimer(windowsCloseDeadlineTimer);
      if (resourceMonitor !== undefined) {
        clearInterval(resourceMonitor);
      }
      options.signal?.removeEventListener("abort", abortListener);
      void (async () => {
        const pid = processId();
        if (useProcessGroup && pid !== undefined) {
          await ensurePosixProcessGroupCleanup(pid);
        }
        const inFlightInspection = resourceInspectionPromise;
        if (inFlightInspection) {
          await inFlightInspection;
        }
        if (
          resourceLimitsEnabled
          && !terminationError
          && !childError
          && !resourceInspectionError
        ) {
          try {
            await validateResourceLimits();
          } catch (error) {
            resourceInspectionError = normalizedResourceInspectionError(error);
            terminate(resourceInspectionError);
          }
        }
        if (processTreeCleanupPromise) {
          await processTreeCleanupPromise;
        }
        clearTimer(forceKillTimer);
        clearTimer(windowsCloseDeadlineTimer);
        const error = terminationError
          ?? childError
          ?? resourceInspectionError
          ?? cleanupError;
        if (error) {
          if (cleanupError && cleanupError !== error && error.cause === undefined) {
            Object.defineProperty(error, "cause", {
              configurable: true,
              value: cleanupError
            });
          }
          reject(error);
        } else {
          resolve({
            exitCode: exitCode ?? -1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8")
          });
        }
      })().catch(reject);
    });
    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) {
      abortListener();
    }
    if (resourceLimitsEnabled) {
      void startResourceInspection();
      resourceMonitor = setInterval(
        () => void startResourceInspection(),
        EXTERNAL_RESOURCE_MONITOR_INTERVAL_MS
      );
      resourceMonitor.unref?.();
    }
    timeoutTimer = setTimeoutImpl(() => {
      terminate(Object.assign(
        new Error(`외부 도구가 ${timeoutMs}ms 시간 제한을 넘었습니다.`),
        { code: "ETIMEDOUT" }
      ));
    }, timeoutMs);
  });
}

function processOptions(
  cwd: string,
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_EXTERNAL_PROCESS_TIMEOUT_MS
): ExternalProcessRunOptions {
  return {
    cwd,
    env: createExternalProcessEnvironment(environment, cwd),
    shell: false,
    timeoutMs,
    ...(signal ? { signal } : {})
  };
}

async function checkedProcess(
  runProcess: ExternalProcessRunner,
  command: string,
  args: readonly string[],
  options: ExternalProcessRunOptions,
  code: string,
  message: string
): Promise<ExternalProcessResult> {
  let result: ExternalProcessResult;
  try {
    result = await runProcess(command, args, options);
  } catch (error) {
    abortIfRequested(options.signal);
    if (error instanceof ExternalVodMaterializationError) {
      throw error;
    }
    if (isRecord(error) && error.code === "ENOENT") {
      const binaryLabel = command.includes("python")
        ? "Python 또는 yt-dlp"
        : command.includes("yt-dlp")
          ? "yt-dlp"
        : command.includes("ffprobe")
          ? "ffprobe"
          : command.includes("ffmpeg")
            ? "ffmpeg"
            : "필요한 로컬 미디어 도구";
      fail(
        `${binaryLabel} 실행 파일을 찾을 수 없습니다. 설치 후 다시 시도해 주세요.`,
        "TOOL_NOT_INSTALLED"
      );
    }
    fail(message, code);
  }
  if (result.exitCode !== 0) {
    fail(message, code);
  }
  return result;
}

export function buildExternalFfprobeArgs(
  filePath: string,
  {
    inheritedInputFileDescriptor
  }: {
    inheritedInputFileDescriptor?: number;
  } = {}
): string[] {
  const inputPath = inheritedInputFileDescriptor === undefined
    ? path.resolve(filePath)
    : filePath === "/dev/fd/3" || filePath === "pipe:3"
      ? filePath
      : fail(
        "열린 파일 핸들 검사 입력이 허용된 ffprobe descriptor가 아닙니다.",
        "MEDIA_VERIFICATION_FAILED"
      );
  return [
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-show_data",
    "-show_data_hash", "sha256",
    "-of", "json",
    "--",
    inputPath
  ];
}

function optionalExternalStreamTimeline(
  stream: UnknownRecord,
  label: string
): ExternalMediaStreamTimeline | undefined {
  const rawStart = stream.start_time;
  const rawDuration = stream.duration;
  const hasStart = rawStart !== undefined
    && rawStart !== null
    && String(rawStart).trim().toUpperCase() !== "N/A";
  const hasDuration = rawDuration !== undefined
    && rawDuration !== null
    && String(rawDuration).trim().toUpperCase() !== "N/A";
  if (!hasStart && !hasDuration) {
    return undefined;
  }
  if (!hasStart || !hasDuration) {
    fail(
      `${label} 스트림의 시작·끝 시간축을 완전히 확인하지 못했습니다.`,
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  const startSeconds = Number(rawStart);
  const durationSeconds = Number(rawDuration);
  const startMs = Math.round(startSeconds * 1_000);
  const durationMs = Math.round(durationSeconds * 1_000);
  const endMs = startMs + durationMs;
  if (
    !Number.isFinite(startSeconds)
    || !Number.isFinite(durationSeconds)
    || !Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(durationMs)
    || !Number.isSafeInteger(endMs)
    || Math.abs(startMs) > MAX_EXTERNAL_VOD_SOURCE_MS
    || durationMs <= 0
    || durationMs > MAX_EXTERNAL_VOD_SOURCE_MS
    || endMs <= startMs
    || Math.abs(endMs) > MAX_EXTERNAL_VOD_SOURCE_MS * 2
  ) {
    fail(
      `${label} 스트림의 시작·끝 시간축이 올바르지 않습니다.`,
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  return { startMs, endMs, durationMs };
}

function externalStreamTimelines(
  video: UnknownRecord,
  audio: UnknownRecord | undefined,
  format: UnknownRecord,
  containerDurationMs: number
): ExternalMediaInspection["streamTimelines"] {
  const videoTimeline = optionalExternalStreamTimeline(video, "비디오");
  const audioTimeline = audio
    ? optionalExternalStreamTimeline(audio, "오디오")
    : undefined;
  if (!videoTimeline && !audioTimeline) {
    return undefined;
  }
  if (!videoTimeline || (audio && !audioTimeline)) {
    fail(
      "로컬 MP4의 모든 비디오·오디오 스트림 시간축이 필요합니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  const timelines = audioTimeline
    ? [videoTimeline, audioTimeline]
    : [videoTimeline];
  const unionStartMs = Math.min(...timelines.map((timeline) => timeline.startMs));
  const unionEndMs = Math.max(...timelines.map((timeline) => timeline.endMs));
  const rawFormatStart = format.start_time;
  const hasFormatStart = rawFormatStart !== undefined
    && rawFormatStart !== null
    && String(rawFormatStart).trim().toUpperCase() !== "N/A";
  const formatStartSeconds = hasFormatStart
    ? Number(rawFormatStart)
    : unionStartMs / 1_000;
  const formatStartMs = Math.round(formatStartSeconds * 1_000);
  const formatEndMs = formatStartMs + containerDurationMs;
  if (
    !Number.isFinite(formatStartSeconds)
    || !Number.isSafeInteger(formatStartMs)
    || !Number.isSafeInteger(formatEndMs)
    || Math.abs(formatStartMs) > MAX_EXTERNAL_VOD_SOURCE_MS
    || Math.abs(formatEndMs) > MAX_EXTERNAL_VOD_SOURCE_MS * 2
    || Math.abs(unionStartMs - formatStartMs) > MAX_SECTION_DURATION_DRIFT_MS
    || Math.abs(unionEndMs - formatEndMs) > MAX_SECTION_DURATION_DRIFT_MS
    || Math.abs(
      unionEndMs - unionStartMs - containerDurationMs
    ) > MAX_SECTION_DURATION_DRIFT_MS
  ) {
    fail(
      "로컬 MP4 컨테이너와 스트림의 시작·끝 시간축이 일치하지 않습니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  return {
    video: videoTimeline,
    ...(audioTimeline ? { audio: audioTimeline } : {})
  };
}

function assertExternalSectionCoverage(
  inspection: ExternalMediaInspection,
  expectedDurationMs: number,
  message: string,
  code: "MEDIA_VERIFICATION_FAILED" | "CACHE_INTEGRITY_FAILED"
): void {
  const timelines = inspection.streamTimelines;
  if (!timelines) {
    if (
      Math.abs(inspection.durationMs - expectedDurationMs)
        > MAX_SECTION_DURATION_DRIFT_MS
    ) {
      fail(message, code);
    }
    return;
  }
  const streamTimelines = [
    timelines.video,
    ...(timelines.audio ? [timelines.audio] : [])
  ];
  if (streamTimelines.some((timeline) => (
    timeline.startMs < -MAX_SECTION_DURATION_DRIFT_MS
    || timeline.startMs > MAX_EXTERNAL_SECTION_STREAM_EDGE_OFFSET_MS
    || Math.abs(timeline.durationMs - expectedDurationMs)
      > MAX_EXTERNAL_SECTION_STREAM_EDGE_OFFSET_MS
    || Math.abs(timeline.endMs - expectedDurationMs)
      > MAX_EXTERNAL_SECTION_STREAM_EDGE_OFFSET_MS
  ))) {
    fail(message, code);
  }
}

function externalFrameRate(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const normalized = String(value || "").trim();
  const rational = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/u.exec(normalized);
  if (rational) {
    const numerator = Number(rational[1]);
    const denominator = Number(rational[2]);
    return denominator > 0 ? numerator / denominator : Number.NaN;
  }
  return Number(normalized);
}

function packetCopyText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized
    && normalized.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9 ._:+/-]*$/u.test(normalized)
    ? normalized
    : undefined;
}

function packetCopyRational(
  value: unknown,
  separator: "/" | ":"
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  const pattern = separator === "/"
    ? /^(\d{1,10})\/([1-9]\d{0,9})$/u
    : /^(\d{1,10}):([1-9]\d{0,9})$/u;
  const match = pattern.exec(normalized);
  if (!match || Number(match[1]) <= 0) {
    return undefined;
  }
  return `${Number(match[1])}${separator}${Number(match[2])}`;
}

function packetCopyExtradataHash(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^SHA256:([a-f0-9]{64})$/iu.exec(value.trim());
  return match?.[1] ? `sha256:${match[1].toLowerCase()}` : undefined;
}

function optionalPacketCopyText(
  value: unknown
): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return packetCopyText(value);
}

/**
 * Produces a strict, process-local identity for codec initialization data.
 * Timing, bitrate and encoder tags intentionally stay out because they vary by
 * section length; all parameters needed to decode packet-copied streams must
 * match byte-for-byte or concat falls back to the existing transcode path.
 */
function externalPacketCopySignature(
  video: UnknownRecord,
  audio: UnknownRecord | undefined
): string | undefined {
  const width = Number(video.width);
  const height = Number(video.height);
  const codedWidth = Number(video.coded_width);
  const codedHeight = Number(video.coded_height);
  const profile = packetCopyText(video.profile);
  const level = Number(video.level);
  const fieldOrder = packetCopyText(video.field_order);
  const sampleAspectRatio = packetCopyRational(
    video.sample_aspect_ratio,
    ":"
  );
  const frameRate = packetCopyRational(video.r_frame_rate, "/");
  const timeBase = packetCopyRational(video.time_base, "/");
  const extradataHash = packetCopyExtradataHash(video.extradata_hash);
  const colorRange = optionalPacketCopyText(video.color_range);
  const colorSpace = optionalPacketCopyText(video.color_space);
  const colorTransfer = optionalPacketCopyText(video.color_transfer);
  const colorPrimaries = optionalPacketCopyText(video.color_primaries);
  const chromaLocation = optionalPacketCopyText(video.chroma_location);
  if (
    video.codec_name !== "h264"
    || video.codec_tag_string !== "avc1"
    || video.pix_fmt !== "yuv420p"
    || video.is_avc !== "true"
    || String(video.nal_length_size) !== "4"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || !Number.isSafeInteger(codedWidth)
    || !Number.isSafeInteger(codedHeight)
    || width <= 0
    || height <= 0
    || codedWidth <= 0
    || codedHeight <= 0
    || !profile
    || !Number.isSafeInteger(level)
    || level <= 0
    || !fieldOrder
    || !sampleAspectRatio
    || !frameRate
    || !timeBase
    || !extradataHash
    || colorRange === undefined
    || colorSpace === undefined
    || colorTransfer === undefined
    || colorPrimaries === undefined
    || chromaLocation === undefined
  ) {
    return undefined;
  }

  let audioIdentity: UnknownRecord | null = null;
  if (audio) {
    const audioProfile = packetCopyText(audio.profile);
    const sampleFormat = packetCopyText(audio.sample_fmt);
    const audioTimeBase = packetCopyRational(audio.time_base, "/");
    const audioExtradataHash = packetCopyExtradataHash(audio.extradata_hash);
    const sampleRate = Number(audio.sample_rate);
    const channels = Number(audio.channels);
    const channelLayout = packetCopyText(audio.channel_layout);
    if (
      audio.codec_name !== "aac"
      || audio.codec_tag_string !== "mp4a"
      || !audioProfile
      || !sampleFormat
      || !audioTimeBase
      || !audioExtradataHash
      || !Number.isSafeInteger(sampleRate)
      || sampleRate <= 0
      || !Number.isSafeInteger(channels)
      || channels <= 0
      || !channelLayout
    ) {
      return undefined;
    }
    audioIdentity = {
      codec: "aac",
      codecTag: "mp4a",
      profile: audioProfile,
      sampleFormat,
      sampleRate,
      channels,
      channelLayout,
      timeBase: audioTimeBase,
      extradataHash: audioExtradataHash
    };
  }

  return stableJson({
    schema: "kirinuki/packet-copy-signature-v1",
    video: {
      codec: "h264",
      codecTag: "avc1",
      profile,
      level,
      pixelFormat: "yuv420p",
      width,
      height,
      codedWidth,
      codedHeight,
      fieldOrder,
      sampleAspectRatio,
      frameRate,
      timeBase,
      nalLengthSize: 4,
      extradataHash,
      colorRange,
      colorSpace,
      colorTransfer,
      colorPrimaries,
      chromaLocation
    },
    audio: audioIdentity
  });
}

export function parseExternalMediaInspection(rawJson: string): ExternalMediaInspection {
  const payload = parseJsonRecord(rawJson);
  const format = isRecord(payload.format) ? payload.format : null;
  const rawStreams = Array.isArray(payload.streams) ? payload.streams : [];
  const streams: UnknownRecord[] = [];
  for (const stream of rawStreams) {
    if (
      !isRecord(stream)
      || (stream.codec_type !== "video" && stream.codec_type !== "audio")
    ) {
      fail(
        "로컬 편집 영상에는 완전히 인식된 비디오·오디오 스트림만 있어야 합니다.",
        "MEDIA_VERIFICATION_FAILED"
      );
    }
    streams.push(stream);
  }
  const formatNames = typeof format?.format_name === "string"
    ? format.format_name.split(",").map((name) => name.trim().toLowerCase())
    : [];
  if (!formatNames.includes("mp4")) {
    fail("로컬 편집 영상은 검증된 MP4 컨테이너여야 합니다.", "MEDIA_VERIFICATION_FAILED");
  }
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  if (videoStreams.length !== 1) {
    fail("로컬 편집 영상은 비디오 스트림이 정확히 하나여야 합니다.", "MEDIA_VERIFICATION_FAILED");
  }
  if (audioStreams.length > 1) {
    fail("로컬 편집 영상은 오디오 스트림이 최대 하나여야 합니다.", "MEDIA_VERIFICATION_FAILED");
  }
  const video = videoStreams[0];
  const audio = audioStreams[0];
  if (!video || video.codec_name !== "h264") {
    fail("로컬 편집 영상은 H.264 비디오여야 합니다.", "MEDIA_VERIFICATION_FAILED");
  }
  if (audio && audio.codec_name !== "aac") {
    fail("로컬 편집 영상의 오디오는 AAC여야 합니다.", "MEDIA_VERIFICATION_FAILED");
  }
  const durationMs = durationMilliseconds(
    format?.duration ?? video.duration,
    "로컬 MP4"
  );
  const streamTimelines = externalStreamTimelines(
    video,
    audio,
    format ?? {},
    durationMs
  );
  const width = Number(video.width);
  const height = Number(video.height);
  const averageFrameRate = externalFrameRate(video.avg_frame_rate);
  const frameRate = Number.isFinite(averageFrameRate) && averageFrameRate > 0
    ? averageFrameRate
    : externalFrameRate(video.r_frame_rate);
  if (
    !Number.isSafeInteger(width)
    || width <= 0
    || width > MAX_EXTERNAL_VOD_WIDTH
    || !Number.isSafeInteger(height)
    || height <= 0
    || height > MAX_EXTERNAL_VOD_HEIGHT
    || !Number.isFinite(frameRate)
    || frameRate <= 0
    || frameRate > MAX_EXTERNAL_VOD_FRAME_RATE + 0.001
  ) {
    fail(
      "로컬 편집 영상은 최대 1920x1080, 60fps여야 합니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  const audioSampleRate = audio ? Number(audio.sample_rate) : undefined;
  const audioChannels = audio ? Number(audio.channels) : undefined;
  if (
    audio
    && (
      !Number.isSafeInteger(audioSampleRate)
      || Number(audioSampleRate) <= 0
      || !Number.isSafeInteger(audioChannels)
      || Number(audioChannels) <= 0
    )
  ) {
    fail("로컬 편집 영상의 AAC 스트림 구성을 확인하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  const audioChannelLayout = audio
    && typeof audio.channel_layout === "string"
    && audio.channel_layout.trim()
    ? audio.channel_layout.trim()
    : undefined;
  const packetCopySignature = externalPacketCopySignature(video, audio);
  return {
    durationMs,
    ...(streamTimelines ? { streamTimelines } : {}),
    videoCodec: "h264",
    audioCodec: audio ? "aac" : null,
    width,
    height,
    frameRate,
    ...(packetCopySignature ? { packetCopySignature } : {}),
    ...(audio
      ? {
        audioSampleRate: Number(audioSampleRate),
        audioChannels: Number(audioChannels),
        ...(audioChannelLayout ? { audioChannelLayout } : {})
      }
      : {})
  };
}

export async function inspectExternalMp4(
  filePath: string,
  options: ExternalProcessRunOptions,
  {
    runProcess = runExternalProcess,
    ffprobeBinary = "ffprobe"
  }: {
    runProcess?: ExternalProcessRunner;
    ffprobeBinary?: string;
  } = {}
): Promise<ExternalMediaInspection> {
  const result = await checkedProcess(
    runProcess,
    executableName(ffprobeBinary, "ffprobe"),
    buildExternalFfprobeArgs(filePath, {
      ...(options.inheritedInputFileDescriptor === undefined
        ? {}
        : { inheritedInputFileDescriptor: options.inheritedInputFileDescriptor })
    }),
    {
      ...options,
      timeoutMs: EXTERNAL_FFPROBE_TIMEOUT_MS
    },
    "MEDIA_VERIFICATION_FAILED",
    "로컬 MP4를 ffprobe로 검사하지 못했습니다."
  );
  return parseExternalMediaInspection(result.stdout);
}

export async function probeExternalVodMetadata(
  sourceValue: ExternalVodSource | string,
  {
    runProcess = runExternalProcess,
    processEnv = process.env,
    ytDlpBinary = processEnv.KIRINUKI_YT_DLP_BINARY,
    ytDlpMode = externalYtDlpMode(processEnv.KIRINUKI_YT_DLP_MODE),
    pythonBinary = processEnv.KIRINUKI_YT_DLP_PYTHON_BINARY,
    nodeBinary = process.execPath,
    cwd = process.cwd(),
    signal
  }: {
    runProcess?: ExternalProcessRunner;
    ytDlpBinary?: string;
    ytDlpMode?: ExternalYtDlpMode;
    pythonBinary?: string;
    nodeBinary?: string;
    processEnv?: NodeJS.ProcessEnv;
    cwd?: string;
    signal?: AbortSignal;
  } = {}
): Promise<ExternalVodMetadata> {
  const source = typeof sourceValue === "string"
    ? normalizeExternalVodUrl(sourceValue)
    : normalizeExternalVodUrl(sourceValue.canonicalUrl, sourceValue.platform);
  const command = externalYtDlpCommand({
    mode: ytDlpMode,
    ytDlpBinary,
    ...(pythonBinary === undefined ? {} : { pythonBinary }),
    args: buildExternalMetadataProbeArgs(source, { nodeBinary })
  });
  const result = await checkedProcess(
    runProcess,
    command.executable,
    command.args,
    processOptions(cwd, processEnv, signal, EXTERNAL_METADATA_TIMEOUT_MS),
    "METADATA_PROBE_FAILED",
    `${source.platform} 공개 VOD 정보를 yt-dlp로 확인하지 못했습니다.`
  );
  return parseExternalVodMetadata(source, result.stdout);
}

function externalVodClockMetadataParts(
  metadata: ExternalVodMetadata,
  parts: readonly ExternalVodMetadataPart[] = metadata.parts
): ExternalVodClockMetadataPart[] {
  return parts.map((part) => {
    const partIndex = metadata.parts.findIndex((candidate) => (
      candidate.id === part.id
      && candidate.sourceStartMs === part.sourceStartMs
      && candidate.sourceEndMs === part.sourceEndMs
    ));
    if (partIndex < 0) {
      fail("시간축을 확인할 VOD 파트가 원본 메타데이터에 없습니다.", "INVALID_METADATA");
    }
    return {
      partIndex,
      ...(part.playlistItem === undefined ? {} : { playlistItem: part.playlistItem }),
      partId: part.id,
      sourceStartMs: part.sourceStartMs,
      sourceEndMs: part.sourceEndMs,
      durationMs: part.durationMs
    };
  });
}

function directClockProbeHeaderBlock(
  headers: Readonly<Record<string, string>>
): string {
  const entries = Object.entries(headers).sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  if (entries.some(([name, value]) => (
    !/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(name)
    || typeof value !== "string"
    || !value
    || /[\0\r\n]/u.test(value)
  ))) {
    fail("직접 미디어 공개 요청 헤더가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  return entries.map(([name, value]) => `${name}: ${value}`).join("\r\n")
    + (entries.length > 0 ? "\r\n" : "");
}

export function buildExternalDirectClockProbeArgs(
  input: ExternalVodSelectedDirectInput,
  tlsCaFile: string
): string[] {
  const url = assertExternalVodTransferUrl("YOUTUBE", input.url);
  const headerBlock = directClockProbeHeaderBlock(input.publicHeaders);
  if (
    !path.isAbsolute(tlsCaFile)
    || tlsCaFile.trim() !== tlsCaFile
    || /[\0\r\n]/u.test(tlsCaFile)
  ) {
    fail("ffprobe TLS 신뢰 루트 경로가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  return [
    "-v", "error",
    "-protocol_whitelist", "https,tls,tcp",
    "-tls_verify", "1",
    "-ca_file", tlsCaFile,
    "-max_redirects", "0",
    "-rw_timeout", "30000000",
    ...(headerBlock ? ["-headers", headerBlock] : []),
    "-show_entries",
    "format=start_time,duration:stream=codec_type,codec_name,start_time,duration",
    "-of", "json",
    url.href
  ];
}

async function resolveExternalVodClockProofs(
  metadata: ExternalVodMetadata,
  parts: readonly ExternalVodMetadataPart[],
  context: {
    cwd: string;
    runProcess: ExternalProcessRunner;
    processEnv: NodeJS.ProcessEnv;
    ytDlpBinary: string;
    ytDlpMode: ExternalYtDlpMode;
    pythonBinary?: string;
    nodeBinary: string;
    ffprobeBinary: string;
    tlsCaFile: string;
    fetchImpl?: typeof globalThis.fetch;
    signal?: AbortSignal;
  }
): Promise<ExternalVodClockProofSetResolution> {
  const resolveSelectedPart = async (
    part: ExternalVodClockMetadataPart
  ) => {
    const command = externalYtDlpCommand({
      mode: context.ytDlpMode,
      ytDlpBinary: context.ytDlpBinary,
      ...(context.pythonBinary === undefined
        ? {}
        : { pythonBinary: context.pythonBinary }),
      args: buildExternalSelectedSourceProbeArgs({
        source: metadata,
        ...(part.playlistItem === undefined
          ? {}
          : { playlistItem: part.playlistItem }),
        nodeBinary: context.nodeBinary
      })
    });
    const selected = await checkedProcess(
      context.runProcess,
      command.executable,
      command.args,
      processOptions(
        context.cwd,
        context.processEnv,
        context.signal,
        EXTERNAL_METADATA_TIMEOUT_MS
      ),
      "SELECTED_SOURCE_RESOLUTION_FAILED",
      `${metadata.platform} VOD의 실제 선택 포맷을 확인하지 못했습니다.`
    );
    return await resolveExternalVodSelectedSourceDump({
      platform: metadata.platform,
      contentId: metadata.contentId,
      partId: part.partId,
      rawSelectedSourceJson: selected.stdout,
      ...(context.signal ? { signal: context.signal } : {})
    }, {
      ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
      probeDirectInput: async (input) => {
        const probed = await checkedProcess(
          context.runProcess,
          context.ffprobeBinary,
          buildExternalDirectClockProbeArgs(input, context.tlsCaFile),
          processOptions(
            context.cwd,
            context.processEnv,
            context.signal,
            EXTERNAL_FFPROBE_TIMEOUT_MS
          ),
          "DIRECT_CLOCK_PROBE_FAILED",
          "YouTube 직접 입력의 0초 원점과 길이를 확인하지 못했습니다."
        );
        return probed.stdout;
      }
    });
  };
  return await resolveExternalVodClockProofSet({
    platform: metadata.platform,
    contentId: metadata.contentId,
    sourceVersionId: metadata.sourceVersionId,
    sourceDurationMs: metadata.durationMs,
    metadataPartCount: metadata.parts.length,
    parts: externalVodClockMetadataParts(metadata, parts),
    ...(context.signal ? { signal: context.signal } : {})
  }, { resolveSelectedPart });
}

function resolveWholeSourceClock({
  metadata,
  acquisitionClockProofSet,
  soopSourceClockIdentity
}: {
  metadata: ExternalVodMetadata;
  acquisitionClockProofSet?: ExternalVodPersistedClockProofSet;
  soopSourceClockIdentity?: SoopVodSourceClockIdentity;
}): ExternalVodSourceClockResolution {
  return createExternalVodSourceClockProof({
    platform: metadata.platform,
    contentId: metadata.contentId,
    metadataIdentityId: metadata.sourceVersionId,
    metadataParts: externalVodClockMetadataParts(metadata),
    ...(acquisitionClockProofSet ? { acquisitionClockProofSet } : {}),
    ...(soopSourceClockIdentity ? { soopSourceClockIdentity } : {})
  });
}

function metadataWithVerifiedSourceClock(
  metadata: ExternalVodMetadata,
  sourceClock: ExternalVodSourceClockResolution
): ExternalVodMetadata {
  if (sourceClock.authoritativeParts.length !== metadata.parts.length) {
    fail("증명한 원본 시간축 파트 수가 메타데이터와 다릅니다.", "SOURCE_CHANGED");
  }
  const parts = sourceClock.authoritativeParts.map((part, index) => {
    const original = metadata.parts[index];
    if (
      !original
      || part.partIndex !== index
      || part.partId !== original.id
      || part.playlistItem !== original.playlistItem
    ) {
      fail("증명한 원본 시간축 파트 identity가 메타데이터와 다릅니다.", "SOURCE_CHANGED");
    }
    return {
      id: original.id,
      ...(original.playlistItem === undefined
        ? {}
        : { playlistItem: original.playlistItem }),
      sourceStartMs: part.sourceStartMs,
      sourceEndMs: part.sourceEndMs,
      durationMs: part.durationMs
    };
  });
  return {
    ...metadata,
    durationMs: sourceClock.sourceDurationMs,
    sourceVersionId: sourceClock.sourceVersionId,
    parts
  };
}

function assertExternalVodClockResolutionMatchesRequest(
  metadata: ExternalVodMetadata,
  requestedParts: readonly ExternalVodMetadataPart[],
  resolution: ExternalVodClockProofSetResolution
): ExternalVodClockProofSetResolution {
  const proofSet = parseExternalVodPersistedClockProofSet(resolution.persisted);
  const expectedParts = externalVodClockMetadataParts(metadata, requestedParts)
    .sort((left, right) => left.partIndex - right.partIndex);
  const runtimeParts = Array.isArray(resolution.runtime?.parts)
    ? resolution.runtime.parts
    : [];
  const authoritativeParts = Array.isArray(resolution.authoritative?.parts)
    ? resolution.authoritative.parts
    : [];
  if (
    proofSet.platform !== metadata.platform
    || proofSet.contentIdentitySha256 !== sha256Text(metadata.contentId)
    || proofSet.sourceVersionId !== metadata.sourceVersionId
    || proofSet.metadataPartCount !== metadata.parts.length
    || proofSet.parts.length !== expectedParts.length
    || runtimeParts.length !== proofSet.parts.length
    || authoritativeParts.length !== proofSet.parts.length
    || resolution.authoritative.sourceDurationMs !== proofSet.sourceDurationMs
  ) {
    fail("선택 미디어 시간축 증명이 현재 원본 요청과 다릅니다.", "CLOCK_PROOF_MISMATCH");
  }
  const runtimeIndexes = new Set<number>();
  for (const [index, partProof] of proofSet.parts.entries()) {
    const expected = expectedParts[index];
    const runtime = runtimeParts.find((part) => part.partIndex === partProof.partIndex);
    const authoritative = authoritativeParts[index];
    if (
      !expected
      || !runtime
      || !authoritative
      || runtimeIndexes.has(runtime.partIndex)
      || partProof.partIndex !== expected.partIndex
      || partProof.playlistItem !== (expected.playlistItem ?? null)
      || partProof.partIdentitySha256 !== sha256Text(expected.partId)
      || partProof.metadataDurationMs !== expected.durationMs
      || (metadata.platform === "SOOP" && (
        partProof.sourceStartMs !== expected.sourceStartMs
        || partProof.sourceEndMs !== expected.sourceEndMs
      ))
      || authoritative.partIndex !== partProof.partIndex
      || authoritative.playlistItem !== expected.playlistItem
      || authoritative.partId !== expected.partId
      || authoritative.sourceStartMs !== partProof.sourceStartMs
      || authoritative.sourceEndMs !== partProof.sourceEndMs
      || authoritative.durationMs
        !== partProof.sourceEndMs - partProof.sourceStartMs
      || (partProof.transport === "HLS"
        ? runtime.kind !== "hls"
          || runtime.timeline.durationUs !== partProof.resolvedDurationUs
          || runtime.timeline.playlistFingerprintSha256
            !== partProof.playlistFingerprintSha256
          || runtime.timeline.renditionFingerprintSha256
            !== partProof.renditionFingerprintSha256
        : runtime.kind !== "direct"
          || runtime.clockProof.proofId !== partProof.clockProofId
          || runtime.clockProof.playerDurationUs !== partProof.resolvedDurationUs)
    ) {
      fail("선택 미디어 파트·실행 시간축이 현재 원본 요청과 다릅니다.", "CLOCK_PROOF_MISMATCH");
    }
    runtimeIndexes.add(runtime.partIndex);
  }
  return {
    persisted: proofSet,
    authoritative: {
      sourceDurationMs: resolution.authoritative.sourceDurationMs,
      parts: authoritativeParts.map((part) => ({ ...part }))
    },
    runtime: { parts: [...runtimeParts] }
  };
}

export function resolveExternalVodStateDirectory(
  override?: string,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir()
): string {
  const requested = override?.trim();
  if (requested) {
    if (/[\0\r\n]/u.test(requested)) {
      fail("외부 VOD 저장 경로가 올바르지 않습니다.", "INVALID_STATE_DIRECTORY");
    }
    return path.resolve(requested);
  }
  const configured = environment.KIRINUKI_VOD_STATE_DIR?.trim()
    || environment.KIRINUKI_CHZZK_VOD_STATE_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured) || /[\0\r\n]/u.test(configured)) {
      fail("VOD 상태 폴더 환경 변수에는 절대 경로가 필요합니다.", "INVALID_STATE_DIRECTORY");
    }
    return path.resolve(configured);
  }
  const xdgStateHome = environment.XDG_STATE_HOME?.trim();
  if (xdgStateHome) {
    if (!path.isAbsolute(xdgStateHome) || /[\0\r\n]/u.test(xdgStateHome)) {
      fail("XDG_STATE_HOME에는 절대 경로가 필요합니다.", "INVALID_STATE_DIRECTORY");
    }
    return path.resolve(
      xdgStateHome,
      DEFAULT_EXTERNAL_VOD_STATE_DIRECTORY_NAME
    );
  }
  return path.resolve(
    homeDirectory,
    ".local",
    "state",
    DEFAULT_EXTERNAL_VOD_STATE_DIRECTORY_NAME
  );
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${randomBytes(8).toString("hex")}`;
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_EXTERNAL_VOD_RECEIPT_BYTES) {
    fail(
      "외부 VOD 증명 문서가 안전한 저장 크기 상한을 넘었습니다.",
      "RECEIPT_TOO_LARGE"
    );
  }
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

interface ExternalFileSnapshot {
  status: BigIntStats;
  hashSha256: string;
  sizeBytes: number;
}

interface PublishedExternalVodArtifact {
  artifactPath: string;
  cacheFileName: string;
  hashSha256: string;
  sizeBytes: number;
  status: BigIntStats;
  created: boolean;
}

function sameExternalFileIdentity(
  left: BigIntStats,
  right: BigIntStats
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Node 22/libuv before libuv #4698 exposes a Windows path-stat volume serial
 * as 64 bits while fstat exposes its unsigned low 32 bits. Normalize only that
 * representation mismatch; inode, size, and link count still bind the named
 * path directly to the already-open file descriptor.
 */
export function normalizedExternalFileDeviceId(
  value: bigint,
  platform: NodeJS.Platform | string = process.platform
): bigint {
  return platform === "win32" ? BigInt.asUintN(32, value) : value;
}

export function sameExternalFileCrossApiObjectIdentity(
  left: Pick<BigIntStats, "dev" | "ino" | "size" | "nlink">,
  right: Pick<BigIntStats, "dev" | "ino" | "size" | "nlink">,
  platform: NodeJS.Platform | string = process.platform
): boolean {
  return normalizedExternalFileDeviceId(left.dev, platform)
      === normalizedExternalFileDeviceId(right.dev, platform)
    && left.ino === right.ino
    && left.size === right.size
    && left.nlink === right.nlink;
}

function sameExternalFileSnapshot(
  left: BigIntStats,
  right: BigIntStats
): boolean {
  return sameExternalFileIdentity(left, right)
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameExternalFileContentSnapshot(
  left: BigIntStats,
  right: BigIntStats
): boolean {
  return sameExternalFileIdentity(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.nlink > 0n
    && right.nlink > 0n;
}

export function externalVodSourceRootCacheFileName(
  hashSha256: string,
  platform: NodeJS.Platform | string = process.platform
): string {
  if (!/^[a-f0-9]{64}$/u.test(hashSha256)) {
    throw new TypeError("외부 VOD source root 해시가 올바르지 않습니다.");
  }
  return platform === "win32"
    ? `r-${vodConsumerScopePathSegment(hashSha256, platform)}.mp4`
    : `root-${hashSha256}.mp4`;
}

export function externalVodArtifactCacheFileName(
  hashSha256: string,
  nonceHex: string,
  platform: NodeJS.Platform | string = process.platform
): string {
  if (
    !/^[a-f0-9]{64}$/u.test(hashSha256)
    || (platform === "win32"
      ? !/^[a-f0-9]{32}$/u.test(nonceHex)
      : !/^[a-f0-9]{16}$/u.test(nonceHex))
  ) {
    throw new TypeError("외부 VOD artifact 캐시 이름 입력이 올바르지 않습니다.");
  }
  return platform === "win32"
    ? `m-${vodMaterializationPathSegment(nonceHex, platform)}.mp4`
    : `materialized-${hashSha256}-${nonceHex}.mp4`;
}

function validExternalVodArtifactCacheFileName(
  cacheFileName: string,
  hashSha256: string
): boolean {
  if (!/^[a-f0-9]{64}$/u.test(hashSha256)) {
    return false;
  }
  if (process.platform === "win32") {
    return /^m-[0-9a-v]{26}\.mp4$/u.test(cacheFileName);
  }
  const prefix = `materialized-${hashSha256}-`;
  return cacheFileName.startsWith(prefix)
    && /^[a-f0-9]{16}\.mp4$/u.test(cacheFileName.slice(prefix.length));
}

function validatedOpenRegularFileStatus(
  status: BigIntStats,
  {
    maximumBytes,
    requireSingleLink = false,
    unlinkedSingleLinkIsTransient = false
  }: {
    maximumBytes: number;
    requireSingleLink?: boolean;
    unlinkedSingleLinkIsTransient?: boolean;
  }
): number {
  if (
    requireSingleLink
    && unlinkedSingleLinkIsTransient
    && status.isFile()
    && status.nlink === 0n
  ) {
    fail(
      "원자 게시 목적지가 동시 게시자에 의해 교체되어 다시 검증합니다.",
      "CACHE_INTEGRITY_FAILED"
    );
  }
  if (
    !status.isFile()
    || status.size <= 0n
    || status.size > BigInt(maximumBytes)
    || status.nlink <= 0n
    || (requireSingleLink && status.nlink !== 1n)
  ) {
    fail(
      requireSingleLink
        ? "게시 전 로컬 MP4는 링크되지 않은 단일 일반 파일이어야 합니다."
        : "외부 VOD 캐시는 안전한 일반 파일이어야 합니다.",
      "UNSAFE_OUTPUT_PATH"
    );
  }
  return Number(status.size);
}

function externalReadOnlyOpenFlags(): number {
  // Windows/libuv does not implement O_NOFOLLOW as an open flag. On that
  // platform adjacent lstat snapshots plus direct dev/ino/size/nlink binding
  // reject reparse/path swaps. POSIX retains kernel-level O_NOFOLLOW too.
  return process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
}

async function hashExternalFileHandle(
  handle: FileHandle,
  sizeBytes: number,
  signal?: AbortSignal
): Promise<string> {
  const digest = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < sizeBytes) {
    abortIfRequested(signal);
    const length = Math.min(chunk.byteLength, sizeBytes - position);
    const { bytesRead } = await handle.read(chunk, 0, length, position);
    if (bytesRead <= 0) {
      fail(
        "외부 VOD 파일을 같은 파일 디스크립터에서 끝까지 읽지 못했습니다.",
        "CACHE_INTEGRITY_FAILED"
      );
    }
    digest.update(chunk.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex");
}

async function openExternalRegularFileNoFollow(filePath: string): Promise<FileHandle> {
  try {
    return await open(filePath, externalReadOnlyOpenFlags());
  } catch {
    fail(
      "외부 VOD 파일을 심볼릭 링크 없이 안전하게 열지 못했습니다.",
      "UNSAFE_OUTPUT_PATH"
    );
  }
}

async function assertNamedPathMatchesOpenFile(
  filePath: string,
  status: BigIntStats
): Promise<void> {
  let pathBefore: BigIntStats;
  try {
    pathBefore = await lstat(filePath, { bigint: true });
  } catch {
    fail("외부 VOD 파일 경로가 검증 중 바뀌었습니다.", "CACHE_INTEGRITY_FAILED");
  }
  if (
    pathBefore.isSymbolicLink()
    || !pathBefore.isFile()
    || !sameExternalFileCrossApiObjectIdentity(pathBefore, status)
  ) {
    fail("외부 VOD 파일 경로가 검증 중 바뀌었습니다.", "CACHE_INTEGRITY_FAILED");
  }
  try {
    const pathAfter = await lstat(filePath, { bigint: true });
    if (
      pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || !sameExternalFileSnapshot(pathBefore, pathAfter)
      || !sameExternalFileCrossApiObjectIdentity(pathAfter, status)
    ) {
      fail("외부 VOD 파일 경로가 검증 중 바뀌었습니다.", "CACHE_INTEGRITY_FAILED");
    }
  } catch (error) {
    if (error instanceof ExternalVodMaterializationError) {
      throw error;
    }
    fail("외부 VOD 파일 경로가 검증 중 바뀌었습니다.", "CACHE_INTEGRITY_FAILED");
  }
}

async function inspectOpenedExternalRegularFile(
  handle: FileHandle,
  filePath: string,
  {
    maximumBytes,
    requireSingleLink = false,
    unlinkedSingleLinkIsTransient = false,
    supplementalHashFile,
    signal
  }: {
    maximumBytes: number;
    requireSingleLink?: boolean;
    unlinkedSingleLinkIsTransient?: boolean;
    supplementalHashFile?: NonNullable<
      ExternalVodMaterializerDependencies["hashFile"]
    >;
    signal?: AbortSignal;
  }
): Promise<ExternalFileSnapshot> {
  abortIfRequested(signal);
  const before = await handle.stat({ bigint: true });
  const sizeBytes = validatedOpenRegularFileStatus(before, {
    maximumBytes,
    requireSingleLink,
    unlinkedSingleLinkIsTransient
  });
  const hashSha256 = await hashExternalFileHandle(handle, sizeBytes, signal);
  if (supplementalHashFile) {
    const supplementalHash = await supplementalHashFile(filePath, signal);
    if (supplementalHash !== hashSha256) {
      fail("외부 VOD 파일의 독립 해시 검증이 일치하지 않습니다.", "CACHE_INTEGRITY_FAILED");
    }
  }
  const after = await handle.stat({ bigint: true });
  // Cache roots are immutable but may be hard-linked into another private
  // attempt while hashing. That changes only ctime/nlink. Keep the exact
  // inode, mode, size and mtime binding here; the fd-bound SHA-256 above is
  // the content authority, and the named path is checked against `after`.
  if (!sameExternalFileContentSnapshot(before, after)) {
    fail("외부 VOD 파일이 검증 중 변경되었습니다.", "CACHE_INTEGRITY_FAILED");
  }
  await assertNamedPathMatchesOpenFile(filePath, after);
  return { status: after, hashSha256, sizeBytes };
}

async function inspectExternalRegularFileNoFollow(
  filePath: string,
  options: {
    maximumBytes: number;
    requireSingleLink?: boolean;
    unlinkedSingleLinkIsTransient?: boolean;
    supplementalHashFile?: NonNullable<
      ExternalVodMaterializerDependencies["hashFile"]
    >;
    signal?: AbortSignal;
  }
): Promise<ExternalFileSnapshot> {
  const handle = await openExternalRegularFileNoFollow(filePath);
  try {
    return await inspectOpenedExternalRegularFile(handle, filePath, options);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function sha256ExternalFile(
  filePath: string,
  signal?: AbortSignal
): Promise<string> {
  return (await inspectExternalRegularFileNoFollow(filePath, {
    maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
    ...(signal ? { signal } : {})
  })).hashSha256;
}

async function readExternalTextFileNoFollow(
  filePath: string,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<string> {
  const handle = await openExternalRegularFileNoFollow(filePath);
  try {
    abortIfRequested(signal);
    const before = await handle.stat({ bigint: true });
    const sizeBytes = validatedOpenRegularFileStatus(before, { maximumBytes });
    const content = Buffer.allocUnsafe(sizeBytes);
    let position = 0;
    while (position < sizeBytes) {
      abortIfRequested(signal);
      const { bytesRead } = await handle.read(
        content,
        position,
        sizeBytes - position,
        position
      );
      if (bytesRead <= 0) {
        fail("외부 VOD 캐시 문서를 끝까지 읽지 못했습니다.", "CACHE_INTEGRITY_FAILED");
      }
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameExternalFileSnapshot(before, after)) {
      fail("외부 VOD 캐시 문서가 검증 중 변경되었습니다.", "CACHE_INTEGRITY_FAILED");
    }
    await assertNamedPathMatchesOpenFile(filePath, after);
    return content.toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function assertSafeRegularFile(
  filePath: string,
  outputDirectory: string
): Promise<number> {
  const status = await lstat(filePath);
  if (!status.isFile() || status.isSymbolicLink() || status.size <= 0) {
    fail("외부 도구가 올바른 일반 파일을 만들지 않았습니다.", "UNSAFE_OUTPUT_PATH");
  }
  const directoryRealPath = await realpath(outputDirectory);
  const fileRealPath = await realpath(filePath);
  const relative = path.relative(directoryRealPath, fileRealPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("외부 도구 결과가 로컬 작업 폴더를 벗어났습니다.", "UNSAFE_OUTPUT_PATH");
  }
  return status.size;
}

function concatDescription(sectionFiles: readonly string[]): string {
  if (sectionFiles.length === 0) {
    fail("병합할 외부 VOD 구간 파일이 없습니다.", "MEDIA_MUX_FAILED");
  }
  return `${sectionFiles.map((filePath) => {
    const basename = path.basename(filePath);
    if (!SAFE_OUTPUT_BASENAME_PATTERN.test(basename)) {
      fail("병합 목록의 로컬 파일 이름이 안전하지 않습니다.", "UNSAFE_OUTPUT_PATH");
    }
    return `file '${basename}'`;
  }).join("\n")}\n`;
}

function emitProgress(
  listener: ExternalVodMaterializationRequest["onProgress"],
  progress: ExternalVodMaterializationProgress
): void {
  listener?.(progress);
}

function assertSecretFreePersistentDocument(
  document: unknown,
  canonicalUrl?: string
): void {
  const forbiddenKey = /^(?:authorization|cookies?|headers?|netrc|password|raw(?:Url|Uri)?|requestHeaders|signature|signedUrl|token|url|uri)$/iu;
  const credentialText = /(?:^|[?&/;])(?:auth|authorization|expires?|hdntl|hdnts|hmac|key|lsig|policy|sig|signature|token)=/iu;
  const visit = (value: unknown, location: string): void => {
    if (typeof value === "string") {
      const isCanonicalUrl = canonicalUrl !== undefined
        && location === "$.canonicalUrl"
        && value === canonicalUrl;
      if (
        (!isCanonicalUrl && /^https?:\/\//iu.test(value))
        || credentialText.test(value)
        || /[\0\r\n]/u.test(value)
      ) {
        fail(
          "외부 VOD 캐시에 원격 주소 또는 인증·서명 정보가 포함되었습니다.",
          "SECRET_REDACTION_FAILED"
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKey.test(key)) {
        fail(
          "외부 VOD 캐시에 원격 주소 또는 인증·서명 필드가 포함되었습니다.",
          "SECRET_REDACTION_FAILED"
        );
      }
      visit(item, `${location}.${key}`);
    }
  };
  visit(document, "$");
}

function secretFreeReceipt(receipt: ExternalVodCacheReceipt): void {
  assertSecretFreePersistentDocument(receipt, receipt.canonicalUrl);
}

function sameClipRequest(
  actual: readonly ExternalVodClipRange[],
  expected: readonly ExternalVodClipRange[]
): boolean {
  const ordered = (clips: readonly ExternalVodClipRange[]) => (
    [...clips].sort((left, right) => left.id.localeCompare(right.id))
  );
  return stableJson(ordered(actual)) === stableJson(ordered(expected));
}

function clipRequestIsSubset(
  actual: readonly ExternalVodClipRange[],
  expected: readonly ExternalVodClipRange[]
): boolean {
  if (actual.length > expected.length) {
    return false;
  }
  const expectedById = new Map(expected.map((clip) => [clip.id, clip]));
  return actual.every((clip) => {
    const candidate = expectedById.get(clip.id);
    return Boolean(
      candidate
      && candidate.startMs === clip.startMs
      && candidate.endMs === clip.endMs
    );
  });
}

function normalizedExternalResumeReference(
  value: unknown,
  source: ExternalVodSource
): ExternalVodMaterializationResumeReference | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const materializationId = value.materializationId;
  const planFingerprint = value.planFingerprint;
  const contentId = value.contentId;
  if (
    Object.keys(value).sort().join(",") !== (
      "contentId,materializationId,planFingerprint"
    )
    || typeof materializationId !== "string"
    || !/^[a-f0-9]{32}$/u.test(materializationId)
    || typeof planFingerprint !== "string"
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || typeof contentId !== "string"
    || contentId !== source.contentId
  ) {
    return undefined;
  }
  return { materializationId, planFingerprint, contentId };
}

function normalizedReceiptSections(
  value: unknown,
  manifest: ChzzkVodMaterialization,
  acquisitionClockProofSet: ExternalVodPersistedClockProofSet
): Array<Omit<PlannedExternalVodSection, "clipIds">> | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) {
    return undefined;
  }
  const cursors = manifest.windows.map((window) => window.editableSourceStartMs);
  const sectionCounts = manifest.windows.map(() => 0);
  const normalized: Array<Omit<PlannedExternalVodSection, "clipIds">> = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return undefined;
    }
    const allowedKeys = new Set([
      "id",
      "windowIndex",
      "sectionIndex",
      "partIndex",
      "playlistItem",
      "sourceStartMs",
      "sourceEndMs",
      "partStartMs",
      "partEndMs"
    ]);
    if (Object.keys(item).some((key) => !allowedKeys.has(key))) {
      return undefined;
    }
    const windowIndex = Number(item.windowIndex);
    const sectionIndex = Number(item.sectionIndex);
    const partIndex = Number(item.partIndex);
    const playlistItem = item.playlistItem === undefined
      ? undefined
      : Number(item.playlistItem);
    const sourceStartMs = Number(item.sourceStartMs);
    const sourceEndMs = Number(item.sourceEndMs);
    const partStartMs = Number(item.partStartMs);
    const partEndMs = Number(item.partEndMs);
    const window = manifest.windows[windowIndex];
    const partProof = acquisitionClockProofSet.parts.find((part) => (
      part.partIndex === partIndex
    ));
    if (
      !window
      || !partProof
      || !Number.isSafeInteger(windowIndex)
      || !Number.isSafeInteger(sectionIndex)
      || sectionIndex !== sectionCounts[windowIndex]
      || !Number.isSafeInteger(partIndex)
      || partIndex < 0
      || partIndex >= MAX_EXTERNAL_VOD_PARTS
      || (
        playlistItem !== undefined
        && (!Number.isSafeInteger(playlistItem) || playlistItem <= 0)
      )
      || (playlistItem ?? null) !== partProof.playlistItem
      || !Number.isSafeInteger(sourceStartMs)
      || !Number.isSafeInteger(sourceEndMs)
      || !Number.isSafeInteger(partStartMs)
      || !Number.isSafeInteger(partEndMs)
      || sourceStartMs !== cursors[windowIndex]
      || sourceEndMs <= sourceStartMs
      || sourceEndMs > window.editableSourceEndMs
      || partStartMs < 0
      || partEndMs <= partStartMs
      || sourceStartMs !== partProof.sourceStartMs + partStartMs
      || sourceEndMs !== partProof.sourceStartMs + partEndMs
      || partEndMs > partProof.sourceEndMs - partProof.sourceStartMs
      || partEndMs * 1_000 > partProof.resolvedDurationUs
      || partEndMs - partStartMs !== sourceEndMs - sourceStartMs
      || item.id !== `window-${windowIndex + 1}-section-${sectionIndex + 1}`
    ) {
      return undefined;
    }
    normalized.push({
      id: String(item.id),
      windowIndex,
      sectionIndex,
      partIndex,
      ...(playlistItem === undefined ? {} : { playlistItem }),
      sourceStartMs,
      sourceEndMs,
      partStartMs,
      partEndMs
    });
    cursors[windowIndex] = sourceEndMs;
    sectionCounts[windowIndex] += 1;
  }
  if (manifest.windows.some((window, index) => (
    sectionCounts[index] === 0
    || cursors[index] !== window.editableSourceEndMs
  ))) {
    return undefined;
  }
  return normalized;
}

function normalizedRootStreamSignature(
  value: unknown
): ExternalSectionStreamSignature | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const allowed = new Set([
    "width",
    "height",
    "frameRate",
    "audioCodec",
    "audioSampleRate",
    "audioChannels",
    "audioChannelLayout"
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key))
    || (value.audioCodec !== "aac" && value.audioCodec !== null)
  ) {
    return undefined;
  }
  try {
    return externalSectionStreamSignature({
      durationMs: 1,
      videoCodec: "h264",
      audioCodec: value.audioCodec === null ? null : "aac",
      width: Number(value.width),
      height: Number(value.height),
      frameRate: Number(value.frameRate),
      ...(value.audioCodec === "aac"
        ? {
          audioSampleRate: Number(value.audioSampleRate),
          audioChannels: Number(value.audioChannels),
          ...(typeof value.audioChannelLayout === "string"
            ? { audioChannelLayout: value.audioChannelLayout }
            : {})
        }
        : {})
    });
  } catch {
    return undefined;
  }
}

function compatibleExternalVodRootRevisionAnchors(
  roots: readonly ExternalVodSourceRootReceipt[]
): boolean {
  const initByPart = new Map<number, string>();
  const edgeByPartAndSequence = new Map<string, string>();
  const anchorSequencesByRoot = new Map<string, ReadonlySet<number>>();
  const hlsRoots: ExternalVodSourceRootReceipt[] = [];
  for (const root of roots) {
    const evidence = root.clockEvidence;
    if (evidence.schemaId !== EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA) {
      continue;
    }
    hlsRoots.push(root);
    const initAnchor = stableJson({
      partProofId: evidence.partProofId,
      clockProofId: evidence.clockProofId,
      init: evidence.init
    });
    const priorInit = initByPart.get(root.partIndex);
    if (priorInit !== undefined && priorInit !== initAnchor) {
      return false;
    }
    initByPart.set(root.partIndex, initAnchor);
    const edges = [
      ...(evidence.precedingSegment ? [evidence.precedingSegment] : []),
      evidence.firstSegment,
      evidence.lastSegment
    ];
    anchorSequencesByRoot.set(
      root.id,
      new Set(edges.map((edge) => edge.sequence))
    );
    for (const edge of edges) {
      const key = `${root.partIndex}:${edge.sequence}`;
      const anchor = stableJson(edge);
      const prior = edgeByPartAndSequence.get(key);
      if (prior !== undefined && prior !== anchor) {
        return false;
      }
      edgeByPartAndSequence.set(key, anchor);
    }
  }
  const rootsByPart = new Map<number, ExternalVodSourceRootReceipt[]>();
  for (const root of hlsRoots) {
    const partRoots = rootsByPart.get(root.partIndex) ?? [];
    partRoots.push(root);
    rootsByPart.set(root.partIndex, partRoots);
  }
  for (const partRoots of rootsByPart.values()) {
    partRoots.sort((left, right) => (
      left.partStartMs - right.partStartMs
      || left.partEndMs - right.partEndMs
      || left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < partRoots.length; index += 1) {
      const previous = partRoots[index - 1];
      const current = partRoots[index];
      if (!previous || !current || previous.partEndMs !== current.partStartMs) {
        continue;
      }
      const previousSequences = anchorSequencesByRoot.get(previous.id);
      const currentSequences = anchorSequencesByRoot.get(current.id);
      if (
        !previousSequences
        || !currentSequences
        || ![...previousSequences].some((sequence) => currentSequences.has(sequence))
      ) {
        return false;
      }
    }
  }
  return true;
}

function normalizedSourceRootReceipts(
  value: unknown,
  sourceDurationMs: number,
  acquisitionClockProofSet: ExternalVodPersistedClockProofSet
): ExternalVodSourceRootReceipt[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2_000) {
    return undefined;
  }
  const ids = new Set<string>();
  const normalized: ExternalVodSourceRootReceipt[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return undefined;
    }
    const allowed = new Set([
      "id",
      "partIndex",
      "playlistItem",
      "sourceStartMs",
      "sourceEndMs",
      "partStartMs",
      "partEndMs",
      "hashSha256",
      "sizeBytes",
      "durationMs",
      "cacheFileName",
      "streamSignature",
      "clockEvidence"
    ]);
    if (Object.keys(item).some((key) => !allowed.has(key))) {
      return undefined;
    }
    const id = String(item.id || "");
    const partIndex = Number(item.partIndex);
    const playlistItem = item.playlistItem === undefined
      ? undefined
      : Number(item.playlistItem);
    const sourceStartMs = Number(item.sourceStartMs);
    const sourceEndMs = Number(item.sourceEndMs);
    const partStartMs = Number(item.partStartMs);
    const partEndMs = Number(item.partEndMs);
    const hashSha256 = String(item.hashSha256 || "");
    const sizeBytes = Number(item.sizeBytes);
    const durationMs = Number(item.durationMs);
    const cacheFileName = String(item.cacheFileName || "");
    const streamSignature = normalizedRootStreamSignature(item.streamSignature);
    const partProof = acquisitionClockProofSet.parts.find((part) => (
      part.partIndex === partIndex
    ));
    let clockEvidence: ExternalVodPersistedSectionClockEvidence | undefined;
    try {
      if (!partProof || partProof.playlistItem !== (playlistItem ?? null)) {
        return undefined;
      }
      clockEvidence = partProof.transport === "HLS"
        ? assertExternalVodHlsAcquisitionMatchesPartProof(
          partProof,
          item.clockEvidence
        )
        : assertExternalVodDirectAcquisitionMatchesPartProof(
          partProof,
          item.clockEvidence
        );
    } catch {
      return undefined;
    }
    if (
      !/^[a-f0-9]{64}$/u.test(id)
      || ids.has(id)
      || !Number.isSafeInteger(partIndex)
      || partIndex < 0
      || partIndex >= MAX_EXTERNAL_VOD_PARTS
      || (
        playlistItem !== undefined
        && (!Number.isSafeInteger(playlistItem) || playlistItem <= 0)
      )
      || !Number.isSafeInteger(sourceStartMs)
      || !Number.isSafeInteger(sourceEndMs)
      || sourceStartMs < 0
      || sourceEndMs <= sourceStartMs
      || sourceEndMs > sourceDurationMs
      || !Number.isSafeInteger(partStartMs)
      || !Number.isSafeInteger(partEndMs)
      || partStartMs < 0
      || partEndMs <= partStartMs
      || sourceStartMs !== partProof.sourceStartMs + partStartMs
      || sourceEndMs !== partProof.sourceStartMs + partEndMs
      || partEndMs > partProof.sourceEndMs - partProof.sourceStartMs
      || partEndMs * 1_000 > partProof.resolvedDurationUs
      || partEndMs - partStartMs !== sourceEndMs - sourceStartMs
      || !/^[a-f0-9]{64}$/u.test(hashSha256)
      || !Number.isSafeInteger(sizeBytes)
      || sizeBytes <= 0
      || sizeBytes > MAX_EXTERNAL_VOD_WORK_BYTES
      || !Number.isSafeInteger(durationMs)
      || durationMs !== sourceEndMs - sourceStartMs
      || cacheFileName !== externalVodSourceRootCacheFileName(hashSha256)
      || !streamSignature
      || !clockEvidence
      || clockEvidence.sectionId !== [
        "part",
        partIndex,
        partStartMs,
        partEndMs
      ].join("-")
      || clockEvidence.sourceStartUs !== partStartMs * 1_000
      || clockEvidence.sourceEndUs !== partEndMs * 1_000
      || clockEvidence.output.contentSha256 !== hashSha256
      || clockEvidence.output.sizeBytes !== sizeBytes
      || Math.abs(clockEvidence.output.durationMs - durationMs)
        > MAX_SECTION_DURATION_DRIFT_MS
    ) {
      return undefined;
    }
    const expectedId = sha256Text(stableJson({
      partIndex,
      playlistItem: playlistItem ?? null,
      sourceStartMs,
      sourceEndMs,
      partStartMs,
      partEndMs,
      hashSha256,
      clockEvidenceId: clockEvidence.evidenceId
    }));
    if (id !== expectedId) {
      return undefined;
    }
    ids.add(id);
    normalized.push({
      id,
      partIndex,
      ...(playlistItem === undefined ? {} : { playlistItem }),
      sourceStartMs,
      sourceEndMs,
      partStartMs,
      partEndMs,
      hashSha256,
      sizeBytes,
      durationMs,
      cacheFileName,
      streamSignature,
      clockEvidence
    });
  }
  if (!compatibleExternalVodRootRevisionAnchors(normalized)) {
    return undefined;
  }
  return normalized.sort((left, right) => (
    left.sourceStartMs - right.sourceStartMs
    || left.sourceEndMs - right.sourceEndMs
    || left.id.localeCompare(right.id)
  ));
}

function receiptPlanFingerprint({
  canonicalUrl,
  sourceVersionId,
  manifest,
  clips,
  sections,
  acquisitionClockProofSetId,
  sourceClockIdentitySha256
}: {
  canonicalUrl: string;
  sourceVersionId: string;
  manifest: ChzzkVodMaterialization;
  clips: readonly ExternalVodClipRange[];
  sections: readonly Omit<PlannedExternalVodSection, "clipIds">[];
  acquisitionClockProofSetId: string;
  sourceClockIdentitySha256?: string;
}): string {
  const metadata: ExternalVodMetadata = {
    platform: manifest.source.platform as ExternalVodPlatform,
    canonicalUrl,
    contentId: manifest.source.contentId,
    durationMs: manifest.sourceDurationMs,
    sourceVersionId,
    // The fingerprint intentionally contains section identities, not raw
    // remote part metadata. No network metadata is needed to recompute it.
    parts: []
  };
  return externalVodPlanFingerprint({
    metadata,
    clips,
    handleMs: manifest.handleMs,
    acquisitionVersion: 3,
    acquisitionClockProofSetId,
    ...(sourceClockIdentitySha256
      ? { sourceClockIdentitySha256 }
      : {}),
    plan: {
      clipRanges: manifest.clipRanges
        ? manifest.clipRanges.map((range) => ({ ...range }))
        : createMaterializationClipCoverages(
          clips.map((clip) => ({
            clipId: clip.id,
            sourceStartMs: clip.startMs,
            sourceEndMs: clip.endMs
          })),
          manifest.sourceDurationMs,
          manifest.handleMs
        ),
      windows: manifest.windows.map((window) => ({
        editableSourceStartMs: window.editableSourceStartMs,
        editableSourceEndMs: window.editableSourceEndMs,
        clipIds: [...window.clipIds]
      })),
      sections: sections.map((section) => ({
        ...section,
        clipIds: [...(manifest.windows[section.windowIndex]?.clipIds ?? [])]
      }))
    }
  });
}

async function reusableExternalVodReceipt({
  receiptPath,
  jobDirectory,
  expectedCanonicalUrl,
  expectedContentId,
  expectedSourceVersionId,
  expectedSourceClockProofId,
  expectedAcquisitionClockProofSetId,
  expectedBrowserClockIdentitySha256,
  expectedPlanFingerprint,
  expectedHandleMs,
  expectedClips,
  allowExpectedClipSuperset = false,
  hashFile,
  signal
}: {
  receiptPath: string;
  jobDirectory: string;
  expectedCanonicalUrl: string;
  expectedContentId: string;
  expectedSourceVersionId?: string;
  expectedSourceClockProofId?: string;
  expectedAcquisitionClockProofSetId?: string;
  expectedBrowserClockIdentitySha256?: string;
  expectedPlanFingerprint: string;
  expectedHandleMs: number;
  expectedClips: readonly ExternalVodClipRange[];
  allowExpectedClipSuperset?: boolean;
  hashFile?: NonNullable<ExternalVodMaterializerDependencies["hashFile"]>;
  signal?: AbortSignal;
}): Promise<{
  receipt: ExternalVodCacheReceipt;
  artifactPath: string;
  sourceRootPaths: ReadonlyMap<string, string>;
} | undefined> {
  try {
    const parsed = JSON.parse(await readExternalTextFileNoFollow(
      receiptPath,
      MAX_EXTERNAL_VOD_RECEIPT_BYTES,
      signal
    )) as unknown;
    if (
      !isRecord(parsed)
      || parsed.schemaId !== EXTERNAL_VOD_CACHE_SCHEMA
    ) {
      return undefined;
    }
    const expectedKeys = "acquiredSections,acquisitionClockProofSet,artifact,canonicalUrl,clips,manifest,preparedAt,schemaId,sourceClockProof,sourceRoots,sourceVersionId";
    if (Object.keys(parsed).sort().join(",") !== expectedKeys) {
      return undefined;
    }
    let sourceClockProof: ExternalVodSourceClockProof;
    let acquisitionClockProofSet: ExternalVodPersistedClockProofSet;
    try {
      sourceClockProof = parseExternalVodSourceClockProof(parsed.sourceClockProof);
      acquisitionClockProofSet = (
        assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
          sourceClockProof,
          parsed.acquisitionClockProofSet
        )
      );
    } catch {
      return undefined;
    }
    const manifest = normalizeChzzkVodMaterialization(parsed.manifest);
    const artifact = isRecord(parsed.artifact) ? parsed.artifact : null;
    const normalizedClips = Array.isArray(parsed.clips)
      ? normalizeClipRanges(
        parsed.clips as unknown as ExternalVodClipRange[],
        manifest?.sourceDurationMs
      ).publicClips
      : null;
    const sections = manifest
      ? normalizedReceiptSections(
        parsed.acquiredSections,
        manifest,
        acquisitionClockProofSet
      )
      : undefined;
    const sourceRoots = manifest
      ? normalizedSourceRootReceipts(
        parsed.sourceRoots,
        manifest.sourceDurationMs,
        acquisitionClockProofSet
      )
      : undefined;
    const requiredPartIndexes = new Set((sections ?? []).map((section) => (
      section.partIndex
    )));
    const proofPartIndexes = new Set(acquisitionClockProofSet.parts.map((part) => (
      part.partIndex
    )));
    if (
      !manifest
      || manifest.source.platform !== normalizeExternalVodUrl(
        expectedCanonicalUrl
      ).platform
      || manifest.source.contentId !== expectedContentId
      || manifest.source.sourceVersionId !== parsed.sourceVersionId
      || !/^[a-f0-9]{64}$/u.test(String(parsed.sourceVersionId || ""))
      || manifest.planFingerprint !== expectedPlanFingerprint
      || manifest.materializationId !== expectedPlanFingerprint.slice(0, 32)
      || manifest.handleMs !== expectedHandleMs
      || manifest.windows.some((window) => (
        window.fetchedSourceStartMs !== window.editableSourceStartMs
        || window.fetchedSourceEndMs !== window.editableSourceEndMs
      ))
      || parsed.canonicalUrl !== expectedCanonicalUrl
      || sourceClockProof.platform !== manifest.source.platform
      || sourceClockProof.contentIdentitySha256 !== sha256Text(expectedContentId)
      || sourceClockProof.sourceDurationMs !== manifest.sourceDurationMs
      || sourceClockProof.metadataIdentityId !== acquisitionClockProofSet.sourceVersionId
      || externalVodSourceVersionId({
        metadataIdentityId: sourceClockProof.metadataIdentityId,
        sourceClockProofId: sourceClockProof.sourceClockProofId
      }) !== parsed.sourceVersionId
      || acquisitionClockProofSet.platform !== manifest.source.platform
      || acquisitionClockProofSet.contentIdentitySha256 !== sha256Text(expectedContentId)
      || acquisitionClockProofSet.sourceDurationMs !== manifest.sourceDurationMs
      || requiredPartIndexes.size !== proofPartIndexes.size
      || [...requiredPartIndexes].some((partIndex) => !proofPartIndexes.has(partIndex))
      || (
        expectedSourceVersionId !== undefined
        && parsed.sourceVersionId !== expectedSourceVersionId
      )
      || (
        expectedSourceClockProofId !== undefined
        && sourceClockProof.sourceClockProofId !== expectedSourceClockProofId
      )
      || (
        expectedAcquisitionClockProofSetId !== undefined
        && acquisitionClockProofSet.proofSetId
          !== expectedAcquisitionClockProofSetId
      )
      || (
        expectedBrowserClockIdentitySha256 !== undefined
        && sourceClockProof.browserClockIdentitySha256
          !== expectedBrowserClockIdentitySha256
      )
      || !normalizedClips
      || !(allowExpectedClipSuperset
        ? clipRequestIsSubset(normalizedClips, expectedClips)
        : sameClipRequest(normalizedClips, expectedClips))
      || !sections
      || !sourceRoots
      || receiptPlanFingerprint({
        canonicalUrl: expectedCanonicalUrl,
        sourceVersionId: String(parsed.sourceVersionId),
        manifest,
        clips: normalizedClips,
        sections,
        acquisitionClockProofSetId: acquisitionClockProofSet.proofSetId,
        ...(sourceClockProof.browserClockIdentitySha256
          ? {
            sourceClockIdentitySha256:
              sourceClockProof.browserClockIdentitySha256
          }
          : {})
      }) !== expectedPlanFingerprint
      || typeof parsed.preparedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.preparedAt))
      || parsed.preparedAt !== manifest.preparedAt
      || !artifact
      || Object.keys(artifact).sort().join(",") !== [
        "cacheFileName",
        "durationMs",
        "hashSha256",
        "name",
        "sizeBytes",
        "type"
      ].sort().join(",")
      || artifact.type !== "video/mp4"
      || typeof artifact.name !== "string"
      || !artifact.name
      || artifact.name.length > 240
      || /[\\/\u0000-\u001f\u007f]/u.test(artifact.name)
      || !/^[a-f0-9]{64}$/u.test(String(artifact.hashSha256 || ""))
      || !Number.isSafeInteger(artifact.sizeBytes)
      || Number(artifact.sizeBytes) <= 0
      || Number(artifact.sizeBytes) > MAX_EXTERNAL_VOD_WORK_BYTES
      || !Number.isSafeInteger(artifact.durationMs)
      || Math.abs(Number(artifact.durationMs) - manifest.mediaDurationMs)
        > MAX_SECTION_DURATION_DRIFT_MS
    ) {
      return undefined;
    }
    if (sourceRoots) {
      orderedRootsForPlan({
        clipRanges: manifest.clipRanges?.map((range) => ({ ...range })) ?? [],
        windows: manifest.windows.map((window) => ({
          editableSourceStartMs: window.editableSourceStartMs,
          editableSourceEndMs: window.editableSourceEndMs,
          clipIds: [...window.clipIds]
        })),
        sections: sections.map((section) => ({
          ...section,
          clipIds: [...(manifest.windows[section.windowIndex]?.clipIds ?? [])]
        }))
      }, sourceRoots);
    }
    const cacheFileName = String(artifact.cacheFileName);
    if (!validExternalVodArtifactCacheFileName(
      cacheFileName,
      String(artifact.hashSha256)
    )) {
      return undefined;
    }
    const artifactPath = path.resolve(jobDirectory, cacheFileName);
    if (
      path.dirname(artifactPath) !== path.resolve(jobDirectory)
      || path.basename(artifactPath) !== cacheFileName
    ) {
      return undefined;
    }
    const artifactSnapshot = await inspectExternalRegularFileNoFollow(
      artifactPath,
      {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        ...(hashFile ? { supplementalHashFile: hashFile } : {}),
        ...(signal ? { signal } : {})
      }
    );
    if (
      artifactSnapshot.sizeBytes !== artifact.sizeBytes
      || artifactSnapshot.hashSha256 !== artifact.hashSha256
    ) {
      return undefined;
    }
    const sourceRootPaths = new Map<string, string>();
    for (const root of sourceRoots ?? []) {
      const rootsDirectory = path.resolve(jobDirectory, "roots");
      const rootPath = path.resolve(rootsDirectory, root.cacheFileName);
      if (
        path.dirname(rootPath) !== rootsDirectory
        || path.basename(rootPath) !== root.cacheFileName
      ) {
        return undefined;
      }
      const rootSnapshot = await inspectExternalRegularFileNoFollow(rootPath, {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        ...(hashFile ? { supplementalHashFile: hashFile } : {}),
        ...(signal ? { signal } : {})
      });
      if (
        rootSnapshot.sizeBytes !== root.sizeBytes
        || rootSnapshot.hashSha256 !== root.hashSha256
      ) {
        return undefined;
      }
      sourceRootPaths.set(root.id, rootPath);
    }
    const receipt = parsed as unknown as ExternalVodCacheReceipt;
    secretFreeReceipt(receipt);
    return {
      receipt: {
        ...receipt,
        sourceClockProof,
        acquisitionClockProofSet,
        manifest,
        clips: normalizedClips.map((clip) => ({ ...clip })),
        acquiredSections: sections.map((section) => ({ ...section })),
        sourceRoots: sourceRoots.map((root) => ({ ...root })),
        artifact: { ...receipt.artifact }
      },
      artifactPath,
      sourceRootPaths
    };
  } catch (error) {
    if (
      error instanceof ExternalVodMaterializationError
      && error.code === "CANCELLED"
    ) {
      throw error;
    }
    return undefined;
  }
}

async function publishExternalVodArtifact({
  sourcePath,
  jobDirectory,
  sizeBytes,
  hashFile,
  signal
}: {
  sourcePath: string;
  jobDirectory: string;
  sizeBytes: number;
  hashFile?: NonNullable<ExternalVodMaterializerDependencies["hashFile"]>;
  signal?: AbortSignal;
}): Promise<PublishedExternalVodArtifact> {
  const sourceHandle = await openExternalRegularFileNoFollow(sourcePath);
  let artifactPath = "";
  let sourceSnapshot: ExternalFileSnapshot | undefined;
  let createdArtifactLink = false;
  try {
    await sourceHandle.chmod(0o600);
    sourceSnapshot = await inspectOpenedExternalRegularFile(
      sourceHandle,
      sourcePath,
      {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        requireSingleLink: true,
        ...(signal ? { signal } : {})
      }
    );
    if (sourceSnapshot.sizeBytes !== sizeBytes) {
      fail("게시할 로컬 MP4 크기가 검증 결과와 다릅니다.", "CACHE_INTEGRITY_FAILED");
    }
    let cacheFileName = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      // Never expose one shared uncommitted pathname. A failed publisher can
      // therefore remove only its own immutable artifact, even cross-process.
      cacheFileName = externalVodArtifactCacheFileName(
        sourceSnapshot.hashSha256,
        randomBytes(process.platform === "win32" ? 16 : 8).toString("hex")
      );
      artifactPath = path.join(jobDirectory, cacheFileName);
      try {
        await link(sourcePath, artifactPath);
        createdArtifactLink = true;
        break;
      } catch (error) {
        if (!(isRecord(error) && error.code === "EEXIST")) {
          throw error;
        }
      }
    }
    if (!createdArtifactLink) {
      fail("고유한 로컬 MP4 게시 이름을 만들지 못했습니다.", "CACHE_INTEGRITY_FAILED");
    }

    const linkedSourceStatus = await sourceHandle.stat({ bigint: true });
    if (
      !sameExternalFileIdentity(sourceSnapshot.status, linkedSourceStatus)
      || linkedSourceStatus.size !== sourceSnapshot.status.size
      || linkedSourceStatus.nlink !== 2n
    ) {
      fail(
        "게시 중 원본 로컬 MP4 경로 또는 링크 수가 바뀌었습니다.",
        "CACHE_INTEGRITY_FAILED"
      );
    }
    const published = await inspectExternalRegularFileNoFollow(
      artifactPath,
      {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        ...(hashFile ? { supplementalHashFile: hashFile } : {}),
        ...(signal ? { signal } : {})
      }
    );
    if (
      !sameExternalFileIdentity(linkedSourceStatus, published.status)
      || published.status.nlink !== 2n
      || published.sizeBytes !== sourceSnapshot.sizeBytes
      || published.hashSha256 !== sourceSnapshot.hashSha256
    ) {
      fail(
        "게시된 로컬 MP4가 검증한 파일 디스크립터와 일치하지 않습니다.",
        "CACHE_INTEGRITY_FAILED"
      );
    }
    return {
      artifactPath,
      cacheFileName,
      hashSha256: published.hashSha256,
      sizeBytes: published.sizeBytes,
      status: published.status,
      created: true
    };
  } catch (error) {
    if (createdArtifactLink && artifactPath && sourceSnapshot) {
      // Never remove an EEXIST entry or a name another actor replaced.
      await removeCreatedArtifactIfIdentityMatches({
        artifactPath,
        status: sourceSnapshot.status,
        created: true
      });
    }
    throw error;
  } finally {
    await sourceHandle.close().catch(() => undefined);
  }
}

async function removeCreatedArtifactIfIdentityMatches({
  artifactPath,
  status,
  created
}: {
  artifactPath: string;
  status: BigIntStats;
  created: boolean;
}): Promise<void> {
  if (!created) {
    return;
  }
  try {
    const pathBefore = await lstat(artifactPath, { bigint: true });
    if (
      pathBefore.isSymbolicLink()
      || !pathBefore.isFile()
      || normalizedExternalFileDeviceId(pathBefore.dev)
        !== normalizedExternalFileDeviceId(status.dev)
      || pathBefore.ino !== status.ino
    ) {
      return;
    }
    const handle = await openExternalRegularFileNoFollow(artifactPath);
    try {
      const currentArtifact = await handle.stat({ bigint: true });
      const pathAfter = await lstat(artifactPath, { bigint: true });
      if (
        currentArtifact.isFile()
        && sameExternalFileIdentity(currentArtifact, status)
        && sameExternalFileCrossApiObjectIdentity(pathBefore, currentArtifact)
        && sameExternalFileSnapshot(pathBefore, pathAfter)
        && sameExternalFileCrossApiObjectIdentity(pathAfter, currentArtifact)
      ) {
        await rm(artifactPath, { force: true });
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    // Never mask the validation error and never remove a replacement inode.
  }
}

async function committedReceiptMayReferencePublishedArtifact({
  receiptPath,
  published
}: {
  receiptPath: string;
  published: PublishedExternalVodArtifact;
}): Promise<boolean> {
  try {
    const receiptStatus = await lstat(receiptPath, { bigint: true });
    if (receiptStatus.isSymbolicLink() || !receiptStatus.isFile()) {
      // A directory or other non-regular entry can never be a committed cache
      // receipt. Treat it as a failed write, not as an artifact reference.
      return false;
    }
  } catch (error) {
    // A missing final pathname proves that no receipt was committed. For any
    // other lookup failure, retain the artifact: cleanup must fail closed when
    // it cannot establish whether a durable receipt exists.
    return !(isRecord(error) && error.code === "ENOENT");
  }

  try {
    const parsed = JSON.parse(await readExternalTextFileNoFollow(
      receiptPath,
      MAX_EXTERNAL_VOD_RECEIPT_BYTES
    )) as unknown;
    const artifact = isRecord(parsed) && isRecord(parsed.artifact)
      ? parsed.artifact
      : undefined;
    return artifact?.cacheFileName === published.cacheFileName;
  } catch {
    // An unreadable or changing regular receipt is ambiguous. Leaving one
    // immutable artifact for age-based cache GC is safer than invalidating a
    // result that another concurrent attempt may already have returned.
    return true;
  }
}

async function removeFailedPublishedArtifactUnlessReferenced({
  receiptPath,
  published
}: {
  receiptPath: string;
  published: PublishedExternalVodArtifact;
}): Promise<void> {
  if (await committedReceiptMayReferencePublishedArtifact({
    receiptPath,
    published
  })) {
    return;
  }
  // The cryptographically random cache filename is private to this attempt
  // until its receipt commits. Cooperative publishers therefore cannot start
  // referencing this inode after the failed-commit check above. The identity
  // check also prevents removal if the pathname was replaced meanwhile.
  await removeCreatedArtifactIfIdentityMatches(published);
}

function sourceRootId(
  root: Omit<ExternalVodSourceRootReceipt, "id" | "cacheFileName" | "streamSignature">
): string {
  return sha256Text(stableJson({
    partIndex: root.partIndex,
    playlistItem: root.playlistItem ?? null,
    sourceStartMs: root.sourceStartMs,
    sourceEndMs: root.sourceEndMs,
    partStartMs: root.partStartMs,
    partEndMs: root.partEndMs,
    hashSha256: root.hashSha256,
    clockEvidenceId: root.clockEvidence.evidenceId
  }));
}

async function existingAtomicDestinationSnapshot({
  destinationPath,
  expectedHash,
  expectedSize,
  signal
}: {
  destinationPath: string;
  expectedHash: string;
  expectedSize: number;
  signal?: AbortSignal;
}): Promise<ExternalFileSnapshot | undefined> {
  try {
    const existing = await inspectExternalRegularFileNoFollow(destinationPath, {
      maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
      requireSingleLink: true,
      ...(signal ? { signal } : {})
    });
    return existing.hashSha256 === expectedHash
      && existing.sizeBytes === expectedSize
      ? existing
      : undefined;
  } catch (error) {
    if (error instanceof ExternalVodMaterializationError) {
      if (error.code === "CANCELLED") {
        throw error;
      }
      return undefined;
    }
    throw error;
  }
}

/**
 * Copies one already-proven content-addressed root into invocation-owned
 * staging, verifies its bytes before publication, then atomically replaces the
 * deterministic destination. Concurrent publishers can replace one another
 * only with the same expected bytes. A crash before rename leaves data only in
 * the invocation's attempt directory; a crash after rename leaves a complete,
 * verified destination and no link-count recovery window.
 */
export async function copyVerifiedExternalVodFileAtomic({
  sourcePath,
  destinationPath,
  stagingDirectory,
  expectedHash,
  expectedSize,
  signal
}: {
  sourcePath: string;
  destinationPath: string;
  stagingDirectory: string;
  expectedHash: string;
  expectedSize: number;
  signal?: AbortSignal;
}): Promise<ExternalFileSnapshot> {
  if (
    !path.isAbsolute(sourcePath)
    || !path.isAbsolute(destinationPath)
    || !path.isAbsolute(stagingDirectory)
    || !/^[a-f0-9]{64}$/u.test(expectedHash)
    || !Number.isSafeInteger(expectedSize)
    || expectedSize <= 0
    || expectedSize > MAX_EXTERNAL_VOD_WORK_BYTES
  ) {
    fail("원본 조각의 원자 게시 입력이 올바르지 않습니다.", "CACHE_INTEGRITY_FAILED");
  }
  await ensurePrivateDirectory(stagingDirectory);
  const existingDestination = await existingAtomicDestinationSnapshot({
    destinationPath,
    expectedHash,
    expectedSize,
    ...(signal ? { signal } : {})
  });
  if (existingDestination) {
    return existingDestination;
  }
  const source = await openExternalRegularFileNoFollow(sourcePath);
  let destination: FileHandle | undefined;
  let temporaryPath = "";
  try {
    const before = await source.stat({ bigint: true });
    const sizeBytes = validatedOpenRegularFileStatus(before, {
      maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES
    });
    if (sizeBytes !== expectedSize) {
      fail("재사용할 원본 조각의 크기가 다릅니다.", "CACHE_INTEGRITY_FAILED");
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      temporaryPath = path.join(
        stagingDirectory,
        `.t-${randomBytes(16).toString("hex")}`
      );
      try {
        destination = await open(temporaryPath, "wx", 0o600);
        break;
      } catch (error) {
        if (!(isRecord(error) && error.code === "EEXIST")) {
          throw error;
        }
      }
    }
    if (!destination) {
      fail("원본 조각의 고유 임시 파일을 만들지 못했습니다.", "CACHE_INTEGRITY_FAILED");
    }
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const digest = createHash("sha256");
    let position = 0;
    while (position < sizeBytes) {
      abortIfRequested(signal);
      const length = Math.min(buffer.byteLength, sizeBytes - position);
      const { bytesRead } = await source.read(buffer, 0, length, position);
      if (bytesRead <= 0) {
        fail("재사용할 원본 조각을 끝까지 읽지 못했습니다.", "CACHE_INTEGRITY_FAILED");
      }
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        );
        if (result.bytesWritten <= 0) {
          fail("재사용할 원본 조각을 끝까지 복사하지 못했습니다.", "CACHE_INTEGRITY_FAILED");
        }
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    const temporaryStatus = await destination.stat({ bigint: true });
    if (
      !temporaryStatus.isFile()
      || temporaryStatus.nlink !== 1n
      || temporaryStatus.size !== BigInt(expectedSize)
    ) {
      fail("복사한 원본 조각 임시 파일이 안전하지 않습니다.", "CACHE_INTEGRITY_FAILED");
    }
    const after = await source.stat({ bigint: true });
    if (
      !sameExternalFileSnapshot(before, after)
      || digest.digest("hex") !== expectedHash
    ) {
      fail("재사용할 원본 조각이 복사 중 바뀌었습니다.", "CACHE_INTEGRITY_FAILED");
    }
    await assertNamedPathMatchesOpenFile(temporaryPath, temporaryStatus);
    await destination.close();
    destination = undefined;
    // A concurrent publisher may have completed while this invocation copied.
    // Preserve its already-correct inode and avoid disrupting active readers.
    const concurrentlyPublished = await existingAtomicDestinationSnapshot({
      destinationPath,
      expectedHash,
      expectedSize,
      ...(signal ? { signal } : {})
    });
    if (concurrentlyPublished) {
      await rm(temporaryPath, { force: true });
      temporaryPath = "";
      return concurrentlyPublished;
    }
    try {
      await rename(temporaryPath, destinationPath);
    } catch (error) {
      // Windows can refuse replacement while another native reader has not
      // granted delete sharing. Accept only a destination independently proven
      // to contain the same expected immutable bytes; otherwise preserve the
      // original rename failure.
      const lockedDestination = await existingAtomicDestinationSnapshot({
        destinationPath,
        expectedHash,
        expectedSize,
        ...(signal ? { signal } : {})
      });
      if (lockedDestination) {
        await rm(temporaryPath, { force: true });
        temporaryPath = "";
        return lockedDestination;
      }
      throw error;
    }
    temporaryPath = "";

    // Another verified publisher may atomically install the same content
    // between our rename and validation. Retry only transient path/fd races;
    // every accepted destination is independently hashed and single-linked.
    let lastRaceError: ExternalVodMaterializationError | undefined;
    for (
      let attempt = 0;
      attempt < ATOMIC_DESTINATION_STABILIZATION_ATTEMPTS;
      attempt += 1
    ) {
      abortIfRequested(signal);
      try {
        const published = await inspectExternalRegularFileNoFollow(
          destinationPath,
          {
            maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
            requireSingleLink: true,
            unlinkedSingleLinkIsTransient: true,
            ...(signal ? { signal } : {})
          }
        );
        if (
          published.hashSha256 !== expectedHash
          || published.sizeBytes !== expectedSize
        ) {
          fail("원자 게시된 원본 조각의 해시 또는 크기가 다릅니다.", "CACHE_INTEGRITY_FAILED");
        }
        return published;
      } catch (error) {
        if (
          !(error instanceof ExternalVodMaterializationError)
          || error.code !== "CACHE_INTEGRITY_FAILED"
          || attempt === ATOMIC_DESTINATION_STABILIZATION_ATTEMPTS - 1
        ) {
          throw error;
        }
        lastRaceError = error;
      }
      // A finite fan-out of verified publishers can successively unlink each
      // other's just-opened inode. Give every publisher enough bounded time
      // to observe the final name after that finite rename burst settles.
      const delayMs = Math.min(
        ATOMIC_DESTINATION_STABILIZATION_MAX_DELAY_MS,
        2 ** Math.min(attempt, 3)
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    throw lastRaceError ?? new ExternalVodMaterializationError(
      "원자 게시된 원본 조각을 안정적으로 재검증하지 못했습니다.",
      "CACHE_INTEGRITY_FAILED"
    );
  } catch (error) {
    await destination?.close().catch(() => undefined);
    destination = undefined;
    throw error;
  } finally {
    await destination?.close().catch(() => undefined);
    if (temporaryPath) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    await source.close().catch(() => undefined);
  }
}

async function inheritVerifiedRootFile({
  sourcePath,
  destinationPath,
  stagingDirectory,
  expectedHash,
  expectedSize,
  hashFile,
  signal
}: {
  sourcePath: string;
  destinationPath: string;
  stagingDirectory: string;
  expectedHash: string;
  expectedSize: number;
  hashFile?: NonNullable<ExternalVodMaterializerDependencies["hashFile"]>;
  signal?: AbortSignal;
}): Promise<void> {
  await ensurePrivateDirectory(path.dirname(destinationPath));
  // Source roots are shared across concurrent attempts. Copying keeps every
  // verified path at nlink=1, so the mandatory path↔fd nlink binding cannot be
  // invalidated merely because a sibling stages or removes another hard link.
  let inherited = await copyVerifiedExternalVodFileAtomic({
    sourcePath,
    destinationPath,
    stagingDirectory,
    expectedHash,
    expectedSize,
    ...(signal ? { signal } : {})
  });
  if (hashFile) {
    inherited = await inspectExternalRegularFileNoFollow(destinationPath, {
      maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
      supplementalHashFile: hashFile,
      ...(signal ? { signal } : {})
    });
  }
  if (
    inherited.hashSha256 !== expectedHash
    || inherited.sizeBytes !== expectedSize
  ) {
    fail("재사용한 원본 조각의 해시 또는 크기가 다릅니다.", "CACHE_INTEGRITY_FAILED");
  }
}

async function publishExternalSourceRoot({
  sourcePath,
  section,
  streamSignature,
  clockEvidence,
  jobDirectory,
  stagingDirectory,
  hashFile,
  signal
}: {
  sourcePath: string;
  section: Pick<
    PlannedExternalVodSection,
    "partIndex" | "playlistItem" | "sourceStartMs" | "sourceEndMs"
      | "partStartMs" | "partEndMs"
  >;
  streamSignature: ExternalSectionStreamSignature;
  clockEvidence: ExternalVodPersistedSectionClockEvidence;
  jobDirectory: string;
  stagingDirectory: string;
  hashFile?: NonNullable<ExternalVodMaterializerDependencies["hashFile"]>;
  signal?: AbortSignal;
}): Promise<{ receipt: ExternalVodSourceRootReceipt; path: string }> {
  const source = await inspectExternalRegularFileNoFollow(sourcePath, {
    maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
    ...(hashFile ? { supplementalHashFile: hashFile } : {}),
    ...(signal ? { signal } : {})
  });
  if (
    clockEvidence.sourceStartUs !== section.partStartMs * 1_000
    || clockEvidence.sourceEndUs !== section.partEndMs * 1_000
    || clockEvidence.output.contentSha256 !== source.hashSha256
    || clockEvidence.output.sizeBytes !== source.sizeBytes
  ) {
    fail("게시할 원본 조각과 시간축 취득 증거가 다릅니다.", "CLOCK_EVIDENCE_MISMATCH");
  }
  const cacheFileName = externalVodSourceRootCacheFileName(source.hashSha256);
  const rootsDirectory = path.join(jobDirectory, "roots");
  const rootPath = path.join(rootsDirectory, cacheFileName);
  await inheritVerifiedRootFile({
    sourcePath,
    destinationPath: rootPath,
    stagingDirectory,
    expectedHash: source.hashSha256,
    expectedSize: source.sizeBytes,
    ...(hashFile ? { hashFile } : {}),
    ...(signal ? { signal } : {})
  });
  const rootWithoutId = {
    partIndex: section.partIndex,
    ...(section.playlistItem === undefined
      ? {}
      : { playlistItem: section.playlistItem }),
    sourceStartMs: section.sourceStartMs,
    sourceEndMs: section.sourceEndMs,
    partStartMs: section.partStartMs,
    partEndMs: section.partEndMs,
    hashSha256: source.hashSha256,
    sizeBytes: source.sizeBytes,
    // This receipt records verified source-timeline coverage, not the MP4
    // union duration or one track's packet duration. The caller has already
    // checked every stream edge against this exact requested section.
    durationMs: section.sourceEndMs - section.sourceStartMs,
    clockEvidence
  };
  return {
    receipt: {
      id: sourceRootId(rootWithoutId),
      ...rootWithoutId,
      cacheFileName,
      streamSignature: { ...streamSignature }
    },
    path: rootPath
  };
}

async function inheritExternalSourceRoots({
  roots,
  sourcePaths,
  jobDirectory,
  stagingDirectory,
  hashFile,
  signal
}: {
  roots: readonly ExternalVodSourceRootReceipt[];
  sourcePaths: ReadonlyMap<string, string>;
  jobDirectory: string;
  stagingDirectory: string;
  hashFile?: NonNullable<ExternalVodMaterializerDependencies["hashFile"]>;
  signal?: AbortSignal;
}): Promise<Map<string, string>> {
  const inherited = new Map<string, string>();
  for (const root of roots) {
    const sourcePath = sourcePaths.get(root.id);
    if (!sourcePath) {
      fail("재사용할 원본 조각의 로컬 경로가 없습니다.", "CACHE_INTEGRITY_FAILED");
    }
    const destinationPath = path.join(jobDirectory, "roots", root.cacheFileName);
    await inheritVerifiedRootFile({
      sourcePath,
      destinationPath,
      stagingDirectory,
      expectedHash: root.hashSha256,
      expectedSize: root.sizeBytes,
      ...(hashFile ? { hashFile } : {}),
      ...(signal ? { signal } : {})
    });
    inherited.set(root.id, destinationPath);
  }
  return inherited;
}

export function externalPublishedArtifactInspectionBinding({
  platform,
  processId,
  fileDescriptor
}: {
  platform: NodeJS.Platform | string;
  processId: number;
  fileDescriptor: number;
}): Readonly<{
  inputPath: string;
  inheritedInputFileDescriptor?: number;
}> {
  if (!(["linux", "darwin", "win32"] as const).includes(
    platform as "linux" | "darwin" | "win32"
  )) {
    fail(
      "게시된 로컬 MP4를 열린 파일 핸들에 결속해 검사할 수 없는 운영체제입니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    fail(
      "게시된 로컬 MP4 검사 프로세스 식별자가 올바르지 않습니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  if (!Number.isSafeInteger(fileDescriptor) || fileDescriptor < 0) {
    fail(
      "게시된 로컬 MP4의 파일 디스크립터를 확인하지 못했습니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  if (platform === "linux") {
    return Object.freeze({
      inputPath: `/proc/${processId}/fd/${fileDescriptor}`
    });
  }
  return Object.freeze({
    inputPath: platform === "darwin" ? "/dev/fd/3" : "pipe:3",
    inheritedInputFileDescriptor: fileDescriptor
  });
}

async function inspectPublishedExternalVodArtifact(
  published: PublishedExternalVodArtifact,
  inspectMedia: NonNullable<ExternalVodMaterializerDependencies["inspectMedia"]>,
  options: ExternalProcessRunOptions,
  signal?: AbortSignal
): Promise<ExternalMediaInspection> {
  const handle = await openExternalRegularFileNoFollow(published.artifactPath);
  try {
    const before = await inspectOpenedExternalRegularFile(
      handle,
      published.artifactPath,
      {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        ...(signal ? { signal } : {})
      }
    );
    if (
      !sameExternalFileIdentity(published.status, before.status)
      || before.sizeBytes !== published.sizeBytes
      || before.hashSha256 !== published.hashSha256
    ) {
      fail(
        "게시된 로컬 MP4가 최종 미디어 검사 전에 바뀌었습니다.",
        "CACHE_INTEGRITY_FAILED"
      );
    }
    if (!Number.isSafeInteger(handle.fd) || handle.fd < 0) {
      fail(
        "게시된 로컬 MP4의 파일 디스크립터를 확인하지 못했습니다.",
        "MEDIA_VERIFICATION_FAILED"
      );
    }
    const binding = externalPublishedArtifactInspectionBinding({
      platform: process.platform,
      processId: process.pid,
      fileDescriptor: handle.fd
    });
    const inspection = await inspectMedia(
      binding.inputPath,
      binding.inheritedInputFileDescriptor === undefined
        ? options
        : {
          ...options,
          inheritedInputFileDescriptor: binding.inheritedInputFileDescriptor
        }
    );
    const after = await inspectOpenedExternalRegularFile(
      handle,
      published.artifactPath,
      {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        ...(signal ? { signal } : {})
      }
    );
    if (
      !sameExternalFileSnapshot(before.status, after.status)
      || after.sizeBytes !== before.sizeBytes
      || after.hashSha256 !== before.hashSha256
    ) {
      fail(
        "게시된 로컬 MP4가 파일 디스크립터 미디어 검사 중 바뀌었습니다.",
        "CACHE_INTEGRITY_FAILED"
      );
    }
    return inspection;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function receiptClips(
  clips: readonly ExternalVodClipRange[]
): ExternalVodClipRange[] {
  return [...clips]
    .map((clip) => ({ ...clip }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function acquiredSectionReceipts(
  sections: readonly PlannedExternalVodSection[]
): ExternalVodCacheReceipt["acquiredSections"] {
  return sections.map((section) => ({
    id: section.id,
    windowIndex: section.windowIndex,
    sectionIndex: section.sectionIndex,
    partIndex: section.partIndex,
    ...(section.playlistItem === undefined
      ? {}
      : { playlistItem: section.playlistItem }),
    sourceStartMs: section.sourceStartMs,
    sourceEndMs: section.sourceEndMs,
    partStartMs: section.partStartMs,
    partEndMs: section.partEndMs
  }));
}

function rootBelongsToSection(
  root: ExternalVodSourceRootReceipt,
  section: Pick<
    PlannedExternalVodSection,
    "partIndex" | "playlistItem" | "sourceStartMs" | "sourceEndMs"
      | "partStartMs"
  >
): boolean {
  return root.partIndex === section.partIndex
    && root.playlistItem === section.playlistItem
    && root.sourceStartMs >= section.sourceStartMs
    && root.sourceEndMs <= section.sourceEndMs
    && root.partStartMs === section.partStartMs
      + root.sourceStartMs - section.sourceStartMs
    && root.partEndMs === section.partStartMs
      + root.sourceEndMs - section.sourceStartMs;
}

function assertRootsContainedInPlan(
  roots: readonly ExternalVodSourceRootReceipt[],
  plan: ExternalVodPlan
): void {
  if (roots.some((root) => (
    !plan.sections.some((section) => rootBelongsToSection(root, section))
  ))) {
    fail(
      "기존 로컬 재료의 범위가 새 확장 범위에 포함되지 않습니다.",
      "INVALID_BASE_MATERIALIZATION"
    );
  }
}

/** Returns only source gaps, preserving the semantic plan's SOOP boundaries. */
export function missingExternalVodSections(
  plan: ExternalVodPlan,
  roots: readonly ExternalVodSourceRootReceipt[]
): PlannedExternalVodSection[] {
  assertRootsContainedInPlan(roots, plan);
  const missing: PlannedExternalVodSection[] = [];
  for (const section of plan.sections) {
    const candidates = roots
      .filter((root) => rootBelongsToSection(root, section))
      .sort((left, right) => (
        left.sourceStartMs - right.sourceStartMs
        || left.sourceEndMs - right.sourceEndMs
      ));
    let cursorMs = section.sourceStartMs;
    for (const root of candidates) {
      if (root.sourceEndMs <= cursorMs) {
        continue;
      }
      if (root.sourceStartMs < cursorMs) {
        fail("재사용 원본 조각 범위가 서로 겹칩니다.", "CACHE_INTEGRITY_FAILED");
      }
      if (root.sourceStartMs > cursorMs) {
        const partStartMs = section.partStartMs
          + cursorMs - section.sourceStartMs;
        missing.push({
          ...section,
          id: `gap-${missing.length + 1}`,
          sourceStartMs: cursorMs,
          sourceEndMs: root.sourceStartMs,
          partStartMs,
          partEndMs: partStartMs + root.sourceStartMs - cursorMs,
          clipIds: [...section.clipIds]
        });
      }
      cursorMs = root.sourceEndMs;
    }
    if (cursorMs < section.sourceEndMs) {
      const partStartMs = section.partStartMs
        + cursorMs - section.sourceStartMs;
      missing.push({
        ...section,
        id: `gap-${missing.length + 1}`,
        sourceStartMs: cursorMs,
        partStartMs,
        partEndMs: section.partEndMs,
        clipIds: [...section.clipIds]
      });
    }
  }
  return missing;
}

function orderedRootsForPlan(
  plan: ExternalVodPlan,
  roots: readonly ExternalVodSourceRootReceipt[]
): ExternalVodSourceRootReceipt[] {
  if (!compatibleExternalVodRootRevisionAnchors(roots)) {
    fail(
      "기존 조각과 새 조각의 HLS 바이트 세대가 다릅니다.",
      "CACHE_INTEGRITY_FAILED"
    );
  }
  assertRootsContainedInPlan(roots, plan);
  const ordered: ExternalVodSourceRootReceipt[] = [];
  const used = new Set<string>();
  for (const section of plan.sections) {
    const candidates = roots
      .filter((root) => rootBelongsToSection(root, section))
      .sort((left, right) => (
        left.sourceStartMs - right.sourceStartMs
        || left.sourceEndMs - right.sourceEndMs
        || left.id.localeCompare(right.id)
      ));
    let cursorMs = section.sourceStartMs;
    for (const root of candidates) {
      if (root.sourceStartMs !== cursorMs || used.has(root.id)) {
        fail("원본 조각이 새 로컬 시간축을 정확히 채우지 못합니다.", "CACHE_INTEGRITY_FAILED");
      }
      ordered.push(root);
      used.add(root.id);
      cursorMs = root.sourceEndMs;
    }
    if (cursorMs !== section.sourceEndMs) {
      fail("원본 조각 사이에 시간축 공백이 있습니다.", "CACHE_INTEGRITY_FAILED");
    }
  }
  if (used.size !== roots.length) {
    fail("새 시간축에서 쓰이지 않는 원본 조각이 있습니다.", "CACHE_INTEGRITY_FAILED");
  }
  return ordered;
}

function manifestClipRanges(
  receipt: ExternalVodCacheReceipt
): MaterializationClipCoverage[] {
  if (receipt.manifest.clipRanges) {
    return receipt.manifest.clipRanges.map((range) => ({ ...range }));
  }
  return createMaterializationClipCoverages(
    receipt.clips.map((clip) => ({
      clipId: clip.id,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs
    })),
    receipt.manifest.sourceDurationMs,
    receipt.manifest.handleMs
  );
}

function assertMonotonicBaseCoverage(
  base: ExternalVodCacheReceipt,
  desired: readonly MaterializationClipCoverage[]
): void {
  const desiredById = new Map(desired.map((range) => [range.clipId, range]));
  const baseRanges = manifestClipRanges(base);
  if (baseRanges.length > desired.length) {
    fail("기존 로컬 재료의 컷 구성이 현재 요청과 다릅니다.", "INVALID_BASE_MATERIALIZATION");
  }
  for (const range of baseRanges) {
    const next = desiredById.get(range.clipId);
    if (
      !next
      || next.sourceStartMs !== range.sourceStartMs
      || next.sourceEndMs !== range.sourceEndMs
      || next.editableSourceStartMs > range.editableSourceStartMs
      || next.editableSourceEndMs < range.editableSourceEndMs
    ) {
      fail(
        "hot-load 범위는 기존 컷 anchor와 로컬 편집 범위를 줄이거나 바꿀 수 없습니다.",
        "INVALID_BASE_MATERIALIZATION"
      );
    }
  }
}

function requestedClipRanges(
  clips: readonly ExternalVodClipRange[],
  editableRanges: readonly ExternalVodEditableRange[] | undefined,
  sourceDurationMs: number,
  handleMs: number
): MaterializationClipCoverage[] {
  const desired = normalizeEditableRanges(
    editableRanges,
    clips,
    sourceDurationMs,
    handleMs
  );
  return createMaterializationClipCoverages(
    clips.map((clip) => ({
      clipId: clip.id,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs
    })),
    sourceDurationMs,
    handleMs,
    desired
  );
}

function sameClipCoverages(
  left: readonly MaterializationClipCoverage[],
  right: readonly MaterializationClipCoverage[]
): boolean {
  return stableJson([...left].sort((a, b) => a.clipId.localeCompare(b.clipId)))
    === stableJson([...right].sort((a, b) => a.clipId.localeCompare(b.clipId)));
}

async function verifyReusableRootMedia({
  root,
  rootPath,
  inspectMedia,
  options
}: {
  root: ExternalVodSourceRootReceipt;
  rootPath: string;
  inspectMedia: NonNullable<ExternalVodMaterializerDependencies["inspectMedia"]>;
  options: ExternalProcessRunOptions;
}): Promise<void> {
  const inspection = await inspectMedia(rootPath, options);
  assertExternalSectionCoverage(
    inspection,
    root.durationMs,
    "재사용 원본 조각의 실제 길이가 receipt와 다릅니다.",
    "CACHE_INTEGRITY_FAILED"
  );
  const signature = externalSectionStreamSignature(inspection);
  assertCompatibleSectionStreams(root.streamSignature, signature);
}

function assertRootClockEvidenceMatchesProofSet(
  root: ExternalVodSourceRootReceipt,
  proofSet: ExternalVodPersistedClockProofSet
): void {
  const partProof = proofSet.parts.find((part) => (
    part.partIndex === root.partIndex
    && part.playlistItem === (root.playlistItem ?? null)
  ));
  if (!partProof || !root.clockEvidence) {
    fail("재사용 원본 조각에 현재 선택 시간축 증거가 없습니다.", "CACHE_INTEGRITY_FAILED");
  }
  try {
    const evidence = partProof.transport === "HLS"
      ? assertExternalVodHlsAcquisitionMatchesPartProof(partProof, root.clockEvidence)
      : assertExternalVodDirectAcquisitionMatchesPartProof(partProof, root.clockEvidence);
    if (
      evidence.sourceStartUs !== root.partStartMs * 1_000
      || evidence.sourceEndUs !== root.partEndMs * 1_000
      || evidence.output.contentSha256 !== root.hashSha256
      || evidence.output.sizeBytes !== root.sizeBytes
    ) {
      fail("재사용 원본 조각과 시간축 증거가 다릅니다.", "CACHE_INTEGRITY_FAILED");
    }
  } catch (error) {
    if (error instanceof ExternalVodMaterializationError) {
      throw error;
    }
    fail("재사용 원본 조각의 시간축 증거를 검증하지 못했습니다.", "CACHE_INTEGRITY_FAILED");
  }
}

async function loadPartialSourceRoots({
  jobDirectory,
  metadata,
  planFingerprint,
  acquisitionClockProofSet,
  plan,
  inspectMedia,
  options,
  hashFile,
  signal
}: {
  jobDirectory: string;
  metadata: ExternalVodMetadata;
  planFingerprint: string;
  acquisitionClockProofSet: ExternalVodPersistedClockProofSet;
  plan: ExternalVodPlan;
  inspectMedia: NonNullable<ExternalVodMaterializerDependencies["inspectMedia"]>;
  options: ExternalProcessRunOptions;
  hashFile?: NonNullable<ExternalVodMaterializerDependencies["hashFile"]>;
  signal?: AbortSignal;
}): Promise<{
  roots: ExternalVodSourceRootReceipt[];
  paths: Map<string, string>;
}> {
  try {
    const parsed = JSON.parse(await readExternalTextFileNoFollow(
      path.join(jobDirectory, "partial-roots.json"),
      MAX_EXTERNAL_VOD_RECEIPT_BYTES,
      signal
    )) as unknown;
    if (
      !isRecord(parsed)
      || Object.keys(parsed).sort().join(",") !== (
        "acquisitionClockProofSetId,planFingerprint,schemaId,sourceRoots,sourceVersionId,updatedAt"
      )
      || parsed.schemaId !== EXTERNAL_PARTIAL_ROOTS_SCHEMA
      || parsed.planFingerprint !== planFingerprint
      || parsed.sourceVersionId !== metadata.sourceVersionId
      || parsed.acquisitionClockProofSetId !== acquisitionClockProofSet.proofSetId
      || typeof parsed.updatedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.updatedAt))
    ) {
      return { roots: [], paths: new Map() };
    }
    const roots = normalizedSourceRootReceipts(
      parsed.sourceRoots,
      metadata.durationMs,
      acquisitionClockProofSet
    );
    if (!roots) {
      return { roots: [], paths: new Map() };
    }
    assertRootsContainedInPlan(roots, plan);
    missingExternalVodSections(plan, roots);
    const paths = new Map<string, string>();
    for (const root of roots) {
      const rootPath = path.join(jobDirectory, "roots", root.cacheFileName);
      const snapshot = await inspectExternalRegularFileNoFollow(rootPath, {
        maximumBytes: MAX_EXTERNAL_VOD_WORK_BYTES,
        ...(hashFile ? { supplementalHashFile: hashFile } : {}),
        ...(signal ? { signal } : {})
      });
      if (
        snapshot.hashSha256 !== root.hashSha256
        || snapshot.sizeBytes !== root.sizeBytes
      ) {
        return { roots: [], paths: new Map() };
      }
      await verifyReusableRootMedia({ root, rootPath, inspectMedia, options });
      paths.set(root.id, rootPath);
    }
    return { roots, paths };
  } catch (error) {
    if (
      error instanceof ExternalVodMaterializationError
      && error.code === "CANCELLED"
    ) {
      throw error;
    }
    return { roots: [], paths: new Map() };
  }
}

async function writePartialSourceRoots({
  jobDirectory,
  metadata,
  planFingerprint,
  acquisitionClockProofSet,
  roots,
  now
}: {
  jobDirectory: string;
  metadata: ExternalVodMetadata;
  planFingerprint: string;
  acquisitionClockProofSet: ExternalVodPersistedClockProofSet;
  roots: readonly ExternalVodSourceRootReceipt[];
  now: () => Date;
}): Promise<void> {
  const updatedAt = now();
  if (!Number.isFinite(updatedAt.getTime())) {
    fail("부분 원본 조각 저장 시각을 만들지 못했습니다.", "MANIFEST_INVALID");
  }
  const partialDocument = {
    schemaId: EXTERNAL_PARTIAL_ROOTS_SCHEMA,
    planFingerprint,
    sourceVersionId: metadata.sourceVersionId,
    acquisitionClockProofSetId: acquisitionClockProofSet.proofSetId,
    sourceRoots: roots,
    updatedAt: updatedAt.toISOString()
  };
  assertSecretFreePersistentDocument(partialDocument);
  await atomicWriteJson(
    path.join(jobDirectory, "partial-roots.json"),
    partialDocument
  );
}

function createExternalManifest({
  metadata,
  planFingerprint,
  handleMs,
  clipRanges,
  windows,
  preparedAt
}: {
  metadata: ExternalVodMetadata;
  planFingerprint: string;
  handleMs: number;
  clipRanges: readonly MaterializationClipCoverage[];
  windows: readonly MaterializationWindow[];
  preparedAt: string;
}): ChzzkVodMaterialization {
  const mediaDurationMs = windows.at(-1)?.mediaEndMs ?? 0;
  const candidate: ChzzkVodMaterialization = {
    schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: planFingerprint.slice(0, 32),
    planFingerprint,
    source: {
      platform: metadata.platform,
      contentType: "vod",
      contentId: metadata.contentId,
      sourceVersionId: metadata.sourceVersionId
    },
    sourceDurationMs: metadata.durationMs,
    handleMs,
    mediaDurationMs,
    windows: windows.map((window) => ({
      ...window,
      clipIds: [...window.clipIds]
    })),
    clipRanges: clipRanges.map((range) => ({ ...range })),
    preparedAt,
    localOnly: true
  };
  const normalized = normalizeChzzkVodMaterialization(candidate);
  if (!normalized) {
    fail("외부 VOD 로컬 시간축 manifest를 검증하지 못했습니다.", "MANIFEST_INVALID");
  }
  return normalized;
}

export interface ExternalSectionStreamSignature {
  width: number;
  height: number;
  frameRate: number;
  audioCodec: "aac" | null;
  audioSampleRate?: number;
  audioChannels?: number;
  audioChannelLayout?: string;
}

function externalSectionStreamSignature(
  inspection: ExternalMediaInspection
): ExternalSectionStreamSignature {
  if (
    !Number.isSafeInteger(inspection.width)
    || Number(inspection.width) <= 0
    || !Number.isSafeInteger(inspection.height)
    || Number(inspection.height) <= 0
    || !Number.isFinite(inspection.frameRate)
    || inspection.frameRate <= 0
    || inspection.width > MAX_EXTERNAL_VOD_WIDTH
    || inspection.height > MAX_EXTERNAL_VOD_HEIGHT
    || inspection.frameRate > MAX_EXTERNAL_VOD_FRAME_RATE + 0.001
  ) {
    fail(
      "다운로드 구간의 영상 프레임 크기를 확인하지 못해 안전하게 병합할 수 없습니다.",
      "MEDIA_STREAM_MISMATCH"
    );
  }
  if (
    inspection.audioCodec === "aac"
    && (
      !Number.isSafeInteger(inspection.audioSampleRate)
      || Number(inspection.audioSampleRate) <= 0
      || !Number.isSafeInteger(inspection.audioChannels)
      || Number(inspection.audioChannels) <= 0
    )
  ) {
    fail(
      "다운로드 구간의 AAC 샘플레이트·채널 구성을 확인하지 못해 안전하게 병합할 수 없습니다.",
      "MEDIA_STREAM_MISMATCH"
    );
  }
  return {
    width: Number(inspection.width),
    height: Number(inspection.height),
    frameRate: inspection.frameRate,
    audioCodec: inspection.audioCodec,
    ...(inspection.audioCodec === "aac"
      ? {
        audioSampleRate: Number(inspection.audioSampleRate),
        audioChannels: Number(inspection.audioChannels),
        ...(inspection.audioChannelLayout
          ? { audioChannelLayout: inspection.audioChannelLayout }
          : {})
      }
      : {})
  };
}

function assertCompatibleSectionStreams(
  expected: ExternalSectionStreamSignature,
  actual: ExternalSectionStreamSignature
): void {
  if (
    expected.width !== actual.width
    || expected.height !== actual.height
    || Math.abs(expected.frameRate - actual.frameRate) > 0.001
    || expected.audioCodec !== actual.audioCodec
    || expected.audioSampleRate !== actual.audioSampleRate
    || expected.audioChannels !== actual.audioChannels
    || (
      expected.audioChannelLayout !== undefined
      && actual.audioChannelLayout !== undefined
      && expected.audioChannelLayout !== actual.audioChannelLayout
    )
  ) {
    fail(
      "다운로드 구간들의 해상도 또는 오디오 구성이 달라 손실 없이 병합할 수 없습니다.",
      "MEDIA_STREAM_MISMATCH"
    );
  }
}

function externalMediaPhaseTimeoutMs(durationMs: number): number {
  return Math.min(
    MAX_EXTERNAL_DOWNLOAD_TIMEOUT_MS,
    Math.max(5 * 60 * 1_000, durationMs * 3)
  );
}

async function acquireExternalSections({
  metadata,
  sections,
  clockProofSet,
  partRuntimes,
  jobDirectory,
  runProcess,
  inspectMedia,
  processEnv,
  ffmpegBinary,
  fetchImpl,
  signal,
  onProgress,
  onSectionReady
}: {
  metadata: ExternalVodMetadata;
  sections: readonly PlannedExternalVodSection[];
  clockProofSet: ExternalVodPersistedClockProofSet;
  partRuntimes: readonly ExternalVodPartRuntime[];
  jobDirectory: string;
  runProcess: ExternalProcessRunner;
  inspectMedia: NonNullable<ExternalVodMaterializerDependencies["inspectMedia"]>;
  processEnv: NodeJS.ProcessEnv;
  ffmpegBinary: string;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
  onProgress?: ExternalVodMaterializationRequest["onProgress"];
  onSectionReady?: (input: {
    section: PlannedExternalVodSection;
    filePath: string;
    inspection: ExternalMediaInspection;
    streamSignature: ExternalSectionStreamSignature;
    clockEvidence: ExternalVodPersistedSectionClockEvidence;
  }) => Promise<void>;
}): Promise<{
  files: string[];
  inspections: ExternalMediaInspection[];
  bytes: number;
  streamSignature: ExternalSectionStreamSignature;
}> {
  const files: string[] = [];
  const inspections: ExternalMediaInspection[] = [];
  let completedBytes = 0;
  let streamSignature: ExternalSectionStreamSignature | undefined;
  for (const [index, section] of sections.entries()) {
    abortIfRequested(signal);
    const outputBaseName = `section-${String(index + 1).padStart(4, "0")}`;
    const sectionPath = path.join(jobDirectory, `${outputBaseName}.mp4`);
    const expectedDurationMs = section.sourceEndMs - section.sourceStartMs;
    const options: ExternalProcessRunOptions = {
      ...processOptions(
        jobDirectory,
        processEnv,
        signal,
        externalMediaPhaseTimeoutMs(expectedDurationMs)
      ),
      workingDirectoryByteLimit: MAX_EXTERNAL_VOD_WORK_BYTES,
      minimumAvailableDiskBytes: MIN_EXTERNAL_VOD_DISK_HEADROOM_BYTES
    };
    const runtime = partRuntimes.find((candidate) => (
      candidate.partIndex === section.partIndex
    ));
    const partProof = clockProofSet.parts.find((candidate) => (
      candidate.partIndex === section.partIndex
    ));
    if (!runtime || !partProof || runtime.kind.toUpperCase() !== partProof.transport) {
      fail("선택 구간의 증명된 실행 시간축을 찾지 못했습니다.", "INVALID_CLOCK_PROOF");
    }
    const processAdapter = async (
      command: string,
      args: readonly string[],
      processRequest: { cwd: string; timeoutMs: number; signal?: AbortSignal }
    ): Promise<ExternalProcessResult> => await runProcess(command, args, {
      ...processOptions(
        processRequest.cwd,
        processEnv,
        processRequest.signal,
        processRequest.timeoutMs
      ),
      workingDirectoryByteLimit: MAX_EXTERNAL_VOD_WORK_BYTES,
      minimumAvailableDiskBytes: MIN_EXTERNAL_VOD_DISK_HEADROOM_BYTES
    });
    const inspectAdapter = async (
      filePath: string,
      processRequest: { cwd: string; timeoutMs: number; signal?: AbortSignal }
    ) => {
      const inspection = await inspectMedia(filePath, {
        ...processOptions(
          processRequest.cwd,
          processEnv,
          processRequest.signal,
          processRequest.timeoutMs
        ),
        workingDirectoryByteLimit: MAX_EXTERNAL_VOD_WORK_BYTES,
        minimumAvailableDiskBytes: MIN_EXTERNAL_VOD_DISK_HEADROOM_BYTES
      });
      const video = inspection.streamTimelines?.video;
      if (!video) {
        fail("정밀 취득 출력의 비디오 시간축을 확인하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
      }
      return {
        durationMs: inspection.durationMs,
        video: { ...video },
        ...(inspection.streamTimelines?.audio
          ? { audio: { ...inspection.streamTimelines.audio } }
          : {})
      };
    };
    const stableSectionId = [
      "part",
      section.partIndex,
      section.partStartMs,
      section.partEndMs
    ].join("-");
    let clockEvidence: ExternalVodPersistedSectionClockEvidence;
    try {
      if (runtime.kind === "hls") {
        const acquired = await acquireExternalVodHlsSection({
          sectionId: stableSectionId,
          partProofId: partProof.partProofId,
          clockProofId: partProof.clockProofId,
          sourceStartMs: section.partStartMs,
          sourceEndMs: section.partEndMs,
          timeline: runtime.timeline,
          workDirectory: jobDirectory,
          outputPath: sectionPath,
          ...(signal ? { signal } : {}),
          processTimeoutMs: externalMediaPhaseTimeoutMs(expectedDurationMs),
          durationToleranceMs: MAX_SECTION_DURATION_DRIFT_MS,
          requireAudio: true
        }, {
          assertAllowedUrl: (url) => {
            assertExternalVodTransferUrl(metadata.platform, url);
          },
          fetchValidatedBinary: async (request) => await fetchExternalVodBytes({
            platform: metadata.platform,
            url: request.url,
            requestHeaders: runtime.requestHeaders,
            maximumBytes: request.maximumBytes,
            ...(fetchImpl ? { fetchImpl } : {}),
            ...(request.signal ? { signal: request.signal } : {})
          }),
          runProcess: processAdapter,
          inspectOutput: inspectAdapter,
          ffmpegBinary
        });
        clockEvidence = assertExternalVodHlsAcquisitionMatchesPartProof(
          partProof,
          acquired.persistedEvidence
        );
      } else {
        const acquired = await acquireExternalVodDirectSection({
          sectionId: stableSectionId,
          partProofId: partProof.partProofId,
          clockProof: runtime.clockProof,
          runtimeInputs: runtime.runtimeInputs,
          sourceStartMs: section.partStartMs,
          sourceEndMs: section.partEndMs,
          workDirectory: jobDirectory,
          outputPath: sectionPath,
          ...(signal ? { signal } : {}),
          processTimeoutMs: externalMediaPhaseTimeoutMs(expectedDurationMs),
          durationToleranceMs: MAX_SECTION_DURATION_DRIFT_MS,
          requireAudio: true
        }, {
          assertAllowedUrl: (url) => {
            assertExternalVodTransferUrl("YOUTUBE", url);
          },
          runProcess: processAdapter,
          inspectOutput: inspectAdapter,
          ffmpegBinary
        });
        clockEvidence = assertExternalVodDirectAcquisitionMatchesPartProof(
          partProof,
          acquired.evidence
        );
      }
    } catch (error) {
      if (
        error instanceof ExternalVodMaterializationError
        || (isRecord(error) && error.code === "CANCELLED")
      ) {
        throw error;
      }
      const code = isRecord(error) && typeof error.code === "string"
        ? error.code
        : "DOWNLOAD_FAILED";
      fail(
        `${metadata.platform} 공개 VOD 구간을 증명된 시간축으로 준비하지 못했습니다.`,
        code
      );
    }
    // Track immediately. The private attempt directory is removed even when
    // lstat/ffprobe fails.
    files.push(sectionPath);
    const sizeBytes = await assertSafeRegularFile(sectionPath, jobDirectory);
    completedBytes = assertExternalMaterializationByteQuota(
      completedBytes,
      sizeBytes
    );
    const inspection = await inspectMedia(sectionPath, options);
    inspections.push(inspection);
    assertExternalSectionCoverage(
      inspection,
      expectedDurationMs,
      "정밀 취득한 VOD 구간 길이가 요청한 원본 범위와 다릅니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
    const currentStreamSignature = externalSectionStreamSignature(inspection);
    if (streamSignature) {
      assertCompatibleSectionStreams(streamSignature, currentStreamSignature);
    } else {
      streamSignature = currentStreamSignature;
    }
    await onSectionReady?.({
      section,
      filePath: sectionPath,
      inspection,
      streamSignature: currentStreamSignature,
      clockEvidence
    });
    emitProgress(onProgress, {
      phase: "downloading",
      completedSections: index + 1,
      totalSections: sections.length,
      completedBytes
    });
  }
  if (!streamSignature) {
    fail("준비한 외부 VOD 구간 스트림이 없습니다.", "MEDIA_STREAM_MISMATCH");
  }
  return { files, inspections, bytes: completedBytes, streamSignature };
}

/**
 * Materializes the immutable user selections, their initial ten-second
 * handles, and only explicitly requested monotonic hot-load extensions. All
 * yt-dlp resolves only the public selected rendition. HLS fragments or proven
 * zero-origin direct inputs are then acquired against their player clock, and
 * all resulting editing media remains under the local state directory.
 */
export async function materializeExternalVod(
  request: ExternalVodMaterializationRequest,
  dependencies: ExternalVodMaterializerDependencies = {}
): Promise<ExternalVodMaterializationResult> {
  const consumerScopeHash = externalVodConsumerScopeHash(request.consumerId);
  const source = normalizeExternalVodUrl(request.sourceUrl);
  const legacySourceClockIdentity = normalizedRequestSourceClockIdentity(
    source,
    request.sourceClockIdentity
  );
  const expectedLegacyClockIdentitySha256 = soopSourceClockIdentitySha256(
    legacySourceClockIdentity
  );
  const handleMs = validatedHandleMs(request.handleMs);
  const { publicClips } = normalizeClipRanges(request.clips);
  if (request.resume !== undefined && request.base !== undefined) {
    fail("resume과 hot-load base는 동시에 사용할 수 없습니다.", "INVALID_REQUEST");
  }
  const processEnv = dependencies.processEnv ?? process.env;
  const hashFile = dependencies.hashFile;
  const stateDirectory = resolveExternalVodStateDirectory(
    request.stateDir,
    processEnv
  );
  await ensurePrivateDirectory(stateDirectory);
  abortIfRequested(request.signal);

  // A saved editor session carries this strict identity. Validate the complete
  // local receipt and artifact before resolving any external binary or making
  // a metadata request, so a gateway restart or an offline machine can reopen.
  const resume = normalizedExternalResumeReference(request.resume, source);
  if (request.resume !== undefined && !resume) {
    fail("저장된 외부 VOD 재개 식별자가 올바르지 않습니다.", "INVALID_RESUME");
  }
  if (resume) {
    const resumedJobDirectory = scopedExternalVodJobDirectory({
      stateDirectory,
      consumerScopeHash,
      platform: source.platform,
      materializationId: resume.materializationId
    });
    const resumed = await reusableExternalVodReceipt({
      receiptPath: path.join(resumedJobDirectory, "manifest.json"),
      jobDirectory: resumedJobDirectory,
      expectedCanonicalUrl: source.canonicalUrl,
      expectedContentId: source.contentId,
      ...(expectedLegacyClockIdentitySha256
        ? {
          expectedBrowserClockIdentitySha256:
            expectedLegacyClockIdentitySha256
        }
        : {}),
      expectedPlanFingerprint: resume.planFingerprint,
      expectedHandleMs: handleMs,
      expectedClips: publicClips,
      ...(hashFile ? { hashFile } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    if (resumed) {
      const requestedRanges = requestedClipRanges(
        publicClips,
        request.editableRanges,
        resumed.receipt.manifest.sourceDurationMs,
        handleMs
      );
      if (!sameClipCoverages(
        requestedRanges,
        manifestClipRanges(resumed.receipt)
      )) {
        fail(
          "저장된 외부 VOD 재료의 편집 범위와 재개 요청이 다릅니다.",
          "INVALID_RESUME"
        );
      }
      emitProgress(request.onProgress, {
        phase: "completed",
        completedSections: resumed.receipt.acquiredSections.length,
        totalSections: resumed.receipt.acquiredSections.length,
        completedBytes: resumed.receipt.artifact.sizeBytes
      });
      return {
        manifest: resumed.receipt.manifest,
        receipt: resumed.receipt,
        artifactPath: resumed.artifactPath,
        reused: true
      };
    }
  }

  const runProcess = dependencies.runProcess ?? runExternalProcess;
  const ytDlpBinary = verifiedAbsoluteToolPath(
    dependencies.ytDlpBinary
      ?? processEnv.KIRINUKI_YT_DLP_BINARY,
    "yt-dlp artifact"
  );
  const ytDlpMode = externalYtDlpMode(
    dependencies.ytDlpMode
      ?? processEnv.KIRINUKI_YT_DLP_MODE
  );
  const configuredPythonBinary = dependencies.pythonBinary
    ?? processEnv.KIRINUKI_YT_DLP_PYTHON_BINARY;
  const pythonBinary = ytDlpMode === "python-zipimport"
    ? verifiedAbsoluteToolPath(configuredPythonBinary, "Python")
    : undefined;
  const nodeBinary = executableName(
    dependencies.nodeBinary
      ?? processEnv.KIRINUKI_YT_DLP_NODE_BINARY
      ?? process.execPath,
    process.execPath
  );
  const ffmpegBinary = executableName(
    dependencies.ffmpegBinary
      ?? processEnv.KIRINUKI_FFMPEG_BINARY,
    "ffmpeg"
  );
  const ffprobeBinary = executableName(
    dependencies.ffprobeBinary
      ?? processEnv.KIRINUKI_FFPROBE_BINARY,
    "ffprobe"
  );
  const now = dependencies.now ?? (() => new Date());
  const inspectMedia = dependencies.inspectMedia ?? ((filePath, options) => (
    inspectExternalMp4(filePath, options, {
      runProcess,
      ffprobeBinary
    })
  ));
  const inspectPacketCopyMedia = dependencies.inspectPacketCopyMedia
    ?? (dependencies.inspectMedia
      ? undefined
      : (filePath: string, options: ExternalProcessRunOptions) => (
        inspectExternalMp4(filePath, options, {
          runProcess,
          ffprobeBinary
        })
      ));
  emitProgress(request.onProgress, {
    phase: "resolving",
    completedSections: 0,
    totalSections: 0,
    completedBytes: 0
  });
  const metadataProbeDirectory = path.join(
    stateDirectory,
    `metadata-probe-${randomBytes(16).toString("hex")}`
  );
  await mkdir(metadataProbeDirectory, { mode: 0o700 });
  const rawMetadata = await (async () => {
    try {
      return await probeExternalVodMetadata(source, {
        runProcess,
        ytDlpBinary,
        ytDlpMode,
        ...(pythonBinary === undefined ? {} : { pythonBinary }),
        nodeBinary,
        processEnv,
        cwd: metadataProbeDirectory,
        ...(request.signal ? { signal: request.signal } : {})
      });
    } finally {
      await rm(metadataProbeDirectory, { recursive: true, force: true });
    }
  })();
  const sourceClockIdentity = metadataSoopSourceClockIdentity(
    rawMetadata,
    legacySourceClockIdentity
  );
  const expectedBrowserClockIdentitySha256 = soopSourceClockIdentitySha256(
    sourceClockIdentity
  );
  const clockResolver = dependencies.resolveClockProofSet
    ?? resolveExternalVodClockProofs;
  const resolveClockParts = async (
    candidateMetadata: ExternalVodMetadata,
    parts: readonly ExternalVodMetadataPart[],
    cwd: string
  ): Promise<ExternalVodClockProofSetResolution> => {
    try {
      const tlsCaFile = await writePrivateNodeRootCaFile(cwd);
      const prove = async (): Promise<ExternalVodClockProofSetResolution> => (
        await clockResolver(candidateMetadata, parts, {
          cwd,
          runProcess,
          processEnv,
          ytDlpBinary,
          ytDlpMode,
          ...(pythonBinary === undefined ? {} : { pythonBinary }),
          nodeBinary,
          ffprobeBinary,
          tlsCaFile,
          ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
          ...(request.signal ? { signal: request.signal } : {})
        })
      );
      let resolution: ExternalVodClockProofSetResolution;
      try {
        resolution = await prove();
      } catch (error) {
        abortIfRequested(request.signal);
        const code = isRecord(error) && typeof error.code === "string"
          ? error.code
          : "";
        if (
          candidateMetadata.platform !== "YOUTUBE"
          || code !== "DIRECT_CLOCK_PROBE_FAILED"
        ) {
          throw error;
        }
        // A signed googlevideo edge URL can expire between yt-dlp selection
        // and ffprobe. Resolve a fresh exact format once; never reuse or relax
        // the failed clock proof, and keep the retry strictly bounded.
        resolution = await prove();
      }
      return assertExternalVodClockResolutionMatchesRequest(
        candidateMetadata,
        parts,
        resolution
      );
    } catch (error) {
      abortIfRequested(request.signal);
      if (error instanceof ExternalVodMaterializationError) {
        throw error;
      }
      const code = isRecord(error) && typeof error.code === "string"
        ? error.code
        : "CLOCK_PROOF_FAILED";
      fail("외부 VOD의 실제 player clock을 증명하지 못했습니다.", code);
    }
  };
  const initialClockDirectory = path.join(
    stateDirectory,
    `clock-probe-${randomBytes(16).toString("hex")}`
  );
  await mkdir(initialClockDirectory, { mode: 0o700 });
  let singlePartClockResolution: ExternalVodClockProofSetResolution | undefined;
  let sourceClockResolution: ExternalVodSourceClockResolution;
  try {
    if (rawMetadata.platform === "SOOP") {
      sourceClockResolution = resolveWholeSourceClock({
        metadata: rawMetadata,
        soopSourceClockIdentity: sourceClockIdentity!
      });
    } else {
      singlePartClockResolution = await resolveClockParts(
        rawMetadata,
        rawMetadata.parts,
        initialClockDirectory
      );
      sourceClockResolution = resolveWholeSourceClock({
        metadata: rawMetadata,
        acquisitionClockProofSet: singlePartClockResolution.persisted
      });
    }
  } finally {
    await rm(initialClockDirectory, { recursive: true, force: true });
  }
  const metadata = metadataWithVerifiedSourceClock(
    rawMetadata,
    sourceClockResolution
  );
  normalizeClipRanges(publicClips, metadata.durationMs);
  emitProgress(request.onProgress, {
    phase: "planning",
    completedSections: 0,
    totalSections: 0,
    completedBytes: 0
  });
  const plan = planExternalVodSections(
    metadata,
    publicClips,
    handleMs,
    request.editableRanges
  );
  const plannedPartIndexes = new Set(plan.sections.map((section) => (
    section.partIndex
  )));
  const plannedRawParts = rawMetadata.parts.filter((_part, index) => (
    plannedPartIndexes.has(index)
  ));
  if (plannedRawParts.length !== plannedPartIndexes.size) {
    fail("편집 계획이 참조하는 원본 VOD 파트를 찾지 못했습니다.", "INVALID_CLOCK_PROOF");
  }
  let clockProofResolution = singlePartClockResolution;
  if (!clockProofResolution) {
    const plannedClockDirectory = path.join(
      stateDirectory,
      `clock-probe-${randomBytes(16).toString("hex")}`
    );
    await mkdir(plannedClockDirectory, { mode: 0o700 });
    try {
      clockProofResolution = await resolveClockParts(
        rawMetadata,
        plannedRawParts,
        plannedClockDirectory
      );
    } finally {
      await rm(plannedClockDirectory, { recursive: true, force: true });
    }
  }
  const acquisitionClockProofSet = parseExternalVodPersistedClockProofSet(
    clockProofResolution.persisted
  );
  if (acquisitionClockProofSet.sourceDurationMs !== metadata.durationMs) {
    fail("취득 시간축 증명과 전체 player clock 길이가 다릅니다.", "CLOCK_PROOF_MISMATCH");
  }
  const sourceClockProof = parseExternalVodSourceClockProof(
    sourceClockResolution.proof
  );
  assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
    sourceClockProof,
    acquisitionClockProofSet
  );
  const planFingerprint = externalVodPlanFingerprint({
    metadata,
    clips: publicClips,
    plan,
    handleMs,
    acquisitionClockProofSetId: acquisitionClockProofSet.proofSetId,
    ...(sourceClockProof.browserClockIdentitySha256
      ? {
        sourceClockIdentitySha256:
          sourceClockProof.browserClockIdentitySha256
      }
      : {})
  });
  const materializationId = planFingerprint.slice(0, 32);
  const jobDirectory = scopedExternalVodJobDirectory({
    stateDirectory,
    consumerScopeHash,
    platform: metadata.platform,
    materializationId
  });
  const receiptPath = path.join(jobDirectory, "manifest.json");
  await ensurePrivateDirectory(jobDirectory);
  const reusable = await reusableExternalVodReceipt({
    receiptPath,
    jobDirectory,
    expectedCanonicalUrl: metadata.canonicalUrl,
    expectedContentId: metadata.contentId,
    expectedSourceVersionId: metadata.sourceVersionId,
    expectedSourceClockProofId: sourceClockProof.sourceClockProofId,
    expectedAcquisitionClockProofSetId: acquisitionClockProofSet.proofSetId,
    ...(expectedBrowserClockIdentitySha256
      ? { expectedBrowserClockIdentitySha256 }
      : {}),
    expectedPlanFingerprint: planFingerprint,
    expectedHandleMs: handleMs,
    expectedClips: publicClips,
    ...(hashFile ? { hashFile } : {}),
    ...(request.signal ? { signal: request.signal } : {})
  });
  if (reusable) {
    emitProgress(request.onProgress, {
      phase: "completed",
      completedSections: plan.sections.length,
      totalSections: plan.sections.length,
      completedBytes: reusable.receipt.artifact.sizeBytes
    });
    return {
      manifest: reusable.receipt.manifest,
      receipt: reusable.receipt,
      artifactPath: reusable.artifactPath,
      reused: true
    };
  }

  const baseReference = normalizedExternalResumeReference(request.base, source);
  if (request.base !== undefined && !baseReference) {
    fail("hot-load 기준 재료 식별자가 올바르지 않습니다.", "INVALID_BASE_MATERIALIZATION");
  }
  let baseMaterialization: Awaited<ReturnType<typeof reusableExternalVodReceipt>>;
  if (baseReference) {
    const baseJobDirectory = scopedExternalVodJobDirectory({
      stateDirectory,
      consumerScopeHash,
      platform: source.platform,
      materializationId: baseReference.materializationId
    });
    baseMaterialization = await reusableExternalVodReceipt({
      receiptPath: path.join(baseJobDirectory, "manifest.json"),
      jobDirectory: baseJobDirectory,
      expectedCanonicalUrl: metadata.canonicalUrl,
      expectedContentId: metadata.contentId,
      expectedSourceVersionId: metadata.sourceVersionId,
      expectedSourceClockProofId: sourceClockProof.sourceClockProofId,
      expectedPlanFingerprint: baseReference.planFingerprint,
      expectedHandleMs: handleMs,
      expectedClips: publicClips,
      allowExpectedClipSuperset: true,
      ...(expectedBrowserClockIdentitySha256
        ? { expectedBrowserClockIdentitySha256 }
        : {}),
      ...(hashFile ? { hashFile } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    if (!baseMaterialization) {
      fail(
        "hot-load 기준 로컬 재료의 버전·해시·receipt를 검증하지 못했습니다.",
        "INVALID_BASE_MATERIALIZATION"
      );
    }
    assertMonotonicBaseCoverage(baseMaterialization.receipt, plan.clipRanges);
  }

  await assertExternalDiskHeadroom(
    jobDirectory,
    plannedExternalVodDurationMs(plan),
    dependencies.statFileSystem ?? statFileSystem
  );
  const attemptsDirectory = path.join(jobDirectory, "attempts");
  await ensurePrivateDirectory(attemptsDirectory);
  const attemptDirectory = path.join(
    attemptsDirectory,
    process.platform === "win32"
      ? `.a-${randomBytes(16).toString("hex")}`
      : `attempt-${randomBytes(16).toString("hex")}`
  );
  await mkdir(attemptDirectory, { mode: 0o700 });
  const concatListPath = path.join(attemptDirectory, "sections.concat.txt");
  const temporaryArtifactPath = path.join(
    attemptDirectory,
    "materialized.tmp.mp4"
  );
  let sectionFiles: string[] = [];
  try {
    const afterLockReusable = await reusableExternalVodReceipt({
      receiptPath,
      jobDirectory,
      expectedCanonicalUrl: metadata.canonicalUrl,
      expectedContentId: metadata.contentId,
      expectedSourceVersionId: metadata.sourceVersionId,
      expectedSourceClockProofId: sourceClockProof.sourceClockProofId,
      expectedAcquisitionClockProofSetId: acquisitionClockProofSet.proofSetId,
      expectedPlanFingerprint: planFingerprint,
      expectedHandleMs: handleMs,
      expectedClips: publicClips,
      ...(expectedBrowserClockIdentitySha256
        ? { expectedBrowserClockIdentitySha256 }
        : {}),
      ...(hashFile ? { hashFile } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    if (afterLockReusable) {
      return {
        manifest: afterLockReusable.receipt.manifest,
        receipt: afterLockReusable.receipt,
        artifactPath: afterLockReusable.artifactPath,
        reused: true
      };
    }

    const windows = materializationWindows(plan.windows);
    const mediaDurationMs = windows.at(-1)?.mediaEndMs ?? 0;
    if (mediaDurationMs <= 0) {
      fail("외부 VOD 로컬 시간축을 만들지 못했습니다.", "MANIFEST_INVALID");
    }
    const localOptions: ExternalProcessRunOptions = {
      ...processOptions(
        attemptDirectory,
        processEnv,
        request.signal,
        externalMediaPhaseTimeoutMs(mediaDurationMs)
      ),
      workingDirectoryByteLimit: MAX_EXTERNAL_VOD_WORK_BYTES,
      minimumAvailableDiskBytes: MIN_EXTERNAL_VOD_DISK_HEADROOM_BYTES
    };

    const sourceRoots: ExternalVodSourceRootReceipt[] = [];
    const sourceRootPaths = new Map<string, string>();
    if (baseMaterialization) {
      for (const root of baseMaterialization.receipt.sourceRoots) {
        const rootPath = baseMaterialization.sourceRootPaths.get(root.id);
        if (!rootPath) {
          fail("기존 원본 조각 경로를 찾지 못했습니다.", "CACHE_INTEGRITY_FAILED");
        }
        assertRootClockEvidenceMatchesProofSet(root, acquisitionClockProofSet);
        await verifyReusableRootMedia({
          root,
          rootPath,
          inspectMedia,
          options: localOptions
        });
      }
      const inheritedPaths = await inheritExternalSourceRoots({
        roots: baseMaterialization.receipt.sourceRoots,
        sourcePaths: baseMaterialization.sourceRootPaths,
        jobDirectory,
        stagingDirectory: attemptDirectory,
        ...(request.signal ? { signal: request.signal } : {})
      });
      sourceRoots.push(
        ...baseMaterialization.receipt.sourceRoots.map((root) => ({ ...root }))
      );
      for (const [id, rootPath] of inheritedPaths) {
        sourceRootPaths.set(id, rootPath);
      }
    }

    const partial = await loadPartialSourceRoots({
      jobDirectory,
      metadata,
      planFingerprint,
      acquisitionClockProofSet,
      plan,
      inspectMedia,
      options: localOptions,
      ...(hashFile ? { hashFile } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    const usablePartialRoots = partial.roots.filter((root) => (
      !sourceRoots.some((existing) => (
        existing.partIndex === root.partIndex
        && existing.sourceStartMs < root.sourceEndMs
        && root.sourceStartMs < existing.sourceEndMs
      ))
    ));
    sourceRoots.push(...usablePartialRoots.map((root) => ({ ...root })));
    for (const root of usablePartialRoots) {
      const rootPath = partial.paths.get(root.id);
      if (rootPath) {
        sourceRootPaths.set(root.id, rootPath);
      }
    }

    const missingSections = missingExternalVodSections(plan, sourceRoots);
    const checkpointRoots = usablePartialRoots.map((root) => ({ ...root }));
    const acquired = missingSections.length > 0
      ? await acquireExternalSections({
        metadata,
        sections: missingSections,
        clockProofSet: acquisitionClockProofSet,
        partRuntimes: clockProofResolution.runtime.parts,
        jobDirectory: attemptDirectory,
        runProcess,
        inspectMedia,
        processEnv,
        ffmpegBinary,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
        onSectionReady: async ({
          section,
          filePath,
          streamSignature,
          clockEvidence
        }) => {
          const publishedRoot = await publishExternalSourceRoot({
            sourcePath: filePath,
            section,
            streamSignature,
            clockEvidence,
            jobDirectory,
            stagingDirectory: attemptDirectory,
            ...(request.signal ? { signal: request.signal } : {})
          });
          sourceRoots.push(publishedRoot.receipt);
          sourceRootPaths.set(publishedRoot.receipt.id, publishedRoot.path);
          checkpointRoots.push(publishedRoot.receipt);
          await writePartialSourceRoots({
            jobDirectory,
            metadata,
            planFingerprint,
            acquisitionClockProofSet,
            roots: checkpointRoots,
            now
          });
        }
      })
      : undefined;
    sectionFiles = acquired?.files ?? [];
    emitProgress(request.onProgress, {
      phase: "verifying",
      completedSections: sectionFiles.length,
      totalSections: missingSections.length,
      completedBytes: acquired?.bytes ?? 0
    });
    const completionRawMetadata = await probeExternalVodMetadata(source, {
      runProcess,
      ytDlpBinary,
      ytDlpMode,
      ...(pythonBinary === undefined ? {} : { pythonBinary }),
      nodeBinary,
      processEnv,
      cwd: attemptDirectory,
      ...(request.signal ? { signal: request.signal } : {})
    });
    const completionSourceClockIdentity = metadataSoopSourceClockIdentity(
      completionRawMetadata,
      legacySourceClockIdentity
    );
    if (
      source.platform === "SOOP"
      && (
        !sourceClockIdentity
        || !completionSourceClockIdentity
        || !sameSoopVodSourceClockIdentity(
          sourceClockIdentity,
          completionSourceClockIdentity
        )
      )
    ) {
      fail(
        "선택 구간을 받는 동안 SOOP 공식 root·entries 시간축이 바뀌었습니다.",
        "SOURCE_CHANGED"
      );
    }
    if (completionRawMetadata.sourceVersionId !== rawMetadata.sourceVersionId) {
      fail(
        "선택 구간을 받는 동안 원본 VOD의 버전 또는 파트 구성이 바뀌었습니다.",
        "SOURCE_CHANGED"
      );
    }
    const completionParts = completionRawMetadata.parts.filter((_part, index) => (
      plannedPartIndexes.has(index)
    ));
    const completionClockResolution = await resolveClockParts(
      completionRawMetadata,
      completionParts,
      attemptDirectory
    );
    assertExternalVodClockProofSetUnchanged(
      acquisitionClockProofSet,
      completionClockResolution.persisted,
      {
        expectedRuntimeParts: clockProofResolution.runtime.parts,
        actualRuntimeParts: completionClockResolution.runtime.parts
      }
    );
    const completionSourceClock = completionRawMetadata.platform === "SOOP"
      ? resolveWholeSourceClock({
        metadata: completionRawMetadata,
        soopSourceClockIdentity: completionSourceClockIdentity!
      })
      : resolveWholeSourceClock({
        metadata: completionRawMetadata,
        acquisitionClockProofSet: completionClockResolution.persisted
      });
    assertExternalVodSourceClockProofUnchanged(
      sourceClockProof,
      completionSourceClock.proof
    );
    const completionMetadata = metadataWithVerifiedSourceClock(
      completionRawMetadata,
      completionSourceClock
    );
    if (completionMetadata.sourceVersionId !== metadata.sourceVersionId) {
      fail(
        "선택 구간을 받는 동안 원본 VOD 전체 player clock이 바뀌었습니다.",
        "SOURCE_CHANGED"
      );
    }
    const orderedRoots = orderedRootsForPlan(plan, sourceRoots);
    const rootStreamSignature = orderedRoots[0]?.streamSignature;
    if (!rootStreamSignature) {
      fail("병합할 원본 조각 스트림이 없습니다.", "MEDIA_STREAM_MISMATCH");
    }
    for (const root of orderedRoots.slice(1)) {
      assertCompatibleSectionStreams(rootStreamSignature, root.streamSignature);
    }
    const concatFiles: string[] = [];
    const packetCopySignatures: Array<string | undefined> = [];
    for (const [index, root] of orderedRoots.entries()) {
      const rootPath = sourceRootPaths.get(root.id);
      if (!rootPath) {
        fail("병합할 원본 조각 경로가 없습니다.", "CACHE_INTEGRITY_FAILED");
      }
      const concatPath = path.join(
        attemptDirectory,
        `concat-${String(index + 1).padStart(4, "0")}.mp4`
      );
      await inheritVerifiedRootFile({
        sourcePath: rootPath,
        destinationPath: concatPath,
        stagingDirectory: attemptDirectory,
        expectedHash: root.hashSha256,
        expectedSize: root.sizeBytes,
        ...(request.signal ? { signal: request.signal } : {})
      });
      concatFiles.push(concatPath);
      if (inspectPacketCopyMedia) {
        const inspection = await inspectPacketCopyMedia(concatPath, localOptions);
        assertExternalSectionCoverage(
          inspection,
          root.durationMs,
          "최종 병합 직전 원본 조각의 실제 길이가 receipt와 다릅니다.",
          "CACHE_INTEGRITY_FAILED"
        );
        assertCompatibleSectionStreams(
          root.streamSignature,
          externalSectionStreamSignature(inspection)
        );
        packetCopySignatures.push(inspection.packetCopySignature);
      }
    }
    const packetCopy = packetCopySignatures.length === concatFiles.length
      && compatibleExternalPacketCopySignatures(packetCopySignatures);
    await writeFile(concatListPath, concatDescription(concatFiles), {
      encoding: "utf8",
      mode: 0o600
    });
    emitProgress(request.onProgress, {
      phase: "muxing",
      completedSections: missingSections.length,
      totalSections: plan.sections.length,
      completedBytes: acquired?.bytes ?? 0
    });
    await checkedProcess(
      runProcess,
      ffmpegBinary,
      buildExternalConcatArgs({
        concatListPath,
        outputPath: temporaryArtifactPath,
        durationMs: mediaDurationMs,
        packetCopy
      }),
      localOptions,
      "MEDIA_MUX_FAILED",
      "정밀 취득한 외부 VOD 구간을 로컬 MP4로 병합하지 못했습니다."
    );
    const temporaryArtifactSize = await assertSafeRegularFile(
      temporaryArtifactPath,
      attemptDirectory
    );
    assertExternalMaterializationByteQuota(
      acquired?.bytes ?? 0,
      temporaryArtifactSize
    );
    const finalInspection = await inspectMedia(
      temporaryArtifactPath,
      localOptions
    );
    if (
      Math.abs(finalInspection.durationMs - mediaDurationMs)
        > MAX_SECTION_DURATION_DRIFT_MS
    ) {
      fail("최종 로컬 MP4 길이가 선택 구간 시간축과 다릅니다.", "MEDIA_VERIFICATION_FAILED");
    }
    const finalStreamSignature = externalSectionStreamSignature(finalInspection);
    assertCompatibleSectionStreams(
      rootStreamSignature,
      finalStreamSignature
    );
    const published = await publishExternalVodArtifact({
      sourcePath: temporaryArtifactPath,
      jobDirectory,
      sizeBytes: temporaryArtifactSize,
      ...(hashFile ? { hashFile } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    const artifactPath = published.artifactPath;
    let publishedInspection: ExternalMediaInspection;
    try {
      // The preliminary ffprobe guarded the mux output before publication.
      // Keep the published file open and make ffprobe read that exact fd, so
      // pathname ABA swaps cannot substitute different semantic bytes.
      publishedInspection = await inspectPublishedExternalVodArtifact(
        published,
        inspectMedia,
        localOptions,
        request.signal
      );
      if (
        Math.abs(publishedInspection.durationMs - mediaDurationMs)
          > MAX_SECTION_DURATION_DRIFT_MS
      ) {
        fail(
          "게시된 로컬 MP4 길이가 선택 구간 시간축과 다릅니다.",
          "MEDIA_VERIFICATION_FAILED"
        );
      }
      const publishedStreamSignature = externalSectionStreamSignature(
        publishedInspection
      );
      assertCompatibleSectionStreams(
        rootStreamSignature,
        publishedStreamSignature
      );
    } catch (error) {
      await removeCreatedArtifactIfIdentityMatches(published);
      throw error;
    }
    let manifest: ChzzkVodMaterialization;
    let receipt: ExternalVodCacheReceipt;
    try {
      const preparedDate = now();
      if (!Number.isFinite(preparedDate.getTime())) {
        fail("로컬 VOD 준비 시각을 만들지 못했습니다.", "MANIFEST_INVALID");
      }
      const preparedAt = preparedDate.toISOString();
      manifest = createExternalManifest({
        metadata,
        planFingerprint,
        handleMs,
        clipRanges: plan.clipRanges,
        windows,
        preparedAt
      });
      receipt = {
        schemaId: EXTERNAL_VOD_CACHE_SCHEMA,
        canonicalUrl: metadata.canonicalUrl,
        sourceVersionId: metadata.sourceVersionId,
        sourceClockProof,
        acquisitionClockProofSet,
        manifest,
        clips: receiptClips(publicClips),
        acquiredSections: acquiredSectionReceipts(plan.sections),
        sourceRoots: sourceRoots
          .map((root) => ({
            ...root,
            streamSignature: { ...root.streamSignature }
          }))
          .sort((left, right) => (
            left.sourceStartMs - right.sourceStartMs
            || left.sourceEndMs - right.sourceEndMs
            || left.id.localeCompare(right.id)
          )),
        artifact: {
          name: `${metadata.platform.toLowerCase()}-selected-ranges.mp4`,
          type: "video/mp4",
          hashSha256: published.hashSha256,
          sizeBytes: published.sizeBytes,
          durationMs: publishedInspection.durationMs,
          cacheFileName: published.cacheFileName
        },
        preparedAt
      };
      secretFreeReceipt(receipt);
      await atomicWriteJson(receiptPath, receipt);
    } catch (error) {
      await removeFailedPublishedArtifactUnlessReferenced({
        receiptPath,
        published
      });
      throw error;
    }
    await rm(path.join(jobDirectory, "partial-roots.json"), { force: true });
    emitProgress(request.onProgress, {
      phase: "completed",
      completedSections: plan.sections.length,
      totalSections: plan.sections.length,
      completedBytes: published.sizeBytes
    });
    return {
      manifest,
      receipt,
      artifactPath,
      reused: false
    };
  } finally {
    // Only this invocation's private workspace is removed. It includes known
    // yt-dlp .part files and outputs that failed lstat/ffprobe validation.
    await rm(attemptDirectory, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
