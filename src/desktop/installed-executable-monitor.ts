import { lstat } from "node:fs/promises";
import path from "node:path";

export const INSTALLED_EXECUTABLE_MONITOR_INTERVAL_MS = 500;

interface InstalledExecutableIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly birthtimeNs: bigint;
}

export interface InstalledExecutableMonitor {
  readonly checkNow: () => Promise<"present" | "missing" | "replaced">;
  readonly stop: () => void;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function executableIdentity(
  executablePath: string
): Promise<Readonly<InstalledExecutableIdentity>> {
  const metadata = await lstat(executablePath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0n) {
    throw new Error("설치된 Kirinuki executable이 regular file이 아닙니다.");
  }
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    birthtimeNs: metadata.birthtimeNs
  });
}

function sameIdentity(
  left: Readonly<InstalledExecutableIdentity>,
  right: Readonly<InstalledExecutableIdentity>
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.birthtimeNs === right.birthtimeNs;
}

/**
 * Watches only the exact executable that created this process. A removed,
 * moved, or atomically replaced install is reported once; no process lookup,
 * basename matching, or third-party path traversal is performed.
 */
export async function monitorInstalledExecutable({
  executablePath,
  onInstallChanged,
  intervalMs = INSTALLED_EXECUTABLE_MONITOR_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
}: {
  readonly executablePath: string;
  readonly onInstallChanged: (reason: "missing" | "replaced") => void;
  readonly intervalMs?: number;
  readonly setIntervalImpl?: typeof setInterval;
  readonly clearIntervalImpl?: typeof clearInterval;
}): Promise<Readonly<InstalledExecutableMonitor>> {
  if (
    typeof executablePath !== "string"
    || executablePath.trim() !== executablePath
    || !path.isAbsolute(executablePath)
    || /[\u0000-\u001f\u007f]/u.test(executablePath)
    || typeof onInstallChanged !== "function"
    || !Number.isSafeInteger(intervalMs)
    || intervalMs < 100
    || intervalMs > 10_000
  ) {
    throw new TypeError("설치 executable 감시 계약이 올바르지 않습니다.");
  }
  const normalized = path.resolve(executablePath);
  const initial = await executableIdentity(normalized);
  let stopped = false;
  let checking = false;
  let notified = false;

  let changeReason: "missing" | "replaced" | null = null;
  const checkNow = async (): Promise<"present" | "missing" | "replaced"> => {
    if (notified) {
      return changeReason!;
    }
    let current: Readonly<InstalledExecutableIdentity>;
    try {
      current = await executableIdentity(normalized);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      notified = true;
      changeReason = "missing";
      onInstallChanged(changeReason);
      return changeReason;
    }
    if (!sameIdentity(initial, current)) {
      notified = true;
      changeReason = "replaced";
      onInstallChanged(changeReason);
      return changeReason;
    }
    return "present";
  };

  const timer = setIntervalImpl(() => {
    if (stopped || checking || notified) {
      return;
    }
    checking = true;
    void checkNow().catch(() => {
      // A permission or transient metadata error does not establish that this
      // exact install disappeared. Keep watching; only ENOENT/ENOTDIR or a
      // positive file-identity mismatch can authorize registration cleanup.
    }).finally(() => {
      checking = false;
    });
  }, intervalMs);
  (timer as NodeJS.Timeout).unref?.();

  return Object.freeze({
    checkNow,
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearIntervalImpl(timer);
    }
  });
}
