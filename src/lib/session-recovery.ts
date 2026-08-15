import {
  sourceSessionIdentity
} from "./editor-core.js";
import type {
  SourceRecord
} from "./editor-core.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  canonicalSourceUrl,
  inferSourceIdentifiers,
  isSupportedSourceUrl
} from "./source-platform.js";
import {
  normalizeSoopVodSourceClockIdentity
} from "./soop-vod-source-clock.js";

export const RECOVERY_SESSION_MODE = "resume";
export const RECOVERY_DRAFTS_MODE = "drafts";
export const MAX_RECOVERY_SESSIONS = 12;
const MAX_RECOVERY_SOURCE_URL_LENGTH = 2_048;
const YOUTUBE_CONTENT_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const SOOP_CONTENT_ID_PATTERN = /^\d{1,32}$/u;
const CHZZK_CHANNEL_ID_PATTERN = /^[a-f0-9]{32}$/iu;
const CHZZK_CONTENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

interface RecoveryProject {
  id?: unknown;
  name?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  clips?: unknown;
  subtitles?: unknown;
  imageAssets?: unknown;
  audioRegions?: unknown;
  source?: SourceRecord;
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
  sourceSessionId: string;
}

function sourceRecord(value: unknown): SourceRecord | null {
  return (
    value
    && typeof value === "object"
    && !Array.isArray(value)
  ) ? value as SourceRecord : null;
}

function sourceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function reconstructedSourceUrl(source: SourceRecord): string {
  const platform = sourceString(source.platform).toUpperCase()
    || SOURCE_PLATFORM_CHZZK;
  const contentType = sourceString(source.contentType).toLowerCase();
  const contentId = sourceString(source.contentId);
  const channelId = sourceString(source.channelId);
  if (
    platform === SOURCE_PLATFORM_YOUTUBE
    && (contentType === "vod" || contentType === "live")
    && YOUTUBE_CONTENT_ID_PATTERN.test(contentId)
  ) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(contentId)}`;
  }
  if (
    platform === SOURCE_PLATFORM_SOOP
    && contentType === "vod"
    && SOOP_CONTENT_ID_PATTERN.test(contentId)
  ) {
    return `https://vod.sooplive.com/player/${encodeURIComponent(contentId)}`;
  }
  if (platform !== SOURCE_PLATFORM_CHZZK) {
    return "";
  }
  if (
    contentType === "live"
    && CHZZK_CHANNEL_ID_PATTERN.test(channelId)
  ) {
    return `https://chzzk.naver.com/live/${encodeURIComponent(channelId)}`;
  }
  if (
    contentType === "vod"
    && CHZZK_CONTENT_ID_PATTERN.test(contentId)
  ) {
    return `https://chzzk.naver.com/video/${encodeURIComponent(contentId)}`;
  }
  if (
    contentType === "clip"
    && CHZZK_CONTENT_ID_PATTERN.test(contentId)
  ) {
    return `https://chzzk.naver.com/clips/${encodeURIComponent(contentId)}`;
  }
  return "";
}

function sourceIdentityAllowsUrl(
  source: SourceRecord,
  url: string
): boolean {
  const inferred = inferSourceIdentifiers(url);
  const platform = sourceString(source.platform).toUpperCase();
  const contentType = sourceString(source.contentType).toLowerCase();
  const contentId = sourceString(source.contentId);
  const channelId = sourceString(source.channelId);
  const youtubeLiveUrlPair = (
    platform === SOURCE_PLATFORM_YOUTUBE
    && contentType === "live"
    && inferred.platform === SOURCE_PLATFORM_YOUTUBE
    && inferred.contentType === "vod"
  );
  const chzzkLiveWithoutContentId = (
    inferred.platform === SOURCE_PLATFORM_CHZZK
    && inferred.contentType === "live"
  );
  return !(
    (platform && platform !== inferred.platform)
    || (
      contentType
      && contentType !== "unknown"
      && contentType !== inferred.contentType
      && !youtubeLiveUrlPair
    )
    || (
      contentId
      && !chzzkLiveWithoutContentId
      && contentId !== inferred.contentId
    )
    || (channelId && inferred.channelId && channelId !== inferred.channelId)
  );
}

function hasBoundedRecoveryIdentifiers(url: string): boolean {
  const identifiers = inferSourceIdentifiers(url);
  if (identifiers.platform === SOURCE_PLATFORM_YOUTUBE) {
    return (
      identifiers.contentType === "vod"
      && YOUTUBE_CONTENT_ID_PATTERN.test(identifiers.contentId)
    );
  }
  if (identifiers.platform === SOURCE_PLATFORM_SOOP) {
    return (
      identifiers.contentType === "vod"
      && SOOP_CONTENT_ID_PATTERN.test(identifiers.contentId)
    );
  }
  if (identifiers.platform !== SOURCE_PLATFORM_CHZZK) {
    return false;
  }
  if (identifiers.contentType === "live") {
    return CHZZK_CHANNEL_ID_PATTERN.test(identifiers.channelId);
  }
  return (
    (identifiers.contentType === "vod" || identifiers.contentType === "clip")
    && CHZZK_CONTENT_ID_PATTERN.test(identifiers.contentId)
  );
}

/**
 * Restores only an allow-listed public source URL. Persisted projects are user
 * documents, so their URL is treated as untrusted input and canonicalized before
 * it is ever used for navigation.
 */
export function recoverySourceRecord(value: unknown): SourceRecord | null {
  const source = sourceRecord(value);
  if (!source) {
    return null;
  }
  const candidates = [
    sourceString(source.canonicalUrl),
    sourceString(source.url),
    reconstructedSourceUrl(source)
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      candidate.length > MAX_RECOVERY_SOURCE_URL_LENGTH
      || !isSupportedSourceUrl(candidate)
    ) {
      continue;
    }
    const canonicalUrl = canonicalSourceUrl(candidate);
    if (
      !canonicalUrl
      || canonicalUrl.length > MAX_RECOVERY_SOURCE_URL_LENGTH
      || !isSupportedSourceUrl(canonicalUrl)
      || !hasBoundedRecoveryIdentifiers(canonicalUrl)
      || !sourceIdentityAllowsUrl(source, canonicalUrl)
    ) {
      continue;
    }
    const inferred = inferSourceIdentifiers(canonicalUrl);
    const sourceClockIdentity = inferred.platform === SOURCE_PLATFORM_SOOP
      ? normalizeSoopVodSourceClockIdentity(source.sourceClockIdentity)
      : null;
    const broadcastStartedAt = sourceString(source.broadcastStartedAt)
      .slice(0, 128);
    if (
      inferred.platform === SOURCE_PLATFORM_CHZZK
      && inferred.contentType === "live"
      && !broadcastStartedAt
    ) {
      // A CHZZK live URL identifies a channel, not a broadcast. Without the
      // saved start time, a later stream on the same channel is indistinguishable.
      continue;
    }
    return {
      platform: inferred.platform,
      channelId: (sourceString(source.channelId) || inferred.channelId)
        .slice(0, 128),
      broadcastStartedAt,
      contentId: inferred.contentId,
      contentType: inferred.contentType,
      canonicalUrl,
      url: canonicalUrl,
      broadcastTitle: sourceString(source.broadcastTitle).slice(0, 512),
      streamerName: sourceString(source.streamerName).slice(0, 256),
      ...(sourceClockIdentity
        && sourceClockIdentity.contentId === inferred.contentId
        ? { sourceClockIdentity }
        : {})
    };
  }
  return null;
}

export function recoverySourceUrl(value: unknown): string | null {
  return sourceString(recoverySourceRecord(value)?.canonicalUrl) || null;
}

export function tabMatchesRecoverySource(
  tabUrl: unknown,
  source: unknown
): boolean {
  const expectedUrl = recoverySourceUrl(source);
  if (!expectedUrl) {
    return false;
  }
  return recoverySourceUrl({ canonicalUrl: tabUrl }) === expectedUrl;
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
 * returns only the fields needed by the start screen and never forwards provider keys,
 * source URLs, media handles, captions, image data, or any other project payload.
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
        : null,
      sourceSessionId: sourceSessionIdentity(
        recoverySourceRecord(project.source) ?? undefined
      )
        || `saved-project:${projectId}`
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
