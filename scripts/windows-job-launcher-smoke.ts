import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  WINDOWS_JOB_LAUNCHER_CONTRACT,
  windowsJobLauncherResourcePaths
} from "../src/desktop/windows-job-object.js";

const scriptPath = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_SENTINEL_DELAY_MS = 2_500;
const PROCESS_EXIT_TIMEOUT_MS = 12_000;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function fixtureNodeArguments(mode: string, ...args: string[]): readonly string[] {
  return Object.freeze([
    "--import",
    "tsx",
    scriptPath,
    mode,
    ...args
  ]);
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Windows Job Object launcher smoke가 종료 제한을 넘었습니다."));
    }, PROCESS_EXIT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = (stdout + String(chunk)).slice(-1024 * 1024);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = (stderr + String(chunk)).slice(-1024 * 1024);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve(Object.freeze({ code, signal, stdout, stderr }));
    });
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = PROCESS_EXIT_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function bestEffortTaskkill(processId: number): void {
  if (!Number.isSafeInteger(processId) || processId <= 0 || !processIsAlive(processId)) {
    return;
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot) {
    return;
  }
  const killer = spawn(
    path.win32.join(systemRoot, "System32", "taskkill.exe"),
    ["/PID", String(processId), "/T", "/F"],
    { stdio: "ignore", windowsHide: true, shell: false }
  );
  killer.unref();
}

async function fixtureExit(): Promise<never> {
  const payload = readFileSync(3, "utf8");
  process.stdout.write(`${JSON.stringify({ args: process.argv.slice(3), payload })}\n`);
  process.stderr.write("job-launcher-stderr\n");
  process.exit(37);
}

async function fixtureTouch(): Promise<never> {
  await writeFile(process.argv[3]!, "unexpected-child-start", "utf8");
  process.exit(0);
}

async function fixtureGrandchild(): Promise<never> {
  const sentinelPath = process.argv[3]!;
  setTimeout(() => {
    void writeFile(sentinelPath, "orphan-survived", "utf8");
  }, FIXTURE_SENTINEL_DELAY_MS);
  setInterval(() => undefined, 1_000);
  return await new Promise<never>(() => undefined);
}

async function fixtureTree(): Promise<never> {
  const readyPath = process.argv[3]!;
  const sentinelPath = process.argv[4]!;
  const grandchild = spawn(
    process.execPath,
    [...fixtureNodeArguments("--fixture-grandchild", sentinelPath)],
    { stdio: "ignore", windowsHide: true, shell: false }
  );
  invariant(
    Number.isSafeInteger(grandchild.pid) && Number(grandchild.pid) > 0,
    "fixture descendant PID를 만들지 못했습니다."
  );
  await writeFile(readyPath, JSON.stringify({
    rootPid: process.pid,
    descendantPid: grandchild.pid
  }), "utf8");
  setInterval(() => undefined, 1_000);
  return await new Promise<never>(() => undefined);
}

async function fixtureRootExits(): Promise<never> {
  const readyPath = process.argv[3]!;
  const sentinelPath = process.argv[4]!;
  const grandchild = spawn(
    process.execPath,
    [...fixtureNodeArguments("--fixture-grandchild", sentinelPath)],
    { stdio: "ignore", windowsHide: true, shell: false }
  );
  invariant(
    Number.isSafeInteger(grandchild.pid) && Number(grandchild.pid) > 0,
    "root-exit fixture descendant PID를 만들지 못했습니다."
  );
  await writeFile(readyPath, JSON.stringify({
    rootPid: process.pid,
    descendantPid: grandchild.pid
  }), "utf8");
  process.exit(19);
}

async function fixtureParent(): Promise<never> {
  const launcherPath = process.argv[3]!;
  const launcherReadyPath = process.argv[4]!;
  const treeReadyPath = process.argv[5]!;
  const sentinelPath = process.argv[6]!;
  const launcher = spawn(launcherPath, [
    "--parent-pid",
    String(process.pid),
    "--",
    process.execPath,
    ...fixtureNodeArguments("--fixture-tree", treeReadyPath, sentinelPath)
  ], {
    stdio: "ignore",
    windowsHide: true,
    shell: false
  });
  invariant(
    Number.isSafeInteger(launcher.pid) && Number(launcher.pid) > 0,
    "fixture launcher PID를 만들지 못했습니다."
  );
  await writeFile(launcherReadyPath, JSON.stringify({
    launcherPid: launcher.pid
  }), "utf8");
  setInterval(() => undefined, 1_000);
  return await new Promise<never>(() => undefined);
}

async function runSmoke(launcherPath: string): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-job-smoke-"));
  const failClosedSentinel = path.join(temporaryRoot, "invalid-parent-started.txt");
  const leakedHandleSentinel = path.join(temporaryRoot, "unexpected-fd-started.txt");
  const launcherReadyPath = path.join(temporaryRoot, "launcher-ready.json");
  const treeReadyPath = path.join(temporaryRoot, "tree-ready.json");
  const orphanSentinel = path.join(temporaryRoot, "orphan-survived.txt");
  const rootExitReadyPath = path.join(temporaryRoot, "root-exit-ready.json");
  const rootExitSentinel = path.join(temporaryRoot, "root-exit-orphan.txt");
  const crashReadyPath = path.join(temporaryRoot, "crash-ready.json");
  const crashSentinel = path.join(temporaryRoot, "launcher-crash-orphan.txt");
  const cleanupPids = new Set<number>();
  try {
    const contract = spawn(launcherPath, ["--contract"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    const contractResult = await waitForClose(contract);
    invariant(
      contractResult.code === 0
        && contractResult.signal === null
        && contractResult.stdout.trim() === WINDOWS_JOB_LAUNCHER_CONTRACT,
      `native launcher contract readback 실패: ${JSON.stringify(contractResult)}`
    );

    const exactExit = spawn(launcherPath, [
      "--parent-pid",
      String(process.pid),
      "--",
      process.execPath,
      ...fixtureNodeArguments(
        "--fixture-exit",
        "argument with spaces",
        "quote\"inside",
        "trailing-backslash\\"
      )
    ], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    const fd3 = exactExit.stdio[3];
    invariant(
      fd3 !== undefined && fd3 !== null && "end" in fd3,
      "launcher fd3 pipe가 열리지 않았습니다."
    );
    fd3.end("handle-bound-fd3");
    const exactExitResult = await waitForClose(exactExit);
    invariant(
      exactExitResult.code === 37
        && exactExitResult.signal === null
        && exactExitResult.stderr === "job-launcher-stderr\n",
      `child exit/stdio 전달이 정확하지 않습니다: ${JSON.stringify(exactExitResult)}`
    );
    const exactPayload = JSON.parse(exactExitResult.stdout) as {
      args?: unknown;
      payload?: unknown;
    };
    invariant(
      JSON.stringify(exactPayload.args) === JSON.stringify([
        "argument with spaces",
        "quote\"inside",
        "trailing-backslash\\"
      ])
        && exactPayload.payload === "handle-bound-fd3",
      "child argv 또는 inherited fd3 bytes가 바뀌었습니다."
    );

    const invalidParent = spawn(launcherPath, [
      "--parent-pid",
      "4",
      "--",
      process.execPath,
      ...fixtureNodeArguments("--fixture-touch", failClosedSentinel)
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    const invalidParentResult = await waitForClose(invalidParent);
    invariant(
      invalidParentResult.code === 241
        && invalidParentResult.signal === null
        && !(await exists(failClosedSentinel)),
      "잘못된 parent identity에서 child가 fail-closed되지 않았습니다."
    );

    const unexpectedDescriptor = spawn(launcherPath, [
      "--parent-pid",
      String(process.pid),
      "--",
      process.execPath,
      ...fixtureNodeArguments("--fixture-touch", leakedHandleSentinel)
    ], {
      stdio: ["ignore", "pipe", "pipe", "ignore", "pipe"],
      windowsHide: true,
      shell: false
    });
    const unexpectedDescriptorResult = await waitForClose(unexpectedDescriptor);
    invariant(
      unexpectedDescriptorResult.code === 249
        && unexpectedDescriptorResult.signal === null
        && !(await exists(leakedHandleSentinel)),
      "허용되지 않은 inherited fd가 child 권한으로 전달되었습니다."
    );

    const rootExitLauncher = spawn(launcherPath, [
      "--parent-pid",
      String(process.pid),
      "--",
      process.execPath,
      ...fixtureNodeArguments(
        "--fixture-root-exits",
        rootExitReadyPath,
        rootExitSentinel
      )
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    const rootExitClose = waitForClose(rootExitLauncher);
    await waitUntil(
      () => exists(rootExitReadyPath),
      "root-exit descendant가 준비되지 않았습니다."
    );
    const rootExitTree = JSON.parse(await readFile(rootExitReadyPath, "utf8")) as {
      descendantPid?: unknown;
    };
    const rootExitDescendantPid = Number(rootExitTree.descendantPid);
    invariant(
      Number.isSafeInteger(rootExitDescendantPid) && rootExitDescendantPid > 0,
      "root-exit descendant PID evidence가 올바르지 않습니다."
    );
    cleanupPids.add(rootExitDescendantPid);
    const rootExitResult = await rootExitClose;
    invariant(
      rootExitResult.code === 19 && rootExitResult.signal === null,
      "root child exit code가 launcher를 통과하지 않았습니다."
    );
    await waitUntil(
      () => !processIsAlive(rootExitDescendantPid),
      "root child 정상 종료 뒤 descendant가 orphan으로 남았습니다."
    );

    const crashLauncher = spawn(launcherPath, [
      "--parent-pid",
      String(process.pid),
      "--",
      process.execPath,
      ...fixtureNodeArguments("--fixture-tree", crashReadyPath, crashSentinel)
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    invariant(
      Number.isSafeInteger(crashLauncher.pid) && Number(crashLauncher.pid) > 0,
      "crash fixture launcher PID를 만들지 못했습니다."
    );
    cleanupPids.add(Number(crashLauncher.pid));
    const crashClose = waitForClose(crashLauncher);
    await waitUntil(
      () => exists(crashReadyPath),
      "launcher-crash descendant가 준비되지 않았습니다."
    );
    const crashTree = JSON.parse(await readFile(crashReadyPath, "utf8")) as {
      rootPid?: unknown;
      descendantPid?: unknown;
    };
    const crashProtectedPids = [
      Number(crashTree.rootPid),
      Number(crashTree.descendantPid)
    ];
    invariant(
      crashProtectedPids.every((pid) => Number.isSafeInteger(pid) && pid > 0),
      "launcher-crash process tree PID evidence가 올바르지 않습니다."
    );
    for (const processId of crashProtectedPids) {
      cleanupPids.add(processId);
      invariant(processIsAlive(processId), `crash fixture PID ${processId}가 조기 종료했습니다.`);
    }
    invariant(crashLauncher.kill("SIGKILL"), "launcher crash 주입에 실패했습니다.");
    await crashClose;
    await waitUntil(
      () => crashProtectedPids.every((processId) => !processIsAlive(processId)),
      "launcher crash 뒤 Job Object descendant가 orphan으로 남았습니다."
    );
    await new Promise((resolve) => setTimeout(
      resolve,
      FIXTURE_SENTINEL_DELAY_MS + 500
    ));
    invariant(
      !(await exists(rootExitSentinel)) && !(await exists(crashSentinel)),
      "root exit 또는 launcher crash 뒤 descendant sentinel이 실행됐습니다."
    );

    const fixtureParentProcess = spawn(
      process.execPath,
      [...fixtureNodeArguments(
        "--fixture-parent",
        launcherPath,
        launcherReadyPath,
        treeReadyPath,
        orphanSentinel
      )],
      { stdio: "ignore", windowsHide: true, shell: false }
    );
    invariant(
      Number.isSafeInteger(fixtureParentProcess.pid)
        && Number(fixtureParentProcess.pid) > 0,
      "fixture parent를 시작하지 못했습니다."
    );
    cleanupPids.add(Number(fixtureParentProcess.pid));
    await waitUntil(
      async () => await exists(launcherReadyPath) && await exists(treeReadyPath),
      "fixture process tree가 준비되지 않았습니다."
    );
    const launcherReady = JSON.parse(await readFile(launcherReadyPath, "utf8")) as {
      launcherPid?: unknown;
    };
    const treeReady = JSON.parse(await readFile(treeReadyPath, "utf8")) as {
      rootPid?: unknown;
      descendantPid?: unknown;
    };
    const protectedPids = [
      Number(launcherReady.launcherPid),
      Number(treeReady.rootPid),
      Number(treeReady.descendantPid)
    ];
    invariant(
      protectedPids.every((pid) => Number.isSafeInteger(pid) && pid > 0),
      "fixture process tree PID evidence가 올바르지 않습니다."
    );
    for (const processId of protectedPids) {
      cleanupPids.add(processId);
      invariant(processIsAlive(processId), `fixture PID ${processId}가 조기 종료했습니다.`);
    }
    invariant(
      fixtureParentProcess.kill("SIGKILL"),
      "fixture parent exact handle 종료에 실패했습니다."
    );
    await waitForClose(fixtureParentProcess);
    await waitUntil(
      () => protectedPids.every((processId) => !processIsAlive(processId)),
      "parent 종료 뒤 Job Object descendant가 orphan으로 남았습니다."
    );
    await new Promise((resolve) => setTimeout(
      resolve,
      FIXTURE_SENTINEL_DELAY_MS + 500
    ));
    invariant(
      !(await exists(orphanSentinel)),
      "Job Object descendant가 parent 종료 뒤 작업을 계속했습니다."
    );
  } finally {
    for (const processId of cleanupPids) {
      bestEffortTaskkill(processId);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (mode === "--fixture-exit") {
  await fixtureExit();
} else if (mode === "--fixture-touch") {
  await fixtureTouch();
} else if (mode === "--fixture-grandchild") {
  await fixtureGrandchild();
} else if (mode === "--fixture-tree") {
  await fixtureTree();
} else if (mode === "--fixture-root-exits") {
  await fixtureRootExits();
} else if (mode === "--fixture-parent") {
  await fixtureParent();
} else {
  invariant(process.platform === "win32", "native Job Object smoke는 Windows 전용입니다.");
  invariant(process.arch === "x64", "native Job Object smoke는 Windows x64 전용입니다.");
  invariant(process.argv.length <= 3, "사용법: windows-job-launcher-smoke.ts [launcher.exe]");
  const launcherPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : windowsJobLauncherResourcePaths(
      path.join(
        root,
        "dist",
        "desktop",
        "win32-x64",
        "Kirinuki-win32-x64",
        "resources"
      ),
      "win32-x64"
    ).executable;
  await runSmoke(launcherPath);
  console.log("Windows Job Object launcher native smoke: PASS");
}
