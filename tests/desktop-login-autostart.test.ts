import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENGINE_AUTOSTART_SCHEMA,
  ENGINE_BACKGROUND_ARGUMENT,
  LINUX_ENGINE_AUTOSTART_FILE,
  WINDOWS_ENGINE_LOGIN_ITEM_NAME,
  ensureEngineAutostart,
  isManagedLinuxEngineAutostartContent,
  linuxEngineAutostartContent,
  linuxEngineAutostartLaunch,
  removeEngineAutostart,
  windowsLoginItemReadbackPath
} from "../src/desktop/login-autostart.js";
import type {
  EngineAutostartFileSystemSemantics
} from "../src/desktop/login-autostart.js";

function mappedStateStorage(
  targetStatePath: string,
  nativeStatePath: string
): Readonly<EngineAutostartFileSystemSemantics> {
  return Object.freeze({
    resolveStatePath: (candidate: string) => {
      assert.equal(candidate, targetStatePath);
      return nativeStatePath;
    },
    enforcePosixPermissions: process.platform !== "win32"
  });
}

test("Windows login-item readback은 공백·Unicode 실행 경로를 하나의 명령으로 조회한다", () => {
  assert.equal(
    windowsLoginItemReadbackPath(
      "C:\\Users\\홍길동\\키리누키 NSIS smoke\\installed\\Kirinuki.exe"
    ),
    "\"C:\\Users\\홍길동\\키리누키 NSIS smoke\\installed\\Kirinuki.exe\""
  );
});

test("Windows login-item 실패 증거는 상태를 보존하되 실행 경로를 노출하지 않는다", async () => {
  const executablePath =
    "C:\\Users\\홍길동\\키리누키 NSIS smoke\\installed\\Kirinuki.exe";
  await assert.rejects(
    ensureEngineAutostart({
      target: "win32-x64",
      executablePath,
      loginItem: {
        set: () => undefined,
        get: () => ({
          openAtLogin: false,
          executableWillLaunchAtLogin: false,
          launchItems: []
        })
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /"executableWillLaunchAtLogin":false/u);
      assert.match(error.message, /"launchItemCount":0/u);
      assert.doesNotMatch(error.message, /홍길동|Kirinuki\.exe/u);
      return true;
    }
  );
});

test("Linux XDG 자동실행은 정확한 background 명령을 원자적으로 기록하고 멱등 readback한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "키리누키 자동실행 test "));
  try {
    const executable = "/opt/키리누키 Engine/키리누키";
    const configRoot = "/home/테스트 사용자/.config";
    const statePath = path.posix.join(
      configRoot,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    );
    const nativeStatePath = path.join(
      root,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    );
    const fileSystemSemantics = mappedStateStorage(
      statePath,
      nativeStatePath
    );

    const first = await ensureEngineAutostart({
      target: "linux-x64",
      executablePath: executable,
      linuxConfigRoot: configRoot,
      fileSystemSemantics
    });
    assert.deepEqual(first, {
      schema: ENGINE_AUTOSTART_SCHEMA,
      target: "linux-x64",
      method: "xdg-autostart",
      executablePath: executable,
      arguments: [ENGINE_BACKGROUND_ARGUMENT],
      registered: true,
      approvalRequired: false,
      readBack: true,
      statePath
    });
    assert.equal(
      await readFile(nativeStatePath, "utf8"),
      linuxEngineAutostartContent(executable, statePath)
    );
    assert.match(
      await readFile(nativeStatePath, "utf8"),
      /^TryExec=\/bin\/sh$/mu
    );
    assert.match(
      await readFile(nativeStatePath, "utf8"),
      new RegExp(`^X-Kirinuki-Executable=${executable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu")
    );
    const before = await lstat(nativeStatePath);
    assert.equal(before.isFile(), true);
    if (fileSystemSemantics.enforcePosixPermissions) {
      assert.equal(before.mode & 0o777, 0o600);
    }

    const second = await ensureEngineAutostart({
      target: "linux-x64",
      executablePath: executable,
      linuxConfigRoot: configRoot,
      fileSystemSemantics
    });
    const after = await lstat(nativeStatePath);
    assert.deepEqual(second, first);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Linux XDG 실행 shim은 엔진이 있으면 시작하고 제거됐으면 stale 항목을 스스로 회수한다", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX /bin/sh 생명주기 검증입니다.");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-autostart-stale-"));
  try {
    const executable = path.join(root, "Kirinuki Engine");
    const invoked = path.join(root, "invoked.txt");
    const configRoot = path.join(root, "config");
    const statePath = path.join(configRoot, "autostart", LINUX_ENGINE_AUTOSTART_FILE);
    await writeFile(
      executable,
      `#!/bin/sh\nprintf '%s' "$1" > '${invoked}'\n`,
      { mode: 0o700 }
    );
    await ensureEngineAutostart({
      target: "linux-x64",
      executablePath: executable,
      linuxConfigRoot: configRoot
    });
    const launch = linuxEngineAutostartLaunch(executable, statePath);
    const runLaunch = () => new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, [...launch.arguments], {
        stdio: "ignore"
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0 && signal === null) {
          resolve();
        } else {
          reject(new Error(`autostart shim code=${code}, signal=${signal ?? "none"}`));
        }
      });
    });
    await runLaunch();
    assert.equal(await readFile(invoked, "utf8"), ENGINE_BACKGROUND_ARGUMENT);
    assert.equal(
      isManagedLinuxEngineAutostartContent(await readFile(statePath, "utf8")),
      true
    );

    await rm(executable);
    await runLaunch();
    await assert.rejects(readFile(statePath, "utf8"), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows와 macOS는 Electron login-item API 설정값을 정확히 readback한다", async () => {
  for (const fixture of [
    {
      target: "win32-x64" as const,
      executablePath: "C:\\Users\\홍길동\\Kirinuki 편집기\\Kirinuki.exe",
      openAsHidden: undefined
    },
    {
      target: "darwin-arm64" as const,
      executablePath: "/Applications/키리누키 편집기.app/Contents/MacOS/Kirinuki",
      openAsHidden: true
    }
  ]) {
    let recorded: unknown;
    const result = await ensureEngineAutostart({
      target: fixture.target,
      executablePath: fixture.executablePath,
      loginItem: {
        set: (settings) => {
          recorded = settings;
        },
        get: () => ({
          openAtLogin: fixture.target === "win32-x64" ? false : true,
          executableWillLaunchAtLogin: true,
          ...(fixture.target === "win32-x64" ? {
            launchItems: [{
              name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
              path: fixture.executablePath,
              args: [ENGINE_BACKGROUND_ARGUMENT],
              scope: "user" as const,
              enabled: true
            }]
          } : {}),
          ...(fixture.target === "darwin-arm64" ? { status: "enabled" as const } : {})
        })
      }
    });
    assert.deepEqual(recorded, {
      openAtLogin: true,
      ...(fixture.openAsHidden === undefined
        ? {}
        : { openAsHidden: fixture.openAsHidden }),
      ...(fixture.target === "win32-x64" ? { enabled: true } : {}),
      path: fixture.executablePath,
      args: [ENGINE_BACKGROUND_ARGUMENT],
      name: "Kirinuki Local Engine"
    });
    assert.equal(result.method, "electron-login-item");
    assert.equal(result.readBack, true);
  }
});

test("native smoke 자동실행 검증은 실제 OS 설정을 건드리지 않고 격리 상태만 남긴다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-autostart-smoke-"));
  try {
    const executable = "/opt/Kirinuki/Kirinuki";
    const isolatedStateRoot = "/var/lib/kirinuki-smoke";
    const statePath = path.posix.join(
      isolatedStateRoot,
      "autostart-linux-x64.json"
    );
    const nativeStatePath = path.join(root, "autostart-linux-x64.json");
    const fileSystemSemantics = mappedStateStorage(
      statePath,
      nativeStatePath
    );
    let called = false;
    const result = await ensureEngineAutostart({
      target: "linux-x64",
      executablePath: executable,
      isolatedStateRoot,
      fileSystemSemantics,
      loginItem: {
        set: () => {
          called = true;
        },
        get: () => ({ openAtLogin: true })
      }
    });
    assert.equal(called, false);
    assert.equal(result.method, "isolated-smoke");
    assert.equal(result.statePath, statePath);
    const record = JSON.parse(await readFile(nativeStatePath, "utf8"));
    assert.deepEqual(record, {
      schema: ENGINE_AUTOSTART_SCHEMA,
      target: "linux-x64",
      executablePath: executable,
      arguments: [ENGINE_BACKGROUND_ARGUMENT],
      registered: true
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("자동실행 파일 자리에 symlink가 있으면 fail closed한다", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows symlink 권한에 의존하지 않습니다.");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-autostart-link-"));
  try {
    const executable = path.join(root, "Kirinuki");
    const configRoot = path.join(root, "config");
    const autostartRoot = path.join(configRoot, "autostart");
    const outside = path.join(root, "outside.desktop");
    await Promise.all([
      writeFile(executable, "engine", { mode: 0o700 }),
      mkdir(autostartRoot, { recursive: true }),
      writeFile(outside, "outside")
    ]);
    await symlink(
      outside,
      path.join(autostartRoot, LINUX_ENGINE_AUTOSTART_FILE)
    );
    await assert.rejects(
      ensureEngineAutostart({
        target: "linux-x64",
        executablePath: executable,
        linuxConfigRoot: configRoot
      }),
      /regular file/u
    );
    assert.equal(await readFile(outside, "utf8"), "outside");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("지원하지 않는 desktop target과 부정 readback은 거부한다", async () => {
  await assert.rejects(
    ensureEngineAutostart({
      target: "linux-arm64",
      executablePath: "/opt/Kirinuki/Kirinuki",
      linuxConfigRoot: "/tmp"
    }),
    /지원하지 않는 desktop target/u
  );
  await assert.rejects(
    ensureEngineAutostart({
      target: "darwin-arm64",
      executablePath: "/Applications/Kirinuki.app/Contents/MacOS/Kirinuki",
      loginItem: {
        set: () => undefined,
        get: () => ({ openAtLogin: false, status: "not-registered" })
      }
    }),
    /readback/u
  );
  const approvalPending = await ensureEngineAutostart({
      target: "darwin-arm64",
      executablePath: "/Applications/Kirinuki.app/Contents/MacOS/Kirinuki",
      loginItem: {
        set: () => undefined,
        get: () => ({
          openAtLogin: true,
          status: "requires-approval"
        })
      }
    });
  assert.equal(approvalPending.registered, false);
  assert.equal(approvalPending.approvalRequired, true);
});

test("Windows 자동실행은 exact named user Run launch-item args·enabled readback을 요구한다", async () => {
  const executablePath = "C:\\Users\\홍길동\\Kirinuki 편집기\\Kirinuki.exe";
  for (const launchItems of [
    undefined,
    [],
    [{
      name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
      path: executablePath,
      args: [],
      scope: "user" as const,
      enabled: true
    }],
    [{
      name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
      path: executablePath,
      args: [ENGINE_BACKGROUND_ARGUMENT],
      scope: "machine" as const,
      enabled: true
    }],
    [{
      name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
      path: executablePath,
      args: [ENGINE_BACKGROUND_ARGUMENT],
      scope: "user" as const,
      enabled: false
    }]
  ]) {
    await assert.rejects(
      ensureEngineAutostart({
        target: "win32-x64",
        executablePath,
        loginItem: {
          set: () => undefined,
          get: () => ({
            openAtLogin: true,
            executableWillLaunchAtLogin: true,
            ...(launchItems === undefined ? {} : { launchItems })
          })
        }
      }),
      /readback/u
    );
  }

  const registered = await ensureEngineAutostart({
    target: "win32-x64",
    executablePath,
    loginItem: {
      set: () => undefined,
      get: () => ({
        openAtLogin: false,
        executableWillLaunchAtLogin: true,
        launchItems: [{
          name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
      path: "c:\\users\\홍길동\\kirinuki 편집기\\KIRINUKI.EXE",
          args: [ENGINE_BACKGROUND_ARGUMENT],
          scope: "user",
          enabled: true
        }]
      })
    }
  });
  assert.equal(registered.registered, true);
});

test("Windows 자동실행 제거는 owned user launch-item이 남으면 fail closed한다", async () => {
  const executablePath = "C:\\Program Files\\Kirinuki\\Kirinuki.exe";
  await assert.rejects(
    removeEngineAutostart({
      target: "win32-x64",
      executablePath,
      loginItem: {
        set: () => undefined,
        get: () => ({
          openAtLogin: false,
          executableWillLaunchAtLogin: false,
          launchItems: [{
            name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
            path: executablePath,
            args: [ENGINE_BACKGROUND_ARGUMENT],
            scope: "user",
            enabled: false
          }]
        })
      }
    }),
    /제거 readback/u
  );
});

test("Linux 자동실행은 managed collision만 갱신하고 제거를 멱등 readback한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-autostart-remove-"));
  try {
    const executable = "/opt/Kirinuki/Kirinuki";
    const movedExecutable = "/opt/Kirinuki New/Kirinuki";
    const configRoot = "/home/kirinuki/.config";
    const statePath = path.posix.join(
      configRoot,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    );
    const nativeStatePath = path.join(
      root,
      "autostart",
      LINUX_ENGINE_AUTOSTART_FILE
    );
    const fileSystemSemantics = mappedStateStorage(
      statePath,
      nativeStatePath
    );
    await ensureEngineAutostart({
      target: "linux-x64",
      executablePath: executable,
      linuxConfigRoot: configRoot,
      fileSystemSemantics
    });
    assert.equal(
      isManagedLinuxEngineAutostartContent(
        await readFile(nativeStatePath, "utf8")
      ),
      true
    );
    await ensureEngineAutostart({
      target: "linux-x64",
      executablePath: movedExecutable,
      linuxConfigRoot: configRoot,
      fileSystemSemantics
    });
    assert.equal(
      await readFile(nativeStatePath, "utf8"),
      linuxEngineAutostartContent(movedExecutable, statePath)
    );
    const removed = await removeEngineAutostart({
      target: "linux-x64",
      executablePath: movedExecutable,
      linuxConfigRoot: configRoot,
      fileSystemSemantics
    });
    assert.equal(removed.removed, true);
    await assert.rejects(readFile(nativeStatePath, "utf8"), /ENOENT/u);
    await removeEngineAutostart({
      target: "linux-x64",
      executablePath: movedExecutable,
      linuxConfigRoot: configRoot,
      fileSystemSemantics
    });

    await writeFile(
      nativeStatePath,
      "[Desktop Entry]\nName=Someone Else\n"
    );
    await assert.rejects(
      ensureEngineAutostart({
        target: "linux-x64",
        executablePath: executable,
        linuxConfigRoot: configRoot,
        fileSystemSemantics
      }),
      /관리하지 않는/u
    );
    assert.equal(
      await readFile(nativeStatePath, "utf8"),
      "[Desktop Entry]\nName=Someone Else\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows/macOS managed marker는 이동한 실행 경로를 교체하고 uninstall에서 제거한다", async () => {
  const fixtures = process.platform === "win32" ? [
    {
      target: "win32-x64" as const,
      previous: "C:\\Program Files\\Kirinuki Old\\Kirinuki.exe",
      current: "C:\\Program Files\\Kirinuki\\Kirinuki.exe"
    }
  ] : [
    {
      target: "darwin-arm64" as const,
      previous: "/Applications/Kirinuki Old.app/Contents/MacOS/Kirinuki",
      current: "/Applications/Kirinuki.app/Contents/MacOS/Kirinuki"
    }
  ];
  for (const fixture of fixtures) {
    const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-login-item-state-"));
    try {
      const enabled = new Set<string>();
      const adapter = {
        set: (settings: { readonly openAtLogin: boolean; readonly path?: string }) => {
          assert.ok(settings.path);
          if (settings.openAtLogin) {
            enabled.add(settings.path);
          } else {
            enabled.delete(settings.path);
          }
        },
        get: (settings: { readonly path?: string }) => ({
          openAtLogin: Boolean(settings.path && enabled.has(settings.path)),
          executableWillLaunchAtLogin: Boolean(settings.path && enabled.has(settings.path)),
          ...(fixture.target === "win32-x64" ? {
            launchItems: [...enabled].map((executablePath) => ({
              name: WINDOWS_ENGINE_LOGIN_ITEM_NAME,
              path: executablePath,
              args: [ENGINE_BACKGROUND_ARGUMENT],
              scope: "user" as const,
              enabled: true
            }))
          } : {}),
          ...(fixture.target === "darwin-arm64"
            ? { status: settings.path && enabled.has(settings.path)
              ? "enabled" as const
              : "not-registered" as const }
            : {})
        })
      };
      await ensureEngineAutostart({
        target: fixture.target,
        executablePath: fixture.previous,
        loginItem: adapter,
        stateRoot: root
      });
      await ensureEngineAutostart({
        target: fixture.target,
        executablePath: fixture.current,
        loginItem: adapter,
        stateRoot: root
      });
      assert.deepEqual([...enabled], [fixture.current]);
      const result = await removeEngineAutostart({
        target: fixture.target,
        executablePath: fixture.current,
        loginItem: adapter,
        stateRoot: root
      });
      assert.equal(result.removed, true);
      assert.deepEqual([...enabled], []);
      assert.ok(result.statePath);
      await assert.rejects(readFile(result.statePath, "utf8"), /ENOENT/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
