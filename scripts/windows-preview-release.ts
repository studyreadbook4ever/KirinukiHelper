#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
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
  WINDOWS_PREVIEW_INSTALLER_FILE,
  WINDOWS_PREVIEW_RELEASE_ASSET_FILES,
  WINDOWS_PREVIEW_RELEASE_CHECKSUM_FILE,
  WINDOWS_PREVIEW_RELEASE_MANIFEST_FILE,
  WINDOWS_PREVIEW_RELEASE_MANIFEST_SCHEMA,
  WINDOWS_PREVIEW_SOURCE_OFFER_FILE,
  desktopInstallerArtifactFileName,
  desktopInstallerManifestFileName
} from "../src/desktop/installer-contract.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = path.join(root, "dist", "installers", "win32-x64");
const outputDirectory = path.join(root, "dist", "windows-preview");
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const TAG_PATTERN = /^windows-preview-v\d+\.\d+\.\d+$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
    `${label}이 object가 아닙니다.`
  );
  return value as Record<string, unknown>;
}

async function fileIdentity(filePath: string): Promise<FileIdentity> {
  const metadata = await lstat(filePath);
  invariant(metadata.isFile() && !metadata.isSymbolicLink(),
    `regular file이 아닙니다: ${filePath}`);
  const contents = await readFile(filePath);
  invariant(contents.byteLength === metadata.size,
    `읽는 동안 파일 크기가 바뀌었습니다: ${filePath}`);
  return Object.freeze({
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex")
  });
}

async function exactFiles(directory: string, expected: readonly string[]):
Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(
    entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()),
    `Windows preview tree에 regular file 아닌 entry가 있습니다: ${directory}`
  );
  invariant(
    JSON.stringify(entries.map((entry) => entry.name).sort())
      === JSON.stringify([...expected].sort()),
    `Windows preview 파일 집합이 계약과 다릅니다: ${directory}`
  );
}

function requiredEnvironment(name: string, pattern: RegExp): string {
  const value = process.env[name];
  invariant(
    typeof value === "string"
      && value.trim() === value
      && pattern.test(value),
    `${name} 값이 올바르지 않습니다.`
  );
  return value;
}

async function assemble(): Promise<void> {
  const tag = requiredEnvironment("KIRINUKI_WINDOWS_PREVIEW_TAG", TAG_PATTERN);
  const commit = requiredEnvironment(
    "KIRINUKI_WINDOWS_PREVIEW_COMMIT",
    COMMIT_PATTERN
  );
  const packageValue = record(JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  ), "package.json");
  const version = packageValue.version;
  invariant(
    typeof version === "string" && tag === `windows-preview-v${version}`,
    "Windows preview tag와 package version이 다릅니다."
  );

  const sourceInstallerName = desktopInstallerArtifactFileName(
    "win32-x64",
    "ci-test-only"
  );
  const sourceManifestName = desktopInstallerManifestFileName(
    "win32-x64",
    "ci-test-only"
  );
  await exactFiles(sourceDirectory, [sourceInstallerName, sourceManifestName]);
  const sourceInstallerPath = path.join(sourceDirectory, sourceInstallerName);
  const sourceManifestPath = path.join(sourceDirectory, sourceManifestName);
  const [sourceInstaller, sourceManifestIdentity, sourceManifestValue] =
    await Promise.all([
      fileIdentity(sourceInstallerPath),
      fileIdentity(sourceManifestPath),
      readFile(sourceManifestPath, "utf8").then((value) => (
        record(JSON.parse(value), "Windows CI installer manifest")
      ))
    ]);
  const sourceArtifact = record(
    sourceManifestValue.artifact,
    "Windows CI installer artifact"
  );
  const sourceSigning = record(
    sourceManifestValue.releaseSigning,
    "Windows CI installer signing"
  );
  invariant(
    sourceManifestValue.schema === DESKTOP_INSTALLER_MANIFEST_SCHEMA
      && sourceManifestValue.status === "unsigned-test-only"
      && sourceManifestValue.channel === "ci-test-only"
      && sourceManifestValue.target === "win32-x64"
      && sourceManifestValue.platform === "win32"
      && sourceManifestValue.arch === "x64"
      && sourceManifestValue.format === "nsis"
      && sourceArtifact.fileName === sourceInstallerName
      && sourceArtifact.bytes === sourceInstaller.bytes
      && sourceArtifact.sha256 === sourceInstaller.sha256
      && sourceSigning.allowed === false
      && sourceSigning.signed === false
      && sourceSigning.status === "unsigned-ci-test-only-never-publish",
    "Windows CI installer evidence가 unsigned preview 입력 계약과 다릅니다."
  );

  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const installerPath = path.join(outputDirectory, WINDOWS_PREVIEW_INSTALLER_FILE);
  await copyFile(sourceInstallerPath, installerPath, fsConstants.COPYFILE_EXCL);
  const installer = await fileIdentity(installerPath);
  invariant(
    installer.bytes === sourceInstaller.bytes
      && installer.sha256 === sourceInstaller.sha256,
    "Windows preview installer copy identity가 바뀌었습니다."
  );

  const sourceOfferPath = path.join(
    outputDirectory,
    WINDOWS_PREVIEW_SOURCE_OFFER_FILE
  );
  await writeFile(sourceOfferPath, [
    "Kirinuki Windows x64 도우미 미리보기 대응 소스 안내",
    "",
    `Release tag: ${tag}`,
    `Source commit: ${commit}`,
    `Repository: https://github.com/studyreadbook4ever/KirinukiHelper/tree/${commit}`,
    `Source archive: https://github.com/studyreadbook4ever/KirinukiHelper/archive/${commit}.tar.gz`,
    `Third-party notices: https://github.com/studyreadbook4ever/KirinukiHelper/blob/${commit}/legal/THIRD_PARTY_NOTICES.md`,
    "",
    "이 파일은 Windows x64에서 설치·자동 실행·브라우저 loopback·제거를 시험한",
    "서명되지 않은 영상 준비 도우미 미리보기와 함께 제공됩니다.",
    "Microsoft Store 앱이나 영상 편집 앱이 아니며, 선택 구간을 사용자 PC에서 준비하는",
    "로컬 도우미입니다. Windows SmartScreen 경고가 표시될 수 있습니다.",
    ""
  ].join("\n"), { flag: "wx" });
  const sourceOffer = await fileIdentity(sourceOfferPath);

  const manifest = Object.freeze({
    schema: WINDOWS_PREVIEW_RELEASE_MANIFEST_SCHEMA,
    status: "verified-windows-preview",
    tag,
    commit,
    version,
    target: "win32-x64",
    platform: "win32",
    arch: "x64",
    channel: "github-prerelease",
    signed: false,
    smartScreenWarningExpected: true,
    lifecycleVerification: Object.freeze([
      "nsis-per-user-install",
      "hkcu-autostart",
      "installed-browser-loopback",
      "semantic-vod-materialization",
      "job-object-descendant-cleanup",
      "nsis-uninstall"
    ]),
    artifact: Object.freeze({
      fileName: WINDOWS_PREVIEW_INSTALLER_FILE,
      bytes: installer.bytes,
      sha256: installer.sha256
    }),
    sourceOffer: Object.freeze({
      fileName: WINDOWS_PREVIEW_SOURCE_OFFER_FILE,
      bytes: sourceOffer.bytes,
      sha256: sourceOffer.sha256
    }),
    sourceCiEvidence: Object.freeze({
      fileName: sourceManifestName,
      bytes: sourceManifestIdentity.bytes,
      sha256: sourceManifestIdentity.sha256
    })
  });
  const manifestPath = path.join(
    outputDirectory,
    WINDOWS_PREVIEW_RELEASE_MANIFEST_FILE
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" }
  );
  const checksumPath = path.join(
    outputDirectory,
    WINDOWS_PREVIEW_RELEASE_CHECKSUM_FILE
  );
  await writeFile(
    checksumPath,
    `${installer.sha256}  ${WINDOWS_PREVIEW_INSTALLER_FILE}\n`
      + `${sourceOffer.sha256}  ${WINDOWS_PREVIEW_SOURCE_OFFER_FILE}\n`,
    { flag: "wx" }
  );
  await verifyWindowsPreviewReleaseDirectory(outputDirectory);
}

export async function verifyWindowsPreviewReleaseDirectory(
  directory: string
): Promise<void> {
  await exactFiles(directory, WINDOWS_PREVIEW_RELEASE_ASSET_FILES);
  const [installer, sourceOffer, manifestIdentity, manifestValue, checksum] =
    await Promise.all([
      fileIdentity(path.join(directory, WINDOWS_PREVIEW_INSTALLER_FILE)),
      fileIdentity(path.join(directory, WINDOWS_PREVIEW_SOURCE_OFFER_FILE)),
      fileIdentity(path.join(directory, WINDOWS_PREVIEW_RELEASE_MANIFEST_FILE)),
      readFile(
        path.join(directory, WINDOWS_PREVIEW_RELEASE_MANIFEST_FILE),
        "utf8"
      ).then((value) => record(JSON.parse(value), "Windows preview manifest")),
      readFile(
        path.join(directory, WINDOWS_PREVIEW_RELEASE_CHECKSUM_FILE),
        "utf8"
      )
    ]);
  const artifact = record(manifestValue.artifact, "Windows preview artifact");
  const sourceOfferRecord = record(
    manifestValue.sourceOffer,
    "Windows preview source offer"
  );
  const sourceCiEvidence = record(
    manifestValue.sourceCiEvidence,
    "Windows preview source CI evidence"
  );
  invariant(
    manifestValue.schema === WINDOWS_PREVIEW_RELEASE_MANIFEST_SCHEMA
      && manifestValue.status === "verified-windows-preview"
      && typeof manifestValue.tag === "string"
      && TAG_PATTERN.test(manifestValue.tag)
      && typeof manifestValue.commit === "string"
      && COMMIT_PATTERN.test(manifestValue.commit)
      && manifestValue.target === "win32-x64"
      && manifestValue.platform === "win32"
      && manifestValue.arch === "x64"
      && manifestValue.channel === "github-prerelease"
      && manifestValue.signed === false
      && manifestValue.smartScreenWarningExpected === true
      && artifact.fileName === WINDOWS_PREVIEW_INSTALLER_FILE
      && artifact.bytes === installer.bytes
      && artifact.sha256 === installer.sha256
      && sourceOfferRecord.fileName === WINDOWS_PREVIEW_SOURCE_OFFER_FILE
      && sourceOfferRecord.bytes === sourceOffer.bytes
      && sourceOfferRecord.sha256 === sourceOffer.sha256
      && sourceCiEvidence.fileName === "UNSIGNED-TEST-ONLY-installer-manifest.json"
      && Number.isSafeInteger(sourceCiEvidence.bytes)
      && Number(sourceCiEvidence.bytes) > 100
      && typeof sourceCiEvidence.sha256 === "string"
      && SHA256_PATTERN.test(sourceCiEvidence.sha256),
    "Windows preview readback manifest가 artifact 계약과 다릅니다."
  );
  invariant(
    checksum === `${installer.sha256}  ${WINDOWS_PREVIEW_INSTALLER_FILE}\n`
      + `${sourceOffer.sha256}  ${WINDOWS_PREVIEW_SOURCE_OFFER_FILE}\n`,
    "Windows preview checksum 파일이 artifact와 다릅니다."
  );
  invariant(
    installer.bytes > 1_000_000
      && sourceOffer.bytes > 100
      && SHA256_PATTERN.test(manifestIdentity.sha256),
    "Windows preview artifact 크기/manifest digest가 유효하지 않습니다."
  );
  console.log(JSON.stringify({
    schema: "kirinuki-windows-preview-readback/v1",
    status: "ok",
    tag: manifestValue.tag,
    commit: manifestValue.commit,
    aggregateManifestSha256: manifestIdentity.sha256,
    installer,
    sourceOffer
  }, null, 2));
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "assemble" && process.argv.length === 3) {
    await assemble();
  } else if (command === "verify-readback" && process.argv.length === 4) {
    const directory = path.resolve(process.argv[3] || "");
    invariant(path.isAbsolute(directory), "readback directory는 절대 경로여야 합니다.");
    await verifyWindowsPreviewReleaseDirectory(directory);
  } else {
    throw new Error(
      "사용법: windows-preview-release.ts assemble | verify-readback <absolute-directory>"
    );
  }
}
