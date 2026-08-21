import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINE_OWNED_UNINSTALL_ARGUMENT,
  ENGINE_INSTANCE_SCHEMA,
  decideEngineInstanceHandoff,
  engineInstanceIdentity,
  exactOwnedUninstallRequestFromArgv
} from "../src/desktop/instance-lifecycle.js";

const current = engineInstanceIdentity({
  platform: "win32",
  arch: "x64",
  version: "3.2.4"
});

test("owned uninstall handoff는 exact 단일 인자와 같은 target·version만 허용한다", () => {
  assert.equal(
    exactOwnedUninstallRequestFromArgv(["Kirinuki", ENGINE_OWNED_UNINSTALL_ARGUMENT]),
    true
  );
  assert.equal(exactOwnedUninstallRequestFromArgv(["Kirinuki"]), false);
  assert.throws(
    () => exactOwnedUninstallRequestFromArgv([
      ENGINE_OWNED_UNINSTALL_ARGUMENT,
      ENGINE_OWNED_UNINSTALL_ARGUMENT
    ]),
    /exact/u
  );
  const cleanup = engineInstanceIdentity({
    platform: "win32",
    arch: "x64",
    version: "3.2.4",
    cleanupOwnedInstallation: true
  });
  assert.equal(cleanup.command, "cleanup-owned-installation");
  assert.equal(
    decideEngineInstanceHandoff({ current, incoming: cleanup }),
    "cleanup-owned-installation"
  );
  assert.equal(
    decideEngineInstanceHandoff({
      current,
      incoming: { ...cleanup, version: "3.2.3" }
    }),
    "ignore-invalid"
  );
  assert.throws(() => engineInstanceIdentity({
    platform: "win32",
    arch: "x64",
    version: "3.2.4",
    cleanupOwnedInstallation: true,
    pairingRequest: {
      state: Buffer.alloc(32, 1).toString("base64url"),
      challenge: Buffer.alloc(32, 2).toString("base64url")
    }
  }), /pairing payload/u);
});

test("engine single-instance identity는 target·release를 exact data로 전달한다", () => {
  assert.deepEqual(current, {
    schema: ENGINE_INSTANCE_SCHEMA,
    command: "activate",
    target: "win32-x64",
    version: "3.2.4"
  });
  assert.throws(
    () => engineInstanceIdentity({
      platform: "darwin",
      arch: "x64",
      version: "3.2.4"
    }),
    /지원하지 않는/u
  );
  assert.throws(
    () => engineInstanceIdentity({
      platform: "win32",
      arch: "x64",
      version: "latest"
    }),
    /version identity/u
  );
});

test("더 새로 설치된 release만 기존 headless engine을 한 번 재시작시킨다", () => {
  const incoming = (version: string) => ({ ...current, version });
  assert.equal(
    decideEngineInstanceHandoff({ current, incoming: incoming("3.2.5") }),
    "relaunch-newer-installed-version"
  );
  assert.equal(
    decideEngineInstanceHandoff({ current, incoming: incoming("4.0.0") }),
    "relaunch-newer-installed-version"
  );
  assert.equal(
    decideEngineInstanceHandoff({ current, incoming: incoming("3.2.4") }),
    "keep-current"
  );
  assert.equal(
    decideEngineInstanceHandoff({ current, incoming: incoming("3.2.3") }),
    "keep-current"
  );
});

test("다른 target·누락/추가 필드·잘못된 version은 handoff를 만들지 않는다", () => {
  for (const incoming of [
    null,
    {},
    { ...current, target: "linux-x64" },
    { ...current, version: "3" },
    { ...current, extra: true },
    { ...current, command: "uninstall" },
    { ...current, schema: "lookalike/v1" }
  ]) {
    assert.equal(
      decideEngineInstanceHandoff({ current, incoming }),
      "ignore-invalid"
    );
  }
});
