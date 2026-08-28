import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  stat,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA_ID,
  LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA_ID,
  MAX_CHZZK_PROCESS_OUTPUT_BYTES,
  ChzzkVodMaterializationError,
  buildCompactConcatArgs,
  buildConcatDescription,
  buildRunRemuxArgs,
  chzzkVodConsumerScopeHash,
  materializeChzzkVod as materializeChzzkVodImplementation,
  normalizeChzzkVodUrl,
  parseChzzkPlaybackHls,
  parseChzzkMpd,
  planChzzkVodMaterialization,
  reopenChzzkVodMaterialization as reopenChzzkVodMaterializationImplementation,
  resolveChzzkVodStateDirectory,
  runMaterializerProcess,
  sleepWithMaterializerAbort
} from "../scripts/chzzk-vod-materializer.js";
import {
  CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES,
  CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES
} from "../scripts/chzzk-job-lease-heartbeat-worker-source.js";
import type {
  ChzzkVodMaterializerDependencies,
  ProcessResult,
  ProcessRunOptions
} from "../scripts/chzzk-vod-materializer.js";
import { vodConsumerMaterializationDirectory } from
  "../scripts/vod-consumer-scope.js";

const CONTENT_ID = "14252987";
const CANONICAL_URL = `https://chzzk.naver.com/video/${CONTENT_ID}`;
const CONSUMER_ID = "kirinuki-test-project-primary";
const JOB_LEASE_DATABASE_FILENAME = ".materializing-lock.sqlite3";
const JOB_LEASE_SCHEMA_ID = "chzzk-kirinuki/chzzk-vod-job-lease-v3";

type TestSqliteValue = string | number | bigint | null | Uint8Array;

interface TestSqliteStatement {
  get(...parameters: readonly TestSqliteValue[]): unknown;
  run(...parameters: readonly TestSqliteValue[]): { changes: number | bigint };
}

interface TestSqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): TestSqliteStatement;
}

interface TestNodeSqlite {
  DatabaseSync: new (location: string) => TestSqliteDatabase;
}

const testRequireNodeBuiltin = createRequire(import.meta.url);

function withJobLeaseDatabase<T>(
  databasePath: string,
  callback: (database: TestSqliteDatabase) => T
): T {
  const sqlite = testRequireNodeBuiltin("node:sqlite") as TestNodeSqlite;
  const database = new sqlite.DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    return callback(database);
  } finally {
    database.close();
  }
}

function replaceJobLeaseRow(databasePath: string, {
  ownerId,
  pid,
  heartbeatAtBootMs,
  processStartMarker
}: {
  ownerId: string;
  pid: number;
  heartbeatAtBootMs: number;
  processStartMarker?: string;
}): void {
  withJobLeaseDatabase(databasePath, (database) => {
    database.prepare("DELETE FROM materialization_job_lease").run();
    database.prepare(`
      INSERT INTO materialization_job_lease (
        singleton,
        schema_id,
        owner_id,
        revision,
        pid,
        created_at_unix_ms,
        heartbeat_at_boot_ms,
        process_start_marker
      ) VALUES (1, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      JOB_LEASE_SCHEMA_ID,
      ownerId,
      pid,
      Date.now(),
      heartbeatAtBootMs,
      processStartMarker ?? null
    );
  });
}

function readJobLeaseRow(databasePath: string): Readonly<Record<string, unknown>> | undefined {
  return withJobLeaseDatabase(databasePath, (database) => {
    const value = database.prepare(`
      SELECT
        owner_id AS ownerId,
        revision,
        pid,
        heartbeat_at_boot_ms AS heartbeatAtBootMs
      FROM materialization_job_lease
      WHERE singleton = 1
    `).get();
    return typeof value === "object" && value !== null
      ? value as Readonly<Record<string, unknown>>
      : undefined;
  });
}

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
  consumerId = CONSUMER_ID,
  storageGeneration: "v3" | "legacy" = "v3"
): string {
  const legacyDirectory = vodConsumerMaterializationDirectory({
    stateDirectory: stateDir,
    consumerScopeHash: chzzkVodConsumerScopeHash(consumerId),
    platform: "chzzk",
    materializationId
  });
  return path.join(
    path.dirname(legacyDirectory),
    ...(storageGeneration === "v3" ? ["v3"] : []),
    path.basename(legacyDirectory)
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

function playbackMpdFixture(): string {
  return mpdFixture()
    .replace(
      'xmlns:dash="urn:mpeg:dash:schema:mpd:2011"',
      'xmlns:dash="urn:mpeg:dash:schema:mpd:2011" xmlns:nvod="urn:naver:vod"'
    )
    .replace(
      'id="720p"',
      'id="720p" nvod:m3u="https://vod.pstatic.net/media/hls/720p.m3u8?sig=runtime-720"'
    )
    .replace(
      'id="1080p60"',
      'id="1080p60" nvod:m3u="https://vod.pstatic.net/media/hls/1080p60.m3u8?sig=runtime-1080"'
    );
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

test("현재 CHZZK MPD의 namespaced HLS에서 1080p 이하 최고 품질과 원본 시계를 고른다", () => {
  const selected = parseChzzkPlaybackHls(
    playbackMpdFixture(),
    "https://apis.naver.com/neonplayer/vodplay/v1/playback/internal-id"
  );
  assert.deepEqual(selected, {
    durationSeconds: 20,
    manifestUrl:
      "https://vod.pstatic.net/media/hls/1080p60.m3u8?sig=runtime-1080"
  });
  assert.throws(
    () => parseChzzkPlaybackHls(
      playbackMpdFixture().replace(
        "https://vod.pstatic.net/media/hls/1080p60.m3u8",
        "https://attacker.example/media/hls/1080p60.m3u8"
      ),
      "https://apis.naver.com/neonplayer/vodplay/v1/playback/internal-id"
    ),
    (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "UNSAFE_TRANSFER_HOST"
    )
  );
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
    path.resolve("/state/kirinuki-vod-runtime/vod-fragments")
  );
  assert.equal(
    resolveChzzkVodStateDirectory(undefined, {
      KIRINUKI_VOD_STATE_DIR: "/srv/kirinuki-vod",
      KIRINUKI_CHZZK_VOD_STATE_DIR: "/legacy/ignored",
      XDG_STATE_HOME: "/ignored"
    }, "/home/test"),
    path.resolve("/srv/kirinuki-vod")
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

test("CHZZK 프로세스는 exit가 아니라 close에서 pipe를 끝까지 모아 성공한다", async () => {
  let captured: {
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  } | undefined;
  let childRef: (EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals) => boolean;
  }) | undefined;
  const spawnImpl = ((
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => {
    captured = { command, args, options };
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runMaterializerProcess("ffprobe", ["-version"], {
    cwd: "/tmp"
  }, { spawnImpl, platform: "linux" });
  let settled = false;
  void pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  childRef?.stdout.write("before-exit\n");
  childRef?.emit("exit", 0, null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  childRef?.stdout.end("after-exit\n");
  childRef?.stderr.end();
  childRef?.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.stdout, "before-exit\nafter-exit\n");
  assert.equal(captured?.command, "ffprobe");
  assert.deepEqual(captured?.args, ["-version"]);
  assert.equal(captured?.options.shell, false);
  assert.equal(captured?.options.windowsHide, true);
  assert.equal(captured?.options.detached, true);
});

test("CHZZK 프로세스 spawn error도 close 전에는 reject하지 않는다", async () => {
  let childRef: (EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runMaterializerProcess("missing-ffmpeg", [], {
    cwd: "/tmp"
  }, { spawnImpl, platform: "linux" });
  let settled = false;
  void pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "PROCESS_START_FAILED"
  ));
  childRef?.emit("error", new Error("ENOENT"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  childRef?.stdout.end();
  childRef?.stderr.end();
  childRef?.emit("close", -1, null);
  await rejected;
});

test("CHZZK 프로세스 timeout은 POSIX 그룹을 TERM/KILL한 뒤 close에서 끝난다", async () => {
  const scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  const handles = new Map<object, (typeof scheduled)[number]>();
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    const task = { callback, delay, cleared: false };
    const handle = {};
    scheduled.push(task);
    handles.set(handle, task);
    return handle;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: object) => {
    const task = handles.get(handle);
    if (task) {
      task.cleared = true;
    }
  }) as unknown as typeof clearTimeout;
  let childRef: (EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.pid = 12_345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const groupSignals: NodeJS.Signals[] = [];
  let groupAlive = true;
  const pending = runMaterializerProcess("ffmpeg", [], {
    cwd: "/tmp",
    timeoutMs: 123
  }, {
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
    killGraceMs: 17,
    platform: "darwin",
    probeProcessGroupImpl: () => {
      if (!groupAlive) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
    },
    killProcessGroupImpl: (pid, signal) => {
      assert.equal(pid, 12_345);
      groupSignals.push(signal);
    }
  });
  let settled = false;
  void pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "PROCESS_TIMEOUT"
  ));
  assert.equal(scheduled[0]?.delay, 123);
  scheduled[0]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM"]);
  assert.equal(scheduled[1]?.delay, 17);
  childRef?.stdout.end();
  childRef?.stderr.end();
  childRef?.emit("close", null, "SIGTERM");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  scheduled[1]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM", "SIGKILL"]);
  groupAlive = false;
  assert.equal(scheduled[2]?.delay, 17);
  scheduled[2]?.callback();
  await rejected;
  assert.equal(scheduled[0]?.cleared, true);
});

test("CHZZK 정상 close도 남은 POSIX descendant group 회수 뒤에만 성공한다", async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    scheduled.push({ callback, delay });
    return {} as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  let groupAlive = true;
  const groupSignals: NodeJS.Signals[] = [];
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.pid = 23_456;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end("ok\n");
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runMaterializerProcess("ffprobe", [], {
    cwd: "/tmp"
  }, {
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    killGraceMs: 19,
    platform: "linux",
    probeProcessGroupImpl: () => {
      if (!groupAlive) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
    },
    killProcessGroupImpl: (_pid, signal) => groupSignals.push(signal)
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM"]);
  groupAlive = false;
  assert.equal(scheduled[1]?.delay, 19);
  scheduled[1]?.callback();
  const result = await pending;
  assert.equal(result.stdout, "ok\n");
  assert.deepEqual(groupSignals, ["SIGTERM"]);
});

test("CHZZK Windows 취소는 exact child handle만 죽이고 close를 기다린다", async () => {
  const controller = new AbortController();
  const leaderSignals: Array<NodeJS.Signals | number | undefined> = [];
  let capturedOptions: SpawnOptions | undefined;
  let childRef: (EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  }) | undefined;
  const spawnImpl = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
    capturedOptions = options;
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.pid = 54_321;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      leaderSignals.push(signal);
      return true;
    };
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runMaterializerProcess("ffmpeg.exe", [], {
    cwd: "C:\\Kirinuki",
    signal: controller.signal
  }, {
    platform: "win32",
    spawnImpl
  });
  let settled = false;
  void pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "CANCELLED"
  ));
  controller.abort();
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  childRef?.stdout.end();
  childRef?.stderr.end();
  childRef?.emit("close", 1, null);
  await rejected;
  assert.equal(capturedOptions?.shell, false);
  assert.equal(capturedOptions?.windowsHide, true);
  assert.equal(capturedOptions?.detached, undefined);
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
});

test("CHZZK 출력 상한 오류도 Windows exact child close 전에 settle하지 않는다", async () => {
  const leaderSignals: Array<NodeJS.Signals | number | undefined> = [];
  let childRef: (EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.pid = 65_432;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      leaderSignals.push(signal);
      return true;
    };
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runMaterializerProcess("ffprobe.exe", [], {
    cwd: "C:\\Kirinuki"
  }, {
    platform: "win32",
    spawnImpl
  });
  let settled = false;
  void pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "PROCESS_OUTPUT_LIMIT"
  ));
  childRef?.stdout.write(Buffer.alloc(MAX_CHZZK_PROCESS_OUTPUT_BYTES + 1));
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  childRef?.stdout.end();
  childRef?.stderr.end();
  childRef?.emit("close", 1, null);
  await rejected;
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
});

test("CHZZK Windows timeout은 PID fallback 없이 exact child를 한 번 종료한다", async () => {
  const scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  const handles = new Map<object, (typeof scheduled)[number]>();
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    const task = { callback, delay, cleared: false };
    const handle = {};
    scheduled.push(task);
    handles.set(handle, task);
    return handle;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: object) => {
    const task = handles.get(handle);
    if (task) {
      task.cleared = true;
    }
  }) as unknown as typeof clearTimeout;
  const leaderSignals: Array<NodeJS.Signals | number | undefined> = [];
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: NodeJS.Signals | number) => boolean;
    };
    child.pid = 54_321;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      leaderSignals.push(signal);
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, "SIGKILL");
      });
      return true;
    };
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const processPending = runMaterializerProcess("ffmpeg.exe", [], {
    cwd: "C:\\Kirinuki",
    timeoutMs: 123
  }, {
    platform: "win32",
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl
  });
  scheduled[0]?.callback();
  await assert.rejects(processPending, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "PROCESS_TIMEOUT"
  ));
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
  assert.equal(scheduled[0]?.cleared, true);
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1]?.cleared, true);
});

test("CHZZK Windows exact child가 닫히지 않아도 timeout 결과는 bounded하게 끝난다", async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    scheduled.push({ callback, delay });
    return {};
  }) as unknown as typeof setTimeout;
  const leaderSignals: Array<NodeJS.Signals | number | undefined> = [];
  let unrefCount = 0;
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: NodeJS.Signals | number) => boolean;
      unref: () => void;
    };
    child.pid = 54_322;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      leaderSignals.push(signal);
      return false;
    };
    child.unref = () => { unrefCount += 1; };
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runMaterializerProcess("ffmpeg.exe", [], {
    cwd: "C:\\Kirinuki",
    timeoutMs: 123
  }, {
    platform: "win32",
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl: (() => undefined) as unknown as typeof clearTimeout,
    killGraceMs: 17
  });
  scheduled[0]?.callback();
  assert.equal(scheduled[1]?.delay, 17);
  scheduled[1]?.callback();
  await assert.rejects(pending, (error: unknown) => (
    error instanceof ChzzkVodMaterializationError
    && error.code === "PROCESS_TIMEOUT"
    && error.cause instanceof Error
  ));
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
  assert.equal(unrefCount, 1);
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

test("검증된 legacy v2는 read-only reopen하고 새 writer는 격리된 v3 경로만 쓴다", async () => {
  const seedDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-v2-seed-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-v3-isolation-"));
  try {
    const request = {
      sourceUrl: CANONICAL_URL,
      clips: [{ id: "v2-fallback", startMs: 8_000, endMs: 10_000 }],
      handleMs: 0
    } as const;
    const seedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const seed = await materializeChzzkVod({ ...request, stateDir: seedDir }, {
      fetchImpl: seedHarness.fetchImpl,
      runProcess: seedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(seed.receipt.schemaId, CHZZK_VOD_MATERIALIZATION_SCHEMA_ID);
    const legacyJobDirectory = scopedJobDirectory(
      stateDir,
      seed.manifest.materializationId,
      CONSUMER_ID,
      "legacy"
    );
    await mkdir(legacyJobDirectory, { recursive: true });
    await copyFile(seed.artifactPath, path.join(legacyJobDirectory, "materialized.mp4"));
    await writeFile(
      path.join(legacyJobDirectory, "manifest.json"),
      `${JSON.stringify(seed.receipt)}\n`
    );
    const legacyLock = `${JSON.stringify({
      schemaId: "chzzk-kirinuki/chzzk-vod-job-lock-v2",
      ownerId: "9".repeat(48),
      pid: process.pid,
      createdAt: new Date().toISOString()
    })}\n`;
    await writeFile(path.join(legacyJobDirectory, ".materializing.lock"), legacyLock);

    const reopened = await reopenChzzkVodMaterialization({
      materializationId: seed.manifest.materializationId,
      planFingerprint: seed.manifest.planFingerprint,
      contentId: CONTENT_ID,
      clips: request.clips,
      handleMs: 0,
      stateDir
    });
    assert.equal(reopened?.reused, true);
    assert.equal(reopened?.artifactPath, path.join(legacyJobDirectory, "materialized.mp4"));

    const v3Harness = createHarness({ keyframeSegments: new Set([2]) });
    const v3 = await materializeChzzkVod({ ...request, stateDir }, {
      fetchImpl: v3Harness.fetchImpl,
      runProcess: v3Harness.runProcess,
      sleep: async () => undefined
    });
    const expectedV3JobDirectory = scopedJobDirectory(
      stateDir,
      seed.manifest.materializationId
    );
    assert.equal(v3.reused, false);
    assert.equal(v3.artifactPath, path.join(expectedV3JobDirectory, "materialized.mp4"));
    assert.notEqual(path.dirname(v3.artifactPath), legacyJobDirectory);
    assert.deepEqual(v3Harness.calls.segments, [2]);
    assert.equal(
      await readFile(path.join(legacyJobDirectory, ".materializing.lock"), "utf8"),
      legacyLock
    );
    assert.equal(
      (await stat(path.join(expectedV3JobDirectory, JOB_LEASE_DATABASE_FILENAME))).isFile(),
      true
    );
  } finally {
    await rm(seedDir, { recursive: true, force: true });
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
      legacyMaterializationId,
      CONSUMER_ID,
      "legacy"
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

async function prepareJobLeaseFixture(
  stateDir: string,
  clipId: string
): Promise<{
  request: Readonly<{
    sourceUrl: string;
    clips: readonly [{ readonly id: string; readonly startMs: 8_000; readonly endMs: 10_000 }];
    handleMs: 0;
    stateDir: string;
  }>;
  databasePath: string;
  jobDirectory: string;
}> {
  const request = {
    sourceUrl: CANONICAL_URL,
    clips: [{ id: clipId, startMs: 8_000, endMs: 10_000 }],
    handleMs: 0,
    stateDir
  } as const;
  const harness = createHarness({ keyframeSegments: new Set([2]) });
  const seed = await materializeChzzkVod(request, {
    fetchImpl: harness.fetchImpl,
    runProcess: harness.runProcess,
    sleep: async () => undefined
  });
  const jobDirectory = path.dirname(seed.artifactPath);
  await rm(seed.artifactPath, { force: true });
  await rm(path.join(jobDirectory, "manifest.json"), { force: true });
  return {
    request,
    databasePath: path.join(jobDirectory, JOB_LEASE_DATABASE_FILENAME),
    jobDirectory
  };
}

test("죽은 PID가 남긴 SQLite job lease는 cache checkpoint를 보존한 채 CAS 회수한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-stale-lease-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "stale-lease");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "a".repeat(48),
      pid: 99_999_999,
      heartbeatAtBootMs: Math.floor(os.uptime() * 1_000)
    });
    const resumedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const resumed = await materializeChzzkVod(fixture.request, {
      fetchImpl: resumedHarness.fetchImpl,
      runProcess: resumedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(resumed.reused, false);
    assert.deepEqual(resumedHarness.calls.segments, []);
    assert(resumedHarness.calls.processes.length > 0);
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
    assert.equal((await stat(fixture.databasePath)).isFile(), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("start marker 없는 macOS/Windows식 live PID lease도 monotonic heartbeat가 stale이면 회수한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-reused-pid-lease-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "reused-pid-lease");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "b".repeat(48),
      pid: process.pid,
      heartbeatAtBootMs: Math.max(0, Math.floor(os.uptime() * 1_000) - 120_000)
    });
    const resumedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const resumed = await materializeChzzkVod(fixture.request, {
      fetchImpl: resumedHarness.fetchImpl,
      runProcess: resumedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(resumed.reused, false);
    assert.deepEqual(resumedHarness.calls.segments, []);
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("60초 지연된 live PID heartbeat는 90초 HDD lease 안에서 활성으로 유지한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-hdd-lease-window-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "hdd-lease-window");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "9".repeat(48),
      pid: process.pid,
      heartbeatAtBootMs: Math.max(0, Math.floor(os.uptime() * 1_000) - 60_000)
    });
    const blockedHarness = createHarness({ keyframeSegments: new Set([2]) });
    await assert.rejects(
      materializeChzzkVod(fixture.request, {
        fetchImpl: blockedHarness.fetchImpl,
        runProcess: blockedHarness.runProcess,
        sleep: async () => undefined
      }),
      (error: unknown) => (
        error instanceof ChzzkVodMaterializationError
        && error.code === "ALREADY_RUNNING"
      )
    );
    assert.equal(readJobLeaseRow(fixture.databasePath)?.ownerId, "9".repeat(48));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("현재 boot clock보다 미래인 lease는 재부팅 잔재로 보고 회수한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-future-lease-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "future-lease");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "c".repeat(48),
      pid: process.pid,
      heartbeatAtBootMs: Math.floor(os.uptime() * 1_000) + 60_000
    });
    const resumedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const resumed = await materializeChzzkVod(fixture.request, {
      fetchImpl: resumedHarness.fetchImpl,
      runProcess: resumedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(resumed.reused, false);
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("start marker 없는 live PID lease도 fresh monotonic heartbeat이면 활성으로 유지한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-fresh-lease-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "fresh-lease");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "d".repeat(48),
      pid: process.pid,
      heartbeatAtBootMs: Math.floor(os.uptime() * 1_000)
    });
    const blockedHarness = createHarness({ keyframeSegments: new Set([2]) });
    await assert.rejects(
      materializeChzzkVod(fixture.request, {
        fetchImpl: blockedHarness.fetchImpl,
        runProcess: blockedHarness.runProcess,
        sleep: async () => undefined
      }),
      (error: unknown) => (
        error instanceof ChzzkVodMaterializationError
        && error.code === "ALREADY_RUNNING"
      )
    );
    assert.equal(readJobLeaseRow(fixture.databasePath)?.ownerId, "d".repeat(48));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("Linux start marker 불일치는 fresh heartbeat여도 재사용 PID lease로 회수한다", {
  skip: process.platform !== "linux"
}, async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-start-marker-lease-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "start-marker-lease");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "e".repeat(48),
      pid: process.pid,
      heartbeatAtBootMs: Math.floor(os.uptime() * 1_000),
      processStartMarker: "0"
    });
    const resumedHarness = createHarness({ keyframeSegments: new Set([2]) });
    const resumed = await materializeChzzkVod(fixture.request, {
      fetchImpl: resumedHarness.fetchImpl,
      runProcess: resumedHarness.runProcess,
      sleep: async () => undefined
    });
    assert.equal(resumed.reused, false);
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("장기 작업 heartbeat revision은 갱신되고 CAS로 교체된 owner를 old owner가 지우지 않는다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-heartbeat-lease-"));
  let releaseProcess: (() => void) | undefined;
  let pending: ReturnType<typeof materializeChzzkVod> | undefined;
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "heartbeat-lease");
    let processEntered = false;
    let firstProcess = true;
    const processGate = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    const slowHarness = createHarness({ keyframeSegments: new Set([2]) });
    pending = materializeChzzkVod(fixture.request, {
      fetchImpl: slowHarness.fetchImpl,
      runProcess: async (command, args, options) => {
        if (firstProcess) {
          firstProcess = false;
          processEntered = true;
          await processGate;
        }
        return await slowHarness.runProcess(command, args, options);
      },
      sleep: async () => undefined,
      jobLeaseHeartbeatIntervalMs: 100
    });
    for (let attempt = 0; attempt < 100 && !processEntered; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(processEntered, true);
    const initial = readJobLeaseRow(fixture.databasePath);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    const heartbeated = readJobLeaseRow(fixture.databasePath);
    assert.equal(typeof initial?.revision, "number");
    assert.equal(typeof heartbeated?.revision, "number");
    assert(Number(heartbeated?.revision) > Number(initial?.revision));

    const replacementOwner = "f".repeat(48);
    withJobLeaseDatabase(fixture.databasePath, (database) => {
      const result = database.prepare(`
        UPDATE materialization_job_lease
        SET owner_id = ?, revision = revision + 1, heartbeat_at_boot_ms = ?
        WHERE singleton = 1 AND owner_id = ? AND revision = ?
      `).run(
        replacementOwner,
        Math.floor(os.uptime() * 1_000),
        String(heartbeated?.ownerId),
        Number(heartbeated?.revision)
      );
      assert.equal(Number(result.changes), 1);
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    releaseProcess?.();
    await assert.rejects(pending, (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "LOCK_FAILED"
    ));
    assert.equal(readJobLeaseRow(fixture.databasePath)?.ownerId, replacementOwner);
    await assert.rejects(readFile(path.join(fixture.jobDirectory, "manifest.json")));
  } finally {
    releaseProcess?.();
    await pending?.catch(() => undefined);
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("동시 stale-lease contender는 SQLite CAS로 한 작업만 실행한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-lease-contenders-"));
  let releaseProcesses: (() => void) | undefined;
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "lease-contenders");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "1".repeat(48),
      pid: 99_999_999,
      heartbeatAtBootMs: Math.floor(os.uptime() * 1_000)
    });
    const processGate = new Promise<void>((resolve) => {
      releaseProcesses = resolve;
    });
    let enteredProcesses = 0;
    const contender = () => {
      const harness = createHarness({ keyframeSegments: new Set([2]) });
      let firstProcess = true;
      return materializeChzzkVod(fixture.request, {
        fetchImpl: harness.fetchImpl,
        runProcess: async (command, args, options) => {
          if (firstProcess) {
            firstProcess = false;
            enteredProcesses += 1;
            await processGate;
          }
          return await harness.runProcess(command, args, options);
        },
        sleep: async () => undefined
      });
    };
    const attempts = [contender(), contender()];
    let rejectedBeforeRelease = false;
    for (const attempt of attempts) {
      void attempt.catch(() => {
        rejectedBeforeRelease = true;
      });
    }
    for (
      let retry = 0;
      retry < 100 && (enteredProcesses === 0 || !rejectedBeforeRelease);
      retry += 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    releaseProcesses?.();
    const results = await Promise.allSettled(attempts);
    assert.equal(rejectedBeforeRelease, true);
    assert.equal(enteredProcesses, 1);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.equal(
      rejection?.status === "rejected"
      && rejection.reason instanceof ChzzkVodMaterializationError
      && rejection.reason.code === "ALREADY_RUNNING",
      true
    );
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
  } finally {
    releaseProcesses?.();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("stale 관찰 뒤 새 owner가 CAS하면 늦은 contender는 그 owner를 빼앗지 못한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-cas-interleave-"));
  let releaseObserved: (() => void) | undefined;
  let releaseWinnerProcess: (() => void) | undefined;
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "cas-interleave");
    replaceJobLeaseRow(fixture.databasePath, {
      ownerId: "2".repeat(48),
      pid: 99_999_999,
      heartbeatAtBootMs: Math.floor(os.uptime() * 1_000)
    });
    let staleObserved = false;
    const observedGate = new Promise<void>((resolve) => {
      releaseObserved = resolve;
    });
    const lateHarness = createHarness({ keyframeSegments: new Set([2]) });
    const late = materializeChzzkVod(fixture.request, {
      fetchImpl: lateHarness.fetchImpl,
      runProcess: lateHarness.runProcess,
      sleep: async () => undefined,
      beforeStaleJobLeaseCompareAndSwap: async () => {
        staleObserved = true;
        await observedGate;
      }
    });
    for (let retry = 0; retry < 100 && !staleObserved; retry += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(staleObserved, true);

    let winnerEntered = false;
    let winnerFirstProcess = true;
    const winnerProcessGate = new Promise<void>((resolve) => {
      releaseWinnerProcess = resolve;
    });
    const winnerHarness = createHarness({ keyframeSegments: new Set([2]) });
    const winner = materializeChzzkVod(fixture.request, {
      fetchImpl: winnerHarness.fetchImpl,
      runProcess: async (command, args, options) => {
        if (winnerFirstProcess) {
          winnerFirstProcess = false;
          winnerEntered = true;
          await winnerProcessGate;
        }
        return await winnerHarness.runProcess(command, args, options);
      },
      sleep: async () => undefined
    });
    for (let retry = 0; retry < 100 && !winnerEntered; retry += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(winnerEntered, true);
    const winnerBeforeLateCas = readJobLeaseRow(fixture.databasePath);
    releaseObserved?.();
    await assert.rejects(late, (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "ALREADY_RUNNING"
    ));
    const winnerAfterLateCas = readJobLeaseRow(fixture.databasePath);
    assert.equal(winnerAfterLateCas?.ownerId, winnerBeforeLateCas?.ownerId);
    assert(
      Number(winnerAfterLateCas?.revision) >= Number(winnerBeforeLateCas?.revision)
    );
    releaseWinnerProcess?.();
    await winner;
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
  } finally {
    releaseObserved?.();
    releaseWinnerProcess?.();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("job lease DB symlink는 SQLite open 전에 fail-closed한다", {
  skip: process.platform === "win32"
}, async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-lease-symlink-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "lease-symlink");
    const outside = path.join(stateDir, "outside.sqlite3");
    await writeFile(outside, "must remain unchanged\n");
    await rm(fixture.databasePath);
    await symlink(outside, fixture.databasePath);
    const harness = createHarness({ keyframeSegments: new Set([2]) });
    await assert.rejects(materializeChzzkVod(fixture.request, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "LOCK_FAILED"
    ));
    assert.equal(await readFile(outside, "utf8"), "must remain unchanged\n");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("4096-byte page 계약과 다른 job lease DB는 WAL heartbeat 전에 fail-closed한다", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-lease-page-size-"));
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "lease-page-size");
    withJobLeaseDatabase(fixture.databasePath, (database) => {
      database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA page_size = 65536;
        VACUUM;
      `);
      const pageSize = database.prepare("PRAGMA page_size").get() as {
        page_size?: unknown;
      };
      assert.equal(pageSize.page_size, 65_536);
    });

    const harness = createHarness({ keyframeSegments: new Set([2]) });
    await assert.rejects(materializeChzzkVod(fixture.request, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "LOCK_FAILED"
    ));
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
    withJobLeaseDatabase(fixture.databasePath, (database) => {
      const pageSize = database.prepare("PRAGMA page_size").get() as {
        page_size?: unknown;
      };
      assert.equal(pageSize.page_size, 65_536);
    });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("첫 worker heartbeat가 실패하면 방금 획득한 owner row를 즉시 정리한다", {
  timeout: 8_000
}, async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-chzzk-worker-startup-"));
  let reader: TestSqliteDatabase | undefined;
  let writer: TestSqliteDatabase | undefined;
  try {
    const fixture = await prepareJobLeaseFixture(stateDir, "worker-startup");
    const sqlite = testRequireNodeBuiltin("node:sqlite") as TestNodeSqlite;
    reader = new sqlite.DatabaseSync(fixture.databasePath);
    writer = new sqlite.DatabaseSync(fixture.databasePath);
    reader.exec("PRAGMA journal_mode = WAL; BEGIN;");
    reader.prepare(`
      SELECT COUNT(*) AS count
      FROM materialization_job_lease
    `).get();
    writer.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA wal_autocheckpoint = 32;
    `);

    const walPath = `${fixture.databasePath}-wal`;
    let walBytes = 0;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      writer.exec(`PRAGMA user_version = ${attempt % 2};`);
      if (attempt % 8 !== 0) {
        continue;
      }
      walBytes = (await stat(walPath)).size;
      if (walBytes > CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES + 32 * 1_024) {
        break;
      }
    }
    assert(walBytes > CHZZK_JOB_LEASE_WAL_SOFT_LIMIT_BYTES);
    assert(
      walBytes < 1024 * 1024 - CHZZK_JOB_LEASE_WAL_COMMIT_MARGIN_BYTES
    );
    writer.close();
    writer = undefined;

    const harness = createHarness({ keyframeSegments: new Set([2]) });
    await assert.rejects(materializeChzzkVod(fixture.request, {
      fetchImpl: harness.fetchImpl,
      runProcess: harness.runProcess,
      sleep: async () => undefined
    }), (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "LOCK_FAILED"
    ));

    reader.exec("ROLLBACK;");
    reader.close();
    reader = undefined;
    assert.equal(readJobLeaseRow(fixture.databasePath), undefined);
  } finally {
    try {
      reader?.exec("ROLLBACK;");
    } catch {
      // The pinned reader may already have been released.
    }
    reader?.close();
    writer?.close();
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
