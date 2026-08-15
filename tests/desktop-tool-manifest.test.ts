import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  DESKTOP_FFMPEG_RELEASE,
  DESKTOP_PACKAGED_TARGETS,
  DESKTOP_TOOL_MANIFEST_SCHEMA,
  DESKTOP_YT_DLP_RELEASE,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import {
  resolveDesktopBundledTools
} from "../src/desktop/runtime-spec.js";
import type {
  DesktopArchitecture,
  DesktopBundleTarget,
  DesktopPlatform
} from "../src/desktop/runtime-spec.js";

const CASES: readonly Readonly<{
  target: DesktopBundleTarget;
  platform: DesktopPlatform;
  arch: DesktopArchitecture;
  resourcesRoot: string;
  ytDlpAsset: string;
}>[] = Object.freeze([
  {
    target: "linux-x64",
    platform: "linux",
    arch: "x64",
    resourcesRoot: "/opt/Kirinuki/resources",
    ytDlpAsset: "yt-dlp_linux"
  },
  {
    target: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    resourcesRoot: "/opt/Kirinuki-arm64/resources",
    ytDlpAsset: "yt-dlp_linux_aarch64"
  },
  {
    target: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    resourcesRoot: "/Applications/Kirinuki x64.app/Contents/Resources",
    ytDlpAsset: "yt-dlp_macos"
  },
  {
    target: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    resourcesRoot: "/Applications/Kirinuki.app/Contents/Resources",
    ytDlpAsset: "yt-dlp_macos"
  },
  {
    target: "win32-x64",
    platform: "win32",
    arch: "x64",
    resourcesRoot: "C:\\Program Files\\Kirinuki\\resources",
    ytDlpAsset: "yt-dlp.exe"
  }
]);

test("desktop tool manifest pins every packaged target and matches runtime paths", () => {
  assert.deepEqual(
    [...DESKTOP_PACKAGED_TARGETS],
    CASES.map(({ target }) => target).sort()
  );
  assert.equal(Object.isFrozen(DESKTOP_PACKAGED_TARGETS), true);

  for (const entry of CASES) {
    const manifest = desktopToolTargetManifest(entry.target);
    const tools = resolveDesktopBundledTools({
      platform: entry.platform,
      arch: entry.arch,
      resourcesRoot: entry.resourcesRoot
    });
    const pathApi = entry.platform === "win32" ? path.win32 : path.posix;

    assert.equal(manifest.schema, DESKTOP_TOOL_MANIFEST_SCHEMA, entry.target);
    assert.equal(manifest.target, entry.target);
    assert.equal(tools.bundleTarget, entry.target);
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(Object.isFrozen(tools), true);

    for (const artifact of [
      manifest.ffmpeg,
      manifest.ffprobe,
      manifest.ffmpegLicense,
      manifest.ytDlp
    ]) {
      assert.equal(Object.isFrozen(artifact), true, `${entry.target}:${artifact.fileName}`);
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/u);
      assert.equal(Number.isSafeInteger(artifact.size) && artifact.size > 0, true);
      const url = new URL(artifact.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "github.com");
    }

    assert.equal(pathApi.basename(tools.ffmpeg.command), manifest.ffmpeg.fileName);
    assert.equal(pathApi.basename(tools.ffprobe.command), manifest.ffprobe.fileName);
    assert.equal(pathApi.basename(tools.ytDlp.command), manifest.ytDlp.fileName);
    assert.deepEqual(tools.ffmpeg.argsPrefix, []);
    assert.deepEqual(tools.ffprobe.argsPrefix, []);
    assert.deepEqual(tools.ytDlp.argsPrefix, []);
    assert.equal(tools.ytDlp.artifactKind, "standalone");
    assert.equal(manifest.ffmpeg.compression, "gzip");
    assert.equal(manifest.ffprobe.compression, "gzip");
    assert.equal(manifest.ytDlp.compression, "none");
    assert.equal(manifest.ffmpegLicense.compression, "none");
    for (const compressed of [manifest.ffmpeg, manifest.ffprobe]) {
      assert.equal(
        Number.isSafeInteger(compressed.compressedSize)
          && Number(compressed.compressedSize) > 0
          && Number(compressed.compressedSize) < compressed.size,
        true,
        `${entry.target}:${compressed.fileName}:compressedSize`
      );
    }
    assert.equal(manifest.ytDlp.compressedSize, undefined);
    assert.equal(manifest.ffmpegLicense.compressedSize, undefined);
    assert.equal(
      manifest.ffmpeg.url,
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/ffmpeg-${entry.target}.gz`
    );
    assert.equal(
      manifest.ffprobe.url,
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/ffprobe-${entry.target}.gz`
    );
    assert.equal(
      manifest.ytDlp.url,
      `${DESKTOP_YT_DLP_RELEASE.baseUrl}/${entry.ytDlpAsset}`
    );
    assert.equal(
      manifest.ffmpeg.fileName,
      entry.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
    assert.equal(
      manifest.ffprobe.fileName,
      entry.platform === "win32" ? "ffprobe.exe" : "ffprobe"
    );
    assert.equal(
      manifest.ytDlp.fileName,
      entry.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
    );
  }
});

test("desktop tool manifest fails closed for unpinned targets", () => {
  for (const target of [
    "win32-arm64",
    "darwin-ia32",
    "freebsd-x64",
    "",
    "linux-x64/../../other"
  ]) {
    assert.throws(
      () => desktopToolTargetManifest(target),
      /지원하는 데스크톱 패키지 대상/u,
      target
    );
  }
});
