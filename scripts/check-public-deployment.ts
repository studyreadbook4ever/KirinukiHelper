#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath
} from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  PUBLIC_SHELL_CANONICAL_HOST,
  PUBLIC_SHELL_CANONICAL_URL,
  PUBLIC_SHELL_SECURITY_HEADERS,
  parsePublicShellHeaders
} from "./public-shell-server-core.js";
import { readPackageSourceFile } from "./package-source-reader.js";
import {
  KIRINUKI_PACKAGE_NAME,
  KIRINUKI_RELEASE_SCHEMA_VERSION,
  parseKirinukiPackageIdentity,
  parseSha256Sidecar,
  serializeKirinukiReleaseRecord,
  sha256Bytes,
  type KirinukiReleaseArtifact,
  type KirinukiReleaseRecord
} from "./release-record.js";
import { PUBLIC_WEB_PACKAGE_FILES } from "./web-package-files.js";

export const MAX_PUBLIC_DEPLOYMENT_HTML_BYTES = 1024 * 1024;

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const MAX_PUBLIC_DEPLOYMENT_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_PUBLIC_DEPLOYMENT_CHECKSUM_BYTES = 512;
const MAX_PUBLIC_DEPLOYMENT_MANIFEST_BYTES = 64 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const PUBLIC_DEPLOYMENT_ARCHIVE_ALLOWLIST = Object.freeze([
  ".popovic-hosts",
  "THIRD_PARTY_NOTICES.md",
  "_headers",
  "index.html",
  "licenses/UNLICENSE.txt",
  "public.css"
].sort());
const PUBLIC_DEPLOYMENT_SOURCE_MAPPING = Object.freeze([
  {
    archivePath: ".popovic-hosts",
    sourcePath: "public-shell/.popovic-hosts"
  },
  {
    archivePath: "THIRD_PARTY_NOTICES.md",
    sourcePath: "public-shell/THIRD_PARTY_NOTICES.md"
  },
  {
    archivePath: "_headers",
    sourcePath: "public-shell/_headers"
  },
  {
    archivePath: "index.html",
    sourcePath: "public-shell/index.html"
  },
  {
    archivePath: "licenses/UNLICENSE.txt",
    sourcePath: "public-shell/licenses/UNLICENSE.txt"
  },
  {
    archivePath: "public.css",
    sourcePath: "public-shell/public.css"
  }
] as const);

export interface PublicDeploymentExpectedResource {
  readonly archivePath: string;
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly requestPath: string;
  readonly sha256: string;
}

interface PublicDeploymentResponseMetadata {
  readonly finalUrl: string;
  readonly headers: PublicDeploymentSnapshot["headers"];
  readonly requestedUrl: string;
  readonly status: number;
}

interface PublicDeploymentZipEntry {
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly flags: number;
  readonly localHeaderOffset: number;
  readonly name: string;
  readonly unixMode: number;
  readonly uncompressedSize: number;
}

export interface PublicDeploymentSnapshot {
  readonly body: string;
  readonly finalUrl: string;
  readonly headers: Pick<Headers, "get"> & {
    getSetCookie?: () => string[];
  };
  readonly requestedUrl: string;
  readonly status: number;
}

export interface PublicDeploymentCheckResult {
  readonly bytes: number;
  readonly status: 200;
  readonly url: typeof PUBLIC_SHELL_CANONICAL_URL;
}

export interface PublicDeploymentCheckOptions {
  readonly artifactDirectory?: string;
  readonly repositoryRoot?: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactStringList(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function assertArtifact(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asJsonRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  assertArtifact(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label}가 JSON object가 아닙니다.`
  );
  return value as Record<string, unknown>;
}

function assertExactJsonKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
): void {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assertArtifact(
    exactStringList(actualKeys, expected),
    `${label}의 key가 release schema와 정확히 일치하지 않습니다.`
  );
}

function parseReleaseArtifact(
  value: unknown,
  expectedFile: string,
  label: string
): KirinukiReleaseArtifact {
  const artifact = asJsonRecord(value, label);
  assertExactJsonKeys(
    artifact,
    ["bytes", "checksumFile", "file", "sha256"],
    label
  );
  assertArtifact(
    Number.isSafeInteger(artifact.bytes)
      && Number(artifact.bytes) > 0
      && artifact.file === expectedFile
      && artifact.checksumFile === `${expectedFile}.sha256`
      && typeof artifact.sha256 === "string"
      && SHA256_PATTERN.test(artifact.sha256),
    `${label} identity가 release schema와 다릅니다.`
  );
  return {
    bytes: Number(artifact.bytes),
    checksumFile: `${expectedFile}.sha256`,
    file: expectedFile,
    sha256: artifact.sha256
  };
}

function parseCanonicalReleaseRecord(
  bytes: Buffer,
  expectedManifestFilename: string
): KirinukiReleaseRecord {
  const source = decodeCanonicalUtf8(bytes, "공개 배포 release manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("공개 배포 release manifest가 유효한 JSON이 아닙니다.");
  }
  const record = asJsonRecord(parsed, "공개 배포 release manifest");
  assertExactJsonKeys(
    record,
    ["artifacts", "product", "schemaVersion", "source"],
    "공개 배포 release manifest"
  );
  const product = asJsonRecord(record.product, "release product");
  const sourceIdentity = asJsonRecord(record.source, "release source");
  const artifacts = asJsonRecord(record.artifacts, "release artifacts");
  assertExactJsonKeys(product, ["name", "version"], "release product");
  assertExactJsonKeys(
    sourceIdentity,
    ["gitCommit", "packageLockSha256"],
    "release source"
  );
  assertExactJsonKeys(artifacts, ["linux", "web"], "release artifacts");
  assertArtifact(
    record.schemaVersion === KIRINUKI_RELEASE_SCHEMA_VERSION
      && product.name === KIRINUKI_PACKAGE_NAME
      && typeof product.version === "string"
      && SEMVER_PATTERN.test(product.version)
      && typeof sourceIdentity.gitCommit === "string"
      && GIT_COMMIT_PATTERN.test(sourceIdentity.gitCommit)
      && typeof sourceIdentity.packageLockSha256 === "string"
      && SHA256_PATTERN.test(sourceIdentity.packageLockSha256),
    "release manifest의 schema/product/source identity가 올바르지 않습니다."
  );
  const expectedReleaseFilename = `kirinuki-release-v${product.version}.json`;
  assertArtifact(
    expectedManifestFilename === expectedReleaseFilename,
    "release manifest 파일명과 product version이 다릅니다."
  );
  const canonical: KirinukiReleaseRecord = {
    schemaVersion: KIRINUKI_RELEASE_SCHEMA_VERSION,
    product: {
      name: KIRINUKI_PACKAGE_NAME,
      version: product.version
    },
    source: {
      gitCommit: sourceIdentity.gitCommit,
      packageLockSha256: sourceIdentity.packageLockSha256
    },
    artifacts: {
      web: parseReleaseArtifact(
        artifacts.web,
        `kirinuki-web-v${product.version}.zip`,
        "release web artifact"
      ),
      linux: parseReleaseArtifact(
        artifacts.linux,
        `kirinuki-linux-v${product.version}.tar.gz`,
        "release Linux artifact"
      )
    }
  };
  assertArtifact(
    serializeKirinukiReleaseRecord(canonical) === source,
    "release manifest가 canonical deterministic JSON과 다릅니다."
  );
  return canonical;
}

function runBoundedGit(
  sourceRepositoryRoot: string,
  args: readonly string[]
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const environment = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
      ),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_NO_REPLACE_OBJECTS: "1"
    } satisfies NodeJS.ProcessEnv;
    const child = spawn("git", ["--no-replace-objects", ...args], {
      cwd: sourceRepositoryRoot,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const rejectOnce = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > 4_096) {
        child.kill("SIGKILL");
        rejectOnce(new Error("git identity 출력이 허용 크기를 초과했습니다."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(stderr).byteLength <= 4_096) {
        stderr.push(chunk.subarray(0, 4_096));
      }
    });
    child.once("error", (error) => rejectOnce(error));
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0 && signal === null) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(
        signal
          ? `git identity 점검이 ${signal} 신호로 종료됐습니다.`
          : `git identity 점검이 종료 코드 ${String(code)}로 끝났습니다.`
            + (stderr.length > 0
              ? `\n${Buffer.concat(stderr).toString("utf8").trim()}`
              : "")
      ));
    });
  });
}

async function assertReleaseSourceCommit(
  sourceRepositoryRoot: string,
  revision: string
): Promise<void> {
  const [type, trustedHead] = await Promise.all([
    runBoundedGit(sourceRepositoryRoot, ["cat-file", "-t", revision]),
    runBoundedGit(sourceRepositoryRoot, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}"
    ])
  ]);
  assertArtifact(
    type.equals(Buffer.from("commit\n", "utf8")),
    "release source.gitCommit이 실제 Git commit object가 아닙니다."
  );
  assertArtifact(
    trustedHead.equals(Buffer.from(`${revision}\n`, "utf8")),
    "release source.gitCommit이 이 checkout의 현재 trusted HEAD commit과 다릅니다."
  );
}

async function readStableArtifactFile(
  filePath: string,
  maximumBytes: number
): Promise<Buffer> {
  assertArtifact(
    await realpath(filePath) === filePath,
    `공개 배포 artifact 경로에 심볼릭 링크가 있습니다: ${filePath}`
  );
  const before = await lstat(filePath);
  assertArtifact(
    before.isFile()
      && !before.isSymbolicLink()
      && before.nlink === 1
      && (before.mode & 0o777) === 0o644
      && before.size >= 0
      && before.size <= maximumBytes,
    `공개 배포 artifact가 안전한 일반 파일이 아닙니다: ${filePath}`
  );
  const bytes = await readFile(filePath);
  const after = await lstat(filePath);
  assertArtifact(
    bytes.byteLength === before.size
      && after.isFile()
      && !after.isSymbolicLink()
      && after.nlink === 1
      && after.dev === before.dev
      && after.ino === before.ino
      && after.size === before.size
      && after.mtimeMs === before.mtimeMs
      && after.ctimeMs === before.ctimeMs,
    `검증 중 공개 배포 artifact가 바뀌었습니다: ${filePath}`
  );
  return bytes;
}

function decodeCanonicalUtf8(bytes: Buffer, label: string): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label}이 올바른 UTF-8이 아닙니다.`);
  }
  assertArtifact(
    Buffer.from(decoded, "utf8").equals(bytes),
    `${label}이 canonical UTF-8이 아닙니다.`
  );
  return decoded;
}

function parsePublicDeploymentZipCentralDirectory(
  archive: Buffer
): PublicDeploymentZipEntry[] {
  assertArtifact(archive.byteLength >= 22, "공개 배포 ZIP이 EOCD보다 짧습니다.");
  const eocdOffset = archive.byteLength - 22;
  assertArtifact(
    archive.readUInt32LE(eocdOffset) === 0x06054b50,
    "공개 배포 ZIP 끝에 주석 없는 EOCD가 없습니다."
  );
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntries = archive.readUInt16LE(eocdOffset + 8);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);
  assertArtifact(
    diskNumber === 0
      && centralDisk === 0
      && diskEntries === totalEntries
      && totalEntries === PUBLIC_DEPLOYMENT_ARCHIVE_ALLOWLIST.length
      && commentLength === 0
      && centralOffset + centralSize === eocdOffset,
    "공개 배포 ZIP이 단일 디스크·6개 엔트리·주석 없는 계약과 다릅니다."
  );
  assertArtifact(
    !archive.subarray(0, eocdOffset).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))
      && !archive.subarray(0, eocdOffset).includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])),
    "공개 배포 ZIP에 허용하지 않은 ZIP64 레코드가 있습니다."
  );

  const entries: PublicDeploymentZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assertArtifact(
      cursor + 46 <= eocdOffset
        && archive.readUInt32LE(cursor) === 0x02014b50,
      `공개 배포 ZIP 중앙 디렉터리 ${index + 1}번 엔트리가 손상됐습니다.`
    );
    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const startDisk = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + entryCommentLength;
    assertArtifact(
      entryEnd <= eocdOffset,
      "공개 배포 ZIP 중앙 엔트리 길이가 범위를 벗어났습니다."
    );
    const name = decodeCanonicalUtf8(
      archive.subarray(cursor + 46, cursor + 46 + nameLength),
      "공개 배포 ZIP 엔트리 이름"
    );
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    assertArtifact(
      creatorSystem === 3
        && (unixMode & 0o170000) === 0o100000
        && (flags & ~0x0800) === 0
        && (compressionMethod === 0 || compressionMethod === 8)
        && unixMode === 0o100644
        && compressedSize <= MAX_PUBLIC_DEPLOYMENT_ARCHIVE_BYTES
        && uncompressedSize <= MAX_PUBLIC_DEPLOYMENT_HTML_BYTES
        && nameLength > 0
        && extraLength === 0
        && entryCommentLength === 0
        && startDisk === 0
        && localHeaderOffset < centralOffset,
      `공개 배포 ZIP 엔트리가 regular·무암호화·bounded 계약과 다릅니다: ${name}`
    );
    entries.push({
      compressedSize,
      compressionMethod,
      crc32: checksum,
      flags,
      localHeaderOffset,
      name,
      unixMode,
      uncompressedSize
    });
    cursor = entryEnd;
  }
  assertArtifact(
    cursor === eocdOffset,
    "공개 배포 ZIP 중앙 디렉터리에 숨은 바이트가 있습니다."
  );
  return entries;
}

function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function readVerifiedPublicDeploymentZipEntries(
  archive: Buffer
): ReadonlyMap<string, Buffer> {
  const entries = parsePublicDeploymentZipCentralDirectory(archive);
  const names = entries.map(({ name }) => name).sort();
  assertArtifact(
    new Set(names).size === names.length
      && exactStringList(names, PUBLIC_DEPLOYMENT_ARCHIVE_ALLOWLIST),
    `공개 배포 ZIP 파일 목록이 allowlist와 다릅니다: ${JSON.stringify(names)}`
  );

  const bytesByName = new Map<string, Buffer>();
  const ordered = [...entries].sort((left, right) => (
    left.localHeaderOffset - right.localHeaderOffset
  ));
  let expectedLocalOffset = 0;
  for (const entry of ordered) {
    assertArtifact(
      entry.localHeaderOffset === expectedLocalOffset
        && entry.localHeaderOffset + 30 <= archive.byteLength
        && archive.readUInt32LE(entry.localHeaderOffset) === 0x04034b50,
      `공개 배포 ZIP 로컬 헤더 배열이 연속적이지 않습니다: ${entry.name}`
    );
    const flags = archive.readUInt16LE(entry.localHeaderOffset + 6);
    const compressionMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
    const localCrc32 = archive.readUInt32LE(entry.localHeaderOffset + 14);
    const compressedSize = archive.readUInt32LE(entry.localHeaderOffset + 18);
    const uncompressedSize = archive.readUInt32LE(entry.localHeaderOffset + 22);
    const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
    const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
    const nameStart = entry.localHeaderOffset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    assertArtifact(
      flags === entry.flags
        && compressionMethod === entry.compressionMethod
        && localCrc32 === entry.crc32
        && compressedSize === entry.compressedSize
        && uncompressedSize === entry.uncompressedSize
        && extraLength === 0
        && dataEnd <= archive.byteLength
        && decodeCanonicalUtf8(
          archive.subarray(nameStart, nameStart + nameLength),
          "공개 배포 ZIP 로컬 엔트리 이름"
        ) === entry.name,
      `공개 배포 ZIP 로컬 헤더와 중앙 디렉터리가 다릅니다: ${entry.name}`
    );
    const compressed = archive.subarray(dataStart, dataEnd);
    const bytes = entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, {
        maxOutputLength: MAX_PUBLIC_DEPLOYMENT_HTML_BYTES
      });
    assertArtifact(
      bytes.byteLength === entry.uncompressedSize
        && crc32(bytes) === entry.crc32,
      `공개 배포 ZIP 엔트리 크기 또는 CRC32가 다릅니다: ${entry.name}`
    );
    bytesByName.set(entry.name, bytes);
    expectedLocalOffset = dataEnd;
  }
  const centralOffset = archive.readUInt32LE(archive.byteLength - 22 + 16);
  assertArtifact(
    expectedLocalOffset === centralOffset,
    "공개 배포 ZIP 로컬 엔트리 뒤에 숨은 바이트가 있습니다."
  );
  return bytesByName;
}

/**
 * Loads the canonical release manifest, verifies both checksum sidecars, and
 * binds every ZIP entry to the manifest's exact Git commit blob and 100644
 * source mapping. Live HTML never supplies a URL to this allowlist.
 */
export async function loadCurrentPublicDeploymentArtifact(
  options: Readonly<PublicDeploymentCheckOptions> = {}
): Promise<
  readonly PublicDeploymentExpectedResource[]
> {
  const sourceRepositoryRoot = await realpath(
    options.repositoryRoot ?? repositoryRoot
  );
  const artifactDirectory = options.artifactDirectory
    ?? path.join(sourceRepositoryRoot, "dist");
  if (
    !path.isAbsolute(artifactDirectory)
    || path.resolve(artifactDirectory) !== artifactDirectory
    || artifactDirectory !== path.join(sourceRepositoryRoot, "dist")
  ) {
    throw new TypeError(
      "공개 배포 artifact 디렉터리는 canonical repository의 exact dist/여야 합니다."
    );
  }
  let canonicalArtifactDirectory: string;
  try {
    canonicalArtifactDirectory = await realpath(artifactDirectory);
  } catch (error) {
    throw new Error(
      "검증된 release manifest가 없습니다. 먼저 clean commit에서 npm run package를 실행하세요: "
        + (error instanceof Error ? error.message : String(error))
    );
  }
  assertArtifact(
    canonicalArtifactDirectory === artifactDirectory,
    "공개 배포 dist 경로에 심볼릭 링크가 있습니다."
  );

  const packagedFiles = [...PUBLIC_WEB_PACKAGE_FILES]
    .sort((left, right) => (
      left.archivePath < right.archivePath
        ? -1
        : left.archivePath > right.archivePath ? 1 : 0
    ));
  assertArtifact(
    JSON.stringify(packagedFiles.map(({ archivePath, sourcePath }) => ({
      archivePath,
      sourcePath
    }))) === JSON.stringify(PUBLIC_DEPLOYMENT_SOURCE_MAPPING),
    "공개 배포 source/archive mapping이 고정된 6개 allowlist와 다릅니다."
  );

  const distEntries = await readdir(artifactDirectory, { withFileTypes: true });
  const manifestNames = distEntries
    .filter((entry) => (
      entry.isFile()
      && /^kirinuki-release-v\d+\.\d+\.\d+\.json$/u.test(entry.name)
    ))
    .map(({ name }) => name);
  assertArtifact(
    manifestNames.length === 1,
    "검증된 release manifest가 exact dist/에 정확히 하나 있어야 합니다. "
      + "먼저 clean commit에서 npm run package를 실행하세요."
  );
  const manifestName = manifestNames[0]!;
  const manifestPath = path.join(artifactDirectory, manifestName);
  let manifestBytes: Buffer;
  let manifestChecksumBytes: Buffer;
  try {
    [manifestBytes, manifestChecksumBytes] = await Promise.all([
      readStableArtifactFile(manifestPath, MAX_PUBLIC_DEPLOYMENT_MANIFEST_BYTES),
      readStableArtifactFile(
        `${manifestPath}.sha256`,
        MAX_PUBLIC_DEPLOYMENT_CHECKSUM_BYTES
      )
    ]);
  } catch (error) {
    throw new Error(
      "검증된 release manifest와 checksum sidecar를 읽지 못했습니다. "
        + "먼저 clean commit에서 npm run package를 실행하세요: "
        + (error instanceof Error ? error.message : String(error))
    );
  }
  const manifestSha256 = sha256(manifestBytes);
  assertArtifact(
    parseSha256Sidecar(manifestChecksumBytes, manifestName) === manifestSha256,
    "release manifest SHA-256 sidecar가 manifest bytes와 다릅니다."
  );
  const releaseRecord = parseCanonicalReleaseRecord(manifestBytes, manifestName);
  await assertReleaseSourceCommit(
    sourceRepositoryRoot,
    releaseRecord.source.gitCommit
  );

  const [committedPackageJson, committedPackageLock] = await Promise.all([
    readPackageSourceFile({
      repositoryRoot: sourceRepositoryRoot,
      repositoryPath: "package.json",
      sourceRevision: releaseRecord.source.gitCommit
    }),
    readPackageSourceFile({
      repositoryRoot: sourceRepositoryRoot,
      repositoryPath: "package-lock.json",
      sourceRevision: releaseRecord.source.gitCommit
    })
  ]);
  assertArtifact(
    committedPackageJson.byteLength <= MAX_PUBLIC_DEPLOYMENT_HTML_BYTES
      && committedPackageLock.byteLength <= MAX_PUBLIC_DEPLOYMENT_HTML_BYTES,
    "release commit의 package identity 파일이 허용 크기를 초과했습니다."
  );
  const committedIdentity = parseKirinukiPackageIdentity(
    committedPackageJson,
    committedPackageLock
  );
  assertArtifact(
    committedIdentity.name === releaseRecord.product.name
      && committedIdentity.version === releaseRecord.product.version
      && sha256Bytes(committedPackageLock)
        === releaseRecord.source.packageLockSha256,
    "release manifest product/package-lock identity가 source.gitCommit과 다릅니다."
  );

  const archiveName = releaseRecord.artifacts.web.file;
  const archivePath = path.join(artifactDirectory, archiveName);
  let archive: Buffer;
  let checksumBytes: Buffer;
  try {
    [archive, checksumBytes] = await Promise.all([
      readStableArtifactFile(archivePath, MAX_PUBLIC_DEPLOYMENT_ARCHIVE_BYTES),
      readStableArtifactFile(
        `${archivePath}.sha256`,
        MAX_PUBLIC_DEPLOYMENT_CHECKSUM_BYTES
      )
    ]);
  } catch (error) {
    throw new Error(
      `release manifest가 지정한 공개 ZIP과 checksum을 읽지 못했습니다: `
        + (error instanceof Error ? error.message : String(error))
    );
  }
  const archiveSha256 = sha256(archive);
  assertArtifact(
    parseSha256Sidecar(checksumBytes, archiveName) === archiveSha256,
    "공개 배포 ZIP SHA-256 sidecar가 artifact bytes와 정확히 일치하지 않습니다."
  );
  assertArtifact(
    archive.byteLength === releaseRecord.artifacts.web.bytes
      && archiveSha256 === releaseRecord.artifacts.web.sha256
      && releaseRecord.artifacts.web.checksumFile === `${archiveName}.sha256`,
    "공개 ZIP의 exact path/size/SHA-256이 release manifest와 다릅니다."
  );
  const bytesByArchivePath = readVerifiedPublicDeploymentZipEntries(archive);

  const committedSources = await Promise.all(
    PUBLIC_DEPLOYMENT_SOURCE_MAPPING.map(async ({ archivePath: packagedPath, sourcePath }) => {
      const committedBytes = await readPackageSourceFile({
        repositoryRoot: sourceRepositoryRoot,
        repositoryPath: sourcePath,
        sourceRevision: releaseRecord.source.gitCommit
      });
      assertArtifact(
        committedBytes.byteLength > 0
          && committedBytes.byteLength <= MAX_PUBLIC_DEPLOYMENT_HTML_BYTES,
        `release commit의 공개 source 크기가 허용 범위를 벗어났습니다: ${sourcePath}`
      );
      const packagedBytes = bytesByArchivePath.get(packagedPath);
      assertArtifact(
        packagedBytes?.equals(committedBytes),
        `공개 ZIP ${packagedPath} bytes가 source.gitCommit의 100644 blob과 다릅니다: ${sourcePath}`
      );
      return [packagedPath, committedBytes] as const;
    })
  );
  assertArtifact(
    committedSources.length === PUBLIC_DEPLOYMENT_ARCHIVE_ALLOWLIST.length,
    "공개 ZIP과 release source mapping의 파일 수가 다릅니다."
  );

  const indexBytes = bytesByArchivePath.get("index.html");
  const stylesheetBytes = bytesByArchivePath.get("public.css");
  const headerBytes = bytesByArchivePath.get("_headers");
  const hostsBytes = bytesByArchivePath.get(".popovic-hosts");
  if (!indexBytes || !stylesheetBytes || !headerBytes || !hostsBytes) {
    throw new Error("공개 배포 artifact의 필수 identity 파일이 없습니다.");
  }
  const artifactSecurityHeaders = parsePublicShellHeaders(
    decodeCanonicalUtf8(headerBytes, "공개 배포 _headers")
  );
  if (
    decodeCanonicalUtf8(hostsBytes, "공개 배포 host identity")
      !== `${PUBLIC_SHELL_CANONICAL_HOST}\n`
  ) {
    throw new Error("공개 배포 artifact의 canonical host가 올바르지 않습니다.");
  }

  const indexHtml = decodeCanonicalUtf8(indexBytes, "공개 배포 index.html");
  const stylesheetMatches = [...indexHtml.matchAll(
    /<link\s+rel="stylesheet"\s+href="(\/public\.css\?v=(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)">/gu
  )];
  if (stylesheetMatches.length !== 1) {
    throw new Error(
      "공개 배포 artifact index에 canonical versioned stylesheet가 정확히 하나여야 합니다."
    );
  }
  const stylesheetPath = stylesheetMatches[0]?.[1];
  if (
    !stylesheetPath
    || stylesheetPath !== `/public.css?v=${releaseRecord.product.version}`
  ) {
    throw new Error("공개 배포 artifact stylesheet 경로를 읽지 못했습니다.");
  }
  const artifactDocumentHeaders = new Headers({
    ...artifactSecurityHeaders,
    "Content-Length": String(indexBytes.byteLength),
    "Content-Type": "text/html; charset=utf-8"
  });
  const artifactViolations = publicDeploymentViolations({
    body: indexHtml,
    finalUrl: PUBLIC_SHELL_CANONICAL_URL,
    headers: artifactDocumentHeaders,
    requestedUrl: PUBLIC_SHELL_CANONICAL_URL,
    status: 200
  });
  assertArtifact(
    artifactViolations.length === 0,
    `release commit의 공개 index.html이 shell-only 정책을 위반합니다:\n- `
      + artifactViolations.join("\n- ")
  );
  const stylesheet = decodeCanonicalUtf8(
    stylesheetBytes,
    "공개 배포 public.css"
  );
  assertArtifact(
    !/@import\b|url\s*\(|expression\s*\(|javascript\s*:|(?:127\.0\.0\.1|localhost|:4319|:4320|:4330|\/v1\/|editor\.html|\/editor\/|studio\.js|audseg-worker)/iu.test(
      stylesheet
    ),
    "release commit의 public.css에 외부 resource 또는 앱 내부 경로가 있습니다."
  );

  const descriptors = [
    {
      archivePath: "index.html",
      contentType: "text/html; charset=utf-8",
      requestPath: "/"
    },
    {
      archivePath: "public.css",
      contentType: "text/css; charset=utf-8",
      requestPath: stylesheetPath
    },
    {
      archivePath: "THIRD_PARTY_NOTICES.md",
      contentType: "text/markdown; charset=utf-8",
      requestPath: "/THIRD_PARTY_NOTICES.md"
    },
    {
      archivePath: "licenses/UNLICENSE.txt",
      contentType: "text/plain; charset=utf-8",
      requestPath: "/licenses/UNLICENSE.txt"
    }
  ] as const;
  return Object.freeze(descriptors.map((descriptor) => {
    const bytes = bytesByArchivePath.get(descriptor.archivePath);
    if (!bytes) {
      throw new Error(
        `공개 배포 artifact content 파일이 없습니다: ${descriptor.archivePath}`
      );
    }
    return Object.freeze({
      ...descriptor,
      bytes,
      sha256: sha256(bytes)
    });
  }));
}

export function parsePublicDeploymentUrl(value: unknown): string {
  const raw = String(value || "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("공개 배포 점검 URL이 올바르지 않습니다.");
  }
  if (
    raw !== PUBLIC_SHELL_CANONICAL_URL
    || parsed.protocol !== "https:"
    || parsed.hostname !== PUBLIC_SHELL_CANONICAL_HOST
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new TypeError(
      `공개 배포 점검은 정확히 ${PUBLIC_SHELL_CANONICAL_URL}만 허용합니다.`
    );
  }
  return parsed.href;
}

export function publicDeploymentCheckHelpText(): string {
  return `
Kirinuki 공개 배포 읽기 전용 점검

사용법:
  npm run public-shell:check
  npm run public-shell:check -- ${PUBLIC_SHELL_CANONICAL_URL}

정확한 공개 HTTPS 시작 화면과 고정된 공개 자산 allowlist만 GET해 보안 헤더,
무쿠키·무보고 헤더와 현재 공개 artifact의 exact bytes를 검사합니다.
다른 host·path·query나 live HTML이 새로 가리키는 자원은 요청하지 않습니다.
`.trim();
}

export function parsePublicDeploymentCheckArgs(
  argv: readonly unknown[] = []
): { readonly help: boolean; readonly url: string } {
  const values = argv.map((value) => String(value));
  if (values.length === 1 && ["-h", "--help"].includes(values[0]!)) {
    return Object.freeze({
      help: true,
      url: PUBLIC_SHELL_CANONICAL_URL
    });
  }
  if (values.length > 1 || values.some((value) => value.startsWith("-"))) {
    throw new TypeError(
      `사용법: check-public-deployment.ts [${PUBLIC_SHELL_CANONICAL_URL}]`
    );
  }
  return Object.freeze({
    help: false,
    url: parsePublicDeploymentUrl(values[0] ?? PUBLIC_SHELL_CANONICAL_URL)
  });
}

function responseHeaderValues(
  headers: PublicDeploymentSnapshot["headers"],
  name: string
): string[] {
  if (name.toLowerCase() === "set-cookie" && headers.getSetCookie) {
    return headers.getSetCookie();
  }
  const value = headers.get(name);
  return value === null ? [] : [value];
}

function publicDeploymentResponseMetadataViolations(
  snapshot: Readonly<PublicDeploymentResponseMetadata>,
  expectedUrl: string,
  expectedContentType: string
): string[] {
  const violations: string[] = [];
  if (snapshot.requestedUrl !== expectedUrl) {
    violations.push("요청 URL이 공개 artifact allowlist와 다릅니다.");
  }
  if (snapshot.finalUrl !== expectedUrl) {
    violations.push("응답이 다른 URL로 redirect됐습니다.");
  }
  if (snapshot.status !== 200) {
    violations.push(`HTTP 상태가 200이 아닙니다: ${snapshot.status}`);
  }
  for (const [name, expectedValue] of Object.entries(
    PUBLIC_SHELL_SECURITY_HEADERS
  )) {
    if (snapshot.headers.get(name) !== expectedValue) {
      violations.push(`${name} 헤더가 공개 shell 계약과 다릅니다.`);
    }
  }
  for (const forbiddenHeader of [
    "set-cookie",
    "set-cookie2",
    "nel",
    "report-to",
    "reporting-endpoints",
    "refresh",
    "content-security-policy-report-only",
    "access-control-allow-origin"
  ]) {
    if (responseHeaderValues(snapshot.headers, forbiddenHeader).length > 0) {
      violations.push(`${forbiddenHeader} 응답 헤더가 없어야 합니다.`);
    }
  }
  if (snapshot.headers.get("content-type") !== expectedContentType) {
    violations.push("Content-Type이 공개 artifact 계약과 다릅니다.");
  }
  const declaredLength = snapshot.headers.get("content-length");
  if (
    declaredLength !== null
    && (
      !/^(?:0|[1-9]\d*)$/u.test(declaredLength)
      || Number(declaredLength) > MAX_PUBLIC_DEPLOYMENT_HTML_BYTES
    )
  ) {
    violations.push("Content-Length 형식 또는 크기가 허용 범위를 벗어났습니다.");
  }
  return violations;
}

export function publicDeploymentViolations(
  snapshot: Readonly<PublicDeploymentSnapshot>
): string[] {
  const violations = publicDeploymentResponseMetadataViolations(
    snapshot,
    PUBLIC_SHELL_CANONICAL_URL,
    "text/html; charset=utf-8"
  );
  const actualBytes = Buffer.byteLength(snapshot.body, "utf8");
  if (actualBytes === 0 || actualBytes > MAX_PUBLIC_DEPLOYMENT_HTML_BYTES) {
    violations.push("공개 HTML 본문 크기가 허용 범위를 벗어났습니다.");
  }

  const body = snapshot.body;
  if (/<script\b/iu.test(body)) {
    violations.push("공개 HTML에 script가 주입됐습니다.");
  }
  if (
    /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh\b))[^>]*>/iu.test(
      body
    )
  ) {
    violations.push("공개 HTML에 meta refresh가 주입됐습니다.");
  }
  if (
    /<(?:img|iframe|object|embed|video|audio|source|track|use|image|form|base|style)\b/iu.test(
      body
    )
  ) {
    violations.push("공개 HTML에 허용하지 않은 resource-bearing element가 있습니다.");
  }
  const linkTags = body.match(/<link\b[^>]*>/giu) || [];
  const hasExactIcon = linkTags.filter((tag) => (
    /^<link rel="icon" href="data:image\/svg\+xml,[^"]+">$/u.test(tag)
  )).length === 1;
  const hasExactStylesheet = linkTags.filter((tag) => (
    /^<link rel="stylesheet" href="\/public\.css\?v=\d+\.\d+\.\d+">$/u.test(tag)
  )).length === 1;
  if (linkTags.length !== 2 || !hasExactIcon || !hasExactStylesheet) {
    violations.push("공개 HTML의 link element allowlist가 정확하지 않습니다.");
  }
  if (
    /email-decode(?:\.min)?\.js|\/cdn-cgi\/l\/email-protection|data-cfemail/iu.test(body)
  ) {
    violations.push("Cloudflare 이메일 난독화 코드가 주입됐습니다.");
  }
  if (
    /(?:127\.0\.0\.1|localhost|:4319|:4320|:4330|\/v1\/|editor\.html|\/editor\/|studio\.js|audseg-worker)/iu.test(body)
  ) {
    violations.push("공개 HTML에 앱 내부 endpoint 또는 editor 경로가 있습니다.");
  }
  if (
    /googletagmanager|google-analytics|plausible\.io|posthog|segment\.com/iu.test(body)
  ) {
    violations.push("공개 HTML에 analytics 코드가 있습니다.");
  }
  if (
    !body.includes('class="public-launch-shell"')
    || !body.includes('href="kirinuki://open"')
    || !body.includes('href="mailto:lostfragment@naver.com"')
  ) {
    violations.push("공개 HTML의 앱 실행·문의 shell marker가 없습니다.");
  }
  return violations;
}

export function validatePublicDeploymentSnapshot(
  snapshot: Readonly<PublicDeploymentSnapshot>
): PublicDeploymentCheckResult {
  const violations = publicDeploymentViolations(snapshot);
  if (violations.length > 0) {
    throw new Error(
      `공개 배포 점검에 실패했습니다:\n- ${violations.join("\n- ")}`
    );
  }
  return Object.freeze({
    bytes: Buffer.byteLength(snapshot.body, "utf8"),
    status: 200 as const,
    url: PUBLIC_SHELL_CANONICAL_URL
  });
}

async function cancelPublicDeploymentResponse(
  response: Pick<Response, "body">,
  controller: AbortController,
  reason: Error
): Promise<void> {
  await response.body?.cancel(reason).catch(() => undefined);
  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
}

async function readBoundedPublicDeploymentBody(
  response: Pick<Response, "body" | "headers">,
  controller: AbortController,
  resourceLabel: string
): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (
      !/^(?:0|[1-9]\d*)$/u.test(declaredLength)
      || Number(declaredLength) > MAX_PUBLIC_DEPLOYMENT_HTML_BYTES
    )
  ) {
    const reason = new Error(
      `${resourceLabel} 응답은 1 MiB 크기 제한을 충족하지 않습니다.`
    );
    await cancelPublicDeploymentResponse(response, controller, reason);
    throw reason;
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  const cancelOnAbort = (): void => {
    void reader.cancel(controller.signal.reason).catch(() => undefined);
  };
  controller.signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (chunk.value.byteLength === 0) {
        continue;
      }
      if (
        chunk.value.byteLength > MAX_PUBLIC_DEPLOYMENT_HTML_BYTES - receivedBytes
      ) {
        const reason = new Error(
          `${resourceLabel} 응답이 1 MiB 크기 제한을 초과했습니다.`
        );
        await reader.cancel(reason).catch(() => undefined);
        if (!controller.signal.aborted) {
          controller.abort(reason);
        }
        throw reason;
      }
      receivedBytes += chunk.value.byteLength;
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    controller.signal.removeEventListener("abort", cancelOnAbort);
    try {
      reader.releaseLock();
    } catch {
      // 이미 cancel된 stream도 요청 전체 실패로 처리되므로 별도 복구가 없다.
    }
  }
  return Buffer.concat(chunks, receivedBytes);
}

async function failClosedOnResponseMetadata(
  response: Response,
  controller: AbortController,
  resource: PublicDeploymentExpectedResource,
  requestedUrl: string
): Promise<void> {
  const violations = publicDeploymentResponseMetadataViolations({
    finalUrl: response.url,
    headers: response.headers,
    requestedUrl,
    status: response.status
  }, requestedUrl, resource.contentType);
  if (violations.length === 0) {
    return;
  }
  const reason = new Error(
    `공개 배포 ${resource.archivePath} 응답 계약이 다릅니다:\n- `
      + violations.join("\n- ")
  );
  await cancelPublicDeploymentResponse(response, controller, reason);
  throw reason;
}

export async function checkPublicDeployment(
  url = PUBLIC_SHELL_CANONICAL_URL,
  fetchImplementation: typeof fetch = fetch,
  options: Readonly<PublicDeploymentCheckOptions> = {}
): Promise<PublicDeploymentCheckResult> {
  const target = parsePublicDeploymentUrl(url);
  const expectedResources = await loadCurrentPublicDeploymentArtifact(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("공개 배포 점검 시간이 15초를 초과했습니다."));
  }, 15_000);
  try {
    let rootResult: PublicDeploymentCheckResult | null = null;
    for (const resource of expectedResources) {
      const requestedUrl = new URL(resource.requestPath, target).href;
      const response = await fetchImplementation(requestedUrl, {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: resource.contentType.split(";", 1)[0] || "*/*",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        },
        method: "GET",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      await failClosedOnResponseMetadata(
        response,
        controller,
        resource,
        requestedUrl
      );
      const bytes = await readBoundedPublicDeploymentBody(
        response,
        controller,
        resource.archivePath
      );
      const actualSha256 = sha256(bytes);
      if (
        bytes.byteLength !== resource.bytes.byteLength
        || actualSha256 !== resource.sha256
      ) {
        throw new Error(
          `공개 배포 ${resource.archivePath} bytes가 현재 공개 artifact와 다릅니다: `
            + `expected=${resource.sha256}, actual=${actualSha256}`
        );
      }

      if (resource.archivePath === "index.html") {
        let body: string;
        try {
          body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error("공개 배포 index.html이 올바른 UTF-8이 아닙니다.");
        }
        rootResult = validatePublicDeploymentSnapshot({
          body,
          finalUrl: response.url,
          headers: response.headers,
          requestedUrl,
          status: response.status
        });
      }
    }
    if (!rootResult) {
      throw new Error("공개 배포 artifact에 index.html 검증 결과가 없습니다.");
    }
    return rootResult;
  } finally {
    clearTimeout(timeout);
  }
}

function isDirectExecution(
  moduleUrl: string,
  argvEntry: string | undefined
): boolean {
  return argvEntry !== undefined
    && path.resolve(argvEntry) === fileURLToPath(moduleUrl);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    const options = parsePublicDeploymentCheckArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${publicDeploymentCheckHelpText()}\n`);
    } else {
      const result = await checkPublicDeployment(options.url);
      process.stdout.write(`${JSON.stringify({
        ...result,
        privacyHeaders: "absent",
        securityHeaders: "exact"
      }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
