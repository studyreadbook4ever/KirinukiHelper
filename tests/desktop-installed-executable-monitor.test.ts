import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  monitorInstalledExecutable
} from "../src/desktop/installed-executable-monitor.js";

test("exact installed executable 삭제·이동은 한 번만 cleanup을 요청한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-install-monitor-"));
  const executable = path.join(root, "Kirinuki executable");
  const moved = path.join(root, "moved executable");
  let callbacks = 0;
  try {
    await writeFile(executable, "owned-app", { mode: 0o700 });
    const monitor = await monitorInstalledExecutable({
      executablePath: executable,
      onInstallChanged: () => { callbacks += 1; },
      intervalMs: 10_000
    });
    assert.equal(await monitor.checkNow(), "present");
    await rename(executable, moved);
    assert.equal(await monitor.checkNow(), "missing");
    assert.equal(await monitor.checkNow(), "missing");
    assert.equal(callbacks, 1);
    monitor.stop();
    monitor.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same path에 다른 executable이 원자적으로 나타나도 owned identity로 채택하지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-install-replace-"));
  const executable = path.join(root, "Kirinuki");
  const replacement = path.join(root, "replacement");
  let callbacks = 0;
  try {
    await writeFile(executable, "owned-app", { mode: 0o700 });
    await writeFile(replacement, "other-app", { mode: 0o700 });
    const monitor = await monitorInstalledExecutable({
      executablePath: executable,
      onInstallChanged: () => { callbacks += 1; },
      intervalMs: 10_000
    });
    await rename(replacement, executable);
    assert.equal(await monitor.checkNow(), "replaced");
    assert.equal(callbacks, 1);
    monitor.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
