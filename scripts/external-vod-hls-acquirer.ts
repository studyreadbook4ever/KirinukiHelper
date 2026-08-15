/**
 * Strict acquisition for an already-resolved, finite fMP4 HLS media playlist.
 *
 * The caller owns playlist parsing and the platform-specific redirect allowlist.
 * This module owns the exact EXTINF/player-clock to local-media conversion. Raw
 * playlist and media URLs are deliberately excluded from returned evidence.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export const EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA =
  "chzzk-kirinuki/external-vod-hls-section-clock-v1";
export const EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA =
  "chzzk-kirinuki/external-vod-hls-persisted-clock-v3";
export const MAX_EXTERNAL_VOD_HLS_INIT_BYTES = 32 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_HLS_FRAGMENT_BYTES = 256 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_HLS_SECTION_BYTES = 64 * 1024 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_HLS_SEGMENTS = 20_000;
export const MAX_EXTERNAL_VOD_HLS_SECTION_MS = 6 * 60 * 60 * 1_000;
export const DEFAULT_EXTERNAL_VOD_HLS_DURATION_TOLERANCE_MS = 250;
/**
 * A finite HLS presentation may legitimately begin with one track before the
 * other. CHZZK live-rewind VODs have been observed with audio at player time
 * zero and the first video sample about one second later. Preserve that real
 * leading gap instead of shifting the video clock, while keeping the bound far
 * below the historical ten-second offset this pipeline must reject.
 */
export const MAX_EXTERNAL_VOD_HLS_STREAM_EDGE_TOLERANCE_MS = 1_250;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_SECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const MAX_RUNTIME_URL_LENGTH = 16 * 1024;

export interface ExternalVodHlsMapResource {
  uri: string;
  /** Stable, credential-free locator emitted by the playlist parser. */
  semanticUri?: string;
}

export interface ExternalVodHlsTimelineSegment {
  sequence: number;
  startUs: number;
  durationUs: number;
  uri: string;
  /** Stable, credential-free locator emitted by the playlist parser. */
  semanticUri?: string;
  /** Optional authority supplied by a resolver that previously fetched bytes. */
  expectedSha256?: string;
}

/**
 * A media-playlist snapshot. The resolver must already have rejected KEY,
 * BYTERANGE, DISCONTINUITY, GAP and changing EXT-X-MAP state.
 */
export interface ExternalVodHlsTimeline {
  playlistUri: string;
  /** Stable, credential-free playlist locator; preferred over URL fallback. */
  playlistSemanticUri?: string;
  playlistFingerprintSha256: string;
  renditionFingerprintSha256: string;
  durationUs: number;
  hasEndList: true;
  hasIndependentSegments: true;
  map: ExternalVodHlsMapResource;
  segments: readonly ExternalVodHlsTimelineSegment[];
}

export type ExternalVodHlsResourceKind = "init" | "fragment";

export interface ExternalVodHlsFetchRequest {
  url: URL;
  kind: ExternalVodHlsResourceKind;
  maximumBytes: number;
  signal?: AbortSignal;
}

export interface ExternalVodHlsFetchedResource {
  bytes: Uint8Array;
  /** The validated final URL after manual, bounded redirect handling. */
  finalUrl: string;
}

export interface ExternalVodHlsProcessOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ExternalVodHlsProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExternalVodHlsStreamTimeline {
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface ExternalVodHlsOutputInspection {
  durationMs: number;
  video: ExternalVodHlsStreamTimeline;
  audio?: ExternalVodHlsStreamTimeline;
}

export interface ExternalVodHlsAcquirerDependencies {
  /**
   * Must enforce the platform allowlist for the initial URL, every redirect,
   * and the final response, while stopping at `maximumBytes` during streaming.
   */
  fetchValidatedBinary: (
    request: ExternalVodHlsFetchRequest
  ) => Promise<ExternalVodHlsFetchedResource>;
  /** Called for both the playlist/resource URL and every returned final URL. */
  assertAllowedUrl: (
    url: URL,
    kind: "playlist" | ExternalVodHlsResourceKind
  ) => void;
  runProcess: (
    command: string,
    args: readonly string[],
    options: ExternalVodHlsProcessOptions
  ) => Promise<ExternalVodHlsProcessResult>;
  inspectOutput: (
    filePath: string,
    options: ExternalVodHlsProcessOptions
  ) => Promise<ExternalVodHlsOutputInspection>;
  ffmpegBinary: string;
}

export interface AcquireExternalVodHlsSectionRequest {
  sectionId: string;
  /** Exact selected-part proof that authorized this acquisition. */
  partProofId: string;
  /** Exact HLS player-clock proof embedded in `partProofId`. */
  clockProofId: string;
  /** Player/playlist cumulative clock, not raw fMP4 PTS. */
  sourceStartMs: number;
  /** Player/playlist cumulative clock, not raw fMP4 PTS. */
  sourceEndMs: number;
  timeline: ExternalVodHlsTimeline;
  /** Private job directory. `outputPath` must remain below this directory. */
  workDirectory: string;
  outputPath: string;
  signal?: AbortSignal;
  processTimeoutMs?: number;
  durationToleranceMs?: number;
  requireAudio?: boolean;
}

export interface ExternalVodHlsAcquiredResourceEvidence {
  semanticUriSha256: string;
  contentSha256: string;
  sizeBytes: number;
}

export interface ExternalVodHlsAcquiredSegmentEvidence
  extends ExternalVodHlsAcquiredResourceEvidence {
  sequence: number;
  playerStartUs: number;
  durationUs: number;
}

export interface ExternalVodHlsSectionClockEvidence {
  schemaId: typeof EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA;
  evidenceId: string;
  sectionId: string;
  playlistFingerprintSha256: string;
  renditionFingerprintSha256: string;
  resourceSetFingerprintSha256: string;
  sourceStartUs: number;
  sourceEndUs: number;
  firstSegmentPlayerStartUs: number;
  firstSegmentOffsetUs: number;
  mapping: {
    sourceAnchorUs: number;
    outputAnchorUs: 0;
    rateNumerator: 1;
    rateDenominator: 1;
  };
  init: ExternalVodHlsAcquiredResourceEvidence;
  segments: readonly ExternalVodHlsAcquiredSegmentEvidence[];
  output: {
    durationMs: number;
    sizeBytes: number;
    contentSha256: string;
  };
}

export interface AcquireExternalVodHlsSectionResult {
  outputPath: string;
  inspection: ExternalVodHlsOutputInspection;
  /** Detailed, in-memory acquisition diagnostics. Do not put this in receipts. */
  evidence: ExternalVodHlsSectionClockEvidence;
  /** Bounded-size proof intended for v3 receipts and offline cache reopening. */
  persistedEvidence: ExternalVodHlsPersistedClockEvidence;
}

export interface ExternalVodHlsSegmentEdgeEvidence
  extends ExternalVodHlsAcquiredResourceEvidence {
  sequence: number;
  playerStartUs: number;
  durationUs: number;
}

export interface ExternalVodHlsPersistedClockEvidence {
  schemaId: typeof EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA;
  evidenceId: string;
  sectionId: string;
  partProofId: string;
  clockProofId: string;
  playlistFingerprintSha256: string;
  renditionFingerprintSha256: string;
  resourceSetFingerprintSha256: string;
  sourceStartUs: number;
  sourceEndUs: number;
  firstSegmentPlayerStartUs: number;
  firstSegmentOffsetUs: number;
  mapping: ExternalVodHlsSectionClockEvidence["mapping"];
  init: ExternalVodHlsAcquiredResourceEvidence;
  segmentCount: number;
  /**
   * The immediately preceding media fragment, fetched only as a byte-generation
   * anchor. It is null exactly when the selected first fragment starts at zero.
   * This makes adjacent exact-boundary hot-load roots share a content-addressed
   * sequence even though neither selected range overlaps the other.
   */
  precedingSegment: ExternalVodHlsSegmentEdgeEvidence | null;
  firstSegment: ExternalVodHlsSegmentEdgeEvidence;
  lastSegment: ExternalVodHlsSegmentEdgeEvidence;
  segmentTimelineSha256: string;
  fetchedResourcesSha256: string;
  output: ExternalVodHlsSectionClockEvidence["output"];
}

export interface ExternalVodHlsPersistedClockBinding {
  partProofId: string;
  clockProofId: string;
  precedingSegment: ExternalVodHlsSegmentEdgeEvidence | null;
}

export interface SelectedExternalVodHlsSegmentRange {
  segments: readonly ExternalVodHlsTimelineSegment[];
  sourceStartUs: number;
  sourceEndUs: number;
  firstSegmentOffsetUs: number;
}

export class ExternalVodHlsAcquisitionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodHlsAcquisitionError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodHlsAcquisitionError(message, code);
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("HLS 구간 준비가 취소되었습니다.", "ABORTED");
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, "INVALID_HLS_TIMELINE");
  }
}

function runtimeUrl(raw: string): URL {
  if (
    typeof raw !== "string"
    || raw.length === 0
    || raw.length > MAX_RUNTIME_URL_LENGTH
    || raw.trim() !== raw
    || /[\0\r\n]/u.test(raw)
  ) {
    fail("HLS 리소스 주소가 올바르지 않습니다.", "UNSAFE_HLS_URL");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("HLS 리소스 주소가 올바르지 않습니다.", "UNSAFE_HLS_URL");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
  ) {
    fail("HLS 리소스 주소가 안전하지 않습니다.", "UNSAFE_HLS_URL");
  }
  return url;
}

function semanticResourceIdentity(uri: string, semanticUri?: string): string {
  if (semanticUri !== undefined) {
    if (
      semanticUri.length === 0
      || semanticUri.length > MAX_RUNTIME_URL_LENGTH
      || semanticUri.trim() !== semanticUri
      || /[\0\r\n]/u.test(semanticUri)
    ) {
      fail("HLS 의미 리소스 주소가 올바르지 않습니다.", "INVALID_HLS_TIMELINE");
    }
    return semanticUri;
  }
  const url = runtimeUrl(uri);
  // Volatile signatures normally live in the query. Content SHA-256 below
  // remains authoritative if two URL variants ever return different bytes.
  // Akamai's CHZZK `hdntl=...` credential is a path segment, not a query, so
  // redact every known credential-shaped path segment before hashing.
  const redactedPath = url.pathname.split("/").map((segment) => (
    /^(?:hdntl|hdnts|token|auth|signature|sig|expires?)=/iu.test(segment)
      ? `${segment.slice(0, segment.indexOf("=") + 1)}<redacted>`
      : segment
  )).join("/");
  return `${url.protocol}//${url.host}${redactedPath}`;
}

type ExternalVodHlsPlaylistFingerprintTimeline = Pick<
  ExternalVodHlsTimeline,
  "playlistUri" | "playlistSemanticUri" | "durationUs" | "map" | "segments"
>;

/** Recomputes the content address for the canonical finite-HLS timeline. */
export function externalVodHlsPlaylistFingerprintSha256(
  timeline: ExternalVodHlsPlaylistFingerprintTimeline
): string {
  const firstSegment = timeline.segments[0];
  if (!firstSegment) {
    fail("HLS 재생목록 지문에 세그먼트가 없습니다.", "INVALID_HLS_TIMELINE");
  }
  return sha256(stableJson({
    version: 1,
    playlistSemanticIdentity: semanticResourceIdentity(
      timeline.playlistUri,
      timeline.playlistSemanticUri
    ),
    mediaSequence: firstSegment.sequence,
    durationUs: timeline.durationUs,
    mapSemanticUri: semanticResourceIdentity(
      timeline.map.uri,
      timeline.map.semanticUri
    ),
    segments: timeline.segments.map((segment) => ({
      sequence: segment.sequence,
      startUs: segment.startUs,
      durationUs: segment.durationUs,
      semanticUri: semanticResourceIdentity(segment.uri, segment.semanticUri)
    }))
  }));
}

function callUrlGuard(
  guard: ExternalVodHlsAcquirerDependencies["assertAllowedUrl"],
  url: URL,
  kind: "playlist" | ExternalVodHlsResourceKind
): void {
  try {
    guard(url, kind);
  } catch (error) {
    if (error instanceof ExternalVodHlsAcquisitionError) {
      throw error;
    }
    fail("HLS 리소스가 허용된 미디어 호스트에 있지 않습니다.", "UNSAFE_HLS_URL");
  }
}

function checkedSafeInteger(
  value: number,
  { minimum, maximum, label }: {
    minimum: number;
    maximum: number;
    label: string;
  }
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_HLS_TIMELINE");
  }
  return value;
}

function timelineResourceFingerprint(timeline: ExternalVodHlsTimeline): string {
  return sha256(JSON.stringify({
    playlistUrlIdentitySha256: sha256(semanticResourceIdentity(
      timeline.playlistUri,
      timeline.playlistSemanticUri
    )),
    initUrlIdentitySha256: sha256(semanticResourceIdentity(
      timeline.map.uri,
      timeline.map.semanticUri
    )),
    segments: timeline.segments.map((segment) => ({
      sequence: segment.sequence,
      startUs: segment.startUs,
      durationUs: segment.durationUs,
      semanticUriSha256: sha256(semanticResourceIdentity(
        segment.uri,
        segment.semanticUri
      )),
      expectedSha256: segment.expectedSha256 ?? null
    }))
  }));
}

/** Volatile, in-memory-only guard against mutation during one acquisition. */
function timelineRuntimeFingerprint(timeline: ExternalVodHlsTimeline): string {
  return sha256(JSON.stringify({
    playlistUri: timeline.playlistUri,
    mapUri: timeline.map.uri,
    segments: timeline.segments.map((segment) => ({
      sequence: segment.sequence,
      uri: segment.uri
    }))
  }));
}

function snapshotTimeline(
  timeline: ExternalVodHlsTimeline,
  dependencies: Pick<ExternalVodHlsAcquirerDependencies, "assertAllowedUrl">
): ExternalVodHlsTimeline {
  if (
    timeline.hasEndList !== true
    || timeline.hasIndependentSegments !== true
    || !Array.isArray(timeline.segments)
    || timeline.segments.length === 0
    || timeline.segments.length > MAX_EXTERNAL_VOD_HLS_SEGMENTS
  ) {
    fail(
      "종료·독립 세그먼트가 증명된 유한 HLS 재생목록이 필요합니다.",
      "INVALID_HLS_TIMELINE"
    );
  }
  assertSha256(timeline.playlistFingerprintSha256, "HLS 재생목록");
  assertSha256(timeline.renditionFingerprintSha256, "HLS rendition");
  const durationUs = checkedSafeInteger(timeline.durationUs, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
    label: "HLS 전체 길이"
  });
  const playlistUrl = runtimeUrl(timeline.playlistUri);
  const playlistSemanticUri = timeline.playlistSemanticUri === undefined
    ? undefined
    : semanticResourceIdentity(playlistUrl.href, timeline.playlistSemanticUri);
  const initUrl = runtimeUrl(timeline.map.uri);
  const initSemanticUri = timeline.map.semanticUri === undefined
    ? undefined
    : semanticResourceIdentity(initUrl.href, timeline.map.semanticUri);
  callUrlGuard(dependencies.assertAllowedUrl, playlistUrl, "playlist");
  callUrlGuard(dependencies.assertAllowedUrl, initUrl, "init");

  const copiedSegments: ExternalVodHlsTimelineSegment[] = [];
  const seenUris = new Set<string>();
  let expectedStartUs = 0;
  let previousSequence: number | undefined;
  for (const segment of timeline.segments) {
    const sequence = checkedSafeInteger(segment.sequence, {
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      label: "HLS 미디어 순번"
    });
    const startUs = checkedSafeInteger(segment.startUs, {
      minimum: 0,
      maximum: durationUs,
      label: "HLS 세그먼트 시작"
    });
    const duration = checkedSafeInteger(segment.durationUs, {
      minimum: 1,
      maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000,
      label: "HLS 세그먼트 길이"
    });
    if (
      startUs !== expectedStartUs
      || (previousSequence !== undefined && sequence !== previousSequence + 1)
      || startUs + duration > durationUs
    ) {
      fail(
        "HLS 세그먼트 시간축이 연속적이고 완전하지 않습니다.",
        "INVALID_HLS_TIMELINE"
      );
    }
    const segmentUrl = runtimeUrl(segment.uri);
    const segmentSemanticUri = segment.semanticUri === undefined
      ? undefined
      : semanticResourceIdentity(segmentUrl.href, segment.semanticUri);
    callUrlGuard(dependencies.assertAllowedUrl, segmentUrl, "fragment");
    if (seenUris.has(segmentUrl.href)) {
      fail(
        "바이트 범위 없는 HLS 세그먼트 주소가 중복되었습니다.",
        "INVALID_HLS_TIMELINE"
      );
    }
    seenUris.add(segmentUrl.href);
    if (segment.expectedSha256 !== undefined) {
      assertSha256(segment.expectedSha256, "HLS 세그먼트 콘텐츠");
    }
    copiedSegments.push({
      sequence,
      startUs,
      durationUs: duration,
      uri: segmentUrl.href,
      ...(segmentSemanticUri !== undefined
        ? { semanticUri: segmentSemanticUri }
        : {}),
      ...(segment.expectedSha256
        ? { expectedSha256: segment.expectedSha256 }
        : {})
    });
    expectedStartUs += duration;
    previousSequence = sequence;
  }
  if (expectedStartUs !== durationUs) {
    fail("HLS 전체 길이와 세그먼트 합이 다릅니다.", "INVALID_HLS_TIMELINE");
  }
  const normalized: ExternalVodHlsTimeline = {
    playlistUri: playlistUrl.href,
    ...(playlistSemanticUri !== undefined ? { playlistSemanticUri } : {}),
    playlistFingerprintSha256: timeline.playlistFingerprintSha256,
    renditionFingerprintSha256: timeline.renditionFingerprintSha256,
    durationUs,
    hasEndList: true,
    hasIndependentSegments: true,
    map: {
      uri: initUrl.href,
      ...(initSemanticUri !== undefined
        ? { semanticUri: initSemanticUri }
        : {})
    },
    segments: copiedSegments
  };
  if (
    externalVodHlsPlaylistFingerprintSha256(normalized)
    !== normalized.playlistFingerprintSha256
  ) {
    fail("HLS 재생목록 지문이 시간축 본문과 다릅니다.", "INVALID_HLS_TIMELINE");
  }
  return normalized;
}

export function selectExternalVodHlsSegmentRange(
  timeline: ExternalVodHlsTimeline,
  sourceStartMs: number,
  sourceEndMs: number
): SelectedExternalVodHlsSegmentRange {
  if (
    !Number.isSafeInteger(sourceStartMs)
    || sourceStartMs < 0
    || !Number.isSafeInteger(sourceEndMs)
    || sourceEndMs <= sourceStartMs
    || sourceEndMs - sourceStartMs > MAX_EXTERNAL_VOD_HLS_SECTION_MS
  ) {
    fail("HLS에서 준비할 원본 구간이 올바르지 않습니다.", "INVALID_SECTION");
  }
  const sourceStartUs = sourceStartMs * 1_000;
  const sourceEndUs = sourceEndMs * 1_000;
  if (
    !Number.isSafeInteger(sourceStartUs)
    || !Number.isSafeInteger(sourceEndUs)
    || sourceEndUs > timeline.durationUs
  ) {
    fail("HLS에서 준비할 원본 구간이 재생목록 범위를 벗어났습니다.", "INVALID_SECTION");
  }
  const segments = timeline.segments.filter((segment) => (
    segment.startUs + segment.durationUs > sourceStartUs
    && segment.startUs < sourceEndUs
  ));
  const first = segments[0];
  const last = segments.at(-1);
  if (
    !first
    || !last
    || first.startUs > sourceStartUs
    || last.startUs + last.durationUs < sourceEndUs
  ) {
    fail("HLS 세그먼트가 요청 구간을 완전히 덮지 않습니다.", "INVALID_SECTION");
  }
  return {
    segments,
    sourceStartUs,
    sourceEndUs,
    firstSegmentOffsetUs: sourceStartUs - first.startUs
  };
}

function formatSecondsFromUs(valueUs: number): string {
  if (!Number.isSafeInteger(valueUs) || valueUs < 0) {
    fail("FFmpeg에 전달할 시간이 올바르지 않습니다.", "INVALID_SECTION");
  }
  const whole = Math.floor(valueUs / 1_000_000);
  const fraction = String(valueUs % 1_000_000).padStart(6, "0");
  return `${whole}.${fraction}`;
}

export function buildExternalVodHlsConcatDescription(
  segments: readonly Pick<ExternalVodHlsTimelineSegment, "durationUs">[],
  platform: NodeJS.Platform | string = process.platform
): string {
  if (segments.length === 0 || segments.length > MAX_EXTERNAL_VOD_HLS_SEGMENTS) {
    fail("HLS 연결 목록에 세그먼트가 없습니다.", "INVALID_SECTION");
  }
  return `ffconcat version 1.0\n${segments.map((segment, index) => {
    if (!Number.isSafeInteger(segment.durationUs) || segment.durationUs <= 0) {
      fail("HLS 연결 목록의 시간이 올바르지 않습니다.", "INVALID_HLS_TIMELINE");
    }
    const fileName = externalVodHlsFragmentFileName(index, platform);
    return `file '${fileName}'\nduration ${formatSecondsFromUs(segment.durationUs)}`;
  }).join("\n")}\n`;
}

export function externalVodHlsFragmentFileName(
  zeroBasedIndex: number,
  platform: NodeJS.Platform | string = process.platform
): string {
  if (
    !Number.isSafeInteger(zeroBasedIndex)
    || zeroBasedIndex < 0
    || zeroBasedIndex >= MAX_EXTERNAL_VOD_HLS_SEGMENTS
  ) {
    fail("HLS 조각 파일 번호가 올바르지 않습니다.", "INVALID_SECTION");
  }
  const sequence = String(zeroBasedIndex + 1).padStart(6, "0");
  return platform === "win32"
    ? `f-${sequence}.mp4`
    : `fragment-${sequence}.mp4`;
}

export function buildExternalVodHlsTrimArgs({
  concatListPath,
  outputPath,
  firstSegmentOffsetUs,
  durationUs
}: {
  concatListPath: string;
  outputPath: string;
  firstSegmentOffsetUs: number;
  durationUs: number;
}): string[] {
  if (
    !Number.isSafeInteger(firstSegmentOffsetUs)
    || firstSegmentOffsetUs < 0
    || !Number.isSafeInteger(durationUs)
    || durationUs <= 0
  ) {
    fail("HLS 정밀 트리밍 시간이 올바르지 않습니다.", "INVALID_SECTION");
  }
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-n",
    "-fflags", "+genpts",
    "-f", "concat",
    "-safe", "1",
    "-i", path.resolve(concatListPath),
    "-ss", formatSecondsFromUs(firstSegmentOffsetUs),
    "-t", formatSecondsFromUs(durationUs),
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-sn",
    "-dn",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    "-f", "mp4",
    path.resolve(outputPath)
  ];
}

interface IsoBoxSummary {
  types: ReadonlySet<string>;
}

function inspectIsoBoxes(bytes: Uint8Array): IsoBoxSummary {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types = new Set<string>();
  let offset = 0;
  let boxes = 0;
  while (offset < buffer.byteLength) {
    if (buffer.byteLength - offset < 8 || boxes >= 100_000) {
      fail("fMP4 박스 경계가 올바르지 않습니다.", "INVALID_FMP4_FRAGMENT");
    }
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (!/^[\x20-\x7e]{4}$/u.test(type)) {
      fail("fMP4 박스 종류가 올바르지 않습니다.", "INVALID_FMP4_FRAGMENT");
    }
    let headerBytes = 8;
    let size: number;
    if (size32 === 1) {
      if (buffer.byteLength - offset < 16) {
        fail("fMP4 확장 박스 경계가 올바르지 않습니다.", "INVALID_FMP4_FRAGMENT");
      }
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
        fail("fMP4 박스가 안전 상한을 넘습니다.", "INVALID_FMP4_FRAGMENT");
      }
      headerBytes = 16;
      size = Number(extended);
    } else if (size32 === 0) {
      size = buffer.byteLength - offset;
    } else {
      size = size32;
    }
    if (
      size < headerBytes
      || size > buffer.byteLength - offset
      || (size32 === 0 && offset + size !== buffer.byteLength)
    ) {
      fail("fMP4 박스 크기가 올바르지 않습니다.", "INVALID_FMP4_FRAGMENT");
    }
    types.add(type);
    offset += size;
    boxes += 1;
  }
  if (offset !== buffer.byteLength) {
    fail("fMP4 데이터를 끝까지 확인하지 못했습니다.", "INVALID_FMP4_FRAGMENT");
  }
  return { types };
}

function assertInitSegment(bytes: Uint8Array): void {
  const { types } = inspectIsoBoxes(bytes);
  if (
    !types.has("ftyp")
    || !types.has("moov")
    || types.has("moof")
    || types.has("mdat")
  ) {
    fail("EXT-X-MAP이 독립적인 fMP4 초기화 조각이 아닙니다.", "INVALID_FMP4_INIT");
  }
}

function assertMediaFragment(bytes: Uint8Array): void {
  const { types } = inspectIsoBoxes(bytes);
  if (
    !types.has("moof")
    || !types.has("mdat")
    || types.has("moov")
  ) {
    fail("HLS 미디어 조각이 완전한 fMP4 조각이 아닙니다.", "INVALID_FMP4_FRAGMENT");
  }
}

async function fetchResource(
  dependencies: ExternalVodHlsAcquirerDependencies,
  uri: string,
  semanticUri: string | undefined,
  kind: ExternalVodHlsResourceKind,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<{
  bytes: Uint8Array;
  evidence: ExternalVodHlsAcquiredResourceEvidence;
}> {
  abortIfRequested(signal);
  const url = runtimeUrl(uri);
  callUrlGuard(dependencies.assertAllowedUrl, url, kind);
  let fetched: ExternalVodHlsFetchedResource;
  try {
    fetched = await dependencies.fetchValidatedBinary({
      url,
      kind,
      maximumBytes,
      ...(signal ? { signal } : {})
    });
  } catch (error) {
    abortIfRequested(signal);
    if (error instanceof ExternalVodHlsAcquisitionError) {
      throw error;
    }
    fail("HLS 미디어 조각을 안전하게 받지 못했습니다.", "HLS_FETCH_FAILED");
  }
  abortIfRequested(signal);
  if (!(fetched.bytes instanceof Uint8Array)) {
    fail("HLS 응답이 바이트 데이터가 아닙니다.", "HLS_FETCH_FAILED");
  }
  const bytes = Uint8Array.from(fetched.bytes);
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) {
    fail("HLS 미디어 조각이 크기 안전 상한을 벗어났습니다.", "HLS_RESOURCE_TOO_LARGE");
  }
  const finalUrl = runtimeUrl(fetched.finalUrl);
  callUrlGuard(dependencies.assertAllowedUrl, finalUrl, kind);
  return {
    bytes,
    evidence: {
      semanticUriSha256: sha256(semanticResourceIdentity(url.href, semanticUri)),
      contentSha256: sha256(bytes),
      sizeBytes: bytes.byteLength
    }
  };
}

function checkedTolerance(value: number | undefined): number {
  const tolerance = value ?? DEFAULT_EXTERNAL_VOD_HLS_DURATION_TOLERANCE_MS;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 1_000) {
    fail("HLS 결과 길이 오차 상한이 올바르지 않습니다.", "INVALID_SECTION");
  }
  return tolerance;
}

function assertStreamTimeline(
  timeline: ExternalVodHlsStreamTimeline,
  expectedDurationMs: number,
  durationToleranceMs: number,
  label: string
): void {
  const edgeToleranceMs = Math.max(
    durationToleranceMs,
    MAX_EXTERNAL_VOD_HLS_STREAM_EDGE_TOLERANCE_MS
  );
  if (
    !Number.isFinite(timeline.startMs)
    || !Number.isFinite(timeline.durationMs)
    || !Number.isFinite(timeline.endMs)
    || timeline.startMs < -durationToleranceMs
    || timeline.startMs > edgeToleranceMs
    || Math.abs(timeline.durationMs - expectedDurationMs) > edgeToleranceMs
    || Math.abs(timeline.endMs - expectedDurationMs) > edgeToleranceMs
    || Math.abs(timeline.startMs + timeline.durationMs - timeline.endMs) > 1
  ) {
    fail(
      `${label} 스트림 시간축이 요청한 HLS 원본 범위와 다릅니다.`,
      "MEDIA_VERIFICATION_FAILED"
    );
  }
}

function assertOutputInspection(
  inspection: ExternalVodHlsOutputInspection,
  expectedDurationMs: number,
  toleranceMs: number,
  requireAudio: boolean
): void {
  if (
    !Number.isFinite(inspection.durationMs)
    || inspection.durationMs <= 0
    || Math.abs(inspection.durationMs - expectedDurationMs) > toleranceMs
  ) {
    fail(
      "정밀 취득한 HLS 구간 길이가 요청한 원본 범위와 다릅니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  assertStreamTimeline(inspection.video, expectedDurationMs, toleranceMs, "비디오");
  if (requireAudio && !inspection.audio) {
    fail("정밀 취득한 HLS 구간에 오디오가 없습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  if (inspection.audio) {
    assertStreamTimeline(inspection.audio, expectedDurationMs, toleranceMs, "오디오");
  }
}

async function hashFile(filePath: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    abortIfRequested(signal);
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

async function safeRegularFileSize(filePath: string): Promise<number> {
  let status;
  try {
    status = await lstat(filePath);
  } catch {
    fail("FFmpeg가 HLS 구간 MP4를 만들지 못했습니다.", "MEDIA_MUX_FAILED");
  }
  if (
    !status.isFile()
    || status.isSymbolicLink()
    || status.size <= 0
    || status.size > MAX_EXTERNAL_VOD_HLS_SECTION_BYTES
  ) {
    fail("HLS 구간 결과가 안전한 일반 파일이 아닙니다.", "UNSAFE_OUTPUT_PATH");
  }
  return status.size;
}

function assertPrivateOutputPath(workDirectory: string, outputPath: string): void {
  const relative = path.relative(workDirectory, outputPath);
  if (
    !relative
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || /[\0\r\n]/u.test(relative)
  ) {
    fail("HLS 구간 출력 경로가 개인 작업 폴더를 벗어났습니다.", "UNSAFE_OUTPUT_PATH");
  }
}

export function externalVodHlsSectionClockEvidenceId(
  evidence: Omit<ExternalVodHlsSectionClockEvidence, "evidenceId">
): string {
  return sha256(JSON.stringify(evidence));
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} 문서가 올바르지 않습니다.`, "INVALID_HLS_CLOCK_EVIDENCE");
  }
  return value as UnknownRecord;
}

function exactKeys(
  value: UnknownRecord,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(`${label} 필드 구성이 올바르지 않습니다.`, "INVALID_HLS_CLOCK_EVIDENCE");
  }
}

function evidenceSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, "INVALID_HLS_CLOCK_EVIDENCE");
  }
  return value;
}

function evidenceInteger(
  value: unknown,
  { minimum, maximum, label }: {
    minimum: number;
    maximum: number;
    label: string;
  }
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_HLS_CLOCK_EVIDENCE");
  }
  return Number(value);
}

function parsedResourceEvidence(
  value: unknown,
  label: string,
  maximumBytes: number
): ExternalVodHlsAcquiredResourceEvidence {
  const parsed = record(value, label);
  exactKeys(parsed, [
    "semanticUriSha256",
    "contentSha256",
    "sizeBytes"
  ], label);
  return {
    semanticUriSha256: evidenceSha256(parsed.semanticUriSha256, `${label} 의미 URI`),
    contentSha256: evidenceSha256(parsed.contentSha256, `${label} 콘텐츠`),
    sizeBytes: evidenceInteger(parsed.sizeBytes, {
      minimum: 1,
      maximum: maximumBytes,
      label: `${label} 크기`
    })
  };
}

function parsedSegmentEvidence(
  value: unknown
): ExternalVodHlsAcquiredSegmentEvidence {
  const parsed = record(value, "HLS 세그먼트 증거");
  exactKeys(parsed, [
    "semanticUriSha256",
    "contentSha256",
    "sizeBytes",
    "sequence",
    "playerStartUs",
    "durationUs"
  ], "HLS 세그먼트 증거");
  return {
    ...parsedResourceEvidence({
      semanticUriSha256: parsed.semanticUriSha256,
      contentSha256: parsed.contentSha256,
      sizeBytes: parsed.sizeBytes
    }, "HLS 세그먼트", MAX_EXTERNAL_VOD_HLS_FRAGMENT_BYTES),
    sequence: evidenceInteger(parsed.sequence, {
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      label: "HLS 세그먼트 순번"
    }),
    playerStartUs: evidenceInteger(parsed.playerStartUs, {
      minimum: 0,
      maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
      label: "HLS 세그먼트 재생 시작"
    }),
    durationUs: evidenceInteger(parsed.durationUs, {
      minimum: 1,
      maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000,
      label: "HLS 세그먼트 길이"
    })
  };
}

/**
 * Exact-key, URL-free validator used when a v3 receipt is reopened offline.
 * It normalizes every value and recomputes the evidence ID from canonical keys.
 */
export function parseExternalVodHlsSectionClockEvidence(
  value: unknown
): ExternalVodHlsSectionClockEvidence {
  const parsed = record(value, "HLS 구간 시간축 증거");
  exactKeys(parsed, [
    "schemaId",
    "evidenceId",
    "sectionId",
    "playlistFingerprintSha256",
    "renditionFingerprintSha256",
    "resourceSetFingerprintSha256",
    "sourceStartUs",
    "sourceEndUs",
    "firstSegmentPlayerStartUs",
    "firstSegmentOffsetUs",
    "mapping",
    "init",
    "segments",
    "output"
  ], "HLS 구간 시간축 증거");
  if (parsed.schemaId !== EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA) {
    fail("HLS 구간 시간축 증거 버전이 올바르지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  if (typeof parsed.sectionId !== "string" || !SAFE_SECTION_ID_PATTERN.test(parsed.sectionId)) {
    fail("HLS 구간 시간축 증거 식별자가 올바르지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const sourceStartUs = evidenceInteger(parsed.sourceStartUs, {
    minimum: 0,
    maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
    label: "HLS 증거 원본 시작"
  });
  const sourceEndUs = evidenceInteger(parsed.sourceEndUs, {
    minimum: sourceStartUs + 1,
    maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
    label: "HLS 증거 원본 끝"
  });
  if (sourceEndUs - sourceStartUs > MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000) {
    fail("HLS 증거 구간이 길이 상한을 넘습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const firstSegmentPlayerStartUs = evidenceInteger(parsed.firstSegmentPlayerStartUs, {
    minimum: 0,
    maximum: sourceStartUs,
    label: "HLS 증거 첫 세그먼트 시작"
  });
  const firstSegmentOffsetUs = evidenceInteger(parsed.firstSegmentOffsetUs, {
    minimum: 0,
    maximum: sourceStartUs,
    label: "HLS 증거 첫 세그먼트 오프셋"
  });
  if (firstSegmentPlayerStartUs + firstSegmentOffsetUs !== sourceStartUs) {
    fail("HLS 증거의 원본 앵커 계산이 맞지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }

  const mapping = record(parsed.mapping, "HLS 시간축 매핑");
  exactKeys(mapping, [
    "sourceAnchorUs",
    "outputAnchorUs",
    "rateNumerator",
    "rateDenominator"
  ], "HLS 시간축 매핑");
  if (
    mapping.sourceAnchorUs !== sourceStartUs
    || mapping.outputAnchorUs !== 0
    || mapping.rateNumerator !== 1
    || mapping.rateDenominator !== 1
  ) {
    fail("HLS 증거의 시간축 매핑이 항등 변환이 아닙니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }

  const init = parsedResourceEvidence(
    parsed.init,
    "HLS 초기화 조각",
    MAX_EXTERNAL_VOD_HLS_INIT_BYTES
  );
  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    fail("HLS 구간 시간축 증거에 세그먼트가 없습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  if (parsed.segments.length > MAX_EXTERNAL_VOD_HLS_SEGMENTS) {
    fail("HLS 구간 시간축 증거의 세그먼트가 너무 많습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const segments = parsed.segments.map(parsedSegmentEvidence);
  let previous: ExternalVodHlsAcquiredSegmentEvidence | undefined;
  let workBytes = init.sizeBytes;
  for (const segment of segments) {
    if (
      previous
      && (
        segment.sequence !== previous.sequence + 1
        || segment.playerStartUs !== previous.playerStartUs + previous.durationUs
      )
    ) {
      fail("HLS 구간 증거의 세그먼트 시간축이 연속적이지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
    }
    workBytes += init.sizeBytes + segment.sizeBytes;
    if (workBytes > MAX_EXTERNAL_VOD_HLS_SECTION_BYTES) {
      fail("HLS 구간 증거의 작업 크기가 상한을 넘습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
    }
    previous = segment;
  }
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  if (
    !firstSegment
    || !lastSegment
    || firstSegment.playerStartUs !== firstSegmentPlayerStartUs
    || firstSegment.playerStartUs > sourceStartUs
    || firstSegment.playerStartUs + firstSegment.durationUs <= sourceStartUs
    || lastSegment.playerStartUs >= sourceEndUs
    || lastSegment.playerStartUs + lastSegment.durationUs < sourceEndUs
  ) {
    fail("HLS 구간 증거의 세그먼트가 원본 범위를 덮지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }

  const output = record(parsed.output, "HLS 출력 증거");
  exactKeys(output, ["durationMs", "sizeBytes", "contentSha256"], "HLS 출력 증거");
  const outputDurationMs = Number(output.durationMs);
  const expectedDurationMs = (sourceEndUs - sourceStartUs) / 1_000;
  if (
    !Number.isFinite(outputDurationMs)
    || outputDurationMs <= 0
    || Math.abs(outputDurationMs - expectedDurationMs)
      > DEFAULT_EXTERNAL_VOD_HLS_DURATION_TOLERANCE_MS
  ) {
    fail("HLS 출력 증거의 길이가 원본 범위와 다릅니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const normalizedWithoutId: Omit<ExternalVodHlsSectionClockEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA,
    sectionId: parsed.sectionId,
    playlistFingerprintSha256: evidenceSha256(
      parsed.playlistFingerprintSha256,
      "HLS 증거 재생목록"
    ),
    renditionFingerprintSha256: evidenceSha256(
      parsed.renditionFingerprintSha256,
      "HLS 증거 rendition"
    ),
    resourceSetFingerprintSha256: evidenceSha256(
      parsed.resourceSetFingerprintSha256,
      "HLS 증거 리소스 집합"
    ),
    sourceStartUs,
    sourceEndUs,
    firstSegmentPlayerStartUs,
    firstSegmentOffsetUs,
    mapping: {
      sourceAnchorUs: sourceStartUs,
      outputAnchorUs: 0,
      rateNumerator: 1,
      rateDenominator: 1
    },
    init,
    segments,
    output: {
      durationMs: outputDurationMs,
      sizeBytes: evidenceInteger(output.sizeBytes, {
        minimum: 1,
        maximum: MAX_EXTERNAL_VOD_HLS_SECTION_BYTES,
        label: "HLS 출력 크기"
      }),
      contentSha256: evidenceSha256(output.contentSha256, "HLS 출력 콘텐츠")
    }
  };
  const expectedEvidenceId = externalVodHlsSectionClockEvidenceId(normalizedWithoutId);
  if (evidenceSha256(parsed.evidenceId, "HLS 구간 시간축 증거") !== expectedEvidenceId) {
    fail("HLS 구간 시간축 증거 ID가 본문과 다릅니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  return {
    ...normalizedWithoutId,
    evidenceId: expectedEvidenceId
  };
}

function segmentEdge(
  segment: ExternalVodHlsAcquiredSegmentEvidence
): ExternalVodHlsSegmentEdgeEvidence {
  return {
    semanticUriSha256: segment.semanticUriSha256,
    contentSha256: segment.contentSha256,
    sizeBytes: segment.sizeBytes,
    sequence: segment.sequence,
    playerStartUs: segment.playerStartUs,
    durationUs: segment.durationUs
  };
}

function persistedEvidenceId(
  evidence: Omit<ExternalVodHlsPersistedClockEvidence, "evidenceId">
): string {
  return sha256(JSON.stringify(evidence));
}

/** Converts rich per-fragment diagnostics into a receipt-sized proof. */
export function compactExternalVodHlsSectionClockEvidence(
  value: ExternalVodHlsSectionClockEvidence,
  binding: ExternalVodHlsPersistedClockBinding
): ExternalVodHlsPersistedClockEvidence {
  const evidence = parseExternalVodHlsSectionClockEvidence(value);
  const first = evidence.segments[0];
  const last = evidence.segments.at(-1);
  if (!first || !last) {
    fail("HLS 구간 증거에 세그먼트가 없습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const precedingSegment = binding.precedingSegment === null
    ? null
    : parsedSegmentEdge(binding.precedingSegment, "HLS 선행 세대 앵커");
  const compactWithoutId: Omit<ExternalVodHlsPersistedClockEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA,
    sectionId: evidence.sectionId,
    partProofId: evidenceSha256(binding.partProofId, "선택 파트 증명"),
    clockProofId: evidenceSha256(binding.clockProofId, "HLS 시간축 증명"),
    playlistFingerprintSha256: evidence.playlistFingerprintSha256,
    renditionFingerprintSha256: evidence.renditionFingerprintSha256,
    resourceSetFingerprintSha256: evidence.resourceSetFingerprintSha256,
    sourceStartUs: evidence.sourceStartUs,
    sourceEndUs: evidence.sourceEndUs,
    firstSegmentPlayerStartUs: evidence.firstSegmentPlayerStartUs,
    firstSegmentOffsetUs: evidence.firstSegmentOffsetUs,
    mapping: evidence.mapping,
    init: evidence.init,
    segmentCount: evidence.segments.length,
    precedingSegment,
    firstSegment: segmentEdge(first),
    lastSegment: segmentEdge(last),
    segmentTimelineSha256: sha256(JSON.stringify(
      evidence.segments.map(segmentEdge)
    )),
    fetchedResourcesSha256: sha256(JSON.stringify({
      init: evidence.init,
      precedingSegment,
      segments: evidence.segments.map((segment) => ({
        sequence: segment.sequence,
        semanticUriSha256: segment.semanticUriSha256,
        contentSha256: segment.contentSha256,
        sizeBytes: segment.sizeBytes
      }))
    })),
    output: evidence.output
  };
  return parseExternalVodHlsPersistedClockEvidence({
    ...compactWithoutId,
    evidenceId: persistedEvidenceId(compactWithoutId)
  });
}

function parsedSegmentEdge(
  value: unknown,
  label: string
): ExternalVodHlsSegmentEdgeEvidence {
  const parsed = record(value, label);
  exactKeys(parsed, [
    "semanticUriSha256",
    "contentSha256",
    "sizeBytes",
    "sequence",
    "playerStartUs",
    "durationUs"
  ], label);
  return {
    ...parsedResourceEvidence({
      semanticUriSha256: parsed.semanticUriSha256,
      contentSha256: parsed.contentSha256,
      sizeBytes: parsed.sizeBytes
    }, label, MAX_EXTERNAL_VOD_HLS_FRAGMENT_BYTES),
    sequence: evidenceInteger(parsed.sequence, {
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      label: `${label} 순번`
    }),
    playerStartUs: evidenceInteger(parsed.playerStartUs, {
      minimum: 0,
      maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
      label: `${label} 재생 시작`
    }),
    durationUs: evidenceInteger(parsed.durationUs, {
      minimum: 1,
      maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000,
      label: `${label} 길이`
    })
  };
}

/** Exact-key validator for the bounded proof stored in materialization receipts. */
export function parseExternalVodHlsPersistedClockEvidence(
  value: unknown
): ExternalVodHlsPersistedClockEvidence {
  const parsed = record(value, "HLS 영속 시간축 증거");
  exactKeys(parsed, [
    "schemaId",
    "evidenceId",
    "sectionId",
    "partProofId",
    "clockProofId",
    "playlistFingerprintSha256",
    "renditionFingerprintSha256",
    "resourceSetFingerprintSha256",
    "sourceStartUs",
    "sourceEndUs",
    "firstSegmentPlayerStartUs",
    "firstSegmentOffsetUs",
    "mapping",
    "init",
    "segmentCount",
    "precedingSegment",
    "firstSegment",
    "lastSegment",
    "segmentTimelineSha256",
    "fetchedResourcesSha256",
    "output"
  ], "HLS 영속 시간축 증거");
  if (parsed.schemaId !== EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA) {
    fail("HLS 영속 시간축 증거 버전이 올바르지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  if (typeof parsed.sectionId !== "string" || !SAFE_SECTION_ID_PATTERN.test(parsed.sectionId)) {
    fail("HLS 영속 시간축 증거 식별자가 올바르지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const sourceStartUs = evidenceInteger(parsed.sourceStartUs, {
    minimum: 0,
    maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
    label: "HLS 영속 증거 원본 시작"
  });
  const sourceEndUs = evidenceInteger(parsed.sourceEndUs, {
    minimum: sourceStartUs + 1,
    maximum: MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000 * 100,
    label: "HLS 영속 증거 원본 끝"
  });
  if (sourceEndUs - sourceStartUs > MAX_EXTERNAL_VOD_HLS_SECTION_MS * 1_000) {
    fail("HLS 영속 증거 구간이 길이 상한을 넘습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const firstSegmentPlayerStartUs = evidenceInteger(parsed.firstSegmentPlayerStartUs, {
    minimum: 0,
    maximum: sourceStartUs,
    label: "HLS 영속 증거 첫 세그먼트 시작"
  });
  const firstSegmentOffsetUs = evidenceInteger(parsed.firstSegmentOffsetUs, {
    minimum: 0,
    maximum: sourceStartUs,
    label: "HLS 영속 증거 첫 세그먼트 오프셋"
  });
  if (firstSegmentPlayerStartUs + firstSegmentOffsetUs !== sourceStartUs) {
    fail("HLS 영속 증거의 원본 앵커 계산이 맞지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const mapping = record(parsed.mapping, "HLS 영속 시간축 매핑");
  exactKeys(mapping, [
    "sourceAnchorUs",
    "outputAnchorUs",
    "rateNumerator",
    "rateDenominator"
  ], "HLS 영속 시간축 매핑");
  if (
    mapping.sourceAnchorUs !== sourceStartUs
    || mapping.outputAnchorUs !== 0
    || mapping.rateNumerator !== 1
    || mapping.rateDenominator !== 1
  ) {
    fail("HLS 영속 증거의 시간축 매핑이 항등 변환이 아닙니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const segmentCount = evidenceInteger(parsed.segmentCount, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_HLS_SEGMENTS,
    label: "HLS 영속 증거 세그먼트 수"
  });
  const precedingSegment = parsed.precedingSegment === null
    ? null
    : parsedSegmentEdge(parsed.precedingSegment, "HLS 선행 세대 앵커");
  const firstSegment = parsedSegmentEdge(parsed.firstSegment, "HLS 첫 세그먼트 증거");
  const lastSegment = parsedSegmentEdge(parsed.lastSegment, "HLS 마지막 세그먼트 증거");
  if (
    (
      firstSegment.playerStartUs === 0
        ? precedingSegment !== null
        : precedingSegment === null
          || precedingSegment.sequence + 1 !== firstSegment.sequence
          || precedingSegment.playerStartUs + precedingSegment.durationUs
            !== firstSegment.playerStartUs
    )
    ||
    firstSegment.playerStartUs !== firstSegmentPlayerStartUs
    || firstSegment.playerStartUs > sourceStartUs
    || firstSegment.playerStartUs + firstSegment.durationUs <= sourceStartUs
    || lastSegment.playerStartUs >= sourceEndUs
    || lastSegment.playerStartUs + lastSegment.durationUs < sourceEndUs
    || lastSegment.sequence !== firstSegment.sequence + segmentCount - 1
    || (
      segmentCount === 1
        ? (
          lastSegment.semanticUriSha256 !== firstSegment.semanticUriSha256
          || lastSegment.contentSha256 !== firstSegment.contentSha256
          || lastSegment.sizeBytes !== firstSegment.sizeBytes
          || lastSegment.sequence !== firstSegment.sequence
          || lastSegment.playerStartUs !== firstSegment.playerStartUs
          || lastSegment.durationUs !== firstSegment.durationUs
        )
        : lastSegment.playerStartUs < firstSegment.playerStartUs + firstSegment.durationUs
    )
  ) {
    fail("HLS 영속 증거의 세그먼트 범위가 올바르지 않습니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const output = record(parsed.output, "HLS 영속 출력 증거");
  exactKeys(output, ["durationMs", "sizeBytes", "contentSha256"], "HLS 영속 출력 증거");
  const durationMs = Number(output.durationMs);
  if (
    !Number.isFinite(durationMs)
    || durationMs <= 0
    || Math.abs(durationMs - (sourceEndUs - sourceStartUs) / 1_000)
      > DEFAULT_EXTERNAL_VOD_HLS_DURATION_TOLERANCE_MS
  ) {
    fail("HLS 영속 출력 증거 길이가 원본 범위와 다릅니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  const normalizedWithoutId: Omit<ExternalVodHlsPersistedClockEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA,
    sectionId: parsed.sectionId,
    partProofId: evidenceSha256(parsed.partProofId, "선택 파트 증명"),
    clockProofId: evidenceSha256(parsed.clockProofId, "HLS 시간축 증명"),
    playlistFingerprintSha256: evidenceSha256(
      parsed.playlistFingerprintSha256,
      "HLS 영속 재생목록"
    ),
    renditionFingerprintSha256: evidenceSha256(
      parsed.renditionFingerprintSha256,
      "HLS 영속 rendition"
    ),
    resourceSetFingerprintSha256: evidenceSha256(
      parsed.resourceSetFingerprintSha256,
      "HLS 영속 리소스 집합"
    ),
    sourceStartUs,
    sourceEndUs,
    firstSegmentPlayerStartUs,
    firstSegmentOffsetUs,
    mapping: {
      sourceAnchorUs: sourceStartUs,
      outputAnchorUs: 0,
      rateNumerator: 1,
      rateDenominator: 1
    },
    init: parsedResourceEvidence(
      parsed.init,
      "HLS 영속 초기화 조각",
      MAX_EXTERNAL_VOD_HLS_INIT_BYTES
    ),
    segmentCount,
    precedingSegment,
    firstSegment,
    lastSegment,
    segmentTimelineSha256: evidenceSha256(
      parsed.segmentTimelineSha256,
      "HLS 영속 세그먼트 시간축"
    ),
    fetchedResourcesSha256: evidenceSha256(
      parsed.fetchedResourcesSha256,
      "HLS 영속 취득 리소스"
    ),
    output: {
      durationMs,
      sizeBytes: evidenceInteger(output.sizeBytes, {
        minimum: 1,
        maximum: MAX_EXTERNAL_VOD_HLS_SECTION_BYTES,
        label: "HLS 영속 출력 크기"
      }),
      contentSha256: evidenceSha256(output.contentSha256, "HLS 영속 출력 콘텐츠")
    }
  };
  const expectedId = persistedEvidenceId(normalizedWithoutId);
  if (evidenceSha256(parsed.evidenceId, "HLS 영속 시간축 증거") !== expectedId) {
    fail("HLS 영속 시간축 증거 ID가 본문과 다릅니다.", "INVALID_HLS_CLOCK_EVIDENCE");
  }
  return { ...normalizedWithoutId, evidenceId: expectedId };
}

export async function acquireExternalVodHlsSection(
  request: AcquireExternalVodHlsSectionRequest,
  dependencies: ExternalVodHlsAcquirerDependencies
): Promise<AcquireExternalVodHlsSectionResult> {
  abortIfRequested(request.signal);
  if (
    !SAFE_SECTION_ID_PATTERN.test(request.sectionId)
    || !SHA256_PATTERN.test(request.partProofId)
    || !SHA256_PATTERN.test(request.clockProofId)
  ) {
    fail("HLS 구간 식별자가 올바르지 않습니다.", "INVALID_SECTION");
  }
  const processTimeoutMs = request.processTimeoutMs ?? 30 * 60 * 1_000;
  if (!Number.isSafeInteger(processTimeoutMs) || processTimeoutMs <= 0) {
    fail("HLS FFmpeg 시간 제한이 올바르지 않습니다.", "INVALID_SECTION");
  }
  const durationToleranceMs = checkedTolerance(request.durationToleranceMs);
  const workDirectory = path.resolve(request.workDirectory);
  const outputPath = path.resolve(request.outputPath);
  assertPrivateOutputPath(workDirectory, outputPath);
  await mkdir(workDirectory, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });

  const timeline = snapshotTimeline(request.timeline, dependencies);
  const initialResourceFingerprint = timelineResourceFingerprint(timeline);
  const initialRuntimeFingerprint = timelineRuntimeFingerprint(timeline);
  const selected = selectExternalVodHlsSegmentRange(
    timeline,
    request.sourceStartMs,
    request.sourceEndMs
  );
  const acquisitionDirectory = await mkdtemp(path.join(
    workDirectory,
    process.platform === "win32" ? ".h-" : ".hls-acquire-"
  ));
  await chmod(acquisitionDirectory, 0o700);
  let published = false;
  try {
    const fetchedInit = await fetchResource(
      dependencies,
      timeline.map.uri,
      timeline.map.semanticUri,
      "init",
      MAX_EXTERNAL_VOD_HLS_INIT_BYTES,
      request.signal
    );
    assertInitSegment(fetchedInit.bytes);

    const segmentEvidence: ExternalVodHlsAcquiredSegmentEvidence[] = [];
    let workBytes = fetchedInit.bytes.byteLength;
    for (const [index, segment] of selected.segments.entries()) {
      abortIfRequested(request.signal);
      const fetched = await fetchResource(
        dependencies,
        segment.uri,
        segment.semanticUri,
        "fragment",
        MAX_EXTERNAL_VOD_HLS_FRAGMENT_BYTES,
        request.signal
      );
      assertMediaFragment(fetched.bytes);
      if (
        segment.expectedSha256 !== undefined
        && segment.expectedSha256 !== fetched.evidence.contentSha256
      ) {
        fail("HLS 미디어 조각이 확인 당시와 달라졌습니다.", "HLS_RESOURCE_CHANGED");
      }
      workBytes += fetchedInit.bytes.byteLength + fetched.bytes.byteLength;
      if (workBytes > MAX_EXTERNAL_VOD_HLS_SECTION_BYTES) {
        fail("HLS 구간 작업 파일이 안전 상한을 넘었습니다.", "HLS_RESOURCE_TOO_LARGE");
      }
      const fileName = externalVodHlsFragmentFileName(index);
      await writeFile(
        path.join(acquisitionDirectory, fileName),
        Buffer.concat([Buffer.from(fetchedInit.bytes), Buffer.from(fetched.bytes)]),
        { flag: "wx", mode: 0o600 }
      );
      segmentEvidence.push({
        ...fetched.evidence,
        sequence: segment.sequence,
        playerStartUs: segment.startUs,
        durationUs: segment.durationUs
      });
    }

    const firstSelectedSegment = selected.segments[0];
    if (!firstSelectedSegment) {
      fail("HLS 구간에 선택된 세그먼트가 없습니다.", "INVALID_HLS_TIMELINE");
    }
    const firstSelectedIndex = timeline.segments.findIndex((segment) => (
      segment.sequence === firstSelectedSegment.sequence
      && segment.startUs === firstSelectedSegment.startUs
      && segment.durationUs === firstSelectedSegment.durationUs
    ));
    if (firstSelectedIndex < 0) {
      fail("HLS 선택 구간이 재생목록 스냅샷과 다릅니다.", "SOURCE_CHANGED");
    }
    const precedingTimelineSegment = firstSelectedIndex === 0
      ? undefined
      : timeline.segments[firstSelectedIndex - 1];
    let precedingSegment: ExternalVodHlsSegmentEdgeEvidence | null = null;
    if (precedingTimelineSegment) {
      const fetched = await fetchResource(
        dependencies,
        precedingTimelineSegment.uri,
        precedingTimelineSegment.semanticUri,
        "fragment",
        MAX_EXTERNAL_VOD_HLS_FRAGMENT_BYTES,
        request.signal
      );
      assertMediaFragment(fetched.bytes);
      if (
        precedingTimelineSegment.expectedSha256 !== undefined
        && precedingTimelineSegment.expectedSha256 !== fetched.evidence.contentSha256
      ) {
        fail("HLS 선행 세대 앵커가 확인 당시와 달라졌습니다.", "HLS_RESOURCE_CHANGED");
      }
      workBytes += fetched.bytes.byteLength;
      if (workBytes > MAX_EXTERNAL_VOD_HLS_SECTION_BYTES) {
        fail("HLS 구간 작업 파일이 안전 상한을 넘었습니다.", "HLS_RESOURCE_TOO_LARGE");
      }
      precedingSegment = {
        ...fetched.evidence,
        sequence: precedingTimelineSegment.sequence,
        playerStartUs: precedingTimelineSegment.startUs,
        durationUs: precedingTimelineSegment.durationUs
      };
    }

    const concatListPath = path.join(
      acquisitionDirectory,
      process.platform === "win32" ? "f.txt" : "fragments.ffconcat"
    );
    await writeFile(
      concatListPath,
      buildExternalVodHlsConcatDescription(selected.segments),
      { flag: "wx", mode: 0o600, encoding: "utf8" }
    );
    const temporaryOutputPath = path.join(
      acquisitionDirectory,
      process.platform === "win32" ? "s.mp4" : "section.mp4"
    );
    const durationUs = selected.sourceEndUs - selected.sourceStartUs;
    const processOptions: ExternalVodHlsProcessOptions = {
      cwd: acquisitionDirectory,
      timeoutMs: processTimeoutMs,
      ...(request.signal ? { signal: request.signal } : {})
    };
    let processResult: ExternalVodHlsProcessResult;
    try {
      processResult = await dependencies.runProcess(
        dependencies.ffmpegBinary,
        buildExternalVodHlsTrimArgs({
          concatListPath,
          outputPath: temporaryOutputPath,
          firstSegmentOffsetUs: selected.firstSegmentOffsetUs,
          durationUs
        }),
        processOptions
      );
    } catch (error) {
      abortIfRequested(request.signal);
      if (error instanceof ExternalVodHlsAcquisitionError) {
        throw error;
      }
      fail("HLS 구간을 정밀 트리밍하지 못했습니다.", "MEDIA_MUX_FAILED");
    }
    if (processResult.exitCode !== 0) {
      fail("HLS 구간을 정밀 트리밍하지 못했습니다.", "MEDIA_MUX_FAILED");
    }
    const temporarySizeBytes = await safeRegularFileSize(temporaryOutputPath);
    let inspection: ExternalVodHlsOutputInspection;
    try {
      inspection = await dependencies.inspectOutput(temporaryOutputPath, processOptions);
    } catch (error) {
      if (error instanceof ExternalVodHlsAcquisitionError) {
        throw error;
      }
      fail("정밀 취득한 HLS 구간을 검사하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
    }
    const expectedDurationMs = request.sourceEndMs - request.sourceStartMs;
    assertOutputInspection(
      inspection,
      expectedDurationMs,
      durationToleranceMs,
      request.requireAudio ?? true
    );

    let currentTimeline: ExternalVodHlsTimeline;
    try {
      currentTimeline = snapshotTimeline(request.timeline, dependencies);
    } catch {
      fail("HLS 재생목록 스냅샷이 취득 중 바뀌었습니다.", "SOURCE_CHANGED");
    }
    if (
      currentTimeline.playlistFingerprintSha256 !== timeline.playlistFingerprintSha256
      || currentTimeline.renditionFingerprintSha256 !== timeline.renditionFingerprintSha256
      || timelineResourceFingerprint(currentTimeline) !== initialResourceFingerprint
      || timelineRuntimeFingerprint(currentTimeline) !== initialRuntimeFingerprint
    ) {
      fail("HLS 재생목록 스냅샷이 취득 중 바뀌었습니다.", "SOURCE_CHANGED");
    }

    const temporaryOutputSha256 = await hashFile(temporaryOutputPath, request.signal);
    try {
      await copyFile(temporaryOutputPath, outputPath, fsConstants.COPYFILE_EXCL);
      published = true;
      await chmod(outputPath, 0o600);
    } catch {
      fail("HLS 구간 결과를 안전하게 게시하지 못했습니다.", "UNSAFE_OUTPUT_PATH");
    }
    const publishedSizeBytes = await safeRegularFileSize(outputPath);
    const publishedSha256 = await hashFile(outputPath, request.signal);
    if (
      publishedSizeBytes !== temporarySizeBytes
      || publishedSha256 !== temporaryOutputSha256
    ) {
      fail("게시한 HLS 구간 결과가 검증본과 다릅니다.", "MEDIA_VERIFICATION_FAILED");
    }

    const evidenceWithoutId: Omit<ExternalVodHlsSectionClockEvidence, "evidenceId"> = {
      schemaId: EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA,
      sectionId: request.sectionId,
      playlistFingerprintSha256: timeline.playlistFingerprintSha256,
      renditionFingerprintSha256: timeline.renditionFingerprintSha256,
      resourceSetFingerprintSha256: initialResourceFingerprint,
      sourceStartUs: selected.sourceStartUs,
      sourceEndUs: selected.sourceEndUs,
      firstSegmentPlayerStartUs: selected.segments[0]?.startUs ?? 0,
      firstSegmentOffsetUs: selected.firstSegmentOffsetUs,
      mapping: {
        sourceAnchorUs: selected.sourceStartUs,
        outputAnchorUs: 0,
        rateNumerator: 1,
        rateDenominator: 1
      },
      init: fetchedInit.evidence,
      segments: segmentEvidence,
      output: {
        durationMs: inspection.durationMs,
        sizeBytes: publishedSizeBytes,
        contentSha256: publishedSha256
      }
    };
    const evidence: ExternalVodHlsSectionClockEvidence = {
      ...evidenceWithoutId,
      evidenceId: externalVodHlsSectionClockEvidenceId(evidenceWithoutId)
    };
    return {
      outputPath,
      inspection,
      evidence,
      persistedEvidence: compactExternalVodHlsSectionClockEvidence(evidence, {
        partProofId: request.partProofId,
        clockProofId: request.clockProofId,
        precedingSegment
      })
    };
  } catch (error) {
    if (published) {
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(acquisitionDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
