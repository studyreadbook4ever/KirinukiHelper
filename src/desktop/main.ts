import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  session,
  shell
} from "electron";

import {
  extractKirinukiDeepLinkFromArgv,
  parseKirinukiDeepLink
} from "../lib/kirinuki-deep-link.js";
import type { KirinukiDeepLinkRequest } from "../lib/kirinuki-deep-link.js";
import { KIRINUKI_LOCAL_STUDIO_ORIGIN } from "../lib/local-runtime-origin.js";
import {
  resolveDesktopApplicationRuntimePaths
} from "./runtime-spec.js";
import type { DesktopRuntimePaths } from "./runtime-spec.js";
import {
  desktopNativeSmokeReadyMessage,
  isDesktopNativeSmokeQuitMessage,
  resolveDesktopNativeSmokeContract
} from "./native-smoke-contract.js";
import type {
  DesktopNativeSmokeContract
} from "./native-smoke-contract.js";
import { preparePrivateDirectories } from "./private-directory.js";
import {
  startDesktopRuntimeSupervisor
} from "./runtime-supervisor.js";
import type { DesktopRuntimeSupervisor } from "./runtime-supervisor.js";
import {
  allowedExternalNavigationUrl,
  desktopStudioUrl,
  isAllowedDesktopFileSystemPermission,
  isAllowedDesktopMainFrameUrl,
  isAllowedDesktopRestrictedFileSystemPrompt
} from "./window-policy.js";

const APP_ID = "kr.eff0rtchung.kirinuki";
const APP_NAME = "Kirinuki";
const windows = new Set<BrowserWindow>();
let runtime: DesktopRuntimeSupervisor | null = null;
let runtimePaths: Readonly<DesktopRuntimePaths>;
let shutdownPromise: Promise<void> | null = null;
let shutdownComplete = false;
let applicationReady = false;
const pendingRequests: Array<Readonly<KirinukiDeepLinkRequest>> = [];
const WINDOW_CLOSE_GRACE_MS = 2_500;

function developmentRepositoryRoot(): string {
  const configured = String(process.env.KIRINUKI_DESKTOP_DEV_ROOT || "");
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("데스크톱 개발 리소스 루트를 확인하지 못했습니다.");
  }
  return path.resolve(configured);
}

function isManagedWebContents(value: Electron.WebContents | null): boolean {
  return value !== null && [...windows].some((target) => (
    !target.isDestroyed() && target.webContents === value
  ));
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

function configureNativeSmokeControl(
  nativeSmoke: Readonly<DesktopNativeSmokeContract>
): Readonly<{ signalReady: () => Promise<void> }> {
  if (typeof process.send !== "function" || !process.connected) {
    throw new Error("데스크톱 native smoke IPC 채널이 없습니다.");
  }
  let ready = false;
  let disconnected = false;
  let quitRequested = false;
  process.once("disconnect", () => {
    disconnected = true;
    if (!quitRequested) {
      process.exitCode = 1;
    }
    if (ready) {
      app.quit();
    }
  });
  process.on("message", (message) => {
    const valid = isDesktopNativeSmokeQuitMessage(message, nativeSmoke);
    quitRequested = true;
    if (!valid || !ready) {
      process.exitCode = 1;
    }
    if (ready) {
      app.quit();
    }
  });
  return Object.freeze({
    signalReady: async () => {
      const send = process.send;
      if (
        disconnected
        || quitRequested
        || typeof send !== "function"
        || !process.connected
      ) {
        throw new Error("데스크톱 native smoke IPC 채널이 준비 전에 닫혔습니다.");
      }
      ready = true;
      await new Promise<void>((resolve, reject) => {
        send.call(
          process,
          desktopNativeSmokeReadyMessage(nativeSmoke),
          (error) => error ? reject(error) : resolve()
        );
      });
    }
  });
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

async function logEvent(event: string, error?: unknown): Promise<void> {
  const detail = error === undefined ? "" : ` · ${safeLogMessage(error)}`;
  console.error(`[Kirinuki] ${event}${detail}`);
}

function focusLatestWindow(): void {
  const target = [...windows].at(-1);
  if (!target || target.isDestroyed()) {
    return;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  target.show();
  target.focus();
}

async function openExternalIfAllowed(value: string): Promise<void> {
  const allowed = allowedExternalNavigationUrl(value);
  if (!allowed) {
    await logEvent("blocked-external-navigation");
    return;
  }
  await shell.openExternal(allowed, { activate: true });
}

function hardenWindow(target: BrowserWindow): void {
  const { webContents } = target;
  webContents.setWindowOpenHandler(({ url }) => {
    void openExternalIfAllowed(url).catch((error) => {
      void logEvent("external-navigation-failed", error);
    });
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedDesktopMainFrameUrl(url)) {
      return;
    }
    event.preventDefault();
    void openExternalIfAllowed(url).catch((error) => {
      void logEvent("external-navigation-failed", error);
    });
  });
  webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  webContents.on("render-process-gone", (_event, details) => {
    void logEvent(`renderer-gone:${details.reason}`);
  });
}

async function createWindow(
  request: Readonly<KirinukiDeepLinkRequest> | null = null
): Promise<BrowserWindow> {
  if (!runtime) {
    throw new Error("Kirinuki 내부 런타임이 아직 준비되지 않았습니다.");
  }
  const target = new BrowserWindow({
    title: APP_NAME,
    width: 1_440,
    height: 960,
    minWidth: 1_100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0d0f14",
    webPreferences: {
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
  windows.add(target);
  hardenWindow(target);
  target.once("ready-to-show", () => {
    if (!target.isDestroyed()) {
      target.show();
    }
  });
  target.once("closed", () => {
    windows.delete(target);
  });
  try {
    await target.loadURL(desktopStudioUrl(request));
    return target;
  } catch (error) {
    windows.delete(target);
    if (!target.isDestroyed()) {
      target.destroy();
    }
    throw error;
  }
}

function showInvalidLink(error: unknown): void {
  void logEvent("invalid-deep-link", error);
  dialog.showMessageBox({
    type: "warning",
    title: "Kirinuki 앱 링크",
    message: "이 앱 링크는 열 수 없습니다.",
    detail: "CHZZK·YouTube·SOOP의 지원되는 단일 공개 완료 VOD 링크인지 확인해 주세요.",
    buttons: ["확인"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }).catch(() => undefined);
}

function acceptRequest(request: Readonly<KirinukiDeepLinkRequest> | null): void {
  if (!request) {
    if (applicationReady) {
      focusLatestWindow();
    }
    return;
  }
  if (!applicationReady) {
    pendingRequests.push(request);
    return;
  }
  void createWindow(request).catch((error) => {
    void logEvent("warm-window-open-failed", error);
    dialog.showErrorBox(
      "Kirinuki를 열지 못했습니다",
      "새 편집 창을 준비하지 못했습니다. 앱을 완전히 닫은 뒤 다시 실행해 주세요."
    );
  });
}

function requestFromArgv(argv: readonly string[]): Readonly<KirinukiDeepLinkRequest> | null {
  return extractKirinukiDeepLinkFromArgv(argv);
}

async function clearTransientBrowserData(
  browserSession: Electron.Session
): Promise<void> {
  // Keep only explicit local project stores for the studio origin. Embedded
  // sites and transient Chromium services receive no cross-run state.
  await browserSession.clearData({
    excludeOrigins: [KIRINUKI_LOCAL_STUDIO_ORIGIN],
    originMatchingMode: "origin-in-all-contexts"
  });
  await browserSession.clearData({
    origins: [KIRINUKI_LOCAL_STUDIO_ORIGIN],
    originMatchingMode: "origin-in-all-contexts",
    dataTypes: [
      "backgroundFetch",
      "cache",
      "cookies",
      "downloads",
      "serviceWorkers",
      "webSQL"
    ]
  });
  await browserSession.clearStorageData({
    origin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
    storages: ["cookies", "shadercache", "serviceworkers", "cachestorage"]
  });
  await Promise.all([
    browserSession.clearAuthCache(),
    browserSession.clearCodeCaches({}),
    browserSession.clearHostResolverCache(),
    browserSession.clearSharedDictionaryCache()
  ]);
}

async function configureBrowserSession(extensionRoot: string): Promise<void> {
  const browserSession = session.defaultSession;
  await clearTransientBrowserData(browserSession);
  browserSession.setSpellCheckerEnabled(false);
  browserSession.setPermissionCheckHandler((
    webContents,
    permission,
    requestingOrigin,
    details
  ) => permission === "fileSystem" && isAllowedDesktopFileSystemPermission({
    managedWebContents: isManagedWebContents(webContents),
    requestingOrigin,
    requestingUrl: details.requestingUrl,
    fileAccessType: details.fileAccessType,
    filePath: details.filePath
  }));
  browserSession.setPermissionRequestHandler((
    webContents,
    permission,
    callback,
    details
  ) => {
    const requestingOrigin = (() => {
      try {
        return new URL(details.requestingUrl).origin;
      } catch {
        return "";
      }
    })();
    callback(permission === "fileSystem" && isAllowedDesktopFileSystemPermission({
      managedWebContents: isManagedWebContents(webContents),
      requestingOrigin,
      requestingUrl: details.requestingUrl,
      fileAccessType: "fileAccessType" in details ? details.fileAccessType : undefined,
      filePath: "filePath" in details ? details.filePath : undefined
    }));
  });
  browserSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
  browserSession.on("file-system-access-restricted", (_event, details, callback) => {
    if (!isAllowedDesktopRestrictedFileSystemPrompt({
      origin: details.origin,
      filePath: details.path,
      isDirectory: details.isDirectory
    })) {
      callback("deny");
      return;
    }
    const targetLabel = details.isDirectory ? "폴더" : "파일";
    void dialog.showMessageBox({
      type: "warning",
      title: `보호된 ${targetLabel} 사용`,
      message: `선택한 ${targetLabel}을 Kirinuki에서 사용하시겠습니까?`,
      detail: details.isDirectory
        ? "바탕화면·문서·다운로드 같은 보호된 위치입니다. 이번에 직접 선택한 폴더에만 내보내기 파일을 씁니다."
        : "보호된 위치의 파일입니다. 이번에 직접 선택한 파일만 읽습니다.",
      buttons: [`이 ${targetLabel} 사용`, "다른 위치 선택", "취소"],
      defaultId: 1,
      cancelId: 2,
      noLink: true
    }).then(({ response }) => {
      callback(response === 0 ? "allow" : response === 1 ? "tryAgain" : "deny");
    }).catch(() => callback("deny"));
  });
  const extension = await browserSession.extensions.loadExtension(
    extensionRoot,
    { allowFileAccess: false }
  );
  if (extension.name !== "Kirinuki Player Bridge") {
    throw new Error("내장 Player Bridge identity가 올바르지 않습니다.");
  }
}

async function closeWindowForShutdown(target: BrowserWindow): Promise<void> {
  if (target.isDestroyed()) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      target.removeListener("closed", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      if (!target.isDestroyed()) {
        target.destroy();
      }
      finish();
    }, WINDOW_CLOSE_GRACE_MS);
    target.once("closed", finish);
    target.close();
  });
}

async function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    await Promise.all([...windows].map(closeWindowForShutdown));
    await Promise.allSettled([
      clearTransientBrowserData(session.defaultSession),
      runtime?.stop()
    ]).then((results) => {
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (errors.length > 0) {
        throw new AggregateError(errors, "Kirinuki 종료 정리에 실패했습니다.");
      }
    });
  })().finally(() => {
    shutdownComplete = true;
  });
  return shutdownPromise;
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
  app.setDesktopName("kirinuki.desktop");
}
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch("no-pings");

runtimePaths = desktopPaths(nativeSmoke);
preparePrivateDirectories([
  {
    path: runtimePaths.appDataRoot,
    label: "앱 데이터"
  },
  {
    path: runtimePaths.browserSessionRoot,
    label: "브라우저 세션",
    containedBy: runtimePaths.appDataRoot
  }
], { platform: runtimePaths.platform });
app.setPath("sessionData", runtimePaths.browserSessionRoot);

let initialRequest: Readonly<KirinukiDeepLinkRequest> | null = null;
let initialRequestError: unknown;
try {
  initialRequest = requestFromArgv(process.argv);
} catch (error) {
  initialRequestError = error;
}

const primaryInstance = nativeSmoke ? true : app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  const nativeSmokeControl = nativeSmoke
    ? configureNativeSmokeControl(nativeSmoke)
    : null;
  app.on("second-instance", (_event, argv) => {
    try {
      acceptRequest(requestFromArgv(argv));
    } catch (error) {
      showInvalidLink(error);
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    try {
      acceptRequest(parseKirinukiDeepLink(url));
    } catch (error) {
      if (applicationReady) {
        showInvalidLink(error);
      } else {
        initialRequestError = error;
      }
    }
  });
  app.on("before-quit", (event) => {
    if (shutdownComplete) {
      return;
    }
    event.preventDefault();
    void shutdown()
      .catch((error) => {
        process.exitCode = 1;
        return logEvent("shutdown-failed", error);
      })
      .finally(() => app.quit());
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("activate", () => {
    if (applicationReady && windows.size === 0) {
      void createWindow().catch((error) => logEvent("activate-window-failed", error));
    } else {
      focusLatestWindow();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (app.isPackaged && !nativeSmoke) {
      app.setAsDefaultProtocolClient("kirinuki");
    }
    const appRoot = app.isPackaged
      ? app.getAppPath()
      : developmentRepositoryRoot();
    const extensionRoot = app.isPackaged
      ? path.join(process.resourcesPath, "streaming-companion")
      : path.join(appRoot, "streaming-companion");
    await configureBrowserSession(extensionRoot);
    runtime = await startDesktopRuntimeSupervisor({
      appRoot,
      paths: runtimePaths,
      nodeBinary: process.execPath
    });
    applicationReady = true;
    if (initialRequestError !== undefined) {
      showInvalidLink(initialRequestError);
    }
    const startupRequests = [
      ...(initialRequest ? [initialRequest] : []),
      ...pendingRequests.splice(0)
    ];
    if (startupRequests.length === 0) {
      await createWindow();
    } else {
      for (const request of startupRequests) {
        await createWindow(request);
      }
    }
    if (nativeSmoke) {
      await nativeSmokeControl?.signalReady();
      await logEvent("native-smoke-ready");
    }
  }).catch((error) => {
    void logEvent("startup-failed", error);
    if (!nativeSmoke) {
      dialog.showErrorBox(
        "Kirinuki를 시작하지 못했습니다",
        "내장 편집 엔진 또는 미디어 도구를 준비하지 못했습니다. 앱을 완전히 닫은 뒤 다시 실행해 주세요."
      );
    }
    void shutdown()
      .catch((shutdownError) => logEvent("startup-shutdown-failed", shutdownError))
      .finally(() => app.exit(1));
  });
}

process.once("SIGINT", () => app.quit());
process.once("SIGTERM", () => app.quit());
