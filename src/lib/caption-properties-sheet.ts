import {
  normalizeHexColor,
  resolveSubtitleCueBackground,
  type EditorClip,
  type EditorSubtitleCue,
  type SubtitleDefaultsRecord
} from "./editor-core.js";

export type CaptionPropertiesSheetClipInput = Pick<
  EditorClip,
  "id" | "enabled" | "timelineStartMs"
>;

export type CaptionPropertiesSheetCueInput = Pick<
  EditorSubtitleCue,
  | "id"
  | "clipId"
  | "startOffsetMs"
  | "endOffsetMs"
  | "lane"
  | "x"
  | "y"
  | "color"
  | "fontScale"
  | "backgroundEnabled"
>;

export type CaptionPropertiesSheetDefaultsInput = Pick<
  SubtitleDefaultsRecord,
  | "fontScale"
  | "backgroundColor"
  | "backgroundRadiusEm"
  | "outlineColor"
  | "outlineWidth"
>;

export interface CaptionPropertiesSheetInput {
  clips: readonly CaptionPropertiesSheetClipInput[];
  cues: readonly CaptionPropertiesSheetCueInput[];
  defaults: CaptionPropertiesSheetDefaultsInput;
}

export type CaptionPropertySource = "project" | "cue";

export interface CaptionPropertiesSheetVariationFlags {
  position: boolean;
  fontScale: boolean;
  color: boolean;
  background: boolean;
  any: boolean;
}

export interface CaptionPropertiesSheetRow {
  cueId: string;
  ordinal: number;
  clipNumber: number;
  outputEnabled: boolean;
  timelineStartMs: number | null;
  startOffsetMs: number;
  endOffsetMs: number;
  laneNumber: number;
  xPercent: number;
  yPercent: number;
  fontScalePercent: number;
  fontScaleSource: CaptionPropertySource;
  color: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundSource: CaptionPropertySource;
  styleGroupLabel: string;
  styleGroupCount: number;
  styleGroupSingleton: boolean;
  variations: CaptionPropertiesSheetVariationFlags;
}

export interface CaptionPropertiesSheetVariationCounts {
  position: number;
  fontScale: number;
  color: number;
  background: number;
  any: number;
}

export interface CaptionPropertiesSheetCommonOutline {
  enabled: boolean;
  color: string;
  width: number;
  widthPercent: number;
}

export interface CaptionPropertiesSheetSummary {
  captionCount: number;
  outputCaptionCount: number;
  excludedCaptionCount: number;
  unknownClipCaptionCount: number;
  styleGroupCount: number;
  singletonStyleGroupCount: number;
  variationCaptionCount: number;
  variationCounts: CaptionPropertiesSheetVariationCounts;
  commonOutline: CaptionPropertiesSheetCommonOutline;
}

export interface CaptionPropertiesSheet {
  rows: CaptionPropertiesSheetRow[];
  summary: CaptionPropertiesSheetSummary;
}

interface PreparedCaptionPropertiesSheetRow {
  cueId: string;
  sourceIndex: number;
  clipIndex: number;
  outputEnabled: boolean;
  timelineStartMs: number | null;
  startOffsetMs: number;
  endOffsetMs: number;
  laneNumber: number;
  xPercent: number;
  yPercent: number;
  fontScalePercent: number;
  fontScaleSource: CaptionPropertySource;
  color: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundSource: CaptionPropertySource;
  positionKey: string;
  fontScaleKey: string;
  backgroundKey: string;
  styleFingerprint: string;
}

interface StyleGroup {
  fingerprint: string;
  count: number;
  outputCount: number;
  firstRowIndex: number;
  label: string;
}

const DEFAULT_FONT_SCALE = 0.0675;
const DEFAULT_OUTLINE_COLOR = "#111111";

function roundTo(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function configuredFontScale(
  cue: CaptionPropertiesSheetCueInput,
  defaults: CaptionPropertiesSheetDefaultsInput
): { value: number; source: CaptionPropertySource } {
  if (
    typeof cue.fontScale === "number"
    && Number.isFinite(cue.fontScale)
    && cue.fontScale > 0
  ) {
    return { value: cue.fontScale, source: "cue" };
  }
  const projectScale = Number(defaults.fontScale);
  return {
    value: Number.isFinite(projectScale) && projectScale > 0
      ? projectScale
      : DEFAULT_FONT_SCALE,
    source: "project"
  };
}

function normalizedBackgroundColor(value: unknown): string {
  const rawColor = String(value || "").trim().toLowerCase();
  const hexColor = normalizeHexColor(rawColor, "");
  return hexColor || rawColor.replace(/\s+/gu, " ") || "transparent";
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function styleGroupLabel(index: number): string {
  let ordinal = index + 1;
  let label = "";
  while (ordinal > 0) {
    ordinal -= 1;
    label = String.fromCharCode(65 + ordinal % 26) + label;
    ordinal = Math.floor(ordinal / 26);
  }
  return label;
}

function uniqueModalKey(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let modalKey: string | null = null;
  let modalCount = 0;
  let tied = false;
  for (const [key, count] of counts) {
    if (count > modalCount) {
      modalKey = key;
      modalCount = count;
      tied = false;
    } else if (count === modalCount) {
      tied = true;
    }
  }
  return tied ? null : modalKey;
}

function prepareRows(
  input: CaptionPropertiesSheetInput
): PreparedCaptionPropertiesSheetRow[] {
  const clipById = new Map<string, {
    clip: CaptionPropertiesSheetClipInput;
    index: number;
  }>();
  input.clips.forEach((clip, index) => {
    if (!clipById.has(clip.id)) {
      clipById.set(clip.id, { clip, index });
    }
  });

  const prepared: PreparedCaptionPropertiesSheetRow[] = [];
  input.cues.forEach((cue, sourceIndex) => {
    const clipEntry = clipById.get(cue.clipId);
    if (!clipEntry) {
      return;
    }
    const outputEnabled = clipEntry.clip.enabled !== false;
    const xPercent = roundTo(cue.x * 100, 1);
    const yPercent = roundTo(cue.y * 100, 1);
    const fontScale = configuredFontScale(cue, input.defaults);
    const fontScalePercent = roundTo(fontScale.value * 100, 2);
    const color = normalizeHexColor(cue.color);
    const background = resolveSubtitleCueBackground(input.defaults, cue);
    const backgroundColor = background.enabled
      ? normalizedBackgroundColor(background.color)
      : "transparent";
    const backgroundSource: CaptionPropertySource = (
      typeof cue.backgroundEnabled === "boolean" ? "cue" : "project"
    );
    const positionKey = JSON.stringify([xPercent, yPercent]);
    const fontScaleKey = String(fontScalePercent);
    const backgroundKey = JSON.stringify([
      background.enabled,
      backgroundColor
    ]);
    const styleFingerprint = JSON.stringify([
      xPercent,
      yPercent,
      fontScalePercent,
      color,
      background.enabled,
      backgroundColor
    ]);
    prepared.push({
      cueId: cue.id,
      sourceIndex,
      clipIndex: clipEntry.index,
      outputEnabled,
      timelineStartMs: outputEnabled
        ? clipEntry.clip.timelineStartMs + cue.startOffsetMs
        : null,
      startOffsetMs: cue.startOffsetMs,
      endOffsetMs: cue.endOffsetMs,
      laneNumber: cue.lane + 1,
      xPercent,
      yPercent,
      fontScalePercent,
      fontScaleSource: fontScale.source,
      color,
      backgroundEnabled: background.enabled,
      backgroundColor,
      backgroundSource,
      positionKey,
      fontScaleKey,
      backgroundKey,
      styleFingerprint
    });
  });

  return prepared.sort((left, right) => (
    left.clipIndex - right.clipIndex
    || left.startOffsetMs - right.startOffsetMs
    || left.laneNumber - right.laneNumber
    || left.endOffsetMs - right.endOffsetMs
    || compareStrings(left.cueId, right.cueId)
    || left.sourceIndex - right.sourceIndex
  ));
}

function buildStyleGroups(
  rows: readonly PreparedCaptionPropertiesSheetRow[]
): Map<string, StyleGroup> {
  const groupByFingerprint = new Map<string, StyleGroup>();
  rows.forEach((row, rowIndex) => {
    const existing = groupByFingerprint.get(row.styleFingerprint);
    if (existing) {
      existing.count += 1;
      if (row.outputEnabled) {
        existing.outputCount += 1;
      }
      return;
    }
    groupByFingerprint.set(row.styleFingerprint, {
      fingerprint: row.styleFingerprint,
      count: 1,
      outputCount: row.outputEnabled ? 1 : 0,
      firstRowIndex: rowIndex,
      label: ""
    });
  });
  const hasOutputRows = rows.some((row) => row.outputEnabled);
  const ordered = [...groupByFingerprint.values()].sort((left, right) => (
    (hasOutputRows ? right.outputCount - left.outputCount : 0)
    || right.count - left.count
    || left.firstRowIndex - right.firstRowIndex
  ));
  ordered.forEach((group, index) => {
    group.label = styleGroupLabel(index);
  });
  return groupByFingerprint;
}

function normalizedOutline(
  defaults: CaptionPropertiesSheetDefaultsInput
): CaptionPropertiesSheetCommonOutline {
  const rawWidth = Number(defaults.outlineWidth);
  const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 0;
  return {
    enabled: width > 0,
    color: normalizeHexColor(defaults.outlineColor, DEFAULT_OUTLINE_COLOR),
    width,
    widthPercent: roundTo(width * 100, 2)
  };
}

export function createCaptionPropertiesSheet(
  input: CaptionPropertiesSheetInput
): CaptionPropertiesSheet {
  const preparedRows = prepareRows(input);
  const styleGroups = buildStyleGroups(preparedRows);
  const outputRows = preparedRows.filter((row) => row.outputEnabled);
  const comparisonRows = outputRows.length > 0 ? outputRows : preparedRows;
  const modalPosition = uniqueModalKey(
    comparisonRows.map((row) => row.positionKey)
  );
  const modalFontScale = uniqueModalKey(
    comparisonRows.map((row) => row.fontScaleKey)
  );
  const modalColor = uniqueModalKey(
    comparisonRows.map((row) => row.color)
  );
  const modalBackground = uniqueModalKey(
    comparisonRows.map((row) => row.backgroundKey)
  );

  const rows = preparedRows.map((row, index): CaptionPropertiesSheetRow => {
    const styleGroup = styleGroups.get(row.styleFingerprint);
    if (!styleGroup) {
      throw new Error("자막 속성 시트 스타일 그룹을 찾지 못했습니다.");
    }
    const compareForVariations = row.outputEnabled || outputRows.length === 0;
    const position = compareForVariations
      && modalPosition !== null
      && row.positionKey !== modalPosition;
    const fontScale = compareForVariations
      && modalFontScale !== null
      && row.fontScaleKey !== modalFontScale;
    const color = compareForVariations
      && modalColor !== null
      && row.color !== modalColor;
    const background = compareForVariations
      && modalBackground !== null
      && row.backgroundKey !== modalBackground;
    return {
      cueId: row.cueId,
      ordinal: index + 1,
      clipNumber: row.clipIndex + 1,
      outputEnabled: row.outputEnabled,
      timelineStartMs: row.timelineStartMs,
      startOffsetMs: row.startOffsetMs,
      endOffsetMs: row.endOffsetMs,
      laneNumber: row.laneNumber,
      xPercent: row.xPercent,
      yPercent: row.yPercent,
      fontScalePercent: row.fontScalePercent,
      fontScaleSource: row.fontScaleSource,
      color: row.color,
      backgroundEnabled: row.backgroundEnabled,
      backgroundColor: row.backgroundColor,
      backgroundSource: row.backgroundSource,
      styleGroupLabel: styleGroup.label,
      styleGroupCount: styleGroup.count,
      styleGroupSingleton: styleGroup.count === 1,
      variations: {
        position,
        fontScale,
        color,
        background,
        any: position || fontScale || color || background
      }
    };
  });

  const variationCounts: CaptionPropertiesSheetVariationCounts = {
    position: rows.filter((row) => row.variations.position).length,
    fontScale: rows.filter((row) => row.variations.fontScale).length,
    color: rows.filter((row) => row.variations.color).length,
    background: rows.filter((row) => row.variations.background).length,
    any: rows.filter((row) => row.variations.any).length
  };
  const outputCaptionCount = rows.filter((row) => row.outputEnabled).length;
  return {
    rows,
    summary: {
      captionCount: rows.length,
      outputCaptionCount,
      excludedCaptionCount: rows.length - outputCaptionCount,
      unknownClipCaptionCount: input.cues.length - rows.length,
      styleGroupCount: styleGroups.size,
      singletonStyleGroupCount: [...styleGroups.values()].filter(
        (group) => group.count === 1
      ).length,
      variationCaptionCount: variationCounts.any,
      variationCounts,
      commonOutline: normalizedOutline(input.defaults)
    }
  };
}
