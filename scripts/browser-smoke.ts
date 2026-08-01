import { constants as fsConstants } from "node:fs";
import { access, cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  acquireDevRunnerLock,
  failClosedOnDevRunnerOwnerLoss,
  releaseDevRunnerLock
} from "./dev-runner-lock.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const EXPECT_PACKAGE_ORIGIN_REJECTION_FLAG = "--expect-package-origin-rejection";
const DEV_RELOAD_SMOKE_FLAG = "--dev-reload";
const browserSmokeArgs = process.argv.slice(2);
const expectPackageOriginRejection = browserSmokeArgs.includes(
  EXPECT_PACKAGE_ORIGIN_REJECTION_FLAG
);
const testDevReload = browserSmokeArgs.includes(DEV_RELOAD_SMOKE_FLAG);
const extensionRootArgs = browserSmokeArgs.filter(
  (argument) => (
    argument !== EXPECT_PACKAGE_ORIGIN_REJECTION_FLAG
    && argument !== DEV_RELOAD_SMOKE_FLAG
  )
);
if (extensionRootArgs.length > 1) {
  throw new Error(
    "사용법: npm run test:browser -- [extension-root] "
    + `[${EXPECT_PACKAGE_ORIGIN_REJECTION_FLAG}] [${DEV_RELOAD_SMOKE_FLAG}]`
  );
}
const sourceExtensionRoot = path.resolve(
  extensionRootArgs[0] || path.join(root, "extension")
);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chzzk-kirinuki-browser-smoke-"));
const profileRoot = path.join(tempRoot, "chromium-profile");
let extensionRoot = sourceExtensionRoot;
let devReloadMarkerPath = path.join(extensionRoot, "dev-reload.json");

type DriverProcess = ChildProcess & {
  port: number;
  stdout: Readable;
  stderr: Readable;
};
type BrowserLogEntry = {
  level?: string;
  source?: string;
  message?: string;
};
type DevReloadState = {
  readyState: string;
  href: string;
  stylesheet: string;
  lastRevision?: string | null;
  expectedProject?: string | null;
  inert?: boolean;
};
type WebDriverEnvelope = {
  value?: unknown;
};
type ExtensionTarget = {
  type?: string;
  url?: string;
};
type BrowserSession = {
  sessionId?: string;
  capabilities?: {
    "goog:chromeOptions"?: {
      debuggerAddress?: string;
    };
  };
};
type EditorProbe = {
  readyState?: string;
  endpoint?: string;
  model?: string;
  fontSize?: string;
  stylePreset?: string;
  stylePresetOptions: string[];
  captionBackgroundPressed?: string;
  captionBackgroundLabel?: string;
  captionBackgroundKey?: string;
  tokenType?: string;
  modelOptions: string[];
  advancedOpen?: boolean;
  endpointInAdvanced?: boolean;
  missingIds: string[];
};
type AudsegModeProbe = {
  value?: string;
  description: string;
};
type RuntimeProbe = {
  error?: unknown;
  fonts?: {
    pretendard?: boolean;
    paperlogy?: boolean;
  };
  localAgentPermission?: boolean;
  cacheNames: string[];
};
type Dimensions = {
  clientWidth: number;
  scrollWidth: number;
  left: number;
  right: number;
};
type SourceLayoutProbe = {
  viewportWidth: number;
  card: Dimensions;
  details: Dimensions;
  row: Dimensions;
  streamer: Dimensions;
  broadcast: Dimensions;
};
type EditorShortcutProbe = {
  assetSelectedByV: string | null;
  inputBlockedC: string | null;
  captionSelectedByC: string | null;
  buttonFocusAllowsV: string | null;
  addCueKey: string | null;
  addCueTitle: string;
  captionBackgroundKey: string | null;
  captionBackgroundTitle: string;
  audioModeKey: string | null;
  deleteCueKey: string | null;
  exportKey: string | null;
};
type SidepanelShortcutProbe = {
  adjacentRateButtons: boolean;
  adjacentSeekButtons: boolean;
  quarterKey: string | null;
  quarterTitle: string;
  doubleKey: string | null;
  doubleTitle: string;
  seekBackwardKey: string | null;
  seekBackwardTitle: string;
  seekForwardKey: string | null;
  seekForwardTitle: string;
  captureStartKey: string | null;
  captureEndKey: string | null;
  resetKey: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWebDriverEnvelope(value: unknown): WebDriverEnvelope {
  return isRecord(value) ? value : {};
}

function describeHttpError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) {
    return fallback;
  }
  if (
    isRecord(payload.value)
    && typeof payload.value.message === "string"
    && payload.value.message
  ) {
    return payload.value.message;
  }
  return typeof payload.raw === "string" && payload.raw ? payload.raw : fallback;
}

let driver: DriverProcess | null = null;
let sessionId = "";
let cleanupPromise: Promise<void> | null = null;
let driverOutput = "";
let ownsDevReloadMarker = false;
let devReloadLockLease: Awaited<ReturnType<typeof acquireDevRunnerLock>> | null = null;

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isExpectedPackageOriginRejection(entry: BrowserLogEntry) {
  return (
    entry?.level === "SEVERE"
    && entry?.source === "network"
    && String(entry?.message || "").startsWith(
      "http://127.0.0.1:4319/v1/session - Failed to load resource:"
    )
    && String(entry.message).includes("status of 403")
  );
}

function isExpectedLocalCaptionOffline(entry: BrowserLogEntry) {
  return (
    entry?.level === "SEVERE"
    && entry?.source === "network"
    && String(entry?.message || "").startsWith(
      "http://127.0.0.1:4319/v1/session - Failed to load resource:"
    )
    && String(entry.message).includes("net::ERR_CONNECTION_REFUSED")
  );
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
  assert(Number.isInteger(port), "임시 ChromeDriver 포트를 할당하지 못했습니다.");
  return port as number;
}

function appendDriverOutput(chunk: Buffer | string) {
  driverOutput += chunk.toString();
  if (driverOutput.length > 80_000) {
    driverOutput = driverOutput.slice(-80_000);
  }
}

async function fetchJson(
  url: string,
  {
    method = "GET",
    body,
    timeout = 30_000
  }: { method?: string; body?: unknown; timeout?: number } = {}
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
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

async function waitForDriver(baseUrl: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driver?.exitCode !== null) {
      throw new Error(`ChromeDriver가 준비 전에 종료했습니다.\n${driverOutput.trim()}`);
    }
    try {
      const status = readWebDriverEnvelope(
        await fetchJson(`${baseUrl}/status`, { timeout: 1_000 })
      );
      if (isRecord(status.value) && status.value.ready === true) {
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
  const targetUrl = `http://${debuggerAddress}/json/list`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const payload = await fetchJson(targetUrl, { timeout: 2_000 });
    const targets = Array.isArray(payload)
      ? payload.filter((entry): entry is ExtensionTarget => isRecord(entry))
      : [];
    const target = targets.find((entry): entry is Required<ExtensionTarget> => {
      if (entry?.type !== "service_worker" || typeof entry.url !== "string") {
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

async function webdriver(
  baseUrl: string,
  method: string,
  commandPath: string,
  body: unknown,
  timeout?: number
): Promise<unknown>;
async function webdriver<T>(
  baseUrl: string,
  method: string,
  commandPath: string,
  body: unknown,
  timeout?: number
): Promise<T>;
async function webdriver(
  baseUrl: string,
  method: string,
  commandPath: string,
  body: unknown,
  timeout = 30_000
): Promise<unknown> {
  const payload = readWebDriverEnvelope(
    await fetchJson(`${baseUrl}${commandPath}`, { method, body, timeout })
  );
  const value = payload.value;
  if (isRecord(value) && value.error) {
    throw new Error(
      `${String(value.error)}: ${
        typeof value.message === "string" && value.message
          ? value.message
          : "WebDriver 명령 실패"
      }`
    );
  }
  return value;
}

async function terminateDriver() {
  if (!driver || driver.exitCode !== null) {
    return;
  }
  const activeDriver = driver;

  const waitForExit = async (milliseconds: number) => {
    if (activeDriver.exitCode !== null) {
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        activeDriver.off("exit", onExit);
        resolve(false);
      }, milliseconds);
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      activeDriver.once("exit", onExit);
    });
  };

  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") {
        activeDriver.kill(name);
      } else {
        assert(activeDriver.pid !== undefined, "ChromeDriver PID가 없습니다.");
        process.kill(-activeDriver.pid, name);
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

async function cleanup() {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    if (sessionId && driver?.exitCode === null) {
      try {
        await fetchJson(`http://127.0.0.1:${driver.port}/session/${sessionId}`, {
          method: "DELETE",
          timeout: 5_000
        });
      } catch {
        // 아래 process-group 종료가 남은 Chromium까지 정리한다.
      }
      sessionId = "";
    }
    await terminateDriver();
    if (ownsDevReloadMarker) {
      try {
        const marker = JSON.parse(await readFile(devReloadMarkerPath, "utf8"));
        if (marker?.pid === process.pid) {
          await unlink(devReloadMarkerPath);
        }
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code !== "ENOENT" && !(error instanceof SyntaxError)) {
          console.warn(`개발 marker 정리 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      ownsDevReloadMarker = false;
    }
    await releaseDevRunnerLock(devReloadLockLease);
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

async function main() {
  assert(
    !(expectPackageOriginRejection && testDevReload),
    "ZIP origin 거절 smoke와 개발 핫 리로드 smoke는 동시에 실행할 수 없습니다."
  );
  if (testDevReload) {
    devReloadLockLease = await acquireDevRunnerLock(
      path.join(root, ".dev-editor.lock"),
      {
        role: "validate",
        inheritedToken: process.env.KIRINUKI_RELEASE_LOCK_TOKEN,
        onOwnerLost: failClosedOnDevRunnerOwnerLoss("browser-smoke")
      }
    );
    extensionRoot = path.join(tempRoot, "extension-under-test");
    await cp(sourceExtensionRoot, extensionRoot, {
      recursive: true,
      filter: (sourcePath) => {
        const relativePath = path.relative(
          sourceExtensionRoot,
          sourcePath
        ).split(path.sep).join("/");
        return (
          relativePath !== "dev-reload.json"
          && !/^dev-reload\.json\..+\.tmp$/u.test(relativePath)
        );
      }
    });
    devReloadMarkerPath = path.join(extensionRoot, "dev-reload.json");
  }
  if (expectPackageOriginRejection) {
    assert(
      sourceExtensionRoot !== path.join(root, "extension"),
      `${EXPECT_PACKAGE_ORIGIN_REJECTION_FLAG}는 ZIP에서 푼 임시 확장 검사에만 사용할 수 있습니다.`
    );
  }
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
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
  const writeDevReloadMarker = async (
    revision: string,
    kind: string,
    changedFiles: string[]
  ) => {
    await writeFile(devReloadMarkerPath, `${JSON.stringify({
      schema: "chzzk-kirinuki-dev-reload/v1",
      revision,
      kind,
      changedFiles,
      pid: process.pid,
      createdAt: new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    ownsDevReloadMarker = true;
  };
  if (testDevReload) {
    await writeDevReloadMarker("browser-smoke-initial", "initial", []);
  }

  const [chromedriver, chromium, port] = await Promise.all([
    resolveExecutable("CHROMEDRIVER_BINARY", ["chromedriver"]),
    resolveExecutable("CHROMIUM_BINARY", ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]),
    reservePort()
  ]);
  const baseUrl = `http://127.0.0.1:${port}`;

  driver = spawn(chromedriver, [`--port=${port}`], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  }) as DriverProcess;
  driver.port = port;
  driver.stdout.on("data", appendDriverOutput);
  driver.stderr.on("data", appendDriverOutput);

  await waitForDriver(baseUrl);

  const created = await webdriver<BrowserSession>(baseUrl, "POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        "goog:loggingPrefs": { browser: "ALL" },
        "goog:chromeOptions": {
          binary: chromium,
          args: [
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            `--user-data-dir=${profileRoot}`,
            `--disable-extensions-except=${extensionRoot}`,
            `--load-extension=${extensionRoot}`
          ]
        }
      }
    }
  });
  assert(
    typeof created.sessionId === "string" && created.sessionId,
    "ChromeDriver session ID를 받지 못했습니다."
  );
  sessionId = created.sessionId;

  const debuggerAddress = created.capabilities?.["goog:chromeOptions"]?.debuggerAddress;
  assert(debuggerAddress, "Chrome DevTools debugger address를 받지 못했습니다.");
  const extensionTarget = await waitForExtensionTarget(debuggerAddress, serviceWorkerPath);
  const extensionId = new URL(extensionTarget.url).host;
  assert(extensionId, "service worker target에서 extension ID를 찾지 못했습니다.");

  const editorUrl = (
    `chrome-extension://${extensionId}/editor.html`
    + (testDevReload ? "?dev=1" : "")
  );
  await webdriver(baseUrl, "POST", `/session/${sessionId}/url`, { url: editorUrl });
  const editor = await webdriver<EditorProbe>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/sync`,
    {
    script: `
      const requiredIds = [
        "preview-video",
        "image-asset-overlays",
        "subtitle-overlays",
        "video-track",
        "asset-track",
        "audio-track",
        "caption-tracks",
        "set-range-start",
        "set-range-end",
        "clear-range",
        "delete-range",
        "timeline-range-selection",
        "timeline-range-summary",
        "range-start-handle",
        "range-end-handle",
        "timeline-context-menu",
        "context-set-range-start",
        "context-set-range-end",
        "context-delete-range",
        "cue-text",
        "cue-start",
        "cue-end",
        "cue-x",
        "cue-y",
        "asset-mode-tab",
        "asset-paste",
        "asset-input",
        "asset-start",
        "asset-end",
        "asset-scale",
        "asset-opacity",
        "create-local-draft",
        "open-local-drafts",
        "local-draft-dialog",
        "local-draft-list",
        "restore-local-draft",
        "caption-agent-endpoint",
        "caption-agent-token",
        "caption-model",
        "caption-mode-description",
        "caption-advanced-settings",
        "test-caption-agent",
        "generate-captions",
        "caption-agent-warning",
        "cue-review-note",
        "caption-style-preset",
        "toggle-caption-background",
        "caption-background-label",
        "export-video"
      ];
      return {
        title: document.title,
        readyState: document.readyState,
        endpoint: document.getElementById("caption-agent-endpoint")?.value,
        model: document.getElementById("caption-model")?.value,
        fontSize: document.getElementById("font-size")?.value,
        stylePreset: document.getElementById("caption-style-preset")?.value,
        stylePresetOptions: [
          ...document.getElementById("caption-style-preset")?.options || []
        ].map((option) => option.value),
        captionBackgroundPressed: document.getElementById("toggle-caption-background")
          ?.getAttribute("aria-pressed"),
        captionBackgroundLabel: document.getElementById("caption-background-label")
          ?.textContent,
        captionBackgroundKey: document.getElementById("toggle-caption-background")
          ?.getAttribute("aria-keyshortcuts"),
        tokenType: document.getElementById("caption-agent-token")?.type,
        modelOptions: [...document.getElementById("caption-model")?.options || []]
          .map((option) => option.value),
        advancedOpen: document.getElementById("caption-advanced-settings")?.open,
        endpointInAdvanced: document.getElementById("caption-advanced-settings")
          ?.contains(document.getElementById("caption-agent-endpoint")),
        missingIds: requiredIds.filter((id) => !document.getElementById(id))
      };
    `,
    args: []
    }
  );
  assert(editor.readyState === "complete", `editor readyState가 complete가 아닙니다: ${editor.readyState}`);
  assert(editor.endpoint === "http://127.0.0.1:4319/v1/captions", `기본 자막 에이전트 주소가 올바르지 않습니다: ${editor.endpoint}`);
  assert(editor.model === "whisper-tiny", `기본 로컬 Whisper 모델이 올바르지 않습니다: ${editor.model}`);
  assert(editor.fontSize === "6.75", `기본 자막 크기가 30% 확대값이 아닙니다: ${editor.fontSize}`);
  assert(
    editor.stylePreset === "kr-vtuber-clean-v1",
    `기본 자막 스타일이 완성본 측정 프리셋이 아닙니다: ${editor.stylePreset}`
  );
  assert(
    editor.stylePresetOptions.join(",") ===
      "kr-vtuber-clean-v1,kr-vtuber-black-box-v1,kr-vtuber-paperlogy-v1,pretendard-legacy-v1",
    `자막 스타일 선택지가 다릅니다: ${editor.stylePresetOptions.join(",")}`
  );
  assert(
    editor.captionBackgroundPressed === "false"
      && editor.captionBackgroundLabel === "이 자막 검은 상자 켜기 · X"
      && editor.captionBackgroundKey === "X",
    `새 프로젝트의 검은 자막 배경 토글 기본값이 꺼짐이 아닙니다: ${JSON.stringify({
      pressed: editor.captionBackgroundPressed,
      label: editor.captionBackgroundLabel,
      key: editor.captionBackgroundKey
    })}`
  );
  assert(editor.tokenType === "hidden", "자동 session 토큰 요소는 사용자에게 숨겨져야 합니다.");
  assert(
    editor.modelOptions.join(",") === "whisper-tiny,audseg-local",
    `Whisper·AudSeg 선택지가 계약과 다릅니다: ${editor.modelOptions.join(",")}`
  );
  assert(editor.advancedOpen === false, "Whisper companion 세부설정은 기본으로 접혀 있어야 합니다.");
  assert(editor.endpointInAdvanced === true, "companion 주소가 세부설정 밖에 노출되어 있습니다.");
  assert(editor.missingIds.length === 0, `editor 핵심 DOM 누락: ${editor.missingIds.join(", ")}`);

  const editorShortcuts = await webdriver<EditorShortcutProbe>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/sync`,
    {
      script: `
        const dispatchLetter = (target, letter) => target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: letter.toLowerCase(),
            code: "Key" + letter,
            bubbles: true
          })
        );
        const projectName = document.getElementById("project-name");
        dispatchLetter(document.body, "V");
        const assetSelectedByV = document.getElementById("asset-mode-tab")
          ?.getAttribute("aria-selected");
        projectName.focus();
        dispatchLetter(projectName, "C");
        const inputBlockedC = document.getElementById("asset-mode-tab")
          ?.getAttribute("aria-selected");
        projectName.blur();
        dispatchLetter(document.body, "C");
        const captionSelectedByC = document.getElementById("caption-mode-tab")
          ?.getAttribute("aria-selected");
        const addCue = document.getElementById("add-cue");
        addCue.focus();
        dispatchLetter(addCue, "V");
        return {
          assetSelectedByV,
          inputBlockedC,
          captionSelectedByC,
          buttonFocusAllowsV: document.getElementById("asset-mode-tab")
            ?.getAttribute("aria-selected"),
          addCueKey: document.getElementById("add-cue")
            ?.getAttribute("aria-keyshortcuts"),
          addCueTitle: document.getElementById("add-cue")?.title || "",
          captionBackgroundKey: document.getElementById("toggle-caption-background")
            ?.getAttribute("aria-keyshortcuts"),
          captionBackgroundTitle: document.getElementById("toggle-caption-background")
            ?.title || "",
          audioModeKey: document.getElementById("audio-mode-tab")
            ?.getAttribute("aria-keyshortcuts"),
          deleteCueKey: document.getElementById("delete-cue")
            ?.getAttribute("aria-keyshortcuts"),
          exportKey: document.getElementById("export-video")
            ?.getAttribute("aria-keyshortcuts")
        };
      `,
      args: []
    }
  );
  assert(editorShortcuts.assetSelectedByV === "true", "편집기 V 단축키가 에셋 탭을 열지 않습니다.");
  assert(editorShortcuts.inputBlockedC === "true", "입력칸 포커스 중 C 단축키가 실행됐습니다.");
  assert(editorShortcuts.captionSelectedByC === "true", "편집기 C 단축키가 자막 탭을 열지 않습니다.");
  assert(editorShortcuts.buttonFocusAllowsV === "true", "버튼 포커스가 안전한 V 단축키를 막습니다.");
  assert(editorShortcuts.addCueKey === "A", "자막 추가 버튼의 A 단축키 접근성 표기가 없습니다.");
  assert(editorShortcuts.addCueTitle.includes("A"), "자막 추가 버튼 tooltip에 A 단축키가 없습니다.");
  assert(editorShortcuts.captionBackgroundKey === "X", "선택 자막 검은 배경 버튼의 X 단축키 표기가 없습니다.");
  assert(editorShortcuts.captionBackgroundTitle.includes("X"), "선택 자막 검은 배경 tooltip에 X 단축키가 없습니다.");
  assert(editorShortcuts.audioModeKey === "B", "음성 편집 탭의 기존 B 단축키 표기가 없습니다.");
  assert(editorShortcuts.deleteCueKey === null, "자막 삭제에 A-Z 단축키가 배정됐습니다.");
  assert(editorShortcuts.exportKey === null, "영상 내보내기에 A-Z 단축키가 배정됐습니다.");

  let devReload = null;
  if (testDevReload) {
    const waitForEditorState = async (
      label: string,
      predicate: (state: DevReloadState) => boolean
    ): Promise<DevReloadState> => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          const state = await webdriver<DevReloadState>(
            baseUrl,
            "POST",
            `/session/${sessionId}/execute/sync`,
            {
              script: `
                const stylesheet = document.querySelector(
                  'link[rel~="stylesheet"][href*="editor/editor.css"]'
                );
                return {
                  readyState: document.readyState,
                  href: location.href,
                  stylesheet: stylesheet?.href || "",
                  lastRevision: sessionStorage.getItem(
                    "kirinuki:dev-reload:last-revision"
                  ),
                  expectedProject: sessionStorage.getItem(
                    "kirinuki:dev-reload:expected-project"
                  ),
                  inert: document.body.inert
                };
              `,
              args: []
            }
          );
          if (predicate(state)) {
            return state;
          }
        } catch {
          // A hard reload may briefly replace the execution context.
        }
        await delay(100);
      }
      throw new Error(`${label}을 8초 안에 확인하지 못했습니다.`);
    };

    const connected = await waitForEditorState(
      "개발 marker 초기 연결",
      (state) => state.lastRevision === "browser-smoke-initial"
    );
    await writeDevReloadMarker(
      "browser-smoke-style",
      "style",
      ["extension/editor/editor.css"]
    );
    const styleReloaded = await waitForEditorState(
      "CSS 상태 보존 교체",
      (state) => (
        state.lastRevision === "browser-smoke-style"
        && new URL(state.stylesheet).searchParams.get("dev-reload")
          === "browser-smoke-style"
        && state.inert === false
      )
    );
    await writeDevReloadMarker(
      "browser-smoke-editor",
      "editor",
      ["src/editor/main.ts"]
    );
    const editorReloaded = await waitForEditorState(
      "CURRENT 검증 뒤 편집기 재로드",
      (state) => (
        state.readyState === "complete"
        && state.lastRevision === "browser-smoke-editor"
        && new URL(state.href).searchParams.get("session") === "resume"
        && new URL(state.href).searchParams.get("dev") === "1"
        && Boolean(new URL(state.href).searchParams.get("project"))
        && state.expectedProject === null
        && state.inert === false
      )
    );
    devReload = { connected, styleReloaded, editorReloaded };
  }

  const audsegModeUi = await webdriver<AudsegModeProbe>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/sync`,
    {
    script: `
      const model = document.getElementById("caption-model");
      model.value = "audseg-local";
      model.dispatchEvent(new Event("change", { bubbles: true }));
      const audsegState = {
        value: model.value,
        description: document.getElementById("caption-mode-description")?.textContent || ""
      };
      model.value = "whisper-tiny";
      model.dispatchEvent(new Event("change", { bubbles: true }));
      return audsegState;
    `,
    args: []
    }
  );
  assert(audsegModeUi.value === "audseg-local", "AudSeg 모드 전환이 적용되지 않았습니다.");
  assert(
    audsegModeUi.description.includes("소리가 있는 구간만")
      && audsegModeUi.description.includes("비어 있는 편집용 cue")
      && audsegModeUi.description.includes("음성을 글로 바꾸지 않습니다"),
    `AudSeg 비전사 설명이 보이지 않습니다: ${JSON.stringify(audsegModeUi)}`
  );

  const runtime = await webdriver<RuntimeProbe>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/async`,
    {
    script: `
      const done = arguments[arguments.length - 1];
      const timeout = setTimeout(() => done({ error: "caption agent runtime timeout" }), 8_000);
      (async () => {
        await Promise.all([
          document.fonts.load('800 32px "Pretendard"', "한글 자막"),
          document.fonts.load('800 32px "Paperlogy"', "한글 자막")
        ]);
        const cacheNames = await caches.keys();
        const localAgentPermission = await chrome.permissions.contains({
          origins: ["http://127.0.0.1/*"]
        });
        const stored = await chrome.storage.local.get("chzzk-kirinuki-caption-agent-settings-v3");
        clearTimeout(timeout);
        done({
          cacheNames,
          fonts: {
            paperlogy: document.fonts.check(
              '800 32px "Paperlogy"',
              "한글 자막"
            ),
            pretendard: document.fonts.check(
              '800 32px "Pretendard"',
              "한글 자막"
            )
          },
          localAgentPermission,
          settings: stored["chzzk-kirinuki-caption-agent-settings-v3"] || null
        });
      })().catch((error) => {
        clearTimeout(timeout);
        done({ error: String(error?.stack || error) });
      });
    `,
    args: []
    }
  );
  assert(!runtime.error, `editor runtime asset 검사 실패: ${runtime.error}`);
  assert(runtime.fonts?.pretendard === true, "Pretendard 웹폰트를 로드하지 못했습니다.");
  assert(runtime.fonts?.paperlogy === true, "Paperlogy 웹폰트를 로드하지 못했습니다.");
  assert(runtime.localAgentPermission === true, "127.0.0.1 자막 에이전트 host permission이 없습니다.");
  assert(!runtime.cacheNames.includes("transformers-cache"), "이전 로컬 Whisper 모델 캐시가 남아 있습니다.");

  await webdriver(baseUrl, "POST", `/session/${sessionId}/goog/cdp/execute`, {
    cmd: "Emulation.setDeviceMetricsOverride",
    params: {
      width: 360,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    }
  });

  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  await webdriver(baseUrl, "POST", `/session/${sessionId}/url`, { url: sidepanelUrl });
  const sidepanel = await webdriver<Pick<EditorProbe, "readyState" | "missingIds">>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/sync`,
    {
    script: `
      const requiredIds = [
        "refresh-recovery-sessions",
        "recovery-sessions-list",
        "source-empty",
        "source-details",
        "source-type",
        "player-position",
        "player-status",
        "playback-rate-quarter",
        "playback-rate-double",
        "seek-backward-five",
        "seek-forward-five",
        "streamer-name",
        "broadcast-title",
        "capture-start",
        "capture-end",
        "save-segment",
        "open-editor",
        "create-codex-job",
        "generate-prompt"
      ];
      return {
        title: document.title,
        readyState: document.readyState,
        missingIds: requiredIds.filter((id) => !document.getElementById(id))
      };
    `,
    args: []
    }
  );
  assert(sidepanel.readyState === "complete", `sidepanel readyState가 complete가 아닙니다: ${sidepanel.readyState}`);
  assert(sidepanel.missingIds.length === 0, `sidepanel 핵심 DOM 누락: ${sidepanel.missingIds.join(", ")}`);

  const sidepanelShortcuts = await webdriver<SidepanelShortcutProbe>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/sync`,
    {
      script: `
        const quarter = document.getElementById("playback-rate-quarter");
        const double = document.getElementById("playback-rate-double");
        const seekBackward = document.getElementById("seek-backward-five");
        const seekForward = document.getElementById("seek-forward-five");
        return {
          adjacentRateButtons: quarter?.nextElementSibling === double,
          adjacentSeekButtons: seekBackward?.nextElementSibling === seekForward,
          quarterKey: quarter?.getAttribute("aria-keyshortcuts"),
          quarterTitle: quarter?.title || "",
          doubleKey: double?.getAttribute("aria-keyshortcuts"),
          doubleTitle: double?.title || "",
          seekBackwardKey: seekBackward?.getAttribute("aria-keyshortcuts"),
          seekBackwardTitle: seekBackward?.title || "",
          seekForwardKey: seekForward?.getAttribute("aria-keyshortcuts"),
          seekForwardTitle: seekForward?.title || "",
          captureStartKey: document.getElementById("capture-start")
            ?.getAttribute("aria-keyshortcuts"),
          captureEndKey: document.getElementById("capture-end")
            ?.getAttribute("aria-keyshortcuts"),
          resetKey: document.getElementById("reset-project")
            ?.getAttribute("aria-keyshortcuts")
        };
      `,
      args: []
    }
  );
  assert(sidepanelShortcuts.adjacentRateButtons, "0.25×와 2× 버튼이 나란히 있지 않습니다.");
  assert(sidepanelShortcuts.adjacentSeekButtons, "5초 뒤로와 앞으로 버튼이 나란히 있지 않습니다.");
  assert(sidepanelShortcuts.quarterKey === "Y", "0.25× 버튼의 Y 단축키가 없습니다.");
  assert(sidepanelShortcuts.doubleKey === "U", "2× 버튼의 U 단축키가 없습니다.");
  assert(sidepanelShortcuts.quarterTitle.includes("Y"), "0.25× tooltip에 Y가 없습니다.");
  assert(sidepanelShortcuts.doubleTitle.includes("U"), "2× tooltip에 U가 없습니다.");
  assert(sidepanelShortcuts.seekBackwardKey === "D", "5초 뒤로 버튼의 D 단축키가 없습니다.");
  assert(sidepanelShortcuts.seekForwardKey === "F", "5초 앞으로 버튼의 F 단축키가 없습니다.");
  assert(sidepanelShortcuts.seekBackwardTitle.includes("D"), "5초 뒤로 tooltip에 D가 없습니다.");
  assert(sidepanelShortcuts.seekForwardTitle.includes("F"), "5초 앞으로 tooltip에 F가 없습니다.");
  assert(sidepanelShortcuts.captureStartKey === "E", "시작 스탬프의 E 단축키가 없습니다.");
  assert(sidepanelShortcuts.captureEndKey === "R", "끝 스탬프의 R 단축키가 없습니다.");
  assert(sidepanelShortcuts.resetKey === null, "전체 초기화에 A-Z 단축키가 배정됐습니다.");

  const sourceLayout = await webdriver<SourceLayoutProbe>(
    baseUrl,
    "POST",
    `/session/${sessionId}/execute/sync`,
    {
    script: `
      const empty = document.getElementById("source-empty");
      const details = document.getElementById("source-details");
      const card = document.querySelector(".source-card");
      const row = details?.querySelector(".source-row");
      const type = document.getElementById("source-type");
      const position = document.getElementById("player-position");
      const status = document.getElementById("player-status");
      const streamer = document.getElementById("streamer-name");
      const broadcast = document.getElementById("broadcast-title");

      empty.hidden = true;
      details.hidden = false;
      type.className = "badge badge-vod";
      type.textContent = "YOUTUBE · VOD";
      position.textContent = "123:45:56";
      status.textContent = "원본 VOD 플레이어 연결됨 · 최대 화질 재생 준비 완료 · 타임스탬프 동기화 확인 중";
      streamer.value = "아주 긴 방송인 채널 이름이 자동 인식된 360픽셀 사이드패널 회귀 검사";
      broadcast.value = "처음부터 끝까지 아주 긴 치지직 다시보기 방송 제목이 잘리지 않고 입력 영역 안에 머무르는지 확인하는 회귀 검사";

      const dimensions = (element) => ({
        clientWidth: element?.clientWidth ?? -1,
        scrollWidth: element?.scrollWidth ?? -1,
        left: element?.getBoundingClientRect().left ?? -1,
        right: element?.getBoundingClientRect().right ?? -1
      });

      return {
        viewportWidth: window.innerWidth,
        card: dimensions(card),
        details: dimensions(details),
        row: dimensions(row),
        streamer: dimensions(streamer),
        broadcast: dimensions(broadcast)
      };
    `,
    args: []
    }
  );
  assert(
    sourceLayout.viewportWidth === 360,
    `sidepanel SOURCE 회귀 검사 viewport가 360px이 아닙니다: ${sourceLayout.viewportWidth}px`
  );
  for (const key of ["card", "details", "row"] as const) {
    const box = sourceLayout[key];
    assert(
      box.scrollWidth <= box.clientWidth,
      `360px sidepanel SOURCE ${key} 가로 overflow: scrollWidth=${box.scrollWidth}, clientWidth=${box.clientWidth}`
    );
  }
  for (const key of ["streamer", "broadcast"] as const) {
    const input = sourceLayout[key];
    assert(
      input.right <= sourceLayout.details.right,
      `360px sidepanel SOURCE ${key} 입력이 details 오른쪽을 벗어났습니다: input.right=${input.right}, details.right=${sourceLayout.details.right}`
    );
  }

  await delay(300);
  const browserLogs = await webdriver<BrowserLogEntry[]>(
    baseUrl,
    "POST",
    `/session/${sessionId}/log`,
    { type: "browser" }
  );
  const severeLogs = browserLogs.filter((entry) => entry.level === "SEVERE");
  const expectedPackageOriginRejections = expectPackageOriginRejection
    ? severeLogs.filter(isExpectedPackageOriginRejection)
    : [];
  const expectedLocalCaptionOffline = severeLogs.filter(
    isExpectedLocalCaptionOffline
  );
  const unexpectedSevereLogs = severeLogs.filter((entry) => (
    !isExpectedPackageOriginRejection(entry)
    && !isExpectedLocalCaptionOffline(entry)
  ));
  assert(
    expectedPackageOriginRejections.length <= 1,
    "ZIP smoke 중 startup session 403이 두 번 이상 발생했습니다. 자동 pairing 재시도를 확인하세요.\n"
      + JSON.stringify(expectedPackageOriginRejections, null, 2)
  );
  assert(
    expectedLocalCaptionOffline.length <= (testDevReload ? 2 : 1),
    "로컬 Whisper startup offline probe가 예상보다 많이 반복됐습니다.\n"
      + JSON.stringify(expectedLocalCaptionOffline, null, 2)
  );
  assert(
    unexpectedSevereLogs.length === 0,
    `브라우저 SEVERE 로그가 있습니다:\n${JSON.stringify(unexpectedSevereLogs, null, 2)}`
  );

  console.log(JSON.stringify({
    ok: true,
    chromium,
    chromedriver,
    extensionId,
    serviceWorker: extensionTarget.url,
    editor,
    editorShortcuts,
    devReload,
    runtime,
    sidepanel,
    sidepanelShortcuts,
    sourceLayout,
    browserSevereLogs: unexpectedSevereLogs.length,
    expectedLocalCaptionOffline: expectedLocalCaptionOffline.length,
    expectedPackageOriginRejections: expectedPackageOriginRejections.length
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  if (driverOutput.trim()) {
    console.error("\nChromeDriver output:\n" + driverOutput.trim());
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
