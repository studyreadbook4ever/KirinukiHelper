import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type {
  IncomingMessage,
  Server,
  ServerResponse
} from "node:http";
import { createServer } from "node:http";
import path from "node:path";

import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN,
  KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER,
  resolveKirinukiAppOrigin,
  resolveKirinukiStudioOrigin
} from "../src/lib/local-runtime-origin.js";
import type {
  KirinukiStudioOrigin
} from "../src/lib/local-runtime-origin.js";

export const LOCAL_STUDIO_SERVER_SCHEMA =
  "kirinuki-local-studio-server/v1";
export const LOCAL_STUDIO_HEALTH_SCHEMA =
  "kirinuki-local-studio-server/health-v1";
export const LOCAL_STUDIO_PID_SCHEMA =
  "kirinuki-local-studio-server-pid/v1";
export const STUDIO_LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_STUDIO_PORT = 4320;
export const STUDIO_INSTANCE_NONCE_BYTES = 32;
export const MAX_STATIC_ASSET_BYTES = 64 * 1024 * 1024;

const BASE_SECURITY_HEADERS = Object.freeze({
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), display-capture=(), geolocation=(), microphone=()",
  // The YouTube privacy-enhanced embed requires the embedding client to
  // identify its localhost origin. Cross-origin requests receive no path/query.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src https://chzzk.naver.com https://www.youtube-nocookie.com https://vod.sooplive.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: http://127.0.0.1:4319",
  "worker-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:4319"
].join("; ");

const STATIC_CSP_META_PATTERN =
  /^[ \t]*<meta http-equiv="Content-Security-Policy" content="[^"]*">\r?\n?/gmu;

/**
 * The tracked HTML carries a public-site CSP that cannot reach app-private
 * engines.  The installed app serves the same HTML with its stricter HTTP
 * header instead, so the two policies do not accidentally intersect and
 * disable local media access.
 */
export function withoutStaticContentSecurityPolicyMeta(
  html: string
): string {
  const matches = html.match(STATIC_CSP_META_PATTERN) || [];
  if (matches.length !== 1) {
    throw new Error(
      "Kirinuki HTML에는 public-site Content-Security-Policy meta가 정확히 하나 있어야 합니다."
    );
  }
  return html.replace(STATIC_CSP_META_PATTERN, "");
}

const MIME_TYPES = Object.freeze(new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"]
]));

const WEB_ASSET_EXTENSIONS = Object.freeze(new Set([
  ".css",
  ".ico",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".wasm",
  ".webp",
  ".woff2"
]));

const EDITOR_ASSET_EXTENSIONS = Object.freeze(new Set([
  ".css",
  ".js",
  ".wasm"
]));

export interface LocalStudioServerPaths {
  repoRoot: string;
  stateRoot: string;
  runtimeRoot: string;
  pidPath: string;
  logPath: string;
}

export interface StudioServerPidRecord {
  schema: typeof LOCAL_STUDIO_PID_SCHEMA;
  pid: number;
  command: "start";
  startedAt: string;
  procStartTime: string;
  bootId: string;
  cliPath: string;
  instanceNonce: string;
}

export interface StudioHealthPayload {
  schema: typeof LOCAL_STUDIO_HEALTH_SCHEMA;
  status: "ok";
  managed: true;
  server: {
    schema: typeof LOCAL_STUDIO_SERVER_SCHEMA;
    host: typeof STUDIO_LOOPBACK_HOST;
    port: number;
    instanceNonce: string;
    /** Missing only on the pre-public-origin v1 localhost server. */
    studioOrigin?: KirinukiStudioOrigin;
  };
}

export interface StudioServerOptions {
  repoRoot: string;
  instanceNonce: string;
  port?: number;
  studioOrigin?: KirinukiStudioOrigin;
}

export interface StudioStaticAsset {
  relativePath: string;
  contentType: string;
  html: boolean;
}

export interface OpenedStaticAsset {
  handle: FileHandle;
  size: number;
  etag: string;
  /** Exact fd-family snapshot used again immediately before responding. */
  status: BigIntStats;
}

export type StudioEndpointOwnership = "down" | "foreign" | "managed";

function requiredAbsolutePath(value: unknown, label: string): string {
  const raw = String(value || "");
  if (
    !raw
    || raw.trim() !== raw
    || /[\0\r\n]/u.test(raw)
    || !path.isAbsolute(raw)
  ) {
    throw new TypeError(
      `${label} 경로는 앞뒤 공백이나 줄바꿈이 없는 절대 경로여야 합니다.`
    );
  }
  return path.normalize(raw);
}

export function resolveStudioServerPaths({
  env = {},
  homeDir,
  repoRoot
}: {
  env?: NodeJS.ProcessEnv;
  homeDir: string;
  repoRoot: string;
}): Readonly<LocalStudioServerPaths> {
  const home = requiredAbsolutePath(homeDir, "홈");
  const repo = requiredAbsolutePath(repoRoot, "레포지토리");
  const stateBase = env.XDG_STATE_HOME
    ? requiredAbsolutePath(env.XDG_STATE_HOME, "XDG_STATE_HOME")
    : path.join(home, ".local", "state");
  const runtimeBase = env.XDG_RUNTIME_DIR
    ? requiredAbsolutePath(env.XDG_RUNTIME_DIR, "XDG_RUNTIME_DIR")
    : path.join(stateBase, "run");
  const stateRoot = path.join(stateBase, "kirinuki-studio");
  const runtimeRoot = path.join(runtimeBase, "kirinuki-studio");
  return Object.freeze({
    repoRoot: repo,
    stateRoot,
    runtimeRoot,
    pidPath: path.join(runtimeRoot, "localhost-server.pid"),
    logPath: path.join(stateRoot, "localhost-server.log")
  });
}

export function createStudioInstanceNonce(): string {
  return randomBytes(STUDIO_INSTANCE_NONCE_BYTES).toString("base64url");
}

export function isValidStudioInstanceNonce(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function studioHealthPayload(
  instanceNonce: string,
  port: number = DEFAULT_STUDIO_PORT,
  studioOrigin: KirinukiStudioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
): Readonly<StudioHealthPayload> {
  if (!isValidStudioInstanceNonce(instanceNonce)) {
    throw new TypeError("localhost server instance nonce가 올바르지 않습니다.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("localhost server 포트가 올바르지 않습니다.");
  }
  const configuredOrigin = resolveKirinukiStudioOrigin(studioOrigin);
  return Object.freeze({
    schema: LOCAL_STUDIO_HEALTH_SCHEMA,
    status: "ok",
    managed: true,
    server: Object.freeze({
      schema: LOCAL_STUDIO_SERVER_SCHEMA,
      host: STUDIO_LOOPBACK_HOST,
      port,
      instanceNonce,
      studioOrigin: configuredOrigin
    })
  });
}

export function isManagedStudioHealthPayload(
  value: unknown,
  {
    instanceNonce,
    port = DEFAULT_STUDIO_PORT,
    studioOrigin
  }: {
    instanceNonce?: string;
    port?: number;
    studioOrigin?: KirinukiStudioOrigin;
  } = {}
): value is StudioHealthPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const server = payload.server;
  if (!server || typeof server !== "object") {
    return false;
  }
  const identity = server as Record<string, unknown>;
  return Boolean(
    payload.schema === LOCAL_STUDIO_HEALTH_SCHEMA
    && payload.status === "ok"
    && payload.managed === true
    && identity.schema === LOCAL_STUDIO_SERVER_SCHEMA
    && identity.host === STUDIO_LOOPBACK_HOST
    && identity.port === port
    && isValidStudioInstanceNonce(identity.instanceNonce)
    && (
      identity.studioOrigin === undefined
      || identity.studioOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN
      || identity.studioOrigin === KIRINUKI_PUBLIC_STUDIO_ORIGIN
    )
    && (
      instanceNonce === undefined
      || identity.instanceNonce === instanceNonce
    )
    && (
      studioOrigin === undefined
      || (identity.studioOrigin ?? KIRINUKI_LOCAL_STUDIO_ORIGIN)
        === studioOrigin
    )
  );
}

export function classifyStudioEndpoint({
  portOccupied,
  health,
  pidRecord
}: {
  portOccupied: boolean;
  health: StudioHealthPayload | null;
  pidRecord: StudioServerPidRecord | null;
}): StudioEndpointOwnership {
  if (
    portOccupied
    && health
    && pidRecord
    && health.server.instanceNonce === pidRecord.instanceNonce
  ) {
    return "managed";
  }
  return portOccupied ? "foreign" : "down";
}

export function parseProcStartTime(statText: unknown): string | null {
  const value = String(statText || "");
  const commandEnd = value.lastIndexOf(") ");
  if (commandEnd < 0) {
    return null;
  }
  const fieldsFromState = value
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u);
  const startTime = fieldsFromState[19];
  return startTime !== undefined && /^\d+$/u.test(startTime)
    ? startTime
    : null;
}

export function commandLineRunsExactStudioCli({
  commandLine,
  processCwd,
  expectedCliPath
}: {
  commandLine: unknown;
  processCwd: string;
  expectedCliPath: string;
}): boolean {
  const args = String(commandLine || "")
    .split("\0")
    .filter(Boolean);
  const expected = path.resolve(expectedCliPath);
  const scriptIndex = args.findIndex((argument, index) => {
    if (index === 0 || argument.startsWith("-")) {
      return false;
    }
    const absolute = path.isAbsolute(argument)
      ? path.resolve(argument)
      : path.resolve(processCwd, argument);
    return absolute === expected;
  });
  if (scriptIndex < 0) {
    return false;
  }
  const trailing = args.slice(scriptIndex + 1);
  return trailing.includes("start") && trailing.includes("--foreground");
}

export function validStudioPidRecord(
  value: unknown,
  expectedCliPath: string
): value is StudioServerPidRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<StudioServerPidRecord>;
  return Boolean(
    record.schema === LOCAL_STUDIO_PID_SCHEMA
    && Number.isInteger(record.pid)
    && Number(record.pid) >= 2
    && record.command === "start"
    && typeof record.startedAt === "string"
    && !Number.isNaN(Date.parse(record.startedAt))
    && typeof record.procStartTime === "string"
    && /^\d+$/u.test(record.procStartTime)
    && typeof record.bootId === "string"
    && /^[0-9a-f-]{16,64}$/iu.test(record.bootId)
    && record.cliPath === path.resolve(expectedCliPath)
    && isValidStudioInstanceNonce(record.instanceNonce)
  );
}

export function hasExactStudioHost(
  request: Pick<IncomingMessage, "headers" | "rawHeaders">,
  port: number = DEFAULT_STUDIO_PORT,
  studioOrigin: KirinukiStudioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
): boolean {
  const configuredOrigin = resolveKirinukiStudioOrigin(studioOrigin);
  const loopbackHost = `${STUDIO_LOOPBACK_HOST}:${port}`;
  const publicHost = new URL(KIRINUKI_PUBLIC_STUDIO_ORIGIN).host;
  const rawValues = (headerName: string): string[] => {
    const values: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() === headerName) {
        values.push(request.rawHeaders[index + 1] || "");
      }
    }
    return values;
  };
  const hostValues = rawValues("host");
  const forwardedValues = rawValues("forwarded");
  const forwardedHostValues = rawValues("x-forwarded-host");
  const forwardedProtoValues = rawValues("x-forwarded-proto");
  if (
    hostValues.length !== 1
    || request.headers.host !== hostValues[0]
    || forwardedValues.length > 0
  ) {
    return false;
  }
  const host = hostValues[0];
  if (configuredOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN) {
    return host === loopbackHost
      && forwardedHostValues.length === 0
      && forwardedProtoValues.length === 0;
  }
  const directLoopback = host === loopbackHost
    && forwardedHostValues.length === 0
    && forwardedProtoValues.length === 0;
  if (directLoopback) {
    return true;
  }
  const exactHttpsForwarding = forwardedProtoValues.length === 1
    && forwardedProtoValues[0] === "https";
  const forwardedHostIsPublic = forwardedHostValues.length === 1
    && forwardedHostValues[0] === publicHost;
  const originalHostIsPublic = host === publicHost
    && (
      forwardedHostValues.length === 0
      || forwardedHostIsPublic
    );
  const overriddenHostIsLoopback = host === loopbackHost
    && forwardedHostIsPublic;
  return exactHttpsForwarding
    && (originalHostIsPublic || overriddenHostIsLoopback);
}

function safeSegments(value: string): string[] | null {
  const segments = value.split("/");
  if (
    segments.some((segment) => (
      !segment
      || segment === "."
      || segment === ".."
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)
    ))
  ) {
    return null;
  }
  return segments;
}

function asset(
  relativePath: string,
  {
    contentType,
    html = false
  }: { contentType?: string; html?: boolean } = {}
): Readonly<StudioStaticAsset> | null {
  const resolvedType = contentType
    || MIME_TYPES.get(path.extname(relativePath).toLowerCase());
  return resolvedType
    ? Object.freeze({ relativePath, contentType: resolvedType, html })
    : null;
}

/**
 * Resolve only public, build-owned files. The raw request target is inspected
 * before URL parsing so encoded separators and encoded traversal never become
 * filesystem input.
 */
export function resolveStudioStaticAsset(
  rawTarget: unknown
): Readonly<StudioStaticAsset> | null {
  const target = String(rawTarget || "");
  if (
    !target.startsWith("/")
    || /[%\\?#[\0-\x20\x7f]/u.test(target)
    || target.startsWith("//")
  ) {
    return null;
  }
  if (target === "/" || target === "/index.html") {
    return asset("web/index.html", { html: true });
  }
  if (target === "/editor.html") {
    return asset("web/editor.html", { html: true });
  }
  if (target === "/studio.css") {
    return asset("web/studio.css");
  }
  if (target === "/studio.js") {
    return asset("web/studio.js");
  }
  if (target === "/licenses.html") {
    return asset("web/licenses.html", { html: true });
  }
  if (target === "/licenses.css") {
    return asset("web/licenses.css");
  }
  if (target === "/THIRD_PARTY_NOTICES.md") {
    return asset("web/THIRD_PARTY_NOTICES.md");
  }
  // Exact opt-in dev endpoint. The normal build never creates this file and
  // the package allowlist excludes it; only `dev:editor` owns its lifetime.
  if (target === "/dev-reload.json") {
    return asset("web/dev-reload.json");
  }

  if (target.startsWith("/assets/")) {
    const relative = target.slice("/assets/".length);
    const segments = safeSegments(relative);
    const extension = path.extname(relative).toLowerCase();
    return segments && WEB_ASSET_EXTENSIONS.has(extension)
      ? asset(path.posix.join("web", "assets", ...segments))
      : null;
  }

  if (target.startsWith("/editor/fonts/")) {
    const relative = target.slice("/editor/fonts/".length);
    const segments = safeSegments(relative);
    return segments?.length === 1 && path.extname(relative) === ".woff2"
      ? asset(path.posix.join("web", "editor", "fonts", relative))
      : null;
  }

  if (target === "/editor/editor.js") {
    return asset("web/editor/editor.js");
  }
  if (target === "/editor/audseg-worker.js") {
    return asset("web/editor/audseg-worker.js");
  }

  if (target.startsWith("/editor/")) {
    const relative = target.slice("/editor/".length);
    const segments = safeSegments(relative);
    const extension = path.extname(relative).toLowerCase();
    return segments?.length === 1 && EDITOR_ASSET_EXTENSIONS.has(extension)
      ? asset(path.posix.join("web", "editor", relative))
      : null;
  }

  if (target.startsWith("/licenses/")) {
    const relative = target.slice("/licenses/".length);
    const segments = safeSegments(relative);
    return segments?.length === 1 && path.extname(relative) === ".txt"
      ? asset(path.posix.join("web", "licenses", relative))
      : null;
  }
  return null;
}

/**
 * Keep query data out of filesystem resolution while allowing the browser-only
 * editor/session parameters needed by `/` and `/editor.html`.
 */
export function studioRequestPath(rawTarget: unknown): string | null {
  const target = String(rawTarget || "");
  if (
    !target.startsWith("/")
    || target.length > 16_384
    || /[\\#[\0-\x20\x7f]/u.test(target)
  ) {
    return null;
  }
  const queryIndex = target.indexOf("?");
  const pathname = queryIndex < 0 ? target : target.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : target.slice(queryIndex + 1);
  if (
    pathname.startsWith("//")
    || /[%\\#[\0-\x20\x7f]/u.test(pathname)
    || pathname.split("/").some((segment) => segment === "." || segment === "..")
    || query.length > 8_192
    || /[\\#[\0-\x20\x7f]/u.test(query)
  ) {
    return null;
  }
  return pathname;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    !relative.startsWith("..")
    && !path.isAbsolute(relative)
  );
}

export function normalizedStudioStaticAssetDeviceId(
  value: bigint,
  platform: NodeJS.Platform | string = process.platform
): bigint {
  // Node 22/libuv before libuv #4698 can expose a Windows path-stat volume
  // serial at 64 bits but fstat at 32 bits for the same object.
  return platform === "win32" ? BigInt.asUintN(32, value) : value;
}

export function sameStudioStaticAssetCrossApiObjectIdentity(
  pathStatus: Pick<BigIntStats, "dev" | "ino" | "size" | "nlink">,
  handleStatus: Pick<BigIntStats, "dev" | "ino" | "size" | "nlink">,
  platform: NodeJS.Platform | string = process.platform
): boolean {
  return normalizedStudioStaticAssetDeviceId(pathStatus.dev, platform)
      === normalizedStudioStaticAssetDeviceId(handleStatus.dev, platform)
    && pathStatus.ino === handleStatus.ino
    && pathStatus.size === handleStatus.size
    && pathStatus.nlink === handleStatus.nlink;
}

function sameStudioStaticAssetSnapshot(
  left: BigIntStats,
  right: BigIntStats
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function studioStaticAssetReadOnlyFlags(): number {
  return process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
}

/** Open a public asset only after every path component is proven non-symlink. */
export async function openStudioStaticAsset(
  repoRoot: string,
  descriptor: Readonly<StudioStaticAsset>
): Promise<OpenedStaticAsset | null> {
  const root = path.resolve(requiredAbsolutePath(repoRoot, "레포지토리"));
  const candidate = path.resolve(root, descriptor.relativePath);
  if (!isWithinRoot(candidate, root) || candidate === root) {
    return null;
  }

  const relativeParts = path.relative(root, candidate).split(path.sep);
  let cursor = root;
  let openedHandle: FileHandle | undefined;
  try {
    const rootStatus = await lstat(root, { bigint: true });
    if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
      return null;
    }
    const realRoot = await realpath(root);
    let finalPathStatus: BigIntStats | null = null;
    for (let index = 0; index < relativeParts.length; index += 1) {
      cursor = path.join(cursor, relativeParts[index]!);
      const stats = await lstat(cursor, { bigint: true });
      if (stats.isSymbolicLink()) {
        return null;
      }
      if (index < relativeParts.length - 1 && !stats.isDirectory()) {
        return null;
      }
      if (index === relativeParts.length - 1 && !stats.isFile()) {
        return null;
      }
      if (index === relativeParts.length - 1) {
        finalPathStatus = stats;
      }
    }
    const realCandidate = await realpath(candidate);
    if (!isWithinRoot(realCandidate, realRoot)) {
      return null;
    }
    openedHandle = await open(
      candidate,
      studioStaticAssetReadOnlyFlags()
    );
    const stats = await openedHandle.stat({ bigint: true });
    if (
      !finalPathStatus
      || !stats.isFile()
      || finalPathStatus.nlink !== 1n
      || stats.nlink !== 1n
      || stats.size < 0n
      || stats.size > BigInt(MAX_STATIC_ASSET_BYTES)
      || !sameStudioStaticAssetCrossApiObjectIdentity(finalPathStatus, stats)
    ) {
      await openedHandle.close();
      openedHandle = undefined;
      return null;
    }
    const pathAfter = await lstat(candidate, { bigint: true });
    if (
      pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || !sameStudioStaticAssetSnapshot(finalPathStatus, pathAfter)
      || !sameStudioStaticAssetCrossApiObjectIdentity(pathAfter, stats)
    ) {
      await openedHandle.close();
      openedHandle = undefined;
      return null;
    }
    const size = Number(stats.size);
    const modifiedAtMs = Math.max(
      0,
      Math.trunc(Number(stats.mtimeNs) / 1_000_000)
    );
    const result = {
      handle: openedHandle,
      size,
      status: stats,
      // Size+mtime is a cheap revalidation hint rather than a byte identity,
      // so advertise it as a weak validator.
      etag: `W/"${size.toString(16)}-${modifiedAtMs.toString(16)}"`
    };
    openedHandle = undefined;
    return result;
  } catch {
    await openedHandle?.close().catch(() => undefined);
    return null;
  }
}

export async function readVerifiedStudioStaticAsset(
  opened: Readonly<OpenedStaticAsset>,
  readBytes: boolean
): Promise<Buffer | null> {
  const bytes = readBytes ? await opened.handle.readFile() : null;
  const after = await opened.handle.stat({ bigint: true });
  if (
    !sameStudioStaticAssetSnapshot(opened.status, after)
    || (bytes !== null && bytes.byteLength !== opened.size)
  ) {
    throw new Error("Studio 정적 파일이 응답 준비 중 바뀌었습니다.");
  }
  return bytes;
}

export function studioSecurityHeaders({
  html = false
}: { html?: boolean } = {}): Readonly<Record<string, string>> {
  return Object.freeze({
    ...BASE_SECURITY_HEADERS,
    "Cache-Control": html
      ? "no-store"
      : "private, no-cache, must-revalidate",
    ...(html
      ? { "Content-Security-Policy": HTML_CONTENT_SECURITY_POLICY }
      : {})
  });
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {}
): void {
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(statusCode, {
    ...studioSecurityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(bytes.byteLength),
    ...extraHeaders
  });
  response.end(bytes);
}

async function serveStaticAsset(
  response: ServerResponse,
  requestMethod: string,
  ifNoneMatch: string,
  repoRoot: string,
  descriptor: Readonly<StudioStaticAsset>,
  studioOrigin: KirinukiStudioOrigin
): Promise<void> {
  const opened = await openStudioStaticAsset(repoRoot, descriptor);
  if (!opened) {
    sendText(response, 404, "Not Found\n");
    return;
  }
  try {
    const normalizedOpenedTag = opened.etag.replace(/^W\//u, "");
    const validatorMatches = ifNoneMatch.split(",").some((candidate) => {
      const normalizedCandidate = candidate.trim();
      return normalizedCandidate === "*" || (
        normalizedCandidate.replace(/^W\//u, "") === normalizedOpenedTag
      );
    });
    if (!descriptor.html && validatorMatches) {
      await readVerifiedStudioStaticAsset(opened, false);
      response.writeHead(304, {
        ...studioSecurityHeaders(),
        ETag: opened.etag
      });
      response.end();
      return;
    }
    const requiresOriginBinding = descriptor.relativePath === "web/index.html"
      || descriptor.relativePath === "web/editor.html";
    let bytes = await readVerifiedStudioStaticAsset(
      opened,
      requestMethod !== "HEAD" || requiresOriginBinding
    );
    let contentLength = bytes?.byteLength ?? opened.size;
    if (requiresOriginBinding) {
      const source = bytes;
      if (!source) {
        throw new Error("Studio HTML 파일을 검증해 읽지 못했습니다.");
      }
      const html = source.toString("utf8");
      const firstPlaceholder = html.indexOf(
        KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER
      );
      if (
        firstPlaceholder < 0
        || html.indexOf(
          KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER,
          firstPlaceholder + KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER.length
        ) >= 0
      ) {
        throw new Error(
          "Studio HTML의 배포 Origin meta placeholder가 올바르지 않습니다."
        );
      }
      const rendered = Buffer.from(
        withoutStaticContentSecurityPolicyMeta(html).replace(
          KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER,
          studioOrigin
        ),
        "utf8"
      );
      contentLength = rendered.byteLength;
      bytes = requestMethod === "HEAD" ? null : rendered;
    }
    response.writeHead(200, {
      ...studioSecurityHeaders({ html: descriptor.html }),
      "Content-Type": descriptor.contentType,
      "Content-Length": String(contentLength),
      ...(!descriptor.html ? { ETag: opened.etag } : {})
    });
    response.end(bytes);
  } finally {
    await opened.handle.close();
  }
}

export function createLocalStudioHttpServer({
  repoRoot,
  instanceNonce,
  port = DEFAULT_STUDIO_PORT,
  studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
}: StudioServerOptions): Server {
  const root = requiredAbsolutePath(repoRoot, "레포지토리");
  const configuredOrigin = resolveKirinukiAppOrigin(studioOrigin);
  const health = studioHealthPayload(instanceNonce, port, configuredOrigin);
  return createServer((request, response) => {
    void (async () => {
      if (!hasExactStudioHost(request, port, configuredOrigin)) {
        sendText(response, 421, "Misdirected Request\n");
        return;
      }
      const directLoopbackRequest = hasExactStudioHost(
        request,
        port,
        KIRINUKI_LOCAL_STUDIO_ORIGIN
      );
      const rawTarget = request.url || "";
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method Not Allowed\n", {
          Allow: "GET, HEAD"
        });
        return;
      }
      const requestPath = studioRequestPath(rawTarget);
      if (!requestPath) {
        sendText(response, 400, "Bad Request\n");
        return;
      }
      if (requestPath === "/v1/studio/health") {
        if (!directLoopbackRequest) {
          sendText(response, 404, "Not Found\n");
          return;
        }
        const body = Buffer.from(`${JSON.stringify(health)}\n`, "utf8");
        response.writeHead(200, {
          ...studioSecurityHeaders(),
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(body.byteLength)
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      const descriptor = resolveStudioStaticAsset(requestPath);
      if (!descriptor) {
        sendText(response, 404, "Not Found\n");
        return;
      }
      await serveStaticAsset(
        response,
        request.method,
        typeof request.headers["if-none-match"] === "string"
          ? request.headers["if-none-match"]
          : "",
        root,
        descriptor,
        configuredOrigin
      );
    })().catch(() => {
      if (!response.headersSent) {
        sendText(response, 500, "Internal Server Error\n");
      } else {
        response.destroy();
      }
    });
  });
}
