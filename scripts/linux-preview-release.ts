#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DESKTOP_INSTALLER_MANIFEST_SCHEMA,
  LINUX_PREVIEW_INSTALLER_FILE,
  LINUX_PREVIEW_RELEASE_ASSET_FILES,
  LINUX_PREVIEW_RELEASE_CHECKSUM_FILE,
  LINUX_PREVIEW_RELEASE_MANIFEST_FILE,
  LINUX_PREVIEW_RELEASE_MANIFEST_SCHEMA,
  desktopInstallerArtifactFileName,
  desktopInstallerManifestFileName
} from "../src/desktop/installer-contract.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/u;
const SOURCE_INSTALLER_FILE = desktopInstallerArtifactFileName(
  "linux-x64",
  "ci-test-only"
);
const SOURCE_MANIFEST_FILE = desktopInstallerManifestFileName(
  "linux-x64",
  "ci-test-only"
);

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

export interface VerifiedLinuxPreviewRelease {
  readonly directory: string;
  readonly tag: string;
  readonly commit: string;
  readonly version: string;
  readonly installer: Readonly<FileIdentity>;
  readonly manifest: Readonly<FileIdentity>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

async function stableFileIdentity(filePath: string): Promise<Readonly<FileIdentity>> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.nlink === 1
      && metadata.size > 0
      && metadata.size <= 2 * 1024 * 1024 * 1024,
    `Linux preview 입력이 안전한 regular file이 아닙니다: ${filePath}`
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
        Math.min(buffer.byteLength, before.size - offset),
        offset
      );
      invariant(bytesRead > 0, `Linux preview 입력을 끝까지 읽지 못했습니다: ${filePath}`);
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
      `Linux preview 입력이 hash 중 바뀌었습니다: ${filePath}`
    );
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

async function canonicalDirectory(directory: string): Promise<string> {
  invariant(path.isAbsolute(directory), "Linux preview 경로는 절대 경로여야 합니다.");
  const canonical = await realpath(directory);
  invariant(
    canonical === path.resolve(directory),
    "Linux preview 경로에 symlink 또는 alias를 사용할 수 없습니다."
  );
  return canonical;
}

async function exactRegularEntries(
  directory: string,
  expected: readonly string[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(
    entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()),
    "Linux preview 디렉터리에는 regular file만 있어야 합니다."
  );
  invariant(
    JSON.stringify(entries.map(({ name }) => name).sort())
      === JSON.stringify([...expected].sort()),
    "Linux preview asset set가 exact allowlist와 다릅니다."
  );
}

function parsePreviewManifest(value: unknown): {
  readonly tag: string;
  readonly commit: string;
  readonly version: string;
  readonly artifact: Readonly<FileIdentity>;
} {
  invariant(
    isRecord(value)
      && exactKeys(value, [
        "artifact",
        "channel",
        "commit",
        "distribution",
        "schema",
        "sourceEvidence",
        "status",
        "tag",
        "target",
        "version"
      ])
      && value.schema === LINUX_PREVIEW_RELEASE_MANIFEST_SCHEMA
      && value.status === "verified-linux-preview"
      && value.channel === "linux-preview"
      && value.target === "linux-x64"
      && typeof value.tag === "string"
      && TAG_PATTERN.test(value.tag)
      && typeof value.commit === "string"
      && COMMIT_PATTERN.test(value.commit)
      && typeof value.version === "string"
      && value.tag === `v${value.version}`
      && isRecord(value.artifact)
      && exactKeys(value.artifact, ["bytes", "fileName", "sha256"])
      && value.artifact.fileName === LINUX_PREVIEW_INSTALLER_FILE
      && Number.isSafeInteger(value.artifact.bytes)
      && Number(value.artifact.bytes) > 0
      && typeof value.artifact.sha256 === "string"
      && SHA256_PATTERN.test(value.artifact.sha256)
      && isRecord(value.sourceEvidence)
      && exactKeys(value.sourceEvidence, [
        "channel",
        "fileName",
        "manifestFileName",
        "manifestSha256",
        "status"
      ])
      && value.sourceEvidence.channel === "ci-test-only"
      && value.sourceEvidence.fileName === SOURCE_INSTALLER_FILE
      && value.sourceEvidence.manifestFileName === SOURCE_MANIFEST_FILE
      && typeof value.sourceEvidence.manifestSha256 === "string"
      && SHA256_PATTERN.test(value.sourceEvidence.manifestSha256)
      && value.sourceEvidence.status === "unsigned-ci-test-only-never-publish"
      && isRecord(value.distribution)
      && exactKeys(value.distribution, [
        "buildProvenance",
        "signedDeb",
        "stableRelease",
        "support"
      ])
      && value.distribution.buildProvenance === "github-artifact-attestation"
      && value.distribution.signedDeb === false
      && value.distribution.stableRelease === false
      && value.distribution.support === "debian-ubuntu-linux-x64-preview",
    "Linux preview manifest가 exact 공개 테스트 계약과 다릅니다."
  );
  return Object.freeze({
    tag: value.tag,
    commit: value.commit,
    version: value.version,
    artifact: Object.freeze({
      bytes: Number(value.artifact.bytes),
      sha256: value.artifact.sha256
    })
  });
}

export async function verifyLinuxPreviewReleaseAssets(
  directory: string
): Promise<Readonly<VerifiedLinuxPreviewRelease>> {
  const canonical = await canonicalDirectory(directory);
  await exactRegularEntries(canonical, LINUX_PREVIEW_RELEASE_ASSET_FILES);
  const manifestPath = path.join(canonical, LINUX_PREVIEW_RELEASE_MANIFEST_FILE);
  const manifestIdentity = await stableFileIdentity(manifestPath);
  const parsed = parsePreviewManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const installerPath = path.join(canonical, LINUX_PREVIEW_INSTALLER_FILE);
  const installerIdentity = await stableFileIdentity(installerPath);
  invariant(
    installerIdentity.bytes === parsed.artifact.bytes
      && installerIdentity.sha256 === parsed.artifact.sha256,
    "Linux preview installer identity가 manifest와 다릅니다."
  );
  const checksum = await readFile(
    path.join(canonical, LINUX_PREVIEW_RELEASE_CHECKSUM_FILE),
    "utf8"
  );
  invariant(
    checksum === `${installerIdentity.sha256}  ${LINUX_PREVIEW_INSTALLER_FILE}\n`,
    "Linux preview checksum sidecar가 installer와 다릅니다."
  );
  return Object.freeze({
    directory: canonical,
    tag: parsed.tag,
    commit: parsed.commit,
    version: parsed.version,
    installer: installerIdentity,
    manifest: manifestIdentity
  });
}

async function assembleLinuxPreviewRelease(): Promise<Readonly<VerifiedLinuxPreviewRelease>> {
  invariant(
    process.platform === "linux" && process.arch === "x64",
    "Linux preview는 Linux x64 runner에서만 조립할 수 있습니다."
  );
  const tag = process.env.KIRINUKI_RELEASE_TAG;
  const commit = process.env.KIRINUKI_RELEASE_COMMIT;
  invariant(typeof tag === "string" && TAG_PATTERN.test(tag), "KIRINUKI_RELEASE_TAG가 필요합니다.");
  invariant(typeof commit === "string" && COMMIT_PATTERN.test(commit), "KIRINUKI_RELEASE_COMMIT이 필요합니다.");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as unknown;
  invariant(isRecord(packageJson) && typeof packageJson.version === "string", "package version을 읽지 못했습니다.");
  const version = packageJson.version;
  invariant(tag === `v${version}`, "Linux preview tag와 package version이 다릅니다.");
  const [headResult, tagResult, statusResult] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }),
    execFileAsync("git", ["rev-list", "-n", "1", tag], { cwd: root, encoding: "utf8" }),
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=no"],
      { cwd: root, encoding: "utf8" }
    )
  ]);
  invariant(
    headResult.stdout.trim() === commit
      && tagResult.stdout.trim() === commit
      && statusResult.stdout === "",
    "Linux preview는 exact clean tagged commit에서만 조립할 수 있습니다."
  );

  const sourceDirectory = await canonicalDirectory(
    path.join(root, "dist", "installers", "linux-x64")
  );
  await exactRegularEntries(sourceDirectory, [SOURCE_INSTALLER_FILE, SOURCE_MANIFEST_FILE]);
  const sourceInstallerPath = path.join(sourceDirectory, SOURCE_INSTALLER_FILE);
  const sourceManifestPath = path.join(sourceDirectory, SOURCE_MANIFEST_FILE);
  const sourceInstaller = await stableFileIdentity(sourceInstallerPath);
  const sourceManifest = await stableFileIdentity(sourceManifestPath);
  const sourceValue = JSON.parse(await readFile(sourceManifestPath, "utf8")) as unknown;
  invariant(
    isRecord(sourceValue)
      && sourceValue.schema === DESKTOP_INSTALLER_MANIFEST_SCHEMA
      && sourceValue.status === "unsigned-test-only"
      && sourceValue.channel === "ci-test-only"
      && sourceValue.target === "linux-x64"
      && isRecord(sourceValue.artifact)
      && sourceValue.artifact.fileName === SOURCE_INSTALLER_FILE
      && sourceValue.artifact.bytes === sourceInstaller.bytes
      && sourceValue.artifact.sha256 === sourceInstaller.sha256
      && isRecord(sourceValue.source)
      && sourceValue.source.appVersion === version
      && sourceValue.release === null
      && isRecord(sourceValue.releaseSigning)
      && sourceValue.releaseSigning.status === "unsigned-ci-test-only-never-publish"
      && sourceValue.releaseSigning.signed === false,
    "Linux preview source installer가 검증된 CI lifecycle artifact가 아닙니다."
  );

  const outputDirectory = path.join(root, "dist", "linux-preview-release");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  invariant((await readdir(outputDirectory)).length === 0, "Linux preview 출력 디렉터리가 비어 있지 않습니다.");
  const installerPath = path.join(outputDirectory, LINUX_PREVIEW_INSTALLER_FILE);
  await copyFile(sourceInstallerPath, installerPath, fsConstants.COPYFILE_EXCL);
  const manifest = Object.freeze({
    schema: LINUX_PREVIEW_RELEASE_MANIFEST_SCHEMA,
    status: "verified-linux-preview",
    channel: "linux-preview",
    target: "linux-x64",
    tag,
    commit,
    version,
    artifact: Object.freeze({
      fileName: LINUX_PREVIEW_INSTALLER_FILE,
      bytes: sourceInstaller.bytes,
      sha256: sourceInstaller.sha256
    }),
    sourceEvidence: Object.freeze({
      channel: "ci-test-only",
      fileName: SOURCE_INSTALLER_FILE,
      manifestFileName: SOURCE_MANIFEST_FILE,
      manifestSha256: sourceManifest.sha256,
      status: "unsigned-ci-test-only-never-publish"
    }),
    distribution: Object.freeze({
      support: "debian-ubuntu-linux-x64-preview",
      signedDeb: false,
      stableRelease: false,
      buildProvenance: "github-artifact-attestation"
    })
  });
  await writeFile(
    path.join(outputDirectory, LINUX_PREVIEW_RELEASE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o644 }
  );
  await writeFile(
    path.join(outputDirectory, LINUX_PREVIEW_RELEASE_CHECKSUM_FILE),
    `${sourceInstaller.sha256}  ${LINUX_PREVIEW_INSTALLER_FILE}\n`,
    { flag: "wx", mode: 0o644 }
  );
  return verifyLinuxPreviewReleaseAssets(outputDirectory);
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  if (command === "assemble" && directory === undefined) {
    console.log(JSON.stringify(await assembleLinuxPreviewRelease(), null, 2));
  } else if (command === "verify-readback" && directory && path.isAbsolute(directory)) {
    console.log(JSON.stringify(await verifyLinuxPreviewReleaseAssets(directory), null, 2));
  } else {
    throw new TypeError(
      "사용법: linux-preview-release.ts assemble | verify-readback <absolute-directory>"
    );
  }
}
