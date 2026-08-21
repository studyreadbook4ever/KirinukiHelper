import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { readPackageSourceFile } from "./package-source-reader.js";

export const KIRINUKI_PACKAGE_NAME = "kirinuki-app";
export const KIRINUKI_RELEASE_SCHEMA_VERSION = 2;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;

export interface KirinukiPackageIdentity {
  readonly name: typeof KIRINUKI_PACKAGE_NAME;
  readonly version: string;
}

export interface KirinukiReleaseArtifact {
  readonly bytes: number;
  readonly checksumFile: string;
  readonly file: string;
  readonly sha256: string;
}

export interface KirinukiReleaseRecord {
  readonly schemaVersion: typeof KIRINUKI_RELEASE_SCHEMA_VERSION;
  readonly product: KirinukiPackageIdentity;
  readonly source: {
    readonly gitCommit: string;
    readonly packageLockSha256: string;
  };
  readonly artifacts: {
    readonly web: KirinukiReleaseArtifact;
  };
}

export interface WriteKirinukiReleaseRecordOptions {
  readonly distDirectory: string;
  readonly expectedArtifacts: {
    readonly web: KirinukiReleaseArtifact;
  };
  readonly expectedPackageLockSha256: string;
  readonly repositoryRoot: string;
  readonly sourceRevision: string;
}

export interface WrittenKirinukiReleaseRecord {
  readonly bytes: number;
  readonly checksum: string;
  readonly manifest: string;
  readonly record: KirinukiReleaseRecord;
  readonly sha256: string;
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

function parseJsonObject(content: Uint8Array | string, label: string): Record<string, unknown> {
  const text = typeof content === "string"
    ? content
    : Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("utf8");
  try {
    return asRecord(JSON.parse(text) as unknown, label);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label}가 유효한 JSON이 아닙니다.`, { cause: error });
    }
    throw error;
  }
}

export function parseKirinukiPackageIdentity(
  packageJsonContent: Uint8Array | string,
  packageLockContent: Uint8Array | string
): KirinukiPackageIdentity {
  const packageJson = parseJsonObject(packageJsonContent, "package.json");
  const packageLock = parseJsonObject(packageLockContent, "package-lock.json");
  invariant(
    packageJson.name === KIRINUKI_PACKAGE_NAME,
    `package.json name은 ${KIRINUKI_PACKAGE_NAME}이어야 합니다.`
  );
  invariant(
    typeof packageJson.version === "string" && SEMVER_PATTERN.test(packageJson.version),
    "package.json version이 유효한 semver가 아닙니다."
  );
  const lockPackages = asRecord(packageLock.packages, "package-lock.json packages");
  const lockRoot = asRecord(lockPackages[""], "package-lock.json root package");
  invariant(
    packageLock.name === packageJson.name
      && packageLock.version === packageJson.version
      && lockRoot.name === packageJson.name
      && lockRoot.version === packageJson.version,
    "package-lock.json의 root name/version이 package.json과 정확히 일치하지 않습니다."
  );
  return {
    name: KIRINUKI_PACKAGE_NAME,
    version: packageJson.version
  };
}

export function sha256Bytes(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

export function parseSha256Sidecar(
  content: Uint8Array | string,
  expectedFilename: string
): string {
  invariant(
    path.basename(expectedFilename) === expectedFilename
      && expectedFilename.length > 0
      && !/[\u0000-\u001f\u007f]/u.test(expectedFilename),
    "checksum 대상 파일명은 안전한 basename이어야 합니다."
  );
  const text = typeof content === "string"
    ? content
    : Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("utf8");
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\n$/u.exec(text);
  invariant(match, "SHA-256 sidecar가 정확한 '<digest>  <filename>\\n' 형식이 아닙니다.");
  invariant(
    match[2] === expectedFilename,
    `SHA-256 sidecar의 파일명이 다릅니다: ${String(match[2])}`
  );
  return match[1]!;
}

function assertSafeArtifactFilename(filename: string): void {
  invariant(
    filename.length > 0
      && path.basename(filename) === filename
      && !/[\u0000-\u001f\u007f]/u.test(filename),
    `릴리스 artifact 파일명이 안전하지 않습니다: ${JSON.stringify(filename)}`
  );
}

async function assertRegularFile(filePath: string, label: string): Promise<number> {
  const metadata = await lstat(filePath);
  invariant(metadata.isFile(), `${label}가 일반 파일이 아닙니다: ${filePath}`);
  return metadata.size;
}

export async function inspectChecksummedArtifact(
  distDirectory: string,
  filename: string
): Promise<KirinukiReleaseArtifact> {
  assertSafeArtifactFilename(filename);
  const artifactPath = path.join(distDirectory, filename);
  const checksumFilename = `${filename}.sha256`;
  const checksumPath = path.join(distDirectory, checksumFilename);
  const bytes = await assertRegularFile(artifactPath, "릴리스 artifact");
  await assertRegularFile(checksumPath, "릴리스 checksum sidecar");
  const [actualDigest, sidecar] = await Promise.all([
    sha256File(artifactPath),
    readFile(checksumPath)
  ]);
  const declaredDigest = parseSha256Sidecar(sidecar, filename);
  invariant(
    declaredDigest === actualDigest,
    `릴리스 artifact와 SHA-256 sidecar가 다릅니다: ${filename}`
  );
  return {
    bytes,
    checksumFile: checksumFilename,
    file: filename,
    sha256: actualDigest
  };
}

export function buildKirinukiReleaseRecord({
  identity,
  packageLockSha256,
  sourceRevision,
  web
}: {
  readonly identity: KirinukiPackageIdentity;
  readonly packageLockSha256: string;
  readonly sourceRevision: string;
  readonly web: KirinukiReleaseArtifact;
}): KirinukiReleaseRecord {
  invariant(identity.name === KIRINUKI_PACKAGE_NAME, "릴리스 제품명이 올바르지 않습니다.");
  invariant(SEMVER_PATTERN.test(identity.version), "릴리스 버전이 유효한 semver가 아닙니다.");
  invariant(GIT_COMMIT_PATTERN.test(sourceRevision), "릴리스 git commit SHA가 올바르지 않습니다.");
  invariant(SHA256_PATTERN.test(packageLockSha256), "package-lock SHA-256이 올바르지 않습니다.");
  const expectedWebFilename = `kirinuki-web-v${identity.version}.zip`;
  for (const [label, artifact, expectedFilename] of [
    ["web", web, expectedWebFilename]
  ] as const) {
    invariant(artifact.file === expectedFilename, `${label} artifact 이름과 제품 버전이 다릅니다.`);
    invariant(
      artifact.checksumFile === `${expectedFilename}.sha256`,
      `${label} checksum 파일명이 artifact와 다릅니다.`
    );
    invariant(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, `${label} 크기가 올바르지 않습니다.`);
    invariant(SHA256_PATTERN.test(artifact.sha256), `${label} SHA-256이 올바르지 않습니다.`);
  }
  return {
    schemaVersion: KIRINUKI_RELEASE_SCHEMA_VERSION,
    product: {
      name: KIRINUKI_PACKAGE_NAME,
      version: identity.version
    },
    source: {
      gitCommit: sourceRevision,
      packageLockSha256
    },
    artifacts: {
      web
    }
  };
}

export function serializeKirinukiReleaseRecord(record: KirinukiReleaseRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function assertArtifactMatches(
  actual: KirinukiReleaseArtifact,
  expected: KirinukiReleaseArtifact,
  label: string
): void {
  invariant(
    actual.bytes === expected.bytes
      && actual.checksumFile === expected.checksumFile
      && actual.file === expected.file
      && actual.sha256 === expected.sha256,
    `${label} artifact가 packager가 보고한 bytes/SHA-256과 다릅니다.`
  );
}

async function writeAtomicFile(destination: string, content: Uint8Array | string): Promise<void> {
  const parent = path.dirname(destination);
  const temporaryDirectory = await mkdtemp(path.join(parent, ".kirinuki-release-record-"));
  const temporaryPath = path.join(temporaryDirectory, path.basename(destination));
  try {
    await writeFile(temporaryPath, content, { flag: "wx", mode: 0o644 });
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, destination);
    await chmod(destination, 0o644);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function writeKirinukiReleaseRecord({
  distDirectory,
  expectedArtifacts,
  expectedPackageLockSha256,
  repositoryRoot,
  sourceRevision
}: WriteKirinukiReleaseRecordOptions): Promise<WrittenKirinukiReleaseRecord> {
  invariant(GIT_COMMIT_PATTERN.test(sourceRevision), "릴리스 git commit SHA가 올바르지 않습니다.");
  invariant(
    SHA256_PATTERN.test(expectedPackageLockSha256),
    "기대 package-lock SHA-256이 올바르지 않습니다."
  );
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const requestedDistDirectory = path.resolve(distDirectory);
  invariant(
    requestedDistDirectory === path.join(canonicalRepositoryRoot, "dist"),
    "릴리스 manifest는 canonical repository root의 dist/에만 쓸 수 있습니다."
  );
  await mkdir(requestedDistDirectory, { recursive: true });
  invariant(
    await realpath(requestedDistDirectory) === requestedDistDirectory,
    `릴리스 dist 경로에 심볼릭 링크가 포함되어 있습니다: ${requestedDistDirectory}`
  );
  const [packageJsonContent, packageLockContent] = await Promise.all([
    readPackageSourceFile({
      repositoryRoot: canonicalRepositoryRoot,
      repositoryPath: "package.json",
      sourceRevision
    }),
    readPackageSourceFile({
      repositoryRoot: canonicalRepositoryRoot,
      repositoryPath: "package-lock.json",
      sourceRevision
    })
  ]);
  const identity = parseKirinukiPackageIdentity(packageJsonContent, packageLockContent);
  invariant(
    sha256Bytes(packageLockContent) === expectedPackageLockSha256,
    "release commit의 package-lock.json이 릴리스 시작 시 고정한 source snapshot과 다릅니다."
  );
  const web = await inspectChecksummedArtifact(
    requestedDistDirectory,
    `kirinuki-web-v${identity.version}.zip`
  );
  assertArtifactMatches(web, expectedArtifacts.web, "공개 web");
  const record = buildKirinukiReleaseRecord({
    identity,
    packageLockSha256: expectedPackageLockSha256,
    sourceRevision,
    web
  });
  const manifestFilename = `kirinuki-release-v${identity.version}.json`;
  const checksumFilename = `${manifestFilename}.sha256`;
  const manifestPath = path.join(requestedDistDirectory, manifestFilename);
  const checksumPath = path.join(requestedDistDirectory, checksumFilename);
  const serialized = serializeKirinukiReleaseRecord(record);
  const manifestDigest = sha256Bytes(serialized);
  await writeAtomicFile(manifestPath, serialized);
  await writeAtomicFile(checksumPath, `${manifestDigest}  ${manifestFilename}\n`);

  const [
    readbackManifest,
    readbackChecksum,
    manifestMetadata,
    checksumMetadata
  ] = await Promise.all([
    readFile(manifestPath),
    readFile(checksumPath),
    lstat(manifestPath),
    lstat(checksumPath)
  ]);
  for (const [label, metadata] of [
    ["릴리스 manifest", manifestMetadata],
    ["릴리스 manifest checksum", checksumMetadata]
  ] as const) {
    invariant(
      metadata.isFile()
        && !metadata.isSymbolicLink()
        && metadata.nlink === 1
        && (metadata.mode & 0o777) === 0o644,
      `${label}가 0644 regular single-link 파일이 아닙니다.`
    );
  }
  invariant(
    readbackManifest.toString("utf8") === serialized,
    "릴리스 manifest readback이 작성한 canonical JSON과 다릅니다."
  );
  invariant(
    sha256Bytes(readbackManifest) === manifestDigest,
    "릴리스 manifest readback SHA-256이 다릅니다."
  );
  invariant(
    parseSha256Sidecar(readbackChecksum, manifestFilename) === manifestDigest,
    "릴리스 manifest checksum readback이 다릅니다."
  );
  const parsedReadback = parseJsonObject(readbackManifest, "릴리스 manifest");
  invariant(
    JSON.stringify(parsedReadback) === JSON.stringify(record),
    "릴리스 manifest JSON readback이 기대한 record와 다릅니다."
  );
  const expectedReleaseFiles = [
    web.file,
    web.checksumFile,
    manifestFilename,
    checksumFilename
  ].sort();
  const actualReleaseFiles = (await readdir(requestedDistDirectory, {
    withFileTypes: true
  })).map((entry) => {
    invariant(entry.isFile(), `릴리스 dist에는 일반 파일만 있어야 합니다: ${entry.name}`);
    return entry.name;
  }).sort();
  invariant(
    JSON.stringify(actualReleaseFiles) === JSON.stringify(expectedReleaseFiles),
    "릴리스 dist 파일 목록이 현재 버전의 web/manifest와 각 checksum 4개로 정확히 닫혀 있지 않습니다."
  );

  return {
    bytes: manifestMetadata.size,
    checksum: path.relative(canonicalRepositoryRoot, checksumPath).split(path.sep).join("/"),
    manifest: path.relative(canonicalRepositoryRoot, manifestPath).split(path.sep).join("/"),
    record,
    sha256: manifestDigest
  };
}
