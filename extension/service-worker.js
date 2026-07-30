// Generated from TypeScript sources. Do not edit directly.
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
let workspaceOperationQueue = Promise.resolve();
class WorkspaceConflictError extends Error {
  workspaceMeta;
  constructor(message, workspaceMeta) {
    super(message);
    this.name = "WorkspaceConflictError";
    this.workspaceMeta = workspaceMeta;
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function queueWorkspaceOperation(operation) {
  const result = workspaceOperationQueue.then(operation, operation);
  workspaceOperationQueue = result.catch(() => {
  });
  return result;
}
const enableActionSidePanel = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("\uC0AC\uC774\uB4DC\uD328\uB110 \uB3D9\uC791\uC744 \uC124\uC815\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", error);
  }
};
async function purgeLegacyLocalAsrCache() {
  try {
    await caches.delete(LEGACY_TRANSFORMERS_CACHE_NAME);
  } catch (error) {
    console.warn("\uC774\uC804 \uB85C\uCEEC \uC74C\uC131\uC778\uC2DD \uBAA8\uB378 \uCE90\uC2DC\uB97C \uC815\uB9AC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", error);
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
  return stored[BINDINGS_KEY] && typeof stored[BINDINGS_KEY] === "object" ? stored[BINDINGS_KEY] : {};
}
async function writeBindings(bindings) {
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
}
async function readWorkspaceMeta() {
  const stored = await chrome.storage.local.get(WORKSPACE_META_KEY);
  return normalizeWorkspaceMeta(
    stored[WORKSPACE_META_KEY]
  );
}
function workspaceConflict(message, workspaceMeta) {
  return new WorkspaceConflictError(message, workspaceMeta);
}
async function assertWorkspaceVersion(message) {
  const workspaceMeta = await readWorkspaceMeta();
  if (message.expectedResetEpoch !== workspaceMeta.resetEpoch || message.expectedRevision !== workspaceMeta.revision) {
    throw workspaceConflict(
      "\uB2E4\uB978 \uCC3D\uC5D0\uC11C \uD504\uB85C\uC81D\uD2B8\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uCD5C\uC2E0 \uC0C1\uD0DC\uB97C \uBC18\uC601\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
      workspaceMeta
    );
  }
  return workspaceMeta;
}
async function persistWorkspaceState(message) {
  if (!message.state || typeof message.state !== "object" || !message.writerId) {
    throw new Error("\uC800\uC7A5\uD560 \uD504\uB85C\uC81D\uD2B8 \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
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
async function bindProjectToSource(projectId, sourceTabId, captureState) {
  const bindings = await readBindings();
  bindings[projectId] = {
    projectId,
    sourceTabId,
    sourceIdentity: captureState?.source || null,
    sourceSessionId: sourceSessionIdentity(captureState.source ?? void 0),
    boundAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeBindings(bindings);
}
async function sourceBinding(projectId) {
  const bindings = await readBindings();
  return bindings[projectId] || null;
}
async function sourceTabExists(binding) {
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
    if (!tabPlatform || response.context?.platform !== tabPlatform) {
      return false;
    }
    const expectedSessionId = binding.sourceSessionId || sourceSessionIdentity(binding.sourceIdentity ?? void 0);
    const activeSessionId = sourceSessionIdentity(response.context);
    return Boolean(
      binding.sourceIdentity && sameSourceSession(binding.sourceIdentity, response.context) || expectedSessionId && activeSessionId && expectedSessionId === activeSessionId
    );
  } catch {
    return false;
  }
}
async function openExistingEditorDatabase() {
  if (typeof indexedDB === "undefined" || typeof indexedDB.open !== "function") {
    return null;
  }
  if (typeof indexedDB.databases === "function") {
    try {
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === EDITOR_DATABASE_NAME)) {
        return null;
      }
    } catch {
    }
  }
  return new Promise((resolve, reject) => {
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
      reject(request.error || new Error("\uC800\uC7A5\uB41C \uD3B8\uC9D1 \uC138\uC158\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."));
    };
    request.onsuccess = () => resolve(request.result);
  });
}
async function readEditorRecoveryRecords() {
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
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeNames, "readonly");
      const projectRequest = transaction.objectStore(EDITOR_PROJECTS_STORE).getAll();
      const draftRequest = storeNames.includes(EDITOR_LOCAL_DRAFTS_STORE) ? transaction.objectStore(EDITOR_LOCAL_DRAFTS_STORE).getAll() : null;
      transaction.oncomplete = () => resolve({
        projects: Array.isArray(projectRequest.result) ? projectRequest.result : [],
        drafts: Array.isArray(draftRequest?.result) ? draftRequest.result : []
      });
      transaction.onerror = () => reject(
        transaction.error || new Error("\uC800\uC7A5\uB41C \uD3B8\uC9D1 \uC138\uC158\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.")
      );
      transaction.onabort = () => reject(
        transaction.error || new Error("\uC800\uC7A5\uB41C \uD3B8\uC9D1 \uC138\uC158 \uC77D\uAE30\uAC00 \uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4.")
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
async function focusProjectEditor(projectId, {
  editorUrl,
  openRecoveryDrafts = false
}) {
  const editorRoot = chrome.runtime.getURL("editor.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => editorTabMatchesProject(tab.url || "", editorRoot, projectId));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    if (openRecoveryDrafts) {
      await chrome.runtime.sendMessage({
        type: "KIRINUKI_OPEN_RECOVERY_DRAFTS",
        projectId
      }).catch(() => {
      });
    }
    return { tabId: existing.id, reused: true };
  }
  const created = await chrome.tabs.create({ url: editorUrl, active: true });
  return { tabId: created.id, reused: false };
}
async function openEditor(message) {
  const { projectId, sourceTabId, captureState } = message;
  if (!projectId || !Number.isInteger(sourceTabId) || !captureState) {
    throw new Error("\uD3B8\uC9D1\uAE30 \uC804\uB2EC \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  }
  const validSourceTabId = sourceTabId;
  const sourceIdentity = captureState.source ?? null;
  await assertWorkspaceVersion(message);
  if (!await sourceTabExists({
    sourceTabId: validSourceTabId,
    sourceIdentity,
    sourceSessionId: sourceSessionIdentity(sourceIdentity ?? void 0)
  })) {
    throw new Error("\uC800\uC7A5 \uAD6C\uAC04\uACFC \uC5F0\uACB0\uD560 \uC601\uC0C1 \uD0ED\uC758 \uC6D0\uBCF8\uC774 \uB2E4\uB985\uB2C8\uB2E4.");
  }
  await Promise.all([
    bindProjectToSource(projectId, validSourceTabId, captureState),
    chrome.storage.local.set({
      [`${EDITOR_SEED_PREFIX}${projectId}`]: {
        projectId,
        captureState,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
    }).catch(() => {
    });
  }
  return opened.tabId;
}
async function openSavedEditor(message) {
  const projectId = String(message.projectId || "").trim();
  const { projects } = await readEditorRecoveryRecords();
  if (!projects.some((project) => String(project?.id || "") === projectId)) {
    throw new Error("\uC774 \uAE30\uAE30\uC5D0\uC11C \uB2E4\uC2DC \uC5F4 \uD3B8\uC9D1 \uD504\uB85C\uC81D\uD2B8\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
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
async function closeEditorTabs() {
  const editorRoot = chrome.runtime.getURL("editor.html");
  const tabs = await chrome.tabs.query({});
  const editorTabIds = tabs.filter((tab) => Number.isInteger(tab.id) && tab.url?.startsWith(editorRoot)).map((tab) => tab.id).filter((id) => typeof id === "number");
  if (editorTabIds.length > 0) {
    await chrome.tabs.remove(editorTabIds);
  }
}
async function deleteEditorDatabase() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(EDITOR_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("\uD3B8\uC9D1\uAE30 \uC800\uC7A5\uC18C\uB97C \uC0AD\uC81C\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."));
    request.onblocked = () => reject(new Error("\uC5F4\uB824 \uC788\uB294 \uD3B8\uC9D1\uAE30\uAC00 \uC800\uC7A5\uC18C \uC815\uB9AC\uB97C \uB9C9\uACE0 \uC788\uC2B5\uB2C8\uB2E4."));
  });
}
async function resetWorkspace(message) {
  if (!message.writerId) {
    throw new Error("\uCD08\uAE30\uD654 \uC694\uCCAD \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
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
  const cleanupErrors = [];
  try {
    await writeBindings({});
  } catch (error) {
    cleanupErrors.push(`\uC601\uC0C1 \uD0ED \uC5F0\uACB0: ${errorMessage(error)}`);
  }
  try {
    const stored = await chrome.storage.local.get(null);
    const seedKeys = Object.keys(stored).filter((key) => key.startsWith(EDITOR_SEED_PREFIX));
    if (seedKeys.length > 0) {
      await chrome.storage.local.remove(seedKeys);
    }
  } catch (error) {
    cleanupErrors.push(`\uD3B8\uC9D1\uAE30 \uC804\uB2EC \uB370\uC774\uD130: ${errorMessage(error)}`);
  }
  try {
    await closeEditorTabs();
  } catch (error) {
    cleanupErrors.push(`\uC5F4\uB9B0 \uD3B8\uC9D1\uAE30 \uD0ED: ${errorMessage(error)}`);
  }
  try {
    await deleteEditorDatabase();
  } catch (error) {
    cleanupErrors.push(`\uD3B8\uC9D1 \uD504\uB85C\uC81D\uD2B8 \uC800\uC7A5\uC18C: ${errorMessage(error)}`);
  }
  await purgeLegacyLocalAsrCache();
  return { state, workspaceMeta, cleanupErrors };
}
async function runSourceAction(message) {
  const projectId = message.projectId;
  if (!projectId) {
    throw new Error("\uD3B8\uC9D1 \uD504\uB85C\uC81D\uD2B8 ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
  }
  const binding = await sourceBinding(projectId);
  if (!binding || !await sourceTabExists(binding)) {
    throw new Error("\uC5F0\uACB0\uD588\uB358 \uC601\uC0C1 \uD0ED\uC774 \uB2EB\uD614\uC2B5\uB2C8\uB2E4. \uC6D0\uBCF8 \uD398\uC774\uC9C0\uC5D0\uC11C \uD504\uB85C\uC81D\uD2B8\uB97C \uB2E4\uC2DC \uC5F4\uC5B4 \uC8FC\uC138\uC694.");
  }
  if (message.action === "seek-and-focus" && Number.isFinite(message.sourceSeconds)) {
    const response = await chrome.tabs.sendMessage(binding.sourceTabId, {
      type: "KIRINUKI_PLAYER_COMMAND",
      action: "seek",
      positionSeconds: message.sourceSeconds
    });
    if (!response?.ok) {
      throw new Error(response?.error || "\uC6D0\uBCF8 \uD50C\uB808\uC774\uC5B4 \uC704\uCE58\uB97C \uC62E\uAE30\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
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
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }
  if (message.type === "KIRINUKI_OPEN_EDITOR") {
    void queueWorkspaceOperation(() => openEditor(message)).then((editorTabId) => sendResponse({ ok: true, editorTabId })).catch((error) => sendResponse({
      ok: false,
      error: errorMessage(error),
      workspaceMeta: error instanceof WorkspaceConflictError ? error.workspaceMeta : void 0
    }));
    return true;
  }
  if (message.type === "KIRINUKI_LIST_RECOVERY_SESSIONS") {
    void listRecoverySessions().then((sessions) => sendResponse({ ok: true, sessions })).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  if (message.type === "KIRINUKI_OPEN_SAVED_EDITOR") {
    void queueWorkspaceOperation(() => openSavedEditor(message)).then((editorTabId) => sendResponse({ ok: true, editorTabId })).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  if (message.type === "KIRINUKI_PERSIST_STATE") {
    void queueWorkspaceOperation(() => persistWorkspaceState(message)).then((workspaceMeta) => sendResponse({ ok: true, workspaceMeta })).catch((error) => sendResponse({
      ok: false,
      error: errorMessage(error),
      workspaceMeta: error instanceof WorkspaceConflictError ? error.workspaceMeta : void 0
    }));
    return true;
  }
  if (message.type === "KIRINUKI_EDITOR_READY") {
    void sourceBinding(String(message.projectId || "")).then(async (binding) => sendResponse({
      ok: true,
      connected: await sourceTabExists(binding)
    })).catch((error) => sendResponse({
      ok: false,
      connected: false,
      error: errorMessage(error)
    }));
    return true;
  }
  if (message.type === "KIRINUKI_EDITOR_SOURCE_ACTION") {
    void runSourceAction(message).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  if (message.type === "KIRINUKI_RESET_BINDINGS") {
    void queueWorkspaceOperation(() => resetWorkspace(message)).then(({ state, workspaceMeta, cleanupErrors }) => sendResponse({
      ok: true,
      state,
      workspaceMeta,
      cleanupErrors
    })).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
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
    }).catch(() => {
    })));
  }).catch((error) => console.error("\uC601\uC0C1 \uD0ED \uC5F0\uACB0 \uC815\uB9AC \uC2E4\uD328", error));
});
void enableActionSidePanel();
