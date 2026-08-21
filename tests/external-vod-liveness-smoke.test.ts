import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXTERNAL_VOD_LIVE_FIXTURES,
  verifyFreshLiveVodMaterialization
} from "../scripts/external-vod-liveness-smoke.js";
import type {
  ExternalMediaInspection,
  ExternalVodMaterializationResult
} from "../scripts/external-vod-materializer.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA
} from "../src/lib/chzzk-vod-materialization.js";

const sourcePath = fileURLToPath(new URL(
  "../scripts/external-vod-liveness-smoke.ts",
  import.meta.url
));

function validObservation() {
  const fixture = EXTERNAL_VOD_LIVE_FIXTURES.find(
    ({ platform }) => platform === "YOUTUBE"
  );
  assert.ok(fixture);
  const durationMs = 16_000;
  const hashSha256 = "a".repeat(64);
  const result = {
    reused: false,
    artifactPath: "/private/fresh/materialized.mp4",
    manifest: {
      schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
      materializationId: "materialization-id",
      planFingerprint: "b".repeat(64),
      source: {
        platform: "YOUTUBE",
        contentType: "vod",
        contentId: "jNQXAC9IVRw",
        sourceVersionId: "c".repeat(64)
      },
      sourceDurationMs: 19_000,
      handleMs: 10_000,
      mediaDurationMs: durationMs,
      windows: [{
        id: "window-1",
        editableSourceStartMs: 0,
        editableSourceEndMs: 16_000,
        fetchedSourceStartMs: 0,
        fetchedSourceEndMs: 16_000,
        mediaStartMs: 0,
        mediaEndMs: 16_000,
        clipIds: [fixture.clip.id]
      }],
      clipRanges: [{
        clipId: fixture.clip.id,
        sourceStartMs: 5_000,
        sourceEndMs: 6_000,
        editableSourceStartMs: 0,
        editableSourceEndMs: 16_000
      }],
      preparedAt: "2026-08-21T00:00:00.000Z",
      localOnly: true
    },
    receipt: {
      canonicalUrl: fixture.sourceUrl,
      acquiredSections: [{ sourceStartMs: 0, sourceEndMs: 16_000 }],
      sourceRoots: [{ sizeBytes: 32_000 }],
      artifact: {
        sizeBytes: 24_000,
        hashSha256,
        durationMs
      },
      sourceClockProof: {}
    }
  } as unknown as ExternalVodMaterializationResult;
  const media = {
    durationMs,
    videoCodec: "h264",
    audioCodec: "aac",
    width: 640,
    height: 360,
    frameRate: 30,
    audioSampleRate: 48_000,
    audioChannels: 2,
    streamTimelines: {
      video: { startMs: 0, endMs: durationMs, durationMs },
      audio: { startMs: 0, endMs: durationMs, durationMs }
    }
  } satisfies ExternalMediaInspection;
  return {
    fixture,
    result,
    published: { sizeBytes: 24_000, sha256: hashSha256, media }
  };
}

test("live VOD fixture는 세 플랫폼 각각 공개 URL의 최대 1초 구간이다", () => {
  assert.deepEqual(
    EXTERNAL_VOD_LIVE_FIXTURES.map(({ platform }) => platform).sort(),
    ["CHZZK", "SOOP", "YOUTUBE"]
  );
  assert.equal(
    new Set(EXTERNAL_VOD_LIVE_FIXTURES.map(({ sourceUrl }) => sourceUrl)).size,
    3
  );
  for (const fixture of EXTERNAL_VOD_LIVE_FIXTURES) {
    const url = new URL(fixture.sourceUrl);
    assert.equal(url.protocol, "https:");
    assert.ok(fixture.clip.startMs >= 0);
    assert.ok(fixture.clip.endMs > fixture.clip.startMs);
    assert.ok(fixture.clip.endMs - fixture.clip.startMs <= 1_000);
    assert.equal(fixture.clip.id, `fresh-${fixture.platform.toLowerCase()}`);
  }
});

test("live VOD verifier는 exact range, receipt bytes/hash, ffprobe A/V 시간축을 확정한다", () => {
  const observation = validObservation();
  const verified = verifyFreshLiveVodMaterialization(observation);
  assert.deepEqual(verified.selectedRangeMs, [5_000, 6_000]);
  assert.deepEqual(verified.editableRangeMs, [0, 16_000]);
  assert.deepEqual(verified.acquiredSectionRangesMs, [[0, 16_000]]);
  assert.equal(verified.artifactBytes, 24_000);
  assert.equal(verified.sourceRootBytes, 32_000);
  assert.equal(verified.video.codec, "h264");
  assert.equal(verified.audio.codec, "aac");
  assert.deepEqual(verified.video.timelineMs, [0, 16_000]);
  assert.deepEqual(verified.audio.timelineMs, [0, 16_000]);
});

test("live VOD verifier는 cache reuse, section gap, receipt 변조, codec 오류를 성공으로 보지 않는다", () => {
  {
    const observation = validObservation();
    const result = { ...observation.result, reused: true };
    assert.throws(
      () => verifyFreshLiveVodMaterialization({ ...observation, result }),
      /기존 cache\/receipt/u
    );
  }
  {
    const observation = validObservation();
    const result = {
      ...observation.result,
      receipt: {
        ...observation.result.receipt,
        acquiredSections: [
          { sourceStartMs: 0, sourceEndMs: 8_000 },
          { sourceStartMs: 8_001, sourceEndMs: 16_000 }
        ]
      }
    } as unknown as ExternalVodMaterializationResult;
    assert.throws(
      () => verifyFreshLiveVodMaterialization({ ...observation, result }),
      /비연속/u
    );
  }
  {
    const observation = validObservation();
    const published = { ...observation.published, sha256: "d".repeat(64) };
    assert.throws(
      () => verifyFreshLiveVodMaterialization({ ...observation, published }),
      /bytes\/hash/u
    );
  }
  {
    const observation = validObservation();
    const published = {
      ...observation.published,
      media: { ...observation.published.media, videoCodec: "vp9" as "h264" }
    };
    assert.throws(
      () => verifyFreshLiveVodMaterialization({ ...observation, published }),
      /codec\/해상도\/fps/u
    );
  }
});

test("live VOD smoke는 legacy Python config가 아니라 managed standalone 도구 경계를 사용한다", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.doesNotMatch(source, /readVodRuntimeConfig|resolveVodRuntimePaths/u);
  assert.doesNotMatch(source, /pythonBinary\s*:/u);
  assert.match(source, /prepareDesktopTools\(target\)/u);
  assert.match(source, /resolveDesktopBundledTools/u);
  assert.match(source, /ytDlpMode:\s*"standalone"/u);
  assert.match(source, /inspectExternalMp4/u);
  assert.match(source, /packagedInstallerEvidence:\s*false/u);
  assert.match(source, /networkFailureAcceptedAsSuccess:\s*false/u);
});
