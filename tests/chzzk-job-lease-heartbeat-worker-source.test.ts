import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE,
  CHZZK_JOB_LEASE_HEARTBEAT_SYNCHRONOUS,
  CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES,
  CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES,
  CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES,
  CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES,
  CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES
} from "../scripts/chzzk-job-lease-heartbeat-worker-source.js";

interface ScheduledTimer {
  callback: () => void;
  delay: number;
  cleared: boolean;
}

interface WorkerConfiguration {
  databasePath: string;
  schemaId: string;
  ownerId: string;
  initialRevision: number;
  initialHeartbeatAtBootMs: number;
  intervalMs: number;
  busyTimeoutMs: number;
  leaseMs: number;
  sqlitePageBytes: number;
  walAutocheckpointPages: number;
  journalSizeLimitBytes: number;
  walSoftLimitBytes: number;
  walCommitMarginBytes: number;
  maximumSidecarBytes: number;
}

interface FakeDatabaseOptions {
  readonly onExec?: (sql: string) => void;
  readonly onUpdate?: () => { changes: number };
  readonly pragmaValues?: Readonly<Record<string, unknown>>;
}

interface WorkerHarnessOptions {
  readonly DatabaseSync?: new (location: string) => unknown;
  readonly configuration?: Partial<WorkerConfiguration>;
  readonly onSchedule?: (timer: ScheduledTimer) => void;
  readonly uptimeSeconds?: () => number;
}

const DEFAULT_PRAGMA_VALUES: Readonly<Record<string, unknown>> = {
  busy_timeout: 5_000,
  journal_mode: "wal",
  synchronous: CHZZK_JOB_LEASE_HEARTBEAT_SYNCHRONOUS,
  page_size: CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES,
  wal_autocheckpoint: CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES,
  journal_size_limit: CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES,
  trusted_schema: 0
};

function executableWorkerSource(): string {
  return CHZZK_JOB_LEASE_HEARTBEAT_WORKER_SOURCE
    .replace(
      'import { lstatSync } from "node:fs";',
      "const { lstatSync } = dependencies;"
    )
    .replace('import os from "node:os";', "const os = dependencies.os;")
    .replace('import path from "node:path";', "const path = dependencies.path;")
    .replace(
      'import { parentPort, workerData } from "node:worker_threads";',
      "const { parentPort, workerData } = dependencies;"
    )
    .replace(
      'import { DatabaseSync } from "node:sqlite";',
      "const { DatabaseSync } = dependencies;"
    );
}

function workerConfiguration(
  overrides: Partial<WorkerConfiguration> = {}
): WorkerConfiguration {
  return {
    databasePath: path.join(path.sep, "tmp", ".materializing-lock.sqlite3"),
    schemaId: "chzzk-kirinuki/chzzk-vod-job-lease-v3",
    ownerId: "a".repeat(48),
    initialRevision: 1,
    initialHeartbeatAtBootMs: 123_000,
    intervalMs: 5_000,
    busyTimeoutMs: 5_000,
    leaseMs: 90_000,
    sqlitePageBytes: CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES,
    walAutocheckpointPages: CHZZK_JOB_LEASE_WAL_AUTOCHECKPOINT_PAGES,
    journalSizeLimitBytes: CHZZK_JOB_LEASE_JOURNAL_SIZE_LIMIT_BYTES,
    walSoftLimitBytes: CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES,
    walCommitMarginBytes: CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES,
    maximumSidecarBytes: 1024 * 1024,
    ...overrides
  };
}

function missingSidecar(): never {
  const error = new Error("synthetic missing sidecar") as Error & { code: string };
  error.code = "ENOENT";
  throw error;
}

function createFakeDatabaseSync({
  onExec,
  onUpdate,
  pragmaValues = DEFAULT_PRAGMA_VALUES
}: FakeDatabaseOptions = {}): new (location: string) => unknown {
  return class FakeDatabaseSync {
    exec(sql: string): void {
      onExec?.(sql);
    }

    prepare(sql: string): {
      get: () => Readonly<Record<string, unknown>>;
      run: () => { changes: number };
    } {
      const normalized = sql.trim();
      if (normalized.startsWith("PRAGMA ")) {
        const pragmaName = normalized.slice("PRAGMA ".length);
        return {
          get: () => ({ value: pragmaValues[pragmaName] }),
          run: () => ({ changes: 0 })
        };
      }
      return {
        get: () => ({}),
        run: onUpdate ?? (() => ({ changes: 1 }))
      };
    }

    close(): void {}
  };
}

function createWorkerHarness({
  DatabaseSync = createFakeDatabaseSync(),
  configuration,
  onSchedule,
  uptimeSeconds = () => 123
}: WorkerHarnessOptions = {}): {
  readonly scheduled: ScheduledTimer[];
  readonly messages: unknown[];
  readonly listeners: ReadonlyMap<string, (message: unknown) => void>;
  fire(timer: ScheduledTimer): void;
} {
  const scheduled: ScheduledTimer[] = [];
  const messages: unknown[] = [];
  const listeners = new Map<string, (message: unknown) => void>();
  const fakeSetTimeout = (callback: () => void, delay: number): ScheduledTimer => {
    const timer = { callback, delay, cleared: false };
    scheduled.push(timer);
    onSchedule?.(timer);
    return timer;
  };
  const fakeClearTimeout = (timer: ScheduledTimer): void => {
    timer.cleared = true;
  };
  const execute = new Function(
    "dependencies",
    "setTimeout",
    "clearTimeout",
    executableWorkerSource()
  );
  execute({
    lstatSync: missingSidecar,
    os: { uptime: uptimeSeconds },
    path,
    parentPort: {
      on: (event: string, listener: (message: unknown) => void) => {
        listeners.set(event, listener);
      },
      postMessage: (message: unknown) => {
        messages.push(message);
      }
    },
    workerData: workerConfiguration(configuration),
    DatabaseSync
  }, fakeSetTimeout, fakeClearTimeout);

  return {
    scheduled,
    messages,
    listeners,
    fire(timer) {
      timer.cleared = true;
      timer.callback();
    }
  };
}

test("heartbeat worker는 시작 즉시 transaction을 마친 뒤 다음 tick을 예약한다", () => {
  let scheduled: ScheduledTimer[] | undefined;
  const events: string[] = [];
  const DatabaseSync = createFakeDatabaseSync({
    onUpdate: () => {
      events.push("transaction");
      assert.equal(
        scheduled?.filter(({ cleared }) => !cleared).length ?? 0,
        0,
        "transaction 중에는 다음 heartbeat timer가 없어야 한다"
      );
      return { changes: 1 };
    }
  });

  const harness = createWorkerHarness({
    DatabaseSync,
    onSchedule: () => {
      events.push("scheduled");
    }
  });
  scheduled = harness.scheduled;

  assert.deepEqual(harness.messages, [{ type: "ready" }]);
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.scheduled[0]?.delay, 5_000);
  assert.deepEqual(events, ["transaction", "scheduled"]);

  const next = harness.scheduled[0];
  assert(next);
  harness.fire(next);

  assert.equal(harness.scheduled.length, 2);
  assert.equal(harness.scheduled[1]?.delay, 5_000);
  assert.deepEqual(events, [
    "transaction",
    "scheduled",
    "transaction",
    "scheduled"
  ]);
  assert.deepEqual(harness.messages, [{ type: "ready" }]);
  assert.equal(typeof harness.listeners.get("message"), "function");
});

test("느린 commit 뒤 lease 여유가 작으면 다음 heartbeat를 즉시 따라잡는다", () => {
  const uptimeSamples = [123, 123, 123, 123, 123, 204];
  const harness = createWorkerHarness({
    uptimeSeconds: () => uptimeSamples.shift() ?? 204
  });

  assert.deepEqual(harness.messages, [{ type: "ready" }]);
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.scheduled[0]?.delay, 0);
});

test("commit이 safe lifetime을 모두 소모하면 ready를 내보내지 않는다", () => {
  const uptimeSamples = [123, 123, 123, 123, 123, 208];
  const harness = createWorkerHarness({
    uptimeSeconds: () => uptimeSamples.shift() ?? 208
  });

  assert.deepEqual(harness.messages, [{ type: "failure" }]);
  assert.equal(harness.scheduled.length, 0);
});

test("첫 heartbeat transaction의 일반 실패는 ready 없이 fail-closed 한다", () => {
  const DatabaseSync = createFakeDatabaseSync({
    onUpdate: () => {
      throw new Error("synthetic transaction failure");
    }
  });
  const harness = createWorkerHarness({ DatabaseSync });

  assert.equal(harness.scheduled.length, 0);
  assert.deepEqual(harness.messages, [{ type: "failure" }]);
});

test("fresh lease의 transient SQLITE_BUSY만 짧게 다시 시도한다", () => {
  let attempts = 0;
  let uptimeSeconds = 123;
  const DatabaseSync = createFakeDatabaseSync({
    onUpdate: () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("synthetic busy") as Error & { errcode: number };
        error.errcode = 517;
        throw error;
      }
      return { changes: 1 };
    }
  });
  const harness = createWorkerHarness({
    DatabaseSync,
    uptimeSeconds: () => uptimeSeconds
  });

  assert.equal(attempts, 1);
  assert.deepEqual(harness.messages, []);
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.scheduled[0]?.delay, 250);

  const retry = harness.scheduled[0];
  assert(retry);
  uptimeSeconds += 0.25;
  harness.fire(retry);

  assert.equal(attempts, 2);
  assert.equal(harness.scheduled.length, 2);
  assert.equal(harness.scheduled[1]?.delay, 5_000);
  assert.deepEqual(harness.messages, [{ type: "ready" }]);
});

test("예약된 BUSY retry가 늦게 실행되면 SQLite transaction을 다시 시작하지 않는다", () => {
  let attempts = 0;
  let uptimeSeconds = 123;
  const DatabaseSync = createFakeDatabaseSync({
    onUpdate: () => {
      attempts += 1;
      const error = new Error("synthetic busy") as Error & { errcode: number };
      error.errcode = 5;
      throw error;
    }
  });
  const harness = createWorkerHarness({
    DatabaseSync,
    uptimeSeconds: () => uptimeSeconds
  });
  const retry = harness.scheduled[0];
  assert(retry);
  assert.equal(attempts, 1);

  uptimeSeconds = 208;
  harness.fire(retry);

  assert.equal(attempts, 1);
  assert.equal(harness.scheduled.length, 1);
  assert.deepEqual(harness.messages, [{ type: "failure" }]);
});

test("WAL 준비가 lease deadline을 넘기면 BEGIN IMMEDIATE 전에 중단한다", () => {
  const uptimeSamples = [123, 123, 208];
  let beginAttempts = 0;
  let updateAttempts = 0;
  const DatabaseSync = createFakeDatabaseSync({
    onExec: (sql) => {
      if (sql === "BEGIN IMMEDIATE;") {
        beginAttempts += 1;
      }
    },
    onUpdate: () => {
      updateAttempts += 1;
      return { changes: 1 };
    }
  });
  const harness = createWorkerHarness({
    DatabaseSync,
    uptimeSeconds: () => uptimeSamples.shift() ?? 208
  });

  assert.equal(beginAttempts, 0);
  assert.equal(updateAttempts, 0);
  assert.equal(harness.scheduled.length, 0);
  assert.deepEqual(harness.messages, [{ type: "failure" }]);
});

test("transient SQLITE_BUSY도 initial heartbeat 기반 deadline을 넘으면 재시도하지 않는다", () => {
  const DatabaseSync = createFakeDatabaseSync({
    onUpdate: () => {
      const error = new Error("synthetic expired busy") as Error & { errcode: number };
      error.errcode = 5;
      throw error;
    }
  });
  const harness = createWorkerHarness({
    DatabaseSync,
    configuration: { initialHeartbeatAtBootMs: 100_000 },
    uptimeSeconds: () => 185
  });

  assert.equal(harness.scheduled.length, 0);
  assert.deepEqual(harness.messages, [{ type: "failure" }]);
});

test("heartbeat UPDATE changes=0은 ownership 상실로 즉시 fail-closed 한다", () => {
  const DatabaseSync = createFakeDatabaseSync({
    onUpdate: () => ({ changes: 0 })
  });
  const harness = createWorkerHarness({ DatabaseSync });

  assert.equal(harness.scheduled.length, 0);
  assert.deepEqual(harness.messages, [{ type: "failure" }]);
});

test("heartbeat transaction rollback이 실패하면 SQLITE_BUSY도 재시도하지 않는다", () => {
  const DatabaseSync = createFakeDatabaseSync({
    onExec: (sql) => {
      if (sql === "ROLLBACK;") {
        throw new Error("synthetic rollback failure");
      }
    },
    onUpdate: () => {
      const error = new Error("synthetic busy") as Error & { errcode: number };
      error.errcode = 5;
      throw error;
    }
  });
  const harness = createWorkerHarness({ DatabaseSync });

  assert.equal(harness.scheduled.length, 0);
  assert.deepEqual(harness.messages, [{ type: "failure" }]);
});

for (const [pragmaName, rejectedValue] of [
  ["journal_mode", "delete"],
  ["page_size", CHZZK_JOB_LEASE_SQLITE_PAGE_BYTES * 2],
  ["synchronous", 2]
] as const) {
  test(`SQLite ${pragmaName} readback이 계약과 다르면 시작 전에 거부한다`, () => {
    let updateAttempts = 0;
    const DatabaseSync = createFakeDatabaseSync({
      pragmaValues: {
        ...DEFAULT_PRAGMA_VALUES,
        [pragmaName]: rejectedValue
      },
      onUpdate: () => {
        updateAttempts += 1;
        return { changes: 1 };
      }
    });
    const harness = createWorkerHarness({ DatabaseSync });

    assert.equal(updateAttempts, 0);
    assert.equal(harness.scheduled.length, 0);
    assert.deepEqual(harness.messages, [{ type: "failure" }]);
  });
}
