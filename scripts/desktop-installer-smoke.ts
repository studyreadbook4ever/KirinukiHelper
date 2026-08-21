import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_INSTALLER_MANIFEST_SCHEMA,
  desktopInstallerArtifactFileName,
  desktopInstallerManifestFileName,
  desktopInstallerTarget
} from "../src/desktop/installer-contract.js";
import type { DesktopInstallerChannel } from "../src/desktop/installer-contract.js";
import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";
import {
  WINDOWS_ENGINE_LOGIN_ITEM_NAME
} from "../src/desktop/login-autostart.js";
import {
  runNativePackageSmoke
} from "./desktop-package-smoke.js";
import type {
  DesktopNativePackagePaths
} from "./desktop-package-smoke.js";
import {
  runInstalledEngineBrowserSmoke
} from "./installed-engine-browser-smoke.js";
import {
  verifyPackagedDesktopTools
} from "./package-desktop.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const COMMAND_TIMEOUT_MS = 3 * 60 * 1_000;
const SYSTEM_SMOKE_ENV = "KIRINUKI_INSTALLER_SYSTEM_SMOKE";
const INSTALLED_BROWSER_SMOKE_ENV = "KIRINUKI_INSTALLED_BROWSER_SMOKE";

function installedBrowserSmoke() {
  return process.env[INSTALLED_BROWSER_SMOKE_ENV] === "1"
    ? runInstalledEngineBrowserSmoke
    : undefined;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function currentTarget(): DesktopBundleTarget {
  return `${process.platform}-${process.arch}` as DesktopBundleTarget;
}

function run(
  command: string,
  args: readonly string[],
  {
    allowFailure = false,
    env = process.env
  }: {
    readonly allowFailure?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  } = {}
): Promise<Readonly<CommandResult>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    const append = (key: "stdout" | "stderr") => (chunk: Buffer) => {
      if (key === "stdout") {
        stdout = (stdout + chunk.toString("utf8")).slice(-1024 * 1024);
      } else {
        stderr = (stderr + chunk.toString("utf8")).slice(-1024 * 1024);
      }
    };
    child.stdout.on("data", append("stdout"));
    child.stderr.on("data", append("stderr"));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`installer smoke command timeout: ${path.basename(command)}`));
    }, COMMAND_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const numericCode = code ?? 1;
      if (signal !== null || (!allowFailure && numericCode !== 0)) {
        reject(new Error(
          `installer smoke command failed: ${path.basename(command)} code=${numericCode} signal=${signal ?? "none"}\n${stderr}`
        ));
        return;
      }
      resolve(Object.freeze({ code: numericCode, stdout, stderr }));
    });
  });
}

async function sha256RegularFile(filePath: string): Promise<Readonly<{
  readonly bytes: number;
  readonly sha256: string;
}>> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 100_000,
    "installer artifact가 regular non-symlink 파일이 아닙니다."
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat();
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - offset),
        offset
      );
      invariant(bytesRead > 0, "installer artifact를 끝까지 읽지 못했습니다.");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeMs === after.mtimeMs
        && before.ctimeMs === after.ctimeMs,
      "installer artifact가 검증 중 바뀌었습니다."
    );
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

async function assertPathAbsent(pathname: string): Promise<void> {
  try {
    await lstat(pathname);
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`installer uninstall 뒤 경로가 남았습니다: ${pathname}`);
}

async function removeWindowsTestJunction(pathname: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(pathname);
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  invariant(
    metadata.isSymbolicLink(),
    "Windows smoke fixture가 junction이 아닌 경로로 바뀌어 정리를 거부했습니다."
  );
  await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[IO.Directory]::Delete($args[0])",
    pathname
  ]);
  await assertPathAbsent(pathname);
}

interface WindowsEngineRegistrySnapshot {
  readonly approval: string | null;
  readonly run: string | null;
}

async function windowsEngineRegistrySnapshot(): Promise<WindowsEngineRegistrySnapshot> {
  const result = await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$runKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
      "$approvalKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'",
      `$name='${WINDOWS_ENGINE_LOGIN_ITEM_NAME}'`,
      "$run=$null",
      "$approval=$null",
      "if (Test-Path -LiteralPath $runKey) { $property=(Get-ItemProperty -LiteralPath $runKey).PSObject.Properties[$name]; if ($null -ne $property) { $run=[string]$property.Value } }",
      "if (Test-Path -LiteralPath $approvalKey) { $property=(Get-ItemProperty -LiteralPath $approvalKey).PSObject.Properties[$name]; if ($null -ne $property) { $approval=[Convert]::ToBase64String([byte[]]$property.Value) } }",
      "[ordered]@{approval=$approval;run=$run}|ConvertTo-Json -Compress"
    ].join("; ")
  ]);
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  invariant(
    Object.keys(value).sort().join(",") === "approval,run"
      && (value.approval === null || typeof value.approval === "string")
      && (value.run === null || typeof value.run === "string"),
    "Windows engine registry readback 구조가 올바르지 않습니다."
  );
  return Object.freeze({
    approval: value.approval as string | null,
    run: value.run as string | null
  });
}

async function linuxSystemInstallSmoke(
  artifactPath: string,
  target: DesktopBundleTarget
): Promise<void> {
  const packageName = (await run(
    "/usr/bin/dpkg-deb",
    ["--field", artifactPath, "Package"]
  )).stdout.trim();
  invariant(/^[a-z0-9][a-z0-9+.-]{0,127}$/u.test(packageName), "deb package 이름이 올바르지 않습니다.");
  const existing = await run(
    "/usr/bin/dpkg-query",
    ["--show", "--showformat=${db:Status-Status}", packageName],
    { allowFailure: true }
  );
  invariant(existing.code !== 0 || existing.stdout.trim() !== "installed", "기존 Kirinuki 설치를 덮어쓸 수 없습니다.");
  let installed = false;
  let packageTouched = false;
  let managedPaths: readonly string[] = [];
  let managedFiles: readonly string[] = [];
  try {
    await run("sudo", ["/usr/bin/dpkg", "--install", artifactPath]);
    installed = true;
    packageTouched = true;
    managedPaths = (await run(
      "/usr/bin/dpkg-query",
      ["--listfiles", packageName]
    )).stdout.split(/\r?\n/u).filter((entry) => entry.startsWith("/"));
    managedFiles = (await Promise.all(managedPaths.map(async (entry) => {
      try {
        const metadata = await lstat(entry);
        return metadata.isFile() || metadata.isSymbolicLink() ? entry : null;
      } catch {
        return null;
      }
    }))).filter((entry): entry is string => entry !== null);
    const appAsar = managedPaths.find((entry) => entry.endsWith("/resources/app.asar"));
    invariant(appAsar, "설치된 deb에서 resources/app.asar를 찾지 못했습니다.");
    const desktopFiles = managedPaths.filter((entry) => entry.endsWith(".desktop"));
    invariant(desktopFiles.length === 1, "설치된 deb desktop entry가 유일하지 않습니다.");
    const desktopEntry = await readFile(desktopFiles[0]!, "utf8");
    invariant(
      /^MimeType=.*(?:^|;)x-scheme-handler\/kirinuki-engine;(?:$|;)/mu.test(desktopEntry)
        && /^Exec=.*%U(?:\s|$)/mu.test(desktopEntry),
      "Linux installer의 custom protocol MIME/argv desktop entry가 올바르지 않습니다."
    );
    const resourcesRoot = path.dirname(appAsar);
    const packageRoot = path.dirname(resourcesRoot);
    const executableCandidates = managedPaths.filter((entry) => (
      path.dirname(entry) === packageRoot
        && ["kirinuki", "Kirinuki"].includes(path.basename(entry))
    ));
    invariant(executableCandidates.length === 1, "설치된 deb 실행 파일 identity가 유일하지 않습니다.");
    const paths: Readonly<DesktopNativePackagePaths> = Object.freeze({
      packageRoot,
      executable: executableCandidates[0]!,
      resourcesRoot
    });
    await runNativePackageSmoke({
      target,
      paths,
      autostartMode: "production",
      ...(installedBrowserSmoke()
        ? { browserSmoke: runInstalledEngineBrowserSmoke }
        : {}),
      terminateWhileRunning: async ({ executablePath }) => {
        invariant(
          executablePath === paths.executable,
          "Linux removal smoke executable identity가 바뀌었습니다."
        );
        await run("sudo", ["/usr/bin/dpkg", "--remove", packageName]);
        installed = false;
      }
    });
  } finally {
    if (installed) {
      await run("sudo", ["/usr/bin/dpkg", "--remove", packageName], {
        allowFailure: true
      });
    }
    if (packageTouched) {
      await run("sudo", ["/usr/bin/dpkg", "--purge", packageName], {
        allowFailure: true
      });
    }
  }
  for (const pathname of managedFiles) {
    await assertPathAbsent(pathname);
  }
  await assertPathAbsent("/opt/Kirinuki");
}

async function macDiskImageSmoke(
  artifactPath: string,
  target: DesktopBundleTarget
): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "키리누키 DMG smoke "));
  const mountRoot = path.join(temporaryRoot, "mount");
  const installedApp = "/Applications/Kirinuki.app";
  const removedApp = path.join(temporaryRoot, "removed-Kirinuki.app");
  const failureQuarantine = path.join(temporaryRoot, "failed-Kirinuki.app");
  let mounted = false;
  try {
    await assertPathAbsent(installedApp);
    await run("/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mountRoot,
      artifactPath
    ]);
    mounted = true;
    const appRoot = path.join(mountRoot, "Kirinuki.app");
    const infoPlist = await readFile(
      path.join(appRoot, "Contents", "Info.plist"),
      "utf8"
    );
    invariant(
      /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>kirinuki-engine<\/string>/u.test(infoPlist),
      "macOS installer bundle에 Kirinuki custom protocol이 없습니다."
    );
    await run("sudo", ["/usr/bin/ditto", appRoot, installedApp]);
    const installedInfoPlist = await readFile(
      path.join(installedApp, "Contents", "Info.plist"),
      "utf8"
    );
    invariant(
      /<key>CFBundleIdentifier<\/key>\s*<string>kr\.eff0rtchung\.kirinuki<\/string>/u.test(installedInfoPlist)
        && /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>kirinuki-engine<\/string>/u.test(installedInfoPlist),
      "macOS /Applications copy의 bundle/protocol identity readback이 다릅니다."
    );
    await runNativePackageSmoke({
      target,
      paths: {
        packageRoot: "/Applications",
        executable: path.join(installedApp, "Contents", "MacOS", "Kirinuki"),
        resourcesRoot: path.join(installedApp, "Contents", "Resources")
      },
      // A mounted DMG is not an installed /Applications app. Registering its
      // login item would create misleading lifecycle evidence and may require
      // interactive macOS approval, so this smoke remains deliberately isolated.
      autostartMode: "isolated",
      ...(installedBrowserSmoke()
        ? { browserSmoke: runInstalledEngineBrowserSmoke }
        : {}),
      terminateWhileRunning: async ({ executablePath }) => {
        invariant(
          executablePath === path.join(
            installedApp,
            "Contents",
            "MacOS",
            "Kirinuki"
          ),
          "macOS bundle removal smoke executable identity가 바뀌었습니다."
        );
        await run("sudo", ["/bin/mv", installedApp, removedApp]);
      }
    });
    await assertPathAbsent(installedApp);
  } finally {
    try {
      const remaining = await lstat(installedApp);
      invariant(
        remaining.isDirectory() && !remaining.isSymbolicLink(),
        "macOS smoke /Applications path가 owned app directory가 아닙니다."
      );
      const remainingInfo = await readFile(
        path.join(installedApp, "Contents", "Info.plist"),
        "utf8"
      );
      invariant(
        /<key>CFBundleIdentifier<\/key>\s*<string>kr\.eff0rtchung\.kirinuki<\/string>/u.test(remainingInfo),
        "macOS smoke cleanup이 foreign /Applications bundle 제거를 거부했습니다."
      );
      await run("sudo", ["/bin/mv", installedApp, failureQuarantine]);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (mounted) {
      await run("/usr/bin/hdiutil", ["detach", mountRoot, "-force"], {
        allowFailure: true
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  await assertPathAbsent(temporaryRoot);
}

async function windowsNsisSmoke(
  artifactPath: string,
  target: DesktopBundleTarget
): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "키리누키 NSIS smoke "));
  const installRoot = path.join(temporaryRoot, "installed");
  const localApplicationData = (await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)"
  ])).stdout.trim();
  invariant(
    path.isAbsolute(localApplicationData),
    "Windows LocalApplicationData 경로가 절대 경로가 아닙니다."
  );
  const appDataRoot = path.join(localApplicationData, "Kirinuki");
  const junctionPath = path.join(appDataRoot, "uninstall-safety-junction");
  const junctionTarget = path.join(temporaryRoot, "junction-target");
  const junctionSentinel = path.join(junctionTarget, "do-not-delete.txt");
  const sentinelContents = "kirinuki junction target sentinel\n";
  await assertPathAbsent(appDataRoot);
  const programsRoot = (await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)"
  ])).stdout.trim();
  invariant(path.isAbsolute(programsRoot), "Windows user Start Menu 경로가 절대 경로가 아닙니다.");
  const recoveryShortcut = path.join(programsRoot, "Kirinuki.lnk");
  await assertPathAbsent(recoveryShortcut);
  let installed = false;
  let uninstallerPath: string | null = null;
  let appDataFixtureCreated = false;
  let junctionCreated = false;
  try {
    invariant(
      JSON.stringify(await windowsEngineRegistrySnapshot())
        === JSON.stringify({ approval: null, run: null }),
      "Windows installer smoke 시작 전에 Kirinuki startup registry가 이미 있습니다."
    );
    await run(artifactPath, ["/S", `/D=${installRoot}`]);
    installed = true;
    const executable = path.join(installRoot, "Kirinuki.exe");
    await verifyPackagedDesktopTools(
      path.join(installRoot, "resources"),
      target
    );
    const protocolCommand = (await run("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Item -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\kirinuki-engine\\shell\\open\\command' -ErrorAction Stop).GetValue('')"
    ])).stdout.trim();
    invariant(
      protocolCommand.toLowerCase().includes(executable.toLowerCase())
        && /%1/u.test(protocolCommand),
      "Windows installer custom protocol command가 exact installed executable/URL argv에 묶이지 않았습니다."
    );
    const uninstallers = (await readdir(installRoot))
      .filter((entry) => /^Uninstall.*\.exe$/iu.test(entry));
    invariant(uninstallers.length === 1, "NSIS uninstaller identity가 유일하지 않습니다.");
    uninstallerPath = path.join(installRoot, uninstallers[0]!);
    const shortcutMetadata = await lstat(recoveryShortcut);
    invariant(
      shortcutMetadata.isFile()
        && !shortcutMetadata.isSymbolicLink()
        && shortcutMetadata.size > 0,
      "Windows 예외 복구용 Start Menu shortcut이 regular file이 아닙니다."
    );
    const shortcutReadback = await run("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($args[0])",
        "[ordered]@{targetPath=$shortcut.TargetPath;arguments=$shortcut.Arguments;workingDirectory=$shortcut.WorkingDirectory}|ConvertTo-Json -Compress"
      ].join(";"),
      recoveryShortcut
    ]);
    const shortcut = JSON.parse(shortcutReadback.stdout) as {
      targetPath?: unknown;
      arguments?: unknown;
      workingDirectory?: unknown;
    };
    invariant(
      typeof shortcut.targetPath === "string"
        && path.resolve(shortcut.targetPath).toLowerCase()
          === path.resolve(executable).toLowerCase()
        && shortcut.arguments === ""
        && typeof shortcut.workingDirectory === "string"
        && (shortcut.workingDirectory === ""
          || path.resolve(shortcut.workingDirectory).toLowerCase()
            === path.resolve(installRoot).toLowerCase()),
      "Windows Start Menu recovery launcher가 exact windowless engine을 가리키지 않습니다."
    );
    await mkdir(junctionTarget, { mode: 0o700 });
    await writeFile(junctionSentinel, sentinelContents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await mkdir(appDataRoot, { mode: 0o700 });
    appDataFixtureCreated = true;
    await run("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "New-Item -ItemType Junction -Path $args[0] -Target $args[1] -ErrorAction Stop | Out-Null",
      junctionPath,
      junctionTarget
    ]);
    const junctionMetadata = await lstat(junctionPath);
    invariant(
      junctionMetadata.isSymbolicLink(),
      "Windows uninstall safety fixture가 junction으로 생성되지 않았습니다."
    );
    junctionCreated = true;
    await runNativePackageSmoke({
      target,
      paths: {
        packageRoot: installRoot,
        executable,
        resourcesRoot: path.join(installRoot, "resources")
      },
      autostartMode: "production",
      ...(installedBrowserSmoke()
        ? { browserSmoke: runInstalledEngineBrowserSmoke }
        : {}),
      terminateWhileRunning: async ({ environment, executablePath }) => {
        invariant(
          executablePath.toLowerCase() === executable.toLowerCase(),
          "Windows running-uninstall executable identity가 바뀌었습니다."
        );
        await run(uninstallerPath!, ["/S"], {
          env: { ...environment }
        });
        installed = false;
      }
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        await assertPathAbsent(installRoot);
        await assertPathAbsent(recoveryShortcut);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await assertPathAbsent(installRoot);
    await assertPathAbsent(recoveryShortcut);
    invariant(
      JSON.stringify(await windowsEngineRegistrySnapshot())
        === JSON.stringify({ approval: null, run: null }),
      "Windows uninstaller가 owned Run/StartupApproved 값을 제거하지 못했습니다."
    );
    const retainedJunction = await lstat(junctionPath);
    invariant(
      retainedJunction.isSymbolicLink(),
      "Windows uninstaller가 app-data junction을 변경하거나 제거했습니다."
    );
    invariant(
      await readFile(junctionSentinel, "utf8") === sentinelContents,
      "Windows uninstaller가 junction target sentinel을 변경하거나 삭제했습니다."
    );
  } finally {
    if (installed && uninstallerPath) {
      await run(uninstallerPath, ["/S"], { allowFailure: true });
    }
    if (junctionCreated) {
      await removeWindowsTestJunction(junctionPath);
    }
    if (appDataFixtureCreated) {
      await rmdir(appDataRoot);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  await assertPathAbsent(temporaryRoot);
  await assertPathAbsent(recoveryShortcut);
}

export async function runDesktopInstallerSmoke(): Promise<void> {
  const target = currentTarget();
  const contract = desktopInstallerTarget(target);
  const channelValue = process.env.KIRINUKI_INSTALLER_CHANNEL;
  const channel: DesktopInstallerChannel = channelValue === undefined
    ? "ci-test-only"
    : channelValue as DesktopInstallerChannel;
  invariant(
    channel === "ci-test-only" || channel === "public-release",
    "installer smoke channel이 올바르지 않습니다."
  );
  const outputDirectory = path.join(root, "dist", "installers", target);
  const artifactFileName = desktopInstallerArtifactFileName(target, channel);
  const manifestFileName = desktopInstallerManifestFileName(target, channel);
  const artifactPath = path.join(outputDirectory, artifactFileName);
  const manifestPath = path.join(outputDirectory, manifestFileName);
  const entries = (await readdir(outputDirectory, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
  const expectedEntries = [
    artifactFileName,
    manifestFileName,
    ...(channel === "public-release" && contract.detachedSignatureFileName
      ? [contract.detachedSignatureFileName]
      : [])
  ].sort();
  invariant(
    JSON.stringify(entries) === JSON.stringify(expectedEntries),
    "installer 출력 tree가 exact contract와 다릅니다."
  );
  const [artifact, manifest] = await Promise.all([
    sha256RegularFile(artifactPath),
    readFile(manifestPath, "utf8").then((value) => JSON.parse(value) as Record<string, unknown>)
  ]);
  const manifestArtifact = manifest.artifact as Record<string, unknown> | undefined;
  const signing = manifest.releaseSigning as Record<string, unknown> | undefined;
  const updater = manifest.updater as Record<string, unknown> | undefined;
  const expectedPublic = channel === "public-release";
  invariant(
    manifest.schema === DESKTOP_INSTALLER_MANIFEST_SCHEMA
      && manifest.status === (expectedPublic
        ? "release-verified"
        : "unsigned-test-only")
      && manifest.channel === channel
      && manifest.target === target
      && manifest.platform === contract.platform
      && manifest.arch === contract.arch
      && manifest.format === contract.format
      && manifestArtifact?.fileName === artifactFileName
      && manifestArtifact.bytes === artifact.bytes
      && manifestArtifact.sha256 === artifact.sha256
      && signing?.allowed === expectedPublic
      && signing.signed === expectedPublic
      && signing.status === (expectedPublic
        ? "verified-public-release"
        : "unsigned-ci-test-only-never-publish")
      && updater?.bundled === false
      && updater.telemetry === false
      && updater.publicNetworkPolling === false
      && updater.unsignedUpdatesAllowed === false
      && updater.compatibilityPolicy
        === "kirinuki-local-media-engine/v1-additive-compatibility"
      && updater.apiProtocol === "kirinuki-local-media-engine/v1"
      && updater.replacement === "signed-stable-path-installer-only",
    "installer manifest가 artifact·channel·signing·no-updater contract와 다릅니다."
  );
  if (process.env[SYSTEM_SMOKE_ENV] === "1") {
    if (target === "linux-x64") {
      await linuxSystemInstallSmoke(artifactPath, target);
    } else if (target === "darwin-arm64") {
      await macDiskImageSmoke(artifactPath, target);
    } else if (target === "win32-x64") {
      await windowsNsisSmoke(artifactPath, target);
    }
  }
  console.log(JSON.stringify({
    schema: "kirinuki-desktop-installer-smoke/v1",
    status: "ok",
    target,
    channel,
    artifact: artifactFileName,
    systemSmokeScope: process.env[SYSTEM_SMOKE_ENV] !== "1"
      ? "artifact-and-manifest-only"
      : target === "win32-x64"
        ? "silent-install-production-hkcu-run-readback-headless-probe-start-menu-owned-registry-uninstall-and-junction-non-traversal"
        : target === "darwin-arm64"
          ? "read-only-dmg-mount-run-in-place-and-detach"
          : "dpkg-install-production-xdg-autostart-readback-removal-headless-probe-remove-purge-and-package-owned-paths"
  }, null, 2));
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: desktop-installer-smoke.ts");
  }
  await runDesktopInstallerSmoke();
}
