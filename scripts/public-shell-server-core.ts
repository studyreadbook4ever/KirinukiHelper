import { constants as fsConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath
} from "node:fs/promises";
import { createServer } from "node:http";
import type {
  IncomingMessage,
  Server,
  ServerResponse
} from "node:http";
import path from "node:path";

import {
  canonicalSupportedVodSourceUrl
} from "../src/lib/source-embed.js";
import {
  PUBLIC_WEB_PACKAGE_FILES
} from "./web-package-files.js";

export const PUBLIC_SHELL_BIND_HOST = "127.0.0.1";
export const DEFAULT_PUBLIC_SHELL_PORT = 4330;
export const PUBLIC_SHELL_CANONICAL_HOST = "kirinuki.eff0rtchung.kr";
export const PUBLIC_SHELL_CANONICAL_URL =
  `https://${PUBLIC_SHELL_CANONICAL_HOST}/`;
export const MAX_PUBLIC_SHELL_ASSET_BYTES = 16 * 1024 * 1024;
export const MAX_PUBLIC_SHELL_HEADERS_BYTES = 16 * 1024;

export const PUBLIC_SHELL_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src https://chzzk.naver.com https://www.youtube-nocookie.com https://vod.sooplive.com; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: http://127.0.0.1:4319; worker-src 'self' blob:; connect-src 'self' http://127.0.0.1:4319",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=31536000"
} as const);

export interface PublicShellStaticAsset {
  readonly relativePath: string;
  readonly contentType: string;
}

export interface PublicShellServerOptions {
  readonly publicShellRoot: string;
}

interface LoadedPublicShellAsset extends PublicShellStaticAsset {
  readonly bytes: Buffer;
}

const PUBLIC_WEB_MIME_TYPES = Object.freeze(new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"]
]));

const PUBLIC_SHELL_ROUTES = (() => {
  const routes = new Map<string, PublicShellStaticAsset>();
  for (const { archivePath } of PUBLIC_WEB_PACKAGE_FILES) {
    if (archivePath === "_headers" || archivePath === ".popovic-hosts") {
      continue;
    }
    const contentType = PUBLIC_WEB_MIME_TYPES.get(path.posix.extname(archivePath));
    if (!contentType) {
      throw new Error(`공개 웹 파일 MIME 형식을 확인하지 못했습니다: ${archivePath}`);
    }
    routes.set(`/${archivePath}`, { relativePath: archivePath, contentType });
  }
  const index = routes.get("/index.html");
  if (!index) {
    throw new Error("공개 웹 편집기 index.html allowlist가 없습니다.");
  }
  routes.set("/", index);
  return Object.freeze(routes);
})();

function requiredAbsolutePath(value: unknown, label: string): string {
  const raw = String(value || "");
  if (
    !raw
    || raw.trim() !== raw
    || /[\0\r\n]/u.test(raw)
    || !path.isAbsolute(raw)
  ) {
    throw new TypeError(
      `${label}은 앞뒤 공백이나 줄바꿈이 없는 절대 경로여야 합니다.`
    );
  }
  return path.resolve(raw);
}

function safeInternalRelativePath(relativePath: string): boolean {
  return Boolean(
    relativePath
    && !path.posix.isAbsolute(relativePath)
    && path.posix.normalize(relativePath) === relativePath
    && relativePath.split("/").every((segment) => (
      segment !== ""
      && segment !== "."
      && segment !== ".."
      && /^[A-Za-z0-9._-]+$/u.test(segment)
    ))
  );
}

function publicShellReadOnlyOpenFlags(): number {
  return process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
}

function samePublicShellFileSnapshot(
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

export function normalizedPublicShellDeviceId(
  value: bigint,
  platform: NodeJS.Platform | string = process.platform
): bigint {
  // Node 22/libuv before libuv #4698 can expose the Windows path-stat volume
  // serial at 64 bits but fstat at 32 bits for the same file object.
  return platform === "win32" ? BigInt.asUintN(32, value) : value;
}

export function samePublicShellFileObjectIdentity(
  left: Pick<BigIntStats, "dev" | "ino" | "size" | "nlink">,
  right: Pick<BigIntStats, "dev" | "ino" | "size" | "nlink">,
  platform: NodeJS.Platform | string = process.platform
): boolean {
  return normalizedPublicShellDeviceId(left.dev, platform)
      === normalizedPublicShellDeviceId(right.dev, platform)
    && left.ino === right.ino
    && left.size === right.size
    && left.nlink === right.nlink;
}

async function readSecurePublicShellFile(
  publicShellRoot: string,
  relativePath: string,
  maximumBytes: number
): Promise<Buffer | null> {
  if (!safeInternalRelativePath(relativePath)) {
    return null;
  }
  const root = requiredAbsolutePath(publicShellRoot, "공개 shell root");
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (
    candidate === root
    || !candidate.startsWith(`${root}${path.sep}`)
  ) {
    return null;
  }
  try {
    const rootMetadata = await lstat(root, { bigint: true });
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
      return null;
    }
    const canonicalRoot = await realpath(root);
    if (canonicalRoot !== root) {
      return null;
    }

    const segments = relativePath.split("/");
    let cursor = root;
    let finalMetadata: BigIntStats | null = null;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]!);
      const metadata = await lstat(cursor, { bigint: true });
      if (metadata.isSymbolicLink()) {
        return null;
      }
      if (index < segments.length - 1) {
        if (!metadata.isDirectory()) {
          return null;
        }
      } else {
        finalMetadata = metadata;
      }
    }
    if (
      !finalMetadata?.isFile()
      || finalMetadata.nlink !== 1n
      || finalMetadata.size < 0n
      || finalMetadata.size > BigInt(maximumBytes)
      || await realpath(candidate) !== candidate
    ) {
      return null;
    }

    const handle = await open(
      candidate,
      publicShellReadOnlyOpenFlags()
    );
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile()
        || before.nlink !== 1n
        || before.size > BigInt(maximumBytes)
        || !samePublicShellFileObjectIdentity(finalMetadata, before)
      ) {
        return null;
      }
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (
        bytes.byteLength !== Number(before.size)
        || !samePublicShellFileSnapshot(before, after)
      ) {
        return null;
      }
      const pathAfter = await lstat(candidate, { bigint: true });
      if (
        pathAfter.isSymbolicLink()
        || !samePublicShellFileSnapshot(finalMetadata, pathAfter)
        || !samePublicShellFileObjectIdentity(pathAfter, after)
      ) {
        return null;
      }
      return bytes;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export function parsePublicShellHeaders(
  contents: unknown
): Readonly<Record<string, string>> {
  const source = String(contents || "");
  if (
    Buffer.byteLength(source, "utf8") > MAX_PUBLIC_SHELL_HEADERS_BYTES
    || /[\0]/u.test(source)
  ) {
    throw new TypeError("public-shell/_headers의 길이나 문자가 올바르지 않습니다.");
  }
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.shift() !== "/*" || lines.length === 0) {
    throw new TypeError("public-shell/_headers는 정확한 /* 규칙 하나여야 합니다.");
  }

  const expectedByLowerName = new Map(
    Object.entries(PUBLIC_SHELL_SECURITY_HEADERS).map(([name, value]) => (
      [name.toLowerCase(), { name, value }] as const
    ))
  );
  const parsed = new Map<string, { name: string; value: string }>();
  for (const line of lines) {
    const match = /^  ([A-Za-z][A-Za-z0-9-]*): ([^\r\n]+)$/u.exec(line);
    if (!match) {
      throw new TypeError(
        "public-shell/_headers에는 두 칸 들여쓴 단일 행 헤더만 허용합니다."
      );
    }
    const name = match[1]!;
    const value = match[2]!;
    const lowerName = name.toLowerCase();
    const expected = expectedByLowerName.get(lowerName);
    if (
      !expected
      || parsed.has(lowerName)
      || name !== expected.name
      || value !== expected.value
    ) {
      throw new TypeError(
        `public-shell/_headers의 ${name} 값이 공개 shell 계약과 다릅니다.`
      );
    }
    parsed.set(lowerName, { name, value });
  }
  if (parsed.size !== expectedByLowerName.size) {
    const missing = [...expectedByLowerName]
      .filter(([name]) => !parsed.has(name))
      .map(([, header]) => header.name);
    throw new TypeError(
      `public-shell/_headers에 필수 보안 헤더가 없습니다: ${missing.join(", ")}`
    );
  }
  return Object.freeze(Object.fromEntries(
    [...parsed.values()].map(({ name, value }) => [name, value])
  ));
}

export async function loadPublicShellSecurityHeaders(
  publicShellRoot: string
): Promise<Readonly<Record<string, string>>> {
  const bytes = await readSecurePublicShellFile(
    publicShellRoot,
    "_headers",
    MAX_PUBLIC_SHELL_HEADERS_BYTES
  );
  if (!bytes) {
    throw new Error("public-shell/_headers를 안전한 일반 파일로 읽지 못했습니다.");
  }
  return parsePublicShellHeaders(bytes.toString("utf8"));
}

export function hasExactPublicShellHost(
  request: Pick<IncomingMessage, "headers" | "rawHeaders">
): boolean {
  const rawHostValues: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "host") {
      rawHostValues.push(request.rawHeaders[index + 1] || "");
    }
  }
  return rawHostValues.length === 1
    && rawHostValues[0] === PUBLIC_SHELL_CANONICAL_HOST
    && request.headers.host === PUBLIC_SHELL_CANONICAL_HOST;
}

function validPublicEditorQuery(query: string): boolean {
  if (
    query.length < 1
    || query.length > 2_048
    || /[\\#[\0-\x20\x7f]/u.test(query)
  ) {
    return false;
  }
  const parameters = new URLSearchParams(query);
  if (parameters.toString() !== query) {
    return false;
  }
  const entries = [...parameters.entries()];
  const allowedKeys = new Set([
    "project",
    "usageGate",
    "session",
    "recovery",
    "short",
    "workspace"
  ]);
  if (
    entries.some(([key]) => !allowedKeys.has(key))
    || new Set(entries.map(([key]) => key)).size !== entries.length
  ) {
    return false;
  }
  const projectId = parameters.get("project") || "";
  const usageGate = parameters.get("usageGate");
  const session = parameters.get("session");
  const recovery = parameters.get("recovery");
  const shortWorkspaceId = parameters.get("short");
  const workspace = parameters.get("workspace");
  return projectId.length >= 1
    && projectId.length <= 256
    && projectId.trim() === projectId
    && !/[\0-\x1f\x7f]/u.test(projectId)
    && (usageGate === null || /^[a-f0-9]{64}$/u.test(usageGate))
    && (session === null || session === "resume")
    && (recovery === null || (recovery === "drafts" && session === "resume"))
    && (workspace === null || workspace === "short-form")
    && (
      shortWorkspaceId === null
        ? true
        : workspace === "short-form"
          && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(shortWorkspaceId)
    );
}

function validPublicLaunchQuery(query: string): boolean {
  if (
    query.length < 1
    || query.length > 2_048
    || /[\\#[\0-\x20\x7f]/u.test(query)
  ) {
    return false;
  }
  const parameters = new URLSearchParams(query);
  if (parameters.toString() !== query) {
    return false;
  }
  const entries = [...parameters.entries()];
  if (
    entries.length !== 1
    || entries[0]?.[0] !== "source"
  ) {
    return false;
  }
  const source = parameters.get("source") || "";
  return source.length <= 1_024
    && canonicalSupportedVodSourceUrl(source) !== null;
}

export function publicShellRequestPath(rawTarget: unknown): string | null {
  const target = String(rawTarget || "");
  if (
    !target.startsWith("/")
    || target.length > 4_096
    || target.startsWith("//")
    || /[\\#[\0-\x20\x7f]/u.test(target)
  ) {
    return null;
  }
  const queryIndex = target.indexOf("?");
  const pathname = queryIndex < 0 ? target : target.slice(0, queryIndex);
  const query = queryIndex < 0 ? null : target.slice(queryIndex + 1);
  if (
    /[%\\#[\0-\x20\x7f]/u.test(pathname)
    || pathname.split("/").some((segment) => segment === "." || segment === "..")
    || (
      query !== null
      && (
        pathname === "/" || pathname === "/index.html"
          ? !validPublicLaunchQuery(query)
          : pathname === "/editor.html"
          ? !validPublicEditorQuery(query)
          : (
            !/\.(?:css|js)$/u.test(pathname)
            || !/^v=(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(query)
          )
      )
    )
  ) {
    return null;
  }
  return pathname;
}

export function resolvePublicShellStaticAsset(
  requestPath: unknown
): Readonly<PublicShellStaticAsset> | null {
  return PUBLIC_SHELL_ROUTES.get(String(requestPath || "")) || null;
}

async function loadPublicShellAssets(
  publicShellRoot: string
): Promise<ReadonlyMap<string, LoadedPublicShellAsset>> {
  const loadedByPath = new Map<string, LoadedPublicShellAsset>();
  const loadedByRelativePath = new Map<string, Buffer>();
  for (const [requestPath, descriptor] of PUBLIC_SHELL_ROUTES) {
    let bytes = loadedByRelativePath.get(descriptor.relativePath);
    if (!bytes) {
      const opened = await readSecurePublicShellFile(
        publicShellRoot,
        descriptor.relativePath,
        MAX_PUBLIC_SHELL_ASSET_BYTES
      );
      if (!opened) {
        throw new Error(
          `공개 shell 파일을 안전하게 읽지 못했습니다: ${descriptor.relativePath}`
        );
      }
      bytes = opened;
      loadedByRelativePath.set(descriptor.relativePath, bytes);
    }
    loadedByPath.set(requestPath, { ...descriptor, bytes });
  }
  return loadedByPath;
}

async function validatePublicShellIdentityFiles(
  publicShellRoot: string,
  loadedAssets: ReadonlyMap<string, LoadedPublicShellAsset>,
  securityHeaders: Readonly<Record<string, string>>
): Promise<void> {
  const hosts = await readSecurePublicShellFile(
    publicShellRoot,
    ".popovic-hosts",
    256
  );
  if (hosts?.toString("utf8") !== `${PUBLIC_SHELL_CANONICAL_HOST}\n`) {
    throw new Error("public-shell/.popovic-hosts가 canonical 공개 Host와 다릅니다.");
  }
  const htmlDocuments = ["/", "/editor.html"].map((requestPath) => ({
    requestPath,
    html: loadedAssets.get(requestPath)?.bytes.toString("utf8") || ""
  }));
  for (const { requestPath, html } of htmlDocuments) {
    const cspMatches = [...html.matchAll(
      /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/gu
    )];
    if (
      cspMatches.length !== 1
      || cspMatches[0]?.[1] !== securityHeaders["Content-Security-Policy"]
    ) {
      throw new Error(
        `${requestPath}의 CSP meta가 HTTP 보안 헤더와 정확히 일치하지 않습니다.`
      );
    }
  }
  const indexHtml = htmlDocuments[0]!.html;
  const editorHtml = htmlDocuments[1]!.html;
  if (
    !/href="\/studio\.css\?v=\d+\.\d+\.\d+"/u.test(indexHtml)
    || !/src="\/studio\.js\?v=\d+\.\d+\.\d+"/u.test(indexHtml)
    || !indexHtml.includes('id="local-app-surface"')
    || !/src="editor\/editor\.js\?v=\d+\.\d+\.\d+"/u.test(editorHtml)
    || /kirinuki:\/\/open/iu.test(`${indexHtml}\n${editorHtml}`)
  ) {
    throw new Error("공개 배포물이 전체 브라우저 편집기 진입점과 다릅니다.");
  }
}

function sendPublicShellResponse(
  response: ServerResponse,
  requestMethod: string | undefined,
  statusCode: number,
  body: Buffer,
  securityHeaders: Readonly<Record<string, string>>,
  contentType: string,
  extraHeaders: Readonly<Record<string, string>> = {}
): void {
  response.writeHead(statusCode, {
    ...securityHeaders,
    "Content-Type": contentType,
    "Content-Length": String(body.byteLength),
    ...extraHeaders
  });
  response.end(requestMethod === "HEAD" ? undefined : body);
}

export async function createPublicShellHttpServer({
  publicShellRoot
}: PublicShellServerOptions): Promise<Server> {
  const root = requiredAbsolutePath(publicShellRoot, "공개 shell root");
  const [securityHeaders, assets] = await Promise.all([
    loadPublicShellSecurityHeaders(root),
    loadPublicShellAssets(root)
  ]);
  await validatePublicShellIdentityFiles(root, assets, securityHeaders);

  const textBody = (value: string) => Buffer.from(value, "utf8");
  const handleRequest = (request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (!hasExactPublicShellHost(request)) {
        sendPublicShellResponse(
          response,
          request.method,
          421,
          textBody("Misdirected Request\n"),
          securityHeaders,
          "text/plain; charset=utf-8"
        );
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendPublicShellResponse(
          response,
          request.method,
          405,
          textBody("Method Not Allowed\n"),
          securityHeaders,
          "text/plain; charset=utf-8",
          { Allow: "GET, HEAD", Connection: "close" }
        );
        return;
      }
      const requestPath = publicShellRequestPath(request.url || "");
      if (!requestPath) {
        sendPublicShellResponse(
          response,
          request.method,
          400,
          textBody("Bad Request\n"),
          securityHeaders,
          "text/plain; charset=utf-8"
        );
        return;
      }
      const asset = assets.get(requestPath);
      if (!asset) {
        sendPublicShellResponse(
          response,
          request.method,
          404,
          textBody("Not Found\n"),
          securityHeaders,
          "text/plain; charset=utf-8"
        );
        return;
      }
      sendPublicShellResponse(
        response,
        request.method,
        200,
        asset.bytes,
        securityHeaders,
        asset.contentType
      );
    })().catch(() => {
      if (!response.headersSent) {
        sendPublicShellResponse(
          response,
          request.method,
          500,
          textBody("Internal Server Error\n"),
          securityHeaders,
          "text/plain; charset=utf-8"
        );
      } else {
        response.destroy();
      }
    });
  };

  const server = createServer({
    insecureHTTPParser: false,
    maxHeaderSize: 16 * 1024
  }, handleRequest);
  server.on("checkContinue", handleRequest);
  server.on("checkExpectation", handleRequest);
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 100;
  return server;
}
