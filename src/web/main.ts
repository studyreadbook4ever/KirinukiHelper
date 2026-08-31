import {
  captureSegmentEditorClipId,
  normalizeEditorProject,
  sourceSessionIdentity
} from "../lib/editor-core.js";
import type {
  CaptureState,
  EditorProject,
  SourceRecord
} from "../lib/editor-core.js";
import { recoverySourceRecord } from "../lib/session-recovery.js";
import {
  inferSourceIdentifiers,
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  sourcePlatformLabel
} from "../lib/source-platform.js";
import {
  createCoalescedAutomaticOperation,
  createLatestSerialOperationQueue
} from "../lib/serial-operation-gate.js";
import { sourceEmbedDescriptor } from "../lib/source-embed.js";
import {
  USAGE_POLICY_CONFIRMATION_PHRASE,
  createPerUseConfirmationAttestation
} from "../lib/usage-policy.js";
import type {
  UsagePolicyAttestation,
  UsagePolicyTarget
} from "../lib/usage-policy.js";
import {
  SESSION_ARCHIVE_MAX_JSON_BYTES
} from "../lib/session-archive.js";
import {
  KIRINUKI_STUDIO_ORIGIN_META_NAME,
  assertKirinukiStudioDocumentOrigin
} from "../lib/local-runtime-origin.js";
import {
  currentClientCannotUseEditor
} from "../lib/editor-mobile-access.js";
import {
  cutPreparationRecoveryKind,
  safeCutPreparationErrorCode
} from "./cut-preparation-recovery.js";

import {
  deleteAllProjectSessionsAtomically,
  discardAbandonedEditingSessionCheckpoint,
  deleteProjectSessionAtomically,
  listEditingSessionCheckpointProjectIds,
  listLocalDrafts,
  listProjects
} from "../editor/project-store.js";
import {
  WEB_STUDIO_LATEST_PROJECT_KEY,
  beginWebEditorSession,
  clearCurrentTabWebEditorSession,
  createFreshEditorProjectId,
  runWithExclusiveStudioProjectCollectionAccess,
  runWithExclusiveStudioProjectAccess,
  studioStorageArea
} from "../editor/studio-runtime.js";
import {
  STUDIO_CAPTURE_SHORTCUT_BINDINGS,
  studioCaptureShortcutBinding,
  studioCaptureShortcutLetterFromEvent
} from "./studio-capture-console.js";
import type { StudioCaptureAction } from "./studio-capture-console.js";
import {
  DEFAULT_CAPTION_AGENT_SETTINGS,
  pairCaptionAgent
} from "../editor/caption-agent.js";
import {
  detectLocalMediaEngineTarget,
  ensureLocalMediaEngineReady,
  localMediaEngineArchInstaller,
  localMediaEngineInstaller
} from "../editor/local-media-engine-onboarding.js";
import {
  cancelChzzkVodMaterialization,
  startChzzkVodMaterialization,
  waitForChzzkVodMaterialization
} from "../editor/chzzk-vod-client.js";
import type {
  ChzzkVodMaterializationStatus
} from "../editor/chzzk-vod-client.js";
import {
  normalizeChzzkVodMaterialization
} from "../lib/chzzk-vod-materialization.js";
import {
  sessionArchiveJsonFromCaptureState,
  sessionArchiveCaptureFromJson
} from "./session-archive-capture.js";
import {
  formatStudioDurationSummary,
  formatStudioTimecode,
  STUDIO_SELECTION_RANGE_INPUT_ERROR,
  STUDIO_SELECTION_RANGE_ORDER_ERROR,
  validateStudioSelectionRange
} from "./studio-timecode.js";
import {
  localPreviewMediaSeconds,
  localPreviewSourceAtMediaZero,
  localPreviewSourceSeconds,
  planLocalPreviewRange
} from "./local-preview-range.js";
import {
  YouTubeEmbedController
} from "./youtube-embed-controller.js";
import {
  LocalVodWebPlaybackController
} from "./local-vod-playback.js";
import {
  consumeSourceLocation,
  SOURCE_LOCATION_SANITIZED_EVENT
} from "./source-location.js";
import {
  UI_LANGUAGE_CHANGE_EVENT,
  installUiLocalization,
  uiIntlLocale
} from "../lib/ui-localization.js";
import {
  CUT_UI_COPY_CATALOG,
  CUT_UI_COPY_PATTERNS
} from "./ui-copy.js";

export {
  formatStudioTimecode,
  parseStudioTimecode
} from "./studio-timecode.js";

const activeStudioOrigin = assertKirinukiStudioDocumentOrigin(
  location.origin,
  document.querySelector<HTMLMetaElement>(
    `meta[name="${KIRINUKI_STUDIO_ORIGIN_META_NAME}"]`
  )?.content
);

const uiLocalization = installUiLocalization({
  catalog: CUT_UI_COPY_CATALOG,
  patterns: CUT_UI_COPY_PATTERNS
});

const publicLaunchShell = requiredElement<HTMLElement>("#public-launch-shell");
const localAppSurface = requiredElement<HTMLElement>("#local-app-surface");
const localProjectDeleteDialog = requiredElement<HTMLDialogElement>(
  "#local-project-delete-dialog"
);

function setDocumentSurface(surface: "public" | "local"): void {
  const showPublic = surface === "public";
  publicLaunchShell.hidden = !showPublic;
  publicLaunchShell.inert = !showPublic;
  localAppSurface.hidden = showPublic;
  localAppSurface.inert = showPublic;
  localProjectDeleteDialog.hidden = showPublic;
  localProjectDeleteDialog.inert = showPublic;
  document.body.dataset.kirinukiSurface = surface;
}

const HANDLE_SECONDS = 10;
const MINIMUM_SELECTION_SECONDS = 0.1;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Kirinuki 시작 화면 요소가 없습니다: ${selector}`);
  }
  return element;
}

function requiredElementWithin<T extends Element>(
  root: ParentNode,
  selector: string
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Kirinuki 시작 화면 하위 요소가 없습니다: ${selector}`);
  }
  return element;
}

function startLocalApplication(): void {
setDocumentSurface("local");

const elements = {
  form: requiredElement<HTMLFormElement>("#start-form"),
  helperDownload: requiredElement<HTMLAnchorElement>(
    "#linux-helper-download"
  ),
  archHelperDownload: requiredElement<HTMLAnchorElement>(
    "#arch-helper-download"
  ),
  sourceUrl: requiredElement<HTMLInputElement>("#source-url"),
  sourcePlatform: requiredElement<HTMLElement>("#source-platform"),
  openSource: requiredElement<HTMLButtonElement>("#open-source"),
  importSessionArchive: requiredElement<HTMLButtonElement>(
    "#import-session-archive"
  ),
  exportSessionArchive: requiredElement<HTMLButtonElement>(
    "#export-session-archive"
  ),
  sessionArchiveInput: requiredElement<HTMLInputElement>(
    "#session-archive-input"
  ),
  projectName: requiredElement<HTMLInputElement>("#project-name"),
  sourceCaptureWorkspace: requiredElement<HTMLElement>(
    "#source-capture-workspace"
  ),
  streamFrame: requiredElement<HTMLIFrameElement>("#stream-preview-frame"),
  streamVideo: requiredElement<HTMLVideoElement>("#stream-preview-video"),
  streamPlaceholder: requiredElement<HTMLElement>("#stream-preview-placeholder"),
  streamKind: requiredElement<HTMLElement>("#stream-preview-kind"),
  editorDuration: requiredElement<HTMLOutputElement>(
    "#current-edit-duration"
  ),
  streamStatus: requiredElement<HTMLElement>("#stream-preview-status"),
  reloadStream: requiredElement<HTMLButtonElement>("#reload-stream"),
  clipList: requiredElement<HTMLElement>("#clip-list"),
  selectionRail: requiredElement<HTMLElement>(".selection-rail"),
  clipTemplate: requiredElement<HTMLTemplateElement>("#clip-row-template"),
  addClip: requiredElement<HTMLButtonElement>("#add-clip"),
  captureBackupStatus: requiredElement<HTMLElement>("#capture-backup-status"),
  localProjectManager: requiredElement<HTMLElement>("#recent-section"),
  localProjectsSummary: requiredElement<HTMLElement>("#local-projects-summary"),
  refreshLocalProjects: requiredElement<HTMLButtonElement>("#refresh-local-projects"),
  clearAllLocalProjects: requiredElement<HTMLButtonElement>("#clear-all-local-projects"),
  localProjectsLoading: requiredElement<HTMLElement>("#local-projects-loading"),
  localProjectsEmpty: requiredElement<HTMLElement>("#local-projects-empty"),
  localProjectsError: requiredElement<HTMLElement>("#local-projects-error"),
  retryLocalProjects: requiredElement<HTMLButtonElement>("#retry-local-projects"),
  localProjectsList: requiredElement<HTMLElement>("#local-projects-list"),
  localProjectRowTemplate: requiredElement<HTMLTemplateElement>(
    "#local-project-row-template"
  ),
  localProjectDeleteDialog: requiredElement<HTMLDialogElement>(
    "#local-project-delete-dialog"
  ),
  localProjectDeleteTitle: requiredElement<HTMLElement>(
    "#local-project-delete-title"
  ),
  localProjectDeleteSummary: requiredElement<HTMLElement>(
    "#local-project-delete-summary"
  ),
  cancelLocalProjectDelete: requiredElement<HTMLButtonElement>(
    "#cancel-local-project-delete"
  ),
  confirmLocalProjectDelete: requiredElement<HTMLButtonElement>(
    "#confirm-local-project-delete"
  ),
  sourceCacheStatus: requiredElement<HTMLElement>("#source-cache-status"),
  policySection: requiredElement<HTMLElement>("#policy-section"),
  mobileEditorNotice: requiredElement<HTMLElement>("#mobile-editor-notice"),
  status: requiredElement<HTMLElement>("#form-status"),
  startEditor: requiredElement<HTMLButtonElement>("#start-editor"),
  cutPreparationProgress: requiredElement<HTMLElement>(
    "#cut-preparation-progress"
  ),
  cutPreparationStage: requiredElement<HTMLElement>(
    "#cut-preparation-stage"
  ),
  cutPreparationPercent: requiredElement<HTMLOutputElement>(
    "#cut-preparation-percent"
  ),
  cutPreparationMeter: requiredElement<HTMLProgressElement>(
    "#cut-preparation-meter"
  ),
  cutPreparationRecovery: requiredElement<HTMLElement>(
    "#cut-preparation-recovery"
  ),
  cutPreparationErrorCode: requiredElement<HTMLElement>(
    "#cut-preparation-error-code"
  ),
  cutPreparationRetry: requiredElement<HTMLButtonElement>(
    "#cut-preparation-retry"
  ),
  cutPreparationDownload: requiredElement<HTMLButtonElement>(
    "#cut-preparation-download"
  ),
  cutPreparationManual: requiredElement<HTMLButtonElement>(
    "#cut-preparation-manual"
  ),
  streamCurrentTime: requiredElement<HTMLOutputElement>(
    "#stream-current-time"
  ),
  streamCutStatus: requiredElement<HTMLElement>(
    "#stream-cut-console-status"
  ),
  activeClipLabel: requiredElement<HTMLElement>("#active-clip-label"),
  captureStart: requiredElement<HTMLButtonElement>("#capture-start"),
  captureEnd: requiredElement<HTMLButtonElement>("#capture-end"),
  saveSegment: requiredElement<HTMLButtonElement>("#save-segment"),
  seekBackwardFive: requiredElement<HTMLButtonElement>("#seek-backward-five"),
  seekForwardFive: requiredElement<HTMLButtonElement>("#seek-forward-five"),
  playbackRateQuarter: requiredElement<HTMLButtonElement>("#playback-rate-quarter"),
  playbackRateDouble: requiredElement<HTMLButtonElement>("#playback-rate-double"),
  streamPreviewNavigation: requiredElement<HTMLElement>(
    "#stream-preview-navigation"
  ),
  streamPreviewTimeline: requiredElement<HTMLInputElement>(
    "#stream-preview-timeline"
  ),
  streamPreviewTarget: requiredElement<HTMLOutputElement>(
    "#stream-preview-target"
  ),
  loadPreviewWindow: requiredElement<HTMLButtonElement>(
    "#load-preview-window"
  )
};

interface LocalProjectEntry {
  project: EditorProject;
  draftCount: number;
  updatedAtMs: number;
  hasOpenEditingSession: boolean;
}

type PendingLocalProjectDeletion = {
  mode: "single";
  projectId: string;
} | {
  mode: "all";
};

let localProjectEntries: LocalProjectEntry[] = [];
let openEditingCheckpointProjectIds = new Set<string>();
let resumeProject: EditorProject | null = null;
let resumeRecoveryDrafts = false;
let pendingLocalProjectDeletion: PendingLocalProjectDeletion | null = null;
let localProjectManagerBusy = false;
let localProjectManagerInitialized = false;
let localProjectManagerLastError: unknown = null;
let localProjectManagerRenderState: "loading" | "ready" | "error" =
  "loading";
const localProjectLifecycleCleanupQueue = createLatestSerialOperationQueue();
let localProjectLifecycleRefreshTimer: number | null = null;
let openingEditor = false;
const mobileEditorBlocked = currentClientCannotUseEditor();
let streamPreviewTimer: number | null = null;
let activeStreamEmbedUrl = "";
let activeStreamPlatform = "";
let streamLoadTimer: number | null = null;
let activeClipRow: HTMLElement | null = null;
let localPreviewSourceStartSeconds = 0;
let localPreviewSourceDurationSeconds = 0;
let localPreviewProjectId = createFreshEditorProjectId();
let localPreviewSourceUrl = "";
let localPreviewToken = "";
let localPreviewBusy = false;
let localPreviewGeneration = 0;
let captureBackupBusy = false;
interface ActiveLocalPreviewOperation {
  readonly controller: AbortController;
  readonly generation: number;
  readonly token: string;
  jobId: string | null;
}
let activeLocalPreviewOperation: ActiveLocalPreviewOperation | null = null;
let youtubeController: YouTubeEmbedController | null = null;
let helperDownloadConnectionPending = false;
let localVodPlayback: LocalVodWebPlaybackController | null = null;
let localVodPlaybackSourceUrl = "";
let localVodPlaybackGeneration = 0;
let localVodPlaybackConnectPromise:
  Promise<LocalVodWebPlaybackController | null> | null = null;
let streamTimelineInteracting = false;

let helperDownloadIdleLabel = "내 PC용 도우미 다운로드";
let helperDownloadReadyLabel = "영상 준비 도우미 연결됨";
const ARCH_HELPER_DOWNLOAD_IDLE_LABEL =
  "Arch Linux 도우미 (.pkg.tar.zst)";

function renderHelperDownloadLabels(state: "idle" | "checking" | "ready"): void {
  if (state === "ready") {
    elements.helperDownload.textContent = helperDownloadReadyLabel;
    elements.archHelperDownload.textContent = "Arch Linux 도우미 연결됨";
    return;
  }
  if (state === "checking") {
    elements.helperDownload.textContent =
      "다운로드 요청됨 · 설치 후 연결 확인";
    elements.archHelperDownload.textContent =
      "다운로드 요청됨 · 설치 후 연결 확인";
    return;
  }
  elements.helperDownload.textContent = helperDownloadIdleLabel;
  elements.archHelperDownload.textContent = ARCH_HELPER_DOWNLOAD_IDLE_LABEL;
}

async function monitorHelperDownloadConnection(): Promise<void> {
  if (helperDownloadConnectionPending) {
    return;
  }
  helperDownloadConnectionPending = true;
  elements.helperDownload.ariaBusy = "true";
  elements.archHelperDownload.ariaBusy = "true";
  renderHelperDownloadLabels("checking");
  try {
    const readiness = await ensureLocalMediaEngineReady(undefined, {
      beginInstallPolling: true
    });
    if (readiness === "ready") {
      renderHelperDownloadLabels("ready");
      elements.streamCutStatus.textContent = activeStreamPlatform
        ? activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE
          ? "도우미도 연결됐습니다. YouTube 컷 제어는 이 웹 플레이어에서 바로 동작합니다."
          : "도우미가 연결됐습니다. 컷 선택은 이 웹 화면에서 계속하고, 편집기로 넘어갈 때 선택 구간만 준비합니다."
        : "영상 준비 도우미가 연결됐습니다. VOD 주소를 붙여 넣어 컷을 선택하세요.";
      return;
    }
    renderHelperDownloadLabels("idle");
  } catch (error) {
    renderHelperDownloadLabels("idle");
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      elements.streamCutStatus.textContent =
        `도우미 연결을 확인하지 못했습니다: ${errorMessage(error)}`;
    }
  } finally {
    helperDownloadConnectionPending = false;
    elements.helperDownload.removeAttribute("aria-busy");
    elements.archHelperDownload.removeAttribute("aria-busy");
  }
}

async function configureHelperDownload(): Promise<void> {
  const target = await detectLocalMediaEngineTarget();
  const installer = localMediaEngineInstaller(target);
  const archInstaller = target === "linux-x64"
    ? localMediaEngineArchInstaller()
    : null;
  if (!installer) {
    elements.helperDownload.hidden = true;
    elements.helperDownload.removeAttribute("href");
    elements.helperDownload.removeAttribute("download");
  } else {
    helperDownloadIdleLabel = installer.label;
    helperDownloadReadyLabel = target === "windows-x64"
      ? "Windows 도우미 연결됨"
      : "Debian/Ubuntu 도우미 연결됨";
    renderHelperDownloadLabels("idle");
    elements.helperDownload.href = installer.url;
    elements.helperDownload.download = installer.fileName;
    elements.helperDownload.hidden = false;
  }
  if (!archInstaller) {
    elements.archHelperDownload.hidden = true;
    elements.archHelperDownload.removeAttribute("href");
    elements.archHelperDownload.removeAttribute("download");
  } else {
    elements.archHelperDownload.href = archInstaller.url;
    elements.archHelperDownload.download = archInstaller.fileName;
    elements.archHelperDownload.hidden = false;
  }
  const monitor = () => {
    window.setTimeout(() => {
      void monitorHelperDownloadConnection();
    }, 0);
  };
  elements.helperDownload.addEventListener("click", monitor);
  elements.archHelperDownload.addEventListener("click", monitor);
}

function explainMobileEditorBlock(): void {
  const message = "편집기는 모바일에서 사용할 수 없습니다. PC 브라우저에서 열어 주세요.";
  setStatus(message, "error");
  elements.mobileEditorNotice.hidden = false;
  elements.mobileEditorNotice.scrollIntoView({ behavior: "smooth", block: "center" });
}

function firstKnownInvalidClipRow(): HTMLElement | null {
  if (resumeProject) {
    return null;
  }
  return clipRows().find(
    (row) => row.dataset.rangeValidity === "invalid"
  ) ?? null;
}

function renderEditorEntryAvailability(): void {
  const invalidRow = firstKnownInvalidClipRow();
  elements.startEditor.disabled = Boolean(
    mobileEditorBlocked || openingEditor || invalidRow
  );
  elements.startEditor.title = mobileEditorBlocked
    ? "편집기는 모바일에서 사용할 수 없습니다"
    : invalidRow
      ? String(
        invalidRow.querySelector<HTMLElement>(".coverage")?.textContent
        || STUDIO_SELECTION_RANGE_INPUT_ERROR
      )
      : "권리 확인 후 편집기 열기 (단축키 A)";
}

function renderMobileEditorAccess(): void {
  document.body.dataset.mobileEditorBlocked = String(mobileEditorBlocked);
  elements.mobileEditorNotice.hidden = !mobileEditorBlocked;
  renderEditorEntryAvailability();
}
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return uiLocalization.translate(message);
}

function setStatus(message: string, kind: "idle" | "error" | "success" = "idle"): void {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", kind === "error");
  elements.status.classList.toggle("success", kind === "success");
}

function materializationStage(status: ChzzkVodMaterializationStatus): string {
  const labels: Readonly<Record<ChzzkVodMaterializationStatus["state"], string>> = {
    queued: "도우미가 요청을 확인하고 있습니다",
    resolving: "원본 VOD를 안전하게 확인하고 있습니다",
    planning: "선택한 구간만 계산하고 있습니다",
    downloading: "선택한 구간을 이 PC에 받고 있습니다",
    verifying: "받은 영상과 원본 시각을 검증하고 있습니다",
    muxing: "웹 편집기용 영상을 구성하고 있습니다",
    completed: "선택한 구간 준비를 마쳤습니다",
    failed: "선택한 구간을 준비하지 못했습니다",
    cancelled: "선택한 구간 준비를 취소했습니다"
  };
  return labels[status.state];
}

function showCutPreparation(
  stage: string,
  progress: number
): void {
  const value = Math.max(0, Math.min(1, Number(progress) || 0));
  latestCutPreparationStage = stage;
  elements.cutPreparationProgress.hidden = false;
  delete elements.cutPreparationProgress.dataset.state;
  elements.cutPreparationRecovery.hidden = true;
  elements.cutPreparationStage.textContent = stage;
  elements.cutPreparationMeter.value = value;
  elements.cutPreparationPercent.textContent = `${Math.round(value * 100)}%`;
}

function hideCutPreparation(): void {
  elements.cutPreparationProgress.hidden = true;
  elements.cutPreparationMeter.value = 0;
  elements.cutPreparationPercent.textContent = "0%";
  delete elements.cutPreparationProgress.dataset.state;
  elements.cutPreparationRecovery.hidden = true;
}

let latestCutPreparationStage = "영상 준비";
let forceManualFileForNextPreparation = false;

function showCutPreparationFailure(error: unknown): void {
  if (error instanceof DOMException && error.name === "AbortError") {
    elements.cutPreparationProgress.dataset.state = "cancelled";
    elements.cutPreparationStage.textContent = "선택한 구간 준비를 취소했습니다";
    elements.cutPreparationRecovery.hidden = true;
    setStatus("영상 준비를 취소했습니다. 컷 선택 내용은 그대로 유지됩니다.", "idle");
    return;
  }
  const code = safeCutPreparationErrorCode(error);
  const recovery = cutPreparationRecoveryKind(code);
  elements.cutPreparationProgress.dataset.state = "error";
  elements.cutPreparationStage.textContent = `${latestCutPreparationStage} 단계에서 멈췄습니다`;
  elements.cutPreparationErrorCode.textContent = code;
  elements.cutPreparationRecovery.hidden = false;
  elements.cutPreparationRetry.textContent = recovery === "reconnect"
    ? "도우미 연결 다시 확인"
    : recovery === "source"
      ? "원본 다시 확인하고 재시도"
      : "다시 시도";
  elements.cutPreparationDownload.hidden = !["update", "source"].includes(recovery);
  elements.cutPreparationManual.hidden = recovery === "reconnect";
}

function replaceStreamFrame(): void {
  const oldFrame = elements.streamFrame;
  youtubeController?.destroy();
  youtubeController = null;
  const replacement = oldFrame.cloneNode(false) as HTMLIFrameElement;
  replacement.removeAttribute("src");
  replacement.hidden = true;
  if (oldFrame.isConnected) {
    oldFrame.replaceWith(replacement);
  } else {
    elements.streamPlaceholder.before(replacement);
  }
  elements.streamFrame = replacement;
  installStreamFrameLoadHandler(replacement);
}

function currentYouTubePlayerSnapshot() {
  return youtubeController?.snapshot ?? null;
}

function connectYouTubeEmbedController(frame: HTMLIFrameElement): void {
  if (
    activeStreamPlatform !== SOURCE_PLATFORM_YOUTUBE
    || frame !== elements.streamFrame
  ) {
    return;
  }
  const contentId = inferSourceIdentifiers(elements.sourceUrl.value.trim()).contentId;
  youtubeController?.destroy();
  youtubeController = new YouTubeEmbedController({
    frame,
    contentId,
    onReady: () => {
      elements.streamCutStatus.textContent =
        "YouTube 플레이어 연결 완료 · E/R 캡처와 D/F/Y/U 제어를 사용할 수 있습니다.";
      syncCaptureConsoleAvailability();
    },
    onUpdate: () => syncCaptureConsoleAvailability(),
    onError: (message) => {
      elements.streamCutStatus.textContent = message;
      syncCaptureConsoleAvailability();
    }
  });
}

function resetLocalVodWebPlayback(): void {
  localVodPlaybackGeneration += 1;
  localVodPlayback?.dispose();
  localVodPlayback = null;
  localVodPlaybackSourceUrl = "";
  localVodPlaybackConnectPromise = null;
  streamTimelineInteracting = false;
}

function updateLocalVodTimeline(): void {
  const snapshot = localVodPlayback?.snapshot();
  if (!snapshot || streamTimelineInteracting) {
    return;
  }
  elements.streamPreviewTimeline.value = String(snapshot.currentTime);
  elements.streamPreviewTarget.textContent = formatStudioTimecode(
    snapshot.currentTime
  );
}

function connectLocalVodWebPlayback(
  sourceUrl: string,
  { force = false }: { force?: boolean } = {}
): Promise<LocalVodWebPlaybackController | null> {
  if (
    !force
    && localVodPlayback
    && localVodPlaybackSourceUrl === sourceUrl
  ) {
    return Promise.resolve(localVodPlayback);
  }
  if (
    !force
    && localVodPlaybackConnectPromise
    && localVodPlaybackSourceUrl === sourceUrl
  ) {
    return localVodPlaybackConnectPromise;
  }
  resetLocalVodWebPlayback();
  const generation = localVodPlaybackGeneration;
  localVodPlaybackSourceUrl = sourceUrl;
  elements.streamCutStatus.textContent =
    "이 PC의 영상 준비 도우미에서 원본 플레이어를 연결하는 중입니다…";
  elements.streamStatus.textContent =
    "처음 한 번 브라우저가 로컬 네트워크 연결 허용을 요청할 수 있습니다.";
  elements.streamVideo.crossOrigin = "anonymous";
  const pending = LocalVodWebPlaybackController.connect({
    sourceUrl,
    video: elements.streamVideo
  }).then((controller) => {
    if (
      generation !== localVodPlaybackGeneration
      || localVodPlaybackSourceUrl !== sourceUrl
    ) {
      controller.dispose();
      return null;
    }
    localVodPlayback = controller;
    const snapshot = controller.snapshot();
    elements.streamFrame.hidden = true;
    elements.streamPlaceholder.hidden = true;
    elements.streamVideo.hidden = false;
    elements.streamPreviewNavigation.hidden = false;
    elements.streamPreviewTimeline.disabled = false;
    elements.loadPreviewWindow.disabled = false;
    elements.streamPreviewTimeline.min = "0";
    elements.streamPreviewTimeline.max = String(controller.session.durationSeconds);
    elements.streamPreviewTimeline.value = String(snapshot?.currentTime ?? 0);
    elements.streamPreviewTarget.textContent = formatStudioTimecode(
      snapshot?.currentTime ?? 0
    );
    elements.streamStatus.textContent =
      "도우미가 연결한 원본 VOD를 이 웹 플레이어에서 재생합니다.";
    elements.streamCutStatus.textContent =
      "연결 완료 · 보이는 영상과 E/R/D/F/Y/U 타임스탬프가 같은 재생 시계를 사용합니다.";
    syncCaptureConsoleAvailability();
    return controller;
  }).catch((error: unknown) => {
    if (
      generation === localVodPlaybackGeneration
      && localVodPlaybackSourceUrl === sourceUrl
    ) {
      elements.streamCutStatus.textContent =
        `웹 원본 플레이어를 연결하지 못했습니다: ${errorMessage(error)} 도우미를 실행한 뒤 다시 시도해 주세요.`;
      syncCaptureConsoleAvailability();
    }
    return null;
  }).finally(() => {
    if (localVodPlaybackConnectPromise === pending) {
      localVodPlaybackConnectPromise = null;
    }
  });
  localVodPlaybackConnectPromise = pending;
  return pending;
}

async function ensureLocalVodWebPlayback(): Promise<LocalVodWebPlaybackController | null> {
  if (localVodPlayback) {
    return localVodPlayback;
  }
  let descriptor: ReturnType<typeof sourceEmbedDescriptor>;
  try {
    descriptor = sourceEmbedDescriptor(elements.sourceUrl.value.trim(), {
      studioOrigin: location.origin
    });
  } catch {
    return null;
  }
  if (
    !descriptor
    || (descriptor.platform !== SOURCE_PLATFORM_CHZZK
      && descriptor.platform !== SOURCE_PLATFORM_SOOP)
  ) {
    return null;
  }
  return connectLocalVodWebPlayback(descriptor.sourceUrl, { force: true });
}

function clipRows(): HTMLElement[] {
  return [...elements.clipList.querySelectorAll<HTMLElement>(".clip-row")];
}

function updateClipRows(): void {
  const rows = clipRows();
  let validDurationSeconds = 0;
  let validRangeCount = 0;
  rows.forEach((row, index) => {
    const indexLabel = row.querySelector<HTMLElement>(".clip-index");
    const remove = row.querySelector<HTMLButtonElement>('[data-action="remove"]');
    const start = row.querySelector<HTMLInputElement>('[data-field="start"]');
    const end = row.querySelector<HTMLInputElement>('[data-field="end"]');
    const note = row.querySelector<HTMLInputElement>('[data-field="note"]');
    const coverage = row.querySelector<HTMLElement>(".coverage");
    if (indexLabel) {
      indexLabel.textContent = String(index + 1).padStart(2, "0");
    }
    const active = row === activeClipRow;
    row.classList.toggle("active", active);
    if (active) {
      row.setAttribute("aria-current", "true");
    } else {
      row.removeAttribute("aria-current");
    }
    if (remove) {
      remove.disabled = rows.length === 1;
      remove.title = rows.length === 1
        ? "구간은 하나 이상 필요합니다."
        : "이 구간 삭제";
    }
    const validation = validateStudioSelectionRange(start?.value, end?.value);
    if (validation.status === "valid") {
      validDurationSeconds += validation.endSeconds! - validation.startSeconds!;
      validRangeCount += 1;
    }
    const populated = Boolean(
      start?.value.trim() || end?.value.trim() || note?.value.trim()
    );
    const invalid = populated && validation.status !== "valid";
    const invalidStart = invalid && validation.startSeconds === null;
    const invalidEnd = invalid && (
      validation.endSeconds === null || validation.status === "invalid-order"
    );
    row.dataset.rangeValidity = invalid ? "invalid" : validation.status;
    row.classList.toggle("invalid", invalid);
    if (start) {
      if (invalidStart) {
        start.setAttribute("aria-invalid", "true");
      } else {
        start.removeAttribute("aria-invalid");
      }
    }
    if (end) {
      if (invalidEnd) {
        end.setAttribute("aria-invalid", "true");
      } else {
        end.removeAttribute("aria-invalid");
      }
    }
    if (coverage) {
      coverage.textContent = validation.status === "valid"
        ? `편집기에서 준비할 범위 ${formatStudioTimecode(Math.max(0, validation.startSeconds! - HANDLE_SECONDS))} ~ ${formatStudioTimecode(validation.endSeconds! + HANDLE_SECONDS)} (앞뒤 10초 포함)`
        : validation.status === "invalid-order"
          ? STUDIO_SELECTION_RANGE_ORDER_ERROR
          : invalid
            ? STUDIO_SELECTION_RANGE_INPUT_ERROR
            : "시작과 끝을 기록하면 편집기에서 준비할 범위를 보여드립니다.";
    }
  });
  elements.editorDuration.textContent = formatStudioDurationSummary(
    validRangeCount > 0 ? validDurationSeconds : null
  );
  elements.editorDuration.title = validRangeCount > 0
    ? `정확한 편집본 길이 ${formatStudioTimecode(validDurationSeconds)}`
    : "시작과 끝이 정해진 구간이 아직 없습니다.";
  const activeIndex = Math.max(0, rows.indexOf(activeClipRow ?? rows[0]!));
  elements.activeClipLabel.textContent =
    `현재 입력 #${String(activeIndex + 1).padStart(2, "0")}`;
  syncCaptureConsoleAvailability();
  renderEditorEntryAvailability();
}

function createClipRow({
  startSeconds,
  endSeconds,
  note = ""
}: {
  startSeconds?: number;
  endSeconds?: number;
  note?: string;
} = {}): HTMLElement {
  const first = elements.clipTemplate.content.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error("구간 입력 템플릿을 읽지 못했습니다.");
  }
  const row = first.cloneNode(true);
  if (!(row instanceof HTMLElement)) {
    throw new Error("구간 입력 행을 만들지 못했습니다.");
  }
  row.dataset.selectionId = crypto.randomUUID();
  const start = requiredInputWithin(row, '[data-field="start"]');
  const end = requiredInputWithin(row, '[data-field="end"]');
  const noteInput = requiredInputWithin(row, '[data-field="note"]');
  if (startSeconds !== undefined) {
    start.value = formatStudioTimecode(startSeconds);
  }
  if (endSeconds !== undefined) {
    end.value = formatStudioTimecode(endSeconds);
  }
  noteInput.value = note;
  row.addEventListener("input", () => {
    row.classList.remove("finalized");
    row.removeAttribute("data-finalized");
    updateClipRows();
  });
  row.addEventListener("focusin", () => {
    activeClipRow = row;
    updateClipRows();
  });
  row.addEventListener("pointerdown", () => {
    activeClipRow = row;
    updateClipRows();
  });
  row.querySelector<HTMLButtonElement>('[data-action="remove"]')
    ?.addEventListener("click", () => {
      if (clipRows().length > 1) {
        row.remove();
        if (activeClipRow === row) {
          activeClipRow = clipRows().at(-1) ?? null;
        }
        updateClipRows();
      }
    });
  return row;
}

function addClipRow(options: {
  startSeconds?: number;
  endSeconds?: number;
  note?: string;
} = {}): HTMLElement {
  const row = createClipRow(options);
  elements.clipList.append(row);
  activeClipRow = row;
  updateClipRows();
  return row;
}

function requiredInputWithin(
  parent: ParentNode,
  selector: string
): HTMLInputElement {
  const input = parent.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`구간 입력 요소가 없습니다: ${selector}`);
  }
  return input;
}

function normalizedProjectName({ required = true }: { required?: boolean } = {}): string {
  const projectName = elements.projectName.value.normalize("NFKC").trim();
  if (projectName.length > 160 || (required && !projectName)) {
    throw new TypeError("프로젝트 이름을 1~160자로 입력해 주세요.");
  }
  return projectName;
}

function currentSource({
  requireProjectName = true
}: {
  requireProjectName?: boolean;
} = {}): SourceRecord {
  const input = elements.sourceUrl.value.trim();
  const descriptor = sourceEmbedDescriptor(input, {
    studioOrigin: location.origin
  });
  if (!descriptor) {
    throw new TypeError(
      "라이브·클립이 아닌 CHZZK·YouTube·SOOP의 단일 공개 VOD 주소를 입력해 주세요."
    );
  }
  const identifiers = inferSourceIdentifiers(descriptor.sourceUrl);
  const canonicalUrl = descriptor.sourceUrl;
  const projectName = normalizedProjectName({ required: requireProjectName });
  return {
    platform: identifiers.platform,
    channelId: identifiers.channelId,
    contentId: identifiers.contentId,
    contentType: "vod",
    canonicalUrl,
    url: canonicalUrl,
    broadcastTitle: projectName || "Kirinuki 로컬 컷 제어"
  };
}

function currentCaptureState({
  requireProjectName = true
}: {
  requireProjectName?: boolean;
} = {}): CaptureState {
  const source = currentSource({ requireProjectName });
  const populatedRows = clipRows().filter((row) => {
    const startInput = requiredInputWithin(row, '[data-field="start"]');
    const endInput = requiredInputWithin(row, '[data-field="end"]');
    const noteInput = requiredInputWithin(row, '[data-field="note"]');
    return Boolean(
      startInput.value.trim()
      || endInput.value.trim()
      || noteInput.value.trim()
    );
  });
  const segments = populatedRows.map((row, index) => {
    const startInput = requiredInputWithin(row, '[data-field="start"]');
    const endInput = requiredInputWithin(row, '[data-field="end"]');
    const noteInput = requiredInputWithin(row, '[data-field="note"]');
    const validation = validateStudioSelectionRange(
      startInput.value,
      endInput.value
    );
    if (validation.status !== "valid") {
      row.classList.add("invalid");
      (validation.status === "invalid-order" ? endInput : startInput).focus();
      throw new TypeError(
        `${index + 1}번 구간: ${
          validation.status === "invalid-order"
            ? STUDIO_SELECTION_RANGE_ORDER_ERROR
            : STUDIO_SELECTION_RANGE_INPUT_ERROR
        }`
      );
    }
    const selectionId = String(row.dataset.selectionId || "").trim();
    if (!selectionId) {
      throw new TypeError(`${index + 1}번 구간의 내부 식별자를 확인하지 못했습니다.`);
    }
    return {
      id: selectionId,
      startSeconds: validation.startSeconds!,
      endSeconds: validation.endSeconds!,
      description: noteInput.value.normalize("NFKC").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
  if (segments.length === 0) {
    throw new TypeError("편집할 구간을 하나 이상 입력해 주세요.");
  }
  return {
    source,
    projectName: normalizedProjectName({ required: requireProjectName })
      || "Kirinuki 로컬 컷 제어",
    segments
  };
}

function setCaptureBackupStatus(
  message: string,
  kind: "idle" | "error" | "success" = "idle"
): void {
  elements.captureBackupStatus.textContent = message;
  elements.captureBackupStatus.classList.toggle("error", kind === "error");
  elements.captureBackupStatus.classList.toggle("success", kind === "success");
}

function sanitizeCaptureBackupFileStem(value: string): string {
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

function captureBackupFileName(projectName: string, createdAt: string): string {
  const iso = new Date(createdAt).toISOString();
  const timestamp = `${iso.slice(0, 10).replace(/-/gu, "")}-${iso
    .slice(11, 19)
    .replace(/:/gu, "")}Z`;
  return `${sanitizeCaptureBackupFileStem(projectName)}-컷백업-${timestamp}.kirinuki-session.json`;
}

function startCaptureBackupDownload(
  json: string,
  fileName: string
): void {
  const objectUrl = URL.createObjectURL(new Blob([json], {
    type: "application/json;charset=utf-8"
  }));
  const download = document.createElement("a");
  download.href = objectUrl;
  download.download = fileName;
  download.hidden = true;
  document.body.append(download);
  try {
    download.click();
  } finally {
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

async function exportCurrentCaptureSessionArchive(): Promise<void> {
  if (captureBackupBusy) {
    return;
  }
  captureBackupBusy = true;
  elements.exportSessionArchive.disabled = true;
  elements.exportSessionArchive.setAttribute("aria-busy", "true");
  setCaptureBackupStatus("현재 컷 백업을 만드는 중입니다…");
  try {
    const captureState = currentCaptureState();
    const projectName = normalizedProjectName();
    const segmentCount = captureState.segments?.length ?? 0;
    const createdAt = new Date().toISOString();
    const json = await sessionArchiveJsonFromCaptureState(captureState, {
      projectId: createFreshEditorProjectId(),
      createdAt
    });
    startCaptureBackupDownload(
      json,
      captureBackupFileName(projectName, createdAt)
    );
    setCaptureBackupStatus(
      `원본 링크와 ${segmentCount}개 구간의 백업 다운로드를 시작했습니다. 영상은 포함되지 않으며, 링크와 메모가 든 파일 공유에 주의하세요.`,
      "success"
    );
  } catch (error) {
    setCaptureBackupStatus(
      `현재 컷을 백업하지 못했습니다: ${errorMessage(error)}`,
      "error"
    );
  } finally {
    captureBackupBusy = false;
    elements.exportSessionArchive.disabled = false;
    elements.exportSessionArchive.removeAttribute("aria-busy");
  }
}

async function cancelLocalPreviewOperation(
  operation: ActiveLocalPreviewOperation
): Promise<void> {
  operation.controller.abort();
  if (!operation.jobId) {
    return;
  }
  try {
    await cancelChzzkVodMaterialization({
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
      token: operation.token,
      jobId: operation.jobId
    });
  } catch {
    // A terminal/reused job can win the race with cancellation. Its generation
    // guard still prevents stale media from replacing the current preview.
  }
}

function cancelActiveLocalPreviewOperation(): void {
  const operation = activeLocalPreviewOperation;
  if (!operation) {
    return;
  }
  activeLocalPreviewOperation = null;
  void cancelLocalPreviewOperation(operation);
}

function resetLocalPreviewSession(): void {
  cancelActiveLocalPreviewOperation();
  localPreviewGeneration += 1;
  localPreviewBusy = false;
  localPreviewSourceStartSeconds = 0;
  localPreviewSourceDurationSeconds = 0;
  localPreviewProjectId = createFreshEditorProjectId();
  localPreviewSourceUrl = "";
  localPreviewToken = "";
  elements.streamVideo.pause();
  elements.streamVideo.removeAttribute("src");
  elements.streamVideo.load();
  elements.streamVideo.hidden = true;
  elements.streamPreviewNavigation.hidden = true;
  elements.streamPreviewTimeline.value = "0";
  elements.streamPreviewTimeline.max = "0";
  elements.streamPreviewTimeline.disabled = true;
  elements.loadPreviewWindow.disabled = true;
  elements.streamPreviewTarget.textContent = "00:00:00";
  syncCaptureConsoleAvailability();
}

async function materializeLocalPreviewRange({
  token,
  sourceUrl,
  projectId,
  generation,
  startSeconds,
  endSeconds,
  targetSeconds
}: {
  token: string;
  sourceUrl: string;
  projectId: string;
  generation: number;
  startSeconds: number;
  endSeconds: number;
  targetSeconds: number;
}): Promise<ChzzkVodMaterializationStatus> {
  const clipId = `preview-${generation}-${Math.round(startSeconds * 1_000)}-${Math.round(endSeconds * 1_000)}`;
  const operation: ActiveLocalPreviewOperation = {
    controller: new AbortController(),
    generation,
    token,
    jobId: null
  };
  activeLocalPreviewOperation = operation;
  let status: ChzzkVodMaterializationStatus;
  try {
    status = await startChzzkVodMaterialization({
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
      token,
      consumerId: projectId,
      sourceUrl,
      clips: [{
        id: clipId,
        startMs: Math.round(startSeconds * 1_000),
        endMs: Math.round(endSeconds * 1_000)
      }],
      rightsConfirmed: true
    });
    operation.jobId = status.jobId;
    if (
      generation !== localPreviewGeneration
      || activeLocalPreviewOperation !== operation
    ) {
      await cancelLocalPreviewOperation(operation);
      throw new DOMException(
        "원본 또는 목표 위치 변경으로 오래된 미리보기를 폐기했습니다.",
        "AbortError"
      );
    }
  } catch (error) {
    if (activeLocalPreviewOperation === operation) {
      activeLocalPreviewOperation = null;
    }
    throw error;
  }
  const report = (nextStatus: ChzzkVodMaterializationStatus): void => {
    if (
      generation !== localPreviewGeneration
      || activeLocalPreviewOperation !== operation
    ) {
      return;
    }
    const percent = Math.round(nextStatus.progress * 100);
    elements.streamCutStatus.textContent =
      `${materializationStage(nextStatus)} · ${percent}%`;
  };
  report(status);
  if (status.state !== "completed") {
    status = await waitForChzzkVodMaterialization({
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
      token,
      jobId: status.jobId,
      signal: operation.controller.signal,
      onProgress: report
    });
  }
  if (
    generation !== localPreviewGeneration
    || activeLocalPreviewOperation !== operation
  ) {
    await cancelLocalPreviewOperation(operation);
    throw new DOMException("원본 변경으로 오래된 미리보기를 폐기했습니다.", "AbortError");
  }
  activeLocalPreviewOperation = null;
  const materialization = normalizeChzzkVodMaterialization(
    status.materialization
  );
  const window = materialization?.windows.find(
    (candidate) => candidate.clipIds.includes(clipId)
  );
  if (!materialization || !window || !status.media) {
    throw new Error("도우미가 로컬 미리보기의 원본 시각을 검증하지 못했습니다.");
  }
  localPreviewSourceDurationSeconds = materialization.sourceDurationMs / 1_000;
  localPreviewSourceStartSeconds = localPreviewSourceAtMediaZero(window);
  elements.streamPreviewNavigation.hidden = false;
  elements.streamPreviewTimeline.disabled = false;
  elements.loadPreviewWindow.disabled = false;
  elements.streamPreviewTimeline.max = String(localPreviewSourceDurationSeconds);
  elements.streamPreviewTimeline.value = String(Math.min(
    localPreviewSourceDurationSeconds,
    Math.max(0, targetSeconds)
  ));
  elements.streamPreviewTarget.textContent = formatStudioTimecode(
    Number(elements.streamPreviewTimeline.value)
  );
  elements.streamFrame.hidden = true;
  elements.streamPlaceholder.hidden = true;
  elements.streamVideo.hidden = false;
  // The loopback gateway requires the exact public Origin even for media
  // elements. Anonymous CORS makes Chromium send that Origin while still
  // keeping cookies and credentials out of the helper request.
  elements.streamVideo.crossOrigin = "anonymous";
  elements.streamVideo.src = status.media.url;
  elements.streamVideo.load();
  elements.streamVideo.addEventListener("loadedmetadata", () => {
    if (generation !== localPreviewGeneration) {
      return;
    }
    elements.streamVideo.currentTime = Math.max(
      0,
      Math.min(
        elements.streamVideo.duration,
        targetSeconds - localPreviewSourceStartSeconds
      )
    );
    syncCaptureConsoleAvailability();
  }, { once: true });
  elements.streamStatus.textContent =
    "도우미가 준비한 짧은 로컬 구간을 이 웹페이지에서 재생합니다.";
  elements.streamCutStatus.textContent =
    "연결됐습니다. E/R/D/F/Y/U 단축키가 현재 원본 시각에 맞춰 동작합니다.";
  return status;
}

async function prepareLocalPreview(targetSeconds = 0): Promise<void> {
  if (localPreviewBusy) {
    cancelActiveLocalPreviewOperation();
  }
  if (!allAcknowledgementsChecked()) {
    elements.streamCutStatus.textContent =
      "로컬 VOD를 준비하기 전에 아래 권리 확인 항목을 확인해 주세요.";
    focusFirstMissingAcknowledgement();
    return;
  }
  const source = currentSource({ requireProjectName: false });
  const sourceUrl = String(source.canonicalUrl || source.url || "").trim();
  if (localPreviewSourceUrl && localPreviewSourceUrl !== sourceUrl) {
    resetLocalPreviewSession();
  }
  localPreviewSourceUrl = sourceUrl;
  const generation = ++localPreviewGeneration;
  localPreviewBusy = true;
  elements.loadPreviewWindow.disabled = true;
  try {
    elements.streamCutStatus.textContent =
      "이 PC의 영상 준비 도우미 연결을 확인하고 있습니다…";
    const readiness = await ensureLocalMediaEngineReady(undefined, {
      allowImmediateProtocolLaunch: true
    });
    if (generation !== localPreviewGeneration) {
      throw new DOMException("더 새로운 미리보기 요청이 시작됐습니다.", "AbortError");
    }
    if (readiness === "manual-file") {
      elements.streamCutStatus.textContent =
        "도우미 연결을 건너뛰었습니다. 시간은 직접 입력하고 편집기에서 파일을 연결할 수 있습니다.";
      return;
    }
    localPreviewToken = await pairCaptionAgent({
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
      purpose: "vod",
      projectId: localPreviewProjectId,
      sourceUrl
    });
    if (generation !== localPreviewGeneration) {
      throw new DOMException("더 새로운 미리보기 요청이 시작됐습니다.", "AbortError");
    }
    let duration = localPreviewSourceDurationSeconds;
    if (duration <= 0) {
      const bootstrap = await materializeLocalPreviewRange({
        token: localPreviewToken,
        sourceUrl,
        projectId: localPreviewProjectId,
        generation,
        startSeconds: 0,
        endSeconds: 1,
        targetSeconds: 0
      });
      const materialization = normalizeChzzkVodMaterialization(
        bootstrap.materialization
      );
      duration = (materialization?.sourceDurationMs || 0) / 1_000;
    }
    if (duration <= 0) {
      throw new Error("원본 VOD의 전체 길이를 확인하지 못했습니다.");
    }
    const preview = planLocalPreviewRange(duration, targetSeconds);
    await materializeLocalPreviewRange({
      token: localPreviewToken,
      sourceUrl,
      projectId: localPreviewProjectId,
      generation,
      startSeconds: preview.startSeconds,
      endSeconds: preview.endSeconds,
      targetSeconds: preview.targetSeconds
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      if (activeLocalPreviewOperation?.generation === generation) {
        cancelActiveLocalPreviewOperation();
      }
      elements.streamCutStatus.textContent =
        `로컬 미리보기를 준비하지 못했습니다: ${errorMessage(error)}`;
    }
  } finally {
    if (generation === localPreviewGeneration) {
      if (activeLocalPreviewOperation?.generation === generation) {
        activeLocalPreviewOperation = null;
      }
      localPreviewBusy = false;
      syncCaptureConsoleAvailability();
      elements.loadPreviewWindow.disabled = localPreviewSourceDurationSeconds <= 0;
    }
  }
}

async function prepareSelectedVodForEditor(
  projectId: string,
  captureSeed: CaptureState
): Promise<boolean> {
  if (forceManualFileForNextPreparation) {
    forceManualFileForNextPreparation = false;
    hideCutPreparation();
    setStatus(
      "내 파일로 계속합니다. 편집기에서 ‘내 파일 직접 연결’을 선택해 주세요.",
      "idle"
    );
    return false;
  }
  showCutPreparation("이 PC의 영상 준비 도우미를 확인하고 있습니다", 0.01);
  const readiness = await ensureLocalMediaEngineReady();
  if (readiness === "manual-file") {
    hideCutPreparation();
    setStatus(
      "도우미 없이 계속합니다. 편집기에서 ‘내 파일 직접 연결’을 선택해 주세요.",
      "idle"
    );
    return false;
  }
  const sourceUrl = String(
    captureSeed.source?.canonicalUrl || captureSeed.source?.url || ""
  ).trim();
  const clips = (captureSeed.segments || []).map((segment, index) => {
    const id = String(segment.id || "").trim();
    const startSeconds = Number(segment.startSeconds);
    const endSeconds = Number(segment.endSeconds);
    if (
      !id
      || !Number.isFinite(startSeconds)
      || !Number.isFinite(endSeconds)
      || startSeconds < 0
      || endSeconds - startSeconds < MINIMUM_SELECTION_SECONDS
    ) {
      throw new TypeError("선택한 VOD 구간을 부분 준비 범위로 바꾸지 못했습니다.");
    }
    return {
      id: captureSegmentEditorClipId(segment, index),
      startMs: Math.round(startSeconds * 1_000),
      endMs: Math.round(endSeconds * 1_000)
    };
  });
  showCutPreparation("도우미와 이 편집만을 위한 안전한 연결을 만들고 있습니다", 0.03);
  const token = await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    purpose: "vod",
    projectId,
    sourceUrl
  });
  let status = await startChzzkVodMaterialization({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token,
    consumerId: projectId,
    sourceUrl,
    clips,
    rightsConfirmed: true
  });
  showCutPreparation(materializationStage(status), status.progress);
  if (status.state !== "completed") {
    status = await waitForChzzkVodMaterialization({
      endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
      token,
      jobId: status.jobId,
      onProgress: (nextStatus) => {
        showCutPreparation(
          materializationStage(nextStatus),
          nextStatus.progress
        );
      }
    });
  }
  if (
    status.state !== "completed"
    || status.media === undefined
    || status.materialization === undefined
  ) {
    throw new Error(
      "도우미가 선택한 구간의 영상과 원본 시각 검증을 완료하지 못했습니다."
    );
  }
  showCutPreparation("준비가 끝났습니다. 같은 브라우저 편집기를 여는 중입니다", 1);
  return true;
}

function allAcknowledgementsChecked(): boolean {
  const acknowledgements = [
    ...document.querySelectorAll<HTMLInputElement>("[data-ack]")
  ];
  return acknowledgements.length === 6
    && acknowledgements.every((input) => input.checked);
}

function focusFirstMissingAcknowledgement(): void {
  elements.policySection.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector<HTMLInputElement>(
    "#policy-section [data-ack]:not(:checked)"
  )?.focus({ preventScroll: true });
}

function createAttestation(target: UsagePolicyTarget): UsagePolicyAttestation {
  if (!allAcknowledgementsChecked()) {
    throw new TypeError("필수 책임 확인 항목을 모두 선택해 주세요.");
  }
  return createPerUseConfirmationAttestation({
    target,
    confirmationText: USAGE_POLICY_CONFIRMATION_PHRASE,
    confirmedAt: new Date().toISOString()
  });
}

function resumeSourceSessionId(project: EditorProject): string {
  const source = recoverySourceRecord(project.source);
  return sourceSessionIdentity(source ?? undefined)
    || `saved-project:${project.id}`;
}

function showResumePolicy(
  project: EditorProject,
  { recoveryDrafts = false }: { recoveryDrafts?: boolean } = {}
): void {
  for (const acknowledgement of document.querySelectorAll<HTMLInputElement>(
    "#policy-section [data-ack]"
  )) {
    acknowledgement.checked = false;
  }
  const source = recoverySourceRecord(project.source);
  resumeProject = project;
  resumeRecoveryDrafts = recoveryDrafts;
  if (source?.canonicalUrl) {
    elements.sourceUrl.value = String(source.canonicalUrl);
  }
  elements.projectName.value = project.name;
  elements.startEditor.textContent = "편집기 열기";
  elements.selectionRail.hidden = true;
  elements.selectionRail.inert = true;
  elements.sourceCacheStatus.hidden = true;
  setStatus(
    recoveryDrafts
      ? `“${project.name}”의 복구본을 권리 확인 후 선택합니다.`
      : `“${project.name}”의 마지막 저장 상태를 권리 확인 후 이어서 엽니다.`,
    "success"
  );
  updateSourcePlatform();
  updateStreamPreview();
  elements.policySection.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector<HTMLInputElement>(
    "#policy-section [data-ack]"
  )?.focus({ preventScroll: true });
}

function clearResumeMode(): void {
  if (!resumeProject) {
    return;
  }
  resumeProject = null;
  resumeRecoveryDrafts = false;
  elements.startEditor.textContent = "편집기 열기";
  elements.selectionRail.hidden = false;
  elements.selectionRail.inert = false;
  setStatus("새 편집을 만들려면 원본 VOD와 한 개 이상의 구간이 필요합니다.");
  void refreshStoredSourceIntent();
}

async function refreshStoredSourceIntent(): Promise<void> {
  if (resumeProject) {
    return;
  }
  let sourceIdentity = "";
  try {
    sourceIdentity = sourceSessionIdentity(
      currentSource({ requireProjectName: false })
    );
  } catch {
    sourceIdentity = "";
  }
  const sameSourceCount = sourceIdentity
    ? localProjectEntries.filter(({ project, hasOpenEditingSession }) => (
      !hasOpenEditingSession
      && sourceSessionIdentity(recoverySourceRecord(project.source) ?? undefined)
        === sourceIdentity
    )).length
    : 0;
  if (sameSourceCount === 0) {
    elements.sourceCacheStatus.hidden = true;
    elements.startEditor.textContent = "편집기 열기";
    return;
  }
  elements.sourceCacheStatus.textContent =
    `이 VOD의 브라우저 저장 편집이 ${sameSourceCount}개 있습니다. 아래 버튼은 항상 별도의 새 편집을 만들며 기존 저장본과 섞지 않습니다.`;
  elements.sourceCacheStatus.hidden = false;
  elements.startEditor.textContent = "편집기 열기";
}

function hasMeaningfulCaptureInput(): boolean {
  return Boolean(
    resumeProject
    || elements.sourceUrl.value.trim()
    || clipRows().some((row) => (
      requiredInputWithin(row, '[data-field="start"]').value.trim()
      || requiredInputWithin(row, '[data-field="end"]').value.trim()
      || requiredInputWithin(row, '[data-field="note"]').value.trim()
    ))
  );
}

async function importSessionArchiveFile(file: File): Promise<void> {
  if (
    !Number.isSafeInteger(file.size)
    || file.size <= 0
    || file.size > SESSION_ARCHIVE_MAX_JSON_BYTES
  ) {
    throw new TypeError("백업 파일 크기가 허용 범위를 벗어났습니다.");
  }
  setStatus("백업 파일과 원본·구간을 확인하는 중입니다…");
  const imported = await sessionArchiveCaptureFromJson(await file.text());
  if (
    hasMeaningfulCaptureInput()
    && !window.confirm(uiLocalization.translate(
      `현재 입력을 ‘${imported.projectName}’의 원본 링크와 ${imported.segments.length}개 구간으로 바꿀까요?\n\n현재 편집기 세션과 정책 확인은 건드리지 않습니다.`
    ))
  ) {
    setStatus("백업 파일 불러오기를 취소했습니다.");
    return;
  }

  const importedRows = imported.segments.map((segment) => {
    const row = createClipRow({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      note: segment.note
    });
    row.dataset.finalized = "true";
    row.classList.add("finalized");
    return row;
  });

  clearResumeMode();
  elements.sourceUrl.value = imported.sourceUrl;
  elements.projectName.value = imported.projectName;
  elements.clipList.replaceChildren(...importedRows);
  activeClipRow = importedRows.at(-1) ?? null;
  updateClipRows();
  updateSourcePlatform();
  updateStreamPreview({ force: true });
  setStatus(
    `백업 파일에서 원본 링크와 ${importedRows.length}개 구간을 불러왔습니다. 권리 확인은 다시 진행해 주세요.`,
    "success"
  );
}

function updateSourcePlatform(): void {
  const identifiers = inferSourceIdentifiers(elements.sourceUrl.value.trim());
  const label = sourcePlatformLabel(identifiers.platform);
  let isVod = false;
  try {
    isVod = Boolean(sourceEmbedDescriptor(elements.sourceUrl.value.trim(), {
      studioOrigin: location.origin
    }));
  } catch {
    isVod = false;
  }
  elements.sourcePlatform.textContent = isVod ? `${label} VOD` : "URL 확인 필요";
  elements.sourcePlatform.classList.toggle("valid", isVod);
  syncCaptureConsoleAvailability();
  renderLocalProjectEntries();
  void refreshStoredSourceIntent();
}

function clearStreamPreview(message: string): void {
  if (streamLoadTimer !== null) {
    window.clearTimeout(streamLoadTimer);
    streamLoadTimer = null;
  }
  activeStreamEmbedUrl = "";
  activeStreamPlatform = "";
  resetLocalVodWebPlayback();
  replaceStreamFrame();
  elements.streamFrame.removeAttribute("src");
  elements.streamFrame.hidden = true;
  elements.streamVideo.pause();
  elements.streamVideo.removeAttribute("src");
  elements.streamVideo.load();
  elements.streamVideo.hidden = true;
  localPreviewSourceStartSeconds = 0;
  elements.streamPlaceholder.hidden = false;
  elements.sourceCaptureWorkspace.hidden = true;
  elements.streamKind.textContent = "링크 대기";
  elements.streamKind.classList.remove("valid");
  elements.streamStatus.textContent = message;
  elements.reloadStream.disabled = true;
  syncCaptureConsoleAvailability();
}

function updateStreamPreview({ force = false }: { force?: boolean } = {}): void {
  let descriptor: ReturnType<typeof sourceEmbedDescriptor>;
  try {
    descriptor = sourceEmbedDescriptor(elements.sourceUrl.value.trim(), {
      studioOrigin: location.origin
    });
  } catch (error) {
    clearStreamPreview(errorMessage(error));
    return;
  }
  if (!descriptor) {
    clearStreamPreview("지원되는 단일 공개 VOD 주소를 입력하면 플레이어가 열립니다.");
    return;
  }
  if (
    !force
    && activeStreamEmbedUrl === descriptor.embedUrl
    && activeStreamPlatform === descriptor.platform
  ) {
    return;
  }
  resetLocalVodWebPlayback();
  resetLocalPreviewSession();
  activeStreamEmbedUrl = descriptor.embedUrl;
  activeStreamPlatform = descriptor.platform;
  replaceStreamFrame();
  elements.sourceCaptureWorkspace.hidden = false;
  elements.streamKind.textContent = descriptor.label;
  elements.streamKind.classList.add("valid");
  elements.streamStatus.textContent = descriptor.kind === "official-embed"
    ? "플랫폼 공식 임베드에 브라우저가 직접 연결하는 중입니다…"
    : "CHZZK VOD 페이지에 브라우저가 직접 연결하는 중입니다…";
  elements.streamPlaceholder.hidden = true;
  elements.streamFrame.hidden = false;
  elements.streamFrame.src = descriptor.embedUrl;
  elements.reloadStream.disabled = false;
  if (
    descriptor.platform === SOURCE_PLATFORM_CHZZK
    || descriptor.platform === SOURCE_PLATFORM_SOOP
  ) {
    void connectLocalVodWebPlayback(descriptor.sourceUrl);
  }
  syncCaptureConsoleAvailability();
  if (streamLoadTimer !== null) {
    window.clearTimeout(streamLoadTimer);
  }
  streamLoadTimer = window.setTimeout(() => {
    streamLoadTimer = null;
    if (
      activeStreamEmbedUrl === descriptor.embedUrl
      && !localVodPlayback
    ) {
      elements.streamStatus.textContent =
        "원본 플레이어 연결을 아직 확인하지 못했습니다. 도우미 실행 상태를 확인한 뒤 ‘플레이어 다시 시작’을 눌러 주세요.";
    }
  }, 12_000);
}

function scheduleStreamPreview(): void {
  if (streamPreviewTimer !== null) {
    window.clearTimeout(streamPreviewTimer);
  }
  streamPreviewTimer = window.setTimeout(() => {
    streamPreviewTimer = null;
    updateStreamPreview();
  }, 180);
}

function localProjectUpdatedAtMs(project: EditorProject): number {
  const value = Date.parse(String(project.updatedAt || project.createdAt || ""));
  return Number.isFinite(value) ? value : 0;
}

function localProjectTimeLabel(updatedAtMs: number): string {
  if (updatedAtMs <= 0) {
    return "저장 시각 정보 없음";
  }
  return new Intl.DateTimeFormat(uiIntlLocale(uiLocalization.language), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(updatedAtMs));
}

function currentFormSourceIdentity(): string {
  try {
    return sourceSessionIdentity(currentSource({ requireProjectName: false }));
  } catch {
    return "";
  }
}

function renderLocalProjectEntries(): void {
  const currentIdentity = currentFormSourceIdentity();
  const rows = localProjectEntries.map(({
    project,
    draftCount,
    updatedAtMs,
    hasOpenEditingSession
  }) => {
    const fragment = elements.localProjectRowTemplate.content.cloneNode(
      true
    ) as DocumentFragment;
    const row = requiredElementWithin<HTMLElement>(
      fragment,
      ".local-project-row"
    );
    row.dataset.projectId = project.id;
    const source = recoverySourceRecord(project.source);
    const projectIdentity = sourceSessionIdentity(source ?? undefined);
    const sameSource = Boolean(currentIdentity && projectIdentity === currentIdentity);
    row.classList.toggle("is-current-source", sameSource);
    row.classList.toggle("is-busy", hasOpenEditingSession);
    requiredElementWithin<HTMLElement>(row, ".local-project-platform").textContent =
      sourcePlatformLabel(source?.platform);
    requiredElementWithin<HTMLElement>(row, ".local-project-same-source").hidden =
      !sameSource;
    requiredElementWithin<HTMLElement>(row, ".local-project-active-session").hidden =
      !hasOpenEditingSession;
    requiredElementWithin<HTMLElement>(row, ".local-project-title").textContent =
      project.name;
    const time = requiredElementWithin<HTMLTimeElement>(row, ".local-project-time");
    time.textContent = localProjectTimeLabel(updatedAtMs);
    if (updatedAtMs > 0) {
      time.dateTime = new Date(updatedAtMs).toISOString();
    }
    requiredElementWithin<HTMLElement>(row, ".local-project-counts").textContent =
      `컷 ${project.clips.length.toLocaleString(uiIntlLocale(uiLocalization.language))}개 · 자막 ${project.subtitles.length.toLocaleString(uiIntlLocale(uiLocalization.language))}개`;
    requiredElementWithin<HTMLElement>(row, ".local-project-drafts").textContent =
      hasOpenEditingSession
        ? "현재 다른 탭에서 편집 중입니다"
        : draftCount > 0
          ? `복구본 ${draftCount}개`
          : "복구본 없음 · 마지막 저장 상태에서 계속할 수 있습니다";
    const continueEditing = requiredElementWithin<HTMLButtonElement>(
      row,
      '[data-project-action="continue"]'
    );
    const recover = requiredElementWithin<HTMLButtonElement>(
      row,
      '[data-project-action="recover"]'
    );
    const remove = requiredElementWithin<HTMLButtonElement>(
      row,
      '[data-project-action="delete"]'
    );
    recover.textContent = draftCount > 0
      ? `복구본 선택 (${draftCount})`
      : "복구본 없음";
    continueEditing.setAttribute(
      "aria-label",
      `“${project.name}” 계속 편집`
    );
    recover.setAttribute(
      "aria-label",
      draftCount > 0
        ? `“${project.name}” 복구본 ${draftCount}개 중 선택`
        : `“${project.name}” 선택할 복구본 없음`
    );
    remove.setAttribute(
      "aria-label",
      `“${project.name}” 브라우저 저장 데이터 삭제`
    );
    continueEditing.disabled = mobileEditorBlocked || hasOpenEditingSession;
    recover.disabled = mobileEditorBlocked || hasOpenEditingSession || draftCount === 0;
    remove.disabled = hasOpenEditingSession;
    const busyTitle = "다른 탭에서 편집 중입니다. 그 탭에서 작업을 끝내거나 닫은 뒤 목록을 새로고침해 주세요.";
    const mobileTitle = "편집기는 모바일에서 사용할 수 없습니다. PC 브라우저에서 열어 주세요.";
    continueEditing.title = mobileEditorBlocked
      ? mobileTitle
      : hasOpenEditingSession
      ? busyTitle
      : "이 프로젝트의 마지막 브라우저 저장본을 계속 편집";
    recover.title = mobileEditorBlocked
      ? mobileTitle
      : hasOpenEditingSession
      ? busyTitle
      : draftCount > 0
        ? "이 프로젝트의 최근 5개 자동·수동 복구본 중에서 선택"
        : "이 프로젝트에는 선택할 복구본이 없습니다";
    remove.title = hasOpenEditingSession
      ? busyTitle
      : "이 프로젝트와 연결된 브라우저 저장 데이터 삭제";
    return fragment;
  });
  elements.localProjectsList.replaceChildren(...rows);
}

function renderLocalProjectManagerState(
  state: "loading" | "ready" | "error"
): void {
  localProjectManagerRenderState = state;
  const hasProjects = localProjectEntries.length > 0;
  elements.localProjectManager.hidden = state !== "error" && !hasProjects;
  elements.localProjectManager.ariaBusy = String(state === "loading");
  elements.localProjectsLoading.hidden = state !== "loading";
  elements.localProjectsError.hidden = state !== "error";
  elements.localProjectsEmpty.hidden = state !== "ready" || hasProjects;
  elements.localProjectsList.hidden = state !== "ready" || !hasProjects;
  const hasOpenEditingSession = openEditingCheckpointProjectIds.size > 0;
  elements.clearAllLocalProjects.disabled =
    state !== "ready" || !hasProjects || hasOpenEditingSession;
  elements.clearAllLocalProjects.title = hasOpenEditingSession
    ? "다른 탭에서 편집 중인 작업을 먼저 끝내거나 닫아 주세요."
    : "이 브라우저의 모든 저장 편집 삭제";
  elements.refreshLocalProjects.disabled = state === "loading";
  elements.retryLocalProjects.disabled = state === "loading";
  if (state === "loading") {
    elements.localProjectsSummary.textContent = "브라우저 저장소를 확인하는 중입니다.";
  } else if (state === "error") {
    elements.localProjectsSummary.textContent =
      "목록 준비에 실패했습니다. 오류가 난 항목은 임의로 삭제하지 않았습니다.";
  } else {
    const activeCount = openEditingCheckpointProjectIds.size;
    elements.localProjectsSummary.textContent = hasProjects
      ? `저장된 편집 ${localProjectEntries.length.toLocaleString(uiIntlLocale(uiLocalization.language))}개 · 최근 수정순${activeCount > 0 ? ` · 다른 탭 작업 중 ${activeCount}개` : ""}`
      : "저장된 편집 없음 · 아래 입력은 항상 새 프로젝트로 시작합니다.";
  }
}

async function refreshLocalProjectManager({
  announce = false
}: {
  announce?: boolean;
} = {}): Promise<boolean> {
  if (localProjectManagerBusy) {
    return false;
  }
  localProjectManagerBusy = true;
  renderLocalProjectManagerState("loading");
  try {
    const checkpointProjectIds = [
      ...new Set(await listEditingSessionCheckpointProjectIds())
    ].sort((first, second) => first.localeCompare(second));
    const rolledBackProjectIds: string[] = [];
    await Promise.all(checkpointProjectIds.map(async (projectId) => {
      const result = await runWithExclusiveStudioProjectAccess(
        projectId,
        () => discardAbandonedEditingSessionCheckpoint(projectId)
      );
      if (result.acquired && result.value) {
        rolledBackProjectIds.push(projectId);
        await studioStorageArea().remove(
          `chzzkKirinukiEditorSeed:${projectId}`
        );
        if (localStorage.getItem(WEB_STUDIO_LATEST_PROJECT_KEY) === projectId) {
          localStorage.removeItem(WEB_STUDIO_LATEST_PROJECT_KEY);
        }
      }
    }));
    const openEditingProjectIds = new Set(
      await listEditingSessionCheckpointProjectIds()
    );
    openEditingCheckpointProjectIds = openEditingProjectIds;
    const storedProjects = await listProjects();
    const projects = storedProjects.map((storedProject) => {
      const normalized = normalizeEditorProject(storedProject);
      if (!normalized) {
        throw new TypeError(
          `지원하지 않는 브라우저 프로젝트가 있습니다: ${String(storedProject.id || "알 수 없음")}`
        );
      }
      return normalized;
    });
    const draftCounts = await Promise.all(projects.map(async (project) => (
      await listLocalDrafts(project.id, { limit: 5 })
    ).length));
    localProjectEntries = projects.map((project, index) => ({
      project,
      draftCount: draftCounts[index] ?? 0,
      updatedAtMs: localProjectUpdatedAtMs(project),
      hasOpenEditingSession: openEditingProjectIds.has(project.id)
    })).sort((first, second) => (
      second.updatedAtMs - first.updatedAtMs
      || first.project.id.localeCompare(second.project.id)
    ));
    const latestProjectId = localStorage.getItem(WEB_STUDIO_LATEST_PROJECT_KEY);
    if (
      latestProjectId
      && !localProjectEntries.some(({ project }) => project.id === latestProjectId)
    ) {
      localStorage.removeItem(WEB_STUDIO_LATEST_PROJECT_KEY);
    }
    if (
      resumeProject
      && !localProjectEntries.some(({ project }) => project.id === resumeProject?.id)
    ) {
      clearResumeMode();
    }
    renderLocalProjectEntries();
    renderLocalProjectManagerState("ready");
    await refreshStoredSourceIntent();
    localProjectManagerLastError = null;
    if (rolledBackProjectIds.length > 0) {
      const message =
        `저장으로 확정하지 않은 이전 작업 ${rolledBackProjectIds.length}개를 정리했습니다. 수동 임시저장은 남기고 나머지는 열기 전 상태로 되돌렸습니다.`;
      setStatus(message, "success");
    } else if (announce) {
      setStatus(
        localProjectEntries.length > 0
          ? `저장된 편집 ${localProjectEntries.length}개를 다시 읽었습니다.`
          : "이 브라우저에 저장된 편집이 없습니다."
      );
    }
    return true;
  } catch (error) {
    console.error("브라우저 편집 목록을 읽지 못했습니다.", error);
    localProjectManagerLastError = error;
    localProjectEntries = [];
    openEditingCheckpointProjectIds = new Set();
    elements.localProjectsList.replaceChildren();
    renderLocalProjectManagerState("error");
    if (announce) {
      setStatus(
        `브라우저 편집 목록을 읽지 못했습니다: ${errorMessage(error)}`,
        "error"
      );
    }
    return false;
  } finally {
    localProjectManagerBusy = false;
  }
}

async function reconcileAbandonedProjectsBeforeEditorEntry(): Promise<void> {
  // A focus/pageshow refresh may already own the manager. Wait for that exact
  // cleanup to settle, then run one final lock-guarded inventory ourselves so
  // opening a new editor can never overtake an A→B rollback.
  while (localProjectManagerBusy) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  }
  const refreshed = await refreshLocalProjectManager();
  if (!refreshed) {
    const detail = localProjectManagerLastError
      ? ` (${errorMessage(localProjectManagerLastError)})`
      : "";
    throw new Error(
      `브라우저에 남은 이전 편집의 정리 상태를 확인하지 못했습니다${detail}`
    );
  }
}

async function performLocalProjectLifecycleCleanup({
  announce = false
}: {
  announce?: boolean;
} = {}): Promise<void> {
  await reconcileAbandonedProjectsBeforeEditorEntry();
  if (announce) {
    setStatus(
      localProjectEntries.length > 0
        ? `저장된 편집 ${localProjectEntries.length}개를 다시 읽었습니다.`
        : "이 브라우저에 저장된 편집이 없습니다."
    );
  }
}

const automaticLocalProjectLifecycleCleanup =
  createCoalescedAutomaticOperation({
    enqueue: (operation) => localProjectLifecycleCleanupQueue.enqueue(operation),
    operation: () => performLocalProjectLifecycleCleanup(),
    isEnabled: () => (
      localProjectManagerInitialized
      && !document.hidden
      && !openingEditor
      && pendingLocalProjectDeletion === null
    ),
    onError: (error) => {
      console.error(
        "자동 이전 편집 브라우저 저장 상태 정리에 실패했습니다.",
        error
      );
    }
  });

function queueMandatoryLocalProjectLifecycleCleanup({
  announce = false
}: {
  announce?: boolean;
} = {}): Promise<void> {
  // A mandatory Q/retry/editor-entry inventory is newer than every automatic
  // focus hint. Queued automatic work becomes a no-op; an already-running
  // rollback is allowed to finish before this exact final pass.
  automaticLocalProjectLifecycleCleanup.supersede();
  return localProjectLifecycleCleanupQueue.enqueue(
    () => performLocalProjectLifecycleCleanup({ announce })
  );
}

function requestAutomaticLocalProjectLifecycleCleanup(): void {
  automaticLocalProjectLifecycleCleanup.request();
}

function observeLocalProjectLifecycleCleanup(
  cleanup: Promise<void>
): void {
  void cleanup.catch((error) => {
    console.error("이전 편집의 브라우저 저장 상태를 정리하지 못했습니다.", error);
  });
}

async function requireSafeLocalProjectStateForEditorEntry(): Promise<void> {
  // Await this exact mandatory pass. `openingEditor` prevents later automatic
  // lifecycle events and Q refreshes from appending work behind the barrier.
  try {
    await queueMandatoryLocalProjectLifecycleCleanup();
  } catch {
    throw new Error(
      "이전 편집 정리를 확인하지 못해 새 편집을 열지 않았습니다. 브라우저 저장 편집에서 ‘다시 읽기’를 눌러 정리를 완료한 뒤 다시 시도해 주세요."
    );
  }
}

function scheduleLocalProjectLifecycleRefresh(): void {
  if (
    !localProjectManagerInitialized
    || document.hidden
    || openingEditor
    || pendingLocalProjectDeletion !== null
  ) {
    return;
  }
  if (localProjectLifecycleRefreshTimer !== null) {
    window.clearTimeout(localProjectLifecycleRefreshTimer);
  }
  // Closing an editor commonly emits visibilitychange, pageshow and focus in
  // quick succession. Coalesce them so one lock-guarded inventory performs
  // abandoned-checkpoint rollback before the user has to press refresh.
  localProjectLifecycleRefreshTimer = window.setTimeout(() => {
    localProjectLifecycleRefreshTimer = null;
    if (openingEditor || pendingLocalProjectDeletion) {
      return;
    }
    requestAutomaticLocalProjectLifecycleCleanup();
  }, 80);
}

function prefillSourceFromLocation(): void {
  const consumed = consumeSourceLocation(location.href);
  if (consumed.shouldSanitize) {
    history.replaceState(null, "", consumed.canonicalPath);
  }
  const { source } = consumed;
  if (source) {
    elements.sourceUrl.value = source;
    updateSourcePlatform();
  }
  document.documentElement.dataset.kirinukiSourceLocationSanitized = "true";
  window.dispatchEvent(new Event(SOURCE_LOCATION_SANITIZED_EVENT));
}

function reloadActivePlayerFrame(): void {
  updateStreamPreview({ force: true });
}

async function refreshRecentProject(): Promise<void> {
  try {
    await queueMandatoryLocalProjectLifecycleCleanup({ announce: true });
  } catch {
    // The manager already exposes its retry state. Keep this capture-console
    // refresh usable without turning a failed inventory into an unhandled task.
  }
}

function localProjectEntry(projectId: string): LocalProjectEntry | null {
  return localProjectEntries.find(({ project }) => project.id === projectId)
    ?? null;
}

function openLocalProjectDeleteDialog(
  deletion: PendingLocalProjectDeletion
): void {
  pendingLocalProjectDeletion = deletion;
  if (deletion.mode === "single") {
    const entry = localProjectEntry(deletion.projectId);
    if (!entry) {
      pendingLocalProjectDeletion = null;
      setStatus("삭제할 브라우저 편집을 목록에서 찾지 못했습니다.", "error");
      return;
    }
    elements.localProjectDeleteTitle.textContent =
      `“${entry.project.name}”을 브라우저에서 삭제할까요?`;
    elements.localProjectDeleteSummary.textContent =
      `컷 ${entry.project.clips.length}개 · 자막 ${entry.project.subtitles.length}개 · 복구본 ${entry.draftCount}개를 이 브라우저에서 삭제합니다.`;
    elements.confirmLocalProjectDelete.textContent = "이 편집 삭제";
  } else {
    const draftCount = localProjectEntries.reduce(
      (sum, entry) => sum + entry.draftCount,
      0
    );
    elements.localProjectDeleteTitle.textContent =
      "이 브라우저의 모든 편집을 삭제할까요?";
    elements.localProjectDeleteSummary.textContent =
      `프로젝트 ${localProjectEntries.length}개와 표시된 복구본 ${draftCount}개 및 연결된 브라우저 데이터를 모두 삭제합니다.`;
    elements.confirmLocalProjectDelete.textContent = "모든 편집 삭제";
  }
  if (!elements.localProjectDeleteDialog.open) {
    elements.localProjectDeleteDialog.showModal();
  }
  elements.cancelLocalProjectDelete.focus({ preventScroll: true });
}

function closeLocalProjectDeleteDialog(): void {
  pendingLocalProjectDeletion = null;
  if (elements.localProjectDeleteDialog.open) {
    elements.localProjectDeleteDialog.close();
  }
}

async function removeOneLocalProject(projectId: string): Promise<void> {
  const result = await runWithExclusiveStudioProjectAccess(
    projectId,
    () => deleteProjectSessionAtomically(projectId)
  );
  if (!result.acquired) {
    throw new Error(
      "이 편집이 다른 탭에서 열려 있어 삭제하지 않았습니다. 편집기 탭을 닫은 뒤 다시 시도해 주세요."
    );
  }
  await studioStorageArea().remove(`chzzkKirinukiEditorSeed:${projectId}`);
  if (localStorage.getItem(WEB_STUDIO_LATEST_PROJECT_KEY) === projectId) {
    localStorage.removeItem(WEB_STUDIO_LATEST_PROJECT_KEY);
  }
}

async function removeAllLocalProjects(): Promise<void> {
  const result = await runWithExclusiveStudioProjectCollectionAccess(
    async () => {
      const storage = studioStorageArea();
      const stored = await storage.get(null);
      const seedKeys = Object.keys(stored).filter((key) => (
        key.startsWith("chzzkKirinukiEditorSeed:")
      ));
      const deletion = await deleteAllProjectSessionsAtomically();
      await storage.remove(seedKeys);
      localStorage.removeItem(WEB_STUDIO_LATEST_PROJECT_KEY);
      return deletion;
    }
  );
  if (!result.acquired) {
    throw new Error(
      "다른 탭에서 편집 중인 프로젝트가 있어 모두 삭제하지 않았습니다. 모든 편집기 탭을 닫은 뒤 다시 시도해 주세요."
    );
  }
}

async function confirmLocalProjectDeletion(): Promise<void> {
  const deletion = pendingLocalProjectDeletion;
  if (!deletion || localProjectManagerBusy) {
    return;
  }
  localProjectManagerBusy = true;
  elements.localProjectManager.ariaBusy = "true";
  elements.confirmLocalProjectDelete.disabled = true;
  elements.cancelLocalProjectDelete.disabled = true;
  try {
    if (deletion.mode === "single") {
      await removeOneLocalProject(deletion.projectId);
    } else {
      await removeAllLocalProjects();
    }
    const deletedName = deletion.mode === "single"
      ? localProjectEntry(deletion.projectId)?.project.name || "선택한 편집"
      : "저장된 편집 전체";
    if (
      resumeProject
      && (deletion.mode === "all" || resumeProject.id === deletion.projectId)
    ) {
      clearResumeMode();
    }
    closeLocalProjectDeleteDialog();
    localProjectManagerBusy = false;
    await queueMandatoryLocalProjectLifecycleCleanup();
    setStatus(`${deletedName}의 브라우저 저장 데이터를 삭제했습니다.`, "success");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    localProjectManagerBusy = false;
    elements.localProjectManager.ariaBusy = "false";
    elements.confirmLocalProjectDelete.disabled = false;
    elements.cancelLocalProjectDelete.disabled = false;
  }
}

function currentLocalPreviewSourceTime(): number | null {
  if (
    localVodPlaybackSourceUrl
    || localVodPlaybackConnectPromise
    || elements.streamVideo.hidden
    || elements.streamVideo.readyState < HTMLMediaElement.HAVE_METADATA
    || !Number.isFinite(elements.streamVideo.currentTime)
  ) {
    return null;
  }
  return localPreviewSourceSeconds(
    localPreviewSourceStartSeconds,
    elements.streamVideo.currentTime
  );
}

function currentWebPlayerSourceTime(): number | null {
  return localVodPlayback?.snapshot()?.currentTime
    ?? currentYouTubePlayerSnapshot()?.currentTime
    ?? currentLocalPreviewSourceTime();
}

function updatePlayerClockDisplay(): void {
  const sourceSeconds = currentWebPlayerSourceTime();
  elements.streamCurrentTime.textContent = sourceSeconds === null
    ? "--:--:--"
    : formatStudioTimecode(sourceSeconds);
}

async function captureCurrentPlayerTime(field: "start" | "end"): Promise<void> {
  let sourceSeconds: number | null;
  try {
    if (
      activeStreamPlatform === SOURCE_PLATFORM_CHZZK
      || activeStreamPlatform === SOURCE_PLATFORM_SOOP
    ) {
      const controller = await ensureLocalVodWebPlayback();
      sourceSeconds = controller?.snapshot()?.currentTime ?? null;
    } else {
      sourceSeconds = currentWebPlayerSourceTime();
    }
  } catch (error) {
    elements.streamCutStatus.textContent = errorMessage(error);
    syncCaptureConsoleAvailability();
    return;
  }
  if (sourceSeconds === null) {
    elements.streamCutStatus.textContent =
      activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE
        ? "YouTube 플레이어가 준비되는 중입니다. 영상이 열린 뒤 E/R을 다시 눌러 주세요."
        : "웹 원본 플레이어가 아직 시각을 확정하지 못했습니다. 재생 또는 이동이 끝난 뒤 다시 눌러 주세요.";
    return;
  }
  const row = activeClipRow ?? clipRows().at(-1) ?? addClipRow();
  activeClipRow = row;
  const input = requiredInputWithin(row, `[data-field="${field}"]`);
  input.value = formatStudioTimecode(sourceSeconds);
  row.classList.remove("finalized");
  updateClipRows();
  elements.streamCutStatus.textContent = field === "start"
    ? `시작을 ${formatStudioTimecode(sourceSeconds)}로 기록했습니다.`
    : `끝을 ${formatStudioTimecode(sourceSeconds)}로 기록했습니다.`;
}

async function seekPlayerBy(deltaSeconds: -5 | 5): Promise<void> {
  const youtubeSnapshot = currentYouTubePlayerSnapshot();
  if (youtubeSnapshot && youtubeController) {
    const target = Math.max(
      0,
      Math.min(
        youtubeSnapshot.duration ?? Number.MAX_SAFE_INTEGER,
        youtubeSnapshot.currentTime + deltaSeconds
      )
    );
    youtubeController.seekTo(target);
    elements.streamCutStatus.textContent =
      `YouTube 플레이어를 ${formatStudioTimecode(target)}로 이동했습니다.`;
    window.setTimeout(updatePlayerClockDisplay, 100);
    return;
  }
  if (
    activeStreamPlatform === SOURCE_PLATFORM_CHZZK
    || activeStreamPlatform === SOURCE_PLATFORM_SOOP
  ) {
    try {
      const controller = await ensureLocalVodWebPlayback();
      const snapshot = controller?.snapshot();
      if (!controller || !snapshot) {
        throw new Error("웹 원본 플레이어가 아직 재생 시각을 확정하지 못했습니다.");
      }
      const moved = await controller.seekAbsolute(
        Math.max(0, Math.min(snapshot.duration, snapshot.currentTime + deltaSeconds))
      );
      elements.streamCutStatus.textContent =
        `원본 영상을 ${formatStudioTimecode(moved.currentTime)}로 이동했고 컷 시각도 일치합니다.`;
      updateLocalVodTimeline();
      updatePlayerClockDisplay();
    } catch (error) {
      elements.streamCutStatus.textContent = errorMessage(error);
    }
    syncCaptureConsoleAvailability();
    return;
  }
  const sourceSeconds = currentLocalPreviewSourceTime();
  if (sourceSeconds === null) {
    elements.streamCutStatus.textContent =
      "로컬 미리보기가 준비된 뒤에 영상 위치를 이동할 수 있습니다.";
    return;
  }
  const targetSourceSeconds = Math.max(
    0,
    Math.min(
      localPreviewSourceDurationSeconds || Number.MAX_SAFE_INTEGER,
      sourceSeconds + deltaSeconds
    )
  );
  const targetMediaSeconds = localPreviewMediaSeconds(
    localPreviewSourceStartSeconds,
    targetSourceSeconds
  );
  if (
    targetMediaSeconds < 0
    || !Number.isFinite(elements.streamVideo.duration)
    || targetMediaSeconds > elements.streamVideo.duration
  ) {
    void prepareLocalPreview(targetSourceSeconds);
    return;
  }
  elements.streamVideo.currentTime = targetMediaSeconds;
  updatePlayerClockDisplay();
}

async function setPlayerRate(playbackRate: 0.25 | 2): Promise<void> {
  if (youtubeController?.snapshot) {
    youtubeController.setPlaybackRate(playbackRate);
    elements.playbackRateQuarter.ariaPressed = String(playbackRate === 0.25);
    elements.playbackRateDouble.ariaPressed = String(playbackRate === 2);
    elements.streamCutStatus.textContent =
      `YouTube 재생 속도를 ${playbackRate}배로 바꿨습니다.`;
    return;
  }
  if (
    activeStreamPlatform === SOURCE_PLATFORM_CHZZK
    || activeStreamPlatform === SOURCE_PLATFORM_SOOP
  ) {
    try {
      const controller = await ensureLocalVodWebPlayback();
      if (!controller) {
        throw new Error("웹 원본 플레이어가 아직 준비되지 않았습니다.");
      }
      const snapshot = controller.setPlaybackRate(playbackRate);
      elements.playbackRateQuarter.ariaPressed = String(playbackRate === 0.25);
      elements.playbackRateDouble.ariaPressed = String(playbackRate === 2);
      elements.streamCutStatus.textContent =
        `원본 영상과 컷 시계를 함께 ${snapshot.playbackRate}배속으로 바꿨습니다.`;
    } catch (error) {
      elements.streamCutStatus.textContent = errorMessage(error);
    }
    syncCaptureConsoleAvailability();
    return;
  }
  if (currentLocalPreviewSourceTime() === null) {
    elements.streamCutStatus.textContent =
      "로컬 미리보기가 준비된 뒤에 재생 속도를 바꿀 수 있습니다.";
    return;
  }
  elements.streamVideo.playbackRate = playbackRate;
  elements.playbackRateQuarter.ariaPressed = String(playbackRate === 0.25);
  elements.playbackRateDouble.ariaPressed = String(playbackRate === 2);
  elements.streamCutStatus.textContent = `재생 속도를 ${playbackRate}배로 바꿨습니다.`;
}

function finalizeCurrentDraftRow(): void {
  const row = activeClipRow ?? clipRows().at(-1) ?? addClipRow();
  const start = requiredInputWithin(row, '[data-field="start"]');
  const end = requiredInputWithin(row, '[data-field="end"]');
  const validation = validateStudioSelectionRange(start.value, end.value);
  if (validation.status !== "valid") {
    row.classList.add("invalid");
    elements.streamCutStatus.textContent =
      validation.status === "invalid-order"
        ? STUDIO_SELECTION_RANGE_ORDER_ERROR
        : STUDIO_SELECTION_RANGE_INPUT_ERROR;
    (validation.status === "invalid-order" ? end : start).focus();
    return;
  }
  row.classList.add("finalized");
  row.dataset.finalized = "true";
  addClipRow();
  // Keep global capture shortcuts out of the newly-created text inputs. The
  // next row remains active, while focus returns to a non-editable control so
  // an immediate E/F/R/T sequence is interpreted as shortcuts rather than
  // literal text.
  elements.captureStart.focus({ preventScroll: true });
  elements.streamCutStatus.textContent =
    "구간을 확정하고 다음 빈 구간을 열었습니다.";
}

function runStudioCaptureAction(action: StudioCaptureAction): void {
  switch (action) {
    case "refresh-recovery-sessions":
      if (!openingEditor) {
        void refreshRecentProject();
      }
      return;
    case "capture-start":
      void captureCurrentPlayerTime("start");
      return;
    case "capture-end":
      void captureCurrentPlayerTime("end");
      return;
    case "save-segment":
      finalizeCurrentDraftRow();
      return;
    case "open-editor":
      if (!elements.startEditor.disabled) {
        elements.startEditor.click();
      }
      return;
    case "player-seek-backward-five":
      void seekPlayerBy(-5);
      return;
    case "player-seek-forward-five":
      void seekPlayerBy(5);
      return;
    case "player-rate-quarter":
      void setPlayerRate(0.25);
      return;
    case "player-rate-double":
      void setPlayerRate(2);
      return;
  }
}

function syncCaptureConsoleAvailability(): void {
  let sourceReady = false;
  try {
    sourceReady = Boolean(sourceEmbedDescriptor(
      elements.sourceUrl.value.trim(),
      { studioOrigin: location.origin }
    ));
  } catch {
    sourceReady = false;
  }
  for (const button of [
    elements.captureStart,
    elements.captureEnd,
    elements.seekBackwardFive,
    elements.seekForwardFive,
    elements.playbackRateQuarter,
    elements.playbackRateDouble
  ]) {
    button.disabled = !sourceReady;
  }
  const playbackRate = currentYouTubePlayerSnapshot()?.playbackRate
    ?? localVodPlayback?.snapshot()?.playbackRate
    ?? (currentLocalPreviewSourceTime() === null
      ? null
      : elements.streamVideo.playbackRate);
  elements.playbackRateQuarter.ariaPressed = String(playbackRate === 0.25);
  elements.playbackRateDouble.ariaPressed = String(playbackRate === 2);
  updatePlayerClockDisplay();
}

function installStudioCaptureConsole(): void {
  for (const binding of STUDIO_CAPTURE_SHORTCUT_BINDINGS) {
    if (!binding.targetId) {
      continue;
    }
    const button = document.getElementById(binding.targetId);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`컷 단축키 대상이 없습니다: #${binding.targetId}`);
    }
    button.addEventListener("click", () => runStudioCaptureAction(binding.action));
  }
  document.addEventListener("keydown", (event) => {
    const key = studioCaptureShortcutLetterFromEvent(event);
    const binding = studioCaptureShortcutBinding(key);
    if (!binding) {
      return;
    }
    const button = binding.targetId
      ? document.getElementById(binding.targetId)
      : null;
    if (button instanceof HTMLButtonElement && button.disabled) {
      return;
    }
    if (binding.action === "open-editor" && elements.startEditor.disabled) {
      return;
    }
    event.preventDefault();
    runStudioCaptureAction(binding.action);
  });
  elements.streamVideo.addEventListener("loadedmetadata", syncCaptureConsoleAvailability);
  elements.streamVideo.addEventListener("timeupdate", () => {
    updatePlayerClockDisplay();
    updateLocalVodTimeline();
  });
  elements.streamVideo.addEventListener("seeking", updatePlayerClockDisplay);
  elements.streamVideo.addEventListener("seeked", () => {
    updatePlayerClockDisplay();
    updateLocalVodTimeline();
  });
  elements.streamVideo.addEventListener("ratechange", () => {
    elements.playbackRateQuarter.ariaPressed = String(
      elements.streamVideo.playbackRate === 0.25
    );
    elements.playbackRateDouble.ariaPressed = String(
      elements.streamVideo.playbackRate === 2
    );
  });
  elements.streamPreviewTimeline.addEventListener("pointerdown", () => {
    streamTimelineInteracting = true;
  });
  elements.streamPreviewTimeline.addEventListener("input", () => {
    streamTimelineInteracting = true;
    elements.streamPreviewTarget.textContent = formatStudioTimecode(
      Number(elements.streamPreviewTimeline.value)
    );
  });
  elements.streamPreviewTimeline.addEventListener("change", () => {
    const target = Number(elements.streamPreviewTimeline.value);
    void (async () => {
      try {
        if (localVodPlayback) {
          const snapshot = await localVodPlayback.seekAbsolute(target);
          elements.streamCutStatus.textContent =
            `원본 영상과 컷 시각을 ${formatStudioTimecode(snapshot.currentTime)}로 맞췄습니다.`;
        } else {
          await prepareLocalPreview(target);
        }
      } catch (error) {
        elements.streamCutStatus.textContent = errorMessage(error);
      } finally {
        streamTimelineInteracting = false;
        updateLocalVodTimeline();
        updatePlayerClockDisplay();
      }
    })();
  });
  elements.loadPreviewWindow.addEventListener("click", () => {
    const target = Number(elements.streamPreviewTimeline.value);
    void (async () => {
      try {
        if (localVodPlayback) {
          const snapshot = await localVodPlayback.seekAbsolute(target);
          elements.streamCutStatus.textContent =
            `원본 영상과 컷 시각을 ${formatStudioTimecode(snapshot.currentTime)}로 맞췄습니다.`;
        } else {
          await prepareLocalPreview(target);
        }
      } catch (error) {
        elements.streamCutStatus.textContent = errorMessage(error);
      }
      updateLocalVodTimeline();
      updatePlayerClockDisplay();
    })();
  });
  syncCaptureConsoleAvailability();
}

elements.exportSessionArchive.addEventListener("click", () => {
  void exportCurrentCaptureSessionArchive();
});
elements.addClip.addEventListener("click", () => addClipRow());
elements.importSessionArchive.addEventListener("click", () => {
  elements.sessionArchiveInput.click();
});
elements.sessionArchiveInput.addEventListener("change", () => {
  const [file] = elements.sessionArchiveInput.files || [];
  elements.sessionArchiveInput.value = "";
  if (!file) {
    return;
  }
  elements.importSessionArchive.disabled = true;
  void importSessionArchiveFile(file)
    .catch((error) => {
      setStatus(`백업 파일을 불러오지 못했습니다: ${errorMessage(error)}`, "error");
    })
    .finally(() => {
      elements.importSessionArchive.disabled = false;
    });
});
elements.sourceUrl.addEventListener("input", () => {
  clearResumeMode();
  resetLocalVodWebPlayback();
  resetLocalPreviewSession();
  activeStreamPlatform = "";
  updateSourcePlatform();
  scheduleStreamPreview();
});
elements.projectName.addEventListener("input", () => {
  clearResumeMode();
  void refreshStoredSourceIntent();
});
elements.openSource.addEventListener("click", () => {
  try {
    const descriptor = sourceEmbedDescriptor(elements.sourceUrl.value.trim(), {
      studioOrigin: location.origin
    });
    if (!descriptor) {
      throw new TypeError(
        "라이브·클립이 아닌 CHZZK·YouTube·SOOP의 단일 공개 VOD 주소를 입력해 주세요."
      );
    }
    window.open(descriptor.sourceUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    setStatus(errorMessage(error), "error");
    elements.sourceUrl.focus();
  }
});
elements.localProjectsList.addEventListener("click", (event) => {
  const target = event.target;
  const actionButton = target instanceof Element
    ? target.closest<HTMLButtonElement>("[data-project-action]")
    : null;
  const row = actionButton?.closest<HTMLElement>(".local-project-row");
  const projectId = String(row?.dataset.projectId || "");
  const entry = projectId ? localProjectEntry(projectId) : null;
  if (!actionButton || !entry || localProjectManagerBusy) {
    return;
  }
  if (
    mobileEditorBlocked
    && (
      actionButton.dataset.projectAction === "continue"
      || actionButton.dataset.projectAction === "recover"
    )
  ) {
    explainMobileEditorBlock();
    return;
  }
  switch (actionButton.dataset.projectAction) {
    case "continue":
      showResumePolicy(entry.project);
      return;
    case "recover":
      if (entry.draftCount > 0) {
        showResumePolicy(entry.project, { recoveryDrafts: true });
      }
      return;
    case "delete":
      openLocalProjectDeleteDialog({ mode: "single", projectId });
      return;
    default:
      return;
  }
});
elements.refreshLocalProjects.addEventListener("click", () => {
  if (!openingEditor) {
    observeLocalProjectLifecycleCleanup(
      queueMandatoryLocalProjectLifecycleCleanup({ announce: true })
    );
  }
});
elements.retryLocalProjects.addEventListener("click", () => {
  if (!openingEditor) {
    observeLocalProjectLifecycleCleanup(
      queueMandatoryLocalProjectLifecycleCleanup({ announce: true })
    );
  }
});
elements.clearAllLocalProjects.addEventListener("click", () => {
  if (localProjectEntries.length > 0 && !localProjectManagerBusy) {
    openLocalProjectDeleteDialog({ mode: "all" });
  }
});
elements.cancelLocalProjectDelete.addEventListener("click", () => {
  closeLocalProjectDeleteDialog();
});
elements.confirmLocalProjectDelete.addEventListener("click", () => {
  void confirmLocalProjectDeletion();
});
elements.localProjectDeleteDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (!localProjectManagerBusy) {
    closeLocalProjectDeleteDialog();
  }
});
elements.reloadStream.addEventListener("click", () => {
  reloadActivePlayerFrame();
});
function installStreamFrameLoadHandler(frame: HTMLIFrameElement): void {
  frame.addEventListener("load", () => {
    if (
      frame !== elements.streamFrame
      || !activeStreamEmbedUrl
      || frame.src !== activeStreamEmbedUrl
    ) {
      return;
    }
    if (streamLoadTimer !== null) {
      window.clearTimeout(streamLoadTimer);
      streamLoadTimer = null;
    }
    // A cross-origin iframe can finish loading after a local preview replaced
    // it with the helper-backed local video. Its late load event must not
    // overwrite the connected status or make the active shortcut path look
    // unavailable again.
    if (!elements.streamVideo.hidden && localVodPlayback) {
      return;
    }
    elements.streamStatus.textContent =
      "플랫폼 원본 미리보기를 브라우저에 직접 불러왔습니다.";
    if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
      connectYouTubeEmbedController(frame);
    } else {
      elements.streamCutStatus.textContent =
        "CHZZK·SOOP 원본을 이 웹 플레이어에 연결하고 있습니다…";
    }
  });
}
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (mobileEditorBlocked) {
    explainMobileEditorBlock();
    return;
  }
  if (openingEditor) {
    return;
  }
  const invalidRow = firstKnownInvalidClipRow();
  if (invalidRow) {
    const message = String(
      invalidRow.querySelector<HTMLElement>(".coverage")?.textContent
      || STUDIO_SELECTION_RANGE_INPUT_ERROR
    );
    setStatus(message, "error");
    invalidRow.querySelector<HTMLInputElement>('[aria-invalid="true"]')
      ?.focus();
    return;
  }
  void (async () => {
    openingEditor = true;
    elements.startEditor.disabled = true;
    if (localProjectLifecycleRefreshTimer !== null) {
      window.clearTimeout(localProjectLifecycleRefreshTimer);
      localProjectLifecycleRefreshTimer = null;
    }
    try {
      // Never race a fresh A→B navigation against startup/focus rollback of a
      // checkpoint left by a crashed or closed editor document.
      await requireSafeLocalProjectStateForEditorEntry();
      let target: UsagePolicyTarget;
      let captureSeed: CaptureState | undefined;
      if (resumeProject) {
        target = {
          projectId: resumeProject.id,
          sourceSessionId: resumeSourceSessionId(resumeProject),
          purpose: resumeRecoveryDrafts ? "editor-recovery" : "editor-resume"
        };
      } else {
        captureSeed = currentCaptureState();
        const projectId = localPreviewProjectId;
        const sourceSessionId = sourceSessionIdentity(captureSeed.source);
        if (!sourceSessionId) {
          throw new TypeError("원본 VOD 회차를 식별하지 못했습니다.");
        }
        target = { projectId, sourceSessionId, purpose: "editor-new" };
      }
      const attestation = createAttestation(target);
      if (captureSeed !== undefined) {
        setStatus(
          "도우미가 선택한 구간만 준비합니다. 이 페이지에서 진행 상황을 확인할 수 있습니다.",
          "success"
        );
        await prepareSelectedVodForEditor(target.projectId, captureSeed);
      }
      setStatus("같은 브라우저에서 편집기를 여는 중입니다…", "success");
      const session = await beginWebEditorSession({
        attestation,
        ...(captureSeed === undefined ? {} : { captureSeed })
      });
      location.assign(session.editorUrl);
    } catch (error) {
      setStatus(errorMessage(error), "error");
      if (!elements.cutPreparationProgress.hidden) {
        showCutPreparationFailure(error);
      }
      if (!allAcknowledgementsChecked()) {
        focusFirstMissingAcknowledgement();
      }
      openingEditor = false;
      renderEditorEntryAvailability();
    }
  })();
});

elements.cutPreparationRetry.addEventListener("click", () => {
  elements.cutPreparationRecovery.hidden = true;
  elements.startEditor.click();
});
elements.cutPreparationDownload.addEventListener("click", () => {
  const download = !elements.archHelperDownload.hidden
    ? elements.archHelperDownload
    : elements.helperDownload;
  download.click();
});
elements.cutPreparationManual.addEventListener("click", () => {
  forceManualFileForNextPreparation = true;
  elements.cutPreparationRecovery.hidden = true;
  elements.startEditor.click();
});

window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, () => {
  renderLocalProjectEntries();
  renderLocalProjectManagerState(localProjectManagerRenderState);
});

renderMobileEditorAccess();
void configureHelperDownload().catch(() => {
  elements.helperDownload.hidden = true;
  elements.helperDownload.removeAttribute("href");
  elements.archHelperDownload.hidden = true;
  elements.archHelperDownload.removeAttribute("href");
});
addClipRow();
installStudioCaptureConsole();
installStreamFrameLoadHandler(elements.streamFrame);
prefillSourceFromLocation();
updateStreamPreview();
window.addEventListener("focus", scheduleLocalProjectLifecycleRefresh);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    // A same-tab editor navigation can leave this start document in bfcache
    // with its pre-navigation `openingEditor` flag. On return, it is a live
    // start page again and must be allowed to reconcile the abandoned writer.
    openingEditor = false;
    renderMobileEditorAccess();
    clearCurrentTabWebEditorSession();
    requestAutomaticLocalProjectLifecycleCleanup();
    return;
  }
  scheduleLocalProjectLifecycleRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    scheduleLocalProjectLifecycleRefresh();
  }
});
clearCurrentTabWebEditorSession();
const initialLocalProjectCleanup = localProjectLifecycleCleanupQueue.enqueue(async () => {
  try {
    await reconcileAbandonedProjectsBeforeEditorEntry();
  } finally {
    // A failed startup inventory must leave the visible Retry control usable;
    // it must not silently authorize editor entry.
    localProjectManagerInitialized = true;
  }
});
observeLocalProjectLifecycleCleanup(initialLocalProjectCleanup);
}

// The public HTTPS deployment is the application, not a launcher for a
// second editor window.  The optional OS install supplies only the local VOD
// acquisition engine; every editing surface remains in this browser page.
void activeStudioOrigin;
startLocalApplication();
