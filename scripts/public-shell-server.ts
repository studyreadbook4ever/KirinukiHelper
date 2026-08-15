#!/usr/bin/env node

import type { Server } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PUBLIC_SHELL_PORT,
  PUBLIC_SHELL_BIND_HOST,
  PUBLIC_SHELL_CANONICAL_HOST,
  createPublicShellHttpServer
} from "./public-shell-server-core.js";

export const PUBLIC_SHELL_BIND_ENV = "KIRINUKI_PUBLIC_SHELL_BIND";
export const PUBLIC_SHELL_PORT_ENV = "KIRINUKI_PUBLIC_SHELL_PORT";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export interface PublicShellServerCliOptions {
  readonly bindHost: "127.0.0.1" | "::1";
  readonly help: boolean;
  readonly port: number;
}

function parseBindHost(value: unknown, label: string): "127.0.0.1" | "::1" {
  const raw = String(value ?? "");
  if (raw !== "127.0.0.1" && raw !== "::1") {
    throw new TypeError(
      `${label}은 loopback 127.0.0.1 또는 ::1만 허용합니다.`
    );
  }
  return raw;
}

function parsePort(value: unknown, label: string): number {
  const raw = String(value ?? "");
  if (!/^[1-9]\d{0,4}$/u.test(raw)) {
    throw new TypeError(`${label}는 1~65535의 canonical 10진수여야 합니다.`);
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new TypeError(`${label}는 1~65535 범위여야 합니다.`);
  }
  return port;
}

export function parsePublicShellServerArgs(
  argv: readonly unknown[] = [],
  env: NodeJS.ProcessEnv = {}
): PublicShellServerCliOptions {
  const values = argv.map((value) => String(value));
  let bindValue: string | undefined;
  let portValue: string | undefined;
  let help = false;

  const takeFollowingValue = (index: number, flag: string): string => {
    const value = values[index + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new TypeError(`${flag} 값이 필요합니다.`);
    }
    return value;
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === "--help" || value === "-h") {
      if (help) {
        throw new TypeError("도움말 옵션을 중복할 수 없습니다.");
      }
      help = true;
      continue;
    }
    if (value === "--bind" || value.startsWith("--bind=")) {
      if (bindValue !== undefined) {
        throw new TypeError("--bind를 중복할 수 없습니다.");
      }
      bindValue = value === "--bind"
        ? takeFollowingValue(index, "--bind")
        : value.slice("--bind=".length);
      if (value === "--bind") {
        index += 1;
      }
      continue;
    }
    if (value === "--port" || value.startsWith("--port=")) {
      if (portValue !== undefined) {
        throw new TypeError("--port를 중복할 수 없습니다.");
      }
      portValue = value === "--port"
        ? takeFollowingValue(index, "--port")
        : value.slice("--port=".length);
      if (value === "--port") {
        index += 1;
      }
      continue;
    }
    throw new TypeError(`알 수 없는 공개 shell 서버 옵션입니다: ${value}`);
  }
  if (help && (bindValue !== undefined || portValue !== undefined)) {
    throw new TypeError("--help는 bind·port 옵션과 함께 사용할 수 없습니다.");
  }

  const configuredBind = bindValue
    ?? env[PUBLIC_SHELL_BIND_ENV]
    ?? PUBLIC_SHELL_BIND_HOST;
  const configuredPort = portValue
    ?? env[PUBLIC_SHELL_PORT_ENV]
    ?? String(DEFAULT_PUBLIC_SHELL_PORT);
  return Object.freeze({
    bindHost: parseBindHost(configuredBind, PUBLIC_SHELL_BIND_ENV),
    help,
    port: parsePort(configuredPort, PUBLIC_SHELL_PORT_ENV)
  });
}

export function publicShellServerHelpText(): string {
  return `
Kirinuki 공개 shell 서버

사용법:
  npm run public-shell:start -- [--bind 127.0.0.1|::1] [--port 4330]

기본값:
  bind=${PUBLIC_SHELL_BIND_HOST}
  port=${DEFAULT_PUBLIC_SHELL_PORT}
  Host=${PUBLIC_SHELL_CANONICAL_HOST}

환경변수:
  ${PUBLIC_SHELL_BIND_ENV}=127.0.0.1|::1
  ${PUBLIC_SHELL_PORT_ENV}=1..65535

공개 content allowlist만 메모리에 올리고 GET·HEAD로 제공합니다.
요청 기록, 쿠키, 세션, 분석 기능과 로컬 health 예외는 없습니다.
Cloudflare Tunnel의 origin은 이 loopback listener로 지정하고 원본 Host를
${PUBLIC_SHELL_CANONICAL_HOST}로 유지해야 합니다.
`.trim();
}

async function listen(
  server: Server,
  options: PublicShellServerCliOptions
): Promise<void> {
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
    server.listen({
      host: options.bindHost,
      port: options.port,
      exclusive: true
    });
  });
}

export async function runPublicShellServer(
  options: PublicShellServerCliOptions,
  publicShellRoot = path.join(packageRoot, "public-shell")
): Promise<void> {
  const server = await createPublicShellHttpServer({ publicShellRoot });
  await listen(server, options);

  let receivedSignal: NodeJS.Signals | null = null;
  const close = (signal: NodeJS.Signals) => {
    if (receivedSignal) {
      server.closeAllConnections();
      return;
    }
    receivedSignal = signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    server.close();
    server.closeIdleConnections();
  };
  const onSigint = () => close("SIGINT");
  const onSigterm = () => close("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("close", resolve);
      server.once("error", reject);
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

function isDirectExecution(
  moduleUrl: string,
  argvEntry: string | undefined
): boolean {
  return argvEntry !== undefined
    && path.resolve(argvEntry) === fileURLToPath(moduleUrl);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    const options = parsePublicShellServerArgs(process.argv.slice(2), process.env);
    if (options.help) {
      process.stdout.write(`${publicShellServerHelpText()}\n`);
    } else {
      await runPublicShellServer(options);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
