import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import process from "node:process";

const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_FINALIZATION_GRACE_MS = 5_000;

export interface RunReleaseCommandOptions {
  readonly capture?: boolean;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly finalizationGraceMs?: number;
  readonly onChildFinished?: (child: ChildProcess) => void;
  readonly onChildStarted?: (child: ChildProcess) => void;
  readonly signalChild?: (
    child: ChildProcess,
    signal: NodeJS.Signals
  ) => Error | null;
  readonly terminationGraceMs?: number;
  readonly timeoutMs?: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ESRCH";
}

/**
 * Signal the whole detached release command group on POSIX. Expected exit races
 * are harmless; every other failure is returned to the caller instead of being
 * thrown from a timer or process-exit callback.
 */
export function signalReleaseChild(
  child: ChildProcess,
  signal: NodeJS.Signals
): Error | null {
  try {
    if (process.platform !== "win32" && child.pid !== undefined) {
      process.kill(-child.pid, signal);
      return null;
    }
    const sent = child.kill(signal);
    if (
      !sent
      && child.exitCode === null
      && child.signalCode === null
    ) {
      return new Error(`릴리스 하위 프로세스에 ${signal} 신호를 전달하지 못했습니다.`);
    }
    return null;
  } catch (error) {
    return isNoSuchProcessError(error) ? null : normalizeError(error);
  }
}

function timeoutFailure(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  signalErrors: readonly Error[],
  childErrors: readonly Error[]
): Error {
  const relatedErrors = [...signalErrors, ...childErrors];
  const details = relatedErrors.length === 0
    ? ""
    : ` 종료 처리 오류: ${relatedErrors.map((error) => error.message).join(" | ")}`;
  return new Error(
    `${command} ${args.join(" ")}가 ${String(timeoutMs)}ms 제한을 넘었습니다.${details}`,
    relatedErrors[0] === undefined ? undefined : { cause: relatedErrors[0] }
  );
}

function stopUnclosedCapturedStreams(child: ChildProcess): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) {
      continue;
    }
    // Data listeners keep the pipes flowing until the final bounded deadline.
    // At that deadline no close event can be trusted, so close our pipe ends to
    // prevent an unkillable child from keeping the release process alive.
    stream.on("error", () => undefined);
    stream.destroy();
  }
  child.unref();
}

export function runReleaseCommand(
  command: string,
  args: readonly string[],
  {
    capture = false,
    cwd,
    environment,
    finalizationGraceMs = DEFAULT_FINALIZATION_GRACE_MS,
    onChildFinished,
    onChildStarted,
    signalChild = signalReleaseChild,
    terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS
  }: RunReleaseCommandOptions
): Promise<Buffer> {
  invariant(command.length > 0, "릴리스 명령이 비어 있습니다.");
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "릴리스 명령 timeout이 올바르지 않습니다.");
  invariant(
    Number.isSafeInteger(terminationGraceMs) && terminationGraceMs >= 0,
    "릴리스 명령 종료 유예 시간이 올바르지 않습니다."
  );
  invariant(
    Number.isSafeInteger(finalizationGraceMs) && finalizationGraceMs >= 0,
    "릴리스 명령 최종 종료 유예 시간이 올바르지 않습니다."
  );

  return new Promise<Buffer>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        cwd,
        detached: process.platform !== "win32",
        env: environment,
        shell: false,
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
      });
    } catch (error) {
      reject(normalizeError(error));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const signalErrors: Error[] = [];
    const childErrors: Error[] = [];
    let settled = false;
    let closed = false;
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;
    let finalizationTimer: NodeJS.Timeout | null = null;

    const appendStdout = (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.from(chunk));
    };
    const appendStderr = (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", appendStdout);
    child.stderr?.on("data", appendStderr);

    const clearTimers = () => {
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer);
      }
      if (finalizationTimer !== null) {
        clearTimeout(finalizationTimer);
      }
    };
    const finish = (error: Error | null, output = Buffer.alloc(0)) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      let finalError = error;
      try {
        onChildFinished?.(child);
      } catch (callbackError) {
        finalError ??= normalizeError(callbackError);
      }
      if (!closed) {
        stopUnclosedCapturedStreams(child);
      }
      if (finalError !== null) {
        reject(finalError);
      } else {
        resolve(output);
      }
    };
    const recordSignalResult = (signal: NodeJS.Signals) => {
      try {
        const signalError = signalChild(child, signal);
        if (signalError !== null) {
          signalErrors.push(signalError);
        }
      } catch (error) {
        // A supplied or platform-specific signal implementation is never
        // allowed to escape a timer callback.
        signalErrors.push(normalizeError(error));
      }
    };

    child.once("error", (error) => {
      const normalized = normalizeError(error);
      if (timedOut) {
        childErrors.push(normalized);
        return;
      }
      finish(normalized);
    });
    child.once("close", (code, signal) => {
      closed = true;
      if (settled) {
        return;
      }
      if (timedOut) {
        finish(timeoutFailure(command, args, timeoutMs, signalErrors, childErrors));
        return;
      }
      if (code === 0) {
        finish(null, Buffer.concat(stdoutChunks));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      finish(new Error(
        signal
          ? `${command}가 ${signal} 신호로 종료됐습니다.`
          : `${command}가 종료 코드 ${String(code)}로 끝났습니다.`
            + (stderr ? `\n${stderr}` : "")
      ));
    });

    try {
      onChildStarted?.(child);
    } catch (error) {
      recordSignalResult("SIGKILL");
      finish(normalizeError(error));
      return;
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      recordSignalResult("SIGTERM");
      forceKillTimer = setTimeout(() => {
        recordSignalResult("SIGKILL");
        finalizationTimer = setTimeout(() => {
          finish(timeoutFailure(command, args, timeoutMs, signalErrors, childErrors));
        }, finalizationGraceMs);
      }, terminationGraceMs);
    }, timeoutMs);
  });
}
