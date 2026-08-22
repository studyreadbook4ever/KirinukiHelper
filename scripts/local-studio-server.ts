#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_STUDIO_PORT,
  LOCAL_STUDIO_PID_SCHEMA,
  STUDIO_LOOPBACK_HOST,
  classifyStudioEndpoint,
  commandLineRunsExactStudioCli,
  createLocalStudioHttpServer,
  createStudioInstanceNonce,
  isManagedStudioHealthPayload,
  isValidStudioInstanceNonce,
  parseProcStartTime,
  resolveStudioServerPaths,
  validStudioPidRecord
} from "./local-studio-server-core.js";
import type {
  LocalStudioServerPaths,
  StudioHealthPayload,
  StudioServerPidRecord
} from "./local-studio-server-core.js";
import { typescriptCommandArgs } from "./typescript-runtime.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import type {
  KirinukiAppOrigin
} from "../src/lib/local-runtime-origin.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(import.meta.url);
const INSTANCE_NONCE_ENV = "KIRINUKI_STUDIO_SERVER_INSTANCE_NONCE";
const STARTUP_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;

export interface LocalStudioServerCliOptions {
  foreground: boolean;
  json: boolean;
  studioOrigin: KirinukiAppOrigin;
}

export function studioBrowserUrl(
  studioOrigin: KirinukiAppOrigin
): string {
  return studioOrigin;
}

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
Kirinuki 웹 편집기 개발 서버

사용법:
  node --import tsx scripts/local-studio-server.ts start [--foreground] [--json]
  node --import tsx scripts/local-studio-server.ts status [--json]
  node --import tsx scripts/local-studio-server.ts stop [--json]

보안 계약:
  127.0.0.1:4320에만 바인딩하고 정확한 Host만 받습니다.
  PID, Linux process start time, boot ID, CLI path와 instance nonce가 모두
  일치할 때만 실행 중인 서버로 인정하거나 종료합니다.
  4320은 소스 체크아웃의 개발·회귀 테스트 전용입니다.
  공개 제품의 전체 편집기는 https://kirinuki.eff0rtchung.kr 에서 실행됩니다.
`.trim();
}

export function parseLocalStudioServerArgs(
  argv: readonly unknown[] = []
): { command: string; options: LocalStudioServerCliOptions } {
  const values = argv.map((value) => String(value));
  const command = values.shift() || "help";
  const options: LocalStudioServerCliOptions = {
    foreground: false,
    json: false,
    studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
  };
  for (const value of values) {
    if (/api[-_]?key|token|secret|password|cookie/iu.test(value)) {
      throw new TypeError(
        "localhost server는 인증 정보나 쿠키를 명령행 인자로 받지 않습니다."
      );
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
  const normalizedCommand = command === "--help" ? "help" : command;
  if (!["help", "start", "status", "stop"].includes(normalizedCommand)) {
    throw new TypeError(`알 수 없는 명령입니다: ${command}`);
  }
  if (normalizedCommand !== "start" && options.foreground) {
    throw new TypeError("--foreground는 start에서만 사용할 수 있습니다.");
  }
  return { command: normalizedCommand, options };
}

function runtimePaths(
  env: NodeJS.ProcessEnv = process.env
): Readonly<LocalStudioServerPaths> {
  return resolveStudioServerPaths({
    env,
    homeDir: os.homedir(),
    repoRoot: packageRoot
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
  paths: LocalStudioServerPaths
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(paths.pidPath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifiedStudioServerPid(
  paths: LocalStudioServerPaths
): Promise<StudioServerPidRecord | null> {
  if (process.platform !== "linux") {
    return null;
  }
  const candidate = await readPidRecord(paths);
  if (!validStudioPidRecord(candidate, cliPath)) {
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
  if (!commandLineRunsExactStudioCli({
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
  return procStartTime === record.procStartTime && bootId === record.bootId
    ? record
    : null;
}

async function currentPidRecord(): Promise<StudioServerPidRecord> {
  if (process.platform !== "linux") {
    throw new Error("localhost 개발 서버의 PID 관리는 Linux에서만 지원합니다.");
  }
  const [procStartTime, bootId] = await Promise.all([
    readProcStartTime(process.pid),
    readBootId()
  ]);
  if (!procStartTime || !bootId) {
    throw new Error("현재 localhost server의 process identity를 확인하지 못했습니다.");
  }
  const requestedNonce = process.env[INSTANCE_NONCE_ENV];
  const instanceNonce = requestedNonce === undefined
    ? createStudioInstanceNonce()
    : requestedNonce;
  if (!isValidStudioInstanceNonce(instanceNonce)) {
    throw new Error("localhost server instance nonce가 올바르지 않습니다.");
  }
  return {
    schema: LOCAL_STUDIO_PID_SCHEMA,
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
  left: StudioServerPidRecord,
  right: StudioServerPidRecord
): boolean {
  return left.schema === right.schema
    && left.pid === right.pid
    && left.procStartTime === right.procStartTime
    && left.bootId === right.bootId
    && left.cliPath === right.cliPath
    && left.instanceNonce === right.instanceNonce;
}

async function claimPidFile(
  paths: LocalStudioServerPaths
): Promise<StudioServerPidRecord> {
  await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
  const record = await currentPidRecord();
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
    if (hasErrorCode(error, "EEXIST")) {
      const active = await verifiedStudioServerPid(paths);
      if (active) {
        throw new Error(
          `localhost server가 이미 실행 중입니다 (PID ${active.pid}).`
        );
      }
      throw new Error(
        "검증되지 않은 localhost server PID 파일이 있습니다. 포트가 비어 있는지 확인한 뒤 stop으로 격리하세요."
      );
    }
    throw error;
  }
}

async function releaseOwnPidFile(
  paths: LocalStudioServerPaths,
  ownRecord: StudioServerPidRecord
): Promise<void> {
  const current = await readPidRecord(paths);
  if (
    validStudioPidRecord(current, cliPath)
    && samePidRecord(current, ownRecord)
  ) {
    await rm(paths.pidPath, { force: true });
  }
}

export async function probeStudioPort(
  timeoutMs: number = 1_000
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({
      host: STUDIO_LOOPBACK_HOST,
      port: DEFAULT_STUDIO_PORT
    });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function probeStudioHealth(
  {
    instanceNonce,
    studioOrigin,
    timeoutMs = 1_500
  }: {
    instanceNonce?: string;
    studioOrigin?: KirinukiAppOrigin;
    timeoutMs?: number;
  } = {}
): Promise<StudioHealthPayload | null> {
  return await new Promise<StudioHealthPayload | null>((resolve) => {
    const request = httpRequest({
      host: STUDIO_LOOPBACK_HOST,
      port: DEFAULT_STUDIO_PORT,
      path: "/v1/studio/health",
      method: "GET",
      headers: {
        Host: `${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`,
        Accept: "application/json"
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_HEALTH_RESPONSE_BYTES) {
          request.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          const value: unknown = JSON.parse(
            Buffer.concat(chunks).toString("utf8")
          );
          resolve(isManagedStudioHealthPayload(value, {
            ...(instanceNonce === undefined ? {} : { instanceNonce }),
            ...(studioOrigin === undefined ? {} : { studioOrigin })
          }) ? value : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve(null);
    });
    request.once("error", () => resolve(null));
    request.end();
  });
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(DEFAULT_STUDIO_PORT, STUDIO_LOOPBACK_HOST);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function foregroundStart(
  paths: LocalStudioServerPaths,
  options: LocalStudioServerCliOptions
): Promise<void> {
  const existing = await verifiedStudioServerPid(paths);
  if (existing) {
    throw new Error(
      `localhost server가 이미 실행 중입니다 (PID ${existing.pid}).`
    );
  }
  if (await probeStudioPort()) {
    throw new Error(
      "127.0.0.1:4320을 소유권이 확인되지 않은 프로세스가 사용 중입니다."
    );
  }

  let ownRecord: StudioServerPidRecord | null = null;
  let server: Server | null = null;
  let shutdownRequested = false;
  let resolveShutdown: (() => void) | null = null;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const requestShutdown = (): void => {
    if (!shutdownRequested) {
      shutdownRequested = true;
      resolveShutdown?.();
    }
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  try {
    ownRecord = await claimPidFile(paths);
    server = createLocalStudioHttpServer({
      repoRoot: paths.repoRoot,
      instanceNonce: ownRecord.instanceNonce,
      studioOrigin: options.studioOrigin
    });
    await listen(server);
    const browserUrl = studioBrowserUrl(options.studioOrigin);
    output(
      `Kirinuki localhost studio ready · ${browserUrl}`
      + ` · loopback listener http://${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`
    );
    await shutdown;
  } finally {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    if (server?.listening) {
      await closeServer(server);
    }
    if (ownRecord) {
      await releaseOwnPidFile(paths, ownRecord);
    }
  }
}

async function waitForStudio(
  instanceNonce: string,
  studioOrigin: KirinukiAppOrigin,
  timeoutMs: number = STARTUP_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeStudioHealth({ instanceNonce, studioOrigin })) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("127.0.0.1:4320 localhost studio 준비 시간이 초과되었습니다.");
}

function childEnvironment(instanceNonce: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "LANG",
    "LC_ALL",
    "PATH",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "XDG_STATE_HOME"
  ]) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }
  environment[INSTANCE_NONCE_ENV] = instanceNonce;
  return environment;
}

export async function startLocalStudioServer(
  options: LocalStudioServerCliOptions
): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("관리형 localhost server는 Linux에서만 지원합니다.");
  }
  const paths = runtimePaths();
  const existing = await verifiedStudioServerPid(paths);
  if (existing) {
    const health = await probeStudioHealth({
      instanceNonce: existing.instanceNonce
    });
    if (health) {
      if (
        (health.server.studioOrigin ?? KIRINUKI_LOCAL_STUDIO_ORIGIN)
        !== options.studioOrigin
      ) {
        throw new Error(
          "이전 버전의 로컬 엔진이 실행 중입니다. Kirinuki 도우미를 다시 시작해 주세요."
        );
      }
      const result = {
        started: false,
        alreadyRunning: true,
        pid: existing.pid,
        studioOrigin: options.studioOrigin,
        url: studioBrowserUrl(options.studioOrigin),
        loopbackUrl: `http://${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`
      };
      output(options.json
        ? JSON.stringify(result, null, 2)
        : `이미 실행 중입니다 (PID ${existing.pid}).`);
      return;
    }
    throw new Error(
      `검증된 PID ${existing.pid}와 localhost health identity가 일치하지 않습니다. stop으로 복구하세요.`
    );
  }
  if (options.foreground) {
    await foregroundStart(paths, options);
    return;
  }
  if (await probeStudioPort()) {
    throw new Error(
      "127.0.0.1:4320을 소유권이 확인되지 않은 프로세스가 사용 중입니다. 종료하지 않았습니다."
    );
  }
  await mkdir(paths.stateRoot, { recursive: true, mode: 0o700 });
  await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
  const logHandle = await open(paths.logPath, "a", 0o600);
  const instanceNonce = createStudioInstanceNonce();
  try {
    const child = spawn(
      process.execPath,
      typescriptCommandArgs(
        cliPath,
        "start",
        "--foreground"
      ),
      {
        cwd: packageRoot,
        env: childEnvironment(instanceNonce),
        detached: true,
        shell: false,
        stdio: ["ignore", logHandle.fd, logHandle.fd]
      }
    );
    child.unref();
  } finally {
    await logHandle.close();
  }
  try {
    await waitForStudio(instanceNonce, options.studioOrigin);
  } catch (error) {
    const failedManager = await verifiedStudioServerPid(paths);
    if (failedManager?.instanceNonce === instanceNonce) {
      process.kill(failedManager.pid, "SIGTERM");
      await waitUntilStopped(paths, failedManager);
    }
    throw error;
  }
  const manager = await verifiedStudioServerPid(paths);
  if (!manager || manager.instanceNonce !== instanceNonce) {
    throw new Error(
      "localhost health는 응답하지만 검증된 manager PID identity가 없습니다."
    );
  }
  const result = {
    started: true,
    pid: manager.pid,
    studioOrigin: options.studioOrigin,
    url: studioBrowserUrl(options.studioOrigin),
    loopbackUrl: `http://${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`,
    logPath: paths.logPath
  };
  output(options.json
    ? JSON.stringify(result, null, 2)
    : `localhost studio 시작 완료 (PID ${manager.pid}) · ${result.url}`);
}

export async function statusLocalStudioServer(
  options: LocalStudioServerCliOptions
): Promise<void> {
  const paths = runtimePaths();
  const pidRecord = await verifiedStudioServerPid(paths);
  const [health, portOccupied] = await Promise.all([
    probeStudioHealth(),
    probeStudioPort()
  ]);
  const ownership = classifyStudioEndpoint({
    portOccupied,
    health,
    pidRecord
  });
  const studioOrigin = health
    ? health.server.studioOrigin ?? KIRINUKI_LOCAL_STUDIO_ORIGIN
    : null;
  const report = {
    host: STUDIO_LOOPBACK_HOST,
    port: DEFAULT_STUDIO_PORT,
    studioOrigin,
    url: studioOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN
      ? studioBrowserUrl(studioOrigin)
      : `http://${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`,
    loopbackUrl: `http://${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`,
    ownership,
    ready: ownership === "managed",
    managerPid: ownership === "managed" ? pidRecord?.pid : null,
    pidIdentityVerified: Boolean(pidRecord),
    healthIdentityVerified: Boolean(health),
    pidPath: paths.pidPath,
    logPath: paths.logPath
  };
  if (options.json) {
    output(JSON.stringify(report, null, 2));
    return;
  }
  output(`localhost studio: ${report.ready ? "ready" : ownership}`);
  output(`Origin: ${report.studioOrigin || "-"}`);
  output(`URL: ${report.url}`);
  output(`manager: ${report.managerPid ? `PID ${report.managerPid}` : "down/unowned"}`);
}

async function quarantineStalePidFile(
  paths: LocalStudioServerPaths
): Promise<string | null> {
  let first: string;
  try {
    first = await readFile(paths.pidPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  if (await verifiedStudioServerPid(paths)) {
    throw new Error("PID 파일 격리 전에 검증된 localhost server가 나타났습니다.");
  }
  if (await probeStudioPort()) {
    throw new Error(
      "127.0.0.1:4320이 사용 중이므로 검증되지 않은 PID 파일을 보존했습니다."
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
    throw new Error("PID 파일이 검사 중 변경되어 보존했습니다.");
  }
  const timestamp = new Date().toISOString().replace(/[^0-9]/gu, "");
  const quarantinePath =
    `${paths.pidPath}.stale-${timestamp}-${randomBytes(8).toString("hex")}`;
  await rename(paths.pidPath, quarantinePath);
  return quarantinePath;
}

async function waitUntilStopped(
  paths: LocalStudioServerPaths,
  record: StudioServerPidRecord
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SHUTDOWN_TIMEOUT_MS) {
    const current = await verifiedStudioServerPid(paths);
    if (!current || !samePidRecord(current, record)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function stopLocalStudioServer(
  options: LocalStudioServerCliOptions
): Promise<void> {
  const paths = runtimePaths();
  const manager = await verifiedStudioServerPid(paths);
  if (!manager) {
    const portOccupied = await probeStudioPort();
    if (portOccupied) {
      throw new Error(
        "127.0.0.1:4320을 사용 중인 프로세스의 PID identity를 검증하지 못해 종료하지 않았습니다."
      );
    }
    const quarantined = await quarantineStalePidFile(paths);
    const result = {
      stopped: false,
      alreadyStopped: true,
      quarantinedPidFile: quarantined
    };
    output(options.json
      ? JSON.stringify(result, null, 2)
      : quarantined
        ? `서버는 꺼져 있습니다. stale PID 파일을 격리했습니다: ${quarantined}`
        : "localhost studio는 이미 꺼져 있습니다.");
    return;
  }
  const [health, portOccupied] = await Promise.all([
    probeStudioHealth({ instanceNonce: manager.instanceNonce }),
    probeStudioPort()
  ]);
  if (portOccupied && !health) {
    throw new Error(
      "PID와 127.0.0.1:4320의 instance nonce가 일치하지 않아 어떤 프로세스도 종료하지 않았습니다."
    );
  }
  process.kill(manager.pid, "SIGTERM");
  if (!await waitUntilStopped(paths, manager)) {
    throw new Error(
      `검증된 localhost server PID ${manager.pid}가 종료 시간 안에 멈추지 않았습니다.`
    );
  }
  const result = { stopped: true, pid: manager.pid };
  output(options.json
    ? JSON.stringify(result, null, 2)
    : `localhost studio를 종료했습니다 (PID ${manager.pid}).`);
}

async function main(): Promise<void> {
  const { command, options } = parseLocalStudioServerArgs(
    process.argv.slice(2)
  );
  if (command === "help") {
    output(helpText());
    return;
  }
  if (command === "start") {
    await startLocalStudioServer(options);
    return;
  }
  if (command === "status") {
    await statusLocalStudioServer(options);
    return;
  }
  await stopLocalStudioServer(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(cliPath)) {
  main().catch((error) => {
    outputError(`Kirinuki localhost server 오류: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
