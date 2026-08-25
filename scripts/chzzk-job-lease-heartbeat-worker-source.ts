export const CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE = `
import os from "node:os";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const configuration = workerData;
if (
  !parentPort
  || !configuration
  || typeof configuration.databasePath !== "string"
  || !path.isAbsolute(configuration.databasePath)
  || path.basename(configuration.databasePath) !== ".materializing-lock.sqlite3"
  || typeof configuration.schemaId !== "string"
  || configuration.schemaId !== "chzzk-kirinuki/chzzk-vod-job-lease-v3"
  || typeof configuration.ownerId !== "string"
  || !/^[a-f0-9]{48}$/u.test(configuration.ownerId)
  || !Number.isSafeInteger(configuration.initialRevision)
  || configuration.initialRevision < 1
  || !Number.isSafeInteger(configuration.intervalMs)
  || configuration.intervalMs < 50
  || !Number.isSafeInteger(configuration.busyTimeoutMs)
  || configuration.busyTimeoutMs < 1
) {
  throw new Error("Invalid job lease heartbeat worker configuration.");
}

let database;
let timer;
let revision = configuration.initialRevision;
let stopped = false;

function bootClockMs() {
  const milliseconds = Math.floor(os.uptime() * 1_000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Operating-system boot clock is unavailable.");
  }
  return milliseconds;
}

function closeDatabase() {
  if (!database) {
    return;
  }
  const current = database;
  database = undefined;
  current.close();
}

function failClosed() {
  if (stopped) {
    return;
  }
  stopped = true;
  if (timer) {
    clearInterval(timer);
  }
  try {
    closeDatabase();
  } catch {
    // The parent treats every worker failure as a lost lease.
  }
  parentPort.postMessage({ type: "failure" });
}

function heartbeat() {
  if (stopped) {
    return;
  }
  try {
    if (!Number.isSafeInteger(revision + 1)) {
      throw new Error("Job lease revision overflowed.");
    }
    const result = database.prepare(\`
      UPDATE materialization_job_lease
      SET heartbeat_at_boot_ms = ?, revision = revision + 1
      WHERE singleton = 1 AND schema_id = ? AND owner_id = ? AND revision = ?
    \`).run(
      bootClockMs(),
      configuration.schemaId,
      configuration.ownerId,
      revision
    );
    if (Number(result.changes) !== 1) {
      throw new Error("Job lease ownership was lost before heartbeat.");
    }
    revision += 1;
  } catch {
    failClosed();
  }
}

try {
  database = new DatabaseSync(configuration.databasePath);
  database.exec(\`
    PRAGMA busy_timeout = \${configuration.busyTimeoutMs};
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA trusted_schema = OFF;
  \`);
  parentPort.on("message", (message) => {
    if (!message || message.type !== "stop" || stopped) {
      return;
    }
    stopped = true;
    if (timer) {
      clearInterval(timer);
    }
    try {
      closeDatabase();
      parentPort.postMessage({ type: "stopped" });
    } catch {
      parentPort.postMessage({ type: "failure" });
    }
  });
  timer = setInterval(heartbeat, configuration.intervalMs);
  parentPort.postMessage({ type: "ready" });
} catch {
  failClosed();
}
`;
