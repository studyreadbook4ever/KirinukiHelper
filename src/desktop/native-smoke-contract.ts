import { lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DESKTOP_NATIVE_SMOKE_ARGUMENT =
  "--kirinuki-internal-native-smoke" as const;
export const DESKTOP_NATIVE_SMOKE_ROOT_ENV =
  "KIRINUKI_DESKTOP_SMOKE_ROOT" as const;
export const DESKTOP_NATIVE_SMOKE_TOKEN_ENV =
  "KIRINUKI_DESKTOP_SMOKE_TOKEN" as const;
export const DESKTOP_NATIVE_SMOKE_ROOT_PREFIX =
  "kirinuki-desktop-native-smoke-" as const;
export const DESKTOP_NATIVE_SMOKE_IPC_SCHEMA =
  "kirinuki-desktop-native-smoke/ipc-v1" as const;

export interface DesktopNativeSmokeContract {
  readonly root: string;
  readonly userDataRoot: string;
  readonly crashDumpsRoot: string;
  readonly logsRoot: string;
  readonly tempRoot: string;
  readonly token: string;
}

export interface DesktopNativeSmokeReadyMessage {
  readonly schema: typeof DESKTOP_NATIVE_SMOKE_IPC_SCHEMA;
  readonly type: "ready";
  readonly token: string;
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
  if (occurrences === 0) {
    return null;
  }
  if (occurrences !== 1) {
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
  return Object.freeze({
    root,
    userDataRoot: path.join(root, "user-data"),
    crashDumpsRoot: path.join(root, "crash-dumps"),
    logsRoot: path.join(root, "logs"),
    tempRoot: path.join(root, "runtime-temp"),
    token
  });
}

export function desktopNativeSmokeReadyMessage(
  contract: Readonly<DesktopNativeSmokeContract>
): Readonly<DesktopNativeSmokeReadyMessage> {
  return Object.freeze({
    schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
    type: "ready",
    token: contract.token
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
