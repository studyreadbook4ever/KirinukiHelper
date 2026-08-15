import assert from "node:assert/strict";
import test from "node:test";

import {
  isDesktopPackageSmokeEntrypoint,
  matchesExactDesktopToolVersion,
  terminateOwnedPosixProcessGroup
} from "../scripts/desktop-package-smoke.js";

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

test("desktop package smoke는 target별 exact FFmpeg version token만 허용한다", () => {
  for (const [tool, version, stdout] of [
    ["ffmpeg", "7.0.2-static", "ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/\nconfiguration"],
    ["ffprobe", "6.0", "ffprobe version 6.0 Copyright (c)\nconfiguration"],
    ["ffmpeg", "6.1.1-tessus", "ffmpeg version 6.1.1-tessus  https://evermeet.cx/ffmpeg/\r\nconfiguration"],
    ["ffprobe", "6.1.1-essentials_build-www.gyan.dev", "ffprobe version 6.1.1-essentials_build-www.gyan.dev Copyright (c)\r\nconfiguration"]
  ] as const) {
    assert.equal(matchesExactDesktopToolVersion(stdout, tool, version), true);
  }

  for (const stdout of [
    "ffmpeg version 7.0.2-static-malicious Copyright (c)\n",
    "ffmpeg version 7.0.2 Copyright (c)\n",
    "ffprobe version 7.0.2-static Copyright (c)\n",
    " ffmpeg version 7.0.2-static Copyright (c)\n",
    "ffmpeg version 7.0.2-staticmalicious Copyright (c)\n",
    ""
  ]) {
    assert.equal(
      matchesExactDesktopToolVersion(stdout, "ffmpeg", "7.0.2-static"),
      false,
      stdout
    );
  }
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
