import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_INSTALLER_MANIFEST_SCHEMA,
  desktopInstallerArtifactFileName,
  desktopInstallerBuilderArtifactFileName,
  desktopInstallerManifestFileName,
  desktopInstallerTarget
} from "../src/desktop/installer-contract.js";
import {
  resolveDesktopInstallerBuildRequest
} from "../src/desktop/installer-release-contract.js";
import type {
  DesktopInstallerBuildRequest
} from "../src/desktop/installer-release-contract.js";
import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";
import { desktopToolTargetManifest } from "../src/desktop/tool-manifest.js";
import {
  verifyPackagedWindowsJobLauncher,
  windowsJobLauncherResourcePaths
} from "../src/desktop/windows-job-object.js";
import {
  createMacosSealedToolManifest,
  verifyMacosSealedDesktopTools,
  writeMacosSealedToolManifest
} from "../src/desktop/macos-sealed-tools.js";
import type {
  MacosSealedToolVerification
} from "../src/desktop/macos-sealed-tools.js";
import {
  LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY
} from "../src/lib/local-media-engine-contract.js";
import {
  packageDesktopApplication,
  verifyPackagedDesktopTools
} from "./package-desktop.js";
import {
  verifyDesktopReleaseProvenance
} from "./verify-desktop-release-provenance.js";
import type {
  VerifiedDesktopReleaseProvenance
} from "./verify-desktop-release-provenance.js";
import {
  refreshPackagedWindowsJobLauncherManifest
} from "./prepare-windows-job-launcher.js";
import {
  windowsPowerShellEnvironment,
  windowsPowerShellExecutable
} from "./windows-powershell-environment.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const BUILDER_TIMEOUT_MS = 30 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
const NOTARIZATION_TIMEOUT_MS = 30 * 60 * 1_000;

function currentTarget(): DesktopBundleTarget {
  return `${process.platform}-${process.arch}` as DesktopBundleTarget;
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: true
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("electron-builder 실행 시간이 제한을 넘었습니다."));
    }, BUILDER_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new Error(
          `electron-builder가 실패했습니다: code=${code ?? "null"}, signal=${signal ?? "none"}`
        ));
      }
    });
  });
}

async function runCaptured(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  { timeoutMs = COMMAND_TIMEOUT_MS }: {
    readonly timeoutMs?: number;
  } = {}
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const result = await execFileAsync(command, [...args], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true
  });
  return Object.freeze({ stdout: result.stdout, stderr: result.stderr });
}

function runWithSecretInput(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  secretInput: string
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer): string => (
      (current + chunk.toString("utf8")).slice(-1024 * 1024)
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`release signing command timeout: ${path.basename(command)}`));
    }, COMMAND_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal !== null) {
        reject(new Error(
          `release signing command failed: ${path.basename(command)} code=${code ?? "null"} signal=${signal ?? "none"}\n${stderr}`
        ));
        return;
      }
      resolve(Object.freeze({ stdout, stderr }));
    });
    child.stdin.end(`${secretInput}\n`, "utf8");
  });
}

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`release signing 환경이 빠졌습니다: ${key}`);
  }
  return value;
}

async function assertExactRegularFile(filePath: string, label: string): Promise<void> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${label} 경로가 절대 경로가 아닙니다.`);
  }
  const [metadata, canonical] = await Promise.all([
    lstat(filePath),
    realpath(filePath)
  ]);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || (process.platform === "win32"
      ? path.resolve(canonical).toLowerCase() !== path.resolve(filePath).toLowerCase()
      : path.resolve(canonical) !== path.resolve(filePath))
  ) {
    throw new Error(`${label}가 symlink 없는 exact regular file이 아닙니다.`);
  }
}

async function assertReleaseSourceIdentity(
  request: DesktopInstallerBuildRequest
): Promise<void> {
  if (!request.release) {
    return;
  }
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1"
  };
  const [head, tagged, status] = await Promise.all([
    runCaptured("git", ["rev-parse", "HEAD"], env),
    runCaptured("git", ["rev-list", "-n", "1", request.release.tag], env),
    runCaptured("git", ["status", "--porcelain=v1", "--untracked-files=no"], env)
  ]);
  if (
    head.stdout.trim() !== request.release.commit
    || tagged.stdout.trim() !== request.release.commit
  ) {
    throw new Error("public-release tag, HEAD, declared commit identity가 다릅니다.");
  }
  if (status.stdout.length !== 0) {
    throw new Error("public-release는 tracked working tree가 깨끗해야 합니다.");
  }
}

async function verifyMacBackgroundAgentMetadata(packageRoot: string): Promise<void> {
  const infoPlist = path.join(
    packageRoot,
    "Kirinuki.app",
    "Contents",
    "Info.plist"
  );
  await assertExactRegularFile(infoPlist, "macOS packaged Info.plist");
  const result = await runCaptured("/usr/bin/plutil", [
    "-extract",
    "LSUIElement",
    "raw",
    "-o",
    "-",
    infoPlist
  ], process.env);
  if (result.stdout.trim() !== "true") {
    throw new Error("macOS packaged app이 LSUIElement background agent가 아닙니다.");
  }
}

async function sha256RegularFile(filePath: string): Promise<Readonly<{
  bytes: number;
  sha256: string;
}>> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || !Number.isSafeInteger(metadata.size)
    || metadata.size < 100_000
  ) {
    throw new Error(`installer artifact가 유효한 regular file이 아닙니다: ${filePath}`);
  }
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
      if (bytesRead <= 0) {
        throw new Error("installer artifact를 끝까지 읽지 못했습니다.");
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error("검증 중 installer artifact가 바뀌었습니다.");
    }
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

async function packageVersion(filePath: string): Promise<string> {
  const value = JSON.parse(await readFile(filePath, "utf8")) as {
    version?: unknown;
  };
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(value.version)) {
    throw new Error(`package version이 올바르지 않습니다: ${filePath}`);
  }
  return value.version;
}

interface ReleaseSigningEvidence {
  readonly method: string;
  readonly signingIdentity: string;
  readonly timestamped: boolean;
  readonly verification: readonly string[];
  readonly notarizationRequestId?: string;
  readonly detachedSignatureFileName?: string;
}

function packagedToolFiles(
  packageRoot: string,
  target: DesktopBundleTarget
): readonly string[] {
  const manifest = desktopToolTargetManifest(target);
  const resourcesRoot = target === "darwin-arm64"
    ? path.join(packageRoot, "Kirinuki.app", "Contents", "Resources")
    : path.join(packageRoot, "resources");
  const toolsRoot = path.join(resourcesRoot, "desktop-tools", target);
  return Object.freeze([
    path.join(toolsRoot, manifest.ffmpeg.fileName),
    path.join(toolsRoot, manifest.ffprobe.fileName),
    path.join(toolsRoot, manifest.ytDlp.fileName)
  ]);
}

function packagedWindowsJobLauncherFile(packageRoot: string): string {
  return windowsJobLauncherResourcePaths(
    path.join(packageRoot, "resources"),
    "win32-x64"
  ).executable;
}

interface WindowsSignatureReadback {
  readonly status: string;
  readonly signerCertificateSha1: string;
  readonly signerSubject: string;
  readonly timestampCertificateSha1: string;
}

const WINDOWS_AUTHENTICODE_PATH_ENV =
  "KIRINUKI_WINDOWS_AUTHENTICODE_PATH";
const WINDOWS_CERTIFICATE_THUMBPRINT_ENV =
  "KIRINUKI_WINDOWS_CERTIFICATE_THUMBPRINT";
const WINDOWS_SECURITY_MODULE_IMPORT = [
  "$securityModule=$PSHOME+'\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
  "Import-Module -Name $securityModule -Force -ErrorAction Stop"
].join(";");

async function windowsSignatureReadback(
  filePath: string,
  expectedThumbprint: string,
  expectedSubject: string,
  signTool: string
): Promise<Readonly<WindowsSignatureReadback>> {
  await runCaptured(signTool, ["verify", "/pa", "/all", "/v", filePath], process.env);
  const script = [
    WINDOWS_SECURITY_MODULE_IMPORT,
    `$path=[Environment]::GetEnvironmentVariable('${WINDOWS_AUTHENTICODE_PATH_ENV}','Process')`,
    "if([string]::IsNullOrWhiteSpace($path)){throw 'missing Authenticode path'}",
    "$signature=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $path",
    "$result=[ordered]@{",
    "status=$signature.Status.ToString()",
    "signerCertificateSha1=if($signature.SignerCertificate){$signature.SignerCertificate.Thumbprint}else{''}",
    "signerSubject=if($signature.SignerCertificate){$signature.SignerCertificate.Subject}else{''}",
    "timestampCertificateSha1=if($signature.TimeStamperCertificate){$signature.TimeStamperCertificate.Thumbprint}else{''}",
    "}",
    "$result|ConvertTo-Json -Compress"
  ].join(";");
  const result = await runCaptured(windowsPowerShellExecutable(process.env), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], windowsPowerShellEnvironment(process.env, {
    [WINDOWS_AUTHENTICODE_PATH_ENV]: filePath
  }));
  const payload = JSON.parse(result.stdout) as Partial<WindowsSignatureReadback>;
  if (
    payload.status !== "Valid"
    || payload.signerCertificateSha1?.toUpperCase() !== expectedThumbprint
    || payload.signerSubject !== expectedSubject
    || !/^[0-9A-F]{40}$/u.test(
      String(payload.timestampCertificateSha1 || "").toUpperCase()
    )
  ) {
    throw new Error(`Windows Authenticode readback이 exact release contract와 다릅니다: ${path.basename(filePath)}`);
  }
  return Object.freeze({
    status: payload.status,
    signerCertificateSha1: payload.signerCertificateSha1.toUpperCase(),
    signerSubject: payload.signerSubject,
    timestampCertificateSha1: String(payload.timestampCertificateSha1).toUpperCase()
  });
}

async function signWindowsPrepackaged(
  packageRoot: string,
  executable: string,
  request: DesktopInstallerBuildRequest
): Promise<Readonly<ReleaseSigningEvidence>> {
  const release = request.release;
  if (!release) {
    throw new Error("Windows release signing request가 없습니다.");
  }
  const signTool = requiredEnvironment("KIRINUKI_WINDOWS_SIGNTOOL");
  const expectedSubject = requiredEnvironment("KIRINUKI_WINDOWS_PUBLISHER_SUBJECT");
  const thumbprint = release.signingIdentity.toUpperCase();
  await assertExactRegularFile(signTool, "Windows signtool");
  const certificate = await runCaptured(windowsPowerShellExecutable(process.env), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `${WINDOWS_SECURITY_MODULE_IMPORT};$thumbprint=[Environment]::GetEnvironmentVariable('${WINDOWS_CERTIFICATE_THUMBPRINT_ENV}','Process');if([string]::IsNullOrWhiteSpace($thumbprint)){throw 'missing certificate thumbprint'};$certificate=Get-Item -LiteralPath ('Cert:\\CurrentUser\\My\\'+$thumbprint);if(-not $certificate.HasPrivateKey){throw 'certificate has no private key'};[ordered]@{thumbprint=$certificate.Thumbprint;subject=$certificate.Subject}|ConvertTo-Json -Compress`
  ], windowsPowerShellEnvironment(process.env, {
    [WINDOWS_CERTIFICATE_THUMBPRINT_ENV]: thumbprint
  }));
  const certificatePayload = JSON.parse(certificate.stdout) as {
    thumbprint?: unknown;
    subject?: unknown;
  };
  if (
    String(certificatePayload.thumbprint || "").toUpperCase() !== thumbprint
    || certificatePayload.subject !== expectedSubject
  ) {
    throw new Error("Windows certificate store identity가 release contract와 다릅니다.");
  }
  const files = [
    executable,
    packagedWindowsJobLauncherFile(packageRoot)
  ];
  for (const filePath of files) {
    await assertExactRegularFile(filePath, "Windows release executable");
    await runCaptured(signTool, [
      "sign",
      "/fd",
      "SHA256",
      "/td",
      "SHA256",
      "/tr",
      "https://timestamp.digicert.com",
      "/sha1",
      thumbprint,
      filePath
    ], process.env);
    await windowsSignatureReadback(filePath, thumbprint, expectedSubject, signTool);
  }
  const resourcesRoot = path.join(packageRoot, "resources");
  await refreshPackagedWindowsJobLauncherManifest(resourcesRoot);
  await verifyPackagedWindowsJobLauncher(resourcesRoot, "win32-x64");
  return Object.freeze({
    method: "authenticode-rfc3161-sha256",
    signingIdentity: thumbprint,
    timestamped: true,
    verification: Object.freeze(files.map((filePath) => path.relative(packageRoot, filePath)))
  });
}

function macCodesignOutputHasIdentity(
  output: string,
  identity: string,
  teamId: string,
  requireHardenedRuntime: boolean
): boolean {
  const lines = output.split(/\r?\n/u);
  return lines.includes(`Authority=${identity}`)
    && lines.includes(`TeamIdentifier=${teamId}`)
    && lines.some((line) => line.startsWith("Timestamp="))
    && (!requireHardenedRuntime || lines.some((line) => (
      line.startsWith("CodeDirectory ") && /flags=.*\(runtime\)/u.test(line)
    )));
}

async function verifyMacCodeSignature(
  filePath: string,
  identity: string,
  teamId: string,
  requireHardenedRuntime: boolean
): Promise<void> {
  await runCaptured("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=4",
    filePath
  ], process.env);
  const display = await runCaptured("/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    filePath
  ], process.env);
  const output = `${display.stdout}\n${display.stderr}`;
  if (!macCodesignOutputHasIdentity(
    output,
    identity,
    teamId,
    requireHardenedRuntime
  )) {
    throw new Error(`macOS codesign readback이 exact release contract와 다릅니다: ${path.basename(filePath)}`);
  }
}

async function signMacPrepackaged(
  packageRoot: string,
  request: DesktopInstallerBuildRequest
): Promise<Readonly<{
  signingEvidence: Readonly<ReleaseSigningEvidence>;
  sealedTools: Readonly<MacosSealedToolVerification>;
}>> {
  const release = request.release;
  if (!release) {
    throw new Error("macOS release signing request가 없습니다.");
  }
  const appPath = path.join(packageRoot, "Kirinuki.app");
  const identity = release.signingIdentity;
  const teamId = requiredEnvironment("APPLE_TEAM_ID");
  const keychain = requiredEnvironment("CSC_KEYCHAIN");
  const binaries = [...packagedToolFiles(packageRoot, "darwin-arm64")];
  for (const binary of binaries) {
    await assertExactRegularFile(binary, "macOS release executable");
    await runCaptured("/usr/bin/codesign", [
      "--sign",
      identity,
      "--force",
      "--timestamp",
      "--options",
      "runtime",
      "--keychain",
      keychain,
      binary
    ], process.env);
    await verifyMacCodeSignature(binary, identity, teamId, true);
  }
  const resourcesRoot = path.join(
    appPath,
    "Contents",
    "Resources"
  );
  const sealedManifest = await createMacosSealedToolManifest({
    resourcesRoot,
    authority: identity,
    teamIdentifier: teamId
  });
  const sealedManifestPath = await writeMacosSealedToolManifest(
    resourcesRoot,
    sealedManifest
  );
  const ignoredBinaries = new Set(binaries.map((filePath) => path.resolve(filePath)));
  const { sign } = await import("@electron/osx-sign");
  await sign({
    app: appPath,
    platform: "darwin",
    type: "distribution",
    identity,
    keychain,
    version: "43.4.1",
    ignore: (filePath) => ignoredBinaries.has(path.resolve(filePath)),
    strictVerify: true,
    preAutoEntitlements: true
  });
  await verifyMacCodeSignature(appPath, identity, teamId, true);
  const sealedTools = await verifyMacosSealedDesktopTools({ resourcesRoot });
  return Object.freeze({
    signingEvidence: Object.freeze({
      method: "developer-id-application-hardened-runtime",
      signingIdentity: identity,
      timestamped: true,
      verification: Object.freeze([
        "Kirinuki.app",
        ...binaries.map((filePath) => path.relative(packageRoot, filePath)),
        `${path.relative(packageRoot, sealedManifestPath)}:outer-app-sealed`
      ])
    }),
    sealedTools
  });
}

async function notarizeAndVerifyMacDmg(
  artifactPath: string,
  request: DesktopInstallerBuildRequest,
  prepackagedEvidence: Readonly<ReleaseSigningEvidence>
): Promise<Readonly<ReleaseSigningEvidence>> {
  const release = request.release;
  if (!release) {
    throw new Error("macOS notarization request가 없습니다.");
  }
  const apiKey = requiredEnvironment("APPLE_API_KEY");
  const apiKeyId = requiredEnvironment("APPLE_API_KEY_ID");
  const issuer = requiredEnvironment("APPLE_API_ISSUER");
  const teamId = requiredEnvironment("APPLE_TEAM_ID");
  await assertExactRegularFile(apiKey, "Apple notarization API key");
  await verifyMacCodeSignature(
    artifactPath,
    release.signingIdentity,
    teamId,
    false
  );
  const submitted = await runCaptured("/usr/bin/xcrun", [
    "notarytool",
    "submit",
    artifactPath,
    "--key",
    apiKey,
    "--key-id",
    apiKeyId,
    "--issuer",
    issuer,
    "--wait",
    "--output-format",
    "json"
  ], process.env, { timeoutMs: NOTARIZATION_TIMEOUT_MS });
  const payload = JSON.parse(submitted.stdout) as {
    id?: unknown;
    status?: unknown;
  };
  if (
    payload.status !== "Accepted"
    || typeof payload.id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(payload.id)
  ) {
    throw new Error("Apple notarytool readback이 Accepted exact contract와 다릅니다.");
  }
  await runCaptured("/usr/bin/xcrun", ["stapler", "staple", "-v", artifactPath], process.env);
  await runCaptured("/usr/bin/xcrun", ["stapler", "validate", "-v", artifactPath], process.env);
  await runCaptured("/usr/sbin/spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=4",
    artifactPath
  ], process.env);
  return Object.freeze({
    ...prepackagedEvidence,
    method: "developer-id-hardened-runtime-notarized-stapled-dmg",
    notarizationRequestId: payload.id,
    verification: Object.freeze([
      ...prepackagedEvidence.verification,
      "codesign-dmg",
      "notarytool-accepted",
      "stapler-validated",
      "gatekeeper-assessed"
    ])
  });
}

async function signAndVerifyLinuxArtifact(
  artifactPath: string,
  signaturePath: string,
  request: DesktopInstallerBuildRequest
): Promise<Readonly<ReleaseSigningEvidence>> {
  const release = request.release;
  if (!release) {
    throw new Error("Linux release signing request가 없습니다.");
  }
  const fingerprint = release.signingIdentity.toUpperCase();
  const passphrase = requiredEnvironment("KIRINUKI_LINUX_SIGNING_PASSPHRASE");
  const keys = await runCaptured("gpg", [
    "--batch",
    "--with-colons",
    "--fingerprint",
    "--list-secret-keys",
    fingerprint
  ], process.env);
  if (!keys.stdout.split(/\r?\n/u).includes(`fpr:::::::::${fingerprint}:`)) {
    throw new Error("Linux release GPG secret key fingerprint readback이 다릅니다.");
  }
  await runWithSecretInput("gpg", [
    "--batch",
    "--no-tty",
    "--yes",
    "--pinentry-mode",
    "loopback",
    "--passphrase-fd",
    "0",
    "--local-user",
    fingerprint,
    "--armor",
    "--detach-sign",
    "--output",
    signaturePath,
    artifactPath
  ], process.env, passphrase);
  const verified = await runCaptured("gpg", [
    "--batch",
    "--status-fd",
    "1",
    "--verify",
    signaturePath,
    artifactPath
  ], process.env);
  if (!verified.stdout.split(/\r?\n/u).some((line) => (
    line.startsWith(`[GNUPG:] VALIDSIG ${fingerprint} `)
  ))) {
    throw new Error("Linux detached signature VALIDSIG fingerprint가 다릅니다.");
  }
  await assertExactRegularFile(signaturePath, "Linux detached signature");
  return Object.freeze({
    method: "openpgp-detached-signature-sha256-manifest",
    signingIdentity: fingerprint,
    timestamped: false,
    detachedSignatureFileName: path.basename(signaturePath),
    verification: Object.freeze(["gpg-validsig-exact-primary-fingerprint"])
  });
}

async function verifyNativeUnsignedArtifact(
  artifactPath: string,
  target: DesktopBundleTarget,
  env: NodeJS.ProcessEnv
): Promise<string> {
  if (target === "linux-x64") {
    const handle = await open(artifactPath, fsConstants.O_RDONLY);
    try {
      const magic = Buffer.alloc(8);
      const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
      if (bytesRead !== magic.length || magic.toString("ascii") !== "!<arch>\n") {
        throw new Error("Linux installer가 Debian ar archive가 아닙니다.");
      }
    } finally {
      await handle.close();
    }
    const archive = await execFileAsync("/usr/bin/ar", ["t", artifactPath], {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 30_000
    });
    const entries = archive.stdout.trim().split(/\r?\n/u);
    if (JSON.stringify(entries) !== JSON.stringify([
      "debian-binary",
      "control.tar.xz",
      "data.tar.xz"
    ])) {
      throw new Error(`Debian archive member가 unsigned exact contract와 다릅니다: ${JSON.stringify(entries)}`);
    }
    return "deb-archive-no-release-signing-input";
  }
  if (target === "darwin-arm64") {
    try {
      await execFileAsync("/usr/bin/codesign", [
        "--display",
        "--verbose=4",
        artifactPath
      ], {
        cwd: root,
        env,
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 30_000
      });
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error
        ? String(error.stderr)
        : "";
      if (/code object is not signed at all/iu.test(stderr)) {
        return "codesign-confirms-dmg-not-signed";
      }
      throw new Error("DMG unsigned 상태를 codesign으로 확인하지 못했습니다.", {
        cause: error
      });
    }
    throw new Error("DMG에 예상하지 않은 code signature가 있습니다.");
  }
  if (target === "win32-x64") {
    const signatureEnvironment = windowsPowerShellEnvironment(env, {
      [WINDOWS_AUTHENTICODE_PATH_ENV]: artifactPath
    });
    const signature = await execFileAsync(windowsPowerShellExecutable(env), [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `${WINDOWS_SECURITY_MODULE_IMPORT};$path=[Environment]::GetEnvironmentVariable('${WINDOWS_AUTHENTICODE_PATH_ENV}','Process');if([string]::IsNullOrWhiteSpace($path)){throw 'missing Authenticode path'};(Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $path).Status.ToString()`
    ], {
      cwd: root,
      env: signatureEnvironment,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 30_000,
      windowsHide: true
    });
    if (signature.stdout.trim() !== "NotSigned") {
      throw new Error(`NSIS Authenticode 상태가 NotSigned가 아닙니다: ${signature.stdout.trim()}`);
    }
    return "authenticode-confirms-nsis-not-signed";
  }
  throw new Error(`unsigned 검증을 지원하지 않는 target입니다: ${target}`);
}

export async function packageDesktopInstaller(): Promise<Readonly<{
  readonly artifactPath: string;
  readonly channel: "ci-test-only" | "public-release";
  readonly manifestPath: string;
  readonly target: DesktopBundleTarget;
}>> {
  const target = currentTarget();
  const contract = desktopInstallerTarget(target);
  const builderPackagePath = require.resolve("electron-builder/package.json");
  const [appVersion, builderVersion] = await Promise.all([
    packageVersion(path.join(root, "package.json")),
    packageVersion(builderPackagePath)
  ]);
  const request = resolveDesktopInstallerBuildRequest(
    target,
    process.env,
    appVersion
  );
  await assertReleaseSourceIdentity(request);
  const prepackaged = await packageDesktopApplication();
  if (prepackaged.target !== target) {
    throw new Error("prepackaged app과 installer target이 다릅니다.");
  }
  if (target === "darwin-arm64") {
    await verifyMacBackgroundAgentMetadata(prepackaged.outputDirectory);
  }
  let provenanceEvidence: Readonly<VerifiedDesktopReleaseProvenance> | null = null;
  if (request.release) {
    provenanceEvidence = await verifyDesktopReleaseProvenance({
      provenanceRoot: request.release.provenanceRoot,
      archivePath: request.release.provenanceArchivePath,
      archiveSha256: request.release.provenanceArchiveSha256,
      target,
      tag: request.release.tag,
      commit: request.release.commit,
      appVersion,
      ffmpegPath: packagedToolFiles(prepackaged.outputDirectory, target)[0]!
    });
  }
  let signingEvidence: Readonly<ReleaseSigningEvidence> | null = null;
  let macosSealedTools: Readonly<MacosSealedToolVerification> | null = null;
  if (request.channel === "public-release") {
    if (target === "win32-x64") {
      signingEvidence = await signWindowsPrepackaged(
        prepackaged.outputDirectory,
        prepackaged.executable,
        request
      );
    } else if (target === "darwin-arm64") {
      const macSigning = await signMacPrepackaged(
        prepackaged.outputDirectory,
        request
      );
      signingEvidence = macSigning.signingEvidence;
      macosSealedTools = macSigning.sealedTools;
    }
  }
  const windowsJobLauncher = target === "win32-x64"
    ? await verifyPackagedWindowsJobLauncher(
      path.join(prepackaged.outputDirectory, "resources"),
      target
    )
    : null;
  const outputDirectory = path.join(root, "dist", "installers", target);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const builderCli = path.join(
    path.dirname(builderPackagePath),
    "out",
    "cli",
    "cli.js"
  );
  const builderEnvironment: NodeJS.ProcessEnv = request.channel === "public-release"
    ? { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "true" }
    : { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  const builderConfig = request.channel === "public-release"
    ? "electron-builder.release.yml"
    : "electron-builder.yml";
  await run(process.execPath, [
    builderCli,
    contract.builderFlag,
    contract.builderTarget,
    `--${contract.arch}`,
    "--prepackaged",
    target === "darwin-arm64"
      ? path.join(prepackaged.outputDirectory, "Kirinuki.app")
      : prepackaged.outputDirectory,
    "--publish",
    "never",
    "--config",
    path.join(root, builderConfig),
    `--config.directories.output=${outputDirectory}`
  ], builderEnvironment);
  if (target === "win32-x64") {
    const resourcesRoot = path.join(prepackaged.outputDirectory, "resources");
    // `--prepackaged` makes electron-builder package this already signed tree;
    // its normal recursive app-signing pass is not run. The reviewed upstream
    // ffmpeg/ffprobe/yt-dlp bytes are intentionally not re-signed. Authenticode
    // covers Kirinuki.exe, our native launcher, and the final NSIS. Verify this
    // input again here; installer smoke independently verifies extracted bytes.
    await verifyPackagedDesktopTools(resourcesRoot, target);
    await verifyPackagedWindowsJobLauncher(resourcesRoot, target);
  } else if (
    target === "darwin-arm64"
    && request.channel === "public-release"
  ) {
    macosSealedTools = await verifyMacosSealedDesktopTools({
      resourcesRoot: path.join(
        prepackaged.outputDirectory,
        "Kirinuki.app",
        "Contents",
        "Resources"
      )
    });
  }

  const artifactFileName = desktopInstallerArtifactFileName(
    target,
    request.channel
  );
  const builderArtifactFileName = desktopInstallerBuilderArtifactFileName(
    target,
    request.channel
  );
  let artifactPath = path.join(outputDirectory, builderArtifactFileName);
  let unsignedVerification: string | null = null;
  let signaturePath: string | null = null;
  if (request.channel === "ci-test-only") {
    unsignedVerification = await verifyNativeUnsignedArtifact(
      artifactPath,
      target,
      builderEnvironment
    );
  } else if (target === "win32-x64") {
    if (!signingEvidence) {
      throw new Error("Windows prepackaged signing evidence가 없습니다.");
    }
    const finalReadback = await windowsSignatureReadback(
      artifactPath,
      signingEvidence.signingIdentity,
      requiredEnvironment("KIRINUKI_WINDOWS_PUBLISHER_SUBJECT"),
      requiredEnvironment("KIRINUKI_WINDOWS_SIGNTOOL")
    );
    signingEvidence = Object.freeze({
      ...signingEvidence,
      verification: Object.freeze([
        ...signingEvidence.verification,
        `${artifactFileName}:authenticode:${finalReadback.status}:timestamped`
      ])
    });
  } else if (target === "darwin-arm64") {
    if (!signingEvidence) {
      throw new Error("macOS prepackaged signing evidence가 없습니다.");
    }
    signingEvidence = await notarizeAndVerifyMacDmg(
      artifactPath,
      request,
      signingEvidence
    );
  } else if (target === "linux-x64") {
    if (!contract.detachedSignatureFileName) {
      throw new Error("Linux detached signature 이름이 없습니다.");
    }
    signaturePath = path.join(
      outputDirectory,
      contract.detachedSignatureFileName
    );
    signingEvidence = await signAndVerifyLinuxArtifact(
      artifactPath,
      signaturePath,
      request
    );
  }
  if (
    request.channel === "public-release"
    && (!signingEvidence || !provenanceEvidence)
  ) {
    throw new Error(
      "public-release는 signing과 GPL/SBOM/corresponding-source provenance가 모두 검증되어야 합니다."
    );
  }
  if (request.channel === "public-release") {
    if (
      builderArtifactFileName === artifactFileName
      || !builderArtifactFileName.startsWith("QUARANTINED-NOT-FOR-PUBLISH-")
    ) {
      throw new Error("public-release builder output이 quarantine filename이 아닙니다.");
    }
    const publishedArtifactPath = path.join(outputDirectory, artifactFileName);
    try {
      await lstat(publishedArtifactPath);
      throw new Error("검증된 installer 승격 전에 stable public filename이 이미 존재합니다.");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    // Same-directory rename is the sole stable-name publication boundary. It
    // runs only after provenance and target-native signing/notarization have
    // both produced verified evidence above.
    await rename(artifactPath, publishedArtifactPath);
    artifactPath = publishedArtifactPath;
    await assertExactRegularFile(artifactPath, "verified stable release installer");
  } else if (builderArtifactFileName !== artifactFileName) {
    throw new Error("ci-test-only builder/final filename 계약이 다릅니다.");
  }
  const artifact = await sha256RegularFile(artifactPath);
  const manifestFileName = desktopInstallerManifestFileName(
    target,
    request.channel
  );
  const manifestPath = path.join(outputDirectory, manifestFileName);
  const manifest = Object.freeze({
    schema: DESKTOP_INSTALLER_MANIFEST_SCHEMA,
    status: request.channel === "public-release"
      ? "release-verified"
      : "unsigned-test-only",
    channel: request.channel,
    target,
    platform: contract.platform,
    arch: contract.arch,
    format: contract.format,
    artifact: Object.freeze({
      fileName: artifactFileName,
      bytes: artifact.bytes,
      sha256: artifact.sha256
    }),
    source: Object.freeze({
      appVersion,
      electronBuilderVersion: builderVersion,
      prepackagedDirectoryName: path.basename(prepackaged.outputDirectory),
      builderConfig,
      windowsJobLauncher: windowsJobLauncher?.manifest ?? null,
      macosSealedTools: macosSealedTools?.manifest ?? null
    }),
    release: request.release === null
      ? null
      : Object.freeze({
        tag: request.release.tag,
        commit: request.release.commit,
        provenance: provenanceEvidence
      }),
    releaseSigning: request.channel === "public-release"
      ? Object.freeze({
        allowed: true,
        signed: true,
        status: "verified-public-release",
        ...signingEvidence
      })
      : Object.freeze({
        allowed: false,
        signed: false,
        status: "unsigned-ci-test-only-never-publish",
        method: null,
        signingIdentity: null,
        timestamped: false,
        verification: unsignedVerification
      }),
    updater: Object.freeze({
      bundled: false,
      telemetry: false,
      publicNetworkPolling: false,
      unsignedUpdatesAllowed: false,
      compatibilityPolicy: LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.id,
      apiProtocol: LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.apiProtocol,
      replacement: LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.installedEngineReplacement
    })
  });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 }
  );
  const entries = (await readdir(outputDirectory, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
  const expectedEntries = [
    artifactFileName,
    manifestFileName,
    ...(signaturePath ? [path.basename(signaturePath)] : [])
  ].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `installer 출력에 예상하지 않은 artifact가 있습니다: ${JSON.stringify(entries)}`
    );
  }
  const readBack = JSON.parse(await readFile(manifestPath, "utf8"));
  if (JSON.stringify(readBack) !== JSON.stringify(manifest)) {
    throw new Error("installer manifest readback이 기록값과 다릅니다.");
  }
  return Object.freeze({
    artifactPath,
    channel: request.channel,
    manifestPath,
    target
  });
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: package-desktop-installer.ts");
  }
  console.log(JSON.stringify(await packageDesktopInstaller(), null, 2));
}
