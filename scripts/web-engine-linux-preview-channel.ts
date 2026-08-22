import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

import {
  LINUX_PREVIEW_INSTALLER_FILE,
  LINUX_PREVIEW_RELEASE_ASSET_FILES
} from "../src/desktop/installer-contract.js";
import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  parseLocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";
import type {
  LocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";
import {
  verifyLinuxPreviewReleaseAssets
} from "./linux-preview-release.js";

const GITHUB_REPOSITORY_API =
  "https://api.github.com/repos/studyreadbook4ever/KirinukiHelper";
const MAXIMUM_GITHUB_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024;

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

export interface VerifiedWebEngineLinuxPreviewOptions {
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
    `Linux preview readback이 안전한 regular file이 아닙니다: ${filePath}`
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
      invariant(bytesRead > 0, `Linux preview readback을 끝까지 읽지 못했습니다: ${filePath}`);
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
      `Linux preview readback이 hash 중 바뀌었습니다: ${filePath}`
    );
    return Object.freeze({ bytes: before.size, sha256: hash.digest("hex") });
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
    "GitHub Linux preview API 응답 크기가 상한을 넘었습니다."
  );
  invariant(response.body !== null, "GitHub Linux preview API 응답 body가 없습니다.");
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
        "GitHub Linux preview API 응답이 읽는 중 상한을 넘었습니다."
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
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
 * Unlocks only the Linux x64 preview download after exact local and published
 * prerelease readback. Stable three-OS release verification remains separate.
 */
export async function loadVerifiedWebEngineLinuxPreviewChannel({
  directory,
  fetchImpl = fetch
}: VerifiedWebEngineLinuxPreviewOptions): Promise<Readonly<LocalMediaEngineReleaseChannel>> {
  const verified = await verifyLinuxPreviewReleaseAssets(directory);
  const localIdentities = new Map<string, Readonly<FileIdentity>>();
  for (const fileName of LINUX_PREVIEW_RELEASE_ASSET_FILES) {
    localIdentities.set(
      fileName,
      await stableFileIdentity(path.join(verified.directory, fileName))
    );
  }
  const token = process.env.GITHUB_TOKEN;
  const response = await fetchImpl(
    `${GITHUB_REPOSITORY_API}/releases/tags/${verified.tag}`,
    {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Kirinuki-Linux-Preview-Web-Gate/1",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    }
  );
  invariant(response.status === 200, `GitHub Linux preview readback 실패: ${response.status}`);
  const remote = await boundedResponseJson(response);
  invariant(
    isRecord(remote)
      && remote.draft === false
      && remote.prerelease === true
      && remote.tag_name === verified.tag
      && Array.isArray(remote.assets),
    "GitHub release가 exact published Linux prerelease와 다릅니다."
  );
  const remoteAssets = new Map<string, Record<string, unknown>>();
  for (const value of remote.assets) {
    invariant(
      isRecord(value)
        && typeof value.name === "string"
        && !remoteAssets.has(value.name),
      "GitHub Linux preview asset identity가 유일하지 않습니다."
    );
    remoteAssets.set(value.name, value);
  }
  invariant(
    JSON.stringify([...remoteAssets.keys()].sort())
      === JSON.stringify([...LINUX_PREVIEW_RELEASE_ASSET_FILES]),
    "GitHub Linux preview asset set가 exact allowlist와 다릅니다."
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
          verified.tag,
          fileName
        ),
      `GitHub Linux preview digest/size/URL readback이 다릅니다: ${fileName}`
    );
  }
  const installer = localIdentities.get(LINUX_PREVIEW_INSTALLER_FILE);
  invariant(installer, "Linux preview installer readback이 없습니다.");
  const channel = parseLocalMediaEngineReleaseChannel({
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: "verified-linux-preview",
    tag: verified.tag,
    commit: verified.commit,
    aggregateManifestSha256: verified.manifest.sha256,
    installers: {
      "linux-x64": {
        bytes: installer.bytes,
        fileName: LINUX_PREVIEW_INSTALLER_FILE,
        sha256: installer.sha256,
        url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${verified.tag}/${LINUX_PREVIEW_INSTALLER_FILE}`
      }
    }
  });
  invariant(channel !== null, "Linux preview에서 web installer channel을 만들지 못했습니다.");
  return channel;
}
