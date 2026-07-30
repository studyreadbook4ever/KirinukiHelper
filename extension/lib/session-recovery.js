// Generated from TypeScript sources. Do not edit directly.
const RECOVERY_SESSION_MODE = "resume";
const RECOVERY_DRAFTS_MODE = "drafts";
const MAX_RECOVERY_SESSIONS = 12;
function normalizedProjectId(value) {
  const projectId = String(value || "").trim();
  if (!projectId || projectId.length > 256) {
    return "";
  }
  return projectId;
}
function timestampMs(value) {
  if (value == null || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function collectionLength(value) {
  return Array.isArray(value) ? value.length : 0;
}
function projectCounts(project) {
  return {
    clips: collectionLength(project?.clips),
    subtitles: collectionLength(project?.subtitles),
    assets: collectionLength(project?.imageAssets),
    audio: collectionLength(project?.audioRegions)
  };
}
function draftTimestampMs(draft) {
  return timestampMs(draft?.createdAtMs) || timestampMs(draft?.createdAt);
}
function projectTimestampMs(project) {
  return timestampMs(project?.updatedAt) || timestampMs(project?.createdAt);
}
function compareNewestFirst(first, second) {
  return second.updatedAtMs - first.updatedAtMs || first.title.localeCompare(second.title, "ko") || first.projectId.localeCompare(second.projectId);
}
function buildRecoverySessionSummaries(projects, drafts, { limit = MAX_RECOVERY_SESSIONS } = {}) {
  const draftsByProject = /* @__PURE__ */ new Map();
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    const projectId = normalizedProjectId(draft?.projectId);
    if (!projectId || String(draft?.project?.id || "") !== projectId) {
      continue;
    }
    const entries = draftsByProject.get(projectId) || [];
    entries.push(draft);
    draftsByProject.set(projectId, entries);
  }
  const summaries = [];
  const seenProjectIds = /* @__PURE__ */ new Set();
  for (const project of Array.isArray(projects) ? projects : []) {
    const projectId = normalizedProjectId(project?.id);
    if (!projectId || seenProjectIds.has(projectId)) {
      continue;
    }
    seenProjectIds.add(projectId);
    const projectDrafts = (draftsByProject.get(projectId) || []).sort((first, second) => draftTimestampMs(second) - draftTimestampMs(first) || String(second?.id || "").localeCompare(String(first?.id || "")));
    const latestDraft = projectDrafts[0] || null;
    const projectUpdatedAtMs = projectTimestampMs(project);
    const latestDraftAtMs = draftTimestampMs(latestDraft);
    const updatedAtMs = Math.max(projectUpdatedAtMs, latestDraftAtMs);
    const title = String(project?.name || latestDraft?.project?.name || "").replace(/\s+/gu, " ").trim().slice(0, 160) || "\uC81C\uBAA9 \uC5C6\uB294 \uD0A4\uB9AC\uB204\uD0A4 \uD504\uB85C\uC81D\uD2B8";
    summaries.push({
      projectId,
      title,
      updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
      updatedAtMs,
      counts: projectCounts(project),
      draftCount: projectDrafts.length,
      latestDraftReason: latestDraft ? String(latestDraft.reason || "manual").slice(0, 32) : null,
      latestDraftAt: latestDraftAtMs > 0 ? new Date(latestDraftAtMs).toISOString() : null
    });
  }
  const requestedLimit = Number(limit);
  const normalizedLimit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(50, Math.floor(requestedLimit))) : MAX_RECOVERY_SESSIONS;
  return summaries.sort(compareNewestFirst).slice(0, normalizedLimit);
}
function buildSavedEditorUrl(editorRoot, projectId, {
  recoveryDrafts = false
} = {}) {
  const normalizedId = normalizedProjectId(projectId);
  if (!normalizedId) {
    throw new TypeError("\uB2E4\uC2DC \uC5F4 \uD504\uB85C\uC81D\uD2B8 ID\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  }
  const url = new URL(editorRoot);
  url.searchParams.set("project", normalizedId);
  url.searchParams.set("session", RECOVERY_SESSION_MODE);
  if (recoveryDrafts) {
    url.searchParams.set("recovery", RECOVERY_DRAFTS_MODE);
  }
  return url.href;
}
function editorTabMatchesProject(tabUrl, editorRoot, projectId) {
  const normalizedId = normalizedProjectId(projectId);
  if (!normalizedId) {
    return false;
  }
  try {
    const tab = new URL(tabUrl);
    const root = new URL(editorRoot);
    return tab.origin === root.origin && tab.pathname === root.pathname && tab.searchParams.get("project") === normalizedId;
  } catch {
    return false;
  }
}
export {
  MAX_RECOVERY_SESSIONS,
  RECOVERY_DRAFTS_MODE,
  RECOVERY_SESSION_MODE,
  buildRecoverySessionSummaries,
  buildSavedEditorUrl,
  editorTabMatchesProject
};
