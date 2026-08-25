#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LOCAL_MEDIA_ENGINE_RELEASE_FILES } from "../src/editor/local-media-engine-release.js";
import { buildWebDistribution } from "./build-web.js";
import { loadVerifiedWebEngineReleaseChannel } from "./web-engine-release-channel.js";
import {
  loadVerifiedWebEngineLinuxPreviewChannel
} from "./web-engine-linux-preview-channel.js";
import {
  PINNED_WEB_ENGINE_WINDOWS_PREVIEW_CHANNEL
} from "./pinned-web-engine-release.js";

export const WEB_ENGINE_RELEASE_READBACK_ENV =
  "KIRINUKI_WEB_ENGINE_RELEASE_READBACK" as const;

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function buildVerifiedEngineReleaseWeb(): Promise<void> {
  const readbackDirectory = process.env[WEB_ENGINE_RELEASE_READBACK_ENV];
  invariant(
    process.argv.length === 2,
    "사용법: KIRINUKI_WEB_ENGINE_RELEASE_READBACK=<absolute-readback> npm run build:web:release"
  );
  const requestedChannel = process.env.KIRINUKI_INSTALLER_CHANNEL;
  invariant(
    requestedChannel === "public-release" || requestedChannel === "linux-preview",
    "engine link를 여는 web build에는 public-release 또는 linux-preview channel이 필요합니다."
  );
  invariant(
    typeof readbackDirectory === "string"
      && readbackDirectory.length > 0
      && readbackDirectory.trim() === readbackDirectory
      && path.isAbsolute(readbackDirectory),
    `${WEB_ENGINE_RELEASE_READBACK_ENV}은 검증된 remote readback의 절대 경로여야 합니다.`
  );
  const channel = requestedChannel === "linux-preview"
    ? await loadVerifiedWebEngineLinuxPreviewChannel({
        directory: readbackDirectory
      })
    : await loadVerifiedWebEngineReleaseChannel({
        directory: readbackDirectory
      });
  await buildWebDistribution({
    engineRelease: channel,
    windowsPreviewRelease: PINNED_WEB_ENGINE_WINDOWS_PREVIEW_CHANNEL
  });
  const editorBundle = await readFile(
    path.join(repositoryRoot, "web", "editor", "editor.js"),
    "utf8"
  );
  for (const target of Object.keys(channel.installers) as Array<
    keyof typeof LOCAL_MEDIA_ENGINE_RELEASE_FILES
  >) {
    const artifact = channel.installers[target];
    invariant(
      artifact && editorBundle.includes(artifact.url),
      `release web bundle에 verified installer URL이 없습니다: ${target}`
    );
  }
  invariant(
    !channel.sourceOffer || editorBundle.includes(channel.sourceOffer.url),
    "release web bundle에 verified source offer URL이 없습니다."
  );
  invariant(
    !editorBundle.includes("api.github.com")
      && !editorBundle.includes("/releases/latest/download/"),
    "release web runtime은 GitHub API/latest alias를 조회하거나 노출할 수 없습니다."
  );
  console.log(JSON.stringify({
    schema: "kirinuki-web-engine-release-build/v1",
    status: "ok",
    channel: channel.status,
    tag: channel.tag,
    commit: channel.commit,
    installers: Object.keys(channel.installers).sort()
  }, null, 2));
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await buildVerifiedEngineReleaseWeb();
}
