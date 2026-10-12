export const CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES = 4_096;
export const CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES = 32;
export const CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES = 256 * 1_024;
export const CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES = 768 * 1_024;
export const CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES = 64 * 1_024;
export const CHZZK_JOB_LEASE_HEARTBEAT_SYNCHRONOUS = 1;

export const CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE = `
import { lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const expectedSqlitePageBytes = ${CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES};
const expectedWalAutocheckpointPages = ${CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES};
const expectedJournalSizeLimitBytes = ${CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES};
const expectedWalSoftLimitBytes = ${CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES};
const expectedWalCommitMarginBytes = ${CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES};
const expectedHeartbeatSynchronous = ${CHZZK_JOB_LEASE_HEARTBEAT_SYNCHRONOUS};
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
  || !Number.isSafeInteger(configuration.initialHeartbeatAtBootMs)
  || configuration.initialHeartbeatAtBootMs < 0
  || !Number.isSafeInteger(configuration.intervalMs)
  || configuration.intervalMs < 50
  || !Number.isSafeInteger(configuration.busyTimeoutMs)
  || configuration.busyTimeoutMs < 1
  || !Number.isSafeInteger(configuration.leaseMs)
  || configuration.leaseMs < configuration.busyTimeoutMs * 3
  || configuration.intervalMs > Math.floor(configuration.leaseMs / 3)
  || configuration.sqlitePageBytes !== expectedSqlitePageBytes
  || configuration.walAutocheckpointPages !== expectedWalAutocheckpointPages
  || configuration.journalSizeLimitBytes !== expectedJournalSizeLimitBytes
  || configuration.walSoftLimitBytes !== expectedWalSoftLimitBytes
  || configuration.walCommitMarginBytes !== expectedWalCommitMarginBytes
  || !Number.isSafeInteger(configuration.maximumSidecarBytes)
  || configuration.maximumSidecarBytes
    <= configuration.walSoftLimitBytes + configuration.walCommitMarginBytes
) {
  throw new Error("Invalid job lease heartbeat worker configuration.");
}

let database;
let timer;
let revision = configuration.initialRevision;
let stopped = false;
let ready = false;
let lastSuccessfulHeartbeatAtBootMs = configuration.initialHeartbeatAtBootMs;
const busyRetryDelayMs = Math.max(50, Math.min(250, configuration.intervalMs));

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
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  try {
    closeDatabase();
  } catch {
    // The parent treats every worker failure as a lost lease.
  }
  parentPort.postMessage({ type: "failure" });
}

function nodeErrorCode(error) {
  return error
    && typeof error === "object"
    && typeof error.code === "string"
    ? error.code
    : undefined;
}

function sqlitePrimaryErrorNumber(error) {
  const extendedCode = error
    && typeof error === "object"
    && Number.isSafeInteger(error.errcode)
    ? Number(error.errcode)
    : undefined;
  return extendedCode !== undefined && extendedCode >= 0
    ? extendedCode & 0xff
    : undefined;
}

function pragmaScalar(name) {
  const record = database.prepare("PRAGMA " + name).get();
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Job lease SQLite returned an invalid PRAGMA result.");
  }
  const values = Object.values(record);
  if (values.length !== 1) {
    throw new Error("Job lease SQLite returned an ambiguous PRAGMA result.");
  }
  return values[0];
}

function assertSqliteConfiguration() {
  const expectedPragmas = [
    ["busy_timeout", configuration.busyTimeoutMs],
    ["journal_mode", "wal"],
    ["synchronous", expectedHeartbeatSynchronous],
    ["page_size", configuration.sqlitePageBytes],
    ["wal_autocheckpoint", configuration.walAutocheckpointPages],
    ["journal_size_limit", configuration.journalSizeLimitBytes],
    ["trusted_schema", 0]
  ];
  for (const [name, expected] of expectedPragmas) {
    if (pragmaScalar(name) !== expected) {
      throw new Error("Job lease SQLite rejected a required PRAGMA.");
    }
  }
}

function sidecarBytes(suffix) {
  const candidate = configuration.databasePath + suffix;
  let status;
  try {
    status = lstatSync(candidate, { bigint: true });
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (
    !status.isFile()
    || status.isSymbolicLink()
    || status.nlink !== 1n
    || status.size > BigInt(configuration.maximumSidecarBytes)
  ) {
    throw new Error("Job lease SQLite sidecar exceeded its safety contract.");
  }
  return Number(status.size);
}

function assertSidecarsWithinHardLimit() {
  sidecarBytes("-wal");
  sidecarBytes("-shm");
  sidecarBytes("-journal");
}

function readPassiveCheckpoint() {
  const record = database.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Job lease SQLite returned an invalid checkpoint result.");
  }
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "busy,checkpointed,log") {
    throw new Error("Job lease SQLite returned an ambiguous checkpoint result.");
  }
  const busy = Number(record.busy);
  const log = Number(record.log);
  const checkpointed = Number(record.checkpointed);
  if (
    ![busy, log, checkpointed].every(Number.isSafeInteger)
    || busy < 0
    || log < 0
    || checkpointed < 0
    || checkpointed > log
  ) {
    throw new Error("Job lease SQLite returned an invalid checkpoint count.");
  }
  return { busy, log, checkpointed };
}

function prepareWalForHeartbeat() {
  const maximumBeforeCommit = configuration.maximumSidecarBytes
    - configuration.walCommitMarginBytes;
  const beforeCheckpoint = sidecarBytes("-wal");
  if (beforeCheckpoint > maximumBeforeCommit) {
    throw new Error("Job lease SQLite WAL has no safe commit margin.");
  }
  if (beforeCheckpoint <= configuration.walSoftLimitBytes) {
    return;
  }
  const checkpoint = readPassiveCheckpoint();
  if (
    checkpoint.busy !== 0
    || checkpoint.log !== checkpoint.checkpointed
  ) {
    throw new Error("Job lease SQLite WAL checkpoint is starved by a reader.");
  }
  if (sidecarBytes("-wal") > maximumBeforeCommit) {
    throw new Error("Job lease SQLite WAL remained too large after checkpoint.");
  }
}

function scheduleHeartbeat(delayMs = configuration.intervalMs) {
  if (stopped) {
    return;
  }
  // A transaction or WAL checkpoint can outlive the nominal interval on an HDD.
  // Scheduling after it returns prevents overdue interval callbacks from
  // running back-to-back and starving the parent's ownership read.
  timer = setTimeout(() => {
    timer = undefined;
    heartbeat();
  }, delayMs);
}

function heartbeatAttemptDeadlineBootMs() {
  const deadline = lastSuccessfulHeartbeatAtBootMs
    + configuration.leaseMs
    - configuration.busyTimeoutMs
    - busyRetryDelayMs;
  if (!Number.isSafeInteger(deadline) || deadline < 0) {
    throw new Error("Job lease heartbeat retry deadline is invalid.");
  }
  return deadline;
}

function heartbeat() {
  if (stopped) {
    return;
  }
  let transactionStarted = false;
  try {
    if (bootClockMs() >= heartbeatAttemptDeadlineBootMs()) {
      throw new Error("Job lease heartbeat cannot safely start before expiry.");
    }
    if (!Number.isSafeInteger(revision + 1)) {
      throw new Error("Job lease revision overflowed.");
    }
    prepareWalForHeartbeat();
    if (bootClockMs() >= heartbeatAttemptDeadlineBootMs()) {
      throw new Error("Job lease heartbeat preparation exceeded its deadline.");
    }
    database.exec("BEGIN IMMEDIATE;");
    transactionStarted = true;
    const maximumBeforeCommit = configuration.maximumSidecarBytes
      - configuration.walCommitMarginBytes;
    if (sidecarBytes("-wal") > maximumBeforeCommit) {
      throw new Error("Job lease SQLite WAL lost its safe commit margin.");
    }
    if (bootClockMs() >= heartbeatAttemptDeadlineBootMs()) {
      throw new Error("Job lease heartbeat lock acquisition exceeded its deadline.");
    }
    const heartbeatAtBootMs = bootClockMs();
    const result = database.prepare(\`
      UPDATE materialization_job_lease
      SET heartbeat_at_boot_ms = ?, revision = revision + 1
      WHERE singleton = 1 AND schema_id = ? AND owner_id = ? AND revision = ?
    \`).run(
      heartbeatAtBootMs,
      configuration.schemaId,
      configuration.ownerId,
      revision
    );
    if (Number(result.changes) !== 1) {
      throw new Error("Job lease ownership was lost before heartbeat.");
    }
    database.exec("COMMIT;");
    transactionStarted = false;
    revision += 1;
    lastSuccessfulHeartbeatAtBootMs = heartbeatAtBootMs;
    assertSidecarsWithinHardLimit();
    const readyToScheduleAtBootMs = bootClockMs();
    const nextAttemptDeadlineBootMs = heartbeatAttemptDeadlineBootMs();
    if (readyToScheduleAtBootMs >= nextAttemptDeadlineBootMs) {
      throw new Error("Committed job lease heartbeat has too little safe lifetime.");
    }
    const nextDelayMs = readyToScheduleAtBootMs + configuration.intervalMs
      >= nextAttemptDeadlineBootMs
      ? 0
      : configuration.intervalMs;
    if (!ready) {
      ready = true;
      parentPort.postMessage({ type: "ready" });
    }
    scheduleHeartbeat(nextDelayMs);
  } catch (error) {
    let rollbackFailed = false;
    if (transactionStarted) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        rollbackFailed = true;
      }
    }
    if (!rollbackFailed && sqlitePrimaryErrorNumber(error) === 5) {
      try {
        const now = bootClockMs();
        if (now < heartbeatAttemptDeadlineBootMs()) {
          scheduleHeartbeat(busyRetryDelayMs);
          return;
        }
      } catch {
        // Fail closed when the monotonic retry budget cannot be evaluated.
      }
    }
    failClosed();
  }
}

try {
  database = new DatabaseSync(configuration.databasePath);
  // Heartbeats are boot-bound coordination, not user data. WAL/NORMAL keeps
  // atomicity and application-crash safety without an xSync on every tick;
  // the parent connection still acquires and releases ownership with FULL.
  database.exec(\`
    PRAGMA trusted_schema = OFF;
    PRAGMA busy_timeout = \${configuration.busyTimeoutMs};
    PRAGMA synchronous = NORMAL;
    PRAGMA wal_autocheckpoint = \${configuration.walAutocheckpointPages};
    PRAGMA journal_size_limit = \${configuration.journalSizeLimitBytes};
  \`);
  assertSqliteConfiguration();
  const currentBootClockMs = bootClockMs();
  if (
    configuration.initialHeartbeatAtBootMs > currentBootClockMs
    || currentBootClockMs - configuration.initialHeartbeatAtBootMs
      > configuration.leaseMs
  ) {
    throw new Error("Initial job lease heartbeat is outside its lease window.");
  }
  parentPort.on("message", (message) => {
    if (!message || message.type !== "stop" || stopped) {
      return;
    }
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    try {
      closeDatabase();
      parentPort.postMessage({ type: "stopped" });
    } catch {
      parentPort.postMessage({ type: "failure" });
    }
  });
  heartbeat();
} catch {
  failClosed();
}
`;
