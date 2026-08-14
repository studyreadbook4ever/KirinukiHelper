import { createHash } from "node:crypto";

import {
  externalVodHlsPlaylistFingerprintSha256,
  MAX_EXTERNAL_VOD_HLS_SEGMENTS,
  selectExternalVodHlsSegmentRange
} from "./external-vod-hls-acquirer.js";
import type {
  ExternalVodHlsTimeline,
  SelectedExternalVodHlsSegmentRange
} from "./external-vod-hls-acquirer.js";
import type {
  ExternalVodDirectClockProof,
  ExternalVodDirectRuntimeInputs
} from "./external-vod-direct-acquirer.js";
import { externalVodDirectClockProofId } from "./external-vod-direct-acquirer.js";
import {
  safeExternalVodRequestHeaders,
  secretFreeExternalVodUrlIdentity
} from "./external-vod-transfer.js";
import type {
  ExternalVodTransferPlatform
} from "./external-vod-transfer.js";

export const EXTERNAL_VOD_SECTION_CLOCK_EVIDENCE_SCHEMA =
  "chzzk-kirinuki/external-vod-section-clock-evidence-v1";
export const MAX_EXTERNAL_VOD_SELECTED_DUMP_BYTES = 32 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_MEDIA_PLAYLIST_BYTES = 4 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_CLOCK_DURATION_US =
  7 * 24 * 60 * 60 * 1_000_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[^\u0000-\u001f\u007f/?#&=]{1,240}$/u;
const SAFE_FORMAT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,159}$/u;
const DECIMAL_SECONDS_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,9}))?$/u;
const HLS_ATTRIBUTE_URI_PATTERN = /(?:^|,)URI="([^"]+)"(?:,|$)/u;
const FORBIDDEN_HLS_TAG = /^(?:#EXT-X-(?:BYTERANGE|DISCONTINUITY|GAP|I-FRAMES-ONLY|KEY|PART|PRELOAD-HINT|RENDITION-REPORT|SKIP)(?::|$)|#EXT-X-STREAM-INF(?::|$)|#EXT-X-MEDIA:)/u;
const ALLOWED_HLS_TAG = /^(?:#EXTM3U|#EXT-X-(?:ALLOW-CACHE|DATERANGE|DISCONTINUITY-SEQUENCE|ENDLIST|INDEPENDENT-SEGMENTS|MAP|MEDIA-SEQUENCE|PLAYLIST-TYPE|PROGRAM-DATE-TIME|TARGETDURATION|TOTAL_DURATION|VERSION):?|#EXTINF:)/u;

type UnknownRecord = Record<string, unknown>;

export type ExternalVodClockPlatform = ExternalVodTransferPlatform;

export interface ExternalVodSelectedFormatProof {
  selectedFormatProofId: string;
  formatId: string;
  protocol: string;
  extension: string;
  videoCodec: string;
  audioCodec: string;
  width: number | null;
  height: number | null;
  frameRateMilli: number | null;
}

export interface ExternalVodSelectedHlsInput {
  kind: "hls";
  platform: "CHZZK" | "SOOP";
  contentId: string;
  partId: string;
  metadataDurationUs: number;
  format: ExternalVodSelectedFormatProof;
  playlistUrl: string;
  playlistSemanticIdentity: string;
  publicHeaders: Readonly<Record<string, string>>;
}

export interface ExternalVodSelectedDirectInput {
  url: string;
  semanticIdentity: string;
  semanticIdentitySha256: string;
  publicHeaders: Readonly<Record<string, string>>;
}

export interface ExternalVodSelectedDirectInputs {
  kind: "direct";
  platform: "YOUTUBE";
  contentId: string;
  partId: string;
  metadataDurationUs: number;
  format: ExternalVodSelectedFormatProof;
  video: ExternalVodSelectedDirectInput;
  audio?: ExternalVodSelectedDirectInput;
}

export type ParsedYtDlpSelectedInputs =
  | ExternalVodSelectedHlsInput
  | ExternalVodSelectedDirectInputs;

export interface ExternalVodDirectFfprobePayloads {
  video: string;
  audio?: string;
}

export interface ParsedExternalVodDirectClock {
  clockProof: ExternalVodDirectClockProof;
  runtimeInputs: ExternalVodDirectRuntimeInputs;
}

export interface ExternalVodSectionClockEvidence {
  schemaId: typeof EXTERNAL_VOD_SECTION_CLOCK_EVIDENCE_SCHEMA;
  evidenceId: string;
  platform: ExternalVodClockPlatform;
  contentId: string;
  partId: string;
  partIndex: number;
  playlistItem: number | null;
  kind: "hls" | "direct";
  playerDurationUs: number;
  selectedFormatProofId: string;
  clockProofId: string;
  hls: {
    playlistFingerprintSha256: string;
    renditionFingerprintSha256: string;
    segmentCount: number;
  } | null;
  direct: {
    zeroOrigin: true;
    videoDurationUs: number;
    audioDurationUs: number | null;
  } | null;
}

export class ExternalVodClockProofError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodClockProofError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodClockProofError(message, code);
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(
  value: UnknownRecord,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} 필드 구성이 올바르지 않습니다.`, "INVALID_CLOCK_EVIDENCE");
  }
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_SELECTED_SOURCE");
  }
  return value;
}

function safeSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, "INVALID_CLOCK_EVIDENCE");
  }
  return value;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
  code = "INVALID_CLOCK_EVIDENCE"
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, code);
  }
  return Number(value);
}

function secondsToUs(value: unknown, label: string): number {
  const text = typeof value === "number" || typeof value === "string"
    ? String(value)
    : "";
  const match = DECIMAL_SECONDS_PATTERN.exec(text);
  if (!match) {
    fail(`${label} 재생 시간을 확인할 수 없습니다.`, "INVALID_CLOCK_SOURCE");
  }
  const [wholeText, fractionText = ""] = text.split(".");
  const whole = Number(wholeText);
  const fractionUs = Number((fractionText + "000000").slice(0, 6));
  const roundedExtra = fractionText.length > 6
    && Number(fractionText[6]) >= 5
    ? 1
    : 0;
  const valueUs = whole * 1_000_000 + fractionUs + roundedExtra;
  if (
    !Number.isSafeInteger(valueUs)
    || valueUs <= 0
    || valueUs > MAX_EXTERNAL_VOD_CLOCK_DURATION_US
  ) {
    fail(`${label} 재생 시간이 안전한 범위를 벗어났습니다.`, "INVALID_CLOCK_SOURCE");
  }
  return valueUs;
}

function optionalFiniteInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function publicHeaders(value: unknown): Readonly<Record<string, string>> {
  if (value !== undefined && value !== null && !isRecord(value)) {
    fail("선택 미디어 요청 헤더가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  for (const key of Object.keys((value ?? {}) as UnknownRecord)) {
    if (/^(?:authorization|cookie|proxy-authorization)$/iu.test(key)) {
      fail("선택 미디어에 인증 헤더가 포함되었습니다.", "RESTRICTED_SOURCE");
    }
  }
  return safeExternalVodRequestHeaders(value);
}

function directPublicHeaders(value: unknown): Readonly<Record<string, string>> {
  const headers = { ...publicHeaders(value) };
  delete headers["accept-encoding"];
  return Object.freeze(headers);
}

function runtimeHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16 * 1024) {
    fail("선택 미디어 주소가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("선택 미디어 주소가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("선택 미디어 주소가 안전하지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  return url.href;
}

function normalizedSelectedRecord(payload: UnknownRecord): UnknownRecord {
  const downloads = Array.isArray(payload.requested_downloads)
    ? payload.requested_downloads.filter(isRecord)
    : [];
  if (downloads.length > 1) {
    fail("선택된 병합 출력이 둘 이상입니다.", "INVALID_SELECTED_SOURCE");
  }
  const selected = downloads[0];
  return selected && typeof selected.url === "string" ? selected : payload;
}

function selectedFormatProof(
  payload: UnknownRecord,
  selected: UnknownRecord
): ExternalVodSelectedFormatProof {
  const formatId = String(selected.format_id ?? payload.format_id ?? "");
  const protocol = String(selected.protocol ?? payload.protocol ?? "").toLowerCase();
  const extension = String(selected.ext ?? payload.ext ?? "").toLowerCase();
  const videoCodec = String(selected.vcodec ?? payload.vcodec ?? "").toLowerCase();
  const audioCodec = String(selected.acodec ?? payload.acodec ?? "").toLowerCase();
  if (
    !SAFE_FORMAT_ID_PATTERN.test(formatId)
    || !/^[a-z0-9_+.-]{1,80}$/u.test(protocol)
    || !/^[a-z0-9]{1,12}$/u.test(extension)
    || !videoCodec
    || !audioCodec
  ) {
    fail("선택 포맷 식별자가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  const normalizedWithoutId = {
    formatId,
    protocol,
    extension,
    videoCodec,
    audioCodec,
    width: optionalFiniteInteger(selected.width ?? payload.width),
    height: optionalFiniteInteger(selected.height ?? payload.height),
    frameRateMilli: (() => {
      const fps = Number(selected.fps ?? payload.fps);
      return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1_000) : null;
    })()
  };
  return {
    selectedFormatProofId: sha256(stableJson(normalizedWithoutId)),
    ...normalizedWithoutId
  };
}

function parseSelectedJson(rawJson: string): UnknownRecord {
  if (
    typeof rawJson !== "string"
    || Buffer.byteLength(rawJson, "utf8") > MAX_EXTERNAL_VOD_SELECTED_DUMP_BYTES
  ) {
    fail("선택 포맷 JSON이 크기 상한을 넘었습니다.", "INVALID_SELECTED_SOURCE");
  }
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    fail("선택 포맷 JSON을 읽지 못했습니다.", "INVALID_SELECTED_SOURCE");
  }
  if (!isRecord(value)) {
    fail("선택 포맷 JSON 구조가 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
  }
  return value;
}

/** Parses the exact selector-applied yt-dlp dump. Runtime URLs never enter evidence. */
export function parseYtDlpSelectedInputsDump(
  rawJson: string,
  {
    platform,
    contentId,
    partId = contentId
  }: {
    platform: ExternalVodClockPlatform;
    contentId: string;
    partId?: string;
  }
): ParsedYtDlpSelectedInputs {
  const payload = parseSelectedJson(rawJson);
  const expectedContentId = safeId(contentId, "VOD 원본 ID");
  const expectedPartId = safeId(partId, "VOD 파트 ID");
  const extractor = String(payload.extractor ?? "").toLowerCase();
  const expectedExtractor = platform === "YOUTUBE"
    ? "youtube"
    : platform === "CHZZK"
      ? "chzzk:video"
      : "soop";
  if (extractor !== expectedExtractor) {
    fail("선택 포맷 extractor가 요청 플랫폼과 다릅니다.", "SOURCE_CHANGED");
  }
  const payloadId = String(payload.id ?? "");
  if (
    (platform !== "SOOP" && payloadId !== expectedContentId)
    || (platform === "SOOP" && payloadId !== expectedPartId)
  ) {
    fail("선택 포맷의 원본 또는 파트 ID가 요청과 다릅니다.", "SOURCE_CHANGED");
  }
  const metadataDurationUs = secondsToUs(payload.duration, "선택 포맷");

  if (platform === "YOUTUBE") {
    const requested = Array.isArray(payload.requested_formats)
      ? payload.requested_formats.filter(isRecord)
      : [];
    if (requested.length < 1 || requested.length > 2) {
      fail("YouTube 선택 입력 구성이 올바르지 않습니다.", "INVALID_SELECTED_SOURCE");
    }
    const videoRecords = requested.filter((record) => (
      String(record.vcodec ?? "none") !== "none"
      && String(record.acodec ?? "none") === "none"
    ));
    const audioRecords = requested.filter((record) => (
      String(record.vcodec ?? "none") === "none"
      && String(record.acodec ?? "none") !== "none"
    ));
    if (videoRecords.length !== 1 || audioRecords.length > 1) {
      fail("YouTube 영상·오디오 선택 입력이 모호합니다.", "INVALID_SELECTED_SOURCE");
    }
    const videoRecord = videoRecords[0]!;
    const audioRecord = audioRecords[0];
    const combinedFormat = selectedFormatProof(payload, payload);
    if (!combinedFormat.protocol.split("+").every((item) => item === "https")) {
      fail("YouTube 선택 포맷이 직접 HTTPS 입력이 아닙니다.", "UNSUPPORTED_MEDIA");
    }
    const normalizedInput = (
      record: UnknownRecord,
      kind: "video" | "audio"
    ): ExternalVodSelectedDirectInput => {
      const protocol = String(record.protocol ?? "").toLowerCase();
      const extension = String(record.ext ?? "").toLowerCase();
      const videoCodec = String(record.vcodec ?? "").toLowerCase();
      const audioCodec = String(record.acodec ?? "").toLowerCase();
      if (
        protocol !== "https"
        || (kind === "video" && (extension !== "mp4" || !videoCodec.startsWith("avc1")))
        || (kind === "audio" && (extension !== "m4a" || !audioCodec.startsWith("mp4a")))
      ) {
        fail("YouTube 직접 입력 포맷이 편집 규격과 다릅니다.", "UNSUPPORTED_MEDIA");
      }
      const url = runtimeHttpsUrl(record.url);
      // googlevideo edge hosts and signed query/path components can rotate
      // between the initial and completion probes. Bind the clock to the
      // public source + exact selected stream format instead of CDN routing.
      const inputFormat = selectedFormatProof(record, record);
      const semanticIdentity = [
        "youtube",
        expectedContentId,
        expectedPartId,
        kind,
        "format",
        inputFormat.selectedFormatProofId
      ].join(":");
      return {
        url,
        semanticIdentity,
        semanticIdentitySha256: sha256(semanticIdentity),
        publicHeaders: directPublicHeaders(record.http_headers ?? payload.http_headers)
      };
    };
    const video = normalizedInput(videoRecord, "video");
    const audio = audioRecord ? normalizedInput(audioRecord, "audio") : undefined;
    return {
      kind: "direct",
      platform: "YOUTUBE",
      contentId: expectedContentId,
      partId: expectedPartId,
      metadataDurationUs,
      format: combinedFormat,
      video,
      ...(audio ? { audio } : {})
    };
  }

  const selected = normalizedSelectedRecord(payload);
  const format = selectedFormatProof(payload, selected);
  if (
    !["m3u8", "m3u8_native"].includes(format.protocol)
    || format.extension !== "mp4"
    || !/^avc(?:1)?(?:[._]|$)/u.test(format.videoCodec)
    || !/^mp4a(?:[._]|$)/u.test(format.audioCodec)
  ) {
    fail(`${platform} 선택 포맷이 지원하는 HLS H.264/AAC가 아닙니다.`, "UNSUPPORTED_MEDIA");
  }
  const playlistUrl = runtimeHttpsUrl(selected.url ?? payload.url);
  return {
    kind: "hls",
    platform,
    contentId: expectedContentId,
    partId: expectedPartId,
    metadataDurationUs,
    format,
    playlistUrl,
    playlistSemanticIdentity: secretFreeExternalVodUrlIdentity(playlistUrl),
    publicHeaders: publicHeaders(selected.http_headers ?? payload.http_headers)
  };
}

function resolvedPlaylistUri(base: URL, value: string, label: string): string {
  if (!value || value.length > 16 * 1024 || /[\0\r\n]/u.test(value)) {
    fail(`${label} URI가 올바르지 않습니다.`, "INVALID_HLS_PLAYLIST");
  }
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    fail(`${label} URI가 올바르지 않습니다.`, "INVALID_HLS_PLAYLIST");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail(`${label} URI가 안전하지 않습니다.`, "INVALID_HLS_PLAYLIST");
  }
  return url.href;
}

function mapUri(line: string): string {
  const value = line.slice("#EXT-X-MAP:".length);
  const match = HLS_ATTRIBUTE_URI_PATTERN.exec(value);
  if (!match || /(?:^|,)BYTERANGE=/u.test(value)) {
    fail("HLS 초기화 조각 URI가 올바르지 않습니다.", "INVALID_HLS_PLAYLIST");
  }
  return match[1]!;
}

function durationUsFromExtInf(line: string): number {
  const value = line.slice("#EXTINF:".length).split(",", 1)[0] ?? "";
  return secondsToUs(value, "HLS 세그먼트");
}

/** Strict finite fMP4 media-playlist parser using cumulative EXTINF as player time. */
export function parseVodHlsMediaPlaylist(
  rawPlaylist: string,
  {
    playlistUrl,
    renditionFingerprintSha256
  }: {
    playlistUrl: string;
    renditionFingerprintSha256: string;
  }
): ExternalVodHlsTimeline {
  if (
    typeof rawPlaylist !== "string"
    || Buffer.byteLength(rawPlaylist, "utf8") > MAX_EXTERNAL_VOD_MEDIA_PLAYLIST_BYTES
    || !SHA256_PATTERN.test(renditionFingerprintSha256)
  ) {
    fail("HLS 재생목록 또는 rendition 증명이 올바르지 않습니다.", "INVALID_HLS_PLAYLIST");
  }
  const playlistHref = runtimeHttpsUrl(playlistUrl);
  const base = new URL(playlistHref);
  const lines = rawPlaylist.replace(/^\uFEFF/u, "").split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") {
    fail("HLS 미디어 재생목록 표식이 없습니다.", "INVALID_HLS_PLAYLIST");
  }
  let mediaSequence = 0;
  let sawMediaSequence = false;
  let sawIndependent = false;
  let sawEndList = false;
  let sawTargetDuration = false;
  let mapHref: string | undefined;
  let pendingDurationUs: number | undefined;
  let cursorUs = 0;
  const segments: ExternalVodHlsTimeline["segments"] extends readonly (infer T)[]
    ? T[]
    : never = [];
  for (const line of lines.slice(1)) {
    if (FORBIDDEN_HLS_TAG.test(line)) {
      fail("암호화·불연속·부분 HLS 시간축은 지원하지 않습니다.", "UNSUPPORTED_HLS_PLAYLIST");
    }
    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-") && !ALLOWED_HLS_TAG.test(line)) {
        fail("알 수 없는 HLS 확장 태그를 안전하게 해석할 수 없습니다.", "UNSUPPORTED_HLS_PLAYLIST");
      }
      if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
        sawIndependent = true;
      } else if (line === "#EXT-X-ENDLIST") {
        sawEndList = true;
      } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        const value = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length));
        if (!Number.isSafeInteger(value) || value < 0 || sawMediaSequence || segments.length > 0) {
          fail("HLS 미디어 순번이 올바르지 않습니다.", "INVALID_HLS_PLAYLIST");
        }
        mediaSequence = value;
        sawMediaSequence = true;
      } else if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
        if (line !== "#EXT-X-DISCONTINUITY-SEQUENCE:0") {
          fail("HLS 불연속 기준이 0이 아닙니다.", "UNSUPPORTED_HLS_PLAYLIST");
        }
      } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        const value = Number(line.slice("#EXT-X-TARGETDURATION:".length));
        if (!Number.isSafeInteger(value) || value <= 0 || sawTargetDuration) {
          fail("HLS 목표 세그먼트 길이가 올바르지 않습니다.", "INVALID_HLS_PLAYLIST");
        }
        sawTargetDuration = true;
      } else if (line.startsWith("#EXT-X-MAP:")) {
        const resolved = resolvedPlaylistUri(base, mapUri(line), "HLS 초기화 조각");
        if (mapHref !== undefined && mapHref !== resolved) {
          fail("HLS 초기화 조각이 재생 중 바뀝니다.", "UNSUPPORTED_HLS_PLAYLIST");
        }
        mapHref = resolved;
      } else if (line.startsWith("#EXTINF:")) {
        if (pendingDurationUs !== undefined || sawEndList) {
          fail("HLS 세그먼트 길이 순서가 올바르지 않습니다.", "INVALID_HLS_PLAYLIST");
        }
        pendingDurationUs = durationUsFromExtInf(line);
      }
      continue;
    }
    if (pendingDurationUs === undefined || sawEndList || !mapHref) {
      fail("HLS 세그먼트 URI 앞에 길이와 초기화 조각이 없습니다.", "INVALID_HLS_PLAYLIST");
    }
    if (segments.length >= MAX_EXTERNAL_VOD_HLS_SEGMENTS) {
      fail("HLS 세그먼트 수가 안전 상한을 넘었습니다.", "INVALID_HLS_PLAYLIST");
    }
    const href = resolvedPlaylistUri(base, line, "HLS 세그먼트");
    const semanticUri = secretFreeExternalVodUrlIdentity(href);
    segments.push({
      sequence: mediaSequence + segments.length,
      startUs: cursorUs,
      durationUs: pendingDurationUs,
      uri: href,
      semanticUri
    });
    cursorUs += pendingDurationUs;
    if (!Number.isSafeInteger(cursorUs) || cursorUs > MAX_EXTERNAL_VOD_CLOCK_DURATION_US) {
      fail("HLS 누적 시간축이 안전 범위를 벗어났습니다.", "INVALID_HLS_PLAYLIST");
    }
    pendingDurationUs = undefined;
  }
  if (
    pendingDurationUs !== undefined
    || !mapHref
    || segments.length === 0
    || !sawIndependent
    || !sawEndList
    || !sawTargetDuration
  ) {
    fail("종료·독립 세그먼트가 증명된 완전한 HLS가 아닙니다.", "INVALID_HLS_PLAYLIST");
  }
  const mapSemanticUri = secretFreeExternalVodUrlIdentity(mapHref);
  const timelineWithoutFingerprint = {
    playlistUri: playlistHref,
    playlistSemanticUri: secretFreeExternalVodUrlIdentity(playlistHref),
    durationUs: cursorUs,
    hasEndList: true as const,
    hasIndependentSegments: true as const,
    map: { uri: mapHref, semanticUri: mapSemanticUri },
    segments
  };
  return {
    ...timelineWithoutFingerprint,
    playlistFingerprintSha256: externalVodHlsPlaylistFingerprintSha256(
      timelineWithoutFingerprint
    ),
    renditionFingerprintSha256
  };
}

export function planVodHlsSection(
  timeline: ExternalVodHlsTimeline,
  sourceStartMs: number,
  sourceEndMs: number
): SelectedExternalVodHlsSegmentRange {
  return selectExternalVodHlsSegmentRange(timeline, sourceStartMs, sourceEndMs);
}

function ffprobeRecord(rawJson: string, label: string): UnknownRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    fail(`${label} ffprobe JSON을 읽지 못했습니다.`, "INVALID_DIRECT_CLOCK");
  }
  if (!isRecord(parsed)) {
    fail(`${label} ffprobe JSON 구조가 올바르지 않습니다.`, "INVALID_DIRECT_CLOCK");
  }
  return parsed;
}

function directInputTimeline(
  rawJson: string,
  expectedType: "video" | "audio"
): { startUs: 0; durationUs: number } {
  const parsed = ffprobeRecord(rawJson, expectedType === "video" ? "비디오" : "오디오");
  const format = isRecord(parsed.format) ? parsed.format : undefined;
  const streams = Array.isArray(parsed.streams) ? parsed.streams.filter(isRecord) : [];
  const selectedStreams = streams.filter((stream) => stream.codec_type === expectedType);
  if (!format || selectedStreams.length !== 1) {
    fail("직접 미디어 스트림 구성이 올바르지 않습니다.", "INVALID_DIRECT_CLOCK");
  }
  const stream = selectedStreams[0]!;
  const codecName = String(stream.codec_name ?? "").toLowerCase();
  if (
    (expectedType === "video" && codecName !== "h264")
    || (expectedType === "audio" && codecName !== "aac")
  ) {
    fail("직접 미디어 codec이 편집 규격과 다릅니다.", "UNSUPPORTED_MEDIA");
  }
  const rawStarts = [format.start_time, stream.start_time];
  if (rawStarts.some((value) => (
    value === undefined
    || value === null
    || value === "N/A"
    || !["string", "number"].includes(typeof value)
    || (typeof value === "string" && value.trim().length === 0)
  ))) {
    fail("직접 미디어 입력의 0초 원점을 증명하지 못했습니다.", "NONZERO_DIRECT_ORIGIN");
  }
  const starts = rawStarts.map((value) => Number(value));
  if (starts.some((value) => !Number.isFinite(value) || Math.abs(value) > 0.000_001)) {
    fail("직접 미디어 입력의 0초 원점을 증명하지 못했습니다.", "NONZERO_DIRECT_ORIGIN");
  }
  const durations = [format.duration, stream.duration]
    .filter((value) => value !== undefined && value !== null && value !== "N/A")
    .map((value) => secondsToUs(value, `직접 ${expectedType}`));
  if (durations.length === 0) {
    fail("직접 미디어 입력 길이를 증명하지 못했습니다.", "INVALID_DIRECT_CLOCK");
  }
  return { startUs: 0, durationUs: Math.min(...durations) };
}

/** Builds a content-addressed, zero-origin proof from exact remote inputs. */
export function parseDirectMediaFfprobeClockProof(
  selected: ExternalVodSelectedDirectInputs,
  payloads: ExternalVodDirectFfprobePayloads
): ParsedExternalVodDirectClock {
  if (selected.kind !== "direct" || selected.platform !== "YOUTUBE") {
    fail("직접 미디어 증명 대상이 YouTube 입력이 아닙니다.", "INVALID_DIRECT_CLOCK");
  }
  if ((selected.audio === undefined) !== (payloads.audio === undefined)) {
    fail("선택 입력과 ffprobe 오디오 구성이 다릅니다.", "INVALID_DIRECT_CLOCK");
  }
  const video = directInputTimeline(payloads.video, "video");
  const audio = payloads.audio
    ? directInputTimeline(payloads.audio, "audio")
    : undefined;
  const playerDurationUs = Math.min(
    selected.metadataDurationUs,
    video.durationUs,
    audio?.durationUs ?? Number.MAX_SAFE_INTEGER
  );
  const withoutId = {
    playerDurationUs,
    zeroOrigin: true as const,
    video: {
      semanticIdentitySha256: selected.video.semanticIdentitySha256,
      startUs: 0 as const,
      durationUs: video.durationUs
    },
    ...(audio && selected.audio
      ? {
        audio: {
          semanticIdentitySha256: selected.audio.semanticIdentitySha256,
          startUs: 0 as const,
          durationUs: audio.durationUs
        }
      }
      : {})
  };
  const proofId = externalVodDirectClockProofId(withoutId);
  return {
    clockProof: { proofId, ...withoutId },
    runtimeInputs: {
      video: {
        url: selected.video.url,
        semanticIdentity: selected.video.semanticIdentity,
        publicHeaders: selected.video.publicHeaders
      },
      ...(selected.audio
        ? {
          audio: {
            url: selected.audio.url,
            semanticIdentity: selected.audio.semanticIdentity,
            publicHeaders: selected.audio.publicHeaders
          }
        }
        : {})
    }
  };
}

export function createExternalVodSectionClockEvidence({
  platform,
  contentId,
  partId,
  partIndex,
  playlistItem,
  selectedFormatProofId,
  timeline,
  directClockProof
}: {
  platform: ExternalVodClockPlatform;
  contentId: string;
  partId: string;
  partIndex: number;
  playlistItem?: number;
  selectedFormatProofId: string;
  timeline?: ExternalVodHlsTimeline;
  directClockProof?: ExternalVodDirectClockProof;
}): ExternalVodSectionClockEvidence {
  if ((timeline === undefined) === (directClockProof === undefined)) {
    fail("파트 시간축 증명 종류가 하나로 정해지지 않았습니다.", "INVALID_CLOCK_EVIDENCE");
  }
  const normalizedContentId = safeId(contentId, "VOD 원본 ID");
  const normalizedPartId = safeId(partId, "VOD 파트 ID");
  safeInteger(partIndex, 0, 499, "VOD 파트 순번");
  if (playlistItem !== undefined) {
    safeInteger(playlistItem, 1, 500, "VOD 재생목록 순번");
  }
  safeSha(selectedFormatProofId, "선택 포맷");
  const clockProofId = timeline
    ? sha256(stableJson({
      playlistFingerprintSha256: timeline.playlistFingerprintSha256,
      renditionFingerprintSha256: timeline.renditionFingerprintSha256,
      durationUs: timeline.durationUs,
      segmentCount: timeline.segments.length
    }))
    : safeSha(directClockProof!.proofId, "직접 미디어 시간축");
  const withoutId: Omit<ExternalVodSectionClockEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_SECTION_CLOCK_EVIDENCE_SCHEMA,
    platform,
    contentId: normalizedContentId,
    partId: normalizedPartId,
    partIndex,
    playlistItem: playlistItem ?? null,
    kind: timeline ? "hls" : "direct",
    playerDurationUs: timeline
      ? timeline.durationUs
      : directClockProof!.playerDurationUs,
    selectedFormatProofId,
    clockProofId,
    hls: timeline
      ? {
        playlistFingerprintSha256: timeline.playlistFingerprintSha256,
        renditionFingerprintSha256: timeline.renditionFingerprintSha256,
        segmentCount: timeline.segments.length
      }
      : null,
    direct: directClockProof
      ? {
        zeroOrigin: true,
        videoDurationUs: directClockProof.video.durationUs,
        audioDurationUs: directClockProof.audio?.durationUs ?? null
      }
      : null
  };
  return { ...withoutId, evidenceId: sha256(stableJson(withoutId)) };
}

export function parseExternalVodSectionClockEvidence(
  value: unknown
): ExternalVodSectionClockEvidence {
  if (!isRecord(value)) {
    fail("파트 시간축 증거가 올바르지 않습니다.", "INVALID_CLOCK_EVIDENCE");
  }
  exactKeys(value, [
    "schemaId", "evidenceId", "platform", "contentId", "partId",
    "partIndex", "playlistItem", "kind", "playerDurationUs",
    "selectedFormatProofId", "clockProofId", "hls", "direct"
  ], "파트 시간축 증거");
  if (
    value.schemaId !== EXTERNAL_VOD_SECTION_CLOCK_EVIDENCE_SCHEMA
    || !["CHZZK", "YOUTUBE", "SOOP"].includes(String(value.platform))
    || !["hls", "direct"].includes(String(value.kind))
  ) {
    fail("파트 시간축 증거 버전 또는 종류가 올바르지 않습니다.", "INVALID_CLOCK_EVIDENCE");
  }
  const kind = value.kind as "hls" | "direct";
  const hls = value.hls;
  const direct = value.direct;
  if ((kind === "hls") !== isRecord(hls) || (kind === "direct") !== isRecord(direct)) {
    fail("파트 시간축 증거 본문과 종류가 다릅니다.", "INVALID_CLOCK_EVIDENCE");
  }
  let normalizedHls: ExternalVodSectionClockEvidence["hls"] = null;
  let normalizedDirect: ExternalVodSectionClockEvidence["direct"] = null;
  if (isRecord(hls)) {
    exactKeys(hls, [
      "playlistFingerprintSha256", "renditionFingerprintSha256", "segmentCount"
    ], "HLS 파트 시간축 증거");
    normalizedHls = {
      playlistFingerprintSha256: safeSha(hls.playlistFingerprintSha256, "HLS 재생목록"),
      renditionFingerprintSha256: safeSha(hls.renditionFingerprintSha256, "HLS rendition"),
      segmentCount: safeInteger(hls.segmentCount, 1, MAX_EXTERNAL_VOD_HLS_SEGMENTS, "HLS 세그먼트 수")
    };
  }
  if (isRecord(direct)) {
    exactKeys(direct, ["zeroOrigin", "videoDurationUs", "audioDurationUs"], "직접 파트 시간축 증거");
    if (direct.zeroOrigin !== true) {
      fail("직접 미디어 원점이 0초가 아닙니다.", "INVALID_CLOCK_EVIDENCE");
    }
    normalizedDirect = {
      zeroOrigin: true,
      videoDurationUs: safeInteger(
        direct.videoDurationUs, 1, MAX_EXTERNAL_VOD_CLOCK_DURATION_US,
        "직접 비디오 길이"
      ),
      audioDurationUs: direct.audioDurationUs === null
        ? null
        : safeInteger(
          direct.audioDurationUs, 1, MAX_EXTERNAL_VOD_CLOCK_DURATION_US,
          "직접 오디오 길이"
        )
    };
  }
  const normalizedWithoutId: Omit<ExternalVodSectionClockEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_SECTION_CLOCK_EVIDENCE_SCHEMA,
    platform: value.platform as ExternalVodClockPlatform,
    contentId: safeId(value.contentId, "VOD 원본 ID"),
    partId: safeId(value.partId, "VOD 파트 ID"),
    partIndex: safeInteger(value.partIndex, 0, 499, "VOD 파트 순번"),
    playlistItem: value.playlistItem === null
      ? null
      : safeInteger(value.playlistItem, 1, 500, "VOD 재생목록 순번"),
    kind,
    playerDurationUs: safeInteger(
      value.playerDurationUs, 1, MAX_EXTERNAL_VOD_CLOCK_DURATION_US,
      "플레이어 파트 길이"
    ),
    selectedFormatProofId: safeSha(value.selectedFormatProofId, "선택 포맷"),
    clockProofId: safeSha(value.clockProofId, "파트 시간축"),
    hls: normalizedHls,
    direct: normalizedDirect
  };
  if (
    (normalizedWithoutId.platform === "YOUTUBE") !== (kind === "direct")
    || (normalizedWithoutId.platform === "SOOP") !== (
      normalizedWithoutId.playlistItem !== null
    )
  ) {
    fail("플랫폼과 파트 시간축 증명 종류가 다릅니다.", "INVALID_CLOCK_EVIDENCE");
  }
  const expectedId = sha256(stableJson(normalizedWithoutId));
  if (safeSha(value.evidenceId, "파트 시간축 증거") !== expectedId) {
    fail("파트 시간축 증거 ID가 본문과 다릅니다.", "INVALID_CLOCK_EVIDENCE");
  }
  return { ...normalizedWithoutId, evidenceId: expectedId };
}

export function assertExternalVodSectionClockEvidenceMatches(
  expectedValue: unknown,
  actualValue: unknown
): void {
  const expected = parseExternalVodSectionClockEvidence(expectedValue);
  const actual = parseExternalVodSectionClockEvidence(actualValue);
  if (expected.evidenceId !== actual.evidenceId) {
    fail("외부 VOD 선택 포맷 또는 시간축이 처리 중 바뀌었습니다.", "SOURCE_CHANGED");
  }
}
