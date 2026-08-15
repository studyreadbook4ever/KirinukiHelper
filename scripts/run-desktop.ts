import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildDesktopApplication } from "./build-desktop.js";
import { prepareDesktopTools } from "./prepare-desktop-tools.js";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function runDesktopApplication(): Promise<number> {
  await prepareDesktopTools(`${process.platform}-${process.arch}`);
  const stageRoot = await buildDesktopApplication();
  const require = createRequire(import.meta.url);
  const electronBinary = require("electron") as unknown;
  if (typeof electronBinary !== "string" || !path.isAbsolute(electronBinary)) {
    throw new Error("개발용 Electron 실행 파일을 확인하지 못했습니다.");
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => ![
      "ELECTRON_RUN_AS_NODE",
      "NODE_INSPECT_RESUME_ON_START",
      "NODE_OPTIONS"
    ].includes(name))
  );
  environment.KIRINUKI_DESKTOP_DEV_ROOT = root;
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(electronBinary, [stageRoot], {
      cwd: root,
      env: environment,
      detached: process.platform !== "win32",
      shell: false,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve(code ?? (signal === "SIGINT" ? 130 : 1));
    });
    const forward = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };
    const forwardSigint = () => forward("SIGINT");
    const forwardSigterm = () => forward("SIGTERM");
    process.once("SIGINT", forwardSigint);
    process.once("SIGTERM", forwardSigterm);
    child.once("close", () => {
      process.removeListener("SIGINT", forwardSigint);
      process.removeListener("SIGTERM", forwardSigterm);
    });
  });
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: run-desktop.ts");
  }
  process.exitCode = await runDesktopApplication();
}
