import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  BrowserWindow,
  Menu,
  app,
  ipcMain,
  powerMonitor,
  safeStorage,
  session,
  shell,
  webContents
} from "electron";
import type { WebFrameMain } from "electron";

import {
  ENGINE_BACKGROUND_ARGUMENT,
  ensureEngineAutostart,
  removeEngineAutostart,
  windowsLoginItemReadbackPath
} from "./login-autostart.js";
import type {
  EngineAutostartRegistration,
  LoginItemAdapter,
  LoginItemSettings
} from "./login-autostart.js";
import {
  desktopNativeSmokeDisconnectExitCode,
  desktopNativeSmokeReadyMessage,
  isDesktopNativeSmokeQuitMessage,
  resolveDesktopNativeSmokeContract
} from "./native-smoke-contract.js";
import type {
  DesktopNativeSmokeContract
} from "./native-smoke-contract.js";
import {
  resolveDesktopApplicationRuntimePaths
} from "./runtime-spec.js";
import type { DesktopRuntimePaths } from "./runtime-spec.js";
import {
  startDesktopRuntimeSupervisor
} from "./runtime-supervisor.js";
import type { DesktopRuntimeSupervisor } from "./runtime-supervisor.js";
import {
  loadOrCreateDesktopDeviceIdentity
} from "./device-identity.js";
import type { DesktopDeviceIdentity } from "./device-identity.js";
import {
  createDesktopDeviceIdentityProtector
} from "./device-identity-protector.js";
import {
  desktopPairingResponse
} from "./device-pairing.js";
import {
  decideEngineInstanceHandoff,
  engineInstanceIdentity,
  engineInstancePairingRequest,
  exactOwnedUninstallRequestFromArgv
} from "./instance-lifecycle.js";
import {
  ensureDesktopProtocolRegistration,
  removeDesktopProtocolRegistration
} from "./protocol-registration.js";
import {
  monitorInstalledExecutable
} from "./installed-executable-monitor.js";
import type {
  InstalledExecutableMonitor
} from "./installed-executable-monitor.js";
import {
  LOCAL_MEDIA_ENGINE_PAIRING_SCHEME,
  extractLocalMediaEngineLaunchCommandFromArgv,
  parseLocalMediaEngineLaunchCommand
} from "../lib/local-media-engine-auth.js";
import type {
  LocalMediaEngineLaunchCommand,
  LocalMediaEnginePairingRequest
} from "../lib/local-media-engine-auth.js";
import {
  EDITOR_HANDOFF_FRAGMENT_KEY,
  EDITOR_HANDOFF_TTL_MS,
  normalizeEditorHandoffSubmission
} from "../lib/editor-handoff.js";
import {
  CUT_WINDOW_BIND_DOCUMENT_CHANNEL,
  CUT_WINDOW_HANDOFF_CHANNEL,
  CUT_WINDOW_OPEN_SOURCE_CHANNEL,
  CUT_WINDOW_PLAYER_ACTION_CHANNEL,
  CUT_WINDOW_SHORTCUT_CHANNEL,
  CUT_WINDOW_URL,
  isExactCutWindowUrl,
  normalizeCutWindowPlayerActionEnvelope
} from "./cut-window-contract.js";
import {
  createCutWindowPartitionName,
  destroyAcknowledgedCutWindow,
  exactCutWindowExternalSourceUrl,
  exactStreamingFrameIdentity,
  loadExactCutWindowDocumentFailClosed,
  settleCutWindowHandoffBeforeDocumentReset,
  shouldRejectDirectCutFrameNavigation,
  shouldRejectCutWindowNavigation,
  trustedCutShortcutKey
} from "./cut-window-security.js";
import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_RESPONSE,
  parseStreamingBridgeResponse
} from "../web/streaming-bridge-protocol.js";
import type {
  StreamingBridgeRequest,
  StreamingBridgeResponse
} from "../web/streaming-bridge-protocol.js";

declare const __KIRINUKI_STREAMING_FRAME_ACTION_SOURCE__: string;
declare const __KIRINUKI_STREAMING_SHORTCUT_GUARD_SOURCE__: string;

const APP_ID = "kr.eff0rtchung.kirinuki";
const APP_NAME = "Kirinuki";
const CUT_WINDOW_ACK_POLL_MS = 100;
const CUT_WINDOW_PLAYER_ACTION_TIMEOUT_MS = 4_000;
const CUT_WINDOW_PLAYER_MAXIMUM_QUEUED_ACTIONS = 32;
const CUT_WINDOW_PLAYER_MAXIMUM_REQUESTS = 512;
const CUT_WINDOW_PLAYER_FRAME_RESPONSE_BYTES = 64 * 1024;
const CUT_WINDOW_EDITABLE_PROBE_TIMEOUT_MS = 300;
const CUT_WINDOW_EXTERNAL_OPEN_COOLDOWN_MS = 1_500;
const CUT_WINDOW_DOCUMENT_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CUT_WINDOW_EDITABLE_PROBE_SOURCE = `(() => {
  "use strict";
  let active = document.activeElement;
  let shadowDepth = 0;
  while (
    active
    && active.shadowRoot
    && active.shadowRoot.activeElement
    && shadowDepth < 8
  ) {
    active = active.shadowRoot.activeElement;
    shadowDepth += 1;
  }
  if (!active || active === document.body || active === document.documentElement) {
    return false;
  }
  const tag = String(active.tagName || "").toUpperCase();
  const role = String(active.getAttribute?.("role") || "").toLowerCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    || active.isContentEditable === true || role === "textbox"
    || role === "searchbox" || role === "combobox";
})()`;

let runtime: DesktopRuntimeSupervisor | null = null;
let deviceIdentity: Readonly<DesktopDeviceIdentity> | null = null;
let runtimePaths: Readonly<DesktopRuntimePaths>;
let autostart: Readonly<EngineAutostartRegistration> | null = null;
let shutdownPromise: Promise<void> | null = null;
let terminationRequested = false;
let relaunchRequested = false;
let approvalMonitor: ReturnType<typeof setInterval> | null = null;
let approvalCheckActive = false;
let cleanupOwnedInstallation = false;
let installedExecutableMonitor: Readonly<InstalledExecutableMonitor> | null = null;
const pendingPairingRequests: LocalMediaEnginePairingRequest[] = [];
const pendingPairingStates = new Set<string>();
const cutSessionCleanupPromises = new Set<Promise<void>>();
let pairingDrain: Promise<void> | null = null;
let cutWindow: BrowserWindow | null = null;
let cutWindowGeneration = 0;
let cutWindowRequested = false;
let cutWindowOpening: Promise<BrowserWindow> | null = null;
let cutWindowHandoff: Readonly<{
  generation: number;
  documentGeneration: number;
  handoffNonce: string;
  handoffGeneration: number;
  activeRuntime: Readonly<DesktopRuntimeSupervisor>;
  abortController: AbortController;
  promise: Promise<Readonly<{
    status: "acknowledged";
    handoffGeneration: number;
  }>>;
}> | null = null;
let cutWindowPlayerActions: {
  readonly windowGeneration: number;
  documentGeneration: number;
  documentReady: boolean;
  documentNonce: string | null;
  handoffLaunchUsed: boolean;
  lastExternalSourceOpenAt: number;
  frameEpoch: number;
  transportEpoch: number;
  bridgeGeneration: number;
  queued: number;
  tail: Promise<void>;
  readonly requests: Map<string, Readonly<{
    fingerprint: string;
    promise: Promise<Readonly<StreamingBridgeResponse>>;
  }>>;
} | null = null;

function developmentRepositoryRoot(): string {
  const configured = String(process.env.KIRINUKI_DESKTOP_DEV_ROOT || "");
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("데스크톱 개발 리소스 루트를 확인하지 못했습니다.");
  }
  return path.resolve(configured);
}

function desktopPaths(
  nativeSmoke: Readonly<DesktopNativeSmokeContract> | null
): Readonly<DesktopRuntimePaths> {
  const userDataRoot = path.resolve(app.getPath("userData"));
  const resourcesRoot = app.isPackaged
    ? path.resolve(process.resourcesPath)
    : path.join(developmentRepositoryRoot(), ".artifacts");
  return resolveDesktopApplicationRuntimePaths({
    platform: process.platform,
    arch: process.arch,
    userDataRoot,
    resourcesRoot,
    ...(nativeSmoke ? { tempRootOverride: nativeSmoke.tempRoot } : {})
  });
}

function configureNativeSmokePaths(
  nativeSmoke: Readonly<DesktopNativeSmokeContract>
): void {
  for (const directory of [
    nativeSmoke.userDataRoot,
    nativeSmoke.crashDumpsRoot,
    nativeSmoke.logsRoot,
    nativeSmoke.tempRoot
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("데스크톱 native smoke 격리 경로가 안전하지 않습니다.");
    }
  }
  app.setPath("userData", nativeSmoke.userDataRoot);
  app.setPath("crashDumps", nativeSmoke.crashDumpsRoot);
  app.setPath("temp", nativeSmoke.tempRoot);
  app.setAppLogsPath(nativeSmoke.logsRoot);
}

function preferWindowsLocalApplicationData(): void {
  if (process.platform !== "win32") {
    return;
  }
  const localAppData = String(process.env.LOCALAPPDATA || "");
  if (
    !localAppData
    || localAppData.trim() !== localAppData
    || !path.win32.isAbsolute(localAppData)
    || /[\u0000-\u001f\u007f]/u.test(localAppData)
  ) {
    throw new Error("Windows LocalAppData 경로를 안전하게 확인하지 못했습니다.");
  }
  const userDataRoot = path.win32.join(localAppData, APP_NAME);
  mkdirSync(userDataRoot, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(userDataRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Windows Kirinuki 데이터 경로가 안전한 디렉터리가 아닙니다.");
  }
  app.setPath("userData", userDataRoot);
}

function safeLogMessage(error: unknown): string {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  return message
    .replace(/https?:\/\/\S+/gu, "[remote-url]")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 2_000);
}

function logEvent(event: string, error?: unknown): void {
  const detail = error === undefined ? "" : ` · ${safeLogMessage(error)}`;
  console.error(`[Kirinuki] ${event}${detail}`);
}

function launchCommandFromArgv(
  argv: readonly unknown[]
): Readonly<LocalMediaEngineLaunchCommand> | null {
  try {
    return extractLocalMediaEngineLaunchCommandFromArgv(argv);
  } catch (error) {
    logEvent("engine-launch-url-rejected", error);
    return null;
  }
}

function argvContainsEngineUrl(argv: readonly unknown[]): boolean {
  return argv.some((value) => (
    typeof value === "string"
    && new RegExp(`^${LOCAL_MEDIA_ENGINE_PAIRING_SCHEME}:`, "iu").test(
      value.trim()
    )
  ));
}

function drainPairingRequests(): void {
  if (pairingDrain || !deviceIdentity || !runtime || terminationRequested) {
    return;
  }
  const identity = deviceIdentity;
  const activeRuntime = runtime;
  pairingDrain = (async () => {
    while (!terminationRequested) {
      const request = pendingPairingRequests.shift();
      if (!request) {
        break;
      }
      try {
        const response = await desktopPairingResponse({
          identity,
          request,
          engineVersion: app.getVersion()
        });
        await activeRuntime.publishPairingResponse(response);
      } catch (error) {
        logEvent("pairing-response-publish-failed", error);
      } finally {
        pendingPairingStates.delete(request.state);
      }
    }
  })().finally(() => {
    pairingDrain = null;
    if (pendingPairingRequests.length > 0) {
      drainPairingRequests();
    }
  });
  void pairingDrain.catch(() => undefined);
}

function enqueuePairingRequest(
  request: Readonly<LocalMediaEnginePairingRequest>
): void {
  if (
    terminationRequested
    || pendingPairingStates.has(request.state)
    || pendingPairingRequests.length >= 8
  ) {
    return;
  }
  pendingPairingStates.add(request.state);
  pendingPairingRequests.push({
    state: request.state,
    challenge: request.challenge
  });
  drainPairingRequests();
}

function createCutWindowSession(generation: number) {
  const partition = createCutWindowPartitionName(
    generation,
    randomBytes(16).toString("hex")
  );
  const cutSession = session.fromPartition(partition, { cache: false });
  cutSession.setPermissionCheckHandler(() => false);
  cutSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  cutSession.setDevicePermissionHandler(() => false);
  cutSession.on("will-download", (event) => {
    event.preventDefault();
  });
  return cutSession;
}

function destroyCutWindowForSecurity(
  window: BrowserWindow,
  event: string
): void {
  if (!window.isDestroyed()) {
    logEvent(event);
    window.destroy();
  }
}

function beginCutWindowDocumentGeneration(
  window: BrowserWindow,
  windowGeneration: number
): number {
  const state = cutWindowPlayerActions;
  if (
    cutWindow !== window
    || cutWindowGeneration !== windowGeneration
    || !state
    || state.windowGeneration !== windowGeneration
  ) {
    throw new Error("컷 창 문서 세대를 갱신할 수 없습니다.");
  }
  const pendingHandoff = cutWindowHandoff;
  if (pendingHandoff?.generation === windowGeneration) {
    pendingHandoff.abortController.abort();
    const settlement = settleCutWindowHandoffBeforeDocumentReset({
      status: () => pendingHandoff.activeRuntime.editorHandoffStatus(
        pendingHandoff.handoffNonce
      ),
      cancel: () => pendingHandoff.activeRuntime.cancelEditorHandoff(
        pendingHandoff.handoffNonce,
        pendingHandoff.handoffGeneration
      ),
      destroyAcknowledged: () => destroyAcknowledgedCutWindow({
        isDestroyed: () => window.isDestroyed(),
        destroy: () => window.destroy()
      })
    });
    if (settlement === "acknowledged") {
      state.handoffLaunchUsed = true;
      return state.documentGeneration;
    }
    cutWindowHandoff = null;
  }
  state.documentGeneration += 1;
  state.documentReady = false;
  state.documentNonce = null;
  state.handoffLaunchUsed = false;
  state.lastExternalSourceOpenAt = 0;
  state.frameEpoch = 0;
  state.transportEpoch = 0;
  state.bridgeGeneration = 0;
  state.requests.clear();
  return state.documentGeneration;
}

async function openCutWindow(): Promise<BrowserWindow> {
  cutWindowRequested = true;
  if (cutWindow && !cutWindow.isDestroyed()) {
    if (cutWindow.isMinimized()) {
      cutWindow.restore();
    }
    cutWindow.show();
    cutWindow.focus();
    return cutWindow;
  }
  if (cutWindowOpening) {
    return cutWindowOpening;
  }
  cutWindowOpening = (async () => {
    if (terminationRequested || !runtime) {
      throw new Error("컷 창을 열 로컬 엔진이 준비되지 않았습니다.");
    }
    const generation = cutWindowGeneration + 1;
    cutWindowGeneration = generation;
    const cutSession = createCutWindowSession(generation);
    const shortcutGuards = new WeakMap<WebFrameMain, Readonly<{
      url: string;
      documentGeneration: number;
      frameEpoch: number;
    }>>();
    let sessionCleaned = false;
    const cleanupSession = (): void => {
      if (sessionCleaned) {
        return;
      }
      sessionCleaned = true;
      const cleanup = Promise.allSettled([
        cutSession.clearStorageData(),
        cutSession.clearCache()
      ]).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          logEvent("cut-window-session-cleanup-failed");
        }
      });
      cutSessionCleanupPromises.add(cleanup);
      void cleanup.finally(() => cutSessionCleanupPromises.delete(cleanup));
    };
    let window: BrowserWindow;
    try {
      window = new BrowserWindow({
        width: 1480,
        height: 960,
        minWidth: 1120,
        minHeight: 720,
        show: false,
        backgroundColor: "#0d1117",
        title: "Kirinuki · 컷 선택",
        autoHideMenuBar: true,
        webPreferences: {
          session: cutSession,
          preload: path.join(app.getAppPath(), "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          spellcheck: false
        }
      });
    } catch (error) {
      cleanupSession();
      throw error;
    }
    cutWindow = window;
    cutWindowPlayerActions = {
      windowGeneration: generation,
      documentGeneration: 0,
      documentReady: false,
      documentNonce: null,
      handoffLaunchUsed: false,
      lastExternalSourceOpenAt: 0,
      frameEpoch: 0,
      transportEpoch: 0,
      bridgeGeneration: 0,
      queued: 0,
      tail: Promise.resolve(),
      requests: new Map()
    };
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
      destroyCutWindowForSecurity(window, "cut-window-webview-rejected");
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (shouldRejectCutWindowNavigation({
        url,
        expectedUrl: CUT_WINDOW_URL,
        isMainFrame: true
      })) {
        event.preventDefault();
        destroyCutWindowForSecurity(window, "cut-window-navigation-rejected");
      }
    });
    window.webContents.on("will-frame-navigate", (details) => {
      const frame = details.frame;
      if (frame) {
        shortcutGuards.delete(frame);
      }
      if (shouldRejectDirectCutFrameNavigation({
        url: details.url,
        expectedMainUrl: CUT_WINDOW_URL,
        isMainFrame: details.isMainFrame,
        isDirectChild: Boolean(
          frame && frame.parent === window.webContents.mainFrame
        )
      })) {
        details.preventDefault();
        destroyCutWindowForSecurity(window, "cut-window-frame-navigation-rejected");
      }
    });
    window.webContents.on("did-start-navigation", (details) => {
      if (
        details.isMainFrame
        && !details.isSameDocument
        && details.url === CUT_WINDOW_URL
      ) {
        beginCutWindowDocumentGeneration(window, generation);
      }
    });
    window.webContents.on("will-redirect", (
      event,
      url,
      _isInPlace,
      isMainFrame
    ) => {
      if (shouldRejectCutWindowNavigation({
        url,
        expectedUrl: CUT_WINDOW_URL,
        isMainFrame
      })) {
        event.preventDefault();
        destroyCutWindowForSecurity(window, "cut-window-redirect-rejected");
      }
    });
    window.webContents.on("did-navigate", (_event, url) => {
      if (shouldRejectCutWindowNavigation({
        url,
        expectedUrl: CUT_WINDOW_URL,
        isMainFrame: true
      })) {
        destroyCutWindowForSecurity(window, "cut-window-commit-rejected");
        return;
      }
      const state = cutWindowPlayerActions;
      if (
        cutWindow === window
        && cutWindowGeneration === generation
        && state?.windowGeneration === generation
        && state.documentGeneration > 0
      ) {
        state.documentReady = true;
      }
    });
    window.webContents.on("did-frame-navigate", (
      _event,
      url,
      _httpResponseCode,
      _httpStatusText,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      const frame = window.webContents.mainFrame.framesInSubtree.find(
        (candidate) => candidate.processId === frameProcessId
          && candidate.routingId === frameRoutingId
      );
      if (shouldRejectDirectCutFrameNavigation({
        url,
        expectedMainUrl: CUT_WINDOW_URL,
        isMainFrame,
        isDirectChild: Boolean(
          frame && frame.parent === window.webContents.mainFrame
        )
      })) {
        destroyCutWindowForSecurity(window, "cut-window-frame-commit-rejected");
        return;
      }
      const identity = exactStreamingFrameIdentity(url);
      const state = cutWindowPlayerActions;
      if (
        !isMainFrame
        && frame
        && frame.parent === window.webContents.mainFrame
        && identity
        && state?.windowGeneration === generation
        && state.documentGeneration > 0
      ) {
        if (!Number.isSafeInteger(state.frameEpoch + 1)) {
          destroyCutWindowForSecurity(window, "cut-window-frame-epoch-exhausted");
          return;
        }
        state.frameEpoch += 1;
        state.requests.clear();
        const frameUrl = frame.url;
        const documentGeneration = state.documentGeneration;
        const frameEpoch = state.frameEpoch;
        const guardSource = __KIRINUKI_STREAMING_SHORTCUT_GUARD_SOURCE__;
        shortcutGuards.delete(frame);
        if (!guardSource || guardSource.length > 64 * 1024) {
          logEvent("cut-window-shortcut-guard-source-invalid");
          return;
        }
        const code = `"use strict";${guardSource}\n;KirinukiStreamingShortcutGuard.installKirinukiCutShortcutGuard(globalThis)`;
        void frame.executeJavaScript(code, false).then((value: unknown) => {
          if (
            !value
            || typeof value !== "object"
            || Array.isArray(value)
            || Object.keys(value).sort().join(",") !== "marker,status"
            || (value as Record<string, unknown>).status !== "installed"
            || (value as Record<string, unknown>).marker
              !== "kirinuki-cut-shortcut-guard/v1"
            || cutWindow !== window
            || cutWindowGeneration !== generation
            || window.isDestroyed()
            || cutWindowPlayerActions !== state
            || state.documentGeneration !== documentGeneration
            || state.frameEpoch !== frameEpoch
            || frame.url !== frameUrl
            || exactStreamingFrameIdentity(frame.url)?.platform
              !== identity.platform
            || exactStreamingFrameIdentity(frame.url)?.contentId
              !== identity.contentId
          ) {
            shortcutGuards.delete(frame);
            logEvent("cut-window-shortcut-guard-install-rejected");
            return;
          }
          shortcutGuards.set(frame, Object.freeze({
            url: frameUrl,
            documentGeneration,
            frameEpoch
          }));
        }).catch((error: unknown) => {
          shortcutGuards.delete(frame);
          logEvent("cut-window-shortcut-guard-install-failed", error);
        });
      }
    });
    window.webContents.on("did-navigate-in-page", (
      _event,
      url,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      const frame = window.webContents.mainFrame.framesInSubtree.find(
        (candidate) => candidate.processId === frameProcessId
          && candidate.routingId === frameRoutingId
      );
      if (shouldRejectDirectCutFrameNavigation({
        url,
        expectedMainUrl: CUT_WINDOW_URL,
        isMainFrame,
        isDirectChild: Boolean(
          frame && frame.parent === window.webContents.mainFrame
        )
      })) {
        destroyCutWindowForSecurity(window, "cut-window-commit-rejected");
        return;
      }
      const state = cutWindowPlayerActions;
      if (
        !isMainFrame
        && frame
        && frame.parent === window.webContents.mainFrame
        && exactStreamingFrameIdentity(url)
        && state?.windowGeneration === generation
      ) {
        if (!Number.isSafeInteger(state.frameEpoch + 1)) {
          destroyCutWindowForSecurity(window, "cut-window-frame-epoch-exhausted");
          return;
        }
        state.frameEpoch += 1;
        state.requests.clear();
        const existingGuard = shortcutGuards.get(frame);
        if (
          existingGuard?.url === frame.url
          && existingGuard.documentGeneration === state.documentGeneration
        ) {
          shortcutGuards.set(frame, Object.freeze({
            ...existingGuard,
            frameEpoch: state.frameEpoch
          }));
        }
      }
    });
    window.webContents.on("before-input-event", (_event, input) => {
      const focusedFrame = window.webContents.focusedFrame;
      const key = trustedCutShortcutKey({
        input,
        focusedFrameUrl: focusedFrame?.url,
        mainFrameFocused: !focusedFrame
          || focusedFrame === window.webContents.mainFrame
      });
      if (!key) {
        return;
      }
      const identity = exactStreamingFrameIdentity(focusedFrame?.url);
      const actionState = cutWindowPlayerActions;
      const guard = focusedFrame ? shortcutGuards.get(focusedFrame) : undefined;
      if (
        !focusedFrame
        || focusedFrame.parent !== window.webContents.mainFrame
        || !identity
        || !actionState
        || actionState.windowGeneration !== generation
        || actionState.documentGeneration <= 0
        || actionState.documentReady !== true
        || actionState.transportEpoch <= 0
        || actionState.bridgeGeneration <= 0
        || !guard
        || guard.url !== focusedFrame.url
        || guard.documentGeneration !== actionState.documentGeneration
        || guard.frameEpoch !== actionState.frameEpoch
      ) {
        return;
      }
      const frameUrl = focusedFrame.url;
      const transportEpoch = actionState.transportEpoch;
      const bridgeGeneration = actionState.bridgeGeneration;
      const documentGeneration = actionState.documentGeneration;
      let timer: ReturnType<typeof setTimeout> | null = null;
      void Promise.race([
        focusedFrame.executeJavaScript(CUT_WINDOW_EDITABLE_PROBE_SOURCE, false),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new DOMException(
            "focused frame editable probe timed out",
            "TimeoutError"
          )), CUT_WINDOW_EDITABLE_PROBE_TIMEOUT_MS);
        })
      ]).then((editable) => {
        const currentFocusedFrame = window.webContents.focusedFrame;
        const currentIdentity = exactStreamingFrameIdentity(
          currentFocusedFrame?.url
        );
        if (
          editable !== false
          || cutWindow !== window
          || cutWindowGeneration !== generation
          || window.isDestroyed()
          || currentFocusedFrame !== focusedFrame
          || focusedFrame.url !== frameUrl
          || currentIdentity?.platform !== identity.platform
          || currentIdentity.contentId !== identity.contentId
          || cutWindowPlayerActions !== actionState
          || actionState.documentGeneration !== documentGeneration
          || actionState.transportEpoch !== transportEpoch
          || actionState.bridgeGeneration !== bridgeGeneration
        ) {
          return;
        }
        window.webContents.send(CUT_WINDOW_SHORTCUT_CHANNEL, Object.freeze({
          key,
          platform: identity.platform,
          contentId: identity.contentId,
          windowGeneration: generation,
          documentGeneration,
          transportEpoch,
          bridgeGeneration
        }));
      }).catch(() => undefined).finally(() => {
        if (timer !== null) {
          clearTimeout(timer);
        }
      });
    });
    window.webContents.on("render-process-gone", () => {
      destroyCutWindowForSecurity(window, "cut-window-renderer-gone");
    });
    window.once("ready-to-show", () => {
      if (
        cutWindow === window
        && cutWindowGeneration === generation
        && !window.isDestroyed()
      ) {
        window.show();
        window.focus();
      }
    });
    window.once("closed", () => {
      cleanupSession();
      const pendingHandoff = cutWindowHandoff;
      if (pendingHandoff?.generation === generation) {
        pendingHandoff.abortController.abort();
        pendingHandoff.activeRuntime.cancelEditorHandoff(
          pendingHandoff.handoffNonce,
          pendingHandoff.handoffGeneration
        );
        cutWindowHandoff = null;
      }
      if (cutWindow === window && cutWindowGeneration === generation) {
        cutWindow = null;
      }
      if (cutWindowPlayerActions?.windowGeneration === generation) {
        cutWindowPlayerActions.requests.clear();
        cutWindowPlayerActions = null;
      }
    });
    try {
      await loadExactCutWindowDocumentFailClosed({
        load: async () => {
          await window.loadURL(CUT_WINDOW_URL);
        },
        currentUrl: () => (
          cutWindow === window && cutWindowGeneration === generation
            ? window.webContents.getURL()
            : ""
        ),
        expectedUrl: CUT_WINDOW_URL,
        isDestroyed: () => window.isDestroyed(),
        destroy: () => destroyCutWindowForSecurity(
          window,
          "cut-window-load-failed"
        )
      });
      return window;
    } catch (error) {
      cleanupSession();
      throw error;
    }
  })().finally(() => {
    cutWindowOpening = null;
  });
  return cutWindowOpening;
}

function requestCutWindow(): void {
  cutWindowRequested = true;
  if (!app.isReady() || !runtime || terminationRequested) {
    return;
  }
  void openCutWindow().catch((error) => {
    logEvent("cut-window-open-failed", error);
  });
}

function editorHandoffUrl(handoffNonce: string): string {
  const target = new URL(CUT_WINDOW_URL);
  target.search = "";
  target.hash = `${EDITOR_HANDOFF_FRAGMENT_KEY}=${handoffNonce}`;
  return target.href;
}

async function waitForEditorHandoffAcknowledgement(
  activeRuntime: Readonly<DesktopRuntimeSupervisor>,
  handoffNonce: string,
  signal: AbortSignal
): Promise<void> {
  const deadline = Date.now() + EDITOR_HANDOFF_TTL_MS;
  while (!terminationRequested && !signal.aborted && Date.now() < deadline) {
    const status = activeRuntime.editorHandoffStatus(handoffNonce);
    if (status === "acknowledged") {
      return;
    }
    if (status === "absent") {
      throw new Error("편집기 인계가 만료되었거나 취소되었습니다.");
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException("컷 창이 닫혀 인계 대기를 중단했습니다.", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, CUT_WINDOW_ACK_POLL_MS);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  if (signal.aborted) {
    throw new DOMException("컷 창이 닫혀 인계 대기를 중단했습니다.", "AbortError");
  }
  throw new Error("일반 브라우저가 편집기 인계를 완료하지 못했습니다.");
}

function soopBridgeFailureResponse(
  request: Readonly<StreamingBridgeRequest>,
  code: string,
  message: string
): Readonly<StreamingBridgeResponse> {
  return Object.freeze({
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: request.requestId,
    generation: request.generation,
    action: request.action,
    source: request.source,
    ok: false,
    error: Object.freeze({ code, message })
  });
}

function streamingFrameActionInputLiteral(
  request: Readonly<StreamingBridgeRequest>
): string {
  if (request.action === "snapshot") {
    return '{"action":"snapshot"}';
  }
  if (request.action === "seek-absolute") {
    return `{"action":"seek-absolute","targetSeconds":${
      JSON.stringify(request.targetSeconds)
    }}`;
  }
  return `{"action":"set-playback-rate","playbackRate":${
    JSON.stringify(request.playbackRate)
  }}`;
}

function requestedStreamingFrameIdentity(
  request: Readonly<StreamingBridgeRequest>
): Readonly<{ platform: "CHZZK" | "YOUTUBE" | "SOOP"; contentId: string }> | null {
  const patterns = {
    CHZZK: /^chzzk:vod:(\d{1,32})$/u,
    YOUTUBE: /^youtube:vod:([A-Za-z0-9_-]{11})$/u,
    SOOP: /^soop:vod:(\d{1,32})$/u
  } as const;
  const contentId = patterns[request.source.platform].exec(
    request.source.sessionId
  )?.[1];
  return contentId
    ? Object.freeze({ platform: request.source.platform, contentId })
    : null;
}

async function executeStreamingFrameAction(
  request: Readonly<StreamingBridgeRequest>,
  window: BrowserWindow,
  windowGeneration: number,
  documentGeneration: number,
  transportEpoch: number,
  frameEpoch: number
): Promise<Readonly<StreamingBridgeResponse>> {
  const expected = requestedStreamingFrameIdentity(request);
  if (!expected) {
    return soopBridgeFailureResponse(
      request,
      "source-mismatch",
      "원본 플레이어 회차를 확인하지 못했습니다."
    );
  }
  if (cutWindowPlayerActions?.frameEpoch !== frameEpoch) {
    return soopBridgeFailureResponse(
      request,
      "stale-generation",
      "원본 플레이어 frame 세대가 바뀌었습니다."
    );
  }
  const frames = window.webContents.mainFrame.framesInSubtree.filter((frame) => (
    frame !== window.webContents.mainFrame
    && frame.parent === window.webContents.mainFrame
    && exactStreamingFrameIdentity(frame.url)?.platform === expected.platform
    && exactStreamingFrameIdentity(frame.url)?.contentId === expected.contentId
  ));
  if (frames.length !== 1 || !frames[0]) {
    return soopBridgeFailureResponse(
      request,
      "source-unavailable",
      "현재 원본 플레이어 frame을 하나로 확인하지 못했습니다."
    );
  }
  const frame = frames[0];
  const beforeUrl = frame.url;
  const actionSource = __KIRINUKI_STREAMING_FRAME_ACTION_SOURCE__;
  if (!actionSource || actionSource.length > 256 * 1024) {
    return soopBridgeFailureResponse(
      request,
      "action-failed",
      "원본 플레이어 동작 코드를 확인하지 못했습니다."
    );
  }
  const code = `"use strict";${actionSource}\n;KirinukiStreamingFrameAction.executeKirinukiStreamingFrameAction(${
    streamingFrameActionInputLiteral(request)
  })`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let value: unknown;
  try {
    value = await Promise.race([
      frame.executeJavaScript(code, false),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DOMException(
          "원본 플레이어 동작 시간이 초과되었습니다.",
          "TimeoutError"
        )), CUT_WINDOW_PLAYER_ACTION_TIMEOUT_MS);
      })
    ]);
  } catch {
    return soopBridgeFailureResponse(
      request,
      "player-state-transient",
      "원본 플레이어 상태가 전환되는 중입니다."
    );
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
  if (
    cutWindow !== window
    || cutWindowGeneration !== windowGeneration
    || window.isDestroyed()
    || cutWindowPlayerActions?.windowGeneration !== windowGeneration
    || cutWindowPlayerActions.documentGeneration !== documentGeneration
    || cutWindowPlayerActions.transportEpoch !== transportEpoch
    || cutWindowPlayerActions.frameEpoch !== frameEpoch
    || cutWindowPlayerActions.bridgeGeneration !== request.generation
    || frame.url !== beforeUrl
    || exactStreamingFrameIdentity(frame.url)?.platform !== expected.platform
    || exactStreamingFrameIdentity(frame.url)?.contentId !== expected.contentId
    || !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return soopBridgeFailureResponse(
      request,
      "stale-generation",
      "플레이어 동작 중 원본 또는 컷 창이 바뀌었습니다."
    );
  }
  const record = value as Record<string, unknown>;
  let responseBytes = Number.POSITIVE_INFINITY;
  try {
    responseBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  } catch {
    // The strict response checks below return one generic failure.
  }
  if (
    Object.keys(record).sort().join(",") !== "contentId,platform,player,schema"
    || record.schema !== "kirinuki-electron-frame-action/v1"
    || record.platform !== expected.platform
    || record.contentId !== expected.contentId
    || responseBytes > CUT_WINDOW_PLAYER_FRAME_RESPONSE_BYTES
  ) {
    return soopBridgeFailureResponse(
      request,
      "player-state-transient",
      "원본 플레이어 응답을 검증하지 못했습니다."
    );
  }
  const parsed = parseStreamingBridgeResponse({
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: request.requestId,
    generation: request.generation,
    action: request.action,
    source: request.source,
    ok: true,
    player: record.player
  });
  return parsed?.ok
    ? parsed
    : soopBridgeFailureResponse(
      request,
      "player-state-transient",
      "원본 플레이어 시계를 검증하지 못했습니다."
    );
}

async function handleStreamingPlayerAction(
  value: unknown,
  window: BrowserWindow,
  windowGeneration: number
): Promise<Readonly<StreamingBridgeResponse>> {
  const envelope = normalizeCutWindowPlayerActionEnvelope(value);
  const state = cutWindowPlayerActions;
  if (
    !envelope
    || envelope.type !== "request"
    || !state
    || state.windowGeneration !== windowGeneration
    || envelope.documentGeneration !== state.documentGeneration
  ) {
    throw new Error("허용되지 않은 원본 플레이어 동작 요청입니다.");
  }
  const request = envelope.request;
  if (envelope.transportEpoch < state.transportEpoch) {
    return soopBridgeFailureResponse(
      request,
      "stale-generation",
      "오래된 원본 플레이어 세대의 동작을 실행하지 않았습니다."
    );
  }
  if (envelope.transportEpoch > state.transportEpoch) {
    state.transportEpoch = envelope.transportEpoch;
    state.bridgeGeneration = 0;
    state.requests.clear();
  }
  if (request.generation < state.bridgeGeneration) {
    return soopBridgeFailureResponse(
      request,
      "stale-generation",
      "오래된 원본 플레이어 동작을 실행하지 않았습니다."
    );
  }
  if (request.generation > state.bridgeGeneration) {
    state.bridgeGeneration = request.generation;
    state.requests.clear();
  }
  const fingerprint = JSON.stringify(request);
  const frameEpoch = state.frameEpoch;
  const existing = state.requests.get(request.requestId);
  if (existing) {
    return existing.fingerprint === fingerprint
      ? existing.promise
      : soopBridgeFailureResponse(
        request,
        "action-failed",
        "중복된 원본 플레이어 요청 ID를 거절했습니다."
      );
  }
  if (state.queued >= CUT_WINDOW_PLAYER_MAXIMUM_QUEUED_ACTIONS) {
    return soopBridgeFailureResponse(
      request,
      "bridge-busy",
      "원본 플레이어 동작이 너무 많이 대기 중입니다."
    );
  }
  state.queued += 1;
  const promise = state.tail.then(async () => {
    if (
      cutWindowPlayerActions !== state
      || state.documentGeneration !== envelope.documentGeneration
      || state.transportEpoch !== envelope.transportEpoch
      || state.bridgeGeneration !== request.generation
      || state.frameEpoch !== frameEpoch
    ) {
      return soopBridgeFailureResponse(
        request,
        "stale-generation",
        "대기 중 원본이 바뀐 플레이어 동작을 실행하지 않았습니다."
      );
    }
    return executeStreamingFrameAction(
      request,
      window,
      windowGeneration,
      envelope.documentGeneration,
      envelope.transportEpoch,
      frameEpoch
    );
  }).catch(() => soopBridgeFailureResponse(
    request,
    "action-failed",
    "원본 플레이어 동작을 완료하지 못했습니다."
  )).finally(() => {
    state.queued -= 1;
  });
  state.tail = promise.then(() => undefined, () => undefined);
  state.requests.set(request.requestId, Object.freeze({
    fingerprint,
    promise
  }));
  if (state.requests.size > CUT_WINDOW_PLAYER_MAXIMUM_REQUESTS) {
    const oldest = state.requests.keys().next().value;
    if (typeof oldest === "string") {
      state.requests.delete(oldest);
    }
  }
  return promise;
}

function installCutWindowIpcHandler(): void {
  ipcMain.handle(CUT_WINDOW_BIND_DOCUMENT_CHANNEL, (event, value) => {
    const window = cutWindow;
    const state = cutWindowPlayerActions;
    if (
      !window
      || window.isDestroyed()
      || !state
      || !state.documentReady
      || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame
      || !isExactCutWindowUrl(event.senderFrame.url)
      || !isExactCutWindowUrl(window.webContents.getURL())
      || typeof value !== "string"
      || !CUT_WINDOW_DOCUMENT_NONCE_PATTERN.test(value)
      || (state.documentNonce !== null && state.documentNonce !== value)
    ) {
      throw new Error("허용되지 않은 컷 문서 binding 요청입니다.");
    }
    state.documentNonce = value;
    return Object.freeze({
      status: "bound" as const,
      windowGeneration: state.windowGeneration,
      documentGeneration: state.documentGeneration
    });
  });
  ipcMain.handle(CUT_WINDOW_HANDOFF_CHANNEL, async (
    event,
    value,
    documentNonce
  ) => {
    const window = cutWindow;
    const activeRuntime = runtime;
    const generation = cutWindowGeneration;
    const state = cutWindowPlayerActions;
    const documentGeneration = state?.documentGeneration ?? 0;
    if (
      !window
      || window.isDestroyed()
      || !activeRuntime
      || !state
      || documentGeneration <= 0
      || !state.documentReady
      || state.documentNonce !== documentNonce
      || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame
      || !isExactCutWindowUrl(event.senderFrame.url)
      || !isExactCutWindowUrl(window.webContents.getURL())
    ) {
      throw new Error("허용되지 않은 컷 창의 편집기 인계 요청입니다.");
    }
    if (cutWindowHandoff?.generation === generation) {
      throw new Error("이미 일반 브라우저로 편집기를 여는 중입니다.");
    }
    if (state.handoffLaunchUsed) {
      throw new Error("이 컷 문서에서는 편집기 인계를 이미 요청했습니다.");
    }
    const submission = normalizeEditorHandoffSubmission(value);
    const abortController = new AbortController();
    const published = activeRuntime.publishEditorHandoff(submission);
    state.handoffLaunchUsed = true;
    const handoffOperation = async () => {
      try {
        abortController.signal.throwIfAborted();
        if (
          cutWindowPlayerActions?.windowGeneration !== generation
          || cutWindowPlayerActions.documentGeneration !== documentGeneration
        ) {
          throw new DOMException("컷 문서가 바뀌어 인계를 중단했습니다.", "AbortError");
        }
        await shell.openExternal(editorHandoffUrl(published.handoffNonce));
        abortController.signal.throwIfAborted();
        await waitForEditorHandoffAcknowledgement(
          activeRuntime,
          published.handoffNonce,
          abortController.signal
        );
        if (
          cutWindow === window
          && cutWindowGeneration === generation
          && cutWindowPlayerActions?.documentGeneration === documentGeneration
          && !window.isDestroyed()
          && isExactCutWindowUrl(window.webContents.getURL())
        ) {
          destroyAcknowledgedCutWindow({
            isDestroyed: () => window.isDestroyed(),
            destroy: () => window.destroy()
          });
        }
        return Object.freeze({
          status: "acknowledged" as const,
          handoffGeneration: published.handoffGeneration
        });
      } catch (error) {
        const handoffStatus = activeRuntime.editorHandoffStatus(
          published.handoffNonce
        );
        if (
          handoffStatus !== "acknowledged"
          && cutWindowPlayerActions === state
          && state.documentGeneration === documentGeneration
        ) {
          state.handoffLaunchUsed = false;
        }
        if (handoffStatus !== "acknowledged") {
          activeRuntime.cancelEditorHandoff(
            published.handoffNonce,
            published.handoffGeneration
          );
        }
        throw error;
      }
    };
    // Register the generation-bound nonce before openExternal can yield. If
    // the user closes A while the OS/browser launch is slow, A is cancelled
    // synchronously and can never be claimed as a later B session.
    const promise = Promise.resolve().then(handoffOperation);
    cutWindowHandoff = Object.freeze({
      generation,
      documentGeneration,
      handoffNonce: published.handoffNonce,
      handoffGeneration: published.handoffGeneration,
      activeRuntime,
      abortController,
      promise
    });
    try {
      return await promise;
    } finally {
      if (
        cutWindowHandoff?.generation === generation
        && cutWindowHandoff.promise === promise
      ) {
        cutWindowHandoff = null;
      }
    }
  });
  ipcMain.handle(CUT_WINDOW_PLAYER_ACTION_CHANNEL, async (
    event,
    value,
    documentNonce
  ) => {
    const window = cutWindow;
    const generation = cutWindowGeneration;
    const state = cutWindowPlayerActions;
    if (
      !window
      || window.isDestroyed()
      || event.sender !== window.webContents
      || !state
      || state.documentNonce !== documentNonce
      || state.documentReady !== true
      || event.senderFrame !== window.webContents.mainFrame
      || !isExactCutWindowUrl(event.senderFrame.url)
      || !isExactCutWindowUrl(window.webContents.getURL())
    ) {
      throw new Error("허용되지 않은 컷 창의 원본 플레이어 요청입니다.");
    }
    const envelope = normalizeCutWindowPlayerActionEnvelope(value);
    if (!envelope) {
      throw new Error("원본 플레이어 동작 envelope가 올바르지 않습니다.");
    }
    if (envelope.type === "invalidate") {
      if (state.windowGeneration !== generation) {
        throw new Error("원본 플레이어 세대 상태를 확인하지 못했습니다.");
      }
      if (envelope.transportEpoch > state.transportEpoch) {
        state.transportEpoch = envelope.transportEpoch;
        state.bridgeGeneration = 0;
        state.requests.clear();
      }
      return Object.freeze({
        status: "invalidated" as const,
        transportEpoch: state.transportEpoch,
        documentGeneration: state.documentGeneration
      });
    }
    return handleStreamingPlayerAction(envelope, window, generation);
  });
  ipcMain.handle(CUT_WINDOW_OPEN_SOURCE_CHANNEL, async (
    event,
    value,
    documentNonce
  ) => {
    const window = cutWindow;
    const state = cutWindowPlayerActions;
    if (
      !window
      || window.isDestroyed()
      || event.sender !== window.webContents
      || !state
      || state.documentNonce !== documentNonce
      || state.documentReady !== true
      || event.senderFrame !== window.webContents.mainFrame
      || !isExactCutWindowUrl(event.senderFrame.url)
      || !isExactCutWindowUrl(window.webContents.getURL())
    ) {
      throw new Error("허용되지 않은 컷 창의 원본 페이지 열기 요청입니다.");
    }
    const sourceUrl = exactCutWindowExternalSourceUrl(value);
    if (!sourceUrl) {
      throw new Error("지원하는 현재 VOD의 canonical 원본 주소가 아닙니다.");
    }
    const now = Date.now();
    if (
      now - state.lastExternalSourceOpenAt
        < CUT_WINDOW_EXTERNAL_OPEN_COOLDOWN_MS
    ) {
      throw new Error("원본 페이지 열기 요청이 너무 빠르게 반복되었습니다.");
    }
    state.lastExternalSourceOpenAt = now;
    await shell.openExternal(sourceUrl);
    return Object.freeze({ status: "opened" as const, sourceUrl });
  });
}

function loginItemAdapter(): Readonly<LoginItemAdapter> {
  return Object.freeze({
    set: (settings: Readonly<LoginItemSettings>) => app.setLoginItemSettings({
      openAtLogin: settings.openAtLogin,
      ...(settings.openAsHidden === undefined
        ? {}
        : { openAsHidden: settings.openAsHidden }),
      ...(settings.enabled === undefined ? {} : { enabled: settings.enabled }),
      ...(settings.path === undefined ? {} : { path: settings.path }),
      ...(settings.args === undefined ? {} : { args: [...settings.args] }),
      ...(settings.name === undefined ? {} : { name: settings.name })
    }),
    get: (settings: Readonly<LoginItemSettings>) => {
      const state = app.getLoginItemSettings({
        ...(settings.path === undefined ? {} : {
          path: process.platform === "win32"
            ? windowsLoginItemReadbackPath(settings.path)
            : settings.path
        }),
        ...(settings.args === undefined ? {} : { args: [...settings.args] })
      });
      return Object.freeze({
        openAtLogin: state.openAtLogin,
        executableWillLaunchAtLogin: state.executableWillLaunchAtLogin,
        status: state.status,
        launchItems: Object.freeze((Array.isArray(state.launchItems)
          ? state.launchItems
          : []).map((item) => Object.freeze({
          name: item.name,
          path: item.path,
          args: Object.freeze([...item.args]),
          scope: item.scope,
          enabled: item.enabled
        })))
      });
    }
  });
}

async function registerAutostart(
  nativeSmoke: Readonly<DesktopNativeSmokeContract> | null
): Promise<Readonly<EngineAutostartRegistration> | null> {
  if (!app.isPackaged && !nativeSmoke) {
    return null;
  }
  return ensureEngineAutostart({
    target: runtimePaths.bundleTarget,
    executablePath: process.execPath,
    linuxConfigRoot: app.getPath("appData"),
    loginItem: loginItemAdapter(),
    stateRoot: runtimePaths.appDataRoot,
    ...(nativeSmoke?.autostartMode === "isolated"
      ? { isolatedStateRoot: nativeSmoke.root }
      : {})
  });
}

async function shutdown(): Promise<void> {
  if (approvalMonitor) {
    clearInterval(approvalMonitor);
    approvalMonitor = null;
  }
  shutdownPromise ??= (async () => {
    ipcMain.removeHandler(CUT_WINDOW_HANDOFF_CHANNEL);
    ipcMain.removeHandler(CUT_WINDOW_BIND_DOCUMENT_CHANNEL);
    ipcMain.removeHandler(CUT_WINDOW_PLAYER_ACTION_CHANNEL);
    ipcMain.removeHandler(CUT_WINDOW_OPEN_SOURCE_CHANNEL);
    if (cutWindow && !cutWindow.isDestroyed()) {
      cutWindow.destroy();
    }
    cutWindow = null;
    await Promise.allSettled([...cutSessionCleanupPromises]);
    installedExecutableMonitor?.stop();
    installedExecutableMonitor = null;
    await (runtime?.stop() ?? Promise.resolve());
    if (
      cleanupOwnedInstallation
      || nativeSmoke?.autostartMode === "production"
    ) {
      await removeEngineAutostart({
        target: runtimePaths.bundleTarget,
        executablePath: process.execPath,
        linuxConfigRoot: app.getPath("appData"),
        loginItem: loginItemAdapter(),
        stateRoot: runtimePaths.appDataRoot,
        ...(nativeSmoke?.autostartMode === "isolated"
          ? { isolatedStateRoot: nativeSmoke.root }
          : {})
      });
      autostart = null;
    }
    if (cleanupOwnedInstallation && app.isPackaged) {
      removeDesktopProtocolRegistration({
        application: app,
        scheme: LOCAL_MEDIA_ENGINE_PAIRING_SCHEME,
        isolatedSmoke: nativeSmoke?.autostartMode === "isolated"
      });
    }
  })();
  return shutdownPromise;
}

function beginMacLoginItemApprovalMonitor(
  nativeSmoke: Readonly<DesktopNativeSmokeContract> | null
): void {
  if (
    process.platform !== "darwin"
    || nativeSmoke
    || !autostart?.approvalRequired
    || approvalMonitor
  ) {
    return;
  }
  approvalMonitor = setInterval(() => {
    if (approvalCheckActive || terminationRequested || relaunchRequested) {
      return;
    }
    approvalCheckActive = true;
    void registerAutostart(null).then((next) => {
      autostart = next;
      if (!next || next.approvalRequired || !next.registered) {
        return;
      }
      relaunchRequested = true;
      app.relaunch({
        execPath: process.execPath,
        args: [ENGINE_BACKGROUND_ARGUMENT]
      });
      requestTermination(0);
    }).catch((error) => {
      logEvent("login-item-approval-check-failed", error);
      requestTermination(1);
    }).finally(() => {
      approvalCheckActive = false;
    });
  }, 1_500);
  (approvalMonitor as NodeJS.Timeout).unref?.();
}

function requestTermination(exitCode = 0): void {
  if (terminationRequested) {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return;
  }
  terminationRequested = true;
  process.exitCode = exitCode;
  void shutdown()
    .catch((error) => {
      process.exitCode = 1;
      logEvent("shutdown-failed", error);
    })
    .finally(() => app.exit(currentNumericExitCode()));
}

function currentNumericExitCode(): number {
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

function waitForOwnedPrimaryCleanup(
  identity: ReturnType<typeof engineInstanceIdentity>
): void {
  const deadline = Date.now() + 30_000;
  const timer = setInterval(() => {
    if (Date.now() >= deadline) {
      clearInterval(timer);
      app.exit(23);
      return;
    }
    if (!app.requestSingleInstanceLock(identity)) {
      return;
    }
    clearInterval(timer);
    app.releaseSingleInstanceLock();
    app.exit(0);
  }, 100);
}

function configureNativeSmokeControl(
  nativeSmoke: Readonly<DesktopNativeSmokeContract>
): Readonly<{ signalReady: () => Promise<void> }> {
  if (typeof process.send !== "function" || !process.connected) {
    throw new Error("데스크톱 native smoke IPC 채널이 없습니다.");
  }
  let ready = false;
  let quitRequested = false;
  process.once("disconnect", () => {
    process.exitCode = desktopNativeSmokeDisconnectExitCode({
      quitRequested,
      ownedCleanupRequested: cleanupOwnedInstallation,
      currentExitCode: currentNumericExitCode()
    });
    if (ready) {
      requestTermination(currentNumericExitCode());
    }
  });
  process.on("message", (message) => {
    const valid = isDesktopNativeSmokeQuitMessage(message, nativeSmoke);
    quitRequested = true;
    if (!valid || !ready) {
      process.exitCode = 1;
    }
    if (ready) {
      requestTermination(currentNumericExitCode());
    }
  });
  return Object.freeze({
    signalReady: async () => {
      const send = process.send;
      if (
        quitRequested
        || typeof send !== "function"
        || !process.connected
        || !runtime
        || !autostart
      ) {
        throw new Error("데스크톱 native smoke evidence를 만들지 못했습니다.");
      }
      const readyRuntime = runtime;
      const readyAutostart = autostart;
      const windowCount = webContents.getAllWebContents().length;
      ready = true;
      await new Promise<void>((resolve, reject) => {
        send.call(process, desktopNativeSmokeReadyMessage(nativeSmoke, {
          processCount: app.getAppMetrics().length,
          windowCount,
          gateway: readyRuntime,
          autostart: readyAutostart
        }), (error) => error ? reject(error) : resolve());
      });
    }
  });
}

const nativeSmoke = resolveDesktopNativeSmokeContract();

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
if (nativeSmoke) {
  configureNativeSmokePaths(nativeSmoke);
} else {
  preferWindowsLocalApplicationData();
}
if (process.platform === "linux") {
  app.setDesktopName(`${APP_ID}.desktop`);
}
for (const disabledNetworkFeature of [
  "disable-component-update",
  "disable-domain-reliability",
  "disable-background-networking",
  "disable-sync",
  "no-pings"
]) {
  app.commandLine.appendSwitch(disabledNetworkFeature);
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  try {
    const command = parseLocalMediaEngineLaunchCommand(url);
    if (command.kind === "pair") {
      enqueuePairingRequest(command.pairingRequest);
    } else {
      requestCutWindow();
    }
  } catch (error) {
    logEvent("engine-launch-url-rejected", error);
  }
});

app.on("activate", () => {
  requestCutWindow();
});

runtimePaths = desktopPaths(nativeSmoke);

const initialOwnedUninstallRequest = exactOwnedUninstallRequestFromArgv(
  process.argv
);
const initialLaunchCommand = process.platform === "darwin"
  ? null
  : launchCommandFromArgv(process.argv);
const initialPairingRequest = initialLaunchCommand?.kind === "pair"
  ? initialLaunchCommand.pairingRequest
  : null;
cutWindowRequested = Boolean(
  !nativeSmoke
  && !initialOwnedUninstallRequest
  && (
    initialLaunchCommand?.kind === "cut"
    || (
      !initialLaunchCommand
      && !argvContainsEngineUrl(process.argv)
      && !process.argv.includes(ENGINE_BACKGROUND_ARGUMENT)
    )
  )
);
const instanceIdentity = engineInstanceIdentity({
  platform: process.platform,
  arch: process.arch,
  version: app.getVersion(),
  cleanupOwnedInstallation: initialOwnedUninstallRequest,
  ...(initialPairingRequest ? { pairingRequest: initialPairingRequest } : {})
});
const primaryInstance = app.requestSingleInstanceLock(instanceIdentity);
if (!primaryInstance) {
  if (initialOwnedUninstallRequest) {
    // The first lock attempt already delivered the exact cleanup command to
    // the primary. Keep this installer-owned secondary alive until the lock is
    // independently released, so NSIS cannot delete files under a live engine.
    waitForOwnedPrimaryCleanup(instanceIdentity);
  } else {
    app.exit(0);
  }
} else {
  installCutWindowIpcHandler();
  cleanupOwnedInstallation = initialOwnedUninstallRequest;
  if (initialPairingRequest) {
    enqueuePairingRequest(initialPairingRequest);
  }
  const nativeSmokeControl = nativeSmoke && !cleanupOwnedInstallation
    ? configureNativeSmokeControl(nativeSmoke)
    : null;

  app.on("before-quit", (event) => {
    if (terminationRequested) {
      return;
    }
    event.preventDefault();
    requestTermination(0);
  });

  app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
    if (relaunchRequested) {
      return;
    }
    const decision = decideEngineInstanceHandoff({
      current: instanceIdentity,
      incoming: additionalData
    });
    if (decision === "cleanup-owned-installation") {
      cleanupOwnedInstallation = true;
      requestTermination(0);
      return;
    }
    if (decision !== "relaunch-newer-installed-version") {
      const launchCommand = launchCommandFromArgv(argv);
      const pairingRequest = engineInstancePairingRequest(additionalData)
        ?? (
          launchCommand?.kind === "pair"
            ? launchCommand.pairingRequest
            : null
        );
      if (pairingRequest) {
        enqueuePairingRequest(pairingRequest);
      } else {
        if (
          launchCommand?.kind === "cut"
          || (
            !nativeSmoke
            && !launchCommand
            && !argvContainsEngineUrl(argv)
            && !argv.includes(ENGINE_BACKGROUND_ARGUMENT)
          )
        ) {
          requestCutWindow();
        }
      }
      return;
    }
    // The installer uses one stable executable path. After it replaces the
    // files, the currently running older process restarts that exact path only;
    // untrusted secondary-instance data is never used as an executable path.
    relaunchRequested = true;
    app.relaunch({
      execPath: process.execPath,
      args: [ENGINE_BACKGROUND_ARGUMENT]
    });
    requestTermination(0);
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    powerMonitor.on("shutdown", () => {
      requestTermination(0);
    });
    if (cleanupOwnedInstallation) {
      requestTermination(0);
      return;
    }
    if (app.isPackaged) {
      ensureDesktopProtocolRegistration({
        application: app,
        scheme: LOCAL_MEDIA_ENGINE_PAIRING_SCHEME,
        isolatedSmoke: nativeSmoke?.autostartMode === "isolated"
      });
    }
    const appRoot = app.isPackaged
      ? app.getAppPath()
      : developmentRepositoryRoot();
    const identityProtector = await createDesktopDeviceIdentityProtector({
      safeStorage,
      platform: process.platform,
      requireProtectedLinuxBackend: app.isPackaged && !nativeSmoke
    });
    deviceIdentity = await loadOrCreateDesktopDeviceIdentity({
      stateRoot: runtimePaths.appDataRoot,
      platform: runtimePaths.platform,
      protector: identityProtector
    });
    autostart = await registerAutostart(nativeSmoke);
    const startedRuntime = await startDesktopRuntimeSupervisor({
      appRoot,
      backgroundStart: autostart?.approvalRequired
        ? "requires-approval"
        : "ready",
      engineVersion: app.getVersion(),
      deviceIdentity,
      paths: runtimePaths,
      nodeBinary: process.execPath
    });
    runtime = startedRuntime;
    if (cutWindowRequested) {
      await openCutWindow();
    }
    if (app.isPackaged) {
      installedExecutableMonitor = await monitorInstalledExecutable({
        executablePath: process.execPath,
        onInstallChanged: (reason) => {
          if (terminationRequested) {
            return;
          }
          if (reason === "replaced") {
            relaunchRequested = true;
            app.relaunch({
              execPath: process.execPath,
              args: [ENGINE_BACKGROUND_ARGUMENT]
            });
          } else {
            cleanupOwnedInstallation = true;
          }
          requestTermination(0);
        }
      });
    }
    drainPairingRequests();
    void startedRuntime.terminalFailure.then((failure) => {
      if (
        !failure
        || runtime !== startedRuntime
        || terminationRequested
        || relaunchRequested
      ) {
        return;
      }
      logEvent("runtime-recovery-circuit-open", failure);
      requestTermination(1);
    });
    if (nativeSmoke) {
      await nativeSmokeControl?.signalReady();
      logEvent("native-smoke-ready");
    }
    beginMacLoginItemApprovalMonitor(nativeSmoke);
  }).catch((error) => {
    logEvent("startup-failed", error);
    requestTermination(1);
  });
}

process.once("SIGINT", () => requestTermination(0));
process.once("SIGTERM", () => requestTermination(0));
