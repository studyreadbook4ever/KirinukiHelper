import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const DATABASE_NAME = "chzzk-kirinuki-studio";
const PROJECT_STORE = "projects";
const LOCAL_DRAFT_STORE = "local-drafts";
const SEED_PREFIX = "chzzkKirinukiEditorSeed:";
const STORAGE_KEY = "chzzkKirinukiProjectV1";
const CAPTION_AGENT_SETTINGS_KEY = "chzzk-kirinuki-caption-agent-settings-v3";
const WORKSPACE_META_KEY = "chzzkKirinukiWorkspaceMetaV1";
const BINDINGS_KEY = "chzzkKirinukiSourceBindingsV1";
const LEGACY_MODEL_CACHE_NAME = "transformers-cache";
const LEGACY_MODEL_CACHE_SENTINEL_TEXT = "remove-legacy-model-cache-on-reset";
const PROJECT_ID = "e2e-editor-interaction";
const EDITED_TEXT = "사람이 직접 고친 한글 자막";
const KEY = Object.freeze({
  ALT: "\uE00A",
  ARROW_RIGHT: "\uE014",
  DELETE: "\uE017",
  ESCAPE: "\uE00C",
  SPACE: "\uE00D",
  TAB: "\uE004"
});

const root = fileURLToPath(new URL("..", import.meta.url));
const extensionRoot = path.resolve(process.argv[2] || path.join(root, "extension"));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chzzk-kirinuki-editor-e2e-"));
const profileRoot = path.join(tempRoot, "chromium-profile");
const mediaPath = path.join(tempRoot, "interaction-source.mp4");
const screenshotPath = path.join(
  os.tmpdir(),
  `chzzk-kirinuki-editor-e2e-${Date.now()}-${process.pid}.png`
);

type ExternalRecord = Record<string, unknown>;
type WebDriverEnvelope = {
  value?: unknown;
};
type WebDriverError = {
  error?: unknown;
  message?: unknown;
};
type WindowHandleResult = {
  handle?: string;
};
type ChromeSessionResult = {
  sessionId: string;
  capabilities: {
    "goog:chromeOptions"?: {
      debuggerAddress?: string;
    };
  };
};
type ExtensionTarget = {
  type: string;
  url: string;
};
type CaptionRemoteMeta = {
  reviewRequired: boolean;
  placement: string;
  qualityCodes: string[];
};
interface EditorCue extends ExternalRecord {
  id: string;
  clipId: string;
  text: string;
  origin: string;
  startOffsetMs: number;
  endOffsetMs: number;
  x: number;
  y: number;
  color: string;
  fontScale?: number;
  lane: number;
  backgroundEnabled?: boolean;
  remoteMeta?: CaptionRemoteMeta;
}
interface EditorClip extends ExternalRecord {
  id: string;
  selectionId: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  selectionStartMs: number;
  selectionEndMs: number;
  enabled: boolean;
}
interface EditorImageAsset extends ExternalRecord {
  id: string;
  clipId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  source?: {
    kind?: string;
  };
}
interface EditorAudioRegion extends ExternalRecord {
  id: string;
  clipId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  gain: number;
}
type CaptionCheckpoint = {
  clipId: string;
  model: string;
};
interface AiState extends ExternalRecord {
  status: string;
  provider: string;
  model: string;
  warnings: unknown[];
  captionCheckpoints: CaptionCheckpoint[];
}
interface ExternalProject extends ExternalRecord {
  name: string;
  clips: EditorClip[];
  subtitles: EditorCue[];
  imageAssets: EditorImageAsset[];
  audioRegions: EditorAudioRegion[];
  segments: ExternalRecord[];
  checkpoints: ExternalRecord[];
  entries: ExternalRecord[];
  operations: ExternalRecord[];
  ai: AiState;
  recentSubtitleColors: string[];
  subtitleLaneCount: number;
  subtitleDefaults: {
    stylePresetId: string;
    fontFamily: string;
    fontScale: number;
    backgroundColor: string;
    backgroundRadiusEm: number;
  };
  selectedImageAssetId?: string;
  selectedAudioRegionId?: string;
  selectedClipId?: string;
  selectedCueId?: string;
  playheadMs: number;
  broadcastSession?: {
    alignmentOffsetMs: number;
  };
  mediaAsset?: {
    name: string;
    mediaOriginMs?: number;
  };
}
interface LocalDraft extends ExternalRecord {
  id: string;
  projectId: string;
  reason: string;
  restoredFromDraftId?: string;
  createdAtMs: number;
  project: ExternalProject;
}
type CaptionFetchProbe = {
  sessions: number;
  probes: number;
  requests: number;
  aborted: number;
  lastModel: string | null;
  lastProtocol: string | null;
  localSessionAuthorization: {
    bearer: boolean;
    secretLength: number;
  } | null;
};
type FetchCallTrace = {
  calls: Array<{ url: string; method: string }>;
  endpointCalls: Array<{ url: string; method: string }>;
};
type WaitOptions = {
  timeout?: number;
  interval?: number;
};
type PointerMove = {
  x: number;
  y: number;
  duration?: number;
};
type DragResult = {
  moves: number;
  trace: Array<{
    type: string;
    x: number;
    y: number;
    trusted?: boolean;
    target?: string;
    snapGuideVisible?: boolean;
    snapGuideLabel?: string | null;
    previewCurrentTime?: number;
    playheadSeconds?: number;
  }>;
};

type PreviewState = {
  paused: boolean;
  seeking: boolean;
  currentTime: number;
  playheadMs: number;
  playheadText: string;
};

type ProjectSelectionKey =
  | "selectedClipId"
  | "selectedCueId"
  | "selectedImageAssetId"
  | "selectedAudioRegionId";

function isExternalRecord(value: unknown): value is ExternalRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWebDriverEnvelope(value: unknown): WebDriverEnvelope {
  return isExternalRecord(value) ? value : {};
}

function describeHttpError(payload: unknown, fallback: string): string {
  if (!isExternalRecord(payload)) {
    return fallback;
  }
  if (isExternalRecord(payload.value) && typeof payload.value.message === "string") {
    return payload.value.message;
  }
  return typeof payload.raw === "string" ? payload.raw : fallback;
}

let driver: ChildProcess | null = null;
let ffmpegProcess: ChildProcess | null = null;
let sessionId = "";
let driverPort: number | null = null;
let cleanupPromise: Promise<void> | null = null;
let driverOutput = "";
let ffmpegOutput = "";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function formatEditorTime(milliseconds: number) {
  const value = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const millis = value % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requireDefined<T>(
  value: T | null | undefined,
  message: string
): T {
  assert(value !== null && value !== undefined, message);
  return value;
}

async function isExecutable(filePath: string) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(environmentName: string, candidates: string[]) {
  const configured = process.env[environmentName];
  const names = configured ? [configured, ...candidates] : candidates;
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

  throw new Error(`${environmentName} 또는 PATH에서 실행 파일을 찾지 못했습니다: ${names.join(", ")}`);
}

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert(
    typeof port === "number" && Number.isInteger(port),
    "임시 ChromeDriver 포트를 할당하지 못했습니다."
  );
  return port;
}

function appendOutput(target: string, chunk: Buffer | string) {
  const next = `${target}${chunk.toString()}`;
  return next.length > 80_000 ? next.slice(-80_000) : next;
}

async function fetchJson(
  url: string,
  {
    method = "GET",
    body,
    timeout = 30_000
  }: { method?: string; body?: unknown; timeout?: number } = {}
): Promise<unknown> {
  const requestInit: RequestInit = {
    method,
    signal: AbortSignal.timeout(timeout)
  };
  if (body !== undefined) {
    requestInit.headers = { "content-type": "application/json" };
    requestInit.body = JSON.stringify(body);
  }
  const response = await fetch(url, requestInit);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const detail = describeHttpError(payload, response.statusText);
    throw new Error(`${method} ${url} 실패 (${response.status}): ${detail}`);
  }
  return payload;
}

async function webdriver<T = ExternalRecord>(
  method: string,
  commandPath: string,
  body?: unknown
): Promise<T> {
  assert(driverPort !== null, "ChromeDriver 포트가 준비되지 않았습니다.");
  const requestBody = method === "POST" && body === undefined ? {} : body;
  const payload = readWebDriverEnvelope(
    await fetchJson(`http://127.0.0.1:${driverPort}${commandPath}`, {
      method,
      body: requestBody
    })
  );
  const value = payload.value;
  if (isExternalRecord(value) && value.error) {
    const error = value as WebDriverError;
    throw new Error(
      `${String(error.error)}: ${
        typeof error.message === "string" ? error.message : "WebDriver 명령 실패"
      }`
    );
  }
  return value as T;
}

async function executeSync<T = ExternalRecord>(
  script: string,
  args: unknown[] = []
): Promise<T> {
  return webdriver<T>("POST", `/session/${sessionId}/execute/sync`, { script, args });
}

async function executeAsync<T = ExternalRecord>(
  script: string,
  args: unknown[] = []
): Promise<T> {
  return webdriver<T>("POST", `/session/${sessionId}/execute/async`, { script, args });
}

async function switchToWindow(handle: string) {
  await webdriver("POST", `/session/${sessionId}/window`, { handle });
}

async function openWindow(url: string, type = "window") {
  const created = await webdriver<WindowHandleResult>(
    "POST",
    `/session/${sessionId}/window/new`,
    { type }
  );
  const handle = created?.handle || "";
  assert(handle, `${type} window handle을 받지 못했습니다.`);
  await switchToWindow(handle);
  await webdriver("POST", `/session/${sessionId}/url`, { url });
  await waitUntil(
    () => executeSync("return document.readyState === 'complete';"),
    `${type} ${url} 초기화`
  );
  return handle;
}

async function broadcastCaptureSeedUpdate(
  sidepanelUrl: string,
  captureState: ExternalRecord
) {
  const editorHandle = await webdriver<string>("GET", `/session/${sessionId}/window`);
  let senderHandle = "";
  try {
    const created = await webdriver<WindowHandleResult>(
      "POST",
      `/session/${sessionId}/window/new`,
      { type: "tab" }
    );
    senderHandle = created?.handle || "";
    assert(senderHandle, "hot seed를 보낼 extension 탭 handle을 받지 못했습니다.");
    await webdriver("POST", `/session/${sessionId}/window`, { handle: senderHandle });
    await webdriver("POST", `/session/${sessionId}/url`, { url: sidepanelUrl });
    await waitUntil(
      () => executeSync("return document.readyState === 'complete';"),
      "hot seed sender sidepanel 초기화"
    );

    const result = await executeAsync<{ ok?: boolean; error?: string }>(`
      const key = arguments[0];
      const projectId = arguments[1];
      const captureState = arguments[2];
      const done = arguments[arguments.length - 1];
      chrome.storage.local.set({
        [key]: {
          captureState,
          sourceTabId: null,
          updatedAt: new Date().toISOString()
        }
      }, () => {
        const storageError = chrome.runtime.lastError?.message || null;
        if (storageError) {
          done({ error: storageError });
          return;
        }
        chrome.runtime.sendMessage({
          type: "KIRINUKI_CAPTURE_SEED_UPDATED",
          projectId,
          captureState
        }, (response) => {
          const messageError = chrome.runtime.lastError?.message || null;
          setTimeout(() => done({
            ok: true,
            response: response ?? null,
            messageError
          }), 120);
        });
      });
    `, [`${SEED_PREFIX}${PROJECT_ID}`, PROJECT_ID, captureState]);
    assert(result?.ok, `hot seed runtime 전송 실패: ${result?.error || "알 수 없는 오류"}`);
    return result;
  } finally {
    if (senderHandle) {
      const currentHandle = await webdriver<string>(
        "GET",
        `/session/${sessionId}/window`
      ).catch(() => "");
      if (currentHandle !== senderHandle) {
        await webdriver("POST", `/session/${sessionId}/window`, { handle: senderHandle }).catch(() => {});
      }
      await webdriver("DELETE", `/session/${sessionId}/window`).catch(() => {});
    }
    await webdriver("POST", `/session/${sessionId}/window`, { handle: editorHandle });
  }
}

async function waitForDriver() {
  const baseUrl = `http://127.0.0.1:${driverPort}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driver?.exitCode !== null) {
      throw new Error(`ChromeDriver가 준비 전에 종료했습니다.\n${driverOutput.trim()}`);
    }
    try {
      const status = readWebDriverEnvelope(
        await fetchJson(`${baseUrl}/status`, { timeout: 1_000 })
      );
      if (isExternalRecord(status.value) && status.value.ready === true) {
        return;
      }
    } catch {
      // ChromeDriver가 포트에 바인딩할 때까지 짧게 재시도한다.
    }
    await delay(100);
  }
  throw new Error(`ChromeDriver가 10초 안에 준비되지 않았습니다.\n${driverOutput.trim()}`);
}

async function waitForExtensionTarget(debuggerAddress: string, serviceWorkerPath: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const payload = await fetchJson(`http://${debuggerAddress}/json/list`, { timeout: 2_000 });
    const targets = Array.isArray(payload) ? payload.filter(isExternalRecord) : [];
    const target = targets.find((entry): entry is ExternalRecord & ExtensionTarget => {
      if (entry.type !== "service_worker" || typeof entry.url !== "string") {
        return false;
      }
      try {
        const url = new URL(entry.url);
        return url.protocol === "chrome-extension:" && url.pathname === `/${serviceWorkerPath}`;
      } catch {
        return false;
      }
    });
    if (target) {
      return target;
    }
    await delay(250);
  }
  throw new Error(`unpacked extension의 ${serviceWorkerPath} target을 찾지 못했습니다.`);
}

async function waitUntil<T>(
  check: () => Promise<T | false> | T | false,
  description: string,
  { timeout = 15_000, interval = 120 }: WaitOptions = {}
): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastValue: T | false | undefined;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await delay(interval);
  }
  throw new Error(`${description} 대기 시간 초과. 마지막 값: ${JSON.stringify(lastValue)}`);
}

async function findElement(selector: string): Promise<ExternalRecord> {
  const element = await webdriver("POST", `/session/${sessionId}/element`, {
    using: "css selector",
    value: selector
  });
  assert(element?.[ELEMENT_KEY], `요소를 찾지 못했습니다: ${selector}`);
  return element;
}

async function clickElement(selector: string) {
  const element = await findElement(selector);
  await webdriver("POST", `/session/${sessionId}/element/${element[ELEMENT_KEY]}/click`);
  return element;
}

async function clickAndAcceptAudSegConfirmation(selector: string) {
  try {
    await clickElement(selector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/unexpected alert open/i.test(message)) {
      throw error;
    }
  }
  const confirmationText = await webdriver<string>(
    "GET",
    `/session/${sessionId}/alert/text`
  );
  assert(
    confirmationText.includes("AudSeg 빈 타이밍 초벌")
      && confirmationText.includes("모델·네트워크 호출 없음")
      && confirmationText.includes("음악·효과음도 잡힐 수 있고 텍스트는 직접 입력"),
    `AudSeg 타이밍 전용 계약 안내가 다릅니다: ${confirmationText}`
  );
  await webdriver("POST", `/session/${sessionId}/alert/accept`);
  return confirmationText;
}

async function clickAndAcceptLocalConfirmation(selector: string) {
  try {
    await clickElement(selector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/unexpected alert open/i.test(message)) {
      throw error;
    }
  }
  const confirmationText = await webdriver<string>(
    "GET",
    `/session/${sessionId}/alert/text`
  );
  assert(
    confirmationText.includes("Whisper Tiny 로컬 자막 초벌")
      && confirmationText.includes("유료 API 호출 없음")
      && confirmationText.includes("STT가 만든 발화 시작·끝을 유지"),
    `로컬 Whisper 무과금·싱크 계약 안내가 다릅니다: ${confirmationText}`
  );
  await webdriver("POST", `/session/${sessionId}/alert/accept`);
  return confirmationText;
}

async function pressKey(value: string) {
  try {
    await webdriver("POST", `/session/${sessionId}/actions`, {
      actions: [{
        type: "key",
        id: "semantic-keyboard",
        actions: [
          { type: "keyDown", value },
          { type: "keyUp", value }
        ]
      }]
    });
  } finally {
    await webdriver("DELETE", `/session/${sessionId}/actions`).catch(() => {});
  }
}

async function pressKeyRepeated(value: string, count: number) {
  const repetitions = Math.max(0, Math.floor(Number(count) || 0));
  const actions: ExternalRecord[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    actions.push(
      { type: "keyDown", value },
      { type: "keyUp", value }
    );
  }
  try {
    await webdriver("POST", `/session/${sessionId}/actions`, {
      actions: [{
        type: "key",
        id: `repeated-keyboard-${Date.now()}`,
        actions
      }]
    });
  } finally {
    await webdriver("DELETE", `/session/${sessionId}/actions`).catch(() => {});
  }
}

async function clearAndType(selector: string, text: string) {
  const element = await findElement(selector);
  await webdriver("POST", `/session/${sessionId}/element/${element[ELEMENT_KEY]}/clear`);
  await webdriver("POST", `/session/${sessionId}/element/${element[ELEMENT_KEY]}/value`, {
    text,
    value: Array.from(text)
  });
}

async function setInputValueAndChange(selector: string, value: string) {
  await executeSync(`
    const input = document.querySelector(arguments[0]);
    input.value = arguments[1];
    input.dispatchEvent(new Event("change", { bubbles: true }));
  `, [selector, value]);
}

async function setFileInput(selector: string, filePath: string) {
  const element = await findElement(selector);
  await webdriver("POST", `/session/${sessionId}/element/${element[ELEMENT_KEY]}/value`, {
    text: filePath,
    value: [filePath]
  });
}

async function pointerDragOnce(
  selector: string,
  moves: PointerMove[],
  { altKey = false, button = 0 }: { altKey?: boolean; button?: number } = {}
): Promise<DragResult> {
  const element = await findElement(selector);
  await executeSync(`
    arguments[0].scrollIntoView({ block: "center", inline: "center" });
    globalThis.__kirinukiE2eDragMoves = 0;
    globalThis.__kirinukiE2ePointerDown = false;
    globalThis.__kirinukiE2eDragTrace = [];
    if (!globalThis.__kirinukiE2ePointerProbeInstalled) {
      globalThis.__kirinukiE2ePointerProbeInstalled = true;
      window.addEventListener("pointerdown", (event) => {
        globalThis.__kirinukiE2ePointerDown = true;
        globalThis.__kirinukiE2eDragTrace.push({
          type: "down",
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          trusted: event.isTrusted,
          target: event.target?.className || event.target?.id || event.target?.tagName
        });
      }, true);
      window.addEventListener("pointermove", (event) => {
        if (globalThis.__kirinukiE2ePointerDown) {
          globalThis.__kirinukiE2eDragMoves += 1;
          globalThis.__kirinukiE2eDragTrace.push({
            type: "move",
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            trusted: event.isTrusted,
            target: event.target?.className || event.target?.id || event.target?.tagName,
            snapGuideVisible: document.querySelector("#timeline-snap-guide")?.hidden === false,
            snapGuideLabel: document.querySelector("#timeline-snap-guide")?.dataset.label || null,
            previewCurrentTime: document.querySelector("#preview-video")?.currentTime || 0,
            playheadSeconds: Number(
              document.querySelector("#playhead")?.getAttribute("aria-valuenow") || 0
            )
          });
        }
      }, true);
      window.addEventListener("pointerup", (event) => {
        globalThis.__kirinukiE2eDragTrace.push({
          type: "up",
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          trusted: event.isTrusted,
          target: event.target?.className || event.target?.id || event.target?.tagName
        });
        globalThis.__kirinukiE2ePointerDown = false;
      }, true);
      window.addEventListener("pointercancel", () => {
        globalThis.__kirinukiE2ePointerDown = false;
      }, true);
    }
  `, [element]);
  const actions = [
    { type: "pointerMove", duration: 0, origin: element, x: 0, y: 0 },
    { type: "pointerDown", button },
    ...moves.map(({ x, y, duration = 90 }) => ({
      type: "pointerMove",
      duration,
      origin: "pointer",
      x,
      y
    })),
    { type: "pointerUp", button }
  ];
  try {
    const sources: ExternalRecord[] = [{
        type: "pointer",
        id: `pointer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        parameters: { pointerType: "mouse" },
        actions
    }];
    if (altKey) {
      sources.push({
        type: "key",
        id: `drag-alt-${Date.now()}`,
        actions: [
          { type: "keyDown", value: KEY.ALT },
          ...Array.from(
            { length: Math.max(0, actions.length - 2) },
            () => ({ type: "pause", duration: 0 })
          ),
          { type: "keyUp", value: KEY.ALT }
        ]
      });
    }
    await webdriver("POST", `/session/${sessionId}/actions`, {
      actions: sources
    });
  } finally {
    await webdriver("DELETE", `/session/${sessionId}/actions`).catch(() => {});
  }
  return executeSync<DragResult>(`
    return {
      moves: globalThis.__kirinukiE2eDragMoves || 0,
      trace: globalThis.__kirinukiE2eDragTrace || []
    };
  `);
}

async function pointerDrag(
  selector: string,
  moves: PointerMove[],
  options?: { altKey?: boolean; button?: number }
): Promise<DragResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await pointerDragOnce(selector, moves, options);
    } catch (error) {
      const staleElement = (
        error instanceof Error ? error.message : String(error)
      ).includes("stale element reference");
      if (!staleElement || attempt === 2) {
        throw error;
      }
      await delay(120);
    }
  }
  throw new Error(`drag 대상을 안정적으로 찾지 못했습니다: ${selector}`);
}

async function readPreviewState(): Promise<PreviewState> {
  return executeSync<PreviewState>(`
    const video = document.querySelector("#preview-video");
    const playhead = document.querySelector("#playhead");
    return {
      paused: Boolean(video?.paused),
      seeking: Boolean(video?.seeking),
      currentTime: Number(video?.currentTime || 0),
      playheadMs: Number(playhead?.getAttribute("aria-valuenow") || 0) * 1000,
      playheadText: playhead?.getAttribute("aria-valuetext") || ""
    };
  `);
}

async function pausePreviewForPointerTest() {
  await executeSync(`
    const video = document.querySelector("#preview-video");
    video?.pause();
    return Boolean(video?.paused);
  `);
  return waitUntil(async () => {
    const state = await readPreviewState();
    return state.paused ? state : false;
  }, "포인터 회귀 검증용 미리보기 정지");
}

async function clickTimelineRulerAtTimelineMs(timelineMs: number) {
  const target = await executeSync<{
    clientX: number;
    clientY: number;
    visible: boolean;
    pixelsPerSecond: number;
  }>(`
    const timelineMs = Number(arguments[0]);
    const scroll = document.querySelector("#timeline-scroll");
    const content = document.querySelector("#timeline-content");
    const ruler = document.querySelector("#timeline-ruler");
    const pixelsPerSecond = Number(document.querySelector("#timeline-zoom")?.value || 70);
    const contentX = timelineMs / 1000 * pixelsPerSecond;
    const maximumScroll = Math.max(0, content.scrollWidth - scroll.clientWidth);
    scroll.scrollLeft = Math.max(
      0,
      Math.min(maximumScroll, contentX - scroll.clientWidth / 2)
    );
    const contentRect = content.getBoundingClientRect();
    const rulerRect = ruler.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const clientX = contentRect.left + contentX;
    const clientY = rulerRect.top + rulerRect.height / 2;
    return {
      clientX,
      clientY,
      pixelsPerSecond,
      visible:
        clientX >= scrollRect.left &&
        clientX <= scrollRect.right &&
        clientY >= scrollRect.top &&
        clientY <= scrollRect.bottom
    };
  `, [timelineMs]);
  assert(
    target.visible && Number.isFinite(target.clientX) && Number.isFinite(target.clientY),
    `타임라인 ${timelineMs}ms ruler 좌표가 viewport 밖입니다: ${JSON.stringify(target)}`
  );
  try {
    await webdriver("POST", `/session/${sessionId}/actions`, {
      actions: [{
        type: "pointer",
        id: `timeline-ruler-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        parameters: { pointerType: "mouse" },
        actions: [
          {
            type: "pointerMove",
            duration: 0,
            origin: "viewport",
            x: Math.round(target.clientX),
            y: Math.round(target.clientY)
          },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 }
        ]
      }]
    });
  } finally {
    await webdriver("DELETE", `/session/${sessionId}/actions`).catch(() => {});
  }
  return target;
}

async function seekPausedPreviewWithRuler(timelineMs: number) {
  await pausePreviewForPointerTest();
  const beforeSeek = await readPreviewState();
  if (Math.abs(beforeSeek.playheadMs - timelineMs) <= 250) {
    const stored = await readStoredProject();
    const durationMs = Math.max(
      0,
      ...(stored?.clips || []).filter((clip) => clip.enabled !== false).map(
        (clip) => clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs
      )
    );
    const stagingTimelineMs = [
      Math.min(Math.max(0, durationMs - 100), timelineMs + 1_500),
      Math.max(0, timelineMs - 1_500)
    ].find((candidate) => (
      Math.abs(candidate - beforeSeek.playheadMs) >= 500
      && Math.abs(candidate - timelineMs) >= 500
    ));
    if (stagingTimelineMs !== undefined) {
      await clickTimelineRulerAtTimelineMs(stagingTimelineMs);
      await waitUntil(async () => {
        const observed = await readPreviewState();
        return (
          observed.paused
          && !observed.seeking
          && Math.abs(observed.playheadMs - stagingTimelineMs) <= 45
        ) ? observed : false;
      }, `playhead hitbox 밖 ${stagingTimelineMs}ms ruler 준비 seek`);
    }
  }
  const pointer = await clickTimelineRulerAtTimelineMs(timelineMs);
  let lastObserved: PreviewState | null = null;
  let state: PreviewState;
  try {
    state = await waitUntil(async () => {
      const observed = await readPreviewState();
      lastObserved = observed;
      return (
        observed.paused
        && !observed.seeking
        && Math.abs(observed.playheadMs - timelineMs) <= 45
      ) ? observed : false;
    }, `ruler로 ${timelineMs}ms 명시 seek`);
  } catch (error) {
    throw new Error(
      `ruler로 ${timelineMs}ms 명시 seek 실패: ${JSON.stringify({ pointer, lastObserved })}`,
      { cause: error }
    );
  }
  return { pointer, state };
}

async function startPreviewAtTimeline(timelineMs: number) {
  const seek = await seekPausedPreviewWithRuler(timelineMs);
  await clickElement("#play-toggle");
  const playing = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      !state.paused
      && !state.seeking
      && state.playheadMs >= timelineMs + 80
    ) ? state : false;
  }, `${timelineMs}ms부터 미리보기 재생 시작`);
  return { seek, playing };
}

async function setTimelineSnapForTest(enabled: boolean) {
  const current = await executeSync<boolean>(`
    return document.querySelector("#toggle-timeline-snap")?.getAttribute("aria-pressed") === "true";
  `);
  if (current !== enabled) {
    await clickElement("#toggle-timeline-snap");
  }
  return waitUntil(async () => {
    const state = await executeSync<boolean>(`
      return document.querySelector("#toggle-timeline-snap")?.getAttribute("aria-pressed") === "true";
    `);
    return state === enabled ? state || "disabled" : false;
  }, `타임라인 자석 ${enabled ? "켜기" : "끄기"}`);
}

async function assertPlayingSelectionDoesNotSeek({
  selector,
  selectionKey,
  selectionId,
  itemStartMs,
  playbackTimelineMs,
  expectedInspectorTab,
  label
}: {
  selector: string;
  selectionKey: ProjectSelectionKey;
  selectionId: string;
  itemStartMs: number;
  playbackTimelineMs: number;
  expectedInspectorTab?: string;
  label: string;
}) {
  assert(
    Math.abs(playbackTimelineMs - itemStartMs) >= 600,
    `${label} 재생 위치와 항목 시작점이 충분히 떨어져 있지 않습니다.`
  );
  const start = await startPreviewAtTimeline(playbackTimelineMs);
  const beforeClick = await readPreviewState();
  await clickElement(selector);
  const selected = await waitForStoredProject(
    (candidate) => candidate[selectionKey] === selectionId,
    `${label} 재생 중 선택 autosave`
  );
  if (expectedInspectorTab) {
    await waitUntil(
      () => executeSync(
        `return document.querySelector(arguments[0])?.getAttribute("aria-selected") === "true";`,
        [expectedInspectorTab]
      ),
      `${label} 재생 중 inspector 선택`
    );
  }
  await delay(180);
  const afterClick = await readPreviewState();
  assert(
    !afterClick.paused
      && afterClick.currentTime >= beforeClick.currentTime - 0.12
      && afterClick.playheadMs >= beforeClick.playheadMs - 120
      && Math.abs(afterClick.playheadMs - itemStartMs) >= 400,
    `${label} 재생 중 선택이 과거 시작점으로 seek하거나 재생을 멈췄습니다: ${JSON.stringify({
      itemStartMs,
      playbackTimelineMs,
      beforeClick,
      afterClick
    })}`
  );
  await pausePreviewForPointerTest();
  return { start, beforeClick, afterClick, selectedId: selected[selectionKey] };
}

async function assertPlayingCueSelectionSeeks({
  selector,
  selectionId,
  itemStartMs,
  itemClipId,
  playbackTimelineMs,
  expectedInspectorTab,
  label
}: {
  selector: string;
  selectionId: string;
  itemStartMs: number;
  itemClipId: string;
  playbackTimelineMs: number;
  expectedInspectorTab?: string;
  label: string;
}) {
  assert(
    Math.abs(playbackTimelineMs - itemStartMs) >= 1_500,
    `${label} 재생 위치와 자막 시작점이 충분히 떨어져 있지 않습니다.`
  );
  const start = await startPreviewAtTimeline(playbackTimelineMs);
  const beforeClick = await readPreviewState();
  await clickElement(selector);
  const selected = await waitForStoredProject(
    (candidate) => (
      candidate.selectedCueId === selectionId
      && candidate.selectedClipId === itemClipId
    ),
    `${label} 재생 중 자막 선택 autosave`
  );
  if (expectedInspectorTab) {
    await waitUntil(
      () => executeSync(
        `return document.querySelector(arguments[0])?.getAttribute("aria-selected") === "true";`,
        [expectedInspectorTab]
      ),
      `${label} 재생 중 inspector 선택`
    );
  }
  const itemClip = selected.clips.find((clip) => clip.id === itemClipId);
  assert(itemClip, `${label} 재생 중 실제 media seek를 검증할 컷이 없습니다.`);
  const expectedPreviewSeconds = (
    (Number(selected.mediaAsset?.mediaOriginMs) || 0)
    + itemClip.sourceStartMs
    + itemStartMs
    - itemClip.timelineStartMs
  ) / 1000;
  const afterClick = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      !state.paused
      && !state.seeking
      && state.playheadMs >= itemStartMs - 45
      && state.playheadMs <= itemStartMs + 1_200
      && state.currentTime >= expectedPreviewSeconds - 0.06
      && state.currentTime <= expectedPreviewSeconds + 1.2
    ) ? state : false;
  }, `${label} 재생 중 자막 시작점 seek 후 재생 유지`);
  await pausePreviewForPointerTest();
  return {
    start,
    beforeClick,
    afterClick,
    selectedCueId: selected.selectedCueId,
    selectedClipId: selected.selectedClipId
  };
}

async function assertPausedSelectionSeeks({
  selector,
  selectionKey,
  selectionId,
  itemStartMs,
  itemClipId,
  playbackTimelineMs,
  expectedInspectorTab,
  label
}: {
  selector: string;
  selectionKey: ProjectSelectionKey;
  selectionId: string;
  itemStartMs: number;
  itemClipId: string;
  playbackTimelineMs: number;
  expectedInspectorTab?: string;
  label: string;
}) {
  await seekPausedPreviewWithRuler(playbackTimelineMs);
  const beforeClick = await readPreviewState();
  await clickElement(selector);
  const selected = await waitForStoredProject(
    (candidate) => candidate[selectionKey] === selectionId,
    `${label} 정지 중 선택 autosave`
  );
  if (expectedInspectorTab) {
    await waitUntil(
      () => executeSync(
        `return document.querySelector(arguments[0])?.getAttribute("aria-selected") === "true";`,
        [expectedInspectorTab]
      ),
      `${label} 정지 중 inspector 선택`
    );
  }
  const itemClip = selected.clips.find((clip) => clip.id === itemClipId);
  assert(itemClip, `${label} 정지 중 실제 media seek를 검증할 컷이 없습니다.`);
  const expectedPreviewSeconds = (
    (Number(selected.mediaAsset?.mediaOriginMs) || 0)
    + itemClip.sourceStartMs
    + itemStartMs
    - itemClip.timelineStartMs
  ) / 1000;
  const afterClick = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      state.paused
      && !state.seeking
      && Math.abs(state.playheadMs - itemStartMs) <= 45
      && Math.abs(state.currentTime - expectedPreviewSeconds) <= 0.06
    ) ? state : false;
  }, `${label} 정지 중 항목 시작점 media seek`);
  assert(
    Math.abs(beforeClick.playheadMs - itemStartMs) >= 600,
    `${label} 정지 중 seek 사전 위치가 항목 시작점과 너무 가깝습니다.`
  );
  return { beforeClick, afterClick, selectedId: selected[selectionKey] };
}

async function cancelPlayheadPointerAndProbeHover(moveAfterCancelPx = 18) {
  const element = await findElement("#playhead");
  await executeSync(`
    arguments[0].scrollIntoView({ block: "center", inline: "center" });
    globalThis.__kirinukiE2eCanceledPlayheadPointerId = null;
    window.addEventListener("pointerdown", (event) => {
      globalThis.__kirinukiE2eCanceledPlayheadPointerId = event.pointerId;
    }, { capture: true, once: true });
  `, [element]);
  try {
    await webdriver("POST", `/session/${sessionId}/actions`, {
      actions: [{
        type: "pointer",
        id: `cancel-playhead-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, origin: element, x: 0, y: 0 },
          { type: "pointerDown", button: 0 }
        ]
      }]
    });
    return executeSync<{
      pointerId: number;
      beforePlayheadMs: number;
      afterPlayheadMs: number;
      captureReleased: boolean;
    }>(`
      const playhead = arguments[0];
      const moveAfterCancelPx = Number(arguments[1]);
      const pointerId = Number(globalThis.__kirinukiE2eCanceledPlayheadPointerId);
      const beforePlayheadMs = Number(playhead.getAttribute("aria-valuenow") || 0) * 1000;
      playhead.dispatchEvent(new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0
      }));
      if (playhead.hasPointerCapture(pointerId)) {
        playhead.releasePointerCapture(pointerId);
      }
      const rect = playhead.getBoundingClientRect();
      playhead.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: -1,
        buttons: 0,
        clientX: rect.left + rect.width / 2 + moveAfterCancelPx,
        clientY: rect.top + rect.height / 2
      }));
      return {
        pointerId,
        beforePlayheadMs,
        afterPlayheadMs: Number(playhead.getAttribute("aria-valuenow") || 0) * 1000,
        captureReleased: !playhead.hasPointerCapture(pointerId)
      };
    `, [element, moveAfterCancelPx]);
  } finally {
    await webdriver("DELETE", `/session/${sessionId}/actions`).catch(() => {});
  }
}

async function contextClickElement(
  selector: string,
  { x = 0, y = 0 }: { x?: number; y?: number } = {}
) {
  const element = await findElement(selector);
  try {
    await webdriver("POST", `/session/${sessionId}/actions`, {
      actions: [{
        type: "pointer",
        id: `context-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, origin: element, x, y },
          { type: "pointerDown", button: 2 },
          { type: "pointerUp", button: 2 }
        ]
      }]
    });
  } finally {
    await webdriver("DELETE", `/session/${sessionId}/actions`).catch(() => {});
  }
}

async function dispatchTransparentPngPaste(): Promise<{
  error?: string;
  dispatched?: boolean;
  defaultPrevented?: boolean;
  size: number;
  type?: string;
}> {
  return executeAsync<{
    error?: string;
    dispatched?: boolean;
    defaultPrevented?: boolean;
    size: number;
    type?: string;
  }>(`
    const done = arguments[arguments.length - 1];
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, 24, 24);
    context.fillStyle = "rgba(30, 220, 120, 0.55)";
    context.fillRect(6, 6, 12, 12);
    canvas.toBlob((blob) => {
      if (!blob) {
        done({ error: "PNG Blob 생성 실패" });
        return;
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "transparent-e2e.png", { type: "image/png" }));
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      });
      if (!event.clipboardData) {
        Object.defineProperty(event, "clipboardData", { value: transfer });
      }
      const dispatched = document.dispatchEvent(event);
      done({
        dispatched,
        defaultPrevented: event.defaultPrevented,
        size: blob.size,
        type: blob.type
      });
    }, "image/png");
  `);
}

async function readStoredProject(): Promise<ExternalProject | null> {
  const result = await executeAsync<{ error?: string; value?: ExternalProject | null }>(`
    const projectId = arguments[0];
    const done = arguments[arguments.length - 1];
    const open = indexedDB.open(arguments[1]);
    open.onerror = () => done({ error: String(open.error || "IndexedDB open failed") });
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(arguments[2], "readonly");
      const request = transaction.objectStore(arguments[2]).get(projectId);
      request.onerror = () => {
        database.close();
        done({ error: String(request.error || "IndexedDB read failed") });
      };
      request.onsuccess = () => {
        const value = request.result || null;
        database.close();
        done({ value });
      };
    };
  `, [PROJECT_ID, DATABASE_NAME, PROJECT_STORE]);
  assert(!result?.error, `IndexedDB 읽기 실패: ${result?.error}`);
  return result.value || null;
}

async function readLocalDrafts(): Promise<LocalDraft[]> {
  const result = await executeAsync<{ error?: string; drafts?: LocalDraft[] }>(`
    const [databaseName, storeName, projectId] = arguments;
    const done = arguments[arguments.length - 1];
    const open = indexedDB.open(databaseName);
    open.onerror = () => done({
      error: String(open.error || "IndexedDB open failed")
    });
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.close();
        done({ error: "local draft store missing" });
        return;
      }
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onerror = () => {
        database.close();
        done({ error: String(request.error || "local draft read failed") });
      };
      request.onsuccess = () => {
        const drafts = request.result
          .filter((draft) => String(draft.projectId) === String(projectId))
          .sort((left, right) => (
            Number(right.createdAtMs) - Number(left.createdAtMs) ||
            String(right.id).localeCompare(String(left.id))
          ));
        database.close();
        done({ drafts });
      };
    };
  `, [DATABASE_NAME, LOCAL_DRAFT_STORE, PROJECT_ID]);
  assert(!result?.error, `로컬 임시저장 읽기 실패: ${result?.error}`);
  return result.drafts || [];
}

async function readImageAssetBlobKeys(): Promise<string[]> {
  const result = await executeAsync<{ error?: string; keys?: string[] }>(`
    const [databaseName, projectId] = arguments;
    const done = arguments[arguments.length - 1];
    const open = indexedDB.open(databaseName);
    open.onerror = () => done({ error: String(open.error || "IndexedDB open failed") });
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("image-assets", "readonly");
      const request = transaction.objectStore("image-assets").getAllKeys();
      request.onerror = () => {
        database.close();
        done({ error: String(request.error || "image asset key read failed") });
      };
      request.onsuccess = () => {
        const keys = request.result
          .filter((key) => Array.isArray(key) && String(key[0]) === String(projectId))
          .map((key) => String(key[1]))
          .sort();
        database.close();
        done({ keys });
      };
    };
  `, [DATABASE_NAME, PROJECT_ID]);
  assert(!result?.error, `이미지 에셋 Blob 키 읽기 실패: ${result?.error}`);
  return result.keys || [];
}

async function waitForStoredProject(
  predicate: (project: ExternalProject) => boolean | undefined,
  description: string,
  options?: WaitOptions
) {
  return waitUntil(async () => {
    const project = await readStoredProject();
    return project && predicate(project) ? project : false;
  }, description, options);
}

function terminateProcessGroup(child: ChildProcess | null, signal: NodeJS.Signals) {
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      assert(child.pid !== undefined, "하위 프로세스 PID가 없습니다.");
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}

async function waitForExit(child: ChildProcess | null, milliseconds: number) {
  if (!child || child.exitCode !== null) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, milliseconds);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) {
    return;
  }
  terminateProcessGroup(child, "SIGTERM");
  if (!await waitForExit(child, 3_000)) {
    terminateProcessGroup(child, "SIGKILL");
    await waitForExit(child, 3_000);
  }
}

async function cleanup() {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    if (sessionId && driver?.exitCode === null) {
      try {
        await fetchJson(`http://127.0.0.1:${driverPort}/session/${sessionId}`, {
          method: "DELETE",
          timeout: 5_000
        });
      } catch {
        // process group 종료가 남은 Chromium까지 정리한다.
      }
      sessionId = "";
    }
    await stopProcess(driver);
    await stopProcess(ffmpegProcess);
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  })();
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    });
  });
}

async function createSyntheticMedia(ffmpeg: string) {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", "testsrc2=size=640x360:rate=30",
    "-f", "lavfi",
    "-i", "sine=frequency=660:sample_rate=48000",
    "-t", "12",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    mediaPath
  ];
  ffmpegProcess = spawn(ffmpeg, args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const activeFfmpeg = ffmpegProcess;
  assert(activeFfmpeg.stdout, "ffmpeg stdout pipe가 없습니다.");
  assert(activeFfmpeg.stderr, "ffmpeg stderr pipe가 없습니다.");
  activeFfmpeg.stdout.on("data", (chunk: Buffer) => {
    ffmpegOutput = appendOutput(ffmpegOutput, chunk);
  });
  activeFfmpeg.stderr.on("data", (chunk: Buffer) => {
    ffmpegOutput = appendOutput(ffmpegOutput, chunk);
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    activeFfmpeg.once("error", reject);
    activeFfmpeg.once("exit", resolve);
  });
  assert(exitCode === 0, `합성 MP4 생성 실패 (ffmpeg ${exitCode}):\n${ffmpegOutput.trim()}`);
  ffmpegProcess = null;
  await access(mediaPath);
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  const serviceWorkerPath = manifest.background?.service_worker;
  assert(serviceWorkerPath, "manifest에 background.service_worker가 없습니다.");
  for (const requiredPath of [
    serviceWorkerPath,
    "editor.html",
    "sidepanel.html",
    "editor/editor.js"
  ]) {
    await access(path.join(extensionRoot, requiredPath));
  }

  const [chromedriver, chromium, ffmpeg, port] = await Promise.all([
    resolveExecutable("CHROMEDRIVER_BINARY", ["chromedriver"]),
    resolveExecutable("CHROMIUM_BINARY", ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]),
    resolveExecutable("FFMPEG_BINARY", ["ffmpeg"]),
    reservePort()
  ]);
  driverPort = port;
  await createSyntheticMedia(ffmpeg);

  driver = spawn(chromedriver, [`--port=${driverPort}`], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert(driver.stdout, "ChromeDriver stdout pipe가 없습니다.");
  assert(driver.stderr, "ChromeDriver stderr pipe가 없습니다.");
  driver.stdout.on("data", (chunk: Buffer) => {
    driverOutput = appendOutput(driverOutput, chunk);
  });
  driver.stderr.on("data", (chunk: Buffer) => {
    driverOutput = appendOutput(driverOutput, chunk);
  });
  await waitForDriver();

  const created = await webdriver<ChromeSessionResult>("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        strictFileInteractability: false,
        "goog:loggingPrefs": { browser: "ALL" },
        "goog:chromeOptions": {
          binary: chromium,
          args: [
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--window-size=1600,1100",
            `--user-data-dir=${profileRoot}`,
            `--disable-extensions-except=${extensionRoot}`,
            `--load-extension=${extensionRoot}`
          ]
        }
      }
    }
  });
  sessionId = created.sessionId;
  assert(sessionId, "ChromeDriver session ID를 받지 못했습니다.");
  await webdriver("POST", `/session/${sessionId}/window/rect`, { width: 1600, height: 1100 });

  const debuggerAddress = created.capabilities?.["goog:chromeOptions"]?.debuggerAddress;
  assert(debuggerAddress, "Chrome DevTools debugger address를 받지 못했습니다.");
  const extensionTarget = await waitForExtensionTarget(debuggerAddress, serviceWorkerPath);
  const extensionId = new URL(extensionTarget.url).host;
  assert(extensionId, "service worker target에서 extension ID를 찾지 못했습니다.");

  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  await webdriver("POST", `/session/${sessionId}/url`, { url: sidepanelUrl });
  const captureState = {
    schemaVersion: 1,
    projectName: "Editor Interaction E2E",
    source: {
      platform: "CHZZK",
      url: "https://chzzk.naver.com/video/e2e-vod",
      canonicalUrl: "https://chzzk.naver.com/video/e2e-vod",
      channelId: "e2e-channel",
      contentId: "e2e-vod",
      contentType: "vod",
      streamerName: "E2E 스트리머",
      broadcastTitle: "사용자 선택 기반 편집 검증",
      broadcastStartedAt: "2026-07-27 20:00:00",
      observedAt: "2026-07-27T11:00:00.000Z"
    },
    globalInstruction: "",
    draft: {
      startText: "",
      endText: "",
      description: "",
      startCapture: null,
      endCapture: null,
      editingId: null
    },
    segments: [
      {
        id: "selection-a",
        startSeconds: 0.5,
        endSeconds: 4,
        description: "첫 번째 사용자 선택",
        startCapture: null,
        endCapture: null,
        createdAt: "2026-07-27T11:00:01.000Z",
        updatedAt: "2026-07-27T11:00:01.000Z"
      },
      {
        id: "selection-b",
        startSeconds: 5,
        endSeconds: 9,
        description: "두 번째 사용자 선택",
        startCapture: null,
        endCapture: null,
        createdAt: "2026-07-27T11:00:02.000Z",
        updatedAt: "2026-07-27T11:00:02.000Z"
      }
    ],
    updatedAt: "2026-07-27T11:00:02.000Z"
  };
  const seedResult = await executeAsync<{ ok?: boolean; error?: string }>(`
    const key = arguments[0];
    const captureState = arguments[1];
    const captionSettingsKey = arguments[2];
    const done = arguments[arguments.length - 1];
    chrome.storage.local.set({
      [key]: {
        captureState,
        sourceTabId: null,
        updatedAt: new Date().toISOString()
      },
      [captionSettingsKey]: {
        endpoint: "malformed-whisper-endpoint",
        model: "audseg-local"
      }
    }, () => {
      const error = chrome.runtime.lastError;
      done(error ? { error: error.message } : { ok: true });
    });
  `, [
    `${SEED_PREFIX}${PROJECT_ID}`,
    captureState,
    CAPTION_AGENT_SETTINGS_KEY
  ]);
  assert(seedResult?.ok, `extension storage seed 실패: ${seedResult?.error || "알 수 없는 오류"}`);

  const editorUrl = `chrome-extension://${extensionId}/editor.html?project=${encodeURIComponent(PROJECT_ID)}`;
  await webdriver("POST", `/session/${sessionId}/url`, { url: editorUrl });
  await waitUntil(async () => {
    const state = await executeSync<{
      ready: boolean;
      clipCount: number;
      title?: string;
    }>(`
      return {
        ready: document.readyState === "complete",
        clipCount: document.querySelectorAll("#clip-list .clip-item").length,
        title: document.querySelector("#project-name")?.value
      };
    `);
    return state.ready && state.clipCount === 2 && state.title === "Editor Interaction E2E" ? state : false;
  }, "두 사용자 선택이 있는 editor 초기화");

  await setFileInput("#media-input", mediaPath);
  const mediaState = await waitUntil(async () => {
    const state = await executeSync<{
      name?: string;
      dialogHidden?: boolean;
      videoWidth: number;
      duration: number;
    }>(`
      const video = document.querySelector("#preview-video");
      return {
        name: document.querySelector("#media-name")?.textContent,
        dialogHidden: document.querySelector("#job-dialog")?.hidden,
        videoWidth: video?.videoWidth || 0,
        duration: video?.duration || 0
      };
    `);
    return (
      state.name === path.basename(mediaPath) &&
      state.dialogHidden &&
      state.videoWidth === 640 &&
      state.duration >= 11.5
    ) ? state : false;
  }, "합성 MP4 파일 input 연결", { timeout: 25_000 });

  const previewSeekSetup = await executeAsync<{
    error?: string;
    currentTime: number;
    readyState?: number;
    standbyReadyState?: number;
  }>(`
    const done = arguments[arguments.length - 1];
    const video = document.querySelector("#preview-video");
    const target = 3.65;
    const finish = () => done({
      currentTime: video.currentTime,
      readyState: video.readyState,
      standbyReadyState: document.querySelector("#preview-video-standby")?.readyState || 0
    });
    if (Math.abs(video.currentTime - target) <= 0.02) {
      finish();
      return;
    }
    const timeout = setTimeout(() => done({
      error: "preview transition seek timeout",
      currentTime: video.currentTime
    }), 5_000);
    video.addEventListener("seeked", () => {
      clearTimeout(timeout);
      finish();
    }, { once: true });
    video.currentTime = target;
  `);
  assert(
    !previewSeekSetup?.error &&
      Math.abs(previewSeekSetup.currentTime - 3.65) <= 0.02,
    `컷 경계 전환 검증 시작 시각을 맞추지 못했습니다: ${JSON.stringify(previewSeekSetup)}`
  );
  const standbyPreloadState = await waitUntil(async () => {
    const state = await executeSync<{
      currentTime: number;
      readyState: number;
    }>(`
      const standby = document.querySelector("#preview-video-standby");
      return {
        currentTime: standby?.currentTime || 0,
        readyState: standby?.readyState || 0
      };
    `);
    return (
      Math.abs(state.currentTime - 5) <= 0.03
      && state.readyState >= 3
    ) ? state : false;
  }, "다음 컷의 재생 여유 데이터 선행 준비", { timeout: 8_000 });
  const previewTransitionSetup = await executeSync<{
    currentTime: number;
    standbyReadyState: number;
  }>(`
    const original = document.querySelector("#preview-video");
    const trace = {
      original,
      startedAt: 0,
      lastOld: null,
      firstNew: null
    };
    globalThis.__kirinukiE2ePreviewTransition = trace;
    const tick = (now) => {
      const current = document.querySelector("#preview-video");
      if (current === original) {
        trace.lastOld = {
          wallMs: now,
          currentTime: current.currentTime,
          readyState: current.readyState
        };
        requestAnimationFrame(tick);
        return;
      }
      trace.firstNew = {
        wallMs: now,
        currentTime: current?.currentTime || 0,
        readyState: current?.readyState || 0,
        paused: current?.paused
      };
    };
    requestAnimationFrame(tick);
    return {
      currentTime: original?.currentTime || 0,
      standbyReadyState: document.querySelector("#preview-video-standby")?.readyState || 0
    };
  `);
  await clickElement("#play-toggle");
  await executeSync(`
    globalThis.__kirinukiE2ePreviewTransition.startedAt = performance.now();
    return true;
  `);
  const previewTransitionTrace = await waitUntil(async () => {
    const trace = await executeSync<{
      startedAt: number;
      lastOld: {
        wallMs: number;
        currentTime: number;
        readyState: number;
      };
      firstNew: {
        wallMs: number;
        currentTime: number;
        readyState: number;
        paused: boolean;
      };
    } | null>(`
      const value = globalThis.__kirinukiE2ePreviewTransition;
      return value?.firstNew ? {
        startedAt: value.startedAt,
        lastOld: value.lastOld,
        firstNew: value.firstNew
      } : null;
    `);
    return trace || false;
  }, "미리 준비한 다음 컷으로 실제 video layer 전환", { timeout: 4_000 });
  const previewTransitionGapMs = (
    previewTransitionTrace.firstNew.wallMs -
    previewTransitionTrace.lastOld.wallMs
  );
  assert(
    previewTransitionTrace.lastOld.currentTime >= 3.9 &&
      previewTransitionTrace.firstNew.currentTime >= 5 &&
      previewTransitionTrace.firstNew.currentTime < 5.2 &&
      previewTransitionTrace.firstNew.paused === false &&
      previewTransitionGapMs >= 0 &&
      previewTransitionGapMs < 120,
    `컷 경계 미리보기 전환이 끊김 상한을 넘었습니다: ${JSON.stringify({
      setup: previewTransitionSetup,
      trace: previewTransitionTrace,
      gapMs: previewTransitionGapMs
    })}`
  );
  await clickElement("#play-toggle");
  await waitUntil(
    () => executeSync(`return document.querySelector("#preview-video")?.paused === true;`),
    "컷 경계 전환 검증 뒤 미리보기 정지"
  );
  await clickElement("#previous-clip");
  await waitUntil(async () => {
    const state = await executeSync<{
      currentTime: number;
      paused: boolean;
    }>(`
      const video = document.querySelector("#preview-video");
      return {
        currentTime: video?.currentTime || 0,
        paused: video?.paused
      };
    `);
    return (
      state.paused === true &&
      Math.abs(state.currentTime - 0.5) <= 0.04
    ) ? state : false;
  }, "컷 경계 검증 뒤 첫 컷 정지 위치 복원");
  const previewTransitionSmoke = {
    seek: previewSeekSetup,
    preload: standbyPreloadState,
    setup: previewTransitionSetup,
    trace: previewTransitionTrace,
    layerGapMs: previewTransitionGapMs
  };

  await clearAndType("#source-offset", "-1");
  await clickElement("#apply-source-offset");
  await delay(180);
  const persistentErrorToast = await executeSync<{
    hidden?: boolean;
    visible: boolean;
    role?: string;
    ariaLive?: string;
    text: string;
  }>(`
    const toast = document.querySelector("#toast");
    return {
      hidden: toast?.hidden,
      visible: Boolean(toast && !toast.hidden && getComputedStyle(toast).display !== "none"),
      role: toast?.getAttribute("role"),
      ariaLive: toast?.getAttribute("aria-live"),
      text: toast?.textContent || ""
    };
  `);
  assert(
    persistentErrorToast.visible &&
      persistentErrorToast.role === "alert" &&
      persistentErrorToast.ariaLive === "assertive" &&
      persistentErrorToast.text.includes("원본 시작보다 앞으로"),
    `timeout=0 오류 toast가 150ms 뒤 유지되지 않았습니다: ${JSON.stringify(persistentErrorToast)}`
  );
  const invalidOffsetProject = await readStoredProject();
  assert(
    invalidOffsetProject?.broadcastSession?.alignmentOffsetMs === 0,
    `실패한 음수 offset이 프로젝트를 변경했습니다: ${invalidOffsetProject?.broadcastSession?.alignmentOffsetMs}`
  );

  const aiProbeSetup = await executeSync(`
    const button = document.querySelector("#generate-captions");
    const captionModel = document.querySelector("#caption-model");
    const captionEndpoint = document.querySelector("#caption-agent-endpoint");
    captionModel.value = "whisper-tiny";
    captionEndpoint.value = "http://127.0.0.1:4319/v1/captions";
    captionModel.dispatchEvent(new Event("change", { bubbles: true }));
    globalThis.__kirinukiE2eOriginalFetch = globalThis.fetch;
    globalThis.__kirinukiE2eCaptionFetch = {
      sessions: 0,
      probes: 0,
      requests: 0,
      aborted: 0,
      lastModel: null,
      lastProtocol: null,
      localSessionAuthorization: null
    };
    globalThis.fetch = (input, init = {}) => {
      if (String(input).startsWith("http://127.0.0.1:4319/")) {
        const method = String(init.method || "GET").toUpperCase();
        if (
          method === "POST"
          && String(input).endsWith("/v1/session")
        ) {
          globalThis.__kirinukiE2eCaptionFetch.sessions += 1;
          return Promise.resolve(new Response(JSON.stringify({
            schema: "chzzk-kirinuki-caption-agent/session-v1",
            status: "ok",
            authentication: "bearer-process-memory",
            expires: "companion-restart",
            token: "e2e-local-session-token-1234567890"
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          }));
        }
        if (method === "GET") {
          globalThis.__kirinukiE2eCaptionFetch.probes += 1;
          return Promise.resolve(new Response(JSON.stringify({
            schema: "chzzk-kirinuki-caption-agent/capability-v1",
            status: "ok",
            provider: "local-whispercpp",
            models: {
              stt: "ggml-tiny-q5_1.bin",
              captions: "whisper-tiny"
            },
            availableModels: ["whisper-tiny"],
            transcription: {
              mode: "local-whispercpp"
            },
            configured: {
              ready: true
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          }));
        }
        globalThis.__kirinukiE2eCaptionFetch.requests += 1;
        const body = JSON.parse(String(init.body || "{}"));
        const headers = new Headers(init.headers);
        globalThis.__kirinukiE2eCaptionFetch.lastModel = body.model || null;
        globalThis.__kirinukiE2eCaptionFetch.lastProtocol =
          headers.get("X-Kirinuki-Protocol");
        const authorization = headers.get("Authorization") || "";
        globalThis.__kirinukiE2eCaptionFetch.localSessionAuthorization = {
          bearer: /^Bearer [A-Za-z0-9_-]+$/u.test(authorization),
          secretLength: authorization.replace(/^Bearer /u, "").length
        };
        return new Promise((_resolve, reject) => {
          const abort = () => {
            globalThis.__kirinukiE2eCaptionFetch.aborted += 1;
            reject(new DOMException("E2E caption request canceled", "AbortError"));
          };
          if (init.signal?.aborted) {
            abort();
          } else {
            init.signal?.addEventListener("abort", abort, { once: true });
          }
        });
      }
      return globalThis.__kirinukiE2eOriginalFetch(input, init);
    };
    button.focus();
    globalThis.__kirinukiE2eDialogTrace = [];
    window.addEventListener("keydown", (event) => {
      if (event.key === "Tab" || event.key === "Escape") {
        queueMicrotask(() => {
          globalThis.__kirinukiE2eDialogTrace.push({
            key: event.key,
            defaultPrevented: event.defaultPrevented,
            dialogOpen: document.querySelector("#job-dialog")?.open,
            activeId: document.activeElement?.id || null
          });
        });
      }
    });
    document.querySelector("#job-dialog")?.addEventListener("cancel", (event) => {
      globalThis.__kirinukiE2eDialogTrace.push({
        type: "cancel",
        defaultPrevented: event.defaultPrevented
      });
    });
    document.querySelector("#job-dialog")?.addEventListener("close", () => {
      globalThis.__kirinukiE2eDialogTrace.push({ type: "close" });
    });
    return {
      activeId: document.activeElement?.id || null,
      fetchWrapped: globalThis.fetch !== globalThis.__kirinukiE2eOriginalFetch,
      model: captionModel.value
    };
  `);
  assert(
    aiProbeSetup.activeId === "generate-captions"
      && aiProbeSetup.fetchWrapped
      && aiProbeSetup.model === "whisper-tiny",
    `AI dialog probe 준비 실패: ${JSON.stringify(aiProbeSetup)}`
  );

  let aiDialogOpened = null;
  let aiDialogAfterTab = null;
  let aiDialogCanceled = null;
  let aiFetchProbe: CaptionFetchProbe | null = null;
  try {
    await clickAndAcceptLocalConfirmation("#generate-captions");

    aiDialogOpened = await waitUntil(async () => {
      const state = await executeSync(`
        const dialog = document.querySelector("#job-dialog");
        return {
          hidden: dialog?.hidden,
          open: dialog?.open,
          activeId: document.activeElement?.id || null,
          activeInside: Boolean(dialog?.contains(document.activeElement))
        };
      `);
      return (
        state.hidden === false &&
        state.open === true &&
        state.activeInside &&
        state.activeId === "cancel-job"
      ) ? state : false;
    }, "AI 작업 dialog open과 초기 focus");

    await waitUntil(async () => {
      const state = await executeSync(`
        return structuredClone(globalThis.__kirinukiE2eCaptionFetch || {});
      `);
      return state.requests === 1 ? state : false;
    }, "선택 컷 로컬 Whisper 요청 시작", { timeout: 20_000 });

    await pressKey(KEY.TAB);
    aiDialogAfterTab = await waitUntil(async () => {
      const state = await executeSync(`
        const dialog = document.querySelector("#job-dialog");
        return {
          open: dialog?.open,
          activeId: document.activeElement?.id || null,
          activeInside: Boolean(dialog?.contains(document.activeElement))
        };
      `);
      return state.open && state.activeInside && state.activeId === "cancel-job" ? state : false;
    }, "AI dialog 안의 Tab focus trap");

    await pressKey(KEY.ESCAPE);
    try {
      aiDialogCanceled = await waitUntil(async () => {
        const state = await executeSync(`
          const dialog = document.querySelector("#job-dialog");
          const button = document.querySelector("#generate-captions");
          return {
            hidden: dialog?.hidden,
            open: dialog?.open,
            activeId: document.activeElement?.id || null,
            buttonDisabled: button?.disabled,
            progressHidden: document.querySelector("#ai-progress")?.hidden
          };
        `);
        return (
          state.hidden === true &&
          state.open === false &&
          state.activeId === "generate-captions" &&
          state.buttonDisabled === false &&
          state.progressHidden === true
        ) ? state : false;
      }, "AI dialog Escape 취소와 focus 복원", { timeout: 8_000 });
    } catch (error) {
      const actual = await executeSync(`
        const dialog = document.querySelector("#job-dialog");
        const button = document.querySelector("#generate-captions");
        return {
          hidden: dialog?.hidden,
          open: dialog?.open,
          activeId: document.activeElement?.id || null,
          activeTag: document.activeElement?.tagName || null,
          activeInside: Boolean(dialog?.contains(document.activeElement)),
          buttonDisabled: button?.disabled,
          progressHidden: document.querySelector("#ai-progress")?.hidden,
          captionFetch: globalThis.__kirinukiE2eCaptionFetch || null,
          trace: globalThis.__kirinukiE2eDialogTrace || [],
          toast: document.querySelector("#toast")?.textContent || ""
        };
      `);
      const stored = await readStoredProject();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n`
        + `actual=${JSON.stringify(actual)}\nai=${JSON.stringify(stored?.ai)}`
      );
    }
    await waitForStoredProject(
      (project) => project.ai?.status === "canceled",
      "AI dialog Escape 취소 저장",
      { timeout: 20_000 }
    );
  } finally {
    aiFetchProbe = await executeSync<CaptionFetchProbe>(`
      const result = structuredClone(globalThis.__kirinukiE2eCaptionFetch || {});
      if (globalThis.__kirinukiE2eOriginalFetch) {
        globalThis.fetch = globalThis.__kirinukiE2eOriginalFetch;
      }
      delete globalThis.__kirinukiE2eOriginalFetch;
      return result;
    `).catch(() => null);
  }
  assert(
    aiFetchProbe?.sessions === 1 &&
      aiFetchProbe?.probes === 1 &&
      aiFetchProbe?.requests === 1 &&
      aiFetchProbe?.aborted === 1 &&
      aiFetchProbe?.lastModel === "whisper-tiny" &&
      aiFetchProbe?.lastProtocol === "chzzk-kirinuki-caption-request/v1" &&
      aiFetchProbe?.localSessionAuthorization?.bearer === true &&
      aiFetchProbe?.localSessionAuthorization?.secretLength >= 16,
    `기본 로컬 Whisper 요청·취소 계약이 지켜지지 않았습니다: ${JSON.stringify(aiFetchProbe)}`
  );

  const aiSuccessBefore = await readStoredProject();
  assert(
    aiSuccessBefore?.subtitles?.length === 0 &&
      aiSuccessBefore?.ai?.status === "canceled",
    `AI 성공 경로 사전 프로젝트 상태가 올바르지 않습니다: ${JSON.stringify(aiSuccessBefore?.ai)}`
  );
  const audsegModeReady = await executeAsync(`
    const done = arguments[arguments.length - 1];
    const settingsKey = "chzzk-kirinuki-caption-agent-settings-v3";
    const captionModel = document.querySelector("#caption-model");
    captionModel.value = "audseg-local";
    captionModel.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = Date.now() + 5_000;
    const check = () => {
      chrome.storage.local.get(settingsKey, (stored) => {
        const advanced = document.querySelector("#caption-advanced-settings");
        const description =
          document.querySelector("#caption-mode-description")?.textContent || "";
        if (
          stored?.[settingsKey]?.model === "audseg-local"
          && advanced?.hidden === true
          && description.includes("소리가 있는 구간만")
          && description.includes("비어 있는 편집용 cue")
          && description.includes("음성을 글로 바꾸지 않습니다")
        ) {
          setTimeout(() => done({
            model: captionModel.value,
            advancedHidden: advanced.hidden,
            description
          }), 0);
          return;
        }
        if (Date.now() >= deadline) {
          done({
            error: chrome.runtime.lastError?.message || "AudSeg 설정 저장 timeout",
            model: captionModel.value,
            stored: stored?.[settingsKey] || null,
            advancedHidden: advanced?.hidden,
            description
          });
          return;
        }
        setTimeout(check, 20);
      });
    };
    check();
  `);
  assert(
    audsegModeReady?.model === "audseg-local" &&
      audsegModeReady?.advancedHidden === true,
    `AudSeg 모드 전환 저장 실패: ${JSON.stringify(audsegModeReady)}`
  );
  const aiSuccessSetup = await executeSync(`
    const endpointPrefix = "http://127.0.0.1:4319/";
    globalThis.__kirinukiE2eAiSuccessOriginalFetch = globalThis.fetch;
    globalThis.__kirinukiE2eAiSuccessFetch = {
      calls: [],
      endpointCalls: []
    };
    const captionModel = document.querySelector("#caption-model");
    const captionEndpoint = document.querySelector("#caption-agent-endpoint");
    captionEndpoint.value = "malformed-whisper-endpoint";
    globalThis.fetch = async (input, init = {}) => {
      const trace = globalThis.__kirinukiE2eAiSuccessFetch;
      const url = String(input);
      const method = String(init.method || "GET").toUpperCase();
      const call = { url, method };
      trace.calls.push(call);
      if (url.startsWith(endpointPrefix)) {
        trace.endpointCalls.push(call);
      }
      return globalThis.__kirinukiE2eAiSuccessOriginalFetch(input, init);
    };
    return {
      wrapped: globalThis.fetch !== globalThis.__kirinukiE2eAiSuccessOriginalFetch,
      tokenHidden: document.querySelector("#caption-agent-token")?.type === "hidden",
      tokenPresent: Boolean(document.querySelector("#caption-agent-token")?.value),
      modelValue: captionModel.value,
      malformedEndpoint: captionEndpoint.value,
      advancedHidden: document.querySelector("#caption-advanced-settings")?.hidden
    };
  `);
  assert(
    aiSuccessSetup.wrapped &&
      aiSuccessSetup.tokenHidden === true &&
      aiSuccessSetup.modelValue === "audseg-local" &&
      aiSuccessSetup.malformedEndpoint === "malformed-whisper-endpoint" &&
      aiSuccessSetup.advancedHidden === true,
    `AudSeg 성공 경로 준비 실패: ${JSON.stringify(aiSuccessSetup)}`
  );

  let aiSuccessProject: ExternalProject | null = null;
  let aiSuccessDom: ExternalRecord | null = null;
  let aiSuccessFetch: FetchCallTrace | null = null;
  let aiSuccessRestored: ExternalProject | null = null;
  const expectedAiClipIds = aiSuccessBefore.clips
    .filter((clip) => clip.enabled !== false)
    .map((clip) => clip.id);
  try {
    await clickAndAcceptAudSegConfirmation("#generate-captions");
    aiSuccessProject = await waitForStoredProject(
      (candidate) => ["done", "error"].includes(candidate.ai?.status),
      "브라우저 내 AudSeg의 전체 선택 컷 처리 완료",
      { timeout: 60_000 }
    );
    assert(
      aiSuccessProject.ai?.status === "done" &&
        aiSuccessProject.ai?.provider === "local-audseg" &&
        aiSuccessProject.ai?.model === "audseg-local" &&
        aiSuccessProject.subtitles?.length >= expectedAiClipIds.length &&
        aiSuccessProject.subtitles.every((cue) => cue.text === ""),
      `AudSeg 빈 타이밍 저장 결과가 올바르지 않습니다: ${JSON.stringify({
        ai: aiSuccessProject.ai,
        subtitles: aiSuccessProject.subtitles
      })}`
    );
    const aiSuccessTimelineDom = await waitUntil(async () => {
      const state = await executeSync<{
        dialogHidden?: boolean;
        cueCount: number;
        reviewMarkerCount: number;
        reviewMarkerTitle: string;
        blankLabels: string[];
      }>(`
        const reviewBlocks = [
          ...document.querySelectorAll(".cue-block.review-required")
        ];
        const reviewBlock = reviewBlocks[0];
        return {
          dialogHidden: document.querySelector("#job-dialog")?.hidden,
          cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
          reviewMarkerCount: reviewBlocks.length,
          reviewMarkerTitle: reviewBlock?.title || "",
          blankLabels: reviewBlocks.map(
            (block) => block.querySelector(".cue-block-body")?.textContent || ""
          )
        };
      `);
      return (
        state.dialogHidden === true &&
        state.cueCount === aiSuccessProject!.subtitles.length &&
        state.reviewMarkerCount === state.cueCount &&
        state.blankLabels.every((label: string) => label === "(빈 자막)") &&
        state.reviewMarkerTitle.includes("빈 오디오 타이밍")
      ) ? state : false;
    }, "AudSeg 타임라인 빈 cue·검수 표식 UI", { timeout: 20_000 });
    await clickElement(".cue-block.review-required .cue-block-body");
    const aiSuccessInspectorDom = await waitUntil(async () => {
      const state = await executeSync<{
        reviewNoteHidden?: boolean;
        reviewNoteText: string;
        selectedCueText: string;
      }>(`
        return {
          reviewNoteHidden: document.querySelector("#cue-review-note")?.hidden,
          reviewNoteText: document.querySelector("#cue-review-note")?.textContent || "",
          selectedCueText: document.querySelector("#cue-text")?.value || ""
        };
      `);
      return (
        state.reviewNoteHidden === false &&
        state.reviewNoteText.includes("텍스트 입력 필요") &&
        state.selectedCueText === ""
      ) ? state : false;
    }, "AudSeg 빈 cue 선택 인스펙터 안내");
    await clickElement("#cue-list-tab");
    const aiSuccessListDom = await waitUntil(async () => {
      const state = await executeSync<{
        listHidden?: boolean;
        itemCount: number;
        reviewCount: number;
        labels: string[];
        titles: string[];
      }>(`
        const items = [...document.querySelectorAll("#cue-list .cue-list-item")];
        const reviewItems = items.filter(
          (item) => item.classList.contains("review-required")
        );
        return {
          listHidden: document.querySelector("#cue-list")?.hidden,
          itemCount: items.length,
          reviewCount: reviewItems.length,
          labels: items.map((item) => item.querySelector("span")?.textContent || ""),
          titles: reviewItems.map((item) => item.title || "")
        };
      `);
      return (
        state.listHidden === false &&
        state.itemCount === aiSuccessProject!.subtitles.length &&
        state.reviewCount === state.itemCount &&
        state.labels.every((label: string) => label === "(빈 자막)") &&
        state.titles.every((title: string) => title.includes("빈 오디오 타이밍"))
      ) ? state : false;
    }, "AudSeg 전체 cue 목록의 빈 칸·검수 표식");
    aiSuccessDom = {
      timeline: aiSuccessTimelineDom,
      inspector: aiSuccessInspectorDom,
      list: aiSuccessListDom
    };
    await clickElement("#cue-selected-tab");
  } finally {
    aiSuccessFetch = await executeSync<FetchCallTrace>(`
      const result = structuredClone(globalThis.__kirinukiE2eAiSuccessFetch || {});
      if (globalThis.__kirinukiE2eAiSuccessOriginalFetch) {
        globalThis.fetch = globalThis.__kirinukiE2eAiSuccessOriginalFetch;
      }
      delete globalThis.__kirinukiE2eAiSuccessOriginalFetch;
      return result;
    `).catch(() => null);
  }
  assert(
    aiSuccessFetch?.calls?.length === 0 &&
      aiSuccessFetch?.endpointCalls?.length === 0,
    `AudSeg가 모델·서버 없이 실행된다는 계약을 위반했습니다: ${JSON.stringify(aiSuccessFetch)}`
  );
  assert(aiSuccessProject, "AudSeg 성공 프로젝트가 저장되지 않았습니다.");
  assert(
    aiSuccessProject.subtitles.every((cue) => cue.origin === "ai") &&
      aiSuccessProject.subtitles.every((cue) => (
        cue.text === "" &&
        cue.remoteMeta?.reviewRequired === true &&
        cue.remoteMeta?.placement === "bottom" &&
        cue.remoteMeta?.qualityCodes?.includes("AUDSEG_BLANK_TIMING") &&
        cue.endOffsetMs - cue.startOffsetMs >= 100 &&
        cue.endOffsetMs - cue.startOffsetMs <= 4_000 &&
        cue.x === 0.5 &&
        cue.y === 0.84
      )) &&
      expectedAiClipIds.every((clipId) => (
        aiSuccessProject.subtitles.some((cue) => cue.clipId === clipId)
      )) &&
      aiSuccessProject.ai.captionCheckpoints?.length === expectedAiClipIds.length &&
      aiSuccessProject.ai.captionCheckpoints.every(
        (checkpoint) => checkpoint.model === "audseg-local"
      ),
    `AudSeg 빈 타이밍/검수/checkpoint persistence 계약 위반: ${JSON.stringify({
      subtitles: aiSuccessProject.subtitles,
      ai: aiSuccessProject.ai
    })}`
  );

  await clickElement("#undo");
  aiSuccessRestored = await waitForStoredProject(
    (candidate) => (
      candidate.subtitles?.length === 0 &&
      candidate.ai?.status === aiSuccessBefore.ai?.status &&
      candidate.ai?.warnings?.length === 0
    ),
    "AudSeg 성공 경로 undo로 후속 테스트용 clean 상태 복원"
  );
  await waitUntil(async () => {
    const state = await executeSync(`
      return {
        cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
        warningHidden: document.querySelector("#caption-agent-warning")?.hidden,
        warningText: document.querySelector("#caption-agent-warning")?.textContent || ""
      };
    `);
    return (
      state.cueCount === 0 &&
      state.warningHidden === true &&
      state.warningText === ""
    ) ? state : false;
  }, "AudSeg 성공 경로 undo 뒤 DOM clean 상태");
  const aiSuccessSmoke = {
    enabledClipIds: expectedAiClipIds,
    networkCalls: aiSuccessFetch.calls,
    persisted: {
      status: aiSuccessProject.ai.status,
      cueCount: aiSuccessProject.subtitles.length,
      warningCount: aiSuccessProject.ai.warnings.length,
      cues: aiSuccessProject.subtitles.map((cue) => ({
        clipId: cue.clipId,
        text: cue.text,
        reviewRequired: cue.remoteMeta?.reviewRequired || false,
        placement: cue.remoteMeta?.placement || null
      }))
    },
    dom: aiSuccessDom,
    restored: {
      status: aiSuccessRestored.ai?.status || null,
      cueCount: aiSuccessRestored.subtitles?.length || 0,
      warningCount: aiSuccessRestored.ai?.warnings?.length || 0
    }
  };

  const nativeSpaceSetup = await executeSync(`
    const button = document.querySelector("#add-cue-top");
    const video = document.querySelector("#preview-video");
    video.pause();
    globalThis.__kirinukiE2eNativeSpace = {
      clicks: 0,
      trustedClicks: 0,
      playEvents: 0
    };
    button.addEventListener("click", (event) => {
      globalThis.__kirinukiE2eNativeSpace.clicks += 1;
      globalThis.__kirinukiE2eNativeSpace.trustedClicks += Number(event.isTrusted);
    });
    video.addEventListener("play", () => {
      globalThis.__kirinukiE2eNativeSpace.playEvents += 1;
    });
    button.focus();
    return {
      activeId: document.activeElement?.id || null,
      cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
      paused: video.paused
    };
  `);
  assert(
    nativeSpaceSetup.activeId === "add-cue-top" &&
      nativeSpaceSetup.cueCount === 0 &&
      nativeSpaceSetup.paused,
    `native Space 사전 상태가 올바르지 않습니다: ${JSON.stringify(nativeSpaceSetup)}`
  );
  await pressKey(KEY.SPACE);
  await waitUntil(async () => {
    const state = await executeSync(`
      return {
        cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
        editorHidden: document.querySelector("#cue-editor")?.hidden,
        cueId: document.querySelector("#caption-tracks .cue-block")?.dataset.id || null,
        clicks: globalThis.__kirinukiE2eNativeSpace?.clicks || 0
      };
    `);
    return (
      state.cueCount === 1 &&
      state.editorHidden === false &&
      state.cueId &&
      state.clicks === 1
    ) ? state : false;
  }, "native Space로 직접 자막 추가");
  await delay(150);
  const nativeSpaceButton = await executeSync(`
    const video = document.querySelector("#preview-video");
    return {
      ...globalThis.__kirinukiE2eNativeSpace,
      cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
      paused: video.paused,
      playingClass: document.querySelector("#play-toggle")?.classList.contains("playing")
    };
  `);
  assert(
    nativeSpaceButton.clicks === 1 &&
      nativeSpaceButton.trustedClicks === 1 &&
      nativeSpaceButton.cueCount === 1 &&
      nativeSpaceButton.paused &&
      nativeSpaceButton.playEvents === 0 &&
      nativeSpaceButton.playingClass === false,
    `native button Space가 click/playback shortcut을 분리하지 못했습니다: ${JSON.stringify(nativeSpaceButton)}`
  );

  const cueId = await executeSync<string | null>(`
    return document.querySelector("#caption-tracks .cue-block")?.dataset.id || null;
  `);
  assert(cueId, "추가된 자막 ID를 찾지 못했습니다.");

  const cueLeftHandleHit = await executeSync<{
    ready: boolean;
    cueStartPx?: number;
    playheadPx?: number;
    startDeltaPx: number;
    hitIsLeftHandle?: boolean;
    hitTarget?: string | null;
  }>(`
    const cue = document.querySelector('.cue-block[data-id="' + arguments[0] + '"]');
    const handle = cue?.querySelector(".trim-handle.left");
    const playhead = document.querySelector("#playhead");
    if (!cue || !handle || !playhead) {
      return { ready: false };
    }
    const rect = handle.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const cueStartPx = Number.parseFloat(cue.style.left);
    const playheadPx = Number.parseFloat(playhead.style.left);
    return {
      ready: true,
      cueStartPx,
      playheadPx,
      startDeltaPx: Math.abs(cueStartPx - playheadPx),
      hitIsLeftHandle: hit?.closest(".trim-handle.left") === handle,
      hitTarget: hit?.className || hit?.id || hit?.tagName || null
    };
  `, [cueId]);
  assert(
    cueLeftHandleHit.ready &&
      cueLeftHandleHit.startDeltaPx < 0.1 &&
      cueLeftHandleHit.hitIsLeftHandle,
    `cue 시작점과 겹친 왼쪽 handle hit target 회귀: ${JSON.stringify(cueLeftHandleHit)}`
  );

  const transportShortcutProject = await readStoredProject();
  const transportShortcutCue = transportShortcutProject?.subtitles.find(
    (cue) => cue.id === cueId
  );
  const transportShortcutClips = (transportShortcutProject?.clips || []).filter(
    (clip) => clip.enabled !== false
  );
  assert(
    transportShortcutProject && transportShortcutCue && transportShortcutClips.length >= 2,
    "Space 및 ,/. 이동 단축키를 검증할 영상 컷·자막 fixture가 없습니다."
  );
  const transportFirstClip = transportShortcutClips[0];
  const transportNextClip = transportShortcutClips[1];
  assert(
    transportFirstClip && transportNextClip,
    "Space 및 ,/. 이동 단축키용 첫 두 영상 컷을 찾지 못했습니다."
  );
  const transportFirstDurationMs = (
    transportFirstClip.sourceEndMs - transportFirstClip.sourceStartMs
  );
  const transportSpaceStartMs = transportFirstClip.timelineStartMs + Math.min(
    500,
    Math.max(100, transportFirstDurationMs - 500)
  );
  await seekPausedPreviewWithRuler(transportSpaceStartMs);
  await executeSync(`document.querySelector("#stage")?.focus();`);
  const globalSpaceBefore = await readPreviewState();
  await pressKey(KEY.SPACE);
  const globalSpacePlaying = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      !state.paused
      && !state.seeking
      && state.playheadMs >= globalSpaceBefore.playheadMs + 50
      && await executeSync<boolean>(
        `return document.querySelector("#play-toggle")?.classList.contains("playing") === true;`
      )
    ) ? state : false;
  }, "비대화형 편집 영역에서 Space 재생");
  await pressKey(KEY.SPACE);
  const globalSpacePaused = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      state.paused
      && !state.seeking
      && await executeSync<boolean>(
        `return document.querySelector("#play-toggle")?.classList.contains("playing") === false;`
      )
    ) ? state : false;
  }, "비대화형 편집 영역에서 Space 일시정지");

  const waitForClipShortcutSeek = async (clip: EditorClip, label: string) => {
    const expectedCurrentTime = (
      (Number(transportShortcutProject.mediaAsset?.mediaOriginMs) || 0)
      + clip.sourceStartMs
    ) / 1000;
    return waitUntil(async () => {
      const state = await readPreviewState();
      const selectedClipId = await executeSync<string | null>(`
        return document.querySelector("#video-track .clip-block.selected")?.dataset.id || null;
      `);
      return (
        selectedClipId === clip.id
        && state.paused
        && !state.seeking
        && Math.abs(state.playheadMs - clip.timelineStartMs) <= 45
        && Math.abs(state.currentTime - expectedCurrentTime) <= 0.06
      ) ? { ...state, selectedClipId } : false;
    }, label);
  };

  await executeSync(`document.querySelector("#stage")?.focus();`);
  await pressKey(".");
  const periodNextClip = await waitForClipShortcutSeek(
    transportNextClip,
    "마침표로 다음 구간 시작점 이동"
  );
  await executeSync(`document.querySelector("#stage")?.focus();`);
  await pressKey(",");
  const commaPreviousClip = await waitForClipShortcutSeek(
    transportFirstClip,
    "쉼표로 이전 구간 시작점 이동"
  );

  await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
  const transportCueTimelineMs = (
    transportShortcutProject.clips.find(
      (clip) => clip.id === transportShortcutCue.clipId
    )!.timelineStartMs + transportShortcutCue.startOffsetMs
  );
  await waitForStoredProject(
    (project) => (
      project.selectedCueId === cueId
      && project.selectedClipId === transportShortcutCue.clipId
    ),
    "운송 단축키 검증 뒤 원래 자막 선택 복원"
  );
  const transportCueRestored = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      state.paused
      && !state.seeking
      && Math.abs(state.playheadMs - transportCueTimelineMs) <= 45
    ) ? state : false;
  }, "운송 단축키 검증 뒤 원래 자막 시작점 복원");
  const transportShortcutRemap = {
    space: {
      before: globalSpaceBefore,
      playing: globalSpacePlaying,
      paused: globalSpacePaused
    },
    periodNextClip,
    commaPreviousClip,
    restored: transportCueRestored
  };

  const cueHandleNudgeBefore = await executeSync(`
    const handle = document.querySelector(
      '.cue-block[data-id="' + arguments[0] + '"] .trim-handle.left'
    );
    globalThis.__kirinukiE2eOldCueHandle = handle;
    handle?.focus();
    return {
      activeIsHandle: document.activeElement === handle,
      ariaValueNow: handle?.getAttribute("aria-valuenow") || null,
      ariaValueText: handle?.getAttribute("aria-valuetext") || null
    };
  `, [cueId]);
  assert(
    cueHandleNudgeBefore.activeIsHandle &&
      Number(cueHandleNudgeBefore.ariaValueNow) === 0 &&
      cueHandleNudgeBefore.ariaValueText === "00:00:00.000",
    `cue trim handle Arrow 사전 ARIA/focus 상태 오류: ${JSON.stringify(cueHandleNudgeBefore)}`
  );
  await pressKey(KEY.ARROW_RIGHT);
  const cueHandleNudgeAfter = await waitUntil(async () => {
    const state = await executeSync(`
      const handle = document.querySelector(
        '.cue-block[data-id="' + arguments[0] + '"] .trim-handle.left'
      );
      return {
        activeIsNewHandle:
          document.activeElement === handle &&
          handle !== globalThis.__kirinukiE2eOldCueHandle,
        oldHandleConnected: globalThis.__kirinukiE2eOldCueHandle?.isConnected ?? null,
        ariaValueNow: handle?.getAttribute("aria-valuenow") || null,
        ariaValueText: handle?.getAttribute("aria-valuetext") || null
      };
    `, [cueId]);
    return (
      state.activeIsNewHandle &&
      state.oldHandleConnected === false &&
      Number(state.ariaValueNow) === 0.1 &&
      state.ariaValueText === "00:00:00.100"
    ) ? state : false;
  }, "cue trim handle Arrow nudge 뒤 focus와 ARIA 갱신");
  await waitForStoredProject(
    (project) => project.subtitles.some((cue) => cue.id === cueId && cue.startOffsetMs === 100),
    "cue trim handle Arrow nudge autosave"
  );

  await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
  await waitUntil(
    () => executeSync(`
      return [...document.querySelectorAll("#subtitle-overlays .subtitle-overlay")]
        .some((overlay) => overlay.dataset.cueId === arguments[0] && !overlay.hidden);
    `, [cueId]),
    "자막 input hot reload 검증용 overlay 표시"
  );
  await clearAndType("#cue-text", EDITED_TEXT);
  const cueTextHotReload = await waitUntil(async () => {
    const state = await executeSync(`
      const cueId = arguments[0];
      const timeline = document.querySelector(
        '.cue-block[data-id="' + cueId + '"] .cue-block-body'
      );
      const overlay = [
        ...document.querySelectorAll("#subtitle-overlays .subtitle-overlay")
      ].find((candidate) => candidate.dataset.cueId === cueId);
      return {
        activeId: document.activeElement?.id || null,
        inputText: document.querySelector("#cue-text")?.value || "",
        timelineText: timeline?.textContent || "",
        overlayText: overlay?.textContent || "",
        overlayVisible: Boolean(overlay && !overlay.hidden)
      };
    `, [cueId]);
    return (
      state.activeId === "cue-text"
      && state.inputText === EDITED_TEXT
      && state.timelineText === EDITED_TEXT
      && state.overlayText === EDITED_TEXT
      && state.overlayVisible
    ) ? state : false;
  }, "자막 input 직후 timeline·preview hot reload");
  await waitForStoredProject(
    (project) => project.subtitles.some((cue) => cue.id === cueId && cue.text === EDITED_TEXT),
    "blur 전 직접 수정한 자막 텍스트 autosave"
  );
  await executeSync("document.querySelector('#cue-text').blur();");

  await clickElement("#next-clip");
  await delay(200);

  const leftDrag = await pointerDrag(
    `.cue-block[data-id="${cueId}"] .trim-handle.left`,
    [{ x: 12, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 0 }]
  );
  assert(leftDrag.moves >= 3, `왼쪽 cue drag pointermove가 부족합니다: ${JSON.stringify(leftDrag)}`);
  assert(
    leftDrag.trace[0]?.trusted === true &&
      String(leftDrag.trace[0]?.target || "").includes("trim-handle"),
    `왼쪽 cue 손잡이가 신뢰된 pointerdown target이 아닙니다: ${JSON.stringify(leftDrag)}`
  );
  let afterLeftTrim;
  try {
    afterLeftTrim = await waitForStoredProject(
      (project) => project.subtitles.some((cue) => cue.id === cueId && cue.startOffsetMs >= 50),
      "자막 왼쪽 손잡이 drag autosave"
    );
  } catch (error) {
    const stored = await readStoredProject();
    const cue = stored?.subtitles?.find((candidate) => candidate.id === cueId);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n`
      + `left drag=${JSON.stringify(leftDrag)}\nstored cue=${JSON.stringify(cue)}`
    );
  }
  const leftTrimmedCue = afterLeftTrim.subtitles.find((cue) => cue.id === cueId)!;

  const rightDrag = await pointerDrag(
    `.cue-block[data-id="${cueId}"] .trim-handle.right`,
    [{ x: -12, y: 0 }, { x: -12, y: 0 }, { x: -12, y: 0 }]
  );
  assert(rightDrag.moves >= 3, `오른쪽 cue drag pointermove가 부족합니다: ${JSON.stringify(rightDrag)}`);
  assert(
    rightDrag.trace[0]?.trusted === true &&
      String(rightDrag.trace[0]?.target || "").includes("trim-handle"),
    `오른쪽 cue 손잡이가 신뢰된 pointerdown target이 아닙니다: ${JSON.stringify(rightDrag)}`
  );
  await waitForStoredProject(
    (project) => project.subtitles.some((cue) => {
      if (cue.id !== cueId) {
        return false;
      }
      return cue.endOffsetMs <= leftTrimmedCue.endOffsetMs - 50 && cue.endOffsetMs > cue.startOffsetMs;
    }),
    "자막 오른쪽 손잡이 drag autosave"
  );

  await executeSync(`
    document.querySelector(
      '.cue-block[data-id="' + arguments[0] + '"] .cue-block-body'
    )?.click();
  `, [cueId]);
  await waitUntil(async () => {
    const overlay = await executeSync(`
      const element = document.querySelector("#subtitle-overlays .subtitle-overlay");
      return {
        visible: Boolean(element && !element.hidden),
        cueId: element?.dataset.cueId || null
      };
    `);
    return overlay.visible && overlay.cueId === cueId ? overlay : false;
  }, "자막 overlay 표시");

  const captionBackgroundBefore = await readStoredProject();
  assert(captionBackgroundBefore, "자막 배경 토글 전 저장 프로젝트가 없습니다.");
  const captionBackgroundBeforeOtherCues = captionBackgroundBefore.subtitles.filter(
    (cue) => cue.id !== cueId
  );
  const captionBackgroundBeforeDefaults = structuredClone(
    captionBackgroundBefore.subtitleDefaults
  );
  await clickElement("#toggle-caption-background");
  const captionBackgroundEnabledProject = await waitForStoredProject(
    (project) => (
      project.subtitles.some((cue) => (
        cue.id === cueId && cue.backgroundEnabled === true
      ))
    ),
    "선택 자막 검은 사각 배경 켜기 autosave"
  );
  assert(
    JSON.stringify(captionBackgroundEnabledProject.clips)
      === JSON.stringify(captionBackgroundBefore.clips)
      && JSON.stringify(captionBackgroundEnabledProject.subtitles.filter(
        (cue) => cue.id !== cueId
      )) === JSON.stringify(captionBackgroundBeforeOtherCues)
      && JSON.stringify(captionBackgroundEnabledProject.subtitleDefaults)
        === JSON.stringify(captionBackgroundBeforeDefaults),
    "선택 자막 검은 배경을 켜면서 컷·다른 cue·전역 스타일이 바뀌었습니다."
  );
  const captionBackgroundEnabledUi = await waitUntil(async () => {
    const state = await executeSync<{
      pressed: string | null;
      label: string;
      overlayBackground: string;
      overlayRadius: string;
    }>(`
      const button = document.querySelector("#toggle-caption-background");
      const overlay = document.querySelector("#subtitle-overlays .subtitle-overlay");
      const style = overlay ? getComputedStyle(overlay) : null;
      return {
        pressed: button?.getAttribute("aria-pressed") || null,
        label: document.querySelector("#caption-background-label")?.textContent || "",
        overlayBackground: style?.backgroundColor || "",
        overlayRadius: style?.borderRadius || ""
      };
    `);
    return (
      state.pressed === "true"
      && state.label === "이 자막 검은 상자 끄기 · X"
      && state.overlayBackground === "rgb(0, 0, 0)"
      && state.overlayRadius === "0px"
    ) ? state : false;
  }, "선택 자막 검은 사각 배경 미리보기와 접근성 상태");

  await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
  const cueShortcutFocus = await executeSync<{
    id: string;
    tagName: string;
    cueText: string;
  }>(`
    return {
      id: document.activeElement?.id || "",
      tagName: document.activeElement?.tagName || "",
      cueText: document.querySelector("#cue-text")?.value || ""
    };
  `);
  assert(
    cueShortcutFocus.id !== "cue-text"
      && cueShortcutFocus.tagName === "BUTTON"
      && cueShortcutFocus.cueText === EDITED_TEXT,
    `자막 클릭 직후 X 단축키를 받을 포커스가 아닙니다: ${JSON.stringify(cueShortcutFocus)}`
  );
  await pressKey("x");
  const captionBackgroundDisabledProject = await waitForStoredProject(
    (project) => (
      project.subtitles.some((cue) => (
        cue.id === cueId && cue.backgroundEnabled === false
      ))
    ),
    "자막 클릭 직후 X 단축키 검은 사각 배경 끄기 autosave"
  );
  assert(
    JSON.stringify(captionBackgroundDisabledProject.clips)
      === JSON.stringify(captionBackgroundBefore.clips)
      && JSON.stringify(captionBackgroundDisabledProject.subtitles.filter(
        (cue) => cue.id !== cueId
      )) === JSON.stringify(captionBackgroundBeforeOtherCues)
      && JSON.stringify(captionBackgroundDisabledProject.subtitleDefaults)
        === JSON.stringify(captionBackgroundBeforeDefaults),
    "X 단축키로 선택 자막 배경을 끄면서 컷·다른 cue·전역 스타일이 바뀌었습니다."
  );
  const captionBackgroundDisabledUi = await waitUntil(async () => {
    const state = await executeSync<{
      pressed: string | null;
      label: string;
      overlayBackground: string;
    }>(`
      const button = document.querySelector("#toggle-caption-background");
      const overlay = document.querySelector("#subtitle-overlays .subtitle-overlay");
      return {
        pressed: button?.getAttribute("aria-pressed") || null,
        label: document.querySelector("#caption-background-label")?.textContent || "",
        overlayBackground: overlay ? getComputedStyle(overlay).backgroundColor : ""
      };
    `);
    return (
      state.pressed === "false"
      && state.label === "이 자막 검은 상자 켜기 · X"
      && state.overlayBackground === "rgba(0, 0, 0, 0)"
    ) ? state : false;
  }, "X 단축키 선택 자막 검은 사각 배경 끄기 미리보기와 접근성 상태");
  const captionBackgroundToggle = {
    enabledCue: captionBackgroundEnabledProject.subtitles.find(
      (cue) => cue.id === cueId
    ),
    enabledUi: captionBackgroundEnabledUi,
    disabledCue: captionBackgroundDisabledProject.subtitles.find(
      (cue) => cue.id === cueId
    ),
    disabledUi: captionBackgroundDisabledUi
  };

  const overlayDrag = await pointerDrag(
    "#subtitle-overlays .subtitle-overlay",
    [{ x: 20, y: -16 }, { x: 20, y: -16 }, { x: 20, y: -16 }]
  );
  assert(overlayDrag.moves >= 3, `overlay drag pointermove가 부족합니다: ${JSON.stringify(overlayDrag)}`);
  let overlayDragObserved: EditorCue | null = null;
  await waitForStoredProject(
    (project) => {
      const observed = project.subtitles.find((cue) => cue.id === cueId) || null;
      overlayDragObserved = observed;
      return Boolean(observed && observed.x > 0.505 && observed.y < 0.835);
    },
    "자막 overlay 위치 drag autosave"
  ).catch((error) => {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} `
      + `cue=${JSON.stringify(overlayDragObserved)} drag=${JSON.stringify(overlayDrag)}`
    );
  });

  await executeSync(`
    const input = document.querySelector("#font-color");
    input.value = "#ff66aa";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  const coloredCueProject = await waitForStoredProject(
    (project) => project.subtitles.find((cue) => cue.id === cueId)?.color === "#ff66aa",
    "선택 자막별 색상 autosave"
  );
  const recentColorsInUseOrder = [
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ffff00",
    "#ff00ff",
    "#00ffff"
  ];
  await executeSync(`
    const input = document.querySelector("#font-color");
    for (const color of arguments[0]) {
      input.value = color;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  `, [recentColorsInUseOrder]);
  const colorRegisterProject = await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === cueId)?.color === "#00ffff"
      && project.recentSubtitleColors?.join(",")
        === "#00ffff,#ff00ff,#ffff00,#0000ff,#00ff00"
    ),
    "고정 흰색과 최근 자막 색상 5개 autosave"
  );
  const colorRegisterUi = await waitUntil(async () => {
    const state = await executeSync<{
      count: number;
      colors: Array<string | null>;
      shortcuts: Array<string | null>;
      ariaShortcuts: Array<string | null>;
      selected: string | null;
      placeholderCount: number;
    }>(`
      const buttons = [...document.querySelectorAll(
        "#caption-color-register .caption-color-swatch"
      )];
      return {
        count: buttons.length,
        colors: buttons.map((button) => button.dataset.color || null),
        shortcuts: buttons.map((button) => button.dataset.shortcut || null),
        ariaShortcuts: buttons.map((button) => button.getAttribute("aria-keyshortcuts")),
        selected: buttons.find((button) => button.getAttribute("aria-pressed") === "true")
          ?.dataset.color || null,
        placeholderCount: buttons.filter((button) => button.disabled).length
      };
    `);
    return (
      state.count === 6
      && state.colors.join(",")
        === "#ffffff,#00ffff,#ff00ff,#ffff00,#0000ff,#00ff00"
      && state.shortcuts.join(",") === "1,2,3,4,5,6"
      && state.ariaShortcuts.join(",") === "1,2,3,4,5,6"
      && state.selected === "#00ffff"
      && state.placeholderCount === 0
    ) ? state : false;
  }, "흰색 고정 + 최근 5색 레지스터 UI");

  await executeSync(`
    const input = document.querySelector("#cue-text");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  `);
  await pressKey("1");
  const colorShortcutInputBlock = await waitUntil(async () => {
    const stored = await readStoredProject();
    const state = await executeSync<{
      activeId: string | null;
      text: string;
      selectedColor: string | null;
    }>(`
      return {
        activeId: document.activeElement?.id || null,
        text: document.querySelector("#cue-text")?.value || "",
        selectedColor: document.querySelector(
          '#caption-color-register .caption-color-swatch[aria-pressed="true"]'
        )?.dataset.color || null
      };
    `);
    const cue = stored?.subtitles.find((candidate) => candidate.id === cueId);
    return (
      state.activeId === "cue-text"
      && state.text === `${EDITED_TEXT}1`
      && state.selectedColor === "#00ffff"
      && cue?.text === `${EDITED_TEXT}1`
      && cue.color === "#00ffff"
      && stored?.recentSubtitleColors.join(",")
        === colorRegisterProject.recentSubtitleColors.join(",")
    ) ? {
      ...state,
      cueColor: cue.color,
      recent: stored.recentSubtitleColors
    } : false;
  }, "자막 텍스트 input에서 숫자 1은 입력되고 색상 단축키는 차단");
  await clearAndType("#cue-text", EDITED_TEXT);
  await executeSync(`document.querySelector("#cue-text")?.blur();`);
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === cueId)?.text === EDITED_TEXT
      && project.subtitles.find((cue) => cue.id === cueId)?.color === "#00ffff"
    ),
    "숫자 색상 단축키 input 차단 검증 뒤 자막 텍스트 복원"
  );

  const captionColorShortcutSteps: Array<{
    digit: string;
    targetColor: string;
    selectedColor: string;
    recent: string[];
  }> = [];
  await executeSync(`document.querySelector("#stage")?.focus();`);
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    const targetColor = await executeSync<string | null>(`
      return document.querySelector(
        '#caption-color-register .caption-color-swatch[data-shortcut="' + arguments[0] + '"]'
      )?.dataset.color || null;
    `, [digit]);
    assert(targetColor, `숫자 ${digit}에 연결된 자막 색상이 없습니다.`);
    await pressKey(digit);
    const applied = await waitUntil(async () => {
      const stored = await readStoredProject();
      const selectedColor = await executeSync<string | null>(`
        return document.querySelector(
          '#caption-color-register .caption-color-swatch[aria-pressed="true"]'
        )?.dataset.color || null;
      `);
      const cueColor = stored?.subtitles.find(
        (candidate) => candidate.id === cueId
      )?.color;
      return (
        cueColor === targetColor
        && selectedColor === targetColor
      ) ? {
        selectedColor,
        recent: [...(stored?.recentSubtitleColors || [])]
      } : false;
    }, `숫자 ${digit}로 현재 ${targetColor} 색상 슬롯 적용`);
    captionColorShortcutSteps.push({
      digit,
      targetColor,
      selectedColor: applied.selectedColor!,
      recent: applied.recent
    });
  }
  assert(
    captionColorShortcutSteps[0]?.targetColor === "#ffffff",
    `숫자 1이 기본 흰색이 아닙니다: ${JSON.stringify(captionColorShortcutSteps)}`
  );

  const recentBeforeWhiteClick = await readStoredProject();
  assert(recentBeforeWhiteClick, "흰색 레지스터 click 검증 전 저장 프로젝트가 없습니다.");
  await clickElement(
    '#caption-color-register .caption-color-swatch[data-color="#ffffff"]'
  );
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === cueId)?.color === "#ffffff"
      && project.recentSubtitleColors?.join(",")
        === recentBeforeWhiteClick.recentSubtitleColors.join(",")
    ),
    "고정 흰색 레지스터 적용과 최근 5색 보존"
  );
  const captionColorShortcuts = {
    register: colorRegisterUi,
    inputBlocked: colorShortcutInputBlock,
    steps: captionColorShortcutSteps
  };
  await executeSync(`
    const input = document.querySelector("#font-color");
    input.value = "#ff66aa";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === cueId)?.color === "#ff66aa"
      && project.recentSubtitleColors?.[0] === "#ff66aa"
      && project.recentSubtitleColors.length === 5
    ),
    "색상 레지스터 검증 뒤 원래 자막 색상 복원"
  );

  await clickElement("#add-subtitle-lane");
  const laneUi = await waitUntil(async () => {
    const state = await executeSync(`
      return {
        count: document.querySelectorAll("#caption-tracks .caption-track-row").length,
        label: document.querySelector("#subtitle-lane-count")?.textContent || ""
      };
    `);
    return state.count === 3 && state.label === "3" ? state : false;
  }, "자막 레인 추가 UI");
  await waitForStoredProject(
    (project) => project.subtitleLaneCount === 3,
    "자막 레인 추가 autosave"
  );

  await contextClickElement(`.cue-block[data-id="${cueId}"]`);
  const captionContextMenu = await waitUntil(async () => {
    const state = await executeSync(`
      return {
        menuHidden: document.querySelector("#timeline-context-menu")?.hidden,
        addHidden: document.querySelector("#context-add-cue")?.hidden,
        deleteHidden: document.querySelector("#context-delete-cue")?.hidden
      };
    `);
    return (
      state.menuHidden === false &&
      state.addHidden === false &&
      state.deleteHidden === false
    ) ? state : false;
  }, "자막 우클릭 메뉴");
  await clickElement("#context-add-cue");
  const simultaneousProject = await waitForStoredProject(
    (project) => (
      project.subtitles.length === 2 &&
      project.subtitles.some((cue) => cue.id !== cueId && cue.lane !== 0)
    ),
    "다른 레인의 동시 자막 추가"
  );
  const simultaneousCue = simultaneousProject.subtitles.find((cue) => cue.id !== cueId)!;
  assert(
    simultaneousCue.x === 0.5 && simultaneousCue.y === 0.84,
    `다른 자막 레인의 새 cue가 50/84에서 시작하지 않았습니다: ${JSON.stringify(simultaneousCue)}`
  );
  await clickElement(`.cue-block[data-id="${simultaneousCue.id}"] .cue-block-body`);
  const simultaneousOverlayCount = await waitUntil(async () => {
    const count = await executeSync<number>(
      `return document.querySelectorAll("#subtitle-overlays .subtitle-overlay").length;`
    );
    return count === 2 ? count : false;
  }, "동시 자막 2개 미리보기");
  const simultaneousFontBefore = await executeSync<string>(`
    return document.querySelector(
      '#subtitle-overlays .subtitle-overlay[data-cue-id="' + arguments[0] + '"]'
    )?.style.fontSize || "";
  `, [simultaneousCue.id]);
  await executeSync(`
    const input = document.querySelector("#font-size");
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  const resizedSimultaneousProject = await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === simultaneousCue.id)?.fontScale === 0.05
    ),
    "선택 자막별 글씨 크기 autosave"
  );
  assert(
    resizedSimultaneousProject.subtitleDefaults.fontScale
      === simultaneousProject.subtitleDefaults.fontScale
      && resizedSimultaneousProject.subtitles.find((cue) => cue.id === cueId)?.fontScale
        === simultaneousProject.subtitles.find((cue) => cue.id === cueId)?.fontScale,
    "선택 자막 크기를 바꾸면서 다른 cue 또는 프로젝트 기본 크기가 함께 바뀌었습니다."
  );
  const simultaneousFontAfter = await waitUntil(async () => {
    const state = await executeSync<{ fontSize: string; sliderValue: string }>(`
      return {
        fontSize: document.querySelector(
          '#subtitle-overlays .subtitle-overlay[data-cue-id="' + arguments[0] + '"]'
        )?.style.fontSize || "",
        sliderValue: document.querySelector("#font-size")?.value || ""
      };
    `, [simultaneousCue.id]);
    return (
      state.sliderValue === "5"
      && state.fontSize
      && state.fontSize !== simultaneousFontBefore
    ) ? state : false;
  }, "선택 자막별 글씨 크기 미리보기");
  const perCueFontSize = {
    before: simultaneousFontBefore,
    after: simultaneousFontAfter.fontSize,
    stored: resizedSimultaneousProject.subtitles.find(
      (cue) => cue.id === simultaneousCue.id
    )?.fontScale
  };
  const captionSheetProjectBefore = await readStoredProject();
  assert(captionSheetProjectBefore, "자막 속성 시트 검증 전 저장 프로젝트가 없습니다.");
  const captionSheetSelectedColorBefore = captionSheetProjectBefore.subtitles.find(
    (cue) => cue.id === simultaneousCue.id
  )?.color;
  await clickElement("#open-caption-sheet");
  const captionSheetOpened = await waitUntil(async () => {
    const state = await executeSync<{
      open: boolean;
      activeId: string;
      summary: string;
      commonStyle: string;
      dialogText: string;
      dialogMarkup: string;
      variationBadgeCount: number;
      singletonBadgeCount: number;
      rows: Array<{
        cueId: string | null;
        ariaLabel: string | null;
        cells: string[];
      }>;
    }>(`
      const dialog = document.querySelector("#caption-sheet-dialog");
      const rows = [...document.querySelectorAll("#caption-sheet-body .caption-sheet-row")];
      return {
        open: Boolean(dialog?.open),
        activeId: document.activeElement?.id || "",
        summary: document.querySelector("#caption-sheet-summary")?.textContent || "",
        commonStyle: document.querySelector("#caption-sheet-common-style")?.textContent || "",
        dialogText: dialog?.textContent || "",
        dialogMarkup: dialog?.outerHTML || "",
        variationBadgeCount: dialog?.querySelectorAll(".caption-sheet-variation-badge").length || 0,
        singletonBadgeCount: dialog?.querySelectorAll(".caption-sheet-singleton-badge").length || 0,
        rows: rows.map((row) => ({
          cueId: row.dataset.cueId || null,
          ariaLabel: row.querySelector(".caption-sheet-cue-button")?.getAttribute("aria-label") || null,
          cells: [...row.querySelectorAll(":scope > th, :scope > td")]
            .map((cell) => (cell.textContent || "").trim())
        }))
      };
    `);
    return (
      state.open
      && state.activeId === "close-caption-sheet-dialog"
      && state.rows.length === captionSheetProjectBefore.subtitles.length
    ) ? state : false;
  }, "본문 없는 자막 속성 시트 열기");
  const storedCaptionTexts = [...new Set(
    captionSheetProjectBefore.subtitles
      .map((cue) => String(cue.text || ""))
      .filter(Boolean)
  )];
  assert(
    storedCaptionTexts.every((text) => (
      !captionSheetOpened.dialogText.includes(text)
      && !captionSheetOpened.dialogMarkup.includes(text)
      && captionSheetOpened.rows.every((row) => !row.ariaLabel?.includes(text))
    )),
    `자막 속성 시트의 DOM·접근성 이름에 자막 본문이 노출됐습니다: ${JSON.stringify(captionSheetOpened)}`
  );
  const simultaneousSheetRow = captionSheetOpened.rows.find(
    (row) => row.cueId === simultaneousCue.id
  );
  assert(
    captionSheetOpened.summary.includes(`자막 ${captionSheetProjectBefore.subtitles.length}개`)
      && captionSheetOpened.summary.includes("설정 2묶음")
      && captionSheetOpened.commonStyle.includes("프로젝트 공통 외곽선")
      && captionSheetOpened.singletonBadgeCount === 2
      && simultaneousSheetRow?.cells[4]?.includes("50.0% / 84.0%")
      && simultaneousSheetRow.cells[5]?.includes("5.00%")
      && simultaneousSheetRow.cells[5]?.includes("개별")
      && simultaneousSheetRow.ariaLabel?.includes("번 자막 편집")
      && !simultaneousSheetRow.ariaLabel.includes(EDITED_TEXT),
    `자막 속성 시트의 값·묶음·본문 비노출 계약이 다릅니다: ${JSON.stringify(captionSheetOpened)}`
  );

  await pressKey("1");
  await delay(160);
  const captionSheetShortcutGuard = await readStoredProject();
  assert(
    captionSheetShortcutGuard?.subtitles.find(
      (cue) => cue.id === simultaneousCue.id
    )?.color === captionSheetSelectedColorBefore
      && await executeSync<boolean>(
        `return Boolean(document.querySelector("#caption-sheet-dialog")?.open);`
      ),
    "자막 속성 시트가 열린 동안 숫자 색상 단축키가 뒤쪽 프로젝트를 변경했습니다."
  );
  await pressKey(KEY.ESCAPE);
  const captionSheetEscape = await waitUntil(async () => {
    const state = await executeSync<{ open: boolean; activeId: string }>(`
      return {
        open: Boolean(document.querySelector("#caption-sheet-dialog")?.open),
        activeId: document.activeElement?.id || ""
      };
    `);
    return !state.open && state.activeId === "open-caption-sheet" ? state : false;
  }, "자막 속성 시트 Escape 닫기와 trigger focus 복귀");

  await clickElement("#open-caption-sheet");
  await waitUntil(
    () => executeSync(`return Boolean(document.querySelector("#caption-sheet-dialog")?.open);`),
    "행 이동 검증용 자막 속성 시트 다시 열기"
  );
  await clickElement(
    `.caption-sheet-cue-button[data-cue-id="${simultaneousCue.id}"]`
  );
  const captionSheetRowSelection = await waitUntil(async () => {
    const state = await executeSync<{
      open: boolean;
      activeCueId: string | null;
      editorHidden: boolean;
    }>(`
      return {
        open: Boolean(document.querySelector("#caption-sheet-dialog")?.open),
        activeCueId: document.activeElement?.closest(".cue-block")?.dataset.id || null,
        editorHidden: Boolean(document.querySelector("#cue-editor")?.hidden)
      };
    `);
    return (
      !state.open
      && state.activeCueId === simultaneousCue.id
      && state.editorHidden === false
    ) ? state : false;
  }, "자막 속성 시트 행에서 본문 편집기로 이동");
  await waitForStoredProject(
    (project) => project.selectedCueId === simultaneousCue.id,
    "자막 속성 시트 행 선택 autosave"
  );
  const captionPropertiesSheet = {
    summary: captionSheetOpened.summary,
    rowCount: captionSheetOpened.rows.length,
    variationBadgeCount: captionSheetOpened.variationBadgeCount,
    singletonBadgeCount: captionSheetOpened.singletonBadgeCount,
    textExcluded: true,
    shortcutGuardColor: captionSheetSelectedColorBefore,
    escape: captionSheetEscape,
    rowSelection: captionSheetRowSelection
  };
  await contextClickElement(`.cue-block[data-id="${simultaneousCue.id}"]`);
  await waitUntil(
    () => executeSync(`return document.querySelector("#context-delete-cue")?.hidden === false;`),
    "자막 우클릭 삭제 메뉴"
  );
  await clickElement("#context-delete-cue");
  await waitForStoredProject(
    (project) => project.subtitles.length === 1 && project.subtitles[0]?.id === cueId,
    "우클릭 자막 삭제"
  );

  await clickElement('.clip-block[data-id="clip-selection-b"] .clip-block-body');
  await executeSync(`document.querySelector("#stage")?.focus();`);
  await pressKeyRepeated(KEY.ARROW_RIGHT, 30);
  await delay(180);
  await clickElement("#add-cue");
  const rangeCueProject = await waitForStoredProject(
    (project) => (
      project.subtitles.length === 2 &&
      project.subtitles.some((cue) => (
        cue.id !== cueId &&
        cue.clipId === "clip-selection-b" &&
        cue.startOffsetMs >= 2_800
      ))
    ),
    "리플 삭제 뒤 이동을 검증할 후행 자막 추가"
  );
  const rangeCue = rangeCueProject.subtitles.find((cue) => cue.id !== cueId)!;
  const cueTimelineStart = (
    candidateProject: ExternalProject,
    candidateCue: EditorCue | undefined
  ) => {
    const clip = candidateProject.clips.find(
      (candidate) => candidate.id === candidateCue?.clipId
    );
    return clip && candidateCue
      ? clip.timelineStartMs + candidateCue.startOffsetMs
      : null;
  };
  const rangeCueTimelineStartBefore = cueTimelineStart(rangeCueProject, rangeCue);
  assert(
    rangeCueTimelineStartBefore !== null && Number.isFinite(rangeCueTimelineStartBefore),
    `후행 자막의 삭제 전 타임라인 시각을 찾지 못했습니다: ${JSON.stringify(rangeCue)}`
  );

  const firstLaneCue = rangeCueProject.subtitles.find((cue) => cue.id === cueId);
  const firstLaneCueTimelineStart = cueTimelineStart(rangeCueProject, firstLaneCue);
  assert(
    firstLaneCue
      && firstLaneCue.lane === rangeCue.lane
      && firstLaneCueTimelineStart !== null
      && firstLaneCueTimelineStart < rangeCueTimelineStartBefore
      && rangeCueProject.selectedCueId === rangeCue.id,
    `같은 레인의 앞/뒤 자막 fixture가 올바르지 않습니다: ${JSON.stringify({
      selectedCueId: rangeCueProject.selectedCueId,
      firstLaneCue,
      rangeCue,
      firstLaneCueTimelineStart,
      rangeCueTimelineStartBefore
    })}`
  );
  await pausePreviewForPointerTest();

  const readCueLaneNavigationControls = () => executeSync<{
    previousDisabled?: boolean;
    nextDisabled?: boolean;
  }>(`
    return {
      previousDisabled: document.querySelector("#previous-cue-in-lane")?.disabled,
      nextDisabled: document.querySelector("#next-cue-in-lane")?.disabled
    };
  `);
  const waitForCueLaneSelection = async (
    cue: EditorCue,
    expectedTimelineMs: number,
    label: string
  ) => {
    const selected = await waitForStoredProject(
      (project) => (
        project.selectedCueId === cue.id
        && project.selectedClipId === cue.clipId
      ),
      `${label} autosave`
    );
    const clip = selected.clips.find((candidate) => candidate.id === cue.clipId);
    assert(clip, `${label}의 media 시각을 계산할 컷이 없습니다.`);
    const expectedCurrentTime = (
      (Number(selected.mediaAsset?.mediaOriginMs) || 0)
      + clip.sourceStartMs
      + cue.startOffsetMs
    ) / 1000;
    const preview = await waitUntil(async () => {
      const state = await readPreviewState();
      return (
        state.paused
        && !state.seeking
        && Math.abs(state.playheadMs - expectedTimelineMs) <= 45
        && Math.abs(state.currentTime - expectedCurrentTime) <= 0.06
      ) ? state : false;
    }, `${label} 자막 시작점 seek`);
    return {
      selectedCueId: selected.selectedCueId,
      selectedClipId: selected.selectedClipId,
      preview,
      controls: await readCueLaneNavigationControls()
    };
  };

  const lastCueBoundaryInitial = await waitUntil(async () => {
    const controls = await readCueLaneNavigationControls();
    return (
      controls.previousDisabled === false
      && controls.nextDisabled === true
    ) ? controls : false;
  }, "같은 레인 마지막 자막의 오른쪽 경계 버튼 상태");
  await clickElement("#previous-cue-in-lane");
  const firstCueByButton = await waitForCueLaneSelection(
    firstLaneCue,
    firstLaneCueTimelineStart,
    "왼쪽 자막 버튼으로 같은 레인 앞 자막 선택"
  );
  assert(
    firstCueByButton.controls.previousDisabled === true
      && firstCueByButton.controls.nextDisabled === false,
    `같은 레인 첫 자막의 경계 버튼 상태가 올바르지 않습니다: ${JSON.stringify(
      firstCueByButton
    )}`
  );

  await executeSync(`document.querySelector("#stage")?.focus();`);
  const firstBoundaryBefore = await readPreviewState();
  await pressKey("j");
  await delay(220);
  const firstBoundaryProject = await readStoredProject();
  const firstBoundaryAfter = await readPreviewState();
  const firstBoundaryControls = await readCueLaneNavigationControls();
  assert(
    firstBoundaryProject?.selectedCueId === firstLaneCue.id
      && firstBoundaryProject.selectedClipId === firstLaneCue.clipId
      && firstBoundaryAfter.paused
      && Math.abs(firstBoundaryAfter.playheadMs - firstBoundaryBefore.playheadMs) <= 5
      && Math.abs(firstBoundaryAfter.currentTime - firstBoundaryBefore.currentTime) <= 0.02
      && firstBoundaryControls.previousDisabled === true
      && firstBoundaryControls.nextDisabled === false,
    `첫 자막에서 J가 끝 자막으로 순환했습니다: ${JSON.stringify({
      project: firstBoundaryProject,
      before: firstBoundaryBefore,
      after: firstBoundaryAfter,
      controls: firstBoundaryControls
    })}`
  );

  await clickElement("#next-cue-in-lane");
  const lastCueByButton = await waitForCueLaneSelection(
    rangeCue,
    rangeCueTimelineStartBefore,
    "오른쪽 자막 버튼으로 같은 레인 뒤 자막 선택"
  );
  assert(
    lastCueByButton.controls.previousDisabled === false
      && lastCueByButton.controls.nextDisabled === true,
    `같은 레인 마지막 자막의 경계 버튼 상태가 올바르지 않습니다: ${JSON.stringify(
      lastCueByButton
    )}`
  );

  await executeSync(`document.querySelector("#stage")?.focus();`);
  const lastBoundaryBefore = await readPreviewState();
  await pressKey("k");
  await delay(220);
  const lastBoundaryProject = await readStoredProject();
  const lastBoundaryAfter = await readPreviewState();
  const lastBoundaryControls = await readCueLaneNavigationControls();
  assert(
    lastBoundaryProject?.selectedCueId === rangeCue.id
      && lastBoundaryProject.selectedClipId === rangeCue.clipId
      && lastBoundaryAfter.paused
      && Math.abs(lastBoundaryAfter.playheadMs - lastBoundaryBefore.playheadMs) <= 5
      && Math.abs(lastBoundaryAfter.currentTime - lastBoundaryBefore.currentTime) <= 0.02
      && lastBoundaryControls.previousDisabled === false
      && lastBoundaryControls.nextDisabled === true,
    `마지막 자막에서 K가 첫 자막으로 순환했습니다: ${JSON.stringify({
      project: lastBoundaryProject,
      before: lastBoundaryBefore,
      after: lastBoundaryAfter,
      controls: lastBoundaryControls
    })}`
  );

  await executeSync(`document.querySelector("#stage")?.focus();`);
  await pressKey("j");
  const firstCueByJ = await waitForCueLaneSelection(
    firstLaneCue,
    firstLaneCueTimelineStart,
    "J로 같은 레인 왼쪽 자막 선택"
  );
  await executeSync(`document.querySelector("#stage")?.focus();`);
  await pressKey("k");
  const lastCueByK = await waitForCueLaneSelection(
    rangeCue,
    rangeCueTimelineStartBefore,
    "K로 같은 레인 오른쪽 자막 선택"
  );
  const cueLaneNavigation = {
    initialLastBoundary: lastCueBoundaryInitial,
    buttons: {
      previous: firstCueByButton,
      next: lastCueByButton
    },
    shortcuts: {
      previous: firstCueByJ,
      next: lastCueByK
    },
    noWrap: {
      first: {
        before: firstBoundaryBefore,
        after: firstBoundaryAfter,
        controls: firstBoundaryControls
      },
      last: {
        before: lastBoundaryBefore,
        after: lastBoundaryAfter,
        controls: lastBoundaryControls
      }
    }
  };

  await clickElement('.clip-block[data-id="clip-selection-a"] .clip-block-body');
  await clickElement("#set-range-start");
  await clickElement('.clip-block[data-id="clip-selection-b"] .clip-block-body');
  await clickElement("#set-range-end");
  const toolbarRange = await waitUntil(async () => {
    const state = await executeSync<{
      overlayHidden?: boolean;
      overlayValid?: boolean;
      startPressed?: string;
      endPressed?: string;
      deleteDisabled?: boolean;
      summary: string;
    }>(`
      return {
        overlayHidden: document.querySelector("#timeline-range-selection")?.hidden,
        overlayValid: document.querySelector("#timeline-range-selection")?.classList.contains("valid"),
        startPressed: document.querySelector("#set-range-start")?.getAttribute("aria-pressed"),
        endPressed: document.querySelector("#set-range-end")?.getAttribute("aria-pressed"),
        deleteDisabled: document.querySelector("#delete-range")?.disabled,
        summary: document.querySelector("#timeline-range-summary")?.textContent || ""
      };
    `);
    return (
      state.overlayHidden === false &&
      state.overlayValid === true &&
      state.startPressed === "true" &&
      state.endPressed === "true" &&
      state.deleteDisabled === false &&
      state.summary.includes("삭제")
    ) ? state : false;
  }, "툴바 시작·끝점과 삭제 범위 overlay");
  await clickElement("#clear-range");
  await waitUntil(async () => {
    const state = await executeSync<{
      overlayHidden?: boolean;
      deleteDisabled?: boolean;
      clearHidden?: boolean;
    }>(`
      return {
        overlayHidden: document.querySelector("#timeline-range-selection")?.hidden,
        deleteDisabled: document.querySelector("#delete-range")?.disabled,
        clearHidden: document.querySelector("#clear-range")?.hidden
      };
    `);
    return state.overlayHidden && state.deleteDisabled && state.clearHidden ? state : false;
  }, "툴바 삭제 범위 선택 해제");

  await contextClickElement('.clip-block[data-id="clip-selection-b"]', { x: -35 });
  await waitUntil(
    () => executeSync(`return document.querySelector("#context-set-range-start")?.hidden === false;`),
    "영상 우클릭 삭제 시작점 메뉴"
  );
  await clickElement("#context-set-range-start");
  await contextClickElement('.clip-block[data-id="clip-selection-b"]', { x: 35 });
  await waitUntil(
    () => executeSync(`return document.querySelector("#context-set-range-end")?.hidden === false;`),
    "영상 우클릭 삭제 끝점 메뉴"
  );
  await clickElement("#context-set-range-end");
  const rangeHandleBeforeDrag = await waitUntil(async () => {
    const state = await executeSync<{
      valid?: boolean;
      width: number;
      startNow: number;
      endNow: number;
      startHidden?: boolean;
      endHidden?: boolean;
    }>(`
      const overlay = document.querySelector("#timeline-range-selection");
      const start = document.querySelector("#range-start-handle");
      const end = document.querySelector("#range-end-handle");
      return {
        valid: overlay?.classList.contains("valid"),
        width: Number.parseFloat(overlay?.style.width || "0"),
        startNow: Number(start?.getAttribute("aria-valuenow")),
        endNow: Number(end?.getAttribute("aria-valuenow")),
        startHidden: start?.hidden,
        endHidden: end?.hidden
      };
    `);
    return (
      state.valid &&
      state.width > 20 &&
      state.endNow - state.startNow >= 0.1 &&
      state.startHidden === false &&
      state.endHidden === false
    ) ? state : false;
  }, "영상 우클릭 구간과 접근 가능한 양끝 손잡이");
  const rangeStartDrag = await pointerDrag(
    "#range-start-handle",
    [{ x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }]
  );
  assert(
    rangeStartDrag.moves >= 3,
    `삭제 구간 시작 손잡이 drag pointermove가 부족합니다: ${JSON.stringify(rangeStartDrag)}`
  );
  const rangeEndBeforeNudge = await executeSync<number>(`
    const handle = document.querySelector("#range-end-handle");
    handle?.focus();
    return Number(handle?.getAttribute("aria-valuenow"));
  `);
  await pressKey(KEY.ARROW_RIGHT);
  const rangeEndAfterNudge = await waitUntil(async () => {
    const value = await executeSync<number>(
      `return Number(document.querySelector("#range-end-handle")?.getAttribute("aria-valuenow"));`
    );
    return value >= rangeEndBeforeNudge + 0.099 ? value : false;
  }, "삭제 구간 끝 손잡이 Arrow nudge");

  await executeSync(`document.querySelector("#cue-text")?.focus();`);
  await pressKey(KEY.ESCAPE);
  const inputEscapeRange = await executeSync(`
    return {
      activeId: document.activeElement?.id || null,
      valid: document.querySelector("#timeline-range-selection")?.classList.contains("valid"),
      hidden: document.querySelector("#timeline-range-selection")?.hidden
    };
  `);
  assert(
    inputEscapeRange.activeId === "cue-text" &&
      inputEscapeRange.valid &&
      inputEscapeRange.hidden === false,
    `텍스트 입력 중 Escape가 삭제 범위를 지웠습니다: ${JSON.stringify(inputEscapeRange)}`
  );
  await executeSync(`document.querySelector("#stage")?.focus();`);
  await pressKey(KEY.ESCAPE);
  await waitUntil(
    () => executeSync(`return document.querySelector("#timeline-range-selection")?.hidden === true;`),
    "Escape 삭제 범위 선택 해제"
  );

  await contextClickElement('.clip-block[data-id="clip-selection-b"]', { x: -35 });
  await clickElement("#context-set-range-start");
  await contextClickElement('.clip-block[data-id="clip-selection-b"]', { x: 35 });
  await clickElement("#context-set-range-end");
  await contextClickElement('.clip-block[data-id="clip-selection-b"]');
  await waitUntil(
    () => executeSync(`return document.querySelector("#context-delete-range")?.hidden === false;`),
    "영상 우클릭 선택 구간 삭제 메뉴"
  );
  await pressKey(KEY.ESCAPE);
  const deleteRange = await waitUntil(async () => {
    const state = await executeSync<{
      startMs: number;
      endMs: number;
      deleteDisabled?: boolean;
    }>(`
      return {
        startMs: Math.round(Number(document.querySelector("#range-start-handle")?.getAttribute("aria-valuenow")) * 1000),
        endMs: Math.round(Number(document.querySelector("#range-end-handle")?.getAttribute("aria-valuenow")) * 1000),
        deleteDisabled: document.querySelector("#delete-range")?.disabled
      };
    `);
    return (
      state.endMs - state.startMs >= 100 &&
      state.deleteDisabled === false
    ) ? state : false;
  }, "키보드 삭제 전 유효한 범위");
  await executeSync(`document.querySelector("#range-end-handle")?.focus();`);
  await pressKey(KEY.DELETE);
  const rippleDeletedProject = await waitForStoredProject(
    (project) => {
      const movedCue = project.subtitles.find((cue) => cue.id === rangeCue.id);
      const movedStartMs = cueTimelineStart(project, movedCue);
      return (
        project.clips.length === 3 &&
        project.clips.filter((clip) => clip.selectionId === "selection-b").length === 2 &&
        Number.isFinite(movedStartMs) &&
        movedStartMs !== null &&
        Math.abs(
          movedStartMs -
          (rangeCueTimelineStartBefore - (deleteRange.endMs - deleteRange.startMs))
        ) <= 1
      );
    },
    "내부 구간 리플 삭제와 후행 자막 동시 이동"
  );
  const rippleMovedCue = rippleDeletedProject.subtitles.find((cue) => cue.id === rangeCue.id);
  const rippleMovedCueTimelineStart = cueTimelineStart(rippleDeletedProject, rippleMovedCue);
  const rangeUiAfterDelete = await executeSync<{
    overlayHidden?: boolean;
    playheadNow: number;
  }>(`
    return {
      overlayHidden: document.querySelector("#timeline-range-selection")?.hidden,
      playheadNow: Number(document.querySelector("#playhead")?.getAttribute("aria-valuenow"))
    };
  `);
  assert(
    rangeUiAfterDelete.overlayHidden &&
      Math.abs(rangeUiAfterDelete.playheadNow * 1000 - deleteRange.startMs) <= 1,
    `리플 삭제 뒤 범위 해제·접합점 playhead 오류: ${JSON.stringify(rangeUiAfterDelete)}`
  );

  await clickElement("#undo");
  const rippleRestoredProject = await waitForStoredProject(
    (project) => {
      const restoredRangeCue = project.subtitles.find((cue) => cue.id === rangeCue.id);
      return (
        project.clips.length === rangeCueProject.clips.length &&
        project.clips.every((clip, index) => (
          clip.id === rangeCueProject.clips[index]?.id &&
          clip.sourceStartMs === rangeCueProject.clips[index]?.sourceStartMs &&
          clip.sourceEndMs === rangeCueProject.clips[index]?.sourceEndMs
        )) &&
        cueTimelineStart(project, restoredRangeCue) === rangeCueTimelineStartBefore
      );
    },
    "리플 삭제 한 번 Undo로 영상·자막 복원"
  );
  const restoredRangeCue = rippleRestoredProject.subtitles.find(
    (cue) => cue.id === rangeCue.id
  )!;
  await contextClickElement(`.cue-block[data-id="${restoredRangeCue.id}"]`);
  await clickElement("#context-delete-cue");
  await waitForStoredProject(
    (project) => project.subtitles.length === 1 && project.subtitles[0]?.id === cueId,
    "리플 삭제 E2E 후행 자막 fixture 정리"
  );

  const transparentAssetPaste = await dispatchTransparentPngPaste();
  assert(
    !transparentAssetPaste?.error &&
      transparentAssetPaste.defaultPrevented === true &&
      transparentAssetPaste.size > 0 &&
      transparentAssetPaste.type === "image/png",
    `투명 PNG paste 이벤트를 처리하지 못했습니다: ${JSON.stringify(transparentAssetPaste)}`
  );
  const assetProject = await waitForStoredProject(
    (project) => (
      project.imageAssets?.length === 1 &&
      project.selectedImageAssetId === project.imageAssets[0]?.id &&
      project.imageAssets[0]?.source?.kind === "blob-key"
    ),
    "투명 PNG 붙여넣기와 프로젝트 autosave"
  );
  const initialImageAsset = requireDefined(
    assetProject.imageAssets[0],
    "붙여넣은 이미지 에셋 fixture를 찾지 못했습니다."
  );
  const imageAssetId = initialImageAsset.id;
  const assetUi = await waitUntil(async () => {
    const state = await executeSync(`
      const overlay = document.querySelector(
        '#image-asset-overlays .image-asset-overlay[data-asset-id="' + arguments[0] + '"]'
      );
      return {
        block: Boolean(document.querySelector('.asset-block[data-id="' + arguments[0] + '"]')),
        editorHidden: document.querySelector("#asset-editor")?.hidden,
        assetTabSelected: document.querySelector("#asset-mode-tab")?.getAttribute("aria-selected"),
        overlay: Boolean(overlay),
        overlayImageLoaded: Boolean(overlay?.querySelector("img")?.complete),
        thumbnailLoaded: Boolean(document.querySelector("#asset-thumbnail")?.complete)
      };
    `, [imageAssetId]);
    return (
      state.block &&
      state.editorHidden === false &&
      state.assetTabSelected === "true" &&
      state.overlay &&
      state.overlayImageLoaded &&
      state.thumbnailLoaded
    ) ? state : false;
  }, "투명 이미지 에셋 타임라인·미리보기·속성 UI");

  await clickElement("#add-cue");
  const timingCueProject = await waitForStoredProject(
    (project) => {
      const asset = project.imageAssets?.find((candidate) => candidate.id === imageAssetId);
      return (
        project.subtitles.length === 2
        && project.subtitles.some((cue) => (
          cue.id !== cueId
          && cue.clipId === asset?.clipId
        ))
      );
    },
    "에셋 타이밍 맞춤 검증용 같은 컷 자막 추가"
  );
  const timingCue = timingCueProject.subtitles.find((cue) => cue.id !== cueId)!;
  const timingAsset = timingCueProject.imageAssets.find(
    (asset) => asset.id === imageAssetId
  )!;
  const timingClip = timingCueProject.clips.find(
    (clip) => clip.id === timingCue.clipId
  )!;
  const timingAssetDurationMs = timingAsset.endOffsetMs - timingAsset.startOffsetMs;
  assert(
    timingAssetDurationMs >= 600,
    `타이밍 스냅 fixture 에셋이 너무 짧습니다: ${JSON.stringify(timingAsset)}`
  );
  const shortenedCueEndOffsetMs = timingAsset.endOffsetMs - 300;
  await setInputValueAndChange(
    "#cue-end",
    formatEditorTime(timingClip.timelineStartMs + shortenedCueEndOffsetMs)
  );
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === timingCue.id)?.endOffsetMs
        === shortenedCueEndOffsetMs
    ),
    "정확 맞춤 전 자막 끝 시각 분리"
  );
  const cueMatchButton = await waitUntil(async () => {
    const state = await executeSync<{
      disabled?: boolean;
      help: string;
    }>(`
      const button = document.querySelector("#match-cue-to-asset");
      return {
        disabled: button?.disabled,
        help: document.querySelector("#cue-timing-match-help")?.textContent || ""
      };
    `);
    return (
      state.disabled === false
      && state.help.includes("시작·끝")
    ) ? state : false;
  }, "같은 컷 선택 에셋에 자막 정확 맞춤 버튼");
  await clickElement("#match-cue-to-asset");
  await waitForStoredProject(
    (project) => {
      const cue = project.subtitles.find((candidate) => candidate.id === timingCue.id);
      const asset = project.imageAssets.find((candidate) => candidate.id === imageAssetId);
      return (
        cue?.startOffsetMs === asset?.startOffsetMs
        && cue?.endOffsetMs === asset?.endOffsetMs
      );
    },
    "자막을 선택 에셋 전체 구간에 정확히 맞춤"
  );

  const timelinePixelsPerSecond = Number(
    await executeSync<string | number>(
      `return document.querySelector("#timeline-zoom")?.value || 70;`
    )
  );
  const outsideSnapGapMs = Math.round(12 / timelinePixelsPerSecond * 1000);
  const cueEndBeforeSnapMs = timingAsset.endOffsetMs - outsideSnapGapMs;
  await setInputValueAndChange(
    "#cue-end",
    formatEditorTime(timingClip.timelineStartMs + cueEndBeforeSnapMs)
  );
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === timingCue.id)?.endOffsetMs
        === cueEndBeforeSnapMs
    ),
    "자막 자석 스냅 전 12px 간격"
  );
  const cueSnapDrag = await pointerDrag(
    `.cue-block[data-id="${timingCue.id}"] .trim-handle.right`,
    [{ x: 2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }]
  );
  assert(
    cueSnapDrag.moves >= 3
    && cueSnapDrag.trace.some((entry) => (
      entry.snapGuideVisible
      && String(entry.snapGuideLabel || "").includes("에셋 끝")
    )),
    `자막→에셋 자석 가이드가 표시되지 않았습니다: ${JSON.stringify(cueSnapDrag)}`
  );
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === timingCue.id)?.endOffsetMs
        === project.imageAssets.find((asset) => asset.id === imageAssetId)?.endOffsetMs
    ),
    "자막 끝을 8px 자석으로 에셋 끝에 정확히 스냅"
  );
  const snapGuideAfterDrag = await executeSync(`
    return {
      hidden: document.querySelector("#timeline-snap-guide")?.hidden,
      label: document.querySelector("#timeline-snap-guide")?.dataset.label || null
    };
  `);
  assert(
    snapGuideAfterDrag.hidden === true && snapGuideAfterDrag.label === null,
    `드래그 종료 뒤 자석 가이드가 남았습니다: ${JSON.stringify(snapGuideAfterDrag)}`
  );

  await setInputValueAndChange(
    "#cue-end",
    formatEditorTime(timingClip.timelineStartMs + cueEndBeforeSnapMs)
  );
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === timingCue.id)?.endOffsetMs
        === cueEndBeforeSnapMs
    ),
    "Alt 자석 해제 전 자막 간격 복원"
  );
  const cueAltDrag = await pointerDrag(
    `.cue-block[data-id="${timingCue.id}"] .trim-handle.right`,
    [{ x: 2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }],
    { altKey: true }
  );
  const altUnsnappedProject = await waitForStoredProject(
    (project) => {
      const cue = project.subtitles.find((candidate) => candidate.id === timingCue.id);
      const asset = project.imageAssets.find((candidate) => candidate.id === imageAssetId);
      return (
        cue
        && asset
        && cue.endOffsetMs !== asset.endOffsetMs
        && cue.endOffsetMs > cueEndBeforeSnapMs
      );
    },
    "Alt를 누른 자막 경계 drag는 자석 해제"
  );
  assert(
    cueAltDrag.trace.every((entry: ExternalRecord) => !entry.snapGuideVisible)
    && altUnsnappedProject.subtitles.find(
      (cue) => cue.id === timingCue.id
    )?.endOffsetMs !== timingAsset.endOffsetMs,
    `Alt 자석 해제가 지켜지지 않았습니다: ${JSON.stringify(cueAltDrag)}`
  );
  await clickElement("#match-cue-to-asset");
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === timingCue.id)?.endOffsetMs
        === project.imageAssets.find((asset) => asset.id === imageAssetId)?.endOffsetMs
    ),
    "Alt 스냅 검증 뒤 자막·에셋 구간 복원"
  );

  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  const shorterSharedEndOffsetMs = timingAsset.startOffsetMs
    + Math.max(300, Math.floor(timingAssetDurationMs / 2));
  await setInputValueAndChange(
    "#asset-end",
    formatEditorTime(timingClip.timelineStartMs + shorterSharedEndOffsetMs)
  );
  await waitForStoredProject(
    (project) => (
      project.imageAssets.find((asset) => asset.id === imageAssetId)?.endOffsetMs
        === shorterSharedEndOffsetMs
    ),
    "에셋→자막 정확 맞춤 전 에셋 끝 시각 분리"
  );
  await clickElement("#match-asset-to-cue");
  await waitForStoredProject(
    (project) => {
      const cue = project.subtitles.find((candidate) => candidate.id === timingCue.id);
      const asset = project.imageAssets.find((candidate) => candidate.id === imageAssetId);
      return (
        cue?.startOffsetMs === asset?.startOffsetMs
        && cue?.endOffsetMs === asset?.endOffsetMs
      );
    },
    "에셋을 선택 자막 전체 구간에 정확히 맞춤"
  );

  await clickElement(`.cue-block[data-id="${timingCue.id}"] .cue-block-body`);
  await setInputValueAndChange(
    "#cue-end",
    formatEditorTime(timingClip.timelineStartMs + shorterSharedEndOffsetMs)
  );
  await waitForStoredProject(
    (project) => (
      project.subtitles.find((cue) => cue.id === timingCue.id)?.endOffsetMs
        === shorterSharedEndOffsetMs
    ),
    "몸체 이동 공간을 위한 짧은 자막 구간"
  );
  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  await clickElement("#match-asset-to-cue");
  const movableMatchedAssetProject = await waitForStoredProject(
    (project) => {
      const cue = project.subtitles.find((candidate) => candidate.id === timingCue.id);
      const asset = project.imageAssets.find((candidate) => candidate.id === imageAssetId);
      return (
        cue?.startOffsetMs === asset?.startOffsetMs
        && cue?.endOffsetMs === asset?.endOffsetMs
        && asset?.endOffsetMs === shorterSharedEndOffsetMs
      );
    },
    "에셋 몸체 이동 전 짧은 자막 구간에 맞춤"
  );
  const matchedAsset = movableMatchedAssetProject.imageAssets.find(
    (asset) => asset.id === imageAssetId
  )!;
  await clickElement("#toggle-timeline-snap");
  const assetBodyDrag = await pointerDrag(
    `.asset-block[data-id="${imageAssetId}"] .asset-block-body`,
    [{ x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }]
  );
  assert(
    assetBodyDrag.moves >= 3
    && String(assetBodyDrag.trace[0]?.target || "").includes("asset-block-body"),
    `에셋 몸체의 가로 이동 drag가 없습니다: ${JSON.stringify(assetBodyDrag)}`
  );
  const movedAssetProject = await waitForStoredProject(
    (project) => {
      const asset = project.imageAssets.find((candidate) => candidate.id === imageAssetId);
      return (
        Boolean(asset)
        && asset!.startOffsetMs > matchedAsset.startOffsetMs
        && asset!.endOffsetMs - asset!.startOffsetMs
          === matchedAsset.endOffsetMs - matchedAsset.startOffsetMs
      );
    },
    "자석 해제 상태의 에셋 몸체 이동과 길이 보존"
  );
  await clickElement("#toggle-timeline-snap");
  await clickElement("#match-asset-to-cue");
  await waitForStoredProject(
    (project) => {
      const cue = project.subtitles.find((candidate) => candidate.id === timingCue.id);
      const asset = project.imageAssets.find((candidate) => candidate.id === imageAssetId);
      return (
        cue?.startOffsetMs === asset?.startOffsetMs
        && cue?.endOffsetMs === asset?.endOffsetMs
      );
    },
    "몸체 이동 검증 뒤 에셋·자막 구간 복원"
  );
  await setInputValueAndChange(
    "#asset-end",
    formatEditorTime(timingClip.timelineStartMs + timingAsset.endOffsetMs)
  );
  await waitForStoredProject(
    (project) => (
      project.imageAssets.find((asset) => asset.id === imageAssetId)?.endOffsetMs
        === timingAsset.endOffsetMs
    ),
    "후속 에셋 겹침 검증을 위한 원래 에셋 구간 복원"
  );
  await clickElement(`.cue-block[data-id="${timingCue.id}"] .cue-block-body`);
  await clickElement("#delete-cue");
  await waitForStoredProject(
    (project) => (
      project.subtitles.length === 1
      && project.subtitles[0]?.id === cueId
      && project.imageAssets.find((asset) => asset.id === imageAssetId)?.startOffsetMs
        === timingAsset.startOffsetMs
    ),
    "타이밍 맞춤 검증용 자막 정리"
  );

  const assetBlobAudit = await executeAsync<{
    error?: string;
    isBlob?: boolean;
    type?: string;
    size?: number;
    width?: number;
    height?: number;
    cornerAlpha?: number;
    centerAlpha: number;
  }>(`
    const [databaseName, projectId, assetId] = arguments;
    const done = arguments[arguments.length - 1];
    const open = indexedDB.open(databaseName);
    open.onerror = () => done({ error: String(open.error || "IndexedDB open failed") });
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("image-assets", "readonly");
      const request = transaction.objectStore("image-assets").get([projectId, assetId]);
      request.onerror = () => done({ error: String(request.error || "asset Blob read failed") });
      request.onsuccess = async () => {
        try {
          const blob = request.result;
          const bitmap = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3];
          const centerAlpha = context.getImageData(12, 12, 1, 1).data[3];
          bitmap.close();
          database.close();
          done({
            isBlob: blob instanceof Blob,
            type: blob.type,
            size: blob.size,
            width: canvas.width,
            height: canvas.height,
            cornerAlpha,
            centerAlpha
          });
        } catch (error) {
          done({ error: error instanceof Error ? error.message : String(error) });
        }
      };
    };
  `, [DATABASE_NAME, PROJECT_ID, imageAssetId]);
  assert(
    !assetBlobAudit?.error &&
      assetBlobAudit.isBlob &&
      assetBlobAudit.type === "image/png" &&
      assetBlobAudit.width === 24 &&
      assetBlobAudit.height === 24 &&
      assetBlobAudit.cornerAlpha === 0 &&
      assetBlobAudit.centerAlpha > 0 &&
      assetBlobAudit.centerAlpha < 255,
    `IndexedDB 투명 PNG Blob 보존 실패: ${JSON.stringify(assetBlobAudit)}`
  );

  const overlappingAssetPaste = await dispatchTransparentPngPaste();
  assert(
    !overlappingAssetPaste?.error &&
      overlappingAssetPaste.defaultPrevented === true &&
      overlappingAssetPaste.size > 0,
    `완전 겹침 검증용 PNG paste 이벤트를 처리하지 못했습니다: ${JSON.stringify(overlappingAssetPaste)}`
  );
  const overlappingAssetProject = await waitForStoredProject(
    (project) => {
      const first = project.imageAssets?.find((asset) => asset.id === imageAssetId);
      const second = project.imageAssets?.find((asset) => asset.id !== imageAssetId);
      return (
        project.imageAssets?.length === 2 &&
        first &&
        second &&
        first.clipId === second.clipId &&
        first.startOffsetMs === second.startOffsetMs &&
        first.endOffsetMs === second.endOffsetMs
      );
    },
    "완전히 겹치는 두 이미지 에셋 autosave"
  );
  const overlappingImageAssetId = overlappingAssetProject.imageAssets.find(
    (asset) => asset.id !== imageAssetId
  )!.id;
  const overlappingAssetLayout = await waitUntil(async () => {
    const state = await executeSync<{
      firstSubrow: number;
      secondSubrow: number;
      firstTop: number;
      secondTop: number;
      verticallySeparated: boolean;
      trackHeight: number;
      labelHeight: number;
      assetTrackHeightVariable: number;
    } | null>(`
      const first = document.querySelector(
        '.asset-block[data-id="' + arguments[0] + '"]'
      );
      const second = document.querySelector(
        '.asset-block[data-id="' + arguments[1] + '"]'
      );
      const track = document.querySelector("#asset-track");
      const label = document.querySelector(".asset-track-label");
      if (!first || !second || !track || !label) {
        return null;
      }
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      return {
        firstSubrow: Number(first.dataset.subrow),
        secondSubrow: Number(second.dataset.subrow),
        firstTop: Number.parseFloat(getComputedStyle(first).top),
        secondTop: Number.parseFloat(getComputedStyle(second).top),
        verticallySeparated:
          firstRect.bottom <= secondRect.top || secondRect.bottom <= firstRect.top,
        trackHeight: track.getBoundingClientRect().height,
        labelHeight: label.getBoundingClientRect().height,
        assetTrackHeightVariable: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--asset-track-height")
        )
      };
    `, [imageAssetId, overlappingImageAssetId]);
    return (
      state &&
      state.firstSubrow !== state.secondSubrow &&
      state.firstTop !== state.secondTop &&
      state.verticallySeparated &&
      state.trackHeight > 54 &&
      Math.abs(state.trackHeight - state.labelHeight) < 0.01 &&
      Math.abs(state.trackHeight - state.assetTrackHeightVariable) < 0.01
    ) ? state : false;
  }, "완전히 겹치는 에셋의 최소 subrow 분리와 트랙 높이 확장");

  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  await waitForStoredProject(
    (project) => project.selectedImageAssetId === imageAssetId,
    "완전 겹침 첫 번째 에셋 선택"
  );
  await clickElement(`.asset-block[data-id="${overlappingImageAssetId}"] .asset-block-body`);
  await waitForStoredProject(
    (project) => project.selectedImageAssetId === overlappingImageAssetId,
    "완전 겹침 두 번째 에셋 선택"
  );
  await contextClickElement(`.asset-block[data-id="${overlappingImageAssetId}"]`);
  await waitUntil(
    () => executeSync(`return document.querySelector("#context-delete-asset")?.hidden === false;`),
    "완전 겹침 두 번째 에셋 우클릭 메뉴"
  );
  await clickElement("#context-delete-asset");
  await waitForStoredProject(
    (project) => (
      project.imageAssets?.length === 1 &&
      project.imageAssets[0]?.id === imageAssetId
    ),
    "완전 겹침 검증용 두 번째 에셋 삭제"
  );
  const compactAssetTrack = await waitUntil(async () => {
    const state = await executeSync<{
      trackHeight: number;
      subrow: number;
      top: number;
    }>(`
      const track = document.querySelector("#asset-track");
      const block = document.querySelector(
        '.asset-block[data-id="' + arguments[0] + '"]'
      );
      return {
        trackHeight: track?.getBoundingClientRect().height || 0,
        subrow: Number(block?.dataset.subrow),
        top: Number.parseFloat(block ? getComputedStyle(block).top : "NaN")
      };
    `, [imageAssetId]);
    return (
      Math.abs(state.trackHeight - 54) < 0.01 &&
      state.subrow === 0 &&
      state.top === 7
    ) ? state : false;
  }, "겹침 해소 뒤 기본 에셋 트랙 높이 복원");
  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  await waitForStoredProject(
    (project) => project.selectedImageAssetId === imageAssetId,
    "겹침 검증 뒤 첫 번째 에셋 선택 복원"
  );

  const assetBeforeTrim = requireDefined(
    assetProject.imageAssets[0],
    "trim 전 이미지 에셋 fixture를 찾지 못했습니다."
  );
  const assetLeftDrag = await pointerDrag(
    `.asset-block[data-id="${imageAssetId}"] .trim-handle.left`,
    [{ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }]
  );
  assert(
    assetLeftDrag.moves >= 3 &&
      assetLeftDrag.trace[0]?.trusted === true &&
      String(assetLeftDrag.trace[0]?.target || "").includes("trim-handle"),
    `에셋 왼쪽 손잡이의 신뢰된 drag가 없습니다: ${JSON.stringify(assetLeftDrag)}`
  );
  const assetAfterLeftTrimProject = await waitForStoredProject(
    (project) => project.imageAssets.some((asset) => (
      asset.id === imageAssetId && asset.startOffsetMs >= assetBeforeTrim.startOffsetMs + 50
    )),
    "에셋 왼쪽 손잡이 drag autosave"
  );
  const assetAfterLeftTrim = assetAfterLeftTrimProject.imageAssets.find(
    (asset) => asset.id === imageAssetId
  )!;
  const assetRightDrag = await pointerDrag(
    `.asset-block[data-id="${imageAssetId}"] .trim-handle.right`,
    [{ x: -10, y: 0 }, { x: -10, y: 0 }, { x: -10, y: 0 }]
  );
  assert(
    assetRightDrag.moves >= 3 &&
      assetRightDrag.trace[0]?.trusted === true &&
      String(assetRightDrag.trace[0]?.target || "").includes("trim-handle"),
    `에셋 오른쪽 손잡이의 신뢰된 drag가 없습니다: ${JSON.stringify(assetRightDrag)}`
  );
  await waitForStoredProject(
    (project) => project.imageAssets.some((asset) => (
      asset.id === imageAssetId &&
      asset.endOffsetMs <= assetAfterLeftTrim.endOffsetMs - 50 &&
      asset.endOffsetMs > asset.startOffsetMs
    )),
    "에셋 오른쪽 손잡이 drag autosave"
  );

  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  await waitUntil(
    () => executeSync(
      `return Boolean(document.querySelector(
        '#image-asset-overlays .image-asset-overlay[data-asset-id="' + arguments[0] + '"]'
      ));`,
      [imageAssetId]
    ),
    "트림 뒤 이미지 에셋 overlay 복원"
  );
  const assetOverlayDrag = await pointerDrag(
    `#image-asset-overlays .image-asset-overlay[data-asset-id="${imageAssetId}"]`,
    [{ x: 18, y: -12 }, { x: 18, y: -12 }, { x: 18, y: -12 }]
  );
  assert(
    assetOverlayDrag.moves >= 3 && assetOverlayDrag.trace[0]?.trusted === true,
    `이미지 에셋 overlay의 신뢰된 drag가 없습니다: ${JSON.stringify(assetOverlayDrag)}`
  );
  await executeSync(`
    const scale = document.querySelector("#asset-scale");
    const opacity = document.querySelector("#asset-opacity");
    scale.value = "135";
    scale.dispatchEvent(new Event("input", { bubbles: true }));
    scale.dispatchEvent(new Event("change", { bubbles: true }));
    opacity.value = "42";
    opacity.dispatchEvent(new Event("input", { bubbles: true }));
    opacity.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  const styledAssetProject = await waitForStoredProject(
    (project) => project.imageAssets.some((asset) => (
      asset.id === imageAssetId &&
      asset.x > 0.5 &&
      asset.y < 0.5 &&
      Math.abs(asset.scale - 1.35) < 0.001 &&
      Math.abs(asset.opacity - 0.42) < 0.001
    )),
    "에셋 위치·크기·불투명도 autosave"
  );

  await contextClickElement(`.asset-block[data-id="${imageAssetId}"]`);
  const assetContextMenu = await waitUntil(async () => {
    const state = await executeSync(`
      return {
        menuHidden: document.querySelector("#timeline-context-menu")?.hidden,
        pasteHidden: document.querySelector("#context-paste-asset")?.hidden,
        pickHidden: document.querySelector("#context-pick-asset")?.hidden,
        deleteHidden: document.querySelector("#context-delete-asset")?.hidden
      };
    `);
    return (
      state.menuHidden === false &&
      state.pasteHidden === false &&
      state.pickHidden === false &&
      state.deleteHidden === false
    ) ? state : false;
  }, "에셋 우클릭 붙여넣기·파일·삭제 메뉴");
  await pressKey(KEY.ESCAPE);

  await clickElement("#add-audio-region");
  const audioProject = await waitForStoredProject(
    (project) => (
      project.audioRegions.length === 1
      && Boolean(project.selectedAudioRegionId)
    ),
    "음성 설정 구간 추가"
  );
  const audioRegionId = requireDefined(
    audioProject.audioRegions[0],
    "추가한 음성 설정 구간 fixture를 찾지 못했습니다."
  ).id;
  await waitUntil(async () => {
    const state = await executeSync(`
      return {
        block: Boolean(document.querySelector('.audio-block[data-id="' + arguments[0] + '"]')),
        editorHidden: document.querySelector("#audio-editor")?.hidden,
        audioTabSelected: document.querySelector("#audio-mode-tab")?.getAttribute("aria-selected")
      };
    `, [audioRegionId]);
    return (
      state.block &&
      state.editorHidden === false &&
      state.audioTabSelected === "true"
    ) ? state : false;
  }, "음성 설정 선택 UI");

  const playbackPointerProject = await readStoredProject();
  assert(playbackPointerProject, "재생 중 포인터 회귀 검증 프로젝트가 없습니다.");
  const playbackPointerCue = playbackPointerProject.subtitles.find(
    (cue) => cue.id === cueId
  );
  const playbackPointerAsset = playbackPointerProject.imageAssets.find(
    (asset) => asset.id === imageAssetId
  );
  const playbackPointerAudio = playbackPointerProject.audioRegions.find(
    (region) => region.id === audioRegionId
  );
  assert(playbackPointerCue, "재생 중 선택 검증 자막이 없습니다.");
  assert(playbackPointerAsset, "재생 중 선택 검증 에셋이 없습니다.");
  assert(playbackPointerAudio, "재생 중 선택 검증 음성 구간이 없습니다.");
  const clipById = new Map(
    playbackPointerProject.clips.map((clip) => [clip.id, clip])
  );
  const cueClipForPointer = clipById.get(playbackPointerCue.clipId);
  const assetClipForPointer = clipById.get(playbackPointerAsset.clipId);
  const audioClipForPointer = clipById.get(playbackPointerAudio.clipId);
  assert(cueClipForPointer, "자막의 포인터 회귀 검증 컷이 없습니다.");
  assert(assetClipForPointer, "에셋의 포인터 회귀 검증 컷이 없습니다.");
  assert(audioClipForPointer, "음성 구간의 포인터 회귀 검증 컷이 없습니다.");
  const timelineStartForOffset = (clip: EditorClip, offsetMs: number) => (
    clip.timelineStartMs + offsetMs
  );
  const playbackTimelineAwayFrom = (clipId: string) => {
    const awayClip = playbackPointerProject.clips.find((clip) => (
      clip.enabled !== false && clip.id !== clipId
    ));
    assert(awayClip, `${clipId}와 다른 재생 검증 컷이 없습니다.`);
    const durationMs = awayClip.sourceEndMs - awayClip.sourceStartMs;
    return awayClip.timelineStartMs + Math.min(
      725,
      Math.max(625, durationMs - 1_500)
    );
  };
  const playbackTimelineWithinClipAwayFrom = (
    clip: EditorClip,
    itemStartMs: number
  ) => {
    const durationMs = clip.sourceEndMs - clip.sourceStartMs;
    const candidates = [
      clip.timelineStartMs + 250,
      clip.timelineStartMs + Math.max(250, durationMs - 750)
    ];
    const target = candidates.reduce((best, candidate) => (
      Math.abs(candidate - itemStartMs) > Math.abs(best - itemStartMs)
        ? candidate
        : best
    ));
    assert(
      Math.abs(target - itemStartMs) >= 1_500,
      `같은 컷 자막 재생 검증 위치가 시작점과 충분히 떨어져 있지 않습니다: ${JSON.stringify({
        clipId: clip.id,
        durationMs,
        itemStartMs,
        target
      })}`
    );
    return target;
  };

  const playheadTestClip = playbackPointerProject.clips.find(
    (clip) => clip.enabled !== false && clip.id !== playbackPointerCue.clipId
  ) || cueClipForPointer;
  const playheadTestClipDuration = (
    playheadTestClip.sourceEndMs - playheadTestClip.sourceStartMs
  );
  const playheadInitialTimelineMs = playheadTestClip.timelineStartMs + Math.min(
    650,
    Math.max(250, playheadTestClipDuration - 1_600)
  );
  const rulerExplicitTimelineMs = playheadTestClip.timelineStartMs + Math.min(
    1_350,
    Math.max(700, playheadTestClipDuration - 900)
  );
  const rulerInitialSeek = await seekPausedPreviewWithRuler(playheadInitialTimelineMs);
  const playheadHitbox = await executeSync<{
    playheadHeight: number;
    rulerHeight: number;
    lineHeight: number;
    linePointerEvents: string;
    rulerHitIsPlayhead: boolean;
    trackHitIsPlayhead: boolean;
    trackHitTarget: string | null;
  }>(`
    const playhead = document.querySelector("#playhead");
    const ruler = document.querySelector("#timeline-ruler");
    const line = playhead?.querySelector("span");
    const captionTrack = document.querySelector(".caption-track-row");
    const playheadRect = playhead.getBoundingClientRect();
    const rulerRect = ruler.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const captionRect = captionTrack.getBoundingClientRect();
    const rulerHit = document.elementFromPoint(
      playheadRect.left + playheadRect.width / 2,
      playheadRect.top + playheadRect.height / 2
    );
    const trackHit = document.elementFromPoint(
      playheadRect.left + playheadRect.width / 2,
      captionRect.top + captionRect.height / 2
    );
    return {
      playheadHeight: playheadRect.height,
      rulerHeight: rulerRect.height,
      lineHeight: lineRect.height,
      linePointerEvents: getComputedStyle(line).pointerEvents,
      rulerHitIsPlayhead: rulerHit?.closest("#playhead") === playhead,
      trackHitIsPlayhead: trackHit?.closest("#playhead") === playhead,
      trackHitTarget: trackHit?.className || trackHit?.id || trackHit?.tagName || null
    };
  `);
  assert(
    Math.abs(playheadHitbox.playheadHeight - playheadHitbox.rulerHeight) <= 0.5
      && playheadHitbox.linePointerEvents === "none"
      && playheadHitbox.rulerHitIsPlayhead
      && !playheadHitbox.trackHitIsPlayhead,
    `playhead ruler 전용 hitbox 계약 위반: ${JSON.stringify(playheadHitbox)}`
  );

  const playheadSimpleBefore = await readPreviewState();
  await pointerDrag("#playhead", []);
  await delay(100);
  const playheadSimpleAfter = await readPreviewState();
  assert(
    playheadSimpleAfter.paused
      && Math.abs(playheadSimpleAfter.playheadMs - playheadSimpleBefore.playheadMs) <= 5
      && Math.abs(playheadSimpleAfter.currentTime - playheadSimpleBefore.currentTime) <= 0.02,
    `playhead 단순 클릭이 seek했습니다: ${JSON.stringify({
      before: playheadSimpleBefore,
      after: playheadSimpleAfter
    })}`
  );

  const playheadDeadzoneBefore = await readPreviewState();
  await pointerDrag("#playhead", [{ x: 2, y: 0, duration: 120 }]);
  await delay(100);
  const playheadDeadzoneAfter = await readPreviewState();
  assert(
    Math.abs(playheadDeadzoneAfter.playheadMs - playheadDeadzoneBefore.playheadMs) <= 5
      && Math.abs(playheadDeadzoneAfter.currentTime - playheadDeadzoneBefore.currentTime) <= 0.02,
    `playhead 4px 미만 움직임이 scrub으로 처리됐습니다: ${JSON.stringify({
      before: playheadDeadzoneBefore,
      after: playheadDeadzoneAfter
    })}`
  );

  const playheadRightBefore = await readPreviewState();
  await pointerDrag(
    "#playhead",
    [{ x: 12, y: 0, duration: 120 }],
    { button: 2 }
  );
  await delay(100);
  const playheadRightAfter = await readPreviewState();
  assert(
    Math.abs(playheadRightAfter.playheadMs - playheadRightBefore.playheadMs) <= 5
      && Math.abs(playheadRightAfter.currentTime - playheadRightBefore.currentTime) <= 0.02,
    `playhead 우클릭 drag가 seek했습니다: ${JSON.stringify({
      before: playheadRightBefore,
      after: playheadRightAfter
    })}`
  );

  const playheadCancelBefore = await readPreviewState();
  const playheadCancelProbe = await cancelPlayheadPointerAndProbeHover();
  await delay(100);
  const playheadCancelAfter = await readPreviewState();
  assert(
    playheadCancelProbe.captureReleased
      && Math.abs(
        playheadCancelProbe.afterPlayheadMs - playheadCancelProbe.beforePlayheadMs
      ) <= 5
      && Math.abs(playheadCancelAfter.playheadMs - playheadCancelBefore.playheadMs) <= 5,
    `취소된 playhead 포인터가 hover seek listener를 남겼습니다: ${JSON.stringify({
      probe: playheadCancelProbe,
      before: playheadCancelBefore,
      after: playheadCancelAfter
    })}`
  );

  const playheadDragBefore = await readPreviewState();
  const playheadPrimaryDrag = await pointerDrag(
    "#playhead",
    [{ x: 12, y: 0, duration: 180 }]
  );
  const playheadDragAfter = await waitUntil(async () => {
    const state = await readPreviewState();
    return (
      state.paused
      && !state.seeking
      && state.playheadMs >= playheadDragBefore.playheadMs + 100
    ) ? state : false;
  }, "primary 좌클릭 playhead 실제 drag scrub");
  const rulerExplicitSeek = await seekPausedPreviewWithRuler(rulerExplicitTimelineMs);
  assert(
    Math.abs(rulerExplicitSeek.state.playheadMs - rulerExplicitTimelineMs) <= 45,
    `ruler 명시 seek가 유지되지 않았습니다: ${JSON.stringify(rulerExplicitSeek)}`
  );
  const playheadPointerContract = {
    rulerInitialSeek,
    hitbox: playheadHitbox,
    simpleClick: { before: playheadSimpleBefore, after: playheadSimpleAfter },
    deadzone: { before: playheadDeadzoneBefore, after: playheadDeadzoneAfter },
    rightDrag: { before: playheadRightBefore, after: playheadRightAfter },
    canceled: { before: playheadCancelBefore, probe: playheadCancelProbe, after: playheadCancelAfter },
    primaryDrag: { before: playheadDragBefore, drag: playheadPrimaryDrag, after: playheadDragAfter },
    rulerExplicitSeek
  };

  const playbackPointerFirstClip = requireDefined(
    playbackPointerProject.clips[0],
    "포인터 선택 검증용 첫 영상 컷 fixture를 찾지 못했습니다."
  );
  const selectionCases = [
    {
      selector: `.clip-block[data-id="${playbackPointerFirstClip.id}"] .clip-block-body`,
      selectionKey: "selectedClipId" as const,
      selectionId: playbackPointerFirstClip.id,
      itemStartMs: playbackPointerFirstClip.timelineStartMs,
      itemClipId: playbackPointerFirstClip.id,
      label: "영상 컷"
    },
    {
      selector: `.cue-block[data-id="${cueId}"] .cue-block-body`,
      selectionKey: "selectedCueId" as const,
      selectionId: cueId,
      itemStartMs: timelineStartForOffset(
        cueClipForPointer,
        playbackPointerCue.startOffsetMs
      ),
      itemClipId: playbackPointerCue.clipId,
      expectedInspectorTab: "#caption-mode-tab",
      label: "자막 블록"
    },
    {
      selector: `.asset-block[data-id="${imageAssetId}"] .asset-block-body`,
      selectionKey: "selectedImageAssetId" as const,
      selectionId: imageAssetId,
      itemStartMs: timelineStartForOffset(
        assetClipForPointer,
        playbackPointerAsset.startOffsetMs
      ),
      itemClipId: playbackPointerAsset.clipId,
      expectedInspectorTab: "#asset-mode-tab",
      label: "에셋 블록"
    },
    {
      selector: `.audio-block[data-id="${audioRegionId}"] .audio-block-body`,
      selectionKey: "selectedAudioRegionId" as const,
      selectionId: audioRegionId,
      itemStartMs: timelineStartForOffset(
        audioClipForPointer,
        playbackPointerAudio.startOffsetMs
      ),
      itemClipId: playbackPointerAudio.clipId,
      expectedInspectorTab: "#audio-mode-tab",
      label: "음성 블록"
    }
  ];
  const playingSelectionResults = [];
  for (const selectionCase of selectionCases) {
    playingSelectionResults.push({
      label: selectionCase.label,
      result: selectionCase.selectionKey === "selectedCueId"
        ? await assertPlayingCueSelectionSeeks({
          ...selectionCase,
          playbackTimelineMs: playbackTimelineAwayFrom(selectionCase.itemClipId)
        })
        : await assertPlayingSelectionDoesNotSeek({
          ...selectionCase,
          playbackTimelineMs: playbackTimelineAwayFrom(selectionCase.itemClipId)
        })
    });
  }

  await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
  await clickElement("#cue-list-tab");
  const cueListStartMs = timelineStartForOffset(
    cueClipForPointer,
    playbackPointerCue.startOffsetMs
  );
  const playingCueListSelection = await assertPlayingCueSelectionSeeks({
    selector: `.cue-list-item[data-id="${cueId}"]`,
    selectionId: cueId,
    itemStartMs: cueListStartMs,
    itemClipId: playbackPointerCue.clipId,
    playbackTimelineMs: playbackTimelineAwayFrom(playbackPointerCue.clipId),
    expectedInspectorTab: "#caption-mode-tab",
    label: "자막 목록"
  });

  const sameClipPlaybackTimelineMs = playbackTimelineWithinClipAwayFrom(
    cueClipForPointer,
    cueListStartMs
  );
  const playingSameClipCueBlockSelection = await assertPlayingCueSelectionSeeks({
    selector: `.cue-block[data-id="${cueId}"] .cue-block-body`,
    selectionId: cueId,
    itemStartMs: cueListStartMs,
    itemClipId: playbackPointerCue.clipId,
    playbackTimelineMs: sameClipPlaybackTimelineMs,
    expectedInspectorTab: "#caption-mode-tab",
    label: "같은 컷 자막 블록"
  });
  await clickElement("#cue-list-tab");
  const playingSameClipCueListSelection = await assertPlayingCueSelectionSeeks({
    selector: `.cue-list-item[data-id="${cueId}"]`,
    selectionId: cueId,
    itemStartMs: cueListStartMs,
    itemClipId: playbackPointerCue.clipId,
    playbackTimelineMs: sameClipPlaybackTimelineMs,
    expectedInspectorTab: "#caption-mode-tab",
    label: "같은 컷 자막 목록"
  });

  const pausedSelectionResults = [];
  for (const selectionCase of selectionCases) {
    pausedSelectionResults.push({
      label: selectionCase.label,
      result: await assertPausedSelectionSeeks({
        ...selectionCase,
        playbackTimelineMs: playbackTimelineAwayFrom(selectionCase.itemClipId)
      })
    });
  }
  await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
  await clickElement("#cue-list-tab");
  const pausedCueListSelection = await assertPausedSelectionSeeks({
    selector: `.cue-list-item[data-id="${cueId}"]`,
    selectionKey: "selectedCueId",
    selectionId: cueId,
    itemStartMs: cueListStartMs,
    itemClipId: playbackPointerCue.clipId,
    playbackTimelineMs: playbackTimelineAwayFrom(playbackPointerCue.clipId),
    expectedInspectorTab: "#caption-mode-tab",
    label: "자막 목록"
  });

  const timedBlockPlaybackDrags = [];
  for (const snapEnabled of [true, false]) {
    await setTimelineSnapForTest(snapEnabled);
    const beforeProject = await readStoredProject();
    const beforeCue = beforeProject?.subtitles.find((cue) => cue.id === cueId);
    const beforeCueClip = beforeProject?.clips.find(
      (clip) => clip.id === beforeCue?.clipId
    );
    assert(beforeProject && beforeCue && beforeCueClip, "재생 중 자막 drag 사전 cue가 없습니다.");
    const beforeDurationMs = beforeCue.endOffsetMs - beforeCue.startOffsetMs;
    const cueClipDurationMs = beforeCueClip.sourceEndMs - beforeCueClip.sourceStartMs;
    const direction = beforeCue.startOffsetMs >= 350
      ? -1
      : beforeCue.endOffsetMs <= cueClipDurationMs - 350
        ? 1
        : 0;
    assert(direction !== 0, "재생 중 자막 drag를 검증할 이동 여유가 없습니다.");
    const cueTimelineStartMs = beforeCueClip.timelineStartMs + beforeCue.startOffsetMs;
    const cuePreviewStartSeconds = (
      (Number(beforeProject.mediaAsset?.mediaOriginMs) || 0)
      + beforeCueClip.sourceStartMs
      + beforeCue.startOffsetMs
    ) / 1000;
    await pausePreviewForPointerTest();
    await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
    const selectedCueStart = await waitUntil(async () => {
      const state = await readPreviewState();
      return (
        state.paused
        && !state.seeking
        && Math.abs(state.playheadMs - cueTimelineStartMs) <= 45
        && Math.abs(state.currentTime - cuePreviewStartSeconds) <= 0.06
      ) ? state : false;
    }, `자석 ${snapEnabled ? "ON" : "OFF"} timed block 재생 시작점`);
    await clickElement("#play-toggle");
    const playbackStart = await waitUntil(async () => {
      const state = await readPreviewState();
      return (
        !state.paused
        && !state.seeking
        && state.playheadMs >= cueTimelineStartMs + 300
      ) ? state : false;
    }, `자석 ${snapEnabled ? "ON" : "OFF"} timed block 재생 진행`);
    const beforeDrag = await readPreviewState();
    const drag = await pointerDrag(
      `.cue-block[data-id="${cueId}"] .cue-block-body`,
      [
        { x: direction * 6, y: 0, duration: 280 },
        { x: direction * 6, y: 0, duration: 280 },
        { x: direction * 6, y: 0, duration: 280 }
      ]
    );
    const movedProject = await waitForStoredProject(
      (candidate) => {
        const moved = candidate.subtitles.find((cue) => cue.id === cueId);
        return Boolean(
          moved
          && (
            moved.startOffsetMs !== beforeCue.startOffsetMs
            || moved.endOffsetMs !== beforeCue.endOffsetMs
          )
        );
      },
      `자석 ${snapEnabled ? "ON" : "OFF"} 재생 중 timed block drag 저장`
    );
    const movedCue = movedProject.subtitles.find((cue) => cue.id === cueId)!;
    const lastMoveVideoTime = Math.max(
      ...drag.trace
        .map((entry) => Number(entry.previewCurrentTime))
        .filter(Number.isFinite)
    );
    const lastMovePlayheadMs = Math.max(
      ...drag.trace
        .map((entry) => Number(entry.playheadSeconds) * 1000)
        .filter(Number.isFinite)
    );
    await delay(180);
    const afterDrag = await readPreviewState();
    assert(
      drag.moves >= 3
        && !afterDrag.paused
        && movedCue.endOffsetMs - movedCue.startOffsetMs === beforeDurationMs
        && Number.isFinite(lastMoveVideoTime)
        && Number.isFinite(lastMovePlayheadMs)
        && afterDrag.currentTime >= lastMoveVideoTime - 0.12
        && afterDrag.playheadMs >= lastMovePlayheadMs - 150,
      `자석 ${snapEnabled ? "ON" : "OFF"} timed block drag 뒤 영상이 과거로 되감겼습니다: ${JSON.stringify({
        beforeDrag,
        drag,
        lastMoveVideoTime,
        lastMovePlayheadMs,
        afterDrag,
        beforeCue,
        movedCue
      })}`
    );
    await pausePreviewForPointerTest();
    timedBlockPlaybackDrags.push({
      snapEnabled,
      selectedCueStart,
      playbackStart,
      beforeDrag,
      drag,
      afterDrag,
      beforeCue,
      movedCue
    });
  }
  await setTimelineSnapForTest(true);
  const playbackPointerSafety = {
    playhead: playheadPointerContract,
    playingSelections: playingSelectionResults,
    playingCueListSelection,
    playingSameClipCueBlockSelection,
    playingSameClipCueListSelection,
    pausedSelections: pausedSelectionResults,
    pausedCueListSelection,
    timedBlockPlaybackDrags
  };

  await executeSync(`
    const input = document.querySelector("#audio-volume");
    input.value = "35";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  const quietAudioProject = await waitForStoredProject(
    (project) => Math.abs((project.audioRegions[0]?.gain ?? Number.NaN) - 0.35) < 0.0001,
    "음성 구간 음량 autosave"
  );
  const audioClip = quietAudioProject.clips.find(
    (clip) => clip.id === quietAudioProject.audioRegions[0]?.clipId
  );
  assert(audioClip, "정밀 음성 미리보기용 clip을 찾지 못했습니다.");
  const preciseAudioStartOffsetMs = 500;
  const preciseAudioEndOffsetMs = 620;
  const preciseAudioStartMs = audioClip.timelineStartMs + preciseAudioStartOffsetMs;
  const preciseAudioEndMs = audioClip.timelineStartMs + preciseAudioEndOffsetMs;
  await executeSync(`
    const start = document.querySelector("#audio-start");
    const end = document.querySelector("#audio-end");
    start.value = arguments[0];
    start.dispatchEvent(new Event("change", { bubbles: true }));
    end.value = arguments[1];
    end.dispatchEvent(new Event("change", { bubbles: true }));
    const volume = document.querySelector("#audio-volume");
    volume.value = "0";
    volume.dispatchEvent(new Event("input", { bubbles: true }));
    volume.dispatchEvent(new Event("change", { bubbles: true }));
  `, [
    formatEditorTime(preciseAudioStartMs),
    formatEditorTime(preciseAudioEndMs)
  ]);
  const preciseAudioProject = await waitForStoredProject(
    (project) => (
      project.audioRegions[0]?.startOffsetMs === preciseAudioStartOffsetMs &&
      project.audioRegions[0]?.endOffsetMs === preciseAudioEndOffsetMs &&
      project.audioRegions[0]?.gain === 0
    ),
    "120ms 정밀 음성 구간 autosave"
  );
  const preciseAudioRegion = requireDefined(
    preciseAudioProject.audioRegions[0],
    "정밀 미리보기용 음성 설정 구간 fixture를 찾지 못했습니다."
  );
  const preciseAudioMediaOriginMs = Number(preciseAudioProject.mediaAsset?.mediaOriginMs) || 0;
  const preciseAudioPreviewStartSeconds = (
    preciseAudioMediaOriginMs +
    audioClip.sourceStartMs +
    preciseAudioRegion.startOffsetMs
  ) / 1_000;
  const preciseAudioPreviewEndSeconds = (
    preciseAudioMediaOriginMs +
    audioClip.sourceStartMs +
    preciseAudioRegion.endOffsetMs
  ) / 1_000;
  await executeAsync(`
    const video = document.querySelector("#preview-video");
    const target = arguments[0];
    const done = arguments[arguments.length - 1];
    video.pause();
    const finish = () => {
      video.removeEventListener("seeked", finish);
      video.dispatchEvent(new Event("timeupdate"));
      requestAnimationFrame(() => done({
        currentTime: video.currentTime,
        paused: video.paused,
        volume: video.volume
      }));
    };
    video.addEventListener("seeked", finish, { once: true });
    video.currentTime = target;
    if (!video.seeking) {
      finish();
    }
  `, [preciseAudioPreviewStartSeconds - 0.08]);
  const preciseAudioTraceSetup = await executeSync<{
    currentTime: number;
    paused: boolean;
    volume: number;
  }>(`
    const video = document.querySelector("#preview-video");
    let volumePrototype = video;
    let volumeDescriptor = null;
    while (volumePrototype && !volumeDescriptor) {
      volumeDescriptor = Object.getOwnPropertyDescriptor(volumePrototype, "volume");
      volumePrototype = Object.getPrototypeOf(volumePrototype);
    }
    if (!volumeDescriptor?.get || !volumeDescriptor?.set) {
      throw new Error("HTMLMediaElement volume descriptor를 찾지 못했습니다.");
    }
    globalThis.__kirinukiPreciseAudioTrace = {
      transitions: [],
      startedAt: video.currentTime,
      lastAppliedVolume: volumeDescriptor.get.call(video)
    };
    Object.defineProperty(video, "volume", {
      configurable: true,
      get() {
        return volumeDescriptor.get.call(video);
      },
      set(value) {
        const trace = globalThis.__kirinukiPreciseAudioTrace;
        if (trace && value !== trace.lastAppliedVolume) {
          trace.lastAppliedVolume = value;
          trace.transitions.push({
            currentTime: video.currentTime,
            volume: value
          });
        }
        volumeDescriptor.set.call(video, value);
      }
    });
    return {
      currentTime: video.currentTime,
      paused: video.paused,
      volume: video.volume
    };
  `);
  assert(
    preciseAudioTraceSetup.paused &&
      preciseAudioTraceSetup.volume === 1 &&
      preciseAudioTraceSetup.currentTime < preciseAudioPreviewStartSeconds,
    `정밀 음성 미리보기 사전 상태가 잘못됐습니다: ${JSON.stringify(preciseAudioTraceSetup)}`
  );
  await clickElement("#play-toggle");
  await waitUntil(
    () => executeSync(
      `return document.querySelector("#preview-video").currentTime >= arguments[0];`,
      [preciseAudioPreviewEndSeconds + 0.08]
    ),
    "120ms 음성 구간 재생 통과",
    { timeout: 5_000 }
  );
  const preciseAudioPreviewClock = await executeSync<{
    transitions: Array<{
      currentTime: number;
      volume: number;
    }>;
    startedAt: number;
    lastAppliedVolume: number;
    finishedAt: number;
    finalVolume: number;
    paused: boolean;
  }>(`
    const video = document.querySelector("#preview-video");
    video.pause();
    const trace = globalThis.__kirinukiPreciseAudioTrace;
    delete video.volume;
    delete globalThis.__kirinukiPreciseAudioTrace;
    return {
      ...trace,
      finishedAt: video.currentTime,
      finalVolume: video.volume,
      paused: video.paused
    };
  `);
  const preciseAudioEnter = preciseAudioPreviewClock.transitions.find(
    (transition) => transition.volume === 0
  );
  const preciseAudioExit = preciseAudioPreviewClock.transitions.find(
    (transition) => (
      transition.volume === 1 &&
      transition.currentTime >= preciseAudioPreviewStartSeconds
    )
  );
  assert(
    preciseAudioEnter &&
      preciseAudioEnter.currentTime >= preciseAudioPreviewStartSeconds - 0.02 &&
      preciseAudioEnter.currentTime <= preciseAudioPreviewStartSeconds + 0.05,
    `120ms 음소거 진입이 50ms 안에 적용되지 않았습니다: ${JSON.stringify({
      preciseAudioPreviewStartSeconds,
      preciseAudioPreviewClock
    })}`
  );
  assert(
    preciseAudioExit &&
      preciseAudioExit.currentTime >= preciseAudioPreviewEndSeconds - 0.02 &&
      preciseAudioExit.currentTime <= preciseAudioPreviewEndSeconds + 0.05,
    `120ms 음소거 해제가 50ms 안에 적용되지 않았습니다: ${JSON.stringify({
      preciseAudioPreviewEndSeconds,
      preciseAudioPreviewClock
    })}`
  );
  await contextClickElement(`.audio-block[data-id="${audioRegionId}"]`);
  await waitUntil(
    () => executeSync(`return document.querySelector("#context-delete-audio")?.hidden === false;`),
    "음성 우클릭 삭제 메뉴"
  );
  await clickElement("#context-delete-audio");
  await waitForStoredProject(
    (project) => project.audioRegions.length === 0,
    "우클릭 음성 설정 삭제"
  );
  await executeSync(`
    document.querySelector(
      '.cue-block[data-id="' + arguments[0] + '"] .cue-block-body'
    )?.click();
  `, [cueId]);
  await waitUntil(async () => {
    const state = await executeSync<{
      text: string;
      captionTabSelected: string | null;
    }>(`
      return {
        text: document.querySelector("#cue-text")?.value || "",
        captionTabSelected: document.querySelector("#caption-mode-tab")?.getAttribute("aria-selected")
      };
    `);
    return (
      state.text === EDITED_TEXT &&
      state.captionTabSelected === "true"
    ) ? state : false;
  }, "멀티트랙 검증 후 원래 자막 선택 복원");
  const multitrackUiProbe = {
    color: coloredCueProject.subtitles.find((cue) => cue.id === cueId)?.color,
    colorRegister: {
      ui: colorRegisterUi,
      recent: colorRegisterProject.recentSubtitleColors,
      shortcuts: captionColorShortcuts
    },
    laneUi,
    cueLaneNavigation,
    captionContextMenu,
    simultaneousCueLane: simultaneousCue.lane,
    simultaneousOverlayCount,
    audioGain: quietAudioProject.audioRegions[0]?.gain,
    preciseAudioPreviewClock: {
      region: {
        startOffsetMs: preciseAudioRegion.startOffsetMs,
        endOffsetMs: preciseAudioRegion.endOffsetMs,
        gain: preciseAudioRegion.gain
      },
      expected: {
        startSeconds: preciseAudioPreviewStartSeconds,
        endSeconds: preciseAudioPreviewEndSeconds
      },
      trace: preciseAudioPreviewClock
    },
    asset: {
      id: imageAssetId,
      ui: assetUi,
      blob: assetBlobAudit,
      style: styledAssetProject.imageAssets.find((asset) => asset.id === imageAssetId),
      contextMenu: assetContextMenu,
      overlappingLayout: {
        ...overlappingAssetLayout,
        compact: compactAssetTrack
      },
      trim: {
        left: assetLeftDrag,
        right: assetRightDrag
      },
      timing: {
        cueMatchButton,
        snap: cueSnapDrag,
        altBypass: cueAltDrag,
        bodyDrag: assetBodyDrag,
        moved: movedAssetProject.imageAssets.find(
          (asset) => asset.id === imageAssetId
        )
      }
    }
  };

  const reorderKeyboardSetup = await executeSync(`
    const control = document.querySelector(
      '.clip-item[data-id="clip-selection-b"] [data-action="up"]'
    );
    globalThis.__kirinukiE2eReorderKeyboard = {
      clicks: 0,
      trustedClicks: 0
    };
    control?.addEventListener("click", (event) => {
      globalThis.__kirinukiE2eReorderKeyboard.clicks += 1;
      globalThis.__kirinukiE2eReorderKeyboard.trustedClicks += Number(event.isTrusted);
    });
    control?.focus();
    return {
      activeClipId: document.activeElement?.closest(".clip-item")?.dataset.id || null,
      activeAction: document.activeElement?.dataset.action || null
    };
  `);
  assert(
    reorderKeyboardSetup.activeClipId === "clip-selection-b" &&
      reorderKeyboardSetup.activeAction === "up",
    `clip reorder 키보드 사전 focus 오류: ${JSON.stringify(reorderKeyboardSetup)}`
  );
  await pressKey(KEY.SPACE);
  const reorderedProject = await waitForStoredProject(
    (project) => project.clips[0]?.id === "clip-selection-b" && project.clips[1]?.id === "clip-selection-a",
    "clip reorder autosave"
  );
  const reorderKeyboardFocus = await waitUntil(async () => {
    const state = await executeSync<{
      clicks: number;
      trustedClicks: number;
      clipOrder: Array<string | undefined>;
      activeClipId: string | null;
      activeClass: string | null;
      activeAction: string | null;
    }>(`
      const active = document.activeElement;
      return {
        ...globalThis.__kirinukiE2eReorderKeyboard,
        clipOrder: [...document.querySelectorAll("#clip-list .clip-item")]
          .map((item) => item.dataset.id),
        activeClipId: active?.closest(".clip-item")?.dataset.id || null,
        activeClass: active?.className || null,
        activeAction: active?.dataset.action || null
      };
    `);
    return (
      state.clicks === 1 &&
      state.trustedClicks === 1 &&
      state.clipOrder.join(",") === "clip-selection-b,clip-selection-a" &&
      state.activeClipId === "clip-selection-b" &&
      state.activeClass === "clip-select" &&
      state.activeAction === null
    ) ? state : false;
  }, "clip reorder 키보드 click 뒤 같은 clip focus 복원");
  assert(reorderedProject.subtitles.some((cue) => cue.id === cueId), "reorder 저장본에서 자막을 찾지 못했습니다.");

  const rollbackClipBefore = reorderedProject.clips.find(
    (clip) => clip.id === "clip-selection-a"
  );
  const rollbackCueBefore = reorderedProject.subtitles.find((cue) => cue.id === cueId);
  assert(
    rollbackClipBefore &&
      rollbackCueBefore?.origin === "human" &&
      rollbackCueBefore.text === EDITED_TEXT,
    "clip trim round-trip 전 human cue fixture가 없습니다."
  );
  const liveClipTrimProbeSetup = await executeSync<{
    ready: boolean;
    left: string | null;
    width: string | null;
    hidden: boolean | null;
  }>(`
    const cue = document.querySelector('.cue-block[data-id="' + arguments[0] + '"]');
    globalThis.__kirinukiE2eLiveClipTrimGeometry = [];
    globalThis.__kirinukiE2eLiveClipTrimObserver?.disconnect();
    globalThis.__kirinukiE2eLiveClipTrimObserver = new MutationObserver(() => {
      globalThis.__kirinukiE2eLiveClipTrimGeometry.push({
        left: cue?.style.left || null,
        width: cue?.style.width || null,
        hidden: cue?.hidden ?? null
      });
    });
    if (cue) {
      globalThis.__kirinukiE2eLiveClipTrimObserver.observe(cue, {
        attributes: true,
        attributeFilter: ["style", "hidden"]
      });
    }
    return {
      ready: Boolean(cue),
      left: cue?.style.left || null,
      width: cue?.style.width || null,
      hidden: cue?.hidden ?? null
    };
  `, [cueId]);
  assert(
    liveClipTrimProbeSetup.ready,
    `clip trim 중 자막 geometry probe를 준비하지 못했습니다: ${JSON.stringify(liveClipTrimProbeSetup)}`
  );
  const clipTrimRoundTrip = await pointerDrag(
    '.clip-block[data-id="clip-selection-a"] .trim-handle.left',
    [{ x: 160, y: 0, duration: 180 }, { x: -160, y: 0, duration: 180 }]
  );
  await delay(50);
  const liveClipTrimGeometry = await executeSync<Array<{
    left: string | null;
    width: string | null;
    hidden: boolean | null;
  }>>(`
    globalThis.__kirinukiE2eLiveClipTrimObserver?.disconnect();
    delete globalThis.__kirinukiE2eLiveClipTrimObserver;
    return globalThis.__kirinukiE2eLiveClipTrimGeometry || [];
  `);
  assert(
    liveClipTrimGeometry.some((entry) => (
      entry.hidden ||
      entry.left !== liveClipTrimProbeSetup.left ||
      entry.width !== liveClipTrimProbeSetup.width
    )),
    `clip 손잡이 drag 중 자막 geometry가 영상과 함께 갱신되지 않았습니다: ${JSON.stringify({
      before: liveClipTrimProbeSetup,
      changes: liveClipTrimGeometry
    })}`
  );
  const roundTripDown = clipTrimRoundTrip.trace.find((event) => event.type === "down");
  const roundTripMoves = clipTrimRoundTrip.trace.filter((event) => event.type === "move");
  const roundTripUp = clipTrimRoundTrip.trace.find((event) => event.type === "up");
  assert(
    roundTripDown &&
      roundTripUp &&
      Math.max(...roundTripMoves.map((event) => event.x)) >= roundTripDown.x + 140 &&
      Math.abs(roundTripUp.x - roundTripDown.x) <= 2,
    `clip 왼쪽 손잡이가 cue 뒤까지 갔다가 release 전 복귀하지 않았습니다: ${JSON.stringify(
      clipTrimRoundTrip
    )}`
  );
  await delay(350);
  const roundTripProject = await waitForStoredProject(
    (project) => {
      const clip = project.clips.find((candidate) => candidate.id === "clip-selection-a");
      const cue = project.subtitles.find((candidate) => candidate.id === cueId);
      return (
        clip?.sourceStartMs === rollbackClipBefore.sourceStartMs &&
        clip?.sourceEndMs === rollbackClipBefore.sourceEndMs &&
        cue?.text === rollbackCueBefore.text &&
        cue?.startOffsetMs === rollbackCueBefore.startOffsetMs &&
        cue?.endOffsetMs === rollbackCueBefore.endOffsetMs &&
        cue?.origin === "human"
      );
    },
    "clip trim round-trip 뒤 human cue 보존"
  );
  const rollbackCueAfter = roundTripProject.subtitles.find((cue) => cue.id === cueId);

  const clipLeftDrag = await pointerDrag(
    '.clip-block[data-id="clip-selection-a"] .trim-handle.left',
    [{ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }]
  );
  assert(clipLeftDrag.moves >= 3, `왼쪽 clip drag pointermove가 부족합니다: ${JSON.stringify(clipLeftDrag)}`);
  assert(
    String(clipLeftDrag.trace[0]?.target || "").includes("trim-handle"),
    `왼쪽 clip 손잡이가 pointerdown target이 아닙니다: ${JSON.stringify(clipLeftDrag)}`
  );
  await delay(350);
  const afterClipLeftTrim = await waitForStoredProject(
    (project) => {
      const clip = project.clips.find((candidate) => candidate.id === "clip-selection-a");
      return clip && clip.sourceStartMs >= clip.selectionStartMs + 50;
    },
    "clip 왼쪽 손잡이 drag autosave"
  );
  const leftTrimmedClip = afterClipLeftTrim.clips.find(
    (clip) => clip.id === "clip-selection-a"
  )!;

  const clipRightDrag = await pointerDrag(
    '.clip-block[data-id="clip-selection-a"] .trim-handle.right',
    [{ x: -10, y: 0 }, { x: -10, y: 0 }, { x: -10, y: 0 }]
  );
  assert(clipRightDrag.moves >= 3, `오른쪽 clip drag pointermove가 부족합니다: ${JSON.stringify(clipRightDrag)}`);
  assert(
    String(clipRightDrag.trace[0]?.target || "").includes("trim-handle"),
    `오른쪽 clip 손잡이가 pointerdown target이 아닙니다: ${JSON.stringify(clipRightDrag)}`
  );
  await delay(350);
  let trimmedProject;
  try {
    trimmedProject = await waitForStoredProject(
      (project) => {
        const clip = project.clips.find((candidate) => candidate.id === "clip-selection-a");
        return (
          clip &&
          clip.sourceStartMs === leftTrimmedClip.sourceStartMs &&
          clip.sourceEndMs <= clip.selectionEndMs - 50
        );
      },
      "clip 오른쪽 손잡이 drag autosave"
    );
  } catch (error) {
    const actual = await readStoredProject();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
      `leftTrimmed=${JSON.stringify(leftTrimmedClip)}\n` +
      `actualClip=${JSON.stringify(
        actual?.clips?.find((clip) => clip.id === "clip-selection-a")
      )}\n` +
      `actualCue=${JSON.stringify(
        actual?.subtitles?.find((cue) => cue.id === cueId)
      )}\n` +
      `roundTrip=${JSON.stringify(clipTrimRoundTrip)}\n` +
      `rightDrag=${JSON.stringify(clipRightDrag)}`
    );
  }
  const trimmedClipBeforeHotSeed = trimmedProject.clips.find((clip) => clip.id === "clip-selection-a");
  assert(trimmedClipBeforeHotSeed, "hot seed 전 trim된 clip을 찾지 못했습니다.");

  const hotCaptureState = {
    ...captureState,
    segments: [
      ...captureState.segments,
      {
        id: "selection-c",
        startSeconds: 9.5,
        endSeconds: 11.5,
        description: "hot seed로 추가된 세 번째 사용자 선택",
        startCapture: null,
        endCapture: null,
        createdAt: "2026-07-27T11:00:03.000Z",
        updatedAt: "2026-07-27T11:00:03.000Z"
      }
    ],
    updatedAt: "2026-07-27T11:00:03.000Z"
  };
  const hotSeedDelivery = await broadcastCaptureSeedUpdate(sidepanelUrl, hotCaptureState);
  const hotSeedProject = await waitForStoredProject(
    (project) => {
      const clip = project.clips.find((candidate) => candidate.id === "clip-selection-a");
      const appended = project.clips.find((candidate) => candidate.id === "clip-selection-c");
      return (
        project.clips.map((candidate) => candidate.id).join(",") ===
          "clip-selection-b,clip-selection-a,clip-selection-c" &&
        clip?.sourceStartMs === trimmedClipBeforeHotSeed.sourceStartMs &&
        clip?.sourceEndMs === trimmedClipBeforeHotSeed.sourceEndMs &&
        appended?.sourceStartMs === 9_500 &&
        appended?.sourceEndMs === 11_500 &&
        project.subtitles.some((cue) => cue.id === cueId && cue.text === EDITED_TEXT)
      );
    },
    "hot seed merge와 IndexedDB autosave"
  );

  const hotSeedDom = await waitUntil(async () => {
    const state = await executeSync<{
      clipOrder: string[];
      clipTitles: Array<string | null>;
      clipCount: number;
      cueText: string;
    }>(`
      return {
        clipOrder: [...document.querySelectorAll("#clip-list .clip-item")].map((item) => item.dataset.id),
        clipTitles: [...document.querySelectorAll("#clip-list .clip-title")].map((item) => item.textContent),
        clipCount: document.querySelectorAll("#video-track .clip-block").length,
        cueText: document.querySelector("#cue-text")?.value || ""
      };
    `);
    return (
      state.clipOrder.join(",") === "clip-selection-b,clip-selection-a,clip-selection-c" &&
      state.clipTitles[2] === "hot seed로 추가된 세 번째 사용자 선택" &&
      state.clipCount === 3 &&
      state.cueText === EDITED_TEXT
    ) ? state : false;
  }, "hot seed 반영 editor DOM");

  await clickElement(
    '.clip-item[data-id="clip-selection-b"] .clip-select'
  );
  const clipGroupAnchorBefore = await waitForStoredProject(
    (candidate) => {
      const selected = candidate.clips.find(
        (clip) => clip.id === "clip-selection-b"
      );
      return (
        candidate.selectedClipId === selected?.id
        && candidate.playheadMs === selected?.timelineStartMs
      );
    },
    "묶음 이동 전 현재 컷 재생헤드 앵커"
  );
  await clickElement(
    '.clip-item[data-id="clip-selection-b"] .clip-group-checkbox'
  );
  await clickElement(
    '.clip-item[data-id="clip-selection-a"] .clip-group-checkbox'
  );
  const clipGroupReady = await waitUntil(async () => {
    const state = await executeSync<{
      checked: Array<string | undefined>;
      status: string;
      upDisabled?: boolean;
      downDisabled?: boolean;
    }>(`
      return {
        checked: [...document.querySelectorAll(".clip-group-checkbox:checked")]
          .map((checkbox) => checkbox.closest(".clip-item")?.dataset.id),
        status: document.querySelector("#clip-group-status")?.textContent || "",
        upDisabled: document.querySelector("#move-selected-clips-up")?.disabled,
        downDisabled: document.querySelector("#move-selected-clips-down")?.disabled
      };
    `);
    return (
      state.checked.join(",") === "clip-selection-b,clip-selection-a" &&
      state.status.includes("2개") &&
      state.upDisabled === true &&
      state.downDisabled === false
    ) ? state : false;
  }, "두 컷 체크와 묶음 이동 경계 상태");

  await clickElement("#move-selected-clips-down");
  const clipGroupMovedDown = await waitForStoredProject(
    (candidate) => {
      const anchored = candidate.clips.find(
        (clip) => clip.id === "clip-selection-b"
      );
      return (
        Boolean(anchored)
        &&
        candidate.clips.map((clip) => clip.id).join(",") ===
        "clip-selection-c,clip-selection-b,clip-selection-a"
        && candidate.selectedClipId === anchored?.id
        && candidate.playheadMs === anchored?.timelineStartMs
      );
    },
    "체크한 두 컷의 상대 순서 보존 아래 이동"
  );
  const clipGroupDownDom = await waitUntil(async () => {
    const state = await executeSync<{
      order: Array<string | undefined>;
      checked: Array<string | undefined>;
      selectedId: string | null;
      activeId: string | null;
    }>(`
      return {
        order: [...document.querySelectorAll("#clip-list .clip-item")]
          .map((item) => item.dataset.id),
        checked: [...document.querySelectorAll(".clip-group-checkbox:checked")]
          .map((checkbox) => checkbox.closest(".clip-item")?.dataset.id),
        selectedId: document.querySelector(".clip-item.selected")?.dataset.id || null,
        activeId: document.activeElement?.id || null
      };
    `);
    return (
      state.order.join(",") === "clip-selection-c,clip-selection-b,clip-selection-a" &&
      state.checked.join(",") === "clip-selection-b,clip-selection-a" &&
      state.selectedId === "clip-selection-b" &&
      state.activeId === "move-selected-clips-up"
    ) ? state : false;
  }, "묶음 아래 이동 DOM·체크·focus 보존");

  await clickElement("#move-selected-clips-up");
  const clipGroupRestored = await waitForStoredProject(
    (candidate) => (
      candidate.clips.map((clip) => clip.id).join(",") ===
      "clip-selection-b,clip-selection-a,clip-selection-c"
    ),
    "체크한 두 컷 묶음 위 이동으로 원래 순서 복원"
  );
  await clickElement("#clear-clip-group-selection");
  const clipGroupCleared = await waitUntil(async () => {
    const state = await executeSync<{
      checkedCount: number;
      status: string;
      clearDisabled?: boolean;
    }>(`
      return {
        checkedCount: document.querySelectorAll(".clip-group-checkbox:checked").length,
        status: document.querySelector("#clip-group-status")?.textContent || "",
        clearDisabled: document.querySelector("#clear-clip-group-selection")?.disabled
      };
    `);
    return (
      state.checkedCount === 0 &&
      state.status.includes("해제") &&
      state.clearDisabled === true
    ) ? state : false;
  }, "컷 묶음 선택 전체 해제");
  assert(
    !Object.hasOwn(clipGroupMovedDown, "clipGroupSelection") &&
    !Object.hasOwn(clipGroupRestored, "clipGroupSelection"),
    "컷 체크 UI 상태가 프로젝트에 저장되었습니다."
  );
  const clipGroupMoveSmoke = {
    anchorBefore: {
      selectedClipId: clipGroupAnchorBefore.selectedClipId,
      playheadMs: clipGroupAnchorBefore.playheadMs
    },
    ready: clipGroupReady,
    movedDownOrder: clipGroupMovedDown.clips.map((clip) => clip.id),
    downDom: clipGroupDownDom,
    restoredOrder: clipGroupRestored.clips.map((clip) => clip.id),
    cleared: clipGroupCleared
  };

  await clickElement("#create-local-draft");
  const manualLocalDraft = await waitUntil(async () => {
    const drafts = await readLocalDrafts();
    const [draft] = drafts;
    return (
      drafts.length === 1 &&
      draft?.reason === "manual" &&
      draft.project?.imageAssets?.some(
        (asset) => asset.id === imageAssetId
      )
    ) ? draft : false;
  }, "수동 로컬 임시저장");
  const manualDraftStatus = await executeSync<string>(`
    return document.querySelector("#local-draft-status")
      ?.textContent?.trim() || "";
  `);
  assert(
    !manualDraftStatus.includes("마지막 자동"),
    `자동저장 전 상태가 자동저장 완료로 표시됩니다: ${manualDraftStatus}`
  );

  const beforeRestoreProjectName = "복원 직전 E2E 상태";
  await clearAndType("#project-name", beforeRestoreProjectName);
  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  await clickElement("#delete-asset");
  const beforeRestoreProject = await waitForStoredProject(
    (candidate) => (
      candidate.name === beforeRestoreProjectName &&
      !candidate.imageAssets?.some((asset) => asset.id === imageAssetId)
    ),
    "임시저장 뒤 현재 프로젝트 변경"
  );

  await delay(3_500);
  const snapshotProtectedAssetKeys = await readImageAssetBlobKeys();
  assert(
    snapshotProtectedAssetKeys.includes(imageAssetId),
    `임시저장만 참조하는 이미지 Blob이 조기 삭제됐습니다: ${JSON.stringify(
      snapshotProtectedAssetKeys
    )}`
  );

  await executeSync(`
    const originalNow = Date.now;
    const advancedNow = originalNow() + 5 * 60 * 1000 + 1;
    Date.now = () => advancedNow;
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", {
        persisted: false
      }));
    } finally {
      Date.now = originalNow;
    }
  `);
  const autoLocalDrafts = await waitUntil(async () => {
    const drafts = await readLocalDrafts();
    return (
      drafts.length === 2 &&
      drafts.some((draft) => (
        draft.reason === "auto" &&
        draft.project?.name === beforeRestoreProjectName &&
        !draft.project?.imageAssets?.some(
          (asset) => asset.id === imageAssetId
        )
      ))
    ) ? drafts : false;
  }, "5분 경과 visibility 복귀 자동 임시저장");
  await delay(350);
  const stableAutomaticDrafts = await readLocalDrafts();
  assert(
    stableAutomaticDrafts.length === 2 &&
      stableAutomaticDrafts.filter((draft) => draft.reason === "auto").length === 1,
    `동시 lifecycle 이벤트가 자동 임시저장을 중복 생성했습니다: ${JSON.stringify(
      stableAutomaticDrafts.map((draft) => draft.reason)
    )}`
  );

  await clickElement("#open-local-drafts");
  const localDraftDialogOpened = await waitUntil(async () => {
    const state = await executeSync(`
      const dialog = document.querySelector("#local-draft-dialog");
      return {
        hidden: dialog?.hidden,
        open: dialog?.open,
        options: document.querySelectorAll(
          '#local-draft-list input[name="local-draft-choice"]'
        ).length,
        activeInside: Boolean(dialog?.contains(document.activeElement)),
        restoreDisabled: document.querySelector(
          "#restore-local-draft"
        )?.disabled
      };
    `);
    return (
      state.hidden === false &&
      state.open === true &&
      state.options === 2 &&
      state.activeInside &&
      state.restoreDisabled
    ) ? state : false;
  }, "최근 로컬 임시저장 dialog");

  await pressKey(KEY.ESCAPE);
  let localDraftDialogEscaped;
  try {
    localDraftDialogEscaped = await waitUntil(async () => {
      const state = await executeSync(`
        const dialog = document.querySelector("#local-draft-dialog");
        return {
          hidden: dialog?.hidden,
          open: dialog?.open,
          activeId: document.activeElement?.id || null
        };
      `);
      return (
        state.hidden === true &&
        state.open === false &&
        state.activeId === "open-local-drafts"
      ) ? state : false;
    }, "로컬 임시저장 dialog Escape와 focus 복원");
  } catch (error) {
    const actual = await executeSync(`
      const dialog = document.querySelector("#local-draft-dialog");
      return {
        hidden: dialog?.hidden,
        open: dialog?.open,
        activeId: document.activeElement?.id || null,
        activeTag: document.activeElement?.tagName || null,
        openerDisabled: document.querySelector("#open-local-drafts")?.disabled,
        restoreDisabled: document.querySelector("#restore-local-draft")?.disabled
      };
    `);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(actual)}`
    );
  }

  await clickElement("#open-local-drafts");
  await waitUntil(
    () => executeSync(
      `return document.querySelector("#local-draft-dialog")?.open === true;`
    ),
    "로컬 임시저장 dialog 재개방"
  );
  await clickElement(
    `#local-draft-list input[value="${manualLocalDraft.id}"]`
  );
  await waitUntil(
    () => executeSync(
      `return document.querySelector("#restore-local-draft")?.disabled === false;`
    ),
    "임시저장 복원 선택"
  );
  await clickElement("#restore-local-draft");

  const restoredFromLocalDraft = await waitForStoredProject(
    (candidate) => (
      candidate.name === manualLocalDraft.project.name &&
      candidate.imageAssets?.some((asset) => asset.id === imageAssetId)
    ),
    "복원 직전 저장 뒤 선택 임시저장 복원"
  );
  const draftsAfterRestore = await waitUntil(async () => {
    const drafts = await readLocalDrafts();
    const preRestore = drafts.find(
      (draft) => draft.reason === "pre-restore"
    );
    return (
      drafts.length === 3 &&
      preRestore?.restoredFromDraftId === manualLocalDraft.id &&
      preRestore?.project?.name === beforeRestoreProjectName &&
      !preRestore?.project?.imageAssets?.some(
        (asset) => asset.id === imageAssetId
      )
    ) ? drafts : false;
  }, "불러오기 직전 현재 상태 자동 임시저장");
  const localDraftRestoreUi = await waitUntil(async () => {
    const state = await executeSync<{
      hidden?: boolean;
      open?: boolean;
      activeId: string | null;
      assetCount: number;
      projectName: string;
      draftStatus: string;
    }>(`
      const dialog = document.querySelector("#local-draft-dialog");
      return {
        hidden: dialog?.hidden,
        open: dialog?.open,
        activeId: document.activeElement?.id || null,
        assetCount: document.querySelectorAll(
          "#asset-track .asset-block"
        ).length,
        projectName: document.querySelector("#project-name")?.value || "",
        draftStatus: document.querySelector(
          "#local-draft-status"
        )?.textContent?.trim() || ""
      };
    `);
    return (
      state.hidden === true &&
      state.open === false &&
      state.activeId === "open-local-drafts" &&
      state.assetCount === 1 &&
      state.projectName === manualLocalDraft.project.name &&
      state.draftStatus.includes("최근 3/5개")
    ) ? state : false;
  }, "임시저장 복원 DOM과 focus");
  await clickElement(`.asset-block[data-id="${imageAssetId}"] .asset-block-body`);
  const restoredDraftImage = await waitUntil(async () => {
    const state = await executeSync(`
      const overlay = document.querySelector(
        '#image-asset-overlays .image-asset-overlay[data-asset-id="${imageAssetId}"]'
      );
      const image = overlay?.querySelector("img");
      const thumbnail = document.querySelector("#asset-thumbnail");
      return {
        overlayVisible: Boolean(overlay && !overlay.hidden),
        overlayLoaded: Boolean(image?.complete && image.naturalWidth > 0),
        thumbnailLoaded: Boolean(
          thumbnail?.complete && thumbnail.naturalWidth > 0
        )
      };
    `);
    return (
      state.overlayVisible &&
      state.overlayLoaded &&
      state.thumbnailLoaded
    ) ? state : false;
  }, "임시저장 이미지 Blob 재연결");
  const localDraftSmoke = {
    manual: {
      id: manualLocalDraft.id,
      reason: manualLocalDraft.reason,
      projectName: manualLocalDraft.project.name
    },
    autoReasons: autoLocalDrafts.map((draft) => draft.reason),
    protectedAssetKeys: snapshotProtectedAssetKeys,
    dialogOpened: localDraftDialogOpened,
    dialogEscaped: localDraftDialogEscaped,
    restoredProjectName: restoredFromLocalDraft.name,
    draftsAfterRestore: draftsAfterRestore.map((draft) => ({
      id: draft.id,
      reason: draft.reason,
      restoredFromDraftId: draft.restoredFromDraftId,
      projectName: draft.project?.name
    })),
    restoreUi: localDraftRestoreUi,
    restoredImage: restoredDraftImage,
    beforeRestoreProject: {
      name: beforeRestoreProject.name,
      imageAssets: beforeRestoreProject.imageAssets?.length || 0
    }
  };

  const finalPersistedCue = hotSeedProject.subtitles.find((cue) => cue.id === cueId);
  assert(finalPersistedCue, "hot seed 저장본에서 자막을 찾지 못했습니다.");
  const finalPersistedAsset = hotSeedProject.imageAssets?.find((asset) => asset.id === imageAssetId);
  assert(finalPersistedAsset, "hot seed 저장본에서 이미지 에셋을 찾지 못했습니다.");

  await clickElement(`.cue-block[data-id="${cueId}"] .cue-block-body`);
  await waitUntil(async () => {
    const visible = await executeSync(`
      const element = document.querySelector("#subtitle-overlays .subtitle-overlay");
      return Boolean(element && !element.hidden && element.dataset.cueId === arguments[0]);
    `, [cueId]);
    return visible;
  }, "reorder 후 자막 overlay 복원");

  const screenshot = await webdriver<string>("GET", `/session/${sessionId}/screenshot`);
  await writeFile(screenshotPath, Buffer.from(screenshot, "base64"));
  await access(screenshotPath);

  const expected = {
    clipOrder: hotSeedProject.clips.map((clip) => clip.id),
    trimmedClip: {
      sourceStartMs: trimmedClipBeforeHotSeed.sourceStartMs,
      sourceEndMs: trimmedClipBeforeHotSeed.sourceEndMs
    },
    text: finalPersistedCue.text,
    startOffsetMs: finalPersistedCue.startOffsetMs,
    endOffsetMs: finalPersistedCue.endOffsetMs,
    x: finalPersistedCue.x,
    y: finalPersistedCue.y,
    color: finalPersistedCue.color,
    asset: finalPersistedAsset,
    mediaName: reorderedProject.mediaAsset?.name
  };

  await delay(400);
  await webdriver("POST", `/session/${sessionId}/url`, { url: editorUrl });
  let restored: ExternalProject;
  try {
    restored = await waitForStoredProject((project) => {
      const cue = project.subtitles.find((candidate) => candidate.id === cueId);
      const asset = project.imageAssets?.find((candidate) => candidate.id === imageAssetId);
      if (!cue || !asset) {
        return false;
      }
      return (
        project.clips.map((clip) => clip.id).join(",") === expected.clipOrder.join(",") &&
        project.clips.find((clip) => clip.id === "clip-selection-a")?.sourceStartMs ===
          expected.trimmedClip.sourceStartMs &&
        project.clips.find((clip) => clip.id === "clip-selection-a")?.sourceEndMs ===
          expected.trimmedClip.sourceEndMs &&
        cue?.text === expected.text &&
        cue?.startOffsetMs === expected.startOffsetMs &&
        cue?.endOffsetMs === expected.endOffsetMs &&
        Math.abs(cue.x - expected.x) < 0.0001 &&
        Math.abs(cue.y - expected.y) < 0.0001 &&
        cue?.color === expected.color &&
        asset?.startOffsetMs === expected.asset.startOffsetMs &&
        asset?.endOffsetMs === expected.asset.endOffsetMs &&
        Math.abs(asset.x - expected.asset.x) < 0.0001 &&
        Math.abs(asset.y - expected.asset.y) < 0.0001 &&
        Math.abs(asset.scale - expected.asset.scale) < 0.0001 &&
        Math.abs(asset.opacity - expected.asset.opacity) < 0.0001 &&
        asset?.source?.kind === "blob-key" &&
        project.mediaAsset?.name === expected.mediaName
      );
    }, "reload 후 IndexedDB 프로젝트 복원");
  } catch (error) {
    const actual = await readStoredProject();
    const actualCue = actual?.subtitles?.find((candidate) => candidate.id === cueId);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n`
      + `expected=${JSON.stringify(expected)}\n` +
      `actual=${JSON.stringify({
        clipOrder: actual?.clips?.map((clip) => clip.id),
        cue: actualCue,
        mediaName: actual?.mediaAsset?.name
      })}`
    );
  }
  const restoredCue = restored.subtitles.find((cue) => cue.id === cueId)!;

  const restoredDom = await waitUntil(async () => {
    const state = await executeSync<{
      clipOrder: Array<string | undefined>;
      cueText: string;
      cueCount: number;
      assetCount: number;
      mediaName: string;
    }>(`
      return {
        clipOrder: [...document.querySelectorAll("#clip-list .clip-item")].map((item) => item.dataset.id),
        cueText: document.querySelector("#cue-text")?.value || "",
        cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
        assetCount: document.querySelectorAll("#asset-track .asset-block").length,
        mediaName: document.querySelector("#media-name")?.textContent || ""
      };
    `);
    return (
      state.clipOrder.join(",") === expected.clipOrder.join(",") &&
      state.cueText === expected.text &&
      state.cueCount === 1 &&
      state.assetCount === 1 &&
      state.mediaName === expected.mediaName
    ) ? state : false;
  }, "reload 후 editor DOM 복원");
  let prunedImageAssetBlobKeys: string[];
  try {
    prunedImageAssetBlobKeys = await waitUntil(async () => {
      const keys = await readImageAssetBlobKeys();
      return keys.length === 1 && keys[0] === imageAssetId ? keys : false;
    }, "reload 뒤 실행 취소 이력에서 사라진 이미지 Blob 정리", {
      timeout: 12_000,
      interval: 250
    });
  } catch (error) {
    const actualKeys = await readImageAssetBlobKeys();
    const tabUrls = await executeAsync(`
      const done = arguments[arguments.length - 1];
      chrome.tabs.query({}, (tabs) => done(tabs.map((tab) => tab.url || "")));
    `);
    const logs = await webdriver("POST", `/session/${sessionId}/log`, { type: "browser" });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n`
      + `actualKeys=${JSON.stringify(actualKeys)}\n` +
      `tabUrls=${JSON.stringify(tabUrls)}\nlogs=${JSON.stringify(logs)}`
    );
  }

  let primaryEditorHandle = await webdriver<string>("GET", `/session/${sessionId}/window`);
  const recoveryPanelHandle = await openWindow(sidepanelUrl, "window");
  const recoveryPanelState = await waitUntil(async () => {
    const state = await executeSync<{
      projectId: string;
      title: string;
      time: string;
      counts: string;
      drafts: string;
      continueDisabled?: boolean;
      draftsDisabled?: boolean;
    } | null>(`
      const item = [...document.querySelectorAll(".recovery-session")]
        .find((candidate) => candidate.dataset.projectId === arguments[0]);
      if (!item) {
        return null;
      }
      return {
        projectId: item.dataset.projectId,
        title: item.querySelector(".recovery-session-title")?.textContent || "",
        time: item.querySelector(".recovery-session-time")?.textContent || "",
        counts: item.querySelector(".recovery-session-counts")?.textContent || "",
        drafts: item.querySelector(".recovery-session-drafts")?.textContent || "",
        continueDisabled: item.querySelector('[data-recovery-action="continue"]')?.disabled,
        draftsDisabled: item.querySelector('[data-recovery-action="drafts"]')?.disabled
      };
    `, [PROJECT_ID]);
    return (
      state?.projectId === PROJECT_ID &&
      state.title &&
      state.time.includes("최근 편집") &&
      state.counts.includes(`컷 ${restored.clips.length}`) &&
      state.counts.includes(`자막 ${restored.subtitles.length}`) &&
      state.counts.includes(`에셋 ${restored.imageAssets.length}`) &&
      state.drafts.includes("복구본") &&
      state.continueDisabled === false &&
      state.draftsDisabled === false
    ) ? state : false;
  }, "sidepanel 저장 세션 semantic 목록");

  await executeSync(`
    const item = [...document.querySelectorAll(".recovery-session")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    item?.querySelector('[data-recovery-action="drafts"]')?.click();
  `, [PROJECT_ID]);
  await switchToWindow(primaryEditorHandle);
  const recoveryDialogOpened = await waitUntil(async () => {
    return executeSync(`
      const dialog = document.querySelector("#local-draft-dialog");
      return dialog?.open === true &&
        document.querySelectorAll(
          '#local-draft-list input[name="local-draft-choice"]'
        ).length > 0;
    `);
  }, "기존 projectId 편집기의 복구본 목록 자동 열기");
  await clickElement("#close-local-draft-dialog");

  await switchToWindow(recoveryPanelHandle);
  await executeSync(`
    const item = [...document.querySelectorAll(".recovery-session")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    item?.querySelector('[data-recovery-action="continue"]')?.click();
  `, [PROJECT_ID]);
  await delay(350);
  const recoveryEditorTabs = await executeAsync<Array<{
    id: number;
    url: string;
  }>>(`
    const editorRoot = arguments[0];
    const projectId = arguments[1];
    const done = arguments[arguments.length - 1];
    chrome.tabs.query({}, (tabs) => done(tabs.filter((tab) => {
      try {
        const url = new URL(tab.url || "");
        return url.origin + url.pathname === editorRoot &&
          url.searchParams.get("project") === projectId;
      } catch {
        return false;
      }
    }).map((tab) => ({ id: tab.id, url: tab.url }))));
  `, [`chrome-extension://${extensionId}/editor.html`, PROJECT_ID]);
  assert(
    recoveryEditorTabs.length === 1,
    `계속 편집이 같은 projectId 탭을 중복 생성했습니다: ${JSON.stringify(
      recoveryEditorTabs
    )}`
  );
  await waitUntil(async () => executeSync<boolean>(`
    const item = [...document.querySelectorAll(".recovery-session")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    return item?.querySelector('[data-recovery-action="continue"]')?.disabled === false;
  `, [PROJECT_ID]), "기존 탭 포커스 뒤 계속 편집 버튼 복구");

  await switchToWindow(primaryEditorHandle);
  const immediateCloseProjectName = "Editor Interaction E2E · 즉시 종료 직전";
  const immediateCloseCueText = "즉시 종료 직전 마지막 자막 수정";
  const immediateCloseMutation = await executeSync<{
    ok: boolean;
    projectName?: string;
    cueText?: string;
  }>(`
    const projectName = document.querySelector("#project-name");
    const cueText = document.querySelector("#cue-text");
    if (!projectName || !cueText || cueText.disabled) {
      return { ok: false };
    }
    projectName.value = arguments[0];
    projectName.dispatchEvent(new Event("input", { bubbles: true }));
    cueText.value = arguments[1];
    cueText.dispatchEvent(new Event("input", { bubbles: true }));
    return {
      ok: true,
      projectName: projectName.value,
      cueText: cueText.value
    };
  `, [immediateCloseProjectName, immediateCloseCueText]);
  assert(
    immediateCloseMutation.ok,
    `즉시 종료 직전 편집 변경을 만들지 못했습니다: ${JSON.stringify(
      immediateCloseMutation
    )}`
  );
  // Deliberately do not wait for the former 180ms debounce window.
  await webdriver("DELETE", `/session/${sessionId}/window`);
  await switchToWindow(recoveryPanelHandle);
  await waitUntil(async () => executeAsync<boolean>(`
    const editorRoot = arguments[0];
    const projectId = arguments[1];
    const done = arguments[arguments.length - 1];
    chrome.tabs.query({}, (tabs) => done(!tabs.some((tab) => {
      try {
        const url = new URL(tab.url || "");
        return url.origin + url.pathname === editorRoot &&
          url.searchParams.get("project") === projectId;
      } catch {
        return false;
      }
    })));
  `, [`chrome-extension://${extensionId}/editor.html`, PROJECT_ID]),
  "닫은 editor 탭의 service-worker 목록 제거");
  const closedEditorOpenClick = await executeSync<{
    clicked: boolean;
    exists: boolean;
    disabled: boolean | null;
  }>(`
    const item = [...document.querySelectorAll(".recovery-session")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    const button = item?.querySelector('[data-recovery-action="continue"]');
    const status = document.querySelector("#status-bar");
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    if (!button || button.disabled) {
      return {
        clicked: false,
        exists: Boolean(button),
        disabled: button?.disabled ?? null
      };
    }
    button.click();
    return { clicked: true, exists: true, disabled: false };
  `, [PROJECT_ID]);
  assert(
    closedEditorOpenClick.clicked,
    `닫힌 편집기의 계속 편집 버튼을 누르지 못했습니다: ${JSON.stringify(
      closedEditorOpenClick
    )}`
  );
  await waitUntil(async () => executeSync<boolean>(`
    const item = [...document.querySelectorAll(".recovery-session")]
      .find((candidate) => candidate.dataset.projectId === arguments[0]);
    const status = document.querySelector("#status-bar")?.textContent || "";
    return !item?.classList.contains("is-opening") &&
      status.includes("마지막 저장 상태로 편집기를 열었습니다.");
  `, [PROJECT_ID]), "닫힌 편집기의 계속 편집 요청 완료");
  type RecoveryTab = {
    id: number;
    url: string;
    status?: string;
  };
  type ReopenedEditorState = {
    ready: boolean;
    projectName: string;
    clipCount: number;
    cueCount: number;
    assetCount: number;
    cueText: string;
    sessionTokenType: string;
    sessionTokenValue: string;
  };
  type WorkspaceMetaState = {
    resetEpoch: string;
    revision: number;
    writerId: string;
  };
  interface WorkspaceProjectState extends ExternalRecord {
    editorProjectId: string;
    projectName: string;
    globalInstruction: string;
    segments: unknown[];
  }
  type WorkspaceSnapshotSuccess = {
    state: WorkspaceProjectState;
    workspaceMeta: WorkspaceMetaState;
  };
  type WorkspaceSnapshotResult =
    | {
        state: WorkspaceProjectState | null;
        workspaceMeta: WorkspaceMetaState | null;
      }
    | { error: string };
  const isWorkspaceSnapshotSuccess = (
    value: WorkspaceSnapshotResult
  ): value is WorkspaceSnapshotSuccess =>
    !("error" in value) &&
    value.state !== null &&
    value.workspaceMeta !== null;
  type ResetFixtureResult = {
    ok: true;
    cacheText: string;
    databaseFixture: {
      projectCount: number;
      handleCount: number;
      handleValue?: {
        name?: string;
      };
    };
  } | {
    error: string;
  };
  type EditorWindowState = {
    title: string;
    clipCount: number;
  };
  type ResetPanelFixtureState = {
    ready: boolean;
    projectName: string;
    segmentCount: number;
  };
  type DirtyGateSetupState = {
    wrapped: boolean;
    projectName: string;
  };
  type DirtyGateCapturedState = {
    captured: ExternalRecord | null;
    released: boolean;
  };
  type DirtyInputState = {
    projectName: string;
    globalInstruction: string;
    status: string;
  };
  type WorkspacePersistResponse = {
    ok: boolean;
    workspaceMeta: WorkspaceMetaState;
  };
  type DirtyGateReleaseResult = {
    response: WorkspacePersistResponse;
  } | {
    error: string;
  };
  type ResetProbeState = {
    sendMessageWrapped: boolean;
    resetButtonVisible: boolean;
  };
  type WorkspaceResetResponse = {
    ok: boolean;
    cleanupErrors: string[];
  };
  type ResetUiState = {
    inert: boolean;
    projectName: string;
    segmentCount: number;
    statusHidden: boolean;
    status: string;
    resetDisabled: boolean;
    resetResponse: WorkspaceResetResponse | null;
  };
  type SidepanelResetState = {
    projectName: string;
    segmentCount: number;
    status: string;
  };
  type StaleCasResponse = {
    ok: boolean;
    workspaceMeta: WorkspaceMetaState;
  };
  type StaleCasResult = {
    persist: StaleCasResponse;
    open: StaleCasResponse;
    before: WorkspaceMetaState;
    after: WorkspaceMetaState;
  } | {
    error: string;
  };
  type ResetAuditResult = {
    state: WorkspaceProjectState;
    workspaceMeta: WorkspaceMetaState;
    seedKeys: string[];
    bindings: ExternalRecord;
    databaseNames: Array<string | undefined>;
    cacheNames: string[];
    cacheText: string | null;
    editorTabs: Array<{
      id?: number;
      url?: string;
      windowId: number;
    }>;
    panelDom: {
      projectName: string;
      segmentCount: number;
    };
  } | {
    error: string;
  };
  interface BrowserLogEntry extends ExternalRecord {
    level: string;
  }

  const reopenedTab = await waitUntil(async () => {
    const tab = await executeAsync<RecoveryTab | null>(`
      const editorRoot = arguments[0];
      const projectId = arguments[1];
      const done = arguments[arguments.length - 1];
      chrome.tabs.query({}, (tabs) => {
        const match = tabs.find((tab) => {
          try {
            const url = new URL(tab.url || "");
            return url.origin + url.pathname === editorRoot &&
              url.searchParams.get("project") === projectId &&
              url.searchParams.get("session") === "resume";
          } catch {
            return false;
          }
        });
        done(match ? {
          id: match.id,
          url: match.url,
          status: match.status
        } : null);
      });
    `, [`chrome-extension://${extensionId}/editor.html`, PROJECT_ID]);
    return tab ?? false;
  }, "닫힌 편집기의 resume 탭 생성");
  await executeAsync<{ error: string | null }>(`
    const tabId = arguments[0];
    const done = arguments[arguments.length - 1];
    chrome.tabs.remove(tabId, () => done({
      error: chrome.runtime.lastError?.message || null
    }));
  `, [reopenedTab.id]);
  const reopenedEditorHandle = await openWindow(reopenedTab.url, "window");
  const reopenedEditorState = await waitUntil(async () => {
    const state = await executeSync<ReopenedEditorState>(`
      return {
        ready: document.readyState === "complete",
        projectName: document.querySelector("#project-name")?.value || "",
        clipCount: document.querySelectorAll("#clip-list .clip-item").length,
        cueCount: document.querySelectorAll("#caption-tracks .cue-block").length,
        assetCount: document.querySelectorAll("#asset-track .asset-block").length,
        cueText: document.querySelector("#cue-text")?.value || "",
        sessionTokenType: document.querySelector("#caption-agent-token")?.type || "",
        sessionTokenValue: document.querySelector("#caption-agent-token")?.value || ""
      };
    `);
    return (
      state.ready &&
      state.projectName === immediateCloseProjectName &&
      state.clipCount === restored.clips.length &&
      state.cueCount === restored.subtitles.length &&
      state.assetCount === restored.imageAssets.length &&
      state.cueText === immediateCloseCueText &&
      state.sessionTokenType === "hidden" &&
      state.sessionTokenValue === ""
    ) ? state : false;
  }, "resume URL의 현재본 복원과 로컬 세션 토큰 비저장");
  primaryEditorHandle = reopenedEditorHandle;
  const reopenedEditor = {
    tab: reopenedTab,
    state: reopenedEditorState
  };

  await switchToWindow(recoveryPanelHandle);
  await webdriver("DELETE", `/session/${sessionId}/window`);
  await switchToWindow(primaryEditorHandle);
  const recoveryHubSmoke = {
    panel: recoveryPanelState,
    recoveryDialogOpened,
    editorTabs: recoveryEditorTabs,
    reopenedEditor,
    immediateCloseMutation
  };

  const staleWorkspaceState = {
    ...hotCaptureState,
    editorProjectId: PROJECT_ID,
    projectName: "Editor Interaction E2E"
  };
  const staleWorkspaceMetaSeed = {
    resetEpoch: "e2e-before-reset",
    revision: 40,
    writerId: "e2e-reset-fixture"
  };
  const modelCacheSentinelUrl =
    "https://legacy-model-cache.invalid/chzzk-kirinuki-e2e/sentinel";
  const resetFixture = await executeAsync<ResetFixtureResult>(`
    const [
      storageKey,
      workspaceMetaKey,
      bindingsKey,
      seedPrefix,
      projectId,
      workspaceState,
      workspaceMeta,
      cacheName,
      cacheUrl,
      cacheText,
      databaseName
    ] = arguments;
    const done = arguments[arguments.length - 1];
    void (async () => {
      await chrome.storage.local.set({
        [storageKey]: workspaceState,
        [workspaceMetaKey]: workspaceMeta,
        [seedPrefix + projectId]: {
          projectId,
          captureState: workspaceState,
          updatedAt: new Date().toISOString()
        },
        [seedPrefix + "e2e-extra-seed"]: {
          projectId: "e2e-extra-seed",
          captureState: workspaceState,
          updatedAt: new Date().toISOString()
        }
      });
      await chrome.storage.session.set({
        [bindingsKey]: {
          [projectId]: {
            projectId,
            sourceTabId: 999999,
            sourceIdentity: workspaceState.source,
            sourceSessionId: "e2e-stale-binding"
          }
        }
      });
      const cache = await caches.open(cacheName);
      await cache.put(cacheUrl, new Response(cacheText));
      const databaseFixture = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(
          request.error || new Error("reset fixture IndexedDB open failed")
        );
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["projects", "media-handles"],
            "readwrite"
          );
          const projects = transaction.objectStore("projects");
          const handles = transaction.objectStore("media-handles");
          const handleKey = "e2e-reset-media-handle";
          handles.put({
            kind: "file",
            name: "e2e-reset-media-handle-sentinel"
          }, handleKey);
          const projectCount = projects.count();
          const handleCount = handles.count();
          const handleValue = handles.get(handleKey);
          transaction.oncomplete = () => {
            database.close();
            resolve({
              projectCount: projectCount.result,
              handleCount: handleCount.result,
              handleValue: handleValue.result
            });
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error || new Error("reset fixture IndexedDB transaction failed"));
          };
          transaction.onabort = transaction.onerror;
        };
      });
      done({
        ok: true,
        cacheText: await (await cache.match(cacheUrl)).text(),
        databaseFixture
      });
    })().catch((error) => done({
      error: error instanceof Error ? error.stack || error.message : String(error)
    }));
  `, [
    STORAGE_KEY,
    WORKSPACE_META_KEY,
    BINDINGS_KEY,
    SEED_PREFIX,
    PROJECT_ID,
    staleWorkspaceState,
    staleWorkspaceMetaSeed,
    LEGACY_MODEL_CACHE_NAME,
    modelCacheSentinelUrl,
    LEGACY_MODEL_CACHE_SENTINEL_TEXT,
    DATABASE_NAME
  ]);
  assert(
    !("error" in resetFixture) &&
      resetFixture.ok &&
      resetFixture.cacheText === LEGACY_MODEL_CACHE_SENTINEL_TEXT &&
      resetFixture.databaseFixture?.projectCount >= 1 &&
      resetFixture.databaseFixture?.handleCount >= 1 &&
      resetFixture.databaseFixture?.handleValue?.name ===
        "e2e-reset-media-handle-sentinel",
    `reset fixture/cache sentinel 생성 실패: ${JSON.stringify(resetFixture)}`
  );

  const secondEditorHandle = await openWindow(editorUrl, "window");
  await waitUntil(async () => {
    const state = await executeSync<EditorWindowState>(`
      return {
        title: document.querySelector("#project-name")?.value || "",
        clipCount: document.querySelectorAll("#clip-list .clip-item").length
      };
    `);
    return state.title === "Editor Interaction E2E" && state.clipCount === 3
      ? state
      : false;
  }, "reset 전 두 번째 editor window 복원");

  const sidepanelAHandle = await openWindow(sidepanelUrl, "window");
  const waitForResetPanelFixture = (label: string) => waitUntil(async () => {
    const state = await executeSync<ResetPanelFixtureState>(`
      return {
        ready: document.readyState === "complete",
        projectName: document.querySelector("#project-name")?.value || "",
        segmentCount: document.querySelectorAll("#segments-list .segment-item").length
      };
    `);
    return state.ready &&
      state.projectName === "Editor Interaction E2E" &&
      state.segmentCount === 3 ? state : false;
  }, label);
  const sidepanelAFixture = await waitForResetPanelFixture("reset sidepanel A 초기화");

  const sidepanelBHandle = await openWindow(sidepanelUrl, "window");
  const sidepanelBFixture = await waitForResetPanelFixture("reset sidepanel B 초기화");

  await switchToWindow(sidepanelAHandle);
  const dirtyGateSetup = await executeSync<DirtyGateSetupState>(`
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    const gate = {
      captured: null,
      released: false,
      response: null,
      release: null
    };
    const wrappedSendMessage = (message, ...args) => {
      if (message?.type !== "KIRINUKI_PERSIST_STATE" || gate.captured) {
        return originalSendMessage(message, ...args);
      }
      gate.captured = structuredClone(message);
      return new Promise((resolve, reject) => {
        gate.release = async () => {
          if (gate.released) {
            return gate.response;
          }
          gate.released = true;
          try {
            gate.response = await originalSendMessage(message, ...args);
            resolve(gate.response);
            return gate.response;
          } catch (error) {
            reject(error);
            throw error;
          }
        };
      });
    };
    chrome.runtime.sendMessage = wrappedSendMessage;
    globalThis.__kirinukiE2eDirtyGate = gate;
    const input = document.querySelector("#project-name");
    input.value = "A DIRTY INPUT PRESERVED";
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: "A DIRTY INPUT PRESERVED"
    }));
    return {
      wrapped: chrome.runtime.sendMessage === wrappedSendMessage,
      projectName: input.value
    };
  `);
  assert(
    dirtyGateSetup.wrapped &&
      dirtyGateSetup.projectName === "A DIRTY INPUT PRESERVED",
    `sidepanel A dirty persist gate 설치 실패: ${JSON.stringify(dirtyGateSetup)}`
  );
  const dirtyGateCaptured = await waitUntil(async () => {
    const gate = await executeSync<DirtyGateCapturedState>(`
      const gate = globalThis.__kirinukiE2eDirtyGate;
      return {
        captured: gate?.captured || null,
        released: gate?.released || false
      };
    `);
    return gate.captured && !gate.released ? gate : false;
  }, "sidepanel A dirty PERSIST 보류");

  await switchToWindow(sidepanelBHandle);
  await executeSync(`
    const input = document.querySelector("#global-instruction");
    input.value = "B REMOTE REVISION";
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: "B REMOTE REVISION"
    }));
  `);
  const dirtyRemotePersisted = await waitUntil(async () => {
    const snapshot = await executeAsync<WorkspaceSnapshotResult>(`
      const storageKey = arguments[0];
      const workspaceMetaKey = arguments[1];
      const done = arguments[arguments.length - 1];
      chrome.storage.local.get([storageKey, workspaceMetaKey], (stored) => {
        const error = chrome.runtime.lastError?.message || null;
        done(error ? { error } : {
          state: stored[storageKey] || null,
          workspaceMeta: stored[workspaceMetaKey] || null
        });
      });
    `, [STORAGE_KEY, WORKSPACE_META_KEY]);
    return (
      isWorkspaceSnapshotSuccess(snapshot) &&
      snapshot.state.globalInstruction === "B REMOTE REVISION" &&
      snapshot.workspaceMeta.revision > staleWorkspaceMetaSeed.revision
    ) ? snapshot : false;
  }, "sidepanel B remote revision 저장");

  await switchToWindow(sidepanelAHandle);
  const dirtyInputPreserved = await waitUntil(async () => {
    const state = await executeSync<DirtyInputState>(`
      return {
        projectName: document.querySelector("#project-name")?.value || "",
        globalInstruction: document.querySelector("#global-instruction")?.value || "",
        status: document.querySelector("#status-bar")?.textContent || ""
      };
    `);
    return (
      state.projectName === "A DIRTY INPUT PRESERVED" &&
      state.globalInstruction === "B REMOTE REVISION" &&
      state.status.includes("현재 입력은 보존")
    ) ? state : false;
  }, "sidepanel A dirty input + B revision 병합");
  const dirtyGateRelease = await executeAsync<DirtyGateReleaseResult>(`
    const done = arguments[arguments.length - 1];
    const gate = globalThis.__kirinukiE2eDirtyGate;
    if (!gate?.release) {
      done({ error: "dirty persist gate release가 없습니다." });
      return;
    }
    void gate.release()
      .then((response) => done({ response }))
      .catch((error) => done({
        error: error instanceof Error ? error.stack || error.message : String(error)
      }));
  `);
  assert(
    !("error" in dirtyGateRelease) &&
      dirtyGateRelease.response?.ok === false &&
      dirtyGateRelease.response?.workspaceMeta?.revision ===
        dirtyRemotePersisted.workspaceMeta.revision,
    `sidepanel A stale dirty PERSIST가 CAS 충돌로 끝나지 않았습니다: ${JSON.stringify(
      dirtyGateRelease
    )}`
  );
  const dirtyMergedPersisted = await waitUntil(async () => {
    const snapshot = await executeAsync<WorkspaceSnapshotResult>(`
      const storageKey = arguments[0];
      const workspaceMetaKey = arguments[1];
      const done = arguments[arguments.length - 1];
      chrome.storage.local.get([storageKey, workspaceMetaKey], (stored) => {
        const error = chrome.runtime.lastError?.message || null;
        done(error ? { error } : {
          state: stored[storageKey] || null,
          workspaceMeta: stored[workspaceMetaKey] || null
        });
      });
    `, [STORAGE_KEY, WORKSPACE_META_KEY]);
    return (
      isWorkspaceSnapshotSuccess(snapshot) &&
      snapshot.state.projectName === "A DIRTY INPUT PRESERVED" &&
      snapshot.state.globalInstruction === "B REMOTE REVISION" &&
      snapshot.workspaceMeta.revision > dirtyRemotePersisted.workspaceMeta.revision
    ) ? snapshot : false;
  }, "sidepanel A dirty input 재저장");
  await switchToWindow(sidepanelBHandle);
  const dirtyMergedDom = await waitUntil(async () => {
    const state = await executeSync<Pick<
      DirtyInputState,
      "projectName" | "globalInstruction"
    >>(`
      return {
        projectName: document.querySelector("#project-name")?.value || "",
        globalInstruction: document.querySelector("#global-instruction")?.value || ""
      };
    `);
    return (
      state.projectName === "A DIRTY INPUT PRESERVED" &&
      state.globalInstruction === "B REMOTE REVISION"
    ) ? state : false;
  }, "sidepanel B dirty merge 결과 동기화");
  const dirtyMergeSmoke = {
    gateCaptured: dirtyGateCaptured,
    remotePersisted: dirtyRemotePersisted,
    inputPreserved: dirtyInputPreserved,
    gateRelease: dirtyGateRelease,
    mergedPersisted: dirtyMergedPersisted,
    mergedDom: dirtyMergedDom
  };

  await executeSync(`
    const input = document.querySelector("#project-name");
    input.value = "STALE PANEL B SHOULD NOT RETURN";
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: "STALE PANEL B SHOULD NOT RETURN"
    }));
  `);
  const stalePersisted = await waitUntil(async () => {
    const snapshot = await executeAsync<WorkspaceSnapshotResult>(`
      const storageKey = arguments[0];
      const workspaceMetaKey = arguments[1];
      const done = arguments[arguments.length - 1];
      chrome.storage.local.get([storageKey, workspaceMetaKey], (stored) => {
        const error = chrome.runtime.lastError?.message || null;
        done(error ? { error } : {
          state: stored[storageKey] || null,
          workspaceMeta: stored[workspaceMetaKey] || null
        });
      });
    `, [STORAGE_KEY, WORKSPACE_META_KEY]);
    return (
      isWorkspaceSnapshotSuccess(snapshot) &&
      snapshot.state.projectName === "STALE PANEL B SHOULD NOT RETURN" &&
      snapshot.workspaceMeta.resetEpoch === staleWorkspaceMetaSeed.resetEpoch &&
      snapshot.workspaceMeta.revision > staleWorkspaceMetaSeed.revision
    ) ? snapshot : false;
  }, "sidepanel B stale state CAS 저장");

  await switchToWindow(sidepanelAHandle);
  let resetClickError: Error | null = null;
  const resetProbe = await executeSync<ResetProbeState>(`
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.__kirinukiE2eResetResponse = null;
    const wrappedSendMessage = async (message, ...args) => {
      const response = await originalSendMessage(message, ...args);
      if (message?.type === "KIRINUKI_RESET_BINDINGS") {
        globalThis.__kirinukiE2eResetResponse = response;
      }
      return response;
    };
    chrome.runtime.sendMessage = wrappedSendMessage;
    const status = document.querySelector("#status-bar");
    if (status) {
      status.hidden = true;
    }
    const button = document.querySelector("#reset-project");
    button?.scrollIntoView({ block: "center", inline: "center" });
    return {
      sendMessageWrapped: chrome.runtime.sendMessage === wrappedSendMessage,
      resetButtonVisible: Boolean(button && !button.hidden)
    };
  `);
  assert(
    resetProbe.sendMessageWrapped && resetProbe.resetButtonVisible,
    `reset response probe 설치 실패: ${JSON.stringify(resetProbe)}`
  );
  try {
    await clickElement("#reset-project");
  } catch (error) {
    resetClickError = error instanceof Error ? error : new Error(String(error));
    if (!/unexpected alert open/i.test(resetClickError.message)) {
      throw error;
    }
  }
  await webdriver("POST", `/session/${sessionId}/alert/accept`);
  const resetUi = await waitUntil(async () => {
    const state = await executeSync<ResetUiState>(`
      return {
        inert: document.body.inert,
        projectName: document.querySelector("#project-name")?.value || "",
        segmentCount: document.querySelectorAll("#segments-list .segment-item").length,
        statusHidden: document.querySelector("#status-bar")?.hidden,
        status: document.querySelector("#status-bar")?.textContent || "",
        resetDisabled: document.querySelector("#reset-project")?.disabled,
        resetResponse: globalThis.__kirinukiE2eResetResponse
      };
    `);
    return !state.inert &&
      state.projectName === "" &&
      state.segmentCount === 0 &&
      !state.statusHidden &&
      state.status.includes("임시저장·원본 파일 권한을 초기화") &&
      !state.resetDisabled &&
      state.resetResponse?.ok === true &&
      Array.isArray(state.resetResponse?.cleanupErrors) &&
      state.resetResponse.cleanupErrors.length === 0 ? state : false;
  }, "sidepanel A 전체 workspace reset 완료", { timeout: 25_000 });

  const handlesAfterReset = await webdriver<string[]>(
    "GET",
    `/session/${sessionId}/window/handles`
  );
  assert(
    !handlesAfterReset.includes(primaryEditorHandle) &&
      !handlesAfterReset.includes(secondEditorHandle) &&
      handlesAfterReset.includes(sidepanelAHandle) &&
      handlesAfterReset.includes(sidepanelBHandle),
    `reset이 모든 editor window만 닫지 못했습니다: ${JSON.stringify({
      primaryEditorHandle,
      secondEditorHandle,
      sidepanelAHandle,
      sidepanelBHandle,
      handlesAfterReset
    })}`
  );

  await switchToWindow(sidepanelBHandle);
  const sidepanelBSynced = await waitUntil(async () => {
    const state = await executeSync<SidepanelResetState>(`
      return {
        projectName: document.querySelector("#project-name")?.value || "",
        segmentCount: document.querySelectorAll("#segments-list .segment-item").length,
        status: document.querySelector("#status-bar")?.textContent || ""
      };
    `);
    return state.projectName === "" && state.segmentCount === 0 ? state : false;
  }, "sidepanel B reset epoch 동기화");

  const staleCasResponses = await executeAsync<StaleCasResult>(`
    const [
      staleState,
      staleMeta,
      projectId,
      workspaceMetaKey
    ] = arguments;
    const done = arguments[arguments.length - 1];
    void (async () => {
      const before = (await chrome.storage.local.get(workspaceMetaKey))[workspaceMetaKey];
      const [persist, open] = await Promise.all([
        chrome.runtime.sendMessage({
          type: "KIRINUKI_PERSIST_STATE",
          state: staleState,
          writerId: "e2e-stale-panel-b",
          expectedResetEpoch: staleMeta.resetEpoch,
          expectedRevision: staleMeta.revision
        }),
        chrome.runtime.sendMessage({
          type: "KIRINUKI_OPEN_EDITOR",
          projectId,
          sourceTabId: 999999,
          captureState: staleState,
          expectedResetEpoch: staleMeta.resetEpoch,
          expectedRevision: staleMeta.revision
        })
      ]);
      const after = (await chrome.storage.local.get(workspaceMetaKey))[workspaceMetaKey];
      done({ persist, open, before, after });
    })().catch((error) => done({
        error: error instanceof Error ? error.stack || error.message : String(error)
      }));
  `, [
    stalePersisted.state,
    stalePersisted.workspaceMeta,
    PROJECT_ID,
    WORKSPACE_META_KEY
  ]);
  assert(
    !("error" in staleCasResponses) &&
      staleCasResponses.persist?.ok === false &&
      staleCasResponses.open?.ok === false &&
      staleCasResponses.persist?.workspaceMeta?.resetEpoch !==
        stalePersisted.workspaceMeta.resetEpoch &&
      staleCasResponses.open?.workspaceMeta?.resetEpoch ===
        staleCasResponses.persist.workspaceMeta.resetEpoch &&
      staleCasResponses.before?.resetEpoch === staleCasResponses.after?.resetEpoch &&
      staleCasResponses.before?.revision === staleCasResponses.after?.revision &&
      staleCasResponses.before?.writerId === staleCasResponses.after?.writerId,
    `reset 뒤 stale PERSIST/OPEN CAS가 거절되지 않았습니다: ${JSON.stringify(
      staleCasResponses
    )}`
  );

  await delay(4_600);
  const resetAudit = await executeAsync<ResetAuditResult>(`
    const [
      storageKey,
      workspaceMetaKey,
      bindingsKey,
      seedPrefix,
      databaseName,
      cacheName,
      cacheUrl,
      editorRoot
    ] = arguments;
    const done = arguments[arguments.length - 1];
    void (async () => {
      const [stored, session, databases, cacheNames, tabs] = await Promise.all([
        chrome.storage.local.get(null),
        chrome.storage.session.get(bindingsKey),
        indexedDB.databases(),
        caches.keys(),
        chrome.tabs.query({})
      ]);
      const cached = cacheNames.includes(cacheName)
        ? await (await caches.open(cacheName)).match(cacheUrl)
        : null;
      done({
        state: stored[storageKey] || null,
        workspaceMeta: stored[workspaceMetaKey] || null,
        seedKeys: Object.keys(stored).filter((key) => key.startsWith(seedPrefix)),
        bindings: session[bindingsKey] || {},
        databaseNames: databases.map((entry) => entry.name),
        cacheNames,
        cacheText: cached ? await cached.text() : null,
        editorTabs: tabs
          .filter((tab) => tab.url?.startsWith(editorRoot))
          .map((tab) => ({ id: tab.id, url: tab.url, windowId: tab.windowId })),
        panelDom: {
          projectName: document.querySelector("#project-name")?.value || "",
          segmentCount: document.querySelectorAll("#segments-list .segment-item").length
        }
      });
    })().catch((error) => done({
      error: error instanceof Error ? error.stack || error.message : String(error)
    }));
  `, [
    STORAGE_KEY,
    WORKSPACE_META_KEY,
    BINDINGS_KEY,
    SEED_PREFIX,
    DATABASE_NAME,
    LEGACY_MODEL_CACHE_NAME,
    modelCacheSentinelUrl,
    `chrome-extension://${extensionId}/editor.html`
  ]);
  assert(
    !("error" in resetAudit) &&
      resetAudit.state?.editorProjectId === "" &&
      resetAudit.state?.projectName === "" &&
      resetAudit.state?.segments?.length === 0 &&
      resetAudit.workspaceMeta?.resetEpoch !== stalePersisted.workspaceMeta.resetEpoch &&
      resetAudit.workspaceMeta?.revision > stalePersisted.workspaceMeta.revision &&
      resetAudit.seedKeys.length === 0 &&
      Object.keys(resetAudit.bindings).length === 0 &&
      !resetAudit.databaseNames.includes(DATABASE_NAME) &&
      resetAudit.editorTabs.length === 0 &&
      !resetAudit.cacheNames.includes(LEGACY_MODEL_CACHE_NAME) &&
      resetAudit.cacheText === null &&
      resetAudit.panelDom.projectName === "" &&
      resetAudit.panelDom.segmentCount === 0,
    `multi-window reset 뒤 workspace 정리/이전 모델 Cache 제거 계약 위반: ${JSON.stringify(
      resetAudit
    )}`
  );
  const resetSmoke = {
    fixture: {
      sidepanelA: sidepanelAFixture,
      sidepanelB: sidepanelBFixture,
      dirtyMerge: dirtyMergeSmoke,
      stalePersisted,
      resetClickError: resetClickError?.message || null
    },
    resetUi,
    sidepanelBSynced,
    staleCasResponses,
    handlesAfterReset,
    audit: resetAudit
  };

  const browserLogs = await webdriver<BrowserLogEntry[]>(
    "POST",
    `/session/${sessionId}/log`,
    { type: "browser" }
  );
  const severeLogs = browserLogs.filter(
    (entry) => entry.level === "SEVERE"
  );
  assert(severeLogs.length === 0, `브라우저 SEVERE 로그가 있습니다:\n${JSON.stringify(severeLogs, null, 2)}`);

  console.log(JSON.stringify({
    ok: true,
    chromium,
    chromedriver,
    ffmpeg,
    extensionId,
    projectId: PROJECT_ID,
    media: mediaState,
    cue: {
      id: cueId,
      text: restoredCue.text,
      startOffsetMs: restoredCue.startOffsetMs,
      endOffsetMs: restoredCue.endOffsetMs,
      x: restoredCue.x,
      y: restoredCue.y,
      color: restoredCue.color,
      leftHandleHitAtCueStart: cueLeftHandleHit
    },
    imageAsset: restored.imageAssets?.find((asset) => asset.id === imageAssetId),
    imageAssetBlobKeysAfterPrune: prunedImageAssetBlobKeys,
    clipOrder: restored.clips.map((clip) => clip.id),
    hotSeed: {
      delivery: hotSeedDelivery,
      dom: hotSeedDom,
      preservedTrim: expected.trimmedClip,
      appendedClip: restored.clips.find((clip) => clip.id === "clip-selection-c")
    },
    semantics: {
      nativeSpaceButton,
      transportShortcutRemap,
      localDrafts: localDraftSmoke,
      recoveryHub: recoveryHubSmoke,
      multitrackUi: multitrackUiProbe,
      cueHandleNudge: {
        before: cueHandleNudgeBefore,
        after: cueHandleNudgeAfter
      },
      cueTextHotReload,
      captionBackgroundToggle,
      perCueFontSize,
      captionPropertiesSheet,
      playbackPointerSafety,
      reorderKeyboardFocus,
      clipGroupMove: clipGroupMoveSmoke,
      rippleRange: {
        toolbar: toolbarRange,
        handleBeforeDrag: rangeHandleBeforeDrag,
        endAfterNudge: rangeEndAfterNudge,
        deletedRange: deleteRange,
        cueTimelineStartBefore: rangeCueTimelineStartBefore,
        cueTimelineStartAfter: rippleMovedCueTimelineStart,
        inputEscape: inputEscapeRange,
        uiAfterDelete: rangeUiAfterDelete
      },
      clipTrimRoundTrip: {
        moves: clipTrimRoundTrip.moves,
        down: roundTripDown,
        maxX: Math.max(...roundTripMoves.map((event) => event.x)),
        up: roundTripUp,
        cueBefore: rollbackCueBefore,
        cueAfter: rollbackCueAfter,
        liveCueGeometry: liveClipTrimGeometry
      },
      persistentErrorToast,
      aiDialog: {
        opened: aiDialogOpened,
        afterTab: aiDialogAfterTab,
        canceled: aiDialogCanceled,
        captionFetch: aiFetchProbe
      },
      aiSuccess: aiSuccessSmoke,
      previewTransition: previewTransitionSmoke
    },
    restoredDom,
    resetSmoke,
    browserSevereLogs: severeLogs.length,
    screenshot: screenshotPath
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  if (driverOutput.trim()) {
    console.error("\nChromeDriver output:\n" + driverOutput.trim());
  }
  if (ffmpegOutput.trim()) {
    console.error("\nFFmpeg output:\n" + ffmpegOutput.trim());
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
