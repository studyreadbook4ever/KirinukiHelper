import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA_ID,
  LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID,
  ChzzkVodMaterializationError,
  buildCompactConcatArgs,
  buildConcatDescription,
  buildRunRemuxArgs,
  chzzkVodConsumerScopeHash,
  materializeChzzkVod as materializeChzzkVodImplementation,
  normalizeChzzkVodUrl,
  parseChzzkMpd,
  planChzzkVodMaterialization,
  reopenChzzkVodMaterialization as reopenChzzkVodMaterializationImplementation,
  resolveChzzkVodStateDirectory,
  sleepWithMaterializerAbort
} from "../scripts/chzzk-vod-materializer.js";
import type {
  ChzzkVodMaterializerDependencies,
  ProcessResult,
  ProcessRunOptions
} from "../scripts/chzzk-vod-materializer.js";

const CONTENT_ID = "14252987";
const CANONICAL_URL = `https://chzzk.naver.com/video/${CONTENT_ID}`;
const CONSUMER_ID = "kirinuki-test-project-primary";

type MaterializationRequest = Parameters<typeof materializeChzzkVodImplementation>[0];
type MaterializerDependencies = Parameters<typeof materializeChzzkVodImplementation>[1];
type ReopenRequest = Parameters<typeof reopenChzzkVodMaterializationImplementation>[0];

function materializeChzzkVod(
  request: Omit<MaterializationRequest, "consumerId"> & {
    consumerId?: string;
  },
  dependencies?: MaterializerDependencies
) {
  return materializeChzzkVodImplementation({
    ...request,
    consumerId: request.consumerId ?? CONSUMER_ID
  }, dependencies);
}

function reopenChzzkVodMaterialization(
  request: Omit<ReopenRequest, "consumerId"> & {
    consumerId?: string;
  }
) {
  return reopenChzzkVodMaterializationImplementation({
    ...request,
    consumerId: request.consumerId ?? CONSUMER_ID
  });
}

function scopedJobDirectory(
  stateDir: string,
  materializationId: string,
  consumerId = CONSUMER_ID
): string {
  return path.join(
    stateDir,
    "consumers",
    chzzkVodConsumerScopeHash(consumerId),
    "jobs",
    "chzzk",
    materializationId
  );
}

function mpdFixture({
  duration = "PT20S",
  bandwidth = 8_192_000,
  media = "$RepresentationID$-$Number%06d$.ts?key=never-persist-this",
  firstNumber = 0,
  timeline = '<S t="0" d="4000" r="4"/>'
}: {
  duration?: string;
  bandwidth?: number;
  media?: string;
  firstNumber?: number;
  timeline?: string;
} = {}): string {
  const escapedMedia = media.replaceAll("&", "&amp;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<dash:MPD xmlns:dash="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="${duration}">
  <dash:Period start="PT0S" duration="${duration}">
    <dash:AdaptationSet mimeType="video/mp2t">
      <dash:Representation id="720p" codecs="avc1.64001f,mp4a.40.2" width="1280" height="720" bandwidth="4000000" frameRate="30">
        <dash:BaseURL>https://vod.pstatic.net/media/hls/</dash:BaseURL>
        <dash:SegmentTemplate timescale="1000" startNumber="${firstNumber}" media="${escapedMedia}">
          <dash:SegmentTimeline>${timeline}</dash:SegmentTimeline>
        </dash:SegmentTemplate>
      </dash:Representation>
      <dash:Representation id="1080p60" codecs="avc1.64002a, mp4a.40.2" width="1920" height="1080" bandwidth="${bandwidth}" frameRate="60000/1000">
        <dash:BaseURL>https://vod.pstatic.net/media/hls/</dash:BaseURL>
        <dash:SegmentTemplate timescale="1000" startNumber="${firstNumber}" media="${escapedMedia}">
          <dash:SegmentTimeline>${timeline}</dash:SegmentTimeline>
        </dash:SegmentTemplate>
      </dash:Representation>
    </dash:AdaptationSet>
  </dash:Period>
</dash:MPD>`;
}

function advancedMpdFixture(): string {
  return `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M">
  <Period start="PT5S" duration="PT20S">
    <AdaptationSet mimeType="video/mp2t" codecs="avc1.64002a,mp4a.40.2">
      <BaseURL>https://vod.pstatic.net/root/</BaseURL>
      <SegmentTemplate timescale="1000" presentationTimeOffset="1000" startNumber="0"
        media="chunk-$RepresentationID$-$Number%06d$-$Time$.ts?token=must-not-escape">
        <SegmentTimeline>
          <S t="1000" d="4000" r="1"/>
          <S d="4000" r="-1"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="1080p60" width="1920" height="1080" bandwidth="8192000" frameRate="60000/1001"/>
    </AdaptationSet>
  </Period>
</MPD>`;
}

function transportStreamBytes(segmentNumber: number): Uint8Array {
  const bytes = new Uint8Array(188 * 3);
  for (let offset = 0; offset < bytes.length; offset += 188) {
    bytes[offset] = 0x47;
  }
  bytes[1] = segmentNumber;
  return bytes;
}

interface FakeHarness {
  fetchImpl: typeof globalThis.fetch;
  runProcess: NonNullable<ChzzkVodMaterializerDependencies["runProcess"]>;
  calls: {
    metadata: number;
    mpd: number;
    segments: number[];
    requestHeaders: Array<{
      host: string;
      headers: Record<string, string>;
    }>;
    processes: Array<{ command: string; args: readonly string[] }>;
  };
}

function createHarness({
  keyframeSegments = new Set([0, 1, 3, 4]),
  expireSegmentOnce,
  oversizedSegment,
  changedMpdAfterRefresh = false,
  changedVideoIdAfterRefresh = false,
  initialBandwidth = 8_192_000,
  videoId = "internal-video-id"
}: {
  keyframeSegments?: ReadonlySet<number>;
  expireSegmentOnce?: number;
  oversizedSegment?: number;
  changedMpdAfterRefresh?: boolean;
  changedVideoIdAfterRefresh?: boolean;
  initialBandwidth?: number;
  videoId?: string;
} = {}): FakeHarness {
  const calls = {
    metadata: 0,
    mpd: 0,
    segments: [] as number[],
    requestHeaders: [] as Array<{
      host: string;
      headers: Record<string, string>;
    }>,
    processes: [] as Array<{ command: string; args: readonly string[] }>
  };
  let expired = false;
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.requestHeaders.push({
      host: url.hostname,
      headers: Object.fromEntries(new Headers(
        input instanceof Request ? input.headers : init?.headers
      ).entries())
    });
    if (url.hostname === "api.chzzk.naver.com") {
      calls.metadata += 1;
      return Response.json({
        content: {
          vodStatus: "ABR_HLS",
          videoId: changedVideoIdAfterRefresh && calls.metadata > 1
            ? `${videoId}-replacement`
            : videoId,
          inKey: `short-lived-secret-${calls.metadata}`
        }
      });
    }
    if (url.hostname === "apis.naver.com") {
      calls.mpd += 1;
      return new Response(mpdFixture({
        bandwidth: changedMpdAfterRefresh && calls.mpd > 1
          ? 7_000_000
          : initialBandwidth
      }), {
        status: 200,
        headers: { "content-type": "application/dash+xml" }
      });
    }
    if (url.hostname === "vod.pstatic.net") {
      const match = /-(\d{6})\.ts$/u.exec(url.pathname);
      assert.ok(match?.[1]);
      const segmentNumber = Number(match[1]);
      calls.segments.push(segmentNumber);
      if (segmentNumber === expireSegmentOnce && !expired) {
        expired = true;
        return new Response("expired", { status: 403 });
      }
      const bytes = transportStreamBytes(segmentNumber);
      const response = new Response(Buffer.from(bytes), {
        status: 200,
        headers: {
          "content-length": String(segmentNumber === oversizedSegment
            ? 300_000_000
            : bytes.byteLength),
          // CHZZK CDN MIME has historically been unreliable; bytes win.
          "content-type": "application/unknown"
        }
      });
      Object.defineProperty(response, "arrayBuffer", {
        value: () => Promise.reject(new Error("segment arrayBuffer must not be used"))
      });
      return response;
    }
    throw new Error("unexpected test host");
  }) as typeof globalThis.fetch;

  const runProcess = async (
    command: string,
    args: readonly string[],
    _options: ProcessRunOptions
  ): Promise<ProcessResult> => {
    calls.processes.push({ command, args: [...args] });
    const targetPath = args.at(-1);
    assert.ok(targetPath);
    if (command.includes("ffmpeg")) {
      const inputIndex = args.indexOf("-i");
      const inputPath = args[inputIndex + 1];
      assert.ok(inputPath);
      let durationMs: number;
      if (args.includes("concat")) {
        const description = await readFile(inputPath, "utf8");
        durationMs = [...description.matchAll(/^duration (\d+(?:\.\d+)?)$/gmu)]
          .reduce((total, match) => total + Number(match[1]) * 1000, 0);
      } else {
        const inputBytes = await readFile(inputPath);
        durationMs = inputBytes.byteLength / (188 * 3) * 4_000;
      }
      await writeFile(targetPath, JSON.stringify({ durationMs }));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (targetPath.endsWith(".ts")) {
      const bytes = await readFile(targetPath);
      const segmentNumber = bytes[1] ?? -1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          streams: [
            { codec_type: "video", codec_name: "h264" },
            { codec_type: "audio", codec_name: "aac" }
          ],
          packets: [
            {
              codec_type: "video",
              flags: keyframeSegments.has(segmentNumber) ? "K__" : "___"
            }
          ]
        }),
        stderr: ""
      };
    }
    if (args.includes("stream=codec_type,codec_name,start_time,duration")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              start_time: "0.000000",
              duration: "4.000000"
            },
            {
              codec_type: "audio",
              codec_name: "aac",
              start_time: "0.000000",
              duration: "4.000000"
            }
          ]
        }),
        stderr: ""
      };
    }
    if (args.includes("-show_format")) {
      const artifact = JSON.parse(await readFile(targetPath, "utf8")) as {
        durationMs: number;
      };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          streams: [
            { codec_type: "video", codec_name: "h264" },
            { codec_type: "audio", codec_name: "aac" }
          ],
          format: { duration: String(artifact.durationMs / 1000) }
        }),
        stderr: ""
      };
    }
    const artifact = JSON.parse(await readFile(targetPath, "utf8")) as {
      durationMs: number;
    };
    const intervalIndex = args.indexOf("-read_intervals");
    const intervals = String(args[intervalIndex + 1] ?? "")
      .split(",")
      .map((interval) => Number(interval.slice(0, interval.indexOf("%"))))
      .filter(Number.isFinite);
    const packetTimes = intervals.map((start) => Math.min(
      artifact.durationMs / 1000 - 0.1,
      start + 2
    ));
    packetTimes.push(Math.max(0, artifact.durationMs / 1000 - 0.1));
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        packets: packetTimes.map((ptsTime) => ({
          pts_time: String(Math.max(0, ptsTime)),
          flags: "K__"
        }))
      }),
      stderr: ""
    };
  };
  return { fetchImpl, runProcess, calls };
}

test("공개 CHZZK VOD 정식 HTTPS 주소만 canonicalize한다", () => {
  assert.equal(normalizeChzzkVodUrl(CANONICAL_URL), CANONICAL_URL);
  assert.equal(normalizeChzzkVodUrl(`${CANONICAL_URL}/`), CANONICAL_URL);
  for (const unsafe of [
    `http://chzzk.naver.com/video/${CONTENT_ID}`,
    `https://user:secret@chzzk.naver.com/video/${CONTENT_ID}`,
    `https://chzzk.naver.com:443/video/${CONTENT_ID}`,
    `${CANONICAL_URL}?key=secret`,
    `${CANONICAL_URL}#fragment`,
    "https://chzzk.naver.com/live/abcd",
    "https://chzzk.naver.com/clips/1234",
    "https://chzzk.naver.com.evil.test/video/1234",
    "not a url"
  ]) {
    assert.throws(() => normalizeChzzkVodUrl(unsafe), ChzzkVodMaterializationError);
  }
});

test("namespace·상속·PTO·Period start·t 생략·r=-1·startNumber=0을 파싱한다", () => {
  const parsed = parseChzzkMpd(advancedMpdFixture());
  assert.equal(parsed.durationMs, 60_000);
  assert.equal(parsed.representations.length, 1);
  const representation = parsed.representations[0];
  assert.ok(representation);
  assert.equal(representation.startNumber, 0);
  assert.equal(representation.frameRate, 60_000 / 1_001);
  assert.equal(representation.segments.length, 5);
  assert.deepEqual(
    representation.segments.map((segment) => ({
      number: segment.number,
      time: segment.time,
      start: segment.sourceStartMs,
      end: segment.sourceEndMs
    })),
    [
      { number: 0, time: 1_000, start: 5_000, end: 9_000 },
      { number: 1, time: 5_000, start: 9_000, end: 13_000 },
      { number: 2, time: 9_000, start: 13_000, end: 17_000 },
      { number: 3, time: 13_000, start: 17_000, end: 21_000 },
      { number: 4, time: 17_000, start: 21_000, end: 25_000 }
    ]
  );
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /must-not-escape|token=|https:\/\//u);
});

test("최고 muxed H264/AAC TS 품질과 full-segment 합집합을 계획한다", () => {
  const parsed = parseChzzkMpd(mpdFixture());
  const plan = planChzzkVodMaterialization(parsed, [
    { id: "clip-a", startMs: 8_000, endMs: 10_000 },
    { id: "clip-b", startMs: 9_000, endMs: 11_000 }
  ], 2_000);
  assert.equal(plan.quality.height, 1080);
  assert.equal(plan.quality.frameRate, 60);
  assert.equal(plan.logicalWindows.length, 1);
  assert.deepEqual(plan.logicalWindows[0], {
    editableSourceStartMs: 6_000,
    editableSourceEndMs: 13_000,
    clipIds: ["clip-a", "clip-b"]
  });
  assert.deepEqual(plan.runs[0]?.segments.map((segment) => segment.number), [1, 2, 3]);
});

test("명시한 확장 편집 범위를 handle 재적용 없이 정확히 계획한다", () => {
  const parsed = parseChzzkMpd(mpdFixture());
  const plan = planChzzkVodMaterialization(
    parsed,
    [{ id: "clip", startMs: 8_000, endMs: 10_000 }],
    2_000,
    [{ id: "clip", startMs: 0, endMs: 18_000 }]
  );
  assert.deepEqual(plan.clipRanges, [{
    clipId: "clip",
    sourceStartMs: 8_000,
    sourceEndMs: 10_000,
    editableSourceStartMs: 0,
    editableSourceEndMs: 18_000
  }]);
  assert.deepEqual(plan.logicalWindows, [{
    editableSourceStartMs: 0,
    editableSourceEndMs: 18_000,
    clipIds: ["clip"]
  }]);
  assert.deepEqual(plan.runs[0]?.segments.map((segment) => segment.number), [0, 1, 2, 3, 4]);
  assert.throws(() => planChzzkVodMaterialization(
    parsed,
    [{ id: "clip", startMs: 8_000, endMs: 10_000 }],
    2_000,
    [{ id: "clip", startMs: 7_000, endMs: 12_000 }]
  ), (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "INVALID_CLIPS"
  ));
  assert.throws(() => planChzzkVodMaterialization(
    parsed,
    [{ id: "clip", startMs: 8_000, endMs: 10_000 }],
    2_000,
    [{ id: "clip", startMs: 0.5, endMs: 18_000 }]
  ), (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "INVALID_CLIPS"
  ));
});

test("XML entity/doctype와 비 muxed 표현을 fail-closed로 거부한다", () => {
  assert.throws(
    () => parseChzzkMpd(`<!DOCTYPE MPD [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><MPD>&xxe;</MPD>`),
    /entity/u
  );
  assert.throws(
    () => parseChzzkMpd(mpdFixture().replace("video/mp2t", "video/mp4")),
    /MPEG-TS/u
  );
  assert.throws(
    () => parseChzzkMpd(mpdFixture().replaceAll("mp4a.40.2", "opus")),
    /MPEG-TS/u
  );
});

test("XDG state 경로와 명시 override를 결정론적으로 고른다", () => {
  assert.equal(
    resolveChzzkVodStateDirectory(undefined, { XDG_STATE_HOME: "/state" }, "/home/test"),
    "/state/kirinuki-vod-runtime/vod-fragments"
  );
  assert.equal(
    resolveChzzkVodStateDirectory(undefined, {
      KIRINUKI_VOD_STATE_DIR: "/srv/kirinuki-vod",
      KIRINUKI_CHZZK_VOD_STATE_DIR: "/legacy/ignored",
      XDG_STATE_HOME: "/ignored"
    }, "/home/test"),
    "/srv/kirinuki-vod"
  );
  assert.equal(
    resolveChzzkVodStateDirectory("relative/state", {}, "/home/test"),
    path.resolve("relative/state")
  );
  assert.throws(
    () => resolveChzzkVodStateDirectory(undefined, {
      KIRINUKI_VOD_STATE_DIR: "relative"
    }, "/home/test"),
    /절대 경로/u
  );
});

test("consumer scope는 domain-separated SHA-256이고 잘못된 식별자를 거부한다", () => {
  const first = chzzkVodConsumerScopeHash("project/session:alpha");
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(first, chzzkVodConsumerScopeHash("project/session:alpha"));
  assert.equal(first, chzzkVodConsumerScopeHash(" project/session:alpha "));
  assert.notEqual(first, chzzkVodConsumerScopeHash("project/session:beta"));
  for (const invalid of ["", "line\nbreak", "\u0000"]) {
    assert.throws(
      () => chzzkVodConsumerScopeHash(invalid),
      (error: unknown) => (
        error instanceof ChzzkVodMaterializationError
        && error.code === "INVALID_CONSUMER_ID"
      )
    );
  }
});

test("ffmpeg 명령은 모든 단계에서 stream-copy를 고정하고 run에 AAC 필터를 건다", () => {
  const runArgs = buildRunRemuxArgs("input.ts", "output.mp4");
  assert.deepEqual(runArgs.slice(runArgs.indexOf("-c"), runArgs.indexOf("-c") + 2), [
    "-c", "copy"
  ]);
  assert.deepEqual(
    runArgs.slice(runArgs.indexOf("-bsf:a"), runArgs.indexOf("-bsf:a") + 2),
    ["-bsf:a", "aac_adtstoasc"]
  );
  const concatArgs = buildCompactConcatArgs("runs.txt", "final.mp4");
  assert.deepEqual(
    concatArgs.slice(concatArgs.indexOf("-c"), concatArgs.indexOf("-c") + 2),
    ["-c", "copy"]
  );
  assert(!runArgs.includes("libx264"));
  assert(!concatArgs.includes("libx264"));
  assert.equal(
    buildConcatDescription(["/tmp/a.mp4", "/tmp/b's.mp4"], [8_000, 4_000]),
    "file '/tmp/a.mp4'\ninpoint 0.000000\noutpoint 8.000000\nduration 8.000000\n"
      + "file '/tmp/b'\\''s.mp4'\ninpoint 0.000000\noutpoint 4.000000\nduration 4.000000\n"
  );
});

test("정상 sleep 완료와 취소 모두 AbortSignal listener를 정리한다", async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let added = 0;
  let removed = 0;
  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    value: (...args: Parameters<AbortSignal["addEventListener"]>) => {
      added += 1;
      return originalAdd(...args);
    }
  });
  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    value: (...args: Parameters<AbortSignal["removeEventListener"]>) => {
      removed += 1;
      return originalRemove(...args);
    }
  });
  await sleepWithMaterializerAbort(1, signal);
  assert.equal(added, 1);
  assert.equal(removed, 1);

  const cancelled = new AbortController();
  const promise = sleepWithMaterializerAbort(60_000, cancelled.signal);
  cancelled.abort();
  await assert.rejects(promise, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError && error.code === "CANCELLED"
  ));
});

test("선택 segment만 받고 첫 packet이 keyframe이 아니면 bounded 이전 조각을 붙인다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-materializer-"));
  try {
    const harness = createHarness({ keyframeSegments: new Set([1]) });
    const progress: string[] = [];
    const result = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "clip-main", startMs: 8_000, endMs: 10_000 }],
      handleMs: 0,
      stateDir,
      onProgress: (event) => progress.push(event.phase)
    }, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    });

    assert.equal(result.reused, false);
    assert.equal(result.receipt.schemaId, CHZZK_VOD_MATERIALIZATION_SCHEMA_ID);
    assert.deepEqual(harness.calls.segments.sort((a, b) => a - b), [1, 2]);
    assert.deepEqual(result.manifest.windows, [{
      id: "window-1",
      editableSourceStartMs: 8_000,
      editableSourceEndMs: 10_000,
      fetchedSourceStartMs: 4_000,
      fetchedSourceEndMs: 12_000,
      mediaStartMs: 0,
      mediaEndMs: 8_000,
      clipIds: ["clip-main"]
    }]);
    assert.equal(result.manifest.handleMs, 0);
    assert.equal(result.manifest.localOnly, true);
    assert.ok((await readFile(result.artifactPath)).byteLength > 0);
    assert(progress.includes("downloading"));
    assert.equal(progress.at(-1), "completed");
    assert.equal(harness.calls.requestHeaders.length, 4);
    for (const request of harness.calls.requestHeaders) {
      assert.equal(request.headers.origin, "https://chzzk.naver.com");
      assert.equal(request.headers.referer, "https://chzzk.naver.com/");
      assert.equal(
        request.headers["user-agent"],
        "KirinukiHelper/1.0 (local authorized editing)"
      );
      assert.equal(request.headers["accept-encoding"], "identity");
    }
    assert.equal(
      harness.calls.requestHeaders.find(({ host }) => (
        host === "api.chzzk.naver.com"
      ))?.headers.accept,
      "application/json"
    );

    const diskManifest = await readFile(
      path.join(
        scopedJobDirectory(stateDir, result.manifest.materializationId),
        "manifest.json"
      ),
      "utf8"
    );
    assert.doesNotMatch(
      diskManifest,
      /never-persist-this|short-lived-secret|inKey|transferUrl|segmentUrl|[?&]key=/iu
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("segment 본문은 streaming으로 쓰고 선언·실측 크기 상한을 선할당 없이 지킨다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-size-limit-"));
  try {
    const harness = createHarness({
      keyframeSegments: new Set([2]),
      oversizedSegment: 2
    });
    await assert.rejects(
      materializeChzzkVod({
        sourceUrl: CANONICAL_URL,
        clips: [{ id: "oversized", startMs: 8_000, endMs: 10_000 }],
        handleMs: 0,
        stateDir
      }, {
        fetchImpl: harness.fetchImpl,
        runProcess: harness.runProcess,
        sleep: async () => undefined
      }),
      (error: unknown) => (
        error instanceof ChzzkVodMaterializationError
        && error.code === "SEGMENT_REQUEST_FAILED"
      )
    );
    assert.deepEqual(harness.calls.segments, [2, 2, 2, 2]);
    assert.deepEqual(harness.calls.processes, []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("완료 manifest/hash가 맞으면 조각과 ffmpeg 작업을 재사용한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-reuse-"));
  try {
    const firstHarness = createHarness({ keyframeSegments: new Set([2]) });
    const request = {
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "clip", startMs: 8_000, endMs: 10_000 }],
      handleMs: 0,
      stateDir
    } as const;
    const first = await materializeChzzkVod(request, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    const secondHarness = createHarness({ keyframeSegments: new Set([2]) });
    const second = await materializeChzzkVod(request, {
      fetchImpl: secondHarness.fetchImpl,
      runProcess: secondHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.artifactPath, first.artifactPath);
    assert.deepEqual(secondHarness.calls.segments, []);
    assert.deepEqual(secondHarness.calls.processes, []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("동일 semantic plan도 consumer별 artifact를 격리하고 한쪽 삭제가 다른 쪽에 전파되지 않는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-consumer-scope-"));
  const firstConsumer = "project/private-alpha/session:1";
  const secondConsumer = "project/private-beta/session:1";
  try {
    const clips = [{ id: "clip", startMs: 8_000, endMs: 10_000 }] as const;
    const firstHarness = createHarness({ keyframeSegments: new Set([2]) });
    const first = await materializeChzzkVodImplementation({
      consumerId: firstConsumer,
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    const secondHarness = createHarness({ keyframeSegments: new Set([2]) });
    const second = await materializeChzzkVodImplementation({
      consumerId: secondConsumer,
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: secondHarness.fetchImpl,
      runProcess: secondHarness.runProcess,
      sleep: async () => undefined
    });

    assert.equal(first.manifest.planFingerprint, second.manifest.planFingerprint);
    assert.equal(first.manifest.materializationId, second.manifest.materializationId);
    assert.equal(first.reused, false);
    assert.equal(second.reused, false);
    assert.notEqual(first.artifactPath, second.artifactPath);
    assert.equal(
      first.artifactPath,
      path.join(
        scopedJobDirectory(
          stateDir,
          first.manifest.materializationId,
          firstConsumer
        ),
        "materialized.mp4"
      )
    );
    assert.equal(
      second.artifactPath,
      path.join(
        scopedJobDirectory(
          stateDir,
          second.manifest.materializationId,
          secondConsumer
        ),
        "materialized.mp4"
      )
    );
    assert.equal(first.artifactPath.includes(firstConsumer), false);
    assert.equal(second.artifactPath.includes(secondConsumer), false);
    assert.deepEqual(
      secondHarness.calls.segments,
      [2],
      "consumer 삭제가 다른 편집 세션에 전파되지 않도록 content segment도 격리해야 합니다."
    );

    await rm(path.dirname(first.artifactPath), { recursive: true, force: true });
    const firstReopen = await reopenChzzkVodMaterializationImplementation({
      consumerId: firstConsumer,
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: CONTENT_ID,
      clips,
      handleMs: 0,
      stateDir
    });
    assert.equal(firstReopen, undefined);
    const secondReopen = await reopenChzzkVodMaterializationImplementation({
      consumerId: secondConsumer,
      materializationId: second.manifest.materializationId,
      planFingerprint: second.manifest.planFingerprint,
      contentId: CONTENT_ID,
      clips,
      handleMs: 0,
      stateDir
    });
    assert.equal(secondReopen?.reused, true);
    assert.equal(secondReopen?.artifactPath, second.artifactPath);
    assert.ok((await readFile(second.artifactPath)).byteLength > 0);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("hot-load 확장은 기존 clip을 부분집합 base로 재사용하고 새 lineage의 조각만 더 받는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-hot-load-"));
  try {
    const clips = [{ id: "clip", startMs: 8_000, endMs: 10_000 }] as const;
    const firstHarness = createHarness({ keyframeSegments: new Set([1, 2]) });
    const first = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    assert.deepEqual(firstHarness.calls.segments, [2]);

    const base = {
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: first.manifest.source.contentId
    } as const;
    const expandedClips = [
      ...clips,
      { id: "clip-new", startMs: 17_000, endMs: 18_000 }
    ] as const;
    const editableRanges = [
      { id: "clip", startMs: 4_000, endMs: 16_000 },
      { id: "clip-new", startMs: 16_000, endMs: 20_000 }
    ] as const;
    const expandedHarness = createHarness({ keyframeSegments: new Set([1, 2, 4]) });
    const expanded = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: expandedClips,
      editableRanges,
      handleMs: 0,
      stateDir,
      base
    }, {
      fetchImpl: expandedHarness.fetchImpl,
      runProcess: expandedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(expanded.reused, false);
    assert.notEqual(expanded.manifest.materializationId, first.manifest.materializationId);
    assert.deepEqual(expandedHarness.calls.segments, [1, 3, 4]);
    assert.deepEqual(expanded.manifest.clipRanges, [
      {
        clipId: "clip",
        sourceStartMs: 8_000,
        sourceEndMs: 10_000,
        editableSourceStartMs: 4_000,
        editableSourceEndMs: 16_000
      },
      {
        clipId: "clip-new",
        sourceStartMs: 17_000,
        sourceEndMs: 18_000,
        editableSourceStartMs: 16_000,
        editableSourceEndMs: 20_000
      }
    ]);
    assert.deepEqual(expanded.manifest.windows.map((window) => ({
      editableStart: window.editableSourceStartMs,
      editableEnd: window.editableSourceEndMs,
      fetchedStart: window.fetchedSourceStartMs,
      fetchedEnd: window.fetchedSourceEndMs
    })), [{
      editableStart: 4_000,
      editableEnd: 20_000,
      fetchedStart: 4_000,
      fetchedEnd: 20_000
    }]);

    const reopened = await reopenChzzkVodMaterialization({
      materializationId: expanded.manifest.materializationId,
      planFingerprint: expanded.manifest.planFingerprint,
      contentId: expanded.manifest.source.contentId,
      clips: expandedClips,
      editableRanges,
      handleMs: 0,
      stateDir
    });
    assert.equal(reopened?.reused, true);
    const wrongCoverage = await reopenChzzkVodMaterialization({
      materializationId: expanded.manifest.materializationId,
      planFingerprint: expanded.manifest.planFingerprint,
      contentId: expanded.manifest.source.contentId,
      clips: expandedClips,
      handleMs: 0,
      stateDir
    });
    assert.equal(wrongCoverage, undefined);

    let externalCalls = 0;
    const offline = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: expandedClips,
      editableRanges,
      handleMs: 0,
      stateDir,
      resume: {
        materializationId: expanded.manifest.materializationId,
        planFingerprint: expanded.manifest.planFingerprint,
        contentId: expanded.manifest.source.contentId
      }
    }, {
      fetchImpl: (async () => {
        externalCalls += 1;
        throw new Error("offline hot-load reopen must not fetch");
      }) as typeof globalThis.fetch,
      runProcess: async () => {
        throw new Error("offline hot-load reopen must not remux");
      }
    });
    assert.equal(offline.reused, true);
    assert.equal(externalCalls, 0);

    const coldIdentityHarness = createHarness({ keyframeSegments: new Set([1, 2, 4]) });
    const sameSemanticRequest = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: expandedClips,
      editableRanges,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: coldIdentityHarness.fetchImpl,
      runProcess: coldIdentityHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(sameSemanticRequest.reused, true);
    assert.equal(
      sameSemanticRequest.manifest.materializationId,
      expanded.manifest.materializationId
    );
    assert.deepEqual(coldIdentityHarness.calls.segments, []);
    assert.deepEqual(coldIdentityHarness.calls.processes, []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("hot-load base의 source version 변경과 비단조 범위를 fail-closed로 막는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-hot-base-"));
  try {
    const clips = [{ id: "clip", startMs: 8_000, endMs: 10_000 }] as const;
    const firstEditableRanges = [{ id: "clip", startMs: 4_000, endMs: 16_000 }] as const;
    const firstHarness = createHarness({ keyframeSegments: new Set([1, 2]) });
    const first = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: firstEditableRanges,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    const base = {
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: first.manifest.source.contentId
    } as const;

    const changedHarness = createHarness({
      keyframeSegments: new Set([1, 2]),
      initialBandwidth: 7_000_000
    });
    await assert.rejects(materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: [{ id: "clip", startMs: 0, endMs: 20_000 }],
      handleMs: 0,
      stateDir,
      base
    }, {
      fetchImpl: changedHarness.fetchImpl,
      runProcess: changedHarness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "SOURCE_CHANGED"
    ));
    assert.deepEqual(changedHarness.calls.segments, []);

    const replacedVideoHarness = createHarness({
      keyframeSegments: new Set([1, 2]),
      videoId: "replacement-video-generation"
    });
    await assert.rejects(materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: [{ id: "clip", startMs: 0, endMs: 20_000 }],
      handleMs: 0,
      stateDir,
      base
    }, {
      fetchImpl: replacedVideoHarness.fetchImpl,
      runProcess: replacedVideoHarness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "SOURCE_CHANGED"
    ));
    assert.deepEqual(
      replacedVideoHarness.calls.segments,
      [],
      "동일한 timeline 모양이어도 교체된 videoId와 기존 TS를 섞지 않는다"
    );

    await assert.rejects(materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: [{ id: "clip", startMs: 6_000, endMs: 14_000 }],
      handleMs: 0,
      stateDir,
      base
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "INVALID_CLIPS"
    ));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("같은 timeline의 교체 videoId는 receipt·fingerprint·TS cache를 공유하지 않는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-generation-cache-"));
  try {
    const clips = [{ id: "clip", startMs: 8_000, endMs: 10_000 }] as const;
    const firstHarness = createHarness({
      keyframeSegments: new Set([2]),
      videoId: "generation-a"
    });
    const first = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    const firstArtifact = await readFile(first.artifactPath);

    const replacementHarness = createHarness({
      keyframeSegments: new Set([2]),
      videoId: "generation-b"
    });
    const replacement = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: replacementHarness.fetchImpl,
      runProcess: replacementHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(replacement.reused, false);
    assert.deepEqual(replacementHarness.calls.segments, [2]);
    assert.equal(first.receipt.timelineDigest, replacement.receipt.timelineDigest);
    assert.equal(
      first.receipt.timelineDigest,
      planChzzkVodMaterialization(parseChzzkMpd(mpdFixture()), clips, 0)
        .timelineDigest
    );
    assert.notEqual(first.receipt.sourceVersionId, replacement.receipt.sourceVersionId);
    assert.notEqual(
      first.manifest.source.sourceVersionId,
      replacement.manifest.source.sourceVersionId
    );
    assert.notEqual(first.manifest.planFingerprint, replacement.manifest.planFingerprint);
    assert.notEqual(first.manifest.materializationId, replacement.manifest.materializationId);
    assert.notEqual(first.artifactPath, replacement.artifactPath);
    assert.deepEqual(await readFile(first.artifactPath), firstArtifact);
    assert.doesNotMatch(
      await readFile(
        path.join(
          scopedJobDirectory(
            stateDir,
            replacement.manifest.materializationId
          ),
          "manifest.json"
        ),
        "utf8"
      ),
      /generation-a|generation-b/u
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("private v1은 legacy로 offline reopen하고 hot-load는 cold v2 승격만 허용한다", async () => {
  const seedDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-legacy-seed-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-legacy-migrate-"));
  try {
    const clips = [{ id: "clip", startMs: 8_000, endMs: 10_000 }] as const;
    const seedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const seed = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir: seedDir
    }, {
      fetchImpl: seedHarness.fetchImpl,
      runProcess: seedHarness.runProcess,
      sleep: async () => undefined
    });

    const legacyFingerprint = "b".repeat(64);
    const legacyMaterializationId = legacyFingerprint.slice(0, 32);
    const unscopedLegacyJobDirectory = path.join(
      stateDir,
      "jobs",
      legacyMaterializationId
    );
    await mkdir(unscopedLegacyJobDirectory, { recursive: true });
    await copyFile(
      seed.artifactPath,
      path.join(unscopedLegacyJobDirectory, "materialized.mp4")
    );
    const legacyReceipt = structuredClone(seed.receipt);
    legacyReceipt.schemaId = LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID;
    legacyReceipt.materializationId = legacyMaterializationId;
    legacyReceipt.planFingerprint = legacyFingerprint;
    delete legacyReceipt.sourceVersionId;
    await writeFile(
      path.join(unscopedLegacyJobDirectory, "manifest.json"),
      `${JSON.stringify(legacyReceipt)}\n`
    );
    const legacyIdentity = {
      materializationId: legacyMaterializationId,
      planFingerprint: legacyFingerprint,
      contentId: CONTENT_ID
    } as const;

    const unscopedReopen = await reopenChzzkVodMaterialization({
      ...legacyIdentity,
      clips,
      handleMs: 0,
      stateDir
    });
    assert.equal(
      unscopedReopen,
      undefined,
      "pre-scope jobs/<materializationId> artifacts must never be reused"
    );

    const legacyJobDirectory = scopedJobDirectory(
      stateDir,
      legacyMaterializationId
    );
    await mkdir(legacyJobDirectory, { recursive: true });
    await copyFile(
      path.join(unscopedLegacyJobDirectory, "materialized.mp4"),
      path.join(legacyJobDirectory, "materialized.mp4")
    );
    await copyFile(
      path.join(unscopedLegacyJobDirectory, "manifest.json"),
      path.join(legacyJobDirectory, "manifest.json")
    );

    const reopened = await reopenChzzkVodMaterialization({
      ...legacyIdentity,
      clips,
      handleMs: 0,
      stateDir
    });
    assert.equal(reopened?.reused, true);
    assert.equal(
      reopened?.manifest.schema,
      "chzzk-kirinuki-chzzk-vod-materialization/v1"
    );
    assert.equal(Object.hasOwn(reopened?.manifest.source ?? {}, "sourceVersionId"), false);
    assert.equal(Object.hasOwn(reopened?.manifest ?? {}, "clipRanges"), false);

    let offlineCalls = 0;
    const offline = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir,
      resume: legacyIdentity
    }, {
      fetchImpl: (async () => {
        offlineCalls += 1;
        throw new Error("legacy offline reopen must not fetch");
      }) as typeof globalThis.fetch,
      runProcess: async () => {
        throw new Error("legacy offline reopen must not remux");
      }
    });
    assert.equal(offline.reused, true);
    assert.equal(offlineCalls, 0);

    const expandedRanges = [{ id: "clip", startMs: 4_000, endMs: 16_000 }] as const;
    const rejectedBaseHarness = createHarness({ keyframeSegments: new Set([1, 2]) });
    await assert.rejects(materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: expandedRanges,
      handleMs: 0,
      stateDir,
      base: legacyIdentity
    }, {
      fetchImpl: rejectedBaseHarness.fetchImpl,
      runProcess: rejectedBaseHarness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "SOURCE_CHANGED"
      && /이전 버전/u.test(error.message)
    ));
    assert.deepEqual(rejectedBaseHarness.calls.segments, []);

    const migrationHarness = createHarness({ keyframeSegments: new Set([1, 2]) });
    const migrated = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: expandedRanges,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: migrationHarness.fetchImpl,
      runProcess: migrationHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(migrated.receipt.schemaId, CHZZK_VOD_MATERIALIZATION_SCHEMA_ID);
    assert.equal(migrated.manifest.schema, "chzzk-kirinuki-chzzk-vod-materialization/v2");
    assert.match(migrated.receipt.sourceVersionId ?? "", /^[a-f0-9]{64}$/u);
    assert.deepEqual(migrationHarness.calls.segments, [1, 2, 3]);
  } finally {
    await rm(seedDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("hot-load 실패 후 재시도는 이전 결과를 보존하고 새로 검증된 조각도 이어 쓴다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-hot-retry-"));
  try {
    const clips = [{ id: "clip", startMs: 8_000, endMs: 10_000 }] as const;
    const initialHarness = createHarness({ keyframeSegments: new Set([1, 2]) });
    const initial = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: initialHarness.fetchImpl,
      runProcess: initialHarness.runProcess,
      sleep: async () => undefined
    });
    const initialArtifact = await readFile(initial.artifactPath);
    const base = {
      materializationId: initial.manifest.materializationId,
      planFingerprint: initial.manifest.planFingerprint,
      contentId: initial.manifest.source.contentId
    } as const;
    const request = {
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: [{ id: "clip", startMs: 4_000, endMs: 16_000 }],
      handleMs: 0,
      stateDir,
      base
    } as const;

    const failingHarness = createHarness({
      keyframeSegments: new Set([1, 2]),
      oversizedSegment: 3
    });
    await assert.rejects(materializeChzzkVod(request, {
      fetchImpl: failingHarness.fetchImpl,
      runProcess: failingHarness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "SEGMENT_REQUEST_FAILED"
    ));
    assert.deepEqual(failingHarness.calls.segments, [1, 3, 3, 3, 3]);
    assert.deepEqual(await readFile(initial.artifactPath), initialArtifact);

    const retryHarness = createHarness({ keyframeSegments: new Set([1, 2]) });
    const retried = await materializeChzzkVod(request, {
      fetchImpl: retryHarness.fetchImpl,
      runProcess: retryHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(retried.reused, false);
    assert.deepEqual(retryHarness.calls.segments, [3]);
    assert.deepEqual(retried.manifest.clipRanges?.map((clip) => [
      clip.editableSourceStartMs,
      clip.editableSourceEndMs
    ]), [[4_000, 16_000]]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("같은 합집합이어도 클립별 exact coverage가 다르면 fingerprint를 공유하지 않는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-hot-fingerprint-"));
  try {
    const clips = [
      { id: "a", startMs: 8_000, endMs: 10_000 },
      { id: "b", startMs: 12_000, endMs: 14_000 }
    ] as const;
    const firstHarness = createHarness({ keyframeSegments: new Set([1]) });
    const first = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: [
        { id: "a", startMs: 4_000, endMs: 12_000 },
        { id: "b", startMs: 12_000, endMs: 18_000 }
      ],
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    const secondHarness = createHarness({ keyframeSegments: new Set([1]) });
    const second = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      editableRanges: [
        { id: "a", startMs: 4_000, endMs: 14_000 },
        { id: "b", startMs: 10_000, endMs: 18_000 }
      ],
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: secondHarness.fetchImpl,
      runProcess: secondHarness.runProcess,
      sleep: async () => undefined
    });
    assert.deepEqual(
      first.manifest.windows.map((window) => [
        window.editableSourceStartMs,
        window.editableSourceEndMs
      ]),
      second.manifest.windows.map((window) => [
        window.editableSourceStartMs,
        window.editableSourceEndMs
      ])
    );
    assert.notEqual(first.manifest.planFingerprint, second.manifest.planFingerprint);
    assert.notEqual(first.manifest.materializationId, second.manifest.materializationId);
    assert.deepEqual(secondHarness.calls.segments, []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("strict resume identity와 동일 clip ±handle이면 gateway 재시작·오프라인에도 연다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-offline-"));
  try {
    const clips = [{ id: "offline", startMs: 8_000, endMs: 10_000 }] as const;
    const firstHarness = createHarness({ keyframeSegments: new Set([0]) });
    const first = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      stateDir
    }, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    let externalCalls = 0;
    const reopened = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      stateDir,
      resume: {
        materializationId: first.manifest.materializationId,
        planFingerprint: first.manifest.planFingerprint,
        contentId: first.manifest.source.contentId
      }
    }, {
      fetchImpl: (async () => {
        externalCalls += 1;
        throw new Error("offline");
      }) as typeof globalThis.fetch,
      runProcess: async () => {
        throw new Error("ffmpeg must not run during reopen");
      }
    });
    assert.equal(reopened.reused, true);
    assert.equal(reopened.artifactPath, first.artifactPath);
    assert.equal(externalCalls, 0);

    const wrongClip = await reopenChzzkVodMaterialization({
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: first.manifest.source.contentId,
      clips: [{ id: "offline", startMs: 8_000, endMs: 9_000 }],
      handleMs: 10_000,
      stateDir
    });
    assert.equal(wrongClip, undefined);

    const wrongHandle = await reopenChzzkVodMaterialization({
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: first.manifest.source.contentId,
      clips,
      handleMs: 0,
      stateDir
    });
    assert.equal(wrongHandle, undefined);

    const unsafeIdentity = await reopenChzzkVodMaterialization({
      materializationId: "../outside",
      planFingerprint: first.manifest.planFingerprint,
      contentId: first.manifest.source.contentId,
      clips,
      stateDir
    });
    assert.equal(unsafeIdentity, undefined);

    await writeFile(first.artifactPath, "tampered");
    const corrupted = await reopenChzzkVodMaterialization({
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: first.manifest.source.contentId,
      clips,
      stateDir
    });
    assert.equal(corrupted, undefined);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("비연속 source run은 각각 MP4로 만든 뒤 명시적 duration 경계로 compact concat한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-concat-"));
  try {
    const harness = createHarness({ keyframeSegments: new Set([0, 4]) });
    const result = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: [
        { id: "first", startMs: 0, endMs: 2_000 },
        { id: "second", startMs: 16_000, endMs: 18_000 }
      ],
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    });
    assert.deepEqual(harness.calls.segments, [0, 4]);
    assert.deepEqual(result.manifest.windows.map((window) => ({
      fetchedStart: window.fetchedSourceStartMs,
      fetchedEnd: window.fetchedSourceEndMs,
      mediaStart: window.mediaStartMs,
      mediaEnd: window.mediaEndMs
    })), [
      { fetchedStart: 0, fetchedEnd: 4_000, mediaStart: 0, mediaEnd: 4_000 },
      { fetchedStart: 16_000, fetchedEnd: 20_000, mediaStart: 4_000, mediaEnd: 8_000 }
    ]);
    const ffmpegCalls = harness.calls.processes.filter((call) => (
      call.command.includes("ffmpeg")
    ));
    assert.equal(ffmpegCalls.length, 3);
    assert(ffmpegCalls.some((call) => call.args.includes("concat")));
    assert.equal(result.receipt.artifact.durationMs, 8_000);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("죽은 PID가 남긴 job lock은 cache checkpoint를 보존한 채 회수한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-stale-lock-"));
  try {
    const request = {
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "stale-lock", startMs: 8_000, endMs: 10_000 }],
      handleMs: 0,
      stateDir
    } as const;
    const firstHarness = createHarness({ keyframeSegments: new Set([2]) });
    const first = await materializeChzzkVod(request, {
      fetchImpl: firstHarness.fetchImpl,
      runProcess: firstHarness.runProcess,
      sleep: async () => undefined
    });
    const jobDirectory = path.dirname(first.artifactPath);
    await rm(first.artifactPath, { force: true });
    await rm(path.join(jobDirectory, "manifest.json"), { force: true });
    await writeFile(path.join(jobDirectory, ".materializing.lock"), JSON.stringify({
      schemaId: "chzzk-kirinuki/chzzk-vod-job-lock-v1",
      pid: 99_999_999,
      createdAt: new Date().toISOString()
    }));

    const resumedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const resumed = await materializeChzzkVod(request, {
      fetchImpl: resumedHarness.fetchImpl,
      runProcess: resumedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(resumed.reused, false);
    assert.deepEqual(resumedHarness.calls.segments, []);
    assert(resumedHarness.calls.processes.length > 0);
    await assert.rejects(readFile(path.join(jobDirectory, ".materializing.lock")));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("playback redirect는 signed query를 비허용 호스트로 전달하기 전에 차단한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-redirect-"));
  try {
    const seenHosts: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seenHosts.push(url.hostname);
      if (url.hostname === "api.chzzk.naver.com") {
        return Response.json({
          content: {
            vodStatus: "ABR_HLS",
            videoId: "video-id",
            inKey: "must-not-leak"
          }
        });
      }
      if (url.hostname === "apis.naver.com") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/steal" }
        });
      }
      throw new Error("unsafe redirect was followed");
    }) as typeof globalThis.fetch;
    await assert.rejects(
      materializeChzzkVod({
        sourceUrl: CANONICAL_URL,
        clips: [{ id: "redirect", startMs: 1_000, endMs: 2_000 }],
        stateDir
      }, { fetchImpl }),
      (error: unknown) => (
        error instanceof ChzzkVodMaterializationError
        && error.code === "UNSAFE_TRANSFER_HOST"
        && !/must-not-leak|attacker\.example|key=/u.test(error.message)
      )
    );
    assert.deepEqual(seenHosts, ["api.chzzk.naver.com", "apis.naver.com"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("401/403/410이면 공개 metadata/MPD를 갱신하고 동일 identity에서만 재개한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-refresh-"));
  try {
    const harness = createHarness({
      keyframeSegments: new Set([2]),
      expireSegmentOnce: 2
    });
    const result = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "refresh", startMs: 8_000, endMs: 10_000 }],
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(result.reused, false);
    assert.equal(harness.calls.metadata, 2);
    assert.equal(harness.calls.mpd, 2);
    assert.deepEqual(harness.calls.segments, [2, 2]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("서명 갱신 중 videoId만 교체돼도 새 URL로 재시도하기 전에 중단한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-generation-refresh-"));
  try {
    const harness = createHarness({
      keyframeSegments: new Set([2]),
      expireSegmentOnce: 2,
      changedVideoIdAfterRefresh: true
    });
    await assert.rejects(materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "changed-generation", startMs: 8_000, endMs: 10_000 }],
      handleMs: 0,
      stateDir
    }, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "SOURCE_CHANGED"
      && !/internal-video-id|replacement|secret|key=/iu.test(error.message)
    ));
    assert.equal(harness.calls.metadata, 2);
    assert.equal(harness.calls.mpd, 2);
    assert.deepEqual(
      harness.calls.segments,
      [2],
      "교체 generation의 URL로 같은 segment key를 다시 받으면 안 된다"
    );
    assert.deepEqual(harness.calls.processes, []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("서명 갱신 후 semantic quality/timeline이 바뀌면 기존 조각과 섞지 않는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-changed-"));
  try {
    const harness = createHarness({
      keyframeSegments: new Set([2]),
      expireSegmentOnce: 2,
      changedMpdAfterRefresh: true
    });
    await assert.rejects(
      materializeChzzkVod({
        sourceUrl: CANONICAL_URL,
        clips: [{ id: "changed", startMs: 8_000, endMs: 10_000 }],
        handleMs: 0,
        stateDir
      }, {
        fetchImpl: harness.fetchImpl,
        runProcess: harness.runProcess,
        sleep: async () => undefined
      }),
      (error: unknown) => (
        error instanceof ChzzkVodMaterializationError
        && error.code === "SOURCE_CHANGED"
        && !/secret|key=/iu.test(error.message)
      )
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("취소 신호는 네트워크나 로컬 게시 전에 fail-closed로 중단한다", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "cancel", startMs: 1_000, endMs: 2_000 }],
      signal: controller.signal
    }),
    (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "CANCELLED"
    )
  );
});

test("실제 H.264/AAC TS 두 비연속 구간을 stream-copy MP4로 만들고 완전 디코딩한다", {
  timeout: 30_000
}, async (t) => {
  if (
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0
    || spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status !== 0
  ) {
    t.skip("이 검증에는 ffmpeg와 ffprobe가 필요합니다.");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-real-media-"));
  try {
    const segmentPattern = path.join(root, "source-%06d.ts");
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "12",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-g", "120", "-keyint_min", "120", "-sc_threshold", "0",
      "-force_key_frames", "expr:gte(t,n_forced*4)",
      "-c:a", "aac", "-b:a", "96k",
      "-f", "segment", "-segment_time", "4", "-segment_format", "mpegts",
      "-reset_timestamps", "0", "-segment_start_number", "0",
      segmentPattern
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);

    let externalCalls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      externalCalls += 1;
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.chzzk.naver.com") {
        return Response.json({
          content: {
            vodStatus: "ABR_HLS",
            videoId: "synthetic-video-id",
            inKey: "ephemeral-test-key"
          }
        });
      }
      if (url.hostname === "apis.naver.com") {
        return new Response(mpdFixture({
          duration: "PT12S",
          timeline: '<S t="0" d="4000" r="2"/>'
        }), { status: 200 });
      }
      if (url.hostname === "vod.pstatic.net") {
        const match = /-(\d{6})\.ts$/u.exec(url.pathname);
        assert.ok(match?.[1]);
        const bytes = await readFile(path.join(
          root,
          `source-${match[1]}.ts`
        ));
        return new Response(bytes, {
          status: 200,
          headers: { "content-length": String(bytes.byteLength) }
        });
      }
      throw new Error("unexpected synthetic host");
    }) as typeof globalThis.fetch;

    const clips = [
      { id: "first", startMs: 0, endMs: 1_000 },
      { id: "second", startMs: 8_000, endMs: 9_000 }
    ] as const;
    const result = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir: root
    }, { fetchImpl });
    assert.deepEqual(result.manifest.windows.map((window) => ({
      source: [window.fetchedSourceStartMs, window.fetchedSourceEndMs],
      media: [window.mediaStartMs, window.mediaEndMs]
    })), [
      { source: [0, 4_000], media: [0, 4_000] },
      { source: [8_000, 12_000], media: [4_000, 8_000] }
    ]);
    assert.ok(Math.abs(result.receipt.artifact.durationMs - 8_000) <= 250);
    const decodedVideo = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", result.artifactPath,
      "-map", "0:v:0", "-an", "-f", "rawvideo", "-pix_fmt", "yuv420p",
      "/dev/null"
    ], { encoding: "utf8" });
    assert.equal(decodedVideo.status, 0, decodedVideo.stderr);
    assert.equal(decodedVideo.stderr.trim(), "");
    const decodedAudio = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", result.artifactPath,
      "-map", "0:a:0", "-vn", "-f", "s16le", "/dev/null"
    ], { encoding: "utf8" });
    assert.equal(decodedAudio.status, 0, decodedAudio.stderr);
    assert.equal(decodedAudio.stderr.trim(), "");

    const beforeOfflineReopen = externalCalls;
    const reopened = await materializeChzzkVod({
      sourceUrl: CANONICAL_URL,
      clips,
      handleMs: 0,
      stateDir: root,
      resume: {
        materializationId: result.manifest.materializationId,
        planFingerprint: result.manifest.planFingerprint,
        contentId: result.manifest.source.contentId
      }
    }, {
      fetchImpl: (async () => {
        throw new Error("offline reopen must not fetch");
      }) as typeof globalThis.fetch
    });
    assert.equal(reopened.reused, true);
    assert.equal(reopened.artifactPath, result.artifactPath);
    assert.equal(externalCalls, beforeOfflineReopen);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
