import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_INSTALLER_MANIFEST_SCHEMA,
  DESKTOP_INSTALLER_TARGETS,
  DESKTOP_PUBLIC_RELEASE_ASSET_FILES,
  DESKTOP_RELEASE_CHECKSUM_FILE,
  DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE,
  DESKTOP_RELEASE_MANIFEST_FILE,
  DESKTOP_RELEASE_MANIFEST_SCHEMA,
  DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
  desktopInstallerTarget
} from "../src/desktop/installer-contract.js";
import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";
import {
  LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY
} from "../src/lib/local-media-engine-contract.js";

const root = fileURLToPath(new URL("..", import.meta.url));
export const DESKTOP_RELEASE_INPUT_ROOT = path.join(root, "dist", "release-inputs");
export const DESKTOP_RELEASE_OUTPUT_ROOT = path.join(root, "dist", "installer-release");
export const DESKTOP_RELEASE_READBACK_ROOT = path.join(
  root,
  "dist",
  "installer-release-readback"
);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const GPG_FINGERPRINT_PATTERN = /^[0-9A-F]{40}$/u;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

interface InstallerEvidence {
  readonly target: DesktopBundleTarget;
  readonly fileName: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly releaseSigning: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  invariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label}가 JSON object가 아닙니다.`
  );
  return value as Record<string, unknown>;
}

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  invariant(
    typeof value === "string"
      && value.length > 0
      && value.trim() === value
      && !/[\u0000-\u001f\u007f]/u.test(value),
    `desktop release 환경이 빠졌거나 올바르지 않습니다: ${key}`
  );
  return value;
}

async function fileIdentity(filePath: string): Promise<Readonly<FileIdentity>> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0,
    `release asset가 regular non-symlink 파일이 아닙니다: ${filePath}`
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
      invariant(bytesRead > 0, "release asset를 끝까지 읽지 못했습니다.");
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
      "release asset가 hash readback 중 바뀌었습니다."
    );
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

function runGpg(
  args: readonly string[],
  secretInput?: string
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn("gpg", [...args], {
      cwd: root,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: [secretInput === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-1024 * 1024);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-1024 * 1024);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("desktop release GPG command timeout"));
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
          `desktop release GPG command failed: code=${code ?? "null"} signal=${signal ?? "none"}\n${stderr}`
        ));
        return;
      }
      resolve(Object.freeze({ stdout, stderr }));
    });
    if (secretInput !== undefined) {
      child.stdin!.end(`${secretInput}\n`, "utf8");
    }
  });
}

async function verifyGpgSignature(
  signaturePath: string,
  signedPath: string,
  fingerprint: string
): Promise<void> {
  const result = await runGpg([
    "--batch",
    "--status-fd",
    "1",
    "--verify",
    signaturePath,
    signedPath
  ]);
  invariant(
    result.stdout.split(/\r?\n/u).some((line) => (
      line.startsWith(`[GNUPG:] VALIDSIG ${fingerprint} `)
    )),
    `release GPG signature fingerprint가 다릅니다: ${path.basename(signedPath)}`
  );
}

async function signFileWithGpg(
  signedPath: string,
  signaturePath: string,
  fingerprint: string,
  passphrase: string
): Promise<void> {
  await runGpg([
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
    signedPath
  ], passphrase);
  await verifyGpgSignature(signaturePath, signedPath, fingerprint);
}

function validateSigningEvidence(
  target: DesktopBundleTarget,
  signing: Record<string, unknown>
): void {
  invariant(
    signing.allowed === true
      && signing.signed === true
      && signing.status === "verified-public-release"
      && Array.isArray(signing.verification)
      && signing.verification.length > 0,
    `${target} public signing evidence가 완전하지 않습니다.`
  );
  if (target === "win32-x64") {
    invariant(
      signing.method === "authenticode-rfc3161-sha256"
        && signing.timestamped === true
        && signing.signingIdentity === requiredEnvironment(
          "KIRINUKI_WINDOWS_CERTIFICATE_SHA1"
        ).toUpperCase(),
      "Windows Authenticode identity/timestamp evidence가 다릅니다."
    );
  } else if (target === "darwin-arm64") {
    invariant(
      signing.method === "developer-id-hardened-runtime-notarized-stapled-dmg"
        && signing.timestamped === true
        && signing.signingIdentity === requiredEnvironment("CSC_NAME")
        && typeof signing.notarizationRequestId === "string",
      "macOS Developer ID/notarization/staple evidence가 다릅니다."
    );
  } else {
    invariant(
      signing.method === "openpgp-detached-signature-sha256-manifest"
        && signing.signingIdentity === requiredEnvironment(
          "KIRINUKI_LINUX_SIGNING_FINGERPRINT"
        ).toUpperCase(),
      "Linux detached signature identity evidence가 다릅니다."
    );
  }
}

async function readInstallerEvidence(
  inputRoot: string,
  target: DesktopBundleTarget,
  tag: string,
  commit: string,
  appVersion: string
): Promise<Readonly<InstallerEvidence>> {
  const contract = desktopInstallerTarget(target);
  const targetRoot = path.join(inputRoot, target);
  const expectedNames = [
    contract.fileName,
    contract.releaseEvidenceFileName,
    ...(contract.detachedSignatureFileName
      ? [contract.detachedSignatureFileName]
      : [])
  ].sort();
  const entries = (await readdir(targetRoot, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
  invariant(
    JSON.stringify(entries) === JSON.stringify(expectedNames),
    `${target} release input tree가 exact contract와 다릅니다.`
  );
  const manifest = asRecord(JSON.parse(await readFile(
    path.join(targetRoot, contract.releaseEvidenceFileName),
    "utf8"
  )) as unknown, `${target} installer evidence`);
  const artifact = asRecord(manifest.artifact, `${target} installer artifact`);
  const source = asRecord(manifest.source, `${target} installer source`);
  const release = asRecord(manifest.release, `${target} installer release`);
  const provenance = asRecord(
    release.provenance,
    `${target} installer provenance`
  );
  const releaseSigning = asRecord(
    manifest.releaseSigning,
    `${target} installer signing`
  );
  const updater = asRecord(manifest.updater, `${target} installer updater policy`);
  const identity = await fileIdentity(path.join(targetRoot, contract.fileName));
  invariant(
    manifest.schema === DESKTOP_INSTALLER_MANIFEST_SCHEMA
      && manifest.status === "release-verified"
      && manifest.channel === "public-release"
      && manifest.target === target
      && artifact.fileName === contract.fileName
      && artifact.bytes === identity.bytes
      && artifact.sha256 === identity.sha256
      && source.appVersion === appVersion
      && release.tag === tag
      && release.commit === commit
      && provenance.archiveSha256 === requiredEnvironment(
        "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256"
      ).toLowerCase()
      && provenance.archiveFileName === DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
      && Number.isSafeInteger(provenance.archiveBytes)
      && Number(provenance.archiveBytes) >= 1024 * 1024
      && typeof provenance.manifestSha256 === "string"
      && typeof provenance.sbomSha256 === "string"
      && typeof provenance.correspondingSourceSha256 === "string"
      && typeof provenance.buildConfigurationSha256 === "string"
      && typeof provenance.bundleContentSha256 === "string"
      && updater.bundled === false
      && updater.telemetry === false
      && updater.publicNetworkPolling === false
      && updater.unsignedUpdatesAllowed === false
      && updater.compatibilityPolicy === LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.id
      && updater.apiProtocol === LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.apiProtocol
      && updater.replacement
        === LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.installedEngineReplacement,
    `${target} installer evidence와 release input bytes가 다릅니다.`
  );
  validateSigningEvidence(target, releaseSigning);
  if (contract.detachedSignatureFileName) {
    await verifyGpgSignature(
      path.join(targetRoot, contract.detachedSignatureFileName),
      path.join(targetRoot, contract.fileName),
      requiredEnvironment("KIRINUKI_LINUX_SIGNING_FINGERPRINT").toUpperCase()
    );
  }
  return Object.freeze({
    target,
    fileName: contract.fileName,
    bytes: identity.bytes,
    sha256: identity.sha256,
    releaseSigning: Object.freeze({ ...releaseSigning }),
    provenance: Object.freeze({ ...provenance })
  });
}

async function packageVersion(): Promise<string> {
  const value = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  invariant(
    typeof value.version === "string" && SEMVER_PATTERN.test(value.version),
    "desktop release package version이 올바르지 않습니다."
  );
  return value.version;
}

function releaseIdentityInputs(): Readonly<{
  tag: string;
  commit: string;
  fingerprint: string;
  provenanceArchiveSha256: string;
}> {
  const tag = requiredEnvironment("KIRINUKI_RELEASE_TAG");
  const commit = requiredEnvironment("KIRINUKI_RELEASE_COMMIT");
  const fingerprint = requiredEnvironment(
    "KIRINUKI_LINUX_SIGNING_FINGERPRINT"
  ).toUpperCase();
  const provenanceArchiveSha256 = requiredEnvironment(
    "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256"
  ).toLowerCase();
  invariant(COMMIT_PATTERN.test(commit), "desktop release commit SHA가 올바르지 않습니다.");
  invariant(
    GPG_FINGERPRINT_PATTERN.test(fingerprint),
    "desktop release GPG fingerprint가 올바르지 않습니다."
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(provenanceArchiveSha256),
    "desktop release provenance archive SHA-256이 올바르지 않습니다."
  );
  return Object.freeze({
    tag,
    commit,
    fingerprint,
    provenanceArchiveSha256
  });
}

function releaseAssemblyInputs(): Readonly<{
  passphrase: string;
  provenanceArchivePath: string;
}> {
  const provenanceArchivePath = requiredEnvironment(
    "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_PATH"
  );
  invariant(
    path.isAbsolute(provenanceArchivePath)
      && path.basename(provenanceArchivePath) === DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
    "desktop release provenance archive path가 exact public asset contract와 다릅니다."
  );
  return Object.freeze({
    passphrase: requiredEnvironment("KIRINUKI_LINUX_SIGNING_PASSPHRASE"),
    provenanceArchivePath
  });
}

export async function assembleDesktopReleaseAssets(): Promise<void> {
  const appVersion = await packageVersion();
  const {
    tag,
    commit,
    fingerprint,
    provenanceArchiveSha256
  } = releaseIdentityInputs();
  const { passphrase, provenanceArchivePath } = releaseAssemblyInputs();
  invariant(tag === `v${appVersion}`, "desktop release tag와 package version이 다릅니다.");
  const evidence = await Promise.all(DESKTOP_INSTALLER_TARGETS.map((target) => (
    readInstallerEvidence(
      DESKTOP_RELEASE_INPUT_ROOT,
      target,
      tag,
      commit,
      appVersion
    )
  )));
  await rm(DESKTOP_RELEASE_OUTPUT_ROOT, { recursive: true, force: true });
  await mkdir(DESKTOP_RELEASE_OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  const provenanceArchiveIdentity = await fileIdentity(provenanceArchivePath);
  invariant(
    provenanceArchiveIdentity.bytes >= 1024 * 1024
      && provenanceArchiveIdentity.sha256 === provenanceArchiveSha256,
    "desktop release provenance archive bytes가 pinned release input과 다릅니다."
  );
  await copyFile(
    provenanceArchivePath,
    path.join(DESKTOP_RELEASE_OUTPUT_ROOT, DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE),
    fsConstants.COPYFILE_EXCL
  );
  for (const item of evidence) {
    await copyFile(
      path.join(DESKTOP_RELEASE_INPUT_ROOT, item.target, item.fileName),
      path.join(DESKTOP_RELEASE_OUTPUT_ROOT, item.fileName),
      fsConstants.COPYFILE_EXCL
    );
    const signatureName = desktopInstallerTarget(item.target).detachedSignatureFileName;
    if (signatureName) {
      await copyFile(
        path.join(DESKTOP_RELEASE_INPUT_ROOT, item.target, signatureName),
        path.join(DESKTOP_RELEASE_OUTPUT_ROOT, signatureName),
        fsConstants.COPYFILE_EXCL
      );
    }
  }
  const releaseManifest = Object.freeze({
    schema: DESKTOP_RELEASE_MANIFEST_SCHEMA,
    status: "verified-public-release",
    tag,
    commit,
    appVersion,
    artifacts: Object.freeze(evidence.map((item) => Object.freeze({
      target: item.target,
      fileName: item.fileName,
      bytes: item.bytes,
      sha256: item.sha256,
      releaseSigning: item.releaseSigning,
      provenance: item.provenance
    }))),
    integrity: Object.freeze({
      linuxDetachedSignature: "Kirinuki-Engine-linux-x64.deb.asc",
      checksumFile: DESKTOP_RELEASE_CHECKSUM_FILE,
      checksumSignatureFile: DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE,
      openPgpFingerprint: fingerprint
    }),
    provenance: Object.freeze({
      fileName: DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
      bytes: provenanceArchiveIdentity.bytes,
      sha256: provenanceArchiveIdentity.sha256,
      status: "reviewed-gpl-sources-build-scripts-sbom"
    }),
    compatibility: LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY
  });
  await writeFile(
    path.join(DESKTOP_RELEASE_OUTPUT_ROOT, DESKTOP_RELEASE_MANIFEST_FILE),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 }
  );
  const checksummedNames = [
    ...evidence.map(({ fileName }) => fileName),
    "Kirinuki-Engine-linux-x64.deb.asc",
    DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
    DESKTOP_RELEASE_MANIFEST_FILE
  ].sort();
  const checksumLines: string[] = [];
  for (const fileName of checksummedNames) {
    const identity = await fileIdentity(path.join(DESKTOP_RELEASE_OUTPUT_ROOT, fileName));
    checksumLines.push(`${identity.sha256}  ${fileName}`);
  }
  const checksumPath = path.join(
    DESKTOP_RELEASE_OUTPUT_ROOT,
    DESKTOP_RELEASE_CHECKSUM_FILE
  );
  const checksumSignaturePath = path.join(
    DESKTOP_RELEASE_OUTPUT_ROOT,
    DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE
  );
  await writeFile(checksumPath, `${checksumLines.join("\n")}\n`, {
    flag: "wx",
    mode: 0o600
  });
  await signFileWithGpg(
    checksumPath,
    checksumSignaturePath,
    fingerprint,
    passphrase
  );
  await verifyDesktopReleaseAssets(DESKTOP_RELEASE_OUTPUT_ROOT);
}

export async function verifyDesktopReleaseAssets(
  directory = DESKTOP_RELEASE_READBACK_ROOT
): Promise<void> {
  const appVersion = await packageVersion();
  const {
    tag,
    commit,
    fingerprint,
    provenanceArchiveSha256
  } = releaseIdentityInputs();
  const entries = (await readdir(directory, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
  invariant(
    JSON.stringify(entries) === JSON.stringify(DESKTOP_PUBLIC_RELEASE_ASSET_FILES),
    "desktop release/download readback asset set가 exact contract와 다릅니다."
  );
  const checksumPath = path.join(directory, DESKTOP_RELEASE_CHECKSUM_FILE);
  await verifyGpgSignature(
    path.join(directory, DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE),
    checksumPath,
    fingerprint
  );
  const checksumText = await readFile(checksumPath, "utf8");
  const lines = checksumText.split("\n");
  invariant(lines.at(-1) === "", "desktop release checksum은 LF로 끝나야 합니다.");
  const declared = new Map<string, string>();
  for (const line of lines.slice(0, -1)) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
    invariant(match, "desktop release checksum line 형식이 올바르지 않습니다.");
    invariant(!declared.has(match[2]!), "desktop release checksum에 중복 파일이 있습니다.");
    declared.set(match[2]!, match[1]!);
  }
  const expectedChecksummed = DESKTOP_PUBLIC_RELEASE_ASSET_FILES.filter((name) => (
    name !== DESKTOP_RELEASE_CHECKSUM_FILE
      && name !== DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE
  ));
  invariant(
    JSON.stringify([...declared.keys()].sort()) === JSON.stringify(expectedChecksummed),
    "desktop release checksum 대상 목록이 exact asset contract와 다릅니다."
  );
  for (const [fileName, sha256] of declared) {
    const identity = await fileIdentity(path.join(directory, fileName));
    invariant(identity.sha256 === sha256, `download readback SHA-256이 다릅니다: ${fileName}`);
  }
  await verifyGpgSignature(
    path.join(directory, "Kirinuki-Engine-linux-x64.deb.asc"),
    path.join(directory, "Kirinuki-Engine-linux-x64.deb"),
    fingerprint
  );
  const releaseManifest = asRecord(JSON.parse(await readFile(
    path.join(directory, DESKTOP_RELEASE_MANIFEST_FILE),
    "utf8"
  )) as unknown, "desktop aggregate release manifest");
  invariant(
    releaseManifest.schema === DESKTOP_RELEASE_MANIFEST_SCHEMA
      && releaseManifest.status === "verified-public-release"
      && releaseManifest.tag === tag
      && releaseManifest.commit === commit
      && releaseManifest.appVersion === appVersion
      && Array.isArray(releaseManifest.artifacts)
      && releaseManifest.artifacts.length === DESKTOP_INSTALLER_TARGETS.length
      && JSON.stringify(releaseManifest.compatibility)
        === JSON.stringify(LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY),
    "desktop aggregate release manifest identity가 다릅니다."
  );
  const provenance = asRecord(
    releaseManifest.provenance,
    "desktop aggregate release provenance"
  );
  const provenanceIdentity = await fileIdentity(path.join(
    directory,
    DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
  ));
  invariant(
    provenance.fileName === DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
      && provenance.status === "reviewed-gpl-sources-build-scripts-sbom"
      && provenance.bytes === provenanceIdentity.bytes
      && provenance.sha256 === provenanceIdentity.sha256
      && provenanceIdentity.sha256 === provenanceArchiveSha256
      && provenanceIdentity.bytes >= 1024 * 1024,
    "desktop aggregate provenance archive readback이 다릅니다."
  );
  const artifacts = releaseManifest.artifacts as unknown[];
  for (const target of DESKTOP_INSTALLER_TARGETS) {
    const contract = desktopInstallerTarget(target);
    const artifact = artifacts.find((value) => (
      typeof value === "object"
        && value !== null
        && (value as Record<string, unknown>).target === target
    ));
    const record = asRecord(artifact, `${target} aggregate artifact`);
    const identity = await fileIdentity(path.join(directory, contract.fileName));
    invariant(
      record.fileName === contract.fileName
        && record.bytes === identity.bytes
        && record.sha256 === identity.sha256,
      `${target} aggregate manifest readback이 downloaded bytes와 다릅니다.`
    );
    validateSigningEvidence(
      target,
      asRecord(record.releaseSigning, `${target} aggregate signing`)
    );
    const artifactProvenance = asRecord(
      record.provenance,
      `${target} aggregate provenance`
    );
    invariant(
      artifactProvenance.archiveFileName === DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
        && artifactProvenance.archiveSha256 === provenanceIdentity.sha256
        && artifactProvenance.archiveBytes === provenanceIdentity.bytes,
      `${target} aggregate provenance가 public archive bytes와 다릅니다.`
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !["assemble", "verify-readback"].includes(String(command))) {
    throw new TypeError("사용법: desktop-release-assets.ts <assemble|verify-readback>");
  }
  if (command === "assemble") {
    await assembleDesktopReleaseAssets();
  } else {
    await verifyDesktopReleaseAssets();
  }
  console.log(JSON.stringify({
    schema: "kirinuki-desktop-release-assets/v1",
    status: "ok",
    command
  }, null, 2));
}
