#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server as HttpServer
} from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  PUBLIC_SHELL_BIND_HOST,
  PUBLIC_SHELL_CANONICAL_HOST,
  PUBLIC_SHELL_SECURITY_HEADERS,
  createPublicShellHttpServer
} from "./public-shell-server-core.js";
import { PUBLIC_WEB_PACKAGE_FILES } from "./web-package-files.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const maximumArchiveBytes = 16 * 1024 * 1024;
const maximumEntryBytes = 2 * 1024 * 1024;
const forbiddenResponseHeaders = Object.freeze([
  "nel",
  "report-to",
  "reporting-endpoints",
  "set-cookie",
  "set-cookie2"
]);

type ManagedChild = ChildProcess & {
  stdout: Readable;
  stderr: Readable;
};

interface WebDriverSession {
  readonly sessionId?: unknown;
}

interface WebDriverLogEntry {
  readonly level?: unknown;
  readonly message?: unknown;
  readonly source?: unknown;
}

interface BrowserNetworkRequest {
  readonly documentUrl: string;
  readonly url: string;
}

interface ProxyRequestRecord {
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly requestCookie: string;
  responseHeaders?: IncomingHttpHeaders;
  responseStatus?: number;
}

interface ZipEntry {
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly externalAttributes: number;
  readonly flags: number;
  readonly localHeaderOffset: number;
  readonly name: string;
  readonly uncompressedSize: number;
  readonly versionMadeBy: number;
}

interface HttpResult {
  readonly body: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly statusCode: number;
}

let chromedriver: ManagedChild | null = null;
let chromedriverOutput = "";
let chromedriverPort = 0;
let originServer: HttpServer | null = null;
let proxyServer: HttpServer | null = null;
let sessionId = "";
let temporaryRoot = "";
let cleanupPromise: Promise<void> | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendOutput(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > 80_000 ? next.slice(-80_000) : next;
}

async function readStableRegularFile(
  filePath: string,
  maximumBytes: number
): Promise<Buffer> {
  const before = await lstat(filePath);
  assert(
    before.isFile()
      && !before.isSymbolicLink()
      && before.nlink === 1
      && before.size >= 0
      && before.size <= maximumBytes,
    `안전한 일반 파일이 아닙니다: ${filePath}`
  );
  const bytes = await readFile(filePath);
  const after = await lstat(filePath);
  assert(
    bytes.byteLength === before.size
      && after.isFile()
      && !after.isSymbolicLink()
      && after.nlink === 1
      && after.dev === before.dev
      && after.ino === before.ino
      && after.size === before.size
      && after.mtimeMs === before.mtimeMs
      && after.ctimeMs === before.ctimeMs,
    `검증 중 파일이 바뀌었습니다: ${filePath}`
  );
  return bytes;
}

function decodeExactUtf8(bytes: Buffer, label: string): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} 이름이 올바른 UTF-8이 아닙니다.`);
  }
  assert(Buffer.from(decoded, "utf8").equals(bytes), `${label} 이름이 canonical UTF-8이 아닙니다.`);
  return decoded;
}

function parseZipCentralDirectory(archive: Buffer): ZipEntry[] {
  assert(archive.byteLength >= 22, "공개 shell ZIP이 EOCD보다 짧습니다.");
  const eocdOffset = archive.byteLength - 22;
  assert(
    archive.readUInt32LE(eocdOffset) === 0x06054b50,
    "공개 shell ZIP 끝에 주석 없는 EOCD가 없습니다."
  );
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntries = archive.readUInt16LE(eocdOffset + 8);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);
  assert(
    diskNumber === 0
      && centralDisk === 0
      && diskEntries === totalEntries
      && totalEntries === PUBLIC_WEB_PACKAGE_FILES.length
      && commentLength === 0
      && centralOffset + centralSize === eocdOffset,
    "공개 shell ZIP이 단일 디스크·정확한 엔트리 수·주석 없는 중앙 디렉터리 계약과 다릅니다."
  );
  assert(
    !archive.subarray(0, eocdOffset).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))
      && !archive.subarray(0, eocdOffset).includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])),
    "공개 shell ZIP에 허용하지 않은 ZIP64 레코드가 있습니다."
  );

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assert(
      cursor + 46 <= eocdOffset
        && archive.readUInt32LE(cursor) === 0x02014b50,
      `공개 shell ZIP 중앙 디렉터리 ${index + 1}번 엔트리가 손상되었습니다.`
    );
    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const crc32 = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const startDisk = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + entryCommentLength;
    assert(entryEnd <= eocdOffset, "공개 shell ZIP 중앙 엔트리 길이가 범위를 벗어났습니다.");
    const name = decodeExactUtf8(
      archive.subarray(cursor + 46, cursor + 46 + nameLength),
      "공개 shell ZIP"
    );
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    assert(
      creatorSystem === 3
        && (unixMode & 0o170000) === 0o100000
        && (flags & ~0x0800) === 0
        && (compressionMethod === 0 || compressionMethod === 8)
        && compressedSize <= maximumArchiveBytes
        && uncompressedSize <= maximumEntryBytes
        && nameLength > 0
        && extraLength === 0
        && entryCommentLength === 0
        && startDisk === 0
        && localHeaderOffset < centralOffset,
      `공개 shell ZIP 엔트리가 일반 파일·무암호화·무추가필드 계약과 다릅니다: ${name}`
    );
    entries.push({
      compressedSize,
      compressionMethod,
      crc32,
      externalAttributes,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
      versionMadeBy
    });
    cursor = entryEnd;
  }
  assert(cursor === eocdOffset, "공개 shell ZIP 중앙 디렉터리에 숨은 바이트가 있습니다.");
  return entries;
}

function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

async function listExtractedFiles(
  directory: string,
  prefix = ""
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    assert(!metadata.isSymbolicLink(), `압축 해제 결과에 심볼릭 링크가 있습니다: ${relativePath}`);
    if (entry.isDirectory() && metadata.isDirectory()) {
      files.push(...await listExtractedFiles(absolutePath, relativePath));
    } else {
      assert(
        entry.isFile() && metadata.isFile() && metadata.nlink === 1,
        `압축 해제 결과에 일반 파일이 아닌 항목이 있습니다: ${relativePath}`
      );
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function extractVerifiedZip(
  archive: Buffer,
  destination: string,
  expectedNames: readonly string[]
): Promise<void> {
  const entries = parseZipCentralDirectory(archive);
  const names = entries.map(({ name }) => name).sort();
  assert(
    new Set(names).size === names.length
      && JSON.stringify(names) === JSON.stringify([...expectedNames].sort()),
    `공개 shell ZIP 파일 목록이 정확한 allowlist와 다릅니다: ${JSON.stringify(names)}`
  );

  const ordered = [...entries].sort((left, right) => (
    left.localHeaderOffset - right.localHeaderOffset
  ));
  let expectedLocalOffset = 0;
  for (const entry of ordered) {
    assert(
      entry.localHeaderOffset === expectedLocalOffset
        && entry.localHeaderOffset + 30 <= archive.byteLength
        && archive.readUInt32LE(entry.localHeaderOffset) === 0x04034b50,
      `공개 shell ZIP 로컬 헤더 배열이 연속적이지 않습니다: ${entry.name}`
    );
    const flags = archive.readUInt16LE(entry.localHeaderOffset + 6);
    const compressionMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
    const localCrc32 = archive.readUInt32LE(entry.localHeaderOffset + 14);
    const compressedSize = archive.readUInt32LE(entry.localHeaderOffset + 18);
    const uncompressedSize = archive.readUInt32LE(entry.localHeaderOffset + 22);
    const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
    const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
    const nameStart = entry.localHeaderOffset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    assert(
      flags === entry.flags
        && compressionMethod === entry.compressionMethod
        && localCrc32 === entry.crc32
        && compressedSize === entry.compressedSize
        && uncompressedSize === entry.uncompressedSize
        && extraLength === 0
        && dataEnd <= archive.byteLength
        && decodeExactUtf8(archive.subarray(nameStart, nameStart + nameLength), "ZIP 로컬 헤더") === entry.name,
      `공개 shell ZIP 로컬 헤더와 중앙 디렉터리가 다릅니다: ${entry.name}`
    );
    const compressed = archive.subarray(dataStart, dataEnd);
    const bytes = entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: maximumEntryBytes });
    assert(
      bytes.byteLength === entry.uncompressedSize && crc32(bytes) === entry.crc32,
      `공개 shell ZIP 엔트리의 크기 또는 CRC32가 다릅니다: ${entry.name}`
    );
    const destinationPath = path.join(destination, ...entry.name.split("/"));
    assert(
      destinationPath.startsWith(`${destination}${path.sep}`),
      `공개 shell ZIP 엔트리가 임시 디렉터리를 벗어납니다: ${entry.name}`
    );
    await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
    await writeFile(destinationPath, bytes, { flag: "wx", mode: 0o600 });
    expectedLocalOffset = dataEnd;
  }
  const centralOffset = archive.readUInt32LE(archive.byteLength - 22 + 16);
  assert(expectedLocalOffset === centralOffset, "공개 shell ZIP 로컬 엔트리 뒤에 숨은 바이트가 있습니다.");
  assert(
    JSON.stringify(await listExtractedFiles(destination))
      === JSON.stringify([...expectedNames].sort()),
    "압축 해제 결과가 공개 shell allowlist와 다릅니다."
  );
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(
  environmentName: string,
  candidates: readonly string[]
): Promise<string> {
  const configured = process.env[environmentName];
  const names = configured ? [configured, ...candidates] : [...candidates];
  const directories = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    if (path.isAbsolute(name) || name.includes(path.sep)) {
      const candidate = path.resolve(name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
      continue;
    }
    for (const directory of directories) {
      const candidate = path.join(directory, name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error(
    `${environmentName} 또는 PATH에서 실행 파일을 찾지 못했습니다: ${names.join(", ")}`
  );
}

async function listenLoopback(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: PUBLIC_SHELL_BIND_HOST, port: 0, exclusive: true });
  });
  const address = server.address();
  assert(
    typeof address === "object"
      && address !== null
      && address.address === PUBLIC_SHELL_BIND_HOST
      && Number.isInteger(address.port)
      && address.port >= 1_024,
    "공개 shell smoke 서버가 정확한 loopback 임시 포트에 바인딩되지 않았습니다."
  );
  return address.port;
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, PUBLIC_SHELL_BIND_HOST, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  assert(Number.isInteger(port) && port >= 1_024, "ChromeDriver 임시 포트를 받지 못했습니다.");
  return port;
}

async function requestOrigin(
  port: number,
  requestPath: string,
  method = "GET"
): Promise<HttpResult> {
  return await new Promise<HttpResult>((resolve, reject) => {
    const request = httpRequest({
      agent: false,
      headers: { Host: PUBLIC_SHELL_CANONICAL_HOST },
      host: PUBLIC_SHELL_BIND_HOST,
      method,
      path: requestPath,
      port,
      timeout: 5_000
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maximumEntryBytes) {
          response.destroy(new Error("공개 shell 응답이 최대 크기를 넘었습니다."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        statusCode: response.statusCode || 0
      }));
    });
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("공개 shell 요청 시간이 초과되었습니다.")));
    request.end();
  });
}

function exactHeader(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  assert(typeof value === "string", `${name} 응답 헤더가 단일 문자열이 아닙니다.`);
  return value;
}

function assertPublicSecurityHeaders(headers: IncomingHttpHeaders): void {
  for (const [name, expected] of Object.entries(PUBLIC_SHELL_SECURITY_HEADERS)) {
    assert(
      exactHeader(headers, name) === expected,
      `${name} 응답 헤더가 공개 shell 계약과 다릅니다.`
    );
  }
  for (const name of forbiddenResponseHeaders) {
    assert(headers[name] === undefined, `공개 shell 응답에 금지된 ${name} 헤더가 있습니다.`);
  }
  const csp = exactHeader(headers, "Content-Security-Policy");
  assert(
    !/(?:^|;)\s*(?:report-uri|report-to)\b/iu.test(csp),
    "공개 shell CSP에 보고 수집 지시자가 있습니다."
  );
}

function createBrowserFacingProxy(
  originPort: number,
  records: ProxyRequestRecord[]
): HttpServer {
  let publicPort = 0;
  const server = createHttpServer({
    insecureHTTPParser: false,
    maxHeaderSize: 16 * 1024
  }, (request, response) => {
    const record: ProxyRequestRecord = {
      host: String(request.headers.host || ""),
      method: String(request.method || ""),
      path: String(request.url || ""),
      requestCookie: String(request.headers.cookie || "")
    };
    records.push(record);
    const expectedHost = `${PUBLIC_SHELL_CANONICAL_HOST}:${publicPort}`;
    if (record.host !== expectedHost || (record.method !== "GET" && record.method !== "HEAD")) {
      response.writeHead(421, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": "20",
        Connection: "close"
      });
      response.end("Misdirected Request\n");
      request.resume();
      return;
    }
    const upstream = httpRequest({
      agent: false,
      headers: {
        Accept: String(request.headers.accept || "*/*"),
        Host: PUBLIC_SHELL_CANONICAL_HOST,
        "User-Agent": String(request.headers["user-agent"] || "Kirinuki-public-shell-smoke")
      },
      host: PUBLIC_SHELL_BIND_HOST,
      method: record.method,
      path: record.path,
      port: originPort,
      timeout: 5_000
    }, (upstreamResponse) => {
      record.responseHeaders = upstreamResponse.headers;
      record.responseStatus = upstreamResponse.statusCode || 0;
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.once("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { Connection: "close" });
      }
      response.destroy(error);
    });
    upstream.once("timeout", () => upstream.destroy(new Error("공개 shell upstream 시간이 초과되었습니다.")));
    request.once("aborted", () => upstream.destroy());
    request.resume();
    upstream.end();
  });
  server.on("listening", () => {
    const address = server.address();
    if (typeof address === "object" && address) {
      publicPort = address.port;
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 20;
  return server;
}

async function fetchJson(
  url: string,
  {
    body,
    method = "GET",
    timeoutMs = 30_000
  }: {
    readonly body?: unknown;
    readonly method?: string;
    readonly timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const init: RequestInit = {
    method,
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const detail = isRecord(payload) && isRecord(payload.value)
      ? String(payload.value.message || payload.value.error || response.statusText)
      : response.statusText;
    throw new Error(`${method} ${url} 실패 (${response.status}): ${detail}`);
  }
  return payload;
}

async function webdriver<T = unknown>(
  method: string,
  commandPath: string,
  body?: unknown,
  timeoutMs = 30_000
): Promise<T> {
  const payload = await fetchJson(
    `http://${PUBLIC_SHELL_BIND_HOST}:${chromedriverPort}${commandPath}`,
    { body, method, timeoutMs }
  );
  assert(isRecord(payload), `WebDriver 응답 형식이 올바르지 않습니다: ${commandPath}`);
  const value = payload.value;
  if (isRecord(value) && value.error) {
    throw new Error(`${String(value.error)}: ${String(value.message || "WebDriver 명령 실패")}`);
  }
  return value as T;
}

async function waitForDriver(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (chromedriver?.exitCode !== null) {
      throw new Error(`ChromeDriver가 준비 전에 종료했습니다.\n${chromedriverOutput.trim()}`);
    }
    try {
      const status = await webdriver<Record<string, unknown>>("GET", "/status", undefined, 1_000);
      if (status.ready === true) {
        return;
      }
    } catch {
      // ChromeDriver listener가 올라올 때까지만 재시도한다.
    }
    await delay(100);
  }
  throw new Error(`ChromeDriver가 10초 안에 준비되지 않았습니다.\n${chromedriverOutput.trim()}`);
}

async function execute<T>(script: string, args: readonly unknown[] = []): Promise<T> {
  return webdriver<T>("POST", `/session/${sessionId}/execute/sync`, { script, args });
}

async function executeAsync<T>(script: string, args: readonly unknown[] = []): Promise<T> {
  return webdriver<T>("POST", `/session/${sessionId}/execute/async`, { script, args });
}

async function waitForDocument(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const state = await execute<string>("return document.readyState;");
      if (state === "complete") {
        return;
      }
    } catch {
      // 탐색 중 교체되는 execution context는 재시도한다.
    }
    await delay(100);
  }
  throw new Error("공개 shell 문서가 10초 안에 complete 상태가 되지 않았습니다.");
}

function performanceRequests(
  logs: readonly WebDriverLogEntry[]
): BrowserNetworkRequest[] {
  const requests: BrowserNetworkRequest[] = [];
  for (const entry of logs) {
    if (typeof entry.message !== "string") {
      continue;
    }
    let outer: unknown;
    try {
      outer = JSON.parse(entry.message) as unknown;
    } catch {
      throw new Error("Chrome performance log가 JSON이 아닙니다.");
    }
    if (!isRecord(outer) || !isRecord(outer.message)) {
      continue;
    }
    const message = outer.message;
    if (message.method !== "Network.requestWillBeSent" || !isRecord(message.params)) {
      continue;
    }
    const params = message.params;
    if (isRecord(params.request) && typeof params.request.url === "string") {
      requests.push({
        documentUrl: typeof params.documentURL === "string" ? params.documentURL : "",
        url: params.request.url
      });
    }
  }
  return requests;
}

async function closeHttpServer(server: HttpServer | null): Promise<void> {
  if (!server) {
    return;
  }
  server.closeAllConnections();
  server.closeIdleConnections();
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function stopChildProcess(child: ManagedChild | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const sendSignal = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // 이미 종료한 process group은 정리된 것으로 본다.
    }
  };
  sendSignal("SIGTERM");
  for (
    let attempt = 0;
    attempt < 20 && child.exitCode === null && child.signalCode === null;
    attempt += 1
  ) {
    await delay(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    sendSignal("SIGKILL");
    for (
      let attempt = 0;
      attempt < 20 && child.exitCode === null && child.signalCode === null;
      attempt += 1
    ) {
      await delay(100);
    }
  }
  assert(
    child.exitCode !== null || child.signalCode !== null,
    "ChromeDriver process group을 종료하지 못했습니다."
  );
}

async function cleanup(): Promise<void> {
  cleanupPromise ??= (async () => {
    if (sessionId) {
      try {
        await webdriver("DELETE", `/session/${sessionId}`, undefined, 3_000);
      } catch {
        // process group 종료가 남은 Chrome까지 회수한다.
      }
      sessionId = "";
    }
    await Promise.all([
      closeHttpServer(proxyServer),
      closeHttpServer(originServer)
    ]);
    proxyServer = null;
    originServer = null;
    await stopChildProcess(chromedriver);
    chromedriver = null;
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
      temporaryRoot = "";
    }
  })();
  return cleanupPromise;
}

async function main(): Promise<void> {
  const packageMetadata = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  ) as { readonly name?: unknown; readonly version?: unknown };
  assert(packageMetadata.name === "kirinuki-app", "package 이름이 Kirinuki 단일 앱이 아닙니다.");
  assert(
    typeof packageMetadata.version === "string"
      && /^\d+\.\d+\.\d+$/u.test(packageMetadata.version),
    "package version이 canonical semver가 아닙니다."
  );
  const archiveName = `kirinuki-web-v${packageMetadata.version}.zip`;
  const archivePath = path.join(root, "dist", archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const [archive, checksumBytes] = await Promise.all([
    readStableRegularFile(archivePath, maximumArchiveBytes),
    readStableRegularFile(checksumPath, 512)
  ]);
  const digest = createHash("sha256").update(archive).digest("hex");
  assert(
    checksumBytes.toString("utf8") === `${digest}  ${archiveName}\n`,
    "공개 shell ZIP의 SHA-256 sidecar가 실제 artifact와 정확히 일치하지 않습니다."
  );

  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-public-shell-browser-"));
  const extractedRoot = path.join(temporaryRoot, "extracted-public-shell");
  await mkdir(extractedRoot, { mode: 0o700 });
  const expectedFiles = PUBLIC_WEB_PACKAGE_FILES.map(({ archivePath }) => archivePath).sort();
  assert(
    expectedFiles.length === 6 && new Set(expectedFiles).size === 6,
    "공개 shell allowlist는 정확한 6개 파일이어야 합니다."
  );
  await extractVerifiedZip(archive, extractedRoot, expectedFiles);

  originServer = await createPublicShellHttpServer({ publicShellRoot: extractedRoot });
  const originPort = await listenLoopback(originServer);
  const directDocument = await requestOrigin(originPort, "/");
  assert(directDocument.statusCode === 200, "추출한 공개 shell의 문서 응답이 200이 아닙니다.");
  assertPublicSecurityHeaders(directDocument.headers);
  assert(
    directDocument.body.includes(Buffer.from('class="public-launch-shell"'))
      && !directDocument.body.includes(Buffer.from("<script")),
    "추출한 공개 shell 문서가 무스크립트 launch 화면이 아닙니다."
  );

  const proxyRecords: ProxyRequestRecord[] = [];
  proxyServer = createBrowserFacingProxy(originPort, proxyRecords);
  const publicPort = await listenLoopback(proxyServer);
  const documentUrl = `http://${PUBLIC_SHELL_CANONICAL_HOST}:${publicPort}/`;
  const stylesheetUrl = `${documentUrl}public.css?v=${packageMetadata.version}`;

  const [chromedriverPath, chromiumPath, driverPort] = await Promise.all([
    resolveExecutable("CHROMEDRIVER_BINARY", ["chromedriver"]),
    resolveExecutable("CHROMIUM_BINARY", [
      "chromium",
      "chromium-browser",
      "google-chrome",
      "google-chrome-stable"
    ]),
    reservePort()
  ]);
  chromedriverPort = driverPort;
  chromedriver = spawn(chromedriverPath, [`--port=${driverPort}`], {
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  }) as ManagedChild;
  chromedriver.stdout.on("data", (chunk: Buffer | string) => {
    chromedriverOutput = appendOutput(chromedriverOutput, chunk);
  });
  chromedriver.stderr.on("data", (chunk: Buffer | string) => {
    chromedriverOutput = appendOutput(chromedriverOutput, chunk);
  });
  await waitForDriver();

  const profileRoot = path.join(temporaryRoot, "chromium-profile");
  const created = await webdriver<WebDriverSession>("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        pageLoadStrategy: "normal",
        "goog:loggingPrefs": { browser: "ALL", performance: "ALL" },
        "goog:chromeOptions": {
          binary: chromiumPath,
          args: [
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--disable-client-side-phishing-detection",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-domain-reliability",
            "--disable-extensions",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-proxy-server",
            "--password-store=basic",
            "--use-mock-keychain",
            `--host-resolver-rules=MAP ${PUBLIC_SHELL_CANONICAL_HOST} ${PUBLIC_SHELL_BIND_HOST},EXCLUDE localhost`,
            `--user-data-dir=${profileRoot}`
          ]
        }
      }
    }
  }, 45_000);
  assert(typeof created.sessionId === "string" && created.sessionId, "WebDriver session ID가 없습니다.");
  sessionId = created.sessionId;
  await webdriver("POST", `/session/${sessionId}/url`, {
    url: "data:text/html,%3Ctitle%3EKirinuki%20smoke%20bootstrap%3C%2Ftitle%3E"
  });
  await waitForDocument();
  await delay(200);
  await webdriver<WebDriverLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  await webdriver("POST", `/session/${sessionId}/url`, { url: documentUrl });
  await waitForDocument();
  await delay(500);

  const page = await execute<{
    readonly appHref: string;
    readonly computedDisplay: string;
    readonly cookie: string;
    readonly fallback: string;
    readonly forbiddenHtml: boolean;
    readonly forbiddenSelectors: number;
    readonly hostname: string;
    readonly inlineHandlers: number;
    readonly installHref: string;
    readonly launchTitle: string;
    readonly localStorageLength: number;
    readonly protocol: string;
    readonly requirements: string;
    readonly resourceEntries: readonly { readonly initiatorType: string; readonly name: string }[];
    readonly scriptCount: number;
    readonly sessionStorageLength: number;
    readonly stylesheetCount: number;
  }>(`
    const html = document.documentElement.outerHTML;
    const inlineHandlers = Array.from(document.querySelectorAll("*")).reduce(
      (count, element) => count + Array.from(element.attributes).filter(
        (attribute) => attribute.name.toLowerCase().startsWith("on")
      ).length,
      0
    );
    return {
      appHref: document.querySelector('a[href^="kirinuki:"]')?.getAttribute("href") || "",
      computedDisplay: getComputedStyle(document.querySelector(".public-launch-card")).display,
      cookie: document.cookie,
      fallback: document.querySelector("#public-launch-guide")?.textContent || "",
      forbiddenHtml: /127\\.0\\.0\\.1|localhost|:4319|:4320|\\/v1\\/|editor\\.html|studio\\.js|audseg-worker/i.test(html),
      forbiddenSelectors: document.querySelectorAll(
        "script, iframe, form, video, audio, canvas, #start-editor, #mobile-editor-notice, .local-app-surface"
      ).length,
      hostname: location.hostname,
      inlineHandlers,
      installHref: document.querySelector('a[href*="github.com"][href*="#"]')?.href || "",
      launchTitle: document.querySelector("#public-launch-title")?.textContent || "",
      localStorageLength: localStorage.length,
      protocol: location.protocol,
      requirements: document.querySelector(".requirements")?.textContent || "",
      resourceEntries: performance.getEntriesByType("resource").map((entry) => ({
        initiatorType: entry.initiatorType,
        name: entry.name
      })),
      scriptCount: document.scripts.length,
      sessionStorageLength: sessionStorage.length,
      stylesheetCount: document.styleSheets.length
    };
  `);
  assert(page.hostname === PUBLIC_SHELL_CANONICAL_HOST, "브라우저 문서 origin이 공개 canonical Host가 아닙니다.");
  assert(page.protocol === "http:", "smoke 문서가 예기치 않은 scheme으로 바뀌었습니다.");
  assert(page.appHref === "kirinuki://open", "앱 실행 링크가 canonical kirinuki://open이 아닙니다.");
  assert(
    page.installHref.startsWith("https://github.com/studyreadbook4ever/KirinukiHelper#"),
    "설치 방법 링크가 렌더링되지 않았습니다."
  );
  assert(
    /Kirinuki 앱에서 이어집니다/u.test(page.launchTitle)
      && /앱이 열리지 않았다면/u.test(page.fallback)
      && /모바일에서는 편집기를\s*열 수 없습니다/u.test(page.fallback)
      && /Node\.js 22/u.test(page.requirements)
      && /Python 3\.11/u.test(page.requirements)
      && /FFmpeg/u.test(page.requirements)
      && /Whisper/u.test(page.requirements)
      && page.computedDisplay !== "none"
      && page.stylesheetCount === 1,
    "앱 실행·설치 fallback·요구사항 또는 CSS가 화면에 완전하게 렌더링되지 않았습니다."
  );
  assert(
    page.scriptCount === 0
      && page.inlineHandlers === 0
      && page.forbiddenSelectors === 0
      && !page.forbiddenHtml,
    "공개 shell DOM에 script 실행점 또는 로컬 편집기/runtime 표면이 있습니다."
  );
  assert(
    page.localStorageLength === 0
      && page.sessionStorageLength === 0
      && page.cookie === "",
    "공개 shell이 브라우저 문자열 저장소 또는 쿠키를 만들었습니다."
  );
  assert(
    page.resourceEntries.length === 1
      && page.resourceEntries[0]?.name === stylesheetUrl
      && page.resourceEntries[0]?.initiatorType === "link",
    `공개 shell resource 집합이 CSS 하나가 아닙니다: ${JSON.stringify(page.resourceEntries)}`
  );

  const persistentState = await executeAsync<{
    readonly cacheKeys: readonly string[];
    readonly controlled: boolean;
    readonly databases: readonly { readonly name?: string; readonly version?: number }[];
    readonly serviceWorkers: number;
  }>(`
    const done = arguments[arguments.length - 1];
    Promise.all([
      typeof indexedDB.databases === "function" ? indexedDB.databases() : Promise.reject(new Error("indexedDB.databases unavailable")),
      "serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]),
      "caches" in globalThis ? caches.keys() : Promise.resolve([])
    ]).then(([databases, registrations, cacheKeys]) => done({
      cacheKeys,
      controlled: Boolean("serviceWorker" in navigator && navigator.serviceWorker.controller),
      databases,
      serviceWorkers: registrations.length
    }), (error) => done({ error: String(error) }));
  `);
  assert(
    Array.isArray(persistentState.databases)
      && persistentState.databases.length === 0
      && persistentState.serviceWorkers === 0
      && persistentState.controlled === false
      && persistentState.cacheKeys.length === 0,
    `공개 shell이 IndexedDB·Service Worker·Cache Storage 상태를 만들었습니다: ${JSON.stringify(persistentState)}`
  );
  const cookies = await webdriver<unknown[]>("GET", `/session/${sessionId}/cookie`);
  assert(Array.isArray(cookies) && cookies.length === 0, "공개 shell browser cookie jar가 비어 있지 않습니다.");

  const performanceLogs = await webdriver<WebDriverLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  const networkRequests = performanceRequests(performanceLogs);
  const networkUrls = networkRequests.map(({ url }) => url);
  const externalNetworkUrls = networkUrls.filter((url) => /^https?:/u.test(url));
  const publicOrigin = new URL(documentUrl).origin;
  const publicPageRequests = networkRequests.filter((request) => (
    request.documentUrl.startsWith(publicOrigin)
      || request.url.startsWith(publicOrigin)
  ));
  assert(networkUrls.includes(documentUrl), "브라우저 network log에 공개 shell 문서 요청이 없습니다.");
  assert(networkUrls.includes(stylesheetUrl), "브라우저 network log에 공개 shell CSS 요청이 없습니다.");
  assert(
    externalNetworkUrls.every((url) => url === documentUrl || url === stylesheetUrl),
    `브라우저가 문서·CSS 외 외부 network 요청을 만들었습니다: ${JSON.stringify(externalNetworkUrls)}`
  );
  assert(
    publicPageRequests.every(({ url }) => (
      url === documentUrl
      || url === stylesheetUrl
      || url.startsWith("data:image/svg+xml,")
    )),
    `공개 shell 문서가 문서·CSS·data favicon 외 요청을 만들었습니다: ${JSON.stringify(publicPageRequests)}`
  );
  assert(
    networkUrls.every((url) => !/127\.0\.0\.1|localhost|:4319|:4320|\/v1\//iu.test(url)),
    "브라우저가 loopback 편집기 또는 내부 API를 요청했습니다."
  );

  const expectedRequestPaths = ["/", `/public.css?v=${packageMetadata.version}`].sort();
  assert(
    proxyRecords.length === 2
      && JSON.stringify(proxyRecords.map(({ path: requestPath }) => requestPath).sort())
        === JSON.stringify(expectedRequestPaths),
    `공개 hostname proxy가 문서·CSS 외 요청을 받았습니다: ${JSON.stringify(proxyRecords)}`
  );
  for (const record of proxyRecords) {
    assert(
      record.host === `${PUBLIC_SHELL_CANONICAL_HOST}:${publicPort}`
        && record.method === "GET"
        && record.requestCookie === ""
        && record.responseStatus === 200
        && record.responseHeaders,
      `공개 hostname 실제 요청 계약이 다릅니다: ${JSON.stringify(record)}`
    );
    assertPublicSecurityHeaders(record.responseHeaders);
  }

  const browserLogs = await webdriver<WebDriverLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "browser" }
  );
  const unexpectedBrowserErrors = browserLogs.filter((entry) => (
    entry.level === "SEVERE"
      && !String(entry.message || "").includes("frame-ancestors")
      && !(
        String(entry.message || "").includes("Cross-Origin-Opener-Policy header has been ignored")
          && String(entry.message || "").includes("origin was untrustworthy")
      )
  ));
  assert(
    unexpectedBrowserErrors.length === 0,
    `공개 shell browser console에 오류가 있습니다: ${JSON.stringify(unexpectedBrowserErrors)}`
  );

  process.stdout.write(`${JSON.stringify({
    archive: path.relative(root, archivePath),
    browserOrigin: new URL(documentUrl).origin,
    files: expectedFiles.length,
    requests: expectedRequestPaths,
    securityHeaders: Object.keys(PUBLIC_SHELL_SECURITY_HEADERS).length,
    sha256: digest,
    storage: "empty"
  }, null, 2)}\n`);
}

const terminate = (exitCode: number) => {
  void cleanup().finally(() => process.exit(exitCode));
};
process.once("SIGINT", () => terminate(130));
process.once("SIGTERM", () => terminate(143));

try {
  await main();
} catch (error) {
  process.stderr.write(`공개 shell browser smoke 실패: ${errorMessage(error)}\n`);
  if (chromedriverOutput.trim()) {
    process.stderr.write(`ChromeDriver 최근 출력:\n${chromedriverOutput.trim()}\n`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
