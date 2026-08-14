import { readFileSync, unlinkSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  classifyWebDevReload,
  createDevReloadMarker,
  normalizeDevChangedPath,
  removeOwnedDevReloadMarker,
  webDevChangeNeedsBuild,
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
const markerPath = path.join(root, "web", "dev-reload.json");
const lockPath = path.join(root, ".dev-editor.lock");
const debounceMs = 180;
const watchedDirectories = [
  path.join(root, "src", "editor"),
  path.join(root, "src", "caption-agent"),
  path.join(root, "src", "lib"),
  path.join(root, "src", "web"),
  path.join(root, "web"),
  path.join(root, "web", "editor")
];
const watchedSourcePrefixes = [
  "src/editor/",
  "src/caption-agent/",
  "src/lib/",
  "src/web/"
];
const watchedFiles = new Set([
  "web/editor.html",
  "web/editor/editor.css",
  "web/index.html",
  "web/studio.css"
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

function nextRevision(): string {
  revisionSequence += 1;
  return `${Date.now().toString(36)}-${revisionSequence.toString(36)}`;
}

function runBuild(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, typescriptCommandArgs(
      path.join(root, "scripts", "build-web.ts")
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
          ? `웹 빌드 프로세스가 ${signal} 신호로 종료됐습니다.`
          : `웹 빌드 프로세스가 종료 코드 ${code}로 끝났습니다.`
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
  if (watchedSourcePrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return relativePath;
  }
  return watchedFiles.has(relativePath) ? relativePath : null;
}

async function publishChange(files: readonly string[]): Promise<void> {
  const kind = classifyWebDevReload(files);
  if (kind === "none") {
    return;
  }
  if (webDevChangeNeedsBuild(files)) {
    await runBuild();
  }
  const marker = createDevReloadMarker({
    revision: nextRevision(),
    kind,
    changedFiles: files
  });
  await writeDevReloadMarker(markerPath, marker);
  const action = kind === "style"
    ? "CSS를 편집 상태 그대로 교체합니다"
    : "CURRENT 저장을 검증한 뒤 같은 localhost 프로젝트를 다시 엽니다";
  console.log(`[dev:editor] ${marker.revision} · ${kind} · ${action}`);
  for (const file of files) {
    console.log(`  ${file}`);
  }
}

async function drainChanges(): Promise<void> {
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

function queueDrain(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainChanges();
  }, debounceMs);
}

function observe(directory: string): void {
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

async function ensureSingleRunner(): Promise<void> {
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

async function terminateActiveBuild(): Promise<void> {
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

async function cleanup(): Promise<void> {
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

function removeOwnedFileSync(filePath: string): void {
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

function cleanupSync(): void {
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

async function main(): Promise<void> {
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
      await readdir(directory);
      existingDirectories.push(directory);
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
    "[dev:editor] localhost 웹 편집기 핫 리로드 준비 완료. 현재 편집기 URL에 dev=1을 붙여 한 번만 새로고침하세요."
  );
  console.log(
    "[dev:editor] web/만 빌드·감시하며 레거시 Chrome Extension은 읽거나 생성하지 않습니다."
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
