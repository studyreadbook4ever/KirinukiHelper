import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  WINDOWS_JOB_LAUNCHER_CONTRACT,
  WINDOWS_JOB_LAUNCHER_FILE_NAME,
  WINDOWS_JOB_LAUNCHER_LINK_FLAGS,
  WINDOWS_JOB_LAUNCHER_MSVC_FLAGS,
  WINDOWS_JOB_LAUNCHER_SCHEMA,
  WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT,
  WINDOWS_JOB_LAUNCHER_SOURCE_PATH,
  createWindowsJobObjectSpawn,
  parseWindowsJobLauncherManifest,
  windowsJobObjectLauncherInvocation
} from "../src/desktop/windows-job-object.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Windows Job launcher invocation은 exact absolute child와 실제 parent PID만 전달한다", () => {
  assert.deepEqual(
    windowsJobObjectLauncherInvocation(
      "C:\\Program Files\\Kirinuki\\kirinuki-job-launcher.exe",
      "C:\\Program Files\\Kirinuki\\ffmpeg.exe",
      ["-i", "value with spaces", "quote\"inside", "trailing\\"],
      7331
    ),
    {
      command: "C:\\Program Files\\Kirinuki\\kirinuki-job-launcher.exe",
      args: [
        "--parent-pid",
        "7331",
        "--",
        "C:\\Program Files\\Kirinuki\\ffmpeg.exe",
        "-i",
        "value with spaces",
        "quote\"inside",
        "trailing\\"
      ]
    }
  );
  assert.throws(
    () => windowsJobObjectLauncherInvocation(
      "launcher.exe",
      "C:\\ffmpeg.exe",
      [],
      1
    ),
    /Windows 절대 경로/u
  );
  assert.throws(
    () => windowsJobObjectLauncherInvocation(
      "C:\\launcher.exe",
      "ffmpeg.exe",
      [],
      1
    ),
    /Windows 절대 경로/u
  );
  assert.throws(
    () => windowsJobObjectLauncherInvocation(
      "C:\\launcher.exe",
      "C:\\ffmpeg.exe",
      [],
      0
    ),
    /parent PID/u
  );
});

test("spawn adapter는 stdio/fd3/cwd/env를 그대로 두고 shell을 열지 않는다", () => {
  let captured: Readonly<{
    command: string;
    args: readonly string[];
    options: unknown;
  }> | undefined;
  const marker = { pid: 100 };
  const fakeSpawn = ((
    command: string,
    args: readonly string[],
    options: unknown
  ) => {
    captured = { command, args, options };
    return marker;
  }) as unknown as typeof spawn;
  const wrapped = createWindowsJobObjectSpawn({
    launcherPath: "C:\\Kirinuki\\kirinuki-job-launcher.exe",
    parentProcessId: 99,
    spawnImpl: fakeSpawn
  });
  const options: SpawnOptions = {
    cwd: "C:\\Kirinuki\\jobs\\one",
    env: { TEMP: "C:\\Kirinuki\\jobs\\one" },
    shell: false as const,
    stdio: ["ignore", "pipe", "pipe", 17],
    windowsHide: true
  };
  const result = wrapped(
    "C:\\Kirinuki\\tools\\ffprobe.exe",
    ["-i", "pipe:3"],
    options
  );
  assert.equal(result, marker);
  assert.equal(captured?.command, "C:\\Kirinuki\\kirinuki-job-launcher.exe");
  assert.deepEqual(captured?.args, [
    "--parent-pid",
    "99",
    "--",
    "C:\\Kirinuki\\tools\\ffprobe.exe",
    "-i",
    "pipe:3"
  ]);
  assert.deepEqual(captured?.options, {
    ...options,
    shell: false,
    windowsVerbatimArguments: false
  });
  assert.throws(
    () => wrapped(
      "C:\\Kirinuki\\tools\\ffmpeg.exe",
      [],
      { ...options, shell: true }
    ),
    /shell 없는 spawn/u
  );
});

test("launcher manifest는 source/build/binary/security allowlist가 exact해야 한다", () => {
  const valid = {
    schema: WINDOWS_JOB_LAUNCHER_SCHEMA,
    target: "win32-x64",
    fileName: WINDOWS_JOB_LAUNCHER_FILE_NAME,
    contract: WINDOWS_JOB_LAUNCHER_CONTRACT,
    source: {
      path: WINDOWS_JOB_LAUNCHER_SOURCE_PATH,
      sha256: "a".repeat(64)
    },
    build: {
      compiler: "msvc-x64",
      toolsetVersion: "14.44.35207",
      compilerSha256: "c".repeat(64),
      linkerSha256: "d".repeat(64),
      flags: WINDOWS_JOB_LAUNCHER_MSVC_FLAGS,
      linkFlags: WINDOWS_JOB_LAUNCHER_LINK_FLAGS
    },
    artifact: {
      bytes: 32_768,
      sha256: "b".repeat(64)
    },
    securityContract: WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT
  };
  assert.deepEqual(parseWindowsJobLauncherManifest(valid), valid);
  assert.throws(
    () => parseWindowsJobLauncherManifest({
      ...valid,
      securityContract: ["kill-leader-only"]
    }),
    /exact contract/u
  );
  assert.throws(
    () => parseWindowsJobLauncherManifest({ ...valid, unexpected: true }),
    /exact contract/u
  );
});

test("native source는 suspended→assign→resume 순서와 parent/job/exit 불변식을 가진다", async () => {
  const source = await readFile(path.join(root, WINDOWS_JOB_LAUNCHER_SOURCE_PATH), "utf8");
  const create = source.indexOf("CreateProcessW(");
  const assign = source.indexOf("AssignProcessToJobObject(job, child.hProcess)");
  const resume = source.indexOf("ResumeThread(child.hThread)");
  assert.ok(create >= 0 && assign > create && resume > assign);
  assert.match(source, /CREATE_SUSPENDED/u);
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/u);
  assert.match(source, /actual_parent_process_id/u);
  assert.match(source, /OpenProcess\([\s\S]*SYNCHRONIZE/u);
  assert.match(source, /WaitForMultipleObjects\(2U, wait_handles/u);
  assert.match(source, /cbReserved2 = inherited_startup\.cbReserved2/u);
  assert.match(source, /lpReserved2 = inherited_startup\.lpReserved2/u);
  assert.match(source, /PROC_THREAD_ATTRIBUTE_HANDLE_LIST/u);
  assert.match(source, /EXTENDED_STARTUPINFO_PRESENT/u);
  assert.match(source, /if \(index > 3\)/u);
  assert.match(source, /ExitProcess\(child_exit_code\)/u);
  assert.doesNotMatch(source, /CREATE_BREAKAWAY_FROM_JOB/u);
});

test("package/signing/provenance와 windows-2025 native orphan smoke가 launcher를 누락하지 않는다", async () => {
  const [
    packager,
    installer,
    installerSmoke,
    runtime,
    quality,
    release,
    smoke,
    launcherPreparation
  ] = await Promise.all([
    readFile(path.join(root, "scripts/package-desktop.ts"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop-installer.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-installer-smoke.ts"), "utf8"),
    readFile(path.join(root, "src/desktop/runtime-supervisor.ts"), "utf8"),
    readFile(path.join(root, ".github/workflows/typescript-quality.yml"), "utf8"),
    readFile(path.join(root, ".github/workflows/desktop-installer-release.yml"), "utf8"),
    readFile(path.join(root, "scripts/windows-job-launcher-smoke.ts"), "utf8"),
    readFile(path.join(root, "scripts/prepare-windows-job-launcher.ts"), "utf8")
  ]);
  assert.match(packager, /prepareWindowsJobLauncher/u);
  assert.match(packager, /desktop-native/u);
  assert.match(packager, /verifyPackagedWindowsJobLauncher/u);
  assert.match(installer, /packagedWindowsJobLauncherFile/u);
  assert.match(installer, /windowsSignatureReadback/u);
  assert.match(installer, /refreshPackagedWindowsJobLauncherManifest/u);
  assert.match(installer, /windowsJobLauncher: windowsJobLauncher\?\.manifest/u);
  const signingFunction = installer.slice(
    installer.indexOf("async function signWindowsPrepackaged"),
    installer.indexOf("function macCodesignOutputHasIdentity")
  );
  assert.ok(
    signingFunction.indexOf("windowsSignatureReadback")
      < signingFunction.indexOf("refreshPackagedWindowsJobLauncherManifest")
  );
  assert.ok(
    signingFunction.indexOf("refreshPackagedWindowsJobLauncherManifest")
      < signingFunction.indexOf("verifyPackagedWindowsJobLauncher")
  );
  assert.doesNotMatch(signingFunction, /packagedToolFiles/u);
  assert.match(signingFunction, /packagedWindowsJobLauncherFile/u);
  const installerBuild = installer.slice(
    installer.indexOf("export async function packageDesktopInstaller")
  );
  assert.ok(
    installerBuild.indexOf("signWindowsPrepackaged")
      < installerBuild.indexOf("const windowsJobLauncher")
  );
  assert.ok(
    installerBuild.indexOf("const windowsJobLauncher")
      < installerBuild.indexOf("windowsJobLauncher: windowsJobLauncher?.manifest")
  );
  assert.match(
    installerBuild,
    /electron-builder[\s\S]*verifyPackagedDesktopTools\(resourcesRoot, target\)/u
  );
  assert.match(
    installerSmoke,
    /installed = true;[\s\S]*verifyPackagedDesktopTools\([\s\S]*path\.join\(installRoot, "resources"\)[\s\S]*target/u
  );
  assert.match(runtime, /createWindowsJobObjectSpawn/u);
  assert.match(runtime, /runMaterializerProcess[\s\S]*spawnImpl: windowsSpawn/u);
  assert.match(runtime, /runExternalProcess[\s\S]*spawnImpl: windowsSpawn/u);
  assert.match(quality, /runs-on: \$\{\{ matrix\.runner \}\}/u);
  assert.match(quality, /runner: windows-2025/u);
  assert.match(quality, /npm run test:windows:job-launcher/u);
  assert.match(release, /npm run test:windows:job-launcher/u);
  assert.match(smoke, /parent 종료 뒤 Job Object descendant가 orphan으로 남았습니다/u);
  assert.match(smoke, /exactExitResult\.code === 37/u);
  assert.match(smoke, /handle-bound-fd3/u);
  assert.match(smoke, /unexpectedDescriptorResult\.code === 249/u);
  assert.match(smoke, /rootExitResult\.code === 19/u);
  assert.match(smoke, /launcher crash 뒤 Job Object descendant가 orphan으로 남았습니다/u);
  const vcvarsStart = launcherPreparation.indexOf(
    "const initialized = spawnSync(commandProcessor"
  );
  const vcvarsEnd = launcherPreparation.indexOf(
    "const environment: NodeJS.ProcessEnv",
    vcvarsStart
  );
  assert.ok(vcvarsStart >= 0 && vcvarsEnd > vcvarsStart);
  const vcvarsInvocation = launcherPreparation.slice(vcvarsStart, vcvarsEnd);
  const vcvarsPathValidationStart = launcherPreparation.indexOf(
    "const vcvars = safeWindowsSystemFile"
  );
  const vcvarsIdentityCheck = launcherPreparation.indexOf(
    "await regularFileIdentity(vcvars);",
    vcvarsPathValidationStart
  );
  assert.ok(
    vcvarsPathValidationStart >= 0
      && vcvarsIdentityCheck > vcvarsPathValidationStart
  );
  const vcvarsPathValidation = launcherPreparation.slice(
    vcvarsPathValidationStart,
    vcvarsIdentityCheck
  );
  assert.match(vcvarsPathValidation, /!vcvars\.includes\("%"\)/u);
  assert.match(
    launcherPreparation,
    /const WINDOWS_VCVARS_ENVIRONMENT_STDIN = \[\s*"@echo off",\s*`call "%\$\{WINDOWS_VCVARS_ENVIRONMENT_KEY\}%" >nul`,\s*"if errorlevel 1 exit \/b %errorlevel%",\s*"set",\s*"exit",\s*""\s*\]\.join\("\\r\\n"\)/u
  );
  assert.match(
    vcvarsInvocation,
    /spawnSync\(commandProcessor, \["\/d", "\/q", "\/v:off"\]/u
  );
  assert.match(vcvarsInvocation, /env:\s*vcvarsEnvironment/u);
  assert.match(vcvarsInvocation, /input:\s*WINDOWS_VCVARS_ENVIRONMENT_STDIN/u);
  assert.match(vcvarsInvocation, /shell:\s*false/u);
  assert.match(vcvarsInvocation, /maxBuffer:\s*MAX_COMMAND_OUTPUT_BYTES/u);
  assert.match(vcvarsInvocation, /timeout:\s*COMMAND_TIMEOUT_MS/u);
  assert.match(vcvarsInvocation, /initialized\.error/u);
  assert.match(vcvarsInvocation, /initialized\.status === 0/u);
  assert.match(vcvarsInvocation, /initialized\.signal === null/u);
  assert.doesNotMatch(vcvarsInvocation, /["']\/c["']/u);
  assert.doesNotMatch(vcvarsInvocation, /windowsVerbatimArguments/u);
  assert.doesNotMatch(
    launcherPreparation,
    /call[^\r\n]*\$\{vcvars\}/u
  );
  assert.match(
    launcherPreparation,
    /vcvarsEnvironment\[WINDOWS_VCVARS_ENVIRONMENT_KEY\] = vcvars/u
  );
});
