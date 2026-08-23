import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  LOCAL_MEDIA_ENGINE_RELEASE_FILES,
  LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE,
  parseLocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";
import type {
  LocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";
import { buildWebJavaScript } from "../scripts/web-javascript-build.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function channelValue(): LocalMediaEngineReleaseChannel {
  const tag = "v3.0.0";
  return {
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: "verified-public-release",
    tag,
    commit: "a".repeat(40),
    aggregateManifestSha256: "b".repeat(64),
    installers: Object.fromEntries(Object.entries(
      LOCAL_MEDIA_ENGINE_RELEASE_FILES
    ).map(([target, fileName], index) => [target, {
      bytes: 10_000_000 + index,
      fileName,
      sha256: String(index + 1).repeat(64),
      url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/${fileName}`
    }])) as unknown as LocalMediaEngineReleaseChannel["installers"]
  };
}

function linuxPreviewChannelValue(): LocalMediaEngineReleaseChannel {
  const tag = "v3.0.5";
  return {
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: "verified-linux-preview",
    tag,
    commit: "c".repeat(40),
    aggregateManifestSha256: "d".repeat(64),
    sourceOffer: {
      bytes: 2048,
      fileName: "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt",
      sha256: "f".repeat(64),
      url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt`
    },
    installers: {
      "linux-x64": {
        bytes: 20_000_000,
        fileName: LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE,
        sha256: "e".repeat(64),
        url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/${LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE}`
      }
    }
  };
}

test("web engine release channel은 exact tag-pinned 세 installer만 허용한다", () => {
  const fixture = channelValue();
  const parsed = parseLocalMediaEngineReleaseChannel(fixture);
  assert.deepEqual(parsed, fixture);
  for (const mutate of [
    (value: Record<string, unknown>) => { value.extra = true; },
    (value: Record<string, unknown>) => { value.tag = "latest"; },
    (value: Record<string, unknown>) => {
      const installers = value.installers as Record<string, Record<string, unknown>>;
      installers["windows-x64"]!.url =
        "https://github.com/studyreadbook4ever/KirinukiHelper/releases/latest/download/Kirinuki-Engine-windows-x64-setup.exe";
    },
    (value: Record<string, unknown>) => {
      const installers = value.installers as Record<string, Record<string, unknown>>;
      installers["windows-x64"]!.fileName = "unsigned-test.exe";
    },
    (value: Record<string, unknown>) => {
      const installers = value.installers as Record<string, unknown>;
      delete installers["linux-x64"];
    }
  ]) {
    const candidate = structuredClone(fixture) as unknown as Record<string, unknown>;
    mutate(candidate);
    assert.equal(parseLocalMediaEngineReleaseChannel(candidate), null);
  }
});

test("Linux preview channel은 exact tag-pinned Linux x64 한 파일만 허용한다", () => {
  const fixture = linuxPreviewChannelValue();
  assert.deepEqual(parseLocalMediaEngineReleaseChannel(fixture), fixture);
  for (const mutate of [
    (value: Record<string, unknown>) => { value.status = "verified-public-release"; },
    (value: Record<string, unknown>) => { delete value.sourceOffer; },
    (value: Record<string, unknown>) => {
      const installers = value.installers as Record<string, unknown>;
      installers["windows-x64"] = {};
    },
    (value: Record<string, unknown>) => {
      const installers = value.installers as Record<string, Record<string, unknown>>;
      installers["linux-x64"]!.fileName = "Kirinuki-Engine-linux-x64.deb";
    },
    (value: Record<string, unknown>) => {
      const installers = value.installers as Record<string, Record<string, unknown>>;
      installers["linux-x64"]!.url =
        `https://github.com/studyreadbook4ever/KirinukiHelper/releases/latest/download/${LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE}`;
    }
  ]) {
    const candidate = structuredClone(fixture) as unknown as Record<string, unknown>;
    mutate(candidate);
    assert.equal(parseLocalMediaEngineReleaseChannel(candidate), null);
  }
});

test("ordinary web build는 installer URL을 싣지 않고 verified build만 tag-pinned URL을 싣는다", async () => {
  const ordinary = await buildWebJavaScript({
    rootDirectory: root,
    write: false,
    logLevel: "silent"
  });
  const ordinaryEditor = new TextDecoder().decode(
    ordinary.outputs.get("editor/editor.js")
  );
  assert.doesNotMatch(
    ordinaryEditor,
    /https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper\/releases\/download\/v\d+\.\d+\.\d+\/Kirinuki-Engine-/u
  );

  const channel = channelValue();
  const verified = await buildWebJavaScript({
    rootDirectory: root,
    write: false,
    logLevel: "silent",
    engineRelease: channel
  });
  const verifiedEditor = new TextDecoder().decode(
    verified.outputs.get("editor/editor.js")
  );
  for (const artifact of Object.values(channel.installers)) {
    assert.ok(artifact);
    assert.ok(verifiedEditor.includes(artifact.url));
  }
  const linuxPreview = linuxPreviewChannelValue();
  const previewBuild = await buildWebJavaScript({
    rootDirectory: root,
    write: false,
    logLevel: "silent",
    engineRelease: linuxPreview
  });
  const previewEditor = new TextDecoder().decode(
    previewBuild.outputs.get("editor/editor.js")
  );
  assert.ok(previewEditor.includes(
    linuxPreview.installers["linux-x64"]!.url
  ));
  assert.ok(previewEditor.includes(linuxPreview.sourceOffer!.url));
  assert.doesNotMatch(
    previewEditor,
    /releases\/download\/v3\.0\.4\/Kirinuki-Engine-(?:windows|macos)/u
  );
  assert.doesNotMatch(verifiedEditor, /api\.github\.com|releases\/latest\/download/u);
  await assert.rejects(
    buildWebJavaScript({
      rootDirectory: root,
      write: false,
      logLevel: "silent",
      engineRelease: { ...channel, status: "unverified" }
    }),
    /release channel이 검증 형식과 다릅니다/u
  );
});

test("release web build entrypoint는 signed local+published remote readback만 주입한다", async () => {
  const [entrypoint, loader, ordinaryBuild] = await Promise.all([
    readFile(path.join(root, "scripts/build-web-release.ts"), "utf8"),
    readFile(path.join(root, "scripts/web-engine-release-channel.ts"), "utf8"),
    readFile(path.join(root, "scripts/build-web.ts"), "utf8")
  ]);
  assert.match(entrypoint, /KIRINUKI_WEB_ENGINE_RELEASE_READBACK/u);
  assert.match(entrypoint, /requestedChannel === "public-release"/u);
  assert.match(entrypoint, /requestedChannel === "linux-preview"/u);
  assert.match(entrypoint, /loadVerifiedWebEngineLinuxPreviewChannel/u);
  assert.match(entrypoint, /loadVerifiedWebEngineReleaseChannel/u);
  assert.match(loader, /verifyDesktopReleaseAssets/u);
  assert.match(loader, /releases\/latest/u);
  assert.match(loader, /remoteAsset\.digest === `sha256:/u);
  assert.match(loader, /remoteAsset\.state === "uploaded"/u);
  assert.doesNotMatch(ordinaryBuild, /process\.env|KIRINUKI_WEB_ENGINE_RELEASE_READBACK/u);
});
