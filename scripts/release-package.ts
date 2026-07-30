import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  acquireDevRunnerLock,
  releaseDevRunnerLock,
  releaseDevRunnerLockSync
} from "./dev-runner-lock.js";
import { typescriptCommandArgs } from "./typescript-runtime.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const lockPath = path.join(root, ".dev-editor.lock");
const releaseLease = await acquireDevRunnerLock(lockPath, {
  pid: process.pid,
  role: "package"
});
const childEnvironment = {
  ...process.env,
  KIRINUKI_RELEASE_LOCK_TOKEN: releaseLease.lock.token
};
let activeChild: ChildProcess | null = null;
let stopping = false;

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      detached: process.platform !== "win32",
      env: childEnvironment,
      stdio: "inherit"
    });
    activeChild = child;
    child.once("error", (error) => {
      if (activeChild === child) {
        activeChild = null;
      }
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (activeChild === child) {
        activeChild = null;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `${command}가 ${signal} 신호로 종료됐습니다.`
          : `${command}가 종료 코드 ${code}로 끝났습니다.`
      ));
    });
  });
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else if (child.pid !== undefined) {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (
      !error
      || typeof error !== "object"
      || !("code" in error)
      || error.code !== "ESRCH"
    ) {
      throw error;
    }
  }
}

function waitForChildExit(
  child: ChildProcess | null,
  timeoutMs: number
): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateActiveChild(
  signal: NodeJS.Signals = "SIGTERM"
) {
  const child = activeChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  signalChild(child, signal);
  if (!await waitForChildExit(child, 5_000)) {
    signalChild(child, "SIGKILL");
    await waitForChildExit(child, 5_000);
  }
}

async function main() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npmCommand, ["run", "check:full"]);
  await run(process.execPath, typescriptCommandArgs(
    path.join(root, "scripts", "package-extension.ts")
  ));
}

for (const signal of [
  "SIGINT",
  "SIGTERM",
  "SIGHUP"
] satisfies NodeJS.Signals[]) {
  process.once(signal, () => {
    if (stopping) {
      return;
    }
    stopping = true;
    void terminateActiveChild(signal).finally(async () => {
      await releaseDevRunnerLock(releaseLease);
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}

process.once("exit", () => {
  if (
    activeChild
    && activeChild.exitCode === null
    && activeChild.signalCode === null
  ) {
    signalChild(activeChild, "SIGKILL");
  }
  releaseDevRunnerLockSync(releaseLease);
});

try {
  await main();
} catch (error) {
  if (!stopping) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
} finally {
  await releaseDevRunnerLock(releaseLease);
}
