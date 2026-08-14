#!/usr/bin/env node

/**
 * Opt-in network-backed smoke for the localhost Studio.
 *
 * The cut phase controls only the platform streaming iframe through the
 * production streaming companion. No VOD byte is requested from 4319 until a
 * finalized range enters the editor. The editor phase then verifies the
 * production ±10 second materialization, byte-range media response, and exact
 * artifact cleanup.
 *
 *   KIRINUKI_LIVE_VOD_SMOKE=1 npm run test:browser:live-vod
 *   KIRINUKI_LIVE_VOD_PLATFORM=SOOP ...  # focused live fixture
 */

import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const studioOrigin = "http://127.0.0.1:4320";
const gatewayOrigin = "http://127.0.0.1:4319";
const captionProtocol = "chzzk-kirinuki-caption-request/v1";
const fixtureTimeoutMs = boundedTimeout(
  process.env.KIRINUKI_LIVE_VOD_TIMEOUT_MS,
  10 * 60_000
);
const tempRoot = await mkdtemp(
  path.join(os.tmpdir(), "kirinuki-live-vod-smoke-")
);
const profileRoot = path.join(tempRoot, "chromium-profile");
const companionRoot = path.join(root, "streaming-companion");

const allFixtures = Object.freeze([
  {
    platform: "CHZZK",
    label: "치지직 VOD",
    contentId: "14514980",
    sourceUrl: "https://chzzk.naver.com/video/14514980",
    embedUrl: "https://chzzk.naver.com/video/14514980"
  },
  {
    platform: "SOOP",
    label: "SOOP VOD",
    contentId: "169475287",
    sourceUrl: "https://vod.sooplive.co.kr/player/169475287?change_second=3",
    embedUrl:
      "https://vod.sooplive.com/player/169475287/embed?autoPlay=true&showChat=false&mutePlay=true"
  }
] as const);
const requestedPlatform = String(
  process.env.KIRINUKI_LIVE_VOD_PLATFORM || ""
).trim().toUpperCase();
if (requestedPlatform && requestedPlatform !== "CHZZK" && requestedPlatform !== "SOOP") {
  throw new Error("KIRINUKI_LIVE_VOD_PLATFORM은 CHZZK 또는 SOOP이어야 합니다.");
}
const fixtures = Object.freeze(allFixtures.filter((fixture) => (
  !requestedPlatform || fixture.platform === requestedPlatform
)));

interface BrowserSession {
  sessionId?: unknown;
}

interface BrowserLogEntry {
  level?: unknown;
  source?: unknown;
  message?: unknown;
}

interface RuntimeHealth {
  readonly studio: string;
  readonly gateway: string;
  readonly vodRuntime: string;
}

interface FixtureDefinition {
  readonly platform: "CHZZK" | "SOOP";
  readonly label: string;
  readonly contentId: string;
  readonly sourceUrl: string;
  readonly embedUrl: string;
}

interface EditorMaterializationState {
  readonly ready: boolean;
  readonly mediaUrl: string;
  readonly duration: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly clipTime: string;
  readonly request: unknown;
  readonly materialization: unknown;
  readonly toast: string;
  readonly diagnostics: readonly unknown[];
}

interface EditorClockMappingProof {
  readonly selectionStartMs: number;
  readonly selectionEndMs: number;
  readonly editableSourceStartMs: number;
  readonly editableSourceEndMs: number;
  readonly localSelectionStartMs: number;
  readonly localSelectionEndMs: number;
  readonly mediaDurationMs: number;
  readonly expectedHandleMs: 10_000;
}

interface MediaHttpProof {
  readonly headStatus: number;
  readonly rangeStatus: number;
  readonly contentType: string;
  readonly contentLength: number;
  readonly rangeBytes: number;
  readonly contentRange: string;
}

interface FixtureCleanupResult {
  readonly action: "exact-cache-purge" | "exact-job-cancel" | "none";
  readonly performed: boolean;
  readonly httpStatus: number | null;
  readonly terminalState: string;
  readonly releasedBytes: number;
}

interface FixtureResult {
  readonly platform: string;
  readonly contentId: string;
  readonly startCaptured: string;
  readonly afterForwardFive: string;
  readonly endCaptured: string;
  readonly iframePreserved: true;
  readonly cutAcquisitionRequests: 0;
  readonly editorMaterialization: {
    readonly durationSeconds: number;
    readonly videoSize: string;
    readonly clockMapping: EditorClockMappingProof;
    readonly http: MediaHttpProof;
  };
  readonly cleanup: FixtureCleanupResult;
}

interface CutOnlyFixtureResult {
  readonly platform: string;
  readonly contentId: string;
  readonly startCaptured: string;
  readonly afterForwardFive: string;
  readonly endCaptured: string;
  readonly iframePreserved: true;
  readonly cutAcquisitionRequests: 0;
}

type ManagedChild = ChildProcess & {
  stdout: Readable;
  stderr: Readable;
};

let driver: ManagedChild | null = null;
let driverPort = 0;
let driverOutput = "";
let sessionId = "";
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

function boundedTimeout(value: unknown, fallback: number): number {
  if (value === undefined || String(value).trim() === "") {
    return fallback;
  }
  const milliseconds = Number(value);
  if (
    !Number.isSafeInteger(milliseconds)
    || milliseconds < 60_000
    || milliseconds > 30 * 60_000
  ) {
    throw new Error(
      "KIRINUKI_LIVE_VOD_TIMEOUT_MS는 60000~1800000 범위의 정수여야 합니다."
    );
  }
  return milliseconds;
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
  assert(Number.isInteger(port) && port >= 1_024, "ChromeDriver 포트를 받지 못했습니다.");
  return port;
}

async function fetchJson(
  url: string,
  {
    method = "GET",
    headers,
    body,
    timeoutMs = 30_000
  }: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const init: RequestInit = {
    method,
    ...(headers === undefined ? {} : { headers }),
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (body !== undefined) {
    init.headers = { ...headers, "content-type": "application/json" };
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
    const nested = isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : null;
    throw new Error(
      `${method} ${url} 실패 (${response.status}): ${String(
        nested?.message || response.statusText
      )}`
    );
  }
  return payload;
}

async function assertRunningRuntimes(): Promise<RuntimeHealth> {
  const studio = await fetchJson(`${studioOrigin}/v1/studio/health`, {
    timeoutMs: 3_000
  });
  assert(
    isRecord(studio)
      && studio.schema === "kirinuki-local-studio-server/health-v1"
      && studio.status === "ok",
    "실행 중인 localhost Studio(4320)의 정확한 health를 확인하지 못했습니다."
  );
  const gateway = await fetchJson(`${gatewayOrigin}/v1/health`, {
    headers: {
      Origin: studioOrigin,
      "X-Kirinuki-Protocol": captionProtocol
    },
    timeoutMs: 3_000
  });
  assert(
    isRecord(gateway)
      && gateway.schema === "chzzk-kirinuki-caption-agent/health-v1"
      && isRecord(gateway.vodRuntime)
      && gateway.vodRuntime.ready === true,
    "실행 중인 VOD gateway(4319)의 검증된 runtime이 준비되지 않았습니다."
  );
  return {
    studio: String(studio.schema),
    gateway: String(gateway.schema),
    vodRuntime: String(gateway.vodRuntime.kind || "ready")
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
      // ChromeDriver가 loopback 포트에 바인딩될 때까지 재시도한다.
    }
    await delay(100);
  }
  throw new Error(
    `ChromeDriver가 10초 안에 준비되지 않았습니다.\n${driverOutput.trim()}`
  );
}

async function execute<T>(
  script: string,
  args: readonly unknown[] = []
): Promise<T> {
  return webdriver<T>(
    "POST",
    `/session/${sessionId}/execute/sync`,
    { script, args }
  );
}

async function executeAsync<T>(
  script: string,
  args: readonly unknown[] = [],
  timeoutMs = 30_000
): Promise<T> {
  return webdriver<T>(
    "POST",
    `/session/${sessionId}/execute/async`,
    { script, args },
    timeoutMs
  );
}

async function cdp<T>(
  cmd: string,
  params: Record<string, unknown>
): Promise<T> {
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
      // navigation 중 사라진 execution context는 재시도한다.
    }
    await delay(100);
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`);
}

function parseTimecode(value: unknown): number | null {
  const parts = String(value || "").trim().split(":");
  if (parts.length !== 3 || parts.some((part) => !/^\d+(?:\.\d{1,3})?$/u.test(part))) {
    return null;
  }
  const [hours, minutes, seconds] = parts.map(Number);
  if (
    hours === undefined
    || minutes === undefined
    || seconds === undefined
    || minutes >= 60
    || seconds >= 60
  ) {
    return null;
  }
  return hours * 3_600 + minutes * 60 + seconds;
}

function movedStreamingTime(status: unknown): number | null {
  const match = /원본 스트리밍을\s+(\d{1,4}:\d{2}:\d{2}(?:\.\d{1,3})?)로 이동했습니다/u
    .exec(String(status || ""));
  return match ? parseTimecode(match[1]) : null;
}

function editorGatewayObserverSource(): string {
  return `
    (() => {
      if (
        location.origin !== ${JSON.stringify(studioOrigin)}
        || globalThis.__kirinukiLiveVodEditorObserver
      ) return;
      const gatewayOrigin = ${JSON.stringify(gatewayOrigin)};
      const originalFetch = globalThis.fetch.bind(globalThis);
      const state = {
        authorization: "",
        jobId: "",
        request: null,
        completed: null,
        diagnostics: []
      };
      const safeText = (value, maximum = 1000) => String(value || "")
        .replace(/[\\u0000-\\u001f\\u007f]/gu, " ")
        .trim()
        .slice(0, maximum);
      const routeFor = (pathname) => {
        if (/^\\/v1\\/(?:vod|chzzk-vod)\\/materializations$/u.test(pathname)) {
          return "collection";
        }
        if (/^\\/v1\\/(?:vod|chzzk-vod)\\/materializations\\/[A-Za-z0-9_-]+\\/cache$/u.test(pathname)) {
          return "cache";
        }
        if (/^\\/v1\\/(?:vod|chzzk-vod)\\/materializations\\/[A-Za-z0-9_-]+$/u.test(pathname)) {
          return "job";
        }
        return null;
      };
      const mergedHeaders = (input, init) => {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        return headers;
      };
      globalThis.fetch = async (input, init = {}) => {
        const raw = input instanceof Request ? input.url : String(input);
        let url;
        try {
          url = new URL(raw, location.href);
        } catch {
          return originalFetch(input, init);
        }
        const method = String(
          init.method || (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const route = url.origin === gatewayOrigin ? routeFor(url.pathname) : null;
        if (route === "collection" && method === "POST" && typeof init.body === "string") {
          try {
            const request = JSON.parse(init.body);
            state.request = {
              schema: request.schema,
              sourceUrl: request.sourceUrl,
              sourceClockIdentity: request.sourceClockIdentity,
              clips: request.clips,
              editableRanges: request.editableRanges,
              handleMs: request.handleMs
            };
          } catch {
            state.request = null;
          }
        }
        if (route === "collection" || route === "job") {
          const authorization = mergedHeaders(input, init).get("authorization") || "";
          if (/^Bearer [^\\s]+$/u.test(authorization)) {
            state.authorization = authorization;
          }
        }
        const response = await originalFetch(input, init);
        if (route) {
          let payload = null;
          try {
            payload = await response.clone().json();
          } catch {
            // JSON이 아닌 진단 응답은 body를 보관하지 않는다.
          }
          const record = payload && typeof payload === "object" ? payload : {};
          if (/^[A-Za-z0-9_-]{16,128}$/u.test(String(record.jobId || ""))) {
            state.jobId = String(record.jobId);
          }
          state.diagnostics.push({
            method,
            route,
            httpStatus: response.status,
            state: safeText(record.state, 40),
            code: safeText(record.error?.code, 80),
            message: safeText(record.message)
          });
          state.diagnostics.splice(0, Math.max(0, state.diagnostics.length - 24));
          if (
            record.state === "completed"
            && record.media && typeof record.media === "object"
            && record.materialization && typeof record.materialization === "object"
          ) {
            state.completed = {
              jobId: state.jobId,
              mediaUrl: String(record.media.url || ""),
              materialization: structuredClone(record.materialization)
            };
          }
        }
        return response;
      };
      state.cleanup = async () => {
        const video = document.querySelector("#preview-video");
        if (video instanceof HTMLVideoElement) {
          video.pause();
          video.removeAttribute("src");
          video.load();
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const authorization = state.authorization;
        const completed = state.completed;
        if (completed && authorization) {
          const jobId = String(completed.jobId || "");
          const mediaUrl = new URL(completed.mediaUrl);
          const access = mediaUrl.searchParams.get("access") || "";
          const materialization = completed.materialization;
          const materializationId = String(materialization.materializationId || "");
          const planFingerprint = String(materialization.planFingerprint || "");
          const source = materialization.source && typeof materialization.source === "object"
            ? materialization.source
            : {};
          const platform = String(source.platform || "");
          const contentId = String(source.contentId || "");
          const sourceVersionId = String(source.sourceVersionId || "");
          if (
            !/^[A-Za-z0-9_-]{16,128}$/u.test(jobId)
            || mediaUrl.origin !== gatewayOrigin
            || mediaUrl.pathname !== "/v1/vod/media/" + jobId
            || !access
            || !/^[a-f0-9]{32}$/u.test(materializationId)
            || !/^[a-f0-9]{64}$/u.test(planFingerprint)
            || materializationId !== planFingerprint.slice(0, 32)
            || !["CHZZK", "YOUTUBE", "SOOP"].includes(platform)
            || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
            || !/^[a-f0-9]{64}$/u.test(sourceVersionId)
          ) {
            throw new Error("exact editor materialization cleanup identity 검증 실패");
          }
          let response;
          let payload = null;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            response = await originalFetch(
              gatewayOrigin + "/v1/vod/materializations/"
                + encodeURIComponent(jobId) + "/cache",
              {
                method: "DELETE",
                headers: {
                  Authorization: authorization,
                  "Content-Type": "application/json",
                  "X-Kirinuki-Protocol":
                    "chzzk-kirinuki-vod-cache-purge-request/v1",
                  "X-Kirinuki-Media-Access": access
                },
                body: JSON.stringify({
                  schema: "chzzk-kirinuki-vod-cache-purge-request/v1",
                  jobId,
                  materialization: { materializationId, planFingerprint },
                  source: { platform, contentId, sourceVersionId }
                }),
                cache: "no-store",
                credentials: "omit",
                redirect: "error"
              }
            );
            payload = await response.clone().json().catch(() => null);
            if (response.ok || response.status !== 409) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!response?.ok) {
            throw new Error(
              "exact editor cache cleanup 실패: HTTP " + String(response?.status || 0)
            );
          }
          return {
            action: "exact-cache-purge",
            performed: true,
            httpStatus: response.status,
            terminalState: safeText(payload?.state, 40),
            releasedBytes: Number(payload?.releasedBytes) || 0
          };
        }
        if (state.jobId && authorization) {
          const response = await originalFetch(
            gatewayOrigin + "/v1/vod/materializations/"
              + encodeURIComponent(state.jobId),
            {
              method: "DELETE",
              headers: {
                Authorization: authorization,
                "X-Kirinuki-Protocol":
                  "chzzk-kirinuki-vod-materialization-request/v3"
              },
              cache: "no-store",
              credentials: "omit",
              redirect: "error"
            }
          );
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error("exact editor materialization cancel 실패: HTTP " + response.status);
          }
          return {
            action: "exact-job-cancel",
            performed: true,
            httpStatus: response.status,
            terminalState: safeText(payload?.state, 40),
            releasedBytes: 0
          };
        }
        return {
          action: "none",
          performed: false,
          httpStatus: null,
          terminalState: "not-created",
          releasedBytes: 0
        };
      };
      globalThis.__kirinukiLiveVodEditorObserver = state;
    })();
  `;
}

async function installEditorGatewayObserver(): Promise<void> {
  await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: editorGatewayObserverSource()
  });
}

async function drainPerformanceLogs(): Promise<BrowserLogEntry[]> {
  return webdriver<BrowserLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "performance" }
  );
}

function gatewayRequestCount(entries: readonly BrowserLogEntry[]): number {
  return entries.filter((entry) => {
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
        && String(request.url || "").startsWith(`${gatewayOrigin}/`);
    } catch {
      return false;
    }
  }).length;
}

async function openStudio(): Promise<void> {
  await webdriver("POST", `/session/${sessionId}/url`, {
    url: `${studioOrigin}/`
  });
  await waitFor(
    () => execute<{ ready: string; captureUi: boolean }>(`
      return {
        ready: document.readyState,
        captureUi: Boolean(
          document.querySelector("#stream-preview-frame")
          && document.querySelector("#capture-start")
          && document.querySelector("#capture-end")
          && document.querySelector("#seek-forward-five")
        )
      };
    `),
    (state) => (
      (state.ready === "interactive" || state.ready === "complete")
      && state.captureUi
    ),
    "실행 중인 Studio가 streaming cut UI를 포함한 최신 build가 아닙니다."
  );
}

async function configureFixture(
  fixture: FixtureDefinition,
  runSuffix: string
): Promise<void> {
  const configured = await execute<{
    acknowledgementCount: number;
    rowCount: number;
  }>(`
    const source = document.querySelector("#source-url");
    const projectName = document.querySelector("#project-name");
    const row = document.querySelector(".clip-row");
    if (
      !(source instanceof HTMLInputElement)
      || !(projectName instanceof HTMLInputElement)
      || !(row instanceof HTMLElement)
    ) {
      throw new Error("streaming fixture 입력 UI가 없습니다.");
    }
    const start = row.querySelector('[data-field="start"]');
    const end = row.querySelector('[data-field="end"]');
    const note = row.querySelector('[data-field="note"]');
    if (
      !(start instanceof HTMLInputElement)
      || !(end instanceof HTMLInputElement)
      || !(note instanceof HTMLInputElement)
    ) {
      throw new Error("첫 구간 입력 UI가 없습니다.");
    }
    source.value = arguments[0];
    source.dispatchEvent(new Event("input", { bubbles: true }));
    projectName.value = arguments[1];
    projectName.dispatchEvent(new Event("input", { bubbles: true }));
    row.dataset.selectionId = arguments[2];
    start.value = "";
    end.value = "";
    note.value = "";
    for (const input of [start, end, note]) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const acknowledgements = [...document.querySelectorAll("[data-ack]")];
    for (const input of acknowledgements) {
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("권리 확인 입력 형식이 올바르지 않습니다.");
      }
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return {
      acknowledgementCount: acknowledgements.length,
      rowCount: document.querySelectorAll(".clip-row").length
    };
  `, [
    fixture.sourceUrl,
    `live-vod-smoke-${fixture.platform.toLowerCase()}-${runSuffix}`,
    `live-smoke-${fixture.platform.toLowerCase()}-${runSuffix}`
  ]);
  assert(
    configured.acknowledgementCount === 6 && configured.rowCount === 1,
    `${fixture.platform} 빈 첫 행·권리 6체크를 구성하지 못했습니다.`
  );
  await waitFor(
    () => execute<{
      label: string;
      frameUrl: string;
      frameHidden: boolean;
      controlsEnabled: boolean;
      status: string;
    }>(`
      const frame = document.querySelector("#stream-preview-frame");
      return {
        label: document.querySelector("#source-platform")?.textContent || "",
        frameUrl: frame instanceof HTMLIFrameElement ? frame.src : "",
        frameHidden: !(frame instanceof HTMLIFrameElement) || frame.hidden,
        controlsEnabled: [
          "capture-start",
          "capture-end",
          "seek-forward-five"
        ].every((id) => {
          const button = document.querySelector("#" + id);
          return button instanceof HTMLButtonElement && !button.disabled;
        }),
        status: document.querySelector("#stream-cut-console-status")?.textContent || ""
      };
    `),
    (state) => (
      state.label === fixture.label
      && state.frameUrl === fixture.embedUrl
      && state.frameHidden === false
      && state.controlsEnabled
      && state.status.includes("원본 스트리밍 연결 완료")
    ),
    `${fixture.platform} production companion이 원본 iframe을 제어하지 못했습니다.`,
    30_000
  );
}

async function pressShortcut(key: string): Promise<boolean> {
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

async function currentCutState(): Promise<{
  start: string;
  end: string;
  clock: string;
  status: string;
  iframeVisible: boolean;
  iframePreserved: boolean;
}> {
  return execute(`
    const row = document.querySelector(".clip-row");
    const frame = document.querySelector("#stream-preview-frame");
    const clock = document.querySelector("#stream-current-time");
    return {
      start: row?.querySelector('[data-field="start"]')?.value || "",
      end: row?.querySelector('[data-field="end"]')?.value || "",
      clock: clock instanceof HTMLOutputElement
        ? clock.value
        : clock?.textContent || "",
      status: document.querySelector("#stream-cut-console-status")?.textContent || "",
      iframeVisible: frame instanceof HTMLIFrameElement
        && frame.hidden === false
        && frame.getBoundingClientRect().width > 0
        && frame.getBoundingClientRect().height > 0,
      iframePreserved: frame === globalThis.__kirinukiLiveStreamingFrame
    };
  `);
}

async function runCutPhase(
  fixture: FixtureDefinition
): Promise<{
  start: string;
  afterForwardFive: string;
  end: string;
  iframePreserved: true;
  acquisitionRequests: 0;
}> {
  await drainPerformanceLogs();
  await execute(`
    globalThis.__kirinukiLiveStreamingFrame =
      document.querySelector("#stream-preview-frame");
    return true;
  `);
  assert(await pressShortcut("Y"), `${fixture.platform} Y가 처리되지 않았습니다.`);
  await waitFor(
    currentCutState,
    (state) => state.status.includes("0.25배속으로 설정했습니다"),
    `${fixture.platform} live 컷 검증용 0.25배속을 적용하지 못했습니다.`,
    20_000
  );
  assert(await pressShortcut("E"), `${fixture.platform} E가 처리되지 않았습니다.`);
  const captured = await waitFor(
    currentCutState,
    (state) => parseTimecode(state.start) !== null,
    `${fixture.platform} E가 원본 스트리밍 시각을 캡처하지 못했습니다.`,
    20_000
  );
  const startSeconds = parseTimecode(captured.start);
  assert(startSeconds !== null, `${fixture.platform} 시작 시각을 해석하지 못했습니다.`);

  assert(await pressShortcut("F"), `${fixture.platform} F가 처리되지 않았습니다.`);
  const afterForward = await waitFor(
    currentCutState,
    (state) => {
      const clock = parseTimecode(state.clock);
      const moved = movedStreamingTime(state.status);
      return clock !== null
        && moved !== null
        && moved >= startSeconds + 4.5
        && moved <= startSeconds + 15
        && clock >= moved - 0.5
        && clock <= moved + 2;
    },
    `${fixture.platform} F가 원본 스트리밍을 +5초 이동하지 못했습니다.`,
    20_000
  );

  assert(await pressShortcut("R"), `${fixture.platform} R이 처리되지 않았습니다.`);
  const movedTarget = movedStreamingTime(afterForward.status);
  assert(movedTarget !== null, `${fixture.platform} F 이동 결과 시각이 없습니다.`);
  const ended = await waitFor(
    currentCutState,
    (state) => {
      const end = parseTimecode(state.end);
      return end !== null
        && end > startSeconds
        && end >= movedTarget - 0.5
        && end <= movedTarget + 2.5;
    },
    `${fixture.platform} R이 이동한 원본 시각을 기록하지 못했습니다.`,
    20_000
  );
  assert(
    ended.iframeVisible && ended.iframePreserved,
    `${fixture.platform} E→F→R 도중 원본 streaming iframe이 교체·은닉됐습니다.`
  );
  const acquisitionRequests = gatewayRequestCount(await drainPerformanceLogs());
  assert(
    acquisitionRequests === 0,
    `${fixture.platform} 컷 단계에서 4319 acquisition이 ${acquisitionRequests}회 발생했습니다.`
  );
  return {
    start: captured.start,
    afterForwardFive: afterForward.clock,
    end: ended.end,
    iframePreserved: true,
    acquisitionRequests: 0
  };
}

async function enterEditor(): Promise<void> {
  assert(await pressShortcut("T"), "T 구간 확정 단축키가 처리되지 않았습니다.");
  await waitFor(
    () => execute<boolean>(`
      const rows = [...document.querySelectorAll(".clip-row")];
      return rows.length === 2 && rows[0]?.dataset.finalized === "true";
    `),
    Boolean,
    "T가 첫 구간 확정과 다음 행 추가를 완료하지 못했습니다."
  );
  assert(await pressShortcut("A"), "A 편집기 열기 단축키가 처리되지 않았습니다.");
  await waitFor(
    () => execute<{ href: string; shellVisible: boolean }>(`
      return {
        href: location.href,
        shellVisible: !document.querySelector("#editor-shell")?.hidden
      };
    `),
    (state) => (
      state.href.startsWith(`${studioOrigin}/editor.html?project=`)
      && state.shellVisible
    ),
    "정책 확인 뒤 localhost 편집기에 진입하지 못했습니다.",
    30_000
  );
}

async function currentEditorMaterializationState():
Promise<EditorMaterializationState> {
  return execute<EditorMaterializationState>(`
    const video = document.querySelector("#preview-video");
    const observer = globalThis.__kirinukiLiveVodEditorObserver;
    const completed = observer?.completed;
    const mediaUrl = String(
      completed?.mediaUrl
      || (video instanceof HTMLVideoElement ? video.currentSrc || video.src : "")
    );
    return {
      ready: Boolean(
        completed
        && mediaUrl
        && video instanceof HTMLVideoElement
        && video.readyState >= 1
        && Number.isFinite(video.duration)
        && video.duration > 0
        && video.videoWidth > 0
        && video.videoHeight > 0
      ),
      mediaUrl,
      duration: video instanceof HTMLVideoElement ? video.duration : NaN,
      videoWidth: video instanceof HTMLVideoElement ? video.videoWidth : 0,
      videoHeight: video instanceof HTMLVideoElement ? video.videoHeight : 0,
      clipTime: document.querySelector(".clip-time")?.textContent || "",
      request: structuredClone(observer?.request ?? null),
      materialization: structuredClone(completed?.materialization ?? null),
      toast: document.querySelector("#toast")?.textContent || "",
      diagnostics: Array.isArray(observer?.diagnostics)
        ? structuredClone(observer.diagnostics)
        : []
    };
  `);
}

function exactInteger(value: unknown, label: string): number {
  assert(Number.isSafeInteger(value), `${label}가 안전한 정수 밀리초가 아닙니다.`);
  return Number(value);
}

function proveEditorClockMapping(
  fixture: FixtureDefinition,
  cutPhase: Awaited<ReturnType<typeof runCutPhase>>,
  editorPhase: EditorMaterializationState
): EditorClockMappingProof {
  const startSeconds = parseTimecode(cutPhase.start);
  const endSeconds = parseTimecode(cutPhase.end);
  assert(startSeconds !== null && endSeconds !== null, `${fixture.platform} 컷 시각을 해석하지 못했습니다.`);
  const selectionStartMs = Math.round(startSeconds * 1_000);
  const selectionEndMs = Math.round(endSeconds * 1_000);
  const request = editorPhase.request;
  const materialization = editorPhase.materialization;
  assert(isRecord(request), `${fixture.platform} editor 시작 요청을 관찰하지 못했습니다.`);
  assert(isRecord(materialization), `${fixture.platform} 완료 materialization이 없습니다.`);
  assert(request.handleMs === 10_000, `${fixture.platform} editor 요청이 ±10초 계약과 다릅니다.`);
  assert(Array.isArray(request.clips) && request.clips.length === 1, `${fixture.platform} editor 요청 clip이 정확히 하나가 아닙니다.`);
  const requestedClip = request.clips[0];
  assert(isRecord(requestedClip), `${fixture.platform} editor 요청 clip 구조가 올바르지 않습니다.`);
  const clipId = String(requestedClip.id || "");
  assert(
    clipId
      && requestedClip.startMs === selectionStartMs
      && requestedClip.endMs === selectionEndMs,
    `${fixture.platform} streaming 컷과 editor 요청 좌표가 다릅니다.`
  );
  const displayed = editorPhase.clipTime.split("→").map((value) => parseTimecode(value));
  const displayedStart = displayed[0];
  const displayedEnd = displayed[1];
  assert(
    displayed.length === 2
      && displayedStart !== undefined
      && displayedStart !== null
      && displayedEnd !== undefined
      && displayedEnd !== null
      && Math.round(displayedStart * 1_000) === selectionStartMs
      && Math.round(displayedEnd * 1_000) === selectionEndMs,
    `${fixture.platform} 편집기 표시 컷 좌표가 streaming 선택과 다릅니다.`
  );
  assert(materialization.handleMs === 10_000, `${fixture.platform} 완료 handle이 10초가 아닙니다.`);
  assert(Array.isArray(materialization.clipRanges), `${fixture.platform} 완료 clipRanges가 없습니다.`);
  const coverage = materialization.clipRanges.find((candidate) => (
    isRecord(candidate) && candidate.clipId === clipId
  ));
  assert(isRecord(coverage), `${fixture.platform} 완료 clip coverage가 없습니다.`);
  assert(
    coverage.sourceStartMs === selectionStartMs
      && coverage.sourceEndMs === selectionEndMs,
    `${fixture.platform} 완료 materialization이 선택 원본 좌표와 다릅니다.`
  );
  const editableSourceStartMs = exactInteger(
    coverage.editableSourceStartMs,
    `${fixture.platform} editable 시작`
  );
  const editableSourceEndMs = exactInteger(
    coverage.editableSourceEndMs,
    `${fixture.platform} editable 끝`
  );
  const sourceDurationMs = exactInteger(
    materialization.sourceDurationMs,
    `${fixture.platform} 원본 길이`
  );
  assert(
    editableSourceStartMs === Math.max(0, selectionStartMs - 10_000)
      && editableSourceEndMs === Math.min(
        sourceDurationMs,
        selectionEndMs + 10_000
      ),
    `${fixture.platform} 완료 editable 범위가 선택 ±10초와 다릅니다.`
  );
  assert(Array.isArray(materialization.windows), `${fixture.platform} 완료 windows가 없습니다.`);
  const window = materialization.windows.find((candidate) => (
    isRecord(candidate)
      && Array.isArray(candidate.clipIds)
      && candidate.clipIds.includes(clipId)
  ));
  assert(isRecord(window), `${fixture.platform} 선택 clip의 로컬 window가 없습니다.`);
  assert(
    window.editableSourceStartMs === editableSourceStartMs
      && window.editableSourceEndMs === editableSourceEndMs,
    `${fixture.platform} clip coverage와 로컬 window가 다릅니다.`
  );
  const mediaStartMs = exactInteger(window.mediaStartMs, `${fixture.platform} window media 시작`);
  const mediaEndMs = exactInteger(window.mediaEndMs, `${fixture.platform} window media 끝`);
  const localSelectionStartMs = mediaStartMs + selectionStartMs - editableSourceStartMs;
  const localSelectionEndMs = mediaStartMs + selectionEndMs - editableSourceStartMs;
  const expectedLocalStartMs = Math.min(10_000, selectionStartMs);
  assert(
    localSelectionStartMs === expectedLocalStartMs
      && localSelectionEndMs - localSelectionStartMs === selectionEndMs - selectionStartMs,
    `${fixture.platform} 선택 원본이 로컬 media 시간축의 정확한 handle 위치에 있지 않습니다.`
  );
  const mediaDurationMs = exactInteger(
    materialization.mediaDurationMs,
    `${fixture.platform} materialization 길이`
  );
  assert(
    mediaEndMs - mediaStartMs === editableSourceEndMs - editableSourceStartMs
      && mediaDurationMs === mediaEndMs,
    `${fixture.platform} 로컬 window/media 길이가 source 범위와 다릅니다.`
  );
  assert(
    Math.abs(editorPhase.duration * 1_000 - mediaDurationMs) <= 250,
    `${fixture.platform} 실제 MP4 길이가 materialization 시간축과 다릅니다.`
  );
  return {
    selectionStartMs,
    selectionEndMs,
    editableSourceStartMs,
    editableSourceEndMs,
    localSelectionStartMs,
    localSelectionEndMs,
    mediaDurationMs,
    expectedHandleMs: 10_000
  };
}

async function waitForEditorMaterialization(
  fixture: FixtureDefinition
): Promise<EditorMaterializationState> {
  const startedAt = Date.now();
  let latest: EditorMaterializationState | undefined;
  while (Date.now() - startedAt < fixtureTimeoutMs) {
    latest = await currentEditorMaterializationState();
    if (latest.ready) {
      return latest;
    }
    if (
      latest.toast.includes("VOD 편집 영상을 준비하지 못했습니다")
      || latest.toast.includes("원본 미디어를 준비하지 못했습니다")
    ) {
      throw new Error(
        `${fixture.platform} editor materialization 실패: ${latest.toast} · ${JSON.stringify({ request: latest.request, diagnostics: latest.diagnostics.slice(-8) })}`
      );
    }
    await delay(250);
  }
  throw new Error(
    `${fixture.platform} editor materialization timeout: ${JSON.stringify(latest)}`
  );
}

async function proveMediaHttp(mediaUrlValue: string): Promise<MediaHttpProof> {
  const mediaUrl = new URL(mediaUrlValue);
  assert(
    mediaUrl.protocol === "http:"
      && (mediaUrl.hostname === "127.0.0.1" || mediaUrl.hostname === "localhost")
      && mediaUrl.port === "4319"
      && /^\/v1\/vod\/media\/[A-Za-z0-9_-]{16,128}$/u.test(mediaUrl.pathname)
      && [...mediaUrl.searchParams.keys()].every((key) => key === "access")
      && Boolean(mediaUrl.searchParams.get("access")),
    "editor가 받은 local media capability URL의 범위가 올바르지 않습니다."
  );
  const head = await fetch(mediaUrl, {
    method: "HEAD",
    headers: { Origin: studioOrigin },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000)
  });
  const contentLength = Number(head.headers.get("content-length"));
  const contentType = String(head.headers.get("content-type") || "")
    .split(";", 1)[0]?.trim().toLowerCase() || "";
  assert(
    head.status === 200
      && contentType === "video/mp4"
      && Number.isSafeInteger(contentLength)
      && contentLength > 0
      && head.headers.get("accept-ranges") === "bytes",
    `editor media HEAD 검증 실패: ${head.status} ${contentType} ${contentLength}`
  );
  const range = await fetch(mediaUrl, {
    method: "GET",
    headers: { Origin: studioOrigin, Range: "bytes=0-4095" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000)
  });
  const bytes = new Uint8Array(await range.arrayBuffer());
  const contentRange = String(range.headers.get("content-range") || "");
  assert(
    range.status === 206
      && bytes.byteLength > 0
      && bytes.byteLength <= 4_096
      && /^bytes 0-\d+\/\d+$/u.test(contentRange),
    `editor media range 검증 실패: ${range.status} ${contentRange}`
  );
  return {
    headStatus: head.status,
    rangeStatus: range.status,
    contentType,
    contentLength,
    rangeBytes: bytes.byteLength,
    contentRange
  };
}

async function cleanupEditorMaterialization():
Promise<FixtureCleanupResult> {
  const envelope = await executeAsync<{
    ok: boolean;
    result?: FixtureCleanupResult;
    error?: string;
  }>(`
    const done = arguments[arguments.length - 1];
    const observer = globalThis.__kirinukiLiveVodEditorObserver;
    if (!observer || typeof observer.cleanup !== "function") {
      done({ ok: false, error: "editor materialization cleanup 함수가 없습니다." });
      return;
    }
    Promise.resolve(observer.cleanup()).then(
      (result) => done({ ok: true, result }),
      (error) => done({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  `, [], 45_000);
  if (!envelope.ok || !envelope.result) {
    throw new Error(envelope.error || "editor exact cleanup 결과가 없습니다.");
  }
  return envelope.result;
}

async function runFixture(
  fixture: FixtureDefinition,
  runSuffix: string
): Promise<FixtureResult> {
  await openStudio();
  await configureFixture(fixture, runSuffix);
  let cutPhase: Awaited<ReturnType<typeof runCutPhase>> | null = null;
  let editorPhase: EditorMaterializationState | null = null;
  let clockMapping: EditorClockMappingProof | null = null;
  let mediaHttp: MediaHttpProof | null = null;
  let cleanup: FixtureCleanupResult | null = null;
  let editorEntryAttempted = false;
  let primaryError: unknown = null;
  try {
    cutPhase = await runCutPhase(fixture);
    editorEntryAttempted = true;
    await enterEditor();
    editorPhase = await waitForEditorMaterialization(fixture);
    clockMapping = proveEditorClockMapping(fixture, cutPhase, editorPhase);
    mediaHttp = await proveMediaHttp(editorPhase.mediaUrl);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (editorEntryAttempted) {
      try {
        cleanup = await cleanupEditorMaterialization();
      } catch (cleanupError) {
        if (primaryError) {
          process.stderr.write(
            `[${fixture.platform}] 원래 실패 뒤 editor exact cleanup도 실패: ${errorMessage(cleanupError)}\n`
          );
        } else {
          throw cleanupError;
        }
      }
    }
  }
  assert(
    cutPhase && editorPhase && clockMapping && mediaHttp && cleanup,
    `${fixture.platform} live smoke 결과가 완성되지 않았습니다.`
  );
  assert(
    cleanup.performed && cleanup.action === "exact-cache-purge",
    `${fixture.platform} completed editor artifact를 exact purge하지 못했습니다: ${JSON.stringify(cleanup)}`
  );
  return {
    platform: fixture.platform,
    contentId: fixture.contentId,
    startCaptured: cutPhase.start,
    afterForwardFive: cutPhase.afterForwardFive,
    endCaptured: cutPhase.end,
    iframePreserved: true,
    cutAcquisitionRequests: 0,
    editorMaterialization: {
      durationSeconds: Number(editorPhase.duration.toFixed(3)),
      videoSize: `${editorPhase.videoWidth}x${editorPhase.videoHeight}`,
      clockMapping,
      http: mediaHttp
    },
    cleanup
  };
}

async function runCutOnlyFixture(
  fixture: FixtureDefinition,
  runSuffix: string
): Promise<CutOnlyFixtureResult> {
  await openStudio();
  await configureFixture(fixture, runSuffix);
  const cutPhase = await runCutPhase(fixture);
  return {
    platform: fixture.platform,
    contentId: fixture.contentId,
    startCaptured: cutPhase.start,
    afterForwardFive: cutPhase.afterForwardFive,
    endCaptured: cutPhase.end,
    iframePreserved: true,
    cutAcquisitionRequests: 0
  };
}

async function stopDriver(): Promise<void> {
  if (!driver || driver.exitCode !== null || driver.pid === undefined) {
    return;
  }
  const processId = driver.pid;
  const exited = new Promise<void>((resolve) => driver?.once("exit", () => resolve()));
  try {
    if (process.platform === "win32") {
      driver.kill("SIGTERM");
    } else {
      process.kill(-processId, "SIGTERM");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
  await Promise.race([exited, delay(3_000)]);
  if (driver.exitCode === null) {
    try {
      if (process.platform === "win32") {
        driver.kill("SIGKILL");
      } else {
        process.kill(-processId, "SIGKILL");
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
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
        // 아래에서 검증된 ChromeDriver process group만 종료한다.
      }
      sessionId = "";
    }
    await stopDriver();
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
  if (process.env.KIRINUKI_LIVE_VOD_SMOKE !== "1") {
    throw new Error(
      "실제 공개 VOD 네트워크 테스트입니다. KIRINUKI_LIVE_VOD_SMOKE=1을 명시해 실행해 주세요."
    );
  }
  await Promise.all([
    access(path.join(companionRoot, "manifest.json")),
    access(path.join(companionRoot, "soop-streaming-companion.js")),
    access(path.join(companionRoot, "streaming-companion.js"))
  ]);
  const runtime = await assertRunningRuntimes();
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
            `--disable-extensions-except=${companionRoot}`,
            `--load-extension=${companionRoot}`,
            `--user-data-dir=${profileRoot}`
          ]
        }
      }
    }
  }, 45_000);
  assert(
    typeof created.sessionId === "string" && created.sessionId,
    "WebDriver session ID가 없습니다."
  );
  sessionId = created.sessionId;
  await cdp("Network.enable", {});
  await installEditorGatewayObserver();

  const runSuffix = `${process.pid}-${Date.now().toString(36)}`;
  const cutOnly = process.env.KIRINUKI_LIVE_VOD_CUT_ONLY === "1";
  const results: Array<FixtureResult | CutOnlyFixtureResult> = [];
  for (const fixture of fixtures) {
    process.stderr.write(`[${fixture.platform}] streaming E→F→R 실측 시작\n`);
    results.push(cutOnly
      ? await runCutOnlyFixture(fixture, runSuffix)
      : await runFixture(fixture, runSuffix));
    if (cutOnly) {
      process.stderr.write(
        `[${fixture.platform}] streaming-only 컷 제어 검증 완료\n`
      );
      continue;
    }
    process.stderr.write(
      `[${fixture.platform}] editor materialization·exact cleanup 검증 완료\n`
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "opt-in-live-public-vod",
    runtime,
    browserProfile: "temporary",
    companion: "production-unpacked-minimal",
    cutPhase: {
      source: "platform-streaming-iframe",
      acquisitionRequests: 0
    },
    editorPhase: cutOnly
      ? "not-entered"
      : {
        materialization: "selected-ranges-plus-minus-10-seconds",
        cleanup: "exact-completed-artifact"
      },
    fixtures: results
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(
    `localhost live VOD smoke 실패: ${errorMessage(error)}`
      + (driverOutput.trim()
        ? `\nChromeDriver 최근 출력:\n${driverOutput.trim()}`
        : "")
      + "\n"
  );
} finally {
  await cleanup();
}
