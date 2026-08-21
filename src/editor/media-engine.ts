/*! @license
 * Third-party integration: Mediabunny 1.51.0 is MPL-2.0 licensed.
 * The exact corresponding source and full license are recorded in
 * `legal/THIRD_PARTY_NOTICES.md` and packaged as
 * `web/licenses/MEDIABUNNY-MPL-2.0.txt`. KirinukiHelper's adapter code
 * and the bundled upstream library remain separately licensed.
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo
} from "mediabunny";
import type {
  AudioCodec,
  EncodedPacket,
  InputAudioTrack,
  InputTrack,
  OutputFormat,
  VideoCodec
} from "mediabunny";

import {
  localMediaEngineLoopbackRequestInit
} from "../lib/local-media-engine-contract.js";
import {
  exactBase64UrlBytes
} from "../lib/local-media-engine-auth.js";

import {
  AdaptiveVideoScaler
} from "./adaptive-video-scaler.js";
import type {
  AdaptiveMediabunnyVideoSample,
  AdaptiveVideoPlacement,
  AdaptiveVideoScalerSurface
} from "./adaptive-video-scaler.js";

import {
  audioRegionTimelineRange,
  clamp,
  cueTimelineRange,
  findAudioRegionOverlaps,
  findSubtitleOverlaps,
  imageAssetTimelineRange,
  imageAssetsAtTimeline,
  resolveSubtitleCueBackground
} from "../lib/editor-core.js";
import type {
  EditorClip,
  EditorImageAsset,
  EditorProject,
  EditorSubtitleCue
} from "../lib/editor-core.js";
import {
  SHORT_FORM_OUTPUT_HEIGHT,
  SHORT_FORM_OUTPUT_WIDTH,
  SHORT_FORM_MAX_ADDITIONAL_VIDEO_LAYERS,
  SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS as MODEL_SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS,
  SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS,
  SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
  clampShortFormCanvasScale,
  clampShortFormZoom,
  normalizeShortFormDestinationRect,
  normalizeShortFormSourceRect,
  normalizeShortFormVideoLayers
} from "../lib/short-form.js";
import type {
  ShortFormDestinationRect,
  ShortFormFit,
  ShortFormSourceAudioAsset,
  ShortFormSourceRect,
  ShortFormVideoAsset,
  ShortFormVideoLayer
} from "../lib/short-form.js";

const PCM_SAMPLE_RATE = 16_000;
const OUTPUT_AUDIO_CHANNELS = 2;
const OUTPUT_AUDIO_SAMPLE_RATE = 48_000;
const OUTPUT_AUDIO_BITRATE = 160_000;
const DEFAULT_VIDEO_BITRATE_PER_PIXEL_FRAME = 0.08;
const SHORT_FORM_VIDEO_BITRATE_PER_PIXEL_FRAME = 0.16;
const DEFAULT_MINIMUM_VIDEO_BITRATE = 2_500_000;
const SHORT_FORM_MINIMUM_VIDEO_BITRATE = 8_000_000;
const FRAME_INDEX_EPSILON = 1e-7;
export const MAX_ACTIVE_IMAGE_ASSET_RGBA_BYTES = 256 * 1024 * 1024;
export const CAPTION_PLACEMENT_ANALYSIS =
  "local-three-band-edge-density-v1";
export const CAPTION_PLACEMENT_SAMPLE_COUNT = 7;

export type RenderClip = EditorClip;
type RenderSubtitleCue = EditorSubtitleCue;
type RenderImageAsset = EditorImageAsset;
export type RenderProject = EditorProject;

export interface PacketCopiedPreviewCache {
  blob: Blob;
  mimeType: string;
  mediaOffsetMs: number;
  packetCount: number;
  hasAudio: boolean;
}

export interface ShortFormRenderLayout {
  kind: "short-form";
  /** v7 black-canvas authority. `scenes` below is legacy v5 only. */
  durationMs?: unknown;
  videoLaneCount?: unknown;
  videoAssets?: readonly unknown[];
  sourceAudioAssets?: readonly unknown[];
  scenes?: readonly unknown[];
}

/** Renderer names retained for callers; v7 model types are the authority. */
export type ShortFormRenderVideoAsset = ShortFormVideoAsset & {
  lane: number;
  audioGain: number;
};
export type ShortFormRenderSourceAudioAsset = ShortFormSourceAudioAsset;

export interface NormalizedShortFormCanvasRenderLayout {
  durationMs: number;
  videoLaneCount: number;
  videoAssets: ShortFormRenderVideoAsset[];
  sourceAudioAssets: ShortFormRenderSourceAudioAsset[];
}

/** Former v5 base plus eight overlays, now all equal visual assets. */
export const SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS =
  MODEL_SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS;

export type RenderLayout = ShortFormRenderLayout | null;

export interface NormalizedShortFormRenderScene {
  clipId: string;
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

export interface VideoCropRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type VideoFrameDrawPlan = (
  | { fit: "contain" }
  | { fit: "fill"; crop: VideoCropRectangle }
);

export const RENDER_LETTERBOX_COLOR = "#000000";

type ImageSmoothingContext = {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
};

/**
 * Browser canvases default to a low-quality resize filter. Short-form footage
 * often enlarges a narrow landscape crop, so make the preview and export use
 * the best browser-native resampler instead of silently accepting that
 * default.
 */
export function enableHighQualityImageSmoothing(
  context: ImageSmoothingContext
): void {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

type ShortFormCompositeContext = (
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
);

interface AdaptiveShortFormScaler {
  readonly surface: AdaptiveVideoScalerSurface;
  renderVideoSample(
    sample: AdaptiveMediabunnyVideoSample,
    placement: AdaptiveVideoPlacement
  ): unknown;
  destroy(): void;
}

export interface AdaptiveShortFormFrameRendererDependencies {
  createSurface?: (
    width: number,
    height: number
  ) => AdaptiveVideoScalerSurface;
  createScaler?: (
    surface: AdaptiveVideoScalerSurface
  ) => AdaptiveShortFormScaler;
  onFailure?: (error: unknown) => void;
}

export type ShortFormRenderBackend = "adaptive" | "canvas2d";

export const SHORT_FORM_FALLBACK_RESTART_PHASE = "fallback-restart";

/**
 * Signals that adaptive frames have already entered the current output and the
 * attempt must therefore be discarded before Canvas2D can be used. Keeping
 * this as a dedicated error prevents a general encoding or cancellation error
 * from accidentally triggering a second export.
 */
export class AdaptiveShortFormRenderRestartRequiredError extends Error {
  override readonly name = "AdaptiveShortFormRenderRestartRequiredError";
  readonly code = "ADAPTIVE_SHORT_FORM_RENDER_RESTART_REQUIRED";
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      "적응형 쇼츠 렌더러가 출력 도중 중단되어 호환 렌더러로 처음부터 다시 처리해야 합니다."
    );
    this.cause = cause;
  }
}

/**
 * Owns one adaptive WebGL scaler for an entire short-form export attempt.
 * Initialization or first-frame failure can safely lock the still-empty
 * attempt to Canvas2D. Once an adaptive frame has been composited, any later
 * failure requires the caller to discard and restart the whole attempt so a
 * completed file never mixes output backends.
 */
export class AdaptiveShortFormFrameRenderer {
  private readonly outputWidth: number;
  private readonly outputHeight: number;
  private readonly onFailure: (error: unknown) => void;
  private scaler: AdaptiveShortFormScaler | null = null;
  private adaptiveDisabled = false;
  private adaptiveFrameCount = 0;
  private restartRequiredError:
    | AdaptiveShortFormRenderRestartRequiredError
    | null = null;
  private destroyed = false;

  constructor(
    outputWidthValue: unknown,
    outputHeightValue: unknown,
    {
      createSurface = (width, height) => new OffscreenCanvas(width, height),
      createScaler = (surface) => new AdaptiveVideoScaler(surface),
      onFailure = (error) => {
        console.warn(
          "적응형 쇼츠 화질 보정 오류를 감지했습니다.",
          error
        );
      }
    }: AdaptiveShortFormFrameRendererDependencies = {}
  ) {
    this.outputWidth = positiveDimension(outputWidthValue);
    this.outputHeight = positiveDimension(outputHeightValue);
    this.onFailure = onFailure;
    try {
      const surface = createSurface(this.outputWidth, this.outputHeight);
      this.scaler = createScaler(surface);
    } catch (error) {
      this.disableAdaptiveScaling(error);
    }
  }

  draw(
    sample: AdaptiveMediabunnyVideoSample,
    context: ShortFormCompositeContext,
    geometry: ShortFormVideoDrawGeometry
  ): "adaptive" | "canvas2d" {
    if (this.destroyed) {
      throw new Error("종료된 쇼츠 프레임 렌더러는 다시 사용할 수 없습니다.");
    }
    if (this.restartRequiredError) {
      throw this.restartRequiredError;
    }
    const scaler = this.scaler;
    if (!this.adaptiveDisabled && scaler) {
      try {
        scaler.renderVideoSample(sample, {
          sourceRect: {
            x: geometry.source.left,
            y: geometry.source.top,
            width: geometry.source.width,
            height: geometry.source.height
          },
          destinationRect: {
            x: geometry.destination.left,
            y: geometry.destination.top,
            width: geometry.destination.width,
            height: geometry.destination.height
          },
          outputWidth: this.outputWidth,
          outputHeight: this.outputHeight
        });
        context.drawImage(scaler.surface, 0, 0);
        this.adaptiveFrameCount += 1;
        return "adaptive";
      } catch (error) {
        const requiresRestart = this.adaptiveFrameCount > 0;
        this.disableAdaptiveScaling(error);
        if (requiresRestart) {
          const restartError = new AdaptiveShortFormRenderRestartRequiredError(
            error
          );
          this.restartRequiredError = restartError;
          throw restartError;
        }
      }
    }
    sample.draw(
      context,
      geometry.source.left,
      geometry.source.top,
      geometry.source.width,
      geometry.source.height,
      geometry.destination.left,
      geometry.destination.top,
      geometry.destination.width,
      geometry.destination.height
    );
    return "canvas2d";
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const scaler = this.scaler;
    this.scaler = null;
    if (!scaler) {
      return;
    }
    try {
      scaler.destroy();
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private disableAdaptiveScaling(error: unknown): void {
    if (this.adaptiveDisabled) {
      return;
    }
    this.adaptiveDisabled = true;
    const scaler = this.scaler;
    this.scaler = null;
    if (scaler) {
      try {
        scaler.destroy();
      } catch {
        // Preserve the original WebGL failure as the diagnostic signal.
      }
    }
    this.reportFailure(error);
  }

  private reportFailure(error: unknown): void {
    try {
      this.onFailure(error);
    } catch {
      // Diagnostics must never make a safe Canvas2D fallback fail.
    }
  }
}

export interface MaterializedLoopbackMediaSource {
  // Runtime wire tag retained for compatibility; this URL is restricted to a
  // completed, verified local artifact and is never a remote media source.
  kind: "local-url";
  url: string;
  name: string;
  size: number;
  type: "video/mp4";
  lastModified: number;
}

export type EditorMediaSource = File | MaterializedLoopbackMediaSource;
export type EditorMediaSourceMode = (
  | "manual-file"
  | "source-vod-selection"
  | "chzzk-vod-selection"
);

type ImageAssetSurface = {
  width: number;
  height: number;
};

type ImageAssetDimensions = {
  width?: number;
  height?: number;
};

type ProgressCallback = (progress: number, phase?: string) => void;
export type RenderResolutionPolicy = "editor-default" | "source-quality-cache";
interface RenderProjectVideoOptions {
  fileHandle?: FileSystemFileHandle | null;
  layout?: RenderLayout;
  onProgress?: ProgressCallback;
  resolutionPolicy?: RenderResolutionPolicy;
  resolveImageAsset?: ResolveImageAsset | null;
  signal?: AbortSignal;
}

interface RenderProjectVideoAttemptOptions extends RenderProjectVideoOptions {
  shortFormBackend: ShortFormRenderBackend;
}

type FetchImplementation = typeof fetch;
type HardwareAcceleration = NonNullable<
  VideoEncoderConfig["hardwareAcceleration"]
>;
type ResolvedImage = ImageBitmap;
type ResolveImageAsset = (
  source: NonNullable<RenderImageAsset["source"]>,
  asset: RenderImageAsset
) => Promise<Blob | null> | Blob | null;

type CaptionPlacement = "top" | "center" | "bottom";
interface CaptionPlacementBand {
  placement: CaptionPlacement;
  start: number;
  end: number;
}

const CAPTION_PLACEMENT_BANDS: readonly CaptionPlacementBand[] = Object.freeze([
  Object.freeze({ placement: "top", start: 0.06, end: 0.34 }),
  Object.freeze({ placement: "center", start: 0.36, end: 0.64 }),
  Object.freeze({ placement: "bottom", start: 0.66, end: 0.94 })
]);
const CAPTION_PLACEMENT_TIE_ORDER: Readonly<Record<CaptionPlacement, number>> =
Object.freeze({
  bottom: 0,
  top: 1,
  center: 2
});

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("작업이 취소되었습니다.", "AbortError");
  }
}

/**
 * Runs at most two complete short-form export attempts. Only the dedicated
 * backend-consistency error can start the Canvas2D attempt; cancellation and
 * every unrelated failure propagate without retrying.
 */
export async function runShortFormRenderWithCanvasRetry<T>(
  attempt: (backend: ShortFormRenderBackend) => Promise<T>,
  {
    signal,
    onFallback = () => {}
  }: {
    signal?: AbortSignal;
    onFallback?: (
      error: AdaptiveShortFormRenderRestartRequiredError
    ) => void;
  } = {}
): Promise<T> {
  throwIfAborted(signal);
  try {
    return await attempt("adaptive");
  } catch (error) {
    if (!(error instanceof AdaptiveShortFormRenderRestartRequiredError)) {
      throw error;
    }
    throwIfAborted(signal);
    onFallback(error);
    throwIfAborted(signal);
    return attempt("canvas2d");
  }
}

export const LOCAL_MEDIA_BLOB_SOURCE_OPTIONS = Object.freeze({
  maxCacheSize: 16 * 1024 * 1024,
  // Chromium can retain one file descriptor per blob.stream() reader after
  // random seeks. Long editing sessions then exhaust the renderer descriptor
  // limit and surface a misleading local "NetworkError". Mediabunny provides
  // this stable slice().arrayBuffer() path specifically for that browser bug.
  useStreamReader: false
});

export function normalizeMaterializedLoopbackMediaSource(
  value: unknown
): MaterializedLoopbackMediaSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("로컬 미디어 주소 정보가 올바르지 않습니다.");
  }
  const source = value as Record<string, unknown>;
  let url: URL;
  try {
    url = new URL(String(source.url || ""));
  } catch {
    throw new TypeError("로컬 미디어 주소가 올바르지 않습니다.");
  }
  const size = Math.round(Number(source.size));
  const lastModified = Math.round(Number(source.lastModified));
  const name = String(source.name || "").trim();
  const mediaPath = /^\/v1\/vod\/media\/[A-Za-z0-9_-]{16,128}$/u.test(
    url.pathname
  );
  const accessValues = url.searchParams.getAll("access");
  if (
    source.kind !== "local-url"
    || source.url !== url.toString()
    || url.origin !== "http://127.0.0.1:4319"
    || !mediaPath
    || url.username
    || url.password
    || url.hash
    || [...url.searchParams.keys()].some((key) => key !== "access")
    || accessValues.length !== 1
    || !exactBase64UrlBytes(accessValues[0], 32)
    || !name
    || name.length > 240
    || /[\\/\u0000-\u001f\u007f]/u.test(name)
    || !Number.isSafeInteger(size)
    || size <= 0
    || !Number.isSafeInteger(lastModified)
    || lastModified <= 0
    || source.type !== "video/mp4"
  ) {
    throw new TypeError("로컬 미디어 주소의 보안 범위나 메타데이터가 올바르지 않습니다.");
  }
  return {
    kind: "local-url",
    url: url.toString(),
    name,
    size,
    type: "video/mp4",
    lastModified
  };
}

export function isMaterializedLoopbackMediaSource(
  value: EditorMediaSource | null | undefined
): value is MaterializedLoopbackMediaSource {
  return Boolean(
    value
    && !(value instanceof File)
    && value.kind === "local-url"
  );
}

export function assertEditorMediaSourceMode(
  source: EditorMediaSource,
  mode: EditorMediaSourceMode
): void {
  const materialized = isMaterializedLoopbackMediaSource(source);
  if ((mode !== "manual-file") !== materialized) {
    throw new TypeError(
      "VOD materialization은 검증된 loopback 편집 영상과 함께, 수동 연결은 File과 함께 사용해야 합니다."
    );
  }
}

function createInput(source: EditorMediaSource): Input {
  if (isMaterializedLoopbackMediaSource(source)) {
    const local = normalizeMaterializedLoopbackMediaSource(source);
    return new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(local.url, {
        maxCacheSize: 16 * 1024 * 1024,
        parallelism: 2,
        requestInit: localMediaEngineLoopbackRequestInit({
          cache: "no-store",
          credentials: "omit",
          mode: "cors",
          redirect: "error"
        }),
        getRetryDelay: (previousAttempts) => (
          previousAttempts >= 3
            ? null
            : 0.15 * 2 ** previousAttempts
        )
      })
    });
  }
  return new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(source, LOCAL_MEDIA_BLOB_SOURCE_OPTIONS)
  });
}

export function exportProgressPercent(progress: unknown): number {
  const value = Math.max(0, Math.min(1, Number(progress) || 0));
  return value >= 1
    ? 100
    : Math.min(99, Math.floor(value * 100));
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clampRenderPosition(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0.5;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(1, Math.max(0, parsed))
    : 0.5;
}

function isShortFormRenderLayout(
  layout: RenderLayout | undefined
): layout is ShortFormRenderLayout {
  return Boolean(layout && layout.kind === "short-form");
}

export function resolveShortFormRenderScene(
  layout: ShortFormRenderLayout,
  clipIdValue: unknown,
  clipDurationMsValue?: unknown
): NormalizedShortFormRenderScene {
  const clipId = String(clipIdValue || "").trim();
  const scenes = Array.isArray(layout?.scenes) ? layout.scenes : [];
  const candidate = scenes
    .map(recordOrNull)
    .find((scene) => (
      String(scene?.clipId || scene?.selectionId || "").trim() === clipId
    ));
  const fit = candidate?.fit === "contain" ? "contain" : "cover";
  const sourceRect = normalizeShortFormSourceRect(candidate?.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(
    candidate?.destinationRect
  );
  const exactRects = sourceRect && destinationRect
    ? { sourceRect, destinationRect }
    : {};
  const rawVideoLayers = Array.isArray(candidate?.videoLayers)
    ? candidate.videoLayers
    : [];
  const explicitClipDurationMs = Number(clipDurationMsValue);
  const inferredClipDurationMs = rawVideoLayers.reduce((maximum, value) => {
    const raw = recordOrNull(value);
    const endOffsetMs = Number(raw?.endOffsetMs);
    return Number.isFinite(endOffsetMs)
      ? Math.max(maximum, endOffsetMs)
      : maximum;
  }, 0);
  const videoLayers = normalizeShortFormVideoLayers(
    rawVideoLayers,
    Number.isFinite(explicitClipDurationMs) && explicitClipDurationMs > 0
      ? explicitClipDurationMs
      : inferredClipDurationMs
  );
  return {
    clipId,
    fit,
    positionX: fit === "contain" ? 0.5 : clampRenderPosition(candidate?.positionX),
    positionY: fit === "contain" ? 0.5 : clampRenderPosition(candidate?.positionY),
    zoom: fit === "contain" ? 1 : clampShortFormZoom(candidate?.zoom),
    canvasX: clampRenderPosition(candidate?.canvasX),
    canvasY: clampRenderPosition(candidate?.canvasY),
    canvasScale: clampShortFormCanvasScale(candidate?.canvasScale),
    ...exactRects,
    ...(videoLayers.length > 0 ? { videoLayers } : {})
  };
}

function exactFiniteNumericFields(
  raw: Record<string, unknown> | null,
  normalized: Record<string, number>,
  keys: readonly string[]
): boolean {
  return Boolean(raw) && keys.every((key) => (
    typeof raw![key] === "number"
    && Number.isFinite(raw![key])
    && raw![key] === normalized[key]
  ));
}

function exactSafeInteger(
  raw: Record<string, unknown>,
  key: string,
  minimum = 0
): number | null {
  const value = raw[key];
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
  )
    ? value
    : null;
}

function exactShortFormRenderSourceIdentity(
  raw: Record<string, unknown>
): {
  sourceAssetId: typeof SHORT_FORM_PRIMARY_SOURCE_ASSET_ID;
  sourceClipId: string;
  sourceSelectionStartMs: number;
  sourceSelectionEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
} | null {
  const sourceClipId = typeof raw.sourceClipId === "string"
    ? raw.sourceClipId.trim()
    : "";
  const sourceSelectionStartMs = exactSafeInteger(
    raw,
    "sourceSelectionStartMs"
  );
  const sourceSelectionEndMs = exactSafeInteger(
    raw,
    "sourceSelectionEndMs"
  );
  const sourceStartMs = exactSafeInteger(raw, "sourceStartMs");
  const sourceEndMs = exactSafeInteger(raw, "sourceEndMs");
  const timelineStartMs = exactSafeInteger(raw, "timelineStartMs");
  const timelineEndMs = exactSafeInteger(raw, "timelineEndMs");
  if (
    raw.sourceAssetId !== SHORT_FORM_PRIMARY_SOURCE_ASSET_ID
    || !sourceClipId
    || raw.sourceClipId !== sourceClipId
    || sourceSelectionStartMs === null
    || sourceSelectionEndMs === null
    || sourceStartMs === null
    || sourceEndMs === null
    || timelineStartMs === null
    || timelineEndMs === null
    || sourceSelectionEndMs - sourceSelectionStartMs < 100
    || sourceEndMs - sourceStartMs < 100
    || sourceStartMs < sourceSelectionStartMs
    || sourceEndMs > sourceSelectionEndMs
    || timelineEndMs - timelineStartMs < 100
    || sourceEndMs - sourceStartMs !== timelineEndMs - timelineStartMs
  ) {
    return null;
  }
  return {
    sourceAssetId: SHORT_FORM_PRIMARY_SOURCE_ASSET_ID,
    sourceClipId,
    sourceSelectionStartMs,
    sourceSelectionEndMs,
    sourceStartMs,
    sourceEndMs,
    timelineStartMs,
    timelineEndMs
  };
}

function exactShortFormRenderVideoAsset(
  value: unknown,
  canvasDurationMs: number,
  mediaDurationMs: number
): ShortFormRenderVideoAsset | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const source = exactShortFormRenderSourceIdentity(raw);
  const sourceRect = normalizeShortFormSourceRect(raw.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(raw.destinationRect);
  const opacity = typeof raw.opacity === "number" && Number.isFinite(raw.opacity)
    ? raw.opacity
    : Number.NaN;
  const audioGain = typeof raw.audioGain === "number" && Number.isFinite(raw.audioGain)
    ? raw.audioGain
    : Number.NaN;
  const lane = exactSafeInteger(raw, "lane");
  const zIndex = exactSafeInteger(raw, "zIndex");
  if (
    !id
    || raw.id !== id
    || id.length > 160
    || !source
    || !sourceRect
    || !destinationRect
    || !exactFiniteNumericFields(recordOrNull(raw.sourceRect), {
      x: sourceRect.x,
      y: sourceRect.y,
      width: sourceRect.width,
      height: sourceRect.height,
      referenceWidth: sourceRect.referenceWidth,
      referenceHeight: sourceRect.referenceHeight
    }, ["x", "y", "width", "height", "referenceWidth", "referenceHeight"])
    || !exactFiniteNumericFields(recordOrNull(raw.destinationRect), {
      x: destinationRect.x,
      y: destinationRect.y,
      width: destinationRect.width,
      height: destinationRect.height
    }, ["x", "y", "width", "height"])
    || !Number.isFinite(opacity)
    || opacity < 0
    || opacity > 1
    || !Number.isFinite(audioGain)
    || audioGain < 0
    || audioGain > 2
    || lane === null
    || typeof raw.visible !== "boolean"
    || zIndex === null
    || zIndex > 1_000
    || source.timelineEndMs > canvasDurationMs
    || source.sourceSelectionEndMs > mediaDurationMs + 0.5
    || source.sourceEndMs > mediaDurationMs + 0.5
  ) {
    return null;
  }
  return {
    id,
    ...source,
    sourceRect,
    destinationRect,
    opacity,
    audioGain,
    lane,
    visible: raw.visible,
    zIndex
  };
}

function exactShortFormRenderSourceAudioAsset(
  value: unknown,
  canvasDurationMs: number,
  mediaDurationMs: number
): ShortFormRenderSourceAudioAsset | null {
  const raw = recordOrNull(value);
  if (!raw) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const source = exactShortFormRenderSourceIdentity(raw);
  const gain = typeof raw.gain === "number" && Number.isFinite(raw.gain)
    ? raw.gain
    : Number.NaN;
  const fadeInMs = exactSafeInteger(raw, "fadeInMs");
  const fadeOutMs = exactSafeInteger(raw, "fadeOutMs");
  const assetDurationMs = source
    ? source.timelineEndMs - source.timelineStartMs
    : 0;
  if (
    !id
    || raw.id !== id
    || id.length > 160
    || !source
    || !Number.isFinite(gain)
    || gain < 0
    || gain > 1
    || typeof raw.muted !== "boolean"
    || fadeInMs === null
    || fadeOutMs === null
    || fadeInMs > assetDurationMs
    || fadeOutMs > assetDurationMs
    || source.timelineEndMs > canvasDurationMs
    || source.sourceSelectionEndMs > mediaDurationMs + 0.5
    || source.sourceEndMs > mediaDurationMs + 0.5
  ) {
    return null;
  }
  return {
    id,
    ...source,
    gain,
    muted: raw.muted,
    fadeInMs,
    fadeOutMs
  };
}

function shortFormSourceTimelineRangeKey(
  asset: Pick<
    ShortFormRenderSourceAudioAsset,
    | "sourceAssetId"
    | "sourceClipId"
    | "sourceStartMs"
    | "sourceEndMs"
    | "timelineStartMs"
    | "timelineEndMs"
  >
): string {
  return JSON.stringify([
    asset.sourceAssetId,
    asset.sourceClipId,
    asset.sourceStartMs,
    asset.sourceEndMs,
    asset.timelineStartMs,
    asset.timelineEndMs
  ]);
}

function uniqueDerivedShortFormAudioAssetId(
  videoAssetId: string,
  usedIds: Set<string>
): string {
  const maximumIdLength = 160;
  const base = `video-audio:${videoAssetId}`.slice(0, maximumIdLength);
  let candidate = base;
  let collisionIndex = 2;
  while (usedIds.has(candidate)) {
    const suffix = `:${collisionIndex}`;
    candidate = `${base.slice(0, maximumIdLength - suffix.length)}${suffix}`;
    collisionIndex += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function defaultShortFormAudioAssetForVideo(
  videoAsset: ShortFormRenderVideoAsset,
  usedIds: Set<string>
): ShortFormRenderSourceAudioAsset {
  return {
    id: uniqueDerivedShortFormAudioAssetId(videoAsset.id, usedIds),
    sourceAssetId: videoAsset.sourceAssetId,
    sourceClipId: videoAsset.sourceClipId,
    sourceSelectionStartMs: videoAsset.sourceSelectionStartMs,
    sourceSelectionEndMs: videoAsset.sourceSelectionEndMs,
    sourceStartMs: videoAsset.sourceStartMs,
    sourceEndMs: videoAsset.sourceEndMs,
    timelineStartMs: videoAsset.timelineStartMs,
    timelineEndMs: videoAsset.timelineEndMs,
    gain: videoAsset.audioGain,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0
  };
}

/** Returns true only for the authoritative v7 canvas shape, never v5 scenes. */
export function isShortFormCanvasRenderLayout(
  layout: RenderLayout | undefined
): layout is ShortFormRenderLayout & {
  durationMs: unknown;
  videoLaneCount: unknown;
  videoAssets: readonly unknown[];
  sourceAudioAssets: readonly unknown[];
} {
  return Boolean(
    isShortFormRenderLayout(layout)
    && (
      layout.durationMs !== undefined
      || layout.videoLaneCount !== undefined
      || layout.videoAssets !== undefined
      || layout.sourceAudioAssets !== undefined
    )
  );
}

/**
 * Strict v7 export validation. Unlike editor normalization this never drops or
 * clamps malformed assets into a valid-looking black frame.
 */
export function validateShortFormCanvasRenderLayout(
  layout: ShortFormRenderLayout,
  mediaDurationMsValue: unknown
): NormalizedShortFormCanvasRenderLayout {
  const durationMs = Number(layout.durationMs);
  const videoLaneCount = Number(layout.videoLaneCount);
  const mediaDurationMs = Number(mediaDurationMsValue);
  if (
    typeof layout.durationMs !== "number"
    || !Number.isSafeInteger(durationMs)
    || durationMs < 100
  ) {
    throw new Error("쇼츠 검은 캔버스의 재생 길이가 올바르지 않습니다.");
  }
  if (
    typeof layout.videoLaneCount !== "number"
    || !Number.isSafeInteger(videoLaneCount)
    || videoLaneCount < 1
    || videoLaneCount > SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS
  ) {
    throw new Error(
      `쇼츠 영상 에셋 라인 수가 올바르지 않습니다. 1–${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS} 사이여야 합니다.`
    );
  }
  if (!Number.isFinite(mediaDurationMs) || mediaDurationMs <= 0) {
    throw new Error("쇼츠 자산의 원본 길이를 확인하지 못했습니다.");
  }
  if (!Array.isArray(layout.videoAssets)) {
    throw new Error("쇼츠 영상 자산 목록이 올바르지 않습니다.");
  }
  if (!Array.isArray(layout.sourceAudioAssets)) {
    throw new Error("쇼츠 원본 음성 자산 목록이 올바르지 않습니다.");
  }

  const videoAssets = layout.videoAssets.map((value) => (
    exactShortFormRenderVideoAsset(value, durationMs, mediaDurationMs)
  ));
  if (videoAssets.some((asset) => !asset)) {
    throw new Error("쇼츠 영상 자산의 저장값이 정규 형식과 일치하지 않습니다.");
  }
  const normalizedVideoAssets = videoAssets as ShortFormRenderVideoAsset[];
  if (normalizedVideoAssets.length > SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS) {
    throw new Error(
      `쇼츠 영상 자산은 한 프로젝트에 최대 ${SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS}개입니다.`
    );
  }
  const videoIds = new Set(normalizedVideoAssets.map((asset) => asset.id));
  if (videoIds.size !== normalizedVideoAssets.length) {
    throw new Error("쇼츠 영상 자산 ID는 중복될 수 없습니다.");
  }
  const concurrencyEvents = normalizedVideoAssets
    .filter((asset) => asset.visible && asset.opacity > 0)
    .flatMap((asset) => [
      { timeMs: asset.timelineStartMs, delta: 1 },
      { timeMs: asset.timelineEndMs, delta: -1 }
    ])
    .sort((left, right) => left.timeMs - right.timeMs || left.delta - right.delta);
  let activeCount = 0;
  for (const event of concurrencyEvents) {
    activeCount += event.delta;
    if (activeCount > SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS) {
      throw new Error(
        `한 시각에 표시할 쇼츠 영상은 최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개입니다.`
      );
    }
  }
  if (normalizedVideoAssets.some((asset) => asset.lane >= videoLaneCount)) {
    throw new Error("쇼츠 영상 자산의 라인이 올바르지 않습니다. 현재 영상 라인 수를 벗어났습니다.");
  }
  const videosByLane = new Map<number, ShortFormRenderVideoAsset[]>();
  for (const asset of normalizedVideoAssets) {
    const laneAssets = videosByLane.get(asset.lane) || [];
    const overlaps = laneAssets.some((candidate) => (
      asset.timelineStartMs < candidate.timelineEndMs
      && asset.timelineEndMs > candidate.timelineStartMs
    ));
    if (overlaps) {
      throw new Error("같은 쇼츠 영상 에셋 라인에서 영상끼리는 겹칠 수 없습니다.");
    }
    laneAssets.push(asset);
    videosByLane.set(asset.lane, laneAssets);
  }

  const sourceAudioAssets = layout.sourceAudioAssets.map((value) => (
    exactShortFormRenderSourceAudioAsset(value, durationMs, mediaDurationMs)
  ));
  if (sourceAudioAssets.some((asset) => !asset)) {
    throw new Error("쇼츠 원본 음성 자산의 저장값이 정규 형식과 일치하지 않습니다.");
  }
  const explicitSourceAudioAssets = (
    sourceAudioAssets as ShortFormRenderSourceAudioAsset[]
  );
  const sourceAudioIds = new Set(
    explicitSourceAudioAssets.map((asset) => asset.id)
  );
  if (sourceAudioIds.size !== explicitSourceAudioAssets.length) {
    throw new Error("쇼츠 원본 음성 자산 ID는 중복될 수 없습니다.");
  }
  const videoRangeKeys = new Set(
    normalizedVideoAssets.map(shortFormSourceTimelineRangeKey)
  );
  const explicitByRangeKey = new Map<string, ShortFormRenderSourceAudioAsset>();
  for (const asset of explicitSourceAudioAssets) {
    const key = shortFormSourceTimelineRangeKey(asset);
    if (explicitByRangeKey.has(key) && videoRangeKeys.has(key)) {
      throw new Error(
        "하나의 쇼츠 영상 음성에 exact legacy 설정을 중복 적용할 수 없습니다."
      );
    }
    explicitByRangeKey.set(key, asset);
  }
  const consumedOverrideIds = new Set<string>();
  const videoSourceAudioAssets = normalizedVideoAssets.flatMap((videoAsset) => {
    // Visibility belongs to the combined A/V asset. A hidden or fully
    // transparent picture must not leak its attached sound into export when
    // preview is silent for that same asset.
    if (!videoAsset.visible || videoAsset.opacity <= 0) {
      return [];
    }
    const explicitOverride = explicitByRangeKey.get(
      shortFormSourceTimelineRangeKey(videoAsset)
    );
    if (!explicitOverride) {
      return [defaultShortFormAudioAssetForVideo(videoAsset, sourceAudioIds)];
    }
    const combinedOverride = {
      ...explicitOverride,
      gain: videoAsset.audioGain * explicitOverride.gain
    };
    if (!consumedOverrideIds.has(explicitOverride.id)) {
      consumedOverrideIds.add(explicitOverride.id);
      return [combinedOverride];
    }
    // Two independently visible videos can deliberately use the same source
    // and timeline span. They remain two A/V contributions, while sharing the
    // legacy override's gain envelope without reusing its persisted ID.
    return [{
      ...combinedOverride,
      id: uniqueDerivedShortFormAudioAssetId(videoAsset.id, sourceAudioIds)
    }];
  });
  const independentLegacyAudioAssets = explicitSourceAudioAssets.filter((asset) => (
    !videoRangeKeys.has(shortFormSourceTimelineRangeKey(asset))
  ));
  const normalizedSourceAudioAssets = [
    ...independentLegacyAudioAssets,
    ...videoSourceAudioAssets
  ].sort((left, right) => (
    left.timelineStartMs - right.timelineStartMs
    || left.timelineEndMs - right.timelineEndMs
    || left.id.localeCompare(right.id)
  ));

  return {
    durationMs,
    videoLaneCount,
    videoAssets: normalizedVideoAssets.sort((left, right) => (
      left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    )),
    sourceAudioAssets: normalizedSourceAudioAssets
  };
}

export function shortFormCanvasCfrFrameRange(
  durationMsValue: unknown,
  frameRateValue: unknown
): { firstFrameIndex: number; endFrameIndex: number } {
  const durationMs = Number(durationMsValue);
  const frameRate = Number(frameRateValue);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError("쇼츠 검은 캔버스의 길이는 0보다 커야 합니다.");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new TypeError("CFR 프레임률은 0보다 큰 숫자여야 합니다.");
  }
  return {
    firstFrameIndex: 0,
    endFrameIndex: Math.ceil(durationMs / 1_000 * frameRate - FRAME_INDEX_EPSILON)
  };
}

export function shortFormCanvasCfrFrameTiming(
  durationMsValue: unknown,
  frameIndex: number,
  frameRateValue: unknown
): { localTimestamp: number; outputTimestamp: number; duration: number } {
  const durationMs = Number(durationMsValue);
  const frameRate = Number(frameRateValue);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError("쇼츠 검은 캔버스의 길이는 0보다 커야 합니다.");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new TypeError("CFR 프레임률은 0보다 큰 숫자여야 합니다.");
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new TypeError("CFR 프레임 인덱스는 0 이상의 정수여야 합니다.");
  }
  const outputTimestamp = frameIndex / frameRate;
  return {
    localTimestamp: outputTimestamp,
    outputTimestamp,
    duration: Math.max(
      0,
      Math.min(1 / frameRate, durationMs / 1_000 - outputTimestamp)
    )
  };
}

export function shortFormVideoAssetSourceTimeMs(
  asset: Pick<
    ShortFormRenderVideoAsset,
    "sourceStartMs" | "sourceEndMs" | "timelineStartMs" | "timelineEndMs"
  >,
  timelineMsValue: unknown
): number | null {
  const timelineMs = Number(timelineMsValue);
  if (
    !Number.isFinite(timelineMs)
    || timelineMs < asset.timelineStartMs
    || timelineMs >= asset.timelineEndMs
  ) {
    return null;
  }
  const sourceTimeMs = asset.sourceStartMs + timelineMs - asset.timelineStartMs;
  return sourceTimeMs >= asset.sourceStartMs && sourceTimeMs < asset.sourceEndMs
    ? sourceTimeMs
    : null;
}

export function activeShortFormRenderVideoAssets(
  layout: Pick<NormalizedShortFormCanvasRenderLayout, "videoAssets">,
  timelineMsValue: unknown
): ShortFormRenderVideoAsset[] {
  const timelineMs = Number(timelineMsValue);
  if (!Number.isFinite(timelineMs)) {
    return [];
  }
  return layout.videoAssets.filter((asset) => (
    asset.visible
    && asset.opacity > 0
    && shortFormVideoAssetSourceTimeMs(asset, timelineMs) !== null
  )).sort((left, right) => (
    left.zIndex - right.zIndex || left.id.localeCompare(right.id)
  ));
}

export function* shortFormVideoAssetSourceTimestamps(
  asset: Pick<
    ShortFormRenderVideoAsset,
    "sourceStartMs" | "sourceEndMs" | "timelineStartMs" | "timelineEndMs"
  >,
  canvasDurationMs: unknown,
  frameRate: unknown,
  mediaOriginSecondsValue: unknown = 0
): Generator<number> {
  const mediaOriginSeconds = Number(mediaOriginSecondsValue);
  if (!Number.isFinite(mediaOriginSeconds)) {
    throw new TypeError("쇼츠 영상 자산의 미디어 원점이 올바르지 않습니다.");
  }
  const { firstFrameIndex, endFrameIndex } = shortFormCanvasCfrFrameRange(
    canvasDurationMs,
    frameRate
  );
  for (let frameIndex = firstFrameIndex; frameIndex < endFrameIndex; frameIndex += 1) {
    const timing = shortFormCanvasCfrFrameTiming(
      canvasDurationMs,
      frameIndex,
      frameRate
    );
    if (timing.duration <= 0) {
      continue;
    }
    const sourceTimeMs = shortFormVideoAssetSourceTimeMs(
      asset,
      timing.outputTimestamp * 1_000
    );
    if (sourceTimeMs !== null) {
      yield mediaOriginSeconds + sourceTimeMs / 1_000;
    }
  }
}

function exactShortFormRenderVideoLayer(
  value: unknown,
  normalized: ShortFormVideoLayer
): boolean {
  const raw = recordOrNull(value);
  const sourceRect = recordOrNull(raw?.sourceRect);
  const destinationRect = recordOrNull(raw?.destinationRect);
  if (!raw) {
    return false;
  }
  return (
    typeof raw.id === "string"
    && raw.id === normalized.id
    && raw.sourceAssetId === normalized.sourceAssetId
    && typeof raw.sourceClipId === "string"
    && raw.sourceClipId === normalized.sourceClipId
    && exactFiniteNumericFields(raw, {
      sourceSelectionStartMs: normalized.sourceSelectionStartMs,
      sourceSelectionEndMs: normalized.sourceSelectionEndMs,
      sourceStartMs: normalized.sourceStartMs,
      sourceEndMs: normalized.sourceEndMs,
      startOffsetMs: normalized.startOffsetMs,
      endOffsetMs: normalized.endOffsetMs,
      opacity: normalized.opacity,
      zIndex: normalized.zIndex
    }, [
      "sourceSelectionStartMs",
      "sourceSelectionEndMs",
      "sourceStartMs",
      "sourceEndMs",
      "startOffsetMs",
      "endOffsetMs",
      "opacity",
      "zIndex"
    ])
    && typeof raw.visible === "boolean"
    && raw.visible === normalized.visible
    && exactFiniteNumericFields(sourceRect, {
      x: normalized.sourceRect.x,
      y: normalized.sourceRect.y,
      width: normalized.sourceRect.width,
      height: normalized.sourceRect.height,
      referenceWidth: normalized.sourceRect.referenceWidth,
      referenceHeight: normalized.sourceRect.referenceHeight
    }, ["x", "y", "width", "height", "referenceWidth", "referenceHeight"])
    && exactFiniteNumericFields(destinationRect, {
      x: normalized.destinationRect.x,
      y: normalized.destinationRect.y,
      width: normalized.destinationRect.width,
      height: normalized.destinationRect.height
    }, ["x", "y", "width", "height"])
  );
}

/**
 * Fail-closed validation for the additional video decoders used by export.
 * Current projects have exactly one local media asset, so every layer range
 * must fit that same source clock. A missing frame is never treated as a
 * transparent success.
 */
export function validateShortFormRenderVideoLayers(
  layout: ShortFormRenderLayout,
  clips: readonly RenderClip[],
  mediaDurationMsValue: unknown
): void {
  const mediaDurationMs = Number(mediaDurationMsValue);
  if (!Number.isFinite(mediaDurationMs) || mediaDurationMs <= 0) {
    throw new Error("추가 영상 레이어의 원본 길이를 확인하지 못했습니다.");
  }
  const rawScenes = Array.isArray(layout.scenes) ? layout.scenes : [];
  for (const clip of clips) {
    const rawScene = rawScenes
      .map(recordOrNull)
      .find((scene) => (
        String(scene?.clipId || scene?.selectionId || "").trim()
        === String(clip.id || clip.selectionId || "").trim()
      ));
    if (
      rawScene?.videoLayers !== undefined
      && !Array.isArray(rawScene.videoLayers)
    ) {
      throw new Error(
        `${clip.id || clip.selectionId} 장면의 추가 영상 레이어 목록이 올바르지 않습니다.`
      );
    }
    const rawLayers = Array.isArray(rawScene?.videoLayers)
      ? rawScene.videoLayers
      : [];
    if (rawLayers.length > SHORT_FORM_MAX_ADDITIONAL_VIDEO_LAYERS) {
      throw new RangeError(
        `한 장면에는 추가 영상을 최대 ${SHORT_FORM_MAX_ADDITIONAL_VIDEO_LAYERS}개까지 넣을 수 있습니다.`
      );
    }
    const clipDurationMs = clip.sourceEndMs - clip.sourceStartMs;
    const layers = normalizeShortFormVideoLayers(rawLayers, clipDurationMs);
    if (layers.length !== rawLayers.length) {
      throw new Error(
        `${clip.id || clip.selectionId} 장면의 추가 영상 레이어 정보가 올바르지 않습니다.`
      );
    }
    for (const [index, layer] of layers.entries()) {
      const rawLayer = recordOrNull(rawLayers[index]);
      if (
        typeof rawLayer?.sourceEndMs === "number"
        && Number.isFinite(rawLayer.sourceEndMs)
        && rawLayer.sourceEndMs > mediaDurationMs + 0.5
      ) {
        throw new Error(
          `${layer.id} 추가 영상이 현재 로컬 원본 길이 밖까지 이어집니다.`
        );
      }
      if (!exactShortFormRenderVideoLayer(rawLayers[index], layer)) {
        throw new Error(
          `${layer.id} 추가 영상의 저장값이 정규 형식과 일치하지 않습니다.`
        );
      }
      if (layer.sourceEndMs > mediaDurationMs + 0.5) {
        throw new Error(
          `${layer.id} 추가 영상이 현재 로컬 원본 길이 밖까지 이어집니다.`
        );
      }
      if (
        layer.sourceEndMs - layer.sourceStartMs
        !== layer.endOffsetMs - layer.startOffsetMs
      ) {
        throw new Error(`${layer.id} 추가 영상의 원본·장면 시간이 1x 재생과 맞지 않습니다.`);
      }
    }
  }
}

function positiveDimension(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.round(parsed))
    : 1;
}

export function shortFormCoverCrop(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  targetWidthValue: unknown = SHORT_FORM_OUTPUT_WIDTH,
  targetHeightValue: unknown = SHORT_FORM_OUTPUT_HEIGHT,
  positionXValue: unknown = 0.5,
  positionYValue: unknown = 0.5,
  zoomValue: unknown = 1
): VideoCropRectangle {
  const sourceWidth = positiveDimension(sourceWidthValue);
  const sourceHeight = positiveDimension(sourceHeightValue);
  const targetWidth = positiveDimension(targetWidthValue);
  const targetHeight = positiveDimension(targetHeightValue);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  const positionX = clampRenderPosition(positionXValue);
  const positionY = clampRenderPosition(positionYValue);
  const zoom = clampShortFormZoom(zoomValue);
  const coverWidth = sourceAspect > targetAspect
    ? sourceHeight * targetAspect
    : sourceWidth;
  const coverHeight = sourceAspect > targetAspect
    ? sourceHeight
    : sourceWidth / targetAspect;
  // Mediabunny drawWithFit requires integer display-pixel crop coordinates.
  // Keep the focal point at the requested edge after quantization and clamp
  // the rectangle to the decoded frame.
  const width = Math.max(
    1,
    Math.min(sourceWidth, Math.round(coverWidth / zoom))
  );
  const height = Math.max(
    1,
    Math.min(sourceHeight, Math.round(coverHeight / zoom))
  );
  const availableWidth = Math.max(0, sourceWidth - width);
  const availableHeight = Math.max(0, sourceHeight - height);
  return {
    left: Math.min(
      availableWidth,
      Math.max(0, Math.round(availableWidth * positionX))
    ),
    top: Math.min(
      availableHeight,
      Math.max(0, Math.round(availableHeight * positionY))
    ),
    width,
    height
  };
}

export interface ShortFormVideoDrawGeometry {
  source: VideoCropRectangle;
  destination: VideoCropRectangle;
}

/**
 * Maps a normalized source selection to the actual decoded frame. The stored
 * reference dimensions document the coordinate space used by the editor, but
 * normalized edges deliberately scale to the decoder's current display size
 * so a quality-preserving reconnect keeps the same visual region.
 */
export function shortFormSourceCropFromNormalizedRect(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  rectValue: unknown
): VideoCropRectangle | null {
  const rect = normalizeShortFormSourceRect(rectValue);
  if (!rect) {
    return null;
  }
  const sourceWidth = positiveDimension(sourceWidthValue);
  const sourceHeight = positiveDimension(sourceHeightValue);
  const left = Math.min(
    sourceWidth - 1,
    Math.max(0, Math.round(rect.x * sourceWidth))
  );
  const top = Math.min(
    sourceHeight - 1,
    Math.max(0, Math.round(rect.y * sourceHeight))
  );
  const right = Math.min(
    sourceWidth,
    Math.max(left + 1, Math.round((rect.x + rect.width) * sourceWidth))
  );
  const bottom = Math.min(
    sourceHeight,
    Math.max(top + 1, Math.round((rect.y + rect.height) * sourceHeight))
  );
  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

/** Scales canonical 1080x1920 canvas pixels to a preview or export surface. */
export function shortFormDestinationRectForTarget(
  targetWidthValue: unknown,
  targetHeightValue: unknown,
  rectValue: unknown
): VideoCropRectangle | null {
  const rect = normalizeShortFormDestinationRect(rectValue);
  if (!rect) {
    return null;
  }
  const targetWidth = positiveDimension(targetWidthValue);
  const targetHeight = positiveDimension(targetHeightValue);
  const scaleX = targetWidth / SHORT_FORM_OUTPUT_WIDTH;
  const scaleY = targetHeight / SHORT_FORM_OUTPUT_HEIGHT;
  const left = Math.round(rect.x * scaleX);
  const top = Math.round(rect.y * scaleY);
  const right = Math.round((rect.x + rect.width) * scaleX);
  const bottom = Math.round((rect.y + rect.height) * scaleY);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

/**
 * Resolves the exact source crop and destination rectangle shared by the
 * live 9:16 canvas and the exported video. Paired exact geometry takes
 * precedence; scenes without it retain the legacy fit/focal/canvas behavior.
 */
export function shortFormVideoDrawGeometry(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  targetWidthValue: unknown,
  targetHeightValue: unknown,
  scene: Pick<
    NormalizedShortFormRenderScene,
    | "fit"
    | "positionX"
    | "positionY"
    | "zoom"
    | "canvasX"
    | "canvasY"
    | "canvasScale"
    | "sourceRect"
    | "destinationRect"
  >
): ShortFormVideoDrawGeometry {
  const sourceWidth = positiveDimension(sourceWidthValue);
  const sourceHeight = positiveDimension(sourceHeightValue);
  const targetWidth = positiveDimension(targetWidthValue);
  const targetHeight = positiveDimension(targetHeightValue);
  const scale = clampShortFormCanvasScale(scene.canvasScale);
  const canvasX = clampRenderPosition(scene.canvasX);
  const canvasY = clampRenderPosition(scene.canvasY);
  const source = shortFormSourceCropFromNormalizedRect(
    sourceWidth,
    sourceHeight,
    scene.sourceRect
  ) || (scene.fit === "contain"
    ? { left: 0, top: 0, width: sourceWidth, height: sourceHeight }
    : shortFormCoverCrop(
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      scene.positionX,
      scene.positionY,
      scene.zoom
    ));
  const destination = shortFormDestinationRectForTarget(
    targetWidth,
    targetHeight,
    scene.destinationRect
  );
  if (destination) {
    return { source, destination };
  }
  const sourceAspect = source.width / source.height;
  const targetAspect = targetWidth / targetHeight;
  const baseWidth = scene.fit === "cover" || sourceAspect >= targetAspect
    ? targetWidth
    : targetHeight * sourceAspect;
  const baseHeight = scene.fit === "cover" || sourceAspect < targetAspect
    ? targetHeight
    : targetWidth / sourceAspect;
  const width = Math.max(1, Math.round(baseWidth * scale));
  const height = Math.max(1, Math.round(baseHeight * scale));
  return {
    source,
    destination: {
      left: Math.round(canvasX * targetWidth - width / 2),
      top: Math.round(canvasY * targetHeight - height / 2),
      width,
      height
    }
  };
}

/** Resolves one additional layer's source clock at a scene-local time. */
export function shortFormVideoLayerSourceTimeMs(
  layer: Pick<
    ShortFormVideoLayer,
    "sourceStartMs" | "sourceEndMs" | "startOffsetMs" | "endOffsetMs"
  >,
  localTimeMsValue: unknown
): number | null {
  const localTimeMs = Number(localTimeMsValue);
  if (
    !Number.isFinite(localTimeMs)
    || localTimeMs < layer.startOffsetMs
    || localTimeMs >= layer.endOffsetMs
  ) {
    return null;
  }
  const sourceTimeMs = layer.sourceStartMs + localTimeMs - layer.startOffsetMs;
  return sourceTimeMs >= layer.sourceStartMs && sourceTimeMs < layer.sourceEndMs
    ? sourceTimeMs
    : null;
}

/** Additional layers always carry authoritative source/destination rectangles. */
export function shortFormVideoLayerDrawGeometry(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  targetWidthValue: unknown,
  targetHeightValue: unknown,
  layer: Pick<ShortFormVideoLayer, "sourceRect" | "destinationRect">
): ShortFormVideoDrawGeometry {
  const source = shortFormSourceCropFromNormalizedRect(
    sourceWidthValue,
    sourceHeightValue,
    layer.sourceRect
  );
  const destination = shortFormDestinationRectForTarget(
    targetWidthValue,
    targetHeightValue,
    layer.destinationRect
  );
  if (!source || !destination) {
    throw new Error("추가 영상 레이어의 크롭·캔버스 위치가 올바르지 않습니다.");
  }
  return { source, destination };
}

/** v6 name for the same exact crop/destination geometry contract. */
export function shortFormVideoAssetDrawGeometry(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  targetWidthValue: unknown,
  targetHeightValue: unknown,
  asset: Pick<ShortFormRenderVideoAsset, "sourceRect" | "destinationRect">
): ShortFormVideoDrawGeometry {
  return shortFormVideoLayerDrawGeometry(
    sourceWidthValue,
    sourceHeightValue,
    targetWidthValue,
    targetHeightValue,
    asset
  );
}

export function buildVideoFrameDrawPlan(
  layout: RenderLayout | undefined,
  clip: Pick<RenderClip, "selectionId"> & Partial<Pick<RenderClip, "id">>,
  sourceWidth: unknown,
  sourceHeight: unknown,
  targetWidth: unknown,
  targetHeight: unknown
): VideoFrameDrawPlan {
  if (!isShortFormRenderLayout(layout)) {
    return { fit: "contain" };
  }
  const scene = resolveShortFormRenderScene(layout, clip.id || clip.selectionId);
  const sourceRect = shortFormSourceCropFromNormalizedRect(
    sourceWidth,
    sourceHeight,
    scene.sourceRect
  );
  if (sourceRect) {
    return { fit: "fill", crop: sourceRect };
  }
  if (scene.fit === "contain") {
    return { fit: "contain" };
  }
  return {
    fit: "fill",
    crop: shortFormCoverCrop(
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      scene.positionX,
      scene.positionY,
      scene.zoom
    )
  };
}

function humanBytes(value: unknown): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(0, Number(value) || 0);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function normalizeMediaTimeline(
  firstTimestampSeconds: unknown,
  endTimestampSeconds: unknown
) {
  const first = Number(firstTimestampSeconds);
  const end = Number(endTimestampSeconds);
  const originSeconds = Math.max(0, Number.isFinite(first) ? first : 0);
  const mediaEndSeconds = Number.isFinite(end) ? end : originSeconds;
  const durationSeconds = Math.max(0, mediaEndSeconds - originSeconds);
  return {
    originSeconds,
    endSeconds: mediaEndSeconds,
    durationSeconds,
    mediaOriginMs: Math.round(originSeconds * 1000),
    mediaEndTimestampMs: Math.round(mediaEndSeconds * 1000),
    durationMs: Math.round(durationSeconds * 1000)
  };
}

async function readMediaTimeline(
  input: Input,
  tracks: Array<InputTrack | null>
) {
  const filteredTracks = tracks.filter(
    (track): track is InputTrack => Boolean(track)
  );
  if (filteredTracks.length === 0) {
    return normalizeMediaTimeline(0, 0);
  }

  const firstTimestamp = await input.getFirstTimestamp(filteredTracks);
  const originSeconds = Math.max(0, Number.isFinite(firstTimestamp) ? firstTimestamp : 0);
  let endTimestamp = await input.getDurationFromMetadata(filteredTracks);
  if (
    !Number.isFinite(endTimestamp)
    || (endTimestamp as number) <= originSeconds
  ) {
    endTimestamp = await input.computeDuration(filteredTracks);
  }
  return normalizeMediaTimeline(originSeconds, endTimestamp ?? originSeconds);
}

export function validateRenderClips(
  project: Pick<RenderProject, "clips">,
  mediaDurationMs: unknown
): RenderClip[] {
  const durationMs = Number(mediaDurationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("원본 영상의 유효한 재생 길이를 확인하지 못했습니다.");
  }

  const enabledClips = (project?.clips || []).filter((clip) => clip && clip.enabled !== false);
  if (enabledClips.length === 0) {
    throw new Error("내보낼 활성 사용자 선택 구간이 없습니다.");
  }

  let expectedTimelineStartMs = 0;
  for (const [index, clip] of enabledClips.entries()) {
    const sourceStartMs = Number(clip.sourceStartMs);
    const sourceEndMs = Number(clip.sourceEndMs);
    const timelineStartMs = Number(clip.timelineStartMs);
    const label = clip.id || `${index + 1}번째 구간`;

    if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs)) {
      throw new Error(`${label}의 원본 구간 시각이 올바르지 않습니다.`);
    }
    if (sourceStartMs < 0 || sourceEndMs <= sourceStartMs) {
      throw new Error(`${label}의 원본 시작·끝 범위를 확인해 주세요.`);
    }
    if (sourceEndMs > durationMs + 0.5) {
      throw new Error(`${label}이 원본 영상 길이 밖까지 이어집니다.`);
    }
    if (
      !Number.isFinite(timelineStartMs)
      || Math.abs(timelineStartMs - expectedTimelineStartMs) > 0.5
    ) {
      throw new Error(`${label}의 편집 타임라인 위치가 현재 컷 순서와 맞지 않습니다.`);
    }

    expectedTimelineStartMs += sourceEndMs - sourceStartMs;
  }

  return enabledClips;
}

export function buildRenderEncodingSettings(
  sourceWidth: number | null,
  sourceHeight: number | null,
  packetRate: unknown,
  hasAudio: unknown,
  layout: RenderLayout = null,
  resolutionPolicy: RenderResolutionPolicy = "editor-default"
) {
  const isShortForm = isShortFormRenderLayout(layout);
  const { width, height } = isShortForm
    ? {
      width: SHORT_FORM_OUTPUT_WIDTH,
      height: SHORT_FORM_OUTPUT_HEIGHT
    }
    : resolutionPolicy === "source-quality-cache"
      ? sourceQualityCacheDimensions(sourceWidth, sourceHeight)
      : scaledDimensions(sourceWidth, sourceHeight);
  const parsedPacketRate = Number(packetRate);
  const frameRate = Number.isFinite(parsedPacketRate) && parsedPacketRate > 0
    ? Math.max(1, Math.min(60, parsedPacketRate))
    : 30;
  return {
    width,
    height,
    frameRate,
    videoBitrate: Math.max(
      isShortForm
        ? SHORT_FORM_MINIMUM_VIDEO_BITRATE
        : DEFAULT_MINIMUM_VIDEO_BITRATE,
      Math.round(
        width
        * height
        * frameRate
        * (isShortForm
          ? SHORT_FORM_VIDEO_BITRATE_PER_PIXEL_FRAME
          : DEFAULT_VIDEO_BITRATE_PER_PIXEL_FRAME)
      )
    ),
    hasAudio: Boolean(hasAudio)
  };
}

export function createFileWriteTransaction(
  fileWritable: FileSystemWritableFileStream
) {
  if (
    !fileWritable
    || typeof fileWritable.write !== "function"
    || typeof fileWritable.close !== "function"
    || typeof fileWritable.abort !== "function"
  ) {
    throw new TypeError("쓰기·닫기·중단을 지원하는 파일 스트림이 필요합니다.");
  }

  let commitRequested = false;
  let settled = false;
  let settling: Promise<void> | null = null;

  const settle = async (
    mode: "commit" | "abort",
    reason?: unknown
  ): Promise<void> => {
    if (settled) {
      return;
    }
    if (settling) {
      try {
        await settling;
      } catch {
        // A failed commit can still be followed by an explicit abort.
      }
      if (settled) {
        return;
      }
    }

    const operation = mode === "commit"
      ? () => fileWritable.close()
      : () => fileWritable.abort(reason);
    settling = (async () => {
      await operation();
      settled = true;
    })();
    try {
      await settling;
    } finally {
      settling = null;
    }
  };

  const writable = new WritableStream({
    write: (chunk) => fileWritable.write(chunk),
    close: () => settle(commitRequested ? "commit" : "abort"),
    abort: (reason) => settle("abort", reason)
  });

  return {
    writable,
    prepareCommit() {
      if (settled) {
        throw new Error("이미 닫힌 파일 스트림은 커밋할 수 없습니다.");
      }
      commitRequested = true;
    },
    abort: (reason?: unknown) => settle("abort", reason),
    get settled() {
      return settled;
    }
  };
}

export async function inspectMediaFile(source: EditorMediaSource) {
  const input = createInput(source);
  try {
    if (!(await input.canRead())) {
      throw new Error("이 영상 컨테이너를 브라우저에서 읽을 수 없습니다.");
    }
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ]);
    const tracks = [videoTrack, audioTrack].filter(Boolean);
    const [
      timeline,
      width,
      height,
      codec,
      audioCodec,
      packetStats,
      videoDecodable,
      audioDecodable
    ] = await Promise.all([
      readMediaTimeline(input, tracks),
      videoTrack?.getDisplayWidth() ?? null,
      videoTrack?.getDisplayHeight() ?? null,
      videoTrack?.getCodec() ?? null,
      audioTrack?.getCodec() ?? null,
      videoTrack?.computePacketStats(100) ?? null,
      videoTrack?.canDecode() ?? false,
      audioTrack?.canDecode() ?? false
    ]);
    const frameRate = packetStats
      ? buildRenderEncodingSettings(width, height, packetStats.averagePacketRate, Boolean(audioTrack)).frameRate
      : null;
    return {
      name: source.name,
      size: source.size,
      sizeLabel: humanBytes(source.size),
      type: source.type,
      lastModified: source.lastModified,
      durationMs: timeline.durationMs,
      mediaOriginMs: timeline.mediaOriginMs,
      mediaEndTimestampMs: timeline.mediaEndTimestampMs,
      width,
      height,
      frameRate,
      codec,
      audioCodec,
      hasVideo: Boolean(videoTrack),
      hasAudio: Boolean(audioTrack),
      videoDecodable: Boolean(videoDecodable),
      audioDecodable: Boolean(audioDecodable)
    };
  } finally {
    input.dispose();
  }
}

export function mixAudioChannelSamples(
  channels: Float32Array[],
  left: number,
  right: number,
  mix: number,
  channelMix = "average"
): number {
  if (!Array.isArray(channels) || channels.length === 0) {
    return 0;
  }
  const interpolatedSample = (channel: Float32Array): number => (
    (channel[left] ?? 0) * (1 - mix) + (channel[right] ?? 0) * mix
  );
  if (channelMix === "strongest") {
    let strongest = 0;
    for (const channel of channels) {
      const value = interpolatedSample(channel);
      if (Math.abs(value) > Math.abs(strongest)) {
        strongest = value;
      }
    }
    return strongest;
  }
  if (channelMix !== "average") {
    throw new Error(`지원하지 않는 오디오 채널 혼합 방식입니다: ${channelMix}`);
  }
  let mono = 0;
  for (const channel of channels) {
    mono += interpolatedSample(channel);
  }
  return mono / channels.length;
}

export async function extractClipPcm16k(source: EditorMediaSource, clip: RenderClip, {
  onProgress = () => {},
  signal,
  channelMix = "average"
}: {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  channelMix?: "average" | "strongest";
} = {}): Promise<Float32Array> {
  const input = createInput(source);
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ]);
    if (!audioTrack) {
      throw new Error("원본 영상에서 음성 트랙을 찾지 못했습니다.");
    }
    if (!(await audioTrack.canDecode())) {
      throw new Error("이 영상의 음성 코덱을 현재 Chrome에서 디코딩할 수 없습니다.");
    }

    const timeline = await readMediaTimeline(input, [videoTrack, audioTrack]);
    validateRenderClips({
      clips: [{ ...clip, enabled: true, timelineStartMs: 0 }]
    }, timeline.durationSeconds * 1000);

    const startSeconds = timeline.originSeconds + clip.sourceStartMs / 1000;
    const endSeconds = timeline.originSeconds + clip.sourceEndMs / 1000;
    const durationSeconds = (clip.sourceEndMs - clip.sourceStartMs) / 1000;
    const pcm = new Float32Array(Math.ceil(durationSeconds * PCM_SAMPLE_RATE));
    const sink = new AudioBufferSink(audioTrack);
    let writtenUntil = 0;

    for await (const wrapped of sink.buffers(startSeconds, endSeconds)) {
      throwIfAborted(signal);
      const buffer = wrapped.buffer;
      const bufferStart = wrapped.timestamp;
      const bufferEnd = bufferStart + buffer.duration;
      const overlapStart = Math.max(startSeconds, bufferStart);
      const overlapEnd = Math.min(endSeconds, bufferEnd);
      if (overlapEnd <= overlapStart) {
        continue;
      }

      const outputStart = Math.max(0, Math.round((overlapStart - startSeconds) * PCM_SAMPLE_RATE));
      const outputEnd = Math.min(pcm.length, Math.ceil((overlapEnd - startSeconds) * PCM_SAMPLE_RATE));
      const channels = Array.from(
        { length: buffer.numberOfChannels },
        (_, channel) => buffer.getChannelData(channel)
      );
      const sourceRate = buffer.sampleRate;

      for (let outputIndex = outputStart; outputIndex < outputEnd; outputIndex += 1) {
        const absoluteTime = startSeconds + outputIndex / PCM_SAMPLE_RATE;
        const sourcePosition = clampSamplePosition((absoluteTime - bufferStart) * sourceRate, buffer.length);
        const left = Math.floor(sourcePosition);
        const right = Math.min(buffer.length - 1, left + 1);
        const mix = sourcePosition - left;
        pcm[outputIndex] = mixAudioChannelSamples(
          channels,
          left,
          right,
          mix,
          channelMix
        );
      }

      writtenUntil = Math.max(writtenUntil, outputEnd);
      onProgress(pcm.length > 0 ? writtenUntil / pcm.length : 1);
    }
    onProgress(1);
    return pcm;
  } finally {
    input.dispose();
  }
}

function pixelLuminance(
  data: Uint8ClampedArray,
  offset: number
): number {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new RangeError("자막 안전 영역 분석 픽셀 범위를 벗어났습니다.");
  }
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function captionBandObstructionScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  band: CaptionPlacementBand
): number {
  const startX = Math.max(0, Math.floor(width * 0.04));
  const endX = Math.min(width, Math.ceil(width * 0.96));
  const startY = Math.max(0, Math.floor(height * band.start));
  const endY = Math.min(height, Math.ceil(height * band.end));
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let edgeTotal = 0;
  let edgeCount = 0;
  let pixelCount = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * width + x) * 4;
      const luminance = pixelLuminance(data, offset);
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;
      pixelCount += 1;
      if (x > startX) {
        edgeTotal += Math.abs(
          luminance - pixelLuminance(data, offset - 4)
        );
        edgeCount += 1;
      }
      if (y > startY) {
        edgeTotal += Math.abs(
          luminance - pixelLuminance(data, offset - width * 4)
        );
        edgeCount += 1;
      }
    }
  }

  if (pixelCount === 0) {
    return 1_000;
  }
  const mean = luminanceTotal / pixelCount;
  const variance = Math.max(
    0,
    luminanceSquaredTotal / pixelCount - mean * mean
  );
  const contrast = Math.sqrt(variance);
  const edgeDensity = edgeCount > 0 ? edgeTotal / edgeCount : 0;
  return Math.round(
    clamp((contrast * 1.8 + edgeDensity * 2.2) / 255, 0, 1) * 1_000
  );
}

export function analyzeCaptionPlacementFrame(
  rgba: Uint8ClampedArray,
  width: unknown,
  height: unknown
): Record<`${CaptionPlacement}Score`, number> & {
  preferredPlacement: CaptionPlacement;
} {
  const normalizedWidth = Number(width);
  const normalizedHeight = Number(height);
  if (
    !rgba
    || !Number.isInteger(normalizedWidth)
    || !Number.isInteger(normalizedHeight)
    || normalizedWidth < 2
    || normalizedHeight < 3
    || rgba.length < normalizedWidth * normalizedHeight * 4
  ) {
    throw new TypeError("자막 안전 영역을 분석할 RGBA 프레임이 올바르지 않습니다.");
  }
  const scores = Object.fromEntries(
    CAPTION_PLACEMENT_BANDS.map((band) => [
      `${band.placement}Score`,
      captionBandObstructionScore(
        rgba,
        normalizedWidth,
        normalizedHeight,
        band
      )
    ])
  ) as Record<`${CaptionPlacement}Score`, number>;
  const preferredPlacement = CAPTION_PLACEMENT_BANDS.reduce<CaptionPlacement>(
    (preferred, band) => {
      const candidate = band.placement;
      const scoreDelta = scores[`${candidate}Score`] - scores[`${preferred}Score`];
      if (scoreDelta < 0) {
        return candidate;
      }
      if (scoreDelta > 0) {
        return preferred;
      }
      return CAPTION_PLACEMENT_TIE_ORDER[candidate]
        < CAPTION_PLACEMENT_TIE_ORDER[preferred]
        ? candidate
        : preferred;
    },
    "bottom"
  );
  return {
    ...scores,
    preferredPlacement
  };
}

export function fallbackCaptionPlacementHints(durationMs: unknown) {
  const duration = Math.max(1, Math.round(Number(durationMs) || 1));
  return {
    analysis: CAPTION_PLACEMENT_ANALYSIS,
    framesShared: false,
    samples: [{
      atMs: Math.min(duration - 1, Math.floor(duration / 2)),
      topScore: 500,
      centerScore: 500,
      bottomScore: 500,
      preferredPlacement: "bottom"
    }]
  };
}

export async function extractClipCaptionPlacementHints(
  source: EditorMediaSource,
  clip: RenderClip,
  {
  onProgress = () => {},
  sampleCount = CAPTION_PLACEMENT_SAMPLE_COUNT,
  signal
  }: {
    onProgress?: ProgressCallback;
    sampleCount?: number;
    signal?: AbortSignal;
  } = {}
) {
  const input = createInput(source);
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ]);
    if (!videoTrack) {
      throw new Error("자막 위치를 분석할 영상 트랙을 찾지 못했습니다.");
    }
    if (!(await videoTrack.canDecode())) {
      throw new Error("자막 위치 분석을 위해 영상 프레임을 디코딩할 수 없습니다.");
    }
    const timeline = await readMediaTimeline(input, [videoTrack, audioTrack]);
    validateRenderClips({
      clips: [{ ...clip, enabled: true, timelineStartMs: 0 }]
    }, timeline.durationSeconds * 1_000);

    const sourceWidth = await videoTrack.getDisplayWidth();
    const sourceHeight = await videoTrack.getDisplayHeight();
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      throw new Error("자막 위치 분석용 영상 크기를 확인하지 못했습니다.");
    }
    const aspectRatio = sourceWidth / sourceHeight;
    const analysisWidth = aspectRatio >= 1
      ? 160
      : Math.max(64, Math.round(160 * aspectRatio));
    const analysisHeight = aspectRatio >= 1
      ? Math.max(64, Math.round(160 / aspectRatio))
      : 160;
    const canvas = new OffscreenCanvas(analysisWidth, analysisHeight);
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true
    });
    if (!context) {
      throw new Error("자막 위치 분석용 캔버스를 준비하지 못했습니다.");
    }

    const durationMs = Math.round(clip.sourceEndMs - clip.sourceStartMs);
    const count = Math.max(
      1,
      Math.min(
        CAPTION_PLACEMENT_SAMPLE_COUNT,
        durationMs,
        Math.floor(Number(sampleCount)) || CAPTION_PLACEMENT_SAMPLE_COUNT
      )
    );
    const localTimestampsMs = Array.from({ length: count }, (_, index) => (
      Math.max(
        0,
        Math.min(
          durationMs - 1,
          Math.round(durationMs * (index + 0.5) / count)
        )
      )
    ));
    const sourceTimestamps = localTimestampsMs.map((timestampMs) => (
      timeline.originSeconds
      + (clip.sourceStartMs + timestampMs) / 1_000
    ));
    const sink = new VideoSampleSink(videoTrack);
    const samples: Array<{
      atMs: number;
      topScore: number;
      centerScore: number;
      bottomScore: number;
      preferredPlacement: CaptionPlacement;
    }> = [];
    let sampleIndex = 0;
    for await (const sample of sink.samplesAtTimestamps(sourceTimestamps)) {
      try {
        throwIfAborted(signal);
        if (!sample) {
          throw new Error("자막 위치를 분석할 대표 프레임을 읽지 못했습니다.");
        }
        context.fillStyle = "#000";
        context.fillRect(0, 0, analysisWidth, analysisHeight);
        sample.drawWithFit(context, { fit: "cover" });
        const analysis = analyzeCaptionPlacementFrame(
          context.getImageData(
            0,
            0,
            analysisWidth,
            analysisHeight
          ).data,
          analysisWidth,
          analysisHeight
        );
        const atMs = localTimestampsMs[sampleIndex];
        if (atMs === undefined) {
          throw new Error("자막 위치 분석용 대표 프레임 수가 요청 범위를 넘었습니다.");
        }
        samples.push({
          atMs,
          ...analysis
        });
      } finally {
        sample?.close();
      }
      sampleIndex += 1;
      onProgress(sampleIndex / count);
    }
    if (samples.length !== count) {
      throw new Error("자막 위치 분석용 대표 프레임을 모두 읽지 못했습니다.");
    }
    onProgress(1);
    return {
      analysis: CAPTION_PLACEMENT_ANALYSIS,
      framesShared: false,
      samples
    };
  } finally {
    input.dispose();
  }
}

function clampSamplePosition(value: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), value));
}

export function activeCuesAt(
  project: RenderProject,
  outputSeconds: number
): RenderSubtitleCue[] {
  const outputMs = outputSeconds * 1000;
  return project.subtitles
    .map((cue) => ({ cue, range: cueTimelineRange(project, cue) }))
    .filter((entry): entry is {
      cue: RenderSubtitleCue;
      range: { startMs: number; endMs: number };
    } => Boolean(
      entry.range
      && entry.cue.text.trim()
      && outputMs >= entry.range.startMs
      && outputMs < entry.range.endMs
    ))
    .sort((a, b) => (
      (Number(a.cue.lane) || 0) - (Number(b.cue.lane) || 0)
      || a.range.startMs - b.range.startMs
      || String(a.cue.id).localeCompare(String(b.cue.id))
    ))
    .map(({ cue }) => cue);
}

export function activeImageAssetsAt(
  project: RenderProject,
  outputSeconds: number
): RenderImageAsset[] {
  return imageAssetsAtTimeline(project, Number(outputSeconds) * 1000);
}

export function imageAssetDrawRect(
  canvas: ImageAssetSurface,
  asset: RenderImageAsset,
  image: ImageAssetDimensions
) {
  const canvasWidth = Math.max(1, Number(canvas?.width) || 1);
  const canvasHeight = Math.max(1, Number(canvas?.height) || 1);
  const naturalWidth = Math.max(
    1,
    Number(asset?.naturalWidth) || Number(image?.width) || 1
  );
  const naturalHeight = Math.max(
    1,
    Number(asset?.naturalHeight) || Number(image?.height) || 1
  );
  // Scale from the render surface so CSS preview pixels and output pixels keep
  // the same normalized geometry even when only one surface exceeds the image's
  // natural dimensions.
  const baseFit = Math.min(
    canvasWidth * 0.35 / naturalWidth,
    canvasHeight * 0.35 / naturalHeight
  );
  const requestedScale = Number(asset?.scale);
  const scale = clamp(Number.isFinite(requestedScale) ? requestedScale : 1, 0.05, 5);
  const width = naturalWidth * baseFit * scale;
  const height = naturalHeight * baseFit * scale;
  const requestedX = Number(asset?.x);
  const requestedY = Number(asset?.y);
  const centerX = canvasWidth * clamp(Number.isFinite(requestedX) ? requestedX : 0.5, 0, 1);
  const centerY = canvasHeight * clamp(Number.isFinite(requestedY) ? requestedY : 0.5, 0, 1);
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height
  };
}

export function drawImageAsset(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  canvas: OffscreenCanvas | HTMLCanvasElement,
  asset: RenderImageAsset,
  image: CanvasImageSource & { width?: number; height?: number }
): void {
  if (!context || !asset || !image) {
    return;
  }
  const rect = imageAssetDrawRect(canvas, asset, image);
  context.save();
  context.globalAlpha = clamp(
    Number.isFinite(Number(asset.opacity)) ? Number(asset.opacity) : 1,
    0,
    1
  );
  context.globalCompositeOperation = "source-over";
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

async function imageAssetBlob(
  asset: RenderImageAsset,
  resolveImageAsset: ResolveImageAsset | null,
  fetchImageAsset: FetchImplementation | undefined
): Promise<Blob> {
  if (asset.source?.kind === "data-url") {
    if (typeof fetchImageAsset !== "function") {
      throw new Error(`‘${asset.name}’ 이미지 데이터를 읽을 수 있는 fetch 구현이 없습니다.`);
    }
    const response = await fetchImageAsset(asset.source.value);
    if (!response.ok) {
      throw new Error(`‘${asset.name}’ 이미지 데이터를 읽지 못했습니다.`);
    }
    return response.blob();
  }
  if (asset.source?.kind === "blob-key") {
    if (typeof resolveImageAsset !== "function") {
      throw new Error(`‘${asset.name}’ 로컬 이미지 저장소를 연결하지 못했습니다.`);
    }
    const resolved = await resolveImageAsset(asset.source, asset);
    if (!(resolved instanceof Blob)) {
      throw new Error(`‘${asset.name}’ 로컬 이미지 데이터를 읽지 못했습니다.`);
    }
    return resolved;
  }
  throw new Error(`‘${asset.name}’ 이미지 참조가 올바르지 않습니다.`);
}

function decodedImageRgbaBytes(image: ResolvedImage): number {
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("디코딩한 이미지 에셋의 크기가 올바르지 않습니다.");
  }
  return Math.ceil(width) * Math.ceil(height) * 4;
}

function imageAssetMetadataRgbaBytes(
  asset: RenderImageAsset
): number | null {
  const width = Number(asset?.naturalWidth);
  const height = Number(asset?.naturalHeight);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return Math.ceil(width) * Math.ceil(height) * 4;
}

function decodedMemoryLimitLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MiB`;
  }
  return `${bytes} B`;
}

function decodedMemoryLimitError(memoryLimit: number): Error {
  return new Error(
    `동시에 표시되는 이미지 에셋의 디코드 메모리가 `
    + `${decodedMemoryLimitLabel(memoryLimit)}를 넘습니다. `
    + "이미지 크기나 겹치는 에셋 수를 줄여 주세요."
  );
}

export function createImageAssetRenderCache(project: RenderProject, {
  resolveImageAsset = null,
  fetchImageAsset = globalThis.fetch?.bind(globalThis),
  decodeImageAsset = globalThis.createImageBitmap?.bind(globalThis),
  maxDecodedBytes = MAX_ACTIVE_IMAGE_ASSET_RGBA_BYTES,
  signal
}: {
  resolveImageAsset?: ResolveImageAsset | null;
  fetchImageAsset?: FetchImplementation;
  decodeImageAsset?: (blob: Blob) => Promise<ResolvedImage>;
  maxDecodedBytes?: number;
  signal?: AbortSignal;
} = {}) {
  const memoryLimit = Number(maxDecodedBytes);
  if (!Number.isFinite(memoryLimit) || memoryLimit <= 0) {
    throw new TypeError("이미지 에셋 디코드 메모리 상한은 0보다 커야 합니다.");
  }

  const decoded = new Map<string, {
    image: ResolvedImage;
    bytes: number;
    endMs: number;
  }>();
  let decodedBytes = 0;

  const closeEntry = (assetId: string): void => {
    const entry = decoded.get(assetId);
    if (!entry) {
      return;
    }
    decoded.delete(assetId);
    decodedBytes = Math.max(0, decodedBytes - entry.bytes);
    entry.image.close?.();
  };

  const closeAll = (): void => {
    for (const assetId of [...decoded.keys()]) {
      closeEntry(assetId);
    }
  };

  const releaseThrough = (outputSeconds: number): void => {
    const outputMs = Math.round(Number(outputSeconds) * 1000);
    if (!Number.isFinite(outputMs)) {
      return;
    }
    for (const [assetId, entry] of decoded) {
      if (entry.endMs <= outputMs) {
        closeEntry(assetId);
      }
    }
  };

  const prepareAt = async (
    outputSeconds: number
  ): Promise<Array<{ asset: RenderImageAsset; image: ResolvedImage }>> => {
    throwIfAborted(signal);
    releaseThrough(outputSeconds);
    const activeAssets = activeImageAssetsAt(project, outputSeconds);

    try {
      for (const asset of activeAssets) {
        if (decoded.has(asset.id)) {
          continue;
        }
        if (typeof decodeImageAsset !== "function") {
          throw new Error("이미지 에셋을 디코딩할 수 있는 브라우저 기능이 없습니다.");
        }

        const metadataBytes = imageAssetMetadataRgbaBytes(asset);
        if (metadataBytes !== null && decodedBytes + metadataBytes > memoryLimit) {
          throw decodedMemoryLimitError(memoryLimit);
        }
        const blob = await imageAssetBlob(asset, resolveImageAsset, fetchImageAsset);
        throwIfAborted(signal);
        if (blob.type && asset.mimeType && blob.type !== asset.mimeType) {
          throw new Error(`‘${asset.name}’ 이미지 형식이 저장 정보와 다릅니다.`);
        }

        const image = await decodeImageAsset(blob);
        try {
          throwIfAborted(signal);
          const bytes = decodedImageRgbaBytes(image);
          if (decodedBytes + bytes > memoryLimit) {
            throw decodedMemoryLimitError(memoryLimit);
          }
          const range = imageAssetTimelineRange(project, asset);
          if (!range) {
            image?.close?.();
            continue;
          }
          decoded.set(asset.id, {
            image,
            bytes,
            endMs: range.endMs
          });
          decodedBytes += bytes;
        } catch (error) {
          image?.close?.();
          throw error;
        }
      }
    } catch (error) {
      closeAll();
      throw error;
    }

    return activeAssets
      .map((asset) => ({
        asset,
        image: decoded.get(asset.id)?.image
      }))
      .filter((entry): entry is {
        asset: RenderImageAsset;
        image: ResolvedImage;
      } => Boolean(entry.image));
  };

  return {
    prepareAt,
    releaseThrough,
    closeAll,
    get decodedBytes() {
      return decodedBytes;
    },
    get decodedCount() {
      return decoded.size;
    }
  };
}

export function wrapCaption(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  text: unknown,
  maxWidth: number
): string[] {
  const paragraphs = String(text).split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const tokens = paragraph.includes(" ")
      ? paragraph.split(/(\s+)/).filter(Boolean)
      : Array.from(paragraph);
    let line = "";
    for (const token of tokens) {
      const candidate = `${line}${token}`;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trim());
        line = token.trimStart();
      } else {
        line = candidate;
      }
    }
    if (line.trim() || paragraph === "") {
      lines.push(line.trim());
    }
  }
  return lines;
}

export function singleLineCaptionText(text: unknown): string {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

export function fitSingleLineCaptionFontSize({
  baseFontSize,
  measuredWidth,
  maxWidth
}: {
  baseFontSize: unknown;
  measuredWidth: unknown;
  maxWidth: unknown;
}): number {
  const normalizedBase = Math.max(1, Number(baseFontSize) || 1);
  const normalizedMeasuredWidth = Math.max(0, Number(measuredWidth) || 0);
  const normalizedMaxWidth = Math.max(1, Number(maxWidth) || 1);
  if (normalizedMeasuredWidth <= normalizedMaxWidth) {
    return normalizedBase;
  }
  return Math.max(
    1,
    Math.floor(
      normalizedBase * normalizedMaxWidth / normalizedMeasuredWidth * 0.96
    )
  );
}

export function captionFontSizeForSurface(
  surfaceHeightValue: unknown,
  fontScaleValue: unknown,
  minimumPixelsValue = 1
): number {
  const surfaceHeight = Math.max(1, Number(surfaceHeightValue) || 1);
  const fontScale = Number(fontScaleValue);
  const minimumPixels = Math.max(
    1,
    Math.round(Number(minimumPixelsValue) || 1)
  );
  return Math.max(
    minimumPixels,
    Math.round(
      surfaceHeight * (
        Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 0.0675
      )
    )
  );
}

export function clampCaptionBoxCenter({
  requestedX,
  requestedY,
  boxWidth,
  boxHeight,
  canvasWidth,
  canvasHeight,
  safeInset = 0
}: {
  requestedX: number;
  requestedY: number;
  boxWidth: number;
  boxHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  safeInset?: number;
}): { x: number; y: number } {
  const horizontalInset = Math.min(boxWidth / 2 + safeInset, canvasWidth / 2);
  const verticalInset = Math.min(boxHeight / 2 + safeInset, canvasHeight / 2);
  return {
    x: clamp(
      requestedX,
      horizontalInset,
      canvasWidth - horizontalInset
    ),
    y: clamp(
      requestedY,
      verticalInset,
      canvasHeight - verticalInset
    )
  };
}

export function drawCaption(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  canvas: OffscreenCanvas | HTMLCanvasElement,
  project: RenderProject,
  cue: RenderSubtitleCue | null | undefined
): void {
  if (!cue) {
    return;
  }
  const defaults = project.subtitleDefaults;
  const fontScale = cue.fontScale || defaults.fontScale || 0.0675;
  let fontSize = captionFontSizeForSurface(canvas.height, fontScale, 18);
  const fontFamily = String(defaults.fontFamily || "Pretendard").replace(/["\\]/gu, "");
  const fontWeight = clamp(Math.round(Number(defaults.fontWeight) || 800), 100, 900);
  const maximumLines = clamp(
    Math.round(Number(defaults.maxLines) || 1),
    1,
    2
  );
  const lineHeightScale = clamp(
    Number(defaults.lineHeight) || 1.24,
    1,
    1.6
  );
  const requestedX = canvas.width * cue.x;
  const requestedY = canvas.height * cue.y;
  const maxWidth = canvas.width * (defaults.maxWidth || 0.86);
  const outlineWidth = Math.max(2, canvas.height * (defaults.outlineWidth || 0.004));
  context.save();
  context.textAlign = defaults.align || "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";

  let lines: string[] = [];
  const maximumCaptionHeight = canvas.height * 0.9;
  if (maximumLines === 1) {
    context.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Noto Sans KR", sans-serif`;
    const displayText = singleLineCaptionText(cue.text);
    fontSize = fitSingleLineCaptionFontSize({
      baseFontSize: fontSize,
      measuredWidth: context.measureText(displayText).width,
      maxWidth
    });
    context.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Noto Sans KR", sans-serif`;
    lines = [displayText];
  } else {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      context.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Noto Sans KR", sans-serif`;
      lines = wrapCaption(context, cue.text, maxWidth);
      const measuredHeight = lines.length * fontSize * lineHeightScale + fontSize * 0.3;
      if (
        (
          lines.length <= maximumLines
          && measuredHeight <= maximumCaptionHeight
        )
        || fontSize <= 1
      ) {
        break;
      }
      const lineBudgetScale = lines.length > maximumLines
        ? maximumLines / lines.length
        : 1;
      const heightBudgetScale = measuredHeight > maximumCaptionHeight
        ? maximumCaptionHeight / measuredHeight
        : 1;
      const scaled = Math.floor(
        fontSize * Math.min(lineBudgetScale, heightBudgetScale) * 0.96
      );
      fontSize = Math.max(1, Math.min(fontSize - 1, scaled));
    }
  }
  const lineHeight = fontSize * lineHeightScale;
  const widest = Math.max(...lines.map((line) => context.measureText(line).width), fontSize);
  const boxWidth = Math.min(maxWidth, widest + fontSize * 0.72);
  const boxHeight = lines.length * lineHeight + fontSize * 0.3;
  const safeInset = outlineWidth / 2 + 2;
  const { x, y } = clampCaptionBoxCenter({
    requestedX,
    requestedY,
    boxWidth,
    boxHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    safeInset
  });
  const background = resolveSubtitleCueBackground(defaults, cue);
  if (background.enabled) {
    context.fillStyle = background.color;
    if (background.radiusEm === 0) {
      context.fillRect(
        x - boxWidth / 2,
        y - boxHeight / 2,
        boxWidth,
        boxHeight
      );
    } else {
      context.beginPath();
      context.roundRect(
        x - boxWidth / 2,
        y - boxHeight / 2,
        boxWidth,
        boxHeight,
        Math.max(5, fontSize * background.radiusEm)
      );
      context.fill();
    }
  }

  const firstY = y - ((lines.length - 1) * lineHeight) / 2;
  const textX = context.textAlign === "left"
    ? x - boxWidth / 2 + fontSize * 0.36
    : context.textAlign === "right"
      ? x + boxWidth / 2 - fontSize * 0.36
      : x;
  context.lineWidth = outlineWidth;
  context.strokeStyle = defaults.outlineColor || "#111111";
  context.fillStyle = cue.color || defaults.color || "#ffffff";
  context.shadowColor = String(
    defaults.shadowColor || "rgba(0, 0, 0, 0.45)"
  );
  context.shadowOffsetX = fontSize * (
    Number(defaults.shadowOffsetXEm) || 0
  );
  context.shadowOffsetY = fontSize * (
    Number(defaults.shadowOffsetYEm) || 0
  );
  context.shadowBlur = fontSize * Math.max(
    0,
    Number(defaults.shadowBlurEm) || 0
  );
  lines.forEach((line, index) => {
    const lineY = firstY + index * lineHeight;
    context.strokeText(line, textX, lineY, maxWidth);
    context.fillText(line, textX, lineY, maxWidth);
  });
  context.restore();
}

interface RenderEncodingSettings {
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: number;
  hasAudio: boolean;
}

interface OutputCodecProfile {
  extension: "mp4" | "webm";
  mimeType: "video/mp4" | "video/webm";
  format: OutputFormat;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  hardwareAcceleration: HardwareAcceleration;
}

export async function chooseOutputCodecs(
  settings: RenderEncodingSettings,
  {
  videoProbe = canEncodeVideo,
  audioProbe = canEncodeAudio
  }: {
    videoProbe?: typeof canEncodeVideo;
    audioProbe?: typeof canEncodeAudio;
  } = {}
): Promise<OutputCodecProfile> {
  const videoOptions = {
    width: settings.width,
    height: settings.height,
    bitrate: settings.videoBitrate,
    latencyMode: "quality" as const
  };
  const audioOptions = {
    numberOfChannels: OUTPUT_AUDIO_CHANNELS,
    sampleRate: OUTPUT_AUDIO_SAMPLE_RATE,
    bitrate: OUTPUT_AUDIO_BITRATE
  };
  const findVideoAcceleration = async (
    codec: VideoCodec
  ): Promise<HardwareAcceleration | null> => {
    for (const hardwareAcceleration of [
      "prefer-hardware",
      "no-preference",
      "prefer-software"
    ] as const) {
      if (await videoProbe(codec, {
        ...videoOptions,
        hardwareAcceleration
      })) {
        return hardwareAcceleration;
      }
    }
    return null;
  };

  const aac = settings.hasAudio ? await audioProbe("aac", audioOptions) : true;
  const avcAcceleration = aac ? await findVideoAcceleration("avc") : null;
  if (avcAcceleration) {
    return {
      extension: "mp4",
      mimeType: "video/mp4",
      format: new Mp4OutputFormat({ fastStart: false }),
      videoCodec: "avc",
      audioCodec: settings.hasAudio ? "aac" : null,
      hardwareAcceleration: avcAcceleration
    };
  }

  const opus = settings.hasAudio ? await audioProbe("opus", audioOptions) : true;
  const vp9Acceleration = opus ? await findVideoAcceleration("vp9") : null;
  if (!vp9Acceleration) {
    throw new Error(
      settings.hasAudio
        ? "현재 Chrome에서 H.264/AAC 또는 VP9/Opus 영상 인코더를 사용할 수 없습니다."
        : "현재 Chrome에서 H.264 또는 VP9 영상 인코더를 사용할 수 없습니다."
    );
  }
  return {
    extension: "webm",
    mimeType: "video/webm",
    format: new WebMOutputFormat(),
    videoCodec: "vp9",
    audioCodec: settings.hasAudio ? "opus" : null,
    hardwareAcceleration: vp9Acceleration
  };
}

function scaledDimensions(width: number | null, height: number | null) {
  const sourceWidth = Math.max(2, width || 1280);
  const sourceHeight = Math.max(2, height || 720);
  const scale = Math.min(1, 1920 / sourceWidth, 1080 / sourceHeight);
  return {
    width: Math.max(2, Math.round(sourceWidth * scale / 2) * 2),
    height: Math.max(2, Math.round(sourceHeight * scale / 2) * 2)
  };
}

/**
 * Independent short-video cache files retain enough source detail for later
 * arbitrary crops. Keep up to one UHD frame (in either orientation) instead
 * of baking the normal 1080p long-form delivery cap into a reusable asset.
 * The final short renderer still performs its adaptive high-quality scale.
 */
export function sourceQualityCacheDimensions(
  width: number | null,
  height: number | null
) {
  const sourceWidth = Math.max(2, width || 1280);
  const sourceHeight = Math.max(2, height || 720);
  const maxPixels = 3840 * 2160;
  const scale = Math.min(
    1,
    4096 / sourceWidth,
    4096 / sourceHeight,
    Math.sqrt(maxPixels / (sourceWidth * sourceHeight))
  );
  return {
    width: Math.max(2, Math.round(sourceWidth * scale / 2) * 2),
    height: Math.max(2, Math.round(sourceHeight * scale / 2) * 2)
  };
}

async function prepareRenderSource(
  input: Input,
  project: RenderProject,
  layout: RenderLayout = null,
  resolutionPolicy: RenderResolutionPolicy = "editor-default"
) {
  validateRenderTimeline(project);
  const canvasLayoutRequested = isShortFormCanvasRenderLayout(layout);
  const canvasNeedsVideo = canvasLayoutRequested
    && Array.isArray(layout.videoAssets)
    && layout.videoAssets.length > 0;
  const canvasRequestsAudio = canvasLayoutRequested
    && (
      (Array.isArray(layout.videoAssets) && layout.videoAssets.length > 0)
      || (
        Array.isArray(layout.sourceAudioAssets)
        && layout.sourceAudioAssets.length > 0
      )
    );
  const canvasExplicitlyRequiresAudio = canvasLayoutRequested
    && Array.isArray(layout.sourceAudioAssets)
    && layout.sourceAudioAssets.length > 0;
  const [videoTrack, audioTrack] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack()
  ]);
  if ((!canvasLayoutRequested || canvasNeedsVideo) && !videoTrack) {
    throw new Error("원본에서 영상 트랙을 찾지 못했습니다.");
  }
  if (canvasExplicitlyRequiresAudio && !audioTrack) {
    throw new Error("쇼츠 원본 음성을 보존할 오디오 트랙을 찾지 못했습니다.");
  }

  const [videoDecodable, audioDecodable] = await Promise.all([
    videoTrack && (!canvasLayoutRequested || canvasNeedsVideo)
      ? videoTrack.canDecode()
      : true,
    audioTrack && (!canvasLayoutRequested || canvasRequestsAudio)
      ? audioTrack.canDecode()
      : true
  ]);
  if (!videoDecodable) {
    throw new Error("이 영상 코덱을 현재 Chrome에서 디코딩할 수 없습니다.");
  }
  if (!audioDecodable) {
    throw new Error("원본의 음성 트랙을 현재 Chrome에서 디코딩할 수 없습니다.");
  }

  const [timeline, sourceWidth, sourceHeight, packetStats] = await Promise.all([
    readMediaTimeline(input, [videoTrack, audioTrack]),
    videoTrack?.getDisplayWidth() ?? null,
    videoTrack?.getDisplayHeight() ?? null,
    videoTrack?.computePacketStats(100) ?? null
  ]);
  const validatedShortFormCanvas = canvasLayoutRequested
    ? validateShortFormCanvasRenderLayout(
      layout,
      timeline.durationSeconds * 1_000
    )
    : null;
  // A genuinely silent source is still a valid combined A/V asset: its sound
  // component is silence. Explicit legacy audio remains fail-closed above,
  // while implicit per-video ranges are simply omitted when no track exists.
  const shortFormCanvas = validatedShortFormCanvas && !audioTrack
    ? { ...validatedShortFormCanvas, sourceAudioAssets: [] }
    : validatedShortFormCanvas;
  const settings = buildRenderEncodingSettings(
    sourceWidth,
    sourceHeight,
    packetStats?.averagePacketRate,
    shortFormCanvas
      ? shortFormCanvas.sourceAudioAssets.length > 0
      : Boolean(audioTrack),
    layout,
    resolutionPolicy
  );
  const clips = shortFormCanvas
    ? []
    : validateRenderClips(project, timeline.durationSeconds * 1000);
  if (isShortFormRenderLayout(layout) && !shortFormCanvas) {
    validateShortFormRenderVideoLayers(
      layout,
      clips,
      timeline.durationSeconds * 1000
    );
  }
  return {
    videoTrack,
    audioTrack,
    timeline,
    settings,
    clips,
    shortFormCanvas
  };
}

export function validateRenderTimeline(project: RenderProject): void {
  const subtitleOverlaps = findSubtitleOverlaps(project);
  if (subtitleOverlaps.length > 0) {
    throw new Error(
      "같은 자막 레인에서 서로 겹치는 자막이 있습니다. 자막 시작·끝 또는 레인을 조정해 주세요."
    );
  }
  const audioOverlaps = findAudioRegionOverlaps(project);
  if (audioOverlaps.length > 0) {
    throw new Error(
      "서로 겹치는 음성 설정 구간이 있습니다. 음성 구간 시작·끝을 겹치지 않게 조정해 주세요."
    );
  }
}

export async function getPreferredOutputProfile(
  source: EditorMediaSource,
  project: RenderProject,
  {
    layout = null,
    resolutionPolicy = "editor-default"
  }: {
    layout?: RenderLayout;
    resolutionPolicy?: RenderResolutionPolicy;
  } = {}
): Promise<{ extension: "mp4" | "webm"; mimeType: string }> {
  const input = createInput(source);
  try {
    const prepared = await prepareRenderSource(
      input,
      project,
      layout,
      resolutionPolicy
    );
    const profile = await chooseOutputCodecs(prepared.settings);
    return {
      extension: profile.extension,
      mimeType: profile.mimeType
    };
  } finally {
    input.dispose();
  }
}

const PACKET_COPY_TIMESTAMP_EPSILON_SECONDS = 1e-6;
const PACKET_COPY_MAX_HANDLE_SECONDS = 30;
const PACKET_COPY_OUTPUT_COVERAGE_TOLERANCE_MS = 5;

function packetCopyOutputFormat(
  videoCodec: VideoCodec,
  audioCodec: AudioCodec | null
): OutputFormat | null {
  const webmVideo = new Set<VideoCodec>(["vp8", "vp9", "av1"]);
  const webmAudio = new Set<AudioCodec>(["opus", "vorbis"]);
  const format: OutputFormat = (
    webmVideo.has(videoCodec)
    && (!audioCodec || webmAudio.has(audioCodec))
  )
    ? new WebMOutputFormat()
    : new Mp4OutputFormat({ fastStart: false });
  return (
    format.getSupportedVideoCodecs().includes(videoCodec)
    && (!audioCodec || format.getSupportedAudioCodecs().includes(audioCodec))
  )
    ? format
    : null;
}

async function packetCopyTrackMetadata(track: InputTrack) {
  const [languageCode, name, disposition] = await Promise.all([
    track.getLanguageCode(),
    track.getName(),
    track.getDisposition()
  ]);
  return {
    languageCode,
    ...(name ? { name } : {}),
    disposition
  };
}

async function packetWindowStats(
  sink: EncodedPacketSink,
  startPacket: EncodedPacket,
  endPacket: EncodedPacket | undefined,
  signal?: AbortSignal
) {
  let minimumTimestamp = Number.POSITIVE_INFINITY;
  let maximumEndTimestamp = Number.NEGATIVE_INFINITY;
  let packetCount = 0;
  for await (const packet of sink.packets(
    startPacket,
    endPacket,
    { metadataOnly: true }
  )) {
    throwIfAborted(signal);
    minimumTimestamp = Math.min(minimumTimestamp, packet.timestamp);
    maximumEndTimestamp = Math.max(
      maximumEndTimestamp,
      packet.timestamp + packet.duration
    );
    packetCount += 1;
  }
  return packetCount > 0
    ? { minimumTimestamp, maximumEndTimestamp, packetCount }
    : null;
}

async function previousVerifiedKeyPacket(
  sink: EncodedPacketSink,
  track: InputTrack,
  packet: EncodedPacket
): Promise<EncodedPacket | null> {
  const resolution = Number(await track.getTimeResolution());
  const stepSeconds = Number.isFinite(resolution) && resolution > 0
    ? 1 / resolution
    : PACKET_COPY_TIMESTAMP_EPSILON_SECONDS;
  return sink.getKeyPacket(
    packet.timestamp - Math.max(stepSeconds, PACKET_COPY_TIMESTAMP_EPSILON_SECONDS),
    { verifyKeyPackets: true }
  );
}

async function inspectPacketCopiedOutput(blob: Blob) {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob, LOCAL_MEDIA_BLOB_SOURCE_OPTIONS)
  });
  try {
    if (!(await input.canRead())) {
      return null;
    }
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ]);
    if (!videoTrack) {
      return null;
    }
    const [videoTimeline, audioTimeline, videoDecodable, audioDecodable] =
      await Promise.all([
        readMediaTimeline(input, [videoTrack]),
        audioTrack ? readMediaTimeline(input, [audioTrack]) : null,
        typeof globalThis.VideoDecoder === "undefined"
          ? true
          : videoTrack.canDecode(),
        !audioTrack || typeof globalThis.AudioDecoder === "undefined"
          ? true
          : audioTrack.canDecode()
      ]);
    return {
      videoTimeline,
      audioTimeline,
      hasAudio: Boolean(audioTrack),
      videoDecodable,
      audioDecodable
    };
  } finally {
    input.dispose();
  }
}

/**
 * Repackages one already-local source clip without decoding or re-encoding.
 * Inter-frame video starts at the preceding verified key packet; mediaOffsetMs
 * tells the preview which exact logical frame is the user's range start.
 * Returning null means the caller should use its existing client-side
 * transcoding fallback. No remote source or server render endpoint is used.
 */
export async function copySingleClipPacketsForPreview(
  sourceMedia: EditorMediaSource,
  project: RenderProject,
  {
    signal,
    onProgress = () => {}
  }: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<PacketCopiedPreviewCache | null> {
  throwIfAborted(signal);
  validateRenderTimeline(project);
  const input = createInput(sourceMedia);
  let output: Output | null = null;
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ]);
    if (!videoTrack) {
      return null;
    }
    const timeline = await readMediaTimeline(input, [videoTrack, audioTrack]);
    const clips = validateRenderClips(project, timeline.durationMs);
    if (clips.length !== 1) {
      return null;
    }
    const clip = clips[0]!;
    const requestedStartSeconds = timeline.originSeconds
      + clip.sourceStartMs / 1_000;
    const requestedEndSeconds = timeline.originSeconds
      + clip.sourceEndMs / 1_000;
    const videoSink = new EncodedPacketSink(videoTrack);
    const videoCodec = await videoTrack.getCodec();
    if (!videoCodec) {
      return null;
    }
    if (
      typeof globalThis.VideoDecoder !== "undefined"
      && !(await videoTrack.canDecode())
    ) {
      return null;
    }
    let videoStartPacket = await videoSink.getKeyPacket(
      requestedStartSeconds,
      { verifyKeyPackets: true }
    );
    if (!videoStartPacket) {
      videoStartPacket = await videoSink.getFirstKeyPacket({
        verifyKeyPackets: true
      });
    }
    if (
      !videoStartPacket
      || videoStartPacket.timestamp
        > requestedStartSeconds + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      return null;
    }
    const precedingStartPacket = await previousVerifiedKeyPacket(
      videoSink,
      videoTrack,
      videoStartPacket
    );
    if (
      precedingStartPacket
      && precedingStartPacket.sequenceNumber < videoStartPacket.sequenceNumber
    ) {
      // One complete preceding GOP protects an open-GOP/recovery-point start
      // from being treated as an independently decodable random-access point.
      // If that dependency exceeds the bounded cache handle, packet copy is
      // unsafe and the caller must use its normal transcode fallback.
      if (
        requestedStartSeconds - precedingStartPacket.timestamp
          > PACKET_COPY_MAX_HANDLE_SECONDS
            + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
      ) {
        return null;
      }
      videoStartPacket = precedingStartPacket;
    }
    const startPrerollSeconds = requestedStartSeconds - videoStartPacket.timestamp;
    if (
      startPrerollSeconds < -PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
      || startPrerollSeconds > PACKET_COPY_MAX_HANDLE_SECONDS
        + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      return null;
    }

    let requestedEndBoundaryPacket = await videoSink.getKeyPacket(
      requestedEndSeconds,
      { verifyKeyPackets: true }
    );
    if (
      requestedEndBoundaryPacket
      && requestedEndBoundaryPacket.timestamp
        < requestedEndSeconds - PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      requestedEndBoundaryPacket = await videoSink.getNextKeyPacket(
        requestedEndBoundaryPacket,
        { verifyKeyPackets: true }
      );
    }
    if (
      !requestedEndBoundaryPacket
      || requestedEndBoundaryPacket.timestamp
        < requestedEndSeconds - PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      return null;
    }
    // The boundary key itself may be followed in decode order by leading
    // B-frames whose presentation timestamps precede it. Keep that whole GOP
    // and stop only at the following verified key. EOF is never an implicit
    // boundary: a short request must not silently become the rest of the VOD.
    const videoEndPacket = await videoSink.getNextKeyPacket(
      requestedEndBoundaryPacket,
      { verifyKeyPackets: true }
    );
    if (
      !videoEndPacket
      || videoEndPacket.sequenceNumber <= videoStartPacket.sequenceNumber
      || videoEndPacket.timestamp - requestedEndSeconds
        > PACKET_COPY_MAX_HANDLE_SECONDS
          + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      return null;
    }
    const videoStats = await packetWindowStats(
      videoSink,
      videoStartPacket,
      videoEndPacket,
      signal
    );
    if (
      !videoStats
      || videoStats.minimumTimestamp
        > requestedStartSeconds + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
      || requestedStartSeconds - videoStats.minimumTimestamp
        > PACKET_COPY_MAX_HANDLE_SECONDS
          + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
      || videoStats.maximumEndTimestamp
        < requestedEndSeconds - PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
      || videoStats.maximumEndTimestamp - requestedEndSeconds
        > PACKET_COPY_MAX_HANDLE_SECONDS
          + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      return null;
    }

    let copiedAudioTrack: InputAudioTrack | null = audioTrack;
    let audioCodec: AudioCodec | null = null;
    let audioStartPacket: EncodedPacket | null = null;
    let audioEndPacket: EncodedPacket | undefined;
    let audioStats: Awaited<ReturnType<typeof packetWindowStats>> = null;
    if (copiedAudioTrack) {
      try {
        audioCodec = await copiedAudioTrack.getCodec();
        if (
          !audioCodec
          || (
            typeof globalThis.AudioDecoder !== "undefined"
            && !(await copiedAudioTrack.canDecode())
          )
        ) {
          return null;
        }
        const audioSink = new EncodedPacketSink(copiedAudioTrack);
        const audioStartMetadata = await audioSink.getPacket(
          videoStats.minimumTimestamp,
          { metadataOnly: true }
        ) || await audioSink.getFirstPacket({ metadataOnly: true });
        const audioAtRequestedEnd = await audioSink.getPacket(
          requestedEndSeconds,
          { metadataOnly: true }
        );
        if (
          !audioStartMetadata
          || !audioAtRequestedEnd
          || audioStartMetadata.timestamp
            > requestedStartSeconds + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
        ) {
          return null;
        }
        audioEndPacket = audioAtRequestedEnd.timestamp
          >= requestedEndSeconds - PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
          ? audioAtRequestedEnd
          : await audioSink.getNextPacket(
            audioAtRequestedEnd,
            { metadataOnly: true }
          ) || undefined;
        audioStats = await packetWindowStats(
          audioSink,
          audioStartMetadata,
          audioEndPacket,
          signal
        );
        audioStartPacket = await audioSink.getPacket(audioStartMetadata.timestamp);
        if (
          !audioStats
          || !audioStartPacket
          || audioStats.maximumEndTimestamp
            < requestedEndSeconds - PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
          || requestedStartSeconds - audioStats.minimumTimestamp
            > PACKET_COPY_MAX_HANDLE_SECONDS
              + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
          || audioStats.maximumEndTimestamp - requestedEndSeconds
            > PACKET_COPY_MAX_HANDLE_SECONDS
              + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
        ) {
          return null;
        }
      } catch (error) {
        throwIfAborted(signal);
        return null;
      }
    } else {
      copiedAudioTrack = null;
      audioCodec = null;
    }

    const format = packetCopyOutputFormat(videoCodec, audioCodec);
    if (!format) {
      return null;
    }
    const globalOriginSeconds = Math.min(
      videoStats.minimumTimestamp,
      audioStats?.minimumTimestamp ?? Number.POSITIVE_INFINITY
    );
    if (
      !Number.isFinite(globalOriginSeconds)
      || requestedStartSeconds - globalOriginSeconds
        > PACKET_COPY_MAX_HANDLE_SECONDS
          + PACKET_COPY_TIMESTAMP_EPSILON_SECONDS
    ) {
      return null;
    }
    const target = new BufferTarget();
    output = new Output({ format, target });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    const [videoMetadata, rotation, videoDecoderConfig] = await Promise.all([
      packetCopyTrackMetadata(videoTrack),
      videoTrack.getRotation(),
      videoTrack.getDecoderConfig()
    ]);
    output.addVideoTrack(videoSource, {
      ...videoMetadata,
      rotation,
      hasOnlyKeyPackets: await videoTrack.hasOnlyKeyPackets()
    });

    let audioSource: EncodedAudioPacketSource | null = null;
    let audioDecoderConfig: AudioDecoderConfig | null = null;
    if (copiedAudioTrack && audioCodec && audioStartPacket) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      const [audioMetadata, decoderConfig] = await Promise.all([
        packetCopyTrackMetadata(copiedAudioTrack),
        copiedAudioTrack.getDecoderConfig()
      ]);
      audioDecoderConfig = decoderConfig;
      output.addAudioTrack(audioSource, audioMetadata);
    }
    output.setMetadataTags({
      title: project.name,
      comment: "Kirinuki local preview packet copy"
    });
    await output.start();

    const totalPacketCount = videoStats.packetCount
      + (audioStats?.packetCount || 0);
    let completedPacketCount = 0;
    const reportPacket = () => {
      completedPacketCount += 1;
      onProgress(Math.min(0.99, completedPacketCount / totalPacketCount));
    };
    const pumpVideo = async () => {
      let firstPacket = true;
      for await (const packet of videoSink.packets(
        videoStartPacket,
        videoEndPacket,
        { verifyKeyPackets: true }
      )) {
        throwIfAborted(signal);
        const copiedPacket = packet.clone({
          timestamp: packet.timestamp - globalOriginSeconds
        });
        if (firstPacket && videoDecoderConfig) {
          await videoSource.add(copiedPacket, {
            decoderConfig: videoDecoderConfig
          });
        } else {
          await videoSource.add(copiedPacket);
        }
        firstPacket = false;
        reportPacket();
      }
      videoSource.close();
    };
    const pumpAudio = async () => {
      if (!copiedAudioTrack || !audioSource || !audioStartPacket) {
        return;
      }
      const audioSink = new EncodedPacketSink(copiedAudioTrack);
      let firstPacket = true;
      for await (const packet of audioSink.packets(
        audioStartPacket,
        audioEndPacket
      )) {
        throwIfAborted(signal);
        const copiedPacket = packet.clone({
          timestamp: packet.timestamp - globalOriginSeconds
        });
        if (firstPacket && audioDecoderConfig) {
          await audioSource.add(copiedPacket, {
            decoderConfig: audioDecoderConfig
          });
        } else {
          await audioSource.add(copiedPacket);
        }
        firstPacket = false;
        reportPacket();
      }
      audioSource.close();
    };
    await Promise.all([pumpVideo(), pumpAudio()]);
    throwIfAborted(signal);
    await output.finalize();
    if (!target.buffer || target.buffer.byteLength === 0) {
      throw new Error("압축 패킷을 복사한 쇼츠 미리보기 파일이 비어 있습니다.");
    }
    const blob = new Blob([target.buffer], { type: format.mimeType });
    const mediaOffsetMs = Math.max(
      0,
      Math.round((requestedStartSeconds - globalOriginSeconds) * 1_000)
    );
    const requestedDurationMs = clip.sourceEndMs - clip.sourceStartMs;
    const logicalRequestedEndMs = mediaOffsetMs + requestedDurationMs;
    const inspection = await inspectPacketCopiedOutput(blob);
    if (
      !inspection
      || !inspection.videoDecodable
      || !inspection.audioDecodable
      || inspection.videoTimeline.mediaOriginMs
        > mediaOffsetMs + PACKET_COPY_OUTPUT_COVERAGE_TOLERANCE_MS
      || inspection.videoTimeline.mediaEndTimestampMs
        + PACKET_COPY_OUTPUT_COVERAGE_TOLERANCE_MS < logicalRequestedEndMs
      || Boolean(audioTrack) !== inspection.hasAudio
      || (
        audioTrack
        && (
          !inspection.audioTimeline
          || inspection.audioTimeline.mediaOriginMs
            > mediaOffsetMs + PACKET_COPY_OUTPUT_COVERAGE_TOLERANCE_MS
          || inspection.audioTimeline.mediaEndTimestampMs
            + PACKET_COPY_OUTPUT_COVERAGE_TOLERANCE_MS < logicalRequestedEndMs
        )
      )
    ) {
      return null;
    }
    onProgress(1);
    return {
      blob,
      mimeType: format.mimeType,
      mediaOffsetMs,
      packetCount: totalPacketCount,
      hasAudio: inspection.hasAudio
    };
  } catch (error) {
    if (output && output.state !== "finalized" && output.state !== "canceled") {
      await output.cancel().catch(() => {});
    }
    if (
      signal?.aborted
      || (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    return null;
  } finally {
    input.dispose();
  }
}

export function cfrFrameRange(clip: RenderClip, frameRate: unknown) {
  const rate = Number(frameRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new TypeError("CFR 프레임률은 0보다 큰 숫자여야 합니다.");
  }
  const durationSeconds = (
    Number(clip.sourceEndMs) - Number(clip.sourceStartMs)
  ) / 1000;
  const firstFrameIndex = 0;
  const endFrameIndex = Math.max(
    firstFrameIndex,
    Math.ceil(durationSeconds * rate - FRAME_INDEX_EPSILON)
  );
  return { firstFrameIndex, endFrameIndex };
}

export function cfrFrameTiming(
  clip: RenderClip,
  frameIndex: number,
  frameRate: unknown
) {
  const rate = Number(frameRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new TypeError("CFR 프레임률은 0보다 큰 숫자여야 합니다.");
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new TypeError("CFR 프레임 인덱스는 0 이상의 정수여야 합니다.");
  }
  const timelineStartSeconds = Number(clip.timelineStartMs) / 1000;
  const clipDurationSeconds = (
    Number(clip.sourceEndMs) - Number(clip.sourceStartMs)
  ) / 1000;
  const localTimestamp = frameIndex / rate;
  const outputTimestamp = timelineStartSeconds + localTimestamp;
  return {
    localTimestamp,
    outputTimestamp,
    duration: Math.max(
      0,
      Math.min(1 / rate, timelineStartSeconds + clipDurationSeconds - outputTimestamp)
    )
  };
}

/**
 * A requested CFR timestamp must always resolve to the clip's base frame.
 * Continuing without it would turn a decoder failure into a valid-looking
 * black frame with overlays, so rendering fails closed instead.
 */
export function requireRenderBaseVideoSample<T>(
  sourceSample: T | null | undefined,
  clipId: unknown
): T {
  if (sourceSample === null || sourceSample === undefined) {
    const label = String(clipId || "").trim() || "현재 컷";
    throw new Error(`${label} 기본 영상의 원본 프레임을 읽지 못했습니다.`);
  }
  return sourceSample;
}

/** A black gap is valid, but an active v7 visual may never disappear silently. */
export function requireRenderShortFormVideoAssetSample<T>(
  sourceSample: T | null | undefined,
  assetId: unknown
): T {
  if (sourceSample === null || sourceSample === undefined) {
    const label = String(assetId || "").trim() || "현재 쇼츠 영상 자산";
    throw new Error(`${label} 영상 자산의 원본 프레임을 읽지 못했습니다.`);
  }
  return sourceSample;
}

/**
 * Produces one monotonically increasing decoder clock for one 1x additional
 * layer. Export assigns a dedicated VideoSampleSink to each such iterable so
 * unrelated source clocks never force per-frame backward seeks.
 */
export function* shortFormVideoLayerSourceTimestamps(
  layer: Pick<
    ShortFormVideoLayer,
    "sourceStartMs" | "sourceEndMs" | "startOffsetMs" | "endOffsetMs"
  >,
  clip: RenderClip,
  frameRate: unknown,
  mediaOriginSecondsValue: unknown = 0
): Generator<number> {
  const mediaOriginSeconds = Number(mediaOriginSecondsValue);
  if (!Number.isFinite(mediaOriginSeconds)) {
    throw new TypeError("추가 영상 레이어의 미디어 원점이 올바르지 않습니다.");
  }
  const { firstFrameIndex, endFrameIndex } = cfrFrameRange(clip, frameRate);
  for (let frameIndex = firstFrameIndex; frameIndex < endFrameIndex; frameIndex += 1) {
    const timing = cfrFrameTiming(clip, frameIndex, frameRate);
    if (timing.duration <= 0) {
      continue;
    }
    const sourceTimeMs = shortFormVideoLayerSourceTimeMs(
      layer,
      timing.localTimestamp * 1_000
    );
    if (sourceTimeMs !== null) {
      yield mediaOriginSeconds + sourceTimeMs / 1_000;
    }
  }
}

export function audioTrimFrameRange(
  sample: AudioSample,
  startSeconds: number,
  endSeconds: number
) {
  const frameStart = Math.max(
    0,
    Math.min(
      sample.numberOfFrames,
      Math.round((startSeconds - sample.timestamp) * sample.sampleRate)
    )
  );
  const frameEnd = Math.max(
    0,
    Math.min(
      sample.numberOfFrames,
      Math.round((endSeconds - sample.timestamp) * sample.sampleRate)
    )
  );
  return { frameStart, frameEnd };
}

export interface AudioAutomationSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  targetGain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export function buildAudioAutomation(
  project: RenderProject
): AudioAutomationSegment[] {
  return (project?.audioRegions || [])
    .map((region) => {
      const range = audioRegionTimelineRange(project, region);
      if (!range) {
        return null;
      }
      return {
        id: region.id,
        startSeconds: range.startMs / 1000,
        endSeconds: range.endMs / 1000,
        targetGain: region.muted
          ? 0
          : clamp(Number.isFinite(Number(region.gain)) ? Number(region.gain) : 1, 0, 1),
        fadeInSeconds: clamp(
          (Number.isFinite(Number(region.fadeInMs)) ? Number(region.fadeInMs) : 0) / 1000,
          0,
          Math.max(0, (range.endMs - range.startMs) / 1000)
        ),
        fadeOutSeconds: clamp(
          (Number.isFinite(Number(region.fadeOutMs)) ? Number(region.fadeOutMs) : 0) / 1000,
          0,
          Math.max(0, (range.endMs - range.startMs) / 1000)
        )
      };
    })
    .filter((segment): segment is AudioAutomationSegment => Boolean(segment))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
}

export function audioAutomationGainAt(
  automation: readonly AudioAutomationSegment[],
  outputSeconds: unknown
): number {
  const time = Number(outputSeconds);
  if (!Number.isFinite(time)) {
    return 1;
  }
  const segment = automation.find((candidate) => (
    time >= candidate.startSeconds && time < candidate.endSeconds
  ));
  if (!segment) {
    return 1;
  }

  // Regions are non-destructive overrides: fades move from the untouched source
  // level (1) into the region setting, then back to the untouched level.
  let blend = 1;
  if (segment.fadeInSeconds > 0) {
    blend = Math.min(
      blend,
      clamp((time - segment.startSeconds) / segment.fadeInSeconds, 0, 1)
    );
  }
  if (segment.fadeOutSeconds > 0) {
    blend = Math.min(
      blend,
      clamp((segment.endSeconds - time) / segment.fadeOutSeconds, 0, 1)
    );
  }
  return 1 + (segment.targetGain - 1) * blend;
}

export function shortFormSourceAudioAssetGainAt(
  asset: Pick<
    ShortFormRenderSourceAudioAsset,
    | "timelineStartMs"
    | "timelineEndMs"
    | "gain"
    | "muted"
    | "fadeInMs"
    | "fadeOutMs"
  >,
  outputSecondsValue: unknown
): number {
  const outputSeconds = Number(outputSecondsValue);
  const startSeconds = asset.timelineStartMs / 1_000;
  const endSeconds = asset.timelineEndMs / 1_000;
  if (
    !Number.isFinite(outputSeconds)
    || outputSeconds < startSeconds
    || outputSeconds >= endSeconds
  ) {
    return 0;
  }
  if (asset.muted) {
    return 0;
  }
  let envelope = 1;
  if (asset.fadeInMs > 0) {
    envelope = Math.min(
      envelope,
      clamp(
        (outputSeconds - startSeconds) / (asset.fadeInMs / 1_000),
        0,
        1
      )
    );
  }
  if (asset.fadeOutMs > 0) {
    envelope = Math.min(
      envelope,
      clamp(
        (endSeconds - outputSeconds) / (asset.fadeOutMs / 1_000),
        0,
        1
      )
    );
  }
  return clamp(asset.gain, 0, 2) * envelope;
}

export function applyShortFormSourceAudioAssetToSample(
  sample: AudioSample,
  asset: ShortFormRenderSourceAudioAsset
): AudioSample {
  if (
    !asset.muted
    && asset.gain === 1
    && asset.fadeInMs === 0
    && asset.fadeOutMs === 0
  ) {
    return sample;
  }
  const data = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
  sample.copyTo(data, { planeIndex: 0, format: "f32" });
  for (let frameIndex = 0; frameIndex < sample.numberOfFrames; frameIndex += 1) {
    const outputSeconds = sample.timestamp + frameIndex / sample.sampleRate;
    const gain = shortFormSourceAudioAssetGainAt(asset, outputSeconds);
    const frameOffset = frameIndex * sample.numberOfChannels;
    for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
      const sampleIndex = frameOffset + channel;
      data[sampleIndex] = (data[sampleIndex] ?? 0) * gain;
    }
  }
  return new AudioSample({
    data,
    format: "f32",
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp
  });
}

export function applyAudioAutomationToSample(
  sample: AudioSample,
  automation: readonly AudioAutomationSegment[]
): AudioSample {
  const sampleStart = sample.timestamp;
  const sampleEnd = sample.timestamp + sample.duration;
  const relevantAutomation = automation.filter((segment) => (
    segment.targetGain !== 1
    && segment.startSeconds < sampleEnd
    && segment.endSeconds > sampleStart
  ));
  if (relevantAutomation.length === 0) {
    return sample;
  }

  const data = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
  sample.copyTo(data, { planeIndex: 0, format: "f32" });
  for (let frameIndex = 0; frameIndex < sample.numberOfFrames; frameIndex += 1) {
    const outputSeconds = sample.timestamp + frameIndex / sample.sampleRate;
    const gain = audioAutomationGainAt(relevantAutomation, outputSeconds);
    const frameOffset = frameIndex * sample.numberOfChannels;
    for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
      const sampleIndex = frameOffset + channel;
      data[sampleIndex] = (data[sampleIndex] ?? 0) * gain;
    }
  }
  return new AudioSample({
    data,
    format: "f32",
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp
  });
}

export interface ShortFormAudioMixContribution {
  data: Float32Array;
  numberOfChannels: number;
  sampleRate: number;
  /** Timeline position for `data`'s first frame. */
  timelineStartSeconds: number;
  asset: ShortFormRenderSourceAudioAsset;
}

export interface ShortFormAudioMixResult {
  data: Float32Array;
  numberOfChannels: number;
  sampleRate: number;
  numberOfFrames: number;
}

/**
 * Mixes decoded v7 audio ranges into one clock-continuous PCM buffer. Asset
 * gain is applied per contribution; global automation is applied to the sum,
 * then the final result is clamped exactly once so overlap remains additive.
 */
export function mixShortFormAudioContributions(
  durationMsValue: unknown,
  contributions: readonly ShortFormAudioMixContribution[],
  automation: readonly AudioAutomationSegment[] = []
): ShortFormAudioMixResult {
  const durationMs = Number(durationMsValue);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError("쇼츠 음성 믹스의 길이는 0보다 커야 합니다.");
  }
  if (contributions.length === 0) {
    throw new TypeError("쇼츠 음성 믹스에 원본 PCM이 없습니다.");
  }
  const { numberOfChannels, sampleRate } = contributions[0]!;
  if (
    !Number.isSafeInteger(numberOfChannels)
    || numberOfChannels <= 0
    || !Number.isSafeInteger(sampleRate)
    || sampleRate <= 0
  ) {
    throw new TypeError("쇼츠 음성 믹스의 PCM 형식이 올바르지 않습니다.");
  }
  const numberOfFrames = Math.ceil(durationMs * sampleRate / 1_000);
  const mixedData = new Float32Array(numberOfFrames * numberOfChannels);
  for (const contribution of contributions) {
    if (
      contribution.numberOfChannels !== numberOfChannels
      || contribution.sampleRate !== sampleRate
      || contribution.data.length % numberOfChannels !== 0
      || !Number.isFinite(contribution.timelineStartSeconds)
    ) {
      throw new TypeError("쇼츠 음성 믹스의 PCM 형식이 서로 일치하지 않습니다.");
    }
    const sourceFrames = contribution.data.length / numberOfChannels;
    const destinationStartFrame = Math.round(
      contribution.timelineStartSeconds * sampleRate
    );
    const sourceStartFrame = Math.max(0, -destinationStartFrame);
    const sourceEndFrame = Math.min(
      sourceFrames,
      numberOfFrames - destinationStartFrame
    );
    for (
      let sourceFrame = sourceStartFrame;
      sourceFrame < sourceEndFrame;
      sourceFrame += 1
    ) {
      const destinationFrame = destinationStartFrame + sourceFrame;
      const outputSeconds = destinationFrame / sampleRate;
      const gain = shortFormSourceAudioAssetGainAt(
        contribution.asset,
        outputSeconds
      );
      const sourceOffset = sourceFrame * numberOfChannels;
      const destinationOffset = destinationFrame * numberOfChannels;
      for (let channel = 0; channel < numberOfChannels; channel += 1) {
        const sampleIndex = destinationOffset + channel;
        mixedData[sampleIndex] = (mixedData[sampleIndex] ?? 0) + (
          contribution.data[sourceOffset + channel] ?? 0
        ) * gain;
      }
    }
  }
  for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex += 1) {
    const globalGain = audioAutomationGainAt(
      automation,
      frameIndex / sampleRate
    );
    const frameOffset = frameIndex * numberOfChannels;
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const sampleIndex = frameOffset + channel;
      mixedData[sampleIndex] = clamp(
        (mixedData[sampleIndex] ?? 0) * globalGain,
        -1,
        1
      );
    }
  }
  return {
    data: mixedData,
    numberOfChannels,
    sampleRate,
    numberOfFrames
  };
}

export function drawShortFormVideoSample(
  sample: VideoSample,
  context: ShortFormCompositeContext,
  geometry: ShortFormVideoDrawGeometry,
  adaptiveRenderer: AdaptiveShortFormFrameRenderer | null,
  opacityValue: unknown = 1
): void {
  const opacity = clamp(Number(opacityValue) || 0, 0, 1);
  if (opacity <= 0) {
    return;
  }
  context.save();
  context.globalAlpha = opacity;
  try {
    if (adaptiveRenderer) {
      adaptiveRenderer.draw(sample, context, geometry);
    } else {
      sample.draw(
        context,
        geometry.source.left,
        geometry.source.top,
        geometry.source.width,
        geometry.source.height,
        geometry.destination.left,
        geometry.destination.top,
        geometry.destination.width,
        geometry.destination.height
      );
    }
  } finally {
    context.restore();
  }
}

async function renderProjectVideoAttempt(
  sourceMedia: EditorMediaSource,
  project: RenderProject,
  {
    fileHandle = null,
    layout = null,
    onProgress = () => {},
    resolutionPolicy = "editor-default",
    resolveImageAsset = null,
    signal,
    shortFormBackend
  }: RenderProjectVideoAttemptOptions
) {
  throwIfAborted(signal);
  const input = createInput(sourceMedia);
  let output: Output | null = null;
  let fileTransaction: ReturnType<typeof createFileWriteTransaction> | null = null;
  let imageAssetCache: ReturnType<typeof createImageAssetRenderCache> | null = null;
  let adaptiveShortFormRenderer: AdaptiveShortFormFrameRenderer | null = null;
  let completed = false;
  try {
    const source = await prepareRenderSource(
      input,
      project,
      layout,
      resolutionPolicy
    );
    const {
      videoTrack,
      audioTrack,
      timeline,
      settings,
      clips,
      shortFormCanvas
    } = source;
    const {
      width,
      height,
      frameRate,
      videoBitrate
    } = settings;
    const activeImageAssetCache = createImageAssetRenderCache(project, {
      resolveImageAsset,
      ...(signal === undefined ? {} : { signal })
    });
    imageAssetCache = activeImageAssetCache;
    const outputCodecs = await chooseOutputCodecs(settings);
    let target: BufferTarget | StreamTarget;
    if (fileHandle) {
      fileTransaction = createFileWriteTransaction(await fileHandle.createWritable());
      target = new StreamTarget(fileTransaction.writable, { chunked: true });
    } else {
      target = new BufferTarget();
    }
    output = new Output({ format: outputCodecs.format, target });

    const videoSource = new VideoSampleSource({
      codec: outputCodecs.videoCodec,
      bitrate: videoBitrate,
      keyFrameInterval: 2,
      hardwareAcceleration: outputCodecs.hardwareAcceleration,
      latencyMode: "quality"
    });
    output.addVideoTrack(videoSource, { frameRate });

    let audioSource = null;
    if (settings.hasAudio) {
      if (!audioTrack || !outputCodecs.audioCodec) {
        throw new Error("음성 트랙에 사용할 출력 코덱이 없습니다.");
      }
      audioSource = new AudioSampleSource({
        codec: outputCodecs.audioCodec,
        bitrate: OUTPUT_AUDIO_BITRATE,
        transform: {
          numberOfChannels: OUTPUT_AUDIO_CHANNELS,
          sampleRate: OUTPUT_AUDIO_SAMPLE_RATE
        }
      });
      output.addAudioTrack(audioSource);
    }
    output.setMetadataTags({
      title: project.name,
      comment: "Created with Kirinuki Studio"
    });
    await output.start();

    const totalDurationMs = shortFormCanvas
      ? shortFormCanvas.durationMs
      : clips.reduce(
        (total, clip) => total + clip.sourceEndMs - clip.sourceStartMs,
        0
      );
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("영상 자막을 그릴 2D 캔버스를 준비하지 못했습니다.");
    }
    enableHighQualityImageSmoothing(context);
    if (
      isShortFormRenderLayout(layout)
      && shortFormBackend === "adaptive"
    ) {
      adaptiveShortFormRenderer = new AdaptiveShortFormFrameRenderer(
        width,
        height
      );
    }
    const videoSink = videoTrack ? new VideoSampleSink(videoTrack) : null;
    const audioSink = audioTrack && audioSource ? new AudioSampleSink(audioTrack) : null;
    const audioAutomation = buildAudioAutomation(project);
    const pumpState = {
      stopped: false,
      primaryError: null as unknown
    };

    const pumpVideo = async () => {
      if (shortFormCanvas) {
        const visibleAssets = shortFormCanvas.videoAssets.filter((asset) => (
          asset.visible && asset.opacity > 0
        ));
        if (visibleAssets.length > 0 && !videoTrack) {
          throw new Error("쇼츠 영상 자산을 읽을 원본 영상 트랙이 없습니다.");
        }
        const assetsBySourceClock = new Map<string, ShortFormRenderVideoAsset[]>();
        for (const asset of visibleAssets) {
          const clockKey = (
            `${asset.sourceAssetId}:${asset.sourceStartMs - asset.timelineStartMs}`
          );
          const group = assetsBySourceClock.get(clockKey) || [];
          group.push(asset);
          assetsBySourceClock.set(clockKey, group);
        }
        const { firstFrameIndex, endFrameIndex } = shortFormCanvasCfrFrameRange(
          shortFormCanvas.durationMs,
          frameRate
        );
        const streamGroups = videoTrack
          ? [...assetsBySourceClock.values()].map((assets) => {
            const timestamps = (function* generateSharedAssetClockTimestamps() {
              for (
                let assetFrameIndex = firstFrameIndex;
                assetFrameIndex < endFrameIndex;
                assetFrameIndex += 1
              ) {
                const timing = shortFormCanvasCfrFrameTiming(
                  shortFormCanvas.durationMs,
                  assetFrameIndex,
                  frameRate
                );
                if (timing.duration <= 0) {
                  continue;
                }
                const timelineMs = timing.outputTimestamp * 1_000;
                const activeAsset = assets.find((asset) => (
                  shortFormVideoAssetSourceTimeMs(asset, timelineMs) !== null
                ));
                if (activeAsset) {
                  yield timeline.originSeconds
                    + shortFormVideoAssetSourceTimeMs(activeAsset, timelineMs)! / 1_000;
                }
              }
            })();
            return {
              assets,
              iterator: new VideoSampleSink(videoTrack!)
                .samplesAtTimestamps(timestamps)[Symbol.asyncIterator]()
            };
          })
          : [];
        try {
          for (
            let frameIndex = firstFrameIndex;
            frameIndex < endFrameIndex;
            frameIndex += 1
          ) {
            if (pumpState.stopped) {
              return;
            }
            throwIfAborted(signal);
            const timing = shortFormCanvasCfrFrameTiming(
              shortFormCanvas.durationMs,
              frameIndex,
              frameRate
            );
            if (timing.duration <= 0) {
              continue;
            }
            const timelineMs = timing.outputTimestamp * 1_000;
            context.fillStyle = RENDER_LETTERBOX_COLOR;
            context.fillRect(0, 0, width, height);

            const acquiredGroups: Array<{
              sample: VideoSample;
              assets: ShortFormRenderVideoAsset[];
            }> = [];
            try {
              for (const group of streamGroups) {
                const activeAssets = group.assets.filter((asset) => (
                  shortFormVideoAssetSourceTimeMs(asset, timelineMs) !== null
                ));
                if (activeAssets.length === 0) {
                  continue;
                }
                const next = await group.iterator.next();
                const sample = requireRenderShortFormVideoAssetSample(
                  next.done ? null : next.value,
                  activeAssets[0]!.id
                );
                acquiredGroups.push({ sample, assets: activeAssets });
              }
              const draws = acquiredGroups
                .flatMap(({ sample, assets }) => assets.map((asset) => ({
                  asset,
                  sample
                })))
                .sort((left, right) => (
                  left.asset.zIndex - right.asset.zIndex
                  || left.asset.id.localeCompare(right.asset.id)
                ));
              for (const { asset, sample } of draws) {
                drawShortFormVideoSample(
                  sample,
                  context,
                  shortFormVideoAssetDrawGeometry(
                    sample.displayWidth,
                    sample.displayHeight,
                    width,
                    height,
                    asset
                  ),
                  adaptiveShortFormRenderer,
                  asset.opacity
                );
              }
            } finally {
              for (const { sample } of acquiredGroups) {
                sample.close();
              }
            }

            const activeImageAssets = await activeImageAssetCache.prepareAt(
              timing.outputTimestamp
            );
            for (const { asset, image } of activeImageAssets) {
              drawImageAsset(context, canvas, asset, image);
            }
            activeImageAssetCache.releaseThrough(
              timing.outputTimestamp + timing.duration
            );
            for (const cue of activeCuesAt(project, timing.outputTimestamp)) {
              drawCaption(context, canvas, project, cue);
            }
            const outputSample = new VideoSample(canvas, {
              timestamp: timing.outputTimestamp,
              duration: timing.duration
            });
            try {
              await videoSource.add(outputSample);
            } finally {
              outputSample.close();
            }
            onProgress(
              Math.min(0.98, timing.outputTimestamp * 1_000 / totalDurationMs),
              "video"
            );
          }
        } finally {
          await Promise.all(streamGroups.map(async ({ iterator }) => {
            await iterator.return?.();
          }));
        }
        if (!pumpState.stopped) {
          videoSource.close();
        }
        return;
      }
      if (!videoSink) {
        throw new Error("원본에서 영상 트랙을 찾지 못했습니다.");
      }
      for (const clip of clips) {
        if (pumpState.stopped) {
          return;
        }
        const { firstFrameIndex, endFrameIndex } = cfrFrameRange(clip, frameRate);
        const shortFormScene = isShortFormRenderLayout(layout)
          ? resolveShortFormRenderScene(
            layout,
            clip.id || clip.selectionId,
            clip.sourceEndMs - clip.sourceStartMs
          )
          : null;
        const activeAdditionalLayers = (shortFormScene?.videoLayers || [])
          .filter((layer) => layer.visible && layer.opacity > 0)
          .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id));
        const layersBySourceClock = new Map<string, ShortFormVideoLayer[]>();
        for (const layer of activeAdditionalLayers) {
          const clockKey = `${layer.sourceAssetId}:${layer.sourceStartMs - layer.startOffsetMs}`;
          const group = layersBySourceClock.get(clockKey) || [];
          group.push(layer);
          layersBySourceClock.set(clockKey, group);
        }
        const additionalLayerStreamGroups = [...layersBySourceClock.values()]
          .map((layers) => {
            const timestamps = (function* generateSharedLayerClockTimestamps() {
              for (
                let layerFrameIndex = firstFrameIndex;
                layerFrameIndex < endFrameIndex;
                layerFrameIndex += 1
              ) {
                const layerTiming = cfrFrameTiming(clip, layerFrameIndex, frameRate);
                if (layerTiming.duration <= 0) {
                  continue;
                }
                for (const layer of layers) {
                  const sourceTimeMs = shortFormVideoLayerSourceTimeMs(
                    layer,
                    layerTiming.localTimestamp * 1_000
                  );
                  if (sourceTimeMs !== null) {
                    yield timeline.originSeconds + sourceTimeMs / 1_000;
                    break;
                  }
                }
              }
            })();
            return {
              layers,
              iterator: new VideoSampleSink(videoTrack!)
                .samplesAtTimestamps(timestamps)[Symbol.asyncIterator]()
            };
          });
        const sourceTimestamps = (function* generateSourceTimestamps() {
          for (let frameIndex = firstFrameIndex; frameIndex < endFrameIndex; frameIndex += 1) {
            yield timeline.originSeconds
              + clip.sourceStartMs / 1000
              + frameIndex / frameRate;
          }
        })();
        let frameIndex = firstFrameIndex;
        try {
          for await (const sourceSample of videoSink.samplesAtTimestamps(sourceTimestamps)) {
            try {
              if (pumpState.stopped) {
                return;
              }
              throwIfAborted(signal);
              const baseVideoSample = requireRenderBaseVideoSample(
                sourceSample,
                clip.id || clip.selectionId
              );
              const timing = cfrFrameTiming(clip, frameIndex, frameRate);
              frameIndex += 1;
              if (timing.duration <= 0) {
                continue;
              }
              context.fillStyle = RENDER_LETTERBOX_COLOR;
              context.fillRect(0, 0, width, height);
              if (shortFormScene) {
                const geometry = shortFormVideoDrawGeometry(
                  baseVideoSample.displayWidth,
                  baseVideoSample.displayHeight,
                  width,
                  height,
                  shortFormScene
                );
                drawShortFormVideoSample(
                  baseVideoSample,
                  context,
                  geometry,
                  adaptiveShortFormRenderer,
                  1
                );
              } else {
                baseVideoSample.drawWithFit(context, { fit: "contain" });
              }
              if (shortFormScene) {
                const acquiredGroups: Array<{
                  sample: VideoSample;
                  layers: ShortFormVideoLayer[];
                }> = [];
                try {
                  for (const group of additionalLayerStreamGroups) {
                    const activeLayers = group.layers.filter((layer) => (
                      shortFormVideoLayerSourceTimeMs(
                        layer,
                        timing.localTimestamp * 1_000
                      ) !== null
                    ));
                    if (activeLayers.length === 0) {
                      continue;
                    }
                    const next = await group.iterator.next();
                    if (next.done || !next.value) {
                      throw new Error(
                        `${activeLayers[0]!.id} 추가 영상의 원본 프레임을 읽지 못했습니다.`
                      );
                    }
                    acquiredGroups.push({ sample: next.value, layers: activeLayers });
                  }
                  const draws = acquiredGroups
                    .flatMap(({ sample, layers }) => layers.map((layer) => ({
                      layer,
                      sample
                    })))
                    .sort((left, right) => (
                      left.layer.zIndex - right.layer.zIndex
                      || left.layer.id.localeCompare(right.layer.id)
                    ));
                  for (const { layer, sample } of draws) {
                    drawShortFormVideoSample(
                      sample,
                      context,
                      shortFormVideoLayerDrawGeometry(
                        sample.displayWidth,
                        sample.displayHeight,
                        width,
                        height,
                        layer
                      ),
                      adaptiveShortFormRenderer,
                      layer.opacity
                    );
                  }
                } finally {
                  for (const { sample } of acquiredGroups) {
                    sample.close();
                  }
                }
              }
              const activeImageAssets = await activeImageAssetCache.prepareAt(
                timing.outputTimestamp
              );
              for (const { asset, image } of activeImageAssets) {
                drawImageAsset(context, canvas, asset, image);
              }
              activeImageAssetCache.releaseThrough(
                timing.outputTimestamp + timing.duration
              );
              for (const cue of activeCuesAt(project, timing.outputTimestamp)) {
                drawCaption(context, canvas, project, cue);
              }
              const outputSample = new VideoSample(canvas, {
                timestamp: timing.outputTimestamp,
                duration: timing.duration
              });
              try {
                await videoSource.add(outputSample);
              } finally {
                outputSample.close();
              }
              onProgress(
                Math.min(0.98, (timing.outputTimestamp * 1000) / totalDurationMs),
                "video"
              );
            } finally {
              sourceSample?.close();
            }
          }
        } finally {
          await Promise.all(additionalLayerStreamGroups.map(async ({ iterator }) => {
            await iterator.return?.();
          }));
        }
        if (frameIndex !== endFrameIndex) {
          throw new Error("원본 영상의 CFR 프레임을 모두 읽지 못했습니다.");
        }
      }
      if (!pumpState.stopped) {
        videoSource.close();
      }
    };

    const pumpAudio = async () => {
      const sourceRanges = shortFormCanvas
        ? shortFormCanvas.sourceAudioAssets
        : clips;
      if (sourceRanges.length === 0) {
        return;
      }
      if (!audioSink || !audioSource) {
        throw new Error("내보낼 원본 음성 자산의 오디오 트랙을 준비하지 못했습니다.");
      }
      if (shortFormCanvas) {
        const contributions: ShortFormAudioMixContribution[] = [];
        for (const sourceRange of sourceRanges) {
          if (pumpState.stopped) {
            return;
          }
          const start = timeline.originSeconds + sourceRange.sourceStartMs / 1000;
          const end = timeline.originSeconds + sourceRange.sourceEndMs / 1000;
          const timelineStart = sourceRange.timelineStartMs / 1000;
          let wroteSample = false;
          for await (const sourceSample of audioSink.samples(start, end)) {
            try {
              if (pumpState.stopped) {
                return;
              }
              throwIfAborted(signal);
              const { frameStart, frameEnd } = audioTrimFrameRange(
                sourceSample,
                start,
                end
              );
              if (frameEnd <= frameStart) {
                continue;
              }
              const frameCount = frameEnd - frameStart;
              const data = new Float32Array(
                frameCount * sourceSample.numberOfChannels
              );
              sourceSample.copyTo(data, {
                planeIndex: 0,
                format: "f32",
                frameOffset: frameStart,
                frameCount
              });
              contributions.push({
                data,
                numberOfChannels: sourceSample.numberOfChannels,
                sampleRate: sourceSample.sampleRate,
                timelineStartSeconds: timelineStart
                  + sourceSample.timestamp
                  + frameStart / sourceSample.sampleRate
                  - start,
                asset: sourceRange as ShortFormRenderSourceAudioAsset
              });
              wroteSample = true;
            } finally {
              sourceSample.close();
            }
          }
          if (!wroteSample) {
            throw new Error(
              `${sourceRange.id} 원본 음성 자산의 샘플을 읽지 못했습니다.`
            );
          }
        }
        const mixed = mixShortFormAudioContributions(
          shortFormCanvas.durationMs,
          contributions,
          audioAutomation
        );
        const chunkFrameCount = 4_096;
        for (
          let frameStart = 0;
          frameStart < mixed.numberOfFrames;
          frameStart += chunkFrameCount
        ) {
          if (pumpState.stopped) {
            return;
          }
          throwIfAborted(signal);
          const frameEnd = Math.min(
            mixed.numberOfFrames,
            frameStart + chunkFrameCount
          );
          const sample = new AudioSample({
            data: mixed.data.slice(
              frameStart * mixed.numberOfChannels,
              frameEnd * mixed.numberOfChannels
            ),
            format: "f32",
            numberOfChannels: mixed.numberOfChannels,
            sampleRate: mixed.sampleRate,
            timestamp: frameStart / mixed.sampleRate
          });
          try {
            await audioSource.add(sample);
          } finally {
            sample.close();
          }
        }
        if (!pumpState.stopped) {
          audioSource.close();
        }
        return;
      }
      for (const sourceRange of sourceRanges) {
        if (pumpState.stopped) {
          return;
        }
        const start = timeline.originSeconds + sourceRange.sourceStartMs / 1000;
        const end = timeline.originSeconds + sourceRange.sourceEndMs / 1000;
        const timelineStart = sourceRange.timelineStartMs / 1000;
        for await (const sourceSample of audioSink.samples(start, end)) {
          try {
            if (pumpState.stopped) {
              return;
            }
            throwIfAborted(signal);
            const { frameStart, frameEnd } = audioTrimFrameRange(sourceSample, start, end);
            if (frameEnd <= frameStart) {
              continue;
            }
            const trimmed = sourceSample.trim(frameStart, frameEnd);
            try {
              trimmed.setTimestamp(timelineStart + trimmed.timestamp - start);
              const sourceAdjusted = trimmed;
              try {
                const automated = applyAudioAutomationToSample(
                  sourceAdjusted,
                  audioAutomation
                );
                try {
                  await audioSource.add(automated);
                } finally {
                  if (automated !== sourceAdjusted) {
                    automated.close();
                  }
                }
              } finally {
                if (sourceAdjusted !== trimmed) {
                  sourceAdjusted.close();
                }
              }
            } finally {
              trimmed.close();
            }
          } finally {
            sourceSample.close();
          }
        }
      }
      if (!pumpState.stopped) {
        audioSource.close();
      }
    };

    const runPump = async (pump: () => Promise<void>): Promise<void> => {
      try {
        await pump();
      } catch (error) {
        pumpState.primaryError ||= error;
        pumpState.stopped = true;
        throw error;
      }
    };
    const pumpResults = await Promise.allSettled([
      runPump(pumpVideo),
      runPump(pumpAudio)
    ]);
    const rejectedPump = pumpResults.find((result) => result.status === "rejected");
    if (rejectedPump) {
      throw pumpState.primaryError || rejectedPump.reason;
    }

    throwIfAborted(signal);
    onProgress(0.995, "finalize");
    fileTransaction?.prepareCommit();
    await output.finalize();
    completed = true;
    onProgress(1, "finalize");

    if (target instanceof BufferTarget) {
      if (!target.buffer) {
        throw new Error("메모리 영상 출력 버퍼가 생성되지 않았습니다.");
      }
      return {
        blob: new Blob([target.buffer], { type: outputCodecs.mimeType }),
        ...outputCodecs,
        width,
        height,
        frameRate
      };
    }
    return {
      blob: null,
      ...outputCodecs,
      width,
      height,
      frameRate
    };
  } catch (error) {
    if (output && output.state !== "finalized" && output.state !== "canceled") {
      await output.cancel().catch(() => {});
    }
    if (fileTransaction && !fileTransaction.settled) {
      await fileTransaction.abort(error).catch(() => {});
    }
    throw error;
  } finally {
    adaptiveShortFormRenderer?.destroy();
    input.dispose();
    imageAssetCache?.closeAll();
    if (!completed && fileTransaction && !fileTransaction.settled) {
      await fileTransaction.abort().catch(() => {});
    }
  }
}

export async function renderProjectVideo(
  sourceMedia: EditorMediaSource,
  project: RenderProject,
  options: RenderProjectVideoOptions = {}
) {
  const layout = options.layout ?? null;
  if (!isShortFormRenderLayout(layout)) {
    return renderProjectVideoAttempt(sourceMedia, project, {
      ...options,
      layout,
      shortFormBackend: "canvas2d"
    });
  }

  return runShortFormRenderWithCanvasRetry(
    (shortFormBackend) => renderProjectVideoAttempt(sourceMedia, project, {
      ...options,
      layout,
      shortFormBackend
    }),
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onFallback: () => {
        options.onProgress?.(0, SHORT_FORM_FALLBACK_RESTART_PHASE);
      }
    }
  );
}
