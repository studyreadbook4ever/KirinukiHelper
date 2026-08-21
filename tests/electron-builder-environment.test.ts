import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  electronBuilderEnvironment
} from "../scripts/electron-builder-environment.js";

test("electron-builder child는 runner DEBUG를 명시적으로 끄고 중복 CSC casing을 제거한다", () => {
  const environment = electronBuilderEnvironment({
    PATH: "system-path",
    DEBUG: "electron-builder*",
    dEbUg: "*",
    csc_identity_auto_discovery: "untrusted"
  }, false);

  assert.deepEqual(
    Object.keys(environment).filter((key) => key.toUpperCase() === "DEBUG"),
    ["DEBUG"]
  );
  assert.equal(environment.DEBUG, "-*");
  assert.deepEqual(
    Object.keys(environment).filter((key) => (
      key.toUpperCase() === "CSC_IDENTITY_AUTO_DISCOVERY"
    )),
    ["CSC_IDENTITY_AUTO_DISCOVERY"]
  );
  assert.equal(environment.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(environment.PATH, "system-path");
});

test("fresh electron-builder child도 deny-all DEBUG를 disabled로 readback한다", () => {
  const environment = electronBuilderEnvironment({
    ...process.env,
    DEBUG: "electron-builder*",
    dEbUg: "*"
  }, false);
  const child = spawnSync(process.execPath, [
    "-e",
    "const { debug } = require('builder-util/out/log'); process.stdout.write(JSON.stringify({ enabled: debug.enabled, namespace: process.env.DEBUG }))"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environment,
    shell: false,
    windowsHide: true
  });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    enabled: false,
    namespace: "-*"
  });
});

test("public release만 electron-builder signing identity discovery를 켠다", () => {
  assert.equal(
    electronBuilderEnvironment({}, true).CSC_IDENTITY_AUTO_DISCOVERY,
    "true"
  );
});
