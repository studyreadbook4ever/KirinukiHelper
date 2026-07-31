// Generated from TypeScript sources. Do not edit directly.
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
import {
  createSerialOperationGate
} from "./lib/serial-operation-gate.js";
const requiredElement = (selector) => {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`\uD544\uC218 UI \uC694\uC18C\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${selector}`);
  }
  return element;
};
const requiredDescendant = (root, selector) => {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`\uD544\uC218 UI \uD558\uC704 \uC694\uC18C\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${selector}`);
  }
  return element;
};
const elements = {
  connectionBadge: requiredElement("#connection-badge"),
  refreshRecoverySessions: requiredElement("#refresh-recovery-sessions"),
  recoverySessionsLoading: requiredElement("#recovery-sessions-loading"),
  recoverySessionsEmpty: requiredElement("#recovery-sessions-empty"),
  recoverySessionsList: requiredElement("#recovery-sessions-list"),
  recoverySessionTemplate: requiredElement("#recovery-session-template"),
  refreshSource: requiredElement("#refresh-source"),
  sourceEmpty: requiredElement("#source-empty"),
  sourceDetails: requiredElement("#source-details"),
  sourceType: requiredElement("#source-type"),
  playerPosition: requiredElement("#player-position"),
  playerStatus: requiredElement("#player-status"),
  playbackRateQuarter: requiredElement("#playback-rate-quarter"),
  playbackRateDouble: requiredElement("#playback-rate-double"),
  seekBackwardFive: requiredElement("#seek-backward-five"),
  seekForwardFive: requiredElement("#seek-forward-five"),
  streamerName: requiredElement("#streamer-name"),
  broadcastTitle: requiredElement("#broadcast-title"),
  sourceLink: requiredElement("#source-link"),
  projectName: requiredElement("#project-name"),
  globalInstruction: requiredElement("#global-instruction"),
  captureCard: requiredElement("#capture-card"),
  editingBadge: requiredElement("#editing-badge"),
  startTime: requiredElement("#start-time"),
  endTime: requiredElement("#end-time"),
  captureStart: requiredElement("#capture-start"),
  captureEnd: requiredElement("#capture-end"),
  segmentDescription: requiredElement("#segment-description"),
  descriptionCount: requiredElement("#description-count"),
  saveSegment: requiredElement("#save-segment"),
  cancelEdit: requiredElement("#cancel-edit"),
  segmentCount: requiredElement("#segment-count"),
  segmentsEmpty: requiredElement("#segments-empty"),
  segmentsList: requiredElement("#segments-list"),
  segmentTemplate: requiredElement("#segment-template"),
  generatePrompt: requiredElement("#generate-prompt"),
  openEditor: requiredElement("#open-editor"),
  createCodexJob: requiredElement("#create-codex-job"),
  policyMatchBadge: document.querySelector("#policy-match-badge"),
  promptResult: requiredElement("#prompt-result"),
  promptPreview: requiredElement("#prompt-preview"),
  promptCharacterCount: requiredElement("#prompt-character-count"),
  copyPrompt: requiredElement("#copy-prompt"),
  downloadPrompt: requiredElement("#download-prompt"),
  closePreview: requiredElement("#close-preview"),
  resetProject: requiredElement("#reset-project"),
  statusBar: requiredElement("#status-bar")
};
function shortcutTargetIds(binding) {
  return [binding.targetId, ...binding.alternateTargetIds || []];
}
function usableShortcutTarget(binding) {
  if (binding.action === "save-segment" && Boolean(state.draft.editingId)) {
    return null;
  }
  for (const targetId of shortcutTargetIds(binding)) {
    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLElement) || target.closest("[hidden]") || target.getAttribute("aria-disabled") === "true" || target instanceof HTMLButtonElement && target.disabled) {
      continue;
    }
    return target;
  }
  return null;
}
function installShortcutHints() {
  for (const binding of SIDEPANEL_SHORTCUT_BINDINGS) {
    for (const targetId of shortcutTargetIds(binding)) {
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLElement)) {
        throw new Error(`\uC0AC\uC774\uB4DC\uD328\uB110 \uB2E8\uCD95\uD0A4 \uB300\uC0C1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4: #${targetId}`);
      }
      target.title = formatKeyboardShortcutHint(binding.label, binding.key);
      target.setAttribute("aria-keyshortcuts", binding.key);
    }
  }
}
function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const letter = keyboardShortcutLetterFromEvent(event);
    const binding = letter ? keyboardShortcutBindingForScope("sidepanel", letter) : null;
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
const panelState = (value) => normalizeState(value);
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const isAbortError = (error) => error instanceof DOMException ? error.name === "AbortError" : typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
const sendRuntimeMessage = (message) => chrome.runtime.sendMessage(message);
const normalizePanelWorkspaceMeta = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalizeWorkspaceMeta(null);
  }
  const candidate = raw;
  return normalizeWorkspaceMeta({
    resetEpoch: candidate.resetEpoch,
    revision: candidate.revision,
    writerId: candidate.writerId
  });
};
let state = panelState(createInitialState());
let currentContext = null;
let sourceConflict = false;
let editingGuideMarkdown = "";
let creatorPolicyMarkdown = "";
let codexJobAgentsMarkdown = "";
let creatorPolicyIndex = { policies: [] };
let lastPrompt = "";
let saveTimer = null;
let statusTimer = null;
let refreshTimer = null;
let contextRequestSequence = 0;
let foregroundContextRequestCount = 0;
let sourceRefreshRequestCount = 0;
let playerCommandInProgress = false;
const sourceClockOperationGate = createSerialOperationGate();
let stateGeneration = 0;
let resetInProgress = false;
let persistenceChain = Promise.resolve();
let workspaceSyncChain = Promise.resolve();
let workspaceMeta = normalizePanelWorkspaceMeta(null);
const panelWriterId = crypto.randomUUID();
let dirtyFieldSequence = 0;
const dirtyFields = /* @__PURE__ */ new Map();
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
const wait = (milliseconds) => new Promise(
  (resolve) => window.setTimeout(resolve, milliseconds)
);
class SourceTabUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceTabUnavailableError";
  }
}
function setStatus(message, type = "info", timeout = 4200) {
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
function recoveryDraftReasonLabel(reason) {
  const labels = {
    manual: "\uC218\uB3D9 \uC800\uC7A5",
    auto: "\uC790\uB3D9 \uC800\uC7A5",
    "pre-restore": "\uBCF5\uC6D0 \uC9C1\uC804 \uC800\uC7A5"
  };
  return labels[String(reason ?? "")] || "\uC784\uC2DC\uC800\uC7A5";
}
function recoveryCountsLabel(counts = {}) {
  return [
    `\uCEF7 ${Number(counts.clips) || 0}`,
    `\uC790\uB9C9 ${Number(counts.subtitles) || 0}`,
    `\uC5D0\uC14B ${Number(counts.assets) || 0}`,
    `\uC74C\uC131 ${Number(counts.audio) || 0}`
  ].join(" \xB7 ");
}
function renderRecoverySessions(sessions) {
  const fragment = document.createDocumentFragment();
  for (const session of sessions) {
    const item = elements.recoverySessionTemplate.content.firstElementChild?.cloneNode(true);
    if (!(item instanceof HTMLElement)) {
      throw new Error("\uBCF5\uAD6C \uC138\uC158 \uD15C\uD50C\uB9BF \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    }
    item.dataset.projectId = session.projectId;
    item.dataset.draftCount = String(session.draftCount || 0);
    requiredDescendant(
      item,
      ".recovery-session-title"
    ).textContent = session.title;
    const time = requiredDescendant(
      item,
      ".recovery-session-time"
    );
    if (session.updatedAt) {
      time.dateTime = session.updatedAt;
      time.textContent = `\uCD5C\uADFC \uD3B8\uC9D1 ${recoveryDateFormatter.format(
        new Date(session.updatedAt)
      )}`;
    } else {
      time.textContent = "\uCD5C\uADFC \uD3B8\uC9D1 \uC2DC\uAC01 \uC815\uBCF4 \uC5C6\uC74C";
    }
    requiredDescendant(
      item,
      ".recovery-session-counts"
    ).textContent = recoveryCountsLabel(session.counts);
    const draftCount = Number(session.draftCount) || 0;
    const drafts = requiredDescendant(
      item,
      ".recovery-session-drafts"
    );
    drafts.textContent = draftCount > 0 ? `\uBCF5\uAD6C\uBCF8 ${draftCount}\uAC1C \xB7 \uCD5C\uC2E0 ${recoveryDraftReasonLabel(
      session.latestDraftReason
    )}` : "\uC544\uC9C1 \uC120\uD0DD\uD560 \uBCF5\uAD6C\uBCF8 \uC5C6\uC74C";
    const draftButton = requiredDescendant(
      item,
      '[data-recovery-action="drafts"]'
    );
    draftButton.disabled = draftCount === 0;
    draftButton.title = draftCount > 0 ? "\uCD5C\uADFC \uC784\uC2DC\uC800\uC7A5 \uC911 \uD558\uB098\uB97C \uACE8\uB77C \uBD88\uB7EC\uC624\uAE30" : "\uC774 \uD504\uB85C\uC81D\uD2B8\uC5D0\uB294 \uC544\uC9C1 \uC784\uC2DC\uC800\uC7A5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";
    fragment.append(item);
  }
  elements.recoverySessionsList.replaceChildren(fragment);
  elements.recoverySessionsEmpty.hidden = sessions.length > 0;
}
async function refreshRecoverySessions({ silent = false } = {}) {
  const requestSequence = ++recoveryLoadSequence;
  elements.refreshRecoverySessions.disabled = true;
  if (!silent || elements.recoverySessionsList.children.length === 0) {
    elements.recoverySessionsLoading.hidden = false;
    elements.recoverySessionsLoading.textContent = "\uC800\uC7A5\uB41C \uD3B8\uC9D1\uC744 \uD655\uC778\uD558\uB294 \uC911\u2026";
  }
  try {
    const response = await sendRuntimeMessage({
      type: "KIRINUKI_LIST_RECOVERY_SESSIONS"
    });
    if (requestSequence !== recoveryLoadSequence) {
      return;
    }
    if (!response?.ok || !Array.isArray(response.sessions)) {
      throw new Error(response?.error || "\uC800\uC7A5\uB41C \uD3B8\uC9D1 \uBAA9\uB85D\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
    renderRecoverySessions(response.sessions);
    elements.recoverySessionsLoading.hidden = true;
  } catch (error) {
    if (requestSequence !== recoveryLoadSequence) {
      return;
    }
    elements.recoverySessionsLoading.hidden = false;
    elements.recoverySessionsLoading.textContent = `\uC800\uC7A5\uB41C \uD3B8\uC9D1 \uD655\uC778 \uC2E4\uD328 \xB7 ${errorMessage(error)}`;
    if (!silent) {
      setStatus(`\uCD5C\uADFC \uD3B8\uC9D1\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error");
    }
  } finally {
    if (requestSequence === recoveryLoadSequence) {
      elements.refreshRecoverySessions.disabled = false;
    }
  }
}
async function openSavedEditor(projectId, { recoveryDrafts = false } = {}) {
  if (recoveryOpenInProgress) {
    return;
  }
  const item = [...elements.recoverySessionsList.children].find(
    (candidate) => candidate instanceof HTMLElement && candidate.dataset.projectId === projectId
  );
  if (!(item instanceof HTMLElement)) {
    setStatus("\uB2E4\uC2DC \uC5F4 \uD504\uB85C\uC81D\uD2B8\uB97C \uBAA9\uB85D\uC5D0\uC11C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", "error");
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
      throw new Error(response?.error || "\uC800\uC7A5\uB41C \uD3B8\uC9D1\uAE30\uB97C \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
    setStatus(
      recoveryDrafts ? "\uD3B8\uC9D1\uAE30\uB97C \uC5F4\uACE0 \uBCF5\uAD6C\uBCF8 \uBAA9\uB85D\uC744 \uD45C\uC2DC\uD588\uC2B5\uB2C8\uB2E4." : "\uB9C8\uC9C0\uB9C9 \uC800\uC7A5 \uC0C1\uD0DC\uB85C \uD3B8\uC9D1\uAE30\uB97C \uC5F4\uC5C8\uC2B5\uB2C8\uB2E4.",
      "success"
    );
  } catch (error) {
    setStatus(`\uD3B8\uC9D1\uAE30\uB97C \uB2E4\uC2DC \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error", 0);
  } finally {
    recoveryOpenInProgress = false;
    item.classList.remove("is-opening");
    for (const button of item.querySelectorAll("button")) {
      button.disabled = button.dataset.recoveryAction === "drafts" && Number(item.dataset.draftCount) === 0;
    }
  }
}
function assertOperationCurrent(generation) {
  if (resetInProgress || generation !== stateGeneration) {
    throw new DOMException("\uCD08\uAE30\uD654\uB85C \uC774\uC804 \uC791\uC5C5\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", "AbortError");
  }
}
function markDirtyField(field, value) {
  dirtyFieldSequence += 1;
  dirtyFields.set(field, {
    version: dirtyFieldSequence,
    value: structuredClone(value)
  });
}
function mergeDirtyFields(latestState) {
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
      merged.draft = structuredClone(entry.value);
    }
  }
  return merged;
}
function stateSignature(value) {
  const normalized = panelState(value);
  const { updatedAt: _updatedAt, ...stableState } = normalized;
  return JSON.stringify(stableState);
}
function persistState({ allowDuringReset = false } = {}) {
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
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const snapshot = structuredClone(state);
  const operation = persistenceChain.catch(() => {
  }).then(async () => {
    if (generation !== stateGeneration || resetInProgress && !allowDuringReset) {
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
        response?.error || "\uD504\uB85C\uC81D\uD2B8 \uC0C1\uD0DC\uB97C \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
        response?.workspaceMeta ? "AbortError" : "OperationError"
      );
    }
    const responseMeta = normalizePanelWorkspaceMeta(response.workspaceMeta);
    const responseIsCurrent = responseMeta.resetEpoch === workspaceMeta.resetEpoch && responseMeta.revision >= workspaceMeta.revision;
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
function schedulePersist() {
  if (resetInProgress) {
    return;
  }
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    void persistState().catch((error) => {
      if (!isAbortError(error)) {
        setStatus(`\uC800\uC7A5 \uC2E4\uD328: ${errorMessage(error)}`, "error");
      }
    });
  }, 220);
}
async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, WORKSPACE_META_KEY]);
  state = panelState(stored[STORAGE_KEY]);
  workspaceMeta = normalizePanelWorkspaceMeta(stored[WORKSPACE_META_KEY]);
  lastPersistedStateSignature = stateSignature(state);
}
function queueWorkspaceSync(expectedMeta, { forceApply = false } = {}) {
  const expected = normalizePanelWorkspaceMeta(expectedMeta);
  workspaceSyncChain = workspaceSyncChain.catch(() => {
  }).then(async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEY, WORKSPACE_META_KEY]);
    const latestMeta = normalizePanelWorkspaceMeta(stored[WORKSPACE_META_KEY]);
    if (latestMeta.revision < expected.revision || latestMeta.revision === workspaceMeta.revision && latestMeta.resetEpoch === workspaceMeta.resetEpoch) {
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
    sourceConflict = currentContext ? captureStateSourceConflict(state, contextAsSource(currentContext)) : false;
    lastPrompt = "";
    elements.promptResult.hidden = true;
    elements.promptPreview.value = "";
    syncStateToForm();
    renderSegments();
    renderSource();
    setStatus(
      resetChanged ? "\uB2E4\uB978 \uCC3D\uC5D0\uC11C \uBAA8\uB4E0 \uB85C\uCEEC \uC791\uC5C5\uC744 \uCD08\uAE30\uD654\uD588\uC2B5\uB2C8\uB2E4." : preserveDirtyInput ? "\uB2E4\uB978 \uCC3D\uC758 \uBCC0\uACBD\uC744 \uBC18\uC601\uD558\uACE0 \uD604\uC7AC \uC785\uB825\uC740 \uBCF4\uC874\uD588\uC2B5\uB2C8\uB2E4." : "\uB2E4\uB978 \uCC3D\uC758 \uCD5C\uC2E0 \uD504\uB85C\uC81D\uD2B8 \uBCC0\uACBD\uC744 \uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4.",
      "info",
      6500
    );
    if (preserveDirtyInput) {
      schedulePersist();
    }
  });
  return workspaceSyncChain;
}
function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes[WORKSPACE_META_KEY]) {
    return;
  }
  const nextMeta = normalizePanelWorkspaceMeta(
    changes[WORKSPACE_META_KEY]?.newValue
  );
  const resetChanged = nextMeta.resetEpoch !== workspaceMeta.resetEpoch;
  if (nextMeta.revision < workspaceMeta.revision || nextMeta.revision === workspaceMeta.revision && nextMeta.resetEpoch === workspaceMeta.resetEpoch) {
    return;
  }
  if (nextMeta.writerId === panelWriterId && !resetChanged) {
    workspaceMeta = nextMeta;
    return;
  }
  void queueWorkspaceSync(nextMeta, { forceApply: resetChanged });
}
async function loadMarkdown(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) {
    throw new Error(`${path}\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4 (${response.status}).`);
  }
  return response.text();
}
async function loadKnowledge() {
  const [editingGuide, basePolicy, codexAgents, policyIndexText] = await Promise.all([
    loadMarkdown("knowledge/base-editing-guidelines.md"),
    loadMarkdown("knowledge/default-creator-policy.md"),
    loadMarkdown("knowledge/codex-job-agents.md"),
    loadMarkdown("knowledge/creator-policy-index.json")
  ]);
  const parsedIndex = JSON.parse(policyIndexText);
  if (!parsedIndex || typeof parsedIndex !== "object" || Array.isArray(parsedIndex) || !("policies" in parsedIndex) || !Array.isArray(parsedIndex.policies)) {
    throw new Error("\uBC29\uC1A1\uC778 \uC815\uCC45 \uC778\uB371\uC2A4 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  }
  editingGuideMarkdown = editingGuide;
  creatorPolicyMarkdown = basePolicy;
  codexJobAgentsMarkdown = codexAgents;
  creatorPolicyIndex = { policies: parsedIndex.policies };
}
function currentPolicyBundle(streamerName = elements.streamerName.value.trim() || state.source.streamerName) {
  const resolvedPolicies = resolveCreatorPolicies({ streamerName }, creatorPolicyIndex);
  const compiledPolicyMarkdown = compileCreatorPolicyMarkdown({
    basePolicyMarkdown: creatorPolicyMarkdown,
    resolvedPolicies
  });
  return { resolvedPolicies, compiledPolicyMarkdown };
}
function renderPolicyMatch() {
  if (!elements.policyMatchBadge) {
    return;
  }
  const { resolvedPolicies } = currentPolicyBundle();
  if (resolvedPolicies.length === 0) {
    elements.policyMatchBadge.textContent = "\uAE30\uBCF8 MD \uC801\uC6A9";
    elements.policyMatchBadge.title = "\uB4F1\uB85D\uB41C \uBC29\uC1A1\uC778 \uC815\uCC45\uACFC \uC815\uD655\uD788 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.";
    return;
  }
  const policy = resolvedPolicies[0];
  elements.policyMatchBadge.textContent = `${policy.group} \xB7 \uB9C1\uD06C \uB9E4\uCE6D`;
  elements.policyMatchBadge.title = `${policy.matchedBy.value} \u2192 ${policy.sourceUrl}`;
}
function syncStateToForm() {
  elements.projectName.value = state.projectName;
  elements.globalInstruction.value = state.globalInstruction;
  elements.streamerName.value = state.source.streamerName;
  elements.broadcastTitle.value = state.source.broadcastTitle;
  renderDraft();
  renderPolicyMatch();
}
function syncDraftFromForm() {
  state.draft.startText = elements.startTime.value;
  state.draft.endText = elements.endTime.value;
  state.draft.description = elements.segmentDescription.value;
}
function renderDraft() {
  elements.startTime.value = state.draft.startText;
  elements.endTime.value = state.draft.endText;
  elements.segmentDescription.value = state.draft.description;
  elements.descriptionCount.textContent = String(state.draft.description.length);
  const editing = Boolean(state.draft.editingId);
  elements.editingBadge.hidden = !editing;
  elements.cancelEdit.hidden = !editing;
  elements.saveSegment.textContent = editing ? "\uAD6C\uAC04 \uC218\uC815 \uC800\uC7A5" : "\uAD6C\uAC04 \uC800\uC7A5";
  if (editing) {
    elements.saveSegment.removeAttribute("aria-keyshortcuts");
    elements.saveSegment.title = "\uAE30\uC874 \uAD6C\uAC04\uC744 \uBC14\uAFB8\uB294 \uB3D9\uC791\uC774\uBBC0\uB85C \uB2E8\uCD95\uD0A4 \uC5C6\uC74C";
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
function clearDraft() {
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
function samePersistedSource(left, right) {
  return PERSISTED_SOURCE_KEYS.every(
    (key) => Object.is(left?.[key], right?.[key])
  );
}
function sourceIdentity(source) {
  return sourceSessionIdentity(source);
}
function contextAsSource(context) {
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
    observedAt: context.capturedAt || (/* @__PURE__ */ new Date()).toISOString()
  };
}
function remapDraftCaptureSessionIdentity(capture, previousIdentity, nextIdentity) {
  if (!capture || !previousIdentity || !nextIdentity || previousIdentity === nextIdentity || capture.sourceSessionId !== previousIdentity) {
    return capture;
  }
  return {
    ...capture,
    sourceSessionId: nextIdentity
  };
}
function applyContextToProject(context) {
  const nextSource = contextAsSource(context);
  const previousIdentity = sourceIdentity(state.source);
  const nextIdentity = sourceIdentity(nextSource);
  const sameSession = sameSourceSession(state.source, nextSource);
  sourceConflict = captureStateSourceConflict(state, nextSource);
  if (!sourceConflict) {
    const preserveStreamer = state.source.streamerName;
    const preserveTitle = state.source.broadcastTitle;
    const sourceChanged = Boolean(
      previousIdentity && nextIdentity && !sameSession
    );
    if (sameSession && previousIdentity && nextIdentity && previousIdentity !== nextIdentity) {
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
      streamerName: sourceChanged ? nextSource.streamerName : preserveStreamer || nextSource.streamerName,
      broadcastTitle: sourceChanged ? nextSource.broadcastTitle : preserveTitle || nextSource.broadcastTitle
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
function setConnectionBadge(text, variant) {
  elements.connectionBadge.textContent = text;
  elements.connectionBadge.className = `badge ${variant}`;
}
function renderPlayerControls(player) {
  const currentRate = Number(player?.playbackRate);
  const available = Boolean(
    currentContext && player?.found && !player.adActive && !playerCommandInProgress
  );
  const controls = [
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
function renderSource() {
  const context = currentContext;
  const connected = context !== null;
  elements.sourceEmpty.hidden = connected;
  elements.sourceDetails.hidden = !connected;
  renderPlayerControls(context?.player);
  if (!context) {
    setConnectionBadge("\uBBF8\uC5F0\uACB0", "badge-muted");
    return;
  }
  const type = String(context.contentType || "unknown").toUpperCase();
  const platformLabel = sourcePlatformLabel(context.platform);
  elements.sourceType.textContent = `${platformLabel} \xB7 ${type}`;
  elements.sourceType.className = `badge ${type === "LIVE" ? "badge-live" : "badge-vod"}`;
  const player = context.player ?? {};
  elements.playerPosition.textContent = Number.isFinite(player.positionSeconds) ? formatTimestamp(player.positionSeconds) : "--:--:--";
  elements.playerStatus.textContent = sourcePlayerStatusText(context);
  if (sourceConflict) {
    setConnectionBadge("\uB2E4\uB978 \uC6D0\uBCF8", "badge-policy");
    elements.playerStatus.textContent = "\uC800\uC7A5 \uAD6C\uAC04\uACFC \uB2E4\uB978 \uC6D0\uBCF8 \xB7 \uCD08\uAE30\uD654 \uD6C4 \uAE30\uB85D \uAC00\uB2A5";
  } else {
    setConnectionBadge("\uC5F0\uACB0\uB428", "badge-connected");
  }
  elements.sourceLink.href = context.canonicalUrl || context.url;
  elements.sourceLink.title = context.canonicalUrl || context.url;
}
async function getActiveSourceTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = selectSupportedSourceTab(tabs, {
    expectedSource: state.source
  });
  if (!tab?.id || !isSupportedSourceUrl(tab.url)) {
    throw new SourceTabUnavailableError(
      "\uCE58\uC9C0\uC9C1\xB7YouTube \uC601\uC0C1 \uD0ED\uC744 \uD65C\uC131\uD654\uD558\uAC70\uB098 \uC800\uC7A5\uB41C \uC6D0\uBCF8 \uD398\uC774\uC9C0\uB97C \uB2E4\uC2DC \uC5F4\uC5B4 \uC8FC\uC138\uC694."
    );
  }
  return tab;
}
async function requestPageContext() {
  const tab = await getActiveSourceTab();
  return requestPageContextFromTab(tab);
}
async function requestPageContextFromTab(tab) {
  const response = await sendMessageToSourceTab(
    tab,
    { type: "KIRINUKI_GET_CONTEXT" }
  );
  if (!response?.ok) {
    throw new Error(response?.error || "\uC601\uC0C1 \uD398\uC774\uC9C0 \uC815\uBCF4\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  }
  return {
    ...response.context,
    sourceTabId: tab.id
  };
}
async function sendMessageToSourceTab(tab, message) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(
      tab.id,
      message
    );
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
    await wait(40);
    response = await chrome.tabs.sendMessage(
      tab.id,
      message
    );
  }
  return response;
}
function reserveSourceClockOperation() {
  return sourceClockOperationGate.reserve();
}
async function setSourcePlaybackRate(playbackRate) {
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
      throw new Error(response?.error || "\uC6D0\uBCF8 \uC7AC\uC0DD \uC18D\uB3C4\uB97C \uBC14\uAFB8\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
    if (currentContext && (!currentContext.sourceTabId || currentContext.sourceTabId === tab.id)) {
      currentContext = {
        ...currentContext,
        player: {
          ...currentContext.player || {},
          playbackRate: Number(response.player?.playbackRate) || playbackRate
        }
      };
    }
    setStatus(`\uC6D0\uBCF8 \uD50C\uB808\uC774\uC5B4\uB97C ${playbackRate}\uBC30\uC18D\uC73C\uB85C \uBC14\uAFE8\uC2B5\uB2C8\uB2E4.`, "success");
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
async function seekSourceBy(deltaSeconds) {
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
    contextRequestSequence += 1;
    const tab = await getActiveSourceTab();
    const response = await sendMessageToSourceTab(tab, {
      type: "KIRINUKI_PLAYER_COMMAND",
      action: "seek-relative",
      deltaSeconds
    });
    assertOperationCurrent(operationGeneration);
    if (!response?.ok) {
      throw new Error(response?.error || "\uC6D0\uBCF8 \uD50C\uB808\uC774\uC5B4 \uC704\uCE58\uB97C \uC62E\uAE30\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
    const mediaTime = Number(response.player?.currentTime);
    if (Number.isFinite(mediaTime) && currentContext && (!currentContext.sourceTabId || currentContext.sourceTabId === tab.id)) {
      const previousPlayer = currentContext.player || {};
      const previousPosition = Number(previousPlayer.positionSeconds);
      const previousRawPosition = Number(
        previousPlayer.rawMediaPositionSeconds
      );
      const previousLiveEdgeOffset = Number(
        previousPlayer.liveEdgeOffsetSeconds
      );
      const chzzkLiveMediaDelta = currentContext.platform === SOURCE_PLATFORM_CHZZK && currentContext.contentType === "live" && Number.isFinite(previousPosition) && Number.isFinite(previousRawPosition) ? mediaTime - previousRawPosition : null;
      currentContext = {
        ...currentContext,
        player: {
          ...previousPlayer,
          positionSeconds: chzzkLiveMediaDelta === null ? mediaTime : Math.max(0, previousPosition + chzzkLiveMediaDelta),
          rawMediaPositionSeconds: chzzkLiveMediaDelta === null ? previousPlayer.rawMediaPositionSeconds : mediaTime,
          liveEdgeOffsetSeconds: chzzkLiveMediaDelta !== null && Number.isFinite(previousLiveEdgeOffset) ? Math.max(0, previousLiveEdgeOffset - chzzkLiveMediaDelta) : previousPlayer.liveEdgeOffsetSeconds
        }
      };
      renderSource();
    }
    void refreshSourceTabAfterPlayerCommand(
      tab,
      operationGeneration
    );
    setStatus(
      `\uC6D0\uBCF8 \uC601\uC0C1\uC744 5\uCD08 ${deltaSeconds < 0 ? "\uB4A4\uB85C" : "\uC55E\uC73C\uB85C"} \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4.`,
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
async function refreshSourceTabAfterPlayerCommand(tab, operationGeneration) {
  const requestSequence = ++contextRequestSequence;
  try {
    const context = await requestPageContextFromTab(tab);
    if (requestSequence !== contextRequestSequence || resetInProgress || operationGeneration !== stateGeneration) {
      return;
    }
    currentContext = context;
    applyContextToProject(context);
    renderSource();
  } catch {
  }
}
async function requestLatestPageContext() {
  const requestSequence = ++contextRequestSequence;
  try {
    const context = await requestPageContext();
    if (requestSequence !== contextRequestSequence) {
      throw new DOMException("\uD604\uC7AC \uD0ED \uC815\uBCF4\uAC00 \uAC31\uC2E0\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", "AbortError");
    }
    return context;
  } catch (error) {
    if (requestSequence !== contextRequestSequence) {
      throw new DOMException("\uD604\uC7AC \uD0ED \uC815\uBCF4\uAC00 \uAC31\uC2E0\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", "AbortError");
    }
    throw error;
  }
}
async function requestForegroundPageContext() {
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
async function refreshSource({ silent = false } = {}) {
  if (resetInProgress || playerCommandInProgress || !canStartSourceRefresh({
    silent,
    foregroundRequestCount: foregroundContextRequestCount,
    backgroundRequestCount: sourceRefreshRequestCount
  })) {
    return;
  }
  sourceRefreshRequestCount += 1;
  try {
    currentContext = await requestLatestPageContext();
    applyContextToProject(currentContext);
    renderSource();
    if (!silent) {
      setStatus("\uD604\uC7AC \uC601\uC0C1 \uD0ED\uACFC \uD50C\uB808\uC774\uC5B4 \uC815\uBCF4\uB97C \uC77D\uC5C8\uC2B5\uB2C8\uB2E4.", "success");
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
async function captureCurrentPosition(kind) {
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
      throw new Error("\uAE30\uC874 \uAD6C\uAC04\uACFC \uB2E4\uB978 \uC6D0\uBCF8 \uC601\uC0C1\uC785\uB2C8\uB2E4. \uBAA8\uB4E0 \uB85C\uCEEC \uC791\uC5C5\uC744 \uCD08\uAE30\uD654\uD55C \uB4A4 \uAE30\uB85D\uD574 \uC8FC\uC138\uC694.");
    }
    if (context.platform === SOURCE_PLATFORM_YOUTUBE && context.contentType === "live") {
      throw new Error("\uC9C4\uD589 \uC911\uC778 YouTube \uB77C\uC774\uBE0C\uB294 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC\uBCF4\uAE30 \uC601\uC0C1\uC5D0\uC11C \uC2A4\uD0EC\uD504\uB97C \uCC0D\uC5B4 \uC8FC\uC138\uC694.");
    }
    if (context.player?.adActive) {
      throw new Error("YouTube \uAD11\uACE0 \uC7AC\uC0DD \uC911\uC5D0\uB294 \uC2A4\uD0EC\uD504\uB97C \uAE30\uB85D\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uBCF8 \uC601\uC0C1\uC774 \uC2DC\uC791\uB41C \uB4A4 \uB2E4\uC2DC \uB20C\uB7EC \uC8FC\uC138\uC694.");
    }
    const position = context.player?.positionSeconds;
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
      throw new Error("\uD604\uC7AC \uD50C\uB808\uC774\uC5B4 \uC2DC\uAC01\uC744 \uC77D\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC7AC\uC0DD\uC744 \uC2DC\uC791\uD558\uAC70\uB098 \uC2DC\uAC01\uC744 \uC9C1\uC811 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
    }
    const rounded = Math.round(position * 1e3) / 1e3;
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
    setStatus(`${kind === "start" ? "\uC2DC\uC791" : "\uB05D"} \uC2A4\uD0EC\uD504\uB97C ${formatTimestamp(rounded, { precision: 3 })}\uB85C \uAE30\uB85D\uD588\uC2B5\uB2C8\uB2E4.`, "success");
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
function captureOriginLabel(segment) {
  const start = segment.startCapture ? "\uD604\uC7AC \uC2DC\uAC01" : "\uC9C1\uC811 \uC785\uB825";
  const end = segment.endCapture ? "\uD604\uC7AC \uC2DC\uAC01" : "\uC9C1\uC811 \uC785\uB825";
  return `\uC2DC\uC791 ${start} \xB7 \uB05D ${end}`;
}
function renderSegments() {
  elements.segmentCount.textContent = String(state.segments.length);
  elements.segmentsEmpty.hidden = state.segments.length > 0;
  elements.segmentsList.replaceChildren();
  state.segments.forEach((segment, index) => {
    const fragment = elements.segmentTemplate.content.cloneNode(
      true
    );
    const item = requiredDescendant(fragment, ".segment-item");
    item.dataset.id = segment.id;
    item.classList.toggle("is-editing", state.draft.editingId === segment.id);
    requiredDescendant(
      fragment,
      ".segment-number"
    ).textContent = String(index + 1);
    requiredDescendant(
      fragment,
      ".segment-time"
    ).textContent = `${formatTimestamp(segment.startSeconds, { precision: 3 })} \u2192 ${formatTimestamp(segment.endSeconds, { precision: 3 })}`;
    requiredDescendant(
      fragment,
      ".segment-duration"
    ).textContent = `${(segment.endSeconds - segment.startSeconds).toFixed(3)}\uCD08`;
    requiredDescendant(
      fragment,
      ".segment-description"
    ).textContent = segment.description;
    requiredDescendant(
      fragment,
      ".segment-origin"
    ).textContent = captureOriginLabel(segment);
    const up = requiredDescendant(
      fragment,
      "[data-action='up']"
    );
    const down = requiredDescendant(
      fragment,
      "[data-action='down']"
    );
    up.disabled = index === 0;
    down.disabled = index === state.segments.length - 1;
    elements.segmentsList.append(fragment);
  });
}
async function saveSegment() {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  if (sourceConflict) {
    setStatus("\uAE30\uC874 \uAD6C\uAC04\uACFC \uB2E4\uB978 \uC6D0\uBCF8 \uC601\uC0C1\uC785\uB2C8\uB2E4. \uBAA8\uB4E0 \uB85C\uCEEC \uC791\uC5C5\uC744 \uCD08\uAE30\uD654\uD55C \uB4A4 \uAE30\uB85D\uD574 \uC8FC\uC138\uC694.", "error", 0);
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
    if (expectedSessionId && capturedSessionIds.some((sessionId) => sessionId !== expectedSessionId)) {
      throw new Error("\uC2DC\uC791\uACFC \uB05D\uC774 \uC11C\uB85C \uB2E4\uB978 \uC6D0\uBCF8 \uC601\uC0C1\uC5D0\uC11C \uAE30\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uAD6C\uAC04\uC744 \uB2E4\uC2DC \uCC0D\uC5B4 \uC8FC\uC138\uC694.");
    }
    const editingIndex = state.draft.editingId ? state.segments.findIndex((segment2) => segment2.id === state.draft.editingId) : -1;
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
    segment.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (editingIndex >= 0) {
      state.segments.splice(editingIndex, 1, segment);
    } else {
      state.segments.push(segment);
    }
    clearDraft();
    renderSegments();
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus(editingIndex >= 0 ? "\uAD6C\uAC04\uC744 \uC218\uC815\uD588\uC2B5\uB2C8\uB2E4." : "\uAD00\uC2EC \uAD6C\uAC04\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.", "success");
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error");
    }
  }
}
function startEditingSegment(id) {
  const segment = state.segments.find((candidate) => candidate.id === id);
  if (!segment) {
    return;
  }
  state.draft = {
    startText: formatTimestamp(segment.startSeconds, { precision: 3 }),
    endText: formatTimestamp(segment.endSeconds, { precision: 3 }),
    description: segment.description,
    startCapture: segment.startCapture,
    endCapture: segment.endCapture,
    editingId: segment.id
  };
  markDirtyField("draft", state.draft);
  renderDraft();
  renderSegments();
  schedulePersist();
  elements.captureCard.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.segmentDescription.focus({ preventScroll: true });
}
async function deleteSegment(id) {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  const index = state.segments.findIndex((segment) => segment.id === id);
  if (index < 0) {
    return;
  }
  if (!confirm(`\uAD6C\uAC04 ${index + 1}\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?`)) {
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
      setStatus("\uAD6C\uAC04\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.", "success");
    }
  } catch (error) {
    if (!isAbortError(error) && !resetInProgress && operationGeneration === stateGeneration) {
      setStatus(`\uAD6C\uAC04\uC744 \uC0AD\uC81C\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error");
    }
  }
}
async function moveSegment(id, direction) {
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
    if (!isAbortError(error) && !resetInProgress && operationGeneration === stateGeneration) {
      setStatus(`\uAD6C\uAC04 \uC21C\uC11C\uB97C \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error");
    }
  }
}
function createPromptBundle(generatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  state.projectName = elements.projectName.value.trim();
  state.globalInstruction = elements.globalInstruction.value.trim();
  state.source.streamerName = elements.streamerName.value.trim();
  state.source.broadcastTitle = elements.broadcastTitle.value.trim();
  if (!editingGuideMarkdown || !creatorPolicyMarkdown || !codexJobAgentsMarkdown) {
    throw new Error("\uB0B4\uC7A5 MD \uC9C0\uCE68\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. Extension\uC744 \uB2E4\uC2DC \uB85C\uB4DC\uD574 \uC8FC\uC138\uC694.");
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
function createPrompt(generatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  return createPromptBundle(generatedAt).prompt;
}
function showPrompt(prompt) {
  lastPrompt = prompt;
  elements.promptPreview.value = lastPrompt;
  elements.promptCharacterCount.textContent = lastPrompt.length.toLocaleString("ko-KR");
  elements.promptResult.hidden = false;
}
async function generatePrompt() {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  try {
    showPrompt(createPrompt());
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus("Codex\uC6A9 uniform \uD504\uB86C\uD504\uD2B8\uB97C \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4.", "success");
    elements.promptPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error");
    }
  }
}
async function writeTextFile(directoryHandle, fileName, contents) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {
    });
    throw error;
  }
}
function codexJobFolderName(generatedAt) {
  const baseName = state.projectName || [state.source.streamerName, state.source.broadcastTitle].filter(Boolean).join("-");
  const compactTimestamp = generatedAt.replace(/\D/g, "").slice(0, 17);
  return `${sanitizeFileName(baseName, "chzzk-kirinuki-job")}-${compactTimestamp}`;
}
async function createCodexJobFolder() {
  if (resetInProgress) {
    return;
  }
  const operationGeneration = stateGeneration;
  if (typeof window.showDirectoryPicker !== "function") {
    setStatus("\uC774 \uBE0C\uB77C\uC6B0\uC800\uB294 \uC791\uC5C5\uD3F4\uB354 \uC800\uC7A5\uC744 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. MD \uB2E4\uC6B4\uB85C\uB4DC\uB97C \uC0AC\uC6A9\uD574 \uC8FC\uC138\uC694.", "error", 0);
    return;
  }
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  let prompt;
  let manifest;
  let startHere;
  let compiledPolicyMarkdown;
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
  let parentDirectory;
  try {
    parentDirectory = await window.showDirectoryPicker({
      id: "chzzk-kirinuki-codex-jobs",
      mode: "readwrite"
    });
    assertOperationCurrent(operationGeneration);
  } catch (error) {
    if (!isAbortError(error) && !resetInProgress && operationGeneration === stateGeneration) {
      setStatus(`\uD3F4\uB354\uB97C \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error");
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
      writeTextFile(jobDirectory, "creator-policy-index.json", `${JSON.stringify(creatorPolicyIndex, null, 2)}
`),
      writeTextFile(jobDirectory, "AGENTS.md", codexJobAgentsMarkdown),
      writeTextFile(jobDirectory, "START_HERE.md", startHere),
      writeTextFile(jobDirectory, "job-manifest.json", `${JSON.stringify(manifest, null, 2)}
`)
    ]);
    assertOperationCurrent(operationGeneration);
    showPrompt(prompt);
    await persistState();
    assertOperationCurrent(operationGeneration);
    setStatus(`${folderName} \uC791\uC5C5\uD3F4\uB354\uB97C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4. \uD480\uC601\uC0C1 \uD558\uB098\uB97C \uB123\uACE0 START_HERE.md\uB97C \uB530\uB77C\uAC00\uC138\uC694.`, "success", 8e3);
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(`\uC791\uC5C5\uD3F4\uB354\uB97C \uB9CC\uB4E4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error", 0);
    }
  } finally {
    elements.createCodexJob.disabled = resetInProgress;
  }
}
async function openIntegratedEditor() {
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
    setStatus("\uD3B8\uC9D1\uAE30\uB85C \uB118\uAE38 \uAD6C\uAC04\uC744 \uD558\uB098 \uC774\uC0C1 \uC800\uC7A5\uD574 \uC8FC\uC138\uC694.", "error");
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
    if (sourceConflict || !sameSourceSession(state.source, activeSource)) {
      throw new Error("\uC800\uC7A5 \uAD6C\uAC04\uACFC \uD604\uC7AC \uC601\uC0C1 \uD0ED\uC758 \uC6D0\uBCF8\uC774 \uB2E4\uB985\uB2C8\uB2E4. \uC6D0\uB798 \uC601\uC0C1 \uD0ED\uC5D0\uC11C \uB2E4\uC2DC \uC5F4\uC5B4 \uC8FC\uC138\uC694.");
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
      throw new Error(response?.error || "\uD1B5\uD569 \uD3B8\uC9D1\uAE30\uB97C \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
    assertOperationCurrent(operationGeneration);
    setStatus("\uC120\uD0DD \uAD6C\uAC04\uC744 \uD1B5\uD569 \uD3B8\uC9D1\uAE30\uB85C \uB118\uACBC\uC2B5\uB2C8\uB2E4.", "success");
  } catch (error) {
    if (!resetInProgress && operationGeneration === stateGeneration) {
      setStatus(errorMessage(error), "error", 0);
    }
  } finally {
    elements.openEditor.disabled = resetInProgress;
  }
}
async function copyPrompt() {
  if (!lastPrompt) {
    return;
  }
  try {
    await navigator.clipboard.writeText(lastPrompt);
    setStatus("\uD504\uB86C\uD504\uD2B8\uB97C \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.", "success");
  } catch (error) {
    setStatus(`\uBCF5\uC0AC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error");
  }
}
function downloadPrompt() {
  if (!lastPrompt) {
    return;
  }
  const baseName = state.projectName || [state.source.streamerName, state.source.broadcastTitle].filter(Boolean).join("-");
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replaceAll("-", "");
  const fileName = `${sanitizeFileName(baseName)}-${date}.md`;
  const url = URL.createObjectURL(new Blob([lastPrompt], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
  setStatus(`${fileName} \uD30C\uC77C\uC744 \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4.`, "success");
}
function lockControlsForReset() {
  document.body.inert = true;
  for (const control of document.querySelectorAll("button, input, textarea, select")) {
    control.disabled = true;
  }
}
function restoreControlsAfterReset() {
  document.body.inert = false;
  for (const control of document.querySelectorAll("button, input, textarea, select")) {
    control.disabled = false;
  }
  renderSegments();
}
async function resetProject() {
  if (resetInProgress) {
    return;
  }
  if (!confirm("\uC5F4\uB9B0 \uD1B5\uD569 \uD3B8\uC9D1\uAE30\uB97C \uB2EB\uACE0 \uC800\uC7A5\uB41C \uBAA8\uB4E0 \uAD6C\uAC04\xB7\uD504\uB85C\uC81D\uD2B8\xB7\uC784\uC2DC\uC800\uC7A5\xB7\uC6D0\uBCF8 \uD30C\uC77C \uAD8C\uD55C\uC744 \uCD08\uAE30\uD654\uD560\uAE4C\uC694? \uB514\uC2A4\uD06C\uC758 \uC6D0\uBCF8 \uC601\uC0C1\uACFC \uC774\uBBF8 \uB0B4\uBCF4\uB0B8 \uD30C\uC77C\uC740 \uC0AD\uC81C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.")) {
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
    await persistenceChain.catch(() => {
    });
    const response = await sendRuntimeMessage({
      type: "KIRINUKI_RESET_BINDINGS",
      writerId: panelWriterId
    });
    if (!response?.ok) {
      throw new Error(response?.error || "\uC601\uC0C1 \uD0ED \uC5F0\uACB0 \uC815\uBCF4\uB97C \uC9C0\uC6B0\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
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
        `\uD504\uB85C\uC81D\uD2B8 \uC0C1\uD0DC\uB294 \uCD08\uAE30\uD654\uD588\uC9C0\uB9CC \uC77C\uBD80 \uC815\uB9AC\uAC00 \uB0A8\uC558\uC2B5\uB2C8\uB2E4: ${cleanupErrors.join(" \xB7 ")} \uB2E4\uC2DC \uCD08\uAE30\uD654\uD574 \uC8FC\uC138\uC694.`,
        "error",
        0
      );
    } else {
      setStatus("\uAD6C\uAC04\xB7\uD3B8\uC9D1 \uD504\uB85C\uC81D\uD2B8\xB7\uC784\uC2DC\uC800\uC7A5\xB7\uC6D0\uBCF8 \uD30C\uC77C \uAD8C\uD55C\uC744 \uCD08\uAE30\uD654\uD588\uC2B5\uB2C8\uB2E4.", "success", 6500);
    }
  } catch (error) {
    setStatus(`\uD504\uB85C\uC81D\uD2B8\uB97C \uC644\uC804\uD788 \uCD08\uAE30\uD654\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${errorMessage(error)}`, "error", 0);
  } finally {
    resetInProgress = false;
    restoreControlsAfterReset();
  }
}
function bindInputPersistence() {
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
    if (state.draft.startCapture && Math.abs((parseTimestamp(elements.startTime.value) ?? -1) - state.draft.startCapture.rawSeconds) > 1e-3) {
      state.draft.startCapture = null;
    }
    markDirtyField("draft", state.draft);
    schedulePersist();
  });
  elements.endTime.addEventListener("input", () => {
    state.draft.endText = elements.endTime.value;
    if (state.draft.endCapture && Math.abs((parseTimestamp(elements.endTime.value) ?? -1) - state.draft.endCapture.rawSeconds) > 1e-3) {
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
function bindActions() {
  elements.refreshRecoverySessions.addEventListener(
    "click",
    () => void refreshRecoverySessions()
  );
  elements.recoverySessionsList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest(
      "button[data-recovery-action]"
    );
    const item = event.target.closest(".recovery-session");
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
    const button = event.target.closest("button[data-action]");
    const item = event.target.closest(".segment-item");
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
async function initialize() {
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
    setStatus(`Extension \uCD08\uAE30\uD654 \uC2E4\uD328: ${errorMessage(error)}`, "error", 0);
  }
  await recoveryLoad;
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      void refreshSource({ silent: true });
    }
  }, 4e3);
}
window.addEventListener("beforeunload", () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  void persistState().catch(() => {
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    void persistState().catch((error) => {
      if (!isAbortError(error)) {
        setStatus(`\uC800\uC7A5 \uC2E4\uD328: ${errorMessage(error)}`, "error");
      }
    });
  } else {
    void refreshRecoverySessions({ silent: true });
  }
});
chrome.storage.onChanged.addListener(handleStorageChange);
void initialize();
