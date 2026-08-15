#!/usr/bin/env node

import {
  accessSync,
  closeSync,
  constants as fsConstants,
  openSync
} from "node:fs";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { createInterface } from "node:readline/promises";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { typescriptCommandArgs } from "./typescript-runtime.js";
import { STREAMING_BRIDGE_PROTOCOL } from "../src/web/streaming-bridge-protocol.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN,
  isKirinukiStudioOrigin
} from "../src/lib/local-runtime-origin.js";
import type {
  KirinukiStudioOrigin
} from "../src/lib/local-runtime-origin.js";
import {
  KIRINUKI_DEEP_LINK,
  parseKirinukiDeepLink,
  validateSourceUrl
} from "../src/lib/kirinuki-deep-link.js";

export {
  KIRINUKI_DEEP_LINK,
  parseKirinukiDeepLink,
  validateSourceUrl
};

export const HELPER_SCHEMA = "chzzk-kirinuki-linux-helper/v1";
export const APP_STATUS_SCHEMA = "kirinuki-app/v1";
export const MINIMUM_NODE_VERSION = "22.17.0";
export const MINIMUM_BROWSER_VERSION = 120;
export const DEFAULT_SOURCE_URL = "https://chzzk.naver.com/video/14514980";
export const LOCAL_STUDIO_URL = "http://127.0.0.1:4320/";
export const APP_LIFECYCLE_PROTOCOL = "kirinuki-app-lifecycle/v1";
export const APP_LIFECYCLE_MAX_REQUEST_BYTES = 4_608;
export const KIRINUKI_DESKTOP_LAUNCH_ENV = "KIRINUKI_DESKTOP_LAUNCH";
const APP_LIFECYCLE_MAX_RESPONSE_BYTES = 1_024;
const APP_LIFECYCLE_READ_TIMEOUT_MS = 2_000;
const APP_LIFECYCLE_OPEN_TIMEOUT_MS = 5 * 60_000;
const APP_LIFECYCLE_RESULT_CACHE_LIMIT = 128;
export const STREAMING_COMPANION_PROTOCOL_OPTION =
  "--kirinuki-streaming-companion-protocol";
export const STUDIO_ORIGIN_IDENTITY_OPTION =
  "--kirinuki-studio-origin";
export const BROWSER_CANDIDATES = Object.freeze([
  "chromium",
  "chromium-browser"
] as const);
const MODES = Object.freeze(["audseg", "whisper"] as const);
const PROFILES = Object.freeze([
  "draft",
  "auto",
  "light",
  "quality"
] as const);
const BACKENDS = Object.freeze(["auto", "cpu", "cuda"] as const);
const COMMANDS = Object.freeze([
  "setup",
  "doctor",
  "start",
  "open",
  "status",
  "stop",
  "help"
] as const);

type CaptionMode = typeof MODES[number];
type CaptionProfile = typeof PROFILES[number];
type CaptionBackend = typeof BACKENDS[number];
type HelperCommand = typeof COMMANDS[number];
type Writable = NodeJS.WritableStream & {
  isTTY?: boolean;
};
type Readable = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

export interface LinuxHelperOptions {
  mode: CaptionMode | null;
  profile: CaptionProfile;
  backend: CaptionBackend;
  browser: string | null;
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  url: string | null;
}

export interface ParsedLinuxHelperArgs {
  command: HelperCommand | "";
  options: LinuxHelperOptions;
}

export interface AppBootstrapState {
  configured: boolean;
  buildCurrent: boolean;
  entrypointsCurrent: boolean;
  mediaEngineCurrent: boolean;
  captionEngineCurrent: boolean;
}

export type AppBootstrapReason =
  | "configuration"
  | "build"
  | "entrypoints"
  | "media-engine"
  | "caption-engine";

export interface LinuxHelperPaths {
  configRoot: string;
  stateRoot: string;
  settingsPath: string;
  packageRoot: string;
  streamingCompanionRoot: string;
  legacyExtensionRoot: string;
  browserProfileRoot: string;
  browserLogPath: string;
  captionLogPath: string;
  userLauncherPath: string;
  desktopEntryPath: string;
  legacyDesktopEntryPath: string;
}

interface LinuxHelperSettings {
  schema: typeof HELPER_SCHEMA;
  mode: CaptionMode;
  browser: string | null;
  updatedAt?: string;
}

interface BrowserReport {
  available: boolean;
  binary: string | null;
  major: number | null;
  product: "chromium" | "chrome" | "unknown";
  supported: boolean;
  version: string;
}

export type DedicatedBrowserRuntimeState =
  | "stopped"
  | "clean"
  | "ready"
  | "update-required"
  | "legacy-extension"
  | "conflict"
  | "unavailable";

export interface DedicatedBrowserRuntimeReport {
  state: DedicatedBrowserRuntimeState;
  mainPid: number | null;
  profileProcessCount: number;
  transitionRequired: boolean;
  reason: string;
}

export type DedicatedBrowserPreparationDisposition =
  | "launch"
  | "reuse-app-runtime"
  | "transition-exact-legacy"
  | "reject-clean-without-signal"
  | "reject-stale-minimal-without-signal"
  | "reject-unverified";

export interface DedicatedBrowserProcessSnapshot {
  pid: number;
  parentPid: number;
  ownerUid: number;
  startTimeTicks: string;
  executable: string;
  argv: readonly string[];
}

export interface BrowserLauncherProcessIdentity {
  pid: number;
  ownerUid: number;
  startTimeTicks: string;
}

export type DedicatedBrowserProcessClassification =
  | "unrelated"
  | "profile-child"
  | "clean-root"
  | "app-runtime-root"
  | "stale-app-runtime-root"
  | "legacy-extension-root"
  | "conflict";

interface StudioServerStatus {
  host?: string;
  port?: number;
  url?: string;
  studioOrigin?: KirinukiStudioOrigin | null;
  ownership?: "managed" | "down" | "foreign";
  ready?: boolean;
  managerPid?: number | null;
  pidIdentityVerified?: boolean;
  healthIdentityVerified?: boolean;
  pidPath?: string;
  logPath?: string;
}

type StudioServerStatusResult =
  | { ok: true; value: StudioServerStatus }
  | { ok: false; error: string };

interface CaptionStatus {
  configured?: boolean;
  configuredOrigin?: string | null;
  expectedOrigin?: string;
  originMatchesLocalStudio?: boolean;
  originMatchesCurrentPath?: boolean;
  originMatchesCurrentStudio?: boolean;
  systemdUser?: boolean;
  endpoints?: {
    stt?: boolean;
    gateway?: boolean;
  };
  runtime?: {
    manager?: string;
    managedForeground?: boolean;
  };
  required?: boolean;
  message?: string;
}

type CaptionStatusResult =
  | { ok: true; value: CaptionStatus }
  | { ok: false; error: string };

interface VodRuntimeStatus {
  configured?: boolean;
  configError?: string | null;
  origin?: {
    configured?: string | null;
    matchesLocalStudio?: boolean;
    matchesCurrentStudio?: boolean;
  };
  ytDlp?: {
    version?: string;
    path?: string;
    ready?: boolean;
  };
  toolchainReady?: boolean;
  mediaReady?: boolean;
  gateway?: boolean;
  gatewayPortOccupied?: boolean;
  managed?: boolean;
  managerPid?: number | null;
}

type VodRuntimeStatusResult =
  | { ok: true; value: VodRuntimeStatus }
  | { ok: false; error: string };

interface LinuxHelperContext {
  env: NodeJS.ProcessEnv;
  studioOrigin: KirinukiStudioOrigin;
  platform: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  paths: LinuxHelperPaths;
  setExitCode(value: number): void;
}

type LinuxHelperContextOverrides = Partial<LinuxHelperContext>;

interface LinuxEnvironmentReport {
  schema: typeof HELPER_SCHEMA;
  linux: boolean;
  node: {
    version: string;
    supported: boolean;
  };
  npm: {
    available: boolean;
    binary: string | null;
  };
  browser: BrowserReport;
  studioBuild: {
    root: string;
    built: boolean;
  };
  browserProfile: {
    root: string;
    overridden: boolean;
    runtime: DedicatedBrowserRuntimeReport;
  };
  entrypoints: UserEntrypointReport;
  mode: CaptionMode;
  nativeTools: Record<string, boolean>;
  caption: CaptionStatusResult;
  vod: VodRuntimeStatusResult;
  studioServer: StudioServerStatusResult;
  ready: boolean;
}

export interface UserEntrypointState {
  path: string;
  installed: boolean;
  current: boolean;
  actualTarget: string | null;
}

export interface UserEntrypointReport {
  launcher: UserEntrypointState;
  desktop: UserEntrypointState;
  legacyDesktop: {
    path: string;
    present: boolean;
    recognized: boolean;
    actualTarget: string | null;
  };
  current: boolean;
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const stackCliPath = path.join(
  packageRoot,
  "scripts",
  "local-caption-stack.ts"
);
const vodRuntimeCliPath = path.join(
  packageRoot,
  "scripts",
  "local-vod-runtime.ts"
);
const studioServerCliPath = path.join(
  packageRoot,
  "scripts",
  "local-studio-server.ts"
);

function captionStackArgs(...args: readonly string[]) {
  return typescriptCommandArgs(stackCliPath, ...args);
}

function vodRuntimeArgs(...args: readonly string[]) {
  return typescriptCommandArgs(vodRuntimeCliPath, ...args);
}

function studioServerArgs(...args: readonly string[]) {
  return typescriptCommandArgs(studioServerCliPath, ...args);
}

export function studioUrlForOrigin(
  studioOrigin: KirinukiStudioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
): string {
  if (studioOrigin !== KIRINUKI_LOCAL_STUDIO_ORIGIN) {
    throw new TypeError("Kirinuki 앱은 앱 내부 편집 화면만 실행합니다.");
  }
  return LOCAL_STUDIO_URL;
}

export function studioServerStartArgs(
  studioOrigin: KirinukiStudioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
): string[] {
  studioUrlForOrigin(studioOrigin);
  return studioServerArgs("start");
}

function exactStudioOriginEnvironment(
  environment: NodeJS.ProcessEnv,
  studioOrigin: KirinukiStudioOrigin
): NodeJS.ProcessEnv {
  const next = { ...environment };
  next.KIRINUKI_ALLOWED_ORIGIN = studioOrigin;
  return next;
}

function line(stream: Writable, value = "") {
  stream.write(`${value}\n`);
}

export function versionAtLeast(actual: unknown, required: unknown): boolean {
  const parse = (value: unknown) => String(value || "")
    .replace(/^v/u, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));
  const left = parse(actual);
  const right = parse(required);
  if (
    left.length < 2
    || right.length < 2
    || [...left, ...right].some((part) => !Number.isInteger(part))
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart;
    }
  }
  return true;
}

function requiredChoice<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  const normalized = String(value || "").trim().toLowerCase();
  if (!allowed.includes(normalized as T)) {
    throw new TypeError(
      `${label}은 ${allowed.join(", ")} 중 하나여야 합니다.`
    );
  }
  return normalized as T;
}

export function parseLinuxHelperArgs(
  argv: readonly unknown[] = []
): ParsedLinuxHelperArgs {
  const values = [...argv].map((value) => String(value));
  const first = values[0];
  const deepLink = first?.startsWith("kirinuki:")
    ? parseKirinukiDeepLink(first)
    : null;
  const command = deepLink
    ? (values.shift(), "open")
    : (
      !first || first.startsWith("-")
        ? (!first ? "" : "help")
        : values.shift()
    );
  const options: LinuxHelperOptions = {
    mode: null,
    profile: "draft",
    backend: "auto",
    browser: null,
    yes: false,
    dryRun: false,
    json: false,
    url: deepLink?.sourceUrl ?? null
  };
  const positionals: string[] = [];

  if (deepLink && values.length > 0) {
    throw new TypeError("Kirinuki 앱 링크는 다른 옵션이나 인자와 함께 쓸 수 없습니다.");
  }

  const takeValue = (
    flag: string,
    inlineValue: string | undefined
  ): string => {
    const value = inlineValue ?? values.shift();
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${flag} 값이 필요합니다.`);
    }
    return value;
  };

  while (values.length > 0) {
    const raw = values.shift();
    if (raw === undefined) {
      break;
    }
    if (raw === "--") {
      positionals.push(...values);
      values.length = 0;
      break;
    }
    if (!raw.startsWith("-")) {
      positionals.push(raw);
      continue;
    }
    const [flag, inlineValue] = raw.split("=", 2);
    if (
      flag
      && /api[-_]?key|token|secret|password|credential/iu.test(flag)
    ) {
      throw new TypeError("비밀 값은 Kirinuki 앱 옵션으로 받을 수 없습니다.");
    }
    if (flag === "--mode") {
      options.mode = requiredChoice(
        takeValue(flag, inlineValue),
        MODES,
        "mode"
      );
      continue;
    }
    if (flag === "--profile") {
      options.profile = requiredChoice(
        takeValue(flag, inlineValue),
        PROFILES,
        "profile"
      );
      continue;
    }
    if (flag === "--backend") {
      options.backend = requiredChoice(
        takeValue(flag, inlineValue),
        BACKENDS,
        "backend"
      );
      continue;
    }
    if (flag === "--browser") {
      options.browser = takeValue(flag, inlineValue);
      continue;
    }
    if (flag === "--yes" || flag === "-y") {
      options.yes = true;
      continue;
    }
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      return { command: "help", options };
    }
    throw new TypeError(`알 수 없는 옵션입니다: ${raw}`);
  }

  if (command && !COMMANDS.includes(command as HelperCommand)) {
    throw new TypeError(`알 수 없는 명령입니다: ${command}`);
  }
  if (positionals.length > 1) {
    throw new TypeError("영상 URL은 하나만 지정할 수 있습니다.");
  }
  if (positionals.length === 1) {
    if (!["start", "open"].includes(command || "")) {
      throw new TypeError(`${command || "이 명령"}에는 위치 인자를 쓸 수 없습니다.`);
    }
    options.url = validateSourceUrl(positionals[0]);
  }
  if (
    options.browser
    && !["setup", "doctor", "start", "open"].includes(command || "")
  ) {
    throw new TypeError(`--browser는 ${command || "이 명령"}에서 쓸 수 없습니다.`);
  }
  if (
    (options.profile !== "draft" || options.backend !== "auto")
    && command !== "setup"
  ) {
    throw new TypeError("--profile과 --backend는 setup에서만 쓸 수 있습니다.");
  }
  return {
    command: command as HelperCommand | "",
    options
  };
}

export function resolveLinuxHelperPaths({
  env = process.env,
  homeDir = os.homedir(),
  packageDir = packageRoot
}: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  packageDir?: string;
} = {}): Readonly<LinuxHelperPaths> {
  const absoluteHome = path.resolve(homeDir);
  const configBase = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(absoluteHome, ".config");
  const stateBase = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(absoluteHome, ".local", "state");
  const dataBase = env.XDG_DATA_HOME
    ? path.resolve(env.XDG_DATA_HOME)
    : path.join(absoluteHome, ".local", "share");
  const configRoot = path.join(configBase, "kirinuki-studio");
  const stateRoot = path.join(stateBase, "kirinuki-studio");
  const resolvedPackageRoot = explicitAbsolutePath(
    env.KIRINUKI_PACKAGE_ROOT,
    "KIRINUKI_PACKAGE_ROOT",
    path.resolve(packageDir)
  );
  const legacyExtensionRoot = explicitAbsolutePath(
    env.KIRINUKI_EXTENSION_ROOT,
    "KIRINUKI_EXTENSION_ROOT",
    path.join(resolvedPackageRoot, "extension")
  );
  const streamingCompanionRoot = explicitAbsolutePath(
    env.KIRINUKI_STREAMING_COMPANION_ROOT,
    "KIRINUKI_STREAMING_COMPANION_ROOT",
    path.join(resolvedPackageRoot, "streaming-companion")
  );
  const browserProfileRoot = explicitAbsolutePath(
    env.KIRINUKI_BROWSER_PROFILE_ROOT,
    "KIRINUKI_BROWSER_PROFILE_ROOT",
    path.join(absoluteHome, "Kirinuki", "browser-profile")
  );
  return Object.freeze({
    configRoot,
    stateRoot,
    settingsPath: path.join(configRoot, "helper.json"),
    packageRoot: resolvedPackageRoot,
    streamingCompanionRoot,
    legacyExtensionRoot,
    browserProfileRoot,
    browserLogPath: path.join(stateRoot, "browser.log"),
    captionLogPath: path.join(stateRoot, "caption-stack.log"),
    userLauncherPath: path.join(absoluteHome, ".local", "bin", "kirinuki"),
    desktopEntryPath: path.join(
      dataBase,
      "applications",
      "kirinuki-helper.desktop"
    ),
    legacyDesktopEntryPath: path.join(
      dataBase,
      "applications",
      "chromium-kirinuki.desktop"
    )
  });
}

function explicitAbsolutePath(
  value: string | undefined,
  name: string,
  fallback: string
): string {
  if (value === undefined) {
    return path.resolve(fallback);
  }
  if (
    !value
    || value.trim() !== value
    || /[\0\r\n]/u.test(value)
    || !path.isAbsolute(value)
  ) {
    throw new TypeError(
      `${name}은 앞뒤 공백이나 줄바꿈이 없는 절대경로여야 합니다.`
    );
  }
  return path.resolve(value);
}

function executableAt(candidate: string): string | null {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

export function resolveExecutable(
  requested: string | null | undefined,
  candidates: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const names = requested ? [requested] : [...candidates];
  const directories = String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const name of names) {
    if (name.includes(path.sep)) {
      const direct = executableAt(path.resolve(name));
      if (direct) {
        return direct;
      }
      continue;
    }
    for (const directory of directories) {
      const candidate = executableAt(path.resolve(directory, name));
      if (candidate) {
        return candidate;
      }
    }
  }
  return null;
}

export function parseBrowserMajor(versionOutput: unknown): number | null {
  const match = /(?:Chromium|Chrome)\s+(\d+)(?:\.|$)/iu.exec(
    String(versionOutput || "")
  );
  return match ? Number(match[1]) : null;
}

export function browserProduct(
  versionOutput: unknown
): BrowserReport["product"] {
  const value = String(versionOutput || "");
  if (/\bChromium\s+\d+(?:\.|$)/iu.test(value)) {
    return "chromium";
  }
  if (/\b(?:Google\s+)?Chrome(?:\s+for\s+Testing)?\s+\d+(?:\.|$)/iu.test(
    value
  )) {
    return "chrome";
  }
  return "unknown";
}

function withoutSecrets(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const safe = { ...environment };
  for (const name of Object.keys(safe)) {
    if (
      /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_?KEY|ACCESS_?KEY)(?:_|$)/iu.test(name)
    ) {
      delete safe[name];
    }
  }
  // The extension-era launcher may still be the parent of this one process.
  // Never forward its artifact path into current localhost companions.
  delete safe.KIRINUKI_EXTENSION_ROOT;
  delete safe[KIRINUKI_DESKTOP_LAUNCH_ENV];
  return safe;
}

function commandResult(file: string, args: readonly string[], {
  cwd = packageRoot,
  env = withoutSecrets(),
  timeout = 10_000
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
} = {}) {
  const result = spawnSync(file, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 4 * 1024 * 1024
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error || null
  };
}

export interface StartupFailureReport {
  readonly logPath: string | null;
  readonly notification: "zenity" | "notify-send" | null;
}

function privateStartupFailureMessage(
  error: unknown,
  env: NodeJS.ProcessEnv
): string {
  const raw = error instanceof Error ? error.message : String(error);
  let value = raw
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[영상 URL 생략]")
    .replace(
      /\b(api[-_]?key|token|secret|password|credential)=([^\s]+)/giu,
      "$1=[비밀 값 생략]"
    )
    .replace(/[\0-\x1f\x7f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const home = String(env.HOME || "");
  if (home) {
    value = value.split(home).join("$HOME");
  }
  return (value || "알 수 없는 시작 오류").slice(0, 2_048);
}

async function writeLastStartupFailure(
  stateRoot: string,
  message: string
): Promise<string> {
  const root = path.resolve(stateRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let rootMetadata = await lstat(root);
  const currentUid = typeof process.getuid === "function"
    ? process.getuid()
    : null;
  if (
    !rootMetadata.isDirectory()
    || rootMetadata.isSymbolicLink()
    || (currentUid !== null && rootMetadata.uid !== currentUid)
  ) {
    throw new Error("Kirinuki 상태 폴더를 안전한 사용자 폴더로 확인하지 못했습니다.");
  }
  await chmod(root, 0o700);
  rootMetadata = await lstat(root);
  if ((rootMetadata.mode & 0o077) !== 0) {
    throw new Error("Kirinuki 상태 폴더 권한을 0700으로 제한하지 못했습니다.");
  }

  const destination = path.join(root, "last-startup-error.log");
  const temporary = path.join(
    root,
    `.last-startup-error.${process.pid}.${Date.now()}.tmp`
  );
  const contents = [
    "Kirinuki 마지막 시작 오류",
    "가장 최근 실패 한 건만 이 기기에 덮어쓰며 서버로 전송하지 않습니다.",
    `오류: ${message}`,
    "복구: 앱을 완전히 닫은 뒤 다시 열고, 계속 실패하면 kirinuki doctor를 실행하세요.",
    ""
  ].join("\n");
  try {
    await writeFile(temporary, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    const temporaryMetadata = await lstat(temporary);
    if (
      !temporaryMetadata.isFile()
      || temporaryMetadata.isSymbolicLink()
      || temporaryMetadata.nlink !== 1
      || (temporaryMetadata.mode & 0o777) !== 0o600
      || (currentUid !== null && temporaryMetadata.uid !== currentUid)
    ) {
      throw new Error("Kirinuki 시작 오류 로그 임시 파일이 안전하지 않습니다.");
    }
    await rename(temporary, destination);
    const finalMetadata = await lstat(destination);
    if (
      !finalMetadata.isFile()
      || finalMetadata.isSymbolicLink()
      || finalMetadata.nlink !== 1
      || finalMetadata.dev !== temporaryMetadata.dev
      || finalMetadata.ino !== temporaryMetadata.ino
      || (finalMetadata.mode & 0o777) !== 0o600
    ) {
      throw new Error("Kirinuki 시작 오류 로그를 안전하게 확정하지 못했습니다.");
    }
    return destination;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

/**
 * Desktop entries use Terminal=false, so a launch failure must remain visible.
 * Only the latest redacted error is kept locally; no argv, source URL,
 * environment dump, telemetry, or server request is recorded.
 */
export async function reportLinuxHelperStartupFailure(
  error: unknown,
  {
    env = process.env,
    platform = process.platform,
    stderr = process.stderr,
    stateRoot
  }: {
    env?: NodeJS.ProcessEnv;
    platform?: string;
    stderr?: Writable;
    stateRoot?: string;
  } = {}
): Promise<StartupFailureReport> {
  const reason = privateStartupFailureMessage(error, env);
  line(stderr, `Kirinuki 앱 실행 실패: ${reason}`);
  let logPath: string | null = null;
  try {
    const resolvedStateRoot = stateRoot || resolveLinuxHelperPaths({
      env,
      homeDir: env.HOME || os.homedir()
    }).stateRoot;
    logPath = await writeLastStartupFailure(resolvedStateRoot, reason);
  } catch (logError) {
    line(
      stderr,
      `시작 오류 로그를 남기지 못했습니다: ${privateStartupFailureMessage(logError, env)}`
    );
  }

  const desktopLaunch = env[KIRINUKI_DESKTOP_LAUNCH_ENV] === "1";
  const graphicalSession = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  if (
    platform !== "linux"
    || !desktopLaunch
    || !graphicalSession
    || stderr.isTTY
  ) {
    return Object.freeze({ logPath, notification: null });
  }

  const recovery = logPath
    ? `앱을 완전히 닫은 뒤 다시 열어 주세요. 계속 실패하면 kirinuki doctor를 실행하세요.\n\n오류 기록: ${logPath}`
    : "앱을 완전히 닫은 뒤 다시 열어 주세요. 계속 실패하면 터미널에서 kirinuki doctor를 실행하세요.";
  const zenity = resolveExecutable(null, ["zenity"], env);
  if (zenity) {
    const shown = commandResult(zenity, [
      "--error",
      "--title=Kirinuki",
      "--width=520",
      "--no-markup",
      `--text=${recovery}`
    ], {
      env: withoutSecrets(env),
      timeout: 10_000
    });
    if (shown.ok) {
      return Object.freeze({ logPath, notification: "zenity" });
    }
  }
  const notifySend = resolveExecutable(null, ["notify-send"], env);
  if (notifySend) {
    const shown = commandResult(notifySend, [
      "--app-name=Kirinuki",
      "--urgency=critical",
      "--expire-time=10000",
      "Kirinuki를 열지 못했습니다",
      "앱을 완전히 닫은 뒤 다시 열어 주세요. 계속 실패하면 터미널에서 kirinuki doctor를 실행하세요. 가장 최근 오류는 Kirinuki 상태 폴더의 last-startup-error.log에 있습니다."
    ], {
      env: withoutSecrets(env),
      timeout: 5_000
    });
    if (shown.ok) {
      return Object.freeze({ logPath, notification: "notify-send" });
    }
  }
  return Object.freeze({ logPath, notification: null });
}

export function inspectBrowser({
  requested = null,
  env = process.env
}: {
  requested?: string | null;
  env?: NodeJS.ProcessEnv;
} = {}): BrowserReport {
  const binary = resolveExecutable(
    requested || env.KIRINUKI_BROWSER_BINARY,
    BROWSER_CANDIDATES,
    env
  );
  if (!binary) {
    return {
      available: false,
      binary: null,
      major: null,
      product: "unknown",
      supported: false,
      version: ""
    };
  }
  const result = commandResult(binary, ["--version"], {
    env: withoutSecrets(env),
    timeout: 5_000
  });
  const version = `${result.stdout}\n${result.stderr}`.trim();
  const major = parseBrowserMajor(version);
  const product = browserProduct(version);
  return {
    available: true,
    binary,
    major,
    product,
    supported: Boolean(
      result.ok
      // Official branded Chrome removed command-line unpacked-extension
      // loading. The local automatic path therefore requires Chromium; a
      // future hosted release can use a separately installed store companion.
      && product === "chromium"
      && major !== null
      && Number.isInteger(major)
      && major >= MINIMUM_BROWSER_VERSION
    ),
    version
  };
}

export function inspectPreferredBrowser({
  explicit = null,
  stored = null,
  env = process.env
}: {
  explicit?: string | null;
  stored?: string | null;
  env?: NodeJS.ProcessEnv;
} = {}): BrowserReport {
  const preferred = explicit || stored;
  const first = inspectBrowser({ requested: preferred, env });
  if (explicit || first.supported || !stored) {
    return first;
  }
  return inspectBrowser({ env });
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readSettings(
  paths: LinuxHelperPaths
): Promise<LinuxHelperSettings | null> {
  try {
    const parsed = JSON.parse(
      await readFile(paths.settingsPath, "utf8")
    ) as Partial<LinuxHelperSettings>;
    if (
      parsed?.schema !== HELPER_SCHEMA
      || typeof parsed.mode !== "string"
      || !MODES.includes(parsed.mode as CaptionMode)
      || (
        parsed.browser !== null
        && typeof parsed.browser !== "string"
      )
    ) {
      return null;
    }
    return parsed as LinuxHelperSettings;
  } catch {
    return null;
  }
}

async function writeSettings(
  paths: LinuxHelperPaths,
  settings: Pick<LinuxHelperSettings, "mode" | "browser">
) {
  await mkdir(paths.configRoot, { recursive: true, mode: 0o700 });
  const temporary = `${paths.settingsPath}.${process.pid}.tmp`;
  const body = `${JSON.stringify({
    schema: HELPER_SCHEMA,
    mode: settings.mode,
    browser: settings.browser || null,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`;
  try {
    await writeFile(temporary, body, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, paths.settingsPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function desktopExecQuote(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")}"`;
}

function entrypointMetadata(
  paths: LinuxHelperPaths,
  root = packageRoot
) {
  return Object.freeze({
    packageRoot: path.resolve(root),
    browserProfileRoot: path.resolve(paths.browserProfileRoot),
    streamingCompanionRoot: path.resolve(paths.streamingCompanionRoot)
  });
}

type EntrypointMetadata = ReturnType<typeof entrypointMetadata>;

interface LegacyExtensionEntrypointMetadata extends EntrypointMetadata {
  extensionRoot: string;
}

type PreviousWebEntrypointMetadata = Omit<
  EntrypointMetadata,
  "streamingCompanionRoot"
>;

function renderUserLauncher(metadata: EntrypointMetadata): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify(metadata)}`,
    `export KIRINUKI_PACKAGE_ROOT=${shellSingleQuote(metadata.packageRoot)}`,
    `export KIRINUKI_BROWSER_PROFILE_ROOT=${shellSingleQuote(metadata.browserProfileRoot)}`,
    `export KIRINUKI_STREAMING_COMPANION_ROOT=${shellSingleQuote(metadata.streamingCompanionRoot)}`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    `exec ${shellSingleQuote(path.join(metadata.packageRoot, "kirinuki.sh"))} "$@"`,
    ""
  ].join("\n");
}

function renderPreviousWebUserLauncher(
  metadata: PreviousWebEntrypointMetadata
): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify(metadata)}`,
    `export KIRINUKI_BROWSER_PROFILE_ROOT=${shellSingleQuote(metadata.browserProfileRoot)}`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    `exec ${shellSingleQuote(path.join(metadata.packageRoot, "kirinuki.sh"))} \"$@\"`,
    ""
  ].join("\n");
}

function renderPreviousWebUserLauncherWithPackageRoot(
  metadata: PreviousWebEntrypointMetadata
): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify(metadata)}`,
    `export KIRINUKI_PACKAGE_ROOT=${shellSingleQuote(metadata.packageRoot)}`,
    `export KIRINUKI_BROWSER_PROFILE_ROOT=${shellSingleQuote(metadata.browserProfileRoot)}`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    `exec ${shellSingleQuote(path.join(metadata.packageRoot, "kirinuki.sh"))} \"$@\"`,
    ""
  ].join("\n");
}

function renderLegacyExtensionUserLauncher(
  metadata: Omit<LegacyExtensionEntrypointMetadata, "streamingCompanionRoot">
): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify(metadata)}`,
    `export KIRINUKI_PACKAGE_ROOT=${shellSingleQuote(metadata.packageRoot)}`,
    `export KIRINUKI_EXTENSION_ROOT=${shellSingleQuote(metadata.extensionRoot)}`,
    `export KIRINUKI_BROWSER_PROFILE_ROOT=${shellSingleQuote(metadata.browserProfileRoot)}`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    `exec ${shellSingleQuote(path.join(metadata.packageRoot, "kirinuki.sh"))} \"$@\"`,
    ""
  ].join("\n");
}

export function userLauncherContent(
  paths: LinuxHelperPaths,
  root = packageRoot
): string {
  return renderUserLauncher(entrypointMetadata(paths, root));
}

function renderDesktopEntry(
  paths: LinuxHelperPaths,
  {
    marker,
    terminal
  }: {
    marker: boolean;
    terminal: boolean;
  }
): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Kirinuki",
    "Comment=치지직·YouTube·SOOP 영상을 편집하는 Kirinuki 앱",
    `Exec=/usr/bin/env ${KIRINUKI_DESKTOP_LAUNCH_ENV}=1 ${desktopExecQuote(paths.userLauncherPath)} %u`,
    ...(marker ? [`X-KirinukiHelper-Managed=${HELPER_SCHEMA}`] : []),
    `Terminal=${terminal ? "true" : "false"}`,
    "MimeType=x-scheme-handler/kirinuki;",
    "Categories=AudioVideo;Video;",
    "StartupNotify=true",
    ""
  ].join("\n");
}

export function desktopEntryContent(paths: LinuxHelperPaths): string {
  return renderDesktopEntry(paths, {
    marker: true,
    terminal: false
  });
}

function legacyManagedDesktopContent(paths: LinuxHelperPaths): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=KirinukiHelper",
    "Comment=치지직·YouTube·SOOP 키리누키 편집 도우미",
    `Exec=${desktopExecQuote(paths.userLauncherPath)}`,
    "Terminal=true",
    "Categories=AudioVideo;Video;",
    "StartupNotify=true",
    ""
  ].join("\n");
}

function legacyUserLauncherContent(paths: LinuxHelperPaths): string {
  const legacyLauncher = path.join(
    path.dirname(paths.userLauncherPath),
    "chromium-kirinuki"
  );
  return [
    "#!/bin/sh",
    "",
    "set -eu",
    "",
    `LAUNCHER="${legacyLauncher}"`,
    "",
    "if [ ! -x \"$LAUNCHER\" ]; then",
    "  printf '%s\\n' \"치지직 키리누키 전용 Chromium 실행기를 찾지 못했습니다: $LAUNCHER\" >&2",
    "  exit 1",
    "fi",
    "",
    "exec \"$LAUNCHER\" \"$@\"",
    ""
  ].join("\n");
}

function parseEntrypointTarget(content: string): string | null {
  const marker = /^# kirinuki-helper-config=(\{.+\})$/mu.exec(content);
  if (marker?.[1]) {
    try {
      const parsed = JSON.parse(marker[1]) as {
        packageRoot?: unknown;
      };
      if (typeof parsed.packageRoot === "string") {
        return parsed.packageRoot;
      }
    } catch {
      return null;
    }
  }
  const execMatch = /^\s*exec\s+(?:"([^"]+)"|'([^']+)'|(\S+))/mu.exec(
    content
  );
  if (execMatch) {
    return execMatch[1] || execMatch[2] || execMatch[3] || null;
  }
  const desktopMatch = /^Exec=(?:"((?:\\.|[^"])*)"|(\S+))(?:\s+.*)?$/mu.exec(
    content
  );
  return desktopMatch?.[1] || desktopMatch?.[2] || null;
}

function parseManagedLauncher(
  content: string
): EntrypointMetadata | null {
  const marker = /^# kirinuki-helper-config=(\{.+\})$/mu.exec(content);
  if (!marker?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(marker[1]) as Record<string, unknown>;
    const keys = Object.keys(parsed).sort();
    const currentKeys = [
      "browserProfileRoot",
      "packageRoot",
      "streamingCompanionRoot"
    ].sort().join(",");
    const previousWebKeys = [
      "browserProfileRoot",
      "packageRoot"
    ].sort().join(",");
    const legacyKeys = [
      "browserProfileRoot",
      "extensionRoot",
      "packageRoot"
    ].sort().join(",");
    if (![currentKeys, previousWebKeys, legacyKeys].includes(keys.join(","))) {
      return null;
    }
    for (const key of keys) {
      const value = parsed[key];
      if (
        typeof value !== "string"
        || !path.isAbsolute(value)
        || value.trim() !== value
        || /[\0\r\n]/u.test(value)
      ) {
        return null;
      }
    }
    const previousMetadata: PreviousWebEntrypointMetadata = Object.freeze({
      packageRoot: path.normalize(String(parsed.packageRoot)),
      browserProfileRoot: path.normalize(String(parsed.browserProfileRoot))
    });
    if (keys.join(",") === currentKeys) {
      const metadata: EntrypointMetadata = Object.freeze({
        ...previousMetadata,
        streamingCompanionRoot: path.normalize(
          String(parsed.streamingCompanionRoot)
        )
      });
      return content === renderUserLauncher(metadata)
        ? metadata
        : null;
    }
    if (keys.join(",") === previousWebKeys) {
      return (
        content === renderPreviousWebUserLauncher(previousMetadata)
        || content === renderPreviousWebUserLauncherWithPackageRoot(
          previousMetadata
        )
      )
        ? {
          ...previousMetadata,
          streamingCompanionRoot: path.join(
            previousMetadata.packageRoot,
            "streaming-companion"
          )
        }
        : null;
    }
    const legacyMetadata = Object.freeze({
      packageRoot: previousMetadata.packageRoot,
      extensionRoot: path.normalize(String(parsed.extensionRoot)),
      browserProfileRoot: previousMetadata.browserProfileRoot
    });
    return content === renderLegacyExtensionUserLauncher(legacyMetadata)
      ? {
        ...previousMetadata,
        streamingCompanionRoot: path.join(
          previousMetadata.packageRoot,
          "streaming-companion"
        )
      }
      : null;
  } catch {
    return null;
  }
}

function isManagedDesktop(
  content: string,
  paths: LinuxHelperPaths
): boolean {
  return (
    /^X-KirinukiHelper-Managed=(?:chzzk-kirinuki-linux-helper\/v1|kirinuki-app\/v1)$/mu.test(
      content
    )
    && /^\[Desktop Entry\]$/mu.test(content)
    && /^Type=Application$/mu.test(content)
    && /^(?:Name=Kirinuki|Name=KirinukiHelper)$/mu.test(content)
    && (
      content.split("\n").includes(
        `Exec=/usr/bin/env ${KIRINUKI_DESKTOP_LAUNCH_ENV}=1 ${desktopExecQuote(paths.userLauncherPath)} %u`
      )
      || new RegExp(
        `^Exec=${desktopExecQuote(paths.userLauncherPath)
          .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?: %u)?$`,
        "mu"
      ).test(content)
    )
    && !/^MimeType=(?=[^\n]*(?:x-scheme-handler\/http|x-scheme-handler\/https|text\/html))[^\n]+$/mu.test(content)
  );
}

function recognizedLegacyDesktop(content: string): boolean {
  return (
    /^\[Desktop Entry\]$/mu.test(content)
    && /^Name=Chromium - 치지직 키리누키$/mu.test(content)
    && /^GenericName=CHZZK Kirinuki Browser$/mu.test(content)
    && /^Exec=\S*\/\.local\/bin\/chromium-kirinuki(?:\s+%U)?$/mu.test(
      content
    )
    && /^MimeType=(?=[^\n]*x-scheme-handler\/http;)(?=[^\n]*x-scheme-handler\/https;)(?=[^\n]*text\/html;)[^\n]+$/mu.test(
      content
    )
  );
}

async function inspectLegacyDesktop(
  filePath: string
): Promise<UserEntrypointReport["legacyDesktop"]> {
  let fileInfo;
  try {
    fileInfo = await lstat(filePath);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return {
        path: filePath,
        present: false,
        recognized: false,
        actualTarget: null
      };
    }
    return {
      path: filePath,
      present: true,
      recognized: false,
      actualTarget: `검사 실패: ${errnoCode(error) || "알 수 없는 오류"}`
    };
  }
  if (!fileInfo.isFile()) {
    return {
      path: filePath,
      present: true,
      recognized: false,
      actualTarget: fileInfo.isSymbolicLink()
        ? `symlink → ${await readlink(filePath).catch(() => "?")}`
        : "일반 파일 아님"
    };
  }
  try {
    const content = await readFile(filePath, "utf8");
    return {
      path: filePath,
      present: true,
      recognized: recognizedLegacyDesktop(content),
      actualTarget: parseEntrypointTarget(content)
    };
  } catch (error) {
    return {
      path: filePath,
      present: true,
      recognized: false,
      actualTarget: `읽기 실패: ${errnoCode(error) || "알 수 없는 오류"}`
    };
  }
}

async function inspectEntrypointFile(
  filePath: string,
  expectedContent: string,
  {
    executable = false
  }: {
    executable?: boolean;
  } = {}
): Promise<UserEntrypointState> {
  let fileInfo;
  try {
    fileInfo = await lstat(filePath);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return {
        path: filePath,
        installed: false,
        current: false,
        actualTarget: null
      };
    }
    return {
      path: filePath,
      installed: true,
      current: false,
      actualTarget: `검사 실패: ${errnoCode(error) || "알 수 없는 오류"}`
    };
  }
  if (!fileInfo.isFile()) {
    return {
      path: filePath,
      installed: true,
      current: false,
      actualTarget: fileInfo.isSymbolicLink()
        ? `symlink → ${await readlink(filePath).catch(() => "?")}`
        : "일반 파일 아님"
    };
  }
  try {
    const content = await readFile(filePath, "utf8");
    const modeReady = !executable || Boolean(fileInfo.mode & 0o111);
    return {
      path: filePath,
      installed: fileInfo.isFile(),
      current: fileInfo.isFile()
        && modeReady
        && content === expectedContent,
      actualTarget: parseEntrypointTarget(content)
    };
  } catch (error) {
    return {
      path: filePath,
      installed: true,
      current: false,
      actualTarget: `읽기 실패: ${errnoCode(error) || "알 수 없는 오류"}`
    };
  }
}

export async function inspectUserEntrypoints(
  paths: LinuxHelperPaths,
  root = packageRoot
): Promise<UserEntrypointReport> {
  const [launcher, desktop, legacyDesktop] = await Promise.all([
    inspectEntrypointFile(
      paths.userLauncherPath,
      userLauncherContent(paths, root),
      { executable: true }
    ),
    inspectEntrypointFile(
      paths.desktopEntryPath,
      desktopEntryContent(paths)
    ),
    inspectLegacyDesktop(paths.legacyDesktopEntryPath)
  ]);
  return {
    launcher,
    desktop,
    legacyDesktop,
    current: (
      launcher.current
      && desktop.current
      && !legacyDesktop.recognized
      && !legacyDesktop.actualTarget?.startsWith("검사 실패:")
      && !legacyDesktop.actualTarget?.startsWith("읽기 실패:")
    )
  };
}

type EntrypointInstallDisposition =
  | "missing"
  | "current"
  | "managed"
  | "legacy"
  | "blocked";

interface EntrypointInstallPlan {
  destination: string;
  content: string;
  mode: number;
  disposition: EntrypointInstallDisposition;
  reason: string;
  snapshot: {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
  } | null;
}

function errnoCode(error: unknown): string {
  return String((error as NodeJS.ErrnoException)?.code || "");
}

async function classifyEntrypointInstall({
  destination,
  content,
  mode,
  kind,
  paths
}: {
  destination: string;
  content: string;
  mode: number;
  kind: "launcher" | "desktop" | "legacy-mime-desktop";
  paths: LinuxHelperPaths;
}): Promise<EntrypointInstallPlan> {
  let fileInfo;
  try {
    fileInfo = await lstat(destination);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return {
        destination,
        content,
        mode,
        disposition: "missing",
        reason: "설치 대상 없음",
        snapshot: null
      };
    }
    throw new Error(
      `사용자 진입점 상태를 읽지 못했습니다: ${destination}`,
      { cause: error }
    );
  }
  const snapshot = {
    dev: fileInfo.dev,
    ino: fileInfo.ino,
    size: fileInfo.size,
    mtimeMs: fileInfo.mtimeMs
  };
  if (!fileInfo.isFile()) {
    return {
      destination,
      content,
      mode,
      disposition: "blocked",
      reason: fileInfo.isSymbolicLink()
        ? `심볼릭 링크 → ${await readlink(destination).catch(() => "?")}`
        : "일반 파일이 아님",
      snapshot
    };
  }
  if (fileInfo.size > 256 * 1024) {
    return {
      destination,
      content,
      mode,
      disposition: "blocked",
      reason: "Kirinuki 진입점으로 보기에는 파일이 지나치게 큼",
      snapshot
    };
  }
  let existing: string;
  try {
    existing = await readFile(destination, "utf8");
  } catch (error) {
    throw new Error(
      `기존 사용자 진입점을 안전하게 읽지 못해 설치를 중단했습니다: ${destination}`,
      { cause: error }
    );
  }
  if (
    kind !== "legacy-mime-desktop"
    && existing === content
  ) {
    const modeCurrent = (fileInfo.mode & 0o777) === mode;
    return {
      destination,
      content,
      mode,
      disposition: modeCurrent ? "current" : "managed",
      reason: modeCurrent
        ? "현재 KirinukiHelper 생성물"
        : "현재 KirinukiHelper 생성물이지만 권한 복구 필요",
      snapshot
    };
  }
  if (kind === "legacy-mime-desktop") {
    const recognized = recognizedLegacyDesktop(existing);
    return {
      destination,
      content,
      mode,
      disposition: recognized ? "legacy" : "blocked",
      reason: recognized
        ? "정확히 인식된 과거 Kirinuki MIME desktop"
        : "은퇴 대상 legacy MIME desktop 서명과 다름",
      snapshot
    };
  }
  const managed = kind === "launcher"
    ? Boolean(parseManagedLauncher(existing))
    : isManagedDesktop(existing, paths);
  if (managed) {
    return {
      destination,
      content,
      mode,
      disposition: "managed",
      reason: "이전 KirinukiHelper marker 생성물",
      snapshot
    };
  }
  const legacy = kind === "launcher"
    ? existing === legacyUserLauncherContent(paths)
    : existing === legacyManagedDesktopContent(paths);
  return {
    destination,
    content,
    mode,
    disposition: legacy ? "legacy" : "blocked",
    reason: legacy
      ? "정확히 인식된 과거 Kirinuki 진입점"
      : "KirinukiHelper 소유 marker가 없는 기존 사용자 파일",
    snapshot
  };
}

async function assertPlanStillMatches(
  plan: EntrypointInstallPlan
): Promise<void> {
  if (!plan.snapshot) {
    return;
  }
  const current = await lstat(plan.destination).catch(() => null);
  if (
    !current
    || !current.isFile()
    || current.dev !== plan.snapshot.dev
    || current.ino !== plan.snapshot.ino
    || current.size !== plan.snapshot.size
    || current.mtimeMs !== plan.snapshot.mtimeMs
  ) {
    throw new Error(
      `설치 도중 사용자 진입점이 바뀌어 중단했습니다: ${plan.destination}`
    );
  }
}

async function pathEntryExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function reserveBackupPath(
  source: string,
  label: "backup" | "retired"
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = (
      `${source}.${label}-${Date.now()}-${process.pid}-${attempt}`
    );
    try {
      await link(source, candidate);
      return candidate;
    } catch (error) {
      if (errnoCode(error) === "EEXIST") {
        continue;
      }
      throw new Error(
        `기존 Kirinuki 진입점의 복구본을 만들지 못했습니다: ${source}`,
        { cause: error }
      );
    }
  }
  throw new Error(
    `기존 Kirinuki 진입점의 고유 복구본 이름을 만들지 못했습니다: ${source}`
  );
}

async function backupAndDetach(
  plan: EntrypointInstallPlan,
  label: "backup" | "retired" = "backup"
): Promise<string> {
  await assertPlanStillMatches(plan);
  const backup = await reserveBackupPath(plan.destination, label);
  try {
    const [sourceInfo, backupInfo] = await Promise.all([
      lstat(plan.destination),
      lstat(backup)
    ]);
    if (
      !plan.snapshot
      || sourceInfo.dev !== plan.snapshot.dev
      || sourceInfo.ino !== plan.snapshot.ino
      || backupInfo.dev !== sourceInfo.dev
      || backupInfo.ino !== sourceInfo.ino
    ) {
      throw new Error(
        `복구본 생성 중 사용자 진입점이 바뀌었습니다: ${plan.destination}`
      );
    }
    await unlink(plan.destination);
  } catch (error) {
    await unlink(backup).catch(() => {});
    throw new Error(
      `기존 Kirinuki 진입점을 안전하게 분리하지 못했습니다: ${plan.destination}`,
      { cause: error }
    );
  }
  return backup;
}

async function atomicCreateFile(
  destination: string,
  content: string,
  mode: number
): Promise<void> {
  await mkdir(path.dirname(destination), {
    recursive: true,
    mode: 0o700
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const temporary = (
      `${destination}.${process.pid}.${Date.now()}.${attempt}.tmp`
    );
    try {
      await writeFile(temporary, content, {
        encoding: "utf8",
        mode,
        flag: "wx"
      });
      await chmod(temporary, mode);
      await link(temporary, destination);
      return;
    } catch (error) {
      if (
        errnoCode(error) === "EEXIST"
        && !await pathEntryExists(destination)
      ) {
        continue;
      }
      throw new Error(
        `사용자 진입점을 기존 파일 위에 덮어쓰지 않고 설치하지 못했습니다: ${destination}`,
        { cause: error }
      );
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  throw new Error(`사용자 진입점 임시 파일을 만들지 못했습니다: ${destination}`);
}

async function applyEntrypointInstallPlan(
  plan: EntrypointInstallPlan
): Promise<string | null> {
  if (plan.disposition === "current") {
    await assertPlanStillMatches(plan);
    return null;
  }
  let backup: string | null = null;
  if (
    plan.disposition === "managed"
    || plan.disposition === "legacy"
  ) {
    backup = await backupAndDetach(plan);
  }
  try {
    await atomicCreateFile(plan.destination, plan.content, plan.mode);
  } catch (error) {
    if (backup && !await pathEntryExists(plan.destination)) {
      await link(backup, plan.destination).catch(() => {});
    }
    throw error;
  }
  return backup;
}

export async function installUserEntrypoints(
  paths: LinuxHelperPaths,
  root = packageRoot
): Promise<{
  retiredLegacyPath: string | null;
  replacedEntrypointBackups: string[];
}> {
  const plans = await Promise.all([
    classifyEntrypointInstall({
      destination: paths.userLauncherPath,
      content: userLauncherContent(paths, root),
      mode: 0o755,
      kind: "launcher",
      paths
    }),
    classifyEntrypointInstall({
      destination: paths.desktopEntryPath,
      content: desktopEntryContent(paths),
      mode: 0o644,
      kind: "desktop",
      paths
    })
  ]);
  const legacy = await inspectLegacyDesktop(
    paths.legacyDesktopEntryPath
  );
  if (
    legacy.present
    && (
      legacy.actualTarget?.startsWith("검사 실패:")
      || legacy.actualTarget?.startsWith("읽기 실패:")
    )
  ) {
    throw new Error(
      `레거시 Kirinuki 앱 메뉴를 안전하게 검사하지 못해 설치를 중단했습니다: ${legacy.path} · ${legacy.actualTarget}`
    );
  }
  const legacyPlan = legacy.recognized
    ? await classifyEntrypointInstall({
      destination: paths.legacyDesktopEntryPath,
      content: "",
      mode: 0o644,
      kind: "legacy-mime-desktop",
      paths
    })
    : null;
  if (legacyPlan && legacyPlan.disposition !== "legacy") {
    throw new Error(
      `설치 도중 레거시 Kirinuki 앱 메뉴가 바뀌어 중단했습니다: ${legacyPlan.destination}`
    );
  }
  const blocked = plans.filter((plan) => plan.disposition === "blocked");
  if (blocked.length > 0) {
    throw new Error(
      "기존 사용자 파일을 KirinukiHelper가 소유한 것으로 확인할 수 없어 설치를 중단했습니다.\n"
      + blocked
        .map((plan) => `${plan.destination}: ${plan.reason}`)
        .join("\n")
      + "\n파일을 보존했으며, 사용자가 직접 경로를 확인해야 합니다."
    );
  }
  const replacedEntrypointBackups: string[] = [];
  for (const plan of plans) {
    const backup = await applyEntrypointInstallPlan(plan);
    if (backup) {
      replacedEntrypointBackups.push(backup);
    }
  }
  if (!legacyPlan) {
    return { retiredLegacyPath: null, replacedEntrypointBackups };
  }
  const retiredLegacyPath = await backupAndDetach(
    legacyPlan,
    "retired"
  );
  return { retiredLegacyPath, replacedEntrypointBackups };
}

export function desktopDatabaseRefreshCommand(
  paths: LinuxHelperPaths,
  env: NodeJS.ProcessEnv = process.env
): { file: string; args: string[] } | null {
  const file = resolveExecutable(
    null,
    ["update-desktop-database"],
    env
  );
  return file
    ? {
      file,
      args: [path.dirname(paths.desktopEntryPath)]
    }
    : null;
}

export function desktopMimeRegistrationCommand(
  paths: LinuxHelperPaths,
  env: NodeJS.ProcessEnv = process.env
): { file: string; args: string[] } | null {
  const file = resolveExecutable(null, ["xdg-mime"], env);
  return file
    ? {
      file,
      args: [
        "default",
        path.basename(paths.desktopEntryPath),
        "x-scheme-handler/kirinuki"
      ]
    }
    : null;
}

export async function restoreLauncherPermissions(
  root = packageRoot
): Promise<void> {
  await Promise.all([
    chmod(path.join(root, "kirinuki.sh"), 0o755),
    chmod(path.join(root, "setup.sh"), 0o755)
  ]);
}

function describeCommand(file: string, args: readonly string[]): string {
  return `${file} ${args.map((value) => JSON.stringify(value)).join(" ")}`;
}

function npmBinary(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return resolveExecutable(
    env.KIRINUKI_NPM_BINARY || null,
    ["npm"],
    env
  );
}

function nativeTools(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | null> {
  return Object.fromEntries(
    ["cmake", "tar", "c++"].map((name) => [
      name,
      resolveExecutable(null, [name], env)
    ])
  );
}

function vodNativeTools(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | null> {
  return {
    python3: resolveExecutable(
      null,
      ["python3", "python3.13", "python3.12", "python3.11"],
      env
    ),
    ffmpeg: resolveExecutable(null, ["ffmpeg"], env),
    ffprobe: resolveExecutable(null, ["ffprobe"], env)
  };
}

function studioBuildReadyFiles(
  root = packageRoot
): string[] {
  return [
    path.join(root, "web", "index.html"),
    path.join(root, "web", "studio.css"),
    path.join(root, "web", "studio.js"),
    path.join(root, "web", "editor.html"),
    path.join(root, "web", "editor", "editor.css"),
    path.join(root, "web", "editor", "editor.js"),
    path.join(root, "web", "editor", "audseg-worker.js"),
    path.join(root, "streaming-companion", "manifest.json"),
    path.join(root, "streaming-companion", "soop-streaming-companion.js"),
    path.join(root, "streaming-companion", "streaming-companion.js"),
    path.join(root, "streaming-companion", "studio-streaming-relay.js")
  ];
}

export function companionBuildMatchesStudioOrigin(
  contents: unknown,
  studioOrigin: KirinukiStudioOrigin
): boolean {
  if (studioOrigin !== KIRINUKI_LOCAL_STUDIO_ORIGIN) {
    return false;
  }
  const javascript = String(contents || "");
  return javascript.includes(studioOrigin)
    && !javascript.includes(KIRINUKI_PUBLIC_STUDIO_ORIGIN);
}

async function inspectBuild(
  root = packageRoot,
  studioOrigin: KirinukiStudioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
) {
  const files = studioBuildReadyFiles(root);
  const filesReady = (await Promise.all(files.map(exists))).every(Boolean);
  const companionPaths = [
    path.join(root, "streaming-companion", "streaming-companion.js"),
    path.join(root, "streaming-companion", "soop-streaming-companion.js"),
    path.join(root, "streaming-companion", "studio-streaming-relay.js")
  ];
  const companionsMatchOrigin = filesReady && (await Promise.all(
    companionPaths.map(async (filePath) => {
      const contents = await readFile(filePath, "utf8").catch(() => "");
      return companionBuildMatchesStudioOrigin(contents, studioOrigin);
    })
  )).every(Boolean);
  const ready = filesReady && companionsMatchOrigin;
  return { ready, files };
}

function readCaptionStatus(
  env: NodeJS.ProcessEnv = process.env
): CaptionStatusResult {
  const result = commandResult(
    process.execPath,
    captionStackArgs("status", "--json"),
    { env: withoutSecrets(env), timeout: 10_000 }
  );
  if (!result.ok) {
    return {
      ok: false,
      error: (
        result.stderr.trim()
        || result.stdout.trim()
        || "자막 스택 상태를 읽지 못했습니다."
      )
    };
  }
  try {
    return {
      ok: true,
      value: JSON.parse(result.stdout) as CaptionStatus
    };
  } catch {
    return { ok: false, error: "자막 스택 status JSON이 올바르지 않습니다." };
  }
}

function readStudioServerStatus(
  env: NodeJS.ProcessEnv = process.env
): StudioServerStatusResult {
  const result = commandResult(
    process.execPath,
    studioServerArgs("status", "--json"),
    { env: withoutSecrets(env), timeout: 10_000 }
  );
  if (!result.ok) {
    return {
      ok: false,
      error: (
        result.stderr.trim()
        || result.stdout.trim()
        || "편집 화면 엔진 상태를 읽지 못했습니다."
      )
    };
  }
  try {
    const value = JSON.parse(result.stdout) as StudioServerStatus;
    const reportedOrigin = value.studioOrigin;
    const validReportedOrigin = reportedOrigin === null
      || isKirinukiStudioOrigin(reportedOrigin);
    const expectedUrl = isKirinukiStudioOrigin(reportedOrigin)
      ? reportedOrigin
      : LOCAL_STUDIO_URL.slice(0, -1);
    if (
      !value
      || typeof value !== "object"
      || value.host !== "127.0.0.1"
      || value.port !== 4320
      || !validReportedOrigin
      || value.url !== expectedUrl
      || typeof value.ready !== "boolean"
      || typeof value.ownership !== "string"
      || (
        value.ready
        && value.ownership === "managed"
        && !isKirinukiStudioOrigin(reportedOrigin)
      )
    ) {
      throw new TypeError("status payload");
    }
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: "편집 화면 엔진 상태 응답이 올바르지 않습니다."
    };
  }
}

export function studioServerMatchesOrigin(
  status: StudioServerStatus | null | undefined,
  studioOrigin: KirinukiStudioOrigin
): boolean {
  return Boolean(
    status?.ready
    && status.ownership === "managed"
    && status.studioOrigin === studioOrigin
  );
}

function vodRuntimeChildEnvironment(
  env: NodeJS.ProcessEnv,
  resolvedPackageRoot: string
): NodeJS.ProcessEnv {
  const environment = withoutSecrets(env);
  delete environment.KIRINUKI_EXTENSION_ROOT;
  environment.KIRINUKI_PACKAGE_ROOT = path.resolve(resolvedPackageRoot);
  return environment;
}

function readVodRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env,
  resolvedPackageRoot = packageRoot
): VodRuntimeStatusResult {
  const result = commandResult(
    process.execPath,
    vodRuntimeArgs("status", "--json"),
    {
      env: vodRuntimeChildEnvironment(env, resolvedPackageRoot),
      timeout: 10_000
    }
  );
  if (!result.ok) {
    return {
      ok: false,
      error: (
        result.stderr.trim()
        || result.stdout.trim()
        || "로컬 VOD runtime 상태를 읽지 못했습니다."
      )
    };
  }
  try {
    const value = JSON.parse(result.stdout) as VodRuntimeStatus;
    if (!value || typeof value !== "object") {
      throw new TypeError("status payload");
    }
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: "로컬 VOD runtime status JSON이 올바르지 않습니다."
    };
  }
}

function vodRuntimeInstalledAndCurrent(
  status: VodRuntimeStatus | null | undefined
): boolean {
  return Boolean(
    status?.configured
    && (
      status.origin?.matchesLocalStudio
      ?? status.origin?.matchesCurrentStudio
    )
    && status.ytDlp?.ready
    && status.toolchainReady
  );
}

function captionOriginMatchesCurrentStudio(
  status: CaptionStatus | null | undefined
): boolean {
  return Boolean(
    status?.originMatchesLocalStudio
    ?? status?.originMatchesCurrentStudio
    ?? status?.originMatchesCurrentPath
  );
}

function captionEngineStatusView(
  mode: CaptionMode,
  result: CaptionStatusResult
) {
  if (mode === "audseg") {
    return {
      mode,
      available: true,
      configured: true,
      ready: true,
      appConnectionCurrent: true
    };
  }
  const status = result.ok ? result.value : null;
  return {
    mode,
    available: result.ok,
    configured: Boolean(status?.configured),
    ready: Boolean(
      status?.endpoints?.stt && status.endpoints.gateway
    ),
    appConnectionCurrent: captionOriginMatchesCurrentStudio(status),
    managedBy: status?.runtime?.manager || null
  };
}

function mediaEngineStatusView(result: VodRuntimeStatusResult) {
  const status = result.ok ? result.value : null;
  return {
    available: result.ok,
    configured: Boolean(status?.configured),
    current: Boolean(status && vodRuntimeInstalledAndCurrent(status)),
    ready: Boolean(status?.gateway),
    managed: Boolean(status?.managed),
    conflict: Boolean(status?.gatewayPortOccupied),
    toolVersion: status?.ytDlp?.version || null
  };
}

function editorEngineStatusView(result: StudioServerStatusResult) {
  const status = result.ok ? result.value : null;
  return {
    available: result.ok,
    ready: Boolean(status?.ready),
    managed: status?.ownership === "managed",
    ownership: status?.ownership || "down"
  };
}

function environmentReportJson(report: LinuxEnvironmentReport) {
  return {
    schema: APP_STATUS_SCHEMA,
    ready: report.ready,
    system: {
      linux: report.linux,
      node: report.node,
      npmAvailable: report.npm.available,
      browser: {
        available: report.browser.available,
        supported: report.browser.supported,
        product: report.browser.product,
        version: report.browser.version
      },
      nativeTools: report.nativeTools
    },
    app: {
      buildCurrent: report.studioBuild.built,
      entrypointsCurrent: report.entrypoints.current,
      browserProfile: {
        state: report.browserProfile.runtime.state,
        running: report.browserProfile.runtime.profileProcessCount > 0,
        transitionRequired: report.browserProfile.runtime.transitionRequired,
        reason: report.browserProfile.runtime.reason
      }
    },
    engines: {
      editor: editorEngineStatusView(report.studioServer),
      media: mediaEngineStatusView(report.vod),
      captions: captionEngineStatusView(report.mode, report.caption)
    }
  };
}

export async function inspectLinuxEnvironment({
  mode = "audseg",
  browser = null,
  env = process.env,
  platform = process.platform,
  root = packageRoot,
  paths = resolveLinuxHelperPaths({
    env,
    homeDir: env.HOME || os.homedir(),
    packageDir: root
  })
}: {
  mode?: CaptionMode;
  browser?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  root?: string;
  paths?: LinuxHelperPaths;
} = {}): Promise<LinuxEnvironmentReport> {
  const selectedMode = requiredChoice(mode, MODES, "mode");
  const studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN;
  const exactEnvironment = exactStudioOriginEnvironment(env, studioOrigin);
  const browserReport = inspectBrowser({ requested: browser, env });
  const browserRuntime = await inspectDedicatedBrowserRuntime({
    profileRoot: paths.browserProfileRoot,
    streamingCompanionRoot: paths.streamingCompanionRoot,
    legacyExtensionRoot: paths.legacyExtensionRoot,
    product: browserReport.product,
    studioOrigin
  });
  const build = await inspectBuild(root, studioOrigin);
  const entrypoints = await inspectUserEntrypoints(paths, root);
  const tools = {
    ...vodNativeTools(env),
    ...(selectedMode === "whisper" ? nativeTools(env) : {})
  };
  const caption: CaptionStatusResult = selectedMode === "whisper"
    ? readCaptionStatus(exactEnvironment)
    : {
      ok: true,
      value: {
        required: false,
        message: "AudSeg는 별도 설치 없이 앱 안에서 실행됩니다."
      }
    };
  const vod = readVodRuntimeStatus(exactEnvironment, paths.packageRoot);
  const studioServer = readStudioServerStatus(exactEnvironment);
  const npm = npmBinary(env);
  const report: LinuxEnvironmentReport = {
    schema: HELPER_SCHEMA,
    linux: platform === "linux",
    node: {
      version: process.versions.node,
      supported: versionAtLeast(
        process.versions.node,
        MINIMUM_NODE_VERSION
      )
    },
    npm: {
      available: Boolean(npm),
      binary: npm
    },
    browser: browserReport,
    studioBuild: {
      root: path.resolve(root),
      built: build.ready
    },
    browserProfile: {
      root: paths.browserProfileRoot,
      overridden: Boolean(env.KIRINUKI_BROWSER_PROFILE_ROOT),
      runtime: browserRuntime
    },
    entrypoints,
    mode: selectedMode,
    nativeTools: Object.fromEntries(
      Object.entries(tools).map(([name, value]) => [name, Boolean(value)])
    ),
    caption,
    vod,
    studioServer,
    ready: false
  };
  report.ready = Boolean(
    report.linux
    && report.node.supported
    && report.npm.available
    && report.browser.supported
    && ![
      "clean",
      "update-required",
      "conflict",
      "unavailable"
    ].includes(
      report.browserProfile.runtime.state
    )
    && report.studioBuild.built
    && report.entrypoints.current
    && vod.ok
    && vodRuntimeInstalledAndCurrent(vod.value)
    && studioServer.ok
    && (
      !studioServer.value.ready
      || studioServerMatchesOrigin(studioServer.value, studioOrigin)
    )
    && (
      selectedMode !== "whisper"
      || (
        Object.values(report.nativeTools).every(Boolean)
        && caption.ok
        && caption.value?.configured
        && captionOriginMatchesCurrentStudio(caption.value)
      )
    )
  );
  return report;
}

function dependencyGuidance(mode: CaptionMode): string[] {
  const debianNative = mode === "whisper" ? " cmake g++ tar" : "";
  const fedoraNative = mode === "whisper" ? " cmake gcc-c++ tar" : "";
  const archNative = mode === "whisper" ? " cmake gcc tar" : "";
  return [
    "누락된 프로그램은 사용자가 검토한 뒤 배포판 패키지 관리자로 설치하세요.",
    `Debian/Ubuntu 예: apt install nodejs npm chromium python3 ffmpeg${debianNative}`,
    `Fedora 예: dnf install nodejs npm chromium python3 ffmpeg${fedoraNative}`,
    `Arch 예: pacman -S --needed nodejs npm chromium python ffmpeg${archNative}`,
    `설치 뒤 Node ${MINIMUM_NODE_VERSION}+와 Chromium 계열 브라우저 ${MINIMUM_BROWSER_VERSION}+인지 다시 확인하세요.`,
    "편집 화면과 미디어 엔진은 이 기기 안에서만 연결됩니다.",
    "Kirinuki 앱은 관리자 권한 획득이나 시스템 패키지 설치를 자동 실행하지 않습니다."
  ];
}

function printDoctor(
  report: LinuxEnvironmentReport,
  stdout: Writable = process.stdout
) {
  line(stdout, `Linux: ${report.linux ? "OK" : "지원 대상 아님"}`);
  line(
    stdout,
    `Node ${report.node.version}: ${report.node.supported ? "OK" : `${MINIMUM_NODE_VERSION}+ 필요`}`
  );
  line(
    stdout,
    `npm: ${report.npm.available ? report.npm.binary : "없음"}`
  );
  line(
    stdout,
    `브라우저: ${
      report.browser.available
        ? `${report.browser.version || report.browser.binary} · ${
          report.browser.supported
            ? "OK"
            : report.browser.product === "chrome"
              ? `Chrome ${MINIMUM_BROWSER_VERSION}+ 필요`
              : `Chromium 계열 ${MINIMUM_BROWSER_VERSION}+ 필요`
        }`
        : "Chromium 계열 브라우저 없음"
    }`
  );
  line(
    stdout,
    `편집 화면: ${report.studioBuild.built ? "준비됨" : "앱 준비 필요"}`
    + ` · ${report.studioBuild.root}`
  );
  line(
    stdout,
    `브라우저 profile: ${report.browserProfile.root}`
    + (report.browserProfile.overridden ? " · 환경 override" : "")
  );
  line(
    stdout,
    `브라우저 runtime: ${report.browserProfile.runtime.state}`
    + (
      report.browserProfile.runtime.mainPid
        ? ` · PID ${report.browserProfile.runtime.mainPid}`
        : ""
    )
    + ` · ${report.browserProfile.runtime.reason}`
  );
  line(
    stdout,
    `kirinuki 명령: ${
      report.entrypoints.launcher.current
        ? "현재 저장소와 일치"
        : report.entrypoints.launcher.installed
          ? `stale (${report.entrypoints.launcher.actualTarget || "대상 판독 불가"})`
          : "미설치"
    } · ${report.entrypoints.launcher.path}`
  );
  line(
    stdout,
    `앱 메뉴: ${
      report.entrypoints.desktop.current
        ? "현재 명령과 일치"
        : report.entrypoints.desktop.installed
          ? `stale (${report.entrypoints.desktop.actualTarget || "대상 판독 불가"})`
          : "미설치"
    }`
  );
  if (report.entrypoints.legacyDesktop.present) {
    line(
      stdout,
      report.entrypoints.legacyDesktop.recognized
        ? "레거시 앱 메뉴: HTTP/HTTPS/text-html 기본 앱을 가로채는 이전 Kirinuki 항목이 활성 상태 · setup으로 안전하게 은퇴 필요"
        : `레거시 이름의 앱 메뉴: 서명이 다르거나 검사 불가하여 자동 변경하지 않음 · ${report.entrypoints.legacyDesktop.path} · ${report.entrypoints.legacyDesktop.actualTarget || "대상 판독 불가"}`
    );
  }
  line(stdout, `자막 방식: ${report.mode}`);
  if (report.mode === "whisper") {
    line(
      stdout,
      `네이티브 도구: ${Object.entries(report.nativeTools)
        .map(([name, ready]) => `${name}=${ready ? "OK" : "없음"}`)
        .join(" · ")}`
    );
    if (report.caption.ok) {
      const status = report.caption.value;
      line(
        stdout,
        `Whisper 설치: ${status.configured ? "설정 있음" : "앱 완전 종료 후 다시 열기"}`
        + (
          status.configured && !captionOriginMatchesCurrentStudio(status)
            ? " · 앱 연결 설정 불일치(앱 준비 재실행 필요)"
            : ""
        )
      );
      line(
        stdout,
        `Whisper 엔진: 음성 인식=${status.endpoints?.stt ? "준비됨" : "중지됨"}`
        + ` · 앱 연결=${status.endpoints?.gateway ? "준비됨" : "중지됨"}`
      );
    } else {
      line(stdout, "Whisper 자막 엔진 상태를 읽지 못했습니다.");
    }
  } else {
    line(stdout, "AudSeg: 모델·API 키 없이 Kirinuki 앱 안에서 실행");
  }
  if (report.vod.ok) {
    const status = report.vod.value;
    line(
      stdout,
      `VOD 미디어 엔진: ${
        vodRuntimeInstalledAndCurrent(status) ? "설치·도구 검증됨" : "앱 완전 종료 후 다시 열기"
      }`
      + ` · yt-dlp=${status.ytDlp?.version || "-"}`
      + ` · 앱 연결=${status.gateway ? "준비됨" : status.gatewayPortOccupied ? "다른 프로그램과 충돌" : "중지됨"}`
      + ` · 관리=${status.managed ? `PID ${status.managerPid || "?"}` : "중지됨"}`
    );
  } else {
    line(stdout, "VOD 미디어 엔진 상태를 읽지 못했습니다.");
  }
  if (report.studioServer.ok) {
    const status = report.studioServer.value;
    line(
      stdout,
      `편집 화면 엔진: ${status.ready ? "준비됨" : status.ownership || "중지됨"}`
      + ` · 관리=${status.managerPid ? `PID ${status.managerPid}` : "중지됨"}`
    );
  } else {
    line(stdout, "편집 화면 엔진 상태를 읽지 못했습니다.");
  }
  line(stdout, `종합: ${report.ready ? "사용 준비됨" : "확인 필요"}`);
}

async function runStreaming(file: string, args: readonly string[], {
  cwd = packageRoot,
  env = withoutSecrets()
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `${path.basename(file)}가 ${signal} 신호로 종료됐습니다.`
          : `${path.basename(file)}가 종료 코드 ${code}로 실패했습니다.`
      ));
    });
  });
}

function setupPlan(
  npm: string,
  mode: CaptionMode,
  profile: CaptionProfile,
  backend: CaptionBackend
): Array<[string, string[]]> {
  const commands: Array<[string, string[]]> = [
    [npm, ["ci", "--ignore-scripts"]],
    [npm, ["run", "build"]],
    [npm, ["run", "validate"]],
    [npm, ["run", "license:check"]],
    [process.execPath, vodRuntimeArgs("doctor")],
    [process.execPath, vodRuntimeArgs("setup")]
  ];
  if (mode === "whisper") {
    commands.push(
      [
        process.execPath,
        captionStackArgs("doctor", "--profile", profile, "--backend", backend)
      ],
      [
        process.execPath,
        captionStackArgs("setup", "--profile", profile, "--backend", backend)
      ]
    );
  }
  return commands;
}

export function appBootstrapReasons(
  state: Readonly<AppBootstrapState>
): AppBootstrapReason[] {
  const reasons: AppBootstrapReason[] = [];
  if (!state.configured) {
    reasons.push("configuration");
  }
  if (!state.buildCurrent) {
    reasons.push("build");
  }
  if (!state.entrypointsCurrent) {
    reasons.push("entrypoints");
  }
  if (!state.mediaEngineCurrent) {
    reasons.push("media-engine");
  }
  if (!state.captionEngineCurrent) {
    reasons.push("caption-engine");
  }
  return reasons;
}

export function browserLaunchCanOwnLifecycle(
  state: DedicatedBrowserRuntimeState
): boolean {
  return state === "stopped" || state === "ready";
}

export function createIdempotentAsyncAction<T>(
  operation: () => Promise<T>
): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= operation();
    return pending;
  };
}

export type AppLifecycleOpenStatus =
  | "opened"
  | "starting"
  | "closing"
  | "retry"
  | "failed"
  | "unavailable";

export interface AppLifecycleOpenResult {
  status: AppLifecycleOpenStatus;
}

type AppLifecycleOpenHandler = (
  sourceUrl: string | null
) => Promise<void>;

export interface AppLifecycleClaim {
  owned: boolean;
  activateOpenRequests(handler: AppLifecycleOpenHandler): void;
  requestOpen(
    sourceUrl: string | null,
    requestId: string
  ): Promise<AppLifecycleOpenResult>;
  beginClosing(): Promise<void>;
  resumeOpenRequests(): Promise<void>;
  release(): Promise<void>;
}

export function appLifecycleSocketName(
  profileRoot: string,
  stateRoot: string
): string {
  const identity = createHash("sha256")
    .update(path.resolve(profileRoot))
    .digest("hex")
    .slice(0, 32);
  return path.join(
    path.resolve(stateRoot),
    "lifecycle",
    `${identity}.sock`
  );
}

function currentProcessUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

async function ensurePrivateOwnedDirectory(
  directory: string,
  label: string
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let metadata = await lstat(directory);
  const uid = currentProcessUid();
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (uid !== null && metadata.uid !== uid)
  ) {
    throw new Error(
      `Kirinuki ${label}를 안전한 사용자 폴더로 확인하지 못했습니다.`
    );
  }
  await chmod(directory, 0o700);
  metadata = await lstat(directory);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o700
    || (uid !== null && metadata.uid !== uid)
  ) {
    throw new Error(`Kirinuki ${label} 권한을 0700으로 제한하지 못했습니다.`);
  }
}

async function ensurePrivateAppLifecycleSocketDirectory(
  socketName: string,
  stateRoot: string
): Promise<void> {
  if (
    !path.isAbsolute(socketName)
    || socketName.includes("\0")
  ) {
    throw new Error(
      "Kirinuki lifecycle IPC 경로가 안전한 절대 경로가 아닙니다."
    );
  }
  const resolvedStateRoot = path.resolve(stateRoot);
  const directory = path.dirname(socketName);
  await ensurePrivateOwnedDirectory(resolvedStateRoot, "상태 폴더");
  await ensurePrivateOwnedDirectory(directory, "lifecycle IPC 폴더");
}

interface PreparedAppLifecycleSocketEndpoint {
  readonly physicalSocketName: string;
  readonly transportSocketName: string;
  close(): Promise<void>;
}

async function prepareAppLifecycleSocketEndpoint(
  profileRoot: string,
  stateRoot: string
): Promise<PreparedAppLifecycleSocketEndpoint> {
  const physicalSocketName = appLifecycleSocketName(profileRoot, stateRoot);
  await ensurePrivateAppLifecycleSocketDirectory(
    physicalSocketName,
    stateRoot
  );
  if (Buffer.byteLength(physicalSocketName, "utf8") <= 100) {
    return {
      physicalSocketName,
      transportSocketName: physicalSocketName,
      close: async () => {}
    };
  }
  if (process.platform !== "linux") {
    throw new Error(
      "긴 Kirinuki lifecycle IPC 경로는 Linux /proc directory FD alias가 필요합니다."
    );
  }
  const directory = path.dirname(physicalSocketName);
  const directoryHandle = await open(
    directory,
    fsConstants.O_RDONLY
      | fsConstants.O_DIRECTORY
      | fsConstants.O_NOFOLLOW
  );
  let accepted = false;
  try {
    const [handleMetadata, namedMetadata] = await Promise.all([
      directoryHandle.stat(),
      lstat(directory)
    ]);
    const uid = currentProcessUid();
    if (
      !handleMetadata.isDirectory()
      || !namedMetadata.isDirectory()
      || namedMetadata.isSymbolicLink()
      || handleMetadata.dev !== namedMetadata.dev
      || handleMetadata.ino !== namedMetadata.ino
      || handleMetadata.uid !== namedMetadata.uid
      || (handleMetadata.mode & 0o777) !== 0o700
      || (namedMetadata.mode & 0o777) !== 0o700
      || (uid !== null && handleMetadata.uid !== uid)
    ) {
      throw new Error(
        "Kirinuki lifecycle IPC 폴더를 열린 private directory로 고정하지 못했습니다."
      );
    }
    const descriptorDirectory = `/proc/self/fd/${directoryHandle.fd}`;
    const descriptorMetadata = await stat(descriptorDirectory);
    if (
      !descriptorMetadata.isDirectory()
      || descriptorMetadata.dev !== handleMetadata.dev
      || descriptorMetadata.ino !== handleMetadata.ino
      || descriptorMetadata.uid !== handleMetadata.uid
    ) {
      throw new Error(
        "Kirinuki lifecycle IPC directory FD alias를 확인하지 못했습니다."
      );
    }
    const transportSocketName = path.join(
      descriptorDirectory,
      path.basename(physicalSocketName)
    );
    if (
      !path.isAbsolute(transportSocketName)
      || transportSocketName.includes("\0")
      || Buffer.byteLength(transportSocketName, "utf8") > 100
    ) {
      throw new Error(
        "Kirinuki lifecycle IPC directory FD alias가 Unix socket 길이 제한을 넘었습니다."
      );
    }
    const close = createIdempotentAsyncAction(async () => {
      await directoryHandle.close();
    });
    accepted = true;
    return {
      physicalSocketName,
      transportSocketName,
      close
    };
  } finally {
    if (!accepted) {
      await directoryHandle.close().catch(() => {});
    }
  }
}

async function trustedAppLifecycleSocketMetadata(
  socketName: string,
  requirePrivateMode = true
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    const metadata = await lstat(socketName);
    const uid = currentProcessUid();
    if (
      !metadata.isSocket()
      || metadata.isSymbolicLink()
      || (uid !== null && metadata.uid !== uid)
      || (requirePrivateMode && (metadata.mode & 0o077) !== 0)
    ) {
      throw new Error(
        "Kirinuki lifecycle IPC endpoint가 현재 사용자의 private socket이 아닙니다."
      );
    }
    return metadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function appLifecycleSocketIsListening(
  socketName: string
): Promise<"listening" | "refused" | "gone" | "indeterminate"> {
  return new Promise((resolve) => {
    const socket = createConnection(socketName);
    let settled = false;
    const finish = (
      result: "listening" | "refused" | "gone" | "indeterminate"
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => finish("indeterminate"));
    socket.once("connect", () => finish("listening"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ECONNREFUSED"
        ? "refused"
        : error.code === "ENOENT"
          ? "gone"
          : "indeterminate");
    });
    socket.once("close", () => finish("indeterminate"));
  });
}

async function removeStaleAppLifecycleSocket(
  socketName: string
): Promise<void> {
  const before = await trustedAppLifecycleSocketMetadata(socketName, false);
  if (!before) {
    return;
  }
  const connectionState = await appLifecycleSocketIsListening(socketName);
  if (connectionState === "listening" || connectionState === "gone") {
    return;
  }
  if (connectionState !== "refused") {
    throw new Error(
      "Kirinuki lifecycle IPC endpoint의 활성 상태를 안전하게 확인하지 못했습니다."
    );
  }
  const after = await trustedAppLifecycleSocketMetadata(socketName, false);
  if (!after) {
    return;
  }
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.uid !== after.uid
  ) {
    throw new Error("Kirinuki lifecycle IPC endpoint가 확인 중 교체되었습니다.");
  }
  await unlink(socketName).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

interface AppLifecycleOpenWireRequest {
  schema: typeof APP_LIFECYCLE_PROTOCOL;
  type: "open";
  requestId: string;
  sourceUrl: string | null;
}

interface AppLifecycleOpenWireResponse {
  schema: typeof APP_LIFECYCLE_PROTOCOL;
  status: Exclude<AppLifecycleOpenStatus, "unavailable">;
}

class AppLifecycleRetryError extends Error {}

let appLifecycleRequestSequence = 0;

export function createAppLifecycleRequestId(): string {
  appLifecycleRequestSequence = (
    appLifecycleRequestSequence + 1
  ) % Number.MAX_SAFE_INTEGER;
  return [
    process.pid.toString(36),
    Date.now().toString(36),
    appLifecycleRequestSequence.toString(36)
  ].join("-");
}

function validAppLifecycleRequestId(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^[a-z0-9_-]{1,128}$/iu.test(value)
  );
}

function parseAppLifecycleOpenRequest(
  payload: Buffer
): AppLifecycleOpenWireRequest {
  if (
    payload.length === 0
    || payload.length > APP_LIFECYCLE_MAX_REQUEST_BYTES
    || payload.at(-1) !== 0x0a
    || payload.subarray(0, -1).includes(0x0a)
  ) {
    throw new TypeError("Kirinuki lifecycle 요청 경계가 올바르지 않습니다.");
  }
  const body = payload.subarray(0, -1).toString("utf8");
  if (Buffer.byteLength(body, "utf8") !== payload.length - 1) {
    throw new TypeError("Kirinuki lifecycle 요청이 UTF-8이 아닙니다.");
  }
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Kirinuki lifecycle 요청 형식이 올바르지 않습니다.");
  }
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",")
      !== "requestId,schema,sourceUrl,type"
    || value.schema !== APP_LIFECYCLE_PROTOCOL
    || value.type !== "open"
    || !validAppLifecycleRequestId(value.requestId)
    || !(
      value.sourceUrl === null
      || typeof value.sourceUrl === "string"
    )
  ) {
    throw new TypeError("Kirinuki lifecycle 요청 계약이 올바르지 않습니다.");
  }
  const sourceUrl = value.sourceUrl;
  if (
    typeof sourceUrl === "string"
    && (
      sourceUrl.length === 0
      || sourceUrl.length > 4_096
      || validateSourceUrl(sourceUrl) !== sourceUrl
    )
  ) {
    throw new TypeError("Kirinuki lifecycle 원본 URL이 올바르지 않습니다.");
  }
  return {
    schema: APP_LIFECYCLE_PROTOCOL,
    type: "open",
    requestId: value.requestId,
    sourceUrl
  };
}

function parseAppLifecycleOpenResponse(
  payload: Buffer
): AppLifecycleOpenWireResponse {
  if (
    payload.length === 0
    || payload.length > APP_LIFECYCLE_MAX_RESPONSE_BYTES
    || payload.at(-1) !== 0x0a
    || payload.subarray(0, -1).includes(0x0a)
  ) {
    throw new TypeError("Kirinuki lifecycle 응답 경계가 올바르지 않습니다.");
  }
  const body = payload.subarray(0, -1).toString("utf8");
  if (Buffer.byteLength(body, "utf8") !== payload.length - 1) {
    throw new TypeError("Kirinuki lifecycle 응답이 UTF-8이 아닙니다.");
  }
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Kirinuki lifecycle 응답 형식이 올바르지 않습니다.");
  }
  const value = parsed as Record<string, unknown>;
  const statuses = new Set<AppLifecycleOpenWireResponse["status"]>([
    "opened",
    "starting",
    "closing",
    "retry",
    "failed"
  ]);
  if (
    Object.keys(value).sort().join(",") !== "schema,status"
    || value.schema !== APP_LIFECYCLE_PROTOCOL
    || !statuses.has(value.status as AppLifecycleOpenWireResponse["status"])
  ) {
    throw new TypeError("Kirinuki lifecycle 응답 계약이 올바르지 않습니다.");
  }
  return {
    schema: APP_LIFECYCLE_PROTOCOL,
    status: value.status as AppLifecycleOpenWireResponse["status"]
  };
}

function appLifecycleWireResponse(
  status: AppLifecycleOpenWireResponse["status"]
): Buffer {
  return Buffer.from(`${JSON.stringify({
    schema: APP_LIFECYCLE_PROTOCOL,
    status
  } satisfies AppLifecycleOpenWireResponse)}\n`, "utf8");
}

async function requestAppLifecycleOpen(
  socketName: string,
  physicalSocketName: string,
  stateRoot: string,
  sourceUrl: string | null,
  requestId: string
): Promise<AppLifecycleOpenResult> {
  if (!validAppLifecycleRequestId(requestId)) {
    throw new TypeError("Kirinuki lifecycle requestId가 올바르지 않습니다.");
  }
  if (
    typeof sourceUrl === "string"
    && (
      sourceUrl.length === 0
      || sourceUrl.length > 4_096
      || validateSourceUrl(sourceUrl) !== sourceUrl
    )
  ) {
    throw new TypeError("Kirinuki lifecycle 원본 URL이 올바르지 않습니다.");
  }
  const payload = Buffer.from(`${JSON.stringify({
    schema: APP_LIFECYCLE_PROTOCOL,
    type: "open",
    requestId,
    sourceUrl
  } satisfies AppLifecycleOpenWireRequest)}\n`, "utf8");
  if (payload.length > APP_LIFECYCLE_MAX_REQUEST_BYTES) {
    throw new TypeError("Kirinuki lifecycle 요청이 허용 크기를 넘었습니다.");
  }
  await ensurePrivateAppLifecycleSocketDirectory(
    physicalSocketName,
    stateRoot
  );
  const endpointBeforeConnect = await trustedAppLifecycleSocketMetadata(
    socketName
  );
  if (!endpointBeforeConnect) {
    return { status: "unavailable" };
  }
  return new Promise<AppLifecycleOpenResult>((resolve) => {
    const socket = createConnection(socketName);
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let settled = false;
    const finish = (result: AppLifecycleOpenResult) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(APP_LIFECYCLE_OPEN_TIMEOUT_MS, () => {
      finish({ status: "unavailable" });
    });
    socket.once("connect", () => {
      void trustedAppLifecycleSocketMetadata(socketName).then((metadata) => {
        if (
          !metadata
          || metadata.dev !== endpointBeforeConnect.dev
          || metadata.ino !== endpointBeforeConnect.ino
          || metadata.uid !== endpointBeforeConnect.uid
        ) {
          finish({ status: "unavailable" });
          return;
        }
        socket.write(payload);
      }, () => {
        finish({ status: "unavailable" });
      });
    });
    socket.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > APP_LIFECYCLE_MAX_RESPONSE_BYTES) {
        finish({ status: "failed" });
        return;
      }
      chunks.push(chunk);
      const combined = Buffer.concat(chunks, receivedBytes);
      const newline = combined.indexOf(0x0a);
      if (newline < 0) {
        return;
      }
      if (newline !== combined.length - 1) {
        finish({ status: "failed" });
        return;
      }
      try {
        const response = parseAppLifecycleOpenResponse(combined);
        finish({ status: response.status });
      } catch {
        finish({ status: "failed" });
      }
    });
    socket.once("error", () => {
      finish({ status: "unavailable" });
    });
    socket.once("close", () => {
      finish({ status: "unavailable" });
    });
  });
}

export async function claimAppLifecycle(
  profileRoot: string,
  stateRoot: string
): Promise<AppLifecycleClaim> {
  const endpoint = await prepareAppLifecycleSocketEndpoint(
    profileRoot,
    stateRoot
  );
  const socketName = endpoint.transportSocketName;
  try {
    await removeStaleAppLifecycleSocket(socketName);
  } catch (error) {
    await endpoint.close();
    throw error;
  }
  let state: "starting" | "ready" | "closing" | "released" = "starting";
  let openHandler: AppLifecycleOpenHandler | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  const results = new Map<string, {
    sourceUrl: string | null;
    result: Promise<AppLifecycleOpenWireResponse>;
    settled: boolean;
  }>();
  const dispatch = (
    request: AppLifecycleOpenWireRequest
  ): Promise<AppLifecycleOpenWireResponse> => {
    const cached = results.get(request.requestId);
    if (cached) {
      return cached.sourceUrl === request.sourceUrl
        ? cached.result
        : Promise.resolve({
          schema: APP_LIFECYCLE_PROTOCOL,
          status: "failed"
        });
    }
    if (state === "starting" || !openHandler) {
      return Promise.resolve({
        schema: APP_LIFECYCLE_PROTOCOL,
        status: "starting"
      });
    }
    if (state !== "ready") {
      return Promise.resolve({
        schema: APP_LIFECYCLE_PROTOCOL,
        status: "closing"
      });
    }
    const handler = openHandler;
    const entry: {
      sourceUrl: string | null;
      result: Promise<AppLifecycleOpenWireResponse>;
      settled: boolean;
    } = {
      sourceUrl: request.sourceUrl,
      result: Promise.resolve({
        schema: APP_LIFECYCLE_PROTOCOL,
        status: "failed"
      }),
      settled: false
    };
    const operation: Promise<AppLifecycleOpenWireResponse> = operationTail.then(
      async (): Promise<AppLifecycleOpenWireResponse> => {
        try {
          await handler(request.sourceUrl);
          return {
            schema: APP_LIFECYCLE_PROTOCOL,
            status: "opened" as const
          };
        } catch (error) {
          return {
            schema: APP_LIFECYCLE_PROTOCOL,
            status: error instanceof AppLifecycleRetryError
              ? "retry" as const
              : "failed" as const
          };
        }
      }
    );
    entry.result = operation;
    results.set(request.requestId, entry);
    operationTail = operation.then(() => undefined, () => undefined);
    void operation.then((response) => {
      entry.settled = true;
      if (response.status === "retry") {
        results.delete(request.requestId);
      }
      if (results.size <= APP_LIFECYCLE_RESULT_CACHE_LIMIT) {
        return;
      }
      for (const [requestId, candidate] of results) {
        if (results.size <= APP_LIFECYCLE_RESULT_CACHE_LIMIT) {
          break;
        }
        if (candidate.settled) {
          results.delete(requestId);
        }
      }
    });
    return operation;
  };

  const server = createServer((socket) => {
    socket.once("error", () => {});
    socket.setTimeout(APP_LIFECYCLE_READ_TIMEOUT_MS, () => socket.destroy());
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let processing = false;
    socket.on("data", (chunk: Buffer) => {
      if (processing) {
        socket.destroy();
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > APP_LIFECYCLE_MAX_REQUEST_BYTES) {
        processing = true;
        socket.end(appLifecycleWireResponse("failed"));
        return;
      }
      chunks.push(chunk);
      const combined = Buffer.concat(chunks, receivedBytes);
      const newline = combined.indexOf(0x0a);
      if (newline < 0) {
        return;
      }
      processing = true;
      socket.pause();
      socket.setTimeout(APP_LIFECYCLE_OPEN_TIMEOUT_MS, () => socket.destroy());
      if (newline !== combined.length - 1) {
        socket.end(appLifecycleWireResponse("failed"));
        return;
      }
      let request: AppLifecycleOpenWireRequest;
      try {
        request = parseAppLifecycleOpenRequest(combined);
      } catch {
        socket.end(appLifecycleWireResponse("failed"));
        return;
      }
      void dispatch(request).then((response) => {
        if (!socket.destroyed) {
          socket.end(appLifecycleWireResponse(response.status));
        }
      });
    });
  });
  let boundEndpointMetadata: Awaited<ReturnType<typeof lstat>> | null = null;
  let owned: boolean;
  try {
    owned = await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const onError = (error: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error.code === "EADDRINUSE") {
          resolve(false);
          return;
        }
        reject(error);
      };
      server.on("error", onError);
      server.listen(socketName, () => {
        void (async () => {
          if (settled) {
            return;
          }
          try {
            await chmod(socketName, 0o600);
            const metadata = await trustedAppLifecycleSocketMetadata(socketName);
            if (!metadata || (Number(metadata.mode) & 0o777) !== 0o600) {
              throw new Error(
                "Kirinuki lifecycle IPC socket 권한을 0600으로 제한하지 못했습니다."
              );
            }
            boundEndpointMetadata = metadata;
            settled = true;
            resolve(true);
          } catch (error) {
            settled = true;
            server.close(() => reject(error));
          }
        })();
      });
    });
  } catch (error) {
    await endpoint.close();
    throw error;
  }
  if (!owned) {
    let released = false;
    const release = createIdempotentAsyncAction(async () => {
      released = true;
      await endpoint.close();
    });
    return {
      owned: false,
      activateOpenRequests: () => {
        throw new Error("secondary Kirinuki 실행은 open 요청을 받을 수 없습니다.");
      },
      requestOpen: async (sourceUrl, requestId) => (
        released
          ? { status: "unavailable" }
          : requestAppLifecycleOpen(
          socketName,
          endpoint.physicalSocketName,
          stateRoot,
          sourceUrl,
          requestId
        )
      ),
      beginClosing: async () => {},
      resumeOpenRequests: async () => {},
      release
    };
  }
  const beginClosing = async () => {
    if (state === "released") {
      return;
    }
    state = "closing";
    await operationTail;
  };
  const release = createIdempotentAsyncAction(async () => {
    try {
      await beginClosing();
      state = "released";
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }
          reject(error);
        });
      });
      const currentEndpoint = await trustedAppLifecycleSocketMetadata(
        socketName
      );
      if (
        currentEndpoint
        && boundEndpointMetadata
        && currentEndpoint.dev === boundEndpointMetadata.dev
        && currentEndpoint.ino === boundEndpointMetadata.ino
        && currentEndpoint.uid === boundEndpointMetadata.uid
      ) {
        await unlink(socketName).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });
      }
    } finally {
      await endpoint.close();
    }
  });
  return {
    owned: true,
    activateOpenRequests: (handler) => {
      if (state === "closing" || state === "released") {
        throw new Error("종료 중인 Kirinuki owner는 open 요청을 다시 받을 수 없습니다.");
      }
      openHandler = handler;
      state = "ready";
    },
    requestOpen: async () => ({ status: "failed" }),
    beginClosing,
    resumeOpenRequests: async () => {
      await operationTail;
      if (state === "released" || !openHandler) {
        throw new Error("Kirinuki lifecycle open 요청을 재개할 수 없습니다.");
      }
      state = "ready";
    },
    release
  };
}

export function shouldCycleForegroundCaption(
  status: CaptionStatus | null | undefined
): boolean {
  return Boolean(
    status?.configured
    && status.runtime?.manager === "foreground"
    && status.runtime?.managedForeground
  );
}

export function shouldCycleVodRuntime(
  status: VodRuntimeStatus | null | undefined
): boolean {
  return Boolean(status?.managed && status.managerPid);
}

export function shouldCycleStudioServer(
  status: StudioServerStatus | null | undefined
): boolean {
  return Boolean(
    status?.ready
    && status.ownership === "managed"
    && status.managerPid
  );
}

async function setupCommand(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  const mode = options.mode || await chooseMode(options, context);
  const browserReport = inspectBrowser({
    requested: options.browser,
    env: context.env
  });
  const npm = npmBinary(context.env);
  const missing = [];
  if (context.platform !== "linux") {
    missing.push("Linux");
  }
  if (!versionAtLeast(process.versions.node, MINIMUM_NODE_VERSION)) {
    missing.push(`Node ${MINIMUM_NODE_VERSION}+`);
  }
  if (!npm) {
    missing.push("npm");
  }
  if (!browserReport.available) {
    missing.push("Chromium 계열 브라우저");
  } else if (!browserReport.supported) {
    missing.push(`Chromium 계열 브라우저 ${MINIMUM_BROWSER_VERSION}+`);
  }
  for (const [name, executable] of Object.entries(vodNativeTools(context.env))) {
    if (!executable) {
      missing.push(name);
    }
  }
  if (mode === "whisper") {
    for (const [name, executable] of Object.entries(nativeTools(context.env))) {
      if (!executable) {
        missing.push(name);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `필수 환경이 없습니다: ${missing.join(", ")}\n`
      + dependencyGuidance(mode).join("\n")
    );
  }
  if (!npm) {
    throw new Error("npm 실행 파일을 확인하지 못했습니다.");
  }

  const plan = setupPlan(
    npm,
    mode,
    options.profile,
    options.backend
  );
  const captionAtDryRun = mode === "whisper"
    ? readCaptionStatus(context.env)
    : null;
  const vodAtDryRun = readVodRuntimeStatus(
    context.env,
    context.paths.packageRoot
  );
  const studioAtDryRun = readStudioServerStatus(context.env);
  line(
    context.stdout,
    `설정 방식: ${mode === "whisper" ? "로컬 Whisper 글+타이밍" : "AudSeg 빈 타이밍"}`
  );
  line(context.stdout, "앱 연결 범위: 이 기기 내부 전용");
  if (options.dryRun) {
    line(context.stdout, "dry-run: 다음 명령을 실행하지 않고 표시합니다.");
    for (const [file, args] of plan) {
      line(context.stdout, `  ${describeCommand(file, args)}`);
    }
    if (
      captionAtDryRun?.ok
      && shouldCycleForegroundCaption(captionAtDryRun.value)
    ) {
      line(
        context.stdout,
        `  실행 중인 foreground 재설정: ${describeCommand(process.execPath, captionStackArgs("stop"))} 후 다시 시작`
      );
    }
    if (vodAtDryRun.ok && shouldCycleVodRuntime(vodAtDryRun.value)) {
      line(
        context.stdout,
        `  실행 중인 VOD runtime 재설정: ${describeCommand(process.execPath, vodRuntimeArgs("stop"))} 후 다시 시작`
      );
    }
    if (
      studioAtDryRun.ok
      && shouldCycleStudioServer(studioAtDryRun.value)
    ) {
      line(
        context.stdout,
        `  실행 중인 편집 화면 엔진 재설정: ${describeCommand(process.execPath, studioServerArgs("stop"))} 후 ${describeCommand(process.execPath, studioServerStartArgs(context.studioOrigin))}`
      );
    }
    line(
      context.stdout,
      `  브라우저 프로필: ${context.paths.browserProfileRoot}`
    );
    line(context.stdout, "  편집 화면: 앱 내부에서 자동 시작");
    line(
      context.stdout,
      `  사용자 명령 설치: ${context.paths.userLauncherPath}`
    );
    line(
      context.stdout,
      "  앱 메뉴 설치 및 Kirinuki 링크 연결"
    );
    const refresh = desktopDatabaseRefreshCommand(
      context.paths,
      context.env
    );
    line(
      context.stdout,
      refresh
        ? `  앱 메뉴 등록 갱신: ${describeCommand(refresh.file, refresh.args)}`
        : "  앱 메뉴 등록 갱신 도구 없음(다음 로그인 때 반영될 수 있음)"
    );
    const mimeRegistration = desktopMimeRegistrationCommand(
      context.paths,
      context.env
    );
    line(
      context.stdout,
      mimeRegistration
        ? `  Kirinuki 앱 링크 연결: ${describeCommand(mimeRegistration.file, mimeRegistration.args)}`
        : "  앱 링크 연결 도구 없음(앱 메뉴는 설치하며 연결은 다음 로그인 뒤 확인 필요)"
    );
    const entrypoints = await inspectUserEntrypoints(context.paths);
    if (entrypoints.legacyDesktop.recognized) {
      line(
        context.stdout,
        `  인식된 레거시 MIME 앱 메뉴를 복구 가능한 이름으로 은퇴: ${entrypoints.legacyDesktop.path}`
      );
    }
    return;
  }

  let cycleForeground = false;
  let cycleVodRuntime = false;
  let cycleStudioServer = false;
  let restoreForeground = false;
  let restoreVodRuntime = false;
  let restoreStudioServer = false;
  try {
    const studioImmediatelyBeforeSetup = readStudioServerStatus(context.env);
    cycleStudioServer = Boolean(
      studioImmediatelyBeforeSetup.ok
      && shouldCycleStudioServer(studioImmediatelyBeforeSetup.value)
    );
    if (cycleStudioServer) {
      const actualStudioOrigin = studioImmediatelyBeforeSetup.ok
        ? studioImmediatelyBeforeSetup.value.studioOrigin
        : null;
      if (!isKirinukiStudioOrigin(actualStudioOrigin)) {
        throw new Error(
          "실행 중인 편집 화면 엔진의 구성을 확인하지 못해 갱신 전에 중지하지 않았습니다."
        );
      }
      restoreStudioServer = (
        actualStudioOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN
      );
      line(
        context.stdout,
        "실행 중인 편집 화면 엔진을 안전하게 중지한 뒤 새 버전으로 복원합니다."
      );
      await runStreaming(process.execPath, studioServerArgs("stop"), {
        cwd: packageRoot,
        env: withoutSecrets(context.env)
      });
    }
    for (const [file, args] of plan) {
      const isVodRuntimeCommand = (
        file === process.execPath
        && args.includes(vodRuntimeCliPath)
      );
      const isVodRuntimeSetup = (
        isVodRuntimeCommand
        && args[args.indexOf(vodRuntimeCliPath) + 1] === "setup"
      );
      if (isVodRuntimeSetup) {
        const vodImmediatelyBeforeSetup = readVodRuntimeStatus(
          context.env,
          context.paths.packageRoot
        );
        cycleVodRuntime = Boolean(
          vodImmediatelyBeforeSetup.ok
          && shouldCycleVodRuntime(vodImmediatelyBeforeSetup.value)
        );
        if (cycleVodRuntime) {
          const actualVodOrigin = vodImmediatelyBeforeSetup.ok
            ? vodImmediatelyBeforeSetup.value.origin?.configured
            : null;
          if (!isKirinukiStudioOrigin(actualVodOrigin)) {
            throw new Error(
              "실행 중인 미디어 엔진의 구성을 확인하지 못해 갱신 전에 중지하지 않았습니다."
            );
          }
          restoreVodRuntime = (
            actualVodOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN
          );
          line(
            context.stdout,
            "실행 중인 미디어 엔진을 안전하게 중지한 뒤 복원합니다."
          );
          await runStreaming(process.execPath, vodRuntimeArgs("stop"), {
            cwd: packageRoot,
            env: vodRuntimeChildEnvironment(
              context.env,
              context.paths.packageRoot
            )
          });
        }
      }
      const isCaptionSetup = (
        file === process.execPath
        && args.includes(stackCliPath)
        && args[args.indexOf(stackCliPath) + 1] === "setup"
      );
      if (isCaptionSetup) {
        const captionImmediatelyBeforeSetup = readCaptionStatus(context.env);
        cycleForeground = Boolean(
          captionImmediatelyBeforeSetup.ok
          && shouldCycleForegroundCaption(
            captionImmediatelyBeforeSetup.value
          )
        );
        if (cycleForeground) {
          const actualCaptionOrigin = captionImmediatelyBeforeSetup.ok
            ? captionImmediatelyBeforeSetup.value.configuredOrigin
            : null;
          if (!isKirinukiStudioOrigin(actualCaptionOrigin)) {
            throw new Error(
              "실행 중인 Whisper 자막 엔진의 앱 연결 구성을 확인하지 못해 갱신 전에 중지하지 않았습니다."
            );
          }
          restoreForeground = (
            actualCaptionOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN
          );
          line(
            context.stdout,
            "실행 중인 foreground Whisper를 안전하게 중지한 뒤 같은 방식으로 복원합니다."
          );
          await runStreaming(process.execPath, captionStackArgs("stop"), {
            cwd: packageRoot,
            env: withoutSecrets(context.env)
          });
        }
      }
      await runStreaming(file, args, {
        cwd: packageRoot,
        env: isVodRuntimeCommand
          ? vodRuntimeChildEnvironment(
            context.env,
            context.paths.packageRoot
          )
          : withoutSecrets(context.env)
      });
    }
  } catch (error) {
    const restoreErrors: unknown[] = [];
    if (cycleVodRuntime && restoreVodRuntime) {
      try {
        await runStreaming(process.execPath, vodRuntimeArgs("start"), {
          cwd: packageRoot,
          env: vodRuntimeChildEnvironment(
            context.env,
            context.paths.packageRoot
          )
        });
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (cycleForeground && restoreForeground) {
      try {
        await ensureWhisper(
          options,
          context,
          {
          preferredManager: "foreground"
          }
        );
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (cycleStudioServer && restoreStudioServer) {
      try {
        await runStreaming(
          process.execPath,
          studioServerStartArgs(),
          {
          cwd: packageRoot,
          env: withoutSecrets(context.env)
          }
        );
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        "설정에 실패했고, 기존 로컬 runtime 복원도 일부 실패했습니다."
      );
    }
    throw error;
  }
  if (cycleVodRuntime) {
    await runStreaming(process.execPath, vodRuntimeArgs("start"), {
      cwd: packageRoot,
      env: vodRuntimeChildEnvironment(
        context.env,
        context.paths.packageRoot
      )
    });
    line(context.stdout, "관리형 VOD runtime 재설정·복원 완료");
  }
  if (cycleForeground) {
    await ensureWhisper(options, context, {
      preferredManager: "foreground"
    });
    line(context.stdout, "foreground Whisper 재설정·복원 완료");
  }
  if (cycleStudioServer) {
    await runStreaming(
      process.execPath,
      studioServerStartArgs(context.studioOrigin),
      {
        cwd: packageRoot,
        env: withoutSecrets(context.env)
      }
    );
    line(context.stdout, "편집 화면 엔진 새 버전 재시작 완료");
  }
  const selectedBuild = await inspectBuild(
    packageRoot,
    context.studioOrigin
  );
  if (!selectedBuild.ready) {
    throw new Error(
      `Kirinuki 편집 화면 빌드가 완성되지 않았습니다: ${packageRoot}\n`
      + `필수 파일을 확인하세요: ${selectedBuild.files.join(", ")}`
    );
  }
  await writeSettings(context.paths, {
    mode,
    browser: browserReport.binary
  });
  await restoreLauncherPermissions();
  const installedEntrypoints = await installUserEntrypoints(context.paths);
  line(context.stdout, "Kirinuki 앱 준비 완료");
  line(
    context.stdout,
    `사용자 명령 설치 완료: ${context.paths.userLauncherPath}`
  );
  line(
    context.stdout,
    "앱 메뉴 설치 완료"
  );
  for (const backup of installedEntrypoints.replacedEntrypointBackups) {
    line(context.stdout, `이전 Kirinuki 진입점 복구본: ${backup}`);
  }
  if (installedEntrypoints.retiredLegacyPath) {
    line(
      context.stdout,
      `레거시 MIME 앱 메뉴 은퇴 완료: ${installedEntrypoints.retiredLegacyPath}`
    );
  }
  const refresh = desktopDatabaseRefreshCommand(
    context.paths,
    context.env
  );
  if (refresh) {
    await runStreaming(refresh.file, refresh.args, {
      cwd: packageRoot,
      env: withoutSecrets(context.env)
    });
    line(context.stdout, "Kirinuki 앱 메뉴와 앱 링크 등록 갱신 완료");
  } else {
    line(
      context.stdout,
      "앱 메뉴 등록 갱신 도구가 없어 파일만 설치했습니다. 앱 링크 연결은 다음 로그인 때 반영될 수 있습니다."
    );
  }
  const mimeRegistration = desktopMimeRegistrationCommand(
    context.paths,
    context.env
  );
  if (mimeRegistration) {
    await runStreaming(mimeRegistration.file, mimeRegistration.args, {
      cwd: packageRoot,
      env: withoutSecrets(context.env)
    });
    line(context.stdout, "Kirinuki 앱 링크 연결 완료");
  } else {
    line(
      context.stdout,
      "앱 링크 연결 도구를 찾지 못했습니다. 앱 메뉴는 설치했으며, 다음 로그인 뒤 링크 연결 상태를 확인하세요."
    );
  }
  line(
    context.stdout,
    `영상 열기: kirinuki open "${DEFAULT_SOURCE_URL}"`
  );
  if (mode === "whisper") {
    line(
      context.stdout,
      "첫 영상 열기 때 로컬 Whisper 서비스도 자동으로 준비합니다."
    );
  }
}

async function chooseMode(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<CaptionMode> {
  if (options.yes || !context.stdin.isTTY || !context.stdout.isTTY) {
    return "audseg";
  }
  const rl = createInterface({
    input: context.stdin,
    output: context.stdout
  });
  try {
    line(context.stdout, "자막 초벌 방식을 고르세요.");
    line(context.stdout, "  1) AudSeg — 모델 없이 빈 타이밍만 생성");
    line(context.stdout, "  2) Whisper Tiny — 한국어 글과 타이밍 생성");
    const answer = String(
      await rl.question("선택 [1]: ")
    ).trim();
    if (!answer || answer === "1") {
      return "audseg";
    }
    if (answer === "2") {
      return "whisper";
    }
    throw new TypeError("1 또는 2를 입력하세요.");
  } finally {
    rl.close();
  }
}

export function browserLaunchArgs({
  profileRoot,
  streamingCompanionRoot,
  sourceUrl = null,
  studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
}: {
  profileRoot: string;
  streamingCompanionRoot: string;
  sourceUrl?: string | null;
  studioOrigin?: KirinukiStudioOrigin;
}): string[] {
  const profile = path.resolve(profileRoot);
  const companion = path.resolve(streamingCompanionRoot);
  const studioUrl = new URL(studioUrlForOrigin(studioOrigin));
  if (sourceUrl) {
    studioUrl.searchParams.set("source", validateSourceUrl(sourceUrl));
  }
  return [
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${companion}`,
    `--load-extension=${companion}`,
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=${STREAMING_BRIDGE_PROTOCOL}`,
    `${STUDIO_ORIGIN_IDENTITY_OPTION}=${studioOrigin}`,
    "--no-first-run",
    "--no-default-browser-check",
    studioUrl.href
  ];
}

const EXACT_EXTENSION_FLAGS = Object.freeze([
  "--disable-extensions-except",
  "--load-extension"
] as const);
const EXTENSION_AFFECTING_FLAG = (
  /^--(?:disable-extensions|disable-extensions-except|enable-extensions|extensions-on-chrome-urls|load-extension)(?:=|$)/u
);
const HIGH_RISK_BROWSER_FLAG = (
  /^--(?:allow-running-insecure-content|disable-setuid-sandbox|disable-web-security|ignore-certificate-errors|no-sandbox|proxy-server|remote-debugging-address|remote-debugging-pipe|remote-debugging-port)(?:=|$)/u
);

function commandOptionValues(
  argv: readonly string[],
  option: string
): Array<string | null> {
  const values: Array<string | null> = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === option) {
      const following = argv[index + 1];
      values.push(
        following && !following.startsWith("--")
          ? following
          : null
      );
      if (following && !following.startsWith("--")) {
        index += 1;
      }
      continue;
    }
    if (value?.startsWith(`${option}=`)) {
      values.push(value.slice(option.length + 1) || null);
    }
  }
  return values;
}

function normalizedCommandPath(value: string | null): string | null {
  if (
    !value
    || value.trim() !== value
    || /[\0\r\n]/u.test(value)
    || !path.isAbsolute(value)
  ) {
    return null;
  }
  return path.resolve(value);
}

function browserExecutableMatches(
  candidate: string,
  product: BrowserReport["product"]
): boolean {
  const basename = path.basename(candidate).toLowerCase();
  if (product === "chromium") {
    return basename === "chromium" || basename === "chromium-browser";
  }
  if (product === "chrome") {
    return [
      "chrome",
      "chrome-wrapper",
      "google-chrome",
      "google-chrome-stable"
    ].includes(basename);
  }
  return false;
}

function chromiumRuntimeChromeExecutableMatches(candidate: string): boolean {
  if (!path.isAbsolute(candidate) || path.basename(candidate) !== "chrome") {
    return false;
  }
  const normalized = path.resolve(candidate);
  return [
    "/snap/chromium/",
    "/var/lib/snapd/snap/chromium/",
    "/usr/lib/chromium-browser/"
  ].some((root) => normalized.startsWith(root))
    && normalized.includes("/chromium-browser/chrome");
}

export function classifyDedicatedBrowserProcess(
  snapshot: DedicatedBrowserProcessSnapshot,
  {
    profileRoot,
    streamingCompanionRoot,
    legacyExtensionRoot,
    product,
    expectedUid,
    streamingCompanionProtocol = STREAMING_BRIDGE_PROTOCOL,
    studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
  }: {
    profileRoot: string;
    streamingCompanionRoot: string;
    legacyExtensionRoot: string;
    product: BrowserReport["product"];
    expectedUid: number;
    streamingCompanionProtocol?: string;
    studioOrigin?: KirinukiStudioOrigin;
  }
): DedicatedBrowserProcessClassification {
  const profileValues = commandOptionValues(
    snapshot.argv,
    "--user-data-dir"
  );
  const expectedProfile = path.resolve(profileRoot);
  const normalizedProfiles = profileValues.map(normalizedCommandPath);
  if (!normalizedProfiles.includes(expectedProfile)) {
    return "unrelated";
  }
  const isChild = snapshot.argv.some((value) => (
    value === "--type" || value.startsWith("--type=")
  ));
  const ordinaryBrowserIdentityMatches = (
    snapshot.ownerUid === expectedUid
    && browserExecutableMatches(snapshot.executable, product)
    && Boolean(snapshot.argv[0])
    && browserExecutableMatches(snapshot.argv[0] || "", product)
  );
  const chromiumRuntimeChromeIdentityMatches = (
    product === "chromium"
    && snapshot.ownerUid === expectedUid
    && chromiumRuntimeChromeExecutableMatches(snapshot.executable)
    && Boolean(snapshot.argv[0])
    && chromiumRuntimeChromeExecutableMatches(snapshot.argv[0] || "")
  );
  if (
    (!ordinaryBrowserIdentityMatches && !chromiumRuntimeChromeIdentityMatches)
    || profileValues.length !== 1
    || normalizedProfiles[0] !== expectedProfile
    || snapshot.argv.some((value) => HIGH_RISK_BROWSER_FLAG.test(value))
  ) {
    return "conflict";
  }
  if (isChild) {
    return ordinaryBrowserIdentityMatches ? "profile-child" : "conflict";
  }

  const extensionArguments = snapshot.argv.filter((value) => (
    EXTENSION_AFFECTING_FLAG.test(value)
  ));
  if (extensionArguments.length === 0) {
    const protocolValues = commandOptionValues(
      snapshot.argv,
      STREAMING_COMPANION_PROTOCOL_OPTION
    );
    const originValues = commandOptionValues(
      snapshot.argv,
      STUDIO_ORIGIN_IDENTITY_OPTION
    );
    return ordinaryBrowserIdentityMatches
      && protocolValues.length === 0
      && originValues.length === 0
      ? "clean-root"
      : "conflict";
  }
  if (extensionArguments.length !== EXACT_EXTENSION_FLAGS.length) {
    return "conflict";
  }
  const extensionRoots = EXACT_EXTENSION_FLAGS.map((flag) => {
    const values = commandOptionValues(snapshot.argv, flag);
    return values.length === 1
      ? normalizedCommandPath(values[0] ?? null)
      : null;
  });
  if (
    extensionRoots.every((root) => (
      root === path.resolve(streamingCompanionRoot)
    ))
  ) {
    const protocolValues = commandOptionValues(
      snapshot.argv,
      STREAMING_COMPANION_PROTOCOL_OPTION
    );
    const originValues = commandOptionValues(
      snapshot.argv,
      STUDIO_ORIGIN_IDENTITY_OPTION
    );
    const exactAppRuntime = protocolValues.length === 1
      && protocolValues[0] === streamingCompanionProtocol
      && originValues.length === 1
      && originValues[0] === studioOrigin;
    if (exactAppRuntime) {
      return "app-runtime-root";
    }
    return ordinaryBrowserIdentityMatches
      ? "stale-app-runtime-root"
      : "conflict";
  }
  if (
    extensionRoots.every((root) => (
      root === path.resolve(legacyExtensionRoot)
    ))
  ) {
    const protocolValues = commandOptionValues(
      snapshot.argv,
      STREAMING_COMPANION_PROTOCOL_OPTION
    );
    const originValues = commandOptionValues(
      snapshot.argv,
      STUDIO_ORIGIN_IDENTITY_OPTION
    );
    return ordinaryBrowserIdentityMatches
      && protocolValues.length === 0
      && originValues.length === 0
      ? "legacy-extension-root"
      : "conflict";
  }
  return "conflict";
}

function parseProcStatIdentity(
  value: string
): { parentPid: number; startTimeTicks: string } | null {
  const closingParen = value.lastIndexOf(")");
  if (closingParen < 0) {
    return null;
  }
  const fields = value.slice(closingParen + 1).trim().split(/\s+/u);
  const parentPid = Number.parseInt(fields[1] || "", 10);
  const startTimeTicks = fields[19] || "";
  if (!Number.isSafeInteger(parentPid) || parentPid < 0 || !/^\d+$/u.test(
    startTimeTicks
  )) {
    return null;
  }
  return { parentPid, startTimeTicks };
}

async function readBrowserLauncherProcessIdentity(
  pid: number
): Promise<BrowserLauncherProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    const [procStat, procInfo] = await Promise.all([
      readFile(path.join("/proc", String(pid), "stat"), "utf8"),
      stat(path.join("/proc", String(pid)))
    ]);
    const identity = parseProcStatIdentity(procStat);
    if (!identity) {
      return null;
    }
    return {
      pid,
      ownerUid: procInfo.uid,
      startTimeTicks: identity.startTimeTicks
    };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(errnoCode(error))) {
      return null;
    }
    throw error;
  }
}

function commandUsesProfile(
  argv: readonly string[],
  profileRoot: string
): boolean {
  const expected = path.resolve(profileRoot);
  return commandOptionValues(argv, "--user-data-dir")
    .map(normalizedCommandPath)
    .includes(expected);
}

function logicalProcArgv(raw: Buffer): string[] {
  const nulSeparated = raw.toString("utf8").split("\0");
  if (nulSeparated.at(-1) === "") {
    nulSeparated.pop();
  }
  if (nulSeparated.length !== 1 || !nulSeparated[0]?.includes(" --")) {
    return nulSeparated;
  }
  // Chromium rewrites its visible process title into one space-joined argv
  // record. Split only at the beginning of a long option; values such as the
  // dedicated profile and preserved Extension path may themselves contain
  // ordinary spaces.
  return nulSeparated[0].split(/ (?=--[a-z][a-z0-9-]*(?:=|\s|$))/giu);
}

function rawCommandUsesProfile(
  raw: Buffer,
  argv: readonly string[],
  profileRoot: string
): boolean {
  if (commandUsesProfile(argv, profileRoot)) {
    return true;
  }
  const title = raw.toString("utf8").replace(/\0+$/u, "");
  if (title.includes("\0")) {
    return false;
  }
  const marker = `--user-data-dir=${path.resolve(profileRoot)}`;
  let offset = title.indexOf(marker);
  while (offset >= 0) {
    const before = title.slice(0, offset);
    const after = title.slice(offset + marker.length);
    if (
      (before === "" || before.endsWith(" "))
      && (after === "" || after.startsWith(" --"))
    ) {
      return true;
    }
    offset = title.indexOf(marker, offset + 1);
  }
  return false;
}

interface DedicatedBrowserRuntimeInspection {
  report: DedicatedBrowserRuntimeReport;
  processes: DedicatedBrowserProcessSnapshot[];
  main: DedicatedBrowserProcessSnapshot | null;
}

function dedicatedBrowserRuntimeReport(
  processes: readonly DedicatedBrowserProcessSnapshot[],
  {
    profileRoot,
    streamingCompanionRoot,
    legacyExtensionRoot,
    product,
    expectedUid,
    streamingCompanionProtocol = STREAMING_BRIDGE_PROTOCOL,
    studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN,
    unreadableCandidate = null
  }: {
    profileRoot: string;
    streamingCompanionRoot: string;
    legacyExtensionRoot: string;
    product: BrowserReport["product"];
    expectedUid: number;
    streamingCompanionProtocol?: string;
    studioOrigin?: KirinukiStudioOrigin;
    unreadableCandidate?: string | null;
  }
): DedicatedBrowserRuntimeInspection {
  if (unreadableCandidate) {
    return {
      report: {
        state: "unavailable",
        mainPid: null,
        profileProcessCount: processes.length,
        transitionRequired: false,
        reason: unreadableCandidate
      },
      processes: [...processes],
      main: null
    };
  }
  const classified = processes.map((snapshot) => ({
    snapshot,
    classification: classifyDedicatedBrowserProcess(snapshot, {
      profileRoot,
      streamingCompanionRoot,
      legacyExtensionRoot,
      product,
      expectedUid,
      streamingCompanionProtocol,
      studioOrigin
    })
  }));
  const conflicts = classified.filter((entry) => (
    entry.classification === "conflict"
  ));
  const roots = classified.filter((entry) => (
    entry.classification === "clean-root"
    || entry.classification === "app-runtime-root"
    || entry.classification === "stale-app-runtime-root"
    || entry.classification === "legacy-extension-root"
  ));
  if (conflicts.length > 0) {
    return {
      report: {
        state: "conflict",
        mainPid: conflicts[0]?.snapshot.pid ?? null,
        profileProcessCount: processes.length,
        transitionRequired: false,
        reason: "전용 profile을 쓰지만 브라우저·사용자·명령행 identity가 Kirinuki 서명과 다릅니다."
      },
      processes: [...processes],
      main: null
    };
  }
  if (roots.length === 0) {
    const state = processes.length === 0 ? "stopped" : "conflict";
    return {
      report: {
        state,
        mainPid: null,
        profileProcessCount: processes.length,
        transitionRequired: false,
        reason: state === "stopped"
          ? "전용 profile을 사용하는 브라우저 프로세스가 없습니다."
          : "전용 profile의 자식 프로세스만 남아 있어 새 브라우저를 안전하게 시작할 수 없습니다."
      },
      processes: [...processes],
      main: null
    };
  }
  if (roots.length !== 1) {
    return {
      report: {
        state: "conflict",
        mainPid: roots[0]?.snapshot.pid ?? null,
        profileProcessCount: processes.length,
        transitionRequired: false,
        reason: "같은 전용 profile을 주장하는 최상위 브라우저가 둘 이상입니다."
      },
      processes: [...processes],
      main: null
    };
  }
  const [root] = roots;
  if (!root) {
    throw new Error("전용 브라우저 root 분류가 비어 있습니다.");
  }
  const legacy = root.classification === "legacy-extension-root";
  const minimalCompanion = (
    root.classification === "app-runtime-root"
  );
  const staleMinimalCompanion = (
    root.classification === "stale-app-runtime-root"
  );
  return {
    report: {
      state: legacy
        ? "legacy-extension"
        : minimalCompanion
          ? "ready"
          : staleMinimalCompanion
            ? "update-required"
            : "clean",
      mainPid: root.snapshot.pid,
      profileProcessCount: processes.length,
      transitionRequired: legacy || !minimalCompanion,
      reason: legacy
        ? "현재 전용 Chromium이 이전 Kirinuki 브라우저 연결을 명시적으로 로드한 상태입니다."
        : minimalCompanion
          ? "Kirinuki 전용 브라우저 연결부가 현재 앱과 일치합니다."
          : staleMinimalCompanion
            ? "Kirinuki 전용 브라우저 연결부가 현재 앱 버전과 다릅니다. 창을 정상 종료한 뒤 kirinuki를 다시 실행하세요."
            : "현재 전용 브라우저가 Kirinuki 앱이 시작한 상태가 아닙니다. 창을 정상 종료한 뒤 kirinuki를 다시 실행하세요."
    },
    processes: [...processes],
    main: root.snapshot
  };
}

export function summarizeDedicatedBrowserProcesses(
  processes: readonly DedicatedBrowserProcessSnapshot[],
  options: {
    profileRoot: string;
    streamingCompanionRoot: string;
    legacyExtensionRoot: string;
    product: BrowserReport["product"];
    expectedUid: number;
    streamingCompanionProtocol?: string;
    studioOrigin?: KirinukiStudioOrigin;
  }
): DedicatedBrowserRuntimeReport {
  return dedicatedBrowserRuntimeReport(processes, options).report;
}

export function selectVerifiedBrowserRootAfterLauncherExit(
  processes: readonly DedicatedBrowserProcessSnapshot[],
  options: {
    profileRoot: string;
    streamingCompanionRoot: string;
    legacyExtensionRoot: string;
    product: BrowserReport["product"];
    expectedUid: number;
    streamingCompanionProtocol?: string;
    studioOrigin?: KirinukiStudioOrigin;
  },
  launcher: BrowserLauncherProcessIdentity
): DedicatedBrowserProcessSnapshot | null {
  if (
    launcher.ownerUid !== options.expectedUid
    || !Number.isSafeInteger(launcher.pid)
    || launcher.pid <= 0
    || !/^\d+$/u.test(launcher.startTimeTicks)
  ) {
    throw new Error("Chromium launcher의 process identity를 검증하지 못했습니다.");
  }
  const inspection = dedicatedBrowserRuntimeReport(processes, options);
  if (inspection.report.state === "stopped") {
    return null;
  }
  if (inspection.report.state !== "ready" || !inspection.main) {
    throw new Error(
      `Chromium launcher 종료 뒤 앱 브라우저 root를 검증하지 못했습니다: ${inspection.report.reason}`
    );
  }
  const root = inspection.main;
  if (
    root.pid === launcher.pid
    || root.ownerUid !== launcher.ownerUid
    || !/^\d+$/u.test(root.startTimeTicks)
    || BigInt(root.startTimeTicks) < BigInt(launcher.startTimeTicks)
  ) {
    throw new Error(
      "Chromium launcher 종료 뒤 발견한 앱 브라우저의 PID·UID·시작 identity가 launch와 이어지지 않습니다."
    );
  }
  return root;
}

export function dedicatedBrowserPreparationDisposition(
  report: DedicatedBrowserRuntimeReport
): DedicatedBrowserPreparationDisposition {
  if (report.state === "stopped") {
    return "launch";
  }
  if (report.state === "ready") {
    return "reuse-app-runtime";
  }
  if (report.state === "legacy-extension") {
    return "transition-exact-legacy";
  }
  if (report.state === "update-required") {
    return "reject-stale-minimal-without-signal";
  }
  return report.state === "clean"
    ? "reject-clean-without-signal"
    : "reject-unverified";
}

async function readDedicatedBrowserProcesses(
  profileRoot: string
): Promise<{
  processes: DedicatedBrowserProcessSnapshot[];
  unreadableCandidate: string | null;
}> {
  const entries = await readdir("/proc", { withFileTypes: true });
  const processes: DedicatedBrowserProcessSnapshot[] = [];
  let unreadableCandidate: string | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
      continue;
    }
    const pid = Number.parseInt(entry.name, 10);
    const procRoot = path.join("/proc", entry.name);
    let argv: string[];
    try {
      const raw = await readFile(path.join(procRoot, "cmdline"));
      argv = logicalProcArgv(raw);
      if (!rawCommandUsesProfile(raw, argv, profileRoot)) {
        continue;
      }
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(errnoCode(error))) {
        throw error;
      }
      continue;
    }
    try {
      const [procStat, executable, procInfo] = await Promise.all([
        readFile(path.join(procRoot, "stat"), "utf8"),
        readlink(path.join(procRoot, "exe")),
        stat(procRoot)
      ]);
      const identity = parseProcStatIdentity(procStat);
      if (!identity) {
        throw new TypeError("올바르지 않은 /proc stat identity");
      }
      processes.push({
        pid,
        parentPid: identity.parentPid,
        ownerUid: procInfo.uid,
        startTimeTicks: identity.startTimeTicks,
        executable: path.resolve(executable),
        argv
      });
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(errnoCode(error))) {
        continue;
      }
      unreadableCandidate = (
        `PID ${pid}가 전용 profile을 주장하지만 identity를 완전히 읽지 못했습니다.`
      );
      break;
    }
  }
  return { processes, unreadableCandidate };
}

async function inspectDedicatedBrowserRuntimeDetailed({
  profileRoot,
  streamingCompanionRoot,
  legacyExtensionRoot,
  product,
  streamingCompanionProtocol = STREAMING_BRIDGE_PROTOCOL,
  studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
}: {
  profileRoot: string;
  streamingCompanionRoot: string;
  legacyExtensionRoot: string;
  product: BrowserReport["product"];
  streamingCompanionProtocol?: string;
  studioOrigin?: KirinukiStudioOrigin;
}): Promise<DedicatedBrowserRuntimeInspection> {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    return {
      report: {
        state: "unavailable",
        mainPid: null,
        profileProcessCount: 0,
        transitionRequired: false,
        reason: "전용 브라우저 process identity 검사는 Linux /proc가 필요합니다."
      },
      processes: [],
      main: null
    };
  }
  try {
    const scan = await readDedicatedBrowserProcesses(profileRoot);
    return dedicatedBrowserRuntimeReport(scan.processes, {
      profileRoot,
      streamingCompanionRoot,
      legacyExtensionRoot,
      product,
      expectedUid: process.getuid(),
      streamingCompanionProtocol,
      studioOrigin,
      unreadableCandidate: scan.unreadableCandidate
    });
  } catch (error) {
    return {
      report: {
        state: "unavailable",
        mainPid: null,
        profileProcessCount: 0,
        transitionRequired: false,
        reason: `전용 브라우저 process identity를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
      },
      processes: [],
      main: null
    };
  }
}

async function inspectBrowserRuntimeAfterLauncherExit(
  browser: BrowserReport,
  context: LinuxHelperContext,
  timeoutMs = 5_000
): Promise<DedicatedBrowserRuntimeInspection> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const current = await inspectDedicatedBrowserRuntimeDetailed({
      profileRoot: context.paths.browserProfileRoot,
      streamingCompanionRoot: context.paths.streamingCompanionRoot,
      legacyExtensionRoot: context.paths.legacyExtensionRoot,
      product: browser.product,
      studioOrigin: context.studioOrigin
    });
    if (current.report.state === "ready" || Date.now() >= deadline) {
      return current;
    }
    await delay(100);
  }
}

export async function inspectDedicatedBrowserRuntime({
  profileRoot,
  streamingCompanionRoot,
  legacyExtensionRoot,
  product,
  streamingCompanionProtocol = STREAMING_BRIDGE_PROTOCOL,
  studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
}: {
  profileRoot: string;
  streamingCompanionRoot: string;
  legacyExtensionRoot: string;
  product: BrowserReport["product"];
  streamingCompanionProtocol?: string;
  studioOrigin?: KirinukiStudioOrigin;
}): Promise<DedicatedBrowserRuntimeReport> {
  return (
    await inspectDedicatedBrowserRuntimeDetailed({
      profileRoot,
      streamingCompanionRoot,
      legacyExtensionRoot,
      product,
      streamingCompanionProtocol,
      studioOrigin
    })
  ).report;
}

export function sameProcessIdentity(
  left: DedicatedBrowserProcessSnapshot,
  right: DedicatedBrowserProcessSnapshot
): boolean {
  // parentPid is deliberately excluded: a wrapper-owned Chromium root can be
  // reparented after the wrapper exits without changing the process identity.
  return left.pid === right.pid
    && left.ownerUid === right.ownerUid
    && left.startTimeTicks === right.startTimeTicks
    && left.executable === right.executable
    && left.argv.length === right.argv.length
    && left.argv.every((value, index) => value === right.argv[index]);
}

async function prepareDedicatedBrowserRuntime(
  browser: BrowserReport,
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<DedicatedBrowserRuntimeReport> {
  const inspect = () => inspectDedicatedBrowserRuntimeDetailed({
    profileRoot: context.paths.browserProfileRoot,
    streamingCompanionRoot: context.paths.streamingCompanionRoot,
    legacyExtensionRoot: context.paths.legacyExtensionRoot,
    product: browser.product,
    studioOrigin: context.studioOrigin
  });
  const initial = await inspect();
  const disposition = dedicatedBrowserPreparationDisposition(initial.report);
  if (disposition === "launch" || disposition === "reuse-app-runtime") {
    return initial.report;
  }
  if (disposition === "reject-clean-without-signal") {
    throw new Error(
      "실행 중인 전용 Chromium이 Kirinuki 앱의 브라우저 연결부를 사용하지 않습니다.\n"
      + "현재 창을 강제로 종료하지 않았습니다. 창을 정상 종료한 뒤 kirinuki를 다시 실행하세요."
    );
  }
  if (disposition === "reject-stale-minimal-without-signal") {
    throw new Error(
      "실행 중인 전용 Chromium의 앱 연결부가 현재 Kirinuki 버전과 맞지 않습니다.\n"
      + "이 프로세스는 강제로 종료하지 않았습니다. 창을 정상 종료한 뒤 kirinuki를 다시 실행하세요."
    );
  }
  if (disposition !== "transition-exact-legacy" || !initial.main) {
    throw new Error(
      `전용 브라우저 profile을 안전하게 전환할 수 없습니다: ${initial.report.reason}\n`
      + "창을 정상 종료한 뒤 kirinuki를 다시 실행하세요. 검증되지 않은 PID는 종료하지 않습니다."
    );
  }
  if (options.dryRun) {
    line(
      context.stdout,
      `dry-run: PID ${initial.main.pid}의 정확히 일치하는 이전 Kirinuki Chromium에 SIGTERM을 한 번 보내고 완전 종료를 확인한 뒤 현재 앱 전용 브라우저로 다시 시작`
    );
    return initial.report;
  }

  const immediatelyBeforeSignal = await inspect();
  if (
    immediatelyBeforeSignal.report.state === "stopped"
    || immediatelyBeforeSignal.report.state === "ready"
  ) {
    return immediatelyBeforeSignal.report;
  }
  if (immediatelyBeforeSignal.report.state === "clean") {
    throw new Error(
      "이전 버전 재검증 사이에 Kirinuki가 시작하지 않은 전용 Chromium이 열렸습니다. 창을 강제로 종료하지 않았으므로 정상 종료한 뒤 다시 실행하세요."
    );
  }
  if (
    immediatelyBeforeSignal.report.state !== "legacy-extension"
    || !immediatelyBeforeSignal.main
    || !sameProcessIdentity(
      initial.main,
      immediatelyBeforeSignal.main
    )
  ) {
    throw new Error(
      "이전 Kirinuki 브라우저의 PID·시작시각·프로필·실행파일·명령행이 검사 사이에 바뀌어 종료하지 않았습니다. Kirinuki를 다시 실행하세요."
    );
  }

  try {
    process.kill(immediatelyBeforeSignal.main.pid, "SIGTERM");
  } catch (error) {
    if (errnoCode(error) !== "ESRCH") {
      throw new Error(
        `검증된 이전 Kirinuki 브라우저 PID ${immediatelyBeforeSignal.main.pid}에 정상 종료 요청을 보내지 못했습니다.`,
        { cause: error }
      );
    }
  }
  line(
    context.stdout,
    `검증된 이전 Kirinuki 브라우저 PID ${immediatelyBeforeSignal.main.pid}에 정상 종료를 요청하고 저장 프로필이 닫히기를 기다립니다.`
  );

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await delay(200);
    const current = await inspect();
    if (current.report.state === "stopped") {
      line(
        context.stdout,
        "이전 Kirinuki Chromium이 완전히 종료됐습니다. 같은 프로필을 보존한 채 현재 앱 전용 브라우저로 전환합니다."
      );
      return current.report;
    }
    if (current.report.state === "ready") {
      return current.report;
    }
    if (current.report.state === "clean") {
      throw new Error(
        "종료 대기 중 Kirinuki가 시작하지 않은 전용 Chromium이 열렸습니다. 해당 창은 종료하지 않았으며 정상 종료 후 다시 실행해야 합니다."
      );
    }
    if (current.report.state === "update-required") {
      throw new Error(
        "종료 대기 중 현재 버전과 맞지 않는 Kirinuki Chromium이 열렸습니다. 해당 창은 종료하지 않았으며 정상 종료 후 다시 실행해야 합니다."
      );
    }
    if (
      current.report.state === "legacy-extension"
      && current.main
      && !sameProcessIdentity(
        immediatelyBeforeSignal.main,
        current.main
      )
    ) {
      throw new Error(
        "종료 대기 중 다른 이전 Kirinuki 브라우저가 같은 프로필로 시작돼 추가 종료 요청을 보내지 않았습니다."
      );
    }
    if (
      current.report.state === "conflict"
      && current.report.profileProcessCount > 0
      && !current.processes.every((candidate) => (
        candidate.pid === immediatelyBeforeSignal.main?.pid
        || candidate.parentPid === immediatelyBeforeSignal.main?.pid
        || candidate.argv.some((value) => value.startsWith("--type="))
      ))
    ) {
      throw new Error(
        `종료 대기 중 전용 profile identity가 달라졌습니다: ${current.report.reason}`
      );
    }
  }
  throw new Error(
    `검증된 이전 Kirinuki 브라우저 PID ${immediatelyBeforeSignal.main.pid}가 정상 종료 요청 후 20초 안에 완전히 닫히지 않았습니다. 강제 종료하지 않았으며 새 브라우저도 시작하지 않았습니다.`
  );
}

export function captionStartStrategy(
  status: CaptionStatus | null | undefined
): "setup-required" | "origin-mismatch" | "ready" | "systemd" | "foreground" {
  if (!status?.configured) {
    return "setup-required";
  }
  if (!captionOriginMatchesCurrentStudio(status)) {
    return "origin-mismatch";
  }
  if (status.endpoints?.stt && status.endpoints?.gateway) {
    return "ready";
  }
  return status.systemdUser ? "systemd" : "foreground";
}

async function ensureStudioServer(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  if (options.dryRun) {
    line(
      context.stdout,
      `dry-run: ${describeCommand(process.execPath, studioServerArgs("status", "--json"))}`
    );
    line(
      context.stdout,
      `dry-run: 필요할 때 ${describeCommand(process.execPath, studioServerStartArgs(context.studioOrigin))}`
    );
    return;
  }
  let result = readStudioServerStatus(context.env);
  if (!result.ok) {
    throw new Error("편집 화면 엔진 상태를 읽지 못했습니다.");
  }
  if (result.value.ready && result.value.ownership === "managed") {
    if (studioServerMatchesOrigin(result.value, context.studioOrigin)) {
      return;
    }
    await runStreaming(process.execPath, studioServerArgs("stop"), {
      cwd: packageRoot,
      env: withoutSecrets(context.env)
    });
  }
  await runStreaming(process.execPath, studioServerStartArgs(
    context.studioOrigin
  ), {
    cwd: packageRoot,
    env: withoutSecrets(context.env)
  });
  result = readStudioServerStatus(context.env);
  if (
    !result.ok
    || !studioServerMatchesOrigin(result.value, context.studioOrigin)
  ) {
    throw new Error(
      result.ok
        ? "편집 화면 엔진을 시작했지만 Kirinuki 소유 상태를 검증하지 못했습니다."
        : "편집 화면 엔진 상태를 다시 확인하지 못했습니다."
    );
  }
}

async function ensureVodRuntime(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  const environment = vodRuntimeChildEnvironment(
    context.env,
    context.paths.packageRoot
  );
  if (options.dryRun) {
    line(
      context.stdout,
      `dry-run: ${describeCommand(process.execPath, vodRuntimeArgs("status", "--json"))}`
    );
    line(
      context.stdout,
      `dry-run: 필요할 때 ${describeCommand(process.execPath, vodRuntimeArgs("start"))}`
    );
    return;
  }
  let result = readVodRuntimeStatus(
    context.env,
    context.paths.packageRoot
  );
  if (!result.ok) {
    throw new Error("VOD 미디어 엔진 상태를 읽지 못했습니다.");
  }
  if (!vodRuntimeInstalledAndCurrent(result.value)) {
    throw new Error(
      "VOD 미디어 엔진이 준비되지 않았습니다. kirinuki를 다시 실행해 자동 복구를 시도하세요."
    );
  }
  if (result.value.gateway) {
    return;
  }
  if (result.value.managerPid) {
    await runStreaming(process.execPath, vodRuntimeArgs("stop"), {
      cwd: packageRoot,
      env: environment
    });
  } else if (result.value.gatewayPortOccupied) {
    throw new Error(
      "Kirinuki 미디어 엔진의 내부 연결 주소를 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료한 뒤 다시 실행하세요."
    );
  }
  await runStreaming(process.execPath, vodRuntimeArgs("start"), {
    cwd: packageRoot,
    env: environment
  });
  result = readVodRuntimeStatus(
    context.env,
    context.paths.packageRoot
  );
  if (!result.ok || !result.value.gateway) {
    throw new Error(
      result.ok
        ? "VOD 미디어 엔진을 시작했지만 앱 연결을 검증하지 못했습니다."
        : "VOD 미디어 엔진 상태를 다시 확인하지 못했습니다."
    );
  }
}

async function ensureWhisper(
  options: LinuxHelperOptions,
  context: LinuxHelperContext,
  {
    preferredManager = null
  }: {
    preferredManager?: "foreground" | null;
  } = {}
): Promise<void> {
  if (options.dryRun) {
    line(
      context.stdout,
      `dry-run: ${describeCommand(process.execPath, captionStackArgs("status", "--json"))}`
    );
    line(
      context.stdout,
      `dry-run: 필요할 때 ${describeCommand(process.execPath, captionStackArgs("start"))}`
    );
    line(
      context.stdout,
      `dry-run: systemd-user가 없으면 ${describeCommand(process.execPath, captionStackArgs("start", "--foreground"))}`
    );
    return;
  }
  let result = readCaptionStatus(context.env);
  if (!result.ok) {
    throw new Error("Whisper 자막 엔진 상태를 읽지 못했습니다.");
  }
  let status = result.value;
  let strategy = captionStartStrategy(status);
  if (
    preferredManager === "foreground"
    && ["systemd", "foreground"].includes(strategy)
  ) {
    strategy = "foreground";
  }
  if (strategy === "setup-required") {
    throw new Error(
      "Whisper 자막 엔진이 준비되지 않았습니다. Kirinuki 앱을 완전히 닫은 뒤 다시 여세요."
    );
  }
  if (strategy === "origin-mismatch") {
    throw new Error(
      "Whisper 자막 엔진의 앱 연결 설정이 현재 버전과 다릅니다. Kirinuki 앱을 완전히 닫은 뒤 다시 여세요."
    );
  }
  if (strategy === "ready") {
    return;
  }
  const vodStatus = readVodRuntimeStatus(
    context.env,
    context.paths.packageRoot
  );
  const stoppedVodRuntime = Boolean(
    vodStatus.ok && shouldCycleVodRuntime(vodStatus.value)
  );
  if (stoppedVodRuntime) {
    line(
      context.stdout,
      "Whisper 자막 엔진을 시작하기 위해 VOD 미디어 엔진을 안전하게 교대 중지합니다."
    );
    await runStreaming(process.execPath, vodRuntimeArgs("stop"), {
      cwd: packageRoot,
      env: vodRuntimeChildEnvironment(
        context.env,
        context.paths.packageRoot
      )
    });
  }
  try {
    const foregroundExit: {
      value: {
        code: number | null;
        signal: NodeJS.Signals | null;
      } | null;
    } = { value: null };
    if (strategy === "systemd") {
      await runStreaming(
        process.execPath,
        captionStackArgs("start"),
        { env: withoutSecrets(context.env) }
      );
    } else {
      await mkdir(context.paths.stateRoot, {
        recursive: true,
        mode: 0o700
      });
      const logFd = openSync(
        context.paths.captionLogPath,
        "a",
        0o600
      );
      try {
        const child = spawn(
          process.execPath,
          captionStackArgs("start", "--foreground"),
          {
            cwd: packageRoot,
            env: withoutSecrets(context.env),
            detached: true,
            stdio: ["ignore", logFd, logFd]
          }
        );
        child.once("exit", (code, signal) => {
          foregroundExit.value = { code, signal };
        });
        await new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("spawn", resolve);
        });
        child.unref();
      } finally {
        closeSync(logFd);
      }
    }

    const deadline = Date.now() + 4 * 60_000;
    while (Date.now() < deadline) {
      await delay(500);
      if (foregroundExit.value) {
        throw new Error(
          `로컬 Whisper foreground가 준비 전에 종료했습니다 (${foregroundExit.value.code ?? foregroundExit.value.signal}). 로그: ${context.paths.captionLogPath}`
        );
      }
      result = readCaptionStatus(context.env);
      if (
        result.ok
        && result.value?.endpoints?.stt
        && result.value?.endpoints?.gateway
      ) {
        return;
      }
    }
    throw new Error(
      `로컬 Whisper가 4분 안에 준비되지 않았습니다. 로그: ${context.paths.captionLogPath}`
    );
  } catch (error) {
    if (!stoppedVodRuntime) {
      throw error;
    }
    try {
      await runStreaming(process.execPath, vodRuntimeArgs("start"), {
        cwd: packageRoot,
        env: vodRuntimeChildEnvironment(
          context.env,
          context.paths.packageRoot
        )
      });
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Whisper 시작에 실패했고 이전 VOD runtime 복원도 실패했습니다."
      );
    }
    throw error;
  }
}

async function superviseExistingBrowser(
  initialMain: DedicatedBrowserProcessSnapshot,
  browser: BrowserReport,
  context: LinuxHelperContext,
  initialSignal: NodeJS.Signals | null = null,
  {
    currentExpectedMain = () => initialMain,
    beginClosing = async () => {},
    settleObservedStop = async () => null,
    reconcileUnexpectedRuntime = async () => "unresolved" as const
  }: {
    currentExpectedMain?: () => DedicatedBrowserProcessSnapshot;
    beginClosing?: () => Promise<void>;
    settleObservedStop?: (
      signal: NodeJS.Signals | null
    ) => Promise<DedicatedBrowserProcessSnapshot | null>;
    reconcileUnexpectedRuntime?: (
      signal: NodeJS.Signals | null
    ) => Promise<"continue" | "stopped" | "unresolved">;
  } = {}
): Promise<void> {
  let receivedSignal: NodeJS.Signals | null = initialSignal;
  let signalForwardedTo: DedicatedBrowserProcessSnapshot | null = null;
  const onSigint = () => {
    if (!receivedSignal) {
      receivedSignal = "SIGINT";
      void beginClosing().catch(() => {});
    }
  };
  const onSigterm = () => {
    if (!receivedSignal) {
      receivedSignal = "SIGTERM";
      void beginClosing().catch(() => {});
    }
  };
  if (receivedSignal) {
    void beginClosing().catch(() => {});
  }
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    while (true) {
      const current = await inspectDedicatedBrowserRuntimeDetailed({
        profileRoot: context.paths.browserProfileRoot,
        streamingCompanionRoot: context.paths.streamingCompanionRoot,
        legacyExtensionRoot: context.paths.legacyExtensionRoot,
        product: browser.product,
        studioOrigin: context.studioOrigin
      });
      if (current.report.state === "stopped") {
        const replacement = await settleObservedStop(receivedSignal);
        if (replacement) {
          signalForwardedTo = null;
          continue;
        }
        if (receivedSignal) {
          context.setExitCode(receivedSignal === "SIGINT" ? 130 : 143);
        }
        return;
      }
      const expectedMain = currentExpectedMain();
      if (
        current.report.state !== "ready"
        || !current.main
        || !sameProcessIdentity(expectedMain, current.main)
      ) {
        const reconciliation = await reconcileUnexpectedRuntime(
          receivedSignal
        );
        if (reconciliation === "continue") {
          signalForwardedTo = null;
          continue;
        }
        if (receivedSignal) {
          context.setExitCode(receivedSignal === "SIGINT" ? 130 : 143);
        }
        if (reconciliation === "stopped") {
          return;
        }
        throw new Error(
          "감독 중인 Kirinuki 전용 브라우저의 실행 identity가 바뀌어 내부 엔진을 자동 중지하지 않습니다."
        );
      }
      if (
        receivedSignal
        && (
          !signalForwardedTo
          || !sameProcessIdentity(signalForwardedTo, current.main)
        )
      ) {
        signalForwardedTo = current.main;
        try {
          process.kill(current.main.pid, "SIGTERM");
        } catch (error) {
          if (errnoCode(error) !== "ESRCH") {
            throw new Error(
              "감독 중인 Kirinuki 전용 브라우저에 정상 종료를 요청하지 못했습니다.",
              { cause: error }
            );
          }
        }
      }
      await delay(200);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

async function launchBrowser(
  browser: BrowserReport,
  args: readonly string[],
  initialState: DedicatedBrowserRuntimeState,
  options: LinuxHelperOptions,
  context: LinuxHelperContext,
  ensureEngines: () => Promise<void>
): Promise<void> {
  if (options.dryRun) {
    line(context.stdout, "dry-run: Kirinuki 전용 브라우저를 열 예정");
    return;
  }
  if (!browser.binary) {
    throw new Error("Chromium 실행 파일 경로를 확인하지 못했습니다.");
  }
  if (!browserLaunchCanOwnLifecycle(initialState)) {
    throw new Error(
      `Kirinuki 앱 생명주기를 시작할 수 없는 브라우저 상태입니다: ${initialState}`
    );
  }
  let lifecycleClaim: AppLifecycleClaim | null = null;
  let takeoverMain: DedicatedBrowserProcessSnapshot | null = null;
  const requestId = createAppLifecycleRequestId();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const candidate = await claimAppLifecycle(
      context.paths.browserProfileRoot,
      context.paths.stateRoot
    );
    if (candidate.owned) {
      const current = await inspectDedicatedBrowserRuntimeDetailed({
        profileRoot: context.paths.browserProfileRoot,
        streamingCompanionRoot: context.paths.streamingCompanionRoot,
        legacyExtensionRoot: context.paths.legacyExtensionRoot,
        product: browser.product,
        studioOrigin: context.studioOrigin
      });
      if (current.report.state === "ready" && current.main) {
        takeoverMain = current.main;
      } else if (current.report.state !== "stopped") {
        await candidate.release();
        throw new Error(
          `Kirinuki 앱 생명주기를 인계하는 동안 브라우저 상태가 바뀌었습니다: ${current.report.reason}`
        );
      }
      lifecycleClaim = candidate;
      break;
    }
    let delivered: AppLifecycleOpenResult;
    try {
      delivered = await candidate.requestOpen(options.url, requestId);
    } finally {
      await candidate.release();
    }
    if (delivered.status === "opened") {
      return;
    }
    if (delivered.status === "failed") {
      throw new Error(
        "실행 중인 Kirinuki 앱이 새 편집 창을 준비하지 못했습니다. 잠시 뒤 다시 실행하세요."
      );
    }
    await delay(100);
  }
  if (!lifecycleClaim) {
    throw new Error(
      "다른 Kirinuki 실행의 종료·열기 전환이 15초 안에 완료되지 않았습니다. 잠시 뒤 다시 실행하세요."
    );
  }
  let cleanupAllowed = !takeoverMain;
  const cleanup = createIdempotentAsyncAction(async () => {
    await stopAppEngines(
      { ...options, dryRun: false },
      context,
      { announce: false }
    );
  });
  let supervisedMain = takeoverMain;
  try {
    await mkdir(context.paths.browserProfileRoot, {
      recursive: true,
      mode: 0o700
    });
    await mkdir(context.paths.stateRoot, {
      recursive: true,
      mode: 0o700
    });
    const inspectRuntime = () => inspectDedicatedBrowserRuntimeDetailed({
      profileRoot: context.paths.browserProfileRoot,
      streamingCompanionRoot: context.paths.streamingCompanionRoot,
      legacyExtensionRoot: context.paths.legacyExtensionRoot,
      product: browser.product,
      studioOrigin: context.studioOrigin
    });
    const requireExpectedRuntime = async () => {
      const expected = supervisedMain;
      const current = await inspectRuntime();
      if (
        !expected
        || current.report.state !== "ready"
        || !current.main
        || !sameProcessIdentity(expected, current.main)
      ) {
        throw new AppLifecycleRetryError(
          "Kirinuki 브라우저가 닫히는 중이어서 새 창 요청을 다음 owner가 다시 처리해야 합니다."
        );
      }
      return current.main;
    };
    const logFd = openSync(context.paths.browserLogPath, "a", 0o600);
    try {
      const spawnDetachedOpen = async (sourceUrl: string | null) => {
        await requireExpectedRuntime();
        // An accepted request is part of the lifecycle queue. Engines are
        // rechecked by the owner immediately before every browser open, so a
        // previous owner can never stop engines between a secondary check and
        // the actual open.
        await ensureEngines();
        await requireExpectedRuntime();
        const requestArgs = browserLaunchArgs({
          profileRoot: context.paths.browserProfileRoot,
          streamingCompanionRoot: context.paths.streamingCompanionRoot,
          sourceUrl,
          studioOrigin: context.studioOrigin
        });
        const opener = spawn(browser.binary!, requestArgs, {
          cwd: packageRoot,
          env: withoutSecrets(context.env),
          detached: true,
          stdio: ["ignore", logFd, logFd]
        });
        await new Promise<void>((resolve, reject) => {
          opener.once("error", reject);
          opener.once("spawn", resolve);
        });
        opener.unref();
        const afterOpen = await inspectBrowserRuntimeAfterLauncherExit(
          browser,
          context,
          1_000
        );
        if (afterOpen.report.state !== "ready" || !afterOpen.main) {
          throw new AppLifecycleRetryError(
            "새 편집 창을 전달하는 동안 Kirinuki 브라우저가 닫혔습니다."
          );
        }
        supervisedMain = afterOpen.main;
      };
      const activateOpenRequests = () => {
        lifecycleClaim.activateOpenRequests(spawnDetachedOpen);
      };
      const settleObservedStop = async (
        signal: NodeJS.Signals | null
      ): Promise<DedicatedBrowserProcessSnapshot | null> => {
        // closing is published synchronously before waiting. Requests already
        // accepted by the owner finish first; later launchers receive
        // `closing` and retry/take over only after cleanup and socket release.
        await lifecycleClaim.beginClosing();
        const afterDrain = await inspectRuntime();
        if (afterDrain.report.state === "stopped") {
          cleanupAllowed = true;
          return null;
        }
        if (afterDrain.report.state === "ready" && afterDrain.main) {
          supervisedMain = afterDrain.main;
          cleanupAllowed = false;
          if (!signal) {
            await lifecycleClaim.resumeOpenRequests();
          }
          return afterDrain.main;
        }
        cleanupAllowed = false;
        throw new Error(
          `종료 drain 뒤 Kirinuki 브라우저 identity를 검증하지 못해 내부 엔진을 자동 중지하지 않습니다: ${afterDrain.report.reason}`
        );
      };
      const reconcileUnexpectedRuntime = async (
        signal: NodeJS.Signals | null
      ): Promise<"continue" | "stopped"> => {
        await lifecycleClaim.beginClosing();
        const afterDrain = await inspectRuntime();
        if (afterDrain.report.state === "stopped") {
          cleanupAllowed = true;
          return "stopped";
        }
        if (
          afterDrain.report.state === "ready"
          && afterDrain.main
          && supervisedMain
          && sameProcessIdentity(supervisedMain, afterDrain.main)
        ) {
          cleanupAllowed = false;
          if (!signal) {
            await lifecycleClaim.resumeOpenRequests();
          }
          return "continue";
        }
        cleanupAllowed = false;
        throw new Error(
          `open 요청 drain 뒤 감독 브라우저 identity를 재결합하지 못해 내부 엔진을 자동 중지하지 않습니다: ${afterDrain.report.reason}`
        );
      };

      if (takeoverMain) {
        await requireExpectedRuntime();
        await ensureEngines();
        await requireExpectedRuntime();
        const child = spawn(browser.binary, args, {
          cwd: packageRoot,
          env: withoutSecrets(context.env),
          detached: true,
          stdio: ["ignore", logFd, logFd]
        });
        await new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("spawn", resolve);
        });
        child.unref();
        const afterOpen = await inspectBrowserRuntimeAfterLauncherExit(
          browser,
          context,
          1_000
        );
        if (afterOpen.report.state !== "ready" || !afterOpen.main) {
          throw new Error(
            "인계한 Kirinuki 브라우저에 새 편집 창을 전달하지 못했습니다."
          );
        }
        supervisedMain = afterOpen.main;
        activateOpenRequests();
        await superviseExistingBrowser(
          supervisedMain,
          browser,
          context,
          null,
          {
            currentExpectedMain: () => supervisedMain!,
            beginClosing: lifecycleClaim.beginClosing,
            settleObservedStop,
            reconcileUnexpectedRuntime
          }
        );
        return;
      }

      const beforeEngineCheck = await inspectRuntime();
      if (beforeEngineCheck.report.state !== "stopped") {
        cleanupAllowed = false;
        throw new Error(
          `Chromium 실행 준비 중 전용 profile 상태가 바뀌었습니다: ${beforeEngineCheck.report.reason}`
        );
      }
      await ensureEngines();
      const immediatelyBeforeLaunch = await inspectRuntime();
      if (immediatelyBeforeLaunch.report.state !== "stopped") {
        cleanupAllowed = false;
        throw new Error(
          `Chromium 실행 직전 전용 profile 상태가 바뀌었습니다: ${immediatelyBeforeLaunch.report.reason}`
        );
      }
      const launchFloor = await readBrowserLauncherProcessIdentity(process.pid);
      if (!launchFloor) {
        throw new Error(
          "Chromium 실행 직전 Kirinuki 앱의 process identity를 확인하지 못했습니다."
        );
      }
      const child = spawn(browser.binary, args, {
        cwd: packageRoot,
        env: withoutSecrets(context.env),
        detached: false,
        stdio: ["ignore", logFd, logFd]
      });
      if (!launchFloor || !child.pid) {
        throw new Error("Chromium launcher의 PID identity를 만들지 못했습니다.");
      }
      // From this point a browser may outlive the launcher. Cleanup becomes
      // safe again only after /proc proves the app root stopped.
      cleanupAllowed = false;
      const childExit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const launcherIdentity = (
        await readBrowserLauncherProcessIdentity(child.pid)
      ) ?? {
        pid: child.pid,
        ownerUid: launchFloor.ownerUid,
        startTimeTicks: launchFloor.startTimeTicks
      };

      let receivedSignal: NodeJS.Signals | null = null;
      const forwardSignal = (signal: NodeJS.Signals) => {
        if (receivedSignal) {
          return;
        }
        receivedSignal = signal;
        void lifecycleClaim.beginClosing().catch(() => {});
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        try {
          if (!child.pid) {
            throw new Error("브라우저 PID 없음");
          }
          process.kill(child.pid, "SIGTERM");
        } catch (error) {
          if (errnoCode(error) !== "ESRCH") {
            line(
              context.stderr,
              "Kirinuki 전용 브라우저에 정상 종료를 요청하지 못했습니다."
            );
          }
        }
      };
      const onSigint = () => forwardSignal("SIGINT");
      const onSigterm = () => forwardSignal("SIGTERM");
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);
      let result: {
        code: number | null;
        signal: NodeJS.Signals | null;
      } | null = null;
      try {
        const initialRuntime = await inspectBrowserRuntimeAfterLauncherExit(
          browser,
          context
        );
        if (initialRuntime.report.state === "ready" && initialRuntime.main) {
          supervisedMain = initialRuntime.main;
          cleanupAllowed = false;
          activateOpenRequests();
        } else if (initialRuntime.report.state !== "stopped") {
          cleanupAllowed = false;
          throw new Error(
            `Chromium 실행 뒤 앱 브라우저 identity를 검증하지 못했습니다: ${initialRuntime.report.reason}`
          );
        }
        result = await childExit;
      } finally {
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
      }
      await lifecycleClaim.beginClosing();
      const afterLauncherExit = await inspectBrowserRuntimeAfterLauncherExit(
        browser,
        context
      );
      if (afterLauncherExit.report.state !== "stopped") {
        // A profile process is still present. Until its exact immutable
        // identity is proven, shutting down engines would strand a live app.
        cleanupAllowed = false;
        const root = selectVerifiedBrowserRootAfterLauncherExit(
          afterLauncherExit.processes,
          {
            profileRoot: context.paths.browserProfileRoot,
            streamingCompanionRoot: context.paths.streamingCompanionRoot,
            legacyExtensionRoot: context.paths.legacyExtensionRoot,
            product: browser.product,
            expectedUid: launchFloor.ownerUid,
            studioOrigin: context.studioOrigin
          },
          launcherIdentity
        );
        if (!root) {
          throw new Error(
            "Chromium launcher 종료 뒤 앱 브라우저 root가 사라졌습니다."
          );
        }
        supervisedMain = root;
        if (!receivedSignal) {
          await lifecycleClaim.resumeOpenRequests();
        }
        await superviseExistingBrowser(
          root,
          browser,
          context,
          receivedSignal,
          {
            currentExpectedMain: () => supervisedMain!,
            beginClosing: lifecycleClaim.beginClosing,
            settleObservedStop,
            reconcileUnexpectedRuntime
          }
        );
        return;
      }
      cleanupAllowed = true;
      if (receivedSignal) {
        context.setExitCode(receivedSignal === "SIGINT" ? 130 : 143);
        return;
      }
      if (!result || result.code !== 0) {
        throw new Error(
          result?.signal
            ? `Kirinuki 전용 브라우저가 ${result.signal} 신호로 종료됐습니다.`
            : `Kirinuki 전용 브라우저가 종료 코드 ${result?.code ?? "알 수 없음"}로 종료됐습니다.`
        );
      }
    } finally {
      closeSync(logFd);
    }
  } finally {
    try {
      if (cleanupAllowed) {
        await lifecycleClaim.beginClosing();
        await cleanup();
      }
    } finally {
      await lifecycleClaim.release();
    }
  }
}

async function inspectAppBootstrapState(
  mode: CaptionMode,
  context: LinuxHelperContext
): Promise<AppBootstrapState> {
  const [settings, build, entrypoints] = await Promise.all([
    readSettings(context.paths),
    inspectBuild(packageRoot, KIRINUKI_LOCAL_STUDIO_ORIGIN),
    inspectUserEntrypoints(context.paths)
  ]);
  const vod = readVodRuntimeStatus(
    context.env,
    context.paths.packageRoot
  );
  const caption = mode === "whisper"
    ? readCaptionStatus(context.env)
    : null;
  return {
    configured: Boolean(settings),
    buildCurrent: build.ready,
    entrypointsCurrent: entrypoints.current,
    mediaEngineCurrent: Boolean(
      vod.ok && vodRuntimeInstalledAndCurrent(vod.value)
    ),
    captionEngineCurrent: mode !== "whisper" || Boolean(
      caption?.ok
      && caption.value.configured
      && captionOriginMatchesCurrentStudio(caption.value)
    )
  };
}

async function openCommand(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  const settings = await readSettings(context.paths);
  const mode = options.mode || settings?.mode || "audseg";
  const browser = inspectPreferredBrowser({
    explicit: options.browser,
    stored: settings?.browser ?? null,
    env: context.env
  });
  if (!browser.available) {
    throw new Error(
      "Chromium 계열 브라우저를 찾지 못했습니다.\n"
      + dependencyGuidance(mode).join("\n")
    );
  }
  if (!browser.binary) {
    throw new Error("Chromium 실행 파일 경로를 확인하지 못했습니다.");
  }
  if (!browser.supported) {
    throw new Error(
      `Chromium 계열 브라우저 ${MINIMUM_BROWSER_VERSION} 이상이 필요합니다. 현재: ${browser.version || "알 수 없음"}`
    );
  }
  let bootstrapState = await inspectAppBootstrapState(mode, context);
  const bootstrapReasons = appBootstrapReasons(bootstrapState);
  const bootstrapSimulated = options.dryRun && bootstrapReasons.length > 0;
  if (bootstrapReasons.length > 0) {
    line(
      context.stdout,
      "Kirinuki 앱을 처음 실행하거나 구성 갱신이 필요해 자동으로 준비합니다."
    );
    await setupCommand({
      ...options,
      mode,
      yes: true
    }, context);
    if (!options.dryRun) {
      bootstrapState = await inspectAppBootstrapState(mode, context);
      const remaining = appBootstrapReasons(bootstrapState);
      if (remaining.length > 0) {
        throw new Error(
          `Kirinuki 앱 자동 준비를 검증하지 못했습니다: ${remaining.join(", ")}`
        );
      }
    }
  }
  const entrypoints = await inspectUserEntrypoints(context.paths);
  const staleEntrypoints = [
    { label: "사용자 명령", entry: entrypoints.launcher },
    { label: "앱 메뉴", entry: entrypoints.desktop }
  ].filter(({ entry }) => entry.installed && !entry.current);
  if (!bootstrapSimulated && staleEntrypoints.length > 0) {
    throw new Error(
      "사용자 진입점이 현재 저장소·브라우저 profile 경로와 다릅니다.\n"
      + staleEntrypoints
        .map(({ label, entry }) => (
          `${label} → ${entry.actualTarget || "대상 판독 불가"}`
        ))
        .join("\n")
      + "\nKirinuki 앱을 완전히 닫은 뒤 다시 열어 자동 복구를 시도하세요."
    );
  }
  if (!bootstrapSimulated && entrypoints.legacyDesktop.recognized) {
    throw new Error(
      "HTTP/HTTPS/text-html 기본 앱을 가로채는 인식된 레거시 Kirinuki 앱 메뉴가 남아 있습니다.\n"
      + `${entrypoints.legacyDesktop.path}\n`
      + "Kirinuki 앱을 완전히 닫은 뒤 다시 열어 안전한 자동 전환을 시도하세요."
    );
  }
  if (
    !bootstrapSimulated
    &&
    entrypoints.legacyDesktop.present
    && (
      entrypoints.legacyDesktop.actualTarget?.startsWith("검사 실패:")
      || entrypoints.legacyDesktop.actualTarget?.startsWith("읽기 실패:")
    )
  ) {
    throw new Error(
      `레거시 Kirinuki 앱 메뉴를 안전하게 검사하지 못했습니다: ${entrypoints.legacyDesktop.path} · ${entrypoints.legacyDesktop.actualTarget}`
    );
  }
  const build = await inspectBuild(packageRoot, context.studioOrigin);
  if (!build.ready && !bootstrapSimulated) {
    throw new Error(
      `Kirinuki 편집 화면을 준비하지 못했습니다: ${packageRoot}\n`
      + "kirinuki를 다시 실행해 자동 복구를 시도하세요."
    );
  }
  const ensureEngines = async () => {
    if (mode === "whisper") {
      await ensureWhisper(options, context);
    } else {
      await ensureVodRuntime(options, context);
    }
    await ensureStudioServer(options, context);
  };
  if (options.dryRun) {
    await ensureEngines();
  }
  const browserRuntime = await prepareDedicatedBrowserRuntime(
    browser,
    options,
    context
  );
  const sourceUrl = options.url;
  const args = browserLaunchArgs({
    profileRoot: context.paths.browserProfileRoot,
    streamingCompanionRoot: context.paths.streamingCompanionRoot,
    sourceUrl,
    studioOrigin: context.studioOrigin
  });
  if (!options.dryRun) {
    await writeSettings(context.paths, {
      mode,
      browser: browser.binary
    });
  }
  line(context.stdout, options.dryRun
    ? "dry-run: Kirinuki 앱을 전용 브라우저 프로필로 열 예정"
    : "Kirinuki 앱을 엽니다.");
  if (options.dryRun && browserRuntime.state === "ready") {
    line(
      context.stdout,
      `dry-run: 실행 중인 Kirinuki 전용 브라우저 PID ${browserRuntime.mainPid}에 새 탭으로 전달`
    );
  }
  if (sourceUrl) {
    line(
      context.stdout,
      `편집할 원본 URL을 시작 화면에 전달했습니다: ${sourceUrl}`
    );
  }
  line(
    context.stdout,
    "시작 화면에서 원본 URL과 편집 구간을 입력하세요."
  );
  await launchBrowser(
    browser,
    args,
    browserRuntime.state,
    options,
    context,
    ensureEngines
  );
}

async function doctorCommand(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  const settings = await readSettings(context.paths);
  const mode = options.mode || settings?.mode || "audseg";
  const browser = inspectPreferredBrowser({
    explicit: options.browser,
    stored: settings?.browser ?? null,
    env: context.env
  });
  const report = await inspectLinuxEnvironment({
    mode,
    browser: browser.binary || options.browser || settings?.browser || null,
    env: context.env,
    platform: context.platform,
    paths: context.paths
  });
  if (options.json) {
    line(
      context.stdout,
      JSON.stringify(environmentReportJson(report), null, 2)
    );
  } else {
    printDoctor(report, context.stdout);
    if (!report.ready) {
      for (const guidance of dependencyGuidance(mode)) {
        line(context.stdout, guidance);
      }
    }
  }
  if (!report.ready) {
    context.setExitCode(1);
  }
}

async function statusCommand(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  const settings = await readSettings(context.paths);
  const mode = options.mode || settings?.mode || "audseg";
  const browser = inspectPreferredBrowser({
    stored: settings?.browser ?? null,
    env: context.env
  });
  const profileInfo = await stat(context.paths.browserProfileRoot)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  const caption: CaptionStatusResult = mode === "whisper"
    ? readCaptionStatus(context.env)
    : {
      ok: true as const,
      value: {
        required: false,
        message: "AudSeg는 백그라운드 서비스가 필요 없습니다."
      }
    };
  const vod = readVodRuntimeStatus(
    context.env,
    context.paths.packageRoot
  );
  const studioServer = readStudioServerStatus(context.env);
  const studioBuild = await inspectBuild(packageRoot, context.studioOrigin);
  const browserRuntime = await inspectDedicatedBrowserRuntime({
    profileRoot: context.paths.browserProfileRoot,
    streamingCompanionRoot: context.paths.streamingCompanionRoot,
    legacyExtensionRoot: context.paths.legacyExtensionRoot,
    product: browser.product,
    studioOrigin: context.studioOrigin
  });
  const value = {
    schema: HELPER_SCHEMA,
    configured: Boolean(settings),
    mode,
    studioOrigin: context.studioOrigin,
    studioUrl: studioUrlForOrigin(context.studioOrigin),
    studioBuild: {
      root: packageRoot,
      ready: studioBuild.ready
    },
    browserProfile: {
      path: context.paths.browserProfileRoot,
      created: profileInfo,
      running: browserRuntime.state,
      runtime: browserRuntime
    },
    entrypoints: await inspectUserEntrypoints(context.paths),
    caption,
    vod,
    studioServer
  };
  if (options.json) {
    line(context.stdout, JSON.stringify({
      schema: APP_STATUS_SCHEMA,
      configured: Boolean(settings),
      mode,
      app: {
        buildCurrent: studioBuild.ready,
        entrypointsCurrent: value.entrypoints.current,
        browserProfileCreated: profileInfo,
        browser: {
          state: browserRuntime.state,
          running: browserRuntime.profileProcessCount > 0,
          transitionRequired: browserRuntime.transitionRequired,
          reason: browserRuntime.reason
        }
      },
      engines: {
        editor: editorEngineStatusView(studioServer),
        media: mediaEngineStatusView(vod),
        captions: captionEngineStatusView(mode, caption)
      }
    }, null, 2));
    if (
      (mode === "whisper" && !caption.ok)
      || !vod.ok
      || !studioServer.ok
      || !studioBuild.ready
      || (
        vod.ok
        && Boolean(vod.value.configured)
        && !Boolean(
          vod.value.origin?.matchesCurrentStudio
          ?? vod.value.origin?.matchesLocalStudio
        )
      )
      || (
        mode === "whisper"
        && caption.ok
        && !captionOriginMatchesCurrentStudio(caption.value)
      )
      || (
        studioServer.ok
        && studioServer.value.ready
        && !studioServerMatchesOrigin(
          studioServer.value,
          context.studioOrigin
        )
      )
      || [
        "clean",
        "update-required",
        "conflict",
        "unavailable"
      ].includes(browserRuntime.state)
    ) {
      context.setExitCode(1);
    }
    return;
  }
  line(
    context.stdout,
    `Kirinuki 앱 설정: ${settings ? "있음" : "없음"} · 자막 방식=${mode}`
  );
  if (!studioBuild.ready) {
    context.setExitCode(1);
  }
  line(
    context.stdout,
    `전용 브라우저 프로필: ${profileInfo ? "생성됨" : "아직 없음"} · ${context.paths.browserProfileRoot}`
  );
  line(
    context.stdout,
    `전용 브라우저: ${browserRuntime.state}`
    + (browserRuntime.mainPid ? ` · PID ${browserRuntime.mainPid}` : "")
    + ` · processes=${browserRuntime.profileProcessCount}`
    + ` · ${browserRuntime.reason}`
  );
  line(
    context.stdout,
    `편집 화면: ${studioBuild.ready ? "준비됨" : "앱 준비 필요"}`
    + ` · ${packageRoot}`
  );
  line(
    context.stdout,
    `kirinuki 명령: ${
      value.entrypoints.launcher.current
        ? "현재 버전"
        : value.entrypoints.launcher.installed
          ? `stale → ${value.entrypoints.launcher.actualTarget || "대상 판독 불가"}`
          : "미설치"
    } · ${value.entrypoints.launcher.path}`
  );
  line(
    context.stdout,
    `앱 메뉴: ${
      value.entrypoints.desktop.current
        ? "현재 버전"
        : value.entrypoints.desktop.installed
          ? `stale → ${value.entrypoints.desktop.actualTarget || "대상 판독 불가"}`
          : "미설치"
    }`
  );
  if (value.entrypoints.legacyDesktop.present) {
    line(
      context.stdout,
      value.entrypoints.legacyDesktop.recognized
        ? `이전 앱 메뉴: 활성 · ${value.entrypoints.legacyDesktop.path} · 앱 완전 종료 후 다시 열기`
        : `레거시 이름의 앱 메뉴: 서명이 다르거나 검사 불가하여 자동 변경하지 않음 · ${value.entrypoints.legacyDesktop.path} · ${value.entrypoints.legacyDesktop.actualTarget || "대상 판독 불가"}`
    );
  }
  if (browserRuntime.state === "legacy-extension") {
    line(
      context.stdout,
      "다음 kirinuki 실행은 정확히 확인된 이전 버전 프로세스만 정상 종료한 뒤 같은 프로필로 현재 앱을 엽니다."
    );
  } else if (browserRuntime.state === "clean") {
    line(
      context.stdout,
      "실행 중인 clean 전용 Chromium은 자동 종료하지 않습니다. 창을 정상 종료한 뒤 kirinuki를 다시 실행하세요."
    );
    context.setExitCode(1);
  } else if (browserRuntime.state === "update-required") {
    line(
      context.stdout,
      "전용 브라우저 연결부가 현재 앱 버전과 다릅니다. 프로세스를 자동 종료하지 않으므로 창을 정상 종료한 뒤 kirinuki를 다시 실행하세요."
    );
    context.setExitCode(1);
  } else if (["conflict", "unavailable"].includes(browserRuntime.state)) {
    line(
      context.stdout,
      "브라우저 identity가 안전 경계를 통과하지 못했습니다. 자동 종료하지 않습니다."
    );
    context.setExitCode(1);
  }
  if (mode === "whisper") {
    if (!caption.ok) {
      line(context.stdout, "Whisper 자막 엔진 상태를 읽지 못했습니다.");
      context.setExitCode(1);
      return;
    }
    const status = caption.value;
    line(
      context.stdout,
      `Whisper: configured=${Boolean(status.configured)}`
      + ` · origin=${captionOriginMatchesCurrentStudio(status) ? "OK" : "불일치"}`
      + ` · STT=${status.endpoints?.stt ? "ready" : "down"}`
      + ` · 앱 연결=${status.endpoints?.gateway ? "ready" : "down"}`
    );
    if (!captionOriginMatchesCurrentStudio(status)) {
      context.setExitCode(1);
    }
  } else {
    line(
      context.stdout,
      caption.ok
        ? caption.value.message || "AudSeg 자막 처리는 브라우저에서 실행됩니다."
        : "AudSeg 상태를 읽지 못했습니다."
    );
  }
  if (!vod.ok) {
    line(context.stdout, "VOD 미디어 엔진 상태를 읽지 못했습니다.");
    context.setExitCode(1);
    return;
  }
  line(
    context.stdout,
    `VOD 미디어 엔진: ${
      vodRuntimeInstalledAndCurrent(vod.value) ? "설치·도구 검증됨" : "앱 완전 종료 후 다시 열기"
    }`
    + ` · yt-dlp=${vod.value.ytDlp?.version || "-"}`
    + ` · 앱 연결=${vod.value.gateway ? "ready" : vod.value.gatewayPortOccupied ? "다른 프로그램과 충돌" : "down"}`
    + ` · managed=${vod.value.managed ? `PID ${vod.value.managerPid || "?"}` : "no"}`
  );
  if (
    vod.value.configured
    && !Boolean(
      vod.value.origin?.matchesCurrentStudio
      ?? vod.value.origin?.matchesLocalStudio
    )
  ) {
    context.setExitCode(1);
  }
  if (!studioServer.ok) {
    line(context.stdout, "편집 화면 엔진 상태를 읽지 못했습니다.");
    context.setExitCode(1);
    return;
  }
  line(
    context.stdout,
    `편집 화면 엔진: ${studioServer.value.ready ? "ready" : studioServer.value.ownership || "down"}`
    + ` · managed=${studioServer.value.managerPid ? `PID ${studioServer.value.managerPid}` : "no"}`
  );
  if (
    studioServer.value.ready
    && !studioServerMatchesOrigin(studioServer.value, context.studioOrigin)
  ) {
    context.setExitCode(1);
  }
}

async function stopAppEngines(
  options: LinuxHelperOptions,
  context: LinuxHelperContext,
  {
    announce = true
  }: {
    announce?: boolean;
  } = {}
): Promise<void> {
  const commands: Array<{
    file: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }> = [
    {
      file: process.execPath,
      args: studioServerArgs("stop"),
      env: withoutSecrets(context.env)
    },
    {
      file: process.execPath,
      args: vodRuntimeArgs("stop"),
      env: vodRuntimeChildEnvironment(
        context.env,
        context.paths.packageRoot
      )
    },
    {
      file: process.execPath,
      args: captionStackArgs("stop"),
      env: withoutSecrets(context.env)
    }
  ];
  if (options.dryRun) {
    for (const command of commands) {
      line(
        context.stdout,
        `dry-run: ${describeCommand(command.file, command.args)}`
      );
    }
    return;
  }
  const errors: unknown[] = [];
  for (const command of commands) {
    try {
      await runStreaming(command.file, command.args, {
        cwd: packageRoot,
        env: command.env
      });
    } catch (error) {
      errors.push(error);
    }
  }
  if (announce) {
    line(
      context.stdout,
      "브라우저 창과 저장된 편집은 유지하고 Kirinuki 앱 엔진을 모두 중지했습니다."
    );
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "일부 Kirinuki 앱 엔진을 안전하게 중지하지 못했습니다. 검증되지 않은 프로세스는 종료하지 않았습니다."
    );
  }
}

async function stopCommand(
  options: LinuxHelperOptions,
  context: LinuxHelperContext
): Promise<void> {
  await stopAppEngines(options, context);
}

export function helpText(): string {
  return `
Kirinuki 앱 (Linux)

사용법:
  ./setup.sh [--mode audseg|whisper]
  ./kirinuki.sh
  ./kirinuki.sh setup [--mode audseg|whisper] [--profile draft|auto|light|quality] [--backend auto|cpu|cuda] [--browser PATH] [--yes] [--dry-run]
  ./kirinuki.sh doctor [--mode audseg|whisper] [--browser PATH] [--json]
  ./kirinuki.sh open [--mode audseg|whisper] [--browser PATH] [--dry-run] [영상 URL]
  ./kirinuki.sh start [--mode audseg|whisper] [--browser PATH] [--dry-run] [영상 URL]
  ./kirinuki.sh status [--mode audseg|whisper] [--json]
  ./kirinuki.sh stop [--mode audseg|whisper] [--dry-run]

일반 사용:
  인자 없이 실행하면 필요한 준비를 자동으로 끝낸 뒤 앱을 엽니다.

관리자·개발자 진단 명령:
  setup   앱 구성·편집 화면·미디어 엔진·선택한 자막 방식을 다시 준비
  doctor  Linux·Node·npm·브라우저·빌드·선택 자막 방식 상태를 읽기 전용 점검
  open    Kirinuki 앱 열기; 영상 URL은 시작 화면에 전달
  start   open과 동일하며 기존 사용자에게 익숙한 별칭
  status  편집 화면·전용 브라우저·미디어·선택적 Whisper 엔진 상태 표시
  stop    Kirinuki가 소유한 모든 앱 엔진을 안전하게 중지; 브라우저는 강제 종료하지 않음

앱 실행:
  bare kirinuki와 앱 메뉴는 Kirinuki를 즉시 엽니다. 최초 실행이나 버전 갱신 뒤에는
  필요한 앱 구성을 묻지 않고 자동으로 준비하고, 완료된 뒤 같은 실행을 계속합니다.
  setup은 ~/.local/bin/kirinuki 명령과 앱 메뉴를 원자적으로 설치·갱신합니다.
  Kirinuki 소유로 확인할 수 없는 파일·symlink·읽기 불가 경로는 덮어쓰지 않습니다.

앱 링크:
  ${KIRINUKI_DEEP_LINK}
  ${KIRINUKI_DEEP_LINK}?source=<URLSearchParams로 인코딩한 지원 영상 URL>
  source 하나 외의 값, 중복 값, 계정 정보, 추가 네트워크 끝점, fragment는 거부합니다.
  Kirinuki 전용 scheme만 등록하며 HTTP·HTTPS 기본 앱 연결은 변경하지 않습니다.

브라우저 프로필 보존:
  KIRINUKI_BROWSER_PROFILE_ROOT에 앞뒤 공백 없는 절대경로를 지정하면
  기존 Kirinuki 전용 프로필을 명시적으로 유지합니다. 편집 화면과 미디어 엔진은
  기기 내부에서만 연결되며 Kirinuki 앱이 시작·검증·중지를 함께 소유합니다.

자막 방식:
  audseg   기본값. 자막과 VOD 구간을 Kirinuki 앱 안에서 준비
  whisper  고정·검증된 로컬 Whisper Tiny로 한국어 글과 타이밍 생성

시스템 요구사항:
  기본: Linux, Node.js 22.17.0+, npm, Chromium 120+, Python 3.11+, FFmpeg, ffprobe
  Whisper 선택 시 추가: CMake, tar, C++ 컴파일러(g++ 또는 clang++)

지원 URL:
  CHZZK·YouTube·SOOP의 단일 공개 완료 VOD HTTPS 주소

안전:
  시스템 패키지를 자동 설치하지 않고, API 키를 받거나 저장하지 않습니다.
  원격 디버깅을 열지 않으며 앱 내부 연결은 외부 네트워크에 공개하지 않습니다.
  이전 Kirinuki 전용 프로세스는 PID·시작시각·UID·프로필·실행파일·명령행을
  재검증한 뒤 SIGTERM 한 번으로 전환하며, SIGKILL은 사용하지 않습니다.
  검증되지 않은 프로세스는 종료하지 않습니다.
  전용 브라우저 프로필은 ${resolveLinuxHelperPaths().browserProfileRoot}에 유지됩니다.
`.trim();
}

function defaultContext(
  overrides: LinuxHelperContextOverrides = {}
): LinuxHelperContext {
  const sourceEnvironment = overrides.env || process.env;
  const studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN;
  const environment = exactStudioOriginEnvironment(
    sourceEnvironment,
    studioOrigin
  );
  const context: LinuxHelperContext = {
    env: environment,
    studioOrigin,
    platform: overrides.platform ?? process.platform,
    stdin: overrides.stdin ?? process.stdin,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    paths: overrides.paths ?? resolveLinuxHelperPaths({
      env: environment,
      homeDir: environment.HOME || os.homedir()
    }),
    setExitCode: overrides.setExitCode ?? ((value: number) => {
      process.exitCode = value;
    })
  };
  return context;
}

export async function main(
  argv: readonly unknown[] = process.argv.slice(2),
  overrides: LinuxHelperContextOverrides = {}
): Promise<void> {
  const context = defaultContext(overrides);
  if (context.platform !== "linux") {
    throw new Error("Kirinuki 앱은 현재 Linux만 지원합니다.");
  }
  if (!versionAtLeast(process.versions.node, MINIMUM_NODE_VERSION)) {
    throw new Error(`Node ${MINIMUM_NODE_VERSION} 이상이 필요합니다.`);
  }
  let parsed = parseLinuxHelperArgs(argv);
  if (!parsed.command) {
    parsed = {
      command: "open",
      options: {
        ...parsed.options,
        yes: true
      }
    };
  }
  const { command, options } = parsed;
  if (command === "help") {
    line(context.stdout, helpText());
    return;
  }
  if (command === "setup") {
    await setupCommand(options, context);
    return;
  }
  if (command === "doctor") {
    await doctorCommand(options, context);
    return;
  }
  if (command === "start" || command === "open") {
    await openCommand(options, context);
    return;
  }
  if (command === "status") {
    await statusCommand(options, context);
    return;
  }
  if (command === "stop") {
    await stopCommand(options, context);
    return;
  }
  throw new TypeError(`알 수 없는 명령입니다: ${command}`);
}

function isMainModule() {
  return Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    await reportLinuxHelperStartupFailure(error);
    process.exitCode = 1;
  }
}
