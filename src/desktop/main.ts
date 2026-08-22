import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { app, powerMonitor, safeStorage, webContents } from "electron";

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
  extractLocalMediaEnginePairingRequestFromArgv,
  parseLocalMediaEnginePairingRequest
} from "../lib/local-media-engine-auth.js";
import type {
  LocalMediaEnginePairingRequest
} from "../lib/local-media-engine-auth.js";

const APP_ID = "kr.eff0rtchung.kirinuki";
const APP_NAME = "Kirinuki";

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
let pairingDrain: Promise<void> | null = null;

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

function pairingRequestFromArgv(
  argv: readonly unknown[]
): Readonly<LocalMediaEnginePairingRequest> | null {
  try {
    return extractLocalMediaEnginePairingRequestFromArgv(argv);
  } catch (error) {
    logEvent("pairing-url-rejected", error);
    return null;
  }
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
app.disableHardwareAcceleration();
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
    enqueuePairingRequest(parseLocalMediaEnginePairingRequest(url));
  } catch (error) {
    logEvent("pairing-url-rejected", error);
  }
});

runtimePaths = desktopPaths(nativeSmoke);

const initialOwnedUninstallRequest = exactOwnedUninstallRequestFromArgv(
  process.argv
);
const initialPairingRequest = process.platform === "darwin"
  ? null
  : pairingRequestFromArgv(process.argv);
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
      const pairingRequest = engineInstancePairingRequest(additionalData)
        ?? pairingRequestFromArgv(argv);
      if (pairingRequest) {
        enqueuePairingRequest(pairingRequest);
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
