import {
  createEditorProjectFromCapture,
  normalizeEditorProject,
  sourceSessionIdentity
} from "../lib/editor-core.js";
import type {
  CaptureState,
  EditorClip,
  SourceRecord
} from "../lib/editor-core.js";
import {
  recoverySourceRecord
} from "../lib/session-recovery.js";
import {
  MEDIA_RECOVERY_SCHEMA,
  buildSessionArchive,
  parseSessionArchiveJson,
  stringifySessionArchive
} from "../lib/session-archive.js";
import type {
  SessionArchive,
  SessionArchiveMediaRecovery,
  SessionArchiveMediaSource
} from "../lib/session-archive.js";

export const SESSION_ARCHIVE_CAPTURE_MAX_CLIPS = 500;
export const SESSION_ARCHIVE_CAPTURE_MIN_DURATION_MS = 100;

const REMOTE_VOD_PLATFORMS = new Set(["CHZZK", "YOUTUBE", "SOOP"]);

export interface SessionArchiveCaptureSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly note: string;
}

export interface SessionArchiveCapture {
  readonly sourceUrl: string;
  readonly source: SourceRecord;
  readonly projectName: string;
  readonly segments: readonly SessionArchiveCaptureSegment[];
  readonly archiveCreatedAt: string;
}

export interface SessionArchiveCaptureExportOptions {
  readonly projectId: string;
  readonly createdAt?: string;
}

type UnknownRecord = Record<string, unknown>;

function plainRecord(value: unknown, label: string): UnknownRecord {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  }
  return value as UnknownRecord;
}

function exactSourceMilliseconds(
  value: unknown,
  label: string
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label}은 0 이상의 안전한 정수 밀리초여야 합니다.`);
  }
  return Number(value);
}

function normalizedCaptureProjectName(value: unknown): string {
  const projectName = String(value ?? "").normalize("NFKC").trim();
  if (!projectName || projectName.length > 160) {
    throw new TypeError("백업할 프로젝트 이름은 1~160자여야 합니다.");
  }
  return projectName;
}

function normalizedCaptureSegments(
  value: CaptureState["segments"]
): NonNullable<CaptureState["segments"]> {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > SESSION_ARCHIVE_CAPTURE_MAX_CLIPS
  ) {
    throw new TypeError(
      `백업할 컷은 1~${SESSION_ARCHIVE_CAPTURE_MAX_CLIPS}개여야 합니다.`
    );
  }
  return value.map((segment, index) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new TypeError(`${index + 1}번 컷 형식이 올바르지 않습니다.`);
    }
    const startSeconds = Number(segment.startSeconds);
    const endSeconds = Number(segment.endSeconds);
    if (
      typeof segment.startSeconds !== "number"
      || typeof segment.endSeconds !== "number"
      || !Number.isFinite(startSeconds)
      || !Number.isFinite(endSeconds)
      || startSeconds < 0
      || endSeconds < 0
    ) {
      throw new TypeError(`${index + 1}번 컷 시각이 올바르지 않습니다.`);
    }
    const startMs = Math.round(startSeconds * 1_000);
    const endMs = Math.round(endSeconds * 1_000);
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
      throw new TypeError(`${index + 1}번 컷 시각이 안전한 밀리초 범위를 넘었습니다.`);
    }
    if (endMs - startMs < SESSION_ARCHIVE_CAPTURE_MIN_DURATION_MS) {
      throw new TypeError(`${index + 1}번 컷은 0.1초 이상이어야 합니다.`);
    }
    const note = String(segment.description ?? "").normalize("NFKC").trim();
    if (note.length > 160) {
      throw new TypeError(`${index + 1}번 컷 메모는 160자 이하여야 합니다.`);
    }
    const selectionId = String(segment.id ?? "").trim();
    return {
      ...(selectionId ? { id: selectionId } : {}),
      startSeconds: startMs / 1_000,
      endSeconds: endMs / 1_000,
      description: note
    };
  });
}

function normalizedCaptureSource(value: unknown): SourceRecord {
  const source = recoverySourceRecord(value);
  if (
    !source
    || source.contentType !== "vod"
    || !REMOTE_VOD_PLATFORMS.has(String(source.platform || "").toUpperCase())
    || !source.canonicalUrl
    || !source.contentId
  ) {
    throw new TypeError(
      "백업할 CHZZK·YouTube·SOOP 단일 공개 VOD 주소를 확인하지 못했습니다."
    );
  }
  return source;
}

function captureMediaRecovery(source: SourceRecord): SessionArchiveMediaRecovery {
  const platform = String(source.platform || "").toUpperCase();
  if (!REMOTE_VOD_PLATFORMS.has(platform)) {
    throw new TypeError("백업할 VOD 플랫폼을 확인하지 못했습니다.");
  }
  return {
    schema: MEDIA_RECOVERY_SCHEMA,
    mode: "redownload-vod",
    source: {
      platform: platform as Exclude<SessionArchiveMediaSource["platform"], "LOCAL">,
      contentType: "vod",
      contentId: String(source.contentId),
      canonicalUrl: String(source.canonicalUrl)
    },
    localMedia: null,
    materialization: null,
    vodBytesIncluded: false
  };
}

/**
 * Serializes the current cut-selection form as the same v1 archive consumed by
 * both the start screen and editor. Only a fresh project skeleton is created;
 * media bytes, browser policy state, credentials, and editor history are not
 * capture-session inputs and therefore cannot enter this file.
 */
export async function sessionArchiveJsonFromCaptureState(
  captureState: CaptureState,
  {
    projectId,
    createdAt
  }: SessionArchiveCaptureExportOptions
): Promise<string> {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId || normalizedProjectId.length > 256) {
    throw new TypeError("백업할 편집 프로젝트 ID가 올바르지 않습니다.");
  }
  const source = normalizedCaptureSource(captureState?.source);
  const projectName = normalizedCaptureProjectName(captureState?.projectName);
  const segments = normalizedCaptureSegments(captureState?.segments);
  const rootProject = createEditorProjectFromCapture({
    source,
    projectName,
    segments
  }, { id: normalizedProjectId });
  const archive = await buildSessionArchive({
    rootProject,
    exportKind: "main",
    exportSnapshot: { projectId: rootProject.id },
    mediaRecovery: captureMediaRecovery(source),
    resolveImageAssetBlob: async () => null,
    ...(createdAt === undefined ? {} : { createdAt })
  });
  const json = await stringifySessionArchive(archive);

  // Keep the producer tied to the stricter capture importer, including its
  // source-identity, active-main-clip, count, and millisecond checks.
  const restored = await sessionArchiveCaptureFromJson(json);
  if (
    restored.sourceUrl !== source.canonicalUrl
    || restored.projectName !== projectName
    || restored.segments.length !== segments.length
    || restored.segments.some((segment, index) => {
      const expected = segments[index];
      return !expected
        || segment.startSeconds !== expected.startSeconds
        || segment.endSeconds !== expected.endSeconds
        || segment.note !== expected.description;
    })
  ) {
    throw new TypeError("만든 백업 파일을 현재 컷 불러오기 형식으로 재검증하지 못했습니다.");
  }
  return json;
}

function normalizedArchiveSource(
  archive: SessionArchive
): SourceRecord {
  const source = recoverySourceRecord(archive.rootProject.source);
  if (
    !source
    || source.contentType !== "vod"
    || !REMOTE_VOD_PLATFORMS.has(String(source.platform || "").toUpperCase())
    || !source.canonicalUrl
    || !source.contentId
  ) {
    throw new TypeError(
      "복원 JSON에서 CHZZK·YouTube·SOOP 단일 공개 VOD 주소를 확인하지 못했습니다."
    );
  }
  return source;
}

function recoverySourceAsRecord(
  value: SessionArchiveMediaSource
): SourceRecord | null {
  if (value.platform === "LOCAL") {
    return null;
  }
  return recoverySourceRecord({
    platform: value.platform,
    contentType: value.contentType,
    contentId: value.contentId,
    canonicalUrl: value.canonicalUrl,
    url: value.canonicalUrl
  });
}

function assertRecoverySourceMatches(
  source: SourceRecord,
  archive: SessionArchive
): void {
  const recoverySource = archive.mediaRecovery.source;
  if (!recoverySource || recoverySource.platform === "LOCAL") {
    return;
  }
  const normalizedRecovery = recoverySourceAsRecord(recoverySource);
  if (
    !normalizedRecovery
    || normalizedRecovery.contentType !== "vod"
    || normalizedRecovery.canonicalUrl !== source.canonicalUrl
    || normalizedRecovery.platform !== source.platform
    || normalizedRecovery.contentId !== source.contentId
    || sourceSessionIdentity(normalizedRecovery) !== sourceSessionIdentity(source)
  ) {
    throw new TypeError(
      "복원 JSON의 원본 영상 링크와 미디어 복구 identity가 서로 다릅니다."
    );
  }
}

function normalizedClipAt(
  clips: readonly EditorClip[],
  index: number
): EditorClip {
  const clip = clips[index];
  if (!clip) {
    throw new TypeError("복원 JSON의 컷 배열을 일관되게 복원하지 못했습니다.");
  }
  return clip;
}

function archiveCaptureSegments(
  archive: SessionArchive,
  normalizedClips: readonly EditorClip[]
): readonly SessionArchiveCaptureSegment[] {
  const root = plainRecord(archive.rootProject, "복원 JSON 프로젝트");
  if (!Array.isArray(root.clips)) {
    throw new TypeError("복원 JSON 프로젝트에 컷 배열이 없습니다.");
  }
  if (
    root.clips.length === 0
    || root.clips.length > SESSION_ARCHIVE_CAPTURE_MAX_CLIPS
    || normalizedClips.length !== root.clips.length
  ) {
    throw new TypeError(
      `복원 JSON의 컷은 1~${SESSION_ARCHIVE_CAPTURE_MAX_CLIPS}개여야 합니다.`
    );
  }

  const segments: SessionArchiveCaptureSegment[] = [];
  root.clips.forEach((value, index) => {
    const raw = plainRecord(value, `${index + 1}번 컷`);
    if (typeof raw.enabled !== "boolean") {
      throw new TypeError(`${index + 1}번 컷의 출력 여부가 올바르지 않습니다.`);
    }
    if (
      raw.shortFormCanvasClock !== undefined
      && typeof raw.shortFormCanvasClock !== "boolean"
    ) {
      throw new TypeError(`${index + 1}번 컷의 쇼츠 캔버스 표식이 올바르지 않습니다.`);
    }
    const startMs = exactSourceMilliseconds(
      raw.sourceStartMs,
      `${index + 1}번 컷 시작 시각`
    );
    const endMs = exactSourceMilliseconds(
      raw.sourceEndMs,
      `${index + 1}번 컷 끝 시각`
    );
    if (endMs - startMs < SESSION_ARCHIVE_CAPTURE_MIN_DURATION_MS) {
      throw new TypeError(`${index + 1}번 컷은 0.1초 이상이어야 합니다.`);
    }
    const normalized = normalizedClipAt(normalizedClips, index);
    if (
      normalized.sourceStartMs !== startMs
      || normalized.sourceEndMs !== endMs
      || normalized.enabled !== raw.enabled
    ) {
      throw new TypeError(
        `${index + 1}번 컷이 복원 과정에서 달라져 안전하게 불러올 수 없습니다.`
      );
    }
    if (raw.enabled === false || raw.shortFormCanvasClock === true) {
      return;
    }
    const note = typeof normalized.note === "string"
      ? normalized.note.normalize("NFKC").trim().slice(0, 160)
      : "";
    segments.push({
      startSeconds: startMs / 1000,
      endSeconds: endMs / 1000,
      note
    });
  });
  if (segments.length === 0) {
    throw new TypeError("복원 JSON에 다시 가져올 활성 본편 구간이 없습니다.");
  }
  return Object.freeze(segments.map((segment) => Object.freeze(segment)));
}

export async function sessionArchiveCaptureFromJson(
  value: string
): Promise<SessionArchiveCapture> {
  const archive = await parseSessionArchiveJson(value);
  const project = normalizeEditorProject(archive.rootProject);
  if (!project || project.id !== archive.rootProject.id) {
    throw new TypeError("복원 JSON의 편집 프로젝트를 안전하게 정규화하지 못했습니다.");
  }
  const source = normalizedArchiveSource(archive);
  assertRecoverySourceMatches(source, archive);
  const projectName = String(project.name || "").normalize("NFKC").trim();
  if (!projectName || projectName.length > 160) {
    throw new TypeError("복원 JSON의 프로젝트 이름은 1~160자여야 합니다.");
  }
  return Object.freeze({
    sourceUrl: String(source.canonicalUrl),
    source: Object.freeze({ ...source }),
    projectName,
    segments: archiveCaptureSegments(archive, project.clips),
    archiveCreatedAt: archive.createdAt
  });
}
