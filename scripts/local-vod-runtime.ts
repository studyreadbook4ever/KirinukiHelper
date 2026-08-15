#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  constants as fsConstants,
  createWriteStream
} from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_VOD_GATEWAY_PORT,
  LOCAL_VOD_PID_SCHEMA,
  MINIMUM_VOD_NODE_VERSION,
  MINIMUM_VOD_PYTHON_VERSION,
  PINNED_YT_DLP,
  VOD_LOOPBACK_HOST,
  commandLineRunsExactVodCli,
  createVodInstanceNonce,
  createVodRuntimeConfig,
  inspectArtifactFile,
  isValidVodInstanceNonce,
  managedVodHealthIdentity,
  managedVodRuntimeEnvironment,
  parseProcStartTime,
  parsePythonVersion,
  parseVodRuntimeArgs,
  readVodRuntimeConfig,
  resolveVodRuntimePaths,
  secretFreeVodConfigJson,
  sha256Hex,
  supportedVodNodeVersion,
  supportedVodPythonVersion,
  validVodPidRecord,
  vodGatewayOwnedByPid,
  vodRuntimeConfigNeedsPackageRootMigration,
  vodHealthRequest,
  vodManagerEnvironment
} from "./local-vod-runtime-core.js";
import type {
  ArtifactInspection,
  LocalVodRuntimeConfig,
  LocalVodRuntimePaths,
  VodRuntimeOptions,
  VodRuntimePidRecord,
  VodRuntimeTool,
  VodRuntimeKind,
  ManagedVodHealthExpectation,
  ManagedVodHealthIdentity
} from "./local-vod-runtime-core.js";
import { typescriptCommandArgs } from "./typescript-runtime.js";
import {
  resolveKirinukiAppOrigin
} from "../src/lib/local-runtime-origin.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(import.meta.url);
const gatewayPath = path.join(packageRoot, "scripts", "caption-gateway.ts");
const legalNoticesSource = path.join(
  packageRoot,
  "legal",
  "THIRD_PARTY_NOTICES.md"
);
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;

function output(value: unknown = ""): void {
  process.stdout.write(`${String(value)}\n`);
}

function outputError(value: unknown): void {
  process.stderr.write(`${String(value)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === code
  );
}

export function helpText(): string {
  return `
Kirinuki 로컬 VOD runtime

사용법:
  node --import tsx scripts/local-vod-runtime.ts doctor [--json]
  node --import tsx scripts/local-vod-runtime.ts setup [--dry-run] [--json]
  node --import tsx scripts/local-vod-runtime.ts start [--foreground] [--json]
  node --import tsx scripts/local-vod-runtime.ts status [--json]
  node --import tsx scripts/local-vod-runtime.ts stop [--json]

설명:
  setup   공식 yt-dlp ${PINNED_YT_DLP.version} artifact를 크기+SHA-256으로 검증해 설치
  doctor  Node·Python·ffmpeg·ffprobe·설치·loopback gateway를 읽기 전용 점검
  start   자막 모드와 독립적인 VOD gateway manager를 시작 (systemd 미사용)
  status  설정·artifact·정확한 health·검증된 manager PID 상태 확인
  stop    Linux /proc identity가 일치하는 manager만 종료

보안 계약:
  쿠키·로그인·API 키를 입력하거나 전달·저장하지 않습니다.
  gateway는 항상 127.0.0.1:4319에만 bind합니다.
  앱 내부 Origin http://127.0.0.1:4320 하나만 허용합니다.
  공개 사이트와 Cloudflare Tunnel에는 이 내부 엔진을 연결하지 않습니다.
`.trim();
}

function runtimePaths(
  env: NodeJS.ProcessEnv = process.env
): Readonly<LocalVodRuntimePaths> {
  return resolveVodRuntimePaths({
    env,
    homeDir: os.homedir(),
    packageRoot
  });
}

function executableFromPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const pathValue = String(env.PATH || "");
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    if (!path.isAbsolute(directory) || /[\0\r\n]/u.test(directory)) {
      continue;
    }
    const candidate = path.join(directory, name);
    try {
      const result = spawnSync("test", ["-x", candidate], {
        env: { PATH: "/usr/bin:/bin" },
        stdio: "ignore",
        timeout: 1_000
      });
      if (result.status === 0) {
        return path.resolve(candidate);
      }
    } catch {
      // Continue through PATH.
    }
  }
  return null;
}

function commandVersion(
  executable: string,
  args: readonly string[],
  parse: (combined: string) => string | null
): VodRuntimeTool | null {
  const result = spawnSync(executable, args, {
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      NO_COLOR: "1"
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.error) {
    return null;
  }
  const version = parse(`${result.stdout || ""}\n${result.stderr || ""}`);
  return version ? { path: path.resolve(executable), version } : null;
}

function firstVersion(value: string): string | null {
  return /(?:^|\D)(\d+\.\d+(?:\.\d+)?)(?:\D|$)/u.exec(value)?.[1]
    || null;
}

export function inspectRequiredTools(
  env: NodeJS.ProcessEnv = process.env
): {
  node: VodRuntimeTool;
  python: VodRuntimeTool | null;
  ffmpeg: VodRuntimeTool | null;
  ffprobe: VodRuntimeTool | null;
} {
  const python = [
    "python3",
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11"
  ]
    .map((name) => executableFromPath(name, env))
    .filter((value): value is string => Boolean(value))
    .map((executable) => commandVersion(
      executable,
      ["--version"],
      parsePythonVersion
    ))
    .find((tool) => Boolean(
      tool && supportedVodPythonVersion(tool.version)
    )) || null;
  const ffmpegPath = executableFromPath("ffmpeg", env);
  const ffprobePath = executableFromPath("ffprobe", env);
  return {
    node: {
      path: path.resolve(process.execPath),
      version: process.versions.node
    },
    python,
    ffmpeg: ffmpegPath
      ? commandVersion(ffmpegPath, ["-version"], firstVersion)
      : null,
    ffprobe: ffprobePath
      ? commandVersion(ffprobePath, ["-version"], firstVersion)
      : null
  };
}

interface ExactCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

type ExactCommandRunner = (
  executable: string,
  args: readonly string[]
) => ExactCommandResult;

export interface VodToolchainInspection {
  node: boolean;
  python: boolean;
  ytDlp: boolean;
  ffmpeg: boolean;
  libx264Encoder: boolean;
  aacEncoder: boolean;
  mp4Muxer: boolean;
  ffprobe: boolean;
  ready: boolean;
}

function defaultExactCommandRunner(
  executable: string,
  args: readonly string[]
): ExactCommandResult {
  const result = spawnSync(executable, [...args], {
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      NO_COLOR: "1",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost"
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    ...(result.error ? { error: result.error } : {})
  };
}

function successfulCommand(result: ExactCommandResult): boolean {
  return result.status === 0 && !result.error;
}

function exactReportedVersion(
  result: ExactCommandResult,
  expected: string
): boolean {
  return successfulCommand(result)
    && firstVersion(`${result.stdout}\n${result.stderr}`) === expected;
}

export function inspectVodToolchain(
  config: LocalVodRuntimeConfig,
  {
    runCommand = defaultExactCommandRunner
  }: { runCommand?: ExactCommandRunner } = {}
): Readonly<VodToolchainInspection> {
  const nodeResult = runCommand(config.node.path, ["--version"]);
  const pythonResult = runCommand(config.python.path, ["--version"]);
  const ytDlpResult = runCommand(
    config.python.path,
    ["-I", config.ytDlp.path, "--version"]
  );
  const ffmpegVersion = runCommand(config.ffmpeg.path, ["-version"]);
  const ffmpegEncoders = runCommand(
    config.ffmpeg.path,
    ["-hide_banner", "-encoders"]
  );
  const ffmpegMuxers = runCommand(
    config.ffmpeg.path,
    ["-hide_banner", "-muxers"]
  );
  const ffprobeResult = runCommand(config.ffprobe.path, ["-version"]);
  const encoderOutput = `${ffmpegEncoders.stdout}\n${ffmpegEncoders.stderr}`;
  const muxerOutput = `${ffmpegMuxers.stdout}\n${ffmpegMuxers.stderr}`;
  const inspection: VodToolchainInspection = {
    node: exactReportedVersion(nodeResult, config.node.version),
    python: exactReportedVersion(pythonResult, config.python.version),
    ytDlp: successfulCommand(ytDlpResult)
      && ytDlpResult.stdout.trim() === PINNED_YT_DLP.version,
    ffmpeg: exactReportedVersion(ffmpegVersion, config.ffmpeg.version),
    libx264Encoder: successfulCommand(ffmpegEncoders)
      && /^\s*V\S*\s+libx264(?:\s|$)/mu.test(encoderOutput),
    aacEncoder: successfulCommand(ffmpegEncoders)
      && /^\s*A\S*\s+aac(?:\s|$)/mu.test(encoderOutput),
    mp4Muxer: successfulCommand(ffmpegMuxers)
      && /^\s*E\s+mp4(?:\s|$)/mu.test(muxerOutput),
    ffprobe: exactReportedVersion(ffprobeResult, config.ffprobe.version),
    ready: false
  };
  inspection.ready = Object.entries(inspection)
    .filter(([key]) => key !== "ready")
    .every(([, ready]) => ready === true);
  return Object.freeze(inspection);
}

function assertRequiredTools(
  tools: ReturnType<typeof inspectRequiredTools>
): asserts tools is {
  node: VodRuntimeTool;
  python: VodRuntimeTool;
  ffmpeg: VodRuntimeTool;
  ffprobe: VodRuntimeTool;
} {
  if (!supportedVodNodeVersion(tools.node.version)) {
    throw new Error(`Node ${MINIMUM_VOD_NODE_VERSION} 이상이 필요합니다.`);
  }
  if (!tools.python) {
    throw new Error(`Python ${MINIMUM_VOD_PYTHON_VERSION} 이상이 필요합니다.`);
  }
  if (!tools.ffmpeg) {
    throw new Error("ffmpeg 실행 파일이 필요합니다.");
  }
  if (!tools.ffprobe) {
    throw new Error("ffprobe 실행 파일이 필요합니다.");
  }
}

async function writeAtomic(
  filePath: string,
  contents: string,
  mode = 0o600
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.part-${process.pid}-${randomBytes(6).toString("hex")}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
    await chmod(filePath, mode);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function migrateLegacyVodConfigIfNeeded(
  paths: LocalVodRuntimePaths
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(paths.configPath, "utf8"));
  } catch {
    return;
  }
  if (!vodRuntimeConfigNeedsPackageRootMigration(parsed)) {
    return;
  }
  const normalized = await readVodRuntimeConfig(paths, { required: true });
  if (!normalized) {
    return;
  }
  await writeAtomic(
    paths.configPath,
    secretFreeVodConfigJson(normalized),
    0o600
  );
}

export async function downloadPinnedYtDlp(
  destination: string,
  {
    fetchImpl = globalThis.fetch
  }: { fetchImpl?: typeof globalThis.fetch } = {}
): Promise<void> {
  const existing = await inspectArtifactFile(destination, PINNED_YT_DLP);
  if (existing.verified) {
    return;
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Node fetch를 사용할 수 없습니다.");
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.part-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    const response = await fetchImpl(PINNED_YT_DLP.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10 * 60 * 1_000)
    });
    if (!response.ok || !response.body) {
      throw new Error(`yt-dlp 다운로드 실패 (${response.status})`);
    }
    const advertisedSize = response.headers.get("content-length");
    if (
      advertisedSize !== null
      && Number(advertisedSize) !== PINNED_YT_DLP.size
    ) {
      throw new Error("yt-dlp 응답 크기가 고정 manifest와 다릅니다.");
    }
    let received = 0;
    const boundedStream = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.byteLength;
        if (received > PINNED_YT_DLP.size) {
          callback(new Error("yt-dlp 응답이 고정 크기를 넘었습니다."));
          return;
        }
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>
      ),
      boundedStream,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 })
    );
    const downloaded = await inspectArtifactFile(
      temporary,
      PINNED_YT_DLP,
      { requireExecutable: false }
    );
    if (!downloaded.verified) {
      throw new Error("yt-dlp 크기 또는 SHA-256 검증에 실패했습니다.");
    }
    await chmod(temporary, 0o700);
    await rename(temporary, destination);
    await chmod(destination, 0o700);
    const installed = await inspectArtifactFile(destination, PINNED_YT_DLP);
    if (!installed.verified) {
      throw new Error("설치 후 yt-dlp artifact 검증에 실패했습니다.");
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function probeVodGatewayHealth(
  config: LocalVodRuntimeConfig,
  timeoutMs = 1_500,
  expectation: ManagedVodHealthExpectation = {}
): Promise<Readonly<ManagedVodHealthIdentity> | null> {
  return new Promise<Readonly<ManagedVodHealthIdentity> | null>((resolve) => {
    let settled = false;
    const finish = (
      value: Readonly<ManagedVodHealthIdentity> | null
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const options = vodHealthRequest(config);
    const request = httpRequest({
      ...options,
      agent: false,
      timeout: timeoutMs
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_HEALTH_RESPONSE_BYTES) {
          request.destroy();
          finish(null);
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        let payload: unknown;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          finish(null);
          return;
        }
        finish(response.statusCode === 200
          ? managedVodHealthIdentity(payload, expectation)
          : null);
      });
    });
    request.once("timeout", () => {
      request.destroy();
      finish(null);
    });
    request.once("error", () => finish(null));
    request.end();
  });
}

export async function probeVodGateway(
  config: LocalVodRuntimeConfig,
  timeoutMs = 1_500,
  expectation: ManagedVodHealthExpectation = {}
): Promise<boolean> {
  return Boolean(
    await probeVodGatewayHealth(config, timeoutMs, expectation)
  );
}

async function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({
      host: VOD_LOOPBACK_HOST,
      port
    });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function readBootId(): Promise<string> {
  try {
    return (await readFile(
      "/proc/sys/kernel/random/boot_id",
      "utf8"
    )).trim();
  } catch {
    return "";
  }
}

async function readProcStartTime(pid: number): Promise<string | null> {
  try {
    return parseProcStartTime(await readFile(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

async function readPidRecord(
  paths: LocalVodRuntimePaths
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(paths.pidPath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifiedVodRuntimePid(
  paths: LocalVodRuntimePaths
): Promise<VodRuntimePidRecord | null> {
  if (process.platform !== "linux") {
    return null;
  }
  const candidate = await readPidRecord(paths);
  if (!validVodPidRecord(candidate, cliPath)) {
    return null;
  }
  const record = candidate;
  let commandLine: string;
  let processCwd: string;
  try {
    [commandLine, processCwd] = await Promise.all([
      readFile(`/proc/${record.pid}/cmdline`, "utf8"),
      readlink(`/proc/${record.pid}/cwd`)
    ]);
  } catch {
    return null;
  }
  if (!commandLineRunsExactVodCli({
    commandLine,
    processCwd,
    expectedCliPath: cliPath
  })) {
    return null;
  }
  const [procStartTime, bootId] = await Promise.all([
    readProcStartTime(record.pid),
    readBootId()
  ]);
  if (
    procStartTime !== record.procStartTime
    || bootId !== record.bootId
  ) {
    return null;
  }
  return record;
}

async function currentPidRecord(
  requestedNonce: unknown
): Promise<VodRuntimePidRecord> {
  if (process.platform !== "linux") {
    throw new Error("관리형 PID identity는 Linux에서만 지원합니다.");
  }
  const [procStartTime, bootId] = await Promise.all([
    readProcStartTime(process.pid),
    readBootId()
  ]);
  if (!procStartTime || !bootId) {
    throw new Error("현재 manager의 Linux process identity를 확인하지 못했습니다.");
  }
  const instanceNonce = requestedNonce === undefined
    ? createVodInstanceNonce()
    : requestedNonce;
  if (!isValidVodInstanceNonce(instanceNonce)) {
    throw new Error("manager instance nonce가 올바르지 않습니다.");
  }
  return {
    schema: LOCAL_VOD_PID_SCHEMA,
    pid: process.pid,
    command: "start",
    startedAt: new Date().toISOString(),
    procStartTime,
    bootId,
    cliPath: path.resolve(cliPath),
    instanceNonce
  };
}

function samePidRecord(
  left: VodRuntimePidRecord,
  right: VodRuntimePidRecord
): boolean {
  return (
    left.schema === right.schema
    && left.pid === right.pid
    && left.procStartTime === right.procStartTime
    && left.bootId === right.bootId
    && left.cliPath === right.cliPath
    && left.instanceNonce === right.instanceNonce
  );
}

interface PidMutationLock {
  path: string;
  identity: string;
}

async function acquirePidMutationLock(
  paths: LocalVodRuntimePaths
): Promise<PidMutationLock> {
  const lockPath = `${paths.pidPath}.mutation-lock`;
  const identity = `${process.pid}:${randomBytes(16).toString("hex")}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${identity}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    return { path: lockPath, identity };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error(
        "다른 start/stop 작업이 PID 파일을 확인 중입니다. 공유 파일은 변경하지 않았습니다."
      );
    }
    throw error;
  }
}

async function releasePidMutationLock(lock: PidMutationLock): Promise<void> {
  const current = await readFile(lock.path, "utf8").catch(() => null);
  if (current === `${lock.identity}\n`) {
    await rm(lock.path, { force: true });
  }
}

async function claimPidFile(
  paths: LocalVodRuntimePaths
): Promise<VodRuntimePidRecord> {
  await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
  const mutationLock = await acquirePidMutationLock(paths);
  try {
    const record = await currentPidRecord(
      process.env.KIRINUKI_VOD_INSTANCE_NONCE
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(paths.pidPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      return record;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
      const active = await verifiedVodRuntimePid(paths);
      if (active) {
        throw new Error(
          `로컬 VOD runtime이 이미 실행 중입니다 (PID ${active.pid}).`
        );
      }
      throw new Error(
        "검증되지 않은 manager PID 파일이 있습니다. start는 공유 PID 파일을 지우지 않습니다. 포트가 내려가 있는지 확인한 뒤 stop으로 격리하세요."
      );
    }
  } finally {
    await releasePidMutationLock(mutationLock);
  }
}

async function releaseOwnPidFile(
  paths: LocalVodRuntimePaths,
  ownRecord: VodRuntimePidRecord
): Promise<void> {
  const mutationLock = await acquirePidMutationLock(paths);
  try {
    const current = await readPidRecord(paths);
    if (
      validVodPidRecord(current, cliPath)
      && samePidRecord(current, ownRecord)
    ) {
      await rm(paths.pidPath, { force: true });
    }
  } finally {
    await releasePidMutationLock(mutationLock);
  }
}

async function executable(candidate: string): Promise<boolean> {
  try {
    const info = await lstat(candidate);
    await access(candidate, fsConstants.X_OK);
    return info.isFile() || info.isSymbolicLink();
  } catch {
    return false;
  }
}

export interface VodNoticesInspection {
  source: Readonly<ArtifactInspection>;
  installed: Readonly<ArtifactInspection>;
  ready: boolean;
}

export async function inspectVodNotices(
  config: LocalVodRuntimeConfig
): Promise<Readonly<VodNoticesInspection>> {
  const manifest = {
    size: config.noticesSize,
    sha256: config.noticesSha256
  };
  const [source, installed] = await Promise.all([
    inspectArtifactFile(legalNoticesSource, manifest, {
      requireExecutable: false
    }),
    inspectArtifactFile(config.noticesPath, manifest, {
      requireExecutable: false
    })
  ]);
  return Object.freeze({
    source,
    installed,
    ready: source.verified && installed.verified
  });
}

async function assertInstalledRuntime(
  paths: LocalVodRuntimePaths
): Promise<Readonly<LocalVodRuntimeConfig>> {
  const config = await readVodRuntimeConfig(paths, { required: true });
  if (!config) {
    throw new Error("로컬 VOD runtime 설정을 읽지 못했습니다.");
  }
  const artifact = await inspectArtifactFile(config.ytDlp.path, PINNED_YT_DLP);
  if (!artifact.verified) {
    throw new Error("관리형 yt-dlp artifact가 없거나 검증에 실패했습니다.");
  }
  for (const [label, candidate] of [
    ["Python", config.python.path],
    ["ffmpeg", config.ffmpeg.path],
    ["ffprobe", config.ffprobe.path]
  ] as const) {
    if (!await executable(candidate)) {
      throw new Error(`${label} 실행 파일을 찾지 못했습니다. setup을 다시 실행하세요.`);
    }
  }
  if (!supportedVodNodeVersion(process.versions.node)) {
    throw new Error(`Node ${MINIMUM_VOD_NODE_VERSION} 이상이 필요합니다.`);
  }
  const notices = await inspectVodNotices(config);
  if (!notices.ready) {
    throw new Error(
      "설치된 오픈소스 고지가 현재 source와 일치하지 않습니다. setup을 다시 실행하세요."
    );
  }
  const toolchain = inspectVodToolchain(config);
  if (!toolchain.ready) {
    throw new Error(
      "Python→yt-dlp 또는 ffmpeg(libx264/AAC/mp4)·ffprobe 실제 실행 검증에 실패했습니다. setup을 다시 실행하세요."
    );
  }
  return config;
}

interface ChildOutcome {
  type: "exit" | "error";
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

function observeChild(child: ChildProcess): Promise<ChildOutcome> {
  return new Promise<ChildOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ChildOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(outcome);
    };
    child.once("error", (error) => finish({ type: "error", error }));
    child.once("exit", (code, signal) => finish({
      type: "exit",
      code,
      signal
    }));
  });
}

function childStoppedMessage(outcome: ChildOutcome): string {
  return outcome.type === "error"
    ? `gateway 프로세스 오류: ${errorMessage(outcome.error)}`
    : `gateway가 종료했습니다 (${outcome.code ?? outcome.signal ?? "unknown"}).`;
}

async function waitForGateway(
  config: LocalVodRuntimeConfig,
  {
    childOutcome,
    expectedInstanceNonce,
    expectedKind = "vod-only",
    timeoutMs = STARTUP_TIMEOUT_MS
  }: {
    childOutcome?: Promise<ChildOutcome>;
    expectedInstanceNonce?: string;
    expectedKind?: VodRuntimeKind;
    timeoutMs?: number;
  } = {}
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const probe = probeVodGateway(
      config,
      1_500,
      {
        ...(expectedInstanceNonce
          ? { instanceNonce: expectedInstanceNonce }
          : {}),
        kind: expectedKind
      }
    );
    const attempt = childOutcome
      ? await Promise.race([
        probe.then((ready) => ({ ready } as const)),
        childOutcome.then((outcome) => ({ outcome } as const))
      ])
      : { ready: await probe } as const;
    if ("outcome" in attempt) {
      throw new Error(
        `VOD manager가 gateway 준비 전에 ${childStoppedMessage(attempt.outcome)}`
      );
    }
    if (attempt.ready) {
      return;
    }
    if (childOutcome) {
      const pause = await Promise.race([
        new Promise<"retry">((resolve) => setTimeout(
          () => resolve("retry"),
          200
        )),
        childOutcome
      ]);
      if (pause !== "retry") {
        throw new Error(
          `VOD manager가 gateway 준비 전에 ${childStoppedMessage(pause)}`
        );
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("127.0.0.1:4319 VOD gateway 준비 시간이 초과되었습니다.");
}

async function terminateChild(
  child: ChildProcess,
  outcome: Promise<ChildOutcome>
): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill("SIGTERM");
  await outcome;
}

async function foregroundStart(
  paths: LocalVodRuntimePaths,
  config: LocalVodRuntimeConfig
): Promise<void> {
  let child: ChildProcess | null = null;
  let childOutcome: Promise<ChildOutcome> | null = null;
  let ownPid: VodRuntimePidRecord | null = null;
  let shutdownRequested = false;
  const requestShutdown = (): void => {
    if (shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    child?.kill("SIGTERM");
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  try {
    const existing = await verifiedVodRuntimePid(paths);
    if (existing) {
      throw new Error(`로컬 VOD runtime이 이미 실행 중입니다 (PID ${existing.pid}).`);
    }
    if (await probeVodGateway(config)) {
      throw new Error(
        "동일 Origin의 호환 gateway가 이미 실행 중이지만 이 runtime이 소유하지 않습니다."
      );
    }
    if (await probePort(config.gatewayPort)) {
      throw new Error("127.0.0.1:4319를 다른 프로세스가 사용 중입니다.");
    }
    if (shutdownRequested) {
      return;
    }
    ownPid = await claimPidFile(paths);
    await mkdir(config.vodStateDir, { recursive: true, mode: 0o700 });
    if (shutdownRequested) {
      return;
    }
    child = spawn(
      process.execPath,
      typescriptCommandArgs(gatewayPath),
      {
        cwd: packageRoot,
        env: managedVodRuntimeEnvironment(config, {
          baseEnvironment: process.env,
          nodeBinary: process.execPath,
          kind: "vod-only",
          instanceNonce: ownPid.instanceNonce
        }),
        stdio: "inherit",
        shell: false
      }
    );
    childOutcome = observeChild(child);
    if (shutdownRequested) {
      child.kill("SIGTERM");
    }
    try {
      await waitForGateway(config, {
        childOutcome,
        expectedInstanceNonce: ownPid.instanceNonce,
        expectedKind: "vod-only"
      });
    } catch (error) {
      if (shutdownRequested) {
        return;
      }
      throw error;
    }
    output(
      `로컬 VOD gateway ready · http://${VOD_LOOPBACK_HOST}:${config.gatewayPort}`
    );
    const result = await childOutcome;
    if (!shutdownRequested) {
      throw new Error(
        `VOD gateway가 예기치 않게 종료했습니다: ${childStoppedMessage(result)}`
      );
    }
  } finally {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    if (child && childOutcome) {
      await terminateChild(child, childOutcome);
    }
    if (ownPid) {
      await releaseOwnPidFile(paths, ownPid);
    }
  }
}

export async function setupVodRuntime(
  options: VodRuntimeOptions
): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("로컬 VOD runtime setup은 Linux만 지원합니다.");
  }
  const paths = runtimePaths();
  const tools = inspectRequiredTools();
  const studioOrigin = resolveKirinukiAppOrigin(
    process.env.KIRINUKI_ALLOWED_ORIGIN
  );
  const report = {
    mutation: !options.dryRun,
    artifact: {
      ...PINNED_YT_DLP,
      destination: paths.ytDlpPath
    },
    prerequisites: {
      node: tools.node,
      python: tools.python,
      ffmpeg: tools.ffmpeg,
      ffprobe: tools.ffprobe
    },
    configPath: paths.configPath,
    noticesPath: paths.noticesPath,
    vodStateDir: paths.vodStateDir,
    studioOrigin,
    gateway: `${VOD_LOOPBACK_HOST}:${DEFAULT_VOD_GATEWAY_PORT}`,
    secretsPersisted: false
  };
  if (options.dryRun) {
    output(JSON.stringify(report, null, 2));
    return;
  }
  await migrateLegacyVodConfigIfNeeded(paths);
  assertRequiredTools(tools);
  if (await verifiedVodRuntimePid(paths)) {
    throw new Error("실행 중인 로컬 VOD runtime을 먼저 stop 하세요.");
  }
  await mkdir(paths.dataRoot, { recursive: true, mode: 0o700 });
  await mkdir(paths.stateRoot, { recursive: true, mode: 0o700 });
  await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
  await mkdir(paths.vodStateDir, { recursive: true, mode: 0o700 });
  await downloadPinnedYtDlp(paths.ytDlpPath);
  const notices = await readFile(legalNoticesSource);
  const noticesManifest = {
    size: notices.byteLength,
    sha256: sha256Hex(notices)
  };
  await writeAtomic(paths.noticesPath, notices.toString("utf8"), 0o600);
  const config = createVodRuntimeConfig(paths, tools, {
    notices: noticesManifest,
    origin: studioOrigin
  });
  const toolchain = inspectVodToolchain(config);
  if (!toolchain.ready) {
    throw new Error(
      "설치된 exact Python→yt-dlp 또는 ffmpeg/libx264/AAC/mp4/ffprobe 검증에 실패했습니다."
    );
  }
  const noticesInspection = await inspectVodNotices(config);
  if (!noticesInspection.ready) {
    throw new Error("설치된 오픈소스 고지의 크기 또는 SHA-256이 source와 다릅니다.");
  }
  await writeAtomic(paths.configPath, secretFreeVodConfigJson(config), 0o600);
  const installed = await inspectArtifactFile(paths.ytDlpPath, PINNED_YT_DLP);
  if (!installed.verified) {
    throw new Error("설치 완료 검증에서 yt-dlp artifact가 일치하지 않았습니다.");
  }
  const result = {
    ...report,
    installed: true,
    mutation: true
  };
  if (options.json) {
    output(JSON.stringify(result, null, 2));
    return;
  }
  output(`yt-dlp ${PINNED_YT_DLP.version}: 크기+SHA-256 검증 완료`);
  output(`설정: ${paths.configPath}`);
  output(`라이선스 고지 복사본: ${paths.noticesPath}`);
  output("쿠키·로그인·API 키 저장: 없음");
}

export interface VodRuntimeStatusReport {
  runtime: {
    kind: "managed-local-vod-gateway";
    schema: "kirinuki-local-vod-runtime/v1";
  };
  configured: boolean;
  configError: string | null;
  packageRoot: string;
  origin: {
    configured: string | null;
    expected: string;
    matchesLocalStudio: boolean;
    matchesCurrentStudio: boolean;
  };
  ytDlp: {
    version: typeof PINNED_YT_DLP.version;
    path: string;
    ready: boolean;
    artifact: Readonly<ArtifactInspection>;
  };
  licenseNotices: {
    ready: boolean;
    source: Readonly<ArtifactInspection> | null;
    installed: Readonly<ArtifactInspection> | null;
  };
  toolchain: Readonly<VodToolchainInspection> | null;
  toolchainReady: boolean;
  mediaReady: boolean;
  gateway: boolean;
  gatewayPortOccupied: boolean;
  managed: boolean;
  managerPid: number | null;
  healthIdentity: {
    schema: "chzzk-kirinuki-caption-agent/health-v1";
    exactOriginAndManagedValidated: boolean;
    runtimeKindVersionExposedByGateway: boolean;
    runtime: Readonly<ManagedVodHealthIdentity> | null;
  };
}

export function vodRuntimeOriginMatchesRequestedStudio(
  config: Pick<LocalVodRuntimeConfig, "origin"> | null | undefined,
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    config
    && config.origin === resolveKirinukiAppOrigin(
      environment.KIRINUKI_ALLOWED_ORIGIN
    )
  );
}

export async function collectVodRuntimeStatus(
  environment: NodeJS.ProcessEnv = process.env
): Promise<VodRuntimeStatusReport> {
  const paths = runtimePaths();
  let config: Readonly<LocalVodRuntimeConfig> | null = null;
  let configError: string | null = null;
  try {
    config = await readVodRuntimeConfig(paths);
  } catch (error) {
    configError = errorMessage(error);
  }
  const artifact = await inspectArtifactFile(paths.ytDlpPath, PINNED_YT_DLP);
  const manager = await verifiedVodRuntimePid(paths);
  const health = config ? await probeVodGatewayHealth(config) : null;
  const gateway = Boolean(health);
  const gatewayPortOccupied = await probePort(DEFAULT_VOD_GATEWAY_PORT);
  const toolchain = config ? inspectVodToolchain(config) : null;
  const notices = config ? await inspectVodNotices(config) : null;
  const toolchainReady = Boolean(toolchain?.ready);
  const managed = vodGatewayOwnedByPid(health, manager);
  const expectedOrigin = resolveKirinukiAppOrigin(
    environment.KIRINUKI_ALLOWED_ORIGIN
  );
  const originMatchesCurrentStudio = vodRuntimeOriginMatchesRequestedStudio(
    config,
    environment
  );
  return {
    runtime: {
      kind: "managed-local-vod-gateway",
      schema: "kirinuki-local-vod-runtime/v1"
    },
    configured: Boolean(config),
    configError,
    packageRoot: paths.packageRoot,
    origin: {
      configured: config?.origin || null,
      expected: expectedOrigin,
      matchesLocalStudio: originMatchesCurrentStudio,
      matchesCurrentStudio: originMatchesCurrentStudio
    },
    ytDlp: {
      version: PINNED_YT_DLP.version,
      path: paths.ytDlpPath,
      ready: artifact.verified,
      artifact
    },
    licenseNotices: {
      ready: Boolean(notices?.ready),
      source: notices?.source || null,
      installed: notices?.installed || null
    },
    toolchain,
    toolchainReady,
    mediaReady: Boolean(
      config
      && artifact.verified
      && notices?.ready
      && toolchainReady
      && health?.ready
    ),
    gateway,
    gatewayPortOccupied,
    managed,
    managerPid: managed ? manager?.pid || null : null,
    healthIdentity: {
      schema: "chzzk-kirinuki-caption-agent/health-v1",
      exactOriginAndManagedValidated: gateway,
      runtimeKindVersionExposedByGateway: Boolean(health),
      runtime: health
    }
  };
}

export async function doctorVodRuntime(
  options: VodRuntimeOptions
): Promise<void> {
  const tools = inspectRequiredTools();
  const status = await collectVodRuntimeStatus();
  const report = {
    platform: {
      name: process.platform,
      supported: process.platform === "linux"
    },
    prerequisites: {
      node: {
        ...tools.node,
        supported: supportedVodNodeVersion(tools.node.version),
        minimum: MINIMUM_VOD_NODE_VERSION
      },
      python: {
        ...tools.python,
        supported: Boolean(
          tools.python && supportedVodPythonVersion(tools.python.version)
        ),
        minimum: MINIMUM_VOD_PYTHON_VERSION
      },
      ffmpeg: tools.ffmpeg,
      ffprobe: tools.ffprobe
    },
    pin: PINNED_YT_DLP,
    ...status,
    networkBinding: VOD_LOOPBACK_HOST,
    secretsPersisted: false
  };
  if (options.json) {
    output(JSON.stringify(report, null, 2));
    return;
  }
  output(`Linux: ${report.platform.supported ? "OK" : "지원 대상 아님"}`);
  output(
    `Node ${tools.node.version}: ${report.prerequisites.node.supported ? "OK" : `${MINIMUM_VOD_NODE_VERSION}+ 필요`}`
  );
  output(
    `Python: ${report.prerequisites.python.supported ? tools.python?.version : `${MINIMUM_VOD_PYTHON_VERSION}+ 필요`}`
  );
  output(`ffmpeg: ${tools.ffmpeg ? "OK" : "없음"}`);
  output(`ffprobe: ${tools.ffprobe ? "OK" : "없음"}`);
  output(`설정: ${status.configured ? "검증됨" : status.configError || "setup 필요"}`);
  output(`yt-dlp ${PINNED_YT_DLP.version}: ${status.ytDlp.ready ? "검증됨" : "setup 필요"}`);
  output(`오픈소스 고지 source/copy: ${status.licenseNotices.ready ? "검증됨" : "setup 필요"}`);
  output(`실제 미디어 toolchain: ${status.toolchainReady ? "검증됨" : "실패/setup 필요"}`);
  output(
    `gateway: ${status.gateway ? "ready" : status.gatewayPortOccupied ? "occupied/foreign" : "down"}`
  );
  output(`manager: ${status.managed ? `PID ${status.managerPid}` : "down/unowned"}`);
  output("쿠키·로그인·API 키 저장: 없음");
}

export async function statusVodRuntime(
  options: VodRuntimeOptions
): Promise<void> {
  const status = await collectVodRuntimeStatus();
  if (options.json) {
    output(JSON.stringify(status, null, 2));
    return;
  }
  output(`설정: ${status.configured ? "검증됨" : status.configError || "없음"}`);
  output(`Origin: ${status.origin.configured || "-"}`);
  output(`yt-dlp ${status.ytDlp.version}: ${status.ytDlp.ready ? "verified" : "missing/invalid"}`);
  output(`license notices: ${status.licenseNotices.ready ? "verified" : "missing/changed"}`);
  output(`toolchain probes: ${status.toolchainReady ? "ready" : "not-ready"}`);
  output(
    `gateway: ${status.gateway ? "ready" : status.gatewayPortOccupied ? "occupied/foreign" : "down"}`
  );
  output(`managed: ${status.managed ? `yes (PID ${status.managerPid})` : "no"}`);
  output(`media readiness: ${status.mediaReady ? "ready" : "not-ready"}`);
}

export async function startVodRuntime(
  options: VodRuntimeOptions
): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("로컬 VOD runtime start는 Linux만 지원합니다.");
  }
  const paths = runtimePaths();
  const config = await assertInstalledRuntime(paths);
  if (!vodRuntimeOriginMatchesRequestedStudio(config, process.env)) {
    throw new Error(
      "설치된 VOD runtime Origin이 현재 KIRINUKI_ALLOWED_ORIGIN과 다릅니다. setup을 다시 실행하세요."
    );
  }
  const existing = await verifiedVodRuntimePid(paths);
  if (existing) {
    if (await probeVodGateway(config, 1_500, {
      instanceNonce: existing.instanceNonce,
      kind: "vod-only"
    })) {
      const result = { started: false, alreadyRunning: true, pid: existing.pid };
      output(options.json ? JSON.stringify(result, null, 2) : `이미 실행 중입니다 (PID ${existing.pid}).`);
      return;
    }
    throw new Error(
      `검증된 manager PID ${existing.pid}와 gateway instance identity가 일치하지 않습니다. stop으로 복구하세요.`
    );
  }
  if (options.foreground) {
    await foregroundStart(paths, config);
    return;
  }
  if (await probeVodGateway(config)) {
    throw new Error(
      "호환 gateway가 이미 실행 중이지만 이 VOD runtime이 소유하지 않습니다."
    );
  }
  if (await probePort(config.gatewayPort)) {
    throw new Error("127.0.0.1:4319를 다른 프로세스가 사용 중입니다.");
  }
  await mkdir(paths.stateRoot, { recursive: true, mode: 0o700 });
  await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
  const logHandle = await open(paths.logPath, "a", 0o600);
  let child: ChildProcess;
  let childOutcome: Promise<ChildOutcome>;
  const instanceNonce = createVodInstanceNonce();
  try {
    child = spawn(
      process.execPath,
      typescriptCommandArgs(cliPath, "start", "--foreground"),
      {
        cwd: packageRoot,
        env: {
          ...vodManagerEnvironment(process.env, paths, { instanceNonce }),
          KIRINUKI_ALLOWED_ORIGIN: config.origin
        },
        detached: true,
        shell: false,
        stdio: ["ignore", logHandle.fd, logHandle.fd]
      }
    );
    childOutcome = observeChild(child);
    child.unref();
  } finally {
    await logHandle.close();
  }
  try {
    await waitForGateway(config, {
      childOutcome,
      expectedInstanceNonce: instanceNonce,
      expectedKind: "vod-only"
    });
  } catch (error) {
    const manager = await verifiedVodRuntimePid(paths);
    if (manager?.instanceNonce === instanceNonce) {
      process.kill(manager.pid, "SIGTERM");
    }
    throw error;
  }
  const manager = await verifiedVodRuntimePid(paths);
  if (!manager || manager.instanceNonce !== instanceNonce) {
    throw new Error("gateway는 응답하지만 검증된 manager identity가 없습니다.");
  }
  if (!await probeVodGateway(config, 1_500, {
    instanceNonce: manager.instanceNonce,
    kind: "vod-only"
  })) {
    throw new Error("manager PID와 gateway nonce/pin identity가 일치하지 않습니다.");
  }
  const result = {
    started: true,
    pid: manager.pid,
    gateway: `http://${VOD_LOOPBACK_HOST}:${config.gatewayPort}`,
    logPath: paths.logPath
  };
  output(options.json
    ? JSON.stringify(result, null, 2)
    : `로컬 VOD runtime 시작 완료 (PID ${manager.pid}) · 로그 ${paths.logPath}`);
}

async function quarantineStalePidFile(
  paths: LocalVodRuntimePaths
): Promise<string | null> {
  await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
  const mutationLock = await acquirePidMutationLock(paths);
  try {
    let first: string;
    try {
      first = await readFile(paths.pidPath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
    if (await verifiedVodRuntimePid(paths)) {
      throw new Error("PID 파일을 격리하기 전에 검증된 manager가 나타났습니다.");
    }
    if (await probePort(DEFAULT_VOD_GATEWAY_PORT)) {
      throw new Error(
        "gateway 포트가 사용 중이므로 검증되지 않은 PID 파일을 보존했습니다."
      );
    }
    const second = await readFile(paths.pidPath, "utf8").catch((error) => {
      if (hasErrorCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    });
    if (second === null) {
      return null;
    }
    if (second !== first) {
      throw new Error(
        "PID 파일이 확인 중 변경되어 격리하지 않았습니다. 다시 status/stop을 실행하세요."
      );
    }
    const timestamp = new Date().toISOString().replace(/[^0-9]/gu, "");
    const quarantinePath =
      `${paths.pidPath}.stale-${timestamp}-${randomBytes(8).toString("hex")}`;
    await rename(paths.pidPath, quarantinePath);
    const quarantined = await readFile(quarantinePath, "utf8");
    if (quarantined !== first) {
      throw new Error(
        `PID 파일 격리본이 예상과 다릅니다. 복구본을 보존했습니다: ${quarantinePath}`
      );
    }
    return quarantinePath;
  } finally {
    await releasePidMutationLock(mutationLock);
  }
}

async function waitUntilManagerStops(
  paths: LocalVodRuntimePaths,
  record: VodRuntimePidRecord,
  timeoutMs: number
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await verifiedVodRuntimePid(paths);
    if (!current || !samePidRecord(current, record)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function stopVodRuntime(
  options: VodRuntimeOptions
): Promise<void> {
  const paths = runtimePaths();
  const record = await verifiedVodRuntimePid(paths);
  if (!record) {
    const quarantinePath = await quarantineStalePidFile(paths);
    const result = {
      stopped: false,
      reason: "no-verified-managed-pid",
      stalePidQuarantined: Boolean(quarantinePath),
      quarantinePath
    };
    output(options.json
      ? JSON.stringify(result, null, 2)
      : quarantinePath
        ? `검증되지 않은 stale PID 파일만 보존 격리했습니다: ${quarantinePath}`
        : "검증된 관리형 VOD runtime을 찾지 못했습니다. 다른 프로세스는 종료하지 않았습니다.");
    return;
  }
  try {
    process.kill(record.pid, "SIGTERM");
  } catch (error) {
    if (!hasErrorCode(error, "ESRCH")) {
      throw error;
    }
  }
  const stopped = await waitUntilManagerStops(
    paths,
    record,
    SHUTDOWN_TIMEOUT_MS
  );
  if (!stopped) {
    throw new Error(
      "검증된 manager가 SIGTERM 제한 시간 안에 내려가지 않았습니다. 강제 종료하지 않았고 PID 복구 정보를 보존했습니다."
    );
  }
  await releaseOwnPidFile(paths, record);
  const result = { stopped: true, pid: record.pid };
  output(options.json
    ? JSON.stringify(result, null, 2)
    : `로컬 VOD runtime 중지 완료 (PID ${record.pid}).`);
}

export async function main(
  argv: readonly unknown[] = process.argv.slice(2)
): Promise<void> {
  const { command, options } = parseVodRuntimeArgs(argv);
  if (command === "help") {
    output(helpText());
    return;
  }
  if (command === "setup") {
    await setupVodRuntime(options);
    return;
  }
  if (command === "doctor") {
    await doctorVodRuntime(options);
    return;
  }
  if (command === "start") {
    await startVodRuntime(options);
    return;
  }
  if (command === "status") {
    await statusVodRuntime(options);
    return;
  }
  if (command === "stop") {
    await stopVodRuntime(options);
  }
}

function isMainModule(): boolean {
  return Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  main().catch((error) => {
    outputError(`로컬 VOD runtime 실패: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
