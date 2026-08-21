import {
  DEFAULT_SUBTITLE_COLOR,
  EDITOR_SEED_PREFIX,
  MAX_SUBTITLE_LANES,
  addSubtitleLane,
  adjacentSubtitleCueInLane,
  appendAiSubtitleDrafts,
  applyCaptionStylePreset,
  applyMediaAlignmentOffset,
  audioRegionAtTimeline,
  audioRegionTimelineRange,
  canReorderClipGroup,
  clipDurationMs,
  createAudioRegion,
  createEditorProjectFromCapture,
  createImageAsset,
  createSubtitleCue,
  cuesAtTimeline,
  cueTimelineRange,
  deleteAudioRegion,
  deleteImageAsset,
  deleteSubtitleCue,
  findAudioRegionOverlaps,
  imageAssetsAtTimeline,
  imageAssetTimelineRange,
  isAudSegBlankTimingCue,
  findSubtitleOverlaps,
  mapSourceToTimeline,
  mapTimelineToSource,
  matchImageAssetToSubtitleCue,
  matchSubtitleCueToImageAsset,
  mergeAiWarnings,
  mergeCaptureIntoEditorProject,
  normalizeEditorProject,
  projectDurationMs,
  reorderClip,
  reorderClipGroup,
  replaceAiBlankTimingDraft,
  replaceAiSubtitleDraft,
  resetAiSubtitlePositions,
  resolveSubtitleCueBackground,
  rememberSubtitleColor,
  resolveTimelineSnap,
  rippleDeleteTimelineRange,
  serializeSrt,
  sourceSessionIdentity,
  subtitleCueNeedsReview,
  timelineSnapCandidates,
  timelineSnapThresholdMs,
  updateAudioRegion,
  updateClipTrim,
  updateImageAsset,
  updateSubtitleCue
} from "../lib/editor-core.js";
import type {
  EditorAudioRegion,
  EditorClip,
  EditorImageAsset,
  EditorProject,
  EditorSubtitleCue
} from "../lib/editor-core.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  materializeEditorClipWithinEditableBounds,
  materializedEditableBoundsForClip,
  materializationRequestRangeForClip,
  logicalEditableBoundsForClip,
  materializedMediaTimelineMatches,
  mediaMsToSourceMs,
  normalizeChzzkVodMaterialization,
  normalizeChzzkVodRightsConfirmation,
  sourceMsToMediaMs
} from "../lib/chzzk-vod-materialization.js";
import type {
  ChzzkVodMaterialization,
  MaterializationClipCoverage
} from "../lib/chzzk-vod-materialization.js";
import {
  createCaptionPropertiesSheet
} from "../lib/caption-properties-sheet.js";
import {
  KIRINUKI_STUDIO_ORIGIN_META_NAME,
  assertKirinukiStudioDocumentOrigin,
  isKirinukiStudioOrigin
} from "../lib/local-runtime-origin.js";

import type {
  CaptionPropertiesSheetRow
} from "../lib/caption-properties-sheet.js";
import {
  DEFAULT_CAPTION_STYLE_PRESET_ID,
  captionSpeakerColor,
  captionSpeakerColorAssignments,
  captionStylePreset
} from "../lib/caption-style.js";
import {
  EDITOR_SHORTCUT_BINDINGS,
  captionColorShortcutDigitFromEvent,
  clipNavigationShortcutDirectionFromEvent,
  editorKeyboardShortcutBinding,
  formatKeyboardShortcutHint,
  isKeyboardShortcutEventBlocked,
  keyboardShortcutLetterFromEvent
} from "../lib/keyboard-shortcuts.js";
import type {
  KeyboardShortcutBinding
} from "../lib/keyboard-shortcuts.js";
import {
  StaleSerialOperationGenerationError,
  createGenerationBoundSerialOperationQueue
} from "../lib/serial-operation-gate.js";
import {
  currentClientCannotUseEditor
} from "../lib/editor-mobile-access.js";
import {
  LocalMediaEngineConnectionError,
  ensureLocalMediaEngineReady,
  invalidatePrimedLocalMediaEngineTrust,
  primeLocalMediaEngineTrust
} from "./local-media-engine-onboarding.js";
import {
  isSafeSessionCleanupMediaUrl,
  sessionCleanupMarkerMatchesMaterializedBinding
} from "../lib/session-cleanup.js";
import {
  assertEditorMediaSourceMode,
  captionFontSizeForSurface,
  copySingleClipPacketsForPreview,
  enableHighQualityImageSmoothing,
  extractClipPcm16k,
  exportProgressPercent,
  fitSingleLineCaptionFontSize,
  getPreferredOutputProfile,
  imageAssetDrawRect,
  inspectMediaFile,
  isMaterializedLoopbackMediaSource,
  normalizeMaterializedLoopbackMediaSource,
  renderProjectVideo,
  SHORT_FORM_FALLBACK_RESTART_PHASE,
  shortFormDestinationRectForTarget,
  shortFormSourceAudioAssetGainAt,
  shortFormSourceCropFromNormalizedRect,
  singleLineCaptionText
} from "./media-engine.js";
import type {
  EditorMediaSource,
  MaterializedLoopbackMediaSource
} from "./media-engine.js";
import {
  beginEditingSessionCheckpoint,
  commitEditingSessionCheckpoint,
  discardEditingSessionCheckpoint,
  deleteProjectSessionAtomically,
  deleteMediaHandle,
  deleteShortVideoCache,
  getFileFromStoredHandle,
  listShortVideoCaches,
  listLocalDrafts,
  loadImageAssetBlob,
  loadShortVideoCache,
  loadLocalDraft,
  loadProject,
  pruneImageAssetBlobs,
  pruneShortVideoCaches,
  replaceProjectSessionAtomically,
  restoreLocalDraft,
  saveMediaHandle,
  saveLocalDraft,
  saveProjectWithImageAssetBlob,
  saveShortVideoCache,
  saveProject
} from "./project-store.js";
import type {
  LocalDraftRecord,
  ProjectSessionDeletionCounts,
  ShortVideoCacheRecord
} from "./project-store.js";
import {
  AUDSEG_DRAFT_MODEL,
  AUDSEG_ENGINE_VERSION,
  audSegAudioFootprint,
  audSegBlankSubtitleDrafts,
  segmentAudSegPcmInWorker
} from "./audseg.js";
import {
  DEFAULT_CAPTION_AGENT_SETTINGS,
  MAX_CAPTION_AGENT_CLIPS_PER_RUN,
  MAX_CAPTION_AGENT_CUES_PER_RUN,
  captionAgentAudioFootprint,
  captionAgentCapabilityReady,
  captionAgentEditorialContextFingerprint,
  captionAgentResumePlan,
  captionAgentRunClipLimit,
  captionAgentRuntimeIdentity,
  captionAgentRunEstimate,
  clearLocalMediaEngineSessionState,
  createCaptionAgentCheckpoint,
  createCaptionAgentRequest,
  discardCaptionAgentCheckpointsForClips,
  encodePcm16WavBase64,
  ensureCaptionAgentSession,
  isLoopbackCaptionAgentEndpoint,
  loadCaptionAgentSettings,
  normalizeCaptionAgentCues,
  probeCaptionAgent,
  requestCaptionAgentWithSessionRetry,
  sameCaptionMediaIdentity,
  saveCaptionAgentSettings,
  upsertCaptionAgentCheckpoint
} from "./caption-agent.js";
import type {
  CaptionAgentSettings,
  CaptionClip,
  CaptionModel
} from "./caption-agent.js";
import {
  ChzzkVodMaterializationClientError,
  KIRINUKI_MEDIA_ENGINE_ENDPOINT,
  cancelChzzkVodMaterialization,
  purgeChzzkVodConsumerSessionCache,
  startChzzkVodMaterialization,
  waitForChzzkVodMaterialization
} from "./chzzk-vod-client.js";
import {
  LocalMediaEngineTransportError
} from "./local-media-engine-transport.js";
import type {
  ChzzkVodEditableRangeRequest,
  ChzzkVodLocalMedia,
  ChzzkVodMaterializationStatus
} from "./chzzk-vod-client.js";
import {
  devReloadProjectFingerprint,
  devReloadResumeUrl,
  devReloadStyleUrl,
  normalizeDevReloadMarker
} from "./dev-reload.js";
import type { DevReloadMarker } from "./dev-reload.js";
import {
  nextEnabledPreviewClip,
  preparedPreviewMatches,
  previewReachedClipBoundary
} from "./preview-transition.js";
import type { PreviewClip } from "./preview-transition.js";
import {
  usagePolicyBasisLabel
} from "../lib/usage-policy.js";
import type {
  UsagePolicyBasis,
  UsagePolicyPurpose
} from "../lib/usage-policy.js";
import { WHISPER_MODEL_CATALOG } from "../lib/whisper-connection.js";
import type { WhisperModelId } from "../lib/whisper-connection.js";
import {
  SHORT_FORM_CANVAS_CLIP_ID,
  SHORT_FORM_MIN_CLIP_DURATION_MS,
  SHORT_FORM_OUTPUT_HEIGHT,
  SHORT_FORM_OUTPUT_WIDTH,
  SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS,
  MAX_SHORT_FORM_WORKSPACES,
  activateShortFormWorkspace,
  activeShortFormWorkspace,
  addShortFormWorkspace,
  addShortFormVideoLane,
  addShortFormVideoAsset,
  canAddShortFormVideoAsset,
  createShortFormWorkspaceProject,
  detectShortFormCanvasEdgeGaps,
  detectShortFormCompositeCanvasGaps,
  deriveShortFormRenderProject,
  normalizeShortFormDestinationRect,
  normalizeShortFormSourceRect,
  normalizeShortFormWorkspaceCollection,
  renameShortFormWorkspace,
  repairShortFormCompositeCanvasGap,
  shortFormCanvasClip,
  shortFormCanvasContentRange,
  shortFormBranchFromWorkspace,
  shortFormWorkspaceProjectWithBranch,
  squeegeeShortFormVideoAsset,
  trimShortFormCanvasToContent,
  removeShortFormSourceAudioAsset,
  removeShortFormVideoAsset,
  reorderShortFormVideoAssets,
  saveActiveShortFormWorkspace,
  deleteShortFormWorkspace,
  shortFormVideoAssetsAtTimeline,
  updateShortFormSourceAudioAsset,
  updateShortFormVideoAsset
} from "../lib/short-form.js";
import type {
  ActiveShortFormVideoAsset,
  ShortFormDestinationRect,
  ShortFormSliceRequest,
  ShortFormSourceAudioAsset,
  ShortFormSourceRect,
  ShortFormVideoAsset,
  ShortFormSqueegeeDirection
} from "../lib/short-form.js";
import { AdaptiveVideoScaler } from "./adaptive-video-scaler.js";
import {
  initialShortPreviewCacheCoverage,
  nextShortPreviewCacheCoverage,
  shortPreviewCacheCoverageContainsRange,
  shortPreviewCacheCoverageContainsTime
} from "./short-preview-cache-policy.js";
import {
  shortPreviewCombinedAvCacheReady,
  shortPreviewSourceAudioExactlyOverridesVideo,
  shortPreviewVideoLayerAudioDecision,
  shortPreviewPlaybackDecision
} from "./short-preview-playback-policy.js";
import {
  RECOVERY_DRAFTS_MODE,
  RECOVERY_SESSION_MODE,
  recoverySourceRecord
} from "../lib/session-recovery.js";
import {
  MEDIA_RECOVERY_SCHEMA,
  SESSION_ARCHIVE_MAX_JSON_BYTES,
  buildSessionArchive,
  normalizeSessionArchiveMediaRecovery,
  parseSessionArchiveJson,
  restoreSessionArchiveImageBlobs,
  restoreSessionArchiveProject,
  stringifySessionArchive
} from "../lib/session-archive.js";
import type {
  SessionArchiveMediaRecovery
} from "../lib/session-archive.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  canonicalSourceUrl,
  inferSourceIdentifiers,
  sourcePlatformLabel
} from "../lib/source-platform.js";
import {
  acquireStudioProjectWriter,
  bindStudioEditorProject,
  completeStudioEditorSession,
  countStudioProjectEditors,
  leaveCompletedStudioEditor,
  resolveStudioEditorEntry,
  runStudioSourceAction,
  studioAssetUrl,
  studioEditorReady,
  studioStorageArea,
  verifyStudioUsagePolicyGate
} from "./studio-runtime.js";

declare const __KIRINUKI_SUBTITLE_SYNC_SKILL_MARKDOWN__: string;

const CONFIGURED_KIRINUKI_STUDIO_ORIGIN =
  document.querySelector<HTMLMetaElement>(
    `meta[name="${KIRINUKI_STUDIO_ORIGIN_META_NAME}"]`
  )?.content;

assertKirinukiStudioDocumentOrigin(
  location.origin,
  CONFIGURED_KIRINUKI_STUDIO_ORIGIN
);

const SUBTITLE_SYNC_SKILL_MARKDOWN =
  __KIRINUKI_SUBTITLE_SYNC_SKILL_MARKDOWN__;
const USAGE_POLICY_LEASE_HEARTBEAT_MS = 60 * 1_000;

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: unknown): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: unknown): Promise<FileSystemFileHandle>;
  }
}

const CAPTION_REVIEW_WARNING_CODES = new Set([
  "NO_RECOGNIZABLE_SPEECH",
  "AUDSEG_NO_ACTIVITY",
  "AUDSEG_CONTINUOUS_ACTIVITY",
  "AUDSEG_LOW_LEVEL_CONTRAST",
  "AUDSEG_NOISE_FLOOR_CAPPED",
  "DROPPED_INVALID_CUE",
  "DROPPED_EMPTY_RANGE",
  "TRIMMED_CUE_COUNT",
  "TRIMMED_WARNING_COUNT",
  "HARNESS_READING_RATE_EXCEEDED",
  "HARNESS_TRANSCRIPT_COVERAGE_LOW",
  "HARNESS_TRANSCRIPT_PRECISION_LOW",
  "HARNESS_SHORT_CUE_UNRESOLVED",
  "HARNESS_UNRESOLVED_SAME_SPEAKER_OVERLAP",
  "HARNESS_CUE_TEXT_TOO_WIDE",
  "HARNESS_LINE_TOO_WIDE",
  "HARNESS_TOO_MANY_LINES"
]);

const AUDSEG_WARNING_CODES: Readonly<Record<string, string>> = Object.freeze({
  empty_audio: "AUDSEG_NO_ACTIVITY",
  no_activity_detected: "AUDSEG_NO_ACTIVITY",
  nearly_continuous_activity: "AUDSEG_CONTINUOUS_ACTIVITY",
  low_level_contrast: "AUDSEG_LOW_LEVEL_CONTRAST",
  noise_floor_capped: "AUDSEG_NOISE_FLOOR_CAPPED"
});

interface EditorControl extends HTMLElement {
  value: string;
  checked: boolean;
  disabled: boolean;
  files: FileList | null;
  href: string;
  max: string;
  content: DocumentFragment;
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  src: string;
  readyState: number;
  open: boolean;
  alt: string;
  videoWidth: number;
  videoHeight: number;
  ended: boolean;
  showModal(): void;
  close(): void;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  select(): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type CaptionAgentRuntime = ReturnType<typeof captionAgentRuntimeIdentity>;
type TimelineSide = "left" | "right";
type VodHotLoadSide = "before" | "after";
type RangeBoundarySide = "start" | "end";
type TimelineRangePurpose = "delete" | "short-source";
type ShortSourceAspect = "free" | "9:16" | "1:1";
type TimedBlockKind = "subtitle" | "asset";
type TimelineRange = { startMs: number; endMs: number };
type LocalDraftReason = LocalDraftRecord["reason"];

interface ShortSourceCropDraft {
  x: number;
  y: number;
  width: number;
  height: number;
  referenceWidth: number;
  referenceHeight: number;
}

interface ShortSourceCropGesture {
  pointerId: number;
  handle: string;
  startClientX: number;
  startClientY: number;
  startRect: ShortSourceCropDraft;
  surfaceWidth: number;
  surfaceHeight: number;
}

interface ShortSourcePickerReturnState {
  workspaceProject: EditorProject;
  rootProject: EditorProject;
  undoStack: EditorProject[];
  redoStack: EditorProject[];
}

interface ShortWorkspaceTransformGesture {
  pointerId: number;
  handle: string;
  startClientX: number;
  startClientY: number;
  startRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layerWidth: number;
  layerHeight: number;
  projectSnapshot: EditorProject;
  redoStackSnapshot: EditorProject[];
  changed: boolean;
}

type ShortWorkspaceVideoLayerView = ShortFormVideoAsset;

interface ShortPreviewLayerVideoState {
  video: HTMLVideoElement;
  audioSourceNode: MediaElementAudioSourceNode | null;
  audioGainNode: GainNode | null;
  mediaUrl: string;
  targetSeconds: number;
  ready: boolean;
  error: Error | null;
  seekingTargetSeconds: number | null;
  playPromise: Promise<void> | null;
  decodedFrameCallback: number | null;
}

interface ShortPreviewAssetCacheState {
  assetId: string;
  objectUrl: string;
  sourceStartMs: number;
  sourceEndMs: number;
  mediaOffsetMs: number;
  hasAudio: boolean;
  sourceFingerprint: string;
  sizeBytes: number;
}

interface ShortPreviewSourceAudioState {
  video: HTMLVideoElement;
  mediaUrl: string;
  cacheSourceStartMs: number;
  cacheMediaOffsetMs: number;
  assetId: string | null;
  targetSeconds: number;
  synchronized: boolean;
  playPromise: Promise<void> | null;
  error: Error | null;
}

interface TimelineSnapMatch extends Record<string, unknown> {
  timeMs: number;
  deltaMs: number;
  distanceMs: number;
  priority: number;
  label?: string;
  kind?: string;
  edge?: string;
  itemId?: string | null;
}

interface FieldEditSession {
  key: string;
  snapshot: EditorProject;
  recorded: boolean;
}

interface TimelineSnapOptions {
  clipId?: string;
  movingKind?: TimedBlockKind;
  itemId?: string;
  altKey?: boolean;
  minimumTimelineMs?: number;
  maximumTimelineMs?: number;
}

interface CaptionUiConfig {
  endpoint: string;
  token: string;
  model: CaptionModel;
  capability?: CaptionCapability | null;
  runtime?: CaptionAgentRuntime;
}

interface PendingPreviewSeek {
  sequence: number;
  sourceMs: number;
  targetSeconds: number;
}

interface PreparedPreviewState {
  sequence: number;
  fromClipId: string | null;
  clipId: string;
  targetSeconds: number;
  ready: boolean;
  promise: Promise<boolean> | null;
}

interface CaptionCapability extends Record<string, unknown> {
  availableModels?: unknown[];
  provider?: unknown;
  configured?: { localWhisperReady?: boolean };
  models?: { stt?: string };
  transcription?: { ready?: boolean };
}

interface PreparedCaptionUiConfig extends CaptionUiConfig {
  capability: CaptionCapability | null;
  runtime: CaptionAgentRuntime;
}

interface ExportSidecar {
  name: string;
  blob: Blob;
}

interface SavedExportSidecar extends ExportSidecar {
  fileHandle: FileSystemFileHandle;
}

interface VerifiedExportSidecar {
  name: string;
  sizeBytes: number;
  sha256: string;
}

interface VerifiedExportBundle {
  sizeBytes: number;
  durationMs: number;
  sidecars: VerifiedExportSidecar[];
}

interface TimelineContextState {
  timelineMs: number;
  lane: number | null;
  cueId: string | null;
  imageAssetId: string | null;
  audioRegionId: string | null;
  kind: "video" | "caption" | "asset" | "audio";
}

interface ActiveUsagePolicySession {
  projectId: string;
  sourceSessionId: string;
  sessionLeaseId: string;
  transitionGeneration: number;
  purpose: UsagePolicyPurpose;
  basis: UsagePolicyBasis;
  confirmedAt: string;
}

interface VodHotLoadTrimIntent {
  sequence: number;
  workspaceClipId: string;
  sourceClipId: string;
  side: TimelineSide;
  targetSourceMs: number;
}

interface PendingVodHotLoadBatch {
  sequence: number;
  editableRanges: Map<string, ChzzkVodEditableRangeRequest>;
  trimIntents: Map<string, VodHotLoadTrimIntent>;
  waiters: Array<(loaded: boolean) => void>;
}

interface VodCoveragePlan {
  clips: Array<{ id: string; startMs: number; endMs: number }>;
  editableRanges: ChzzkVodEditableRangeRequest[];
  expandsCurrentMaterialization: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function internalMediaEngineErrorMessage(
  error: unknown,
  feature: "VOD" | "Whisper"
): string {
  const message = errorMessage(error);
  const recovery = feature === "Whisper"
    ? "현재 공개 설치판은 Whisper를 제공하지 않습니다. AudSeg 또는 자막 작업 프롬프트를 사용해 주세요."
    : "설치 안내가 보이면 이 PC용 영상 준비 도구를 한 번 설치한 뒤 같은 버튼을 다시 눌러 주세요.";
  if (
    /failed to fetch|networkerror|load failed|시간.*초과|timed?\s*out|econnrefused/iu.test(message)
  ) {
    return `${feature}용 내부 미디어 엔진을 시작하지 못했습니다. ${recovery}`;
  }
  if (/\b403\b|origin|출처/iu.test(message)) {
    return `${feature}용 내부 미디어 엔진이 현재 편집 세션을 확인하지 못했습니다. ${recovery}`;
  }
  if (/\b429\b|너무 많은|rate/iu.test(message)) {
    return `${feature}용 내부 미디어 엔진이 다른 작업을 마무리하고 있습니다. 잠시 뒤 같은 버튼을 다시 눌러 주세요.`;
  }
  if (
    /companion|gateway|게이트웨이|도우미|localhost|127\.0\.0\.1|endpoint|port|포트|setup/iu.test(message)
  ) {
    return `${feature}용 내부 미디어 엔진을 준비하지 못했습니다. ${recovery}`;
  }
  return message;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function errorDetails(error: unknown): string {
  const name = errorName(error);
  const message = errorMessage(error);
  if (!name || name === "Error" || message === name) {
    return message;
  }
  return `${name}: ${message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const EDITOR_ELEMENT_IDS = [
  "editor-app-gate",
  "editor-mobile-gate",
  "editor-policy-gate",
  "editor-policy-gate-status",
  "editor-shell",
  "project-name",
  "source-kind",
  "source-title",
  "workspace-mode-badge",
  "usage-policy-status",
  "source-link-state",
  "undo",
  "redo",
  "finish-editing-session",
  "create-local-draft",
  "open-local-drafts",
  "prepare-chzzk-vod",
  "pick-media",
  "open-short-form",
  "short-form-count",
  "exit-short-form",
  "export-video",
  "open-subtitle-sync-guide",
  "subtitle-sync-guide-dialog",
  "subtitle-sync-guide-title",
  "close-subtitle-sync-guide",
  "copy-subtitle-sync-skill",
  "subtitle-sync-copy-status",
  "subtitle-sync-skill-content",
  "clip-count",
  "media-card",
  "media-name",
  "media-meta",
  "source-offset",
  "apply-source-offset",
  "clip-list",
  "clip-group-toolbar",
  "clip-group-status",
  "move-selected-clips-up",
  "move-selected-clips-down",
  "clear-clip-group-selection",
  "clip-template",
  "focus-source",
  "workspace-mode-title",
  "preview-source-tab",
  "start-short-source-composer",
  "stage",
  "preview-video",
  "short-source-composer",
  "short-source-composer-panel",
  "short-source-composer-body",
  "short-source-composer-title",
  "short-source-composer-description",
  "toggle-short-source-composer-collapse",
  "close-short-source-composer",
  "short-source-crop-surface",
  "short-source-crop-box",
  "short-source-crop-move",
  "short-source-start-time",
  "short-source-end-time",
  "set-short-source-start",
  "set-short-source-end",
  "short-source-whole-clip",
  "short-source-to-clip-end",
  "short-source-start-to-clip-start",
  "short-source-end-to-clip-end",
  "preview-short-source-start",
  "preview-short-source-end",
  "short-source-crop-x",
  "short-source-crop-y",
  "short-source-crop-width",
  "short-source-crop-height",
  "short-source-aspect-free",
  "short-source-aspect-portrait",
  "short-source-aspect-square",
  "short-source-crop-full",
  "short-source-readout",
  "short-source-layer-intent",
  "cancel-short-video-layer-add",
  "cancel-short-source-composer",
  "add-short-source-only",
  "add-short-source-and-open",
  "short-workspace-preview",
  "retry-short-preview-cache",
  "short-preview-cache-status",
  "short-workspace-transform-layer",
  "short-workspace-transform-box",
  "short-workspace-transform-move",
  "short-workspace-safe-area-overlay",
  "stage-empty",
  "stage-empty-title",
  "stage-empty-copy",
  "prepare-chzzk-vod-empty",
  "pick-media-empty",
  "subtitle-overlays",
  "image-asset-overlays",
  "previous-clip",
  "play-toggle",
  "next-clip",
  "current-time",
  "duration-time",
  "toggle-mute",
  "volume",
  "caption-mode-tab",
  "asset-mode-tab",
  "audio-mode-tab",
  "short-framing-mode-tab",
  "inspector-title",
  "caption-inspector-content",
  "asset-inspector-content",
  "audio-inspector-content",
  "short-framing-inspector-content",
  "short-workspace-projects",
  "short-workspace-project-count",
  "short-workspace-select",
  "short-workspace-name",
  "create-short-workspace",
  "duplicate-short-workspace",
  "delete-short-workspace",
  "short-video-layer-panel",
  "short-video-layer-count",
  "add-short-video-layer",
  "short-video-layer-list",
  "short-video-layer-empty",
  "short-video-layer-controls",
  "short-video-layer-start",
  "short-video-layer-end",
  "short-video-layer-opacity",
  "short-video-layer-opacity-value",
  "short-video-layer-volume",
  "short-video-layer-volume-value",
  "toggle-short-video-layer-visibility",
  "delete-short-video-layer",
  "short-workspace-fit",
  "short-workspace-zoom",
  "short-workspace-zoom-value",
  "short-workspace-crop-x",
  "short-workspace-crop-x-value",
  "short-workspace-crop-y",
  "short-workspace-crop-y-value",
  "short-workspace-scale",
  "short-workspace-scale-value",
  "short-workspace-position-x",
  "short-workspace-position-x-value",
  "short-workspace-position-y",
  "short-workspace-position-y-value",
  "short-workspace-destination-x",
  "short-workspace-destination-y",
  "short-workspace-destination-width",
  "short-workspace-destination-height",
  "short-workspace-destination-lock-aspect",
  "short-workspace-destination-readout",
  "short-workspace-transform-controls",
  "short-workspace-squeegee",
  "short-workspace-edge-gap-status",
  "short-workspace-squeegee-actions",
  "short-workspace-legacy-framing",
  "short-workspace-safe-area",
  "short-workspace-position-presets",
  "short-workspace-source",
  "short-workspace-duration",
  "reset-short-workspace-framing",
  "copy-short-workspace-framing",
  "add-cue-top",
  "caption-agent-token",
  "caption-style-preset",
  "toggle-caption-background",
  "caption-background-label",
  "previous-cue-in-lane",
  "next-cue-in-lane",
  "caption-model",
  "audseg-provider-tab",
  "whisper-provider-tab",
  "audseg-provider-panel",
  "whisper-provider-panel",
  "connect-local-whisper",
  "whisper-connection-status",
  "whisper-model-summary",
  "whisper-model-catalog",
  "caption-local-status",
  "caption-advanced-settings",
  "test-caption-agent",
  "caption-agent-warning",
  "generate-captions",
  "reset-ai-caption-positions",
  "ai-progress",
  "ai-progress-label",
  "ai-progress-value",
  "open-caption-sheet",
  "caption-sheet-dialog",
  "caption-sheet-summary",
  "caption-sheet-common-style",
  "caption-sheet-table",
  "caption-sheet-body",
  "caption-sheet-empty",
  "close-caption-sheet-dialog",
  "cue-list-tab",
  "cue-selected-tab",
  "cue-selected-panel",
  "cue-count",
  "cue-empty",
  "cue-editor",
  "cue-review-note",
  "cue-text",
  "cue-start",
  "cue-end",
  "cue-x",
  "cue-y",
  "cue-x-value",
  "cue-y-value",
  "font-size",
  "font-color",
  "caption-color-register",
  "reset-font-color",
  "match-cue-to-asset",
  "cue-timing-match-help",
  "delete-cue",
  "cue-list",
  "asset-empty",
  "asset-editor",
  "asset-thumbnail",
  "asset-name",
  "asset-meta",
  "asset-start",
  "asset-end",
  "match-asset-to-cue",
  "asset-timing-match-help",
  "asset-x",
  "asset-y",
  "asset-x-value",
  "asset-y-value",
  "asset-scale",
  "asset-scale-value",
  "asset-opacity",
  "asset-opacity-value",
  "asset-paste",
  "asset-pick-file",
  "delete-asset",
  "audio-empty",
  "audio-editor",
  "audio-region-label",
  "audio-start",
  "audio-end",
  "audio-volume",
  "audio-volume-value",
  "audio-mute",
  "audio-mute-label",
  "audio-fade-in",
  "audio-fade-in-value",
  "audio-fade-out",
  "audio-fade-out-value",
  "reset-audio-region",
  "delete-audio-region",
  "set-range-start",
  "set-range-end",
  "clear-range",
  "delete-range",
  "trim-short-canvas-empty-edges",
  "add-audio-region",
  "paste-image-asset",
  "add-cue",
  "video-lane-count",
  "add-video-lane",
  "subtitle-lane-count",
  "add-subtitle-lane",
  "toggle-timeline-collapse",
  "fit-timeline",
  "toggle-timeline-snap",
  "timeline-zoom",
  "timeline-grid",
  "timeline-scroll",
  "timeline-content",
  "timeline-ruler",
  "video-track",
  "asset-track",
  "audio-track",
  "source-audio-track-label",
  "source-audio-track",
  "caption-tracks",
  "timeline-snap-guide",
  "timeline-range-selection",
  "timeline-range-summary",
  "range-start-handle",
  "range-end-handle",
  "playhead",
  "timeline-context-menu",
  "context-set-range-start",
  "context-set-range-end",
  "context-delete-range",
  "context-add-cue",
  "context-paste-asset",
  "context-pick-asset",
  "context-add-audio",
  "context-delete-cue",
  "context-delete-asset",
  "context-delete-audio",
  "context-add-lane",
  "media-input",
  "asset-input",
  "session-archive-input",
  "job-dialog",
  "job-title",
  "job-message",
  "job-progress",
  "job-percent",
  "cancel-job",
  "local-draft-dialog",
  "local-draft-title",
  "local-draft-description",
  "local-draft-list",
  "local-draft-empty",
  "local-draft-status",
  "restore-local-draft",
  "open-session-archive-file",
  "close-local-draft-dialog",
  "export-options-dialog",
  "export-file-title",
  "export-file-name-preview",
  "export-edge-gap-warning",
  "export-edge-gap-summary",
  "cancel-export-options",
  "cancel-export-options-footer",
  "confirm-export-options",
  "cleanup-after-export-dialog",
  "cleanup-after-export-summary",
  "keep-export-session-cache-icon",
  "keep-export-session-cache",
  "delete-export-session-cache",
  "session-completed-dialog",
  "session-completed-summary",
  "close-completed-editor",
  "editing-session-exit-dialog",
  "editing-session-exit-description",
  "editing-session-exit-status",
  "cancel-editing-session-exit",
  "save-and-exit-editing-session",
  "discard-and-exit-editing-session",
  "toast"
] as const;

type EditorElementKey<Id extends string> =
  Id extends `${infer Head}-${infer Tail}`
    ? `${Head}_${EditorElementKey<Tail>}`
    : Id;

type EditorElementType<Id extends string> =
  Id extends "preview-video"
    ? HTMLVideoElement
    : Id extends "short-workspace-preview"
      ? HTMLCanvasElement
      : Id extends "short-workspace-select"
        ? HTMLSelectElement
        : EditorControl;

type EditorElementMap = {
  [Id in typeof EDITOR_ELEMENT_IDS[number] as EditorElementKey<Id>]: EditorElementType<Id>;
};

function isEditorElementMap(value: unknown): value is EditorElementMap {
  if (!isRecord(value)) {
    return false;
  }
  return EDITOR_ELEMENT_IDS.every((id) => {
    const element = value[id.replaceAll("-", "_")];
    return element instanceof HTMLElement
      && (id !== "preview-video" || element instanceof HTMLVideoElement)
      && (
        id !== "short-workspace-preview"
        || element instanceof HTMLCanvasElement
      )
      && (
        id !== "short-workspace-select"
        || element instanceof HTMLSelectElement
      );
  });
}

const elementCandidates = Object.fromEntries(EDITOR_ELEMENT_IDS.map((id) => {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) {
    throw new Error(`편집기 필수 UI 요소를 찾지 못했습니다: #${id}`);
  }
  return [id.replaceAll("-", "_"), element];
}));
if (!isEditorElementMap(elementCandidates)) {
  throw new Error("편집기 필수 UI 요소 타입이 올바르지 않습니다.");
}
const elements = elementCandidates;

function normalizeActiveUsagePolicySession(
  value: unknown,
  expectedProjectId: string
): ActiveUsagePolicySession {
  if (!isRecord(value)) {
    throw new Error("편집기 정책 세션 응답 형식이 올바르지 않습니다.");
  }
  const allowedKeys = new Set([
    "projectId",
    "sourceSessionId",
    "sessionLeaseId",
    "transitionGeneration",
    "purpose",
    "basis",
    "confirmedAt"
  ]);
  const basis = String(value.basis || "");
  const confirmedAt = String(value.confirmedAt || "");
  const hasSessionLease = Object.hasOwn(value, "sessionLeaseId")
    || Object.hasOwn(value, "transitionGeneration");
  const sessionLeaseId = hasSessionLease
    ? String(value.sessionLeaseId || "")
    : "";
  const transitionGeneration = hasSessionLease
    ? Number(value.transitionGeneration)
    : 0;
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key))
    || value.projectId !== expectedProjectId
    || typeof value.sourceSessionId !== "string"
    || !value.sourceSessionId
    || (
      hasSessionLease
      && (
        !/^[a-f0-9]{64}$/u.test(sessionLeaseId)
        || !Number.isSafeInteger(transitionGeneration)
        || transitionGeneration <= 0
      )
    )
    || ![
      "editor-new",
      "editor-resume",
      "editor-recovery"
    ].includes(String(value.purpose))
    || ![
      "public-policy",
      "written-permission",
      "official-editor",
      "per-use-confirmation"
    ].includes(basis)
    || !Number.isFinite(Date.parse(confirmedAt))
  ) {
    throw new Error("편집기 정책 세션 응답 형식이 올바르지 않습니다.");
  }
  return {
    projectId: expectedProjectId,
    sourceSessionId: value.sourceSessionId,
    sessionLeaseId,
    transitionGeneration,
    purpose: value.purpose as UsagePolicyPurpose,
    basis: basis as UsagePolicyBasis,
    confirmedAt: new Date(Date.parse(confirmedAt)).toISOString()
  };
}

function usagePolicyPurposeFromLocation(): UsagePolicyPurpose {
  const params = new URLSearchParams(location.search);
  if (params.get("session") !== RECOVERY_SESSION_MODE) {
    return "editor-new";
  }
  return params.get("recovery") === RECOVERY_DRAFTS_MODE
    ? "editor-recovery"
    : "editor-resume";
}

function syncEditorUrlToUsagePolicySession(
  session: ActiveUsagePolicySession
): void {
  const url = new URL(location.href);
  url.searchParams.set("project", session.projectId);
  url.searchParams.delete("usageGate");
  if (
    session.purpose === "editor-new"
    && url.searchParams.get("session") !== RECOVERY_SESSION_MODE
  ) {
    url.searchParams.delete("session");
    url.searchParams.delete("recovery");
  } else {
    url.searchParams.set("session", RECOVERY_SESSION_MODE);
    if (session.purpose === "editor-recovery") {
      url.searchParams.set("recovery", RECOVERY_DRAFTS_MODE);
    } else {
      url.searchParams.delete("recovery");
    }
  }
  history.replaceState(null, "", url.href);
}

/**
 * Once the one-shot capture seed has become a durable browser-local project,
 * make the current URL reloadable.  A normal F5 must reopen that exact
 * project instead of trying to consume the already-deleted navigation seed a
 * second time.
 */
function markEditorUrlReloadable(): void {
  const url = new URL(location.href);
  url.searchParams.set("project", project.id);
  url.searchParams.set("session", RECOVERY_SESSION_MODE);
  url.searchParams.delete("recovery");
  url.searchParams.delete("usageGate");
  history.replaceState(null, "", url.href);
}

function clearUsagePolicyExpiryTimer(): void {
  if (usagePolicyExpiryTimer !== null) {
    window.clearTimeout(usagePolicyExpiryTimer);
    usagePolicyExpiryTimer = null;
  }
}

function sameUsagePolicyLease(
  left: ActiveUsagePolicySession,
  right: ActiveUsagePolicySession
): boolean {
  return (
    left.projectId === right.projectId
    && left.sourceSessionId === right.sourceSessionId
    && left.sessionLeaseId === right.sessionLeaseId
    && left.transitionGeneration === right.transitionGeneration
    && left.purpose === right.purpose
    && left.basis === right.basis
    && left.confirmedAt === right.confirmedAt
  );
}

class ReplacedUsagePolicyLeaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReplacedUsagePolicyLeaseError";
  }
}

async function refreshUsagePolicyLease(
  expected: ActiveUsagePolicySession
): Promise<boolean> {
  const response: unknown = await verifyStudioUsagePolicyGate({
    projectId: expected.projectId,
    gateToken: ""
  });
  if (!isRecord(response) || response.ok !== true) {
    throw new ReplacedUsagePolicyLeaseError(
      isRecord(response) && typeof response.error === "string"
        ? response.error
        : "편집 세션 활성 상태를 확인하지 못했습니다."
    );
  }
  let refreshed: ActiveUsagePolicySession;
  try {
    refreshed = normalizeActiveUsagePolicySession(
      response.usagePolicy,
      expected.projectId
    );
  } catch (error) {
    throw new ReplacedUsagePolicyLeaseError(
      "편집 세션 활성 상태가 올바르지 않습니다.",
      { cause: error }
    );
  }
  if (usagePolicySession !== expected) {
    return false;
  }
  if (!sameUsagePolicyLease(refreshed, expected)) {
    throw new ReplacedUsagePolicyLeaseError(
      "다른 편집 작업으로 전환되어 이전 화면을 종료합니다."
    );
  }
  usagePolicySession = refreshed;
  return true;
}

function leaveReplacedUsagePolicySession(message: string): void {
  clearUsagePolicyExpiryTimer();
  usagePolicySession = null;
  stopLocalDraftAutosave();
  stopDevReloadObserver();
  if (project) {
    discardPendingProjectSave();
    advanceProjectSessionGeneration();
    if (workspaceMode === "short-form") {
      stopShortCanvasPlayback();
    }
    elements.preview_video.pause();
    stopPreviewAudioClock({ sync: false });
    cancelActiveJob();
  }
  showEditorPolicyGateError(
    `${message} 시작 화면에서 계속할 작업을 다시 선택해 주세요.`
  );
  window.setTimeout(() => {
    location.replace(new URL("/", location.origin).href);
  }, 0);
}

function handleUsagePolicyLeaseRefreshFailure(
  error: unknown,
  expected: ActiveUsagePolicySession
): void {
  if (usagePolicySession !== expected) {
    return;
  }
  if (error instanceof ReplacedUsagePolicyLeaseError) {
    leaveReplacedUsagePolicySession(error.message);
    return;
  }
  // Storage may be briefly unavailable while a page is frozen or restored.
  // Keep the in-memory lease and writer lock in that transient case only.
  console.warn("편집 세션 활성 상태를 이번 주기에 갱신하지 못했습니다.", error);
  scheduleUsagePolicyLeaseHeartbeat();
}

function scheduleUsagePolicyLeaseHeartbeat(): void {
  clearUsagePolicyExpiryTimer();
  const expected = usagePolicySession;
  if (!expected) {
    return;
  }
  usagePolicyExpiryTimer = window.setTimeout(() => {
    usagePolicyExpiryTimer = null;
    if (usagePolicySession !== expected) {
      return;
    }
    void refreshUsagePolicyLease(expected)
      .then((current) => {
        if (current) {
          scheduleUsagePolicyLeaseHeartbeat();
        }
      })
      .catch((error: unknown) => {
        handleUsagePolicyLeaseRefreshFailure(error, expected);
      });
  }, USAGE_POLICY_LEASE_HEARTBEAT_MS);
}

function showVerifiedEditorShell(session: ActiveUsagePolicySession): void {
  usagePolicySession = session;
  syncEditorUrlToUsagePolicySession(session);
  elements.usage_policy_status.textContent =
    `이번 사용 확인 · ${usagePolicyBasisLabel(session.basis)}`;
  elements.usage_policy_status.title =
    "사용자 진술을 기록한 상태이며 Kirinuki의 법률·권리 검증이나 게시 승인을 뜻하지 않습니다.";
  elements.editor_app_gate.hidden = true;
  elements.editor_mobile_gate.hidden = true;
  elements.editor_policy_gate.hidden = true;
  elements.editor_shell.inert = false;
  elements.editor_shell.hidden = false;
  if (project?.id && !localDraftAutosaveTimer) {
    startLocalDraftAutosave();
  }
  if (project?.id && devReloadEnabled() && !devReloadObserverActive) {
    startDevReloadObserver();
  }
  scheduleUsagePolicyLeaseHeartbeat();
}

function showEditorPolicyGateError(message: string): void {
  elements.editor_shell.inert = true;
  elements.editor_shell.hidden = true;
  elements.editor_app_gate.hidden = true;
  elements.editor_mobile_gate.hidden = true;
  elements.editor_policy_gate.hidden = false;
  elements.editor_policy_gate_status.textContent = message;
}

function showEditorMobileGate(): void {
  document.documentElement.dataset.editorAccess = "mobile-blocked";
  elements.editor_shell.inert = true;
  elements.editor_shell.hidden = true;
  elements.editor_app_gate.hidden = true;
  elements.editor_policy_gate.hidden = true;
  elements.editor_mobile_gate.hidden = false;
}

function showEditorAppGate(): void {
  document.documentElement.dataset.editorAccess = "app-required";
  elements.editor_shell.inert = true;
  elements.editor_shell.hidden = true;
  elements.editor_mobile_gate.hidden = true;
  elements.editor_policy_gate.hidden = true;
  elements.editor_app_gate.hidden = false;
}

async function verifyEditorUsagePolicyGate(): Promise<string> {
  const params = new URLSearchParams(location.search);
  const projectId = String(params.get("project") || "").trim();
  if (!projectId) {
    throw new Error(
      "직접 편집기 URL로는 시작할 수 없습니다. 시작 화면에서 이번 사용 정책을 입력해 주세요."
    );
  }
  const gateToken = params.get("usageGate") || "";
  if (params.has("usageGate")) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("usageGate");
    history.replaceState(null, "", cleanUrl.href);
  }
  const response: unknown = await verifyStudioUsagePolicyGate({
    projectId,
    gateToken
  });
  if (!isRecord(response) || response.ok !== true) {
    throw new Error(
      isRecord(response) && typeof response.error === "string"
        ? response.error
        : "이 탭에서 이번 사용 확인을 찾지 못했습니다. 저장 구간은 유지됩니다. 시작 화면에서 편집기를 다시 열어 주세요."
    );
  }
  const session = normalizeActiveUsagePolicySession(
    response.usagePolicy,
    projectId
  );
  showVerifiedEditorShell(session);
  return projectId;
}

function requireActiveUsagePolicySession(): ActiveUsagePolicySession {
  const session = usagePolicySession;
  const locationPurpose = usagePolicyPurposeFromLocation();
  // After the first seed has been committed, `session=resume` is a reload
  // transport marker. It does not change the user's already verified
  // editor-new attestation into a different editing action.
  const wrongPurpose = session && !(
    session.purpose === locationPurpose
    || (
      session.purpose === "editor-new"
      && locationPurpose === "editor-resume"
      && new URLSearchParams(location.search).get("recovery") === null
    )
  );
  if (
    !session
    || wrongPurpose
    || (project?.id && session.projectId !== project.id)
  ) {
    throw new Error(
      "편집기 정책 세션이 현재 프로젝트 또는 열기 목적과 일치하지 않습니다. 시작 화면에서 다시 입력해 주세요."
    );
  }
  return session;
}

function requireSameUsagePolicyLease(
  expected: ActiveUsagePolicySession
): ActiveUsagePolicySession {
  const current = requireActiveUsagePolicySession();
  if (
    current.projectId !== expected.projectId
    || current.sourceSessionId !== expected.sourceSessionId
    || current.sessionLeaseId !== expected.sessionLeaseId
    || current.transitionGeneration !== expected.transitionGeneration
  ) {
    throw new Error(
      "편집 작업을 시작한 탭과 현재 탭의 실행 상태가 달라 결과를 적용하지 않았습니다."
    );
  }
  return current;
}

function requireRecoveryUsagePolicySession(): ActiveUsagePolicySession {
  const session = requireActiveUsagePolicySession();
  if (session.purpose !== "editor-recovery") {
    throw new Error(
      "저장본을 불러오려면 시작 화면의 최근 편집에서 ‘저장본’을 선택하고 이번 사용 정책을 다시 입력해 주세요."
    );
  }
  return session;
}

function canRestoreLocalDraftWithCurrentPolicy(): boolean {
  return Boolean(
    usagePolicySession
    && usagePolicySession.purpose === "editor-recovery"
    && usagePolicySession.purpose === usagePolicyPurposeFromLocation()
  );
}

function shortcutTargetIds(
  binding: KeyboardShortcutBinding
): readonly string[] {
  return [binding.targetId, ...(binding.alternateTargetIds || [])];
}

function editorShortcutBindingForTarget(
  targetId: string
): KeyboardShortcutBinding | null {
  return EDITOR_SHORTCUT_BINDINGS.find(
    (binding) => shortcutTargetIds(binding).includes(targetId)
  ) || null;
}

function editorShortcutTitle(targetId: string, label: string): string {
  const binding = editorShortcutBindingForTarget(targetId);
  return binding
    ? formatKeyboardShortcutHint(label, binding.key)
    : label;
}

function usableEditorShortcutTarget(
  binding: KeyboardShortcutBinding
): EditorControl | null {
  for (const targetId of shortcutTargetIds(binding)) {
    const target = document.getElementById(targetId) as EditorControl | null;
    if (
      !target
      || target.closest("[hidden]")
      || target.getAttribute("aria-disabled") === "true"
      || target.disabled
    ) {
      continue;
    }
    return target;
  }
  return null;
}

function installEditorShortcutHints(): void {
  for (const binding of EDITOR_SHORTCUT_BINDINGS) {
    for (const targetId of shortcutTargetIds(binding)) {
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLElement)) {
        throw new Error(`편집기 단축키 대상이 없습니다: #${targetId}`);
      }
      target.title = formatKeyboardShortcutHint(binding.label, binding.key);
      target.setAttribute("aria-keyshortcuts", binding.key);
    }
  }
}

const captionInspectorTab = elements.cue_selected_tab;

// These lifecycle-bound values are initialized by boot() before UI handlers
// become reachable. The runtime sentinel remains null for the existing guards.
let project: EditorProject = null!;
type EditorWorkspaceMode = "main" | "short-form";
let workspaceMode: EditorWorkspaceMode = "main";
let rootProject: EditorProject = null!;
let mainWorkspaceUndoStack: EditorProject[] = [];
let mainWorkspaceRedoStack: EditorProject[] = [];
const shortWorkspaceHistory = new Map<string, {
  undo: EditorProject[];
  redo: EditorProject[];
}>();
let pendingShortWorkspaceUndoHistory: EditorProject[] | null = null;
let shortWorkspaceTransitionPending = false;
let shortPreviewAdaptiveScaler: AdaptiveVideoScaler | null = null;
let shortPreviewAdaptiveScalerUnavailable = false;
let shortPreviewFallbackSurface: OffscreenCanvas | null = null;
let shortPreviewDrawFrame: number | null = null;
const shortPreviewLayerVideos = new Map<string, ShortPreviewLayerVideoState>();
let shortPreviewAudioContext: AudioContext | null = null;
const shortPreviewAssetCaches = new Map<string, ShortPreviewAssetCacheState>();
const shortPreviewPacketCopyBlacklist = new Set<string>();
let shortPreviewCacheOperation: Promise<void> | null = null;
let shortPreviewCacheController: AbortController | null = null;
let shortPreviewCacheGeneration = 0;
let shortPreviewCacheProgressLabel = "";
let shortPreviewCacheError = "";
let shortPreviewCacheRepairScheduled = false;
let shortPreviewSourceAudioState: ShortPreviewSourceAudioState | null = null;
let shortPreviewSourceAudioTimer: TimerHandle | null = null;
let shortPreviewSourceAudioSequence = 0;
let shortCanvasPlaybackActive = false;
let shortCanvasPlaybackAnchorTimelineMs = 0;
let shortCanvasPlaybackAnchorPerformanceMs = 0;
let shortCanvasPlaybackFrame: number | null = null;
let shortCanvasLastUiUpdatePerformanceMs = 0;
let shortCanvasPlaybackGeneration = 0;
let shortCanvasPlaybackPriming = false;
let shortCanvasPlaybackPreparedSignature = "";
let shortCanvasPlaybackReprimeScheduled = false;
let usagePolicySession: ActiveUsagePolicySession | null = null;
let usagePolicyExpiryTimer: number | null = null;
let mediaFile: EditorMediaSource = null!;
let mediaHandle: FileSystemFileHandle | null = null;
let mediaUrl: string | null = null;
let vodMediaEngineToken = "";
let sourceBindingConnected = false;
let pixelsPerSecond = 70;
let timelineSnapEnabled = true;
let saveDispatchPending = false;
let pendingSaveSnapshot: EditorProject | null = null;
let projectSaveSequence = 0;
let projectMutationRevision = 0;
let lastLocalDraftMutationRevision = 0;
let currentProjectSavePendingCount = 0;
let lastCurrentProjectSavedAtMs = 0;
let currentProjectSaveFailed = false;
let knownLocalDraftCount = 0;
const projectWriteQueue = createGenerationBoundSerialOperationQueue();
let imageAssetPruneTimer: TimerHandle | null = null;
let toastTimer: TimerHandle | null = null;
let activeClipId: string | null = null;
let undoStack: EditorProject[] = [];
let redoStack: EditorProject[] = [];
let activeJobController: AbortController | null = null;
let initialVodAutoPrepareAttempted = false;
let pointerEditActive = false;
let pointerEditPreservePreviewClock = false;
let inspectorMode = "selected";
let fieldEditSession: FieldEditSession | null = null;
let focusBeforeJob: HTMLElement | null = null;
let focusBeforeCaptionSheetDialog: HTMLElement | null = null;
let focusBeforeSubtitleSyncGuide: HTMLElement | null = null;
let projectMutationLockCount = 0;
let exportRequestPending = false;
let pendingExportOptionsKind: ExportKind | null = null;
let focusBeforeExportOptions: HTMLElement | null = null;
let pendingExportOptionsProjectFingerprint = "";
let pendingExportCleanupResolve: ((shouldDelete: boolean) => void) | null = null;
let editorSessionCompleted = false;
let editingSessionCheckpointId = "";
let editingSessionCheckpointActive = false;
let editingSessionExitInProgress = false;
let focusBeforeEditingSessionExit: HTMLElement | null = null;
let activeJobCancelable = false;
let previewSeekSequence = 0;
let pendingPreviewSeek: PendingPreviewSeek | null = null;
let propertyInspectorMode = "caption";
let timelineCollapsed = false;
let previewVolume = 1;
let previewMuted = false;
let timelineContext: TimelineContextState | null = null;
let rangeStartMs: number | null = null;
let rangeEndMs: number | null = null;
let timelineRangePurpose: TimelineRangePurpose = "delete";
let rangeHandleDragActive = false;
let shortSourceComposerActive = false;
let shortSourceComposerCollapsed = false;
let shortSourceBoundaryPreviewInFlight = false;
let shortSourceAspect: ShortSourceAspect = "free";
let shortSourceCropDraft: ShortSourceCropDraft | null = null;
let shortSourceCropGesture: ShortSourceCropGesture | null = null;
let shortWorkspaceTransformGesture: ShortWorkspaceTransformGesture | null = null;
let pendingShortVideoAssetTimelineMs: number | null = null;
let shortSourcePickerReturnState: ShortSourcePickerReturnState | null = null;
let liveTimelineGeometryFrame: number | null = null;
let previewAudioClockTimer: TimerHandle | null = null;
let previewPlaybackFrame: number | null = null;
let standbyPreviewVideo: HTMLVideoElement | null = null;
let previewPreloadSequence = 0;
let preparedPreview: PreparedPreviewState | null = null;
let previewBoundaryTransitioning = false;
let pendingAssetTimelineMs: number | null = null;
let imageAssetRenderSequence = 0;
let suppressedTimedBlockClick: string | null = null;
let suppressedTimedBlockClickTimer: TimerHandle | null = null;
let localDraftAutosaveTimer: TimerHandle | null = null;
let localDraftOperationQueue: Promise<unknown> = Promise.resolve();
let localDraftOperationActive = false;
let automaticLocalDraftOperation: Promise<unknown> | null = null;
let lastAutomaticDraftAtMs = 0;
let localDraftAutosaveAnchorAtMs = 0;
let focusBeforeLocalDraftDialog: HTMLElement | null = null;
let captionAgentSettings: CaptionAgentSettings = {
  ...DEFAULT_CAPTION_AGENT_SETTINGS
};
let captionAgentRuntime: CaptionAgentRuntime | null = null;
type WhisperConnectionState =
  | "disconnected"
  | "picking"
  | "validating"
  | "ready"
  | "error";
let whisperConnectionState: WhisperConnectionState = "disconnected";
let whisperConnectionMessage = "";
let connectedWhisperModelId = "";
interface WhisperConnectionSnapshot {
  runtime: CaptionAgentRuntime | null;
  settings: CaptionAgentSettings;
  modelId: string;
  token: string;
  state: WhisperConnectionState;
  message: string;
}
let activeChzzkVodJob: {
  jobId: string;
  endpoint: string;
  token: string;
} | null = null;
let pendingVodHotLoadBatch: PendingVodHotLoadBatch | null = null;
let inFlightVodHotLoadBatch: PendingVodHotLoadBatch | null = null;
let activeVodHotLoadDrain: Promise<void> | null = null;
let latestVodHotLoadSequence = 0;
let vodHotLoadQueueCancelRequested = false;
const latestVodHotLoadTrimSequence = new Map<string, number>();
let devReloadPollTimer: TimerHandle | null = null;
let devReloadProcessing = false;
let devReloadObserverActive = false;
let devReloadMissingCount = 0;
let devReloadNotice = "";
const imageAssetObjectUrls = new Map<string, {
  sourceKey: string;
  url: string;
}>();
const clipGroupSelection = new Set<string>();

const EXPORT_LOCK_NAME = "chzzk-kirinuki-export";
type ExportKind = "main" | "short-form";
const SESSION_CLEANUP_SCHEMA = "kirinuki-session-cleanup/v1";
type SessionCleanupStage = "purge-intent" | "vod-purged";
interface SessionCleanupMarker {
  schema: typeof SESSION_CLEANUP_SCHEMA;
  stage: SessionCleanupStage;
  projectId: string;
  requestedAt: string;
  updatedAt: string;
  mediaUrl: string;
  platform: string;
  contentId: string;
  sourceVersionId: string;
  materializationId: string;
  planFingerprint: string;
  releasedBytes: number;
}
let startupCleanupRecoveryNotice = "";
let startupCompletedSessionCleanup: {
  browser: ProjectSessionDeletionCounts;
  releasedBytes: number;
} | null = null;
const MAX_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_ASSET_DIMENSION = 8192;
const MAX_IMAGE_ASSET_PIXELS = 40_000_000;
const ASSET_TRACK_BASE_HEIGHT_PX = 54;
const ASSET_SUBROW_STRIDE_PX = 47;
const ASSET_BLOCK_TOP_PX = 7;
const SHORT_VIDEO_TRACK_BASE_HEIGHT_PX = 58;
const SHORT_VIDEO_SUBROW_STRIDE_PX = 47;
const SHORT_VIDEO_BLOCK_TOP_PX = 7;
const MIN_TIMELINE_RANGE_MS = 100;
const TIMELINE_SNAP_THRESHOLD_PX = 8;
const TIMED_BLOCK_DRAG_ACTIVATION_PX = 4;
const PREVIEW_AUDIO_CLOCK_INTERVAL_MS = 10;
const PREVIEW_PRELOAD_TIMEOUT_MS = 12_000;
const SHORT_PREVIEW_LAYER_PAUSED_DRIFT_SECONDS = 0.02;
const SHORT_PREVIEW_LAYER_PLAYING_RESYNC_SECONDS = 0.3;
const SHORT_PREVIEW_SOURCE_AUDIO_PAUSED_DRIFT_SECONDS = 0.02;
const SHORT_PREVIEW_SOURCE_AUDIO_AUDIBLE_DRIFT_SECONDS = 0.08;
const SHORT_PREVIEW_PRIMING_SETTLE_SECONDS = 0.05;
const SHORT_PREVIEW_PRIMING_TIMEOUT_MS = 8_000;
const SHORT_PREVIEW_PLAYBACK_START_GRACE_MS = 750;
const VOD_HOT_LOAD_CHUNK_MS = 30_000;
const LOCAL_DRAFT_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1_000;
const LOCAL_DRAFT_BUSY_RETRY_MS = 30 * 1_000;
const DEV_RELOAD_POLL_INTERVAL_MS = 900;
const DEV_RELOAD_FETCH_FAILURE_LIMIT = 3;
const DEV_RELOAD_LAST_REVISION_KEY = "kirinuki:dev-reload:last-revision";
const DEV_RELOAD_EXPECTED_PROJECT_KEY = "kirinuki:dev-reload:expected-project";
// Keep the preserved legacy navigation bridge fail-closed and release its
// mutation lock before the calling runtime gives up.
const ALLOWED_IMAGE_ASSET_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);
const cloneProject = <T>(value: T): T => structuredClone(value);

function formatTime(milliseconds: number, { compact = false } = {}) {
  const value = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  if (compact && hours === 0) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function parseTime(value: string) {
  const input = String(value || "").trim();
  if (!input) {
    return null;
  }
  if (/^\d+(?:\.\d+)?$/.test(input)) {
    return Math.round(Number(input) * 1000);
  }
  const parts = input.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite) || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    return null;
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}초`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}분 ${remainder}초`;
}

function projectSourcePlatformLabel(
  candidateProject: EditorProject = project
): string {
  return sourcePlatformLabel(
    String(candidateProject.source?.platform || SOURCE_PLATFORM_CHZZK)
      .trim()
      .toUpperCase()
  );
}

function chzzkVodContentId(
  candidateProject: EditorProject = project
): string {
  const explicit = String(candidateProject.source?.contentId || "").trim();
  if (/^[A-Za-z0-9_-]{1,128}$/u.test(explicit)) {
    return explicit;
  }
  const rawUrl = String(
    candidateProject.source?.canonicalUrl || candidateProject.source?.url || ""
  ).trim();
  try {
    return inferSourceIdentifiers(rawUrl).contentId;
  } catch {
    return "";
  }
}

function projectUsesChzzkMaterializedMedia(
  candidateProject: EditorProject = project
): boolean {
  return (
    candidateProject.mediaAsset?.mediaMode === "source-vod-selection"
    || candidateProject.mediaAsset?.mediaMode === "chzzk-vod-selection"
  );
}

function projectMaterialization(
  candidateProject: EditorProject = project
): ChzzkVodMaterialization | null {
  const materialization = normalizeChzzkVodMaterialization(
    candidateProject?.mediaAsset?.materialization
  );
  if (!materialization) {
    return null;
  }
  const sourcePlatform = String(candidateProject.source?.platform || "CHZZK")
    .trim()
    .toUpperCase();
  const sourceType = String(candidateProject.source?.contentType || "")
    .trim()
    .toLowerCase();
  const contentId = chzzkVodContentId(candidateProject);
  return (
    materialization.source.platform === sourcePlatform
    && sourceType === "vod"
    && contentId === materialization.source.contentId
    && materialization.handleMs === 10_000
  )
    ? materialization
    : null;
}

function clipForMediaEngine(
  clip: EditorClip,
  candidateProject: EditorProject = project
): EditorClip {
  const materialization = projectMaterialization(candidateProject);
  if (!materialization) {
    if (projectUsesChzzkMaterializedMedia(candidateProject)) {
      throw new Error(
        "이 프로젝트의 로컬 편집 영상 매핑이 유효하지 않습니다. 편집 영상을 다시 준비해 주세요."
      );
    }
    return clip;
  }
  const mapped = materializeEditorClipWithinEditableBounds(
    clip,
    materialization
  );
  if (!mapped) {
    throw new Error(
      "이 컷이 준비된 VOD 편집 범위 밖에 있습니다. 선택 구간을 다시 준비해 주세요."
    );
  }
  return mapped;
}

type ShortFormSourceBackedAsset = ShortFormVideoAsset | ShortFormSourceAudioAsset;

type VodSourceAnchor = {
  startMs: number;
  endMs: number;
};

function vodSourceAnchorForShortAsset(
  asset: ShortFormSourceBackedAsset,
  sourceClockProject: EditorProject,
  sourceClockRootProject: EditorProject = sourceClockProject
): VodSourceAnchor {
  const projects = sourceClockRootProject === sourceClockProject
    ? [sourceClockProject]
    : [sourceClockRootProject, sourceClockProject];
  for (const candidate of projects) {
    const anchors = candidate.clips
      .filter((clip) => (
        clip.shortFormCanvasClock !== true
        && vodSourceClipId(clip) === asset.sourceClipId
      ))
      .map((clip) => ({
        startMs: Number(
          clip.shortFormSelectionStartMs ?? clip.selectionStartMs
        ),
        endMs: Number(
          clip.shortFormSelectionEndMs ?? clip.selectionEndMs
        )
      }));
    const anchor = anchors[0];
    if (!anchor) {
      continue;
    }
    if (
      !Number.isSafeInteger(anchor.startMs)
      || !Number.isSafeInteger(anchor.endMs)
      || anchor.startMs < 0
      || anchor.endMs - anchor.startMs < SHORT_FORM_MIN_CLIP_DURATION_MS
      || anchors.some((candidateAnchor) => (
        candidateAnchor.startMs !== anchor.startMs
        || candidateAnchor.endMs !== anchor.endMs
      ))
    ) {
      throw new Error(
        `같은 본편에서 가져온 영상의 원본 선택 기준이 서로 다릅니다: ${asset.sourceClipId}`
      );
    }
    return anchor;
  }

  const materialization = projectMaterialization(sourceClockProject)
    || projectMaterialization(sourceClockRootProject);
  const persistedAnchors = materialization?.clipRanges?.filter((range) => (
    range.clipId === asset.sourceClipId
  )) || [];
  if (persistedAnchors.length === 1) {
    return {
      startMs: persistedAnchors[0]!.sourceStartMs,
      endMs: persistedAnchors[0]!.sourceEndMs
    };
  }
  if (persistedAnchors.length > 1) {
    throw new Error(
      `이 기기에 저장된 범위에 같은 원본 선택 기준이 중복돼 있습니다: ${asset.sourceClipId}`
    );
  }
  // The active workspace branch is authoritative. A parked root branch may
  // still contain the just-deleted video until persistence is synchronized.
  const orphanLineageAssets = [
    asset,
    ...(sourceClockProject.shortForm?.videoAssets || []),
    ...(sourceClockProject.shortForm?.sourceAudioAssets || [])
  ].filter((candidate) => candidate.sourceClipId === asset.sourceClipId);
  const startMs = Math.min(
    ...orphanLineageAssets.map((candidate) => candidate.sourceSelectionStartMs)
  );
  const endMs = Math.max(
    ...orphanLineageAssets.map((candidate) => candidate.sourceSelectionEndMs)
  );
  if (
    !Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(endMs)
    || startMs < 0
    || endMs - startMs < SHORT_FORM_MIN_CLIP_DURATION_MS
  ) {
    throw new Error(
      `쇼츠의 원본 선택 기준이 올바르지 않습니다: ${asset.sourceClipId}`
    );
  }
  return { startMs, endMs };
}

function shortFormSourceAssetVirtualClip(
  asset: ShortFormSourceBackedAsset,
  sourceAnchor: VodSourceAnchor = {
    startMs: asset.sourceSelectionStartMs,
    endMs: asset.sourceSelectionEndMs
  }
): EditorClip {
  return {
    id: `short-source-asset-${asset.id}`,
    selectionId: asset.sourceClipId,
    sourceStartMs: asset.sourceStartMs,
    sourceEndMs: asset.sourceEndMs,
    selectionStartMs: sourceAnchor.startMs,
    selectionEndMs: sourceAnchor.endMs,
    timelineStartMs: asset.timelineStartMs,
    enabled: true,
    shortFormSourceClipId: asset.sourceClipId,
    shortFormSourceSelectionId: asset.sourceClipId,
    shortFormSelectionStartMs: sourceAnchor.startMs,
    shortFormSelectionEndMs: sourceAnchor.endMs
  };
}

function shortFormSourceAssetForMediaEngine<T extends ShortFormSourceBackedAsset>(
  asset: T,
  materialization: ChzzkVodMaterialization,
  sourceClockProject: EditorProject,
  sourceClockRootProject: EditorProject = sourceClockProject
): T {
  const virtualClip = shortFormSourceAssetVirtualClip(
    asset,
    vodSourceAnchorForShortAsset(
      asset,
      sourceClockProject,
      sourceClockRootProject
    )
  );
  const mapped = materializeEditorClipWithinEditableBounds(
    virtualClip,
    materialization
  );
  if (!mapped) {
    throw new Error(
      "쇼츠 영상과 음성이 준비된 VOD 편집 범위 밖에 있습니다. 이 구간의 편집 영상을 다시 준비해 주세요."
    );
  }
  return {
    ...asset,
    // Export only needs the active source range. Keeping the broader logical
    // trim bounds here would mix absolute VOD time with compact-media time.
    sourceSelectionStartMs: mapped.sourceStartMs,
    sourceSelectionEndMs: mapped.sourceEndMs,
    sourceStartMs: mapped.sourceStartMs,
    sourceEndMs: mapped.sourceEndMs
  };
}

function projectForMediaEngine(
  candidateProject: EditorProject = project
): EditorProject {
  const materialization = projectMaterialization(candidateProject);
  if (!materialization) {
    if (projectUsesChzzkMaterializedMedia(candidateProject)) {
      throw new Error(
        "이 프로젝트의 로컬 편집 영상 매핑이 유효하지 않습니다. 편집 영상을 다시 준비해 주세요."
      );
    }
    return candidateProject;
  }
  return {
    ...candidateProject,
    clips: candidateProject.clips.map((clip) => (
      clip.enabled === false || clip.shortFormCanvasClock === true
        ? clip
        : clipForMediaEngine(clip, candidateProject)
    )),
    ...(candidateProject.shortForm
      ? {
        shortForm: {
          ...candidateProject.shortForm,
          videoAssets: candidateProject.shortForm.videoAssets.map((asset) => (
            shortFormSourceAssetForMediaEngine(
              asset,
              materialization,
              candidateProject,
              workspaceMode === "short-form" ? rootProject : candidateProject
            )
          )),
          sourceAudioAssets: candidateProject.shortForm.sourceAudioAssets.map((asset) => (
            shortFormSourceAssetForMediaEngine(
              asset,
              materialization,
              candidateProject,
              workspaceMode === "short-form" ? rootProject : candidateProject
            )
          ))
        }
      }
      : {})
  };
}

function clipOutsideMedia(candidateProject = project) {
  const baseClips = [
    ...(candidateProject.clips || [])
  ].filter((clip) => clip.shortFormCanvasClock !== true);
  const shortSourceAssets: ShortFormSourceBackedAsset[] = [
    ...(candidateProject.shortForm?.videoAssets || []),
    ...(candidateProject.shortForm?.sourceAudioAssets || [])
  ];
  const materialization = projectMaterialization(candidateProject);
  if (materialization) {
    const outsideClip = baseClips.find((clip) => (
      clip.enabled !== false
      && !materializeEditorClipWithinEditableBounds(clip, materialization)
    ));
    if (outsideClip) {
      return outsideClip;
    }
    const sourceClockRootProject = workspaceMode === "short-form"
      ? rootProject
      : candidateProject;
    return shortSourceAssets.find((asset) => !materializeEditorClipWithinEditableBounds(
      shortFormSourceAssetVirtualClip(
        asset,
        vodSourceAnchorForShortAsset(
          asset,
          candidateProject,
          sourceClockRootProject
        )
      ),
      materialization
    )) || null;
  }
  if (projectUsesChzzkMaterializedMedia(candidateProject)) {
    return baseClips.find((clip) => clip.enabled !== false)
      || shortSourceAssets[0]
      || null;
  }
  const durationMs = Number(candidateProject?.mediaAsset?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const outsideClip = baseClips.find((clip) => (
    clip.enabled !== false &&
    (clip.sourceStartMs < 0 || clip.sourceEndMs > durationMs)
  ));
  return outsideClip || shortSourceAssets.find((asset) => (
    asset.sourceStartMs < 0 || asset.sourceEndMs > durationMs
  )) || null;
}

function materializedMediaBindingIsValid(
  candidateProject: EditorProject = project
) {
  return (
    !projectUsesChzzkMaterializedMedia(candidateProject)
    || (
      Boolean(projectMaterialization(candidateProject))
      && !clipOutsideMedia(candidateProject)
    )
  );
}

function sanitizeFileName(value: string) {
  let cleaned = String(value || "kirinuki")
    .normalize("NFKC")
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/gu, "")
    .slice(0, 80)
    .replace(/[.\s]+$/gu, "");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:[.\s]|$)/iu.test(cleaned)) {
    cleaned = `safe-${cleaned.slice(0, 75).replace(/[.\s]+$/gu, "")}`;
  }
  return cleaned || "kirinuki";
}

function showToast(message: string, type = "info", timeout = 3600) {
  clearTimeout(toastTimer ?? undefined);
  toastTimer = null;
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.setAttribute("role", type === "error" ? "alert" : "status");
  elements.toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  elements.toast.hidden = false;
  if (timeout > 0) {
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
      toastTimer = null;
    }, timeout);
  }
}

function advanceProjectSessionGeneration(): number {
  return projectWriteQueue.advanceGeneration();
}

function queueCurrentProjectSessionWrite<T>(
  operation: () => Promise<T>
): Promise<T> {
  // Keep every durable project mutation in UI order. Advancing the session
  // generation rejects work that was queued by the replaced project while
  // still allowing already-running writes to drain before the replacement.
  return projectWriteQueue.enqueue(operation);
}

function startProjectSnapshotSave(snapshot: EditorProject) {
  const sequence = ++projectSaveSequence;
  currentProjectSavePendingCount += 1;
  currentProjectSaveFailed = false;
  renderLocalPersistenceStatus();
  const operation = queueCurrentProjectSessionWrite(async () => {
    const savedProject = await saveProject(snapshot);
    scheduleImageAssetBlobPrune();
    return savedProject;
  });
  void operation.then(() => {
    currentProjectSavePendingCount = Math.max(
      0,
      currentProjectSavePendingCount - 1
    );
    lastCurrentProjectSavedAtMs = Date.now();
    currentProjectSaveFailed = false;
    renderLocalPersistenceStatus();
  }).catch(() => {
    currentProjectSavePendingCount = Math.max(
      0,
      currentProjectSavePendingCount - 1
    );
    currentProjectSaveFailed = true;
    renderLocalPersistenceStatus();
  });
  void operation.catch((error) => {
    if (
      sequence === projectSaveSequence
      && !(error instanceof StaleSerialOperationGenerationError)
    ) {
      showToast(`프로젝트 저장 실패: ${errorMessage(error)}`, "error", 0);
    }
  });
  return operation;
}

function syncRootProjectFromActiveWorkspace(): EditorProject {
  if (workspaceMode === "main") {
    rootProject = cloneProject(project);
    return rootProject;
  }
  if (!rootProject) {
    throw new Error("쇼츠가 연결된 본편 프로젝트를 찾지 못했습니다.");
  }
  const shortForm = shortFormBranchFromWorkspace({
    ...rootProject,
    shortForm: project.shortForm
  }, project);
  const shortFormWorkspaces = saveActiveShortFormWorkspace(
    rootProject.shortFormWorkspaces,
    rootProject.shortForm,
    shortForm,
    rootProject.clips
  );
  rootProject = {
    ...rootProject,
    source: { ...project.source },
    broadcastSession: { ...project.broadcastSession },
    mediaAsset: project.mediaAsset ? { ...project.mediaAsset } : null,
    shortForm,
    shortFormWorkspaces,
    updatedAt: new Date().toISOString()
  };
  // The active workspace keeps the canonical framing branch so preview and
  // export use the exact same immutable snapshot as persistence.
  project = {
    ...project,
    shortForm,
    shortFormWorkspaces
  };
  return rootProject;
}

function persistedProjectSnapshot(): EditorProject {
  return cloneProject(syncRootProjectFromActiveWorkspace());
}

function persistedProjectSnapshotForWorkspaceCandidate(
  candidateProject: EditorProject,
  parentProject: EditorProject = rootProject
): EditorProject {
  if (workspaceMode === "main") {
    return cloneProject(candidateProject);
  }
  if (!parentProject) {
    throw new Error("쇼츠가 연결된 본편 프로젝트를 찾지 못했습니다.");
  }
  const shortForm = shortFormBranchFromWorkspace({
    ...parentProject,
    shortForm: candidateProject.shortForm
  }, candidateProject);
  const shortFormWorkspaces = saveActiveShortFormWorkspace(
    parentProject.shortFormWorkspaces,
    parentProject.shortForm,
    shortForm,
    parentProject.clips
  );
  return cloneProject({
    ...parentProject,
    source: { ...candidateProject.source },
    broadcastSession: { ...candidateProject.broadcastSession },
    mediaAsset: candidateProject.mediaAsset
      ? { ...candidateProject.mediaAsset }
      : null,
    shortForm,
    shortFormWorkspaces,
    updatedAt: new Date().toISOString()
  });
}

async function saveActiveWorkspaceImmediately(
  candidateProject?: EditorProject,
  parentProject?: EditorProject
): Promise<EditorProject> {
  projectMutationRevision += 1;
  const snapshot = candidateProject
    ? persistedProjectSnapshotForWorkspaceCandidate(
      candidateProject,
      parentProject
    )
    : persistedProjectSnapshot();
  await queueCurrentProjectSessionWrite(() => saveProject(snapshot));
  return snapshot;
}

function discardPendingProjectSave() {
  pendingSaveSnapshot = null;
  saveDispatchPending = false;
}

function dispatchPendingProjectSave() {
  saveDispatchPending = false;
  const snapshot = pendingSaveSnapshot;
  pendingSaveSnapshot = null;
  if (snapshot) {
    startProjectSnapshotSave(snapshot);
  }
}

function scheduleSave() {
  if (!project || editorSessionCompleted || editingSessionExitInProgress) {
    return;
  }
  try {
    requireActiveUsagePolicySession();
  } catch {
    return;
  }
  projectMutationRevision += 1;
  pendingSaveSnapshot = persistedProjectSnapshot();
  if (saveDispatchPending) {
    return;
  }
  saveDispatchPending = true;
  // A microtask runs after the current mutation event and before the next user
  // event (including a tab-close event). Every immutable snapshot therefore
  // creates its IndexedDB readwrite transaction in mutation order without
  // blocking rendering on disk I/O.
  queueMicrotask(dispatchPendingProjectSave);
}

function flushSave() {
  if (!project || editorSessionCompleted) {
    return Promise.resolve();
  }
  const snapshot = persistedProjectSnapshot();
  discardPendingProjectSave();
  return startProjectSnapshotSave(snapshot);
}

async function waitForProjectSaves() {
  await projectWriteQueue.waitForIdle();
}

const localDraftDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

const localSaveTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function renderLocalPersistenceStatus(): void {
  if (!elements?.local_draft_status) {
    return;
  }
  const state = currentProjectSaveFailed
    ? "error"
    : currentProjectSavePendingCount > 0
      ? "saving"
      : lastCurrentProjectSavedAtMs > 0
        ? "saved"
        : "ready";
  elements.local_draft_status.dataset.state = state;
  const current = state === "error"
    ? "편집 중 임시 복구 실패"
    : state === "saving"
      ? "편집 중 임시 복구 중…"
      : state === "saved"
        ? `편집 중 임시 복구됨 ${localSaveTimeFormatter.format(lastCurrentProjectSavedAtMs)}`
        : "편집 중 임시 복구 준비됨";
  const lastAutoText = lastAutomaticDraftAtMs > 0
    ? ` · 최근 5분 복구 ${localDraftDateFormatter.format(lastAutomaticDraftAtMs)}`
    : "";
  elements.local_draft_status.textContent = (
    `${current} · 현재 복구본 ${Math.min(5, knownLocalDraftCount)}/5 · 5분 간격 · 탭 종료 시 임시본 폐기${lastAutoText}`
  );
}

function localDraftReasonLabel(reason: "manual" | "auto" | "pre-restore") {
  return {
    manual: "직접 저장",
    auto: "편집 중 복구",
    "pre-restore": "불러오기 전 복구"
  }[reason] || "저장";
}

function setLocalDraftOperationActive(active: boolean) {
  localDraftOperationActive = Boolean(active);
  elements.create_local_draft.disabled = localDraftOperationActive;
  elements.open_local_drafts.disabled = localDraftOperationActive;
  elements.reset_ai_caption_positions.disabled = localDraftOperationActive;
  elements.close_local_draft_dialog.disabled = localDraftOperationActive;
  const selectedDraft = elements.local_draft_list.querySelector(
    'input[name="local-draft-choice"]:checked'
  );
  elements.restore_local_draft.disabled = (
    localDraftOperationActive
    || !selectedDraft
    || !canRestoreLocalDraftWithCurrentPolicy()
  );
  for (const input of elements.local_draft_list.querySelectorAll("input")) {
    input.disabled = localDraftOperationActive;
  }
}

function queueLocalDraftOperation<T>(operation: () => T | PromiseLike<T>): Promise<T> {
  const queued = localDraftOperationQueue
    .catch(() => undefined)
    .then(async () => {
      setLocalDraftOperationActive(true);
      try {
        return await operation();
      } finally {
        setLocalDraftOperationActive(false);
      }
    });
  localDraftOperationQueue = queued.catch(() => undefined);
  return queued;
}

function localDraftSummary(draft: LocalDraftRecord) {
  const snapshot = draft.project;
  return [
    `컷 ${Array.isArray(snapshot.clips) ? snapshot.clips.length : 0}`,
    `자막 ${Array.isArray(snapshot.subtitles) ? snapshot.subtitles.length : 0}`,
    `이미지 ${Array.isArray(snapshot.imageAssets) ? snapshot.imageAssets.length : 0}`,
    `음성 ${Array.isArray(snapshot.audioRegions) ? snapshot.audioRegions.length : 0}`
  ].join(" · ");
}

function updateLocalDraftStatus(drafts: LocalDraftRecord[] = []) {
  const count = Math.min(5, drafts.length);
  knownLocalDraftCount = count;
  renderLocalPersistenceStatus();
  elements.open_local_drafts.title = editorShortcutTitle(
    "open-local-drafts",
    `저장·복구본 ${count}개 불러오기`
  );
}

function renderLocalDraftList(
  drafts: LocalDraftRecord[],
  selectedId = ""
) {
  const fragment = document.createDocumentFragment();
  for (const draft of drafts) {
    const label = document.createElement("label");
    label.className = "local-draft-item";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "local-draft-choice";
    input.value = draft.id;
    input.checked = draft.id === selectedId;
    input.disabled = localDraftOperationActive;
    input.addEventListener("change", () => {
      elements.restore_local_draft.disabled = (
        localDraftOperationActive
        || !canRestoreLocalDraftWithCurrentPolicy()
      );
    });

    const copy = document.createElement("span");
    copy.className = "local-draft-item-copy";

    const heading = document.createElement("span");
    heading.className = "local-draft-item-heading";

    const reason = document.createElement("span");
    reason.className = `local-draft-reason ${draft.reason || "manual"}`;
    reason.textContent = localDraftReasonLabel(draft.reason);

    const time = document.createElement("time");
    time.dateTime = draft.createdAt;
    time.textContent = localDraftDateFormatter.format(
      new Date(draft.createdAtMs || draft.createdAt)
    );
    heading.append(time, reason);

    const summary = document.createElement("span");
    summary.className = "local-draft-item-meta";
    summary.textContent = localDraftSummary(draft);

    copy.append(heading, summary);
    label.append(input, copy);
    fragment.append(label);
  }
  elements.local_draft_list.replaceChildren(fragment);
  elements.local_draft_empty.hidden = drafts.length > 0;
  elements.restore_local_draft.disabled = (
    localDraftOperationActive ||
    !canRestoreLocalDraftWithCurrentPolicy() ||
    !elements.local_draft_list.querySelector(
      'input[name="local-draft-choice"]:checked'
    )
  );
  updateLocalDraftStatus(drafts);
}

async function refreshLocalDraftList({ preserveSelection = true } = {}) {
  const selectedId = preserveSelection
    ? (elements.local_draft_list.querySelector(
      'input[name="local-draft-choice"]:checked'
    ) as EditorControl)?.value || ""
    : "";
  const drafts = await listLocalDrafts(project.id, { limit: 5 });
  renderLocalDraftList(drafts, selectedId);
  return drafts;
}

async function saveCurrentLocalDraft(reason: LocalDraftReason, {
  restoredFromDraftId = null,
  announce = false
}: {
  restoredFromDraftId?: string | null;
  announce?: boolean;
} = {}) {
  requireActiveUsagePolicySession();
  if (!project?.id) {
    throw new Error("저장할 편집 작업이 없습니다.");
  }
  if (reason !== "auto") {
    fieldEditSession = null;
  }
  discardPendingProjectSave();
  const snapshotRevision = projectMutationRevision;
  const snapshot = persistedProjectSnapshot();
  const draft = await queueCurrentProjectSessionWrite(() => saveLocalDraft(snapshot, {
    reason,
    restoredFromDraftId,
    now: Date.now(),
    id: crypto.randomUUID()
  }));
  lastLocalDraftMutationRevision = Math.max(
    lastLocalDraftMutationRevision,
    snapshotRevision
  );
  if (reason === "auto") {
    lastAutomaticDraftAtMs = draft.createdAtMs;
    localDraftAutosaveAnchorAtMs = draft.createdAtMs;
  }
  scheduleImageAssetBlobPrune();
  if (elements.local_draft_dialog.open) {
    await refreshLocalDraftList();
  } else {
    const drafts = await listLocalDrafts(project.id, { limit: 5 });
    updateLocalDraftStatus(drafts);
  }
  if (announce) {
    showToast("현재 상태를 이 기기에 저장했습니다.", "success");
  }
  return draft;
}

function createManualLocalDraft() {
  void queueLocalDraftOperation(() => (
    saveCurrentLocalDraft("manual", { announce: true })
  )).catch((error) => {
    showToast(`저장 실패: ${errorMessage(error)}`, "error", 0);
  });
}

async function resetAllAiCaptionPositions() {
  if (
    projectMutationLockCount > 0
    || pointerEditActive
    || rangeHandleDragActive
    || activeJobController
  ) {
    throw new Error("진행 중인 편집 작업이 끝난 뒤 다시 눌러 주세요.");
  }
  if (await countSameProjectEditorTabs() > 1) {
    throw new Error(
      "같은 프로젝트 편집기 탭이 둘 이상 열려 있습니다. 다른 탭을 닫고 다시 눌러 주세요."
    );
  }
  const before = cloneProject(project);
  const next = resetAiSubtitlePositions(project, {
    includeHumanEdited: true
  });
  if (next === project) {
    showToast("모든 자동 생성 자막이 이미 기본 위치에 있습니다.", "info");
    return 0;
  }
  const beforeById = new Map(
    before.subtitles.map((cue) => [cue.id, cue])
  );
  const changedCount = next.subtitles.filter((cue) => {
    const previous = beforeById.get(cue.id);
    return (
      previous
      && (
        previous.x !== cue.x
        || previous.y !== cue.y
        || previous.remoteMeta?.placement
          !== cue.remoteMeta?.placement
      )
    );
  }).length;

  lockProjectMutations();
  try {
    await saveCurrentLocalDraft("manual");
    applyProject(next);
    await flushSave();
    showToast(
      `자동 생성 자막 ${changedCount}개의 화면 위치를 아래 중앙 기본값으로 맞췄습니다.`,
      "success",
      6000
    );
    return changedCount;
  } finally {
    unlockProjectMutations();
  }
}

function localDraftAutosaveBlocked() {
  return (
    !project ||
    editorSessionCompleted ||
    pointerEditActive ||
    rangeHandleDragActive ||
    projectMutationLockCount > 0 ||
    Boolean(activeJobController) ||
    !elements.job_dialog.hidden ||
    elements.local_draft_dialog.open ||
    localDraftOperationActive
  );
}

function scheduleLocalDraftAutosave(delayMs = LOCAL_DRAFT_AUTOSAVE_INTERVAL_MS) {
  if (editorSessionCompleted) {
    return;
  }
  clearTimeout(localDraftAutosaveTimer ?? undefined);
  localDraftAutosaveTimer = setTimeout(() => {
    localDraftAutosaveTimer = null;
    void runAutomaticLocalDraft();
  }, Math.max(0, delayMs));
}

function runAutomaticLocalDraft() {
  if (automaticLocalDraftOperation) {
    return automaticLocalDraftOperation;
  }
  if (localDraftAutosaveBlocked()) {
    scheduleLocalDraftAutosave(LOCAL_DRAFT_BUSY_RETRY_MS);
    return Promise.resolve(null);
  }
  if (projectMutationRevision === lastLocalDraftMutationRevision) {
    localDraftAutosaveAnchorAtMs = Date.now();
    scheduleLocalDraftAutosave();
    renderLocalPersistenceStatus();
    return Promise.resolve(null);
  }
  automaticLocalDraftOperation = queueLocalDraftOperation(
    () => saveCurrentLocalDraft("auto")
  )
    .catch((error) => {
      console.warn("5분 간격의 편집 중 임시 복구에 실패했습니다.", error);
      showToast(`편집 중 임시 복구 실패: ${errorMessage(error)}`, "error", 0);
      return null;
    })
    .finally(() => {
      automaticLocalDraftOperation = null;
      if (
        !editorSessionCompleted
        && usagePolicySession
        && !elements.editor_shell.hidden
      ) {
        scheduleLocalDraftAutosave();
      }
    });
  return automaticLocalDraftOperation;
}

async function openLocalDraftDialog() {
  try {
    requireActiveUsagePolicySession();
    if (
      !elements.job_dialog.hidden
      || elements.caption_sheet_dialog.open
      || projectMutationLockCount > 0
      || Boolean(activeJobController)
    ) {
      throw new Error("진행 중인 작업이 끝난 뒤 저장본 목록을 열어 주세요.");
    }
    focusBeforeLocalDraftDialog = elements.open_local_drafts;
    const drafts = await queueLocalDraftOperation(() => (
      refreshLocalDraftList({ preserveSelection: false })
    ));
    elements.local_draft_dialog.hidden = false;
    if (!elements.local_draft_dialog.open) {
      elements.local_draft_dialog.showModal();
    }
    const firstInput = elements.local_draft_list.querySelector("input");
    (firstInput || elements.close_local_draft_dialog).focus();
    updateLocalDraftStatus(drafts);
  } catch (error: unknown) {
    showToast(`저장본 목록을 열지 못했습니다: ${errorMessage(error)}`, "error", 0);
  }
}

function closeLocalDraftDialog() {
  if (elements.local_draft_dialog.open) {
    elements.local_draft_dialog.close();
  }
  elements.local_draft_dialog.hidden = true;
}

async function countSameProjectEditorTabs() {
  return countStudioProjectEditors(project.id);
}

function devReloadEnabled() {
  return new URLSearchParams(location.search).get("dev") === "1";
}

function devReloadSessionValue(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setDevReloadSessionValue(key: string, value: string) {
  sessionStorage.setItem(key, value);
}

function removeDevReloadSessionValue(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // A disabled session store simply prevents hard reload below.
  }
}

function announceDevReload(message: string, type = "info", timeout = 5_000) {
  const notice = `${type}:${message}`;
  if (notice === devReloadNotice) {
    return;
  }
  devReloadNotice = notice;
  showToast(message, type, timeout);
}

async function readDevReloadMarker() {
  try {
    const markerUrl = new URL(studioAssetUrl("dev-reload.json"));
    markerUrl.searchParams.set("cache", `${Date.now()}-${Math.random()}`);
    const response = await fetch(markerUrl, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return normalizeDevReloadMarker(await response.json());
  } catch {
    return null;
  }
}

function projectReplacementBusyReason() {
  if (
    activeJobController
    || exportRequestPending
    || projectMutationLockCount > 0
    || pointerEditActive
    || rangeHandleDragActive
    || previewBoundaryTransitioning
    || localDraftOperationActive
    || automaticLocalDraftOperation
    || !elements.job_dialog.hidden
    || elements.caption_sheet_dialog.open
    || elements.local_draft_dialog.open
  ) {
    return "진행 중인 편집·저장·내보내기 작업";
  }
  return "";
}

function editingSessionExitBusyReason(): string {
  const replacementBusyReason = projectReplacementBusyReason();
  if (replacementBusyReason) {
    return replacementBusyReason;
  }
  if (
    shortPreviewCacheOperation
    || shortSourceBoundaryPreviewInFlight
    || shortSourceCropGesture
    || shortWorkspaceTransformGesture
  ) {
    return "쇼츠 미리보기·화면 조정 작업";
  }
  if (
    activeChzzkVodJob
    || activeVodHotLoadDrain
    || inFlightVodHotLoadBatch
  ) {
    return "VOD 편집 영상 준비 작업";
  }
  if (
    elements.export_options_dialog.open
    || elements.cleanup_after_export_dialog.open
    || elements.session_completed_dialog.open
    || pendingExportCleanupResolve
  ) {
    return "열려 있는 내보내기·세션 정리 확인창";
  }
  return "";
}

function setEditingSessionExitControlsBusy(
  busy: boolean,
  status = "",
  statusType: "status" | "error" = "status"
): void {
  editingSessionExitInProgress = busy;
  elements.editing_session_exit_dialog.setAttribute(
    "aria-busy",
    busy ? "true" : "false"
  );
  elements.cancel_editing_session_exit.disabled = busy;
  elements.save_and_exit_editing_session.disabled = busy;
  elements.discard_and_exit_editing_session.disabled = busy;
  elements.finish_editing_session.disabled = (
    busy
    || !editingSessionCheckpointActive
    || editorSessionCompleted
  );
  elements.editing_session_exit_status.textContent = status;
  elements.editing_session_exit_status.className = (
    `editing-session-exit-status${statusType === "error" ? " error" : ""}`
  );
  elements.editing_session_exit_status.setAttribute(
    "role",
    statusType === "error" ? "alert" : "status"
  );
  elements.editing_session_exit_status.setAttribute(
    "aria-live",
    statusType === "error" ? "assertive" : "polite"
  );
}

function closeEditingSessionExitDialog(): void {
  if (editingSessionExitInProgress) {
    return;
  }
  if (elements.editing_session_exit_dialog.open) {
    elements.editing_session_exit_dialog.close();
  }
}

function openEditingSessionExitDialog(): void {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  if (!editingSessionCheckpointActive || !editingSessionCheckpointId) {
    showToast(
      "이번 편집의 시작 상태를 확인하지 못해 작업을 끝낼 수 없습니다. 현재 탭을 닫고 시작 화면에서 다시 열어 주세요.",
      "error",
      0
    );
    return;
  }
  const busyReason = editingSessionExitBusyReason();
  if (busyReason) {
    showToast(`${busyReason}이 끝난 뒤 작업을 끝내 주세요.`, "error", 0);
    return;
  }
  focusBeforeEditingSessionExit = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : elements.finish_editing_session;
  setEditingSessionExitControlsBusy(false);
  if (!elements.editing_session_exit_dialog.open) {
    elements.editing_session_exit_dialog.showModal();
  }
  elements.cancel_editing_session_exit.focus({ preventScroll: true });
}

async function notifyRuntimeOfEditingSessionCompletion(
  activePolicy: ActiveUsagePolicySession
): Promise<void> {
  try {
    const response = await completeStudioEditorSession({
      projectId: activePolicy.projectId,
      sourceSessionId: activePolicy.sourceSessionId,
      ...(activePolicy.sessionLeaseId
        ? {
          sessionLeaseId: activePolicy.sessionLeaseId,
          transitionGeneration: activePolicy.transitionGeneration
        }
        : {})
    });
    if (
      response?.ok !== true
      || response.projectId !== activePolicy.projectId
    ) {
      throw new Error(String(
        response?.error || "브라우저가 이번 편집의 완료 상태를 확인하지 못했습니다."
      ));
    }
  } catch (error: unknown) {
    // The browser checkpoint is already resolved at this point. Never reopen
    // or rewrite it merely because the ephemeral runtime notice failed.
    console.warn("편집 종료 뒤 앱 내부 연결 정리를 확인하지 못했습니다.", error);
  }
}

async function finishEditingSession(
  choice: "save" | "discard"
): Promise<void> {
  if (editingSessionExitInProgress) {
    return;
  }
  const busyReason = editingSessionExitBusyReason();
  if (busyReason) {
    setEditingSessionExitControlsBusy(
      false,
      `${busyReason}이 끝난 뒤 다시 선택해 주세요.`,
      "error"
    );
    return;
  }

  let activePolicy: ActiveUsagePolicySession;
  try {
    activePolicy = requireActiveUsagePolicySession();
    if (
      !editingSessionCheckpointActive
      || !editingSessionCheckpointId
      || activePolicy.projectId !== project.id
    ) {
      throw new Error("이번 편집의 시작 상태를 확인하지 못했습니다.");
    }
  } catch (error: unknown) {
    setEditingSessionExitControlsBusy(false, errorMessage(error), "error");
    return;
  }

  const checkpointId = editingSessionCheckpointId;
  const finishingProjectId = project.id;
  let checkpointResolved = false;
  let checkpointMissing = false;
  setEditingSessionExitControlsBusy(
    true,
    choice === "save"
      ? "현재 편집을 이 기기에 확정하는 중…"
      : "이번 편집의 변경을 버리고 열기 전 상태로 되돌리는 중…"
  );
  stopLocalDraftAutosave();
  stopDevReloadObserver();

  try {
    if (choice === "save") {
      const finalProject = await flushSave();
      if (!finalProject || finalProject.id !== finishingProjectId) {
        throw new Error("확정할 현재 편집 상태를 저장하지 못했습니다.");
      }
      await waitForProjectSaves();
      await localDraftOperationQueue;
      editorSessionCompleted = true;
      discardPendingProjectSave();
      advanceProjectSessionGeneration();
      const committed = await commitEditingSessionCheckpoint(
        finishingProjectId,
        checkpointId,
        finalProject
      );
      if (committed !== true) {
        checkpointMissing = true;
        throw new Error(
          "현재 편집 체크포인트가 달라 저장을 확정하지 않았습니다."
        );
      }
      checkpointResolved = true;
    } else {
      editorSessionCompleted = true;
      discardPendingProjectSave();
      await waitForProjectSaves();
      await localDraftOperationQueue;
      advanceProjectSessionGeneration();
      const discarded = await discardEditingSessionCheckpoint(
        finishingProjectId,
        checkpointId
      );
      if (discarded !== true) {
        checkpointMissing = true;
        throw new Error(
          "현재 편집 체크포인트가 달라 변경을 폐기하지 않았습니다."
        );
      }
      checkpointResolved = true;
    }

    editingSessionCheckpointActive = false;
    editingSessionCheckpointId = "";
    elements.editing_session_exit_status.textContent = (
      choice === "save"
        ? "저장을 확정했습니다. 시작 화면으로 돌아갑니다…"
        : "이번 변경을 폐기했습니다. 시작 화면으로 돌아갑니다…"
    );
    await notifyRuntimeOfEditingSessionCompletion(activePolicy);
    usagePolicySession = null;
    clearUsagePolicyExpiryTimer();
    leaveCompletedStudioEditor();
  } catch (error: unknown) {
    if (checkpointResolved) {
      console.error("편집 체크포인트를 정리한 뒤 화면 이동에 실패했습니다.", error);
      setEditingSessionExitControlsBusy(
        true,
        `편집 종료는 완료했지만 시작 화면으로 이동하지 못했습니다. 주소의 첫 화면으로 이동해 주세요: ${errorDetails(error)}`,
        "error"
      );
      return;
    }
    if (checkpointMissing) {
      editingSessionCheckpointActive = false;
      editingSessionCheckpointId = "";
      setEditingSessionExitControlsBusy(
        true,
        `편집 시작 상태가 사라져 저장·폐기를 확정하지 않았습니다. 이 탭에서는 더 쓰지 않고 시작 화면에서 다시 확인해 주세요: ${errorDetails(error)}`,
        "error"
      );
      return;
    }
    editorSessionCompleted = false;
    editingSessionExitInProgress = false;
    startLocalDraftAutosave();
    startDevReloadObserver();
    setEditingSessionExitControlsBusy(
      false,
      `작업 종료를 완료하지 못했습니다. 현재 편집은 그대로 열어 두었습니다: ${errorDetails(error)}`,
      "error"
    );
  }
}

function devReloadBusyReason() {
  const replacementBusyReason = projectReplacementBusyReason();
  if (replacementBusyReason) {
    return replacementBusyReason;
  }
  if (shortPreviewCacheOperation) {
    return "쇼츠 로컬 미리보기 준비 작업";
  }
  if (mediaFile && !isMaterializedLoopbackMediaSource(mediaFile) && (
    project?.mediaAsset?.fileHandleStored !== true
    || !mediaHandle
  )) {
    return "재시작용 원본 파일 핸들이 없는 현재 세션";
  }
  return "";
}

async function saveAndVerifyDevReloadProject() {
  if (!project?.id) {
    throw new Error("다시 열 수 있도록 저장할 현재 프로젝트가 없습니다.");
  }
  const snapshot = persistedProjectSnapshot();
  discardPendingProjectSave();
  await startProjectSnapshotSave(snapshot);
  await waitForProjectSaves();
  const stored = await loadProject(snapshot.id);
  const expectedFingerprint = devReloadProjectFingerprint(snapshot);
  const storedFingerprint = devReloadProjectFingerprint(stored);
  const currentFingerprint = devReloadProjectFingerprint(
    workspaceMode === "short-form" ? rootProject : project
  );
  if (
    !stored
    || storedFingerprint !== expectedFingerprint
    || currentFingerprint !== expectedFingerprint
  ) {
    throw new Error(
      "방금 저장한 프로젝트를 다시 확인한 결과가 달라 자동 새로고침을 중단했습니다."
    );
  }
  return {
    projectId: snapshot.id,
    fingerprint: storedFingerprint
  };
}

function verifyExpectedDevReloadProject(candidateProject: EditorProject) {
  if (!devReloadEnabled()) {
    return false;
  }
  const raw = devReloadSessionValue(DEV_RELOAD_EXPECTED_PROJECT_KEY);
  if (!raw) {
    return false;
  }
  let expected: unknown;
  try {
    expected = JSON.parse(raw);
  } catch {
    removeDevReloadSessionValue(DEV_RELOAD_EXPECTED_PROJECT_KEY);
    return false;
  }
  if (
    !isRecord(expected)
    || expected.projectId !== candidateProject.id
    || typeof expected.fingerprint !== "string"
  ) {
    removeDevReloadSessionValue(DEV_RELOAD_EXPECTED_PROJECT_KEY);
    return false;
  }
  const actualFingerprint = devReloadProjectFingerprint(candidateProject);
  if (actualFingerprint !== expected.fingerprint) {
    removeDevReloadSessionValue(DEV_RELOAD_EXPECTED_PROJECT_KEY);
    throw new Error(
      "코드 변경 직전에 저장한 프로젝트와 다시 불러온 프로젝트가 다릅니다. "
      + "편집 중 복구본을 덮어쓰지 않았으니 저장 목록을 확인해 주세요."
    );
  }
  removeDevReloadSessionValue(DEV_RELOAD_EXPECTED_PROJECT_KEY);
  return true;
}

async function replaceDevReloadStylesheet(revision: string) {
  const current = document.querySelector(
    'link[rel~="stylesheet"][href*="editor/editor.css"]'
  );
  if (!current) {
    throw new Error("교체할 편집기 stylesheet를 찾지 못했습니다.");
  }
  const replacement = current.cloneNode();
  (replacement as EditorControl).href = devReloadStyleUrl((current as EditorControl).href, revision);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      (replacement as EditorControl).remove();
      reject(new Error("새 CSS를 5초 안에 불러오지 못했습니다."));
    }, 5_000);
    replacement.addEventListener("load", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    replacement.addEventListener("error", () => {
      clearTimeout(timer);
      (replacement as EditorControl).remove();
      reject(new Error("새 CSS 파일을 불러오지 못했습니다."));
    }, { once: true });
    current.after(replacement);
  });
  current.remove();
}

async function hardReloadEditorFromMarker(marker: DevReloadMarker) {
  const busyReason = devReloadBusyReason();
  if (busyReason) {
    announceDevReload(
      `코드 변경을 감지했지만 ${busyReason} 때문에 자동 재로드를 기다립니다.`,
      "info",
      0
    );
    return false;
  }
  if (await countSameProjectEditorTabs() > 1) {
    announceDevReload(
      "같은 프로젝트 편집기 탭이 둘 이상이라 자동 재로드를 보류했습니다. 다른 탭을 닫아 주세요.",
      "error",
      0
    );
    return false;
  }
  const busyReasonAfterTabQuery = devReloadBusyReason();
  if (busyReasonAfterTabQuery) {
    announceDevReload(
      `탭 확인 중 ${busyReasonAfterTabQuery}이 시작되어 자동 재로드를 기다립니다.`,
      "info",
      0
    );
    return false;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }
  if (workspaceMode === "short-form") {
    stopShortCanvasPlayback();
  }
  elements.preview_video.pause();
  standbyPreviewVideo?.pause();
  await Promise.resolve();

  const previousInert = document.body.inert;
  let navigationStarted = false;
  document.body.inert = true;
  lockProjectMutations();
  try {
    const verified = await saveAndVerifyDevReloadProject();
    setDevReloadSessionValue(
      DEV_RELOAD_EXPECTED_PROJECT_KEY,
      JSON.stringify({
        projectId: verified.projectId,
        fingerprint: verified.fingerprint,
        revision: marker.revision
      })
    );
    setDevReloadSessionValue(
      DEV_RELOAD_LAST_REVISION_KEY,
      marker.revision
    );
    const resumeUrl = devReloadResumeUrl(location.href, verified.projectId);
    history.replaceState(null, "", resumeUrl);
    location.reload();
    navigationStarted = true;
    return true;
  } catch (error: unknown) {
    removeDevReloadSessionValue(DEV_RELOAD_EXPECTED_PROJECT_KEY);
    announceDevReload(
      `자동 재로드를 안전하게 중단했습니다: ${errorMessage(error)}`,
      "error",
      0
    );
    return false;
  } finally {
    if (!navigationStarted) {
      unlockProjectMutations();
      document.body.inert = previousInert;
    }
  }
}

async function applyDevReloadMarker(marker: DevReloadMarker) {
  const lastRevision = devReloadSessionValue(
    DEV_RELOAD_LAST_REVISION_KEY
  );
  if (!lastRevision) {
    setDevReloadSessionValue(
      DEV_RELOAD_LAST_REVISION_KEY,
      marker.revision
    );
    announceDevReload(
      "개발용 안전 핫 리로드가 연결됐습니다.",
      "success"
    );
    return;
  }
  if (lastRevision === marker.revision) {
    return;
  }
  if (marker.kind === "initial") {
    await hardReloadEditorFromMarker({
      ...marker,
      kind: "editor"
    });
    return;
  }

  if (marker.kind === "style") {
    await replaceDevReloadStylesheet(marker.revision);
    setDevReloadSessionValue(
      DEV_RELOAD_LAST_REVISION_KEY,
      marker.revision
    );
    devReloadNotice = "";
    announceDevReload(
      "CSS 변경을 영상·재생 위치 그대로 반영했습니다.",
      "success"
    );
    return;
  }
  if (marker.kind === "editor") {
    await hardReloadEditorFromMarker(marker);
    return;
  }

  // Ignore a marker from a newer development runner until this page reloads.
  setDevReloadSessionValue(
    DEV_RELOAD_LAST_REVISION_KEY,
    marker.revision
  );
}

function scheduleDevReloadPoll(delayMs = DEV_RELOAD_POLL_INTERVAL_MS) {
  clearTimeout(devReloadPollTimer ?? undefined);
  devReloadPollTimer = setTimeout(() => {
    devReloadPollTimer = null;
    void pollDevReloadMarker();
  }, delayMs);
}

async function pollDevReloadMarker() {
  if (
    !devReloadEnabled()
    || !devReloadObserverActive
    || devReloadProcessing
  ) {
    return;
  }
  devReloadProcessing = true;
  try {
    const marker = await readDevReloadMarker();
    if (!marker) {
      devReloadMissingCount += 1;
      if (devReloadMissingCount >= DEV_RELOAD_FETCH_FAILURE_LIMIT) {
        devReloadObserverActive = false;
        announceDevReload(
          "개발용 marker가 없어 안전 핫 리로드 감시를 종료했습니다.",
          "info"
        );
        return;
      }
    } else {
      devReloadMissingCount = 0;
      await applyDevReloadMarker(marker);
    }
  } catch (error: unknown) {
    announceDevReload(
      `핫 리로드 변경을 적용하지 않았습니다: ${errorMessage(error)}`,
      "error",
      0
    );
  } finally {
    devReloadProcessing = false;
  }
  if (devReloadObserverActive) {
    scheduleDevReloadPoll();
  }
}

function startDevReloadObserver() {
  if (!devReloadEnabled()) {
    return;
  }
  devReloadObserverActive = true;
  scheduleDevReloadPoll(0);
}

function stopDevReloadObserver() {
  devReloadObserverActive = false;
  clearTimeout(devReloadPollTimer ?? undefined);
  devReloadPollTimer = null;
}

function projectFitsMaterializedTransport(
  candidateProject: EditorProject
): boolean {
  const materialization = projectMaterialization(candidateProject);
  if (!materialization) {
    return false;
  }
  try {
    const sourceClockRootProject = (
      workspaceMode === "short-form"
      && rootProject?.id === candidateProject.id
    )
      ? rootProject
      : candidateProject;
    const virtualClip = (asset: ShortFormSourceBackedAsset) => (
      shortFormSourceAssetVirtualClip(
        asset,
        vodSourceAnchorForShortAsset(
          asset,
          candidateProject,
          sourceClockRootProject
        )
      )
    );
    const clips = [
      ...(candidateProject.clips || []).filter((clip) => (
        clip.shortFormCanvasClock !== true
      )),
      ...(candidateProject.shortForm?.videoAssets || []).map(virtualClip),
      ...(candidateProject.shortForm?.sourceAudioAssets || []).map(virtualClip)
    ].filter((clip) => clip.enabled !== false);
    return clips.every((clip) => Boolean(
      materializeEditorClipWithinEditableBounds(clip, materialization)
    ));
  } catch {
    return false;
  }
}

function projectFitsManualTransport(candidateProject: EditorProject): boolean {
  const durationMs = Number(candidateProject.mediaAsset?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return candidateProject.mediaAsset === null;
  }
  const clips = [
    ...(candidateProject.clips || []).filter((clip) => (
      clip.shortFormCanvasClock !== true
    )),
    ...(candidateProject.shortForm?.videoAssets || []).map(
      (asset) => shortFormSourceAssetVirtualClip(asset)
    ),
    ...(candidateProject.shortForm?.sourceAudioAssets || []).map(
      (asset) => shortFormSourceAssetVirtualClip(asset)
    )
  ].filter((clip) => clip.enabled !== false);
  return clips.every((clip) => (
    clip.sourceStartMs >= 0
    && clip.sourceEndMs <= durationMs
  ));
}

async function restoreSelectedLocalDraft() {
  const selectedId = (elements.local_draft_list.querySelector(
    'input[name="local-draft-choice"]:checked'
  ) as EditorControl)?.value;
  if (!selectedId) {
    return;
  }
  if (projectMutationLockCount > 0 || activeJobController) {
    showToast("다른 영상·불러오기 작업이 끝난 뒤 저장본을 불러와 주세요.", "error");
    return;
  }
  await queueLocalDraftOperation(async () => {
    requireRecoveryUsagePolicySession();
    if (await countSameProjectEditorTabs() > 1) {
      throw new Error(
        "같은 프로젝트 편집기 탭이 둘 이상 열려 있습니다. 다른 탭을 닫고 다시 불러와 주세요."
      );
    }
    const draft = await loadLocalDraft(project.id, selectedId);
    if (!draft) {
      throw new Error("선택한 저장본을 찾지 못했습니다.");
    }
    const normalizedDraftProject = normalizeEditorProject(
      cloneProject(draft.project)
    );
    if (!normalizedDraftProject || normalizedDraftProject.id !== project.id) {
      throw new Error("다른 편집 작업의 저장본은 불러올 수 없습니다.");
    }
    const recoveryPolicy = requireRecoveryUsagePolicySession();
    const restoredSourceSessionId = sourceSessionIdentity(
      recoverySourceRecord(normalizedDraftProject.source) ?? undefined
    ) || `saved-project:${normalizedDraftProject.id}`;
    if (recoveryPolicy.sourceSessionId !== restoredSourceSessionId) {
      throw new Error(
        "현재 사용자 진술과 원본 회차가 다른 저장본은 불러올 수 없습니다."
      );
    }
    const restoresMaterializedTransport = projectUsesChzzkMaterializedMedia(
      normalizedDraftProject
    );
    const currentTransport = currentRuntimeTransportBinding();
    const reusesCurrentMaterializedTransport = Boolean(
      restoresMaterializedTransport
      && currentTransport
      && runtimeTransportMediaIdentityMatches(
        normalizedDraftProject.mediaAsset,
        currentTransport
      )
    );
    const restoredProject = reusesCurrentMaterializedTransport
      ? runtimeTransportBoundProjectSnapshot(
        normalizedDraftProject,
        currentTransport
      )
      : restoresMaterializedTransport
        ? projectFitsMaterializedTransport(normalizedDraftProject)
          ? normalizedDraftProject
          : null
        : projectFitsManualTransport(normalizedDraftProject)
          ? normalizedDraftProject
          : null;
    if (!restoredProject) {
      throw new Error(
        projectUsesChzzkMaterializedMedia(project)
          ? "이 저장본의 본편·쇼츠 범위가 현재 준비된 편집 영상을 벗어납니다. 필요한 구간을 먼저 더 받은 뒤 다시 불러와 주세요."
          : "이 저장본의 본편·쇼츠 범위가 현재 연결한 파일 길이를 벗어납니다. 같은 원본 파일인지 확인해 주세요."
      );
    }
    if (projectMutationLockCount > 0 || activeJobController) {
      throw new Error(
        "저장본을 확인하는 동안 다른 작업이 시작되어 불러오기를 중단했습니다. 다시 시도해 주세요."
      );
    }

    // Keep the UI-shaped snapshot as well as the root-shaped durable one.
    // A Shorts undo stack must never receive the long-form carrier document,
    // while IndexedDB rollback must always receive that carrier document.
    const currentWorkspaceProject = cloneProject(project);
    const currentPersistedProject = persistedProjectSnapshot();
    if (workspaceMode === "short-form") {
      stopShortCanvasPlayback();
    }
    elements.preview_video.pause();
    stopPreviewAudioClock({ sync: false });
    closeTimelineContextMenu();
    let restoredBoundHandle: FileSystemFileHandle | null = null;
    lockProjectMutations();
    try {
      discardPendingProjectSave();
      const exactDraft: LocalDraftRecord = {
        ...draft,
        project: restoredProject
      };
      // Make the exact pre-restore CURRENT durable before invalidating queued
      // writers from this generation. If the atomic restore itself fails, an
      // abrupt stop can therefore still reopen the latest current edit.
      await queueCurrentProjectSessionWrite(() => saveProject(
        currentPersistedProject
      ));
      advanceProjectSessionGeneration();
      const restoreResult = await queueCurrentProjectSessionWrite(() => restoreLocalDraft(
        currentPersistedProject,
        exactDraft,
        {
          now: Date.now(),
          id: crypto.randomUUID()
        }
      ));
      restoredBoundHandle = restoreResult.restoredMediaHandle;
      if (!reusesCurrentMaterializedTransport) {
        // The selected snapshot owns a different local transport authority.
        // Detach B before exposing A in memory; restoreMedia below may attach
        // only the exact handle or materialization identity installed by the
        // selected draft. Never display B underneath A's edit decisions.
        const previousMediaFile = mediaFile;
        const previousMediaUrl = mediaUrl;
        stopShortCanvasPlayback({ keepCurrentTime: false });
        stopPreviewPlaybackClock();
        stopPreviewAudioClock({ sync: false });
        cancelPreviewPreload({ clearSource: true });
        releaseShortPreviewSourceAudio();
        releaseShortPreviewLayerVideos();
        releaseShortPreviewAssetCaches();
        elements.preview_video.pause();
        elements.preview_video.removeAttribute("src");
        elements.preview_video.load();
        releaseMediaUrl(previousMediaFile, previousMediaUrl);
        mediaFile = null!;
        mediaUrl = null;
        mediaHandle = null;
      }
      const restoreIntoShortWorkspace = workspaceMode === "short-form";
      rootProject = cloneProject(restoredProject);
      if (restoreIntoShortWorkspace) {
        project = createShortFormWorkspaceProject(restoredProject);
      } else {
        workspaceMode = "main";
        updateShortWorkspaceUrl(false);
        project = restoredProject;
      }
      shortWorkspaceHistory.clear();
      const sameTransport = runtimeTransportMediaIdentityMatches(
        currentPersistedProject.mediaAsset,
        restoredProject.mediaAsset
      );
      undoStack = sameTransport
        ? [restoreIntoShortWorkspace
          ? currentWorkspaceProject
          : currentPersistedProject]
        : [];
      redoStack = [];
      mainWorkspaceUndoStack = [];
      mainWorkspaceRedoStack = [];
      fieldEditSession = null;
      pendingPreviewSeek = null;
      activeClipId = null;
      clearTimelineRangeSelection({ render: false });
      releaseAllImageAssetObjectUrls();
      renderAll();
    } finally {
      unlockProjectMutations();
    }
    let exactMediaReconnected = reusesCurrentMaterializedTransport;
    if (!reusesCurrentMaterializedTransport && restoresMaterializedTransport) {
      await restoreMedia();
      exactMediaReconnected = Boolean(
        mediaFile && projectUsesChzzkMaterializedMedia(project)
      );
    } else if (!restoresMaterializedTransport && restoredBoundHandle) {
      await restoreMedia();
      exactMediaReconnected = Boolean(mediaFile && mediaHandle);
    } else if (reusesCurrentMaterializedTransport) {
      await syncPreviewToPlayhead();
    }
    scheduleImageAssetBlobPrune();
    closeLocalDraftDialog();
    try {
      updateLocalDraftStatus(
        await listLocalDrafts(project.id, { limit: 5 })
      );
    } catch (error) {
      console.warn("복원 뒤 임시저장 상태를 갱신하지 못했습니다.", error);
    }
    showToast(
      restoresMaterializedTransport && !exactMediaReconnected
        ? "저장본을 불러오고 이전 영상을 분리했습니다. 이 저장본의 VOD 편집 영상을 다시 준비해 주세요."
        : !restoresMaterializedTransport && !restoredBoundHandle
        ? "저장본을 불러오고 이전 영상을 분리했습니다. 이 저장본의 원본 파일을 ‘내 파일 직접 연결’에서 다시 선택해 주세요."
        : !exactMediaReconnected
          ? "저장본을 불러오고 이전 영상을 분리했습니다. 저장본의 원본 파일 권한을 다시 허용하거나 파일을 직접 연결해 주세요."
          : "저장본을 불러왔습니다. 직전 상태도 자동으로 저장했습니다.",
      !exactMediaReconnected
        ? "warning"
        : "success",
      5200
    );
  }).catch((error: unknown) => {
    showToast(`저장본 불러오기 실패: ${errorMessage(error)}`, "error", 0);
  });
}

function startLocalDraftAutosave() {
  localDraftAutosaveAnchorAtMs = Date.now();
  scheduleLocalDraftAutosave();
}

function stopLocalDraftAutosave() {
  clearTimeout(localDraftAutosaveTimer ?? undefined);
  localDraftAutosaveTimer = null;
}

function collectImageAssetBlobKeys(
  candidateProject: {
    imageAssets?: Array<{
      source?: { kind?: string; value?: string };
    }>;
    shortForm?: {
      imageAssets?: Array<{
        source?: { kind?: string; value?: string };
      }>;
    };
    shortFormWorkspaces?: {
      workspaces?: Array<{
        shortForm?: {
          imageAssets?: Array<{
            source?: { kind?: string; value?: string };
          }>;
        };
      }>;
    };
  } | null | undefined,
  keys: Set<string>
) {
  const assets = [
    ...(candidateProject?.imageAssets || []),
    ...(candidateProject?.shortForm?.imageAssets || []),
    ...(candidateProject?.shortFormWorkspaces?.workspaces || []).flatMap(
      (workspace) => workspace.shortForm?.imageAssets || []
    )
  ];
  for (const asset of assets) {
    if (asset.source?.kind === "blob-key" && asset.source.value) {
      keys.add(String(asset.source.value));
    }
  }
}

async function pruneUnusedImageAssetBlobs() {
  if (!project?.id) {
    return 0;
  }
  const projectId = project.id;
  if (await countStudioProjectEditors(projectId) > 1) {
    return 0;
  }
  const keep = new Set<string>();
  collectImageAssetBlobKeys(project, keep);
  collectImageAssetBlobKeys(rootProject, keep);
  for (const snapshot of mainWorkspaceUndoStack) {
    collectImageAssetBlobKeys(snapshot, keep);
  }
  for (const snapshot of mainWorkspaceRedoStack) {
    collectImageAssetBlobKeys(snapshot, keep);
  }
  for (const snapshot of undoStack) {
    collectImageAssetBlobKeys(snapshot, keep);
  }
  for (const snapshot of redoStack) {
    collectImageAssetBlobKeys(snapshot, keep);
  }
  collectImageAssetBlobKeys(fieldEditSession?.snapshot, keep);
  const localDrafts = await listLocalDrafts(projectId, { limit: 5 });
  for (const draft of localDrafts) {
    collectImageAssetBlobKeys(draft.project, keep);
  }

  return pruneImageAssetBlobs(projectId, keep);
}

function scheduleImageAssetBlobPrune() {
  clearTimeout(imageAssetPruneTimer ?? undefined);
  imageAssetPruneTimer = setTimeout(() => {
    imageAssetPruneTimer = null;
    void pruneUnusedImageAssetBlobs().catch((error) => {
      console.warn("사용하지 않는 이미지 데이터를 정리하지 못했습니다.", error);
    });
  }, 3_000);
}

function runtimeTransportMediaIdentityMatches(
  previousAsset: EditorProject["mediaAsset"],
  nextAsset: EditorProject["mediaAsset"]
): boolean {
  if (!previousAsset || !nextAsset) {
    return previousAsset === nextAsset;
  }
  const previousMaterialization = normalizeChzzkVodMaterialization(
    previousAsset.materialization
  );
  const nextMaterialization = normalizeChzzkVodMaterialization(
    nextAsset.materialization
  );
  const previousMaterializedMode = (
    previousAsset.mediaMode === "source-vod-selection"
    || previousAsset.mediaMode === "chzzk-vod-selection"
    || Boolean(previousMaterialization)
  );
  const nextMaterializedMode = (
    nextAsset.mediaMode === "source-vod-selection"
    || nextAsset.mediaMode === "chzzk-vod-selection"
    || Boolean(nextMaterialization)
  );
  if (previousMaterializedMode || nextMaterializedMode) {
    return Boolean(
      previousMaterializedMode
      && nextMaterializedMode
      && previousMaterialization
      && nextMaterialization
      && sameMaterializedSourceVersion(previousAsset, nextMaterialization)
    );
  }
  return sameCaptionMediaIdentity(previousAsset, nextAsset);
}

function runtimeTransportBoundProjectSnapshot(
  snapshot: EditorProject,
  mediaAsset: EditorProject["mediaAsset"]
): EditorProject | null {
  try {
    const identitySafeSnapshot = runtimeTransportMediaIdentityMatches(
      snapshot.mediaAsset,
      mediaAsset
    )
      ? snapshot
      : clearCaptionCheckpointsAcrossWorkspaces(snapshot);
    const materialized = Boolean(
      mediaAsset
      && projectUsesChzzkMaterializedMedia({
        ...identitySafeSnapshot,
        mediaAsset
      })
    );
    const snapshotWasMaterialized = projectUsesChzzkMaterializedMedia(
      identitySafeSnapshot
    );
    const transportCandidate = {
      ...identitySafeSnapshot,
      mediaAsset: mediaAsset ? cloneProject(mediaAsset) : null
    };
    const bound = materialized
      ? snapshotWasMaterialized
        ? normalizeMaterializedProjectSourceClock(transportCandidate)
        : {
          ...applyMediaAlignmentOffset(identitySafeSnapshot, 0),
          mediaAsset: mediaAsset ? cloneProject(mediaAsset) : null
        }
      : transportCandidate;
    if (
      materialized
        ? !projectFitsMaterializedTransport(bound)
        : !projectFitsManualTransport(bound)
    ) {
      return null;
    }
    return bound;
  } catch {
    return null;
  }
}

function withRuntimeTransportBinding(
  snapshot: EditorProject,
  mediaAsset: EditorProject["mediaAsset"]
): EditorProject {
  const bound = runtimeTransportBoundProjectSnapshot(snapshot, mediaAsset);
  if (!bound) {
    throw new Error(
      "현재 로컬 미디어와 맞지 않는 실행 취소 상태는 복원할 수 없습니다."
    );
  }
  return bound;
}

function currentRuntimeTransportBinding(): EditorProject["mediaAsset"] {
  return project.mediaAsset ? cloneProject(project.mediaAsset) : null;
}

function rebindRuntimeTransportHistory(
  mediaAsset: EditorProject["mediaAsset"]
): void {
  const rebind = (snapshots: readonly EditorProject[]) => snapshots.flatMap(
    (snapshot) => {
      const bound = runtimeTransportBoundProjectSnapshot(snapshot, mediaAsset);
      return bound ? [bound] : [];
    }
  );
  undoStack = rebind(undoStack);
  redoStack = rebind(redoStack);
  mainWorkspaceUndoStack = rebind(mainWorkspaceUndoStack);
  mainWorkspaceRedoStack = rebind(mainWorkspaceRedoStack);
  if (fieldEditSession) {
    const snapshot = runtimeTransportBoundProjectSnapshot(
      fieldEditSession.snapshot,
      mediaAsset
    );
    fieldEditSession = snapshot
      ? { ...fieldEditSession, snapshot }
      : null;
  }
}

function pushUndo(snapshot: EditorProject) {
  undoStack.push(snapshot);
  if (undoStack.length > 60) {
    undoStack.shift();
  }
  redoStack = [];
}

function canonicalizeShortWorkspaceProject(next: EditorProject): EditorProject {
  if (workspaceMode !== "short-form") {
    return next;
  }
  const currentRootOffsetMs = Math.round(
    Number(rootProject.broadcastSession?.alignmentOffsetMs) || 0
  );
  const nextOffsetMs = Math.round(
    Number(next.broadcastSession?.alignmentOffsetMs) || 0
  );
  const alignedRootProject = currentRootOffsetMs === nextOffsetMs
    ? rootProject
    : applyMediaAlignmentOffset(rootProject, nextOffsetMs);
  const parentWithLatestFraming = {
    ...alignedRootProject,
    shortForm: next.shortForm
  };
  const shortForm = shortFormBranchFromWorkspace(
    parentWithLatestFraming,
    next
  );
  const shortFormWorkspaces = saveActiveShortFormWorkspace(
    alignedRootProject.shortFormWorkspaces,
    alignedRootProject.shortForm,
    shortForm,
    alignedRootProject.clips
  );
  rootProject = {
    ...alignedRootProject,
    source: { ...next.source },
    broadcastSession: { ...next.broadcastSession },
    mediaAsset: next.mediaAsset ? { ...next.mediaAsset } : null,
    shortForm,
    shortFormWorkspaces,
    updatedAt: new Date().toISOString()
  };
  return {
    ...next,
    clips: [shortFormCanvasClip(shortForm.durationMs)],
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    playheadMs: Math.min(
      shortForm.durationMs,
      Math.max(0, Math.round(Number(next.playheadMs) || 0))
    ),
    shortForm,
    shortFormWorkspaces
  };
}

function applyProject(next: EditorProject, {
  record = true,
  render = true,
  save = true
} = {}) {
  if (!next || next === project) {
    return;
  }
  const previousSnapshot = record ? cloneProject(project) : null;
  const canonicalNext = canonicalizeShortWorkspaceProject(next);
  if (record) {
    pushUndo(previousSnapshot!);
  }
  project = canonicalNext;
  if (render) {
    renderAll();
  }
  if (save) {
    scheduleSave();
  }
}

function lockProjectMutations() {
  projectMutationLockCount += 1;
  if (project) {
    renderTimelineRange();
  }
}

function unlockProjectMutations() {
  projectMutationLockCount = Math.max(0, projectMutationLockCount - 1);
  if (project) {
    renderTimelineRange();
  }
  if (projectMutationLockCount === 0) {
  }
}

function applyFieldProject(next: EditorProject, key: string) {
  if (!next || next === project) {
    return;
  }
  if (!fieldEditSession || fieldEditSession.key !== key) {
    fieldEditSession = {
      key,
      snapshot: cloneProject(project),
      recorded: false
    };
  }
  if (!fieldEditSession.recorded) {
    pushUndo(fieldEditSession.snapshot);
    fieldEditSession.recorded = true;
  }
  project = canonicalizeShortWorkspaceProject(next);
  renderAll({ keepScroll: true });
  scheduleSave();
}

function endFieldEdit(key: string) {
  if (!fieldEditSession || (key && fieldEditSession.key !== key)) {
    return;
  }
  fieldEditSession = null;
  renderHeader();
  void flushSave().catch((error) => {
    showToast(`프로젝트 저장 실패: ${errorMessage(error)}`, "error", 0);
  });
}

function undo() {
  fieldEditSession = null;
  const previous = undoStack.pop();
  if (!previous) {
    return;
  }
  redoStack.push(cloneProject(project));
  project = canonicalizeShortWorkspaceProject(
    withRuntimeTransportBinding(
      previous,
      currentRuntimeTransportBinding()
    )
  );
  clearTimelineRangeSelection({ render: false });
  renderAll();
  scheduleSave();
  void syncPreviewToPlayhead();
}

function redo() {
  fieldEditSession = null;
  const next = redoStack.pop();
  if (!next) {
    return;
  }
  undoStack.push(cloneProject(project));
  project = canonicalizeShortWorkspaceProject(
    withRuntimeTransportBinding(
      next,
      currentRuntimeTransportBinding()
    )
  );
  clearTimelineRangeSelection({ render: false });
  renderAll();
  scheduleSave();
  void syncPreviewToPlayhead();
}

function selectedCue() {
  return project.subtitles.find((cue) => cue.id === project.selectedCueId) || null;
}

function captionReviewMessage(cue: EditorSubtitleCue) {
  return isAudSegBlankTimingCue(cue)
    ? "AudSeg가 잡은 빈 오디오 타이밍 · 원음을 듣고 텍스트 입력 필요"
    : "AI가 불명확한 발화로 표시함 · 원음 재확인 필요";
}

function selectedAudioRegion() {
  return project.audioRegions.find((region) => region.id === project.selectedAudioRegionId) || null;
}

function selectedImageAsset() {
  return (project.imageAssets || []).find((asset) => asset.id === project.selectedImageAssetId) || null;
}

function formatFileSize(bytes: number) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  }
  return `${Math.max(1, Math.round(value / 1024))}KB`;
}

function releaseImageAssetObjectUrl(assetId: string) {
  const cached = imageAssetObjectUrls.get(assetId);
  if (cached?.url) {
    URL.revokeObjectURL(cached.url);
  }
  imageAssetObjectUrls.delete(assetId);
}

function releaseAllImageAssetObjectUrls() {
  for (const assetId of imageAssetObjectUrls.keys()) {
    releaseImageAssetObjectUrl(assetId);
  }
}

async function resolveImageAssetUrl(asset: EditorImageAsset) {
  if (!asset?.source) {
    return null;
  }
  if (asset.source.kind === "data-url") {
    return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(asset.source.value)
      ? asset.source.value
      : null;
  }
  if (asset.source.kind !== "blob-key") {
    return null;
  }
  const sourceKey = `${asset.source.kind}:${asset.source.value}`;
  const cached = imageAssetObjectUrls.get(asset.id);
  if (cached?.sourceKey === sourceKey) {
    return cached.url;
  }
  releaseImageAssetObjectUrl(asset.id);
  const blob = await loadImageAssetBlob(project.id, asset.source.value);
  if (!(blob instanceof Blob) || !ALLOWED_IMAGE_ASSET_TYPES.has(blob.type)) {
    return null;
  }
  const afterLoad = imageAssetObjectUrls.get(asset.id);
  if (afterLoad?.sourceKey === sourceKey) {
    return afterLoad.url;
  }
  const assetStillPresent = project.imageAssets?.some((candidate) => (
    candidate.id === asset.id &&
    candidate.source?.kind === asset.source.kind &&
    candidate.source?.value === asset.source.value
  ));
  if (!assetStillPresent) {
    return null;
  }
  releaseImageAssetObjectUrl(asset.id);
  const url = URL.createObjectURL(blob);
  imageAssetObjectUrls.set(asset.id, { sourceKey, url });
  return url;
}

function renderHeader() {
  renderWorkspaceModeChrome();
  if (elements.project_name.value !== project.name && document.activeElement !== elements.project_name) {
    elements.project_name.value = project.name;
  }
  const sourcePlatform = String(project.source?.platform || "CHZZK").toUpperCase();
  const sourceType = String(project.source?.contentType || "UNKNOWN").toUpperCase();
  elements.source_kind.textContent = sourceType === "UNKNOWN"
    ? sourcePlatform
    : `${sourcePlatform} · ${sourceType}`;
  elements.source_title.textContent = [
    project.source?.streamerName,
    project.source?.broadcastTitle
  ].filter(Boolean).join(" · ") || "키리누키 프로젝트";
  elements.source_link_state.classList.toggle("connected", sourceBindingConnected);
  elements.source_link_state.title = sourceBindingConnected
    ? "원래 영상 탭과 연결됨"
    : "원래 영상 탭을 찾지 못함";
  elements.undo.disabled = undoStack.length === 0;
  elements.redo.disabled = redoStack.length === 0;
  const canPrepareChzzkVod = Boolean(chzzkVodSourceUrl());
  const preparedMaterialization = projectMaterialization();
  elements.prepare_chzzk_vod.hidden = !canPrepareChzzkVod;
  elements.prepare_chzzk_vod_empty.hidden = !canPrepareChzzkVod;
  elements.prepare_chzzk_vod.disabled = Boolean(activeJobController);
  elements.prepare_chzzk_vod_empty.disabled = Boolean(activeJobController);
  const prepareLabel = preparedMaterialization
    ? "편집 영상 다시 준비"
    : "편집 영상 준비";
  elements.prepare_chzzk_vod.lastChild!.textContent = ` ${prepareLabel}`;
  elements.prepare_chzzk_vod_empty.textContent = prepareLabel;
  elements.stage_empty_title.textContent = canPrepareChzzkVod
    ? "편집할 영상을 준비해 주세요"
    : "내 파일을 직접 연결하면 바로 미리볼 수 있어요";
  elements.stage_empty_copy.textContent = canPrepareChzzkVod
    ? "선택한 구간을 기준으로 필요한 영상만 이 기기에 가져옵니다. 부족한 앞뒤 구간은 편집 중 더 준비할 수 있습니다"
    : "본인 소유이거나 사용 허가를 받은 영상 파일을 사용합니다";
  elements.export_video.disabled = (
    !mediaFile
    || !project.clips.some((clip) => clip.enabled !== false)
    || Boolean(clipOutsideMedia(project))
    || Boolean(shortSourcePickerReturnState)
  );
  elements.open_short_form.disabled = (
    Boolean(activeJobController)
  );
  if (document.activeElement !== elements.caption_style_preset) {
    elements.caption_style_preset.value = String(
      project.subtitleDefaults?.stylePresetId
      || DEFAULT_CAPTION_STYLE_PRESET_ID
    );
  }
  const warnings = Array.isArray(project.ai?.warnings)
    ? project.ai.warnings.filter((warning) => (
      warning &&
      typeof warning.code === "string" &&
      warning.code.trim()
    ))
    : [];
  elements.caption_agent_warning.hidden = warnings.length === 0;
  if (warnings.length > 0) {
    const warningLabels: Record<string, string> = {
      NO_RECOGNIZABLE_SPEECH: "인식된 발화 없음",
      AUDSEG_NO_ACTIVITY: "AudSeg 활동 구간 없음",
      AUDSEG_CONTINUOUS_ACTIVITY: "AudSeg 연속 활동·경계 검수 필요",
      AUDSEG_LOW_LEVEL_CONTRAST: "AudSeg 음량 대비 낮음",
      AUDSEG_NOISE_FLOOR_CAPPED: "AudSeg 잡음 바닥 상한 적용",
      AUDSEG_REVIEW_REQUIRED: "AudSeg 타이밍 검수 필요",
      LOCAL_VISUAL_ANALYSIS_FAILED: "화면 위치 분석 실패·하단 기본값 사용",
      DROPPED_INVALID_CUE: "유효하지 않은 자막 제외",
      DROPPED_EMPTY_RANGE: "빈 시간 자막 제외",
      EXPANDED_SHORT_CUE: "0.1초 미만 자막 자동 보정",
      TRIMMED_LONG_TEXT: "긴 텍스트 축약",
      SPLIT_LONG_CUE: "자동 생성 자막 시간 분할",
      TRIMMED_WARNING_COUNT: "추가 처리 경고 생략",
      TRIMMED_CUE_COUNT: "자막 개수 상한으로 일부 제외",
      HARNESS_NORMALIZED_CUE_TEXT: "공백·종결 마침표 정리",
      HARNESS_SPLIT_CUE: "한 줄 길이·읽기속도 기준 시간 분할",
      HARNESS_EXPANDED_CUE_RANGE: "읽을 시간 확보",
      HARNESS_EXPANDED_SHORT_CUE: "짧은 자막 표시시간 확보",
      HARNESS_STABILIZED_PLACEMENT: "완성본 기준 하단 고정",
      HARNESS_REPAIRED_SAME_SPEAKER_OVERLAP: "같은 화자 겹침 보정",
      HARNESS_READING_RATE_EXCEEDED: "읽기속도 재검수 필요",
      HARNESS_TRANSCRIPT_COVERAGE_LOW: "STT 대비 발화 누락 가능성",
      HARNESS_TRANSCRIPT_PRECISION_LOW: "STT에 없는 문구 가능성",
      HARNESS_SHORT_CUE_UNRESOLVED: "너무 짧은 자막 재검수 필요",
      HARNESS_UNRESOLVED_SAME_SPEAKER_OVERLAP: "같은 화자 겹침 재검수 필요",
      HARNESS_CUE_TEXT_TOO_WIDE: "한 줄 폭 재검수 필요",
      HARNESS_LINE_TOO_WIDE: "한 줄 폭 재검수 필요",
      HARNESS_TOO_MANY_LINES: "여러 줄 자막 재검수 필요"
    };
    const counts = new Map<string, number>();
    for (const warning of warnings) {
      const label = warningLabels[warning.code] || "기타 처리 경고";
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const summary = [...counts.entries()]
      .map(([label, count]) => `${label} ${count}건`)
      .join(" · ");
    const reviewCount = warnings.filter(
      (warning) => CAPTION_REVIEW_WARNING_CODES.has(warning.code)
    ).length;
    elements.caption_agent_warning.textContent = reviewCount > 0
      ? `품질 검수 필요 ${reviewCount}건 · ${summary}. 표시된 컷 원음을 확인해 주세요.`
      : `자동 품질 검사에서 정리한 항목 ${warnings.length}건 · ${summary}`;
  } else {
    elements.caption_agent_warning.textContent = "";
  }
}

function renderMediaCard() {
  const asset = project.mediaAsset;
  const materialization = projectMaterialization();
  const materializedMode = projectUsesChzzkMaterializedMedia();
  const usableMedia = Boolean(mediaFile && materializedMediaBindingIsValid());
  elements.media_card.classList.toggle("empty", !usableMedia);
  elements.stage_empty.hidden = usableMedia;
  if (document.activeElement !== elements.source_offset) {
    elements.source_offset.value = String(
      (Number(project.broadcastSession?.alignmentOffsetMs) || 0) / 1000
    );
  }
  elements.source_offset.disabled = !mediaFile || materializedMode;
  elements.apply_source_offset.disabled = !mediaFile || materializedMode;
  const alignmentCard = elements.source_offset.closest(".alignment-card") as HTMLElement | null;
  if (alignmentCard) {
    alignmentCard.hidden = materializedMode;
  }
  if (!asset) {
    if (chzzkVodSourceUrl()) {
      elements.media_name.textContent = `${sourcePlatformLabel(
        String(project.source?.platform || SOURCE_PLATFORM_CHZZK).toUpperCase()
      )} 편집 영상 미준비`;
      elements.media_meta.textContent = "선택한 구간에 필요한 영상만 이 기기에 가져옵니다";
    } else {
      elements.media_name.textContent = "영상 파일 미연결";
      elements.media_meta.textContent = "본인 소유·사용 허가 파일을 직접 연결하세요";
    }
    return;
  }
  if (materializedMode && !usableMedia) {
    elements.media_name.textContent = "VOD 편집 영상 다시 준비 필요";
    elements.media_meta.textContent = "원본 또는 컷이 바뀌어 이전 편집 영상을 사용하지 않습니다";
    return;
  }
  const dimensions = asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : "";
  elements.media_name.textContent = materialization
    ? `${sourcePlatformLabel(materialization.source.platform)} 편집 영상 준비됨`
    : String(asset.name || "");
  const preparedClipCount = materialization
    ? new Set(
      materialization.windows.flatMap((window) => window.clipIds)
    ).size
    : 0;
  elements.media_meta.textContent = materialization
    ? `${asset.sizeLabel || ""}${dimensions} · 구간 ${preparedClipCount}개 · 필요한 앞뒤 범위를 더 준비할 수 있음`
    : `${asset.sizeLabel || ""}${dimensions} · ${formatTime(asset.durationMs, { compact: true })}`;
}

function pruneClipGroupSelection() {
  const availableIds = new Set(
    project.clips.map((clip) => clip.id)
  );
  for (const clipId of clipGroupSelection) {
    if (!availableIds.has(clipId)) {
      clipGroupSelection.delete(clipId);
    }
  }
}

function clipListPositionMap() {
  return new Map<string, number>(
    [...elements.clip_list.querySelectorAll(".clip-item")].map((item) => [
      (item as EditorControl).dataset.id || "",
      item.getBoundingClientRect().top
    ])
  );
}

function animateClipListReorder(previousPositions: ReadonlyMap<string, number>) {
  if (
    !previousPositions?.size ||
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  ) {
    return;
  }
  for (const item of elements.clip_list.querySelectorAll(".clip-item")) {
    const previousTop = previousPositions.get(
      (item as EditorControl).dataset.id || ""
    );
    const currentTop = item.getBoundingClientRect().top;
    const delta = previousTop !== undefined && Number.isFinite(previousTop)
      ? previousTop - currentTop
      : 0;
    if (Math.abs(delta) < 0.5 || typeof item.animate !== "function") {
      continue;
    }
    item.animate(
      [
        { transform: `translateY(${delta}px)` },
        { transform: "translateY(0)" }
      ],
      {
        duration: 210,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      }
    );
  }
}

function renderClipGroupControls({ announcement = "" } = {}) {
  pruneClipGroupSelection();
  const selectedCount = clipGroupSelection.size;
  elements.clip_group_toolbar.hidden = project.clips.length === 0;
  elements.move_selected_clips_up.disabled = !canReorderClipGroup(
    project.clips,
    clipGroupSelection,
    -1
  );
  elements.move_selected_clips_down.disabled = !canReorderClipGroup(
    project.clips,
    clipGroupSelection,
    1
  );
  elements.clear_clip_group_selection.disabled = selectedCount === 0;
  const status = announcement || (
    selectedCount > 0 ? `${selectedCount}개 컷 체크됨` : "체크한 컷 없음"
  );
  if (elements.clip_group_status.textContent !== status) {
    elements.clip_group_status.textContent = status;
  }
  for (const item of elements.clip_list.querySelectorAll(".clip-item")) {
    const checked = clipGroupSelection.has(
      (item as EditorControl).dataset.id || ""
    );
    item.classList.toggle("clip-group-selected", checked);
    const checkbox = item.querySelector(".clip-group-checkbox");
    if (checkbox && (checkbox as EditorControl).checked !== checked) {
      (checkbox as EditorControl).checked = checked;
    }
  }
}

function focusClipGroupCheckbox(clipId: string) {
  const item = [...elements.clip_list.querySelectorAll(".clip-item")]
    .find((candidate) => (candidate as EditorControl).dataset.id === clipId);
  (item?.querySelector(".clip-group-checkbox:not(:disabled)") as EditorControl)?.focus({
    preventScroll: true
  });
}

function focusClipGroupMoveControl(direction: -1 | 1) {
  const requested = direction < 0
    ? elements.move_selected_clips_up
    : elements.move_selected_clips_down;
  const reverse = direction < 0
    ? elements.move_selected_clips_down
    : elements.move_selected_clips_up;
  const target = !requested.disabled
    ? requested
    : !reverse.disabled
      ? reverse
      : elements.clear_clip_group_selection;
  target?.focus({ preventScroll: true });
}

function moveSelectedClipGroup(direction: -1 | 1, {
  restoreCheckboxClipId = null,
  focusControl = false
}: {
  restoreCheckboxClipId?: string | null;
  focusControl?: boolean;
} = {}) {
  const nextProject = anchorPlayheadAfterClipReorder(
    reorderClipGroup(project, clipGroupSelection, direction)
  );
  if (!nextProject || nextProject === project) {
    renderClipGroupControls();
    if (restoreCheckboxClipId) {
      focusClipGroupCheckbox(restoreCheckboxClipId);
    } else if (focusControl) {
      focusClipGroupMoveControl(direction);
    }
    return false;
  }
  const previousPositions = clipListPositionMap();
  clearTimelineRangeSelection({ render: false });
  applyProject(nextProject);
  animateClipListReorder(previousPositions);
  renderClipGroupControls({
    announcement: `${clipGroupSelection.size}개 컷을 한 단계 ${direction < 0 ? "위로" : "아래로"} 이동`
  });
  if (restoreCheckboxClipId) {
    focusClipGroupCheckbox(restoreCheckboxClipId);
  } else if (focusControl) {
    focusClipGroupMoveControl(direction);
  }
  void syncPreviewToPlayhead();
  return true;
}

function anchorPlayheadAfterClipReorder(nextProject: EditorProject) {
  if (!nextProject || nextProject === project) {
    return nextProject;
  }
  const current = mapTimelineToSource(project, project.playheadMs);
  if (
    !current
    || typeof current.clipId !== "string"
    || typeof current.sourceMs !== "number"
  ) {
    return nextProject;
  }
  const anchoredPlayheadMs = current
    ? mapSourceToTimeline(nextProject, current.clipId, current.sourceMs)
    : null;
  if (anchoredPlayheadMs == null) {
    return nextProject;
  }
  activeClipId = current.clipId;
  return {
    ...nextProject,
    playheadMs: anchoredPlayheadMs,
    selectedClipId: current.clipId
  };
}

function renderClipList() {
  pruneClipGroupSelection();
  elements.clip_count.textContent = String(project.clips.length);
  elements.clip_list.replaceChildren();
  project.clips.forEach((clip, index) => {
    const fragment = elements.clip_template.content.cloneNode(
      true
    ) as DocumentFragment;
    const templateElement = (selector: string): EditorControl => {
      const element = fragment.querySelector<HTMLElement>(selector);
      if (!element) {
        throw new Error(`컷 템플릿 요소가 없습니다: ${selector}`);
      }
      return element as EditorControl;
    };
    const item = templateElement(".clip-item");
    const clipDisabled = clip.enabled === false;
    item.dataset.id = clip.id;
    item.classList.toggle("selected", project.selectedClipId === clip.id);
    item.classList.toggle("clip-disabled", clipDisabled);
    item.classList.toggle("clip-group-selected", clipGroupSelection.has(clip.id));
    templateElement(".clip-index").textContent = String(index + 1);
    const clipTitle = clip.note || `선택 구간 ${index + 1}`;
    templateElement(".clip-title").textContent = String(clipTitle);
    templateElement(".clip-time").textContent = `${formatTime(clip.sourceStartMs)} → ${formatTime(clip.sourceEndMs)}`;
    templateElement(".clip-duration").textContent = formatDuration(clipDurationMs(clip));
    const checkbox = templateElement(".clip-group-checkbox");
    checkbox.dataset.clipId = clip.id;
    checkbox.checked = clipGroupSelection.has(clip.id);
    checkbox.setAttribute(
      "aria-label",
      `${index + 1}번 컷 ${clipTitle}, 묶음 이동 선택`
    );
    checkbox.title = clipDisabled
      ? "출력 비활성 컷도 묶음 순서 이동 가능"
      : "묶음 이동할 컷 체크";
    const first = templateElement("[data-action='first']");
    const up = templateElement("[data-action='up']");
    const down = templateElement("[data-action='down']");
    const last = templateElement("[data-action='last']");
    for (const [control, actionLabel] of [
      [first, "맨 처음으로 이동"],
      [up, "한 칸 위로 이동"],
      [down, "한 칸 아래로 이동"],
      [last, "맨 마지막으로 이동"]
    ] as const) {
      const label = `${index + 1}번 컷 ${clipTitle}, ${actionLabel}`;
      control.setAttribute("aria-label", label);
      control.title = label;
    }
    first.disabled = index === 0;
    up.disabled = index === 0;
    down.disabled = index === project.clips.length - 1;
    last.disabled = index === project.clips.length - 1;
    const materialization = projectMaterialization();
    const editableBounds = materialization
      ? materializedEditableBoundsForClip(clip, materialization)
      : null;
    const hotLoadActions = templateElement(".clip-hot-load-actions");
    const loadBefore = templateElement("[data-hot-load='before']");
    const loadAfter = templateElement("[data-hot-load='after']");
    hotLoadActions.hidden = !editableBounds;
    loadBefore.disabled = Boolean(
      !editableBounds
      || editableBounds.editableSourceStartMs <= 0
      || activeJobController
      || projectMutationLockCount > 0
    );
    loadAfter.disabled = Boolean(
      !editableBounds
      || !materialization
      || editableBounds.editableSourceEndMs
        >= materialization.sourceDurationMs
      || activeJobController
      || projectMutationLockCount > 0
    );
    loadBefore.setAttribute("aria-label", `${index + 1}번 컷 앞쪽 30초를 이 기기에 추가`);
    loadAfter.setAttribute("aria-label", `${index + 1}번 컷 뒤쪽 30초를 이 기기에 추가`);
    if (editableBounds) {
      hotLoadActions.title = [
        "현재 로컬 범위",
        formatTime(editableBounds.editableSourceStartMs),
        "→",
        formatTime(editableBounds.editableSourceEndMs)
      ].join(" ");
    }
    elements.clip_list.append(fragment);
  });
  renderClipGroupControls();
}

function renderCaptionColorRegister(selectedColor: string) {
  const colors = [
    DEFAULT_SUBTITLE_COLOR,
    ...(project.recentSubtitleColors || [])
  ].slice(0, 6);
  const activeColor = String(selectedColor || DEFAULT_SUBTITLE_COLOR).toLowerCase();
  elements.caption_color_register.replaceChildren();
  for (let index = 0; index < 6; index += 1) {
    const color = colors[index] || null;
    const shortcut = String(index + 1);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `caption-color-swatch${color ? "" : " placeholder"}`;
    button.dataset.shortcut = shortcut;
    button.setAttribute("aria-keyshortcuts", shortcut);
    if (!color) {
      button.disabled = true;
      button.setAttribute(
        "aria-label",
        `비어 있는 최근 색상 슬롯 ${index + 1} · 단축키 ${shortcut}`
      );
      button.title = `비어 있는 색상 슬롯 · ${shortcut}`;
      elements.caption_color_register.append(button);
      continue;
    }
    button.dataset.color = color;
    button.style.setProperty("--swatch-color", color);
    button.setAttribute("aria-pressed", String(color === activeColor));
    button.setAttribute(
      "aria-label",
      index === 0
        ? `기본 흰색 ${color} · 단축키 ${shortcut}`
        : `최근 자막 색상 ${index} ${color} · 단축키 ${shortcut}`
    );
    button.title = index === 0
      ? `기본 흰색 · ${color.toUpperCase()} · ${shortcut}`
      : `최근 색상 ${index} · ${color.toUpperCase()} · ${shortcut}`;
    elements.caption_color_register.append(button);
  }
}

function renderCueInspector() {
  const cue = selectedCue();
  const showingList = inspectorMode === "list";
  const previousCueInLane = cue && !showingList
    ? adjacentSubtitleCueInLane(project, cue.id, -1)
    : null;
  const nextCueInLane = cue && !showingList
    ? adjacentSubtitleCueInLane(project, cue.id, 1)
    : null;
  elements.cue_count.textContent = String(project.subtitles.length);
  captionInspectorTab.classList.toggle("active", !showingList);
  captionInspectorTab.setAttribute("aria-selected", String(!showingList));
  captionInspectorTab.tabIndex = showingList ? -1 : 0;
  elements.cue_list_tab.classList.toggle("active", showingList);
  elements.cue_list_tab.setAttribute("aria-selected", String(showingList));
  elements.cue_list_tab.tabIndex = showingList ? 0 : -1;
  elements.cue_selected_panel.hidden = showingList;
  elements.cue_list.hidden = !showingList;
  elements.cue_empty.hidden = Boolean(cue);
  elements.cue_editor.hidden = !cue;
  elements.previous_cue_in_lane.disabled = showingList || !previousCueInLane;
  elements.next_cue_in_lane.disabled = showingList || !nextCueInLane;
  if (!cue || showingList) {
    return;
  }
  const reviewRequired = subtitleCueNeedsReview(cue);
  elements.cue_review_note.hidden = !reviewRequired;
  if (reviewRequired) {
    const title = elements.cue_review_note.querySelector("strong");
    const description = elements.cue_review_note.querySelector("span");
    const audsegBlank = isAudSegBlankTimingCue(cue);
    title!.textContent = audsegBlank
      ? "AudSeg 텍스트 입력 필요"
      : "AI 재확인 필요";
    description!.textContent = audsegBlank
      ? "오디오 활동 시각만 만든 빈 칸입니다. 원음을 듣고 자막을 직접 입력해 주세요."
      : "불명확한 발화로 표시된 자막입니다. 원음을 듣고 텍스트를 한 번 확인해 주세요.";
  }
  const range = cueTimelineRange(project, cue);
  if (document.activeElement !== elements.cue_text) {
    elements.cue_text.value = cue.text;
  }
  if (document.activeElement !== elements.cue_start) {
    elements.cue_start.value = formatTime(range!.startMs, { compact: true });
  }
  if (document.activeElement !== elements.cue_end) {
    elements.cue_end.value = formatTime(range!.endMs, { compact: true });
  }
  const cueX = cue.x!;
  const cueY = cue.y!;
  elements.cue_x.value = String(Math.round(cueX * 100));
  elements.cue_y.value = String(Math.round(cueY * 100));
  elements.cue_x_value.textContent = `${Math.round(cueX * 100)}%`;
  elements.cue_y_value.textContent = `${Math.round(cueY * 100)}%`;
  elements.font_size.value = String((
    Number(cue.fontScale)
    || Number(project.subtitleDefaults.fontScale)
    || 0.0675
  ) * 100);
  const defaultColor = project.subtitleDefaults.color;
  elements.font_color.value = cue.color
    || (typeof defaultColor === "string" ? defaultColor : DEFAULT_SUBTITLE_COLOR);
  renderCaptionColorRegister(elements.font_color.value);
  const cueBackground = resolveSubtitleCueBackground(
    project.subtitleDefaults,
    cue
  );
  elements.toggle_caption_background.classList.toggle(
    "active",
    cueBackground.enabled
  );
  elements.toggle_caption_background.setAttribute(
    "aria-pressed",
    String(cueBackground.enabled)
  );
  elements.caption_background_label.textContent = cueBackground.enabled
    ? "이 자막 검은 상자 끄기 · X"
    : "이 자막 검은 상자 켜기 · X";
  const selectedAsset = selectedImageAsset();
  const canMatchAsset = Boolean(selectedAsset && selectedAsset.clipId === cue.clipId);
  elements.match_cue_to_asset.disabled = !canMatchAsset;
  elements.cue_timing_match_help.textContent = !selectedAsset
    ? "같은 컷의 이미지를 선택하면 양끝 시각을 한 번에 맞출 수 있어요."
    : canMatchAsset
      ? `${selectedAsset.name || "선택 이미지"}의 시작·끝 시각을 그대로 적용합니다.`
      : "선택 이미지가 다른 컷에 있어 시각을 맞출 수 없습니다.";
}

function renderImageAssetInspector() {
  const asset = selectedImageAsset();
  elements.asset_empty.hidden = Boolean(asset);
  elements.asset_editor.hidden = !asset;
  if (!asset) {
    elements.asset_thumbnail.removeAttribute("src");
    elements.asset_thumbnail.alt = "";
    return;
  }
  const range = imageAssetTimelineRange(project, asset);
  elements.asset_name.textContent = asset.name;
  elements.asset_meta.textContent = [
    asset.naturalWidth && asset.naturalHeight
      ? `${asset.naturalWidth}×${asset.naturalHeight}`
      : null,
    asset.mimeType?.replace("image/", "").toUpperCase(),
    asset.mimeType === "image/png" || asset.mimeType === "image/webp"
      ? "투명 배경 지원"
      : null
  ].filter(Boolean).join(" · ");
  if (document.activeElement !== elements.asset_start) {
    elements.asset_start.value = formatTime(range?.startMs || 0, { compact: true });
  }
  if (document.activeElement !== elements.asset_end) {
    elements.asset_end.value = formatTime(range?.endMs || 0, { compact: true });
  }
  const selectedSubtitle = selectedCue();
  const canMatchCue = Boolean(selectedSubtitle && selectedSubtitle.clipId === asset.clipId);
  elements.match_asset_to_cue.disabled = !canMatchCue;
  elements.asset_timing_match_help.textContent = !selectedSubtitle
    ? "같은 컷의 자막을 선택하면 양끝 시각을 한 번에 맞출 수 있어요."
    : canMatchCue
      ? `“${selectedSubtitle.text || "빈 자막"}”의 시작·끝 시각을 그대로 적용합니다.`
      : "선택 자막이 다른 컷에 있어 시각을 맞출 수 없습니다.";
  const xPercent = Math.round(asset.x * 100);
  const yPercent = Math.round(asset.y * 100);
  const scalePercent = Math.round(asset.scale * 100);
  const opacityPercent = Math.round(asset.opacity * 100);
  elements.asset_x.value = String(xPercent);
  elements.asset_y.value = String(yPercent);
  elements.asset_x_value.textContent = `${xPercent}%`;
  elements.asset_y_value.textContent = `${yPercent}%`;
  elements.asset_scale.value = String(scalePercent);
  elements.asset_scale_value.textContent = `${scalePercent}%`;
  elements.asset_opacity.value = String(opacityPercent);
  elements.asset_opacity_value.textContent = `${opacityPercent}%`;
  elements.asset_thumbnail.alt = `${asset.name} 미리보기`;
  const selectedId = asset.id;
  void resolveImageAssetUrl(asset).then((url) => {
    if (selectedImageAsset()?.id !== selectedId) {
      return;
    }
    if (url) {
      elements.asset_thumbnail.src = url;
    } else {
      elements.asset_thumbnail.removeAttribute("src");
    }
  }).catch((error) => {
    console.warn("이미지 미리보기를 불러오지 못했습니다.", error);
    elements.asset_thumbnail.removeAttribute("src");
  });
}

function renderAudioInspector() {
  const region = selectedAudioRegion();
  elements.audio_empty.hidden = Boolean(region);
  elements.audio_editor.hidden = !region;
  if (!region) {
    return;
  }
  const range = audioRegionTimelineRange(project, region);
  const clipIndex = project.clips.findIndex((clip) => clip.id === region.clipId);
  elements.audio_region_label.textContent = `${clipIndex + 1}번 컷 · 음성 설정`;
  if (document.activeElement !== elements.audio_start) {
    elements.audio_start.value = formatTime(range!.startMs, { compact: true });
  }
  if (document.activeElement !== elements.audio_end) {
    elements.audio_end.value = formatTime(range!.endMs, { compact: true });
  }
  const gainPercent = Math.round(region.gain * 100);
  elements.audio_volume.value = String(gainPercent);
  elements.audio_volume_value.textContent = `${gainPercent}%`;
  elements.audio_mute.classList.toggle("active", region.muted);
  elements.audio_mute.setAttribute("aria-pressed", String(region.muted));
  elements.audio_mute_label.textContent = region.muted
    ? "이 구간 음소거 해제"
    : "이 구간 음소거";
  const durationMs = Math.max(0, region.endOffsetMs - region.startOffsetMs);
  const maximumFadeMs = Math.min(3_000, durationMs);
  elements.audio_fade_in.max = String(maximumFadeMs);
  elements.audio_fade_out.max = String(maximumFadeMs);
  elements.audio_fade_in.value = String(Math.min(region.fadeInMs, maximumFadeMs));
  elements.audio_fade_out.value = String(Math.min(region.fadeOutMs, maximumFadeMs));
  elements.audio_fade_in_value.textContent = `${(region.fadeInMs / 1000).toFixed(1)}초`;
  elements.audio_fade_out_value.textContent = `${(region.fadeOutMs / 1000).toFixed(1)}초`;
}

function shortFormQualityAssessment(
  sourceRect: ShortFormSourceRect,
  destinationRect: ShortFormDestinationRect
): { level: "ok" | "notice" | "warning"; text: string } {
  const decodedWidth = Math.round(Number(elements.preview_video.videoWidth) || 0);
  const decodedHeight = Math.round(Number(elements.preview_video.videoHeight) || 0);
  const source = shortFormSourceCropFromNormalizedRect(
    decodedWidth || sourceRect.referenceWidth,
    decodedHeight || sourceRect.referenceHeight,
    sourceRect
  );
  const destination = shortFormDestinationRectForTarget(
    SHORT_FORM_OUTPUT_WIDTH,
    SHORT_FORM_OUTPUT_HEIGHT,
    destinationRect
  );
  if (!source || !destination) {
    return {
      level: "warning",
      text: "⚠ 원본과 배치 영역의 크기를 확인해 주세요"
    };
  }
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const scaleX = destination.width / sourceWidth;
  const scaleY = destination.height / sourceHeight;
  const distortion = Math.max(scaleX, scaleY) / Math.max(0.0001, Math.min(scaleX, scaleY));
  const correction = shortPreviewAdaptiveScalerUnavailable
    ? "표준 호환 보간"
    : shortPreviewAdaptiveScaler?.capabilityStatus.warmFrameTiming === "passed"
      ? "자동 고품질 보정"
      : "자동 품질 확인 중";
  if (distortion > 1.015) {
    return {
      level: "warning",
      text: `⚠ 비율 변형 · 가로 ${scaleX.toFixed(2)}배 / 세로 ${scaleY.toFixed(2)}배 · ${correction}`
    };
  }
  const scale = Math.max(scaleX, scaleY);
  if (scale > 1.25) {
    return {
      level: "warning",
      text: `⚠ 원본 ${sourceWidth}×${sourceHeight}px을 ${scale.toFixed(2)}배 확대 · ${correction} · 원본 디테일 한계`
    };
  }
  if (scale > 1.01) {
    return {
      level: "notice",
      text: `원본 ${sourceWidth}×${sourceHeight}px을 ${scale.toFixed(2)}배 확대 · ${correction}`
    };
  }
  if (scale < 0.99) {
    return {
      level: "ok",
      text: `원본 ${sourceWidth}×${sourceHeight}px에서 고품질 축소`
    };
  }
  return {
    level: "ok",
    text: `원본 ${sourceWidth}×${sourceHeight}px · 원본 크기 수준`
  };
}

function renderShortVideoLayerPanel(
  selectedLayer: ShortWorkspaceVideoLayerView | null
): void {
  const focusedLayerId = document.activeElement instanceof HTMLElement
    && elements.short_video_layer_list.contains(document.activeElement)
    ? document.activeElement.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId || null
    : null;
  const layers = shortWorkspaceVideoLayers();
  const editBlocked = shortTimelineSourceEditsBlocked();
  const prospectiveStartMs = Math.max(0, Math.round(project.playheadMs));
  const canAddAtPlayhead = canAddShortFormVideoAsset(
    project.shortForm,
    prospectiveStartMs,
    prospectiveStartMs + 100
  );
  elements.short_video_layer_count.textContent = String(layers.length);
  elements.short_video_layer_list.replaceChildren();
  elements.short_video_layer_empty.hidden = layers.length > 0;
  elements.add_short_video_layer.disabled = (
    !canAddAtPlayhead
    || editBlocked
  );
  elements.add_short_video_layer.textContent = canAddAtPlayhead
    ? "+ 영상 추가"
    : `현재 시각 최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개`;

  for (const [index, layer] of layers.entries()) {
    const rootSource = rootProject.clips.find((candidate) => (
      candidate.id === layer.sourceClipId
    ));
    const sourceIndex = rootProject.clips.findIndex((candidate) => (
      candidate.id === layer.sourceClipId
    ));
    const item = document.createElement("article");
    item.className = "short-video-layer-item";
    item.dataset.layerId = layer.id;
    item.dataset.visible = String(layer.visible);
    item.dataset.selected = String(layer.id === selectedLayer?.id);
    item.setAttribute("role", "listitem");
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = editBlocked;
    button.className = "short-video-layer-select";
    button.dataset.layerId = layer.id;
    button.tabIndex = layer.id === selectedLayer?.id ? 0 : -1;
    button.setAttribute("aria-pressed", String(layer.id === selectedLayer?.id));
    button.setAttribute(
      "aria-label",
      `영상 ${index + 1}, ${layer.lane + 1}번 라인, 음량 ${Math.round(layer.audioGain * 100)}%, ${layer.visible ? "표시 중" : "숨김"}, 쇼츠 ${formatTime(layer.timelineStartMs, { compact: true })}부터 ${formatTime(layer.timelineEndMs, { compact: true })}, 원본 ${formatTime(layer.sourceStartMs, { compact: true })}부터 ${formatTime(layer.sourceEndMs, { compact: true })}`
    );

    const order = document.createElement("span");
    order.className = "short-video-layer-index";
    order.textContent = String(index + 1);

    const copy = document.createElement("span");
    copy.className = "short-video-layer-copy";
    const title = document.createElement("strong");
    title.textContent = String(rootSource?.note || "").trim()
      || (sourceIndex >= 0 ? `본편 컷 ${sourceIndex + 1}` : "본편 영상");
    const timing = document.createElement("small");
    timing.textContent = (
      `쇼츠 ${formatTime(layer.timelineStartMs, { compact: true })}–${formatTime(layer.timelineEndMs, { compact: true })}`
      + ` · 원본 ${formatTime(layer.sourceStartMs, { compact: true })}–${formatTime(layer.sourceEndMs, { compact: true })}`
    );
    copy.append(title, timing);

    const state = document.createElement("span");
    state.className = "short-video-layer-state";
    state.textContent = !layer.visible
      ? "숨김"
      : `L${layer.lane + 1} · 화면 ${Math.round(layer.opacity * 100)}% · 소리 ${Math.round(layer.audioGain * 100)}%`;
    button.append(order, copy, state);
    const orderActions = document.createElement("div");
    orderActions.className = "short-video-layer-order-actions";
    orderActions.setAttribute("role", "group");
    orderActions.setAttribute("aria-label", `${index + 1}번 영상 화면 겹침 순서`);
    const actions = [
      ["front", "맨 위", index <= 0],
      ["forward", "위로", index <= 0],
      ["backward", "아래로", index >= layers.length - 1],
      ["back", "맨 아래", index >= layers.length - 1]
    ] as const;
    for (const [action, label, boundary] of actions) {
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.shortLayerOrder = action;
      control.dataset.layerId = layer.id;
      control.textContent = label;
      control.disabled = editBlocked || boundary;
      control.setAttribute("aria-label", `${index + 1}번 영상을 ${label}로 이동`);
      orderActions.append(control);
    }
    item.append(button, orderActions);
    elements.short_video_layer_list.append(item);
  }

  const controlsDisabled = !selectedLayer || editBlocked;
  elements.short_video_layer_controls.hidden = !selectedLayer;
  elements.short_video_layer_controls.dataset.disabled = String(controlsDisabled);
  if (document.activeElement !== elements.short_video_layer_start) {
    elements.short_video_layer_start.value = formatTime(
      selectedLayer?.timelineStartMs ?? 0,
      { compact: true }
    );
  }
  if (document.activeElement !== elements.short_video_layer_end) {
    elements.short_video_layer_end.value = formatTime(
      selectedLayer?.timelineEndMs ?? project.shortForm.durationMs,
      { compact: true }
    );
  }
  elements.short_video_layer_start.disabled = controlsDisabled;
  elements.short_video_layer_end.disabled = controlsDisabled;
  elements.short_video_layer_opacity.disabled = controlsDisabled;
  elements.short_video_layer_opacity.value = String(
    Math.round((selectedLayer?.opacity ?? 1) * 100)
  );
  elements.short_video_layer_opacity_value.textContent = (
    `${Math.round((selectedLayer?.opacity ?? 1) * 100)}%`
  );
  elements.short_video_layer_volume.disabled = controlsDisabled;
  elements.short_video_layer_volume.value = String(
    Math.round((selectedLayer?.audioGain ?? 1) * 100)
  );
  elements.short_video_layer_volume_value.textContent = (
    `${Math.round((selectedLayer?.audioGain ?? 1) * 100)}%`
  );
  elements.toggle_short_video_layer_visibility.disabled = controlsDisabled;
  elements.toggle_short_video_layer_visibility.setAttribute(
    "aria-pressed",
    String(selectedLayer?.visible ?? true)
  );
  elements.toggle_short_video_layer_visibility.textContent = selectedLayer?.visible === false
    ? "숨김 · 다시 표시"
    : "표시 중 · 숨기기";
  elements.delete_short_video_layer.disabled = controlsDisabled;
  if (focusedLayerId) {
    elements.short_video_layer_list.querySelector<HTMLButtonElement>(
      `.short-video-layer-select[data-layer-id="${CSS.escape(focusedLayerId)}"]`
    )?.focus({ preventScroll: true });
  }
}

function renderShortFramingInspector(): void {
  renderShortWorkspaceProjectManager();
  const selectedLayer = activeShortWorkspaceVideoLayer();
  const sourceClip = selectedLayer
    ? rootProject.clips.find((candidate) => (
      candidate.id === selectedLayer.sourceClipId
    )) || null
    : null;
  const disabled = !selectedLayer || shortTimelineSourceEditsBlocked();
  const sourceRect = normalizeShortFormSourceRect(selectedLayer?.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(
    selectedLayer?.destinationRect
  );
  const exactGeometry = sourceRect && destinationRect
    ? { sourceRect, destinationRect }
    : null;
  const layers = shortWorkspaceVideoLayers();

  const cacheParent = workspaceMode === "short-form" ? rootProject : project;
  const readyCacheCount = layers.filter((layer) => {
    const cache = shortPreviewAssetCaches.get(layer.id);
    return Boolean(
      cache
      && shortPreviewVideoAssetCacheMatches(cache, layer, cacheParent)
    );
  }).length;
  const sourceAudioAssets = shortPreviewIndependentSourceAudioAssets(
    project.shortForm
  );
  const readySourceAudioCacheCount = sourceAudioAssets.filter((asset) => (
    Boolean(shortPreviewCacheForSourceAudioAsset(asset, cacheParent))
  )).length;
  elements.retry_short_preview_cache.hidden = !shortPreviewCacheError;
  elements.retry_short_preview_cache.disabled = (
    !shortPreviewCacheError
    || Boolean(shortPreviewCacheOperation)
    || Boolean(activeJobController)
    || projectMutationLockCount > 0
  );
  if (shortPreviewCacheOperation) {
    elements.short_preview_cache_status.dataset.state = "working";
    elements.short_preview_cache_status.textContent =
      shortPreviewCacheProgressLabel
      || `영상 ${readyCacheCount}/${layers.length}개 · 이 기기에서 미리보기 준비 중`;
  } else if (shortPreviewCacheError) {
    elements.short_preview_cache_status.dataset.state = "error";
    elements.short_preview_cache_status.textContent =
      `영상 미리보기 준비 실패 · ${shortPreviewCacheError}`;
  } else if (layers.length === 0 && sourceAudioAssets.length === 0) {
    elements.short_preview_cache_status.dataset.state = "ready";
    elements.short_preview_cache_status.textContent =
      "빈 쇼츠 화면 · ‘영상 추가’로 본편 구간을 가져올 수 있습니다.";
  } else {
    elements.short_preview_cache_status.dataset.state = (
      readyCacheCount === layers.length
      && readySourceAudioCacheCount === sourceAudioAssets.length
        ? "ready"
        : "working"
    );
    elements.short_preview_cache_status.textContent = (
      readyCacheCount === layers.length
      && readySourceAudioCacheCount === sourceAudioAssets.length
    )
      ? `영상 ${layers.length}개${sourceAudioAssets.length > 0 ? ` · 기존 방식 음성 ${sourceAudioAssets.length}개` : ""} · 미리보기 준비됨`
      : `영상 ${readyCacheCount}/${layers.length}개${sourceAudioAssets.length > 0 ? ` · 기존 방식 음성 ${readySourceAudioCacheCount}/${sourceAudioAssets.length}개` : ""} · 미리보기 준비 필요`;
  }
  if (
    (readyCacheCount < layers.length
      || readySourceAudioCacheCount < sourceAudioAssets.length)
    && mediaFile
    && materializedMediaBindingIsValid(cacheParent)
  ) {
    // Undo/redo may revive an asset after its in-memory decoder was released.
    // Repair the exact persisted Blob cache asynchronously without making the
    // synchronous render path seek through the full long-form source.
    scheduleShortPreviewCacheRepair();
  }

  renderShortVideoLayerPanel(selectedLayer);

  elements.short_workspace_transform_controls.hidden = !exactGeometry;
  elements.short_workspace_legacy_framing.hidden = true;
  const setDestinationInput = (control: EditorControl, value: number) => {
    if (document.activeElement !== control) {
      control.value = String(value);
    }
    control.disabled = !exactGeometry || disabled;
  };
  setDestinationInput(
    elements.short_workspace_destination_x,
    exactGeometry?.destinationRect.x ?? 0
  );
  setDestinationInput(
    elements.short_workspace_destination_y,
    exactGeometry?.destinationRect.y ?? 0
  );
  setDestinationInput(
    elements.short_workspace_destination_width,
    exactGeometry?.destinationRect.width ?? SHORT_FORM_OUTPUT_WIDTH
  );
  setDestinationInput(
    elements.short_workspace_destination_height,
    exactGeometry?.destinationRect.height ?? SHORT_FORM_OUTPUT_HEIGHT
  );
  elements.short_workspace_destination_lock_aspect.disabled = !exactGeometry || disabled;
  const quality = exactGeometry
    ? shortFormQualityAssessment(
      exactGeometry.sourceRect,
      exactGeometry.destinationRect
    )
    : null;
  elements.short_workspace_destination_readout.dataset.quality = quality?.level || "notice";
  elements.short_workspace_destination_readout.textContent = exactGeometry
    ? `X ${exactGeometry.destinationRect.x} · Y ${exactGeometry.destinationRect.y} · ${exactGeometry.destinationRect.width}×${exactGeometry.destinationRect.height}px · ${quality?.text || "품질 계산 중"}`
    : "영상을 선택하면 픽셀 단위 배치값과 품질 상태가 표시됩니다.";

  // v6 persists exact source/destination rectangles only. These controls are
  // retained as hidden DOM compatibility anchors for old saved editor markup.
  elements.short_workspace_fit.value = "cover";
  elements.short_workspace_fit.disabled = true;
  elements.short_workspace_zoom.value = "100";
  elements.short_workspace_zoom_value.textContent = "1.00×";
  elements.short_workspace_zoom.disabled = true;
  elements.short_workspace_crop_x.value = "50";
  elements.short_workspace_crop_x_value.textContent = "50%";
  elements.short_workspace_crop_x.disabled = true;
  elements.short_workspace_crop_y.value = "50";
  elements.short_workspace_crop_y_value.textContent = "50%";
  elements.short_workspace_crop_y.disabled = true;
  elements.short_workspace_scale.value = "100";
  elements.short_workspace_scale_value.textContent = "100%";
  elements.short_workspace_scale.disabled = true;
  elements.short_workspace_position_x.value = "50";
  elements.short_workspace_position_x_value.textContent = "50%";
  elements.short_workspace_position_x.disabled = true;
  elements.short_workspace_position_y.value = "50";
  elements.short_workspace_position_y_value.textContent = "50%";
  elements.short_workspace_position_y.disabled = true;
  elements.short_workspace_position_presets.disabled = true;
  elements.reset_short_workspace_framing.disabled = disabled;
  elements.copy_short_workspace_framing.disabled = (
    disabled || layers.length < 2
  );
  elements.reset_short_workspace_framing.hidden = !selectedLayer;
  elements.copy_short_workspace_framing.hidden = (
    !selectedLayer || layers.length < 2
  );
  const edgeGaps = selectedLayer
    ? detectShortFormCanvasEdgeGaps(selectedLayer)
    : [];
  const compositeGaps = selectedLayer
    ? detectShortFormCompositeCanvasGaps(project.shortForm).filter((finding) => (
      finding.timelineStartMs <= project.playheadMs
      && project.playheadMs < finding.timelineEndMs
      && finding.relatedAssetIds.includes(selectedLayer.id)
    ))
    : [];
  elements.short_workspace_squeegee.hidden = (
    !selectedLayer || (edgeGaps.length === 0 && compositeGaps.length === 0)
  );
  const edgeLabels: Record<string, string> = {
    left: "왼쪽",
    right: "오른쪽",
    top: "위",
    bottom: "아래"
  };
  elements.short_workspace_edge_gap_status.dataset.state = (
    edgeGaps.length > 0 || compositeGaps.length > 0
  )
    ? "warning"
    : "clear";
  elements.short_workspace_edge_gap_status.textContent = !selectedLayer
    ? "영상을 선택하면 1–24px의 미세한 가장자리 틈을 검사합니다."
    : compositeGaps.length > 0
      ? `현재 화면의 최종 합성에서 미세 틈 ${compositeGaps.length}개 감지 · ‘모두 밀기’로 관련 영상만 맞닿게 확장할 수 있습니다.`
    : edgeGaps.length > 0
      ? `미세한 검은 틈 감지 · ${edgeGaps.map(({ edge, pixels }) => `${edgeLabels[edge]} ${pixels}px`).join(" · ")}`
      : "밀어낼 미세 틈이 없습니다. 크게 비운 영역은 의도적 배치로 유지합니다.";
  for (const button of elements.short_workspace_squeegee_actions
    .querySelectorAll<HTMLButtonElement>("button[data-short-workspace-squeegee]")) {
    const direction = button.dataset.shortWorkspaceSqueegee || "";
    button.disabled = disabled || (
      direction === "all"
        ? edgeGaps.length === 0 && compositeGaps.length === 0
        : !edgeGaps.some(({ edge }) => edge === direction)
    );
  }

  if (selectedLayer) {
    const selectedIndex = layers.findIndex((candidate) => (
      candidate.id === selectedLayer.id
    ));
    const sourceIndex = rootProject.clips.findIndex((candidate) => (
      candidate.id === selectedLayer.sourceClipId
    ));
    const sourceLabel = String(sourceClip?.note || "").trim()
      || (sourceIndex >= 0 ? `본편 컷 ${sourceIndex + 1}` : "본편 원본 컷");
    elements.short_workspace_source.textContent = (
      `영상 ${Math.max(0, selectedIndex) + 1}/${layers.length} · ${sourceLabel}`
    );
    elements.short_workspace_duration.textContent = (
      `쇼츠 ${formatTime(selectedLayer.timelineStartMs, { compact: true })}–${formatTime(selectedLayer.timelineEndMs, { compact: true })}`
      + ` · 원본 ${formatTime(selectedLayer.sourceStartMs, { compact: true })}–${formatTime(selectedLayer.sourceEndMs, { compact: true })}`
      + ` · 길이 ${formatTime(selectedLayer.timelineEndMs - selectedLayer.timelineStartMs, { compact: true })}`
    );
  } else {
    elements.short_workspace_source.textContent = "빈 1080×1920 쇼츠 화면";
    elements.short_workspace_duration.textContent =
      `영상이 없는 시간도 정상 편집 상태입니다 · 전체 ${formatTime(project.shortForm.durationMs, { compact: true })}`;
  }

  for (const button of elements.short_workspace_position_presets
    .querySelectorAll<HTMLButtonElement>("button[data-short-workspace-position]")) {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
    button.disabled = true;
  }
  elements.short_workspace_preview.setAttribute(
    "aria-label",
    exactGeometry
      ? `쇼츠 9대16 화면. 영상 ${layers.length}개 중 선택 영상은 원본 ${Math.round(exactGeometry.sourceRect.x * exactGeometry.sourceRect.referenceWidth)}, ${Math.round(exactGeometry.sourceRect.y * exactGeometry.sourceRect.referenceHeight)}에서 ${Math.round(exactGeometry.sourceRect.width * exactGeometry.sourceRect.referenceWidth)} 곱하기 ${Math.round(exactGeometry.sourceRect.height * exactGeometry.sourceRect.referenceHeight)}픽셀을 가져와 쇼츠 화면 X ${exactGeometry.destinationRect.x}, Y ${exactGeometry.destinationRect.y}, ${exactGeometry.destinationRect.width} 곱하기 ${exactGeometry.destinationRect.height}픽셀로 배치합니다.`
      : "빈 1080대1920 쇼츠 화면. 영상을 자유롭게 추가할 수 있습니다."
  );
  renderShortWorkspaceTransformOverlay();
}

function renderPropertyInspector() {
  const showingAudio = propertyInspectorMode === "audio";
  const showingAsset = propertyInspectorMode === "asset";
  const showingFraming = (
    workspaceMode === "short-form" && propertyInspectorMode === "framing"
  );
  const showingCaption = !showingAudio && !showingAsset && !showingFraming;
  elements.editor_shell.dataset.propertyMode = propertyInspectorMode;
  elements.caption_mode_tab.classList.toggle("active", showingCaption);
  elements.caption_mode_tab.setAttribute("aria-selected", String(showingCaption));
  elements.caption_mode_tab.tabIndex = showingCaption ? 0 : -1;
  elements.asset_mode_tab.classList.toggle("active", showingAsset);
  elements.asset_mode_tab.setAttribute("aria-selected", String(showingAsset));
  elements.asset_mode_tab.tabIndex = showingAsset ? 0 : -1;
  elements.audio_mode_tab.classList.toggle("active", showingAudio);
  elements.audio_mode_tab.setAttribute("aria-selected", String(showingAudio));
  elements.audio_mode_tab.tabIndex = showingAudio ? 0 : -1;
  elements.short_framing_mode_tab.classList.toggle("active", showingFraming);
  elements.short_framing_mode_tab.setAttribute("aria-selected", String(showingFraming));
  elements.short_framing_mode_tab.tabIndex = showingFraming ? 0 : -1;
  elements.caption_inspector_content.hidden = !showingCaption;
  elements.asset_inspector_content.hidden = !showingAsset;
  elements.audio_inspector_content.hidden = !showingAudio;
  elements.short_framing_inspector_content.hidden = !showingFraming;
  elements.inspector_title.textContent = showingFraming
    ? "9:16 화면 맞춤"
    : showingAudio
    ? "구간별 음성"
    : showingAsset
      ? "영상 위 이미지"
      : "한글 자막";
  elements.add_cue_top.hidden = !showingCaption;
  renderCueInspector();
  renderImageAssetInspector();
  renderAudioInspector();
  renderShortFramingInspector();
}

function renderCueList() {
  elements.cue_list.replaceChildren();
  const sorted = [...project.subtitles].sort((a, b) => {
    const rangeA = cueTimelineRange(project, a);
    const rangeB = cueTimelineRange(project, b);
    return (rangeA?.startMs || 0) - (rangeB?.startMs || 0);
  });
  sorted.forEach((cue) => {
    const range = cueTimelineRange(project, cue);
    if (!range) {
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cue-list-item";
    button.classList.toggle("selected", cue.id === project.selectedCueId);
    const reviewRequired = subtitleCueNeedsReview(cue);
    button.classList.toggle("review-required", reviewRequired);
    if (reviewRequired) {
      button.title = captionReviewMessage(cue);
    }
    button.dataset.id = cue.id;
    const time = document.createElement("time");
    time.textContent = `L${cue.lane + 1} · ${formatTime(range.startMs, { compact: true }).slice(0, -4)}`;
    const text = document.createElement("span");
    text.textContent = cue.text || "(빈 자막)";
    button.append(time, text);
    elements.cue_list.append(button);
  });
}

function formatCaptionSheetPercent(value: number, fractionDigits: number) {
  return `${value.toFixed(fractionDigits)}%`;
}

function createCaptionSheetSourceBadge(source: "project" | "cue") {
  const badge = document.createElement("span");
  badge.className = "caption-sheet-source-badge";
  badge.textContent = source === "cue" ? "개별" : "기본";
  badge.title = source === "cue"
    ? "이 자막에 따로 저장된 설정"
    : "프로젝트 기본값을 상속한 설정";
  return badge;
}

function appendCaptionSheetVariationBadge(
  cell: HTMLTableCellElement,
  varies: boolean,
  propertyLabel: string
) {
  if (!varies) {
    return;
  }
  cell.classList.add("caption-sheet-cell-variation");
  const badge = document.createElement("span");
  badge.className = "caption-sheet-variation-badge";
  badge.textContent = "다름";
  badge.title = `${propertyLabel}이 가장 많이 쓰인 값과 다릅니다. 오류로 확정된 것은 아닙니다.`;
  cell.append(" ", badge);
}

function createCaptionSheetColor(color: string) {
  const value = String(color || "transparent").toLowerCase();
  const wrapper = document.createElement("span");
  wrapper.className = "caption-sheet-color";
  const swatch = document.createElement("span");
  swatch.className = "caption-sheet-color-swatch";
  swatch.style.setProperty("--caption-sheet-color", value);
  swatch.setAttribute("aria-hidden", "true");
  const code = document.createElement("span");
  code.className = "caption-sheet-color-code";
  code.textContent = value.toUpperCase();
  wrapper.append(swatch, code);
  return wrapper;
}

function renderCaptionSheetRow(row: CaptionPropertiesSheetRow) {
  const tableRow = document.createElement("tr");
  tableRow.className = "caption-sheet-row";
  tableRow.classList.toggle("selected", row.cueId === project.selectedCueId);
  tableRow.classList.toggle("has-variation", row.variations.any);
  tableRow.classList.toggle("output-excluded", !row.outputEnabled);
  tableRow.dataset.cueId = row.cueId;

  const cueCell = document.createElement("th");
  cueCell.scope = "row";
  const cueButton = document.createElement("button");
  cueButton.type = "button";
  cueButton.className = "caption-sheet-cue-button";
  cueButton.dataset.cueId = row.cueId;
  cueButton.textContent = `#${row.ordinal}`;
  cueButton.disabled = !row.outputEnabled;
  const startLabel = row.timelineStartMs === null
    ? `컷 안 ${formatTime(row.startOffsetMs, { compact: true })}`
    : formatTime(row.timelineStartMs, { compact: true });
  cueButton.setAttribute(
    "aria-label",
    row.outputEnabled
      ? `${row.ordinal}번 자막 편집 · ${row.clipNumber}번 컷 · ${startLabel} · ${row.laneNumber}번 레인`
      : `${row.ordinal}번 출력 제외 자막 · 편집하려면 ${row.clipNumber}번 컷을 활성화하세요`
  );
  if (!row.outputEnabled) {
    cueButton.title = "출력 제외 컷을 활성화하면 이 자막을 편집할 수 있습니다.";
  }
  cueCell.append(cueButton);

  const clipCell = document.createElement("td");
  clipCell.append(`컷 ${row.clipNumber}`);
  if (!row.outputEnabled) {
    const excluded = document.createElement("span");
    excluded.className = "caption-sheet-source-badge";
    excluded.textContent = "출력 제외";
    excluded.title = "비활성 컷에 속한 자막";
    clipCell.append(" ", excluded);
  }

  const timeCell = document.createElement("td");
  timeCell.textContent = startLabel;
  if (!row.outputEnabled) {
    timeCell.title = "비활성 컷 안에서의 시작 시각";
  }

  const laneCell = document.createElement("td");
  laneCell.textContent = `L${row.laneNumber}`;

  const positionCell = document.createElement("td");
  positionCell.className = "caption-sheet-position";
  positionCell.textContent = `${formatCaptionSheetPercent(row.xPercent, 1)} / ${formatCaptionSheetPercent(row.yPercent, 1)}`;
  appendCaptionSheetVariationBadge(
    positionCell,
    row.variations.position,
    "저장된 자막 위치"
  );

  const fontScaleCell = document.createElement("td");
  fontScaleCell.append(
    formatCaptionSheetPercent(row.fontScalePercent, 2),
    createCaptionSheetSourceBadge(row.fontScaleSource)
  );
  appendCaptionSheetVariationBadge(
    fontScaleCell,
    row.variations.fontScale,
    "설정 크기"
  );

  const colorCell = document.createElement("td");
  colorCell.append(createCaptionSheetColor(row.color));
  appendCaptionSheetVariationBadge(
    colorCell,
    row.variations.color,
    "글자색"
  );

  const backgroundCell = document.createElement("td");
  backgroundCell.append(
    row.backgroundEnabled ? "켬 " : "끔",
    ...(row.backgroundEnabled
      ? [createCaptionSheetColor(row.backgroundColor)]
      : []),
    createCaptionSheetSourceBadge(row.backgroundSource)
  );
  appendCaptionSheetVariationBadge(
    backgroundCell,
    row.variations.background,
    "검은 상자"
  );

  const groupCell = document.createElement("td");
  const groupBadge = document.createElement("span");
  groupBadge.className = "caption-sheet-group-badge";
  groupBadge.textContent = `${row.styleGroupLabel} · ${row.styleGroupCount}개`;
  groupCell.append(groupBadge);
  if (row.styleGroupSingleton) {
    const singletonBadge = document.createElement("span");
    singletonBadge.className = "caption-sheet-singleton-badge";
    singletonBadge.textContent = "단독";
    singletonBadge.title = "같은 화면 설정을 쓰는 자막이 하나뿐입니다.";
    groupCell.append(" ", singletonBadge);
  }

  tableRow.append(
    cueCell,
    clipCell,
    timeCell,
    laneCell,
    positionCell,
    fontScaleCell,
    colorCell,
    backgroundCell,
    groupCell
  );
  return tableRow;
}

function renderCaptionPropertiesSheet() {
  const sheet = createCaptionPropertiesSheet({
    clips: project.clips,
    cues: project.subtitles,
    defaults: project.subtitleDefaults
  });
  const fragment = document.createDocumentFragment();
  for (const row of sheet.rows) {
    fragment.append(renderCaptionSheetRow(row));
  }
  elements.caption_sheet_body.replaceChildren(fragment);
  elements.caption_sheet_table.hidden = sheet.rows.length === 0;
  elements.caption_sheet_empty.hidden = sheet.rows.length > 0;

  const summaryParts = [
    `자막 ${sheet.summary.captionCount}개`,
    `설정 ${sheet.summary.styleGroupCount}묶음`
  ];
  if (sheet.summary.variationCaptionCount > 0) {
    summaryParts.push(
      `가장 많이 쓰인 값과 다른 자막 ${sheet.summary.variationCaptionCount}개`
    );
  }
  if (sheet.summary.singletonStyleGroupCount > 0) {
    summaryParts.push(`단독 설정 ${sheet.summary.singletonStyleGroupCount}개`);
  }
  if (sheet.summary.excludedCaptionCount > 0) {
    summaryParts.push(`출력 제외 ${sheet.summary.excludedCaptionCount}개`);
  }
  if (sheet.summary.unknownClipCaptionCount > 0) {
    summaryParts.push(`연결된 컷 없음 ${sheet.summary.unknownClipCaptionCount}개`);
  }
  elements.caption_sheet_summary.textContent = summaryParts.join(" · ");

  const outline = sheet.summary.commonOutline;
  elements.caption_sheet_common_style.textContent = outline.enabled
    ? `프로젝트 공통 외곽선 ${outline.color.toUpperCase()} · ${formatCaptionSheetPercent(outline.widthPercent, 2)} · 행별 검은 상자와는 별도`
    : "프로젝트 공통 외곽선 없음 · 행별 검은 상자 설정만 비교";
}

function openCaptionPropertiesSheet() {
  if (
    !elements.job_dialog.hidden
    || elements.local_draft_dialog.open
  ) {
    showToast("진행 중인 창을 닫은 뒤 자막 스타일 비교를 열어 주세요.");
    return;
  }
  focusBeforeCaptionSheetDialog = elements.open_caption_sheet;
  renderCaptionPropertiesSheet();
  if (!elements.caption_sheet_dialog.open) {
    elements.caption_sheet_dialog.showModal();
  }
  elements.close_caption_sheet_dialog.focus();
}

function closeCaptionPropertiesSheet({ restoreFocus = true } = {}) {
  if (!restoreFocus) {
    focusBeforeCaptionSheetDialog = null;
  }
  if (elements.caption_sheet_dialog.open) {
    elements.caption_sheet_dialog.close();
  }
}

function openSubtitleSyncGuide() {
  const anotherModalOpen = [...document.querySelectorAll<HTMLDialogElement>(
    "dialog[open]"
  )].some((dialog) => dialog.id !== "subtitle-sync-guide-dialog");
  if (anotherModalOpen || !elements.job_dialog.hidden) {
    showToast("진행 중인 창을 닫은 뒤 노래 자막 싱크 팁을 열어 주세요.");
    return;
  }
  focusBeforeSubtitleSyncGuide = elements.open_subtitle_sync_guide;
  elements.subtitle_sync_skill_content.textContent =
    SUBTITLE_SYNC_SKILL_MARKDOWN;
  elements.subtitle_sync_copy_status.textContent = "";
  if (!elements.subtitle_sync_guide_dialog.open) {
    elements.subtitle_sync_guide_dialog.showModal();
  }
  elements.subtitle_sync_guide_title.focus({ preventScroll: true });
}

function closeSubtitleSyncGuide() {
  if (elements.subtitle_sync_guide_dialog.open) {
    elements.subtitle_sync_guide_dialog.close();
  }
}

async function copySubtitleSyncSkill() {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("이 브라우저에서 클립보드 복사를 사용할 수 없습니다.");
    }
    await navigator.clipboard.writeText(SUBTITLE_SYNC_SKILL_MARKDOWN);
    elements.subtitle_sync_copy_status.textContent =
      "SKILL.md 전체를 복사했습니다.";
  } catch (error: unknown) {
    elements.subtitle_sync_copy_status.textContent = "복사하지 못했습니다.";
    showToast(`SKILL.md를 복사하지 못했습니다: ${errorMessage(error)}`, "error", 5000);
  }
}

function shortWorkspaceVideoLayers(): ShortWorkspaceVideoLayerView[] {
  if (workspaceMode !== "short-form") {
    return [];
  }
  // The panel mirrors paint order: the front-most equal video asset is first.
  return [...project.shortForm.videoAssets].sort((left, right) => (
    right.zIndex - left.zIndex
    || left.timelineStartMs - right.timelineStartMs
    || left.id.localeCompare(right.id)
  ));
}

function activeShortWorkspaceVideoLayer(): ShortWorkspaceVideoLayerView | null {
  const layers = shortWorkspaceVideoLayers();
  if (layers.length === 0) {
    return null;
  }
  const selectedId = project.shortForm.selectedVideoLayerId;
  return layers.find((layer) => layer.id === selectedId)
    || layers.find((layer) => (
      project.playheadMs >= layer.timelineStartMs
      && project.playheadMs < layer.timelineEndMs
    ))
    || layers[0]
    || null;
}

function selectShortWorkspaceVideoLayer(layerId: string): boolean {
  const layer = shortWorkspaceVideoLayers().find((candidate) => (
    candidate.id === layerId
  ));
  if (!layer) {
    return false;
  }
  if (project.shortForm.selectedVideoLayerId === layer.id) {
    revealSelectedPropertyEditor();
    return true;
  }
  project = canonicalizeShortWorkspaceProject({
    ...project,
    shortForm: {
      ...project.shortForm,
      selectedVideoLayerId: layer.id
    }
  });
  fieldEditSession = null;
  renderAll({ keepScroll: true });
  revealSelectedPropertyEditor();
  scheduleSave();
  return true;
}

function updateShortWorkspaceUrl(active: boolean): void {
  const url = new URL(location.href);
  if (active) {
    url.searchParams.set("workspace", "short-form");
    const collection = normalizeShortFormWorkspaceCollection(
      rootProject.shortFormWorkspaces,
      rootProject.shortForm,
      rootProject.clips
    );
    url.searchParams.set("short", collection.activeWorkspaceId);
  } else {
    url.searchParams.delete("workspace");
    url.searchParams.delete("short");
  }
  history.replaceState(null, "", url.href);
}

function currentShortWorkspaceCollection() {
  return normalizeShortFormWorkspaceCollection(
    rootProject.shortFormWorkspaces,
    rootProject.shortForm,
    rootProject.clips
  );
}

function currentShortWorkspaceId(): string {
  return currentShortWorkspaceCollection().activeWorkspaceId;
}

function renderShortWorkspaceProjectManager(): void {
  const shortActive = workspaceMode === "short-form";
  elements.short_workspace_projects.hidden = !shortActive;
  if (!shortActive) {
    return;
  }
  const collection = currentShortWorkspaceCollection();
  const active = activeShortFormWorkspace(
    collection,
    rootProject.shortForm,
    rootProject.clips
  );
  const focusedSelect = document.activeElement === elements.short_workspace_select;
  const desiredOptions = collection.workspaces.map((workspace, index) => ({
    value: workspace.id,
    label: `${index + 1}. ${workspace.name}`
  }));
  const workspaceSelect = elements.short_workspace_select;
  const currentOptions = [...workspaceSelect.options].map(
    (option) => ({ value: option.value, label: option.textContent || "" })
  );
  if (JSON.stringify(currentOptions) !== JSON.stringify(desiredOptions)) {
    workspaceSelect.replaceChildren(...desiredOptions.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      return option;
    }));
  }
  elements.short_workspace_select.value = active.id;
  elements.short_workspace_select.disabled = (
    shortWorkspaceTransitionPending || collection.workspaces.length < 2
  );
  elements.short_workspace_project_count.textContent = String(
    collection.workspaces.length
  );
  if (document.activeElement !== elements.short_workspace_name) {
    elements.short_workspace_name.value = active.name;
  }
  elements.short_workspace_name.disabled = shortWorkspaceTransitionPending;
  elements.create_short_workspace.disabled = (
    shortWorkspaceTransitionPending
    || collection.workspaces.length >= MAX_SHORT_FORM_WORKSPACES
  );
  elements.duplicate_short_workspace.disabled = (
    shortWorkspaceTransitionPending
    || collection.workspaces.length >= MAX_SHORT_FORM_WORKSPACES
  );
  elements.delete_short_workspace.disabled = (
    shortWorkspaceTransitionPending || collection.workspaces.length <= 1
  );
  elements.delete_short_workspace.title = collection.workspaces.length <= 1
    ? "마지막 쇼츠 작업은 삭제할 수 없습니다."
    : `“${active.name}” 작업 삭제`;
  if (focusedSelect) {
    elements.short_workspace_select.focus({ preventScroll: true });
  }
}

function saveCurrentShortWorkspaceHistory(): void {
  if (workspaceMode !== "short-form") {
    return;
  }
  shortWorkspaceHistory.set(currentShortWorkspaceId(), {
    undo: undoStack.map(cloneProject),
    redo: redoStack.map(cloneProject)
  });
}

async function applyShortWorkspaceCollection(
  collectionValue: unknown,
  {
    announce,
    deletedWorkspace = null
  }: {
    announce: string;
    deletedWorkspace?: { id: string; shortForm: EditorProject["shortForm"] } | null;
  }
): Promise<void> {
  if (workspaceMode !== "short-form" || shortWorkspaceTransitionPending) {
    return;
  }
  shortWorkspaceTransitionPending = true;
  renderShortWorkspaceProjectManager();
  try {
    saveCurrentShortWorkspaceHistory();
    const syncedRoot = cloneProject(syncRootProjectFromActiveWorkspace());
    await flushSave();
    await waitForProjectSaves();
    await cancelAndWaitForShortPreviewCacheOperation();
    stopShortCanvasPlayback();
    elements.preview_video.pause();
    cancelScheduledShortWorkspacePreview();
    releaseShortPreviewAdaptiveScaler();
    releaseShortPreviewFallbackSurface();
    releaseShortPreviewLayerVideos();
    releaseShortPreviewSourceAudio();
    releaseShortPreviewAssetCaches();

    const collection = normalizeShortFormWorkspaceCollection(
      collectionValue,
      syncedRoot.shortForm,
      syncedRoot.clips
    );
    const active = activeShortFormWorkspace(
      collection,
      syncedRoot.shortForm,
      syncedRoot.clips
    );
    rootProject = {
      ...syncedRoot,
      shortForm: active.shortForm,
      shortFormWorkspaces: collection,
      updatedAt: new Date().toISOString()
    };
    project = createShortFormWorkspaceProject(rootProject);
    const historyForWorkspace = shortWorkspaceHistory.get(active.id);
    undoStack = historyForWorkspace?.undo.map(cloneProject) || [];
    redoStack = historyForWorkspace?.redo.map(cloneProject) || [];
    fieldEditSession = null;
    activeClipId = SHORT_FORM_CANVAS_CLIP_ID;
    clipGroupSelection.clear();
    clearTimelineRangeSelection({ render: false });
    shortPreviewCacheError = "";
    updateShortWorkspaceUrl(true);
    renderAll();
    await flushSave();

    if (deletedWorkspace) {
      shortWorkspaceHistory.delete(deletedWorkspace.id);
      const cacheAssetIds = [
        ...deletedWorkspace.shortForm.videoAssets.map(({ id }) => id),
        ...deletedWorkspace.shortForm.sourceAudioAssets.map(({ id }) => (
          `source-audio-cache:${id}`
        ))
      ];
      await Promise.all(cacheAssetIds.map((assetId) => (
        deleteShortVideoCache(rootProject.id, assetId)
      )));
      scheduleImageAssetBlobPrune();
    }
    void prepareShortPreviewAssetCaches(
      rootProject,
      project.shortForm.videoAssets
    ).then(() => renderAll({ keepScroll: true })).catch((error: unknown) => {
      shortPreviewCacheError = errorDetails(error);
      renderShortFramingInspector();
    });
    showToast(announce, "success", 4800);
  } finally {
    shortWorkspaceTransitionPending = false;
    renderAll({ keepScroll: true });
  }
}

async function switchShortWorkspace(workspaceId: string): Promise<void> {
  const syncedRoot = syncRootProjectFromActiveWorkspace();
  const collection = activateShortFormWorkspace(
    syncedRoot.shortFormWorkspaces,
    syncedRoot.shortForm,
    workspaceId,
    syncedRoot.clips
  );
  const active = activeShortFormWorkspace(collection, syncedRoot.shortForm, syncedRoot.clips);
  await applyShortWorkspaceCollection(collection, {
    announce: `“${active.name}” 쇼츠 작업으로 전환했습니다.`
  });
}

async function createOrDuplicateShortWorkspace(duplicateActive: boolean): Promise<void> {
  const syncedRoot = syncRootProjectFromActiveWorkspace();
  const current = activeShortFormWorkspace(
    syncedRoot.shortFormWorkspaces,
    syncedRoot.shortForm,
    syncedRoot.clips
  );
  const id = `shorts-${crypto.randomUUID()}`;
  const collection = addShortFormWorkspace(
    syncedRoot.shortFormWorkspaces,
    syncedRoot.shortForm,
    {
      id,
      name: duplicateActive ? `${current.name} 복사본` : undefined,
      duplicateActive
    },
    syncedRoot.clips
  );
  const active = activeShortFormWorkspace(collection, syncedRoot.shortForm, syncedRoot.clips);
  await applyShortWorkspaceCollection(collection, {
    announce: duplicateActive
      ? `“${active.name}”을 만들었습니다. 원본 작업과 독립적으로 편집됩니다.`
      : `“${active.name}” 새 쇼츠 작업을 만들었습니다.`
  });
  elements.short_workspace_name.focus({ preventScroll: true });
  elements.short_workspace_name.select();
}

function commitShortWorkspaceName(): void {
  if (workspaceMode !== "short-form" || shortWorkspaceTransitionPending) {
    return;
  }
  const syncedRoot = syncRootProjectFromActiveWorkspace();
  const collection = renameShortFormWorkspace(
    syncedRoot.shortFormWorkspaces,
    syncedRoot.shortForm,
    currentShortWorkspaceId(),
    elements.short_workspace_name.value,
    syncedRoot.clips
  );
  const active = activeShortFormWorkspace(collection, syncedRoot.shortForm, syncedRoot.clips);
  rootProject = {
    ...syncedRoot,
    shortForm: active.shortForm,
    shortFormWorkspaces: collection,
    updatedAt: new Date().toISOString()
  };
  project = { ...project, shortFormWorkspaces: collection };
  renderShortWorkspaceProjectManager();
  scheduleSave();
}

async function deleteCurrentShortWorkspace(): Promise<void> {
  const syncedRoot = syncRootProjectFromActiveWorkspace();
  const collection = currentShortWorkspaceCollection();
  const current = activeShortFormWorkspace(collection, syncedRoot.shortForm, syncedRoot.clips);
  if (collection.workspaces.length <= 1) {
    showToast("마지막 쇼츠 작업은 삭제할 수 없습니다.", "error");
    return;
  }
  if (!window.confirm(
    `“${current.name}” 쇼츠 작업을 삭제할까요?\n이 작업의 자막·영상 배치·실행 취소 기록은 복구할 수 없습니다.`
  )) {
    return;
  }
  const next = deleteShortFormWorkspace(
    collection,
    syncedRoot.shortForm,
    current.id,
    syncedRoot.clips
  );
  await applyShortWorkspaceCollection(next, {
    announce: `“${current.name}” 쇼츠 작업을 삭제했습니다.`,
    deletedWorkspace: current
  });
}

function renderWorkspaceModeChrome(): void {
  const shortActive = workspaceMode === "short-form";
  const sourcePickerActive = Boolean(shortSourcePickerReturnState);
  const shortContextActive = shortActive || sourcePickerActive;
  const shortClipCount = shortActive
    ? project.shortForm.videoAssets.length
    : project.shortForm.videoAssets.length;
  elements.editor_shell.dataset.workspace = shortActive ? "short-form" : "main";
  elements.editor_shell.dataset.shortSourcePicker = String(sourcePickerActive);
  const propertyTabList = elements.caption_mode_tab.parentElement;
  if (propertyTabList) {
    propertyTabList.append(...(shortActive
      ? [
        elements.short_framing_mode_tab,
        elements.asset_mode_tab,
        elements.caption_mode_tab,
        elements.audio_mode_tab
      ]
      : [
        elements.caption_mode_tab,
        elements.asset_mode_tab,
        elements.audio_mode_tab,
        elements.short_framing_mode_tab
      ]));
  }
  elements.short_form_count.textContent = String(shortClipCount);
  elements.open_short_form.setAttribute(
    "aria-label",
    `쇼츠 편집기 열기, 현재 영상 조각 ${shortClipCount}개`
  );
  elements.workspace_mode_badge.hidden = !shortContextActive;
  elements.workspace_mode_badge.textContent = sourcePickerActive
    ? "쇼츠 영상 가져오기"
    : "쇼츠 전용 편집";
  elements.exit_short_form.hidden = !shortContextActive;
  elements.exit_short_form.title = sourcePickerActive
    ? "영상 가져오기를 취소하고 쇼츠 편집으로 돌아갑니다."
    : "현재 쇼츠 편집을 유지한 채 본편 편집으로 돌아갑니다.";
  elements.exit_short_form.setAttribute(
    "aria-label",
    sourcePickerActive
      ? "영상 가져오기를 취소하고 쇼츠 편집으로 돌아가기"
      : "본편 편집으로 돌아가기"
  );
  const exitShortTextNode = [...elements.exit_short_form.childNodes]
    .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  if (exitShortTextNode) {
    exitShortTextNode.textContent = sourcePickerActive
      ? " 쇼츠 편집으로"
      : " 본편 편집으로";
  }
  elements.open_short_form.hidden = shortContextActive;
  elements.start_short_source_composer.hidden = shortContextActive;
  elements.open_subtitle_sync_guide.hidden = !shortActive || sourcePickerActive;
  elements.start_short_source_composer.disabled = (
    shortActive
    || !mediaFile
    || !project.clips.some((clip) => clip.enabled !== false)
    || Boolean(activeJobController)
    || projectMutationLockCount > 0
  );
  elements.short_framing_mode_tab.hidden = !shortActive;
  // Normal short-form media is authored as one A/V asset. Keep the legacy
  // source-audio DOM available for project compatibility, but never expose a
  // second timeline row that suggests picture and original sound can drift.
  elements.source_audio_track_label.hidden = true;
  elements.source_audio_track.hidden = true;
  elements.short_workspace_preview.hidden = !shortActive;
  elements.short_workspace_safe_area_overlay.hidden = (
    !shortActive || !elements.short_workspace_safe_area.checked
  );
  elements.workspace_mode_title.textContent = shortActive
    ? "쇼츠 9:16 미리보기"
    : sourcePickerActive
      ? "쇼츠에 추가할 본편 영상 선택"
      : "편집 미리보기";
  const exportLabel = shortActive ? "쇼츠 내보내기" : "영상 내보내기";
  const exportTextNode = [...elements.export_video.childNodes]
    .find((node) => (
      node.nodeType === Node.TEXT_NODE
      && Boolean(node.textContent?.trim())
    ));
  if (exportTextNode) {
    exportTextNode.textContent = ` ${exportLabel}`;
  }
  const clipHeading = elements.clip_count.closest(".panel-heading")
    ?.querySelector("h2");
  if (clipHeading) {
    clipHeading.textContent = shortActive ? "쇼츠 화면" : "선택한 구간";
  }
  const clipIntro = elements.clip_count.closest(".clip-sidebar")
    ?.querySelector(".panel-intro");
  if (clipIntro) {
    clipIntro.textContent = shortActive
      ? project.clips.length > 0
        ? "하나의 쇼츠 화면에서 영상·사진·자막·음성을 서로 독립적으로 배치합니다."
        : "1080×1920 쇼츠 화면이 준비됐습니다. ‘본편 편집으로’에서 영상을 추가해 주세요."
      : "본편 컷 재생 순서입니다. 위에서 아래 순서로 이어서 재생되며, 범위는 자동으로 늘어나거나 줄어들지 않습니다.";
  }
}

function resetPropertyInspectorScroll(): void {
  const inspector = elements.inspector_title.closest(".inspector");
  if (inspector instanceof HTMLElement) {
    inspector.scrollTop = 0;
  }
}

function revealPropertyInspectorTarget(target: HTMLElement | null): void {
  const inspector = elements.inspector_title.closest(".inspector");
  if (!(inspector instanceof HTMLElement) || !target || target.hidden) {
    return;
  }
  const tabs = elements.caption_mode_tab.parentElement;
  const stickyOffset = tabs instanceof HTMLElement
    ? tabs.getBoundingClientRect().height + 12
    : 12;
  const inspectorRect = inspector.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const top = targetRect.top - inspectorRect.top + inspector.scrollTop - stickyOffset;
  inspector.scrollTo({
    top: Math.max(0, top),
    behavior: "smooth"
  });
}

function revealSelectedPropertyEditor(): void {
  const target = propertyInspectorMode === "caption"
    ? elements.cue_editor
    : propertyInspectorMode === "asset"
      ? elements.asset_editor
      : propertyInspectorMode === "audio"
        ? elements.audio_editor
        : propertyInspectorMode === "framing"
          ? elements.short_video_layer_controls
          : null;
  revealPropertyInspectorTarget(target);
}

function renderTimelineCollapseState(): void {
  elements.editor_shell.dataset.timelineCollapsed = String(timelineCollapsed);
  elements.timeline_grid.hidden = timelineCollapsed;
  elements.toggle_timeline_collapse.setAttribute(
    "aria-expanded",
    String(!timelineCollapsed)
  );
  elements.toggle_timeline_collapse.textContent = timelineCollapsed
    ? "펼치기"
    : "접기";
  elements.toggle_timeline_collapse.title = timelineCollapsed
    ? "타임라인 펼치기"
    : "타임라인 접기";
}

function renderAfterWorkspaceLayoutChange(): void {
  window.requestAnimationFrame(() => {
    renderTimeline({ keepScroll: true });
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
    renderShortWorkspaceTransformOverlay();
    scheduleShortWorkspacePreview();
  });
}

function rebaseMainWorkspaceHistory(
  snapshots: readonly EditorProject[],
  currentRootProject: EditorProject
): EditorProject[] {
  const targetOffsetMs = Math.round(
    Number(currentRootProject.broadcastSession?.alignmentOffsetMs) || 0
  );
  return snapshots.flatMap((snapshot) => {
    try {
      const snapshotOffsetMs = Math.round(
        Number(snapshot.broadcastSession?.alignmentOffsetMs) || 0
      );
      const alignedSnapshot = snapshotOffsetMs === targetOffsetMs
        ? snapshot
        : applyMediaAlignmentOffset(snapshot, targetOffsetMs);
      const siblingBoundSnapshot = {
        ...alignedSnapshot,
        source: { ...currentRootProject.source },
        broadcastSession: { ...currentRootProject.broadcastSession },
        shortForm: cloneProject(currentRootProject.shortForm),
        shortFormWorkspaces: cloneProject(
          currentRootProject.shortFormWorkspaces
        )
      };
      const transportBound = runtimeTransportBoundProjectSnapshot(
        siblingBoundSnapshot,
        currentRootProject.mediaAsset
      );
      return transportBound ? [transportBound] : [];
    } catch {
      return [];
    }
  });
}

function shortVideoCacheSourceFingerprint(
  asset: ShortFormSourceBackedAsset,
  parentProject: EditorProject
): string {
  const materialization = projectMaterialization(parentProject);
  const persistedManualFileIdentity = (() => {
    const candidate = parentProject.mediaAsset;
    const name = candidate?.name;
    const size = candidate?.size;
    const type = candidate?.type;
    const lastModified = candidate?.lastModified;
    if (
      typeof name !== "string"
      || name.length === 0
      || typeof size !== "number"
      || !Number.isSafeInteger(size)
      || size < 0
      || typeof type !== "string"
      || typeof lastModified !== "number"
      || !Number.isSafeInteger(lastModified)
      || lastModified < 0
    ) {
      return null;
    }
    return {
      mode: "manual-file",
      name,
      size,
      type,
      lastModified,
      contentSampleSha256: String(candidate?.contentSampleSha256 || "")
    };
  })();
  const materializedSourceVersionId = String(
    materialization?.source.sourceVersionId || ""
  ).trim();
  const sourceIdentity = materialization
    ? {
      mode: "materialized-vod",
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId: materializedSourceVersionId,
      ...(materializedSourceVersionId
        ? {}
        : { planFingerprint: materialization.planFingerprint })
    }
    : persistedManualFileIdentity || (mediaFile instanceof File
      ? {
        mode: "manual-file",
        name: mediaFile.name,
        size: mediaFile.size,
        type: mediaFile.type,
        lastModified: mediaFile.lastModified,
        contentSampleSha256: String(
          parentProject.mediaAsset?.contentSampleSha256 || ""
        )
      }
      : {
        mode: "unbound",
        platform: String(parentProject.source?.platform || ""),
        contentId: String(parentProject.source?.contentId || "")
      });
  return JSON.stringify({
    schema: "kirinuki-short-preview-source/v1",
    workspaceId: normalizeShortFormWorkspaceCollection(
      parentProject.shortFormWorkspaces,
      parentProject.shortForm,
      parentProject.clips
    ).activeWorkspaceId,
    source: sourceIdentity,
    lineage: asset.sourceClipId,
    sourceSelectionStartMs: asset.sourceSelectionStartMs,
    sourceSelectionEndMs: asset.sourceSelectionEndMs
  });
}

function shortPreviewCacheVideoAssetForSourceAudio(
  asset: ShortFormSourceAudioAsset,
  parentProject: EditorProject
): ShortFormVideoAsset {
  const referenceWidth = Math.max(
    2,
    Math.round(Number(parentProject.mediaAsset?.width) || 1920)
  );
  const referenceHeight = Math.max(
    2,
    Math.round(Number(parentProject.mediaAsset?.height) || 1080)
  );
  return {
    id: `source-audio-cache:${asset.id}`,
    sourceAssetId: asset.sourceAssetId,
    sourceClipId: asset.sourceClipId,
    sourceSelectionStartMs: asset.sourceSelectionStartMs,
    sourceSelectionEndMs: asset.sourceSelectionEndMs,
    sourceStartMs: asset.sourceStartMs,
    sourceEndMs: asset.sourceEndMs,
    timelineStartMs: 0,
    timelineEndMs: asset.sourceEndMs - asset.sourceStartMs,
    sourceRect: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      referenceWidth,
      referenceHeight
    },
    destinationRect: {
      x: 0,
      y: 0,
      width: SHORT_FORM_OUTPUT_WIDTH,
      height: SHORT_FORM_OUTPUT_HEIGHT
    },
    opacity: 1,
    visible: true,
    zIndex: 0,
    lane: 0,
    audioGain: asset.gain
  };
}

function shortPreviewCacheForSourceAudioAsset(
  asset: ShortFormSourceAudioAsset,
  parentProject: EditorProject
): ShortPreviewAssetCacheState | null {
  return [...shortPreviewAssetCaches.values()].find((cache) => (
    cache.hasAudio
    &&
    shortPreviewAssetCacheMatches(cache, asset, parentProject)
  )) || null;
}

function shortPreviewAssetCacheIdentityMatches(
  cache: Pick<ShortPreviewAssetCacheState, "sourceFingerprint">,
  asset: ShortFormSourceBackedAsset,
  parentProject: EditorProject
): boolean {
  return cache.sourceFingerprint
    === shortVideoCacheSourceFingerprint(asset, parentProject);
}

function shortPreviewAssetCacheMatches(
  cache: Pick<
    ShortPreviewAssetCacheState,
    "sourceStartMs" | "sourceEndMs" | "sourceFingerprint"
  > & { hasAudio?: boolean },
  asset: ShortFormSourceBackedAsset,
  parentProject: EditorProject
): boolean {
  return (
    shortPreviewAssetCacheIdentityMatches(cache, asset, parentProject)
    && shortPreviewCacheCoverageContainsRange(cache, asset)
  );
}

function shortPreviewVideoAssetCacheMatches(
  cache: Pick<
    ShortPreviewAssetCacheState,
    "sourceStartMs" | "sourceEndMs" | "sourceFingerprint"
  > & { hasAudio?: boolean },
  asset: ShortFormVideoAsset,
  parentProject: EditorProject
): boolean {
  const cacheMatches = shortPreviewAssetCacheMatches(
    cache,
    asset,
    parentProject
  );
  if (parentProject.mediaAsset?.hasAudio !== true) {
    return cacheMatches;
  }
  return shortPreviewCombinedAvCacheReady({
    cacheMatches,
    cacheCoversSourceTime: true,
    cacheHasAudio: cache.hasAudio === true
  });
}

function shortPreviewSourceCachesReadyAtTimeline(
  parentProject: EditorProject,
  shortForm: EditorProject["shortForm"],
  timelineMsValue: unknown
): boolean {
  const timelineMs = Math.max(
    0,
    Math.min(shortForm.durationMs, Number(timelineMsValue) || 0)
  );
  const visibleVideoAssets = shortFormVideoAssetsAtTimeline(
    shortForm,
    timelineMs
  ).filter((asset) => asset.visible && asset.opacity > 0);
  const videoCachesReady = visibleVideoAssets.every((asset) => {
    const cache = shortPreviewAssetCaches.get(asset.id);
    return Boolean(
      cache
      && shortPreviewVideoAssetCacheMatches(cache, asset, parentProject)
      && shortPreviewCacheCoverageContainsTime(cache, asset.sourceTimeMs)
    );
  });
  const sourceAudioAsset = shortPreviewIndependentSourceAudioAssets(
    shortForm
  ).find((asset) => (
    timelineMs >= asset.timelineStartMs
    && timelineMs < asset.timelineEndMs
  ));
  return videoCachesReady && (
    !sourceAudioAsset
    || Boolean(shortPreviewCacheForSourceAudioAsset(
      sourceAudioAsset,
      parentProject
    ))
  );
}

function releaseShortPreviewAssetCache(assetId: string): void {
  const state = shortPreviewAssetCaches.get(assetId);
  if (!state) {
    return;
  }
  if (shortPreviewSourceAudioState?.mediaUrl === state.objectUrl) {
    releaseShortPreviewSourceAudio();
  }
  releaseShortPreviewLayerVideo(assetId);
  URL.revokeObjectURL(state.objectUrl);
  shortPreviewAssetCaches.delete(assetId);
}

function releaseShortPreviewAssetCaches(
  keepAssetIds?: ReadonlySet<string>
): void {
  for (const assetId of [...shortPreviewAssetCaches.keys()]) {
    if (!keepAssetIds?.has(assetId)) {
      releaseShortPreviewAssetCache(assetId);
    }
  }
}

function installShortPreviewAssetCache(
  record: ShortVideoCacheRecord
): ShortPreviewAssetCacheState {
  releaseShortPreviewAssetCache(record.assetId);
  const state: ShortPreviewAssetCacheState = {
    assetId: record.assetId,
    objectUrl: URL.createObjectURL(record.blob),
    sourceStartMs: record.sourceStartMs,
    sourceEndMs: record.sourceEndMs,
    mediaOffsetMs: Math.max(0, Number(record.mediaOffsetMs) || 0),
    hasAudio: record.hasAudio === true,
    sourceFingerprint: record.sourceFingerprint,
    sizeBytes: record.sizeBytes
  };
  shortPreviewAssetCaches.set(record.assetId, state);
  return state;
}

function shortVideoCacheRenderProject(
  asset: ShortFormVideoAsset,
  parentProject: EditorProject,
  coverage = initialShortPreviewCacheCoverage(asset)
): EditorProject {
  const anchor = vodSourceAnchorForShortAsset(
    asset,
    parentProject,
    parentProject
  );
  const cacheAsset = {
    ...asset,
    sourceStartMs: coverage.sourceStartMs,
    sourceEndMs: coverage.sourceEndMs,
    timelineStartMs: 0,
    timelineEndMs: coverage.sourceEndMs - coverage.sourceStartMs
  };
  const logicalClip = {
    ...shortFormSourceAssetVirtualClip(cacheAsset, anchor),
    timelineStartMs: 0
  };
  const mappedClip = {
    ...clipForMediaEngine(logicalClip, parentProject),
    id: `short-preview-cache-${asset.id}`,
    timelineStartMs: 0,
    enabled: true
  };
  return {
    ...cloneProject(parentProject),
    name: `${parentProject.name} · 쇼츠 미리보기 ${asset.id}`,
    clips: [mappedClip],
    subtitles: [],
    imageAssets: [],
    audioRegions: [],
    selectedClipId: mappedClip.id,
    selectedImageAssetId: null,
    selectedCueId: null,
    selectedAudioRegionId: null,
    playheadMs: 0,
    updatedAt: new Date().toISOString()
  };
}

async function renderAndStoreShortPreviewAssetCache(
  asset: ShortFormVideoAsset,
  parentProject: EditorProject,
  sourceMedia: EditorMediaSource,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  currentCoverage: Pick<ShortVideoCacheRecord, "sourceStartMs" | "sourceEndMs"> | null = null
): Promise<ShortVideoCacheRecord> {
  if (!sourceMedia || !materializedMediaBindingIsValid(parentProject)) {
    throw new Error("쇼츠 영상 미리보기를 만들 원본이 연결되지 않았습니다.");
  }
  const coverage = nextShortPreviewCacheCoverage(asset, currentCoverage);
  const cacheProject = shortVideoCacheRenderProject(
    asset,
    parentProject,
    coverage
  );
  const sourceFingerprint = shortVideoCacheSourceFingerprint(
    asset,
    parentProject
  );
  let copied: Awaited<ReturnType<typeof copySingleClipPacketsForPreview>> = null;
  if (!shortPreviewPacketCopyBlacklist.has(sourceFingerprint)) {
    try {
      copied = await copySingleClipPacketsForPreview(sourceMedia, cacheProject, {
        signal,
        onProgress: (progress) => onProgress(Math.max(0, Math.min(1, progress)))
      });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      console.warn(
        "원본 압축 패킷을 그대로 복사할 수 없어 브라우저 변환으로 전환합니다.",
        error
      );
    }
  }
  const result = copied || await renderProjectVideo(sourceMedia, cacheProject, {
    resolutionPolicy: "source-quality-cache",
    signal,
    onProgress: (progress) => onProgress(Math.max(0, Math.min(1, progress)))
  });
  if (!result.blob || result.blob.size <= 0) {
    throw new Error("쇼츠 영상 미리보기 파일이 생성되지 않았습니다.");
  }
  const mimeType = String(result.blob.type || result.mimeType || "").trim();
  if (!mimeType.startsWith("video/")) {
    throw new Error("쇼츠 영상 미리보기 파일 형식이 올바르지 않습니다.");
  }
  signal.throwIfAborted();
  if (mediaFile !== sourceMedia) {
    throw new DOMException("쇼츠 미리보기 원본이 교체되었습니다.", "AbortError");
  }
  const hasAudio = copied
    ? copied.hasAudio
    : "audioCodec" in result && result.audioCodec !== null;
  if (parentProject.mediaAsset?.hasAudio === true && !hasAudio) {
    throw new Error("쇼츠 미리보기 복사본에서 원본 음성 트랙이 누락되었습니다.");
  }
  return saveShortVideoCache({
    projectId: parentProject.id,
    assetId: asset.id,
    blob: result.blob,
    sourceStartMs: coverage.sourceStartMs,
    sourceEndMs: coverage.sourceEndMs,
    mediaOffsetMs: copied?.mediaOffsetMs ?? 0,
    hasAudio,
    sourceFingerprint,
    mimeType,
    sizeBytes: result.blob.size,
    createdAt: new Date().toISOString()
  });
}

async function prepareShortPreviewAssetCaches(
  inputParentProject: EditorProject,
  inputAssets: readonly ShortFormVideoAsset[]
): Promise<void> {
  const generation = ++shortPreviewCacheGeneration;
  shortPreviewCacheController?.abort();
  const previousOperation = shortPreviewCacheOperation;
  const controller = new AbortController();
  shortPreviewCacheController = controller;
  const sourceMedia = mediaFile;
  const parentProject = cloneProject(inputParentProject);
  const assets = inputAssets.map((asset) => structuredClone(asset));
  const assertCurrentRequest = () => {
    controller.signal.throwIfAborted();
    if (
      generation !== shortPreviewCacheGeneration
      || mediaFile !== sourceMedia
    ) {
      throw new DOMException(
        "쇼츠 미리보기 준비 요청이 더 최신 상태로 교체되었습니다.",
        "AbortError"
      );
    }
  };

  const operation = (async () => {
    if (previousOperation) {
      await previousOperation.catch(() => undefined);
    }
    assertCurrentRequest();
    const pending: Array<{
      asset: ShortFormVideoAsset;
      requiresAudio: boolean;
      currentCoverage: Pick<
        ShortPreviewAssetCacheState,
        "sourceStartMs" | "sourceEndMs"
      > | null;
    }> = [];
    const activeAssetIds = new Set(assets.map((asset) => asset.id));
    const retainedAssetIds = new Set(activeAssetIds);
    const activeSourceAudioAssets = shortPreviewIndependentSourceAudioAssets(
      parentProject.shortForm
    );
    if (
      activeSourceAudioAssets.length > 0
      && parentProject.mediaAsset?.hasAudio !== true
    ) {
      throw new Error(
        "현재 연결한 원본에는 음성 트랙이 없어 쇼츠 원본 음성을 준비할 수 없습니다."
      );
    }
    const retainedSourceAudioAssets: ShortFormSourceAudioAsset[] = [
      ...activeSourceAudioAssets
    ];
    const retainFromProject = (snapshot: EditorProject | null | undefined) => {
      for (const asset of snapshot?.shortForm?.videoAssets || []) {
        retainedAssetIds.add(asset.id);
      }
      retainedSourceAudioAssets.push(
        ...(snapshot?.shortForm?.sourceAudioAssets || [])
      );
      const collection = snapshot
        ? normalizeShortFormWorkspaceCollection(
          snapshot.shortFormWorkspaces,
          snapshot.shortForm,
          snapshot.clips
        )
        : null;
      for (const workspace of collection?.workspaces || []) {
        for (const asset of workspace.shortForm.videoAssets) {
          retainedAssetIds.add(asset.id);
        }
        for (const asset of workspace.shortForm.sourceAudioAssets) {
          retainedSourceAudioAssets.push(asset);
          retainedAssetIds.add(`source-audio-cache:${asset.id}`);
        }
      }
    };
    retainFromProject(parentProject);
    for (const snapshot of [
      ...undoStack,
      ...redoStack,
      ...mainWorkspaceUndoStack,
      ...mainWorkspaceRedoStack
    ]) {
      retainFromProject(snapshot);
    }
    if (shortSourcePickerReturnState) {
      retainFromProject(shortSourcePickerReturnState.workspaceProject);
      for (const snapshot of [
        ...shortSourcePickerReturnState.undoStack,
        ...shortSourcePickerReturnState.redoStack
      ]) {
        retainFromProject(snapshot);
      }
    }

    // A source-audio asset deliberately remains independent when its visual
    // video is deleted. Its audio should keep using the same small local media
    // copy instead of falling back to seeking the full long-form source. Cache
    // records are therefore retained by exact source fingerprint as well as by
    // the visual asset id (including undo/redo snapshots).
    let storedCaches: ShortVideoCacheRecord[] = [];
    let cacheInventoryComplete = true;
    try {
      storedCaches = await listShortVideoCaches(parentProject.id);
      assertCurrentRequest();
    } catch (error) {
      if (controller.signal.aborted || generation !== shortPreviewCacheGeneration) {
        return;
      }
      cacheInventoryComplete = false;
      console.warn(
        "쇼츠 캐시 전체 목록을 검증하지 못해 기존 캐시를 보존합니다.",
        error
      );
    }
    assertCurrentRequest();
    const activeCacheAssetIds = new Set(activeAssetIds);
    const cacheMatchesAnySourceAudio = (
      cache: Pick<
        ShortPreviewAssetCacheState,
        "sourceStartMs" | "sourceEndMs" | "sourceFingerprint"
      > & { hasAudio?: boolean },
      sourceAudioAssets: readonly ShortFormSourceAudioAsset[]
    ) => cache.hasAudio && sourceAudioAssets.some((asset) => (
      shortPreviewAssetCacheMatches(cache, asset, parentProject)
    ));
    for (const [cacheAssetId, cache] of shortPreviewAssetCaches) {
      if (cacheMatchesAnySourceAudio(cache, activeSourceAudioAssets)) {
        activeCacheAssetIds.add(cacheAssetId);
      }
      if (cacheMatchesAnySourceAudio(cache, retainedSourceAudioAssets)) {
        retainedAssetIds.add(cacheAssetId);
      }
    }
    for (const stored of storedCaches) {
      if (cacheMatchesAnySourceAudio(stored, retainedSourceAudioAssets)) {
        retainedAssetIds.add(stored.assetId);
      }
      if (cacheMatchesAnySourceAudio(stored, activeSourceAudioAssets)) {
        activeCacheAssetIds.add(stored.assetId);
        if (!shortPreviewAssetCaches.has(stored.assetId)) {
          installShortPreviewAssetCache(stored);
        }
      }
    }
    releaseShortPreviewAssetCaches(activeCacheAssetIds);
    for (const asset of assets) {
      const memoryCache = shortPreviewAssetCaches.get(asset.id);
      if (
        memoryCache
        && shortPreviewVideoAssetCacheMatches(memoryCache, asset, parentProject)
      ) {
        continue;
      }
      const reusableMemoryCache = (
        memoryCache
        && shortPreviewAssetCacheIdentityMatches(
          memoryCache,
          asset,
          parentProject
        )
      ) ? memoryCache : null;
      if (memoryCache && !reusableMemoryCache) {
        releaseShortPreviewAssetCache(asset.id);
      }
      let stored: ShortVideoCacheRecord | null = null;
      try {
        stored = await loadShortVideoCache(parentProject.id, asset.id);
        assertCurrentRequest();
      } catch (error) {
        if (controller.signal.aborted || generation !== shortPreviewCacheGeneration) {
          return;
        }
        console.warn("손상된 쇼츠 미리보기 캐시를 다시 만듭니다.", error);
      }
      if (
        stored
        && shortPreviewVideoAssetCacheMatches(stored, asset, parentProject)
      ) {
        installShortPreviewAssetCache(stored);
      } else {
        const reusableStoredCache = (
          stored
          && shortPreviewAssetCacheIdentityMatches(
            stored,
            asset,
            parentProject
          )
        ) ? stored : null;
        const currentCoverage = [reusableMemoryCache, reusableStoredCache]
          .filter((cache): cache is (
            ShortPreviewAssetCacheState | ShortVideoCacheRecord
          ) => Boolean(cache))
          .sort((left, right) => (
            (right.sourceEndMs - right.sourceStartMs)
            - (left.sourceEndMs - left.sourceStartMs)
          ))[0] || null;
        pending.push({
          asset,
          currentCoverage,
          requiresAudio: parentProject.mediaAsset?.hasAudio === true
        });
      }
    }
    for (const sourceAudioAsset of activeSourceAudioAssets) {
      if (shortPreviewCacheForSourceAudioAsset(sourceAudioAsset, parentProject)) {
        continue;
      }
      const coveringPending = pending.find(({
        asset: candidate,
        currentCoverage
      }) => (
        shortPreviewAssetCacheMatches(
          {
            ...nextShortPreviewCacheCoverage(candidate, currentCoverage),
            hasAudio: true,
            sourceFingerprint: shortVideoCacheSourceFingerprint(
              candidate,
              parentProject
            )
          },
          sourceAudioAsset,
          parentProject
        )
      ));
      if (coveringPending) {
        coveringPending.requiresAudio = true;
        continue;
      }
      const audioCacheAsset = shortPreviewCacheVideoAssetForSourceAudio(
        sourceAudioAsset,
        parentProject
      );
      const reusableAudioCache = [
        ...shortPreviewAssetCaches.values(),
        ...storedCaches
      ].find((cache) => (
        cache.hasAudio === true
        && shortPreviewAssetCacheIdentityMatches(
          cache,
          audioCacheAsset,
          parentProject
        )
      )) || null;
      pending.push({
        asset: audioCacheAsset,
        requiresAudio: true,
        currentCoverage: reusableAudioCache
      });
      activeCacheAssetIds.add(audioCacheAsset.id);
      retainedAssetIds.add(audioCacheAsset.id);
    }
    if (pending.length === 0) {
      if (cacheInventoryComplete) {
        await pruneShortVideoCaches(parentProject.id, retainedAssetIds);
        assertCurrentRequest();
      }
      shortPreviewCacheError = "";
      return;
    }
    if (activeJobController || projectMutationLockCount > 0) {
      throw new Error("다른 미디어 작업이 끝난 뒤 쇼츠 영상 복사본을 준비해 주세요.");
    }

    assertCurrentRequest();
    shortPreviewCacheError = "";
    shortPreviewCacheProgressLabel =
      `영상 0/${pending.length} · 이 기기에서 미리보기 준비 시작`;
    if (workspaceMode === "short-form") {
      renderShortFramingInspector();
    }
    const completedRecords: ShortVideoCacheRecord[] = [];
    try {
      for (const [index, {
        asset,
        currentCoverage,
        requiresAudio
      }] of pending.entries()) {
        assertCurrentRequest();
        const reusableRecord = [...completedRecords, ...storedCaches].find(
          (candidate) => shortPreviewAssetCacheMatches(
            candidate,
            asset,
            parentProject
          ) && (!requiresAudio || candidate.hasAudio === true)
        );
        const record = reusableRecord
          ? await saveShortVideoCache({
            projectId: parentProject.id,
            assetId: asset.id,
            blob: reusableRecord.blob,
            sourceStartMs: reusableRecord.sourceStartMs,
            sourceEndMs: reusableRecord.sourceEndMs,
            mediaOffsetMs: reusableRecord.mediaOffsetMs ?? 0,
            hasAudio: reusableRecord.hasAudio === true,
            sourceFingerprint: shortVideoCacheSourceFingerprint(
              asset,
              parentProject
            ),
            mimeType: reusableRecord.mimeType,
            sizeBytes: reusableRecord.sizeBytes,
            createdAt: new Date().toISOString()
          })
          : await renderAndStoreShortPreviewAssetCache(
            asset,
            parentProject,
            sourceMedia!,
            controller.signal,
            (assetProgress) => {
              shortPreviewCacheProgressLabel =
                `영상 ${index + 1}/${pending.length} · ${Math.round(assetProgress * 100)}% · 이 기기에서 미리보기 준비 중`;
            },
            currentCoverage
          );
        assertCurrentRequest();
        completedRecords.push(record);
        const currentParent = workspaceMode === "short-form"
          ? rootProject
          : project;
        const currentVideoAsset = currentParent.shortForm.videoAssets.find(
          (candidate) => candidate.id === record.assetId
        );
        const sourceAudioAssetId = record.assetId.startsWith("source-audio-cache:")
          ? record.assetId.slice("source-audio-cache:".length)
          : "";
        const currentSourceAudioAsset = sourceAudioAssetId
          ? currentParent.shortForm.sourceAudioAssets.find(
            (candidate) => candidate.id === sourceAudioAssetId
          )
          : null;
        const currentAsset = currentVideoAsset || (
          currentSourceAudioAsset
            ? shortPreviewCacheVideoAssetForSourceAudio(
              currentSourceAudioAsset,
              currentParent
            )
            : null
        );
        if (
          currentAsset
          && (
            currentVideoAsset
              ? shortPreviewVideoAssetCacheMatches(
                record,
                currentVideoAsset,
                currentParent
              )
              : shortPreviewAssetCacheMatches(
                record,
                currentAsset,
                currentParent
              )
          )
        ) {
          installShortPreviewAssetCache(record);
        }
      }
      if (cacheInventoryComplete) {
        await pruneShortVideoCaches(parentProject.id, retainedAssetIds);
        assertCurrentRequest();
      }
      shortPreviewCacheProgressLabel =
        `영상 ${pending.length}개 미리보기 준비 완료`;
    } catch (error) {
      if (
        controller.signal.aborted
        || generation !== shortPreviewCacheGeneration
        || errorName(error) === "AbortError"
      ) {
        return;
      }
      shortPreviewCacheError = errorDetails(error);
      throw error;
    } finally {
      if (shortPreviewCacheController === controller) {
        shortPreviewCacheController = null;
      }
    }
  })();
  shortPreviewCacheOperation = operation;
  try {
    await operation;
  } catch (error) {
    if (
      controller.signal.aborted
      || generation !== shortPreviewCacheGeneration
      || errorName(error) === "AbortError"
    ) {
      return;
    }
    shortPreviewCacheError = errorDetails(error);
    throw error;
  } finally {
    if (shortPreviewCacheOperation === operation) {
      shortPreviewCacheOperation = null;
      if (generation === shortPreviewCacheGeneration) {
        shortPreviewCacheProgressLabel = "";
      }
      if (
        generation === shortPreviewCacheGeneration
        && workspaceMode === "short-form"
      ) {
        renderShortFramingInspector();
      }
    }
  }
}

async function cancelAndWaitForShortPreviewCacheOperation(): Promise<void> {
  const cancellationGeneration = ++shortPreviewCacheGeneration;
  shortPreviewCacheController?.abort();
  const operation = shortPreviewCacheOperation;
  await operation?.catch(() => undefined);
  if (cancellationGeneration !== shortPreviewCacheGeneration) {
    return;
  }
  shortPreviewCacheController = null;
  shortPreviewCacheProgressLabel = "";
  shortPreviewCacheError = "";
}

function invalidateShortPreviewCacheOperation(): void {
  shortPreviewCacheGeneration += 1;
  shortPreviewCacheController?.abort();
}

function scheduleShortPreviewCacheRepair(): void {
  if (
    shortPreviewCacheRepairScheduled
    || workspaceMode !== "short-form"
    || shortPreviewCacheOperation
    || shortPreviewCacheError
  ) {
    return;
  }
  shortPreviewCacheRepairScheduled = true;
  setTimeout(() => {
    shortPreviewCacheRepairScheduled = false;
    if (
      workspaceMode !== "short-form"
      || shortPreviewCacheOperation
      || shortPreviewCacheError
      || activeJobController
      || projectMutationLockCount > 0
    ) {
      return;
    }
    void prepareShortPreviewAssetCaches(
      rootProject,
      project.shortForm.videoAssets
    ).then(() => {
      renderAll({ keepScroll: true });
    }).catch((error: unknown) => {
      shortPreviewCacheError = errorDetails(error);
      renderShortFramingInspector();
    });
  }, 0);
}

async function retryShortPreviewAssetCaches(): Promise<void> {
  if (
    workspaceMode !== "short-form"
    || shortPreviewCacheOperation
    || activeJobController
    || projectMutationLockCount > 0
  ) {
    showToast("다른 미디어 작업이 끝난 뒤 미리보기를 다시 만들어 주세요.");
    return;
  }
  const generation = ++shortPreviewCacheGeneration;
  shortPreviewCacheController?.abort();
  const controller = new AbortController();
  shortPreviewCacheController = controller;
  const sourceMedia = mediaFile;
  const projectId = project.id;
  const parentProject = cloneProject(rootProject);
  const assets = project.shortForm.videoAssets.map((asset) => (
    structuredClone(asset)
  ));
  const activeSourceAssets: ShortFormSourceBackedAsset[] = [
    ...assets,
    ...parentProject.shortForm.sourceAudioAssets
  ];
  const cacheAssetIdsToDelete = new Set(assets.map((asset) => asset.id));
  for (const sourceAudioAsset of parentProject.shortForm.sourceAudioAssets) {
    cacheAssetIdsToDelete.add(
      shortPreviewCacheVideoAssetForSourceAudio(
        sourceAudioAsset,
        parentProject
      ).id
    );
  }
  const assertCurrentRetry = () => {
    controller.signal.throwIfAborted();
    if (
      generation !== shortPreviewCacheGeneration
      || workspaceMode !== "short-form"
      || project.id !== projectId
      || mediaFile !== sourceMedia
    ) {
      throw new DOMException(
        "쇼츠 미리보기 재생성 요청이 더 최신 상태로 교체되었습니다.",
        "AbortError"
      );
    }
  };
  const operation = (async () => {
    assertCurrentRetry();
    try {
      for (const record of await listShortVideoCaches(projectId)) {
        assertCurrentRetry();
        if (activeSourceAssets.some((asset) => (
          shortPreviewAssetCacheMatches(record, asset, parentProject)
        ))) {
          cacheAssetIdsToDelete.add(record.assetId);
        }
      }
    } catch (error) {
      assertCurrentRetry();
      console.warn("재생성할 쇼츠 캐시 목록 일부를 읽지 못했습니다.", error);
    }
    assertCurrentRetry();
    releaseShortPreviewLayerVideos();
    releaseShortPreviewAssetCaches();
    await Promise.all(
      [...cacheAssetIdsToDelete].map((assetId) => (
        deleteShortVideoCache(projectId, assetId)
      ))
    );
    assertCurrentRetry();
  })();
  shortPreviewCacheOperation = operation;
  shortPreviewCacheProgressLabel = "기존 로컬 미리보기 정리 중";
  renderShortFramingInspector();
  try {
    await operation;
  } catch (error) {
    if (
      controller.signal.aborted
      || generation !== shortPreviewCacheGeneration
      || errorName(error) === "AbortError"
    ) {
      return;
    }
    throw error;
  } finally {
    if (shortPreviewCacheController === controller) {
      shortPreviewCacheController = null;
    }
    if (shortPreviewCacheOperation === operation) {
      shortPreviewCacheOperation = null;
      shortPreviewCacheProgressLabel = "";
    }
  }
  assertCurrentRetry();
  shortPreviewCacheError = "";
  await prepareShortPreviewAssetCaches(parentProject, assets);
  renderAll({ keepScroll: true });
  showToast("쇼츠 영상 미리보기를 다시 만들었습니다.", "success");
}

function upgradeLegacyShortFormGeometry(
  parentProject: EditorProject
): { project: EditorProject; upgradedCount: number } {
  // normalizeEditorProject already migrates v1-v5 scenes into exact v6 video
  // asset rectangles. Keeping migration out of the view avoids reintroducing
  // a privileged base video after the black canvas has opened.
  return { project: parentProject, upgradedCount: 0 };
}

async function enterShortFormWorkspace(): Promise<boolean> {
  if (workspaceMode === "short-form") {
    return true;
  }
  if (shortSourceComposerActive) {
    cancelShortSourceComposer({ render: false });
  }
  elements.preview_video.pause();
  stopShortCanvasPlayback({ keepCurrentTime: false });
  await flushSave();
  await waitForProjectSaves();
  rootProject = cloneProject(project);
  const upgraded = upgradeLegacyShortFormGeometry(rootProject);
  rootProject = upgraded.project;
  const requestedWorkspaceId = new URLSearchParams(location.search).get("short");
  if (requestedWorkspaceId) {
    try {
      const collection = activateShortFormWorkspace(
        rootProject.shortFormWorkspaces,
        rootProject.shortForm,
        requestedWorkspaceId,
        rootProject.clips
      );
      const active = activeShortFormWorkspace(
        collection,
        rootProject.shortForm,
        rootProject.clips
      );
      rootProject = {
        ...rootProject,
        shortForm: active.shortForm,
        shortFormWorkspaces: collection
      };
    } catch {
      // A stale/deleted URL identity falls back to the persisted active Short.
    }
  }
  mainWorkspaceUndoStack = undoStack;
  mainWorkspaceRedoStack = redoStack;
  project = createShortFormWorkspaceProject(rootProject);
  workspaceMode = "short-form";
  const entryUndoHistory = pendingShortWorkspaceUndoHistory;
  pendingShortWorkspaceUndoHistory = null;
  const workspaceHistory = shortWorkspaceHistory.get(currentShortWorkspaceId());
  undoStack = entryUndoHistory?.map(cloneProject)
    || workspaceHistory?.undo.map(cloneProject)
    || [];
  redoStack = entryUndoHistory
    ? []
    : workspaceHistory?.redo.map(cloneProject) || [];
  fieldEditSession = null;
  propertyInspectorMode = "framing";
  activeClipId = project.selectedClipId || project.clips[0]?.id || null;
  clipGroupSelection.clear();
  clearTimelineRangeSelection({ render: false });
  updateShortWorkspaceUrl(true);
  renderAll();
  void prepareShortPreviewAssetCaches(
    rootProject,
    project.shortForm.videoAssets
  ).then(() => {
    renderAll({ keepScroll: true });
  }).catch((error: unknown) => {
    shortPreviewCacheError = errorDetails(error);
    renderShortFramingInspector();
  });
  if (project.clips.length > 0 && mediaFile) {
    await seekTimeline(project.playheadMs || 0);
  }
  resetPropertyInspectorScroll();
  elements.exit_short_form.focus({ preventScroll: true });
  showToast(
    upgraded.upgradedCount > 0
      ? `기존 쇼츠 ${upgraded.upgradedCount}개를 픽셀 편집 방식으로 변환했습니다. 화면 모양은 그대로 유지됩니다.`
      : "쇼츠 편집을 열었습니다. 영상·사진·자막·음성은 이 쇼츠 작업 안에서 함께 저장됩니다.",
    "success",
    5200
  );
  return true;
}

async function exitShortFormWorkspace({
  render = true,
  announce = true,
  updateUrl = true
}: {
  render?: boolean;
  announce?: boolean;
  updateUrl?: boolean;
} = {}): Promise<void> {
  if (workspaceMode !== "short-form") {
    return;
  }
  stopShortCanvasPlayback();
  elements.preview_video.pause();
  cancelScheduledShortWorkspacePreview();
  releaseShortPreviewAdaptiveScaler();
  releaseShortPreviewFallbackSurface();
  releaseShortPreviewLayerVideos();
  releaseShortPreviewSourceAudio();
  saveCurrentShortWorkspaceHistory();
  await flushSave();
  await waitForProjectSaves();
  const restoredRoot = cloneProject(rootProject);
  const restoredMainUndoStack = rebaseMainWorkspaceHistory(
    mainWorkspaceUndoStack,
    restoredRoot
  );
  const restoredMainRedoStack = rebaseMainWorkspaceHistory(
    mainWorkspaceRedoStack,
    restoredRoot
  );
  project = restoredRoot;
  rootProject = restoredRoot;
  workspaceMode = "main";
  undoStack = restoredMainUndoStack;
  redoStack = restoredMainRedoStack;
  mainWorkspaceUndoStack = [];
  mainWorkspaceRedoStack = [];
  shortWorkspaceHistory.clear();
  fieldEditSession = null;
  propertyInspectorMode = "caption";
  activeClipId = project.selectedClipId || project.clips[0]?.id || null;
  clipGroupSelection.clear();
  clearTimelineRangeSelection({ render: false });
  if (updateUrl) {
    updateShortWorkspaceUrl(false);
  }
  if (render) {
    renderAll();
  }
  if (render && project.clips.length > 0 && mediaFile) {
    await seekTimeline(project.playheadMs || 0);
  }
  if (render) {
    resetPropertyInspectorScroll();
    elements.open_short_form.focus({ preventScroll: true });
  }
  if (announce) {
    showToast("쇼츠 편집을 저장하고 본편 편집으로 돌아왔습니다.", "success");
  }
  if (render) {
  }
}

async function restoreShortWorkspaceAfterSourcePicker(): Promise<void> {
  const state = shortSourcePickerReturnState;
  if (!state) {
    cancelShortSourceComposer();
    return;
  }
  cancelShortSourceComposer({ render: false });
  elements.preview_video.pause();
  mainWorkspaceUndoStack = undoStack.map(cloneProject);
  mainWorkspaceRedoStack = redoStack.map(cloneProject);
  project = cloneProject(state.workspaceProject);
  rootProject = cloneProject(state.rootProject);
  workspaceMode = "short-form";
  undoStack = state.undoStack.map(cloneProject);
  redoStack = state.redoStack.map(cloneProject);
  shortSourcePickerReturnState = null;
  fieldEditSession = null;
  propertyInspectorMode = "framing";
  activeClipId = project.selectedClipId || SHORT_FORM_CANVAS_CLIP_ID;
  clipGroupSelection.clear();
  clearTimelineRangeSelection({ render: false });
  updateShortWorkspaceUrl(true);
  renderAll();
  if (project.clips.length > 0 && mediaFile) {
    await seekTimeline(project.playheadMs || 0);
  }
  resetPropertyInspectorScroll();
  const returnFocus = elements.add_short_video_layer.disabled
    ? elements.short_framing_mode_tab
    : elements.add_short_video_layer;
  returnFocus.focus({ preventScroll: true });
  showToast("영상 가져오기를 취소하고 쇼츠 편집으로 돌아왔습니다.");
}

async function beginShortVideoLayerSourceSelection(): Promise<void> {
  if (workspaceMode !== "short-form") {
    return;
  }
  const targetStartMs = Math.max(0, Math.round(project.playheadMs));
  if (!canAddShortFormVideoAsset(
    project.shortForm,
    targetStartMs,
    targetStartMs + MIN_TIMELINE_RANGE_MS
  )) {
    showToast(
      `같은 시각에는 영상을 최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개까지 겹칠 수 있습니다.`,
      "error"
    );
    return;
  }
  if (!mediaFile || !materializedMediaBindingIsValid()) {
    showToast("현재 본편 원본을 먼저 연결하거나 준비해 주세요.", "error");
    return;
  }
  pendingShortVideoAssetTimelineMs = targetStartMs;
  shortSourcePickerReturnState = {
    workspaceProject: cloneProject(project),
    rootProject: cloneProject(rootProject),
    undoStack: undoStack.map(cloneProject),
    redoStack: redoStack.map(cloneProject)
  };
  await exitShortFormWorkspace({
    render: false,
    announce: false,
    updateUrl: false
  });
  if (!startShortSourceComposer()) {
    pendingShortVideoAssetTimelineMs = null;
    await restoreShortWorkspaceAfterSourcePicker();
    return;
  }
  renderShortSourceComposer();
  showToast(
    "현재 본편에서 가져올 구간과 화면을 고르세요. 영상은 쇼츠의 현재 재생 시각부터 추가됩니다.",
    "success",
    5200
  );
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function shortSourceReferenceDimensions(): { width: number; height: number } | null {
  const videoWidth = Math.round(Number(elements.preview_video.videoWidth) || 0);
  const videoHeight = Math.round(Number(elements.preview_video.videoHeight) || 0);
  if (videoWidth > 0 && videoHeight > 0) {
    return { width: videoWidth, height: videoHeight };
  }
  const assetWidth = Math.round(Number(project.mediaAsset?.width) || 0);
  const assetHeight = Math.round(Number(project.mediaAsset?.height) || 0);
  return assetWidth > 0 && assetHeight > 0
    ? { width: assetWidth, height: assetHeight }
    : null;
}

function normalizeShortSourceCropDraft(
  value: Partial<ShortSourceCropDraft>,
  dimensions = shortSourceReferenceDimensions()
): ShortSourceCropDraft | null {
  if (!dimensions) {
    return null;
  }
  const referenceWidth = Math.max(1, Math.round(dimensions.width));
  const referenceHeight = Math.max(1, Math.round(dimensions.height));
  const minimumWidth = 1 / referenceWidth;
  const minimumHeight = 1 / referenceHeight;
  const width = clampNumber(Number(value.width ?? 1), minimumWidth, 1);
  const height = clampNumber(Number(value.height ?? 1), minimumHeight, 1);
  const x = clampNumber(Number(value.x ?? 0), 0, 1 - width);
  const y = clampNumber(Number(value.y ?? 0), 0, 1 - height);
  return {
    x,
    y,
    width,
    height,
    referenceWidth,
    referenceHeight
  };
}

function shortSourceCropPixels(
  crop = shortSourceCropDraft
): { x: number; y: number; width: number; height: number } | null {
  if (!crop) {
    return null;
  }
  const left = Math.round(crop.x * crop.referenceWidth);
  const top = Math.round(crop.y * crop.referenceHeight);
  const right = Math.round((crop.x + crop.width) * crop.referenceWidth);
  const bottom = Math.round((crop.y + crop.height) * crop.referenceHeight);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function shortSourceCropFromPixels(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ShortSourceCropDraft | null {
  const dimensions = shortSourceReferenceDimensions();
  if (!dimensions) {
    return null;
  }
  const width = Math.round(clampNumber(rect.width, 1, dimensions.width));
  const height = Math.round(clampNumber(rect.height, 1, dimensions.height));
  const x = Math.round(clampNumber(rect.x, 0, dimensions.width - width));
  const y = Math.round(clampNumber(rect.y, 0, dimensions.height - height));
  return normalizeShortSourceCropDraft({
    x: x / dimensions.width,
    y: y / dimensions.height,
    width: width / dimensions.width,
    height: height / dimensions.height
  }, dimensions);
}

function shortSourceAspectRatio(): number | null {
  return shortSourceAspect === "9:16"
    ? 9 / 16
    : shortSourceAspect === "1:1"
      ? 1
      : null;
}

function cropPixelsWithAspect(
  rect: { x: number; y: number; width: number; height: number },
  ratio: number,
  anchor = "center",
  preferredAxis: "horizontal" | "vertical" | null = null
): { x: number; y: number; width: number; height: number } {
  const dimensions = shortSourceReferenceDimensions();
  if (!dimensions) {
    return rect;
  }
  let width = Math.max(1, rect.width);
  let height = Math.max(1, rect.height);
  const horizontal = anchor.includes("e") || anchor.includes("w");
  const vertical = anchor.includes("n") || anchor.includes("s");
  if (preferredAxis === "horizontal" || (horizontal && !vertical)) {
    height = Math.max(1, Math.round(width / ratio));
  } else if (preferredAxis === "vertical" || (vertical && !horizontal)) {
    width = Math.max(1, Math.round(height * ratio));
  } else if (width / height > ratio) {
    width = Math.max(1, Math.round(height * ratio));
  } else {
    height = Math.max(1, Math.round(width / ratio));
  }
  const fitScale = Math.min(
    1,
    dimensions.width / width,
    dimensions.height / height
  );
  width = Math.max(1, Math.round(width * fitScale));
  height = Math.max(1, Math.round(height * fitScale));
  let x = rect.x;
  let y = rect.y;
  if (anchor === "center") {
    x = rect.x + (rect.width - width) / 2;
    y = rect.y + (rect.height - height) / 2;
  } else {
    if (anchor.includes("w")) {
      x = rect.x + rect.width - width;
    } else if (!anchor.includes("e")) {
      x = rect.x + (rect.width - width) / 2;
    }
    if (anchor.includes("n")) {
      y = rect.y + rect.height - height;
    } else if (!anchor.includes("s")) {
      y = rect.y + (rect.height - height) / 2;
    }
  }
  return {
    x: Math.round(clampNumber(x, 0, dimensions.width - width)),
    y: Math.round(clampNumber(y, 0, dimensions.height - height)),
    width,
    height
  };
}

function enabledClipAtTimeline(
  timelineMsValue: unknown,
  { previousAtBoundary = false }: { previousAtBoundary?: boolean } = {}
): EditorClip | null {
  const enabledClips = project.clips.filter((clip) => clip.enabled !== false);
  if (enabledClips.length === 0) {
    return null;
  }
  const durationMs = projectDurationMs(project);
  const timelineMs = clampNumber(Number(timelineMsValue) || 0, 0, durationMs);
  const lookupMs = previousAtBoundary && timelineMs > 0
    ? timelineMs - 0.5
    : timelineMs;
  return enabledClips.find((clip) => (
    lookupMs >= clip.timelineStartMs
    && lookupMs < clip.timelineStartMs + clipDurationMs(clip)
  )) || (
    timelineMs === durationMs
      ? enabledClips.findLast((clip) => (
        clip.timelineStartMs + clipDurationMs(clip) === durationMs
      )) || null
      : null
  );
}

function shortSourceBoundaryClip(side: RangeBoundarySide): EditorClip | null {
  const boundaryMs = side === "start" ? rangeStartMs : rangeEndMs;
  return Number.isFinite(boundaryMs)
    ? enabledClipAtTimeline(boundaryMs, {
      previousAtBoundary: side === "end"
    })
    : null;
}

function defaultShortSourceRange(): TimelineRange | null {
  const durationMs = projectDurationMs(project);
  if (durationMs < MIN_TIMELINE_RANGE_MS) {
    return null;
  }
  const playheadMs = clampTimelineMs(project.playheadMs);
  const clip = enabledClipAtTimeline(playheadMs)
    || project.clips.find((candidate) => candidate.enabled !== false)
    || null;
  if (!clip) {
    return null;
  }
  const clipStartMs = clip.timelineStartMs;
  const clipEndMs = clip.timelineStartMs + clipDurationMs(clip);
  const startMs = clampNumber(playheadMs, clipStartMs, Math.max(clipStartMs, clipEndMs - MIN_TIMELINE_RANGE_MS));
  const endMs = Math.min(clipEndMs, startMs + 5_000);
  if (endMs - startMs >= MIN_TIMELINE_RANGE_MS) {
    return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
  }
  return {
    startMs: Math.max(clipStartMs, Math.round(clipEndMs - MIN_TIMELINE_RANGE_MS)),
    endMs: Math.round(clipEndMs)
  };
}

function startShortSourceComposer(): boolean {
  if (workspaceMode !== "main") {
    return false;
  }
  if (activeJobController || projectMutationLockCount > 0) {
    showToast("진행 중인 편집 작업이 끝난 뒤 쇼츠 소스를 만들어 주세요.", "error");
    return false;
  }
  if (!mediaFile || !materializedMediaBindingIsValid()) {
    showToast("편집 영상을 먼저 준비하거나 내 파일을 연결해 주세요.", "error");
    return false;
  }
  const dimensions = shortSourceReferenceDimensions();
  if (!dimensions) {
    showToast("영상 화면 크기를 읽는 중입니다. 잠시 뒤 다시 눌러 주세요.");
    return false;
  }
  const range = selectedTimelineRange() || defaultShortSourceRange();
  if (!range) {
    showToast("쇼츠 소스로 쓸 수 있는 영상 구간이 없습니다.", "error");
    return false;
  }
  elements.preview_video.pause();
  shortSourceComposerCollapsed = false;
  shortSourceComposerActive = true;
  timelineRangePurpose = "short-source";
  shortSourceAspect = "free";
  shortSourceCropDraft = normalizeShortSourceCropDraft({
    x: 0,
    y: 0,
    width: 1,
    height: 1
  }, dimensions);
  rangeStartMs = range.startMs;
  rangeEndMs = range.endMs;
  renderAll({ keepScroll: true });
  elements.short_source_crop_move.focus({ preventScroll: true });
  showToast("타임라인에서 구간을 맞추고, 영상 위 사각형을 드래그해 쇼츠에 쓸 화면을 정하세요.");
  return true;
}

function cancelShortSourceComposer({
  clearRange = true,
  render = true
}: { clearRange?: boolean; render?: boolean } = {}): void {
  if (shortSourceBoundaryPreviewInFlight && render) {
    return;
  }
  pendingShortVideoAssetTimelineMs = null;
  shortSourceComposerCollapsed = false;
  shortSourceComposerActive = false;
  shortSourceCropGesture = null;
  shortSourceCropDraft = null;
  shortSourceAspect = "free";
  timelineRangePurpose = "delete";
  if (clearRange) {
    clearTimelineRangeSelection({ render: false });
  }
  if (render) {
    renderAll({ keepScroll: true });
    elements.start_short_source_composer.focus({ preventScroll: true });
  }
}

function defaultShortDestinationRect(
  crop: ShortSourceCropDraft
): ShortFormDestinationRect {
  const sourceWidth = crop.width * crop.referenceWidth;
  const sourceHeight = crop.height * crop.referenceHeight;
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
  const outputAspect = SHORT_FORM_OUTPUT_WIDTH / SHORT_FORM_OUTPUT_HEIGHT;
  const width = Math.max(1, Math.round(
    sourceAspect >= outputAspect
      ? SHORT_FORM_OUTPUT_WIDTH
      : SHORT_FORM_OUTPUT_HEIGHT * sourceAspect
  ));
  const height = Math.max(1, Math.round(
    sourceAspect >= outputAspect
      ? SHORT_FORM_OUTPUT_WIDTH / sourceAspect
      : SHORT_FORM_OUTPUT_HEIGHT
  ));
  return {
    x: Math.round((SHORT_FORM_OUTPUT_WIDTH - width) / 2),
    y: Math.round((SHORT_FORM_OUTPUT_HEIGHT - height) / 2),
    width,
    height
  };
}

function shortSourceSliceRequests(
  range: TimelineRange,
  crop: ShortSourceCropDraft
): ShortFormSliceRequest[] {
  const sourceRect: ShortFormSourceRect = { ...crop };
  const destinationRect = defaultShortDestinationRect(crop);
  return project.clips.flatMap((clip) => {
    if (clip.enabled === false) {
      return [];
    }
    const clipStartMs = clip.timelineStartMs;
    const clipEndMs = clip.timelineStartMs + clipDurationMs(clip);
    const overlapStartMs = Math.max(range.startMs, clipStartMs);
    const overlapEndMs = Math.min(range.endMs, clipEndMs);
    const overlapDurationMs = overlapEndMs - overlapStartMs;
    if (overlapDurationMs <= 0) {
      return [];
    }
    if (overlapDurationMs < MIN_TIMELINE_RANGE_MS) {
      throw new RangeError(
        "선택 구간이 컷 경계에서 0.1초 미만 영상 조각을 만듭니다. 시작·끝을 경계에서 0.1초 이상 떨어뜨려 주세요."
      );
    }
    return [{
      sourceClipId: clip.id,
      sourceStartMs: Math.round(
        clip.sourceStartMs + overlapStartMs - clipStartMs
      ),
      sourceEndMs: Math.round(
        clip.sourceStartMs + overlapEndMs - clipStartMs
      ),
      sourceRect: { ...sourceRect },
      destinationRect: { ...destinationRect }
    }];
  });
}

function appendShortSourceVideoAssets(
  parentProject: EditorProject,
  requests: readonly ShortFormSliceRequest[],
  targetTimelineMs: number | null
): { shortForm: EditorProject["shortForm"]; addedCount: number } {
  let shortForm = parentProject.shortForm;
  const hasAuthoredCanvasContent = (
    shortForm.videoAssets.length > 0
    || shortForm.sourceAudioAssets.length > 0
    || shortForm.subtitles.length > 0
    || shortForm.imageAssets.length > 0
    || shortForm.audioRegions.length > 0
  );
  let timelineCursorMs = targetTimelineMs ?? (
    hasAuthoredCanvasContent ? shortForm.durationMs : 0
  );
  let addedCount = 0;
  for (const request of requests) {
    const sourceClip = parentProject.clips.find((clip) => (
      clip.id === request.sourceClipId
      || clip.shortFormSourceClipId === request.sourceClipId
    ));
    if (!sourceClip) {
      continue;
    }
    const sourceStartMs = Math.max(
      sourceClip.sourceStartMs,
      Math.round(request.sourceStartMs)
    );
    const sourceEndMs = Math.min(
      sourceClip.sourceEndMs,
      Math.round(request.sourceEndMs)
    );
    const assetDurationMs = sourceEndMs - sourceStartMs;
    if (assetDurationMs < MIN_TIMELINE_RANGE_MS) {
      continue;
    }
    const selectionStartMs = Math.min(
      sourceStartMs,
      Math.round(Number(
        sourceClip.shortFormSelectionStartMs
        ?? sourceClip.selectionStartMs
        ?? sourceStartMs
      ))
    );
    const selectionEndMs = Math.max(
      sourceEndMs,
      Math.round(Number(
        sourceClip.shortFormSelectionEndMs
        ?? sourceClip.selectionEndMs
        ?? sourceEndMs
      ))
    );
    const timelineEndMs = timelineCursorMs + assetDurationMs;
    const workspaceId = normalizeShortFormWorkspaceCollection(
      parentProject.shortFormWorkspaces,
      parentProject.shortForm,
      parentProject.clips
    ).activeWorkspaceId;
    shortForm = addShortFormVideoAsset(shortForm, {
      id: `${workspaceId}-video-${crypto.randomUUID()}`,
      sourceAssetId: "project-primary",
      sourceClipId: String(
        sourceClip.shortFormSourceClipId || sourceClip.id
      ),
      sourceSelectionStartMs: selectionStartMs,
      sourceSelectionEndMs: selectionEndMs,
      sourceStartMs,
      sourceEndMs,
      timelineStartMs: timelineCursorMs,
      timelineEndMs,
      sourceRect: request.sourceRect,
      destinationRect: request.destinationRect,
      opacity: 1,
      visible: true
    });
    addedCount += 1;
    timelineCursorMs = timelineEndMs;
  }
  return { shortForm, addedCount };
}

async function commitShortSource(openShortWorkspace: boolean): Promise<boolean> {
  if (!shortSourceComposerActive || workspaceMode !== "main") {
    return false;
  }
  if (shortSourceBoundaryPreviewInFlight) {
    return false;
  }
  if (activeJobController || projectMutationLockCount > 0) {
    showToast("진행 중인 편집 작업이 끝난 뒤 쇼츠 소스를 추가해 주세요.", "error");
    return false;
  }
  const range = selectedTimelineRange();
  const crop = shortSourceCropDraft;
  if (!range || !crop) {
    showToast("0.1초 이상의 영상 구간과 사용할 화면을 먼저 정해 주세요.", "error");
    return false;
  }
  let requests: ShortFormSliceRequest[];
  try {
    requests = shortSourceSliceRequests(range, crop);
  } catch (error: unknown) {
    showToast(errorMessage(error), "error");
    return false;
  }
  if (requests.length === 0) {
    showToast("선택 구간과 겹치는 활성 본편 영상이 없습니다.", "error");
    return false;
  }
  const preAddProject = cloneProject(project);
  const videoAssetTargetTimelineMs = pendingShortVideoAssetTimelineMs;
  let shortForm: EditorProject["shortForm"];
  let addedCount: number;
  try {
    ({ shortForm, addedCount } = appendShortSourceVideoAssets(
      project,
      requests,
      videoAssetTargetTimelineMs
    ));
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return false;
  }
  if (addedCount === 0) {
    if (videoAssetTargetTimelineMs !== null) {
      showToast(
        `현재 쇼츠 시각에는 영상을 더 겹칠 수 없습니다. 동시에 최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개까지 놓을 수 있습니다.`,
        "error"
      );
    } else {
      showToast("쇼츠 영상을 추가하지 못했습니다. 구간을 다시 확인해 주세요.", "error");
    }
    return false;
  }
  const nextProject = {
    ...project,
    shortForm,
    updatedAt: new Date().toISOString()
  };
  shortSourceComposerActive = false;
  shortSourceCropDraft = null;
  shortSourceCropGesture = null;
  shortSourceAspect = "free";
  pendingShortVideoAssetTimelineMs = null;
  timelineRangePurpose = "delete";
  clearTimelineRangeSelection({ render: false });
  const pickerReturnState = shortSourcePickerReturnState;
  shortSourcePickerReturnState = null;
  const shouldOpenShortWorkspace = (
    videoAssetTargetTimelineMs !== null || openShortWorkspace
  );
  if (shouldOpenShortWorkspace) {
    const undoHistory = pickerReturnState
      ? [...pickerReturnState.undoStack, pickerReturnState.workspaceProject]
      : [createShortFormWorkspaceProject(preAddProject)];
    pendingShortWorkspaceUndoHistory = undoHistory.slice(-60);
    applyProject(nextProject, { record: false });
  } else {
    applyProject(nextProject);
  }
  showToast(
    videoAssetTargetTimelineMs !== null
      ? `영상 ${addedCount}개를 쇼츠에 추가했습니다. 화면과 원본 음성이 함께 움직입니다.`
      : `${formatDuration(range.endMs - range.startMs)} 구간을 영상 ${addedCount}개로 추가했습니다. 화면과 원본 음성은 함께 준비되며 이동·자르기·삭제도 같이 적용됩니다.`,
    "success",
    5200
  );
  if (shouldOpenShortWorkspace) {
    try {
      await enterShortFormWorkspace();
    } finally {
      pendingShortWorkspaceUndoHistory = null;
    }
    elements.short_workspace_transform_move.focus({ preventScroll: true });
  } else {
    void prepareShortPreviewAssetCaches(
      project,
      project.shortForm.videoAssets
    ).catch((error: unknown) => {
      shortPreviewCacheError = errorDetails(error);
      showToast(
        `쇼츠 영상 미리보기를 준비하지 못했습니다. 편집 내용은 유지됩니다: ${shortPreviewCacheError}`,
        "error",
        0
      );
    });
  }
  return true;
}

function replaceShortWorkspaceFraming(
  update: Partial<Pick<ShortFormVideoAsset, "sourceRect" | "destinationRect">> & {
    fit?: unknown;
    positionX?: unknown;
    positionY?: unknown;
    zoom?: unknown;
    canvasX?: unknown;
    canvasY?: unknown;
    canvasScale?: unknown;
  },
  {
    all = false,
    fieldKey = ""
  }: { all?: boolean; fieldKey?: string } = {}
): boolean {
  if (workspaceMode !== "short-form") {
    return false;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return false;
  }
  const activeLayer = activeShortWorkspaceVideoLayer();
  if (!activeLayer) {
    return false;
  }
  let shortForm = project.shortForm;
  const assetUpdate: Partial<ShortFormVideoAsset> = {};
  if (update.sourceRect !== undefined) {
    assetUpdate.sourceRect = update.sourceRect;
  }
  if (update.destinationRect !== undefined) {
    assetUpdate.destinationRect = update.destinationRect;
  }
  if (Object.keys(assetUpdate).length === 0) {
    return false;
  }
  const targetIds = all
    ? shortForm.videoAssets.map((asset) => asset.id)
    : [activeLayer.id];
  for (const assetId of targetIds) {
    shortForm = updateShortFormVideoAsset(shortForm, assetId, assetUpdate);
  }
  const next = { ...project, shortForm };
  if (fieldKey) {
    applyFieldProject(next, fieldKey);
  } else {
    applyProject(next);
  }
  return true;
}

function applyShortWorkspaceSqueegee(
  direction: ShortFormSqueegeeDirection
): boolean {
  if (workspaceMode !== "short-form") {
    return false;
  }
  const selectedLayer = activeShortWorkspaceVideoLayer();
  if (!selectedLayer) {
    showToast("밀대로 보정할 쇼츠 영상을 먼저 선택해 주세요.");
    return false;
  }
  if (direction === "all") {
    let repairedBranch = project.shortForm;
    let repairedCompositeGapCount = 0;
    // Re-detect after each atomic repair because one expansion can also close
    // an adjacent seam. Only the current playhead and selected visual asset
    // are in scope, so intentional empty scenes elsewhere remain untouched.
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const currentFinding = detectShortFormCompositeCanvasGaps(
        repairedBranch
      ).find((finding) => (
        finding.timelineStartMs <= project.playheadMs
        && project.playheadMs < finding.timelineEndMs
        && finding.relatedAssetIds.includes(selectedLayer.id)
      ));
      if (!currentFinding) {
        break;
      }
      repairedBranch = repairShortFormCompositeCanvasGap(
        repairedBranch,
        currentFinding
      );
      repairedCompositeGapCount += 1;
    }
    if (repairedCompositeGapCount > 0) {
      applyProject({
        ...project,
        shortForm: repairedBranch,
        updatedAt: new Date().toISOString()
      });
      showToast(
        `현재 합성 화면의 미세한 검은 틈 ${repairedCompositeGapCount}개를 관련 영상끼리 맞닿게 밀었습니다. 원본 크롭은 유지됩니다.`,
        "success"
      );
      return true;
    }
  }
  const nextLayer = squeegeeShortFormVideoAsset(selectedLayer, direction);
  if (nextLayer === selectedLayer) {
    showToast("선택한 방향에는 1–24px의 미세한 틈이 없습니다.");
    return false;
  }
  const changed = replaceShortWorkspaceFraming({
    destinationRect: nextLayer.destinationRect
  });
  if (changed) {
    const directionLabel = {
      left: "왼쪽",
      right: "오른쪽",
      top: "위",
      bottom: "아래",
      all: "감지된 모든 방향"
    }[direction];
    showToast(
      `${directionLabel}의 미세한 검은 틈을 화면 끝까지 보정했습니다. 가져올 원본 영역은 유지됩니다.`,
      "success"
    );
  }
  return changed;
}

function updateSelectedShortVideoLayer(
  update: Partial<Omit<ShortFormVideoAsset, "id">>,
  fieldKey = ""
): boolean {
  if (workspaceMode !== "short-form") {
    return false;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return false;
  }
  const selected = activeShortWorkspaceVideoLayer();
  if (!selected) {
    return false;
  }
  const shortForm = updateShortFormVideoAsset(
    project.shortForm,
    selected.id,
    update
  );
  if (shortForm === project.shortForm) {
    return false;
  }
  const next = { ...project, shortForm };
  if (fieldKey) {
    applyFieldProject(next, fieldKey);
  } else {
    applyProject(next);
  }
  return true;
}

function deleteSelectedShortVideoLayer(): boolean {
  if (workspaceMode !== "short-form") {
    return false;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return false;
  }
  const selected = activeShortWorkspaceVideoLayer();
  if (!selected) {
    showToast("삭제할 영상을 먼저 선택해 주세요.");
    return false;
  }
  const shortForm = removeShortFormVideoAsset(
    project.shortForm,
    selected.id
  );
  if (shortForm === project.shortForm) {
    return false;
  }
  applyProject({ ...project, shortForm });
  showToast(
    shortForm.videoAssets.length > 0
      ? "선택 영상을 삭제했습니다. 사진·자막·음성과 쇼츠 길이는 그대로 유지됩니다."
      : "마지막 영상도 삭제했습니다. 빈 쇼츠 화면과 사진·자막·음성은 그대로 유지됩니다.",
    "success"
  );
  return true;
}

function moveShortVideoLayer(
  layerId: string,
  direction: "front" | "forward" | "backward" | "back"
): boolean {
  if (workspaceMode !== "short-form") {
    return false;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return false;
  }
  const selected = project.shortForm.videoAssets.find((asset) => (
    asset.id === layerId
  )) || null;
  if (!selected) {
    return false;
  }
  const ordered = [...project.shortForm.videoAssets]
    .sort((left, right) => left.zIndex - right.zIndex);
  const index = ordered.findIndex((layer) => layer.id === selected.id);
  const nextIndex = direction === "front"
    ? ordered.length - 1
    : direction === "back"
      ? 0
      : index + (direction === "forward" ? 1 : -1);
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) {
    return false;
  }
  const [moving] = ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, moving!);
  const shortForm = reorderShortFormVideoAssets(
    project.shortForm,
    ordered.map((layer) => layer.id)
  );
  applyProject({
    ...project,
    shortForm: {
      ...shortForm,
      selectedVideoLayerId: selected.id
    }
  });
  const message = direction === "front"
    ? "영상을 맨 위로 올렸습니다."
    : direction === "forward"
      ? "영상을 한 단계 위로 올렸습니다."
      : direction === "backward"
        ? "영상을 한 단계 아래로 내렸습니다."
        : "영상을 맨 아래로 내렸습니다.";
  showToast(message);
  return true;
}

function exactShortWorkspaceGeometry(
  layer = activeShortWorkspaceVideoLayer()
): {
  sourceRect: ShortFormSourceRect;
  destinationRect: ShortFormDestinationRect;
} | null {
  const sourceRect = normalizeShortFormSourceRect(layer?.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(layer?.destinationRect);
  return sourceRect && destinationRect
    ? { sourceRect, destinationRect }
    : null;
}

function shortWorkspaceSourceAspect(sourceRect: ShortFormSourceRect): number {
  return (
    sourceRect.width * sourceRect.referenceWidth
    / Math.max(1, sourceRect.height * sourceRect.referenceHeight)
  );
}

function renderShortWorkspaceTransformOverlay(): void {
  const geometry = (
    workspaceMode === "short-form"
    && propertyInspectorMode === "framing"
  )
    ? exactShortWorkspaceGeometry()
    : null;
  elements.short_workspace_transform_layer.hidden = !geometry;
  if (!geometry) {
    delete elements.short_workspace_transform_box.dataset.dragging;
    return;
  }
  const rect = geometry.destinationRect;
  elements.short_workspace_transform_box.style.left = `${rect.x / SHORT_FORM_OUTPUT_WIDTH * 100}%`;
  elements.short_workspace_transform_box.style.top = `${rect.y / SHORT_FORM_OUTPUT_HEIGHT * 100}%`;
  elements.short_workspace_transform_box.style.width = `${rect.width / SHORT_FORM_OUTPUT_WIDTH * 100}%`;
  elements.short_workspace_transform_box.style.height = `${rect.height / SHORT_FORM_OUTPUT_HEIGHT * 100}%`;
  if (shortWorkspaceTransformGesture) {
    elements.short_workspace_transform_box.dataset.dragging = "true";
  } else {
    delete elements.short_workspace_transform_box.dataset.dragging;
  }
  elements.short_workspace_transform_box.setAttribute(
    "aria-label",
    `선택 영상. 쇼츠 화면 X ${rect.x}, Y ${rect.y}, 너비 ${rect.width}, 높이 ${rect.height}픽셀.`
  );
}

function destinationRectWithAspect(
  rect: ShortFormDestinationRect,
  ratio: number,
  handle: string,
  preferredAxis: "horizontal" | "vertical" | null = null
): ShortFormDestinationRect {
  let width = Math.max(1, rect.width);
  let height = Math.max(1, rect.height);
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  if (preferredAxis === "horizontal" || (horizontal && !vertical)) {
    height = Math.max(1, Math.round(width / ratio));
  } else if (preferredAxis === "vertical" || (vertical && !horizontal)) {
    width = Math.max(1, Math.round(height * ratio));
  } else if (width / height > ratio) {
    height = Math.max(1, Math.round(width / ratio));
  } else {
    width = Math.max(1, Math.round(height * ratio));
  }
  let x = rect.x;
  let y = rect.y;
  if (handle.includes("w")) {
    x = rect.x + rect.width - width;
  } else if (!handle.includes("e")) {
    x = rect.x + (rect.width - width) / 2;
  }
  if (handle.includes("n")) {
    y = rect.y + rect.height - height;
  } else if (!handle.includes("s")) {
    y = rect.y + (rect.height - height) / 2;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height
  };
}

function shortWorkspaceDestinationAfterDelta(
  start: ShortFormDestinationRect,
  handle: string,
  deltaX: number,
  deltaY: number,
  sourceRect: ShortFormSourceRect
): ShortFormDestinationRect | null {
  if (handle === "move") {
    return normalizeShortFormDestinationRect({
      ...start,
      x: start.x + Math.round(deltaX),
      y: start.y + Math.round(deltaY)
    });
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) {
    left = Math.min(right - 1, left + deltaX);
  }
  if (handle.includes("e")) {
    right = Math.max(left + 1, right + deltaX);
  }
  if (handle.includes("n")) {
    top = Math.min(bottom - 1, top + deltaY);
  }
  if (handle.includes("s")) {
    bottom = Math.max(top + 1, bottom + deltaY);
  }
  let next: ShortFormDestinationRect = {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
  if (elements.short_workspace_destination_lock_aspect.checked) {
    const corner = (
      (handle.includes("e") || handle.includes("w"))
      && (handle.includes("n") || handle.includes("s"))
    );
    next = destinationRectWithAspect(
      next,
      shortWorkspaceSourceAspect(sourceRect),
      handle,
      corner
        ? Math.abs(deltaX) >= Math.abs(deltaY * shortWorkspaceSourceAspect(sourceRect))
          ? "horizontal"
          : "vertical"
        : null
    );
  }
  return normalizeShortFormDestinationRect(next);
}

function beginShortWorkspaceTransformGesture(event: PointerEvent): void {
  const geometry = exactShortWorkspaceGeometry();
  if (
    !geometry
    || event.button !== 0
    || !event.isPrimary
  ) {
    return;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return;
  }
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-short-workspace-transform-handle], [data-short-workspace-transform-move]"
  );
  if (!target) {
    return;
  }
  const bounds = elements.short_workspace_transform_layer.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  // Preventing pointerdown's default also prevents Chromium from focusing a
  // button. Restore that semantic explicitly so a drag can continue directly
  // with 1 px / Shift+10 px keyboard adjustment.
  target.focus({ preventScroll: true });
  shortWorkspaceTransformGesture = {
    pointerId: event.pointerId,
    handle: target.dataset.shortWorkspaceTransformHandle || "move",
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRect: { ...geometry.destinationRect },
    layerWidth: bounds.width,
    layerHeight: bounds.height,
    projectSnapshot: cloneProject(project),
    // pushUndo() replaces redoStack on the first pointer move. Keep the old
    // array so pointercancel can be a true no-op for the user's history too.
    redoStackSnapshot: redoStack,
    changed: false
  };
  elements.short_workspace_transform_layer.setPointerCapture(event.pointerId);
  renderShortWorkspaceTransformOverlay();
}

function updateShortWorkspaceTransformGesture(event: PointerEvent): void {
  const gesture = shortWorkspaceTransformGesture;
  const geometry = exactShortWorkspaceGeometry();
  if (!gesture || !geometry || event.pointerId !== gesture.pointerId) {
    return;
  }
  event.preventDefault();
  const destinationRect = shortWorkspaceDestinationAfterDelta(
    gesture.startRect,
    gesture.handle,
    (event.clientX - gesture.startClientX) / gesture.layerWidth * SHORT_FORM_OUTPUT_WIDTH,
    (event.clientY - gesture.startClientY) / gesture.layerHeight * SHORT_FORM_OUTPUT_HEIGHT,
    geometry.sourceRect
  );
  if (!destinationRect) {
    return;
  }
  gesture.changed = true;
  replaceShortWorkspaceFraming(
    { destinationRect },
    { fieldKey: "short-workspace-transform-pointer" }
  );
}

function finishShortWorkspaceTransformGesture(
  event: PointerEvent,
  { cancel = false }: { cancel?: boolean } = {}
): void {
  const gesture = shortWorkspaceTransformGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) {
    return;
  }
  shortWorkspaceTransformGesture = null;
  if (elements.short_workspace_transform_layer.hasPointerCapture(event.pointerId)) {
    elements.short_workspace_transform_layer.releasePointerCapture(event.pointerId);
  }
  if (
    cancel
    && gesture.changed
    && fieldEditSession?.key === "short-workspace-transform-pointer"
  ) {
    if (fieldEditSession.recorded) {
      undoStack.pop();
    }
    redoStack = gesture.redoStackSnapshot;
    fieldEditSession = null;
    applyProject(gesture.projectSnapshot, { record: false });
  } else {
    endFieldEdit("short-workspace-transform-pointer");
    renderShortWorkspaceTransformOverlay();
  }
}

function updateShortWorkspaceDestinationField(
  field: keyof ShortFormDestinationRect,
  rawValue: unknown,
  fieldKey: string
): void {
  const geometry = exactShortWorkspaceGeometry();
  const value = Math.round(Number(rawValue));
  if (!geometry || !Number.isFinite(value)) {
    renderShortFramingInspector();
    return;
  }
  let destinationRect: ShortFormDestinationRect = {
    ...geometry.destinationRect,
    [field]: value
  };
  if (
    elements.short_workspace_destination_lock_aspect.checked
    && (field === "width" || field === "height")
  ) {
    const ratio = shortWorkspaceSourceAspect(geometry.sourceRect);
    destinationRect = field === "width"
      ? {
        ...destinationRect,
        height: Math.max(1, Math.round(destinationRect.width / ratio))
      }
      : {
        ...destinationRect,
        width: Math.max(1, Math.round(destinationRect.height * ratio))
      };
  }
  const normalized = normalizeShortFormDestinationRect(destinationRect);
  if (normalized) {
    replaceShortWorkspaceFraming({ destinationRect: normalized }, { fieldKey });
  }
}

function nudgeShortWorkspaceTransformFromKeyboard(event: KeyboardEvent): void {
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  }[event.key];
  const geometry = exactShortWorkspaceGeometry();
  if (!delta || !geometry) {
    return;
  }
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-short-workspace-transform-handle], [data-short-workspace-transform-move]"
  );
  if (!target) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const step = event.shiftKey ? 10 : 1;
  const destinationRect = shortWorkspaceDestinationAfterDelta(
    geometry.destinationRect,
    target.dataset.shortWorkspaceTransformHandle || "move",
    delta[0]! * step,
    delta[1]! * step,
    geometry.sourceRect
  );
  if (destinationRect) {
    replaceShortWorkspaceFraming(
      { destinationRect },
      { fieldKey: "short-workspace-transform-keyboard" }
    );
  }
}

function releaseShortPreviewAdaptiveScaler(): void {
  shortPreviewAdaptiveScaler?.destroy();
  shortPreviewAdaptiveScaler = null;
}

function ensureShortPreviewAudioContext(): AudioContext | null {
  if (shortPreviewAudioContext?.state !== "closed") {
    return shortPreviewAudioContext;
  }
  const AudioContextConstructor = window.AudioContext;
  if (typeof AudioContextConstructor !== "function") {
    return null;
  }
  shortPreviewAudioContext = new AudioContextConstructor({
    latencyHint: "interactive"
  });
  return shortPreviewAudioContext;
}

function ensureShortPreviewLayerAudioGraph(
  state: ShortPreviewLayerVideoState
): boolean {
  if (state.audioSourceNode && state.audioGainNode) {
    return true;
  }
  const context = ensureShortPreviewAudioContext();
  if (!context) {
    return false;
  }
  try {
    const source = context.createMediaElementSource(state.video);
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(context.destination);
    state.audioSourceNode = source;
    state.audioGainNode = gain;
    return true;
  } catch (error) {
    console.warn("영상 음량 조절기를 연결하지 못했습니다.", error);
    return false;
  }
}

function resumeShortPreviewAudioContext(): void {
  const context = ensureShortPreviewAudioContext();
  if (context?.state === "suspended") {
    void context.resume().catch((error: unknown) => {
      console.warn("영상 음량 조절기를 시작하지 못했습니다.", error);
    });
  }
}

function releaseShortPreviewLayerVideo(layerId: string): void {
  const state = shortPreviewLayerVideos.get(layerId);
  if (!state) {
    return;
  }
  if (
    state.decodedFrameCallback !== null
    && typeof state.video.cancelVideoFrameCallback === "function"
  ) {
    try {
      state.video.cancelVideoFrameCallback(state.decodedFrameCallback);
    } catch {
      // The decoder can already be detached after a media error.
    }
    state.decodedFrameCallback = null;
  }
  if (state.audioGainNode) {
    state.audioGainNode.gain.value = 0;
    state.audioGainNode.disconnect();
    state.audioGainNode = null;
  }
  if (state.audioSourceNode) {
    state.audioSourceNode.disconnect();
    state.audioSourceNode = null;
  }
  state.video.muted = true;
  state.video.volume = 0;
  state.video.pause();
  state.video.removeAttribute("src");
  state.video.load();
  shortPreviewLayerVideos.delete(layerId);
}

function scheduleShortPreviewLayerDecodedFrame(
  layerId: string,
  state: ShortPreviewLayerVideoState
): void {
  if (
    state.decodedFrameCallback !== null
    || state.error
    || typeof state.video.requestVideoFrameCallback !== "function"
  ) {
    return;
  }
  try {
    const playbackGeneration = shortCanvasPlaybackGeneration;
    let callbackId = 0;
    callbackId = state.video.requestVideoFrameCallback(() => {
      if (state.decodedFrameCallback !== callbackId) {
        return;
      }
      state.decodedFrameCallback = null;
      if (
        shortPreviewLayerVideos.get(layerId) !== state
        || state.error
        || playbackGeneration !== shortCanvasPlaybackGeneration
        || !shortCanvasPlaybackActive
      ) {
        return;
      }
      scheduleShortWorkspacePreview();
      if (!state.video.paused && !state.video.ended) {
        scheduleShortPreviewLayerDecodedFrame(layerId, state);
      }
    });
    state.decodedFrameCallback = callbackId;
  } catch (error) {
    state.decodedFrameCallback = null;
    console.warn("쇼츠 레이어 영상 프레임 콜백을 연결하지 못했습니다.", error);
  }
}

function requestShortPreviewLayerPlay(
  layerId: string,
  state: ShortPreviewLayerVideoState
): void {
  if (
    state.error
    || state.playPromise
    || !state.video.paused
    || workspaceMode !== "short-form"
    || !shortCanvasPlaybackActive
  ) {
    return;
  }
  const playbackGeneration = shortCanvasPlaybackGeneration;
  let playPromise: Promise<void>;
  try {
    playPromise = state.video.play();
  } catch (error) {
    if (state.audioGainNode) {
      state.audioGainNode.gain.value = 0;
    }
    state.error = new Error(
      `${layerId} 영상의 이 기기 재생을 시작하지 못했습니다: ${errorDetails(error)}`
    );
    shortPreviewCacheError = state.error.message;
    return;
  }
  state.playPromise = playPromise;
  void playPromise
    .then(() => {
      if (state.playPromise === playPromise) {
        state.playPromise = null;
      }
      if (
        shortPreviewLayerVideos.get(layerId) !== state
        || playbackGeneration !== shortCanvasPlaybackGeneration
        || workspaceMode !== "short-form"
        || !shortCanvasPlaybackActive
      ) {
        if (state.audioGainNode) {
          state.audioGainNode.gain.value = 0;
        }
        state.video.muted = true;
        state.video.volume = 0;
        state.video.pause();
        if (
          shortPreviewLayerVideos.get(layerId) === state
          && workspaceMode === "short-form"
          && shortCanvasPlaybackActive
          && state.ready
        ) {
          requestShortPreviewLayerPlay(layerId, state);
        }
        return;
      }
      state.ready = (
        state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !state.video.seeking
        && state.seekingTargetSeconds === null
      );
      scheduleShortPreviewLayerDecodedFrame(layerId, state);
      scheduleShortWorkspacePreview();
      applyPreviewAudioSettings(shortCanvasTimelineMsFromClock());
    })
    .catch((error: unknown) => {
      if (state.playPromise === playPromise) {
        state.playPromise = null;
      }
      if (
        shortPreviewLayerVideos.get(layerId) === state
        && playbackGeneration === shortCanvasPlaybackGeneration
        && errorName(error) !== "AbortError"
      ) {
        if (state.audioGainNode) {
          state.audioGainNode.gain.value = 0;
        }
        state.video.muted = true;
        state.video.volume = 0;
        state.error = new Error(
          `${layerId} 영상의 이 기기 재생을 시작하지 못했습니다: ${errorDetails(error)}`
        );
        shortPreviewCacheError = state.error.message;
        console.warn(state.error.message);
        scheduleShortWorkspacePreview();
      } else if (
        shortPreviewLayerVideos.get(layerId) === state
        && playbackGeneration !== shortCanvasPlaybackGeneration
        && workspaceMode === "short-form"
        && shortCanvasPlaybackActive
        && state.ready
      ) {
        requestShortPreviewLayerPlay(layerId, state);
      }
    });
}

function releaseShortPreviewLayerVideos(keepLayerIds?: ReadonlySet<string>): void {
  for (const layerId of [...shortPreviewLayerVideos.keys()]) {
    if (!keepLayerIds?.has(layerId)) {
      releaseShortPreviewLayerVideo(layerId);
    }
  }
}

function pauseShortPreviewLayerVideos(): void {
  for (const state of shortPreviewLayerVideos.values()) {
    if (
      state.decodedFrameCallback !== null
      && typeof state.video.cancelVideoFrameCallback === "function"
    ) {
      try {
        state.video.cancelVideoFrameCallback(state.decodedFrameCallback);
      } catch {
        // The browser may have completed the callback between checks.
      }
      state.decodedFrameCallback = null;
    }
    state.video.muted = true;
    state.video.volume = 0;
    if (state.audioGainNode) {
      state.audioGainNode.gain.value = 0;
    }
    state.video.pause();
  }
}

function pauseShortPreviewSourceAudio(): void {
  shortPreviewSourceAudioSequence += 1;
  if (shortPreviewSourceAudioTimer !== null) {
    clearTimeout(shortPreviewSourceAudioTimer);
    shortPreviewSourceAudioTimer = null;
  }
  const state = shortPreviewSourceAudioState;
  if (!state) {
    return;
  }
  state.synchronized = false;
  state.video.muted = true;
  state.video.volume = 0;
  state.video.pause();
}

function releaseShortPreviewSourceAudio(): void {
  pauseShortPreviewSourceAudio();
  const state = shortPreviewSourceAudioState;
  shortPreviewSourceAudioState = null;
  if (!state) {
    return;
  }
  state.video.removeAttribute("src");
  state.video.load();
}

function ensureShortPreviewSourceAudio(
  asset: ShortFormSourceAudioAsset
): ShortPreviewSourceAudioState | null {
  const cache = shortPreviewCacheForSourceAudioAsset(asset, rootProject);
  if (!cache) {
    return null;
  }
  const desiredMediaUrl = cache.objectUrl;
  const cacheSourceStartMs = cache.sourceStartMs;
  const cacheMediaOffsetMs = cache.mediaOffsetMs;
  if (
    shortPreviewSourceAudioState
    && shortPreviewSourceAudioState.mediaUrl === desiredMediaUrl
    && shortPreviewSourceAudioState.cacheSourceStartMs === cacheSourceStartMs
    && shortPreviewSourceAudioState.cacheMediaOffsetMs === cacheMediaOffsetMs
  ) {
    return shortPreviewSourceAudioState;
  }
  releaseShortPreviewSourceAudio();
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  video.volume = 0;
  video.setAttribute("aria-hidden", "true");
  configureVideoMediaSource(video, null);
  const state: ShortPreviewSourceAudioState = {
    video,
    mediaUrl: desiredMediaUrl,
    cacheSourceStartMs,
    cacheMediaOffsetMs,
    assetId: null,
    targetSeconds: Number.NaN,
    synchronized: false,
    playPromise: null,
    error: null
  };
  shortPreviewSourceAudioState = state;

  const resync = () => {
    if (
      shortPreviewSourceAudioState !== state
      || state.error
      || workspaceMode !== "short-form"
      || !project
    ) {
      return;
    }
    syncShortPreviewSourceAudioAtTimeline(
      shortCanvasPlaybackActive
        ? shortCanvasTimelineMsFromClock()
        : project.playheadMs,
      { play: shortCanvasPlaybackActive }
    );
  };
  video.addEventListener("loadedmetadata", resync);
  video.addEventListener("loadeddata", resync);
  video.addEventListener("seeked", resync);
  video.addEventListener("ended", () => {
    if (shortPreviewSourceAudioState !== state) {
      return;
    }
    state.synchronized = false;
    video.muted = true;
    video.volume = 0;
  });
  video.addEventListener("error", () => {
    if (shortPreviewSourceAudioState !== state || state.error) {
      return;
    }
    state.error = new Error("쇼츠 원본 음성 미리보기를 읽지 못했습니다.");
    shortPreviewPacketCopyBlacklist.add(cache.sourceFingerprint);
    shortPreviewCacheError = state.error.message;
    state.synchronized = false;
    video.muted = true;
    video.volume = 0;
    video.pause();
    console.warn(state.error.message);
    releaseShortPreviewAssetCache(cache.assetId);
    renderShortFramingInspector();
  });
  video.src = desiredMediaUrl;
  return state;
}

function ensureShortPreviewLayerVideo(
  layer: ActiveShortFormVideoAsset
): HTMLVideoElement | null {
  const cache = shortPreviewAssetCaches.get(layer.id);
  const cacheParent = workspaceMode === "short-form" ? rootProject : project;
  if (
    !cache
    || !shortPreviewVideoAssetCacheMatches(cache, layer, cacheParent)
    || !shortPreviewCacheCoverageContainsTime(cache, layer.sourceTimeMs)
  ) {
    return null;
  }
  const cacheUrl = cache.objectUrl;
  let state = shortPreviewLayerVideos.get(layer.id);
  if (!state || state.mediaUrl !== cacheUrl) {
    if (state) {
      releaseShortPreviewLayerVideo(layer.id);
    }
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.volume = 0;
    video.setAttribute("aria-hidden", "true");
    state = {
      video,
      audioSourceNode: null,
      audioGainNode: null,
      mediaUrl: cacheUrl,
      targetSeconds: Number.NaN,
      ready: false,
      error: null,
      seekingTargetSeconds: null,
      playPromise: null,
      decodedFrameCallback: null
    };
    const updateReadyFrame = () => {
      const current = shortPreviewLayerVideos.get(layer.id);
      if (!current || current.video !== video || current.error) {
        return;
      }
      if (
        current.seekingTargetSeconds !== null
        && !video.seeking
      ) {
        current.seekingTargetSeconds = null;
      }
      current.ready = (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !video.seeking
        && current.seekingTargetSeconds === null
      );
      scheduleShortWorkspacePreview();
    };
    video.addEventListener("loadedmetadata", updateReadyFrame);
    video.addEventListener("loadeddata", updateReadyFrame);
    video.addEventListener("seeked", updateReadyFrame);
    video.addEventListener("timeupdate", updateReadyFrame);
    video.addEventListener("error", () => {
      const current = shortPreviewLayerVideos.get(layer.id);
      if (current?.video === video && !current.error) {
        if (current.audioGainNode) {
          current.audioGainNode.gain.value = 0;
        }
        current.ready = false;
        current.error = new Error(
          `${layer.id} 영상의 원본 화면을 읽지 못했습니다.`
        );
        shortPreviewPacketCopyBlacklist.add(cache.sourceFingerprint);
        // Keep the terminal state so the preview cannot spin in an unbounded
        // recreate loop, while releasing the failed decoder immediately.
        video.pause();
        video.removeAttribute("src");
        video.load();
        scheduleShortWorkspacePreview();
      }
    });
    video.src = cacheUrl;
    ensureShortPreviewLayerAudioGraph(state);
    shortPreviewLayerVideos.set(layer.id, state);
  }

  if (state.error) {
    throw state.error;
  }

  const targetSeconds = Math.max(
    0,
    (
      layer.sourceTimeMs
      - cache.sourceStartMs
      + cache.mediaOffsetMs
    ) / 1000
  );
  if (!Number.isFinite(targetSeconds)) {
    state.ready = false;
    return null;
  }
  state.targetSeconds = targetSeconds;
  if (!shortCanvasPlaybackActive) {
    state.video.pause();
  }
  const playbackPhase = shortCanvasPlaybackPriming
    ? "priming"
    : shortCanvasPlaybackActive
      ? "playing"
      : "paused";
  const synchronization = shortPreviewPlaybackDecision({
    phase: playbackPhase,
    targetSeconds,
    decoderSeconds: Math.max(0, Number(state.video.currentTime) || 0),
    seeking: state.video.seeking || state.seekingTargetSeconds !== null,
    policy: {
      exactSeekToleranceSeconds: SHORT_PREVIEW_LAYER_PAUSED_DRIFT_SECONDS,
      playingHardResyncThresholdSeconds:
        SHORT_PREVIEW_LAYER_PLAYING_RESYNC_SECONDS
    }
  });
  if (
    synchronization.shouldSeek
    && synchronization.seekTargetSeconds !== null
  ) {
    state.ready = false;
    if (playbackPhase === "playing") {
      if (
        performance.now() - shortCanvasPlaybackAnchorPerformanceMs
        >= SHORT_PREVIEW_PLAYBACK_START_GRACE_MS
      ) {
        requestShortCanvasPlaybackReprime(shortCanvasTimelineMsFromClock());
      }
      state.ready = (
        state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !state.video.seeking
        && state.seekingTargetSeconds === null
      );
      return state.ready ? state.video : null;
    }
    if (state.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      return null;
    }
    const previousSeekTarget = state.seekingTargetSeconds;
    if (
      previousSeekTarget === null
      || Math.abs(previousSeekTarget - targetSeconds)
        > SHORT_PREVIEW_LAYER_PLAYING_RESYNC_SECONDS
    ) {
      state.seekingTargetSeconds = synchronization.seekTargetSeconds;
      state.video.currentTime = synchronization.seekTargetSeconds;
    }
  } else if (
    state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && !state.video.seeking
    && state.seekingTargetSeconds === null
  ) {
    state.ready = true;
  }
  if (shortCanvasPlaybackActive && state.ready) {
    requestShortPreviewLayerPlay(layer.id, state);
    scheduleShortPreviewLayerDecodedFrame(layer.id, state);
  }
  return state.ready ? state.video : null;
}

function releaseShortPreviewFallbackSurface(): void {
  if (shortPreviewFallbackSurface) {
    shortPreviewFallbackSurface.width = 1;
    shortPreviewFallbackSurface.height = 1;
  }
  shortPreviewFallbackSurface = null;
}

function cancelScheduledShortWorkspacePreview(): void {
  if (shortPreviewDrawFrame !== null) {
    cancelAnimationFrame(shortPreviewDrawFrame);
    shortPreviewDrawFrame = null;
  }
}

function scheduleShortWorkspacePreview(): void {
  if (workspaceMode !== "short-form" || shortPreviewDrawFrame !== null) {
    return;
  }
  shortPreviewDrawFrame = requestAnimationFrame(() => {
    shortPreviewDrawFrame = null;
    drawShortWorkspacePreview();
  });
}

function disableShortPreviewAdaptiveScaler(error: unknown): void {
  releaseShortPreviewAdaptiveScaler();
  if (!shortPreviewAdaptiveScalerUnavailable) {
    console.warn(
      "적응형 쇼츠 화질 보정을 사용할 수 없어 Canvas2D 보간으로 전환합니다.",
      error
    );
  }
  shortPreviewAdaptiveScalerUnavailable = true;
  if (workspaceMode === "short-form") {
    renderShortFramingInspector();
  }
}

function ensureShortPreviewAdaptiveScaler(
  outputWidth: number,
  outputHeight: number
): AdaptiveVideoScaler | null {
  if (shortPreviewAdaptiveScalerUnavailable) {
    return null;
  }
  if (
    shortPreviewAdaptiveScaler
    && shortPreviewAdaptiveScaler.surface.width === outputWidth
    && shortPreviewAdaptiveScaler.surface.height === outputHeight
  ) {
    return shortPreviewAdaptiveScaler;
  }
  releaseShortPreviewAdaptiveScaler();
  try {
    const surface = new OffscreenCanvas(outputWidth, outputHeight);
    shortPreviewAdaptiveScaler = new AdaptiveVideoScaler(surface);
    return shortPreviewAdaptiveScaler;
  } catch (error) {
    disableShortPreviewAdaptiveScaler(error);
    return null;
  }
}

function ensureShortPreviewFallbackSurface(
  outputWidth: number,
  outputHeight: number
): {
  surface: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
} {
  if (
    !shortPreviewFallbackSurface
    || shortPreviewFallbackSurface.width !== outputWidth
    || shortPreviewFallbackSurface.height !== outputHeight
  ) {
    releaseShortPreviewFallbackSurface();
    shortPreviewFallbackSurface = new OffscreenCanvas(
      outputWidth,
      outputHeight
    );
  }
  const context = shortPreviewFallbackSurface.getContext("2d", {
    alpha: false
  });
  if (!context) {
    throw new Error("쇼츠 대체 미리보기 캔버스를 준비하지 못했습니다.");
  }
  enableHighQualityImageSmoothing(context);
  return { surface: shortPreviewFallbackSurface, context };
}

function shortPreviewLayerGeometry(
  layer: ActiveShortFormVideoAsset,
  video: HTMLVideoElement,
  outputWidth: number,
  outputHeight: number
): {
  source: { left: number; top: number; width: number; height: number };
  destination: { left: number; top: number; width: number; height: number };
} | null {
  const sourceRect = normalizeShortFormSourceRect(layer.sourceRect);
  const destinationRect = normalizeShortFormDestinationRect(
    layer.destinationRect
  );
  if (!sourceRect || !destinationRect) {
    return null;
  }
  const source = shortFormSourceCropFromNormalizedRect(
    video.videoWidth,
    video.videoHeight,
    sourceRect
  );
  const destination = shortFormDestinationRectForTarget(
    outputWidth,
    outputHeight,
    destinationRect
  );
  return source && destination
    ? {
      source: {
        left: source.left,
        top: source.top,
        width: source.width,
        height: source.height
      },
      destination: {
        left: destination.left,
        top: destination.top,
        width: destination.width,
        height: destination.height
      }
    }
    : null;
}

function drawMultiLayerShortWorkspacePreview(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  layers: readonly ActiveShortFormVideoAsset[]
): boolean {
  const visibleLayers = layers.filter((layer) => layer.visible && layer.opacity > 0);
  const activeAssetIds = new Set(visibleLayers.map((layer) => layer.id));
  // Hidden, transparent, and temporally inactive layers must not retain a
  // decoder. They are recreated from the current master clock when needed.
  releaseShortPreviewLayerVideos(activeAssetIds);
  const preparedLayers: Array<{
    layer: ActiveShortFormVideoAsset;
    video: HTMLVideoElement;
    geometry: NonNullable<ReturnType<typeof shortPreviewLayerGeometry>>;
  }> = [];
  let pendingLayerCount = 0;
  for (const layer of visibleLayers) {
    let video: HTMLVideoElement | null = null;
    try {
      video = ensureShortPreviewLayerVideo(layer);
    } catch (error) {
      shortPreviewCacheError = errorDetails(error);
      pendingLayerCount += 1;
      console.warn(`${layer.id} 영상만 미리보기에서 제외했습니다.`, error);
      continue;
    }
    if (
      !video
      || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      || !video.videoWidth
      || !video.videoHeight
    ) {
      pendingLayerCount += 1;
      continue;
    }
    const geometry = shortPreviewLayerGeometry(layer, video, width, height);
    if (!geometry) {
      shortPreviewCacheError = `${layer.id} 영상의 화면 배치를 계산하지 못했습니다.`;
      pendingLayerCount += 1;
      continue;
    }
    preparedLayers.push({ layer, video, geometry });
  }
  if (visibleLayers.length > 0 && preparedLayers.length === 0) {
    return false;
  }

  // The interactive canvas is 540x960. Rendering the live preview directly at
  // that pixel size avoids a four-times-larger 1080x1920 GPU pass followed by
  // an immediate downscale. Export remains on the independent full-resolution
  // 1080x1920 path in media-engine.
  const fallback = ensureShortPreviewFallbackSurface(width, height);
  const resetCompositor = () => {
    fallback.context.save();
    fallback.context.globalAlpha = 1;
    fallback.context.globalCompositeOperation = "source-over";
    fallback.context.fillStyle = "#000";
    fallback.context.fillRect(
      0,
      0,
      width,
      height
    );
    fallback.context.restore();
  };
  const compositeCanvas2D = () => {
    // An adaptive pass may have already staged earlier layers. Rebuild the
    // complete frame so one published frame never mixes quality backends.
    resetCompositor();
    for (const { layer, video, geometry } of preparedLayers) {
      fallback.context.save();
      fallback.context.globalCompositeOperation = "source-over";
      fallback.context.globalAlpha = layer.opacity;
      fallback.context.drawImage(
        video,
        geometry.source.left,
        geometry.source.top,
        geometry.source.width,
        geometry.source.height,
        geometry.destination.left,
        geometry.destination.top,
        geometry.destination.width,
        geometry.destination.height
      );
      fallback.context.restore();
    }
  };

  const adaptiveScaler = ensureShortPreviewAdaptiveScaler(width, height);
  if (adaptiveScaler) {
    const qualityWasPending = (
      adaptiveScaler.capabilityStatus.warmFrameTiming === "pending"
    );
    resetCompositor();
    try {
      // The scaler clears its own surface per call. Copy every completed layer
      // immediately into the canonical compositor in back-to-front order.
      for (const { layer, video, geometry } of preparedLayers) {
        adaptiveScaler.renderHtmlVideo(video, {
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
          outputWidth: width,
          outputHeight: height
        });
        fallback.context.save();
        fallback.context.globalCompositeOperation = "source-over";
        fallback.context.globalAlpha = layer.opacity;
        fallback.context.drawImage(adaptiveScaler.surface, 0, 0);
        fallback.context.restore();
      }
      if (
        qualityWasPending
        && adaptiveScaler.capabilityStatus.warmFrameTiming === "passed"
      ) {
        renderShortFramingInspector();
      }
    } catch (error) {
      disableShortPreviewAdaptiveScaler(error);
      compositeCanvas2D();
    }
  } else {
    compositeCanvas2D();
  }

  elements.short_workspace_preview.dataset.previewState = pendingLayerCount > 0
    ? "preparing"
    : "ready";
  elements.short_workspace_preview.setAttribute(
    "aria-busy",
    String(pendingLayerCount > 0)
  );
  context.drawImage(
    fallback.surface,
    0,
    0,
    width,
    height
  );
  return true;
}

function drawShortWorkspacePreviewStatus(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  message: string,
  state: "empty" | "preparing" | "error"
): void {
  elements.short_workspace_preview.dataset.previewState = state;
  elements.short_workspace_preview.setAttribute(
    "aria-busy",
    String(state === "preparing")
  );
  context.save();
  context.globalAlpha = 1;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = state === "error" ? "#ff9b9b" : "#8994a3";
  context.font = "700 20px Pretendard, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, width / 2, height / 2);
  context.restore();
}

function drawShortWorkspacePreview(): void {
  if (workspaceMode !== "short-form") {
    return;
  }
  const canvas = elements.short_workspace_preview;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    releaseShortPreviewLayerVideos();
    return;
  }
  enableHighQualityImageSmoothing(context);
  const width = canvas.width;
  const height = canvas.height;
  const previewTimelineMs = shortCanvasTimelineMsFromClock();
  const activeLayers = shortFormVideoAssetsAtTimeline(
    project.shortForm,
    previewTimelineMs
  );
  try {
    if (!drawMultiLayerShortWorkspacePreview(
      context,
      width,
      height,
      activeLayers
    )) {
      drawShortWorkspacePreviewStatus(
        context,
        width,
        height,
        "영상 화면 준비 중",
        "preparing"
      );
    }
  } catch (error) {
    const activeAssetIds = new Set(
      activeLayers
        .filter((layer) => (
          layer.visible
          && layer.opacity > 0
        ))
        .map((layer) => layer.id)
    );
    // A failed auxiliary decoder has already released its media resource.
    // Preserve only its terminal state while that layer remains active so the
    // next master frame cannot recreate the same broken decoder forever.
    releaseShortPreviewLayerVideos(activeAssetIds);
    drawShortWorkspacePreviewStatus(
      context,
      width,
      height,
      "쇼츠 합성 미리보기를 준비하지 못했습니다",
      "error"
    );
    console.warn("쇼츠 실제 합성 미리보기를 그리지 못했습니다.", error);
  }
}

function renderShortSourceComposer(): void {
  const active = (
    workspaceMode === "main"
    && shortSourceComposerActive
  );
  elements.short_source_composer.hidden = !active;
  elements.short_source_crop_surface.hidden = !active;
  elements.short_source_composer.setAttribute(
    "aria-busy",
    String(active && shortSourceBoundaryPreviewInFlight)
  );
  elements.stage.classList.toggle("short-source-composing", active);
  elements.start_short_source_composer.classList.toggle("active", active);
  elements.start_short_source_composer.setAttribute("aria-pressed", String(active));
  elements.start_short_source_composer.setAttribute("aria-expanded", String(active));
  if (!active) {
    return;
  }

  elements.short_source_composer_panel.dataset.collapsed = String(
    shortSourceComposerCollapsed
  );
  elements.short_source_composer_body.hidden = shortSourceComposerCollapsed;
  elements.toggle_short_source_composer_collapse.setAttribute(
    "aria-expanded",
    String(!shortSourceComposerCollapsed)
  );
  elements.toggle_short_source_composer_collapse.setAttribute(
    "aria-label",
    shortSourceComposerCollapsed
      ? "쇼츠 소스 설정 펼치기"
      : "쇼츠 소스 설정 접기"
  );
  elements.toggle_short_source_composer_collapse.title = shortSourceComposerCollapsed
    ? "설정 펼치기"
    : "설정 접기";
  elements.toggle_short_source_composer_collapse.textContent = shortSourceComposerCollapsed
    ? "☰"
    : "−";

  const addingVideoLayer = pendingShortVideoAssetTimelineMs !== null;
  elements.short_source_layer_intent.hidden = !addingVideoLayer;
  elements.cancel_short_video_layer_add.textContent = shortSourcePickerReturnState
    ? "쇼츠 편집으로 돌아가기"
    : "새 장면으로 만들기";
  elements.short_source_composer_title.textContent = addingVideoLayer
    ? "현재 쇼츠에 추가할 영상"
    : "쇼츠로 가져올 구간과 화면";
  elements.short_source_composer_description.textContent = addingVideoLayer
    ? "현재 본편에서 시간 범위와 화면을 고릅니다. 쇼츠의 현재 재생 시각부터 새 영상으로 배치됩니다."
    : "본편의 시간 범위와 원본 화면 영역만 골라 보냅니다. 본편 컷은 바뀌지 않습니다.";
  elements.add_short_source_only.hidden = addingVideoLayer;
  elements.add_short_source_and_open.textContent = addingVideoLayer
    ? "영상 추가하고 쇼츠 편집으로"
    : "추가하고 쇼츠에서 배치";

  const dimensions = shortSourceReferenceDimensions();
  if (dimensions) {
    shortSourceCropDraft = normalizeShortSourceCropDraft(
      shortSourceCropDraft || { x: 0, y: 0, width: 1, height: 1 },
      dimensions
    );
  }
  const crop = shortSourceCropDraft;
  const pixels = shortSourceCropPixels(crop);
  const range = selectedTimelineRange();
  const contentRect = videoContentRect(elements.stage);
  elements.short_source_crop_surface.style.left = `${contentRect.left}px`;
  elements.short_source_crop_surface.style.top = `${contentRect.top}px`;
  elements.short_source_crop_surface.style.width = `${contentRect.width}px`;
  elements.short_source_crop_surface.style.height = `${contentRect.height}px`;

  if (crop) {
    elements.short_source_crop_box.style.left = `${crop.x * 100}%`;
    elements.short_source_crop_box.style.top = `${crop.y * 100}%`;
    elements.short_source_crop_box.style.width = `${crop.width * 100}%`;
    elements.short_source_crop_box.style.height = `${crop.height * 100}%`;
  }
  const setInputValue = (control: EditorControl, value: number | string) => {
    if (document.activeElement !== control) {
      control.value = String(value);
    }
  };
  setInputValue(
    elements.short_source_start_time,
    formatTime(rangeStartMs ?? project.playheadMs, { compact: true })
  );
  setInputValue(
    elements.short_source_end_time,
    formatTime(rangeEndMs ?? project.playheadMs, { compact: true })
  );
  if (pixels) {
    setInputValue(elements.short_source_crop_x, pixels.x);
    setInputValue(elements.short_source_crop_y, pixels.y);
    setInputValue(elements.short_source_crop_width, pixels.width);
    setInputValue(elements.short_source_crop_height, pixels.height);
  }
  elements.short_source_crop_x.max = String(Math.max(0, (crop?.referenceWidth || 1) - 1));
  elements.short_source_crop_y.max = String(Math.max(0, (crop?.referenceHeight || 1) - 1));
  elements.short_source_crop_width.max = String(crop?.referenceWidth || 1);
  elements.short_source_crop_height.max = String(crop?.referenceHeight || 1);

  const composerInteractionLocked = (
    shortSourceBoundaryPreviewInFlight
    || Boolean(activeJobController)
    || projectMutationLockCount > 0
  );
  for (const control of elements.short_source_composer.querySelectorAll<
    HTMLButtonElement | HTMLInputElement
  >("button, input")) {
    control.disabled = composerInteractionLocked;
  }
  elements.short_source_crop_surface.setAttribute(
    "aria-disabled",
    String(composerInteractionLocked)
  );
  const disabled = !range || !crop || composerInteractionLocked;
  elements.add_short_source_only.disabled = disabled || addingVideoLayer;
  elements.add_short_source_and_open.disabled = disabled;
  const timeControlsDisabled = composerInteractionLocked;
  const startClip = shortSourceBoundaryClip("start");
  const endClip = shortSourceBoundaryClip("end");
  const startMs = rangeStartMs;
  const remainingInStartClipMs = startClip && Number.isFinite(startMs)
    ? startClip.timelineStartMs + clipDurationMs(startClip) - startMs!
    : 0;
  elements.short_source_whole_clip.disabled = timeControlsDisabled || !startClip;
  elements.short_source_to_clip_end.disabled = (
    timeControlsDisabled
    || !startClip
    || remainingInStartClipMs < MIN_TIMELINE_RANGE_MS
  );
  elements.short_source_start_to_clip_start.disabled = timeControlsDisabled || !startClip;
  elements.short_source_end_to_clip_end.disabled = timeControlsDisabled || !endClip;
  elements.preview_short_source_start.disabled = timeControlsDisabled
    || !Number.isFinite(rangeStartMs);
  elements.preview_short_source_end.disabled = timeControlsDisabled
    || !Number.isFinite(rangeEndMs);
  const startClipIndex = startClip
    ? project.clips.findIndex((clip) => clip.id === startClip.id)
    : -1;
  elements.short_source_whole_clip.title = startClipIndex >= 0
    ? `${startClipIndex + 1}번 컷의 시작부터 끝까지 선택`
    : "선택 시작점이 속한 컷 전체";
  elements.short_source_to_clip_end.title = startClipIndex >= 0
    ? `${startClipIndex + 1}번 컷 끝까지 ${formatDuration(Math.max(0, remainingInStartClipMs))}`
    : "선택 시작점부터 그 컷의 끝까지";
  for (const button of elements.short_source_composer.querySelectorAll<HTMLButtonElement>(
    "button[data-short-source-boundary][data-short-source-delta-ms]"
  )) {
    button.disabled = timeControlsDisabled;
  }
  const quality = crop
    ? shortFormQualityAssessment(crop, defaultShortDestinationRect(crop))
    : null;
  elements.short_source_readout.dataset.quality = quality?.level || "notice";
  elements.short_source_readout.textContent = pixels && range
    ? `원본 ${pixels.x}, ${pixels.y} · ${pixels.width}×${pixels.height}px · ${formatDuration(range.endMs - range.startMs)} · ${quality?.text || "품질 계산 중"} · 쇼츠 캔버스에서 별도 이동·크기 조절`
    : "0.1초 이상의 구간과 사용할 화면을 정해 주세요.";
  elements.short_source_crop_move.setAttribute(
    "aria-label",
    pixels
      ? `사용할 원본 화면 ${pixels.x}, ${pixels.y}, ${pixels.width} 곱하기 ${pixels.height}픽셀. 드래그로 이동하고 가장자리 손잡이로 크기를 조절합니다.`
      : "쇼츠에 사용할 원본 화면"
  );
  for (const button of elements.short_source_composer.querySelectorAll<HTMLButtonElement>(
    "button[data-short-source-aspect]"
  )) {
    const pressed = button.dataset.shortSourceAspect === shortSourceAspect;
    button.setAttribute("aria-pressed", String(pressed));
  }
}

function setShortSourceAspect(value: string): void {
  if (!shortSourceComposerActive) {
    return;
  }
  if (value === "full") {
    shortSourceAspect = "free";
    shortSourceCropDraft = normalizeShortSourceCropDraft({
      x: 0,
      y: 0,
      width: 1,
      height: 1
    });
    renderShortSourceComposer();
    return;
  }
  shortSourceAspect = value === "9:16"
    ? "9:16"
    : value === "1:1"
      ? "1:1"
      : "free";
  const ratio = shortSourceAspectRatio();
  const pixels = shortSourceCropPixels();
  if (ratio && pixels) {
    shortSourceCropDraft = shortSourceCropFromPixels(
      cropPixelsWithAspect(pixels, ratio)
    );
  }
  renderShortSourceComposer();
}

function setShortSourceCropPixelField(
  field: "x" | "y" | "width" | "height",
  rawValue: unknown
): void {
  const pixels = shortSourceCropPixels();
  if (!shortSourceComposerActive || !pixels) {
    return;
  }
  const value = Math.round(Number(rawValue));
  if (!Number.isFinite(value)) {
    renderShortSourceComposer();
    return;
  }
  const next = { ...pixels, [field]: value };
  const ratio = shortSourceAspectRatio();
  const adjusted = ratio && (field === "width" || field === "height")
    ? cropPixelsWithAspect(
      next,
      ratio,
      "center",
      field === "width" ? "horizontal" : "vertical"
    )
    : next;
  shortSourceCropDraft = shortSourceCropFromPixels(adjusted);
  renderShortSourceComposer();
}

function shortSourceCropAfterPixelDelta(
  start: ShortSourceCropDraft,
  handle: string,
  deltaX: number,
  deltaY: number
): ShortSourceCropDraft | null {
  const startPixels = shortSourceCropPixels(start);
  const dimensions = shortSourceReferenceDimensions();
  if (!startPixels || !dimensions) {
    return null;
  }
  if (handle === "move") {
    return shortSourceCropFromPixels({
      ...startPixels,
      x: startPixels.x + Math.round(deltaX),
      y: startPixels.y + Math.round(deltaY)
    });
  }
  let left = startPixels.x;
  let top = startPixels.y;
  let right = startPixels.x + startPixels.width;
  let bottom = startPixels.y + startPixels.height;
  if (handle.includes("w")) {
    left = clampNumber(left + deltaX, 0, right - 1);
  }
  if (handle.includes("e")) {
    right = clampNumber(right + deltaX, left + 1, dimensions.width);
  }
  if (handle.includes("n")) {
    top = clampNumber(top + deltaY, 0, bottom - 1);
  }
  if (handle.includes("s")) {
    bottom = clampNumber(bottom + deltaY, top + 1, dimensions.height);
  }
  let next = {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
  const ratio = shortSourceAspectRatio();
  if (ratio) {
    const corner = (
      (handle.includes("e") || handle.includes("w"))
      && (handle.includes("n") || handle.includes("s"))
    );
    next = cropPixelsWithAspect(
      next,
      ratio,
      handle,
      corner
        ? Math.abs(deltaX) >= Math.abs(deltaY * ratio)
          ? "horizontal"
          : "vertical"
        : null
    );
  }
  return shortSourceCropFromPixels(next);
}

function beginShortSourceCropGesture(event: PointerEvent): void {
  if (
    !shortSourceComposerActive
    || shortSourceBoundaryPreviewInFlight
    || event.button !== 0
    || !event.isPrimary
    || !shortSourceCropDraft
  ) {
    return;
  }
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-short-source-crop-handle], [data-short-source-crop-move]"
  );
  if (!target) {
    return;
  }
  const bounds = elements.short_source_crop_surface.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  // `preventDefault()` suppresses the button's native pointer focus. Keep the
  // crop control focused so users can drag and immediately nudge with arrows.
  target.focus({ preventScroll: true });
  const handle = target.dataset.shortSourceCropHandle || "move";
  shortSourceCropGesture = {
    pointerId: event.pointerId,
    handle,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRect: { ...shortSourceCropDraft },
    surfaceWidth: bounds.width,
    surfaceHeight: bounds.height
  };
  elements.short_source_crop_box.dataset.dragging = "true";
  elements.short_source_crop_surface.setPointerCapture(event.pointerId);
}

function updateShortSourceCropGesture(event: PointerEvent): void {
  const gesture = shortSourceCropGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) {
    return;
  }
  event.preventDefault();
  const deltaX = (
    (event.clientX - gesture.startClientX)
    / gesture.surfaceWidth
    * gesture.startRect.referenceWidth
  );
  const deltaY = (
    (event.clientY - gesture.startClientY)
    / gesture.surfaceHeight
    * gesture.startRect.referenceHeight
  );
  shortSourceCropDraft = shortSourceCropAfterPixelDelta(
    gesture.startRect,
    gesture.handle,
    deltaX,
    deltaY
  );
  renderShortSourceComposer();
}

function finishShortSourceCropGesture(
  event: PointerEvent,
  { cancel = false }: { cancel?: boolean } = {}
): void {
  const gesture = shortSourceCropGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) {
    return;
  }
  if (cancel) {
    shortSourceCropDraft = { ...gesture.startRect };
  }
  shortSourceCropGesture = null;
  delete elements.short_source_crop_box.dataset.dragging;
  if (elements.short_source_crop_surface.hasPointerCapture(event.pointerId)) {
    elements.short_source_crop_surface.releasePointerCapture(event.pointerId);
  }
  renderShortSourceComposer();
}

function nudgeShortSourceCropFromKeyboard(event: KeyboardEvent): void {
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  }[event.key];
  if (!delta || !shortSourceCropDraft || shortSourceBoundaryPreviewInFlight) {
    return;
  }
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-short-source-crop-handle], [data-short-source-crop-move]"
  );
  if (!target) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const step = event.shiftKey ? 10 : 1;
  const handle = target.dataset.shortSourceCropHandle || "move";
  const focusSelector = target.hasAttribute("data-short-source-crop-move")
    ? "[data-short-source-crop-move]"
    : `[data-short-source-crop-handle="${handle}"]`;
  shortSourceCropDraft = shortSourceCropAfterPixelDelta(
    shortSourceCropDraft,
    handle,
    delta[0]! * step,
    delta[1]! * step
  );
  renderShortSourceComposer();
  elements.short_source_crop_surface
    .querySelector<HTMLElement>(focusSelector)
    ?.focus({ preventScroll: true });
}

function timelineWidth() {
  const durationSeconds = Math.max(1, projectDurationMs(project) / 1000);
  const viewport = elements.timeline_scroll.clientWidth || 700;
  return Math.max(viewport - 2, Math.ceil(durationSeconds * pixelsPerSecond));
}

function timelineX(milliseconds: number) {
  return milliseconds / 1000 * pixelsPerSecond;
}

function hideTimelineSnapGuide() {
  elements.timeline_snap_guide.hidden = true;
  elements.timeline_snap_guide.textContent = "";
  elements.timeline_snap_guide.removeAttribute("data-label");
  elements.timeline_snap_guide.removeAttribute("aria-label");
}

function showTimelineSnapGuide(match: TimelineSnapMatch | null) {
  if (!match) {
    hideTimelineSnapGuide();
    return;
  }
  const label = `${match.label || "정렬점"} · ${formatTime(match.timeMs, { compact: true })}`;
  elements.timeline_snap_guide.hidden = false;
  elements.timeline_snap_guide.style.left = `${timelineX(match.timeMs)}px`;
  elements.timeline_snap_guide.dataset.label = label;
  elements.timeline_snap_guide.setAttribute("aria-label", label);
  elements.timeline_snap_guide.textContent = label;
}

function findTimelineSnap(rawTimelineMs: number, {
  clipId,
  movingKind,
  itemId,
  altKey = false,
  minimumTimelineMs = -Infinity,
  maximumTimelineMs = Infinity
}: TimelineSnapOptions = {}) {
  if (!timelineSnapEnabled || altKey) {
    return null;
  }
  const preferredKind = movingKind === "subtitle" ? "asset" : "subtitle";
  const candidates = timelineSnapCandidates(project, {
    clipId,
    excludeCueId: movingKind === "subtitle" ? itemId : null,
    excludeImageAssetId: movingKind === "asset" ? itemId : null,
    preferredKind
  }).filter((candidate) => (
    candidate.timeMs >= minimumTimelineMs
    && candidate.timeMs <= maximumTimelineMs
  ));
  const match = resolveTimelineSnap(rawTimelineMs, candidates, {
    thresholdMs: timelineSnapThresholdMs(pixelsPerSecond, {
      thresholdPx: TIMELINE_SNAP_THRESHOLD_PX
    })
  });
  return match && typeof match.timeMs === "number"
    ? match as TimelineSnapMatch
    : null;
}

function snappedTimelinePoint(
  rawTimelineMs: number,
  options: TimelineSnapOptions
) {
  const match = findTimelineSnap(rawTimelineMs, options);
  showTimelineSnapGuide(match);
  return match?.timeMs ?? Math.round(rawTimelineMs);
}

function findShortVideoTimelineSnap(
  rawTimelineMs: number,
  assetId: string,
  lane: number,
  {
    altKey = false,
    minimumTimelineMs = 0,
    maximumTimelineMs = Infinity,
    canvasDurationMs = project.shortForm.durationMs
  }: {
    altKey?: boolean;
    minimumTimelineMs?: number;
    maximumTimelineMs?: number;
    canvasDurationMs?: number;
  } = {}
): TimelineSnapMatch | null {
  if (
    workspaceMode !== "short-form"
    || !timelineSnapEnabled
    || altKey
  ) {
    return null;
  }
  const candidates = [
    {
      timeMs: 0,
      kind: "canvas",
      edge: "start",
      itemId: null,
      label: "캔버스 시작",
      priority: 1
    },
    {
      timeMs: canvasDurationMs,
      kind: "canvas",
      edge: "end",
      itemId: null,
      label: "캔버스 끝",
      priority: 1
    },
    {
      timeMs: project.playheadMs,
      kind: "playhead",
      edge: "point",
      itemId: null,
      label: "재생 헤드",
      priority: 2
    },
    ...project.shortForm.videoAssets
      .filter((candidate) => (
        candidate.id !== assetId && candidate.lane === lane
      ))
      .flatMap((candidate) => ([
        {
          timeMs: candidate.timelineStartMs,
          kind: "video",
          edge: "start",
          itemId: candidate.id,
          label: `L${lane + 1} 영상 시작`,
          priority: 0
        },
        {
          timeMs: candidate.timelineEndMs,
          kind: "video",
          edge: "end",
          itemId: candidate.id,
          label: `L${lane + 1} 영상 끝`,
          priority: 0
        }
      ]))
  ].filter((candidate) => (
    candidate.timeMs >= minimumTimelineMs
    && candidate.timeMs <= maximumTimelineMs
  ));
  const match = resolveTimelineSnap(rawTimelineMs, candidates, {
    thresholdMs: timelineSnapThresholdMs(pixelsPerSecond, {
      thresholdPx: TIMELINE_SNAP_THRESHOLD_PX
    })
  });
  return match && typeof match.timeMs === "number"
    ? match as TimelineSnapMatch
    : null;
}

function bestShortVideoMoveSnap(
  rawStartMs: number,
  rawEndMs: number,
  assetId: string,
  lane: number,
  altKey: boolean,
  canvasDurationMs: number
): TimelineSnapMatch | null {
  return [
    findShortVideoTimelineSnap(rawStartMs, assetId, lane, {
      altKey,
      canvasDurationMs
    }),
    findShortVideoTimelineSnap(rawEndMs, assetId, lane, {
      altKey,
      canvasDurationMs
    })
  ]
    .filter((candidate): candidate is TimelineSnapMatch => Boolean(candidate))
    .sort((first, second) => (
      first.distanceMs - second.distanceMs
      || first.priority - second.priority
      || first.timeMs - second.timeMs
    ))[0] || null;
}

function suppressNextTimedBlockClick(kind: TimedBlockKind, itemId: string) {
  clearTimeout(suppressedTimedBlockClickTimer ?? undefined);
  suppressedTimedBlockClick = `${kind}:${itemId}`;
  suppressedTimedBlockClickTimer = setTimeout(() => {
    suppressedTimedBlockClick = null;
    suppressedTimedBlockClickTimer = null;
  }, 0);
}

function consumeSuppressedTimedBlockClick(kind: TimedBlockKind, itemId: string) {
  const key = `${kind}:${itemId}`;
  if (suppressedTimedBlockClick !== key) {
    return false;
  }
  clearTimeout(suppressedTimedBlockClickTimer ?? undefined);
  suppressedTimedBlockClick = null;
  suppressedTimedBlockClickTimer = null;
  return true;
}

function clampTimelineMs(milliseconds: number) {
  return Math.max(
    0,
    Math.min(projectDurationMs(project), Math.round(Number(milliseconds) || 0))
  );
}

function selectedTimelineRange() {
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
    return null;
  }
  const startMs = Math.min(rangeStartMs!, rangeEndMs!);
  const endMs = Math.max(rangeStartMs!, rangeEndMs!);
  return endMs - startMs >= MIN_TIMELINE_RANGE_MS
    ? { startMs, endMs }
    : null;
}

function renderTimelineRange() {
  if (!project) {
    return;
  }
  const durationMs = projectDurationMs(project);
  const rangeTools = elements.set_range_start.closest<HTMLElement>(".range-tools");
  if (workspaceMode === "short-form") {
    timelineRangePurpose = "delete";
    rangeStartMs = null;
    rangeEndMs = null;
    if (rangeTools) {
      rangeTools.hidden = true;
    }
    elements.timeline_range_selection.hidden = true;
    elements.timeline_range_selection.classList.remove("valid", "short-source");
    elements.timeline_range_selection.dataset.rangePurpose = "delete";
    elements.range_start_handle.hidden = true;
    elements.range_end_handle.hidden = true;
    elements.timeline_range_summary.hidden = true;
    const contentRange = shortFormCanvasContentRange(project.shortForm);
    const hasEmptyCanvasEdges = Boolean(
      contentRange
      && (contentRange.startMs > 0 || contentRange.endMs < durationMs)
    );
    elements.trim_short_canvas_empty_edges.hidden = false;
    elements.trim_short_canvas_empty_edges.disabled = (
      !hasEmptyCanvasEdges
      || projectMutationLockCount > 0
      || pointerEditActive
      || rangeHandleDragActive
    );
    return;
  }
  elements.trim_short_canvas_empty_edges.hidden = true;
  if (Number.isFinite(rangeStartMs)) {
    rangeStartMs = Math.max(0, Math.min(durationMs, Math.round(rangeStartMs!)));
  }
  if (Number.isFinite(rangeEndMs)) {
    rangeEndMs = Math.max(0, Math.min(durationMs, Math.round(rangeEndMs!)));
  }
  const hasStart = Number.isFinite(rangeStartMs);
  const hasEnd = Number.isFinite(rangeEndMs);
  const rawRange = hasStart && hasEnd
    ? {
      startMs: Math.min(rangeStartMs!, rangeEndMs!),
      endMs: Math.max(rangeStartMs!, rangeEndMs!)
    }
    : null;
  const range = selectedTimelineRange();
  const choosingShortSource = (
    workspaceMode === "main"
    && shortSourceComposerActive
    && timelineRangePurpose === "short-source"
  );
  const anchorMs = rawRange?.startMs ?? (hasStart ? rangeStartMs : rangeEndMs);
  const endMs = rawRange?.endMs ?? anchorMs;
  elements.set_range_start.classList.toggle("active", hasStart);
  elements.set_range_start.setAttribute("aria-pressed", String(hasStart));
  elements.set_range_start.disabled = durationMs === 0;
  elements.set_range_end.classList.toggle("active", hasEnd);
  elements.set_range_end.setAttribute("aria-pressed", String(hasEnd));
  elements.set_range_end.disabled = durationMs === 0;
  elements.clear_range.hidden = !hasStart && !hasEnd;
  elements.clear_range.textContent = "선택 해제";
  elements.delete_range.hidden = choosingShortSource;
  elements.delete_range.textContent = "구간 삭제";
  elements.delete_range.disabled = (
    choosingShortSource ||
    !range ||
    projectMutationLockCount > 0 ||
    pointerEditActive ||
    rangeHandleDragActive
  );

  elements.timeline_range_selection.hidden = (
    !hasStart && !hasEnd
  );
  elements.timeline_range_selection.classList.toggle("valid", Boolean(range));
  elements.timeline_range_selection.classList.toggle("short-source", choosingShortSource);
  elements.timeline_range_selection.dataset.rangePurpose = choosingShortSource
    ? "short-source"
    : "delete";
  elements.timeline_range_selection.style.left = `${timelineX(anchorMs || 0)}px`;
  elements.timeline_range_selection.style.width = `${timelineX(Math.max(0, (endMs || 0) - (anchorMs || 0)))}px`;
  elements.range_start_handle.hidden = !hasStart;
  elements.range_end_handle.hidden = !hasEnd;

  const updateHandle = (
    handle: EditorControl,
    valueMs: number | null,
    minimumMs: number,
    maximumMs: number
  ) => {
    handle.setAttribute("aria-valuemin", String(Math.max(0, minimumMs) / 1000));
    handle.setAttribute("aria-valuemax", String(Math.max(minimumMs, maximumMs) / 1000));
    handle.setAttribute("aria-valuenow", String((valueMs ?? 0) / 1000));
    handle.setAttribute("aria-valuetext", formatTime(valueMs ?? 0));
  };
  updateHandle(
    elements.range_start_handle,
    rawRange?.startMs ?? rangeStartMs,
    0,
    range ? Math.max(0, range.endMs - MIN_TIMELINE_RANGE_MS) : durationMs
  );
  updateHandle(
    elements.range_end_handle,
    rawRange?.endMs ?? rangeEndMs,
    range ? Math.min(durationMs, range.startMs + MIN_TIMELINE_RANGE_MS) : 0,
    durationMs
  );
  elements.range_start_handle.setAttribute(
    "aria-label",
    choosingShortSource
      ? "쇼츠 소스 시작 시각"
      : "삭제 구간 시작 시각"
  );
  elements.range_end_handle.setAttribute(
    "aria-label",
    choosingShortSource
      ? "쇼츠 소스 끝 시각"
      : "삭제 구간 끝 시각"
  );

  elements.timeline_range_summary.hidden = !rawRange;
  elements.timeline_range_summary.textContent = range
    ? `${formatTime(range.startMs, { compact: true })}–${formatTime(range.endMs, { compact: true })} · ${formatDuration(range.endMs - range.startMs)} ${choosingShortSource ? "쇼츠 소스" : "삭제"}`
    : rawRange
      ? `${formatDuration(rawRange.endMs - rawRange.startMs)} · 0.1초 이상 필요`
      : "";

  if (rangeTools) {
    rangeTools.hidden = false;
  }
  rangeTools?.setAttribute(
    "aria-label",
    choosingShortSource
      ? "쇼츠 소스 영상 구간"
      : "영상 구간 삭제"
  );
  elements.set_range_start.title = choosingShortSource
    ? "현재 재생 위치를 쇼츠 소스 시작점으로 지정 (I)"
    : "현재 재생 위치를 삭제 시작점으로 지정 (I)";
  elements.set_range_end.title = choosingShortSource
    ? "현재 재생 위치를 쇼츠 소스 끝점으로 지정 (O)"
    : "현재 재생 위치를 삭제 끝점으로 지정 (O)";
  elements.clear_range.title = choosingShortSource
    ? "쇼츠 소스 구간 선택 해제 (Esc)"
    : "삭제 구간 선택 해제 (Esc)";
  elements.delete_range.title = "선택한 영상 구간 삭제 (Delete)";
  elements.set_range_start.setAttribute(
    "aria-label",
    elements.set_range_start.title
  );
  elements.set_range_end.setAttribute(
    "aria-label",
    elements.set_range_end.title
  );
}

function setTimelineRangeBoundary(side: RangeBoundarySide, milliseconds: number, {
  constrain = false
} = {}) {
  if (shortSourceBoundaryPreviewInFlight) {
    return;
  }
  let valueMs = clampTimelineMs(milliseconds);
  if (side === "start") {
    if (constrain && Number.isFinite(rangeEndMs)) {
      valueMs = Math.min(valueMs, Math.max(0, rangeEndMs! - MIN_TIMELINE_RANGE_MS));
    }
    rangeStartMs = valueMs;
  } else {
    if (constrain && Number.isFinite(rangeStartMs)) {
      valueMs = Math.max(valueMs, Math.min(projectDurationMs(project), rangeStartMs! + MIN_TIMELINE_RANGE_MS));
    }
    rangeEndMs = valueMs;
  }
  if (!constrain && Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) && rangeStartMs! > rangeEndMs!) {
    [rangeStartMs, rangeEndMs] = [rangeEndMs, rangeStartMs];
  }
  renderTimelineRange();
  renderShortSourceComposer();
  if (shortSourceComposerActive) {
    const control = side === "start"
      ? elements.short_source_start_time
      : elements.short_source_end_time;
    const canonicalMs = side === "start" ? rangeStartMs : rangeEndMs;
    if (Number.isFinite(canonicalMs)) {
      control.value = formatTime(canonicalMs!, { compact: true });
    }
  }
}

function setShortSourceRange(
  startMsValue: unknown,
  endMsValue: unknown
): boolean {
  const startMs = clampTimelineMs(Number(startMsValue));
  const endMs = clampTimelineMs(Number(endMsValue));
  if (endMs - startMs < MIN_TIMELINE_RANGE_MS) {
    showToast("쇼츠 소스는 0.1초 이상이어야 합니다.", "error");
    return false;
  }
  rangeStartMs = startMs;
  rangeEndMs = endMs;
  renderTimelineRange();
  renderShortSourceComposer();
  return true;
}

function setShortSourceRangeFromStartClip(wholeClip: boolean): boolean {
  if (!shortSourceComposerActive) {
    return false;
  }
  const clip = shortSourceBoundaryClip("start");
  const startMs = wholeClip ? clip?.timelineStartMs : rangeStartMs;
  const endMs = clip
    ? clip.timelineStartMs + clipDurationMs(clip)
    : null;
  if (!clip || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    showToast("선택 시작점이 속한 컷을 찾지 못했습니다.", "error");
    return false;
  }
  if (!setShortSourceRange(startMs!, endMs!)) {
    return false;
  }
  showToast(
    wholeClip
      ? "선택 시작점이 속한 컷 전체를 쇼츠 소스로 맞췄습니다."
      : "선택 시작점부터 이 컷의 끝까지 맞췄습니다.",
    "success"
  );
  return true;
}

function setShortSourceBoundaryToClipEdge(side: RangeBoundarySide): boolean {
  const clip = shortSourceBoundaryClip(side);
  if (!clip) {
    showToast("이 시각이 속한 컷을 찾지 못했습니다.", "error");
    return false;
  }
  const timelineMs = side === "start"
    ? clip.timelineStartMs
    : clip.timelineStartMs + clipDurationMs(clip);
  setTimelineRangeBoundary(side, timelineMs, { constrain: true });
  return true;
}

function adjustShortSourceBoundary(
  side: RangeBoundarySide,
  deltaMsValue: unknown
): boolean {
  const currentMs = side === "start" ? rangeStartMs : rangeEndMs;
  const deltaMs = Number(deltaMsValue);
  if (!Number.isFinite(currentMs) || !Number.isFinite(deltaMs)) {
    return false;
  }
  setTimelineRangeBoundary(side, currentMs! + deltaMs, { constrain: true });
  return true;
}

async function previewShortSourceBoundary(
  side: RangeBoundarySide
): Promise<void> {
  const boundaryMs = side === "start" ? rangeStartMs : rangeEndMs;
  if (
    shortSourceBoundaryPreviewInFlight
    || !shortSourceComposerActive
    || !Number.isFinite(boundaryMs)
  ) {
    return;
  }
  shortSourceBoundaryPreviewInFlight = true;
  renderShortSourceComposer();
  const targetMs = side === "end"
    ? Math.max(rangeStartMs ?? 0, boundaryMs! - 1)
    : boundaryMs!;
  elements.preview_video.pause();
  try {
    await seekTimeline(targetMs);
  } catch (error: unknown) {
    showToast(`경계 프레임을 열지 못했습니다: ${errorMessage(error)}`, "error");
  } finally {
    shortSourceBoundaryPreviewInFlight = false;
    renderShortSourceComposer();
  }
}

function clearTimelineRangeSelection({ render = true } = {}) {
  rangeStartMs = null;
  rangeEndMs = null;
  if (render) {
    renderTimelineRange();
    renderShortSourceComposer();
  }
}

function nudgeTimelineRangeBoundary(side: RangeBoundarySide, deltaMs: number) {
  const currentMs = side === "start" ? rangeStartMs : rangeEndMs;
  if (!Number.isFinite(currentMs)) {
    return;
  }
  setTimelineRangeBoundary(side, currentMs! + deltaMs, { constrain: true });
  const handle = side === "start"
    ? elements.range_start_handle
    : elements.range_end_handle;
  handle.focus({ preventScroll: true });
}

function bindTimelineRangeHandle(
  handle: EditorControl,
  side: RangeBoundarySide,
  event: PointerEvent
) {
  event.preventDefault();
  event.stopPropagation();
  rangeHandleDragActive = true;
  renderTimelineRange();
  const pointerId = event.pointerId;
  handle.setPointerCapture(pointerId);
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const rect = elements.timeline_content.getBoundingClientRect();
    const timelineMs = (moveEvent.clientX - rect.left) / pixelsPerSecond * 1000;
    setTimelineRangeBoundary(side, timelineMs, { constrain: true });
  };
  const finish = (finishEvent: PointerEvent) => {
    if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    rangeHandleDragActive = false;
    renderTimelineRange();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}

function trimShortCanvasEmptyEdges(): boolean {
  if (workspaceMode !== "short-form") {
    return false;
  }
  if (
    pointerEditActive
    || rangeHandleDragActive
    || projectMutationLockCount > 0
  ) {
    showToast("진행 중인 편집 동작을 마친 뒤 쇼츠 앞뒤를 정리해 주세요.", "error");
    return false;
  }
  const previousDurationMs = project.shortForm.durationMs;
  const requestedRange = shortFormCanvasContentRange(project.shortForm);
  if (!requestedRange) {
    showToast(
      "앞뒤를 맞출 영상·사진·자막·음성이 없습니다. 빈 쇼츠 화면은 그대로 유지됩니다.",
      "info"
    );
    return false;
  }
  if (
    requestedRange.startMs === 0
    && requestedRange.endMs === previousDurationMs
  ) {
    showToast("쇼츠 앞뒤에 제거할 빈 구간이 없습니다.");
    return false;
  }

  stopShortCanvasPlayback();
  try {
    const branchAtCurrentPlayhead = {
      ...project.shortForm,
      playheadMs: project.playheadMs
    };
    const shortForm = trimShortFormCanvasToContent(branchAtCurrentPlayhead);
    const next = shortFormWorkspaceProjectWithBranch(project, shortForm);
    rangeStartMs = null;
    rangeEndMs = null;
    applyProject({
      ...next,
      updatedAt: new Date().toISOString()
    });
    void syncPreviewToPlayhead();
    const removedDurationMs = previousDurationMs - shortForm.durationMs;
    showToast(
      `앞뒤 빈 구간을 ${formatDuration(removedDurationMs)}만큼 제거하고 모든 요소를 0초 기준으로 맞췄습니다. Ctrl+Z로 되돌릴 수 있습니다.`,
      "success",
      5200
    );
    return true;
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return false;
  }
}

function deleteSelectedTimelineRange() {
  if (workspaceMode === "short-form") {
    showToast("쇼츠에서는 영상 블록의 양끝을 직접 자르거나 블록을 삭제해 주세요.");
    return;
  }
  if (timelineRangePurpose === "short-source" || shortSourceComposerActive) {
    showToast("쇼츠 소스 작성 중에는 선택 구간이 삭제되지 않습니다. 먼저 작성을 취소해 주세요.");
    return;
  }
  const range = selectedTimelineRange();
  if (!range) {
    showToast("삭제할 구간의 시작과 끝을 0.1초 이상 벌려 지정해 주세요.", "error");
    return;
  }
  if (pointerEditActive || rangeHandleDragActive) {
    showToast("손잡이 조정을 마친 뒤 선택 구간을 삭제해 주세요.", "error");
    return;
  }
  if (projectMutationLockCount > 0) {
    showToast("진행 중인 미디어 작업이 끝난 뒤 구간을 삭제해 주세요.", "error");
    return;
  }
  elements.preview_video.pause();
  try {
    let next = rippleDeleteTimelineRange(project, range);
    const nextDurationMs = projectDurationMs(next);
    const junctionMs = Math.min(range.startMs, nextDurationMs);
    const mapping = mapTimelineToSource(next, junctionMs);
    next = {
      ...next,
      playheadMs: junctionMs,
      selectedClipId: mapping?.clipId || next.clips[0]?.id || null
    };
    clearTimelineRangeSelection({ render: false });
    applyProject(next);
    void syncPreviewToPlayhead();
    showToast(
      `${formatDuration(range.endMs - range.startMs)} 구간을 삭제했습니다. Ctrl+Z로 되돌릴 수 있습니다.`,
      "success"
    );
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
  }
}

function setTimedBlockGeometry(
  block: Element,
  range: TimelineRange | null
) {
  const control = block as EditorControl;
  control.hidden = !range;
  if (!range) {
    return;
  }
  control.style.left = `${timelineX(range.startMs)}px`;
  control.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
}

function syncLiveTimelineGeometry() {
  liveTimelineGeometryFrame = null;
  const width = timelineWidth();
  const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const cueById = new Map(project.subtitles.map((cue) => [cue.id, cue]));
  const assetById = new Map((project.imageAssets || []).map((asset) => [asset.id, asset]));
  const audioById = new Map(project.audioRegions.map((region) => [region.id, region]));
  elements.timeline_content.style.width = `${width}px`;
  elements.timeline_ruler.style.width = `${width}px`;
  for (const track of [
    elements.video_track,
    elements.asset_track,
    elements.audio_track,
    ...elements.caption_tracks.querySelectorAll(".caption-track-row")
  ]) {
    (track as EditorControl).style.width = `${width}px`;
  }
  for (const block of elements.video_track.querySelectorAll(".clip-block")) {
    const clip = clipById.get((block as EditorControl).dataset.id || "");
    setTimedBlockGeometry(block, clip && clip.enabled !== false ? {
      startMs: clip.timelineStartMs,
      endMs: clip.timelineStartMs + clipDurationMs(clip)
    } : null);
  }
  for (const block of elements.audio_track.querySelectorAll(".audio-source-block")) {
    const clip = clipById.get((block as EditorControl).dataset.clipId || "");
    setTimedBlockGeometry(block, clip && clip.enabled !== false ? {
      startMs: clip.timelineStartMs,
      endMs: clip.timelineStartMs + clipDurationMs(clip)
    } : null);
  }
  for (const block of elements.asset_track.querySelectorAll(".asset-block")) {
    const asset = assetById.get((block as EditorControl).dataset.id || "");
    setTimedBlockGeometry(block, asset ? imageAssetTimelineRange(project, asset) : null);
  }
  for (const block of elements.audio_track.querySelectorAll(".audio-block")) {
    const region = audioById.get((block as EditorControl).dataset.id || "");
    setTimedBlockGeometry(block, region ? audioRegionTimelineRange(project, region) : null);
  }
  for (const block of elements.caption_tracks.querySelectorAll(".cue-block")) {
    const cue = cueById.get((block as EditorControl).dataset.id || "");
    setTimedBlockGeometry(block, cue ? cueTimelineRange(project, cue) : null);
  }
  const durationMs = projectDurationMs(project);
  const previewPlayheadMs = Math.max(0, Math.min(durationMs, project.playheadMs || 0));
  elements.playhead.style.left = `${timelineX(previewPlayheadMs)}px`;
  elements.current_time.textContent = formatTime(previewPlayheadMs);
  elements.duration_time.textContent = `/ ${formatTime(durationMs)}`;
  renderTimelineRange();
}

function scheduleLiveTimelineGeometry() {
  if (liveTimelineGeometryFrame !== null) {
    return;
  }
  liveTimelineGeometryFrame = requestAnimationFrame(syncLiveTimelineGeometry);
}

function layoutImageAssetSubrows(candidateProject: EditorProject) {
  const entries = (candidateProject.imageAssets || [])
    .map((asset, assetIndex) => ({
      asset,
      assetIndex,
      range: imageAssetTimelineRange(candidateProject, asset)
    }))
    .filter((entry): entry is typeof entry & { range: TimelineRange } => (
      entry.range !== null
    ))
    .sort((first, second) => (
      first.range.startMs - second.range.startMs ||
      first.range.endMs - second.range.endMs ||
      first.assetIndex - second.assetIndex
    ));
  const subrowEndTimes: number[] = [];
  const byAssetId = new Map<string, {
    range: { startMs: number; endMs: number };
    subrow: number;
  }>();

  entries.forEach((entry) => {
    let subrow = subrowEndTimes.findIndex((endMs) => endMs <= entry.range.startMs);
    if (subrow === -1) {
      subrow = subrowEndTimes.length;
      subrowEndTimes.push(entry.range.endMs);
    } else {
      subrowEndTimes[subrow] = entry.range.endMs;
    }
    byAssetId.set(entry.asset.id, {
      range: entry.range,
      subrow
    });
  });

  return {
    byAssetId,
    subrowCount: Math.max(1, subrowEndTimes.length)
  };
}

function layoutShortVideoAssetSubrows(candidateProject: EditorProject) {
  if (workspaceMode !== "short-form") {
    return {
      byAssetId: new Map<string, number>(),
      subrowCount: 1
    };
  }
  const videoLaneCount = Math.max(1, candidateProject.shortForm.videoLaneCount);
  const byAssetId = new Map(
    candidateProject.shortForm.videoAssets.map((asset) => [asset.id, asset.lane])
  );
  return {
    byAssetId,
    subrowCount: videoLaneCount
  };
}

function renderRuler(width: number) {
  elements.timeline_ruler.replaceChildren();
  const durationSeconds = Math.max(1, projectDurationMs(project) / 1000);
  const majorStep = pixelsPerSecond >= 160 ? 1 : pixelsPerSecond >= 90 ? 2 : pixelsPerSecond >= 45 ? 5 : 10;
  const minorStep = majorStep >= 5 ? majorStep / 5 : 1;
  for (let second = 0; second <= durationSeconds + minorStep; second += minorStep) {
    const tick = document.createElement("span");
    const major = Math.abs(second / majorStep - Math.round(second / majorStep)) < 0.001;
    tick.className = `ruler-tick${major ? " major" : ""}`;
    tick.style.left = `${second * pixelsPerSecond}px`;
    if (major) {
      const label = document.createElement("span");
      label.textContent = formatTime(second * 1000, { compact: true }).slice(0, -4);
      tick.append(label);
    }
    elements.timeline_ruler.append(tick);
  }
  elements.timeline_ruler.style.width = `${width}px`;
}

function makeHandle(
  side: TimelineSide,
  onStart: (event: PointerEvent) => void,
  onNudge: ((deltaMs: number) => void) | null,
  {
  label,
  valueMs,
  minMs,
  maxMs,
  disabled = false
}: {
  label?: string;
  valueMs?: number;
  minMs?: number;
  maxMs?: number;
  disabled?: boolean;
  } = {}
) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = `trim-handle ${side}`;
  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", label || (side === "left" ? "시작 시각 조정" : "끝 시각 조정"));
  handle.setAttribute("aria-valuemin", String(Math.max(0, Number(minMs) || 0) / 1000));
  handle.setAttribute("aria-valuemax", String(Math.max(Number(minMs) || 0, Number(maxMs) || 0) / 1000));
  handle.setAttribute("aria-valuenow", String(Math.max(0, Number(valueMs) || 0) / 1000));
  handle.setAttribute("aria-valuetext", formatTime(valueMs || 0));
  handle.disabled = disabled;
  handle.title = disabled
    ? `${projectSourcePlatformLabel()} 편집 영상을 다시 준비한 뒤 조정할 수 있습니다`
    : "←/→ 0.1초 · Shift+←/→ 1초";
  handle.addEventListener("pointerdown", onStart);
  handle.addEventListener("keydown", (event) => {
    if (!onNudge || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const owner = handle.closest(
      ".clip-block, .short-video-asset-block, .asset-block, .cue-block, .audio-block, .source-audio-asset-block"
    );
    const ownerId = (owner as EditorControl)?.dataset.id;
    const ownerClass = owner?.classList.contains("clip-block")
      ? "clip-block"
      : owner?.classList.contains("short-video-asset-block")
        ? "short-video-asset-block"
      : owner?.classList.contains("asset-block")
        ? "asset-block"
      : owner?.classList.contains("audio-block")
        ? "audio-block"
      : owner?.classList.contains("source-audio-asset-block")
        ? "source-audio-asset-block"
        : "cue-block";
    const amount = event.shiftKey ? 1_000 : 100;
    onNudge(event.key === "ArrowLeft" ? -amount : amount);
    queueMicrotask(() => {
      const nextOwner = [...document.querySelectorAll(`.${ownerClass}`)]
        .find((candidate) => (candidate as EditorControl).dataset.id === ownerId);
      (nextOwner?.querySelector(`.trim-handle.${side}`) as EditorControl)?.focus({ preventScroll: true });
    });
  });
  return handle;
}

function beginPointerHistory() {
  if (!pointerEditActive) {
    pointerEditPreservePreviewClock = previewPlaybackIsActive();
    syncProjectPlayheadToPreviewClock();
    pushUndo(cloneProject(project));
    pointerEditActive = true;
    renderTimelineRange();
  }
}

function endPointerHistory({ clipStructureChanged = false } = {}) {
  pointerEditActive = false;
  hideTimelineSnapGuide();
  if (liveTimelineGeometryFrame !== null) {
    cancelAnimationFrame(liveTimelineGeometryFrame);
    liveTimelineGeometryFrame = null;
  }
  if (clipStructureChanged) {
    clearTimelineRangeSelection({ render: false });
  }
  const preservePreviewClock = (
    pointerEditPreservePreviewClock
    || previewPlaybackIsActive()
  );
  pointerEditPreservePreviewClock = false;
  if (preservePreviewClock) {
    syncProjectPlayheadToPreviewClock({ allowPaused: true });
  }
  renderAll({ keepScroll: true });
  scheduleSave();
  if (clipStructureChanged) {
    void syncPreviewToPlayhead();
  }
}

function rollbackPointerHistory(
  snapshot: EditorProject,
  previousRedoStack: EditorProject[]
): void {
  pointerEditActive = false;
  pointerEditPreservePreviewClock = false;
  hideTimelineSnapGuide();
  if (liveTimelineGeometryFrame !== null) {
    cancelAnimationFrame(liveTimelineGeometryFrame);
    liveTimelineGeometryFrame = null;
  }
  undoStack.pop();
  redoStack = previousRedoStack;
  project = snapshot;
  renderAll({ keepScroll: true });
}

function bindClipTrim(
  handle: EditorControl,
  clip: EditorClip,
  side: TimelineSide,
  event: PointerEvent
) {
  if (event.button !== 0 || !event.isPrimary) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const materialization = projectMaterialization();
  if (projectUsesChzzkMaterializedMedia() && !materialization) {
    showToast(`${projectSourcePlatformLabel()} 편집 영상을 다시 준비한 뒤 컷 경계를 조정해 주세요.`, "error");
    return;
  }
  const startX = event.clientX;
  const originalStart = clip.sourceStartMs;
  const originalEnd = clip.sourceEndMs;
  const editableBounds = materialization
    ? materializedEditableBoundsForClip(clip, materialization)
      || logicalEditableBoundsForClip(
        clip,
        materialization.sourceDurationMs,
        materialization.handleMs
      )
    : null;
  const minimumSourceMs = editableBounds?.editableSourceStartMs ?? 0;
  const maximumSourceMs = editableBounds?.editableSourceEndMs
    ?? (projectUsesChzzkMaterializedMedia()
      ? undefined
      : project.mediaAsset?.durationMs)
    ?? Infinity;
  const pointerId = event.pointerId;
  const block = handle.closest(".clip-block") as EditorControl | null;
  let originalProject: EditorProject = null!;
  const redoBeforeGesture = redoStack;
  let rawTargetSourceMs = side === "left" ? originalStart : originalEnd;
  let gestureActivated = false;
  let dragging = false;
  handle.setPointerCapture(event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const deltaX = moveEvent.clientX - startX;
    if (!dragging && Math.abs(deltaX) < TIMED_BLOCK_DRAG_ACTIVATION_PX) {
      return;
    }
    gestureActivated = true;
    const delta = Math.round(deltaX / pixelsPerSecond * 1000);
    rawTargetSourceMs = side === "left"
      ? Math.max(0, Math.min(originalEnd - 100, originalStart + delta))
      : Math.min(
        Number.isFinite(maximumSourceMs)
          ? materialization?.sourceDurationMs ?? maximumSourceMs
          : Infinity,
        Math.max(originalStart + 100, originalEnd + delta)
      );
    const start = side === "left"
      ? Math.max(
        minimumSourceMs,
        rawTargetSourceMs
      )
      : originalStart;
    const end = side === "right"
      ? Math.min(
        maximumSourceMs,
        rawTargetSourceMs
      )
      : originalEnd;
    if (!dragging && start === originalStart && end === originalEnd) {
      return;
    }
    if (!dragging) {
      dragging = true;
      beginPointerHistory();
      originalProject = project;
    }
    project = withCurrentTimelinePlayhead(
      updateClipTrim(originalProject, clip.id, { sourceStartMs: start, sourceEndMs: end })
    );
    const nextClip = project.clips.find((candidate) => candidate.id === clip.id);
    if (block && nextClip) {
      block.style.left = `${timelineX(nextClip.timelineStartMs)}px`;
      block.style.width = `${Math.max(8, timelineX(clipDurationMs(nextClip)))}px`;
    }
    scheduleLiveTimelineGeometry();
  };
  const finish = (finishEvent: PointerEvent) => {
    if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    if (
      finishEvent?.type === "pointercancel"
      || finishEvent?.type === "lostpointercapture"
    ) {
      if (dragging) {
        rollbackPointerHistory(originalProject, redoBeforeGesture);
      }
      return;
    }
    const beyondLoadedRange = Boolean(
      materialization
      && gestureActivated
      && (
        (side === "left" && rawTargetSourceMs < minimumSourceMs)
        || (side === "right" && rawTargetSourceMs > maximumSourceMs)
      )
    );
    if (beyondLoadedRange) {
      if (dragging) {
        rollbackPointerHistory(originalProject, redoBeforeGesture);
      }
      void requestVodHotLoadForClip(
        clip,
        side === "left" ? "before" : "after",
        { targetSourceMs: rawTargetSourceMs, applyTrim: true }
      );
      return;
    }
    if (!dragging) {
      return;
    }
    endPointerHistory({ clipStructureChanged: true });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}

function bindCueTrim(
  handle: EditorControl,
  cue: EditorSubtitleCue,
  side: TimelineSide,
  event: PointerEvent
) {
  if (event.button !== 0 || !event.isPrimary) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  beginPointerHistory();
  propertyInspectorMode = "caption";
  inspectorMode = "selected";
  const originalProject = {
    ...project,
    selectedCueId: cue.id,
    selectedClipId: cue.clipId
  };
  project = originalProject;
  handle.closest(".cue-block")?.classList.add("selected");
  const startX = event.clientX;
  const originalStart = cue.startOffsetMs;
  const originalEnd = cue.endOffsetMs;
  const clip = project.clips.find((candidate) => candidate.id === cue.clipId);
  const duration = clipDurationMs(clip);
  const pointerId = event.pointerId;
  const block = handle.closest(".cue-block") as EditorControl | null;
  let overlapBlocked = false;
  handle.setPointerCapture(event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const delta = Math.round((moveEvent.clientX - startX) / pixelsPerSecond * 1000);
    const rawStartOffsetMs = side === "left"
      ? Math.max(0, Math.min(originalEnd - 100, originalStart + delta))
      : originalStart;
    const rawEndOffsetMs = side === "right"
      ? Math.min(duration, Math.max(originalStart + 100, originalEnd + delta))
      : originalEnd;
    const rawBoundaryTimelineMs = clip!.timelineStartMs + (
      side === "left" ? rawStartOffsetMs : rawEndOffsetMs
    );
    const snappedBoundaryTimelineMs = snappedTimelinePoint(
      rawBoundaryTimelineMs,
      {
        clipId: clip!.id,
        movingKind: "subtitle",
        itemId: cue.id,
        altKey: moveEvent.altKey,
        minimumTimelineMs: clip!.timelineStartMs + (
          side === "left" ? 0 : originalStart + 100
        ),
        maximumTimelineMs: clip!.timelineStartMs + (
          side === "left" ? originalEnd - 100 : duration
        )
      }
    );
    const startOffsetMs = side === "left"
      ? snappedBoundaryTimelineMs - clip!.timelineStartMs
      : originalStart;
    const endOffsetMs = side === "right"
      ? snappedBoundaryTimelineMs - clip!.timelineStartMs
      : originalEnd;
    let nextProject = updateSubtitleCue(originalProject, cue.id, {
      startOffsetMs,
      endOffsetMs
    });
    if (cueHasOverlap(nextProject, cue.id)) {
      if (snappedBoundaryTimelineMs !== rawBoundaryTimelineMs) {
        const fallbackProject = updateSubtitleCue(originalProject, cue.id, {
          startOffsetMs: rawStartOffsetMs,
          endOffsetMs: rawEndOffsetMs
        });
        if (!cueHasOverlap(fallbackProject, cue.id)) {
          nextProject = fallbackProject;
          hideTimelineSnapGuide();
        } else {
          overlapBlocked = true;
          return;
        }
      } else {
        overlapBlocked = true;
        return;
      }
    }
    if (cueHasOverlap(nextProject, cue.id)) {
      overlapBlocked = true;
      return;
    }
    overlapBlocked = false;
    project = withCurrentTimelinePlayhead(nextProject);
    const nextCue = project.subtitles.find((candidate) => candidate.id === cue.id);
    const range = nextCue ? cueTimelineRange(project, nextCue) : null;
    if (block && range) {
      block.style.left = `${timelineX(range.startMs)}px`;
      block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    }
    renderCueInspector();
  };
  const finish = (finishEvent: PointerEvent) => {
    if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    endPointerHistory();
    if (overlapBlocked) {
      showToast("같은 자막 레인 안에서는 자막이 겹칠 수 없습니다.", "error");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}

function bindImageAssetTrim(
  handle: EditorControl,
  asset: EditorImageAsset,
  side: TimelineSide,
  event: PointerEvent
) {
  if (event.button !== 0 || !event.isPrimary) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  beginPointerHistory();
  propertyInspectorMode = "asset";
  const originalProject = {
    ...project,
    selectedImageAssetId: asset.id,
    selectedClipId: asset.clipId
  };
  project = originalProject;
  handle.closest(".asset-block")?.classList.add("selected");
  const startX = event.clientX;
  const originalStart = asset.startOffsetMs;
  const originalEnd = asset.endOffsetMs;
  const clip = project.clips.find((candidate) => candidate.id === asset.clipId);
  const duration = clipDurationMs(clip);
  const pointerId = event.pointerId;
  const block = handle.closest(".asset-block") as EditorControl | null;
  handle.setPointerCapture(pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const delta = Math.round((moveEvent.clientX - startX) / pixelsPerSecond * 1000);
    const rawStartOffsetMs = side === "left"
      ? Math.max(0, Math.min(originalEnd - 100, originalStart + delta))
      : originalStart;
    const rawEndOffsetMs = side === "right"
      ? Math.min(duration, Math.max(originalStart + 100, originalEnd + delta))
      : originalEnd;
    const rawBoundaryTimelineMs = clip!.timelineStartMs + (
      side === "left" ? rawStartOffsetMs : rawEndOffsetMs
    );
    const snappedBoundaryTimelineMs = snappedTimelinePoint(
      rawBoundaryTimelineMs,
      {
        clipId: clip!.id,
        movingKind: "asset",
        itemId: asset.id,
        altKey: moveEvent.altKey,
        minimumTimelineMs: clip!.timelineStartMs + (
          side === "left" ? 0 : originalStart + 100
        ),
        maximumTimelineMs: clip!.timelineStartMs + (
          side === "left" ? originalEnd - 100 : duration
        )
      }
    );
    const startOffsetMs = side === "left"
      ? snappedBoundaryTimelineMs - clip!.timelineStartMs
      : originalStart;
    const endOffsetMs = side === "right"
      ? snappedBoundaryTimelineMs - clip!.timelineStartMs
      : originalEnd;
    project = withCurrentTimelinePlayhead(
      updateImageAsset(originalProject, asset.id, { startOffsetMs, endOffsetMs })
    );
    const nextAsset = selectedImageAsset();
    const range = nextAsset ? imageAssetTimelineRange(project, nextAsset) : null;
    if (block && range) {
      block.style.left = `${timelineX(range.startMs)}px`;
      block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    }
    renderImageAssetInspector();
  };
  const finish = (finishEvent: PointerEvent) => {
    if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    endPointerHistory();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}

function bindTimedBlockMove(
  body: HTMLElement,
  item: EditorSubtitleCue | EditorImageAsset,
  kind: TimedBlockKind,
  event: PointerEvent
) {
  if (event.button !== 0 || !event.isPrimary) {
    return;
  }
  event.stopPropagation();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const originalStart = item.startOffsetMs;
  const originalEnd = item.endOffsetMs;
  const itemDuration = originalEnd - originalStart;
  const clip = project.clips.find((candidate) => candidate.id === item.clipId);
  const clipDuration = clipDurationMs(clip);
  const maximumStart = Math.max(0, clipDuration - itemDuration);
  const block = body.closest(
    kind === "subtitle" ? ".cue-block" : ".asset-block"
  ) as EditorControl | null;
  let originalProject: EditorProject = null!;
  let dragging = false;
  let overlapBlocked = false;
  body.setPointerCapture(pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const deltaX = moveEvent.clientX - startX;
    if (!dragging && Math.abs(deltaX) < TIMED_BLOCK_DRAG_ACTIVATION_PX) {
      return;
    }
    moveEvent.preventDefault();
    if (!dragging) {
      dragging = true;
      beginPointerHistory();
      originalProject = kind === "subtitle"
        ? {
          ...project,
          selectedCueId: item.id,
          selectedClipId: item.clipId
        }
        : {
          ...project,
          selectedImageAssetId: item.id,
          selectedClipId: item.clipId
        };
      project = originalProject;
      propertyInspectorMode = kind === "subtitle" ? "caption" : "asset";
      if (kind === "subtitle") {
        inspectorMode = "selected";
      }
      block?.classList.add("moving", "selected");
    }

    const rawDeltaMs = Math.round(deltaX / pixelsPerSecond * 1000);
    const rawStartOffsetMs = Math.max(
      0,
      Math.min(maximumStart, originalStart + rawDeltaMs)
    );
    const rawEndOffsetMs = rawStartOffsetMs + itemDuration;
    const rawStartTimelineMs = clip!.timelineStartMs + rawStartOffsetMs;
    const rawEndTimelineMs = clip!.timelineStartMs + rawEndOffsetMs;
    const baseSnapOptions = {
      clipId: clip!.id,
      movingKind: kind,
      itemId: item.id,
      altKey: moveEvent.altKey
    };
    const startMatch = findTimelineSnap(rawStartTimelineMs, {
      ...baseSnapOptions,
      minimumTimelineMs: clip!.timelineStartMs,
      maximumTimelineMs: clip!.timelineStartMs + maximumStart
    });
    const endMatch = findTimelineSnap(rawEndTimelineMs, {
      ...baseSnapOptions,
      minimumTimelineMs: clip!.timelineStartMs + itemDuration,
      maximumTimelineMs: clip!.timelineStartMs + clipDuration
    });
    const match = [startMatch, endMatch]
      .filter(Boolean)
      .sort((first, second) => (
        first!.distanceMs - second!.distanceMs
        || first!.priority - second!.priority
        || first!.timeMs - second!.timeMs
      ))[0] || null;
    const snappedDeltaMs = match?.deltaMs || 0;
    let nextStartOffsetMs = Math.max(
      0,
      Math.min(maximumStart, rawStartOffsetMs + snappedDeltaMs)
    );
    let nextEndOffsetMs = nextStartOffsetMs + itemDuration;
    let nextProject = kind === "subtitle"
      ? updateSubtitleCue(originalProject, item.id, {
        startOffsetMs: nextStartOffsetMs,
        endOffsetMs: nextEndOffsetMs
      })
      : updateImageAsset(originalProject, item.id, {
        startOffsetMs: nextStartOffsetMs,
        endOffsetMs: nextEndOffsetMs
      });

    if (
      kind === "subtitle"
      && cueHasOverlap(nextProject, item.id)
      && match
    ) {
      nextStartOffsetMs = rawStartOffsetMs;
      nextEndOffsetMs = rawEndOffsetMs;
      nextProject = updateSubtitleCue(originalProject, item.id, {
        startOffsetMs: nextStartOffsetMs,
        endOffsetMs: nextEndOffsetMs
      });
      showTimelineSnapGuide(null);
    } else {
      showTimelineSnapGuide(match);
    }
    if (kind === "subtitle" && cueHasOverlap(nextProject, item.id)) {
      overlapBlocked = true;
      return;
    }
    overlapBlocked = false;
    project = withCurrentTimelinePlayhead(nextProject);
    const range = kind === "subtitle"
      ? cueTimelineRange(
        project,
        project.subtitles.find((candidate) => candidate.id === item.id)!
      )
      : imageAssetTimelineRange(
        project,
        project.imageAssets.find((candidate) => candidate.id === item.id)!
      );
    if (block && range) {
      block.style.left = `${timelineX(range.startMs)}px`;
      block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    }
    if (kind === "subtitle") {
      renderCueInspector();
    } else {
      renderImageAssetInspector();
    }
  };
  const finish = (finishEvent: PointerEvent) => {
    if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    body.removeEventListener("lostpointercapture", finish);
    if (body.hasPointerCapture(pointerId)) {
      body.releasePointerCapture(pointerId);
    }
    block?.classList.remove("moving");
    if (!dragging) {
      hideTimelineSnapGuide();
      return;
    }
    suppressNextTimedBlockClick(kind, item.id);
    endPointerHistory();
    if (overlapBlocked) {
      showToast("같은 자막 레인 안에서는 자막이 겹칠 수 없습니다.", "error");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  body.addEventListener("lostpointercapture", finish);
}

function audioRegionHasOverlap(candidateProject: EditorProject, regionId: string) {
  return findAudioRegionOverlaps(candidateProject).some((overlap) => (
    overlap.firstRegionId === regionId || overlap.secondRegionId === regionId
  ));
}

function bindAudioTrim(
  handle: EditorControl,
  region: EditorAudioRegion,
  side: TimelineSide,
  event: PointerEvent
) {
  if (event.button !== 0 || !event.isPrimary) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  propertyInspectorMode = "audio";
  const originalProject = {
    ...project,
    selectedAudioRegionId: region.id,
    selectedClipId: region.clipId
  };
  project = originalProject;
  handle.closest(".audio-block")?.classList.add("selected");
  renderPropertyInspector();
  const startX = event.clientX;
  const originalStart = region.startOffsetMs;
  const originalEnd = region.endOffsetMs;
  const clip = project.clips.find((candidate) => candidate.id === region.clipId);
  const duration = clipDurationMs(clip);
  const pointerId = event.pointerId;
  const block = handle.closest(".audio-block") as EditorControl | null;
  const redoBeforeGesture = redoStack;
  let dragging = false;
  let overlapBlocked = false;
  handle.setPointerCapture(pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const deltaX = moveEvent.clientX - startX;
    if (!dragging && Math.abs(deltaX) < TIMED_BLOCK_DRAG_ACTIVATION_PX) {
      return;
    }
    const delta = Math.round(deltaX / pixelsPerSecond * 1000);
    const startOffsetMs = side === "left"
      ? Math.max(0, Math.min(originalEnd - 100, originalStart + delta))
      : originalStart;
    const endOffsetMs = side === "right"
      ? Math.min(duration, Math.max(originalStart + 100, originalEnd + delta))
      : originalEnd;
    const nextProject = updateAudioRegion(originalProject, region.id, {
      startOffsetMs,
      endOffsetMs
    });
    if (audioRegionHasOverlap(nextProject, region.id)) {
      overlapBlocked = true;
      return;
    }
    if (!dragging && startOffsetMs === originalStart && endOffsetMs === originalEnd) {
      return;
    }
    if (!dragging) {
      dragging = true;
      beginPointerHistory();
    }
    overlapBlocked = false;
    project = withCurrentTimelinePlayhead(nextProject);
    const nextRegion = selectedAudioRegion();
    const range = nextRegion
      ? audioRegionTimelineRange(project, nextRegion)
      : null;
    if (block && range) {
      block.style.left = `${timelineX(range.startMs)}px`;
      block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    }
    renderAudioInspector();
    applyPreviewAudioSettings();
  };
  const finish = (finishEvent: PointerEvent) => {
    if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    if (
      finishEvent?.type === "pointercancel"
      || finishEvent?.type === "lostpointercapture"
    ) {
      if (dragging) {
        rollbackPointerHistory(originalProject, redoBeforeGesture);
        applyPreviewAudioSettings();
      } else {
        renderAll({ keepScroll: true });
      }
      return;
    }
    if (!dragging) {
      renderAll({ keepScroll: true });
      scheduleSave();
      return;
    }
    endPointerHistory();
    if (overlapBlocked) {
      showToast("음성 설정 구간끼리는 겹칠 수 없습니다.", "error");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}

type ShortTimelineSourceAsset = ShortFormVideoAsset | ShortFormSourceAudioAsset;
type ShortTimelineSourceKind = "video" | "source-audio";
type ShortTimelineTimingUpdate = Partial<Pick<
  ShortTimelineSourceAsset,
  "sourceStartMs" | "sourceEndMs" | "timelineStartMs" | "timelineEndMs"
>> & { lane?: number };

function shortTimelineSourceProject(
  baseProject: EditorProject,
  kind: ShortTimelineSourceKind,
  assetId: string,
  update: ShortTimelineTimingUpdate
): EditorProject {
  const shortForm = kind === "video"
    ? updateShortFormVideoAsset(baseProject.shortForm, assetId, update)
    : updateShortFormSourceAudioAsset(baseProject.shortForm, assetId, update);
  return {
    ...baseProject,
    clips: [shortFormCanvasClip(shortForm.durationMs)],
    selectedClipId: SHORT_FORM_CANVAS_CLIP_ID,
    playheadMs: Math.min(
      shortForm.durationMs,
      Math.max(0, Math.round(Number(baseProject.playheadMs) || 0))
    ),
    shortForm: {
      ...shortForm,
      ...(kind === "video"
        ? { selectedVideoLayerId: assetId }
        : { selectedSourceAudioAssetId: assetId })
    }
  };
}

function shortTimelineSourceAssetById(
  candidateProject: EditorProject,
  kind: ShortTimelineSourceKind,
  assetId: string
): ShortTimelineSourceAsset | null {
  const candidates = kind === "video"
    ? candidateProject.shortForm.videoAssets
    : candidateProject.shortForm.sourceAudioAssets;
  return candidates.find((candidate) => candidate.id === assetId) || null;
}

function shortTimelineSourceConstraintMessage(kind: ShortTimelineSourceKind): string {
  return kind === "video"
    ? `같은 영상 라인에서는 블록이 겹칠 수 없습니다. 빈 라인으로 옮기거나 + 버튼으로 라인을 추가해 주세요 (최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개).`
    : "원본 음성끼리는 겹칠 수 없습니다.";
}

function shortTimelineSourceEditsBlocked(): boolean {
  return Boolean(
    activeJobController
    || projectMutationLockCount > 0
    || pointerEditActive
  );
}

function reportBlockedShortTimelineSourceEdit(): void {
  showToast(
    pointerEditActive
      ? "진행 중인 타임라인 조정을 마친 뒤 다시 시도해 주세요."
      : "진행 중인 영상 작업이 끝난 뒤 쇼츠 요소를 조정해 주세요.",
    "error"
  );
}

function selectShortTimelineSourceAsset(
  kind: ShortTimelineSourceKind,
  asset: ShortTimelineSourceAsset,
  { seek = false }: { seek?: boolean } = {}
): void {
  const seekSelection = seek && shouldSeekTimelineItemSelection();
  project = {
    ...project,
    shortForm: {
      ...project.shortForm,
      ...(kind === "video"
        ? { selectedVideoLayerId: asset.id }
        : { selectedSourceAudioAssetId: asset.id })
    }
  };
  if (kind === "video") {
    propertyInspectorMode = "framing";
  }
  if (seekSelection) {
    void seekTimeline(asset.timelineStartMs);
  }
  renderAll({ keepScroll: true });
  scheduleSave();
}

function bindShortTimelineSourceMove(
  body: HTMLElement,
  asset: ShortTimelineSourceAsset,
  kind: ShortTimelineSourceKind,
  event: PointerEvent
): void {
  if (
    workspaceMode !== "short-form"
    || event.button !== 0
    || !event.isPrimary
  ) {
    return;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return;
  }
  event.stopPropagation();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const originalTimelineStartMs = asset.timelineStartMs;
  const originalTimelineEndMs = asset.timelineEndMs;
  const originalCanvasDurationMs = project.shortForm.durationMs;
  const durationMs = originalTimelineEndMs - originalTimelineStartMs;
  const originalLane = kind === "video"
    ? (asset as ShortFormVideoAsset).lane
    : 0;
  const block = body.closest(
    kind === "video" ? ".short-video-asset-block" : ".source-audio-asset-block"
  ) as EditorControl | null;
  const redoBeforeGesture = redoStack;
  let rollbackProject: EditorProject | null = null;
  let originalProject: EditorProject | null = null;
  let dragging = false;
  let changed = false;
  let blocked = false;
  body.setPointerCapture(pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (
      !dragging
      && Math.hypot(deltaX, kind === "video" ? deltaY : 0)
        < TIMED_BLOCK_DRAG_ACTIVATION_PX
    ) {
      return;
    }
    moveEvent.preventDefault();
    if (!dragging) {
      dragging = true;
      beginPointerHistory();
      rollbackProject = cloneProject(project);
      originalProject = {
        ...project,
        shortForm: {
          ...project.shortForm,
          ...(kind === "video"
            ? { selectedVideoLayerId: asset.id }
            : { selectedSourceAudioAssetId: asset.id })
        }
      };
      if (kind === "video") {
        propertyInspectorMode = "framing";
      }
      block?.classList.add("moving", "selected");
    }
    const rawDeltaMs = Math.max(
      -originalTimelineStartMs,
      Math.round(deltaX / pixelsPerSecond * 1000)
    );
    const rawTimelineStartMs = originalTimelineStartMs + rawDeltaMs;
    const rawTimelineEndMs = rawTimelineStartMs + durationMs;
    const lane = kind === "video"
      ? Math.max(
        0,
        Math.min(
          project.shortForm.videoLaneCount - 1,
          Math.floor(
            (moveEvent.clientY - elements.video_track.getBoundingClientRect().top)
              / SHORT_VIDEO_SUBROW_STRIDE_PX
          )
        )
      )
      : originalLane;
    const match = kind === "video"
      ? bestShortVideoMoveSnap(
        rawTimelineStartMs,
        rawTimelineEndMs,
        asset.id,
        lane,
        moveEvent.altKey,
        originalCanvasDurationMs
      )
      : null;
    const snappedDeltaMs = match?.deltaMs || 0;
    const timelineStartMs = Math.max(0, rawTimelineStartMs + snappedDeltaMs);
    const timelineEndMs = timelineStartMs + durationMs;
    showTimelineSnapGuide(match);
    try {
      project = withCurrentTimelinePlayhead(shortTimelineSourceProject(
        originalProject!,
        kind,
        asset.id,
        {
          timelineStartMs,
          timelineEndMs,
          ...(kind === "video" ? { lane } : {})
        }
      ));
      blocked = false;
      changed = (
        timelineStartMs !== originalTimelineStartMs
        || timelineEndMs !== originalTimelineEndMs
        || lane !== originalLane
      );
    } catch {
      blocked = true;
      return;
    }
    const nextAsset = shortTimelineSourceAssetById(project, kind, asset.id);
    if (block && nextAsset) {
      block.style.left = `${timelineX(nextAsset.timelineStartMs)}px`;
      block.style.width = `${Math.max(
        8,
        timelineX(nextAsset.timelineEndMs - nextAsset.timelineStartMs)
      )}px`;
      if (kind === "video") {
        block.style.setProperty(
          "--short-video-block-top",
          `${SHORT_VIDEO_BLOCK_TOP_PX + (nextAsset as ShortFormVideoAsset).lane * SHORT_VIDEO_SUBROW_STRIDE_PX}px`
        );
      }
    }
    if (kind === "video") {
      renderShortFramingInspector();
    }
  };
  const finish = (finishEvent: PointerEvent) => {
    if (
      finishEvent?.pointerId !== undefined
      && finishEvent.pointerId !== pointerId
    ) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    body.removeEventListener("lostpointercapture", finish);
    if (body.hasPointerCapture(pointerId)) {
      body.releasePointerCapture(pointerId);
    }
    block?.classList.remove("moving");
    if (!dragging) {
      return;
    }
    if (block) {
      block.dataset.suppressClick = "true";
      setTimeout(() => {
        delete block.dataset.suppressClick;
      }, 0);
    }
    if (
      finishEvent?.type === "pointercancel"
      || finishEvent?.type === "lostpointercapture"
      || !changed
    ) {
      rollbackPointerHistory(rollbackProject || project, redoBeforeGesture);
    } else {
      endPointerHistory();
    }
    if (blocked) {
      showToast(shortTimelineSourceConstraintMessage(kind), "error");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  body.addEventListener("lostpointercapture", finish);
}

function bindShortTimelineSourceTrim(
  handle: EditorControl,
  asset: ShortTimelineSourceAsset,
  kind: ShortTimelineSourceKind,
  side: TimelineSide,
  event: PointerEvent
): void {
  if (
    workspaceMode !== "short-form"
    || event.button !== 0
    || !event.isPrimary
  ) {
    return;
  }
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const originalTimelineStartMs = asset.timelineStartMs;
  const originalTimelineEndMs = asset.timelineEndMs;
  const originalCanvasDurationMs = project.shortForm.durationMs;
  const originalSourceStartMs = asset.sourceStartMs;
  const originalSourceEndMs = asset.sourceEndMs;
  const minimumDeltaMs = side === "left"
    ? Math.max(
      -originalTimelineStartMs,
      asset.sourceSelectionStartMs - originalSourceStartMs
    )
    : -(originalSourceEndMs - originalSourceStartMs - SHORT_FORM_MIN_CLIP_DURATION_MS);
  const maximumDeltaMs = side === "left"
    ? originalSourceEndMs - originalSourceStartMs - SHORT_FORM_MIN_CLIP_DURATION_MS
    : asset.sourceSelectionEndMs - originalSourceEndMs;
  const block = handle.closest(
    kind === "video" ? ".short-video-asset-block" : ".source-audio-asset-block"
  ) as EditorControl | null;
  const redoBeforeGesture = redoStack;
  let rollbackProject: EditorProject | null = null;
  let originalProject: EditorProject | null = null;
  let dragging = false;
  let changed = false;
  let blocked = false;
  handle.setPointerCapture(pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if ((moveEvent.buttons & 1) === 0) {
      finish(moveEvent);
      return;
    }
    const deltaX = moveEvent.clientX - startX;
    if (!dragging && Math.abs(deltaX) < TIMED_BLOCK_DRAG_ACTIVATION_PX) {
      return;
    }
    moveEvent.preventDefault();
    if (!dragging) {
      dragging = true;
      beginPointerHistory();
      rollbackProject = cloneProject(project);
      originalProject = {
        ...project,
        shortForm: {
          ...project.shortForm,
          ...(kind === "video"
            ? { selectedVideoLayerId: asset.id }
            : { selectedSourceAudioAssetId: asset.id })
        }
      };
      if (kind === "video") {
        propertyInspectorMode = "framing";
      }
      block?.classList.add("selected");
    }
    const rawDeltaMs = Math.max(
      minimumDeltaMs,
      Math.min(
        maximumDeltaMs,
        Math.round(deltaX / pixelsPerSecond * 1000)
      )
    );
    const originalBoundaryMs = side === "left"
      ? originalTimelineStartMs
      : originalTimelineEndMs;
    const rawBoundaryMs = originalBoundaryMs + rawDeltaMs;
    const match = kind === "video"
      ? findShortVideoTimelineSnap(
        rawBoundaryMs,
        asset.id,
        (asset as ShortFormVideoAsset).lane,
        {
          altKey: moveEvent.altKey,
          minimumTimelineMs: originalBoundaryMs + minimumDeltaMs,
          maximumTimelineMs: originalBoundaryMs + maximumDeltaMs,
          canvasDurationMs: originalCanvasDurationMs
        }
      )
      : null;
    const deltaMs = Math.max(
      minimumDeltaMs,
      Math.min(maximumDeltaMs, rawDeltaMs + (match?.deltaMs || 0))
    );
    showTimelineSnapGuide(match);
    const update: ShortTimelineTimingUpdate = side === "left"
      ? {
        timelineStartMs: originalTimelineStartMs + deltaMs,
        sourceStartMs: originalSourceStartMs + deltaMs
      }
      : {
        timelineEndMs: originalTimelineEndMs + deltaMs,
        sourceEndMs: originalSourceEndMs + deltaMs
      };
    try {
      project = withCurrentTimelinePlayhead(shortTimelineSourceProject(
        originalProject!,
        kind,
        asset.id,
        update
      ));
      blocked = false;
      changed = deltaMs !== 0;
    } catch {
      blocked = true;
      return;
    }
    const nextAsset = shortTimelineSourceAssetById(project, kind, asset.id);
    if (block && nextAsset) {
      block.style.left = `${timelineX(nextAsset.timelineStartMs)}px`;
      block.style.width = `${Math.max(
        8,
        timelineX(nextAsset.timelineEndMs - nextAsset.timelineStartMs)
      )}px`;
    }
    if (kind === "video") {
      renderShortFramingInspector();
    }
  };
  const finish = (finishEvent: PointerEvent) => {
    if (
      finishEvent?.pointerId !== undefined
      && finishEvent.pointerId !== pointerId
    ) {
      return;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    if (!dragging) {
      return;
    }
    if (
      finishEvent?.type === "pointercancel"
      || finishEvent?.type === "lostpointercapture"
      || !changed
    ) {
      rollbackPointerHistory(rollbackProject || project, redoBeforeGesture);
    } else {
      endPointerHistory();
    }
    if (blocked) {
      showToast(shortTimelineSourceConstraintMessage(kind), "error");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}

function nudgeShortTimelineSourceBoundary(
  kind: ShortTimelineSourceKind,
  assetId: string,
  side: TimelineSide,
  requestedDeltaMs: number
): void {
  if (shortTimelineSourceEditsBlocked()) {
    reportBlockedShortTimelineSourceEdit();
    return;
  }
  const asset = shortTimelineSourceAssetById(project, kind, assetId);
  if (!asset) {
    return;
  }
  const minimumDeltaMs = side === "left"
    ? Math.max(
      -asset.timelineStartMs,
      asset.sourceSelectionStartMs - asset.sourceStartMs
    )
    : -(asset.sourceEndMs - asset.sourceStartMs - SHORT_FORM_MIN_CLIP_DURATION_MS);
  const maximumDeltaMs = side === "left"
    ? asset.sourceEndMs - asset.sourceStartMs - SHORT_FORM_MIN_CLIP_DURATION_MS
    : asset.sourceSelectionEndMs - asset.sourceEndMs;
  const deltaMs = Math.max(
    minimumDeltaMs,
    Math.min(maximumDeltaMs, Math.round(requestedDeltaMs))
  );
  if (deltaMs === 0) {
    return;
  }
  const update: ShortTimelineTimingUpdate = side === "left"
    ? {
      timelineStartMs: asset.timelineStartMs + deltaMs,
      sourceStartMs: asset.sourceStartMs + deltaMs
    }
    : {
      timelineEndMs: asset.timelineEndMs + deltaMs,
      sourceEndMs: asset.sourceEndMs + deltaMs
    };
  try {
    applyProject(shortTimelineSourceProject(project, kind, assetId, update));
  } catch {
    showToast(shortTimelineSourceConstraintMessage(kind), "error");
  }
}

function renderTimeline({ keepScroll = false } = {}) {
  const scrollLeft = elements.timeline_scroll.scrollLeft;
  const width = timelineWidth();
  const laneCount = Math.max(2, project.subtitleLaneCount || 2);
  const shortVideoLayout = layoutShortVideoAssetSubrows(project);
  const orderedShortVideoAssets = workspaceMode === "short-form"
    ? shortWorkspaceVideoLayers()
    : [];
  const shortTimelineSourceControlsDisabled = shortTimelineSourceEditsBlocked();
  const videoTrackHeight = workspaceMode === "short-form"
    ? SHORT_VIDEO_TRACK_BASE_HEIGHT_PX
      + (shortVideoLayout.subrowCount - 1) * SHORT_VIDEO_SUBROW_STRIDE_PX
    : SHORT_VIDEO_TRACK_BASE_HEIGHT_PX;
  const assetLayout = layoutImageAssetSubrows(project);
  const assetTrackHeight = ASSET_TRACK_BASE_HEIGHT_PX +
    (assetLayout.subrowCount - 1) * ASSET_SUBROW_STRIDE_PX;
  document.documentElement.style.setProperty("--subtitle-lane-count", String(laneCount));
  document.documentElement.style.setProperty("--video-track-height", `${videoTrackHeight}px`);
  document.documentElement.style.setProperty("--asset-track-height", `${assetTrackHeight}px`);
  elements.video_lane_count.textContent = String(
    workspaceMode === "short-form" ? project.shortForm.videoLaneCount : 1
  );
  elements.add_video_lane.disabled = (
    workspaceMode !== "short-form"
    || project.shortForm.videoLaneCount >= SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS
    || shortTimelineSourceControlsDisabled
  );
  elements.subtitle_lane_count.textContent = String(laneCount);
  elements.add_subtitle_lane.disabled = laneCount >= MAX_SUBTITLE_LANES;
  elements.timeline_content.style.width = `${width}px`;
  elements.video_track.style.width = `${width}px`;
  elements.asset_track.style.width = `${width}px`;
  elements.audio_track.style.width = `${width}px`;
  elements.source_audio_track.style.width = `${width}px`;
  elements.source_audio_track.tabIndex = -1;
  elements.video_track.style.backgroundSize = `${pixelsPerSecond}px 100%`;
  elements.asset_track.style.backgroundSize = `${pixelsPerSecond}px 100%`;
  elements.audio_track.style.backgroundSize = `${pixelsPerSecond}px 100%`;
  elements.source_audio_track.style.backgroundSize = `${pixelsPerSecond}px 100%`;
  renderRuler(width);
  elements.video_track.replaceChildren();
  elements.asset_track.replaceChildren();
  elements.audio_track.replaceChildren();
  elements.source_audio_track.replaceChildren();
  elements.caption_tracks.replaceChildren();
  const captionRows = Array.from({ length: laneCount }, (_, lane) => {
    const row = document.createElement("div");
    row.className = "timeline-track caption-track-row";
    row.dataset.lane = String(lane);
    row.setAttribute("aria-label", `자막 ${lane + 1} 레인`);
    row.style.width = `${width}px`;
    row.style.backgroundSize = `${pixelsPerSecond}px 100%`;
    elements.caption_tracks.append(row);
    return row;
  });

  if (workspaceMode === "short-form") {
    orderedShortVideoAssets.forEach((asset, assetIndex) => {
      const subrow = shortVideoLayout.byAssetId.get(asset.id) || 0;
      const sourceClip = rootProject.clips.find((candidate) => (
        candidate.id === asset.sourceClipId
      ));
      const sourceIndex = rootProject.clips.findIndex((candidate) => (
        candidate.id === asset.sourceClipId
      ));
      const block = document.createElement("div");
      block.className = "short-video-asset-block";
      block.classList.toggle(
        "selected",
        asset.id === project.shortForm.selectedVideoLayerId
      );
      block.classList.toggle("hidden-asset", !asset.visible);
      block.dataset.id = asset.id;
      block.dataset.subrow = String(subrow);
      block.dataset.lane = String(asset.lane);
      block.style.left = `${timelineX(asset.timelineStartMs)}px`;
      block.style.width = `${Math.max(
        8,
        timelineX(asset.timelineEndMs - asset.timelineStartMs)
      )}px`;
      block.style.setProperty(
        "--short-video-block-top",
        `${SHORT_VIDEO_BLOCK_TOP_PX + subrow * SHORT_VIDEO_SUBROW_STRIDE_PX}px`
      );
      const body = document.createElement("button");
      body.type = "button";
      body.className = "short-video-asset-block-body";
      const sourceLabel = String(sourceClip?.note || "").trim()
        || (sourceIndex >= 0 ? `본편 컷 ${sourceIndex + 1}` : "본편 원본");
      body.textContent = `L${asset.lane + 1} · ${assetIndex + 1} · ${sourceLabel} · ${Math.round(asset.audioGain * 100)}%`;
      body.title = (
        `캔버스 ${formatTime(asset.timelineStartMs, { compact: true })}–${formatTime(asset.timelineEndMs, { compact: true })}`
        + ` · 원본 ${formatTime(asset.sourceStartMs, { compact: true })}–${formatTime(asset.sourceEndMs, { compact: true })}`
        + ` · ${asset.lane + 1}번 라인 · 음량 ${Math.round(asset.audioGain * 100)}% · 앞뒤 영상과 독립적으로 이동·자르기 가능`
      );
      body.addEventListener("pointerdown", (event) => {
        bindShortTimelineSourceMove(body, asset, "video", event);
      });
      body.addEventListener("click", () => {
        if (block.dataset.suppressClick === "true") {
          return;
        }
        selectShortTimelineSourceAsset("video", asset, { seek: true });
      });
      block.append(
        makeHandle(
          "left",
          (event: PointerEvent) => bindShortTimelineSourceTrim(
            event.currentTarget as EditorControl,
            asset,
            "video",
            "left",
            event
          ),
          (deltaMs: number) => nudgeShortTimelineSourceBoundary(
            "video",
            asset.id,
            "left",
            deltaMs
          ),
          {
            label: `${assetIndex + 1}번 쇼츠 영상 시작 시각`,
            valueMs: asset.timelineStartMs,
            minMs: Math.max(
              0,
              asset.timelineStartMs
                - (asset.sourceStartMs - asset.sourceSelectionStartMs)
            ),
            maxMs: asset.timelineEndMs - SHORT_FORM_MIN_CLIP_DURATION_MS,
            disabled: shortTimelineSourceControlsDisabled
          }
        ),
        body,
        makeHandle(
          "right",
          (event: PointerEvent) => bindShortTimelineSourceTrim(
            event.currentTarget as EditorControl,
            asset,
            "video",
            "right",
            event
          ),
          (deltaMs: number) => nudgeShortTimelineSourceBoundary(
            "video",
            asset.id,
            "right",
            deltaMs
          ),
          {
            label: `${assetIndex + 1}번 쇼츠 영상 끝 시각`,
            valueMs: asset.timelineEndMs,
            minMs: asset.timelineStartMs + SHORT_FORM_MIN_CLIP_DURATION_MS,
            maxMs: asset.timelineEndMs
              + (asset.sourceSelectionEndMs - asset.sourceEndMs),
            disabled: shortTimelineSourceControlsDisabled
          }
        )
      );
      elements.video_track.append(block);
    });

    project.shortForm.sourceAudioAssets.forEach((asset, assetIndex) => {
      const sourceClip = rootProject.clips.find((candidate) => (
        candidate.id === asset.sourceClipId
      ));
      const sourceIndex = rootProject.clips.findIndex((candidate) => (
        candidate.id === asset.sourceClipId
      ));
      const block = document.createElement("div");
      block.className = "source-audio-asset-block";
      block.classList.toggle(
        "selected",
        asset.id === project.shortForm.selectedSourceAudioAssetId
      );
      block.classList.toggle("muted", asset.muted);
      block.dataset.id = asset.id;
      block.style.left = `${timelineX(asset.timelineStartMs)}px`;
      block.style.width = `${Math.max(
        8,
        timelineX(asset.timelineEndMs - asset.timelineStartMs)
      )}px`;
      const body = document.createElement("button");
      body.type = "button";
      body.className = "source-audio-asset-block-body";
      const sourceLabel = String(sourceClip?.note || "").trim()
        || (sourceIndex >= 0 ? `본편 컷 ${sourceIndex + 1}` : "본편 원본");
      body.textContent = asset.muted
        ? `${assetIndex + 1} · 음소거 · ${sourceLabel}`
        : `${assetIndex + 1} · 원본 ${Math.round(asset.gain * 100)}% · ${sourceLabel}`;
      body.title = (
        `캔버스 ${formatTime(asset.timelineStartMs, { compact: true })}–${formatTime(asset.timelineEndMs, { compact: true })}`
        + ` · 원본 ${formatTime(asset.sourceStartMs, { compact: true })}–${formatTime(asset.sourceEndMs, { compact: true })}`
      );
      body.addEventListener("pointerdown", (event) => {
        bindShortTimelineSourceMove(body, asset, "source-audio", event);
      });
      body.addEventListener("click", () => {
        if (block.dataset.suppressClick === "true") {
          return;
        }
        selectShortTimelineSourceAsset("source-audio", asset, { seek: true });
      });
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "source-audio-asset-delete";
      removeButton.textContent = "×";
      removeButton.title = "이 원본 음성만 삭제";
      removeButton.setAttribute(
        "aria-label",
        `${assetIndex + 1}번 원본 음성 삭제`
      );
      removeButton.disabled = shortTimelineSourceControlsDisabled;
      removeButton.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (shortTimelineSourceEditsBlocked()) {
          reportBlockedShortTimelineSourceEdit();
          return;
        }
        const sourceAudioAssets = project.shortForm.sourceAudioAssets;
        const currentIndex = sourceAudioAssets.findIndex((candidate) => (
          candidate.id === asset.id
        ));
        const focusAssetId = sourceAudioAssets[currentIndex + 1]?.id
          || sourceAudioAssets[currentIndex - 1]?.id
          || null;
        applyProject({
          ...project,
          shortForm: removeShortFormSourceAudioAsset(
            project.shortForm,
            asset.id
          )
        });
        showToast(
          "원본 음성만 삭제했습니다. 영상·자막·사진은 그대로 유지됩니다.",
          "success"
        );
        queueMicrotask(() => {
          const focusTarget = focusAssetId
            ? document.querySelector<HTMLButtonElement>(
              `.source-audio-asset-block[data-id="${CSS.escape(focusAssetId)}"] .source-audio-asset-block-body`
            )
            : null;
          (focusTarget || elements.source_audio_track).focus({
            preventScroll: true
          });
        });
      });
      block.append(
        makeHandle(
          "left",
          (event: PointerEvent) => bindShortTimelineSourceTrim(
            event.currentTarget as EditorControl,
            asset,
            "source-audio",
            "left",
            event
          ),
          (deltaMs: number) => nudgeShortTimelineSourceBoundary(
            "source-audio",
            asset.id,
            "left",
            deltaMs
          ),
          {
            label: `${assetIndex + 1}번 원본 음성 시작 시각`,
            valueMs: asset.timelineStartMs,
            minMs: Math.max(
              0,
              asset.timelineStartMs
                - (asset.sourceStartMs - asset.sourceSelectionStartMs)
            ),
            maxMs: asset.timelineEndMs - SHORT_FORM_MIN_CLIP_DURATION_MS,
            disabled: shortTimelineSourceControlsDisabled
          }
        ),
        body,
        removeButton,
        makeHandle(
          "right",
          (event: PointerEvent) => bindShortTimelineSourceTrim(
            event.currentTarget as EditorControl,
            asset,
            "source-audio",
            "right",
            event
          ),
          (deltaMs: number) => nudgeShortTimelineSourceBoundary(
            "source-audio",
            asset.id,
            "right",
            deltaMs
          ),
          {
            label: `${assetIndex + 1}번 원본 음성 끝 시각`,
            valueMs: asset.timelineEndMs,
            minMs: asset.timelineStartMs + SHORT_FORM_MIN_CLIP_DURATION_MS,
            maxMs: asset.timelineEndMs
              + (asset.sourceSelectionEndMs - asset.sourceEndMs),
            disabled: shortTimelineSourceControlsDisabled
          }
        )
      );
      elements.source_audio_track.append(block);
    });
  }

  (workspaceMode === "short-form"
    ? []
    : project.clips.filter((clip) => clip.enabled !== false)
  ).forEach((clip, index) => {
    const block = document.createElement("div");
    block.className = "clip-block";
    block.classList.toggle("selected", clip.id === project.selectedClipId);
    block.dataset.id = clip.id;
    block.style.left = `${timelineX(clip.timelineStartMs)}px`;
    block.style.width = `${Math.max(8, timelineX(clipDurationMs(clip)))}px`;
    const body = document.createElement("button");
    body.type = "button";
    body.className = "clip-block-body";
    body.textContent = `${index + 1} · ${clip.note || "사용자 선택"}`;
    body.addEventListener("click", () => {
      const seekSelection = shouldSeekTimelineItemSelection();
      project = { ...project, selectedClipId: clip.id };
      if (seekSelection) {
        void seekTimeline(clip.timelineStartMs);
      }
      renderAll({ keepScroll: true });
      const nextBlock = [...elements.video_track.querySelectorAll(".clip-block")]
        .find((candidate) => (candidate as EditorControl).dataset.id === clip.id);
      (nextBlock?.querySelector(".clip-block-body") as EditorControl)?.focus({ preventScroll: true });
      scheduleSave();
    });
    const nudgeClip = (side: TimelineSide, delta: number) => {
      const current = project.clips.find((candidate) => candidate.id === clip.id);
      const materialization = projectMaterialization();
      if (!current) {
        return;
      }
      if (projectUsesChzzkMaterializedMedia() && !materialization) {
        showToast(`${projectSourcePlatformLabel()} 편집 영상을 다시 준비한 뒤 컷 경계를 조정해 주세요.`, "error");
        return;
      }
      const editableBounds = materialization && current
        ? materializedEditableBoundsForClip(current, materialization)
          || logicalEditableBoundsForClip(
            current,
            materialization.sourceDurationMs,
            materialization.handleMs
          )
        : null;
      const minimumSourceMs = editableBounds?.editableSourceStartMs ?? 0;
      const maximumSourceMs = editableBounds?.editableSourceEndMs
        ?? (projectUsesChzzkMaterializedMedia()
          ? undefined
          : project.mediaAsset?.durationMs)
        ?? Infinity;
      const rawTargetSourceMs = side === "left"
        ? Math.max(
          0,
          Math.min(current.sourceEndMs - 100, current.sourceStartMs + delta)
        )
        : Math.min(
          materialization?.sourceDurationMs ?? maximumSourceMs,
          Math.max(current.sourceStartMs + 100, current.sourceEndMs + delta)
        );
      if (
        materialization
        && (
          (side === "left" && rawTargetSourceMs < minimumSourceMs)
          || (side === "right" && rawTargetSourceMs > maximumSourceMs)
        )
      ) {
        void requestVodHotLoadForClip(
          current,
          side === "left" ? "before" : "after",
          { targetSourceMs: rawTargetSourceMs, applyTrim: true }
        );
        return;
      }
      const sourceStartMs = side === "left"
        ? Math.max(
          minimumSourceMs,
          rawTargetSourceMs
        )
        : current!.sourceStartMs;
      const sourceEndMs = side === "right"
        ? Math.min(
          maximumSourceMs,
          rawTargetSourceMs
        )
        : current!.sourceEndMs;
      clearTimelineRangeSelection({ render: false });
      applyProject(
        updateClipTrim(project, clip.id, { sourceStartMs, sourceEndMs }),
        { render: false }
      );
      renderAll({ keepScroll: true });
      void syncPreviewToPlayhead();
    };
    const materialization = projectMaterialization();
    const staleMaterializedMedia = (
      projectUsesChzzkMaterializedMedia()
      && !materialization
    );
    const editableBounds = materialization
      ? materializedEditableBoundsForClip(clip, materialization)
        || logicalEditableBoundsForClip(
          clip,
          materialization.sourceDurationMs,
          materialization.handleMs
        )
      : null;
    const clipMinimumMs = staleMaterializedMedia
      ? clip.sourceStartMs
      : editableBounds?.editableSourceStartMs ?? 0;
    const clipMaximumMs = staleMaterializedMedia
      ? clip.sourceEndMs
      : editableBounds
      ? editableBounds.editableSourceEndMs
      : Number.isFinite(project.mediaAsset?.durationMs)
      ? Math.max(project.mediaAsset!.durationMs, clip.sourceEndMs)
      : Math.max(clip.sourceEndMs, clip.selectionEndMs || 0) + 3_600_000;
    block.append(
      makeHandle(
        "left",
        (event: PointerEvent) => bindClipTrim(
          event.currentTarget as EditorControl,
          clip,
          "left",
          event
        ),
        (delta: number) => nudgeClip("left", delta),
        {
          label: `${index + 1}번 컷 시작 시각`,
          valueMs: clip.sourceStartMs,
          minMs: clipMinimumMs,
          maxMs: clip.sourceEndMs - 100,
          disabled: staleMaterializedMedia
        }
      ),
      body,
      makeHandle(
        "right",
        (event: PointerEvent) => bindClipTrim(
          event.currentTarget as EditorControl,
          clip,
          "right",
          event
        ),
        (delta: number) => nudgeClip("right", delta),
        {
          label: `${index + 1}번 컷 끝 시각`,
          valueMs: clip.sourceEndMs,
          minMs: clip.sourceStartMs + 100,
          maxMs: clipMaximumMs,
          disabled: staleMaterializedMedia
        }
      )
    );
    elements.video_track.append(block);

    const audioSource = document.createElement("button");
    audioSource.type = "button";
    audioSource.className = "audio-source-block";
    audioSource.dataset.clipId = clip.id;
    audioSource.style.left = `${timelineX(clip.timelineStartMs)}px`;
    audioSource.style.width = `${Math.max(8, timelineX(clipDurationMs(clip)))}px`;
    audioSource.textContent = `${index + 1} · 원본 음성`;
    audioSource.title = "클릭하면 이 위치에 음성 설정 구간을 만듭니다.";
    audioSource.addEventListener("click", (event) => {
      const rect = elements.timeline_content.getBoundingClientRect();
      const timelineMs = (event.clientX - rect.left) / pixelsPerSecond * 1000;
      addAudioRegionAtTimeline(timelineMs);
    });
    elements.audio_track.append(audioSource);
  });

  (project.imageAssets || []).forEach((asset, assetIndex) => {
    const layout = assetLayout.byAssetId.get(asset.id);
    if (!layout) {
      return;
    }
    const { range, subrow } = layout;
    const block = document.createElement("div");
    block.className = "asset-block";
    block.classList.toggle("selected", asset.id === project.selectedImageAssetId);
    block.dataset.id = asset.id;
    block.dataset.subrow = String(subrow);
    block.style.left = `${timelineX(range.startMs)}px`;
    block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    block.style.setProperty(
      "--asset-block-top",
      `${ASSET_BLOCK_TOP_PX + subrow * ASSET_SUBROW_STRIDE_PX}px`
    );
    block.style.zIndex = asset.id === project.selectedImageAssetId ? "12" : "2";
    const body = document.createElement("button");
    body.type = "button";
    body.className = "asset-block-body";
    body.textContent = asset.name || `이미지 ${assetIndex + 1}`;
    body.title = `${asset.name || "이미지"} · 겹친 이미지는 이미지 트랙의 별도 줄에 표시됩니다.`;
    body.addEventListener("pointerdown", (event) => {
      bindTimedBlockMove(body, asset, "asset", event);
    });
    body.addEventListener("click", () => {
      if (consumeSuppressedTimedBlockClick("asset", asset.id)) {
        return;
      }
      selectImageAsset(asset.id, { seek: true });
    });
    const assetClip = project.clips.find((candidate) => candidate.id === asset.clipId);
    const nudgeAsset = (side: TimelineSide, delta: number) => {
      const current = project.imageAssets.find((candidate) => candidate.id === asset.id);
      const currentClip = project.clips.find((candidate) => candidate.id === current!.clipId);
      const duration = clipDurationMs(currentClip);
      const startOffsetMs = side === "left"
        ? Math.max(0, Math.min(current!.endOffsetMs - 100, current!.startOffsetMs + delta))
        : current!.startOffsetMs;
      const endOffsetMs = side === "right"
        ? Math.min(duration, Math.max(current!.startOffsetMs + 100, current!.endOffsetMs + delta))
        : current!.endOffsetMs;
      applyProject(
        updateImageAsset(project, asset.id, { startOffsetMs, endOffsetMs }),
        { render: false }
      );
      renderAll({ keepScroll: true });
    };
    block.append(
      makeHandle(
        "left",
        (event: PointerEvent) => bindImageAssetTrim(
          event.currentTarget as EditorControl,
          asset,
          "left",
          event
        ),
        (delta: number) => nudgeAsset("left", delta),
        {
          label: `${assetIndex + 1}번 이미지 시작 시각`,
          valueMs: range.startMs,
          minMs: assetClip!.timelineStartMs,
          maxMs: range.endMs - 100
        }
      ),
      body,
      makeHandle(
        "right",
        (event: PointerEvent) => bindImageAssetTrim(
          event.currentTarget as EditorControl,
          asset,
          "right",
          event
        ),
        (delta: number) => nudgeAsset("right", delta),
        {
          label: `${assetIndex + 1}번 이미지 끝 시각`,
          valueMs: range.endMs,
          minMs: range.startMs + 100,
          maxMs: assetClip!.timelineStartMs + clipDurationMs(assetClip)
        }
      )
    );
    elements.asset_track.append(block);
  });

  project.audioRegions.forEach((region, regionIndex) => {
    const range = audioRegionTimelineRange(project, region);
    if (!range) {
      return;
    }
    const block = document.createElement("div");
    block.className = "audio-block";
    block.classList.toggle("selected", region.id === project.selectedAudioRegionId);
    block.classList.toggle("muted", region.muted);
    block.dataset.id = region.id;
    block.style.left = `${timelineX(range.startMs)}px`;
    block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    const body = document.createElement("button");
    body.type = "button";
    body.className = "audio-block-body";
    body.textContent = region.muted ? "음소거" : `음량 ${Math.round(region.gain * 100)}%`;
    body.addEventListener("click", () => selectAudioRegion(region.id, {
      seek: true,
      focusTimeline: true
    }));
    const regionClip = project.clips.find((candidate) => candidate.id === region.clipId);
    const nudgeRegion = (side: TimelineSide, delta: number) => {
      const current = project.audioRegions.find((candidate) => candidate.id === region.id);
      const currentClip = project.clips.find((candidate) => candidate.id === current!.clipId);
      const duration = clipDurationMs(currentClip);
      const startOffsetMs = side === "left"
        ? Math.max(0, Math.min(current!.endOffsetMs - 100, current!.startOffsetMs + delta))
        : current!.startOffsetMs;
      const endOffsetMs = side === "right"
        ? Math.min(duration, Math.max(current!.startOffsetMs + 100, current!.endOffsetMs + delta))
        : current!.endOffsetMs;
      const nextProject = updateAudioRegion(project, region.id, { startOffsetMs, endOffsetMs });
      if (audioRegionHasOverlap(nextProject, region.id)) {
        showToast("음성 설정 구간끼리는 겹칠 수 없습니다.", "error");
        return;
      }
      applyProject(nextProject, { render: false });
      renderAll({ keepScroll: true });
      applyPreviewAudioSettings();
    };
    block.append(
      makeHandle(
        "left",
        (event: PointerEvent) => bindAudioTrim(
          event.currentTarget as EditorControl,
          region,
          "left",
          event
        ),
        (delta: number) => nudgeRegion("left", delta),
        {
          label: `${regionIndex + 1}번 음성 설정 시작 시각`,
          valueMs: range.startMs,
          minMs: regionClip!.timelineStartMs,
          maxMs: range.endMs - 100
        }
      ),
      body,
      makeHandle(
        "right",
        (event: PointerEvent) => bindAudioTrim(
          event.currentTarget as EditorControl,
          region,
          "right",
          event
        ),
        (delta: number) => nudgeRegion("right", delta),
        {
          label: `${regionIndex + 1}번 음성 설정 끝 시각`,
          valueMs: range.endMs,
          minMs: range.startMs + 100,
          maxMs: regionClip!.timelineStartMs + clipDurationMs(regionClip)
        }
      )
    );
    elements.audio_track.append(block);
  });

  project.subtitles.forEach((cue, cueIndex) => {
    const range = cueTimelineRange(project, cue);
    if (!range) {
      return;
    }
    const block = document.createElement("div");
    block.className = `cue-block ${cue.origin === "ai" ? "ai" : "human"}${cue.humanEdited ? " human-edited" : ""}`;
    const reviewRequired = subtitleCueNeedsReview(cue);
    block.classList.toggle("review-required", reviewRequired);
    if (reviewRequired) {
      block.title = captionReviewMessage(cue);
    }
    block.classList.toggle("selected", cue.id === project.selectedCueId);
    block.dataset.id = cue.id;
    block.dataset.lane = String(cue.lane);
    block.style.left = `${timelineX(range.startMs)}px`;
    block.style.width = `${Math.max(8, timelineX(range.endMs - range.startMs))}px`;
    block.style.setProperty("--cue-color", cue.color || "#ffffff");
    const body = document.createElement("button");
    body.type = "button";
    body.className = "cue-block-body";
    body.textContent = cue.text || "(빈 자막)";
    body.addEventListener("pointerdown", (event) => {
      bindTimedBlockMove(body, cue, "subtitle", event);
    });
    body.addEventListener("click", () => {
      if (consumeSuppressedTimedBlockClick("subtitle", cue.id)) {
        return;
      }
      selectCue(cue.id, { seek: true });
    });
    const cueClip = project.clips.find((candidate) => candidate.id === cue.clipId);
    const nudgeCue = (side: TimelineSide, delta: number) => {
      const current = project.subtitles.find((candidate) => candidate.id === cue.id);
      const currentClip = project.clips.find((candidate) => candidate.id === current!.clipId);
      const duration = clipDurationMs(currentClip);
      const startOffsetMs = side === "left"
        ? Math.max(0, Math.min(current!.endOffsetMs - 100, current!.startOffsetMs + delta))
        : current!.startOffsetMs;
      const endOffsetMs = side === "right"
        ? Math.min(duration, Math.max(current!.startOffsetMs + 100, current!.endOffsetMs + delta))
        : current!.endOffsetMs;
      const nextProject = updateSubtitleCue(project, cue.id, { startOffsetMs, endOffsetMs });
      if (cueHasOverlap(nextProject, cue.id)) {
        showToast("같은 자막 레인 안에서는 자막이 겹칠 수 없습니다.", "error");
        return;
      }
      applyProject(nextProject, { render: false });
      renderAll({ keepScroll: true });
    };
    block.append(
      makeHandle(
        "left",
        (event: PointerEvent) => bindCueTrim(
          event.currentTarget as EditorControl,
          cue,
          "left",
          event
        ),
        (delta: number) => nudgeCue("left", delta),
        {
          label: `${cueIndex + 1}번 자막 시작 시각`,
          valueMs: range.startMs,
          minMs: cueClip!.timelineStartMs,
          maxMs: range.endMs - 100
        }
      ),
      body,
      makeHandle(
        "right",
        (event: PointerEvent) => bindCueTrim(
          event.currentTarget as EditorControl,
          cue,
          "right",
          event
        ),
        (delta: number) => nudgeCue("right", delta),
        {
          label: `${cueIndex + 1}번 자막 끝 시각`,
          valueMs: range.endMs,
          minMs: range.startMs + 100,
          maxMs: cueClip!.timelineStartMs + clipDurationMs(cueClip)
        }
      )
    );
    const captionRow = captionRows[cue.lane] ?? captionRows[0];
    if (!captionRow) {
      throw new Error("자막 타임라인 레인을 준비하지 못했습니다.");
    }
    captionRow.append(block);
  });

  renderTimelineRange();
  updatePlayhead();
  if (keepScroll) {
    elements.timeline_scroll.scrollLeft = scrollLeft;
  }
}

function videoContentRect(container = elements.image_asset_overlays) {
  const containerRect = container.getBoundingClientRect();
  if (workspaceMode === "short-form") {
    const canvasRect = elements.short_workspace_preview.getBoundingClientRect();
    return {
      left: canvasRect.left - containerRect.left,
      top: canvasRect.top - containerRect.top,
      width: canvasRect.width,
      height: canvasRect.height
    };
  }
  const video = elements.preview_video;
  const videoRect = video.getBoundingClientRect();
  const surfaceLeft = videoRect.left - containerRect.left;
  const surfaceTop = videoRect.top - containerRect.top;
  if (!video.videoWidth || !video.videoHeight) {
    return {
      left: surfaceLeft,
      top: surfaceTop,
      width: videoRect.width,
      height: videoRect.height
    };
  }
  const scale = Math.min(
    videoRect.width / video.videoWidth,
    videoRect.height / video.videoHeight
  );
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  return {
    left: surfaceLeft + (videoRect.width - width) / 2,
    top: surfaceTop + (videoRect.height - height) / 2,
    width,
    height
  };
}

async function renderImageAssetOverlays() {
  const sequence = ++imageAssetRenderSequence;
  elements.image_asset_overlays.replaceChildren();
  const assets = workspaceMode === "short-form" || mediaFile
    ? imageAssetsAtTimeline(project, project.playheadMs)
    : [];
  if (assets.length === 0) {
    return;
  }
  const resolved = await Promise.all(assets.map(async (asset) => ({
    asset,
    url: await resolveImageAssetUrl(asset)
  })));
  if (sequence !== imageAssetRenderSequence) {
    return;
  }
  const contentRect = videoContentRect();
  resolved.forEach(({ asset, url }) => {
    if (!url) {
      return;
    }
    const naturalWidth = Math.max(1, asset.naturalWidth || 512);
    const naturalHeight = Math.max(1, asset.naturalHeight || 512);
    const drawRect = imageAssetDrawRect(
      { width: contentRect.width, height: contentRect.height },
      asset,
      { width: naturalWidth, height: naturalHeight }
    );
    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.tabIndex = (
      workspaceMode === "short-form" && propertyInspectorMode !== "asset"
    ) ? -1 : 0;
    overlay.className = "image-asset-overlay";
    overlay.classList.toggle("selected", asset.id === project.selectedImageAssetId);
    overlay.dataset.assetId = asset.id;
    overlay.setAttribute("aria-label", `이미지: ${asset.name}`);
    overlay.style.left = `${contentRect.left + drawRect.x + drawRect.width / 2}px`;
    overlay.style.top = `${contentRect.top + drawRect.y + drawRect.height / 2}px`;
    overlay.style.width = `${drawRect.width}px`;
    overlay.style.height = `${drawRect.height}px`;
    overlay.style.opacity = String(asset.opacity);
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.draggable = false;
    const indicator = document.createElement("i");
    indicator.className = "asset-drag-indicator";
    indicator.setAttribute("aria-hidden", "true");
    overlay.append(image, indicator);
    elements.image_asset_overlays.append(overlay);
  });
}

function renderSubtitleOverlay() {
  elements.subtitle_overlays.replaceChildren();
  const cues = workspaceMode === "short-form" || mediaFile
    ? cuesAtTimeline(project, project.playheadMs)
    : [];
  if (cues.length === 0) {
    return;
  }
  const contentRect = videoContentRect(elements.subtitle_overlays);
  cues.forEach((cue) => {
    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.tabIndex = (
      workspaceMode === "short-form" && propertyInspectorMode !== "caption"
    ) ? -1 : 0;
    overlay.className = "subtitle-overlay";
    overlay.classList.toggle("selected", cue.id === project.selectedCueId);
    overlay.dataset.cueId = cue.id;
    overlay.setAttribute("aria-label", `${cue.lane + 1}번 레인 자막: ${cue.text || "빈 자막"}`);
    const text = document.createElement("span");
    const maximumLines = Math.max(
      1,
      Math.min(2, Math.round(Number(project.subtitleDefaults.maxLines) || 1))
    );
    const displayText = maximumLines === 1
      ? singleLineCaptionText(cue.text)
      : String(cue.text || "");
    text.textContent = displayText || " ";
    const indicator = document.createElement("i");
    indicator.className = "drag-indicator";
    indicator.setAttribute("aria-hidden", "true");
    overlay.append(text, indicator);
    overlay.style.left = `${contentRect.left + contentRect.width * cue.x}px`;
    overlay.style.top = `${contentRect.top + contentRect.height * cue.y}px`;
    const maxWidth = contentRect.width * (
      project.subtitleDefaults.maxWidth || 0.86
    );
    overlay.style.maxWidth = `${maxWidth}px`;
    overlay.style.whiteSpace = maximumLines === 1 ? "nowrap" : "pre-wrap";
    const fontScale = cue.fontScale
      || project.subtitleDefaults.fontScale
      || 0.0675;
    let fontSize = captionFontSizeForSurface(
      contentRect.height,
      fontScale,
      14
    );
    const fontFamily = String(
      project.subtitleDefaults.fontFamily || "Pretendard"
    ).replace(/["\\]/gu, "");
    const fontWeight = Math.round(
      Number(project.subtitleDefaults.fontWeight) || 800
    );
    if (maximumLines === 1 && displayText) {
      const measureContext = document.createElement("canvas").getContext("2d");
      if (measureContext) {
        measureContext.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Noto Sans KR", sans-serif`;
        fontSize = fitSingleLineCaptionFontSize({
          baseFontSize: fontSize,
          measuredWidth: measureContext.measureText(displayText).width,
          maxWidth
        });
      }
    }
    overlay.style.fontSize = `${fontSize}px`;
    overlay.style.fontFamily = `"${fontFamily}", "Noto Sans KR", sans-serif`;
    overlay.style.fontWeight = String(fontWeight);
    overlay.style.lineHeight = String(
      Number(project.subtitleDefaults.lineHeight) || 1.24
    );
    overlay.style.color = cue.color || project.subtitleDefaults.color || "#ffffff";
    const cueBackground = resolveSubtitleCueBackground(
      project.subtitleDefaults,
      cue
    );
    overlay.style.backgroundColor = cueBackground.color;
    overlay.style.borderRadius = `${cueBackground.radiusEm}em`;
    overlay.style.textShadow = [
      `${Number(project.subtitleDefaults.shadowOffsetXEm) || 0}em`,
      `${Number(project.subtitleDefaults.shadowOffsetYEm) || 0}em`,
      `${Math.max(0, Number(project.subtitleDefaults.shadowBlurEm) || 0)}em`,
      String(project.subtitleDefaults.shadowColor || "rgba(0, 0, 0, 0.45)")
    ].join(" ");
    overlay.style.setProperty(
      "--subtitle-stroke",
      `${Math.max(1.5, contentRect.height * (project.subtitleDefaults.outlineWidth || 0.006))}px`
    );
    overlay.style.setProperty(
      "--subtitle-outline-color",
      project.subtitleDefaults.outlineColor || "#111111"
    );
    elements.subtitle_overlays.append(overlay);

    const overlayRect = overlay.getBoundingClientRect();
    const halfWidth = Math.min(overlayRect.width / 2, contentRect.width / 2);
    const halfHeight = Math.min(overlayRect.height / 2, contentRect.height / 2);
    const desiredLeft = contentRect.left + contentRect.width * cue.x;
    const desiredTop = contentRect.top + contentRect.height * cue.y;
    overlay.style.left = `${Math.min(
      contentRect.left + contentRect.width - halfWidth,
      Math.max(contentRect.left + halfWidth, desiredLeft)
    )}px`;
    overlay.style.top = `${Math.min(
      contentRect.top + contentRect.height - halfHeight,
      Math.max(contentRect.top + halfHeight, desiredTop)
    )}px`;
  });
}

function shortCanvasTimelineMsFromClock(): number {
  if (!shortCanvasPlaybackActive) {
    return project?.playheadMs || 0;
  }
  const elapsedMs = Math.max(
    0,
    performance.now() - shortCanvasPlaybackAnchorPerformanceMs
  );
  return Math.min(
    project.shortForm.durationMs,
    shortCanvasPlaybackAnchorTimelineMs + elapsedMs
  );
}

function shortPreviewSourceAudioAssetAtTimeline(
  timelineMsValue: unknown
): ShortFormSourceAudioAsset | null {
  if (!project || workspaceMode !== "short-form") {
    return null;
  }
  const timelineMs = Math.max(
    0,
    Math.min(project.shortForm.durationMs, Number(timelineMsValue) || 0)
  );
  return shortPreviewIndependentSourceAudioAssets(project.shortForm).find((asset) => (
    timelineMs >= asset.timelineStartMs
    && timelineMs < asset.timelineEndMs
  )) || null;
}

function shortPreviewSourceAudioMatchesVideo(
  audio: ShortFormSourceAudioAsset,
  video: Pick<
    ShortFormVideoAsset,
    | "sourceAssetId"
    | "sourceClipId"
    | "sourceSelectionStartMs"
    | "sourceSelectionEndMs"
    | "sourceStartMs"
    | "sourceEndMs"
    | "timelineStartMs"
    | "timelineEndMs"
  >
): boolean {
  return shortPreviewSourceAudioExactlyOverridesVideo(video, audio);
}

/**
 * v6 initially exposed source audio as a separate authoring asset. Exact
 * video/audio twins are now treated as one A/V asset; only genuinely
 * independent legacy records continue through the compatibility decoder.
 */
function shortPreviewIndependentSourceAudioAssets(
  shortForm: EditorProject["shortForm"]
): ShortFormSourceAudioAsset[] {
  return shortForm.sourceAudioAssets.filter((audio) => (
    !shortForm.videoAssets.some((video) => (
      shortPreviewSourceAudioMatchesVideo(audio, video)
    ))
  ));
}

function shortPreviewVideoAudioOverride(
  video: ShortFormVideoAsset
): ShortFormSourceAudioAsset | null {
  return project.shortForm.sourceAudioAssets.find((audio) => (
    shortPreviewSourceAudioMatchesVideo(audio, video)
  )) || null;
}

function previewAudioRegionMixAt(
  timelineMs: number
): { region: EditorAudioRegion | null; gain: number } {
  const region = audioRegionAtTimeline(project, timelineMs);
  const targetGain = region?.muted ? 0 : (region?.gain ?? 1);
  let blend = region ? 1 : 0;
  if (region) {
    const range = audioRegionTimelineRange(project, region);
    if (range) {
      const elapsedMs = Math.max(0, timelineMs - range.startMs);
      const remainingMs = Math.max(0, range.endMs - timelineMs);
      if (region.fadeInMs > 0) {
        blend = Math.min(blend, Math.min(1, elapsedMs / region.fadeInMs));
      }
      if (region.fadeOutMs > 0) {
        blend = Math.min(blend, Math.min(1, remainingMs / region.fadeOutMs));
      }
    }
  }
  return {
    region,
    gain: 1 + (targetGain - 1) * blend
  };
}

function requestShortPreviewSourceAudioPlay(
  state: ShortPreviewSourceAudioState,
  sequence: number
): void {
  if (
    state.error
    || !state.video.paused
    || state.playPromise
    || workspaceMode !== "short-form"
    || !shortCanvasPlaybackActive
  ) {
    return;
  }
  // Starting muted keeps both stale seeks and browser autoplay policy from
  // exposing source audio before this decoder is aligned to the canvas clock.
  state.video.muted = true;
  state.video.volume = 0;
  let playPromise: Promise<void>;
  try {
    playPromise = state.video.play();
  } catch (error) {
    console.warn("쇼츠 원본 음성 미리보기를 시작하지 못했습니다.", error);
    return;
  }
  state.playPromise = playPromise;
  void playPromise
    .then(() => {
      if (state.playPromise === playPromise) {
        state.playPromise = null;
      }
      if (shortPreviewSourceAudioState !== state) {
        state.video.pause();
        return;
      }
      if (
        sequence !== shortPreviewSourceAudioSequence
        || workspaceMode !== "short-form"
        || !shortCanvasPlaybackActive
      ) {
        state.video.muted = true;
        state.video.volume = 0;
        if (!shortCanvasPlaybackActive || workspaceMode !== "short-form") {
          state.video.pause();
        }
        return;
      }
      syncShortPreviewSourceAudioAtTimeline(
        shortCanvasTimelineMsFromClock(),
        { play: true }
      );
    })
    .catch((error: unknown) => {
      if (state.playPromise === playPromise) {
        state.playPromise = null;
      }
      state.video.muted = true;
      state.video.volume = 0;
      if (
        shortPreviewSourceAudioState === state
        && sequence === shortPreviewSourceAudioSequence
        && errorName(error) !== "AbortError"
      ) {
        console.warn("쇼츠 원본 음성 미리보기를 시작하지 못했습니다.", error);
      }
    });
}

function syncShortPreviewSourceAudioAtTimeline(
  timelineMsValue: unknown,
  {
    play = shortCanvasPlaybackActive,
    forceSeek = false
  }: { play?: boolean; forceSeek?: boolean } = {}
): void {
  if (!project || workspaceMode !== "short-form") {
    return;
  }
  const timelineMs = Math.max(
    0,
    Math.min(project.shortForm.durationMs, Number(timelineMsValue) || 0)
  );
  const assets = shortPreviewIndependentSourceAudioAssets(project.shortForm);
  if (assets.length === 0) {
    const previous = shortPreviewSourceAudioState;
    if (previous) {
      previous.assetId = null;
      previous.targetSeconds = Number.NaN;
      previous.synchronized = false;
      previous.video.muted = true;
      previous.video.volume = 0;
      previous.video.pause();
    }
    return;
  }

  const asset = shortPreviewSourceAudioAssetAtTimeline(timelineMs);
  if (!asset) {
    const state = shortPreviewSourceAudioState;
    if (!state) {
      return;
    }
    if (state.assetId !== null) {
      shortPreviewSourceAudioSequence += 1;
    }
    state.assetId = null;
    state.targetSeconds = Number.NaN;
    state.synchronized = false;
    state.video.muted = true;
    state.video.volume = 0;
    state.video.pause();
    return;
  }

  const exactCache = shortPreviewCacheForSourceAudioAsset(asset, rootProject);
  if (!exactCache) {
    const previous = shortPreviewSourceAudioState;
    if (previous) {
      previous.assetId = null;
      previous.targetSeconds = Number.NaN;
      previous.synchronized = false;
      previous.video.muted = true;
      previous.video.volume = 0;
      previous.video.pause();
    }
    return;
  }

  const state = ensureShortPreviewSourceAudio(asset);
  if (!state || state.error) {
    return;
  }

  const sourceMs = asset.sourceStartMs + timelineMs - asset.timelineStartMs;
  const targetSeconds = (
    sourceMs
    - state.cacheSourceStartMs
    + state.cacheMediaOffsetMs
  ) / 1000;
  if (!Number.isFinite(targetSeconds)) {
    state.assetId = null;
    state.targetSeconds = Number.NaN;
    state.synchronized = false;
    state.video.muted = true;
    state.video.volume = 0;
    state.video.pause();
    return;
  }

  const assetChanged = state.assetId !== asset.id;
  if (assetChanged || forceSeek) {
    shortPreviewSourceAudioSequence += 1;
    state.synchronized = false;
    state.video.muted = true;
    state.video.volume = 0;
  }
  state.assetId = asset.id;
  state.targetSeconds = targetSeconds;
  const maximumDriftSeconds = play
    ? SHORT_PREVIEW_SOURCE_AUDIO_AUDIBLE_DRIFT_SECONDS
    : SHORT_PREVIEW_SOURCE_AUDIO_PAUSED_DRIFT_SECONDS;
  const driftSeconds = Math.abs(state.video.currentTime - targetSeconds);
  if (
    play
    && (assetChanged || forceSeek || driftSeconds > maximumDriftSeconds)
  ) {
    state.synchronized = false;
    state.video.muted = true;
    state.video.volume = 0;
    if (
      performance.now() - shortCanvasPlaybackAnchorPerformanceMs
      >= SHORT_PREVIEW_PLAYBACK_START_GRACE_MS
    ) {
      requestShortCanvasPlaybackReprime(timelineMs);
    }
    return;
  }
  if (
    (forceSeek || assetChanged || driftSeconds > maximumDriftSeconds)
    && state.video.readyState >= HTMLMediaElement.HAVE_METADATA
  ) {
    state.synchronized = false;
    state.video.muted = true;
    state.video.volume = 0;
    if (!state.video.seeking) {
      try {
        state.video.currentTime = targetSeconds;
      } catch (error) {
        console.warn("쇼츠 원본 음성 시각을 맞추지 못했습니다.", error);
      }
    }
  }
  state.synchronized = (
    !state.video.seeking
    && state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && Math.abs(state.video.currentTime - targetSeconds) <= (
      play
        ? SHORT_PREVIEW_SOURCE_AUDIO_AUDIBLE_DRIFT_SECONDS
        : SHORT_PREVIEW_SOURCE_AUDIO_PAUSED_DRIFT_SECONDS
    )
  );

  if (play) {
    requestShortPreviewSourceAudioPlay(
      state,
      shortPreviewSourceAudioSequence
    );
  } else {
    state.video.pause();
  }
  applyPreviewAudioSettings(timelineMs);
}

function startShortPreviewSourceAudioClock(): void {
  if (
    shortPreviewSourceAudioTimer !== null
    || workspaceMode !== "short-form"
    || !shortCanvasPlaybackActive
    || shortPreviewIndependentSourceAudioAssets(project.shortForm).length === 0
  ) {
    return;
  }
  const tick = () => {
    shortPreviewSourceAudioTimer = null;
    if (workspaceMode !== "short-form" || !shortCanvasPlaybackActive) {
      return;
    }
    syncShortPreviewSourceAudioAtTimeline(
      shortCanvasTimelineMsFromClock(),
      { play: true }
    );
    if (
      shortCanvasPlaybackActive
      && workspaceMode === "short-form"
      && !shortPreviewSourceAudioState?.error
    ) {
      shortPreviewSourceAudioTimer = setTimeout(
        tick,
        PREVIEW_AUDIO_CLOCK_INTERVAL_MS
      );
    }
  };
  shortPreviewSourceAudioTimer = setTimeout(
    tick,
    PREVIEW_AUDIO_CLOCK_INTERVAL_MS
  );
}

function shortCanvasPlaybackSignatureAtTimeline(
  timelineMsValue: unknown
): string {
  const timelineMs = Math.max(
    0,
    Math.min(project.shortForm.durationMs, Number(timelineMsValue) || 0)
  );
  const videoIds = shortFormVideoAssetsAtTimeline(
    project.shortForm,
    timelineMs
  )
    .filter((asset) => asset.visible && asset.opacity > 0)
    .map((asset) => asset.id);
  const sourceAudioId = shortPreviewSourceAudioAssetAtTimeline(timelineMs)?.id
    || "";
  return `${videoIds.join("\u001f")}|audio:${sourceAudioId}`;
}

function shortPreviewLayerIsPrimed(
  layer: ActiveShortFormVideoAsset
): boolean {
  const state = shortPreviewLayerVideos.get(layer.id);
  if (!state || state.error || !Number.isFinite(state.targetSeconds)) {
    return false;
  }
  return Boolean(
    state.ready
    && state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && !state.video.seeking
    && state.seekingTargetSeconds === null
    && Math.abs(state.video.currentTime - state.targetSeconds)
      <= SHORT_PREVIEW_PRIMING_SETTLE_SECONDS
  );
}

function shortPreviewSourceAudioIsPrimed(timelineMs: number): boolean {
  const asset = shortPreviewSourceAudioAssetAtTimeline(timelineMs);
  if (!asset) {
    return true;
  }
  const state = shortPreviewSourceAudioState;
  return Boolean(
    state
    && !state.error
    && state.assetId === asset.id
    && Number.isFinite(state.targetSeconds)
    && state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && !state.video.seeking
    && Math.abs(state.video.currentTime - state.targetSeconds)
      <= SHORT_PREVIEW_PRIMING_SETTLE_SECONDS
  );
}

async function primeShortCanvasPlayback(
  timelineMs: number,
  generation: number
): Promise<string> {
  const deadline = performance.now() + SHORT_PREVIEW_PRIMING_TIMEOUT_MS;
  let firstAttempt = true;
  while (
    generation === shortCanvasPlaybackGeneration
    && shortCanvasPlaybackPriming
    && workspaceMode === "short-form"
  ) {
    if (!shortPreviewSourceCachesReadyAtTimeline(
      rootProject,
      project.shortForm,
      timelineMs
    )) {
      throw new Error(
        "현재 시점의 쇼츠 미리보기 영상이 아직 준비되지 않았습니다."
      );
    }
    const activeLayers = shortFormVideoAssetsAtTimeline(
      project.shortForm,
      timelineMs
    ).filter((asset) => asset.visible && asset.opacity > 0);
    const activeLayerIds = new Set(activeLayers.map((asset) => asset.id));
    releaseShortPreviewLayerVideos(activeLayerIds);
    for (const layer of activeLayers) {
      ensureShortPreviewLayerVideo(layer);
      const state = shortPreviewLayerVideos.get(layer.id);
      if (state?.error) {
        throw state.error;
      }
    }
    syncShortPreviewSourceAudioAtTimeline(timelineMs, {
      play: false,
      forceSeek: firstAttempt
    });
    firstAttempt = false;
    if (shortPreviewSourceAudioState?.error) {
      throw shortPreviewSourceAudioState.error;
    }
    scheduleShortWorkspacePreview();
    if (
      activeLayers.every(shortPreviewLayerIsPrimed)
      && shortPreviewSourceAudioIsPrimed(timelineMs)
    ) {
      return shortCanvasPlaybackSignatureAtTimeline(timelineMs);
    }
    if (performance.now() >= deadline) {
      throw new Error(
        "로컬 쇼츠 영상을 제한 시간 안에 디코딩하지 못했습니다. 미리보기를 다시 만들어 주세요."
      );
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new DOMException("쇼츠 재생 준비가 취소되었습니다.", "AbortError");
}

function requestShortCanvasPlaybackReprime(timelineMsValue: unknown): void {
  if (
    !shortCanvasPlaybackActive
    || shortCanvasPlaybackReprimeScheduled
    || workspaceMode !== "short-form"
  ) {
    return;
  }
  const generation = shortCanvasPlaybackGeneration;
  const timelineMs = Math.max(
    0,
    Math.min(project.shortForm.durationMs, Number(timelineMsValue) || 0)
  );
  shortCanvasPlaybackReprimeScheduled = true;
  queueMicrotask(() => {
    shortCanvasPlaybackReprimeScheduled = false;
    if (
      generation !== shortCanvasPlaybackGeneration
      || !shortCanvasPlaybackActive
      || workspaceMode !== "short-form"
    ) {
      return;
    }
    stopShortCanvasPlayback({ keepCurrentTime: false });
    project.playheadMs = timelineMs;
    updatePlayhead();
    void startShortCanvasPlayback();
  });
}

function stopShortCanvasPlayback({ keepCurrentTime = true } = {}): void {
  if (keepCurrentTime && project && workspaceMode === "short-form") {
    project.playheadMs = shortCanvasTimelineMsFromClock();
  }
  shortCanvasPlaybackGeneration += 1;
  shortCanvasPlaybackPriming = false;
  shortCanvasPlaybackActive = false;
  shortCanvasPlaybackPreparedSignature = "";
  shortCanvasPlaybackReprimeScheduled = false;
  if (shortCanvasPlaybackFrame !== null) {
    cancelAnimationFrame(shortCanvasPlaybackFrame);
    shortCanvasPlaybackFrame = null;
  }
  pauseShortPreviewSourceAudio();
  pauseShortPreviewLayerVideos();
  elements.preview_video.pause();
  elements.play_toggle.classList.remove("playing");
  elements.play_toggle.removeAttribute("aria-busy");
  if (project && workspaceMode === "short-form") {
    updatePlayhead();
  }
}

async function startShortCanvasPlayback(): Promise<void> {
  if (
    workspaceMode !== "short-form"
    || shortCanvasPlaybackActive
    || shortCanvasPlaybackPriming
  ) {
    return;
  }
  if (project.playheadMs >= project.shortForm.durationMs) {
    project.playheadMs = 0;
  }
  const startTimelineMs = project.playheadMs;
  const generation = shortCanvasPlaybackGeneration + 1;
  shortCanvasPlaybackGeneration = generation;
  shortCanvasPlaybackPriming = true;
  shortCanvasPlaybackPreparedSignature = "";
  pauseShortPreviewSourceAudio();
  pauseShortPreviewLayerVideos();
  elements.play_toggle.classList.remove("playing");
  elements.play_toggle.setAttribute("aria-busy", "true");
  elements.short_workspace_preview.dataset.previewState = "preparing";
  elements.short_workspace_preview.setAttribute("aria-busy", "true");
  project.playheadMs = startTimelineMs;
  updatePlayhead();
  try {
    shortCanvasPlaybackPreparedSignature = await primeShortCanvasPlayback(
      startTimelineMs,
      generation
    );
  } catch (error) {
    if (
      generation !== shortCanvasPlaybackGeneration
      || errorName(error) === "AbortError"
    ) {
      return;
    }
    shortCanvasPlaybackPriming = false;
    shortPreviewCacheError = errorDetails(error);
    pauseShortPreviewSourceAudio();
    pauseShortPreviewLayerVideos();
    elements.play_toggle.removeAttribute("aria-busy");
    renderShortFramingInspector();
    showToast(`쇼츠 재생을 준비하지 못했습니다: ${shortPreviewCacheError}`, "error", 0);
    return;
  }
  if (
    generation !== shortCanvasPlaybackGeneration
    || !shortCanvasPlaybackPriming
    || workspaceMode !== "short-form"
  ) {
    return;
  }
  shortCanvasPlaybackPriming = false;
  shortCanvasPlaybackAnchorTimelineMs = startTimelineMs;
  shortCanvasPlaybackAnchorPerformanceMs = performance.now();
  shortCanvasLastUiUpdatePerformanceMs = 0;
  shortCanvasPlaybackActive = true;
  elements.play_toggle.removeAttribute("aria-busy");
  elements.play_toggle.classList.add("playing");
  for (const layer of shortFormVideoAssetsAtTimeline(
    project.shortForm,
    startTimelineMs
  ).filter((asset) => asset.visible && asset.opacity > 0)) {
    const state = shortPreviewLayerVideos.get(layer.id);
    if (state) {
      requestShortPreviewLayerPlay(layer.id, state);
    }
  }
  syncShortPreviewSourceAudioAtTimeline(startTimelineMs, {
    play: true,
    forceSeek: false
  });
  startShortPreviewSourceAudioClock();
  const tick = () => {
    shortCanvasPlaybackFrame = null;
    if (!shortCanvasPlaybackActive || workspaceMode !== "short-form") {
      return;
    }
    project.playheadMs = shortCanvasTimelineMsFromClock();
    if (project.playheadMs >= project.shortForm.durationMs) {
      stopShortCanvasPlayback({ keepCurrentTime: false });
      return;
    }
    if (
      shortCanvasPlaybackSignatureAtTimeline(project.playheadMs)
      !== shortCanvasPlaybackPreparedSignature
    ) {
      requestShortCanvasPlaybackReprime(project.playheadMs);
      return;
    }
    const now = performance.now();
    if (
      now - shortCanvasLastUiUpdatePerformanceMs >= 100
      || project.playheadMs >= project.shortForm.durationMs
    ) {
      shortCanvasLastUiUpdatePerformanceMs = now;
      updatePlayhead();
    }
    shortCanvasPlaybackFrame = requestAnimationFrame(tick);
  };
  shortCanvasPlaybackFrame = requestAnimationFrame(tick);
}

function previewTimelineMsFromVideoClock() {
  if (workspaceMode === "short-form") {
    return shortCanvasTimelineMsFromClock();
  }
  const video = elements.preview_video;
  if (!video || !project || !mediaFile || pendingPreviewSeek) {
    return project?.playheadMs || 0;
  }
  const clip = project.clips.find((candidate) => candidate.id === activeClipId);
  if (!clip) {
    return project.playheadMs || 0;
  }
  const sourceMs = previewSecondsToSourceMs(video.currentTime);
  if (!Number.isFinite(sourceMs)) {
    return project.playheadMs || 0;
  }
  return Math.max(
    clip.timelineStartMs,
    Math.min(
      clip.timelineStartMs + clipDurationMs(clip),
      clip.timelineStartMs + sourceMs - clip.sourceStartMs
    )
  );
}

function previewPlaybackIsActive() {
  if (workspaceMode === "short-form") {
    return shortCanvasPlaybackActive || shortCanvasPlaybackPriming;
  }
  const video = elements.preview_video;
  return Boolean(
    mediaFile
    && video
    && !video.paused
    && !video.ended
  );
}

function previewTimelineMsForProject(candidateProject: EditorProject) {
  if (workspaceMode === "short-form") {
    return Math.max(
      0,
      Math.min(
        candidateProject.shortForm.durationMs,
        shortCanvasTimelineMsFromClock()
      )
    );
  }
  if (!mediaFile || !activeClipId) {
    return null;
  }
  const clip = candidateProject.clips.find(
    (candidate) => candidate.id === activeClipId && candidate.enabled !== false
  );
  if (!clip) {
    return null;
  }
  const pendingSourceMs = Number(pendingPreviewSeek?.sourceMs);
  const sourceMs = Number.isFinite(pendingSourceMs)
    ? pendingSourceMs
    : previewSecondsToSourceMs(elements.preview_video.currentTime);
  if (!Number.isFinite(sourceMs)) {
    return null;
  }
  return Math.max(
    clip.timelineStartMs,
    Math.min(
      clip.timelineStartMs + clipDurationMs(clip),
      clip.timelineStartMs + sourceMs - clip.sourceStartMs
    )
  );
}

function syncProjectPlayheadToPreviewClock({ allowPaused = false } = {}) {
  if (!allowPaused && !previewPlaybackIsActive()) {
    return false;
  }
  const playheadMs = previewTimelineMsForProject(project);
  if (playheadMs === null) {
    return false;
  }
  project = {
    ...project,
    playheadMs
  };
  return true;
}

function withCurrentTimelinePlayhead(nextProject: EditorProject) {
  return nextProject.playheadMs === project.playheadMs
    ? nextProject
    : {
      ...nextProject,
      playheadMs: project.playheadMs
    };
}

function shouldSeekTimelineItemSelection() {
  const previewIsPlaying = previewPlaybackIsActive();
  if (previewIsPlaying) {
    syncProjectPlayheadToPreviewClock();
  }
  return !previewIsPlaying;
}

function applyPreviewAudioSettings(timelineMs = project?.playheadMs || 0) {
  const video = elements.preview_video;
  if (!video || !project) {
    return;
  }
  const targetTimelineMs = Math.max(
    0,
    Math.min(projectDurationMs(project), Number(timelineMs) || 0)
  );
  const { region, gain: regionGain } = previewAudioRegionMixAt(targetTimelineMs);
  const shortSourceAudioAsset = workspaceMode === "short-form"
    ? shortPreviewSourceAudioAssetAtTimeline(targetTimelineMs)
    : null;
  if (workspaceMode === "short-form") {
    // The primary preview video is hidden in the black-canvas workspace and
    // must never become an implicit source-audio path.
    video.muted = true;
    video.volume = 0;
    const activeVideoAssets = shortFormVideoAssetsAtTimeline(
      project.shortForm,
      targetTimelineMs
    ).filter((asset) => asset.visible && asset.opacity > 0);
    const activeVideoById = new Map(
      activeVideoAssets.map((asset) => [asset.id, asset])
    );
    for (const [assetId, layerState] of shortPreviewLayerVideos) {
      const asset = activeVideoById.get(assetId);
      const cache = asset ? shortPreviewAssetCaches.get(asset.id) : null;
      const override = asset ? shortPreviewVideoAudioOverride(asset) : null;
      const assetGain = asset
        ? override
          ? shortFormSourceAudioAssetGainAt(
            override,
            targetTimelineMs / 1_000
          )
          : 1
        : 0;
      const volume = Math.max(
        0,
        Math.min(
          2,
          previewVolume * regionGain * assetGain * (asset?.audioGain ?? 1)
        )
      );
      const combinedAvCacheReady = Boolean(
        asset
        && cache
        && shortPreviewCombinedAvCacheReady({
          cacheMatches: shortPreviewAssetCacheMatches(
            cache,
            asset,
            rootProject
          ),
          cacheCoversSourceTime: shortPreviewCacheCoverageContainsTime(
            cache,
            asset.sourceTimeMs
          ),
          cacheHasAudio: cache.hasAudio === true
        })
      );
      const decoderSynchronized = Boolean(
        asset
        && layerState.ready
        && !layerState.video.paused
        && !layerState.video.ended
        && !layerState.video.seeking
        && layerState.seekingTargetSeconds === null
        && Number.isFinite(layerState.targetSeconds)
        && Math.abs(
          layerState.video.currentTime - layerState.targetSeconds
        ) <= SHORT_PREVIEW_LAYER_PLAYING_RESYNC_SECONDS
      );
      const audioDecision = shortPreviewVideoLayerAudioDecision({
        combinedAvCacheReady,
        decoderReady: layerState.ready,
        decoderPlaying: !layerState.video.paused && !layerState.video.ended,
        decoderSynchronized,
        // An exact legacy record is folded into this decoder as a gain/fade
        // setting above. It does not own a second playback path.
        legacyExactAudioOverride: false,
        previewMuted: previewMuted || !shortCanvasPlaybackActive,
        requestedVolume: volume
      });
      const usesWebAudioGain = ensureShortPreviewLayerAudioGraph(layerState);
      if (layerState.audioGainNode) {
        layerState.audioGainNode.gain.value = audioDecision.webAudioGain;
      }
      layerState.video.volume = usesWebAudioGain
        ? audioDecision.mediaElementVolume
        : Math.min(1, audioDecision.webAudioGain);
      layerState.video.muted = audioDecision.muted;
    }
    const state = shortPreviewSourceAudioState;
    if (state) {
      const assetGain = shortSourceAudioAsset
        ? shortFormSourceAudioAssetGainAt(
          shortSourceAudioAsset,
          targetTimelineMs / 1_000
        )
        : 0;
      const volume = Math.max(
        0,
        Math.min(1, previewVolume * regionGain * assetGain)
      );
      const audible = Boolean(
        shortSourceAudioAsset
        && state.assetId === shortSourceAudioAsset.id
        && state.synchronized
        && !state.video.paused
        && !state.error
      );
      state.video.volume = volume;
      state.video.muted = previewMuted || !audible || volume <= 0;
    }
  } else {
    video.muted = previewMuted || Boolean(
      region?.muted
      && region.fadeInMs === 0
      && region.fadeOutMs === 0
    );
    video.volume = Math.max(0, Math.min(1, previewVolume * regionGain));
  }
  elements.toggle_mute.classList.toggle("active", previewMuted);
  const sourceAssetMuted = Boolean(shortSourceAudioAsset?.muted);
  const muteTitle = (region?.muted || sourceAssetMuted) && !previewMuted
    ? "현재 음성 설정 구간이 음소거됨"
    : previewMuted
      ? "미리보기 음소거 해제"
      : "미리보기 음소거";
  elements.toggle_mute.title = editorShortcutTitle(
    "toggle-mute",
    muteTitle
  );
}

function stopPreviewAudioClock({ sync = true } = {}) {
  if (previewAudioClockTimer !== null) {
    clearTimeout(previewAudioClockTimer);
    previewAudioClockTimer = null;
  }
  if (sync && project) {
    applyPreviewAudioSettings(previewTimelineMsFromVideoClock());
  }
}

function startPreviewAudioClock() {
  if (previewAudioClockTimer !== null || elements.preview_video.paused) {
    return;
  }
  const tick = () => {
    previewAudioClockTimer = null;
    if (elements.preview_video.paused || elements.preview_video.ended || !mediaFile) {
      applyPreviewAudioSettings(previewTimelineMsFromVideoClock());
      return;
    }
    applyPreviewAudioSettings(previewTimelineMsFromVideoClock());
    previewAudioClockTimer = setTimeout(tick, PREVIEW_AUDIO_CLOCK_INTERVAL_MS);
  };
  tick();
}

function updatePlayhead() {
  const duration = projectDurationMs(project);
  project.playheadMs = Math.max(0, Math.min(duration, project.playheadMs || 0));
  elements.playhead.style.left = `${timelineX(project.playheadMs)}px`;
  elements.playhead.setAttribute("aria-valuemax", String(duration / 1000));
  elements.playhead.setAttribute("aria-valuenow", String(project.playheadMs / 1000));
  elements.playhead.setAttribute("aria-valuetext", formatTime(project.playheadMs));
  elements.current_time.textContent = formatTime(project.playheadMs);
  elements.duration_time.textContent = `/ ${formatTime(duration)}`;
  if (workspaceMode !== "short-form" || !shortCanvasPlaybackActive) {
    void renderImageAssetOverlays().catch((error) => {
      console.warn("캔버스 위 이미지를 그리지 못했습니다.", error);
    });
    renderSubtitleOverlay();
  }
  applyPreviewAudioSettings();
  if (workspaceMode === "short-form") {
    scheduleShortWorkspacePreview();
  }
}

function renderTransport() {
  if (workspaceMode === "short-form") {
    const activeVideoAssets = shortFormVideoAssetsAtTimeline(
      project.shortForm,
      project.playheadMs
    ).filter((asset) => asset.visible && asset.opacity > 0);
    const needsMedia = Boolean(
      activeVideoAssets.length > 0
      || shortPreviewSourceAudioAssetAtTimeline(project.playheadMs)
    );
    const sourceCachesReady = shortPreviewSourceCachesReadyAtTimeline(
      rootProject,
      project.shortForm,
      project.playheadMs
    );
    if (needsMedia && !sourceCachesReady && shortCanvasPlaybackActive) {
      stopShortCanvasPlayback();
    }
    elements.preview_video.style.visibility = "hidden";
    elements.previous_clip.disabled = true;
    elements.next_clip.disabled = true;
    elements.play_toggle.disabled = needsMedia && !sourceCachesReady;
    elements.play_toggle.classList.toggle(
      "playing",
      shortCanvasPlaybackActive || shortCanvasPlaybackPriming
    );
    elements.play_toggle.setAttribute(
      "aria-busy",
      String(shortCanvasPlaybackPriming)
    );
    activeClipId = SHORT_FORM_CANVAS_CLIP_ID;
    updatePlayhead();
    return;
  }
  const clip = mapTimelineToSource(project, project.playheadMs);
  const mediaBindingValid = materializedMediaBindingIsValid();
  if (!mediaBindingValid && !elements.preview_video.paused) {
    elements.preview_video.pause();
  }
  elements.preview_video.style.visibility = clip && mediaFile && mediaBindingValid
    ? ""
    : "hidden";
  const activeClipStillExists = project.clips.some((candidate) => (
    candidate.id === activeClipId && candidate.enabled !== false
  ));
  if (
    !activeClipStillExists
    || (!previewPlaybackIsActive() && !previewBoundaryTransitioning)
  ) {
    activeClipId = clip?.clipId || project.clips[0]?.id || null;
  }
  elements.previous_clip.disabled = project.clips.length === 0;
  elements.next_clip.disabled = project.clips.length === 0;
  elements.play_toggle.disabled = (
    !mediaFile
    || project.clips.length === 0
    || !mediaBindingValid
  );
  updatePlayhead();
}

function renderAll(options = {}) {
  if (!project) {
    return;
  }
  renderHeader();
  renderTimelineCollapseState();
  renderMediaCard();
  renderClipList();
  renderPropertyInspector();
  renderCueList();
  if (elements.caption_sheet_dialog.open) {
    renderCaptionPropertiesSheet();
  }
  renderTimeline(options);
  renderTransport();
  renderShortSourceComposer();
  applyPreviewAudioSettings();
}

function sourceMsToPreviewSeconds(sourceMs: number) {
  const mediaOriginMs = Number(project.mediaAsset?.mediaOriginMs) || 0;
  const materialization = projectMaterialization();
  if (!materializedMediaBindingIsValid()) {
    return Number.NaN;
  }
  let mediaMs = materialization
    ? sourceMsToMediaMs(materialization, sourceMs)
    : sourceMs;
  if (materialization && mediaMs === null) {
    const endingWindows = materialization.windows.filter((window) => (
      Math.abs(window.fetchedSourceEndMs - sourceMs) <= 0.5
    ));
    if (endingWindows.length === 1) {
      mediaMs = endingWindows[0]!.mediaEndMs;
    }
  }
  return mediaMs === null
    ? Number.NaN
    : (mediaOriginMs + mediaMs) / 1000;
}

function previewSecondsToSourceMs(previewSeconds: number) {
  const mediaOriginMs = Number(project.mediaAsset?.mediaOriginMs) || 0;
  const mediaMs = previewSeconds * 1000 - mediaOriginMs;
  const materialization = projectMaterialization();
  if (!materializedMediaBindingIsValid()) {
    return Number.NaN;
  }
  if (!materialization) {
    return mediaMs;
  }
  const sourceMs = mediaMsToSourceMs(materialization, mediaMs);
  if (sourceMs !== null) {
    return sourceMs;
  }
  const lastWindow = materialization.windows.at(-1);
  return lastWindow && Math.abs(lastWindow.mediaEndMs - mediaMs) <= 0.5
    ? lastWindow.fetchedSourceEndMs
    : Number.NaN;
}

function configurePreviewVideoLayer(
  video: HTMLVideoElement,
  { active }: { active: boolean }
) {
  video.classList.add("preview-video");
  video.classList.toggle("preview-video-active", active);
  video.classList.toggle("preview-video-standby", !active);
  if (!active) {
    video.preload = "auto";
  }
  video.style.visibility = active && mediaFile ? "" : "hidden";
  video.style.zIndex = active ? "1" : "0";
  video.style.pointerEvents = "none";
  video.setAttribute("aria-hidden", active ? "false" : "true");
  if (!active) {
    video.muted = true;
  }
}

function ensureStandbyPreviewVideo() {
  if (standbyPreviewVideo) {
    return standbyPreviewVideo;
  }
  const video = document.createElement("video");
  video.id = "preview-video-standby";
  video.preload = "auto";
  video.playsInline = true;
  configureVideoMediaSource(video, mediaFile);
  configurePreviewVideoLayer(video, { active: false });
  elements.stage.insertBefore(video, elements.stage_empty);
  standbyPreviewVideo = video;
  bindPreviewVideoEvents(video);
  return video;
}

function cancelPreviewPreload({ clearSource = false } = {}) {
  previewPreloadSequence += 1;
  preparedPreview = null;
  if (!standbyPreviewVideo) {
    return;
  }
  standbyPreviewVideo.pause();
  configurePreviewVideoLayer(standbyPreviewVideo, { active: false });
  if (clearSource) {
    standbyPreviewVideo.removeAttribute("src");
    standbyPreviewVideo.load();
  }
}

function waitForStandbyEvent(
  video: HTMLVideoElement,
  eventName: string,
  sequence: number
) {
  return new Promise<boolean>((resolve, reject) => {
    let timeout: TimerHandle | null = null;
    const cleanup = () => {
      clearTimeout(timeout ?? undefined);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve(sequence === previewPreloadSequence);
    };
    const handleError = () => {
      cleanup();
      reject(new Error("다음 컷 미리보기를 미리 읽지 못했습니다."));
    };
    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
    timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, PREVIEW_PRELOAD_TIMEOUT_MS);
  });
}

async function prepareNextClipPreview(fromClipId = activeClipId) {
  const next = nextEnabledPreviewClip(project?.clips, fromClipId);
  if (!mediaUrl || !next || !standbyPreviewVideo) {
    cancelPreviewPreload();
    return false;
  }
  const targetSeconds = sourceMsToPreviewSeconds(next.sourceStartMs);
  if (!Number.isFinite(targetSeconds)) {
    cancelPreviewPreload();
    return false;
  }
  if (
    preparedPreview
    && preparedPreview.fromClipId === fromClipId
    && preparedPreview.clipId === next.id
    && Math.abs(preparedPreview.targetSeconds - targetSeconds) <= 0.03
  ) {
    if (preparedPreview.promise) {
      return preparedPreview.promise;
    }
  }

  const video = standbyPreviewVideo;
  const sequence = ++previewPreloadSequence;
  video.pause();
  configurePreviewVideoLayer(video, { active: false });
  preparedPreview = {
    sequence,
    fromClipId,
    clipId: next.id,
    targetSeconds,
    ready: false,
    promise: null
  };

  const operation = (async () => {
    try {
      if (video.src !== mediaUrl) {
        video.src = mediaUrl;
      }
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        const loaded = await waitForStandbyEvent(video, "loadedmetadata", sequence);
        if (!loaded) {
          return false;
        }
      }
      if (sequence !== previewPreloadSequence) {
        return false;
      }
      if (Number.isFinite(video.duration) && video.duration + 0.02 < targetSeconds) {
        return false;
      }
      if (
        Math.abs(video.currentTime - targetSeconds) > 0.02
        || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        const seeked = waitForStandbyEvent(
          video,
          Math.abs(video.currentTime - targetSeconds) > 0.02 ? "seeked" : "loadeddata",
          sequence
        );
        if (Math.abs(video.currentTime - targetSeconds) > 0.02) {
          video.currentTime = targetSeconds;
        }
        if (!await seeked) {
          return false;
        }
      }
      if (
        sequence !== previewPreloadSequence
        || Math.abs(video.currentTime - targetSeconds) > 0.03
      ) {
        return false;
      }
      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        const canPlay = await waitForStandbyEvent(video, "canplay", sequence);
        if (!canPlay) {
          return false;
        }
      }
      if (
        sequence !== previewPreloadSequence
        || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        return false;
      }
      if (preparedPreview?.sequence === sequence) {
        preparedPreview.ready = true;
      }
      return true;
    } catch (error) {
      if (sequence === previewPreloadSequence) {
        console.warn("다음 컷을 미리 준비하지 못해 일반 탐색으로 전환합니다.", error);
      }
      return false;
    }
  })();
  const promise = operation.then((ready) => {
    if (!ready && preparedPreview?.sequence === sequence) {
      preparedPreview = null;
    }
    return ready;
  });
  preparedPreview.promise = promise;
  return promise;
}

function stopPreviewPlaybackClock() {
  if (previewPlaybackFrame !== null) {
    cancelAnimationFrame(previewPlaybackFrame);
    previewPlaybackFrame = null;
  }
}

function startPreviewPlaybackClock() {
  if (previewPlaybackFrame !== null || elements.preview_video.paused) {
    return;
  }
  const tick = () => {
    previewPlaybackFrame = null;
    if (elements.preview_video.paused || elements.preview_video.ended || !mediaFile) {
      return;
    }
    if (!pendingPreviewSeek && !previewBoundaryTransitioning) {
      const clip = project.clips.find((candidate) => candidate.id === activeClipId);
      const sourceMs = previewSecondsToSourceMs(elements.preview_video.currentTime);
      if (clip && previewReachedClipBoundary(sourceMs, clip.sourceEndMs)) {
        handleVideoTimeUpdate();
      }
    }
    if (!elements.preview_video.paused && !elements.preview_video.ended) {
      previewPlaybackFrame = requestAnimationFrame(tick);
    }
  };
  previewPlaybackFrame = requestAnimationFrame(tick);
}

function transitionToPreparedPreview(next: PreviewClip) {
  const nextVideo = standbyPreviewVideo;
  const previousVideo = elements.preview_video;
  const targetSeconds = sourceMsToPreviewSeconds(next.sourceStartMs);
  if (
    !Number.isFinite(targetSeconds)
    || previewBoundaryTransitioning
    || !nextVideo
    || !preparedPreviewMatches(preparedPreview, next, targetSeconds)
  ) {
    return false;
  }

  previewBoundaryTransitioning = true;
  previewPreloadSequence += 1;
  preparedPreview = null;
  previousVideo.muted = true;
  configurePreviewVideoLayer(nextVideo, { active: true });
  configurePreviewVideoLayer(previousVideo, { active: false });
  previousVideo.id = "preview-video-standby";
  nextVideo.id = "preview-video";
  elements.preview_video = nextVideo;
  standbyPreviewVideo = previousVideo;
  activeClipId = next.id;
  project.selectedClipId = next.id;
  project.playheadMs = next.timelineStartMs;
  updatePlayhead();
  applyPreviewAudioSettings(next.timelineStartMs);

  const playback = nextVideo.play();
  previousVideo.pause();
  void playback
    .then(() => {
      void prepareNextClipPreview(next.id);
    })
    .catch((error) => {
      nextVideo.pause();
      elements.play_toggle.classList.remove("playing");
      stopPreviewPlaybackClock();
      stopPreviewAudioClock();
      console.warn("미리 준비한 다음 컷을 재생하지 못했습니다.", error);
    })
    .finally(() => {
      previewBoundaryTransitioning = false;
    });
  return true;
}

async function seekPreviewToSourceMs(sourceMs: number) {
  const video = elements.preview_video;
  const targetSeconds = sourceMsToPreviewSeconds(sourceMs);
  if (!Number.isFinite(targetSeconds)) {
    return false;
  }
  const sequence = ++previewSeekSequence;
  if (Math.abs(video.currentTime - targetSeconds) <= 0.02) {
    pendingPreviewSeek = null;
    return true;
  }

  pendingPreviewSeek = { sequence, sourceMs, targetSeconds };
  return new Promise<boolean>((resolve) => {
    let retries = 0;
    let retryTimer: TimerHandle | null = null;
    let settleTimer: TimerHandle | null = null;

    const cleanup = (matched: boolean) => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("durationchange", retryWhenAvailable);
      clearTimeout(retryTimer ?? undefined);
      clearTimeout(settleTimer ?? undefined);
      if (pendingPreviewSeek?.sequence === sequence) {
        pendingPreviewSeek = null;
      }
      resolve(matched);
    };

    const assignTarget = () => {
      if (sequence !== previewSeekSequence) {
        cleanup(false);
        return;
      }
      video.currentTime = targetSeconds;
    };

    const retryWhenAvailable = () => {
      if (sequence !== previewSeekSequence) {
        cleanup(false);
        return;
      }
      if (Number.isFinite(video.duration) && video.duration + 0.02 < targetSeconds) {
        return;
      }
      video.removeEventListener("durationchange", retryWhenAvailable);
      clearTimeout(retryTimer ?? undefined);
      requestAnimationFrame(assignTarget);
    };

    const scheduleRetry = () => {
      retries += 1;
      video.addEventListener("durationchange", retryWhenAvailable);
      retryTimer = setTimeout(() => {
        video.removeEventListener("durationchange", retryWhenAvailable);
        assignTarget();
      }, 350);
      retryWhenAvailable();
    };

    const handleSeeked = () => {
      if (sequence !== previewSeekSequence) {
        cleanup(false);
        return;
      }
      if (Math.abs(video.currentTime - targetSeconds) <= 0.03) {
        cleanup(true);
        return;
      }
      if (retries < 1) {
        scheduleRetry();
        return;
      }
      cleanup(false);
    };

    video.addEventListener("seeked", handleSeeked);
    settleTimer = setTimeout(() => {
      if (retries < 1) {
        scheduleRetry();
        settleTimer = setTimeout(() => cleanup(
          Math.abs(video.currentTime - targetSeconds) <= 0.03
        ), 1500);
        return;
      }
      cleanup(Math.abs(video.currentTime - targetSeconds) <= 0.03);
    }, 1500);
    assignTarget();
  });
}

async function seekTimeline(timelineMs: number, { play = false } = {}) {
  if (workspaceMode === "short-form") {
    stopShortCanvasPlayback({ keepCurrentTime: false });
    project.playheadMs = Math.max(
      0,
      Math.min(project.shortForm.durationMs, Number(timelineMs) || 0)
    );
    activeClipId = SHORT_FORM_CANVAS_CLIP_ID;
    project.selectedClipId = SHORT_FORM_CANVAS_CLIP_ID;
    updatePlayhead();
    scheduleShortWorkspacePreview();
    if (play) {
      await startShortCanvasPlayback();
    } else {
      syncShortPreviewSourceAudioAtTimeline(project.playheadMs, {
        play: false,
        forceSeek: true
      });
    }
    return;
  }
  const mapping = mapTimelineToSource(project, timelineMs);
  if (!mapping) {
    return;
  }
  cancelPreviewPreload();
  project.playheadMs = mapping.timelineMs;
  activeClipId = mapping.clipId;
  project.selectedClipId = mapping.clipId;
  updatePlayhead();
  if (mediaFile) {
    const expectedVideo = elements.preview_video;
    const expectedMediaUrl = mediaUrl;
    const seekOperation = seekPreviewToSourceMs(mapping.sourceMs);
    const expectedSeekSequence = previewSeekSequence;
    const matched = await seekOperation;
    const seekWasSuperseded = (
      previewSeekSequence !== expectedSeekSequence
      || elements.preview_video !== expectedVideo
      || mediaUrl !== expectedMediaUrl
    );
    if (seekWasSuperseded) {
      return;
    }
    if (!matched) {
      console.warn("미리보기 플레이어가 요청 시각과 정확히 맞지 않았습니다.");
      expectedVideo.pause();
      expectedVideo.style.visibility = "hidden";
      return;
    }
    if (play) {
      await expectedVideo.play();
      if (
        previewSeekSequence !== expectedSeekSequence
        || elements.preview_video !== expectedVideo
        || mediaUrl !== expectedMediaUrl
      ) {
        return;
      }
    }
    void prepareNextClipPreview(mapping.clipId);
  }
  updatePlayhead();
}

async function syncPreviewToPlayhead() {
  if (workspaceMode === "short-form") {
    await seekTimeline(project.playheadMs ?? 0, {
      play: shortCanvasPlaybackActive
    });
    return;
  }
  if (!mediaFile) {
    return;
  }
  const wasPlaying = !elements.preview_video.paused;
  try {
    await seekTimeline(project.playheadMs ?? 0, { play: wasPlaying });
  } catch (error: unknown) {
    if (errorName(error) !== "AbortError") {
      console.warn("미리보기 시각을 다시 맞추지 못했습니다.", error);
    }
  }
}

async function togglePlayback() {
  if (workspaceMode === "short-form") {
    const activeVideoAssets = shortFormVideoAssetsAtTimeline(
      project.shortForm,
      project.playheadMs
    ).filter((asset) => asset.visible && asset.opacity > 0);
    const needsMedia = Boolean(
      activeVideoAssets.length > 0
      || shortPreviewSourceAudioAssetAtTimeline(project.playheadMs)
    );
    if (
      needsMedia
      && !shortPreviewSourceCachesReadyAtTimeline(
        rootProject,
        project.shortForm,
        project.playheadMs
      )
    ) {
      stopShortCanvasPlayback();
      showToast(
        "현재 쇼츠 구성과 정확히 일치하는 미리보기 영상이 없습니다. 미리보기를 다시 만들어 주세요.",
        "error"
      );
      return;
    }
    if (shortCanvasPlaybackActive || shortCanvasPlaybackPriming) {
      stopShortCanvasPlayback();
    } else {
      // This runs inside the user's click/keyboard activation, before async
      // priming, so Chromium is allowed to start the per-video Web Audio gain
      // graph used for the 0–200% block volume control.
      resumeShortPreviewAudioContext();
      await startShortCanvasPlayback();
    }
    return;
  }
  if (!mediaFile) {
    showToast(
      chzzkVodSourceUrl()
        ? `먼저 ${projectSourcePlatformLabel()} 편집 영상을 준비해 주세요.`
        : "먼저 내 영상 파일을 직접 연결해 주세요.",
      "error"
    );
    return;
  }
  if (!materializedMediaBindingIsValid()) {
    elements.preview_video.pause();
    showToast(`현재 컷과 맞는 ${projectSourcePlatformLabel()} VOD 선택 구간을 다시 준비해 주세요.`, "error");
    return;
  }
  if (elements.preview_video.paused) {
    await seekTimeline(project.playheadMs ?? 0, { play: true });
  } else {
    elements.preview_video.pause();
  }
}

function adjacentClip(direction: number) {
  const enabled = project.clips.filter((clip) => clip.enabled !== false);
  const index = enabled.findIndex((clip) => clip.id === activeClipId);
  const target = enabled[Math.max(0, Math.min(enabled.length - 1, index + direction))];
  if (target) {
    project.selectedClipId = target.id;
    void seekTimeline(target.timelineStartMs);
    renderAll({ keepScroll: true });
  }
}

function handleVideoTimeUpdate(event?: Event) {
  const video = (
    event?.currentTarget as HTMLVideoElement | null
  ) || elements.preview_video;
  if (workspaceMode === "short-form") {
    return;
  }
  if (
    video !== elements.preview_video
    || pendingPreviewSeek
    || previewBoundaryTransitioning
  ) {
    return;
  }
  const clip = project.clips.find((candidate) => candidate.id === activeClipId);
  if (!clip) {
    return;
  }
  const sourceMs = previewSecondsToSourceMs(video.currentTime);
  if (!Number.isFinite(sourceMs)) {
    video.pause();
    video.style.visibility = "hidden";
    return;
  }
  if (previewReachedClipBoundary(sourceMs, clip.sourceEndMs)) {
    const next = nextEnabledPreviewClip(project.clips, clip.id);
    if (next && !video.paused) {
      if (transitionToPreparedPreview(next)) {
        return;
      }
      previewBoundaryTransitioning = true;
      cancelPreviewPreload();
      activeClipId = next.id;
      project.selectedClipId = next.id;
      project.playheadMs = next.timelineStartMs;
      updatePlayhead();
      void seekPreviewToSourceMs(next.sourceStartMs)
        .then((matched) => {
          if (!matched) {
            throw new Error("다음 컷의 로컬 미디어 시각을 찾지 못했습니다.");
          }
          return elements.preview_video.play();
        })
        .then(() => {
          void prepareNextClipPreview(next.id);
        })
        .catch((error) => console.warn("다음 컷 미리보기를 시작하지 못했습니다.", error))
        .finally(() => {
          previewBoundaryTransitioning = false;
        });
      return;
    }
    project.playheadMs = clip.timelineStartMs + clipDurationMs(clip);
    video.pause();
    updatePlayhead();
    return;
  }
  project.playheadMs = Math.max(
    clip.timelineStartMs,
    Math.min(clip.timelineStartMs + clipDurationMs(clip), clip.timelineStartMs + sourceMs - clip.sourceStartMs)
  );
  updatePlayhead();
}

function bindPreviewVideoEvents(video: HTMLVideoElement) {
  video.addEventListener("timeupdate", handleVideoTimeUpdate);
  video.addEventListener("play", (event: Event) => {
    if (event.currentTarget !== elements.preview_video) {
      return;
    }
    if (workspaceMode === "short-form") {
      return;
    }
    elements.play_toggle.classList.add("playing");
    startPreviewAudioClock();
    startPreviewPlaybackClock();
    void prepareNextClipPreview(activeClipId);
  });
  video.addEventListener("pause", (event: Event) => {
    if (event.currentTarget !== elements.preview_video) {
      return;
    }
    if (workspaceMode === "short-form") {
      scheduleShortWorkspacePreview();
      return;
    }
    elements.play_toggle.classList.remove("playing");
    stopPreviewPlaybackClock();
    stopPreviewAudioClock();
    pauseShortPreviewLayerVideos();
    scheduleShortWorkspacePreview();
  });
  video.addEventListener("loadedmetadata", (event: Event) => {
    if (event.currentTarget !== elements.preview_video) {
      return;
    }
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
  });
}

function selectCue(cueId: string, { seek = false } = {}) {
  const cue = project.subtitles.find((candidate) => candidate.id === cueId);
  if (!cue) {
    return;
  }
  const previewWasPlaying = previewPlaybackIsActive();
  project = {
    ...project,
    selectedCueId: cue.id,
    selectedClipId: cue.clipId
  };
  inspectorMode = "selected";
  propertyInspectorMode = "caption";
  const range = cueTimelineRange(project, cue);
  if (seek && range) {
    void seekTimeline(range.startMs, {
      play: previewWasPlaying
    });
  }
  renderAll({ keepScroll: true });
  revealSelectedPropertyEditor();
  document.querySelector<HTMLButtonElement>(
    `.cue-block[data-id="${CSS.escape(cue.id)}"] .cue-block-body`
  )?.focus({ preventScroll: true });
  scheduleSave();
}

function cueHasOverlap(candidateProject: EditorProject, cueId: string) {
  return findSubtitleOverlaps(candidateProject).some((overlap) => (
    overlap.firstCueId === cueId || overlap.secondCueId === cueId
  ));
}

function selectAudioRegion(
  regionId: string,
  {
    seek = false,
    focusTimeline = false
  }: { seek?: boolean; focusTimeline?: boolean } = {}
) {
  const region = project.audioRegions.find((candidate) => candidate.id === regionId);
  if (!region) {
    return;
  }
  const seekSelection = seek && shouldSeekTimelineItemSelection();
  project = {
    ...project,
    selectedAudioRegionId: region.id,
    selectedClipId: region.clipId
  };
  propertyInspectorMode = "audio";
  const range = audioRegionTimelineRange(project, region);
  if (seekSelection && range) {
    void seekTimeline(range.startMs);
  }
  renderAll({ keepScroll: true });
  revealSelectedPropertyEditor();
  if (focusTimeline) {
    document.querySelector<HTMLButtonElement>(
      `.audio-block[data-id="${CSS.escape(region.id)}"] .audio-block-body`
    )?.focus({ preventScroll: true });
  }
  scheduleSave();
}

function selectImageAsset(assetId: string, { seek = false } = {}) {
  const asset = (project.imageAssets || []).find((candidate) => candidate.id === assetId);
  if (!asset) {
    return;
  }
  const seekSelection = seek && shouldSeekTimelineItemSelection();
  project = {
    ...project,
    selectedImageAssetId: asset.id,
    selectedClipId: asset.clipId
  };
  propertyInspectorMode = "asset";
  const range = imageAssetTimelineRange(project, asset);
  if (seekSelection && range) {
    void seekTimeline(range.startMs);
  }
  renderAll({ keepScroll: true });
  revealSelectedPropertyEditor();
  scheduleSave();
}

async function inspectImageAssetBlob(blob: Blob) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("클립보드나 파일에 이미지 데이터가 없습니다.");
  }
  if (!ALLOWED_IMAGE_ASSET_TYPES.has(blob.type)) {
    throw new Error("PNG, JPEG, WebP 또는 GIF 이미지만 사용할 수 있습니다. SVG는 안전을 위해 제외합니다.");
  }
  if (blob.size > MAX_IMAGE_ASSET_BYTES) {
    throw new Error(`이미지 한 장은 ${formatFileSize(MAX_IMAGE_ASSET_BYTES)} 이하여야 합니다.`);
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    if (
      width <= 0 ||
      height <= 0 ||
      width > MAX_IMAGE_ASSET_DIMENSION ||
      height > MAX_IMAGE_ASSET_DIMENSION ||
      width * height > MAX_IMAGE_ASSET_PIXELS
    ) {
      throw new Error(
        `이미지가 너무 큽니다. 최대 ${MAX_IMAGE_ASSET_DIMENSION}px, ${Math.round(MAX_IMAGE_ASSET_PIXELS / 1_000_000)}메가픽셀까지 사용할 수 있습니다.`
      );
    }
    return { width, height };
  } catch (error) {
    if (error instanceof Error && error.message.includes("이미지가 너무 큽니다")) {
      throw error;
    }
    throw new Error("손상되었거나 브라우저가 읽을 수 없는 이미지입니다.");
  } finally {
    bitmap?.close();
  }
}

function pastedImageName(mimeType: string | undefined) {
  const extension = ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  } as Record<string, string>)[String(mimeType)] || "image";
  return `붙여넣은 이미지.${extension}`;
}

async function addImageAssetFromBlob(blob: Blob, {
  timelineMs = project.playheadMs,
  name = pastedImageName(blob?.type)
} = {}) {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return null;
  }
  if (projectMutationLockCount > 0) {
    showToast("다른 미디어 작업이 끝난 뒤 이미지를 추가해 주세요.", "error");
    return null;
  }
  lockProjectMutations();
  try {
    const mapping = mapTimelineToSource(project, timelineMs);
  if (!mapping) {
    showToast("이미지를 추가할 영상 구간이 없습니다.", "error");
    return null;
  }
  let dimensions;
  try {
    dimensions = await inspectImageAssetBlob(blob);
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return null;
  }
  const clip = project.clips.find((candidate) => candidate.id === mapping.clipId);
  const startOffsetMs = Number(mapping.clipOffsetMs);
  const endOffsetMs = Math.min(clipDurationMs(clip), startOffsetMs + 2_000);
  if (endOffsetMs - startOffsetMs < 100) {
    showToast("컷 끝에서 최소 0.1초 앞쪽에 이미지를 추가해 주세요.", "error");
    return null;
  }
  const id = `asset-${crypto.randomUUID()}`;
  const asset = createImageAsset(project, {
    id,
    clipId: clip!.id,
    startOffsetMs,
    endOffsetMs,
    name: String(name || pastedImageName(blob.type)).slice(0, 160),
    mimeType: blob.type,
    source: { kind: "blob-key", value: id },
    naturalWidth: dimensions.width,
    naturalHeight: dimensions.height
  });
  const nextProject = {
    ...project,
    imageAssets: [...(project.imageAssets || []), asset],
    selectedImageAssetId: asset.id,
    selectedClipId: clip!.id
  };
  try {
    requireActiveUsagePolicySession();
    await queueCurrentProjectSessionWrite(() => saveProjectWithImageAssetBlob(
      persistedProjectSnapshotForWorkspaceCandidate(nextProject),
      asset.id,
      blob
    ));
  } catch (error: unknown) {
    showToast(`이미지를 저장하지 못했습니다: ${errorMessage(error)}`, "error", 0);
    return null;
  }
  propertyInspectorMode = "asset";
  applyProject(nextProject, { save: false });
  revealSelectedPropertyEditor();
  await seekTimeline(Number(mapping.timelineMs));
  showToast(
    `${asset.name}을 이미지 트랙에 추가했습니다.${blob.type === "image/png" || blob.type === "image/webp" ? " 투명 배경도 유지됩니다." : ""}`,
    "success"
  );
    return asset;
  } finally {
    unlockProjectMutations();
  }
}

function imageBlobFromPasteEvent(event: ClipboardEvent) {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => (
    item.kind === "file" && ALLOWED_IMAGE_ASSET_TYPES.has(item.type)
  ));
  return imageItem?.getAsFile() || null;
}

async function pasteImageFromSystemClipboard(timelineMs = project.playheadMs) {
  if (!navigator.clipboard?.read) {
    elements.stage.focus({ preventScroll: true });
    showToast("편집기에서 Ctrl/Cmd+V를 눌러 이미지를 붙여넣어 주세요.");
    return false;
  }
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const type = item.types.find((candidate) => ALLOWED_IMAGE_ASSET_TYPES.has(candidate));
      if (type) {
        const blob = await item.getType(type);
        return Boolean(await addImageAssetFromBlob(blob, { timelineMs }));
      }
    }
    showToast("클립보드에 PNG, JPEG, WebP 또는 GIF 이미지가 없습니다.", "error");
    return false;
  } catch (error: unknown) {
    const denied = errorName(error) === "NotAllowedError";
    elements.stage.focus({ preventScroll: true });
    showToast(
      denied
        ? "클립보드 읽기가 차단됐습니다. 웹에서 ‘이미지 복사’ 후 편집기에서 Ctrl/Cmd+V를 눌러 주세요."
        : `클립보드 이미지를 읽지 못했습니다: ${errorMessage(error)}`,
      denied ? "info" : "error"
    );
    return false;
  }
}

function openImageAssetFilePicker(timelineMs = project.playheadMs) {
  pendingAssetTimelineMs = timelineMs ?? 0;
  elements.asset_input.click();
}

function addCueAtPlayhead({
  timelineMs = project.playheadMs,
  lane: requestedLane = null
}: {
  timelineMs?: number;
  lane?: number | null;
} = {}) {
  const mapping = mapTimelineToSource(project, timelineMs);
  if (!mapping) {
    showToast("자막을 추가할 영상 구간이 없습니다.", "error");
    return;
  }
  let workingProject = project;
  const occupiedLanes = new Set(cuesAtTimeline(workingProject, mapping.timelineMs).map((cue) => cue.lane));
  let lane = Number.isInteger(requestedLane) &&
    requestedLane! >= 0 &&
    requestedLane! < workingProject.subtitleLaneCount &&
    !occupiedLanes.has(requestedLane!)
    ? requestedLane
    : Array.from(
      { length: workingProject.subtitleLaneCount },
      (_, index) => index
    ).find((candidate) => !occupiedLanes.has(candidate));
  if (lane === undefined && workingProject.subtitleLaneCount < MAX_SUBTITLE_LANES) {
    workingProject = addSubtitleLane(workingProject);
    lane = workingProject.subtitleLaneCount - 1;
  }
  if (lane === undefined) {
    showToast(`현재 시각의 ${MAX_SUBTITLE_LANES}개 자막 레인이 모두 사용 중입니다.`, "error");
    return;
  }
  const clip = workingProject.clips.find((candidate) => candidate.id === mapping.clipId);
  const startOffsetMs = Number(mapping.clipOffsetMs);
  const nextCueStartMs = workingProject.subtitles
    .filter((cue) => (
      cue.clipId === clip!.id &&
      cue.lane === lane &&
      cue.startOffsetMs > startOffsetMs
    ))
    .map((cue) => cue.startOffsetMs)
    .sort((a, b) => a - b)[0] ?? clipDurationMs(clip);
  const endOffsetMs = Math.min(
    clipDurationMs(clip),
    startOffsetMs + 2_000,
    nextCueStartMs
  );
  if (endOffsetMs - startOffsetMs < 100) {
    showToast("이 레인의 다음 자막과 간격이 너무 짧습니다.", "error");
    return;
  }
  const cue = createSubtitleCue(workingProject, {
    clipId: clip!.id,
    startOffsetMs,
    endOffsetMs,
    text: "새 자막",
    lane,
    x: 0.5,
    y: 0.84,
    origin: "human"
  });
  propertyInspectorMode = "caption";
  inspectorMode = "selected";
  applyProject({
    ...workingProject,
    subtitles: [...workingProject.subtitles, cue],
    selectedCueId: cue.id,
    selectedClipId: clip!.id
  });
  revealSelectedPropertyEditor();
  elements.cue_text.focus({ preventScroll: true });
  elements.cue_text.select();
}

function addAudioRegionAtTimeline(timelineMs = project.playheadMs) {
  const mapping = mapTimelineToSource(project, timelineMs);
  if (!mapping) {
    showToast("음성을 조절할 영상 구간이 없습니다.", "error");
    return;
  }
  const activeRegion = audioRegionAtTimeline(project, mapping.timelineMs);
  if (activeRegion) {
    selectAudioRegion(activeRegion.id);
    showToast("현재 시각의 음성 설정 구간을 선택했습니다.");
    return;
  }
  const clip = project.clips.find((candidate) => candidate.id === mapping.clipId);
  const startOffsetMs = Number(mapping.clipOffsetMs);
  const nextRegionStartMs = project.audioRegions
    .filter((region) => region.clipId === clip!.id && region.startOffsetMs > startOffsetMs)
    .map((region) => region.startOffsetMs)
    .sort((a, b) => a - b)[0] ?? clipDurationMs(clip);
  const endOffsetMs = Math.min(clipDurationMs(clip), startOffsetMs + 2_000, nextRegionStartMs);
  if (endOffsetMs - startOffsetMs < 100) {
    showToast("다음 음성 설정 구간과 간격이 너무 짧습니다.", "error");
    return;
  }
  const region = createAudioRegion(project, {
    clipId: clip!.id,
    startOffsetMs,
    endOffsetMs
  });
  propertyInspectorMode = "audio";
  applyProject({
    ...project,
    audioRegions: [...project.audioRegions, region],
    selectedAudioRegionId: region.id,
    selectedClipId: clip!.id
  });
  revealSelectedPropertyEditor();
}

function updateSelectedCue(
  patch: Partial<EditorSubtitleCue>,
  options?: { markHuman?: boolean }
) {
  const cue = selectedCue();
  if (!cue) {
    return;
  }
  const next = updateSubtitleCue(project, cue.id, patch, options);
  if (cueHasOverlap(next, cue.id)) {
    showToast("같은 자막 레인 안에서는 자막이 겹칠 수 없습니다.", "error");
    renderCueInspector();
    return;
  }
  applyProject(next);
}

function updateSelectedAudioRegion(patch: Partial<EditorAudioRegion>) {
  const region = selectedAudioRegion();
  if (!region) {
    return false;
  }
  const next = updateAudioRegion(project, region.id, patch);
  if (audioRegionHasOverlap(next, region.id)) {
    showToast("음성 설정 구간끼리는 겹칠 수 없습니다.", "error");
    renderAudioInspector();
    return false;
  }
  applyProject(next);
  applyPreviewAudioSettings();
  return true;
}

function updateSelectedImageAsset(
  patch: Partial<EditorImageAsset>,
  { fieldKey = null }: { fieldKey?: string | null } = {}
) {
  const asset = selectedImageAsset();
  if (!asset) {
    return false;
  }
  const next = updateImageAsset(project, asset.id, patch);
  if (fieldKey) {
    applyFieldProject(next, fieldKey);
  } else {
    applyProject(next);
  }
  return true;
}

function deleteSelectedImageAsset(assetId = selectedImageAsset()?.id) {
  if (!assetId) {
    return;
  }
  const asset = project.imageAssets.find((candidate) => candidate.id === assetId);
  if (!asset) {
    return;
  }
  applyProject(deleteImageAsset(project, asset.id));
  releaseImageAssetObjectUrl(asset.id);
  showToast("이미지를 삭제했습니다. 실행 취소로 되돌릴 수 있습니다.");
}

async function chooseMediaFile() {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  if (projectMutationLockCount > 0) {
    showToast("다른 미디어 작업이 끝난 뒤 다시 시도해 주세요.", "error");
    return;
  }
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: "chzzk-kirinuki-source",
        multiple: false,
        types: [{
          description: "영상 파일",
          accept: {
            "video/*": [".mp4", ".mkv", ".webm", ".mov", ".m4v", ".ts"],
            "audio/*": [".m4a", ".mp3", ".wav", ".flac", ".ogg"]
          }
        }]
      });
      if (!handle) {
        showToast("선택한 원본 파일을 불러오지 못했습니다.", "error");
        return;
      }
      const file = await handle.getFile();
      const attached = await attachMediaFile(file);
      if (attached) {
        const handleSaved = await saveMediaHandle(project.id, handle);
        if (handleSaved) {
          const persistedProject = {
            ...project,
            mediaAsset: {
              ...project.mediaAsset,
              fileHandleStored: true
            },
            updatedAt: new Date().toISOString()
          } as EditorProject;
          try {
            project = persistedProject;
            await saveActiveWorkspaceImmediately();
            mediaHandle = handle;
          } catch (error: unknown) {
            mediaHandle = null;
            await deleteMediaHandle(project.id);
            showToast(
              `원본은 현재 탭에 연결했지만 재시작용 파일 권한을 저장하지 못했습니다: ${errorMessage(error)}`,
              "error",
              0
            );
          }
        } else {
          mediaHandle = null;
          await deleteMediaHandle(project.id);
          showToast(
            "원본은 현재 탭에 연결했지만 파일 권한을 저장하지 못했습니다. 편집기를 다시 열면 원본을 다시 선택해 주세요.",
            "error",
            0
          );
        }
      }
    } catch (error: unknown) {
      if (errorName(error) !== "AbortError") {
        showToast(`원본 파일을 열지 못했습니다: ${errorMessage(error)}`, "error", 0);
      }
    }
    return;
  }
  elements.media_input.click();
}

function configureVideoMediaSource(
  video: HTMLVideoElement,
  source: EditorMediaSource | null
) {
  if (source && isMaterializedLoopbackMediaSource(source)) {
    video.crossOrigin = "anonymous";
  } else {
    video.removeAttribute("crossorigin");
  }
}

function releaseMediaUrl(source: EditorMediaSource | null, url: string | null) {
  if (source && url && !isMaterializedLoopbackMediaSource(source)) {
    URL.revokeObjectURL(url);
  }
}

async function attachMediaFile(file: File, { fileHandleStored = false } = {}) {
  return attachMediaSource(file, { fileHandleStored });
}

async function sampledMediaFileSha256(file: File): Promise<string> {
  const chunkSize = Math.min(1024 * 1024, file.size);
  const offsets = [...new Set([
    0,
    Math.max(0, Math.floor((file.size - chunkSize) / 2)),
    Math.max(0, file.size - chunkSize)
  ])];
  const header = new TextEncoder().encode(
    `kirinuki-file-sample/v1\n${file.size}\n${offsets.join(",")}\n`
  );
  const sampledBytes = await new Blob([
    header,
    ...offsets.flatMap((offset) => [
      new TextEncoder().encode(`\n@${offset}\n`),
      file.slice(offset, offset + chunkSize)
    ])
  ]).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", sampledBytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameMaterializedSourceVersion(
  previousAsset: EditorProject["mediaAsset"],
  nextMaterialization: ChzzkVodMaterialization | null
): boolean {
  const previousMaterialization = normalizeChzzkVodMaterialization(
    previousAsset?.materialization
  );
  const previousVersion = String(
    previousMaterialization?.source.sourceVersionId || ""
  ).trim();
  const nextVersion = String(
    nextMaterialization?.source.sourceVersionId || ""
  ).trim();
  return Boolean(
    previousMaterialization
    && nextMaterialization
    && previousMaterialization.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
    && nextMaterialization.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
    && previousVersion
    && previousVersion === nextVersion
    && previousMaterialization.source.platform
      === nextMaterialization.source.platform
    && previousMaterialization.source.contentType
      === nextMaterialization.source.contentType
    && previousMaterialization.source.contentId
      === nextMaterialization.source.contentId
  );
}

function clearCaptionCheckpointsAcrossWorkspaces(
  candidateProject: EditorProject
): EditorProject {
  const shortFormAi = candidateProject.shortForm?.ai;
  return {
    ...candidateProject,
    ai: {
      ...candidateProject.ai,
      captionCheckpoints: []
    },
    shortForm: {
      ...candidateProject.shortForm,
      ...(shortFormAi
        ? {
          ai: {
            ...shortFormAi,
            captionCheckpoints: []
          }
        }
        : {})
    }
  };
}

async function loadPreviewMediaUrl(
  source: EditorMediaSource,
  url: string
): Promise<void> {
  // Auxiliary decoders are bound to the previous URL and source-clock map.
  // Tear them down before switching the master, including rollback switches.
  releaseShortPreviewLayerVideos();
  releaseShortPreviewSourceAudio();
  configureVideoMediaSource(elements.preview_video, source);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      elements.preview_video.removeEventListener("loadedmetadata", onLoaded);
      elements.preview_video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Chrome 영상 플레이어가 파일을 열지 못했습니다."));
    };
    elements.preview_video.addEventListener("loadedmetadata", onLoaded);
    elements.preview_video.addEventListener("error", onError);
    elements.preview_video.src = url;
  });
}

async function attachMediaSource(
  source: EditorMediaSource,
  {
    fileHandleStored = false,
    materialization,
    rightsConfirmation,
    baseProject,
    baseRootProject
  }: {
    fileHandleStored?: boolean;
    materialization?: unknown;
    rightsConfirmation?: {
      scope: "owned-or-authorized-public-vod";
      contentId: string;
      confirmedAt: string;
    };
    baseProject?: EditorProject;
    baseRootProject?: EditorProject;
  } = {}
) {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return false;
  }
  const materializedSource = isMaterializedLoopbackMediaSource(source);
  const materializedBinding = materialization !== undefined;
  assertEditorMediaSourceMode(
    source,
    materializedBinding ? "chzzk-vod-selection" : "manual-file"
  );
  if (materializedSource && (!rightsConfirmation || fileHandleStored)) {
    throw new TypeError(
      "loopback VOD 편집 영상에는 현재 원본의 권리 확인이 필요하며 수동 파일 핸들을 붙일 수 없습니다."
    );
  }
  if (!materializedSource && rightsConfirmation !== undefined) {
    throw new TypeError(
      "직접 연결한 파일에는 자동 준비된 VOD의 권리 확인 정보를 붙일 수 없습니다."
    );
  }
  lockProjectMutations();
  showJob(
    materializedSource ? "로컬 편집 영상을 확인하고 있어요" : "내 영상 파일을 확인하고 있어요",
    materializedSource
      ? "준비된 편집 영상의 파일 정보와 영상·음성 트랙을 확인합니다."
      : "파일 정보와 영상·음성 트랙을 확인합니다.",
    0.08,
    { cancelable: false }
  );
  const previousMediaSource = mediaFile;
  const previousMediaUrl = mediaUrl;
  const previousProjectSnapshot = cloneProject(project);
  const previousRootProjectSnapshot = cloneProject(rootProject);
  const previousPlayheadMs = (
    workspaceMode === "short-form" && shortCanvasPlaybackActive
      ? shortCanvasTimelineMsFromClock()
      : project.playheadMs
  ) || 0;
  const previousWasPlaying = previewPlaybackIsActive();
  const sourceProject = baseProject || project;
  const sourceRootProject = baseRootProject || rootProject;
  let nextMediaUrl: string | null = null;
  let switchedPreview = false;
  let committed = false;
  try {
    await cancelAndWaitForShortPreviewCacheOperation();
    const inspectedAsset = await inspectMediaFile(source);
    const contentSampleSha256 = source instanceof File
      ? await sampledMediaFileSha256(source)
      : "";
    const asset = contentSampleSha256
      ? {
        ...inspectedAsset,
        contentSampleSha256
      }
      : inspectedAsset;
    if (!asset.hasVideo) {
      throw new Error("영상 트랙이 없는 파일입니다.");
    }
    nextMediaUrl = isMaterializedLoopbackMediaSource(source)
      ? source.url
      : URL.createObjectURL(source);
    const normalizedMaterialization = materialization === undefined
      ? null
      : normalizeChzzkVodMaterialization(materialization);
    if (materialization !== undefined && !normalizedMaterialization) {
      throw new Error("VOD 로컬 미디어의 시간 매핑이 올바르지 않습니다.");
    }
    if (
      normalizedMaterialization
      && (
        rightsConfirmation?.scope !== "owned-or-authorized-public-vod"
        || rightsConfirmation.contentId
          !== normalizedMaterialization.source.contentId
        || !Number.isFinite(Date.parse(rightsConfirmation.confirmedAt))
      )
    ) {
      throw new Error("현재 VOD에 대한 편집 권리 확인 정보가 없습니다.");
    }
    if (
      normalizedMaterialization
      && !materializedMediaTimelineMatches(normalizedMaterialization, asset)
    ) {
      throw new Error("VOD 로컬 미디어의 실제 재생 시간과 시간 매핑이 다릅니다.");
    }
    const mediaIdentityChanged = normalizedMaterialization
      ? !sameMaterializedSourceVersion(
        sourceProject.mediaAsset,
        normalizedMaterialization
      )
      : (
        !sameCaptionMediaIdentity(sourceProject.mediaAsset, asset)
        || String(sourceProject.mediaAsset?.contentSampleSha256 || "")
          !== contentSampleSha256
      );
    const identitySafeSourceProject = mediaIdentityChanged
      ? clearCaptionCheckpointsAcrossWorkspaces(sourceProject)
      : sourceProject;
    const identitySafeRootProject = mediaIdentityChanged
      ? clearCaptionCheckpointsAcrossWorkspaces(sourceRootProject)
      : sourceRootProject;
    const nextProject = {
      ...identitySafeSourceProject,
      mediaAsset: {
        ...asset,
        fileHandleStored,
        ...(materialization === undefined
          ? {}
          : {
            mediaMode: "source-vod-selection",
            materialization: normalizedMaterialization,
            rightsConfirmation
          })
      },
      updatedAt: new Date().toISOString()
    } as EditorProject;
    requireActiveUsagePolicySession();
    await waitForProjectSaves();
    discardPendingProjectSave();
    cancelPreviewPreload({ clearSource: true });
    if (workspaceMode === "short-form") {
      stopShortCanvasPlayback({ keepCurrentTime: false });
    }
    releaseShortPreviewLayerVideos();
    releaseShortPreviewSourceAudio();
    elements.preview_video.pause();
    switchedPreview = true;
    await loadPreviewMediaUrl(source, nextMediaUrl);
    const persistedSnapshot = await saveActiveWorkspaceImmediately(
      nextProject,
      identitySafeRootProject
    );
    if (workspaceMode === "short-form") {
      rootProject = persistedSnapshot;
      project = {
        ...nextProject,
        shortForm: persistedSnapshot.shortForm
      };
    } else {
      project = nextProject;
      rootProject = cloneProject(nextProject);
    }
    mediaFile = source;
    mediaUrl = nextMediaUrl;
    rebindRuntimeTransportHistory(project.mediaAsset);
    if (standbyPreviewVideo) {
      configureVideoMediaSource(standbyPreviewVideo, source);
    }
    committed = true;
    if (previousMediaUrl && previousMediaUrl !== nextMediaUrl) {
      releaseMediaUrl(previousMediaSource, previousMediaUrl);
    }
    hideJob();
    renderAll();
    await seekTimeline(previousPlayheadMs, { play: previousWasPlaying });
    const overrun = clipOutsideMedia(project);
    if (overrun) {
      showToast(
        projectUsesChzzkMaterializedMedia()
          ? "선택 구간 일부가 준비된 ±10초 편집 범위 밖에 있습니다. 편집 영상을 다시 준비해 주세요."
          : "선택 구간 일부가 직접 연결한 영상 길이 밖에 있습니다. 페이지↔로컬 정렬값을 확인해 주세요.",
        "error",
        7000
      );
    } else {
      showToast(
        materialization === undefined
          ? "원본 영상을 연결했습니다."
          : "필요한 편집 범위를 이 기기의 로컬 영상에 준비했습니다.",
        "success"
      );
    }
    return true;
  } catch (error: unknown) {
    if (committed) {
      console.error("로컬 편집 영상 교체 뒤 UI 동기화에 실패했습니다.", error);
      showToast(
        `로컬 편집 영상은 교체했지만 화면 동기화에 실패했습니다: ${errorMessage(error)}`,
        "error",
        0
      );
      return true;
    }
    project = previousProjectSnapshot;
    rootProject = previousRootProjectSnapshot;
    if (nextMediaUrl && nextMediaUrl !== mediaUrl) {
      releaseMediaUrl(source, nextMediaUrl);
    }
    let previewRollbackError: unknown = null;
    if (previousMediaUrl && switchedPreview) {
      try {
        await loadPreviewMediaUrl(previousMediaSource!, previousMediaUrl);
        if (standbyPreviewVideo) {
          configureVideoMediaSource(standbyPreviewVideo, previousMediaSource);
          standbyPreviewVideo.src = previousMediaUrl;
        }
        await seekTimeline(previousPlayheadMs, { play: previousWasPlaying });
      } catch (rollbackError: unknown) {
        previewRollbackError = rollbackError;
      }
    } else if (!previousMediaUrl && !mediaUrl && switchedPreview) {
      configureVideoMediaSource(elements.preview_video, null);
      elements.preview_video.removeAttribute("src");
      elements.preview_video.load();
      cancelPreviewPreload({ clearSource: true });
    }
    hideJob();
    showToast(
      previewRollbackError
        ? `${errorMessage(error)} 이전 미리보기도 복구하지 못했습니다: ${errorMessage(previewRollbackError)}`
        : errorMessage(error),
      "error",
      0
    );
    return false;
  } finally {
    unlockProjectMutations();
    if (workspaceMode === "short-form") {
      scheduleShortPreviewCacheRepair();
    }
  }
}

function chzzkVodSourceUrl(
  candidateProject: EditorProject = project
): string | null {
  const expectedPlatform = String(
    candidateProject.source?.platform || SOURCE_PLATFORM_CHZZK
  ).trim().toUpperCase();
  if (
    ![
      SOURCE_PLATFORM_CHZZK,
      SOURCE_PLATFORM_YOUTUBE,
      SOURCE_PLATFORM_SOOP
    ].includes(expectedPlatform)
    || String(candidateProject.source?.contentType || "").trim().toLowerCase()
      !== "vod"
  ) {
    return null;
  }
  const contentId = chzzkVodContentId(candidateProject);
  const candidate = String(
    candidateProject.source?.canonicalUrl
      || candidateProject.source?.url
      || ""
  ).trim();
  const identifiers = inferSourceIdentifiers(candidate);
  if (
    identifiers.platform !== expectedPlatform
    || identifiers.contentType !== "vod"
    || !identifiers.contentId
    || (contentId && identifiers.contentId !== contentId)
  ) {
    return null;
  }
  return canonicalSourceUrl(candidate, identifiers) || null;
}

function vodSourceClipId(clip: EditorClip): string {
  return String(clip.shortFormSourceClipId || clip.id).trim();
}

function vodWorkspaceClips(
  sourceClockProject: EditorProject,
  sourceClockRootProject: EditorProject = rootProject
): EditorClip[] {
  const collected: EditorClip[] = [];
  const collectedSourceAssetIds = new Set<string>();
  const append = (clips: readonly EditorClip[] | undefined) => {
    for (const clip of clips || []) {
      if (clip.enabled === false || clip.shortFormCanvasClock === true) {
        continue;
      }
      collected.push(clip);
    }
  };
  const appendSourceAssets = (candidate: EditorProject | null | undefined) => {
    const assets: ShortFormSourceBackedAsset[] = [
      ...(candidate?.shortForm?.videoAssets || []),
      ...(candidate?.shortForm?.sourceAudioAssets || [])
    ];
    for (const asset of assets) {
      const key = `${asset.sourceAssetId}:${asset.id}`;
      if (collectedSourceAssetIds.has(key)) {
        continue;
      }
      collectedSourceAssetIds.add(key);
      collected.push(shortFormSourceAssetVirtualClip(
        asset,
        vodSourceAnchorForShortAsset(
          asset,
          sourceClockProject,
          sourceClockRootProject
        )
      ));
    }
  };

  append(sourceClockProject.clips);
  appendSourceAssets(sourceClockProject);
  if (workspaceMode === "short-form") {
    if (sourceClockRootProject) {
      append(sourceClockRootProject.clips);
    }
  }
  return collected;
}

function enabledChzzkVodClips(
  candidateProject: EditorProject = project,
  sourceClockRootProject: EditorProject = rootProject
) {
  const bySourceClipId = new Map<string, {
    id: string;
    startMs: number;
    endMs: number;
  }>();
  for (const clip of vodWorkspaceClips(
    candidateProject,
    sourceClockRootProject
  )) {
    const id = vodSourceClipId(clip);
    const startMs = Number(clip.shortFormSelectionStartMs ?? clip.selectionStartMs);
    const endMs = Number(clip.shortFormSelectionEndMs ?? clip.selectionEndMs);
    const previous = bySourceClipId.get(id);
    if (
      previous
      && (previous.startMs !== startMs || previous.endMs !== endMs)
    ) {
      throw new Error(
        `본편·쇼츠의 원본 선택 anchor가 서로 다릅니다: ${id}`
      );
    }
    bySourceClipId.set(id, {
      id,
      startMs,
      endMs
    });
  }
  const materialization = projectMaterialization(candidateProject);
  for (const range of materialization?.clipRanges || []) {
    if (!bySourceClipId.has(range.clipId)) {
      bySourceClipId.set(range.clipId, {
        id: range.clipId,
        startMs: range.sourceStartMs,
        endMs: range.sourceEndMs
      });
    }
  }
  return [...bySourceClipId.values()];
}

function currentVodCoverageForClip(
  clipId: string,
  workspaceClips: readonly EditorClip[],
  materialization: ChzzkVodMaterialization
): MaterializationClipCoverage | null {
  const workspaceClip = workspaceClips.find((clip) => (
    vodSourceClipId(clip) === clipId
  ));
  if (!workspaceClip) {
    return materialization.clipRanges?.find((range) => (
      range.clipId === clipId
    )) || null;
  }
  const requestRange = materializationRequestRangeForClip(
    workspaceClip,
    materialization
  );
  const bounds = materializedEditableBoundsForClip(
    workspaceClip,
    materialization
  );
  return requestRange && bounds
    ? {
      clipId,
      sourceStartMs: requestRange.sourceStartMs,
      sourceEndMs: requestRange.sourceEndMs,
      editableSourceStartMs: bounds.editableSourceStartMs,
      editableSourceEndMs: bounds.editableSourceEndMs
    }
    : null;
}

function createVodCoveragePlan(
  sourceClockProject: EditorProject,
  requestedRanges: readonly ChzzkVodEditableRangeRequest[] = [],
  sourceClockRootProject: EditorProject = rootProject
): VodCoveragePlan {
  const clips = enabledChzzkVodClips(
    sourceClockProject,
    sourceClockRootProject
  );
  const materialization = projectMaterialization(sourceClockProject);
  if (!materialization) {
    return {
      clips,
      editableRanges: [],
      expandsCurrentMaterialization: false
    };
  }
  const workspaceClips = vodWorkspaceClips(
    sourceClockProject,
    sourceClockRootProject
  );
  const requestedById = new Map(
    requestedRanges.map((range) => [range.id, range])
  );
  let expandsCurrentMaterialization = false;
  const editableRanges = clips.map((clip) => {
    const current = currentVodCoverageForClip(
      clip.id,
      workspaceClips,
      materialization
    );
    const minimumStartMs = Math.max(0, clip.startMs - materialization.handleMs);
    const minimumEndMs = Math.min(
      materialization.sourceDurationMs,
      clip.endMs + materialization.handleMs
    );
    let startMs = Math.min(
      minimumStartMs,
      current?.editableSourceStartMs ?? minimumStartMs
    );
    let endMs = Math.max(
      minimumEndMs,
      current?.editableSourceEndMs ?? minimumEndMs
    );
    for (const workspaceClip of workspaceClips) {
      if (vodSourceClipId(workspaceClip) !== clip.id) {
        continue;
      }
      startMs = Math.min(startMs, workspaceClip.sourceStartMs);
      endMs = Math.max(endMs, workspaceClip.sourceEndMs);
    }
    const requested = requestedById.get(clip.id);
    if (requested) {
      startMs = Math.min(startMs, requested.startMs);
      endMs = Math.max(endMs, requested.endMs);
    }
    startMs = Math.max(0, Math.round(startMs));
    endMs = Math.min(
      materialization.sourceDurationMs,
      Math.round(endMs)
    );
    if (
      !current
      || startMs < current.editableSourceStartMs
      || endMs > current.editableSourceEndMs
    ) {
      expandsCurrentMaterialization = true;
    }
    return { id: clip.id, startMs, endMs };
  });
  return { clips, editableRanges, expandsCurrentMaterialization };
}

function materializationCoversVodPlan(
  materialization: ChzzkVodMaterialization,
  plan: VodCoveragePlan
): boolean {
  if (!materialization.clipRanges) {
    return plan.editableRanges.length === 0;
  }
  if (
    materialization.clipRanges.length !== plan.clips.length
    || (
      plan.editableRanges.length !== 0
      && plan.editableRanges.length !== plan.clips.length
    )
  ) {
    return false;
  }
  const byId = new Map(
    materialization.clipRanges.map((range) => [range.clipId, range])
  );
  const requestedById = new Map(
    plan.editableRanges.map((range) => [range.id, range])
  );
  if (byId.size !== plan.clips.length) {
    return false;
  }
  return plan.clips.every((clip) => {
    const coverage = byId.get(clip.id);
    const requested = requestedById.get(clip.id);
    const desired = requested || {
      id: clip.id,
      startMs: Math.max(0, clip.startMs - materialization.handleMs),
      endMs: Math.min(
        materialization.sourceDurationMs,
        clip.endMs + materialization.handleMs
      )
    };
    return Boolean(
      coverage
      && (plan.editableRanges.length === 0 || requested)
      && desired
      && coverage.sourceStartMs === clip.startMs
      && coverage.sourceEndMs === clip.endMs
      && coverage.editableSourceStartMs === desired.startMs
      && coverage.editableSourceEndMs === desired.endMs
    );
  });
}

function materializationHasCompatibleVodBaseAnchors(
  materialization: ChzzkVodMaterialization,
  plan: VodCoveragePlan
): boolean {
  if (
    materialization.schema !== CHZZK_VOD_MATERIALIZATION_SCHEMA
    || !materialization.clipRanges
    || materialization.clipRanges.length > plan.clips.length
  ) {
    return false;
  }
  const requestedById = new Map(
    plan.clips.map((clip) => [clip.id, clip])
  );
  return materialization.clipRanges.every((coverage) => {
    const requested = requestedById.get(coverage.clipId);
    return Boolean(
      requested
      && requested.startMs === coverage.sourceStartMs
      && requested.endMs === coverage.sourceEndMs
    );
  });
}

function chzzkVodRightsConfirmation(
  candidateProject: EditorProject = project
) {
  return normalizeChzzkVodRightsConfirmation(
    candidateProject.mediaAsset?.rightsConfirmation,
    chzzkVodContentId(candidateProject)
  );
}

function materializationStatusMessage(status: ChzzkVodMaterializationStatus) {
  const platform = sourcePlatformLabel(
    String(project.source?.platform || SOURCE_PLATFORM_CHZZK).toUpperCase()
  );
  const stageLabels: Record<string, string> = {
    queued: "준비 순서를 기다리는 중",
    resolving: `${platform} 원본 확인 중`,
    planning: "필요한 로컬 편집 범위 계산 중",
    downloading: "필요한 VOD 조각을 이 기기로 받는 중",
    verifying: "조각·키프레임·코덱 확인 중",
    muxing: "로컬 편집 영상을 구성 중",
    completed: "로컬 편집 영상 준비 완료"
  };
  return stageLabels[status.state] || status.message;
}

function localMediaSourceFromStatus(
  media: ChzzkVodLocalMedia
): MaterializedLoopbackMediaSource {
  return normalizeMaterializedLoopbackMediaSource({
    kind: "local-url",
    ...media
  });
}

async function prepareChzzkVodMedia({
  restore = false,
  requestedRanges = [],
  hotLoadSequence
}: {
  restore?: boolean;
  requestedRanges?: readonly ChzzkVodEditableRangeRequest[];
  hotLoadSequence?: number;
} = {}) {
  let activePolicy: ActiveUsagePolicySession;
  try {
    activePolicy = requireActiveUsagePolicySession();
  } catch (error: unknown) {
    if (!restore) {
      showToast(errorMessage(error), "error", 0);
    }
    return false;
  }
  if (activeJobController || projectMutationLockCount > 0) {
    if (!restore) {
      showToast("다른 미디어 작업이 끝난 뒤 다시 시도해 주세요.", "error");
    }
    return false;
  }
  const sourceUrl = chzzkVodSourceUrl();
  if (!sourceUrl) {
    if (!restore) {
      showToast("지원하는 공개 치지직·YouTube·SOOP VOD에서만 선택 구간을 자동 준비할 수 있습니다.", "error");
    }
    return false;
  }
  let sourceClockProject: EditorProject;
  let sourceClockRootProject: EditorProject;
  try {
    sourceClockProject = applyMediaAlignmentOffset(project, 0);
    sourceClockRootProject = workspaceMode === "short-form"
      ? applyMediaAlignmentOffset(rootProject, 0)
      : sourceClockProject;
  } catch (error: unknown) {
    if (!restore) {
      showToast(
        `VOD 원본 시각으로 정렬값을 되돌리지 못했습니다: ${errorMessage(error)}`,
        "error",
        0
      );
    }
    return false;
  }
  let coveragePlan: VodCoveragePlan;
  try {
    coveragePlan = createVodCoveragePlan(
      sourceClockProject,
      requestedRanges,
      sourceClockRootProject
    );
  } catch (error: unknown) {
    if (!restore) {
      showToast(
        `본편·쇼츠 로컬 범위를 합치지 못했습니다: ${errorMessage(error)}`,
        "error",
        0
      );
    }
    return false;
  }
  const clips = coveragePlan.clips;
  if (clips.length === 0) {
    if (!restore) {
      showToast("먼저 준비할 사용자 선택 구간을 하나 이상 활성화해 주세요.", "error");
    }
    return false;
  }
  const previousConfirmation = chzzkVodRightsConfirmation(sourceClockProject);
  if (restore && !previousConfirmation) {
    return false;
  }
  const rightsConfirmation = {
    scope: "owned-or-authorized-public-vod" as const,
    contentId: chzzkVodContentId(sourceClockProject),
    confirmedAt: activePolicy.confirmedAt
  };
  const resumableMaterialization = projectMaterialization(sourceClockProject);
  const extendingMaterialization = Boolean(
    resumableMaterialization
    && coveragePlan.expandsCurrentMaterialization
  );
  const reusableExpansionBase = Boolean(
    extendingMaterialization
    && resumableMaterialization
    && materializationHasCompatibleVodBaseAnchors(
      resumableMaterialization,
      coveragePlan
    )
  );
  const shouldSendExactEditableRanges = Boolean(
    extendingMaterialization
    || resumableMaterialization?.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
  );

  const controller = new AbortController();
  activeJobController = controller;
  lockProjectMutations();
  showJob(
    restore
      ? "이 기기의 편집 영상을 다시 연결하는 중"
      : extendingMaterialization
        ? "필요한 편집 범위를 더 받는 중"
        : "편집 영상을 준비하는 중",
    extendingMaterialization
      ? "기존 로컬 범위를 유지하고 부족한 앞뒤 구간만 추가합니다."
      : `${sourcePlatformLabel(String(project.source?.platform || SOURCE_PLATFORM_CHZZK).toUpperCase())} 원본 시각과 최초 ±10초 편집 핸들을 확인합니다.`,
    0.01,
    { cancelable: true }
  );
  let manualFileRequested = false;
  try {
    await cancelAndWaitForShortPreviewCacheOperation();
    const engineReady = await ensureLocalMediaEngineReady(controller.signal);
    if (engineReady === "manual-file") {
      manualFileRequested = true;
      return false;
    }
    const endpoint = KIRINUKI_MEDIA_ENGINE_ENDPOINT;
    const token = await ensureCaptionAgentSession({
      endpoint,
      token: vodMediaEngineToken,
      purpose: "vod",
      projectId: sourceClockRootProject.id,
      sourceUrl,
      signal: controller.signal
    });
    vodMediaEngineToken = token;
    const startWithSession = (sessionToken: string) => (
      startChzzkVodMaterialization({
      endpoint,
      token: sessionToken,
      consumerId: sourceClockRootProject.id,
      sourceUrl,
      ...(String(sourceClockProject.source?.platform || "").toUpperCase()
        === SOURCE_PLATFORM_SOOP
        ? {
          sourceClockIdentity:
            sourceClockProject.source?.sourceClockIdentity
        }
        : {}),
      clips,
      ...(shouldSendExactEditableRanges
        ? { editableRanges: coveragePlan.editableRanges }
        : {}),
      rightsConfirmed: true,
      ...(resumableMaterialization && !extendingMaterialization
        ? {
          resume: {
            materializationId: resumableMaterialization.materializationId,
            planFingerprint: resumableMaterialization.planFingerprint,
            contentId: resumableMaterialization.source.contentId
          }
        }
        : {}),
      ...(resumableMaterialization
        && extendingMaterialization
        && reusableExpansionBase
        ? {
          base: {
            materializationId: resumableMaterialization.materializationId,
            planFingerprint: resumableMaterialization.planFingerprint,
            contentId: resumableMaterialization.source.contentId
          }
        }
        : {}),
      signal: controller.signal
      })
    );
    let status = await startWithSession(token);
    activeChzzkVodJob = {
      jobId: status.jobId,
      endpoint,
      token
    };
    updateJob(status.progress, materializationStatusMessage(status));
    if (status.state !== "completed") {
      const waitForStatus = (
        sessionToken: string,
        jobId: string
      ) => waitForChzzkVodMaterialization({
        endpoint,
        token: sessionToken,
        jobId,
        signal: controller.signal,
        onProgress: (nextStatus) => {
          updateJob(
            nextStatus.progress,
            materializationStatusMessage(nextStatus)
          );
        }
      });
      try {
        status = await waitForStatus(token, status.jobId);
      } catch (error) {
        const recoverableSessionLoss =
          error instanceof LocalMediaEngineTransportError
          || (
            error instanceof ChzzkVodMaterializationClientError
            && error.status === 401
          );
        if (!recoverableSessionLoss) {
          throw error;
        }
        // A supervisor restart erases memory-only capability/AEAD state and
        // in-memory job records. Re-authenticate once, then submit the exact
        // same project/source/range request so the managed cache can safely
        // resume or deduplicate it. The second poll is deliberately terminal:
        // no unbounded recovery loop and no retry for 403/semantic failures.
        let recoveredToken = "";
        for (const [attempt, delayMs] of [0, 250, 750].entries()) {
          if (delayMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            controller.signal.throwIfAborted();
          }
          try {
            recoveredToken = await ensureCaptionAgentSession({
              endpoint,
              token,
              purpose: "vod",
              projectId: sourceClockRootProject.id,
              sourceUrl,
              signal: controller.signal
            });
            break;
          } catch (recoveryError) {
            if (
              !(recoveryError instanceof LocalMediaEngineConnectionError)
              || recoveryError.code !== "ENGINE_UNAVAILABLE"
              || attempt === 2
            ) {
              throw recoveryError;
            }
          }
        }
        if (!recoveredToken) {
          throw new Error("로컬 엔진 session을 bounded retry 뒤에도 복구하지 못했습니다.");
        }
        vodMediaEngineToken = recoveredToken;
        status = await startWithSession(recoveredToken);
        activeChzzkVodJob = {
          jobId: status.jobId,
          endpoint,
          token: recoveredToken
        };
        updateJob(status.progress, materializationStatusMessage(status));
        if (status.state !== "completed") {
          status = await waitForStatus(recoveredToken, status.jobId);
        }
      }
    }
    controller.signal.throwIfAborted();
    const materialization = normalizeChzzkVodMaterialization(
      status.materialization
    );
    if (!materialization || !status.media) {
      throw new Error("Kirinuki 내부 미디어 엔진이 안전한 VOD 시간 정보를 확인하지 못했습니다.");
    }
    if (
      hotLoadSequence !== undefined
      && hotLoadSequence !== latestVodHotLoadSequence
    ) {
      return false;
    }
    const contentId = chzzkVodContentId(sourceClockProject);
    const expectedPlatform = String(
      sourceClockProject.source?.platform || SOURCE_PLATFORM_CHZZK
    ).trim().toUpperCase();
    if (
      materialization.source.platform !== expectedPlatform
      || materialization.source.contentType !== "vod"
      || materialization.source.contentId !== contentId
      || materialization.handleMs !== 10_000
      || (
        (!resumableMaterialization || extendingMaterialization)
        && materialization.schema !== CHZZK_VOD_MATERIALIZATION_SCHEMA
      )
      || (
        resumableMaterialization?.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
        && resumableMaterialization.source.sourceVersionId
        && materialization.source.sourceVersionId
          !== resumableMaterialization.source.sourceVersionId
      )
      || (materialization.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
        ? !materializationCoversVodPlan(materialization, coveragePlan)
        : vodWorkspaceClips(
          sourceClockProject,
          sourceClockRootProject
        ).some((clip) => (
          !materializeEditorClipWithinEditableBounds(clip, materialization)
        )))
    ) {
      throw new Error("준비된 미디어가 현재 본편·쇼츠 편집 범위를 정확히 덮지 않습니다.");
    }
    // Network/materialization work may finish after a same-tab history
    // transition. Apply it only when the exact project+source+entry lease that
    // started the request is still current; a newer A→B session must keep the
    // verified A artifact in its own internal cache without attaching it.
    requireSameUsagePolicyLease(activePolicy);
    const liveSourceSessionId = sourceSessionIdentity(project.source);
    if (
      project.id !== sourceClockProject.id
      || sourceClockRootProject.id !== sourceClockProject.id
      || liveSourceSessionId !== activePolicy.sourceSessionId
    ) {
      throw new Error(
        "편집 영상 준비 중 프로젝트 또는 원본이 바뀌어 완료 결과를 현재 화면에 적용하지 않았습니다."
      );
    }
    const attached = await attachMediaSource(
      localMediaSourceFromStatus(status.media),
      {
        fileHandleStored: false,
        materialization,
        rightsConfirmation,
        baseProject: sourceClockProject,
        baseRootProject: sourceClockRootProject
      }
    );
    if (!attached) {
      return false;
    }
    mediaHandle = null;
    try {
      await deleteMediaHandle(project.id);
    } catch (error: unknown) {
      console.warn("이전 수동 원본 파일 핸들을 정리하지 못했습니다.", error);
    }
    return true;
  } catch (error: unknown) {
    hideJob();
    const cancelled = errorName(error) === "AbortError";
    // Restoring a saved materialization is opportunistic. Keep the durable
    // project healthy and leave the visible re-prepare action available;
    // explicit user-triggered preparation still reports the exact failure.
    if (!restore) {
      showToast(
        cancelled
          ? "VOD 편집 영상 준비를 취소했습니다."
          : `VOD 편집 영상을 준비하지 못했습니다: ${internalMediaEngineErrorMessage(error, "VOD")} 내 파일 직접 연결도 사용할 수 있습니다.`,
        cancelled ? "info" : "error",
        cancelled ? 3_600 : 0
      );
    }
    return false;
  } finally {
    activeChzzkVodJob = null;
    activeJobController = null;
    renderCaptionModeControls();
    hideJob();
    unlockProjectMutations();
    renderAll({ keepScroll: true });
    if (manualFileRequested) {
      // Invoke before this click task loses transient user activation. The
      // picker function starts synchronously, after the mutation lock is gone.
      void chooseMediaFile();
    }
    if (workspaceMode === "short-form") {
      scheduleShortPreviewCacheRepair();
    }
  }
}

function mergePendingVodHotLoadRange(
  batch: PendingVodHotLoadBatch,
  range: ChzzkVodEditableRangeRequest
): void {
  const previous = batch.editableRanges.get(range.id);
  batch.editableRanges.set(range.id, previous
    ? {
      id: range.id,
      startMs: Math.min(previous.startMs, range.startMs),
      endMs: Math.max(previous.endMs, range.endMs)
    }
    : range);
}

function mergeVodHotLoadBatch(
  target: PendingVodHotLoadBatch,
  source: PendingVodHotLoadBatch,
  { includeWaiters = false }: { includeWaiters?: boolean } = {}
): void {
  for (const range of source.editableRanges.values()) {
    mergePendingVodHotLoadRange(target, range);
  }
  for (const [key, intent] of source.trimIntents) {
    if (!target.trimIntents.has(key)) {
      target.trimIntents.set(key, intent);
    }
  }
  if (includeWaiters) {
    target.waiters.unshift(...source.waiters);
  }
}

function applyLoadedVodTrimIntents(
  intents: readonly VodHotLoadTrimIntent[]
): boolean {
  let nextProject = project;
  let changed = false;
  for (const intent of [...intents].sort((left, right) => (
    left.sequence - right.sequence
  ))) {
    const trimKey = `${intent.workspaceClipId}:${intent.side}`;
    if (latestVodHotLoadTrimSequence.get(trimKey) !== intent.sequence) {
      continue;
    }
    const clip = nextProject.clips.find((candidate) => (
      candidate.id === intent.workspaceClipId
      && vodSourceClipId(candidate) === intent.sourceClipId
    ));
    const materialization = projectMaterialization(nextProject);
    const bounds = clip && materialization
      ? materializedEditableBoundsForClip(clip, materialization)
      : null;
    if (!clip || !bounds) {
      continue;
    }
    const sourceStartMs = intent.side === "left"
      ? Math.max(
        bounds.editableSourceStartMs,
        Math.min(clip.sourceEndMs - 100, intent.targetSourceMs)
      )
      : clip.sourceStartMs;
    const sourceEndMs = intent.side === "right"
      ? Math.min(
        bounds.editableSourceEndMs,
        Math.max(clip.sourceStartMs + 100, intent.targetSourceMs)
      )
      : clip.sourceEndMs;
    if (
      sourceStartMs !== clip.sourceStartMs
      || sourceEndMs !== clip.sourceEndMs
    ) {
      nextProject = updateClipTrim(nextProject, clip.id, {
        sourceStartMs,
        sourceEndMs
      });
      changed = true;
    }
  }
  if (changed) {
    clearTimelineRangeSelection({ render: false });
    applyProject(withCurrentTimelinePlayhead(nextProject));
    void syncPreviewToPlayhead();
  }
  return changed;
}

async function drainVodHotLoadQueue(): Promise<void> {
  for (;;) {
    if (!pendingVodHotLoadBatch) {
      return;
    }
    const batch = pendingVodHotLoadBatch;
    pendingVodHotLoadBatch = null;
    inFlightVodHotLoadBatch = batch;
    let loaded = false;
    try {
      loaded = await prepareChzzkVodMedia({
        requestedRanges: [...batch.editableRanges.values()],
        hotLoadSequence: batch.sequence
      });
      if (loaded) {
        applyLoadedVodTrimIntents([...batch.trimIntents.values()]);
      }
    } catch (error: unknown) {
      if (batch.sequence === latestVodHotLoadSequence) {
        showToast(
          `추가 편집 범위를 준비하지 못했습니다: ${errorMessage(error)}`,
          "error",
          0
        );
      }
    } finally {
      inFlightVodHotLoadBatch = null;
      if (
        !loaded
        && !vodHotLoadQueueCancelRequested
        && batch.sequence !== latestVodHotLoadSequence
      ) {
        if (!pendingVodHotLoadBatch) {
          pendingVodHotLoadBatch = {
            sequence: latestVodHotLoadSequence,
            editableRanges: new Map(),
            trimIntents: new Map(),
            waiters: []
          };
        }
        mergeVodHotLoadBatch(pendingVodHotLoadBatch, batch, {
          includeWaiters: true
        });
      } else {
        for (const resolve of batch.waiters) {
          resolve(loaded);
        }
      }
    }
  }
}

function ensureVodHotLoadDrain(): void {
  if (activeVodHotLoadDrain) {
    return;
  }
  let operation: Promise<void>;
  operation = drainVodHotLoadQueue().finally(() => {
    if (activeVodHotLoadDrain === operation) {
      activeVodHotLoadDrain = null;
    }
    if (pendingVodHotLoadBatch) {
      ensureVodHotLoadDrain();
    } else {
      vodHotLoadQueueCancelRequested = false;
    }
  });
  activeVodHotLoadDrain = operation;
}

function queueVodHotLoad(
  range: ChzzkVodEditableRangeRequest,
  trimIntent?: Omit<VodHotLoadTrimIntent, "sequence">
): Promise<boolean> {
  vodHotLoadQueueCancelRequested = false;
  const sequence = ++latestVodHotLoadSequence;
  if (!pendingVodHotLoadBatch) {
    pendingVodHotLoadBatch = {
      sequence,
      editableRanges: new Map(),
      trimIntents: new Map(),
      waiters: []
    };
    if (inFlightVodHotLoadBatch) {
      mergeVodHotLoadBatch(
        pendingVodHotLoadBatch,
        inFlightVodHotLoadBatch
      );
    }
  }
  const batch = pendingVodHotLoadBatch;
  batch.sequence = sequence;
  mergePendingVodHotLoadRange(batch, range);
  if (trimIntent) {
    const intent = { ...trimIntent, sequence };
    const trimKey = `${intent.workspaceClipId}:${intent.side}`;
    latestVodHotLoadTrimSequence.set(trimKey, sequence);
    batch.trimIntents.set(trimKey, intent);
  }
  const result = new Promise<boolean>((resolve) => {
    batch.waiters.push(resolve);
  });
  ensureVodHotLoadDrain();
  return result;
}

function requestVodHotLoadForClip(
  clip: EditorClip,
  side: VodHotLoadSide,
  {
    targetSourceMs,
    applyTrim = false
  }: {
    targetSourceMs?: number;
    applyTrim?: boolean;
  } = {}
): Promise<boolean> {
  const materialization = projectMaterialization();
  const bounds = materialization
    ? materializedEditableBoundsForClip(clip, materialization)
    : null;
  if (!materialization || !bounds) {
    showToast(
      `${projectSourcePlatformLabel()} 로컬 편집 영상의 컷 범위를 다시 확인해 주세요.`,
      "error",
      0
    );
    return Promise.resolve(false);
  }
  const sourceClipId = vodSourceClipId(clip);
  const requestedTarget = Number(targetSourceMs);
  const desiredStartMs = side === "before"
    ? Math.max(0, Math.min(
      bounds.editableSourceStartMs - VOD_HOT_LOAD_CHUNK_MS,
      Number.isFinite(requestedTarget)
        ? Math.round(requestedTarget)
        : bounds.editableSourceStartMs
    ))
    : bounds.editableSourceStartMs;
  const desiredEndMs = side === "after"
    ? Math.min(materialization.sourceDurationMs, Math.max(
      bounds.editableSourceEndMs + VOD_HOT_LOAD_CHUNK_MS,
      Number.isFinite(requestedTarget)
        ? Math.round(requestedTarget)
        : bounds.editableSourceEndMs
    ))
    : bounds.editableSourceEndMs;
  if (
    desiredStartMs === bounds.editableSourceStartMs
    && desiredEndMs === bounds.editableSourceEndMs
  ) {
    showToast("원본 영상의 시작 또는 끝에 도달했습니다.", "info");
    return Promise.resolve(false);
  }
  const timelineSide: TimelineSide = side === "before" ? "left" : "right";
  return queueVodHotLoad(
    {
      id: sourceClipId,
      startMs: desiredStartMs,
      endMs: desiredEndMs
    },
    applyTrim && Number.isFinite(requestedTarget)
      ? {
        workspaceClipId: clip.id,
        sourceClipId,
        side: timelineSide,
        targetSourceMs: Math.max(
          0,
          Math.min(
            materialization.sourceDurationMs,
            Math.round(requestedTarget)
          )
        )
      }
      : undefined
  );
}

function readCaptionAgentConfig(): CaptionUiConfig {
  const model = elements.caption_model.value as CaptionModel;
  return {
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token: model === AUDSEG_DRAFT_MODEL
      ? ""
      : elements.caption_agent_token.value,
    model
  };
}

function captionAgentSelectionStillCurrent(config: CaptionUiConfig) {
  try {
    const current = readCaptionAgentConfig();
    return (
      current.endpoint === config.endpoint
      && current.model === config.model
    );
  } catch {
    return false;
  }
}

function setCaptionLocalStatus(message: string, state = "idle") {
  elements.caption_local_status.textContent = message;
  elements.caption_local_status.dataset.state = state;
}

function whisperModelCatalogEntry(modelId: unknown) {
  if (
    typeof modelId !== "string"
    || !Object.hasOwn(WHISPER_MODEL_CATALOG, modelId)
  ) {
    return null;
  }
  return WHISPER_MODEL_CATALOG[modelId as WhisperModelId];
}

function setWhisperConnectionStatus(
  message: string,
  state: WhisperConnectionState
) {
  whisperConnectionState = state;
  whisperConnectionMessage = message;
  elements.whisper_connection_status.textContent = message;
  elements.whisper_connection_status.dataset.state = state;
}

function connectedWhisperCatalogEntry() {
  const runtime = captionAgentRuntime?.provider === "local-whispercpp"
    ? captionAgentRuntime
    : null;
  const entry = whisperModelCatalogEntry(runtime?.sttModel);
  if (
    whisperConnectionState !== "ready"
    || !runtime
    || !entry
    || connectedWhisperModelId !== runtime.sttModel
  ) {
    return null;
  }
  return entry;
}

function renderCaptionModeControls() {
  const audseg = elements.caption_model.value === AUDSEG_DRAFT_MODEL;
  const connectedModel = connectedWhisperCatalogEntry();
  const whisperReady = Boolean(connectedModel);
  if (whisperConnectionState === "ready" && !whisperReady) {
    setWhisperConnectionStatus(
      "다시 연결해야 합니다 · 이 PC의 Whisper를 자동으로 다시 확인해 주세요",
      "disconnected"
    );
  }

  elements.audseg_provider_tab.setAttribute("aria-selected", String(audseg));
  elements.audseg_provider_tab.disabled = Boolean(activeJobController);
  elements.audseg_provider_tab.tabIndex = audseg ? 0 : -1;
  elements.whisper_provider_tab.setAttribute("aria-selected", String(!audseg));
  elements.whisper_provider_tab.setAttribute("aria-expanded", String(!audseg));
  elements.whisper_provider_tab.disabled = Boolean(activeJobController);
  elements.whisper_provider_tab.tabIndex = audseg ? -1 : 0;
  elements.audseg_provider_panel.hidden = !audseg;
  elements.whisper_provider_panel.hidden = audseg;
  elements.caption_advanced_settings.hidden = audseg;
  elements.generate_captions.lastChild!.textContent = audseg
    ? " 활성 컷 전체 빈 타이밍 만들기"
    : " 활성 컷 전체 자막 초안 만들기";
  elements.generate_captions.disabled = Boolean(activeJobController);
  elements.connect_local_whisper.disabled = Boolean(
    activeJobController
    || whisperConnectionState === "picking"
    || whisperConnectionState === "validating"
  );
  elements.connect_local_whisper.lastChild!.textContent = whisperReady
    ? " Whisper 다시 확인"
    : " 이 PC의 Whisper 자동 연결";
  elements.whisper_model_summary.hidden = false;
  if (connectedModel && captionAgentRuntime) {
    elements.whisper_model_summary.textContent = [
      `연결된 모델: ${connectedModel.label} (${connectedModel.id})`,
      `${connectedModel.purpose} · 모델 파일 ${connectedModel.downloadSizeLabel}`
    ].join("\n");
  } else {
    elements.whisper_model_summary.textContent =
      "버튼을 누르면 실행 중인 Tiny·Base·Small·Medium 모델을 자동으로 확인합니다";
  }
  if (audseg) {
    setCaptionLocalStatus(
      `AudSeg ${AUDSEG_ENGINE_VERSION} 준비됨 · 모델·전사·네트워크 없음`,
      "ready"
    );
  }
  if (!whisperConnectionMessage) {
    setWhisperConnectionStatus(
      "아직 연결하지 않았습니다 · 버튼을 누르면 Kirinuki가 내장 Whisper를 확인합니다",
      "disconnected"
    );
  } else {
    elements.whisper_connection_status.textContent = whisperConnectionMessage;
    elements.whisper_connection_status.dataset.state = whisperConnectionState;
  }
}

function persistAudSegProviderSelection() {
  void saveCaptionAgentSettings({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    model: AUDSEG_DRAFT_MODEL
  }).then((settings) => {
    captionAgentSettings = {
      ...settings,
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint
    };
  }).catch((error: unknown) => {
    showToast(`자막 방식 설정 저장 실패: ${errorMessage(error)}`, "error", 0);
  });
}

function selectCaptionProvider(model: CaptionModel, { focus = false } = {}) {
  if (activeJobController) {
    return;
  }
  elements.caption_model.value = model;
  if (model === AUDSEG_DRAFT_MODEL) {
    persistAudSegProviderSelection();
  } else if (!connectedWhisperCatalogEntry()) {
    setWhisperConnectionStatus(
      "아직 연결되지 않았습니다 · 아래 버튼이나 자막 만들기를 누르면 자동 연결합니다",
      "disconnected"
    );
  }
  renderCaptionModeControls();
  if (focus) {
    (model === AUDSEG_DRAFT_MODEL
      ? elements.audseg_provider_tab
      : elements.whisper_provider_tab).focus();
  }
}

async function ensureLocalCaptionSession(
  config: CaptionUiConfig,
  signal?: AbortSignal,
  expectedModelId = ""
): Promise<PreparedCaptionUiConfig> {
  setCaptionLocalStatus(
    String(config.token || "").trim()
      ? "로컬 자막 엔진 세션을 확인하는 중"
      : "로컬 자막 엔진에 자동 연결하는 중",
    "connecting"
  );
  const token = await ensureCaptionAgentSession({
    endpoint: config.endpoint,
    token: config.token,
    purpose: "captions",
    projectId: project.id,
    ...(signal === undefined ? {} : { signal })
  });
  const capability = await probeCaptionAgent({
    endpoint: config.endpoint,
    token,
    ...(signal === undefined ? {} : { signal })
  }) as CaptionCapability;
  const runtime = captionAgentRuntimeIdentity(capability, {
    model: config.model
  });
  if (!captionAgentCapabilityReady(capability)) {
    throw new Error("로컬 Whisper STT가 준비되지 않았습니다.");
  }
  const catalogEntry = whisperModelCatalogEntry(runtime.sttModel);
  if (!catalogEntry) {
    throw new Error(
      `현재 Kirinuki가 검증하는 Whisper 모델이 아닙니다: ${runtime.sttModel}`
    );
  }
  if (expectedModelId && runtime.sttModel !== expectedModelId) {
    throw new Error(
      `요청한 모델(${expectedModelId})과 실행 중인 모델(${runtime.sttModel})이 다릅니다.`
    );
  }
  if (!captionAgentSelectionStillCurrent(config)) {
    return { ...config, token, capability, runtime };
  }
  elements.caption_agent_token.value = token;
  captionAgentRuntime = runtime;
  connectedWhisperModelId = runtime.sttModel;
  const actualStt = runtime.sttModel;
  setWhisperConnectionStatus(
    `연결됨 · 이 PC의 ${catalogEntry.label} (${actualStt})`,
    "ready"
  );
  return { ...config, token, capability, runtime };
}

function captureWhisperConnectionSnapshot(): WhisperConnectionSnapshot {
  return {
    runtime: captionAgentRuntime,
    settings: { ...captionAgentSettings },
    modelId: connectedWhisperModelId,
    token: elements.caption_agent_token.value,
    state: whisperConnectionState,
    message: whisperConnectionMessage
  };
}

function restoreWhisperConnectionSnapshot(
  snapshot: WhisperConnectionSnapshot
) {
  captionAgentRuntime = snapshot.runtime;
  captionAgentSettings = { ...snapshot.settings };
  connectedWhisperModelId = snapshot.modelId;
  elements.caption_agent_token.value = snapshot.token;
  setWhisperConnectionStatus(snapshot.message, snapshot.state);
}

async function prepareCaptionAgentConfig(): Promise<PreparedCaptionUiConfig> {
  const config = readCaptionAgentConfig();
  if (config.model === AUDSEG_DRAFT_MODEL) {
    const runtime = captionAgentRuntimeIdentity(null, {
      model: config.model
    });
    captionAgentRuntime = runtime;
    captionAgentSettings = await saveCaptionAgentSettings({
      endpoint: config.endpoint,
      model: config.model
    });
    return {
      ...config,
      endpoint: captionAgentSettings.endpoint,
      model: captionAgentSettings.model,
      capability: null,
      runtime
    };
  }
  if (!isLoopbackCaptionAgentEndpoint(config.endpoint)) {
    throw new Error(
      "이 PC의 Whisper 연결 정보가 올바르지 않습니다. AudSeg를 사용해 주세요."
    );
  }
  const sessionConfig = await ensureLocalCaptionSession(
    config,
    activeJobController?.signal
  );
  const capability = sessionConfig.capability || await probeCaptionAgent({
    endpoint: sessionConfig.endpoint,
    token: sessionConfig.token,
    ...(activeJobController?.signal === undefined
      ? {}
      : { signal: activeJobController.signal })
  }) as CaptionCapability;
  const runtime = sessionConfig.runtime || captionAgentRuntimeIdentity(capability, {
    model: sessionConfig.model
  });
  captionAgentRuntime = runtime;
  const ready = captionAgentCapabilityReady(capability);
  if (!ready) {
    throw new Error("로컬 Whisper STT가 준비되지 않았습니다.");
  }
  captionAgentSettings = await saveCaptionAgentSettings({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    model: sessionConfig.model
  });
  return {
    ...sessionConfig,
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    model: captionAgentSettings.model,
    capability,
    runtime
  };
}

function formatCaptionRunDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours > 0 ? `${hours}시간` : "",
    minutes > 0 ? `${minutes}분` : "",
    `${seconds}초`
  ].filter(Boolean).join(" ");
}

function confirmCaptionAgentRun(
  enabledClips: CaptionClip[],
  { skippedClipCount = 0 } = {}
) {
  const model = elements.caption_model.value as CaptionModel;
  const audseg = model === AUDSEG_DRAFT_MODEL;
  const estimate = captionAgentRunEstimate(enabledClips, {
    model
  });
  return window.confirm([
    skippedClipCount > 0
      ? `중단된 ${audseg ? "AudSeg 타이밍" : "Whisper 자막"} 초벌을 이어서 할까요?`
      : `${audseg ? "AudSeg 빈 타이밍" : "Whisper 로컬 자막"} 초벌을 시작할까요?`,
    "",
    ...(skippedClipCount > 0
      ? [`저장 완료된 컷 ${skippedClipCount}개는 건너뜁니다`]
      : []),
    `활성 컷 ${estimate.clipCount}개 · 총 ${formatCaptionRunDuration(estimate.totalDurationMs)}`,
    ...(audseg
      ? [
        `AudSeg ${AUDSEG_ENGINE_VERSION} · 모델·네트워크 호출 없음`,
        "소리가 있는 구간만 4초 이하 빈 자막 칸으로 만듭니다",
        "음악·효과음도 잡힐 수 있고 텍스트는 직접 입력해야 합니다"
      ]
      : [
        `로컬 Whisper ${captionAgentRuntime?.sttModel || "연결 모델"} · 유료 API 호출 없음`,
        "STT가 만든 발화 시작·끝을 기준으로 검수용 자막 초안을 만듭니다"
      ]),
    "",
    "취소하면 오디오 추출을 시작하지 않습니다."
  ].join("\n"));
}

async function testCaptionAgentConnection() {
  if (activeJobController || projectMutationLockCount > 0) {
    return;
  }
  const controller = new AbortController();
  const connectionSnapshot = captureWhisperConnectionSnapshot();
  activeJobController = controller;
  elements.test_caption_agent.disabled = true;
  try {
    const rawConfig = readCaptionAgentConfig();
    const config = rawConfig.model === AUDSEG_DRAFT_MODEL
      ? await prepareCaptionAgentConfig()
      : await ensureLocalCaptionSession(rawConfig, controller.signal);
    if (config.model === AUDSEG_DRAFT_MODEL) {
      showToast(
        `AudSeg ${AUDSEG_ENGINE_VERSION} 준비 완료 · 모델과 서버 없이 이 탭에서 실행됩니다.`,
        "success",
        5200
      );
      setCaptionLocalStatus(
        `AudSeg ${AUDSEG_ENGINE_VERSION} 준비됨 · 모델·전사·네트워크 없음`,
        "ready"
      );
      return;
    }
    const result = config.capability!;
    const availableModels = Array.isArray(result.availableModels)
      ? result.availableModels.map((model: unknown) => String(model))
      : [];
    if (
      availableModels.length > 0
      && !availableModels.includes(config.model)
    ) {
      throw new Error(`Kirinuki 내장 자막 엔진이 ${config.model} 모델을 지원하지 않습니다.`);
    }
    const provider = result.provider ? ` · ${result.provider}` : "";
    const actualStt = config.runtime?.sttModel || result.models?.stt || "확인 불가";
    const ready = captionAgentCapabilityReady(result);
    const readiness = !ready
      ? " · 로컬 STT 설정 미완료"
      : "";
    showToast(
      `자막 에이전트 연결 확인 완료${provider} · Whisper · STT ${actualStt}${readiness}`,
      ready ? "success" : "error",
      ready ? 5200 : 0
    );
    captionAgentSettings = await saveCaptionAgentSettings({
      endpoint: config.endpoint,
      model: config.model
    });
    connectedWhisperModelId = String(actualStt);
    setWhisperConnectionStatus(
      ready
        ? `연결됨 · 이 PC의 ${whisperModelCatalogEntry(actualStt)?.label || actualStt}`
        : "Whisper 설정을 확인해 주세요",
      ready ? "ready" : "error"
    );
    renderCaptionModeControls();
  } catch (error: unknown) {
    const canceled = errorName(error) === "AbortError";
    if (!canceled) {
      elements.caption_advanced_settings.open = true;
    }
    showToast(
      canceled
        ? "Whisper 연결 확인을 취소했습니다."
        : `Whisper 자동 연결 실패: ${internalMediaEngineErrorMessage(error, "Whisper")}`,
      canceled ? "info" : "error",
      0
    );
    restoreWhisperConnectionSnapshot(connectionSnapshot);
    if (connectionSnapshot.state !== "ready") {
      setWhisperConnectionStatus(
        `자동 연결 실패 · ${internalMediaEngineErrorMessage(error, "Whisper")}`,
        "error"
      );
    }
    renderCaptionModeControls();
  } finally {
    activeJobController = null;
    elements.test_caption_agent.disabled = false;
    renderCaptionModeControls();
  }
}

function setAiProgress(progress: number, label: string) {
  const value = Math.max(0, Math.min(1, Number(progress) || 0));
  elements.ai_progress.hidden = false;
  (elements.ai_progress.querySelector(".progress-track span")! as EditorControl).style.width = `${Math.round(value * 100)}%`;
  elements.ai_progress_value.textContent = `${Math.round(value * 100)}%`;
  elements.ai_progress_label.textContent = label;
  if (!elements.job_dialog.hidden) {
    updateJob(value, label);
  }
}

async function generateCaptions() {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  if (!mediaFile) {
    showToast(
      chzzkVodSourceUrl()
        ? `자막 초벌을 만들려면 먼저 ${projectSourcePlatformLabel()} 편집 영상을 준비해 주세요.`
        : "자막 초벌을 만들려면 먼저 내 영상 파일을 직접 연결해 주세요.",
      "error"
    );
    return;
  }
  const allEnabledClips = project.clips.filter(
    (clip) => clip.enabled !== false
  );
  const selectedModel = elements.caption_model.value as CaptionModel;
  const audsegMode = selectedModel === AUDSEG_DRAFT_MODEL;
  const clipLimit = captionAgentRunClipLimit(selectedModel);
  if (allEnabledClips.length === 0) {
    showToast("선택한 구간이 없습니다.", "error");
    return;
  }
  if (clipOutsideMedia(project)) {
    showToast(
      projectUsesChzzkMaterializedMedia()
        ? "일부 컷이 현재 로컬 편집 범위 밖에 있습니다. 해당 컷의 앞·뒤 30초 추가 버튼으로 필요한 구간을 먼저 받아 주세요."
        : "일부 컷이 연결된 원본 길이 밖에 있습니다.",
      "error",
      0
    );
    return;
  }
  if (clipLimit != null && allEnabledClips.length > clipLimit) {
    showToast(
      `한 번에 Whisper 자막 초안을 만들 수 있는 활성 컷은 최대 ${clipLimit}개입니다. 컷을 ${clipLimit}개 이하 묶음으로 나눠 실행해 주세요.`,
      "error",
      0
    );
    return;
  }
  if (activeJobController || projectMutationLockCount > 0) {
    return;
  }
  try {
    for (const clip of allEnabledClips) {
      const durationMs = clipDurationMs(clip);
      if (audsegMode) {
        audSegAudioFootprint(durationMs);
      } else {
        captionAgentAudioFootprint(durationMs);
      }
    }
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  const returnFocus = document.activeElement as HTMLElement | null;
  const controller = new AbortController();
  activeJobController = controller;
  elements.generate_captions.disabled = true;
  let config;
  try {
    config = await prepareCaptionAgentConfig();
  } catch (error: unknown) {
    if (!audsegMode) {
      elements.caption_advanced_settings.open = true;
      setWhisperConnectionStatus(
        `자동 연결 실패 · ${internalMediaEngineErrorMessage(error, "Whisper")}`,
        "error"
      );
    }
    showToast(
      audsegMode
        ? `자막 초벌 설정을 확인해 주세요: ${errorMessage(error)}`
        : `Whisper를 준비하지 못했습니다: ${internalMediaEngineErrorMessage(error, "Whisper")} AudSeg는 바로 사용할 수 있습니다.`,
      "error",
      0
    );
    activeJobController = null;
    renderCaptionModeControls();
    if (returnFocus?.isConnected) {
      (returnFocus as EditorControl).focus();
    }
    return;
  }
  const { endpoint, token, model, runtime } = config;
  const trustedContextFingerprint = audsegMode
    ? "audseg-no-editorial-context-v1"
    : captionAgentEditorialContextFingerprint(project);
  const resumeCandidate = captionAgentResumePlan(
    allEnabledClips,
    project.ai?.captionCheckpoints,
    selectedModel,
    {
      resume: (
        ["running", "error", "canceled"].includes(project.ai?.status)
        && project.ai?.model === selectedModel
      ),
      editorialContextFingerprint: trustedContextFingerprint,
      pipelineFingerprint: runtime.fingerprint
    }
  );
  const resumeEligible = resumeCandidate.skippedClipIds.length > 0;
  const resumePlan = resumeEligible
    ? resumeCandidate
    : captionAgentResumePlan(
      allEnabledClips,
      project.ai?.captionCheckpoints,
      selectedModel,
      {
        resume: false,
        editorialContextFingerprint: trustedContextFingerprint,
        pipelineFingerprint: runtime.fingerprint
      }
    );
  const enabledClips = resumePlan.clips;
  if (enabledClips.length === 0 && resumePlan.skippedClipIds.length > 0) {
    project = {
      ...project,
      ai: {
        ...project.ai,
        status: "done",
        progress: 1,
        lastRunAt: new Date().toISOString(),
        error: null
      }
    };
    await saveActiveWorkspaceImmediately();
    renderAll({ keepScroll: true });
    showToast(
      "저장된 컷별 자막 체크포인트를 확인했습니다. 다시 처리할 컷이 없습니다.",
      "success",
      6500
    );
    activeJobController = null;
    renderCaptionModeControls();
    if (returnFocus?.isConnected) {
      (returnFocus as EditorControl).focus();
    }
    return;
  }
  if (!confirmCaptionAgentRun(enabledClips, {
    skippedClipCount: resumePlan.skippedClipIds.length
  })) {
    showToast("자막 초벌을 시작하지 않았습니다.", "info");
    activeJobController = null;
    renderCaptionModeControls();
    if (returnFocus?.isConnected) {
      (returnFocus as EditorControl).focus();
    }
    return;
  }
  let activeCaptionSessionToken = token;
  const undoSnapshot = cloneProject(project);
  let undoRecorded = false;
  let reviewRequiredCount = 0;
  let captionWarnings = resumePlan.skippedClipIds.length > 0
    ? [...(project.ai?.warnings || [])]
    : [];
  let generatedCueCount = 0;
  showJob(
    audsegMode
      ? "AudSeg 빈 타이밍을 만드는 중"
      : "로컬 Whisper 자막 초안을 만드는 중",
    resumePlan.skippedClipIds.length > 0
      ? `이미 저장된 ${resumePlan.skippedClipIds.length}개 컷은 건너뛰고 실패 지점부터 이어서 처리합니다.`
      : audsegMode
        ? "이 탭에서 오디오 활동 구간만 찾습니다. 음성을 글로 바꾸지 않으며 음악·효과음도 포함될 수 있습니다."
        : `활성 컷 음성을 이 기기의 Whisper ${runtime.sttModel}로 전사하고 실제 단어 타임스탬프를 우선해 초벌 자막으로 만듭니다.`,
    0,
    { cancelable: true, returnFocus }
  );
  project = {
    ...project,
    ai: {
      ...project.ai,
      provider: runtime.provider,
      model,
      status: "running",
      progress: 0,
      error: null,
      warnings: captionWarnings,
      captionCheckpoints: (
        resumeEligible
          ? project.ai.captionCheckpoints
          : discardCaptionAgentCheckpointsForClips(
            project.ai.captionCheckpoints,
            allEnabledClips
          )
      ).map((checkpoint) => ({ ...checkpoint }))
    }
  };
  renderHeader();

  lockProjectMutations();
  try {
    await saveActiveWorkspaceImmediately();
    const clips = enabledClips as EditorClip[];
    for (const [index, clip] of clips.entries()) {
      const base = index / clips.length;
      const span = 1 / clips.length;
      setAiProgress(
        base,
        `${index + 1}/${clips.length} · 선택 구간의 음성을 준비하는 중`
      );
      const pcm = await extractClipPcm16k(
        mediaFile,
        clipForMediaEngine(clip),
        {
        signal: controller.signal,
        channelMix: audsegMode ? "strongest" : "average",
        onProgress: (value) => {
          setAiProgress(
            base + span * value * 0.28,
            `${index + 1}/${clips.length} · 로컬 분석용 음성 추출 중`
          );
        }
        }
      );
      controller.signal.throwIfAborted();
      let result;
      let drafts;
      let speakerColors = project.ai?.speakerColors || {};
      if (audsegMode) {
        setAiProgress(
          base + span * 0.3,
          `${index + 1}/${clips.length} · AudSeg가 오디오 활동 구간을 찾는 중`
        );
        const segmentation = await segmentAudSegPcmInWorker(pcm, {
          signal: controller.signal
        });
        controller.signal.throwIfAborted();
        drafts = audSegBlankSubtitleDrafts(segmentation);
        const audsegWarnings = segmentation.warnings.map((warning) => ({
          code: AUDSEG_WARNING_CODES[warning] || "AUDSEG_REVIEW_REQUIRED",
          cueIndex: 0
        }));
        result = {
          provider: "local-audseg",
          model,
          resolvedModel: `audseg-${AUDSEG_ENGINE_VERSION}-dsp`,
          requestId: globalThis.crypto.randomUUID(),
          warnings: audsegWarnings
        };
        setAiProgress(
          base + span * 0.92,
          `${index + 1}/${clips.length} · 빈 자막 타이밍 ${drafts.length}개 준비됨`
        );
      } else {
        setAiProgress(
          base + span * 0.28,
          `${index + 1}/${clips.length} · Whisper 요청 준비 중`
        );
        const request = createCaptionAgentRequest({
          project,
          clip,
          model,
          audioBase64: encodePcm16WavBase64(pcm)
        });
        result = await requestCaptionAgentWithSessionRetry({
          endpoint,
          token: activeCaptionSessionToken,
          purpose: "captions",
          projectId: project.id,
          request,
          signal: controller.signal,
          onSessionToken: (nextToken) => {
            activeCaptionSessionToken = nextToken;
            elements.caption_agent_token.value = nextToken;
            setCaptionLocalStatus(
              `로컬 Whisper ${runtime.sttModel}에 다시 연결됨 · 초벌을 이어갑니다`,
              "ready"
            );
          },
          onProgress: (progress, label) => {
            const local = 0.28 + Math.max(0, Math.min(1, progress)) * 0.7;
            setAiProgress(base + span * local, `${index + 1}/${clips.length} · ${label}`);
          }
        });
        if (String(result.sttModel || "") !== runtime.sttModel) {
          throw new Error(
            "자막 실행 중 실제 STT 모델이 바뀌었습니다. 서로 다른 전사 결과를 섞지 않고 중단합니다."
          );
        }
        const normalizedDrafts = normalizeCaptionAgentCues(
          result.cues,
          clipDurationMs(clip)
        );
        speakerColors = captionSpeakerColorAssignments(
          normalizedDrafts.map((draft) => draft.remoteMeta?.speakerId),
          project.ai?.speakerColors
        );
        drafts = normalizedDrafts.map((draft) => ({
          ...draft,
          color: speakerColors[
            String(draft.remoteMeta?.speakerId || "").trim().toLowerCase()
          ] || captionSpeakerColor(draft.remoteMeta?.speakerId)
        }));
      }
      generatedCueCount += drafts.length;
      if (generatedCueCount > MAX_CAPTION_AGENT_CUES_PER_RUN) {
        throw new Error(
          `한 번에 만들 수 있는 AI 자막은 최대 ${MAX_CAPTION_AGENT_CUES_PER_RUN.toLocaleString("ko-KR")}개입니다. 활성 컷을 나눠서 실행해 주세요.`
        );
      }
      captionWarnings = mergeAiWarnings(
        captionWarnings,
        result.warnings,
        clip.id
      );
      reviewRequiredCount += drafts.filter((draft) => (
        draft.remoteMeta?.reviewRequired
      )).length;
      if (!undoRecorded) {
        pushUndo(undoSnapshot);
        undoRecorded = true;
      }
      project = {
        ...(audsegMode
          ? replaceAiBlankTimingDraft(project, clip.id, drafts)
          : replaceAiSubtitleDraft(project, clip.id, drafts)),
        ai: {
          ...project.ai,
          provider: String(result.provider || "caption-agent"),
          model,
          resolvedModel: String(result.resolvedModel || result.model || model),
          lastRequestId: String(result.requestId || ""),
          captionCheckpoints: upsertCaptionAgentCheckpoint(
            project.ai.captionCheckpoints,
            createCaptionAgentCheckpoint(clip, model, {
              requestId: String(result.requestId || ""),
              editorialContextFingerprint: trustedContextFingerprint,
              pipelineFingerprint: runtime.fingerprint
            }),
            {
              maximum: audsegMode
                ? allEnabledClips.length
                : MAX_CAPTION_AGENT_CLIPS_PER_RUN
            }
          ).map((checkpoint) => ({ ...checkpoint })),
          status: "running",
          progress: Math.min(0.99, (index + 1) / clips.length),
          error: null,
          warnings: captionWarnings,
          speakerColors
        }
      };
      await saveActiveWorkspaceImmediately();
      renderAll({ keepScroll: true });
      setAiProgress(
        base + span,
        `${index + 1}/${clips.length} · ${audsegMode ? "빈 타이밍" : "자막 초안"} 저장 완료`
      );
    }
    project = {
      ...project,
      ai: {
        ...project.ai,
        status: "done",
        progress: 1,
        lastRunAt: new Date().toISOString(),
        error: null
      }
    };
    await saveActiveWorkspaceImmediately();
    setAiProgress(
      1,
      audsegMode ? "선택 구간 빈 타이밍 초안 완료" : "선택 구간 자막 초안 완료"
    );
    const reviewWarningCount = captionWarnings.filter(
      (warning) => CAPTION_REVIEW_WARNING_CODES.has(warning.code)
    ).length;
    const draftLabel = audsegMode
      ? `AudSeg ${AUDSEG_ENGINE_VERSION} 빈 타이밍`
      : `로컬 Whisper ${runtime.sttModel} 자막`;
    showToast(
      audsegMode
        ? generatedCueCount > 0
          ? `${draftLabel} ${generatedCueCount}개를 만들었습니다. 각 빈 칸에 원음을 들으며 텍스트를 입력해 주세요.`
          : "AudSeg가 오디오 활동 구간을 찾지 못했습니다. 음성·음량을 직접 확인해 주세요."
        : reviewWarningCount > 0
        ? `${draftLabel}과 로컬 하네스 처리를 마쳤습니다. 재확인이 필요한 품질 경고 ${reviewWarningCount}건을 확인해 주세요.`
        : reviewRequiredCount > 0
        ? `${draftLabel} 초안을 만들었습니다. 재확인이 필요한 ${reviewRequiredCount}개 자막은 노란색으로 표시했습니다.`
        : captionWarnings.length > 0
          ? `${draftLabel} 초안을 만들고 키리누키 품질 하네스가 ${captionWarnings.length}건을 자동 정리했습니다.`
          : `${draftLabel} 초안을 만들었습니다. 텍스트·시간을 한 번 검수해 주세요.`,
      !audsegMode && reviewWarningCount > 0 ? "error" : "success",
      !audsegMode && reviewWarningCount > 0 ? 9000 : 6500
    );
  } catch (error: unknown) {
    const canceled = errorName(error) === "AbortError";
    const message = errorMessage(error);
    if (
      !canceled
      && /(?:STT|전사|companion|에이전트|자막 엔진|Whisper)/iu.test(message)
    ) {
      elements.caption_advanced_settings.open = true;
    }
    project = {
      ...project,
      ai: {
        ...project.ai,
        status: canceled ? "canceled" : "error",
        error: canceled ? null : message
      }
    };
    await saveActiveWorkspaceImmediately();
    elements.ai_progress.hidden = true;
    showToast(canceled ? "AI 자막 작업을 취소했습니다." : `AI 자막 실패: ${message}`, canceled ? "info" : "error", 0);
  } finally {
    activeJobController = null;
    renderCaptionModeControls();
    hideJob();
    renderAll({ keepScroll: true });
    unlockProjectMutations();
  }
}

function cancelActiveJob() {
  if (!activeJobCancelable) {
    return;
  }
  if (inFlightVodHotLoadBatch || pendingVodHotLoadBatch) {
    vodHotLoadQueueCancelRequested = true;
    latestVodHotLoadSequence += 1;
    if (pendingVodHotLoadBatch) {
      for (const resolve of pendingVodHotLoadBatch.waiters) {
        resolve(false);
      }
      pendingVodHotLoadBatch = null;
    }
  }
  const job = activeChzzkVodJob;
  if (job) {
    void cancelChzzkVodMaterialization(job).catch(() => {});
  }
  activeJobController?.abort(
    new DOMException("사용자가 작업을 취소했습니다.", "AbortError")
  );
}

function setJobCancelable(cancelable: boolean) {
  activeJobCancelable = Boolean(cancelable);
  elements.cancel_job.hidden = !activeJobCancelable;
  elements.cancel_job.disabled = !activeJobCancelable;
  if (!activeJobCancelable && document.activeElement === elements.cancel_job) {
    (elements.job_dialog.querySelector(".job-card") as EditorControl)?.focus();
  }
}

function showJob(
  title: string,
  message: string,
  progress = 0,
  {
    cancelable = true,
    returnFocus = document.activeElement as HTMLElement | null
  }: {
    cancelable?: boolean;
    returnFocus?: HTMLElement | null;
  } = {}
) {
  focusBeforeJob = returnFocus;
  elements.job_title.textContent = title;
  elements.job_message.textContent = message;
  setJobCancelable(cancelable);
  updateJob(progress);
  elements.job_dialog.hidden = false;
  if (!elements.job_dialog.open) {
    elements.job_dialog.showModal();
  }
  const focusTarget = cancelable
    ? elements.cancel_job
    : elements.job_dialog.querySelector(".job-card");
  (focusTarget! as EditorControl).focus();
}

function updateJob(progress: number, message?: string) {
  const value = Math.max(0, Math.min(1, Number(progress) || 0));
  const percent = exportProgressPercent(value);
  elements.job_percent.textContent = `${percent}%`;
  elements.job_progress.style.width = `${percent}%`;
  if (message) {
    elements.job_message.textContent = message;
  }
}

function hideJob() {
  if (elements.job_dialog.open) {
    elements.job_dialog.close();
  }
  elements.job_dialog.hidden = true;
  activeJobCancelable = false;
  if (focusBeforeJob?.isConnected) {
    focusBeforeJob.focus();
  }
  focusBeforeJob = null;
}

function sessionArchiveMediaRecovery(
  projectSnapshot: EditorProject,
  sourceMedia: EditorMediaSource
): SessionArchiveMediaRecovery {
  const materialization = projectMaterialization(projectSnapshot);
  if (materialization) {
    const rawUrl = String(
      projectSnapshot.source?.canonicalUrl
      || projectSnapshot.source?.url
      || ""
    ).trim();
    const identifiers = inferSourceIdentifiers(rawUrl);
    const canonicalUrl = canonicalSourceUrl(rawUrl, identifiers);
    if (
      !canonicalUrl
      || identifiers.contentType !== "vod"
      || identifiers.platform !== materialization.source.platform
      || identifiers.contentId !== materialization.source.contentId
    ) {
      throw new Error("백업 파일의 VOD 원본 주소와 이 기기에 준비된 영상 기록이 일치하지 않습니다.");
    }
    return normalizeSessionArchiveMediaRecovery({
      schema: MEDIA_RECOVERY_SCHEMA,
      mode: "redownload-vod",
      source: {
        platform: materialization.source.platform,
        contentType: "vod",
        contentId: materialization.source.contentId,
        canonicalUrl
      },
      localMedia: null,
      materialization: structuredClone(materialization),
      vodBytesIncluded: false
    });
  }
  if (sourceMedia instanceof File) {
    return normalizeSessionArchiveMediaRecovery({
      schema: MEDIA_RECOVERY_SCHEMA,
      mode: "reconnect-local-file",
      source: {
        platform: "LOCAL",
        contentType: "file",
        contentId: "",
        canonicalUrl: ""
      },
      localMedia: {
        name: sourceMedia.name,
        mimeType: sourceMedia.type,
        sizeBytes: sourceMedia.size,
        lastModifiedMs: sourceMedia.lastModified,
        sha256: null,
        sampleSha256: String(
          projectSnapshot.mediaAsset?.contentSampleSha256 || ""
        ) || null
      },
      materialization: null,
      vodBytesIncluded: false
    });
  }
  return normalizeSessionArchiveMediaRecovery({
    schema: MEDIA_RECOVERY_SCHEMA,
    mode: "none",
    source: null,
    localMedia: null,
    materialization: null,
    vodBytesIncluded: false
  });
}

async function createSidecars(
  baseName: string,
  rootProjectSnapshot: EditorProject,
  exportSnapshot: EditorProject,
  exportKind: ExportKind,
  sourceMedia: EditorMediaSource
): Promise<ExportSidecar[]> {
  const archive = await buildSessionArchive({
    rootProject: rootProjectSnapshot,
    exportKind,
    exportSnapshot,
    mediaRecovery: sessionArchiveMediaRecovery(rootProjectSnapshot, sourceMedia),
    resolveImageAssetBlob: (blobKey) => loadImageAssetBlob(
      rootProjectSnapshot.id,
      blobKey
    )
  });
  const archiveJson = await stringifySessionArchive(archive);
  const sidecars = [{
    name: `${baseName}.kirinuki-session.json`,
    blob: new Blob([`${archiveJson}\n`], { type: "application/json" })
  }];
  const srt = serializeSrt(exportSnapshot);
  if (srt) {
    sidecars.push({
      name: `${baseName}.ko.srt`,
      blob: new Blob([srt], { type: "application/x-subrip;charset=utf-8" })
    });
  }
  return sidecars;
}

async function writeBlobToFileHandle(
  fileHandle: FileSystemFileHandle,
  blob: Blob
) {
  const writable = await fileHandle.createWritable();
  let closed = false;
  try {
    await writable.write(blob);
    await writable.close();
    closed = true;
  } catch (error) {
    if (!closed && typeof writable.abort === "function") {
      try {
        await writable.abort(error);
      } catch {
        // Preserve the original write failure.
      }
    }
    throw error;
  }
}

async function saveSidecarsToDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  sidecars: ExportSidecar[]
): Promise<SavedExportSidecar[]> {
  const savedSidecars: SavedExportSidecar[] = [];
  for (const { blob, name } of sidecars) {
    let fileHandle: FileSystemFileHandle | null = null;
    try {
      fileHandle = await directoryHandle.getFileHandle(name, { create: true });
      if ((await fileHandle.getFile()).size > 0) {
        throw new Error(
          `${name} 파일이 이름 확인 뒤 새로 생겨 덮어쓰지 않았습니다. 다시 내보내 주세요.`
        );
      }
      await writeBlobToFileHandle(fileHandle, blob);
      savedSidecars.push({ name, blob, fileHandle });
    } catch (error) {
      let removeConfirmedEmptyEntry = false;
      if (fileHandle) {
        try {
          removeConfirmedEmptyEntry = (await fileHandle.getFile()).size === 0;
        } catch {
          // An ambiguous close may already have committed the sidecar. Preserve it.
        }
      }
      if (removeConfirmedEmptyEntry) {
        await directoryHandle.removeEntry(name).catch(() => {});
      }
      throw error;
    }
  }
  return savedSidecars;
}

async function sha256BlobHex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function verifySavedExportSidecar(
  sidecar: SavedExportSidecar
): Promise<VerifiedExportSidecar> {
  const { blob, fileHandle, name } = sidecar;
  if (blob.size <= 0) {
    throw new Error(`${name} 생성 바이트가 비어 있습니다.`);
  }
  const expectedSha256 = await sha256BlobHex(blob);
  const before = await fileHandle.getFile();
  if (before.name && before.name !== name) {
    throw new Error(`${name} 파일 핸들이 다른 파일 ${before.name}을(를) 가리킵니다.`);
  }
  if (before.size !== blob.size) {
    throw new Error(
      `${name} 저장 크기가 예상과 다릅니다: ${before.size} / ${blob.size}`
    );
  }
  const beforeSha256 = await sha256BlobHex(before);
  if (beforeSha256 !== expectedSha256) {
    throw new Error(`${name} 저장 바이트의 SHA-256이 생성한 파일과 다릅니다.`);
  }
  if (name.endsWith(".kirinuki-session.json")) {
    try {
      await parseSessionArchiveJson(await before.text());
    } catch (error: unknown) {
      throw new Error(
        `${name} 복원 무결성을 다시 검증하지 못했습니다: ${errorDetails(error)}`
      );
    }
  }
  const after = await fileHandle.getFile();
  if (
    after.size !== before.size
    || after.lastModified !== before.lastModified
  ) {
    throw new Error(`${name} 파일이 검증 중 변경되었습니다.`);
  }
  const afterSha256 = await sha256BlobHex(after);
  if (afterSha256 !== expectedSha256 || afterSha256 !== beforeSha256) {
    throw new Error(`${name} 파일이 검증 중 바뀌어 SHA-256이 일치하지 않습니다.`);
  }
  const stable = await fileHandle.getFile();
  if (
    stable.size !== after.size
    || stable.lastModified !== after.lastModified
  ) {
    throw new Error(`${name} 파일이 최종 안정성 확인 중 변경되었습니다.`);
  }
  const stableSha256 = await sha256BlobHex(stable);
  if (stableSha256 !== expectedSha256 || stableSha256 !== afterSha256) {
    throw new Error(`${name} 파일의 최종 안정성 SHA-256이 일치하지 않습니다.`);
  }
  return {
    name,
    sizeBytes: stable.size,
    sha256: stableSha256
  };
}

async function verifySavedExportSidecars(
  sidecars: SavedExportSidecar[]
): Promise<VerifiedExportSidecar[]> {
  if (sidecars.length === 0) {
    throw new Error("내보낸 세션 복원 JSON 파일 핸들이 없습니다.");
  }
  const names = new Set(sidecars.map(({ name }) => name));
  if (names.size !== sidecars.length) {
    throw new Error("내보낸 sidecar 파일명이 중복되어 전체 묶음을 검증할 수 없습니다.");
  }
  const archives = sidecars.filter(({ name }) => (
    name.endsWith(".kirinuki-session.json")
  ));
  if (archives.length !== 1) {
    throw new Error("내보낸 묶음에는 세션 복원 JSON이 정확히 하나 있어야 합니다.");
  }
  const verified: VerifiedExportSidecar[] = [];
  for (const sidecar of sidecars) {
    verified.push(await verifySavedExportSidecar(sidecar));
  }
  return verified;
}

async function directoryFileExists(
  directoryHandle: FileSystemDirectoryHandle,
  name: string
) {
  try {
    await directoryHandle.getFileHandle(name);
    return true;
  } catch (error: unknown) {
    if (errorName(error) === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

async function chooseUniqueExportBaseName(
  directoryHandle: FileSystemDirectoryHandle,
  requestedBaseName: string,
  extension: string
) {
  for (let index = 1; index <= 999; index += 1) {
    const candidate = index === 1
      ? requestedBaseName
      : `${requestedBaseName} (${index})`;
    const names = [
      `${candidate}.${extension}`,
      `${candidate}.kirinuki-session.json`,
      `${candidate}.ko.srt`
    ];
    const conflicts = await Promise.all(
      names.map((name) => directoryFileExists(directoryHandle, name))
    );
    if (conflicts.every((exists) => !exists)) {
      return candidate;
    }
  }
  throw new Error("같은 이름의 내보내기가 너무 많습니다. 출력 영상 제목을 바꿔 주세요.");
}

function sameLocalFileSnapshot(left: EditorMediaSource, right: File) {
  return (
    !isMaterializedLoopbackMediaSource(left)
    && left.name === right.name
    && left.size === right.size
    && left.lastModified === right.lastModified
  );
}

async function cleanUpFailedVideoEntry(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle,
  name: string
) {
  try {
    const file = await fileHandle.getFile();
    if (file.size > 0) {
      return {
        removed: false,
        preserved: true,
        size: file.size,
        inspectionFailed: false
      };
    }
  } catch {
    return {
      removed: false,
      preserved: true,
      size: null,
      inspectionFailed: true
    };
  }
  try {
    await directoryHandle.removeEntry(name);
    return {
      removed: true,
      preserved: false,
      size: 0,
      inspectionFailed: false
    };
  } catch {
    return {
      removed: false,
      preserved: false,
      size: 0,
      inspectionFailed: false
    };
  }
}

async function verifyCompletedExportFile(
  fileHandle: FileSystemFileHandle,
  {
    expectedDurationMs,
    expectedMimeType,
    expectedHasAudio,
    expectedWidth,
    expectedHeight
  }: {
    expectedDurationMs: number;
    expectedMimeType: string;
    expectedHasAudio: boolean;
    expectedWidth: number;
    expectedHeight: number;
  }
): Promise<{ sizeBytes: number; durationMs: number }> {
  const before = await fileHandle.getFile();
  if (before.size <= 0) {
    throw new Error("저장된 영상 파일이 비어 있습니다.");
  }
  if (
    expectedMimeType
    && before.type
    && before.type.toLowerCase() !== expectedMimeType.toLowerCase()
  ) {
    throw new Error(
      `저장된 영상 형식이 예상과 다릅니다: ${before.type} / ${expectedMimeType}`
    );
  }
  const inspected = await inspectMediaFile(before);
  if (!inspected.hasVideo || inspected.durationMs <= 0) {
    throw new Error("저장된 파일의 영상 트랙과 재생 길이를 확인하지 못했습니다.");
  }
  if (expectedHasAudio && !inspected.hasAudio) {
    throw new Error("편집본에 필요한 음성 트랙이 저장된 영상에서 누락됐습니다.");
  }
  if (
    inspected.width !== expectedWidth
    || inspected.height !== expectedHeight
  ) {
    throw new Error(
      `저장된 영상 해상도가 예상과 다릅니다: ${inspected.width || 0}×${inspected.height || 0} / ${expectedWidth}×${expectedHeight}`
    );
  }
  const durationToleranceMs = Math.max(
    250,
    Math.min(1_000, Math.round(expectedDurationMs * 0.005))
  );
  if (Math.abs(inspected.durationMs - expectedDurationMs) > durationToleranceMs) {
    throw new Error(
      `저장된 영상 길이가 편집본과 다릅니다: ${formatDuration(inspected.durationMs)} / ${formatDuration(expectedDurationMs)}`
    );
  }
  const after = await fileHandle.getFile();
  if (
    after.size !== before.size
    || after.lastModified !== before.lastModified
  ) {
    throw new Error("저장된 영상 파일이 검증 중 변경되어 임시 파일을 유지합니다.");
  }
  return {
    sizeBytes: after.size,
    durationMs: inspected.durationMs
  };
}

function sessionCleanupMarkerFromProject(
  candidateProject: EditorProject | null | undefined
): SessionCleanupMarker | null {
  const candidate = candidateProject?.sessionCleanup;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const stage = record.stage;
  const releasedBytes = Number(record.releasedBytes);
  if (
    record.schema !== SESSION_CLEANUP_SCHEMA
    || (stage !== "purge-intent" && stage !== "vod-purged")
    || record.projectId !== candidateProject?.id
    || typeof record.requestedAt !== "string"
    || !Number.isFinite(Date.parse(record.requestedAt))
    || typeof record.updatedAt !== "string"
    || !Number.isFinite(Date.parse(record.updatedAt))
    || typeof record.mediaUrl !== "string"
    || !isSafeSessionCleanupMediaUrl(
      record.mediaUrl,
      KIRINUKI_MEDIA_ENGINE_ENDPOINT
    )
    || typeof record.platform !== "string"
    || !record.platform
    || typeof record.contentId !== "string"
    || !record.contentId
    || (record.sourceVersionId !== undefined
      && (typeof record.sourceVersionId !== "string"
        || !/^[a-f0-9]{64}$/u.test(record.sourceVersionId)))
    || typeof record.materializationId !== "string"
    || !record.materializationId
    || typeof record.planFingerprint !== "string"
    || !record.planFingerprint
    || !Number.isSafeInteger(releasedBytes)
    || releasedBytes < 0
  ) {
    return null;
  }
  return {
    schema: SESSION_CLEANUP_SCHEMA,
    stage,
    projectId: candidateProject.id,
    requestedAt: record.requestedAt,
    updatedAt: record.updatedAt,
    mediaUrl: record.mediaUrl,
    platform: record.platform,
    contentId: record.contentId,
    sourceVersionId: typeof record.sourceVersionId === "string"
      ? record.sourceVersionId
      : "",
    materializationId: record.materializationId,
    planFingerprint: record.planFingerprint,
    releasedBytes
  };
}

function projectWithoutSessionCleanupMarker(
  candidateProject: EditorProject
): EditorProject {
  const cleaned = cloneProject(candidateProject);
  delete cleaned.sessionCleanup;
  if (cleaned.mediaAsset) {
    delete cleaned.mediaAsset.sessionCleanupMediaUrl;
  }
  return cleaned;
}

async function retrySessionCleanupStoreOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown = new Error("세션 정리 저장을 시작하지 못했습니다.");
  for (const delayMs of [0, 60, 180]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function reconcileInterruptedSessionCleanup(
  candidateProject: EditorProject
): Promise<EditorProject> {
  const marker = sessionCleanupMarkerFromProject(candidateProject);
  if (!marker) {
    return candidateProject;
  }
  const cleanProject = projectWithoutSessionCleanupMarker(candidateProject);
  if (marker.stage === "purge-intent") {
    // The power may have failed on either side of the internal engine request. Keep
    // the media binding and let the normal exact-materialization restore path
    // verify/rebuild it; never guess that an external deletion completed.
    await retrySessionCleanupStoreOperation(() => (
      queueCurrentProjectSessionWrite(() => saveProject(cleanProject))
    ));
    startupCleanupRecoveryNotice =
      "이전 종료가 이 세션의 VOD 작업 재료 정리 도중 발생했습니다. 원본 연결을 검증하고 필요하면 세션 전용 재료를 다시 준비합니다.";
    return cleanProject;
  }
  if (!sessionCleanupMarkerMatchesMaterializedBinding(
    marker,
    candidateProject.mediaAsset,
    KIRINUKI_MEDIA_ENGINE_ENDPOINT
  )) {
    // A stale/corrupt marker must never detach a newer materialization or a
    // manually connected file. Clear only the transient marker URL and keep
    // every current media/cache binding for the normal exact restore path.
    await retrySessionCleanupStoreOperation(() => (
      queueCurrentProjectSessionWrite(() => saveProject(cleanProject))
    ));
    startupCleanupRecoveryNotice =
      "이전 세션 정리 표식이 현재 VOD 작업 범위와 정확히 일치하지 않아 아무 파일도 지우지 않았습니다. 현재 원본 연결을 다시 검증합니다.";
    return cleanProject;
  }
  const detachedProject = {
    ...cleanProject,
    mediaAsset: null,
    updatedAt: new Date().toISOString()
  };
  const browserCleanup = await retrySessionCleanupStoreOperation(() => (
    queueCurrentProjectSessionWrite(() => (
      deleteProjectSessionAtomically(candidateProject.id)
    ))
  ));
  startupCompletedSessionCleanup = {
    browser: browserCleanup,
    releasedBytes: marker.releasedBytes
  };
  startupCleanupRecoveryNotice =
    "이전 종료 전에 이 세션의 VOD 작업 재료 삭제가 끝난 것을 확인해 브라우저 편집 세션 정리도 마무리했습니다.";
  return detachedProject;
}

async function cleanupCompletedExportSessionCaches(
  exportedRootProject: EditorProject
): Promise<{
  browser: ProjectSessionDeletionCounts;
  releasedVodBytes: number;
  releasedVodFiles: number;
  runtimeCleanupWarning: string;
}> {
  await cancelAndWaitForShortPreviewCacheOperation();
  const sourceMedia = mediaFile;
  const sourceMediaUrl = mediaUrl;
  const materialization = projectMaterialization(exportedRootProject);
  const sourceVersionId = String(
    materialization?.source.sourceVersionId || ""
  );
  const cleanupVodToken = vodMediaEngineToken;
  let releasedVodBytes = 0;
  let releasedVodFiles = 0;
  let materializedSessionWasPurged = false;

  if (isMaterializedLoopbackMediaSource(sourceMedia)) {
    if (
      !materialization
      || materialization.schema !== CHZZK_VOD_MATERIALIZATION_SCHEMA
      || !/^[a-f0-9]{64}$/u.test(sourceVersionId)
    ) {
      throw new Error("현재 연결된 편집용 VOD의 정확한 준비 기록을 확인하지 못해 영상을 삭제하지 않았습니다.");
    }
    if (!cleanupVodToken) {
      throw new Error("현재 Kirinuki 내부 미디어 엔진의 접근 정보가 없어 이번 편집용 VOD를 삭제하지 않았습니다.");
    }
  }

  // Commit the exact export snapshot behind every older queued writer before
  // invalidating this session generation. Preconditions and this barrier can
  // fail without discarding the latest durable CURRENT.
  discardPendingProjectSave();
  await queueCurrentProjectSessionWrite(() => saveProject(
    exportedRootProject
  ));
  advanceProjectSessionGeneration();

  if (isMaterializedLoopbackMediaSource(sourceMedia)) {
    // The precondition above established this before the durable barrier; keep
    // the explicit guard so TypeScript and future refactors preserve it.
    if (!materialization) {
      throw new Error("저장을 마친 뒤 VOD 준비 기록을 유지하지 못했습니다.");
    }
    const now = new Date().toISOString();
    const intentMarker: SessionCleanupMarker = {
      schema: SESSION_CLEANUP_SCHEMA,
      stage: "purge-intent",
      projectId: exportedRootProject.id,
      requestedAt: now,
      updatedAt: now,
      mediaUrl: sourceMedia.url,
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId,
      materializationId: materialization.materializationId,
      planFingerprint: materialization.planFingerprint,
      releasedBytes: 0
    };
    const intentProject = {
      ...cloneProject(exportedRootProject),
      mediaAsset: exportedRootProject.mediaAsset
        ? {
          ...cloneProject(exportedRootProject.mediaAsset),
          // This access-bearing URL exists only beside the cleanup marker so
          // crash recovery can prove byte-for-byte binding equality. It is
          // removed together with the marker on every recovery path.
          sessionCleanupMediaUrl: sourceMedia.url
        }
        : null,
      sessionCleanup: intentMarker,
      updatedAt: now
    };
    await retrySessionCleanupStoreOperation(() => (
      queueCurrentProjectSessionWrite(() => saveProject(intentProject))
    ));
    stopShortCanvasPlayback();
    stopPreviewAudioClock({ sync: false });
    releaseShortPreviewSourceAudio();
    releaseShortPreviewLayerVideos();
    cancelPreviewPreload({ clearSource: true });
    elements.preview_video.pause();
    elements.preview_video.removeAttribute("src");
    elements.preview_video.load();
    // Let Chromium dispatch aborts for outstanding range requests before the
    // The internal engine checks that no decoder is still reading this artifact.
    await Promise.resolve();
    let purge;
    try {
      purge = await purgeChzzkVodConsumerSessionCache({
        endpoint: KIRINUKI_MEDIA_ENGINE_ENDPOINT,
        token: cleanupVodToken,
        consumerId: exportedRootProject.id,
        mediaUrl: sourceMedia.url,
        materialization
      });
    } catch (error) {
      let markerCleanupError: unknown = null;
      try {
        await retrySessionCleanupStoreOperation(() => (
          queueCurrentProjectSessionWrite(() => saveProject(
            projectWithoutSessionCleanupMarker(intentProject)
          ))
        ));
      } catch (cleanupError) {
        markerCleanupError = cleanupError;
      }
      if (sourceMediaUrl) {
        await loadPreviewMediaUrl(sourceMedia, sourceMediaUrl).catch(
          (restoreError) => console.warn(
            "VOD 정리 실패 뒤 미리보기 연결도 복구하지 못했습니다.",
            restoreError
          )
        );
      }
      if (markerCleanupError) {
        throw new Error(
          `VOD 삭제 요청과 정리 표식 복구가 모두 실패했습니다: ${errorDetails(error)} / ${errorDetails(markerCleanupError)}`
        );
      }
      throw error;
    }
    releasedVodBytes = purge.releasedBytes;
    releasedVodFiles = purge.releasedFiles;
    materializedSessionWasPurged = true;
    const purgedAt = new Date().toISOString();
    const purgedMarker: SessionCleanupMarker = {
      ...intentMarker,
      stage: "vod-purged",
      updatedAt: purgedAt,
      releasedBytes: releasedVodBytes
    };
    // Once the external file is gone, persist that fact before clearing the
    // local binding. A crash between these two commits is completed safely on
    // the next startup instead of reopening a stale loopback URL.
    try {
      await retrySessionCleanupStoreOperation(() => (
        queueCurrentProjectSessionWrite(() => saveProject({
          ...intentProject,
          sessionCleanup: purgedMarker,
          updatedAt: purgedAt
        }))
      ));
    } catch (error) {
      // The final atomic detach below is still stronger than leaving a deleted
      // loopback URL active. If it also fails, the already durable intent
      // marker makes startup take the conservative exact-restore path.
      console.warn("VOD 삭제 완료 표식을 별도로 저장하지 못했습니다.", error);
    }
  }

  stopLocalDraftAutosave();
  localDraftAutosaveAnchorAtMs = 0;
  editorSessionCompleted = true;
  discardPendingProjectSave();
  advanceProjectSessionGeneration();
  let browserCleanup: ProjectSessionDeletionCounts;
  try {
    await localDraftOperationQueue.catch(() => undefined);
    browserCleanup = await retrySessionCleanupStoreOperation(() => (
      queueCurrentProjectSessionWrite(() => (
        deleteProjectSessionAtomically(exportedRootProject.id)
      ))
    ));
  } catch (error: unknown) {
    editorSessionCompleted = false;
    startLocalDraftAutosave();
    releaseShortPreviewAssetCaches();
    releaseShortPreviewLayerVideos();
    shortPreviewCacheError = "";
    if (materializedSessionWasPurged) {
      const detachedProject = {
        ...projectWithoutSessionCleanupMarker(exportedRootProject),
        mediaAsset: null,
        updatedAt: new Date().toISOString()
      };
      releaseMediaUrl(sourceMedia, sourceMediaUrl);
      mediaFile = null!;
      mediaUrl = null;
      mediaHandle = null;
      rootProject = cloneProject(detachedProject);
      project = workspaceMode === "short-form"
        ? {
          ...project,
          mediaAsset: null,
          updatedAt: detachedProject.updatedAt
        }
        : cloneProject(detachedProject);
    }
    renderAll();
    throw new Error(
      materializedSessionWasPurged
        ? `이 세션의 VOD 재료는 삭제했지만 브라우저 편집 세션 정리를 완료하지 못했습니다. 다음 실행에서 삭제 완료 표식 또는 정확한 원본 상태를 확인해 복구합니다: ${errorDetails(error)}`
        : `브라우저 편집 세션을 원자적으로 정리하지 못해 현재 편집과 원본 파일 연결을 모두 유지했습니다: ${errorDetails(error)}`
    );
  }
  // Atomic export cleanup owns every browser-side record for this project,
  // including the entry checkpoint. Do not leave the UI claiming that a
  // checkpoint still exists after that transaction succeeds.
  editingSessionCheckpointActive = false;
  editingSessionCheckpointId = "";

  stopShortCanvasPlayback({ keepCurrentTime: false });
  stopPreviewPlaybackClock();
  stopPreviewAudioClock({ sync: false });
  cancelPreviewPreload({ clearSource: true });
  elements.preview_video.pause();
  elements.preview_video.removeAttribute("src");
  elements.preview_video.load();
  releaseShortPreviewSourceAudio();
  releaseShortPreviewAssetCaches();
  releaseShortPreviewLayerVideos();
  releaseAllImageAssetObjectUrls();
  releaseMediaUrl(sourceMedia, sourceMediaUrl);
  cancelScheduledShortWorkspacePreview();
  releaseShortPreviewAdaptiveScaler();
  releaseShortPreviewFallbackSurface();
  clearTimeout(imageAssetPruneTimer ?? undefined);
  imageAssetPruneTimer = null;
  stopDevReloadObserver();
  mediaFile = null!;
  mediaUrl = null;
  mediaHandle = null;
  undoStack = [];
  redoStack = [];
  mainWorkspaceUndoStack = [];
  mainWorkspaceRedoStack = [];
  fieldEditSession = null;
  shortPreviewCacheError = "";
  advanceProjectSessionGeneration();

  let runtimeCleanupWarning = "";
  const activePolicy = usagePolicySession;
  if (!activePolicy || activePolicy.projectId !== exportedRootProject.id) {
    runtimeCleanupWarning = "브라우저의 원본 연결 세션을 확인하지 못했습니다.";
  } else {
    try {
      const response = await completeStudioEditorSession({
        projectId: exportedRootProject.id,
        sourceSessionId: activePolicy.sourceSessionId,
        ...(activePolicy.sessionLeaseId
          ? {
            sessionLeaseId: activePolicy.sessionLeaseId,
            transitionGeneration: activePolicy.transitionGeneration
          }
          : {})
      });
      if (
        response?.ok !== true
        || response.projectId !== exportedRootProject.id
      ) {
        throw new Error(
          String(response?.error || "브라우저가 이번 편집의 완료 상태를 확인하지 못했습니다.")
        );
      }
    } catch (error: unknown) {
      runtimeCleanupWarning = errorDetails(error);
    }
  }
  usagePolicySession = null;
  clearUsagePolicyExpiryTimer();

  const deletedBrowserRecords = (
    browserCleanup.deletedProjectCount
    + browserCleanup.deletedLocalDraftCount
    + browserCleanup.deletedImageAssetCount
    + browserCleanup.deletedShortVideoCacheCount
    + browserCleanup.deletedMediaHandleCount
    + browserCleanup.deletedEditingSessionCheckpointCount
  );
  elements.session_completed_summary.textContent = (
    `내보낸 영상과 편집 복원 파일은 그대로 보존했습니다. 이 작업의 기기 내 데이터 ${deletedBrowserRecords}건`
    + (releasedVodFiles > 0
      ? `과 VOD 작업 파일 ${releasedVodFiles.toLocaleString("ko-KR")}개(${formatFileSize(releasedVodBytes)})`
      : "")
    + "만 삭제했습니다."
    + (runtimeCleanupWarning
      ? ` 남은 연결 정보는 브라우저를 닫을 때 다시 정리합니다: ${runtimeCleanupWarning}`
      : "")
  );
  if (!elements.session_completed_dialog.open) {
    elements.session_completed_dialog.showModal();
  }
  elements.close_completed_editor.focus({ preventScroll: true });
  return {
    browser: browserCleanup,
    releasedVodBytes,
    releasedVodFiles,
    runtimeCleanupWarning
  };
}

async function exportVideo(
  exportKind: ExportKind = "main",
  {
    preparedDirectoryHandle,
    destinationSelectionHandled = false,
    outputTitle = ""
  }: {
    preparedDirectoryHandle?: FileSystemDirectoryHandle | null;
    destinationSelectionHandled?: boolean;
    outputTitle?: string;
  } = {}
) {
  const isShortForm = exportKind === "short-form";
  if (!mediaFile) {
    showToast(
      chzzkVodSourceUrl()
        ? `먼저 ${sourcePlatformLabel(project.source?.platform)} 편집 영상을 준비해 주세요.`
        : "먼저 내 영상 파일을 직접 연결해 주세요.",
      "error"
    );
    return;
  }
  let selectedOutputProject: EditorProject;
  try {
    selectedOutputProject = isShortForm
      ? workspaceMode === "short-form"
        ? project
        : deriveShortFormRenderProject(project)
      : project;
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  if (!selectedOutputProject.clips.some((clip) => clip.enabled !== false)) {
    showToast("내보낼 사용자 선택 구간이 없습니다.", "error");
    return;
  }
  if (findSubtitleOverlaps(selectedOutputProject).length > 0) {
    showToast("같은 레인 안에서 겹치는 자막이 있습니다. 자막 시각을 먼저 조정해 주세요.", "error", 0);
    return;
  }
  if (findAudioRegionOverlaps(selectedOutputProject).length > 0) {
    showToast("서로 겹치는 음성 설정 구간이 있습니다. 구간 시각을 먼저 조정해 주세요.", "error", 0);
    return;
  }
  if (activeJobController || projectMutationLockCount > 0) {
    showToast("다른 미디어 작업이 끝난 뒤 다시 시도해 주세요.", "error");
    return;
  }

  lockProjectMutations();
  try {
    let safetyDraftSaved = false;
    const saveSafetyDraft = async () => {
      try {
        await queueLocalDraftOperation(async () => {
          await saveCurrentLocalDraft("manual");
          await flushSave();
          await waitForProjectSaves();
        });
        safetyDraftSaved = true;
        return true;
      } catch (error: unknown) {
        showToast(
          `내보내기 전 안전 백업에 실패해 작업을 중단했습니다: ${errorDetails(error)}`,
          "error",
          0
        );
        return false;
      }
    };

    let directoryHandle = preparedDirectoryHandle ?? null;
    if (
      !destinationSelectionHandled
      && typeof window.showDirectoryPicker === "function"
    ) {
      try {
        // This must be the first awaited browser API after the click. Large
        // media probes can outlive Chromium's transient user activation.
        directoryHandle = await window.showDirectoryPicker({
          id: "chzzk-kirinuki-export",
          mode: "readwrite"
        });
      } catch (error: unknown) {
        if (errorName(error) === "AbortError") {
          return;
        }
        showToast(
          `저장 폴더를 열지 못했습니다: ${errorDetails(error)}`,
          "error",
          0
        );
        return;
      }
    }
    if (!directoryHandle) {
      showToast(
        "이 브라우저는 영상과 편집 복원 파일을 같은 폴더에 안전하게 저장하는 기능을 지원하지 않습니다. Chromium 기반 최신 브라우저에서 다시 시도해 주세요.",
        "error",
        0
      );
      return;
    }
    await cancelAndWaitForShortPreviewCacheOperation();
    if (!await saveSafetyDraft()) {
      return;
    }

    let exportMediaFile = mediaFile;
    if (mediaHandle) {
      try {
        const refreshedFile = await mediaHandle.getFile();
        if (!sameLocalFileSnapshot(mediaFile, refreshedFile)) {
          showToast(
            "원본 파일이 연결 후 변경되었습니다. 잘못된 구간을 내보내지 않도록 중단했습니다. ‘내 파일 직접 연결’에서 현재 파일을 다시 확인해 주세요.",
            "error",
            0
          );
          return;
        }
        exportMediaFile = refreshedFile;
      } catch (error: unknown) {
        showToast(
          `원본 파일을 내보내기 직전에 다시 확인하지 못했습니다: ${errorDetails(error)}. ‘내 파일 직접 연결’에서 파일 권한을 확인해 주세요.`,
          "error",
          0
        );
        return;
      }
    }

    if (document.fonts?.load) {
      try {
        const family = String(
          selectedOutputProject.subtitleDefaults?.fontFamily || "Pretendard"
        ).replace(/["\\]/gu, "");
        const weight = Math.round(
          Number(selectedOutputProject.subtitleDefaults?.fontWeight) || 800
        );
        await document.fonts.load(`${weight} 48px "${family}"`);
      } catch (error: unknown) {
        showToast(`자막 폰트를 준비하지 못했습니다: ${errorMessage(error)}`, "error", 0);
        return;
      }
    }
    const rootExportProject = persistedProjectSnapshot();
    const exportProject = cloneProject(project);
    let outputProject: EditorProject;
    try {
      outputProject = isShortForm
        ? {
          ...(workspaceMode === "short-form"
            ? exportProject
            : deriveShortFormRenderProject(exportProject)),
          name: `${exportProject.name.replace(/\s+쇼츠$/u, "")} 쇼츠`
        }
        : exportProject;
    } catch (error: unknown) {
      showToast(errorMessage(error), "error", 0);
      return;
    }
    let renderProject: EditorProject;
    try {
      renderProject = projectForMediaEngine(outputProject);
    } catch (error: unknown) {
      showToast(errorMessage(error), "error", 0);
      return;
    }
    const renderLayout = isShortForm
      ? {
        kind: "short-form" as const,
        durationMs: renderProject.shortForm.durationMs,
        videoLaneCount: renderProject.shortForm.videoLaneCount,
        videoAssets: renderProject.shortForm.videoAssets,
        sourceAudioAssets: renderProject.shortForm.sourceAudioAssets
      }
      : null;
    let profile;
    try {
      profile = await getPreferredOutputProfile(exportMediaFile, renderProject, {
        layout: renderLayout
      });
    } catch (error: unknown) {
      showToast(`이 브라우저에서 영상 인코더를 준비하지 못했습니다: ${errorMessage(error)}`, "error", 0);
      return;
    }

    const fallbackOutputTitle = isShortForm
      ? `${exportProject.name.replace(/\s+쇼츠$/u, "")} 쇼츠`
      : exportProject.name;
    let baseName = sanitizeFileName(outputTitle || fallbackOutputTitle);
    let videoName = `${baseName}.${profile.extension}`;
    let handle: FileSystemFileHandle | null = null;
    let directoryVideoCreated = false;
    try {
      baseName = await chooseUniqueExportBaseName(
        directoryHandle,
        baseName,
        profile.extension
      );
      videoName = `${baseName}.${profile.extension}`;
    } catch (error: unknown) {
      if (errorName(error) === "AbortError") {
        return;
      }
      showToast(
        `저장 폴더를 확인하지 못했습니다: ${errorDetails(error)}`,
        "error",
        0
      );
      return;
    }

    if (!safetyDraftSaved && !await saveSafetyDraft()) {
      return;
    }

    let sidecars: ExportSidecar[];
    try {
      sidecars = await createSidecars(
        baseName,
        rootExportProject,
        outputProject,
        exportKind,
        exportMediaFile
      );
    } catch (error: unknown) {
      showToast(
        `다시 편집할 때 필요한 복원 파일을 만들지 못해 내보내기를 중단했습니다: ${errorDetails(error)}`,
        "error",
        0
      );
      return;
    }

    try {
      handle = await directoryHandle.getFileHandle(videoName, { create: true });
      if ((await handle.getFile()).size > 0) {
        handle = null;
        throw new Error(
          `${videoName} 파일이 이름 확인 뒤 새로 생겨 덮어쓰지 않았습니다. 다시 내보내 주세요.`
        );
      }
      directoryVideoCreated = true;
    } catch (error: unknown) {
      showToast(
        `영상 출력 파일을 만들지 못했습니다: ${errorDetails(error)}`,
        "error",
        0
      );
      return;
    }

    const controller = new AbortController();
    activeJobController = controller;
    elements.export_video.disabled = true;
    let renderCompleted = false;
    const exportState: {
      stage: "render" | "finalize" | "sidecars";
    } = { stage: "render" };
    let compatibilityRendererRestarted = false;
    try {
      showJob(
        isShortForm
          ? "선택 장면을 세로 쇼츠로 만드는 중"
          : "컷과 자막을 영상으로 만드는 중",
        isMaterializedLoopbackMediaSource(exportMediaFile)
          ? `준비된 편집 영상에 ${isShortForm ? "세로 화면 배치·" : ""}컷·이미지·자막을 합치고 있습니다.`
          : `직접 연결한 영상에 ${isShortForm ? "세로 화면 배치·" : ""}컷·이미지·자막을 합치고 있습니다.`,
        0,
        { cancelable: true }
      );
      const result = await renderProjectVideo(exportMediaFile, renderProject, {
        fileHandle: handle,
        layout: renderLayout,
        signal: controller.signal,
        resolveImageAsset: (source) => loadImageAssetBlob(exportProject.id, source.value),
        onProgress: (progress, stage) => {
          if (stage === SHORT_FORM_FALLBACK_RESTART_PHASE) {
            compatibilityRendererRestarted = true;
            exportState.stage = "render";
            setJobCancelable(true);
            updateJob(0, "호환 렌더러로 처음부터 다시 처리");
            return;
          }
          const label = stage === "finalize"
            ? "파일을 마무리하는 중 · 이 단계는 취소할 수 없습니다"
            : compatibilityRendererRestarted
              ? "호환 렌더러로 처음부터 다시 처리"
              : "컷 연결과 자막 합성 중";
          if (stage === "finalize") {
            exportState.stage = "finalize";
            setJobCancelable(false);
          }
          updateJob(progress, label);
        }
      });
      if (result.blob) {
        throw new Error(
          "폴더 출력 핸들을 전달했지만 영상이 폴더 파일 대신 메모리에 생성되어 내보내기를 완료하지 않았습니다."
        );
      }
      renderCompleted = true;
      exportState.stage = "sidecars";
      const savedSidecars = await saveSidecarsToDirectory(
        directoryHandle,
        sidecars
      );
      let verifiedOutput: VerifiedExportBundle | null = null;
      let verificationFailure = "";
      const videoVerificationOptions = {
        expectedDurationMs: projectDurationMs(renderProject),
        expectedMimeType: result.mimeType,
        expectedHasAudio: result.audioCodec !== null,
        expectedWidth: result.width,
        expectedHeight: result.height
      };
      try {
        if (!handle) {
          throw new Error("저장된 영상 파일 핸들이 없어 묶음을 검증할 수 없습니다.");
        }
        updateJob(1, "저장된 영상 트랙·길이·파일 크기 검증 중");
        const verifiedVideo = await verifyCompletedExportFile(
          handle,
          videoVerificationOptions
        );
        updateJob(1, "편집 복원 파일과 자막 파일이 제대로 저장됐는지 확인하는 중");
        const verifiedSidecars = await verifySavedExportSidecars(savedSidecars);
        verifiedOutput = {
          ...verifiedVideo,
          sidecars: verifiedSidecars
        };
      } catch (error: unknown) {
        verificationFailure = errorDetails(error);
      }
      let cleanupMessage = "";
      let cleanupFailure = "";
      hideJob();
      if (verifiedOutput) {
        const sidecarBytes = verifiedOutput.sidecars.reduce(
          (sum, sidecar) => sum + sidecar.sizeBytes,
          0
        );
        const shouldCleanup = await askExportSessionCleanup(
          `${isShortForm ? "쇼츠 영상" : "영상"} ${formatFileSize(verifiedOutput.sizeBytes)}와 편집 복원 파일${sidecars.length > 1 ? "·자막 파일" : ""} ${formatFileSize(sidecarBytes)}이 제대로 저장됐는지 확인했습니다.`
        );
        if (shouldCleanup) {
          try {
            showJob(
              "임시 자료를 지우기 전에 저장 파일을 다시 확인하는 중",
              "확인창이 열린 동안 영상·편집 복원 파일·자막 파일이 바뀌지 않았는지 다시 확인합니다.",
              0.2,
              { cancelable: false }
            );
            const reverifiedVideo = await verifyCompletedExportFile(
              handle,
              videoVerificationOptions
            );
            const reverifiedSidecars = await verifySavedExportSidecars(
              savedSidecars
            );
            if (
              reverifiedVideo.sizeBytes !== verifiedOutput.sizeBytes
              || JSON.stringify(reverifiedSidecars) !== JSON.stringify(
                verifiedOutput.sidecars
              )
            ) {
              throw new Error(
                "임시 자료를 지우기 직전에 저장 파일이 달라져 아무 자료도 삭제하지 않았습니다."
              );
            }
            if (await countSameProjectEditorTabs() > 1) {
              throw new Error(
                "같은 편집 작업이 다른 탭에도 열려 있어 아무 자료도 삭제하지 않았습니다. 다른 탭을 닫고 다시 내보내거나 임시 파일을 유지해 주세요."
              );
            }
            showJob(
              "현재 편집 작업의 임시 자료를 정리하는 중",
              "이 작업에만 속한 VOD 구간·저장본·이미지·미리보기인지 확인한 뒤 정리합니다.",
              0.3,
              { cancelable: false }
            );
            const cleanup = await cleanupCompletedExportSessionCaches(
              rootExportProject
            );
            const browserRecordCount = (
              cleanup.browser.deletedProjectCount
              + cleanup.browser.deletedLocalDraftCount
              + cleanup.browser.deletedImageAssetCount
              + cleanup.browser.deletedShortVideoCacheCount
              + cleanup.browser.deletedMediaHandleCount
              + cleanup.browser.deletedEditingSessionCheckpointCount
            );
            cleanupMessage = (
              ` 현재 편집 작업을 완료하고 기기 내 기록 ${browserRecordCount}건`
              + (cleanup.releasedVodFiles > 0
                ? `과 VOD 작업 파일 ${cleanup.releasedVodFiles.toLocaleString("ko-KR")}개(${formatFileSize(cleanup.releasedVodBytes)})`
                : "")
              + "를 정리했습니다."
              + (cleanup.runtimeCleanupWarning
                ? " 남은 연결 정보는 브라우저를 닫을 때 한 번 더 정리됩니다."
                : "")
            );
          } catch (error: unknown) {
            cleanupFailure = errorDetails(error);
          } finally {
            hideJob();
          }
        }
      }
      if (!verifiedOutput) {
        showToast(
          `${isShortForm ? "쇼츠 영상" : "영상"}과 복원 파일은 보존했지만 저장 완료를 확인하지 못해 임시 자료를 모두 유지했습니다: ${verificationFailure || "확인 결과가 없습니다."}`,
          "error",
          0
        );
      } else if (cleanupFailure) {
        showToast(
          `${isShortForm ? "쇼츠 영상" : "영상"}과 편집 복원 파일은 안전하게 저장했지만 임시 자료는 정리하지 못했습니다: ${cleanupFailure}`,
          "error",
          0
        );
      } else {
        showToast(
          `${isShortForm ? "쇼츠 영상" : "영상"}과 편집 복원 파일${sidecars.length > 1 ? "·자막 파일" : ""}을 확인해 선택한 폴더에 저장했습니다.${cleanupMessage}`,
          "success",
          7000
        );
      }
    } catch (error: unknown) {
      let preservedOutput = false;
      let preservedOutputInspectionFailed = false;
      let cleanupFailed = false;
      if (
        handle
        && directoryVideoCreated
        && !renderCompleted
      ) {
        const cleanup = await cleanUpFailedVideoEntry(
          directoryHandle,
          handle,
          videoName
        );
        directoryVideoCreated = !cleanup.removed;
        preservedOutput = cleanup.preserved;
        preservedOutputInspectionFailed = cleanup.inspectionFailed;
        cleanupFailed = !cleanup.removed && !cleanup.preserved;
      }
      hideJob();
      const canceled = errorName(error) === "AbortError";
      const message = errorDetails(error);
      const cleanupMessage = cleanupFailed
        ? " 생성된 빈 영상 파일은 지우지 못했습니다."
        : preservedOutputInspectionFailed
          ? ` 오류 뒤 상태를 확정할 수 없는 ${videoName} 파일은 안전을 위해 지우지 않았습니다.`
          : preservedOutput
            ? ` 오류 전에 기록된 ${videoName} 파일은 복구 가능성을 위해 지우지 않았습니다.`
            : "";
      const failurePrefix = exportState.stage === "finalize"
        ? "영상 파일 마무리 실패"
        : "영상 내보내기 실패";
      showToast(
        canceled
          ? `영상 내보내기를 취소했습니다.${cleanupMessage}`
          : renderCompleted
            ? `영상은 보존했지만 편집 복원 파일·자막 파일을 저장하거나 확인하지 못했습니다: ${message}. 임시 자료는 유지했습니다.`
            : `${failurePrefix}: ${message}.${cleanupMessage} 현재 편집은 내보내기 직전 저장본에 보존돼 있습니다.`,
        canceled && !cleanupFailed ? "info" : "error",
        0
      );
    } finally {
      activeJobController = null;
      elements.export_video.disabled = false;
      renderHeader();
    }
  } finally {
    unlockProjectMutations();
    if (!editorSessionCompleted && workspaceMode === "short-form") {
      scheduleShortPreviewCacheRepair();
    }
  }
}

async function exportVideoWithLock(
  exportKind: ExportKind = "main",
  outputTitle = ""
) {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  if (exportRequestPending) {
    showToast("영상 내보내기 요청이 이미 진행 중입니다.", "error");
    return;
  }
  if (typeof window.showDirectoryPicker !== "function") {
    showToast(
      "이 브라우저는 영상과 편집 복원 파일을 같은 폴더에 안전하게 저장하는 기능을 지원하지 않습니다. Chromium 기반 최신 브라우저에서 다시 시도해 주세요.",
      "error",
      0
    );
    return;
  }
  exportRequestPending = true;
  try {
    let preparedDirectoryHandle: FileSystemDirectoryHandle | null = null;
    const destinationSelectionHandled = true;
    try {
      // Keep this as the first awaited browser API in the confirm-click
      // chain. Waiting for Web Locks first would consume user activation.
      preparedDirectoryHandle = await window.showDirectoryPicker({
        id: "chzzk-kirinuki-export",
        mode: "readwrite"
      });
    } catch (error: unknown) {
      if (errorName(error) === "AbortError") {
        return;
      }
      showToast(
        `저장 폴더를 열지 못했습니다: ${errorDetails(error)}`,
        "error",
        0
      );
      return;
    }
    const options = {
      preparedDirectoryHandle,
      destinationSelectionHandled,
      outputTitle
    };
    if (!navigator.locks?.request) {
      return await exportVideo(exportKind, options);
    }
    return await navigator.locks.request(
      EXPORT_LOCK_NAME,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (!lock) {
          showToast(
            "다른 편집기 탭에서 이미 영상을 내보내고 있습니다. 그 작업이 끝난 뒤 다시 눌러 주세요.",
            "error",
            0
          );
          return;
        }
        return exportVideo(exportKind, options);
      }
    );
  } finally {
    exportRequestPending = false;
  }
}

function closeExportOptionsDialog(): void {
  if (elements.export_options_dialog.open) {
    elements.export_options_dialog.close();
  }
  pendingExportOptionsKind = null;
  pendingExportOptionsProjectFingerprint = "";
  if (focusBeforeExportOptions?.isConnected) {
    focusBeforeExportOptions.focus({ preventScroll: true });
  }
  focusBeforeExportOptions = null;
}

function exportOptionsProjectFingerprint(exportKind: ExportKind): string {
  // shortFormBranchFromWorkspace deliberately advances its persistence
  // revision. A confirmation fingerprint must be a pure read or every click
  // changes the value it is trying to confirm and short-form export can never
  // reach the directory picker.
  return JSON.stringify(
    exportKind === "short-form"
      ? {
        workspaceId: currentShortWorkspaceId(),
        shortForm: project.shortForm
      }
      : persistedProjectSnapshot()
  );
}

function renderExportOptionsPreflight(exportKind: ExportKind): void {
  const edgeFindings = exportKind === "short-form"
    ? detectShortFormCompositeCanvasGaps(project.shortForm)
    : [];
  elements.export_edge_gap_warning.hidden = edgeFindings.length === 0;
  elements.export_edge_gap_summary.textContent = edgeFindings.length > 0
    ? `최종 합성 화면의 ${edgeFindings.length}개 시간 구간에서 1–24px 외곽 틈·영상 사이 seam을 감지했습니다. 취소한 뒤 영상 탭의 밀대 도구를 쓰거나, 의도한 여백이면 그대로 내보낼 수 있습니다.`
    : "밀대 도구로 확인할 수 있습니다.";
}

function suggestedExportOutputTitle(exportKind: ExportKind): string {
  const projectTitle = String(project.name || "").normalize("NFKC").trim();
  const sourceTitle = String(project.source?.broadcastTitle || "")
    .normalize("NFKC")
    .trim();
  const baseTitle = (
    projectTitle && projectTitle !== "키리누키 프로젝트"
      ? projectTitle
      : sourceTitle || projectTitle || "kirinuki"
  ).replace(/\s+쇼츠$/u, "");
  return exportKind === "short-form" ? `${baseTitle} 쇼츠` : baseTitle;
}

function renderExportOutputTitle(): string | null {
  const rawTitle = elements.export_file_title.value.normalize("NFKC").trim();
  const valid = rawTitle.length > 0;
  elements.export_file_title.setAttribute("aria-invalid", String(!valid));
  elements.confirm_export_options.disabled = !valid;
  if (!valid) {
    elements.export_file_name_preview.textContent = "내보낼 파일 이름을 먼저 정해 주세요.";
    return null;
  }
  const safeTitle = sanitizeFileName(rawTitle);
  elements.export_file_name_preview.textContent = (
    `저장 파일: ${safeTitle}.(영상 형식) · ${safeTitle}.kirinuki-session.json`
    + " · 자막이 있으면 같은 이름의 SRT (중복 이름은 번호를 붙여 보존)"
  );
  return safeTitle;
}

function resolveExportCleanupDialog(shouldDelete: boolean): void {
  const resolve = pendingExportCleanupResolve;
  pendingExportCleanupResolve = null;
  if (elements.cleanup_after_export_dialog.open) {
    elements.cleanup_after_export_dialog.close();
  }
  resolve?.(shouldDelete);
}

function askExportSessionCleanup(summary: string): Promise<boolean> {
  if (pendingExportCleanupResolve) {
    throw new Error("이전 내보내기 정리 확인이 아직 끝나지 않았습니다.");
  }
  elements.cleanup_after_export_summary.textContent = summary;
  if (!elements.cleanup_after_export_dialog.open) {
    elements.cleanup_after_export_dialog.showModal();
  }
  elements.keep_export_session_cache.focus({ preventScroll: true });
  return new Promise<boolean>((resolve) => {
    pendingExportCleanupResolve = resolve;
  });
}

function openExportOptionsDialog(exportKind: ExportKind): void {
  try {
    requireActiveUsagePolicySession();
  } catch (error: unknown) {
    showToast(errorMessage(error), "error", 0);
    return;
  }
  if (activeJobController || projectMutationLockCount > 0 || exportRequestPending) {
    showToast("다른 미디어 작업이 끝난 뒤 내보내기 설정을 열어 주세요.", "error");
    return;
  }
  pendingExportOptionsKind = exportKind;
  pendingExportOptionsProjectFingerprint = exportOptionsProjectFingerprint(
    exportKind
  );
  focusBeforeExportOptions = document.activeElement as HTMLElement | null;
  elements.export_file_title.value = suggestedExportOutputTitle(exportKind);
  renderExportOutputTitle();
  renderExportOptionsPreflight(exportKind);
  if (!elements.export_options_dialog.open) {
    elements.export_options_dialog.showModal();
  }
  elements.export_file_title.focus({ preventScroll: true });
  elements.export_file_title.select();
}

function archiveSourceIdentity(projectSnapshot: EditorProject): string {
  const rawUrl = String(
    projectSnapshot.source?.canonicalUrl
    || projectSnapshot.source?.url
    || ""
  ).trim();
  const identifiers = inferSourceIdentifiers(rawUrl);
  const canonicalUrl = canonicalSourceUrl(rawUrl, identifiers);
  return JSON.stringify({
    platform: String(identifiers.platform || projectSnapshot.source?.platform || "").toUpperCase(),
    contentType: String(identifiers.contentType || projectSnapshot.source?.contentType || "").toLowerCase(),
    contentId: String(identifiers.contentId || projectSnapshot.source?.contentId || ""),
    canonicalUrl
  });
}

async function archiveRecoveryMatchesCurrentMedia(
  recovery: SessionArchiveMediaRecovery,
  sourceMedia: EditorMediaSource
): Promise<boolean> {
  if (recovery.mode === "reconnect-local-file") {
    const localMedia = recovery.localMedia;
    const metadataMatches = Boolean(
      localMedia
      && sourceMedia instanceof File
      && sourceMedia.name === localMedia.name
      && sourceMedia.size === localMedia.sizeBytes
      && sourceMedia.lastModified === localMedia.lastModifiedMs
      && sourceMedia.type.trim().toLowerCase()
        === localMedia.mimeType.trim().toLowerCase()
    );
    if (
      !metadataMatches
      || !(sourceMedia instanceof File)
      || !localMedia?.sampleSha256
    ) {
      return false;
    }
    return await sampledMediaFileSha256(sourceMedia)
      === localMedia.sampleSha256;
  }
  if (recovery.mode === "redownload-vod") {
    const recoveryMaterialization = normalizeChzzkVodMaterialization(
      recovery.materialization
    );
    const currentMaterialization = projectMaterialization(project);
    return Boolean(
      recovery.source
      && isMaterializedLoopbackMediaSource(sourceMedia)
      && currentMaterialization
      && recoveryMaterialization
      && recovery.source.platform === currentMaterialization.source.platform
      && recovery.source.contentType === "vod"
      && recovery.source.contentId === currentMaterialization.source.contentId
      && sameMaterializedSourceVersion(
        project.mediaAsset,
        recoveryMaterialization
      )
    );
  }
  return false;
}

function rekeyImportedArchiveImageAssets(
  archivedProject: EditorProject,
  blobs: ReadonlyMap<string, Blob>
): { project: EditorProject; blobs: Map<string, Blob> } {
  const keyMap = new Map(
    [...blobs.keys()].map((blobKey) => [
      blobKey,
      `session-archive-${crypto.randomUUID()}`
    ])
  );
  const remapAssets = (assets: readonly EditorImageAsset[]) => assets.map((asset) => {
    if (asset.source?.kind !== "blob-key") {
      return { ...asset };
    }
    const nextKey = keyMap.get(asset.source.value);
    if (!nextKey) {
      throw new Error(`복원 이미지 ${asset.source.value}의 검증된 Blob을 찾지 못했습니다.`);
    }
    return {
      ...asset,
      source: { ...asset.source, value: nextKey }
    };
  });
  const collection = normalizeShortFormWorkspaceCollection(
    archivedProject.shortFormWorkspaces,
    archivedProject.shortForm,
    archivedProject.clips
  );
  const shortFormWorkspaces = {
    ...collection,
    workspaces: collection.workspaces.map((workspace) => ({
      ...workspace,
      shortForm: {
        ...workspace.shortForm,
        imageAssets: remapAssets(workspace.shortForm.imageAssets)
      }
    }))
  };
  const activeShortForm = activeShortFormWorkspace(
    shortFormWorkspaces,
    archivedProject.shortForm,
    archivedProject.clips
  ).shortForm;
  return {
    project: {
      ...archivedProject,
      imageAssets: remapAssets(archivedProject.imageAssets),
      shortForm: {
        ...activeShortForm
      },
      shortFormWorkspaces
    },
    blobs: new Map([...blobs].map(([blobKey, blob]) => {
      const nextKey = keyMap.get(blobKey);
      if (!nextKey) {
        throw new Error(`복원 이미지 ${blobKey}의 새 저장 키를 만들지 못했습니다.`);
      }
      return [nextKey, blob];
    }))
  };
}

async function importSessionArchiveFile(file: File): Promise<void> {
  requireActiveUsagePolicySession();
  const entryBusyReason = projectReplacementBusyReason();
  if (entryBusyReason) {
    throw new Error(`${entryBusyReason}이 끝난 뒤 편집 복원 파일을 열어 주세요.`);
  }
  if (
    !(file instanceof File)
    || file.size <= 0
    || file.size > SESSION_ARCHIVE_MAX_JSON_BYTES
  ) {
    throw new Error("편집 복원 파일 크기가 허용 범위를 벗어났습니다.");
  }
  const archive = await parseSessionArchiveJson(await file.text());
  const archivedRoot = await restoreSessionArchiveProject(archive);
  if (archiveSourceIdentity(archivedRoot) !== archiveSourceIdentity(project)) {
    throw new Error(
      "현재 정책을 확인한 원본과 복원 파일의 원본이 다릅니다. 해당 원본 탭에서 이번 사용 정책을 다시 입력한 뒤 복원해 주세요."
    );
  }
  if (!window.confirm(
    `현재 편집을 안전하게 저장한 뒤 ‘${archivedRoot.name}’ 저장본으로 교체할까요?\n\n편집 복원 파일에는 원본 VOD가 들어 있지 않으므로 필요하면 원본을 다시 연결하거나 준비합니다.`
  )) {
    return;
  }
  const precommitBusyReason = projectReplacementBusyReason();
  if (precommitBusyReason) {
    throw new Error(`파일을 확인하는 동안 ${precommitBusyReason}이 시작되어 세션 복원을 중단했습니다. 다시 시도해 주세요.`);
  }

  closeLocalDraftDialog();
  showJob(
    "편집 복원 파일을 확인하는 중",
    "파일과 이미지를 모두 확인한 뒤 현재 편집 작업에 한 번에 적용합니다.",
    0,
    { cancelable: false }
  );
  lockProjectMutations();
  try {
    await cancelAndWaitForShortPreviewCacheOperation();
    await queueLocalDraftOperation(() => saveCurrentLocalDraft("pre-restore"));
    updateJob(0.35, "저장된 이미지 확인 중");
    const restoredImageBlobs = await restoreSessionArchiveImageBlobs(archive);
    const rekeyedArchive = rekeyImportedArchiveImageAssets(
      archivedRoot,
      restoredImageBlobs
    );
    const normalized = normalizeEditorProject({
      ...rekeyedArchive.project,
      id: project.id,
      history: { undo: [], redo: [] },
      updatedAt: new Date().toISOString()
    });
    if (!normalized) {
      throw new Error("복원 파일의 편집 프로젝트 버전을 현재 Kirinuki가 읽지 못합니다.");
    }

    const currentlyBoundAsset = project.mediaAsset
      ? cloneProject(project.mediaAsset)
      : null;
    const transportBound = (
      currentlyBoundAsset
      && await archiveRecoveryMatchesCurrentMedia(
        archive.mediaRecovery,
        mediaFile
      )
    )
      ? runtimeTransportBoundProjectSnapshot(normalized, currentlyBoundAsset)
      : null;
    const restoredProject = transportBound || {
      ...normalized,
      mediaAsset: null
    };
    updateJob(0.7, "현재 편집에 저장본 적용 중");
    advanceProjectSessionGeneration();
    await queueCurrentProjectSessionWrite(() => replaceProjectSessionAtomically(
      restoredProject,
      rekeyedArchive.blobs,
      { deleteStoredMediaHandle: !transportBound }
    ));

    if (!transportBound) {
      elements.preview_video.pause();
      elements.preview_video.removeAttribute("src");
      elements.preview_video.load();
      releaseMediaUrl(mediaFile, mediaUrl);
      mediaFile = null!;
      mediaUrl = null;
      mediaHandle = null;
    }
    stopShortCanvasPlayback();
    releaseShortPreviewSourceAudio();
    releaseShortPreviewLayerVideos();
    releaseShortPreviewAssetCaches();
    releaseAllImageAssetObjectUrls();
    workspaceMode = "main";
    shortSourcePickerReturnState = null;
    project = cloneProject(restoredProject);
    rootProject = cloneProject(restoredProject);
    undoStack = [];
    redoStack = [];
    mainWorkspaceUndoStack = [];
    mainWorkspaceRedoStack = [];
    shortWorkspaceHistory.clear();
    fieldEditSession = null;
    activeClipId = project.selectedClipId || project.clips[0]?.id || null;
    clipGroupSelection.clear();
    clearTimelineRangeSelection({ render: false });
    updateShortWorkspaceUrl(false);
    updateJob(1, "복원 완료");
    renderAll();
    if (mediaFile && project.clips.length > 0) {
      await syncPreviewToPlayhead();
    }
    scheduleImageAssetBlobPrune();
    showToast(
      archive.mediaRecovery.mode === "redownload-vod" && !transportBound
        ? "저장본을 적용했습니다. ‘편집 영상 준비’로 필요한 VOD 구간만 다시 받아 주세요."
        : archive.mediaRecovery.mode === "reconnect-local-file" && !transportBound
          ? `저장본을 적용했습니다. 원본 파일 ‘${archive.mediaRecovery.localMedia?.name || "영상"}’을 다시 연결해 주세요.`
          : "저장본을 적용했고 현재 원본 연결도 그대로 사용할 수 있습니다.",
      "success",
      7000
    );
  } finally {
    hideJob();
    unlockProjectMutations();
  }
}

async function focusSourceTab({ seek = false } = {}) {
  try {
    const activePolicy = requireActiveUsagePolicySession();
    const mapping = mapTimelineToSource(project, project.playheadMs);
    const response = await runStudioSourceAction({
      projectId: project.id,
      sourceSessionId: activePolicy.sourceSessionId,
      ...(activePolicy.sessionLeaseId
        ? {
          sessionLeaseId: activePolicy.sessionLeaseId,
          transitionGeneration: activePolicy.transitionGeneration
        }
        : {}),
      sourceUrl: String(
        project.source?.canonicalUrl || project.source?.url || ""
      ),
      action: seek ? "seek-and-focus" : "focus",
      sourceSeconds: mapping
        ? (
          Number(mapping.sourceMs) -
          Number(project.broadcastSession?.alignmentOffsetMs || 0)
        ) / 1000
        : null
    });
    if (!response?.ok) {
      throw new Error(response?.error || "원래 영상 탭을 찾지 못했습니다.");
    }
    sourceBindingConnected = true;
    renderHeader();
  } catch (error: unknown) {
    sourceBindingConnected = false;
    renderHeader();
    showToast(errorMessage(error), "error");
  }
}

function bindOverlayDrag() {
  elements.subtitle_overlays.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    const overlay = (event.target! as EditorControl).closest(
      ".subtitle-overlay"
    ) as EditorControl | null;
    const cueId = overlay?.dataset.cueId;
    if (!cueId) {
      return;
    }
    event.preventDefault();
    const cue = project.subtitles.find((candidate) => candidate.id === cueId);
    project = {
      ...project,
      selectedCueId: cueId,
      selectedClipId: cue!.clipId
    };
    propertyInspectorMode = "caption";
    inspectorMode = "selected";
    elements.subtitle_overlays.querySelectorAll(".subtitle-overlay").forEach((candidate) => {
      candidate.classList.toggle("selected", candidate === overlay);
    });
    elements.caption_tracks.querySelectorAll(".cue-block").forEach((candidate) => {
      candidate.classList.toggle("selected", (candidate as EditorControl).dataset.id === cueId);
    });
    renderPropertyInspector();
    revealSelectedPropertyEditor();
    beginPointerHistory();
    const pointerId = event.pointerId;
    overlay.setPointerCapture(pointerId);
    elements.stage.classList.add("dragging-subtitle");
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      if ((moveEvent.buttons & 1) === 0) {
        finish(moveEvent);
        return;
      }
      const layerRect = elements.subtitle_overlays.getBoundingClientRect();
      const content = videoContentRect(elements.subtitle_overlays);
      const x = Math.max(0.05, Math.min(0.95, (moveEvent.clientX - layerRect.left - content.left) / content.width));
      const y = Math.max(0.05, Math.min(0.95, (moveEvent.clientY - layerRect.top - content.top) / content.height));
      project = updateSubtitleCue(project, cueId, { x, y });
      renderCueInspector();
      overlay.style.left = `${content.left + content.width * x}px`;
      overlay.style.top = `${content.top + content.height * y}px`;
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      overlay.removeEventListener("lostpointercapture", finish);
      if (overlay.hasPointerCapture(pointerId)) {
        overlay.releasePointerCapture(pointerId);
      }
      elements.stage.classList.remove("dragging-subtitle");
      endPointerHistory();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    overlay.addEventListener("lostpointercapture", finish);
  });
}

function bindImageAssetOverlayDrag() {
  elements.image_asset_overlays.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    const overlay = (event.target! as EditorControl).closest(
      ".image-asset-overlay"
    ) as EditorControl | null;
    const assetId = overlay?.dataset.assetId;
    const asset = project.imageAssets.find((candidate) => candidate.id === assetId);
    if (!overlay || !asset) {
      return;
    }
    event.preventDefault();
    project = {
      ...project,
      selectedImageAssetId: asset.id,
      selectedClipId: asset.clipId
    };
    propertyInspectorMode = "asset";
    elements.image_asset_overlays.querySelectorAll(".image-asset-overlay").forEach((candidate) => {
      candidate.classList.toggle("selected", candidate === overlay);
    });
    elements.asset_track.querySelectorAll(".asset-block").forEach((candidate) => {
      candidate.classList.toggle("selected", (candidate as EditorControl).dataset.id === asset.id);
    });
    renderPropertyInspector();
    revealSelectedPropertyEditor();
    beginPointerHistory();
    const pointerId = event.pointerId;
    overlay.setPointerCapture(pointerId);
    elements.stage.classList.add("dragging-asset");
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      if ((moveEvent.buttons & 1) === 0) {
        finish(moveEvent);
        return;
      }
      const layerRect = elements.image_asset_overlays.getBoundingClientRect();
      const content = videoContentRect(elements.image_asset_overlays);
      const x = Math.max(0, Math.min(1, (moveEvent.clientX - layerRect.left - content.left) / content.width));
      const y = Math.max(0, Math.min(1, (moveEvent.clientY - layerRect.top - content.top) / content.height));
      project = updateImageAsset(project, asset.id, { x, y });
      renderImageAssetInspector();
      overlay.style.left = `${content.left + content.width * x}px`;
      overlay.style.top = `${content.top + content.height * y}px`;
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent?.pointerId !== undefined && finishEvent.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      overlay.removeEventListener("lostpointercapture", finish);
      if (overlay.hasPointerCapture(pointerId)) {
        overlay.releasePointerCapture(pointerId);
      }
      elements.stage.classList.remove("dragging-asset");
      endPointerHistory();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    overlay.addEventListener("lostpointercapture", finish);
  });
}

function closeTimelineContextMenu() {
  elements.timeline_context_menu.hidden = true;
  timelineContext = null;
}

function openTimelineContextMenu(event: MouseEvent) {
  const target = event.target as Element | null;
  const clipBlock = target?.closest(".clip-block") as EditorControl | null;
  const cueBlock = target?.closest(".cue-block") as EditorControl | null;
  const assetBlock = target?.closest(".asset-block") as EditorControl | null;
  const audioBlock = target?.closest(".audio-block") as EditorControl | null;
  const captionRow = target?.closest(".caption-track-row") as EditorControl | null;
  const inVideoTrack = Boolean(target?.closest("#video-track"));
  const inAssetTrack = Boolean(target?.closest("#asset-track"));
  const inAudioTrack = Boolean(target?.closest("#audio-track"));
  if (!clipBlock && !cueBlock && !assetBlock && !audioBlock && !captionRow && !inVideoTrack && !inAssetTrack && !inAudioTrack) {
    return;
  }
  event.preventDefault();
  const timelineRect = elements.timeline_content.getBoundingClientRect();
  const rawTimelineMs = (event.clientX - timelineRect.left) / pixelsPerSecond * 1000;
  const timelineMs = Math.max(0, Math.min(projectDurationMs(project), Math.round(rawTimelineMs)));
  const laneValue = cueBlock?.dataset.lane ?? captionRow?.dataset.lane;
  timelineContext = {
    timelineMs,
    lane: laneValue === undefined ? null : Number(laneValue),
    cueId: cueBlock?.dataset.id || null,
    imageAssetId: assetBlock?.dataset.id || null,
    audioRegionId: audioBlock?.dataset.id || null,
    kind: clipBlock || inVideoTrack
      ? "video"
      : cueBlock || captionRow
      ? "caption"
      : assetBlock || inAssetTrack
        ? "asset"
        : "audio"
  };
  const videoContext = timelineContext.kind === "video";
  const captionContext = timelineContext.kind === "caption";
  const assetContext = timelineContext.kind === "asset";
  const choosingShortSource = shortSourceComposerActive
    && timelineRangePurpose === "short-source";
  const shortCanvasRangeUnsupported = workspaceMode === "short-form";
  elements.context_set_range_start.hidden = (
    shortCanvasRangeUnsupported || !videoContext
  );
  elements.context_set_range_end.hidden = (
    shortCanvasRangeUnsupported || !videoContext
  );
  elements.context_set_range_start.textContent = choosingShortSource
    ? "이 위치를 쇼츠 소스 시작점으로"
    : "이 위치를 삭제 시작점으로";
  elements.context_set_range_end.textContent = choosingShortSource
    ? "이 위치를 쇼츠 소스 끝점으로"
    : "이 위치를 삭제 끝점으로";
  elements.context_delete_range.hidden = (
    !videoContext
    || shortCanvasRangeUnsupported
    || !selectedTimelineRange()
    || choosingShortSource
  );
  elements.context_add_cue.hidden = !captionContext;
  elements.context_delete_cue.hidden = !timelineContext.cueId;
  elements.context_add_lane.hidden = !captionContext || project.subtitleLaneCount >= MAX_SUBTITLE_LANES;
  elements.context_paste_asset.hidden = !assetContext;
  elements.context_pick_asset.hidden = !assetContext;
  elements.context_delete_asset.hidden = !timelineContext.imageAssetId;
  elements.context_add_audio.hidden = timelineContext.kind !== "audio";
  elements.context_delete_audio.hidden = !timelineContext.audioRegionId;
  elements.timeline_context_menu.hidden = false;
  elements.timeline_context_menu.style.left = `${event.clientX}px`;
  elements.timeline_context_menu.style.top = `${event.clientY}px`;
  const menuRect = elements.timeline_context_menu.getBoundingClientRect();
  elements.timeline_context_menu.style.left = `${Math.max(
    8,
    Math.min(event.clientX, window.innerWidth - menuRect.width - 8)
  )}px`;
  elements.timeline_context_menu.style.top = `${Math.max(
    8,
    Math.min(event.clientY, window.innerHeight - menuRect.height - 8)
  )}px`;
  (elements.timeline_context_menu.querySelector("button:not([hidden])") as EditorControl)?.focus({ preventScroll: true });
}

function bindTimelineSeeking() {
  const seekFromEvent = (event: PointerEvent) => {
    const rect = elements.timeline_content.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    void seekTimeline(x / pixelsPerSecond * 1000);
  };
  elements.timeline_ruler.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    seekFromEvent(event);
    elements.timeline_ruler.setPointerCapture(pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || (moveEvent.buttons & 1) === 0) {
        return;
      }
      seekFromEvent(moveEvent);
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      elements.timeline_ruler.removeEventListener("pointermove", move);
      elements.timeline_ruler.removeEventListener("pointerup", finish);
      elements.timeline_ruler.removeEventListener("pointercancel", finish);
      elements.timeline_ruler.removeEventListener("lostpointercapture", finish);
      if (elements.timeline_ruler.hasPointerCapture(pointerId)) {
        elements.timeline_ruler.releasePointerCapture(pointerId);
      }
      scheduleSave();
    };
    elements.timeline_ruler.addEventListener("pointermove", move);
    elements.timeline_ruler.addEventListener("pointerup", finish);
    elements.timeline_ruler.addEventListener("pointercancel", finish);
    elements.timeline_ruler.addEventListener("lostpointercapture", finish);
  });
  elements.playhead.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    let dragging = false;
    elements.playhead.setPointerCapture(pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || (moveEvent.buttons & 1) === 0) {
        return;
      }
      if (
        !dragging
        && Math.abs(moveEvent.clientX - startX) < TIMED_BLOCK_DRAG_ACTIVATION_PX
      ) {
        return;
      }
      dragging = true;
      seekFromEvent(moveEvent);
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      elements.playhead.removeEventListener("pointermove", move);
      elements.playhead.removeEventListener("pointerup", finish);
      elements.playhead.removeEventListener("pointercancel", finish);
      elements.playhead.removeEventListener("lostpointercapture", finish);
      if (elements.playhead.hasPointerCapture(pointerId)) {
        elements.playhead.releasePointerCapture(pointerId);
      }
      if (dragging) {
        scheduleSave();
      }
    };
    elements.playhead.addEventListener("pointermove", move);
    elements.playhead.addEventListener("pointerup", finish);
    elements.playhead.addEventListener("pointercancel", finish);
    elements.playhead.addEventListener("lostpointercapture", finish);
  });
  elements.playhead.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const delta = event.shiftKey ? 1_000 : 100;
    void seekTimeline(project.playheadMs + (event.key === "ArrowLeft" ? -delta : delta));
  });
}

function bindActions() {
  installEditorShortcutHints();
  elements.project_name.addEventListener("input", () => {
    applyFieldProject({ ...project, name: elements.project_name.value }, "project-name");
  });
  elements.project_name.addEventListener("blur", () => endFieldEdit("project-name"));
  elements.undo.addEventListener("click", undo);
  elements.redo.addEventListener("click", redo);
  elements.finish_editing_session.addEventListener(
    "click",
    openEditingSessionExitDialog
  );
  elements.cancel_editing_session_exit.addEventListener(
    "click",
    closeEditingSessionExitDialog
  );
  elements.save_and_exit_editing_session.addEventListener("click", () => {
    void finishEditingSession("save");
  });
  elements.discard_and_exit_editing_session.addEventListener("click", () => {
    void finishEditingSession("discard");
  });
  elements.editing_session_exit_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeEditingSessionExitDialog();
  });
  elements.editing_session_exit_dialog.addEventListener("close", () => {
    if (editingSessionExitInProgress) {
      return;
    }
    if (focusBeforeEditingSessionExit?.isConnected) {
      focusBeforeEditingSessionExit.focus({ preventScroll: true });
    }
    focusBeforeEditingSessionExit = null;
  });
  elements.create_local_draft.addEventListener("click", createManualLocalDraft);
  elements.open_local_drafts.addEventListener("click", () => {
    void openLocalDraftDialog();
  });
  elements.open_caption_sheet.addEventListener(
    "click",
    openCaptionPropertiesSheet
  );
  elements.close_caption_sheet_dialog.addEventListener(
    "click",
    () => closeCaptionPropertiesSheet()
  );
  elements.caption_sheet_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCaptionPropertiesSheet();
  });
  elements.caption_sheet_dialog.addEventListener("close", () => {
    const focusTarget = focusBeforeCaptionSheetDialog;
    focusBeforeCaptionSheetDialog = null;
    if (focusTarget?.isConnected) {
      focusTarget.focus();
    }
  });
  elements.open_subtitle_sync_guide.addEventListener(
    "click",
    openSubtitleSyncGuide
  );
  elements.close_subtitle_sync_guide.addEventListener(
    "click",
    closeSubtitleSyncGuide
  );
  elements.copy_subtitle_sync_skill.addEventListener("click", () => {
    void copySubtitleSyncSkill();
  });
  elements.subtitle_sync_guide_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSubtitleSyncGuide();
  });
  elements.subtitle_sync_guide_dialog.addEventListener("close", () => {
    const focusTarget = focusBeforeSubtitleSyncGuide;
    focusBeforeSubtitleSyncGuide = null;
    if (focusTarget?.isConnected) {
      focusTarget.focus({ preventScroll: true });
    }
  });
  elements.caption_sheet_body.addEventListener("click", (event) => {
    const button = (event.target! as EditorControl).closest(
      ".caption-sheet-cue-button"
    ) as EditorControl | null;
    const cueId = button?.dataset.cueId;
    const cue = project.subtitles.find((candidate) => candidate.id === cueId);
    if (!cueId || !cue) {
      return;
    }
    const activeRange = cueTimelineRange(project, cue);
    if (!activeRange) {
      showToast("출력 제외 컷을 활성화한 뒤 이 자막을 편집해 주세요.");
      return;
    }
    closeCaptionPropertiesSheet({ restoreFocus: false });
    selectCue(cueId, { seek: true });
  });
  elements.open_short_form.addEventListener("click", () => {
    void enterShortFormWorkspace().catch((error: unknown) => {
      showToast(`쇼츠 편집을 열지 못했습니다: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.exit_short_form.addEventListener("click", () => {
    const operation = shortSourcePickerReturnState
      ? restoreShortWorkspaceAfterSourcePicker()
      : exitShortFormWorkspace();
    void operation.catch((error: unknown) => {
      showToast(`본편으로 돌아가지 못했습니다: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.start_short_source_composer.addEventListener(
    "click",
    startShortSourceComposer
  );
  elements.close_short_source_composer.addEventListener(
    "click",
    () => {
      if (shortSourcePickerReturnState) {
        void restoreShortWorkspaceAfterSourcePicker();
      } else {
        cancelShortSourceComposer();
      }
    }
  );
  elements.toggle_short_source_composer_collapse.addEventListener("click", () => {
    if (shortSourceBoundaryPreviewInFlight) {
      return;
    }
    shortSourceComposerCollapsed = !shortSourceComposerCollapsed;
    renderShortSourceComposer();
    elements.toggle_short_source_composer_collapse.focus({ preventScroll: true });
  });
  elements.cancel_short_source_composer.addEventListener(
    "click",
    () => {
      if (shortSourcePickerReturnState) {
        void restoreShortWorkspaceAfterSourcePicker();
      } else {
        cancelShortSourceComposer();
      }
    }
  );
  elements.cancel_short_video_layer_add.addEventListener("click", () => {
    if (shortSourcePickerReturnState) {
      void restoreShortWorkspaceAfterSourcePicker();
      return;
    }
    pendingShortVideoAssetTimelineMs = null;
    renderShortSourceComposer();
    showToast("이 구간을 새 쇼츠 장면으로 만들도록 전환했습니다.");
  });
  elements.add_short_source_only.addEventListener("click", () => {
    void commitShortSource(false).catch((error: unknown) => {
      showToast(`쇼츠 소스를 추가하지 못했습니다: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.add_short_source_and_open.addEventListener("click", () => {
    void commitShortSource(true).catch((error: unknown) => {
      showToast(`쇼츠 소스를 추가하지 못했습니다: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.set_short_source_start.addEventListener("click", () => {
    setTimelineRangeBoundary("start", project.playheadMs, { constrain: true });
  });
  elements.set_short_source_end.addEventListener("click", () => {
    setTimelineRangeBoundary("end", project.playheadMs, { constrain: true });
  });
  elements.short_source_whole_clip.addEventListener("click", () => {
    setShortSourceRangeFromStartClip(true);
  });
  elements.short_source_to_clip_end.addEventListener("click", () => {
    setShortSourceRangeFromStartClip(false);
  });
  elements.short_source_start_to_clip_start.addEventListener("click", () => {
    setShortSourceBoundaryToClipEdge("start");
  });
  elements.short_source_end_to_clip_end.addEventListener("click", () => {
    setShortSourceBoundaryToClipEdge("end");
  });
  elements.preview_short_source_start.addEventListener("click", () => {
    void previewShortSourceBoundary("start");
  });
  elements.preview_short_source_end.addEventListener("click", () => {
    void previewShortSourceBoundary("end");
  });
  elements.short_source_composer.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "button[data-short-source-boundary][data-short-source-delta-ms]"
    );
    const side = button?.dataset.shortSourceBoundary;
    if (button && (side === "start" || side === "end")) {
      adjustShortSourceBoundary(side, button.dataset.shortSourceDeltaMs);
    }
  });
  const bindShortSourceTimeInput = (
    control: EditorControl,
    side: RangeBoundarySide
  ) => {
    control.addEventListener("change", () => {
      const timelineMs = parseTime(control.value);
      if (timelineMs === null) {
        showToast("쇼츠 소스 시각 형식을 확인해 주세요.", "error");
        renderShortSourceComposer();
        return;
      }
      setTimelineRangeBoundary(side, timelineMs, { constrain: true });
    });
    control.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      const typedMs = parseTime(control.value);
      if (typedMs === null) {
        showToast("쇼츠 소스 시각 형식을 확인해 주세요.", "error");
        renderShortSourceComposer();
        return;
      }
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const stepMs = event.shiftKey ? 1_000 : 100;
      setTimelineRangeBoundary(side, typedMs + direction * stepMs, {
        constrain: true
      });
    });
  };
  bindShortSourceTimeInput(elements.short_source_start_time, "start");
  bindShortSourceTimeInput(elements.short_source_end_time, "end");
  const shortSourceCropFields = [
    [elements.short_source_crop_x, "x"],
    [elements.short_source_crop_y, "y"],
    [elements.short_source_crop_width, "width"],
    [elements.short_source_crop_height, "height"]
  ] as const;
  for (const [control, field] of shortSourceCropFields) {
    control.addEventListener("change", () => {
      setShortSourceCropPixelField(field, control.value);
    });
  }
  elements.short_source_composer.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "button[data-short-source-aspect]"
    );
    if (button) {
      setShortSourceAspect(button.dataset.shortSourceAspect || "free");
    }
  });
  elements.short_source_crop_surface.addEventListener(
    "pointerdown",
    beginShortSourceCropGesture
  );
  elements.short_source_crop_surface.addEventListener(
    "pointermove",
    updateShortSourceCropGesture
  );
  elements.short_source_crop_surface.addEventListener("pointerup", (event) => {
    finishShortSourceCropGesture(event);
  });
  elements.short_source_crop_surface.addEventListener("pointercancel", (event) => {
    finishShortSourceCropGesture(event, { cancel: true });
  });
  elements.short_source_crop_surface.addEventListener("lostpointercapture", (event) => {
    finishShortSourceCropGesture(event as PointerEvent);
  });
  elements.short_source_crop_surface.addEventListener(
    "keydown",
    nudgeShortSourceCropFromKeyboard
  );
  for (const eventName of ["loadeddata", "seeked", "timeupdate"] as const) {
    elements.preview_video.addEventListener(eventName, () => {
      if (workspaceMode === "short-form") {
        scheduleShortWorkspacePreview();
      } else if (shortSourceComposerActive) {
        renderShortSourceComposer();
      }
    });
  }
  elements.restore_local_draft.addEventListener("click", () => {
    void restoreSelectedLocalDraft();
  });
  elements.open_session_archive_file.addEventListener("click", () => {
    elements.session_archive_input.click();
  });
  elements.session_archive_input.addEventListener("change", () => {
    const [file] = elements.session_archive_input.files || [];
    elements.session_archive_input.value = "";
    if (!file) {
      return;
    }
    void importSessionArchiveFile(file).catch((error: unknown) => {
      hideJob();
      showToast(`편집 복원 파일을 열지 못했습니다: ${errorDetails(error)}`, "error", 0);
    });
  });
  elements.close_local_draft_dialog.addEventListener(
    "click",
    closeLocalDraftDialog
  );
  elements.local_draft_dialog.addEventListener("cancel", (event) => {
    if (localDraftOperationActive) {
      event.preventDefault();
    }
  });
  elements.local_draft_dialog.addEventListener("close", () => {
    elements.local_draft_dialog.hidden = true;
    if (focusBeforeLocalDraftDialog?.isConnected) {
      focusBeforeLocalDraftDialog.focus();
    }
    focusBeforeLocalDraftDialog = null;
  });
  elements.prepare_chzzk_vod.addEventListener(
    "click",
    () => void prepareChzzkVodMedia()
  );
  elements.prepare_chzzk_vod_empty.addEventListener(
    "click",
    () => void prepareChzzkVodMedia()
  );
  elements.pick_media.addEventListener("click", () => void chooseMediaFile());
  elements.pick_media_empty.addEventListener("click", () => void chooseMediaFile());
  elements.media_input.addEventListener("change", () => {
    const [file] = elements.media_input.files || [];
    if (file) {
      mediaHandle = null;
      void attachMediaFile(file).then(async (attached) => {
        if (attached) {
          await deleteMediaHandle(project.id);
        }
      });
    }
    elements.media_input.value = "";
  });
  elements.asset_input.addEventListener("change", () => {
    const [file] = elements.asset_input.files || [];
    const timelineMs = pendingAssetTimelineMs ?? project.playheadMs;
    pendingAssetTimelineMs = null;
    elements.asset_input.value = "";
    if (file) {
      void addImageAssetFromBlob(file, {
        timelineMs,
        name: file.name || pastedImageName(file.type)
      });
    }
  });
  const pasteAtPlayhead = () => void pasteImageFromSystemClipboard(project.playheadMs);
  elements.asset_paste.addEventListener("click", pasteAtPlayhead);
  elements.paste_image_asset.addEventListener("click", pasteAtPlayhead);
  elements.asset_pick_file.addEventListener("click", () => openImageAssetFilePicker(project.playheadMs));
  document.addEventListener("paste", (event) => {
    const blob = imageBlobFromPasteEvent(event);
    if (!blob) {
      return;
    }
    event.preventDefault();
    void addImageAssetFromBlob(blob, {
      timelineMs: project.playheadMs,
      name: pastedImageName(blob.type)
    });
  });
  elements.export_video.addEventListener(
    "click",
    () => openExportOptionsDialog(
      workspaceMode === "short-form" ? "short-form" : "main"
    )
  );
  elements.retry_short_preview_cache.addEventListener(
    "click",
    () => void retryShortPreviewAssetCaches().catch((error: unknown) => {
      shortPreviewCacheError = errorDetails(error);
      renderShortFramingInspector();
      showToast(
        `쇼츠 미리보기를 다시 만들지 못했습니다: ${shortPreviewCacheError}`,
        "error",
        0
      );
    })
  );
  elements.cancel_export_options.addEventListener(
    "click",
    closeExportOptionsDialog
  );
  elements.cancel_export_options_footer.addEventListener(
    "click",
    closeExportOptionsDialog
  );
  elements.export_options_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeExportOptionsDialog();
  });
  elements.export_file_title.addEventListener("input", renderExportOutputTitle);
  elements.confirm_export_options.addEventListener("click", (event) => {
    event.preventDefault();
    const exportKind = pendingExportOptionsKind;
    if (!exportKind) {
      closeExportOptionsDialog();
      return;
    }
    const outputTitle = renderExportOutputTitle();
    if (!outputTitle) {
      elements.export_file_title.focus({ preventScroll: true });
      showToast("출력 영상 제목을 입력해 주세요.", "error");
      return;
    }
    const currentFingerprint = exportOptionsProjectFingerprint(exportKind);
    if (currentFingerprint !== pendingExportOptionsProjectFingerprint) {
      pendingExportOptionsProjectFingerprint = currentFingerprint;
      renderExportOptionsPreflight(exportKind);
      showToast(
        "내보내기 설정을 연 뒤 편집 상태가 바뀌어 검사를 갱신했습니다. 내용을 확인하고 한 번 더 눌러 주세요."
      );
      return;
    }
    closeExportOptionsDialog();
    void exportVideoWithLock(exportKind, outputTitle);
  });
  elements.keep_export_session_cache_icon.addEventListener(
    "click",
    () => resolveExportCleanupDialog(false)
  );
  elements.keep_export_session_cache.addEventListener(
    "click",
    () => resolveExportCleanupDialog(false)
  );
  elements.delete_export_session_cache.addEventListener(
    "click",
    () => resolveExportCleanupDialog(true)
  );
  elements.cleanup_after_export_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    resolveExportCleanupDialog(false);
  });
  elements.session_completed_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  elements.close_completed_editor.addEventListener("click", () => {
    leaveCompletedStudioEditor();
  });
  elements.apply_source_offset.addEventListener("click", () => {
    const seconds = Number(elements.source_offset.value);
    if (!Number.isFinite(seconds)) {
      showToast("정렬 오프셋을 초 단위 숫자로 입력해 주세요.", "error");
      return;
    }
    try {
      const next = applyMediaAlignmentOffset(project, Math.round(seconds * 1000));
      clearTimelineRangeSelection();
      applyProject(next);
      void syncPreviewToPlayhead();
      const overrun = mediaFile && clipOutsideMedia(next);
      showToast(
        overrun
          ? "오프셋을 적용했지만 일부 컷이 원본 길이 밖입니다."
          : "라이브와 로컬 VOD 정렬 오프셋을 적용했습니다.",
        overrun ? "error" : "success",
        overrun ? 7000 : 3600
      );
    } catch (error: unknown) {
      showToast(errorMessage(error), "error", 0);
      renderMediaCard();
    }
  });
  elements.focus_source.addEventListener("click", () => void focusSourceTab());
  elements.preview_source_tab.addEventListener("click", () => void focusSourceTab({ seek: true }));
  elements.set_range_start.addEventListener("click", () => {
    if (workspaceMode === "short-form") {
      return;
    }
    setTimelineRangeBoundary("start", project.playheadMs, {
      constrain: shortSourceComposerActive
        && timelineRangePurpose === "short-source"
    });
  });
  elements.set_range_end.addEventListener("click", () => {
    if (workspaceMode === "short-form") {
      return;
    }
    setTimelineRangeBoundary("end", project.playheadMs, {
      constrain: shortSourceComposerActive
        && timelineRangePurpose === "short-source"
    });
  });
  elements.clear_range.addEventListener("click", () => {
    clearTimelineRangeSelection();
  });
  elements.delete_range.addEventListener("click", deleteSelectedTimelineRange);
  elements.trim_short_canvas_empty_edges.addEventListener("click", () => {
    trimShortCanvasEmptyEdges();
  });
  const rangeHandles: Array<[EditorControl, RangeBoundarySide]> = [
    [elements.range_start_handle, "start"],
    [elements.range_end_handle, "end"]
  ];
  for (const [handle, side] of rangeHandles) {
    handle.title = "드래그 또는 ←/→ 0.1초 · Shift+←/→ 1초";
    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      bindTimelineRangeHandle(handle, side, event);
    });
    handle.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const deltaMs = event.shiftKey ? 1_000 : 100;
      nudgeTimelineRangeBoundary(
        side,
        event.key === "ArrowLeft" ? -deltaMs : deltaMs
      );
    });
  }

  elements.move_selected_clips_up.addEventListener("click", () => {
    moveSelectedClipGroup(-1, { focusControl: true });
  });
  elements.move_selected_clips_down.addEventListener("click", () => {
    moveSelectedClipGroup(1, { focusControl: true });
  });
  elements.clear_clip_group_selection.addEventListener("click", () => {
    clipGroupSelection.clear();
    renderClipGroupControls({ announcement: "컷 체크를 모두 해제함" });
  });
  elements.clip_list.addEventListener("change", (event) => {
    const checkbox = (event.target! as EditorControl).closest(
      ".clip-group-checkbox"
    ) as EditorControl | null;
    if (!checkbox || checkbox.disabled) {
      return;
    }
    const checkboxClipId = checkbox.dataset.clipId;
    if (!checkboxClipId) {
      return;
    }
    if (checkbox.checked) {
      clipGroupSelection.add(checkboxClipId);
    } else {
      clipGroupSelection.delete(checkboxClipId);
    }
    renderClipGroupControls();
  });
  elements.clip_list.addEventListener("keydown", (event) => {
    if (
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const focusedClipId = (
      (event.target! as EditorControl).closest(".clip-item") as EditorControl | null
    )?.dataset.id || null;
    moveSelectedClipGroup(event.key === "ArrowUp" ? -1 : 1, {
      restoreCheckboxClipId: focusedClipId
    });
  });
  elements.clip_group_toolbar.addEventListener("keydown", (event) => {
    if (
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moveSelectedClipGroup(event.key === "ArrowUp" ? -1 : 1, {
      focusControl: true
    });
  });
  elements.clip_list.addEventListener("click", (event) => {
    const item = (event.target! as EditorControl).closest(
      ".clip-item"
    ) as EditorControl | null;
    if (!item) {
      return;
    }
    if ((event.target! as EditorControl).closest(".clip-group-check")) {
      return;
    }
    const clip = project.clips.find((candidate) => candidate.id === item.dataset.id);
    if (!clip) {
      return;
    }
    const hotLoadButton = (event.target! as EditorControl).closest(
      "[data-hot-load]"
    ) as EditorControl | null;
    if (hotLoadButton) {
      event.preventDefault();
      event.stopPropagation();
      const side: VodHotLoadSide = hotLoadButton.dataset.hotLoad === "before"
        ? "before"
        : "after";
      project = { ...project, selectedClipId: clip.id };
      renderAll({ keepScroll: true });
      void requestVodHotLoadForClip(clip, side);
      return;
    }
    const seekSelection = shouldSeekTimelineItemSelection();
    const action = (
      (event.target! as EditorControl).closest("[data-action]") as EditorControl | null
    )?.dataset.action;
    if (action) {
      const index = project.clips.findIndex((candidate) => candidate.id === clip.id);
      clearTimelineRangeSelection({ render: false });
      const targetIndex = action === "first"
        ? 0
        : action === "last"
          ? project.clips.length - 1
          : action === "up"
            ? index - 1
            : index + 1;
      applyProject(anchorPlayheadAfterClipReorder(
        reorderClip(project, clip.id, targetIndex)
      ));
      const nextItem = [...elements.clip_list.querySelectorAll(".clip-item")]
        .find((candidate) => (candidate as EditorControl).dataset.id === clip.id);
      const nextAction = nextItem?.querySelector(`[data-action="${action}"]`);
      const nextControl = (
        nextAction && !(nextAction as EditorControl).disabled
          ? nextAction
          : nextItem?.querySelector(".clip-select")
      );
      (nextControl as EditorControl | null)?.focus({ preventScroll: true });
      void syncPreviewToPlayhead();
      return;
    }
    project.selectedClipId = clip.id;
    if (seekSelection) {
      void seekTimeline(clip.timelineStartMs);
    }
    renderAll({ keepScroll: true });
    const nextItem = [...elements.clip_list.querySelectorAll(".clip-item")]
      .find((candidate) => (candidate as EditorControl).dataset.id === clip.id);
    (nextItem?.querySelector(".clip-select") as EditorControl)?.focus({ preventScroll: true });
    scheduleSave();
  });

  const previewVideo = elements.preview_video;
  if (!(previewVideo instanceof HTMLVideoElement)) {
    throw new TypeError("미리보기 영상 요소가 올바르지 않습니다.");
  }
  configurePreviewVideoLayer(previewVideo, { active: true });
  bindPreviewVideoEvents(previewVideo);
  ensureStandbyPreviewVideo();
  elements.play_toggle.addEventListener("click", () => void togglePlayback());
  elements.previous_clip.addEventListener("click", () => adjacentClip(-1));
  elements.next_clip.addEventListener("click", () => adjacentClip(1));
  elements.toggle_mute.addEventListener("click", () => {
    previewMuted = !previewMuted;
    applyPreviewAudioSettings();
    showToast(previewMuted ? "미리보기 음소거" : "미리보기 음소거 해제");
  });
  elements.volume.addEventListener("input", () => {
    previewVolume = Number(elements.volume.value);
    applyPreviewAudioSettings();
  });

  elements.caption_mode_tab.addEventListener("click", () => {
    propertyInspectorMode = "caption";
    renderPropertyInspector();
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
    revealSelectedPropertyEditor();
  });
  elements.asset_mode_tab.addEventListener("click", () => {
    propertyInspectorMode = "asset";
    renderPropertyInspector();
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
    revealSelectedPropertyEditor();
  });
  elements.audio_mode_tab.addEventListener("click", () => {
    propertyInspectorMode = "audio";
    renderPropertyInspector();
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
    revealSelectedPropertyEditor();
  });
  elements.short_framing_mode_tab.addEventListener("click", () => {
    if (workspaceMode !== "short-form") {
      return;
    }
    propertyInspectorMode = "framing";
    renderPropertyInspector();
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
    revealSelectedPropertyEditor();
  });
  const propertyTabs = [
    elements.caption_mode_tab,
    elements.asset_mode_tab,
    elements.audio_mode_tab,
    elements.short_framing_mode_tab
  ];
  const visiblePropertyTabs = () => (
    workspaceMode === "short-form"
      ? [
        elements.short_framing_mode_tab,
        elements.asset_mode_tab,
        elements.caption_mode_tab,
        elements.audio_mode_tab
      ]
      : propertyTabs
  ).filter((candidate) => !candidate.hidden);
  for (const tab of propertyTabs) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const visibleTabs = visiblePropertyTabs();
      const tabIndex = visibleTabs.indexOf(tab);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? visibleTabs.length - 1
          : (tabIndex + (event.key === "ArrowLeft" ? -1 : 1) + visibleTabs.length) % visibleTabs.length;
      const next = visibleTabs[nextIndex];
      if (!next) {
        return;
      }
      next.click();
      next.focus();
    });
  }

  elements.short_workspace_select.addEventListener("change", () => {
    void switchShortWorkspace(elements.short_workspace_select.value).catch(
      (error: unknown) => {
        renderShortWorkspaceProjectManager();
        showToast(`쇼츠 작업 전환 실패: ${errorMessage(error)}`, "error", 0);
      }
    );
  });
  elements.short_workspace_name.addEventListener("change", commitShortWorkspaceName);
  elements.short_workspace_name.addEventListener("blur", commitShortWorkspaceName);
  elements.short_workspace_name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitShortWorkspaceName();
      elements.short_workspace_name.blur();
    }
  });
  elements.create_short_workspace.addEventListener("click", () => {
    void createOrDuplicateShortWorkspace(false).catch((error: unknown) => {
      showToast(`새 쇼츠 작업 생성 실패: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.duplicate_short_workspace.addEventListener("click", () => {
    void createOrDuplicateShortWorkspace(true).catch((error: unknown) => {
      showToast(`쇼츠 작업 복제 실패: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.delete_short_workspace.addEventListener("click", () => {
    void deleteCurrentShortWorkspace().catch((error: unknown) => {
      showToast(`쇼츠 작업 삭제 실패: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.add_short_video_layer.addEventListener("click", () => {
    void beginShortVideoLayerSourceSelection().catch((error: unknown) => {
      pendingShortVideoAssetTimelineMs = null;
      showToast(`영상 추가를 시작하지 못했습니다: ${errorMessage(error)}`, "error", 0);
    });
  });
  elements.add_video_lane.addEventListener("click", () => {
    if (workspaceMode !== "short-form") {
      return;
    }
    const previousLaneCount = project.shortForm.videoLaneCount;
    const shortForm = addShortFormVideoLane(project.shortForm);
    if (shortForm.videoLaneCount === previousLaneCount) {
      showToast(`영상 라인은 최대 ${SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS}개까지 만들 수 있습니다.`);
      return;
    }
    applyProject({ ...project, shortForm });
    showToast(`${shortForm.videoLaneCount}번째 영상 라인을 추가했습니다.`, "success");
  });
  elements.short_video_layer_list.addEventListener("click", (event) => {
    const orderButton = (event.target as HTMLElement | null)
      ?.closest<HTMLButtonElement>("[data-short-layer-order]");
    const order = orderButton?.dataset.shortLayerOrder;
    const orderedLayerId = orderButton?.dataset.layerId;
    if (
      orderedLayerId
      && (order === "front" || order === "forward"
        || order === "backward" || order === "back")
    ) {
      moveShortVideoLayer(orderedLayerId, order);
      return;
    }
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".short-video-layer-select[data-layer-id]"
    );
    if (item?.dataset.layerId) {
      selectShortWorkspaceVideoLayer(item.dataset.layerId);
    }
  });
  elements.short_video_layer_list.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = [
      ...elements.short_video_layer_list.querySelectorAll<HTMLButtonElement>(
        ".short-video-layer-select[data-layer-id]"
      )
    ].filter((candidate) => !candidate.disabled);
    if (items.length === 0) {
      return;
    }
    const current = (event.target as HTMLElement | null)
      ?.closest<HTMLButtonElement>(".short-video-layer-select[data-layer-id]");
    const currentIndex = Math.max(0, items.indexOf(current!));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + items.length)
          % items.length;
    const target = items[nextIndex];
    const layerId = target?.dataset.layerId;
    if (!target || !layerId) {
      return;
    }
    event.preventDefault();
    selectShortWorkspaceVideoLayer(layerId);
    elements.short_video_layer_list.querySelector<HTMLButtonElement>(
      `.short-video-layer-select[data-layer-id="${CSS.escape(layerId)}"]`
    )?.focus({ preventScroll: true });
  });
  const commitShortVideoTimelineBoundary = (side: "start" | "end") => {
    const selected = activeShortWorkspaceVideoLayer();
    const control = side === "start"
      ? elements.short_video_layer_start
      : elements.short_video_layer_end;
    const requestedMs = parseTime(control.value);
    if (!selected || requestedMs === null) {
      renderShortFramingInspector();
      showToast("영상의 쇼츠 시작·끝 시각을 다시 확인해 주세요.", "error");
      return;
    }
    const minimumDurationMs = SHORT_FORM_MIN_CLIP_DURATION_MS;
    const nextMs = side === "start"
      ? Math.max(
        0,
        selected.timelineStartMs - (
          selected.sourceStartMs - selected.sourceSelectionStartMs
        ),
        Math.min(requestedMs, selected.timelineEndMs - minimumDurationMs)
      )
      : Math.min(
        selected.timelineEndMs + (
          selected.sourceSelectionEndMs - selected.sourceEndMs
        ),
        Math.max(requestedMs, selected.timelineStartMs + minimumDurationMs)
      );
    const deltaMs = nextMs - (
      side === "start" ? selected.timelineStartMs : selected.timelineEndMs
    );
    let updated = false;
    try {
      updated = side === "start"
        ? updateSelectedShortVideoLayer({
          timelineStartMs: nextMs,
          sourceStartMs: selected.sourceStartMs + deltaMs
        })
        : updateSelectedShortVideoLayer({
          timelineEndMs: nextMs,
          sourceEndMs: selected.sourceEndMs + deltaMs
        });
    } catch {
      showToast(
        "같은 영상 라인에서는 블록이 겹칠 수 없습니다. 타임라인에서 빈 라인으로 옮기거나 + 버튼으로 라인을 추가해 주세요.",
        "error"
      );
    }
    if (!updated) {
      renderShortFramingInspector();
    }
  };
  elements.short_video_layer_start.addEventListener("change", () => {
    commitShortVideoTimelineBoundary("start");
  });
  elements.short_video_layer_end.addEventListener("change", () => {
    commitShortVideoTimelineBoundary("end");
  });
  elements.short_video_layer_opacity.addEventListener("input", () => {
    updateSelectedShortVideoLayer(
      { opacity: Number(elements.short_video_layer_opacity.value) / 100 },
      "short-video-layer-opacity"
    );
  });
  const finishShortVideoLayerOpacity = () => {
    endFieldEdit("short-video-layer-opacity");
    renderShortFramingInspector();
  };
  elements.short_video_layer_opacity.addEventListener(
    "change",
    finishShortVideoLayerOpacity
  );
  elements.short_video_layer_opacity.addEventListener(
    "blur",
    finishShortVideoLayerOpacity
  );
  elements.short_video_layer_volume.addEventListener("input", () => {
    updateSelectedShortVideoLayer(
      { audioGain: Number(elements.short_video_layer_volume.value) / 100 },
      "short-video-layer-volume"
    );
    applyPreviewAudioSettings(project.playheadMs);
  });
  const finishShortVideoLayerVolume = () => {
    endFieldEdit("short-video-layer-volume");
    renderShortFramingInspector();
    applyPreviewAudioSettings(project.playheadMs);
  };
  elements.short_video_layer_volume.addEventListener(
    "change",
    finishShortVideoLayerVolume
  );
  elements.short_video_layer_volume.addEventListener(
    "blur",
    finishShortVideoLayerVolume
  );
  elements.toggle_short_video_layer_visibility.addEventListener("click", () => {
    const selected = activeShortWorkspaceVideoLayer();
    if (
      selected
      && updateSelectedShortVideoLayer({ visible: !selected.visible })
    ) {
      showToast(selected.visible ? "영상을 숨겼습니다." : "영상을 다시 표시했습니다.");
    }
  });
  elements.delete_short_video_layer.addEventListener(
    "click",
    deleteSelectedShortVideoLayer
  );
  elements.short_workspace_squeegee_actions.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "button[data-short-workspace-squeegee]"
    );
    const direction = button?.dataset.shortWorkspaceSqueegee;
    if (
      direction === "left"
      || direction === "right"
      || direction === "top"
      || direction === "bottom"
      || direction === "all"
    ) {
      applyShortWorkspaceSqueegee(direction);
    }
  });

  elements.reset_short_workspace_framing.addEventListener("click", () => {
    const geometry = exactShortWorkspaceGeometry();
    const updated = geometry && replaceShortWorkspaceFraming({
      destinationRect: defaultShortDestinationRect(geometry.sourceRect)
    });
    if (updated) {
      showToast("선택 영상의 쇼츠 화면 배치를 초기화했습니다.");
    }
  });
  elements.copy_short_workspace_framing.addEventListener("click", () => {
    const selectedLayer = activeShortWorkspaceVideoLayer();
    const geometry = exactShortWorkspaceGeometry(selectedLayer);
    const updated = geometry && replaceShortWorkspaceFraming({
      destinationRect: geometry.destinationRect
    }, { all: true });
    if (updated) {
      showToast(
        `현재 화면 배치를 영상 ${project.shortForm.videoAssets.length}개에 적용했습니다. 각 영상에서 가져올 원본 영역은 유지됩니다.`,
        "success"
      );
    }
  });
  elements.short_workspace_safe_area.addEventListener("change", () => {
    elements.short_workspace_safe_area_overlay.hidden = (
      workspaceMode !== "short-form"
      || !elements.short_workspace_safe_area.checked
    );
  });
  const destinationFields = [
    [elements.short_workspace_destination_x, "x"],
    [elements.short_workspace_destination_y, "y"],
    [elements.short_workspace_destination_width, "width"],
    [elements.short_workspace_destination_height, "height"]
  ] as const;
  for (const [control, field] of destinationFields) {
    const fieldKey = `short-workspace-destination-${field}`;
    control.addEventListener("input", () => {
      updateShortWorkspaceDestinationField(field, control.value, fieldKey);
    });
    const finish = () => endFieldEdit(fieldKey);
    control.addEventListener("change", finish);
    control.addEventListener("blur", finish);
  }
  elements.short_workspace_transform_layer.addEventListener(
    "pointerdown",
    beginShortWorkspaceTransformGesture
  );
  elements.short_workspace_transform_layer.addEventListener(
    "pointermove",
    updateShortWorkspaceTransformGesture
  );
  elements.short_workspace_transform_layer.addEventListener("pointerup", (event) => {
    finishShortWorkspaceTransformGesture(event);
  });
  elements.short_workspace_transform_layer.addEventListener("pointercancel", (event) => {
    finishShortWorkspaceTransformGesture(event, { cancel: true });
  });
  elements.short_workspace_transform_layer.addEventListener("lostpointercapture", (event) => {
    finishShortWorkspaceTransformGesture(event as PointerEvent);
  });
  elements.short_workspace_transform_layer.addEventListener(
    "keydown",
    nudgeShortWorkspaceTransformFromKeyboard
  );
  elements.short_workspace_transform_layer.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      endFieldEdit("short-workspace-transform-keyboard");
    }
  });
  elements.short_workspace_transform_layer.addEventListener("focusout", (event) => {
    if (!elements.short_workspace_transform_layer.contains(event.relatedTarget as Node | null)) {
      endFieldEdit("short-workspace-transform-keyboard");
    }
  });
  elements.add_cue.addEventListener("click", () => addCueAtPlayhead());
  elements.add_cue_top.addEventListener("click", () => addCueAtPlayhead());
  elements.add_audio_region.addEventListener("click", () => addAudioRegionAtTimeline());
  elements.add_subtitle_lane.addEventListener("click", () => {
    const next = addSubtitleLane(project);
    if (next === project) {
      showToast(`자막 레인은 최대 ${MAX_SUBTITLE_LANES}개까지 만들 수 있습니다.`);
      return;
    }
    applyProject(next);
    showToast(`${next.subtitleLaneCount}번째 자막 레인을 추가했습니다.`, "success");
  });
  elements.cue_text.addEventListener("input", () => {
    const cue = selectedCue();
    if (cue) {
      applyFieldProject(
        updateSubtitleCue(project, cue.id, { text: elements.cue_text.value }),
        "cue-text"
      );
    }
  });
  elements.cue_text.addEventListener("blur", () => endFieldEdit("cue-text"));
  elements.cue_start.addEventListener("change", () => {
    const cue = selectedCue();
    const clip = project.clips.find((candidate) => candidate.id === cue?.clipId);
    const timelineMs = parseTime(elements.cue_start.value);
    if (!cue || !clip || timelineMs === null) {
      if (cue) {
        const range = cueTimelineRange(project, cue);
        elements.cue_start.value = formatTime(range!.startMs, { compact: true });
      }
      showToast("자막 시작 시각 형식을 확인해 주세요.", "error");
      return;
    }
    updateSelectedCue({ startOffsetMs: timelineMs - clip.timelineStartMs });
    const updated = selectedCue();
    elements.cue_start.value = formatTime(
      cueTimelineRange(project, updated!)!.startMs,
      { compact: true }
    );
  });
  elements.cue_end.addEventListener("change", () => {
    const cue = selectedCue();
    const clip = project.clips.find((candidate) => candidate.id === cue?.clipId);
    const timelineMs = parseTime(elements.cue_end.value);
    if (!cue || !clip || timelineMs === null) {
      if (cue) {
        const range = cueTimelineRange(project, cue);
        elements.cue_end.value = formatTime(range!.endMs, { compact: true });
      }
      showToast("자막 종료 시각 형식을 확인해 주세요.", "error");
      return;
    }
    updateSelectedCue({ endOffsetMs: timelineMs - clip.timelineStartMs });
    const updated = selectedCue();
    elements.cue_end.value = formatTime(
      cueTimelineRange(project, updated!)!.endMs,
      { compact: true }
    );
  });
  elements.cue_x.addEventListener("input", () => {
    const cue = selectedCue();
    if (cue) {
      applyFieldProject(
        updateSubtitleCue(project, cue.id, { x: Number(elements.cue_x.value) / 100 }),
        "cue-x"
      );
    }
  });
  elements.cue_y.addEventListener("input", () => {
    const cue = selectedCue();
    if (cue) {
      applyFieldProject(
        updateSubtitleCue(project, cue.id, { y: Number(elements.cue_y.value) / 100 }),
        "cue-y"
      );
    }
  });
  elements.cue_x.addEventListener("change", () => endFieldEdit("cue-x"));
  elements.cue_y.addEventListener("change", () => endFieldEdit("cue-y"));
  elements.font_size.addEventListener("input", () => {
    const cue = selectedCue();
    if (cue) {
      applyFieldProject(
        updateSubtitleCue(project, cue.id, {
          fontScale: Number(elements.font_size.value) / 100
        }),
        "font-size"
      );
    }
  });
  elements.font_color.addEventListener("input", () => {
    const cue = selectedCue();
    if (cue) {
      applyFieldProject(
        updateSubtitleCue(project, cue.id, { color: elements.font_color.value }),
        "font-color"
      );
    }
  });
  elements.font_size.addEventListener("change", () => endFieldEdit("font-size"));
  elements.font_color.addEventListener("change", () => {
    const remembered = rememberSubtitleColor(
      project,
      elements.font_color.value
    );
    if (remembered) {
      applyFieldProject(remembered, "font-color");
    }
    endFieldEdit("font-color");
  });
  elements.caption_color_register.addEventListener("click", (event) => {
    const button = (event.target! as EditorControl).closest(
      ".caption-color-swatch[data-color]"
    ) as EditorControl | null;
    const cue = selectedCue();
    const color = button?.dataset.color;
    if (!button || !cue || !color) {
      return;
    }
    const colored = updateSubtitleCue(project, cue.id, { color });
    const remembered = rememberSubtitleColor(colored, color);
    if (remembered) {
      applyProject(remembered);
    }
  });
  elements.reset_font_color.addEventListener("click", () => {
    const cue = selectedCue();
    if (cue) {
      updateSelectedCue({ color: DEFAULT_SUBTITLE_COLOR });
    }
  });
  elements.match_cue_to_asset.addEventListener("click", () => {
    const cue = selectedCue();
    const asset = selectedImageAsset();
    if (!cue || !asset || cue.clipId !== asset.clipId) {
      showToast("같은 컷의 자막과 이미지를 먼저 선택해 주세요.", "error");
      renderCueInspector();
      return;
    }
    const next = matchSubtitleCueToImageAsset(project, cue.id, asset.id);
    if (cueHasOverlap(next, cue.id)) {
      showToast("맞춘 구간이 같은 자막 레인의 다른 자막과 겹칩니다.", "error");
      return;
    }
    applyProject(next);
    showToast("자막을 선택 이미지의 시작·끝 시각에 정확히 맞췄습니다.", "success");
  });
  elements.delete_cue.addEventListener("click", () => {
    const cue = selectedCue();
    if (cue) {
      applyProject(deleteSubtitleCue(project, cue.id));
    }
  });
  elements.cue_list.addEventListener("click", (event) => {
    const item = (event.target! as EditorControl).closest(
      ".cue-list-item"
    ) as EditorControl | null;
    const cueId = item?.dataset.id;
    if (cueId) {
      selectCue(cueId, { seek: true });
    }
  });
  captionInspectorTab.addEventListener("click", () => {
    inspectorMode = "selected";
    renderCueInspector();
  });
  elements.cue_list_tab.addEventListener("click", () => {
    inspectorMode = "list";
    renderCueInspector();
  });
  for (const tab of [captionInspectorTab, elements.cue_list_tab]) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const next = event.key === "ArrowLeft" || event.key === "Home"
        ? captionInspectorTab
        : elements.cue_list_tab;
      next.click();
      next.focus();
    });
  }

  const restoreAssetTimeFields = () => {
    const asset = selectedImageAsset();
    const range = asset ? imageAssetTimelineRange(project, asset) : null;
    if (!range) {
      renderImageAssetInspector();
      return;
    }
    elements.asset_start.value = formatTime(range.startMs, { compact: true });
    elements.asset_end.value = formatTime(range.endMs, { compact: true });
  };
  elements.asset_start.addEventListener("change", () => {
    const asset = selectedImageAsset();
    const clip = project.clips.find((candidate) => candidate.id === asset?.clipId);
    const timelineMs = parseTime(elements.asset_start.value);
    if (!asset || !clip || timelineMs === null) {
      restoreAssetTimeFields();
      showToast("이미지 시작 시각 형식을 확인해 주세요.", "error");
      return;
    }
    updateSelectedImageAsset({ startOffsetMs: timelineMs - clip.timelineStartMs });
    restoreAssetTimeFields();
  });
  elements.asset_end.addEventListener("change", () => {
    const asset = selectedImageAsset();
    const clip = project.clips.find((candidate) => candidate.id === asset?.clipId);
    const timelineMs = parseTime(elements.asset_end.value);
    if (!asset || !clip || timelineMs === null) {
      restoreAssetTimeFields();
      showToast("이미지 종료 시각 형식을 확인해 주세요.", "error");
      return;
    }
    updateSelectedImageAsset({ endOffsetMs: timelineMs - clip.timelineStartMs });
    restoreAssetTimeFields();
  });
  elements.match_asset_to_cue.addEventListener("click", () => {
    const asset = selectedImageAsset();
    const cue = selectedCue();
    if (!asset || !cue || asset.clipId !== cue.clipId) {
      showToast("같은 컷의 이미지와 자막을 먼저 선택해 주세요.", "error");
      renderImageAssetInspector();
      return;
    }
    applyProject(matchImageAssetToSubtitleCue(project, asset.id, cue.id));
    showToast("이미지를 선택 자막의 시작·끝 시각에 정확히 맞췄습니다.", "success");
  });
  elements.asset_x.addEventListener("input", () => {
    updateSelectedImageAsset(
      { x: Number(elements.asset_x.value) / 100 },
      { fieldKey: "asset-x" }
    );
  });
  elements.asset_y.addEventListener("input", () => {
    updateSelectedImageAsset(
      { y: Number(elements.asset_y.value) / 100 },
      { fieldKey: "asset-y" }
    );
  });
  elements.asset_scale.addEventListener("input", () => {
    updateSelectedImageAsset(
      { scale: Number(elements.asset_scale.value) / 100 },
      { fieldKey: "asset-scale" }
    );
  });
  elements.asset_opacity.addEventListener("input", () => {
    updateSelectedImageAsset(
      { opacity: Number(elements.asset_opacity.value) / 100 },
      { fieldKey: "asset-opacity" }
    );
  });
  elements.asset_x.addEventListener("change", () => endFieldEdit("asset-x"));
  elements.asset_y.addEventListener("change", () => endFieldEdit("asset-y"));
  elements.asset_scale.addEventListener("change", () => endFieldEdit("asset-scale"));
  elements.asset_opacity.addEventListener("change", () => endFieldEdit("asset-opacity"));
  elements.delete_asset.addEventListener("click", () => deleteSelectedImageAsset());

  const restoreAudioTimeFields = () => {
    const region = selectedAudioRegion();
    const range = region ? audioRegionTimelineRange(project, region) : null;
    if (!range) {
      renderAudioInspector();
      return;
    }
    elements.audio_start.value = formatTime(range.startMs, { compact: true });
    elements.audio_end.value = formatTime(range.endMs, { compact: true });
  };
  elements.audio_start.addEventListener("change", () => {
    const region = selectedAudioRegion();
    const clip = project.clips.find((candidate) => candidate.id === region?.clipId);
    const timelineMs = parseTime(elements.audio_start.value);
    if (!region || !clip || timelineMs === null) {
      restoreAudioTimeFields();
      showToast("음성 구간 시작 시각 형식을 확인해 주세요.", "error");
      return;
    }
    updateSelectedAudioRegion({ startOffsetMs: timelineMs - clip.timelineStartMs });
    restoreAudioTimeFields();
  });
  elements.audio_end.addEventListener("change", () => {
    const region = selectedAudioRegion();
    const clip = project.clips.find((candidate) => candidate.id === region?.clipId);
    const timelineMs = parseTime(elements.audio_end.value);
    if (!region || !clip || timelineMs === null) {
      restoreAudioTimeFields();
      showToast("음성 구간 종료 시각 형식을 확인해 주세요.", "error");
      return;
    }
    updateSelectedAudioRegion({ endOffsetMs: timelineMs - clip.timelineStartMs });
    restoreAudioTimeFields();
  });
  elements.audio_volume.addEventListener("input", () => {
    const region = selectedAudioRegion();
    if (!region) {
      return;
    }
    applyFieldProject(
      updateAudioRegion(project, region.id, { gain: Number(elements.audio_volume.value) / 100 }),
      "audio-volume"
    );
    applyPreviewAudioSettings();
  });
  elements.audio_volume.addEventListener("change", () => endFieldEdit("audio-volume"));
  elements.audio_mute.addEventListener("click", () => {
    const region = selectedAudioRegion();
    if (region) {
      updateSelectedAudioRegion({ muted: !region.muted });
    }
  });
  elements.audio_fade_in.addEventListener("input", () => {
    const region = selectedAudioRegion();
    if (!region) {
      return;
    }
    applyFieldProject(
      updateAudioRegion(project, region.id, { fadeInMs: Number(elements.audio_fade_in.value) }),
      "audio-fade-in"
    );
    applyPreviewAudioSettings();
  });
  elements.audio_fade_out.addEventListener("input", () => {
    const region = selectedAudioRegion();
    if (!region) {
      return;
    }
    applyFieldProject(
      updateAudioRegion(project, region.id, { fadeOutMs: Number(elements.audio_fade_out.value) }),
      "audio-fade-out"
    );
    applyPreviewAudioSettings();
  });
  elements.audio_fade_in.addEventListener("change", () => endFieldEdit("audio-fade-in"));
  elements.audio_fade_out.addEventListener("change", () => endFieldEdit("audio-fade-out"));
  elements.reset_audio_region.addEventListener("click", () => {
    updateSelectedAudioRegion({ gain: 1, muted: false, fadeInMs: 0, fadeOutMs: 0 });
  });
  elements.delete_audio_region.addEventListener("click", () => {
    const region = selectedAudioRegion();
    if (region) {
      applyProject(deleteAudioRegion(project, region.id));
    }
  });

  elements.generate_captions.addEventListener("click", () => void generateCaptions());
  elements.reset_ai_caption_positions.addEventListener("click", () => {
    void queueLocalDraftOperation(resetAllAiCaptionPositions)
      .catch((error: unknown) => {
        showToast(`AI 자막 위치를 정렬하지 못했습니다: ${errorMessage(error)}`, "error", 0);
      });
  });
  elements.test_caption_agent.addEventListener("click", () => void testCaptionAgentConnection());
  elements.toggle_caption_background.addEventListener("click", () => {
    const cue = selectedCue();
    if (!cue) {
      return;
    }
    const enabled = !resolveSubtitleCueBackground(
      project.subtitleDefaults,
      cue
    ).enabled;
    updateSelectedCue({ backgroundEnabled: enabled });
    showToast(
      enabled
        ? "이 자막에 검은 사각 배경을 켰습니다."
        : "이 자막의 검은 배경을 껐습니다.",
      "success"
    );
  });
  const selectAdjacentCueInLane = (direction: -1 | 1) => {
    const cue = selectedCue();
    const adjacentCue = cue
      ? adjacentSubtitleCueInLane(project, cue.id, direction)
      : null;
    if (adjacentCue) {
      selectCue(adjacentCue.id, { seek: true });
    }
  };
  elements.previous_cue_in_lane.addEventListener("click", () => {
    selectAdjacentCueInLane(-1);
  });
  elements.next_cue_in_lane.addEventListener("click", () => {
    selectAdjacentCueInLane(1);
  });
  elements.caption_style_preset.addEventListener("change", () => {
    const preset = captionStylePreset(elements.caption_style_preset.value);
    const styledProject = applyCaptionStylePreset(project, preset.id);
    if (styledProject) {
      applyProject(styledProject);
    }
    if (document.fonts?.load) {
      void document.fonts
        .load(
          `${preset.typography.fontWeight} 48px "${preset.typography.fontFamily}"`
        )
        .then(renderSubtitleOverlay)
        .catch((error: unknown) => {
          showToast(`자막 폰트를 준비하지 못했습니다: ${errorMessage(error)}`, "error", 0);
        });
    }
    showToast(`${preset.displayName} 스타일을 적용했습니다.`, "success", 3600);
  });
  elements.audseg_provider_tab.addEventListener("click", () => {
    selectCaptionProvider(AUDSEG_DRAFT_MODEL);
  });
  elements.whisper_provider_tab.addEventListener("click", () => {
    selectCaptionProvider("whisper-tiny");
  });
  const moveCaptionProviderTab = (event: KeyboardEvent) => {
    let model: CaptionModel | null = null;
    if (["ArrowLeft", "ArrowUp", "Home"].includes(event.key)) {
      model = AUDSEG_DRAFT_MODEL;
    } else if (["ArrowRight", "ArrowDown", "End"].includes(event.key)) {
      model = "whisper-tiny";
    }
    if (!model) {
      return;
    }
    event.preventDefault();
    selectCaptionProvider(model, { focus: true });
  };
  elements.audseg_provider_tab.addEventListener("keydown", moveCaptionProviderTab);
  elements.whisper_provider_tab.addEventListener("keydown", moveCaptionProviderTab);
  elements.connect_local_whisper.addEventListener("click", () => {
    void testCaptionAgentConnection();
  });
  elements.cancel_job.addEventListener("click", cancelActiveJob);
  elements.job_dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (activeJobController && activeJobCancelable) {
      cancelActiveJob();
    }
  });
  elements.job_dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") {
      return;
    }
    event.preventDefault();
    const target = elements.cancel_job.hidden
      ? elements.job_dialog.querySelector(".job-card")
      : elements.cancel_job;
    (target! as EditorControl).focus();
  });
  elements.timeline_zoom.addEventListener("input", () => {
    pixelsPerSecond = Number(elements.timeline_zoom.value);
    hideTimelineSnapGuide();
    renderTimeline();
  });
  elements.fit_timeline.addEventListener("click", () => {
    const durationSeconds = Math.max(1, projectDurationMs(project) / 1000);
    pixelsPerSecond = Math.max(20, Math.min(240, (elements.timeline_scroll.clientWidth - 20) / durationSeconds));
    elements.timeline_zoom.value = String(Math.round(pixelsPerSecond));
    hideTimelineSnapGuide();
    renderTimeline();
  });
  elements.toggle_timeline_collapse.addEventListener("click", () => {
    timelineCollapsed = !timelineCollapsed;
    renderTimelineCollapseState();
    renderAfterWorkspaceLayoutChange();
  });
  elements.toggle_timeline_snap.addEventListener("click", () => {
    timelineSnapEnabled = !timelineSnapEnabled;
    elements.toggle_timeline_snap.classList.toggle("active", timelineSnapEnabled);
    elements.toggle_timeline_snap.setAttribute("aria-pressed", String(timelineSnapEnabled));
    elements.toggle_timeline_snap.title = editorShortcutTitle(
      "toggle-timeline-snap",
      timelineSnapEnabled
        ? "타임라인 자석 켜짐 · 드래그 중 Alt로 잠시 해제"
        : "타임라인 자석 꺼짐"
    );
    if (!timelineSnapEnabled) {
      hideTimelineSnapGuide();
    }
    showToast(
      timelineSnapEnabled
        ? "타임라인 자석을 켰습니다. 드래그 중 Alt로 잠시 해제할 수 있어요."
        : "타임라인 자석을 껐습니다."
    );
  });

  elements.video_track.addEventListener("contextmenu", openTimelineContextMenu);
  elements.caption_tracks.addEventListener("contextmenu", openTimelineContextMenu);
  elements.asset_track.addEventListener("contextmenu", openTimelineContextMenu);
  elements.audio_track.addEventListener("contextmenu", openTimelineContextMenu);
  elements.context_set_range_start.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context) {
      setTimelineRangeBoundary("start", context.timelineMs, {
        constrain: shortSourceComposerActive
          && timelineRangePurpose === "short-source"
      });
    }
  });
  elements.context_set_range_end.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context) {
      setTimelineRangeBoundary("end", context.timelineMs, {
        constrain: shortSourceComposerActive
          && timelineRangePurpose === "short-source"
      });
    }
  });
  elements.context_delete_range.addEventListener("click", () => {
    closeTimelineContextMenu();
    deleteSelectedTimelineRange();
  });
  elements.context_add_cue.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context) {
      addCueAtPlayhead({ timelineMs: context.timelineMs, lane: context.lane });
    }
  });
  elements.context_paste_asset.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context) {
      void pasteImageFromSystemClipboard(context.timelineMs);
    }
  });
  elements.context_pick_asset.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context) {
      openImageAssetFilePicker(context.timelineMs);
    }
  });
  elements.context_add_audio.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context) {
      addAudioRegionAtTimeline(context.timelineMs);
    }
  });
  elements.context_delete_cue.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context?.cueId) {
      applyProject(deleteSubtitleCue(project, context.cueId));
    }
  });
  elements.context_delete_asset.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context?.imageAssetId) {
      deleteSelectedImageAsset(context.imageAssetId);
    }
  });
  elements.context_delete_audio.addEventListener("click", () => {
    const context = timelineContext;
    closeTimelineContextMenu();
    if (context?.audioRegionId) {
      applyProject(deleteAudioRegion(project, context.audioRegionId));
    }
  });
  elements.context_add_lane.addEventListener("click", () => {
    closeTimelineContextMenu();
    const next = addSubtitleLane(project);
    if (next !== project) {
      applyProject(next);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!elements.timeline_context_menu.hidden && !(event.target! as EditorControl).closest("#timeline-context-menu")) {
      closeTimelineContextMenu();
    }
  });
  elements.timeline_scroll.addEventListener("scroll", closeTimelineContextMenu, { passive: true });
  window.addEventListener("blur", closeTimelineContextMenu);

  bindOverlayDrag();
  bindImageAssetOverlayDrag();
  bindTimelineSeeking();
  window.addEventListener("resize", () => {
    renderTimeline({ keepScroll: true });
    void renderImageAssetOverlays();
    renderSubtitleOverlay();
    renderShortSourceComposer();
    renderShortWorkspaceTransformOverlay();
  });
  window.addEventListener("keydown", (event) => {
    if (elements.editor_shell.hidden || elements.editor_shell.inert) {
      return;
    }
    try {
      requireActiveUsagePolicySession();
    } catch {
      event.preventDefault();
      return;
    }
    const editingText = (event.target! as EditorControl).matches("input, textarea, select, [contenteditable='true']");
    const interactive = Boolean((event.target! as EditorControl).closest(
      "button, a, input, textarea, select, [contenteditable='true'], [role='slider'], [role='tab']"
    ));
    if (elements.editing_session_exit_dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditingSessionExitDialog();
      }
      return;
    }
    if (elements.caption_sheet_dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCaptionPropertiesSheet();
      }
      return;
    }
    if (elements.subtitle_sync_guide_dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSubtitleSyncGuide();
      }
      return;
    }
    if (elements.export_options_dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeExportOptionsDialog();
      }
      return;
    }
    if (elements.cleanup_after_export_dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        resolveExportCleanupDialog(false);
      }
      return;
    }
    if (elements.local_draft_dialog.open) {
      if (event.key === "Escape" && !localDraftOperationActive) {
        event.preventDefault();
        closeLocalDraftDialog();
      }
      return;
    }
    if (event.key === "Escape" && !elements.timeline_context_menu.hidden) {
      event.preventDefault();
      closeTimelineContextMenu();
      return;
    }
    if (!elements.job_dialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeJobController) {
          cancelActiveJob();
        }
      }
      return;
    }
    if (!editingText && event.key === "Escape" && shortSourceComposerActive) {
      event.preventDefault();
      if (shortSourcePickerReturnState) {
        void restoreShortWorkspaceAfterSourcePicker();
      } else {
        cancelShortSourceComposer();
      }
      return;
    }
    if (!editingText && event.key === "Escape" && (Number.isFinite(rangeStartMs) || Number.isFinite(rangeEndMs))) {
      event.preventDefault();
      clearTimelineRangeSelection();
      return;
    }
    const shortcutLetter = keyboardShortcutLetterFromEvent(event);
    const shortcutBinding = shortcutLetter
      ? editorKeyboardShortcutBinding(shortcutLetter)
      : null;
    const shortcutTarget = shortcutBinding
      ? usableEditorShortcutTarget(shortcutBinding)
      : null;
    const captionColorDigit = captionColorShortcutDigitFromEvent(event);
    const captionColorTarget = captionColorDigit
      ? document.querySelector<HTMLButtonElement>(
        `#caption-color-register .caption-color-swatch[data-shortcut="${captionColorDigit}"][data-color]`
      )
      : null;
    const clipNavigationDirection = clipNavigationShortcutDirectionFromEvent(event);
    const clipNavigationTarget = clipNavigationDirection === -1
      ? elements.previous_clip
      : clipNavigationDirection === 1
        ? elements.next_clip
        : null;
    const spaceCode = String(event.code || "");
    const spaceShortcut = (
      spaceCode === "Space"
      || (
        (!spaceCode || spaceCode === "Unidentified")
        && (event.key === " " || event.key === "Spacebar")
      )
    ) && !isKeyboardShortcutEventBlocked(event);
    if (!editingText && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if (!editingText && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (
      captionColorTarget
      && !captionColorTarget.disabled
      && !captionColorTarget.closest("[hidden]")
    ) {
      event.preventDefault();
      captionColorTarget.click();
    } else if (clipNavigationTarget && !clipNavigationTarget.disabled) {
      event.preventDefault();
      clipNavigationTarget.click();
    } else if (shortcutBinding && shortcutTarget) {
      event.preventDefault();
      if (shortcutBinding.trigger === "focus") {
        shortcutTarget.focus({ preventScroll: false });
      } else {
        shortcutTarget.click();
      }
    } else if (!interactive && spaceShortcut) {
      event.preventDefault();
      void togglePlayback();
    } else if (
      !editingText
      && timelineRangePurpose !== "short-source"
      && !shortSourceComposerActive
      && workspaceMode !== "short-form"
      && (event.key === "Delete" || event.key === "Backspace")
      && selectedTimelineRange()
    ) {
      event.preventDefault();
      deleteSelectedTimelineRange();
    } else if (!interactive && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const delta = event.shiftKey ? 1_000 : 100;
      void seekTimeline(project.playheadMs + (event.key === "ArrowLeft" ? -delta : delta));
    }
  });
}

type CaptureSeed = NonNullable<
  Parameters<typeof mergeCaptureIntoEditorProject>[1]
>;

type LoadedSeed = {
  projectId: string;
  captureState: CaptureSeed | null;
  openRecoveryDrafts: boolean;
  seedStorageKey: string | null;
};

function captureSeedFromUnknown(value: unknown): CaptureSeed {
  if (!isRecord(value)) {
    throw new TypeError("편집할 캡처 데이터 형식이 올바르지 않습니다.");
  }
  if (
    value.source != null
    && !isRecord(value.source)
  ) {
    throw new TypeError("캡처 원본 정보 형식이 올바르지 않습니다.");
  }
  if (
    value.draft != null
    && !isRecord(value.draft)
  ) {
    throw new TypeError("캡처 임시 구간 형식이 올바르지 않습니다.");
  }
  if (
    value.segments != null
    && (
      !Array.isArray(value.segments)
      || !value.segments.every(isRecord)
    )
  ) {
    throw new TypeError("캡처 구간 목록 형식이 올바르지 않습니다.");
  }
  return value as CaptureSeed;
}

function normalizeMaterializedProjectSourceClock(
  storedProject: EditorProject
): EditorProject {
  if (!projectUsesChzzkMaterializedMedia(storedProject)) {
    return storedProject;
  }
  const rawOffsetValue = storedProject.broadcastSession?.alignmentOffsetMs;
  const numericOffsetMs = Number(rawOffsetValue);
  const staleOffsetMs = Number.isSafeInteger(numericOffsetMs)
    ? numericOffsetMs
    : 0;
  const metadataAlreadyCanonical = (
    typeof rawOffsetValue === "number"
    && rawOffsetValue === 0
    && storedProject.broadcastSession?.alignmentConfirmed === true
  );
  if (metadataAlreadyCanonical) {
    return storedProject;
  }
  const materialization = projectMaterialization(storedProject);
  const coverageByClipId = new Map(
    (materialization?.clipRanges || []).map((range) => [range.clipId, range])
  );
  const selectionCounts = new Map<string, number>();
  for (const clip of storedProject.clips) {
    selectionCounts.set(
      clip.selectionId,
      (selectionCounts.get(clip.selectionId) || 0) + 1
    );
  }

  // A materialized VOD is already mapped to the platform source clock, so a
  // manual-file alignment value must never be applied to a later capture. Old
  // builds could persist exactly one handle (+10s) in both the metadata and an
  // otherwise untouched clip. Repair that legacy representation only when the
  // validated v2 receipt independently proves the immutable USER selection
  // anchor. Split/trimmed clips and receipts without exact lineage stay as the
  // user authored them.
  const repairedClipIds = new Set<string>();
  const canRepairLegacyHandle = Boolean(
    materialization
    && staleOffsetMs === materialization.handleMs
    && staleOffsetMs !== 0
  );
  const clips = storedProject.clips.map((clip) => {
    const coverage = coverageByClipId.get(clip.id);
    const repair = Boolean(
      canRepairLegacyHandle
      && selectionCounts.get(clip.selectionId) === 1
      && coverage
      && coverage.sourceStartMs === clip.selectionStartMs
      && coverage.sourceEndMs === clip.selectionEndMs
      && clip.sourceStartMs === coverage.sourceStartMs + staleOffsetMs
      && clip.sourceEndMs === coverage.sourceEndMs + staleOffsetMs
    );
    if (!repair) {
      return clip;
    }
    repairedClipIds.add(clip.id);
    return {
      ...clip,
      sourceStartMs: coverage!.sourceStartMs,
      sourceEndMs: coverage!.sourceEndMs
    };
  });
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const repairedLineageIds = new Set(repairedClipIds);
  const repairShortSource = <T extends {
    sourceClipId: string;
    sourceStartMs: number;
    sourceEndMs: number;
    sourceSelectionStartMs: number;
    sourceSelectionEndMs: number;
  }>(asset: T): T => {
    const clip = clipsById.get(asset.sourceClipId);
    const coverage = coverageByClipId.get(asset.sourceClipId);
    if (
      !canRepairLegacyHandle
      || !coverage
      || asset.sourceSelectionStartMs !== coverage.sourceStartMs + staleOffsetMs
      || asset.sourceSelectionEndMs !== coverage.sourceEndMs + staleOffsetMs
    ) {
      return asset;
    }
    const sourceStartMs = asset.sourceStartMs - staleOffsetMs;
    const sourceEndMs = asset.sourceEndMs - staleOffsetMs;
    if (
      sourceStartMs < coverage.sourceStartMs
      || sourceEndMs > coverage.sourceEndMs
      || sourceEndMs <= sourceStartMs
      || (
        clip
        && (
          clip.selectionStartMs !== coverage.sourceStartMs
          || clip.selectionEndMs !== coverage.sourceEndMs
        )
      )
    ) {
      return asset;
    }
    repairedLineageIds.add(asset.sourceClipId);
    return {
      ...asset,
      sourceStartMs,
      sourceEndMs,
      sourceSelectionStartMs: coverage.sourceStartMs,
      sourceSelectionEndMs: coverage.sourceEndMs
    };
  };
  const videoAssets = storedProject.shortForm.videoAssets.map(
    repairShortSource
  );
  const sourceAudioAssets = storedProject.shortForm.sourceAudioAssets.map(
    repairShortSource
  );
  return {
    ...storedProject,
    broadcastSession: {
      ...storedProject.broadcastSession,
      alignmentOffsetMs: 0,
      alignmentConfirmed: true
    },
    clips,
    shortForm: {
      ...storedProject.shortForm,
      videoAssets,
      sourceAudioAssets,
      ai: storedProject.shortForm.ai
        ? {
          ...storedProject.shortForm.ai,
          captionCheckpoints: (
            storedProject.shortForm.ai.captionCheckpoints || []
          ).filter((checkpoint) => !repairedLineageIds.has(checkpoint.clipId))
        }
        : null
    },
    ai: {
      ...storedProject.ai,
      captionCheckpoints: (storedProject.ai.captionCheckpoints || []).filter(
        (checkpoint) => !repairedLineageIds.has(checkpoint.clipId)
      )
    }
  };
}

function shouldAutoPrepareInitialVod(
  candidateProject: EditorProject,
  purpose: UsagePolicyPurpose | null | undefined = usagePolicySession?.purpose,
  attempted = initialVodAutoPrepareAttempted
): boolean {
  return (
    !attempted
    && purpose === "editor-new"
    && !candidateProject.mediaAsset
    && Boolean(chzzkVodSourceUrl(candidateProject))
  );
}

async function loadSeed(): Promise<LoadedSeed> {
  const params = new URLSearchParams(location.search);
  const requestedProjectId = params.get("project");
  const resumeSavedSession = params.get("session") === "resume";
  const openRecoveryDrafts = (
    resumeSavedSession && params.get("recovery") === "drafts"
  );
  if (resumeSavedSession) {
    if (!requestedProjectId) {
      throw new Error("다시 열 편집 프로젝트 ID가 없습니다.");
    }
    return {
      projectId: requestedProjectId,
      captureState: null,
      openRecoveryDrafts,
      seedStorageKey: null
    };
  }
  if (requestedProjectId) {
    const key = `${EDITOR_SEED_PREFIX}${requestedProjectId}`;
    const stored = await studioStorageArea().get(key);
    const seed = stored[key];
    if (isRecord(seed) && Object.hasOwn(seed, "captureState")) {
      const activePolicy = requireActiveUsagePolicySession();
      if (
        seed.projectId !== requestedProjectId
        || seed.sourceSessionId !== activePolicy.sourceSessionId
        || seed.sessionLeaseId !== activePolicy.sessionLeaseId
        || seed.transitionGeneration !== activePolicy.transitionGeneration
      ) {
        throw new Error(
          "이번 편집 세대와 캡처 원본 데이터가 달라 새 프로젝트를 만들지 않았습니다. 시작 화면에서 다시 열어 주세요."
        );
      }
      return {
        projectId: requestedProjectId,
        captureState: captureSeedFromUnknown(seed.captureState),
        openRecoveryDrafts: false,
        seedStorageKey: key
      };
    }
    return {
      projectId: requestedProjectId,
      captureState: null,
      openRecoveryDrafts: false,
      seedStorageKey: Object.hasOwn(stored, key) ? key : null
    };
  }
  throw new Error(
    "직접 편집기 URL로는 시작할 수 없습니다. 시작 화면에서 이번 사용 정책을 입력해 주세요."
  );
}

async function restoreMedia() {
  if (projectUsesChzzkMaterializedMedia()) {
    if (!projectMaterialization() || !chzzkVodRightsConfirmation(project)) {
      showToast(
        "저장된 VOD 편집 구간 정보가 올바르지 않습니다. ‘편집 영상 준비’를 다시 실행해 주세요.",
        "error",
        0
      );
      return;
    }
    await prepareChzzkVodMedia({ restore: true });
    return;
  }
  if (shouldAutoPrepareInitialVod(project)) {
    initialVodAutoPrepareAttempted = true;
    await prepareChzzkVodMedia();
    return;
  }
  if (!project.mediaAsset) {
    // A session archive intentionally detaches media unless its recovery
    // descriptor exactly matched the current transport. Never let an orphaned
    // FileSystemHandle silently bind an unrelated older file again.
    return;
  }
  if (project.mediaAsset?.fileHandleStored === false) {
    showToast("이 원본의 파일 권한은 저장되지 않았습니다. ‘내 파일 직접 연결’에서 파일을 다시 선택해 주세요.");
    return;
  }
  const restored = await getFileFromStoredHandle(project.id);
  if (restored?.file) {
    const expected = project.mediaAsset;
    const exactStoredFile = (
      typeof expected.name === "string"
      && expected.name === restored.file.name
      && Number(expected.size) === restored.file.size
      && Number(expected.lastModified) === restored.file.lastModified
      && String(expected.type || "").trim().toLowerCase()
        === restored.file.type.trim().toLowerCase()
    );
    if (!exactStoredFile) {
      const removed = await deleteMediaHandle(project.id);
      showToast(
        removed
          ? "저장된 파일 핸들이 현재 편집 원본과 달라 자동 연결하지 않고 제거했습니다."
          : "저장된 파일 핸들이 현재 편집 원본과 달라 자동 연결하지 않았습니다. 브라우저 사이트 데이터를 정리하거나 원본을 직접 다시 연결해 주세요.",
        "error",
        0
      );
      return;
    }
    mediaHandle = restored.handle;
    await attachMediaFile(restored.file, { fileHandleStored: true });
  } else if (restored?.handle) {
    showToast("저장된 원본 파일을 다시 쓰려면 ‘내 파일 직접 연결’을 눌러 권한을 확인해 주세요.");
  } else if (restored?.error) {
    showToast("저장된 원본 파일 연결이 만료되었습니다. ‘내 파일 직접 연결’에서 다시 선택해 주세요.", "error");
  }
}

async function initializeSourceBinding() {
  try {
    const activePolicy = requireActiveUsagePolicySession();
    const response = await studioEditorReady({
      projectId: project.id,
      sourceSessionId: activePolicy.sourceSessionId,
      ...(activePolicy.sessionLeaseId
        ? {
          sessionLeaseId: activePolicy.sessionLeaseId,
          transitionGeneration: activePolicy.transitionGeneration
        }
        : {}),
      sourceUrl: String(
        project.source?.canonicalUrl || project.source?.url || ""
      )
    });
    sourceBindingConnected = Boolean(response?.ok && response?.connected);
  } catch {
    sourceBindingConnected = false;
  }
}

async function initialize() {
  if (!isKirinukiStudioOrigin(location.origin)) {
    showEditorAppGate();
    return;
  }
  if (currentClientCannotUseEditor()) {
    showEditorMobileGate();
    return;
  }
  const verifiedProjectId = await verifyEditorUsagePolicyGate();
  await primeLocalMediaEngineTrust().catch((error) => {
    console.warn("로컬 엔진 identity 사전 확인에 실패했습니다.", error);
  });
  const projectId = verifiedProjectId;
  if (!await acquireStudioProjectWriter(projectId)) {
    throw new Error(
      "이 프로젝트가 이미 다른 탭에서 편집 중입니다. 기존 탭을 사용하거나 닫은 뒤 다시 열어 주세요."
    );
  }
  const checkpointPolicy = requireActiveUsagePolicySession();
  if (
    !checkpointPolicy.sessionLeaseId
    || checkpointPolicy.transitionGeneration <= 0
  ) {
    throw new Error(
      "이번 편집의 고유 세대 식별자를 확인하지 못해 시작 상태를 저장하지 않았습니다."
    );
  }
  editingSessionCheckpointId = (
    `editor-session:${checkpointPolicy.transitionGeneration}:`
    + checkpointPolicy.sessionLeaseId
  );
  const checkpoint = await beginEditingSessionCheckpoint(
    projectId,
    editingSessionCheckpointId
  );
  if (
    checkpoint.projectId !== projectId
    || checkpoint.sessionId !== editingSessionCheckpointId
  ) {
    throw new Error(
      "이번 편집의 시작 상태 체크포인트가 현재 세션과 다릅니다."
    );
  }
  editingSessionCheckpointActive = true;
  const [storedProject, loadedSeed] = await Promise.all([
    loadProject(projectId).then(normalizeEditorProject),
    loadSeed()
  ]);
  const {
    captureState,
    openRecoveryDrafts,
    seedStorageKey
  } = loadedSeed;
  if (loadedSeed.projectId !== verifiedProjectId) {
    throw new Error("정책 확인 대상과 편집 프로젝트가 다릅니다.");
  }
  const entry = resolveStudioEditorEntry({
    purpose: checkpointPolicy.purpose,
    hasCaptureSeed: captureState !== null,
    hasCurrentProject: storedProject !== null,
    checkpointBaselineHasProject: checkpoint.baseline.project !== null
  });
  if (entry.kind === "error") {
    const messages = {
      "new-project-collision":
        "새 편집 ID가 이 기기의 저장 프로젝트와 충돌했습니다. 기존 편집은 변경하지 않았습니다. 시작 화면에서 새 프로젝트를 다시 열어 주세요.",
      "missing-capture-seed":
        "이번 편집기 열기에 연결된 캡처 데이터를 찾지 못했습니다. 시작 화면에서 정책을 다시 입력해 열어 주세요.",
      "missing-saved-project":
        "이 기기에서 다시 열 편집 프로젝트를 찾지 못했습니다."
    } as const;
    throw new Error(messages[entry.reason]);
  }
  bindActions();
  elements.finish_editing_session.hidden = false;
  try {
    captionAgentSettings = {
      ...await loadCaptionAgentSettings(),
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
      // The public one-time installer is deliberately a VOD-only background
      // engine. Never restore an old source-app Whisper selection into the
      // public editor where that provider cannot become ready.
      model: AUDSEG_DRAFT_MODEL
    };
  } catch (error) {
    console.warn("자막 에이전트 설정을 불러오지 못했습니다.", error);
    captionAgentSettings = { ...DEFAULT_CAPTION_AGENT_SETTINGS };
  }
  elements.caption_model.value = captionAgentSettings.model;
  renderCaptionModeControls();
  let devReloadRestored = false;
  if (entry.kind === "fresh-capture") {
    if (!captureState) {
      throw new Error("새 편집의 캡처 데이터를 확인하지 못했습니다.");
    }
    project = createEditorProjectFromCapture(captureState, { id: projectId });
  } else {
    if (!storedProject) {
      throw new Error("다시 열 편집 프로젝트를 확인하지 못했습니다.");
    }
    // A dev reload fingerprint proves the exact durable CURRENT written by
    // the previous build. Verify that byte-semantic state before applying a
    // deterministic compatibility migration in the new build. Ordinary
    // browser reloads have no fingerprint and simply reuse the exact CURRENT
    // owned by this editing-session checkpoint.
    devReloadRestored = verifyExpectedDevReloadProject(storedProject);
    project = normalizeMaterializedProjectSourceClock(storedProject);
  }
  // Only a fresh editor-new entry can prove that a detached public VOD is
  // about to use automatic materialization. Put that project on the platform
  // source clock before its first save/render, so a legacy +10s manual/media
  // alignment cannot shift a 03:40 selection to 03:50. Resume, recovery and
  // hot seed updates keep their intentional detached/manual alignment.
  if (
    entry.kind === "fresh-capture"
    && shouldAutoPrepareInitialVod(project)
  ) {
    project = applyMediaAlignmentOffset(project, 0);
  }
  bindStudioEditorProject(project.id);
  project = await reconcileInterruptedSessionCleanup(project);
  const activePolicy = requireActiveUsagePolicySession();
  const policySource = activePolicy.purpose === "editor-new"
    ? project.source
    : recoverySourceRecord(project.source);
  const projectSourceSessionId = sourceSessionIdentity(policySource ?? undefined)
    || `saved-project:${project.id}`;
  if (activePolicy.sourceSessionId !== projectSourceSessionId) {
    throw new Error(
      "정책을 확인한 원본 회차와 저장된 편집 프로젝트의 원본이 다릅니다. 시작 화면에서 다시 입력해 주세요."
    );
  }
  if (startupCompletedSessionCleanup) {
    const completedCleanup = startupCompletedSessionCleanup;
    startupCompletedSessionCleanup = null;
    if (editingSessionCheckpointActive) {
      if (completedCleanup.browser.deletedEditingSessionCheckpointCount === 0) {
        const committed = await commitEditingSessionCheckpoint(
          project.id,
          editingSessionCheckpointId
        );
        if (committed !== true) {
          throw new Error(
            "복구된 완료 세션의 편집 체크포인트를 확정하지 못했습니다."
          );
        }
      }
      editingSessionCheckpointActive = false;
      editingSessionCheckpointId = "";
    }
    rootProject = cloneProject(project);
    editorSessionCompleted = true;
    stopLocalDraftAutosave();
    discardPendingProjectSave();
    advanceProjectSessionGeneration();
    renderAll();

    let runtimeCleanupWarning = "";
    try {
      const response = await completeStudioEditorSession({
        projectId: project.id,
        sourceSessionId: activePolicy.sourceSessionId,
        ...(activePolicy.sessionLeaseId
          ? {
            sessionLeaseId: activePolicy.sessionLeaseId,
            transitionGeneration: activePolicy.transitionGeneration
          }
          : {})
      });
      if (response?.ok !== true || response.projectId !== project.id) {
        throw new Error(
          String(response?.error || "브라우저가 복구된 편집의 완료 상태를 확인하지 못했습니다.")
        );
      }
    } catch (error: unknown) {
      runtimeCleanupWarning = errorDetails(error);
    }
    usagePolicySession = null;
    clearUsagePolicyExpiryTimer();

    const deletedBrowserRecords = (
      completedCleanup.browser.deletedProjectCount
      + completedCleanup.browser.deletedLocalDraftCount
      + completedCleanup.browser.deletedImageAssetCount
      + completedCleanup.browser.deletedShortVideoCacheCount
      + completedCleanup.browser.deletedMediaHandleCount
      + completedCleanup.browser.deletedEditingSessionCheckpointCount
    );
    elements.session_completed_summary.textContent = (
      `${startupCleanupRecoveryNotice} 내보낸 영상과 편집 복원 파일은 그대로 보존했고, 이 작업의 기기 내 데이터 ${deletedBrowserRecords}건`
      + (completedCleanup.releasedBytes > 0
        ? `과 VOD 작업 재료 ${formatFileSize(completedCleanup.releasedBytes)}`
        : "")
      + "을 삭제했습니다."
      + (runtimeCleanupWarning
        ? ` 로컬 연결 정리는 다음 영상 준비 도구 시작 때 다시 시도됩니다: ${runtimeCleanupWarning}`
        : "")
    );
    startupCleanupRecoveryNotice = "";
    if (!elements.session_completed_dialog.open) {
      elements.session_completed_dialog.showModal();
    }
    elements.close_completed_editor.focus({ preventScroll: true });
    return;
  }
  if (!project.selectedClipId && project.clips[0]) {
    project.selectedClipId = project.clips[0].id;
  }
  const startupSearch = new URLSearchParams(location.search);
  const startupShortWorkspaceId = startupSearch.get("short");
  if (
    startupSearch.get("workspace") === "short-form"
    && startupShortWorkspaceId
  ) {
    try {
      const collection = activateShortFormWorkspace(
        project.shortFormWorkspaces,
        project.shortForm,
        startupShortWorkspaceId,
        project.clips
      );
      project = {
        ...project,
        shortForm: activeShortFormWorkspace(
          collection,
          project.shortForm,
          project.clips
        ).shortForm,
        shortFormWorkspaces: collection
      };
    } catch {
      // A bookmark for a deleted Short opens the persisted active workspace.
    }
  }
  rootProject = cloneProject(project);
  await saveActiveWorkspaceImmediately();
  markEditorUrlReloadable();
  lastLocalDraftMutationRevision = projectMutationRevision;
  lastCurrentProjectSavedAtMs = Date.now();
  renderLocalPersistenceStatus();
  if (seedStorageKey) {
    try {
      await studioStorageArea().remove(seedStorageKey);
    } catch (error) {
      console.warn("현재 프로젝트를 저장한 뒤 일회성 시작 데이터를 정리하지 못했습니다.", error);
    }
  }
  scheduleImageAssetBlobPrune();
  await initializeSourceBinding();
  renderAll();
  if (startupCleanupRecoveryNotice) {
    showToast(startupCleanupRecoveryNotice, "info", 8_000);
    startupCleanupRecoveryNotice = "";
  }
  if (document.fonts?.load) {
    const family = String(
      project.subtitleDefaults?.fontFamily || "Pretendard"
    ).replace(/["\\]/gu, "");
    const weight = Math.round(
      Number(project.subtitleDefaults?.fontWeight) || 800
    );
    void document.fonts
      .load(`${weight} 48px "${family}"`)
      .then(renderSubtitleOverlay)
      .catch((error) => {
        console.warn("자막 폰트를 미리 불러오지 못했습니다.", error);
      });
  }
  await restoreMedia();
  if (startupSearch.get("workspace") === "short-form") {
    await enterShortFormWorkspace();
  }
  if (findSubtitleOverlaps(project).length > 0) {
    showToast(
      "이 프로젝트에는 같은 레인 안에서 겹치는 자막이 있습니다. 자막 시각을 조정해 주세요.",
      "error",
      0
    );
  }
  if (findAudioRegionOverlaps(project).length > 0) {
    showToast(
      "이 프로젝트에는 서로 겹치는 음성 설정 구간이 있습니다. 구간 시각을 조정해 주세요.",
      "error",
      0
    );
  }
  try {
    const drafts = await listLocalDrafts(project.id, { limit: 5 });
    lastAutomaticDraftAtMs = Number(
      drafts.find((draft) => draft.reason === "auto")?.createdAtMs
    ) || 0;
    updateLocalDraftStatus(drafts);
  } catch (error) {
    console.warn("로컬 임시저장 목록을 준비하지 못했습니다.", error);
    elements.local_draft_status.dataset.state = "error";
    elements.local_draft_status.textContent = "저장본 목록 확인 실패";
  }
  elements.finish_editing_session.disabled = (
    !editingSessionCheckpointActive
  );
  startLocalDraftAutosave();
  if (openRecoveryDrafts) {
    await openLocalDraftDialog();
  }
  if (devReloadRestored) {
    showToast(
      "코드 변경 직전 저장본을 확인하고 같은 프로젝트를 다시 열었습니다.",
      "success",
      5_000
    );
  }
  startDevReloadObserver();
}

function normalizeLocalCaptionFirstPass(detail: unknown) {
  if (!isRecord(detail)) {
    throw new TypeError("로컬 자막 초벌 데이터 형식이 올바르지 않습니다.");
  }
  const runId = String(detail.runId || "").trim();
  if (!runId || runId.length > 160) {
    throw new TypeError("로컬 자막 초벌 실행 ID가 올바르지 않습니다.");
  }
  if (!Array.isArray(detail.cues) || detail.cues.length === 0) {
    throw new TypeError("추가할 로컬 자막 초벌이 없습니다.");
  }
  if (detail.cues.length > MAX_CAPTION_AGENT_CUES_PER_RUN) {
    throw new TypeError(
      `한 번에 추가할 수 있는 로컬 자막은 최대 ${MAX_CAPTION_AGENT_CUES_PER_RUN.toLocaleString("ko-KR")}개입니다.`
    );
  }
  const clipsById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const cues = detail.cues.map((rawCue: unknown, index: number) => {
    if (!isRecord(rawCue)) {
      throw new TypeError(`${index + 1}번 로컬 자막 형식이 올바르지 않습니다.`);
    }
    const clipId = String(rawCue.clipId || "");
    const clip = clipsById.get(clipId);
    if (!clip) {
      throw new TypeError(`${index + 1}번 로컬 자막의 컷을 찾을 수 없습니다.`);
    }
    const startOffsetMs = Math.round(Number(rawCue.startOffsetMs));
    const endOffsetMs = Math.round(Number(rawCue.endOffsetMs));
    const durationMs = clipDurationMs(clip);
    if (
      !Number.isFinite(startOffsetMs)
      || !Number.isFinite(endOffsetMs)
      || startOffsetMs < 0
      || endOffsetMs > durationMs
      || endOffsetMs - startOffsetMs < MIN_TIMELINE_RANGE_MS
      || endOffsetMs - startOffsetMs > 5_000
    ) {
      throw new TypeError(
        `${index + 1}번 로컬 자막은 컷 안의 0.1~5초 구간이어야 합니다.`
      );
    }
    const text = String(rawCue.text || "")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[.。]+$/u, "")
      .trim();
    if (!text || text.length > 500) {
      throw new TypeError(`${index + 1}번 로컬 자막 텍스트가 비었거나 너무 깁니다.`);
    }
    const remoteMeta = isRecord(rawCue.remoteMeta)
      ? rawCue.remoteMeta
      : {};
    return {
      ...rawCue,
      id: String(rawCue.id || `cue-codex-${crypto.randomUUID()}`),
      clipId,
      startOffsetMs,
      endOffsetMs,
      text,
      x: 0.5,
      y: 0.84,
      origin: "ai",
      humanEdited: false,
      remoteMeta: {
        speakerId: String(
          remoteMeta.speakerId || "codex-local-first-pass"
        ).slice(0, 80),
        reviewRequired: remoteMeta.reviewRequired !== false,
        placement: "bottom"
      }
    };
  });
  return {
    runId,
    model: String(detail.model || "Codex local first pass").slice(0, 120),
    cues
  };
}

async function applyLocalCaptionFirstPass(detail: unknown) {
  requireActiveUsagePolicySession();
  if (
    !project?.id
    || !isRecord(detail)
    || detail.projectId !== project.id
  ) {
    throw new TypeError("현재 프로젝트에 적용할 로컬 자막 초벌이 아닙니다.");
  }
  if (projectMutationLockCount > 0 || pointerEditActive || rangeHandleDragActive) {
    throw new Error("진행 중인 편집 동작이 끝난 뒤 로컬 자막 초벌을 적용해 주세요.");
  }
  const normalized = normalizeLocalCaptionFirstPass(detail);
  if (
    project.ai?.provider === "codex-local-first-pass"
    && project.ai?.lastRequestId === normalized.runId
  ) {
    return {
      ok: true,
      alreadyApplied: true,
      cueCount: project.subtitles.filter((cue) => (
        cue.remoteMeta?.speakerId === "codex-local-first-pass"
      )).length
    };
  }

  const before = cloneProject(project);
  const nextWithCues = appendAiSubtitleDrafts(project, normalized.cues);
  const next = {
    ...nextWithCues,
    ai: {
      ...nextWithCues.ai,
      provider: "codex-local-first-pass",
      model: normalized.model,
      resolvedModel: normalized.model,
      lastRequestId: normalized.runId,
      status: "done",
      progress: 1,
      lastRunAt: new Date().toISOString(),
      error: null
    }
  };
  const previousIds = new Set(before.subtitles.map((cue) => cue.id));
  const addedCount = next.subtitles.filter((cue) => !previousIds.has(cue.id)).length;
  if (addedCount === 0) {
    throw new Error("새로 추가할 로컬 자막 초벌이 없습니다.");
  }

  lockProjectMutations();
  try {
    requireActiveUsagePolicySession();
    const draftSnapshot = workspaceMode === "short-form"
      ? {
        ...rootProject,
        shortForm: shortFormBranchFromWorkspace(rootProject, next),
        updatedAt: new Date().toISOString()
      }
      : next;
    await queueCurrentProjectSessionWrite(() => saveLocalDraft(draftSnapshot, {
      reason: "manual",
      now: Date.now(),
      id: crypto.randomUUID()
    }));
    pushUndo(before);
    project = next;
    fieldEditSession = null;
    renderAll({ keepScroll: true });
    updateLocalDraftStatus(
      await listLocalDrafts(project.id, { limit: 5 })
    );
    showToast(
      `Codex 로컬 초벌 자막 ${addedCount}개를 기존 자막과 별도로 추가했습니다.`,
      "success",
      6500
    );
    return {
      ok: true,
      alreadyApplied: false,
      addedCount,
      totalSubtitleCount: project.subtitles.length,
      subtitleLaneCount: project.subtitleLaneCount
    };
  } finally {
    unlockProjectMutations();
  }
}

window.addEventListener("kirinuki:apply-local-caption-first-pass", (event) => {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  const requestId = isRecord(detail)
    ? String(detail.requestId || "")
    : "";
  void queueLocalDraftOperation(() => applyLocalCaptionFirstPass(detail))
    .then((result) => {
      window.dispatchEvent(new CustomEvent(
        "kirinuki:local-caption-first-pass-result",
        { detail: { requestId, ...result } }
      ));
    })
    .catch((error: unknown) => {
      window.dispatchEvent(new CustomEvent(
        "kirinuki:local-caption-first-pass-result",
        { detail: { requestId, ok: false, error: errorMessage(error) } }
      ));
      showToast(
        `Codex 로컬 자막 초벌을 적용하지 못했습니다: ${errorMessage(error)}`,
        "error",
        0
      );
    });
});

window.addEventListener("beforeunload", () => {
  clearLocalMediaEngineSessionState();
  invalidateShortPreviewCacheOperation();
  clearUsagePolicyExpiryTimer();
  stopDevReloadObserver();
  stopLocalDraftAutosave();
  if (project && workspaceMode === "short-form") {
    stopShortCanvasPlayback();
  }
  stopPreviewPlaybackClock();
  stopPreviewAudioClock({ sync: false });
  cancelPreviewPreload({ clearSource: true });
  releaseShortPreviewLayerVideos();
  releaseShortPreviewSourceAudio();
  void flushSave();
  if (mediaUrl) {
    URL.revokeObjectURL(mediaUrl);
  }
  releaseAllImageAssetObjectUrls();
  cancelScheduledShortWorkspacePreview();
  releaseShortPreviewAdaptiveScaler();
  releaseShortPreviewFallbackSurface();
  cancelActiveJob();
});

window.addEventListener("pagehide", () => {
  clearLocalMediaEngineSessionState();
  invalidatePrimedLocalMediaEngineTrust();
  invalidateShortPreviewCacheOperation();
  stopDevReloadObserver();
  stopLocalDraftAutosave();
  if (project && workspaceMode === "short-form") {
    stopShortCanvasPlayback();
  }
  void flushSave();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (project && workspaceMode === "short-form") {
      stopShortCanvasPlayback();
    }
    void flushSave();
  } else {
    try {
      requireActiveUsagePolicySession();
    } catch {
      return;
    }
    if (localDraftAutosaveAnchorAtMs <= 0) {
      return;
    }
    const elapsed = Date.now() - localDraftAutosaveAnchorAtMs;
    if (elapsed >= LOCAL_DRAFT_AUTOSAVE_INTERVAL_MS) {
      clearTimeout(localDraftAutosaveTimer ?? undefined);
      localDraftAutosaveTimer = null;
      void runAutomaticLocalDraft();
    } else {
      scheduleLocalDraftAutosave(
        LOCAL_DRAFT_AUTOSAVE_INTERVAL_MS - elapsed
      );
    }
  }
});

function resumeEditorAfterPageShow(): void {
  try {
    requireActiveUsagePolicySession();
  } catch {
    return;
  }
  if (project && !localDraftAutosaveTimer) {
    const elapsed = Math.max(
      0,
      Date.now() - localDraftAutosaveAnchorAtMs
    );
    scheduleLocalDraftAutosave(
      Math.max(0, LOCAL_DRAFT_AUTOSAVE_INTERVAL_MS - elapsed)
    );
  }
  if (project && devReloadEnabled() && !devReloadObserverActive) {
    startDevReloadObserver();
  }
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    const expected = usagePolicySession;
    if (!expected) {
      return;
    }
    // BFCache keeps this document's in-memory state, but the same tab may have
    // started a different project while this page was frozen. Re-read the
    // tab-scoped lease once: a verified replacement exits this stale editor,
    // while a transient storage error leaves the live editor usable.
    clearUsagePolicyExpiryTimer();
    void primeLocalMediaEngineTrust()
      .catch((error) => {
        console.warn("로컬 엔진 identity 재확인에 실패했습니다.", error);
      })
      .then(() => refreshUsagePolicyLease(expected))
      .then((current) => {
        if (current) {
          resumeEditorAfterPageShow();
          scheduleUsagePolicyLeaseHeartbeat();
        }
      })
      .catch((error: unknown) => {
        handleUsagePolicyLeaseRefreshFailure(error, expected);
        if (
          usagePolicySession === expected
          && !(error instanceof ReplacedUsagePolicyLeaseError)
        ) {
          resumeEditorAfterPageShow();
        }
      });
    return;
  }
  resumeEditorAfterPageShow();
});

void initialize().catch((error: unknown) => {
  console.error(error);
  showEditorPolicyGateError(`편집기를 열지 못했습니다: ${errorMessage(error)}`);
  showToast(`편집기를 열지 못했습니다: ${errorMessage(error)}`, "error", 0);
});
