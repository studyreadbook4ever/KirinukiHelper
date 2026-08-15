import assert from "node:assert/strict";
import test from "node:test";

import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  DEFAULT_MATERIALIZATION_HANDLE_MS,
  LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA,
  assertChzzkVodMaterialization,
  createMaterializationClipCoverages,
  createMaterializationWindows,
  expandAndMergeClipRanges,
  expandSegmentTimeline,
  logicalEditableBoundsForClip,
  materializationRequestRangeForClip,
  materializeEditorClip,
  materializeEditorClipWithinEditableBounds,
  materializedMediaTimelineMatches,
  materializedEditableBoundsForClip,
  mediaMsToSourceMs,
  mergeMaterializationClipCoverages,
  normalizeChzzkVodMaterialization,
  normalizeChzzkVodRightsConfirmation,
  planSegmentRuns,
  prependDecoderPrefixSegments,
  sourceMsToMediaMs,
  substituteSegmentTemplate,
  type ChzzkVodMaterialization,
  type ExpandedMpdSegment,
  type MaterializationWindow,
  type PlannedSegmentRun
} from "../src/lib/chzzk-vod-materialization.js";

function segment(
  index: number,
  sourceStartMs: number,
  sourceEndMs: number
): ExpandedMpdSegment {
  return {
    index,
    number: 100 + index,
    time: sourceStartMs,
    duration: sourceEndMs - sourceStartMs,
    sourceStartMs,
    sourceEndMs
  };
}

function mappingWindow(
  id: string,
  fetchedSourceStartMs: number,
  fetchedSourceEndMs: number,
  mediaStartMs: number,
  mediaEndMs: number,
  clipIds: string[] = [id]
): MaterializationWindow {
  return {
    id,
    editableSourceStartMs: fetchedSourceStartMs + 1_000,
    editableSourceEndMs: fetchedSourceEndMs - 1_000,
    fetchedSourceStartMs,
    fetchedSourceEndMs,
    mediaStartMs,
    mediaEndMs,
    clipIds
  };
}

function materialization(
  windows: MaterializationWindow[] = [
    mappingWindow("window-1", 0, 20_000, 0, 20_000, ["clip-a"]),
    mappingWindow("window-2", 40_000, 50_000, 20_000, 30_000, ["clip-b"])
  ]
): ChzzkVodMaterialization {
  return {
    schema: LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: "mat-123",
    planFingerprint: "sha256-abcdef",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      sourceVersionId: "c".repeat(64)
    },
    sourceDurationMs: 60_000,
    handleMs: DEFAULT_MATERIALIZATION_HANDLE_MS,
    mediaDurationMs: windows.at(-1)?.mediaEndMs ?? 0,
    windows,
    preparedAt: "2026-08-10T00:00:00.000Z",
    localOnly: true
  };
}

test("선택 구간을 ±10초 확장하고 원본 경계에서 clamp한 뒤 합친다", () => {
  assert.deepEqual(expandAndMergeClipRanges([
    { clipId: "first", sourceStartMs: 5_000, sourceEndMs: 10_000 },
    { clipId: "second", sourceStartMs: 25_000, sourceEndMs: 30_000 },
    { clipId: "third", sourceStartMs: 90_000, sourceEndMs: 99_000 }
  ], 100_000), [
    {
      editableSourceStartMs: 0,
      editableSourceEndMs: 40_000,
      clipIds: ["first", "second"]
    },
    {
      editableSourceStartMs: 80_000,
      editableSourceEndMs: 100_000,
      clipIds: ["third"]
    }
  ]);
});

test("half-open 확장 구간이 맞닿으면 중복 없는 하나의 union이 된다", () => {
  assert.deepEqual(expandAndMergeClipRanges([
    { clipId: "later", sourceStartMs: 30_000, sourceEndMs: 35_000 },
    { clipId: "earlier", sourceStartMs: 5_000, sourceEndMs: 10_000 }
  ], 60_000, 10_000), [{
    editableSourceStartMs: 0,
    editableSourceEndMs: 45_000,
    clipIds: ["earlier", "later"]
  }]);
});

test("v2 clip coverage는 원본 선택 anchor와 명시적으로 확장한 편집 범위를 분리한다", () => {
  const clips = [
    { clipId: "clip-a", sourceStartMs: 100_000, sourceEndMs: 110_000 },
    { clipId: "clip-b", sourceStartMs: 115_000, sourceEndMs: 125_000 }
  ];
  const coverages = createMaterializationClipCoverages(
    clips,
    200_000,
    10_000,
    [
      {
        clipId: "clip-a",
        editableSourceStartMs: 60_000,
        editableSourceEndMs: 120_000
      },
      {
        clipId: "clip-b",
        editableSourceStartMs: 105_000,
        editableSourceEndMs: 165_000
      }
    ]
  );

  assert.deepEqual(coverages, [
    {
      clipId: "clip-a",
      sourceStartMs: 100_000,
      sourceEndMs: 110_000,
      editableSourceStartMs: 60_000,
      editableSourceEndMs: 120_000
    },
    {
      clipId: "clip-b",
      sourceStartMs: 115_000,
      sourceEndMs: 125_000,
      editableSourceStartMs: 105_000,
      editableSourceEndMs: 165_000
    }
  ]);
  assert.deepEqual(mergeMaterializationClipCoverages(coverages), [{
    editableSourceStartMs: 60_000,
    editableSourceEndMs: 165_000,
    clipIds: ["clip-a", "clip-b"]
  }]);
  assert.throws(
    () => createMaterializationClipCoverages([
      { clipId: "clip-a", sourceStartMs: 100_000.5, sourceEndMs: 110_000 }
    ], 200_000),
    /안전한 정수/u
  );
  assert.throws(
    () => createMaterializationClipCoverages(clips, 200_000, 10_000, [
      {
        clipId: "clip-a",
        editableSourceStartMs: 90_000,
        editableSourceEndMs: 120_000
      },
      {
        clipId: "wrong-id",
        editableSourceStartMs: 105_000,
        editableSourceEndMs: 135_000
      }
    ]),
    /정확히 일치/u
  );
});

test("원본과 겹치지 않거나 역전된 클립 범위는 fail-closed한다", () => {
  assert.throws(
    () => expandAndMergeClipRanges([
      { clipId: "bad", sourceStartMs: 3_000, sourceEndMs: 3_000 }
    ], 10_000),
    /half-open/u
  );
  assert.throws(
    () => expandAndMergeClipRanges([
      { clipId: "outside", sourceStartMs: 11_000, sourceEndMs: 12_000 }
    ], 10_000),
    /겹치지 않습니다/u
  );
});

test("SegmentTimeline은 t 생략, 양수 r, timescale, PTO와 Period 시작을 펼친다", () => {
  const segments = expandSegmentTimeline({
    timescale: 1_000,
    presentationTimeOffset: 500,
    periodStartMs: 2_000,
    startNumber: 7,
    entries: [
      { t: 500, d: 4_000, r: 1 },
      { d: 2_000 }
    ]
  });
  assert.deepEqual(segments, [
    {
      index: 0,
      number: 7,
      time: 500,
      duration: 4_000,
      sourceStartMs: 2_000,
      sourceEndMs: 6_000
    },
    {
      index: 1,
      number: 8,
      time: 4_500,
      duration: 4_000,
      sourceStartMs: 6_000,
      sourceEndMs: 10_000
    },
    {
      index: 2,
      number: 9,
      time: 8_500,
      duration: 2_000,
      sourceStartMs: 10_000,
      sourceEndMs: 12_000
    }
  ]);
});

test("첫 S의 t 생략은 sample timeline 0에서 시작한다", () => {
  const [first, second] = expandSegmentTimeline({
    timescale: 10,
    presentationTimeOffset: 5,
    periodStartMs: 1_000,
    entries: [{ d: 10, r: 1 }]
  });
  assert.equal(first?.time, 0);
  assert.equal(first?.sourceStartMs, 500);
  assert.equal(second?.time, 10);
  assert.equal(second?.sourceStartMs, 1_500);
});

test("r=-1은 다음 명시적 t까지 ceil 규칙으로 펼친다", () => {
  const segments = expandSegmentTimeline({
    timescale: 1,
    entries: [
      { t: 0, d: 4, r: -1 },
      { t: 10, d: 2 }
    ]
  });
  assert.deepEqual(segments.map(({ time, duration }) => ({ time, duration })), [
    { time: 0, duration: 4 },
    { time: 4, duration: 4 },
    { time: 8, duration: 4 },
    { time: 10, duration: 2 }
  ]);
});

test("마지막 r=-1은 PTO가 반영된 Period 끝까지 펼친다", () => {
  const segments = expandSegmentTimeline({
    timescale: 1_000,
    presentationTimeOffset: 5_000,
    periodDurationMs: 10_000,
    entries: [{ t: 5_000, d: 4_000, r: -1 }]
  });
  assert.deepEqual(segments.map((entry) => entry.time), [5_000, 9_000, 13_000]);
  assert.deepEqual(
    segments.map((entry) => [entry.sourceStartMs, entry.sourceEndMs]),
    [[0, 4_000], [4_000, 8_000], [8_000, 12_000]]
  );
});

test("끝을 정할 수 없는 r=-1과 과도한 repeat는 거부한다", () => {
  assert.throws(
    () => expandSegmentTimeline({
      timescale: 1_000,
      entries: [{ d: 4_000, r: -1 }]
    }),
    /periodDurationMs/u
  );
  assert.throws(
    () => expandSegmentTimeline({
      timescale: 1_000,
      entries: [{ d: 1, r: 1_000_000 }]
    }),
    /최대 세그먼트 수/u
  );
});

test("DASH segment template의 ID, Number, zero-pad Number, Time을 치환한다", () => {
  assert.equal(substituteSegmentTemplate(
    "video/$RepresentationID$/seg-$Number$-$Number%06d$-$Time$.ts",
    { representationId: "1080p", number: 42, time: 168_000 }
  ), "video/1080p/seg-42-000042-168000.ts");
  assert.equal(substituteSegmentTemplate(
    "literal-$$-$Number$.ts",
    { representationId: "r", number: 3, time: 8 }
  ), "literal-$-3.ts");
});

test("알 수 없거나 닫히지 않은 template token을 남겨 두지 않는다", () => {
  assert.throws(
    () => substituteSegmentTemplate("$Bandwidth$.ts", {
      representationId: "r",
      number: 1,
      time: 0
    }),
    /지원하지 않는/u
  );
  assert.throws(
    () => substituteSegmentTemplate("$Number.ts", {
      representationId: "r",
      number: 1,
      time: 0
    }),
    /닫히지/u
  );
});

test("논리 window와 겹치는 whole segment를 선택해 연속 run을 만든다", () => {
  const segments = [
    segment(0, 0, 4_000),
    segment(1, 4_000, 8_000),
    segment(2, 8_000, 12_000),
    segment(3, 12_000, 16_000),
    segment(4, 16_000, 20_000)
  ];
  const runs = planSegmentRuns(segments, [
    {
      editableSourceStartMs: 5_000,
      editableSourceEndMs: 7_000,
      clipIds: ["clip-a"]
    },
    {
      editableSourceStartMs: 13_000,
      editableSourceEndMs: 15_000,
      clipIds: ["clip-b"]
    }
  ]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((run) => run.segments.map((entry) => entry.index)), [
    [1],
    [3]
  ]);
  assert.deepEqual(runs.map((run) => [
    run.fetchedSourceStartMs,
    run.fetchedSourceEndMs
  ]), [[4_000, 8_000], [12_000, 16_000]]);
});

test("segment rounding으로 맞닿은 선택은 중복 다운로드 없이 한 run으로 합친다", () => {
  const runs = planSegmentRuns([
    segment(0, 0, 4_000),
    segment(1, 4_000, 8_000),
    segment(2, 8_000, 12_000)
  ], [
    {
      editableSourceStartMs: 3_000,
      editableSourceEndMs: 3_500,
      clipIds: ["clip-a"]
    },
    {
      editableSourceStartMs: 4_500,
      editableSourceEndMs: 5_000,
      clipIds: ["clip-b"]
    }
  ]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0]?.segments.map((entry) => entry.index), [0, 1]);
  assert.deepEqual(runs[0]?.clipIds, ["clip-a", "clip-b"]);
});

test("segment 공백이 논리 window 안에 있으면 계획을 만들지 않는다", () => {
  assert.throws(() => planSegmentRuns([
    segment(0, 0, 4_000),
    segment(1, 5_000, 9_000)
  ], [{
    editableSourceStartMs: 3_000,
    editableSourceEndMs: 6_000,
    clipIds: ["clip-a"]
  }]), /공백/u);
});

test("decoder prefix는 fetched 범위만 넓히고 logical editable 범위는 유지한다", () => {
  const allSegments = [
    segment(0, 0, 4_000),
    segment(1, 4_000, 8_000),
    segment(2, 8_000, 12_000)
  ];
  const original = planSegmentRuns(allSegments, [{
    editableSourceStartMs: 9_000,
    editableSourceEndMs: 11_000,
    clipIds: ["clip-a"]
  }])[0]!;
  const prefixed = prependDecoderPrefixSegments(original, allSegments, 2);
  assert.deepEqual(prefixed.segments.map((entry) => entry.index), [0, 1, 2]);
  assert.equal(prefixed.decoderPrefixSegmentCount, 2);
  assert.equal(prefixed.fetchedSourceStartMs, 0);
  assert.equal(prefixed.editableSourceStartMs, 9_000);
  assert.equal(prefixed.editableSourceEndMs, 11_000);
  assert.equal(original.fetchedSourceStartMs, 8_000);
});

test("존재하지 않거나 끊긴 decoder prefix는 fail-closed한다", () => {
  const allSegments = [
    segment(0, 0, 4_000),
    segment(1, 5_000, 9_000)
  ];
  const run: PlannedSegmentRun = {
    editableSourceStartMs: 6_000,
    editableSourceEndMs: 8_000,
    fetchedSourceStartMs: 5_000,
    fetchedSourceEndMs: 9_000,
    clipIds: ["clip-a"],
    segments: [allSegments[1]!],
    decoderPrefixSegmentCount: 0
  };
  assert.throws(
    () => prependDecoderPrefixSegments(run, allSegments, 1),
    /연속되지/u
  );
  assert.throws(
    () => prependDecoderPrefixSegments(run, allSegments, 2),
    /충분하지/u
  );
});

test("run을 compact media의 연속 mapping window로 변환한다", () => {
  const runs = planSegmentRuns([
    segment(0, 0, 4_000),
    segment(1, 4_000, 8_000),
    segment(2, 12_000, 16_000)
  ], [
    {
      editableSourceStartMs: 1_000,
      editableSourceEndMs: 7_000,
      clipIds: ["clip-a"]
    },
    {
      editableSourceStartMs: 13_000,
      editableSourceEndMs: 15_000,
      clipIds: ["clip-b"]
    }
  ]);
  assert.deepEqual(createMaterializationWindows(runs), [
    {
      id: "window-1",
      editableSourceStartMs: 1_000,
      editableSourceEndMs: 7_000,
      fetchedSourceStartMs: 0,
      fetchedSourceEndMs: 8_000,
      mediaStartMs: 0,
      mediaEndMs: 8_000,
      clipIds: ["clip-a"]
    },
    {
      id: "window-2",
      editableSourceStartMs: 13_000,
      editableSourceEndMs: 15_000,
      fetchedSourceStartMs: 12_000,
      fetchedSourceEndMs: 16_000,
      mediaStartMs: 8_000,
      mediaEndMs: 12_000,
      clipIds: ["clip-b"]
    }
  ]);
});

test("strict materialization schema는 JSON roundtrip 후 정확히 복원된다", () => {
  const original = materialization();
  const normalized = normalizeChzzkVodMaterialization(
    JSON.parse(JSON.stringify(original))
  );
  assert.deepEqual(normalized, original);
  assert.notEqual(normalized, original);
  assert.notEqual(normalized?.windows, original.windows);
  assert.deepEqual(assertChzzkVodMaterialization(original), original);
});

test("v2 manifest는 합쳐진 window 안에서도 clip별 확장 범위를 서로 빌려주지 않는다", () => {
  const record: ChzzkVodMaterialization = {
    ...materialization([{
      id: "window-1",
      editableSourceStartMs: 60_000,
      editableSourceEndMs: 165_000,
      fetchedSourceStartMs: 58_000,
      fetchedSourceEndMs: 167_000,
      mediaStartMs: 0,
      mediaEndMs: 109_000,
      clipIds: ["clip-a", "clip-b"]
    }]),
    schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    sourceDurationMs: 200_000,
    clipRanges: [
      {
        clipId: "clip-a",
        sourceStartMs: 100_000,
        sourceEndMs: 110_000,
        editableSourceStartMs: 60_000,
        editableSourceEndMs: 120_000
      },
      {
        clipId: "clip-b",
        sourceStartMs: 115_000,
        sourceEndMs: 125_000,
        editableSourceStartMs: 105_000,
        editableSourceEndMs: 165_000
      }
    ]
  };
  const normalized = assertChzzkVodMaterialization(record);
  const clipA = {
    id: "clip-a",
    selectionStartMs: 100_000,
    selectionEndMs: 110_000,
    sourceStartMs: 70_000,
    sourceEndMs: 119_000
  };

  assert.deepEqual(materializationRequestRangeForClip(clipA, normalized), {
    clipId: "clip-a",
    sourceStartMs: 100_000,
    sourceEndMs: 110_000
  });
  assert.deepEqual(materializedEditableBoundsForClip(clipA, normalized), {
    editableSourceStartMs: 60_000,
    editableSourceEndMs: 120_000,
    windowId: "window-1",
    mediaStartMs: 2_000,
    mediaEndMs: 62_000
  });
  assert.equal(materializeEditorClipWithinEditableBounds({
    ...clipA,
    sourceEndMs: 150_000
  }, normalized), null, "clip B가 늘린 union은 clip A의 hot-load 범위가 아니다");
  assert.equal(normalizeChzzkVodMaterialization({
    ...record,
    clipRanges: record.clipRanges?.slice(0, 1)
  }), null, "모든 window clip에 정확히 하나의 coverage가 있어야 한다");
  assert.equal(normalizeChzzkVodMaterialization({
    ...record,
    materializationId: "not-a-plan-id"
  }), null, "v2 identity는 plan fingerprint와 결속되어야 한다");
  assert.equal(normalizeChzzkVodMaterialization({
    ...record,
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987"
    }
  }), null, "v2 identity에는 원본 세대 식별자가 필요하다");
  assert.equal(normalizeChzzkVodMaterialization({
    ...record,
    source: {
      ...record.source,
      sourceVersionId: "not-a-sha256"
    }
  }), null, "v2 원본 세대 식별자는 64자리 lowercase SHA-256이어야 한다");
  assert.equal(normalizeChzzkVodMaterialization({
    ...record,
    windows: record.windows.map((window) => ({
      ...window,
      editableSourceStartMs: window.editableSourceStartMs - 1_000,
      editableSourceEndMs: window.editableSourceEndMs + 1_000
    }))
  }), null, "window 편집 범위는 clipRanges의 정확한 바깥 경계와 같아야 한다");
  assert.ok(
    normalized,
    "CHZZK decoder-prefix fetched 범위는 exact editable 범위보다 넓을 수 있다"
  );
  assert.equal(normalizeChzzkVodMaterialization({
    ...record,
    source: {
      ...record.source,
      platform: "YOUTUBE"
    }
  }), null, "YouTube·SOOP은 editable보다 넓은 fetched 범위를 허용하지 않는다");
  assert.equal(materializedEditableBoundsForClip({
    ...clipA,
    selectionStartMs: 99_000
  }, normalized), null, "같은 clipId라도 불변 capture anchor가 다르면 재사용하지 않는다");
});

test("URL·query·token용 extra 필드와 비 CHZZK 원본은 schema에서 거부한다", () => {
  const original = materialization();
  assert.equal(normalizeChzzkVodMaterialization({
    ...original,
    signedUrl: "https://example.test/video.ts?token=secret"
  }), null);
  assert.equal(normalizeChzzkVodMaterialization({
    ...original,
    source: {
      ...original.source,
      playbackQuery: "token=secret"
    }
  }), null);
  assert.equal(normalizeChzzkVodMaterialization({
    ...original,
    source: {
      platform: "YouTube",
      contentType: "vod",
      contentId: "14252987"
    }
  }), null);
});

test("겹치는 source window, 끊긴 media window와 중복 clip 배정은 거부한다", () => {
  const first = mappingWindow("window-1", 0, 20_000, 0, 20_000, ["clip-a"]);
  const overlapping = mappingWindow(
    "window-2",
    19_000,
    30_000,
    20_000,
    31_000,
    ["clip-b"]
  );
  assert.equal(normalizeChzzkVodMaterialization(
    materialization([first, overlapping])
  ), null);

  const mediaGap = mappingWindow(
    "window-2",
    30_000,
    40_000,
    20_100,
    30_100,
    ["clip-b"]
  );
  assert.equal(normalizeChzzkVodMaterialization(
    materialization([first, mediaGap])
  ), null);

  const duplicateClip = mappingWindow(
    "window-2",
    30_000,
    40_000,
    20_000,
    30_000,
    ["clip-a"]
  );
  assert.equal(normalizeChzzkVodMaterialization(
    materialization([first, duplicateClip])
  ), null);
});

test("source absolute time과 compact media time을 양방향 매핑한다", () => {
  const mapping = materialization([
    mappingWindow("window-1", 0, 10_000, 0, 10_000),
    mappingWindow("window-2", 30_000, 40_000, 10_000, 20_000)
  ]);
  assert.equal(sourceMsToMediaMs(mapping, 5_000), 5_000);
  assert.equal(mediaMsToSourceMs(mapping, 5_000), 5_000);
  assert.equal(sourceMsToMediaMs(mapping, 35_000), 15_000);
  assert.equal(mediaMsToSourceMs(mapping, 15_000), 35_000);
});

test("source/media span 차이를 비율 보정으로 숨기지 않고 거부한다", () => {
  const drifted = mappingWindow("window-1", 0, 10_000, 0, 10_002);
  assert.equal(normalizeChzzkVodMaterialization(materialization([drifted])), null);
});

test("source gap과 half-open 끝점 및 compact media 끝점은 매핑하지 않는다", () => {
  const mapping = materialization([
    mappingWindow("window-1", 0, 10_000, 0, 10_000),
    mappingWindow("window-2", 30_000, 40_000, 10_000, 20_000)
  ]);
  assert.equal(sourceMsToMediaMs(mapping, 15_000), null);
  assert.equal(sourceMsToMediaMs(mapping, 10_000), null);
  assert.equal(mediaMsToSourceMs(mapping, 20_000), null);
  assert.equal(mediaMsToSourceMs(mapping, 10_000), 30_000);
  assert.equal(sourceMsToMediaMs(mapping, Number.NaN), null);
});

test("겹친 mapping은 모호한 source/media point를 fail-closed한다", () => {
  const ambiguous = {
    windows: [
      mappingWindow("window-1", 0, 10_000, 0, 10_000),
      mappingWindow("window-2", 5_000, 15_000, 5_000, 15_000)
    ]
  };
  assert.equal(sourceMsToMediaMs(ambiguous, 7_000), null);
  assert.equal(mediaMsToSourceMs(ambiguous, 7_000), null);
});

test("clip clone은 logical editable 범위 안에서만 compact source 좌표를 쓴다", () => {
  const mapping = materialization([
    {
      id: "window-1",
      editableSourceStartMs: 10_000,
      editableSourceEndMs: 20_000,
      fetchedSourceStartMs: 8_000,
      fetchedSourceEndMs: 22_000,
      mediaStartMs: 0,
      mediaEndMs: 14_000,
      clipIds: ["clip-a"]
    }
  ]);
  const clip = {
    id: "clip-a",
    sourceStartMs: 12_000,
    sourceEndMs: 18_000,
    untouched: "value"
  };
  assert.deepEqual(materializeEditorClip(clip, mapping), {
    ...clip,
    sourceStartMs: 4_000,
    sourceEndMs: 10_000
  });
  assert.deepEqual(clip, {
    id: "clip-a",
    sourceStartMs: 12_000,
    sourceEndMs: 18_000,
    untouched: "value"
  });
  assert.equal(materializeEditorClip({
    ...clip,
    sourceStartMs: 9_000
  }, mapping), null, "decoder prefix는 편집 가능한 handle이 아니다");
  assert.equal(materializeEditorClip({
    ...clip,
    sourceStartMs: 19_000,
    sourceEndMs: 23_000
  }, mapping), null);
});

test("clip 하나가 여러 local window 또는 source gap을 가로지를 수 없다", () => {
  const mapping = materialization([
    mappingWindow("window-1", 0, 10_000, 0, 10_000, ["clip-a"]),
    mappingWindow("window-2", 30_000, 40_000, 10_000, 20_000, ["clip-b"])
  ]);
  assert.equal(materializeEditorClip({
    sourceStartMs: 8_000,
    sourceEndMs: 32_000
  }, mapping), null);
});

test("clip logical bounds는 현재 trim이 아니라 원래 selection의 ±10초다", () => {
  assert.deepEqual(logicalEditableBoundsForClip({
    selectionStartMs: 5_000,
    selectionEndMs: 20_000
  }, 100_000), {
    editableSourceStartMs: 0,
    editableSourceEndMs: 30_000
  });
});

test("쇼츠 occurrence는 자체 ID가 아니라 원본 clip lineage와 불변 selection handle로 materialize한다", () => {
  const record = {
    ...materialization([{
      id: "window-parent-a",
      editableSourceStartMs: 90_000,
      editableSourceEndMs: 130_000,
      fetchedSourceStartMs: 88_000,
      fetchedSourceEndMs: 132_000,
      mediaStartMs: 0,
      mediaEndMs: 44_000,
      clipIds: ["parent-a"]
    }]),
    sourceDurationMs: 200_000
  };
  const occurrence = {
    id: "short-a-first",
    selectionStartMs: 105_000,
    selectionEndMs: 110_000,
    sourceStartMs: 95_000,
    sourceEndMs: 125_000,
    shortFormSourceClipId: "parent-a",
    shortFormSelectionStartMs: 100_000,
    shortFormSelectionEndMs: 120_000
  };

  assert.deepEqual(logicalEditableBoundsForClip(occurrence, 200_000), {
    editableSourceStartMs: 90_000,
    editableSourceEndMs: 130_000
  });
  assert.deepEqual(materializedEditableBoundsForClip(occurrence, record), {
    editableSourceStartMs: 90_000,
    editableSourceEndMs: 130_000,
    windowId: "window-parent-a",
    mediaStartMs: 2_000,
    mediaEndMs: 42_000
  });
  assert.deepEqual(materializeEditorClipWithinEditableBounds(occurrence, record), {
    ...occurrence,
    sourceStartMs: 7_000,
    sourceEndMs: 37_000
  });
  assert.deepEqual(materializeEditorClipWithinEditableBounds({
    ...occurrence,
    id: "short-a-repeat"
  }, record), {
    ...occurrence,
    id: "short-a-repeat",
    sourceStartMs: 7_000,
    sourceEndMs: 37_000
  });
});

test("clip의 logical source bounds와 compact media bounds를 함께 구한다", () => {
  const record = materialization([{
    id: "window-1",
    editableSourceStartMs: 0,
    editableSourceEndMs: 30_000,
    fetchedSourceStartMs: 0,
    fetchedSourceEndMs: 32_000,
    mediaStartMs: 0,
    mediaEndMs: 32_000,
    clipIds: ["clip-a"]
  }]);
  assert.deepEqual(materializedEditableBoundsForClip({
    id: "clip-a",
    selectionStartMs: 5_000,
    selectionEndMs: 20_000
  }, record), {
    editableSourceStartMs: 0,
    editableSourceEndMs: 30_000,
    windowId: "window-1",
    mediaStartMs: 0,
    mediaEndMs: 30_000
  });
  assert.equal(materializedEditableBoundsForClip({
    id: "wrong-clip",
    selectionStartMs: 5_000,
    selectionEndMs: 20_000
  }, record), null);
});

test("겹쳐 합쳐진 window에서도 각 clip은 자기 selection의 handle만 쓴다", () => {
  const record = {
    ...materialization([{
    id: "window-union",
    editableSourceStartMs: 90_000,
    editableSourceEndMs: 135_000,
    fetchedSourceStartMs: 88_000,
    fetchedSourceEndMs: 136_000,
    mediaStartMs: 0,
    mediaEndMs: 48_000,
    clipIds: ["clip-a", "clip-b"]
    }]),
    sourceDurationMs: 200_000
  };
  const valid = {
    id: "clip-a",
    selectionStartMs: 100_000,
    selectionEndMs: 110_000,
    sourceStartMs: 95_000,
    sourceEndMs: 120_000
  };
  assert.deepEqual(
    materializeEditorClipWithinEditableBounds(valid, record),
    { ...valid, sourceStartMs: 7_000, sourceEndMs: 32_000 }
  );
  assert.equal(materializeEditorClipWithinEditableBounds({
    ...valid,
    sourceEndMs: 130_000
  }, record), null, "clip B가 넓힌 union 범위를 clip A의 handle로 빌릴 수 없다");
});

test("편집 권리 확인은 정확히 같은 CHZZK contentId에만 재사용한다", () => {
  const confirmation = {
    scope: "owned-or-authorized-public-vod",
    contentId: "14252987",
    confirmedAt: "2026-08-10T00:00:00.000Z"
  };
  assert.deepEqual(
    normalizeChzzkVodRightsConfirmation(confirmation, "14252987"),
    confirmation
  );
  assert.equal(
    normalizeChzzkVodRightsConfirmation(confirmation, "99999999"),
    null
  );
  assert.equal(
    normalizeChzzkVodRightsConfirmation({ ...confirmation, token: "secret" }, "14252987"),
    null
  );
});

test("compact MP4는 manifest보다 짧지 않고 뒤쪽 여유만 250ms까지 허용한다", () => {
  const record = {
    ...materialization(),
    mediaDurationMs: 42_000
  };
  for (const [durationMs, expected] of [
    [41_751, false],
    [41_999, false],
    [41_999.5, true],
    [42_000, true],
    [42_250, true],
    [42_250.1, false]
  ] as const) {
    assert.equal(
      materializedMediaTimelineMatches(record, { durationMs, mediaOriginMs: 0 }),
      expected,
      `${durationMs}ms compact media boundary`
    );
  }
  assert.equal(materializedMediaTimelineMatches(record, {
    durationMs: record.mediaDurationMs,
    mediaOriginMs: 101
  }), false);
});
