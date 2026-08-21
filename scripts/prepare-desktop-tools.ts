import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

import {
  DESKTOP_PACKAGED_TARGETS,
  DESKTOP_TOOL_MANIFEST_SCHEMA,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import type {
  DesktopToolArtifact,
  DesktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactsRoot = path.join(root, ".artifacts", "desktop-tools");
const MAX_COMPRESSED_TOOL_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_TOOL_BYTES = 128 * 1024 * 1024;

export type DesktopToolArtifactRole =
  | "ffmpeg"
  | "ffprobe"
  | "ffmpegLicense"
  | "ytDlp";

function desktopToolArtifacts(
  manifest: Readonly<DesktopToolTargetManifest>
): readonly Readonly<{
  role: DesktopToolArtifactRole;
  artifact: Readonly<DesktopToolArtifact>;
}>[] {
  return Object.freeze([
    Object.freeze({ role: "ffmpeg" as const, artifact: manifest.ffmpeg }),
    Object.freeze({ role: "ffprobe" as const, artifact: manifest.ffprobe }),
    Object.freeze({
      role: "ffmpegLicense" as const,
      artifact: manifest.ffmpegLicense
    }),
    Object.freeze({ role: "ytDlp" as const, artifact: manifest.ytDlp })
  ]);
}

export function expectedDesktopToolArtifactMode(
  target: DesktopBundleTarget | string,
  role: DesktopToolArtifactRole
): number | undefined {
  if (String(target).startsWith("win32-")) {
    return undefined;
  }
  return role === "ffmpegLicense" ? 0o600 : 0o700;
}

export function desktopToolArtifactModeIsReady(
  target: DesktopBundleTarget | string,
  role: DesktopToolArtifactRole,
  mode: number
): boolean {
  const expectedMode = expectedDesktopToolArtifactMode(target, role);
  if (expectedMode === undefined) {
    return true;
  }
  if (!Number.isSafeInteger(mode) || mode < 0) {
    return false;
  }
  return (mode & 0o777) === expectedMode;
}

function requiredTarget(value: unknown): DesktopBundleTarget {
  const target = String(value || `${process.platform}-${process.arch}`);
  if (!(DESKTOP_PACKAGED_TARGETS as readonly string[]).includes(target)) {
    throw new TypeError(
      `지원하는 데스크톱 도구 대상이 아닙니다: ${target}. `
      + `지원: ${DESKTOP_PACKAGED_TARGETS.join(", ")}`
    );
  }
  return target as DesktopBundleTarget;
}

function assertSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("데스크톱 도구 SHA-256 manifest가 올바르지 않습니다.");
  }
}

async function sha256OpenFile(handle: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) {
      break;
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function validArtifact(
  directory: string,
  artifact: Readonly<DesktopToolArtifact>
): Promise<boolean> {
  assertSha256(artifact.sha256);
  const filePath = path.join(directory, artifact.fileName);
  try {
    const metadata = await lstat(filePath);
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.size !== artifact.size
    ) {
      return false;
    }
    const handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
    );
    try {
      const openedMetadata = await handle.stat();
      return openedMetadata.isFile()
        && openedMetadata.size === artifact.size
        && await sha256OpenFile(handle) === artifact.sha256;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function targetContentReady(
  directory: string,
  manifest: Readonly<DesktopToolTargetManifest>
): Promise<boolean> {
  let recorded: unknown;
  try {
    recorded = JSON.parse(await readFile(
      path.join(directory, "manifest.json"),
      "utf8"
    ));
  } catch {
    return false;
  }
  if (JSON.stringify(recorded) !== JSON.stringify(manifest)) {
    return false;
  }
  return (await Promise.all(desktopToolArtifacts(manifest).map(
    ({ artifact }) => validArtifact(directory, artifact)
  ))).every(Boolean);
}

async function targetModesReady(
  directory: string,
  manifest: Readonly<DesktopToolTargetManifest>
): Promise<boolean> {
  try {
    const results = await Promise.all(desktopToolArtifacts(manifest).map(
      async ({ role, artifact }) => {
        const metadata = await lstat(path.join(directory, artifact.fileName));
        return metadata.isFile()
          && !metadata.isSymbolicLink()
          && desktopToolArtifactModeIsReady(
            manifest.target,
            role,
            metadata.mode
          );
      }
    ));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

async function repairVerifiedDesktopToolModes(
  directory: string,
  manifest: Readonly<DesktopToolTargetManifest>
): Promise<boolean> {
  if (manifest.target.startsWith("win32-")) {
    return true;
  }
  for (const { role, artifact } of desktopToolArtifacts(manifest)) {
    const handle = await open(
      path.join(directory, artifact.fileName),
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
    );
    try {
      const metadata = await handle.stat();
      if (
        !metadata.isFile()
        || metadata.nlink !== 1
        || metadata.size !== artifact.size
        || await sha256OpenFile(handle) !== artifact.sha256
      ) {
        return false;
      }
      const expectedMode = expectedDesktopToolArtifactMode(
        manifest.target,
        role
      );
      if (expectedMode === undefined) {
        return false;
      }
      await handle.chmod(expectedMode);
    } finally {
      await handle.close();
    }
  }
  return true;
}

/**
 * Validates a complete cache and repairs only permission metadata on verified,
 * singly-linked POSIX artifacts. It never downloads and is safe to exercise in
 * focused filesystem tests.
 */
export async function ensureDesktopToolCacheReady(
  directory: string,
  manifest: Readonly<DesktopToolTargetManifest>
): Promise<boolean> {
  if (!await targetContentReady(directory, manifest)) {
    return false;
  }
  if (await targetModesReady(directory, manifest)) {
    return true;
  }
  if (!await repairVerifiedDesktopToolModes(directory, manifest)) {
    return false;
  }
  return await targetContentReady(directory, manifest)
    && await targetModesReady(directory, manifest);
}

function assertTrustedDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || ![
      "github.com",
      "raw.githubusercontent.com",
      "release-assets.githubusercontent.com"
    ].includes(url.hostname)
  ) {
    throw new Error("데스크톱 도구 다운로드가 허용된 GitHub HTTPS 경계를 벗어났습니다.");
  }
  return url;
}

async function downloadArtifact(
  directory: string,
  artifact: Readonly<DesktopToolArtifact>
): Promise<void> {
  assertSha256(artifact.sha256);
  if (
    !Number.isSafeInteger(artifact.size)
    || artifact.size <= 0
    || artifact.size > MAX_UNCOMPRESSED_TOOL_BYTES
    || (
      artifact.compression === "gzip"
      && (
        !Number.isSafeInteger(artifact.compressedSize)
        || Number(artifact.compressedSize) <= 0
        || Number(artifact.compressedSize) > MAX_COMPRESSED_TOOL_BYTES
      )
    )
  ) {
    throw new TypeError(`데스크톱 도구 크기 manifest가 올바르지 않습니다: ${artifact.fileName}`);
  }
  const requestUrl = assertTrustedDownloadUrl(artifact.url);
  const response = await fetch(requestUrl, {
    redirect: "follow",
    headers: Object.freeze({
      "Accept-Encoding": "identity"
    }),
    signal: AbortSignal.timeout(10 * 60_000)
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `데스크톱 도구 다운로드 실패: ${artifact.fileName} (${response.status})`
    );
  }
  assertTrustedDownloadUrl(response.url);
  const expectedWireBytes = artifact.compression === "gzip"
    ? Number(artifact.compressedSize)
    : artifact.size;
  const advertisedLength = response.headers.get("content-length");
  if (
    advertisedLength !== null
    && Number(advertisedLength) !== expectedWireBytes
  ) {
    throw new Error(`데스크톱 도구 응답 크기가 manifest와 다릅니다: ${artifact.fileName}`);
  }

  let wireBytes = 0;
  let outputBytes = 0;
  const hash = createHash("sha256");
  const boundWire = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      wireBytes += chunk.byteLength;
      callback(
        wireBytes <= expectedWireBytes
          ? null
          : new Error(`압축 도구가 크기 상한을 넘었습니다: ${artifact.fileName}`),
        chunk
      );
    }
  });
  const verifyOutput = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      outputBytes += chunk.byteLength;
      if (outputBytes > artifact.size) {
        callback(new Error(`도구가 해제 크기 상한을 넘었습니다: ${artifact.fileName}`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const destination = path.join(directory, artifact.fileName);
  const streams = [
    Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream<Uint8Array>
    ),
    boundWire,
    ...(artifact.compression === "gzip" ? [createGunzip()] : []),
    verifyOutput,
    createWriteStream(destination, { flags: "wx", mode: 0o600 })
  ];
  await pipeline(streams);
  if (
    wireBytes !== expectedWireBytes
    || outputBytes !== artifact.size
    || hash.digest("hex") !== artifact.sha256
  ) {
    await rm(destination, { force: true });
    throw new Error(`데스크톱 도구 SHA-256 또는 크기 검증 실패: ${artifact.fileName}`);
  }
  await chmod(destination, artifact.fileName === "FFMPEG-LICENSE.txt" ? 0o600 : 0o700);
}

export async function prepareDesktopTools(
  targetInput: DesktopBundleTarget | string = `${process.platform}-${process.arch}`
): Promise<string> {
  const target = requiredTarget(targetInput);
  const manifest = desktopToolTargetManifest(target);
  if (manifest.schema !== DESKTOP_TOOL_MANIFEST_SCHEMA) {
    throw new Error("데스크톱 도구 manifest schema가 올바르지 않습니다.");
  }
  const targetDirectory = path.join(artifactsRoot, target);
  if (await ensureDesktopToolCacheReady(targetDirectory, manifest).catch(
    () => false
  )) {
    return targetDirectory;
  }
  await mkdir(artifactsRoot, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    artifactsRoot,
    `.stage-${target}-${process.pid}-${randomBytes(8).toString("hex")}`
  );
  await mkdir(temporary, { mode: 0o700 });
  try {
    await Promise.all([
      downloadArtifact(temporary, manifest.ffmpeg),
      downloadArtifact(temporary, manifest.ffprobe),
      downloadArtifact(temporary, manifest.ffmpegLicense),
      downloadArtifact(temporary, manifest.ytDlp)
    ]);
    await writeFile(
      path.join(temporary, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", mode: 0o600 }
    );
    if (!await ensureDesktopToolCacheReady(temporary, manifest)) {
      throw new Error("준비한 데스크톱 도구를 최종 검증하지 못했습니다.");
    }
    const displaced = `${targetDirectory}.old-${randomBytes(8).toString("hex")}`;
    try {
      await rename(targetDirectory, displaced);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    try {
      await rename(temporary, targetDirectory);
    } catch (error) {
      await rename(displaced, targetDirectory).catch(() => undefined);
      throw error;
    }
    await rm(displaced, { recursive: true, force: true });
    return targetDirectory;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const target = requiredTarget(process.argv[2]);
  if (process.argv.length > 3) {
    throw new TypeError("사용법: prepare-desktop-tools.ts [platform-arch]");
  }
  console.log(await prepareDesktopTools(target));
}
