import { lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENGINE_OWNED_UNINSTALL_ARGUMENT } from "./instance-lifecycle.js";

export const DESKTOP_NATIVE_SMOKE_ARGUMENT =
  "--kirinuki-internal-native-smoke" as const;
export const DESKTOP_NATIVE_SMOKE_ROOT_ENV =
  "KIRINUKI_DESKTOP_SMOKE_ROOT" as const;
export const DESKTOP_NATIVE_SMOKE_TOKEN_ENV =
  "KIRINUKI_DESKTOP_SMOKE_TOKEN" as const;
export const DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV =
  "KIRINUKI_DESKTOP_SMOKE_AUTOSTART_MODE" as const;
export const DESKTOP_NATIVE_SMOKE_ROOT_PREFIX =
  "kirinuki-desktop-native-smoke-" as const;
export const DESKTOP_NATIVE_SMOKE_IPC_SCHEMA =
  "kirinuki-desktop-native-smoke/ipc-v1" as const;

export function desktopNativeSmokeDisconnectExitCode({
  quitRequested,
  ownedCleanupRequested,
  currentExitCode
}: {
  readonly quitRequested: boolean;
  readonly ownedCleanupRequested: boolean;
  readonly currentExitCode: number;
}): number {
  if (
    typeof quitRequested !== "boolean"
    || typeof ownedCleanupRequested !== "boolean"
    || !Number.isSafeInteger(currentExitCode)
    || currentExitCode < 0
    || currentExitCode > 255
  ) {
    throw new TypeError("데스크톱 native smoke 종료 상태가 올바르지 않습니다.");
  }
  return quitRequested || ownedCleanupRequested ? currentExitCode : 1;
}

export const DESKTOP_NATIVE_SMOKE_USER_DATA_DIRECTORY =
  "user data-사용자" as const;
const NATIVE_SMOKE_CRASH_DUMPS_DIRECTORY = "crash dumps-사용자" as const;
const NATIVE_SMOKE_LOGS_DIRECTORY = "logs-사용자" as const;
const NATIVE_SMOKE_TEMP_DIRECTORY = "runtime temp-사용자" as const;

export interface DesktopNativeSmokeContract {
  readonly autostartMode: "isolated" | "production";
  readonly root: string;
  readonly userDataRoot: string;
  readonly crashDumpsRoot: string;
  readonly logsRoot: string;
  readonly tempRoot: string;
  readonly token: string;
}

export interface DesktopNativeSmokeReadyMessage {
  readonly autostart: {
    readonly argument: "--engine-background";
    readonly method: "electron-login-item" | "xdg-autostart" | "isolated-smoke";
    readonly readBack: true;
    readonly registered: true;
    readonly schema: "kirinuki-engine-autostart/v1";
  };
  readonly gateway: {
    readonly allowedOrigin: "https://kirinuki.eff0rtchung.kr";
    readonly port: 4319;
    readonly reusedExisting: false;
  };
  readonly processCount: number;
  readonly schema: typeof DESKTOP_NATIVE_SMOKE_IPC_SCHEMA;
  readonly type: "ready";
  readonly token: string;
  readonly windowCount: 0;
}

export interface DesktopNativeSmokeQuitMessage {
  readonly schema: typeof DESKTOP_NATIVE_SMOKE_IPC_SCHEMA;
  readonly type: "quit";
  readonly token: string;
}

function comparisonKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function exactDirectTemporaryChild(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
    || !path.isAbsolute(value)
  ) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_ROOT_ENV}는 안전한 절대 경로여야 합니다.`
    );
  }
  const resolved = path.resolve(value);
  if (comparisonKey(resolved) !== comparisonKey(value)) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_ROOT_ENV}는 정규화된 절대 경로여야 합니다.`
    );
  }
  const temporaryRoot = path.resolve(os.tmpdir());
  if (comparisonKey(path.dirname(resolved)) !== comparisonKey(temporaryRoot)) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_ROOT_ENV}는 OS 임시 폴더의 직계 하위여야 합니다.`
    );
  }
  const baseName = path.basename(resolved);
  const suffix = baseName.slice(DESKTOP_NATIVE_SMOKE_ROOT_PREFIX.length);
  if (
    !baseName.startsWith(DESKTOP_NATIVE_SMOKE_ROOT_PREFIX)
    || !/^[A-Za-z0-9_-]{6,64}$/u.test(suffix)
  ) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_ROOT_ENV} 이름이 내부 smoke 규약과 다릅니다.`
    );
  }
  const metadata = lstatSync(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_ROOT_ENV}는 실제 디렉터리여야 합니다.`
    );
  }
  return resolved;
}

/**
 * Resolves the deliberately narrow packaged-app liveness contract. The flag
 * has no HTTP or renderer surface and only accepts a fresh runner-owned direct
 * child of the operating-system temp directory.
 */
export function resolveDesktopNativeSmokeContract({
  argv = process.argv,
  env = process.env
}: {
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
} = {}): Readonly<DesktopNativeSmokeContract> | null {
  const occurrences = argv.filter(
    (argument) => argument === DESKTOP_NATIVE_SMOKE_ARGUMENT
  ).length;
  const inheritedOwnedUninstall = occurrences === 0
    && argv.filter((argument) => argument === ENGINE_OWNED_UNINSTALL_ARGUMENT)
      .length === 1
    && env[DESKTOP_NATIVE_SMOKE_ROOT_ENV] !== undefined
    && env[DESKTOP_NATIVE_SMOKE_TOKEN_ENV] !== undefined;
  if (occurrences === 0 && !inheritedOwnedUninstall) {
    return null;
  }
  if (occurrences !== 1 && !inheritedOwnedUninstall) {
    throw new TypeError("데스크톱 native smoke 실행 플래그가 중복됐습니다.");
  }
  const root = exactDirectTemporaryChild(
    env[DESKTOP_NATIVE_SMOKE_ROOT_ENV]
  );
  const token = env[DESKTOP_NATIVE_SMOKE_TOKEN_ENV];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_TOKEN_ENV}은 32-byte base64url token이어야 합니다.`
    );
  }
  const autostartModeValue = env[DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV];
  if (
    autostartModeValue !== undefined
    && autostartModeValue !== "isolated"
    && autostartModeValue !== "production"
  ) {
    throw new TypeError(
      `${DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV} 값이 올바르지 않습니다.`
    );
  }
  return Object.freeze({
    autostartMode: autostartModeValue ?? "isolated",
    root,
    userDataRoot: path.join(root, DESKTOP_NATIVE_SMOKE_USER_DATA_DIRECTORY),
    crashDumpsRoot: path.join(root, NATIVE_SMOKE_CRASH_DUMPS_DIRECTORY),
    logsRoot: path.join(root, NATIVE_SMOKE_LOGS_DIRECTORY),
    tempRoot: path.join(root, NATIVE_SMOKE_TEMP_DIRECTORY),
    token
  });
}

export function desktopNativeSmokeReadyMessage(
  contract: Readonly<DesktopNativeSmokeContract>,
  evidence: {
    readonly processCount: number;
    readonly windowCount: number;
    readonly gateway: {
      readonly allowedOrigin: string;
      readonly port: number;
      readonly reusedExisting: boolean;
    };
    readonly autostart: {
      readonly schema: string;
      readonly method: string;
      readonly registered: boolean;
      readonly readBack: boolean;
      readonly arguments: readonly string[];
    };
  }
): Readonly<DesktopNativeSmokeReadyMessage> {
  if (
    !Number.isSafeInteger(evidence.processCount)
    || evidence.processCount < 1
    || evidence.processCount > 64
  ) {
    throw new TypeError("데스크톱 native smoke process 수가 올바르지 않습니다.");
  }
  if (
    evidence.windowCount !== 0
    || evidence.gateway.allowedOrigin !== "https://kirinuki.eff0rtchung.kr"
    || evidence.gateway.port !== 4319
    || evidence.gateway.reusedExisting !== false
    || evidence.autostart.schema !== "kirinuki-engine-autostart/v1"
    || (
      contract.autostartMode === "isolated"
        ? evidence.autostart.method !== "isolated-smoke"
        : evidence.autostart.method !== (
          process.platform === "linux" ? "xdg-autostart" : "electron-login-item"
        )
    )
    || evidence.autostart.registered !== true
    || evidence.autostart.readBack !== true
    || JSON.stringify(evidence.autostart.arguments)
      !== JSON.stringify(["--engine-background"])
  ) {
    throw new TypeError("데스크톱 native smoke headless evidence가 올바르지 않습니다.");
  }
  return Object.freeze({
    autostart: Object.freeze({
      argument: "--engine-background",
      method: evidence.autostart.method as DesktopNativeSmokeReadyMessage["autostart"]["method"],
      readBack: true,
      registered: true,
      schema: "kirinuki-engine-autostart/v1"
    }),
    gateway: Object.freeze({
      allowedOrigin: "https://kirinuki.eff0rtchung.kr",
      port: 4319,
      reusedExisting: false
    }),
    processCount: evidence.processCount,
    schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
    type: "ready",
    token: contract.token,
    windowCount: 0
  });
}

export function isDesktopNativeSmokeQuitMessage(
  value: unknown,
  contract: Readonly<DesktopNativeSmokeContract>
): value is DesktopNativeSmokeQuitMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return Object.keys(message).sort().join(",") === "schema,token,type"
    && message.schema === DESKTOP_NATIVE_SMOKE_IPC_SCHEMA
    && message.type === "quit"
    && message.token === contract.token;
}
