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

import {
  DESKTOP_NATIVE_SMOKE_ARGUMENT,
  DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV,
  DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
  DESKTOP_NATIVE_SMOKE_ROOT_ENV,
  DESKTOP_NATIVE_SMOKE_ROOT_PREFIX,
  DESKTOP_NATIVE_SMOKE_TOKEN_ENV,
  DESKTOP_NATIVE_SMOKE_USER_DATA_DIRECTORY
} from "../src/desktop/native-smoke-contract.js";
import {
  ENGINE_AUTOSTART_SCHEMA,
  ENGINE_BACKGROUND_ARGUMENT,
  LINUX_ENGINE_AUTOSTART_FILE,
  WINDOWS_ENGINE_LOGIN_ITEM_NAME,
  isManagedLinuxEngineAutostartContent
} from "../src/desktop/login-autostart.js";
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
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PRODUCT,
  LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA,
  isLocalMediaEngineVersion
} from "../src/lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  freshLocalMediaEngineChallenge,
  localMediaEnginePairingUrl,
  parseLocalMediaEngineDeviceProof,
  parseLocalMediaEnginePairingRequest,
  parseLocalMediaEngineSessionEncryptionOffer
} from "../src/lib/local-media-engine-auth.js";
import {
  CAPTION_AGENT_HEALTH_SCHEMA_ID,
  DEFAULT_CAPTION_GATEWAY_PORT
} from "./caption-gateway.js";
import {
  externalPublishedArtifactInspectionBinding,
  inspectExternalMp4,
  runExternalProcess
} from "./external-vod-materializer.js";
import {
  windowsPowerShellEnvironment,
  windowsPowerShellExecutable
} from "./windows-powershell-environment.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const APP_START_TIMEOUT_MS = 60_000;
const APP_QUIT_TIMEOUT_MS = 30_000;
const IPC_SEND_TIMEOUT_MS = 5_000;
const PROCESS_RECLAIM_TIMEOUT_MS = 15_000;
const PROCESS_GROUP_RECLAIM_TIMEOUT_MS = 5_000;
const PROCESS_GROUP_TERM_GRACE_MS = 2_000;
const HTTP_REQUEST_TIMEOUT_MS = 2_000;
const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;
const MAX_APP_OUTPUT_BYTES = 512 * 1024;
const TOOL_TIMEOUT_MS = 30_000;
const LEGACY_STUDIO_PORT = 4320;
const PORTS = Object.freeze([
  DEFAULT_CAPTION_GATEWAY_PORT,
  LEGACY_STUDIO_PORT
]);
const SMOKE_XDG_DIRECTORIES = Object.freeze({
  config: "xdg config-사용자",
  cache: "xdg cache-사용자",
  data: "xdg data-사용자",
  state: "xdg state-사용자",
  runtime: "xdg runtime-사용자"
});

export interface ProcessIdentity {
  readonly pid: number;
  readonly parentPid: number;
  readonly started: string;
}

export interface DesktopNativeBrowserSmokeContext {
  readonly launchPairingUrl: (url: string) => Promise<void>;
}

export type DesktopNativeBrowserSmoke = (
  context: Readonly<DesktopNativeBrowserSmokeContext>
) => Promise<unknown>;

export interface DesktopNativeTerminationSmokeContext {
  /** Exact isolated identity environment inherited by the running primary. */
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly executablePath: string;
  readonly rootProcessId: number;
}

export type DesktopNativeTerminationSmoke = (
  context: Readonly<DesktopNativeTerminationSmokeContext>
) => Promise<unknown>;

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

export interface DesktopNativePackagePaths {
  readonly packageRoot: string;
  readonly executable: string;
  readonly resourcesRoot: string;
}

function packagePaths(target: DesktopBundleTarget): Readonly<DesktopNativePackagePaths> {
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

async function verifyMacBackgroundAgentMetadata(
  packageRoot: string,
  target: DesktopBundleTarget
): Promise<void> {
  if (target !== "darwin-arm64") {
    return;
  }
  const infoPlistPath = path.join(
    packageRoot,
    "Kirinuki.app",
    "Contents",
    "Info.plist"
  );
  await assertRegularPath(infoPlistPath, "file", "packaged macOS Info.plist");
  const infoPlist = await readFile(infoPlistPath, "utf8");
  invariant(
    (infoPlist.match(/<key>LSUIElement<\/key>/gu) || []).length === 1
      && /<key>LSUIElement<\/key>\s*<true\s*\/>/u.test(infoPlist),
    "packaged macOS 앱이 LSUIElement=true인 background agent가 아닙니다."
  );
  invariant(
    (infoPlist.match(/<key>CFBundleIdentifier<\/key>/gu) || []).length === 1
      && /<key>CFBundleIdentifier<\/key>\s*<string>kr\.eff0rtchung\.kirinuki<\/string>/u.test(infoPlist),
    "packaged macOS 앱의 bundle identity가 정확하지 않습니다."
  );
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

function validateGatewayHealth(payloadValue: unknown): void {
  const payload = record(payloadValue, "gateway health");
  const engine = record(payload.engine, "gateway engine identity");
  const vodRuntime = record(payload.vodRuntime, "gateway VOD runtime");
  const ytDlp = record(vodRuntime.ytDlp, "gateway yt-dlp identity");
  const ejs = record(vodRuntime.ejs, "gateway EJS identity");
  invariant(payload.schema === CAPTION_AGENT_HEALTH_SCHEMA_ID, "gateway health schema가 다릅니다.");
  invariant(payload.status === "ok" && payload.managed === true, "gateway health 상태가 다릅니다.");
  invariant(payload.originBinding === "exact-public-studio", "gateway origin binding이 다릅니다.");
  invariant(payload.authentication === "bearer-memory-capability", "gateway authentication identity가 다릅니다.");
  invariant(
    engine.backgroundStart === "ready"
      && engine.product === LOCAL_MEDIA_ENGINE_PRODUCT
      && engine.protocol === LOCAL_MEDIA_ENGINE_API_PROTOCOL
      && isLocalMediaEngineVersion(engine.version),
    "gateway local-engine protocol identity가 다릅니다."
  );
  invariant(
    vodRuntime.schema === LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA
      && vodRuntime.kind === "vod-only"
      && vodRuntime.ready === true,
    "gateway VOD runtime이 준비되지 않았습니다."
  );
  invariant(ytDlp.version === DESKTOP_YT_DLP_RELEASE.version, "gateway yt-dlp identity가 다릅니다.");
  invariant(typeof ejs.version === "string" && ejs.version.length > 0, "gateway EJS identity가 다릅니다.");
}

async function requestAuthenticatedGatewayHealth(): Promise<unknown> {
  const challenge = freshLocalMediaEngineChallenge();
  const payloadValue = await requestJson(
    DEFAULT_CAPTION_GATEWAY_PORT,
    "/v1/health",
    {
      Origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
      [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: challenge
    }
  );
  const payload = record(payloadValue, "authenticated gateway health");
  const proof = parseLocalMediaEngineDeviceProof(payload.deviceProof);
  const sessionEncryption = parseLocalMediaEngineSessionEncryptionOffer(
    payload.sessionEncryption
  );
  const vodRuntime = record(payload.vodRuntime, "authenticated gateway VOD runtime");
  invariant(
    proof !== null
      && proof.challenge === challenge
      && proof.instanceNonce === vodRuntime.instanceNonce,
    "gateway signed health proof가 fresh challenge/runtime에 묶이지 않았습니다."
  );
  invariant(
    sessionEncryption !== null
      && Date.parse(sessionEncryption.expiresAt) > Date.now(),
    "gateway signed health의 one-shot session encryption offer가 올바르지 않습니다."
  );
  return payloadValue;
}

function processEnvironment(
  smokeRoot: string,
  token: string,
  autostartMode: "isolated" | "production"
): NodeJS.ProcessEnv {
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
  environment[DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV] = autostartMode;
  if (process.platform !== "win32") {
    environment.XDG_CONFIG_HOME = path.join(smokeRoot, SMOKE_XDG_DIRECTORIES.config);
    environment.XDG_CACHE_HOME = path.join(smokeRoot, SMOKE_XDG_DIRECTORIES.cache);
    environment.XDG_DATA_HOME = path.join(smokeRoot, SMOKE_XDG_DIRECTORIES.data);
    environment.XDG_STATE_HOME = path.join(smokeRoot, SMOKE_XDG_DIRECTORIES.state);
    environment.XDG_RUNTIME_DIR = path.join(smokeRoot, SMOKE_XDG_DIRECTORIES.runtime);
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

interface NativeReadyEvidence {
  readonly processCount: number;
  readonly windowCount: 0;
}

function readyEvidence(
  value: unknown,
  token: string,
  expectedAutostartMethod: "electron-login-item" | "xdg-autostart" | "isolated-smoke"
): NativeReadyEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const message = value as Record<string, unknown>;
  const autostart = message.autostart !== null
    && typeof message.autostart === "object"
    && !Array.isArray(message.autostart)
    ? message.autostart as Record<string, unknown>
    : null;
  const gateway = message.gateway !== null
    && typeof message.gateway === "object"
    && !Array.isArray(message.gateway)
    ? message.gateway as Record<string, unknown>
    : null;
  if (
    Object.keys(message).sort().join(",")
      !== "autostart,gateway,processCount,schema,token,type,windowCount"
    || message.schema !== DESKTOP_NATIVE_SMOKE_IPC_SCHEMA
    || message.type !== "ready"
    || message.token !== token
    || !Number.isSafeInteger(message.processCount)
    || Number(message.processCount) < 1
    || Number(message.processCount) > 64
    || message.windowCount !== 0
    || JSON.stringify(autostart) !== JSON.stringify({
      argument: "--engine-background",
      method: expectedAutostartMethod,
      readBack: true,
      registered: true,
      schema: "kirinuki-engine-autostart/v1"
    })
    || JSON.stringify(gateway) !== JSON.stringify({
      allowedOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      port: DEFAULT_CAPTION_GATEWAY_PORT,
      reusedExisting: false
    })
  ) {
    return null;
  }
  return Object.freeze({
    processCount: Number(message.processCount),
    windowCount: 0
  });
}

function waitForReady(
  child: ChildProcess,
  completion: Promise<AppExit>,
  token: string,
  expectedAutostartMethod: "electron-login-item" | "xdg-autostart" | "isolated-smoke"
): Promise<Readonly<NativeReadyEvidence>> {
  return withTimeout(new Promise<Readonly<NativeReadyEvidence>>((resolve, reject) => {
    const onMessage = (message: unknown) => {
      cleanup();
      const evidence = readyEvidence(message, token, expectedAutostartMethod);
      if (evidence !== null) {
        resolve(evidence);
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
  invariant(process.platform !== "win32", "POSIX process snapshot은 Windows에서 사용할 수 없습니다.");
  const result = await runTool(
    "/bin/ps",
    ["-axo", "pid=,ppid=,lstart="],
    cwd,
    env
  );
  const records = new Map<number, Readonly<ProcessIdentity>>();
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
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
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve, reject) => {
      const finish = () => {
        child.removeListener("exit", finish);
        child.removeListener("error", failExit);
        resolve();
      };
      const failExit = (error: Error) => {
        child.removeListener("exit", finish);
        reject(error);
      };
      child.once("exit", finish);
      child.once("error", failExit);
      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
      }
    });
    let killed = false;
    try {
      killed = child.kill("SIGKILL");
    } catch {
      // The exact retained child handle can already be closing.
    }
    if (
      !killed
      && child.exitCode === null
      && child.signalCode === null
    ) {
      throw new Error("Windows packaged app의 exact child 종료 요청이 실패했습니다.");
    }
    try {
      await withTimeout(exited, 5_000, "Windows packaged app exact child 종료");
    } catch (error) {
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (child.connected) {
        child.disconnect();
      }
      child.unref();
      throw error;
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

function productionAutostartMethod(
  target: DesktopBundleTarget
): "electron-login-item" | "xdg-autostart" {
  return target === "linux-x64" ? "xdg-autostart" : "electron-login-item";
}

function productionAutostartStatePath(
  target: DesktopBundleTarget,
  smokeRoot: string
): string {
  return target === "linux-x64"
    ? path.join(
      smokeRoot,
      SMOKE_XDG_DIRECTORIES.config,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    )
    : path.join(
      smokeRoot,
      DESKTOP_NATIVE_SMOKE_USER_DATA_DIRECTORY,
      `engine-autostart-${target}.json`
    );
}

async function pathIsAbsent(pathname: string): Promise<boolean> {
  try {
    await lstat(pathname);
    return false;
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return true;
    }
    throw error;
  }
}

async function windowsLoginItemRunValue(
  cwd: string
): Promise<string | null> {
  invariant(process.platform === "win32", "Windows registry probe는 Windows 전용입니다.");
  const powershell = windowsPowerShellExecutable(process.env);
  const result = await runExternalProcess(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$ErrorActionPreference='Stop'",
      "$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
      `if (-not (Test-Path -LiteralPath $key)) { exit 3 }`,
      `$item=Get-ItemProperty -LiteralPath $key`,
      `$property=$item.PSObject.Properties['${WINDOWS_ENGINE_LOGIN_ITEM_NAME}']`,
      `if ($null -eq $property) { exit 3 }`,
      "$bytes=[Text.Encoding]::Unicode.GetBytes([string]$property.Value)",
      "[Console]::Out.Write([Convert]::ToBase64String($bytes))"
    ].join("; ")
  ], {
    cwd,
    env: windowsPowerShellEnvironment(process.env),
    shell: false,
    timeoutMs: TOOL_TIMEOUT_MS
  });
  if (result.exitCode === 3) {
    return null;
  }
  invariant(result.exitCode === 0, "Windows Run registry readback 명령이 실패했습니다.");
  const encoded = result.stdout.trim();
  invariant(/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded), "Windows Run registry readback encoding이 올바르지 않습니다.");
  return Buffer.from(encoded, "base64").toString("utf16le");
}

async function windowsLoginItemApprovalValueExists(
  cwd: string
): Promise<boolean> {
  invariant(process.platform === "win32", "Windows registry probe는 Windows 전용입니다.");
  const powershell = windowsPowerShellExecutable(process.env);
  const result = await runExternalProcess(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$ErrorActionPreference='Stop'",
      "$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'",
      "if (-not (Test-Path -LiteralPath $key)) { exit 3 }",
      "$item=Get-ItemProperty -LiteralPath $key",
      `$property=$item.PSObject.Properties['${WINDOWS_ENGINE_LOGIN_ITEM_NAME}']`,
      "if ($null -eq $property) { exit 3 }"
    ].join("; ")
  ], {
    cwd,
    env: windowsPowerShellEnvironment(process.env),
    shell: false,
    timeoutMs: TOOL_TIMEOUT_MS
  });
  if (result.exitCode === 3) {
    return false;
  }
  invariant(result.exitCode === 0, "Windows StartupApproved registry readback 명령이 실패했습니다.");
  return true;
}

async function assertWindowsProductionAutostartInitiallyAbsent(
  cwd: string
): Promise<void> {
  const [runValue, approvalValueExists] = await Promise.all([
    windowsLoginItemRunValue(cwd),
    windowsLoginItemApprovalValueExists(cwd)
  ]);
  invariant(
    runValue === null && !approvalValueExists,
    "Windows production 자동실행 smoke 전에 Kirinuki 소유 registry 값이 이미 있습니다."
  );
}

async function removeWindowsProductionAutostartAfterSmoke(
  cwd: string,
  executable: string
): Promise<void> {
  const [runValue, approvalValueExists] = await Promise.all([
    windowsLoginItemRunValue(cwd),
    windowsLoginItemApprovalValueExists(cwd)
  ]);
  if (runValue === null && !approvalValueExists) {
    return;
  }
  const expectedQuoted = `"${executable}" ${ENGINE_BACKGROUND_ARGUMENT}`;
  const expectedUnquoted = `${executable} ${ENGINE_BACKGROUND_ARGUMENT}`;
  invariant(
    runValue === null
      || runValue === expectedQuoted
      || runValue === expectedUnquoted,
    "Windows production 자동실행 failure cleanup이 소유권 불명 Run 값을 발견해 제거를 거부했습니다."
  );
  const powershell = windowsPowerShellExecutable(process.env);
  const result = await runExternalProcess(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$ErrorActionPreference='Stop'",
      "$runKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
      "$approvalKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'",
      `$name='${WINDOWS_ENGINE_LOGIN_ITEM_NAME}'`,
      "if (Test-Path -LiteralPath $runKey) { Remove-ItemProperty -LiteralPath $runKey -Name $name -Force -ErrorAction SilentlyContinue }",
      "if (Test-Path -LiteralPath $approvalKey) { Remove-ItemProperty -LiteralPath $approvalKey -Name $name -Force -ErrorAction SilentlyContinue }"
    ].join("; ")
  ], {
    cwd,
    env: windowsPowerShellEnvironment(process.env),
    shell: false,
    timeoutMs: TOOL_TIMEOUT_MS
  });
  invariant(result.exitCode === 0, "Windows production 자동실행 failure cleanup 명령이 실패했습니다.");
  const [remainingRunValue, remainingApprovalValueExists] = await Promise.all([
    windowsLoginItemRunValue(cwd),
    windowsLoginItemApprovalValueExists(cwd)
  ]);
  invariant(
    remainingRunValue === null && !remainingApprovalValueExists,
    "Windows production 자동실행 failure cleanup readback이 실패했습니다."
  );
}

async function assertProductionAutostartRegistered({
  target,
  paths,
  smokeRoot
}: {
  readonly target: DesktopBundleTarget;
  readonly paths: Readonly<DesktopNativePackagePaths>;
  readonly smokeRoot: string;
}): Promise<void> {
  const statePath = productionAutostartStatePath(target, smokeRoot);
  if (target === "linux-x64") {
    const body = await readFile(statePath, "utf8");
    invariant(
      isManagedLinuxEngineAutostartContent(body)
        && body.includes(`X-Kirinuki-Executable=${paths.executable}\n`)
        && body.includes(`X-Kirinuki-Autostart-Path=${statePath}\n`),
      "실제 Linux XDG 자동실행 readback이 설치 실행 파일과 다릅니다."
    );
    return;
  }
  const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  invariant(
    state.schema === ENGINE_AUTOSTART_SCHEMA
      && state.target === target
      && state.executablePath === paths.executable
      && JSON.stringify(state.arguments) === JSON.stringify([ENGINE_BACKGROUND_ARGUMENT])
      && state.registered === true,
    "실제 login-item 관리 상태 readback이 설치 실행 파일과 다릅니다."
  );
  if (target === "win32-x64") {
    const registryValue = await windowsLoginItemRunValue(smokeRoot);
    invariant(registryValue !== null, "Windows HKCU Run 값이 등록되지 않았습니다.");
    const expectedQuoted = `"${paths.executable}" ${ENGINE_BACKGROUND_ARGUMENT}`;
    const expectedUnquoted = `${paths.executable} ${ENGINE_BACKGROUND_ARGUMENT}`;
    invariant(
      registryValue === expectedQuoted || registryValue === expectedUnquoted,
      "Windows HKCU Run 값이 exact executable/background argument와 다릅니다."
    );
  }
}

async function assertProductionAutostartRemoved({
  target,
  smokeRoot
}: {
  readonly target: DesktopBundleTarget;
  readonly smokeRoot: string;
}): Promise<void> {
  invariant(
    await pathIsAbsent(productionAutostartStatePath(target, smokeRoot)),
    "production 자동실행 관리 상태가 native smoke 종료 뒤 남았습니다."
  );
  if (target === "win32-x64") {
    invariant(
      await windowsLoginItemRunValue(smokeRoot) === null,
      "Windows HKCU Run 값이 native smoke 제거 뒤 남았습니다."
    );
  }
}

export async function runNativePackageSmoke({
  target = currentTarget(),
  paths = packagePaths(target),
  autostartMode = "isolated",
  browserSmoke,
  terminateWhileRunning
}: {
  readonly target?: DesktopBundleTarget;
  readonly paths?: Readonly<DesktopNativePackagePaths>;
  readonly autostartMode?: "isolated" | "production";
  readonly browserSmoke?: DesktopNativeBrowserSmoke;
  readonly terminateWhileRunning?: DesktopNativeTerminationSmoke;
} = {}): Promise<void> {
  invariant(target === currentTarget(), "native smoke target이 현재 OS/architecture와 다릅니다.");
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
  let observedProcessCount = 0;
  let output: AppOutput | undefined;
  let smokeFailure: Error | undefined;
  let windowsProductionRegistryWasClean = false;
  let browserPairingLaunches = 0;
  const snapshotEnvironment = minimalToolEnvironment(paths.packageRoot);
  try {
    await Promise.all(Object.values(SMOKE_XDG_DIRECTORIES).map(
      (directory) => mkdir(path.join(smokeRoot, directory), {
      recursive: false,
      mode: 0o700
      })
    ));
    if (autostartMode === "production" && target === "win32-x64") {
      await assertWindowsProductionAutostartInitiallyAbsent(smokeRoot);
      windowsProductionRegistryWasClean = true;
    }
    await Promise.all([
      verifyPackagedTools(paths.resourcesRoot, target, smokeRoot),
      verifyMacBackgroundAgentMetadata(paths.packageRoot, target)
    ]);
    const childEnvironment = processEnvironment(smokeRoot, token, autostartMode);
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
    const expectedAutostartMethod = autostartMode === "isolated"
      ? "isolated-smoke"
      : productionAutostartMethod(target);
    const ready = waitForReady(
      appChild,
      completion,
      token,
      expectedAutostartMethod
    );
    void ready.catch(() => undefined);
    await withTimeout(new Promise<void>((resolve, reject) => {
      appChild?.once("spawn", resolve);
      appChild?.once("error", reject);
    }), 10_000, "packaged app spawn");
    invariant(appChild.pid !== undefined && appChild.pid > 0, "packaged app PID가 없습니다.");
    if (process.platform !== "win32") {
      const launchSnapshot = await processSnapshot(smokeRoot, snapshotEnvironment);
      appRootIdentity = launchSnapshot.get(appChild.pid);
      invariant(appRootIdentity !== undefined, "packaged app launch identity를 찾지 못했습니다.");
      capturedProcesses = Object.freeze([appRootIdentity]);
    }
    const [reportedEvidence] = await Promise.all([
      ready,
      waitForHealth(
        "gateway health",
        requestAuthenticatedGatewayHealth,
        validateGatewayHealth
      ),
      assertConnectionRefused(LEGACY_STUDIO_PORT)
    ]);
    observedProcessCount = reportedEvidence.processCount;
    invariant(reportedEvidence.windowCount === 0, "packaged app이 windowless가 아닙니다.");
    if (autostartMode === "isolated") {
      const autostartRecord = JSON.parse(await readFile(
        path.join(smokeRoot, `autostart-${target}.json`),
        "utf8"
      )) as Record<string, unknown>;
      invariant(
        autostartRecord.schema === ENGINE_AUTOSTART_SCHEMA
          && autostartRecord.target === target
          && autostartRecord.executablePath === paths.executable
          && JSON.stringify(autostartRecord.arguments)
            === JSON.stringify([ENGINE_BACKGROUND_ARGUMENT])
          && autostartRecord.registered === true,
        "격리된 로그인 자동실행 readback이 올바르지 않습니다."
      );
    } else {
      await assertProductionAutostartRegistered({ target, paths, smokeRoot });
    }
    if (browserSmoke) {
      await browserSmoke(Object.freeze({
        launchPairingUrl: async (url: string): Promise<void> => {
          invariant(
            browserPairingLaunches === 0,
            "installed-browser smoke가 첫 연결 custom protocol을 두 번 요청했습니다."
          );
          const request = parseLocalMediaEnginePairingRequest(url);
          invariant(
            localMediaEnginePairingUrl(request) === url,
            "installed-browser smoke의 pairing URL이 canonical exact form이 아닙니다."
          );
          browserPairingLaunches += 1;
          const pairingChild = spawn(paths.executable, [
            DESKTOP_NATIVE_SMOKE_ARGUMENT,
            url
          ], {
            cwd: paths.packageRoot,
            env: childEnvironment,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            shell: false
          });
          const pairingOutput = captureAppOutput(pairingChild);
          const pairingExit = await withTimeout(
            appCompletion(pairingChild),
            15_000,
            "packaged app browser pairing handoff"
          );
          invariant(
            pairingExit.code === 0 && pairingExit.signal === null,
            `browser pairing handoff가 성공 종료하지 않았습니다: code=${pairingExit.code}, signal=${pairingExit.signal ?? "none"}`
          );
          invariant(
            !pairingOutput.overflow,
            "browser pairing handoff 출력이 상한을 넘었습니다."
          );
          validateGatewayHealth(await requestAuthenticatedGatewayHealth());
        }
      }));
      invariant(
        browserPairingLaunches === 1,
        "installed-browser smoke가 최초 1회 pairing handoff를 증명하지 못했습니다."
      );
    }
    const secondary = spawn(paths.executable, [DESKTOP_NATIVE_SMOKE_ARGUMENT], {
      cwd: paths.packageRoot,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    const secondaryOutput = captureAppOutput(secondary);
    const secondaryExit = await withTimeout(
      appCompletion(secondary),
      15_000,
      "packaged app secondary instance"
    );
    invariant(
      secondaryExit.code === 0 && secondaryExit.signal === null,
      `secondary instance가 성공 종료하지 않았습니다: code=${secondaryExit.code}, signal=${secondaryExit.signal ?? "none"}`
    );
    invariant(
      !secondaryOutput.overflow,
      "secondary instance 출력이 상한을 넘었습니다."
    );
    validateGatewayHealth(await requestAuthenticatedGatewayHealth());
    invariant(!output.overflow, "packaged app stdout/stderr 상한을 초과했습니다.");
    if (process.platform !== "win32") {
      const snapshot = await processSnapshot(smokeRoot, snapshotEnvironment);
      capturedProcesses = descendants(snapshot, appChild.pid);
      invariant(capturedProcesses.some((entry) => entry.pid === appChild?.pid), "packaged app process identity를 찾지 못했습니다.");
      const capturedRoot = snapshot.get(appChild.pid);
      invariant(capturedRoot !== undefined, "packaged app root process identity를 찾지 못했습니다.");
      if (appRootIdentity && capturedRoot.started !== appRootIdentity.started) {
        throw new Error("packaged app root process identity가 실행 중 바뀌었습니다.");
      }
      appRootIdentity = capturedRoot;
      invariant(capturedProcesses.length >= 1, "packaged app process가 시작되지 않았습니다.");
    }
    if (terminateWhileRunning) {
      await terminateWhileRunning(Object.freeze({
        environment: Object.freeze({ ...childEnvironment }),
        executablePath: paths.executable,
        rootProcessId: appChild.pid
      }));
    } else if (process.platform === "win32") {
      await sendQuit(appChild, token);
    } else {
      invariant(
        appChild.kill("SIGTERM"),
        "packaged app SIGTERM 전달에 실패했습니다."
      );
    }
    const exit = await withTimeout(completion, APP_QUIT_TIMEOUT_MS, "packaged app graceful quit");
    invariant(exit.code === 0 && exit.signal === null, `packaged app 종료 상태가 다릅니다: code=${exit.code}, signal=${exit.signal ?? "none"}`);
    if (autostartMode === "production") {
      await assertProductionAutostartRemoved({ target, smokeRoot });
    }
    if (process.platform !== "win32") {
      await assertProcessesReclaimed(capturedProcesses, smokeRoot, snapshotEnvironment);
      invariant(appRootIdentity !== undefined, "packaged app root identity가 없습니다.");
      await assertPosixProcessGroupReclaimed(
        appRootIdentity,
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
      autostartMode,
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
      observedProcesses: observedProcessCount,
      secondaryInstance: "exited-0-primary-health-intact",
      installedBrowser: browserSmoke
        ? "pair-once+signed-health+encrypted-session+reload-reconnect"
        : "not-requested",
      termination: terminateWhileRunning
        ? "external-installed-lifecycle"
        : "native-smoke-graceful-quit",
      reclaimedProcesses: process.platform === "win32"
        ? "exact-root+ports+private-state"
        : capturedProcesses.length,
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
          smokeRoot,
          snapshotEnvironment
        );
      } catch (error) {
        cleanupErrors.push(error instanceof Error
          ? error
          : new Error("packaged app process cleanup이 실패했습니다."));
      }
    }
    if (windowsProductionRegistryWasClean) {
      try {
        await removeWindowsProductionAutostartAfterSmoke(
          smokeRoot,
          paths.executable
        );
      } catch (error) {
        cleanupErrors.push(error instanceof Error
          ? error
          : new Error("Windows production 자동실행 failure cleanup이 실패했습니다."));
      }
    }
    try {
      await rm(smokeRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
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
