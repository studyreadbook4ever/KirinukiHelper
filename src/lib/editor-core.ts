import {
  BLACK_BOX_CAPTION_STYLE_PRESET_ID,
  CAPTION_STYLE_PRESETS,
  DEFAULT_CAPTION_STYLE_PRESET_ID,
  LEGACY_CAPTION_STYLE_PRESET_ID,
  captionStyleDefaults,
  normalizeCaptionStylePresetId
} from "./caption-style.js";
import {
  activeShortFormWorkspace,
  createDefaultShortFormBranch,
  normalizeShortFormBranch,
  normalizeShortFormWorkspaceCollection,
  saveActiveShortFormWorkspace
} from "./short-form.js";
import type {
  EditorShortFormBranch,
  EditorShortFormWorkspaceCollection
} from "./short-form.js";
import {
  normalizeSoopVodSourceClockIdentity
} from "./soop-vod-source-clock.js";

export const EDITOR_SCHEMA = "chzzk-kirinuki-editor/v3";
export const EDITOR_PROJECTS_STORE_KEY = "chzzkKirinukiEditorProjectsV1";
export const EDITOR_SEED_PREFIX = "chzzkKirinukiEditorSeed:";
export const EDITOR_DATABASE_NAME = "chzzk-kirinuki-studio";
export const MIN_SUBTITLE_LANES = 2;
export const MAX_SUBTITLE_LANES = 8;
export const MAX_AI_WARNINGS = 4_000;
export const MAX_AI_CAPTION_CHECKPOINTS = 500;
export const DEFAULT_SUBTITLE_COLOR = "#ffffff";
export const MAX_RECENT_SUBTITLE_COLORS = 5;
export const SUPPORTED_IMAGE_ASSET_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

const MIN_CLIP_DURATION_MS = 100;
const MIN_CUE_DURATION_MS = 100;
const LEGACY_EDITOR_SCHEMA_V1 = "chzzk-kirinuki-editor/v1";
const LEGACY_EDITOR_SCHEMA_V2 = "chzzk-kirinuki-editor/v2";
const ACCEPTED_EDITOR_SCHEMAS = new Set([
  EDITOR_SCHEMA,
  LEGACY_EDITOR_SCHEMA_V1,
  LEGACY_EDITOR_SCHEMA_V2
]);
const AUTOMATIC_CAPTION_POSITION = Object.freeze({
  x: 0.5,
  y: 0.84,
  placement: "bottom"
});

// Editor projects are persisted user documents and older schema versions may
// contain extension fields. The dynamic index is confined to that storage
// boundary; timeline entities expose their stable fields below.
type DynamicRecord = Record<string, unknown>;

export interface SourceRecord {
  platform?: unknown;
  channelId?: unknown;
  broadcastStartedAt?: unknown;
  contentId?: unknown;
  contentType?: unknown;
  canonicalUrl?: unknown;
  url?: unknown;
  broadcastTitle?: unknown;
  streamerName?: unknown;
  /** Strict, secret-free official SOOP multipart clock identity. */
  sourceClockIdentity?: unknown;
}

function sourceWithValidatedClockIdentity(
  source: SourceRecord
): SourceRecord {
  const normalized: SourceRecord = { ...source };
  delete normalized.sourceClockIdentity;
  const platform = String(source.platform || "").trim().toUpperCase();
  const contentId = String(source.contentId || "").trim();
  const identity = platform === "SOOP"
    ? normalizeSoopVodSourceClockIdentity(source.sourceClockIdentity)
    : null;
  if (identity && identity.contentId === contentId) {
    normalized.sourceClockIdentity = identity;
  }
  return normalized;
}

interface BroadcastSessionRecord extends DynamicRecord {
  id?: string;
  channelId?: unknown;
  broadcastStartedAt?: unknown;
  liveUrl?: unknown;
  vodUrl?: unknown;
  vodContentId?: unknown;
  alignmentOffsetMs?: unknown;
  alignmentConfirmed?: unknown;
}

interface SubtitleRemoteMeta extends DynamicRecord {
  speakerId?: string;
  reviewRequired?: boolean;
  placement?: string;
  qualityStatus?: string;
  qualityCodes?: string[];
}

export interface SubtitleDefaultsRecord extends DynamicRecord {
  stylePresetId: string;
  fontId: string;
  fontFamily: string;
  fontWeight: number;
  fontScale: number;
  lineHeight: number;
  maxLines: number;
  maxWidth: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundRadiusEm: number;
  shadowColor: string;
  shadowOffsetXEm: number;
  shadowOffsetYEm: number;
  shadowBlurEm: number;
  x: number;
  y: number;
  align: "left" | "center" | "right";
}

export interface AiCaptionCheckpoint {
  clipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  model: string;
  qualityProfile: string;
  harnessFingerprint: string;
  editorialContextFingerprint: string;
  pipelineFingerprint: string;
  requestId?: string;
  completedAt?: string;
}

interface AiStateRecord extends DynamicRecord {
  provider: string;
  model: string;
  status: string;
  progress: number;
  warnings: AiWarning[];
  speakerColors: Record<string, string>;
  captionCheckpoints: AiCaptionCheckpoint[];
  resolvedModel?: string;
}

interface HistoryRecord extends DynamicRecord {
  undo?: unknown[];
  redo?: unknown[];
}

interface SuppressedSelection extends DynamicRecord {
  selectionId: string;
  selectionStartMs: number;
  selectionEndMs: number;
}

interface TimedItemRecord extends DynamicRecord {
  id: string;
  clipId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EditorMediaAsset extends DynamicRecord {
  durationMs: number;
  mediaOriginMs?: number;
  mediaEndTimestampMs?: number;
  frameRate?: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoDecodable?: boolean | null;
  audioDecodable?: boolean | null;
}

export interface EditorImageAssetSource {
  kind: string;
  value: string;
}

export interface SubtitleCueDraftInput {
  id?: unknown;
  clipId?: unknown;
  startOffsetMs?: unknown;
  endOffsetMs?: unknown;
  text?: unknown;
  lane?: unknown;
  color?: unknown;
  fontScale?: unknown;
  backgroundEnabled?: unknown;
  x?: unknown;
  y?: unknown;
  origin?: unknown;
  confidence?: unknown;
  remoteMeta?: unknown;
  createdAt?: unknown;
}

export interface SubtitleCueDraft extends SubtitleCueDraftInput {
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
}

interface TranscriptChunk extends DynamicRecord {
  text?: unknown;
  timestamp?: readonly unknown[];
}

interface TimelineSnapOptions {
  clipId?: unknown;
  excludeCueId?: unknown;
  excludeImageAssetId?: unknown;
  preferredKind?: unknown;
  includePlayhead?: unknown;
}

interface TimelineSnapInput {
  timeMs?: unknown;
  kind?: unknown;
  edge?: unknown;
  itemId?: unknown;
  label?: unknown;
}

export interface TimelineSourcePosition {
  clipId: string;
  timelineMs: number;
  clipOffsetMs: number;
  sourceMs: number;
}

function recordOrEmpty(value: unknown): DynamicRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DynamicRecord
    : {};
}

export interface EditorClip extends DynamicRecord {
  id: string;
  selectionId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  selectionStartMs: number;
  selectionEndMs: number;
  timelineStartMs: number;
  enabled: boolean;
  authority?: string;
  note?: string;
  capture?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EditorSubtitleCue extends DynamicRecord {
  id: string;
  clipId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
  lane: number;
  speakerId?: string;
  reviewRequired?: boolean;
  origin: string;
  humanEdited: boolean;
  remoteMeta?: SubtitleRemoteMeta | null;
  x: number;
  y: number;
  color: string;
  fontScale?: number;
  backgroundEnabled?: boolean;
  confidence: number | null;
}

export interface EditorImageAsset extends DynamicRecord {
  id: string;
  clipId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  name: string;
  mimeType: string;
  source: EditorImageAssetSource;
  sourceUrl: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  naturalWidth: number | null;
  naturalHeight: number | null;
}

export interface EditorAudioRegion extends DynamicRecord {
  id: string;
  clipId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  gain: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface EditorProject extends DynamicRecord {
  schema?: string;
  id: string;
  name: string;
  source: SourceRecord;
  broadcastSession: BroadcastSessionRecord;
  mediaAsset: EditorMediaAsset | null;
  clips: EditorClip[];
  suppressedSelections: SuppressedSelection[];
  imageAssets: EditorImageAsset[];
  subtitles: EditorSubtitleCue[];
  subtitleLaneCount: number;
  recentSubtitleColors: string[];
  audioRegions: EditorAudioRegion[];
  shortForm: EditorShortFormBranch;
  shortFormWorkspaces: EditorShortFormWorkspaceCollection;
  subtitleDefaults: SubtitleDefaultsRecord;
  ai: AiStateRecord;
  history?: HistoryRecord;
  selectedClipId?: string | null;
  selectedImageAssetId?: string | null;
  selectedCueId?: string | null;
  selectedAudioRegionId?: string | null;
  playheadMs: number;
}

interface CaptureSegment {
  id?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
  description?: unknown;
  startCapture?: unknown;
  endCapture?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface CaptureDraft {
  startCapture?: unknown;
  endCapture?: unknown;
  startText?: unknown;
  endText?: unknown;
}

export interface CaptureState {
  source?: SourceRecord;
  projectName?: unknown;
  segments?: CaptureSegment[];
  draft?: CaptureDraft;
}

interface AiWarning {
  clipId?: string;
  code: string;
  cueIndex: number;
}

interface TimelineRange {
  startMs: number;
  endMs: number;
}

interface TimelineSnapCandidate extends DynamicRecord {
  timeMs: number;
  kind: string;
  edge: string;
  itemId: string | null;
  label: string;
  priority: number;
}

interface RippleSlice {
  oldStartOffsetMs: number;
  oldEndOffsetMs: number;
  nextClip: EditorClip;
}

interface RippleFragment {
  slice: RippleSlice;
  overlapStartMs: number;
  overlapEndMs: number;
  startOffsetMs: number;
  endOffsetMs: number;
}

interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
}

function hasTimelineRange<T extends { range: TimelineRange | null }>(
  entry: T
): entry is T & { range: TimelineRange } {
  return entry.range !== null;
}

const nowIso = () => new Date().toISOString();
const makeId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const finiteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizedCaptionStyleDefaults(
  presetId: unknown
): SubtitleDefaultsRecord {
  const defaults = captionStyleDefaults(
    normalizeCaptionStylePresetId(presetId)
  );
  return {
    ...defaults,
    align: defaults.align === "left" || defaults.align === "right"
      ? defaults.align
      : "center"
  };
}

export const secondsToMilliseconds = (seconds: unknown): number => Math.max(0, Math.round(finiteNumber(seconds) * 1000));
export const millisecondsToSeconds = (milliseconds: unknown): number => Math.max(0, finiteNumber(milliseconds) / 1000);
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function normalizeAiWarning(value: unknown): AiWarning | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as DynamicRecord;
  const code = String(source.code || "").trim().slice(0, 128);
  const cueIndex = Number(source.cueIndex);
  if (!code || !Number.isInteger(cueIndex) || cueIndex < 0) {
    return null;
  }
  const clipId = String(source.clipId || "").trim().slice(0, 256);
  return {
    ...(clipId ? { clipId } : {}),
    code,
    cueIndex
  };
}

export function normalizeAiWarnings(value: unknown): AiWarning[] {
  const source = Array.isArray(value) ? value : [];
  const warnings: AiWarning[] = [];
  let truncated = source.length > MAX_AI_WARNINGS;
  for (
    let index = 0;
    index < Math.min(source.length, MAX_AI_WARNINGS + 1);
    index += 1
  ) {
    const warning = normalizeAiWarning(source[index]);
    if (!warning) {
      continue;
    }
    if (warnings.length >= MAX_AI_WARNINGS) {
      truncated = true;
      break;
    }
    warnings.push(warning);
  }
  if (truncated) {
    const marker = {
      code: "TRIMMED_WARNING_COUNT",
      cueIndex: 0
    };
    if (warnings.length >= MAX_AI_WARNINGS) {
      warnings[MAX_AI_WARNINGS - 1] = marker;
    } else {
      warnings.push(marker);
    }
  }
  return warnings;
}

export function mergeAiWarnings(
  existing: unknown,
  incoming: unknown,
  clipId: unknown
): AiWarning[] {
  const normalizedExisting = normalizeAiWarnings(existing);
  if (
    normalizedExisting.at(-1)?.code === "TRIMMED_WARNING_COUNT"
  ) {
    return normalizedExisting;
  }
  const boundedIncoming = (Array.isArray(incoming) ? incoming : [])
    .slice(0, MAX_AI_WARNINGS + 1)
    .map((warning) => ({
      ...warning,
      clipId: String(clipId || warning?.clipId || "")
    }));
  return normalizeAiWarnings([
    ...normalizedExisting,
    ...boundedIncoming
  ]);
}

export function normalizeAiCaptionCheckpoints(
  value: unknown,
  clips: EditorClip[] = []
): AiCaptionCheckpoint[] {
  const clipIds = new Set(
    (Array.isArray(clips) ? clips : [])
      .map((clip) => String(clip?.id || ""))
      .filter(Boolean)
  );
  const byKey = new Map<string, AiCaptionCheckpoint>();
  for (const raw of (Array.isArray(value) ? value : []).slice(
    -MAX_AI_CAPTION_CHECKPOINTS
  )) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const clipId = String(raw.clipId || "").trim().slice(0, 256);
    const sourceStartMs = Math.round(finiteNumber(raw.sourceStartMs, -1));
    const sourceEndMs = Math.round(finiteNumber(raw.sourceEndMs, -1));
    const model = String(raw.model || "").trim();
    const qualityProfile = String(
      raw.qualityProfile || "legacy-unharnessed-v0"
    ).trim().slice(0, 128);
    const harnessFingerprint = String(
      raw.harnessFingerprint || "legacy-harness-fingerprint-v0"
    ).trim().slice(0, 128);
    const editorialContextFingerprint = String(
      raw.editorialContextFingerprint || "legacy-context-v0"
    ).trim().slice(0, 128);
    const pipelineFingerprint = String(
      raw.pipelineFingerprint || "legacy-caption-pipeline-v0"
    ).trim().slice(0, 128);
    if (
      !clipId
      || !clipIds.has(clipId)
      || sourceStartMs < 0
      || sourceEndMs <= sourceStartMs
      || !["whisper-tiny", "audseg-local"].includes(model)
    ) {
      continue;
    }
    const requestId = String(raw.requestId || "").trim().slice(0, 128);
    const completedAt = String(raw.completedAt || "").trim().slice(0, 64);
    const checkpoint = {
      clipId,
      sourceStartMs,
      sourceEndMs,
      model,
      qualityProfile,
      harnessFingerprint,
      editorialContextFingerprint,
      pipelineFingerprint,
      ...(requestId ? { requestId } : {}),
      ...(completedAt ? { completedAt } : {})
    };
    byKey.set(
      [
        clipId,
        sourceStartMs,
        sourceEndMs,
        model,
        qualityProfile,
        harnessFingerprint,
        editorialContextFingerprint,
        pipelineFingerprint
      ].join("\u0000"),
      checkpoint
    );
  }
  return [...byKey.values()].slice(-MAX_AI_CAPTION_CHECKPOINTS);
}

export function normalizeHexColor(value: unknown, fallback = "#ffffff"): string {
  const candidate = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/u.test(candidate)) {
    return candidate;
  }
  if (/^#[0-9a-f]{3}$/u.test(candidate)) {
    return `#${[...candidate.slice(1)].map((character) => character.repeat(2)).join("")}`;
  }
  return fallback;
}

export function normalizeRecentSubtitleColors(value: unknown): string[] {
  const normalized: string[] = [];
  for (const rawColor of Array.isArray(value) ? value : []) {
    const color = normalizeHexColor(rawColor, "");
    if (
      !color
      || color === DEFAULT_SUBTITLE_COLOR
      || normalized.includes(color)
    ) {
      continue;
    }
    normalized.push(color);
    if (normalized.length >= MAX_RECENT_SUBTITLE_COLORS) {
      break;
    }
  }
  return normalized;
}

export function rememberSubtitleColor(
  project: EditorProject | null | undefined,
  rawColor: unknown
): EditorProject | null | undefined {
  if (!project || typeof project !== "object") {
    return project;
  }
  const color = normalizeHexColor(rawColor, "");
  const current = normalizeRecentSubtitleColors(project.recentSubtitleColors);
  if (!color || color === DEFAULT_SUBTITLE_COLOR) {
    return Array.isArray(project.recentSubtitleColors)
      && project.recentSubtitleColors.length === current.length
      && project.recentSubtitleColors.every((entry, index) => entry === current[index])
      ? project
      : { ...project, recentSubtitleColors: current };
  }
  const next = [
    color,
    ...current.filter((candidate) => candidate !== color)
  ].slice(0, MAX_RECENT_SUBTITLE_COLORS);
  if (
    Array.isArray(project.recentSubtitleColors)
    && project.recentSubtitleColors.length === next.length
    && project.recentSubtitleColors.every((entry, index) => entry === next[index])
  ) {
    return project;
  }
  return {
    ...project,
    recentSubtitleColors: next,
    updatedAt: nowIso()
  };
}

export function normalizeAiSpeakerColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const assignments: Record<string, string> = {};
  for (const [rawSpeakerId, rawColor] of Object.entries(value).slice(0, 64)) {
    const speakerId = String(rawSpeakerId || "")
      .trim()
      .toLowerCase()
      .slice(0, 80);
    const color = String(rawColor || "").trim().toLowerCase();
    if (!speakerId || !/^#[0-9a-f]{6}$/u.test(color)) {
      continue;
    }
    assignments[speakerId] = color;
  }
  return assignments;
}

function normalizeImageMimeType(value: unknown): string {
  const candidate = String(value || "").trim().toLowerCase();
  const normalized = candidate === "image/jpg" ? "image/jpeg" : candidate;
  return (SUPPORTED_IMAGE_ASSET_MIME_TYPES as readonly string[]).includes(normalized)
    ? normalized
    : "";
}

function imageMimeTypeFromDataUrl(value: unknown): string {
  const match = /^data:([^;,]+)(?:;[^,]*)?,/iu.exec(String(value || "").trim());
  return normalizeImageMimeType(match?.[1]);
}

export function normalizeImageAssetSource(
  raw: unknown,
  mimeType = ""
): { kind: string; value: string } | null {
  const candidate = raw && typeof raw === "object"
    ? raw as DynamicRecord
    : typeof raw === "string"
      ? { kind: raw.startsWith("data:") ? "data-url" : "blob-key", value: raw }
      : null;
  if (!candidate) {
    return null;
  }
  const kind = candidate.kind === "blob-key" ? "blob-key" : "data-url";
  const value = String(
    candidate.value
      ?? candidate.dataUrl
      ?? candidate.blobKey
      ?? ""
  ).trim();
  if (!value) {
    return null;
  }
  if (kind === "blob-key") {
    return { kind, value };
  }
  const dataMimeType = imageMimeTypeFromDataUrl(value);
  if (
    !dataMimeType
    || !value.startsWith(`data:${dataMimeType}`)
    || !value.includes(",")
  ) {
    return null;
  }
  const requestedMimeType = normalizeImageMimeType(mimeType);
  if (requestedMimeType && requestedMimeType !== dataMimeType) {
    return null;
  }
  return { kind, value };
}

export function normalizeMediaAsset(raw: unknown): EditorMediaAsset | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as DynamicRecord;
  const durationMs = Math.max(0, Math.round(finiteNumber(source.durationMs)));
  const mediaOriginMs = Math.max(0, Math.round(finiteNumber(source.mediaOriginMs)));
  const providedEndMs = Number(source.mediaEndTimestampMs);
  const mediaEndTimestampMs = Number.isFinite(providedEndMs) && providedEndMs >= mediaOriginMs
    ? Math.round(providedEndMs)
    : mediaOriginMs + durationMs;
  const frameRate = Number(source.frameRate);
  return {
    ...source,
    durationMs,
    mediaOriginMs,
    mediaEndTimestampMs,
    frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null,
    hasVideo: Boolean(source.hasVideo),
    hasAudio: Boolean(source.hasAudio),
    videoDecodable: source.videoDecodable == null ? null : Boolean(source.videoDecodable),
    audioDecodable: source.audioDecodable == null ? null : Boolean(source.audioDecodable)
  };
}

export function sourceSessionIdentity(source: SourceRecord = {}): string {
  const platform = String(source.platform ?? "CHZZK")
    .trim()
    .toUpperCase() || "CHZZK";
  const platformPrefix = platform === "CHZZK"
    ? ""
    : `${platform.toLowerCase()}:`;
  const channelId = String(source.channelId ?? "").trim();
  const startedAt = String(source.broadcastStartedAt ?? "").trim();
  const contentId = String(source.contentId ?? "").trim();
  const contentType = String(source.contentType ?? "unknown").trim();

  if (platform !== "CHZZK" && contentId) {
    return `${platformPrefix}${contentType}:${contentId}`;
  }
  if (channelId && startedAt) {
    return `${platformPrefix}broadcast:${channelId}:${startedAt}`;
  }
  if (contentId) {
    return `${platformPrefix}${contentType}:${contentId}`;
  }
  if (channelId) {
    return `${platformPrefix}${contentType}:${channelId}`;
  }
  return String(source.canonicalUrl || source.url || "").trim();
}

export function sameSourceSession(
  leftSource: SourceRecord = {},
  rightSource: SourceRecord = {}
): boolean {
  const leftPlatform = String(leftSource.platform ?? "CHZZK")
    .trim()
    .toUpperCase() || "CHZZK";
  const rightPlatform = String(rightSource.platform ?? "CHZZK")
    .trim()
    .toUpperCase() || "CHZZK";
  if (leftPlatform !== rightPlatform) {
    return false;
  }

  const leftContentType = String(leftSource.contentType ?? "unknown")
    .trim()
    .toLowerCase() || "unknown";
  const rightContentType = String(rightSource.contentType ?? "unknown")
    .trim()
    .toLowerCase() || "unknown";
  const sameContentType = leftContentType === rightContentType;
  const chzzkLiveVodPair = (
    leftPlatform === "CHZZK"
    && new Set([leftContentType, rightContentType]).size === 2
    && [leftContentType, rightContentType].every((type) => (
      type === "live" || type === "vod"
    ))
  );
  const youtubeLiveVodPair = (
    leftPlatform === "YOUTUBE"
    && new Set([leftContentType, rightContentType]).size === 2
    && [leftContentType, rightContentType].every((type) => (
      type === "live" || type === "vod"
    ))
  );
  if (!sameContentType && !chzzkLiveVodPair && !youtubeLiveVodPair) {
    return false;
  }

  const leftContentId = String(leftSource.contentId ?? "").trim();
  const rightContentId = String(rightSource.contentId ?? "").trim();
  const involvesChzzkLive = (
    leftPlatform === "CHZZK"
    && (leftContentType === "live" || rightContentType === "live")
  );
  if (leftContentId && rightContentId && !involvesChzzkLive) {
    return leftContentId === rightContentId;
  }

  if (leftPlatform === "CHZZK") {
    const leftChannelId = String(leftSource.channelId ?? "").trim();
    const rightChannelId = String(rightSource.channelId ?? "").trim();
    const leftStartedAt = String(
      leftSource.broadcastStartedAt ?? ""
    ).trim();
    const rightStartedAt = String(
      rightSource.broadcastStartedAt ?? ""
    ).trim();
    if (
      leftChannelId
      && rightChannelId
      && leftStartedAt
      && rightStartedAt
    ) {
      return (
        leftChannelId === rightChannelId
        && leftStartedAt === rightStartedAt
      );
    }
    if (chzzkLiveVodPair) {
      return false;
    }
    if (leftContentType === "live") {
      return Boolean(
        leftChannelId
        && rightChannelId
        && leftChannelId === rightChannelId
        && !leftStartedAt
        && !rightStartedAt
      );
    }
  }

  const leftIdentity = sourceSessionIdentity(leftSource);
  const rightIdentity = sourceSessionIdentity(rightSource);
  return Boolean(leftIdentity && leftIdentity === rightIdentity);
}

export function mergeSameSourceSessionMetadata<T extends SourceRecord>(
  previousSource: T,
  nextSource: T
): T {
  if (!sameSourceSession(previousSource, nextSource)) {
    return { ...nextSource } as T;
  }
  const previousContentType = String(
    previousSource.contentType ?? "unknown"
  ).trim().toLowerCase() || "unknown";
  const nextContentType = String(
    nextSource.contentType ?? previousContentType
  ).trim().toLowerCase() || previousContentType;
  const nextContentId = String(nextSource.contentId ?? "").trim();
  const previousContentId = String(
    previousSource.contentId ?? ""
  ).trim();
  const nextPlatform = String(
    nextSource.platform ?? previousSource.platform ?? "CHZZK"
  ).trim().toUpperCase() || "CHZZK";
  const stableContentId = (
    nextPlatform === "CHZZK"
    && nextContentType === "live"
  )
    ? ""
    : nextContentId || (
      previousContentType === nextContentType
        ? previousContentId
        : ""
    );
  return {
    ...nextSource,
    platform: nextSource.platform || previousSource.platform,
    channelId: nextSource.channelId || previousSource.channelId,
    broadcastStartedAt: (
      nextSource.broadcastStartedAt
      || previousSource.broadcastStartedAt
    ),
    contentId: stableContentId,
    contentType: nextContentType,
    canonicalUrl: (
      nextSource.canonicalUrl
      || nextSource.url
      || previousSource.canonicalUrl
      || previousSource.url
    ),
    url: (
      nextSource.url
      || nextSource.canonicalUrl
      || previousSource.url
      || previousSource.canonicalUrl
    )
  } as T;
}

export function captureStateSourceConflict(
  captureState: CaptureState = {},
  nextSource: SourceRecord = {}
): boolean {
  const previousIdentity = sourceSessionIdentity(captureState.source);
  const nextIdentity = sourceSessionIdentity(nextSource);
  const draft = captureState.draft || {};
  const hasRange = Boolean(
    (Array.isArray(captureState.segments) && captureState.segments.length > 0) ||
    draft.startCapture ||
    draft.endCapture ||
    String(draft.startText || "").trim() ||
    String(draft.endText || "").trim()
  );
  return Boolean(
    hasRange &&
    previousIdentity &&
    nextIdentity &&
    !sameSourceSession(captureState.source, nextSource)
  );
}

export function captureProjectId(captureState: CaptureState = {}): string {
  const sourceIdentity = sourceSessionIdentity(captureState.source);
  const base = sourceIdentity || captureState.projectName || "untitled";
  let hash = 2166136261;
  for (const character of String(base)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `project-${(hash >>> 0).toString(36)}`;
}

function createBroadcastSession(
  source: SourceRecord = {}
): BroadcastSessionRecord {
  const contentType = source.contentType || "unknown";
  const isLive = contentType === "live";
  const isVod = contentType === "vod";
  return {
    id: sourceSessionIdentity(source),
    channelId: source.channelId || "",
    broadcastStartedAt: source.broadcastStartedAt || "",
    liveUrl: isLive ? (source.canonicalUrl || source.url || "") : "",
    vodUrl: isVod ? (source.canonicalUrl || source.url || "") : "",
    vodContentId: isVod ? (source.contentId || "") : "",
    alignmentOffsetMs: 0,
    alignmentConfirmed: isVod
  };
}

export function captureSegmentEditorClipId(
  segment: Pick<CaptureSegment, "id">,
  index: number
): string {
  return `clip-${segment.id || index + 1}`;
}

function segmentToClip(segment: CaptureSegment, index: number): EditorClip {
  const sourceStartMs = secondsToMilliseconds(segment.startSeconds);
  const sourceEndMs = Math.max(
    sourceStartMs + MIN_CLIP_DURATION_MS,
    secondsToMilliseconds(segment.endSeconds)
  );
  return {
    id: captureSegmentEditorClipId(segment, index),
    selectionId: String(segment.id || `selection-${index + 1}`),
    authority: "USER",
    sourceStartMs,
    sourceEndMs,
    selectionStartMs: sourceStartMs,
    selectionEndMs: sourceEndMs,
    timelineStartMs: 0,
    enabled: true,
    note: String(segment.description || ""),
    capture: {
      start: segment.startCapture || null,
      end: segment.endCapture || null
    },
    createdAt: segment.createdAt || nowIso(),
    updatedAt: segment.updatedAt || segment.createdAt || nowIso()
  };
}

export function reflowClips(clips: EditorClip[] = []): EditorClip[] {
  let cursor = 0;
  return clips.map((clip) => {
    const sourceStartMs = Math.max(0, Math.round(finiteNumber(clip.sourceStartMs)));
    const sourceEndMs = Math.max(
      sourceStartMs + MIN_CLIP_DURATION_MS,
      Math.round(finiteNumber(clip.sourceEndMs, sourceStartMs + MIN_CLIP_DURATION_MS))
    );
    const normalized = {
      ...clip,
      sourceStartMs,
      sourceEndMs,
      timelineStartMs: cursor,
      enabled: clip.enabled !== false
    };
    if (normalized.enabled) {
      cursor += sourceEndMs - sourceStartMs;
    }
    return normalized;
  });
}

function normalizeSuppressedSelection(
  raw: unknown
): SuppressedSelection | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as DynamicRecord;
  const selectionId = String(source.selectionId || "").trim();
  const requestedStartMs = Number(source.selectionStartMs);
  const requestedEndMs = Number(source.selectionEndMs);
  if (
    !selectionId ||
    !Number.isFinite(requestedStartMs) ||
    !Number.isFinite(requestedEndMs)
  ) {
    return null;
  }
  const selectionStartMs = Math.max(0, Math.round(requestedStartMs));
  const selectionEndMs = Math.round(requestedEndMs);
  if (selectionEndMs - selectionStartMs < MIN_CLIP_DURATION_MS) {
    return null;
  }
  return {
    ...source,
    selectionId,
    selectionStartMs,
    selectionEndMs,
    createdAt: source.createdAt || nowIso(),
    updatedAt: source.updatedAt || source.createdAt || nowIso()
  };
}

export function createEditorProjectFromCapture(captureState: CaptureState = {}, {
  id = captureProjectId(captureState),
  createdAt = nowIso()
}: { id?: string; createdAt?: string } = {}): EditorProject {
  const source = sourceWithValidatedClockIdentity(captureState.source || {});
  const clips = reflowClips((captureState.segments || []).map(segmentToClip));
  const subtitles: EditorSubtitleCue[] = [];
  const imageAssets: EditorImageAsset[] = [];
  const audioRegions: EditorAudioRegion[] = [];
  const recentSubtitleColors: string[] = [];
  const subtitleDefaults = normalizedCaptionStyleDefaults(
    DEFAULT_CAPTION_STYLE_PRESET_ID
  );
  const ai: AiStateRecord = {
    provider: "caption-agent",
    model: "whisper-tiny",
    language: "korean",
    status: "idle",
    progress: 0,
    lastRunAt: null,
    error: null,
    warnings: [],
    captionCheckpoints: [],
    speakerColors: {}
  };
  const shortForm = normalizeShortFormBranch(createDefaultShortFormBranch(), {
    clips,
    subtitles,
    imageAssets,
    audioRegions,
    subtitleLaneCount: MIN_SUBTITLE_LANES,
    recentSubtitleColors,
    subtitleDefaults,
    ai
  });
  const shortFormWorkspaces = normalizeShortFormWorkspaceCollection(
    null,
    shortForm,
    {
      clips,
      subtitles,
      imageAssets,
      audioRegions,
      subtitleLaneCount: MIN_SUBTITLE_LANES,
      recentSubtitleColors,
      subtitleDefaults,
      ai
    }
  );
  return {
    schema: EDITOR_SCHEMA,
    id,
    name: String(captureState.projectName || source.broadcastTitle || "새 키리누키 프로젝트"),
    source,
    broadcastSession: createBroadcastSession(source),
    mediaAsset: null,
    clips,
    suppressedSelections: [],
    imageAssets,
    subtitles,
    subtitleLaneCount: MIN_SUBTITLE_LANES,
    recentSubtitleColors,
    audioRegions,
    shortForm,
    shortFormWorkspaces,
    selectedClipId: clips[0]?.id || null,
    selectedImageAssetId: null,
    selectedCueId: null,
    selectedAudioRegionId: null,
    playheadMs: 0,
    subtitleDefaults,
    ai,
    history: {
      undo: [],
      redo: []
    },
    createdAt,
    updatedAt: createdAt
  };
}

export function normalizeEditorProject(raw: DynamicRecord | null | undefined): EditorProject | null {
  if (
    !raw
    || typeof raw.schema !== "string"
    || !ACCEPTED_EDITOR_SCHEMAS.has(raw.schema)
  ) {
    return null;
  }
  const migratingLegacyProject = raw.schema === LEGACY_EDITOR_SCHEMA_V1;
  const clips = reflowClips(Array.isArray(raw.clips) ? raw.clips : []);
  const rawProjectId = (
    typeof raw.id === "string"
    || (typeof raw.id === "number" && Number.isFinite(raw.id))
  )
    ? String(raw.id).trim()
    : "";
  const projectId = rawProjectId || makeId("project");
  const createdAt = typeof raw.createdAt === "string" && raw.createdAt.trim()
    ? raw.createdAt
    : nowIso();
  const defaults = createEditorProjectFromCapture({}, {
    id: projectId,
    createdAt
  });
  const clipIds = new Set(clips.map((clip) => clip.id));
  const clipSelectionIds = new Set(clips.map((clip) => clip.selectionId));
  const suppressedBySelectionId = new Map<string, SuppressedSelection>();
  (Array.isArray(raw.suppressedSelections) ? raw.suppressedSelections : [])
    .forEach((entry) => {
      const suppressed = normalizeSuppressedSelection(entry);
      if (suppressed && !clipSelectionIds.has(suppressed.selectionId)) {
        suppressedBySelectionId.set(suppressed.selectionId, suppressed);
      }
    });
  const suppressedSelections = [...suppressedBySelectionId.values()];
  const rawSubtitles = (Array.isArray(raw.subtitles) ? raw.subtitles : [])
    .filter((cue) => cue && clipIds.has(cue.clipId));
  const subtitleColor = normalizeHexColor(
    recordOrEmpty(raw.subtitleDefaults).color,
    String(defaults.subtitleDefaults.color || DEFAULT_SUBTITLE_COLOR)
  );
  const requestedLaneCount = clamp(
    Math.max(
      Math.round(finiteNumber(raw.subtitleLaneCount, MIN_SUBTITLE_LANES)),
      ...rawSubtitles.map((cue) => Math.round(finiteNumber(cue?.lane)) + 1),
      MIN_SUBTITLE_LANES
    ),
    MIN_SUBTITLE_LANES,
    MAX_SUBTITLE_LANES
  );
  const subtitles = rawSubtitles.map((cue) => normalizeSubtitleCue(
    {
      ...cue,
      color: cue.color ?? subtitleColor
    },
    clips.find((clip) => clip.id === cue.clipId)!,
    requestedLaneCount
  ));
  const subtitleLaneCount = clamp(
    Math.max(
      requestedLaneCount,
      ...subtitles.map((cue) => cue.lane + 1),
      MIN_SUBTITLE_LANES
    ),
    MIN_SUBTITLE_LANES,
    MAX_SUBTITLE_LANES
  );
  const audioRegions = (Array.isArray(raw.audioRegions) ? raw.audioRegions : [])
    .filter((region) => region && clipIds.has(region.clipId))
    .map((region) => normalizeAudioRegion(
      region,
      clips.find((clip) => clip.id === region.clipId)!
    ));
  const imageAssets = (Array.isArray(raw.imageAssets) ? raw.imageAssets : [])
    .filter((asset) => asset && clipIds.has(asset.clipId))
    .flatMap((asset) => {
      const normalized = normalizeImageAsset(
        asset,
        clips.find((clip) => clip.id === asset.clipId)
      );
      return normalized ? [normalized] : [];
    });
  const rawSubtitleDefaults = recordOrEmpty(raw.subtitleDefaults);
  const cleanDefaults = normalizedCaptionStyleDefaults(
    DEFAULT_CAPTION_STYLE_PRESET_ID
  );
  const hasKnownStylePreset = Object.hasOwn(
    CAPTION_STYLE_PRESETS,
    String(rawSubtitleDefaults.stylePresetId || "")
  );
  const appearsToUseMeasuredCleanStyle = (
    (!rawSubtitleDefaults.fontFamily || rawSubtitleDefaults.fontFamily === "Pretendard")
    && (!Number.isFinite(Number(rawSubtitleDefaults.fontScale))
      || Number(rawSubtitleDefaults.fontScale) === cleanDefaults.fontScale)
    && (!rawSubtitleDefaults.outlineColor
      || normalizeHexColor(rawSubtitleDefaults.outlineColor) === cleanDefaults.outlineColor)
    && (!Number.isFinite(Number(rawSubtitleDefaults.outlineWidth))
      || Number(rawSubtitleDefaults.outlineWidth) === cleanDefaults.outlineWidth)
    && (!rawSubtitleDefaults.backgroundColor
      || rawSubtitleDefaults.backgroundColor === "transparent")
  );
  const stylePresetId = hasKnownStylePreset
    ? normalizeCaptionStylePresetId(rawSubtitleDefaults.stylePresetId)
    : appearsToUseMeasuredCleanStyle
      ? DEFAULT_CAPTION_STYLE_PRESET_ID
      : LEGACY_CAPTION_STYLE_PRESET_ID;
  const selectedStyleDefaults = normalizedCaptionStyleDefaults(stylePresetId);
  const subtitleAlign: SubtitleDefaultsRecord["align"] = (
    rawSubtitleDefaults.align === "left"
    || rawSubtitleDefaults.align === "right"
  )
    ? rawSubtitleDefaults.align
    : "center";
  const subtitleDefaults: SubtitleDefaultsRecord = {
    ...selectedStyleDefaults,
    ...rawSubtitleDefaults,
    stylePresetId,
    fontId: selectedStyleDefaults.fontId,
    fontFamily: selectedStyleDefaults.fontFamily,
    fontWeight: 800,
    fontScale: clamp(
      finiteNumber(rawSubtitleDefaults.fontScale, selectedStyleDefaults.fontScale),
      0.025,
      0.12
    ),
    lineHeight: clamp(
      finiteNumber(rawSubtitleDefaults.lineHeight, selectedStyleDefaults.lineHeight),
      1,
      1.6
    ),
    maxLines: clamp(
      Math.round(finiteNumber(
        rawSubtitleDefaults.maxLines,
        selectedStyleDefaults.maxLines
      )),
      1,
      2
    ),
    maxWidth: clamp(
      finiteNumber(rawSubtitleDefaults.maxWidth, selectedStyleDefaults.maxWidth),
      0.4,
      0.95
    ),
    color: subtitleColor,
    outlineColor: normalizeHexColor(
      rawSubtitleDefaults.outlineColor,
      selectedStyleDefaults.outlineColor
    ),
    outlineWidth: clamp(
      finiteNumber(
        rawSubtitleDefaults.outlineWidth,
        selectedStyleDefaults.outlineWidth
      ),
      0,
      0.02
    ),
    backgroundColor: migratingLegacyProject
      ? "transparent"
      : String(
        rawSubtitleDefaults.backgroundColor
        || selectedStyleDefaults.backgroundColor
      ),
    backgroundRadiusEm: clamp(
      finiteNumber(
        rawSubtitleDefaults.backgroundRadiusEm,
        selectedStyleDefaults.backgroundRadiusEm
      ),
      0,
      1
    ),
    shadowColor: String(
      rawSubtitleDefaults.shadowColor || selectedStyleDefaults.shadowColor
    ),
    shadowOffsetXEm: clamp(
      finiteNumber(
        rawSubtitleDefaults.shadowOffsetXEm,
        selectedStyleDefaults.shadowOffsetXEm
      ),
      -1,
      1
    ),
    shadowOffsetYEm: clamp(
      finiteNumber(
        rawSubtitleDefaults.shadowOffsetYEm,
        selectedStyleDefaults.shadowOffsetYEm
      ),
      -1,
      1
    ),
    shadowBlurEm: clamp(
      finiteNumber(
        rawSubtitleDefaults.shadowBlurEm,
        selectedStyleDefaults.shadowBlurEm
      ),
      0,
      1
    ),
    x: clamp(
      finiteNumber(rawSubtitleDefaults.x, selectedStyleDefaults.x),
      0.05,
      0.95
    ),
    y: clamp(
      finiteNumber(rawSubtitleDefaults.y, selectedStyleDefaults.y),
      0.05,
      0.95
    ),
    align: subtitleAlign
  };
  const rawAi = recordOrEmpty(raw.ai);
  const legacyBrowserWhisperMetadata = rawAi.provider === "transformers.js";
  const {
    resolvedModel: rawResolvedModel,
    ...rawAiExtensions
  } = rawAi;
  const ai: AiStateRecord = {
    ...defaults.ai,
    ...rawAiExtensions,
    ...(legacyBrowserWhisperMetadata
      ? {
        provider: defaults.ai.provider,
        model: defaults.ai.model,
        status: "idle",
        progress: 0,
        error: null
      }
      : {}),
    provider: String(
      legacyBrowserWhisperMetadata
        ? defaults.ai.provider
        : rawAi.provider || defaults.ai.provider
    ),
    model: String(
      legacyBrowserWhisperMetadata
        ? defaults.ai.model
        : rawAi.model || defaults.ai.model
    ),
    status: String(
      legacyBrowserWhisperMetadata
        ? "idle"
        : rawAi.status || defaults.ai.status
    ),
    progress: clamp(
      finiteNumber(
        legacyBrowserWhisperMetadata ? 0 : rawAi.progress,
        defaults.ai.progress
      ),
      0,
      1
    ),
    warnings: normalizeAiWarnings(rawAi.warnings),
    speakerColors: normalizeAiSpeakerColors(rawAi.speakerColors),
    captionCheckpoints: normalizeAiCaptionCheckpoints(
      rawAi.captionCheckpoints,
      clips
    ),
    ...(typeof rawResolvedModel === "string" && rawResolvedModel.trim()
      ? { resolvedModel: rawResolvedModel }
      : {})
  };
  const rawHistory = recordOrEmpty(raw.history) as HistoryRecord;
  const rawSource = recordOrEmpty(raw.source) as SourceRecord;
  const rawBroadcastSession = recordOrEmpty(
    raw.broadcastSession
  ) as BroadcastSessionRecord;

  const selectedClipId = (
    typeof raw.selectedClipId === "string"
    && clipIds.has(raw.selectedClipId)
  )
    ? raw.selectedClipId
    : null;
  const selectedCueId = (
    typeof raw.selectedCueId === "string"
    && subtitles.some((cue) => cue.id === raw.selectedCueId)
  )
    ? raw.selectedCueId
    : null;
  const shortFormContext = {
    clips,
    subtitles,
    imageAssets,
    audioRegions,
    subtitleLaneCount,
    recentSubtitleColors: normalizeRecentSubtitleColors(raw.recentSubtitleColors),
    subtitleDefaults,
    ai
  };
  let shortFormWorkspaces = normalizeShortFormWorkspaceCollection(
    raw.shortFormWorkspaces,
    raw.shortForm,
    shortFormContext
  );
  const normalizedMirror = normalizeShortFormBranch(
    raw.shortForm,
    shortFormContext
  );
  const storedActiveShortForm = activeShortFormWorkspace(
    shortFormWorkspaces,
    raw.shortForm,
    shortFormContext
  ).shortForm;
  // Typed pre-envelope callers historically replaced only `shortForm`.
  // Accept that compatibility write only when its monotonic branch revision
  // is newer; otherwise the named-workspace collection is authoritative.
  if (normalizedMirror.revision > storedActiveShortForm.revision) {
    shortFormWorkspaces = saveActiveShortFormWorkspace(
      shortFormWorkspaces,
      storedActiveShortForm,
      normalizedMirror,
      shortFormContext
    );
  }
  const shortForm = activeShortFormWorkspace(
    shortFormWorkspaces,
    normalizedMirror,
    shortFormContext
  ).shortForm;
  const normalizedProject: EditorProject = {
    ...defaults,
    schema: EDITOR_SCHEMA,
    id: projectId,
    name: typeof raw.name === "string" && raw.name.trim()
      ? raw.name
      : defaults.name,
    source: sourceWithValidatedClockIdentity({
      ...defaults.source,
      ...rawSource
    }),
    broadcastSession: {
      ...defaults.broadcastSession,
      ...rawBroadcastSession,
      id: typeof rawBroadcastSession.id === "string"
        ? rawBroadcastSession.id
        : String(defaults.broadcastSession.id || "")
    },
    mediaAsset: normalizeMediaAsset(raw.mediaAsset),
    subtitleDefaults,
    ai,
    history: {
      undo: Array.isArray(rawHistory.undo) ? rawHistory.undo : [],
      redo: Array.isArray(rawHistory.redo) ? rawHistory.redo : []
    },
    clips,
    suppressedSelections,
    subtitles,
    subtitleLaneCount,
    recentSubtitleColors: normalizeRecentSubtitleColors(raw.recentSubtitleColors),
    audioRegions,
    imageAssets,
    shortForm,
    shortFormWorkspaces,
    selectedClipId,
    selectedImageAssetId: imageAssets.some((asset) => asset.id === raw.selectedImageAssetId)
      && typeof raw.selectedImageAssetId === "string"
      ? raw.selectedImageAssetId
      : null,
    selectedCueId,
    selectedAudioRegionId: audioRegions.some((region) => region.id === raw.selectedAudioRegionId)
      && typeof raw.selectedAudioRegionId === "string"
      ? raw.selectedAudioRegionId
      : null,
    playheadMs: clamp(
      Math.round(finiteNumber(raw.playheadMs, defaults.playheadMs)),
      0,
      projectDurationMs({ clips })
    ),
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt
      : createdAt
  };
  return { ...raw, ...normalizedProject };
}

export function applyCaptionStylePreset(
  project: EditorProject | null | undefined,
  presetId: unknown
): EditorProject | null | undefined {
  if (!project || typeof project !== "object") {
    return project;
  }
  const normalizedPresetId = normalizeCaptionStylePresetId(presetId);
  return {
    ...project,
    subtitleDefaults: {
      ...(project.subtitleDefaults || {}),
      ...normalizedCaptionStyleDefaults(normalizedPresetId)
    },
    updatedAt: nowIso()
  };
}

export function captionBackgroundEnabled(
  defaults: Pick<SubtitleDefaultsRecord, "backgroundColor"> | null | undefined
): boolean {
  const backgroundColor = String(defaults?.backgroundColor || "").trim();
  return Boolean(
    backgroundColor
    && backgroundColor.toLowerCase() !== "transparent"
    && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/iu.test(backgroundColor)
  );
}

export interface ResolvedSubtitleCueBackground {
  enabled: boolean;
  color: string;
  radiusEm: number;
}

export function resolveSubtitleCueBackground(
  defaults: Pick<
    SubtitleDefaultsRecord,
    "backgroundColor" | "backgroundRadiusEm"
  > | null | undefined,
  cue: Pick<EditorSubtitleCue, "backgroundEnabled"> | null | undefined
): ResolvedSubtitleCueBackground {
  if (cue?.backgroundEnabled === true) {
    return {
      enabled: true,
      color: "#000000",
      radiusEm: 0
    };
  }
  if (cue?.backgroundEnabled === false) {
    return {
      enabled: false,
      color: "transparent",
      radiusEm: 0
    };
  }
  const color = String(defaults?.backgroundColor || "transparent").trim()
    || "transparent";
  const rawRadiusEm = Number(defaults?.backgroundRadiusEm);
  return {
    enabled: captionBackgroundEnabled(defaults),
    color,
    radiusEm: Number.isFinite(rawRadiusEm)
      ? Math.max(0, rawRadiusEm)
      : 0.14
  };
}

export function setCaptionBackgroundEnabled(
  project: EditorProject,
  enabled: boolean
): EditorProject {
  const currentPresetId = normalizeCaptionStylePresetId(
    project.subtitleDefaults.stylePresetId
  );
  const nextPresetId = enabled && currentPresetId === DEFAULT_CAPTION_STYLE_PRESET_ID
    ? BLACK_BOX_CAPTION_STYLE_PRESET_ID
    : !enabled && currentPresetId === BLACK_BOX_CAPTION_STYLE_PRESET_ID
      ? DEFAULT_CAPTION_STYLE_PRESET_ID
      : currentPresetId;
  const blackBoxDefaults = normalizedCaptionStyleDefaults(
    BLACK_BOX_CAPTION_STYLE_PRESET_ID
  );
  return {
    ...project,
    subtitleDefaults: {
      ...project.subtitleDefaults,
      stylePresetId: nextPresetId,
      backgroundColor: enabled
        ? blackBoxDefaults.backgroundColor
        : "transparent",
      backgroundRadiusEm: enabled
        ? blackBoxDefaults.backgroundRadiusEm
        : project.subtitleDefaults.backgroundRadiusEm
    },
    updatedAt: nowIso()
  };
}

export function mergeCaptureIntoEditorProject(
  project: EditorProject | null | undefined,
  captureState: CaptureState = {}
): EditorProject {
  const normalized = normalizeEditorProject(project) || createEditorProjectFromCapture(captureState);
  const alignmentOffsetMs = Math.round(finiteNumber(normalized.broadcastSession?.alignmentOffsetMs));
  const capturedIncomingClips = (captureState.segments || []).map(segmentToClip);
  const capturedIncomingBySelection = new Map(
    capturedIncomingClips.map((clip) => [clip.selectionId, clip])
  );
  const suppressedSelections = (normalized.suppressedSelections || []).filter((suppressed) => {
    const incoming = capturedIncomingBySelection.get(suppressed.selectionId);
    return Boolean(
      incoming &&
      incoming.selectionStartMs === suppressed.selectionStartMs &&
      incoming.selectionEndMs === suppressed.selectionEndMs
    );
  });
  const suppressedSelectionIds = new Set(
    suppressedSelections.map((suppressed) => suppressed.selectionId)
  );
  const incomingClips = capturedIncomingClips
    .filter((clip) => !suppressedSelectionIds.has(clip.selectionId))
    .map((clip) => {
      const sourceStartMs = clip.selectionStartMs + alignmentOffsetMs;
      const sourceEndMs = clip.selectionEndMs + alignmentOffsetMs;
      if (sourceStartMs < 0 || sourceEndMs <= sourceStartMs) {
        throw new Error(
          `‘${clip.note || clip.selectionId}’ 선택 구간은 현재 정렬값에서 로컬 원본 시작보다 앞에 있습니다. 정렬값이나 선택 구간을 확인해 주세요.`
        );
      }
      return {
        ...clip,
        sourceStartMs,
        sourceEndMs
      };
    });
  const incomingBySelection = new Map(incomingClips.map((clip) => [clip.selectionId, clip]));
  const existingSelectionIds = new Set(normalized.clips.map((clip) => clip.selectionId));
  const existingBySelection = new Map<string, EditorClip[]>();
  normalized.clips.forEach((clip) => {
    const group = existingBySelection.get(clip.selectionId) || [];
    group.push(clip);
    existingBySelection.set(clip.selectionId, group);
  });
  const retainedByClipId = new Map<string, EditorClip>();
  const replacementBySelection = new Map<string, EditorClip>();
  existingBySelection.forEach((existingGroup, selectionId) => {
    const incoming = incomingBySelection.get(selectionId);
    if (!incoming) {
      return;
    }
    const capturedBoundaryUnchanged = existingGroup.every((existing) => {
      const previousSelectionStartMs = Math.round(finiteNumber(
        existing.selectionStartMs,
        existing.sourceStartMs - alignmentOffsetMs
      ));
      const previousSelectionEndMs = Math.round(finiteNumber(
        existing.selectionEndMs,
        existing.sourceEndMs - alignmentOffsetMs
      ));
      return (
        previousSelectionStartMs === incoming.selectionStartMs &&
        previousSelectionEndMs === incoming.selectionEndMs
      );
    });
    const retainedGroup = existingGroup.flatMap((existing) => {
      const previousSelectionStartMs = Math.round(finiteNumber(
        existing.selectionStartMs,
        existing.sourceStartMs - alignmentOffsetMs
      ));
      const previousSelectionEndMs = Math.round(finiteNumber(
        existing.selectionEndMs,
        existing.sourceEndMs - alignmentOffsetMs
      ));
      const stillAtCapturedBoundary = (
        existing.sourceStartMs === previousSelectionStartMs + alignmentOffsetMs &&
        existing.sourceEndMs === previousSelectionEndMs + alignmentOffsetMs
      );
      const overlapStartMs = Math.max(existing.sourceStartMs, incoming.sourceStartMs);
      const overlapEndMs = Math.min(existing.sourceEndMs, incoming.sourceEndMs);
      const canPreserveTrim = (
        overlapEndMs - overlapStartMs >= MIN_CLIP_DURATION_MS &&
        (existingGroup.length > 1 || !stillAtCapturedBoundary)
      );
      if (!capturedBoundaryUnchanged && !canPreserveTrim) {
        return [];
      }
      const { note: _previousNote, ...existingWithoutNote } = existing;
      return [{
        ...incoming,
        ...existingWithoutNote,
        sourceStartMs: capturedBoundaryUnchanged
          ? existing.sourceStartMs
          : overlapStartMs,
        sourceEndMs: capturedBoundaryUnchanged
          ? existing.sourceEndMs
          : overlapEndMs,
        selectionStartMs: incoming.selectionStartMs,
        selectionEndMs: incoming.selectionEndMs,
        capture: incoming.capture,
        updatedAt: nowIso()
      }];
    });
    if (retainedGroup.length > 0) {
      retainedGroup.forEach((clip) => retainedByClipId.set(clip.id, clip));
      return;
    }
    const [firstExisting] = existingGroup;
    const {
      note: _previousNote,
      ...firstExistingWithoutNote
    } = firstExisting || {};
    replacementBySelection.set(selectionId, {
      ...incoming,
      ...firstExistingWithoutNote,
      sourceStartMs: incoming.sourceStartMs,
      sourceEndMs: incoming.sourceEndMs,
      selectionStartMs: incoming.selectionStartMs,
      selectionEndMs: incoming.selectionEndMs,
      capture: incoming.capture,
      updatedAt: nowIso()
    });
  });
  const emittedReplacements = new Set();
  const retainedClips = normalized.clips.flatMap((existing) => {
    const incoming = incomingBySelection.get(existing.selectionId);
    if (!incoming) {
      return [];
    }
    const retained = retainedByClipId.get(existing.id);
    if (retained) {
      return [retained];
    }
    const replacement = replacementBySelection.get(existing.selectionId);
    if (!replacement || emittedReplacements.has(existing.selectionId)) {
      return [];
    }
    emittedReplacements.add(existing.selectionId);
    return [replacement];
  });
  const nextClips = [
    ...retainedClips,
    ...incomingClips.filter((clip) => !existingSelectionIds.has(clip.selectionId))
  ];
  const nextClipIds = new Set(nextClips.map((clip) => clip.id));
  const reflowedClips = reflowClips(nextClips);
  const previousClipsById = new Map(normalized.clips.map((clip) => [clip.id, clip]));
  const nextClipsById = new Map(reflowedClips.map((clip) => [clip.id, clip]));
  const subtitles = normalized.subtitles.flatMap((cue) => {
    const previousClip = previousClipsById.get(cue.clipId);
    const nextClip = nextClipsById.get(cue.clipId);
    if (!previousClip || !nextClip) {
      return [];
    }
    const cueSourceStartMs = previousClip.sourceStartMs + cue.startOffsetMs;
    const cueSourceEndMs = previousClip.sourceStartMs + cue.endOffsetMs;
    const overlapStartMs = Math.max(nextClip.sourceStartMs, cueSourceStartMs);
    const overlapEndMs = Math.min(nextClip.sourceEndMs, cueSourceEndMs);
    if (overlapEndMs - overlapStartMs < MIN_CUE_DURATION_MS) {
      return [];
    }
    return [normalizeSubtitleCue({
      ...cue,
      startOffsetMs: overlapStartMs - nextClip.sourceStartMs,
      endOffsetMs: overlapEndMs - nextClip.sourceStartMs
    }, nextClip, normalized.subtitleLaneCount)];
  });
  const audioRegions = normalized.audioRegions.flatMap((region) => {
    const previousClip = previousClipsById.get(region.clipId);
    const nextClip = nextClipsById.get(region.clipId);
    if (!previousClip || !nextClip) {
      return [];
    }
    const regionSourceStartMs = previousClip.sourceStartMs + region.startOffsetMs;
    const regionSourceEndMs = previousClip.sourceStartMs + region.endOffsetMs;
    const overlapStartMs = Math.max(nextClip.sourceStartMs, regionSourceStartMs);
    const overlapEndMs = Math.min(nextClip.sourceEndMs, regionSourceEndMs);
    if (overlapEndMs - overlapStartMs < MIN_CUE_DURATION_MS) {
      return [];
    }
    return [normalizeAudioRegion({
      ...region,
      startOffsetMs: overlapStartMs - nextClip.sourceStartMs,
      endOffsetMs: overlapEndMs - nextClip.sourceStartMs
    }, nextClip)];
  });
  const imageAssets = normalized.imageAssets.flatMap((asset) => {
    const previousClip = previousClipsById.get(asset.clipId);
    const nextClip = nextClipsById.get(asset.clipId);
    if (!previousClip || !nextClip) {
      return [];
    }
    const assetSourceStartMs = previousClip.sourceStartMs + asset.startOffsetMs;
    const assetSourceEndMs = previousClip.sourceStartMs + asset.endOffsetMs;
    const overlapStartMs = Math.max(nextClip.sourceStartMs, assetSourceStartMs);
    const overlapEndMs = Math.min(nextClip.sourceEndMs, assetSourceEndMs);
    if (overlapEndMs - overlapStartMs < MIN_CUE_DURATION_MS) {
      return [];
    }
    const next = normalizeImageAsset({
      ...asset,
      startOffsetMs: overlapStartMs - nextClip.sourceStartMs,
      endOffsetMs: overlapEndMs - nextClip.sourceStartMs
    }, nextClip);
    return next ? [next] : [];
  });
  const source = sourceWithValidatedClockIdentity({
    ...normalized.source,
    ...(captureState.source || {})
  });
  const incomingSession = createBroadcastSession(source);
  const previouslySelectedClip = normalized.clips.find((clip) => (
    clip.id === normalized.selectedClipId
  ));
  const nextSelectedClipId = (
    typeof normalized.selectedClipId === "string"
    && nextClipIds.has(normalized.selectedClipId)
  )
    ? normalized.selectedClipId
    : nextClips.find((clip) => (
      clip.selectionId === previouslySelectedClip?.selectionId
    ))?.id || nextClips[0]?.id || null;
  const shortFormContext = {
    clips: reflowedClips,
    subtitles,
    imageAssets,
    audioRegions,
    subtitleLaneCount: normalized.subtitleLaneCount,
    recentSubtitleColors: normalized.recentSubtitleColors,
    subtitleDefaults: normalized.subtitleDefaults,
    ai: normalized.ai
  };
  const shortForm = normalizeShortFormBranch(
    normalized.shortForm,
    shortFormContext
  );
  const shortFormWorkspaces = saveActiveShortFormWorkspace(
    normalized.shortFormWorkspaces,
    normalized.shortForm,
    shortForm,
    shortFormContext
  );

  return {
    ...normalized,
    name: String(captureState.projectName || normalized.name),
    source,
    broadcastSession: {
      ...normalized.broadcastSession,
      ...incomingSession,
      liveUrl: incomingSession.liveUrl || normalized.broadcastSession?.liveUrl || "",
      vodUrl: incomingSession.vodUrl || normalized.broadcastSession?.vodUrl || "",
      vodContentId: incomingSession.vodContentId || normalized.broadcastSession?.vodContentId || "",
      alignmentOffsetMs: normalized.broadcastSession?.alignmentOffsetMs || 0,
      alignmentConfirmed: (
        normalized.broadcastSession?.alignmentConfirmed
        || source.contentType === "vod"
      )
    },
    clips: reflowedClips,
    shortForm,
    shortFormWorkspaces,
    suppressedSelections,
    subtitles,
    audioRegions,
    imageAssets,
    selectedClipId: nextSelectedClipId,
    selectedCueId: subtitles.some((cue) => cue.id === normalized.selectedCueId)
      ? normalized.selectedCueId ?? null
      : null,
    selectedImageAssetId: imageAssets.some((asset) => (
      asset.id === normalized.selectedImageAssetId
    ))
      ? normalized.selectedImageAssetId ?? null
      : null,
    selectedAudioRegionId: audioRegions.some((region) => (
      region.id === normalized.selectedAudioRegionId
    ))
      ? normalized.selectedAudioRegionId ?? null
      : null,
    updatedAt: nowIso()
  };
}

export function projectDurationMs(
  project: Pick<EditorProject, "clips"> | null | undefined
): number {
  return (project?.clips || []).reduce((total, clip) => (
    clip.enabled === false ? total : total + Math.max(0, clip.sourceEndMs - clip.sourceStartMs)
  ), 0);
}

export function clipDurationMs(clip: EditorClip | null | undefined): number {
  return Math.max(0, finiteNumber(clip?.sourceEndMs) - finiteNumber(clip?.sourceStartMs));
}

export function mapTimelineToSource(
  project: EditorProject | null | undefined,
  timelineMs: unknown
): TimelineSourcePosition | null {
  const enabled = (project?.clips || []).filter((clip) => clip.enabled !== false);
  if (enabled.length === 0) {
    return null;
  }
  const duration = projectDurationMs(project);
  const target = clamp(Math.round(finiteNumber(timelineMs)), 0, Math.max(0, duration));
  const clip = enabled.find((candidate, index) => {
    const end = candidate.timelineStartMs + clipDurationMs(candidate);
    return target < end || (index === enabled.length - 1 && target === end);
  }) || enabled.at(-1)!;
  const offsetMs = clamp(target - clip.timelineStartMs, 0, clipDurationMs(clip));
  return {
    clipId: clip.id,
    timelineMs: target,
    clipOffsetMs: offsetMs,
    sourceMs: clip.sourceStartMs + offsetMs
  };
}

export function mapSourceToTimeline(
  project: EditorProject | null | undefined,
  clipId: unknown,
  sourceMs: unknown
): number | null {
  const clip = project?.clips?.find((candidate) => candidate.id === clipId && candidate.enabled !== false);
  if (!clip) {
    return null;
  }
  const boundedSourceMs = clamp(
    Math.round(finiteNumber(sourceMs)),
    clip.sourceStartMs,
    clip.sourceEndMs
  );
  return clip.timelineStartMs + boundedSourceMs - clip.sourceStartMs;
}

function normalizeSubtitleCue(
  cue: DynamicRecord,
  clip: EditorClip,
  laneCount = MAX_SUBTITLE_LANES
): EditorSubtitleCue {
  const duration = Math.max(MIN_CUE_DURATION_MS, clipDurationMs(clip));
  const startOffsetMs = clamp(Math.round(finiteNumber(cue.startOffsetMs)), 0, Math.max(0, duration - MIN_CUE_DURATION_MS));
  const endOffsetMs = clamp(
    Math.round(finiteNumber(cue.endOffsetMs, startOffsetMs + 1500)),
    startOffsetMs + MIN_CUE_DURATION_MS,
    duration
  );
  const rawRemoteMeta = recordOrEmpty(cue.remoteMeta);
  const remotePlacement = String(rawRemoteMeta.placement || "")
    .trim()
    .toLowerCase();
  const origin = cue.origin === "ai" ? "ai" : "human";
  const humanEdited = Boolean(cue.humanEdited);
  const automaticAiCue = origin === "ai" && !humanEdited;
  const cueFontScale = cue.fontScale != null
    && cue.fontScale !== ""
    && Number.isFinite(Number(cue.fontScale))
    ? clamp(Number(cue.fontScale), 0.025, 0.12)
    : null;
  const remoteMeta = cue.remoteMeta && typeof cue.remoteMeta === "object"
    ? {
      speakerId: String(rawRemoteMeta.speakerId || "unknown")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 80) || "unknown",
      reviewRequired: Boolean(rawRemoteMeta.reviewRequired),
      placement: automaticAiCue
        ? AUTOMATIC_CAPTION_POSITION.placement
        : ["top", "center", "bottom"].includes(remotePlacement)
          ? remotePlacement
          : AUTOMATIC_CAPTION_POSITION.placement,
      ...(rawRemoteMeta.qualityStatus != null
        || Array.isArray(rawRemoteMeta.qualityCodes)
        ? {
          qualityStatus: rawRemoteMeta.qualityStatus === "review-required"
            ? "review-required"
            : "accepted",
          qualityCodes: [...new Set(
            (Array.isArray(rawRemoteMeta.qualityCodes)
              ? rawRemoteMeta.qualityCodes
              : [])
              .map((code: unknown) => String(code || "").trim().slice(0, 128))
              .filter(Boolean)
          )].slice(0, 32)
        }
        : {})
    }
    : null;
  return {
    id: String(cue.id || makeId("cue")),
    clipId: clip.id,
    startOffsetMs,
    endOffsetMs,
    text: String(cue.text || "").trim(),
    lane: clamp(
      Math.round(finiteNumber(cue.lane)),
      0,
      Math.max(0, Math.min(MAX_SUBTITLE_LANES, laneCount) - 1)
    ),
    color: normalizeHexColor(cue.color, "#ffffff"),
    ...(cueFontScale != null ? { fontScale: cueFontScale } : {}),
    ...(typeof cue.backgroundEnabled === "boolean"
      ? { backgroundEnabled: cue.backgroundEnabled }
      : {}),
    x: automaticAiCue
      ? AUTOMATIC_CAPTION_POSITION.x
      : clamp(finiteNumber(cue.x, AUTOMATIC_CAPTION_POSITION.x), 0.05, 0.95),
    y: automaticAiCue
      ? AUTOMATIC_CAPTION_POSITION.y
      : clamp(finiteNumber(cue.y, AUTOMATIC_CAPTION_POSITION.y), 0.05, 0.95),
    origin,
    humanEdited,
    confidence: typeof cue.confidence === "number"
      && Number.isFinite(cue.confidence)
      ? cue.confidence
      : null,
    ...(remoteMeta ? { remoteMeta } : {}),
    createdAt: cue.createdAt || nowIso(),
    updatedAt: cue.updatedAt || cue.createdAt || nowIso()
  };
}

export function resetAiSubtitlePositions(project: EditorProject, {
  includeHumanEdited = false,
  updatedAt = nowIso()
}: { includeHumanEdited?: boolean; updatedAt?: string } = {}): EditorProject {
  if (!project || !Array.isArray(project.subtitles)) {
    return project;
  }
  let changed = false;
  const subtitles = project.subtitles.map((cue) => {
    if (
      cue?.origin !== "ai"
      || (cue.humanEdited && !includeHumanEdited)
    ) {
      return cue;
    }
    const remoteMeta = cue.remoteMeta && typeof cue.remoteMeta === "object"
      ? {
        ...cue.remoteMeta,
        placement: AUTOMATIC_CAPTION_POSITION.placement
      }
      : cue.remoteMeta;
    if (
      cue.x === AUTOMATIC_CAPTION_POSITION.x
      && cue.y === AUTOMATIC_CAPTION_POSITION.y
      && (
        !remoteMeta
        || remoteMeta.placement === cue.remoteMeta?.placement
      )
    ) {
      return cue;
    }
    changed = true;
    return {
      ...cue,
      x: AUTOMATIC_CAPTION_POSITION.x,
      y: AUTOMATIC_CAPTION_POSITION.y,
      ...(remoteMeta ? { remoteMeta } : {}),
      updatedAt
    };
  });
  return changed
    ? {
      ...project,
      subtitles,
      updatedAt
    }
    : project;
}

export function createSubtitleCue(project: EditorProject, {
  id,
  clipId,
  startOffsetMs = 0,
  endOffsetMs = 2000,
  text = "",
  lane = 0,
  color,
  fontScale,
  backgroundEnabled,
  x,
  y,
  origin = "human",
  confidence = null,
  remoteMeta = null,
  createdAt = nowIso()
}: SubtitleCueDraftInput = {}): EditorSubtitleCue {
  const clip = project?.clips?.find((candidate) => candidate.id === clipId) || project?.clips?.[0];
  if (!clip) {
    throw new Error("자막을 추가할 영상 구간이 없습니다.");
  }
  return normalizeSubtitleCue({
    id,
    clipId: clip.id,
    startOffsetMs,
    endOffsetMs,
    text,
    lane,
    color: color ?? project.subtitleDefaults?.color,
    fontScale,
    backgroundEnabled,
    x: x ?? AUTOMATIC_CAPTION_POSITION.x,
    y: y ?? AUTOMATIC_CAPTION_POSITION.y,
    origin,
    confidence,
    remoteMeta,
    createdAt,
    updatedAt: createdAt
  }, clip, project.subtitleLaneCount ?? MIN_SUBTITLE_LANES);
}

export function normalizeImageAsset(
  asset: DynamicRecord | null | undefined,
  clip: EditorClip | null | undefined
): EditorImageAsset | null {
  if (!asset || !clip) {
    return null;
  }
  const duration = Math.max(MIN_CUE_DURATION_MS, clipDurationMs(clip));
  const startOffsetMs = clamp(
    Math.round(finiteNumber(asset.startOffsetMs)),
    0,
    Math.max(0, duration - MIN_CUE_DURATION_MS)
  );
  const endOffsetMs = clamp(
    Math.round(finiteNumber(asset.endOffsetMs, startOffsetMs + 2000)),
    startOffsetMs + MIN_CUE_DURATION_MS,
    duration
  );
  const requestedSource = asset.source
    ?? (asset.dataUrl ? { kind: "data-url", value: asset.dataUrl } : null)
    ?? (asset.blobKey ? { kind: "blob-key", value: asset.blobKey } : null);
  const source = normalizeImageAssetSource(
    requestedSource,
    String(asset.mimeType || "")
  );
  const mimeType = source?.kind === "data-url"
    ? imageMimeTypeFromDataUrl(source.value)
    : normalizeImageMimeType(asset.mimeType);
  if (!source || !mimeType) {
    return null;
  }
  const naturalWidth = Math.round(finiteNumber(asset.naturalWidth));
  const naturalHeight = Math.round(finiteNumber(asset.naturalHeight));
  return {
    id: String(asset.id || makeId("asset")),
    clipId: clip.id,
    startOffsetMs,
    endOffsetMs,
    name: String(asset.name || "이미지 에셋").trim() || "이미지 에셋",
    mimeType,
    source,
    sourceUrl: String(asset.sourceUrl || "").trim(),
    x: clamp(finiteNumber(asset.x, 0.5), 0, 1),
    y: clamp(finiteNumber(asset.y, 0.5), 0, 1),
    scale: clamp(finiteNumber(asset.scale, 1), 0.05, 5),
    opacity: clamp(finiteNumber(asset.opacity, 1), 0, 1),
    naturalWidth: naturalWidth > 0 ? naturalWidth : null,
    naturalHeight: naturalHeight > 0 ? naturalHeight : null,
    createdAt: asset.createdAt || nowIso(),
    updatedAt: asset.updatedAt || asset.createdAt || nowIso()
  };
}

export function createImageAsset(project: EditorProject, {
  id,
  clipId,
  startOffsetMs = 0,
  endOffsetMs = 2000,
  name = "이미지 에셋",
  mimeType = "",
  source = null,
  dataUrl = "",
  blobKey = "",
  sourceUrl = "",
  x = 0.5,
  y = 0.5,
  scale = 1,
  opacity = 1,
  naturalWidth = null,
  naturalHeight = null,
  createdAt = nowIso()
}: DynamicRecord = {}): EditorImageAsset {
  const clip = project?.clips?.find((candidate) => candidate.id === clipId) || project?.clips?.[0];
  if (!clip) {
    throw new Error("에셋을 추가할 영상 구간이 없습니다.");
  }
  const normalized = normalizeImageAsset({
    id,
    clipId: clip.id,
    startOffsetMs,
    endOffsetMs,
    name,
    mimeType,
    source: source
      ?? (dataUrl ? { kind: "data-url", value: dataUrl } : null)
      ?? (blobKey ? { kind: "blob-key", value: blobKey } : null),
    sourceUrl,
    x,
    y,
    scale,
    opacity,
    naturalWidth,
    naturalHeight,
    createdAt,
    updatedAt: createdAt
  }, clip);
  if (!normalized) {
    throw new Error("PNG, JPEG, WebP 또는 GIF 이미지 데이터가 필요합니다.");
  }
  return normalized;
}

export function updateImageAsset(
  project: EditorProject,
  assetId: unknown,
  patch: DynamicRecord = {}
): EditorProject {
  const index = (project.imageAssets || []).findIndex((asset) => asset.id === assetId);
  if (index < 0) {
    return project;
  }
  const current = project.imageAssets[index];
  if (!current) {
    return project;
  }
  const clip = project.clips.find((candidate) => candidate.id === current.clipId);
  if (!clip) {
    throw new Error("이미지 에셋이 참조하는 영상 구간을 찾지 못했습니다.");
  }
  const next = normalizeImageAsset({
    ...current,
    ...patch,
    updatedAt: nowIso()
  }, clip);
  if (!next) {
    throw new Error("PNG, JPEG, WebP 또는 GIF 이미지 데이터가 필요합니다.");
  }
  const imageAssets = [...project.imageAssets];
  imageAssets[index] = next;
  return {
    ...project,
    imageAssets,
    selectedImageAssetId: next.id,
    updatedAt: nowIso()
  };
}

export function deleteImageAsset(
  project: EditorProject,
  assetId: unknown
): EditorProject {
  return {
    ...project,
    imageAssets: (project.imageAssets || []).filter((asset) => asset.id !== assetId),
    selectedImageAssetId: project.selectedImageAssetId === assetId
      ? null
      : project.selectedImageAssetId ?? null,
    updatedAt: nowIso()
  };
}

function normalizeAudioRegion(
  region: DynamicRecord,
  clip: EditorClip
): EditorAudioRegion {
  const duration = Math.max(MIN_CUE_DURATION_MS, clipDurationMs(clip));
  const startOffsetMs = clamp(
    Math.round(finiteNumber(region.startOffsetMs)),
    0,
    Math.max(0, duration - MIN_CUE_DURATION_MS)
  );
  const endOffsetMs = clamp(
    Math.round(finiteNumber(region.endOffsetMs, startOffsetMs + 2000)),
    startOffsetMs + MIN_CUE_DURATION_MS,
    duration
  );
  const maximumFadeMs = Math.max(0, endOffsetMs - startOffsetMs);
  return {
    id: String(region.id || makeId("audio")),
    clipId: clip.id,
    startOffsetMs,
    endOffsetMs,
    gain: clamp(finiteNumber(region.gain, 1), 0, 1),
    muted: Boolean(region.muted),
    fadeInMs: clamp(
      Math.round(finiteNumber(region.fadeInMs)),
      0,
      maximumFadeMs
    ),
    fadeOutMs: clamp(
      Math.round(finiteNumber(region.fadeOutMs)),
      0,
      maximumFadeMs
    ),
    createdAt: region.createdAt || nowIso(),
    updatedAt: region.updatedAt || region.createdAt || nowIso()
  };
}

export function createAudioRegion(project: EditorProject, {
  id,
  clipId,
  startOffsetMs = 0,
  endOffsetMs = 2000,
  gain = 1,
  muted = false,
  fadeInMs = 0,
  fadeOutMs = 0,
  createdAt = nowIso()
}: DynamicRecord = {}): EditorAudioRegion {
  const clip = project?.clips?.find((candidate) => candidate.id === clipId) || project?.clips?.[0];
  if (!clip) {
    throw new Error("음성을 조절할 영상 구간이 없습니다.");
  }
  return normalizeAudioRegion({
    id,
    clipId: clip.id,
    startOffsetMs,
    endOffsetMs,
    gain,
    muted,
    fadeInMs,
    fadeOutMs,
    createdAt,
    updatedAt: createdAt
  }, clip);
}

export function updateAudioRegion(
  project: EditorProject,
  regionId: unknown,
  patch: DynamicRecord = {}
): EditorProject {
  const index = project.audioRegions.findIndex((region) => region.id === regionId);
  if (index < 0) {
    return project;
  }
  const current = project.audioRegions[index];
  if (!current) {
    return project;
  }
  const clip = project.clips.find((candidate) => candidate.id === current.clipId);
  if (!clip) {
    throw new Error("음성 구간이 참조하는 영상 구간을 찾지 못했습니다.");
  }
  const next = normalizeAudioRegion({
    ...current,
    ...patch,
    updatedAt: nowIso()
  }, clip);
  const audioRegions = [...project.audioRegions];
  audioRegions[index] = next;
  return {
    ...project,
    audioRegions,
    selectedAudioRegionId: next.id,
    updatedAt: nowIso()
  };
}

export function deleteAudioRegion(
  project: EditorProject,
  regionId: unknown
): EditorProject {
  return {
    ...project,
    audioRegions: project.audioRegions.filter((region) => region.id !== regionId),
    selectedAudioRegionId: project.selectedAudioRegionId === regionId
      ? null
      : project.selectedAudioRegionId ?? null,
    updatedAt: nowIso()
  };
}

export function cueTimelineRange(
  project: EditorProject,
  cue: EditorSubtitleCue
): TimelineRange | null {
  const clip = project?.clips?.find((candidate) => candidate.id === cue?.clipId);
  if (!clip || clip.enabled === false) {
    return null;
  }
  return {
    startMs: clip.timelineStartMs + cue.startOffsetMs,
    endMs: clip.timelineStartMs + cue.endOffsetMs
  };
}

export function adjacentSubtitleCueInLane(
  project: EditorProject | null | undefined,
  cueId: unknown,
  direction: unknown
): EditorSubtitleCue | null {
  if (!project || (direction !== -1 && direction !== 1)) {
    return null;
  }
  const currentCue = project.subtitles.find((cue) => cue.id === cueId);
  if (!currentCue || !cueTimelineRange(project, currentCue)) {
    return null;
  }
  const ordered = project.subtitles
    .flatMap((cue) => {
      if (cue.lane !== currentCue.lane) {
        return [];
      }
      const range = cueTimelineRange(project, cue);
      return range ? [{ cue, range }] : [];
    })
    .sort((left, right) => (
      left.range.startMs - right.range.startMs
      || left.range.endMs - right.range.endMs
      || left.cue.id.localeCompare(right.cue.id)
    ));
  const currentIndex = ordered.findIndex(({ cue }) => cue.id === currentCue.id);
  if (currentIndex < 0) {
    return null;
  }
  return ordered[currentIndex + direction]?.cue || null;
}

export function imageAssetTimelineRange(
  project: EditorProject,
  asset: EditorImageAsset
): TimelineRange | null {
  const clip = project?.clips?.find((candidate) => candidate.id === asset?.clipId);
  if (!clip || clip.enabled === false) {
    return null;
  }
  return {
    startMs: clip.timelineStartMs + asset.startOffsetMs,
    endMs: clip.timelineStartMs + asset.endOffsetMs
  };
}

export function audioRegionTimelineRange(
  project: EditorProject,
  region: EditorAudioRegion
): TimelineRange | null {
  const clip = project?.clips?.find((candidate) => candidate.id === region?.clipId);
  if (!clip || clip.enabled === false) {
    return null;
  }
  return {
    startMs: clip.timelineStartMs + region.startOffsetMs,
    endMs: clip.timelineStartMs + region.endOffsetMs
  };
}

export function timelineSnapThresholdMs(pixelsPerSecond: unknown, {
  thresholdPx = 8,
  minimumMs = 25,
  maximumMs = 400
}: {
  thresholdPx?: number;
  minimumMs?: number;
  maximumMs?: number;
} = {}): number {
  const pixels = Math.max(1, finiteNumber(pixelsPerSecond, 70));
  const requested = Math.round(
    Math.max(0, finiteNumber(thresholdPx, 8)) / pixels * 1000
  );
  return clamp(
    requested,
    Math.max(0, Math.round(finiteNumber(minimumMs, 25))),
    Math.max(0, Math.round(finiteNumber(maximumMs, 400)))
  );
}

export function timelineSnapCandidates(project: EditorProject, {
  clipId,
  excludeCueId = null,
  excludeImageAssetId = null,
  preferredKind = null,
  includePlayhead = true
}: TimelineSnapOptions = {}): TimelineSnapCandidate[] {
  const clip = project?.clips?.find((candidate) => candidate.id === clipId);
  if (!clip || clip.enabled === false) {
    return [];
  }
  const clipStartMs = clip.timelineStartMs;
  const clipEndMs = clip.timelineStartMs + clipDurationMs(clip);
  const candidates: TimelineSnapCandidate[] = [];
  const priorityFor = (kind: string): number => {
    if (kind === preferredKind) {
      return 0;
    }
    if (kind === "subtitle" || kind === "asset") {
      return 1;
    }
    return kind === "playhead" ? 2 : 3;
  };
  const add = ({
    timeMs,
    kind,
    edge,
    itemId = null,
    label
  }: TimelineSnapInput): void => {
    const normalizedTimeMs = Math.round(finiteNumber(timeMs, -1));
    if (normalizedTimeMs < clipStartMs || normalizedTimeMs > clipEndMs) {
      return;
    }
    candidates.push({
      timeMs: normalizedTimeMs,
      kind: String(kind || ""),
      edge: String(edge || ""),
      itemId: itemId == null ? null : String(itemId),
      label: String(label || ""),
      priority: priorityFor(String(kind || ""))
    });
  };

  add({
    timeMs: clipStartMs,
    kind: "clip",
    edge: "start",
    itemId: clip.id,
    label: "컷 시작"
  });
  add({
    timeMs: clipEndMs,
    kind: "clip",
    edge: "end",
    itemId: clip.id,
    label: "컷 끝"
  });
  if (includePlayhead) {
    add({
      timeMs: project.playheadMs,
      kind: "playhead",
      edge: "point",
      label: "재생 헤드"
    });
  }
  for (const cue of project.subtitles || []) {
    if (cue.clipId !== clip.id || cue.id === excludeCueId) {
      continue;
    }
    const range = cueTimelineRange(project, cue);
    if (!range) {
      continue;
    }
    add({
      timeMs: range.startMs,
      kind: "subtitle",
      edge: "start",
      itemId: cue.id,
      label: "자막 시작"
    });
    add({
      timeMs: range.endMs,
      kind: "subtitle",
      edge: "end",
      itemId: cue.id,
      label: "자막 끝"
    });
  }
  for (const asset of project.imageAssets || []) {
    if (asset.clipId !== clip.id || asset.id === excludeImageAssetId) {
      continue;
    }
    const range = imageAssetTimelineRange(project, asset);
    if (!range) {
      continue;
    }
    add({
      timeMs: range.startMs,
      kind: "asset",
      edge: "start",
      itemId: asset.id,
      label: "에셋 시작"
    });
    add({
      timeMs: range.endMs,
      kind: "asset",
      edge: "end",
      itemId: asset.id,
      label: "에셋 끝"
    });
  }
  return candidates;
}

export function resolveTimelineSnap(
  rawTimelineMs: unknown,
  candidates: TimelineSnapCandidate[] | unknown,
  {
  thresholdMs = 0
  }: { thresholdMs?: number } = {}
): DynamicRecord | null {
  const targetMs = Math.round(finiteNumber(rawTimelineMs));
  const limitMs = Math.max(0, Math.round(finiteNumber(thresholdMs)));
  const matches = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => (
      candidate
      && Number.isFinite(Number(candidate.timeMs))
    ))
    .map((candidate) => ({
      ...candidate,
      timeMs: Math.round(Number(candidate.timeMs)),
      deltaMs: Math.round(Number(candidate.timeMs)) - targetMs,
      distanceMs: Math.abs(Math.round(Number(candidate.timeMs)) - targetMs),
      priority: Math.round(finiteNumber(candidate.priority, 100))
    }))
    .filter((candidate) => candidate.distanceMs <= limitMs)
    .sort((first, second) => (
      first.distanceMs - second.distanceMs
      || first.priority - second.priority
      || first.timeMs - second.timeMs
      || String(first.kind || "").localeCompare(String(second.kind || ""))
      || String(first.itemId || "").localeCompare(String(second.itemId || ""))
      || String(first.edge || "").localeCompare(String(second.edge || ""))
    ));
  return matches[0] || null;
}

export function matchSubtitleCueToImageAsset(
  project: EditorProject,
  cueId: unknown,
  assetId: unknown
): EditorProject {
  const cue = project?.subtitles?.find((candidate) => candidate.id === cueId);
  const asset = project?.imageAssets?.find((candidate) => candidate.id === assetId);
  if (!cue || !asset || cue.clipId !== asset.clipId) {
    return project;
  }
  return updateSubtitleCue(project, cue.id, {
    startOffsetMs: asset.startOffsetMs,
    endOffsetMs: asset.endOffsetMs
  });
}

export function matchImageAssetToSubtitleCue(
  project: EditorProject,
  assetId: unknown,
  cueId: unknown
): EditorProject {
  const asset = project?.imageAssets?.find((candidate) => candidate.id === assetId);
  const cue = project?.subtitles?.find((candidate) => candidate.id === cueId);
  if (!asset || !cue || asset.clipId !== cue.clipId) {
    return project;
  }
  return updateImageAsset(project, asset.id, {
    startOffsetMs: cue.startOffsetMs,
    endOffsetMs: cue.endOffsetMs
  });
}

export function cueAtTimeline(
  project: EditorProject,
  timelineMs: unknown
): EditorSubtitleCue | null {
  return cuesAtTimeline(project, timelineMs)[0] || null;
}

export function cuesAtTimeline(
  project: EditorProject,
  timelineMs: unknown
): EditorSubtitleCue[] {
  const target = Math.round(finiteNumber(timelineMs));
  return (project?.subtitles || [])
    .map((cue) => ({ cue, range: cueTimelineRange(project, cue) }))
    .filter(hasTimelineRange)
    .filter(({ range }) => target >= range.startMs && target < range.endMs)
    .sort((a, b) => (
      a.cue.lane - b.cue.lane ||
      a.range.startMs - b.range.startMs ||
      a.cue.id.localeCompare(b.cue.id)
    ))
    .map(({ cue }) => cue);
}

export function imageAssetsAtTimeline(
  project: EditorProject,
  timelineMs: unknown
): EditorImageAsset[] {
  const target = Math.round(finiteNumber(timelineMs));
  // Array order is the stable z-order: earlier assets are behind later assets.
  return (project?.imageAssets || []).filter((asset) => {
    const range = imageAssetTimelineRange(project, asset);
    return range && target >= range.startMs && target < range.endMs;
  });
}

export function findImageAssetOverlaps(project: EditorProject): DynamicRecord[] {
  const assets = (project?.imageAssets || [])
    .map((asset, order) => ({
      asset,
      order,
      range: imageAssetTimelineRange(project, asset)
    }))
    .filter(hasTimelineRange)
    .sort((a, b) => a.range.startMs - b.range.startMs || a.order - b.order);
  const overlaps: DynamicRecord[] = [];
  for (let leftIndex = 0; leftIndex < assets.length; leftIndex += 1) {
    const left = assets[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < assets.length; rightIndex += 1) {
      const right = assets[rightIndex];
      if (!right) {
        continue;
      }
      if (right.range.startMs >= left.range.endMs) {
        break;
      }
      if (right.range.endMs > left.range.startMs) {
        overlaps.push({
          firstAssetId: left.asset.id,
          secondAssetId: right.asset.id,
          startMs: Math.max(left.range.startMs, right.range.startMs),
          endMs: Math.min(left.range.endMs, right.range.endMs)
        });
      }
    }
  }
  return overlaps;
}

export function findSubtitleOverlaps(project: EditorProject): DynamicRecord[] {
  const cues = (project?.subtitles || [])
    .map((cue) => ({ cue, range: cueTimelineRange(project, cue) }))
    .filter(hasTimelineRange)
    .sort((a, b) => a.range.startMs - b.range.startMs);
  const overlaps: DynamicRecord[] = [];
  for (let leftIndex = 0; leftIndex < cues.length; leftIndex += 1) {
    const left = cues[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < cues.length; rightIndex += 1) {
      const right = cues[rightIndex];
      if (!right) {
        continue;
      }
      if (right.range.startMs >= left.range.endMs) {
        break;
      }
      if (
        right.cue.lane === left.cue.lane &&
        right.range.endMs > left.range.startMs
      ) {
        overlaps.push({
          firstCueId: left.cue.id,
          secondCueId: right.cue.id,
          startMs: Math.max(left.range.startMs, right.range.startMs),
          endMs: Math.min(left.range.endMs, right.range.endMs)
        });
      }
    }
  }
  return overlaps;
}

export function audioRegionAtTimeline(
  project: EditorProject,
  timelineMs: unknown
): EditorAudioRegion | null {
  const target = Math.round(finiteNumber(timelineMs));
  return (project?.audioRegions || [])
    .map((region) => ({ region, range: audioRegionTimelineRange(project, region) }))
    .find(({ range }) => range && target >= range.startMs && target < range.endMs)
    ?.region || null;
}

export function findAudioRegionOverlaps(project: EditorProject): DynamicRecord[] {
  const regions = (project?.audioRegions || [])
    .map((region) => ({ region, range: audioRegionTimelineRange(project, region) }))
    .filter(hasTimelineRange)
    .sort((a, b) => a.range.startMs - b.range.startMs);
  const overlaps: DynamicRecord[] = [];
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex];
      if (!right) {
        continue;
      }
      if (right.range.startMs >= left.range.endMs) {
        break;
      }
      if (
        right.region.clipId === left.region.clipId &&
        right.range.endMs > left.range.startMs
      ) {
        overlaps.push({
          firstRegionId: left.region.id,
          secondRegionId: right.region.id,
          startMs: Math.max(left.range.startMs, right.range.startMs),
          endMs: Math.min(left.range.endMs, right.range.endMs)
        });
      }
    }
  }
  return overlaps;
}

export function addSubtitleLane(project: EditorProject): EditorProject {
  const subtitleLaneCount = clamp(
    Math.round(finiteNumber(project?.subtitleLaneCount, MIN_SUBTITLE_LANES)) + 1,
    MIN_SUBTITLE_LANES,
    MAX_SUBTITLE_LANES
  );
  if (subtitleLaneCount === project.subtitleLaneCount) {
    return project;
  }
  return { ...project, subtitleLaneCount, updatedAt: nowIso() };
}

export function updateSubtitleCue(
  project: EditorProject,
  cueId: unknown,
  patch: DynamicRecord = {},
  { markHuman = true }: { markHuman?: boolean } = {}
): EditorProject {
  const index = project.subtitles.findIndex((cue) => cue.id === cueId);
  if (index < 0) {
    return project;
  }
  const current = project.subtitles[index];
  if (!current) {
    return project;
  }
  const clip = project.clips.find((candidate) => candidate.id === current.clipId);
  if (!clip) {
    throw new Error("자막이 참조하는 영상 구간을 찾지 못했습니다.");
  }
  const next = normalizeSubtitleCue({
    ...current,
    ...patch,
    humanEdited: markHuman ? true : current.humanEdited,
    updatedAt: nowIso()
  }, clip, project.subtitleLaneCount ?? MIN_SUBTITLE_LANES);
  const subtitles = [...project.subtitles];
  subtitles[index] = next;
  return {
    ...project,
    subtitles,
    selectedCueId: next.id,
    updatedAt: nowIso()
  };
}

export function deleteSubtitleCue(
  project: EditorProject,
  cueId: unknown
): EditorProject {
  return {
    ...project,
    subtitles: project.subtitles.filter((cue) => cue.id !== cueId),
    selectedCueId: project.selectedCueId === cueId
      ? null
      : project.selectedCueId ?? null,
    updatedAt: nowIso()
  };
}

export function isAudSegBlankTimingCue(
  cue: EditorSubtitleCue | null | undefined
): boolean {
  return Boolean(
    cue?.origin === "ai"
    && cue.remoteMeta?.qualityCodes?.includes("AUDSEG_BLANK_TIMING")
  );
}

export function subtitleCueNeedsReview(
  cue: EditorSubtitleCue | null | undefined
): boolean {
  return Boolean(
    cue?.origin === "ai"
    && cue.remoteMeta?.reviewRequired
    && (
      !cue.humanEdited
      || (
        isAudSegBlankTimingCue(cue)
        && !String(cue.text || "").trim()
      )
    )
  );
}

const PRIMARY_AI_SPEAKER_IDS = new Set([
  "",
  "host",
  "main",
  "primary",
  "speaker",
  "speaker-0",
  "speaker_0",
  "streamer",
  "unknown",
  "화자0",
  "화자-0",
  "화자_0"
]);

function aiCaptionStackPriority(cue: EditorSubtitleCue): number {
  const speakerId = String(cue?.remoteMeta?.speakerId || "")
    .trim()
    .toLowerCase();
  return PRIMARY_AI_SPEAKER_IDS.has(speakerId) ? 0 : 1;
}

export function replaceAiSubtitleDraft(
  project: EditorProject,
  clipId: unknown,
  drafts: SubtitleCueDraftInput[] = []
): EditorProject {
  const clip = project.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return project;
  }
  const preserved = project.subtitles.filter((cue) => (
    cue.clipId !== clipId || cue.origin !== "ai" || cue.humanEdited
  ));
  const protectedInClip = preserved.filter((cue) => cue.clipId === clipId);
  const normalizedDrafts = drafts
    .filter((draft) => String(draft?.text || "").trim())
    .map((draft) => createSubtitleCue(project, {
      ...draft,
      clipId,
      lane: 0,
      origin: "ai"
    }))
    .sort((a, b) => (
      a.startOffsetMs - b.startOffsetMs ||
      a.endOffsetMs - b.endOffsetMs ||
      aiCaptionStackPriority(a) - aiCaptionStackPriority(b) ||
      a.id.localeCompare(b.id)
    ));
  const overlaps = (
    first: EditorSubtitleCue,
    second: EditorSubtitleCue
  ): boolean => (
    Math.max(first.startOffsetMs, second.startOffsetMs) <
    Math.min(first.endOffsetMs, second.endOffsetMs)
  );
  let subtitleLaneCount = clamp(
    Math.round(finiteNumber(project.subtitleLaneCount, MIN_SUBTITLE_LANES)),
    MIN_SUBTITLE_LANES,
    MAX_SUBTITLE_LANES
  );
  const laneCues: EditorSubtitleCue[][] = Array.from(
    { length: MAX_SUBTITLE_LANES },
    () => [] as EditorSubtitleCue[]
  );
  const speakerLanes = new Map<string, number>();
  for (const cue of protectedInClip) {
    laneCues[cue.lane]?.push(cue);
    const speakerId = String(cue.remoteMeta?.speakerId || "").trim();
    if (speakerId && speakerId !== "unknown" && !speakerLanes.has(speakerId)) {
      speakerLanes.set(speakerId, cue.lane);
    }
  }
  const aiCues: EditorSubtitleCue[] = [];
  for (const candidate of normalizedDrafts) {
    const speakerId = String(candidate.remoteMeta?.speakerId || "").trim();
    const preferredLane = speakerLanes.get(speakerId);
    const candidateLanes = [
      ...(typeof preferredLane === "number" && Number.isInteger(preferredLane)
        ? [preferredLane]
        : []),
      ...Array.from({ length: subtitleLaneCount }, (_, lane) => lane)
    ].filter((lane, index, lanes) => lanes.indexOf(lane) === index);
    let lane = candidateLanes.find((candidateLane) => (
      !(laneCues[candidateLane] ?? []).some((cue) => overlaps(cue, candidate))
    ));
    if (lane === undefined && subtitleLaneCount < MAX_SUBTITLE_LANES) {
      lane = subtitleLaneCount;
      subtitleLaneCount += 1;
    }
    if (lane === undefined) {
      throw new Error(
        `동시에 표시할 자막이 ${MAX_SUBTITLE_LANES}개 레인을 넘었습니다. 해당 구간을 먼저 검수해 주세요.`
      );
    }
    const assigned = { ...candidate, lane };
    aiCues.push(assigned);
    const assignedLane = laneCues[lane];
    if (!assignedLane) {
      throw new RangeError("자막 레인이 허용 범위를 벗어났습니다.");
    }
    assignedLane.push(assigned);
    if (speakerId && speakerId !== "unknown" && !speakerLanes.has(speakerId)) {
      speakerLanes.set(speakerId, lane);
    }
  }
  const subtitles = [...preserved, ...aiCues].sort((a, b) => {
    const clipA = project.clips.find((candidate) => candidate.id === a.clipId);
    const clipB = project.clips.find((candidate) => candidate.id === b.clipId);
    return (clipA?.timelineStartMs || 0) + a.startOffsetMs - ((clipB?.timelineStartMs || 0) + b.startOffsetMs);
  });
  return {
    ...project,
    subtitleLaneCount,
    subtitles,
    selectedCueId: subtitles.some((cue) => cue.id === project.selectedCueId)
      ? project.selectedCueId ?? null
      : aiCues[0]?.id || protectedInClip[0]?.id || null,
    updatedAt: nowIso()
  };
}

export function replaceAiBlankTimingDraft(
  project: EditorProject,
  clipId: unknown,
  drafts: SubtitleCueDraftInput[] = []
): EditorProject {
  const rangeSignature = (
    cue: Pick<SubtitleCueDraftInput, "remoteMeta">
  ): string | null => {
    const remoteMeta = recordOrEmpty(cue.remoteMeta);
    return (
      (Array.isArray(remoteMeta.qualityCodes)
        ? remoteMeta.qualityCodes
        : [])
        .find((code: unknown) => /^AUDSEG_RANGE_\d+_\d+$/u.test(String(code)))
      || null
    );
  };
  const protectedRangeSignatures = new Set(
    project.subtitles
      .filter((cue) => (
        cue.clipId === clipId
        && cue.origin === "ai"
        && cue.humanEdited
        && cue.remoteMeta?.qualityCodes?.includes("AUDSEG_BLANK_TIMING")
      ))
      .map(rangeSignature)
      .filter(Boolean)
  );
  const timingDrafts = (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => (
      Number.isFinite(Number(draft?.startOffsetMs))
      && Number.isFinite(Number(draft?.endOffsetMs))
      && Number(draft.endOffsetMs) > Number(draft.startOffsetMs)
      && !protectedRangeSignatures.has(rangeSignature(draft))
    ))
    .map((draft) => ({
      ...draft,
      text: "\u2026"
    }));
  const withVisiblePlaceholders = replaceAiSubtitleDraft(
    project,
    clipId,
    timingDrafts
  );
  return {
    ...withVisiblePlaceholders,
    subtitles: withVisiblePlaceholders.subtitles.map((cue) => (
      cue.clipId === clipId
      && cue.origin === "ai"
      && !cue.humanEdited
      && cue.text === "\u2026"
      && cue.remoteMeta?.qualityCodes?.includes("AUDSEG_BLANK_TIMING")
        ? { ...cue, text: "" }
        : cue
    ))
  };
}

export function appendAiSubtitleDrafts(
  project: EditorProject,
  drafts: SubtitleCueDraftInput[] = []
): EditorProject {
  if (!project || !Array.isArray(project.clips) || !Array.isArray(project.subtitles)) {
    return project;
  }
  const clipsById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const existingById = new Map(project.subtitles.map((cue) => [cue.id, cue]));
  const acceptedIds = new Set(existingById.keys());
  const draftsByClip = new Map<string, SubtitleCueDraftInput[]>();
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    const clipId = String(draft?.clipId || "");
    if (!clipsById.has(clipId) || !String(draft?.text || "").trim()) {
      continue;
    }
    const requestedId = String(draft?.id || "").trim();
    if (requestedId && acceptedIds.has(requestedId)) {
      continue;
    }
    if (requestedId) {
      acceptedIds.add(requestedId);
    }
    const clipDrafts = draftsByClip.get(clipId) || [];
    clipDrafts.push(draft);
    draftsByClip.set(clipId, clipDrafts);
  }
  if (draftsByClip.size === 0) {
    return project;
  }

  const selectedCueId = project.selectedCueId;
  let next: EditorProject = {
    ...project,
    // Mark copies as protected only while assigning lanes. The originals are
    // restored below so a local first pass can never change user-owned cues.
    subtitles: project.subtitles.map((cue) => ({
      ...cue,
      humanEdited: true
    }))
  };
  for (const clip of project.clips) {
    const clipDrafts = draftsByClip.get(clip.id);
    if (clipDrafts?.length) {
      next = replaceAiSubtitleDraft(next, clip.id, clipDrafts);
    }
  }
  const subtitles = next.subtitles.map((cue) => (
    existingById.get(cue.id) || cue
  ));
  return {
    ...next,
    subtitles,
    selectedCueId: subtitles.some((cue) => cue.id === selectedCueId)
      ? selectedCueId ?? null
      : next.selectedCueId ?? null,
    updatedAt: nowIso()
  };
}

export function transcriptChunksToCueDrafts(
  chunks: TranscriptChunk[] = [],
  clipDuration: unknown = 0,
  {
  maxCharacters = 26,
  gapBreakMs = 800,
  minimumDurationMs = 650
  }: {
    maxCharacters?: number;
    gapBreakMs?: number;
    minimumDurationMs?: number;
  } = {}
): SubtitleCueDraft[] {
  const clipDurationMs = Math.max(MIN_CUE_DURATION_MS, Math.round(finiteNumber(clipDuration)));
  const words: TranscriptWord[] = chunks.flatMap((chunk) => {
    const text = String(chunk?.text || "").trim();
    if (!text) {
      return [];
    }
    const start = secondsToMilliseconds(chunk?.timestamp?.[0]);
    const rawEnd = chunk?.timestamp?.[1];
    const end = rawEnd === null || rawEnd === undefined
      ? Math.min(clipDurationMs, start + minimumDurationMs)
      : secondsToMilliseconds(rawEnd);
    const startMs = clamp(
      start,
      0,
      Math.max(0, clipDurationMs - MIN_CUE_DURATION_MS)
    );
    return [{
      text,
      startMs,
      endMs: clamp(
        Math.max(startMs + MIN_CUE_DURATION_MS, end),
        startMs + MIN_CUE_DURATION_MS,
        clipDurationMs
      )
    }];
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const drafts: SubtitleCueDraft[] = [];
  let group: TranscriptWord[] = [];
  const flush = (): void => {
    if (group.length === 0) {
      return;
    }
    const firstWord = group[0];
    const lastWord = group.at(-1);
    if (!firstWord || !lastWord) {
      throw new Error("자막 단어 그룹의 경계를 찾지 못했습니다.");
    }
    const startOffsetMs = firstWord.startMs;
    const naturalEnd = lastWord.endMs;
    const nextStart = words[words.indexOf(lastWord) + 1]?.startMs;
    const paddedEnd = Math.min(
      clipDurationMs,
      Math.max(naturalEnd, startOffsetMs + minimumDurationMs),
      nextStart === undefined ? clipDurationMs : Math.max(naturalEnd, nextStart - 40)
    );
    drafts.push({
      startOffsetMs,
      endOffsetMs: Math.max(startOffsetMs + MIN_CUE_DURATION_MS, paddedEnd),
      text: group.map((word, index) => {
        if (index === 0) {
          return word.text;
        }
        const previousWord = group[index - 1];
        if (!previousWord) {
          return word.text;
        }
        const previous = previousWord.text;
        const noLeadingSpace = /^[,.:;!?%)\]}〉》」』…]/u.test(word.text);
        const noTrailingSpace = /[(\[{〈《「『]$/u.test(previous);
        return `${noLeadingSpace || noTrailingSpace ? "" : " "}${word.text}`;
      }).join("")
    });
    group = [];
  };

  words.forEach((word) => {
    if (group.length === 0) {
      group.push(word);
      return;
    }
    const first = group[0];
    const previous = group.at(-1);
    if (!first || !previous) {
      throw new Error("자막 단어 그룹의 경계를 찾지 못했습니다.");
    }
    const proposedText = `${group.map((item) => item.text).join(" ")} ${word.text}`.trim();
    const shouldBreak = (
      word.startMs - previous.endMs >= gapBreakMs ||
      proposedText.length > maxCharacters ||
      /[.!?。！？…]$/u.test(previous.text)
    );
    if (shouldBreak) {
      flush();
    }
    group.push(word);
  });
  flush();
  const nonOverlapping: SubtitleCueDraft[] = [];
  for (const draft of drafts) {
    const previous = nonOverlapping.at(-1);
    if (!previous || draft.startOffsetMs >= previous.endOffsetMs) {
      nonOverlapping.push(draft);
      continue;
    }
    const availableDuration = draft.endOffsetMs - previous.endOffsetMs;
    if (availableDuration >= MIN_CUE_DURATION_MS) {
      nonOverlapping.push({
        ...draft,
        startOffsetMs: previous.endOffsetMs
      });
      continue;
    }
    previous.text = `${previous.text} ${draft.text}`.trim();
    previous.endOffsetMs = Math.max(previous.endOffsetMs, draft.endOffsetMs);
  }
  return nonOverlapping;
}

export function updateClipTrim(project: EditorProject, clipId: unknown, {
  sourceStartMs,
  sourceEndMs
}: { sourceStartMs?: unknown; sourceEndMs?: unknown } = {}): EditorProject {
  const index = project.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) {
    return project;
  }
  const current = project.clips[index];
  if (!current) {
    return project;
  }
  const start = Math.max(0, Math.round(finiteNumber(sourceStartMs, current.sourceStartMs)));
  const end = Math.max(start + MIN_CLIP_DURATION_MS, Math.round(finiteNumber(sourceEndMs, current.sourceEndMs)));
  const nextClips = [...project.clips];
  const nextClip = { ...current, sourceStartMs: start, sourceEndMs: end, updatedAt: nowIso() };
  nextClips[index] = nextClip;
  const clips = reflowClips(nextClips);
  const subtitles = project.subtitles.flatMap((cue) => {
    if (cue.clipId !== clipId) {
      return [cue];
    }
    const cueSourceStart = current.sourceStartMs + cue.startOffsetMs;
    const cueSourceEnd = current.sourceStartMs + cue.endOffsetMs;
    const overlapStart = Math.max(start, cueSourceStart);
    const overlapEnd = Math.min(end, cueSourceEnd);
    if (overlapEnd - overlapStart < MIN_CUE_DURATION_MS) {
      return [];
    }
    return [normalizeSubtitleCue({
      ...cue,
      startOffsetMs: overlapStart - start,
      endOffsetMs: overlapEnd - start
    }, nextClip, project.subtitleLaneCount ?? MIN_SUBTITLE_LANES)];
  });
  const audioRegions = project.audioRegions.flatMap((region) => {
    if (region.clipId !== clipId) {
      return [region];
    }
    const regionSourceStart = current.sourceStartMs + region.startOffsetMs;
    const regionSourceEnd = current.sourceStartMs + region.endOffsetMs;
    const overlapStart = Math.max(start, regionSourceStart);
    const overlapEnd = Math.min(end, regionSourceEnd);
    if (overlapEnd - overlapStart < MIN_CUE_DURATION_MS) {
      return [];
    }
    return [normalizeAudioRegion({
      ...region,
      startOffsetMs: overlapStart - start,
      endOffsetMs: overlapEnd - start
    }, nextClip)];
  });
  const imageAssets = (project.imageAssets || []).flatMap((asset) => {
    if (asset.clipId !== clipId) {
      return [asset];
    }
    const assetSourceStart = current.sourceStartMs + asset.startOffsetMs;
    const assetSourceEnd = current.sourceStartMs + asset.endOffsetMs;
    const overlapStart = Math.max(start, assetSourceStart);
    const overlapEnd = Math.min(end, assetSourceEnd);
    if (overlapEnd - overlapStart < MIN_CUE_DURATION_MS) {
      return [];
    }
    const next = normalizeImageAsset({
      ...asset,
      startOffsetMs: overlapStart - start,
      endOffsetMs: overlapEnd - start
    }, nextClip);
    return next ? [next] : [];
  });
  const selectedCueId = subtitles.some((cue) => cue.id === project.selectedCueId)
    ? project.selectedCueId ?? null
    : null;
  const selectedAudioRegionId = audioRegions.some((region) => (
    region.id === project.selectedAudioRegionId
  ))
    ? project.selectedAudioRegionId ?? null
    : null;
  const selectedImageAssetId = imageAssets.some((asset) => (
    asset.id === project.selectedImageAssetId
  ))
    ? project.selectedImageAssetId ?? null
    : null;
  return {
    ...project,
    clips,
    subtitles,
    audioRegions,
    imageAssets,
    selectedCueId,
    selectedAudioRegionId,
    selectedImageAssetId,
    updatedAt: nowIso()
  };
}

/** Splits one enabled clip at a project-timeline point without deleting media. */
export function splitClipAtTimeline(
  project: EditorProject,
  timelineMsValue: unknown
): EditorProject {
  const timelineMs = Math.round(finiteNumber(timelineMsValue, -1));
  const clipIndex = project.clips.findIndex((clip) => (
    clip.enabled !== false
    && timelineMs > clip.timelineStartMs
    && timelineMs < clip.timelineStartMs + clipDurationMs(clip)
  ));
  const clip = project.clips[clipIndex];
  if (!clip) {
    throw new RangeError("분할 위치는 활성 컷의 시작과 끝 사이여야 합니다.");
  }
  const splitOffsetMs = timelineMs - clip.timelineStartMs;
  const durationMs = clipDurationMs(clip);
  if (
    splitOffsetMs < MIN_CLIP_DURATION_MS
    || durationMs - splitOffsetMs < MIN_CLIP_DURATION_MS
  ) {
    throw new RangeError("분할 뒤 양쪽 영상 조각은 각각 0.1초 이상이어야 합니다.");
  }
  const timestamp = nowIso();
  const usedClipIds = new Set(project.clips.map((candidate) => candidate.id));
  let rightId = makeId("clip");
  while (usedClipIds.has(rightId)) {
    rightId = makeId("clip");
  }
  const leftClip: EditorClip = {
    ...clip,
    sourceEndMs: clip.sourceStartMs + splitOffsetMs,
    updatedAt: timestamp
  };
  const rightClip: EditorClip = {
    ...clip,
    id: rightId,
    ...(clip.shortFormSourceClipId || clip.shortFormFramingSourceId
      ? { shortFormFramingSourceId: clip.id }
      : {}),
    sourceStartMs: clip.sourceStartMs + splitOffsetMs,
    timelineStartMs: timelineMs,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const clips = reflowClips([
    ...project.clips.slice(0, clipIndex),
    leftClip,
    rightClip,
    ...project.clips.slice(clipIndex + 1)
  ]);
  const normalizedLeft = clips.find((candidate) => candidate.id === leftClip.id)!;
  const normalizedRight = clips.find((candidate) => candidate.id === rightClip.id)!;

  const splitTimedItems = <T extends TimedItemRecord>(items: T[], {
    idPrefix,
    normalize
  }: {
    idPrefix: string;
    normalize: (item: T, owner: EditorClip) => T | null;
  }): T[] => items.flatMap((item) => {
    if (item.clipId !== clip.id) {
      return [item];
    }
    const fragments: Array<{ owner: EditorClip; start: number; end: number }> = [];
    const leftEnd = Math.min(item.endOffsetMs, splitOffsetMs);
    if (leftEnd - item.startOffsetMs >= MIN_CUE_DURATION_MS) {
      fragments.push({
        owner: normalizedLeft,
        start: item.startOffsetMs,
        end: leftEnd
      });
    }
    const rightStart = Math.max(item.startOffsetMs, splitOffsetMs);
    if (item.endOffsetMs - rightStart >= MIN_CUE_DURATION_MS) {
      fragments.push({
        owner: normalizedRight,
        start: rightStart - splitOffsetMs,
        end: item.endOffsetMs - splitOffsetMs
      });
    }
    return fragments.flatMap((fragment, index) => {
      const normalized = normalize({
        ...item,
        id: index === 0 ? item.id : makeId(idPrefix),
        clipId: fragment.owner.id,
        startOffsetMs: fragment.start,
        endOffsetMs: fragment.end,
        createdAt: index === 0 ? item.createdAt : timestamp,
        updatedAt: timestamp
      }, fragment.owner);
      return normalized ? [normalized] : [];
    });
  });

  const subtitles = splitTimedItems(project.subtitles, {
    idPrefix: "cue",
    normalize: (cue, owner) => normalizeSubtitleCue(
      cue,
      owner,
      project.subtitleLaneCount ?? MIN_SUBTITLE_LANES
    )
  });
  const imageAssets = splitTimedItems(project.imageAssets, {
    idPrefix: "asset",
    normalize: normalizeImageAsset
  });
  const audioRegions = splitTimedItems(project.audioRegions, {
    idPrefix: "audio",
    normalize: normalizeAudioRegion
  });
  return {
    ...project,
    clips,
    subtitles,
    imageAssets,
    audioRegions,
    selectedClipId: rightClip.id,
    selectedCueId: subtitles.some((cue) => cue.id === project.selectedCueId)
      ? project.selectedCueId ?? null
      : null,
    selectedImageAssetId: imageAssets.some((asset) => asset.id === project.selectedImageAssetId)
      ? project.selectedImageAssetId ?? null
      : null,
    selectedAudioRegionId: audioRegions.some((region) => region.id === project.selectedAudioRegionId)
      ? project.selectedAudioRegionId ?? null
      : null,
    playheadMs: timelineMs,
    updatedAt: timestamp
  };
}

/** Merges two adjacent, source-contiguous clips while preserving timed items. */
export function mergeAdjacentClips(
  project: EditorProject,
  leftClipId: unknown,
  rightClipId: unknown
): EditorProject {
  const leftIndex = project.clips.findIndex((clip) => clip.id === leftClipId);
  const rightIndex = project.clips.findIndex((clip) => clip.id === rightClipId);
  const left = project.clips[leftIndex];
  const right = project.clips[rightIndex];
  if (!left || !right || rightIndex !== leftIndex + 1) {
    throw new RangeError("병합할 두 영상 조각은 타임라인에서 바로 이웃해야 합니다.");
  }
  if (
    left.enabled === false
    || right.enabled === false
    || left.sourceEndMs !== right.sourceStartMs
    || String(left.shortFormSourceClipId || left.id)
      !== String(right.shortFormSourceClipId || right.id)
  ) {
    throw new RangeError("같은 원본에서 실제로 이어진 쇼츠 조각만 병합할 수 있습니다.");
  }
  const timestamp = nowIso();
  const leftDurationMs = clipDurationMs(left);
  const mergedClip: EditorClip = {
    ...left,
    sourceEndMs: right.sourceEndMs,
    updatedAt: timestamp
  };
  const clips = reflowClips([
    ...project.clips.slice(0, leftIndex),
    mergedClip,
    ...project.clips.slice(rightIndex + 1)
  ]);
  const normalizedOwner = clips.find((clip) => clip.id === mergedClip.id)!;
  const mergeTimedItems = <T extends TimedItemRecord>(items: T[], {
    normalize
  }: {
    normalize: (item: T, owner: EditorClip) => T | null;
  }): T[] => items.flatMap((item) => {
    if (item.clipId !== left.id && item.clipId !== right.id) {
      return [item];
    }
    const offset = item.clipId === right.id ? leftDurationMs : 0;
    const normalized = normalize({
      ...item,
      clipId: normalizedOwner.id,
      startOffsetMs: item.startOffsetMs + offset,
      endOffsetMs: item.endOffsetMs + offset,
      updatedAt: timestamp
    }, normalizedOwner);
    return normalized ? [normalized] : [];
  });
  const subtitles = mergeTimedItems(project.subtitles, {
    normalize: (cue, owner) => normalizeSubtitleCue(
      cue,
      owner,
      project.subtitleLaneCount ?? MIN_SUBTITLE_LANES
    )
  });
  const imageAssets = mergeTimedItems(project.imageAssets, {
    normalize: normalizeImageAsset
  });
  const audioRegions = mergeTimedItems(project.audioRegions, {
    normalize: normalizeAudioRegion
  });
  const rightWasSelected = project.selectedClipId === right.id;
  return {
    ...project,
    clips,
    subtitles,
    imageAssets,
    audioRegions,
    selectedClipId: rightWasSelected
      ? normalizedOwner.id
      : project.selectedClipId ?? null,
    selectedCueId: subtitles.some((cue) => cue.id === project.selectedCueId)
      ? project.selectedCueId ?? null
      : null,
    selectedImageAssetId: imageAssets.some((asset) => asset.id === project.selectedImageAssetId)
      ? project.selectedImageAssetId ?? null
      : null,
    selectedAudioRegionId: audioRegions.some((region) => region.id === project.selectedAudioRegionId)
      ? project.selectedAudioRegionId ?? null
      : null,
    playheadMs: Math.min(project.playheadMs, projectDurationMs({ clips })),
    updatedAt: timestamp
  };
}

export function rippleDeleteTimelineRange(project: EditorProject, {
  startMs,
  endMs
}: { startMs?: unknown; endMs?: unknown } = {}): EditorProject {
  const numericStartMs = Number(startMs);
  const numericEndMs = Number(endMs);
  if (!Number.isFinite(numericStartMs) || !Number.isFinite(numericEndMs)) {
    throw new TypeError("삭제할 타임라인 구간의 시작과 끝 시각이 필요합니다.");
  }
  const start = Math.round(numericStartMs);
  const end = Math.round(numericEndMs);
  const duration = projectDurationMs(project);
  if (start < 0 || end > duration || end - start < MIN_CLIP_DURATION_MS) {
    throw new RangeError(
      "삭제 구간은 타임라인 안에서 0.1초 이상이어야 합니다."
    );
  }

  const timestamp = nowIso();
  const usedClipIds = new Set((project.clips || []).map((clip) => clip.id));
  const makeUniqueClipId = () => {
    let id = makeId("clip");
    while (usedClipIds.has(id)) {
      id = makeId("clip");
    }
    usedClipIds.add(id);
    return id;
  };
  const slicesByClipId = new Map<string, RippleSlice[]>();
  const nextClips: EditorClip[] = [];

  for (const clip of project.clips || []) {
    const clipDuration = clipDurationMs(clip);
    const slices: RippleSlice[] = [];
    const appendSlice = (
      oldStartOffsetMs: number,
      oldEndOffsetMs: number,
      {
      changed = true
      }: { changed?: boolean } = {}
    ): void => {
      const sliceIndex = slices.length;
      const id = sliceIndex === 0 ? clip.id : makeUniqueClipId();
      const nextClip = changed
        ? {
          ...clip,
          id,
          ...(id !== clip.id && (
            clip.shortFormSourceClipId || clip.shortFormFramingSourceId
          )
            ? { shortFormFramingSourceId: clip.id }
            : {}),
          sourceStartMs: clip.sourceStartMs + oldStartOffsetMs,
          sourceEndMs: clip.sourceStartMs + oldEndOffsetMs,
          createdAt: id === clip.id ? clip.createdAt : timestamp,
          updatedAt: timestamp
        }
        : clip;
      slices.push({
        oldStartOffsetMs,
        oldEndOffsetMs,
        nextClip
      });
      nextClips.push(nextClip);
    };

    if (clip.enabled === false) {
      appendSlice(0, clipDuration, { changed: false });
      slicesByClipId.set(clip.id, slices);
      continue;
    }

    const clipTimelineStartMs = clip.timelineStartMs;
    const clipTimelineEndMs = clipTimelineStartMs + clipDuration;
    const overlapStartMs = Math.max(start, clipTimelineStartMs);
    const overlapEndMs = Math.min(end, clipTimelineEndMs);
    if (overlapEndMs <= overlapStartMs) {
      appendSlice(0, clipDuration, { changed: false });
      slicesByClipId.set(clip.id, slices);
      continue;
    }

    const localDeleteStartMs = overlapStartMs - clipTimelineStartMs;
    const localDeleteEndMs = overlapEndMs - clipTimelineStartMs;
    const candidateRanges: Array<[number, number]> = [
      [0, localDeleteStartMs],
      [localDeleteEndMs, clipDuration]
    ];
    const keptRanges = candidateRanges.filter(
      ([rangeStartMs, rangeEndMs]) => rangeEndMs > rangeStartMs
    );
    const tooShort = keptRanges.find(([rangeStartMs, rangeEndMs]) => (
      rangeEndMs - rangeStartMs < MIN_CLIP_DURATION_MS
    ));
    if (tooShort) {
      throw new RangeError(
        "삭제 뒤 남는 영상 조각은 각각 0.1초 이상이어야 합니다."
      );
    }
    keptRanges.forEach(([rangeStartMs, rangeEndMs]) => {
      appendSlice(rangeStartMs, rangeEndMs);
    });
    slicesByClipId.set(clip.id, slices);
  }

  const clips = reflowClips(nextClips);
  const reflowedByClipId = new Map(clips.map((clip) => [clip.id, clip]));
  slicesByClipId.forEach((slices) => {
    slices.forEach((slice) => {
      const reflowed = reflowedByClipId.get(slice.nextClip.id);
      if (!reflowed) {
        throw new Error("리플 삭제 후 영상 구간을 다시 연결하지 못했습니다.");
      }
      slice.nextClip = reflowed;
    });
  });

  const remapTimedItems = <T extends TimedItemRecord>(items: T[], {
    idPrefix,
    normalize,
    patchFragment = () => ({})
  }: {
    idPrefix: string;
    normalize: (
      item: T,
      clip: EditorClip
    ) => T | null;
    patchFragment?: (
      item: T,
      fragment: RippleFragment
    ) => DynamicRecord;
  }): T[] => (items || []).flatMap((item) => {
    const slices = slicesByClipId.get(item.clipId) || [];
    const fragments = slices.flatMap((slice) => {
      const overlapStartMs = Math.max(item.startOffsetMs, slice.oldStartOffsetMs);
      const overlapEndMs = Math.min(item.endOffsetMs, slice.oldEndOffsetMs);
      if (overlapEndMs - overlapStartMs < MIN_CUE_DURATION_MS) {
        return [];
      }
      return [{
        slice,
        overlapStartMs,
        overlapEndMs,
        startOffsetMs: overlapStartMs - slice.oldStartOffsetMs,
        endOffsetMs: overlapEndMs - slice.oldStartOffsetMs
      }];
    });
    return fragments.flatMap((fragment, fragmentIndex) => {
      const preserveId = fragmentIndex === 0;
      const unchanged = (
        fragments.length === 1 &&
        fragment.slice.nextClip.id === item.clipId &&
        fragment.startOffsetMs === item.startOffsetMs &&
        fragment.endOffsetMs === item.endOffsetMs
      );
      if (unchanged) {
        return [item];
      }
      const raw = {
        ...item,
        ...patchFragment(item, fragment),
        id: preserveId ? item.id : makeId(idPrefix),
        clipId: fragment.slice.nextClip.id,
        startOffsetMs: fragment.startOffsetMs,
        endOffsetMs: fragment.endOffsetMs,
        createdAt: preserveId ? item.createdAt : timestamp,
        updatedAt: timestamp
      };
      const normalized = normalize(raw, fragment.slice.nextClip);
      return normalized ? [normalized] : [];
    });
  });

  const subtitles = remapTimedItems(project.subtitles, {
    idPrefix: "cue",
    normalize: (cue, clip) => normalizeSubtitleCue(
      cue,
      clip,
      project.subtitleLaneCount ?? MIN_SUBTITLE_LANES
    )
  });
  const imageAssets = remapTimedItems(project.imageAssets, {
    idPrefix: "asset",
    normalize: normalizeImageAsset
  });
  const audioRegions = remapTimedItems(project.audioRegions, {
    idPrefix: "audio",
    normalize: normalizeAudioRegion,
    patchFragment: (region, fragment) => ({
      fadeInMs: fragment.overlapStartMs === region.startOffsetMs
        ? region.fadeInMs
        : 0,
      fadeOutMs: fragment.overlapEndMs === region.endOffsetMs
        ? region.fadeOutMs
        : 0
    })
  });

  const previousPlayheadMs = clamp(
    Math.round(finiteNumber(project.playheadMs)),
    0,
    duration
  );
  const deletedDurationMs = end - start;
  const playheadMs = clamp(
    previousPlayheadMs <= start
      ? previousPlayheadMs
      : previousPlayheadMs < end
        ? start
        : previousPlayheadMs - deletedDurationMs,
    0,
    projectDurationMs({ clips })
  );
  const projectWithClips = { ...project, clips };
  const selectedClipId = (
    typeof project.selectedClipId === "string"
    && clips.some((clip) => clip.id === project.selectedClipId)
  )
    ? project.selectedClipId
    : mapTimelineToSource(projectWithClips, playheadMs)?.clipId
      || clips[0]?.id
      || null;
  const survivingSelectionIds = new Set(clips.map((clip) => clip.selectionId));
  const suppressedBySelectionId = new Map<string, SuppressedSelection>();
  for (const entry of project.suppressedSelections || []) {
    const suppressed = normalizeSuppressedSelection(entry);
    if (suppressed && !survivingSelectionIds.has(suppressed.selectionId)) {
      suppressedBySelectionId.set(suppressed.selectionId, suppressed);
    }
  }
  const previousClipsBySelection = new Map<string, EditorClip[]>();
  for (const clip of project.clips || []) {
    const selectionId = String(clip.selectionId || "").trim();
    if (!selectionId) {
      continue;
    }
    const group = previousClipsBySelection.get(selectionId) || [];
    group.push(clip);
    previousClipsBySelection.set(selectionId, group);
  }
  const alignmentOffsetMs = Math.round(finiteNumber(
    project.broadcastSession?.alignmentOffsetMs
  ));
  previousClipsBySelection.forEach((previousClips, selectionId) => {
    if (survivingSelectionIds.has(selectionId)) {
      suppressedBySelectionId.delete(selectionId);
      return;
    }
    const [representative] = previousClips;
    if (!representative) {
      return;
    }
    const previous = suppressedBySelectionId.get(selectionId);
    const suppressed = normalizeSuppressedSelection({
      ...previous,
      selectionId,
      selectionStartMs: Math.round(finiteNumber(
        representative.selectionStartMs,
        representative.sourceStartMs - alignmentOffsetMs
      )),
      selectionEndMs: Math.round(finiteNumber(
        representative.selectionEndMs,
        representative.sourceEndMs - alignmentOffsetMs
      )),
      note: representative.note,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    });
    if (suppressed) {
      suppressedBySelectionId.set(selectionId, suppressed);
    }
  });
  const suppressedSelections = [...suppressedBySelectionId.values()];

  return {
    ...project,
    clips,
    suppressedSelections,
    subtitles,
    imageAssets,
    audioRegions,
    selectedClipId,
    selectedCueId: subtitles.some((cue) => cue.id === project.selectedCueId)
      ? project.selectedCueId ?? null
      : null,
    selectedImageAssetId: imageAssets.some((asset) => (
      asset.id === project.selectedImageAssetId
    ))
      ? project.selectedImageAssetId ?? null
      : null,
    selectedAudioRegionId: audioRegions.some((region) => (
      region.id === project.selectedAudioRegionId
    ))
      ? project.selectedAudioRegionId ?? null
      : null,
    playheadMs,
    updatedAt: timestamp
  };
}

export function reorderClip(
  project: EditorProject,
  clipId: unknown,
  toIndex: unknown
): EditorProject {
  const fromIndex = project.clips.findIndex((clip) => clip.id === clipId);
  const target = clamp(Math.round(finiteNumber(toIndex)), 0, Math.max(0, project.clips.length - 1));
  if (fromIndex < 0 || fromIndex === target) {
    return project;
  }
  const clips = [...project.clips];
  const [moved] = clips.splice(fromIndex, 1);
  if (!moved) {
    return project;
  }
  clips.splice(target, 0, moved);
  return { ...project, clips: reflowClips(clips), updatedAt: nowIso() };
}

function movableClipIdSet(
  clips: EditorClip[],
  selectedClipIds: Iterable<unknown> | unknown[]
): Set<string> {
  const requested = selectedClipIds instanceof Set
    ? selectedClipIds
    : new Set(Array.isArray(selectedClipIds) ? selectedClipIds : []);
  return new Set(
    clips
      .filter((clip) => requested.has(clip.id))
      .map((clip) => clip.id)
  );
}

export function canReorderClipGroup(
  clips: EditorClip[] = [],
  selectedClipIds: Iterable<unknown> | unknown[] = [],
  direction = 0
): boolean {
  const selected = movableClipIdSet(clips, selectedClipIds);
  if (selected.size === 0 || (direction !== -1 && direction !== 1)) {
    return false;
  }
  if (direction < 0) {
    return clips.some((clip, index) => {
      const previous = clips[index - 1];
      return Boolean(
        previous
        && selected.has(clip.id)
        && !selected.has(previous.id)
      );
    });
  }
  return clips.some((clip, index) => {
    const next = clips[index + 1];
    return Boolean(
      next
      && selected.has(clip.id)
      && !selected.has(next.id)
    );
  });
}

export function reorderClipGroup(
  project: EditorProject,
  selectedClipIds: Iterable<unknown> | unknown[] = [],
  direction = 0
): EditorProject {
  const clips = [...(project?.clips || [])];
  const selected = movableClipIdSet(clips, selectedClipIds);
  if (!canReorderClipGroup(clips, selected, direction)) {
    return project;
  }
  if (direction < 0) {
    for (let index = 1; index < clips.length; index += 1) {
      const current = clips[index];
      const previous = clips[index - 1];
      if (!current || !previous) {
        continue;
      }
      if (
        selected.has(current.id) &&
        !selected.has(previous.id)
      ) {
        clips[index - 1] = current;
        clips[index] = previous;
      }
    }
  } else {
    for (let index = clips.length - 2; index >= 0; index -= 1) {
      const current = clips[index];
      const next = clips[index + 1];
      if (!current || !next) {
        continue;
      }
      if (
        selected.has(current.id) &&
        !selected.has(next.id)
      ) {
        clips[index] = next;
        clips[index + 1] = current;
      }
    }
  }
  return {
    ...project,
    clips: reflowClips(clips),
    updatedAt: nowIso()
  };
}

export function applyMediaAlignmentOffset(
  project: EditorProject,
  alignmentOffsetMs: unknown
): EditorProject {
  const nextOffset = Math.round(finiteNumber(alignmentOffsetMs));
  const currentOffset = Math.round(finiteNumber(project?.broadcastSession?.alignmentOffsetMs));
  const delta = nextOffset - currentOffset;
  if (delta === 0 && project.broadcastSession?.alignmentConfirmed) {
    return project;
  }
  const shiftClips = (clips: readonly EditorClip[]) => reflowClips(
    clips.map((clip) => {
      const sourceStartMs = clip.sourceStartMs + delta;
      const sourceEndMs = clip.sourceEndMs + delta;
      if (sourceStartMs < 0 || sourceEndMs <= sourceStartMs) {
        throw new Error("정렬 오프셋을 적용하면 선택 구간이 원본 시작보다 앞으로 넘어갑니다.");
      }
      return {
        ...clip,
        sourceStartMs,
        sourceEndMs,
        updatedAt: nowIso()
      };
    })
  );
  const clips = shiftClips(project.clips);
  const shiftShortFormSource = <T extends {
    sourceStartMs: number;
    sourceEndMs: number;
    sourceSelectionStartMs: number;
    sourceSelectionEndMs: number;
  }>(source: T, kind: "영상" | "음성"): T => {
    const sourceStartMs = source.sourceStartMs + delta;
    const sourceEndMs = source.sourceEndMs + delta;
    const sourceSelectionStartMs = source.sourceSelectionStartMs + delta;
    const sourceSelectionEndMs = source.sourceSelectionEndMs + delta;
    if (
      sourceStartMs < 0
      || sourceEndMs <= sourceStartMs
      || sourceSelectionStartMs < 0
      || sourceSelectionEndMs <= sourceSelectionStartMs
      || sourceStartMs < sourceSelectionStartMs
      || sourceEndMs > sourceSelectionEndMs
    ) {
      throw new Error(
        `정렬 오프셋을 적용하면 쇼츠 ${kind} 에셋이 원본 시작보다 앞으로 넘어갑니다.`
      );
    }
    return {
      ...source,
      sourceStartMs,
      sourceEndMs,
      sourceSelectionStartMs,
      sourceSelectionEndMs
    };
  };
  const shortForm = {
    ...project.shortForm,
    videoAssets: project.shortForm.videoAssets.map((asset) => (
      shiftShortFormSource(asset, "영상")
    )),
    sourceAudioAssets: project.shortForm.sourceAudioAssets.map((asset) => (
      shiftShortFormSource(asset, "음성")
    ))
  };
  return {
    ...project,
    broadcastSession: {
      ...project.broadcastSession,
      alignmentOffsetMs: nextOffset,
      alignmentConfirmed: true
    },
    clips,
    shortForm,
    updatedAt: nowIso()
  };
}

export function serializeSrt(project: EditorProject): string {
  const cues = (project?.subtitles || [])
    .map((cue) => ({ cue, range: cueTimelineRange(project, cue) }))
    .filter(hasTimelineRange)
    .filter(({ cue }) => cue.text.trim())
    .sort((a, b) => a.range.startMs - b.range.startMs);
  const formatSrtTime = (milliseconds: number): string => {
    const value = Math.max(0, Math.round(milliseconds));
    const hours = Math.floor(value / 3_600_000);
    const minutes = Math.floor((value % 3_600_000) / 60_000);
    const seconds = Math.floor((value % 60_000) / 1000);
    const millis = value % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
  };
  return cues.map(({ cue, range }, index) => [
    index + 1,
    `${formatSrtTime(range.startMs)} --> ${formatSrtTime(range.endMs)}`,
    cue.text,
    ""
  ].join("\n")).join("\n");
}
