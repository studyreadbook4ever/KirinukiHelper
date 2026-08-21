import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertDesktopToolDirectoryModes,
  normalizeLinuxPackagedApplicationModes
} from "../scripts/package-desktop.js";
import {
  desktopToolArtifactModeIsReady,
  ensureDesktopToolCacheReady
} from "../scripts/prepare-desktop-tools.js";
import {
  DESKTOP_TOOL_MANIFEST_SCHEMA,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import type {
  DesktopToolArtifact,
  DesktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";

function artifact(
  fileName: string,
  bytes: Buffer
): Readonly<DesktopToolArtifact> {
  return Object.freeze({
    fileName,
    url: `https://github.com/example/example/releases/download/v1/${fileName}`,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    compression: "none"
  });
}

async function cacheFixture(): Promise<Readonly<{
  directory: string;
  manifest: Readonly<DesktopToolTargetManifest>;
  contents: Readonly<Record<"ffmpeg" | "ffprobe" | "license" | "ytDlp", Buffer>>;
}>> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kirinuki-tool-mode-test-"));
  const contents = Object.freeze({
    ffmpeg: Buffer.from("fixture-ffmpeg\n"),
    ffprobe: Buffer.from("fixture-ffprobe\n"),
    license: Buffer.from("fixture-license\n"),
    ytDlp: Buffer.from("fixture-yt-dlp\n")
  });
  const manifest: Readonly<DesktopToolTargetManifest> = Object.freeze({
    schema: DESKTOP_TOOL_MANIFEST_SCHEMA,
    target: "linux-x64",
    ffmpegVersion: "fixture-ffmpeg",
    ffprobeVersion: "fixture-ffprobe",
    ffmpeg: artifact("ffmpeg", contents.ffmpeg),
    ffprobe: artifact("ffprobe", contents.ffprobe),
    ffmpegLicense: artifact("FFMPEG-LICENSE.txt", contents.license),
    ytDlp: artifact("yt-dlp", contents.ytDlp)
  });
  await Promise.all([
    writeFile(path.join(directory, manifest.ffmpeg.fileName), contents.ffmpeg),
    writeFile(path.join(directory, manifest.ffprobe.fileName), contents.ffprobe),
    writeFile(
      path.join(directory, manifest.ffmpegLicense.fileName),
      contents.license
    ),
    writeFile(path.join(directory, manifest.ytDlp.fileName), contents.ytDlp),
    writeFile(
      path.join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
  ]);
  return { directory, manifest, contents };
}

test("POSIX desktop tool cache는 검증된 bytes만 안전한 mode로 복구한다", {
  skip: process.platform === "win32"
}, async () => {
  const fixture = await cacheFixture();
  try {
    await Promise.all([
      chmod(path.join(fixture.directory, fixture.manifest.ffmpeg.fileName), 0o777),
      chmod(path.join(fixture.directory, fixture.manifest.ffprobe.fileName), 0o600),
      chmod(
        path.join(fixture.directory, fixture.manifest.ffmpegLicense.fileName),
        0o666
      ),
      chmod(path.join(fixture.directory, fixture.manifest.ytDlp.fileName), 0o600)
    ]);

    assert.equal(
      await ensureDesktopToolCacheReady(fixture.directory, fixture.manifest),
      true
    );
    const [ffmpeg, ffprobe, license, ytDlp] = await Promise.all([
      lstat(path.join(fixture.directory, fixture.manifest.ffmpeg.fileName)),
      lstat(path.join(fixture.directory, fixture.manifest.ffprobe.fileName)),
      lstat(path.join(fixture.directory, fixture.manifest.ffmpegLicense.fileName)),
      lstat(path.join(fixture.directory, fixture.manifest.ytDlp.fileName))
    ]);
    assert.equal(ffmpeg.mode & 0o777, 0o700);
    assert.equal(ffprobe.mode & 0o777, 0o700);
    assert.equal(license.mode & 0o777, 0o600);
    assert.equal(ytDlp.mode & 0o777, 0o700);
    assert.deepEqual(
      await readFile(path.join(fixture.directory, fixture.manifest.ffmpeg.fileName)),
      fixture.contents.ffmpeg
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("desktop tool mode 계약은 POSIX 실행 파일과 license를 구분하고 Windows mode를 무시한다", () => {
  assert.equal(desktopToolArtifactModeIsReady("linux-x64", "ffmpeg", 0o700), true);
  assert.equal(desktopToolArtifactModeIsReady("linux-x64", "ffmpeg", 0o600), false);
  assert.equal(desktopToolArtifactModeIsReady("linux-x64", "ffmpeg", 0o777), false);
  assert.equal(
    desktopToolArtifactModeIsReady("darwin-arm64", "ffmpegLicense", 0o600),
    true
  );
  assert.equal(
    desktopToolArtifactModeIsReady("darwin-arm64", "ffmpegLicense", 0o666),
    false
  );
  assert.equal(desktopToolArtifactModeIsReady("win32-x64", "ffmpeg", 0o600), true);
  assert.equal(
    desktopToolArtifactModeIsReady("win32-x64", "ffmpegLicense", 0o700),
    true
  );
});

test("desktop package copy gate는 POSIX 과권한 mode를 거절하고 Windows mode를 해석하지 않는다", {
  skip: process.platform === "win32"
}, async () => {
  const fixture = await cacheFixture();
  try {
    assert.equal(
      await ensureDesktopToolCacheReady(fixture.directory, fixture.manifest),
      true
    );
    await assertDesktopToolDirectoryModes(
      fixture.directory,
      "linux-x64",
      "test package tools"
    );

    await chmod(
      path.join(fixture.directory, fixture.manifest.ffmpeg.fileName),
      0o777
    );
    await assert.rejects(
      assertDesktopToolDirectoryModes(
        fixture.directory,
        "linux-x64",
        "test package tools"
      ),
      /POSIX mode/u
    );
    await chmod(
      path.join(fixture.directory, fixture.manifest.ffmpeg.fileName),
      0o700
    );
    await chmod(
      path.join(fixture.directory, fixture.manifest.ffmpegLicense.fileName),
      0o666
    );
    await assert.rejects(
      assertDesktopToolDirectoryModes(
        fixture.directory,
        "linux-x64",
        "test package tools"
      ),
      /POSIX mode/u
    );
    await assertDesktopToolDirectoryModes(
      path.join(fixture.directory, "does-not-exist"),
      "win32-x64",
      "test Windows package tools"
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Linux deb 입력은 private cache와 분리해 root-owned 설치용 mode로 정규화한다", {
  skip: process.platform === "win32"
}, async () => {
  const temporaryRoot = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-linux-package-mode-test-"
  ));
  const packageRoot = path.join(temporaryRoot, "Kirinuki-linux-x64");
  const targetRoot = path.join(
    packageRoot,
    "resources",
    "desktop-tools",
    "linux-x64"
  );
  const manifest = desktopToolTargetManifest("linux-x64");
  try {
    await mkdir(targetRoot, { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(path.join(targetRoot, manifest.ffmpeg.fileName), "ffmpeg", { mode: 0o700 }),
      writeFile(path.join(targetRoot, manifest.ffprobe.fileName), "ffprobe", { mode: 0o700 }),
      writeFile(path.join(targetRoot, manifest.ytDlp.fileName), "yt-dlp", { mode: 0o700 }),
      writeFile(path.join(targetRoot, manifest.ffmpegLicense.fileName), "license", { mode: 0o600 }),
      writeFile(path.join(targetRoot, "manifest.json"), "{}\n", { mode: 0o600 })
    ]);

    await normalizeLinuxPackagedApplicationModes(packageRoot);

    const modes = await Promise.all([
      lstat(packageRoot),
      lstat(path.join(packageRoot, "resources", "desktop-tools")),
      lstat(targetRoot),
      lstat(path.join(targetRoot, manifest.ffmpeg.fileName)),
      lstat(path.join(targetRoot, manifest.ffprobe.fileName)),
      lstat(path.join(targetRoot, manifest.ytDlp.fileName)),
      lstat(path.join(targetRoot, manifest.ffmpegLicense.fileName)),
      lstat(path.join(targetRoot, "manifest.json"))
    ]);
    assert.deepEqual(
      modes.map((entry) => entry.mode & 0o777),
      [0o755, 0o755, 0o755, 0o755, 0o755, 0o755, 0o644, 0o644]
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
