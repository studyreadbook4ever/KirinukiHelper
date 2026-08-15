import {
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
  normalizeSoopVodSourceClockIdentity,
  sameSoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";
import type {
  SoopVodSourceClockIdentity
} from "../lib/soop-vod-source-clock.js";
import {
  StaleSerialOperationGenerationError,
  createGenerationBoundSerialOperationQueue,
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
  assertKirinukiStudioDocumentOrigin,
  isKirinukiLocalStudioOrigin,
  isKirinukiPublicStudioOrigin
} from "../lib/local-runtime-origin.js";
import {
  currentClientCannotUseEditor
} from "../lib/editor-mobile-access.js";

import {
  deleteAllProjectSessionsAtomically,
  discardAbandonedEditingSessionCheckpoint,
  deleteProjectSessionAtomically,
  listEditingSessionCheckpointProjectIds,
  listLocalDrafts,
  listProjects
} from "../editor/project-store.js";
import {
  importCurrentOriginStorageMigration
} from "../editor/origin-storage-migration.js";
import {
  ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES
} from "../lib/origin-storage-migration.js";
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
import type {
  StudioCaptureAction
} from "./studio-capture-console.js";
import {
  StreamingBridgeClient,
  StreamingBridgeRequestError,
  createStreamingBridgeWindowTransport
} from "./streaming-bridge-client.js";
import type {
  StreamingBridgePlayerSnapshot,
  StreamingBridgeShortcutMessage,
  StreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";
import {
  createStreamingBridgeSourceIdentity,
  sameStreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";
import {
  loadYouTubeIframeApi,
  readYouTubePlayerSnapshot
} from "./youtube-iframe-api.js";
import type {
  YouTubeIframePlayer,
  YouTubeIframePlayerEvent
} from "./youtube-iframe-api.js";
import {
  sessionArchiveCaptureFromJson
} from "./session-archive-capture.js";
import {
  formatStudioTimecode,
  parseStudioTimecode
} from "./studio-timecode.js";

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

function startPublicLaunchShell(): void {
  setDocumentSurface("public");
  const launchLink = requiredElement<HTMLAnchorElement>(
    "#launch-kirinuki-app"
  );
  const guide = requiredElement<HTMLElement>("#public-launch-guide");
  launchLink.addEventListener("click", () => {
    guide.hidden = false;
  });
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
  sourceUrl: requiredElement<HTMLInputElement>("#source-url"),
  sourcePlatform: requiredElement<HTMLElement>("#source-platform"),
  openSource: requiredElement<HTMLButtonElement>("#open-source"),
  importSessionArchive: requiredElement<HTMLButtonElement>(
    "#import-session-archive"
  ),
  sessionArchiveInput: requiredElement<HTMLInputElement>(
    "#session-archive-input"
  ),
  projectName: requiredElement<HTMLInputElement>("#project-name"),
  streamFrame: requiredElement<HTMLIFrameElement>("#stream-preview-frame"),
  streamPlaceholder: requiredElement<HTMLElement>("#stream-preview-placeholder"),
  streamKind: requiredElement<HTMLElement>("#stream-preview-kind"),
  streamStatus: requiredElement<HTMLElement>("#stream-preview-status"),
  reloadStream: requiredElement<HTMLButtonElement>("#reload-stream"),
  streamCurrentTime: requiredElement<HTMLOutputElement>("#stream-current-time"),
  streamCutConsole: requiredElement<HTMLElement>("#stream-cut-console"),
  streamCutStatus: requiredElement<HTMLElement>("#stream-cut-console-status"),
  activeClipLabel: requiredElement<HTMLElement>("#active-clip-label"),
  clipList: requiredElement<HTMLElement>("#clip-list"),
  selectionRail: requiredElement<HTMLElement>(".selection-rail"),
  clipTemplate: requiredElement<HTMLTemplateElement>("#clip-row-template"),
  addClip: requiredElement<HTMLButtonElement>("#add-clip"),
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
  startEditor: requiredElement<HTMLButtonElement>("#start-editor")
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
const localProjectLifecycleCleanupQueue = createLatestSerialOperationQueue();
let localProjectLifecycleRefreshTimer: number | null = null;
let openingEditor = false;
const mobileEditorBlocked = currentClientCannotUseEditor();
let streamPreviewTimer: number | null = null;
let activeStreamEmbedUrl = "";
let activeStreamPlatform = "";
let streamLoadTimer: number | null = null;
let youtubePlayerReady = false;
let youtubePlayer: YouTubeIframePlayer | null = null;
let youtubePlayerGeneration = 0;
let youtubeConnectGeneration: number | null = null;
let activeClipRow: HTMLElement | null = null;

function explainMobileEditorBlock(): void {
  const message = "편집기는 모바일에서 사용할 수 없습니다. PC 브라우저에서 열어 주세요.";
  setStatus(message, "error");
  elements.mobileEditorNotice.hidden = false;
  elements.mobileEditorNotice.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderMobileEditorAccess(): void {
  document.body.dataset.mobileEditorBlocked = String(mobileEditorBlocked);
  elements.mobileEditorNotice.hidden = !mobileEditorBlocked;
  elements.startEditor.disabled = mobileEditorBlocked || openingEditor;
  elements.startEditor.title = mobileEditorBlocked
    ? "편집기는 모바일에서 사용할 수 없습니다"
    : "권리 확인 후 편집기 열기 (단축키 A)";
}
let streamingBridgeClient: StreamingBridgeClient | null = null;
let latestStreamingSnapshot: StreamingBridgePlayerSnapshot | null = null;
let boundSoopSourceClockIdentity: SoopVodSourceClockIdentity | null = null;
let streamingBridgeTargetOrigin = "";
let streamingBridgeGeneration = 0;
let streamingBridgeClockPollingEnabled = false;
let streamingBridgeConsecutiveClockFailures = 0;
let streamingBridgeClockPollInFlight: {
  readonly client: StreamingBridgeClient;
  readonly generation: number;
} | null = null;
let streamingBridgeShortcutUnsubscribe: (() => void) | null = null;
let streamCutBackgroundStatusTimer: number | null = null;
let streamCutForegroundStatusUntil = 0;
const sourceClockOperationQueue = createGenerationBoundSerialOperationQueue();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(message: string, kind: "idle" | "error" | "success" = "idle"): void {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", kind === "error");
  elements.status.classList.toggle("success", kind === "success");
}

function setStreamCutStatus(message: string): void {
  streamCutForegroundStatusUntil = performance.now() + 750;
  if (streamCutBackgroundStatusTimer !== null) {
    window.clearTimeout(streamCutBackgroundStatusTimer);
    streamCutBackgroundStatusTimer = null;
  }
  elements.streamCutStatus.textContent = message;
}

function setStreamCutBackgroundStatus(message: string): void {
  if (streamCutBackgroundStatusTimer !== null) {
    window.clearTimeout(streamCutBackgroundStatusTimer);
    streamCutBackgroundStatusTimer = null;
  }
  const remaining = streamCutForegroundStatusUntil - performance.now();
  if (remaining <= 0) {
    elements.streamCutStatus.textContent = message;
    return;
  }
  streamCutBackgroundStatusTimer = window.setTimeout(() => {
    streamCutBackgroundStatusTimer = null;
    elements.streamCutStatus.textContent = message;
  }, Math.ceil(remaining));
}

function captureConsoleButton(targetId: string): HTMLButtonElement {
  return requiredElement<HTMLButtonElement>(`#${targetId}`);
}

function resetYouTubeIframePlayer({
  replaceFrame = false
}: {
  replaceFrame?: boolean;
} = {}): void {
  youtubePlayerGeneration += 1;
  youtubeConnectGeneration = null;
  youtubePlayerReady = false;
  if (replaceFrame) {
    const oldFrame = elements.streamFrame;
    const replacement = oldFrame.cloneNode(false) as HTMLIFrameElement;
    replacement.removeAttribute("src");
    replacement.hidden = true;
    const player = youtubePlayer;
    youtubePlayer = null;
    if (player) {
      try {
        player.destroy();
      } catch {
        // The cross-origin player may already have navigated away.
      }
    }
    if (oldFrame.isConnected) {
      oldFrame.replaceWith(replacement);
    } else {
      elements.streamPlaceholder.before(replacement);
    }
    elements.streamFrame = replacement;
    installStreamFrameLoadHandler(replacement);
  }
  updateCaptureConsoleAvailability();
}

function currentYouTubePlayerSnapshot() {
  return youtubePlayerReady && youtubePlayer
    ? readYouTubePlayerSnapshot(youtubePlayer)
    : null;
}

function currentYouTubePlayerTime(): number | null {
  return currentYouTubePlayerSnapshot()?.currentTime ?? null;
}

async function waitForYouTubePlayerState(
  player: YouTubeIframePlayer,
  generation: number,
  predicate: (
    snapshot: NonNullable<ReturnType<typeof readYouTubePlayerSnapshot>>
  ) => boolean,
  failureMessage: string,
  timeoutMs = 1_200
): Promise<NonNullable<ReturnType<typeof readYouTubePlayerSnapshot>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (
      generation !== youtubePlayerGeneration
      || player !== youtubePlayer
      || !youtubePlayerReady
    ) {
      throw new DOMException(
        "원본 변경으로 오래된 YouTube 제어를 중단했습니다.",
        "AbortError"
      );
    }
    const snapshot = readYouTubePlayerSnapshot(player);
    if (snapshot && predicate(snapshot)) {
      return snapshot;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(failureMessage);
}

function currentStreamingSourceIdentity(): StreamingBridgeSourceIdentity | null {
  const identifiers = inferSourceIdentifiers(elements.sourceUrl.value.trim());
  if (
    (identifiers.platform !== SOURCE_PLATFORM_CHZZK
      && identifiers.platform !== SOURCE_PLATFORM_SOOP
      && identifiers.platform !== SOURCE_PLATFORM_YOUTUBE)
    || identifiers.contentType !== "vod"
    || !identifiers.contentId
  ) {
    return null;
  }
  return createStreamingBridgeSourceIdentity({
    platform: identifiers.platform,
    contentId: identifiers.contentId,
    contentType: "vod"
  });
}

function resetStreamingBridge(): void {
  sourceClockOperationQueue.advanceGeneration();
  streamingBridgeGeneration += 1;
  streamingBridgeShortcutUnsubscribe?.();
  streamingBridgeShortcutUnsubscribe = null;
  streamingBridgeClient?.destroy();
  streamingBridgeClient = null;
  streamingBridgeTargetOrigin = "";
  latestStreamingSnapshot = null;
  boundSoopSourceClockIdentity = null;
  streamingBridgeClockPollingEnabled = false;
  streamingBridgeConsecutiveClockFailures = 0;
  streamingBridgeClockPollInFlight = null;
}

function transientStreamingPlayerStateError(error: unknown): boolean {
  return error instanceof StreamingBridgeRequestError
    && [
      "action-failed",
      "player-unavailable",
      "player-state-transient",
      "source-unavailable"
    ].includes(error.code);
}

function recoverableStreamingClockError(error: unknown): boolean {
  return error instanceof StreamingBridgeRequestError
    && [
      "action-failed",
      "player-unavailable",
      "player-state-transient",
      "source-unavailable",
      "timeout",
      "send-failed"
    ].includes(error.code);
}

function acceptStreamingBridgeSnapshot(
  snapshot: StreamingBridgePlayerSnapshot
): void {
  if (activeStreamPlatform === SOURCE_PLATFORM_SOOP) {
    const identity = normalizeSoopVodSourceClockIdentity(
      snapshot.sourceClockIdentity
    );
    if (
      !snapshot.found
      || snapshot.currentTime === null
      || !identity
      || snapshot.sourceClockPosition?.globalTimeSeconds
        !== snapshot.currentTime
    ) {
      latestStreamingSnapshot = null;
      throw new StreamingBridgeRequestError(
        "player-state-transient",
        "SOOP 공식 VOD part 시계 증명을 확인하지 못했습니다."
      );
    }
    if (
      boundSoopSourceClockIdentity
      && !sameSoopVodSourceClockIdentity(
        boundSoopSourceClockIdentity,
        identity
      )
    ) {
      latestStreamingSnapshot = null;
      streamingBridgeClockPollingEnabled = false;
      throw new StreamingBridgeRequestError(
        "source-mismatch",
        "SOOP VOD의 공식 part 구성이 바뀌어 현재 컷 시계를 안전하게 유지할 수 없습니다. W로 플레이어를 다시 불러와 주세요."
      );
    }
    boundSoopSourceClockIdentity = identity;
  }
  if (snapshot.found && snapshot.currentTime !== null) {
    latestStreamingSnapshot = snapshot;
    streamingBridgeConsecutiveClockFailures = 0;
    streamingBridgeClockPollingEnabled = true;
  }
}

async function runTransientSafeStreamingAction(
  client: StreamingBridgeClient,
  operation: () => Promise<StreamingBridgePlayerSnapshot>
): Promise<StreamingBridgePlayerSnapshot> {
  const generation = streamingBridgeGeneration;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (
      client !== streamingBridgeClient
      || generation !== streamingBridgeGeneration
    ) {
      throw new DOMException(
        "원본 변경으로 오래된 스트리밍 제어를 중단했습니다.",
        "AbortError"
      );
    }
    try {
      const snapshot = await operation();
      if (!snapshot.found || snapshot.currentTime === null) {
        lastError = new StreamingBridgeRequestError(
          "player-unavailable",
          "플랫폼 플레이어의 원본 시각을 잠시 읽지 못했습니다."
        );
        if (attempt >= 5) {
          throw lastError;
        }
        setStreamCutStatus(
          "플랫폼 플레이어 전환을 감지했습니다. 현재 스트리밍에서 제어를 자동으로 다시 시도합니다…"
        );
        await waitForBridgeProbe(75 * Math.min(attempt + 1, 3));
        continue;
      }
      acceptStreamingBridgeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      lastError = error;
      if (!transientStreamingPlayerStateError(error) || attempt >= 5) {
        throw error;
      }
      setStreamCutStatus(
        "플랫폼 플레이어 전환을 감지했습니다. 현재 스트리밍에서 제어를 자동으로 다시 시도합니다…"
      );
      await waitForBridgeProbe(75 * Math.min(attempt + 1, 3));
    }
  }
  throw lastError;
}

function syncStreamingBridgeSource(): void {
  const source = currentStreamingSourceIdentity();
  const targetOrigin = activeStreamEmbedUrl
    ? new URL(activeStreamEmbedUrl).origin
    : "";
  if (!source || !targetOrigin) {
    resetStreamingBridge();
    return;
  }
  if (
    streamingBridgeClient
    && streamingBridgeTargetOrigin === targetOrigin
  ) {
    if (!sameStreamingBridgeSourceIdentity(
      streamingBridgeClient.source,
      source
    )) {
      streamingBridgeClient.replaceSource(source);
      latestStreamingSnapshot = null;
      boundSoopSourceClockIdentity = null;
    }
    return;
  }
  resetStreamingBridge();
  const transport = createStreamingBridgeWindowTransport({
    targetOrigin,
    targetWindow: () => elements.streamFrame.contentWindow
  });
  streamingBridgeClient = new StreamingBridgeClient({
    source,
    ...transport,
    requestTimeoutMs: 900,
    // Cross-origin players can briefly stall while switching media parts.
    // Exact request IDs make a third delivery idempotent while avoiding a
    // false user-facing failure after only 1.8 seconds.
    maxDeliveryAttempts: 3
  });
  const client = streamingBridgeClient;
  streamingBridgeShortcutUnsubscribe = client.subscribeShortcuts(
    (message: StreamingBridgeShortcutMessage) => {
      if (
        client !== streamingBridgeClient
        || message.generation !== client.generation
        || !sameStreamingBridgeSourceIdentity(message.source, client.source)
      ) {
        return;
      }
      const binding = studioCaptureShortcutBinding(message.key);
      if (!binding) {
        return;
      }
      if (binding.targetId) {
        const button = captureConsoleButton(binding.targetId);
        if (!button.disabled) {
          button.click();
        }
        return;
      }
      if (binding.action !== "open-editor" || !elements.startEditor.disabled) {
        runStudioCaptureAction(binding.action);
      }
    }
  );
  streamingBridgeTargetOrigin = targetOrigin;
  latestStreamingSnapshot = null;
  boundSoopSourceClockIdentity = null;
}

function waitForBridgeProbe(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function connectStreamingBridge(
  frame: HTMLIFrameElement,
  expectedEmbedUrl: string
): Promise<void> {
  syncStreamingBridgeSource();
  const client = streamingBridgeClient;
  const generation = streamingBridgeGeneration;
  if (!client) {
    return;
  }
  for (let attempt = 0; attempt < 48; attempt += 1) {
    if (
      client !== streamingBridgeClient
      || generation !== streamingBridgeGeneration
      || frame !== elements.streamFrame
      || activeStreamEmbedUrl !== expectedEmbedUrl
    ) {
      return;
    }
    try {
      const snapshot = await client.snapshot();
      if (
        client !== streamingBridgeClient
        || generation !== streamingBridgeGeneration
      ) {
        return;
      }
      acceptStreamingBridgeSnapshot(snapshot);
      updateCaptureConsoleAvailability();
      if (snapshot.found && snapshot.currentTime !== null) {
        setStreamCutBackgroundStatus(
          "원본 스트리밍 연결 완료 · E/R 캡처와 D/F/Y/U 제어를 사용할 수 있습니다."
        );
        return;
      }
      setStreamCutBackgroundStatus(
        "플랫폼 문서는 연결됐고 영상 요소를 기다리는 중입니다. 플레이어에서 재생을 한 번 눌러 주세요."
      );
    } catch (error) {
      if (
        client !== streamingBridgeClient
        || generation !== streamingBridgeGeneration
      ) {
        return;
      }
      if (transientStreamingPlayerStateError(error)) {
        updateCaptureConsoleAvailability();
        setStreamCutBackgroundStatus(
          "플랫폼 플레이어가 전환되는 중입니다. 같은 원본 스트리밍에서 자동으로 다시 연결합니다…"
        );
        await waitForBridgeProbe(250);
        continue;
      }
      setStreamCutBackgroundStatus(
        `Kirinuki의 원본 플레이어 연결부가 현재 버전과 맞지 않습니다: ${errorMessage(error)} 앱을 완전히 종료한 뒤 다시 열어 주세요.`
      );
      updateCaptureConsoleAvailability();
      return;
    }
    await waitForBridgeProbe(250);
  }
  setStreamCutBackgroundStatus(
    "플레이어 제어는 준비됐지만 재생 가능한 영상을 찾지 못했습니다. W로 연결을 다시 확인해 주세요."
  );
}

async function connectStreamingShortcutBridge(
  frame: HTMLIFrameElement,
  expectedEmbedUrl: string
): Promise<void> {
  syncStreamingBridgeSource();
  const client = streamingBridgeClient;
  const generation = streamingBridgeGeneration;
  if (!client || activeStreamPlatform !== SOURCE_PLATFORM_YOUTUBE) {
    return;
  }
  try {
    // A snapshot is only a same-source handshake here. YouTube playback stays
    // exclusively on the official IFrame API; the app-owned bridge forwards keys.
    await client.snapshot();
    if (
      client !== streamingBridgeClient
      || generation !== streamingBridgeGeneration
      || frame !== elements.streamFrame
      || activeStreamEmbedUrl !== expectedEmbedUrl
    ) {
      return;
    }
    elements.streamStatus.textContent =
      "YouTube 플레이어와 단축키를 연결했습니다.";
  } catch (error) {
    if (
      client !== streamingBridgeClient
      || generation !== streamingBridgeGeneration
      || frame !== elements.streamFrame
      || activeStreamEmbedUrl !== expectedEmbedUrl
    ) {
      return;
    }
    elements.streamStatus.textContent =
      `YouTube 영상은 열렸지만 Kirinuki의 원본 플레이어 연결부가 단축키에 응답하지 않습니다: ${errorMessage(error)}`;
  }
}

async function pollStreamingBridgeClock(): Promise<void> {
  const client = streamingBridgeClient;
  if (
    activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE
    || !client
    || !streamingBridgeClockPollingEnabled
    || streamingBridgeClockPollInFlight
  ) {
    return;
  }
  const generation = streamingBridgeGeneration;
  const pollToken = { client, generation };
  streamingBridgeClockPollInFlight = pollToken;
  try {
    const snapshot = await client.snapshot();
    if (
      client === streamingBridgeClient
      && generation === streamingBridgeGeneration
    ) {
      const recovered = streamingBridgeConsecutiveClockFailures > 0;
      acceptStreamingBridgeSnapshot(snapshot);
      updateCaptureConsoleAvailability();
      if (snapshot.found && snapshot.currentTime !== null) {
        if (recovered) {
          setStreamCutBackgroundStatus(
            "원본 스트리밍 시각 동기화를 자동으로 복구했습니다. E/R 캡처와 D/F/Y/U 제어를 사용할 수 있습니다."
          );
        }
      } else {
        setStreamCutBackgroundStatus(
          "플랫폼 플레이어가 전환되는 중입니다. 같은 원본 스트리밍에서 자동으로 다시 연결합니다…"
        );
      }
    }
  } catch (error) {
    if (
      client === streamingBridgeClient
      && generation === streamingBridgeGeneration
      && !(error instanceof DOMException && error.name === "AbortError")
    ) {
      streamingBridgeConsecutiveClockFailures += 1;
      const recoverable = recoverableStreamingClockError(error);
      if (!recoverable) {
        latestStreamingSnapshot = null;
        streamingBridgeClockPollingEnabled = false;
      }
      updateCaptureConsoleAvailability();
      setStreamCutBackgroundStatus(recoverable
        ? "플랫폼 플레이어의 일시 전환을 감지했습니다. 화면을 유지한 채 자동으로 다시 연결합니다…"
        : `원본 스트리밍 확인이 중단됐습니다: ${errorMessage(error)} W로 현재 플레이어를 다시 확인해 주세요.`);
    }
  } finally {
    if (streamingBridgeClockPollInFlight === pollToken) {
      streamingBridgeClockPollInFlight = null;
    }
  }
}

function streamingBridgeReady(): boolean {
  return Boolean(
    activeStreamPlatform !== SOURCE_PLATFORM_YOUTUBE
    &&
    streamingBridgeClient
    && latestStreamingSnapshot?.found
    && latestStreamingSnapshot.currentTime !== null
  );
}

function currentControllablePlayerTime(): number | null {
  if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
    return currentYouTubePlayerTime();
  }
  return streamingBridgeReady()
    ? latestStreamingSnapshot?.currentTime ?? null
    : null;
}

function updatePlayerClockDisplay(): void {
  const currentTime = currentControllablePlayerTime();
  elements.streamCurrentTime.value = currentTime === null
    ? "--:--:--"
    : formatStudioTimecode(currentTime);
}

function updateCaptureConsoleAvailability(): void {
  const isYouTube = activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE;
  const bridgeReady = streamingBridgeReady();
  const hasCurrentTime = currentControllablePlayerTime() !== null;
  const hasControllablePlayer = (
    (isYouTube && youtubePlayerReady)
    || bridgeReady
  );
  elements.streamCutConsole.setAttribute(
    "aria-busy",
    String(sourceClockOperationQueue.pendingCount > 0)
  );
  captureConsoleButton("refresh-source").disabled = !activeStreamEmbedUrl;
  for (const targetId of [
    "capture-start",
    "capture-end",
    "seek-backward-five",
    "seek-forward-five"
  ]) {
    captureConsoleButton(targetId).disabled = !hasControllablePlayer
      || !hasCurrentTime;
  }
  for (const targetId of [
    "playback-rate-quarter",
    "playback-rate-double"
  ]) {
    captureConsoleButton(targetId).disabled = !hasControllablePlayer;
  }
  const playbackRate = isYouTube
    ? currentYouTubePlayerSnapshot()?.playbackRate ?? null
    : latestStreamingSnapshot?.playbackRate ?? null;
  captureConsoleButton("playback-rate-quarter").setAttribute(
    "aria-pressed",
    String(playbackRate === 0.25)
  );
  captureConsoleButton("playback-rate-double").setAttribute(
    "aria-pressed",
    String(playbackRate === 2)
  );
  updatePlayerClockDisplay();
}

function applyYouTubeReady(
  event: YouTubeIframePlayerEvent,
  generation: number,
  frame: HTMLIFrameElement
): void {
  if (
    generation !== youtubePlayerGeneration
    || frame !== elements.streamFrame
    || activeStreamPlatform !== SOURCE_PLATFORM_YOUTUBE
  ) {
    try {
      event.target.destroy();
    } catch {
      // A stale player can already be detached.
    }
    return;
  }
  youtubePlayer = event.target;
  youtubePlayerReady = true;
  updateCaptureConsoleAvailability();
  setStreamCutStatus(currentYouTubePlayerTime() === null
    ? "YouTube 공식 플레이어 연결 완료 · 현재 시각을 기다리는 중입니다."
    : "YouTube 공식 플레이어 연결 완료 · E/R 캡처와 D/F/Y/U 제어를 사용할 수 있습니다.");
}

async function connectYouTubeIframePlayer(
  frame: HTMLIFrameElement,
  generation: number
): Promise<void> {
  if (youtubeConnectGeneration === generation) {
    return;
  }
  youtubeConnectGeneration = generation;
  try {
    const api = await loadYouTubeIframeApi();
    if (
      generation !== youtubePlayerGeneration
      || frame !== elements.streamFrame
      || activeStreamPlatform !== SOURCE_PLATFORM_YOUTUBE
    ) {
      return;
    }
    youtubePlayer = new api.Player(frame, {
      events: {
        onReady: (event) => applyYouTubeReady(event, generation, frame),
        onStateChange: () => updateCaptureConsoleAvailability(),
        onPlaybackRateChange: () => updateCaptureConsoleAvailability(),
        onError: () => {
          if (generation !== youtubePlayerGeneration) {
            return;
          }
          youtubePlayerReady = false;
          updateCaptureConsoleAvailability();
          setStreamCutStatus(
            "이 YouTube 영상의 공식 임베드를 재생하지 못했습니다. 원본 공개·임베드 허용 상태를 확인해 주세요."
          );
        }
      }
    });
  } catch (error) {
    if (generation !== youtubePlayerGeneration) {
      return;
    }
    youtubeConnectGeneration = null;
    youtubePlayerReady = false;
    updateCaptureConsoleAvailability();
    setStreamCutStatus(`YouTube 공식 플레이어 연결 실패: ${errorMessage(error)}`);
  }
}

function explainUnavailablePlayerControl(): void {
  if (!activeStreamEmbedUrl) {
    setStreamCutStatus("먼저 지원되는 VOD 주소를 입력해 주세요.");
    elements.sourceUrl.focus();
    return;
  }
  if (
    activeStreamPlatform === SOURCE_PLATFORM_CHZZK
    || activeStreamPlatform === SOURCE_PLATFORM_SOOP
  ) {
    setStreamCutStatus(
      "플레이어 제어가 아직 응답하지 않습니다. W로 연결을 다시 확인해 주세요."
    );
    return;
  }
  if (activeStreamPlatform !== SOURCE_PLATFORM_YOUTUBE) {
    setStreamCutStatus("지원되는 공개 VOD 주소를 다시 확인해 주세요.");
    return;
  }
  setStreamCutStatus(
    "YouTube 플레이어가 아직 준비되지 않았습니다. 영상을 재생한 뒤 W로 연결을 다시 확인해 주세요."
  );
}

function clipRows(): HTMLElement[] {
  return [...elements.clipList.querySelectorAll<HTMLElement>(".clip-row")];
}

function updateClipRows(): void {
  const rows = clipRows();
  rows.forEach((row, index) => {
    const indexLabel = row.querySelector<HTMLElement>(".clip-index");
    const remove = row.querySelector<HTMLButtonElement>('[data-action="remove"]');
    const start = row.querySelector<HTMLInputElement>('[data-field="start"]');
    const end = row.querySelector<HTMLInputElement>('[data-field="end"]');
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
    const startSeconds = parseStudioTimecode(start?.value);
    const endSeconds = parseStudioTimecode(end?.value);
    const valid = startSeconds !== null
      && endSeconds !== null
      && endSeconds - startSeconds >= MINIMUM_SELECTION_SECONDS;
    row.classList.toggle("invalid", Boolean(
      (start?.value || end?.value) && !valid
    ));
    if (coverage) {
      coverage.textContent = valid
        ? `편집기에서 준비할 범위 ${formatStudioTimecode(Math.max(0, startSeconds - HANDLE_SECONDS))} ~ ${formatStudioTimecode(endSeconds + HANDLE_SECONDS)} (앞뒤 10초 포함)`
        : "시작과 끝을 기록하면 편집기에서 준비할 범위를 보여드립니다.";
    }
  });
  const activeIndex = activeClipRow ? rows.indexOf(activeClipRow) : -1;
  elements.activeClipLabel.textContent = activeIndex >= 0
    ? `현재 입력 #${String(activeIndex + 1).padStart(2, "0")}`
    : "현재 입력 없음";
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
  let sourceClockIdentity: SoopVodSourceClockIdentity | undefined;
  if (identifiers.platform === SOURCE_PLATFORM_SOOP) {
    const latestIdentity = normalizeSoopVodSourceClockIdentity(
      latestStreamingSnapshot?.sourceClockIdentity
    );
    if (
      !latestStreamingSnapshot?.found
      || latestStreamingSnapshot.currentTime === null
      || !latestIdentity
      || !boundSoopSourceClockIdentity
      || !sameSoopVodSourceClockIdentity(
        boundSoopSourceClockIdentity,
        latestIdentity
      )
      || latestIdentity.contentId !== identifiers.contentId
    ) {
      throw new TypeError(
        "SOOP 공식 VOD part 시계를 먼저 확인해야 합니다. 플레이어가 열린 뒤 W를 누르고 다시 시도해 주세요."
      );
    }
    sourceClockIdentity = latestIdentity;
  }
  return {
    platform: identifiers.platform,
    channelId: identifiers.channelId,
    contentId: identifiers.contentId,
    contentType: "vod",
    canonicalUrl,
    url: canonicalUrl,
    broadcastTitle: projectName || "Kirinuki 로컬 컷 제어",
    ...(sourceClockIdentity ? { sourceClockIdentity } : {})
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
    const startSeconds = parseStudioTimecode(startInput.value);
    const endSeconds = parseStudioTimecode(endInput.value);
    if (
      startSeconds === null
      || endSeconds === null
      || endSeconds - startSeconds < MINIMUM_SELECTION_SECONDS
    ) {
      row.classList.add("invalid");
      startInput.focus();
      throw new TypeError(
        `${index + 1}번 구간의 시작·끝을 확인해 주세요. 끝은 시작보다 0.1초 이상 뒤여야 합니다.`
      );
    }
    const selectionId = String(row.dataset.selectionId || "").trim();
    if (!selectionId) {
      throw new TypeError(`${index + 1}번 구간의 내부 식별자를 확인하지 못했습니다.`);
    }
    return {
      id: selectionId,
      startSeconds,
      endSeconds,
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
  elements.streamCutConsole.hidden = true;
  elements.streamCutConsole.inert = true;
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
  elements.streamCutConsole.hidden = false;
  elements.streamCutConsole.inert = false;
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
    && !window.confirm(
      `현재 입력을 ‘${imported.projectName}’의 원본 링크와 ${imported.segments.length}개 구간으로 바꿀까요?\n\n현재 편집기 세션과 정책 확인은 건드리지 않습니다.`
    )
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
  resetStreamingBridge();
  resetYouTubeIframePlayer({ replaceFrame: true });
  elements.streamFrame.removeAttribute("src");
  elements.streamFrame.hidden = true;
  elements.streamPlaceholder.hidden = false;
  elements.streamKind.textContent = "링크 대기";
  elements.streamKind.classList.remove("valid");
  elements.streamStatus.textContent = message;
  elements.reloadStream.disabled = true;
  setStreamCutStatus("VOD 주소를 입력하면 가능한 플레이어 동작을 활성화합니다.");
  updateCaptureConsoleAvailability();
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
  activeStreamEmbedUrl = descriptor.embedUrl;
  activeStreamPlatform = descriptor.platform;
  resetStreamingBridge();
  resetYouTubeIframePlayer({ replaceFrame: true });
  elements.streamKind.textContent = descriptor.label;
  elements.streamKind.classList.add("valid");
  elements.streamStatus.textContent = descriptor.kind === "official-embed"
    ? "플랫폼 공식 임베드에 브라우저가 직접 연결하는 중입니다…"
    : "CHZZK VOD 페이지에 브라우저가 직접 연결하는 중입니다…";
  elements.streamPlaceholder.hidden = true;
  elements.streamFrame.hidden = false;
  elements.streamFrame.src = descriptor.embedUrl;
  syncStreamingBridgeSource();
  elements.reloadStream.disabled = false;
  setStreamCutStatus(descriptor.platform === SOURCE_PLATFORM_YOUTUBE
    ? "YouTube 플레이어 연결을 기다리는 중입니다…"
    : "플레이어 제어를 연결하는 중입니다. 이 화면에서는 영상을 내려받지 않습니다.");
  updateCaptureConsoleAvailability();
  if (streamLoadTimer !== null) {
    window.clearTimeout(streamLoadTimer);
  }
  streamLoadTimer = window.setTimeout(() => {
    streamLoadTimer = null;
    if (activeStreamEmbedUrl === descriptor.embedUrl) {
      elements.streamStatus.textContent =
        "플레이어 응답을 아직 확인하지 못했습니다. ‘플레이어 다시 시작’ 또는 ‘원본 페이지 열기’를 사용하세요.";
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
  return new Intl.DateTimeFormat("ko-KR", {
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
      `컷 ${project.clips.length.toLocaleString("ko-KR")}개 · 자막 ${project.subtitles.length.toLocaleString("ko-KR")}개`;
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
  const hasProjects = localProjectEntries.length > 0;
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
      ? `저장된 편집 ${localProjectEntries.length.toLocaleString("ko-KR")}개 · 최근 수정순${activeCount > 0 ? ` · 다른 탭 작업 중 ${activeCount}개` : ""}`
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
      setStreamCutStatus(message);
      setStatus(message, "success");
    } else if (announce) {
      setStreamCutStatus(
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
      setStreamCutStatus(`브라우저 편집 목록을 읽지 못했습니다: ${errorMessage(error)}`);
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

function queueLocalProjectLifecycleCleanup({
  announce = false
}: {
  announce?: boolean;
} = {}): Promise<void> {
  return localProjectLifecycleCleanupQueue.enqueue(async () => {
    // The queue is the only lifecycle caller of the rollback inventory. A
    // failed pass remains authoritative until a later explicit retry runs.
    await reconcileAbandonedProjectsBeforeEditorEntry();
    if (announce) {
      setStreamCutStatus(
        localProjectEntries.length > 0
          ? `저장된 편집 ${localProjectEntries.length}개를 다시 읽었습니다.`
          : "이 브라우저에 저장된 편집이 없습니다."
      );
    }
  });
}

function observeLocalProjectLifecycleCleanup(
  cleanup: Promise<void>
): void {
  void cleanup.catch((error) => {
    console.error("이전 편집의 브라우저 저장 상태를 정리하지 못했습니다.", error);
  });
}

async function requireSafeLocalProjectStateForEditorEntry(): Promise<void> {
  // Request one final inventory after every cleanup already requested by
  // startup/focus/pageshow. `openingEditor` prevents lifecycle events from
  // adding more work while the navigation transaction begins.
  const requested = queueLocalProjectLifecycleCleanup();
  observeLocalProjectLifecycleCleanup(requested);
  try {
    await localProjectLifecycleCleanupQueue.waitForLatest();
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
    observeLocalProjectLifecycleCleanup(queueLocalProjectLifecycleCleanup());
  }, 80);
}

function migratedLatestProjectId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const stores = (value as Record<string, unknown>).stores;
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) {
    return "";
  }
  const projects = (stores as Record<string, unknown>).projects;
  if (!Array.isArray(projects)) {
    return "";
  }
  return projects.reduce<{ id: string; updatedAt: number }>((latest, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return latest;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      return latest;
    }
    const updatedAt = typeof record.updatedAt === "string"
      ? Date.parse(record.updatedAt)
      : Number.NaN;
    const comparable = Number.isFinite(updatedAt) ? updatedAt : 0;
    return comparable >= latest.updatedAt ? { id, updatedAt: comparable } : latest;
  }, { id: "", updatedAt: -1 }).id;
}

async function importStagedOriginStorageMigration(): Promise<boolean> {
  const match = /^#storage-migration=([A-Za-z0-9_-]{43})$/u.exec(location.hash);
  const nonce = match?.[1];
  if (!nonce) {
    return false;
  }
  setStatus("이전 저장 데이터를 옮기는 중입니다…");
  const response = await fetch(`/v1/studio/storage-migrations/${nonce}`, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error"
  });
  if (!response.ok) {
    throw new Error(`이전 편집 데이터 가져오기에 실패했습니다 (HTTP ${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !Number.isSafeInteger(declaredLength)
    || declaredLength <= 0
    || declaredLength > ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES
  ) {
    throw new Error("이전 편집 데이터 응답 크기가 안전 범위를 벗어났습니다.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength !== declaredLength) {
    throw new Error("이전 편집 데이터 응답이 전송 중 달라졌습니다.");
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(text) as unknown;
  } catch {
    throw new Error("이전 편집 데이터 JSON이 올바르지 않습니다.");
  }
  const result = await importCurrentOriginStorageMigration(envelope);
  const latestProject = migratedLatestProjectId(envelope);
  if (latestProject) {
    localStorage.setItem(WEB_STUDIO_LATEST_PROJECT_KEY, latestProject);
  }
  const cleanUrl = new URL(location.href);
  cleanUrl.hash = "";
  history.replaceState(null, "", cleanUrl.href);
  setStatus(
    `이전 편집 데이터 이동 완료 · 프로젝트 ${result.projectCount} · 임시저장 ${result.localDraftCount} · 이미지 ${result.imageAssetCount}. 기존 브라우저 저장소는 삭제하지 않았습니다.`,
    "success"
  );
  return true;
}

function prefillSourceFromLocation(): void {
  const url = new URL(location.href);
  const source = url.searchParams.get("source") || new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  ).get("source");
  if (source) {
    elements.sourceUrl.value = source;
    updateSourcePlatform();
  }
}

function currentDraftRow(): HTMLElement | null {
  if (activeClipRow?.isConnected) {
    return activeClipRow;
  }
  activeClipRow = clipRows().at(-1) ?? null;
  return activeClipRow;
}

function writeCapturedPlayerTime(
  field: "start" | "end",
  currentTime: number
): void {
  const row = currentDraftRow();
  if (!row) {
    throw new Error("현재 구간 입력 행이 없습니다.");
  }
  const input = requiredInputWithin(row, `[data-field="${field}"]`);
  input.value = formatStudioTimecode(currentTime);
  row.classList.remove("finalized");
  row.removeAttribute("data-finalized");
  updateClipRows();
  setStreamCutStatus(
    `${formatStudioTimecode(currentTime)}을 ${field === "start" ? "시작" : "끝"} 시각에 기록했습니다.`
  );
}

async function captureCurrentPlayerTime(
  field: "start" | "end"
): Promise<void> {
  let currentTime: number | null;
  if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
    currentTime = currentYouTubePlayerTime();
  } else if (streamingBridgeClient) {
    const client = streamingBridgeClient;
    latestStreamingSnapshot = await runTransientSafeStreamingAction(
      client,
      () => client.snapshot()
    );
    currentTime = latestStreamingSnapshot.currentTime;
  } else {
    currentTime = null;
  }
  if (currentTime === null) {
    explainUnavailablePlayerControl();
    return;
  }
  writeCapturedPlayerTime(field, currentTime);
  updateCaptureConsoleAvailability();
}

function finalizeCurrentDraftRow(): void {
  const row = currentDraftRow();
  if (!row) {
    throw new Error("확정할 구간 입력 행이 없습니다.");
  }
  const startInput = requiredInputWithin(row, '[data-field="start"]');
  const endInput = requiredInputWithin(row, '[data-field="end"]');
  const startSeconds = parseStudioTimecode(startInput.value);
  const endSeconds = parseStudioTimecode(endInput.value);
  if (
    startSeconds === null
    || endSeconds === null
    || endSeconds - startSeconds < MINIMUM_SELECTION_SECONDS
  ) {
    row.classList.add("invalid");
    (startSeconds === null ? startInput : endInput).focus();
    setStreamCutStatus("구간을 확정하려면 올바른 시작·끝 시각이 필요합니다.");
    return;
  }
  row.dataset.finalized = "true";
  row.classList.add("finalized");
  const rowNumber = clipRows().indexOf(row) + 1;
  const nextSibling = row.nextElementSibling;
  const nextRow = nextSibling instanceof HTMLElement
    && nextSibling.matches(".clip-row")
    ? nextSibling
    : addClipRow();
  activeClipRow = nextRow;
  requiredInputWithin(nextRow, '[data-field="start"]').focus();
  updateClipRows();
  setStreamCutStatus(
    `${rowNumber}번 구간을 확정했습니다. 다음 구간의 시작 시각을 입력하거나 E로 캡처하세요.`
  );
}

async function seekPlayerBy(deltaSeconds: -5 | 5): Promise<void> {
  if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
    const snapshot = currentYouTubePlayerSnapshot();
    const player = youtubePlayer;
    if (!snapshot || !player) {
      explainUnavailablePlayerControl();
      return;
    }
    const target = Math.max(
      0,
      Math.min(
        snapshot.duration ?? Number.POSITIVE_INFINITY,
        snapshot.currentTime + deltaSeconds
      )
    );
    const generation = youtubePlayerGeneration;
    try {
      player.seekTo(target, true);
    } catch {
      explainUnavailablePlayerControl();
      return;
    }
    const confirmed = await waitForYouTubePlayerState(
      player,
      generation,
      (current) => Math.abs(current.currentTime - target) <= 0.25,
      "YouTube 플레이어가 요청한 탐색 위치를 확인하지 못했습니다."
    );
    updateCaptureConsoleAvailability();
    setStreamCutStatus(
      `YouTube 플레이어를 ${formatStudioTimecode(confirmed.currentTime)}로 이동했습니다.`
    );
    return;
  }
  if (!streamingBridgeClient || !streamingBridgeReady()) {
    explainUnavailablePlayerControl();
    return;
  }
  const client = streamingBridgeClient;
  const before = await runTransientSafeStreamingAction(
    client,
    () => client.snapshot()
  );
  if (!before.found || before.currentTime === null) {
    explainUnavailablePlayerControl();
    return;
  }
  const minimum = before.seekableStart ?? 0;
  const maximum = before.seekableEnd
    ?? before.duration
    ?? Number.POSITIVE_INFINITY;
  const target = Math.min(
    maximum,
    Math.max(minimum, before.currentTime + deltaSeconds)
  );
  latestStreamingSnapshot = await runTransientSafeStreamingAction(
    client,
    () => client.seekAbsolute(target)
  );
  updateCaptureConsoleAvailability();
  setStreamCutStatus(
    `원본 스트리밍을 ${formatStudioTimecode(latestStreamingSnapshot.currentTime ?? 0)}로 이동했습니다.`
  );
}

async function setPlayerRate(playbackRate: 0.25 | 2): Promise<void> {
  if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
    const player = youtubePlayer;
    if (!youtubePlayerReady || !player) {
      explainUnavailablePlayerControl();
      return;
    }
    const generation = youtubePlayerGeneration;
    try {
      player.setPlaybackRate(playbackRate);
    } catch {
      explainUnavailablePlayerControl();
      return;
    }
    await waitForYouTubePlayerState(
      player,
      generation,
      (snapshot) => snapshot.playbackRate === playbackRate,
      `YouTube 플레이어가 ${playbackRate}배속 적용을 확인하지 못했습니다.`
    );
    updateCaptureConsoleAvailability();
    setStreamCutStatus(`YouTube 플레이어를 ${playbackRate}배속으로 설정했습니다.`);
    return;
  }
  if (!streamingBridgeClient || !streamingBridgeReady()) {
    explainUnavailablePlayerControl();
    return;
  }
  const client = streamingBridgeClient;
  latestStreamingSnapshot = await runTransientSafeStreamingAction(
    client,
    () => client.setPlaybackRate(playbackRate)
  );
  updateCaptureConsoleAvailability();
  setStreamCutStatus(`원본 스트리밍을 ${playbackRate}배속으로 설정했습니다.`);
}

function studioCaptureActionNeedsPlayer(
  action: StudioCaptureAction
): boolean {
  return action === "capture-start"
    || action === "capture-end"
    || action === "player-seek-backward-five"
    || action === "player-seek-forward-five"
    || action === "player-rate-quarter"
    || action === "player-rate-double";
}

function playerControlAvailable(): boolean {
  const youtubeDirectlyControllable = Boolean(
    activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE
    && youtubePlayerReady
    && youtubePlayer
  );
  return streamingBridgeReady() || youtubeDirectlyControllable;
}

async function refreshActivePlayerContext(): Promise<void> {
  if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
    if (!currentYouTubePlayerSnapshot()) {
      explainUnavailablePlayerControl();
      return;
    }
    updateCaptureConsoleAvailability();
    setStreamCutStatus("현재 YouTube 플레이어 시각을 다시 읽었습니다.");
    return;
  }
  syncStreamingBridgeSource();
  const client = streamingBridgeClient;
  if (!client) {
    explainUnavailablePlayerControl();
    return;
  }
  latestStreamingSnapshot = await runTransientSafeStreamingAction(
    client,
    () => client.snapshot()
  );
  updateCaptureConsoleAvailability();
  setStreamCutStatus("현재 원본 스트리밍 시각을 다시 읽었습니다.");
}

function reloadActivePlayerFrame(): void {
  updateStreamPreview({ force: true });
}

async function refreshRecentProject(): Promise<void> {
  try {
    await queueLocalProjectLifecycleCleanup({ announce: true });
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
      setStreamCutStatus("삭제할 브라우저 편집을 목록에서 찾지 못했습니다.");
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
    await queueLocalProjectLifecycleCleanup();
    setStreamCutStatus(`${deletedName}의 브라우저 저장 데이터를 삭제했습니다.`);
  } catch (error) {
    setStreamCutStatus(errorMessage(error));
    setStatus(errorMessage(error), "error");
  } finally {
    localProjectManagerBusy = false;
    elements.localProjectManager.ariaBusy = "false";
    elements.confirmLocalProjectDelete.disabled = false;
    elements.cancelLocalProjectDelete.disabled = false;
  }
}

async function runQueuedSourceClockAction(
  action: StudioCaptureAction
): Promise<void> {
  switch (action) {
    case "capture-start":
      await captureCurrentPlayerTime("start");
      return;
    case "capture-end":
      await captureCurrentPlayerTime("end");
      return;
    case "save-segment":
      finalizeCurrentDraftRow();
      return;
    case "player-seek-backward-five":
      await seekPlayerBy(-5);
      return;
    case "player-seek-forward-five":
      await seekPlayerBy(5);
      return;
    case "player-rate-quarter":
      await setPlayerRate(0.25);
      return;
    case "player-rate-double":
      await setPlayerRate(2);
      return;
    case "open-editor":
      // Keep A behind E/R/T so a fast keyboard sequence cannot submit before
      // the captured row has been written and finalized.
      elements.startEditor.click();
      return;
    default:
      throw new TypeError(`직렬화할 수 없는 컷 제어 동작입니다: ${action}`);
  }
}

function queueSourceClockAction(action: StudioCaptureAction): void {
  const expectedGeneration = sourceClockOperationQueue.generation;
  const queued = sourceClockOperationQueue.enqueue(async () => {
    await runQueuedSourceClockAction(action);
    if (expectedGeneration !== sourceClockOperationQueue.generation) {
      throw new StaleSerialOperationGenerationError();
    }
  });
  updateCaptureConsoleAvailability();
  void queued
    .catch(reportStudioCaptureActionError)
    .finally(updateCaptureConsoleAvailability);
}

function runStudioCaptureAction(action: StudioCaptureAction): void {
  if (studioCaptureActionNeedsPlayer(action) && !playerControlAvailable()) {
    explainUnavailablePlayerControl();
    return;
  }
  switch (action) {
    case "refresh-recovery-sessions":
      void refreshRecentProject();
      return;
    case "refresh-source":
      void refreshActivePlayerContext().catch(reportStudioCaptureActionError);
      return;
    default:
      queueSourceClockAction(action);
  }
}

function reportStudioCaptureActionError(error: unknown): void {
  if (error instanceof DOMException && error.name === "AbortError") {
    return;
  }
  if (error instanceof StaleSerialOperationGenerationError) {
    return;
  }
  const message = `컷 제어를 실행하지 못했습니다: ${errorMessage(error)}`;
  setStreamCutStatus(message);
  setStatus(message, "error");
}

function installStudioCaptureConsole(): void {
  for (const binding of STUDIO_CAPTURE_SHORTCUT_BINDINGS) {
    if (!binding.targetId) {
      continue;
    }
    const button = captureConsoleButton(binding.targetId);
    button.title = binding.title;
    button.setAttribute("aria-keyshortcuts", binding.key);
    button.addEventListener("click", () => runStudioCaptureAction(binding.action));
  }
  document.addEventListener("keydown", (event) => {
    const key = studioCaptureShortcutLetterFromEvent(event);
    const binding = studioCaptureShortcutBinding(key);
    if (!binding) {
      return;
    }
    if (binding.targetId) {
      const button = captureConsoleButton(binding.targetId);
      if (button.disabled || button.closest("[hidden]")) {
        return;
      }
      event.preventDefault();
      button.click();
      return;
    }
    if (binding.action === "open-editor" && elements.startEditor.disabled) {
      return;
    }
    event.preventDefault();
    runStudioCaptureAction(binding.action);
  });
}

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
  resetStreamingBridge();
  activeStreamPlatform = "";
  resetYouTubeIframePlayer();
  setStreamCutStatus("원본 주소 변경을 확인하는 중입니다…");
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
      queueLocalProjectLifecycleCleanup({ announce: true })
    );
  }
});
elements.retryLocalProjects.addEventListener("click", () => {
  if (!openingEditor) {
    observeLocalProjectLifecycleCleanup(
      queueLocalProjectLifecycleCleanup({ announce: true })
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
    elements.streamStatus.textContent =
      "플랫폼 문서를 브라우저에 직접 불러왔습니다. 플레이어 제어 연결을 확인하는 중입니다.";
    if (activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE) {
      void connectStreamingShortcutBridge(frame, activeStreamEmbedUrl);
      void connectYouTubeIframePlayer(frame, youtubePlayerGeneration);
      return;
    }
    void connectStreamingBridge(frame, activeStreamEmbedUrl);
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
        const projectId = createFreshEditorProjectId();
        const sourceSessionId = sourceSessionIdentity(captureSeed.source);
        if (!sourceSessionId) {
          throw new TypeError("원본 VOD 회차를 식별하지 못했습니다.");
        }
        target = { projectId, sourceSessionId, purpose: "editor-new" };
      }
      const attestation = createAttestation(target);
      setStatus("편집기를 여는 중입니다…", "success");
      const session = await beginWebEditorSession({
        attestation,
        ...(captureSeed === undefined ? {} : { captureSeed })
      });
      location.assign(session.editorUrl);
    } catch (error) {
      setStatus(errorMessage(error), "error");
      if (!allAcknowledgementsChecked()) {
        focusFirstMissingAcknowledgement();
      }
      openingEditor = false;
      elements.startEditor.disabled = false;
    }
  })();
});

renderMobileEditorAccess();
addClipRow();
installStudioCaptureConsole();
installStreamFrameLoadHandler(elements.streamFrame);
prefillSourceFromLocation();
updateStreamPreview();
window.setInterval(() => {
  updatePlayerClockDisplay();
  void pollStreamingBridgeClock();
}, 250);
window.addEventListener("focus", scheduleLocalProjectLifecycleRefresh);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    // A same-tab editor navigation can leave this start document in bfcache
    // with its pre-navigation `openingEditor` flag. On return, it is a live
    // start page again and must be allowed to reconcile the abandoned writer.
    openingEditor = false;
    renderMobileEditorAccess();
    clearCurrentTabWebEditorSession();
    observeLocalProjectLifecycleCleanup(queueLocalProjectLifecycleCleanup());
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
    await importStagedOriginStorageMigration();
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
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

if (isKirinukiLocalStudioOrigin(activeStudioOrigin)) {
  startLocalApplication();
} else if (isKirinukiPublicStudioOrigin(activeStudioOrigin)) {
  startPublicLaunchShell();
}
