import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

import {
  CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE,
  CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES,
  CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES,
  CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES,
  CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES,
  CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES
} from "../scripts/chzzk-job-lease-heartbeat-worker-source.js";

const JOB_LEASE_DATABASE_FILENAME = ".materializing-lock.sqlite3";
const JOB_LEASE_SCHEMA_ID = "chzzk-kirinuki/chzzk-vod-job-lease-v3";
const MAX_SAFE_JOB_LEASE_SIDECAR_BYTES = 1024 * 1024;

type SqliteValue = string | number | bigint | null | Uint8Array;

interface SqliteStatement {
  get(...parameters: readonly SqliteValue[]): unknown;
  run(...parameters: readonly SqliteValue[]): { changes: number | bigint };
}

interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface NodeSqlite {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface WorkerConfiguration {
  readonly databasePath: string;
  readonly schemaId: typeof JOB_LEASE_SCHEMA_ID;
  readonly ownerId: string;
  readonly initialRevision: number;
  readonly initialHeartbeatAtBootMs: number;
  readonly intervalMs: number;
  readonly busyTimeoutMs: number;
  readonly leaseMs: number;
  readonly sqlitePageBytes: number;
  readonly walAutocheckpointPages: number;
  readonly journalSizeLimitBytes: number;
  readonly maximumSidecarBytes: number;
  readonly walSoftLimitBytes: number;
  readonly walCommitMarginBytes: number;
}

interface LeaseFixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly ownerId: string;
  readonly initialHeartbeatAtBootMs: number;
}

interface PrefilledWal {
  readonly reader: SqliteDatabase;
  readonly writer: SqliteDatabase;
  readonly sizeBytes: number;
}

type WorkerMessageType = "ready" | "failure" | "stopped";

const requireNodeBuiltin = createRequire(import.meta.url);
const sqlite = requireNodeBuiltin("node:sqlite") as NodeSqlite;

function bootClockMs(): number {
  return Math.floor(os.uptime() * 1_000);
}

function withDatabase<T>(
  databasePath: string,
  callback: (database: SqliteDatabase) => T
): T {
  const database = new sqlite.DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
    return callback(database);
  } finally {
    database.close();
  }
}

async function createLeaseFixture(ownerByte: string): Promise<LeaseFixture> {
  const directory = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-heartbeat-worker-integration-"
  ));
  const databasePath = path.join(directory, JOB_LEASE_DATABASE_FILENAME);
  const ownerId = ownerByte.repeat(48);
  const initialHeartbeatAtBootMs = bootClockMs();
  withDatabase(databasePath, (database) => {
    database.exec(`
      PRAGMA synchronous = NORMAL;
      CREATE TABLE materialization_job_lease (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        pid INTEGER NOT NULL CHECK (pid >= 1),
        created_at_unix_ms INTEGER NOT NULL CHECK (created_at_unix_ms >= 1),
        heartbeat_at_boot_ms INTEGER NOT NULL CHECK (heartbeat_at_boot_ms >= 0),
        process_start_marker TEXT
      ) STRICT;
    `);
    database.prepare(`
      INSERT INTO materialization_job_lease (
        singleton,
        schema_id,
        owner_id,
        revision,
        pid,
        created_at_unix_ms,
        heartbeat_at_boot_ms,
        process_start_marker
      ) VALUES (1, ?, ?, 1, ?, ?, ?, NULL)
    `).run(
      JOB_LEASE_SCHEMA_ID,
      ownerId,
      process.pid,
      Date.now(),
      initialHeartbeatAtBootMs
    );
  });
  return { directory, databasePath, ownerId, initialHeartbeatAtBootMs };
}

async function prefillWalBehindPinnedReader(
  fixture: LeaseFixture,
  targetBytes = CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES + 32 * 1_024
): Promise<PrefilledWal> {
  const reader = new sqlite.DatabaseSync(fixture.databasePath);
  const writer = new sqlite.DatabaseSync(fixture.databasePath);
  try {
    reader.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL; BEGIN;");
    readRevisionFromOpenDatabase(reader);
    writer.exec(`
      PRAGMA busy_timeout = 2000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA wal_autocheckpoint = ${CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES};
      PRAGMA journal_size_limit = ${CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES};
    `);
    const update = writer.prepare(`
      UPDATE materialization_job_lease
      SET heartbeat_at_boot_ms = ?
      WHERE singleton = 1
    `);
    const walPath = `${fixture.databasePath}-wal`;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      update.run(fixture.initialHeartbeatAtBootMs + (attempt % 2));
      if (attempt % 8 !== 0) {
        continue;
      }
      const status = await stat(walPath);
      if (status.size > targetBytes) {
        assert(
          status.size < MAX_SAFE_JOB_LEASE_SIDECAR_BYTES
            - CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES,
          `prefilled WAL consumed the worker's commit margin (${status.size} bytes)`
        );
        return { reader, writer, sizeBytes: status.size };
      }
    }
    assert.fail("Could not prefill a WAL above the heartbeat soft limit.");
  } catch (error) {
    try {
      reader.exec("ROLLBACK;");
    } catch {
      // The pinned transaction may not have started.
    }
    reader.close();
    writer.close();
    throw error;
  }
}

function readRevision(databasePath: string): number {
  return withDatabase(databasePath, (database) => {
    const record = database.prepare(`
      SELECT revision
      FROM materialization_job_lease
      WHERE singleton = 1
    `).get() as { revision?: unknown } | undefined;
    assert(record);
    assert.equal(typeof record.revision, "number");
    return Number(record.revision);
  });
}

function replaceOwner(
  databasePath: string,
  expectedOwnerId: string,
  replacementOwnerId: string
): number {
  return withDatabase(databasePath, (database) => {
    database.exec("BEGIN IMMEDIATE;");
    try {
      const record = database.prepare(`
        SELECT owner_id AS ownerId, revision
        FROM materialization_job_lease
        WHERE singleton = 1
      `).get() as { ownerId?: unknown; revision?: unknown } | undefined;
      assert.equal(record?.ownerId, expectedOwnerId);
      assert.equal(typeof record?.revision, "number");
      const currentRevision = Number(record.revision);
      assert(Number.isSafeInteger(currentRevision));
      assert(Number.isSafeInteger(currentRevision + 1));
      const replacementRevision = currentRevision + 1;
      const result = database.prepare(`
        UPDATE materialization_job_lease
        SET owner_id = ?, revision = ?
        WHERE singleton = 1 AND owner_id = ? AND revision = ?
      `).run(
        replacementOwnerId,
        replacementRevision,
        expectedOwnerId,
        currentRevision
      );
      assert.equal(Number(result.changes), 1);
      database.exec("COMMIT;");
      return replacementRevision;
    } catch (error) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        // Preserve the original assertion or SQLite failure.
      }
      throw error;
    }
  });
}

function readOwner(databasePath: string): string {
  return withDatabase(databasePath, (database) => {
    const record = database.prepare(`
      SELECT owner_id AS ownerId
      FROM materialization_job_lease
      WHERE singleton = 1
    `).get() as { ownerId?: unknown } | undefined;
    assert(record);
    assert.equal(typeof record.ownerId, "string");
    return String(record.ownerId);
  });
}

function launchHeartbeatWorker(
  fixture: LeaseFixture,
  overrides: Partial<Omit<WorkerConfiguration,
    "databasePath" | "schemaId" | "ownerId" | "initialRevision">> = {}
): {
  readonly worker: Worker;
  readonly messages: readonly WorkerMessageType[];
  waitForMessage(type: WorkerMessageType, timeoutMs?: number): Promise<void>;
} {
  const configuration: WorkerConfiguration = {
    databasePath: fixture.databasePath,
    schemaId: JOB_LEASE_SCHEMA_ID,
    ownerId: fixture.ownerId,
    initialRevision: 1,
    initialHeartbeatAtBootMs: fixture.initialHeartbeatAtBootMs,
    intervalMs: 50,
    busyTimeoutMs: 50,
    leaseMs: 2_000,
    sqlitePageBytes: CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES,
    walAutocheckpointPages: CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES,
    journalSizeLimitBytes: CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES,
    maximumSidecarBytes: MAX_SAFE_JOB_LEASE_SIDECAR_BYTES,
    walSoftLimitBytes: CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES,
    walCommitMarginBytes: CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES,
    ...overrides
  };
  const worker = new Worker(new URL(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(
      CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE
    )}`
  ), { workerData: configuration });
  const messages: WorkerMessageType[] = [];
  const waiters = new Set<{
    readonly type: WorkerMessageType;
    resolve(): void;
    reject(error: Error): void;
  }>();
  let workerError: Error | undefined;
  let exited = false;

  worker.on("message", (message: unknown) => {
    const type = (
      typeof message === "object"
      && message !== null
      && "type" in message
      && ["ready", "failure", "stopped"].includes(String(message.type))
    ) ? String(message.type) as WorkerMessageType : undefined;
    if (!type) {
      return;
    }
    messages.push(type);
    for (const waiter of waiters) {
      if (waiter.type === type) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  });
  worker.on("error", (error) => {
    workerError = error;
    for (const waiter of waiters) {
      waiters.delete(waiter);
      waiter.reject(error);
    }
  });
  worker.on("exit", () => {
    exited = true;
    for (const waiter of waiters) {
      waiters.delete(waiter);
      waiter.reject(new Error("Heartbeat worker exited before the expected message."));
    }
  });

  return {
    worker,
    messages,
    waitForMessage(type, timeoutMs = 3_000) {
      if (messages.includes(type)) {
        return Promise.resolve();
      }
      if (workerError) {
        return Promise.reject(workerError);
      }
      if (exited) {
        return Promise.reject(new Error(
          "Heartbeat worker exited before the expected message."
        ));
      }
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const waiter = {
          type,
          resolve: () => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve();
          },
          reject: (error: Error) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        };
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          waiters.delete(waiter);
          reject(new Error(`Timed out waiting for heartbeat worker ${type}.`));
        }, timeoutMs);
        waiters.add(waiter);
      });
    }
  };
}

function blockMainThread(milliseconds: number): void {
  const view = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const result = Atomics.wait(view, 0, 0, milliseconds);
  assert.equal(result, "timed-out");
}

async function waitForRevision(
  databasePath: string,
  minimumRevision: number,
  timeoutMs = 4_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let revision = readRevision(databasePath);
  while (revision < minimumRevision && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    revision = readRevision(databasePath);
  }
  assert(
    revision >= minimumRevision,
    `revision ${String(revision)} did not reach ${String(minimumRevision)}`
  );
  return revision;
}

async function terminateWorker(worker: Worker | undefined): Promise<void> {
  if (!worker) {
    return;
  }
  await worker.terminate().catch(() => undefined);
}

test("실제 SQLite writer lock이 잠시 겹쳐도 heartbeat worker가 BUSY 뒤 회복한다", {
  timeout: 6_000
}, async () => {
  const fixture = await createLeaseFixture("a");
  const probe = launchHeartbeatWorker(fixture);
  let blocker: SqliteDatabase | undefined;
  try {
    await probe.waitForMessage("ready");
    blocker = new sqlite.DatabaseSync(fixture.databasePath);
    blocker.exec("PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
    const lockedRevision = readRevisionFromOpenDatabase(blocker);

    // Keep the real SQLite write lock longer than several nominal ticks. The
    // main-thread wait also ensures this assertion cannot accidentally depend
    // on the test runner scheduling a release callback for the worker.
    blockMainThread(350);
    assert.equal(readRevisionFromOpenDatabase(blocker), lockedRevision);
    assert.equal(probe.messages.includes("failure"), false);
    blocker.exec("ROLLBACK;");
    blocker.close();
    blocker = undefined;

    const revision = await waitForRevision(fixture.databasePath, lockedRevision + 1);
    assert(revision > lockedRevision);
    assert.equal(probe.messages.includes("failure"), false);
  } finally {
    try {
      blocker?.exec("ROLLBACK;");
    } catch {
      // The transaction may already have been rolled back by the test body.
    }
    blocker?.close();
    await terminateWorker(probe.worker);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("SQLite BUSY가 retry deadline을 넘으면 worker가 lease 만료 전 fail-closed 한다", {
  timeout: 6_000
}, async () => {
  const fixture = await createLeaseFixture("b");
  const probe = launchHeartbeatWorker(fixture, { leaseMs: 500 });
  let blocker: SqliteDatabase | undefined;
  try {
    await probe.waitForMessage("ready");
    blocker = new sqlite.DatabaseSync(fixture.databasePath);
    blocker.exec("PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
    const lockedRevision = readRevisionFromOpenDatabase(blocker);
    const startedAt = Date.now();

    await probe.waitForMessage("failure", 2_000);
    const elapsedMs = Date.now() - startedAt;
    assert(
      elapsedMs >= 200,
      `worker failed on the first BUSY instead of exhausting retries (${elapsedMs}ms)`
    );
    assert(
      elapsedMs < 1_500,
      `worker did not fail closed within its bounded retry budget (${elapsedMs}ms)`
    );
    assert.equal(readRevisionFromOpenDatabase(blocker), lockedRevision);
  } finally {
    try {
      blocker?.exec("ROLLBACK;");
    } catch {
      // The worker failure does not own the blocking transaction.
    }
    blocker?.close();
    await terminateWorker(probe.worker);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("실제 SQLite CAS에서 owner가 바뀌면 worker가 lease deadline을 기다리지 않는다", {
  timeout: 6_000
}, async () => {
  const fixture = await createLeaseFixture("c");
  const probe = launchHeartbeatWorker(fixture, { leaseMs: 10_000 });
  const replacementOwner = "d".repeat(48);
  try {
    await probe.waitForMessage("ready");
    const replacementRevision = replaceOwner(
      fixture.databasePath,
      fixture.ownerId,
      replacementOwner
    );
    const replacedAt = Date.now();

    await probe.waitForMessage("failure", 2_000);
    const elapsedMs = Date.now() - replacedAt;
    assert(
      elapsedMs < 2_000,
      `CAS loss should not consume the 10s lease budget (${elapsedMs}ms)`
    );
    assert.equal(readOwner(fixture.databasePath), replacementOwner);
    assert.equal(readRevision(fixture.databasePath), replacementRevision);
  } finally {
    await terminateWorker(probe.worker);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("parent event loop이 동기식으로 멈춰도 별도 worker heartbeat는 계속 전진한다", {
  timeout: 6_000
}, async () => {
  const fixture = await createLeaseFixture("e");
  const probe = launchHeartbeatWorker(fixture);
  try {
    await probe.waitForMessage("ready");
    const before = readRevision(fixture.databasePath);
    blockMainThread(650);
    const after = readRevision(fixture.databasePath);

    assert(
      after > before,
      `worker revision did not advance while parent was blocked (${before} -> ${after})`
    );
    assert.equal(probe.messages.includes("failure"), false);
  } finally {
    await terminateWorker(probe.worker);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("pinned reader가 WAL checkpoint를 굶기면 hard limit 전에 fail-closed 한다", {
  timeout: 8_000
}, async () => {
  const fixture = await createLeaseFixture("f");
  let prefilled: PrefilledWal | undefined;
  let worker: Worker | undefined;
  try {
    prefilled = await prefillWalBehindPinnedReader(fixture);
    prefilled.writer.close();
    const probe = launchHeartbeatWorker(fixture);
    worker = probe.worker;

    await probe.waitForMessage("failure", 3_000);
    assert.equal(probe.messages.includes("ready"), false);
    assert.equal(readRevisionFromOpenDatabase(prefilled.reader), 1);
    assert(
      (await stat(`${fixture.databasePath}-wal`)).size
        <= MAX_SAFE_JOB_LEASE_SIDECAR_BYTES,
      "starved WAL crossed the hard sidecar limit"
    );
  } finally {
    await terminateWorker(worker);
    try {
      prefilled?.reader.exec("ROLLBACK;");
    } catch {
      // The pinned reader may already be closed by setup cleanup.
    }
    try {
      prefilled?.reader.close();
    } catch {
      // The setup may already have closed the reader.
    }
    try {
      prefilled?.writer.close();
    } catch {
      // The writer is normally closed before worker launch.
    }
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("완료된 PASSIVE checkpoint의 큰 물리 WAL은 다음 heartbeat에서 안전하게 재사용한다", {
  timeout: 8_000
}, async () => {
  const fixture = await createLeaseFixture("0");
  let prefilled: PrefilledWal | undefined;
  let worker: Worker | undefined;
  try {
    prefilled = await prefillWalBehindPinnedReader(fixture);
    prefilled.reader.exec("ROLLBACK;");
    prefilled.reader.close();
    const checkpoint = prefilled.writer.prepare(
      "PRAGMA wal_checkpoint(PASSIVE)"
    ).get() as { busy?: unknown; log?: unknown; checkpointed?: unknown };
    assert.equal(checkpoint.busy, 0);
    assert.equal(checkpoint.log, checkpoint.checkpointed);
    assert(
      (await stat(`${fixture.databasePath}-wal`)).size
        > CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES,
      "fixture must retain a physically large checkpointed WAL"
    );

    const probe = launchHeartbeatWorker(fixture);
    worker = probe.worker;
    await probe.waitForMessage("ready", 3_000);
    assert(await waitForRevision(fixture.databasePath, 2) >= 2);
    assert.equal(probe.messages.includes("failure"), false);
    assert(
      (await stat(`${fixture.databasePath}-wal`)).size
        <= MAX_SAFE_JOB_LEASE_SIDECAR_BYTES,
      "checkpointed WAL crossed the hard sidecar limit after heartbeat"
    );
  } finally {
    await terminateWorker(worker);
    try {
      prefilled?.reader.exec("ROLLBACK;");
    } catch {
      // The reader was normally closed before worker launch.
    }
    try {
      prefilled?.reader.close();
    } catch {
      // The reader was normally closed before worker launch.
    }
    prefilled?.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("반복 heartbeat의 WAL sidecar는 안전 한도 안에 머물고 worker 종료 뒤 정리된다", {
  timeout: 10_000
}, async () => {
  const fixture = await createLeaseFixture("1");
  const probe = launchHeartbeatWorker(fixture);
  const walPath = `${fixture.databasePath}-wal`;
  const shmPath = `${fixture.databasePath}-shm`;
  try {
    await probe.waitForMessage("ready");
    await waitForRevision(fixture.databasePath, 40, 7_000);

    const walStatus = await stat(walPath);
    assert(walStatus.isFile());
    assert(
      walStatus.size <= MAX_SAFE_JOB_LEASE_SIDECAR_BYTES,
      `WAL grew beyond the lease database safety limit (${walStatus.size} bytes)`
    );
    assert.equal(probe.messages.includes("failure"), false);

    await terminateWorker(probe.worker);
    await waitForSidecarCleanup([walPath, shmPath]);
  } finally {
    await terminateWorker(probe.worker);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

function readRevisionFromOpenDatabase(database: SqliteDatabase): number {
  const record = database.prepare(`
    SELECT revision
    FROM materialization_job_lease
    WHERE singleton = 1
  `).get() as { revision?: unknown } | undefined;
  assert(record);
  assert.equal(typeof record.revision, "number");
  return Number(record.revision);
}

async function waitForSidecarCleanup(
  sidecarPaths: readonly string[],
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const existing = await Promise.all(sidecarPaths.map(async (candidate) => {
      try {
        await stat(candidate);
        return candidate;
      } catch (error) {
        if (
          error
          && typeof error === "object"
          && "code" in error
          && error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
    }));
    if (existing.every((candidate) => candidate === undefined)) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("SQLite WAL sidecars remained after the final worker connection closed.");
}
