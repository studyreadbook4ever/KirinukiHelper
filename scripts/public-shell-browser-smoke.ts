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
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server as HttpServer
} from "node:http";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer
} from "node:https";
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
import {
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
} from "./chzzk-vod-job-manager.js";
import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
  LOCAL_MEDIA_ENGINE_PRODUCT,
  LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA
} from "../src/lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  freshLocalMediaEngineChallenge,
  localMediaEngineProofTranscript,
  pairingResponseUnsignedPayload,
  parseLocalMediaEngineDeviceProof,
  parseLocalMediaEnginePairingResponse,
  verifyLocalMediaEngineSignature
} from "../src/lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_TRUST_DATABASE,
  LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
  LOCAL_MEDIA_ENGINE_TRUST_STORE
} from "../src/editor/local-media-engine-trust.js";
import {
  createLocalMediaEngineV2Fixture,
  type LocalMediaEngineV2Fixture,
  type LocalMediaEngineV2FixtureRecord
} from "./local-media-engine-v2-fixture.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const maximumArchiveBytes = 32 * 1024 * 1024;
const maximumEntryBytes = 16 * 1024 * 1024;
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

type LocalEngineProbeRecord = LocalMediaEngineV2FixtureRecord;

interface LocalEngineSemanticFixtureState {
  materializationRequests: number;
  mediaRequests: number;
  sessionRequests: number;
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
let localEngineProbeServer: Readonly<LocalMediaEngineV2Fixture> | null = null;
let originServer: HttpServer | null = null;
let proxyServer: HttpsServer | null = null;
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

async function listenLoopback(server: HttpServer | HttpsServer): Promise<number> {
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

async function listenLocalEngineProbe(
  fixture: Readonly<LocalMediaEngineV2Fixture>
): Promise<void> {
  await fixture.listen();
}

async function createLocalEngineV2ProbeFixture(
  records: LocalEngineProbeRecord[],
  mediaBytes: Buffer,
  fixtureState: LocalEngineSemanticFixtureState
): Promise<Readonly<LocalMediaEngineV2Fixture>> {
  const mediaAccess = "M".repeat(43);
  const jobId = "semantic_browser_job_0001";
  const publicOrigin = `https://${PUBLIC_SHELL_CANONICAL_HOST}`;
  let fixture: Readonly<LocalMediaEngineV2Fixture> | null = null;
  fixture = await createLocalMediaEngineV2Fixture({
    allowedOrigin: publicOrigin,
    originBinding: "exact-public-studio",
    records,
    onControlRequest: (control) => {
      const requestUrl = new URL(control.path, "http://127.0.0.1:4319");
      if (
        requestUrl.pathname !== "/v1/vod/materializations"
        || control.method !== "POST"
        || !isRecord(control.body)
      ) {
        return {
          status: 404,
          statusText: "Not Found",
          payload: {
            error: {
              code: "SEMANTIC_FIXTURE_NOT_FOUND",
              message: "semantic v2 fixture가 허용하지 않은 요청입니다."
            }
          }
        };
      }
      const body = control.body;
      const clips = Array.isArray(body.clips) ? body.clips : [];
      const clip = isRecord(clips[0]) ? clips[0] : null;
      const clipId = String(clip?.id || "");
      const sourceStartMs = Number(clip?.startMs);
      const sourceEndMs = Number(clip?.endMs);
      const previewRequest = clipId.startsWith("preview-");
      fixtureState.sessionRequests = fixture?.sessions.length || 0;
      assert(
        control.protocol === CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
          && control.mediaAccess === null
          && body.schema === CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
          && control.session.projectId === body.consumerId
          && control.session.sourceUrl === "https://chzzk.naver.com/video/14252987"
          && JSON.stringify(control.session.actions)
            === JSON.stringify(["vod", "cache-delete"])
          && body.sourceUrl === control.session.sourceUrl
          && body.handleMs === 10_000
          && clips.length === 1
          && clipId.length > 0
          && Number.isSafeInteger(sourceStartMs)
          && Number.isSafeInteger(sourceEndMs)
          && (
            previewRequest
              ? sourceStartMs >= 0
                && sourceEndMs > sourceStartMs
                && sourceEndMs <= 120_000
              : sourceStartMs === 10_000
                && sourceEndMs === 11_000
          ),
        "공개 편집기의 v2 encrypted VOD prepare 범위·session scope가 다릅니다."
      );
      const editableSourceStartMs = Math.max(0, sourceStartMs - 10_000);
      const editableSourceEndMs = Math.min(600_000, sourceEndMs + 10_000);
      const materializedDurationMs = editableSourceEndMs - editableSourceStartMs;
      const planFingerprint = "b".repeat(64);
      fixtureState.materializationRequests += 1;
      return {
        status: 202,
        payload: {
          schema: "chzzk-kirinuki-vod-materialization-status/v1",
          jobId,
          state: "completed",
          progress: 1,
          message: "공개 HTTPS semantic v2 fixture 준비 완료",
          reused: false,
          materialization: {
            schema: "chzzk-kirinuki-chzzk-vod-materialization/v2",
            materializationId: planFingerprint.slice(0, 32),
            planFingerprint,
            source: {
              platform: "CHZZK",
              contentType: "vod",
              contentId: "14252987",
              sourceVersionId: "c".repeat(64)
            },
            sourceDurationMs: 600_000,
            handleMs: 10_000,
            mediaDurationMs: materializedDurationMs,
            windows: [{
              id: "semantic-browser-window-1",
              editableSourceStartMs,
              editableSourceEndMs,
              fetchedSourceStartMs: editableSourceStartMs,
              fetchedSourceEndMs: editableSourceEndMs,
              mediaStartMs: 0,
              mediaEndMs: materializedDurationMs,
              clipIds: [clipId]
            }],
            clipRanges: [{
              clipId,
              sourceStartMs,
              sourceEndMs,
              editableSourceStartMs,
              editableSourceEndMs
            }],
            preparedAt: "2026-08-21T00:00:00.000Z",
            localOnly: true
          },
          media: {
            url: `http://127.0.0.1:4319/v1/vod/media/${jobId}?access=${mediaAccess}`,
            name: "semantic-browser-materialized.mp4",
            size: mediaBytes.byteLength,
            type: "video/mp4",
            lastModified: 1_787_270_400_000
          }
        }
      };
    },
    onMediaRequest: ({ method, path: mediaPath, request, response }) => {
      const requestUrl = new URL(mediaPath, "http://127.0.0.1:4319");
      if (
        requestUrl.pathname !== `/v1/vod/media/${jobId}`
        || requestUrl.searchParams.get("access") !== mediaAccess
      ) {
        return false;
      }
      fixtureState.mediaRequests += 1;
      const range = /^bytes=(\d+)-(\d*)$/u.exec(
        String(request.headers.range || "")
      );
      const start = range ? Number(range[1]) : 0;
      const requestedEnd = range?.[2]
        ? Number(range[2])
        : mediaBytes.length - 1;
      const end = Math.min(requestedEnd, mediaBytes.length - 1);
      assert(
        Number.isSafeInteger(start)
          && Number.isSafeInteger(end)
          && start >= 0
          && end >= start
          && end < mediaBytes.length,
        "브라우저 media Range가 v2 fixture 범위를 벗어났습니다."
      );
      const selected = mediaBytes.subarray(start, end + 1);
      const partial = Boolean(range);
      response.writeHead(partial ? 206 : 200, {
        "Access-Control-Allow-Origin": publicOrigin,
        "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Type": "video/mp4",
        "Content-Length": String(selected.byteLength),
        ...(partial
          ? { "Content-Range": `bytes ${start}-${end}/${mediaBytes.byteLength}` }
          : {}),
        ETag: `"semantic-${mediaBytes.byteLength}"`,
        "X-Content-Type-Options": "nosniff"
      });
      response.end(method === "HEAD" ? undefined : selected);
      request.resume();
      return true;
    }
  });
  return fixture;
}

async function createSemanticFixtureMedia(directory: string): Promise<Buffer> {
  const ffmpeg = await resolveExecutable(
    "FFMPEG_BINARY",
    process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"]
  );
  const outputPath = path.join(directory, "semantic-browser-materialized.mp4");
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const child = spawn(ffmpeg, [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      "-f", "lavfi",
      "-i", "color=c=black:s=160x90:r=30:d=21",
      "-f", "lavfi",
      "-i", "anullsrc=r=48000:cl=stereo:d=21",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-profile:v", "baseline",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "64k",
      "-shortest",
      "-movflags", "+faststart",
      "-n",
      outputPath
    ], {
      cwd: directory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const collect = (chunk: Buffer | string) => {
      output = appendOutput(output, chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("semantic browser MP4 생성 시간이 초과되었습니다."));
    }, 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error(
        `semantic browser MP4 생성 실패 (code=${String(code)}, signal=${String(signal)}): ${output.trim()}`
      ));
    });
  });
  const bytes = await readStableRegularFile(outputPath, 4 * 1024 * 1024);
  assert(bytes.byteLength > 1_024, "semantic browser MP4가 너무 짧습니다.");
  return bytes;
}

async function createEphemeralHttpsCertificate(
  directory: string
): Promise<{ readonly certificate: Buffer; readonly privateKey: Buffer }> {
  // Keep the browser URL on the production origin without contacting the
  // deployed site. This certificate exists only inside the disposable smoke
  // directory and Chromium accepts it only in this isolated test profile.
  const opensslPath = await resolveExecutable(
    "OPENSSL_BINARY",
    process.platform === "win32" ? ["openssl.exe", "openssl"] : ["openssl"]
  );
  const configPath = path.join(directory, "openssl-smoke.cnf");
  const certificatePath = path.join(directory, "public-smoke.crt");
  const privateKeyPath = path.join(directory, "public-smoke.key");
  await writeFile(configPath, [
    "[req]",
    "distinguished_name = subject",
    "x509_extensions = extensions",
    "prompt = no",
    "[subject]",
    `CN = ${PUBLIC_SHELL_CANONICAL_HOST}`,
    "[extensions]",
    `subjectAltName = DNS:${PUBLIC_SHELL_CANONICAL_HOST}`,
    "basicConstraints = critical,CA:FALSE",
    "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    ""
  ].join("\n"), { flag: "wx", mode: 0o600 });

  await new Promise<void>((resolve, reject) => {
    let output = "";
    const child = spawn(opensslPath, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1",
      "-config",
      configPath,
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath
    ], {
      cwd: directory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("OpenSSL smoke 인증서 생성 시간이 초과되었습니다."));
    }, 15_000);
    const collect = (chunk: Buffer | string) => {
      output = appendOutput(output, chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error(
        `OpenSSL smoke 인증서 생성에 실패했습니다 (code=${String(code)}, signal=${String(signal)}): ${output.trim()}`
      ));
    });
  });

  const [certificate, privateKey] = await Promise.all([
    readStableRegularFile(certificatePath, 64 * 1024),
    readStableRegularFile(privateKeyPath, 64 * 1024)
  ]);
  assert(
    certificate.includes(Buffer.from("BEGIN CERTIFICATE"))
      && (
        privateKey.includes(Buffer.from("BEGIN PRIVATE KEY"))
        || privateKey.includes(Buffer.from("BEGIN RSA PRIVATE KEY"))
      ),
    "생성한 HTTPS smoke 인증서 또는 개인 키가 PEM 형식이 아닙니다."
  );
  return { certificate, privateKey };
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
  records: ProxyRequestRecord[],
  certificate: Buffer,
  privateKey: Buffer
): HttpsServer {
  const server = createHttpsServer({
    cert: certificate,
    key: privateKey,
    minVersion: "TLSv1.2",
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
    if (
      record.host !== PUBLIC_SHELL_CANONICAL_HOST
      || (record.method !== "GET" && record.method !== "HEAD")
    ) {
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

async function enrollPublicLocalMediaEngineFixture(
  fixture: Readonly<LocalMediaEngineV2Fixture>
): Promise<void> {
  const state = freshLocalMediaEngineChallenge();
  const challenge = freshLocalMediaEngineChallenge();
  const pairingResult = await executeAsync<{
    readonly error: string;
    readonly ok: boolean;
    readonly status: number;
    readonly value: unknown;
  }>(`
    const done = arguments[arguments.length - 1];
    fetch("http://127.0.0.1:4319/v1/pairing", {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      targetAddressSpace: "loopback",
      headers: {
        "X-Kirinuki-Protocol": arguments[0],
        [arguments[1]]: arguments[2],
        [arguments[3]]: arguments[4]
      }
    }).then(async (response) => done({
      error: "",
      ok: response.ok,
      status: response.status,
      value: await response.json()
    }), (error) => done({
      error: String(error),
      ok: false,
      status: 0,
      value: null
    }));
  `, [
    LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
    LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
    state,
    LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
    challenge
  ]);
  const pairing = parseLocalMediaEnginePairingResponse(pairingResult.value);
  assert(
    pairingResult.ok
      && pairingResult.status === 200
      && !pairingResult.error
      && pairing
      && pairing.state === state
      && pairing.challenge === challenge
      && pairing.keyId === fixture.keyId
      && pairing.publicKeySpki === fixture.publicKeySpki
      && await verifyLocalMediaEngineSignature({
        publicKeySpki: pairing.publicKeySpki,
        signature: pairing.signature,
        transcript: localMediaEngineProofTranscript({
          kind: "pairing",
          challenge,
          instanceNonce: "",
          requestBinding: state,
          payload: pairingResponseUnsignedPayload(pairing)
        })
      }),
    `공개 HTTPS smoke의 v2 pairing identity 서명이 올바르지 않습니다: ${JSON.stringify(pairingResult)}`
  );
  const pin = {
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: pairing.algorithm,
    keyId: pairing.keyId,
    publicKeySpki: pairing.publicKeySpki,
    enrolledAt: new Date().toISOString(),
    maxSeenVersion: pairing.engineVersion
  };
  const stored = await executeAsync<{
    readonly error: string;
    readonly ready: boolean;
  }>(`
    const done = arguments[arguments.length - 1];
    const open = indexedDB.open(arguments[0], 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(arguments[1])) {
        open.result.createObjectStore(arguments[1]);
      }
    };
    open.onerror = () => done({
      ready: false,
      error: String(open.error || "open failed")
    });
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(arguments[1], "readwrite");
      transaction.objectStore(arguments[1]).put(arguments[2], "active");
      transaction.oncomplete = () => {
        database.close();
        done({ ready: true, error: "" });
      };
      transaction.onerror = () => {
        database.close();
        done({
          ready: false,
          error: String(transaction.error || "pin write failed")
        });
      };
    };
  `, [
    LOCAL_MEDIA_ENGINE_TRUST_DATABASE,
    LOCAL_MEDIA_ENGINE_TRUST_STORE,
    pin
  ]);
  assert(
    stored.ready && !stored.error,
    `공개 HTTPS smoke의 검증된 v2 pin 저장 실패: ${stored.error}`
  );
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

async function waitFor<T>(
  sample: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string | (() => string),
  timeoutMs = 20_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    try {
      lastValue = await sample();
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch {
      // Navigation can replace the execution context between two polls.
    }
    await delay(100);
  }
  throw new Error(`${typeof label === "function" ? label() : label}: ${JSON.stringify(lastValue)}`);
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

async function closeHttpServer(server: HttpServer | HttpsServer | null): Promise<void> {
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
      localEngineProbeServer?.close(),
      closeHttpServer(proxyServer),
      closeHttpServer(originServer)
    ]);
    localEngineProbeServer = null;
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
  assert(packageMetadata.name === "kirinuki-app", "package 이름이 Kirinuki 웹 제품이 아닙니다.");
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
    new Set(expectedFiles).size === expectedFiles.length
      && expectedFiles.includes("index.html")
      && expectedFiles.includes("studio.css")
      && expectedFiles.includes("studio.js")
      && expectedFiles.includes("editor.html")
      && expectedFiles.includes("editor/editor.css")
      && expectedFiles.includes("editor/editor.js")
      && expectedFiles.includes("editor/audseg-worker.js")
      && expectedFiles.includes("_headers")
      && expectedFiles.includes(".popovic-hosts"),
    "공개 웹 allowlist에 전체 시작 화면·편집기·배포 identity 파일이 없습니다."
  );
  await extractVerifiedZip(archive, extractedRoot, expectedFiles);

  originServer = await createPublicShellHttpServer({ publicShellRoot: extractedRoot });
  const originPort = await listenLoopback(originServer);
  const [directDocument, directEditorDocument] = await Promise.all([
    requestOrigin(originPort, "/"),
    requestOrigin(originPort, "/editor.html")
  ]);
  assert(directDocument.statusCode === 200, "추출한 공개 웹 시작 문서 응답이 200이 아닙니다.");
  assert(directEditorDocument.statusCode === 200, "추출한 공개 웹 편집기 문서 응답이 200이 아닙니다.");
  assertPublicSecurityHeaders(directDocument.headers);
  assertPublicSecurityHeaders(directEditorDocument.headers);
  assert(
    directDocument.body.includes(Buffer.from('id="local-app-surface"'))
      && directDocument.body.includes(Buffer.from('src="/studio.js?v='))
      && directDocument.body.includes(Buffer.from('href="/studio.css?v='))
      && directEditorDocument.body.includes(Buffer.from('id="editor-origin-gate"'))
      && directEditorDocument.body.includes(Buffer.from('src="editor/editor.js?v='))
      && directEditorDocument.body.includes(Buffer.from('href="editor/editor.css?v='))
      && !directDocument.body.includes(Buffer.from("kirinuki://open"))
      && !directEditorDocument.body.includes(Buffer.from("kirinuki://open")),
    "추출한 공개 웹 문서가 전체 브라우저 시작 화면·편집기 진입점과 다릅니다."
  );

  const proxyRecords: ProxyRequestRecord[] = [];
  const localEngineProbeRecords: LocalEngineProbeRecord[] = [];
  const semanticFixtureState: LocalEngineSemanticFixtureState = {
    materializationRequests: 0,
    mediaRequests: 0,
    sessionRequests: 0
  };
  const semanticFixtureMedia = await createSemanticFixtureMedia(temporaryRoot);
  localEngineProbeServer = await createLocalEngineV2ProbeFixture(
    localEngineProbeRecords,
    semanticFixtureMedia,
    semanticFixtureState
  );
  try {
    await listenLocalEngineProbe(localEngineProbeServer);
  } catch (error) {
    throw new Error(
      "LNA browser smoke를 위해 127.0.0.1:4319가 비어 있어야 합니다. "
      + `실행 중인 Kirinuki engine을 먼저 종료해 주세요: ${errorMessage(error)}`
    );
  }
  const { certificate, privateKey } = await createEphemeralHttpsCertificate(temporaryRoot);
  proxyServer = createBrowserFacingProxy(
    originPort,
    proxyRecords,
    certificate,
    privateKey
  );
  const publicPort = await listenLoopback(proxyServer);
  const documentUrl = `https://${PUBLIC_SHELL_CANONICAL_HOST}/`;
  const stylesheetUrl = `${documentUrl}studio.css?v=${packageMetadata.version}`;
  const scriptUrl = `${documentUrl}studio.js?v=${packageMetadata.version}`;

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
            "--enable-features=LocalNetworkAccessChecks",
            "--ignore-certificate-errors",
            "--metrics-recording-only",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-proxy-server",
            "--password-store=basic",
            "--use-mock-keychain",
            `--host-resolver-rules=MAP ${PUBLIC_SHELL_CANONICAL_HOST}:443 ${PUBLIC_SHELL_BIND_HOST}:${publicPort},EXCLUDE localhost`,
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await execute<string>("return document.body.dataset.kirinukiSurface || '';" ) === "local") {
      break;
    }
    await delay(100);
  }
  await delay(500);

  const page = await execute<{
    readonly bodySurface: string;
    readonly cookie: string;
    readonly editorButtonText: string;
    readonly externalEmbedsWithSource: number;
    readonly formPresent: boolean;
    readonly hostname: string;
    readonly inlineHandlers: number;
    readonly legacyAppLinks: number;
    readonly localHidden: boolean;
    readonly localInert: boolean;
    readonly localStorageLength: number;
    readonly origin: string;
    readonly privacyText: string;
    readonly protocol: string;
    readonly publicHidden: boolean;
    readonly publicInert: boolean;
    readonly resourceEntries: readonly { readonly initiatorType: string; readonly name: string }[];
    readonly scriptSources: readonly string[];
    readonly sessionStorageLength: number;
    readonly sourceInputLabel: string;
    readonly startTitle: string;
    readonly stylesheetHrefs: readonly string[];
    readonly title: string;
  }>(`
    const html = document.documentElement.outerHTML;
    const inlineHandlers = Array.from(document.querySelectorAll("*")).reduce(
      (count, element) => count + Array.from(element.attributes).filter(
        (attribute) => attribute.name.toLowerCase().startsWith("on")
      ).length,
      0
    );
    const publicSurface = document.querySelector("#public-launch-shell");
    const localSurface = document.querySelector("#local-app-surface");
    return {
      bodySurface: document.body.dataset.kirinukiSurface || "",
      cookie: document.cookie,
      editorButtonText: document.querySelector("#start-editor")?.textContent?.trim() || "",
      externalEmbedsWithSource: Array.from(document.querySelectorAll("iframe")).filter(
        (frame) => Boolean(frame.getAttribute("src"))
      ).length,
      formPresent: document.querySelector("#start-form") instanceof HTMLFormElement,
      hostname: location.hostname,
      inlineHandlers,
      legacyAppLinks: document.querySelectorAll('a[href^="kirinuki:"]').length + (/kirinuki:\\/\\/open/i.test(html) ? 1 : 0),
      localHidden: Boolean(localSurface?.hidden),
      localInert: Boolean(localSurface?.inert),
      localStorageLength: localStorage.length,
      origin: location.origin,
      privacyText: document.querySelector(".site-trust-notice")?.textContent || "",
      protocol: location.protocol,
      publicHidden: Boolean(publicSurface?.hidden),
      publicInert: Boolean(publicSurface?.inert),
      resourceEntries: performance.getEntriesByType("resource").map((entry) => ({
        initiatorType: entry.initiatorType,
        name: entry.name
      })),
      scriptSources: Array.from(document.scripts).map((script) => script.src),
      sessionStorageLength: sessionStorage.length,
      sourceInputLabel: document.querySelector('label[for="source-url"], label:has(#source-url) > span')?.textContent || "",
      startTitle: document.querySelector("#start-title")?.textContent || "",
      stylesheetHrefs: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((link) => link.href),
      title: document.title
    };
  `);
  assert(page.hostname === PUBLIC_SHELL_CANONICAL_HOST, "브라우저 문서 origin이 공개 canonical Host가 아닙니다.");
  assert(page.origin === `https://${PUBLIC_SHELL_CANONICAL_HOST}`, "브라우저 문서 origin이 정확한 공개 HTTPS Origin이 아닙니다.");
  assert(page.protocol === "https:", "공개 웹 smoke 문서가 HTTPS로 열리지 않았습니다.");
  assert(
    page.bodySurface === "local"
      && page.localHidden === false
      && page.localInert === false
      && page.publicHidden === true
      && page.publicInert === true,
    "공개 HTTPS에서 launch shell이 아니라 전체 브라우저 시작 화면이 활성화되지 않았습니다."
  );
  assert(
    page.title === "Kirinuki"
      && /VOD에서 편집할 구간을 선택하세요/u.test(page.startTitle)
      && page.formPresent
      && page.editorButtonText === "편집기 열기"
      && /CHZZK·YouTube·SOOP 공개 VOD 주소/u.test(page.sourceInputLabel)
      && /사용기록과 개인정보를 일절 수집하지 않/u.test(page.privacyText)
      && /오픈소스/u.test(page.privacyText),
    "공개 HTTPS에서 전체 VOD 구간 선택·편집기 진입·개인정보 안내 UI가 렌더링되지 않았습니다."
  );
  assert(
    page.scriptSources.length === 1
      && page.scriptSources[0] === scriptUrl
      && page.stylesheetHrefs.length === 1
      && page.stylesheetHrefs[0] === stylesheetUrl
      && page.inlineHandlers === 0
      && page.legacyAppLinks === 0
      && page.externalEmbedsWithSource === 0,
    "공개 시작 화면의 self-host module/CSS 또는 무인라인·무legacy-app 초기 상태 계약이 다릅니다."
  );
  assert(
    page.localStorageLength === 0
      && page.sessionStorageLength === 0
      && page.cookie === "",
    "새 공개 웹 시작 화면이 사용자 동작 전에 문자열 저장소 또는 쿠키를 만들었습니다."
  );
  assert(
    page.resourceEntries.some(({ name, initiatorType }) => (
      name === stylesheetUrl && initiatorType === "link"
    ))
      && page.resourceEntries.some(({ name, initiatorType }) => (
        name === scriptUrl && initiatorType === "script"
      )),
    `공개 웹 필수 self-host CSS·module resource가 로드되지 않았습니다: ${JSON.stringify(page.resourceEntries)}`
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
      && persistentState.databases.every(({ name }) => name === "chzzk-kirinuki-studio")
      && persistentState.serviceWorkers === 0
      && persistentState.controlled === false
      && persistentState.cacheKeys.length === 0,
    `공개 웹이 사용자 동작 전에 승인되지 않은 IndexedDB 또는 Service Worker·Cache Storage 상태를 만들었습니다: ${JSON.stringify(persistentState)}`
  );
  const cookies = await webdriver<unknown[]>("GET", `/session/${sessionId}/cookie`);
  assert(Array.isArray(cookies) && cookies.length === 0, "공개 웹 browser cookie jar가 비어 있지 않습니다.");

  const performanceLogs = await webdriver<WebDriverLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  const networkRequests = performanceRequests(performanceLogs);
  const networkUrls = networkRequests.map(({ url }) => url);
  const httpNetworkUrls = networkUrls.filter((url) => /^https?:/u.test(url));
  const publicOrigin = new URL(documentUrl).origin;
  const publicPageRequests = networkRequests.filter((request) => (
    request.documentUrl.startsWith(publicOrigin)
      || request.url.startsWith(publicOrigin)
  ));
  const unexpectedNetworkUrls = networkUrls.filter((url) => (
    !url.startsWith(`${publicOrigin}/`)
    && !url.startsWith("data:image/svg+xml,")
  ));
  const browserServedPaths = new Set([
    "/",
    ...expectedFiles
      .filter((file) => file !== "_headers" && file !== ".popovic-hosts")
      .map((file) => `/${file}`)
  ]);
  assert(networkUrls.includes(documentUrl), "브라우저 network log에 공개 웹 문서 요청이 없습니다.");
  assert(networkUrls.includes(stylesheetUrl), "브라우저 network log에 공개 웹 CSS 요청이 없습니다.");
  assert(networkUrls.includes(scriptUrl), "브라우저 network log에 공개 웹 module 요청이 없습니다.");
  assert(
    httpNetworkUrls.every((url) => new URL(url).origin === publicOrigin),
    `공개 웹이 self-host origin 밖으로 분석·추적·외부 asset 요청을 만들었습니다: ${JSON.stringify(httpNetworkUrls)}`
  );
  assert(
    unexpectedNetworkUrls.length === 0,
    `공개 웹이 HTTPS self-host asset·data favicon 외 network scheme을 사용했습니다: ${JSON.stringify(unexpectedNetworkUrls)}`
  );
  assert(
    publicPageRequests.every(({ url }) => (
      (
        new URL(url).origin === publicOrigin
        && browserServedPaths.has(new URL(url).pathname)
      )
      || url.startsWith("data:image/svg+xml,")
    )),
    `공개 웹 문서가 package allowlist 밖의 asset을 요청했습니다: ${JSON.stringify(publicPageRequests)}`
  );
  assert(
    networkUrls.every((url) => !/127\.0\.0\.1|localhost|:4319|:4320|\/v1\//iu.test(url)),
    "시작 화면이 사용자 동작 전에 loopback engine·legacy 편집기·내부 API를 요청했습니다."
  );
  for (const rawUrl of httpNetworkUrls) {
    const parsed = new URL(rawUrl);
    const isVersionedAsset = /\.(?:css|js)$/u.test(parsed.pathname);
    assert(
      isVersionedAsset
        ? parsed.search === `?v=${packageMetadata.version}`
        : parsed.search === "",
      `공개 웹 asset query가 고정 release version 계약과 다릅니다: ${rawUrl}`
    );
  }

  const requiredRequestPaths = [
    "/",
    `/studio.css?v=${packageMetadata.version}`,
    `/studio.js?v=${packageMetadata.version}`
  ].sort();
  const actualRequestPaths = proxyRecords.map(({ path: requestPath }) => requestPath).sort();
  assert(
    requiredRequestPaths.every((requestPath) => actualRequestPaths.includes(requestPath))
      && proxyRecords.length >= requiredRequestPaths.length,
    `공개 HTTPS endpoint가 전체 시작 화면의 필수 문서·CSS·module 요청을 받지 못했습니다: ${JSON.stringify(proxyRecords)}`
  );
  for (const record of proxyRecords) {
    const parsed = new URL(record.path, documentUrl);
    assert(
      record.host === PUBLIC_SHELL_CANONICAL_HOST
        && record.method === "GET"
        && record.requestCookie === ""
        && record.responseStatus === 200
        && record.responseHeaders
        && parsed.origin === publicOrigin
        && browserServedPaths.has(parsed.pathname),
      `공개 HTTPS 실제 요청의 Host·cookie·allowlist 계약이 다릅니다: ${JSON.stringify(record)}`
    );
    assertPublicSecurityHeaders(record.responseHeaders);
  }

  // Automation stands in for the one Chrome permission confirmation the user
  // accepts during onboarding. Chrome 142-145 uses the compatibility name;
  // newer split-permission builds use the loopback-specific name.
  const grantedLnaPermissions: string[] = [];
  const rejectedLnaPermissions: string[] = [];
  for (const permissionName of ["local-network-access", "loopback-network"] as const) {
    try {
      await webdriver(
        "POST",
        `/session/${sessionId}/goog/cdp/execute`,
        {
          cmd: "Browser.setPermission",
          params: {
            permission: { name: permissionName },
            setting: "granted",
            origin: publicOrigin
          }
        }
      );
      grantedLnaPermissions.push(permissionName);
    } catch (error) {
      rejectedLnaPermissions.push(`${permissionName}: ${errorMessage(error)}`);
    }
  }
  assert(
    grantedLnaPermissions.length >= 1,
    `Chrome가 legacy 또는 split LNA permission automation을 지원하지 않습니다: ${JSON.stringify(rejectedLnaPermissions)}`
  );

  const localEngineUrl = "http://127.0.0.1:4319/v1/health";
  const localEngineChallenge = freshLocalMediaEngineChallenge();
  const localEngineProbe = await executeAsync<{
    readonly isSecureContext?: boolean;
    readonly ok?: boolean;
    readonly permissionStates?: Readonly<Record<string, string>>;
    readonly response?: unknown;
    readonly status?: number;
    readonly type?: string;
    readonly url?: string;
    readonly error?: string;
  }>(`
    const done = arguments[arguments.length - 1];
    const permissionStates = {};
    Promise.all([
      "local-network-access",
      "loopback-network"
    ].map(async (name) => {
      try {
        permissionStates[name] = (await navigator.permissions.query({ name })).state;
      } catch (error) {
        permissionStates[name] = "unsupported:" + String(error);
      }
    })).then(async () => {
      try {
        const response = await fetch(${JSON.stringify(localEngineUrl)}, {
          cache: "no-store",
          credentials: "omit",
          method: "GET",
          headers: {
            "X-Kirinuki-Protocol": ${JSON.stringify(LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL)},
            ${JSON.stringify(LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER)}: ${JSON.stringify(localEngineChallenge)}
          },
          mode: "cors",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(10000)
        });
        done({
          isSecureContext,
          ok: response.ok,
          permissionStates,
          response: await response.json(),
          status: response.status,
          type: response.type,
          url: response.url
        });
      } catch (error) {
        done({ error: String(error), isSecureContext, permissionStates });
      }
    }, (error) => done({ error: String(error), isSecureContext, permissionStates }));
  `);
  const signedHealthResponse = isRecord(localEngineProbe.response)
    ? localEngineProbe.response
    : null;
  const signedHealthProof = parseLocalMediaEngineDeviceProof(
    signedHealthResponse?.deviceProof
  );
  const signedEngine = isRecord(signedHealthResponse?.engine)
    ? signedHealthResponse.engine
    : null;
  const signedVodRuntime = isRecord(signedHealthResponse?.vodRuntime)
    ? signedHealthResponse.vodRuntime
    : null;
  const signedYtDlp = isRecord(signedVodRuntime?.ytDlp)
    ? signedVodRuntime.ytDlp
    : null;
  const signedEjs = isRecord(signedVodRuntime?.ejs)
    ? signedVodRuntime.ejs
    : null;
  const signedSessionEncryption = isRecord(
    signedHealthResponse?.sessionEncryption
  )
    ? signedHealthResponse.sessionEncryption
    : null;
  const signedHealthPayload = signedHealthResponse
    ? {
      schema: signedHealthResponse.schema,
      status: signedHealthResponse.status,
      managed: signedHealthResponse.managed,
      engine: signedEngine && {
        backgroundStart: signedEngine.backgroundStart,
        product: signedEngine.product,
        protocol: signedEngine.protocol,
        version: signedEngine.version
      },
      originBinding: signedHealthResponse.originBinding,
      authentication: signedHealthResponse.authentication,
      transcriptionMode: signedHealthResponse.transcriptionMode,
      vodRuntime: signedVodRuntime && {
        schema: signedVodRuntime.schema,
        kind: signedVodRuntime.kind,
        ready: signedVodRuntime.ready,
        ytDlp: signedYtDlp && { version: signedYtDlp.version },
        ejs: signedEjs && { version: signedEjs.version },
        instanceNonce: signedVodRuntime.instanceNonce
      },
      sessionEncryption: signedSessionEncryption && {
        schema: signedSessionEncryption.schema,
        algorithm: signedSessionEncryption.algorithm,
        grantId: signedSessionEncryption.grantId,
        serverPublicKey: signedSessionEncryption.serverPublicKey,
        expiresAt: signedSessionEncryption.expiresAt
      }
    }
    : null;
  const standaloneHealthSignatureValid = Boolean(
    signedHealthProof
    && signedHealthPayload
    && localEngineProbeServer
    && signedHealthProof.keyId === localEngineProbeServer.keyId
    && signedHealthProof.challenge === localEngineChallenge
    && await verifyLocalMediaEngineSignature({
      publicKeySpki: localEngineProbeServer.publicKeySpki,
      signature: signedHealthProof.signature,
      transcript: localMediaEngineProofTranscript({
        kind: "health",
        challenge: localEngineChallenge,
        instanceNonce: signedHealthProof.instanceNonce,
        payload: signedHealthPayload
      })
    })
  );
  assert(
    localEngineProbe.error === undefined
      && localEngineProbe.isSecureContext === true
      && localEngineProbe.ok === true
      && localEngineProbe.status === 200
      && localEngineProbe.type === "cors"
      && localEngineProbe.url === localEngineUrl
      && isRecord(localEngineProbe.response)
      && localEngineProbe.response.schema === LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA
      && localEngineProbe.response.status === "ok"
      && isRecord(localEngineProbe.response.engine)
      && localEngineProbe.response.engine.backgroundStart === "ready"
      && localEngineProbe.response.engine.product === LOCAL_MEDIA_ENGINE_PRODUCT
      && localEngineProbe.response.engine.protocol === LOCAL_MEDIA_ENGINE_API_PROTOCOL
      && isRecord(localEngineProbe.response.vodRuntime)
      && localEngineProbe.response.vodRuntime.schema === LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA
      && localEngineProbe.response.vodRuntime.kind === "vod-only"
      && localEngineProbe.response.vodRuntime.ready === true
      && standaloneHealthSignatureValid,
    `공개 HTTPS→loopback engine LNA fetch가 성공하지 않았습니다: ${JSON.stringify(localEngineProbe)}`
  );
  assert(
    localEngineProbe.permissionStates
      && grantedLnaPermissions.some((name) => (
        localEngineProbe.permissionStates?.[name] === "granted"
      )),
    `Chrome permission state에서 LNA grant를 확인하지 못했습니다: ${JSON.stringify(localEngineProbe.permissionStates)}`
  );
  assert(
    localEngineProbeRecords.some(({ method }) => method === "GET")
      && localEngineProbeRecords.every((record) => (
        (record.method === "GET" || record.method === "OPTIONS")
        && record.origin === publicOrigin
        && record.path === "/v1/health"
        && record.cookie === ""
        && (
          record.method !== "GET"
          || record.protocol === LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL
        )
        && (
          record.method !== "OPTIONS"
          || record.requestedPrivateNetwork === ""
          || record.requestedPrivateNetwork === "true"
        )
      )),
    `loopback engine probe의 Origin·cookie·PNA 요청 계약이 다릅니다: ${JSON.stringify(localEngineProbeRecords)}`
  );
  const lnaPerformanceLogs = await webdriver<WebDriverLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  const lnaNetworkUrls = performanceRequests(lnaPerformanceLogs)
    .map(({ url }) => url)
    .filter((url) => /^https?:/u.test(url));
  assert(
    lnaNetworkUrls.length >= 1
      && lnaNetworkUrls.every((url) => url === localEngineUrl),
    `permission grant 뒤 브라우저가 정확한 loopback health 외 요청을 만들었습니다: ${JSON.stringify(lnaNetworkUrls)}`
  );
  assert(localEngineProbeServer, "공개 HTTPS v2 engine fixture가 시작되지 않았습니다.");
  await enrollPublicLocalMediaEngineFixture(localEngineProbeServer);
  // Reload after the explicit, signed enrollment so the ordinary website
  // continues through the exact first-use state a returning browser sees.
  await webdriver("POST", `/session/${sessionId}/refresh`, {});
  await waitForDocument();

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
    `공개 웹 browser console에 오류가 있습니다: ${JSON.stringify(unexpectedBrowserErrors)}`
  );

  // The optional top download offer must keep communicating with the same
  // page after the external GitHub download is requested. Cancel navigation
  // only inside this smoke; the product click listener must still run and
  // confirm the already enrolled helper without changing the visible layout.
  await execute(`
    const helper = document.querySelector("#linux-helper-download");
    if (!(helper instanceof HTMLAnchorElement)
      || helper.hidden
      || !helper.href.includes("/releases/download/")) {
      throw new Error("상단 영상 준비 도우미 다운로드 링크가 없습니다.");
    }
    helper.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
      once: true
    });
    helper.click();
    return true;
  `);
  await waitFor(
    () => execute<{
      readonly busy: string;
      readonly label: string;
    }>(`
      const helper = document.querySelector("#linux-helper-download");
      return {
        busy: helper?.getAttribute("aria-busy") || "",
        label: helper?.textContent?.trim() || ""
      };
    `),
    (value) => (
      value.busy === ""
        && value.label === "영상 준비 도우미 연결됨"
    ),
    "상단 도우미 다운로드 후 같은 화면이 연결 상태를 확인하지 못했습니다."
  );

  // Continue from the untouched public start page through the product's real
  // UI. This proves that the website does not merely advertise an installer:
  // it must recognize the exact compatible engine, mint a document-scoped
  // capability, prepare the selected range, and attach playable loopback
  // media without exposing a port/endpoint workflow to the user.
  await webdriver(
    "POST",
    `/session/${sessionId}/goog/cdp/execute`,
    {
      cmd: "Network.enable",
      params: {}
    }
  );
  await webdriver(
    "POST",
    `/session/${sessionId}/goog/cdp/execute`,
    {
      cmd: "Network.setBlockedURLs",
      params: {
        urls: [
          "https://chzzk.naver.com/*",
          "https://www.youtube.com/*",
          "https://vod.sooplive.com/*"
        ]
      }
    }
  );
  await execute(`
    const source = document.querySelector("#source-url");
    const projectName = document.querySelector("#project-name");
    const row = document.querySelector(".clip-row");
    const start = row?.querySelector('[data-field="start"]');
    const end = row?.querySelector('[data-field="end"]');
    if (!(source instanceof HTMLInputElement)
      || !(projectName instanceof HTMLInputElement)
      || !(start instanceof HTMLInputElement)
      || !(end instanceof HTMLInputElement)) {
      throw new Error("공개 시작 화면의 semantic 입력 요소가 없습니다.");
    }
    source.value = "https://chzzk.naver.com/video/14252987";
    projectName.value = "공개 HTTPS semantic 자동 연결 smoke";
    start.value = "00:00:10.000";
    end.value = "00:00:11.000";
    for (const input of [source, projectName, start, end]) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const checkbox of document.querySelectorAll("[data-ack]")) {
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("공개 시작 화면의 확인 항목 형식이 올바르지 않습니다.");
      }
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  `);
  await waitFor(
    () => execute<{
      readonly disabled: boolean;
      readonly label: string;
      readonly sourcePlatform: string;
    }>(`
      const button = document.querySelector("#start-editor");
      return {
        disabled: !(button instanceof HTMLButtonElement) || button.disabled,
        label: button?.textContent?.trim() || "",
        sourcePlatform: document.querySelector("#source-platform")?.textContent?.trim() || ""
      };
    `),
    (value) => (
      !value.disabled
        && value.label === "편집기 열기"
        && value.sourcePlatform === "치지직 VOD"
    ),
    "공개 시작 화면이 생각 없이 누를 수 있는 편집기 열기 상태가 되지 않았습니다."
  );

  // CHZZK has no trustworthy cross-origin player clock. Press W through the
  // real capture console so the optional helper prepares a local preview,
  // then prove the PR16 keyboard controls become enabled and own the fields.
  await execute(`
    const prepare = document.querySelector("#refresh-source");
    if (!(prepare instanceof HTMLButtonElement) || prepare.disabled) {
      throw new Error("CHZZK W 도우미 미리보기를 시작할 수 없습니다.");
    }
    prepare.click();
    return true;
  `);
  const helperShortcutConsole = await waitFor(
    () => execute<{
      readonly disabled: readonly string[];
      readonly readyState: number;
      readonly status: string;
    }>(`
      const ids = [
        "capture-start",
        "capture-end",
        "seek-backward-five",
        "seek-forward-five",
        "playback-rate-quarter",
        "playback-rate-double"
      ];
      const video = document.querySelector("#stream-preview-video");
      return {
        disabled: ids.filter((id) => {
          const button = document.getElementById(id);
          return !(button instanceof HTMLButtonElement) || button.disabled;
        }),
        readyState: video instanceof HTMLVideoElement ? video.readyState : 0,
        status: document.querySelector("#stream-cut-console-status")?.textContent?.trim() || ""
      };
    `),
    (value) => (
      value.disabled.length === 0
        && value.readyState >= 1
        && value.status.includes("E/R/D/F/Y/U")
    ),
    () => "CHZZK 도우미 연결 후 E/R/D/F/Y/U 콘솔이 활성화되지 않았습니다. "
      + `fixture=${JSON.stringify(semanticFixtureState)} requests=${JSON.stringify(localEngineProbeRecords)}`,
    30_000
  );
  assert(
    helperShortcutConsole.disabled.length === 0,
    "CHZZK 도우미 컷 제어 버튼이 모두 활성화되지 않았습니다."
  );
  const shortcutJourney = await execute<{
    readonly doublePressed: string;
    readonly end: string;
    readonly quarterPressed: string;
    readonly start: string;
  }>(`
    const row = document.querySelector(".clip-row");
    const start = row?.querySelector('[data-field="start"]');
    const end = row?.querySelector('[data-field="end"]');
    const video = document.querySelector("#stream-preview-video");
    if (!(start instanceof HTMLInputElement)
      || !(end instanceof HTMLInputElement)
      || !(video instanceof HTMLVideoElement)) {
      throw new Error("컷 단축키 실사용 요소가 없습니다.");
    }
    const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      code: "Key" + key.toUpperCase(),
      key
    }));
    video.currentTime = 0.25;
    press("e");
    video.currentTime = 0.75;
    press("r");
    press("y");
    const quarterPressed = document.querySelector("#playback-rate-quarter")?.getAttribute("aria-pressed") || "";
    press("u");
    const doublePressed = document.querySelector("#playback-rate-double")?.getAttribute("aria-pressed") || "";
    press("d");
    press("f");
    const result = {
      doublePressed,
      end: end.value,
      quarterPressed,
      start: start.value
    };
    // Continue the deterministic final prepare with the original exact range.
    start.value = "00:00:10.000";
    end.value = "00:00:11.000";
    for (const input of [start, end]) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return result;
  `);
  assert(
    shortcutJourney.start === "00:00:00.250"
      && shortcutJourney.end === "00:00:00.750"
      && shortcutJourney.quarterPressed === "true"
      && shortcutJourney.doublePressed === "true",
    `CHZZK 도우미 E/R/D/F/Y/U 단축키가 원본 시각·재생 제어를 반영하지 못했습니다: ${JSON.stringify(shortcutJourney)}`
  );
  await execute(`
    const button = document.querySelector("#start-editor");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("공개 편집기 열기 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `);
  const semanticEditor = await waitFor(
    () => execute<{
      readonly dialogOpen: boolean;
      readonly duration: number;
      readonly formStatus: string;
      readonly href: string;
      readonly jobHidden: boolean;
      readonly mediaName: string;
      readonly previewReadyState: number;
      readonly previewUrl: string;
      readonly shellHidden: boolean;
      readonly toast: string;
    }>(`
      const preview = document.querySelector("#preview-video");
      const dialog = document.querySelector("#local-media-engine-dialog");
      const job = document.querySelector("#job-dialog");
      return {
        dialogOpen: dialog instanceof HTMLDialogElement && dialog.open,
        duration: preview instanceof HTMLVideoElement ? preview.duration : NaN,
        formStatus: document.querySelector("#form-status")?.textContent?.trim() || "",
        href: location.href,
        jobHidden: job instanceof HTMLDialogElement && job.hidden && !job.open,
        mediaName: document.querySelector("#media-name")?.textContent?.trim() || "",
        previewReadyState: preview instanceof HTMLVideoElement ? preview.readyState : 0,
        previewUrl: preview instanceof HTMLVideoElement ? preview.currentSrc : "",
        shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden),
        toast: document.querySelector("#toast")?.textContent?.trim() || ""
      };
    `),
    (value) => (
      value.href.startsWith(`https://${PUBLIC_SHELL_CANONICAL_HOST}/editor.html?project=`)
        && !value.shellHidden
        && !value.dialogOpen
        && value.jobHidden
        && value.mediaName === "치지직 편집 영상 준비됨"
        && value.previewReadyState >= 1
        && value.previewUrl.startsWith(
          "http://127.0.0.1:4319/v1/vod/media/semantic_browser_job_0001?access="
        )
        && Math.abs(value.duration - 21) < 0.1
        && value.toast.includes("필요한 편집 범위를 이 기기의 로컬 영상에 준비했습니다")
    ),
    () => "공개 HTTPS 웹 편집기가 exact engine을 자동 감지해 선택 구간 영상을 연결하지 못했습니다. "
      + `fixture=${JSON.stringify(semanticFixtureState)} requests=${JSON.stringify(localEngineProbeRecords)}`,
    30_000
  ).catch(async (error) => {
    const debugLogs = await webdriver<WebDriverLogEntry[]>(
      "POST",
      `/session/${sessionId}/log`,
      { type: "browser" }
    ).catch(() => []);
    throw new Error(
      `${errorMessage(error)} browserLogs=${JSON.stringify(debugLogs)}`,
      { cause: error }
    );
  });
  assert(
    // W owns one preview session with bootstrap+window requests. The start page
    // then prepares the exact selected range, and the editor reacquires that
    // cache under a third document-scoped session. Repeated control requests
    // must not imply repeated remote downloads in the real helper.
    semanticFixtureState.sessionRequests === 3
      && semanticFixtureState.materializationRequests === 4
      && semanticFixtureState.mediaRequests >= 3,
    `공개 웹 semantic chain의 session·prepare·media 호출 수가 다릅니다: ${JSON.stringify(semanticFixtureState)}`
  );
  assert(
    localEngineProbeRecords.every((record) => (
      record.origin === publicOrigin
        && record.cookie === ""
        && new URL(record.path, localEngineUrl).pathname.startsWith("/v1/")
    )),
    `공개 웹 semantic chain에 잘못된 Origin·cookie·경로 요청이 있습니다: ${JSON.stringify(localEngineProbeRecords)}`
  );

  // Exercise the same visible controls a user follows after the selected
  // range reaches the editor. ChromeDriver cannot approve a native directory
  // chooser, so the smoke supplies an in-memory File System Access directory
  // handle. Rendering, MP4 verification, recovery JSON, SRT creation, and the
  // post-export confirmation all continue through the production code path.
  await execute(`
    const files = new Map();
    class MemoryFileHandle {
      constructor(name) {
        this.kind = "file";
        this.name = name;
        this.bytes = new Uint8Array();
        this.lastModified = Date.now();
      }
      async getFile() {
        return new File([this.bytes], this.name, {
          lastModified: this.lastModified,
          type: this.name.endsWith(".json")
            ? "application/json"
            : this.name.endsWith(".srt")
              ? "application/x-subrip"
              : this.name.endsWith(".webm")
                ? "video/webm"
                : "video/mp4"
        });
      }
      async createWritable() {
        const handle = this;
        let working = handle.bytes.slice();
        let position = 0;
        let settled = false;
        const bytesOf = async (value) => {
          if (value instanceof Blob) {
            return new Uint8Array(await value.arrayBuffer());
          }
          if (value instanceof ArrayBuffer) {
            return new Uint8Array(value);
          }
          if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          }
          throw new TypeError("memory export stream received an unsupported chunk");
        };
        const writeBytes = (chunk, offset) => {
          const end = offset + chunk.byteLength;
          if (end > working.byteLength) {
            const grown = new Uint8Array(end);
            grown.set(working);
            working = grown;
          }
          working.set(chunk, offset);
          position = end;
        };
        return {
          async write(value) {
            if (settled) throw new TypeError("memory export stream is closed");
            if (value && typeof value === "object" && typeof value.type === "string") {
              if (value.type === "seek") {
                position = Number(value.position);
                return;
              }
              if (value.type === "truncate") {
                const size = Number(value.size);
                const resized = new Uint8Array(size);
                resized.set(working.subarray(0, Math.min(size, working.byteLength)));
                working = resized;
                position = Math.min(position, size);
                return;
              }
              if (value.type === "write") {
                const offset = value.position === undefined
                  ? position
                  : Number(value.position);
                writeBytes(await bytesOf(value.data), offset);
                return;
              }
            }
            writeBytes(await bytesOf(value), position);
          },
          async seek(nextPosition) {
            position = Number(nextPosition);
          },
          async truncate(size) {
            const resized = new Uint8Array(Number(size));
            resized.set(working.subarray(0, Math.min(resized.byteLength, working.byteLength)));
            working = resized;
            position = Math.min(position, resized.byteLength);
          },
          async close() {
            if (settled) return;
            settled = true;
            handle.bytes = working.slice();
            handle.lastModified = Date.now();
          },
          async abort() {
            settled = true;
          }
        };
      }
    }
    const directory = {
      kind: "directory",
      name: "Kirinuki semantic export smoke",
      files,
      async getFileHandle(name, options = {}) {
        const current = files.get(name);
        if (current) return current;
        if (!options.create) {
          throw new DOMException("not found", "NotFoundError");
        }
        const created = new MemoryFileHandle(name);
        files.set(name, created);
        return created;
      },
      async removeEntry(name) {
        if (!files.delete(name)) {
          throw new DOMException("not found", "NotFoundError");
        }
      }
    };
    window.__kirinukiSemanticExportDirectory = directory;
    window.showDirectoryPicker = async () => directory;

    const addCue = document.querySelector("#add-cue");
    if (!(addCue instanceof HTMLButtonElement) || addCue.disabled) {
      throw new Error("실사용 자막 추가 버튼을 누를 수 없습니다.");
    }
    addCue.click();
    const cueText = document.querySelector("#cue-text");
    if (!(cueText instanceof HTMLTextAreaElement)) {
      throw new Error("실사용 자막 입력을 찾지 못했습니다.");
    }
    cueText.value = "Kirinuki 실사용 검증 자막";
    cueText.dispatchEvent(new Event("input", { bubbles: true }));
    cueText.blur();

    const exportButton = document.querySelector("#export-video");
    if (!(exportButton instanceof HTMLButtonElement) || exportButton.disabled) {
      throw new Error("실사용 내보내기 버튼을 누를 수 없습니다.");
    }
    exportButton.click();
    const title = document.querySelector("#export-file-title");
    const confirm = document.querySelector("#confirm-export-options");
    if (!(title instanceof HTMLInputElement)
      || !(confirm instanceof HTMLButtonElement)) {
      throw new Error("실사용 내보내기 확인 UI가 없습니다.");
    }
    title.value = "Kirinuki 실사용 검증";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    if (confirm.disabled) {
      throw new Error("실사용 내보내기 확인이 비활성화됐습니다.");
    }
    confirm.click();
    return true;
  `);
  const semanticExport = await waitFor(
    () => execute<{
      readonly cleanupOpen: boolean;
      readonly files: readonly {
        readonly name: string;
        readonly size: number;
        readonly text: string;
      }[];
      readonly jobHidden: boolean;
      readonly summary: string;
      readonly toast: string;
    }>(`
      const directory = window.__kirinukiSemanticExportDirectory;
      const entries = directory
        ? await Promise.all([...directory.files.entries()].map(async ([name, handle]) => {
          const file = await handle.getFile();
          return {
            name,
            size: file.size,
            text: name.endsWith(".srt") ? await file.text() : ""
          };
        }))
        : [];
      const cleanup = document.querySelector("#cleanup-after-export-dialog");
      const job = document.querySelector("#job-dialog");
      return {
        cleanupOpen: cleanup instanceof HTMLDialogElement && cleanup.open,
        files: entries,
        jobHidden: job instanceof HTMLDialogElement && job.hidden && !job.open,
        summary: document.querySelector("#cleanup-after-export-summary")?.textContent?.trim() || "",
        toast: document.querySelector("#toast")?.textContent?.trim() || ""
      };
    `),
    (value) => (
      value.cleanupOpen
        && value.jobHidden
        && value.files.length === 3
        && value.files.some(({ name, size }) => (
          /[.](?:mp4|webm)$/u.test(name) && size > 0
        ))
        && value.files.some(({ name, size }) => (
          name.endsWith(".kirinuki-session.json") && size > 0
        ))
        && value.files.some(({ name, size, text }) => (
          name.endsWith(".ko.srt")
            && size > 0
            && text.includes("Kirinuki 실사용 검증 자막")
        ))
        && value.summary.includes("영상")
    ),
    () => "공개 HTTPS 실사용 컷·자막·내보내기 경로가 완료되지 않았습니다.",
    120_000
  );
  await execute(`
    const keep = document.querySelector("#keep-export-session-cache");
    if (!(keep instanceof HTMLButtonElement)) {
      throw new Error("내보내기 후 현재 작업 유지 버튼이 없습니다.");
    }
    keep.click();
    return true;
  `);

  await execute(`
    const button = document.querySelector("#open-short-form");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("쇼츠 작업공간을 열 수 없습니다.");
    }
    button.click();
    return true;
  `);
  const shortBookmark = await waitFor(
    () => execute<{
      readonly href: string;
      readonly shortWorkspaceId: string;
      readonly workspace: string;
    }>(`
      const url = new URL(location.href);
      return {
        href: url.href,
        shortWorkspaceId: url.searchParams.get("short") || "",
        workspace: document.querySelector("#editor-shell")?.getAttribute("data-workspace") || ""
      };
    `),
    (value) => (
      value.workspace === "short-form"
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.shortWorkspaceId)
        && new URL(value.href).searchParams.get("workspace") === "short-form"
    ),
    "공개 편집기가 새로고침 가능한 쇼츠 작업공간 URL을 만들지 못했습니다."
  );
  await webdriver("POST", `/session/${sessionId}/refresh`, {});
  await waitForDocument();
  await waitFor(
    () => execute<{
      readonly editorPresent: boolean;
      readonly href: string;
    }>(`
      return {
        editorPresent: document.querySelector("#editor-shell") instanceof HTMLElement,
        href: location.href
      };
    `),
    (value) => value.editorPresent && value.href === shortBookmark.href,
    "쇼츠 작업공간 URL을 공개 HTTPS에서 새로고침하지 못했습니다."
  );
  assert(
    proxyRecords.some((record) => (
      record.path === new URL(shortBookmark.href).pathname
        + new URL(shortBookmark.href).search
        && record.responseStatus === 200
    )),
    `쇼츠 작업공간 공개 reload가 HTTP 200으로 제공되지 않았습니다: ${shortBookmark.href}`
  );

  process.stdout.write(`${JSON.stringify({
    archive: path.relative(root, archivePath),
    browserOrigin: new URL(documentUrl).origin,
    files: expectedFiles.length,
    requests: actualRequestPaths,
    localNetworkAccess: {
      grantedPermissions: grantedLnaPermissions,
      probeMethods: localEngineProbeRecords.map(({ method }) => method),
      status: "granted-and-loopback-probed",
      semanticEditor: {
        fixture: semanticFixtureState,
        mediaDurationSeconds: semanticEditor.duration,
        result: "health-session-prepare-materialize-media-attached",
        exportFiles: semanticExport.files.map(({ name, size }) => ({
          name,
          size
        })),
        exportResult: "cut-subtitle-render-video-session-srt-verified",
        shortWorkspaceReload: "http-200"
      }
    },
    securityHeaders: Object.keys(PUBLIC_SHELL_SECURITY_HEADERS).length,
    sha256: digest,
    storage: "browser-local-only",
    telemetry: "none-observed"
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
  process.stderr.write(`공개 웹 browser smoke 실패: ${errorMessage(error)}\n`);
  if (chromedriverOutput.trim()) {
    process.stderr.write(`ChromeDriver 최근 출력:\n${chromedriverOutput.trim()}\n`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
