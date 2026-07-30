export const RECOVERY_SESSION_MODE = "resume";
export const RECOVERY_DRAFTS_MODE = "drafts";
export const MAX_RECOVERY_SESSIONS = 12;

interface RecoveryProject {
  id?: unknown;
  name?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  clips?: unknown;
  subtitles?: unknown;
  imageAssets?: unknown;
  audioRegions?: unknown;
}

interface RecoveryDraft {
  id?: unknown;
  projectId?: unknown;
  project?: RecoveryProject | null;
  reason?: unknown;
  createdAtMs?: unknown;
  createdAt?: unknown;
}

interface RecoveryCounts {
  clips: number;
  subtitles: number;
  assets: number;
  audio: number;
}

export interface RecoverySessionSummary {
  projectId: string;
  title: string;
  updatedAt: string | null;
  updatedAtMs: number;
  counts: RecoveryCounts;
  draftCount: number;
  latestDraftReason: string | null;
  latestDraftAt: string | null;
}

function normalizedProjectId(value: unknown): string {
  const projectId = String(value || "").trim();
  if (!projectId || projectId.length > 256) {
    return "";
  }
  return projectId;
}

function timestampMs(value: unknown): number {
  if (value == null || value === "") {
    return 0;
  }
  const parsed = typeof value === "number"
    ? value
    : Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function collectionLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function projectCounts(project: RecoveryProject | null | undefined): RecoveryCounts {
  return {
    clips: collectionLength(project?.clips),
    subtitles: collectionLength(project?.subtitles),
    assets: collectionLength(project?.imageAssets),
    audio: collectionLength(project?.audioRegions)
  };
}

function draftTimestampMs(draft: RecoveryDraft | null | undefined): number {
  return timestampMs(draft?.createdAtMs) || timestampMs(draft?.createdAt);
}

function projectTimestampMs(project: RecoveryProject | null | undefined): number {
  return timestampMs(project?.updatedAt) || timestampMs(project?.createdAt);
}

function compareNewestFirst(
  first: RecoverySessionSummary,
  second: RecoverySessionSummary
): number {
  return (
    second.updatedAtMs - first.updatedAtMs
    || first.title.localeCompare(second.title, "ko")
    || first.projectId.localeCompare(second.projectId)
  );
}

/**
 * IndexedDB records can contain the whole edit graph. This projection deliberately
 * returns only the fields needed by the sidepanel and never forwards provider keys,
 * media handles, captions, image data, or any other project payload.
 */
export function buildRecoverySessionSummaries(
  projects: readonly RecoveryProject[] | unknown,
  drafts: readonly RecoveryDraft[] | unknown,
  { limit = MAX_RECOVERY_SESSIONS }: { limit?: number } = {}
): RecoverySessionSummary[] {
  const draftsByProject = new Map<string, RecoveryDraft[]>();
  for (const draft of (Array.isArray(drafts) ? drafts : []) as RecoveryDraft[]) {
    const projectId = normalizedProjectId(draft?.projectId);
    if (!projectId || String(draft?.project?.id || "") !== projectId) {
      continue;
    }
    const entries = draftsByProject.get(projectId) || [];
    entries.push(draft);
    draftsByProject.set(projectId, entries);
  }

  const summaries: RecoverySessionSummary[] = [];
  const seenProjectIds = new Set<string>();
  for (const project of (Array.isArray(projects) ? projects : []) as RecoveryProject[]) {
    const projectId = normalizedProjectId(project?.id);
    if (!projectId || seenProjectIds.has(projectId)) {
      continue;
    }
    seenProjectIds.add(projectId);
    const projectDrafts = (draftsByProject.get(projectId) || [])
      .sort((first, second) => (
        draftTimestampMs(second) - draftTimestampMs(first)
        || String(second?.id || "").localeCompare(String(first?.id || ""))
      ));
    const latestDraft = projectDrafts[0] || null;
    const projectUpdatedAtMs = projectTimestampMs(project);
    const latestDraftAtMs = draftTimestampMs(latestDraft);
    const updatedAtMs = Math.max(projectUpdatedAtMs, latestDraftAtMs);
    const title = String(project?.name || latestDraft?.project?.name || "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160) || "제목 없는 키리누키 프로젝트";

    summaries.push({
      projectId,
      title,
      updatedAt: updatedAtMs > 0
        ? new Date(updatedAtMs).toISOString()
        : null,
      updatedAtMs,
      counts: projectCounts(project),
      draftCount: projectDrafts.length,
      latestDraftReason: latestDraft
        ? String(latestDraft.reason || "manual").slice(0, 32)
        : null,
      latestDraftAt: latestDraftAtMs > 0
        ? new Date(latestDraftAtMs).toISOString()
        : null
    });
  }

  const requestedLimit = Number(limit);
  const normalizedLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(50, Math.floor(requestedLimit)))
    : MAX_RECOVERY_SESSIONS;
  return summaries.sort(compareNewestFirst).slice(0, normalizedLimit);
}

export function buildSavedEditorUrl(editorRoot: string | URL, projectId: unknown, {
  recoveryDrafts = false
}: { recoveryDrafts?: boolean } = {}): string {
  const normalizedId = normalizedProjectId(projectId);
  if (!normalizedId) {
    throw new TypeError("다시 열 프로젝트 ID가 올바르지 않습니다.");
  }
  const url = new URL(editorRoot);
  url.searchParams.set("project", normalizedId);
  url.searchParams.set("session", RECOVERY_SESSION_MODE);
  if (recoveryDrafts) {
    url.searchParams.set("recovery", RECOVERY_DRAFTS_MODE);
  }
  return url.href;
}

export function editorTabMatchesProject(
  tabUrl: string | URL,
  editorRoot: string | URL,
  projectId: unknown
): boolean {
  const normalizedId = normalizedProjectId(projectId);
  if (!normalizedId) {
    return false;
  }
  try {
    const tab = new URL(tabUrl);
    const root = new URL(editorRoot);
    return (
      tab.origin === root.origin
      && tab.pathname === root.pathname
      && tab.searchParams.get("project") === normalizedId
    );
  } catch {
    return false;
  }
}
