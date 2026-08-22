import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const RESULT_PREFIX = "KIRINUKI_CUT_WINDOW_ELECTRON_SMOKE=";
const PROCESS_TIMEOUT_MS = 45_000;
const MAXIMUM_OUTPUT_BYTES = 2 * 1024 * 1024;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function buildFrameActionSource(): Promise<string> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/streaming-electron-frame-action.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "KirinukiStreamingFrameAction",
    target: "chrome120",
    write: false,
    sourcemap: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent"
  });
  const source = result.outputFiles?.[0]?.text;
  invariant(
    source && Buffer.byteLength(source, "utf8") <= 256 * 1024,
    "고정 streaming frame action bundle이 없거나 너무 큽니다."
  );
  return source;
}

async function buildShortcutGuardSource(): Promise<string> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/desktop/cut-window-shortcut-guard.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "KirinukiStreamingShortcutGuard",
    target: "chrome120",
    write: false,
    sourcemap: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent"
  });
  const source = result.outputFiles?.[0]?.text;
  invariant(
    source && Buffer.byteLength(source, "utf8") <= 64 * 1024,
    "고정 streaming shortcut guard bundle이 없거나 너무 큽니다."
  );
  return source;
}

async function buildSmokeApplication(stageRoot: string): Promise<void> {
  const preloadPath = path.join(stageRoot, "preload.cjs");
  const [frameActionSource, shortcutGuardSource] = await Promise.all([
    buildFrameActionSource(),
    buildShortcutGuardSource()
  ]);
  await Promise.all([
    build({
      absWorkingDir: root,
      entryPoints: ["scripts/cut-window-electron-smoke-app.ts"],
      outfile: path.join(stageRoot, "main.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      external: ["electron"],
      define: {
        __KIRINUKI_SMOKE_FRAME_ACTION_SOURCE__: JSON.stringify(
          frameActionSource
        ),
        __KIRINUKI_SMOKE_PRELOAD_PATH__: JSON.stringify(preloadPath),
        __KIRINUKI_SMOKE_SHORTCUT_GUARD_SOURCE__: JSON.stringify(
          shortcutGuardSource
        )
      },
      sourcemap: false,
      minify: false,
      legalComments: "none",
      logLevel: "silent"
    }),
    build({
      absWorkingDir: root,
      entryPoints: ["src/desktop/cut-window-preload.ts"],
      outfile: preloadPath,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node24",
      external: ["electron"],
      sourcemap: false,
      minify: false,
      legalComments: "none",
      logLevel: "silent"
    }),
    writeFile(
      path.join(stageRoot, "package.json"),
      `${JSON.stringify({
        name: "kirinuki-cut-window-electron-smoke",
        private: true,
        type: "module",
        main: "main.mjs"
      }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    )
  ]);
}

function sanitizedElectronEnvironment(stageRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "NODE_CHANNEL_FD",
    "NODE_INSPECT_RESUME_ON_START",
    "NODE_OPTIONS"
  ]) {
    delete environment[name];
  }
  environment.KIRINUKI_CUT_WINDOW_SMOKE_ROOT = stageRoot;
  return environment;
}

async function runElectron(stageRoot: string): Promise<Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}>> {
  const require = createRequire(import.meta.url);
  const electronBinary = require("electron") as unknown;
  invariant(
    typeof electronBinary === "string" && path.isAbsolute(electronBinary),
    "개발용 Electron 실행 파일을 확인하지 못했습니다."
  );
  const args = [
    stageRoot,
    "--headless",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--user-data-dir=${path.join(stageRoot, "user-data")}`
  ];
  if (
    process.platform === "linux"
    && typeof process.getuid === "function"
    && process.getuid() === 0
  ) {
    args.push("--no-sandbox");
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(electronBinary, args, {
      cwd: root,
      env: sanitizedElectronEnvironment(stageRoot),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const capture = (target: "stdout" | "stderr") => (
      chunk: Buffer | string
    ): void => {
      const text = String(chunk);
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8")
        + Buffer.byteLength(text, "utf8") > MAXIMUM_OUTPUT_BYTES) {
        overflow = true;
        return;
      }
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
    };
    child.stdout?.on("data", capture("stdout"));
    child.stderr?.on("data", capture("stderr"));
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(
        `Electron cut-window smoke가 ${PROCESS_TIMEOUT_MS}ms 제한을 넘었습니다.\n${stderr}`
      ));
    }, PROCESS_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (overflow) {
        reject(new Error("Electron cut-window smoke 출력이 제한을 넘었습니다."));
        return;
      }
      resolve(Object.freeze({ code, signal, stderr, stdout }));
    });
  });
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: cut-window-electron-smoke.ts");
  }
  const stageRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-cut-electron-smoke-")
  );
  try {
    await mkdir(path.join(stageRoot, "user-data"), {
      recursive: false,
      mode: 0o700
    });
    await buildSmokeApplication(stageRoot);
    const outcome = await runElectron(stageRoot);
    invariant(
      outcome.code === 0 && outcome.signal === null,
      `Electron cut-window smoke가 실패했습니다 (code=${outcome.code}, signal=${outcome.signal}).\n${outcome.stderr}\n${outcome.stdout}`
    );
    const resultLine = outcome.stdout
      .split(/\r?\n/u)
      .find((line) => line.startsWith(RESULT_PREFIX));
    invariant(resultLine, `Electron smoke 결과를 읽지 못했습니다.\n${outcome.stdout}`);
    const result = JSON.parse(resultLine.slice(RESULT_PREFIX.length)) as unknown;
    invariant(result && typeof result === "object", "Electron smoke 결과가 객체가 아닙니다.");
    const record = result as Record<string, unknown>;
    invariant(
      record.schema === "kirinuki-cut-window-electron-smoke/v1"
        && record.status === "ok",
      "Electron smoke 결과 schema/status가 올바르지 않습니다."
    );
    const appMainSource = await readFile(path.join(stageRoot, "main.mjs"), "utf8");
    invariant(
      appMainSource.includes("KirinukiStreamingFrameAction"),
      "실행된 Electron smoke app에 고정 frame action bundle이 없습니다."
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

await main();
