import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";

import type { DesktopBundleTarget, DesktopPlatform } from "./runtime-spec.js";
import { validateDesktopAbsolutePath } from "./runtime-spec.js";

export const ENGINE_BACKGROUND_ARGUMENT = "--engine-background" as const;
export const LINUX_ENGINE_AUTOSTART_FILE =
  "kr.eff0rtchung.kirinuki-engine.desktop" as const;
export const WINDOWS_ENGINE_LOGIN_ITEM_NAME =
  "Kirinuki Local Engine" as const;
export const ENGINE_AUTOSTART_SCHEMA =
  "kirinuki-engine-autostart/v1" as const;

export interface LoginItemSettings {
  readonly openAtLogin: boolean;
  readonly openAsHidden?: boolean;
  readonly enabled?: boolean;
  readonly path?: string;
  readonly args?: readonly string[];
  readonly name?: string;
}

export interface LoginItemState {
  readonly openAtLogin: boolean;
  readonly executableWillLaunchAtLogin?: boolean;
  readonly status?: "not-registered" | "enabled" | "requires-approval" | "not-found";
  readonly launchItems?: readonly Readonly<{
    readonly name: string;
    readonly path: string;
    readonly args: readonly string[];
    readonly scope: "user" | "machine";
    readonly enabled: boolean;
  }>[];
}

export interface LoginItemAdapter {
  readonly set: (settings: Readonly<LoginItemSettings>) => void;
  readonly get: (settings: Readonly<LoginItemSettings>) => Readonly<LoginItemState>;
}

/**
 * Keeps target-platform paths in the persisted contract while allowing a
 * cross-platform verifier to store that contract on its native filesystem.
 * Production uses the identity mapping and native permission capabilities.
 */
export interface EngineAutostartFileSystemSemantics {
  readonly resolveStatePath: (targetPath: string) => string;
  readonly enforcePosixPermissions: boolean;
}

export interface EngineAutostartRegistration {
  readonly schema: typeof ENGINE_AUTOSTART_SCHEMA;
  readonly target: DesktopBundleTarget;
  readonly method: "electron-login-item" | "xdg-autostart" | "isolated-smoke";
  readonly executablePath: string;
  readonly arguments: readonly [typeof ENGINE_BACKGROUND_ARGUMENT];
  readonly registered: boolean;
  readonly approvalRequired: boolean;
  readonly readBack: true;
  readonly statePath: string | null;
}

export interface EngineAutostartRemoval {
  readonly schema: typeof ENGINE_AUTOSTART_SCHEMA;
  readonly target: DesktopBundleTarget;
  readonly method: "electron-login-item" | "xdg-autostart" | "isolated-smoke";
  readonly removed: true;
  readonly readBack: true;
  readonly statePath: string | null;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

const nativeFileSystemSemantics = Object.freeze({
  resolveStatePath: (targetPath: string) => targetPath,
  enforcePosixPermissions: process.platform !== "win32"
}) satisfies EngineAutostartFileSystemSemantics;

function exactFileSystemSemantics(
  value: Readonly<EngineAutostartFileSystemSemantics> | undefined
): Readonly<EngineAutostartFileSystemSemantics> {
  const semantics = value ?? nativeFileSystemSemantics;
  if (
    typeof semantics.resolveStatePath !== "function"
    || typeof semantics.enforcePosixPermissions !== "boolean"
    || (
      !semantics.enforcePosixPermissions
      && process.platform !== "win32"
    )
  ) {
    throw new TypeError("자동실행 파일시스템 의미가 올바르지 않습니다.");
  }
  return semantics;
}

function targetPathImplementation(
  platform: DesktopPlatform
): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function resolvedStatePath(
  targetPath: string,
  semantics: Readonly<EngineAutostartFileSystemSemantics>
): string {
  const resolved = semantics.resolveStatePath(targetPath);
  if (
    typeof resolved !== "string"
    || resolved.length === 0
    || resolved.trim() !== resolved
    || /[\u0000-\u001f\u007f]/u.test(resolved)
    || !path.isAbsolute(resolved)
  ) {
    throw new TypeError("자동실행 상태의 실제 저장 경로가 올바르지 않습니다.");
  }
  const normalized = path.normalize(resolved);
  if (normalized === path.parse(normalized).root) {
    throw new TypeError("자동실행 상태를 파일시스템 루트에 저장할 수 없습니다.");
  }
  return normalized;
}

function targetPlatform(target: DesktopBundleTarget): DesktopPlatform {
  return target.split("-")[0] as DesktopPlatform;
}

function exactSupportedTarget(value: DesktopBundleTarget | string): DesktopBundleTarget {
  if (![
    "linux-x64",
    "darwin-arm64",
    "win32-x64"
  ].includes(value)) {
    throw new TypeError(`자동실행을 지원하지 않는 desktop target입니다: ${value}`);
  }
  return value as DesktopBundleTarget;
}

function exactExecutablePath(
  value: string,
  platform: DesktopPlatform
): string {
  return validateDesktopAbsolutePath(value, {
    platform,
    label: "Kirinuki 자동실행 executable"
  });
}

function desktopExecQuote(value: string): string {
  if (
    value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError("Linux 자동실행 executable 경로가 안전하지 않습니다.");
  }
  return `"${value
    .replace(/%/gu, "%%")
    .replace(/[\\"`$]/gu, (character) => `\\${character}`)}"`;
}

const LINUX_AUTOSTART_SHELL = "/bin/sh" as const;
const LINUX_AUTOSTART_SHELL_PROGRAM =
  `if [ -x "$1" ]; then exec "$1" ${ENGINE_BACKGROUND_ARGUMENT}; fi; /bin/rm -f -- "$2"` as const;

export function linuxEngineAutostartLaunch(
  executablePath: string,
  statePath: string
): Readonly<{
  readonly command: typeof LINUX_AUTOSTART_SHELL;
  readonly arguments: readonly ["-c", string, "kirinuki-engine", string, string];
}> {
  const executable = exactExecutablePath(executablePath, "linux");
  const autostartPath = validateDesktopAbsolutePath(statePath, {
    platform: "linux",
    label: "Linux XDG 자동실행 상태"
  });
  return Object.freeze({
    command: LINUX_AUTOSTART_SHELL,
    arguments: Object.freeze([
      "-c",
      LINUX_AUTOSTART_SHELL_PROGRAM,
      "kirinuki-engine",
      executable,
      autostartPath
    ] as const)
  });
}

export function linuxEngineAutostartContent(
  executablePath: string,
  statePath: string
): string {
  const launch = linuxEngineAutostartLaunch(executablePath, statePath);
  const executable = launch.arguments[3];
  const autostartPath = launch.arguments[4];
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Kirinuki Local VOD Engine",
    "Comment=Kirinuki 웹 편집기의 로컬 구간 다운로드 엔진",
    `Exec=${[
      launch.command,
      ...launch.arguments
    ].map(desktopExecQuote).join(" ")}`,
    `TryExec=${LINUX_AUTOSTART_SHELL}`,
    "Terminal=false",
    "NoDisplay=true",
    "Hidden=false",
    "X-GNOME-Autostart-enabled=true",
    `X-Kirinuki-Managed=${ENGINE_AUTOSTART_SCHEMA}`,
    `X-Kirinuki-Executable=${executable}`,
    `X-Kirinuki-Autostart-Path=${autostartPath}`,
    ""
  ].join("\n");
}

function decodedDesktopExecPath(value: string): string | null {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return null;
  }
  let decoded = "";
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]!;
    if (character === "\\") {
      const escaped = value[index + 1];
      if (!escaped || !["\\", '"', "`", "$"].includes(escaped)) {
        return null;
      }
      decoded += escaped;
      index += 1;
      continue;
    }
    if (character === "%") {
      if (value[index + 1] !== "%") {
        return null;
      }
      decoded += "%";
      index += 1;
      continue;
    }
    decoded += character;
  }
  return decoded;
}

function isLegacyManagedLinuxEngineAutostartContent(value: string): boolean {
  const lines = value.split("\n");
  if (
    lines.length !== 13
    || lines[0] !== "[Desktop Entry]"
    || lines[1] !== "Type=Application"
    || lines[2] !== "Version=1.0"
    || lines[3] !== "Name=Kirinuki Local VOD Engine"
    || lines[4] !== "Comment=Kirinuki 웹 편집기의 로컬 구간 다운로드 엔진"
    || !lines[5]?.startsWith("Exec=")
    || !lines[5].endsWith(` ${ENGINE_BACKGROUND_ARGUMENT}`)
    || !lines[6]?.startsWith("TryExec=")
    || lines[7] !== "Terminal=false"
    || lines[8] !== "NoDisplay=true"
    || lines[9] !== "Hidden=false"
    || lines[10] !== "X-GNOME-Autostart-enabled=true"
    || lines[11] !== `X-Kirinuki-Managed=${ENGINE_AUTOSTART_SCHEMA}`
    || lines[12] !== ""
  ) {
    return false;
  }
  const encoded = lines[5].slice(
    "Exec=".length,
    -(` ${ENGINE_BACKGROUND_ARGUMENT}`.length)
  );
  const executablePath = decodedDesktopExecPath(encoded);
  if (!executablePath || lines[6] !== `TryExec=${executablePath}`) {
    return false;
  }
  try {
    return exactExecutablePath(executablePath, "linux") === executablePath;
  } catch {
    return false;
  }
}

export function isManagedLinuxEngineAutostartContent(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (isLegacyManagedLinuxEngineAutostartContent(value)) {
    return true;
  }
  const lines = value.split("\n");
  if (
    lines.length !== 15
    || lines[0] !== "[Desktop Entry]"
    || lines[1] !== "Type=Application"
    || lines[2] !== "Version=1.0"
    || lines[3] !== "Name=Kirinuki Local VOD Engine"
    || lines[4] !== "Comment=Kirinuki 웹 편집기의 로컬 구간 다운로드 엔진"
    || !lines[5]?.startsWith(`Exec=${desktopExecQuote(LINUX_AUTOSTART_SHELL)} ${desktopExecQuote("-c")} `)
    || lines[6] !== `TryExec=${LINUX_AUTOSTART_SHELL}`
    || lines[7] !== "Terminal=false"
    || lines[8] !== "NoDisplay=true"
    || lines[9] !== "Hidden=false"
    || lines[10] !== "X-GNOME-Autostart-enabled=true"
    || lines[11] !== `X-Kirinuki-Managed=${ENGINE_AUTOSTART_SCHEMA}`
    || !lines[12]?.startsWith("X-Kirinuki-Executable=")
    || !lines[13]?.startsWith("X-Kirinuki-Autostart-Path=")
    || lines[14] !== ""
  ) {
    return false;
  }
  const executablePath = lines[12].slice("X-Kirinuki-Executable=".length);
  const statePath = lines[13].slice("X-Kirinuki-Autostart-Path=".length);
  try {
    return linuxEngineAutostartContent(executablePath, statePath) === value;
  } catch {
    return false;
  }
}

async function existingRegularFile(pathname: string): Promise<Stats | null> {
  try {
    const metadata = await lstat(pathname);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`자동실행 상태 경로가 regular file이 아닙니다: ${pathname}`);
    }
    return metadata;
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

async function ensureRegularDirectory(pathname: string): Promise<void> {
  try {
    const before = await lstat(pathname);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error(`자동실행 디렉터리가 실제 디렉터리가 아닙니다: ${pathname}`);
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
    await mkdir(pathname, { recursive: true, mode: 0o700 });
  }
  const after = await lstat(pathname);
  if (!after.isDirectory() || after.isSymbolicLink()) {
    throw new Error(`자동실행 디렉터리가 실제 디렉터리가 아닙니다: ${pathname}`);
  }
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readExactRegularFile(pathname: string): Promise<string> {
  const handle = await open(
    pathname,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error(`자동실행 상태가 regular file이 아닙니다: ${pathname}`);
    }
    const body = await handle.readFile("utf8");
    const after = await handle.stat();
    if (!sameFileIdentity(before, after)) {
      throw new Error(`자동실행 상태가 readback 중 바뀌었습니다: ${pathname}`);
    }
    return body;
  } finally {
    await handle.close();
  }
}

async function writeRegularFileAtomically(
  pathname: string,
  body: string,
  enforcePosixPermissions: boolean
): Promise<void> {
  const directory = path.dirname(pathname);
  await ensureRegularDirectory(directory);
  const before = await existingRegularFile(pathname);
  if (before && await readExactRegularFile(pathname) === body) {
    if (enforcePosixPermissions) {
      await chmod(pathname, 0o600);
    }
    return;
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(pathname)}.${randomBytes(12).toString("hex")}.tmp`
  );
  let temporaryExists = false;
  try {
    const handle = await open(
      temporaryPath,
      fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | fsConstants.O_WRONLY
        | (fsConstants.O_NOFOLLOW || 0),
      0o600
    );
    temporaryExists = true;
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const immediatelyBeforeReplace = await existingRegularFile(pathname);
    if (
      (before === null) !== (immediatelyBeforeReplace === null)
      || (
        before !== null
        && immediatelyBeforeReplace !== null
        && !sameFileIdentity(before, immediatelyBeforeReplace)
      )
    ) {
      throw new Error("자동실행 상태가 원자적 교체 직전에 바뀌었습니다.");
    }
    await rename(temporaryPath, pathname);
    temporaryExists = false;
    if (enforcePosixPermissions) {
      await chmod(pathname, 0o600);
    }
  } finally {
    if (temporaryExists) {
      await rm(temporaryPath, { force: true });
    }
  }
  const metadata = await existingRegularFile(pathname);
  if (!metadata || await readExactRegularFile(pathname) !== body) {
    throw new Error("자동실행 상태 readback이 기록값과 다릅니다.");
  }
  if (enforcePosixPermissions && (metadata.mode & 0o7777) !== 0o600) {
    throw new Error("자동실행 상태 권한을 0600으로 제한하지 못했습니다.");
  }
}

async function assertAbsentOrManagedFile(
  pathname: string,
  isManaged: (body: string) => boolean
): Promise<void> {
  const metadata = await existingRegularFile(pathname);
  if (metadata && !isManaged(await readExactRegularFile(pathname))) {
    throw new Error(`자동실행 경로에 Kirinuki가 관리하지 않는 파일이 있습니다: ${pathname}`);
  }
}

async function removeManagedRegularFile(
  pathname: string,
  isManaged: (body: string) => boolean
): Promise<void> {
  const before = await existingRegularFile(pathname);
  if (!before) {
    return;
  }
  if (!isManaged(await readExactRegularFile(pathname))) {
    throw new Error(`자동실행 경로에 Kirinuki가 관리하지 않는 파일이 있습니다: ${pathname}`);
  }
  const immediatelyBeforeRemove = await existingRegularFile(pathname);
  if (!immediatelyBeforeRemove || !sameFileIdentity(before, immediatelyBeforeRemove)) {
    throw new Error("자동실행 상태가 제거 직전에 바뀌었습니다.");
  }
  await rm(pathname);
  if (await existingRegularFile(pathname)) {
    throw new Error("자동실행 상태 제거 readback에 실패했습니다.");
  }
}

function registration(
  target: DesktopBundleTarget,
  method: EngineAutostartRegistration["method"],
  executablePath: string,
  statePath: string | null,
  {
    registered = true,
    approvalRequired = false
  }: {
    readonly registered?: boolean;
    readonly approvalRequired?: boolean;
  } = {}
): Readonly<EngineAutostartRegistration> {
  return Object.freeze({
    schema: ENGINE_AUTOSTART_SCHEMA,
    target,
    method,
    executablePath,
    arguments: Object.freeze([ENGINE_BACKGROUND_ARGUMENT] as const),
    registered,
    approvalRequired,
    readBack: true,
    statePath
  });
}

function loginItemSettings(
  platform: "darwin" | "win32",
  executablePath: string,
  openAtLogin: boolean = true
): Readonly<LoginItemSettings> {
  return Object.freeze({
    openAtLogin,
    ...(platform === "darwin" ? { openAsHidden: openAtLogin } : {}),
    ...(platform === "win32" ? { enabled: openAtLogin } : {}),
    path: executablePath,
    args: Object.freeze([ENGINE_BACKGROUND_ARGUMENT]),
    name: WINDOWS_ENGINE_LOGIN_ITEM_NAME
  });
}

interface LoginItemManagedState {
  readonly schema: typeof ENGINE_AUTOSTART_SCHEMA;
  readonly target: DesktopBundleTarget;
  readonly executablePath: string;
  readonly arguments: readonly [typeof ENGINE_BACKGROUND_ARGUMENT];
  readonly registered: true;
}

function loginItemManagedState(
  target: DesktopBundleTarget,
  executablePath: string
): Readonly<LoginItemManagedState> {
  return Object.freeze({
    schema: ENGINE_AUTOSTART_SCHEMA,
    target,
    executablePath,
    arguments: Object.freeze([ENGINE_BACKGROUND_ARGUMENT] as const),
    registered: true
  });
}

function parseLoginItemManagedState(
  body: string,
  expectedTarget: DesktopBundleTarget
): Readonly<LoginItemManagedState> | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const platform = targetPlatform(expectedTarget);
  if (
    Object.keys(record).sort().join(",")
      !== "arguments,executablePath,registered,schema,target"
    || record.schema !== ENGINE_AUTOSTART_SCHEMA
    || record.target !== expectedTarget
    || record.registered !== true
    || JSON.stringify(record.arguments) !== JSON.stringify([ENGINE_BACKGROUND_ARGUMENT])
    || typeof record.executablePath !== "string"
  ) {
    return null;
  }
  try {
    return loginItemManagedState(
      expectedTarget,
      exactExecutablePath(record.executablePath, platform)
    );
  } catch {
    return null;
  }
}

function loginItemEnabled(
  platform: "darwin" | "win32",
  state: Readonly<LoginItemState>
): boolean {
  if (platform === "darwin") {
    return state.openAtLogin === true && state.status === "enabled";
  }
  const launchItems = state.launchItems;
  if (!Array.isArray(launchItems)) {
    return false;
  }
  // Electron's legacy Windows openAtLogin readback checks only the default
  // AppUserModelID registry value. Kirinuki deliberately owns a named Run
  // value. getLoginItemSettings({ path, args }) already filters launchItems by
  // the requested executable path, so the named item is the exact readback.
  return state.executableWillLaunchAtLogin === true
    && launchItems.some((item) => (
      item.name === WINDOWS_ENGINE_LOGIN_ITEM_NAME
      && item.scope === "user"
      && item.enabled === true
      && JSON.stringify(item.args) === JSON.stringify([ENGINE_BACKGROUND_ARGUMENT])
    ));
}

function loginItemDisabled(
  platform: "darwin" | "win32",
  state: Readonly<LoginItemState>
): boolean {
  if (platform === "darwin") {
    return state.openAtLogin === false
      && state.status !== "enabled"
      && state.status !== "requires-approval";
  }
  return Array.isArray(state.launchItems)
    && !state.launchItems.some((item) => (
      item.name === WINDOWS_ENGINE_LOGIN_ITEM_NAME
      && item.scope === "user"
    ));
}

export async function ensureEngineAutostart({
  target: targetInput,
  executablePath: executablePathInput,
  linuxConfigRoot,
  loginItem,
  isolatedStateRoot,
  stateRoot,
  fileSystemSemantics: fileSystemSemanticsInput
}: {
  readonly target: DesktopBundleTarget | string;
  readonly executablePath: string;
  readonly linuxConfigRoot?: string;
  readonly loginItem?: Readonly<LoginItemAdapter>;
  readonly isolatedStateRoot?: string;
  readonly stateRoot?: string;
  readonly fileSystemSemantics?: Readonly<EngineAutostartFileSystemSemantics>;
}): Promise<Readonly<EngineAutostartRegistration>> {
  const target = exactSupportedTarget(targetInput);
  const platform = targetPlatform(target);
  const targetPaths = targetPathImplementation(platform);
  const fileSystemSemantics = exactFileSystemSemantics(
    fileSystemSemanticsInput
  );
  const executablePath = exactExecutablePath(executablePathInput, platform);

  if (isolatedStateRoot !== undefined) {
    const root = validateDesktopAbsolutePath(isolatedStateRoot, {
      platform,
      label: "격리 자동실행 상태"
    });
    const statePath = targetPaths.join(root, `autostart-${target}.json`);
    const storagePath = resolvedStatePath(statePath, fileSystemSemantics);
    const body = `${JSON.stringify({
      schema: ENGINE_AUTOSTART_SCHEMA,
      target,
      executablePath,
      arguments: [ENGINE_BACKGROUND_ARGUMENT],
      registered: true
    }, null, 2)}\n`;
    await assertAbsentOrManagedFile(
      storagePath,
      (existing) => parseLoginItemManagedState(existing, target) !== null
    );
    await writeRegularFileAtomically(
      storagePath,
      body,
      fileSystemSemantics.enforcePosixPermissions
    );
    if (await readExactRegularFile(storagePath) !== body) {
      throw new Error("격리 자동실행 상태 readback에 실패했습니다.");
    }
    return registration(target, "isolated-smoke", executablePath, statePath);
  }

  if (platform === "linux") {
    if (typeof linuxConfigRoot !== "string") {
      throw new TypeError("Linux XDG config root가 필요합니다.");
    }
    const configRoot = validateDesktopAbsolutePath(linuxConfigRoot, {
      platform,
      label: "Linux XDG config"
    });
    const statePath = targetPaths.join(
      configRoot,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    );
    const storagePath = resolvedStatePath(statePath, fileSystemSemantics);
    const body = linuxEngineAutostartContent(executablePath, statePath);
    await assertAbsentOrManagedFile(
      storagePath,
      isManagedLinuxEngineAutostartContent
    );
    await writeRegularFileAtomically(
      storagePath,
      body,
      fileSystemSemantics.enforcePosixPermissions
    );
    if (await readExactRegularFile(storagePath) !== body) {
      throw new Error("Linux XDG 자동실행 readback에 실패했습니다.");
    }
    return registration(target, "xdg-autostart", executablePath, statePath);
  }

  if (!loginItem) {
    throw new TypeError("Electron login-item adapter가 필요합니다.");
  }
  const managedStatePath = stateRoot === undefined
    ? null
    : targetPaths.join(validateDesktopAbsolutePath(stateRoot, {
      platform,
      label: "자동실행 관리 상태"
    }), `engine-autostart-${target}.json`);
  const managedStoragePath = managedStatePath === null
    ? null
    : resolvedStatePath(managedStatePath, fileSystemSemantics);
  let priorState: Readonly<LoginItemManagedState> | null = null;
  if (managedStoragePath) {
    await assertAbsentOrManagedFile(
      managedStoragePath,
      (body) => parseLoginItemManagedState(body, target) !== null
    );
    if (await existingRegularFile(managedStoragePath)) {
      priorState = parseLoginItemManagedState(
        await readExactRegularFile(managedStoragePath),
        target
      );
    }
  }
  if (priorState && priorState.executablePath !== executablePath) {
    const staleSettings = loginItemSettings(
      platform as "darwin" | "win32",
      priorState.executablePath,
      false
    );
    loginItem.set(staleSettings);
    if (!loginItemDisabled(
      platform as "darwin" | "win32",
      loginItem.get(staleSettings)
    )) {
      throw new Error(`${platform}의 이전 로그인 자동실행 항목을 제거하지 못했습니다.`);
    }
  }
  const settings = loginItemSettings(platform, executablePath);
  loginItem.set(settings);
  const state = loginItem.get(settings);
  const approvalRequired = platform === "darwin"
    && state.status === "requires-approval";
  if (!approvalRequired && !loginItemEnabled(platform, state)) {
    throw new Error(`${platform} 로그인 자동실행 readback이 등록 상태가 아닙니다.`);
  }
  if (managedStoragePath) {
    const body = `${JSON.stringify(
      loginItemManagedState(target, executablePath),
      null,
      2
    )}\n`;
    await writeRegularFileAtomically(
      managedStoragePath,
      body,
      fileSystemSemantics.enforcePosixPermissions
    );
  }
  return registration(
    target,
    "electron-login-item",
    executablePath,
    managedStatePath,
    approvalRequired
      ? { registered: false, approvalRequired: true }
      : undefined
  );
}

function removal(
  target: DesktopBundleTarget,
  method: EngineAutostartRemoval["method"],
  statePath: string | null
): Readonly<EngineAutostartRemoval> {
  return Object.freeze({
    schema: ENGINE_AUTOSTART_SCHEMA,
    target,
    method,
    removed: true,
    readBack: true,
    statePath
  });
}

export async function removeEngineAutostart({
  target: targetInput,
  executablePath: executablePathInput,
  linuxConfigRoot,
  loginItem,
  isolatedStateRoot,
  stateRoot,
  fileSystemSemantics: fileSystemSemanticsInput
}: {
  readonly target: DesktopBundleTarget | string;
  readonly executablePath: string;
  readonly linuxConfigRoot?: string;
  readonly loginItem?: Readonly<LoginItemAdapter>;
  readonly isolatedStateRoot?: string;
  readonly stateRoot?: string;
  readonly fileSystemSemantics?: Readonly<EngineAutostartFileSystemSemantics>;
}): Promise<Readonly<EngineAutostartRemoval>> {
  const target = exactSupportedTarget(targetInput);
  const platform = targetPlatform(target);
  const targetPaths = targetPathImplementation(platform);
  const fileSystemSemantics = exactFileSystemSemantics(
    fileSystemSemanticsInput
  );
  const executablePath = exactExecutablePath(executablePathInput, platform);

  if (isolatedStateRoot !== undefined) {
    const root = validateDesktopAbsolutePath(isolatedStateRoot, {
      platform,
      label: "격리 자동실행 상태"
    });
    const statePath = targetPaths.join(root, `autostart-${target}.json`);
    const storagePath = resolvedStatePath(statePath, fileSystemSemantics);
    await removeManagedRegularFile(
      storagePath,
      (body) => parseLoginItemManagedState(body, target) !== null
    );
    return removal(target, "isolated-smoke", statePath);
  }

  if (platform === "linux") {
    if (typeof linuxConfigRoot !== "string") {
      throw new TypeError("Linux XDG config root가 필요합니다.");
    }
    const configRoot = validateDesktopAbsolutePath(linuxConfigRoot, {
      platform,
      label: "Linux XDG config"
    });
    const statePath = targetPaths.join(
      configRoot,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    );
    const storagePath = resolvedStatePath(statePath, fileSystemSemantics);
    await removeManagedRegularFile(
      storagePath,
      isManagedLinuxEngineAutostartContent
    );
    return removal(target, "xdg-autostart", statePath);
  }

  if (!loginItem) {
    throw new TypeError("Electron login-item adapter가 필요합니다.");
  }
  const managedStatePath = stateRoot === undefined
    ? null
    : targetPaths.join(validateDesktopAbsolutePath(stateRoot, {
      platform,
      label: "자동실행 관리 상태"
    }), `engine-autostart-${target}.json`);
  const managedStoragePath = managedStatePath === null
    ? null
    : resolvedStatePath(managedStatePath, fileSystemSemantics);
  let priorExecutablePath: string | null = null;
  if (managedStoragePath && await existingRegularFile(managedStoragePath)) {
    const prior = parseLoginItemManagedState(
      await readExactRegularFile(managedStoragePath),
      target
    );
    if (!prior) {
      throw new Error("자동실행 관리 상태가 Kirinuki 형식이 아닙니다.");
    }
    priorExecutablePath = prior.executablePath;
  }
  for (const candidate of new Set([
    priorExecutablePath,
    executablePath
  ].filter((value): value is string => value !== null))) {
    const settings = loginItemSettings(platform, candidate, false);
    loginItem.set(settings);
    if (!loginItemDisabled(platform, loginItem.get(settings))) {
      throw new Error(`${platform} 로그인 자동실행 제거 readback에 실패했습니다.`);
    }
  }
  if (managedStoragePath) {
    await removeManagedRegularFile(
      managedStoragePath,
      (body) => parseLoginItemManagedState(body, target) !== null
    );
  }
  return removal(target, "electron-login-item", managedStatePath);
}
