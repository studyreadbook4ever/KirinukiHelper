/**
 * Strict section acquisition for already-proven zero-origin direct MP4/M4A
 * inputs (primarily YouTube's selected video/audio formats).
 *
 * Runtime URLs and public request-header values are process-only data. The
 * returned proof binds the selected part proof, clock proof, source range,
 * encoding profile and output bytes without persisting any URL, path token or
 * header value.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm
} from "node:fs/promises";
import path from "node:path";

export const EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA =
  "chzzk-kirinuki/external-vod-direct-section-evidence-v2";
export const EXTERNAL_VOD_DIRECT_ENCODING_PROFILE =
  "h264-yuv420p-crf18-medium+aac-192k-faststart-v1";
export const EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256 = sha256(
  EXTERNAL_VOD_DIRECT_ENCODING_PROFILE
);
export const MAX_EXTERNAL_VOD_DIRECT_SOURCE_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_EXTERNAL_VOD_DIRECT_SECTION_MS = 6 * 60 * 60 * 1_000;
export const MAX_EXTERNAL_VOD_DIRECT_OUTPUT_BYTES = 64 * 1024 * 1024 * 1024;
export const DEFAULT_EXTERNAL_VOD_DIRECT_DURATION_TOLERANCE_MS = 250;
export const DEFAULT_EXTERNAL_VOD_DIRECT_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_SECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const SAFE_HEADER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;
const MAX_RUNTIME_URL_LENGTH = 16 * 1024;
const MAX_HEADER_VALUE_LENGTH = 4 * 1024;
const MAX_HEADER_BLOCK_BYTES = 16 * 1024;
const ALLOWED_PUBLIC_HEADER_NAMES = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent"
]);

export interface ExternalVodDirectInputClockProof {
  semanticIdentitySha256: string;
  startUs: 0;
  durationUs: number;
}

/** Parsed and authenticated by the direct-input clock-proof module. */
export interface ExternalVodDirectClockProof {
  proofId: string;
  playerDurationUs: number;
  zeroOrigin: true;
  video: ExternalVodDirectInputClockProof;
  audio?: ExternalVodDirectInputClockProof;
}

export interface ExternalVodDirectRuntimeInput {
  url: string;
  /** Must hash to the corresponding proof's semanticIdentitySha256. */
  semanticIdentity: string;
  publicHeaders: Readonly<Record<string, string>>;
}

export interface ExternalVodDirectRuntimeInputs {
  video: ExternalVodDirectRuntimeInput;
  audio?: ExternalVodDirectRuntimeInput;
}

export interface ExternalVodDirectProcessOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ExternalVodDirectProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExternalVodDirectStreamTimeline {
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface ExternalVodDirectOutputInspection {
  durationMs: number;
  video: ExternalVodDirectStreamTimeline;
  audio?: ExternalVodDirectStreamTimeline;
}

export interface ExternalVodDirectAcquirerDependencies {
  /** Platform allowlist boundary for each exact direct media URL. */
  assertAllowedUrl: (url: URL, kind: "video" | "audio") => void;
  runProcess: (
    command: string,
    args: readonly string[],
    options: ExternalVodDirectProcessOptions
  ) => Promise<ExternalVodDirectProcessResult>;
  inspectOutput: (
    filePath: string,
    options: ExternalVodDirectProcessOptions
  ) => Promise<ExternalVodDirectOutputInspection>;
  ffmpegBinary: string;
}

export interface AcquireExternalVodDirectSectionRequest {
  sectionId: string;
  /** Binds this output to the exact selected format and metadata part proof. */
  partProofId: string;
  clockProof: ExternalVodDirectClockProof;
  runtimeInputs: ExternalVodDirectRuntimeInputs;
  sourceStartMs: number;
  sourceEndMs: number;
  workDirectory: string;
  outputPath: string;
  signal?: AbortSignal;
  processTimeoutMs?: number;
  durationToleranceMs?: number;
  /** Defaults to true when a separate proven audio input exists. */
  requireAudio?: boolean;
}

export interface ExternalVodDirectSectionEvidence {
  schemaId: typeof EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA;
  evidenceId: string;
  sectionId: string;
  partProofId: string;
  clockProofId: string;
  encodingProfileSha256: string;
  sourceStartUs: number;
  sourceEndUs: number;
  hasSeparateAudio: boolean;
  mapping: {
    sourceAnchorUs: number;
    outputAnchorUs: 0;
    rateNumerator: 1;
    rateDenominator: 1;
  };
  output: {
    durationMs: number;
    sizeBytes: number;
    contentSha256: string;
  };
}

export interface AcquireExternalVodDirectSectionResult {
  outputPath: string;
  inspection: ExternalVodDirectOutputInspection;
  evidence: ExternalVodDirectSectionEvidence;
}

export interface NormalizedExternalVodDirectRuntimeInput {
  url: string;
  semanticIdentity: string;
  headerNames: readonly string[];
  headerBlock: string;
}

export interface NormalizedExternalVodDirectInputs {
  video: NormalizedExternalVodDirectRuntimeInput;
  audio?: NormalizedExternalVodDirectRuntimeInput;
}

export class ExternalVodDirectAcquisitionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodDirectAcquisitionError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodDirectAcquisitionError(message, code);
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("직접 VOD 구간 준비가 취소되었습니다.", "ABORTED");
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

/** Recomputes the content address for the canonical direct-clock body. */
export function externalVodDirectClockProofId(
  proof: Omit<ExternalVodDirectClockProof, "proofId"> | ExternalVodDirectClockProof
): string {
  const canonicalBody: Omit<ExternalVodDirectClockProof, "proofId"> = {
    playerDurationUs: proof.playerDurationUs,
    zeroOrigin: proof.zeroOrigin,
    video: {
      semanticIdentitySha256: proof.video.semanticIdentitySha256,
      startUs: proof.video.startUs,
      durationUs: proof.video.durationUs
    },
    ...(proof.audio
      ? {
        audio: {
          semanticIdentitySha256: proof.audio.semanticIdentitySha256,
          startUs: proof.audio.startUs,
          durationUs: proof.audio.durationUs
        }
      }
      : {})
  };
  return sha256(stableJson(canonicalBody));
}

function assertSha256(value: string, label: string, code: string): void {
  if (!SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, code);
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
    fail("직접 미디어 주소가 올바르지 않습니다.", "UNSAFE_DIRECT_URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail("직접 미디어 주소가 올바르지 않습니다.", "UNSAFE_DIRECT_URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    fail("직접 미디어 주소가 안전하지 않습니다.", "UNSAFE_DIRECT_URL");
  }
  return parsed;
}

function callUrlGuard(
  guard: ExternalVodDirectAcquirerDependencies["assertAllowedUrl"],
  url: URL,
  kind: "video" | "audio"
): void {
  try {
    guard(url, kind);
  } catch (error) {
    if (error instanceof ExternalVodDirectAcquisitionError) {
      throw error;
    }
    fail("직접 미디어가 허용된 공개 호스트에 있지 않습니다.", "UNSAFE_DIRECT_URL");
  }
}

function semanticIdentity(value: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_RUNTIME_URL_LENGTH
    || value.trim() !== value
    || /[\0\r\n]/u.test(value)
  ) {
    fail("직접 미디어 의미 식별자가 올바르지 않습니다.", "INVALID_DIRECT_CLOCK_PROOF");
  }
  if (
    /(?:^|[?&/;])(?:hdntl|hdnts|token|auth|authorization|signature|sig|expires?)=/iu
      .test(value)
  ) {
    fail(
      "직접 미디어 의미 식별자에 휘발성 인증 정보가 포함되었습니다.",
      "INVALID_DIRECT_CLOCK_PROOF"
    );
  }
  return value;
}

function normalizedHeaderBlock(
  headers: Readonly<Record<string, string>>
): { names: string[]; block: string } {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    fail("직접 미디어 공개 헤더가 올바르지 않습니다.", "UNSAFE_DIRECT_HEADERS");
  }
  const normalized = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (!SAFE_HEADER_NAME_PATTERN.test(rawName) || typeof rawValue !== "string") {
      fail("직접 미디어 공개 헤더가 올바르지 않습니다.", "UNSAFE_DIRECT_HEADERS");
    }
    const name = rawName.toLowerCase();
    if (!ALLOWED_PUBLIC_HEADER_NAMES.has(name) || normalized.has(name)) {
      fail("직접 미디어에 비공개 또는 중복 헤더가 포함되었습니다.", "UNSAFE_DIRECT_HEADERS");
    }
    if (
      rawValue.length === 0
      || rawValue.length > MAX_HEADER_VALUE_LENGTH
      || rawValue.trim() !== rawValue
      || /[\0\r\n]/u.test(rawValue)
    ) {
      fail("직접 미디어 공개 헤더 값이 올바르지 않습니다.", "UNSAFE_DIRECT_HEADERS");
    }
    normalized.set(name, rawValue);
  }
  const names = [...normalized.keys()].sort();
  const block = names.map((name) => `${name}: ${normalized.get(name)}`).join("\r\n")
    + (names.length > 0 ? "\r\n" : "");
  if (Buffer.byteLength(block, "utf8") > MAX_HEADER_BLOCK_BYTES) {
    fail("직접 미디어 공개 헤더가 크기 상한을 넘었습니다.", "UNSAFE_DIRECT_HEADERS");
  }
  return { names, block };
}

function normalizeRuntimeInput(
  input: ExternalVodDirectRuntimeInput,
  proof: ExternalVodDirectInputClockProof,
  kind: "video" | "audio",
  dependencies: Pick<ExternalVodDirectAcquirerDependencies, "assertAllowedUrl">
): NormalizedExternalVodDirectRuntimeInput {
  const url = runtimeUrl(input.url);
  callUrlGuard(dependencies.assertAllowedUrl, url, kind);
  const stableIdentity = semanticIdentity(input.semanticIdentity);
  if (sha256(stableIdentity) !== proof.semanticIdentitySha256) {
    fail("직접 미디어 URL이 시간축 증명 당시 입력과 다릅니다.", "SOURCE_CHANGED");
  }
  const headers = normalizedHeaderBlock(input.publicHeaders);
  return {
    url: url.href,
    semanticIdentity: stableIdentity,
    headerNames: headers.names,
    headerBlock: headers.block
  };
}

function checkedUs(
  value: number,
  { minimum, maximum, label }: {
    minimum: number;
    maximum: number;
    label: string;
  }
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_DIRECT_CLOCK_PROOF");
  }
  return value;
}

function normalizeClockProof(
  proof: ExternalVodDirectClockProof
): ExternalVodDirectClockProof {
  assertSha256(proof.proofId, "직접 미디어 시간축 증명", "INVALID_DIRECT_CLOCK_PROOF");
  if (proof.zeroOrigin !== true || proof.video.startUs !== 0) {
    fail("직접 미디어 입력의 0초 원점이 증명되지 않았습니다.", "INVALID_DIRECT_CLOCK_PROOF");
  }
  assertSha256(
    proof.video.semanticIdentitySha256,
    "직접 비디오 의미 식별자",
    "INVALID_DIRECT_CLOCK_PROOF"
  );
  const playerDurationUs = checkedUs(proof.playerDurationUs, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_DIRECT_SOURCE_MS * 1_000,
    label: "직접 미디어 플레이어 길이"
  });
  const videoDurationUs = checkedUs(proof.video.durationUs, {
    minimum: 1,
    maximum: MAX_EXTERNAL_VOD_DIRECT_SOURCE_MS * 1_000,
    label: "직접 비디오 길이"
  });
  let audio: ExternalVodDirectInputClockProof | undefined;
  if (proof.audio !== undefined) {
    if (proof.audio.startUs !== 0) {
      fail("직접 오디오 입력의 0초 원점이 증명되지 않았습니다.", "INVALID_DIRECT_CLOCK_PROOF");
    }
    assertSha256(
      proof.audio.semanticIdentitySha256,
      "직접 오디오 의미 식별자",
      "INVALID_DIRECT_CLOCK_PROOF"
    );
    audio = {
      semanticIdentitySha256: proof.audio.semanticIdentitySha256,
      startUs: 0,
      durationUs: checkedUs(proof.audio.durationUs, {
        minimum: 1,
        maximum: MAX_EXTERNAL_VOD_DIRECT_SOURCE_MS * 1_000,
        label: "직접 오디오 길이"
      })
    };
  }
  const normalized: ExternalVodDirectClockProof = {
    proofId: proof.proofId,
    playerDurationUs,
    zeroOrigin: true,
    video: {
      semanticIdentitySha256: proof.video.semanticIdentitySha256,
      startUs: 0,
      durationUs: videoDurationUs
    },
    ...(audio ? { audio } : {})
  };
  if (externalVodDirectClockProofId(normalized) !== normalized.proofId) {
    fail(
      "직접 미디어 시간축 증명 ID가 본문과 다릅니다.",
      "INVALID_DIRECT_CLOCK_PROOF"
    );
  }
  return normalized;
}

function normalizeInputs(
  runtimeInputs: ExternalVodDirectRuntimeInputs,
  proof: ExternalVodDirectClockProof,
  dependencies: Pick<ExternalVodDirectAcquirerDependencies, "assertAllowedUrl">
): NormalizedExternalVodDirectInputs {
  if ((proof.audio === undefined) !== (runtimeInputs.audio === undefined)) {
    fail("증명한 직접 오디오 입력과 실행 입력 구성이 다릅니다.", "SOURCE_CHANGED");
  }
  return {
    video: normalizeRuntimeInput(runtimeInputs.video, proof.video, "video", dependencies),
    ...(proof.audio && runtimeInputs.audio
      ? { audio: normalizeRuntimeInput(runtimeInputs.audio, proof.audio, "audio", dependencies) }
      : {})
  };
}

function runtimeFingerprint(
  proof: ExternalVodDirectClockProof,
  inputs: NormalizedExternalVodDirectInputs
): string {
  return sha256(JSON.stringify({
    proofId: proof.proofId,
    video: {
      url: inputs.video.url,
      semanticIdentity: inputs.video.semanticIdentity,
      headers: inputs.video.headerBlock
    },
    audio: inputs.audio
      ? {
        url: inputs.audio.url,
        semanticIdentity: inputs.audio.semanticIdentity,
        headers: inputs.audio.headerBlock
      }
      : null
  }));
}

function formatSecondsFromUs(valueUs: number): string {
  if (!Number.isSafeInteger(valueUs) || valueUs < 0) {
    fail("FFmpeg에 전달할 직접 미디어 시간이 올바르지 않습니다.", "INVALID_SECTION");
  }
  const whole = Math.floor(valueUs / 1_000_000);
  const fraction = String(valueUs % 1_000_000).padStart(6, "0");
  return `${whole}.${fraction}`;
}

function directInputArgs(
  input: NormalizedExternalVodDirectRuntimeInput,
  sourceStartUs: number,
  durationUs: number
): string[] {
  return [
    "-protocol_whitelist", "https,tls,tcp",
    "-rw_timeout", "30000000",
    "-accurate_seek",
    "-ss", formatSecondsFromUs(sourceStartUs),
    "-t", formatSecondsFromUs(durationUs),
    ...(input.headerBlock ? ["-headers", input.headerBlock] : []),
    "-i", input.url
  ];
}

export function buildExternalVodDirectFfmpegArgs({
  inputs,
  outputPath,
  sourceStartUs,
  durationUs
}: {
  inputs: NormalizedExternalVodDirectInputs;
  outputPath: string;
  sourceStartUs: number;
  durationUs: number;
}): string[] {
  if (
    !Number.isSafeInteger(sourceStartUs)
    || sourceStartUs < 0
    || !Number.isSafeInteger(durationUs)
    || durationUs <= 0
    || durationUs > MAX_EXTERNAL_VOD_DIRECT_SECTION_MS * 1_000
  ) {
    fail("직접 미디어 정밀 취득 범위가 올바르지 않습니다.", "INVALID_SECTION");
  }
  const audioInputIndex = inputs.audio ? 1 : 0;
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-n",
    ...directInputArgs(inputs.video, sourceStartUs, durationUs),
    ...(inputs.audio ? directInputArgs(inputs.audio, sourceStartUs, durationUs) : []),
    "-map", "0:v:0",
    "-map", `${audioInputIndex}:a:0?`,
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-sn",
    "-dn",
    "-vf", "setpts=PTS-STARTPTS",
    "-af", "asetpts=PTS-STARTPTS",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-avoid_negative_ts", "make_zero",
    "-t", formatSecondsFromUs(durationUs),
    "-movflags", "+faststart",
    "-f", "mp4",
    path.resolve(outputPath)
  ];
}

function checkedTolerance(value: number | undefined): number {
  const tolerance = value ?? DEFAULT_EXTERNAL_VOD_DIRECT_DURATION_TOLERANCE_MS;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 1_000) {
    fail("직접 미디어 결과 길이 오차 상한이 올바르지 않습니다.", "INVALID_SECTION");
  }
  return tolerance;
}

function assertStreamTimeline(
  timeline: ExternalVodDirectStreamTimeline,
  expectedDurationMs: number,
  toleranceMs: number,
  label: string
): void {
  if (
    !Number.isFinite(timeline.startMs)
    || !Number.isFinite(timeline.durationMs)
    || !Number.isFinite(timeline.endMs)
    || timeline.startMs < -toleranceMs
    || timeline.startMs > toleranceMs
    || Math.abs(timeline.durationMs - expectedDurationMs) > toleranceMs
    || Math.abs(timeline.endMs - expectedDurationMs) > toleranceMs
    || Math.abs(timeline.startMs + timeline.durationMs - timeline.endMs) > 1
  ) {
    fail(
      `${label} 스트림 시간축이 요청한 직접 미디어 범위와 다릅니다.`,
      "MEDIA_VERIFICATION_FAILED"
    );
  }
}

function assertOutputInspection(
  inspection: ExternalVodDirectOutputInspection,
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
      "정밀 취득한 직접 미디어 길이가 요청한 원본 범위와 다릅니다.",
      "MEDIA_VERIFICATION_FAILED"
    );
  }
  assertStreamTimeline(inspection.video, expectedDurationMs, toleranceMs, "비디오");
  if (requireAudio && !inspection.audio) {
    fail("정밀 취득한 직접 미디어에 오디오가 없습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  if (inspection.audio) {
    assertStreamTimeline(inspection.audio, expectedDurationMs, toleranceMs, "오디오");
  }
}

async function safeRegularFileSize(filePath: string): Promise<number> {
  let status;
  try {
    status = await lstat(filePath);
  } catch {
    fail("FFmpeg가 직접 미디어 구간을 만들지 못했습니다.", "MEDIA_MUX_FAILED");
  }
  if (
    !status.isFile()
    || status.isSymbolicLink()
    || status.size <= 0
    || status.size > MAX_EXTERNAL_VOD_DIRECT_OUTPUT_BYTES
  ) {
    fail("직접 미디어 결과가 안전한 일반 파일이 아닙니다.", "UNSAFE_OUTPUT_PATH");
  }
  return status.size;
}

async function hashFile(filePath: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    abortIfRequested(signal);
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

function assertPrivateOutputPath(workDirectory: string, outputPath: string): void {
  const relative = path.relative(workDirectory, outputPath);
  if (
    !relative
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || /[\0\r\n]/u.test(relative)
  ) {
    fail("직접 미디어 출력 경로가 개인 작업 폴더를 벗어났습니다.", "UNSAFE_OUTPUT_PATH");
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} 문서가 올바르지 않습니다.`, "INVALID_DIRECT_EVIDENCE");
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(`${label} 필드 구성이 올바르지 않습니다.`, "INVALID_DIRECT_EVIDENCE");
  }
}

function parsedSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, "INVALID_DIRECT_EVIDENCE");
  }
  return value;
}

function parsedInteger(
  value: unknown,
  { minimum, maximum, label }: {
    minimum: number;
    maximum: number;
    label: string;
  }
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_DIRECT_EVIDENCE");
  }
  return Number(value);
}

export function externalVodDirectSectionEvidenceId(
  evidence: Omit<ExternalVodDirectSectionEvidence, "evidenceId">
): string {
  return sha256(JSON.stringify(evidence));
}

/** Exact-key, URL-free validator for v3 receipts and offline cache reuse. */
export function parseExternalVodDirectSectionEvidence(
  value: unknown
): ExternalVodDirectSectionEvidence {
  const parsed = record(value, "직접 미디어 구간 증거");
  exactKeys(parsed, [
    "schemaId",
    "evidenceId",
    "sectionId",
    "partProofId",
    "clockProofId",
    "encodingProfileSha256",
    "sourceStartUs",
    "sourceEndUs",
    "hasSeparateAudio",
    "mapping",
    "output"
  ], "직접 미디어 구간 증거");
  if (parsed.schemaId !== EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA) {
    fail("직접 미디어 구간 증거 버전이 올바르지 않습니다.", "INVALID_DIRECT_EVIDENCE");
  }
  if (typeof parsed.sectionId !== "string" || !SAFE_SECTION_ID_PATTERN.test(parsed.sectionId)) {
    fail("직접 미디어 구간 증거 식별자가 올바르지 않습니다.", "INVALID_DIRECT_EVIDENCE");
  }
  if (typeof parsed.hasSeparateAudio !== "boolean") {
    fail("직접 미디어 오디오 증거 값이 올바르지 않습니다.", "INVALID_DIRECT_EVIDENCE");
  }
  const sourceStartUs = parsedInteger(parsed.sourceStartUs, {
    minimum: 0,
    maximum: MAX_EXTERNAL_VOD_DIRECT_SOURCE_MS * 1_000,
    label: "직접 미디어 증거 원본 시작"
  });
  const sourceEndUs = parsedInteger(parsed.sourceEndUs, {
    minimum: sourceStartUs + 1,
    maximum: MAX_EXTERNAL_VOD_DIRECT_SOURCE_MS * 1_000,
    label: "직접 미디어 증거 원본 끝"
  });
  if (sourceEndUs - sourceStartUs > MAX_EXTERNAL_VOD_DIRECT_SECTION_MS * 1_000) {
    fail("직접 미디어 증거 구간이 길이 상한을 넘습니다.", "INVALID_DIRECT_EVIDENCE");
  }
  const mapping = record(parsed.mapping, "직접 미디어 시간축 매핑");
  exactKeys(mapping, [
    "sourceAnchorUs",
    "outputAnchorUs",
    "rateNumerator",
    "rateDenominator"
  ], "직접 미디어 시간축 매핑");
  if (
    mapping.sourceAnchorUs !== sourceStartUs
    || mapping.outputAnchorUs !== 0
    || mapping.rateNumerator !== 1
    || mapping.rateDenominator !== 1
  ) {
    fail("직접 미디어 증거 시간축이 항등 변환이 아닙니다.", "INVALID_DIRECT_EVIDENCE");
  }
  const output = record(parsed.output, "직접 미디어 출력 증거");
  exactKeys(output, ["durationMs", "sizeBytes", "contentSha256"], "직접 미디어 출력 증거");
  const durationMs = Number(output.durationMs);
  if (
    !Number.isFinite(durationMs)
    || durationMs <= 0
    || Math.abs(durationMs - (sourceEndUs - sourceStartUs) / 1_000)
      > DEFAULT_EXTERNAL_VOD_DIRECT_DURATION_TOLERANCE_MS
  ) {
    fail("직접 미디어 출력 증거 길이가 원본 범위와 다릅니다.", "INVALID_DIRECT_EVIDENCE");
  }
  const normalizedWithoutId: Omit<ExternalVodDirectSectionEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA,
    sectionId: parsed.sectionId,
    partProofId: parsedSha256(parsed.partProofId, "선택 파트 증명"),
    clockProofId: parsedSha256(parsed.clockProofId, "직접 미디어 시간축 증명"),
    encodingProfileSha256: parsedSha256(
      parsed.encodingProfileSha256,
      "직접 미디어 인코딩 프로필"
    ),
    sourceStartUs,
    sourceEndUs,
    hasSeparateAudio: parsed.hasSeparateAudio,
    mapping: {
      sourceAnchorUs: sourceStartUs,
      outputAnchorUs: 0,
      rateNumerator: 1,
      rateDenominator: 1
    },
    output: {
      durationMs,
      sizeBytes: parsedInteger(output.sizeBytes, {
        minimum: 1,
        maximum: MAX_EXTERNAL_VOD_DIRECT_OUTPUT_BYTES,
        label: "직접 미디어 출력 크기"
      }),
      contentSha256: parsedSha256(output.contentSha256, "직접 미디어 출력 콘텐츠")
    }
  };
  if (normalizedWithoutId.encodingProfileSha256 !== EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256) {
    fail("직접 미디어 인코딩 프로필 증거가 현재 프로필과 다릅니다.", "INVALID_DIRECT_EVIDENCE");
  }
  const expectedId = externalVodDirectSectionEvidenceId(normalizedWithoutId);
  if (parsedSha256(parsed.evidenceId, "직접 미디어 구간 증거") !== expectedId) {
    fail("직접 미디어 구간 증거 ID가 본문과 다릅니다.", "INVALID_DIRECT_EVIDENCE");
  }
  return { ...normalizedWithoutId, evidenceId: expectedId };
}

export async function acquireExternalVodDirectSection(
  request: AcquireExternalVodDirectSectionRequest,
  dependencies: ExternalVodDirectAcquirerDependencies
): Promise<AcquireExternalVodDirectSectionResult> {
  abortIfRequested(request.signal);
  if (!SAFE_SECTION_ID_PATTERN.test(request.sectionId)) {
    fail("직접 미디어 구간 식별자가 올바르지 않습니다.", "INVALID_SECTION");
  }
  assertSha256(
    request.partProofId,
    "선택 파트 증명",
    "INVALID_DIRECT_CLOCK_PROOF"
  );
  if (
    !Number.isSafeInteger(request.sourceStartMs)
    || request.sourceStartMs < 0
    || !Number.isSafeInteger(request.sourceEndMs)
    || request.sourceEndMs <= request.sourceStartMs
    || request.sourceEndMs - request.sourceStartMs > MAX_EXTERNAL_VOD_DIRECT_SECTION_MS
  ) {
    fail("직접 미디어에서 준비할 원본 구간이 올바르지 않습니다.", "INVALID_SECTION");
  }
  const sourceStartUs = request.sourceStartMs * 1_000;
  const sourceEndUs = request.sourceEndMs * 1_000;
  const durationUs = sourceEndUs - sourceStartUs;
  const proof = normalizeClockProof(request.clockProof);
  const shortestInputUs = Math.min(
    proof.playerDurationUs,
    proof.video.durationUs,
    proof.audio?.durationUs ?? Number.MAX_SAFE_INTEGER
  );
  if (sourceEndUs > shortestInputUs) {
    fail("직접 미디어 구간이 증명된 입력 범위를 벗어났습니다.", "INVALID_SECTION");
  }
  const inputs = normalizeInputs(request.runtimeInputs, proof, dependencies);
  const initialRuntimeFingerprint = runtimeFingerprint(proof, inputs);
  const processTimeoutMs = request.processTimeoutMs
    ?? DEFAULT_EXTERNAL_VOD_DIRECT_PROCESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(processTimeoutMs) || processTimeoutMs <= 0) {
    fail("직접 미디어 FFmpeg 시간 제한이 올바르지 않습니다.", "INVALID_SECTION");
  }
  const durationToleranceMs = checkedTolerance(request.durationToleranceMs);
  const requireAudio = request.requireAudio ?? Boolean(inputs.audio);
  if (requireAudio && !inputs.audio) {
    fail("오디오가 필요한데 증명된 직접 오디오 입력이 없습니다.", "INVALID_SECTION");
  }

  const workDirectory = path.resolve(request.workDirectory);
  const outputPath = path.resolve(request.outputPath);
  assertPrivateOutputPath(workDirectory, outputPath);
  await mkdir(workDirectory, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const acquisitionDirectory = await mkdtemp(path.join(
    workDirectory,
    process.platform === "win32" ? ".d-" : ".direct-acquire-"
  ));
  await chmod(acquisitionDirectory, 0o700);
  let published = false;
  try {
    const temporaryOutputPath = path.join(
      acquisitionDirectory,
      process.platform === "win32" ? "s.mp4" : "section.mp4"
    );
    const processOptions: ExternalVodDirectProcessOptions = {
      cwd: acquisitionDirectory,
      timeoutMs: processTimeoutMs,
      ...(request.signal ? { signal: request.signal } : {})
    };
    let processResult: ExternalVodDirectProcessResult;
    try {
      processResult = await dependencies.runProcess(
        dependencies.ffmpegBinary,
        buildExternalVodDirectFfmpegArgs({
          inputs,
          outputPath: temporaryOutputPath,
          sourceStartUs,
          durationUs
        }),
        processOptions
      );
    } catch (error) {
      abortIfRequested(request.signal);
      if (error instanceof ExternalVodDirectAcquisitionError) {
        throw error;
      }
      fail("직접 미디어 구간을 정밀 취득하지 못했습니다.", "MEDIA_MUX_FAILED");
    }
    if (processResult.exitCode !== 0) {
      fail("직접 미디어 구간을 정밀 취득하지 못했습니다.", "MEDIA_MUX_FAILED");
    }
    const temporarySizeBytes = await safeRegularFileSize(temporaryOutputPath);
    let inspection: ExternalVodDirectOutputInspection;
    try {
      inspection = await dependencies.inspectOutput(temporaryOutputPath, processOptions);
    } catch (error) {
      if (error instanceof ExternalVodDirectAcquisitionError) {
        throw error;
      }
      fail("정밀 취득한 직접 미디어를 검사하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
    }
    assertOutputInspection(
      inspection,
      request.sourceEndMs - request.sourceStartMs,
      durationToleranceMs,
      requireAudio
    );

    let currentProof: ExternalVodDirectClockProof;
    let currentInputs: NormalizedExternalVodDirectInputs;
    try {
      currentProof = normalizeClockProof(request.clockProof);
      currentInputs = normalizeInputs(request.runtimeInputs, currentProof, dependencies);
    } catch {
      fail("직접 미디어 실행 입력이 취득 중 바뀌었습니다.", "SOURCE_CHANGED");
    }
    if (runtimeFingerprint(currentProof, currentInputs) !== initialRuntimeFingerprint) {
      fail("직접 미디어 실행 입력이 취득 중 바뀌었습니다.", "SOURCE_CHANGED");
    }

    const temporarySha256 = await hashFile(temporaryOutputPath, request.signal);
    try {
      await copyFile(temporaryOutputPath, outputPath, fsConstants.COPYFILE_EXCL);
      published = true;
      await chmod(outputPath, 0o600);
    } catch {
      fail("직접 미디어 결과를 안전하게 게시하지 못했습니다.", "UNSAFE_OUTPUT_PATH");
    }
    const outputSizeBytes = await safeRegularFileSize(outputPath);
    const outputSha256 = await hashFile(outputPath, request.signal);
    if (outputSizeBytes !== temporarySizeBytes || outputSha256 !== temporarySha256) {
      fail("게시한 직접 미디어 결과가 검증본과 다릅니다.", "MEDIA_VERIFICATION_FAILED");
    }

    const evidenceWithoutId: Omit<ExternalVodDirectSectionEvidence, "evidenceId"> = {
      schemaId: EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA,
      sectionId: request.sectionId,
      partProofId: request.partProofId,
      clockProofId: proof.proofId,
      encodingProfileSha256: EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256,
      sourceStartUs,
      sourceEndUs,
      hasSeparateAudio: Boolean(inputs.audio),
      mapping: {
        sourceAnchorUs: sourceStartUs,
        outputAnchorUs: 0,
        rateNumerator: 1,
        rateDenominator: 1
      },
      output: {
        durationMs: inspection.durationMs,
        sizeBytes: outputSizeBytes,
        contentSha256: outputSha256
      }
    };
    return {
      outputPath,
      inspection,
      evidence: {
        ...evidenceWithoutId,
        evidenceId: externalVodDirectSectionEvidenceId(evidenceWithoutId)
      }
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
