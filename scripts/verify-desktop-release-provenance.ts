import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
} from "../src/desktop/installer-contract.js";
import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";
import {
  DESKTOP_FFMPEG_RELEASE,
  DESKTOP_YT_DLP_RELEASE,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";

export const DESKTOP_RELEASE_PROVENANCE_SCHEMA =
  "kirinuki-desktop-release-provenance/v2" as const;

interface RequiredSourceComponent {
  readonly id: string;
  readonly version: string;
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly licenseExpression: string;
  readonly licenseFileName: string;
}

export const DESKTOP_RELEASE_SOURCE_COMPONENTS = Object.freeze([
  Object.freeze({
    id: "ffmpeg",
    version: "n8.1.2",
    sourceRepository: "https://github.com/FFmpeg/FFmpeg",
    sourceRevision: "n8.1.2",
    licenseExpression: "GPL-3.0-or-later",
    licenseFileName: "GPL-3.0-or-later.txt"
  }),
  Object.freeze({
    id: "libvpx",
    version: "v1.16.0",
    sourceRepository: "https://chromium.googlesource.com/webm/libvpx",
    sourceRevision: "v1.16.0",
    licenseExpression: "BSD-3-Clause",
    licenseFileName: "LICENSE-libvpx.txt"
  }),
  Object.freeze({
    id: "svt-av1",
    version: "v4.1.0",
    sourceRepository: "https://gitlab.com/AOMediaCodec/SVT-AV1",
    sourceRevision: "v4.1.0",
    licenseExpression: "BSD-3-Clause-Clear",
    licenseFileName: "LICENSE-SVT-AV1.txt"
  }),
  Object.freeze({
    id: "x264",
    version: "0480cb0",
    sourceRepository: "https://code.videolan.org/videolan/x264.git",
    sourceRevision: "0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee",
    licenseExpression: "GPL-2.0-or-later",
    licenseFileName: "LICENSE-x264.txt"
  }),
  Object.freeze({
    id: "x265",
    version: "4.2",
    sourceRepository: "https://bitbucket.org/multicoreware/x265_git.git",
    sourceRevision: "4.2",
    licenseExpression: "GPL-2.0-or-later",
    licenseFileName: "LICENSE-x265.txt"
  }),
  Object.freeze({
    id: "lame",
    version: "3.100",
    sourceRepository: "https://sourceforge.net/projects/lame/files/lame/3.100/",
    sourceRevision: "3.100",
    licenseExpression: "LGPL-2.0-or-later",
    licenseFileName: "LICENSE-LAME.txt"
  }),
  Object.freeze({
    id: "opus",
    version: "v1.6.1",
    sourceRepository: "https://github.com/xiph/opus",
    sourceRevision: "v1.6.1",
    licenseExpression: "BSD-3-Clause",
    licenseFileName: "LICENSE-Opus.txt"
  }),
  Object.freeze({
    id: "mbedtls",
    version: "v3.4.1",
    sourceRepository: "https://github.com/ARMmbed/mbedtls",
    sourceRevision: "v3.4.1",
    licenseExpression: "Apache-2.0 OR GPL-2.0-or-later",
    licenseFileName: "LICENSE-Mbed-TLS.txt"
  })
] satisfies readonly Readonly<RequiredSourceComponent>[]);

export const DESKTOP_RELEASE_PROVENANCE_FILES = Object.freeze([
  "SOURCE-OFFER.txt",
  "desktop-release-provenance.json",
  "desktop-runtime.cdx.json",
  "ffmpeg-n8.1.2-linked-corresponding-source.tar.xz",
  "static-ffmpeg-binaries-n8.1.2-1-build-scripts.tar.xz",
  ...DESKTOP_RELEASE_SOURCE_COMPONENTS.map(({ licenseFileName }) => licenseFileName)
].filter((value, index, values) => values.indexOf(value) === index).sort());

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const GPL_V3_EXACT_BYTES = 35_147;
const GPL_V3_EXACT_SHA256 =
  "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903";
const SHAKA_BUILD_COMMIT = "88caac417541f3bb678fa6670cb73f2d74c7aaf9";
const REQUIRED_BUILDCONF_FLAGS = Object.freeze([
  "--enable-gpl",
  "--enable-version3",
  "--enable-libvpx",
  "--enable-libsvtav1",
  "--enable-libx264",
  "--enable-libx265",
  "--enable-libmp3lame",
  "--enable-libopus",
  "--enable-mbedtls"
]);
const PROHIBITED_BUILDCONF_FLAGS = Object.freeze(["--enable-nonfree"]);

interface ProvenanceArtifactRecord {
  readonly fileName: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

export interface VerifiedDesktopReleaseProvenance {
  readonly archiveBytes: number;
  readonly archiveFileName: typeof DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE;
  readonly archiveSha256: string;
  readonly buildConfigurationSha256: string;
  readonly bundleContentSha256: string;
  readonly correspondingSourceSha256: string;
  readonly manifestSha256: string;
  readonly sbomSha256: string;
  readonly sourceOfferSha256: string;
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

function sameCanonicalPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function artifactRecord(
  value: unknown,
  expectedFileName: string,
  label: string
): Readonly<ProvenanceArtifactRecord> {
  const record = asRecord(value, label);
  invariant(
    record.fileName === expectedFileName
      && Number.isSafeInteger(record.bytes)
      && Number(record.bytes) > 0
      && typeof record.sha256 === "string"
      && SHA256_PATTERN.test(record.sha256),
    `${label} fileName/bytes/SHA-256 contract가 올바르지 않습니다.`
  );
  return Object.freeze({
    fileName: expectedFileName,
    bytes: Number(record.bytes),
    sha256: record.sha256
  });
}

async function hashStableRegularFile(
  filePath: string,
  label: string,
  minimumBytes = 1
): Promise<Readonly<FileIdentity>> {
  const [metadata, canonical] = await Promise.all([
    lstat(filePath),
    realpath(filePath)
  ]);
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.nlink === 1
      && metadata.size >= minimumBytes
      && sameCanonicalPath(canonical, filePath),
    `${label}가 symlink/hardlink 없는 exact regular file이 아닙니다.`
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
      invariant(bytesRead > 0, `${label}를 끝까지 읽지 못했습니다.`);
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
      `${label}가 hash readback 중 바뀌었습니다.`
    );
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

async function verifyArtifact(
  provenanceRoot: string,
  expected: Readonly<ProvenanceArtifactRecord>,
  minimumBytes = 1
): Promise<string> {
  const identity = await hashStableRegularFile(
    path.join(provenanceRoot, expected.fileName),
    `provenance ${expected.fileName}`,
    minimumBytes
  );
  invariant(
    identity.bytes === expected.bytes && identity.sha256 === expected.sha256,
    `provenance size/SHA-256이 다릅니다: ${expected.fileName}`
  );
  return identity.sha256;
}

function normalizedBuildConfiguration(output: string): string {
  return `${output.replace(/\r\n?/gu, "\n").trim()}\n`;
}

async function packagedBuildConfiguration(
  ffmpegPath: string
): Promise<Readonly<{ content: string; sha256: string }>> {
  const result = await execFileAsync(ffmpegPath, ["-hide_banner", "-buildconf"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true
  });
  const content = normalizedBuildConfiguration(`${result.stdout}\n${result.stderr}`);
  for (const flag of REQUIRED_BUILDCONF_FLAGS) {
    invariant(content.includes(flag), `packaged FFmpeg buildconf에 ${flag}가 없습니다.`);
  }
  for (const flag of PROHIBITED_BUILDCONF_FLAGS) {
    invariant(!content.includes(flag), `packaged FFmpeg buildconf에 금지된 ${flag}가 있습니다.`);
  }
  return Object.freeze({
    content,
    sha256: createHash("sha256").update(content).digest("hex")
  });
}

function validateSourceComponents(
  value: unknown
): ReadonlyMap<string, Readonly<ProvenanceArtifactRecord>> {
  invariant(Array.isArray(value), "FFmpeg linked source component가 없습니다.");
  invariant(
    value.length === DESKTOP_RELEASE_SOURCE_COMPONENTS.length,
    "FFmpeg linked source component 수가 exact contract와 다릅니다."
  );
  const licenses = new Map<string, Readonly<ProvenanceArtifactRecord>>();
  for (const expected of DESKTOP_RELEASE_SOURCE_COMPONENTS) {
    const matches = value.filter((candidate) => (
      typeof candidate === "object"
        && candidate !== null
        && (candidate as Record<string, unknown>).id === expected.id
    ));
    invariant(matches.length === 1, `${expected.id} source component가 유일하지 않습니다.`);
    const component = asRecord(matches[0], `${expected.id} source component`);
    invariant(
      component.version === expected.version
        && component.sourceRepository === expected.sourceRepository
        && component.sourceRevision === expected.sourceRevision
        && component.licenseExpression === expected.licenseExpression,
      `${expected.id} source version/revision/license가 exact build input과 다릅니다.`
    );
    licenses.set(expected.id, artifactRecord(
      component.licenseArtifact,
      expected.licenseFileName,
      `${expected.id} license artifact`
    ));
  }
  return licenses;
}

function validateSbom(
  document: Record<string, unknown>,
  appVersion: string
): void {
  invariant(
    document.bomFormat === "CycloneDX"
      && document.specVersion === "1.6"
      && Array.isArray(document.components),
    "desktop runtime SBOM이 CycloneDX 1.6 inventory가 아닙니다."
  );
  const components = document.components as unknown[];
  const expected = [
    ...DESKTOP_RELEASE_SOURCE_COMPONENTS.map(({ id, version }) => ({ id, version })),
    { id: "electron", version: "43.4.1" },
    { id: "yt-dlp", version: DESKTOP_YT_DLP_RELEASE.version },
    { id: "kirinuki-app", version: appVersion }
  ];
  for (const item of expected) {
    const matches = components.filter((candidate) => (
      typeof candidate === "object"
        && candidate !== null
        && (candidate as Record<string, unknown>).name === item.id
        && (candidate as Record<string, unknown>).version === item.version
    ));
    invariant(matches.length === 1, `SBOM ${item.id}@${item.version} component가 유일하지 않습니다.`);
    const component = asRecord(matches[0], `SBOM ${item.id}`);
    invariant(
      Array.isArray(component.licenses) && component.licenses.length > 0,
      `SBOM ${item.id} license inventory가 없습니다.`
    );
  }
}

function bundleContentDigest(
  records: readonly Readonly<ProvenanceArtifactRecord>[]
): string {
  const unique = new Map<string, Readonly<ProvenanceArtifactRecord>>();
  for (const record of records) {
    const existing = unique.get(record.fileName);
    invariant(
      existing === undefined
        || (existing.bytes === record.bytes && existing.sha256 === record.sha256),
      `provenance manifest에 충돌하는 artifact가 있습니다: ${record.fileName}`
    );
    unique.set(record.fileName, record);
  }
  const content = [...unique.values()]
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"))
    .map(({ sha256, bytes, fileName }) => `${sha256}  ${bytes}  ${fileName}`)
    .join("\n") + "\n";
  return createHash("sha256").update(content).digest("hex");
}

export async function verifyDesktopReleaseProvenance({
  provenanceRoot,
  archivePath,
  archiveSha256,
  target,
  tag,
  commit,
  appVersion,
  ffmpegPath
}: {
  readonly provenanceRoot: string;
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly target: DesktopBundleTarget;
  readonly tag: string;
  readonly commit: string;
  readonly appVersion: string;
  readonly ffmpegPath: string;
}): Promise<Readonly<VerifiedDesktopReleaseProvenance>> {
  invariant(path.isAbsolute(provenanceRoot), "release provenance root는 절대 경로여야 합니다.");
  invariant(path.isAbsolute(archivePath), "release provenance archive는 절대 경로여야 합니다.");
  invariant(
    path.basename(archivePath) === DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
    "release provenance archive 파일명이 public asset contract와 다릅니다."
  );
  invariant(SHA256_PATTERN.test(archiveSha256), "provenance archive SHA-256이 올바르지 않습니다.");
  invariant(COMMIT_PATTERN.test(commit), "provenance release commit이 올바르지 않습니다.");
  const archiveIdentity = await hashStableRegularFile(
    archivePath,
    "release provenance archive",
    1024 * 1024
  );
  invariant(
    archiveIdentity.sha256 === archiveSha256,
    "release provenance archive 실제 SHA-256이 선언값과 다릅니다."
  );
  const [rootMetadata, canonicalRoot] = await Promise.all([
    lstat(provenanceRoot),
    realpath(provenanceRoot)
  ]);
  invariant(
    rootMetadata.isDirectory()
      && !rootMetadata.isSymbolicLink()
      && sameCanonicalPath(canonicalRoot, provenanceRoot),
    "release provenance root는 symlink 없는 exact directory여야 합니다."
  );
  const entries = (await readdir(provenanceRoot, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
  invariant(
    JSON.stringify(entries) === JSON.stringify(DESKTOP_RELEASE_PROVENANCE_FILES),
    "release provenance bundle file tree가 exact contract와 다릅니다."
  );
  const manifestPath = path.join(provenanceRoot, "desktop-release-provenance.json");
  const manifestIdentity = await hashStableRegularFile(
    manifestPath,
    "desktop release provenance manifest",
    256
  );
  const manifestBytes = await readFile(manifestPath);
  invariant(
    createHash("sha256").update(manifestBytes).digest("hex") === manifestIdentity.sha256,
    "provenance manifest가 readback 중 바뀌었습니다."
  );
  const manifest = asRecord(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
    "desktop release provenance manifest"
  );
  const ffmpeg = asRecord(manifest.ffmpeg, "FFmpeg provenance");
  const review = asRecord(manifest.review, "provenance review");
  const artifacts = asRecord(manifest.artifacts, "provenance artifacts");
  invariant(
    manifest.schema === DESKTOP_RELEASE_PROVENANCE_SCHEMA
      && manifest.status === "reviewed-public-release"
      && manifest.releaseTag === tag
      && manifest.releaseCommit === commit
      && manifest.appVersion === appVersion
      && typeof manifest.bundleContentSha256 === "string"
      && SHA256_PATTERN.test(manifest.bundleContentSha256),
    "provenance manifest release identity가 다릅니다."
  );
  invariant(
    ffmpeg.distributionRepository === "https://github.com/shaka-project/static-ffmpeg-binaries"
      && ffmpeg.distributionTag === DESKTOP_FFMPEG_RELEASE.distributionTag
      && ffmpeg.distributionCommit === SHAKA_BUILD_COMMIT
      && ffmpeg.upstreamRepository === "https://github.com/FFmpeg/FFmpeg"
      && ffmpeg.upstreamTag === "n8.1.2"
      && ffmpeg.licenseExpression === "GPL-3.0-or-later"
      && ffmpeg.gplEnabled === true
      && ffmpeg.version3Enabled === true
      && ffmpeg.nonfreeEnabled === false,
    "FFmpeg GPL/build provenance contract가 완전하지 않습니다."
  );
  invariant(
    review.decision === "approved-for-public-release"
      && review.reviewedCommit === commit
      && typeof review.reviewer === "string"
      && review.reviewer.length >= 3
      && typeof review.reviewedAt === "string"
      && ISO_TIMESTAMP_PATTERN.test(review.reviewedAt)
      && Number.isFinite(Date.parse(review.reviewedAt)),
    "사람이 승인한 exact provenance review가 없습니다."
  );

  const componentLicenses = validateSourceComponents(ffmpeg.sourceComponents);
  const license = artifactRecord(
    artifacts.license,
    "GPL-3.0-or-later.txt",
    "GPLv3 license"
  );
  invariant(
    license.bytes === GPL_V3_EXACT_BYTES
      && license.sha256 === GPL_V3_EXACT_SHA256,
    "GPLv3 canonical license bytes가 exact FFmpeg source와 다릅니다."
  );
  const ffmpegLicense = componentLicenses.get("ffmpeg");
  invariant(
    ffmpegLicense?.bytes === license.bytes && ffmpegLicense.sha256 === license.sha256,
    "FFmpeg component license와 canonical GPLv3 artifact가 다릅니다."
  );
  const sourceOffer = artifactRecord(artifacts.sourceOffer, "SOURCE-OFFER.txt", "source offer");
  const correspondingSource = artifactRecord(
    artifacts.correspondingSource,
    "ffmpeg-n8.1.2-linked-corresponding-source.tar.xz",
    "FFmpeg linked corresponding source"
  );
  const buildScripts = artifactRecord(
    artifacts.buildScripts,
    "static-ffmpeg-binaries-n8.1.2-1-build-scripts.tar.xz",
    "FFmpeg build scripts"
  );
  const sbom = artifactRecord(artifacts.sbom, "desktop-runtime.cdx.json", "desktop runtime SBOM");
  const allRecords = [
    license,
    sourceOffer,
    correspondingSource,
    buildScripts,
    sbom,
    ...componentLicenses.values()
  ];
  const digestByFile = new Map<string, string>();
  for (const record of allRecords) {
    if (!digestByFile.has(record.fileName)) {
      const minimumBytes = record.fileName === correspondingSource.fileName
        ? 1024 * 1024
        : record.fileName === buildScripts.fileName
          ? 10 * 1024
          : record.fileName === sbom.fileName
            ? 1024
            : record.fileName === sourceOffer.fileName
              ? 256
              : 32;
      digestByFile.set(
        record.fileName,
        await verifyArtifact(provenanceRoot, record, minimumBytes)
      );
    }
  }
  const contentDigest = bundleContentDigest(allRecords);
  invariant(
    manifest.bundleContentSha256 === contentDigest,
    "provenance bundleContentSha256가 manifest의 artifact set과 다릅니다."
  );

  const sourceOfferText = await readFile(path.join(provenanceRoot, sourceOffer.fileName), "utf8");
  for (const requiredText of [
    "n8.1.2",
    "n8.1.2-1",
    DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
    correspondingSource.fileName,
    buildScripts.fileName,
    "lostfragment@naver.com",
    ...DESKTOP_RELEASE_SOURCE_COMPONENTS.flatMap(({ id, version }) => [id, version])
  ]) {
    invariant(
      sourceOfferText.includes(requiredText),
      `source offer에 필수 대응 소스 안내가 없습니다: ${requiredText}`
    );
  }
  const sbomDocument = asRecord(JSON.parse(await readFile(
    path.join(provenanceRoot, sbom.fileName),
    "utf8"
  )) as unknown, "desktop runtime CycloneDX SBOM");
  validateSbom(sbomDocument, appVersion);

  const targetRecords = ffmpeg.binaryArtifacts;
  invariant(Array.isArray(targetRecords), "FFmpeg target binary provenance가 없습니다.");
  invariant(targetRecords.length === 3, "FFmpeg provenance는 정확히 세 public target을 포함해야 합니다.");
  const expectedTargets = ["darwin-arm64", "linux-x64", "win32-x64"];
  invariant(
    JSON.stringify(targetRecords.map((value) => (
      asRecord(value, "FFmpeg binary provenance").target
    )).sort()) === JSON.stringify(expectedTargets),
    "FFmpeg provenance target set가 exact public matrix와 다릅니다."
  );
  for (const expectedTarget of expectedTargets) {
    const record = asRecord(targetRecords.find((value) => (
      typeof value === "object"
        && value !== null
        && (value as Record<string, unknown>).target === expectedTarget
    )), `${expectedTarget} FFmpeg binary provenance`);
    const toolManifest = desktopToolTargetManifest(expectedTarget);
    invariant(
      record.ffmpegSha256 === toolManifest.ffmpeg.sha256
        && record.ffprobeSha256 === toolManifest.ffprobe.sha256
        && typeof record.buildConfigurationSha256 === "string"
        && SHA256_PATTERN.test(record.buildConfigurationSha256),
      `${expectedTarget} FFmpeg binary provenance가 pinned tool manifest와 다릅니다.`
    );
  }
  const targetRecord = asRecord(targetRecords.find((value) => (
    typeof value === "object"
      && value !== null
      && (value as Record<string, unknown>).target === target
  )), `${target} FFmpeg binary provenance`);
  const buildconf = await packagedBuildConfiguration(ffmpegPath);
  invariant(
    targetRecord.buildConfigurationSha256 === buildconf.sha256,
    `${target} FFmpeg buildconf가 reviewed provenance와 다릅니다.`
  );
  return Object.freeze({
    archiveBytes: archiveIdentity.bytes,
    archiveFileName: DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE,
    archiveSha256,
    buildConfigurationSha256: buildconf.sha256,
    bundleContentSha256: contentDigest,
    correspondingSourceSha256: digestByFile.get(correspondingSource.fileName)!,
    manifestSha256: manifestIdentity.sha256,
    sbomSha256: digestByFile.get(sbom.fileName)!,
    sourceOfferSha256: digestByFile.get(sourceOffer.fileName)!
  });
}
