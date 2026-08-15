import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  KIRINUKI_GATEWAY_ORIGIN_BINDING,
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  isKirinukiLocalStudioOrigin,
  resolveKirinukiAppOrigin
} from "../src/lib/local-runtime-origin.js";
import type { KirinukiAppOrigin } from "../src/lib/local-runtime-origin.js";

export const LOCAL_VOD_RUNTIME_SCHEMA =
  "kirinuki-local-vod-runtime/v1";
export const LOCAL_VOD_PID_SCHEMA =
  "kirinuki-local-vod-runtime-pid/v1";
export const VOD_LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_VOD_GATEWAY_PORT = 4319;
export const MINIMUM_VOD_NODE_VERSION = "22.13.0";
export const MINIMUM_VOD_PYTHON_VERSION = "3.11.0";
export const VOD_HEALTH_SCHEMA =
  "chzzk-kirinuki-caption-agent/health-v1";
export const VOD_REQUEST_SCHEMA =
  "chzzk-kirinuki-caption-request/v1";
export const VOD_RUNTIME_KINDS = Object.freeze([
  "vod-only",
  "caption-vod"
] as const);
export type VodRuntimeKind = typeof VOD_RUNTIME_KINDS[number];
export const VOD_INSTANCE_NONCE_BYTES = 32;

/**
 * Official yt-dlp Unix zipimport artifact. This artifact is intentionally
 * immutable: setup accepts it only when both its byte length and SHA-256 match.
 * The 2026.07.04 zipimport release includes yt-dlp-ejs 0.8.0 together with its
 * Meriyah and Astring JavaScript dependencies, so no floating npm download is
 * performed at runtime.
 */
export const PINNED_YT_DLP = Object.freeze({
  version: "2026.07.04",
  name: "yt-dlp",
  url:
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp",
  size: 3_071_553,
  sha256:
    "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd",
  kind: "official-unix-zipimport",
  bundledJavascript: Object.freeze({
    package: "yt-dlp-ejs",
    version: "0.8.0",
    dependencies: Object.freeze(["Meriyah", "Astring"])
  })
});

export interface VodRuntimeOptions {
  dryRun: boolean;
  foreground: boolean;
  json: boolean;
}

export interface LocalVodRuntimePaths {
  packageRoot: string;
  dataRoot: string;
  configRoot: string;
  stateRoot: string;
  runtimeRoot: string;
  binRoot: string;
  ytDlpPath: string;
  configPath: string;
  noticesPath: string;
  vodStateDir: string;
  pidPath: string;
  logPath: string;
}

export interface VodRuntimeTool {
  path: string;
  version: string;
}

export interface LocalVodRuntimeConfig {
  schema: typeof LOCAL_VOD_RUNTIME_SCHEMA;
  installedAt: string;
  host: typeof VOD_LOOPBACK_HOST;
  gatewayPort: number;
  origin: string;
  packageRoot: string;
  vodStateDir: string;
  ytDlp: {
    version: string;
    path: string;
    url: string;
    size: number;
    sha256: string;
    bundledEjsVersion: string;
  };
  node: VodRuntimeTool;
  python: VodRuntimeTool;
  ffmpeg: VodRuntimeTool;
  ffprobe: VodRuntimeTool;
  noticesPath: string;
  noticesSize: number;
  noticesSha256: string;
}

export interface VodRuntimePidRecord {
  schema: typeof LOCAL_VOD_PID_SCHEMA;
  pid: number;
  command: "start";
  startedAt: string;
  procStartTime: string;
  bootId: string;
  cliPath: string;
  instanceNonce: string;
}

export interface ManagedVodHealthIdentity {
  schema: typeof LOCAL_VOD_RUNTIME_SCHEMA;
  kind: VodRuntimeKind;
  ready: true;
  ytDlp: {
    version: typeof PINNED_YT_DLP.version;
  };
  ejs: {
    version: typeof PINNED_YT_DLP.bundledJavascript.version;
  };
  instanceNonce: string;
}

export interface ManagedVodHealthExpectation {
  instanceNonce?: string;
  kind?: VodRuntimeKind;
}

export interface ArtifactInspection {
  exists: boolean;
  regular: boolean;
  symlink: boolean;
  sizeMatches: boolean;
  sha256Matches: boolean;
  executable: boolean;
  verified: boolean;
}

export interface ArtifactManifest {
  size: number;
  sha256: string;
}

function requiredAbsolutePath(value: unknown, label: string): string {
  const raw = String(value || "");
  if (
    !raw
    || raw.trim() !== raw
    || /[\0\r\n]/u.test(raw)
    || !path.isAbsolute(raw)
  ) {
    throw new TypeError(
      `${label} 경로는 앞뒤 공백이나 줄바꿈이 없는 절대 경로여야 합니다.`
    );
  }
  return path.resolve(raw);
}

function withinRoot(candidate: unknown, root: string, label: string): string {
  const absolute = requiredAbsolutePath(candidate, label);
  const relative = path.relative(path.resolve(root), path.resolve(absolute));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError(`${label} 경로가 관리 디렉터리를 벗어났습니다.`);
  }
  return absolute;
}

export function resolveVodRuntimePaths({
  env = {},
  homeDir,
  packageRoot
}: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  packageRoot?: string;
} = {}): Readonly<LocalVodRuntimePaths> {
  const resolvedHome = requiredAbsolutePath(homeDir, "홈");
  const fallbackPackageRoot = requiredAbsolutePath(packageRoot, "패키지");
  const resolvedPackage = env.KIRINUKI_PACKAGE_ROOT === undefined
    ? fallbackPackageRoot
    : requiredAbsolutePath(
      env.KIRINUKI_PACKAGE_ROOT,
      "KIRINUKI_PACKAGE_ROOT"
    );
  const dataBase = env.XDG_DATA_HOME
    ? requiredAbsolutePath(env.XDG_DATA_HOME, "XDG_DATA_HOME")
    : path.join(resolvedHome, ".local", "share");
  const configBase = env.XDG_CONFIG_HOME
    ? requiredAbsolutePath(env.XDG_CONFIG_HOME, "XDG_CONFIG_HOME")
    : path.join(resolvedHome, ".config");
  const stateBase = env.XDG_STATE_HOME
    ? requiredAbsolutePath(env.XDG_STATE_HOME, "XDG_STATE_HOME")
    : path.join(resolvedHome, ".local", "state");
  const runtimeBase = env.XDG_RUNTIME_DIR
    ? requiredAbsolutePath(env.XDG_RUNTIME_DIR, "XDG_RUNTIME_DIR")
    : path.join(stateBase, "run");
  const dataRoot = path.join(dataBase, "kirinuki-vod-runtime");
  const configRoot = path.join(configBase, "kirinuki-vod-runtime");
  const stateRoot = path.join(stateBase, "kirinuki-vod-runtime");
  const runtimeRoot = path.join(runtimeBase, "kirinuki-vod-runtime");
  const binRoot = path.join(dataRoot, "bin");
  return Object.freeze({
    packageRoot: resolvedPackage,
    dataRoot,
    configRoot,
    stateRoot,
    runtimeRoot,
    binRoot,
    ytDlpPath: path.join(binRoot, `yt-dlp-${PINNED_YT_DLP.version}`),
    configPath: path.join(configRoot, "config.json"),
    noticesPath: path.join(dataRoot, "THIRD_PARTY_NOTICES.md"),
    vodStateDir: path.join(stateRoot, "vod-fragments"),
    pidPath: path.join(runtimeRoot, "manager.pid"),
    logPath: path.join(stateRoot, "gateway.log")
  });
}

function parseVersion(value: unknown): [number, number, number] | null {
  const match = /(?:^|\D)(\d+)\.(\d+)(?:\.(\d+))?/u.exec(
    String(value || "")
  );
  if (!match) {
    return null;
  }
  const parts = [match[1]!, match[2]!, match[3] || "0"]
    .map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  return parts as [number, number, number];
}

export function supportedSemanticVersion(
  actual: unknown,
  minimum: unknown
): boolean {
  const parsedActual = parseVersion(actual);
  const parsedMinimum = parseVersion(minimum);
  if (!parsedActual || !parsedMinimum) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const left = parsedActual[index]!;
    const right = parsedMinimum[index]!;
    if (left !== right) {
      return left > right;
    }
  }
  return true;
}

export function supportedVodNodeVersion(version: unknown): boolean {
  return supportedSemanticVersion(version, MINIMUM_VOD_NODE_VERSION);
}

export function supportedVodPythonVersion(version: unknown): boolean {
  return supportedSemanticVersion(version, MINIMUM_VOD_PYTHON_VERSION);
}

export function parsePythonVersion(output: unknown): string | null {
  const match = /(?:^|\s)Python\s+(\d+\.\d+(?:\.\d+)?)(?:\s|$)/iu.exec(
    String(output || "").trim()
  );
  return match?.[1] || null;
}

export function parseVodRuntimeArgs(
  argv: readonly unknown[] = []
): { command: string; options: VodRuntimeOptions } {
  const values = argv.map((value) => String(value));
  const command = values.shift() || "help";
  const options: VodRuntimeOptions = {
    dryRun: false,
    foreground: false,
    json: false
  };
  for (const value of values) {
    if (/api[-_]?key|token|secret|password|cookie/iu.test(value)) {
      throw new TypeError(
        "로컬 VOD runtime은 인증 정보나 쿠키를 명령행 인자로 받지 않습니다."
      );
    }
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (value === "--foreground") {
      options.foreground = true;
      continue;
    }
    if (value === "--json") {
      options.json = true;
      continue;
    }
    throw new TypeError(`알 수 없는 옵션입니다: ${value}`);
  }
  const normalizedCommand = ["-h", "--help"].includes(command)
    ? "help"
    : command;
  if (!new Set(["setup", "doctor", "start", "status", "stop", "help"])
    .has(normalizedCommand)) {
    throw new TypeError(`알 수 없는 명령입니다: ${command}`);
  }
  if (options.dryRun && normalizedCommand !== "setup") {
    throw new TypeError("--dry-run은 setup에서만 사용할 수 있습니다.");
  }
  if (options.foreground && normalizedCommand !== "start") {
    throw new TypeError("--foreground는 start에서만 사용할 수 있습니다.");
  }
  if (options.json && normalizedCommand === "help") {
    throw new TypeError("help에는 --json을 사용할 수 없습니다.");
  }
  return { command: normalizedCommand, options };
}

export function sha256Hex(value: import("node:crypto").BinaryLike): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function inspectArtifactFile(
  filePath: string,
  manifest: ArtifactManifest,
  { requireExecutable = true }: { requireExecutable?: boolean } = {}
): Promise<Readonly<ArtifactInspection>> {
  const unavailable: ArtifactInspection = {
    exists: false,
    regular: false,
    symlink: false,
    sizeMatches: false,
    sha256Matches: false,
    executable: false,
    verified: false
  };
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(filePath);
  } catch {
    return Object.freeze(unavailable);
  }
  const regular = info.isFile();
  const symlink = info.isSymbolicLink();
  const sizeMatches = regular && info.size === manifest.size;
  const executable = regular && (info.mode & 0o111) !== 0;
  const sha256Matches = sizeMatches
    && await sha256File(filePath) === manifest.sha256;
  return Object.freeze({
    exists: true,
    regular,
    symlink,
    sizeMatches,
    sha256Matches,
    executable,
    verified: Boolean(
      regular
      && !symlink
      && sizeMatches
      && sha256Matches
      && (!requireExecutable || executable)
    )
  });
}

export function createVodRuntimeConfig(
  paths: LocalVodRuntimePaths,
  tools: {
    node: VodRuntimeTool;
    python: VodRuntimeTool;
    ffmpeg: VodRuntimeTool;
    ffprobe: VodRuntimeTool;
  },
  {
    installedAt = new Date().toISOString(),
    notices,
    origin = KIRINUKI_LOCAL_STUDIO_ORIGIN
  }: {
    installedAt?: string;
    notices: ArtifactManifest;
    origin?: KirinukiAppOrigin;
  }
): Readonly<LocalVodRuntimeConfig> {
  return Object.freeze({
    schema: LOCAL_VOD_RUNTIME_SCHEMA,
    installedAt,
    host: VOD_LOOPBACK_HOST,
    gatewayPort: DEFAULT_VOD_GATEWAY_PORT,
    origin: resolveKirinukiAppOrigin(origin),
    packageRoot: paths.packageRoot,
    vodStateDir: paths.vodStateDir,
    ytDlp: Object.freeze({
      version: PINNED_YT_DLP.version,
      path: paths.ytDlpPath,
      url: PINNED_YT_DLP.url,
      size: PINNED_YT_DLP.size,
      sha256: PINNED_YT_DLP.sha256,
      bundledEjsVersion: PINNED_YT_DLP.bundledJavascript.version
    }),
    node: Object.freeze({ ...tools.node }),
    python: Object.freeze({ ...tools.python }),
    ffmpeg: Object.freeze({ ...tools.ffmpeg }),
    ffprobe: Object.freeze({ ...tools.ffprobe }),
    noticesPath: paths.noticesPath,
    noticesSize: notices.size,
    noticesSha256: notices.sha256
  });
}

function validTool(value: unknown): value is VodRuntimeTool {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<VodRuntimeTool>;
  try {
    requiredAbsolutePath(candidate.path, "도구");
  } catch {
    return false;
  }
  return Boolean(
    typeof candidate.version === "string"
    && /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/u
      .test(candidate.version)
    && !/[\0\r\n]/u.test(candidate.version)
  );
}

function exactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !value) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function validateVodRuntimeConfig(
  value: unknown,
  paths: LocalVodRuntimePaths
): Readonly<LocalVodRuntimeConfig> {
  if (!value || typeof value !== "object") {
    throw new TypeError("로컬 VOD runtime 설정이 객체가 아닙니다.");
  }
  const candidate = value as Partial<LocalVodRuntimeConfig> & {
    repoRoot?: unknown;
    extensionRoot?: unknown;
  };
  const legacyPackageRoot = (
    candidate.packageRoot === undefined
    && typeof candidate.repoRoot === "string"
    && path.isAbsolute(candidate.repoRoot)
    && path.resolve(candidate.repoRoot) === paths.packageRoot
    && typeof candidate.extensionRoot === "string"
    && path.isAbsolute(candidate.extensionRoot)
    && candidate.extensionRoot.trim() === candidate.extensionRoot
    && !/[\0\r\n]/u.test(candidate.extensionRoot)
  )
    ? paths.packageRoot
    : null;
  const config = {
    ...candidate,
    packageRoot: typeof candidate.packageRoot === "string"
      && path.isAbsolute(candidate.packageRoot)
      ? path.resolve(candidate.packageRoot)
      : candidate.packageRoot ?? legacyPackageRoot
  } as Partial<LocalVodRuntimeConfig>;
  if (
    config.schema !== LOCAL_VOD_RUNTIME_SCHEMA
    || !exactIsoTimestamp(config.installedAt)
    || config.host !== VOD_LOOPBACK_HOST
    || typeof config.gatewayPort !== "number"
    || !Number.isInteger(config.gatewayPort)
    || config.gatewayPort !== DEFAULT_VOD_GATEWAY_PORT
    || !isKirinukiLocalStudioOrigin(config.origin)
    || config.packageRoot !== paths.packageRoot
    || config.vodStateDir !== paths.vodStateDir
    || config.noticesPath !== paths.noticesPath
    || !Number.isSafeInteger(config.noticesSize)
    || Number(config.noticesSize) <= 0
    || typeof config.noticesSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(config.noticesSha256)
    || config.ytDlp?.version !== PINNED_YT_DLP.version
    || config.ytDlp?.path !== paths.ytDlpPath
    || config.ytDlp?.url !== PINNED_YT_DLP.url
    || config.ytDlp?.size !== PINNED_YT_DLP.size
    || config.ytDlp?.sha256 !== PINNED_YT_DLP.sha256
    || config.ytDlp?.bundledEjsVersion
      !== PINNED_YT_DLP.bundledJavascript.version
    || !validTool(config.node)
    || !validTool(config.python)
    || !validTool(config.ffmpeg)
    || !validTool(config.ffprobe)
    || !supportedVodNodeVersion(config.node?.version)
    || !supportedVodPythonVersion(config.python?.version)
  ) {
    throw new TypeError(
      "로컬 VOD runtime 설정이 현재 고정 artifact 또는 경로 계약과 맞지 않습니다."
    );
  }
  withinRoot(config.ytDlp.path, paths.binRoot, "yt-dlp");
  withinRoot(config.vodStateDir, paths.stateRoot, "VOD 상태");
  withinRoot(config.noticesPath, paths.dataRoot, "라이선스 고지");
  return Object.freeze({
    schema: config.schema,
    installedAt: config.installedAt,
    host: config.host,
    gatewayPort: config.gatewayPort,
    origin: config.origin,
    packageRoot: config.packageRoot,
    vodStateDir: config.vodStateDir,
    ytDlp: Object.freeze({ ...config.ytDlp! }),
    node: Object.freeze({ ...config.node! }),
    python: Object.freeze({ ...config.python! }),
    ffmpeg: Object.freeze({ ...config.ffmpeg! }),
    ffprobe: Object.freeze({ ...config.ffprobe! }),
    noticesPath: config.noticesPath,
    noticesSize: config.noticesSize,
    noticesSha256: config.noticesSha256
  } as LocalVodRuntimeConfig);
}

export async function readVodRuntimeConfig(
  paths: LocalVodRuntimePaths,
  { required = false }: { required?: boolean } = {}
): Promise<Readonly<LocalVodRuntimeConfig> | null> {
  let raw: string;
  try {
    raw = await readFile(paths.configPath, "utf8");
  } catch (error) {
    if (
      !required
      && error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      throw new Error(
        "로컬 VOD runtime이 설치되지 않았습니다. 먼저 setup을 실행하세요."
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("로컬 VOD runtime 설정이 올바른 JSON이 아닙니다.");
  }
  return validateVodRuntimeConfig(parsed, paths);
}

export function vodRuntimeConfigNeedsPackageRootMigration(
  value: unknown
): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && !("packageRoot" in value)
    && "repoRoot" in value
    && "extensionRoot" in value
  );
}

function containsSecretKey(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/api[-_]?key|token|secret|password|cookie|credential|authorization/iu
      .test(key)) {
      return true;
    }
    if (containsSecretKey(nested)) {
      return true;
    }
  }
  return false;
}

export function secretFreeVodConfigJson(
  config: LocalVodRuntimeConfig
): string {
  validateVodRuntimeConfig(config, {
    packageRoot: config.packageRoot,
    dataRoot: path.dirname(config.noticesPath),
    configRoot: path.dirname(path.dirname(config.noticesPath)),
    stateRoot: path.dirname(config.vodStateDir),
    runtimeRoot: path.dirname(config.vodStateDir),
    binRoot: path.dirname(config.ytDlp.path),
    ytDlpPath: config.ytDlp.path,
    configPath: "unused",
    noticesPath: config.noticesPath,
    vodStateDir: config.vodStateDir,
    pidPath: "unused",
    logPath: "unused"
  });
  if (containsSecretKey(config)) {
    throw new TypeError("설정에는 인증 정보나 비밀 값을 저장할 수 없습니다.");
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

const SAFE_INHERITED_ENVIRONMENT_KEYS = new Set([
  "COMSPEC",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "WINDIR"
]);

export function managedVodRuntimeEnvironment(
  config: LocalVodRuntimeConfig,
  {
    baseEnvironment = {},
    nodeBinary = config.node.path,
    kind = "vod-only",
    instanceNonce = createVodInstanceNonce()
  }: {
    baseEnvironment?: NodeJS.ProcessEnv;
    nodeBinary?: string;
    kind?: VodRuntimeKind;
    instanceNonce?: string;
  } = {}
): NodeJS.ProcessEnv {
  assertManagedVodEnvironmentConfig(config);
  const exactNode = requiredAbsolutePath(nodeBinary, "Node");
  if (exactNode !== path.normalize(config.node.path)) {
    throw new TypeError(
      "gateway Node는 검증된 VOD runtime 설정의 exact 경로여야 합니다."
    );
  }
  if (!VOD_RUNTIME_KINDS.includes(kind)) {
    throw new TypeError("VOD runtime kind가 올바르지 않습니다.");
  }
  if (!isValidVodInstanceNonce(instanceNonce)) {
    throw new TypeError("VOD runtime instance nonce가 올바르지 않습니다.");
  }
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnvironment)) {
    if (
      value !== undefined
      && SAFE_INHERITED_ENVIRONMENT_KEYS.has(key.toUpperCase())
    ) {
      environment[key] = value;
    }
  }
  environment.PATH = [
    path.dirname(exactNode),
    path.dirname(config.python.path),
    path.dirname(config.ffmpeg.path),
    path.dirname(config.ffprobe.path),
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ].filter((entry, index, all) => all.indexOf(entry) === index)
    .join(path.delimiter);
  environment.NO_COLOR = "1";
  environment.NO_PROXY = "127.0.0.1,localhost";
  environment.no_proxy = environment.NO_PROXY;
  environment.KIRINUKI_AUTO_PAIR = "1";
  environment.KIRINUKI_PACKAGE_ROOT = config.packageRoot;
  environment.KIRINUKI_ALLOWED_ORIGIN = config.origin;
  environment.KIRINUKI_AGENT_PORT = String(config.gatewayPort);
  environment.KIRINUKI_YT_DLP_BINARY = config.ytDlp.path;
  environment.KIRINUKI_YT_DLP_PYTHON_BINARY = config.python.path;
  environment.KIRINUKI_YT_DLP_NODE_BINARY = exactNode;
  environment.KIRINUKI_FFMPEG_BINARY = config.ffmpeg.path;
  environment.KIRINUKI_FFPROBE_BINARY = config.ffprobe.path;
  environment.KIRINUKI_VOD_STATE_DIR = config.vodStateDir;
  environment.KIRINUKI_VOD_RUNTIME_SCHEMA = LOCAL_VOD_RUNTIME_SCHEMA;
  environment.KIRINUKI_VOD_RUNTIME_KIND = kind;
  environment.KIRINUKI_VOD_RUNTIME_READY = "1";
  environment.KIRINUKI_VOD_YT_DLP_VERSION = PINNED_YT_DLP.version;
  environment.KIRINUKI_VOD_EJS_VERSION =
    PINNED_YT_DLP.bundledJavascript.version;
  environment.KIRINUKI_VOD_INSTANCE_NONCE = instanceNonce;
  return environment;
}

function assertManagedVodEnvironmentConfig(
  config: LocalVodRuntimeConfig
): void {
  try {
    validateVodRuntimeConfig(config, {
      packageRoot: config.packageRoot,
      dataRoot: path.dirname(config.noticesPath),
      configRoot: path.dirname(config.noticesPath),
      stateRoot: path.dirname(config.vodStateDir),
      runtimeRoot: path.dirname(config.vodStateDir),
      binRoot: path.dirname(config.ytDlp.path),
      ytDlpPath: config.ytDlp.path,
      configPath: path.join(path.dirname(config.noticesPath), "config.json"),
      noticesPath: config.noticesPath,
      vodStateDir: config.vodStateDir,
      pidPath: path.join(path.dirname(config.vodStateDir), "manager.pid"),
      logPath: path.join(path.dirname(config.vodStateDir), "gateway.log")
    });
  } catch {
    throw new TypeError(
      "검증되지 않은 로컬 VOD runtime 설정으로 gateway 환경을 만들 수 없습니다."
    );
  }
}

export function createVodInstanceNonce(): string {
  return randomBytes(VOD_INSTANCE_NONCE_BYTES).toString("base64url");
}

export function isValidVodInstanceNonce(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^[A-Za-z0-9_-]{43}$/u.test(value)
  );
}

export function vodManagerEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  paths: LocalVodRuntimePaths,
  {
    instanceNonce = createVodInstanceNonce()
  }: { instanceNonce?: string } = {}
): NodeJS.ProcessEnv {
  if (!isValidVodInstanceNonce(instanceNonce)) {
    throw new TypeError("VOD manager instance nonce가 올바르지 않습니다.");
  }
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnvironment)) {
    const upper = key.toUpperCase();
    if (
      value !== undefined
      && (
        SAFE_INHERITED_ENVIRONMENT_KEYS.has(upper)
        || [
          "XDG_DATA_HOME",
          "XDG_CONFIG_HOME",
          "XDG_STATE_HOME",
          "XDG_RUNTIME_DIR",
          "KIRINUKI_PACKAGE_ROOT"
        ].includes(upper)
      )
    ) {
      environment[key] = value;
    }
  }
  environment.PATH = [
    path.dirname(process.execPath),
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ].join(path.delimiter);
  environment.NO_COLOR = "1";
  environment.NO_PROXY = "127.0.0.1,localhost";
  environment.no_proxy = environment.NO_PROXY;
  environment.KIRINUKI_PACKAGE_ROOT = paths.packageRoot;
  environment.KIRINUKI_VOD_INSTANCE_NONCE = instanceNonce;
  return environment;
}

export function vodHealthRequest(config: LocalVodRuntimeConfig): Readonly<{
  host: string;
  port: number;
  path: string;
  method: "GET";
  headers: Readonly<Record<string, string>>;
}> {
  return Object.freeze({
    host: VOD_LOOPBACK_HOST,
    port: config.gatewayPort,
    path: "/v1/health",
    method: "GET",
    headers: Object.freeze({
      Origin: config.origin,
      "X-Kirinuki-Protocol": VOD_REQUEST_SCHEMA,
      Accept: "application/json"
    })
  });
}

export function managedVodHealthIdentity(
  value: unknown,
  {
    instanceNonce,
    kind
  }: ManagedVodHealthExpectation = {}
): Readonly<ManagedVodHealthIdentity> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const identity = payload.vodRuntime;
  if (!identity || typeof identity !== "object") {
    return null;
  }
  const candidate = identity as Record<string, unknown>;
  const ytDlp = candidate.ytDlp;
  const ejs = candidate.ejs;
  const valid = Boolean(
    payload.schema === VOD_HEALTH_SCHEMA
    && payload.status === "ok"
    && payload.managed === true
    && payload.originBinding === KIRINUKI_GATEWAY_ORIGIN_BINDING
    && candidate.schema === LOCAL_VOD_RUNTIME_SCHEMA
    && VOD_RUNTIME_KINDS.includes(candidate.kind as VodRuntimeKind)
    && candidate.ready === true
    && ytDlp
    && typeof ytDlp === "object"
    && (ytDlp as Record<string, unknown>).version === PINNED_YT_DLP.version
    && ejs
    && typeof ejs === "object"
    && (ejs as Record<string, unknown>).version
      === PINNED_YT_DLP.bundledJavascript.version
    && isValidVodInstanceNonce(candidate.instanceNonce)
    && (instanceNonce === undefined || candidate.instanceNonce === instanceNonce)
    && (kind === undefined || candidate.kind === kind)
  );
  return valid
    ? Object.freeze(candidate as unknown as ManagedVodHealthIdentity)
    : null;
}

export function isManagedVodHealthPayload(
  value: unknown,
  expectation: ManagedVodHealthExpectation = {}
): boolean {
  return managedVodHealthIdentity(value, expectation) !== null;
}

export function vodGatewayOwnedByPid(
  identity: Readonly<ManagedVodHealthIdentity> | null,
  record: Readonly<VodRuntimePidRecord> | null
): boolean {
  return Boolean(
    identity?.kind === "vod-only"
    && record
    && identity.instanceNonce === record.instanceNonce
  );
}

export function parseProcStartTime(statText: unknown): string | null {
  const value = String(statText || "");
  const commandEnd = value.lastIndexOf(") ");
  if (commandEnd < 0) {
    return null;
  }
  const fieldsFromState = value
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u);
  const startTime = fieldsFromState[19];
  return startTime !== undefined && /^\d+$/u.test(startTime)
    ? startTime
    : null;
}

export function commandLineRunsExactVodCli({
  commandLine,
  processCwd,
  expectedCliPath
}: {
  commandLine: unknown;
  processCwd: string;
  expectedCliPath: string;
}): boolean {
  const args = String(commandLine || "")
    .split("\0")
    .filter(Boolean);
  const expected = path.resolve(expectedCliPath);
  const scriptIndex = args.findIndex((argument, index) => {
    if (index === 0 || argument.startsWith("-")) {
      return false;
    }
    const absolute = path.isAbsolute(argument)
      ? path.resolve(argument)
      : path.resolve(processCwd, argument);
    return absolute === expected;
  });
  if (scriptIndex < 0) {
    return false;
  }
  const trailing = args.slice(scriptIndex + 1);
  return trailing.includes("start") && trailing.includes("--foreground");
}

export function validVodPidRecord(
  value: unknown,
  expectedCliPath: string
): value is VodRuntimePidRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<VodRuntimePidRecord>;
  return Boolean(
    record.schema === LOCAL_VOD_PID_SCHEMA
    && Number.isInteger(record.pid)
    && Number(record.pid) >= 2
    && record.command === "start"
    && typeof record.startedAt === "string"
    && !Number.isNaN(Date.parse(record.startedAt))
    && typeof record.procStartTime === "string"
    && /^\d+$/u.test(record.procStartTime)
    && typeof record.bootId === "string"
    && /^[0-9a-f-]{16,64}$/iu.test(record.bootId)
    && record.cliPath === path.resolve(expectedCliPath)
    && isValidVodInstanceNonce(record.instanceNonce)
  );
}
