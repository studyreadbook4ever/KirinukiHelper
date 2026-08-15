import assert from "node:assert/strict";
import test from "node:test";

import {
  isDesktopPackageSmokeEntrypoint,
  reclaimCapturedWindowsProcessIdentities,
  terminateOwnedPosixProcessGroup
} from "../scripts/desktop-package-smoke.js";
import type { ProcessIdentity } from "../scripts/desktop-package-smoke.js";

function identity(
  pid: number,
  parentPid: number,
  started: string
): Readonly<ProcessIdentity> {
  return Object.freeze({ pid, parentPid, started });
}

test("desktop package smoke entrypoint follows native path case semantics", () => {
  const canonical = "/tmp/KirinukiSmoke/desktop-package-smoke.ts";
  const differentCase = "/TMP/kirinukismoke/DESKTOP-PACKAGE-SMOKE.TS";

  assert.equal(isDesktopPackageSmokeEntrypoint({
    invokedPath: canonical,
    modulePath: canonical,
    platform: "linux"
  }), true);
  assert.equal(isDesktopPackageSmokeEntrypoint({
    invokedPath: differentCase,
    modulePath: canonical,
    platform: "linux"
  }), false);
  assert.equal(isDesktopPackageSmokeEntrypoint({
    invokedPath: differentCase,
    modulePath: canonical,
    platform: "win32"
  }), true);
  assert.equal(isDesktopPackageSmokeEntrypoint({
    invokedPath: "/tmp/another-script.ts",
    modulePath: canonical,
    platform: "win32"
  }), false);
  assert.equal(isDesktopPackageSmokeEntrypoint({
    invokedPath: undefined,
    modulePath: canonical,
    platform: "win32"
  }), false);
});

test("Windows smoke cleanup은 끝난 root를 건너뛰고 exact descendant를 회수한다", async () => {
  const root = identity(100, 1, "root-created");
  const descendant = identity(101, 100, "child-created");
  const current = new Map<number, Readonly<ProcessIdentity>>([
    [descendant.pid, descendant]
  ]);
  const terminated: number[] = [];
  await reclaimCapturedWindowsProcessIdentities([root, descendant], {
    snapshotImpl: async () => new Map(current),
    terminateProcessTreeImpl: async (pid, confirmTargetIdentity) => {
      assert.equal(await confirmTargetIdentity(), true);
      terminated.push(pid);
      current.delete(pid);
    }
  });
  assert.deepEqual(terminated, [descendant.pid]);
});

test("Windows smoke cleanup은 재사용된 PID owner를 종료하지 않는다", async () => {
  const captured = identity(200, 1, "captured-created");
  const reused = identity(200, 99, "reused-created");
  const current = new Map<number, Readonly<ProcessIdentity>>([
    [reused.pid, reused]
  ]);
  let terminationCalls = 0;
  await reclaimCapturedWindowsProcessIdentities([captured], {
    snapshotImpl: async () => new Map(current),
    terminateProcessTreeImpl: async () => {
      terminationCalls += 1;
    }
  });
  assert.equal(terminationCalls, 0);
  assert.deepEqual(current.get(reused.pid), reused);
});

test("Windows smoke cleanup은 helper 실패와 exact survivor를 함께 드러낸다", async () => {
  const root = identity(300, 1, "root-created");
  const descendant = identity(301, 300, "child-created");
  const current = new Map<number, Readonly<ProcessIdentity>>([
    [root.pid, root],
    [descendant.pid, descendant]
  ]);
  await assert.rejects(
    reclaimCapturedWindowsProcessIdentities([root, descendant], {
      snapshotImpl: async () => new Map(current),
      terminateProcessTreeImpl: async (pid, confirmTargetIdentity) => {
        assert.equal(await confirmTargetIdentity(), true);
        throw new Error(`taskkill failed for ${pid}`);
      }
    }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 3);
      assert.match(error.errors[0]?.message || "", /300/u);
      assert.match(error.errors[1]?.message || "", /301/u);
      assert.match(error.errors[2]?.message || "", /300, 301/u);
      return true;
    }
  );
});

test("POSIX smoke cleanup은 SIGKILL 뒤 process group 생존을 실패로 드러낸다", async () => {
  const signals: Array<"SIGTERM" | "SIGKILL"> = [];
  const waits: number[] = [];
  await assert.rejects(
    terminateOwnedPosixProcessGroup({
      processGroupExistsImpl: () => true,
      rootIdentityIsStillSafeImpl: async () => true,
      signalProcessGroupImpl: (signal) => signals.push(signal),
      waitForProcessGroupReclaimedImpl: async (timeoutMs) => {
        waits.push(timeoutMs);
        return false;
      },
      termGraceMs: 11,
      reclaimTimeoutMs: 22
    }),
    /SIGKILL 뒤에도 남았습니다/u
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(waits, [11, 22]);
});

test("POSIX smoke cleanup은 TERM 뒤 PID identity가 바뀌면 KILL하지 않는다", async () => {
  const signals: Array<"SIGTERM" | "SIGKILL"> = [];
  let identityChecks = 0;
  await terminateOwnedPosixProcessGroup({
    processGroupExistsImpl: () => true,
    rootIdentityIsStillSafeImpl: async () => {
      identityChecks += 1;
      return identityChecks === 1;
    },
    signalProcessGroupImpl: (signal) => signals.push(signal),
    waitForProcessGroupReclaimedImpl: async () => false,
    termGraceMs: 1,
    reclaimTimeoutMs: 1
  });
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(identityChecks, 2);
});

test("POSIX smoke cleanup은 시작 identity가 이미 다르면 signal을 보내지 않는다", async () => {
  const signals: Array<"SIGTERM" | "SIGKILL"> = [];
  await terminateOwnedPosixProcessGroup({
    processGroupExistsImpl: () => true,
    rootIdentityIsStillSafeImpl: async () => false,
    signalProcessGroupImpl: (signal) => signals.push(signal),
    waitForProcessGroupReclaimedImpl: async () => {
      throw new Error("wait must not run");
    }
  });
  assert.deepEqual(signals, []);
});
