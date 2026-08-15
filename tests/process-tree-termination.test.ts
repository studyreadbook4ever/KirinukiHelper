import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  terminatePosixProcessGroup,
  terminateWindowsProcessTreeWithTaskkill,
  windowsTaskkillMaximumDurationMs,
  windowsTaskkillOuterGuardTimeoutMs
} from "../scripts/process-tree-termination.js";

function esrch(): Error {
  return Object.assign(new Error("missing"), { code: "ESRCH" });
}

function manualTimers(): Readonly<{
  scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }>;
  setTimeoutImpl: typeof setTimeout;
  clearTimeoutImpl: typeof clearTimeout;
  runNext: () => Promise<void>;
}> {
  const scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  const handles = new Map<object, (typeof scheduled)[number]>();
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    const task = { callback, delay, cleared: false };
    const handle = {};
    scheduled.push(task);
    handles.set(handle, task);
    return handle;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: object) => {
    const task = handles.get(handle);
    if (task) {
      task.cleared = true;
    }
  }) as unknown as typeof clearTimeout;
  const runNext = async (): Promise<void> => {
    const task = scheduled.find(({ cleared }) => !cleared);
    assert(task, "실행할 timer가 있어야 합니다.");
    task.cleared = true;
    task.callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return { scheduled, setTimeoutImpl, clearTimeoutImpl, runNext };
}

test("POSIX group은 TERM 뒤 ESRCH가 확인되면 KILL하지 않는다", async () => {
  const timers = manualTimers();
  let alive = true;
  let probes = 0;
  const signals: NodeJS.Signals[] = [];
  const pending = terminatePosixProcessGroup({
    processGroupId: 4_321,
    graceMs: 9,
    setTimeoutImpl: timers.setTimeoutImpl,
    signalProcessGroupImpl: (_pid, signal) => signals.push(signal),
    probeProcessGroupImpl: () => {
      probes += 1;
      if (!alive) {
        throw esrch();
      }
    }
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(signals, ["SIGTERM"]);
  alive = false;
  await timers.runNext();
  await pending;
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(probes, 3);
});

test("POSIX group은 TERM grace 뒤 KILL하고 post-KILL ESRCH까지 기다린다", async () => {
  const timers = manualTimers();
  let alive = true;
  const signals: NodeJS.Signals[] = [];
  const pending = terminatePosixProcessGroup({
    processGroupId: 5_432,
    graceMs: 7,
    setTimeoutImpl: timers.setTimeoutImpl,
    signalProcessGroupImpl: (_pid, signal) => signals.push(signal),
    probeProcessGroupImpl: () => {
      if (!alive) {
        throw esrch();
      }
    }
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(signals, ["SIGTERM"]);
  await timers.runNext();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  let settled = false;
  void pending.finally(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  alive = false;
  await timers.runNext();
  await pending;
  assert.equal(settled, true);
});

test("POSIX group이 SIGKILL 뒤에도 남으면 fail-closed 한다", async () => {
  const timers = manualTimers();
  const pending = terminatePosixProcessGroup({
    processGroupId: 6_543,
    graceMs: 5,
    setTimeoutImpl: timers.setTimeoutImpl,
    signalProcessGroupImpl: () => undefined,
    probeProcessGroupImpl: () => undefined
  });
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === "EPROCESSGROUPALIVE"
  ));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await timers.runNext();
  await timers.runNext();
  await rejected;
});

test("taskkill timeout은 helper close를 기다린 뒤 leader absence를 확인한다", async () => {
  const timers = manualTimers();
  let alive = true;
  let settled = false;
  const helperSignals: Array<NodeJS.Signals | number | undefined> = [];
  const helper = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  helper.kill = (signal) => {
    helperSignals.push(signal);
    return true;
  };
  const pending = terminateWindowsProcessTreeWithTaskkill({
    processId: 7_654,
    command: "C:\\Windows\\System32\\taskkill.exe",
    args: ["/PID", "7654", "/T", "/F"],
    spawnImpl: (() => helper as unknown as ChildProcess) as unknown as typeof spawn,
    probeProcessImpl: () => {
      if (!alive) {
        throw esrch();
      }
    },
    timeoutMs: 6,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl
  });
  void pending.finally(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await timers.runNext();
  assert.deepEqual(helperSignals, ["SIGKILL"]);
  assert.equal(settled, false);
  alive = false;
  helper.emit("close", null, "SIGKILL");
  await pending;
  assert.equal(settled, true);
});

test("taskkill은 leader가 남으면 exact argv로 한 번 재시도한다", async () => {
  const timers = manualTimers();
  let alive = true;
  const invocations: Array<{
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  }> = [];
  const spawnImpl = ((
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => {
    invocations.push({ command, args, options });
    const helper = new EventEmitter();
    const attempt = invocations.length;
    queueMicrotask(() => {
      if (attempt === 2) {
        alive = false;
      }
      helper.emit("close", attempt === 1 ? 1 : 0, null);
    });
    return helper as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = terminateWindowsProcessTreeWithTaskkill({
    processId: 8_765,
    command: "C:\\Windows\\System32\\taskkill.exe",
    args: ["/PID", "8765", "/T", "/F"],
    spawnImpl,
    probeProcessImpl: () => {
      if (!alive) {
        throw esrch();
      }
    },
    timeoutMs: 12,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(invocations.length, 1);
  await timers.runNext();
  await pending;
  assert.equal(invocations.length, 2);
  for (const invocation of invocations) {
    assert.equal(invocation.command, "C:\\Windows\\System32\\taskkill.exe");
    assert.deepEqual(invocation.args, ["/PID", "8765", "/T", "/F"]);
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.windowsHide, true);
    assert.equal(invocation.options.stdio, "ignore");
  }
});

test("taskkill 재시도 직전 captured identity가 바뀌면 새 PID owner를 건드리지 않는다", async () => {
  const timers = manualTimers();
  let identityStillMatches = true;
  let confirmations = 0;
  let invocations = 0;
  const pending = terminateWindowsProcessTreeWithTaskkill({
    processId: 8_876,
    command: "taskkill.exe",
    args: ["/PID", "8876", "/T", "/F"],
    spawnImpl: (() => {
      invocations += 1;
      const helper = new EventEmitter();
      queueMicrotask(() => helper.emit("close", 1, null));
      return helper as unknown as ChildProcess;
    }) as unknown as typeof spawn,
    probeProcessImpl: () => undefined,
    confirmTargetIdentityImpl: async () => {
      confirmations += 1;
      return identityStillMatches;
    },
    timeoutMs: 12,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(invocations, 1);
  identityStillMatches = false;
  await timers.runNext();
  await pending;
  assert.equal(invocations, 1);
  assert.equal(confirmations, 2);
});

test("taskkill helper가 SIGKILL 뒤에도 close되지 않으면 bounded 실패한다", async () => {
  const timers = manualTimers();
  const helper = new EventEmitter() as EventEmitter & {
    kill: () => boolean;
  };
  helper.kill = () => true;
  const pending = terminateWindowsProcessTreeWithTaskkill({
    processId: 9_876,
    command: "taskkill.exe",
    args: ["/PID", "9876", "/T", "/F"],
    spawnImpl: (() => helper as unknown as ChildProcess) as unknown as typeof spawn,
    probeProcessImpl: () => undefined,
    timeoutMs: 6,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl
  });
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === "EPROCESSTREEHELPER"
  ));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await timers.runNext();
  await timers.runNext();
  await rejected;
  assert.equal(helper.listenerCount("close"), 0);
  assert.equal(helper.listenerCount("error"), 0);
});

test("Windows outer guard는 default helper의 전체 bound보다 엄격히 늦다", () => {
  for (const timeoutMs of [1, 5, 17, 5_000]) {
    assert(
      windowsTaskkillOuterGuardTimeoutMs(timeoutMs)
        > windowsTaskkillMaximumDurationMs(timeoutMs)
    );
  }
});
