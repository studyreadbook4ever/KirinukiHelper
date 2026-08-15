import type {
  EditorAudioRegion,
  EditorClip,
  EditorImageAsset,
  EditorProject,
  EditorSubtitleCue,
  SubtitleDefaultsRecord
} from "./editor-core.js";

export const SHORT_FORM_SCHEMA_VERSION = 7;
export const SHORT_FORM_SCHEMA = "kirinuki-short-form/v7";
export const LEGACY_SHORT_FORM_SCHEMA_V6 = "kirinuki-short-form/v6";
export const LEGACY_SHORT_FORM_SCHEMA_V5 = "kirinuki-short-form/v5";
export const LEGACY_SHORT_FORM_SCHEMA_V4 = "kirinuki-short-form/v4";
export const LEGACY_SHORT_FORM_SCHEMA_V3 = "kirinuki-short-form/v3";
export const LEGACY_SHORT_FORM_SCHEMA_V2 = "kirinuki-short-form/v2";
export const LEGACY_SHORT_FORM_SCHEMA = "kirinuki-short-form/v1";
export const SHORT_FORM_CANVAS_CLIP_ID = "short-form-canvas";
export const SHORT_FORM_OUTPUT_WIDTH = 1080;
export const SHORT_FORM_OUTPUT_HEIGHT = 1920;
export const SHORT_FORM_OUTPUT_ASPECT_RATIO =
  SHORT_FORM_OUTPUT_WIDTH / SHORT_FORM_OUTPUT_HEIGHT;
export const SHORT_FORM_MIN_ZOOM = 1;
export const SHORT_FORM_MAX_ZOOM = 3;
export const SHORT_FORM_MIN_CANVAS_SCALE = 0.25;
export const SHORT_FORM_MAX_CANVAS_SCALE = 2;
export const SHORT_FORM_MIN_CLIP_DURATION_MS = 100;
export const SHORT_FORM_DEFAULT_CANVAS_DURATION_MS = 3_000;
export const SHORT_FORM_MIN_VIDEO_LAYER_OPACITY = 0;
export const SHORT_FORM_MAX_VIDEO_LAYER_OPACITY = 1;
export const SHORT_FORM_MIN_VIDEO_LAYER_Z_INDEX = 0;
export const SHORT_FORM_MAX_VIDEO_LAYER_Z_INDEX = 1_000;
export const SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS = 9;
export const SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS = 64;
export const SHORT_FORM_MIN_VIDEO_LANES = 1;
export const SHORT_FORM_MAX_VIDEO_LANES = SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS;
export const SHORT_FORM_ACCIDENTAL_EDGE_GAP_MAX_PX = 24;
/** Compatibility name: v5 had one implicit base plus eight overlays. */
export const SHORT_FORM_MAX_ADDITIONAL_VIDEO_LAYERS = 8;
export const SHORT_FORM_PRIMARY_SOURCE_ASSET_ID = "project-primary" as const;
export const SHORT_FORM_WORKSPACES_SCHEMA =
  "kirinuki-short-form-workspaces/v1" as const;
export const LEGACY_SHORT_FORM_WORKSPACE_ID = "shorts-1" as const;
export const MAX_SHORT_FORM_WORKSPACES = 24;
export const MAX_SHORT_FORM_WORKSPACE_NAME_LENGTH = 80;

export type ShortFormFit = "cover" | "contain";
export type ShortFormCanvasEdge = "left" | "right" | "top" | "bottom";
export type ShortFormSqueegeeDirection = ShortFormCanvasEdge | "all";

export type ShortFormCompositeCanvasGapKind = "edge" | "seam" | "hole";

export interface ShortFormCompositeCanvasGapRepair {
  assetId: string;
  directions: ShortFormCanvasEdge[];
}

/**
 * A black region that remains after all visible video rectangles are
 * composited for one half-open timeline interval.
 */
export interface ShortFormCompositeCanvasGap {
  timelineStartMs: number;
  timelineEndMs: number;
  kind: ShortFormCompositeCanvasGapKind;
  rect: ShortFormDestinationRect;
  /** Narrow-axis width. This is always 1..24 for a reported finding. */
  thicknessPx: number;
  /** Canvas/asset edges that could be extended to cover this finding. */
  directions: ShortFormCanvasEdge[];
  relatedAssetIds: string[];
  repairs: ShortFormCompositeCanvasGapRepair[];
}

export interface ShortFormCanvasEdgeGap {
  edge: ShortFormCanvasEdge;
  pixels: number;
}

export interface ShortFormSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  referenceWidth: number;
  referenceHeight: number;
}

export interface ShortFormDestinationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShortFormVideoAsset {
  id: string;
  sourceAssetId: typeof SHORT_FORM_PRIMARY_SOURCE_ASSET_ID;
  sourceClipId: string;
  sourceSelectionStartMs: number;
  sourceSelectionEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  sourceRect: ShortFormSourceRect;
  destinationRect: ShortFormDestinationRect;
  opacity: number;
  visible: boolean;
  zIndex: number;
  /** Timeline row. Assets in one lane use non-overlapping half-open ranges. */
  lane: number;
  /** Embedded source-audio gain. 1 = original level, 2 = 200%. */
  audioGain: number;
  /** Exact-rect v6 renderers ignore this legacy framing metadata. */
  fit?: ShortFormFit;
  positionX?: number;
  positionY?: number;
  zoom?: number;
  canvasX?: number;
  canvasY?: number;
  canvasScale?: number;
}

export type ShortFormVideoAssetInput = Omit<
  ShortFormVideoAsset,
  | "id"
  | "sourceAssetId"
  | "opacity"
  | "visible"
  | "zIndex"
  | "lane"
  | "audioGain"
> & Partial<Pick<
  ShortFormVideoAsset,
  | "id"
  | "sourceAssetId"
  | "opacity"
  | "visible"
  | "zIndex"
  | "lane"
  | "audioGain"
>>;

export interface ShortFormSourceAudioAsset {
  id: string;
  sourceAssetId: typeof SHORT_FORM_PRIMARY_SOURCE_ASSET_ID;
  sourceClipId: string;
  sourceSelectionStartMs: number;
  sourceSelectionEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  gain: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export type ShortFormSourceAudioAssetInput = Omit<
  ShortFormSourceAudioAsset,
  "id" | "sourceAssetId" | "gain" | "muted" | "fadeInMs" | "fadeOutMs"
> & Partial<Pick<
  ShortFormSourceAudioAsset,
  "id" | "sourceAssetId" | "gain" | "muted" | "fadeInMs" | "fadeOutMs"
>>;

export interface ActiveShortFormVideoAsset extends ShortFormVideoAsset {
  sourceTimeMs: number;
}

/** v5 scene-local overlay shape, retained only for migration and old render helpers. */
export interface ShortFormVideoLayer {
  id: string;
  sourceAssetId: typeof SHORT_FORM_PRIMARY_SOURCE_ASSET_ID;
  sourceClipId: string;
  sourceSelectionStartMs: number;
  sourceSelectionEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  startOffsetMs: number;
  endOffsetMs: number;
  sourceRect: ShortFormSourceRect;
  destinationRect: ShortFormDestinationRect;
  opacity: number;
  visible: boolean;
  zIndex: number;
}

export type ShortFormVideoLayerInput = Omit<
  ShortFormVideoLayer,
  "id" | "sourceAssetId" | "opacity" | "visible" | "zIndex"
> & Partial<Pick<
  ShortFormVideoLayer,
  "id" | "sourceAssetId" | "opacity" | "visible" | "zIndex"
>>;

/** Compatibility view. New renderers use the uniform asset fields only. */
export interface ActiveShortFormVideoLayer extends ActiveShortFormVideoAsset {
  kind: "asset" | "base" | "additional";
  clipId: string;
}

export interface ShortFormSliceRequest {
  sourceClipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceRect: ShortFormSourceRect;
  destinationRect: ShortFormDestinationRect;
}

export interface ShortFormOutput {
  width: typeof SHORT_FORM_OUTPUT_WIDTH;
  height: typeof SHORT_FORM_OUTPUT_HEIGHT;
}

/** v5 migration input only. */
export interface ShortFormScene {
  clipId: string;
  sourceClipId: string;
  selectionId: string;
  fit: ShortFormFit;
  positionX: number;
  positionY: number;
  zoom: number;
  canvasX: number;
  canvasY: number;
  canvasScale: number;
  sourceRect?: ShortFormSourceRect;
  destinationRect?: ShortFormDestinationRect;
  videoLayers?: ShortFormVideoLayer[];
}

export interface EditorShortFormBranch {
  schema: typeof SHORT_FORM_SCHEMA;
  output: ShortFormOutput;
  durationMs: number;
  videoLaneCount: number;
  videoAssets: ShortFormVideoAsset[];
  sourceAudioAssets: ShortFormSourceAudioAsset[];
  subtitles: EditorSubtitleCue[];
  imageAssets: EditorImageAsset[];
  audioRegions: EditorAudioRegion[];
  subtitleLaneCount: number;
  recentSubtitleColors: string[];
  subtitleDefaults: SubtitleDefaultsRecord | null;
  ai: EditorProject["ai"] | null;
  suppressedSelections: EditorProject["suppressedSelections"];
  selectedClipId: typeof SHORT_FORM_CANVAS_CLIP_ID;
  selectedImageAssetId: string | null;
  selectedCueId: string | null;
  selectedAudioRegionId: string | null;
  selectedVideoLayerId: string | null;
  selectedSourceAudioAssetId: string | null;
  playheadMs: number;
  revision: number;
  /**
   * Non-enumerable, derived v5 compatibility views. They are available to an
   * in-memory caller during the v7 UI transition but never enter persisted
   * JSON and are never authoritative.
   */
  clips: EditorClip[];
  scenes: ShortFormScene[];
}

/**
 * One named, independently editable Shorts document under a long-form
 * project. `id` is the durable namespace for history, preview caches and an
 * export snapshot; the display name is never used as identity.
 */
export interface EditorShortFormWorkspace {
  id: string;
  name: string;
  shortForm: EditorShortFormBranch;
}

export interface EditorShortFormWorkspaceCollection {
  schema: typeof SHORT_FORM_WORKSPACES_SCHEMA;
  activeWorkspaceId: string;
  workspaces: EditorShortFormWorkspace[];
}

export interface ShortFormNormalizationContext {
  clips?: readonly EditorClip[];
  subtitles?: readonly EditorSubtitleCue[];
  imageAssets?: readonly EditorImageAsset[];
  audioRegions?: readonly EditorAudioRegion[];
  subtitleLaneCount?: number;
  recentSubtitleColors?: readonly string[];
  subtitleDefaults?: SubtitleDefaultsRecord | null;
  ai?: EditorProject["ai"] | null;
}

export class ShortFormVideoLayerLimitError extends Error {
  override readonly name = "ShortFormVideoLayerLimitError";
  readonly code = "SHORT_FORM_VIDEO_LAYER_LIMIT";

  constructor(limit: "active" | "total" = "active") {
    super(
      limit === "total"
        ? `쇼츠 영상 에셋은 한 프로젝트에 최대 ${SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS}개까지 추가할 수 있습니다.`
        : `한 시각에는 영상을 최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개까지 표시할 수 있습니다.`
    );
  }
}

export class UnsupportedShortFormSchemaError extends Error {
  override readonly name = "UnsupportedShortFormSchemaError";
  readonly code = "UNSUPPORTED_SHORT_FORM_SCHEMA";

  constructor(schema: string) {
    super(`이 버전의 Kirinuki가 지원하지 않는 쇼츠 프로젝트 형식입니다: ${schema}`);
  }
}

export class UnsupportedShortFormWorkspaceSchemaError extends Error {
  override readonly name = "UnsupportedShortFormWorkspaceSchemaError";
  readonly code = "UNSUPPORTED_SHORT_FORM_WORKSPACE_SCHEMA";

  constructor(schema: string) {
    super(`이 버전의 Kirinuki가 지원하지 않는 쇼츠 작업 묶음 형식입니다: ${schema}`);
  }
}

export class InvalidShortFormCompositeCanvasGapError extends Error {
  override readonly name = "InvalidShortFormCompositeCanvasGapError";
  readonly code = "INVALID_SHORT_FORM_COMPOSITE_CANVAS_GAP";

  constructor() {
    super("검은 틈 검사 결과가 오래되었거나 현재 쇼츠 캔버스와 일치하지 않습니다.");
  }
}

type DynamicRecord = Record<string, unknown>;

function recordOrNull(value: unknown): DynamicRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DynamicRecord
    : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function integer(value: unknown, fallback = 0): number {
  return Math.round(finiteNumber(value, fallback));
}

function nonEmptyString(value: unknown, fallback = ""): string {
  return String(value ?? "").trim() || fallback;
}

function uniqueId(preferred: unknown, prefix: string, used: Set<string>): string {
  const base = nonEmptyString(preferred, prefix).slice(0, 160) || prefix;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function fixedOutput(): ShortFormOutput {
  return { width: SHORT_FORM_OUTPUT_WIDTH, height: SHORT_FORM_OUTPUT_HEIGHT };
}

export function clampShortFormZoom(value: unknown, fallback = 1): number {
  return clamp(value, SHORT_FORM_MIN_ZOOM, SHORT_FORM_MAX_ZOOM, fallback);
}

export function clampShortFormCanvasScale(value: unknown, fallback = 1): number {
  return clamp(
    value,
    SHORT_FORM_MIN_CANVAS_SCALE,
    SHORT_FORM_MAX_CANVAS_SCALE,
    fallback
  );
}

export function normalizeShortFormSourceRect(value: unknown): ShortFormSourceRect | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  const rawX = Number(raw.x);
  const rawY = Number(raw.y);
  const rawWidth = Number(raw.width);
  const rawHeight = Number(raw.height);
  const rawReferenceWidth = Number(raw.referenceWidth);
  const rawReferenceHeight = Number(raw.referenceHeight);
  const referenceWidth = integer(clamp(rawReferenceWidth, 1, 65_535, 1));
  const referenceHeight = integer(clamp(rawReferenceHeight, 1, 65_535, 1));
  if (
    !Number.isFinite(rawReferenceWidth)
    || !Number.isFinite(rawReferenceHeight)
    || rawReferenceWidth <= 0
    || rawReferenceHeight <= 0
    || !Number.isFinite(rawX)
    || !Number.isFinite(rawY)
    || !Number.isFinite(rawWidth)
    || !Number.isFinite(rawHeight)
    || rawWidth <= 0
    || rawHeight <= 0
  ) {
    return null;
  }
  const minimumWidth = 1 / referenceWidth;
  const minimumHeight = 1 / referenceHeight;
  // Position is authoritative. Clamp it first, then constrain the extent to
  // the remaining frame. Doing this in the opposite order unexpectedly moves
  // an authored crop when only its width/height is out of range.
  const x = clamp(rawX, 0, 1 - minimumWidth, 0);
  const y = clamp(rawY, 0, 1 - minimumHeight, 0);
  const width = clamp(rawWidth, minimumWidth, 1 - x, 1 - x);
  const height = clamp(rawHeight, minimumHeight, 1 - y, 1 - y);
  return { x, y, width, height, referenceWidth, referenceHeight };
}

export function normalizeShortFormDestinationRect(
  value: unknown
): ShortFormDestinationRect | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  const rawX = Number(raw.x);
  const rawY = Number(raw.y);
  const rawWidth = Number(raw.width);
  const rawHeight = Number(raw.height);
  if (
    !Number.isFinite(rawX)
    || !Number.isFinite(rawY)
    || !Number.isFinite(rawWidth)
    || !Number.isFinite(rawHeight)
    || rawWidth <= 0
    || rawHeight <= 0
  ) {
    return null;
  }
  const width = integer(clamp(
    rawWidth,
    1,
    SHORT_FORM_OUTPUT_WIDTH * 8,
    SHORT_FORM_OUTPUT_WIDTH
  ));
  const height = integer(clamp(
    rawHeight,
    1,
    SHORT_FORM_OUTPUT_HEIGHT * 8,
    SHORT_FORM_OUTPUT_HEIGHT
  ));
  // Off-canvas placement is valid, but at least one canonical pixel remains
  // visible so a layer cannot become irrecoverable from the editor.
  const x = integer(clamp(rawX, -width + 1, SHORT_FORM_OUTPUT_WIDTH - 1, 0));
  const y = integer(clamp(rawY, -height + 1, SHORT_FORM_OUTPUT_HEIGHT - 1, 0));
  return { x, y, width, height };
}

function shortFormCanvasEdgeGaps(
  destinationRect: ShortFormDestinationRect
): Record<ShortFormCanvasEdge, number> | null {
  const { x, y, width, height } = destinationRect;
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || x >= SHORT_FORM_OUTPUT_WIDTH
    || y >= SHORT_FORM_OUTPUT_HEIGHT
    || x + width <= 0
    || y + height <= 0
  ) {
    return null;
  }
  return {
    left: Math.max(0, x),
    right: Math.max(0, SHORT_FORM_OUTPUT_WIDTH - (x + width)),
    top: Math.max(0, y),
    bottom: Math.max(0, SHORT_FORM_OUTPUT_HEIGHT - (y + height))
  };
}

/**
 * Finds small, likely accidental black seams around an otherwise full-canvas
 * video. A layer with any edge farther than the tolerance is treated as an
 * intentional composition and is not reported at all.
 */
export function detectShortFormCanvasEdgeGaps(
  asset: Pick<ShortFormVideoAsset, "destinationRect" | "opacity" | "visible">
): ShortFormCanvasEdgeGap[] {
  if (!asset.visible || asset.opacity <= 0) {
    return [];
  }
  const gaps = shortFormCanvasEdgeGaps(asset.destinationRect);
  if (
    !gaps
    || Object.values(gaps).some((gap) => (
      gap > SHORT_FORM_ACCIDENTAL_EDGE_GAP_MAX_PX
    ))
  ) {
    return [];
  }
  const edges: readonly ShortFormCanvasEdge[] = ["left", "right", "top", "bottom"];
  return edges.flatMap((edge) => {
    const pixels = gaps[edge];
    return pixels >= 1
      ? [{ edge, pixels }]
      : [];
  });
}

interface CompositeVideoRect {
  assetId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface CompositeUncoveredComponent {
  id: number;
  area: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface CompositeGapCandidate {
  componentId: number;
  orientation: "vertical" | "horizontal" | "hole";
  rect: ShortFormDestinationRect;
}

const SHORT_FORM_CANVAS_EDGE_ORDER: readonly ShortFormCanvasEdge[] = [
  "left",
  "right",
  "top",
  "bottom"
];

function clippedCompositeVideoRect(
  asset: Pick<ShortFormVideoAsset, "id" | "destinationRect">
): CompositeVideoRect | null {
  const { x, y, width, height } = asset.destinationRect;
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  const left = Math.max(0, Math.min(SHORT_FORM_OUTPUT_WIDTH, x));
  const right = Math.max(0, Math.min(SHORT_FORM_OUTPUT_WIDTH, x + width));
  const top = Math.max(0, Math.min(SHORT_FORM_OUTPUT_HEIGHT, y));
  const bottom = Math.max(0, Math.min(SHORT_FORM_OUTPUT_HEIGHT, y + height));
  return right > left && bottom > top
    ? { assetId: asset.id, left, right, top, bottom }
    : null;
}

function sortedUniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function compositeUncoveredGrid(rects: readonly CompositeVideoRect[]): {
  xs: number[];
  ys: number[];
  uncovered: boolean[][];
} {
  const xs = sortedUniqueNumbers([
    0,
    SHORT_FORM_OUTPUT_WIDTH,
    ...rects.flatMap(({ left, right }) => [left, right])
  ]);
  const ys = sortedUniqueNumbers([
    0,
    SHORT_FORM_OUTPUT_HEIGHT,
    ...rects.flatMap(({ top, bottom }) => [top, bottom])
  ]);
  const uncovered = Array.from({ length: ys.length - 1 }, (_, yIndex) => (
    Array.from({ length: xs.length - 1 }, (_, xIndex) => {
      const left = xs[xIndex]!;
      const right = xs[xIndex + 1]!;
      const top = ys[yIndex]!;
      const bottom = ys[yIndex + 1]!;
      return !rects.some((rect) => (
        rect.left <= left
        && rect.right >= right
        && rect.top <= top
        && rect.bottom >= bottom
      ));
    })
  ));
  return { xs, ys, uncovered };
}

function labelCompositeUncoveredComponents(
  xs: readonly number[],
  ys: readonly number[],
  uncovered: readonly (readonly boolean[])[]
): {
  labels: number[][];
  components: CompositeUncoveredComponent[];
  uncoveredArea: number;
} {
  const labels = uncovered.map((row) => row.map(() => -1));
  const components: CompositeUncoveredComponent[] = [];
  let uncoveredArea = 0;
  for (let yIndex = 0; yIndex < uncovered.length; yIndex += 1) {
    for (let xIndex = 0; xIndex < (uncovered[yIndex]?.length ?? 0); xIndex += 1) {
      if (!uncovered[yIndex]?.[xIndex] || labels[yIndex]?.[xIndex] !== -1) {
        continue;
      }
      const id = components.length;
      const queue: Array<readonly [number, number]> = [[xIndex, yIndex]];
      labels[yIndex]![xIndex] = id;
      let queueIndex = 0;
      let area = 0;
      let left = xs[xIndex]!;
      let right = xs[xIndex + 1]!;
      let top = ys[yIndex]!;
      let bottom = ys[yIndex + 1]!;
      while (queueIndex < queue.length) {
        const [currentX, currentY] = queue[queueIndex++]!;
        const cellLeft = xs[currentX]!;
        const cellRight = xs[currentX + 1]!;
        const cellTop = ys[currentY]!;
        const cellBottom = ys[currentY + 1]!;
        area += (cellRight - cellLeft) * (cellBottom - cellTop);
        left = Math.min(left, cellLeft);
        right = Math.max(right, cellRight);
        top = Math.min(top, cellTop);
        bottom = Math.max(bottom, cellBottom);
        const neighbours: ReadonlyArray<readonly [number, number]> = [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1]
        ];
        for (const [nextX, nextY] of neighbours) {
          if (
            nextY < 0
            || nextY >= uncovered.length
            || nextX < 0
            || nextX >= (uncovered[nextY]?.length ?? 0)
            || !uncovered[nextY]?.[nextX]
            || labels[nextY]?.[nextX] !== -1
          ) {
            continue;
          }
          labels[nextY]![nextX] = id;
          queue.push([nextX, nextY]);
        }
      }
      uncoveredArea += area;
      components.push({ id, area, left, right, top, bottom });
    }
  }
  return { labels, components, uncoveredArea };
}

function mergeCompositeGapBand(
  candidates: CompositeGapCandidate[],
  lastByKey: Map<string, number>,
  candidate: CompositeGapCandidate
): void {
  const { rect, componentId, orientation } = candidate;
  const key = orientation === "vertical"
    ? `${componentId}:${rect.x}:${rect.width}`
    : `${componentId}:${rect.y}:${rect.height}`;
  const previousIndex = lastByKey.get(key);
  const previous = previousIndex === undefined ? null : candidates[previousIndex];
  if (
    previous
    && (
      orientation === "vertical"
        ? previous.rect.y + previous.rect.height === rect.y
        : previous.rect.x + previous.rect.width === rect.x
    )
  ) {
    previous.rect = orientation === "vertical"
      ? { ...previous.rect, height: previous.rect.height + rect.height }
      : { ...previous.rect, width: previous.rect.width + rect.width };
    return;
  }
  candidates.push(candidate);
  lastByKey.set(key, candidates.length - 1);
}

function compositeGapCandidates(
  xs: readonly number[],
  ys: readonly number[],
  uncovered: readonly (readonly boolean[])[],
  labels: readonly (readonly number[])[],
  components: readonly CompositeUncoveredComponent[],
  uncoveredArea: number,
  rects: readonly CompositeVideoRect[]
): CompositeGapCandidate[] {
  const tolerance = SHORT_FORM_ACCIDENTAL_EDGE_GAP_MAX_PX;
  const canvasArea = SHORT_FORM_OUTPUT_WIDTH * SHORT_FORM_OUTPUT_HEIGHT;
  const insetWidth = Math.max(0, SHORT_FORM_OUTPUT_WIDTH - tolerance * 2);
  const insetHeight = Math.max(0, SHORT_FORM_OUTPUT_HEIGHT - tolerance * 2);
  const largestAccidentalFrameArea = canvasArea - insetWidth * insetHeight;
  const nearFullComposition = uncoveredArea > 0
    && uncoveredArea <= largestAccidentalFrameArea;
  const eligible = new Set(components.filter((component) => (
    nearFullComposition
    || component.right - component.left <= tolerance
    || component.bottom - component.top <= tolerance
  )).map(({ id }) => id));
  const tinyComponents = new Set<number>();
  const candidates: CompositeGapCandidate[] = [];
  const explicitEdgeCandidates = new Set<string>();
  if (nearFullComposition && rects.length > 0) {
    const outerLeft = Math.min(...rects.map(({ left }) => left));
    const outerRight = SHORT_FORM_OUTPUT_WIDTH
      - Math.max(...rects.map(({ right }) => right));
    const outerTop = Math.min(...rects.map(({ top }) => top));
    const outerBottom = SHORT_FORM_OUTPUT_HEIGHT
      - Math.max(...rects.map(({ bottom }) => bottom));
    const outerGaps: ReadonlyArray<readonly [
      ShortFormCanvasEdge,
      number,
      CompositeGapCandidate["orientation"],
      ShortFormDestinationRect
    ]> = [
      [
        "left",
        outerLeft,
        "vertical",
        {
          x: 0,
          y: outerTop,
          width: outerLeft,
          height: SHORT_FORM_OUTPUT_HEIGHT - outerTop - outerBottom
        }
      ],
      [
        "right",
        outerRight,
        "vertical",
        {
          x: SHORT_FORM_OUTPUT_WIDTH - outerRight,
          y: outerTop,
          width: outerRight,
          height: SHORT_FORM_OUTPUT_HEIGHT - outerTop - outerBottom
        }
      ],
      [
        "top",
        outerTop,
        "horizontal",
        {
          x: 0,
          y: 0,
          width: SHORT_FORM_OUTPUT_WIDTH,
          height: outerTop
        }
      ],
      [
        "bottom",
        outerBottom,
        "horizontal",
        {
          x: 0,
          y: SHORT_FORM_OUTPUT_HEIGHT - outerBottom,
          width: SHORT_FORM_OUTPUT_WIDTH,
          height: outerBottom
        }
      ]
    ];
    for (const [edge, pixels, orientation, rect] of outerGaps) {
      if (pixels < 1 || pixels > tolerance) {
        continue;
      }
      const xIndex = Math.max(0, xs.findIndex((x) => x >= rect.x + rect.width) - 1);
      const yIndex = Math.max(0, ys.findIndex((y) => y >= rect.y + rect.height) - 1);
      const componentId = labels[Math.min(yIndex, labels.length - 1)]?.[
        Math.min(xIndex, (labels[0]?.length ?? 1) - 1)
      ] ?? -1;
      if (componentId < 0) {
        continue;
      }
      explicitEdgeCandidates.add(edge);
      candidates.push({ componentId, orientation, rect });
    }
  }
  for (const component of components) {
    const width = component.right - component.left;
    const height = component.bottom - component.top;
    if (
      eligible.has(component.id)
      && width >= 1
      && height >= 1
      && width <= tolerance
      && height <= tolerance
    ) {
      tinyComponents.add(component.id);
      candidates.push({
        componentId: component.id,
        orientation: "hole",
        rect: { x: component.left, y: component.top, width, height }
      });
    }
  }

  const lastVerticalByKey = new Map<string, number>();
  for (let yIndex = 0; yIndex < uncovered.length; yIndex += 1) {
    let xIndex = 0;
    while (xIndex < (uncovered[yIndex]?.length ?? 0)) {
      if (!uncovered[yIndex]?.[xIndex]) {
        xIndex += 1;
        continue;
      }
      const startXIndex = xIndex;
      const componentId = labels[yIndex]?.[xIndex] ?? -1;
      while (
        xIndex < (uncovered[yIndex]?.length ?? 0)
        && uncovered[yIndex]?.[xIndex]
        && labels[yIndex]?.[xIndex] === componentId
      ) {
        xIndex += 1;
      }
      const left = xs[startXIndex]!;
      const right = xs[xIndex]!;
      if (
        eligible.has(componentId)
        && !tinyComponents.has(componentId)
        && right - left >= 1
        && right - left <= tolerance
        && !(left === 0 && explicitEdgeCandidates.has("left"))
        && !(
          right === SHORT_FORM_OUTPUT_WIDTH
          && explicitEdgeCandidates.has("right")
        )
      ) {
        mergeCompositeGapBand(candidates, lastVerticalByKey, {
          componentId,
          orientation: "vertical",
          rect: {
            x: left,
            y: ys[yIndex]!,
            width: right - left,
            height: ys[yIndex + 1]! - ys[yIndex]!
          }
        });
      }
    }
  }

  const lastHorizontalByKey = new Map<string, number>();
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    let yIndex = 0;
    while (yIndex < uncovered.length) {
      if (!uncovered[yIndex]?.[xIndex]) {
        yIndex += 1;
        continue;
      }
      const startYIndex = yIndex;
      const componentId = labels[yIndex]?.[xIndex] ?? -1;
      while (
        yIndex < uncovered.length
        && uncovered[yIndex]?.[xIndex]
        && labels[yIndex]?.[xIndex] === componentId
      ) {
        yIndex += 1;
      }
      const top = ys[startYIndex]!;
      const bottom = ys[yIndex]!;
      if (
        eligible.has(componentId)
        && !tinyComponents.has(componentId)
        && bottom - top >= 1
        && bottom - top <= tolerance
        && !(top === 0 && explicitEdgeCandidates.has("top"))
        && !(
          bottom === SHORT_FORM_OUTPUT_HEIGHT
          && explicitEdgeCandidates.has("bottom")
        )
      ) {
        mergeCompositeGapBand(candidates, lastHorizontalByKey, {
          componentId,
          orientation: "horizontal",
          rect: {
            x: xs[xIndex]!,
            y: top,
            width: xs[xIndex + 1]! - xs[xIndex]!,
            height: bottom - top
          }
        });
      }
    }
  }
  return candidates;
}

function positiveOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): boolean {
  return Math.min(firstEnd, secondEnd) > Math.max(firstStart, secondStart);
}

function compositeGapRepairs(
  rects: readonly CompositeVideoRect[],
  gap: ShortFormDestinationRect
): ShortFormCompositeCanvasGapRepair[] {
  const right = gap.x + gap.width;
  const bottom = gap.y + gap.height;
  return rects.flatMap((rect) => {
    const directions: ShortFormCanvasEdge[] = [];
    if (
      rect.left === right
      && positiveOverlap(rect.top, rect.bottom, gap.y, bottom)
    ) {
      directions.push("left");
    }
    if (
      rect.right === gap.x
      && positiveOverlap(rect.top, rect.bottom, gap.y, bottom)
    ) {
      directions.push("right");
    }
    if (
      rect.top === bottom
      && positiveOverlap(rect.left, rect.right, gap.x, right)
    ) {
      directions.push("top");
    }
    if (
      rect.bottom === gap.y
      && positiveOverlap(rect.left, rect.right, gap.x, right)
    ) {
      directions.push("bottom");
    }
    return directions.length > 0
      ? [{ assetId: rect.assetId, directions }]
      : [];
  });
}

function compositeGapKind(
  candidate: CompositeGapCandidate
): ShortFormCompositeCanvasGapKind {
  const { rect, orientation } = candidate;
  if (orientation === "hole") {
    return rect.x === 0
      || rect.y === 0
      || rect.x + rect.width === SHORT_FORM_OUTPUT_WIDTH
      || rect.y + rect.height === SHORT_FORM_OUTPUT_HEIGHT
      ? "edge"
      : "hole";
  }
  if (
    (orientation === "vertical" && (
      rect.x === 0 || rect.x + rect.width === SHORT_FORM_OUTPUT_WIDTH
    ))
    || (orientation === "horizontal" && (
      rect.y === 0 || rect.y + rect.height === SHORT_FORM_OUTPUT_HEIGHT
    ))
  ) {
    return "edge";
  }
  return "seam";
}

function findingsForCompositeInterval(
  timelineStartMs: number,
  timelineEndMs: number,
  rects: readonly CompositeVideoRect[]
): ShortFormCompositeCanvasGap[] {
  if (rects.length === 0) {
    return [];
  }
  const { xs, ys, uncovered } = compositeUncoveredGrid(rects);
  const { labels, components, uncoveredArea } = labelCompositeUncoveredComponents(
    xs,
    ys,
    uncovered
  );
  const candidates = compositeGapCandidates(
    xs,
    ys,
    uncovered,
    labels,
    components,
    uncoveredArea,
    rects
  );
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const { rect } = candidate;
    const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    const repairs = compositeGapRepairs(rects, rect);
    if (repairs.length === 0) {
      return [];
    }
    const directionSet = new Set(repairs.flatMap(({ directions }) => directions));
    const directions = SHORT_FORM_CANVAS_EDGE_ORDER.filter((edge) => (
      directionSet.has(edge)
    ));
    return [{
      timelineStartMs,
      timelineEndMs,
      kind: compositeGapKind(candidate),
      rect: { ...rect },
      thicknessPx: candidate.orientation === "horizontal"
        ? rect.height
        : candidate.orientation === "vertical"
          ? rect.width
          : Math.min(rect.width, rect.height),
      directions,
      relatedAssetIds: repairs.map(({ assetId }) => assetId),
      repairs
    }];
  }).sort((left, right) => (
    left.rect.y - right.rect.y
    || left.rect.x - right.rect.x
    || left.rect.height - right.rect.height
    || left.rect.width - right.rect.width
    || left.kind.localeCompare(right.kind)
  ));
}

/**
 * Analyzes the union of visible video rectangles, not individual layers.
 * Timeline endpoints partition the canvas into half-open intervals whose
 * active video set is constant. Large intentional black regions are ignored;
 * only isolated tiny holes and 1..24px strips/seams are returned.
 */
export function detectShortFormCompositeCanvasGaps(
  branch: Pick<EditorShortFormBranch, "durationMs" | "videoAssets">
): ShortFormCompositeCanvasGap[] {
  const durationMs = Number.isFinite(branch.durationMs)
    ? Math.max(0, branch.durationMs)
    : 0;
  if (durationMs <= 0) {
    return [];
  }
  const candidates = branch.videoAssets.flatMap((asset) => {
    if (
      !asset.visible
      || !Number.isFinite(asset.opacity)
      || asset.opacity <= 0
      || !Number.isFinite(asset.timelineStartMs)
      || !Number.isFinite(asset.timelineEndMs)
      || asset.timelineEndMs <= asset.timelineStartMs
    ) {
      return [];
    }
    const rect = clippedCompositeVideoRect(asset);
    return rect ? [{ asset, rect }] : [];
  });
  const endpoints = sortedUniqueNumbers([
    0,
    durationMs,
    ...candidates.flatMap(({ asset }) => [
      Math.max(0, Math.min(durationMs, asset.timelineStartMs)),
      Math.max(0, Math.min(durationMs, asset.timelineEndMs))
    ])
  ]);
  const findings: ShortFormCompositeCanvasGap[] = [];
  for (let index = 0; index < endpoints.length - 1; index += 1) {
    const timelineStartMs = endpoints[index]!;
    const timelineEndMs = endpoints[index + 1]!;
    if (timelineEndMs <= timelineStartMs) {
      continue;
    }
    const activeRects = candidates.flatMap(({ asset, rect }) => (
      asset.timelineStartMs < timelineEndMs && asset.timelineEndMs > timelineStartMs
        ? [rect]
        : []
    ));
    findings.push(...findingsForCompositeInterval(
      timelineStartMs,
      timelineEndMs,
      activeRects
    ));
  }
  return findings;
}

function sameOrderedStrings(
  left: readonly string[],
  right: unknown
): boolean {
  return Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameCompositeCanvasGapFinding(
  current: ShortFormCompositeCanvasGap,
  candidate: unknown
): boolean {
  const raw = recordOrNull(candidate);
  const rect = recordOrNull(raw?.rect);
  const repairs = raw?.repairs;
  if (
    !raw
    || !rect
    || raw.timelineStartMs !== current.timelineStartMs
    || raw.timelineEndMs !== current.timelineEndMs
    || raw.kind !== current.kind
    || rect.x !== current.rect.x
    || rect.y !== current.rect.y
    || rect.width !== current.rect.width
    || rect.height !== current.rect.height
    || raw.thicknessPx !== current.thicknessPx
    || !sameOrderedStrings(current.directions, raw.directions)
    || !sameOrderedStrings(current.relatedAssetIds, raw.relatedAssetIds)
    || !Array.isArray(repairs)
    || repairs.length !== current.repairs.length
  ) {
    return false;
  }
  return current.repairs.every((repair, index) => {
    const candidateRepair = recordOrNull(repairs[index]);
    return candidateRepair?.assetId === repair.assetId
      && sameOrderedStrings(repair.directions, candidateRepair.directions);
  });
}

function extendDestinationRectAcrossCompositeGap(
  destinationRect: ShortFormDestinationRect,
  gap: ShortFormDestinationRect,
  directions: readonly ShortFormCanvasEdge[]
): ShortFormDestinationRect {
  let left = destinationRect.x;
  let right = destinationRect.x + destinationRect.width;
  let top = destinationRect.y;
  let bottom = destinationRect.y + destinationRect.height;
  const gapRight = gap.x + gap.width;
  const gapBottom = gap.y + gap.height;
  for (const direction of directions) {
    switch (direction) {
      case "left":
        left = Math.min(left, gap.x);
        break;
      case "right":
        right = Math.max(right, gapRight);
        break;
      case "top":
        top = Math.min(top, gap.y);
        break;
      case "bottom":
        bottom = Math.max(bottom, gapBottom);
        break;
    }
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

/**
 * Applies one current detector finding atomically. The complete finding,
 * including its repair map, must still be present in a fresh detector run;
 * stale or caller-modified instructions fail closed.
 */
export function repairShortFormCompositeCanvasGap(
  branchValue: unknown,
  finding: ShortFormCompositeCanvasGap
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const currentFinding = detectShortFormCompositeCanvasGaps(previous).find((current) => (
    sameCompositeCanvasGapFinding(current, finding)
  ));
  if (!currentFinding) {
    throw new InvalidShortFormCompositeCanvasGapError();
  }
  const repairsByAssetId = new Map(currentFinding.repairs.map((repair) => (
    [repair.assetId, repair.directions] as const
  )));
  const videoAssets = previous.videoAssets.map((asset) => {
    const directions = repairsByAssetId.get(asset.id);
    if (!directions) {
      return asset;
    }
    return {
      ...asset,
      destinationRect: extendDestinationRectAcrossCompositeGap(
        asset.destinationRect,
        currentFinding.rect,
        directions
      )
    };
  });
  const repaired = normalizeShortFormBranch({
    ...previous,
    videoAssets,
    revision: nextRevision(previous)
  });
  if (detectShortFormCompositeCanvasGaps(repaired).some((current) => (
    current.timelineStartMs === currentFinding.timelineStartMs
    && current.timelineEndMs === currentFinding.timelineEndMs
    && current.rect.x === currentFinding.rect.x
    && current.rect.y === currentFinding.rect.y
    && current.rect.width === currentFinding.rect.width
    && current.rect.height === currentFinding.rect.height
  ))) {
    throw new InvalidShortFormCompositeCanvasGapError();
  }
  return repaired;
}

/**
 * Extends only detected accidental seams to the canonical 1080x1920 canvas
 * edge. Source crop geometry is deliberately left untouched.
 */
export function squeegeeShortFormVideoAsset(
  asset: ShortFormVideoAsset,
  direction: ShortFormSqueegeeDirection
): ShortFormVideoAsset {
  const detectedEdges = new Set(
    detectShortFormCanvasEdgeGaps(asset).map(({ edge }) => edge)
  );
  const shouldExtend = (edge: ShortFormCanvasEdge): boolean => (
    detectedEdges.has(edge) && (direction === "all" || direction === edge)
  );
  if (
    !shouldExtend("left")
    && !shouldExtend("right")
    && !shouldExtend("top")
    && !shouldExtend("bottom")
  ) {
    return asset;
  }

  const current = asset.destinationRect;
  const left = shouldExtend("left") ? 0 : current.x;
  const top = shouldExtend("top") ? 0 : current.y;
  const right = shouldExtend("right")
    ? SHORT_FORM_OUTPUT_WIDTH
    : current.x + current.width;
  const bottom = shouldExtend("bottom")
    ? SHORT_FORM_OUTPUT_HEIGHT
    : current.y + current.height;
  return {
    ...asset,
    destinationRect: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    }
  };
}

function defaultSourceRect(): ShortFormSourceRect {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    referenceWidth: 1920,
    referenceHeight: 1080
  };
}

function defaultDestinationRect(): ShortFormDestinationRect {
  return {
    x: 0,
    y: 0,
    width: SHORT_FORM_OUTPUT_WIDTH,
    height: SHORT_FORM_OUTPUT_HEIGHT
  };
}

function cloneSourceRect(value: ShortFormSourceRect): ShortFormSourceRect {
  return { ...value };
}

function cloneDestinationRect(value: ShortFormDestinationRect): ShortFormDestinationRect {
  return { ...value };
}

function sourceIdentity(
  raw: DynamicRecord,
  canvasDurationMs: number
): Omit<
  ShortFormVideoAsset,
  | "id"
  | "sourceRect"
  | "destinationRect"
  | "opacity"
  | "visible"
  | "zIndex"
  | "lane"
  | "audioGain"
> | null {
  const sourceClipId = nonEmptyString(raw.sourceClipId);
  if (
    raw.sourceAssetId !== undefined
    && raw.sourceAssetId !== SHORT_FORM_PRIMARY_SOURCE_ASSET_ID
  ) {
    return null;
  }
  const timelineStartMs = Math.max(0, integer(raw.timelineStartMs));
  const requestedTimelineEndMs = integer(raw.timelineEndMs);
  const sourceStartMs = Math.max(0, integer(raw.sourceStartMs));
  const requestedSourceEndMs = integer(raw.sourceEndMs);
  const availableTimelineMs = Math.max(0, canvasDurationMs - timelineStartMs);
  const durationMs = Math.min(
    requestedTimelineEndMs - timelineStartMs,
    requestedSourceEndMs - sourceStartMs,
    availableTimelineMs
  );
  if (!sourceClipId || durationMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
    return null;
  }
  const sourceSelectionStartMs = Math.min(
    sourceStartMs,
    Math.max(0, integer(raw.sourceSelectionStartMs, sourceStartMs))
  );
  const sourceSelectionEndMs = Math.max(
    sourceStartMs + durationMs,
    integer(raw.sourceSelectionEndMs, sourceStartMs + durationMs)
  );
  return {
    sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
    sourceClipId,
    sourceSelectionStartMs,
    sourceSelectionEndMs,
    sourceStartMs,
    sourceEndMs: sourceStartMs + durationMs,
    timelineStartMs,
    timelineEndMs: timelineStartMs + durationMs
  };
}

function sourceAudioIdentity(
  raw: DynamicRecord,
  canvasDurationMs: number
): Omit<
  ShortFormSourceAudioAsset,
  "id" | "gain" | "muted" | "fadeInMs" | "fadeOutMs"
> | null {
  return sourceIdentity(raw, canvasDurationMs);
}

function assertSourceBackedAssetUpdate(
  existing: ShortFormVideoAsset | ShortFormSourceAudioAsset,
  rawUpdate: DynamicRecord
): void {
  const exactTextFields = ["sourceAssetId", "sourceClipId"] as const;
  for (const field of exactTextFields) {
    if (
      Object.prototype.hasOwnProperty.call(rawUpdate, field)
      && nonEmptyString(rawUpdate[field]) !== existing[field]
    ) {
      throw new TypeError("쇼츠 에셋의 원본 anchor는 생성 뒤 바꿀 수 없습니다.");
    }
  }
  const exactSelectionFields = [
    "sourceSelectionStartMs",
    "sourceSelectionEndMs"
  ] as const;
  for (const field of exactSelectionFields) {
    if (
      Object.prototype.hasOwnProperty.call(rawUpdate, field)
      && integer(rawUpdate[field], existing[field]) !== existing[field]
    ) {
      throw new TypeError("쇼츠 에셋의 원본 선택 envelope는 생성 뒤 바꿀 수 없습니다.");
    }
  }
  const sourceStartMs = integer(rawUpdate.sourceStartMs, existing.sourceStartMs);
  const sourceEndMs = integer(rawUpdate.sourceEndMs, existing.sourceEndMs);
  if (
    sourceStartMs < existing.sourceSelectionStartMs
    || sourceEndMs > existing.sourceSelectionEndMs
  ) {
    throw new RangeError("쇼츠 에셋의 활성 원본 구간은 처음 선택한 범위 안에 있어야 합니다.");
  }
}

function cloneVideoAsset(asset: ShortFormVideoAsset): ShortFormVideoAsset {
  return {
    ...asset,
    sourceRect: cloneSourceRect(asset.sourceRect),
    destinationRect: cloneDestinationRect(asset.destinationRect)
  };
}

function cloneSourceAudioAsset(
  asset: ShortFormSourceAudioAsset
): ShortFormSourceAudioAsset {
  return { ...asset };
}

/**
 * v6 originally persisted a second source-audio record beside each video.
 * Treat an exact historical twin as settings attached to that A/V asset, not
 * as independently editable media. Truly independent legacy audio keeps its
 * old behavior because any source or timeline difference makes this false.
 */
function sourceAudioExactlyMatchesVideo(
  audio: ShortFormSourceAudioAsset,
  video: ShortFormVideoAsset
): boolean {
  return audio.sourceAssetId === video.sourceAssetId
    && audio.sourceClipId === video.sourceClipId
    && audio.sourceStartMs === video.sourceStartMs
    && audio.sourceEndMs === video.sourceEndMs
    && audio.timelineStartMs === video.timelineStartMs
    && audio.timelineEndMs === video.timelineEndMs;
}

function sourceAudioFollowingVideo(
  audio: ShortFormSourceAudioAsset,
  video: ShortFormVideoAsset
): ShortFormSourceAudioAsset {
  return {
    ...audio,
    sourceAssetId: video.sourceAssetId,
    sourceClipId: video.sourceClipId,
    sourceSelectionStartMs: video.sourceSelectionStartMs,
    sourceSelectionEndMs: video.sourceSelectionEndMs,
    sourceStartMs: video.sourceStartMs,
    sourceEndMs: video.sourceEndMs,
    timelineStartMs: video.timelineStartMs,
    timelineEndMs: video.timelineEndMs,
    fadeInMs: Math.min(
      audio.fadeInMs,
      video.timelineEndMs - video.timelineStartMs
    ),
    fadeOutMs: Math.min(
      audio.fadeOutMs,
      video.timelineEndMs - video.timelineStartMs
    )
  };
}

function normalizeVideoAsset(
  value: unknown,
  canvasDurationMs: number,
  usedIds: Set<string>,
  index: number,
  videoLaneCount: number,
  fallbackLane = 0
): ShortFormVideoAsset | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  const source = sourceIdentity(raw, canvasDurationMs);
  const sourceRect = normalizeShortFormSourceRect(raw.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(raw.destinationRect);
  if (!source || !sourceRect || !destinationRect) {
    return null;
  }
  const fit: ShortFormFit = raw.fit === "contain" ? "contain" : "cover";
  return {
    id: uniqueId(raw.id, `short-video-${index + 1}`, usedIds),
    ...source,
    sourceRect,
    destinationRect,
    opacity: clamp(raw.opacity, 0, 1, 1),
    visible: raw.visible !== false,
    lane: integer(clamp(
      raw.lane,
      0,
      Math.max(0, videoLaneCount - 1),
      fallbackLane
    )),
    audioGain: clamp(raw.audioGain, 0, 2, 1),
    zIndex: integer(
      clamp(
        raw.zIndex,
        SHORT_FORM_MIN_VIDEO_LAYER_Z_INDEX,
        SHORT_FORM_MAX_VIDEO_LAYER_Z_INDEX,
        index
      )
    ),
    ...(raw.fit !== undefined
      ? {
        fit,
        positionX: fit === "contain" ? 0.5 : clamp(raw.positionX, 0, 1, 0.5),
        positionY: fit === "contain" ? 0.5 : clamp(raw.positionY, 0, 1, 0.5),
        zoom: fit === "contain" ? 1 : clampShortFormZoom(raw.zoom),
        canvasX: clamp(raw.canvasX, 0, 1, 0.5),
        canvasY: clamp(raw.canvasY, 0, 1, 0.5),
        canvasScale: clampShortFormCanvasScale(raw.canvasScale)
      }
      : {})
  };
}

function shortFormVideoRangesOverlap(
  left: Pick<ShortFormVideoAsset, "timelineStartMs" | "timelineEndMs">,
  right: Pick<ShortFormVideoAsset, "timelineStartMs" | "timelineEndMs">
): boolean {
  return left.timelineStartMs < right.timelineEndMs
    && left.timelineEndMs > right.timelineStartMs;
}

function shortFormVideoLaneAvailable(
  assets: readonly Pick<
    ShortFormVideoAsset,
    "id" | "lane" | "timelineStartMs" | "timelineEndMs"
  >[],
  lane: number,
  startMs: number,
  endMs: number,
  ignoredAssetId = ""
): boolean {
  return !assets.some((asset) => (
    asset.id !== ignoredAssetId
    && asset.lane === lane
    && shortFormVideoRangesOverlap(asset, {
      timelineStartMs: startMs,
      timelineEndMs: endMs
    })
  ));
}

function firstAvailableShortFormVideoLane(
  assets: readonly Pick<
    ShortFormVideoAsset,
    "id" | "lane" | "timelineStartMs" | "timelineEndMs"
  >[],
  startMs: number,
  endMs: number,
  laneCount: number,
  ignoredAssetId = ""
): number | null {
  for (let lane = 0; lane < laneCount; lane += 1) {
    if (shortFormVideoLaneAvailable(
      assets,
      lane,
      startMs,
      endMs,
      ignoredAssetId
    )) {
      return lane;
    }
  }
  return null;
}

function canInsertVideoAsset(
  assets: readonly ShortFormVideoAsset[],
  candidate: Pick<
    ShortFormVideoAsset,
    "id" | "lane" | "timelineStartMs" | "timelineEndMs"
  >,
  videoLaneCount: number
): boolean {
  if (assets.length >= SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS) {
    return false;
  }
  return Number.isSafeInteger(candidate.lane)
    && candidate.lane >= 0
    && candidate.lane < videoLaneCount
    && shortFormVideoLaneAvailable(
      assets,
      candidate.lane,
      candidate.timelineStartMs,
      candidate.timelineEndMs,
      candidate.id
    );
}

function normalizedVideoLaneCount(value: unknown): number {
  return integer(clamp(
    value,
    SHORT_FORM_MIN_VIDEO_LANES,
    SHORT_FORM_MAX_VIDEO_LANES,
    SHORT_FORM_MIN_VIDEO_LANES
  ));
}

function normalizedStandaloneVideoLaneCount(value: unknown): number {
  return integer(clamp(
    value,
    SHORT_FORM_MIN_VIDEO_LANES,
    SHORT_FORM_MAX_VIDEO_LANES,
    SHORT_FORM_MAX_VIDEO_LANES
  ));
}

function validPersistedVideoLane(value: unknown, videoLaneCount: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value < videoLaneCount;
}

export function normalizeShortFormVideoAssets(
  value: unknown,
  canvasDurationMsValue: unknown = SHORT_FORM_DEFAULT_CANVAS_DURATION_MS,
  videoLaneCountValue: unknown = SHORT_FORM_MAX_VIDEO_LANES
): ShortFormVideoAsset[] {
  const canvasDurationMs = Math.max(
    SHORT_FORM_MIN_CLIP_DURATION_MS,
    integer(canvasDurationMsValue, SHORT_FORM_DEFAULT_CANVAS_DURATION_MS)
  );
  const videoLaneCount = normalizedStandaloneVideoLaneCount(videoLaneCountValue);
  const usedIds = new Set<string>();
  const normalized: ShortFormVideoAsset[] = [];
  for (const [index, rawValue] of (Array.isArray(value) ? value : []).entries()) {
    const raw = recordOrNull(rawValue);
    let asset = normalizeVideoAsset(
      rawValue,
      canvasDurationMs,
      usedIds,
      index,
      videoLaneCount
    );
    if (!asset) {
      continue;
    }
    if (!validPersistedVideoLane(raw?.lane, videoLaneCount)) {
      const assignedLane = firstAvailableShortFormVideoLane(
        normalized,
        asset.timelineStartMs,
        asset.timelineEndMs,
        videoLaneCount
      );
      if (assignedLane === null) {
        continue;
      }
      asset = { ...asset, lane: assignedLane };
    }
    if (!canInsertVideoAsset(normalized, asset, videoLaneCount)) {
      continue;
    }
    normalized.push(asset);
  }
  return normalized.sort((left, right) => (
    left.zIndex - right.zIndex
    || left.timelineStartMs - right.timelineStartMs
    || left.id.localeCompare(right.id)
  ));
}

/*
 * A video lane is an editing row, not a visibility optimization. Hidden and
 * transparent assets continue to reserve their authored time so revealing an
 * asset cannot silently create a same-row collision.
 */
function availableShortFormVideoLaneForRange(
  assets: readonly ShortFormVideoAsset[],
  startMs: number,
  endMs: number,
  videoLaneCount: number
): number | null {
  return firstAvailableShortFormVideoLane(
    assets,
    startMs,
    endMs,
    videoLaneCount
  );
}

function normalizeSourceAudioAsset(
  value: unknown,
  canvasDurationMs: number,
  usedIds: Set<string>,
  index: number
): ShortFormSourceAudioAsset | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  const source = sourceAudioIdentity(raw, canvasDurationMs);
  if (!source) {
    return null;
  }
  const durationMs = source.timelineEndMs - source.timelineStartMs;
  return {
    id: uniqueId(raw.id, `short-source-audio-${index + 1}`, usedIds),
    ...source,
    gain: clamp(raw.gain, 0, 1, 1),
    muted: raw.muted === true,
    fadeInMs: integer(clamp(raw.fadeInMs, 0, durationMs, 0)),
    fadeOutMs: integer(clamp(raw.fadeOutMs, 0, durationMs, 0))
  };
}

export function normalizeShortFormSourceAudioAssets(
  value: unknown,
  canvasDurationMsValue: unknown = SHORT_FORM_DEFAULT_CANVAS_DURATION_MS
): ShortFormSourceAudioAsset[] {
  const canvasDurationMs = Math.max(
    SHORT_FORM_MIN_CLIP_DURATION_MS,
    integer(canvasDurationMsValue, SHORT_FORM_DEFAULT_CANVAS_DURATION_MS)
  );
  const usedIds = new Set<string>();
  const normalized: ShortFormSourceAudioAsset[] = [];
  for (const [index, raw] of (Array.isArray(value) ? value : []).entries()) {
    const asset = normalizeSourceAudioAsset(raw, canvasDurationMs, usedIds, index);
    if (!asset || normalized.some((candidate) => (
      candidate.timelineStartMs < asset.timelineEndMs
      && candidate.timelineEndMs > asset.timelineStartMs
    ))) {
      continue;
    }
    normalized.push(asset);
  }
  return normalized.sort((left, right) => (
    left.timelineStartMs - right.timelineStartMs
    || left.timelineEndMs - right.timelineEndMs
    || left.id.localeCompare(right.id)
  ));
}

function legacyLayer(
  value: unknown,
  clipDurationMs: number,
  usedIds: Set<string>,
  index: number
): ShortFormVideoLayer | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  if (
    raw.sourceAssetId !== undefined
    && raw.sourceAssetId !== SHORT_FORM_PRIMARY_SOURCE_ASSET_ID
  ) {
    return null;
  }
  const startOffsetMs = Math.max(0, integer(raw.startOffsetMs));
  const requestedEndOffsetMs = integer(raw.endOffsetMs);
  const sourceStartMs = Math.max(0, integer(raw.sourceStartMs));
  const requestedSourceEndMs = integer(raw.sourceEndMs);
  const durationMs = Math.min(
    requestedEndOffsetMs - startOffsetMs,
    requestedSourceEndMs - sourceStartMs,
    clipDurationMs - startOffsetMs
  );
  const sourceRect = normalizeShortFormSourceRect(raw.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(raw.destinationRect);
  const sourceClipId = nonEmptyString(raw.sourceClipId);
  if (
    durationMs < SHORT_FORM_MIN_CLIP_DURATION_MS
    || !sourceClipId
    || !sourceRect
    || !destinationRect
  ) {
    return null;
  }
  return {
    id: uniqueId(raw.id, `legacy-short-video-${index + 1}`, usedIds),
    sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
    sourceClipId,
    sourceSelectionStartMs: Math.min(
      sourceStartMs,
      Math.max(0, integer(raw.sourceSelectionStartMs, sourceStartMs))
    ),
    sourceSelectionEndMs: Math.max(
      sourceStartMs + durationMs,
      integer(raw.sourceSelectionEndMs, sourceStartMs + durationMs)
    ),
    sourceStartMs,
    sourceEndMs: sourceStartMs + durationMs,
    startOffsetMs,
    endOffsetMs: startOffsetMs + durationMs,
    sourceRect,
    destinationRect,
    opacity: clamp(raw.opacity, 0, 1, 1),
    visible: raw.visible !== false,
    zIndex: integer(clamp(raw.zIndex, 1, SHORT_FORM_MAX_VIDEO_LAYER_Z_INDEX, index + 1))
  };
}

export function normalizeShortFormVideoLayers(
  value: unknown,
  clipDurationMsValue: unknown
): ShortFormVideoLayer[] {
  const clipDurationMs = Math.max(0, integer(clipDurationMsValue));
  const usedIds = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .slice(0, SHORT_FORM_MAX_ADDITIONAL_VIDEO_LAYERS)
    .map((raw, index) => legacyLayer(raw, clipDurationMs, usedIds, index))
    .filter((asset): asset is ShortFormVideoLayer => Boolean(asset));
}

export function shortFormBaseVideoLayerId(clipIdValue: unknown): string {
  return `short-video-base-${nonEmptyString(clipIdValue, "unknown")}`;
}

function shortClipDuration(clip: EditorClip | null | undefined): number {
  return Math.max(0, integer(clip?.sourceEndMs) - integer(clip?.sourceStartMs));
}

function reflowLegacyClips(value: unknown): EditorClip[] {
  const used = new Set<string>();
  let timelineStartMs = 0;
  const result: EditorClip[] = [];
  for (const [index, item] of (Array.isArray(value) ? value : []).entries()) {
    const raw = recordOrNull(item);
    if (!raw || raw.enabled === false) {
      continue;
    }
    const sourceStartMs = Math.max(0, integer(raw.sourceStartMs));
    const sourceEndMs = integer(raw.sourceEndMs);
    if (sourceEndMs - sourceStartMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
      continue;
    }
    const id = uniqueId(raw.id, `legacy-short-clip-${index + 1}`, used);
    const selectionId = nonEmptyString(raw.selectionId, id);
    const clip: EditorClip = {
      ...raw,
      id,
      selectionId,
      sourceStartMs,
      sourceEndMs,
      selectionStartMs: Math.min(
        sourceStartMs,
        Math.max(0, integer(raw.selectionStartMs, sourceStartMs))
      ),
      selectionEndMs: Math.max(
        sourceEndMs,
        integer(raw.selectionEndMs, sourceEndMs)
      ),
      timelineStartMs,
      enabled: true
    };
    result.push(clip);
    timelineStartMs += shortClipDuration(clip);
  }
  return result;
}

function normalizationContext(
  value: readonly EditorClip[] | ShortFormNormalizationContext
): ShortFormNormalizationContext {
  return Array.isArray(value)
    ? { clips: value as readonly EditorClip[] }
    : value as ShortFormNormalizationContext;
}

function cloneSubtitleDefaults(
  value: SubtitleDefaultsRecord | null | undefined
): SubtitleDefaultsRecord | null {
  return value && typeof value === "object" ? { ...value } : null;
}

function cloneAi(value: EditorProject["ai"] | null | undefined): EditorProject["ai"] | null {
  return value && typeof value === "object"
    ? structuredClone(value)
    : null;
}

function normalizeSubtitleCues(
  value: unknown,
  durationMs: number,
  laneCount: number
): EditorSubtitleCue[] {
  const used = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap((item, index) => {
    const raw = recordOrNull(item);
    if (!raw) {
      return [];
    }
    const startOffsetMs = Math.max(0, integer(raw.startOffsetMs));
    const endOffsetMs = Math.min(durationMs, integer(raw.endOffsetMs));
    if (endOffsetMs - startOffsetMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
      return [];
    }
    const cue: EditorSubtitleCue = {
      ...raw,
      id: uniqueId(raw.id, `short-cue-${index + 1}`, used),
      clipId: SHORT_FORM_CANVAS_CLIP_ID,
      startOffsetMs,
      endOffsetMs,
      text: String(raw.text ?? ""),
      lane: integer(clamp(raw.lane, 0, laneCount - 1, 0)),
      origin: nonEmptyString(raw.origin, "human"),
      humanEdited: raw.humanEdited !== false,
      x: clamp(raw.x, 0, 1, 0.5),
      y: clamp(raw.y, 0, 1, 0.84),
      color: nonEmptyString(raw.color, "#FFFFFF"),
      confidence: typeof raw.confidence === "number"
        && Number.isFinite(raw.confidence)
        ? clamp(raw.confidence, 0, 1, 0)
        : null
    };
    return [cue];
  });
}

function normalizeImageAssets(
  value: unknown,
  durationMs: number
): EditorImageAsset[] {
  const used = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap((item, index) => {
    const raw = recordOrNull(item);
    if (!raw) {
      return [];
    }
    const startOffsetMs = Math.max(0, integer(raw.startOffsetMs));
    const endOffsetMs = Math.min(durationMs, integer(raw.endOffsetMs));
    if (endOffsetMs - startOffsetMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
      return [];
    }
    return [{
      ...raw,
      id: uniqueId(raw.id, `short-image-${index + 1}`, used),
      clipId: SHORT_FORM_CANVAS_CLIP_ID,
      startOffsetMs,
      endOffsetMs,
      name: nonEmptyString(raw.name, `이미지 ${index + 1}`),
      mimeType: nonEmptyString(raw.mimeType, "image/png"),
      source: (raw.source || "blob") as EditorImageAsset["source"],
      sourceUrl: String(raw.sourceUrl || ""),
      x: clamp(raw.x, 0, 1, 0.5),
      y: clamp(raw.y, 0, 1, 0.5),
      scale: clamp(raw.scale, 0.05, 5, 1),
      opacity: clamp(raw.opacity, 0, 1, 1),
      naturalWidth: Number.isFinite(Number(raw.naturalWidth))
        ? Math.max(1, integer(raw.naturalWidth))
        : null,
      naturalHeight: Number.isFinite(Number(raw.naturalHeight))
        ? Math.max(1, integer(raw.naturalHeight))
        : null
    } satisfies EditorImageAsset];
  });
}

function normalizeAudioRegions(
  value: unknown,
  durationMs: number
): EditorAudioRegion[] {
  const used = new Set<string>();
  const normalized: EditorAudioRegion[] = [];
  for (const [index, item] of (Array.isArray(value) ? value : []).entries()) {
    const raw = recordOrNull(item);
    if (!raw) {
      continue;
    }
    const startOffsetMs = Math.max(0, integer(raw.startOffsetMs));
    const endOffsetMs = Math.min(durationMs, integer(raw.endOffsetMs));
    const regionDurationMs = endOffsetMs - startOffsetMs;
    if (
      regionDurationMs < SHORT_FORM_MIN_CLIP_DURATION_MS
      || normalized.some((candidate) => (
        candidate.startOffsetMs < endOffsetMs
        && candidate.endOffsetMs > startOffsetMs
      ))
    ) {
      continue;
    }
    normalized.push({
      ...raw,
      id: uniqueId(raw.id, `short-audio-region-${index + 1}`, used),
      clipId: SHORT_FORM_CANVAS_CLIP_ID,
      startOffsetMs,
      endOffsetMs,
      gain: clamp(raw.gain, 0, 1, 1),
      muted: raw.muted === true,
      fadeInMs: integer(clamp(raw.fadeInMs, 0, regionDurationMs, 0)),
      fadeOutMs: integer(clamp(raw.fadeOutMs, 0, regionDurationMs, 0))
    });
  }
  return normalized;
}

function timedEndMs(value: unknown): number {
  return (Array.isArray(value) ? value : []).reduce((maximum, item) => {
    const raw = recordOrNull(item);
    return Math.max(maximum, integer(raw?.endOffsetMs));
  }, 0);
}

function legacySceneRects(scene: DynamicRecord | null): {
  sourceRect: ShortFormSourceRect;
  destinationRect: ShortFormDestinationRect;
} {
  return {
    sourceRect: normalizeShortFormSourceRect(scene?.sourceRect) || defaultSourceRect(),
    destinationRect: normalizeShortFormDestinationRect(scene?.destinationRect)
      || defaultDestinationRect()
  };
}

function legacyClipsForMigration(
  source: DynamicRecord,
  context: ShortFormNormalizationContext
): EditorClip[] {
  const own = reflowLegacyClips(source.clips);
  if (own.length > 0) {
    return own;
  }
  const scenes = (Array.isArray(source.scenes) ? source.scenes : [])
    .map(recordOrNull)
    .filter((scene): scene is DynamicRecord => Boolean(scene));
  if (scenes.length === 0) {
    return [];
  }
  const contextClips = context.clips || [];
  const requested = scenes.flatMap((scene) => {
    const selectionId = nonEmptyString(scene.selectionId);
    const clipId = nonEmptyString(scene.clipId);
    const match = contextClips.find((clip) => (
      clip.id === clipId || clip.selectionId === selectionId
    ));
    return match ? [{ ...match }] : [];
  });
  return reflowLegacyClips(requested);
}

function absoluteLegacyTimedItems(
  value: unknown,
  clips: readonly EditorClip[]
): DynamicRecord[] {
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const raw = recordOrNull(item);
    const clip = raw ? byId.get(nonEmptyString(raw.clipId)) : null;
    if (!raw || !clip) {
      return [];
    }
    return [{
      ...raw,
      clipId: SHORT_FORM_CANVAS_CLIP_ID,
      startOffsetMs: clip.timelineStartMs + integer(raw.startOffsetMs),
      endOffsetMs: clip.timelineStartMs + integer(raw.endOffsetMs)
    }];
  });
}

/**
 * v6 allowed up to nine simultaneously active videos but had no authored
 * timeline rows. Assign them deterministically with interval-partitioning:
 * chronological assets take the lowest lane whose previous half-open range
 * has ended. Array order is only the final tie-breaker for malformed duplicate
 * identities, so reopening the same document always yields the same rows.
 */
function migrateV6Branch(source: DynamicRecord): DynamicRecord {
  const rawVideoAssets = Array.isArray(source.videoAssets)
    ? source.videoAssets
    : [];
  const canvasDurationMs = Math.max(
    SHORT_FORM_MIN_CLIP_DURATION_MS,
    integer(source.durationMs, SHORT_FORM_DEFAULT_CANVAS_DURATION_MS)
  );
  const candidates = rawVideoAssets.flatMap((value, index) => {
    const raw = recordOrNull(value);
    const normalized = normalizeVideoAsset(
      value,
      canvasDurationMs,
      new Set<string>(),
      index,
      SHORT_FORM_MAX_VIDEO_LANES
    );
    if (!raw || !normalized) {
      return [];
    }
    return [{
      index,
      timelineStartMs: normalized.timelineStartMs,
      timelineEndMs: normalized.timelineEndMs,
      zIndex: normalized.zIndex,
      id: normalized.id
    }];
  }).sort((left, right) => (
    left.timelineStartMs - right.timelineStartMs
    || left.timelineEndMs - right.timelineEndMs
    || left.zIndex - right.zIndex
    || left.id.localeCompare(right.id)
    || left.index - right.index
  ));
  const assignedLanes = new Map<number, number>();
  const laneEndMs: number[] = [];
  for (const candidate of candidates) {
    let lane = laneEndMs.findIndex((endMs) => (
      endMs <= candidate.timelineStartMs
    ));
    if (lane < 0 && laneEndMs.length < SHORT_FORM_MAX_VIDEO_LANES) {
      lane = laneEndMs.length;
      laneEndMs.push(candidate.timelineEndMs);
    } else if (lane >= 0) {
      laneEndMs[lane] = candidate.timelineEndMs;
    } else {
      // A valid v6 document never exceeds nine visible concurrent videos.
      // Keep corrupt overflow deterministic; v7 normalization drops its
      // same-lane collision instead of inventing a tenth unsupported row.
      lane = SHORT_FORM_MAX_VIDEO_LANES - 1;
    }
    assignedLanes.set(candidate.index, lane);
  }
  return {
    ...source,
    schema: SHORT_FORM_SCHEMA,
    videoLaneCount: Math.max(
      SHORT_FORM_MIN_VIDEO_LANES,
      Math.min(SHORT_FORM_MAX_VIDEO_LANES, laneEndMs.length)
    ),
    videoAssets: rawVideoAssets.map((value, index) => {
      const raw = recordOrNull(value);
      return raw
        ? {
          ...raw,
          lane: assignedLanes.get(index) ?? 0,
          audioGain: 1
        }
        : value;
    })
  };
}

function migrateLegacyBranch(
  source: DynamicRecord,
  context: ShortFormNormalizationContext
): DynamicRecord {
  const clips = legacyClipsForMigration(source, context);
  const durationMs = clips.reduce((total, clip) => total + shortClipDuration(clip), 0)
    || SHORT_FORM_DEFAULT_CANVAS_DURATION_MS;
  const rawScenes = (Array.isArray(source.scenes) ? source.scenes : [])
    .map(recordOrNull)
    .filter((scene): scene is DynamicRecord => Boolean(scene));
  const scenesByClipId = new Map(
    rawScenes.map((scene) => [nonEmptyString(scene.clipId), scene])
  );
  const videoAssets: ShortFormVideoAsset[] = [];
  const sourceAudioAssets: ShortFormSourceAudioAsset[] = [];
  for (const [clipIndex, clip] of clips.entries()) {
    const scene = scenesByClipId.get(clip.id)
      || rawScenes.find((candidate) => (
        nonEmptyString(candidate.selectionId) === clip.selectionId
      ))
      || null;
    const rects = legacySceneRects(scene);
    const sourceClipId = nonEmptyString(
      scene?.sourceClipId || clip.shortFormSourceClipId,
      clip.id
    );
    const baseId = shortFormBaseVideoLayerId(clip.id);
    const fit: ShortFormFit = scene?.fit === "contain" ? "contain" : "cover";
    videoAssets.push({
      id: baseId,
      sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
      sourceClipId,
      sourceSelectionStartMs: integer(
        clip.shortFormSelectionStartMs,
        clip.selectionStartMs
      ),
      sourceSelectionEndMs: integer(
        clip.shortFormSelectionEndMs,
        clip.selectionEndMs
      ),
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: clip.sourceEndMs,
      timelineStartMs: clip.timelineStartMs,
      timelineEndMs: clip.timelineStartMs + shortClipDuration(clip),
      sourceRect: rects.sourceRect,
      destinationRect: rects.destinationRect,
      opacity: 1,
      visible: true,
      lane: 0,
      audioGain: 1,
      zIndex: 0,
      fit,
      positionX: fit === "contain" ? 0.5 : clamp(scene?.positionX, 0, 1, 0.5),
      positionY: fit === "contain" ? 0.5 : clamp(scene?.positionY, 0, 1, 0.5),
      zoom: fit === "contain" ? 1 : clampShortFormZoom(scene?.zoom),
      canvasX: clamp(scene?.canvasX, 0, 1, 0.5),
      canvasY: clamp(scene?.canvasY, 0, 1, 0.5),
      canvasScale: clampShortFormCanvasScale(scene?.canvasScale)
    });
    sourceAudioAssets.push({
      id: `short-source-audio-${clip.id}`,
      sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
      sourceClipId,
      sourceSelectionStartMs: integer(
        clip.shortFormSelectionStartMs,
        clip.selectionStartMs
      ),
      sourceSelectionEndMs: integer(
        clip.shortFormSelectionEndMs,
        clip.selectionEndMs
      ),
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: clip.sourceEndMs,
      timelineStartMs: clip.timelineStartMs,
      timelineEndMs: clip.timelineStartMs + shortClipDuration(clip),
      gain: 1,
      muted: false,
      fadeInMs: 0,
      fadeOutMs: 0
    });
    const legacyLayers = normalizeShortFormVideoLayers(
      scene?.videoLayers,
      shortClipDuration(clip)
    );
    for (const layer of legacyLayers) {
      videoAssets.push({
        id: layer.id,
        sourceAssetId: layer.sourceAssetId,
        sourceClipId: layer.sourceClipId,
        sourceSelectionStartMs: layer.sourceSelectionStartMs,
        sourceSelectionEndMs: layer.sourceSelectionEndMs,
        sourceStartMs: layer.sourceStartMs,
        sourceEndMs: layer.sourceEndMs,
        timelineStartMs: clip.timelineStartMs + layer.startOffsetMs,
        timelineEndMs: clip.timelineStartMs + layer.endOffsetMs,
        sourceRect: cloneSourceRect(layer.sourceRect),
        destinationRect: cloneDestinationRect(layer.destinationRect),
        opacity: layer.opacity,
        visible: layer.visible,
        lane: 0,
        audioGain: 1,
        zIndex: Math.max(1, layer.zIndex)
      });
    }
    void clipIndex;
  }
  return {
    ...source,
    schema: LEGACY_SHORT_FORM_SCHEMA_V6,
    output: fixedOutput(),
    durationMs,
    videoAssets,
    sourceAudioAssets,
    subtitles: absoluteLegacyTimedItems(source.subtitles, clips),
    imageAssets: absoluteLegacyTimedItems(source.imageAssets, clips),
    audioRegions: absoluteLegacyTimedItems(source.audioRegions, clips),
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    selectedVideoLayerId: nonEmptyString(source.selectedVideoLayerId) || null
  };
}

type AuthoritativeShortFormBranch = Omit<
  EditorShortFormBranch,
  "clips" | "scenes"
>;

function legacyClipIdForAsset(asset: ShortFormVideoAsset): string {
  const prefix = "short-video-base-";
  return asset.id.startsWith(prefix)
    ? nonEmptyString(asset.id.slice(prefix.length), asset.id)
    : asset.id;
}

/**
 * Transitional in-memory projection for v5 callers. These properties are
 * deliberately non-enumerable, so structured cloning/JSON persistence keeps
 * the authoritative v7 `durationMs + lanes + assets` model only.
 */
function attachLegacyCompatibilityViews(
  branch: AuthoritativeShortFormBranch
): EditorShortFormBranch {
  const baseAssets: ShortFormVideoAsset[] = [];
  const baseIds = new Set<string>();
  for (const audio of branch.sourceAudioAssets) {
    const match = branch.videoAssets.find((asset) => (
      !baseIds.has(asset.id)
      && asset.sourceAssetId === audio.sourceAssetId
      && asset.sourceClipId === audio.sourceClipId
      && asset.sourceStartMs === audio.sourceStartMs
      && asset.sourceEndMs === audio.sourceEndMs
      && asset.timelineStartMs === audio.timelineStartMs
      && asset.timelineEndMs === audio.timelineEndMs
    ));
    if (match) {
      baseAssets.push(match);
      baseIds.add(match.id);
    }
  }
  for (const asset of branch.videoAssets) {
    if (asset.id.startsWith("short-video-base-") && !baseIds.has(asset.id)) {
      baseAssets.push(asset);
      baseIds.add(asset.id);
    }
  }
  if (baseAssets.length === 0) {
    for (const asset of branch.videoAssets) {
      if (!baseAssets.some((base) => (
        base.timelineStartMs < asset.timelineEndMs
        && base.timelineEndMs > asset.timelineStartMs
      ))) {
        baseAssets.push(asset);
        baseIds.add(asset.id);
      }
    }
  }
  baseAssets.sort((left, right) => (
    left.timelineStartMs - right.timelineStartMs
    || left.timelineEndMs - right.timelineEndMs
    || left.id.localeCompare(right.id)
  ));
  const clips: EditorClip[] = baseAssets.map((asset) => {
    const id = legacyClipIdForAsset(asset);
    return {
      id,
      selectionId: id,
      sourceStartMs: asset.sourceStartMs,
      sourceEndMs: asset.sourceEndMs,
      selectionStartMs: asset.sourceSelectionStartMs,
      selectionEndMs: asset.sourceSelectionEndMs,
      timelineStartMs: asset.timelineStartMs,
      enabled: true,
      authority: "USER",
      shortFormSourceClipId: asset.sourceClipId,
      shortFormSourceSelectionId: id,
      shortFormSelectionStartMs: asset.sourceSelectionStartMs,
      shortFormSelectionEndMs: asset.sourceSelectionEndMs,
      shortFormFramingSourceId: id
    };
  });
  const scenes: ShortFormScene[] = baseAssets.map((base) => {
    const clipId = legacyClipIdForAsset(base);
    const videoLayers = branch.videoAssets
      .filter((asset) => (
        !baseIds.has(asset.id)
        && asset.timelineStartMs >= base.timelineStartMs
        && asset.timelineEndMs <= base.timelineEndMs
      ))
      .map((asset): ShortFormVideoLayer => ({
        id: asset.id,
        sourceAssetId: asset.sourceAssetId,
        sourceClipId: asset.sourceClipId,
        sourceSelectionStartMs: asset.sourceSelectionStartMs,
        sourceSelectionEndMs: asset.sourceSelectionEndMs,
        sourceStartMs: asset.sourceStartMs,
        sourceEndMs: asset.sourceEndMs,
        startOffsetMs: asset.timelineStartMs - base.timelineStartMs,
        endOffsetMs: asset.timelineEndMs - base.timelineStartMs,
        sourceRect: cloneSourceRect(asset.sourceRect),
        destinationRect: cloneDestinationRect(asset.destinationRect),
        opacity: asset.opacity,
        visible: asset.visible,
        zIndex: Math.max(1, asset.zIndex)
      }));
    const fit = base.fit || "cover";
    return {
      clipId,
      sourceClipId: base.sourceClipId,
      selectionId: clipId,
      fit,
      positionX: fit === "contain" ? 0.5 : base.positionX ?? 0.5,
      positionY: fit === "contain" ? 0.5 : base.positionY ?? 0.5,
      zoom: fit === "contain" ? 1 : base.zoom ?? 1,
      canvasX: base.canvasX ?? 0.5,
      canvasY: base.canvasY ?? 0.5,
      canvasScale: base.canvasScale ?? 1,
      sourceRect: cloneSourceRect(base.sourceRect),
      destinationRect: cloneDestinationRect(base.destinationRect),
      ...(videoLayers.length > 0 ? { videoLayers } : {})
    };
  });
  const result = branch as EditorShortFormBranch;
  Object.defineProperties(result, {
    clips: { value: clips, enumerable: false, configurable: true },
    scenes: { value: scenes, enumerable: false, configurable: true }
  });
  return result;
}

export function createDefaultShortFormBranch(): EditorShortFormBranch {
  return attachLegacyCompatibilityViews({
    schema: SHORT_FORM_SCHEMA,
    output: fixedOutput(),
    durationMs: SHORT_FORM_DEFAULT_CANVAS_DURATION_MS,
    videoLaneCount: SHORT_FORM_MIN_VIDEO_LANES,
    videoAssets: [],
    sourceAudioAssets: [],
    subtitles: [],
    imageAssets: [],
    audioRegions: [],
    subtitleLaneCount: 2,
    recentSubtitleColors: [],
    subtitleDefaults: null,
    ai: null,
    suppressedSelections: [],
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    selectedImageAssetId: null,
    selectedCueId: null,
    selectedAudioRegionId: null,
    selectedVideoLayerId: null,
    selectedSourceAudioAssetId: null,
    playheadMs: 0,
    revision: 0
  });
}

export function normalizeShortFormBranch(
  value: unknown,
  contextValue: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormBranch {
  const source = recordOrNull(value);
  const context = normalizationContext(contextValue);
  const sourceSchema = nonEmptyString(source?.schema);
  const versionMatch = /^kirinuki-short-form\/v(\d+)$/u.exec(sourceSchema);
  if (versionMatch && Number(versionMatch[1]) > SHORT_FORM_SCHEMA_VERSION) {
    throw new UnsupportedShortFormSchemaError(sourceSchema);
  }
  if (
    source
    && sourceSchema === LEGACY_SHORT_FORM_SCHEMA_V6
  ) {
    return normalizeShortFormBranch(migrateV6Branch(source), context);
  }
  if (
    source
    && [
      LEGACY_SHORT_FORM_SCHEMA_V5,
      LEGACY_SHORT_FORM_SCHEMA_V4,
      LEGACY_SHORT_FORM_SCHEMA_V3,
      LEGACY_SHORT_FORM_SCHEMA_V2,
      LEGACY_SHORT_FORM_SCHEMA
    ].includes(sourceSchema)
  ) {
    return normalizeShortFormBranch(
      migrateV6Branch(migrateLegacyBranch(source, context)),
      context
    );
  }
  if (!source || sourceSchema !== SHORT_FORM_SCHEMA) {
    return createDefaultShortFormBranch();
  }

  const endpointCandidates = [
    ...(Array.isArray(source.videoAssets) ? source.videoAssets : []),
    ...(Array.isArray(source.sourceAudioAssets) ? source.sourceAudioAssets : [])
  ].map((item) => integer(recordOrNull(item)?.timelineEndMs));
  const durationMs = Math.max(
    SHORT_FORM_MIN_CLIP_DURATION_MS,
    integer(source.durationMs, SHORT_FORM_DEFAULT_CANVAS_DURATION_MS),
    timedEndMs(source.subtitles),
    timedEndMs(source.imageAssets),
    timedEndMs(source.audioRegions),
    ...endpointCandidates
  );
  const videoLaneCount = normalizedVideoLaneCount(source.videoLaneCount);
  const videoAssets = normalizeShortFormVideoAssets(
    source.videoAssets,
    durationMs,
    videoLaneCount
  );
  const sourceAudioAssets = normalizeShortFormSourceAudioAssets(
    source.sourceAudioAssets,
    durationMs
  );
  const laneCount = integer(clamp(source.subtitleLaneCount, 2, 8, 2));
  const subtitles = normalizeSubtitleCues(source.subtitles, durationMs, laneCount);
  const imageAssets = normalizeImageAssets(source.imageAssets, durationMs);
  const audioRegions = normalizeAudioRegions(source.audioRegions, durationMs);
  const selectedVideoLayerId = videoAssets.some((asset) => (
    asset.id === source.selectedVideoLayerId
  ))
    ? String(source.selectedVideoLayerId)
    : null;
  const selectedSourceAudioAssetId = sourceAudioAssets.some((asset) => (
    asset.id === source.selectedSourceAudioAssetId
  ))
    ? String(source.selectedSourceAudioAssetId)
    : null;
  const subtitleDefaults = cloneSubtitleDefaults(
    recordOrNull(source.subtitleDefaults)
      ? source.subtitleDefaults as SubtitleDefaultsRecord
      : context.subtitleDefaults
  );
  const ai = cloneAi(
    recordOrNull(source.ai)
      ? source.ai as EditorProject["ai"]
      : context.ai
  );
  return attachLegacyCompatibilityViews({
    schema: SHORT_FORM_SCHEMA,
    output: fixedOutput(),
    durationMs,
    videoLaneCount,
    videoAssets,
    sourceAudioAssets,
    subtitles,
    imageAssets,
    audioRegions,
    subtitleLaneCount: laneCount,
    recentSubtitleColors: [...new Set(
      (Array.isArray(source.recentSubtitleColors)
        ? source.recentSubtitleColors
        : context.recentSubtitleColors || [])
        .map((color) => nonEmptyString(color).toUpperCase())
        .filter((color) => /^#[0-9A-F]{6}$/u.test(color))
    )].slice(0, 8),
    subtitleDefaults,
    ai,
    suppressedSelections: Array.isArray(source.suppressedSelections)
      ? structuredClone(source.suppressedSelections) as EditorProject["suppressedSelections"]
      : [],
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    selectedImageAssetId: imageAssets.some((asset) => asset.id === source.selectedImageAssetId)
      ? String(source.selectedImageAssetId)
      : null,
    selectedCueId: subtitles.some((cue) => cue.id === source.selectedCueId)
      ? String(source.selectedCueId)
      : null,
    selectedAudioRegionId: audioRegions.some((region) => (
      region.id === source.selectedAudioRegionId
    ))
      ? String(source.selectedAudioRegionId)
      : null,
    selectedVideoLayerId,
    selectedSourceAudioAssetId,
    playheadMs: integer(clamp(source.playheadMs, 0, durationMs, 0)),
    revision: Math.max(0, integer(source.revision))
  });
}

function normalizedShortFormWorkspaceId(
  value: unknown,
  fallback: string
): string {
  const candidate = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate)
    ? candidate
    : fallback;
}

function normalizedShortFormWorkspaceName(
  value: unknown,
  fallback: string
): string {
  return (String(value ?? "").trim() || fallback)
    .slice(0, MAX_SHORT_FORM_WORKSPACE_NAME_LENGTH);
}

/**
 * Normalizes the multi-Shorts envelope. A pre-envelope project is migrated
 * losslessly and deterministically to one `쇼츠 1` workspace. The legacy
 * `project.shortForm` field remains an active-workspace compatibility mirror.
 */
export function normalizeShortFormWorkspaceCollection(
  value: unknown,
  legacyShortForm: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspaceCollection {
  const source = recordOrNull(value);
  const sourceSchema = nonEmptyString(source?.schema);
  if (
    sourceSchema.startsWith("kirinuki-short-form-workspaces/")
    && sourceSchema !== SHORT_FORM_WORKSPACES_SCHEMA
  ) {
    throw new UnsupportedShortFormWorkspaceSchemaError(sourceSchema);
  }
  if (source?.schema !== SHORT_FORM_WORKSPACES_SCHEMA) {
    return {
      schema: SHORT_FORM_WORKSPACES_SCHEMA,
      activeWorkspaceId: LEGACY_SHORT_FORM_WORKSPACE_ID,
      workspaces: [{
        id: LEGACY_SHORT_FORM_WORKSPACE_ID,
        name: "쇼츠 1",
        shortForm: normalizeShortFormBranch(legacyShortForm, context)
      }]
    };
  }

  const usedIds = new Set<string>();
  const workspaces = (Array.isArray(source.workspaces)
    ? source.workspaces
    : [])
    .slice(0, MAX_SHORT_FORM_WORKSPACES)
    .flatMap((candidate, index) => {
      const raw = recordOrNull(candidate);
      if (!raw) {
        return [];
      }
      const baseId = normalizedShortFormWorkspaceId(
        raw.id,
        `shorts-${index + 1}`
      );
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        const suffixText = `-${suffix}`;
        id = `${baseId.slice(0, 128 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      usedIds.add(id);
      return [{
        id,
        name: normalizedShortFormWorkspaceName(raw.name, `쇼츠 ${index + 1}`),
        shortForm: normalizeShortFormBranch(raw.shortForm, context)
      } satisfies EditorShortFormWorkspace];
    });

  if (workspaces.length === 0) {
    return normalizeShortFormWorkspaceCollection(null, legacyShortForm, context);
  }
  const usedCacheAssetIds = new Set<string>();
  const isolatedWorkspaces = workspaces.map((workspace) => {
    const cacheAssetIds = [
      ...workspace.shortForm.videoAssets.map(({ id }) => id),
      ...workspace.shortForm.sourceAudioAssets.map(({ id }) => (
        `source-audio-cache:${id}`
      ))
    ];
    const collides = cacheAssetIds.some((id) => usedCacheAssetIds.has(id));
    const isolated = collides
      ? {
        ...workspace,
        shortForm: rekeyDuplicatedShortFormBranch(
          workspace.shortForm,
          workspace.id,
          context
        )
      }
      : workspace;
    for (const id of [
      ...isolated.shortForm.videoAssets.map(({ id }) => id),
      ...isolated.shortForm.sourceAudioAssets.map(({ id }) => (
        `source-audio-cache:${id}`
      ))
    ]) {
      usedCacheAssetIds.add(id);
    }
    return isolated;
  });
  const requestedActiveId = String(source.activeWorkspaceId ?? "").trim();
  const activeWorkspaceId = isolatedWorkspaces.some(({ id }) => id === requestedActiveId)
    ? requestedActiveId
    : isolatedWorkspaces[0]!.id;
  return {
    schema: SHORT_FORM_WORKSPACES_SCHEMA,
    activeWorkspaceId,
    workspaces: isolatedWorkspaces
  };
}

export function activeShortFormWorkspace(
  collectionValue: unknown,
  legacyShortForm: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspace {
  const collection = normalizeShortFormWorkspaceCollection(
    collectionValue,
    legacyShortForm,
    context
  );
  return collection.workspaces.find(({ id }) => (
    id === collection.activeWorkspaceId
  )) || collection.workspaces[0]!;
}

/** Saves a branch into its exact workspace without changing sibling Shorts. */
export function saveActiveShortFormWorkspace(
  collectionValue: unknown,
  legacyShortForm: unknown,
  shortFormValue: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspaceCollection {
  const collection = normalizeShortFormWorkspaceCollection(
    collectionValue,
    legacyShortForm,
    context
  );
  const shortForm = normalizeShortFormBranch(shortFormValue, context);
  return {
    ...collection,
    workspaces: collection.workspaces.map((workspace) => (
      workspace.id === collection.activeWorkspaceId
        ? { ...workspace, shortForm }
        : workspace
    ))
  };
}

export function activateShortFormWorkspace(
  collectionValue: unknown,
  legacyShortForm: unknown,
  workspaceIdValue: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspaceCollection {
  const collection = normalizeShortFormWorkspaceCollection(
    collectionValue,
    legacyShortForm,
    context
  );
  const workspaceId = String(workspaceIdValue ?? "").trim();
  if (!collection.workspaces.some(({ id }) => id === workspaceId)) {
    throw new RangeError("전환할 쇼츠 작업을 찾지 못했습니다.");
  }
  return workspaceId === collection.activeWorkspaceId
    ? collection
    : { ...collection, activeWorkspaceId: workspaceId };
}

function rekeyDuplicatedShortFormBranch(
  branchValue: unknown,
  workspaceId: string,
  context: readonly EditorClip[] | ShortFormNormalizationContext
): EditorShortFormBranch {
  const branch = normalizeShortFormBranch(branchValue, context);
  const videoIds = new Map(branch.videoAssets.map((asset, index) => (
    [asset.id, `${workspaceId}-video-${index + 1}`]
  )));
  const sourceAudioIds = new Map(branch.sourceAudioAssets.map((asset, index) => (
    [asset.id, `${workspaceId}-source-audio-${index + 1}`]
  )));
  const subtitleIds = new Map(branch.subtitles.map((cue, index) => (
    [cue.id, `${workspaceId}-subtitle-${index + 1}`]
  )));
  const imageIds = new Map(branch.imageAssets.map((asset, index) => (
    [asset.id, `${workspaceId}-image-${index + 1}`]
  )));
  const audioIds = new Map(branch.audioRegions.map((region, index) => (
    [region.id, `${workspaceId}-audio-${index + 1}`]
  )));
  return normalizeShortFormBranch({
    ...branch,
    videoAssets: branch.videoAssets.map((asset) => ({
      ...asset,
      id: videoIds.get(asset.id)!
    })),
    sourceAudioAssets: branch.sourceAudioAssets.map((asset) => ({
      ...asset,
      id: sourceAudioIds.get(asset.id)!
    })),
    subtitles: branch.subtitles.map((cue) => ({
      ...cue,
      id: subtitleIds.get(cue.id)!
    })),
    imageAssets: branch.imageAssets.map((asset) => ({
      ...asset,
      id: imageIds.get(asset.id)!
    })),
    audioRegions: branch.audioRegions.map((region) => ({
      ...region,
      id: audioIds.get(region.id)!
    })),
    selectedVideoLayerId: videoIds.get(branch.selectedVideoLayerId || "") || null,
    selectedSourceAudioAssetId: sourceAudioIds.get(
      branch.selectedSourceAudioAssetId || ""
    ) || null,
    selectedCueId: subtitleIds.get(branch.selectedCueId || "") || null,
    selectedImageAssetId: imageIds.get(branch.selectedImageAssetId || "") || null,
    selectedAudioRegionId: audioIds.get(branch.selectedAudioRegionId || "") || null,
    revision: 0
  }, context);
}

export function addShortFormWorkspace(
  collectionValue: unknown,
  legacyShortForm: unknown,
  {
    id: idValue,
    name: nameValue,
    duplicateActive = false
  }: { id: unknown; name?: unknown; duplicateActive?: boolean },
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspaceCollection {
  const collection = normalizeShortFormWorkspaceCollection(
    collectionValue,
    legacyShortForm,
    context
  );
  if (collection.workspaces.length >= MAX_SHORT_FORM_WORKSPACES) {
    throw new RangeError(`쇼츠 작업은 최대 ${MAX_SHORT_FORM_WORKSPACES}개까지 만들 수 있습니다.`);
  }
  const id = normalizedShortFormWorkspaceId(idValue, "");
  if (!id || collection.workspaces.some((workspace) => workspace.id === id)) {
    throw new TypeError("새 쇼츠 작업의 고유 ID가 올바르지 않습니다.");
  }
  const active = collection.workspaces.find((workspace) => (
    workspace.id === collection.activeWorkspaceId
  ))!;
  const nextIndex = collection.workspaces.length + 1;
  const shortForm = duplicateActive
    ? rekeyDuplicatedShortFormBranch(active.shortForm, id, context)
    : createDefaultShortFormBranch();
  return {
    ...collection,
    activeWorkspaceId: id,
    workspaces: [
      ...collection.workspaces,
      {
        id,
        name: normalizedShortFormWorkspaceName(
          nameValue,
          duplicateActive ? `${active.name} 복사본` : `쇼츠 ${nextIndex}`
        ),
        shortForm
      }
    ]
  };
}

export function renameShortFormWorkspace(
  collectionValue: unknown,
  legacyShortForm: unknown,
  workspaceIdValue: unknown,
  nameValue: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspaceCollection {
  const collection = normalizeShortFormWorkspaceCollection(
    collectionValue,
    legacyShortForm,
    context
  );
  const workspaceId = String(workspaceIdValue ?? "").trim();
  const current = collection.workspaces.find(({ id }) => id === workspaceId);
  if (!current) {
    throw new RangeError("이름을 바꿀 쇼츠 작업을 찾지 못했습니다.");
  }
  const name = normalizedShortFormWorkspaceName(nameValue, current.name);
  return {
    ...collection,
    workspaces: collection.workspaces.map((workspace) => (
      workspace.id === workspaceId ? { ...workspace, name } : workspace
    ))
  };
}

export function deleteShortFormWorkspace(
  collectionValue: unknown,
  legacyShortForm: unknown,
  workspaceIdValue: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): EditorShortFormWorkspaceCollection {
  const collection = normalizeShortFormWorkspaceCollection(
    collectionValue,
    legacyShortForm,
    context
  );
  if (collection.workspaces.length <= 1) {
    throw new RangeError("마지막 쇼츠 작업은 삭제할 수 없습니다.");
  }
  const workspaceId = String(workspaceIdValue ?? "").trim();
  const index = collection.workspaces.findIndex(({ id }) => id === workspaceId);
  if (index < 0) {
    throw new RangeError("삭제할 쇼츠 작업을 찾지 못했습니다.");
  }
  const workspaces = collection.workspaces.filter(({ id }) => id !== workspaceId);
  const activeWorkspaceId = collection.activeWorkspaceId === workspaceId
    ? workspaces[Math.min(index, workspaces.length - 1)]!.id
    : collection.activeWorkspaceId;
  return { ...collection, activeWorkspaceId, workspaces };
}

function nextRevision(branch: EditorShortFormBranch): number {
  return Math.max(0, integer(branch.revision)) + 1;
}

function maximumBranchContentEndMs(branch: EditorShortFormBranch): number {
  return Math.max(
    SHORT_FORM_MIN_CLIP_DURATION_MS,
    ...branch.videoAssets.map((asset) => asset.timelineEndMs),
    ...branch.sourceAudioAssets.map((asset) => asset.timelineEndMs),
    ...branch.subtitles.map((cue) => cue.endOffsetMs),
    ...branch.imageAssets.map((asset) => asset.endOffsetMs),
    ...branch.audioRegions.map((region) => region.endOffsetMs)
  );
}

export interface ShortFormCanvasRange {
  startMs: number;
  endMs: number;
}

/**
 * Returns the authored outer bounds of the black canvas. Hidden, transparent,
 * or muted items still count: they are user-authored timeline data and must
 * not be discarded by an automatic trim merely because they are not audible
 * or visible at this instant. Internal gaps are deliberately ignored.
 */
export function shortFormCanvasContentRange(
  branchValue: unknown
): ShortFormCanvasRange | null {
  const branch = normalizeShortFormBranch(branchValue);
  const ranges = [
    ...branch.videoAssets.map((asset) => ({
      startMs: asset.timelineStartMs,
      endMs: asset.timelineEndMs
    })),
    ...branch.sourceAudioAssets.map((asset) => ({
      startMs: asset.timelineStartMs,
      endMs: asset.timelineEndMs
    })),
    ...branch.subtitles.map((cue) => ({
      startMs: cue.startOffsetMs,
      endMs: cue.endOffsetMs
    })),
    ...branch.imageAssets.map((asset) => ({
      startMs: asset.startOffsetMs,
      endMs: asset.endOffsetMs
    })),
    ...branch.audioRegions.map((region) => ({
      startMs: region.startOffsetMs,
      endMs: region.endOffsetMs
    }))
  ];
  if (ranges.length === 0) {
    return null;
  }
  return {
    startMs: Math.min(...ranges.map((range) => range.startMs)),
    endMs: Math.max(...ranges.map((range) => range.endMs))
  };
}

function trimShortFormTimedItems<T extends {
  startOffsetMs: number;
  endOffsetMs: number;
}>(
  items: readonly T[],
  startMs: number,
  endMs: number,
  patch: (
    item: T,
    removedFromStartMs: number,
    removedFromEndMs: number,
    durationMs: number
  ) => Partial<T> = () => ({})
): T[] {
  return items.flatMap((item) => {
    const overlapStartMs = Math.max(startMs, item.startOffsetMs);
    const overlapEndMs = Math.min(endMs, item.endOffsetMs);
    const durationMs = overlapEndMs - overlapStartMs;
    if (durationMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
      return [];
    }
    const removedFromStartMs = overlapStartMs - item.startOffsetMs;
    const removedFromEndMs = item.endOffsetMs - overlapEndMs;
    return [{
      ...item,
      ...patch(
        item,
        removedFromStartMs,
        removedFromEndMs,
        durationMs
      ),
      startOffsetMs: overlapStartMs - startMs,
      endOffsetMs: overlapEndMs - startMs
    }];
  });
}

/**
 * Destructively keeps one half-open range of the short canvas and rebases it
 * to zero. Every authored media kind moves on the same clock. Source-backed
 * assets also advance/retreat their decoded source range while retaining the
 * immutable selection envelope used by the local preview cache.
 */
export function trimShortFormCanvasRange(
  branchValue: unknown,
  startMsValue: unknown,
  endMsValue: unknown
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const numericStartMs = Number(startMsValue);
  const numericEndMs = Number(endMsValue);
  if (!Number.isFinite(numericStartMs) || !Number.isFinite(numericEndMs)) {
    throw new TypeError("남길 쇼츠 캔버스의 시작과 끝 시각이 필요합니다.");
  }
  const startMs = Math.round(numericStartMs);
  const endMs = Math.round(numericEndMs);
  if (
    startMs < 0
    || endMs > previous.durationMs
    || endMs - startMs < SHORT_FORM_MIN_CLIP_DURATION_MS
  ) {
    throw new RangeError(
      "남길 쇼츠 캔버스 구간은 현재 캔버스 안에서 0.1초 이상이어야 합니다."
    );
  }
  if (startMs === 0 && endMs === previous.durationMs) {
    return previous;
  }

  const trimSourceBackedAsset = <T extends ShortFormVideoAsset | ShortFormSourceAudioAsset>(
    asset: T
  ): T | null => {
    const overlapStartMs = Math.max(startMs, asset.timelineStartMs);
    const overlapEndMs = Math.min(endMs, asset.timelineEndMs);
    const durationMs = overlapEndMs - overlapStartMs;
    if (durationMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
      return null;
    }
    const removedFromStartMs = overlapStartMs - asset.timelineStartMs;
    const removedFromEndMs = asset.timelineEndMs - overlapEndMs;
    return {
      ...asset,
      sourceStartMs: asset.sourceStartMs + removedFromStartMs,
      sourceEndMs: asset.sourceEndMs - removedFromEndMs,
      timelineStartMs: overlapStartMs - startMs,
      timelineEndMs: overlapEndMs - startMs,
      ...("fadeInMs" in asset
        ? {
          fadeInMs: removedFromStartMs > 0
            ? 0
            : Math.min(asset.fadeInMs, durationMs),
          fadeOutMs: removedFromEndMs > 0
            ? 0
            : Math.min(asset.fadeOutMs, durationMs)
        }
        : {})
    } as T;
  };
  const videoAssets = previous.videoAssets.flatMap((asset) => {
    const trimmed = trimSourceBackedAsset(asset);
    return trimmed ? [trimmed] : [];
  });
  const sourceAudioAssets = previous.sourceAudioAssets.flatMap((asset) => {
    const trimmed = trimSourceBackedAsset(asset);
    return trimmed ? [trimmed] : [];
  });
  const subtitles = trimShortFormTimedItems(
    previous.subtitles,
    startMs,
    endMs
  );
  const imageAssets = trimShortFormTimedItems(
    previous.imageAssets,
    startMs,
    endMs
  );
  const audioRegions = trimShortFormTimedItems(
    previous.audioRegions,
    startMs,
    endMs,
    (region, removedFromStartMs, removedFromEndMs, durationMs) => ({
      fadeInMs: removedFromStartMs > 0
        ? 0
        : Math.min(region.fadeInMs, durationMs),
      fadeOutMs: removedFromEndMs > 0
        ? 0
        : Math.min(region.fadeOutMs, durationMs)
    })
  );
  const durationMs = endMs - startMs;
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    videoAssets,
    sourceAudioAssets,
    subtitles,
    imageAssets,
    audioRegions,
    selectedVideoLayerId: videoAssets.some((asset) => (
      asset.id === previous.selectedVideoLayerId
    )) ? previous.selectedVideoLayerId : null,
    selectedSourceAudioAssetId: sourceAudioAssets.some((asset) => (
      asset.id === previous.selectedSourceAudioAssetId
    )) ? previous.selectedSourceAudioAssetId : null,
    selectedCueId: subtitles.some((cue) => (
      cue.id === previous.selectedCueId
    )) ? previous.selectedCueId : null,
    selectedImageAssetId: imageAssets.some((asset) => (
      asset.id === previous.selectedImageAssetId
    )) ? previous.selectedImageAssetId : null,
    selectedAudioRegionId: audioRegions.some((region) => (
      region.id === previous.selectedAudioRegionId
    )) ? previous.selectedAudioRegionId : null,
    playheadMs: Math.max(
      0,
      Math.min(durationMs, previous.playheadMs - startMs)
    ),
    revision: nextRevision(previous)
  });
}

export function trimShortFormCanvasToContent(
  branchValue: unknown
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const range = shortFormCanvasContentRange(previous);
  return range
    ? trimShortFormCanvasRange(previous, range.startMs, range.endMs)
    : previous;
}

/** Keeps the synthetic workspace carrier and its mirrored timed data atomic. */
export function shortFormWorkspaceProjectWithBranch(
  workspaceProject: EditorProject,
  branchValue: unknown
): EditorProject {
  const shortForm = normalizeShortFormBranch(branchValue);
  return {
    ...workspaceProject,
    clips: [shortFormCanvasClip(shortForm.durationMs)],
    subtitles: shortForm.subtitles.map((cue) => ({ ...cue })),
    imageAssets: shortForm.imageAssets.map((asset) => ({ ...asset })),
    audioRegions: shortForm.audioRegions.map((region) => ({ ...region })),
    subtitleLaneCount: shortForm.subtitleLaneCount,
    recentSubtitleColors: [...shortForm.recentSubtitleColors],
    subtitleDefaults: shortForm.subtitleDefaults
      ? { ...shortForm.subtitleDefaults }
      : { ...workspaceProject.subtitleDefaults },
    ai: shortForm.ai
      ? structuredClone(shortForm.ai)
      : structuredClone(workspaceProject.ai),
    suppressedSelections: structuredClone(shortForm.suppressedSelections),
    shortForm,
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    selectedImageAssetId: shortForm.selectedImageAssetId,
    selectedCueId: shortForm.selectedCueId,
    selectedAudioRegionId: shortForm.selectedAudioRegionId,
    playheadMs: shortForm.playheadMs
  };
}

export function setShortFormCanvasDuration(
  branchValue: unknown,
  durationMsValue: unknown
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const durationMs = Math.max(
    maximumBranchContentEndMs(previous),
    integer(durationMsValue, previous.durationMs)
  );
  if (durationMs === previous.durationMs) {
    return previous;
  }
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    playheadMs: Math.min(previous.playheadMs, durationMs),
    revision: nextRevision(previous)
  });
}

export function canAddShortFormVideoAsset(
  branchValue: unknown,
  timelineStartMsValue: unknown,
  timelineEndMsValue: unknown,
  requestedLaneValue?: unknown
): boolean {
  const branch = normalizeShortFormBranch(branchValue);
  const timelineStartMs = Math.max(0, integer(timelineStartMsValue));
  const timelineEndMs = integer(timelineEndMsValue);
  if (
    timelineEndMs - timelineStartMs < SHORT_FORM_MIN_CLIP_DURATION_MS
    || branch.videoAssets.length >= SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS
  ) {
    return false;
  }
  if (requestedLaneValue !== undefined) {
    return validPersistedVideoLane(
      requestedLaneValue,
      SHORT_FORM_MAX_VIDEO_LANES
    ) && shortFormVideoLaneAvailable(
      branch.videoAssets,
      requestedLaneValue,
      timelineStartMs,
      timelineEndMs
    );
  }
  return availableShortFormVideoLaneForRange(
    branch.videoAssets,
    timelineStartMs,
    timelineEndMs,
    SHORT_FORM_MAX_VIDEO_LANES
  ) !== null;
}

export function addShortFormVideoLane(
  branchValue: unknown
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const videoLaneCount = Math.min(
    SHORT_FORM_MAX_VIDEO_LANES,
    previous.videoLaneCount + 1
  );
  if (videoLaneCount === previous.videoLaneCount) {
    return previous;
  }
  return normalizeShortFormBranch({
    ...previous,
    videoLaneCount,
    revision: nextRevision(previous)
  });
}

export function addShortFormVideoAsset(
  branchValue: unknown,
  input: ShortFormVideoAssetInput
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const raw = recordOrNull(input);
  if (!raw) {
    return previous;
  }
  const requestedEndMs = integer(raw.timelineEndMs);
  const durationMs = Math.max(previous.durationMs, requestedEndMs);
  const requestedLaneProvided = Object.prototype.hasOwnProperty.call(raw, "lane");
  if (
    requestedLaneProvided
    && !validPersistedVideoLane(raw.lane, SHORT_FORM_MAX_VIDEO_LANES)
  ) {
    throw new RangeError("추가할 쇼츠 영상 라인이 현재 영상 라인 범위를 벗어났습니다.");
  }
  const used = new Set(previous.videoAssets.map((asset) => asset.id));
  let candidate = normalizeVideoAsset(
    {
      ...raw,
      id: uniqueId(
        raw.id,
        `short-video-${previous.revision + 1}-${previous.videoAssets.length + 1}`,
        used
      )
    },
    durationMs,
    new Set(previous.videoAssets.map((asset) => asset.id)),
    previous.videoAssets.length,
    SHORT_FORM_MAX_VIDEO_LANES
  );
  if (!candidate) {
    throw new TypeError("추가할 쇼츠 영상의 원본·캔버스 구간 또는 배치값이 올바르지 않습니다.");
  }
  if (previous.videoAssets.length >= SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS) {
    throw new ShortFormVideoLayerLimitError("total");
  }
  const lane = requestedLaneProvided
    ? candidate.lane
    : availableShortFormVideoLaneForRange(
      previous.videoAssets,
      candidate.timelineStartMs,
      candidate.timelineEndMs,
      SHORT_FORM_MAX_VIDEO_LANES
    );
  if (lane === null) {
    throw new ShortFormVideoLayerLimitError();
  }
  candidate = { ...candidate, lane };
  const videoLaneCount = Math.max(previous.videoLaneCount, lane + 1);
  if (!canInsertVideoAsset(previous.videoAssets, candidate, videoLaneCount)) {
    throw new ShortFormVideoLayerLimitError();
  }
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    videoLaneCount,
    videoAssets: [...previous.videoAssets, candidate],
    selectedVideoLayerId: candidate.id,
    playheadMs: Math.min(durationMs, candidate.timelineStartMs),
    revision: nextRevision(previous)
  });
}

export function updateShortFormVideoAsset(
  branchValue: unknown,
  assetIdValue: unknown,
  update: Partial<Omit<ShortFormVideoAsset, "id">>
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const assetId = nonEmptyString(assetIdValue);
  const existing = previous.videoAssets.find((asset) => asset.id === assetId);
  const rawUpdate = recordOrNull(update);
  if (!existing || !rawUpdate) {
    return previous;
  }
  if (
    Object.prototype.hasOwnProperty.call(rawUpdate, "lane")
    && !validPersistedVideoLane(rawUpdate.lane, previous.videoLaneCount)
  ) {
    throw new RangeError("쇼츠 영상 라인이 현재 영상 라인 범위를 벗어났습니다.");
  }
  assertSourceBackedAssetUpdate(existing, rawUpdate);
  const durationMs = Math.max(
    previous.durationMs,
    integer(rawUpdate.timelineEndMs, existing.timelineEndMs)
  );
  const candidate = normalizeVideoAsset(
    { ...existing, ...rawUpdate, id: existing.id },
    durationMs,
    new Set(),
    Math.max(0, existing.zIndex),
    previous.videoLaneCount,
    existing.lane
  );
  if (!candidate) {
    throw new TypeError("쇼츠 영상의 원본·캔버스 구간 또는 배치값이 올바르지 않습니다.");
  }
  const others = previous.videoAssets.filter((asset) => asset.id !== assetId);
  if (!canInsertVideoAsset(others, candidate, previous.videoLaneCount)) {
    throw new ShortFormVideoLayerLimitError();
  }
  const linkedSourceAudioIds = new Set(
    previous.sourceAudioAssets
      .filter((audio) => sourceAudioExactlyMatchesVideo(audio, existing))
      .map((audio) => audio.id)
  );
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    videoAssets: previous.videoAssets.map((asset) => (
      asset.id === assetId ? candidate : asset
    )),
    sourceAudioAssets: previous.sourceAudioAssets.map((audio) => (
      linkedSourceAudioIds.has(audio.id)
        ? sourceAudioFollowingVideo(audio, candidate)
        : audio
    )),
    selectedVideoLayerId: assetId,
    revision: nextRevision(previous)
  });
}

export function removeShortFormVideoAsset(
  branchValue: unknown,
  assetIdValue: unknown
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const assetId = nonEmptyString(assetIdValue);
  if (!previous.videoAssets.some((asset) => asset.id === assetId)) {
    return previous;
  }
  const removedVideo = previous.videoAssets.find((asset) => asset.id === assetId)!;
  const videoAssets = previous.videoAssets.filter((asset) => asset.id !== assetId);
  const removedSourceAudioIds = new Set(
    previous.sourceAudioAssets
      .filter((audio) => sourceAudioExactlyMatchesVideo(audio, removedVideo))
      .map((audio) => audio.id)
  );
  const sourceAudioAssets = previous.sourceAudioAssets.filter((audio) => (
    !removedSourceAudioIds.has(audio.id)
  ));
  return normalizeShortFormBranch({
    ...previous,
    videoAssets,
    sourceAudioAssets,
    selectedVideoLayerId: previous.selectedVideoLayerId === assetId
      ? videoAssets.at(-1)?.id || null
      : previous.selectedVideoLayerId,
    selectedSourceAudioAssetId: removedSourceAudioIds.has(
      previous.selectedSourceAudioAssetId || ""
    ) ? null : previous.selectedSourceAudioAssetId,
    revision: nextRevision(previous)
  });
}

export function reorderShortFormVideoAssets(
  branchValue: unknown,
  orderedAssetIds: readonly unknown[]
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const byId = new Map(previous.videoAssets.map((asset) => [asset.id, asset]));
  const seen = new Set<string>();
  const ordered = [
    ...Array.from(orderedAssetIds || [], (value) => nonEmptyString(value))
      .flatMap((id) => {
        const asset = byId.get(id);
        if (!asset || seen.has(id)) {
          return [];
        }
        seen.add(id);
        return [asset];
      }),
    ...previous.videoAssets.filter((asset) => !seen.has(asset.id))
  ].map((asset, index) => ({ ...cloneVideoAsset(asset), zIndex: index }));
  if (ordered.every((asset, index) => (
    asset.id === previous.videoAssets[index]?.id
    && asset.zIndex === previous.videoAssets[index]?.zIndex
  ))) {
    return previous;
  }
  return normalizeShortFormBranch({
    ...previous,
    videoAssets: ordered,
    revision: nextRevision(previous)
  });
}

export function shortFormVideoAssetsAtTimeline(
  branchValue: unknown,
  timelineMsValue: unknown
): ActiveShortFormVideoAsset[] {
  const branch = normalizeShortFormBranch(branchValue);
  const timelineMs = clamp(timelineMsValue, 0, branch.durationMs, 0);
  return branch.videoAssets
    .filter((asset) => (
      timelineMs >= asset.timelineStartMs && timelineMs < asset.timelineEndMs
    ))
    .map((asset) => ({
      ...cloneVideoAsset(asset),
      sourceTimeMs: asset.sourceStartMs + timelineMs - asset.timelineStartMs
    }))
    .sort((left, right) => (
      left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    ));
}

export function shortFormVideoLayersAtTimeline(
  branchValue: unknown,
  timelineMsValue: unknown
): ActiveShortFormVideoLayer[] {
  const branch = normalizeShortFormBranch(branchValue);
  return shortFormVideoAssetsAtTimeline(branch, timelineMsValue).map((asset) => {
    const scene = branch.scenes.find((candidate) => (
      candidate.clipId === legacyClipIdForAsset(asset)
      || (candidate.videoLayers || []).some((layer) => layer.id === asset.id)
    ));
    const base = Boolean(scene && scene.clipId === legacyClipIdForAsset(asset));
    return {
      ...asset,
      kind: base ? "base" : "additional",
      clipId: scene?.clipId || SHORT_FORM_CANVAS_CLIP_ID
    };
  });
}

export function activeShortFormSourceAudioAsset(
  branchValue: unknown,
  timelineMsValue: unknown
): ShortFormSourceAudioAsset | null {
  const branch = normalizeShortFormBranch(branchValue);
  const timelineMs = clamp(timelineMsValue, 0, branch.durationMs, 0);
  const asset = branch.sourceAudioAssets.find((candidate) => (
    timelineMs >= candidate.timelineStartMs && timelineMs < candidate.timelineEndMs
  ));
  return asset ? cloneSourceAudioAsset(asset) : null;
}

export function addShortFormSourceAudioAsset(
  branchValue: unknown,
  input: ShortFormSourceAudioAssetInput
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const raw = recordOrNull(input);
  if (!raw) {
    return previous;
  }
  const durationMs = Math.max(previous.durationMs, integer(raw.timelineEndMs));
  const candidate = normalizeSourceAudioAsset(
    raw,
    durationMs,
    new Set(previous.sourceAudioAssets.map((asset) => asset.id)),
    previous.sourceAudioAssets.length
  );
  if (!candidate) {
    throw new TypeError("추가할 쇼츠 원본 음성 에셋 구간이 올바르지 않습니다.");
  }
  if (previous.sourceAudioAssets.some((asset) => (
    asset.timelineStartMs < candidate.timelineEndMs
    && asset.timelineEndMs > candidate.timelineStartMs
  ))) {
    throw new RangeError("쇼츠 원본 음성 에셋은 서로 겹칠 수 없습니다.");
  }
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    sourceAudioAssets: [...previous.sourceAudioAssets, candidate],
    selectedSourceAudioAssetId: candidate.id,
    revision: nextRevision(previous)
  });
}

export function updateShortFormSourceAudioAsset(
  branchValue: unknown,
  assetIdValue: unknown,
  update: Partial<Omit<ShortFormSourceAudioAsset, "id">>
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const assetId = nonEmptyString(assetIdValue);
  const existing = previous.sourceAudioAssets.find((asset) => asset.id === assetId);
  const rawUpdate = recordOrNull(update);
  if (!existing || !rawUpdate) {
    return previous;
  }
  assertSourceBackedAssetUpdate(existing, rawUpdate);
  const durationMs = Math.max(
    previous.durationMs,
    integer(rawUpdate.timelineEndMs, existing.timelineEndMs)
  );
  const candidate = normalizeSourceAudioAsset(
    { ...existing, ...rawUpdate, id: existing.id },
    durationMs,
    new Set(),
    0
  );
  if (!candidate) {
    throw new TypeError("쇼츠 원본 음성 에셋 구간이 올바르지 않습니다.");
  }
  const others = previous.sourceAudioAssets.filter((asset) => asset.id !== assetId);
  if (others.some((asset) => (
    asset.timelineStartMs < candidate.timelineEndMs
    && asset.timelineEndMs > candidate.timelineStartMs
  ))) {
    throw new RangeError("쇼츠 원본 음성 에셋은 서로 겹칠 수 없습니다.");
  }
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    sourceAudioAssets: previous.sourceAudioAssets.map((asset) => (
      asset.id === assetId ? candidate : asset
    )),
    selectedSourceAudioAssetId: assetId,
    revision: nextRevision(previous)
  });
}

export function removeShortFormSourceAudioAsset(
  branchValue: unknown,
  assetIdValue: unknown
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue);
  const assetId = nonEmptyString(assetIdValue);
  if (!previous.sourceAudioAssets.some((asset) => asset.id === assetId)) {
    return previous;
  }
  return normalizeShortFormBranch({
    ...previous,
    sourceAudioAssets: previous.sourceAudioAssets.filter((asset) => (
      asset.id !== assetId
    )),
    selectedSourceAudioAssetId: previous.selectedSourceAudioAssetId === assetId
      ? null
      : previous.selectedSourceAudioAssetId,
    revision: nextRevision(previous)
  });
}

export function shortFormCanvasClip(durationMsValue: unknown): EditorClip {
  const durationMs = Math.max(
    SHORT_FORM_MIN_CLIP_DURATION_MS,
    integer(durationMsValue, SHORT_FORM_DEFAULT_CANVAS_DURATION_MS)
  );
  return {
    id: SHORT_FORM_CANVAS_CLIP_ID,
    selectionId: SHORT_FORM_CANVAS_CLIP_ID,
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    selectionStartMs: 0,
    selectionEndMs: durationMs,
    timelineStartMs: 0,
    enabled: true,
    authority: "short-form-canvas-clock",
    note: "검은 쇼츠 캔버스",
    shortFormCanvasClock: true
  };
}

function projectContext(project: EditorProject): ShortFormNormalizationContext {
  return {
    clips: project.clips,
    subtitles: project.subtitles,
    imageAssets: project.imageAssets,
    audioRegions: project.audioRegions,
    subtitleLaneCount: project.subtitleLaneCount,
    recentSubtitleColors: project.recentSubtitleColors,
    subtitleDefaults: project.subtitleDefaults,
    ai: project.ai
  };
}

export function createShortFormWorkspaceProject(
  parentProject: EditorProject
): EditorProject {
  const shortForm = normalizeShortFormBranch(
    parentProject.shortForm,
    projectContext(parentProject)
  );
  return {
    ...structuredClone(parentProject),
    name: `${parentProject.name.replace(/\s+쇼츠$/u, "")} 쇼츠`,
    clips: [shortFormCanvasClip(shortForm.durationMs)],
    subtitles: shortForm.subtitles.map((cue) => ({ ...cue })),
    imageAssets: shortForm.imageAssets.map((asset) => ({ ...asset })),
    audioRegions: shortForm.audioRegions.map((region) => ({ ...region })),
    subtitleLaneCount: shortForm.subtitleLaneCount,
    recentSubtitleColors: [...shortForm.recentSubtitleColors],
    subtitleDefaults: shortForm.subtitleDefaults
      ? { ...shortForm.subtitleDefaults }
      : { ...parentProject.subtitleDefaults },
    ai: shortForm.ai ? structuredClone(shortForm.ai) : structuredClone(parentProject.ai),
    suppressedSelections: structuredClone(shortForm.suppressedSelections),
    shortForm,
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    selectedImageAssetId: shortForm.selectedImageAssetId,
    selectedCueId: shortForm.selectedCueId,
    selectedAudioRegionId: shortForm.selectedAudioRegionId,
    playheadMs: shortForm.playheadMs
  };
}

export function shortFormBranchFromWorkspace(
  parentProject: EditorProject,
  workspaceProject: EditorProject
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(
    workspaceProject.shortForm || parentProject.shortForm,
    projectContext(parentProject)
  );
  const carrier = workspaceProject.clips.find((clip) => (
    clip.id === SHORT_FORM_CANVAS_CLIP_ID
  ));
  const durationMs = Math.max(
    previous.durationMs,
    carrier ? shortClipDuration(carrier) : 0,
    timedEndMs(workspaceProject.subtitles),
    timedEndMs(workspaceProject.imageAssets),
    timedEndMs(workspaceProject.audioRegions)
  );
  return normalizeShortFormBranch({
    ...previous,
    durationMs,
    subtitles: workspaceProject.subtitles,
    imageAssets: workspaceProject.imageAssets,
    audioRegions: workspaceProject.audioRegions,
    subtitleLaneCount: workspaceProject.subtitleLaneCount,
    recentSubtitleColors: workspaceProject.recentSubtitleColors,
    subtitleDefaults: workspaceProject.subtitleDefaults,
    ai: workspaceProject.ai,
    suppressedSelections: workspaceProject.suppressedSelections,
    selectedImageAssetId: workspaceProject.selectedImageAssetId,
    selectedCueId: workspaceProject.selectedCueId,
    selectedAudioRegionId: workspaceProject.selectedAudioRegionId,
    selectedVideoLayerId: workspaceProject.shortForm?.selectedVideoLayerId
      ?? previous.selectedVideoLayerId,
    selectedSourceAudioAssetId: workspaceProject.shortForm?.selectedSourceAudioAssetId
      ?? previous.selectedSourceAudioAssetId,
    playheadMs: workspaceProject.playheadMs,
    revision: nextRevision(previous)
  }, projectContext(parentProject));
}

export function deriveShortFormRenderProject(
  parentProject: EditorProject
): EditorProject {
  return createShortFormWorkspaceProject(parentProject);
}

export function seedShortFormBranch(
  project: EditorProject,
  scenes: readonly Partial<ShortFormScene>[]
): EditorShortFormBranch {
  return normalizeShortFormBranch({
    schema: LEGACY_SHORT_FORM_SCHEMA_V2,
    scenes: scenes.map((scene) => ({ ...scene }))
  }, projectContext(project));
}

export function hasShortFormWorkspace(
  value: unknown,
  context: readonly EditorClip[] | ShortFormNormalizationContext = []
): boolean {
  const source = recordOrNull(value);
  const schema = nonEmptyString(source?.schema);
  return [
    SHORT_FORM_SCHEMA,
    LEGACY_SHORT_FORM_SCHEMA_V6,
    LEGACY_SHORT_FORM_SCHEMA_V5,
    LEGACY_SHORT_FORM_SCHEMA_V4,
    LEGACY_SHORT_FORM_SCHEMA_V3,
    LEGACY_SHORT_FORM_SCHEMA_V2,
    LEGACY_SHORT_FORM_SCHEMA
  ].includes(schema) && normalizeShortFormBranch(value, context).schema === SHORT_FORM_SCHEMA;
}

function matchingSourceClip(
  project: EditorProject,
  sourceClipId: string
): EditorClip | null {
  return project.clips.find((clip) => (
    clip.id === sourceClipId
    || clip.shortFormSourceClipId === sourceClipId
  )) || null;
}

export function appendShortFormSlices(
  parentProject: EditorProject,
  branchValue: unknown,
  requests: readonly ShortFormSliceRequest[]
): EditorShortFormBranch {
  const previous = normalizeShortFormBranch(branchValue, projectContext(parentProject));
  const hasAuthoredCanvasContent = (
    previous.videoAssets.length > 0
    || previous.sourceAudioAssets.length > 0
    || previous.subtitles.length > 0
    || previous.imageAssets.length > 0
    || previous.audioRegions.length > 0
  );
  let timelineCursorMs = hasAuthoredCanvasContent ? previous.durationMs : 0;
  const rawVideoAssets: ShortFormVideoAsset[] = previous.videoAssets.map(cloneVideoAsset);
  const rawAudioAssets: ShortFormSourceAudioAsset[] = previous.sourceAudioAssets
    .map(cloneSourceAudioAsset);
  const subtitles = previous.subtitles.map((cue) => structuredClone(cue));
  const imageAssets = previous.imageAssets.map((asset) => structuredClone(asset));
  const audioRegions = previous.audioRegions.map((region) => ({ ...region }));
  const usedVideoIds = new Set(rawVideoAssets.map((asset) => asset.id));
  const usedAudioIds = new Set(rawAudioAssets.map((asset) => asset.id));
  const usedSubtitleIds = new Set(subtitles.map((cue) => cue.id));
  const usedImageIds = new Set(imageAssets.map((asset) => asset.id));
  const usedRegionIds = new Set(audioRegions.map((region) => region.id));
  let added = 0;
  let selectedVideoLayerId = previous.selectedVideoLayerId;

  for (const [index, requestValue] of Array.from(requests || []).entries()) {
    const request = recordOrNull(requestValue);
    const sourceRect = normalizeShortFormSourceRect(request?.sourceRect);
    const destinationRect = normalizeShortFormDestinationRect(request?.destinationRect);
    const requestedSourceStartMs = Math.max(0, integer(request?.sourceStartMs));
    const requestedSourceEndMs = integer(request?.sourceEndMs);
    const sourceClipId = nonEmptyString(request?.sourceClipId);
    if (
      !sourceClipId
      || !sourceRect
      || !destinationRect
      || requestedSourceEndMs - requestedSourceStartMs
        < SHORT_FORM_MIN_CLIP_DURATION_MS
    ) {
      continue;
    }
    const sourceClip = matchingSourceClip(
      parentProject,
      sourceClipId
    );
    if (!sourceClip) {
      continue;
    }
    const sourceStartMs = Math.max(
      sourceClip.sourceStartMs,
      requestedSourceStartMs
    );
    const sourceEndMs = Math.min(sourceClip.sourceEndMs, requestedSourceEndMs);
    const durationMs = sourceEndMs - sourceStartMs;
    if (durationMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
      continue;
    }
    // Reject the whole immutable append operation before adding any dependent
    // audio/timed items for the overflowing slice. Otherwise final
    // normalization would drop only the 65th video while retaining its audio,
    // captions and canvas tail.
    if (rawVideoAssets.length >= SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS) {
      throw new ShortFormVideoLayerLimitError("total");
    }
    const timelineStartMs = timelineCursorMs;
    const timelineEndMs = timelineStartMs + durationMs;
    const lineageId = nonEmptyString(sourceClip?.shortFormSourceClipId, sourceClipId);
    const selectionStartMs = Math.min(
      sourceStartMs,
      integer(sourceClip?.shortFormSelectionStartMs, sourceClip?.selectionStartMs ?? sourceStartMs)
    );
    const selectionEndMs = Math.max(
      sourceEndMs,
      integer(sourceClip?.shortFormSelectionEndMs, sourceClip?.selectionEndMs ?? sourceEndMs)
    );
    const videoId = uniqueId(
      null,
      `short-video-${previous.revision + 1}-${index + 1}`,
      usedVideoIds
    );
    rawVideoAssets.push({
      id: videoId,
      sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
      sourceClipId: lineageId,
      sourceSelectionStartMs: selectionStartMs,
      sourceSelectionEndMs: selectionEndMs,
      sourceStartMs,
      sourceEndMs,
      timelineStartMs,
      timelineEndMs,
      sourceRect,
      destinationRect,
      opacity: 1,
      visible: true,
      lane: 0,
      audioGain: 1,
      zIndex: 0
    });
    rawAudioAssets.push({
      id: uniqueId(
        null,
        `short-source-audio-${previous.revision + 1}-${index + 1}`,
        usedAudioIds
      ),
      sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
      sourceClipId: lineageId,
      sourceSelectionStartMs: selectionStartMs,
      sourceSelectionEndMs: selectionEndMs,
      sourceStartMs,
      sourceEndMs,
      timelineStartMs,
      timelineEndMs,
      gain: 1,
      muted: false,
      fadeInMs: 0,
      fadeOutMs: 0
    });
    const copyTimedItems = <T extends {
      id: string;
      clipId: string;
      startOffsetMs: number;
      endOffsetMs: number;
    }>(
      items: readonly T[],
      target: T[],
      usedIds: Set<string>,
      prefix: string,
      clone: (item: T) => T
    ): void => {
      for (const item of items) {
        if (item.clipId !== sourceClip.id) {
          continue;
        }
        const absoluteStartMs = sourceClip.sourceStartMs + item.startOffsetMs;
        const absoluteEndMs = sourceClip.sourceStartMs + item.endOffsetMs;
        const overlapStartMs = Math.max(sourceStartMs, absoluteStartMs);
        const overlapEndMs = Math.min(sourceEndMs, absoluteEndMs);
        if (overlapEndMs - overlapStartMs < SHORT_FORM_MIN_CLIP_DURATION_MS) {
          continue;
        }
        target.push({
          ...clone(item),
          id: uniqueId(
            `${prefix}-${videoId}-${item.id}`,
            `${prefix}-${videoId}`,
            usedIds
          ),
          clipId: SHORT_FORM_CANVAS_CLIP_ID,
          startOffsetMs: timelineStartMs + overlapStartMs - sourceStartMs,
          endOffsetMs: timelineStartMs + overlapEndMs - sourceStartMs
        });
      }
    };
    copyTimedItems(
      parentProject.subtitles,
      subtitles,
      usedSubtitleIds,
      "short-cue",
      (cue) => structuredClone(cue)
    );
    copyTimedItems(
      parentProject.imageAssets,
      imageAssets,
      usedImageIds,
      "short-image",
      (asset) => structuredClone(asset)
    );
    copyTimedItems(
      parentProject.audioRegions,
      audioRegions,
      usedRegionIds,
      "short-audio",
      (region) => ({ ...region })
    );
    selectedVideoLayerId = videoId;
    timelineCursorMs = timelineEndMs;
    added += 1;
  }
  if (added === 0) {
    return previous;
  }
  return normalizeShortFormBranch({
    ...previous,
    durationMs: Math.max(SHORT_FORM_MIN_CLIP_DURATION_MS, timelineCursorMs),
    videoAssets: rawVideoAssets,
    sourceAudioAssets: rawAudioAssets,
    subtitles,
    imageAssets,
    audioRegions,
    selectedVideoLayerId,
    playheadMs: rawVideoAssets.find((asset) => asset.id === selectedVideoLayerId)
      ?.timelineStartMs || 0,
    revision: nextRevision(previous)
  }, projectContext(parentProject));
}

export function appendShortFormClips(
  parentProject: EditorProject,
  branchValue: unknown,
  clipIds: readonly unknown[]
): EditorShortFormBranch {
  const requestedIds = new Set(Array.from(
    clipIds || [],
    (value) => nonEmptyString(value)
  ));
  const requests = parentProject.clips
    .filter((clip) => clip.enabled !== false && (
      requestedIds.has(clip.id) || requestedIds.has(clip.selectionId)
    ))
    .map((clip) => ({
      sourceClipId: clip.id,
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: clip.sourceEndMs,
      sourceRect: defaultSourceRect(),
      destinationRect: defaultDestinationRect()
    }));
  return appendShortFormSlices(parentProject, branchValue, requests);
}

/** Compatibility API: v7 has no scene-owned base, so this removes only that visual. */
export function removeShortFormClip(
  branchValue: unknown,
  clipIdValue: unknown
): EditorShortFormBranch {
  const id = nonEmptyString(clipIdValue);
  const branch = normalizeShortFormBranch(branchValue);
  const candidateIds = new Set([id, shortFormBaseVideoLayerId(id)]);
  const target = branch.videoAssets.find((asset) => candidateIds.has(asset.id));
  return target ? removeShortFormVideoAsset(branch, target.id) : branch;
}

export function canAddShortFormVideoLayer(
  branchValue: unknown,
  clipIdValue: unknown
): boolean {
  const branch = normalizeShortFormBranch(branchValue);
  const clipId = nonEmptyString(clipIdValue);
  const clip = branch.clips.find((candidate) => candidate.id === clipId);
  return Boolean(
    clip
    && canAddShortFormVideoAsset(
      branch,
      clip.timelineStartMs,
      clip.timelineStartMs + shortClipDuration(clip)
    )
  );
}

export function addShortFormVideoLayer(
  branchValue: unknown,
  clipIdValue: unknown,
  input: ShortFormVideoLayerInput
): EditorShortFormBranch {
  const branch = normalizeShortFormBranch(branchValue);
  const raw = recordOrNull(input);
  if (!raw) {
    return branch;
  }
  const clipId = nonEmptyString(clipIdValue);
  const clip = branch.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return branch;
  }
  return addShortFormVideoAsset(branch, {
    ...raw,
    timelineStartMs: clip.timelineStartMs + integer(raw.startOffsetMs),
    timelineEndMs: clip.timelineStartMs + integer(raw.endOffsetMs)
  } as ShortFormVideoAssetInput);
}

export function updateShortFormVideoLayer(
  branchValue: unknown,
  clipIdValue: unknown,
  layerIdValue: unknown,
  update: Partial<Omit<ShortFormVideoLayer, "id">>
): EditorShortFormBranch {
  const branch = normalizeShortFormBranch(branchValue);
  const clipId = nonEmptyString(clipIdValue);
  const clip = branch.clips.find((candidate) => candidate.id === clipId);
  const raw = recordOrNull(update) || {};
  return updateShortFormVideoAsset(branch, layerIdValue, {
    ...raw,
    ...(raw.startOffsetMs === undefined
      ? {}
      : { timelineStartMs: (clip?.timelineStartMs || 0) + integer(raw.startOffsetMs) }),
    ...(raw.endOffsetMs === undefined
      ? {}
      : { timelineEndMs: (clip?.timelineStartMs || 0) + integer(raw.endOffsetMs) })
  });
}

export function removeShortFormVideoLayer(
  branchValue: unknown,
  _clipIdValue: unknown,
  layerIdValue: unknown
): EditorShortFormBranch {
  return removeShortFormVideoAsset(branchValue, layerIdValue);
}

export function reorderShortFormVideoLayers(
  branchValue: unknown,
  _clipIdValue: unknown,
  orderedLayerIds: readonly unknown[]
): EditorShortFormBranch {
  return reorderShortFormVideoAssets(branchValue, orderedLayerIds);
}

export function updateShortFormSceneFraming(
  branchValue: EditorShortFormBranch,
  targetIdValue: unknown,
  update: Partial<Pick<
    ShortFormScene,
    | "fit"
    | "positionX"
    | "positionY"
    | "zoom"
    | "canvasX"
    | "canvasY"
    | "canvasScale"
    | "sourceRect"
    | "destinationRect"
  >>
): EditorShortFormBranch {
  const branch = normalizeShortFormBranch(branchValue);
  const targetId = nonEmptyString(targetIdValue);
  const candidate = branch.videoAssets.find((asset) => (
    asset.id === targetId || asset.id === shortFormBaseVideoLayerId(targetId)
  ));
  if (!candidate) {
    return branch;
  }
  const patch: Partial<ShortFormVideoAsset> = {};
  if (
    update.fit !== undefined
    || update.positionX !== undefined
    || update.positionY !== undefined
    || update.zoom !== undefined
    || update.canvasX !== undefined
    || update.canvasY !== undefined
    || update.canvasScale !== undefined
  ) {
    const fit: ShortFormFit = update.fit === "contain"
      ? "contain"
      : update.fit === "cover"
        ? "cover"
        : candidate.fit || "cover";
    patch.fit = fit;
    patch.positionX = fit === "contain"
      ? 0.5
      : clamp(update.positionX, 0, 1, candidate.positionX ?? 0.5);
    patch.positionY = fit === "contain"
      ? 0.5
      : clamp(update.positionY, 0, 1, candidate.positionY ?? 0.5);
    patch.zoom = fit === "contain"
      ? 1
      : clampShortFormZoom(update.zoom, candidate.zoom ?? 1);
    patch.canvasX = clamp(update.canvasX, 0, 1, candidate.canvasX ?? 0.5);
    patch.canvasY = clamp(update.canvasY, 0, 1, candidate.canvasY ?? 0.5);
    patch.canvasScale = clampShortFormCanvasScale(
      update.canvasScale,
      candidate.canvasScale ?? 1
    );
  }
  if (update.sourceRect !== undefined) {
    const sourceRect = normalizeShortFormSourceRect(update.sourceRect);
    if (sourceRect) {
      patch.sourceRect = sourceRect;
    }
  }
  if (update.destinationRect !== undefined) {
    const destinationRect = normalizeShortFormDestinationRect(update.destinationRect);
    if (destinationRect) {
      patch.destinationRect = destinationRect;
    }
  }
  return Object.keys(patch).length > 0
    ? updateShortFormVideoAsset(branch, candidate.id, patch)
    : branch;
}

function numericRecordEqual<T extends object>(
  left: T,
  right: T,
  keys: readonly (keyof T)[]
): boolean {
  return keys.every((key) => left[key] === right[key]);
}

export function shortFormSceneGeometryEquals(
  left: ShortFormScene | null | undefined,
  right: ShortFormScene | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }
  if (left.sourceRect && left.destinationRect && right.sourceRect && right.destinationRect) {
    return numericRecordEqual(
      left.sourceRect,
      right.sourceRect,
      ["x", "y", "width", "height", "referenceWidth", "referenceHeight"]
    ) && numericRecordEqual(
      left.destinationRect,
      right.destinationRect,
      ["x", "y", "width", "height"]
    );
  }
  return left.fit === right.fit
    && left.positionX === right.positionX
    && left.positionY === right.positionY
    && left.zoom === right.zoom
    && left.canvasX === right.canvasX
    && left.canvasY === right.canvasY
    && left.canvasScale === right.canvasScale;
}

/** v7 has no adjacent scene ownership; callers should edit assets directly. */
export function mergeAdjacentShortFormScenes(
  branchValue: unknown,
  _leftClipIdValue: unknown,
  _rightClipIdValue: unknown
): EditorShortFormBranch {
  return normalizeShortFormBranch(branchValue);
}
