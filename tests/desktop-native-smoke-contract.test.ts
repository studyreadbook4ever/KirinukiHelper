import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DESKTOP_NATIVE_SMOKE_ARGUMENT,
  DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
  DESKTOP_NATIVE_SMOKE_ROOT_ENV,
  DESKTOP_NATIVE_SMOKE_ROOT_PREFIX,
  DESKTOP_NATIVE_SMOKE_TOKEN_ENV,
  desktopNativeSmokeReadyMessage,
  isDesktopNativeSmokeQuitMessage,
  resolveDesktopNativeSmokeContract
} from "../src/desktop/native-smoke-contract.js";

function token(): string {
  return randomBytes(32).toString("base64url");
}

test("native smoke is inert without its exact internal argument", () => {
  assert.equal(resolveDesktopNativeSmokeContract({
    argv: ["Kirinuki"],
    env: {
      [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: path.parse(process.cwd()).root,
      [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: "invalid"
    }
  }), null);
});

test("native smoke accepts only a runner-owned direct temporary child", async () => {
  const root = await mkdtemp(path.join(
    os.tmpdir(),
    DESKTOP_NATIVE_SMOKE_ROOT_PREFIX
  ));
  const smokeToken = token();
  try {
    const contract = resolveDesktopNativeSmokeContract({
      argv: ["Kirinuki", DESKTOP_NATIVE_SMOKE_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: root,
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: smokeToken
      }
    });
    assert.deepEqual(contract, {
      root,
      userDataRoot: path.join(root, "user-data"),
      crashDumpsRoot: path.join(root, "crash-dumps"),
      logsRoot: path.join(root, "logs"),
      tempRoot: path.join(root, "runtime-temp"),
      token: smokeToken
    });
    assert.equal(Object.isFrozen(contract), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native smoke rejects duplicate flags, nested roots, and weak tokens", async () => {
  const root = await mkdtemp(path.join(
    os.tmpdir(),
    DESKTOP_NATIVE_SMOKE_ROOT_PREFIX
  ));
  try {
    assert.throws(() => resolveDesktopNativeSmokeContract({
      argv: [DESKTOP_NATIVE_SMOKE_ARGUMENT, DESKTOP_NATIVE_SMOKE_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: root,
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: token()
      }
    }), /중복/u);
    assert.throws(() => resolveDesktopNativeSmokeContract({
      argv: [DESKTOP_NATIVE_SMOKE_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: path.join(root, "nested"),
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: token()
      }
    }), /직계 하위/u);
    assert.throws(() => resolveDesktopNativeSmokeContract({
      argv: [DESKTOP_NATIVE_SMOKE_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: root,
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: "guessable"
      }
    }), /32-byte base64url/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native smoke IPC requires exact schema, fields, and capability token", async () => {
  const root = await mkdtemp(path.join(
    os.tmpdir(),
    DESKTOP_NATIVE_SMOKE_ROOT_PREFIX
  ));
  const smokeToken = token();
  try {
    const contract = resolveDesktopNativeSmokeContract({
      argv: [DESKTOP_NATIVE_SMOKE_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: root,
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: smokeToken
      }
    });
    assert.deepEqual(desktopNativeSmokeReadyMessage(contract!), {
      schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
      type: "ready",
      token: smokeToken
    });
    assert.equal(isDesktopNativeSmokeQuitMessage({
      schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
      type: "quit",
      token: smokeToken
    }, contract!), true);
    assert.equal(isDesktopNativeSmokeQuitMessage({
      schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
      type: "quit",
      token: smokeToken,
      ignored: true
    }, contract!), false);
    assert.equal(isDesktopNativeSmokeQuitMessage({
      schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
      type: "quit",
      token: token()
    }, contract!), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
