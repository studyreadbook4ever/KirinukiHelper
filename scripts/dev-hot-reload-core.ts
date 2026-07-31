import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEV_RELOAD_SCHEMA = "chzzk-kirinuki-dev-reload/v1";
const DEV_RELOAD_KINDS = [
  "initial",
  "style",
  "editor",
  "content",
  "extension"
] as const;
export type DevReloadKind = typeof DEV_RELOAD_KINDS[number];

export interface DevReloadMarker {
  schema: typeof DEV_RELOAD_SCHEMA;
  revision: string;
  kind: DevReloadKind;
  changedFiles: string[];
  pid: number;
  createdAt: string;
}

function hasErrorCode(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === code
  );
}

const EDITOR_SOURCE_PREFIX = "src/editor/";
const CAPTION_SOURCE_PREFIX = "src/caption-agent/";
const STYLE_FILES = new Set([
  "extension/editor/editor.css"
]);
const EDITOR_PAGE_FILES = new Set([
  "extension/editor.html"
]);
const CONTENT_FILES = new Set([
  "src/content-script.ts"
]);
const EDITOR_DEPENDENCY_FILES = new Set([
  "src/lib/caption-style.ts"
]);
const SHARED_EXTENSION_FILES = new Set([
  "src/lib/core.ts",
  "src/lib/editor-core.ts",
  "src/lib/keyboard-shortcuts.ts",
  "src/lib/source-platform.ts"
]);
const EXTENSION_FILES = new Set([
  "extension/manifest.json",
  "extension/sidepanel.html",
  "extension/sidepanel.css",
  "src/service-worker.ts",
  "src/sidepanel.ts",
  "src/lib/session-recovery.ts"
]);

export function normalizeDevChangedPath(
  root: string,
  filePath: string
): string {
  return path.relative(root, path.resolve(filePath)).split(path.sep).join("/");
}

export function classifyDevReload(
  changedFiles: readonly unknown[]
): Exclude<DevReloadKind, "initial"> | "none" {
  const files = [...new Set(changedFiles.map((value) => String(value)))].sort();
  const hasEditorCode = files.some((file) => (
    file.startsWith(EDITOR_SOURCE_PREFIX)
    || file.startsWith(CAPTION_SOURCE_PREFIX)
    || EDITOR_DEPENDENCY_FILES.has(file)
  ));
  const hasEditorPage = files.some((file) => EDITOR_PAGE_FILES.has(file));
  const hasStyle = files.some((file) => STYLE_FILES.has(file));
  const hasContent = files.some((file) => CONTENT_FILES.has(file));
  const hasExtension = files.some((file) => (
    EXTENSION_FILES.has(file)
    || SHARED_EXTENSION_FILES.has(file)
  ));

  if (hasExtension) {
    return "extension";
  }
  if (hasEditorCode || hasEditorPage || (hasStyle && hasContent)) {
    return "editor";
  }
  if (hasContent) {
    return "content";
  }
  if (hasStyle) {
    return "style";
  }
  return "none";
}

export function devChangeNeedsBuild(
  changedFiles: readonly unknown[]
): boolean {
  return changedFiles.some((file) => (
    String(file).startsWith(EDITOR_SOURCE_PREFIX)
    || String(file).startsWith(CAPTION_SOURCE_PREFIX)
    || EDITOR_DEPENDENCY_FILES.has(String(file))
    || SHARED_EXTENSION_FILES.has(String(file))
    || CONTENT_FILES.has(String(file))
  ));
}

export function createDevReloadMarker({
  revision,
  kind,
  changedFiles,
  pid = process.pid,
  createdAt = new Date()
}: {
  revision: unknown;
  kind: string;
  changedFiles: readonly unknown[];
  pid?: number;
  createdAt?: Date | string | number;
}): DevReloadMarker {
  const normalizedRevision = String(revision || "").trim();
  if (!normalizedRevision) {
    throw new TypeError("개발 리로드 revision이 비어 있습니다.");
  }
  if (!DEV_RELOAD_KINDS.includes(kind as DevReloadKind)) {
    throw new TypeError(`지원하지 않는 개발 리로드 종류입니다: ${kind}`);
  }
  const createdAtDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!Number.isFinite(createdAtDate.getTime())) {
    throw new TypeError("개발 리로드 생성 시각이 올바르지 않습니다.");
  }
  return {
    schema: DEV_RELOAD_SCHEMA,
    revision: normalizedRevision,
    kind: kind as DevReloadKind,
    changedFiles: [...new Set(changedFiles.map((value) => String(value)))].sort(),
    pid: Number(pid),
    createdAt: createdAtDate.toISOString()
  };
}

export function isDevReloadMarker(
  value: unknown
): value is DevReloadMarker {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Boolean(
    candidate.schema === DEV_RELOAD_SCHEMA
    && typeof candidate.revision === "string"
    && candidate.revision.trim()
    && DEV_RELOAD_KINDS.includes(candidate.kind as DevReloadKind)
    && Array.isArray(candidate.changedFiles)
    && candidate.changedFiles.every((entry) => typeof entry === "string")
    && Number.isInteger(candidate.pid)
    && Number(candidate.pid) > 0
    && typeof candidate.createdAt === "string"
    && Number.isFinite(Date.parse(candidate.createdAt))
  );
}

export async function readDevReloadMarker(
  markerPath: string
): Promise<DevReloadMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath, "utf8"));
    return isDevReloadMarker(parsed) ? parsed : null;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function writeDevReloadMarker(
  markerPath: string,
  marker: unknown
): Promise<void> {
  if (!isDevReloadMarker(marker)) {
    throw new TypeError("개발 리로드 marker 형식이 올바르지 않습니다.");
  }
  await mkdir(path.dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporaryPath, markerPath);
}

export async function removeOwnedDevReloadMarker(
  markerPath: string,
  pid = process.pid
): Promise<boolean> {
  const marker = await readDevReloadMarker(markerPath);
  if (!marker || marker.pid !== pid) {
    return false;
  }
  try {
    await unlink(markerPath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, "EPERM");
  }
}
