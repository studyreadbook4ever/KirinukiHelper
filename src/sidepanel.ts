import {
  STORAGE_KEY,
  WORKSPACE_META_KEY,
  buildCodexJobManifest,
  compileCreatorPolicyMarkdown,
  createInitialState,
  createSegment,
  formatTimestamp,
  generateCodexStartHere,
  generateEditPrompt,
  normalizeState,
  normalizeWorkspaceMeta,
  parseTimestamp,
  resolveCreatorPolicies,
  sanitizeFileName,
  validateSegmentInput
} from "./lib/core.js";
import type {
  CaptureDetails,
  EditSegment,
  ResolvedCreatorPolicy,
  SourceMetadata
} from "./lib/core.js";
import {
  captureStateSourceConflict,
  sameSourceSession,
  sourceSessionIdentity
} from "./lib/editor-core.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_YOUTUBE,
  canStartSourceRefresh,
  isSupportedSourceUrl,
  selectSupportedSourceTab,
  sourcePlayerStatusText,
  sourcePlatformLabel,
  sourceRefreshFailureAction
} from "./lib/source-platform.js";
import {
  SIDEPANEL_SHORTCUT_BINDINGS,
  formatKeyboardShortcutHint,
  keyboardShortcutBindingForScope,
  keyboardShortcutLetterFromEvent
} from "./lib/keyboard-shortcuts.js";
import type {
  KeyboardShortcutBinding
} from "./lib/keyboard-shortcuts.js";
import {
  createSerialOperationGate
} from "./lib/serial-operation-gate.js";
import type {
  SerialOperationReservation
} from "./lib/serial-operation-gate.js";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

interface PanelCaptureDetails extends CaptureDetails {
  rawSeconds: number;
  sourceSessionId?: string;
}

interface PanelDraft {
  startText: string;
  endText: string;
  description: string;
  startCapture: PanelCaptureDetails | null;
  endCapture: PanelCaptureDetails | null;
  editingId: string | null;
}

interface PanelSource extends SourceMetadata {
  platform: string;
  url: string;
  canonicalUrl: string;
  channelId: string;
  contentId: string;
  contentType: string;
  streamerName: string;
  broadcastTitle: string;
  broadcastStartedAt: string;
  clipActive: boolean | null;
  timeMachineActive: boolean | null;
  category: string;
  observedAt: string;
}

interface PanelState extends Record<string, unknown> {
  schemaVersion: number;
  editorProjectId: string;
  projectName: string;
  draft: PanelDraft;
  source: PanelSource;
  globalInstruction: string;
  segments: EditSegment[];
  updatedAt: string;
}

interface PagePlayerContext {
  found?: boolean;
  paused?: boolean;
  adActive?: boolean;
  playbackRate?: number;
  currentTime?: number;
  positionSeconds?: number;
  rawMediaPositionSeconds?: number;
  positionSource?: string;
  confidence?: string;
  liveEdgeOffsetSeconds?: number;
}

interface PageContext extends PanelSource {
  pageTitle?: string;
  capturedAt?: string;
  player?: PagePlayerContext | null;
  sourceTabId?: number;
}

interface RecoveryCounts {
  clips?: number;
  subtitles?: number;
  assets?: number;
  audio?: number;
}

interface RecoverySession {
  projectId: string;
  title: string;
  updatedAt?: string;
  draftCount?: number;
  latestDraftReason?: string;
  counts?: RecoveryCounts;
}

interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  sessions?: RecoverySession[];
  context?: PageContext;
  player?: PagePlayerContext;
  workspaceMeta?: unknown;
  cleanupErrors?: unknown;
}

type SourceTabWithId = chrome.tabs.Tab & { id: number };

interface WorkspaceMeta {
  resetEpoch: string;
  revision: number;
  writerId: string;
}

type DirtyField =
  | "projectName"
  | "globalInstruction"
  | "streamerName"
  | "broadcastTitle"
  | "draft";

interface DirtyEntry {
  version: number;
  value: string | PanelDraft;
}

interface CreatorPolicyIndex {
  policies: unknown[];
}

const requiredElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`필수 UI 요소를 찾지 못했습니다: ${selector}`);
  }
  return element;
};

const requiredDescendant = <T extends Element>(
  root: ParentNode,
  selector: string
): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`필수 UI 하위 요소를 찾지 못했습니다: ${selector}`);
  }
  return element;
};

const elements = {
  connectionBadge: requiredElement<HTMLElement>("#connection-badge"),
  refreshRecoverySessions: requiredElement<HTMLButtonElement>("#refresh-recovery-sessions"),
  recoverySessionsLoading: requiredElement<HTMLElement>("#recovery-sessions-loading"),
  recoverySessionsEmpty: requiredElement<HTMLElement>("#recovery-sessions-empty"),
  recoverySessionsList: requiredElement<HTMLElement>("#recovery-sessions-list"),
  recoverySessionTemplate: requiredElement<HTMLTemplateElement>("#recovery-session-template"),
  refreshSource: requiredElement<HTMLButtonElement>("#refresh-source"),
  sourceEmpty: requiredElement<HTMLElement>("#source-empty"),
  sourceDetails: requiredElement<HTMLElement>("#source-details"),
  sourceType: requiredElement<HTMLElement>("#source-type"),
  playerPosition: requiredElement<HTMLElement>("#player-position"),
  playerStatus: requiredElement<HTMLElement>("#player-status"),
  playbackRateQuarter: requiredElement<HTMLButtonElement>("#playback-rate-quarter"),
  playbackRateDouble: requiredElement<HTMLButtonElement>("#playback-rate-double"),
  seekBackwardFive: requiredElement<HTMLButtonElement>("#seek-backward-five"),
  seekForwardFive: requiredElement<HTMLButtonElement>("#seek-forward-five"),
  streamerName: requiredElement<HTMLInputElement>("#streamer-name"),
  broadcastTitle: requiredElement<HTMLInputElement>("#broadcast-title"),
  sourceLink: requiredElement<HTMLAnchorElement>("#source-link"),
  projectName: requiredElement<HTMLInputElement>("#project-name"),
  globalInstruction: requiredElement<HTMLTextAreaElement>("#global-instruction"),
  captureCard: requiredElement<HTMLElement>("#capture-card"),
  editingBadge: requiredElement<HTMLElement>("#editing-badge"),
  startTime: requiredElement<HTMLInputElement>("#start-time"),
  endTime: requiredElement<HTMLInputElement>("#end-time"),
  captureStart: requiredElement<HTMLButtonElement>("#capture-start"),
  captureEnd: requiredElement<HTMLButtonElement>("#capture-end"),
  segmentDescription: requiredElement<HTMLTextAreaElement>("#segment-description"),
  descriptionCount: requiredElement<HTMLElement>("#description-count"),
  saveSegment: requiredElement<HTMLButtonElement>("#save-segment"),
  cancelEdit: requiredElement<HTMLButtonElement>("#cancel-edit"),
  segmentCount: requiredElement<HTMLElement>("#segment-count"),
  segmentsEmpty: requiredElement<HTMLElement>("#segments-empty"),
  segmentsList: requiredElement<HTMLElement>("#segments-list"),
  segmentTemplate: requiredElement<HTMLTemplateElement>("#segment-template"),
  generatePrompt: requiredElement<HTMLButtonElement>("#generate-prompt"),
  openEditor: requiredElement<HTMLButtonElement>("#open-editor"),
  createCodexJob: requiredElement<HTMLButtonElement>("#create-codex-job"),
  policyMatchBadge: document.querySelector<HTMLElement>("#policy-match-badge"),
  promptResult: requiredElement<HTMLElement>("#prompt-result"),
  promptPreview: requiredElement<HTMLTextAreaElement>("#prompt-preview"),
  promptCharacterCount: requiredElement<HTMLElement>("#prompt-character-count"),
  copyPrompt: requiredElement<HTMLButtonElement>("#copy-prompt"),
  downloadPrompt: requiredElement<HTMLButtonElement>("#download-prompt"),
  closePreview: requiredElement<HTMLButtonElement>("#close-preview"),
  resetProject: requiredElement<HTMLButtonElement>("#reset-project"),
  statusBar: requiredElement<HTMLElement>("#status-bar")
};

function shortcutTargetIds(
  binding: KeyboardShortcutBinding
): readonly string[] {
  return [binding.targetId, ...(binding.alternateTargetIds || [])];
}

function usableShortcutTarget(
  binding: KeyboardShortcutBinding
): HTMLElement | null {
  if (
    binding.action === "save-segment"
    && Boolean(state.draft.editingId)
  ) {
    return null;
  }
  for (const targetId of shortcutTargetIds(binding)) {
    const target = document.getElementById(targetId);
    if (
      !(target instanceof HTMLElement)
      || target.closest("[hidden]")
      || target.getAttribute("aria-disabled") === "true"
      || (
        target instanceof HTMLButtonElement
        && target.disabled
      )
    ) {
      continue;
    }
    return target;
  }
  return null;
}

function installShortcutHints(): void {
  for (const binding of SIDEPANEL_SHORTCUT_BINDINGS) {
    for (const targetId of shortcutTargetIds(binding)) {
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLElement)) {
        throw new Error(`사이드패널 단축키 대상이 없습니다: #${targetId}`);
      }
      target.title = formatKeyboardShortcutHint(binding.label, binding.key);
      target.setAttribute("aria-keyshortcuts", binding.key);
    }
  }
}

function bindKeyboardShortcuts(): void {
  document.addEventListener("keydown", (event) => {
    const letter = keyboardShortcutLetterFromEvent(event);
    const binding = letter
      ? keyboardShortcutBindingForScope("sidepanel", letter)
      : null;
    const target = binding ? usableShortcutTarget(binding) : null;
    if (!binding || !target) {
      return;
    }
    event.preventDefault();
    if (binding.trigger === "focus") {
      target.focus({ preventScroll: false });
    } else {
      target.click();
    }
  });
}

const panelState = (value: unknown): PanelState => (
  normalizeState(value) as unknown as PanelState
);
const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);
const isAbortError = (error: unknown): boolean => (
  error instanceof DOMException
    ? error.name === "AbortError"
    : (
      typeof error === "object"
      && error !== null
      && "name" in error
      && error.name === "AbortError"
    )
);
const sendRuntimeMessage = (
  message: Record<string, unknown>
): Promise<RuntimeResponse> => chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
const normalizePanelWorkspaceMeta = (raw: unknown): WorkspaceMeta => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalizeWorkspaceMeta(null);
  }
  const candidate = raw as Record<string, unknown>;
  return normalizeWorkspaceMeta({
    resetEpoch: candidate.resetEpoch,
    revision: candidate.revision,
    writerId: candidate.writerId
  });
};

let state = panelState(createInitialState());
let currentContext: PageContext | null = null;
let sourceConflict = false;
let editingGuideMarkdown = "";
let creatorPolicyMarkdown = "";
let codexJobAgentsMarkdown = "";
let creatorPolicyIndex: CreatorPolicyIndex = { policies: [] };
let lastPrompt = "";
let saveTimer: number | null = null;
let statusTimer: number | null = null;
let refreshTimer: number | null = null;
let contextRequestSequence = 0;
let foregroundContextRequestCount = 0;
let sourceRefreshRequestCount = 0;
let playerCommandInProgress = false;
const sourceClockOperationGate = createSerialOperationGate();
let stateGeneration = 0;
let resetInProgress = false;
let persistenceChain: Promise<unknown> = Promise.resolve();
let workspaceSyncChain: Promise<void> = Promise.resolve();
let workspaceMeta = normalizePanelWorkspaceMeta(null);
const panelWriterId = crypto.randomUUID();
let dirtyFieldSequence = 0;
const dirtyFields = new Map<DirtyField, DirtyEntry>();
let lastPersistedStateSignature = "";
let recoveryLoadSequence = 0;
let recoveryOpenInProgress = false;

const recoveryDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const wait = (milliseconds: number): Promise<void> => new Promise(
  (resolve) => window.setTimeout(resolve, milliseconds)
);

class SourceTabUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceTabUnavailableError";
  }
}

function setStatus(message: string, type = "info", timeout = 4200): void {
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
  }
  elements.statusBar.textContent = message;
  elements.statusBar.className = `status-bar ${type}`;
  elements.statusBar.hidden = false;
  if (timeout > 0) {
    statusTimer = window.setTimeout(() => {
      elements.statusBar.hidden = true;
    }, timeout);
  }
}

function recoveryDraftReasonLabel(reason: unknown): string {
  const labels: Record<string, string> = {
    manual: "수동 저장",
    auto: "자동 저장",
    "pre-restore": "복원 직전 저장"
  };
  return labels[String(reason ?? "")] || "임시저장";
}

function recoveryCountsLabel(counts: RecoveryCounts = {}): string {
  return [
    `컷 ${Number(counts.clips) || 0}`,
    `자막 ${Number(counts.subtitles) || 0}`,
    `에셋 ${Number(counts.assets) || 0}`,
    `음성 ${Number(counts.audio) || 0}`
  ].join(" · ");
}

function renderRecoverySessions(sessions: RecoverySession[]): void {
  const fragment = document.createDocumentFragment();
  for (const session of sessions) {
    const item = elements.recoverySessionTemplate.content
      .firstElementChild
      ?.cloneNode(true);
    if (!(item instanceof HTMLElement)) {
      throw new Error("복구 세션 템플릿 형식이 올바르지 않습니다.");
    }
    item.dataset.projectId = session.projectId;
    item.dataset.draftCount = String(session.draftCount || 0);
    requiredDescendant<HTMLElement>(
      item,
      ".recovery-session-title"
    ).textContent = session.title;
    const time = requiredDescendant<HTMLTimeElement>(
      item,
      ".recovery-session-time"
    );
    if (session.updatedAt) {
      time.dateTime = session.updatedAt;
      time.textContent = `최근 편집 ${recoveryDateFormatter.format(
        new Date(session.updatedAt)
      )}`;
    } else {
      time.textContent = "최근 편집 시각 정보 없음";
    }
    requiredDescendant<HTMLElement>(
      item,
      ".recovery-session-counts"
    ).textContent = recoveryCountsLabel(session.counts);
    const draftCount = Number(session.draftCount) || 0;
    const drafts = requiredDescendant<HTMLElement>(
      item,
      ".recovery-session-drafts"
    );
    drafts.textContent = draftCount > 0
      ? `복구본 ${draftCount}개 · 최신 ${recoveryDraftReasonLabel(
        session.latestDraftReason
      )}`
      : "아직 선택할 복구본 없음";
    const draftButton = requiredDescendant<HTMLButtonElement>(
      item,
      '[data-recovery-action="drafts"]'
    );
    draftButton.disabled = draftCount === 0;
    draftButton.title = draftCount > 0
      ? "최근 임시저장 중 하나를 골라 불러오기"
      : "이 프로젝트에는 아직 임시저장이 없습니다.";
    fragment.append(item);
  }
  elements.recoverySessionsList.replaceChildren(fragment);
  elements.recoverySessionsEmpty.hidden = sessions.length > 0;
}

async function refreshRecoverySessions(
  { silent = false }: { silent?: boolean } = {}
): Promise<void> {
  const requestSequence = ++recoveryLoadSequence;
  elements.refreshRecoverySessions.disabled = true;
  if (!silent || elements.recoverySessionsList.children.length === 0) {
    elements.recoverySessionsLoading.hidden = false;
    elements.recoverySessionsLoading.textContent = "저장된 편집을 확인하는 중…";
  }
  try {
    const response = await sendRuntimeMessage({
      type: "KIRINUKI_LIST_RECOVERY_SESSIONS"
    });
    if (requestSequence !== recoveryLoadSequence) {
      return;
    }
    if (!response?.ok || !Array.isArray(response.sessions)) {
      throw new Error(response?.error || "저장된 편집 목록을 읽지 못했습니다.");
    }
    renderRecoverySessions(response.sessions);
    elements.recoverySessionsLoading.hidden = true;
  } catch (error) {
    if (requestSequence !== recoveryLoadSequence) {
      return;
    }
    elements.recoverySessionsLoading.hidden = false;
    elements.recoverySessionsLoading.textContent = (
      `저장된 편집 확인 실패 · ${errorMessage(error)}`
    );
    if (!silent) {
      setStatus(`최근 편집을 확인하지 못했습니다: ${errorMessage(error)}`, "error");
    }
  } finally {
    if (requestSequence === recoveryLoadSequence) {
      elements.refreshRecoverySessions.disabled = false;
    }
  }
}

async function openSavedEditor(
  projectId: string,
  { recoveryDrafts = false }: { recoveryDrafts?: boolean } = {}
): Promise<void> {
  if (recoveryOpenInProgress) {
    return;
  }
  const item = [...elements.recoverySessionsList.children].find(
    (candidate) => (
      candidate instanceof HTMLElement
      && candidate.dataset.projectId === projectId
    )
  );
  if (!(item instanceof HTMLElement)) {
    setStatus("다시 열 프로젝트를 목록에서 찾지 못했습니다.", "error");
    return;
  }
  recoveryOpenInProgress = true;
  item.classList.add("is-opening");
  for (const button of item.querySelectorAll("button")) {
    button.disabled = true;
  }
  try {
    const response = await sendRuntimeMessage({
      type: "KIRINUKI_OPEN_SAVED_EDITOR",
      projectId,
      recovery: recoveryDrafts ? "drafts" : "current"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "저장된 편집기를 열지 못했습니다.");
    }
    setStatus(
      recoveryDrafts
        ? "편집기를 열고 복구본 목록을 표시했습니다."
        : "마지막 저장 상태로 편집기를 열었습니다.",
      "success"
    );
  } catch (error) {
    setStatus(`편집기를 다시 열지 못했습니다: ${errorMessage(error)}`, "error", 0);
  } finally {
    recoveryOpenInProgress = false;
    item.classList.remove("is-opening");
    for (const button of item.querySelectorAll("button")) {
      button.disabled = (
        button.dataset.recoveryAction === "drafts"
        && Number(item.dataset.draftCount) === 0
      );
    }
  }
}

function assertOperationCurrent(generation: number): void {
  if (resetInProgress || generation !== stateGeneration) {
    throw new DOMException("초기화로 이전 작업이 취소되었습니다.", "AbortError");
  }
}

function markDirtyField(field: DirtyField, value: string | PanelDraft): void {
  dirtyFieldSequence += 1;
  dirtyFields.set(field, {
    version: dirtyFieldSequence,
    value: structuredClone(value)
  });
}

function mergeDirtyFields(latestState: unknown): PanelState {
  const merged = panelState(latestState);
  for (const [field, entry] of dirtyFields) {
    if (field === "projectName") {
      merged.projectName = String(entry.value);
    } else if (field === "globalInstruction") {
      merged.globalInstruction = String(entry.value);
    } else if (field === "streamerName") {
      merged.source.streamerName = String(entry.value);
    } else if (field === "broadcastTitle") {
      merged.source.broadcastTitle = String(entry.value);
    } else if (field === "draft") {
      merged.draft = structuredClone(entry.value as PanelDraft);
    }
  }
  return merged;
}

function stateSignature(value: unknown): string {
  const normalized = panelState(value);
  const { updatedAt: _updatedAt, ...stableState } = normalized;
  return JSON.stringify(stableState);
}

function persistState(
  { allowDuringReset = false }: { allowDuringReset?: boolean } = {}
): Promise<boolean> {
  const generation = stateGeneration;
  const dirtyVersions = new Map(
    [...dirtyFields].map(([field, entry]) => [field, entry.version])
  );
  if (resetInProgress && !allowDuringReset) {
    return Promise.resolve(false);
  }
  const signature = stateSignature(state);
  if (signature === lastPersistedStateSignature && dirtyFields.size === 0) {
    return Promise.resolve(false);
  }
  state.updatedAt = new Date().toISOString();
  const snapshot = structuredClone(state);
  const operation = persistenceChain
    .catch(() => {})
    .then(async () => {
      if (
        generation !== stateGeneration ||
        (resetInProgress && !allowDuringReset)
      ) {
        return false;
      }
      const expectedMeta = { ...workspaceMeta };
      const response = await sendRuntimeMessage({
        type: "KIRINUKI_PERSIST_STATE",
        state: snapshot,
        writerId: panelWriterId,
        expectedResetEpoch: expectedMeta.resetEpoch,
        expectedRevision: expectedMeta.revision
      });
      if (!response?.ok) {
        if (response?.workspaceMeta) {
          void queueWorkspaceSync(response.workspaceMeta);
        }
        throw new DOMException(
          response?.error || "프로젝트 상태를 저장하지 못했습니다.",
          response?.workspaceMeta ? "AbortError" : "OperationError"
        );
      }
      const responseMeta = normalizePanelWorkspaceMeta(response.workspaceMeta);
      const responseIsCurrent = (
        responseMeta.resetEpoch === workspaceMeta.resetEpoch &&
        responseMeta.revision >= workspaceMeta.revision
      );
      if (responseIsCurrent) {
        workspaceMeta = responseMeta;
        for (const [field, version] of dirtyVersions) {
          if (dirtyFields.get(field)?.version === version) {
            dirtyFields.delete(field);
          }
        }
        lastPersistedStateSignature = signature;
      }
      return true;
    });
  persistenceChain = operation;
  return operation;
}

function schedulePersist(): void {
  if (resetInProgress) {
    return;
  }
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    void persistState().catch((error) => {
      if (!isAbortError(error)) {
        setStatus(`저장 실패: ${errorMessage(error)}`, "error");
      }
    });
  }, 220);
}

async function loadState(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE_KEY, WORKSPACE_META_KEY]);
  state = panelState(stored[STORAGE_KEY]);
  workspaceMeta = normalizePanelWorkspaceMeta(stored[WORKSPACE_META_KEY]);
  lastPersistedStateSignature = stateSignature(state);
}

function queueWorkspaceSync(
  expectedMeta: unknown,
  { forceApply = false }: { forceApply?: boolean } = {}
): Promise<void> {
  const expected = normalizePanelWorkspaceMeta(expectedMeta);
  workspaceSyncChain = workspaceSyncChain
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.local.get([STORAGE_KEY, WORKSPACE_META_KEY]);
      const latestMeta = normalizePanelWorkspaceMeta(stored[WORKSPACE_META_KEY]);
      if (
        latestMeta.revision < expected.revision ||
        (
          latestMeta.revision === workspaceMeta.revision &&
          latestMeta.resetEpoch === workspaceMeta.resetEpoch
        )
      ) {
        return;
      }
      if (latestMeta.writerId === panelWriterId && !forceApply) {
        workspaceMeta = latestMeta;
        return;
      }

      const resetChanged = latestMeta.resetEpoch !== workspaceMeta.resetEpoch;
      workspaceMeta = latestMeta;
      stateGeneration += 1;
      contextRequestSequence += 1;
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
      saveTimer = null;
      if (resetChanged) {
        dirtyFields.clear();
      }
      const storedState = panelState(stored[STORAGE_KEY]);
      lastPersistedStateSignature = stateSignature(storedState);
      const preserveDirtyInput = !resetChanged && dirtyFields.size > 0;
      state = preserveDirtyInput ? mergeDirtyFields(storedState) : storedState;
      sourceConflict = currentContext
        ? captureStateSourceConflict(state, contextAsSource(currentContext))
        : false;
      lastPrompt = "";
      elements.promptResult.hidden = true;
      elements.promptPreview.value = "";
      syncStateToForm();
      renderSegments();
      renderSource();
      setStatus(
        resetChanged
          ? "다른 창에서 모든 로컬 작업을 초기화했습니다."
          : preserveDirtyInput
            ? "다른 창의 변경을 반영하고 현재 입력은 보존했습니다."
            : "다른 창의 최신 프로젝트 변경을 반영했습니다.",
        "info",
        6500
      );
      if (preserveDirtyInput) {
        schedulePersist();
      }
    });
  return workspaceSyncChain;
}

function handleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): void {
  if (areaName !== "local" || !changes[WORKSPACE_META_KEY]) {
    return;
  }
  const nextMeta = normalizePanelWorkspaceMeta(
    changes[WORKSPACE_META_KEY]?.newValue
  );
  const resetChanged = nextMeta.resetEpoch !== workspaceMeta.resetEpoch;
  if (
    nextMeta.revision < workspaceMeta.revision ||
    (
      nextMeta.revision === workspaceMeta.revision &&
      nextMeta.resetEpoch === workspaceMeta.resetEpoch
    )
  ) {
    return;
  }
  if (nextMeta.writerId === panelWriterId && !resetChanged) {
    workspaceMeta = nextMeta;
    return;
  }
  void queueWorkspaceSync(nextMeta, { forceApply: resetChanged });
}

async function loadMarkdown(path: string): Promise<string> {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) {
    throw new Error(`${path}를 불러오지 못했습니다 (${response.status}).`);
  }
  return response.text();
}

async function loadKnowledge(): Promise<void> {
  const [editingGuide, basePolicy, codexAgents, policyIndexText] = await Promise.all([
    loadMarkdown("knowledge/base-editing-guidelines.md"),
    loadMarkdown("knowledge/default-creator-policy.md"),
    loadMarkdown("knowledge/codex-job-agents.md"),
    loadMarkdown("knowledge/creator-policy-index.json")
  ]);
  const parsedIndex: unknown = JSON.parse(policyIndexText);
  if (
    !parsedIndex
    || typeof parsedIndex !== "object"
    || Array.isArray(parsedIndex)
    || !("policies" in parsedIndex)
    || !Array.isArray(parsedIndex.policies)
  ) {
    throw new Error("방송인 정책 인덱스 형식이 올바르지 않습니다.");
  }

  editingGuideMarkdown = editingGuide;
  creatorPolicyMarkdown = basePolicy;
  codexJobAgentsMarkdown = codexAgents;
  creatorPolicyIndex = { policies: parsedIndex.policies };
}

function currentPolicyBundle(
  streamerName = elements.streamerName.value.trim() || state.source.streamerName
): {
  resolvedPolicies: ResolvedCreatorPolicy[];
  compiledPolicyMarkdown: string;
} {
  const resolvedPolicies = resolveCreatorPolicies({ streamerName }, creatorPolicyIndex);
  const compiledPolicyMarkdown = compileCreatorPolicyMarkdown({
    basePolicyMarkdown: creatorPolicyMarkdown,
    resolvedPolicies
  });
  return { resolvedPolicies, compiledPolicyMarkdown };
}

function renderPolicyMatch(): void {
  if (!elements.policyMatchBadge) {
    return;
  }
  const { resolvedPolicies } = currentPolicyBundle();
  if (resolvedPolicies.length === 0) {
    elements.policyMatchBadge.textContent = "기본 MD 적용";
    elements.policyMatchBadge.title = "등록된 방송인 정책과 정확히 일치하지 않았습니다.";
    return;
  }

  const policy = resolvedPolicies[0];
  elements.policyMatchBadge.textContent = `${policy.group} · 링크 매칭`;
  elements.policyMatchBadge.title = `${policy.matchedBy.value} → ${policy.sourceUrl}`;
}

function syncStateToForm(): void {
  elements.projectName.value = state.projectName;
  elements.globalInstruction.value = state.globalInstruction;
  elements.streamerName.value = state.source.streamerName;
  elements.broadcastTitle.value = state.source.broadcastTitle;
  renderDraft();
  renderPolicyMatch();
}

function syncDraftFromForm(): void {
  state.draft.startText = elements.startTime.value;
  state.draft.endText = elements.endTime.value;
  state.draft.description = elements.segmentDescription.value;
}

function renderDraft(): void {
  elements.startTime.value = state.draft.startText;
  elements.endTime.value = state.draft.endText;
  elements.segmentDescription.value = state.draft.description;
  elements.descriptionCount.textContent = String(state.draft.description.length);
  const editing = Boolean(state.draft.editingId);
  elements.editingBadge.hidden = !editing;
  elements.cancelEdit.hidden = !editing;
  elements.saveSegment.textContent = editing ? "구간 수정 저장" : "구간 저장";
  if (editing) {
    elements.saveSegment.removeAttribute("aria-keyshortcuts");
    elements.saveSegment.title = "기존 구간을 바꾸는 동작이므로 단축키 없음";
  } else {
    const binding = SIDEPANEL_SHORTCUT_BINDINGS.find(
      (candidate) => candidate.targetId === "save-segment"
    );
    if (binding) {
      elements.saveSegment.setAttribute("aria-keyshortcuts", binding.key);
      elements.saveSegment.title = formatKeyboardShortcutHint(
        binding.label,
        binding.key
      );
    }
  }
}

function clearDraft(): void {
  state.draft = {
    startText: "",
    endText: "",
    description: "",
    startCapture: null,
    endCapture: null,
    editingId: null
  };
  renderDraft();
}

const PERSISTED_SOURCE_KEYS = [
  "platform",
  "url",
  "canonicalUrl",
  "channelId",
  "contentId",
  "contentType",
  "streamerName",
  "broadcastTitle",
  "broadcastStartedAt",
  "clipActive",
  "timeMachineActive",
  "category"
];

function samePersistedSource(
  left: SourceMetadata | null | undefined,
  right: SourceMetadata | null | undefined
): boolean {
  return PERSISTED_SOURCE_KEYS.every(
    (key) => Object.is(left?.[key], right?.[key])
  );
}

function sourceIdentity(source: SourceMetadata): string {
  return sourceSessionIdentity(source);
}

function contextAsSource(context: PageContext): PanelSource {
  return {
    platform: context.platform || "CHZZK",
    url: context.url || "",
    canonicalUrl: context.canonicalUrl || context.url || "",
    channelId: context.channelId || "",
    contentId: context.contentId || "",
    contentType: context.contentType || "unknown",
    streamerName: context.streamerName || state.source.streamerName || "",
    broadcastTitle: context.broadcastTitle || context.pageTitle || state.source.broadcastTitle || "",
    broadcastStartedAt: context.broadcastStartedAt || "",
    clipActive: typeof context.clipActive === "boolean" ? context.clipActive : null,
    timeMachineActive: typeof context.timeMachineActive === "boolean" ? context.timeMachineActive : null,
    category: context.category || "",
    observedAt: context.capturedAt || new Date().toISOString()
  };
}

function remapDraftCaptureSessionIdentity(
  capture: PanelCaptureDetails | null,
  previousIdentity: string,
  nextIdentity: string
): PanelCaptureDetails | null {
  if (
    !capture
    || !previousIdentity
    || !nextIdentity
    || previousIdentity === nextIdentity
    || capture.sourceSessionId !== previousIdentity
  ) {
    return capture;
  }
  return {
    ...capture,
    sourceSessionId: nextIdentity
  };
}

function applyContextToProject(context: PageContext): void {
  const nextSource = contextAsSource(context);
  const previousIdentity = sourceIdentity(state.source);
  const nextIdentity = sourceIdentity(nextSource);
  const sameSession = sameSourceSession(state.source, nextSource);
  sourceConflict = captureStateSourceConflict(state, nextSource);

  if (!sourceConflict) {
    const preserveStreamer = state.source.streamerName;
    const preserveTitle = state.source.broadcastTitle;
    const sourceChanged = Boolean(
      previousIdentity
      && nextIdentity
      && !sameSession
    );
    if (
      sameSession
      && previousIdentity
      && nextIdentity
      && previousIdentity !== nextIdentity
    ) {
      state.draft = {
        ...state.draft,
        startCapture: remapDraftCaptureSessionIdentity(
          state.draft.startCapture,
          previousIdentity,
          nextIdentity
        ),
        endCapture: remapDraftCaptureSessionIdentity(
          state.draft.endCapture,
          previousIdentity,
          nextIdentity
        )
      };
    }
    const candidateSource = {
      ...nextSource,
      streamerName: sourceChanged ? nextSource.streamerName : (preserveStreamer || nextSource.streamerName),
      broadcastTitle: sourceChanged ? nextSource.broadcastTitle : (preserveTitle || nextSource.broadcastTitle)
    };
    if (sourceChanged) {
      state.editorProjectId = "";
    }
    if (!sourceChanged && samePersistedSource(state.source, candidateSource)) {
      return;
    }
    state.source = candidateSource;
    elements.streamerName.value = state.source.streamerName;
    elements.broadcastTitle.value = state.source.broadcastTitle;
    renderPolicyMatch();
    schedulePersist();
  }
}

function setConnectionBadge(text: string, variant: string): void {
  elements.connectionBadge.textContent = text;
  elements.connectionBadge.className = `badge ${variant}`;
}

function renderPlayerControls(
  player: PagePlayerContext | null | undefined
): void {
  const currentRate = Number(player?.playbackRate);
  const available = Boolean(
    currentContext
    && player?.found
    && !player.adActive
    && !playerCommandInProgress
  );
  const controls: Array<[HTMLButtonElement, number]> = [
    [elements.playbackRateQuarter, 0.25],
    [elements.playbackRateDouble, 2]
  ];
  elements.seekBackwardFive.disabled = !available;
  elements.seekForwardFive.disabled = !available;
  for (const [button, rate] of controls) {
    button.disabled = !available;
    button.setAttribute(
      "aria-pressed",
      String(Number.isFinite(currentRate) && currentRate === rate)
    );
  }
}

function renderSource(): void {
  const context = currentContext;
  const connected = context !== null;
  elements.sourceEmpty.hidden = connected;
  elements.sourceDetails.hidden = !connected;
  renderPlayerControls(context?.player);

  if (!context) {
    setConnectionBadge("미연결", "badge-muted");
    return;
  }

  const type = String(context.contentType || "unknown").toUpperCase();
  const platformLabel = sourcePlatformLabel(context.platform);
  elements.sourceType.textContent = `${platformLabel} · ${type}`;
  elements.sourceType.className = `badge ${type === "LIVE" ? "badge-live" : "badge-vod"}`;

  const player = context.player ?? {};
  elements.playerPosition.textContent = Number.isFinite(player.positionSeconds)
    ? formatTimestamp(player.positionSeconds)
    : "--:--:--";
  elements.playerStatus.textContent = sourcePlayerStatusText(context);

  if (sourceConflict) {
    setConnectionBadge("다른 원본", "badge-policy");
    elements.playerStatus.textContent = "저장 구간과 다른 원본 · 초기화 후 기록 가능";
  } else {
    setConnectionBadge("연결됨", "badge-connected");
  }

  elements.sourceLink.href = context.canonicalUrl || context.url;
  elements.sourceLink.title = context.canonicalUrl || context.url;
}

async function getActiveSourceTab(): Promise<SourceTabWithId> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = selectSupportedSourceTab(tabs, {
    expectedSource: state.source
  });
  if (
    !tab?.id
    || !isSupportedSourceUrl(tab.url)
  ) {
    throw new SourceTabUnavailableError(
      "치지직·YouTube 영상 탭을 활성화하거나 저장된 원본 페이지를 다시 열어 주세요."
    );
  }
  return tab as SourceTabWithId;
}

async function requestPageContext(): Promise<PageContext> {
  const tab = await getActiveSourceTab();
  return requestPageContextFromTab(tab);
}

async function requestPageContextFromTab(
  tab: SourceTabWithId
): Promise<PageContext> {
  const response = await sendMessageToSourceTab(
    tab,
    { type: "KIRINUKI_GET_CONTEXT" }
  );

  if (!response?.ok) {
    throw new Error(response?.error || "영상 페이지 정보를 읽지 못했습니다.");
  }
  return {
    ...response.context,
    sourceTabId: tab.id
  } as PageContext;
}

async function sendMessageToSourceTab(
  tab: SourceTabWithId,
  message: Record<string, unknown>
): Promise<RuntimeResponse> {
  let response: RuntimeResponse;
  try {
    response = await chrome.tabs.sendMessage(
      tab.id,
      message
    ) as RuntimeResponse;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
    await wait(40);
    response = await chrome.tabs.sendMessage(
      tab.id,
      message
    ) as RuntimeResponse;
  }
  return response;
}

function reserveSourceClockOperation(): SerialOperationReservation {
  return sourceClockOperationGate.reserve();
}

async function setSourcePlaybackRate(playbackRate: 0.25 | 2): Promise<void> {
  if (resetInProgress || playerCommandInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  const sourceClockOperation = reserveSourceClockOperation();
  playerCommandInProgress = true;
  renderSource();
  try {
    await sourceClockOperation.waitForTurn;
    assertOperationCurrent(operationGeneration);
    const tab = await getActiveSourceTab();
    const message = {
      type: "KIRINUKI_PLAYER_COMMAND",
      action: "set-playback-rate",
      playbackRate
    };
    const response = await sendMessageToSourceTab(tab, message);
    assertOperationCurrent(operationGeneration);
    if (!response?.ok) {
      throw new Error(response?.error || "원본 재생 속도를 바꾸지 못했습니다.");
    }
    if (
      currentContext
      && (
        !currentContext.sourceTabId
        || currentContext.sourceTabId === tab.id
      )
    ) {
      currentContext = {
        ...currentContext,
        player: {
          ...(currentContext.player || {}),
          playbackRate: Number(response.player?.playbackRate) || playbackRate
        }
      };
    }
    setStatus(`원본 플레이어를 ${playbackRate}배속으로 바꿨습니다.`, "success");
  } catch (error) {
    if (!isAbortError(error)) {
      setStatus(errorMessage(error), "error");
    }
  } finally {
    playerCommandInProgress = false;
    sourceClockOperation.release();
    renderSource();
  }
}

async function seekSourceBy(deltaSeconds: -5 | 5): Promise<void> {
  if (resetInProgress || playerCommandInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  const sourceClockOperation = reserveSourceClockOperation();
  playerCommandInProgress = true;
  renderSource();
  try {
    await sourceClockOperation.waitForTurn;
    assertOperationCurrent(operationGeneration);
    // Any context request that began before the seek must not repaint the
    // pre-seek position after the player has already moved.
    contextRequestSequence += 1;
    const tab = await getActiveSourceTab();
    const response = await sendMessageToSourceTab(tab, {
      type: "KIRINUKI_PLAYER_COMMAND",
      action: "seek-relative",
      deltaSeconds
    });
    assertOperationCurrent(operationGeneration);
    if (!response?.ok) {
      throw new Error(response?.error || "원본 플레이어 위치를 옮기지 못했습니다.");
    }
    const mediaTime = Number(response.player?.currentTime);
    if (
      Number.isFinite(mediaTime)
      && currentContext
      && (
        !currentContext.sourceTabId
        || currentContext.sourceTabId === tab.id
      )
    ) {
      const previousPlayer = currentContext.player || {};
      const previousPosition = Number(previousPlayer.positionSeconds);
      const previousRawPosition = Number(
        previousPlayer.rawMediaPositionSeconds
      );
      const previousLiveEdgeOffset = Number(
        previousPlayer.liveEdgeOffsetSeconds
      );
      const chzzkLiveMediaDelta = (
        currentContext.platform === SOURCE_PLATFORM_CHZZK
        && currentContext.contentType === "live"
        && Number.isFinite(previousPosition)
        && Number.isFinite(previousRawPosition)
      )
        ? mediaTime - previousRawPosition
        : null;
      currentContext = {
        ...currentContext,
        player: {
          ...previousPlayer,
          positionSeconds: chzzkLiveMediaDelta === null
            ? mediaTime
            : Math.max(0, previousPosition + chzzkLiveMediaDelta),
          rawMediaPositionSeconds: chzzkLiveMediaDelta === null
            ? previousPlayer.rawMediaPositionSeconds
            : mediaTime,
          liveEdgeOffsetSeconds: (
            chzzkLiveMediaDelta !== null
            && Number.isFinite(previousLiveEdgeOffset)
          )
            ? Math.max(0, previousLiveEdgeOffset - chzzkLiveMediaDelta)
            : previousPlayer.liveEdgeOffsetSeconds
        }
      };
      renderSource();
    }
    void refreshSourceTabAfterPlayerCommand(
      tab,
      operationGeneration
    );
    setStatus(
      `원본 영상을 5초 ${deltaSeconds < 0 ? "뒤로" : "앞으로"} 이동했습니다.`,
      "success"
    );
  } catch (error) {
    if (!isAbortError(error)) {
      setStatus(errorMessage(error), "error");
    }
  } finally {
    playerCommandInProgress = false;
    sourceClockOperation.release();
    renderSource();
  }
}

async function refreshSourceTabAfterPlayerCommand(
  tab: SourceTabWithId,
  operationGeneration: number
): Promise<void> {
  const requestSequence = ++contextRequestSequence;
  try {
    const context = await requestPageContextFromTab(tab);
    if (
      requestSequence !== contextRequestSequence
      || resetInProgress
      || operationGeneration !== stateGeneration
    ) {
      return;
    }
    currentContext = context;
    applyContextToProject(context);
    renderSource();
  } catch {
    // The seek itself already succeeded. A later poll or foreground capture
    // will retry transient navigation/content-script context failures.
  }
}

async function requestLatestPageContext(): Promise<PageContext> {
  const requestSequence = ++contextRequestSequence;
  try {
    const context = await requestPageContext();
    if (requestSequence !== contextRequestSequence) {
      throw new DOMException("현재 탭 정보가 갱신되었습니다. 다시 시도해 주세요.", "AbortError");
    }
    return context;
  } catch (error) {
    if (requestSequence !== contextRequestSequence) {
      throw new DOMException("현재 탭 정보가 갱신되었습니다. 다시 시도해 주세요.", "AbortError");
    }
    throw error;
  }
}

async function requestForegroundPageContext(): Promise<PageContext> {
  foregroundContextRequestCount += 1;
  try {
    return await requestLatestPageContext();
  } finally {
    foregroundContextRequestCount = Math.max(
      0,
      foregroundContextRequestCount - 1
    );
  }
}

async function refreshSource(
  { silent = false }: { silent?: boolean } = {}
): Promise<void> {
  if (
    resetInProgress
    || playerCommandInProgress
    || !canStartSourceRefresh({
      silent,
      foregroundRequestCount: foregroundContextRequestCount,
      backgroundRequestCount: sourceRefreshRequestCount
    })
  ) {
    return;
  }
  sourceRefreshRequestCount += 1;
  try {
    currentContext = await requestLatestPageContext();
    applyContextToProject(currentContext);
    renderSource();
    if (!silent) {
      setStatus("현재 영상 탭과 플레이어 정보를 읽었습니다.", "success");
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    const failureAction = sourceRefreshFailureAction({
      silent,
      hasCurrentContext: Boolean(currentContext),
      sourceUnavailable: error instanceof SourceTabUnavailableError
    });
    if (failureAction === "clear") {
      currentContext = null;
      sourceConflict = false;
      renderSource();
    }
    if (!silent) {
      setStatus(errorMessage(error), "error");
    }
  } finally {
    sourceRefreshRequestCount = Math.max(0, sourceRefreshRequestCount - 1);
  }
}

async function captureCurrentPosition(kind: "start" | "end"): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  const sourceClockOperation = reserveSourceClockOperation();
  const button = kind === "start" ? elements.captureStart : elements.captureEnd;
  button.disabled = true;
  try {
    await sourceClockOperation.waitForTurn;
    assertOperationCurrent(operationGeneration);
    const context = await requestForegroundPageContext();
    assertOperationCurrent(operationGeneration);
    currentContext = context;
    applyContextToProject(context);
    renderSource();
    if (sourceConflict) {
      throw new Error("기존 구간과 다른 원본 영상입니다. 모든 로컬 작업을 초기화한 뒤 기록해 주세요.");
    }
    if (
      context.platform === SOURCE_PLATFORM_YOUTUBE
      && context.contentType === "live"
    ) {
      throw new Error("진행 중인 YouTube 라이브는 지원하지 않습니다. 다시보기 영상에서 스탬프를 찍어 주세요.");
    }
    if (context.player?.adActive) {
      throw new Error("YouTube 광고 재생 중에는 스탬프를 기록하지 않습니다. 본 영상이 시작된 뒤 다시 눌러 주세요.");
    }

    const position = context.player?.positionSeconds;
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
      throw new Error("현재 플레이어 시각을 읽을 수 없습니다. 재생을 시작하거나 시각을 직접 입력해 주세요.");
    }

    const rounded = Math.round(position * 1000) / 1000;
    const capture = {
      method: context.player?.positionSource,
      confidence: context.player?.confidence,
      rawSeconds: position,
      rawMediaSeconds: context.player?.rawMediaPositionSeconds,
      observedAt: context.capturedAt,
      liveEdgeOffsetSeconds: context.player?.liveEdgeOffsetSeconds,
      broadcastStartedAt: context.broadcastStartedAt,
      pageUrl: context.canonicalUrl || context.url,
      sourceSessionId: sourceIdentity(contextAsSource(context))
    };

    if (kind === "start") {
      state.draft.startText = formatTimestamp(rounded, { precision: 3 });
      state.draft.startCapture = capture;
    } else {
      state.draft.endText = formatTimestamp(rounded, { precision: 3 });
      state.draft.endCapture = capture;
    }
    markDirtyField("draft", state.draft);
    renderDraft();
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus(`${kind === "start" ? "시작" : "끝"} 스탬프를 ${formatTimestamp(rounded, { precision: 3 })}로 기록했습니다.`, "success");
    if (kind === "end") {
      elements.segmentDescription.focus();
    }
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error");
    }
  } finally {
    sourceClockOperation.release();
    button.disabled = resetInProgress;
  }
}

function captureOriginLabel(segment: EditSegment): string {
  const start = segment.startCapture ? "현재 시각" : "직접 입력";
  const end = segment.endCapture ? "현재 시각" : "직접 입력";
  return `시작 ${start} · 끝 ${end}`;
}

function renderSegments(): void {
  elements.segmentCount.textContent = String(state.segments.length);
  elements.segmentsEmpty.hidden = state.segments.length > 0;
  elements.segmentsList.replaceChildren();

  state.segments.forEach((segment, index) => {
    const fragment = elements.segmentTemplate.content.cloneNode(
      true
    ) as DocumentFragment;
    const item = requiredDescendant<HTMLElement>(fragment, ".segment-item");
    item.dataset.id = segment.id;
    item.classList.toggle("is-editing", state.draft.editingId === segment.id);
    requiredDescendant<HTMLElement>(
      fragment,
      ".segment-number"
    ).textContent = String(index + 1);
    requiredDescendant<HTMLElement>(
      fragment,
      ".segment-time"
    ).textContent = `${formatTimestamp(segment.startSeconds, { precision: 3 })} → ${formatTimestamp(segment.endSeconds, { precision: 3 })}`;
    requiredDescendant<HTMLElement>(
      fragment,
      ".segment-duration"
    ).textContent = `${(segment.endSeconds - segment.startSeconds).toFixed(3)}초`;
    requiredDescendant<HTMLElement>(
      fragment,
      ".segment-description"
    ).textContent = segment.description;
    requiredDescendant<HTMLElement>(
      fragment,
      ".segment-origin"
    ).textContent = captureOriginLabel(segment);

    const up = requiredDescendant<HTMLButtonElement>(
      fragment,
      "[data-action='up']"
    );
    const down = requiredDescendant<HTMLButtonElement>(
      fragment,
      "[data-action='down']"
    );
    up.disabled = index === 0;
    down.disabled = index === state.segments.length - 1;
    elements.segmentsList.append(fragment);
  });
}

async function saveSegment(): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  if (sourceConflict) {
    setStatus("기존 구간과 다른 원본 영상입니다. 모든 로컬 작업을 초기화한 뒤 기록해 주세요.", "error", 0);
    return;
  }
  syncDraftFromForm();
  const validation = validateSegmentInput(state.draft);
  if (!validation.ok) {
    setStatus(validation.message, "error");
    return;
  }

  try {
    const expectedSessionId = sourceIdentity(state.source);
    const capturedSessionIds = [
      state.draft.startCapture?.sourceSessionId,
      state.draft.endCapture?.sourceSessionId
    ].filter(Boolean);
    if (
      expectedSessionId &&
      capturedSessionIds.some((sessionId) => sessionId !== expectedSessionId)
    ) {
      throw new Error("시작과 끝이 서로 다른 원본 영상에서 기록되었습니다. 구간을 다시 찍어 주세요.");
    }
    const editingIndex = state.draft.editingId
      ? state.segments.findIndex((segment) => segment.id === state.draft.editingId)
      : -1;
    const existing = editingIndex >= 0 ? state.segments[editingIndex] : null;
    const segment = createSegment({
      id: existing?.id,
      startText: state.draft.startText,
      endText: state.draft.endText,
      description: state.draft.description,
      startCapture: state.draft.startCapture,
      endCapture: state.draft.endCapture,
      createdAt: existing?.createdAt
    });
    segment.updatedAt = new Date().toISOString();

    if (editingIndex >= 0) {
      state.segments.splice(editingIndex, 1, segment);
    } else {
      state.segments.push(segment);
    }
    clearDraft();
    renderSegments();
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus(editingIndex >= 0 ? "구간을 수정했습니다." : "관심 구간을 저장했습니다.", "success");
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error");
    }
  }
}

function startEditingSegment(id: string): void {
  const segment = state.segments.find((candidate) => candidate.id === id);
  if (!segment) {
    return;
  }
  state.draft = {
    startText: formatTimestamp(segment.startSeconds, { precision: 3 }),
    endText: formatTimestamp(segment.endSeconds, { precision: 3 }),
    description: segment.description,
    startCapture: segment.startCapture as PanelCaptureDetails | null,
    endCapture: segment.endCapture as PanelCaptureDetails | null,
    editingId: segment.id
  };
  markDirtyField("draft", state.draft);
  renderDraft();
  renderSegments();
  schedulePersist();
  elements.captureCard.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.segmentDescription.focus({ preventScroll: true });
}

async function deleteSegment(id: string): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  const index = state.segments.findIndex((segment) => segment.id === id);
  if (index < 0) {
    return;
  }
  if (!confirm(`구간 ${index + 1}을 삭제할까요?`)) {
    return;
  }
  state.segments.splice(index, 1);
  if (state.draft.editingId === id) {
    clearDraft();
  }
  renderSegments();
  try {
    await persistState();
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus("구간을 삭제했습니다.", "success");
    }
  } catch (error) {
    if (
      !isAbortError(error) &&
      !resetInProgress &&
      operationGeneration === stateGeneration
    ) {
      setStatus(`구간을 삭제하지 못했습니다: ${errorMessage(error)}`, "error");
    }
  }
}

async function moveSegment(id: string, direction: -1 | 1): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  const index = state.segments.findIndex((segment) => segment.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.segments.length) {
    return;
  }
  [state.segments[index], state.segments[nextIndex]] = [state.segments[nextIndex], state.segments[index]];
  renderSegments();
  try {
    await persistState();
  } catch (error) {
    if (
      !isAbortError(error) &&
      !resetInProgress &&
      operationGeneration === stateGeneration
    ) {
      setStatus(`구간 순서를 저장하지 못했습니다: ${errorMessage(error)}`, "error");
    }
  }
}

function createPromptBundle(generatedAt = new Date().toISOString()): {
  prompt: string;
  resolvedPolicies: ResolvedCreatorPolicy[];
  compiledPolicyMarkdown: string;
} {
  state.projectName = elements.projectName.value.trim();
  state.globalInstruction = elements.globalInstruction.value.trim();
  state.source.streamerName = elements.streamerName.value.trim();
  state.source.broadcastTitle = elements.broadcastTitle.value.trim();

  if (!editingGuideMarkdown || !creatorPolicyMarkdown || !codexJobAgentsMarkdown) {
    throw new Error("내장 MD 지침을 불러오지 못했습니다. Extension을 다시 로드해 주세요.");
  }

  const policyBundle = currentPolicyBundle(state.source.streamerName);
  const prompt = generateEditPrompt({
    projectName: state.projectName,
    source: state.source,
    globalInstruction: state.globalInstruction,
    segments: state.segments,
    editingGuideMarkdown,
    creatorPolicyMarkdown: policyBundle.compiledPolicyMarkdown,
    resolvedCreatorPolicies: policyBundle.resolvedPolicies,
    generatedAt
  });
  return { prompt, ...policyBundle };
}

function createPrompt(generatedAt = new Date().toISOString()): string {
  return createPromptBundle(generatedAt).prompt;
}

function showPrompt(prompt: string): void {
  lastPrompt = prompt;
  elements.promptPreview.value = lastPrompt;
  elements.promptCharacterCount.textContent = lastPrompt.length.toLocaleString("ko-KR");
  elements.promptResult.hidden = false;
}

async function generatePrompt(): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  try {
    showPrompt(createPrompt());
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus("Codex용 uniform 프롬프트를 생성했습니다.", "success");
    elements.promptPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error");
    }
  }
}

async function writeTextFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  contents: string
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

function codexJobFolderName(generatedAt: string): string {
  const baseName = state.projectName || [state.source.streamerName, state.source.broadcastTitle].filter(Boolean).join("-");
  const compactTimestamp = generatedAt.replace(/\D/g, "").slice(0, 17);
  return `${sanitizeFileName(baseName, "chzzk-kirinuki-job")}-${compactTimestamp}`;
}

async function createCodexJobFolder(): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  if (typeof window.showDirectoryPicker !== "function") {
    setStatus("이 브라우저는 작업폴더 저장을 지원하지 않습니다. MD 다운로드를 사용해 주세요.", "error", 0);
    return;
  }

  const generatedAt = new Date().toISOString();
  let prompt: string;
  let manifest: ReturnType<typeof buildCodexJobManifest>;
  let startHere: string;
  let compiledPolicyMarkdown: string;
  try {
    const promptBundle = createPromptBundle(generatedAt);
    prompt = promptBundle.prompt;
    compiledPolicyMarkdown = promptBundle.compiledPolicyMarkdown;
    manifest = buildCodexJobManifest({
      projectName: state.projectName,
      source: state.source,
      globalInstruction: state.globalInstruction,
      segments: state.segments,
      resolvedCreatorPolicies: promptBundle.resolvedPolicies,
      generatedAt
    });
    startHere = generateCodexStartHere({
      projectName: state.projectName,
      source: state.source,
      generatedAt
    });
  } catch (error) {
    setStatus(errorMessage(error), "error");
    return;
  }

  let parentDirectory: FileSystemDirectoryHandle;
  try {
    parentDirectory = await window.showDirectoryPicker!({
      id: "chzzk-kirinuki-codex-jobs",
      mode: "readwrite"
    });
    assertOperationCurrent(operationGeneration);
  } catch (error) {
    if (
      !isAbortError(error) &&
      !resetInProgress &&
      operationGeneration === stateGeneration
    ) {
      setStatus(`폴더를 열지 못했습니다: ${errorMessage(error)}`, "error");
    }
    return;
  }

  elements.createCodexJob.disabled = true;
  try {
    const folderName = codexJobFolderName(generatedAt);
    const jobDirectory = await parentDirectory.getDirectoryHandle(folderName, { create: true });
    assertOperationCurrent(operationGeneration);
    await Promise.all([
      writeTextFile(jobDirectory, "edit-brief.md", prompt),
      writeTextFile(jobDirectory, "creator-policy.md", compiledPolicyMarkdown),
      writeTextFile(jobDirectory, "creator-policy-index.json", `${JSON.stringify(creatorPolicyIndex, null, 2)}\n`),
      writeTextFile(jobDirectory, "AGENTS.md", codexJobAgentsMarkdown),
      writeTextFile(jobDirectory, "START_HERE.md", startHere),
      writeTextFile(jobDirectory, "job-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`)
    ]);
    assertOperationCurrent(operationGeneration);
    showPrompt(prompt);
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus(`${folderName} 작업폴더를 만들었습니다. 풀영상 하나를 넣고 START_HERE.md를 따라가세요.`, "success", 8_000);
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(`작업폴더를 만들지 못했습니다: ${errorMessage(error)}`, "error", 0);
    }
  } finally {
    elements.createCodexJob.disabled = resetInProgress;
  }
}

async function openIntegratedEditor(): Promise<void> {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  syncDraftFromForm();
  state.projectName = elements.projectName.value.trim();
  state.globalInstruction = elements.globalInstruction.value.trim();
  state.source.streamerName = elements.streamerName.value.trim();
  state.source.broadcastTitle = elements.broadcastTitle.value.trim();
  if (state.segments.length === 0) {
    setStatus("편집기로 넘길 구간을 하나 이상 저장해 주세요.", "error");
    return;
  }

  elements.openEditor.disabled = true;
  try {
    const context = await requestForegroundPageContext();
    assertOperationCurrent(operationGeneration);
    currentContext = context;
    applyContextToProject(context);
    renderSource();
    const activeSource = contextAsSource(context);
    if (
      sourceConflict ||
      !sameSourceSession(state.source, activeSource)
    ) {
      throw new Error("저장 구간과 현재 영상 탭의 원본이 다릅니다. 원래 영상 탭에서 다시 열어 주세요.");
    }
    if (!state.editorProjectId) {
      state.editorProjectId = `project-${crypto.randomUUID()}`;
    }
    await persistState();
    assertOperationCurrent(operationGeneration);
    const projectId = state.editorProjectId;
    const response = await sendRuntimeMessage({
      type: "KIRINUKI_OPEN_EDITOR",
      projectId,
      sourceTabId: context.sourceTabId,
      captureState: state,
      expectedResetEpoch: workspaceMeta.resetEpoch,
      expectedRevision: workspaceMeta.revision
    });
    if (!response?.ok) {
      if (response?.workspaceMeta) {
        void queueWorkspaceSync(response.workspaceMeta);
      }
      throw new Error(response?.error || "통합 편집기를 열지 못했습니다.");
    }
    assertOperationCurrent(operationGeneration);
    setStatus("선택 구간을 통합 편집기로 넘겼습니다.", "success");
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error", 0);
    }
  } finally {
    elements.openEditor.disabled = resetInProgress;
  }
}

async function copyPrompt(): Promise<void> {
  if (!lastPrompt) {
    return;
  }
  try {
    await navigator.clipboard.writeText(lastPrompt);
    setStatus("프롬프트를 클립보드에 복사했습니다.", "success");
  } catch (error) {
    setStatus(`복사하지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

function downloadPrompt(): void {
  if (!lastPrompt) {
    return;
  }
  const baseName = state.projectName || [state.source.streamerName, state.source.broadcastTitle].filter(Boolean).join("-");
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const fileName = `${sanitizeFileName(baseName)}-${date}.md`;
  const url = URL.createObjectURL(new Blob([lastPrompt], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  setStatus(`${fileName} 파일을 만들었습니다.`, "success");
}

function lockControlsForReset(): void {
  document.body.inert = true;
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("button, input, textarea, select")) {
    control.disabled = true;
  }
}

function restoreControlsAfterReset(): void {
  document.body.inert = false;
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("button, input, textarea, select")) {
    control.disabled = false;
  }
  renderSegments();
}

async function resetProject(): Promise<void> {
  if (resetInProgress) {
    return;
  }
  if (!confirm("열린 통합 편집기를 닫고 저장된 모든 구간·프로젝트·임시저장·원본 파일 권한을 초기화할까요? 디스크의 원본 영상과 이미 내보낸 파일은 삭제하지 않습니다.")) {
    return;
  }
  resetInProgress = true;
  stateGeneration += 1;
  contextRequestSequence += 1;
  dirtyFields.clear();
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = null;
  lockControlsForReset();
  try {
    await persistenceChain.catch(() => {});
    const response = await sendRuntimeMessage({
      type: "KIRINUKI_RESET_BINDINGS",
      writerId: panelWriterId
    });
    if (!response?.ok) {
      throw new Error(response?.error || "영상 탭 연결 정보를 지우지 못했습니다.");
    }
    await loadState();
    sourceConflict = false;
    lastPrompt = "";
    elements.promptResult.hidden = true;
    elements.promptPreview.value = "";
    syncStateToForm();
    renderSegments();
    if (currentContext) {
      applyContextToProject(currentContext);
    }
    renderSource();
    await persistState({ allowDuringReset: true });
    const cleanupErrors = Array.isArray(response.cleanupErrors) ? response.cleanupErrors : [];
    if (cleanupErrors.length > 0) {
      setStatus(
        `프로젝트 상태는 초기화했지만 일부 정리가 남았습니다: ${cleanupErrors.join(" · ")} 다시 초기화해 주세요.`,
        "error",
        0
      );
    } else {
      setStatus("구간·편집 프로젝트·임시저장·원본 파일 권한을 초기화했습니다.", "success", 6500);
    }
  } catch (error) {
    setStatus(`프로젝트를 완전히 초기화하지 못했습니다: ${errorMessage(error)}`, "error", 0);
  } finally {
    resetInProgress = false;
    restoreControlsAfterReset();
  }
}

function bindInputPersistence(): void {
  elements.projectName.addEventListener("input", () => {
    state.projectName = elements.projectName.value;
    markDirtyField("projectName", state.projectName);
    schedulePersist();
  });
  elements.globalInstruction.addEventListener("input", () => {
    state.globalInstruction = elements.globalInstruction.value;
    markDirtyField("globalInstruction", state.globalInstruction);
    schedulePersist();
  });
  elements.streamerName.addEventListener("input", () => {
    state.source.streamerName = elements.streamerName.value;
    markDirtyField("streamerName", state.source.streamerName);
    renderPolicyMatch();
    schedulePersist();
  });
  elements.broadcastTitle.addEventListener("input", () => {
    state.source.broadcastTitle = elements.broadcastTitle.value;
    markDirtyField("broadcastTitle", state.source.broadcastTitle);
    schedulePersist();
  });
  elements.startTime.addEventListener("input", () => {
    state.draft.startText = elements.startTime.value;
    if (
      state.draft.startCapture &&
      Math.abs((parseTimestamp(elements.startTime.value) ?? -1) - state.draft.startCapture.rawSeconds) > 0.001
    ) {
      state.draft.startCapture = null;
    }
    markDirtyField("draft", state.draft);
    schedulePersist();
  });
  elements.endTime.addEventListener("input", () => {
    state.draft.endText = elements.endTime.value;
    if (
      state.draft.endCapture &&
      Math.abs((parseTimestamp(elements.endTime.value) ?? -1) - state.draft.endCapture.rawSeconds) > 0.001
    ) {
      state.draft.endCapture = null;
    }
    markDirtyField("draft", state.draft);
    schedulePersist();
  });
  elements.segmentDescription.addEventListener("input", () => {
    state.draft.description = elements.segmentDescription.value;
    markDirtyField("draft", state.draft);
    elements.descriptionCount.textContent = String(elements.segmentDescription.value.length);
    schedulePersist();
  });
}

function bindActions(): void {
  elements.refreshRecoverySessions.addEventListener(
    "click",
    () => void refreshRecoverySessions()
  );
  elements.recoverySessionsList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest<HTMLButtonElement>(
      "button[data-recovery-action]"
    );
    const item = event.target.closest<HTMLElement>(".recovery-session");
    const projectId = item?.dataset.projectId;
    if (!button || !item || !projectId || button.disabled) {
      return;
    }
    void openSavedEditor(projectId, {
      recoveryDrafts: button.dataset.recoveryAction === "drafts"
    });
  });
  elements.refreshSource.addEventListener("click", () => void refreshSource());
  elements.playbackRateQuarter.addEventListener(
    "click",
    () => void setSourcePlaybackRate(0.25)
  );
  elements.playbackRateDouble.addEventListener(
    "click",
    () => void setSourcePlaybackRate(2)
  );
  elements.seekBackwardFive.addEventListener(
    "click",
    () => void seekSourceBy(-5)
  );
  elements.seekForwardFive.addEventListener(
    "click",
    () => void seekSourceBy(5)
  );
  elements.captureStart.addEventListener("click", () => void captureCurrentPosition("start"));
  elements.captureEnd.addEventListener("click", () => void captureCurrentPosition("end"));
  elements.saveSegment.addEventListener("click", () => void saveSegment());
  elements.cancelEdit.addEventListener("click", () => {
    clearDraft();
    markDirtyField("draft", state.draft);
    renderSegments();
    schedulePersist();
  });
  elements.segmentsList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button[data-action]");
    const item = event.target.closest<HTMLElement>(".segment-item");
    if (!button || !item) {
      return;
    }
    const { id } = item.dataset;
    const action = button.dataset.action;
    if (!id) {
      return;
    }
    if (action === "edit") {
      startEditingSegment(id);
    } else if (action === "delete") {
      void deleteSegment(id);
    } else if (action === "up") {
      void moveSegment(id, -1);
    } else if (action === "down") {
      void moveSegment(id, 1);
    }
  });
  elements.generatePrompt.addEventListener("click", () => void generatePrompt());
  elements.openEditor.addEventListener("click", () => void openIntegratedEditor());
  elements.createCodexJob.addEventListener("click", () => void createCodexJobFolder());
  elements.copyPrompt.addEventListener("click", () => void copyPrompt());
  elements.downloadPrompt.addEventListener("click", downloadPrompt);
  elements.closePreview.addEventListener("click", () => {
    elements.promptResult.hidden = true;
  });
  elements.resetProject.addEventListener("click", () => void resetProject());
}

async function initialize(): Promise<void> {
  installShortcutHints();
  bindKeyboardShortcuts();
  bindInputPersistence();
  bindActions();
  const recoveryLoad = refreshRecoverySessions();
  try {
    await Promise.all([loadState(), loadKnowledge()]);
    syncStateToForm();
    renderSegments();
    renderSource();
    await refreshSource({ silent: true });
  } catch (error) {
    setStatus(`Extension 초기화 실패: ${errorMessage(error)}`, "error", 0);
  }
  await recoveryLoad;

  refreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      void refreshSource({ silent: true });
    }
  }, 4_000);
}

window.addEventListener("beforeunload", () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  void persistState().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    void persistState().catch((error) => {
      if (!isAbortError(error)) {
        setStatus(`저장 실패: ${errorMessage(error)}`, "error");
      }
    });
  } else {
    void refreshRecoverySessions({ silent: true });
  }
});

chrome.storage.onChanged.addListener(handleStorageChange);

void initialize();
