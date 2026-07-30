export const DEV_RELOAD_SCHEMA = "chzzk-kirinuki-dev-reload/v1";

const DEV_RELOAD_KINDS = new Set([
  "initial",
  "style",
  "editor",
  "content",
  "extension"
]);

export type DevReloadKind = "initial" | "style" | "editor" | "content" | "extension";

export interface DevReloadMarker {
  schema: typeof DEV_RELOAD_SCHEMA;
  revision: string;
  kind: DevReloadKind;
  changedFiles: string[];
  pid: number;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeDevReloadMarker(value: unknown): DevReloadMarker | null {
  if (
    !isRecord(value)
    || value.schema !== DEV_RELOAD_SCHEMA
    || typeof value.revision !== "string"
    || !value.revision.trim()
    || typeof value.kind !== "string"
    || !DEV_RELOAD_KINDS.has(value.kind)
    || !Array.isArray(value.changedFiles)
    || !value.changedFiles.every((entry) => typeof entry === "string")
    || typeof value.pid !== "number"
    || !Number.isInteger(value.pid)
    || value.pid <= 0
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
  ) {
    return null;
  }
  return {
    schema: DEV_RELOAD_SCHEMA,
    revision: value.revision.trim(),
    kind: value.kind as DevReloadKind,
    changedFiles: [...new Set(value.changedFiles as string[])].sort(),
    pid: value.pid,
    createdAt: new Date(value.createdAt).toISOString()
  };
}

export function devReloadResumeUrl(currentHref: string | URL, projectId: unknown): string {
  const id = String(projectId || "").trim();
  if (!id) {
    throw new TypeError("다시 열 개발 프로젝트 ID가 없습니다.");
  }
  const url = new URL(currentHref);
  const developmentReloadEnabled = url.searchParams.get("dev") === "1";
  url.search = "";
  url.searchParams.set("project", id);
  url.searchParams.set("session", "resume");
  if (developmentReloadEnabled) {
    url.searchParams.set("dev", "1");
  }
  return url.href;
}

export function devReloadStyleUrl(currentHref: string | URL, revision: unknown): string {
  const normalizedRevision = String(revision || "").trim();
  if (!normalizedRevision) {
    throw new TypeError("CSS 교체 revision이 없습니다.");
  }
  const url = new URL(currentHref);
  url.searchParams.set("dev-reload", normalizedRevision);
  return url.href;
}

type JsonCompatible =
  | null
  | boolean
  | number
  | string
  | JsonCompatible[]
  | { [key: string]: JsonCompatible | undefined };

function canonicalJsonValue(value: JsonCompatible): JsonCompatible {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalJsonValue(value[key] as JsonCompatible)])
    );
  }
  return value;
}

export function devReloadProjectFingerprint(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value as JsonCompatible));
}
