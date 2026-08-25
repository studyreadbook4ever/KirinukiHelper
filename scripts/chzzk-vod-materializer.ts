import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream
} from "node:fs";
import type { BigIntStats } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA,
  createMaterializationClipCoverages,
  expandSegmentTimeline,
  createMaterializationWindows,
  planSegmentRuns,
  mergeMaterializationClipCoverages,
  prependDecoderPrefixSegments,
  substituteSegmentTemplate
} from "../src/lib/chzzk-vod-materialization.js";
import type {
  ChzzkVodMaterialization,
  ExpandedMpdSegment,
  LogicalMaterializationWindow,
  MaterializationClipCoverage,
  MaterializationWindow,
  MaterializationClipRange,
  MaterializationDesiredEditableRange,
  MpdSegmentTimelineEntry,
  PlannedSegmentRun
} from "../src/lib/chzzk-vod-materialization.js";
import {
  vodConsumerChzzkContentRoot,
  vodConsumerMaterializationDirectory,
  vodConsumerScopeHash
} from "./vod-consumer-scope.js";
import {
  terminatePosixProcessGroup
} from "./process-tree-termination.js";
import {
  CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE
} from "./chzzk-job-lease-heartbeat-worker-source.js";

export const LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID =
  "chzzk-kirinuki/chzzk-vod-materialization-v1";
export const CHZZK_VOD_MATERIALIZATION_SCHEMA_ID =
  "chzzk-kirinuki/chzzk-vod-materialization-v2";
export const DEFAULT_CHZZK_VOD_HANDLE_MS = 10_000;
export const DEFAULT_CHZZK_VOD_STATE_DIRECTORY_NAME =
  "kirinuki-vod-runtime/vod-fragments";
export const MAX_DECODER_PREFIX_SEGMENTS = 12;
export const MAX_SEGMENT_DOWNLOAD_ATTEMPTS = 4;

const CHZZK_PAGE_HOST = "chzzk.naver.com";
const CHZZK_METADATA_HOST = "api.chzzk.naver.com";
const CHZZK_PLAYBACK_HOST = "apis.naver.com";
const CHZZK_VIDEO_PATH_PATTERN = /^\/video\/(\d+)\/?$/u;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_XML_NODES = 250_000;
const MAX_XML_DEPTH = 128;
const MAX_PLAYBACK_DURATION_MS = 2_592_000_000;
const MIN_TS_PACKETS = 3;
const TS_PACKET_BYTES = 188;
const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const MAX_SAFE_REDIRECTS = 5;
const CHZZK_JOB_LEASE_SCHEMA_ID = "chzzk-kirinuki/chzzk-vod-job-lease-v3";
const CHZZK_JOB_LEASE_DATABASE_FILENAME = ".materializing-lock.sqlite3";
const CHZZK_STORAGE_GENERATION = "v3";
const CHZZK_JOB_LOCK_HEARTBEAT_INTERVAL_MS = 5_000;
const CHZZK_JOB_LOCK_LEASE_MS = 30_000;
const CHZZK_JOB_LOCK_BUSY_TIMEOUT_MS = 5_000;
const CHZZK_PUBLIC_ORIGIN = `https://${CHZZK_PAGE_HOST}`;
const CHZZK_PUBLIC_USER_AGENT =
  "KirinukiHelper/1.0 (local authorized editing)";

export type ChzzkVodMaterializationPhase =
  | "resolving"
  | "planning"
  | "downloading"
  | "verifying"
  | "muxing"
  | "completed";

export interface ChzzkVodClipRange {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ChzzkVodQuality {
  representationId: string;
  width: number;
  height: number;
  bandwidth: number;
  frameRate: number;
  videoCodec: "h264";
  audioCodec: "aac";
}

export interface ParsedChzzkMpdRepresentation extends ChzzkVodQuality {
  timescale: number;
  presentationTimeOffset: number;
  startNumber: number;
  segments: readonly ExpandedMpdSegment[];
}

export interface ParsedChzzkMpd {
  durationMs: number;
  representations: readonly ParsedChzzkMpdRepresentation[];
}

export interface ChzzkVodPlaybackSource {
  readonly canonicalUrl: string;
  readonly contentId: string;
  readonly durationSeconds: number;
  readonly manifestUrl: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
}

export interface ChzzkVodMaterializationArtifact {
  hashSha256: string;
  sizeBytes: number;
  durationMs: number;
}

export interface ChzzkVodMaterializationReceiptClip {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
  editableSourceStartMs: number;
  editableSourceEndMs: number;
}

export interface ChzzkVodMaterializationManifest {
  schemaId:
    | typeof CHZZK_VOD_MATERIALIZATION_SCHEMA_ID
    | typeof LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID;
  materializationId: string;
  planFingerprint: string;
  canonicalUrl: string;
  contentId: string;
  durationMs: number;
  mediaDurationMs: number;
  handleMs: number;
  quality: ChzzkVodQuality;
  timelineDigest: string;
  /** v2 only: hash(videoId + semantic MPD timeline), never the raw videoId. */
  sourceVersionId?: string;
  clips: readonly ChzzkVodMaterializationReceiptClip[];
  windows: readonly MaterializationWindow[];
  artifact: ChzzkVodMaterializationArtifact;
  preparedAt: string;
}

export interface ChzzkVodMaterializationProgress {
  phase: ChzzkVodMaterializationPhase;
  completedSegments: number;
  totalSegments: number;
  completedBytes: number;
}

export interface ChzzkVodMaterializationRequest {
  consumerId: string;
  sourceUrl: string;
  clips: readonly ChzzkVodClipRange[];
  editableRanges?: readonly ChzzkVodEditableRange[];
  handleMs?: number;
  stateDir?: string;
  resume?: ChzzkVodMaterializationResumeIdentity;
  base?: ChzzkVodMaterializationResumeIdentity;
  signal?: AbortSignal;
  onProgress?: (progress: ChzzkVodMaterializationProgress) => void;
}

export interface ChzzkVodEditableRange {
  id: string;
  startMs: number;
  endMs: number;
}

export interface ChzzkVodMaterializationResumeIdentity {
  materializationId: string;
  planFingerprint: string;
  contentId: string;
}

export interface ReopenChzzkVodMaterializationRequest
  extends ChzzkVodMaterializationResumeIdentity {
  consumerId: string;
  clips: readonly ChzzkVodClipRange[];
  editableRanges?: readonly ChzzkVodEditableRange[];
  handleMs?: number;
  stateDir?: string;
  signal?: AbortSignal;
}

export interface ChzzkVodMaterializationResult {
  manifest: ChzzkVodMaterialization;
  receipt: ChzzkVodMaterializationManifest;
  artifactPath: string;
  reused: boolean;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ChzzkVodMaterializerDependencies {
  fetchImpl?: typeof globalThis.fetch;
  runProcess?: (
    command: string,
    args: readonly string[],
    options: ProcessRunOptions
  ) => Promise<ProcessResult>;
  ffmpegBinary?: string;
  ffprobeBinary?: string;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  /** Deterministic concurrency barrier used by the lock protocol tests. */
  beforeStaleJobLeaseCompareAndSwap?: () => Promise<void>;
  /** Shorter cadence used only by deterministic lock protocol tests. */
  jobLeaseHeartbeatIntervalMs?: number;
}

export class ChzzkVodMaterializationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ChzzkVodMaterializationError";
    this.code = code;
  }
}

export const DEFAULT_CHZZK_PROCESS_TIMEOUT_MS = 30 * 60 * 1_000;
export const CHZZK_PROCESS_KILL_GRACE_MS = 5_000;
export const MAX_CHZZK_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;

interface XmlElement {
  name: string;
  attributes: Readonly<Record<string, string>>;
  children: XmlElement[];
  text: string;
}

interface InternalRepresentation extends ParsedChzzkMpdRepresentation {
  baseUrl: URL;
  mediaTemplate: string;
}

interface ResolvedChzzkVod {
  canonicalUrl: string;
  contentId: string;
  durationMs: number;
  quality: ChzzkVodQuality;
  representation: ParsedChzzkMpdRepresentation;
  timelineDigest: string;
  sourceVersionId: string;
  segments: readonly ExpandedMpdSegment[];
  segmentUrls: ReadonlyMap<string, URL>;
}

interface SegmentCheckpointEntry {
  key: string;
  hashSha256: string;
  sizeBytes: number;
}

interface MaterializationCheckpoint {
  schemaId: "chzzk-kirinuki/chzzk-vod-checkpoint-v2";
  canonicalUrl: string;
  contentId: string;
  timelineDigest: string;
  sourceVersionId: string;
  qualityIdentity: string;
  segments: readonly SegmentCheckpointEntry[];
}

interface ProbeStream {
  codec_type?: unknown;
  codec_name?: unknown;
  start_time?: unknown;
  duration?: unknown;
}

interface ProbePacket {
  codec_type?: unknown;
  flags?: unknown;
  pts_time?: unknown;
  dts_time?: unknown;
  duration_time?: unknown;
}

interface ProbePayload {
  streams?: unknown;
  packets?: unknown;
  format?: unknown;
}

function fail(message: string, code: string): never {
  throw new ChzzkVodMaterializationError(message, code);
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("CHZZK VOD 편집 구간 준비가 취소되었습니다.", "CANCELLED");
  }
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/gu,
    (match, decimal: string | undefined, hexadecimal: string | undefined,
      named: string | undefined) => {
      if (decimal !== undefined || hexadecimal !== undefined) {
        const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", decimal ? 10 : 16);
        if (
          !Number.isInteger(codePoint)
          || codePoint <= 0
          || codePoint > 0x10ffff
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          fail("MPD에 올바르지 않은 XML 문자 참조가 있습니다.", "INVALID_MPD");
        }
        return String.fromCodePoint(codePoint);
      }
      const values: Readonly<Record<string, string>> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'"
      };
      return values[named ?? ""] ?? match;
    }
  ).replace(/&[^;\s<>&]{1,64};/gu, () => (
    fail("MPD에 지원하지 않는 XML entity가 있습니다.", "INVALID_MPD")
  ));
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index] ?? "";
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseTagContents(raw: string): {
  name: string;
  attributes: Readonly<Record<string, string>>;
} {
  let cursor = 0;
  const skipSpace = (): void => {
    while (/\s/u.test(raw[cursor] ?? "")) {
      cursor += 1;
    }
  };
  const readName = (): string => {
    const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(raw.slice(cursor));
    if (!match) {
      fail("MPD XML 태그 또는 속성 이름이 올바르지 않습니다.", "INVALID_MPD");
    }
    cursor += match[0].length;
    return match[0];
  };
  skipSpace();
  const name = readName();
  const attributes: Record<string, string> = {};
  while (cursor < raw.length) {
    skipSpace();
    if (cursor >= raw.length) {
      break;
    }
    const attributeName = readName();
    if (Object.hasOwn(attributes, attributeName)) {
      fail("MPD XML에 중복 속성이 있습니다.", "INVALID_MPD");
    }
    skipSpace();
    if (raw[cursor] !== "=") {
      fail("MPD XML 속성 형식이 올바르지 않습니다.", "INVALID_MPD");
    }
    cursor += 1;
    skipSpace();
    const quote = raw[cursor];
    if (quote !== "\"" && quote !== "'") {
      fail("MPD XML 속성 값은 따옴표로 감싸야 합니다.", "INVALID_MPD");
    }
    cursor += 1;
    const end = raw.indexOf(quote, cursor);
    if (end < 0) {
      fail("MPD XML 속성 값이 닫히지 않았습니다.", "INVALID_MPD");
    }
    attributes[attributeName] = decodeXmlEntities(raw.slice(cursor, end));
    cursor = end + 1;
  }
  return { name, attributes };
}

function parseXml(xml: string): XmlElement {
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) {
    fail("MPD가 허용 크기를 초과했습니다.", "INVALID_MPD");
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    fail("외부 entity가 포함된 MPD는 처리하지 않습니다.", "INVALID_MPD");
  }
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let cursor = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodeCount = 0;
  while (cursor < xml.length) {
    const tagStart = xml.indexOf("<", cursor);
    if (tagStart < 0) {
      if (stack.length > 0) {
        stack.at(-1)!.text += decodeXmlEntities(xml.slice(cursor));
      } else if (xml.slice(cursor).trim()) {
        fail("MPD XML 루트 밖에 텍스트가 있습니다.", "INVALID_MPD");
      }
      break;
    }
    if (tagStart > cursor) {
      if (stack.length > 0) {
        stack.at(-1)!.text += decodeXmlEntities(xml.slice(cursor, tagStart));
      } else if (xml.slice(cursor, tagStart).trim()) {
        fail("MPD XML 루트 밖에 텍스트가 있습니다.", "INVALID_MPD");
      }
    }
    if (xml.startsWith("<!--", tagStart)) {
      const end = xml.indexOf("-->", tagStart + 4);
      if (end < 0) {
        fail("MPD XML 주석이 닫히지 않았습니다.", "INVALID_MPD");
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", tagStart)) {
      const end = xml.indexOf("]]>", tagStart + 9);
      if (end < 0) {
        fail("MPD XML CDATA가 닫히지 않았습니다.", "INVALID_MPD");
      }
      if (stack.length === 0) {
        fail("MPD 루트 밖에 CDATA가 있습니다.", "INVALID_MPD");
      }
      stack.at(-1)!.text += xml.slice(tagStart + 9, end);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", tagStart)) {
      const end = xml.indexOf("?>", tagStart + 2);
      if (end < 0) {
        fail("MPD XML 처리 지시문이 닫히지 않았습니다.", "INVALID_MPD");
      }
      cursor = end + 2;
      continue;
    }
    const tagEnd = findTagEnd(xml, tagStart + 1);
    if (tagEnd < 0) {
      fail("MPD XML 태그가 닫히지 않았습니다.", "INVALID_MPD");
    }
    let contents = xml.slice(tagStart + 1, tagEnd).trim();
    if (contents.startsWith("!")) {
      fail("지원하지 않는 MPD XML 선언입니다.", "INVALID_MPD");
    }
    if (contents.startsWith("/")) {
      const closingName = contents.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(closingName)) {
        fail("MPD XML 닫는 태그가 올바르지 않습니다.", "INVALID_MPD");
      }
      const element = stack.pop();
      if (!element || element.name !== closingName) {
        fail("MPD XML 태그의 중첩이 올바르지 않습니다.", "INVALID_MPD");
      }
      cursor = tagEnd + 1;
      continue;
    }
    const selfClosing = contents.endsWith("/");
    if (selfClosing) {
      contents = contents.slice(0, -1).trimEnd();
    }
    const parsed = parseTagContents(contents);
    const element: XmlElement = {
      name: parsed.name,
      attributes: parsed.attributes,
      children: [],
      text: ""
    };
    nodeCount += 1;
    if (nodeCount > MAX_XML_NODES) {
      fail("MPD XML 노드 수가 허용 한도를 초과했습니다.", "INVALID_MPD");
    }
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(element);
    } else if (root) {
      fail("MPD XML에는 루트 요소가 하나만 있어야 합니다.", "INVALID_MPD");
    } else {
      root = element;
    }
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > MAX_XML_DEPTH) {
        fail("MPD XML 중첩 깊이가 허용 한도를 초과했습니다.", "INVALID_MPD");
      }
    }
    cursor = tagEnd + 1;
  }
  if (stack.length > 0 || !root || localName(root.name) !== "MPD") {
    fail("완전한 DASH MPD 문서가 필요합니다.", "INVALID_MPD");
  }
  return root;
}

function directChildren(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => localName(child.name) === name);
}

function firstDirectChild(element: XmlElement, name: string): XmlElement | undefined {
  return directChildren(element, name)[0];
}

function attribute(element: XmlElement, name: string): string | undefined {
  const direct = element.attributes[name];
  if (direct !== undefined) {
    return direct;
  }
  const match = Object.entries(element.attributes).find(([candidate]) => (
    localName(candidate) === name
  ));
  return match?.[1];
}

function finiteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = finiteNumber(value, fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail("MPD에 올바르지 않은 양의 정수가 있습니다.", "INVALID_MPD");
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = finiteNumber(value, fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("MPD에 올바르지 않은 0 이상의 정수가 있습니다.", "INVALID_MPD");
  }
  return parsed;
}

function parseIsoDuration(value: string | undefined, fallback?: number): number {
  if (value === undefined || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    fail("MPD 재생 시간이 없습니다.", "INVALID_MPD");
  }
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u.exec(value);
  if (!match || match.slice(1).every((part) => part === undefined)) {
    fail("MPD ISO 8601 재생 시간이 올바르지 않습니다.", "INVALID_MPD");
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const milliseconds = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    fail("MPD 재생 시간이 허용 범위를 벗어났습니다.", "INVALID_MPD");
  }
  return milliseconds;
}

function parseFrameRate(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/u.exec(value);
  if (!match) {
    return 0;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2] ?? 1);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : 0;
}

function inheritedAttribute(
  elements: readonly XmlElement[],
  name: string
): string | undefined {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (!element) {
      continue;
    }
    const value = attribute(element, name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function resolveElementBaseUrl(parent: URL, element: XmlElement): URL {
  const base = firstDirectChild(element, "BaseURL")?.text.trim();
  if (!base) {
    return parent;
  }
  try {
    return new URL(base, parent);
  } catch {
    fail("MPD BaseURL이 올바르지 않습니다.", "INVALID_MPD");
  }
}

function segmentTemplateFor(
  elements: readonly XmlElement[]
): { attributes: Readonly<Record<string, string>>; timeline: XmlElement } {
  const templates = elements
    .map((element) => firstDirectChild(element, "SegmentTemplate"))
    .filter((element): element is XmlElement => element !== undefined);
  const merged: Record<string, string> = {};
  let timeline: XmlElement | undefined;
  for (const template of templates) {
    Object.assign(merged, template.attributes);
    timeline = firstDirectChild(template, "SegmentTimeline") ?? timeline;
  }
  if (!timeline || typeof merged.media !== "string" || !merged.media) {
    fail("CHZZK TS SegmentTemplate/SegmentTimeline을 찾지 못했습니다.", "UNSUPPORTED_MPD");
  }
  return { attributes: merged, timeline };
}

function parseTimelineEntries(timeline: XmlElement): MpdSegmentTimelineEntry[] {
  return directChildren(timeline, "S").map((entry) => {
    const d = positiveInteger(attribute(entry, "d"), Number.NaN);
    const tValue = attribute(entry, "t");
    const rValue = attribute(entry, "r");
    const result: MpdSegmentTimelineEntry = { d };
    if (tValue !== undefined) {
      result.t = nonNegativeInteger(tValue, Number.NaN);
    }
    if (rValue !== undefined) {
      const parsed = Number(rValue);
      if (!Number.isSafeInteger(parsed) || parsed < -1) {
        fail("MPD SegmentTimeline 반복 횟수가 올바르지 않습니다.", "INVALID_MPD");
      }
      result.r = parsed;
    }
    return result;
  });
}

function qualityIdentity(quality: ChzzkVodQuality): string {
  return [
    quality.representationId,
    quality.width,
    quality.height,
    quality.bandwidth,
    quality.frameRate.toFixed(6),
    quality.videoCodec,
    quality.audioCodec
  ].join(":");
}

function timelineDigestFor(
  durationMs: number,
  representation: ParsedChzzkMpdRepresentation
): string {
  const hash = createHash("sha256");
  hash.update(String(durationMs));
  hash.update("\0");
  hash.update(qualityIdentity(representation));
  for (const segment of representation.segments) {
    hash.update(`\0${segment.number}:${segment.time}:${segment.duration}:${segment.sourceStartMs}:${segment.sourceEndMs}`);
  }
  return hash.digest("hex");
}

function sourceVersionIdFor(
  sourceGenerationId: string,
  timelineDigest: string
): string {
  return sha256Text(stableJson({
    version: 1,
    platform: "CHZZK",
    sourceGenerationId,
    timelineDigest
  }));
}

function parseMpdInternal(xml: string, manifestUrl: URL): {
  durationMs: number;
  representations: InternalRepresentation[];
} {
  const root = parseXml(xml);
  const presentationType = attribute(root, "type")?.toLowerCase();
  if (presentationType && presentationType !== "static") {
    fail("동적/live MPD는 CHZZK VOD 편집 구간으로 준비하지 않습니다.", "UNSUPPORTED_MPD");
  }
  const durationMs = parseIsoDuration(attribute(root, "mediaPresentationDuration"));
  const rootBase = resolveElementBaseUrl(manifestUrl, root);
  const periods = directChildren(root, "Period");
  if (periods.length === 0) {
    fail("MPD에 Period가 없습니다.", "INVALID_MPD");
  }
  if (periods.length !== 1) {
    fail(
      "여러 Period를 잇는 CHZZK VOD MPD는 안전한 구간 매핑을 보장할 수 없습니다.",
      "UNSUPPORTED_MPD"
    );
  }
  const representations: InternalRepresentation[] = [];
  let inferredPeriodStartMs = 0;
  for (const period of periods) {
    const periodStartMs = parseIsoDuration(attribute(period, "start"), inferredPeriodStartMs);
    const explicitDuration = attribute(period, "duration");
    const periodDurationMs = parseIsoDuration(
      explicitDuration,
      Math.max(0, durationMs - periodStartMs)
    );
    inferredPeriodStartMs = periodStartMs + periodDurationMs;
    const periodBase = resolveElementBaseUrl(rootBase, period);
    for (const adaptation of directChildren(period, "AdaptationSet")) {
      const inherited = [root, period, adaptation];
      const mimeType = inheritedAttribute(inherited, "mimeType")?.toLowerCase() ?? "";
      if (mimeType !== "video/mp2t") {
        continue;
      }
      const adaptationBase = resolveElementBaseUrl(periodBase, adaptation);
      for (const representationElement of directChildren(adaptation, "Representation")) {
        const chain = [...inherited, representationElement];
        const codecs = (inheritedAttribute(chain, "codecs") ?? "").toLowerCase();
        if (!/(?:^|,)\s*(?:avc1|avc3|h264)/u.test(codecs)
          || !/(?:^|,)\s*(?:mp4a|aac)/u.test(codecs)) {
          continue;
        }
        const representationId = inheritedAttribute(chain, "id")?.trim() ?? "";
        if (
          !representationId
          || representationId.length > 128
          || !/^[A-Za-z0-9._-]+$/u.test(representationId)
        ) {
          continue;
        }
        const template = segmentTemplateFor(chain);
        const timescale = positiveInteger(template.attributes.timescale, 1);
        const presentationTimeOffset = nonNegativeInteger(
          template.attributes.presentationTimeOffset,
          0
        );
        const startNumber = nonNegativeInteger(template.attributes.startNumber, 1);
        const entries = parseTimelineEntries(template.timeline);
        if (entries.length === 0) {
          continue;
        }
        let segments: ExpandedMpdSegment[];
        try {
          segments = expandSegmentTimeline({
            timescale,
            presentationTimeOffset,
            periodStartMs,
            periodDurationMs,
            startNumber,
            entries
          });
        } catch {
          fail("MPD SegmentTimeline을 안전하게 펼칠 수 없습니다.", "INVALID_MPD");
        }
        if (segments.length === 0) {
          continue;
        }
        const width = nonNegativeInteger(inheritedAttribute(chain, "width"), 0);
        const height = nonNegativeInteger(inheritedAttribute(chain, "height"), 0);
        const bandwidth = nonNegativeInteger(
          inheritedAttribute(chain, "bandwidth"),
          0
        );
        const frameRate = parseFrameRate(inheritedAttribute(chain, "frameRate"));
        const representationBase = resolveElementBaseUrl(
          adaptationBase,
          representationElement
        );
        const mediaTemplate = template.attributes.media;
        if (!mediaTemplate) {
          fail("CHZZK TS media 템플릿이 비어 있습니다.", "INVALID_MPD");
        }
        representations.push({
          representationId,
          width,
          height,
          bandwidth,
          frameRate,
          videoCodec: "h264",
          audioCodec: "aac",
          timescale,
          presentationTimeOffset,
          startNumber,
          segments,
          baseUrl: representationBase,
          mediaTemplate
        });
      }
    }
  }
  if (representations.length === 0) {
    fail("muxed H.264/AAC MPEG-TS 표현을 찾지 못했습니다.", "UNSUPPORTED_MPD");
  }
  return { durationMs, representations };
}

function sanitizedRepresentation(
  representation: InternalRepresentation
): ParsedChzzkMpdRepresentation {
  return {
    representationId: representation.representationId,
    width: representation.width,
    height: representation.height,
    bandwidth: representation.bandwidth,
    frameRate: representation.frameRate,
    videoCodec: "h264",
    audioCodec: "aac",
    timescale: representation.timescale,
    presentationTimeOffset: representation.presentationTimeOffset,
    startNumber: representation.startNumber,
    segments: representation.segments
  };
}

export function parseChzzkMpd(xml: string): ParsedChzzkMpd {
  const parsed = parseMpdInternal(
    xml,
    new URL("https://apis.naver.com/chzzk-kirinuki/redacted")
  );
  return {
    durationMs: parsed.durationMs,
    representations: parsed.representations.map(sanitizedRepresentation)
  };
}

export function parseChzzkPlaybackHls(
  xml: string,
  manifestValue: URL | string
): Readonly<{
  durationSeconds: number;
  manifestUrl: string;
}> {
  let manifestUrl: URL;
  try {
    manifestUrl = manifestValue instanceof URL
      ? new URL(manifestValue.href)
      : new URL(manifestValue);
  } catch {
    fail("CHZZK 재생 정보 주소가 올바르지 않습니다.", "INVALID_MPD");
  }
  assertInternalTransferUrl(manifestUrl);
  const root = parseXml(xml);
  const presentationType = attribute(root, "type")?.toLowerCase();
  if (presentationType && presentationType !== "static") {
    fail("동적/live MPD는 CHZZK VOD 원본 플레이어로 연결하지 않습니다.", "UNSUPPORTED_MPD");
  }
  const durationMs = parseIsoDuration(attribute(root, "mediaPresentationDuration"));
  if (durationMs <= 0 || durationMs > MAX_PLAYBACK_DURATION_MS) {
    fail("CHZZK VOD 재생 시간이 허용 범위를 벗어났습니다.", "INVALID_MPD");
  }
  const candidates: Array<{
    bandwidth: number;
    frameRate: number;
    height: number;
    id: string;
    manifestUrl: URL;
    width: number;
  }> = [];
  for (const period of directChildren(root, "Period")) {
    for (const adaptation of directChildren(period, "AdaptationSet")) {
      const adaptationMimeType = attribute(adaptation, "mimeType")?.toLowerCase() ?? "";
      if (adaptationMimeType !== "video/mp2t") {
        continue;
      }
      for (const representation of directChildren(adaptation, "Representation")) {
        const chain = [root, period, adaptation, representation];
        const codecs = (inheritedAttribute(chain, "codecs") ?? "").toLowerCase();
        const id = inheritedAttribute(chain, "id")?.trim() ?? "";
        const width = nonNegativeInteger(inheritedAttribute(chain, "width"), 0);
        const height = nonNegativeInteger(inheritedAttribute(chain, "height"), 0);
        const bandwidth = nonNegativeInteger(
          inheritedAttribute(chain, "bandwidth"),
          0
        );
        const frameRate = parseFrameRate(inheritedAttribute(chain, "frameRate"));
        const hlsValue = inheritedAttribute(chain, "m3u")?.trim() ?? "";
        if (
          !id
          || !/^[A-Za-z0-9._-]+$/u.test(id)
          || id.length > 128
          || width <= 0
          || height <= 0
          || height > 1_080
          || !/(?:^|,)\s*(?:avc1|avc3|h264)/u.test(codecs)
          || !/(?:^|,)\s*(?:mp4a|aac)/u.test(codecs)
          || !hlsValue
        ) {
          continue;
        }
        let hlsUrl: URL;
        try {
          hlsUrl = new URL(hlsValue, manifestUrl);
        } catch {
          fail("CHZZK HLS 재생목록 주소가 올바르지 않습니다.", "INVALID_MPD");
        }
        assertInternalTransferUrl(hlsUrl);
        if (!/\.m3u8$/u.test(hlsUrl.pathname)) {
          fail("CHZZK HLS 재생목록 경로가 올바르지 않습니다.", "INVALID_MPD");
        }
        candidates.push({
          bandwidth,
          frameRate,
          height,
          id,
          manifestUrl: hlsUrl,
          width
        });
      }
    }
  }
  candidates.sort((left, right) => (
    right.height - left.height
    || right.width - left.width
    || right.bandwidth - left.bandwidth
    || right.frameRate - left.frameRate
    || left.id.localeCompare(right.id)
  ));
  const selected = candidates[0];
  if (!selected) {
    fail("CHZZK의 1080p 이하 muxed H.264/AAC HLS를 찾지 못했습니다.", "UNSUPPORTED_MPD");
  }
  return Object.freeze({
    durationSeconds: durationMs / 1_000,
    manifestUrl: selected.manifestUrl.href
  });
}

export function normalizeChzzkVodUrl(value: unknown): string {
  const raw = String(value);
  if (!/^https:\/\/chzzk\.naver\.com\/video\/\d+\/?$/u.test(raw)) {
    fail(
      "공개 https://chzzk.naver.com/video/<번호> VOD 주소만 사용할 수 있습니다.",
      "INVALID_SOURCE_URL"
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("올바른 CHZZK VOD 주소를 입력해 주세요.", "INVALID_SOURCE_URL");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== CHZZK_PAGE_HOST
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
  ) {
    fail(
      "공개 https://chzzk.naver.com/video/<번호> VOD 주소만 사용할 수 있습니다.",
      "INVALID_SOURCE_URL"
    );
  }
  const match = CHZZK_VIDEO_PATH_PATTERN.exec(url.pathname);
  if (!match?.[1]) {
    fail(
      "CHZZK 라이브·클립이 아닌 공개 VOD 영상 주소가 필요합니다.",
      "INVALID_SOURCE_URL"
    );
  }
  return `https://${CHZZK_PAGE_HOST}/video/${match[1]}`;
}

export function resolveChzzkVodStateDirectory(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir()
): string {
  const requested = override?.trim();
  if (requested) {
    if (/[\0\r\n]/u.test(requested)) {
      fail("로컬 조각 저장 경로가 올바르지 않습니다.", "INVALID_STATE_DIRECTORY");
    }
    return path.resolve(requested);
  }
  const configuredStateDirectory = env.KIRINUKI_VOD_STATE_DIR?.trim()
    || env.KIRINUKI_CHZZK_VOD_STATE_DIR?.trim();
  if (configuredStateDirectory) {
    if (
      !path.isAbsolute(configuredStateDirectory)
      || /[\0\r\n]/u.test(configuredStateDirectory)
    ) {
      fail(
        "VOD 상태 폴더 환경 변수에는 올바른 절대 경로가 필요합니다.",
        "INVALID_STATE_DIRECTORY"
      );
    }
    return path.resolve(configuredStateDirectory);
  }
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  if (xdgStateHome) {
    if (!path.isAbsolute(xdgStateHome) || /[\0\r\n]/u.test(xdgStateHome)) {
      fail(
        "XDG_STATE_HOME에는 올바른 절대 경로가 필요합니다.",
        "INVALID_STATE_DIRECTORY"
      );
    }
    return path.resolve(xdgStateHome, DEFAULT_CHZZK_VOD_STATE_DIRECTORY_NAME);
  }
  return path.resolve(
    homeDirectory,
    ".local",
    "state",
    DEFAULT_CHZZK_VOD_STATE_DIRECTORY_NAME
  );
}

function isAllowedTransferHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "naver.com"
    || normalized.endsWith(".naver.com")
    || normalized === "pstatic.net"
    || normalized.endsWith(".pstatic.net");
}

function assertInternalTransferUrl(url: URL): void {
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !isAllowedTransferHost(url.hostname)
  ) {
    fail("CHZZK가 허용되지 않은 미디어 호스트를 반환했습니다.", "UNSAFE_TRANSFER_HOST");
  }
}

function safeResponseUrl(response: Response): URL | undefined {
  if (!response.url) {
    return undefined;
  }
  try {
    return new URL(response.url);
  } catch {
    fail("원격 서버 응답 주소가 올바르지 않습니다.", "UNSAFE_TRANSFER_HOST");
  }
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

async function fetchWithValidatedRedirects(
  fetchImpl: typeof globalThis.fetch,
  initialUrl: URL,
  headers: Readonly<Record<string, string>>,
  isAllowedUrl: (url: URL) => boolean,
  signal?: AbortSignal
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount += 1) {
    abortIfRequested(signal);
    if (!isAllowedUrl(currentUrl)) {
      fail("원격 서버가 허용되지 않은 호스트를 가리켰습니다.", "UNSAFE_TRANSFER_HOST");
    }
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        headers,
        redirect: "manual",
        ...(signal ? { signal } : {})
      });
    } catch {
      abortIfRequested(signal);
      fail("CHZZK 공개 데이터 요청에 실패했습니다.", "NETWORK_REQUEST_FAILED");
    }
    const responseUrl = safeResponseUrl(response);
    if (responseUrl && !isAllowedUrl(responseUrl)) {
      await response.body?.cancel().catch(() => undefined);
      fail("원격 서버 응답이 허용되지 않은 호스트에서 왔습니다.", "UNSAFE_TRANSFER_HOST");
    }
    if (!isRedirectStatus(response.status)) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
    if (redirectCount === MAX_SAFE_REDIRECTS) {
      fail("CHZZK 공개 데이터의 이동 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
    }
    const location = response.headers.get("location");
    if (!location) {
      fail("CHZZK 공개 데이터 이동 주소가 없습니다.", "INVALID_REDIRECT");
    }
    let redirected: URL;
    try {
      redirected = new URL(location, currentUrl);
    } catch {
      fail("CHZZK 공개 데이터 이동 주소가 올바르지 않습니다.", "INVALID_REDIRECT");
    }
    if (!isAllowedUrl(redirected)) {
      fail("원격 서버가 허용되지 않은 호스트로 이동하려 했습니다.", "UNSAFE_TRANSFER_HOST");
    }
    currentUrl = redirected;
  }
  fail("CHZZK 공개 데이터의 이동 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
}

function chzzkPublicRequestHeaders(
  accept: string
): Readonly<Record<string, string>> {
  return {
    accept,
    "accept-encoding": "identity",
    origin: CHZZK_PUBLIC_ORIGIN,
    referer: `${CHZZK_PUBLIC_ORIGIN}/`,
    "user-agent": CHZZK_PUBLIC_USER_AGENT
  };
}

async function readResponseTextLimited(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal | undefined,
  code: string,
  tooLargeMessage: string
): Promise<string> {
  const declaredHeader = response.headers.get("content-length");
  const declaredLength = declaredHeader === null
    ? Number.NaN
    : Number(declaredHeader);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    fail(tooLargeMessage, code);
  }
  if (!response.body) {
    fail("원격 서버 응답 본문이 없습니다.", code);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  try {
    while (true) {
      abortIfRequested(signal);
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0) {
        continue;
      }
      sizeBytes += chunk.value.byteLength;
      if (sizeBytes > maximumBytes) {
        fail(tooLargeMessage, code);
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength
    )),
    sizeBytes
  ).toString("utf8");
}

async function fetchMetadataJson(
  fetchImpl: typeof globalThis.fetch,
  contentId: string,
  signal?: AbortSignal
): Promise<unknown> {
  abortIfRequested(signal);
  const url = `https://${CHZZK_METADATA_HOST}/service/v3/videos/${contentId}`;
  const response = await fetchWithValidatedRedirects(
    fetchImpl,
    new URL(url),
    chzzkPublicRequestHeaders("application/json"),
    (candidate) => (
      candidate.protocol === "https:"
      && candidate.hostname === CHZZK_METADATA_HOST
      && !candidate.username
      && !candidate.password
      && !candidate.port
    ),
    signal
  );
  const finalUrl = safeResponseUrl(response);
  if (finalUrl && (
    finalUrl.protocol !== "https:"
    || finalUrl.hostname !== CHZZK_METADATA_HOST
    || finalUrl.username
    || finalUrl.password
    || finalUrl.port
  )) {
    await response.body?.cancel().catch(() => undefined);
    fail("CHZZK 메타데이터가 허용되지 않은 호스트로 이동했습니다.", "UNSAFE_TRANSFER_HOST");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail(
      "CHZZK 공개 VOD 메타데이터를 가져오지 못했습니다.",
      "METADATA_REQUEST_FAILED"
    );
  }
  try {
    return JSON.parse(await readResponseTextLimited(
      response,
      MAX_METADATA_BYTES,
      signal,
      "INVALID_METADATA",
      "CHZZK VOD 메타데이터가 허용 크기를 초과했습니다."
    )) as unknown;
  } catch (error) {
    if (error instanceof ChzzkVodMaterializationError) {
      throw error;
    }
    abortIfRequested(signal);
    fail("CHZZK VOD 메타데이터 형식이 올바르지 않습니다.", "INVALID_METADATA");
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requiredMetadataString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/u.test(value)) {
    fail("CHZZK VOD 공개 메타데이터에 필요한 값이 없습니다.", "INVALID_METADATA");
  }
  return value.trim();
}

async function fetchPlaybackMpd(
  fetchImpl: typeof globalThis.fetch,
  videoId: string,
  inKey: string,
  signal?: AbortSignal
): Promise<{ xml: string; manifestUrl: URL }> {
  const manifestUrl = new URL(
    `https://${CHZZK_PLAYBACK_HOST}/neonplayer/vodplay/v1/playback/${encodeURIComponent(videoId)}`
  );
  manifestUrl.search = new URLSearchParams({
    key: inKey,
    env: "real",
    lc: "ko_KR",
    cpl: "ko_KR"
  }).toString();
  const response = await fetchWithValidatedRedirects(
    fetchImpl,
    manifestUrl,
    chzzkPublicRequestHeaders(
      "application/dash+xml, application/xml;q=0.9, text/xml;q=0.8"
    ),
    (candidate) => {
      try {
        assertInternalTransferUrl(candidate);
        return true;
      } catch {
        return false;
      }
    },
    signal
  );
  const responseUrl = safeResponseUrl(response);
  if (responseUrl) {
    assertInternalTransferUrl(responseUrl);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail("CHZZK 공개 재생 정보를 가져오지 못했습니다.", "PLAYBACK_REQUEST_FAILED");
  }
  const xml = await readResponseTextLimited(
    response,
    MAX_XML_BYTES,
    signal,
    "INVALID_MPD",
    "CHZZK MPD가 허용 크기를 초과했습니다."
  );
  return { xml, manifestUrl: responseUrl ?? manifestUrl };
}

function compareQuality(left: InternalRepresentation, right: InternalRepresentation): number {
  return left.height - right.height
    || left.width - right.width
    || left.bandwidth - right.bandwidth
    || left.frameRate - right.frameRate
    || left.representationId.localeCompare(right.representationId);
}

function segmentSemanticKey(segment: ExpandedMpdSegment): string {
  return `${segment.number}:${segment.time}:${segment.duration}`;
}

function buildSegmentUrls(
  representation: InternalRepresentation
): ReadonlyMap<string, URL> {
  const urls = new Map<string, URL>();
  for (const segment of representation.segments) {
    let substituted: string;
    try {
      substituted = substituteSegmentTemplate(representation.mediaTemplate, {
        representationId: representation.representationId,
        number: segment.number,
        time: segment.time
      });
    } catch {
      fail("CHZZK MPD 세그먼트 템플릿을 해석하지 못했습니다.", "INVALID_MPD");
    }
    let url: URL;
    try {
      url = new URL(substituted, representation.baseUrl);
    } catch {
      fail("CHZZK MPD 세그먼트 주소가 올바르지 않습니다.", "INVALID_MPD");
    }
    assertInternalTransferUrl(url);
    urls.set(segmentSemanticKey(segment), url);
  }
  return urls;
}

async function resolveChzzkVod(
  canonicalUrl: string,
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal
): Promise<ResolvedChzzkVod> {
  const pageUrl = new URL(canonicalUrl);
  const match = CHZZK_VIDEO_PATH_PATTERN.exec(pageUrl.pathname);
  const contentId = match?.[1];
  if (!contentId) {
    fail("정규화된 CHZZK VOD 주소가 필요합니다.", "INVALID_SOURCE_URL");
  }
  const payload = objectRecord(await fetchMetadataJson(fetchImpl, contentId, signal));
  const content = objectRecord(payload?.content);
  if (!content) {
    fail("공개 CHZZK VOD 메타데이터가 없습니다.", "INVALID_METADATA");
  }
  if (content.vodStatus !== "ABR_HLS") {
    fail("현재 공개 원본 조각을 받을 수 있는 CHZZK VOD가 아닙니다.", "VOD_UNAVAILABLE");
  }
  const videoId = requiredMetadataString(content, "videoId");
  const inKey = requiredMetadataString(content, "inKey");
  const playback = await fetchPlaybackMpd(fetchImpl, videoId, inKey, signal);
  const parsed = parseMpdInternal(playback.xml, playback.manifestUrl);
  const representation = [...parsed.representations].sort(compareQuality).at(-1);
  if (!representation) {
    fail("편집 가능한 CHZZK MPEG-TS 품질을 찾지 못했습니다.", "UNSUPPORTED_MPD");
  }
  const quality = sanitizedRepresentation(representation);
  const publicQuality: ChzzkVodQuality = {
    representationId: quality.representationId,
    width: quality.width,
    height: quality.height,
    bandwidth: quality.bandwidth,
    frameRate: quality.frameRate,
    videoCodec: "h264",
    audioCodec: "aac"
  };
  const timelineDigest = timelineDigestFor(parsed.durationMs, quality);
  return {
    canonicalUrl,
    contentId,
    durationMs: parsed.durationMs,
    quality: publicQuality,
    representation: quality,
    // Preserve the pre-v2 MPD semantic digest for legacy receipt recognition.
    // v2 binds cache/receipt identity to this separate hash so a replacement
    // video with an equal-looking MPD cannot reuse old TS bytes.
    timelineDigest,
    sourceVersionId: sourceVersionIdFor(videoId, timelineDigest),
    segments: representation.segments,
    segmentUrls: buildSegmentUrls(representation)
  };
}

export async function resolveChzzkVodPlaybackSource(
  sourceValue: unknown,
  {
    fetchImpl = globalThis.fetch,
    signal
  }: {
    readonly fetchImpl?: typeof globalThis.fetch;
    readonly signal?: AbortSignal;
  } = {}
): Promise<ChzzkVodPlaybackSource> {
  const canonicalUrl = normalizeChzzkVodUrl(sourceValue);
  const contentId = CHZZK_VIDEO_PATH_PATTERN.exec(new URL(canonicalUrl).pathname)?.[1];
  if (!contentId) {
    fail("정규화된 CHZZK VOD 주소가 필요합니다.", "INVALID_SOURCE_URL");
  }
  const payload = objectRecord(await fetchMetadataJson(fetchImpl, contentId, signal));
  const content = objectRecord(payload?.content);
  if (!content) {
    fail("공개 CHZZK VOD 메타데이터가 없습니다.", "INVALID_METADATA");
  }
  if (content.vodStatus !== "ABR_HLS") {
    fail("현재 HLS 원본 플레이어로 연결할 수 있는 CHZZK VOD가 아닙니다.", "VOD_UNAVAILABLE");
  }
  const videoId = requiredMetadataString(content, "videoId");
  const inKey = requiredMetadataString(content, "inKey");
  const playback = await fetchPlaybackMpd(fetchImpl, videoId, inKey, signal);
  const selected = parseChzzkPlaybackHls(playback.xml, playback.manifestUrl);
  return Object.freeze({
    canonicalUrl,
    contentId,
    durationSeconds: selected.durationSeconds,
    manifestUrl: selected.manifestUrl,
    requestHeaders: Object.freeze({
      ...chzzkPublicRequestHeaders(
        "application/vnd.apple.mpegurl, application/x-mpegURL;q=0.9, */*;q=0.8"
      ),
      referer: canonicalUrl
    })
  });
}

function validatedHandleMs(value: unknown): number {
  const handleMs = value === undefined ? DEFAULT_CHZZK_VOD_HANDLE_MS : Number(value);
  if (!Number.isSafeInteger(handleMs) || handleMs < 0 || handleMs > 60_000) {
    fail("편집 여유 구간은 0~60초 사이의 정수 밀리초여야 합니다.", "INVALID_CLIPS");
  }
  return handleMs;
}

function coreClipRanges(clips: readonly ChzzkVodClipRange[]): MaterializationClipRange[] {
  if (clips.length === 0 || clips.length > 10_000) {
    fail("한 개 이상의 유효한 편집 구간이 필요합니다.", "INVALID_CLIPS");
  }
  const ids = new Set<string>();
  return clips.map((clip) => {
    const id = String(clip.id).trim();
    if (!id || id.length > 256 || /[\0\r\n]/u.test(id) || ids.has(id)) {
      fail("편집 구간 ID는 중복되지 않는 짧은 문자열이어야 합니다.", "INVALID_CLIPS");
    }
    if (
      !Number.isSafeInteger(clip.startMs)
      || !Number.isSafeInteger(clip.endMs)
      || clip.startMs < 0
      || clip.endMs <= clip.startMs
    ) {
      fail("편집 구간 시작·끝 시간이 올바르지 않습니다.", "INVALID_CLIPS");
    }
    ids.add(id);
    return {
      clipId: id,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs
    };
  });
}

function coreDesiredEditableRanges(
  ranges: readonly ChzzkVodEditableRange[] | undefined
): MaterializationDesiredEditableRange[] | undefined {
  if (ranges === undefined) {
    return undefined;
  }
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > 10_000) {
    fail("확장 편집 범위는 한 개 이상의 유효한 구간이어야 합니다.", "INVALID_CLIPS");
  }
  const ids = new Set<string>();
  return ranges.map((range) => {
    const id = String(range?.id ?? "").trim();
    if (
      !id
      || id.length > 240
      || /[\u0000-\u001f\u007f/?#&=]/u.test(id)
      || ids.has(id)
      || !Number.isSafeInteger(range?.startMs)
      || !Number.isSafeInteger(range?.endMs)
      || range.startMs < 0
      || range.endMs <= range.startMs
    ) {
      fail("확장 편집 범위가 올바르지 않습니다.", "INVALID_CLIPS");
    }
    ids.add(id);
    return {
      clipId: id,
      editableSourceStartMs: range.startMs,
      editableSourceEndMs: range.endMs
    };
  });
}

function requestedClipCoverages(
  clips: readonly MaterializationClipRange[],
  sourceDurationMs: number,
  handleMs: number,
  desiredEditableRanges?: readonly MaterializationDesiredEditableRange[]
): MaterializationClipCoverage[] {
  try {
    return createMaterializationClipCoverages(
      clips,
      sourceDurationMs,
      handleMs,
      desiredEditableRanges
    );
  } catch (error) {
    if (error instanceof ChzzkVodMaterializationError) {
      throw error;
    }
    fail("확장 편집 범위가 원래 선택 또는 VOD 범위와 맞지 않습니다.", "INVALID_CLIPS");
  }
}

export interface ChzzkVodSegmentPlan {
  durationMs: number;
  handleMs: number;
  quality: ChzzkVodQuality;
  timelineDigest: string;
  clipRanges: readonly MaterializationClipCoverage[];
  logicalWindows: readonly LogicalMaterializationWindow[];
  runs: readonly PlannedSegmentRun[];
}

export function planChzzkVodMaterialization(
  parsed: ParsedChzzkMpd,
  clips: readonly ChzzkVodClipRange[],
  handleMs = DEFAULT_CHZZK_VOD_HANDLE_MS,
  editableRanges?: readonly ChzzkVodEditableRange[]
): ChzzkVodSegmentPlan {
  const normalizedHandleMs = validatedHandleMs(handleMs);
  if (!Number.isSafeInteger(parsed.durationMs) || parsed.durationMs <= 0) {
    fail("VOD 재생 시간이 올바르지 않습니다.", "INVALID_MPD");
  }
  const representation = [...parsed.representations]
    .sort((left, right) => left.height - right.height
      || left.width - right.width
      || left.bandwidth - right.bandwidth
      || left.frameRate - right.frameRate
      || left.representationId.localeCompare(right.representationId))
    .at(-1);
  if (!representation) {
    fail("편집 가능한 TS 표현이 없습니다.", "UNSUPPORTED_MPD");
  }
  const coreClips = coreClipRanges(clips);
  const clipRanges = requestedClipCoverages(
    coreClips,
    parsed.durationMs,
    normalizedHandleMs,
    coreDesiredEditableRanges(editableRanges)
  );
  const logicalWindows = mergeMaterializationClipCoverages(clipRanges);
  let runs: PlannedSegmentRun[];
  try {
    runs = planSegmentRuns(representation.segments, logicalWindows);
  } catch {
    fail("선택한 구간과 겹치는 CHZZK 미디어 조각을 찾지 못했습니다.", "INVALID_CLIPS");
  }
  if (runs.length === 0 || runs.some((run) => run.segments.length === 0)) {
    fail("선택한 구간과 겹치는 CHZZK 미디어 조각을 찾지 못했습니다.", "INVALID_CLIPS");
  }
  const quality: ChzzkVodQuality = {
    representationId: representation.representationId,
    width: representation.width,
    height: representation.height,
    bandwidth: representation.bandwidth,
    frameRate: representation.frameRate,
    videoCodec: "h264",
    audioCodec: "aac"
  };
  return {
    durationMs: parsed.durationMs,
    handleMs: normalizedHandleMs,
    quality,
    timelineDigest: timelineDigestFor(parsed.durationMs, representation),
    clipRanges,
    logicalWindows,
    runs
  };
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

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Produces a path-safe, opaque namespace for one editing consumer.
 * The domain separator prevents this digest from being interchangeable with
 * semantic plan/source hashes elsewhere in the materializer.
 */
export function chzzkVodConsumerScopeHash(value: unknown): string {
  try {
    return vodConsumerScopeHash(value);
  } catch {
    fail("CHZZK 로컬 편집 소비자 식별자가 올바르지 않습니다.", "INVALID_CONSUMER_ID");
  }
}

function legacyScopedChzzkJobDirectory(
  stateDirectory: string,
  consumerScopeHash: string,
  materializationId: string
): string {
  try {
    return vodConsumerMaterializationDirectory({
      stateDirectory,
      consumerScopeHash,
      platform: "chzzk",
      materializationId
    });
  } catch {
    fail("CHZZK 로컬 편집 작업 경로 식별자가 올바르지 않습니다.", "INVALID_CONSUMER_ID");
  }
}

function scopedChzzkJobDirectory(
  stateDirectory: string,
  consumerScopeHash: string,
  materializationId: string
): string {
  const legacyDirectory = legacyScopedChzzkJobDirectory(
    stateDirectory,
    consumerScopeHash,
    materializationId
  );
  return path.join(
    path.dirname(legacyDirectory),
    CHZZK_STORAGE_GENERATION,
    path.basename(legacyDirectory)
  );
}

function materializationPlanFingerprint(
  resolved: ResolvedChzzkVod,
  handleMs: number,
  runs: readonly PlannedSegmentRun[],
  clips: readonly MaterializationClipCoverage[]
): string {
  return sha256Text(stableJson({
    canonicalUrl: resolved.canonicalUrl,
    contentId: resolved.contentId,
    timelineDigest: resolved.timelineDigest,
    sourceVersionId: resolved.sourceVersionId,
    quality: qualityIdentity(resolved.quality),
    handleMs,
    clips: [...clips]
      .sort((left, right) => left.clipId.localeCompare(right.clipId))
      .map((clip) => ({
        id: clip.clipId,
        sourceStartMs: clip.sourceStartMs,
        sourceEndMs: clip.sourceEndMs,
        editableSourceStartMs: clip.editableSourceStartMs,
        editableSourceEndMs: clip.editableSourceEndMs
      })),
    runs: runs.map((run) => ({
      editableSourceStartMs: run.editableSourceStartMs,
      editableSourceEndMs: run.editableSourceEndMs,
      clipIds: [...run.clipIds].sort(),
      segments: run.segments.map(segmentSemanticKey)
    }))
  }));
}

export function sleepWithMaterializerAbort(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  abortIfRequested(signal);
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, milliseconds);
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new ChzzkVodMaterializationError(
        "CHZZK VOD 편집 구간 준비가 취소되었습니다.",
        "CANCELLED"
      ));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

export async function runMaterializerProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
  {
    spawnImpl = spawn,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    killProcessGroupImpl = (pid, signal) => process.kill(-pid, signal),
    probeProcessGroupImpl = (pid) => process.kill(-pid, 0),
    killGraceMs = CHZZK_PROCESS_KILL_GRACE_MS,
    platform = process.platform
  }: {
    spawnImpl?: typeof spawn;
    setTimeoutImpl?: typeof setTimeout;
    clearTimeoutImpl?: typeof clearTimeout;
    killProcessGroupImpl?: (pid: number, signal: NodeJS.Signals) => void;
    probeProcessGroupImpl?: (pid: number) => void;
    killGraceMs?: number;
    platform?: NodeJS.Platform;
  } = {}
): Promise<ProcessResult> {
  abortIfRequested(options.signal);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHZZK_PROCESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail("로컬 미디어 도구의 실행 시간 제한이 올바르지 않습니다.", "INVALID_PROCESS_TIMEOUT");
  }
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs < 0) {
    fail("로컬 미디어 도구의 종료 대기 시간이 올바르지 않습니다.", "INVALID_PROCESS_TIMEOUT");
  }
  return await new Promise((resolve, reject) => {
    const useProcessGroup = platform !== "win32";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(command, [...args], {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        ...(useProcessGroup ? { detached: true } : {})
      });
    } catch {
      reject(new ChzzkVodMaterializationError(
        "필요한 로컬 ffmpeg/ffprobe 도구를 실행하지 못했습니다.",
        "PROCESS_START_FAILED"
      ));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalOutputBytes = 0;
    let closed = false;
    let finalizing = false;
    let childError: Error | undefined;
    let terminationError: Error | undefined;
    let cleanupError: Error | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let windowsCloseDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let processTreeCleanupPromise: Promise<void> | undefined;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined): void => {
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
        : new Error("CHZZK 도구 process tree를 종료하지 못했습니다.");
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
    const terminate = (error: Error): void => {
      if (terminationError) {
        return;
      }
      terminationError = error;
      const pid = processId();
      if (platform === "win32") {
        // Node/libuv keeps the spawned Windows process HANDLE on this exact
        // ChildProcess. Never reopen a numeric PID with taskkill: the target
        // could exit and its PID could be reassigned before that second open.
        if (!signalLeader("SIGKILL")) {
          recordCleanupError(new Error(
            "Windows CHZZK 도구의 exact child handle 종료 요청이 실패했습니다."
          ));
        }
        windowsCloseDeadlineTimer = setTimeoutImpl(() => {
          if (finalizing) {
            return;
          }
          recordCleanupError(Object.assign(
            new Error("Windows CHZZK 도구가 exact child 종료 요청 뒤 닫히지 않았습니다."),
            { code: "EPROCESSCLOSEDEADLINE" }
          ));
          finalizing = true;
          clearTimer(timeoutTimer);
          clearTimer(forceKillTimer);
          options.signal?.removeEventListener("abort", abortListener);
          child.stdout?.destroy();
          child.stderr?.destroy();
          (child as typeof child & { unref?: () => void }).unref?.();
          const finalError = terminationError ?? cleanupError!;
          if (cleanupError && cleanupError !== finalError && finalError.cause === undefined) {
            Object.defineProperty(finalError, "cause", {
              configurable: true,
              value: cleanupError
            });
          }
          reject(finalError);
        }, Math.max(1, killGraceMs));
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
    const abortListener = (): void => {
      terminate(new ChzzkVodMaterializationError(
        "CHZZK VOD 편집 구간 준비가 취소되었습니다.",
        "CANCELLED"
      ));
    };
    const collect = (target: Buffer[], chunk: Buffer | string): void => {
      if (closed || terminationError) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalOutputBytes += buffer.length;
      if (totalOutputBytes > MAX_CHZZK_PROCESS_OUTPUT_BYTES) {
        terminate(new ChzzkVodMaterializationError(
          "로컬 미디어 검사 도구의 출력이 허용 크기를 초과했습니다.",
          "PROCESS_OUTPUT_LIMIT"
        ));
        return;
      }
      target.push(buffer);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => collect(stderr, chunk));
    child.once("error", () => {
      childError ??= new ChzzkVodMaterializationError(
        "필요한 로컬 ffmpeg/ffprobe 도구를 실행하지 못했습니다.",
        "PROCESS_START_FAILED"
      );
      if (processId() !== undefined) {
        terminate(childError);
      }
    });
    child.once("close", (exitCode) => {
      if (finalizing) {
        return;
      }
      closed = true;
      finalizing = true;
      clearTimer(timeoutTimer);
      clearTimer(windowsCloseDeadlineTimer);
      options.signal?.removeEventListener("abort", abortListener);
      void (async () => {
        const pid = processId();
        if (useProcessGroup && pid !== undefined) {
          await ensurePosixProcessGroupCleanup(pid);
        }
        if (processTreeCleanupPromise) {
          await processTreeCleanupPromise;
        }
        clearTimer(forceKillTimer);
        clearTimer(windowsCloseDeadlineTimer);
        const error = terminationError ?? childError ?? cleanupError;
        if (error) {
          if (cleanupError && cleanupError !== error && error.cause === undefined) {
            Object.defineProperty(error, "cause", {
              configurable: true,
              value: cleanupError
            });
          }
          reject(error);
          return;
        }
        resolve({
          exitCode: exitCode ?? -1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      })().catch(reject);
    });
    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) {
      abortListener();
    }
    if (!terminationError) {
      timeoutTimer = setTimeoutImpl(() => {
        terminate(new ChzzkVodMaterializationError(
          `로컬 미디어 도구가 ${timeoutMs}ms 시간 제한을 넘었습니다.`,
          "PROCESS_TIMEOUT"
        ));
      }, timeoutMs);
    }
  });
}

async function runCheckedProcess(
  runProcess: NonNullable<ChzzkVodMaterializerDependencies["runProcess"]>,
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
  failureCode: string,
  failureMessage: string
): Promise<ProcessResult> {
  let result: ProcessResult;
  try {
    result = await runProcess(command, args, options);
  } catch (error) {
    abortIfRequested(options.signal);
    if (error instanceof ChzzkVodMaterializationError) {
      throw error;
    }
    fail(failureMessage, failureCode);
  }
  if (result.exitCode !== 0) {
    fail(failureMessage, failureCode);
  }
  return result;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function atomicWriteJson(
  filePath: string,
  value: unknown,
  beforePublish?: () => void
): Promise<void> {
  const temporary = `${filePath}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    beforePublish?.();
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writeAll(
  handle: FileHandle,
  bytes: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset
    );
    if (bytesWritten <= 0) {
      fail("로컬 미디어 조각 파일 쓰기가 중단되었습니다.", "LOCAL_WRITE_FAILED");
    }
    offset += bytesWritten;
  }
}

async function sha256File(
  filePath: string,
  signal?: AbortSignal
): Promise<string> {
  abortIfRequested(signal);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    abortIfRequested(signal);
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function validateTransportStreamBytes(bytes: Uint8Array): void {
  if (bytes.byteLength < TS_PACKET_BYTES * MIN_TS_PACKETS) {
    fail("받은 CHZZK 미디어 조각이 너무 작습니다.", "INVALID_SEGMENT");
  }
  if (bytes.byteLength % TS_PACKET_BYTES !== 0) {
    fail("받은 CHZZK 미디어 조각의 MPEG-TS 길이가 올바르지 않습니다.", "INVALID_SEGMENT");
  }
  const packetCount = Math.min(MIN_TS_PACKETS + 8, bytes.byteLength / TS_PACKET_BYTES);
  for (let index = 0; index < packetCount; index += 1) {
    if (bytes[index * TS_PACKET_BYTES] !== 0x47) {
      fail("받은 CHZZK 미디어 조각의 MPEG-TS 동기 바이트가 올바르지 않습니다.", "INVALID_SEGMENT");
    }
  }
}

async function validateTransportStreamFile(filePath: string): Promise<number> {
  const status = await stat(filePath);
  if (!status.isFile() || status.size < TS_PACKET_BYTES * MIN_TS_PACKETS) {
    fail("로컬 CHZZK 미디어 조각 파일이 올바르지 않습니다.", "INVALID_SEGMENT");
  }
  if (status.size > MAX_SEGMENT_BYTES) {
    fail("CHZZK 미디어 조각 하나가 허용 크기를 초과했습니다.", "INVALID_SEGMENT");
  }
  const handle = await open(filePath, "r");
  try {
    const sampleLength = Math.min(status.size, TS_PACKET_BYTES * (MIN_TS_PACKETS + 8));
    const sample = Buffer.alloc(sampleLength);
    const { bytesRead } = await handle.read(sample, 0, sampleLength, 0);
    validateTransportStreamBytes(sample.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
  if (status.size % TS_PACKET_BYTES !== 0) {
    fail("로컬 CHZZK 미디어 조각의 크기가 MPEG-TS 패킷 경계와 맞지 않습니다.", "INVALID_SEGMENT");
  }
  return status.size;
}

function segmentCacheFilename(segment: ExpandedMpdSegment): string {
  return `${sha256Text(segmentSemanticKey(segment)).slice(0, 32)}.ts`;
}

async function loadCheckpoint(
  checkpointPath: string,
  resolved: ResolvedChzzkVod
): Promise<Map<string, SegmentCheckpointEntry>> {
  try {
    const value = JSON.parse(await readFile(checkpointPath, "utf8")) as unknown;
    const record = objectRecord(value);
    if (
      record?.schemaId !== "chzzk-kirinuki/chzzk-vod-checkpoint-v2"
      || record.canonicalUrl !== resolved.canonicalUrl
      || record.contentId !== resolved.contentId
      || record.timelineDigest !== resolved.timelineDigest
      || record.sourceVersionId !== resolved.sourceVersionId
      || record.qualityIdentity !== qualityIdentity(resolved.quality)
      || !Array.isArray(record.segments)
    ) {
      return new Map();
    }
    const entries = new Map<string, SegmentCheckpointEntry>();
    for (const raw of record.segments) {
      const entry = objectRecord(raw);
      if (
        !entry
        || typeof entry.key !== "string"
        || !/^[a-f0-9]{64}$/u.test(String(entry.hashSha256))
        || !Number.isSafeInteger(entry.sizeBytes)
        || Number(entry.sizeBytes) <= 0
      ) {
        return new Map();
      }
      entries.set(entry.key, {
        key: entry.key,
        hashSha256: String(entry.hashSha256),
        sizeBytes: Number(entry.sizeBytes)
      });
    }
    return entries;
  } catch {
    return new Map();
  }
}

async function saveCheckpoint(
  checkpointPath: string,
  resolved: ResolvedChzzkVod,
  entries: ReadonlyMap<string, SegmentCheckpointEntry>,
  beforePublish?: () => void
): Promise<void> {
  const value: MaterializationCheckpoint = {
    schemaId: "chzzk-kirinuki/chzzk-vod-checkpoint-v2",
    canonicalUrl: resolved.canonicalUrl,
    contentId: resolved.contentId,
    timelineDigest: resolved.timelineDigest,
    sourceVersionId: resolved.sourceVersionId,
    qualityIdentity: qualityIdentity(resolved.quality),
    segments: [...entries.values()].sort((left, right) => left.key.localeCompare(right.key))
  };
  await atomicWriteJson(checkpointPath, value, beforePublish);
}

class ExpiredTransferAuthorization extends Error {}

async function downloadSegmentAttempt(
  fetchImpl: typeof globalThis.fetch,
  url: URL,
  targetPath: string,
  signal?: AbortSignal,
  assertLeaseOwned?: () => void
): Promise<SegmentCheckpointEntry> {
  abortIfRequested(signal);
  const response = await fetchWithValidatedRedirects(
    fetchImpl,
    url,
    chzzkPublicRequestHeaders(
      "video/mp2t, application/octet-stream;q=0.8"
    ),
    (candidate) => {
      try {
        assertInternalTransferUrl(candidate);
        return true;
      } catch {
        return false;
      }
    },
    signal
  );
  const responseUrl = safeResponseUrl(response);
  if (responseUrl) {
    assertInternalTransferUrl(responseUrl);
  }
  if ([401, 403, 410].includes(response.status)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ExpiredTransferAuthorization();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail("CHZZK 미디어 조각을 받지 못했습니다.", "SEGMENT_REQUEST_FAILED");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SEGMENT_BYTES) {
    fail("CHZZK 미디어 조각 하나가 허용 크기를 초과했습니다.", "INVALID_SEGMENT");
  }
  if (!response.body) {
    fail("CHZZK 미디어 조각 응답 본문이 없습니다.", "INVALID_SEGMENT");
  }
  const temporary = `${targetPath}.part-${randomBytes(8).toString("hex")}`;
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const reader = response.body.getReader();
  let output: FileHandle | undefined;
  try {
    output = await open(temporary, "wx", 0o600);
    while (true) {
      abortIfRequested(signal);
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0) {
        continue;
      }
      sizeBytes += chunk.value.byteLength;
      if (sizeBytes > MAX_SEGMENT_BYTES) {
        fail("CHZZK 미디어 조각 하나가 허용 크기를 초과했습니다.", "INVALID_SEGMENT");
      }
      hash.update(chunk.value);
      await writeAll(output, chunk.value);
    }
    await output.sync();
    await output.close();
    output = undefined;
    abortIfRequested(signal);
    if (
      Number.isFinite(declaredLength)
      && declaredLength >= 0
      && declaredLength !== sizeBytes
    ) {
      fail("CHZZK 미디어 조각 길이가 응답 정보와 다릅니다.", "INVALID_SEGMENT");
    }
    await validateTransportStreamFile(temporary);
    assertLeaseOwned?.();
    await rename(temporary, targetPath);
  } catch (error) {
    throw error;
  } finally {
    await output?.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return {
    key: "",
    hashSha256: hash.digest("hex"),
    sizeBytes
  };
}

async function reusableSegment(
  segmentPath: string,
  entry: SegmentCheckpointEntry | undefined
): Promise<boolean> {
  if (!entry) {
    return false;
  }
  try {
    const sizeBytes = await validateTransportStreamFile(segmentPath);
    if (sizeBytes !== entry.sizeBytes) {
      return false;
    }
    return await sha256File(segmentPath) === entry.hashSha256;
  } catch {
    return false;
  }
}

async function ensureDownloadedSegment({
  segment,
  segmentDirectory,
  checkpoint,
  fetchImpl,
  currentResolved,
  refreshResolved,
  sleep,
  signal,
  assertLeaseOwned
}: {
  segment: ExpandedMpdSegment;
  segmentDirectory: string;
  checkpoint: Map<string, SegmentCheckpointEntry>;
  fetchImpl: typeof globalThis.fetch;
  currentResolved: () => ResolvedChzzkVod;
  refreshResolved: () => Promise<void>;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  assertLeaseOwned?: () => void;
}): Promise<{ filePath: string; downloadedBytes: number; reused: boolean }> {
  const key = segmentSemanticKey(segment);
  const filePath = path.join(segmentDirectory, segmentCacheFilename(segment));
  const checkpointEntry = checkpoint.get(key);
  if (await reusableSegment(filePath, checkpointEntry)) {
    return { filePath, downloadedBytes: 0, reused: true };
  }
  assertLeaseOwned?.();
  await rm(filePath, { force: true }).catch(() => undefined);
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SEGMENT_DOWNLOAD_ATTEMPTS; attempt += 1) {
    abortIfRequested(signal);
    const url = currentResolved().segmentUrls.get(key);
    if (!url) {
      fail("갱신된 CHZZK 재생 정보에 필요한 조각이 없습니다.", "SOURCE_CHANGED");
    }
    try {
      const entry = await downloadSegmentAttempt(
        fetchImpl,
        url,
        filePath,
        signal,
        assertLeaseOwned
      );
      const completed: SegmentCheckpointEntry = { ...entry, key };
      checkpoint.set(key, completed);
      return {
        filePath,
        downloadedBytes: completed.sizeBytes,
        reused: false
      };
    } catch (error) {
      abortIfRequested(signal);
      lastError = error;
      if (error instanceof ExpiredTransferAuthorization) {
        await refreshResolved();
      } else if (
        error instanceof ChzzkVodMaterializationError
        && ![
          "SEGMENT_REQUEST_FAILED",
          "NETWORK_REQUEST_FAILED",
          "INVALID_SEGMENT"
        ].includes(error.code)
      ) {
        throw error;
      }
      if (attempt < MAX_SEGMENT_DOWNLOAD_ATTEMPTS) {
        await sleep(250 * (2 ** (attempt - 1)), signal);
      }
    }
  }
  if (lastError instanceof ChzzkVodMaterializationError
    && lastError.code === "CANCELLED") {
    throw lastError;
  }
  fail("CHZZK 미디어 조각을 재시도 후에도 준비하지 못했습니다.", "SEGMENT_REQUEST_FAILED");
}

function parseProbePayload(stdout: string): ProbePayload {
  try {
    const payload = JSON.parse(stdout) as unknown;
    const record = objectRecord(payload);
    if (!record) {
      fail("ffprobe 결과 형식이 올바르지 않습니다.", "MEDIA_VERIFICATION_FAILED");
    }
    return record as ProbePayload;
  } catch (error) {
    if (error instanceof ChzzkVodMaterializationError) {
      throw error;
    }
    fail("ffprobe 결과를 읽지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
  }
}

function probeStreams(payload: ProbePayload): ProbeStream[] {
  if (!Array.isArray(payload.streams)) {
    return [];
  }
  return payload.streams
    .map(objectRecord)
    .filter((value): value is Record<string, unknown> => value !== undefined);
}

function probePackets(payload: ProbePayload): ProbePacket[] {
  if (!Array.isArray(payload.packets)) {
    return [];
  }
  return payload.packets
    .map(objectRecord)
    .filter((value): value is Record<string, unknown> => value !== undefined);
}

function assertH264AacStreams(payload: ProbePayload): void {
  const streams = probeStreams(payload);
  const hasH264 = streams.some((stream) => (
    stream.codec_type === "video" && stream.codec_name === "h264"
  ));
  const hasAac = streams.some((stream) => (
    stream.codec_type === "audio" && stream.codec_name === "aac"
  ));
  if (!hasH264 || !hasAac) {
    fail("CHZZK 조각이 muxed H.264/AAC 미디어가 아닙니다.", "UNSUPPORTED_MEDIA");
  }
}

async function inspectSegmentRandomAccess(
  filePath: string,
  runProcess: NonNullable<ChzzkVodMaterializerDependencies["runProcess"]>,
  ffprobeBinary: string,
  cwd: string,
  signal?: AbortSignal
): Promise<boolean> {
  const result = await runCheckedProcess(
    runProcess,
    ffprobeBinary,
    [
      "-v", "error",
      "-read_intervals", "%+1",
      "-show_streams",
      "-show_packets",
      "-show_entries", "stream=codec_type,codec_name:packet=codec_type,flags",
      "-of", "json",
      "--",
      filePath
    ],
    { cwd, ...(signal ? { signal } : {}) },
    "MEDIA_VERIFICATION_FAILED",
    "CHZZK 미디어 조각을 검사하지 못했습니다."
  );
  const payload = parseProbePayload(result.stdout);
  assertH264AacStreams(payload);
  const firstVideoPacket = probePackets(payload).find((packet) => (
    packet.codec_type === "video"
  ));
  if (!firstVideoPacket || typeof firstVideoPacket.flags !== "string") {
    fail("CHZZK 조각의 첫 영상 패킷을 확인하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  return firstVideoPacket.flags.includes("K");
}

function mergePreparedRuns(runs: readonly PlannedSegmentRun[]): PlannedSegmentRun[] {
  const sorted = [...runs].sort((left, right) => (
    (left.segments[0]?.index ?? Number.MAX_SAFE_INTEGER)
      - (right.segments[0]?.index ?? Number.MAX_SAFE_INTEGER)
  ));
  const merged: PlannedSegmentRun[] = [];
  for (const run of sorted) {
    const previous = merged.at(-1);
    const first = run.segments[0];
    const previousLast = previous?.segments.at(-1);
    if (
      !previous
      || !first
      || !previousLast
      || first.index > previousLast.index + 1
      || first.sourceStartMs > previousLast.sourceEndMs + 0.001
    ) {
      merged.push({
        ...run,
        clipIds: [...run.clipIds],
        segments: [...run.segments]
      });
      continue;
    }
    const byKey = new Map<string, ExpandedMpdSegment>();
    for (const segment of [...previous.segments, ...run.segments]) {
      byKey.set(segmentSemanticKey(segment), segment);
    }
    const segments = [...byKey.values()].sort((left, right) => left.index - right.index);
    const clipIds = [...new Set([...previous.clipIds, ...run.clipIds])].sort();
    const firstSegment = segments[0];
    const lastSegment = segments.at(-1);
    if (!firstSegment || !lastSegment) {
      fail("준비할 CHZZK 세그먼트 실행 구간이 비었습니다.", "INVALID_CLIPS");
    }
    merged[merged.length - 1] = {
      editableSourceStartMs: Math.min(
        previous.editableSourceStartMs,
        run.editableSourceStartMs
      ),
      editableSourceEndMs: Math.max(
        previous.editableSourceEndMs,
        run.editableSourceEndMs
      ),
      fetchedSourceStartMs: firstSegment.sourceStartMs,
      fetchedSourceEndMs: lastSegment.sourceEndMs,
      clipIds,
      segments,
      decoderPrefixSegmentCount:
        previous.decoderPrefixSegmentCount + run.decoderPrefixSegmentCount
    };
  }
  return merged;
}

async function concatenateTransportStreams(
  segmentPaths: readonly string[],
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  if (segmentPaths.length === 0) {
    fail("연결할 CHZZK 미디어 조각이 없습니다.", "MEDIA_MUX_FAILED");
  }
  const temporary = `${outputPath}.part-${randomBytes(8).toString("hex")}`;
  const output = await open(temporary, "wx", 0o600);
  try {
    for (const segmentPath of segmentPaths) {
      abortIfRequested(signal);
      for await (const chunk of createReadStream(segmentPath)) {
        abortIfRequested(signal);
        await writeAll(output, chunk as Buffer);
      }
    }
    await output.sync();
    await output.close();
    await rename(temporary, outputPath);
  } catch (error) {
    await output.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function buildRunRemuxArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c", "copy",
    "-bsf:a", "aac_adtstoasc",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    "-f", "mp4",
    outputPath
  ];
}

function concatFilePathLiteral(filePath: string): string {
  return `'${filePath.replaceAll("'", "'\\''")}'`;
}

export function buildConcatDescription(
  runPaths: readonly string[],
  runDurationsMs: readonly number[],
  runInpointsMs: readonly number[] = runPaths.map(() => 0)
): string {
  if (
    runPaths.length === 0
    || runPaths.length !== runDurationsMs.length
    || runPaths.length !== runInpointsMs.length
  ) {
    fail("로컬 MP4 연결 목록이 올바르지 않습니다.", "MEDIA_MUX_FAILED");
  }
  return `${runPaths.map((runPath, index) => {
    const durationMs = runDurationsMs[index];
    const inpointMs = runInpointsMs[index];
    if (
      durationMs === undefined
      || !Number.isFinite(durationMs)
      || durationMs <= 0
      || inpointMs === undefined
      || !Number.isFinite(inpointMs)
      || inpointMs < 0
      || inpointMs > 1_000
    ) {
      fail("로컬 MP4 연결 시간이 올바르지 않습니다.", "MEDIA_MUX_FAILED");
    }
    const durationSeconds = (durationMs / 1000).toFixed(6);
    const inpointSeconds = (inpointMs / 1000).toFixed(6);
    const outpointSeconds = ((inpointMs + durationMs) / 1000).toFixed(6);
    return [
      `file ${concatFilePathLiteral(runPath)}`,
      `inpoint ${inpointSeconds}`,
      `outpoint ${outpointSeconds}`,
      `duration ${durationSeconds}`
    ].join("\n");
  }).join("\n")}\n`;
}

export function buildCompactConcatArgs(
  descriptionPath: string,
  outputPath: string
): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", descriptionPath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    "-f", "mp4",
    outputPath
  ];
}

async function inspectRunVideoInpointMs(
  runPath: string,
  runProcess: NonNullable<ChzzkVodMaterializerDependencies["runProcess"]>,
  ffprobeBinary: string,
  cwd: string,
  signal?: AbortSignal
): Promise<number> {
  const result = await runCheckedProcess(
    runProcess,
    ffprobeBinary,
    [
      "-v", "error",
      "-show_streams",
      "-show_entries", "stream=codec_type,codec_name,start_time,duration",
      "-of", "json",
      "--",
      runPath
    ],
    { cwd, ...(signal ? { signal } : {}) },
    "MEDIA_VERIFICATION_FAILED",
    "로컬 구간 MP4의 시작 시간을 검사하지 못했습니다."
  );
  const payload = parseProbePayload(result.stdout);
  assertH264AacStreams(payload);
  const video = probeStreams(payload).find((stream) => stream.codec_type === "video");
  const startSeconds = numericValue(video?.start_time);
  if (startSeconds === undefined || startSeconds < 0 || startSeconds > 1) {
    fail("로컬 구간 MP4 영상 시작 시간이 허용 범위를 벗어났습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  return startSeconds * 1000;
}

async function remuxRuns({
  runs,
  segmentPaths,
  jobDirectory,
  artifactPath,
  runProcess,
  ffmpegBinary,
  ffprobeBinary,
  signal,
  assertLeaseOwned
}: {
  runs: readonly PlannedSegmentRun[];
  segmentPaths: ReadonlyMap<string, string>;
  jobDirectory: string;
  artifactPath: string;
  runProcess: NonNullable<ChzzkVodMaterializerDependencies["runProcess"]>;
  ffmpegBinary: string;
  ffprobeBinary: string;
  signal?: AbortSignal;
  assertLeaseOwned?: () => void;
}): Promise<void> {
  const runMp4Paths: string[] = [];
  const runDurationsMs: number[] = [];
  const runInpointsMs: number[] = [];
  for (let index = 0; index < runs.length; index += 1) {
    abortIfRequested(signal);
    const run = runs[index];
    if (!run) {
      continue;
    }
    const inputPaths = run.segments.map((segment) => {
      const segmentPath = segmentPaths.get(segmentSemanticKey(segment));
      if (!segmentPath) {
        fail("준비된 CHZZK 조각 파일을 찾지 못했습니다.", "MEDIA_MUX_FAILED");
      }
      return segmentPath;
    });
    const tsPath = path.join(jobDirectory, `run-${index}.ts`);
    const mp4Path = path.join(jobDirectory, `run-${index}.mp4`);
    assertLeaseOwned?.();
    await rm(tsPath, { force: true }).catch(() => undefined);
    assertLeaseOwned?.();
    await rm(mp4Path, { force: true }).catch(() => undefined);
    await concatenateTransportStreams(inputPaths, tsPath, signal);
    await runCheckedProcess(
      runProcess,
      ffmpegBinary,
      buildRunRemuxArgs(tsPath, mp4Path),
      { cwd: jobDirectory, ...(signal ? { signal } : {}) },
      "MEDIA_MUX_FAILED",
      "CHZZK 미디어 조각을 무재인코딩 MP4로 구성하지 못했습니다."
    );
    const runStatus = await stat(mp4Path).catch(() => undefined);
    if (!runStatus?.isFile() || runStatus.size <= 0) {
      fail("구성된 로컬 MP4 파일이 비어 있습니다.", "MEDIA_MUX_FAILED");
    }
    runMp4Paths.push(mp4Path);
    runDurationsMs.push(run.fetchedSourceEndMs - run.fetchedSourceStartMs);
    runInpointsMs.push(await inspectRunVideoInpointMs(
      mp4Path,
      runProcess,
      ffprobeBinary,
      jobDirectory,
      signal
    ));
  }
  const temporaryArtifact = `${artifactPath}.part-${randomBytes(8).toString("hex")}.mp4`;
  try {
    if (runMp4Paths.length === 1) {
      await copyFile(runMp4Paths[0]!, temporaryArtifact, fsConstants.COPYFILE_EXCL);
    } else {
      const descriptionPath = path.join(jobDirectory, "runs.concat.txt");
      assertLeaseOwned?.();
      await writeFile(
        descriptionPath,
        buildConcatDescription(runMp4Paths, runDurationsMs, runInpointsMs),
        { encoding: "utf8", mode: 0o600 }
      );
      await runCheckedProcess(
        runProcess,
        ffmpegBinary,
        buildCompactConcatArgs(descriptionPath, temporaryArtifact),
        { cwd: jobDirectory, ...(signal ? { signal } : {}) },
        "MEDIA_MUX_FAILED",
        "비연속 CHZZK 편집 구간을 하나의 로컬 MP4로 연결하지 못했습니다."
      );
    }
    const outputStatus = await stat(temporaryArtifact).catch(() => undefined);
    if (!outputStatus?.isFile() || outputStatus.size <= 0) {
      fail("최종 로컬 MP4 파일이 비어 있습니다.", "MEDIA_MUX_FAILED");
    }
    await chmod(temporaryArtifact, 0o600);
    assertLeaseOwned?.();
    await rename(temporaryArtifact, artifactPath);
  } finally {
    await rm(temporaryArtifact, { force: true }).catch(() => undefined);
  }
}

function numericValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function inspectFinalArtifact(
  artifactPath: string,
  expectedDurationMs: number,
  boundariesMs: readonly number[],
  runProcess: NonNullable<ChzzkVodMaterializerDependencies["runProcess"]>,
  ffprobeBinary: string,
  cwd: string,
  signal?: AbortSignal
): Promise<number> {
  const summary = await runCheckedProcess(
    runProcess,
    ffprobeBinary,
    [
      "-v", "error",
      "-show_streams",
      "-show_format",
      "-of", "json",
      "--",
      artifactPath
    ],
    { cwd, ...(signal ? { signal } : {}) },
    "MEDIA_VERIFICATION_FAILED",
    "최종 로컬 MP4를 검사하지 못했습니다."
  );
  const payload = parseProbePayload(summary.stdout);
  assertH264AacStreams(payload);
  const format = objectRecord(payload.format);
  const durationSeconds = numericValue(format?.duration);
  if (durationSeconds === undefined || durationSeconds <= 0) {
    fail("최종 로컬 MP4 재생 시간을 확인하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  const durationMs = Math.round(durationSeconds * 1000);
  const durationToleranceMs = 250;
  if (Math.abs(durationMs - expectedDurationMs) > durationToleranceMs) {
    fail("최종 로컬 MP4 재생 시간이 조각 계획과 다릅니다.", "MEDIA_VERIFICATION_FAILED");
  }

  const intervalStarts = [...new Set([
    ...boundariesMs.slice(0, 128).map((boundary) => Math.max(0, boundary - 2_000)),
    Math.max(0, durationMs - 4_000)
  ])].sort((left, right) => left - right).slice(0, 129);
  const intervalExpression = intervalStarts
    .map((start) => `${(start / 1000).toFixed(6)}%+6`)
    .join(",");
  const packetsResult = await runCheckedProcess(
    runProcess,
    ffprobeBinary,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-read_intervals", intervalExpression,
      "-show_packets",
      "-show_entries", "packet=pts_time,dts_time,duration_time,flags",
      "-of", "json",
      "--",
      artifactPath
    ],
    { cwd, ...(signal ? { signal } : {}) },
    "MEDIA_VERIFICATION_FAILED",
    "최종 로컬 MP4 타임스탬프를 검사하지 못했습니다."
  );
  const packets = probePackets(parseProbePayload(packetsResult.stdout));
  const timestamps = packets
    .map((packet) => numericValue(packet.pts_time) ?? numericValue(packet.dts_time))
    .filter((value): value is number => value !== undefined);
  if (timestamps.length === 0 || timestamps.some((value) => value < -0.1)) {
    fail("최종 로컬 MP4 패킷 타임스탬프가 올바르지 않습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  const lastTimestampMs = Math.max(...timestamps) * 1000;
  if (lastTimestampMs > durationMs + 500 || lastTimestampMs < durationMs - 2_000) {
    fail("최종 로컬 MP4 마지막 패킷 시간이 재생 시간과 맞지 않습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  for (const boundary of boundariesMs.slice(0, 128)) {
    if (!timestamps.some((timestamp) => Math.abs(timestamp * 1000 - boundary) <= 250)) {
      fail("최종 로컬 MP4 구간 경계의 패킷을 확인하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
    }
  }
  return durationMs;
}

function manifestMaterialization(
  manifest: ChzzkVodMaterializationManifest
): ChzzkVodMaterialization {
  const legacy = manifest.schemaId === LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID;
  return {
    schema: legacy
      ? LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA
      : CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: manifest.materializationId,
    planFingerprint: manifest.planFingerprint,
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: manifest.contentId,
      ...(legacy ? {} : { sourceVersionId: manifest.sourceVersionId! })
    },
    sourceDurationMs: manifest.durationMs,
    handleMs: manifest.handleMs,
    mediaDurationMs: manifest.mediaDurationMs,
    windows: [...manifest.windows],
    ...(legacy ? {} : {
      clipRanges: manifest.clips.map((clip) => ({
        clipId: clip.id,
        sourceStartMs: clip.sourceStartMs,
        sourceEndMs: clip.sourceEndMs,
        editableSourceStartMs: clip.editableSourceStartMs,
        editableSourceEndMs: clip.editableSourceEndMs
      }))
    }),
    preparedAt: manifest.preparedAt,
    localOnly: true
  };
}

function validateStoredQuality(value: unknown): ChzzkVodQuality | undefined {
  const record = objectRecord(value);
  if (!record || !hasExactKeys(record, [
    "representationId",
    "width",
    "height",
    "bandwidth",
    "frameRate",
    "videoCodec",
    "audioCodec"
  ])) {
    return undefined;
  }
  const representationId = record.representationId;
  const width = Number(record.width);
  const height = Number(record.height);
  const bandwidth = Number(record.bandwidth);
  const frameRate = Number(record.frameRate);
  if (
    typeof representationId !== "string"
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(representationId)
    || ![width, height, bandwidth].every((item) => Number.isSafeInteger(item) && item >= 0)
    || !Number.isFinite(frameRate)
    || frameRate < 0
    || record.videoCodec !== "h264"
    || record.audioCodec !== "aac"
  ) {
    return undefined;
  }
  return {
    representationId,
    width,
    height,
    bandwidth,
    frameRate,
    videoCodec: "h264",
    audioCodec: "aac"
  };
}

function validateStoredWindows(value: unknown): MaterializationWindow[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const windows: MaterializationWindow[] = [];
  let expectedMediaStartMs = 0;
  for (const raw of value) {
    const record = objectRecord(raw);
    if (
      !record
      || !hasExactKeys(record, [
        "id",
        "editableSourceStartMs",
        "editableSourceEndMs",
        "fetchedSourceStartMs",
        "fetchedSourceEndMs",
        "mediaStartMs",
        "mediaEndMs",
        "clipIds"
      ])
      || typeof record.id !== "string"
      || !Array.isArray(record.clipIds)
    ) {
      return undefined;
    }
    const numericKeys = [
      "editableSourceStartMs",
      "editableSourceEndMs",
      "fetchedSourceStartMs",
      "fetchedSourceEndMs",
      "mediaStartMs",
      "mediaEndMs"
    ] as const;
    if (!numericKeys.every((key) => Number.isSafeInteger(record[key]))) {
      return undefined;
    }
    const editableSourceStartMs = Number(record.editableSourceStartMs);
    const editableSourceEndMs = Number(record.editableSourceEndMs);
    const fetchedSourceStartMs = Number(record.fetchedSourceStartMs);
    const fetchedSourceEndMs = Number(record.fetchedSourceEndMs);
    const mediaStartMs = Number(record.mediaStartMs);
    const mediaEndMs = Number(record.mediaEndMs);
    const clipIds = record.clipIds;
    if (
      editableSourceStartMs < fetchedSourceStartMs
      || editableSourceEndMs > fetchedSourceEndMs
      || editableSourceEndMs <= editableSourceStartMs
      || fetchedSourceEndMs <= fetchedSourceStartMs
      || mediaStartMs !== expectedMediaStartMs
      || mediaEndMs - mediaStartMs !== fetchedSourceEndMs - fetchedSourceStartMs
      || !clipIds.every((item) => typeof item === "string" && item.length > 0)
    ) {
      return undefined;
    }
    windows.push({
      id: record.id,
      editableSourceStartMs,
      editableSourceEndMs,
      fetchedSourceStartMs,
      fetchedSourceEndMs,
      mediaStartMs,
      mediaEndMs,
      clipIds: [...clipIds] as string[]
    });
    expectedMediaStartMs = mediaEndMs;
  }
  return windows;
}

function createReceiptClips(
  clips: readonly MaterializationClipCoverage[]
): ChzzkVodMaterializationReceiptClip[] {
  return clips.map((clip) => ({
    id: clip.clipId,
    sourceStartMs: clip.sourceStartMs,
    sourceEndMs: clip.sourceEndMs,
    editableSourceStartMs: clip.editableSourceStartMs,
    editableSourceEndMs: clip.editableSourceEndMs
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function validateStoredReceiptClips(
  value: unknown,
  sourceDurationMs: number,
  handleMs: number,
  legacy: boolean
): ChzzkVodMaterializationReceiptClip[] | undefined {
  if (
    !Number.isSafeInteger(sourceDurationMs)
    || sourceDurationMs <= 0
    || !Number.isSafeInteger(handleMs)
    || handleMs < 0
    || handleMs > 60_000
    || !Array.isArray(value)
    || value.length === 0
    || value.length > 10_000
  ) {
    return undefined;
  }
  const clips: ChzzkVodMaterializationReceiptClip[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const record = objectRecord(raw);
    if (
      !record
      || !hasExactKeys(record, [
        "id",
        "sourceStartMs",
        "sourceEndMs",
        "editableSourceStartMs",
        "editableSourceEndMs"
      ])
      || typeof record.id !== "string"
      || ids.has(record.id)
    ) {
      return undefined;
    }
    const sourceStartMs = Number(record.sourceStartMs);
    const sourceEndMs = Number(record.sourceEndMs);
    const editableSourceStartMs = Number(record.editableSourceStartMs);
    const editableSourceEndMs = Number(record.editableSourceEndMs);
    if (
      !/^[^\u0000-\u001f\u007f/?#&=]{1,240}$/u.test(record.id)
      || ![
        sourceStartMs,
        sourceEndMs,
        editableSourceStartMs,
        editableSourceEndMs
      ].every(Number.isSafeInteger)
      || sourceStartMs < 0
      || sourceEndMs <= sourceStartMs
      || sourceEndMs > sourceDurationMs
      || editableSourceStartMs < 0
      || (legacy
        ? editableSourceStartMs !== Math.max(0, sourceStartMs - handleMs)
        : editableSourceStartMs > Math.max(0, sourceStartMs - handleMs))
      || (legacy
        ? editableSourceEndMs !== Math.min(sourceDurationMs, sourceEndMs + handleMs)
        : editableSourceEndMs < Math.min(sourceDurationMs, sourceEndMs + handleMs))
      || editableSourceEndMs > sourceDurationMs
      || editableSourceEndMs <= editableSourceStartMs
    ) {
      return undefined;
    }
    ids.add(record.id);
    clips.push({
      id: record.id,
      sourceStartMs,
      sourceEndMs,
      editableSourceStartMs,
      editableSourceEndMs
    });
  }
  return clips.sort((left, right) => left.id.localeCompare(right.id));
}

interface StoredManifestExpectation {
  canonicalUrl: string;
  contentId: string;
  planFingerprint: string;
  timelineDigest?: string;
  sourceVersionId?: string;
  materializationId?: string;
}

function parseStoredManifest(
  value: unknown,
  expected: StoredManifestExpectation
): ChzzkVodMaterializationManifest | undefined {
  const record = objectRecord(value);
  const quality = validateStoredQuality(record?.quality);
  const windows = validateStoredWindows(record?.windows);
  const artifact = objectRecord(record?.artifact);
  const durationMs = Number(record?.durationMs);
  const handleMs = Number(record?.handleMs);
  const legacy = record?.schemaId === LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID;
  const current = record?.schemaId === CHZZK_VOD_MATERIALIZATION_SCHEMA_ID;
  const clips = validateStoredReceiptClips(
    record?.clips,
    durationMs,
    handleMs,
    legacy
  );
  const manifestKeys = [
    "schemaId",
    "materializationId",
    "planFingerprint",
    "canonicalUrl",
    "contentId",
    "durationMs",
    "mediaDurationMs",
    "handleMs",
    "quality",
    "timelineDigest",
    ...(current ? ["sourceVersionId"] : []),
    "clips",
    "windows",
    "artifact",
    "preparedAt"
  ];
  if (
    !record
    || (!legacy && !current)
    || !hasExactKeys(record, manifestKeys)
    || record.canonicalUrl !== expected.canonicalUrl
    || record.contentId !== expected.contentId
    || typeof record.timelineDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(record.timelineDigest)
    || (expected.timelineDigest !== undefined
      && record.timelineDigest !== expected.timelineDigest)
    || (current && (
      typeof record.sourceVersionId !== "string"
      || !/^[a-f0-9]{64}$/u.test(record.sourceVersionId)
    ))
    || (expected.sourceVersionId !== undefined && (
      !current
      || record.sourceVersionId !== expected.sourceVersionId
    ))
    || typeof record.planFingerprint !== "string"
    || !/^[a-f0-9]{64}$/u.test(record.planFingerprint)
    || record.planFingerprint !== expected.planFingerprint
    || (expected.materializationId !== undefined
      && record.materializationId !== expected.materializationId)
    || typeof record.materializationId !== "string"
    || !/^[a-f0-9]{32}$/u.test(record.materializationId)
    || record.materializationId !== record.planFingerprint.slice(0, 32)
    || !Number.isSafeInteger(record.durationMs)
    || Number(record.durationMs) <= 0
    || !Number.isSafeInteger(record.mediaDurationMs)
    || Number(record.mediaDurationMs) <= 0
    || !Number.isSafeInteger(record.handleMs)
    || Number(record.handleMs) < 0
    || typeof record.preparedAt !== "string"
    || !Number.isFinite(Date.parse(record.preparedAt))
    || !quality
    || !clips
    || !windows
    || !artifact
    || !hasExactKeys(artifact, ["hashSha256", "sizeBytes", "durationMs"])
    || typeof artifact.hashSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(artifact.hashSha256)
    || !Number.isSafeInteger(artifact.sizeBytes)
    || Number(artifact.sizeBytes) <= 0
    || !Number.isSafeInteger(artifact.durationMs)
    || Number(artifact.durationMs) <= 0
    || Math.abs(
      Number(artifact.durationMs) - Number(record.mediaDurationMs)
    ) > 250
    || windows.at(-1)?.mediaEndMs !== Number(record.mediaDurationMs)
  ) {
    return undefined;
  }
  const receiptClipIds = new Set(clips.map((clip) => clip.id));
  if (
    windows.some((window) => window.clipIds.some((id) => !receiptClipIds.has(id)))
    || clips.some((clip) => {
      const matching = windows.filter((window) => window.clipIds.includes(clip.id));
      return matching.length !== 1
        || matching[0]!.editableSourceStartMs > clip.editableSourceStartMs
        || matching[0]!.editableSourceEndMs < clip.editableSourceEndMs;
    })
  ) {
    return undefined;
  }
  return {
    schemaId: legacy
      ? LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID
      : CHZZK_VOD_MATERIALIZATION_SCHEMA_ID,
    materializationId: record.materializationId,
    planFingerprint: record.planFingerprint,
    canonicalUrl: record.canonicalUrl,
    contentId: record.contentId,
    durationMs,
    mediaDurationMs: Number(record.mediaDurationMs),
    handleMs,
    quality,
    timelineDigest: record.timelineDigest,
    ...(current ? { sourceVersionId: String(record.sourceVersionId) } : {}),
    clips,
    windows,
    artifact: {
      hashSha256: artifact.hashSha256,
      sizeBytes: Number(artifact.sizeBytes),
      durationMs: Number(artifact.durationMs)
    },
    preparedAt: record.preparedAt
  };
}

function assertPublicManifestIsSecretFree(
  manifest: ChzzkVodMaterializationManifest
): void {
  const serialized = JSON.stringify(manifest);
  if (
    /(?:inKey|transferUrl|manifestUrl|segmentUrl)/iu.test(serialized)
    || /[?&](?:key|token|signature|expires?)=/iu.test(serialized)
  ) {
    fail("공개 저장 정보에 비공개 전송 값이 섞였습니다.", "SECRET_REDACTION_FAILED");
  }
}

async function reusableCompletedMaterialization(
  manifestPath: string,
  artifactPath: string,
  expected: StoredManifestExpectation,
  signal?: AbortSignal
): Promise<ChzzkVodMaterializationManifest | undefined> {
  try {
    const manifest = parseStoredManifest(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
      expected
    );
    if (!manifest) {
      return undefined;
    }
    const artifactStatus = await stat(artifactPath);
    if (
      !artifactStatus.isFile()
      || artifactStatus.size !== manifest.artifact.sizeBytes
      || await sha256File(artifactPath, signal) !== manifest.artifact.hashSha256
    ) {
      return undefined;
    }
    assertPublicManifestIsSecretFree(manifest);
    return manifest;
  } catch (error) {
    if (
      error instanceof ChzzkVodMaterializationError
      && error.code === "CANCELLED"
    ) {
      throw error;
    }
    return undefined;
  }
}

function normalizedResumeIdentity(
  value: unknown
): ChzzkVodMaterializationResumeIdentity | undefined {
  const record = objectRecord(value);
  if (!record || Object.keys(record).sort().join(",") !== (
    "contentId,materializationId,planFingerprint"
  )) {
    return undefined;
  }
  const materializationId = record.materializationId;
  const planFingerprint = record.planFingerprint;
  const contentId = record.contentId;
  if (
    typeof materializationId !== "string"
    || !/^[a-f0-9]{32}$/u.test(materializationId)
    || typeof planFingerprint !== "string"
    || !/^[a-f0-9]{64}$/u.test(planFingerprint)
    || materializationId !== planFingerprint.slice(0, 32)
    || typeof contentId !== "string"
    || !/^\d{1,30}$/u.test(contentId)
  ) {
    return undefined;
  }
  return { materializationId, planFingerprint, contentId };
}

function receiptExactlyContainsRequestedClips(
  receipt: ChzzkVodMaterializationManifest,
  clips: readonly MaterializationClipRange[],
  handleMs: number,
  desiredEditableRanges?: readonly MaterializationDesiredEditableRange[]
): boolean {
  if (
    receipt.schemaId === LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID
    && desiredEditableRanges !== undefined
  ) {
    return false;
  }
  if (receipt.handleMs !== handleMs) {
    return false;
  }
  if (clips.some((clip) => (
    clip.sourceStartMs >= receipt.durationMs
    || clip.sourceEndMs > receipt.durationMs
  ))) {
    return false;
  }
  const requested = createReceiptClips(requestedClipCoverages(
    clips,
    receipt.durationMs,
    handleMs,
    desiredEditableRanges
  ));
  if (requested.length !== receipt.clips.length) {
    return false;
  }
  return requested.every((clip, index) => {
    const stored = receipt.clips[index];
    return stored !== undefined
      && stored.id === clip.id
      && stored.sourceStartMs === clip.sourceStartMs
      && stored.sourceEndMs === clip.sourceEndMs
      && stored.editableSourceStartMs === clip.editableSourceStartMs
      && stored.editableSourceEndMs === clip.editableSourceEndMs;
  });
}

export async function reopenChzzkVodMaterialization(
  request: ReopenChzzkVodMaterializationRequest
): Promise<ChzzkVodMaterializationResult | undefined> {
  abortIfRequested(request.signal);
  const consumerScopeHash = chzzkVodConsumerScopeHash(request.consumerId);
  const identity = normalizedResumeIdentity({
    materializationId: request.materializationId,
    planFingerprint: request.planFingerprint,
    contentId: request.contentId
  });
  if (!identity) {
    return undefined;
  }
  const handleMs = validatedHandleMs(request.handleMs);
  const clips = coreClipRanges(request.clips);
  const desiredEditableRanges = coreDesiredEditableRanges(request.editableRanges);
  const stateDirectory = resolveChzzkVodStateDirectory(request.stateDir);
  const jobDirectories = [
    scopedChzzkJobDirectory(
      stateDirectory,
      consumerScopeHash,
      identity.materializationId
    ),
    legacyScopedChzzkJobDirectory(
      stateDirectory,
      consumerScopeHash,
      identity.materializationId
    )
  ];
  for (const jobDirectory of jobDirectories) {
    const artifactPath = path.join(jobDirectory, "materialized.mp4");
    const receipt = await reusableCompletedMaterialization(
      path.join(jobDirectory, "manifest.json"),
      artifactPath,
      {
        canonicalUrl: `https://${CHZZK_PAGE_HOST}/video/${identity.contentId}`,
        contentId: identity.contentId,
        planFingerprint: identity.planFingerprint,
        materializationId: identity.materializationId
      },
      request.signal
    );
    if (receipt && receiptExactlyContainsRequestedClips(
      receipt,
      clips,
      handleMs,
      desiredEditableRanges
    )) {
      return {
        manifest: manifestMaterialization(receipt),
        receipt,
        artifactPath,
        reused: true
      };
    }
  }
  return undefined;
}

function baseReceiptIsMonotonicSubset(
  receipt: ChzzkVodMaterializationManifest,
  requested: readonly MaterializationClipCoverage[],
  handleMs: number
): boolean {
  if (receipt.handleMs !== handleMs || receipt.clips.length > requested.length) {
    return false;
  }
  const requestedById = new Map(requested.map((clip) => [clip.clipId, clip]));
  return receipt.clips.every((stored) => {
    const next = requestedById.get(stored.id);
    return next !== undefined
      && stored.sourceStartMs === next.sourceStartMs
      && stored.sourceEndMs === next.sourceEndMs
      && stored.editableSourceStartMs >= next.editableSourceStartMs
      && stored.editableSourceEndMs <= next.editableSourceEndMs;
  });
}

async function validateBaseMaterialization(
  base: ChzzkVodMaterializationResumeIdentity,
  stateDirectory: string,
  consumerScopeHash: string,
  resolved: ResolvedChzzkVod,
  requested: readonly MaterializationClipCoverage[],
  handleMs: number,
  signal?: AbortSignal
): Promise<void> {
  let receipt: ChzzkVodMaterializationManifest | undefined;
  for (const jobDirectory of [
    scopedChzzkJobDirectory(
      stateDirectory,
      consumerScopeHash,
      base.materializationId
    ),
    legacyScopedChzzkJobDirectory(
      stateDirectory,
      consumerScopeHash,
      base.materializationId
    )
  ]) {
    receipt = await reusableCompletedMaterialization(
      path.join(jobDirectory, "manifest.json"),
      path.join(jobDirectory, "materialized.mp4"),
      {
        canonicalUrl: resolved.canonicalUrl,
        contentId: base.contentId,
        planFingerprint: base.planFingerprint,
        materializationId: base.materializationId
      },
      signal
    );
    if (receipt) {
      break;
    }
  }
  if (!receipt) {
    fail("기준 로컬 편집본의 영수증 또는 파일을 검증하지 못했습니다.", "MEDIA_VERIFICATION_FAILED");
  }
  if (receipt.schemaId === LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID) {
    fail(
      "이전 버전 CHZZK 로컬 재료는 새 조각과 섞지 않습니다. 전체 요청 범위를 v2로 다시 준비해 주세요.",
      "SOURCE_CHANGED"
    );
  }
  if (
    receipt.contentId !== resolved.contentId
    || receipt.sourceVersionId !== resolved.sourceVersionId
    || receipt.timelineDigest !== resolved.timelineDigest
    || qualityIdentity(receipt.quality) !== qualityIdentity(resolved.quality)
    || receipt.durationMs !== resolved.durationMs
  ) {
    fail("기준 편집본 이후 CHZZK VOD의 품질 또는 타임라인이 바뀌었습니다.", "SOURCE_CHANGED");
  }
  if (!baseReceiptIsMonotonicSubset(receipt, requested, handleMs)) {
    fail("확장 편집 범위가 기준 로컬 편집본을 그대로 포함하지 않습니다.", "INVALID_CLIPS");
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function processAppearsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
}

async function linuxProcessStartMarker(pid: number): Promise<string | undefined> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const closeParenthesis = raw.lastIndexOf(")");
    if (closeParenthesis < 0) {
      return undefined;
    }
    const fieldsFromState = raw.slice(closeParenthesis + 1).trim().split(/\s+/u);
    const startTicks = fieldsFromState[19];
    return startTicks && /^\d+$/u.test(startTicks) ? startTicks : undefined;
  } catch {
    return undefined;
  }
}

interface JobLockLease {
  readonly signal: AbortSignal;
  readonly failure: Error | undefined;
  assertOwned(): void;
  release(): Promise<void>;
}

type JobLeaseSqliteValue = string | number | bigint | null | Uint8Array;

interface JobLeaseSqliteRunResult {
  changes: number | bigint;
}

interface JobLeaseSqliteStatement {
  all(...parameters: readonly JobLeaseSqliteValue[]): unknown[];
  get(...parameters: readonly JobLeaseSqliteValue[]): unknown;
  run(...parameters: readonly JobLeaseSqliteValue[]): JobLeaseSqliteRunResult;
}

interface JobLeaseSqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): JobLeaseSqliteStatement;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string) => JobLeaseSqliteDatabase;
}

interface JobLeaseSnapshot {
  schemaId: typeof CHZZK_JOB_LEASE_SCHEMA_ID;
  ownerId: string;
  revision: number;
  pid: number;
  createdAtUnixMs: number;
  heartbeatAtBootMs: number;
  processStartMarker?: string;
}

const requireNodeBuiltin = createRequire(import.meta.url);
const MAX_JOB_LEASE_DATABASE_BYTES = 1024 * 1024;
const JOB_LEASE_DATABASE_APPLICATION_ID = 0x4b524e4b;
const JOB_LEASE_TABLE_SQL = `CREATE TABLE materialization_job_lease (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  pid INTEGER NOT NULL CHECK (pid >= 1),
  created_at_unix_ms INTEGER NOT NULL CHECK (created_at_unix_ms >= 1),
  heartbeat_at_boot_ms INTEGER NOT NULL CHECK (heartbeat_at_boot_ms >= 0),
  process_start_marker TEXT
) STRICT`;

function jobLeaseBootClockMs(): number {
  const milliseconds = Math.floor(os.uptime() * 1_000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Operating-system boot clock is unavailable.");
  }
  return milliseconds;
}

function sqliteChanges(result: JobLeaseSqliteRunResult): number {
  const changes = Number(result.changes);
  if (!Number.isSafeInteger(changes) || changes < 0) {
    throw new Error("Job lease SQLite returned an invalid change count.");
  }
  return changes;
}

async function assertSafeJobLeaseDatabasePath(
  databasePath: string,
  stateDirectory: string
): Promise<void> {
  if (
    !path.isAbsolute(databasePath)
    || !path.isAbsolute(stateDirectory)
    || path.basename(databasePath) !== CHZZK_JOB_LEASE_DATABASE_FILENAME
  ) {
    throw new Error("Job lease database path is not an exact direct-child path.");
  }
  const directoryStatus = await lstat(path.dirname(databasePath), { bigint: true });
  if (
    !directoryStatus.isDirectory()
    || directoryStatus.isSymbolicLink()
    || (process.platform !== "win32" && (directoryStatus.mode & 0o077n) !== 0n)
  ) {
    throw new Error("Job lease database directory is not a real directory.");
  }
  const [canonicalStateDirectory, canonicalDatabaseDirectory] = await Promise.all([
    realpath(stateDirectory),
    realpath(path.dirname(databasePath))
  ]);
  const relativeDirectory = path.relative(
    canonicalStateDirectory,
    canonicalDatabaseDirectory
  );
  if (
    relativeDirectory === ""
    || relativeDirectory === ".."
    || relativeDirectory.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeDirectory)
  ) {
    throw new Error("Job lease database resolves outside its state directory.");
  }
  for (const candidate of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`
  ]) {
    let status: BigIntStats;
    try {
      status = await lstat(candidate, { bigint: true });
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (
      !status.isFile()
      || status.isSymbolicLink()
      || status.nlink !== 1n
      || status.size > BigInt(MAX_JOB_LEASE_DATABASE_BYTES)
    ) {
      throw new Error("Job lease database has an unsafe filesystem shape.");
    }
  }
}

async function openJobLeaseDatabase(
  databasePath: string,
  stateDirectory: string
): Promise<JobLeaseSqliteDatabase> {
  await assertSafeJobLeaseDatabasePath(databasePath, stateDirectory);
  let database: JobLeaseSqliteDatabase | undefined;
  try {
    const sqlite = requireNodeBuiltin("node:sqlite") as NodeSqliteModule;
    database = new sqlite.DatabaseSync(databasePath);
    await assertSafeJobLeaseDatabasePath(databasePath, stateDirectory);
    database.exec(`
      PRAGMA busy_timeout = ${CHZZK_JOB_LOCK_BUSY_TIMEOUT_MS};
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA trusted_schema = OFF;
    `);
    database.exec("BEGIN IMMEDIATE;");
    try {
      const applicationIdRecord = objectRecord(
        database.prepare("PRAGMA application_id").get()
      );
      const applicationId = applicationIdRecord?.application_id;
      if (
        typeof applicationId !== "number"
        || ![0, JOB_LEASE_DATABASE_APPLICATION_ID].includes(applicationId)
      ) {
        throw new Error("Job lease database application identity is invalid.");
      }
      const existingObjects = database.prepare(`
        SELECT name, type
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `).all();
      if (applicationId === 0 && existingObjects.length !== 0) {
        throw new Error("Unidentified job lease database is not empty.");
      }
      if (applicationId === 0) {
        database.exec(`PRAGMA application_id = ${JOB_LEASE_DATABASE_APPLICATION_ID};`);
      }
      database.exec(`${JOB_LEASE_TABLE_SQL.replace(
        "CREATE TABLE",
        "CREATE TABLE IF NOT EXISTS"
      )};`);
      const identifiedObjects = database.prepare(`
        SELECT name, type
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `).all();
      const tableDefinition = objectRecord(database.prepare(`
        SELECT sql
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'materialization_job_lease'
      `).get());
      if (
        identifiedObjects.length !== 1
        || objectRecord(identifiedObjects[0])?.name !== "materialization_job_lease"
        || objectRecord(identifiedObjects[0])?.type !== "table"
        || tableDefinition?.sql !== JOB_LEASE_TABLE_SQL
      ) {
        throw new Error("Job lease database schema is not exact.");
      }
      database.exec("COMMIT;");
    } catch (error) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        // Preserve the schema/identity failure.
      }
      throw error;
    }
    await assertSafeJobLeaseDatabasePath(databasePath, stateDirectory);
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the first initialization failure.
    }
    throw error;
  }
}

function readJobLeaseSnapshot(
  database: JobLeaseSqliteDatabase
): JobLeaseSnapshot | undefined {
  const value = database.prepare(`
    SELECT
      schema_id AS schemaId,
      owner_id AS ownerId,
      revision,
      pid,
      created_at_unix_ms AS createdAtUnixMs,
      heartbeat_at_boot_ms AS heartbeatAtBootMs,
      process_start_marker AS processStartMarker
    FROM materialization_job_lease
    WHERE singleton = 1
  `).get();
  if (value === undefined) {
    return undefined;
  }
  const record = objectRecord(value);
  const processStartMarker = record?.processStartMarker;
  if (
    !record
    || !hasExactKeys(record, [
      "schemaId",
      "ownerId",
      "revision",
      "pid",
      "createdAtUnixMs",
      "heartbeatAtBootMs",
      "processStartMarker"
    ])
    || record.schemaId !== CHZZK_JOB_LEASE_SCHEMA_ID
    || typeof record.ownerId !== "string"
    || !/^[a-f0-9]{48}$/u.test(record.ownerId)
    || typeof record.revision !== "number"
    || !Number.isSafeInteger(record.revision)
    || record.revision < 1
    || typeof record.pid !== "number"
    || !Number.isSafeInteger(record.pid)
    || record.pid < 1
    || typeof record.createdAtUnixMs !== "number"
    || !Number.isSafeInteger(record.createdAtUnixMs)
    || record.createdAtUnixMs < 1
    || typeof record.heartbeatAtBootMs !== "number"
    || !Number.isSafeInteger(record.heartbeatAtBootMs)
    || record.heartbeatAtBootMs < 0
    || (processStartMarker !== null && (
      typeof processStartMarker !== "string"
      || !/^\d+$/u.test(processStartMarker)
    ))
  ) {
    throw new Error("Job lease database contains an invalid owner row.");
  }
  return {
    schemaId: CHZZK_JOB_LEASE_SCHEMA_ID,
    ownerId: record.ownerId,
    revision: record.revision,
    pid: record.pid,
    createdAtUnixMs: record.createdAtUnixMs,
    heartbeatAtBootMs: record.heartbeatAtBootMs,
    ...(typeof processStartMarker === "string" ? { processStartMarker } : {})
  };
}

async function jobLeaseIsActive(snapshot: JobLeaseSnapshot): Promise<boolean> {
  if (!processAppearsAlive(snapshot.pid)) {
    return false;
  }
  if (snapshot.processStartMarker) {
    const currentStartMarker = await linuxProcessStartMarker(snapshot.pid);
    if (currentStartMarker && currentStartMarker !== snapshot.processStartMarker) {
      return false;
    }
  }
  const currentBootClockMs = jobLeaseBootClockMs();
  if (snapshot.heartbeatAtBootMs > currentBootClockMs) {
    return false;
  }
  return currentBootClockMs - snapshot.heartbeatAtBootMs
    <= CHZZK_JOB_LOCK_LEASE_MS;
}

function jobLockFailure(cause?: unknown): ChzzkVodMaterializationError {
  return new ChzzkVodMaterializationError(
    cause
      ? "CHZZK 편집 구간 작업 잠금의 heartbeat를 유지하지 못했습니다."
      : "CHZZK 편집 구간 작업 잠금을 안전하게 정리하지 못했습니다.",
    "LOCK_FAILED"
  );
}

async function createJobLockLease(
  database: JobLeaseSqliteDatabase,
  databasePath: string,
  ownerId: string,
  initialRevision: number,
  heartbeatIntervalMs: number
): Promise<JobLockLease> {
  const leaseAbort = new AbortController();
  let failure: Error | undefined;
  let stopped = false;
  let releasePromise: Promise<void> | undefined;
  const worker = new Worker(new URL(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(
      CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE
    )}`
  ), {
    workerData: {
      databasePath,
      schemaId: CHZZK_JOB_LEASE_SCHEMA_ID,
      ownerId,
      initialRevision,
      intervalMs: heartbeatIntervalMs,
      busyTimeoutMs: CHZZK_JOB_LOCK_BUSY_TIMEOUT_MS
    }
  });
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let ready = false;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const recordHeartbeatFailure = (error: unknown): void => {
    if (failure) {
      return;
    }
    failure = error instanceof Error ? error : new Error("Job lease heartbeat failed.");
    rejectReady?.(failure);
    leaseAbort.abort(failure);
  };
  worker.on("message", (message: unknown) => {
    const type = objectRecord(message)?.type;
    if (type === "ready" && !ready) {
      ready = true;
      resolveReady?.();
      return;
    }
    if (type === "failure") {
      recordHeartbeatFailure(new Error("Job lease heartbeat worker failed."));
    }
  });
  worker.on("error", recordHeartbeatFailure);
  worker.on("exit", (code) => {
    if (!stopped) {
      recordHeartbeatFailure(new Error(
        `Job lease heartbeat worker exited unexpectedly (${code}).`
      ));
    }
  });
  try {
    await readyPromise;
  } catch (error) {
    stopped = true;
    await worker.terminate().catch(() => undefined);
    throw error;
  }

  const assertOwned = (): void => {
    if (stopped || failure) {
      throw failure ?? new Error("Job lease has already stopped.");
    }
    try {
      const snapshot = readJobLeaseSnapshot(database);
      const now = jobLeaseBootClockMs();
      if (
        !snapshot
        || snapshot.ownerId !== ownerId
        || snapshot.heartbeatAtBootMs > now
        || now - snapshot.heartbeatAtBootMs > CHZZK_JOB_LOCK_LEASE_MS
      ) {
        throw new Error("Job lease ownership was lost before publication.");
      }
    } catch (error) {
      recordHeartbeatFailure(error);
      throw failure;
    }
  };

  return {
    signal: leaseAbort.signal,
    get failure() {
      return failure;
    },
    assertOwned,
    release: () => {
      releasePromise ??= (async () => {
        stopped = true;
        let releaseError = failure;
        try {
          await worker.terminate();
        } catch (error) {
          releaseError ??= error instanceof Error
            ? error
            : new Error("Job lease heartbeat worker termination failed.");
        }
        try {
          const removed = sqliteChanges(database.prepare(`
            DELETE FROM materialization_job_lease
            WHERE singleton = 1 AND schema_id = ? AND owner_id = ?
          `).run(CHZZK_JOB_LEASE_SCHEMA_ID, ownerId));
          if (removed !== 1) {
            releaseError ??= new Error("Job lease ownership was lost before release.");
          }
        } catch (error) {
          releaseError ??= error instanceof Error
            ? error
            : new Error("Job lease release failed.");
        }
        try {
          database.close();
        } catch (error) {
          releaseError ??= error instanceof Error
            ? error
            : new Error("Job lease database close failed.");
        }
        if (releaseError) {
          throw jobLockFailure(releaseError);
        }
      })();
      return releasePromise;
    }
  };
}

async function acquireJobLock(
  databasePath: string,
  stateDirectory: string,
  beforeStaleCompareAndSwap?: () => Promise<void>,
  heartbeatIntervalMs = CHZZK_JOB_LOCK_HEARTBEAT_INTERVAL_MS
): Promise<JobLockLease> {
  if (
    !Number.isSafeInteger(heartbeatIntervalMs)
    || heartbeatIntervalMs < 50
    || heartbeatIntervalMs > Math.floor(CHZZK_JOB_LOCK_LEASE_MS / 3)
  ) {
    throw new RangeError("Job lease heartbeat interval is outside its safety margin.");
  }
  const processStartMarker = await linuxProcessStartMarker(process.pid);
  const ownerId = randomBytes(24).toString("hex");
  const createdAtUnixMs = Date.now();
  let database: JobLeaseSqliteDatabase;
  try {
    database = await openJobLeaseDatabase(databasePath, stateDirectory);
  } catch {
    fail("CHZZK 편집 구간 작업 잠금 DB를 열지 못했습니다.", "LOCK_FAILED");
  }
  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const inserted = sqliteChanges(database.prepare(`
        INSERT INTO materialization_job_lease (
          singleton,
          schema_id,
          owner_id,
          revision,
          pid,
          created_at_unix_ms,
          heartbeat_at_boot_ms,
          process_start_marker
        ) VALUES (1, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO NOTHING
      `).run(
        CHZZK_JOB_LEASE_SCHEMA_ID,
        ownerId,
        process.pid,
        createdAtUnixMs,
        jobLeaseBootClockMs(),
        processStartMarker ?? null
      ));
      if (inserted === 1) {
        return await createJobLockLease(
          database,
          databasePath,
          ownerId,
          1,
          heartbeatIntervalMs
        );
      }
      if (inserted !== 0) {
        throw new Error("Job lease insert changed an unexpected number of rows.");
      }
      const observed = readJobLeaseSnapshot(database);
      if (!observed) {
        continue;
      }
      if (await jobLeaseIsActive(observed)) {
        database.close();
        fail("같은 CHZZK 편집 구간을 이미 준비하고 있습니다.", "ALREADY_RUNNING");
      }
      await beforeStaleCompareAndSwap?.();
      if (!Number.isSafeInteger(observed.revision + 1)) {
        throw new Error("Job lease revision overflowed.");
      }
      const replacementRevision = observed.revision + 1;
      const replaced = sqliteChanges(database.prepare(`
        UPDATE materialization_job_lease
        SET
          schema_id = ?,
          owner_id = ?,
          revision = ?,
          pid = ?,
          created_at_unix_ms = ?,
          heartbeat_at_boot_ms = ?,
          process_start_marker = ?
        WHERE
          singleton = 1
          AND schema_id = ?
          AND owner_id = ?
          AND revision = ?
      `).run(
        CHZZK_JOB_LEASE_SCHEMA_ID,
        ownerId,
        replacementRevision,
        process.pid,
        createdAtUnixMs,
        jobLeaseBootClockMs(),
        processStartMarker ?? null,
        observed.schemaId,
        observed.ownerId,
        observed.revision
      ));
      if (replaced === 1) {
        return await createJobLockLease(
          database,
          databasePath,
          ownerId,
          replacementRevision,
          heartbeatIntervalMs
        );
      }
      if (replaced !== 0) {
        throw new Error("Job lease CAS changed an unexpected number of rows.");
      }
    }
    throw new Error("Job lease ownership did not stabilize.");
  } catch (error) {
    try {
      database.close();
    } catch {
      // Preserve the ownership error.
    }
    if (error instanceof ChzzkVodMaterializationError) {
      throw error;
    }
    fail("CHZZK 편집 구간 작업 잠금을 안전하게 획득하지 못했습니다.", "LOCK_FAILED");
  }
}

function emitProgress(
  callback: ChzzkVodMaterializationRequest["onProgress"],
  progress: ChzzkVodMaterializationProgress
): void {
  if (!callback) {
    return;
  }
  try {
    callback(progress);
  } catch {
    // UI progress callbacks cannot compromise an otherwise valid materialization.
  }
}

function sameResolvedIdentity(
  left: ResolvedChzzkVod,
  right: ResolvedChzzkVod
): boolean {
  return left.canonicalUrl === right.canonicalUrl
    && left.contentId === right.contentId
    && left.durationMs === right.durationMs
    && left.timelineDigest === right.timelineDigest
    && left.sourceVersionId === right.sourceVersionId
    && qualityIdentity(left.quality) === qualityIdentity(right.quality);
}

export async function materializeChzzkVod(
  request: ChzzkVodMaterializationRequest,
  dependencies: ChzzkVodMaterializerDependencies = {}
): Promise<ChzzkVodMaterializationResult> {
  const consumerScopeHash = chzzkVodConsumerScopeHash(request.consumerId);
  const canonicalUrl = normalizeChzzkVodUrl(request.sourceUrl);
  const handleMs = validatedHandleMs(request.handleMs);
  const clips = coreClipRanges(request.clips);
  const desiredEditableRanges = coreDesiredEditableRanges(request.editableRanges);
  abortIfRequested(request.signal);
  const resume = normalizedResumeIdentity(request.resume);
  const base = normalizedResumeIdentity(request.base);
  if (request.base !== undefined && !base) {
    fail("기준 로컬 편집본 식별자가 올바르지 않습니다.", "INVALID_CLIPS");
  }
  if (request.resume !== undefined && request.base !== undefined) {
    fail("동일 작업 재개와 편집 범위 확장은 동시에 요청할 수 없습니다.", "INVALID_CLIPS");
  }
  const canonicalContentId = CHZZK_VIDEO_PATH_PATTERN.exec(
    new URL(canonicalUrl).pathname
  )?.[1];
  if (base && base.contentId !== canonicalContentId) {
    fail("기준 로컬 편집본이 현재 CHZZK VOD와 다릅니다.", "INVALID_CLIPS");
  }
  if (resume && resume.contentId === canonicalContentId) {
    const reopened = await reopenChzzkVodMaterialization({
      ...resume,
      consumerId: request.consumerId,
      clips: request.clips,
      ...(request.editableRanges !== undefined
        ? { editableRanges: request.editableRanges }
        : {}),
      ...(request.handleMs !== undefined ? { handleMs: request.handleMs } : {}),
      ...(request.stateDir !== undefined ? { stateDir: request.stateDir } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
    if (reopened) {
      emitProgress(request.onProgress, {
        phase: "completed",
        completedSegments: 0,
        totalSegments: 0,
        completedBytes: 0
      });
      return reopened;
    }
  }
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    fail("이 Node 환경에서는 공개 CHZZK 요청을 사용할 수 없습니다.", "FETCH_UNAVAILABLE");
  }
  const runProcess = dependencies.runProcess ?? runMaterializerProcess;
  const ffmpegBinary = dependencies.ffmpegBinary?.trim() || "ffmpeg";
  const ffprobeBinary = dependencies.ffprobeBinary?.trim() || "ffprobe";
  const sleep = dependencies.sleep ?? sleepWithMaterializerAbort;
  const stateDirectory = resolveChzzkVodStateDirectory(request.stateDir);
  emitProgress(request.onProgress, {
    phase: "resolving",
    completedSegments: 0,
    totalSegments: 0,
    completedBytes: 0
  });
  let currentResolved = await resolveChzzkVod(canonicalUrl, fetchImpl, request.signal);
  if (clips.some((clip) => (
    clip.sourceStartMs >= currentResolved.durationMs
    || clip.sourceEndMs > currentResolved.durationMs
  ))) {
    fail("편집 구간이 CHZZK VOD 재생 범위를 벗어났습니다.", "INVALID_CLIPS");
  }
  const clipRanges = requestedClipCoverages(
    clips,
    currentResolved.durationMs,
    handleMs,
    desiredEditableRanges
  );
  if (base) {
    await validateBaseMaterialization(
      base,
      stateDirectory,
      consumerScopeHash,
      currentResolved,
      clipRanges,
      handleMs,
      request.signal
    );
  }
  emitProgress(request.onProgress, {
    phase: "planning",
    completedSegments: 0,
    totalSegments: 0,
    completedBytes: 0
  });
  const logicalWindows = mergeMaterializationClipCoverages(clipRanges);
  let initialRuns: PlannedSegmentRun[];
  try {
    initialRuns = planSegmentRuns(currentResolved.segments, logicalWindows);
  } catch {
    fail("선택한 편집 구간을 CHZZK 조각에 맞추지 못했습니다.", "INVALID_CLIPS");
  }
  if (initialRuns.length === 0) {
    fail("선택한 편집 구간과 겹치는 CHZZK 조각이 없습니다.", "INVALID_CLIPS");
  }
  const planFingerprint = materializationPlanFingerprint(
    currentResolved,
    handleMs,
    initialRuns,
    clipRanges
  );
  const materializationId = planFingerprint.slice(0, 32);
  const contentDirectory = path.join(
    vodConsumerChzzkContentRoot(stateDirectory, consumerScopeHash),
    currentResolved.contentId,
    CHZZK_STORAGE_GENERATION,
    currentResolved.sourceVersionId,
    sha256Text(qualityIdentity(currentResolved.quality)).slice(0, 24)
  );
  const segmentDirectory = path.join(contentDirectory, "segments");
  const checkpointPath = path.join(contentDirectory, "checkpoint.json");
  const jobDirectory = scopedChzzkJobDirectory(
    stateDirectory,
    consumerScopeHash,
    materializationId
  );
  const manifestPath = path.join(jobDirectory, "manifest.json");
  const artifactPath = path.join(jobDirectory, "materialized.mp4");
  await ensurePrivateDirectory(segmentDirectory);
  await ensurePrivateDirectory(jobDirectory);
  const expectedIdentity = {
    canonicalUrl,
    contentId: currentResolved.contentId,
    timelineDigest: currentResolved.timelineDigest,
    sourceVersionId: currentResolved.sourceVersionId,
    planFingerprint
  };
  const existing = await reusableCompletedMaterialization(
    manifestPath,
    artifactPath,
    expectedIdentity,
    request.signal
  );
  if (existing && receiptExactlyContainsRequestedClips(
    existing,
    clips,
    handleMs,
    desiredEditableRanges
  )) {
    emitProgress(request.onProgress, {
      phase: "completed",
      completedSegments: new Set(initialRuns.flatMap((run) => (
        run.segments.map(segmentSemanticKey)
      ))).size,
      totalSegments: new Set(initialRuns.flatMap((run) => (
        run.segments.map(segmentSemanticKey)
      ))).size,
      completedBytes: 0
    });
    return {
      manifest: manifestMaterialization(existing),
      receipt: existing,
      artifactPath,
      reused: true
    };
  }

  const lockDatabasePath = path.join(
    jobDirectory,
    CHZZK_JOB_LEASE_DATABASE_FILENAME
  );
  const lockLease = await acquireJobLock(
    lockDatabasePath,
    stateDirectory,
    dependencies.beforeStaleJobLeaseCompareAndSwap,
    dependencies.jobLeaseHeartbeatIntervalMs
  );
  const jobSignal = request.signal
    ? AbortSignal.any([request.signal, lockLease.signal])
    : lockLease.signal;
  let jobFailed = false;
  try {
    const afterLockExisting = await reusableCompletedMaterialization(
      manifestPath,
      artifactPath,
      expectedIdentity,
      jobSignal
    );
    if (
      afterLockExisting
      && receiptExactlyContainsRequestedClips(
        afterLockExisting,
        clips,
        handleMs,
        desiredEditableRanges
      )
    ) {
      return {
        manifest: manifestMaterialization(afterLockExisting),
        receipt: afterLockExisting,
        artifactPath,
        reused: true
      };
    }
    const checkpoint = await loadCheckpoint(checkpointPath, currentResolved);
    const segmentPaths = new Map<string, string>();
    const completedSegmentKeys = new Set<string>();
    const plannedSegmentKeys = new Set(
      initialRuns.flatMap((run) => run.segments.map(segmentSemanticKey))
    );
    let downloadedBytes = 0;
    const refreshResolved = async (): Promise<void> => {
      const refreshed = await resolveChzzkVod(canonicalUrl, fetchImpl, jobSignal);
      if (!sameResolvedIdentity(currentResolved, refreshed)) {
        fail("CHZZK VOD의 품질 또는 타임라인이 준비 도중 바뀌었습니다.", "SOURCE_CHANGED");
      }
      currentResolved = refreshed;
    };
    const ensureOne = async (segment: ExpandedMpdSegment): Promise<string> => {
      const key = segmentSemanticKey(segment);
      plannedSegmentKeys.add(key);
      const existingPath = segmentPaths.get(key);
      if (existingPath) {
        return existingPath;
      }
      const result = await ensureDownloadedSegment({
        segment,
        segmentDirectory,
        checkpoint,
        fetchImpl,
        currentResolved: () => currentResolved,
        refreshResolved,
        sleep,
        signal: jobSignal,
        assertLeaseOwned: lockLease.assertOwned
      });
      segmentPaths.set(key, result.filePath);
      completedSegmentKeys.add(key);
      downloadedBytes += result.downloadedBytes;
      if (!result.reused) {
        await saveCheckpoint(
          checkpointPath,
          currentResolved,
          checkpoint,
          lockLease.assertOwned
        );
      }
      emitProgress(request.onProgress, {
        phase: "downloading",
        completedSegments: completedSegmentKeys.size,
        totalSegments: plannedSegmentKeys.size,
        completedBytes: downloadedBytes
      });
      return result.filePath;
    };

    for (const run of initialRuns) {
      for (const segment of run.segments) {
        await ensureOne(segment);
      }
    }
    emitProgress(request.onProgress, {
      phase: "verifying",
      completedSegments: completedSegmentKeys.size,
      totalSegments: plannedSegmentKeys.size,
      completedBytes: downloadedBytes
    });
    const preparedRuns: PlannedSegmentRun[] = [];
    for (const originalRun of initialRuns) {
      let accepted: PlannedSegmentRun | undefined;
      for (let prefixCount = 0; prefixCount <= MAX_DECODER_PREFIX_SEGMENTS; prefixCount += 1) {
        let candidate: PlannedSegmentRun;
        try {
          candidate = prefixCount === 0
            ? originalRun
            : prependDecoderPrefixSegments(
              originalRun,
              currentResolved.segments,
              prefixCount
            );
        } catch {
          fail("선택 구간 앞에서 디코딩 가능한 키프레임을 찾지 못했습니다.", "NO_RANDOM_ACCESS_POINT");
        }
        const firstSegment = candidate.segments[0];
        if (!firstSegment) {
          fail("검사할 CHZZK 미디어 조각이 없습니다.", "MEDIA_VERIFICATION_FAILED");
        }
        const firstPath = await ensureOne(firstSegment);
        if (await inspectSegmentRandomAccess(
          firstPath,
          runProcess,
          ffprobeBinary,
          jobDirectory,
          jobSignal
        )) {
          accepted = candidate;
          break;
        }
      }
      if (!accepted) {
        fail("제한된 이전 조각 안에서 디코딩 키프레임을 찾지 못했습니다.", "NO_RANDOM_ACCESS_POINT");
      }
      preparedRuns.push(accepted);
    }
    const mergedRuns = mergePreparedRuns(preparedRuns);
    for (const run of mergedRuns) {
      for (const segment of run.segments) {
        await ensureOne(segment);
      }
    }
    const windows = createMaterializationWindows(mergedRuns);
    const mediaDurationMs = windows.at(-1)?.mediaEndMs ?? 0;
    if (mediaDurationMs <= 0) {
      fail("로컬 편집 미디어 시간 매핑을 만들지 못했습니다.", "MEDIA_MUX_FAILED");
    }
    emitProgress(request.onProgress, {
      phase: "muxing",
      completedSegments: completedSegmentKeys.size,
      totalSegments: plannedSegmentKeys.size,
      completedBytes: downloadedBytes
    });
    lockLease.assertOwned();
    await rm(artifactPath, { force: true }).catch(() => undefined);
    await remuxRuns({
      runs: mergedRuns,
      segmentPaths,
      jobDirectory,
      artifactPath,
      runProcess,
      ffmpegBinary,
      ffprobeBinary,
      signal: jobSignal,
      assertLeaseOwned: lockLease.assertOwned
    });
    const boundariesMs = windows.slice(0, -1).map((window) => window.mediaEndMs);
    const artifactDurationMs = await inspectFinalArtifact(
      artifactPath,
      mediaDurationMs,
      boundariesMs,
      runProcess,
      ffprobeBinary,
      jobDirectory,
      jobSignal
    );
    const artifactStatus = await stat(artifactPath);
    const preparedAt = new Date().toISOString();
    const manifest: ChzzkVodMaterializationManifest = {
      schemaId: CHZZK_VOD_MATERIALIZATION_SCHEMA_ID,
      materializationId,
      planFingerprint,
      canonicalUrl,
      contentId: currentResolved.contentId,
      durationMs: currentResolved.durationMs,
      mediaDurationMs,
      handleMs,
      quality: currentResolved.quality,
      timelineDigest: currentResolved.timelineDigest,
      sourceVersionId: currentResolved.sourceVersionId,
      clips: createReceiptClips(clipRanges),
      windows,
      artifact: {
        hashSha256: await sha256File(artifactPath, jobSignal),
        sizeBytes: artifactStatus.size,
        durationMs: artifactDurationMs
      },
      preparedAt
    };
    assertPublicManifestIsSecretFree(manifest);
    await atomicWriteJson(manifestPath, manifest, lockLease.assertOwned);
    for (let index = 0; index < mergedRuns.length; index += 1) {
      lockLease.assertOwned();
      await rm(path.join(jobDirectory, `run-${index}.ts`), { force: true })
        .catch(() => undefined);
      lockLease.assertOwned();
      await rm(path.join(jobDirectory, `run-${index}.mp4`), { force: true })
        .catch(() => undefined);
    }
    lockLease.assertOwned();
    await rm(path.join(jobDirectory, "runs.concat.txt"), { force: true })
      .catch(() => undefined);
    emitProgress(request.onProgress, {
      phase: "completed",
      completedSegments: completedSegmentKeys.size,
      totalSegments: plannedSegmentKeys.size,
      completedBytes: downloadedBytes
    });
    return {
      manifest: manifestMaterialization(manifest),
      receipt: manifest,
      artifactPath,
      reused: false
    };
  } catch (error) {
    jobFailed = true;
    if (lockLease.failure) {
      throw jobLockFailure(lockLease.failure);
    }
    throw error;
  } finally {
    try {
      await lockLease.release();
    } catch (error) {
      if (!jobFailed) {
        throw error;
      }
    }
  }
}
