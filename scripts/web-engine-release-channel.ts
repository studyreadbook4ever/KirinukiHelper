import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  realpath
} from "node:fs/promises";
import path from "node:path";

import {
  DESKTOP_PUBLIC_RELEASE_ASSET_FILES,
  DESKTOP_RELEASE_MANIFEST_FILE
} from "../src/desktop/installer-contract.js";
import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  LOCAL_MEDIA_ENGINE_RELEASE_FILES,
  parseLocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";
import type {
  LocalMediaEngineReleaseChannel,
  LocalMediaEngineReleaseTarget
} from "../src/editor/local-media-engine-release.js";
import { verifyDesktopReleaseAssets } from "./desktop-release-assets.js";

const GITHUB_REPOSITORY_API =
  "https://api.github.com/repos/studyreadbook4ever/KirinukiHelper";
const MAXIMUM_GITHUB_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

export interface VerifiedWebEngineReleaseOptions {
  readonly directory: string;
  readonly fetchImpl?: typeof fetch;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function stableFileIdentity(filePath: string): Promise<Readonly<FileIdentity>> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.nlink === 1
      && metadata.size > 0
      && metadata.size <= 2 * 1024 * 1024 * 1024,
    `web release channel 입력이 안전한 regular file이 아닙니다: ${filePath}`
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
      invariant(bytesRead > 0, `release asset를 끝까지 읽지 못했습니다: ${filePath}`);
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
      `release asset가 web channel hash 중 바뀌었습니다: ${filePath}`
    );
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  invariant(
    declared === null
      || (/^(?:0|[1-9]\d*)$/u.test(declared)
        && Number(declared) <= MAXIMUM_GITHUB_RELEASE_RESPONSE_BYTES),
    "GitHub release API 응답 크기가 상한을 넘었습니다."
  );
  invariant(response.body !== null, "GitHub release API 응답 body가 없습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      invariant(
        total <= MAXIMUM_GITHUB_RELEASE_RESPONSE_BYTES,
        "GitHub release API 응답이 읽는 중 상한을 넘었습니다."
      );
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  invariant(
    new TextEncoder().encode(source).byteLength === bytes.byteLength,
    "GitHub release API 응답이 canonical UTF-8이 아닙니다."
  );
  return JSON.parse(source) as unknown;
}

function aggregateArtifactMap(
  manifest: Record<string, unknown>
): ReadonlyMap<string, Readonly<{ bytes: number; sha256: string }>> {
  invariant(Array.isArray(manifest.artifacts), "aggregate release artifacts가 배열이 아닙니다.");
  const artifacts = new Map<string, Readonly<{ bytes: number; sha256: string }>>();
  for (const value of manifest.artifacts) {
    invariant(isRecord(value), "aggregate release artifact가 object가 아닙니다.");
    invariant(
      typeof value.fileName === "string"
        && Number.isSafeInteger(value.bytes)
        && Number(value.bytes) > 0
        && typeof value.sha256 === "string"
        && SHA256_PATTERN.test(value.sha256)
        && !artifacts.has(value.fileName),
      "aggregate release artifact identity가 올바르지 않습니다."
    );
    artifacts.set(value.fileName, Object.freeze({
      bytes: Number(value.bytes),
      sha256: value.sha256
    }));
  }
  return artifacts;
}

function exactPublishedAssetUrl(
  value: unknown,
  tag: string,
  fileName: string
): value is string {
  return value === (
    `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/${fileName}`
  );
}

/**
 * Produces the only object that may unlock installer links in a web build.
 * Local signed readback and GitHub's published asset digest/size set must both
 * match; otherwise the ordinary build remains release-unavailable.
 */
export async function loadVerifiedWebEngineReleaseChannel({
  directory,
  fetchImpl = fetch
}: VerifiedWebEngineReleaseOptions): Promise<Readonly<LocalMediaEngineReleaseChannel>> {
  invariant(
    typeof directory === "string"
      && directory.length > 0
      && directory.trim() === directory
      && path.isAbsolute(directory),
    "KIRINUKI_WEB_ENGINE_RELEASE_READBACK은 절대 경로여야 합니다."
  );
  const canonicalDirectory = await realpath(directory);
  invariant(
    canonicalDirectory === path.resolve(directory),
    "web engine release readback 경로에 symlink/alias를 사용할 수 없습니다."
  );
  await verifyDesktopReleaseAssets(canonicalDirectory);
  const manifestPath = path.join(
    canonicalDirectory,
    DESKTOP_RELEASE_MANIFEST_FILE
  );
  const manifestIdentity = await stableFileIdentity(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  invariant(isRecord(manifest), "aggregate desktop release manifest가 object가 아닙니다.");
  invariant(
    manifest.status === "verified-public-release"
      && typeof manifest.tag === "string"
      && /^v\d+\.\d+\.\d+$/u.test(manifest.tag)
      && typeof manifest.commit === "string"
      && /^[0-9a-f]{40}$/u.test(manifest.commit),
    "aggregate desktop release identity가 web channel 계약과 다릅니다."
  );
  const tag = manifest.tag;
  const commit = manifest.commit;
  const aggregateArtifacts = aggregateArtifactMap(manifest);
  const localIdentities = new Map<string, Readonly<FileIdentity>>();
  for (const fileName of DESKTOP_PUBLIC_RELEASE_ASSET_FILES) {
    localIdentities.set(
      fileName,
      await stableFileIdentity(path.join(canonicalDirectory, fileName))
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const response = await fetchImpl(`${GITHUB_REPOSITORY_API}/releases/latest`, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Kirinuki-Web-Release-Gate/1",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  invariant(response.status === 200, `GitHub latest release readback 실패: ${response.status}`);
  const remote = await boundedResponseJson(response);
  invariant(
    isRecord(remote)
      && remote.draft === false
      && remote.prerelease === false
      && remote.tag_name === tag
      && Array.isArray(remote.assets),
    "GitHub latest release가 signed local readback tag와 다릅니다."
  );
  const remoteAssets = new Map<string, Record<string, unknown>>();
  for (const value of remote.assets) {
    invariant(
      isRecord(value)
        && typeof value.name === "string"
        && !remoteAssets.has(value.name),
      "GitHub release asset identity가 유일하지 않습니다."
    );
    remoteAssets.set(value.name, value);
  }
  invariant(
    JSON.stringify([...remoteAssets.keys()].sort())
      === JSON.stringify([...DESKTOP_PUBLIC_RELEASE_ASSET_FILES]),
    "GitHub latest release asset set가 exact signed release allowlist와 다릅니다."
  );
  for (const [fileName, identity] of localIdentities) {
    const remoteAsset = remoteAssets.get(fileName);
    invariant(
      remoteAsset
        && remoteAsset.state === "uploaded"
        && remoteAsset.size === identity.bytes
        && remoteAsset.digest === `sha256:${identity.sha256}`
        && exactPublishedAssetUrl(
          remoteAsset.browser_download_url,
          tag,
          fileName
        ),
      `GitHub published asset digest/size/URL readback이 다릅니다: ${fileName}`
    );
  }

  const installers = {} as Record<
    LocalMediaEngineReleaseTarget,
    { bytes: number; fileName: string; sha256: string; url: string }
  >;
  for (const target of Object.keys(
    LOCAL_MEDIA_ENGINE_RELEASE_FILES
  ) as LocalMediaEngineReleaseTarget[]) {
    const fileName = LOCAL_MEDIA_ENGINE_RELEASE_FILES[target];
    const identity = aggregateArtifacts.get(fileName);
    const localIdentity = localIdentities.get(fileName);
    const remoteAsset = remoteAssets.get(fileName)!;
    invariant(
      identity
        && localIdentity
        && identity.bytes === localIdentity.bytes
        && identity.sha256 === localIdentity.sha256,
      `installer aggregate/local identity가 다릅니다: ${target}`
    );
    installers[target] = Object.freeze({
      bytes: identity.bytes,
      fileName,
      sha256: identity.sha256,
      url: String(remoteAsset.browser_download_url)
    });
  }
  const channel = parseLocalMediaEngineReleaseChannel({
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: "verified-public-release",
    tag,
    commit,
    aggregateManifestSha256: manifestIdentity.sha256,
    installers
  });
  invariant(channel !== null, "검증된 release에서 web installer channel을 만들지 못했습니다.");
  return channel;
}
