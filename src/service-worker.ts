import {
  STORAGE_KEY,
  WORKSPACE_META_KEY,
  createInitialState,
  normalizeWorkspaceMeta
} from "./lib/core.js";
import {
  EDITOR_DATABASE_NAME,
  EDITOR_SEED_PREFIX,
  sameSourceSession,
  sourceSessionIdentity
} from "./lib/editor-core.js";
import {
  isSupportedSourceUrl,
  sourcePlatformFromUrl
} from "./lib/source-platform.js";
import {
  buildRecoverySessionSummaries,
  buildSavedEditorUrl,
  editorTabMatchesProject
} from "./lib/session-recovery.js";

const BINDINGS_KEY = "chzzkKirinukiSourceBindingsV1";
const LEGACY_TRANSFORMERS_CACHE_NAME = "transformers-cache";
const EDITOR_PROJECTS_STORE = "projects";
const EDITOR_LOCAL_DRAFTS_STORE = "local-drafts";
let workspaceOperationQueue: Promise<unknown> = Promise.resolve();

type UnknownRecord = Record<string, unknown>;

interface CaptureState extends UnknownRecord {
  source?: UnknownRecord | null;
}

interface SourceBinding {
  projectId: string;
  sourceTabId: number;
  sourceIdentity: UnknownRecord | null;
  sourceSessionId: string;
  boundAt: string;
}

type SourceBindingCandidate = Pick<
  SourceBinding,
  "sourceTabId" | "sourceIdentity" | "sourceSessionId"
>;

interface RuntimeMessage extends UnknownRecord {
  type?: string;
  projectId?: string;
  sourceTabId?: number;
  captureState?: CaptureState;
  expectedResetEpoch?: unknown;
  expectedRevision?: unknown;
  writerId?: string;
  state?: UnknownRecord;
  recovery?: string;
  action?: string;
  sourceSeconds?: number;
}

interface RecoveryRecords {
  projects: UnknownRecord[];
  drafts: UnknownRecord[];
}

class WorkspaceConflictError extends Error {
  workspaceMeta: ReturnType<typeof normalizeWorkspaceMeta>;

  constructor(
    message: string,
    workspaceMeta: ReturnType<typeof normalizeWorkspaceMeta>
  ) {
    super(message);
    this.name = "WorkspaceConflictError";
    this.workspaceMeta = workspaceMeta;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function queueWorkspaceOperation<T>(
  operation: () => T | PromiseLike<T>
): Promise<T> {
  const result = workspaceOperationQueue.then(operation, operation);
  workspaceOperationQueue = result.catch(() => {});
  return result;
}

const enableActionSidePanel = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("사이드패널 동작을 설정하지 못했습니다.", error);
  }
};

async function purgeLegacyLocalAsrCache() {
  try {
    await caches.delete(LEGACY_TRANSFORMERS_CACHE_NAME);
  } catch (error) {
    console.warn("이전 로컬 음성인식 모델 캐시를 정리하지 못했습니다.", error);
  }
}

async function initializeExtensionRuntime() {
  await Promise.all([
    enableActionSidePanel(),
    purgeLegacyLocalAsrCache()
  ]);
}

async function readBindings() {
  const stored = await chrome.storage.session.get(BINDINGS_KEY);
  return stored[BINDINGS_KEY] && typeof stored[BINDINGS_KEY] === "object"
    ? stored[BINDINGS_KEY] as Record<string, SourceBinding>
    : {} as Record<string, SourceBinding>;
}

async function writeBindings(
  bindings: Record<string, SourceBinding>
): Promise<void> {
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
}

async function readWorkspaceMeta() {
  const stored = await chrome.storage.local.get(WORKSPACE_META_KEY);
  return normalizeWorkspaceMeta(
    stored[WORKSPACE_META_KEY] as Parameters<typeof normalizeWorkspaceMeta>[0]
  );
}

function workspaceConflict(
  message: string,
  workspaceMeta: ReturnType<typeof normalizeWorkspaceMeta>
): WorkspaceConflictError {
  return new WorkspaceConflictError(message, workspaceMeta);
}

async function assertWorkspaceVersion(message: RuntimeMessage) {
  const workspaceMeta = await readWorkspaceMeta();
  if (
    message.expectedResetEpoch !== workspaceMeta.resetEpoch ||
    message.expectedRevision !== workspaceMeta.revision
  ) {
    throw workspaceConflict(
      "다른 창에서 프로젝트가 변경되었습니다. 최신 상태를 반영한 뒤 다시 시도해 주세요.",
      workspaceMeta
    );
  }
  return workspaceMeta;
}

async function persistWorkspaceState(message: RuntimeMessage) {
  if (!message.state || typeof message.state !== "object" || !message.writerId) {
    throw new Error("저장할 프로젝트 정보가 올바르지 않습니다.");
  }
  const currentMeta = await assertWorkspaceVersion(message);
  const workspaceMeta = {
    resetEpoch: currentMeta.resetEpoch,
    revision: currentMeta.revision + 1,
    writerId: message.writerId
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: message.state,
    [WORKSPACE_META_KEY]: workspaceMeta
  });
  return workspaceMeta;
}

async function bindProjectToSource(
  projectId: string,
  sourceTabId: number,
  captureState: CaptureState
): Promise<void> {
  const bindings = await readBindings();
  bindings[projectId] = {
    projectId,
    sourceTabId,
    sourceIdentity: captureState?.source || null,
    sourceSessionId: sourceSessionIdentity(captureState.source ?? undefined),
    boundAt: new Date().toISOString()
  };
  await writeBindings(bindings);
}

async function sourceBinding(
  projectId: string
): Promise<SourceBinding | null> {
  const bindings = await readBindings();
  return bindings[projectId] || null;
}

async function sourceTabExists(
  binding: SourceBindingCandidate | null
): Promise<boolean> {
  if (!binding?.sourceTabId) {
    return false;
  }
  try {
    const tab = await chrome.tabs.get(binding.sourceTabId);
    if (!isSupportedSourceUrl(tab?.url)) {
      return false;
    }
    const response = await chrome.tabs.sendMessage(binding.sourceTabId, {
      type: "KIRINUKI_GET_CONTEXT"
    });
    if (!response?.ok) {
      return false;
    }
    const tabPlatform = sourcePlatformFromUrl(tab.url);
    if (
      !tabPlatform
      || response.context?.platform !== tabPlatform
    ) {
      return false;
    }
    const expectedSessionId = binding.sourceSessionId
      || sourceSessionIdentity(binding.sourceIdentity ?? undefined);
    const activeSessionId = sourceSessionIdentity(response.context);
    return Boolean(
      (
        binding.sourceIdentity
        && sameSourceSession(binding.sourceIdentity, response.context)
      )
      || (
        expectedSessionId
        && activeSessionId
        && expectedSessionId === activeSessionId
      )
    );
  } catch {
    return false;
  }
}

async function openExistingEditorDatabase(): Promise<IDBDatabase | null> {
  if (
    typeof indexedDB === "undefined"
    || typeof indexedDB.open !== "function"
  ) {
    return null;
  }
  if (typeof indexedDB.databases === "function") {
    try {
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === EDITOR_DATABASE_NAME)) {
        return null;
      }
    } catch {
      // Opening with an aborted upgrade below is still safe when enumeration
      // is unavailable or temporarily fails.
    }
  }
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(EDITOR_DATABASE_NAME);
    let rejectedCreation = false;
    request.onupgradeneeded = () => {
      rejectedCreation = true;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (rejectedCreation || request.error?.name === "AbortError") {
        resolve(null);
        return;
      }
      reject(request.error || new Error("저장된 편집 세션을 확인하지 못했습니다."));
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function readEditorRecoveryRecords(): Promise<RecoveryRecords> {
  const database = await openExistingEditorDatabase();
  if (!database) {
    return { projects: [], drafts: [] };
  }
  try {
    if (!database.objectStoreNames.contains(EDITOR_PROJECTS_STORE)) {
      return { projects: [], drafts: [] };
    }
    const storeNames = [EDITOR_PROJECTS_STORE];
    if (database.objectStoreNames.contains(EDITOR_LOCAL_DRAFTS_STORE)) {
      storeNames.push(EDITOR_LOCAL_DRAFTS_STORE);
    }
    return await new Promise<RecoveryRecords>((resolve, reject) => {
      const transaction = database.transaction(storeNames, "readonly");
      const projectRequest = transaction
        .objectStore(EDITOR_PROJECTS_STORE)
        .getAll();
      const draftRequest = storeNames.includes(EDITOR_LOCAL_DRAFTS_STORE)
        ? transaction.objectStore(EDITOR_LOCAL_DRAFTS_STORE).getAll()
        : null;
      transaction.oncomplete = () => resolve({
        projects: Array.isArray(projectRequest.result)
          ? projectRequest.result
          : [],
        drafts: Array.isArray(draftRequest?.result)
          ? draftRequest.result
          : []
      });
      transaction.onerror = () => reject(
        transaction.error || new Error("저장된 편집 세션을 읽지 못했습니다.")
      );
      transaction.onabort = () => reject(
        transaction.error || new Error("저장된 편집 세션 읽기가 중단되었습니다.")
      );
    });
  } finally {
    database.close();
  }
}

async function listRecoverySessions() {
  const { projects, drafts } = await readEditorRecoveryRecords();
  return buildRecoverySessionSummaries(projects, drafts);
}

async function focusProjectEditor(projectId: string, {
  editorUrl,
  openRecoveryDrafts = false
}: {
  editorUrl: string;
  openRecoveryDrafts?: boolean;
}): Promise<{ tabId: number | undefined; reused: boolean }> {
  const editorRoot = chrome.runtime.getURL("editor.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => (
    editorTabMatchesProject(tab.url || "", editorRoot, projectId)
  ));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    if (openRecoveryDrafts) {
      await chrome.runtime.sendMessage({
        type: "KIRINUKI_OPEN_RECOVERY_DRAFTS",
        projectId
      }).catch(() => {});
    }
    return { tabId: existing.id, reused: true };
  }
  const created = await chrome.tabs.create({ url: editorUrl, active: true });
  return { tabId: created.id, reused: false };
}

async function openEditor(message: RuntimeMessage): Promise<number | undefined> {
  const { projectId, sourceTabId, captureState } = message;
  if (!projectId || !Number.isInteger(sourceTabId) || !captureState) {
    throw new Error("편집기 전달 정보가 올바르지 않습니다.");
  }
  const validSourceTabId = sourceTabId as number;
  const sourceIdentity = captureState.source ?? null;
  await assertWorkspaceVersion(message);
  if (!(await sourceTabExists({
    sourceTabId: validSourceTabId,
    sourceIdentity,
    sourceSessionId: sourceSessionIdentity(sourceIdentity ?? undefined)
  }))) {
    throw new Error("저장 구간과 연결할 영상 탭의 원본이 다릅니다.");
  }
  await Promise.all([
    bindProjectToSource(projectId, validSourceTabId, captureState),
    chrome.storage.local.set({
      [`${EDITOR_SEED_PREFIX}${projectId}`]: {
        projectId,
        captureState,
        updatedAt: new Date().toISOString()
      }
    })
  ]);

  const editorUrl = chrome.runtime.getURL(`editor.html?project=${encodeURIComponent(projectId)}`);
  const opened = await focusProjectEditor(projectId, { editorUrl });
  if (opened.reused) {
    await chrome.runtime.sendMessage({
      type: "KIRINUKI_CAPTURE_SEED_UPDATED",
      projectId,
      captureState
    }).catch(() => {});
  }
  return opened.tabId;
}

async function openSavedEditor(
  message: RuntimeMessage
): Promise<number | undefined> {
  const projectId = String(message.projectId || "").trim();
  const { projects } = await readEditorRecoveryRecords();
  if (!projects.some((project) => String(project?.id || "") === projectId)) {
    throw new Error("이 기기에서 다시 열 편집 프로젝트를 찾지 못했습니다.");
  }
  const recoveryDrafts = message.recovery === "drafts";
  const editorRoot = chrome.runtime.getURL("editor.html");
  const editorUrl = buildSavedEditorUrl(editorRoot, projectId, {
    recoveryDrafts
  });
  const opened = await focusProjectEditor(projectId, {
    editorUrl,
    openRecoveryDrafts: recoveryDrafts
  });
  return opened.tabId;
}

async function closeEditorTabs(): Promise<void> {
  const editorRoot = chrome.runtime.getURL("editor.html");
  const tabs = await chrome.tabs.query({});
  const editorTabIds = tabs
    .filter((tab) => Number.isInteger(tab.id) && tab.url?.startsWith(editorRoot))
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === "number");
  if (editorTabIds.length > 0) {
    await chrome.tabs.remove(editorTabIds);
  }
}

async function deleteEditorDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(EDITOR_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("편집기 저장소를 삭제하지 못했습니다."));
    request.onblocked = () => reject(new Error("열려 있는 편집기가 저장소 정리를 막고 있습니다."));
  });
}

async function resetWorkspace(message: RuntimeMessage) {
  if (!message.writerId) {
    throw new Error("초기화 요청 정보가 올바르지 않습니다.");
  }
  const currentMeta = await readWorkspaceMeta();
  const workspaceMeta = {
    resetEpoch: crypto.randomUUID(),
    revision: currentMeta.revision + 1,
    writerId: message.writerId
  };
  const state = createInitialState();

  await chrome.storage.local.set({
    [STORAGE_KEY]: state,
    [WORKSPACE_META_KEY]: workspaceMeta
  });
  const cleanupErrors: string[] = [];
  try {
    await writeBindings({});
  } catch (error) {
    cleanupErrors.push(`영상 탭 연결: ${errorMessage(error)}`);
  }
  try {
    const stored = await chrome.storage.local.get(null);
    const seedKeys = Object.keys(stored).filter((key) => key.startsWith(EDITOR_SEED_PREFIX));
    if (seedKeys.length > 0) {
      await chrome.storage.local.remove(seedKeys);
    }
  } catch (error) {
    cleanupErrors.push(`편집기 전달 데이터: ${errorMessage(error)}`);
  }
  try {
    await closeEditorTabs();
  } catch (error) {
    cleanupErrors.push(`열린 편집기 탭: ${errorMessage(error)}`);
  }
  try {
    await deleteEditorDatabase();
  } catch (error) {
    cleanupErrors.push(`편집 프로젝트 저장소: ${errorMessage(error)}`);
  }
  await purgeLegacyLocalAsrCache();

  return { state, workspaceMeta, cleanupErrors };
}

async function runSourceAction(message: RuntimeMessage): Promise<void> {
  const projectId = message.projectId;
  if (!projectId) {
    throw new Error("편집 프로젝트 ID가 없습니다.");
  }
  const binding = await sourceBinding(projectId);
  if (!binding || !(await sourceTabExists(binding))) {
    throw new Error("연결했던 영상 탭이 닫혔습니다. 원본 페이지에서 프로젝트를 다시 열어 주세요.");
  }
  if (message.action === "seek-and-focus" && Number.isFinite(message.sourceSeconds)) {
    const response = await chrome.tabs.sendMessage(binding.sourceTabId, {
      type: "KIRINUKI_PLAYER_COMMAND",
      action: "seek",
      positionSeconds: message.sourceSeconds
    });
    if (!response?.ok) {
      throw new Error(response?.error || "원본 플레이어 위치를 옮기지 못했습니다.");
    }
  }
  const tab = await chrome.tabs.update(binding.sourceTabId, { active: true });
  if (tab && typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtensionRuntime();
});
chrome.runtime.onStartup.addListener(() => {
  void initializeExtensionRuntime();
});
void purgeLegacyLocalAsrCache();

chrome.runtime.onMessage.addListener((
  message: RuntimeMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "KIRINUKI_OPEN_EDITOR") {
    void queueWorkspaceOperation(() => openEditor(message))
      .then((editorTabId) => sendResponse({ ok: true, editorTabId }))
      .catch((error) => sendResponse({
        ok: false,
        error: errorMessage(error),
        workspaceMeta: error instanceof WorkspaceConflictError
          ? error.workspaceMeta
          : undefined
      }));
    return true;
  }

  if (message.type === "KIRINUKI_LIST_RECOVERY_SESSIONS") {
    void listRecoverySessions()
      .then((sessions) => sendResponse({ ok: true, sessions }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message.type === "KIRINUKI_OPEN_SAVED_EDITOR") {
    void queueWorkspaceOperation(() => openSavedEditor(message))
      .then((editorTabId) => sendResponse({ ok: true, editorTabId }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message.type === "KIRINUKI_PERSIST_STATE") {
    void queueWorkspaceOperation(() => persistWorkspaceState(message))
      .then((workspaceMeta) => sendResponse({ ok: true, workspaceMeta }))
      .catch((error) => sendResponse({
        ok: false,
        error: errorMessage(error),
        workspaceMeta: error instanceof WorkspaceConflictError
          ? error.workspaceMeta
          : undefined
      }));
    return true;
  }

  if (message.type === "KIRINUKI_EDITOR_READY") {
    void sourceBinding(String(message.projectId || ""))
      .then(async (binding) => sendResponse({
        ok: true,
        connected: await sourceTabExists(binding)
      }))
      .catch((error) => sendResponse({
        ok: false,
        connected: false,
        error: errorMessage(error)
      }));
    return true;
  }

  if (message.type === "KIRINUKI_EDITOR_SOURCE_ACTION") {
    void runSourceAction(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message.type === "KIRINUKI_RESET_BINDINGS") {
    void queueWorkspaceOperation(() => resetWorkspace(message))
      .then(({ state, workspaceMeta, cleanupErrors }) => sendResponse({
        ok: true,
        state,
        workspaceMeta,
        cleanupErrors
      }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void queueWorkspaceOperation(async () => {
    const bindings = await readBindings();
    const affected = Object.values(bindings).filter((binding) => binding.sourceTabId === tabId);
    if (affected.length === 0) {
      return;
    }
    for (const binding of affected) {
      delete bindings[binding.projectId];
    }
    await writeBindings(bindings);
    await Promise.all(affected.map((binding) => chrome.runtime.sendMessage({
      type: "KIRINUKI_SOURCE_BINDING_STATUS",
      projectId: binding.projectId,
      connected: false
    }).catch(() => {})));
  }).catch((error) => console.error("영상 탭 연결 정리 실패", error));
});

void enableActionSidePanel();
