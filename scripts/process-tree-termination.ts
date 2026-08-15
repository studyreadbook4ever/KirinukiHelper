import type { ChildProcess, spawn } from "node:child_process";

export const WINDOWS_TASKKILL_MAX_ATTEMPTS = 2;
const WINDOWS_TASKKILL_PHASES_PER_ATTEMPT = 3;
const DEFAULT_PROCESS_ABSENCE_POLL_MS = 50;

type SetTimeoutImplementation = typeof setTimeout;
type ClearTimeoutImplementation = typeof clearTimeout;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new TypeError(message);
  }
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function isEsrch(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ESRCH";
}

function isEperm(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "EPERM";
}

function phaseTimeoutMs(totalTimeoutMs: number): number {
  return Math.max(
    1,
    Math.floor(
      totalTimeoutMs
        / (WINDOWS_TASKKILL_MAX_ATTEMPTS * WINDOWS_TASKKILL_PHASES_PER_ATTEMPT)
    )
  );
}

/** Upper bound used by the taskkill helper itself, excluding scheduler jitter. */
export function windowsTaskkillMaximumDurationMs(totalTimeoutMs: number): number {
  invariant(
    Number.isSafeInteger(totalTimeoutMs) && totalTimeoutMs > 0,
    "Windows taskkill 전체 시간 제한이 올바르지 않습니다."
  );
  return phaseTimeoutMs(totalTimeoutMs)
    * WINDOWS_TASKKILL_MAX_ATTEMPTS
    * WINDOWS_TASKKILL_PHASES_PER_ATTEMPT;
}

/**
 * The caller's guard is deliberately one full phase later than every timeout
 * the default taskkill helper can consume. This prevents the old equal-deadline
 * race where the caller settled while a taskkill helper was still open.
 */
export function windowsTaskkillOuterGuardTimeoutMs(totalTimeoutMs: number): number {
  return windowsTaskkillMaximumDurationMs(totalTimeoutMs)
    + phaseTimeoutMs(totalTimeoutMs);
}

async function delay(
  milliseconds: number,
  setTimeoutImpl: SetTimeoutImplementation
): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeoutImpl(resolve, milliseconds);
  });
}

export async function pollProcessAbsence({
  processId,
  probeProcessImpl,
  timeoutMs,
  pollIntervalMs = DEFAULT_PROCESS_ABSENCE_POLL_MS,
  setTimeoutImpl = setTimeout
}: {
  readonly processId: number;
  readonly probeProcessImpl: (processId: number) => void;
  readonly timeoutMs: number;
  readonly pollIntervalMs?: number;
  readonly setTimeoutImpl?: SetTimeoutImplementation;
}): Promise<boolean> {
  invariant(
    Number.isSafeInteger(processId) && processId > 0,
    "확인할 process 식별자가 올바르지 않습니다."
  );
  invariant(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 0,
    "process 소멸 확인 시간 제한이 올바르지 않습니다."
  );
  invariant(
    Number.isSafeInteger(pollIntervalMs) && pollIntervalMs > 0,
    "process 소멸 확인 주기가 올바르지 않습니다."
  );
  let remainingMs = timeoutMs;
  while (true) {
    try {
      probeProcessImpl(processId);
    } catch (error) {
      if (isEsrch(error)) {
        return true;
      }
      // POSIX kill(pid, 0) reports EPERM when the target still exists but is
      // not currently signalable. Treat that as present and keep the bounded
      // poll; only ESRCH proves that the owned group disappeared.
      if (!isEperm(error)) {
        throw error;
      }
    }
    if (remainingMs === 0) {
      return false;
    }
    const waitMs = Math.min(pollIntervalMs, remainingMs);
    await delay(waitMs, setTimeoutImpl);
    remainingMs -= waitMs;
  }
}

export async function terminatePosixProcessGroup({
  processGroupId,
  signalProcessGroupImpl,
  probeProcessGroupImpl,
  graceMs,
  setTimeoutImpl = setTimeout
}: {
  readonly processGroupId: number;
  readonly signalProcessGroupImpl: (
    processGroupId: number,
    signal: NodeJS.Signals
  ) => void;
  readonly probeProcessGroupImpl: (processGroupId: number) => void;
  readonly graceMs: number;
  readonly setTimeoutImpl?: SetTimeoutImplementation;
}): Promise<void> {
  invariant(
    Number.isSafeInteger(processGroupId) && processGroupId > 0,
    "POSIX process group 식별자가 올바르지 않습니다."
  );
  invariant(
    Number.isSafeInteger(graceMs) && graceMs >= 0,
    "POSIX process group 종료 대기 시간이 올바르지 않습니다."
  );
  const pollIntervalMs = Math.min(
    DEFAULT_PROCESS_ABSENCE_POLL_MS,
    Math.max(1, graceMs)
  );
  const isAbsent = async (): Promise<boolean> => await pollProcessAbsence({
    processId: processGroupId,
    probeProcessImpl: probeProcessGroupImpl,
    timeoutMs: graceMs,
    pollIntervalMs,
    setTimeoutImpl
  });
  const signalIfPresent = (signal: NodeJS.Signals): boolean => {
    try {
      signalProcessGroupImpl(processGroupId, signal);
      return true;
    } catch (error) {
      if (isEsrch(error)) {
        return false;
      }
      throw error;
    }
  };

  if (await pollProcessAbsence({
    processId: processGroupId,
    probeProcessImpl: probeProcessGroupImpl,
    timeoutMs: 0,
    pollIntervalMs,
    setTimeoutImpl
  })) {
    return;
  }
  if (!signalIfPresent("SIGTERM") || await isAbsent()) {
    return;
  }
  if (!signalIfPresent("SIGKILL") || await isAbsent()) {
    return;
  }
  throw codedError(
    `POSIX process group ${processGroupId}가 SIGKILL 뒤에도 남아 있습니다.`,
    "EPROCESSGROUPALIVE"
  );
}

interface BoundedOutcome<T> {
  readonly timedOut: boolean;
  readonly value?: T;
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  setTimeoutImpl: SetTimeoutImplementation,
  clearTimeoutImpl: ClearTimeoutImplementation
): Promise<BoundedOutcome<T>> {
  return await new Promise<BoundedOutcome<T>>((resolve) => {
    let settled = false;
    const timer = setTimeoutImpl(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    void promise.then((value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeoutImpl(timer);
      resolve({ timedOut: false, value });
    }, () => {
      // Callers pass promises whose errors are represented in their value.
      if (settled) {
        return;
      }
      settled = true;
      clearTimeoutImpl(timer);
      resolve({ timedOut: true });
    });
  });
}

interface TaskkillCloseOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnError?: Error;
}

async function runTaskkillHelper({
  command,
  args,
  spawnImpl,
  phaseMs,
  setTimeoutImpl,
  clearTimeoutImpl
}: {
  readonly command: string;
  readonly args: readonly string[];
  readonly spawnImpl: typeof spawn;
  readonly phaseMs: number;
  readonly setTimeoutImpl: SetTimeoutImplementation;
  readonly clearTimeoutImpl: ClearTimeoutImplementation;
}): Promise<TaskkillCloseOutcome> {
  let killer: ChildProcess;
  try {
    killer = spawnImpl(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
  } catch (error) {
    return {
      exitCode: null,
      signal: null,
      spawnError: error instanceof Error ? error : new Error("taskkill 실행 실패")
    };
  }
  let spawnError: Error | undefined;
  let onClose: (
    exitCode: number | null,
    signal: NodeJS.Signals | null
  ) => void;
  const onError = (error: Error): void => {
    spawnError ??= error;
  };
  const closePromise = new Promise<TaskkillCloseOutcome>((resolve) => {
    onClose = (exitCode, signal) => {
      killer.removeListener("error", onError);
      resolve({
        exitCode,
        signal,
        ...(spawnError ? { spawnError } : {})
      });
    };
    killer.once("error", onError);
    killer.once("close", onClose);
  });
  const initial = await settleWithin(
    closePromise,
    phaseMs,
    setTimeoutImpl,
    clearTimeoutImpl
  );
  if (!initial.timedOut && initial.value) {
    return initial.value;
  }
  try {
    killer.kill("SIGKILL");
  } catch {
    // The bounded close wait below remains authoritative.
  }
  const forced = await settleWithin(
    closePromise,
    phaseMs,
    setTimeoutImpl,
    clearTimeoutImpl
  );
  if (!forced.timedOut && forced.value) {
    return forced.value;
  }
  killer.removeListener("error", onError);
  killer.removeListener("close", onClose!);
  throw codedError(
    "Windows taskkill helper가 강제 종료 뒤에도 close되지 않았습니다.",
    "EPROCESSTREEHELPER"
  );
}

export async function terminateWindowsProcessTreeWithTaskkill({
  processId,
  command,
  args,
  spawnImpl,
  probeProcessImpl,
  confirmTargetIdentityImpl,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  timeoutMs
}: {
  readonly processId: number;
  readonly command: string;
  readonly args: readonly string[];
  readonly spawnImpl: typeof spawn;
  readonly probeProcessImpl: (processId: number) => void;
  readonly confirmTargetIdentityImpl?: () => Promise<boolean>;
  readonly setTimeoutImpl?: SetTimeoutImplementation;
  readonly clearTimeoutImpl?: ClearTimeoutImplementation;
  readonly timeoutMs: number;
}): Promise<void> {
  invariant(
    Number.isSafeInteger(processId) && processId > 0,
    "Windows process tree 식별자가 올바르지 않습니다."
  );
  windowsTaskkillMaximumDurationMs(timeoutMs);
  const phaseMs = phaseTimeoutMs(timeoutMs);

  if (await pollProcessAbsence({
    processId,
    probeProcessImpl,
    timeoutMs: 0,
    pollIntervalMs: phaseMs,
    setTimeoutImpl
  })) {
    return;
  }

  let lastOutcome: TaskkillCloseOutcome | undefined;
  for (let attempt = 0; attempt < WINDOWS_TASKKILL_MAX_ATTEMPTS; attempt += 1) {
    if (
      confirmTargetIdentityImpl
      && !await confirmTargetIdentityImpl()
    ) {
      // The captured target exited or its PID was reused. Never signal the
      // current, unbound process merely to make cleanup appear successful.
      return;
    }
    lastOutcome = await runTaskkillHelper({
      command,
      args,
      spawnImpl,
      phaseMs,
      setTimeoutImpl,
      clearTimeoutImpl
    });
    if (await pollProcessAbsence({
      processId,
      probeProcessImpl,
      timeoutMs: phaseMs,
      pollIntervalMs: phaseMs,
      setTimeoutImpl
    })) {
      return;
    }
  }
  const detail = lastOutcome?.spawnError?.message
    || `taskkill exit=${lastOutcome?.exitCode ?? -1}`;
  throw codedError(
    `Windows process tree leader가 taskkill 재시도 뒤에도 남아 있습니다: ${detail}`,
    "EPROCESSTREE"
  );
}
