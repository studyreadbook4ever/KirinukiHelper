import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DESKTOP_NATIVE_SMOKE_ARGUMENT,
  DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV,
  DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
  DESKTOP_NATIVE_SMOKE_ROOT_ENV,
  DESKTOP_NATIVE_SMOKE_ROOT_PREFIX,
  DESKTOP_NATIVE_SMOKE_TOKEN_ENV,
  desktopNativeSmokeDisconnectExitCode,
  desktopNativeSmokeReadyMessage,
  isDesktopNativeSmokeQuitMessage,
  resolveDesktopNativeSmokeContract
} from "../src/desktop/native-smoke-contract.js";
import { ENGINE_OWNED_UNINSTALL_ARGUMENT } from "../src/desktop/instance-lifecycle.js";

function token(): string {
  return randomBytes(32).toString("base64url");
}

test("native smoke IPC disconnect는 owned uninstall의 정상 종료 코드를 보존한다", () => {
  assert.equal(desktopNativeSmokeDisconnectExitCode({
    quitRequested: false,
    ownedCleanupRequested: false,
    currentExitCode: 0
  }), 1);
  assert.equal(desktopNativeSmokeDisconnectExitCode({
    quitRequested: true,
    ownedCleanupRequested: false,
    currentExitCode: 0
  }), 0);
  assert.equal(desktopNativeSmokeDisconnectExitCode({
    quitRequested: false,
    ownedCleanupRequested: true,
    currentExitCode: 0
  }), 0);
  assert.equal(desktopNativeSmokeDisconnectExitCode({
    quitRequested: false,
    ownedCleanupRequested: true,
    currentExitCode: 1
  }), 1);
});

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
      autostartMode: "isolated",
      root,
      userDataRoot: path.join(root, "user data-사용자"),
      crashDumpsRoot: path.join(root, "crash dumps-사용자"),
      logsRoot: path.join(root, "logs-사용자"),
      tempRoot: path.join(root, "runtime temp-사용자"),
      token: smokeToken
    });
    assert.equal(Object.isFrozen(contract), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer cleanup child는 secret smoke identity를 상속해 같은 single-instance lock을 사용한다", async () => {
  const root = await mkdtemp(path.join(
    os.tmpdir(),
    DESKTOP_NATIVE_SMOKE_ROOT_PREFIX
  ));
  const smokeToken = token();
  try {
    const contract = resolveDesktopNativeSmokeContract({
      argv: ["Kirinuki", ENGINE_OWNED_UNINSTALL_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: root,
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: smokeToken,
        [DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV]: "production"
      }
    });
    assert.equal(contract?.root, root);
    assert.equal(contract?.token, smokeToken);
    assert.equal(contract?.autostartMode, "production");
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
    assert.throws(() => resolveDesktopNativeSmokeContract({
      argv: [DESKTOP_NATIVE_SMOKE_ARGUMENT],
      env: {
        [DESKTOP_NATIVE_SMOKE_ROOT_ENV]: root,
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: token(),
        [DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV]: "almost-production"
      }
    }), /값이 올바르지/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native smoke production mode는 실제 OS 자동실행 method만 evidence로 허용한다", async () => {
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
        [DESKTOP_NATIVE_SMOKE_TOKEN_ENV]: smokeToken,
        [DESKTOP_NATIVE_SMOKE_AUTOSTART_MODE_ENV]: "production"
      }
    });
    assert.equal(contract?.autostartMode, "production");
    const evidence = {
      processCount: 1,
      windowCount: 0,
      gateway: {
        allowedOrigin: "https://kirinuki.eff0rtchung.kr",
        port: 4319,
        reusedExisting: false
      },
      autostart: {
        schema: "kirinuki-engine-autostart/v1",
        method: process.platform === "linux"
          ? "xdg-autostart"
          : "electron-login-item",
        registered: true,
        readBack: true,
        arguments: ["--engine-background"]
      }
    } as const;
    assert.equal(
      desktopNativeSmokeReadyMessage(contract!, evidence).autostart.method,
      evidence.autostart.method
    );
    assert.throws(() => desktopNativeSmokeReadyMessage(contract!, {
      ...evidence,
      autostart: { ...evidence.autostart, method: "isolated-smoke" }
    }), /headless evidence/u);
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
    const evidence = {
      processCount: 1,
      windowCount: 0,
      gateway: {
        allowedOrigin: "https://kirinuki.eff0rtchung.kr",
        port: 4319,
        reusedExisting: false
      },
      autostart: {
        schema: "kirinuki-engine-autostart/v1",
        method: "isolated-smoke",
        registered: true,
        readBack: true,
        arguments: ["--engine-background"]
      }
    } as const;
    assert.deepEqual(desktopNativeSmokeReadyMessage(contract!, evidence), {
      autostart: {
        argument: "--engine-background",
        method: "isolated-smoke",
        readBack: true,
        registered: true,
        schema: "kirinuki-engine-autostart/v1"
      },
      gateway: {
        allowedOrigin: "https://kirinuki.eff0rtchung.kr",
        port: 4319,
        reusedExisting: false
      },
      processCount: 1,
      schema: DESKTOP_NATIVE_SMOKE_IPC_SCHEMA,
      type: "ready",
      token: smokeToken,
      windowCount: 0
    });
    assert.throws(
      () => desktopNativeSmokeReadyMessage(contract!, {
        ...evidence,
        processCount: 0
      }),
      /process 수/u
    );
    assert.throws(
      () => desktopNativeSmokeReadyMessage(contract!, {
        ...evidence,
        windowCount: 1
      }),
      /headless evidence/u
    );
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
