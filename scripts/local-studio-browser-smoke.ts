#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  spawn,
  type ChildProcess
} from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  applyMediaAlignmentOffset,
  createEditorProjectFromCapture
} from "../src/lib/editor-core.js";
import type { EditorProject } from "../src/lib/editor-core.js";
import {
  addShortFormVideoAsset,
  saveActiveShortFormWorkspace
} from "../src/lib/short-form.js";
import {
  buildSessionArchive,
  stringifySessionArchive
} from "../src/lib/session-archive.js";
import {
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  freshLocalMediaEngineChallenge,
  localMediaEnginePairingUrl,
  localMediaEngineProofTranscript,
  pairingResponseUnsignedPayload,
  parseLocalMediaEnginePairingRequest,
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
import { buildWebJavaScript } from "./web-javascript-build.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const studioOrigin = "http://127.0.0.1:4320";
const gatewayPattern = "http://127.0.0.1:4319/*";
const externalEmbedPatterns = Object.freeze([
  "https://chzzk.naver.com/*",
  "https://www.youtube.com/*",
  "https://www.youtube-nocookie.com/*",
  "https://vod.sooplive.com/*"
]);
const liveEmbedSmoke = process.env.KIRINUKI_LIVE_EMBED_SMOKE === "1";
const mobileAccessSmokeOnly = (
  process.env.KIRINUKI_MOBILE_ACCESS_SMOKE_ONLY === "1"
);
const tempRoot = await mkdtemp(
  path.join(os.tmpdir(), "kirinuki-local-studio-smoke-")
);
const profileRoot = path.join(tempRoot, "chromium-profile");

interface BrowserSession {
  sessionId?: unknown;
  capabilities?: {
    "goog:chromeOptions"?: {
      debuggerAddress?: unknown;
    };
  };
}

interface DevToolsTarget {
  type?: unknown;
  url?: unknown;
  title?: unknown;
  webSocketDebuggerUrl?: unknown;
}

interface BrowserLogEntry {
  level?: unknown;
  source?: unknown;
  message?: unknown;
}

interface DevToolsEnvelope {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

type DevToolsEventListener = (params: Record<string, unknown>) => void;

class DevToolsConnection {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  readonly #listeners = new Map<string, Set<DevToolsEventListener>>();
  #nextId = 0;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      let envelope: DevToolsEnvelope;
      try {
        envelope = JSON.parse(String(event.data)) as DevToolsEnvelope;
      } catch {
        return;
      }
      if (typeof envelope.id === "number") {
        const pending = this.#pending.get(envelope.id);
        if (!pending) {
          return;
        }
        this.#pending.delete(envelope.id);
        if (envelope.error) {
          pending.reject(new Error(
            `CDP command 실패: ${JSON.stringify(envelope.error)}`
          ));
        } else {
          pending.resolve(envelope.result);
        }
        return;
      }
      if (typeof envelope.method !== "string" || !isRecord(envelope.params)) {
        return;
      }
      for (const listener of this.#listeners.get(envelope.method) || []) {
        listener(envelope.params);
      }
    });
    socket.addEventListener("close", () => {
      const error = new Error("CDP WebSocket 연결이 닫혔습니다.");
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
    });
  }

  static async open(socketUrl: string): Promise<DevToolsConnection> {
    if (!socketUrl.startsWith("ws://127.0.0.1:")
      && !socketUrl.startsWith("ws://localhost:")) {
      throw new Error("CDP target WebSocket이 정확한 loopback 주소가 아닙니다.");
    }
    const socket = new WebSocket(socketUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("CDP target WebSocket 연결 시간이 초과되었습니다."));
      }, 5_000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP target WebSocket 연결 실패"));
      }, { once: true });
    });
    return new DevToolsConnection(socket);
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const id = ++this.#nextId;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: DevToolsEventListener): () => void {
    const bucket = this.#listeners.get(method) || new Set<DevToolsEventListener>();
    bucket.add(listener);
    this.#listeners.set(method, bucket);
    return () => bucket.delete(listener);
  }

  close(): void {
    this.#socket.close();
  }
}

type ManagedChild = ChildProcess & {
  stdout: Readable;
  stderr: Readable;
};

let driver: ManagedChild | null = null;
let studio: ManagedChild | null = null;
let driverPort = 0;
let sessionId = "";
let driverOutput = "";
let studioOutput = "";
let localMediaEngineFixture: Readonly<LocalMediaEngineV2Fixture> | null = null;
let cleanupPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function buildSmokeSessionArchive(
  canonicalUrl: string
): Promise<string> {
  const source = {
    platform: "CHZZK" as const,
    contentType: "vod" as const,
    contentId: "14514980",
    canonicalUrl,
    url: canonicalUrl,
    broadcastTitle: "복원 JSON 브라우저 스모크"
  };
  const segments = Array.from({ length: 12 }, (_, index) => ({
    id: `smoke-selection-${index + 1}`,
    startSeconds: index === 0 ? 80.5 : 120 + ((index - 1) * 30),
    endSeconds: index === 0 ? 95 : 132 + ((index - 1) * 30),
    description: index === 0 ? "대표 구간" : `스크롤 검증 구간 ${index + 1}`
  }));
  const project = createEditorProjectFromCapture({
    source,
    projectName: "복원된 localhost-browser-smoke",
    segments
  }, {
    id: "archive-localhost-browser-smoke",
    createdAt: "2026-08-13T00:00:00.000Z"
  });
  const archive = await buildSessionArchive({
    rootProject: project,
    exportKind: "main",
    exportSnapshot: { projectId: project.id },
    mediaRecovery: {
      schema: "kirinuki-media-recovery/v1",
      mode: "redownload-vod",
      source: {
        platform: "CHZZK",
        contentType: "vod",
        contentId: "14514980",
        canonicalUrl
      },
      localMedia: null,
      materialization: null,
      vodBytesIncluded: false
    },
    resolveImageAssetBlob: async () => null,
    createdAt: "2026-08-13T00:00:00.000Z"
  });
  return stringifySessionArchive(archive);
}

function appendOutput(
  current: string,
  chunk: Buffer | string
): string {
  const next = current + chunk.toString();
  return next.length > 80_000 ? next.slice(-80_000) : next;
}

function staleMaterializedTimingProject(canonicalUrl: string): EditorProject {
  const project = createEditorProjectFromCapture({
    projectName: "localhost-browser-smoke",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14514980",
      canonicalUrl,
      url: canonicalUrl,
      broadcastTitle: "localhost-browser-smoke"
    },
    segments: [{
      id: "stale-offset-browser-regression",
      startSeconds: 80.5,
      endSeconds: 95,
      description: ""
    }]
  });
  const [clip] = project.clips;
  if (!clip) {
    throw new Error("stale timing browser fixture의 clip이 없습니다.");
  }
  const materialized: EditorProject = {
    ...project,
    mediaAsset: {
      durationMs: 34_500,
      mediaOriginMs: 0,
      mediaEndTimestampMs: 34_500,
      hasVideo: true,
      hasAudio: true,
      mediaMode: "source-vod-selection",
      materialization: {
        schema: "chzzk-kirinuki-chzzk-vod-materialization/v2",
        materializationId: "5".repeat(32),
        planFingerprint: "5".repeat(64),
        source: {
          platform: "CHZZK",
          contentType: "vod",
          contentId: "14514980",
          sourceVersionId: "6".repeat(64)
        },
        sourceDurationMs: 600_000,
        handleMs: 10_000,
        mediaDurationMs: 34_500,
        windows: [{
          id: "stale-offset-browser-window",
          editableSourceStartMs: 70_500,
          editableSourceEndMs: 105_000,
          fetchedSourceStartMs: 70_500,
          fetchedSourceEndMs: 105_000,
          mediaStartMs: 0,
          mediaEndMs: 34_500,
          clipIds: [clip.id]
        }],
        clipRanges: [{
          clipId: clip.id,
          sourceStartMs: 80_500,
          sourceEndMs: 95_000,
          editableSourceStartMs: 70_500,
          editableSourceEndMs: 105_000
        }],
        preparedAt: "2026-08-14T00:00:00.000Z",
        localOnly: true
      },
      rightsConfirmation: {
        scope: "owned-or-authorized-public-vod",
        contentId: "14514980",
        confirmedAt: "2026-08-14T00:00:00.000Z"
      }
    }
  };
  return applyMediaAlignmentOffset(materialized, 10_000);
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
  const directories = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
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

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address
    ? address.port
    : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  assert(Number.isInteger(port) && port >= 1_024, "ChromeDriver 포트를 받지 못했습니다.");
  return port;
}

async function fetchJson(
  url: string,
  {
    method = "GET",
    body,
    timeoutMs = 30_000
  }: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const init: RequestInit = {
    method,
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
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

async function managedStudioReady(): Promise<boolean> {
  try {
    const payload = await fetchJson(`${studioOrigin}/v1/studio/health`, {
      timeoutMs: 1_500
    });
    return Boolean(
      isRecord(payload)
      && payload.schema === "kirinuki-local-studio-server/health-v1"
      && payload.status === "ok"
      && payload.managed === true
      && isRecord(payload.server)
      && payload.server.host === "127.0.0.1"
      && payload.server.port === 4320
    );
  } catch {
    return false;
  }
}

async function ensureStudioServer(): Promise<"reused" | "started"> {
  if (await managedStudioReady()) {
    return "reused";
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_STATE_HOME: path.join(tempRoot, "state"),
    XDG_RUNTIME_DIR: path.join(tempRoot, "run")
  };
  studio = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(root, "scripts", "local-studio-server.ts"),
      "start",
      "--foreground"
    ],
    {
      cwd: root,
      env: environment,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  ) as ManagedChild;
  studio.stdout.on("data", (chunk: Buffer | string) => {
    studioOutput = appendOutput(studioOutput, chunk);
  });
  studio.stderr.on("data", (chunk: Buffer | string) => {
    studioOutput = appendOutput(studioOutput, chunk);
  });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (studio.exitCode !== null) {
      throw new Error(
        `localhost studio가 준비 전에 종료했습니다.\n${studioOutput.trim()}`
      );
    }
    if (await managedStudioReady()) {
      return "started";
    }
    await delay(100);
  }
  throw new Error(
    `localhost studio가 15초 안에 준비되지 않았습니다.\n${studioOutput.trim()}`
  );
}

async function webdriver<T = unknown>(
  method: string,
  commandPath: string,
  body?: unknown,
  timeoutMs = 30_000
): Promise<T> {
  const payload = await fetchJson(
    `http://127.0.0.1:${driverPort}${commandPath}`,
    { method, body, timeoutMs }
  );
  assert(isRecord(payload), `WebDriver 응답 형식이 올바르지 않습니다: ${commandPath}`);
  const value = payload.value;
  if (isRecord(value) && value.error) {
    throw new Error(
      `${String(value.error)}: ${String(value.message || "WebDriver 명령 실패")}`
    );
  }
  return value as T;
}

async function waitForDriver(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driver?.exitCode !== null) {
      throw new Error(
        `ChromeDriver가 준비 전에 종료했습니다.\n${driverOutput.trim()}`
      );
    }
    try {
      const value = await webdriver<Record<string, unknown>>(
        "GET",
        "/status",
        undefined,
        1_000
      );
      if (value.ready === true) {
        return;
      }
    } catch {
      // ChromeDriver가 loopback 포트에 바인딩할 때까지 재시도한다.
    }
    await delay(100);
  }
  throw new Error(
    `ChromeDriver가 10초 안에 준비되지 않았습니다.\n${driverOutput.trim()}`
  );
}

async function execute<T>(script: string, args: readonly unknown[] = []): Promise<T> {
  return webdriver<T>(
    "POST",
    `/session/${sessionId}/execute/sync`,
    { script, args }
  );
}

async function storeBrowserProject(project: EditorProject): Promise<void> {
  await execute(`
    globalThis.__kirinukiSmokeProjectWrite = null;
    const open = indexedDB.open("chzzk-kirinuki-studio");
    open.onerror = () => {
      globalThis.__kirinukiSmokeProjectWrite = {
        ready: false,
        error: String(open.error || "open failed")
      };
    };
    open.onsuccess = () => {
      const database = open.result;
      let transaction;
      try {
        transaction = database.transaction("projects", "readwrite");
      } catch (error) {
        globalThis.__kirinukiSmokeProjectWrite = {
          ready: false,
          error: String(error)
        };
        database.close();
        return;
      }
      transaction.onerror = () => {
        globalThis.__kirinukiSmokeProjectWrite = {
          ready: false,
          error: String(transaction.error || "transaction failed")
        };
      };
      transaction.onabort = () => {
        globalThis.__kirinukiSmokeProjectWrite = {
          ready: false,
          error: String(transaction.error || "transaction aborted")
        };
      };
      transaction.oncomplete = () => {
        database.close();
        globalThis.__kirinukiSmokeProjectWrite = { ready: true, error: "" };
      };
      transaction.objectStore("projects").put(arguments[0]);
    };
    return true;
  `, [project]);
  const result = await waitFor(
    () => execute<{ ready: boolean; error: string } | null>(`
      return globalThis.__kirinukiSmokeProjectWrite || null;
    `),
    (value) => Boolean(value?.ready || value?.error),
    `브라우저 프로젝트 fixture를 저장하지 못했습니다: ${project.id}`
  );
  assert(
    result?.ready && !result.error,
    `브라우저 프로젝트 fixture 저장 실패: ${result?.error || project.id}`
  );
}

async function readBrowserProject(projectId: string): Promise<EditorProject | null> {
  await execute(`
    globalThis.__kirinukiSmokeProjectRead = null;
    const open = indexedDB.open("chzzk-kirinuki-studio");
    open.onerror = () => {
      globalThis.__kirinukiSmokeProjectRead = {
        ready: false,
        error: String(open.error || "open failed"),
        project: null
      };
    };
    open.onsuccess = () => {
      const database = open.result;
      let transaction;
      try {
        transaction = database.transaction("projects", "readonly");
      } catch (error) {
        globalThis.__kirinukiSmokeProjectRead = {
          ready: false,
          error: String(error),
          project: null
        };
        database.close();
        return;
      }
      const request = transaction.objectStore("projects").get(arguments[0]);
      request.onerror = () => {
        globalThis.__kirinukiSmokeProjectRead = {
          ready: false,
          error: String(request.error || "project read failed"),
          project: null
        };
      };
      transaction.oncomplete = () => {
        globalThis.__kirinukiSmokeProjectRead = {
          ready: true,
          error: "",
          project: request.result || null
        };
        database.close();
      };
    };
    return true;
  `, [projectId]);
  const result = await waitFor(
    () => execute<{
      ready: boolean;
      error: string;
      project: EditorProject | null;
    } | null>(`
      return globalThis.__kirinukiSmokeProjectRead || null;
    `),
    (value) => Boolean(value?.ready || value?.error),
    `브라우저 프로젝트 fixture를 읽지 못했습니다: ${projectId}`
  );
  assert(
    result?.ready && !result.error,
    `브라우저 프로젝트 fixture 읽기 실패: ${result?.error || projectId}`
  );
  return result.project;
}

async function cdp<T>(cmd: string, params: Record<string, unknown>): Promise<T> {
  return webdriver<T>(
    "POST",
    `/session/${sessionId}/goog/cdp/execute`,
    { cmd, params }
  );
}

async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  message: string,
  timeoutMs = 15_000
): Promise<T> {
  const startedAt = Date.now();
  let latest: T | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      latest = await probe();
      if (predicate(latest)) {
        return latest;
      }
    } catch {
      // Navigation 중 일시적으로 사라진 execution context는 재시도한다.
    }
    await delay(100);
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`);
}

function exactLoopbackDebuggerAddress(value: unknown): string {
  const address = String(value || "");
  if (!/^(?:127\.0\.0\.1|localhost):\d{4,5}$/u.test(address)) {
    throw new Error(`Chrome debugger가 정확한 loopback 주소가 아닙니다: ${address}`);
  }
  return address;
}

async function browserTargets(
  debuggerAddress: string
): Promise<DevToolsTarget[]> {
  const payload = await fetchJson(
    `http://${debuggerAddress}/json/list`,
    { timeoutMs: 2_000 }
  );
  return Array.isArray(payload)
    ? payload.filter((entry): entry is DevToolsTarget => isRecord(entry))
    : [];
}

async function waitForIframeTarget(
  debuggerAddress: string,
  exactUrl: string
): Promise<DevToolsTarget> {
  return waitFor(
    async () => (await browserTargets(debuggerAddress)).find((target) => (
      target.type === "iframe" && target.url === exactUrl
    )) || null,
    (target): target is DevToolsTarget => Boolean(target),
    `실제 cross-origin iframe target을 찾지 못했습니다: ${exactUrl}`,
    12_000
  ) as Promise<DevToolsTarget>;
}

async function targetCommand(
  target: DevToolsTarget,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const socketUrl = String(target.webSocketDebuggerUrl || "");
  if (!socketUrl.startsWith("ws://127.0.0.1:")
    && !socketUrl.startsWith("ws://localhost:")) {
    throw new Error("iframe DevTools target이 loopback WebSocket이 아닙니다.");
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("iframe target 평가 시간이 초과되었습니다."));
    }, 5_000);
    const finish = (callback: () => void): void => {
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error("iframe target WebSocket 연결 실패")));
    });
    socket.addEventListener("message", (event) => {
      const envelope: unknown = JSON.parse(String(event.data));
      if (!isRecord(envelope) || envelope.id !== 1) {
        return;
      }
      if (isRecord(envelope.error)) {
        const commandError = envelope.error;
        finish(() => reject(new Error(
          `iframe target command 실패: ${String(commandError.message || method)}`
        )));
        return;
      }
      finish(() => resolve(envelope.result));
    });
  });
}

async function evaluateTarget(
  target: DevToolsTarget,
  expression: string
): Promise<unknown> {
  const result = await targetCommand(target, "Runtime.evaluate", {
    expression,
    returnByValue: true
  });
  return isRecord(result) && isRecord(result.result)
    ? result.result.value
    : undefined;
}

interface LateMaterializationFixtureSnapshot {
  readonly interceptedUrls: readonly string[];
  readonly pairedSessionCount: number;
  readonly aStarted: boolean;
  readonly aConsumerId: string;
  readonly aSourceUrl: string;
  readonly aStatusPolls: number;
  readonly aExplicitCancelRequests: number;
  readonly aAbandonedJobsReclaimed: number;
  readonly aRunnerAborted: boolean;
  readonly aRunnerSettled: boolean;
  readonly aSlotReleased: boolean;
  readonly aLateCompletionDiscarded: boolean;
  readonly aLateArtifactExposed: boolean;
  readonly aCachePurgeRequests: number;
  readonly aMediaRequests: number;
  readonly bStartRequests: number;
  readonly bQueuedBeforeReclaim: boolean;
  readonly bStatusPolls: number;
  readonly bStartedAfterReclaim: boolean;
  readonly bCompleted: boolean;
  readonly bMediaRequests: number;
  readonly unexpectedRequests: readonly string[];
}

interface LateMaterializationFixtureInterception {
  readonly snapshot: () => LateMaterializationFixtureSnapshot;
  readonly assertHealthy: () => void;
  readonly close: () => Promise<void>;
}

async function createLeaseReclaimFixtureMedia(): Promise<Buffer> {
  const ffmpeg = await resolveExecutable(
    "FFMPEG_BINARY",
    process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"]
  );
  const outputPath = path.join(tempRoot, "lease-reclaim-b.mp4");
  const stderr: Buffer[] = [];
  const child = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "lavfi", "-i", "color=c=black:s=160x90:r=30:d=34.5",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=34.5",
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "baseline",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k",
    "-shortest", "-movflags", "+faststart", "-n", outputPath
  ], { cwd: tempRoot, shell: false, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`lease fixture MP4 생성 실패 (${String(exitCode)}): ${Buffer.concat(stderr).toString("utf8")}`);
  }
  const bytes = await readFile(outputPath);
  assert(bytes.byteLength > 1_024, "lease fixture MP4가 너무 짧습니다.");
  return bytes;
}

async function installLateMaterializationV2Fixture({
  sourceAUrl,
  sourceBUrl
}: {
  sourceAUrl: string;
  sourceBUrl: string;
}): Promise<LateMaterializationFixtureInterception> {
  const observerLeaseTtlMs = 2_000;
  const bMediaBytes = await createLeaseReclaimFixtureMedia();
  const state = {
    interceptedUrls: [] as string[],
    pairedSessionCount: 0,
    aStarted: false,
    aConsumerId: "",
    aSourceUrl: "",
    aStatusPolls: 0,
    aExplicitCancelRequests: 0,
    aAbandonedJobsReclaimed: 0,
    aRunnerAborted: false,
    aRunnerSettled: false,
    aSlotReleased: false,
    aLateCompletionDiscarded: false,
    aLateArtifactExposed: false,
    aCachePurgeRequests: 0,
    aMediaRequests: 0,
    bStartRequests: 0,
    bQueuedBeforeReclaim: false,
    bStatusPolls: 0,
    bStartedAfterReclaim: false,
    bCompleted: false,
    bMediaRequests: 0,
    unexpectedRequests: [] as string[]
  };
  const aJobId = "late_a_job_00000001";
  const bJobId = "lease_b_job_00000001";
  const bMediaAccess = Buffer.alloc(32, 0x5a).toString("base64url");
  let aObserverNonce = "";
  let bObserverNonce = "";
  let bRequest: Record<string, unknown> | null = null;
  let aLeaseTimer: ReturnType<typeof setTimeout> | null = null;
  let aRunnerSettleTimer: ReturnType<typeof setTimeout> | null = null;
  let fixtureClosed = false;
  let fixtureError: Error | null = null;

  const queuedAStatus = () => ({
    schema: "chzzk-kirinuki-vod-materialization-status/v1",
    jobId: aJobId,
    state: "downloading",
    progress: 0.72,
    message: "A fixture materialization is deliberately finishing late",
    reused: false
  });
  const queuedBStatus = () => ({
    schema: "chzzk-kirinuki-vod-materialization-status/v1",
    jobId: bJobId,
    state: "queued",
    progress: 0,
    message: "B waits for the abandoned A runner slot",
    reused: false
  });
  const completedBStatus = () => {
    const clips = Array.isArray(bRequest?.clips) ? bRequest.clips : [];
    if (clips.length !== 1 || !isRecord(clips[0])) {
      throw new Error("lease B fixture는 정확히 한 개의 materialization clip을 기대합니다.");
    }
    const clip = clips[0];
    const clipId = String(clip.id || "").trim();
    const sourceStartMs = Number(clip.startMs);
    const sourceEndMs = Number(clip.endMs);
    if (
      !clipId
      || !Number.isSafeInteger(sourceStartMs)
      || !Number.isSafeInteger(sourceEndMs)
      || sourceStartMs < 0
      || sourceEndMs <= sourceStartMs
    ) {
      throw new Error("lease B fixture materialization clip identity가 올바르지 않습니다.");
    }
    const requestedEditableRanges = Array.isArray(bRequest?.editableRanges)
      ? bRequest.editableRanges
      : [];
    const requestedEditable = requestedEditableRanges.find((candidate) => (
      isRecord(candidate) && String(candidate.id || "") === clipId
    ));
    const editableSourceStartMs = isRecord(requestedEditable)
      ? Number(requestedEditable.startMs)
      : Math.max(0, sourceStartMs - 10_000);
    const editableSourceEndMs = isRecord(requestedEditable)
      ? Number(requestedEditable.endMs)
      : sourceEndMs + 10_000;
    if (
      !Number.isSafeInteger(editableSourceStartMs)
      || !Number.isSafeInteger(editableSourceEndMs)
      || editableSourceStartMs < 0
      || editableSourceStartMs > sourceStartMs
      || editableSourceEndMs < sourceEndMs
    ) {
      throw new Error("lease B fixture editable coverage가 올바르지 않습니다.");
    }
    const mediaDurationMs = editableSourceEndMs - editableSourceStartMs;
    assert(mediaDurationMs === 34_500, `lease B fixture duration 불일치: ${mediaDurationMs}`);
    const planFingerprint = "c".repeat(64);
    return {
      schema: "chzzk-kirinuki-vod-materialization-status/v1",
      jobId: bJobId,
      state: "completed",
      progress: 1,
      message: "B completed after A observer lease reclamation",
      reused: false,
      materialization: {
        schema: "chzzk-kirinuki-chzzk-vod-materialization/v2",
        materializationId: planFingerprint.slice(0, 32),
        planFingerprint,
        source: {
          platform: "CHZZK",
          contentType: "vod",
          contentId: "14514981",
          sourceVersionId: "d".repeat(64)
        },
        sourceDurationMs: Math.max(600_000, editableSourceEndMs),
        handleMs: 10_000,
        mediaDurationMs,
        windows: [{
          id: "lease-b-window-1",
          editableSourceStartMs,
          editableSourceEndMs,
          fetchedSourceStartMs: editableSourceStartMs,
          fetchedSourceEndMs: editableSourceEndMs,
          mediaStartMs: 0,
          mediaEndMs: mediaDurationMs,
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
        url: `http://127.0.0.1:4319/v1/vod/media/${bJobId}?access=${bMediaAccess}`,
        name: "lease-b-materialized.mp4",
        size: bMediaBytes.byteLength,
        type: "video/mp4",
        lastModified: 1_787_270_400_000
      }
    };
  };
  const finishAbandonedARunner = () => {
    if (fixtureClosed || state.aRunnerSettled) return;
    state.aRunnerSettled = true;
    state.aLateCompletionDiscarded = true;
    state.aLateArtifactExposed = false;
    state.aSlotReleased = true;
    if (state.bStartRequests === 1) {
      state.bStartedAfterReclaim = true;
      state.bCompleted = true;
    }
  };
  const expireAObserverLease = () => {
    aLeaseTimer = null;
    if (fixtureClosed || state.aRunnerAborted) return;
    state.aAbandonedJobsReclaimed += 1;
    state.aRunnerAborted = true;
    aRunnerSettleTimer = setTimeout(finishAbandonedARunner, 50);
    aRunnerSettleTimer.unref();
  };
  const renewAObserverLease = () => {
    if (fixtureClosed || state.aRunnerAborted) return;
    if (aLeaseTimer) clearTimeout(aLeaseTimer);
    aLeaseTimer = setTimeout(expireAObserverLease, observerLeaseTtlMs);
    aLeaseTimer.unref();
  };
  const fixtureRecords: LocalMediaEngineV2FixtureRecord[] = [];
  const fixtureErrors: string[] = [];
  const fixture = await createLocalMediaEngineV2Fixture({
    allowedOrigin: studioOrigin,
    errors: fixtureErrors,
    originBinding: "exact-local-studio",
    records: fixtureRecords,
    onControlRequest: async (request) => {
      const url = new URL(request.path, "http://127.0.0.1:4319");
      if (
        url.pathname === "/v1/vod/materializations"
        && request.method === "POST"
      ) {
        if (!isRecord(request.body)) {
          state.unexpectedRequests.push(`${request.method} ${url.pathname} invalid-json`);
          return {
            status: 400,
            payload: {
              error: {
                code: "INVALID_FIXTURE_REQUEST",
                message: "fixture request JSON missing"
              }
            }
          };
        }
        const sourceUrl = String(request.body.sourceUrl || "");
        if (sourceUrl === sourceAUrl) {
          state.aStarted = true;
          state.aConsumerId = String(request.body.consumerId || "");
          state.aSourceUrl = sourceUrl;
          aObserverNonce = request.clientNonce;
          renewAObserverLease();
          return { status: 202, payload: queuedAStatus() };
        }
        if (sourceUrl === sourceBUrl) {
          state.bStartRequests += 1;
          bObserverNonce = request.clientNonce;
          bRequest = request.body;
          if (!state.aSlotReleased) {
            state.bQueuedBeforeReclaim = true;
          } else {
            state.bStartedAfterReclaim = true;
            state.bCompleted = true;
          }
          if (!aObserverNonce || bObserverNonce === aObserverNonce) {
            state.unexpectedRequests.push("A와 B가 document observer nonce를 공유했습니다.");
          }
          return {
            status: 202,
            payload: state.bCompleted ? completedBStatus() : queuedBStatus()
          };
        }
      }
      if (
        url.pathname === `/v1/vod/materializations/${aJobId}`
        && request.method === "POST"
      ) {
        state.aStatusPolls += 1;
        if (request.clientNonce === aObserverNonce) {
          renewAObserverLease();
        }
        return { status: 200, payload: queuedAStatus() };
      }
      if (
        url.pathname === `/v1/vod/materializations/${aJobId}`
        && request.method === "DELETE"
      ) {
        state.aExplicitCancelRequests += 1;
        if (aLeaseTimer) {
          clearTimeout(aLeaseTimer);
          aLeaseTimer = null;
        }
        state.aRunnerAborted = true;
        finishAbandonedARunner();
        return {
          status: 200,
          payload: {
            schema: "chzzk-kirinuki-vod-materialization-status/v1",
            jobId: aJobId,
            state: "cancelled",
            progress: 0,
            message: "A fixture materialization was explicitly cancelled",
            reused: false
          }
        };
      }
      if (
        url.pathname === `/v1/vod/materializations/${bJobId}`
        && request.method === "POST"
      ) {
        state.bStatusPolls += 1;
        if (request.clientNonce !== bObserverNonce) {
          state.unexpectedRequests.push("B status observer nonce가 create와 다릅니다.");
        }
        return {
          status: 200,
          payload: state.bCompleted ? completedBStatus() : queuedBStatus()
        };
      }
      if (
        url.pathname === `/v1/vod/materializations/${aJobId}/cache`
        || url.pathname === `/v1/vod/materializations/${aJobId}/session-cache`
      ) {
        state.aCachePurgeRequests += 1;
        return {
          status: 409,
          statusText: "Conflict",
          payload: {
            error: {
              code: "SMOKE_PURGE_NOT_ALLOWED",
              message: "late A cache must remain owned by A"
            }
          }
        };
      }
      state.unexpectedRequests.push(`${request.method} ${url.pathname}`);
      return {
        status: 404,
        statusText: "Not Found",
        payload: {
          error: {
            code: "SMOKE_UNEXPECTED_REQUEST",
            message: "unexpected v2 fixture request"
          }
        }
      };
    },
    onMediaRequest: ({ method, path: mediaPath, request, response }) => {
      const url = new URL(mediaPath, "http://127.0.0.1:4319");
      if (url.pathname === `/v1/vod/media/${aJobId}`) {
        state.aMediaRequests += 1;
        request.resume();
        const bytes = Buffer.from(JSON.stringify({
          error: {
            code: "SMOKE_STALE_ATTACH",
            message: "late A media must never be requested by B"
          }
        }), "utf8");
        response.writeHead(409, "Conflict", {
          "Access-Control-Allow-Origin": studioOrigin,
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(bytes.byteLength),
          "X-Content-Type-Options": "nosniff"
        });
        response.end(method === "HEAD" ? undefined : bytes);
        return true;
      }
      if (url.pathname !== `/v1/vod/media/${bJobId}`) {
        return false;
      }
      state.bMediaRequests += 1;
      request.resume();
      if (url.searchParams.get("access") !== bMediaAccess) {
        response.writeHead(403, "Forbidden", {
          "Access-Control-Allow-Origin": studioOrigin,
          "Cache-Control": "no-store",
          "Content-Length": "0"
        });
        response.end();
        return true;
      }
      const rawRange = request.headers.range;
      const rangeHeader = Array.isArray(rawRange) ? "" : String(rawRange || "");
      let start = 0;
      let end = bMediaBytes.byteLength - 1;
      let status = 200;
      if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/u.exec(rangeHeader);
        const requestedStart = match ? Number(match[1]) : Number.NaN;
        const requestedEnd = match && match[2]
          ? Number(match[2])
          : bMediaBytes.byteLength - 1;
        if (
          !Number.isSafeInteger(requestedStart)
          || !Number.isSafeInteger(requestedEnd)
          || requestedStart < 0
          || requestedEnd < requestedStart
          || requestedStart >= bMediaBytes.byteLength
        ) {
          response.writeHead(416, "Range Not Satisfiable", {
            "Access-Control-Allow-Origin": studioOrigin,
            "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Range": `bytes */${bMediaBytes.byteLength}`,
            "Content-Length": "0",
            "X-Content-Type-Options": "nosniff"
          });
          response.end();
          return true;
        }
        start = requestedStart;
        end = Math.min(requestedEnd, bMediaBytes.byteLength - 1);
        status = 206;
      }
      const bytes = bMediaBytes.subarray(start, end + 1);
      response.writeHead(status, status === 206 ? "Partial Content" : "OK", {
        "Access-Control-Allow-Origin": studioOrigin,
        "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.byteLength),
        ...(status === 206
          ? { "Content-Range": `bytes ${start}-${end}/${bMediaBytes.byteLength}` }
          : {}),
        "X-Content-Type-Options": "nosniff"
      });
      response.end(method === "HEAD" ? undefined : bytes);
      return true;
    }
  });
  localMediaEngineFixture = fixture;
  await fixture.listen();

  const snapshot = (): LateMaterializationFixtureSnapshot => {
    state.pairedSessionCount = fixture.sessions.length;
    state.interceptedUrls = fixtureRecords.map((record) => (
      `${record.method} http://127.0.0.1:4319${record.path}`
    ));
    return {
      ...state,
      interceptedUrls: [...state.interceptedUrls],
      unexpectedRequests: [
        ...state.unexpectedRequests,
        ...fixtureErrors.map((error) => `fixture-error ${error}`)
      ]
    };
  };
  return {
    snapshot,
    assertHealthy: () => {
      if (fixtureErrors.length > 0) {
        throw new Error(fixtureErrors.join("\n"));
      }
      if (fixtureError) {
        throw fixtureError;
      }
    },
    close: async () => {
      try {
        fixtureClosed = true;
        if (aLeaseTimer) clearTimeout(aLeaseTimer);
        if (aRunnerSettleTimer) clearTimeout(aRunnerSettleTimer);
        aLeaseTimer = null;
        aRunnerSettleTimer = null;
        await fixture.close();
      } catch (error) {
        fixtureError = error instanceof Error ? error : new Error(String(error));
        throw fixtureError;
      } finally {
        if (localMediaEngineFixture === fixture) {
          localMediaEngineFixture = null;
        }
      }
    }
  };
}

async function dispatchStudioShortcut(key: string): Promise<boolean> {
  return execute<boolean>(`
    const event = new KeyboardEvent("keydown", {
      key: arguments[0].toLowerCase(),
      code: "Key" + arguments[0],
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  `, [key]);
}

async function captureLocalMediaEngineProtocolAttempt(
  debuggerAddress: string
): Promise<string> {
  const pageTarget = await waitFor(
    async () => (await browserTargets(debuggerAddress)).find((target) => (
      target.type === "page"
      && String(target.url || "").startsWith(`${studioOrigin}/editor.html`)
    )) || null,
    (target): target is DevToolsTarget => Boolean(target?.webSocketDebuggerUrl),
    "pairing protocol 확인용 editor CDP target을 찾지 못했습니다."
  );
  if (!pageTarget) {
    throw new Error("pairing protocol 확인용 editor target이 비어 있습니다.");
  }
  const connection = await DevToolsConnection.open(
    String(pageTarget.webSocketDebuggerUrl)
  );
  await connection.send("Page.enable");
  let resolveAttempt: (url: string) => void = () => undefined;
  const attempted = new Promise<string>((resolve) => {
    resolveAttempt = resolve;
  });
  const unsubscribe = connection.on("Page.frameRequestedNavigation", (params) => {
    const url = String(params.url || "");
    if (!url.startsWith("kirinuki-engine://pair?")) {
      return;
    }
    resolveAttempt(url);
    void connection.send("Page.stopLoading").catch(() => undefined);
  });
  try {
    const prompt = await waitFor(
      () => execute<{
        dialogOpen: boolean;
        retryDisabled: boolean;
        retryLabel: string;
      }>(`
        const dialog = document.querySelector("#local-media-engine-dialog");
        const retry = document.querySelector("#local-media-engine-retry");
        return {
          dialogOpen: dialog instanceof HTMLDialogElement && dialog.open,
          retryDisabled: !(retry instanceof HTMLButtonElement) || retry.disabled,
          retryLabel: retry?.textContent?.trim() || ""
        };
      `),
      (value) => (
        value.dialogOpen
        && !value.retryDisabled
        && value.retryLabel === "이 PC 연결"
      ),
      "최초 1회 이 PC 연결 버튼이 표시되지 않았습니다.",
      20_000
    );
    assert(prompt.dialogOpen, "최초 로컬 엔진 연결 안내가 열리지 않았습니다.");
    await execute(`
      const retry = document.querySelector("#local-media-engine-retry");
      if (!(retry instanceof HTMLButtonElement) || retry.disabled) {
        throw new Error("이 PC 연결 버튼을 누를 수 없습니다.");
      }
      retry.click();
      return true;
    `);
    const timeout = delay(5_000).then(() => {
      throw new Error("이 PC 연결 버튼이 custom scheme navigation을 시도하지 않았습니다.");
    });
    const attemptedUrl = await Promise.race([attempted, timeout]);
    const parsed = parseLocalMediaEnginePairingRequest(attemptedUrl);
    assert(
      localMediaEnginePairingUrl(parsed) === attemptedUrl,
      `이 PC 연결 버튼의 pairing payload가 canonical form이 아닙니다: ${attemptedUrl}`
    );
    process.stderr.write("[browser-smoke] 이 PC 연결 custom-scheme payload 확인\n");
    return attemptedUrl;
  } finally {
    unsubscribe();
    connection.close();
  }
}

async function enrollLocalMediaEngineFixture(
  fixture: Readonly<LocalMediaEngineV2Fixture>
): Promise<void> {
  const state = freshLocalMediaEngineChallenge();
  const challenge = freshLocalMediaEngineChallenge();
  await execute(`
    globalThis.__kirinukiSmokePairing = null;
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
    }).then(async (response) => {
      globalThis.__kirinukiSmokePairing = {
        ok: response.ok,
        status: response.status,
        value: await response.json(),
        error: ""
      };
    }, (error) => {
      globalThis.__kirinukiSmokePairing = {
        ok: false,
        status: 0,
        value: null,
        error: String(error)
      };
    });
    return true;
  `, [
    LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
    LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
    state,
    LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
    challenge
  ]);
  const pairingResult = await waitFor(
    () => execute<{
      ok: boolean;
      status: number;
      value: unknown;
      error: string;
    } | null>("return globalThis.__kirinukiSmokePairing || null;"),
    (value) => value !== null,
    "브라우저가 v2 signed pairing fixture 응답을 받지 못했습니다."
  );
  const pairing = parseLocalMediaEnginePairingResponse(pairingResult?.value);
  assert(
    pairingResult?.ok
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
    `v2 fixture pairing identity 서명이 올바르지 않습니다: ${JSON.stringify(pairingResult)}`
  );
  await execute(`
    globalThis.__kirinukiSmokePinWrite = null;
    const open = indexedDB.open(arguments[0], 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(arguments[1])) {
        open.result.createObjectStore(arguments[1]);
      }
    };
    open.onerror = () => {
      globalThis.__kirinukiSmokePinWrite = {
        ready: false,
        error: String(open.error || "open failed")
      };
    };
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(arguments[1], "readwrite");
      transaction.objectStore(arguments[1]).put(arguments[2], "active");
      transaction.oncomplete = () => {
        database.close();
        globalThis.__kirinukiSmokePinWrite = { ready: true, error: "" };
      };
      transaction.onerror = () => {
        globalThis.__kirinukiSmokePinWrite = {
          ready: false,
          error: String(transaction.error || "pin write failed")
        };
      };
    };
    return true;
  `, [
    LOCAL_MEDIA_ENGINE_TRUST_DATABASE,
    LOCAL_MEDIA_ENGINE_TRUST_STORE,
    {
      schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
      algorithm: pairing.algorithm,
      keyId: pairing.keyId,
      publicKeySpki: pairing.publicKeySpki,
      enrolledAt: new Date().toISOString(),
      maxSeenVersion: pairing.engineVersion
    }
  ]);
  const stored = await waitFor(
    () => execute<{ ready: boolean; error: string } | null>(
      "return globalThis.__kirinukiSmokePinWrite || null;"
    ),
    (value) => Boolean(value?.ready || value?.error),
    "검증된 v2 fixture pairing identity를 임시 브라우저 profile에 고정하지 못했습니다."
  );
  assert(stored?.ready && !stored.error, `v2 fixture pin 저장 실패: ${stored?.error || "unknown"}`);
  process.stderr.write("[browser-smoke] signed pairing identity 임시 profile 고정 완료\n");
}

async function setSourceAndVerify({
  inputUrl,
  expectedSourceLabel,
  expectedKindLabel,
  expectedEmbedUrl,
  debuggerAddress,
  requireLiveTarget
}: {
  inputUrl: string;
  expectedSourceLabel: string;
  expectedKindLabel: string;
  expectedEmbedUrl: string;
  debuggerAddress: string;
  requireLiveTarget: boolean;
}): Promise<{
  checked: "dom-only" | "live";
  title?: string;
  readyState?: string;
}> {
  await execute(`
    const input = document.querySelector("#source-url");
    if (!(input instanceof HTMLInputElement)) throw new Error("source input 없음");
    input.value = arguments[0];
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `, [inputUrl]);
  const state = await waitFor(
    () => execute<{
      sourceLabel: string;
      kindLabel: string;
      frameUrl: string;
      frameHidden: boolean;
      sandbox: string;
      allow: string;
    }>(`
      const frame = document.querySelector("#stream-preview-frame");
      return {
        sourceLabel: document.querySelector("#source-platform")?.textContent || "",
        kindLabel: document.querySelector("#stream-preview-kind")?.textContent || "",
        frameUrl: frame?.src || "",
        frameHidden: Boolean(frame?.hidden),
        sandbox: frame?.getAttribute("sandbox") || "",
        allow: frame?.getAttribute("allow") || ""
      };
    `),
    (value) => value.frameUrl === expectedEmbedUrl,
    `${expectedSourceLabel} iframe URL 전환 실패`
  );
  assert(state.sourceLabel === expectedSourceLabel, `${expectedSourceLabel} 플랫폼 라벨이 다릅니다.`);
  assert(state.kindLabel === expectedKindLabel, `${expectedSourceLabel} viewer 라벨이 다릅니다.`);
  assert(state.frameHidden === false, `${expectedSourceLabel} iframe이 숨겨져 있습니다.`);
  assert(
    state.sandbox === "allow-scripts allow-same-origin",
    `${expectedSourceLabel} iframe sandbox가 최소 권한과 다릅니다.`
  );
  assert(
    state.allow === "encrypted-media; picture-in-picture",
    `${expectedSourceLabel} iframe permissions allowlist가 최소 권한과 다릅니다.`
  );
  if (!requireLiveTarget) {
    return { checked: "dom-only" };
  }
  const target = await waitForIframeTarget(debuggerAddress, expectedEmbedUrl);
  const targetState = await waitFor(
    async () => {
      const value = await evaluateTarget(target, `JSON.stringify({
        title: document.title,
        readyState: document.readyState,
        hasPlayer: Boolean(
          document.querySelector("video")
          || document.querySelector("#movie_player")
          || document.querySelector("[class*='player' i]")
        ),
        visibleError: Boolean([...document.querySelectorAll("[class*='error' i]")].find((node) => {
          const style = getComputedStyle(node);
          return style.display !== "none"
            && style.visibility !== "hidden"
            && node.getBoundingClientRect().width > 0
            && node.getBoundingClientRect().height > 0
            && (node.textContent || "").trim();
        }))
      })`);
      try {
        return JSON.parse(String(value)) as {
          title: string;
          readyState: string;
          hasPlayer: boolean;
          visibleError: boolean;
        };
      } catch {
        return {
          title: "",
          readyState: "",
          hasPlayer: false,
          visibleError: false
        };
      }
    },
    (value) => (
      (value.readyState === "interactive" || value.readyState === "complete")
      && value.hasPlayer
      && !value.visibleError
    ),
    `${expectedSourceLabel} iframe의 실제 player 준비를 확인하지 못했습니다.`,
    15_000
  );
  assert(targetState.title.trim(), `${expectedSourceLabel} iframe document title이 비어 있습니다.`);
  return { checked: "live", ...targetState };
}

async function stopManagedChild(child: ManagedChild | null): Promise<void> {
  if (!child || child.exitCode !== null || child.pid === undefined) {
    return;
  }
  const waitForExit = (timeoutMs: number): Promise<boolean> => (
    new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      const onExit = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once("exit", onExit);
    })
  );
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (process.platform === "win32") {
        child.kill(name);
      } else {
        process.kill(-child.pid!, name);
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
  };
  signal("SIGTERM");
  if (!await waitForExit(3_000)) {
    signal("SIGKILL");
    await waitForExit(3_000);
  }
}

async function cleanup(): Promise<void> {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    if (sessionId && driver?.exitCode === null) {
      try {
        await fetchJson(
          `http://127.0.0.1:${driverPort}/session/${sessionId}`,
          { method: "DELETE", timeoutMs: 5_000 }
        );
      } catch {
        // 아래에서 검증된 자식 process group만 종료한다.
      }
      sessionId = "";
    }
    if (localMediaEngineFixture) {
      const fixture = localMediaEngineFixture;
      localMediaEngineFixture = null;
      await fixture.close().catch(() => undefined);
    }
    await stopManagedChild(driver);
    await stopManagedChild(studio);
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 100
    });
  })();
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    });
  });
}

async function main(): Promise<void> {
  const requestedLiveMode = process.env.KIRINUKI_LIVE_EMBED_SMOKE;
  if (
    requestedLiveMode !== undefined
    && requestedLiveMode !== ""
    && requestedLiveMode !== "0"
    && requestedLiveMode !== "1"
  ) {
    throw new Error("KIRINUKI_LIVE_EMBED_SMOKE는 0 또는 1이어야 합니다.");
  }
  for (const requiredPath of [
    "web/index.html",
    "web/studio.js",
    "web/studio.css",
    "web/editor/editor.js",
    "web/editor.html"
  ]) {
    await access(path.join(root, requiredPath));
  }
  const freshWebBuild = await buildWebJavaScript({
    rootDirectory: root,
    write: false,
    logLevel: "silent"
  });
  const serverMode = await ensureStudioServer();
  for (const relativePath of ["web/studio.js", "web/editor/editor.js"]) {
    const outputPath = relativePath.replace(/^web\//u, "");
    const freshBytes = freshWebBuild.outputs.get(outputPath);
    assert(freshBytes, `fresh web build에서 ${outputPath}를 찾지 못했습니다.`);
    const response = await fetch(
      `${studioOrigin}/${outputPath}`,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) }
    );
    assert(response.ok, `localhost server가 ${relativePath}를 제공하지 못했습니다.`);
    const [served, checkedIn] = await Promise.all([
      response.arrayBuffer().then((bytes) => Buffer.from(bytes)),
      readFile(path.join(root, relativePath))
    ]);
    const expected = Buffer.from(freshBytes);
    assert(
      served.equals(expected),
      `localhost server가 현재 TypeScript와 다른 ${relativePath}를 제공했습니다.`
    );
    assert(
      checkedIn.equals(expected),
      `${relativePath} 생성물이 현재 TypeScript보다 오래됐습니다.`
    );
  }
  const [chromedriver, chromium, port] = await Promise.all([
    resolveExecutable("CHROMEDRIVER_BINARY", ["chromedriver"]),
    resolveExecutable("CHROMIUM_BINARY", [
      "chromium",
      "chromium-browser",
      "google-chrome",
      "google-chrome-stable"
    ]),
    reservePort()
  ]);
  driverPort = port;
  driver = spawn(chromedriver, [`--port=${port}`], {
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  }) as ManagedChild;
  driver.stdout.on("data", (chunk: Buffer | string) => {
    driverOutput = appendOutput(driverOutput, chunk);
  });
  driver.stderr.on("data", (chunk: Buffer | string) => {
    driverOutput = appendOutput(driverOutput, chunk);
  });
  await waitForDriver();

  const created = await webdriver<BrowserSession>("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        pageLoadStrategy: "eager",
        "goog:loggingPrefs": { browser: "ALL", performance: "ALL" },
        "goog:chromeOptions": {
          binary: chromium,
          args: [
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profileRoot}`
          ]
        }
      }
    }
  }, 45_000);
  assert(typeof created.sessionId === "string" && created.sessionId, "WebDriver session ID가 없습니다.");
  sessionId = created.sessionId;
  const windowRect = await webdriver<{
    width?: unknown;
    height?: unknown;
  }>(
    "POST",
    `/session/${sessionId}/window/rect`,
    { width: 1_600, height: 1_000 }
  );
  assert(
    Number(windowRect.width) >= 1_500 && Number(windowRect.height) >= 900,
    `넓은 PC viewport를 준비하지 못했습니다: ${JSON.stringify(windowRect)}`
  );
  const debuggerAddress = exactLoopbackDebuggerAddress(
    created.capabilities?.["goog:chromeOptions"]?.debuggerAddress
  );

  const commandLine = await cdp<{ arguments?: unknown }>(
    "Browser.getBrowserCommandLine",
    {}
  );
  const browserArguments = Array.isArray(commandLine.arguments)
    ? commandLine.arguments.map(String)
    : [];
  assert(
    browserArguments.some((argument) => argument === `--user-data-dir=${profileRoot}`),
    "Chromium이 smoke 전용 임시 프로필을 쓰지 않습니다."
  );
  assert(
    !browserArguments.some((argument) => (
      argument.startsWith("--load-extension")
      || argument.startsWith("--disable-extensions-except")
      || argument.includes("chrome-extension://")
    )),
    "웹 편집기 smoke는 브라우저 확장 프로그램을 로드하면 안 됩니다."
  );
  await cdp("Network.enable", {});
  await cdp("Network.setBlockedURLs", {
    urls: [
      gatewayPattern,
      ...(liveEmbedSmoke
        ? []
        : externalEmbedPatterns)
    ]
  });
  const desktopClientSignals = await execute<{
    userAgent: string;
    platform: string;
  }>(`
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform
    };
  `);
  const iphoneUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  await cdp("Network.setUserAgentOverride", {
    userAgent: iphoneUserAgent,
    platform: "iPhone"
  });
  await webdriver("POST", `/session/${sessionId}/url`, { url: `${studioOrigin}/` });
  const mobileStartGate = await waitFor(
    () => execute<{
      noticeVisible: boolean;
      startDisabled: boolean;
    }>(`
      const notice = document.querySelector("#mobile-editor-notice");
      const start = document.querySelector("#start-editor");
      return {
        noticeVisible: notice instanceof HTMLElement && !notice.hidden,
        startDisabled: start instanceof HTMLButtonElement && start.disabled
      };
    `),
    (value) => (
      value.noticeVisible
      && value.startDisabled
    ),
    "iPhone UA에서 시작 화면이 모바일 편집기 진입을 막지 않았습니다."
  );
  await webdriver("POST", `/session/${sessionId}/url`, {
    url: `${studioOrigin}/editor.html?project=mobile-direct-smoke`
  });
  const mobileDirectGate = await waitFor(
    () => execute<{
      gateVisible: boolean;
      shellHidden: boolean;
      shellInert: boolean;
      policyHidden: boolean;
    }>(`
      const gate = document.querySelector("#editor-mobile-gate");
      const shell = document.querySelector("#editor-shell");
      const policy = document.querySelector("#editor-policy-gate");
      return {
        gateVisible: gate instanceof HTMLElement && !gate.hidden,
        shellHidden: shell instanceof HTMLElement && shell.hidden,
        shellInert: shell instanceof HTMLElement && shell.inert,
        policyHidden: policy instanceof HTMLElement && policy.hidden
      };
    `),
    (value) => (
      value.gateVisible
      && value.shellHidden
      && value.shellInert
      && value.policyHidden
    ),
    "iPhone UA의 직접 editor URL이 inert 모바일 gate로 닫히지 않았습니다."
  );
  await cdp("Network.setUserAgentOverride", {
    userAgent: desktopClientSignals.userAgent,
    platform: desktopClientSignals.platform
  });
  await webdriver("POST", `/session/${sessionId}/url`, {
    url: `${studioOrigin}/editor.html?project=desktop-header-layout-smoke`
  });
  await waitFor(
    () => execute<boolean>(`
      const policy = document.querySelector("#editor-policy-gate");
      return document.readyState !== "loading"
        && policy instanceof HTMLElement
        && !policy.hidden;
    `),
    Boolean,
    "데스크톱 UA 복구 뒤 편집기 DOM이 준비되지 않았습니다."
  );
  const desktopHeaderLayout = await execute<{
    ad: { width: number; height: number };
    brand: { width: number; height: number };
    rail: { width: number; height: number };
    topbarHeight: number;
    firstRowY: number;
    secondRowY: number;
    overflowFree: boolean;
    labelsVisible: boolean;
  }>(`
    const shell = document.querySelector("#editor-shell");
    const policy = document.querySelector("#editor-policy-gate");
    const mobile = document.querySelector("#editor-mobile-gate");
    if (!(shell instanceof HTMLElement)) throw new Error("editor shell missing");
    shell.hidden = false;
    shell.inert = false;
    if (policy instanceof HTMLElement) policy.hidden = true;
    if (mobile instanceof HTMLElement) mobile.hidden = true;
    for (const id of ["prepare-chzzk-vod", "finish-editing-session", "open-short-form"]) {
      const element = document.getElementById(id);
      if (element instanceof HTMLElement) element.hidden = false;
    }
    const exit = document.querySelector("#exit-short-form");
    if (exit instanceof HTMLElement) exit.hidden = true;
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(selector + " missing");
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, y: bounds.y };
    };
    const topbar = document.querySelector(".topbar");
    const labelButtons = [
      "#prepare-chzzk-vod",
      "#pick-media",
      "#open-short-form",
      "#export-video",
      "#create-local-draft",
      "#open-local-drafts",
      "#finish-editing-session"
    ].map((selector) => document.querySelector(selector));
    return {
      ad: rect("#editor-leaderboard-ad-slot"),
      brand: rect("#editor-brand-slot"),
      rail: rect("#desktop-ad-slot"),
      topbarHeight: rect(".topbar").height,
      firstRowY: rect(".top-actions-primary").y,
      secondRowY: rect(".top-actions-secondary").y,
      overflowFree: topbar instanceof HTMLElement
        && topbar.scrollWidth <= topbar.clientWidth,
      labelsVisible: labelButtons.every((button) => (
        button instanceof HTMLButtonElement
        && button.innerText.trim().length > 0
        && Number.parseFloat(getComputedStyle(button).fontSize) > 0
        && button.getBoundingClientRect().width > 38
      ))
    };
  `);
  assert(
    desktopHeaderLayout.ad.width === 728
      && desktopHeaderLayout.ad.height === 90
      && desktopHeaderLayout.brand.width === 100
      && desktopHeaderLayout.brand.height === 90
      && desktopHeaderLayout.rail.width === 160
      && desktopHeaderLayout.rail.height === 600
      && desktopHeaderLayout.topbarHeight === 106
      && desktopHeaderLayout.firstRowY < desktopHeaderLayout.secondRowY
      && desktopHeaderLayout.overflowFree
      && desktopHeaderLayout.labelsVisible,
    `데스크톱 상단 광고·2행 버튼 실측이 다릅니다: ${JSON.stringify(desktopHeaderLayout)}`
  );
  const narrowWindowRect = await webdriver<{
    width?: unknown;
    height?: unknown;
  }>(
    "POST",
    `/session/${sessionId}/window/rect`,
    { width: 1_000, height: 700 }
  );
  assert(
    Number(narrowWindowRect.width) >= 990
      && Number(narrowWindowRect.width) <= 1_010
      && Number(narrowWindowRect.height) >= 690,
    `좁고 낮은 PC viewport를 준비하지 못했습니다: ${JSON.stringify(narrowWindowRect)}`
  );
  const narrowDesktopLayout = await execute<{
    viewportWidth: number;
    viewportHeight: number;
    documentWidth: number;
    documentHeight: number;
    bodyWidth: number;
    bodyHeight: number;
    bodyClientWidth: number;
    bodyClientHeight: number;
    ad: { width: number; height: number; rendered: boolean };
    rail: { width: number; height: number; rendered: boolean };
    shellRendered: boolean;
    mobileGateHidden: boolean;
    horizontalScroll: boolean;
    verticalScroll: boolean;
  }>(`
    const measured = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(selector + " missing");
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: bounds.width,
        height: bounds.height,
        rendered: !element.hidden
          && style.display !== "none"
          && style.visibility !== "hidden"
      };
    };
    const shell = document.querySelector("#editor-shell");
    const mobileGate = document.querySelector("#editor-mobile-gate");
    const shellStyle = shell instanceof HTMLElement ? getComputedStyle(shell) : null;
    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      bodyClientWidth: document.body.clientWidth,
      bodyClientHeight: document.body.clientHeight,
      ad: measured("#editor-leaderboard-ad-slot"),
      rail: measured("#desktop-ad-slot"),
      shellRendered: shell instanceof HTMLElement
        && !shell.hidden
        && shellStyle?.display !== "none"
        && shellStyle?.visibility !== "hidden",
      mobileGateHidden: mobileGate instanceof HTMLElement && mobileGate.hidden,
      horizontalScroll: (
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || document.body.scrollWidth > document.body.clientWidth + 1
      ),
      verticalScroll: (
        document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
        || document.body.scrollHeight > document.body.clientHeight + 1
      )
    };
  `);
  assert(
    narrowDesktopLayout.viewportWidth <= 1_010
      && narrowDesktopLayout.viewportHeight <= 700
      && narrowDesktopLayout.ad.width === 728
      && narrowDesktopLayout.ad.height === 90
      && narrowDesktopLayout.ad.rendered
      && narrowDesktopLayout.rail.width === 160
      && narrowDesktopLayout.rail.height === 600
      && narrowDesktopLayout.rail.rendered
      && narrowDesktopLayout.shellRendered
      && narrowDesktopLayout.mobileGateHidden
      && narrowDesktopLayout.horizontalScroll
      && narrowDesktopLayout.verticalScroll
      && Math.max(
        narrowDesktopLayout.documentWidth,
        narrowDesktopLayout.bodyWidth
      ) > narrowDesktopLayout.viewportWidth
      && Math.max(
        narrowDesktopLayout.documentHeight,
        narrowDesktopLayout.bodyHeight
      ) > narrowDesktopLayout.viewportHeight,
    `좁고 낮은 PC에서 광고를 숨기거나 줄이는 대신 editor scroll을 제공하지 못했습니다: ${JSON.stringify(narrowDesktopLayout)}`
  );
  const restoredWindowRect = await webdriver<{
    width?: unknown;
    height?: unknown;
  }>(
    "POST",
    `/session/${sessionId}/window/rect`,
    { width: 1_600, height: 1_000 }
  );
  assert(
    Number(restoredWindowRect.width) >= 1_500
      && Number(restoredWindowRect.height) >= 900,
    `브라우저 스모크 viewport를 복원하지 못했습니다: ${JSON.stringify(restoredWindowRect)}`
  );
  await webdriver("POST", `/session/${sessionId}/url`, { url: `${studioOrigin}/` });
  await waitFor(
    () => execute<string>("return document.readyState"),
    (value) => value === "interactive" || value === "complete",
    "localhost 시작 화면이 준비되지 않았습니다."
  );
  if (mobileAccessSmokeOnly) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      runtime: "localhost-web",
      mobileEditorAccess: {
        start: mobileStartGate,
        direct: mobileDirectGate,
        detection: "ua-not-viewport",
        desktopUaRestored: true,
        desktopHeaderLayout,
        narrowDesktopLayout
      }
    }, null, 2)}\n`);
    return;
  }
  const studioReferrerPolicy = await execute<string>(`
    return fetch("/", { cache: "no-store", credentials: "omit" })
      .then((response) => response.headers.get("referrer-policy") || "");
  `);
  assert(
    studioReferrerPolicy === "strict-origin-when-cross-origin",
    `YouTube client identity를 보존할 localhost referrer policy가 다릅니다: ${studioReferrerPolicy}`
  );
  const chzzkUrl = "https://chzzk.naver.com/video/14514980";
  const transitionChzzkUrl = "https://chzzk.naver.com/video/14514981";
  const youtubeUrl = "https://youtu.be/M7lc1UVf-VE?t=5";
  const youtubeEmbed = "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?playsinline=1";
  const soopUrl = "https://vod.sooplive.co.kr/player/169475287?change_second=3";
  const soopEmbed = "https://vod.sooplive.com/player/169475287/embed?autoPlay=true&showChat=false&mutePlay=true";
  const sessionArchiveJson = await buildSmokeSessionArchive(chzzkUrl);
  const chzzkFrame = await setSourceAndVerify({
    inputUrl: chzzkUrl,
    expectedSourceLabel: "치지직 VOD",
    expectedKindLabel: "CHZZK VOD 원본 창",
    expectedEmbedUrl: chzzkUrl,
    debuggerAddress,
    requireLiveTarget: liveEmbedSmoke
  });
  process.stderr.write("[browser-smoke] CHZZK 원본 임베드 검증 완료\n");
  const youtubeFrame = await setSourceAndVerify({
    inputUrl: youtubeUrl,
    expectedSourceLabel: "YouTube VOD",
    expectedKindLabel: "YouTube 임베드 플레이어",
    expectedEmbedUrl: youtubeEmbed,
    debuggerAddress,
    requireLiveTarget: liveEmbedSmoke
  });
  const youtubeStreamingFrame = await execute<{
    frameHidden: boolean;
    frameUrl: string;
  }>(`
    const frame = document.querySelector("#stream-preview-frame");
    return {
      frameHidden: Boolean(frame?.hidden),
      frameUrl: frame?.src || ""
    };
  `);
  assert(
    youtubeStreamingFrame.frameHidden === false
      && youtubeStreamingFrame.frameUrl === youtubeEmbed,
    `YouTube 원본 streaming iframe이 유지되지 않았습니다: ${JSON.stringify(youtubeStreamingFrame)}`
  );
  process.stderr.write("[browser-smoke] YouTube 원본 임베드 검증 완료\n");
  const soopFrame = await setSourceAndVerify({
    inputUrl: soopUrl,
    expectedSourceLabel: "SOOP VOD",
    expectedKindLabel: "SOOP 임베드 플레이어",
    expectedEmbedUrl: soopEmbed,
    debuggerAddress,
    requireLiveTarget: liveEmbedSmoke
  });
  const extensionlessCaptureState = await execute<{
    obsoleteBridgeControlsAbsent: boolean;
    manualInputsEnabled: boolean;
    iframeVisible: boolean;
  }>(`
    const frame = document.querySelector("#stream-preview-frame");
    const row = document.querySelector(".clip-row");
    const start = row?.querySelector('[data-field="start"]');
    const end = row?.querySelector('[data-field="end"]');
    return {
      obsoleteBridgeControlsAbsent: ["stream-cut-console", "capture-start", "capture-end", "seek-backward-five", "seek-forward-five", "playback-rate-quarter", "playback-rate-double"]
        .every((id) => document.querySelector("#" + id) === null),
      manualInputsEnabled: start instanceof HTMLInputElement
        && end instanceof HTMLInputElement
        && !start.disabled
        && !end.disabled,
      iframeVisible: frame instanceof HTMLIFrameElement && frame.hidden === false
    };
  `);
  assert(
    extensionlessCaptureState.obsoleteBridgeControlsAbsent
      && extensionlessCaptureState.manualInputsEnabled
      && extensionlessCaptureState.iframeVisible,
    `확장 프로그램 없이 원본 임베드와 수동 구간 입력을 제공하지 못했습니다: ${JSON.stringify(extensionlessCaptureState)}`
  );
  process.stderr.write("[browser-smoke] SOOP 임베드·확장 없는 수동 구간 입력 검증 완료\n");

  await execute(`
    const input = document.querySelector("#source-url");
    if (!(input instanceof HTMLInputElement)) throw new Error("source input 없음");
    input.value = "https://www.youtube.com/live/M7lc1UVf-VE";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `);
  await waitFor(
    () => execute<{
      sourceLabel: string;
      frameUrl: string;
      frameHidden: boolean;
    }>(`
      const frame = document.querySelector("#stream-preview-frame");
      return {
        sourceLabel: document.querySelector("#source-platform")?.textContent || "",
        frameUrl: frame?.getAttribute("src") || "",
        frameHidden: Boolean(frame?.hidden)
      };
    `),
    (value) => (
      value.sourceLabel === "YouTube VOD"
      && value.frameUrl === youtubeEmbed
      && !value.frameHidden
    ),
    "완료 방송에도 쓰이는 YouTube /live 공유 URL을 canonical viewer로 열지 못했습니다."
  );

  await execute(`
    globalThis.__kirinukiSmokeOpen = null;
    window.open = (target, name, features) => {
      globalThis.__kirinukiSmokeOpen = {
        target: String(target),
        name: String(name),
        features: String(features)
      };
      return { opener: null };
    };
    const input = document.querySelector("#source-url");
    const projectName = document.querySelector("#project-name");
    if (!(projectName instanceof HTMLInputElement)) {
      throw new Error("project name input 없음");
    }
    projectName.value = "";
    input.value = arguments[0];
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#open-source").click();
    projectName.value = "키리누키 프로젝트";
    return true;
  `, [chzzkUrl]);
  const openedSource = await execute<{
    target?: string;
    name?: string;
    features?: string;
  }>(
    "return globalThis.__kirinukiSmokeOpen"
  );
  assert(openedSource.target === chzzkUrl, "원본 새 탭 대체 경로가 canonical CHZZK URL과 다릅니다.");
  assert(openedSource.name === "_blank", "원본 새 탭이 새 browsing context를 사용하지 않습니다.");
  assert(
    openedSource.features === "noopener,noreferrer",
    "원본 새 탭이 opener/referrer 격리 없이 열립니다."
  );

  await waitFor(
    () => execute<{ frameUrl: string; refreshDisabled: boolean }>(`
      const frame = document.querySelector("#stream-preview-frame");
      return {
        frameUrl: frame?.getAttribute("src") || "",
        refreshDisabled: Boolean(document.querySelector("#refresh-source")?.disabled)
      };
    `),
    (value) => value.frameUrl === chzzkUrl && !value.refreshDisabled,
    "CHZZK 원본 창이 준비되지 않았습니다."
  );
  await execute(`
    const manager = document.querySelector("#recent-section");
    const summary = document.querySelector("#local-projects-summary");
    const empty = document.querySelector("#local-projects-empty");
    if (!manager || !summary || !empty) {
      throw new Error("local project manager 없음");
    }
    manager.setAttribute("aria-busy", "true");
    summary.textContent = "Q_REFRESH_SENTINEL";
    empty.hidden = true;
  `);
  const recentRefreshHandled = await dispatchStudioShortcut("Q");
  assert(recentRefreshHandled, "Q 단축키가 document capture console에서 처리되지 않았습니다.");
  await waitFor(
    () => execute<{
      ariaBusy: string | null;
      emptyHidden: boolean;
      summary: string;
    }>(`
      const manager = document.querySelector("#recent-section");
      const empty = document.querySelector("#local-projects-empty");
      return {
        ariaBusy: manager?.getAttribute("aria-busy") ?? null,
        emptyHidden: Boolean(empty?.hidden),
        summary: document.querySelector("#local-projects-summary")?.textContent || ""
      };
    `),
    (value) => (
      value.ariaBusy === "false"
      && value.emptyHidden === false
      && value.summary === "저장된 편집 없음 · 아래 입력은 항상 새 프로젝트로 시작합니다."
    ),
    "Q 단축키가 이 기기의 최근 편집을 다시 읽지 않았습니다."
  );
  process.stderr.write("[browser-smoke] 최근 편집 다시 읽기 검증 완료\n");
  const footerReload = await execute<{
    frameReplaced: boolean;
    frameUrl: string;
  }>(`
    const previousFrame = document.querySelector("#stream-preview-frame");
    document.querySelector("#reload-stream")?.click();
    const currentFrame = document.querySelector("#stream-preview-frame");
    return {
      frameReplaced: currentFrame !== previousFrame,
      frameUrl: currentFrame?.getAttribute("src") || ""
    };
  `);
  assert(
    footerReload.frameReplaced && footerReload.frameUrl === chzzkUrl,
    `footer 플레이어 다시 불러오기가 iframe을 교체하지 못했습니다: ${JSON.stringify(footerReload)}`
  );
  const obsoleteControlsRemainAbsent = await execute<boolean>(`
    return ["capture-start", "capture-end", "seek-backward-five", "seek-forward-five", "playback-rate-quarter", "playback-rate-double"]
      .every((id) => document.querySelector("#" + id) === null);
  `);
  assert(
    obsoleteControlsRemainAbsent,
    "원본 다시 불러오기 뒤 삭제된 플레이어 제어가 다시 나타났습니다."
  );

  const capturePerformanceLogs = await webdriver<BrowserLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  const acquisitionRequests = capturePerformanceLogs.filter((entry) => {
    try {
      const envelope: unknown = JSON.parse(String(entry.message || ""));
      if (!isRecord(envelope) || !isRecord(envelope.message)) {
        return false;
      }
      const event = envelope.message;
      if (event.method !== "Network.requestWillBeSent" || !isRecord(event.params)) {
        return false;
      }
      const request = event.params.request;
      return isRecord(request)
        && String(request.url || "").startsWith("http://127.0.0.1:4319/");
    } catch {
      return false;
    }
  }).length;
  assert(
    acquisitionRequests === 0,
    `컷 캡처 단계에서 로컬 VOD acquisition이 ${acquisitionRequests}회 발생했습니다.`
  );
  const clipInitialState = await execute<{
    initialDisabled: boolean;
    manualFieldsEnabled: boolean;
  }>(`
    const first = document.querySelector(".clip-row");
    if (!(first instanceof HTMLElement)) throw new Error("초기 구간 행이 없습니다.");
    const remove = first.querySelector('[data-action="remove"]');
    const start = first.querySelector('[data-field="start"]');
    const end = first.querySelector('[data-field="end"]');
    if (
      !(remove instanceof HTMLButtonElement)
      || !(start instanceof HTMLInputElement)
      || !(end instanceof HTMLInputElement)
    ) {
      throw new Error("초기 구간 입력 요소가 없습니다.");
    }
    const initialDisabled = remove.disabled;
    start.value = "00:01:20.500";
    end.value = "00:01:35.000";
    end.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#add-clip")?.click();
    return {
      initialDisabled,
      manualFieldsEnabled: !start.disabled && !end.disabled
    };
  `);
  const clipAddedState = await waitFor(
    () => execute<{
      countAfterAdd: number;
      enabledAfterAdd: boolean;
    }>(`
      const rows = [...document.querySelectorAll(".clip-row")];
      return {
        countAfterAdd: rows.length,
        enabledAfterAdd: rows[0] instanceof HTMLElement
          && !rows[0].querySelector('[data-action="remove"]')?.disabled
      };
    `),
    (value) => value.countAfterAdd === 2,
    "빈 구간 추가 버튼이 두 번째 수동 입력 행을 만들지 못했습니다."
  );
  const clipFinalState = await execute<{
    finalCount: number;
    finalDisabled: boolean;
    bridgeConsoleAbsent: boolean;
    visibleShortcutHintsComplete: boolean;
    coverage: string;
  }>(`
    const rows = () => [...document.querySelectorAll(".clip-row")];
    const secondRemove = rows()[1]?.querySelector('[data-action="remove"]');
    if (!(secondRemove instanceof HTMLButtonElement)) {
      throw new Error("추가된 두 번째 구간의 삭제 버튼이 없습니다.");
    }
    secondRemove.click();
    const first = rows()[0];
    const visibleShortcutHintsComplete = ["Q", "A"]
      .every((key) => {
        const button = document.querySelector('[aria-keyshortcuts="' + key + '"]');
        if (!(button instanceof HTMLButtonElement) || !button.title.includes("단축키 " + key)) {
          return false;
        }
        const visibleKey = button.querySelector("kbd")?.textContent;
        return visibleKey === undefined;
      });
    return {
      finalCount: rows().length,
      finalDisabled: Boolean(first?.querySelector('[data-action="remove"]')?.disabled),
      bridgeConsoleAbsent: document.querySelector("#stream-cut-console") === null,
      visibleShortcutHintsComplete,
      coverage: first?.querySelector(".coverage")?.textContent || ""
    };
  `);
  const clipState = {
    ...clipInitialState,
    ...clipAddedState,
    ...clipFinalState
  };
  assert(
    clipState.countAfterAdd === 2
      && clipState.finalCount === 1
      && clipState.initialDisabled
      && clipState.manualFieldsEnabled
      && clipState.enabledAfterAdd
      && clipState.finalDisabled
      && clipState.bridgeConsoleAbsent
      && clipState.visibleShortcutHintsComplete,
    `구간 추가·삭제 상태가 올바르지 않습니다: ${JSON.stringify(clipState)}`
  );
  assert(
    clipState.coverage.includes("00:01:10.500 ~ 00:01:45")
      && clipState.coverage.includes("앞뒤 10초 포함"),
    `구간 ±10초 안내가 올바르지 않습니다: ${clipState.coverage}`
  );

  await execute(`
    globalThis.__kirinukiArchiveConfirmCalls = 0;
    globalThis.__kirinukiArchiveConfirmMessage = "";
    window.confirm = (message) => {
      globalThis.__kirinukiArchiveConfirmCalls += 1;
      globalThis.__kirinukiArchiveConfirmMessage = String(message);
      return true;
    };
    const input = document.querySelector("#session-archive-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("session archive input 없음");
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      [arguments[0]],
      "past-session.kirinuki-session.json",
      { type: "application/json" }
    ));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `, [sessionArchiveJson]);
  const importedArchive = await waitFor(
    () => execute<{
      sourceUrl: string;
      projectName: string;
      status: string;
      importDisabled: boolean;
      rowCount: number;
      finalizedCount: number;
      firstStart: string;
      firstEnd: string;
      lastStart: string;
      lastEnd: string;
      confirmCalls: number;
      confirmMessage: string;
    }>(`
      const rows = [...document.querySelectorAll(".clip-row")];
      return {
        sourceUrl: document.querySelector("#source-url")?.value || "",
        projectName: document.querySelector("#project-name")?.value || "",
        status: document.querySelector("#form-status")?.textContent || "",
        importDisabled: Boolean(document.querySelector("#import-session-archive")?.disabled),
        rowCount: rows.length,
        finalizedCount: rows.filter((row) => row.dataset.finalized === "true").length,
        firstStart: rows[0]?.querySelector('[data-field="start"]')?.value || "",
        firstEnd: rows[0]?.querySelector('[data-field="end"]')?.value || "",
        lastStart: rows.at(-1)?.querySelector('[data-field="start"]')?.value || "",
        lastEnd: rows.at(-1)?.querySelector('[data-field="end"]')?.value || "",
        confirmCalls: Number(globalThis.__kirinukiArchiveConfirmCalls),
        confirmMessage: String(globalThis.__kirinukiArchiveConfirmMessage || "")
      };
    `),
    (value) => (
      value.rowCount === 12
      && !value.importDisabled
      && value.status.includes("백업 파일에서 원본 링크와 12개 구간을 불러왔습니다")
      && value.status.includes("권리 확인은 다시 진행해 주세요")
    ),
    "브라우저 File 업로드로 복원 JSON을 불러오지 못했습니다."
  );
  assert(
    importedArchive.sourceUrl === chzzkUrl
      && importedArchive.projectName === "복원된 localhost-browser-smoke"
      && importedArchive.finalizedCount === 12
      && importedArchive.firstStart === "00:01:20.500"
      && importedArchive.firstEnd === "00:01:35"
      && importedArchive.lastStart === "00:07:00"
      && importedArchive.lastEnd === "00:07:12"
      && importedArchive.confirmCalls === 1
      && importedArchive.confirmMessage.includes("현재 입력을")
      && importedArchive.confirmMessage.includes("12개 구간"),
    `복원 JSON이 원본 링크·시작~끝 목록을 정확히 복원하지 못했습니다: ${JSON.stringify(importedArchive)}`
  );

  const layout = await execute<{
    viewportWidth: number;
    mainLeftGap: number;
    mainRightGap: number;
    rightHandRail: boolean;
    alignedTops: boolean;
    railScrollable: boolean;
    railScrolled: boolean;
    bridgeConsoleAbsent: boolean;
    timeInputCount: number;
    timesInside: boolean;
    timesUnclipped: boolean;
    horizontalOverflow: boolean;
  }>(`
    const main = document.querySelector("#local-app-surface");
    const workspace = document.querySelector(".source-capture-workspace");
    const stream = document.querySelector(".stream-preview");
    const rail = document.querySelector(".selection-rail");
    const list = document.querySelector("#clip-list");
    const bridgeConsole = document.querySelector("#stream-cut-console");
    const timeInputs = [...document.querySelectorAll(
      '.clip-row [data-field="start"], .clip-row [data-field="end"]'
    )];
    if (!main || !workspace || !stream || !rail || !list) {
      throw new Error("compact source workspace 요소 없음");
    }
    const mainRect = main.getBoundingClientRect();
    const streamRect = stream.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const inside = (outer, inner) => (
      inner.left >= outer.left - 1
      && inner.right <= outer.right + 1
      && inner.top >= outer.top - 1
      && inner.bottom <= outer.bottom + 1
    );
    const textFitsInput = (input) => {
      const style = getComputedStyle(input);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return false;
      context.font = style.font;
      const contentWidth = input.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight);
      return contentWidth >= context.measureText(input.value).width + 2;
    };
    list.scrollTop = list.scrollHeight;
    return {
      viewportWidth: document.documentElement.clientWidth,
      mainLeftGap: mainRect.left,
      mainRightGap: document.documentElement.clientWidth - mainRect.right,
      rightHandRail: railRect.left > streamRect.right,
      alignedTops: Math.abs(railRect.top - streamRect.top) <= 1,
      railScrollable: list.scrollHeight > list.clientHeight,
      railScrolled: list.scrollTop > 0,
      bridgeConsoleAbsent: bridgeConsole === null,
      timeInputCount: timeInputs.length,
      timesInside: timeInputs.every((input) => {
        const rect = input.getBoundingClientRect();
        return rect.left >= listRect.left - 1 && rect.right <= listRect.right + 1;
      }),
      timesUnclipped: timeInputs.every(textFitsInput),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || workspace.scrollWidth > workspace.clientWidth + 1
        || rail.scrollWidth > rail.clientWidth + 1
    };
  `);
  assert(
    layout.viewportWidth >= 1_500
      && layout.mainLeftGap <= 24
      && layout.mainRightGap <= 24
      && layout.rightHandRail
      && layout.alignedTops
      && layout.railScrollable
      && layout.railScrolled
      && layout.bridgeConsoleAbsent
      && layout.timeInputCount === 24
      && layout.timesInside
      && layout.timesUnclipped
      && !layout.horizontalOverflow,
    `넓은 PC 화면의 원본 미리보기·오른쪽 수동 구간 rail 배치가 깨졌습니다: ${JSON.stringify(layout)}`
  );

  const policyUi = await execute<{
    acknowledgementCount: number;
    legacyControlsPresent: boolean;
    privacyText: string;
    emailHref: string;
    openSourceText: string;
    githubHref: string;
  }>(`
    const trust = document.querySelector(".site-trust-notice");
    const github = document.querySelector(".github-link");
    return {
      acknowledgementCount: document.querySelectorAll("[data-ack]").length,
      legacyControlsPresent: Boolean(document.querySelector(
        '#confirmation-text, #evidence-fields, [name="basis"]'
      )),
      privacyText: trust?.textContent || "",
      emailHref: trust?.querySelector('a[href^="mailto:"]')?.getAttribute("href") || "",
      openSourceText: document.querySelector(".open-source-notice")?.textContent || "",
      githubHref: github instanceof HTMLAnchorElement ? github.href : ""
    };
  `);
  assert(
    policyUi.acknowledgementCount === 6
      && !policyUi.legacyControlsPresent
      && policyUi.privacyText.includes("사용기록과 개인정보를 일절 수집하지 않으며")
      && policyUi.emailHref === "mailto:lostfragment@naver.com"
      && policyUi.openSourceText.includes("이 프로젝트는 오픈소스입니다")
      && policyUi.githubHref === "https://github.com/studyreadbook4ever/KirinukiHelper",
    `간소화된 권리 확인·개인정보·오픈소스 안내가 올바르지 않습니다: ${JSON.stringify(policyUi)}`
  );

  await execute(`
    const rows = () => [...document.querySelectorAll(".clip-row")];
    while (rows().length > 1) {
      rows().at(-1).querySelector('[data-action="remove"]').click();
    }
    document.querySelector("#project-name").value = "localhost-browser-smoke";
    return rows().length;
  `);

  await execute(`
    const acknowledgements = [...document.querySelectorAll("[data-ack]")];
    acknowledgements.at(-1).checked = false;
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      bubbles: true
    }));
    return true;
  `);
  const rejected = await waitFor(
    () => execute<{ href: string; status: string; disabled: boolean }>(`
      return {
        href: location.href,
        status: document.querySelector("#form-status")?.textContent || "",
        disabled: Boolean(document.querySelector("#start-editor")?.disabled)
      };
    `),
    (value) => value.status.includes("필수 책임 확인 항목을 모두 선택"),
    "빠진 책임 확인 항목이 거절되지 않았습니다."
  );
  assert(rejected.href === `${studioOrigin}/`, "빠진 책임 확인 항목으로 편집기에 이동했습니다.");
  assert(rejected.disabled === false, "책임 확인 거절 뒤 시작 버튼이 복구되지 않았습니다.");

  // Automation stands in for the one local-network confirmation a real user
  // accepts before the installed engine is contacted. Chromium releases use
  // either the compatibility permission name or the loopback-specific name.
  const grantedLnaPermissions: string[] = [];
  const rejectedLnaPermissions: string[] = [];
  for (const permissionName of [
    "local-network-access",
    "loopback-network"
  ] as const) {
    try {
      await cdp("Browser.setPermission", {
        permission: { name: permissionName },
        setting: "granted",
        origin: studioOrigin
      });
      grantedLnaPermissions.push(permissionName);
    } catch (error) {
      rejectedLnaPermissions.push(
        `${permissionName}: ${errorMessage(error)}`
      );
    }
  }
  assert(
    grantedLnaPermissions.length >= 1,
    `Chrome가 local engine smoke용 LNA permission automation을 지원하지 않습니다: ${JSON.stringify(rejectedLnaPermissions)}`
  );

  const lateMaterializationFixture =
    await installLateMaterializationV2Fixture({
      sourceAUrl: chzzkUrl,
      sourceBUrl: transitionChzzkUrl
    });
  await cdp("Network.disable", {});
  await cdp("Network.enable", {});
  await cdp("Network.setBlockedURLs", {
    urls: liveEmbedSmoke
      ? []
      : externalEmbedPatterns.filter((pattern) => (
        pattern === "https://www.youtube.com/*"
      ))
  });
  const staleBrowserProject = staleMaterializedTimingProject(chzzkUrl);
  await execute(`
    const first = document.querySelector(".clip-row");
    if (!(first instanceof HTMLElement)) {
      throw new Error("timing regression 구간 행이 없습니다.");
    }
    first.dataset.selectionId = "stale-offset-browser-regression";
    return true;
  `);
  await execute(`
    const staleProject = arguments[0];
    globalThis.__kirinukiStaleProjectReady = false;
    globalThis.__kirinukiStaleProjectError = "";
    const open = indexedDB.open("chzzk-kirinuki-studio");
    open.onerror = () => {
      globalThis.__kirinukiStaleProjectError = String(open.error || "open failed");
    };
    open.onsuccess = () => {
      const database = open.result;
      let transaction;
      try {
        transaction = database.transaction("projects", "readwrite");
      } catch (error) {
        globalThis.__kirinukiStaleProjectError = String(error);
        database.close();
        return;
      }
      transaction.onerror = () => {
        globalThis.__kirinukiStaleProjectError = String(
          transaction.error || "transaction failed"
        );
      };
      transaction.oncomplete = () => {
        database.close();
        globalThis.__kirinukiStaleProjectReady = true;
      };
      transaction.objectStore("projects").put(staleProject);
    };
    return true;
  `, [staleBrowserProject]);
  const staleProjectSeed = await waitFor(
    () => execute<{ ready: boolean; error: string }>(`
      return {
        ready: globalThis.__kirinukiStaleProjectReady === true,
        error: String(globalThis.__kirinukiStaleProjectError || "")
      };
    `),
    (value) => value.ready || Boolean(value.error),
    "잔존 +10초 정렬값 browser fixture를 IndexedDB에 저장하지 못했습니다."
  );
  assert(
    staleProjectSeed.ready && !staleProjectSeed.error,
    `잔존 +10초 정렬값 browser fixture 저장 실패: ${staleProjectSeed.error}`
  );
  await execute(`
    localStorage.setItem(
      "kirinuki:local-web:latest-project",
      arguments[0]
    );
    const refresh = document.querySelector("#refresh-local-projects");
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error("브라우저 편집 목록 새로 읽기 버튼이 없습니다.");
    }
    refresh.click();
    return true;
  `, [staleBrowserProject.id]);
  await waitFor(
    () => execute<{
      status: string;
      listedProjectId: string;
      startLabel: string;
      sameSource: string;
    }>(`
      const row = document.querySelector(".local-project-row");
      return {
        status: document.querySelector("#form-status")?.textContent || "",
        listedProjectId: row?.getAttribute("data-project-id") || "",
        startLabel: document.querySelector("#start-editor")?.textContent || "",
        sameSource: row?.querySelector(".local-project-same-source")?.textContent || ""
      };
    `),
    (value) => (
      value.listedProjectId === staleBrowserProject.id
      && value.startLabel.includes("편집기 열기")
      && value.sameSource.includes("현재 입력한 VOD")
    ),
    "같은 VOD 저장본을 목록에 표시하면서 새 편집을 별도로 시작할 준비를 하지 못했습니다."
  );
  await execute(`
    for (const checkbox of document.querySelectorAll("[data-ack]")) checkbox.checked = true;
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      bubbles: true
    }));
    return true;
  `);
  const firstEditor = await waitFor(
    () => execute<{
      href: string;
      ready: string;
      gateHidden: boolean;
      shellHidden: boolean;
      projectName: string;
      clipTime: string;
      clipTimeCount: number;
      toast: string;
    }>(`
      return {
        href: location.href,
        ready: document.readyState,
        gateHidden: Boolean(document.querySelector("#editor-policy-gate")?.hidden),
        shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden),
        projectName: document.querySelector("#project-name")?.value || "",
        clipTime: document.querySelector(".clip-time")?.textContent || "",
        clipTimeCount: document.querySelectorAll(".clip-time").length,
        toast: document.querySelector("#toast")?.textContent || ""
      };
    `),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html?project=`)
      && value.gateHidden
      && !value.shellHidden
      && value.projectName === "localhost-browser-smoke"
      && value.clipTimeCount === 1
      && value.clipTime === "00:01:20.500 → 00:01:35.000"
    ),
    "정상 동의 뒤 localhost editor shell에 진입하지 못했습니다.",
    20_000
  );
  assert(
    !firstEditor.clipTime.includes("00:01:30.500")
      && !firstEditor.clipTime.includes("00:01:45.000"),
    `편집기에 +10초가 다시 더해졌습니다: ${firstEditor.clipTime}`
  );
  await captureLocalMediaEngineProtocolAttempt(debuggerAddress);
  assert(localMediaEngineFixture, "v2 local media engine fixture가 시작되지 않았습니다.");
  await enrollLocalMediaEngineFixture(localMediaEngineFixture);
  await webdriver("POST", `/session/${sessionId}/refresh`, {});
  await waitFor(
    () => execute<{
      href: string;
      gateHidden: boolean;
      shellHidden: boolean;
      projectName: string;
    }>(`
      return {
        href: location.href,
        gateHidden: Boolean(document.querySelector("#editor-policy-gate")?.hidden),
        shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden),
        projectName: document.querySelector("#project-name")?.value || ""
      };
    `),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html?project=`)
      && value.gateHidden
      && !value.shellHidden
      && value.projectName === "localhost-browser-smoke"
    ),
    "동일 public key pin 주입 뒤 editor reload가 기존 A 작업을 복원하지 못했습니다.",
    20_000
  );
  const firstTransitionProjectId = new URL(firstEditor.href)
    .searchParams.get("project") || "";
  const lateAStarted = await waitFor(
    async () => lateMaterializationFixture.snapshot(),
    (value) => (
      value.aStarted
      && value.aSourceUrl === chzzkUrl
      && value.aStatusPolls >= 1
      && value.aAbandonedJobsReclaimed === 0
      && !value.aRunnerAborted
    ),
    "A의 VOD materialization observer lease를 status poll로 시작하지 못했습니다.",
    15_000
  );
  const firstTransitionSession = await execute<{
    projectId: string;
    sourceSessionId: string;
    sessionLeaseId: string;
    transitionGeneration: number;
  }>(`
    const session = JSON.parse(sessionStorage.getItem(
      "kirinuki:local-web:active-usage-session"
    ) || "null");
    if (!session) throw new Error("첫 편집 세션 lease가 없습니다.");
    history.back();
    return {
      projectId: session.attestation?.target?.projectId || "",
      sourceSessionId: session.attestation?.target?.sourceSessionId || "",
      sessionLeaseId: session.sessionLeaseId || "",
      transitionGeneration: Number(session.transitionGeneration) || 0
    };
  `);
  assert(
    firstTransitionSession.projectId === firstTransitionProjectId
      && /^[a-f0-9]{64}$/u.test(firstTransitionSession.sessionLeaseId)
      && firstTransitionSession.transitionGeneration > 0,
    `첫 편집 세션 lease가 올바르지 않습니다: ${JSON.stringify(firstTransitionSession)}`
  );
  const returnedStart = await waitFor(
    () => execute<{
      href: string;
      startDisabled: boolean;
      startLabel: string;
    }>(`
      return {
        href: location.href,
        startDisabled: Boolean(document.querySelector("#start-editor")?.disabled),
        startLabel: document.querySelector("#start-editor")?.textContent || ""
      };
    `),
    (value) => (
      value.href === `${studioOrigin}/`
      && !value.startDisabled
    ),
    "A 편집기에서 뒤로 간 시작 화면이 새 작업을 받을 수 있게 복원되지 않았습니다."
  );
  await execute(`
    const source = document.querySelector("#source-url");
    if (!(source instanceof HTMLInputElement)) {
      throw new Error("A→B 전환의 원본 주소 입력을 찾지 못했습니다.");
    }
    source.value = arguments[0];
    source.dispatchEvent(new Event("input", { bubbles: true }));
    for (const checkbox of document.querySelectorAll("[data-ack]")) {
      checkbox.checked = true;
    }
    const start = document.querySelector("#start-editor");
    if (!(start instanceof HTMLButtonElement) || start.disabled) {
      throw new Error("A→B 전환의 새 편집 버튼을 누를 수 없습니다.");
    }
    start.click();
    return true;
  `, [transitionChzzkUrl]);
  const editor = await waitFor(
    () => execute<{
      href: string;
      ready: string;
      gateHidden: boolean;
      shellHidden: boolean;
      projectName: string;
      clipTime: string;
      clipTimeCount: number;
      toast: string;
    }>(`
      return {
        href: location.href,
        ready: document.readyState,
        gateHidden: Boolean(document.querySelector("#editor-policy-gate")?.hidden),
        shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden),
        projectName: document.querySelector("#project-name")?.value || "",
        clipTime: document.querySelector(".clip-time")?.textContent || "",
        clipTimeCount: document.querySelectorAll(".clip-time").length,
        toast: document.querySelector("#toast")?.textContent || ""
      };
    `),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html?project=`)
      && new URL(value.href).searchParams.get("project")
        !== firstTransitionProjectId
      && value.gateHidden
      && !value.shellHidden
      && value.projectName === "localhost-browser-smoke"
      && value.clipTimeCount === 1
      && value.clipTime === "00:01:20.500 → 00:01:35.000"
    ),
    "A를 뒤로 닫은 뒤 다른 VOD의 B 편집기를 독립 세대로 열지 못했습니다.",
    20_000
  );
  const secondTransitionSession = await execute<{
    projectId: string;
    sourceSessionId: string;
    sessionLeaseId: string;
    transitionGeneration: number;
  }>(`
    const session = JSON.parse(sessionStorage.getItem(
      "kirinuki:local-web:active-usage-session"
    ) || "null");
    if (!session) throw new Error("두 번째 편집 세션 lease가 없습니다.");
    return {
      projectId: session.attestation?.target?.projectId || "",
      sourceSessionId: session.attestation?.target?.sourceSessionId || "",
      sessionLeaseId: session.sessionLeaseId || "",
      transitionGeneration: Number(session.transitionGeneration) || 0
    };
  `);
  const freshProjectId = new URL(editor.href).searchParams.get("project") || "";
  assert(
    secondTransitionSession.projectId === freshProjectId
      && secondTransitionSession.sourceSessionId
        !== firstTransitionSession.sourceSessionId
      && secondTransitionSession.sourceSessionId.includes("14514981")
      && secondTransitionSession.sessionLeaseId
        !== firstTransitionSession.sessionLeaseId
      && secondTransitionSession.transitionGeneration
        === firstTransitionSession.transitionGeneration + 1,
    `A→B source+세대 전환이 원자적으로 바뀌지 않았습니다: ${JSON.stringify({ firstTransitionSession, secondTransitionSession })}`
  );
  assert(
    lateAStarted.aConsumerId === firstTransitionProjectId,
    `늦게 완료될 A artifact의 consumer가 A projectId와 다릅니다: ${JSON.stringify(lateAStarted)}`
  );
  assert(
    freshProjectId.startsWith("project-")
      && freshProjectId !== staleBrowserProject.id
      && freshProjectId !== firstTransitionProjectId,
    `저장본/A/다른 VOD B가 projectId를 공유했습니다: ${freshProjectId}`
  );
  const lateMaterializationAfterTransition = await waitFor(
    async () => lateMaterializationFixture.snapshot(),
    (value) => (
      value.aAbandonedJobsReclaimed === 1
      && value.aRunnerAborted
      && value.aRunnerSettled
      && value.aSlotReleased
      && value.aLateCompletionDiscarded
      && !value.aLateArtifactExposed
      && value.bStartRequests === 1
      && value.bQueuedBeforeReclaim
      && value.bStatusPolls >= 1
      && value.bStartedAfterReclaim
      && value.bCompleted
    ),
    "닫힌 A observer lease가 runner와 늦은 결과를 회수한 뒤 B에 queue slot을 넘기지 못했습니다.",
    15_000
  );
  const preparedB = await waitFor(
    async () => ({
      fixture: lateMaterializationFixture.snapshot(),
      ...(await execute<{
        mediaName: string;
        mediaMeta: string;
        toast: string;
      }>(`
        return {
          mediaName: document.querySelector("#media-name")?.textContent || "",
          mediaMeta: document.querySelector("#media-meta")?.textContent || "",
          toast: document.querySelector("#toast")?.textContent || ""
        };
      `))
    }),
    (value) => (
      value.fixture.bMediaRequests >= 1
      && value.mediaName === "치지직 편집 영상 준비됨"
      && value.mediaMeta.includes("구간 1개")
      && !value.toast.includes("VOD 편집 영상을 준비하지 못했습니다")
      && !value.toast.includes("자동으로 다시 연결하지 못했습니다")
    ),
    "A runner 회수 뒤 B가 로컬 MP4를 받아 편집기에 연결하지 못했습니다.",
    20_000
  );
  const editorChrome = await execute<{
    adWidth: number;
    adHeight: number;
    adChildCount: number;
    adFitsWorkspace: boolean;
    timelineStartsAfterAd: boolean;
    horizontalOverflow: boolean;
    brandPresent: boolean;
    semanticTitle: string;
    exportDialogOpen: boolean;
    focusedId: string;
    suggestedTitle: string;
    emptyTitleRejected: boolean;
    sanitizedPreview: string;
    validTitleAccepted: boolean;
  }>(`
    const ad = document.querySelector("#desktop-ad-slot");
    const workspace = document.querySelector(".workspace");
    const timeline = document.querySelector(".timeline-panel");
    const exportButton = document.querySelector("#export-video");
    if (!ad || !workspace || !timeline || !exportButton) {
      throw new Error("편집기 광고·내보내기 UI 요소가 없습니다.");
    }
    const adRect = ad.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    exportButton.disabled = false;
    exportButton.click();
    const dialog = document.querySelector("#export-options-dialog");
    const title = document.querySelector("#export-file-title");
    const preview = document.querySelector("#export-file-name-preview");
    const confirm = document.querySelector("#confirm-export-options");
    if (!dialog || !title || !preview || !confirm) {
      throw new Error("출력 영상 제목 대화상자 요소가 없습니다.");
    }
    const exportDialogOpen = dialog.open;
    const suggestedTitle = title.value;
    const focusedId = document.activeElement?.id || "";
    title.value = "";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const emptyTitleRejected = confirm.disabled && title.getAttribute("aria-invalid") === "true";
    title.value = "사용자 / 최종본";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const sanitizedPreview = preview.textContent || "";
    const validTitleAccepted = !confirm.disabled && title.getAttribute("aria-invalid") === "false";
    document.querySelector("#cancel-export-options")?.click();
    exportButton.disabled = true;
    return {
      adWidth: adRect.width,
      adHeight: adRect.height,
      adChildCount: ad.children.length,
      adFitsWorkspace: adRect.top >= workspaceRect.top - 1 && adRect.bottom <= workspaceRect.bottom + 1,
      timelineStartsAfterAd: Math.abs(timelineRect.left - workspaceRect.left - 160) <= 1,
      horizontalOverflow: workspace.scrollWidth > workspace.clientWidth + 1,
      brandPresent: Boolean(document.querySelector(".brand")),
      semanticTitle: document.querySelector(".topbar > h1")?.textContent?.trim() || "",
      exportDialogOpen,
      focusedId,
      suggestedTitle,
      emptyTitleRejected,
      sanitizedPreview,
      validTitleAccepted
    };
  `);
  assert(
    editorChrome.adWidth === 160
      && editorChrome.adHeight === 600
      && editorChrome.adChildCount === 0
      && editorChrome.adFitsWorkspace
      && editorChrome.timelineStartsAfterAd
      && !editorChrome.horizontalOverflow,
    `160×600 빈 광고 rail 레이아웃이 깨졌습니다: ${JSON.stringify(editorChrome)}`
  );
  assert(
    !editorChrome.brandPresent
      && editorChrome.semanticTitle === "Kirinuki 영상 편집기",
    `장식성 상단 브랜드를 의미 제목으로 교체하지 못했습니다: ${JSON.stringify(editorChrome)}`
  );
  assert(
    editorChrome.exportDialogOpen
      && editorChrome.focusedId === "export-file-title"
      && editorChrome.suggestedTitle === "localhost-browser-smoke"
      && editorChrome.emptyTitleRejected
      && editorChrome.validTitleAccepted
      && editorChrome.sanitizedPreview.includes("사용자 - 최종본"),
    `출력 영상 제목 입력·검증 흐름이 깨졌습니다: ${JSON.stringify(editorChrome)}`
  );
  await execute(`
    const open = document.querySelector("#open-short-form");
    if (!(open instanceof HTMLButtonElement) || open.disabled) {
      throw new Error("쇼츠 작업 동적 검증을 시작할 수 없습니다.");
    }
    open.click();
    return true;
  `);
  const initialShortWorkspace = await waitFor(
    () => execute<{
      activeId: string;
      count: number;
      name: string;
      workspace: string;
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        count: select instanceof HTMLSelectElement ? select.options.length : 0,
        name: document.querySelector("#short-workspace-name")?.value || "",
        workspace: document.querySelector("#editor-shell")?.dataset.workspace || ""
      };
    `),
    (value) => (
      value.workspace === "short-form"
      && value.count === 1
      && value.activeId === "shorts-1"
      && value.name === "쇼츠 1"
    ),
    "구형 단일 쇼츠가 브라우저에서 ‘쇼츠 1’로 열리지 않았습니다."
  );
  await execute(`
    document.querySelector("#create-short-workspace")?.click();
    return true;
  `);
  const createdShortWorkspace = await waitFor(
    () => execute<{ activeId: string; count: number }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        count: select instanceof HTMLSelectElement ? select.options.length : 0
      };
    `),
    (value) => (
      value.count === 2
      && Boolean(value.activeId)
      && value.activeId !== initialShortWorkspace.activeId
    ),
    "브라우저에서 독립 쇼츠 새 작업을 만들지 못했습니다."
  );
  await execute(`
    const name = document.querySelector("#short-workspace-name");
    if (!(name instanceof HTMLInputElement)) throw new Error("쇼츠 작업명 입력 없음");
    name.value = "브라우저 새 쇼츠";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#duplicate-short-workspace")?.click();
    return true;
  `);
  await waitFor(
    () => execute<{ activeId: string; count: number; labels: string[] }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        count: select instanceof HTMLSelectElement ? select.options.length : 0,
        labels: select instanceof HTMLSelectElement
          ? [...select.options].map((option) => option.textContent || "")
          : []
      };
    `),
    (value) => (
      value.count === 3
      && value.activeId !== createdShortWorkspace.activeId
      && value.labels.some((label) => label.includes("브라우저 새 쇼츠 복사본"))
    ),
    "브라우저에서 쇼츠 작업을 독립 ID로 복제하지 못했습니다."
  );
  await execute(`
    const select = document.querySelector("#short-workspace-select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("쇼츠 작업 선택기 없음");
    select.value = arguments[0];
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `, [createdShortWorkspace.activeId]);
  await waitFor(
    () => execute<{ activeId: string; urlId: string }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        urlId: new URL(location.href).searchParams.get("short") || ""
      };
    `),
    (value) => (
      value.activeId === createdShortWorkspace.activeId
      && value.urlId === createdShortWorkspace.activeId
    ),
    "쇼츠 작업 전환 identity가 selector와 URL에 함께 고정되지 않았습니다."
  );
  await execute(`
    window.confirm = () => true;
    document.querySelector("#delete-short-workspace")?.click();
    return true;
  `);
  const deletedShortWorkspace = await waitFor(
    () => execute<{ activeId: string; count: number; labels: string[] }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        count: select instanceof HTMLSelectElement ? select.options.length : 0,
        labels: select instanceof HTMLSelectElement
          ? [...select.options].map((option) => option.textContent || "")
          : []
      };
    `),
    (value) => (
      value.count === 2
      && value.activeId !== createdShortWorkspace.activeId
      && !value.labels.some((label) => (
        label.includes("브라우저 새 쇼츠") && !label.includes("복사본")
      ))
    ),
    "브라우저에서 확인 뒤 선택 쇼츠만 안전하게 삭제하지 못했습니다."
  );
  assert(
    deletedShortWorkspace.labels.some((label) => (
      label.includes("브라우저 새 쇼츠 복사본")
    )),
    `쇼츠 삭제가 형제 복제본까지 지웠습니다: ${JSON.stringify(deletedShortWorkspace)}`
  );
  await execute(`
    document.querySelector("#exit-short-form")?.click();
    return true;
  `);
  await waitFor(
    () => execute<string>(`
      return document.querySelector("#editor-shell")?.dataset.workspace || "";
    `),
    (value) => value === "main",
    "쇼츠 작업 동적 검증 뒤 본편으로 복귀하지 못했습니다."
  );
  await execute(`
    globalThis.__kirinukiTimingProjects = null;
    globalThis.__kirinukiTimingProjectError = "";
    const open = indexedDB.open("chzzk-kirinuki-studio");
    open.onerror = () => {
      globalThis.__kirinukiTimingProjectError = String(open.error || "open failed");
    };
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("projects", "readonly");
      const store = transaction.objectStore("projects");
      const firstRequest = store.get(arguments[0]);
      const freshRequest = store.get(arguments[1]);
      const cachedRequest = store.get(arguments[2]);
      firstRequest.onerror = () => {
        globalThis.__kirinukiTimingProjectError = String(
          firstRequest.error || "first project read failed"
        );
      };
      freshRequest.onerror = () => {
        globalThis.__kirinukiTimingProjectError = String(
          freshRequest.error || "fresh project read failed"
        );
      };
      cachedRequest.onerror = () => {
        globalThis.__kirinukiTimingProjectError = String(
          cachedRequest.error || "cached project read failed"
        );
      };
      transaction.oncomplete = () => {
        globalThis.__kirinukiTimingProjects = {
          first: firstRequest.result || null,
          fresh: freshRequest.result || null,
          cached: cachedRequest.result || null
        };
        database.close();
      };
    };
    return true;
  `, [firstTransitionProjectId, freshProjectId, staleBrowserProject.id]);
  type TimingSmokeProject = {
    id?: unknown;
    source?: { contentId?: unknown; canonicalUrl?: unknown };
    broadcastSession?: { alignmentOffsetMs?: unknown };
    clips?: Array<{
      id?: unknown;
      selectionId?: unknown;
      selectionStartMs?: unknown;
      selectionEndMs?: unknown;
      sourceStartMs?: unknown;
      sourceEndMs?: unknown;
    }>;
    mediaAsset?: null | {
      materialization?: {
        clipRanges?: Array<{
          sourceStartMs?: unknown;
          sourceEndMs?: unknown;
          editableSourceStartMs?: unknown;
          editableSourceEndMs?: unknown;
        }>;
        windows?: Array<{
          editableSourceStartMs?: unknown;
          editableSourceEndMs?: unknown;
          fetchedSourceStartMs?: unknown;
          fetchedSourceEndMs?: unknown;
        }>;
      };
    };
  };
  const storedTiming = await waitFor(
    () => execute<{
      projects: {
        first: TimingSmokeProject | null;
        fresh: TimingSmokeProject | null;
        cached: TimingSmokeProject | null;
      } | null;
      error: string;
    }>(`
      return {
        projects: globalThis.__kirinukiTimingProjects,
        error: String(globalThis.__kirinukiTimingProjectError || "")
      };
    `),
    (value) => Boolean(value.projects || value.error),
    "분리된 새 편집과 저장본을 IndexedDB에서 다시 읽지 못했습니다."
  );
  const firstProject = storedTiming.projects?.first;
  const freshProject = storedTiming.projects?.fresh;
  const freshClip = freshProject?.clips?.[0];
  const freshCoverage = freshProject?.mediaAsset?.materialization
    ?.clipRanges?.[0];
  const freshWindow = freshProject?.mediaAsset?.materialization
    ?.windows?.[0];
  const cachedProject = storedTiming.projects?.cached;
  const cachedClip = cachedProject?.clips?.[0];
  const cachedCoverage = cachedProject?.mediaAsset?.materialization
    ?.clipRanges?.[0];
  const cachedWindow = cachedProject?.mediaAsset?.materialization
    ?.windows?.[0];
  assert(
    firstProject == null
      || (
        firstProject.id === firstTransitionProjectId
        && firstProject.source?.contentId === "14514980"
        && firstProject.source.canonicalUrl === chzzkUrl
        && firstProject.mediaAsset === null
      ),
    `A의 늦은 로컬 엔진 완료 결과가 A 문서 또는 B 전환 중 잘못 부착됐습니다: ${JSON.stringify(storedTiming)}`
  );
  assert(
    !storedTiming.error
      && freshProject?.id === freshProjectId
      && freshProject.broadcastSession?.alignmentOffsetMs === 0
      && freshProject.source?.contentId === "14514981"
      && freshProject.source.canonicalUrl === transitionChzzkUrl
      && freshProject.clips?.length === 1
      && typeof freshClip?.id === "string"
      && freshClip.id !== "clip-stale-offset-browser-regression"
      && typeof freshClip.selectionId === "string"
      && freshClip.selectionId !== "stale-offset-browser-regression"
      && freshClip.selectionStartMs === 80_500
      && freshClip.selectionEndMs === 95_000
      && freshClip.sourceStartMs === 80_500
      && freshClip.sourceEndMs === 95_000
      && freshProject.mediaAsset?.materialization?.clipRanges?.length === 1
      && freshProject.mediaAsset.materialization.windows?.length === 1
      && freshCoverage?.sourceStartMs === 80_500
      && freshCoverage.sourceEndMs === 95_000
      && freshCoverage.editableSourceStartMs === 70_500
      && freshCoverage.editableSourceEndMs === 105_000
      && freshWindow?.editableSourceStartMs === 70_500
      && freshWindow.editableSourceEndMs === 105_000
      && freshWindow.fetchedSourceStartMs === 70_500
      && freshWindow.fetchedSourceEndMs === 105_000,
    `새 편집의 선택·표시 시간축에 저장본 정보가 섞였습니다: ${JSON.stringify(storedTiming)}`
  );
  assert(
    cachedProject?.id === staleBrowserProject.id
      && cachedProject.broadcastSession?.alignmentOffsetMs === 10_000
      && cachedProject.clips?.length === 1
      && cachedClip?.sourceStartMs === 90_500
      && cachedClip.sourceEndMs === 105_000
      && cachedClip.selectionStartMs === 80_500
      && cachedClip.selectionEndMs === 95_000
      && cachedCoverage?.sourceStartMs === 80_500
      && cachedCoverage.sourceEndMs === 95_000
      && cachedCoverage.editableSourceStartMs === 70_500
      && cachedCoverage.editableSourceEndMs === 105_000
      && cachedProject.mediaAsset?.materialization?.clipRanges?.length === 1
      && cachedProject.mediaAsset.materialization.windows?.length === 1
      && cachedWindow?.editableSourceStartMs === 70_500
      && cachedWindow.editableSourceEndMs === 105_000
      && cachedWindow.fetchedSourceStartMs === 70_500
      && cachedWindow.fetchedSourceEndMs === 105_000,
    `기존 저장본이 새 편집 시작 과정에서 변경됐습니다: ${JSON.stringify(storedTiming)}`
  );
  const lateMaterializationFinal = lateMaterializationFixture.snapshot();
  lateMaterializationFixture.assertHealthy();
  assert(
    lateMaterializationFinal.aConsumerId === firstTransitionProjectId
      && lateMaterializationFinal.pairedSessionCount === 2
      && lateMaterializationFinal.aStatusPolls >= 1
      && lateMaterializationFinal.aExplicitCancelRequests === 0
      && lateMaterializationFinal.aAbandonedJobsReclaimed === 1
      && lateMaterializationFinal.aRunnerAborted
      && lateMaterializationFinal.aRunnerSettled
      && lateMaterializationFinal.aSlotReleased
      && lateMaterializationFinal.aLateCompletionDiscarded
      && !lateMaterializationFinal.aLateArtifactExposed
      && lateMaterializationFinal.aCachePurgeRequests === 0
      && lateMaterializationFinal.aMediaRequests === 0
      && lateMaterializationFinal.bStartRequests === 1
      && lateMaterializationFinal.bQueuedBeforeReclaim
      && lateMaterializationFinal.bStatusPolls >= 1
      && lateMaterializationFinal.bStartedAfterReclaim
      && lateMaterializationFinal.bCompleted
      && lateMaterializationFinal.bMediaRequests >= 1
      && lateMaterializationFinal.unexpectedRequests.length === 0,
    `닫힌 A 작업 회수와 B 편집 영상 연결 계약이 깨졌습니다: ${JSON.stringify(lateMaterializationFinal)}`
  );
  await lateMaterializationFixture.close();
  await cdp("Network.setBlockedURLs", {
    urls: [
      gatewayPattern,
      ...(liveEmbedSmoke
        ? []
        : externalEmbedPatterns.filter((pattern) => (
          pattern === "https://www.youtube.com/*"
        )))
    ]
  });
  const postFixtureGatewayBlocked = await execute<boolean>(`
    return fetch("http://127.0.0.1:4319/v1/smoke-blocked-after-fixture", {
      cache: "no-store",
      credentials: "omit"
    }).then(() => false, () => true);
  `);
  assert(
    postFixtureGatewayBlocked,
    "late materialization fixture 종료 뒤 4319 gateway CDP 차단이 복원되지 않았습니다."
  );

  const saveAndExitActiveEditor = async (context: string) => {
    await waitFor(
      () => execute<boolean>(`
        const finish = document.querySelector("#finish-editing-session");
        return finish instanceof HTMLButtonElement
          && !finish.hidden
          && !finish.disabled;
      `),
      Boolean,
      `${context}: 현재 편집을 저장하고 끝낼 준비가 되지 않았습니다.`,
      20_000
    );
    await execute(`
      const finish = document.querySelector("#finish-editing-session");
      if (!(finish instanceof HTMLButtonElement) || finish.disabled) {
        throw new Error("편집 끝내기 버튼을 누를 수 없습니다.");
      }
      finish.click();
      return true;
    `);
    await waitFor(
      () => execute<boolean>(`
        const dialog = document.querySelector("#editing-session-exit-dialog");
        const save = document.querySelector("#save-and-exit-editing-session");
        return dialog instanceof HTMLDialogElement
          && dialog.open
          && save instanceof HTMLButtonElement
          && !save.disabled;
      `),
      Boolean,
      `${context}: 편집 종료 확인창이 열리지 않았습니다.`
    );
    await execute(`
      const save = document.querySelector("#save-and-exit-editing-session");
      if (!(save instanceof HTMLButtonElement) || save.disabled) {
        throw new Error("저장하고 나가기 버튼을 누를 수 없습니다.");
      }
      save.click();
      return true;
    `);
    return waitFor(
      () => execute<{
        href: string;
        managerReady: boolean;
      }>(`
        const manager = document.querySelector(".local-project-manager");
        return {
          href: location.href,
          managerReady: manager instanceof HTMLElement
            && manager.getAttribute("aria-busy") === "false"
        };
      `),
      (value) => value.href === `${studioOrigin}/` && value.managerReady,
      `${context}: 저장 확정 뒤 시작 화면으로 돌아오지 못했습니다.`,
      20_000
    );
  };

  const resumeSavedEditorProject = async (
    projectId: string,
    context: string
  ) => {
    await execute(`
      const refresh = document.querySelector("#refresh-local-projects");
      if (!(refresh instanceof HTMLButtonElement) || refresh.disabled) {
        throw new Error("브라우저 편집 목록 새로고침 버튼을 누를 수 없습니다.");
      }
      refresh.click();
      return true;
    `);
    await waitFor(
      () => execute<{
        found: boolean;
        disabled: boolean;
        busy: string;
      }>(`
        const row = document.querySelector(
          '.local-project-row[data-project-id="' + arguments[0] + '"]'
        );
        const button = row?.querySelector('[data-project-action="continue"]');
        const manager = document.querySelector(".local-project-manager");
        return {
          found: row instanceof HTMLElement,
          disabled: !(button instanceof HTMLButtonElement) || button.disabled,
          busy: manager?.getAttribute("aria-busy") || ""
        };
      `, [projectId]),
      (value) => value.found && !value.disabled && value.busy === "false",
      `${context}: 저장 프로젝트의 계속 편집 동작이 준비되지 않았습니다.`,
      20_000
    );
    await execute(`
      const row = document.querySelector(
        '.local-project-row[data-project-id="' + arguments[0] + '"]'
      );
      const button = row?.querySelector('[data-project-action="continue"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error("계속 편집 버튼을 누를 수 없습니다.");
      }
      button.click();
      return true;
    `, [projectId]);
    await waitFor(
      () => execute<{
        startLabel: string;
        startDisabled: boolean;
        acknowledgementCount: number;
      }>(`
        const start = document.querySelector("#start-editor");
        return {
          startLabel: start?.textContent || "",
          startDisabled: !(start instanceof HTMLButtonElement) || start.disabled,
          acknowledgementCount: document.querySelectorAll(
            "#policy-section [data-ack]"
          ).length
        };
      `),
      (value) => (
        value.startLabel.includes("편집기 열기")
        && !value.startDisabled
        && value.acknowledgementCount === 6
      ),
      `${context}: 저장 프로젝트의 이번 1회 사용자 확인을 열지 못했습니다.`
    );
    await execute(`
      for (const checkbox of document.querySelectorAll(
        "#policy-section [data-ack]"
      )) {
        if (!(checkbox instanceof HTMLInputElement)) {
          throw new Error("사용자 확인 체크박스 형식이 올바르지 않습니다.");
        }
        checkbox.checked = true;
      }
      const start = document.querySelector("#start-editor");
      if (!(start instanceof HTMLButtonElement) || start.disabled) {
        throw new Error("저장 프로젝트 편집기 열기 버튼을 누를 수 없습니다.");
      }
      start.click();
      return true;
    `);
    return waitFor(
      () => execute<{
        href: string;
        projectId: string;
        purpose: string;
        workspace: string;
        gateHidden: boolean;
        shellHidden: boolean;
      }>(`
        const url = new URL(location.href);
        const session = JSON.parse(sessionStorage.getItem(
          "kirinuki:local-web:active-usage-session"
        ) || "null");
        return {
          href: location.href,
          projectId: url.searchParams.get("project") || "",
          purpose: session?.attestation?.target?.purpose || "",
          workspace: document.querySelector("#editor-shell")?.dataset.workspace || "",
          gateHidden: Boolean(document.querySelector("#editor-policy-gate")?.hidden),
          shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden)
        };
      `),
      (value) => (
        value.projectId === projectId
        && value.purpose === "editor-resume"
        && value.workspace === "main"
        && value.gateHidden
        && !value.shellHidden
      ),
      `${context}: 새 editor-resume 세션으로 저장 프로젝트를 열지 못했습니다.`,
      20_000
    );
  };

  await saveAndExitActiveEditor("동적 fixture 설치 전 B 세션 종료");

  const deepEditorFixtureBase = createEditorProjectFromCapture({
    source: {
      platform: "CHZZK" as const,
      contentType: "vod" as const,
      contentId: "14514981",
      canonicalUrl: transitionChzzkUrl,
      url: transitionChzzkUrl,
      broadcastTitle: "동적 순서·쇼츠 격리 브라우저 스모크"
    },
    projectName: "동적 순서·쇼츠 격리 브라우저 스모크",
    segments: [
      {
        id: "order-a",
        startSeconds: 80.5,
        endSeconds: 95,
        description: "순서 A"
      },
      {
        id: "order-b",
        startSeconds: 100,
        endSeconds: 110,
        description: "순서 B"
      },
      {
        id: "order-c",
        startSeconds: 120,
        endSeconds: 130,
        description: "순서 C"
      }
    ]
  }, {
    id: freshProjectId,
    createdAt: "2026-08-15T00:00:00.000Z"
  });
  let layeredShortForm = deepEditorFixtureBase.shortForm;
  for (const [index, clip] of deepEditorFixtureBase.clips.entries()) {
    layeredShortForm = addShortFormVideoAsset(layeredShortForm, {
      id: `layer-${String.fromCharCode(97 + index)}`,
      sourceClipId: clip.id,
      sourceSelectionStartMs: clip.selectionStartMs,
      sourceSelectionEndMs: clip.selectionEndMs,
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: Math.min(clip.sourceEndMs, clip.sourceStartMs + 3_000),
      timelineStartMs: 0,
      timelineEndMs: 3_000,
      sourceRect: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        referenceWidth: 1_920,
        referenceHeight: 1_080
      },
      destinationRect: { x: 0, y: 0, width: 1_080, height: 1_920 }
    });
  }
  const layeredShortFormWorkspaces = saveActiveShortFormWorkspace(
    deepEditorFixtureBase.shortFormWorkspaces,
    deepEditorFixtureBase.shortForm,
    layeredShortForm,
    deepEditorFixtureBase.clips
  );
  const deepEditorFixture: EditorProject = {
    ...deepEditorFixtureBase,
    shortForm: layeredShortForm,
    shortFormWorkspaces: layeredShortFormWorkspaces,
    updatedAt: "2026-08-15T00:00:00.000Z"
  };
  await storeBrowserProject(deepEditorFixture);
  const firstDeepResume = await resumeSavedEditorProject(
    freshProjectId,
    "3컷 동적 순서 fixture 최초 열기"
  );
  const deepEditorReady = await waitFor(
    () => execute<{
      href: string;
      workspace: string;
      projectName: string;
      clipIds: string[];
      gateHidden: boolean;
      shellHidden: boolean;
    }>(`
      return {
        href: location.href,
        workspace: document.querySelector("#editor-shell")?.dataset.workspace || "",
        projectName: document.querySelector("#project-name")?.value || "",
        clipIds: [...document.querySelectorAll(".clip-item")]
          .map((item) => item.dataset.id || ""),
        gateHidden: Boolean(document.querySelector("#editor-policy-gate")?.hidden),
        shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden)
      };
    `),
    (value) => (
      new URL(value.href).searchParams.get("project") === freshProjectId
      && value.workspace === "main"
      && value.projectName === "동적 순서·쇼츠 격리 브라우저 스모크"
      && value.clipIds.join(",") === "clip-order-a,clip-order-b,clip-order-c"
      && value.gateHidden
      && !value.shellHidden
    ),
    "3컷 동적 순서 fixture를 현재 B 세션으로 다시 열지 못했습니다.",
    20_000
  );
  const longFormOrderJourney = await execute<{
    initial: string[];
    afterFirst: string[];
    afterDown: string[];
    afterLast: string[];
    afterUp: string[];
    afterUndo: string[];
    afterRedo: string[];
    firstBoundaryDisabled: boolean;
    lastBoundaryDisabled: boolean;
  }>(`
    const order = () => [...document.querySelectorAll(".clip-item")]
      .map((item) => item.dataset.id || "");
    const move = (clipId, action) => {
      const button = document.querySelector(
        '.clip-item[data-id="' + clipId + '"] [data-action="' + action + '"]'
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error(clipId + " " + action + " 순서 버튼을 누를 수 없습니다.");
      }
      button.click();
      return order();
    };
    const initial = order();
    const afterFirst = move("clip-order-c", "first");
    const afterDown = move("clip-order-c", "down");
    const afterLast = move("clip-order-a", "last");
    const afterUp = move("clip-order-a", "up");
    const undo = document.querySelector("#undo");
    if (!(undo instanceof HTMLButtonElement) || undo.disabled) {
      throw new Error("본편 순서 실행 취소 버튼을 누를 수 없습니다.");
    }
    undo.click();
    const afterUndo = order();
    const redo = document.querySelector("#redo");
    if (!(redo instanceof HTMLButtonElement) || redo.disabled) {
      throw new Error("본편 순서 다시 실행 버튼을 누를 수 없습니다.");
    }
    redo.click();
    const afterRedo = order();
    const first = document.querySelector('.clip-item[data-id="clip-order-c"]');
    const last = document.querySelector('.clip-item[data-id="clip-order-b"]');
    return {
      initial,
      afterFirst,
      afterDown,
      afterLast,
      afterUp,
      afterUndo,
      afterRedo,
      firstBoundaryDisabled: Boolean(
        first?.querySelector('[data-action="first"]')?.disabled
        && first?.querySelector('[data-action="up"]')?.disabled
      ),
      lastBoundaryDisabled: Boolean(
        last?.querySelector('[data-action="down"]')?.disabled
        && last?.querySelector('[data-action="last"]')?.disabled
      )
    };
  `);
  assert(
    longFormOrderJourney.initial.join(",") === "clip-order-a,clip-order-b,clip-order-c"
      && longFormOrderJourney.afterFirst.join(",") === "clip-order-c,clip-order-a,clip-order-b"
      && longFormOrderJourney.afterDown.join(",") === "clip-order-a,clip-order-c,clip-order-b"
      && longFormOrderJourney.afterLast.join(",") === "clip-order-c,clip-order-b,clip-order-a"
      && longFormOrderJourney.afterUp.join(",") === "clip-order-c,clip-order-a,clip-order-b"
      && longFormOrderJourney.afterUndo.join(",") === "clip-order-c,clip-order-b,clip-order-a"
      && longFormOrderJourney.afterRedo.join(",") === "clip-order-c,clip-order-a,clip-order-b"
      && longFormOrderJourney.firstBoundaryDisabled
      && longFormOrderJourney.lastBoundaryDisabled,
    `본편 3컷의 맨 처음·위·아래·맨 마지막과 undo/redo가 올바르지 않습니다: ${JSON.stringify(longFormOrderJourney)}`
  );
  await waitFor(
    () => execute<string>(`
      return document.querySelector("#local-draft-status")?.dataset.state || "";
    `),
    (value) => value === "saved",
    "본편 순서 변경이 브라우저 저장 완료 상태가 되지 않았습니다."
  );
  const persistedLongForm = await waitFor(
    () => readBrowserProject(freshProjectId),
    (value) => value?.clips.map(({ id }) => id).join(",")
      === "clip-order-c,clip-order-a,clip-order-b",
    "본편 순서 redo 결과가 IndexedDB에 영속화되지 않았습니다."
  );
  assert(
    persistedLongForm?.selectedClipId === "clip-order-a",
    `본편 컷 순서 이동 뒤 선택 identity가 보존되지 않았습니다: ${persistedLongForm?.selectedClipId}`
  );
  await saveAndExitActiveEditor("본편 3컷 순서 영속 재진입");
  const longFormResume = await resumeSavedEditorProject(
    freshProjectId,
    "본편 3컷 순서 영속 재진입"
  );
  const reloadedLongFormOrder = await waitFor(
    () => execute<{ workspace: string; clipIds: string[] }>(`
      return {
        workspace: document.querySelector("#editor-shell")?.dataset.workspace || "",
        clipIds: [...document.querySelectorAll(".clip-item")]
          .map((item) => item.dataset.id || "")
      };
    `),
    (value) => (
      value.workspace === "main"
      && value.clipIds.join(",") === "clip-order-c,clip-order-a,clip-order-b"
    ),
    "본편 3컷 순서가 editor reload 뒤 복원되지 않았습니다.",
    20_000
  );

  await waitFor(
    () => execute<boolean>(`
      const button = document.querySelector("#open-short-form");
      return button instanceof HTMLButtonElement && !button.disabled;
    `),
    Boolean,
    "쇼츠 격리 동적 검증을 시작할 수 없습니다.",
    20_000
  );
  await execute(`
    document.querySelector("#open-short-form")?.click();
    return true;
  `);
  const shortWorkspaceA = await waitFor(
    () => execute<{
      activeId: string;
      count: number;
      workspace: string;
      layerIds: string[];
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        count: select instanceof HTMLSelectElement ? select.options.length : 0,
        workspace: document.querySelector("#editor-shell")?.dataset.workspace || "",
        layerIds: [...document.querySelectorAll(".short-video-layer-item")]
          .map((item) => item.dataset.layerId || "")
      };
    `),
    (value) => (
      value.workspace === "short-form"
      && value.activeId === "shorts-1"
      && value.count === 1
      && value.layerIds.join(",") === "layer-c,layer-b,layer-a"
    ),
    "A 쇼츠 작업의 겹침 레이어 fixture를 열지 못했습니다.",
    20_000
  );
  await execute(`
    const name = document.querySelector("#short-workspace-name");
    if (!(name instanceof HTMLInputElement)) throw new Error("A 쇼츠 작업명 입력 없음");
    name.value = "브라우저 A 작업";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
  const shortLayerOrderJourney = await execute<{
    initial: string[];
    afterBack: string[];
    afterFront: string[];
    afterForward: string[];
    afterBackward: string[];
  }>(`
    const order = () => [...document.querySelectorAll(".short-video-layer-item")]
      .map((item) => item.dataset.layerId || "");
    const move = (layerId, action) => {
      const button = document.querySelector(
        '#short-video-layer-list button[data-layer-id="' + layerId
        + '"][data-short-layer-order="' + action + '"]'
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error(layerId + " " + action + " 겹침 순서 버튼을 누를 수 없습니다.");
      }
      button.click();
      return order();
    };
    const initial = order();
    const afterBack = move("layer-c", "back");
    const afterFront = move("layer-c", "front");
    const afterForward = move("layer-b", "forward");
    const afterBackward = move("layer-c", "backward");
    return { initial, afterBack, afterFront, afterForward, afterBackward };
  `);
  assert(
    shortLayerOrderJourney.initial.join(",") === "layer-c,layer-b,layer-a"
      && shortLayerOrderJourney.afterBack.join(",") === "layer-b,layer-a,layer-c"
      && shortLayerOrderJourney.afterFront.join(",") === "layer-c,layer-b,layer-a"
      && shortLayerOrderJourney.afterForward.join(",") === "layer-b,layer-c,layer-a"
      && shortLayerOrderJourney.afterBackward.join(",") === "layer-b,layer-a,layer-c",
    `쇼츠 3레이어의 맨 위·위·아래·맨 아래 순서가 올바르지 않습니다: ${JSON.stringify(shortLayerOrderJourney)}`
  );
  const authoredWorkspaceA = await execute<{
    cueText: string;
    cueCount: number;
    layerIds: string[];
  }>(`
    const add = document.querySelector("#add-cue");
    if (!(add instanceof HTMLButtonElement) || add.disabled) {
      throw new Error("A 쇼츠 자막 추가 버튼을 누를 수 없습니다.");
    }
    add.click();
    const input = document.querySelector("#cue-text");
    if (!(input instanceof HTMLTextAreaElement)) throw new Error("A 쇼츠 자막 입력 없음");
    input.value = "A 전용 자막";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
    return {
      cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
      cueCount: document.querySelectorAll("#cue-list .cue-list-item").length,
      layerIds: [...document.querySelectorAll(".short-video-layer-item")]
        .map((item) => item.dataset.layerId || "")
    };
  `);
  assert(
    authoredWorkspaceA.cueText === "A 전용 자막"
      && authoredWorkspaceA.cueCount === 1
      && authoredWorkspaceA.layerIds.join(",") === "layer-b,layer-a,layer-c",
    `A 쇼츠의 영상·자막 상태가 함께 저장되지 않았습니다: ${JSON.stringify(authoredWorkspaceA)}`
  );
  await execute(`
    document.querySelector("#create-short-workspace")?.click();
    return true;
  `);
  const shortWorkspaceB = await waitFor(
    () => execute<{
      activeId: string;
      count: number;
      selectDisabled: boolean;
      videoCount: number;
      cueCount: number;
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        count: select instanceof HTMLSelectElement ? select.options.length : 0,
        selectDisabled: select instanceof HTMLSelectElement && select.disabled,
        videoCount: document.querySelectorAll(".short-video-layer-item").length,
        cueCount: document.querySelectorAll("#cue-list .cue-list-item").length
      };
    `),
    (value) => (
      value.count === 2
      && Boolean(value.activeId)
      && value.activeId !== shortWorkspaceA.activeId
      && !value.selectDisabled
      && value.videoCount === 0
      && value.cueCount === 0
    ),
    "비어 있는 독립 B 쇼츠 작업을 만들지 못했습니다."
  );
  const authoredWorkspaceB = await execute<{
    cueText: string;
    cueCount: number;
    videoCount: number;
  }>(`
    const name = document.querySelector("#short-workspace-name");
    if (!(name instanceof HTMLInputElement)) throw new Error("B 쇼츠 작업명 입력 없음");
    name.value = "브라우저 B 작업";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    const add = document.querySelector("#add-cue");
    if (!(add instanceof HTMLButtonElement) || add.disabled) {
      throw new Error("B 쇼츠 자막 추가 버튼을 누를 수 없습니다.");
    }
    add.click();
    const input = document.querySelector("#cue-text");
    if (!(input instanceof HTMLTextAreaElement)) throw new Error("B 쇼츠 자막 입력 없음");
    input.value = "B 전용 자막";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
    return {
      cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
      cueCount: document.querySelectorAll("#cue-list .cue-list-item").length,
      videoCount: document.querySelectorAll(".short-video-layer-item").length
    };
  `);
  assert(
    authoredWorkspaceB.cueText === "B 전용 자막"
      && authoredWorkspaceB.cueCount === 1
      && authoredWorkspaceB.videoCount === 0,
    `B 쇼츠의 독립 자막·빈 영상 상태가 올바르지 않습니다: ${JSON.stringify(authoredWorkspaceB)}`
  );
  const workspaceBUndoState = await execute<{
    cueText: string;
    redoEnabled: boolean;
    videoCount: number;
  }>(`
    const undo = document.querySelector("#undo");
    if (!(undo instanceof HTMLButtonElement) || undo.disabled) {
      throw new Error("B 쇼츠 history를 실행 취소할 수 없습니다.");
    }
    undo.click();
    const redo = document.querySelector("#redo");
    return {
      cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
      redoEnabled: redo instanceof HTMLButtonElement && !redo.disabled,
      videoCount: document.querySelectorAll(".short-video-layer-item").length
    };
  `);
  assert(
    workspaceBUndoState.cueText === "새 자막"
      && workspaceBUndoState.redoEnabled
      && workspaceBUndoState.videoCount === 0,
    `B 쇼츠의 독립 undo 상태가 올바르지 않습니다: ${JSON.stringify(workspaceBUndoState)}`
  );
  await execute(`
    const select = document.querySelector("#short-workspace-select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("쇼츠 작업 선택기 없음");
    select.value = arguments[0];
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `, [shortWorkspaceA.activeId]);
  await waitFor(
    () => execute<{
      activeId: string;
      selectDisabled: boolean;
      cueText: string;
      layerIds: string[];
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        selectDisabled: select instanceof HTMLSelectElement && select.disabled,
        cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
        layerIds: [...document.querySelectorAll(".short-video-layer-item")]
          .map((item) => item.dataset.layerId || "")
      };
    `),
    (value) => (
      value.activeId === shortWorkspaceA.activeId
      && !value.selectDisabled
      && value.cueText === "A 전용 자막"
      && value.layerIds.join(",") === "layer-b,layer-a,layer-c"
    ),
    "B history를 남긴 채 A 쇼츠 상태로 독립 전환하지 못했습니다."
  );
  const workspaceAHistoryState = await execute<{
    afterUndo: string;
    afterRedo: string;
    layerIds: string[];
  }>(`
    const undo = document.querySelector("#undo");
    if (!(undo instanceof HTMLButtonElement) || undo.disabled) {
      throw new Error("A 쇼츠 history를 실행 취소할 수 없습니다.");
    }
    undo.click();
    const afterUndo = document.querySelector("#cue-list .cue-list-item span")?.textContent || "";
    const redo = document.querySelector("#redo");
    if (!(redo instanceof HTMLButtonElement) || redo.disabled) {
      throw new Error("A 쇼츠 history를 다시 실행할 수 없습니다.");
    }
    redo.click();
    return {
      afterUndo,
      afterRedo: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
      layerIds: [...document.querySelectorAll(".short-video-layer-item")]
        .map((item) => item.dataset.layerId || "")
    };
  `);
  assert(
    workspaceAHistoryState.afterUndo === "새 자막"
      && workspaceAHistoryState.afterRedo === "A 전용 자막"
      && workspaceAHistoryState.layerIds.join(",") === "layer-b,layer-a,layer-c",
    `A 쇼츠 undo/redo가 B 또는 영상 순서를 바꿨습니다: ${JSON.stringify(workspaceAHistoryState)}`
  );
  await execute(`
    const select = document.querySelector("#short-workspace-select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("쇼츠 작업 선택기 없음");
    select.value = arguments[0];
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `, [shortWorkspaceB.activeId]);
  const restoredWorkspaceBHistory = await waitFor(
    () => execute<{
      activeId: string;
      selectDisabled: boolean;
      cueText: string;
      redoEnabled: boolean;
      videoCount: number;
    }>(`
      const select = document.querySelector("#short-workspace-select");
      const redo = document.querySelector("#redo");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        selectDisabled: select instanceof HTMLSelectElement && select.disabled,
        cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
        redoEnabled: redo instanceof HTMLButtonElement && !redo.disabled,
        videoCount: document.querySelectorAll(".short-video-layer-item").length
      };
    `),
    (value) => (
      value.activeId === shortWorkspaceB.activeId
      && !value.selectDisabled
      && value.cueText === "새 자막"
      && value.redoEnabled
      && value.videoCount === 0
    ),
    "A history를 사용한 뒤 B의 독립 redo stack이 보존되지 않았습니다."
  );
  const workspaceBRedoState = await execute<{
    cueText: string;
    videoCount: number;
  }>(`
    const redo = document.querySelector("#redo");
    if (!(redo instanceof HTMLButtonElement) || redo.disabled) {
      throw new Error("보존된 B 쇼츠 redo를 실행할 수 없습니다.");
    }
    redo.click();
    return {
      cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
      videoCount: document.querySelectorAll(".short-video-layer-item").length
    };
  `);
  assert(
    workspaceBRedoState.cueText === "B 전용 자막"
      && workspaceBRedoState.videoCount === 0,
    `B 쇼츠 redo가 자기 자막만 복원하지 못했습니다: ${JSON.stringify(workspaceBRedoState)}`
  );
  await waitFor(
    () => execute<string>(`
      return document.querySelector("#local-draft-status")?.dataset.state || "";
    `),
    (value) => value === "saved",
    "A/B 쇼츠 격리 상태가 브라우저 저장 완료가 되지 않았습니다."
  );
  const persistedShortWorkspaces = await waitFor(
    () => readBrowserProject(freshProjectId),
    (value) => {
      const collection = value?.shortFormWorkspaces;
      const workspaceA = collection?.workspaces.find(({ id }) => (
        id === shortWorkspaceA.activeId
      ));
      const workspaceB = collection?.workspaces.find(({ id }) => (
        id === shortWorkspaceB.activeId
      ));
      const frontToBackA = [...(workspaceA?.shortForm.videoAssets || [])]
        .sort((left, right) => right.zIndex - left.zIndex)
        .map(({ id }) => id)
        .join(",");
      return collection?.activeWorkspaceId === shortWorkspaceB.activeId
        && collection.workspaces.length === 2
        && workspaceA?.name === "브라우저 A 작업"
        && workspaceA.shortForm.subtitles[0]?.text === "A 전용 자막"
        && frontToBackA === "layer-b,layer-a,layer-c"
        && workspaceB?.name === "브라우저 B 작업"
        && workspaceB.shortForm.videoAssets.length === 0
        && workspaceB.shortForm.subtitles[0]?.text === "B 전용 자막";
    },
    "서로 다른 A/B 쇼츠 영상·자막이 IndexedDB에서 섞였습니다."
  );
  const persistedWorkspaceA = persistedShortWorkspaces?.shortFormWorkspaces.workspaces
    .find(({ id }) => id === shortWorkspaceA.activeId);
  const persistedWorkspaceB = persistedShortWorkspaces?.shortFormWorkspaces.workspaces
    .find(({ id }) => id === shortWorkspaceB.activeId);
  assert(
    persistedWorkspaceA
      && persistedWorkspaceB
      && new Set([
        ...persistedWorkspaceA.shortForm.videoAssets.map(({ id }) => id),
        ...persistedWorkspaceB.shortForm.videoAssets.map(({ id }) => id),
        ...persistedWorkspaceA.shortForm.subtitles.map(({ id }) => id),
        ...persistedWorkspaceB.shortForm.subtitles.map(({ id }) => id)
      ]).size === (
        persistedWorkspaceA.shortForm.videoAssets.length
        + persistedWorkspaceB.shortForm.videoAssets.length
        + persistedWorkspaceA.shortForm.subtitles.length
        + persistedWorkspaceB.shortForm.subtitles.length
      ),
    "A/B 쇼츠의 영상·자막 durable identity가 충돌했습니다."
  );
  await saveAndExitActiveEditor("B 쇼츠 영속 재진입");
  const workspaceBResume = await resumeSavedEditorProject(
    freshProjectId,
    "B 쇼츠 영속 재진입"
  );
  await execute(`
    const open = document.querySelector("#open-short-form");
    if (!(open instanceof HTMLButtonElement) || open.disabled) {
      throw new Error("B 쇼츠 영속 재진입 버튼을 누를 수 없습니다.");
    }
    open.click();
    return true;
  `);
  const reloadedWorkspaceB = await waitFor(
    () => execute<{
      activeId: string;
      optionCount: number;
      urlId: string;
      cueText: string;
      videoCount: number;
      workspace: string;
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        optionCount: select instanceof HTMLSelectElement ? select.options.length : 0,
        urlId: new URL(location.href).searchParams.get("short") || "",
        cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
        videoCount: document.querySelectorAll(".short-video-layer-item").length,
        workspace: document.querySelector("#editor-shell")?.dataset.workspace || ""
      };
    `),
    (value) => (
      value.workspace === "short-form"
      && value.activeId === shortWorkspaceB.activeId
      && value.urlId === shortWorkspaceB.activeId
      && value.optionCount === 2
      && value.cueText === "B 전용 자막"
      && value.videoCount === 0
    ),
    "B 쇼츠의 URL identity·자막·빈 영상 상태가 reload 뒤 복원되지 않았습니다.",
    20_000
  );
  await execute(`
    const select = document.querySelector("#short-workspace-select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("쇼츠 작업 선택기 없음");
    select.value = arguments[0];
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `, [shortWorkspaceA.activeId]);
  const reloadedWorkspaceAAfterSwitch = await waitFor(
    () => execute<{
      activeId: string;
      selectDisabled: boolean;
      cueText: string;
      layerIds: string[];
      urlId: string;
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        selectDisabled: select instanceof HTMLSelectElement && select.disabled,
        cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
        layerIds: [...document.querySelectorAll(".short-video-layer-item")]
          .map((item) => item.dataset.layerId || ""),
        urlId: new URL(location.href).searchParams.get("short") || ""
      };
    `),
    (value) => (
      value.activeId === shortWorkspaceA.activeId
      && !value.selectDisabled
      && value.urlId === shortWorkspaceA.activeId
      && value.cueText === "A 전용 자막"
      && value.layerIds.join(",") === "layer-b,layer-a,layer-c"
    ),
    "B reload 뒤 A 쇼츠로 전환했을 때 영상·자막이 섞였습니다."
  );
  await saveAndExitActiveEditor("A 쇼츠 영속 재진입");
  const workspaceAResume = await resumeSavedEditorProject(
    freshProjectId,
    "A 쇼츠 영속 재진입"
  );
  await execute(`
    const open = document.querySelector("#open-short-form");
    if (!(open instanceof HTMLButtonElement) || open.disabled) {
      throw new Error("A 쇼츠 영속 재진입 버튼을 누를 수 없습니다.");
    }
    open.click();
    return true;
  `);
  const reloadedWorkspaceA = await waitFor(
    () => execute<{
      activeId: string;
      urlId: string;
      cueText: string;
      layerIds: string[];
      optionCount: number;
    }>(`
      const select = document.querySelector("#short-workspace-select");
      return {
        activeId: select instanceof HTMLSelectElement ? select.value : "",
        urlId: new URL(location.href).searchParams.get("short") || "",
        cueText: document.querySelector("#cue-list .cue-list-item span")?.textContent || "",
        layerIds: [...document.querySelectorAll(".short-video-layer-item")]
          .map((item) => item.dataset.layerId || ""),
        optionCount: select instanceof HTMLSelectElement ? select.options.length : 0
      };
    `),
    (value) => (
      value.activeId === shortWorkspaceA.activeId
      && value.urlId === shortWorkspaceA.activeId
      && value.cueText === "A 전용 자막"
      && value.layerIds.join(",") === "layer-b,layer-a,layer-c"
      && value.optionCount === 2
    ),
    "A 쇼츠 영상·자막·URL identity가 두 번째 reload 뒤 복원되지 않았습니다.",
    20_000
  );
  const deepWorkspaceJourney = {
    editorReady: deepEditorReady,
    resumeSessions: {
      first: firstDeepResume,
      longForm: longFormResume,
      workspaceB: workspaceBResume,
      workspaceA: workspaceAResume
    },
    longForm: {
      ...longFormOrderJourney,
      reloaded: reloadedLongFormOrder.clipIds
    },
    shortLayers: shortLayerOrderJourney,
    workspaces: {
      aId: shortWorkspaceA.activeId,
      bId: shortWorkspaceB.activeId,
      bUndo: workspaceBUndoState,
      aHistory: workspaceAHistoryState,
      bHistoryRestored: restoredWorkspaceBHistory,
      bRedo: workspaceBRedoState,
      bReload: reloadedWorkspaceB,
      aAfterBReload: reloadedWorkspaceAAfterSwitch,
      aReload: reloadedWorkspaceA
    }
  };
  await webdriver<BrowserLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "browser" }
  );
  const performanceLogs = await webdriver<BrowserLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  const performanceEvents = performanceLogs.flatMap((entry) => {
    try {
      const envelope: unknown = JSON.parse(String(entry.message || ""));
      return isRecord(envelope) && isRecord(envelope.message)
        ? [envelope.message]
        : [];
    } catch {
      return [];
    }
  });
  const gatewayRequestIds = new Set(performanceEvents.flatMap((event) => {
    if (event.method !== "Network.requestWillBeSent" || !isRecord(event.params)) {
      return [];
    }
    const request = event.params.request;
    const requestId = String(event.params.requestId || "");
    return isRecord(request)
      && String(request.url || "").startsWith("http://127.0.0.1:4319/")
      && requestId
      ? [requestId]
      : [];
  }));
  const blockedGatewayLog = performanceEvents.find((event) => {
    if (event.method !== "Network.loadingFailed" || !isRecord(event.params)) {
      return false;
    }
    return gatewayRequestIds.has(String(event.params.requestId || ""))
      && (
        event.params.blockedReason === "inspector"
        || String(event.params.errorText || "").includes("ERR_BLOCKED_BY_CLIENT")
      );
  });
  assert(
    blockedGatewayLog,
    "CDP가 4319 gateway 요청을 외부 materialization 전에 차단했다는 로그가 없습니다."
  );

  await execute(`
    const button = document.querySelector("#close-completed-editor");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("완료된 편집기 종료 버튼이 없습니다.");
    }
    button.click();
    return true;
  `);
  const completedEditorExit = await waitFor(
    () => execute<{ href: string; ready: string }>(`
      return { href: location.href, ready: document.readyState };
    `),
    (value) => (
      value.href === `${studioOrigin}/`
      && (value.ready === "interactive" || value.ready === "complete")
    ),
    "완료된 localhost 편집기가 브라우저 닫기에 기대지 않고 시작 화면으로 돌아가지 못했습니다."
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    server: serverMode,
    runtime: "localhost-web",
    browserExtension: "not-loaded",
    gateway4319: "signed-v2-fixture-during-transition-otherwise-blocked",
    externalEmbedMode: liveEmbedSmoke ? "live" : "dom-only",
    iframe: {
      CHZZK: { url: chzzkUrl, ...chzzkFrame },
      YOUTUBE: { url: youtubeEmbed, ...youtubeFrame },
      SOOP: { url: soopEmbed, ...soopFrame }
    },
    playerBridge: "removed-manual-time-input-only",
    sourceFallback: openedSource,
    clipCoverage: clipState.coverage,
    sessionArchiveImport: {
      sourceUrl: importedArchive.sourceUrl,
      segmentCount: importedArchive.rowCount,
      integrity: "browser-verified"
    },
    compactCaptureLayout: layout,
    mobileEditorAccess: {
      start: mobileStartGate,
      direct: mobileDirectGate,
      detection: "ua-not-viewport",
      desktopHeaderLayout,
      narrowDesktopLayout
    },
    missingAcknowledgement: "rejected",
    editorShell: {
      href: editor.href,
      projectName: editor.projectName,
      materialization: preparedB.mediaName,
      chrome: editorChrome
    },
    sessionTransition: {
      mode: "A-late-materialization-back-B-different-source",
      returnedStart,
      firstProjectId: firstTransitionProjectId,
      secondProjectId: freshProjectId,
      firstGeneration: firstTransitionSession.transitionGeneration,
      secondGeneration: secondTransitionSession.transitionGeneration,
      leaseChanged: firstTransitionSession.sessionLeaseId
        !== secondTransitionSession.sessionLeaseId,
      lateMaterialization: {
        aConsumerId: lateMaterializationFinal.aConsumerId,
        statusPollsBeforeTransition: lateAStarted.aStatusPolls,
        reclaimedAfterTransition:
          lateMaterializationAfterTransition.aAbandonedJobsReclaimed,
        runnerAborted: lateMaterializationFinal.aRunnerAborted,
        runnerSettled: lateMaterializationFinal.aRunnerSettled,
        lateCompletionDiscarded:
          lateMaterializationFinal.aLateCompletionDiscarded,
        explicitCancelRequests:
          lateMaterializationFinal.aExplicitCancelRequests,
        cachePurges: lateMaterializationFinal.aCachePurgeRequests,
        staleMediaRequests: lateMaterializationFinal.aMediaRequests,
        bQueuedBeforeReclaim: lateMaterializationFinal.bQueuedBeforeReclaim,
        bStartedAfterReclaim: lateMaterializationFinal.bStartedAfterReclaim,
        bMediaRequests: lateMaterializationFinal.bMediaRequests,
        bMediaAsset: freshProject?.mediaAsset ?? null
      }
    },
    deepEditorJourney: deepWorkspaceJourney,
    completedEditorExit: {
      href: completedEditorExit.href,
      mode: "same-tab-start"
    }
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`localhost browser smoke 실패: ${errorMessage(error)}\n`);
  if (driverOutput.trim()) {
    process.stderr.write(`ChromeDriver 최근 출력:\n${driverOutput.trim()}\n`);
  }
  if (studioOutput.trim()) {
    process.stderr.write(`localhost studio 최근 출력:\n${studioOutput.trim()}\n`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
