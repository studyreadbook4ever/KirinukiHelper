import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEditorProjectFromCapture } from "../src/lib/editor-core.js";
import {
  copySingleClipPacketsForPreview,
  inspectMediaFile
} from "../src/editor/media-engine.js";

test("open-GOP H.264/AAC의 중간 구간은 strict decode 가능한 packet cache로 복사한다", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
    t.skip("실제 packet-copy 검증에는 ffmpeg가 필요합니다.");
    return;
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kirinuki-packet-copy-"));
  const inputPath = join(temporaryDirectory, "source.mp4");
  const outputPath = join(temporaryDirectory, "cache.mp4");
  const shortAudioPath = join(temporaryDirectory, "short-audio.mp4");
  try {
    const generated = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "lavfi",
      "-i", "testsrc2=size=320x180:rate=30:duration=6",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=6",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-g", "30",
      "-keyint_min", "30",
      "-sc_threshold", "0",
      "-x264-params", "open-gop=1:bframes=4:b-adapt=0",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      inputPath
    ], { encoding: "utf8" });
    if (generated.status !== 0) {
      t.skip(`합성 H.264/AAC fixture를 만들 수 없습니다: ${generated.stderr.trim()}`);
      return;
    }
    const sourceBytes = await readFile(inputPath);
    const source = new File([sourceBytes], "source.mp4", { type: "video/mp4" });
    const project = createEditorProjectFromCapture({
      projectName: "packet cache",
      source: {
        platform: "file",
        contentType: "vod",
        contentId: "packet-cache-fixture"
      },
      segments: [{ id: "middle", startSeconds: 1.25, endSeconds: 2.25 }]
    }, {
      id: "packet-cache-project",
      createdAt: "2026-08-12T00:00:00.000Z"
    });
    const progress: number[] = [];
    const copied = await copySingleClipPacketsForPreview(source, project, {
      onProgress: (value) => progress.push(value)
    });
    assert.ok(copied, "지원되는 H.264/AAC MP4는 packet-copy 경로를 사용해야 합니다.");
    assert.equal(copied.mimeType, "video/mp4");
    assert.equal(copied.hasAudio, true);
    assert.ok(copied.packetCount > 0);
    assert.ok(copied.mediaOffsetMs > 0 && copied.mediaOffsetMs <= 30_000);
    assert.equal(progress.at(-1), 1);
    assert.ok(copied.blob.size > 0);
    assert.ok(copied.blob.size < source.size);

    const copiedFile = new File([copied.blob], "cache.mp4", {
      type: copied.mimeType
    });
    const metadata = await inspectMediaFile(copiedFile);
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 180);
    assert.equal(metadata.hasAudio, true);
    assert.ok(metadata.durationMs >= copied.mediaOffsetMs + 1_000);
    assert.ok(
      metadata.durationMs - (copied.mediaOffsetMs + 1_000) <= 30_005,
      "요청 끝 뒤 postroll은 30초를 넘지 않아야 합니다."
    );
    await writeFile(outputPath, new Uint8Array(await copied.blob.arrayBuffer()));
    const decoded = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-xerror",
      "-err_detect", "explode",
      "-i", outputPath,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-f", "null",
      "-"
    ], { encoding: "utf8" });
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.equal(decoded.stderr.trim(), "");

    const probed = spawnSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=start_time,duration",
      "-of", "json",
      outputPath
    ], { encoding: "utf8" });
    assert.equal(probed.status, 0, probed.stderr);
    const probe = JSON.parse(probed.stdout) as {
      streams?: Array<{ start_time?: string; duration?: string }>;
    };
    const stream = probe.streams?.[0];
    const videoEndSeconds = Number(stream?.start_time) + Number(stream?.duration);
    assert.ok(
      videoEndSeconds + 0.005 >= copied.mediaOffsetMs / 1_000 + 1,
      `영상 트랙이 논리 요청 끝을 덮어야 합니다: ${videoEndSeconds}`
    );

    const nearEofProject = createEditorProjectFromCapture({
      projectName: "packet cache eof",
      source: {
        platform: "file",
        contentType: "vod",
        contentId: "packet-cache-fixture"
      },
      segments: [{ id: "tail", startSeconds: 4.5, endSeconds: 5.5 }]
    }, {
      id: "packet-cache-eof-project",
      createdAt: "2026-08-12T00:00:00.000Z"
    });
    assert.equal(
      await copySingleClipPacketsForPreview(source, nearEofProject),
      null,
      "요청 끝 뒤 exclusive verified key가 없으면 EOF까지 복사하지 않아야 합니다."
    );

    const generatedShortAudio = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "lavfi",
      "-i", "testsrc2=size=320x180:rate=30:duration=6",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=1",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-g", "30",
      "-keyint_min", "30",
      "-sc_threshold", "0",
      "-c:a", "aac",
      shortAudioPath
    ], { encoding: "utf8" });
    assert.equal(generatedShortAudio.status, 0, generatedShortAudio.stderr);
    const shortAudioBytes = await readFile(shortAudioPath);
    const shortAudioSource = new File([shortAudioBytes], "short-audio.mp4", {
      type: "video/mp4"
    });
    assert.equal(
      await copySingleClipPacketsForPreview(shortAudioSource, project),
      null,
      "입력에 음성 트랙이 있으면 요청 구간 음성을 덮지 못한 캐시를 무음 성공으로 반환하면 안 됩니다."
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
