import assert from "node:assert/strict";
import test from "node:test";

import {
  electronBuilderEnvironment
} from "../scripts/electron-builder-environment.js";

test("electron-builder child는 runner DEBUG와 중복 CSC casing을 제거한다", () => {
  const environment = electronBuilderEnvironment({
    PATH: "system-path",
    DEBUG: "electron-builder*",
    dEbUg: "*",
    csc_identity_auto_discovery: "untrusted"
  }, false);

  assert.equal(
    Object.keys(environment).some((key) => key.toUpperCase() === "DEBUG"),
    false
  );
  assert.deepEqual(
    Object.keys(environment).filter((key) => (
      key.toUpperCase() === "CSC_IDENTITY_AUTO_DISCOVERY"
    )),
    ["CSC_IDENTITY_AUTO_DISCOVERY"]
  );
  assert.equal(environment.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(environment.PATH, "system-path");
});

test("public release만 electron-builder signing identity discovery를 켠다", () => {
  assert.equal(
    electronBuilderEnvironment({}, true).CSC_IDENTITY_AUTO_DISCOVERY,
    "true"
  );
});
