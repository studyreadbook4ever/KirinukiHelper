import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEV_RELOAD_SCHEMA = "chzzk-kirinuki-dev-reload/v1";
const DEV_RELOAD_KINDS = [
  "initial",
  "style",
  "editor"
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
const WEB_SOURCE_PREFIX = "src/web/";
const LIB_SOURCE_PREFIX = "src/lib/";
const WEB_STYLE_FILES = new Set([
  "web/editor/editor.css"
]);
const WEB_PAGE_FILES = new Set([
  "web/editor.html",
  "web/index.html",
  "web/studio.css"
]);
export function normalizeDevChangedPath(
  root: string,
  filePath: string
): string {
  return path.relative(root, path.resolve(filePath)).split(path.sep).join("/");
}

/** Classify changes handled by the normal localhost web editor runner. */
export function classifyWebDevReload(
  changedFiles: readonly unknown[]
): Exclude<DevReloadKind, "initial"> | "none" {
  const files = [...new Set(changedFiles.map((value) => String(value)))].sort();
  const hasEditorCode = files.some((file) => (
    file.startsWith(EDITOR_SOURCE_PREFIX)
    || file.startsWith(CAPTION_SOURCE_PREFIX)
    || file.startsWith(WEB_SOURCE_PREFIX)
    || file.startsWith(LIB_SOURCE_PREFIX)
  ));
  const hasWebPage = files.some((file) => WEB_PAGE_FILES.has(file));
  const hasStyle = files.some((file) => WEB_STYLE_FILES.has(file));

  if (hasEditorCode || hasWebPage) {
    return "editor";
  }
  if (hasStyle) {
    return "style";
  }
  return "none";
}

export function webDevChangeNeedsBuild(
  changedFiles: readonly unknown[]
): boolean {
  return changedFiles.some((file) => {
    const changedPath = String(file);
    return changedPath.startsWith(EDITOR_SOURCE_PREFIX)
      || changedPath.startsWith(CAPTION_SOURCE_PREFIX)
      || changedPath.startsWith(WEB_SOURCE_PREFIX)
      || changedPath.startsWith(LIB_SOURCE_PREFIX);
  });
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
