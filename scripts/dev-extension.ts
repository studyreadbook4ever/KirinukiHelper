import { readFileSync, unlinkSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  classifyDevReload,
  createDevReloadMarker,
  devChangeNeedsBuild,
  normalizeDevChangedPath,
  removeOwnedDevReloadMarker,
  writeDevReloadMarker
} from "./dev-hot-reload-core.js";
import {
  acquireDevRunnerLock,
  releaseDevRunnerLock,
  releaseDevRunnerLockSync
} from "./dev-runner-lock.js";
import type { DevRunnerLease } from "./dev-runner-lock.js";
import { typescriptCommandArgs } from "./typescript-runtime.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const markerPath = path.join(root, "extension", "dev-reload.json");
const lockPath = path.join(root, ".dev-editor.lock");
const debounceMs = 180;
const watchedDirectories = [
  path.join(root, "src", "editor"),
  path.join(root, "src", "caption-agent"),
  path.join(root, "src", "lib"),
  path.join(root, "src"),
  path.join(root, "extension"),
  path.join(root, "extension", "editor")
];
const watchedFiles = new Set([
  "src/content-script.ts",
  "src/service-worker.ts",
  "src/sidepanel.ts",
  "src/lib/caption-style.ts",
  "src/lib/core.ts",
  "src/lib/editor-core.ts",
  "src/lib/keyboard-shortcuts.ts",
  "src/lib/serial-operation-gate.ts",
  "src/lib/session-recovery.ts",
  "src/lib/source-platform.ts",
  "extension/editor.html",
  "extension/editor/editor.css",
  "extension/manifest.json",
  "extension/sidepanel.html",
  "extension/sidepanel.css"
]);

let revisionSequence = 0;
let buildInProgress = false;
let rebuildRequested = false;
let debounceTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
let runnerLockLease: DevRunnerLease | null = null;
let activeBuildChild: ChildProcess | null = null;
let cleanupPromise: Promise<void> | null = null;
const pendingFiles = new Set<string>();
const watchers: FSWatcher[] = [];

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

function nextRevision() {
  revisionSequence += 1;
  return `${Date.now().toString(36)}-${revisionSequence.toString(36)}`;
}

function runBuild(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, typescriptCommandArgs(
      path.join(root, "scripts", "build-editor.ts")
    ), {
      cwd: root,
      stdio: "inherit"
    });
    activeBuildChild = child;
    child.once("error", (error) => {
      if (activeBuildChild === child) {
        activeBuildChild = null;
      }
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (activeBuildChild === child) {
        activeBuildChild = null;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `빌드 프로세스가 ${signal} 신호로 종료됐습니다.`
          : `빌드 프로세스가 종료 코드 ${code}로 끝났습니다.`
      ));
    });
  });
}

function trackedChangedPath(
  directory: string,
  filename: string | null
): string | null {
  if (!filename) {
    return null;
  }
  const relativePath = normalizeDevChangedPath(root, path.join(directory, filename));
  if (
    relativePath.startsWith("src/editor/")
    || relativePath.startsWith("src/caption-agent/")
  ) {
    return relativePath;
  }
  return watchedFiles.has(relativePath) ? relativePath : null;
}

async function publishChange(files: readonly string[]): Promise<void> {
  const kind = classifyDevReload(files);
  if (kind === "none") {
    return;
  }
  if (devChangeNeedsBuild(files)) {
    await runBuild();
  }
  const marker = createDevReloadMarker({
    revision: nextRevision(),
    kind,
    changedFiles: files
  });
  await writeDevReloadMarker(markerPath, marker);
  const action = {
    style: "CSS를 상태 보존 교체합니다",
    editor: "CURRENT 저장 검증 후 편집기 탭을 다시 엽니다",
    content: "원본 영상 탭은 자동으로 건드리지 않습니다",
    extension: "확장 재로드가 필요하므로 현재 편집 상태만 보존합니다"
  }[kind];
  console.log(`[dev:editor] ${marker.revision} · ${kind} · ${action}`);
  for (const file of files) {
    console.log(`  ${file}`);
  }
}

async function drainChanges() {
  if (buildInProgress || shuttingDown) {
    rebuildRequested = true;
    return;
  }
  const files = [...pendingFiles].sort();
  pendingFiles.clear();
  if (files.length === 0) {
    return;
  }
  buildInProgress = true;
  try {
    await publishChange(files);
  } catch (error) {
    console.error(
      `[dev:editor] 변경을 적용하지 않았습니다: ${errorMessage(error)}`
    );
  } finally {
    buildInProgress = false;
    if (!shuttingDown && (pendingFiles.size > 0 || rebuildRequested)) {
      rebuildRequested = false;
      queueDrain();
    }
  }
}

function queueDrain() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainChanges();
  }, debounceMs);
}

function observe(directory: string) {
  const watcher = watch(directory, { persistent: true }, (_eventType, filename) => {
    const changedPath = trackedChangedPath(
      directory,
      filename ? filename.toString() : null
    );
    if (!changedPath) {
      return;
    }
    pendingFiles.add(changedPath);
    queueDrain();
  });
  watcher.on("error", (error) => {
    console.error(`[dev:editor] 감시 실패 (${directory}): ${error.message}`);
  });
  watchers.push(watcher);
}

async function ensureSingleRunner() {
  try {
    await unlink(markerPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
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

async function terminateActiveBuild() {
  const child = activeBuildChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  if (!await waitForChildExit(child, 5_000)) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 5_000);
  }
}

async function cleanup() {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  shuttingDown = true;
  cleanupPromise = (async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    for (const watcher of watchers) {
      watcher.close();
    }
    await terminateActiveBuild();
    try {
      await removeOwnedDevReloadMarker(markerPath);
      try {
        await unlink(`${markerPath}.${process.pid}.tmp`);
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          throw error;
        }
      }
    } finally {
      await releaseDevRunnerLock(runnerLockLease);
    }
  })();
  return cleanupPromise;
}

function removeOwnedFileSync(filePath: string) {
  try {
    const value = JSON.parse(
      readFileSync(filePath, "utf8")
    ) as { pid?: unknown };
    if (value.pid === process.pid) {
      unlinkSync(filePath);
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT") && !(error instanceof SyntaxError)) {
      console.error(
        `[dev:editor] 종료 정리 실패 (${filePath}): ${errorMessage(error)}`
      );
    }
  }
}

function cleanupSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  for (const watcher of watchers) {
    watcher.close();
  }
  if (
    activeBuildChild
    && activeBuildChild.exitCode === null
    && activeBuildChild.signalCode === null
  ) {
    activeBuildChild.kill("SIGKILL");
  }
  removeOwnedFileSync(markerPath);
  releaseDevRunnerLockSync(runnerLockLease);
  try {
    unlinkSync(`${markerPath}.${process.pid}.tmp`);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      console.error(
        `[dev:editor] 임시 marker 정리 실패: ${errorMessage(error)}`
      );
    }
  }
}

async function main() {
  runnerLockLease = await acquireDevRunnerLock(lockPath, {
    pid: process.pid,
    role: "editor"
  });
  await ensureSingleRunner();
  await runBuild();
  await writeDevReloadMarker(markerPath, createDevReloadMarker({
    revision: nextRevision(),
    kind: "initial",
    changedFiles: []
  }));

  const existingDirectories: string[] = [];
  for (const directory of watchedDirectories) {
    try {
      const entry = await readdir(directory);
      if (entry) {
        existingDirectories.push(directory);
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }
  for (const directory of [...new Set(existingDirectories)]) {
    observe(directory);
  }

  console.log(
    "[dev:editor] 안전 핫 리로드 준비 완료. 편집기 URL 쿼리에 dev=1을 붙여 처음 한 번만 새로고침하세요."
  );
  console.log(
    "[dev:editor] CSS는 즉시 교체하고, JS/Worker는 원본 핸들과 CURRENT 저장을 확인한 뒤에만 재로드합니다."
  );
}

for (const signal of [
  "SIGINT",
  "SIGTERM",
  "SIGHUP"
] satisfies NodeJS.Signals[]) {
  process.once(signal, () => {
    void cleanup().then(
      () => process.exit(0),
      (error) => {
        console.error(
          `[dev:editor] 종료 정리 실패: ${errorMessage(error)}`
        );
        process.exit(1);
      }
    );
  });
}
process.once("exit", cleanupSync);

main().catch(async (error) => {
  console.error(
    `[dev:editor] 시작 실패: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  await cleanup();
  process.exitCode = 1;
});
