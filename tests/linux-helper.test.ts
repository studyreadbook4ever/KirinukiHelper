import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BROWSER_CANDIDATES,
  DEFAULT_SOURCE_URL,
  browserProduct,
  browserLaunchArgs,
  captionStartStrategy,
  desktopDatabaseRefreshCommand,
  desktopEntryContent,
  extensionTreesMatch,
  helpText,
  inspectBrowser,
  inspectPreferredBrowser,
  inspectUserEntrypoints,
  installUserEntrypoints,
  parseBrowserMajor,
  parseLinuxHelperArgs,
  resolveLinuxHelperPaths,
  restoreLauncherPermissions,
  shouldCycleForegroundCaption,
  userLauncherContent,
  validateSourceUrl,
  versionAtLeast
} from "../scripts/linux-helper.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const helperPath = path.join(packageRoot, "scripts", "linux-helper.ts");

interface NodeRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

async function runNode(
  args: string[],
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {}
) {
  return new Promise<NodeRunResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helperPath, ...args],
      {
      cwd: packageRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("버전 하한은 Node 20.9와 Chromium 120 경계를 정확히 구분한다", () => {
  assert.equal(versionAtLeast("20.8.9", "20.9.0"), false);
  assert.equal(versionAtLeast("20.9.0", "20.9.0"), true);
  assert.equal(versionAtLeast("21.0.0", "20.9.0"), true);
  assert.equal(parseBrowserMajor("Chromium 119.0.1"), 119);
  assert.equal(parseBrowserMajor("Google Chrome 120.0.1"), 120);
  assert.equal(parseBrowserMajor("unknown"), null);
  assert.equal(browserProduct("Chromium 150.0.1"), "chromium");
  assert.equal(browserProduct("Google Chrome 150.0.1"), "chrome");
  assert.equal(browserProduct("unknown"), "unknown");
  assert.deepEqual(BROWSER_CANDIDATES, ["chromium", "chromium-browser"]);
});

test("CLI는 setup/doctor/open/status/stop 계약과 자막 방식을 파싱한다", () => {
  assert.deepEqual(
    parseLinuxHelperArgs([
      "setup",
      "--mode",
      "whisper",
      "--profile=light",
      "--backend",
      "cpu",
      "--yes",
      "--dry-run"
    ]),
    {
      command: "setup",
      options: {
        mode: "whisper",
        profile: "light",
        backend: "cpu",
        browser: null,
        yes: true,
        dryRun: true,
        json: false,
        url: null
      }
    }
  );
  assert.equal(
    parseLinuxHelperArgs([
      "open",
      "https://chzzk.naver.com/video/123"
    ]).options.url,
    "https://chzzk.naver.com/video/123"
  );
  assert.equal(
    parseLinuxHelperArgs(["start"]).command,
    "start"
  );
  assert.throws(
    () => parseLinuxHelperArgs(["setup", "--api-key", "secret"]),
    /비밀 값/u
  );
  assert.throws(
    () => parseLinuxHelperArgs(["setup", "--mode", "solar"]),
    /mode/u
  );
  assert.throws(
    () => parseLinuxHelperArgs(["status", "--profile", "quality"]),
    /setup에서만/u
  );
});

test("URL은 지원 서비스의 공개 HTTPS만 한 인자로 허용한다", () => {
  for (const value of [
    "https://chzzk.naver.com/video/14405514",
    "https://www.youtube.com/watch?v=nixLJx1UhfY",
    "https://youtu.be/nixLJx1UhfY",
    "https://naver.me/xJcAj1dV"
  ]) {
    assert.equal(validateSourceUrl(value), value);
  }
  assert.equal(validateSourceUrl(""), DEFAULT_SOURCE_URL);
  for (const value of [
    "http://chzzk.naver.com/video/1",
    "https://example.com/video/1",
    "https://user:pass@youtube.com/watch?v=x",
    "javascript:alert(1)",
    "https://youtube.com/\n--remote-debugging-port=1"
  ]) {
    assert.throws(() => validateSourceUrl(value), /URL|HTTPS|제어/u);
  }
});

test("브라우저 인자는 안정적인 전용 profile과 exact Extension만 사용한다", () => {
  const args = browserLaunchArgs({
    extensionRoot: "/tmp/Kirinuki Folder/extension",
    profileRoot: "/tmp/Kirinuki Profile",
    sourceUrl: "https://chzzk.naver.com/video/1"
  });
  assert.deepEqual(args, [
    "--user-data-dir=/tmp/Kirinuki Profile",
    "--disable-extensions-except=/tmp/Kirinuki Folder/extension",
    "--load-extension=/tmp/Kirinuki Folder/extension",
    "--no-first-run",
    "--no-default-browser-check",
    "https://chzzk.naver.com/video/1"
  ]);
  assert.ok(!args.some((value) => /remote-debugging/iu.test(value)));
});

test("Whisper 시작은 설치·Origin·ready 뒤 systemd/foreground를 정확히 고른다", () => {
  assert.equal(captionStartStrategy(null), "setup-required");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: false
  }), "origin-mismatch");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: true,
    endpoints: { stt: true, gateway: true },
    systemdUser: false
  }), "ready");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: true,
    endpoints: { stt: false, gateway: false },
    systemdUser: true
  }), "systemd");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: true,
    endpoints: { stt: false, gateway: false },
    systemdUser: false
  }), "foreground");
  assert.equal(shouldCycleForegroundCaption({
    configured: true,
    runtime: {
      manager: "foreground",
      managedForeground: true
    }
  }), true);
  assert.equal(shouldCycleForegroundCaption({
    configured: true,
    runtime: {
      manager: "systemd",
      managedForeground: false
    }
  }), false);
});

test("XDG 경로는 repository 밖의 안정적인 사용자 profile을 고른다", () => {
  const paths = resolveLinuxHelperPaths({
    env: {
      XDG_CONFIG_HOME: "/tmp/config root",
      XDG_STATE_HOME: "/tmp/state root",
      XDG_DATA_HOME: "/tmp/data root",
      KIRINUKI_EXTENSION_ROOT: "/srv/kirinuki runtime/extension",
      KIRINUKI_BROWSER_PROFILE_ROOT: "/srv/kirinuki profile"
    },
    homeDir: "/tmp/home",
    packageDir: "/opt/KirinukiHelper"
  });
  assert.equal(
    paths.browserProfileRoot,
    "/srv/kirinuki profile"
  );
  assert.equal(
    paths.extensionRoot,
    "/srv/kirinuki runtime/extension"
  );
  assert.equal(
    paths.captionLogPath,
    "/tmp/state root/kirinuki-studio/caption-stack.log"
  );
  assert.equal(paths.userLauncherPath, "/tmp/home/.local/bin/kirinuki");
  assert.equal(
    paths.desktopEntryPath,
    "/tmp/data root/applications/kirinuki-helper.desktop"
  );
  assert.equal(
    paths.legacyDesktopEntryPath,
    "/tmp/data root/applications/chromium-kirinuki.desktop"
  );
  const invalidOverrides: ReadonlyArray<readonly [string, string]> = [
    ["KIRINUKI_EXTENSION_ROOT", "relative/extension"],
    ["KIRINUKI_EXTENSION_ROOT", ""],
    ["KIRINUKI_BROWSER_PROFILE_ROOT", "/tmp/profile\nother"]
  ];
  for (const [name, value] of invalidOverrides) {
    assert.throws(
      () => resolveLinuxHelperPaths({
        env: { [name]: value },
        homeDir: "/tmp/home"
      }),
      /절대경로/u
    );
  }
});

test("setup용 사용자 명령과 desktop entry는 원자적으로 최신 경로만 가리킨다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-entrypoints-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const paths = resolveLinuxHelperPaths({
    env: {
      XDG_DATA_HOME: path.join(tempRoot, "data"),
      KIRINUKI_EXTENSION_ROOT: path.join(tempRoot, "runtime extension"),
      KIRINUKI_BROWSER_PROFILE_ROOT: path.join(tempRoot, "browser profile")
    },
    homeDir: path.join(tempRoot, "home"),
    packageDir: "/opt/Kirinuki Helper"
  });
  const updaterRoot = path.join(tempRoot, "bin");
  const updater = path.join(updaterRoot, "update-desktop-database");
  await mkdir(updaterRoot, { recursive: true });
  await writeFile(updater, "#!/bin/sh\nexit 0\n");
  await chmod(updater, 0o755);
  assert.deepEqual(
    desktopDatabaseRefreshCommand(paths, { PATH: updaterRoot }),
    {
      file: updater,
      args: [path.dirname(paths.desktopEntryPath)]
    }
  );
  assert.equal(
    desktopDatabaseRefreshCommand(paths, { PATH: "" }),
    null
  );
  const firstInstall = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.deepEqual(firstInstall.replacedEntrypointBackups, []);
  const launcher = await readFile(paths.userLauncherPath, "utf8");
  const desktop = await readFile(paths.desktopEntryPath, "utf8");
  assert.equal(
    launcher,
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );
  assert.match(
    launcher,
    /KIRINUKI_EXTENSION_ROOT='\/.+runtime extension'/u
  );
  assert.match(
    launcher,
    /KIRINUKI_BROWSER_PROFILE_ROOT='\/.+browser profile'/u
  );
  assert.match(
    launcher,
    /exec '\/opt\/Kirinuki Helper\/kirinuki\.sh' "\$@"/u
  );
  assert.match(launcher, /if \[ "\$#" -eq 0 \]; then\n  set -- open\nfi/u);
  assert.equal((await stat(paths.userLauncherPath)).mode & 0o777, 0o755);
  assert.equal(
    desktop,
    desktopEntryContent(paths)
  );
  assert.match(desktop, /^Exec="\/.+\/kirinuki"$/mu);
  assert.doesNotMatch(desktop, /^MimeType=/mu);
  assert.doesNotMatch(desktop, /x-scheme-handler|text\/html/iu);
  assert.match(desktop, /^Terminal=false$/mu);
  assert.equal((await stat(paths.desktopEntryPath)).mode & 0o777, 0o644);

  const launcherBefore = await lstat(paths.userLauncherPath);
  const desktopBefore = await lstat(paths.desktopEntryPath);
  const secondInstall = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.deepEqual(secondInstall.replacedEntrypointBackups, []);
  assert.equal((await lstat(paths.userLauncherPath)).ino, launcherBefore.ino);
  assert.equal((await lstat(paths.desktopEntryPath)).ino, desktopBefore.ino);
  assert.deepEqual(
    (await readdir(path.dirname(paths.userLauncherPath)))
      .filter((name) => name.includes(".backup-")),
    []
  );

  let report = await inspectUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(report.current, true);
  const legacyBody = [
    "[Desktop Entry]",
    "Version=1.0",
    "Name=Chromium - 치지직 키리누키",
    "GenericName=CHZZK Kirinuki Browser",
    `Exec=${path.join(path.dirname(paths.userLauncherPath), "chromium-kirinuki")} %U`,
    "Type=Application",
    "MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;",
    ""
  ].join("\n");
  await writeFile(paths.legacyDesktopEntryPath, legacyBody);
  report = await inspectUserEntrypoints(paths, "/opt/Kirinuki Helper");
  assert.equal(report.legacyDesktop.recognized, true);
  assert.equal(report.current, false);
  const retired = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.ok(retired.retiredLegacyPath);
  await assert.rejects(stat(paths.legacyDesktopEntryPath));
  assert.equal(
    await readFile(retired.retiredLegacyPath, "utf8"),
    legacyBody
  );

  const unrelated = [
    "[Desktop Entry]",
    "Name=사용자의 별도 앱",
    "Exec=/opt/unrelated",
    "Type=Application",
    ""
  ].join("\n");
  await writeFile(paths.legacyDesktopEntryPath, unrelated);
  const untouched = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(untouched.retiredLegacyPath, null);
  assert.equal(
    await readFile(paths.legacyDesktopEntryPath, "utf8"),
    unrelated
  );
  report = await inspectUserEntrypoints(paths, "/opt/Kirinuki Helper");
  assert.equal(report.legacyDesktop.present, true);
  assert.equal(report.legacyDesktop.recognized, false);
  assert.equal(report.current, true);

  const knownLegacyLauncher = [
    "#!/bin/sh",
    "",
    "set -eu",
    "",
    `LAUNCHER="${path.join(path.dirname(paths.userLauncherPath), "chromium-kirinuki")}"`,
    "",
    "if [ ! -x \"$LAUNCHER\" ]; then",
    "  printf '%s\\n' \"치지직 키리누키 전용 Chromium 실행기를 찾지 못했습니다: $LAUNCHER\" >&2",
    "  exit 1",
    "fi",
    "",
    "exec \"$LAUNCHER\" \"$@\"",
    ""
  ].join("\n");
  await writeFile(paths.userLauncherPath, knownLegacyLauncher);
  await chmod(paths.userLauncherPath, 0o755);
  const migratedLegacy = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(migratedLegacy.replacedEntrypointBackups.length, 1);
  const [backupPath] = migratedLegacy.replacedEntrypointBackups;
  assert.ok(backupPath);
  assert.equal(
    await readFile(backupPath, "utf8"),
    knownLegacyLauncher
  );
  assert.equal(
    await readFile(paths.userLauncherPath, "utf8"),
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );

  await writeFile(
    paths.userLauncherPath,
    "#!/bin/sh\nexec /opt/old-kirinuki/kirinuki.sh \"$@\"\n"
  );
  await chmod(paths.userLauncherPath, 0o755);
  report = await inspectUserEntrypoints(paths, "/opt/Kirinuki Helper");
  assert.equal(report.current, false);
  assert.equal(
    report.launcher.actualTarget,
    "/opt/old-kirinuki/kirinuki.sh"
  );
});

test("설치된 bare kirinuki는 open으로, 명시 인자는 그대로 전달한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-wrapper-forwarding-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const packageDir = path.join(tempRoot, "package root");
  await mkdir(packageDir, { recursive: true });
  const target = path.join(packageDir, "kirinuki.sh");
  await writeFile(
    target,
    [
      "#!/bin/sh",
      "printf 'args=%s\\n' \"$*\"",
      "printf 'extension=%s\\n' \"$KIRINUKI_EXTENSION_ROOT\"",
      "printf 'profile=%s\\n' \"$KIRINUKI_BROWSER_PROFILE_ROOT\"",
      ""
    ].join("\n")
  );
  await chmod(target, 0o755);
  const paths = resolveLinuxHelperPaths({
    env: {
      XDG_DATA_HOME: path.join(tempRoot, "data"),
      KIRINUKI_EXTENSION_ROOT: path.join(tempRoot, "runtime extension"),
      KIRINUKI_BROWSER_PROFILE_ROOT: path.join(tempRoot, "browser profile")
    },
    homeDir: path.join(tempRoot, "home"),
    packageDir
  });
  await installUserEntrypoints(paths, packageDir);

  const runWrapper = (args: string[]) => new Promise<NodeRunResult>((
    resolve,
    reject
  ) => {
    const child = spawn(paths.userLauncherPath, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
  const bare = await runWrapper([]);
  assert.equal(bare.code, 0, bare.stderr);
  assert.match(bare.stdout, /^args=open$/mu);
  assert.match(
    bare.stdout,
    new RegExp(`^extension=${paths.extensionRoot}$`, "mu")
  );
  assert.match(
    bare.stdout,
    new RegExp(`^profile=${paths.browserProfileRoot}$`, "mu")
  );

  const explicit = await runWrapper(["status", "--json"]);
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.match(explicit.stdout, /^args=status --json$/mu);
});

test("사용자의 unrelated 파일과 symlink는 setup이 절대 덮어쓰지 않는다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-entrypoint-ownership-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const makePaths = (name: string) => resolveLinuxHelperPaths({
    env: {
      XDG_DATA_HOME: path.join(tempRoot, name, "data")
    },
    homeDir: path.join(tempRoot, name, "home"),
    packageDir: "/opt/Kirinuki Helper"
  });

  const unrelatedPaths = makePaths("unrelated");
  await Promise.all([
    mkdir(path.dirname(unrelatedPaths.userLauncherPath), {
      recursive: true
    }),
    mkdir(path.dirname(unrelatedPaths.desktopEntryPath), {
      recursive: true
    })
  ]);
  const unrelatedLauncher = "#!/bin/sh\nexec /opt/my-own-tool \"$@\"\n";
  const unrelatedDesktop = [
    "[Desktop Entry]",
    "Name=내 앱",
    "Exec=/opt/my-own-tool",
    "Type=Application",
    ""
  ].join("\n");
  await Promise.all([
    writeFile(unrelatedPaths.userLauncherPath, unrelatedLauncher),
    writeFile(unrelatedPaths.desktopEntryPath, unrelatedDesktop)
  ]);
  const unrelatedLauncherInode = (
    await lstat(unrelatedPaths.userLauncherPath)
  ).ino;
  const unrelatedDesktopInode = (
    await lstat(unrelatedPaths.desktopEntryPath)
  ).ino;
  await assert.rejects(
    installUserEntrypoints(
      unrelatedPaths,
      "/opt/Kirinuki Helper"
    ),
    /소유 marker가 없는 기존 사용자 파일/u
  );
  assert.equal(
    await readFile(unrelatedPaths.userLauncherPath, "utf8"),
    unrelatedLauncher
  );
  assert.equal(
    await readFile(unrelatedPaths.desktopEntryPath, "utf8"),
    unrelatedDesktop
  );
  assert.equal(
    (await lstat(unrelatedPaths.userLauncherPath)).ino,
    unrelatedLauncherInode
  );
  assert.equal(
    (await lstat(unrelatedPaths.desktopEntryPath)).ino,
    unrelatedDesktopInode
  );

  const symlinkPaths = makePaths("symlink");
  await Promise.all([
    mkdir(path.dirname(symlinkPaths.userLauncherPath), {
      recursive: true
    }),
    mkdir(path.dirname(symlinkPaths.desktopEntryPath), {
      recursive: true
    })
  ]);
  const launcherTarget = path.join(tempRoot, "launcher-target");
  const desktopTarget = path.join(tempRoot, "desktop-target");
  await Promise.all([
    writeFile(launcherTarget, "launcher target bytes"),
    writeFile(desktopTarget, "desktop target bytes")
  ]);
  await Promise.all([
    symlink(launcherTarget, symlinkPaths.userLauncherPath),
    symlink(desktopTarget, symlinkPaths.desktopEntryPath)
  ]);
  await assert.rejects(
    installUserEntrypoints(
      symlinkPaths,
      "/opt/Kirinuki Helper"
    ),
    /심볼릭 링크/u
  );
  assert.equal(
    await readlink(symlinkPaths.userLauncherPath),
    launcherTarget
  );
  assert.equal(
    await readlink(symlinkPaths.desktopEntryPath),
    desktopTarget
  );
  assert.equal(
    await readFile(launcherTarget, "utf8"),
    "launcher target bytes"
  );
  assert.equal(
    await readFile(desktopTarget, "utf8"),
    "desktop target bytes"
  );
  assert.equal(
    (await lstat(symlinkPaths.userLauncherPath)).isSymbolicLink(),
    true
  );
  assert.equal(
    (await lstat(symlinkPaths.desktopEntryPath)).isSymbolicLink(),
    true
  );

  const report = await inspectUserEntrypoints(
    symlinkPaths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(report.launcher.installed, true);
  assert.match(report.launcher.actualTarget || "", /symlink/u);
  assert.equal(report.desktop.installed, true);
  assert.match(report.desktop.actualTarget || "", /symlink/u);

  const unreadablePaths = makePaths("unreadable");
  await Promise.all([
    mkdir(path.dirname(unreadablePaths.userLauncherPath), {
      recursive: true
    }),
    mkdir(path.dirname(unreadablePaths.desktopEntryPath), {
      recursive: true
    })
  ]);
  await Promise.all([
    writeFile(unreadablePaths.userLauncherPath, "private launcher"),
    writeFile(
      unreadablePaths.desktopEntryPath,
      desktopEntryContent(unreadablePaths)
    )
  ]);
  await chmod(unreadablePaths.userLauncherPath, 0o000);
  t.after(() => chmod(
    unreadablePaths.userLauncherPath,
    0o600
  ).catch(() => {}));
  const unreadableReport = await inspectUserEntrypoints(
    unreadablePaths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(unreadableReport.launcher.installed, true);
  assert.match(unreadableReport.launcher.actualTarget || "", /읽기 실패/u);
  await assert.rejects(
    installUserEntrypoints(
      unreadablePaths,
      "/opt/Kirinuki Helper"
    ),
    /안전하게 읽지 못해/u
  );
  assert.equal(
    (await lstat(unreadablePaths.userLauncherPath)).mode & 0o777,
    0o000
  );

  const unreadableLegacyPaths = makePaths("unreadable-legacy");
  await mkdir(
    path.dirname(unreadableLegacyPaths.legacyDesktopEntryPath),
    { recursive: true }
  );
  await writeFile(
    unreadableLegacyPaths.legacyDesktopEntryPath,
    "unreadable legacy candidate"
  );
  await chmod(unreadableLegacyPaths.legacyDesktopEntryPath, 0o000);
  t.after(() => chmod(
    unreadableLegacyPaths.legacyDesktopEntryPath,
    0o600
  ).catch(() => {}));
  const unreadableLegacyReport = await inspectUserEntrypoints(
    unreadableLegacyPaths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(
    unreadableLegacyReport.legacyDesktop.present,
    true
  );
  assert.match(
    unreadableLegacyReport.legacyDesktop.actualTarget || "",
    /읽기 실패/u
  );
  await assert.rejects(
    installUserEntrypoints(
      unreadableLegacyPaths,
      "/opt/Kirinuki Helper"
    ),
    /레거시 Kirinuki 앱 메뉴를 안전하게 검사하지 못해/u
  );
  await assert.rejects(
    lstat(unreadableLegacyPaths.userLauncherPath),
    { code: "ENOENT" }
  );
});

test("외부 Extension 경로는 현재 repository 빌드와 파일 단위로 같아야 한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-extension-match-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const reference = path.join(tempRoot, "reference");
  const selected = path.join(tempRoot, "selected");
  await Promise.all([
    mkdir(path.join(reference, "editor"), { recursive: true }),
    mkdir(path.join(selected, "editor"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(reference, "manifest.json"), "{\"version\":\"1\"}"),
    writeFile(path.join(selected, "manifest.json"), "{\"version\":\"1\"}"),
    writeFile(path.join(reference, "editor", "editor.js"), "latest"),
    writeFile(path.join(selected, "editor", "editor.js"), "latest")
  ]);
  assert.equal(await extensionTreesMatch(reference, selected), true);
  await writeFile(path.join(selected, "editor", "editor.js"), "stale");
  assert.equal(await extensionTreesMatch(reference, selected), false);
  await writeFile(path.join(selected, "editor", "editor.js"), "latest");
  await writeFile(path.join(selected, "unexpected.js"), "old leftover");
  assert.equal(await extensionTreesMatch(reference, selected), false);
});

test("도움말은 사람이 쓸 모든 명령과 안전 경계를 노출한다", () => {
  const text = helpText();
  for (const command of [
    "setup",
    "doctor",
    "open",
    "start",
    "status",
    "stop"
  ]) {
    assert.match(text, new RegExp(`\\b${command}\\b`, "u"));
  }
  assert.match(text, /audseg/u);
  assert.match(text, /whisper/u);
  assert.match(text, /강제 종료하지 않음/u);
  assert.match(text, /\.local\/bin\/kirinuki/u);
  assert.match(text, /KIRINUKI_EXTENSION_ROOT/u);
  assert.match(text, /KIRINUKI_BROWSER_PROFILE_ROOT/u);
  assert.doesNotMatch(text, /curl\s*\|\s*(?:ba)?sh/iu);
});

test("fresh Linux dry-run은 외부 변경 없이 정확한 setup과 open 명령을 보여준다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-linux-helper-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const browser = path.join(tempRoot, "chromium");
  const npm = path.join(tempRoot, "npm");
  await Promise.all([
    writeFile(
      browser,
      "#!/bin/sh\nprintf '%s\\n' 'Chromium 120.0.0.0'\n"
    ),
    writeFile(npm, "#!/bin/sh\nexit 0\n")
  ]);
  await Promise.all([chmod(browser, 0o755), chmod(npm, 0o755)]);
  const env = {
    ...process.env,
    HOME: path.join(tempRoot, "home"),
    PATH: `${tempRoot}:${process.env.PATH || ""}`,
    KIRINUKI_BROWSER_BINARY: browser,
    KIRINUKI_NPM_BINARY: npm,
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_STATE_HOME: path.join(tempRoot, "state")
  };

  const setup = await runNode([
    "setup",
    "--mode",
    "audseg",
    "--yes",
    "--dry-run"
  ], { env });
  assert.equal(setup.code, 0, setup.stderr);
  assert.match(setup.stdout, /ci" "--ignore-scripts/u);
  assert.match(setup.stdout, /run" "build/u);
  assert.match(setup.stdout, /run" "validate/u);
  assert.match(setup.stdout, /run" "license:check/u);
  assert.match(setup.stdout, /사용자 명령 설치:/u);
  assert.match(setup.stdout, /앱 메뉴 설치:/u);
  assert.doesNotMatch(setup.stdout, /caption-stack\.ts" "setup/u);

  const whisperSetup = await runNode([
    "setup",
    "--mode",
    "whisper",
    "--profile",
    "draft",
    "--backend",
    "cpu",
    "--yes",
    "--dry-run"
  ], { env });
  assert.equal(whisperSetup.code, 0, whisperSetup.stderr);
  assert.match(whisperSetup.stdout, /local-caption-stack\.ts" "doctor/u);
  assert.match(whisperSetup.stdout, /local-caption-stack\.ts" "setup/u);
  assert.match(whisperSetup.stdout, /"--profile" "draft"/u);
  assert.match(whisperSetup.stdout, /"--backend" "cpu"/u);

  const open = await runNode([
    "open",
    "--mode",
    "audseg",
    "--dry-run",
    "https://naver.me/xJcAj1dV"
  ], { env });
  assert.equal(open.code, 0, open.stderr);
  assert.match(open.stdout, /--user-data-dir=/u);
  assert.match(open.stdout, /--load-extension=/u);
  assert.match(open.stdout, /https:\/\/naver\.me\/xJcAj1dV/u);
  assert.equal(
    await readFile(browser, "utf8"),
    "#!/bin/sh\nprintf '%s\\n' 'Chromium 120.0.0.0'\n"
  );
});

test("일반 Google Chrome 자동 로드는 fail-closed이고 저장된 Chrome은 Chromium으로 대체한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-browser-brand-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const chromium = path.join(tempRoot, "chromium");
  const chrome = path.join(tempRoot, "google-chrome");
  await Promise.all([
    writeFile(
      chromium,
      "#!/bin/sh\nprintf '%s\\n' 'Chromium 150.0.0.0'\n"
    ),
    writeFile(
      chrome,
      "#!/bin/sh\nprintf '%s\\n' 'Google Chrome 150.0.0.0'\n"
    )
  ]);
  await Promise.all([chmod(chromium, 0o755), chmod(chrome, 0o755)]);
  const env = {
    PATH: tempRoot
  };
  const branded = inspectBrowser({ requested: chrome, env });
  assert.equal(branded.available, true);
  assert.equal(branded.product, "chrome");
  assert.equal(branded.supported, false);
  assert.equal(
    inspectPreferredBrowser({ explicit: chrome, env }).supported,
    false
  );
  const replacement = inspectPreferredBrowser({ stored: chrome, env });
  assert.equal(replacement.supported, true);
  assert.equal(replacement.product, "chromium");
  assert.equal(replacement.binary, chromium);
});

test("누락된 fresh Linux 의존성은 변경 없이 실행 가능한 설치 안내로 실패한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-missing-dependencies-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: "",
    HOME: path.join(tempRoot, "home"),
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_STATE_HOME: path.join(tempRoot, "state"),
    XDG_DATA_HOME: path.join(tempRoot, "data")
  };
  delete env.KIRINUKI_BROWSER_BINARY;
  delete env.KIRINUKI_NPM_BINARY;
  delete env.KIRINUKI_EXTENSION_ROOT;
  delete env.KIRINUKI_BROWSER_PROFILE_ROOT;
  const result = await runNode([
    "doctor",
    "--mode",
    "audseg"
  ], { env });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /npm: 없음/u);
  assert.match(result.stdout, /Chromium 없음/u);
  assert.match(result.stdout, /apt install nodejs npm chromium/u);
  assert.doesNotMatch(result.stdout, /chromium cmake c\+\+ tar/u);
  assert.match(result.stdout, /자동 실행하지 않습니다/u);
});

test("AudSeg status와 stop은 Whisper companion을 호출하지 않는다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-audseg-status-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: path.join(tempRoot, "home"),
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_STATE_HOME: path.join(tempRoot, "state")
  };
  const status = await runNode([
    "status",
    "--mode",
    "audseg",
    "--json"
  ], { env });
  assert.equal(status.code, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.caption.value.required, false);

  const stopped = await runNode([
    "stop",
    "--mode",
    "audseg"
  ], { env });
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.match(stopped.stdout, /중지할 백그라운드 서비스가 없습니다/u);
  assert.match(stopped.stdout, /직접 정상 종료/u);
});

test("셸 진입점은 ZIP의 0644 권한에서도 setup을 열고 성공 뒤 실행권한을 복원한다", async (t) => {
  const [launcher, setup] = await Promise.all([
    readFile(path.join(packageRoot, "kirinuki.sh"), "utf8"),
    readFile(path.join(packageRoot, "setup.sh"), "utf8")
  ]);
  assert.match(launcher, /^#!\/usr\/bin\/env bash/u);
  assert.match(launcher, /scripts\/linux-helper\.ts/u);
  assert.match(launcher, /Node\.js 20\.9/u);
  assert.doesNotMatch(launcher, /curl\s*\|\s*(?:ba)?sh/iu);
  assert.match(setup, /kirinuki\.sh" setup/u);
  assert.doesNotMatch(setup, /rm\s+-rf/u);
  assert.match(setup, /exec bash .+kirinuki\.sh" setup/u);
  const helper = await readFile(helperPath, "utf8");
  assert.doesNotMatch(helper, /process\.kill|child\.kill/u);
  assert.match(helper, /detached:\s*true/u);

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-source-zip-mode-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const copiedLauncher = path.join(tempRoot, "kirinuki.sh");
  const copiedSetup = path.join(tempRoot, "setup.sh");
  const fakeNode = path.join(tempRoot, "node");
  const fakeTsxCli = path.join(
    tempRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  await mkdir(path.dirname(fakeTsxCli), { recursive: true });
  await Promise.all([
    writeFile(copiedLauncher, launcher),
    writeFile(copiedSetup, setup),
    writeFile(fakeTsxCli, ""),
    writeFile(
      fakeNode,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then",
        "  printf '%s\\n' 'v20.9.0'",
        "  exit 0",
        "fi",
        "printf '%s\\n' \"$@\"",
        ""
      ].join("\n")
    )
  ]);
  await Promise.all([
    chmod(copiedLauncher, 0o644),
    chmod(copiedSetup, 0o644),
    chmod(fakeNode, 0o755)
  ]);
  const entry = await new Promise<NodeRunResult>((resolve, reject) => {
    const child = spawn(
      "bash",
      [copiedSetup, "--mode", "audseg", "--dry-run"],
      {
        env: {
          ...process.env,
          KIRINUKI_NODE_BINARY: fakeNode
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => (
      resolve({ code, signal, stdout, stderr })
    ));
  });
  assert.equal(entry.code, 0, entry.stderr);
  assert.match(entry.stdout, /scripts\/linux-helper\.ts/u);
  assert.match(entry.stdout, /^setup$/mu);
  assert.equal((await stat(copiedLauncher)).mode & 0o777, 0o644);
  await restoreLauncherPermissions(tempRoot);
  assert.equal((await stat(copiedLauncher)).mode & 0o777, 0o755);
  assert.equal((await stat(copiedSetup)).mode & 0o777, 0o755);
});
