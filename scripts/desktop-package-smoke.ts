import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, connect } from "node:net";
import type { Server } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CAPTION_AGENT_REQUEST_SCHEMA_ID } from "../src/caption-agent/protocol.js";
import {
  DESKTOP_NATIVE_SMOKE_ARGUMENT,
  DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
  DESKTOP_NATIVE_SMOKE_ROOT_ENV,
  DESKTOP_NATIVE_SMOKE_ROOT_PREFIX,
  DESKTOP_NATIVE_SMOKE_TOKEN_ENV
} from "../src/desktop/native-smoke-contract.js";
import {
  DESKTOP_PACKAGED_TARGETS,
  DESKTOP_YT_DLP_RELEASE,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import {
  resolveDesktopBundledTools
} from "../src/desktop/runtime-spec.js";
import type {
  DesktopBundleTarget,
  DesktopPlatform
} from "../src/desktop/runtime-spec.js";
import {
  KIRINUKI_GATEWAY_ORIGIN_BINDING,
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  CAPTION_AGENT_HEALTH_SCHEMA_ID,
  DEFAULT_CAPTION_GATEWAY_PORT
} from "./caption-gateway.js";
import {
  externalPublishedArtifactInspectionBinding,
  inspectExternalMp4,
  runExternalProcess,
  terminateWindowsExternalProcessTree
} from "./external-vod-materializer.js";
import {
  DEFAULT_STUDIO_PORT,
  LOCAL_STUDIO_HEALTH_SCHEMA,
  LOCAL_STUDIO_SERVER_SCHEMA
} from "./local-studio-server-core.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const APP_START_TIMEOUT_MS = 60_000;
const APP_QUIT_TIMEOUT_MS = 30_000;
const IPC_SEND_TIMEOUT_MS = 5_000;
const PROCESS_RECLAIM_TIMEOUT_MS = 15_000;
const PROCESS_GROUP_RECLAIM_TIMEOUT_MS = 5_000;
const PROCESS_GROUP_TERM_GRACE_MS = 2_000;
const WINDOWS_TASKKILL_TIMEOUT_MS = 5_000;
const HTTP_REQUEST_TIMEOUT_MS = 2_000;
const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;
const MAX_APP_OUTPUT_BYTES = 512 * 1024;
const TOOL_TIMEOUT_MS = 30_000;
const PORTS = Object.freeze([
  DEFAULT_CAPTION_GATEWAY_PORT,
  DEFAULT_STUDIO_PORT
]);

export interface ProcessIdentity {
  readonly pid: number;
  readonly parentPid: number;
  readonly started: string;
}

interface AppOutput {
  stdout: string;
  stderr: string;
  overflow: boolean;
}

interface AppExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

class HttpResponseError extends Error {}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 1_000);
}

export function isDesktopPackageSmokeEntrypoint({
  invokedPath,
  modulePath,
  platform = process.platform
}: {
  readonly invokedPath: unknown;
  readonly modulePath: string;
  readonly platform?: NodeJS.Platform;
}): boolean {
  if (
    typeof invokedPath !== "string"
    || invokedPath.length === 0
    || typeof modulePath !== "string"
    || modulePath.length === 0
  ) {
    return false;
  }
  const comparisonKey = (value: string) => {
    const resolved = path.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return comparisonKey(invokedPath) === comparisonKey(modulePath);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 시간 제한을 초과했습니다.`)),
          milliseconds
        );
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function currentTarget(): DesktopBundleTarget {
  const target = `${process.platform}-${process.arch}`;
  if (!(DESKTOP_PACKAGED_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`현재 native smoke 대상이 지원되지 않습니다: ${target}`);
  }
  return target as DesktopBundleTarget;
}

function packagePaths(target: DesktopBundleTarget): Readonly<{
  packageRoot: string;
  executable: string;
  resourcesRoot: string;
}> {
  const packageRoot = path.join(
    repositoryRoot,
    "dist",
    "desktop",
    target,
    `Kirinuki-${target}`
  );
  if (process.platform === "darwin") {
    return Object.freeze({
      packageRoot,
      executable: path.join(
        packageRoot,
        "Kirinuki.app",
        "Contents",
        "MacOS",
        "Kirinuki"
      ),
      resourcesRoot: path.join(
        packageRoot,
        "Kirinuki.app",
        "Contents",
        "Resources"
      )
    });
  }
  return Object.freeze({
    packageRoot,
    executable: path.join(
      packageRoot,
      process.platform === "win32" ? "Kirinuki.exe" : "Kirinuki"
    ),
    resourcesRoot: path.join(packageRoot, "resources")
  });
}

async function assertRegularPath(
  filePath: string,
  type: "file" | "directory",
  label: string,
  executable = false
): Promise<void> {
  const metadata = await lstat(filePath);
  invariant(!metadata.isSymbolicLink(), `${label}가 symbolic link입니다.`);
  invariant(
    type === "file" ? metadata.isFile() : metadata.isDirectory(),
    `${label} 형식이 올바르지 않습니다.`
  );
  if (executable && process.platform !== "win32") {
    invariant((metadata.mode & 0o111) !== 0, `${label} 실행 권한이 없습니다.`);
  }
}

function minimalToolEnvironment(toolsRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NO_COLOR: "1",
    PATH: toolsRoot
  };
  for (const key of [
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR"
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

async function runTool(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const result = await runExternalProcess(command, args, {
    cwd,
    env,
    shell: false,
    timeoutMs: TOOL_TIMEOUT_MS
  });
  invariant(
    result.exitCode === 0,
    `번들 도구가 실패했습니다: ${path.basename(command)} (${result.exitCode})`
  );
  return Object.freeze({ stdout: result.stdout, stderr: result.stderr });
}

export function matchesExactDesktopToolVersion(
  stdout: string,
  tool: "ffmpeg" | "ffprobe",
  expectedVersion: string
): boolean {
  const [firstLine = ""] = stdout.split(/\r?\n/u, 1);
  const match = /^(ffmpeg|ffprobe) version ([^\s]+)(?:[ \t].*)?$/u.exec(firstLine);
  return match?.[1] === tool && match[2] === expectedVersion;
}

function parseTopLevelMp4Boxes(bytes: Buffer): readonly string[] {
  const boxes: string[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    invariant(bytes.byteLength - offset >= 8, "MP4 box header가 잘렸습니다.");
    const size32 = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    invariant(/^[\x20-\x7e]{4}$/u.test(type), "MP4 box type이 올바르지 않습니다.");
    let boxSize: number;
    let headerSize = 8;
    if (size32 === 1) {
      invariant(bytes.byteLength - offset >= 16, "MP4 large box header가 잘렸습니다.");
      const size64 = bytes.readBigUInt64BE(offset + 8);
      invariant(size64 <= BigInt(Number.MAX_SAFE_INTEGER), "MP4 box가 너무 큽니다.");
      boxSize = Number(size64);
      headerSize = 16;
    } else {
      boxSize = size32 === 0 ? bytes.byteLength - offset : size32;
    }
    invariant(boxSize >= headerSize, "MP4 box 크기가 올바르지 않습니다.");
    invariant(offset + boxSize <= bytes.byteLength, "MP4 box가 파일 경계를 벗어났습니다.");
    boxes.push(type);
    offset += boxSize;
  }
  invariant(offset === bytes.byteLength, "MP4 box 경계가 파일 끝과 다릅니다.");
  return Object.freeze(boxes);
}

async function verifyPackagedTools(
  resourcesRoot: string,
  target: DesktopBundleTarget,
  smokeRoot: string
): Promise<void> {
  const [platform, arch] = target.split("-") as [DesktopPlatform, "x64" | "arm64"];
  const manifest = desktopToolTargetManifest(target);
  const tools = resolveDesktopBundledTools({ platform, arch, resourcesRoot });
  await Promise.all([
    assertRegularPath(tools.ffmpeg.command, "file", "packaged ffmpeg", true),
    assertRegularPath(tools.ffprobe.command, "file", "packaged ffprobe", true),
    assertRegularPath(tools.ytDlp.command, "file", "packaged yt-dlp", true)
  ]);
  const environment = minimalToolEnvironment(tools.toolsRoot);
  const [ffmpegVersion, ffprobeVersion, ytDlpVersion] = await Promise.all([
    runTool(tools.ffmpeg.command, ["-version"], smokeRoot, environment),
    runTool(tools.ffprobe.command, ["-version"], smokeRoot, environment),
    runTool(tools.ytDlp.command, ["--version"], smokeRoot, environment)
  ]);
  invariant(
    matchesExactDesktopToolVersion(
      ffmpegVersion.stdout,
      "ffmpeg",
      manifest.ffmpegVersion
    ),
    "packaged ffmpeg version이 manifest와 다릅니다."
  );
  invariant(
    matchesExactDesktopToolVersion(
      ffprobeVersion.stdout,
      "ffprobe",
      manifest.ffprobeVersion
    ),
    "packaged ffprobe version이 manifest와 다릅니다."
  );
  invariant(
    ytDlpVersion.stdout.trim() === DESKTOP_YT_DLP_RELEASE.version,
    "packaged yt-dlp version이 manifest와 다릅니다."
  );

  const mediaPath = path.join(smokeRoot, "tiny-faststart.mp4");
  await runTool(tools.ffmpeg.command, [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "lavfi", "-i", "color=c=black:s=160x90:r=30:d=0.5",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=0.5",
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "baseline",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k",
    "-shortest", "-movflags", "+faststart", "-n", mediaPath
  ], smokeRoot, environment);
  await assertRegularPath(mediaPath, "file", "native smoke MP4");
  const boxes = parseTopLevelMp4Boxes(await readFile(mediaPath));
  const moovIndex = boxes.indexOf("moov");
  const mdatIndex = boxes.indexOf("mdat");
  invariant(moovIndex >= 0 && mdatIndex >= 0, "native smoke MP4 box가 불완전합니다.");
  invariant(moovIndex < mdatIndex, "native smoke MP4가 faststart가 아닙니다.");

  const handle = await open(
    mediaPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const binding = externalPublishedArtifactInspectionBinding({
      platform: process.platform,
      processId: process.pid,
      fileDescriptor: handle.fd
    });
    const inspection = await inspectExternalMp4(binding.inputPath, {
      cwd: smokeRoot,
      env: environment,
      shell: false,
      ...(binding.inheritedInputFileDescriptor === undefined
        ? {}
        : { inheritedInputFileDescriptor: binding.inheritedInputFileDescriptor })
    }, { ffprobeBinary: tools.ffprobe.command });
    invariant(inspection.videoCodec === "h264", "fd-bound MP4 video codec이 H.264가 아닙니다.");
    invariant(inspection.audioCodec === "aac", "fd-bound MP4 audio codec이 AAC가 아닙니다.");
    invariant(inspection.width === 160 && inspection.height === 90, "fd-bound MP4 크기가 다릅니다.");
    invariant(Math.abs(inspection.frameRate - 30) < 0.01, "fd-bound MP4 frame rate가 다릅니다.");
    invariant(
      inspection.durationMs >= 450 && inspection.durationMs <= 650,
      "fd-bound MP4 duration이 예상 범위를 벗어났습니다."
    );
  } finally {
    await handle.close();
  }
}

async function bindAllPorts(): Promise<void> {
  const servers: Server[] = [];
  try {
    for (const port of PORTS) {
      const server = createServer();
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({ host: "127.0.0.1", port, exclusive: true });
      });
    }
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    })));
  }
}

async function assertConnectionRefused(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`port ${port} 연결이 거절되지 않았습니다.`));
    }, HTTP_REQUEST_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`port ${port}가 앱 종료 뒤에도 열려 있습니다.`));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      if (error.code === "ECONNREFUSED") {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function requestJson(
  port: number,
  requestPath: string,
  headers: Readonly<Record<string, string>> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method: "GET",
      agent: false,
      headers: { Connection: "close", ...headers }
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_HTTP_RESPONSE_BYTES) {
          response.destroy(new HttpResponseError("health 응답이 너무 큽니다."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        if (response.statusCode !== 200) {
          reject(new HttpResponseError(`health HTTP status=${response.statusCode ?? -1}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(new HttpResponseError("health JSON을 해석하지 못했습니다.", { cause: error }));
        }
      });
    });
    request.once("error", reject);
    request.setTimeout(HTTP_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("health 요청 시간 제한을 초과했습니다."));
    });
    request.end();
  });
}

async function waitForHealth(
  label: string,
  probe: () => Promise<unknown>,
  validate: (payload: unknown) => void
): Promise<void> {
  const deadline = Date.now() + APP_START_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    let payload: unknown;
    try {
      payload = await probe();
    } catch (error) {
      if (error instanceof HttpResponseError) {
        throw error;
      }
      lastError = error;
      await delay(100);
      continue;
    }
    validate(payload);
    return;
  }
  throw new Error(`${label}가 준비되지 않았습니다: ${safeError(lastError)}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${label}가 객체가 아닙니다.`);
  return value as Record<string, unknown>;
}

function validateStudioHealth(payloadValue: unknown): void {
  const payload = record(payloadValue, "studio health");
  const server = record(payload.server, "studio server health");
  invariant(payload.schema === LOCAL_STUDIO_HEALTH_SCHEMA, "studio health schema가 다릅니다.");
  invariant(payload.status === "ok" && payload.managed === true, "studio health 상태가 다릅니다.");
  invariant(server.schema === LOCAL_STUDIO_SERVER_SCHEMA, "studio server schema가 다릅니다.");
  invariant(server.host === "127.0.0.1" && server.port === DEFAULT_STUDIO_PORT, "studio binding이 다릅니다.");
  invariant(server.studioOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN, "studio origin이 다릅니다.");
  invariant(typeof server.instanceNonce === "string" && /^[A-Za-z0-9_-]{43}$/u.test(server.instanceNonce), "studio nonce가 다릅니다.");
}

function validateGatewayHealth(payloadValue: unknown): void {
  const payload = record(payloadValue, "gateway health");
  const vodRuntime = record(payload.vodRuntime, "gateway VOD runtime");
  const ytDlp = record(vodRuntime.ytDlp, "gateway yt-dlp identity");
  invariant(payload.schema === CAPTION_AGENT_HEALTH_SCHEMA_ID, "gateway health schema가 다릅니다.");
  invariant(payload.status === "ok" && payload.managed === true, "gateway health 상태가 다릅니다.");
  invariant(payload.originBinding === KIRINUKI_GATEWAY_ORIGIN_BINDING, "gateway origin binding이 다릅니다.");
  invariant(vodRuntime.kind === "vod-only" && vodRuntime.ready === true, "gateway VOD runtime이 준비되지 않았습니다.");
  invariant(ytDlp.version === DESKTOP_YT_DLP_RELEASE.version, "gateway yt-dlp identity가 다릅니다.");
}

function processEnvironment(smokeRoot: string, token: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "NODE_CHANNEL_FD",
    "NODE_INSPECT_RESUME_ON_START",
    "NODE_OPTIONS"
  ]) {
    delete environment[key];
  }
  environment[DESKTOP_NATIVE_SMOKE_ROOT_ENV] = smokeRoot;
  environment[DESKTOP_NATIVE_SMOKE_TOKEN_ENV] = token;
  if (process.platform !== "win32") {
    environment.XDG_CONFIG_HOME = path.join(smokeRoot, "xdg-config");
    environment.XDG_CACHE_HOME = path.join(smokeRoot, "xdg-cache");
    environment.XDG_DATA_HOME = path.join(smokeRoot, "xdg-data");
    environment.XDG_STATE_HOME = path.join(smokeRoot, "xdg-state");
    environment.XDG_RUNTIME_DIR = path.join(smokeRoot, "xdg-runtime");
  }
  return environment;
}

function captureAppOutput(child: ChildProcess): AppOutput {
  const output: AppOutput = { stdout: "", stderr: "", overflow: false };
  const capture = (key: "stdout" | "stderr") => (chunk: Buffer) => {
    const current = output[key];
    if (Buffer.byteLength(current, "utf8") >= MAX_APP_OUTPUT_BYTES) {
      output.overflow = true;
      return;
    }
    const next = current + chunk.toString("utf8");
    if (Buffer.byteLength(next, "utf8") > MAX_APP_OUTPUT_BYTES) {
      output[key] = Buffer.from(next, "utf8").subarray(0, MAX_APP_OUTPUT_BYTES).toString("utf8");
      output.overflow = true;
    } else {
      output[key] = next;
    }
  };
  child.stdout?.on("data", capture("stdout"));
  child.stderr?.on("data", capture("stderr"));
  return output;
}

function appCompletion(child: ChildProcess): Promise<AppExit> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function isReadyMessage(value: unknown, token: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return Object.keys(message).sort().join(",") === "schema,token,type"
    && message.schema === DESKTOP_NATIVE_SMOKE_IPC_SCHEMA
    && message.type === "ready"
    && message.token === token;
}

function waitForReady(
  child: ChildProcess,
  completion: Promise<AppExit>,
  token: string
): Promise<void> {
  return withTimeout(new Promise<void>((resolve, reject) => {
    const onMessage = (message: unknown) => {
      cleanup();
      if (isReadyMessage(message, token)) {
        resolve();
      } else {
        reject(new Error("packaged app READY IPC가 정확하지 않습니다."));
      }
    };
    const cleanup = () => child.removeListener("message", onMessage);
    child.on("message", onMessage);
    void completion.then((result) => {
      cleanup();
      reject(new Error(
        `packaged app이 READY 전에 종료됐습니다: code=${result.code}, signal=${result.signal ?? "none"}`
      ));
    }, reject);
  }), APP_START_TIMEOUT_MS, "packaged app READY");
}

async function sendQuit(child: ChildProcess, token: string): Promise<void> {
  invariant(child.connected, "packaged app IPC가 종료 전에 닫혔습니다.");
  await withTimeout(new Promise<void>((resolve, reject) => {
    child.send({
      schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
      type: "quit",
      token
    }, (error) => error ? reject(error) : resolve());
  }), IPC_SEND_TIMEOUT_MS, "packaged app quit IPC");
}

async function processSnapshot(
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<ReadonlyMap<number, Readonly<ProcessIdentity>>> {
  let command: string;
  let args: readonly string[];
  if (process.platform === "win32") {
    const systemRoot = String(process.env.SystemRoot || process.env.SYSTEMROOT || "");
    invariant(path.win32.isAbsolute(systemRoot), "Windows SystemRoot를 확인하지 못했습니다.");
    command = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    args = [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { [Console]::Out.WriteLine(('{0},{1},{2}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToUniversalTime().Ticks)) }"
    ];
  } else {
    command = "/bin/ps";
    args = ["-axo", "pid=,ppid=,lstart="];
  }
  const result = await runTool(command, args, cwd, env);
  const records = new Map<number, Readonly<ProcessIdentity>>();
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = process.platform === "win32"
      ? /^(\d+),(\d+),(.+)$/u.exec(line.trim())
      : /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const started = String(match[3] || "").trim();
    if (Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parentPid) && parentPid >= 0 && started) {
      records.set(pid, Object.freeze({ pid, parentPid, started }));
    }
  }
  invariant(records.size > 0, "운영체제 process snapshot을 읽지 못했습니다.");
  return records;
}

function descendants(
  snapshot: ReadonlyMap<number, Readonly<ProcessIdentity>>,
  rootPid: number
): readonly Readonly<ProcessIdentity>[] {
  const selected = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshot.values()) {
      if (!selected.has(entry.pid) && selected.has(entry.parentPid)) {
        selected.add(entry.pid);
        changed = true;
      }
    }
  }
  return Object.freeze([...selected].map((pid) => snapshot.get(pid)).filter(
    (entry): entry is Readonly<ProcessIdentity> => entry !== undefined
  ));
}

async function assertProcessesReclaimed(
  captured: readonly Readonly<ProcessIdentity>[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const deadline = Date.now() + PROCESS_RECLAIM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await processSnapshot(cwd, env);
    const survivors = captured.filter((entry) => current.get(entry.pid)?.started === entry.started);
    if (survivors.length === 0) {
      return;
    }
    await delay(200);
  }
  throw new Error("packaged app descendant process가 종료 뒤 남았습니다.");
}

function posixProcessGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw error;
  }
}

async function posixRootIdentityIsStillSafe(
  capturedRoot: Readonly<ProcessIdentity>,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const current = await processSnapshot(cwd, env);
  const currentRoot = current.get(capturedRoot.pid);
  return currentRoot === undefined || currentRoot.started === capturedRoot.started;
}

async function waitForPosixProcessGroupReclaimed(
  capturedRoot: Readonly<ProcessIdentity>,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!posixProcessGroupExists(capturedRoot.pid)) {
      return true;
    }
    await delay(100);
  }
  if (!posixProcessGroupExists(capturedRoot.pid)) {
    return true;
  }
  if (!await posixRootIdentityIsStillSafe(capturedRoot, cwd, env)) {
    throw new Error(
      "packaged app PID가 재사용돼 원래 process group 소멸을 안전하게 확인할 수 없습니다."
    );
  }
  return false;
}

async function assertPosixProcessGroupReclaimed(
  capturedRoot: Readonly<ProcessIdentity>,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (!await waitForPosixProcessGroupReclaimed(
    capturedRoot,
    cwd,
    env,
    PROCESS_GROUP_RECLAIM_TIMEOUT_MS
  )) {
    throw new Error("packaged app POSIX process group가 종료 뒤 남았습니다.");
  }
}

export async function reclaimCapturedWindowsProcessIdentities(
  captured: readonly Readonly<ProcessIdentity>[],
  {
    snapshotImpl,
    terminateProcessTreeImpl
  }: {
    readonly snapshotImpl: () => Promise<
      ReadonlyMap<number, Readonly<ProcessIdentity>>
    >;
    readonly terminateProcessTreeImpl: (
      processId: number,
      confirmTargetIdentity: () => Promise<boolean>
    ) => Promise<void>;
  }
): Promise<void> {
  const identities = new Map<number, Readonly<ProcessIdentity>>();
  for (const entry of captured) {
    invariant(
      Number.isSafeInteger(entry.pid)
        && entry.pid > 0
        && Number.isSafeInteger(entry.parentPid)
        && entry.parentPid >= 0
        && entry.started.length > 0,
      "captured Windows process identity가 올바르지 않습니다."
    );
    invariant(
      !identities.has(entry.pid),
      `captured Windows process PID가 중복됐습니다: ${entry.pid}`
    );
    identities.set(entry.pid, entry);
  }
  const errors: Error[] = [];
  const isExactCurrentIdentity = async (
    expected: Readonly<ProcessIdentity>
  ): Promise<boolean> => {
    const current = (await snapshotImpl()).get(expected.pid);
    return current?.started === expected.started;
  };
  for (const expected of identities.values()) {
    let stillOwned = false;
    try {
      stillOwned = await isExactCurrentIdentity(expected);
    } catch (error) {
      errors.push(error instanceof Error
        ? error
        : new Error("Windows process identity snapshot을 읽지 못했습니다."));
      continue;
    }
    if (!stillOwned) {
      continue;
    }
    try {
      await terminateProcessTreeImpl(
        expected.pid,
        async () => await isExactCurrentIdentity(expected)
      );
    } catch (error) {
      errors.push(error instanceof Error
        ? error
        : new Error(`Windows captured process ${expected.pid} 종료에 실패했습니다.`));
    }
  }
  try {
    const finalSnapshot = await snapshotImpl();
    const survivors = [...identities.values()].filter((expected) => (
      finalSnapshot.get(expected.pid)?.started === expected.started
    ));
    if (survivors.length > 0) {
      errors.push(new Error(
        `Windows captured process가 정리 뒤 남았습니다: ${survivors
          .map(({ pid }) => pid)
          .join(", ")}`
      ));
    }
  } catch (error) {
    errors.push(error instanceof Error
      ? error
      : new Error("Windows cleanup 최종 process snapshot을 읽지 못했습니다."));
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Windows packaged app process cleanup을 완전히 증명하지 못했습니다."
    );
  }
}

async function terminateCapturedWindowsProcesses(
  captured: readonly Readonly<ProcessIdentity>[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await reclaimCapturedWindowsProcessIdentities(captured, {
    snapshotImpl: async () => await processSnapshot(cwd, env),
    terminateProcessTreeImpl: async (processId, confirmTargetIdentity) => {
      await terminateWindowsExternalProcessTree(processId, {
        timeoutMs: WINDOWS_TASKKILL_TIMEOUT_MS,
        confirmTargetIdentityImpl: confirmTargetIdentity
      });
    }
  });
}

function isMissingProcessError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ESRCH"
  );
}

export async function terminateOwnedPosixProcessGroup({
  processGroupExistsImpl,
  rootIdentityIsStillSafeImpl,
  signalProcessGroupImpl,
  waitForProcessGroupReclaimedImpl,
  termGraceMs = PROCESS_GROUP_TERM_GRACE_MS,
  reclaimTimeoutMs = PROCESS_GROUP_RECLAIM_TIMEOUT_MS
}: {
  readonly processGroupExistsImpl: () => boolean;
  readonly rootIdentityIsStillSafeImpl: () => Promise<boolean>;
  readonly signalProcessGroupImpl: (signal: "SIGTERM" | "SIGKILL") => void;
  readonly waitForProcessGroupReclaimedImpl: (
    timeoutMs: number
  ) => Promise<boolean>;
  readonly termGraceMs?: number;
  readonly reclaimTimeoutMs?: number;
}): Promise<void> {
  invariant(
    Number.isSafeInteger(termGraceMs) && termGraceMs >= 0,
    "packaged app POSIX TERM grace가 올바르지 않습니다."
  );
  invariant(
    Number.isSafeInteger(reclaimTimeoutMs) && reclaimTimeoutMs >= 0,
    "packaged app POSIX reclaim timeout이 올바르지 않습니다."
  );
  if (!processGroupExistsImpl()) {
    return;
  }
  if (!await rootIdentityIsStillSafeImpl()) {
    return;
  }
  try {
    signalProcessGroupImpl("SIGTERM");
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }
    throw error;
  }
  if (await waitForProcessGroupReclaimedImpl(termGraceMs)) {
    return;
  }
  if (!await rootIdentityIsStillSafeImpl()) {
    return;
  }
  try {
    signalProcessGroupImpl("SIGKILL");
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }
    throw error;
  }
  if (!await waitForProcessGroupReclaimedImpl(reclaimTimeoutMs)) {
    throw new Error(
      "packaged app POSIX process group가 SIGKILL 뒤에도 남았습니다."
    );
  }
}

async function terminateOwnedAppTree(
  child: ChildProcess,
  capturedRoot: Readonly<ProcessIdentity> | undefined,
  capturedProcesses: readonly Readonly<ProcessIdentity>[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    if (capturedProcesses.length > 0) {
      await terminateCapturedWindowsProcesses(capturedProcesses, cwd, env);
      return;
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      throw new Error(
        "Windows packaged app의 시작 identity를 캡처하지 못해 descendant cleanup을 증명할 수 없습니다."
      );
    }
    return;
  }
  if (!capturedRoot) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The owned process group already exited.
      }
    }
    return;
  }
  await terminateOwnedPosixProcessGroup({
    processGroupExistsImpl: () => posixProcessGroupExists(pid),
    rootIdentityIsStillSafeImpl: async () => (
      await posixRootIdentityIsStillSafe(capturedRoot, cwd, env)
    ),
    signalProcessGroupImpl: (signal) => process.kill(-pid, signal),
    waitForProcessGroupReclaimedImpl: async (timeoutMs) => (
      await waitForPosixProcessGroupReclaimed(
        capturedRoot,
        cwd,
        env,
        timeoutMs
      )
    )
  });
}

async function runNativePackageSmoke(): Promise<void> {
  const target = currentTarget();
  const paths = packagePaths(target);
  await Promise.all([
    assertRegularPath(paths.packageRoot, "directory", "desktop package root"),
    assertRegularPath(paths.resourcesRoot, "directory", "desktop resources root"),
    assertRegularPath(paths.executable, "file", "desktop executable", true)
  ]);
  await bindAllPorts();
  const smokeRoot = await mkdtemp(path.join(os.tmpdir(), DESKTOP_NATIVE_SMOKE_ROOT_PREFIX));
  const token = randomBytes(32).toString("base64url");
  let appChild: ChildProcess | undefined;
  let appRootIdentity: Readonly<ProcessIdentity> | undefined;
  let capturedProcesses: readonly Readonly<ProcessIdentity>[] = [];
  let output: AppOutput | undefined;
  let smokeFailure: Error | undefined;
  const snapshotEnvironment = minimalToolEnvironment(paths.packageRoot);
  try {
    await Promise.all([
      "xdg-config",
      "xdg-cache",
      "xdg-data",
      "xdg-state",
      "xdg-runtime"
    ].map((directory) => mkdir(path.join(smokeRoot, directory), {
      recursive: false,
      mode: 0o700
    })));
    await verifyPackagedTools(paths.resourcesRoot, target, smokeRoot);
    const childEnvironment = processEnvironment(smokeRoot, token);
    appChild = spawn(paths.executable, [DESKTOP_NATIVE_SMOKE_ARGUMENT], {
      cwd: paths.packageRoot,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      shell: false,
      ...(process.platform === "win32" ? {} : { detached: true })
    });
    output = captureAppOutput(appChild);
    const completion = appCompletion(appChild);
    await withTimeout(new Promise<void>((resolve, reject) => {
      appChild?.once("spawn", resolve);
      appChild?.once("error", reject);
    }), 10_000, "packaged app spawn");
    invariant(appChild.pid !== undefined && appChild.pid > 0, "packaged app PID가 없습니다.");
    const launchSnapshot = await processSnapshot(smokeRoot, snapshotEnvironment);
    appRootIdentity = launchSnapshot.get(appChild.pid);
    invariant(appRootIdentity !== undefined, "packaged app launch identity를 찾지 못했습니다.");
    capturedProcesses = Object.freeze([appRootIdentity]);
    await Promise.all([
      waitForReady(appChild, completion, token),
      waitForHealth(
        "studio health",
        () => requestJson(DEFAULT_STUDIO_PORT, "/v1/studio/health"),
        validateStudioHealth
      ),
      waitForHealth(
        "gateway health",
        () => requestJson(DEFAULT_CAPTION_GATEWAY_PORT, "/v1/health", {
          Origin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
          "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA_ID
        }),
        validateGatewayHealth
      )
    ]);
    invariant(!output.overflow, "packaged app stdout/stderr 상한을 초과했습니다.");
    const snapshot = await processSnapshot(smokeRoot, snapshotEnvironment);
    capturedProcesses = descendants(snapshot, appChild.pid);
    invariant(capturedProcesses.some((entry) => entry.pid === appChild?.pid), "packaged app process identity를 찾지 못했습니다.");
    const capturedRoot = snapshot.get(appChild.pid);
    invariant(capturedRoot !== undefined, "packaged app root process identity를 찾지 못했습니다.");
    if (appRootIdentity && capturedRoot.started !== appRootIdentity.started) {
      throw new Error("packaged app root process identity가 실행 중 바뀌었습니다.");
    }
    appRootIdentity = capturedRoot;
    invariant(capturedProcesses.length > 1, "packaged app child process가 시작되지 않았습니다.");
    await sendQuit(appChild, token);
    const exit = await withTimeout(completion, APP_QUIT_TIMEOUT_MS, "packaged app graceful quit");
    invariant(exit.code === 0 && exit.signal === null, `packaged app 종료 상태가 다릅니다: code=${exit.code}, signal=${exit.signal ?? "none"}`);
    await assertProcessesReclaimed(capturedProcesses, smokeRoot, snapshotEnvironment);
    if (process.platform !== "win32") {
      await assertPosixProcessGroupReclaimed(
        capturedRoot,
        smokeRoot,
        snapshotEnvironment
      );
    }
    await Promise.all(PORTS.map(assertConnectionRefused));
    await bindAllPorts();
    console.log(JSON.stringify({
      schema: "kirinuki-desktop-package-smoke/v1",
      status: "ok",
      target,
      tools: {
        ffmpeg: desktopToolTargetManifest(target).ffmpegVersion,
        ffprobe: desktopToolTargetManifest(target).ffprobeVersion,
        ytDlp: DESKTOP_YT_DLP_RELEASE.version
      },
      fdBinding: process.platform === "linux"
        ? `/proc/${process.pid}/fd/<fd>`
        : process.platform === "darwin"
          ? "/dev/fd/3"
          : "pipe:3",
      reclaimedProcesses: capturedProcesses.length,
      reclaimedPorts: PORTS
    }, null, 2));
  } catch (error) {
    const details = output
      ? `\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`
      : "";
    smokeFailure = new Error(`native desktop package smoke 실패: ${safeError(error)}${details}`, {
      cause: error
    });
  } finally {
    const cleanupErrors: Error[] = [];
    if (appChild) {
      try {
        await terminateOwnedAppTree(
          appChild,
          appRootIdentity,
          capturedProcesses,
          smokeRoot,
          snapshotEnvironment
        );
      } catch (error) {
        cleanupErrors.push(error instanceof Error
          ? error
          : new Error("packaged app process cleanup이 실패했습니다."));
      }
    }
    try {
      await rm(smokeRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error instanceof Error
        ? error
        : new Error("native smoke 임시 폴더 cleanup이 실패했습니다."));
    }
    if (cleanupErrors.length > 0) {
      const cleanupFailure = new AggregateError(
        cleanupErrors,
        "native desktop package smoke cleanup을 완전히 증명하지 못했습니다."
      );
      if (smokeFailure) {
        const originalFailure = smokeFailure;
        smokeFailure = new AggregateError(
          [originalFailure, cleanupFailure],
          "native desktop package smoke와 failure cleanup이 모두 실패했습니다."
        );
        Object.defineProperty(smokeFailure, "cause", {
          configurable: true,
          value: originalFailure
        });
      } else {
        smokeFailure = cleanupFailure;
      }
    }
  }
  if (smokeFailure) {
    throw smokeFailure;
  }
}

const invokedPath = process.argv[1];
if (isDesktopPackageSmokeEntrypoint({
  invokedPath,
  modulePath: fileURLToPath(import.meta.url)
})) {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: desktop-package-smoke.ts");
  }
  await runNativePackageSmoke();
}
