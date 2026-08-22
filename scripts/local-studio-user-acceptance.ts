#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  rm
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  spawn,
  type ChildProcess
} from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA
} from "../src/lib/local-media-engine-contract.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const studioOrigin = "http://127.0.0.1:4320";
const gatewayOrigin = "http://127.0.0.1:4319";
const databaseName = "chzzk-kirinuki-studio";
const acceptanceSourceUrl = "https://chzzk.naver.com/video/14514980";
const expectedClipTime = "00:03:40.000 → 00:05:30.000";
const expectedStartMs = 220_000;
const expectedEndMs = 330_000;
const isolatedClipTime = "00:06:00.000 → 00:06:10.000";
const isolatedStartMs = 360_000;
const isolatedEndMs = 370_000;
const abandonedClipTime = "00:07:00.000 → 00:07:05.000";
const abandonedStartMs = 420_000;
const abandonedEndMs = 425_000;
const fiveMinuteAutosaveMinimumElapsedMs = 5 * 60 * 1_000;
const fiveMinuteAutosaveTimeoutMs = 6 * 60 * 1_000;
const fiveMinuteAutosaveProgressIntervalMs = 25 * 1_000;

interface BrowserSession {
  sessionId?: unknown;
  capabilities?: {
    "goog:chromeOptions"?: {
      debuggerAddress?: unknown;
    };
  };
}

interface BrowserLogEntry {
  level?: unknown;
  source?: unknown;
  message?: unknown;
  timestamp?: unknown;
}

interface NetworkRequestRecord {
  requestId: string;
  method: string;
  url: string;
  resourceType: string;
  postData: string;
  responseStatus: number | null;
  failure: string;
}

interface InitialBrowserState {
  href: string;
  readyState: string;
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  cookie: string;
  projectManagerExists: boolean;
  projectManagerHidden: boolean;
  projectManagerBusy: boolean;
  projectManagerEmptyVisible: boolean;
  projectListVisible: boolean;
  projectRows: number;
  archiveButtonExists: boolean;
}

interface StoredProjectSummary {
  id?: unknown;
  name?: unknown;
  updatedAt?: unknown;
  alignmentOffsetMs?: unknown;
  clips?: Array<{
    id?: unknown;
    selectionStartMs?: unknown;
    selectionEndMs?: unknown;
    sourceStartMs?: unknown;
    sourceEndMs?: unknown;
  }>;
}

interface StoredLocalDraftSummary {
  id?: unknown;
  projectId?: unknown;
  reason?: unknown;
  createdAtMs?: unknown;
  project?: StoredProjectSummary;
}

interface StoredEditingSessionCheckpointSummary {
  projectId?: unknown;
  sessionId?: unknown;
  baselineProject: StoredProjectSummary | null;
}

interface IndexedDbSnapshot {
  databaseExists: boolean;
  stores: string[];
  counts: Record<string, number>;
  projects: StoredProjectSummary[];
  localDrafts: StoredLocalDraftSummary[];
  editingSessionCheckpoints: StoredEditingSessionCheckpointSummary[];
}

interface StaticAssetCacheAudit {
  path: string;
  etag: string;
  initialStatus: number;
  revalidatedStatus: number;
  headStatus: number;
  bytes: number;
  setCookieHeaders: number;
}

interface WriterLockAudit {
  supported: boolean;
  activeSessionBadged: boolean;
  managerActionsDisabled: boolean;
  competingTabRefused: boolean;
  message: string;
}

interface FiveMinuteAutosaveAudit {
  enabled: true;
  minimumElapsedMs: number;
  elapsedMs: number;
  mutation: string;
  mutationStartedAtMs: number;
  draftId: string;
  reason: "auto";
  createdAtMs: number;
  projectId: string;
  selectionStartMs: number;
  selectionEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
}

interface ManagedChild extends ChildProcess {
  stdout: Readable;
  stderr: Readable;
}

interface RuntimeProbe {
  reachable: boolean;
  ready: boolean;
  detail: string;
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  process.stdout.write([
    "Kirinuki localhost 사용자 인수 여정",
    "",
    "사용법:",
    "  npm run acceptance:localhost",
    "  npm run acceptance:localhost -- --live-vod",
    "  npm run acceptance:localhost -- --verify-five-minute-autosave",
    "",
    "기본 모드는 실제 4319 VOD job 시작을 확인한 뒤 취소합니다.",
    "--live-vod는 외부 VOD 준비와 로컬 MP4 연결 완료까지 기다립니다.",
    "--verify-five-minute-autosave는 실제 5분을 기다려 브라우저 자동 복구본을 검증합니다.",
    "--live-vod와 --verify-five-minute-autosave는 함께 사용할 수 없습니다.",
    ""
  ].join("\n"));
  process.exit(0);
}
for (const arg of args) {
  if (!["--live-vod", "--verify-five-minute-autosave"].includes(arg)) {
    throw new TypeError(`지원하지 않는 인수 옵션입니다: ${arg}`);
  }
}
const liveVod = args.has("--live-vod");
const verifyFiveMinuteAutosave = args.has("--verify-five-minute-autosave");
if (liveVod && verifyFiveMinuteAutosave) {
  throw new TypeError(
    "--live-vod와 --verify-five-minute-autosave는 함께 사용할 수 없습니다."
  );
}
const configuredLiveTimeout = Number(
  process.env.KIRINUKI_ACCEPTANCE_LIVE_TIMEOUT_MS || 15 * 60 * 1_000
);
if (
  !Number.isSafeInteger(configuredLiveTimeout)
  || configuredLiveTimeout < 30_000
  || configuredLiveTimeout > 60 * 60 * 1_000
) {
  throw new TypeError(
    "KIRINUKI_ACCEPTANCE_LIVE_TIMEOUT_MS는 30000~3600000 사이 정수여야 합니다."
  );
}

let tempRoot = "";
let profileRoot = "";
let driverPort = 0;
let sessionId = "";
let driver: ManagedChild | null = null;
let studio: ManagedChild | null = null;
let captionStack: ManagedChild | null = null;
let driverOutput = "";
let studioOutput = "";
let captionStackOutput = "";
let phase = "bootstrap";
let cleanupPromise: Promise<void> | null = null;
const networkRequests: NetworkRequestRecord[] = [];
const networkById = new Map<string, NetworkRequestRecord>();
let collectedBrowserLogs: BrowserLogEntry[] = [];

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

function appendOutput(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > 80_000 ? next.slice(-80_000) : next;
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
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  assert(Number.isSafeInteger(port) && port >= 1_024, "ChromeDriver 포트를 받지 못했습니다.");
  return port;
}

async function fetchJson(
  url: string,
  {
    method = "GET",
    body,
    headers = {},
    timeoutMs = 15_000
  }: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const requestHeaders = { ...headers };
  const init: RequestInit = {
    method,
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
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
      : isRecord(payload) && isRecord(payload.error)
        ? String(payload.error.message || response.statusText)
        : response.statusText;
    throw new Error(`${method} ${url} 실패 (${response.status}): ${detail}`);
  }
  return payload;
}

async function probeStudio(): Promise<RuntimeProbe> {
  try {
    const response = await fetch(`${studioOrigin}/v1/studio/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500)
    });
    const payload = await response.json().catch(() => null) as unknown;
    const ready = Boolean(
      response.ok
      && isRecord(payload)
      && payload.schema === "kirinuki-local-studio-server/health-v1"
      && payload.status === "ok"
      && payload.managed === true
    );
    return {
      reachable: true,
      ready,
      detail: ready ? "managed-ready" : `HTTP ${response.status}`
    };
  } catch (error) {
    return { reachable: false, ready: false, detail: errorMessage(error) };
  }
}

async function probeGateway(): Promise<RuntimeProbe> {
  try {
    const response = await fetch(`${gatewayOrigin}/v1/health`, {
      headers: {
        Origin: studioOrigin,
        "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL
      },
      cache: "no-store",
      signal: AbortSignal.timeout(1_500)
    });
    const payload = await response.json().catch(() => null) as unknown;
    const ready = Boolean(
      response.ok
      && isRecord(payload)
      && payload.schema === LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA
      && payload.status === "ok"
    );
    return {
      reachable: true,
      ready,
      detail: ready ? "gateway-ready" : `HTTP ${response.status}`
    };
  } catch (error) {
    return { reachable: false, ready: false, detail: errorMessage(error) };
  }
}

function spawnManaged(
  command: string,
  commandArgs: readonly string[],
  {
    environment = process.env,
    onOutput
  }: {
    environment?: NodeJS.ProcessEnv;
    onOutput: (chunk: Buffer | string) => void;
  }
): ManagedChild {
  const child = spawn(command, commandArgs, {
    cwd: root,
    env: environment,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  }) as ManagedChild;
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  return child;
}

async function ensureStudioServer(): Promise<"reused" | "started"> {
  const initial = await probeStudio();
  if (initial.ready) {
    return "reused";
  }
  if (initial.reachable) {
    throw new Error(
      `4320 포트가 응답하지만 정확한 managed Kirinuki Studio가 아닙니다: ${initial.detail}`
    );
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_STATE_HOME: path.join(tempRoot, "studio-state"),
    XDG_RUNTIME_DIR: path.join(tempRoot, "studio-run")
  };
  studio = spawnManaged(process.execPath, [
    "--import",
    "tsx",
    path.join(root, "scripts", "local-studio-server.ts"),
    "start",
    "--foreground"
  ], {
    environment,
    onOutput: (chunk) => {
      studioOutput = appendOutput(studioOutput, chunk);
    }
  });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (studio.exitCode !== null) {
      throw new Error(`localhost Studio가 준비 전에 종료했습니다.\n${studioOutput.trim()}`);
    }
    if ((await probeStudio()).ready) {
      return "started";
    }
    await delay(100);
  }
  throw new Error(`localhost Studio가 15초 안에 준비되지 않았습니다.\n${studioOutput.trim()}`);
}

async function ensureCaptionStack(): Promise<"reused" | "started"> {
  const initial = await probeGateway();
  if (initial.ready) {
    return "reused";
  }
  if (initial.reachable) {
    throw new Error(
      `4319 포트가 응답하지만 ${studioOrigin}용 Kirinuki gateway가 아닙니다: ${initial.detail}`
    );
  }
  captionStack = spawnManaged(process.execPath, [
    "--import",
    "tsx",
    path.join(root, "scripts", "local-caption-stack.ts"),
    "start",
    "--foreground"
  ], {
    onOutput: (chunk) => {
      captionStackOutput = appendOutput(captionStackOutput, chunk);
    }
  });
  for (let attempt = 0; attempt < 900; attempt += 1) {
    if (captionStack.exitCode !== null) {
      throw new Error(
        "Whisper/gateway가 준비 전에 종료했습니다. 먼저 `npm run caption-stack:setup`을 실행하세요."
        + `\n${captionStackOutput.trim()}`
      );
    }
    if ((await probeGateway()).ready) {
      return "started";
    }
    await delay(100);
  }
  throw new Error(
    "Whisper/gateway가 90초 안에 준비되지 않았습니다."
    + `\n${captionStackOutput.trim()}`
  );
}

async function verifyStaticAssetCache(): Promise<StaticAssetCacheAudit> {
  const assetPath = "/studio.js";
  const assetUrl = `${studioOrigin}${assetPath}`;
  const initial = await fetch(assetUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000)
  });
  const bytes = (await initial.arrayBuffer()).byteLength;
  const etag = String(initial.headers.get("etag") || "");
  assert(initial.status === 200, `정적 asset 최초 GET이 200이 아닙니다: ${initial.status}`);
  assert(bytes > 0, "정적 asset 최초 GET 본문이 비어 있습니다.");
  assert(/^(?:W\/)?"[^"]+"$/u.test(etag), `정적 asset ETag가 없습니다: ${etag}`);
  assert(
    initial.headers.get("cache-control") === "private, no-cache, must-revalidate",
    `정적 asset 캐시 정책이 다릅니다: ${initial.headers.get("cache-control")}`
  );

  const revalidated = await fetch(assetUrl, {
    cache: "no-store",
    headers: { "If-None-Match": etag },
    signal: AbortSignal.timeout(5_000)
  });
  const revalidatedBytes = (await revalidated.arrayBuffer()).byteLength;
  assert(
    revalidated.status === 304,
    `정적 asset ETag 재검증이 304가 아닙니다: ${revalidated.status}`
  );
  assert(revalidatedBytes === 0, "304 정적 asset 응답에 본문이 포함됐습니다.");
  assert(
    revalidated.headers.get("etag") === etag,
    `304 응답 ETag가 최초 ETag와 다릅니다: ${revalidated.headers.get("etag")}`
  );

  const head = await fetch(assetUrl, {
    method: "HEAD",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000)
  });
  assert(head.status === 200, `정적 asset HEAD가 200이 아닙니다: ${head.status}`);
  assert(head.headers.get("etag") === etag, "정적 asset HEAD ETag가 GET과 다릅니다.");
  const responses = [initial, revalidated, head];
  const setCookieHeaders = responses.filter(
    (response) => response.headers.has("set-cookie")
  ).length;
  assert(setCookieHeaders === 0, "정적 asset 응답이 Set-Cookie를 보냈습니다.");

  return {
    path: assetPath,
    etag,
    initialStatus: initial.status,
    revalidatedStatus: revalidated.status,
    headStatus: head.status,
    bytes,
    setCookieHeaders
  };
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
    throw new Error(`${String(value.error)}: ${String(value.message || "WebDriver 명령 실패")}`);
  }
  return value as T;
}

async function waitForDriver(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driver?.exitCode !== null) {
      throw new Error(`ChromeDriver가 준비 전에 종료했습니다.\n${driverOutput.trim()}`);
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
      // ChromeDriver가 loopback 포트에 바인딩할 때까지 기다린다.
    }
    await delay(100);
  }
  throw new Error(`ChromeDriver가 10초 안에 준비되지 않았습니다.\n${driverOutput.trim()}`);
}

async function execute<T>(script: string, scriptArgs: readonly unknown[] = []): Promise<T> {
  return webdriver<T>(
    "POST",
    `/session/${sessionId}/execute/sync`,
    { script, args: scriptArgs }
  );
}

async function executeAsync<T>(
  script: string,
  scriptArgs: readonly unknown[] = [],
  timeoutMs = 30_000
): Promise<T> {
  await webdriver(
    "POST",
    `/session/${sessionId}/timeouts`,
    { script: timeoutMs }
  );
  return webdriver<T>(
    "POST",
    `/session/${sessionId}/execute/async`,
    { script, args: scriptArgs },
    timeoutMs + 2_000
  );
}

async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  message: string,
  timeoutMs = 20_000
): Promise<T> {
  const startedAt = Date.now();
  let latest: T | undefined;
  let nextProgressAt = startedAt + 10_000;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      latest = await probe();
      if (predicate(latest)) {
        return latest;
      }
    } catch {
      // Navigation 중 잠깐 사라지는 execution context는 다시 읽는다.
    }
    if (Date.now() >= nextProgressAt) {
      process.stderr.write(`[acceptance] 대기 중: ${message}\n`);
      nextProgressAt += 10_000;
    }
    await delay(100);
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`);
}

type EditingSessionExitAction = "save" | "discard";

async function finishEditingSession(
  action: EditingSessionExitAction
): Promise<{ action: EditingSessionExitAction; description: string }> {
  await waitFor(
    () => execute<{ exists: boolean; hidden: boolean; disabled: boolean }>(`
      const button = document.querySelector("#finish-editing-session");
      return {
        exists: button instanceof HTMLButtonElement,
        hidden: !(button instanceof HTMLButtonElement) || button.hidden,
        disabled: !(button instanceof HTMLButtonElement) || button.disabled
      };
    `),
    (value) => value.exists && !value.hidden && !value.disabled,
    "편집 세션 종료 버튼이 준비되지 않았습니다."
  );
  await execute(`
    const button = document.querySelector("#finish-editing-session");
    if (!(button instanceof HTMLButtonElement) || button.hidden || button.disabled) {
      throw new Error("편집 세션 종료 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `);
  const dialog = await waitFor(
    () => execute<{
      open: boolean;
      description: string;
      saveEnabled: boolean;
      discardEnabled: boolean;
    }>(`
      const dialog = document.querySelector("#editing-session-exit-dialog");
      const save = document.querySelector("#save-and-exit-editing-session");
      const discard = document.querySelector("#discard-and-exit-editing-session");
      return {
        open: dialog instanceof HTMLDialogElement && dialog.open,
        description: document.querySelector("#editing-session-exit-description")?.textContent || "",
        saveEnabled: save instanceof HTMLButtonElement && !save.disabled,
        discardEnabled: discard instanceof HTMLButtonElement && !discard.disabled
      };
    `),
    (value) => (
      value.open
      && value.description.includes("이번 편집")
      && value.saveEnabled
      && value.discardEnabled
    ),
    "저장/폐기 의도를 고르는 편집 세션 종료 대화상자가 열리지 않았습니다."
  );
  const selector = action === "save"
    ? "#save-and-exit-editing-session"
    : "#discard-and-exit-editing-session";
  await execute(`
    const button = document.querySelector(arguments[0]);
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("편집 세션 종료 의도 버튼을 누를 수 없습니다: " + arguments[0]);
    }
    button.click();
    return true;
  `, [selector]);
  await waitFor(
    () => execute<{ href: string; managerBusy: boolean }>(`
      return {
        href: location.href,
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true"
      };
    `),
    (value) => value.href === `${studioOrigin}/` && !value.managerBusy,
    action === "save"
      ? "저장하고 나간 뒤 시작 화면으로 돌아오지 않았습니다."
      : "저장하지 않고 나간 뒤 시작 화면으로 돌아오지 않았습니다.",
    30_000
  );
  return { action, description: dialog.description };
}

async function verifyProjectWriterLock(
  expectedProjectName: string
): Promise<WriterLockAudit> {
  const supported = await execute<boolean>(
    "return Boolean(navigator.locks && typeof navigator.locks.request === 'function');"
  );
  assert(supported, "인수 Chromium에서 Web Locks API를 사용할 수 없습니다.");
  const primaryHandle = await webdriver<string>(
    "GET",
    `/session/${sessionId}/window`
  );
  const initialHandles = await webdriver<string[]>(
    "GET",
    `/session/${sessionId}/window/handles`
  );
  let competingHandle = "";
  try {
    const opened = await execute<boolean>(`
      const competing = window.open(new URL("/", location.origin).href, "_blank");
      return Boolean(competing);
    `);
    assert(opened, "같은 프로젝트의 경쟁 편집기 탭을 열지 못했습니다.");
    const handles = await waitFor(
      () => webdriver<string[]>("GET", `/session/${sessionId}/window/handles`),
      (value) => value.length === initialHandles.length + 1,
      "경쟁 편집기 탭의 WebDriver handle이 생기지 않았습니다."
    );
    competingHandle = handles.find((handle) => !initialHandles.includes(handle)) || "";
    assert(competingHandle, "경쟁 편집기 탭 handle을 식별하지 못했습니다.");
    await webdriver(
      "POST",
      `/session/${sessionId}/window`,
      { handle: competingHandle }
    );
    await waitFor(
      () => execute<{
        href: string;
        managerBusy: boolean;
        projectRows: number;
        matchingRows: number;
        activeSessionBadges: number;
        disabledActionCount: number;
        actionCount: number;
      }>(`
        const rows = [...document.querySelectorAll(".local-project-row")];
        const matchingRow = rows.find((row) => (
          row.querySelector(".local-project-title")?.textContent === arguments[0]
        ));
        const actions = matchingRow
          ? [...matchingRow.querySelectorAll("[data-project-action]")]
          : [];
        return {
          href: location.href,
          managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
          projectRows: rows.length,
          matchingRows: rows.filter((row) => (
            row.querySelector(".local-project-title")?.textContent === arguments[0]
            && row.querySelector('[data-project-action="continue"]') instanceof HTMLButtonElement
          )).length,
          activeSessionBadges: matchingRow?.querySelectorAll(
            ".local-project-active-session:not([hidden])"
          ).length || 0,
          disabledActionCount: actions.filter((button) => (
            button instanceof HTMLButtonElement && button.disabled
          )).length,
          actionCount: actions.length
        };
      `, [expectedProjectName]),
      (value) => (
        value.href === `${studioOrigin}/`
        && !value.managerBusy
        && value.projectRows >= 1
        && value.matchingRows === 1
        && value.activeSessionBadges === 1
        && value.actionCount === 3
        && value.disabledActionCount === value.actionCount
      ),
      "경쟁 탭의 프로젝트 목록이 작업 중 배지와 비활성 관리 버튼을 표시하지 않았습니다."
    );
    await execute(`
      const row = [...document.querySelectorAll(".local-project-row")].find((candidate) => (
        candidate.querySelector(".local-project-title")?.textContent === arguments[0]
      ));
      const button = row?.querySelector('[data-project-action="continue"]');
      if (!(button instanceof HTMLButtonElement) || !button.disabled) {
        throw new Error("작업 중인 저장 편집의 계속 버튼이 비활성 상태가 아닙니다.");
      }
      // Manager UX는 이 경로를 막아야 한다. 그 아래의 writer lock도 독립적으로
      // fail-closed인지 확인하기 위해 테스트에서만 버튼을 강제로 활성화한다.
      button.disabled = false;
      button.click();
      return true;
    `, [expectedProjectName]);
    await waitFor(
      () => execute<{
        projectName: string;
        submitText: string;
        acknowledgementCount: number;
        acknowledgementCheckedCount: number;
      }>(`
        const acknowledgements = [...document.querySelectorAll("[data-ack]")];
        return {
          projectName: document.querySelector("#project-name")?.value || "",
          submitText: document.querySelector("#start-editor")?.textContent || "",
          acknowledgementCount: acknowledgements.length,
          acknowledgementCheckedCount:
            acknowledgements.filter((input) => input.checked).length
        };
      `),
      (value) => (
        value.projectName === expectedProjectName
        && value.submitText.trim() === "편집기 열기"
        && value.acknowledgementCount === 6
        && value.acknowledgementCheckedCount === 0
      ),
      "경쟁 탭의 최근 편집 정책 확인 화면이 준비되지 않았습니다."
    );
    await execute(`
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      for (const checkbox of acknowledgements) {
        if (!(checkbox instanceof HTMLInputElement)) {
          throw new Error("경쟁 탭 정책 확인 요소 형식이 다릅니다.");
        }
        checkbox.click();
      }
      const submit = document.querySelector("#start-editor");
      if (!(submit instanceof HTMLButtonElement) || submit.disabled) {
        throw new Error("경쟁 탭 편집기 열기 버튼을 누를 수 없습니다.");
      }
      submit.click();
      return true;
    `);
    const refusal = await waitFor(
      () => execute<{
        activeSessionBadges: number;
        continueDisabled: boolean;
        editorAbsent: boolean;
        href: string;
      }>(`
        const row = [...document.querySelectorAll(".local-project-row")].find((candidate) => (
          candidate.querySelector(".local-project-title")?.textContent === arguments[0]
        ));
        const continueButton = row?.querySelector('[data-project-action="continue"]');
        return {
          activeSessionBadges: row?.querySelectorAll(
            ".local-project-active-session:not([hidden])"
          ).length || 0,
          continueDisabled: continueButton instanceof HTMLButtonElement
            && continueButton.disabled,
          editorAbsent: document.querySelector("#editor-shell") === null
            && document.querySelector("#editor-policy-gate") === null,
          href: location.href,
        };
      `, [expectedProjectName]),
      (value) => (
        value.href === `${studioOrigin}/`
        && value.editorAbsent
        && value.activeSessionBadges === 1
        && value.continueDisabled
      ),
      "두 번째 탭이 writer lock 거부 뒤 작업 중인 프로젝트가 보이는 시작 화면으로 돌아오지 않았습니다.",
      20_000
    );
    return {
      supported: true,
      activeSessionBadged: true,
      managerActionsDisabled: true,
      competingTabRefused: true,
      message: `${refusal.href}에서 기존 탭의 작업 중 상태를 유지했습니다.`
    };
  } finally {
    const handles = await webdriver<string[]>(
      "GET",
      `/session/${sessionId}/window/handles`
    ).catch((): string[] => []);
    if (competingHandle && handles.includes(competingHandle)) {
      await webdriver(
        "POST",
        `/session/${sessionId}/window`,
        { handle: competingHandle }
      ).catch(() => undefined);
      await webdriver(
        "DELETE",
        `/session/${sessionId}/window`
      ).catch(() => undefined);
    }
    const remainingHandles = await webdriver<string[]>(
      "GET",
      `/session/${sessionId}/window/handles`
    ).catch((): string[] => []);
    if (remainingHandles.includes(primaryHandle)) {
      await webdriver(
        "POST",
        `/session/${sessionId}/window`,
        { handle: primaryHandle }
      ).catch(() => undefined);
    }
  }

}

function performanceEvents(entries: readonly BrowserLogEntry[]): Record<string, unknown>[] {
  return entries.flatMap((entry) => {
    try {
      const envelope: unknown = JSON.parse(String(entry.message || ""));
      return isRecord(envelope) && isRecord(envelope.message)
        ? [envelope.message]
        : [];
    } catch {
      return [];
    }
  });
}

async function drainPerformanceLogs(): Promise<void> {
  if (!sessionId) {
    return;
  }
  const entries = await webdriver<BrowserLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
  for (const event of performanceEvents(entries)) {
    if (!isRecord(event.params)) {
      continue;
    }
    const requestId = String(event.params.requestId || "");
    if (event.method === "Network.requestWillBeSent" && isRecord(event.params.request)) {
      const request = event.params.request;
      const url = String(request.url || "");
      if (!requestId || !url) {
        continue;
      }
      const record: NetworkRequestRecord = {
        requestId,
        method: String(request.method || ""),
        url,
        resourceType: String(event.params.type || ""),
        postData: typeof request.postData === "string" ? request.postData : "",
        responseStatus: null,
        failure: ""
      };
      networkRequests.push(record);
      networkById.set(requestId, record);
      continue;
    }
    const record = networkById.get(requestId);
    if (!record) {
      continue;
    }
    if (event.method === "Network.responseReceived" && isRecord(event.params.response)) {
      const status = Number(event.params.response.status);
      record.responseStatus = Number.isFinite(status) ? status : null;
    } else if (event.method === "Network.loadingFailed") {
      record.failure = String(event.params.errorText || event.params.blockedReason || "failed");
    }
  }
}

function requestPath(record: NetworkRequestRecord): string {
  try {
    return new URL(record.url).pathname;
  } catch {
    return "";
  }
}

function requestOrigin(record: NetworkRequestRecord): string {
  try {
    return new URL(record.url).origin;
  } catch {
    return "";
  }
}

function requestJsonBody(record: NetworkRequestRecord): Record<string, unknown> {
  if (!record.postData) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(record.postData);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

async function waitForNetworkRequest(
  predicate: (record: NetworkRequestRecord) => boolean,
  message: string,
  timeoutMs = 30_000
): Promise<NetworkRequestRecord> {
  return waitFor(
    async () => {
      await drainPerformanceLogs();
      return networkRequests.find(predicate) || null;
    },
    (record): record is NetworkRequestRecord => Boolean(record),
    message,
    timeoutMs
  ) as Promise<NetworkRequestRecord>;
}

async function browserDatabaseNames(): Promise<string[]> {
  return executeAsync<string[]>(`
    const done = arguments[arguments.length - 1];
    Promise.resolve(typeof indexedDB.databases === "function" ? indexedDB.databases() : [])
      .then((entries) => done(entries.map((entry) => String(entry.name || "")).filter(Boolean)))
      .catch((error) => done({ __error: String(error) }));
  `).then((value: unknown) => {
    if (isRecord(value) && value.__error) {
      throw new Error(`IndexedDB 목록 확인 실패: ${String(value.__error)}`);
    }
    assert(Array.isArray(value), "IndexedDB 목록 응답이 배열이 아닙니다.");
    return value.map(String);
  });
}

async function indexedDbSnapshot(): Promise<IndexedDbSnapshot> {
  const value = await executeAsync<IndexedDbSnapshot | { __error: string }>(`
    const databaseName = arguments[0];
    const done = arguments[arguments.length - 1];
    const fail = (error) => done({ __error: String(error?.message || error) });
    Promise.resolve(typeof indexedDB.databases === "function" ? indexedDB.databases() : [])
      .then((entries) => {
        if (!entries.some((entry) => entry.name === databaseName)) {
          done({
            databaseExists: false,
            stores: [],
            counts: {},
            projects: [],
            localDrafts: [],
            editingSessionCheckpoints: []
          });
          return;
        }
        const open = indexedDB.open(databaseName);
        open.onerror = () => fail(open.error || "open failed");
        open.onsuccess = () => {
          const database = open.result;
          const stores = [...database.objectStoreNames];
          if (stores.length === 0) {
            database.close();
            done({
              databaseExists: true,
              stores,
              counts: {},
              projects: [],
              localDrafts: [],
              editingSessionCheckpoints: []
            });
            return;
          }
          const transaction = database.transaction(stores, "readonly");
          const counts = {};
          let projects = [];
          let localDrafts = [];
          let editingSessionCheckpoints = [];
          let pending = stores.length
            + (stores.includes("projects") ? 1 : 0)
            + (stores.includes("local-drafts") ? 1 : 0)
            + (stores.includes("editing-session-checkpoints") ? 1 : 0);
          const settle = () => {
            pending -= 1;
            if (pending === 0) {
              transaction.oncomplete = () => {
                database.close();
                done({
                  databaseExists: true,
                  stores,
                  counts,
                  projects,
                  localDrafts,
                  editingSessionCheckpoints
                });
              };
            }
          };
          transaction.onerror = () => fail(transaction.error || "transaction failed");
          for (const storeName of stores) {
            const request = transaction.objectStore(storeName).count();
            request.onerror = () => fail(request.error || "count failed");
            request.onsuccess = () => {
              counts[storeName] = Number(request.result);
              settle();
            };
          }
          if (stores.includes("projects")) {
            const request = transaction.objectStore("projects").getAll();
            request.onerror = () => fail(request.error || "projects failed");
            request.onsuccess = () => {
              projects = (request.result || []).map((project) => ({
                id: project?.id,
                name: project?.name,
                updatedAt: project?.updatedAt,
                alignmentOffsetMs: project?.broadcastSession?.alignmentOffsetMs,
                clips: (project?.clips || []).map((clip) => ({
                  id: clip?.id,
                  selectionStartMs: clip?.selectionStartMs,
                  selectionEndMs: clip?.selectionEndMs,
                  sourceStartMs: clip?.sourceStartMs,
                  sourceEndMs: clip?.sourceEndMs
                }))
              }));
              settle();
            };
          }
          if (stores.includes("local-drafts")) {
            const request = transaction.objectStore("local-drafts").getAll();
            request.onerror = () => fail(request.error || "local drafts failed");
            request.onsuccess = () => {
              localDrafts = (request.result || []).map((draft) => ({
                id: draft?.id,
                projectId: draft?.projectId,
                reason: draft?.reason,
                createdAtMs: draft?.createdAtMs,
                project: {
                  id: draft?.project?.id,
                  name: draft?.project?.name,
                  updatedAt: draft?.project?.updatedAt,
                  alignmentOffsetMs:
                    draft?.project?.broadcastSession?.alignmentOffsetMs,
                  clips: (draft?.project?.clips || []).map((clip) => ({
                    id: clip?.id,
                    selectionStartMs: clip?.selectionStartMs,
                    selectionEndMs: clip?.selectionEndMs,
                    sourceStartMs: clip?.sourceStartMs,
                    sourceEndMs: clip?.sourceEndMs
                  }))
                }
              }));
              settle();
            };
          }
          if (stores.includes("editing-session-checkpoints")) {
            const request = transaction
              .objectStore("editing-session-checkpoints")
              .getAll();
            request.onerror = () => fail(
              request.error || "editing session checkpoints failed"
            );
            request.onsuccess = () => {
              editingSessionCheckpoints = (request.result || []).map((checkpoint) => ({
                projectId: checkpoint?.projectId,
                sessionId: checkpoint?.sessionId,
                baselineProject: checkpoint?.baseline?.project
                  ? {
                    id: checkpoint.baseline.project.id,
                    name: checkpoint.baseline.project.name,
                    updatedAt: checkpoint.baseline.project.updatedAt,
                    alignmentOffsetMs:
                      checkpoint.baseline.project.broadcastSession?.alignmentOffsetMs,
                    clips: (checkpoint.baseline.project.clips || []).map((clip) => ({
                      id: clip?.id,
                      selectionStartMs: clip?.selectionStartMs,
                      selectionEndMs: clip?.selectionEndMs,
                      sourceStartMs: clip?.sourceStartMs,
                      sourceEndMs: clip?.sourceEndMs
                    }))
                  }
                  : null
              }));
              settle();
            };
          }
        };
      })
      .catch(fail);
  `, [databaseName]);
  if ("__error" in value) {
    throw new Error(`IndexedDB CURRENT 확인 실패: ${value.__error}`);
  }
  return value;
}

async function waitForFiveMinuteAutosave({
  mutation,
  mutationStartedAtMs,
  mutationStartedAtMonotonicMs,
  projectId,
  draftIdsBeforeMutation
}: {
  mutation: string;
  mutationStartedAtMs: number;
  mutationStartedAtMonotonicMs: number;
  projectId: string;
  draftIdsBeforeMutation: ReadonlySet<string>;
}): Promise<FiveMinuteAutosaveAudit> {
  let latestAutoDrafts: StoredLocalDraftSummary[] = [];
  const writeProgress = () => {
    const elapsedMs = performance.now() - mutationStartedAtMonotonicMs;
    const elapsedSeconds = Math.floor(elapsedMs / 1_000);
    const minimumSeconds = Math.ceil(fiveMinuteAutosaveMinimumElapsedMs / 1_000);
    process.stderr.write(
      `[acceptance] 5분 자동저장 실시간 대기: ${elapsedSeconds}/${minimumSeconds}초`
      + ` (새 auto 복구본 ${latestAutoDrafts.length}개)\n`
    );
  };
  writeProgress();
  const progressTimer = setInterval(
    writeProgress,
    fiveMinuteAutosaveProgressIntervalMs
  );
  try {
    while (
      performance.now() - mutationStartedAtMonotonicMs
        <= fiveMinuteAutosaveTimeoutMs
    ) {
      const snapshot = await indexedDbSnapshot();
      latestAutoDrafts = snapshot.localDrafts.filter((draft) => (
        !draftIdsBeforeMutation.has(String(draft.id || ""))
        && draft.projectId === projectId
        && draft.reason === "auto"
      ));
      const exactDraft = latestAutoDrafts.find((draft) => {
        const clip = draft.project?.clips?.[0];
        return (
          Boolean(String(draft.id || ""))
          && Number(draft.createdAtMs) >= mutationStartedAtMs
          && draft.project?.name === mutation
          && draft.project.clips?.length === 1
          && clip?.selectionStartMs === expectedStartMs
          && clip.selectionEndMs === expectedEndMs
          && clip.sourceStartMs === expectedStartMs
          && clip.sourceEndMs === expectedEndMs
        );
      });
      const elapsedMs = performance.now() - mutationStartedAtMonotonicMs;
      if (elapsedMs >= fiveMinuteAutosaveMinimumElapsedMs && exactDraft) {
        const clip = exactDraft.project?.clips?.[0];
        assert(clip, "5분 자동 복구본의 컷을 읽지 못했습니다.");
        return {
          enabled: true,
          minimumElapsedMs: fiveMinuteAutosaveMinimumElapsedMs,
          elapsedMs: Math.floor(elapsedMs),
          mutation,
          mutationStartedAtMs,
          draftId: String(exactDraft.id || ""),
          reason: "auto",
          createdAtMs: Number(exactDraft.createdAtMs),
          projectId,
          selectionStartMs: Number(clip.selectionStartMs),
          selectionEndMs: Number(clip.selectionEndMs),
          sourceStartMs: Number(clip.sourceStartMs),
          sourceEndMs: Number(clip.sourceEndMs)
        };
      }
      await delay(1_000);
    }
  } finally {
    clearInterval(progressTimer);
  }
  throw new Error(
    "실제 5분 경과 후 정확한 자동 복구본이 나타나지 않았습니다: "
    + JSON.stringify({
      elapsedMs: Math.floor(performance.now() - mutationStartedAtMonotonicMs),
      mutation,
      projectId,
      latestAutoDrafts
    })
  );
}

function sanitizeLogMessage(value: unknown): string {
  return String(value || "")
    .replace(/([?&]usageGate=)[A-Za-z0-9_-]+/gu, "$1<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer <redacted>")
    .slice(0, 1_500);
}

async function collectBrowserLogs(): Promise<BrowserLogEntry[]> {
  if (!sessionId) {
    return collectedBrowserLogs;
  }
  try {
    const next = await webdriver<BrowserLogEntry[]>(
      "POST",
      `/session/${sessionId}/log`,
      { type: "browser" }
    );
    collectedBrowserLogs = collectedBrowserLogs.concat(next.map((entry) => ({
      level: entry.level,
      source: entry.source,
      timestamp: entry.timestamp,
      message: sanitizeLogMessage(entry.message)
    })));
  } catch {
    // A failed navigation may already have closed the log endpoint.
  }
  return collectedBrowserLogs;
}

async function currentPageDiagnostic(): Promise<unknown> {
  if (!sessionId) {
    return null;
  }
  try {
    return await execute(`
      return {
        href: location.href.replace(/([?&]usageGate=)[A-Za-z0-9_-]+/g, "$1<redacted>"),
        readyState: document.readyState,
        title: document.title,
        toast: document.querySelector("#toast")?.textContent || "",
        jobHidden: Boolean(document.querySelector("#job-dialog")?.hidden),
        jobTitle: document.querySelector("#job-title")?.textContent || "",
        jobMessage: document.querySelector("#job-message")?.textContent || "",
        whisperState: document.querySelector("#whisper-connection-status")?.dataset?.state || "",
        whisperText: document.querySelector("#whisper-connection-status")?.textContent || ""
      };
    `);
  } catch {
    return null;
  }
}

async function stopChild(child: ManagedChild | null): Promise<void> {
  if (!child || child.exitCode !== null || !child.pid) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    return;
  }
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null) {
    try {
      if (process.platform === "win32") {
        child.kill("SIGKILL");
      } else {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      // The process may have exited between the check and signal.
    }
    await Promise.race([exited, delay(2_000)]);
  }
}

async function cleanup(): Promise<void> {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    if (sessionId) {
      await webdriver("DELETE", `/session/${sessionId}`).catch(() => undefined);
      sessionId = "";
    }
    await stopChild(driver);
    await stopChild(captionStack);
    await stopChild(studio);
    if (
      tempRoot
      && path.dirname(tempRoot) === os.tmpdir()
      && path.basename(tempRoot).startsWith("kirinuki-user-acceptance-")
    ) {
      await rm(tempRoot, { recursive: true, force: true });
    }
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-user-acceptance-"));
  profileRoot = path.join(tempRoot, "chromium-profile");
  const projectName = `Kirinuki 인수 ${Date.now()}`;
  const persistedProjectName = `${projectName} · 저장 확인`;
  const isolatedProjectName = `${projectName} · 별도 새 편집`;
  const discardedMutationName = `${isolatedProjectName} · 폐기할 변경`;
  const abandonedProjectName = `${projectName} · 탭 닫기 폐기`;
  let fiveMinuteAutosaveAudit: FiveMinuteAutosaveAudit | { enabled: false } = {
    enabled: false
  };

  phase = "runtime-ready";
  const studioMode = await ensureStudioServer();
  const captionStackMode = await ensureCaptionStack();
  phase = "static-cache";
  const staticCacheAudit = await verifyStaticAssetCache();
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
  driver = spawnManaged(chromedriver, [`--port=${port}`], {
    onOutput: (chunk) => {
      driverOutput = appendOutput(driverOutput, chunk);
    }
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
            "--disable-popup-blocking",
            "--no-first-run",
            "--no-default-browser-check",
            "--lang=ko-KR",
            `--user-data-dir=${profileRoot}`
          ]
        }
      }
    }
  }, 45_000);
  assert(typeof created.sessionId === "string" && created.sessionId, "WebDriver session ID가 없습니다.");
  sessionId = created.sessionId;
  const debuggerAddress = String(
    created.capabilities?.["goog:chromeOptions"]?.debuggerAddress || ""
  );
  assert(
    /^(?:127\.0\.0\.1|localhost):\d{4,5}$/u.test(debuggerAddress),
    `Chrome CDP debugger가 loopback 주소가 아닙니다: ${debuggerAddress}`
  );
  await webdriver("POST", `/session/${sessionId}/window/rect`, {
    width: 1_600,
    height: 1_000
  });

  phase = "clean-start";
  await webdriver("POST", `/session/${sessionId}/url`, { url: `${studioOrigin}/` });
  await waitFor(
    () => execute<string>("return document.readyState"),
    (value) => value === "interactive" || value === "complete",
    "localhost 시작 화면이 준비되지 않았습니다."
  );
  await waitFor(
    () => execute<{
      busy: boolean;
      emptyVisible: boolean;
      errorVisible: boolean;
    }>(`
      return {
        busy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        emptyVisible: !Boolean(document.querySelector("#local-projects-empty")?.hidden),
        errorVisible: !Boolean(document.querySelector("#local-projects-error")?.hidden)
      };
    `),
    (value) => !value.busy && value.emptyVisible && !value.errorVisible,
    "새 프로필의 빈 브라우저 편집 목록이 준비되지 않았습니다."
  );
  const initial = await execute<InitialBrowserState>(`
    return {
      href: location.href,
      readyState: document.readyState,
      localStorageKeys: Object.keys(localStorage).sort(),
      sessionStorageKeys: Object.keys(sessionStorage).sort(),
      cookie: document.cookie,
      projectManagerExists: document.querySelector("#recent-section") instanceof HTMLElement,
      projectManagerHidden: Boolean(document.querySelector("#recent-section")?.hidden),
      projectManagerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
      projectManagerEmptyVisible: !Boolean(document.querySelector("#local-projects-empty")?.hidden),
      projectListVisible: !Boolean(document.querySelector("#local-projects-list")?.hidden),
      projectRows: document.querySelectorAll(".local-project-row").length,
      archiveButtonExists: document.querySelector("#import-session-archive") instanceof HTMLButtonElement
    };
  `);
  assert(initial.href === `${studioOrigin}/`, `새 프로필 시작 주소가 다릅니다: ${initial.href}`);
  assert(initial.localStorageKeys.length === 0, `새 프로필 localStorage가 비어 있지 않습니다: ${initial.localStorageKeys}`);
  assert(initial.sessionStorageKeys.length === 0, `새 프로필 sessionStorage가 비어 있지 않습니다: ${initial.sessionStorageKeys}`);
  assert(initial.cookie === "", "새 프로필에 Kirinuki cookie가 생겼습니다.");
  assert(
    initial.projectManagerExists
      && !initial.projectManagerHidden
      && !initial.projectManagerBusy
      && initial.projectManagerEmptyVisible
      && !initial.projectListVisible
      && initial.projectRows === 0
      && initial.archiveButtonExists,
    `빈 브라우저 편집 관리자 UI 계약이 다릅니다: ${JSON.stringify(initial)}`
  );
  const initialDatabases = await browserDatabaseNames();
  assert(
    initialDatabases.includes(databaseName),
    `빈 프로젝트 관리자가 편집기 IndexedDB를 준비하지 않았습니다: ${initialDatabases}`
  );
  const initialStorage = await indexedDbSnapshot();
  assert(
    initialStorage.databaseExists
      && initialStorage.projects.length === 0
      && initialStorage.localDrafts.length === 0
      && initialStorage.editingSessionCheckpoints.length === 0
      && Object.values(initialStorage.counts).every((count) => count === 0),
    `새 프로필의 편집기 IndexedDB가 비어 있지 않습니다: ${JSON.stringify(initialStorage)}`
  );

  phase = "user-input";
  await execute(`
    const setInput = (selector, value) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("입력 요소가 없습니다: " + selector);
      }
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput("#source-url", arguments[0]);
    setInput("#project-name", arguments[1]);
    setInput('.clip-row [data-field="start"]', "00:03:40.000");
    setInput('.clip-row [data-field="end"]', "00:05:30.000");
    for (const checkbox of document.querySelectorAll("[data-ack]")) {
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("권리 확인 checkbox 형식이 다릅니다.");
      }
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  `, [acceptanceSourceUrl, projectName]);
  await waitFor(
    () => execute<string>("return document.querySelector('#source-platform')?.textContent || ''"),
    (value) => value === "치지직 VOD",
    "CHZZK VOD 주소를 시작 화면이 인식하지 못했습니다."
  );
  await execute(`
    const button = document.querySelector("#start-editor");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("편집 시작 버튼이 없습니다.");
    }
    button.click();
    return true;
  `);

  phase = "editor-entry";
  const editorState = await waitFor(
    () => execute<{
      href: string;
      policyAbsent: boolean;
      projectId: string;
      sessionProjectId: string;
      shellVisible: boolean;
      workspace: string;
      projectName: string;
      clipTime: string;
      clipTimeCount: number;
      localDraftButtonExists: boolean;
    }>(`
      const shell = document.querySelector("#editor-shell");
      const url = new URL(location.href);
      const session = JSON.parse(sessionStorage.getItem(
        "kirinuki:local-web:active-usage-session"
      ) || "null");
      return {
        href: location.href,
        policyAbsent: document.querySelector("#editor-policy-gate") === null,
        projectId: url.searchParams.get("project") || "",
        sessionProjectId: session?.attestation?.target?.projectId || "",
        shellVisible: shell instanceof HTMLElement && !shell.hidden && !shell.inert,
        workspace: shell?.dataset.workspace || "",
        projectName: document.querySelector("#project-name")?.value || "",
        clipTime: document.querySelector(".clip-time")?.textContent || "",
        clipTimeCount: document.querySelectorAll(".clip-time").length,
        localDraftButtonExists: document.querySelector("#open-local-drafts") instanceof HTMLButtonElement
      };
    `),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html`)
      && value.policyAbsent
      && value.projectId.length > 0
      && value.sessionProjectId === value.projectId
      && value.shellVisible
      && value.workspace === "main"
      && value.projectName === projectName
      && value.clipTimeCount === 1
      && value.clipTime === expectedClipTime
    ),
    "정상 입력 뒤 정확한 03:40~05:30 편집기에 진입하지 못했습니다.",
    30_000
  );
  assert(editorState.localDraftButtonExists, "편집기 저장 복구 버튼이 없습니다.");
  assert(
    !editorState.clipTime.includes("00:03:50.000")
      && !editorState.clipTime.includes("00:05:40.000"),
    `편집기 표시가 +10초 이동했습니다: ${editorState.clipTime}`
  );

  phase = "indexeddb-current";
  const storage = await waitFor(
    indexedDbSnapshot,
    (value) => (
      Number(value.counts.projects || 0) === 1
      && Number(value.counts["editing-session-checkpoints"] || 0) === 1
    ),
    "브라우저 IndexedDB CURRENT와 새 편집 세션 baseline 체크포인트가 저장되지 않았습니다."
  );
  const storedProject = storage.projects.find((candidate) => candidate.name === projectName);
  const storedClip = storedProject?.clips?.[0];
  assert(
    storage.databaseExists
      && storedProject
      && storedProject.alignmentOffsetMs === 0
      && storedProject.clips?.length === 1
      && storedClip?.selectionStartMs === expectedStartMs
      && storedClip.selectionEndMs === expectedEndMs
      && storedClip.sourceStartMs === expectedStartMs
      && storedClip.sourceEndMs === expectedEndMs
      && storage.editingSessionCheckpoints.length === 1
      && storage.editingSessionCheckpoints[0]?.projectId === storedProject.id
      && storage.editingSessionCheckpoints[0]?.baselineProject === null,
    `IndexedDB CURRENT 시간축이 사용자 선택과 다릅니다: ${JSON.stringify(storage)}`
  );

  phase = "vod-auto-start";
  const vodRequest = await waitForNetworkRequest(
    (record) => (
      requestOrigin(record) === gatewayOrigin
      && record.method === "POST"
      && /^\/v1\/(?:vod|chzzk-vod)\/materializations$/u.test(requestPath(record))
    ),
    "편집기 진입 뒤 4319 VOD 자동 job이 시작되지 않았습니다.",
    45_000
  );
  if (liveVod) {
    phase = "vod-live-complete";
    await waitFor(
      () => execute<{ name: string; meta: string; jobHidden: boolean }>(`
        return {
          name: document.querySelector("#media-name")?.textContent || "",
          meta: document.querySelector("#media-meta")?.textContent || "",
          jobHidden: Boolean(document.querySelector("#job-dialog")?.hidden)
        };
      `),
      (value) => value.name.includes("편집 영상 준비됨") && value.jobHidden,
      "실제 외부 VOD 구간 준비와 로컬 MP4 연결이 완료되지 않았습니다.",
      configuredLiveTimeout
    );
  } else {
    phase = "vod-default-cancel";
    const cancellation = await execute<{ clicked: boolean; alreadyFinished: boolean }>(`
      const dialog = document.querySelector("#job-dialog");
      const button = document.querySelector("#cancel-job");
      const active = dialog instanceof HTMLDialogElement
        && !dialog.hidden
        && dialog.open;
      if (active && button instanceof HTMLButtonElement && !button.disabled && !button.hidden) {
        button.click();
        return { clicked: true, alreadyFinished: false };
      }
      return { clicked: false, alreadyFinished: !active };
    `);
    assert(
      cancellation.clicked || cancellation.alreadyFinished,
      "기본 인수 모드에서 시작한 VOD job을 안전하게 취소하지 못했습니다."
    );
    await waitFor(
      () => execute<boolean>(`
        const dialog = document.querySelector("#job-dialog");
        return !(dialog instanceof HTMLDialogElement) || dialog.hidden || !dialog.open;
      `),
      Boolean,
      "VOD job 취소 뒤 편집기 잠금이 풀리지 않았습니다.",
      30_000
    );
  }

  const draftIdsBeforeAutosaveMutation = new Set(
    storage.localDrafts.map((draft) => String(draft.id || ""))
  );
  const autosaveMutationStartedAtMs = Date.now();
  const autosaveMutationStartedAtMonotonicMs = performance.now();
  phase = "current-ui-mutation";
  await execute(`
    const input = document.querySelector("#project-name");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("프로젝트명 입력 요소가 없습니다.");
    }
    input.focus();
    input.value = arguments[0];
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: arguments[0]
    }));
    input.blur();
    return true;
  `, [persistedProjectName]);
  const mutatedStorage = await waitFor(
    indexedDbSnapshot,
    (value) => value.projects.some((candidate) => (
      candidate.id === storedProject.id
      && candidate.name === persistedProjectName
    )),
    "프로젝트명 UI 변경이 IndexedDB CURRENT에 반영되지 않았습니다."
  );
  const mutatedProject = mutatedStorage.projects.find(
    (candidate) => candidate.id === storedProject.id
  );
  const mutatedClip = mutatedProject?.clips?.[0];
  assert(
    mutatedProject?.name === persistedProjectName
      && mutatedProject.clips?.length === 1
      && mutatedClip?.selectionStartMs === expectedStartMs
      && mutatedClip.selectionEndMs === expectedEndMs
      && mutatedClip.sourceStartMs === expectedStartMs
      && mutatedClip.sourceEndMs === expectedEndMs,
    `CURRENT의 의미 변경 또는 컷 시간이 올바르지 않습니다: ${JSON.stringify(mutatedProject)}`
  );

  let storageBeforeManualDraft = mutatedStorage;
  if (verifyFiveMinuteAutosave) {
    phase = "five-minute-autosave";
    fiveMinuteAutosaveAudit = await waitForFiveMinuteAutosave({
      mutation: persistedProjectName,
      mutationStartedAtMs: autosaveMutationStartedAtMs,
      mutationStartedAtMonotonicMs: autosaveMutationStartedAtMonotonicMs,
      projectId: String(storedProject.id || ""),
      draftIdsBeforeMutation: draftIdsBeforeAutosaveMutation
    });
    storageBeforeManualDraft = await indexedDbSnapshot();
  }

  phase = "manual-recovery-draft";
  const draftIdsBefore = new Set(
    storageBeforeManualDraft.localDrafts.map((draft) => String(draft.id || ""))
  );
  await waitFor(
    () => execute<{ exists: boolean; disabled: boolean }>(`
      const button = document.querySelector("#create-local-draft");
      return {
        exists: button instanceof HTMLButtonElement,
        disabled: !(button instanceof HTMLButtonElement) || button.disabled
      };
    `),
    (value) => value.exists && !value.disabled,
    "수동 로컬 임시저장 버튼이 준비되지 않았습니다."
  );
  await execute(`
    const button = document.querySelector("#create-local-draft");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("수동 로컬 임시저장 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `);
  const manualDraftStorage = await waitFor(
    indexedDbSnapshot,
    (value) => Number(value.counts["local-drafts"] || 0)
      > Number(storageBeforeManualDraft.counts["local-drafts"] || 0),
    "수동 임시저장 뒤 IndexedDB local-drafts 개수가 늘지 않았습니다."
  );
  const manualDraft = manualDraftStorage.localDrafts.find((draft) => (
    !draftIdsBefore.has(String(draft.id || ""))
    && draft.projectId === storedProject.id
    && draft.reason === "manual"
  ));
  const manualDraftClip = manualDraft?.project?.clips?.[0];
  assert(
    manualDraft
      && manualDraft.project?.name === persistedProjectName
      && manualDraft.project.clips?.length === 1
      && manualDraftClip?.selectionStartMs === expectedStartMs
      && manualDraftClip.selectionEndMs === expectedEndMs
      && manualDraftClip.sourceStartMs === expectedStartMs
      && manualDraftClip.sourceEndMs === expectedEndMs,
    `수동 복구본이 CURRENT의 정확한 컷을 담지 않았습니다: ${JSON.stringify(manualDraftStorage)}`
  );
  await waitFor(
    () => execute<string>(
      "return document.querySelector('#local-draft-status')?.textContent || '';"
    ),
    (value) => value.includes(
      `저장본 ${Math.min(5, Number(manualDraftStorage.counts["local-drafts"] || 0))}/5`
    ),
    "수동 임시저장 뒤 사용자용 저장본 상태가 갱신되지 않았습니다."
  );

  phase = "whisper-auto-pair";
  const pickerInstrumentation = await execute<{ fileSystemApi: boolean }>(`
    globalThis.__kirinukiAcceptancePickerCalls = 0;
    const input = document.querySelector("#whisper-connection-file");
    input?.addEventListener("click", () => {
      globalThis.__kirinukiAcceptancePickerCalls += 1;
    }, true);
    const original = typeof window.showOpenFilePicker === "function"
      ? window.showOpenFilePicker.bind(window)
      : null;
    if (original) {
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: (...args) => {
          globalThis.__kirinukiAcceptancePickerCalls += 1;
          return original(...args);
        }
      });
    }
    return { fileSystemApi: Boolean(original) };
  `);
  await execute(`
    const tab = document.querySelector("#whisper-provider-tab");
    if (!(tab instanceof HTMLButtonElement)) {
      throw new Error("Whisper 탭 버튼이 없습니다.");
    }
    tab.click();
    return true;
  `);
  await delay(750);
  const whisperBeforeConnect = await execute<{ state: string; disabled: boolean }>(`
    const status = document.querySelector("#whisper-connection-status");
    const button = document.querySelector("#connect-local-whisper");
    return {
      state: status?.dataset?.state || "",
      disabled: !(button instanceof HTMLButtonElement) || button.disabled
    };
  `);
  if (["", "idle", "disconnected", "error"].includes(whisperBeforeConnect.state)) {
    assert(!whisperBeforeConnect.disabled, "Whisper 자동 연결 버튼이 비활성화되어 있습니다.");
    await execute(`
      const button = document.querySelector("#connect-local-whisper");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Whisper 연결 버튼이 없습니다.");
      }
      button.click();
      return true;
    `);
  }
  const whisper = await waitFor(
    () => execute<{
      state: string;
      text: string;
      model: string;
      pickerCalls: number;
      selectedFiles: number;
    }>(`
      const status = document.querySelector("#whisper-connection-status");
      const input = document.querySelector("#whisper-connection-file");
      return {
        state: status?.dataset?.state || "",
        text: status?.textContent || "",
        model: document.querySelector("#whisper-model-summary")?.textContent || "",
        pickerCalls: Number(globalThis.__kirinukiAcceptancePickerCalls || 0),
        selectedFiles: input instanceof HTMLInputElement ? input.files?.length || 0 : 0
      };
    `),
    (value) => value.state === "ready" || value.pickerCalls > 0,
    "Whisper 버튼이 파일 선택 없이 실행 중인 4319 companion에 자동 연결되지 않았습니다.",
    30_000
  );
  assert(
    whisper.pickerCalls === 0 && whisper.selectedFiles === 0,
    `Whisper 자동 연결이 파일 picker를 열었습니다: ${JSON.stringify({
      pickerInstrumentation,
      whisper
    })}`
  );
  assert(
    whisper.state === "ready"
      && whisper.text.includes("연결")
      && !whisper.model.includes("연결 후"),
    `Whisper companion/model 자동 연결 상태가 아닙니다: ${JSON.stringify(whisper)}`
  );
  const whisperCapabilityRequest = await waitForNetworkRequest(
    (record) => (
      requestOrigin(record) === gatewayOrigin
      && record.method === "GET"
      && requestPath(record) === "/v1/captions"
    ),
    "Whisper 자동 연결이 실제 4319 capability를 확인하지 않았습니다."
  );
  const pairingRequest = networkRequests.find((record) => (
    requestOrigin(record) === gatewayOrigin
    && record.method === "POST"
    && requestPath(record) === "/v1/session"
  ));
  assert(pairingRequest, "VOD/Whisper가 실제 4319 자동 pairing 세션을 만들지 않았습니다.");

  phase = "project-writer-lock";
  const writerLockAudit = await verifyProjectWriterLock(persistedProjectName);
  const primaryEditorAfterLock = await waitFor(
    () => execute<{
      shellHidden: boolean;
      projectName: string;
      clipTime: string;
    }>(`
      return {
        shellHidden: Boolean(document.querySelector("#editor-shell")?.hidden),
        projectName: document.querySelector("#project-name")?.value || "",
        clipTime: document.querySelector(".clip-time")?.textContent || ""
      };
    `),
    (value) => (
      !value.shellHidden
      && value.projectName === persistedProjectName
      && value.clipTime === expectedClipTime
    ),
    "경쟁 탭을 닫은 뒤 첫 편집기 탭이 유지되지 않았습니다."
  );

  phase = "save-original-session-and-exit";
  const originalSaveExit = await finishEditingSession("save");
  const savedOriginalStorage = await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.projects.some((candidate) => (
        candidate.id === storedProject.id
        && candidate.name === persistedProjectName
      ))
      && value.editingSessionCheckpoints.length === 0
      && Number(value.counts["editing-session-checkpoints"] || 0) === 0
    ),
    "명시적 저장 후 CURRENT는 남고 편집 세션 체크포인트는 정리되지 않았습니다."
  );
  assert(
    savedOriginalStorage.localDrafts.some((draft) => draft.id === manualDraft.id),
    "명시적 저장 후 사용자가 만든 복구본이 사라졌습니다."
  );

  phase = "recent-project-recovery";
  const recentState = await waitFor(
    () => execute<{
      href: string;
      managerBusy: boolean;
      summary: string;
      projectRows: number;
      matchingRows: number;
      matchingDraftText: string;
      recoverButtonEnabled: boolean;
      acknowledgementCount: number;
      acknowledgementCheckedCount: number;
      cookie: string;
    }>(`
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      const rows = [...document.querySelectorAll(".local-project-row")];
      const matching = rows.filter((row) => row.dataset.projectId === arguments[0]);
      const recover = matching[0]?.querySelector('[data-project-action="recover"]');
      return {
        href: location.href,
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        summary: document.querySelector("#local-projects-summary")?.textContent || "",
        projectRows: rows.length,
        matchingRows: matching.length,
        matchingDraftText: matching[0]?.querySelector(".local-project-drafts")?.textContent || "",
        recoverButtonEnabled: recover instanceof HTMLButtonElement && !recover.disabled,
        acknowledgementCount: acknowledgements.length,
        acknowledgementCheckedCount: acknowledgements.filter((input) => input.checked).length,
        cookie: document.cookie
      };
    `, [String(storedProject.id || "")]),
    (value) => (
      value.href === `${studioOrigin}/`
      && !value.managerBusy
      && value.summary.includes("저장된 편집 1개")
      && value.projectRows === 1
      && value.matchingRows === 1
      && value.matchingDraftText.includes("복구본")
      && value.recoverButtonEnabled
    ),
    "시작 화면 프로젝트 목록에 방금 저장한 편집과 복구 액션이 나타나지 않았습니다.",
    20_000
  );
  assert(
    recentState.acknowledgementCount === 6
      && recentState.acknowledgementCheckedCount === 0,
    `복구 진입 전 이번 사용 확인이 새로 비어 있지 않습니다: ${JSON.stringify(recentState)}`
  );
  assert(recentState.cookie === "", "최근 프로젝트 화면에서 cookie가 생겼습니다.");
  await execute(`
    const row = [...document.querySelectorAll(".local-project-row")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    const button = row?.querySelector('[data-project-action="recover"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("선택한 프로젝트의 복구본 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `, [String(storedProject.id || "")]);
  const recoveryPolicyState = await waitFor(
    () => execute<{
      projectName: string;
      sourceUrl: string;
      submitText: string;
      acknowledgementCount: number;
      acknowledgementCheckedCount: number;
    }>(`
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      return {
        projectName: document.querySelector("#project-name")?.value || "",
        sourceUrl: document.querySelector("#source-url")?.value || "",
        submitText: document.querySelector("#start-editor")?.textContent || "",
        acknowledgementCount: acknowledgements.length,
        acknowledgementCheckedCount: acknowledgements.filter((input) => input.checked).length
      };
    `),
    (value) => (
      value.projectName === persistedProjectName
      && value.sourceUrl === acceptanceSourceUrl
      && value.submitText.trim() === "편집기 열기"
    ),
    "최근 프로젝트가 복구 정책 확인 양식에 정확히 채워지지 않았습니다."
  );
  assert(
    recoveryPolicyState.acknowledgementCount === 6
      && recoveryPolicyState.acknowledgementCheckedCount === 0,
    "복구본 선택이 이전 사용자 확인을 재사용했습니다."
  );
  await execute(`
    const acknowledgements = [...document.querySelectorAll("[data-ack]")];
    if (acknowledgements.length !== 6) {
      throw new Error("복구용 책임 확인 항목 수가 6개가 아닙니다.");
    }
    for (const checkbox of acknowledgements) {
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("복구용 책임 확인 요소 형식이 다릅니다.");
      }
      if (!checkbox.checked) {
        checkbox.click();
      }
    }
    const submit = document.querySelector("#start-editor");
    if (!(submit instanceof HTMLButtonElement) || submit.disabled) {
      throw new Error("복구 편집기 열기 버튼을 누를 수 없습니다.");
    }
    submit.click();
    return true;
  `);
  const recoveryEditorState = await waitFor(
    () => execute<{
      href: string;
      policyAbsent: boolean;
      projectId: string;
      sessionProjectId: string;
      shellVisible: boolean;
      workspace: string;
      projectName: string;
      clipTime: string;
      clipTimeCount: number;
      draftDialogOpen: boolean;
      draftDialogHidden: boolean;
      draftChoices: number;
      cookie: string;
    }>(`
      const dialog = document.querySelector("#local-draft-dialog");
      const shell = document.querySelector("#editor-shell");
      const url = new URL(location.href);
      const session = JSON.parse(sessionStorage.getItem(
        "kirinuki:local-web:active-usage-session"
      ) || "null");
      return {
        href: location.href,
        policyAbsent: document.querySelector("#editor-policy-gate") === null,
        projectId: url.searchParams.get("project") || "",
        sessionProjectId: session?.attestation?.target?.projectId || "",
        shellVisible: shell instanceof HTMLElement && !shell.hidden && !shell.inert,
        workspace: shell?.dataset.workspace || "",
        projectName: document.querySelector("#project-name")?.value || "",
        clipTime: document.querySelector(".clip-time")?.textContent || "",
        clipTimeCount: document.querySelectorAll(".clip-time").length,
        draftDialogOpen: dialog instanceof HTMLDialogElement && dialog.open,
        draftDialogHidden: Boolean(dialog?.hidden),
        draftChoices: document.querySelectorAll(
          '#local-draft-list input[name="local-draft-choice"]'
        ).length,
        cookie: document.cookie
      };
    `),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html`)
      && new URL(value.href).searchParams.get("session") === "resume"
      && new URL(value.href).searchParams.get("recovery") === "drafts"
      && value.policyAbsent
      && value.projectId === storedProject.id
      && value.sessionProjectId === storedProject.id
      && value.shellVisible
      && value.workspace === "main"
      && value.projectName === persistedProjectName
      && value.clipTimeCount === 1
      && value.clipTime === expectedClipTime
      && value.draftDialogOpen
      && !value.draftDialogHidden
      && value.draftChoices >= 1
    ),
    "복구 진입 뒤 임시저장 대화상자와 정확한 03:40~05:30 편집이 열리지 않았습니다.",
    30_000
  );
  assert(recoveryEditorState.cookie === "", "복구 편집기에서 cookie가 생겼습니다.");
  const recoveredStorage = await indexedDbSnapshot();
  const recoveredProject = recoveredStorage.projects.find(
    (candidate) => candidate.id === storedProject.id
  );
  const recoveredClip = recoveredProject?.clips?.[0];
  assert(
    recoveredProject?.name === persistedProjectName
      && recoveredProject.clips?.length === 1
      && recoveredClip?.selectionStartMs === expectedStartMs
      && recoveredClip.selectionEndMs === expectedEndMs
      && recoveredClip.sourceStartMs === expectedStartMs
      && recoveredClip.sourceEndMs === expectedEndMs
      && Number(recoveredStorage.counts["local-drafts"] || 0)
        >= Number(manualDraftStorage.counts["local-drafts"] || 0)
      && recoveredStorage.editingSessionCheckpoints.length === 1
      && recoveredStorage.editingSessionCheckpoints[0]?.projectId === storedProject.id
      && recoveredStorage.editingSessionCheckpoints[0]?.baselineProject?.id
        === storedProject.id,
    `복구 진입 뒤 CURRENT/복구본이 달라졌습니다: ${JSON.stringify(recoveredStorage)}`
  );

  await execute(`
    const button = document.querySelector("#close-local-draft-dialog");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("복구본 목록을 닫을 수 없습니다.");
    }
    button.click();
    return true;
  `);
  await waitFor(
    () => execute<boolean>(`
      const dialog = document.querySelector("#local-draft-dialog");
      return !(dialog instanceof HTMLDialogElement) || !dialog.open;
    `),
    Boolean,
    "복구본 목록이 닫히지 않았습니다."
  );
  phase = "save-recovery-session-and-exit";
  const recoverySaveExit = await finishEditingSession("save");
  await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.projects.some((candidate) => candidate.id === storedProject.id)
      && value.editingSessionCheckpoints.length === 0
    ),
    "복구 세션을 저장하고 나간 뒤 체크포인트가 정리되지 않았습니다."
  );

  phase = "same-vod-fresh-project-intent";
  await waitFor(
    () => execute<{
      href: string;
      managerBusy: boolean;
      sourceInput: boolean;
      projectRows: number;
      originalRows: number;
      clipRows: number;
      acknowledgementCount: number;
      acknowledgementCheckedCount: number;
    }>(`
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      const projectRows = [...document.querySelectorAll(".local-project-row")];
      return {
        href: location.href,
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        sourceInput: document.querySelector("#source-url") instanceof HTMLInputElement,
        projectRows: projectRows.length,
        originalRows: projectRows.filter((row) => row.dataset.projectId === arguments[0]).length,
        clipRows: document.querySelectorAll(".clip-row").length,
        acknowledgementCount: acknowledgements.length,
        acknowledgementCheckedCount: acknowledgements.filter((input) => input.checked).length
      };
    `, [String(storedProject.id || "")]),
    (value) => (
      value.href === `${studioOrigin}/`
      && !value.managerBusy
      && value.sourceInput
      && value.projectRows === 1
      && value.originalRows === 1
      && value.clipRows === 1
      && value.acknowledgementCount === 6
      && value.acknowledgementCheckedCount === 0
    ),
    "동일 VOD를 별도 새 프로젝트로 입력할 시작 화면이 준비되지 않았습니다."
  );
  const storageBeforeIsolatedEntry = await indexedDbSnapshot();
  const originalProjectBeforeIsolatedEntry = JSON.stringify(
    storageBeforeIsolatedEntry.projects.find(
      (candidate) => candidate.id === storedProject.id
    )
  );
  assert(
    originalProjectBeforeIsolatedEntry !== undefined
      && originalProjectBeforeIsolatedEntry !== "undefined",
    "별도 새 프로젝트 진입 직전의 기존 CURRENT를 읽지 못했습니다."
  );
  await execute(`
    const setInput = (selector, value) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("동일 VOD 새 편집 입력 요소가 없습니다: " + selector);
      }
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput("#source-url", arguments[0]);
    setInput("#project-name", arguments[1]);
    setInput('.clip-row [data-field="start"]', "00:06:00.000");
    setInput('.clip-row [data-field="end"]', "00:06:10.000");
    return true;
  `, [acceptanceSourceUrl, isolatedProjectName]);
  const isolatedIntent = await waitFor(
    () => execute<{
      statusHidden: boolean;
      status: string;
      submitText: string;
      sameSourceRows: number;
      acknowledgementCount: number;
      acknowledgementCheckedCount: number;
    }>(`
      const status = document.querySelector("#source-cache-status");
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      return {
        statusHidden: Boolean(status?.hidden),
        status: status?.textContent || "",
        submitText: document.querySelector("#start-editor")?.textContent || "",
        sameSourceRows: document.querySelectorAll(
          ".local-project-row.is-current-source .local-project-same-source:not([hidden])"
        ).length,
        acknowledgementCount: acknowledgements.length,
        acknowledgementCheckedCount: acknowledgements.filter((input) => input.checked).length
      };
    `),
    (value) => (
      !value.statusHidden
      && value.status.includes("저장 편집")
      && value.status.includes("별도의 새 편집")
      && value.status.includes("섞지 않습니다")
      && value.submitText.trim() === "편집기 열기"
      && value.sameSourceRows === 1
      && value.acknowledgementCount === 6
      && value.acknowledgementCheckedCount === 0
    ),
    "동일 VOD 입력이 기존 편집과 섞이지 않는 별도 새 프로젝트임을 화면에 명시하지 않았습니다."
  );
  await drainPerformanceLogs();
  const materializationRequestIdsBeforeIsolated = new Set(
    networkRequests
      .filter((record) => (
        requestOrigin(record) === gatewayOrigin
        && record.method === "POST"
        && /^\/v1\/(?:vod|chzzk-vod)\/materializations$/u.test(requestPath(record))
      ))
      .map((record) => record.requestId)
  );
  await execute(`
    const acknowledgements = [...document.querySelectorAll("[data-ack]")];
    if (acknowledgements.length !== 6) {
      throw new Error("동일 VOD 새 편집의 책임 확인 항목 수가 6개가 아닙니다.");
    }
    for (const checkbox of acknowledgements) {
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("동일 VOD 새 편집의 책임 확인 요소 형식이 다릅니다.");
      }
      if (!checkbox.checked) {
        checkbox.click();
      }
    }
    const submit = document.querySelector("#start-editor");
    if (!(submit instanceof HTMLButtonElement) || submit.disabled) {
      throw new Error("동일 VOD 별도 새 편집 버튼을 누를 수 없습니다.");
    }
    submit.click();
    return true;
  `);
  const isolatedEditorState = await waitFor(
    () => execute<{
      href: string;
      projectId: string;
      policyAbsent: boolean;
      sessionProjectId: string;
      shellVisible: boolean;
      workspace: string;
      projectName: string;
      clipTimes: string[];
      toast: string;
    }>(`
      const href = location.href;
      const shell = document.querySelector("#editor-shell");
      const session = JSON.parse(sessionStorage.getItem(
        "kirinuki:local-web:active-usage-session"
      ) || "null");
      return {
        href,
        projectId: href.startsWith(arguments[0])
          ? new URL(href).searchParams.get("project") || ""
          : "",
        policyAbsent: document.querySelector("#editor-policy-gate") === null,
        sessionProjectId: session?.attestation?.target?.projectId || "",
        shellVisible: shell instanceof HTMLElement && !shell.hidden && !shell.inert,
        workspace: shell?.dataset.workspace || "",
        projectName: document.querySelector("#project-name")?.value || "",
        clipTimes: [...document.querySelectorAll(".clip-time")]
          .map((element) => element.textContent || ""),
        toast: document.querySelector("#toast")?.textContent || ""
      };
    `, [`${studioOrigin}/editor.html`]),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html`)
      && new URL(value.href).searchParams.get("session") !== "resume"
      && value.projectId.length > 0
      && value.projectId !== String(storedProject.id || "")
      && value.policyAbsent
      && value.sessionProjectId === value.projectId
      && value.shellVisible
      && value.workspace === "main"
      && value.projectName === isolatedProjectName
      && value.clipTimes.length === 1
      && value.clipTimes[0] === isolatedClipTime
    ),
    "동일 VOD 새 편집이 기존 프로젝트와 다른 ID의 06:00~06:10 컷 하나로 열리지 않았습니다.",
    30_000
  );
  assert(
    !isolatedEditorState.toast.includes("자동으로 다시 연결하지 못했습니다")
      && !isolatedEditorState.toast.includes("편집 영상 다시 준비"),
    `별도 새 프로젝트가 기존 VOD 캐시를 복구하려 했습니다: ${isolatedEditorState.toast}`
  );

  const isolatedVodRequest = await waitForNetworkRequest(
    (record) => (
      !materializationRequestIdsBeforeIsolated.has(record.requestId)
      && requestOrigin(record) === gatewayOrigin
      && record.method === "POST"
      && /^\/v1\/(?:vod|chzzk-vod)\/materializations$/u.test(requestPath(record))
      && requestJsonBody(record).consumerId === isolatedEditorState.projectId
    ),
    "동일 VOD 별도 새 프로젝트의 4319 materialization이 시작되지 않았습니다.",
    30_000
  );
  const isolatedVodRequestBody = requestJsonBody(isolatedVodRequest);
  assert(
    isolatedVodRequestBody.consumerId === isolatedEditorState.projectId
      && !("resume" in isolatedVodRequestBody)
      && !("base" in isolatedVodRequestBody),
    `별도 새 프로젝트가 기존 materialization identity를 재사용했습니다: ${JSON.stringify(isolatedVodRequestBody)}`
  );
  const isolatedToastAfterVodStart = await execute<string>(
    "return document.querySelector('#toast')?.textContent || '';"
  );
  assert(
    !isolatedToastAfterVodStart.includes("자동으로 다시 연결하지 못했습니다")
      && !isolatedToastAfterVodStart.includes("편집 영상 다시 준비"),
    `별도 새 프로젝트에 기존 VOD 자동 재연결 경고가 나타났습니다: ${isolatedToastAfterVodStart}`
  );
  const isolatedVodCancellation = await execute<{
    clicked: boolean;
    alreadyFinished: boolean;
  }>(`
    const dialog = document.querySelector("#job-dialog");
    const button = document.querySelector("#cancel-job");
    const active = dialog instanceof HTMLDialogElement
      && !dialog.hidden
      && dialog.open;
    if (active && button instanceof HTMLButtonElement && !button.disabled && !button.hidden) {
      button.click();
      return { clicked: true, alreadyFinished: false };
    }
    return { clicked: false, alreadyFinished: !active };
  `);
  assert(
    isolatedVodCancellation.clicked || isolatedVodCancellation.alreadyFinished,
    "별도 새 프로젝트의 materialization을 안전하게 취소하지 못했습니다."
  );
  if (isolatedVodCancellation.clicked) {
    await waitFor(
      () => execute<boolean>(`
        const dialog = document.querySelector("#job-dialog");
        return !(dialog instanceof HTMLDialogElement) || dialog.hidden || !dialog.open;
      `),
      Boolean,
      "별도 새 프로젝트 VOD job 취소 뒤 편집기 잠금이 풀리지 않았습니다.",
      30_000
    );
  }

  const isolatedStorage = await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.projects.some((candidate) => (
        candidate.id === isolatedEditorState.projectId
        && candidate.clips?.length === 1
      ))
      && value.editingSessionCheckpoints.some((checkpoint) => (
        checkpoint.projectId === isolatedEditorState.projectId
        && checkpoint.baselineProject === null
      ))
    ),
    "별도 새 프로젝트가 자신의 CURRENT와 빈 baseline 체크포인트를 저장하지 않았습니다."
  );
  const originalAfterIsolatedEntry = isolatedStorage.projects.find(
    (candidate) => candidate.id === storedProject.id
  );
  const isolatedProject = isolatedStorage.projects.find(
    (candidate) => candidate.id === isolatedEditorState.projectId
  );
  const isolatedClip = isolatedProject?.clips?.[0];
  assert(
    isolatedStorage.projects.length === 2
      && JSON.stringify(originalAfterIsolatedEntry) === originalProjectBeforeIsolatedEntry,
    `별도 새 프로젝트 생성이 기존 CURRENT를 변경했습니다: ${JSON.stringify(isolatedStorage.projects)}`
  );
  assert(
    isolatedProject?.id === isolatedEditorState.projectId
      && isolatedProject.name === isolatedProjectName
      && isolatedProject.clips?.length === 1
      && isolatedClip?.id !== storedClip.id
      && isolatedClip?.selectionStartMs === isolatedStartMs
      && isolatedClip.selectionEndMs === isolatedEndMs
      && isolatedClip.sourceStartMs === isolatedStartMs
      && isolatedClip.sourceEndMs === isolatedEndMs,
    `별도 새 CURRENT에 기존 컷이 섞였거나 06:00~06:10 컷이 달라졌습니다: ${JSON.stringify(isolatedProject)}`
  );

  phase = "save-isolated-session-and-exit";
  const isolatedSaveExit = await finishEditingSession("save");
  await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.projects.some((candidate) => (
        candidate.id === isolatedEditorState.projectId
        && candidate.name === isolatedProjectName
      ))
      && value.editingSessionCheckpoints.length === 0
    ),
    "별도 새 프로젝트를 저장하고 나간 뒤 CURRENT는 남고 체크포인트는 정리되지 않았습니다."
  );

  phase = "project-manager-continue";
  const twoProjectManagerState = await waitFor(
    () => execute<{
      href: string;
      managerBusy: boolean;
      projectRows: number;
      originalRows: number;
      isolatedRows: number;
    }>(`
      const rows = [...document.querySelectorAll(".local-project-row")];
      return {
        href: location.href,
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        projectRows: rows.length,
        originalRows: rows.filter((row) => row.dataset.projectId === arguments[0]).length,
        isolatedRows: rows.filter((row) => row.dataset.projectId === arguments[1]).length
      };
    `, [String(storedProject.id || ""), isolatedEditorState.projectId]),
    (value) => (
      value.href === `${studioOrigin}/`
      && !value.managerBusy
      && value.projectRows === 2
      && value.originalRows === 1
      && value.isolatedRows === 1
    ),
    "프로젝트 관리자가 동일 VOD의 서로 다른 편집 2개를 별도 행으로 표시하지 않았습니다."
  );
  await execute(`
    const row = [...document.querySelectorAll(".local-project-row")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    const button = row?.querySelector('[data-project-action="continue"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("별도 새 프로젝트의 계속 편집 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `, [isolatedEditorState.projectId]);
  const isolatedContinuePolicy = await waitFor(
    () => execute<{
      projectName: string;
      submitText: string;
      acknowledgementCount: number;
      acknowledgementCheckedCount: number;
    }>(`
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      return {
        projectName: document.querySelector("#project-name")?.value || "",
        submitText: document.querySelector("#start-editor")?.textContent || "",
        acknowledgementCount: acknowledgements.length,
        acknowledgementCheckedCount: acknowledgements.filter((input) => input.checked).length
      };
    `),
    (value) => (
      value.projectName === isolatedProjectName
      && value.submitText.trim() === "편집기 열기"
      && value.acknowledgementCount === 6
      && value.acknowledgementCheckedCount === 0
    ),
    "선택한 별도 프로젝트의 계속 편집 정책 확인이 준비되지 않았습니다."
  );
  await execute(`
    for (const checkbox of document.querySelectorAll("[data-ack]")) {
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("계속 편집 책임 확인 요소 형식이 다릅니다.");
      }
      if (!checkbox.checked) {
        checkbox.click();
      }
    }
    const submit = document.querySelector("#start-editor");
    if (!(submit instanceof HTMLButtonElement) || submit.disabled) {
      throw new Error("계속 편집 열기 버튼을 누를 수 없습니다.");
    }
    submit.click();
    return true;
  `);
  const isolatedContinueEditor = await waitFor(
    () => execute<{
      href: string;
      policyAbsent: boolean;
      projectId: string;
      sessionProjectId: string;
      shellVisible: boolean;
      workspace: string;
      projectName: string;
      clipTimes: string[];
    }>(`
      const shell = document.querySelector("#editor-shell");
      const url = new URL(location.href);
      const session = JSON.parse(sessionStorage.getItem(
        "kirinuki:local-web:active-usage-session"
      ) || "null");
      return {
        href: location.href,
        policyAbsent: document.querySelector("#editor-policy-gate") === null,
        projectId: url.searchParams.get("project") || "",
        sessionProjectId: session?.attestation?.target?.projectId || "",
        shellVisible: shell instanceof HTMLElement && !shell.hidden && !shell.inert,
        workspace: shell?.dataset.workspace || "",
        projectName: document.querySelector("#project-name")?.value || "",
        clipTimes: [...document.querySelectorAll(".clip-time")]
          .map((element) => element.textContent || "")
      };
    `),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html`)
      && value.projectId === isolatedEditorState.projectId
      && new URL(value.href).searchParams.get("session") === "resume"
      && new URL(value.href).searchParams.get("recovery") === null
      && value.policyAbsent
      && value.sessionProjectId === isolatedEditorState.projectId
      && value.shellVisible
      && value.workspace === "main"
      && value.projectName === isolatedProjectName
      && value.clipTimes.length === 1
      && value.clipTimes[0] === isolatedClipTime
    ),
    "프로젝트 관리자의 계속 편집이 선택한 CURRENT 하나만 열지 않았습니다.",
    30_000
  );

  phase = "discard-continued-session";
  const continueCheckpointStorage = await waitFor(
    indexedDbSnapshot,
    (value) => value.editingSessionCheckpoints.some((checkpoint) => (
      checkpoint.projectId === isolatedEditorState.projectId
      && checkpoint.baselineProject?.id === isolatedEditorState.projectId
      && checkpoint.baselineProject.name === isolatedProjectName
    )),
    "계속 편집 진입 직전 CURRENT baseline 체크포인트가 생기지 않았습니다."
  );
  const isolatedBaselineBeforeDiscard = continueCheckpointStorage
    .editingSessionCheckpoints.find((checkpoint) => (
      checkpoint.projectId === isolatedEditorState.projectId
    ))?.baselineProject;
  assert(
    isolatedBaselineBeforeDiscard,
    "계속 편집의 폐기 baseline CURRENT를 읽지 못했습니다."
  );
  await waitFor(
    () => execute<{ exists: boolean; disabled: boolean }>(`
      const input = document.querySelector("#project-name");
      return {
        exists: input instanceof HTMLInputElement,
        disabled: !(input instanceof HTMLInputElement) || input.disabled
      };
    `),
    (value) => value.exists && !value.disabled,
    "계속 편집에서 폐기할 변경을 입력할 수 없습니다."
  );
  await execute(`
    const input = document.querySelector("#project-name");
    if (!(input instanceof HTMLInputElement) || input.disabled) {
      throw new Error("폐기할 프로젝트명 변경을 입력할 수 없습니다.");
    }
    input.focus();
    input.value = arguments[0];
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: arguments[0]
    }));
    input.blur();
    return true;
  `, [discardedMutationName]);
  await waitFor(
    indexedDbSnapshot,
    (value) => value.projects.some((candidate) => (
      candidate.id === isolatedEditorState.projectId
      && candidate.name === discardedMutationName
    )),
    "폐기 직전 working CURRENT에 세션 변경이 반영되지 않았습니다."
  );
  const isolatedDiscardExit = await finishEditingSession("discard");
  const storageAfterSessionDiscard = await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.editingSessionCheckpoints.length === 0
      && value.projects.some((candidate) => (
        candidate.id === isolatedEditorState.projectId
        && JSON.stringify(candidate) === JSON.stringify(
          isolatedBaselineBeforeDiscard
        )
      ))
    ),
    "저장하지 않고 나간 뒤 진입 직전 CURRENT baseline이 정확히 복원되지 않았습니다."
  );
  assert(
    !storageAfterSessionDiscard.projects.some((candidate) => (
      candidate.name === discardedMutationName
    )),
    "저장하지 않고 나왔는데 세션 변경이 CURRENT에 남았습니다."
  );

  phase = "project-manager-delete";
  await waitFor(
    () => execute<boolean>(`
      return document.querySelector("#recent-section")?.getAttribute("aria-busy") !== "true"
        && [...document.querySelectorAll(".local-project-row")]
          .some((row) => row.dataset.projectId === arguments[0]);
    `, [isolatedEditorState.projectId]),
    Boolean,
    "삭제할 별도 새 프로젝트가 관리자에 표시되지 않았습니다."
  );
  await execute(`
    const row = [...document.querySelectorAll(".local-project-row")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    const button = row?.querySelector('[data-project-action="delete"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("별도 새 프로젝트 삭제 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `, [isolatedEditorState.projectId]);
  const deleteDialogState = await waitFor(
    () => execute<{
      open: boolean;
      title: string;
      summary: string;
      confirmText: string;
    }>(`
      const dialog = document.querySelector("#local-project-delete-dialog");
      return {
        open: dialog instanceof HTMLDialogElement && dialog.open,
        title: document.querySelector("#local-project-delete-title")?.textContent || "",
        summary: document.querySelector("#local-project-delete-summary")?.textContent || "",
        confirmText: document.querySelector("#confirm-local-project-delete")?.textContent || ""
      };
    `),
    (value) => (
      value.open
      && value.title.includes(isolatedProjectName)
      && value.summary.includes("컷 1개")
      && value.confirmText.includes("이 편집 삭제")
    ),
    "단일 프로젝트 삭제 대화상자가 정확한 대상과 범위를 표시하지 않았습니다."
  );
  await execute(`
    const button = document.querySelector("#cancel-local-project-delete");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("프로젝트 삭제 취소 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `);
  await waitFor(
    () => execute<boolean>(`
      const dialog = document.querySelector("#local-project-delete-dialog");
      return !(dialog instanceof HTMLDialogElement) || !dialog.open;
    `),
    Boolean,
    "삭제 취소 뒤 확인 대화상자가 닫히지 않았습니다."
  );
  const storageAfterDeleteCancel = await indexedDbSnapshot();
  assert(
    storageAfterDeleteCancel.projects.some((candidate) => (
      candidate.id === isolatedEditorState.projectId
    )),
    "프로젝트 삭제를 취소했는데 저장 편집이 사라졌습니다."
  );
  await execute(`
    const row = [...document.querySelectorAll(".local-project-row")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    const button = row?.querySelector('[data-project-action="delete"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("취소 후 단일 프로젝트 삭제 버튼을 다시 누를 수 없습니다.");
    }
    button.click();
    return true;
  `, [isolatedEditorState.projectId]);
  await waitFor(
    () => execute<boolean>(`
      const dialog = document.querySelector("#local-project-delete-dialog");
      return dialog instanceof HTMLDialogElement && dialog.open;
    `),
    Boolean,
    "프로젝트 삭제 대화상자를 다시 열지 못했습니다."
  );
  await execute(`
    const button = document.querySelector("#confirm-local-project-delete");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("프로젝트 삭제 확인 버튼을 누를 수 없습니다.");
    }
    button.click();
    return true;
  `);
  const storageAfterDelete = await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.projects.length === 1
      && value.projects[0]?.id === storedProject.id
      && !value.localDrafts.some((draft) => (
        draft.projectId === isolatedEditorState.projectId
      ))
    ),
    "선택한 별도 새 프로젝트의 브라우저 저장 데이터만 삭제되지 않았습니다."
  );
  const projectManagerAfterDelete = await waitFor(
    () => execute<{
      managerBusy: boolean;
      projectRows: number;
      originalRows: number;
      isolatedRows: number;
      dialogOpen: boolean;
    }>(`
      const rows = [...document.querySelectorAll(".local-project-row")];
      const dialog = document.querySelector("#local-project-delete-dialog");
      return {
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        projectRows: rows.length,
        originalRows: rows.filter((row) => row.dataset.projectId === arguments[0]).length,
        isolatedRows: rows.filter((row) => row.dataset.projectId === arguments[1]).length,
        dialogOpen: dialog instanceof HTMLDialogElement && dialog.open
      };
    `, [String(storedProject.id || ""), isolatedEditorState.projectId]),
    (value) => (
      !value.managerBusy
      && value.projectRows === 1
      && value.originalRows === 1
      && value.isolatedRows === 0
      && !value.dialogOpen
    ),
    "삭제 후 프로젝트 관리자가 남은 편집 하나만 표시하지 않았습니다."
  );
  assert(
    JSON.stringify(storageAfterDelete.projects[0]) === originalProjectBeforeIsolatedEntry,
    `별도 프로젝트 삭제가 기존 CURRENT를 변경했습니다: ${JSON.stringify(storageAfterDelete.projects[0])}`
  );

  phase = "abandoned-new-session-tab-close";
  const survivingStartHandle = await webdriver<string>(
    "GET",
    `/session/${sessionId}/window`
  );
  const handlesBeforeAbandonedSession = await webdriver<string[]>(
    "GET",
    `/session/${sessionId}/window/handles`
  );
  const openedAbandonedSession = await execute<boolean>(`
    const editorTab = window.open(new URL("/", location.origin).href, "_blank");
    return Boolean(editorTab);
  `);
  assert(openedAbandonedSession, "탭 닫기 폐기를 검증할 별도 시작 탭을 열지 못했습니다.");
  const handlesWithAbandonedSession = await waitFor(
    () => webdriver<string[]>(
      "GET",
      `/session/${sessionId}/window/handles`
    ),
    (value) => value.length === handlesBeforeAbandonedSession.length + 1,
    "탭 닫기 폐기용 WebDriver window handle이 생기지 않았습니다."
  );
  const abandonedSessionHandle = handlesWithAbandonedSession.find(
    (handle) => !handlesBeforeAbandonedSession.includes(handle)
  ) || "";
  assert(abandonedSessionHandle, "탭 닫기 폐기용 window handle을 식별하지 못했습니다.");
  await webdriver(
    "POST",
    `/session/${sessionId}/window`,
    { handle: abandonedSessionHandle }
  );
  await waitFor(
    () => execute<{
      href: string;
      managerBusy: boolean;
      originalRows: number;
      sourceInputExists: boolean;
    }>(`
      const rows = [...document.querySelectorAll(".local-project-row")];
      return {
        href: location.href,
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        originalRows: rows.filter((row) => row.dataset.projectId === arguments[0]).length,
        sourceInputExists: document.querySelector("#source-url") instanceof HTMLInputElement
      };
    `, [String(storedProject.id || "")]),
    (value) => (
      value.href === `${studioOrigin}/`
      && !value.managerBusy
      && value.originalRows === 1
      && value.sourceInputExists
    ),
    "탭 닫기 폐기용 새 시작 탭이 준비되지 않았습니다."
  );
  await execute(`
    const setInput = (selector, value) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("탭 닫기 폐기 입력 요소가 없습니다: " + selector);
      }
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput("#source-url", arguments[0]);
    setInput("#project-name", arguments[1]);
    setInput('.clip-row [data-field="start"]', "00:07:00.000");
    setInput('.clip-row [data-field="end"]', "00:07:05.000");
    for (const checkbox of document.querySelectorAll("[data-ack]")) {
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("탭 닫기 폐기 책임 확인 요소 형식이 다릅니다.");
      }
      if (!checkbox.checked) {
        checkbox.click();
      }
    }
    return true;
  `, [acceptanceSourceUrl, abandonedProjectName]);
  await waitFor(
    () => execute<{
      platform: string;
      submitEnabled: boolean;
      acknowledgementCount: number;
      acknowledgementCheckedCount: number;
    }>(`
      const acknowledgements = [...document.querySelectorAll("[data-ack]")];
      const submit = document.querySelector("#start-editor");
      return {
        platform: document.querySelector("#source-platform")?.textContent || "",
        submitEnabled: submit instanceof HTMLButtonElement && !submit.disabled,
        acknowledgementCount: acknowledgements.length,
        acknowledgementCheckedCount: acknowledgements.filter((input) => input.checked).length
      };
    `),
    (value) => (
      value.platform === "치지직 VOD"
      && value.submitEnabled
      && value.acknowledgementCount === 6
      && value.acknowledgementCheckedCount === 6
    ),
    "탭 닫기 폐기용 새 프로젝트 입력이 완료되지 않았습니다."
  );
  await execute(`
    const submit = document.querySelector("#start-editor");
    if (!(submit instanceof HTMLButtonElement) || submit.disabled) {
      throw new Error("탭 닫기 폐기용 새 편집 시작 버튼을 누를 수 없습니다.");
    }
    submit.click();
    return true;
  `);
  const abandonedEditorState = await waitFor(
    () => execute<{
      href: string;
      projectId: string;
      policyAbsent: boolean;
      sessionProjectId: string;
      shellVisible: boolean;
      workspace: string;
      projectName: string;
      clipTimes: string[];
      toast: string;
    }>(`
      const href = location.href;
      const shell = document.querySelector("#editor-shell");
      const session = JSON.parse(sessionStorage.getItem(
        "kirinuki:local-web:active-usage-session"
      ) || "null");
      return {
        href,
        projectId: href.startsWith(arguments[0])
          ? new URL(href).searchParams.get("project") || ""
          : "",
        policyAbsent: document.querySelector("#editor-policy-gate") === null,
        sessionProjectId: session?.attestation?.target?.projectId || "",
        shellVisible: shell instanceof HTMLElement && !shell.hidden && !shell.inert,
        workspace: shell?.dataset.workspace || "",
        projectName: document.querySelector("#project-name")?.value || "",
        clipTimes: [...document.querySelectorAll(".clip-time")]
          .map((element) => element.textContent || ""),
        toast: document.querySelector("#toast")?.textContent || ""
      };
    `, [`${studioOrigin}/editor.html`]),
    (value) => (
      value.href.startsWith(`${studioOrigin}/editor.html`)
      && new URL(value.href).searchParams.get("session") !== "resume"
      && value.projectId.length > 0
      && value.projectId !== String(storedProject.id || "")
      && value.projectId !== isolatedEditorState.projectId
      && value.policyAbsent
      && value.sessionProjectId === value.projectId
      && value.shellVisible
      && value.workspace === "main"
      && value.projectName === abandonedProjectName
      && value.clipTimes.length === 1
      && value.clipTimes[0] === abandonedClipTime
    ),
    "탭 닫기 폐기용 새 프로젝트가 독립된 07:00~07:05 편집기로 열리지 않았습니다.",
    30_000
  );
  assert(
    !abandonedEditorState.toast.includes("자동으로 다시 연결하지 못했습니다")
      && !abandonedEditorState.toast.includes("편집 영상 다시 준비"),
    `탭 닫기 폐기용 새 프로젝트에 이전 편집 재연결 경고가 나타났습니다: ${abandonedEditorState.toast}`
  );
  const abandonedStorageBeforeClose = await waitFor(
    indexedDbSnapshot,
    (value) => {
      const candidate = value.projects.find((project) => (
        project.id === abandonedEditorState.projectId
      ));
      const clip = candidate?.clips?.[0];
      return (
        value.projects.length === 2
        && candidate?.name === abandonedProjectName
        && candidate.clips?.length === 1
        && clip?.selectionStartMs === abandonedStartMs
        && clip.selectionEndMs === abandonedEndMs
        && clip.sourceStartMs === abandonedStartMs
        && clip.sourceEndMs === abandonedEndMs
        && value.editingSessionCheckpoints.some((checkpoint) => (
          checkpoint.projectId === abandonedEditorState.projectId
          && checkpoint.baselineProject === null
        ))
        && !value.localDrafts.some((draft) => (
          draft.projectId === abandonedEditorState.projectId
          && draft.reason === "manual"
        ))
      );
    },
    "탭 닫기 폐기용 새 프로젝트의 CURRENT와 빈 baseline 체크포인트가 저장되지 않았습니다."
  );
  const abandonedVodRequest = await waitForNetworkRequest(
    (record) => (
      requestOrigin(record) === gatewayOrigin
      && record.method === "POST"
      && /^\/v1\/(?:vod|chzzk-vod)\/materializations$/u.test(requestPath(record))
      && requestJsonBody(record).consumerId === abandonedEditorState.projectId
    ),
    "탭 닫기 폐기용 새 프로젝트의 materialization이 시작되지 않았습니다.",
    30_000
  );
  const abandonedVodCancellation = await execute<{
    clicked: boolean;
    alreadyFinished: boolean;
  }>(`
    const dialog = document.querySelector("#job-dialog");
    const button = document.querySelector("#cancel-job");
    const active = dialog instanceof HTMLDialogElement
      && !dialog.hidden
      && dialog.open;
    if (active && button instanceof HTMLButtonElement && !button.disabled && !button.hidden) {
      button.click();
      return { clicked: true, alreadyFinished: false };
    }
    return { clicked: false, alreadyFinished: !active };
  `);
  assert(
    abandonedVodCancellation.clicked || abandonedVodCancellation.alreadyFinished,
    "탭 닫기 폐기용 materialization을 안전하게 정리하지 못했습니다."
  );
  if (abandonedVodCancellation.clicked) {
    await waitFor(
      () => execute<boolean>(`
        const dialog = document.querySelector("#job-dialog");
        return !(dialog instanceof HTMLDialogElement) || dialog.hidden || !dialog.open;
      `),
      Boolean,
      "탭 닫기 폐기용 VOD job 취소 뒤 편집기 잠금이 풀리지 않았습니다.",
      30_000
    );
  }
  // Deliberately do not click "임시저장" here. This phase represents the
  // default no-save intent: closing a brand-new editor tab must discard its
  // CURRENT row and checkpoint. Explicit manual drafts are a separate user
  // intent and are verified as recoverable earlier in this acceptance run.
  await webdriver("DELETE", `/session/${sessionId}/window`);
  await webdriver(
    "POST",
    `/session/${sessionId}/window`,
    { handle: survivingStartHandle }
  );
  const abandonedWriterLockName =
    `kirinuki:local-web:project-writer:${abandonedEditorState.projectId}`;
  await waitFor(
    () => executeAsync<boolean>(`
      const lockName = arguments[0];
      const done = arguments[arguments.length - 1];
      navigator.locks.query()
        .then((state) => done(!state.held.some((lock) => lock.name === lockName)))
        .catch(() => done(false));
    `, [abandonedWriterLockName]),
    Boolean,
    "실제 편집기 탭을 닫은 뒤 프로젝트 writer lock이 해제되지 않았습니다."
  );
  const projectScopedStores = [
    "projects",
    "local-drafts",
    "image-assets",
    "short-video-caches",
    "media-handles",
    "editing-session-checkpoints"
  ];
  const storageAfterAbandonedCleanup = await waitFor(
    indexedDbSnapshot,
    (value) => (
      value.projects.length === 1
      && value.projects[0]?.id === storedProject.id
      && !value.localDrafts.some((draft) => (
        draft.projectId === abandonedEditorState.projectId
      ))
      && !value.editingSessionCheckpoints.some((checkpoint) => (
        checkpoint.projectId === abandonedEditorState.projectId
      ))
      && projectScopedStores.every((storeName) => (
        Number(value.counts[storeName] || 0)
          === Number(storageAfterDelete.counts[storeName] || 0)
      ))
    ),
    "시작 탭 재활성화 뒤 닫힌 새 편집 세션의 프로젝트·종속 데이터·체크포인트가 baseline으로 자동 정리되지 않았습니다.",
    30_000
  );
  assert(
    JSON.stringify(storageAfterAbandonedCleanup.projects[0])
      === originalProjectBeforeIsolatedEntry,
    `닫힌 새 편집 세션 정리가 기존 CURRENT를 변경했습니다: ${JSON.stringify(storageAfterAbandonedCleanup.projects[0])}`
  );
  const projectManagerAfterAbandonedCleanup = await waitFor(
    () => execute<{
      href: string;
      managerBusy: boolean;
      projectRows: number;
      originalRows: number;
      abandonedRows: number;
    }>(`
      const rows = [...document.querySelectorAll(".local-project-row")];
      return {
        href: location.href,
        managerBusy: document.querySelector("#recent-section")?.getAttribute("aria-busy") === "true",
        projectRows: rows.length,
        originalRows: rows.filter((row) => row.dataset.projectId === arguments[0]).length,
        abandonedRows: rows.filter((row) => row.dataset.projectId === arguments[1]).length
      };
    `, [String(storedProject.id || ""), abandonedEditorState.projectId]),
    (value) => (
      value.href === `${studioOrigin}/`
      && !value.managerBusy
      && value.projectRows === 1
      && value.originalRows === 1
      && value.abandonedRows === 0
    ),
    "닫힌 새 편집 세션 정리 뒤 프로젝트 관리자가 기존 편집 하나만 표시하지 않았습니다."
  );

  phase = "network-and-console-audit";
  await drainPerformanceLogs();
  const unexpectedStudioMethods = networkRequests.filter((record) => (
    requestOrigin(record) === studioOrigin
    && !["GET", "HEAD"].includes(record.method)
  ));
  assert(
    unexpectedStudioMethods.length === 0,
    `4320 Studio가 정적 GET/HEAD 외 요청을 받았습니다: ${JSON.stringify(
      unexpectedStudioMethods.map((record) => ({
        method: record.method,
        path: requestPath(record)
      }))
    )}`
  );
  const browserLogs = await collectBrowserLogs();
  const fatalConsole = browserLogs.filter((entry) => {
    const level = String(entry.level || "").toUpperCase();
    const message = String(entry.message || "");
    const isMissingFavicon = message.includes(`${studioOrigin}/favicon.ico`)
      && /\b404\b/u.test(message);
    const isExpectedWriterLockRefusal = writerLockAudit.competingTabRefused
      && message.includes("이 프로젝트가 이미 다른 탭에서 편집 중입니다.");
    return level === "SEVERE" && (
      !isMissingFavicon
      && !isExpectedWriterLockRefusal
      && (
        /\b(?:Uncaught|Error|TypeError|ReferenceError|SyntaxError)\b/u.test(message)
        || (
          message.includes(studioOrigin)
          && /Failed to load resource|ERR_/u.test(message)
        )
      )
    );
  });
  assert(
    fatalConsole.length === 0,
    `Kirinuki top-level browser/console 오류가 있습니다: ${JSON.stringify(fatalConsole)}`
  );

  const studioMethods = [...new Set(networkRequests
    .filter((record) => requestOrigin(record) === studioOrigin)
    .map((record) => record.method))].sort();
  const gatewayRequests = networkRequests
    .filter((record) => requestOrigin(record) === gatewayOrigin)
    .map((record) => ({
      method: record.method,
      path: requestPath(record),
      status: record.responseStatus,
      failed: Boolean(record.failure)
    }));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: liveVod ? "live-vod" : "job-start-and-cancel",
    runtime: {
      studio: studioMode,
      captionStack: captionStackMode,
      chromium: path.basename(chromium),
      chromedriver: path.basename(chromedriver),
      cdp: "isolated-loopback"
    },
    staticAssetCache: staticCacheAudit,
    cleanStart: {
      browserStorage: "empty",
      indexedDb: "empty",
      projectManager: "visible-empty",
      projectRows: initial.projectRows
    },
    editor: {
      clipTime: editorState.clipTime,
      indexedDbCurrent: {
        projects: storage.counts.projects,
        alignmentOffsetMs: storedProject.alignmentOffsetMs,
        sourceStartMs: storedClip.sourceStartMs,
        sourceEndMs: storedClip.sourceEndMs
      },
      persistence: {
        semanticMutation: mutatedProject.name,
        currentUpdated: true,
        fiveMinuteAutosave: fiveMinuteAutosaveAudit,
        manualDrafts: manualDraftStorage.counts["local-drafts"],
        manualDraftReason: manualDraft.reason
      },
      writerLock: {
        ...writerLockAudit,
        primaryProjectName: primaryEditorAfterLock.projectName,
        primaryClipTime: primaryEditorAfterLock.clipTime
      },
      recovery: {
        recentSummary: recentState.summary,
        acknowledgementsRechecked: recoveryPolicyState.acknowledgementCount,
        dialogOpen: recoveryEditorState.draftDialogOpen,
        draftChoices: recoveryEditorState.draftChoices,
        clipTime: recoveryEditorState.clipTime,
        currentProjects: recoveredStorage.counts.projects,
        cookies: "absent"
      },
      sameVodFreshProject: {
        intent: isolatedIntent.status,
        submitText: isolatedIntent.submitText,
        acknowledgementsRechecked: isolatedIntent.acknowledgementCount,
        originalProjectId: storedProject.id,
        isolatedProjectId: isolatedEditorState.projectId,
        clipTimes: isolatedEditorState.clipTimes,
        currentClipCount: isolatedProject.clips?.length,
        originalProjectUnchanged:
          JSON.stringify(originalAfterIsolatedEntry) === originalProjectBeforeIsolatedEntry,
        isolatedClip: {
          selectionStartMs: isolatedClip.selectionStartMs,
          selectionEndMs: isolatedClip.selectionEndMs,
          sourceStartMs: isolatedClip.sourceStartMs,
          sourceEndMs: isolatedClip.sourceEndMs
        },
        request: {
          method: isolatedVodRequest.method,
          path: requestPath(isolatedVodRequest),
          consumerId: isolatedVodRequestBody.consumerId,
          reusedMaterialization: (
            "resume" in isolatedVodRequestBody || "base" in isolatedVodRequestBody
          )
        },
        staleReconnectWarning: "absent",
        vodJob: isolatedVodCancellation.clicked ? "cancelled" : "already-finished"
      },
      projectManager: {
        rowsBeforeDelete: twoProjectManagerState.projectRows,
        continueProjectId: isolatedEditorState.projectId,
        continueAcknowledgementsRechecked:
          isolatedContinuePolicy.acknowledgementCount,
        continueClipTime: isolatedContinueEditor.clipTimes[0],
        deleteDialogTitle: deleteDialogState.title,
        deleteCancelPreserved: true,
        rowsAfterDelete: projectManagerAfterDelete.projectRows,
        originalProjectPreserved: true
      },
      sessionLifecycle: {
        explicitSave: {
          newProject: originalSaveExit.action,
          recoveredProject: recoverySaveExit.action,
          isolatedProject: isolatedSaveExit.action,
          checkpointCountAfterExit: 0
        },
        explicitDiscard: {
          action: isolatedDiscardExit.action,
          mutation: discardedMutationName,
          exactBaselineRestored: true,
          checkpointCountAfterExit: storageAfterSessionDiscard
            .editingSessionCheckpoints.length
        },
        abandonedTabClose: {
          actualWindowClose: true,
          projectId: abandonedEditorState.projectId,
          clipTime: abandonedEditorState.clipTimes[0],
          baselineProject: abandonedStorageBeforeClose
            .editingSessionCheckpoints.find((checkpoint) => (
              checkpoint.projectId === abandonedEditorState.projectId
            ))?.baselineProject ?? null,
          explicitDraftCreated: false,
          automaticOnSurvivingTabActivation: true,
          manualRefreshRequired: false,
          materialization: {
            method: abandonedVodRequest.method,
            path: requestPath(abandonedVodRequest),
            outcome: abandonedVodCancellation.clicked
              ? "cancelled"
              : "already-finished"
          },
          projectScopedCountsRestored: projectScopedStores.reduce<
            Record<string, number>
          >((counts, storeName) => {
            counts[storeName] = Number(
              storageAfterAbandonedCleanup.counts[storeName] || 0
            );
            return counts;
          }, {}),
          rowsAfterCleanup: projectManagerAfterAbandonedCleanup.projectRows,
          abandonedProjectRemoved: true,
          dependentDataRemoved: true,
          checkpointRemoved: true,
          originalProjectPreserved: true
        }
      }
    },
    vod: {
      request: { method: vodRequest.method, path: requestPath(vodRequest) },
      outcome: liveVod ? "completed" : "observed-and-cancelled"
    },
    whisper: {
      state: whisper.state,
      model: whisper.model,
      pickerCalls: whisper.pickerCalls,
      capability: {
        method: whisperCapabilityRequest.method,
        path: requestPath(whisperCapabilityRequest)
      }
    },
    network: {
      studioMethods,
      gatewayRequests
    },
    console: {
      entries: browserLogs.length,
      expectedWriterLockRefusal: browserLogs.some((entry) => (
        String(entry.level).toUpperCase() === "SEVERE"
        && String(entry.message).includes(
          "이 프로젝트가 이미 다른 탭에서 편집 중입니다."
        )
      )),
      severe: browserLogs.filter((entry) => String(entry.level).toUpperCase() === "SEVERE")
        .map((entry) => String(entry.message))
    }
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  await drainPerformanceLogs().catch(() => undefined);
  const [browserLogs, page] = await Promise.all([
    collectBrowserLogs(),
    currentPageDiagnostic()
  ]);
  process.stderr.write(`localhost 사용자 인수 실패 [${phase}]: ${errorMessage(error)}\n`);
  process.stderr.write(`${JSON.stringify({
    phase,
    page,
    network: networkRequests
      .filter((record) => {
        const origin = requestOrigin(record);
        return origin === studioOrigin || origin === gatewayOrigin;
      })
      .map((record) => ({
        method: record.method,
        origin: requestOrigin(record),
        path: requestPath(record),
        status: record.responseStatus,
        failure: record.failure
      })),
    console: browserLogs
  }, null, 2)}\n`);
  if (driverOutput.trim()) {
    process.stderr.write(`ChromeDriver 최근 출력:\n${driverOutput.trim()}\n`);
  }
  if (studioOutput.trim()) {
    process.stderr.write(`localhost Studio 최근 출력:\n${studioOutput.trim()}\n`);
  }
  if (captionStackOutput.trim()) {
    process.stderr.write(`Whisper/gateway 최근 출력:\n${captionStackOutput.trim()}\n`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
