import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorProjectFromCapture,
  type EditorAudioRegion,
  type EditorImageAsset,
  type EditorProject,
  type EditorSubtitleCue
} from "../src/lib/editor-core.js";
import {
  LEGACY_SHORT_FORM_SCHEMA_V6,
  LEGACY_SHORT_FORM_SCHEMA_V5,
  InvalidShortFormCompositeCanvasGapError,
  SHORT_FORM_ACCIDENTAL_EDGE_GAP_MAX_PX,
  SHORT_FORM_CANVAS_CLIP_ID,
  SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS,
  SHORT_FORM_MAX_VIDEO_LANES,
  SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS,
  SHORT_FORM_OUTPUT_HEIGHT,
  SHORT_FORM_OUTPUT_WIDTH,
  SHORT_FORM_SCHEMA,
  ShortFormVideoLayerLimitError,
  UnsupportedShortFormSchemaError,
  activeShortFormSourceAudioAsset,
  addShortFormSourceAudioAsset,
  addShortFormVideoLane,
  addShortFormVideoAsset,
  appendShortFormSlices,
  canAddShortFormVideoAsset,
  createDefaultShortFormBranch,
  createShortFormWorkspaceProject,
  detectShortFormCanvasEdgeGaps,
  detectShortFormCompositeCanvasGaps,
  deriveShortFormRenderProject,
  hasShortFormWorkspace,
  normalizeShortFormBranch,
  normalizeShortFormDestinationRect,
  normalizeShortFormSourceRect,
  normalizeShortFormVideoAssets,
  removeShortFormSourceAudioAsset,
  removeShortFormVideoAsset,
  repairShortFormCompositeCanvasGap,
  reorderShortFormVideoAssets,
  seedShortFormBranch,
  setShortFormCanvasDuration,
  squeegeeShortFormVideoAsset,
  shortFormBaseVideoLayerId,
  shortFormBranchFromWorkspace,
  shortFormCanvasContentRange,
  shortFormWorkspaceProjectWithBranch,
  shortFormVideoAssetsAtTimeline,
  shortFormVideoLayersAtTimeline,
  trimShortFormCanvasRange,
  trimShortFormCanvasToContent,
  updateShortFormSourceAudioAsset,
  updateShortFormVideoAsset,
  type ShortFormDestinationRect,
  type ShortFormSourceAudioAssetInput,
  type ShortFormSourceRect,
  type ShortFormVideoAssetInput
} from "../src/lib/short-form.js";

const sourceRect: ShortFormSourceRect = {
  x: 0.25,
  y: 0,
  width: 0.5,
  height: 1,
  referenceWidth: 1920,
  referenceHeight: 1080
};

const destinationRect: ShortFormDestinationRect = {
  x: 0,
  y: 0,
  width: 1080,
  height: 1920
};

function project(): EditorProject {
  return createEditorProjectFromCapture({
    projectName: "v7 black canvas",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "123",
      canonicalUrl: "https://chzzk.naver.com/video/123"
    },
    segments: [
      { id: "a", startSeconds: 10, endSeconds: 14 },
      { id: "b", startSeconds: 20, endSeconds: 24 }
    ]
  }, {
    id: "v7-project",
    createdAt: "2026-08-12T00:00:00.000Z"
  });
}

function videoInput(
  id: string,
  timelineStartMs = 0,
  timelineEndMs = 1_000,
  overrides: Partial<ShortFormVideoAssetInput> = {}
): ShortFormVideoAssetInput {
  const durationMs = timelineEndMs - timelineStartMs;
  return {
    id,
    sourceClipId: "clip-a",
    sourceSelectionStartMs: 10_000,
    sourceSelectionEndMs: 20_000,
    sourceStartMs: 10_000,
    sourceEndMs: 10_000 + durationMs,
    timelineStartMs,
    timelineEndMs,
    sourceRect,
    destinationRect,
    ...overrides
  };
}

function sourceAudioInput(
  id: string,
  timelineStartMs = 0,
  timelineEndMs = 1_000,
  overrides: Partial<ShortFormSourceAudioAssetInput> = {}
): ShortFormSourceAudioAssetInput {
  const durationMs = timelineEndMs - timelineStartMs;
  return {
    id,
    sourceClipId: "clip-a",
    sourceSelectionStartMs: 10_000,
    sourceSelectionEndMs: 20_000,
    sourceStartMs: 10_000,
    sourceEndMs: 10_000 + durationMs,
    timelineStartMs,
    timelineEndMs,
    ...overrides
  };
}

function subtitle(
  id: string,
  clipId: string,
  startOffsetMs: number,
  endOffsetMs: number
): EditorSubtitleCue {
  return {
    id,
    clipId,
    startOffsetMs,
    endOffsetMs,
    text: id,
    lane: 0,
    origin: "human",
    humanEdited: true,
    x: 0.5,
    y: 0.84,
    color: "#ffffff",
    confidence: null
  };
}

function image(
  id: string,
  clipId: string,
  startOffsetMs: number,
  endOffsetMs: number
): EditorImageAsset {
  return {
    id,
    clipId,
    startOffsetMs,
    endOffsetMs,
    name: `${id}.png`,
    mimeType: "image/png",
    source: { kind: "blob-key", value: id },
    sourceUrl: "",
    x: 0.5,
    y: 0.5,
    scale: 1,
    opacity: 1,
    naturalWidth: 100,
    naturalHeight: 100
  };
}

function audioRegion(
  id: string,
  clipId: string,
  startOffsetMs: number,
  endOffsetMs: number
): EditorAudioRegion {
  return {
    id,
    clipId,
    startOffsetMs,
    endOffsetMs,
    gain: 0.8,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0
  };
}

test("v7 기본 문서는 검은 캔버스와 영상 lane·독립 asset 배열만 영속화한다", () => {
  const branch = createDefaultShortFormBranch();
  assert.equal(SHORT_FORM_SCHEMA, "kirinuki-short-form/v7");
  assert.equal(branch.schema, SHORT_FORM_SCHEMA);
  assert.deepEqual(branch.output, {
    width: SHORT_FORM_OUTPUT_WIDTH,
    height: SHORT_FORM_OUTPUT_HEIGHT
  });
  assert.equal(branch.durationMs, 3_000);
  assert.equal(branch.videoLaneCount, 1);
  assert.deepEqual(branch.videoAssets, []);
  assert.deepEqual(branch.sourceAudioAssets, []);
  assert.deepEqual(branch.clips, []);
  assert.deepEqual(branch.scenes, []);

  const persisted = JSON.parse(JSON.stringify(branch)) as Record<string, unknown>;
  assert.equal("clips" in persisted, false);
  assert.equal("scenes" in persisted, false);
  assert.equal(Array.isArray(persisted.videoAssets), true);
  assert.equal(Array.isArray(persisted.sourceAudioAssets), true);
  assert.equal(hasShortFormWorkspace(persisted), true);
});

test("v6 영상은 시간순 greedy first-fit lane과 unity audioGain으로 결정적으로 v7 이행한다", () => {
  const legacy = {
    ...createDefaultShortFormBranch(),
    schema: LEGACY_SHORT_FORM_SCHEMA_V6,
    durationMs: 3_000,
    videoAssets: [
      videoInput("late", 2_000, 3_000, { audioGain: 0.2, lane: 8 }),
      videoInput("middle", 500, 1_500),
      videoInput("base", 0, 2_000),
      videoInput("reuse", 1_500, 2_500)
    ].map(({ lane: _lane, audioGain: _audioGain, ...asset }) => asset),
    sourceAudioAssets: [sourceAudioInput("legacy-settings", 0, 2_000, {
      gain: 0.35,
      muted: false,
      fadeInMs: 100,
      fadeOutMs: 200
    })]
  };
  const first = normalizeShortFormBranch(legacy);
  const second = normalizeShortFormBranch(structuredClone(legacy));

  assert.equal(first.schema, SHORT_FORM_SCHEMA);
  assert.equal(first.videoLaneCount, 2);
  assert.deepEqual(first.videoAssets.map(({ id, lane, audioGain }) => ({
    id,
    lane,
    audioGain
  })), [
    { id: "late", lane: 0, audioGain: 1 },
    { id: "middle", lane: 1, audioGain: 1 },
    { id: "base", lane: 0, audioGain: 1 },
    { id: "reuse", lane: 1, audioGain: 1 }
  ]);
  assert.deepEqual(
    first.videoAssets.map(({ id, lane }) => [id, lane]),
    second.videoAssets.map(({ id, lane }) => [id, lane])
  );
  assert.deepEqual(first.sourceAudioAssets.map(({ gain, fadeInMs, fadeOutMs }) => ({
    gain,
    fadeInMs,
    fadeOutMs
  })), [{ gain: 0.35, fadeInMs: 100, fadeOutMs: 200 }]);

  const reopened = normalizeShortFormBranch(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(reopened, first);
});

test("v7 영상 audioGain·lane 경계와 same-lane half-open 충돌을 정규화한다", () => {
  const normalized = normalizeShortFormVideoAssets([
    videoInput("zero", 0, 1_000, { lane: 0, audioGain: -1 }),
    videoInput("collision-hidden", 500, 900, {
      lane: 0,
      audioGain: 1,
      visible: false
    }),
    videoInput("adjacent", 1_000, 2_000, { lane: 0, audioGain: 3 }),
    videoInput("parallel", 500, 1_500, { lane: 1 }),
    videoInput("missing", 2_000, 3_000)
  ], 3_000, 2);

  assert.deepEqual(normalized.map(({ id, lane, audioGain }) => ({
    id,
    lane,
    audioGain
  })), [
    { id: "zero", lane: 0, audioGain: 0 },
    { id: "adjacent", lane: 0, audioGain: 2 },
    { id: "parallel", lane: 1, audioGain: 1 },
    { id: "missing", lane: 0, audioGain: 1 }
  ]);
});

test("영상 add는 requested/first-free lane을 쓰고 helper는 빈 lane을 최대 9줄까지 늘린다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("first", 0, 1_000, { audioGain: 2 })
  );
  branch = addShortFormVideoAsset(branch, videoInput("second", 0, 1_000));
  assert.equal(branch.videoLaneCount, 2);
  assert.deepEqual(branch.videoAssets.map(({ id, lane, audioGain }) => ({
    id,
    lane,
    audioGain
  })), [
    { id: "first", lane: 0, audioGain: 2 },
    { id: "second", lane: 1, audioGain: 1 }
  ]);

  assert.throws(
    () => updateShortFormVideoAsset(branch, "second", { lane: 0 }),
    ShortFormVideoLayerLimitError
  );
  branch = updateShortFormVideoAsset(branch, "second", {
    lane: 0,
    timelineStartMs: 1_000,
    timelineEndMs: 2_000,
    sourceStartMs: 11_000,
    sourceEndMs: 12_000,
    audioGain: 0
  });
  assert.deepEqual((({ lane, audioGain, timelineStartMs, timelineEndMs }) => ({
    lane,
    audioGain,
    timelineStartMs,
    timelineEndMs
  }))(branch.videoAssets.find(({ id }) => id === "second")!), {
    lane: 0,
    audioGain: 0,
    timelineStartMs: 1_000,
    timelineEndMs: 2_000
  });

  const revisionBeforeLane = branch.revision;
  branch = addShortFormVideoLane(branch);
  assert.equal(branch.videoLaneCount, 3);
  assert.equal(branch.revision, revisionBeforeLane + 1);
  while (branch.videoLaneCount < SHORT_FORM_MAX_VIDEO_LANES) {
    branch = addShortFormVideoLane(branch);
  }
  const capped = addShortFormVideoLane(branch);
  assert.equal(capped.videoLaneCount, SHORT_FORM_MAX_VIDEO_LANES);
  assert.equal(capped.revision, branch.revision);

  const requested = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("requested-last", 0, 1_000, {
      lane: SHORT_FORM_MAX_VIDEO_LANES - 1
    })
  );
  assert.equal(requested.videoLaneCount, SHORT_FORM_MAX_VIDEO_LANES);
  assert.equal(requested.videoAssets[0]?.lane, SHORT_FORM_MAX_VIDEO_LANES - 1);
  assert.throws(
    () => addShortFormVideoAsset(
      requested,
      videoInput("bad-lane", 1_000, 2_000, {
        lane: SHORT_FORM_MAX_VIDEO_LANES
      })
    ),
    RangeError
  );
});

test("source crop은 위치를 먼저 고정하고 남은 frame 안에서 크기를 제한한다", () => {
  const normalized = normalizeShortFormSourceRect({
    x: 0.9,
    y: 0.8,
    width: 0.5,
    height: 0.5,
    referenceWidth: 100,
    referenceHeight: 100
  });
  assert.ok(normalized);
  assert.equal(normalized.x, 0.9);
  assert.equal(normalized.y, 0.8);
  assert.ok(Math.abs(normalized.width - 0.1) < Number.EPSILON);
  assert.ok(Math.abs(normalized.height - 0.2) < Number.EPSILON);
  assert.equal(normalized.referenceWidth, 100);
  assert.equal(normalized.referenceHeight, 100);
  assert.equal(normalizeShortFormSourceRect({
    ...sourceRect,
    width: 0
  }), null);
  assert.deepEqual(normalizeShortFormDestinationRect(destinationRect), destinationRect);
  assert.equal(normalizeShortFormDestinationRect({ ...destinationRect, width: 0 }), null);
});

test("거의 전체 화면 영상의 1~24px 검은 가장자리만 휴먼에러로 탐지한다", () => {
  const asset = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("seamed", 0, 1_000, {
      destinationRect: {
        x: 1,
        y: SHORT_FORM_ACCIDENTAL_EDGE_GAP_MAX_PX,
        width: SHORT_FORM_OUTPUT_WIDTH - 3,
        height: SHORT_FORM_OUTPUT_HEIGHT - SHORT_FORM_ACCIDENTAL_EDGE_GAP_MAX_PX - 4
      }
    })
  ).videoAssets[0]!;

  assert.deepEqual(detectShortFormCanvasEdgeGaps(asset), [
    { edge: "left", pixels: 1 },
    { edge: "right", pixels: 2 },
    { edge: "top", pixels: 24 },
    { edge: "bottom", pixels: 4 }
  ]);
});

test("밀대로 밀기는 선택한 방향만 캔버스 끝까지 늘리고 source crop을 보존한다", () => {
  const asset = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("squeegee", 0, 1_000, {
      destinationRect: { x: 8, y: 12, width: 1_060, height: 1_892 }
    })
  ).videoAssets[0]!;
  const expectations = [
    ["left", { x: 0, y: 12, width: 1_068, height: 1_892 }],
    ["right", { x: 8, y: 12, width: 1_072, height: 1_892 }],
    ["top", { x: 8, y: 0, width: 1_060, height: 1_904 }],
    ["bottom", { x: 8, y: 12, width: 1_060, height: 1_908 }],
    ["all", { x: 0, y: 0, width: 1_080, height: 1_920 }]
  ] as const;

  for (const [direction, expectedDestinationRect] of expectations) {
    const swept = squeegeeShortFormVideoAsset(asset, direction);
    assert.deepEqual(swept.destinationRect, expectedDestinationRect, direction);
    assert.deepEqual(swept.sourceRect, asset.sourceRect, direction);
  }
});

test("의도적인 큰 여백은 가장자리 휴먼에러로 탐지하거나 밀지 않는다", () => {
  const asset = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("intentional-margin", 0, 1_000, {
      destinationRect: { x: 12, y: 200, width: 1_056, height: 1_520 }
    })
  ).videoAssets[0]!;

  assert.deepEqual(detectShortFormCanvasEdgeGaps(asset), []);
  assert.strictEqual(squeegeeShortFormVideoAsset(asset, "left"), asset);
  assert.strictEqual(squeegeeShortFormVideoAsset(asset, "all"), asset);
});

test("숨김 또는 완전 투명한 영상은 가장자리 검사와 밀기에서 제외한다", () => {
  const base = videoInput("invisible", 0, 1_000, {
    destinationRect: { x: 2, y: 3, width: 1_076, height: 1_914 }
  });
  const hidden = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    { ...base, visible: false }
  ).videoAssets[0]!;
  const transparent = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    { ...base, id: "transparent", opacity: 0 }
  ).videoAssets[0]!;

  for (const asset of [hidden, transparent]) {
    assert.deepEqual(detectShortFormCanvasEdgeGaps(asset), []);
    assert.strictEqual(squeegeeShortFormVideoAsset(asset, "all"), asset);
  }
});

test("합성 검사는 전체 화면 base가 inset overlay의 에셋별 오탐을 덮으면 경고하지 않는다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("base")
  );
  branch = addShortFormVideoAsset(branch, videoInput("near-full-overlay", 0, 1_000, {
    destinationRect: { x: 1, y: 1, width: 1_078, height: 1_918 },
    zIndex: 10
  }));
  assert.equal(detectShortFormCanvasEdgeGaps(branch.videoAssets[1]!).length, 4);
  assert.deepEqual(detectShortFormCompositeCanvasGaps(branch), []);
});

test("합성 검사는 좌우 타일 사이의 1px 내부 seam과 고칠 에셋 방향을 찾는다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("left-tile", 0, 1_000, {
      destinationRect: { x: 0, y: 0, width: 540, height: 1_920 }
    })
  );
  branch = addShortFormVideoAsset(branch, videoInput("right-tile", 0, 1_000, {
    destinationRect: { x: 541, y: 0, width: 539, height: 1_920 }
  }));

  assert.deepEqual(detectShortFormCompositeCanvasGaps(branch), [{
    timelineStartMs: 0,
    timelineEndMs: 1_000,
    kind: "seam",
    rect: { x: 540, y: 0, width: 1, height: 1_920 },
    thicknessPx: 1,
    directions: ["left", "right"],
    relatedAssetIds: ["left-tile", "right-tile"],
    repairs: [
      { assetId: "left-tile", directions: ["right"] },
      { assetId: "right-tile", directions: ["left"] }
    ]
  }]);
});

test("합성 검사는 active set이 일정한 half-open 구간별로만 결과를 낸다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("left", 250, 750, {
      destinationRect: { x: 0, y: 0, width: 540, height: 1_920 }
    })
  );
  branch = addShortFormVideoAsset(branch, videoInput("right", 250, 750, {
    destinationRect: { x: 541, y: 0, width: 539, height: 1_920 }
  }));
  branch = addShortFormVideoAsset(branch, videoInput("temporary-cover", 500, 600));

  assert.deepEqual(detectShortFormCompositeCanvasGaps(branch).map((finding) => ({
    start: finding.timelineStartMs,
    end: finding.timelineEndMs,
    rect: finding.rect
  })), [
    { start: 250, end: 500, rect: { x: 540, y: 0, width: 1, height: 1_920 } },
    { start: 600, end: 750, rect: { x: 540, y: 0, width: 1, height: 1_920 } }
  ]);
});

test("합성 검사는 여러 영상이 만든 10px 내부 구멍을 하나의 hole로 찾는다", () => {
  let branch = createDefaultShortFormBranch();
  const rectangles: ReadonlyArray<readonly [string, ShortFormDestinationRect]> = [
    ["top", { x: 0, y: 0, width: 1_080, height: 955 }],
    ["bottom", { x: 0, y: 965, width: 1_080, height: 955 }],
    ["left", { x: 0, y: 955, width: 535, height: 10 }],
    ["right", { x: 545, y: 955, width: 535, height: 10 }]
  ];
  for (const [id, rect] of rectangles) {
    branch = addShortFormVideoAsset(branch, videoInput(id, 0, 1_000, {
      destinationRect: rect
    }));
  }
  const [finding] = detectShortFormCompositeCanvasGaps(branch);
  assert.ok(finding);
  assert.equal(finding.kind, "hole");
  assert.deepEqual(finding.rect, { x: 535, y: 955, width: 10, height: 10 });
  assert.deepEqual(new Set(finding.relatedAssetIds), new Set(["top", "bottom", "left", "right"]));
});

test("합성 검사는 1~24px의 거의 전체 화면 외곽 틈을 방향별로 찾는다", () => {
  const branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("almost-full", 0, 1_000, {
      destinationRect: { x: 1, y: 24, width: 1_077, height: 1_892 }
    })
  );
  const findings = detectShortFormCompositeCanvasGaps(branch);
  assert.deepEqual(findings.map(({ kind, rect, directions }) => ({
    kind,
    rect,
    directions
  })), [
    {
      kind: "edge",
      rect: { x: 0, y: 0, width: 1_080, height: 24 },
      directions: ["top"]
    },
    {
      kind: "edge",
      rect: { x: 0, y: 24, width: 1, height: 1_892 },
      directions: ["left"]
    },
    {
      kind: "edge",
      rect: { x: 1_078, y: 24, width: 2, height: 1_892 },
      directions: ["right"]
    },
    {
      kind: "edge",
      rect: { x: 0, y: 1_916, width: 1_080, height: 4 },
      directions: ["bottom"]
    }
  ]);
});

test("합성 검사는 의도적인 큰 여백과 그 여백에 이어진 좁은 통로를 경고하지 않는다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("right-content", 0, 1_000, {
      destinationRect: { x: 100, y: 0, width: 980, height: 1_920 }
    })
  );
  branch = addShortFormVideoAsset(branch, videoInput("middle-left", 0, 1_000, {
    destinationRect: { x: 0, y: 800, width: 99, height: 320 }
  }));
  assert.deepEqual(detectShortFormCompositeCanvasGaps(branch), []);

  const intentionalDivider = addShortFormVideoAsset(
    addShortFormVideoAsset(
      createDefaultShortFormBranch(),
      videoInput("divider-left", 0, 1_000, {
        destinationRect: { x: 0, y: 0, width: 490, height: 1_920 }
      })
    ),
    videoInput("divider-right", 0, 1_000, {
      destinationRect: { x: 590, y: 0, width: 490, height: 1_920 }
    })
  );
  assert.deepEqual(detectShortFormCompositeCanvasGaps(intentionalDivider), []);
});

test("합성 검사는 24px 경계까지만 찾고 숨김·투명 레이어는 덮개로 세지 않는다", () => {
  const twentyFour = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("24px", 0, 1_000, {
      destinationRect: { x: 24, y: 0, width: 1_056, height: 1_920 }
    })
  );
  assert.equal(detectShortFormCompositeCanvasGaps(twentyFour)[0]?.thicknessPx, 24);

  const twentyFive = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("25px", 0, 1_000, {
      destinationRect: { x: 25, y: 0, width: 1_055, height: 1_920 }
    })
  );
  assert.deepEqual(detectShortFormCompositeCanvasGaps(twentyFive), []);

  let tiled = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("left-visible", 0, 1_000, {
      destinationRect: { x: 0, y: 0, width: 540, height: 1_920 }
    })
  );
  tiled = addShortFormVideoAsset(tiled, videoInput("right-visible", 0, 1_000, {
    destinationRect: { x: 541, y: 0, width: 539, height: 1_920 }
  }));
  tiled = addShortFormVideoAsset(tiled, {
    ...videoInput("hidden-cover", 0, 1_000),
    visible: false
  });
  tiled = addShortFormVideoAsset(tiled, {
    ...videoInput("transparent-cover", 0, 1_000),
    opacity: 0
  });
  assert.equal(detectShortFormCompositeCanvasGaps(tiled)[0]?.rect.width, 1);
});

test("합성 seam 수정은 양쪽 에셋 edge만 늘리고 나머지 영상 데이터를 보존한다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("repair-left", 0, 1_000, {
      destinationRect: { x: 0, y: 0, width: 540, height: 1_920 },
      opacity: 0.7,
      zIndex: 4
    })
  );
  branch = addShortFormVideoAsset(branch, videoInput("repair-right", 0, 1_000, {
    destinationRect: { x: 541, y: 0, width: 539, height: 1_920 },
    zIndex: 8
  }));
  branch.selectedVideoLayerId = "repair-right";
  const originals = new Map(branch.videoAssets.map((asset) => [
    asset.id,
    structuredClone(asset)
  ]));
  const [finding] = detectShortFormCompositeCanvasGaps(branch);
  assert.ok(finding);

  const repaired = repairShortFormCompositeCanvasGap(branch, finding);
  assert.deepEqual(
    repaired.videoAssets.find(({ id }) => id === "repair-left")?.destinationRect,
    { x: 0, y: 0, width: 541, height: 1_920 }
  );
  assert.deepEqual(
    repaired.videoAssets.find(({ id }) => id === "repair-right")?.destinationRect,
    { x: 540, y: 0, width: 540, height: 1_920 }
  );
  for (const asset of repaired.videoAssets) {
    const original = originals.get(asset.id);
    assert.ok(original);
    assert.deepEqual(asset.sourceRect, original.sourceRect);
    const { destinationRect: _oldDestination, ...oldOtherFields } = original;
    const { destinationRect: _newDestination, ...newOtherFields } = asset;
    assert.deepEqual(newOtherFields, oldOtherFields);
  }
  assert.equal(repaired.selectedVideoLayerId, "repair-right");
  assert.equal(repaired.revision, branch.revision + 1);
  assert.deepEqual(detectShortFormCompositeCanvasGaps(repaired), []);
});

test("합성 hole 수정은 인접 edge를 확장해 내부 검은 구멍을 없앤다", () => {
  let branch = createDefaultShortFormBranch();
  const rectangles: ReadonlyArray<readonly [string, ShortFormDestinationRect]> = [
    ["hole-top", { x: 0, y: 0, width: 1_080, height: 955 }],
    ["hole-bottom", { x: 0, y: 965, width: 1_080, height: 955 }],
    ["hole-left", { x: 0, y: 955, width: 535, height: 10 }],
    ["hole-right", { x: 545, y: 955, width: 535, height: 10 }]
  ];
  for (const [id, rect] of rectangles) {
    branch = addShortFormVideoAsset(branch, videoInput(id, 0, 1_000, {
      destinationRect: rect
    }));
  }
  const finding = detectShortFormCompositeCanvasGaps(branch).find(({ kind }) => (
    kind === "hole"
  ));
  assert.ok(finding);
  const repaired = repairShortFormCompositeCanvasGap(branch, finding);
  assert.deepEqual(detectShortFormCompositeCanvasGaps(repaired), []);
  assert.equal(
    repaired.videoAssets.find(({ id }) => id === "hole-left")
      ?.destinationRect.width,
    545
  );
  assert.equal(
    repaired.videoAssets.find(({ id }) => id === "hole-top")
      ?.destinationRect.height,
    965
  );
});

test("합성 outer-edge 수정은 캔버스 경계까지 destination만 확장한다", () => {
  const branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("outer-edge", 0, 1_000, {
      destinationRect: { x: 15, y: 0, width: 1_065, height: 1_920 }
    })
  );
  const [finding] = detectShortFormCompositeCanvasGaps(branch);
  assert.ok(finding);
  assert.equal(finding.kind, "edge");
  assert.deepEqual(finding.directions, ["left"]);
  const repaired = repairShortFormCompositeCanvasGap(branch, finding);
  assert.deepEqual(repaired.videoAssets[0]?.destinationRect, destinationRect);
  assert.deepEqual(repaired.videoAssets[0]?.sourceRect, branch.videoAssets[0]?.sourceRect);
  assert.deepEqual(detectShortFormCompositeCanvasGaps(repaired), []);
});

test("합성 수정은 stale 또는 조작된 검사 결과를 fail closed한다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("stale-left", 0, 1_000, {
      destinationRect: { x: 0, y: 0, width: 540, height: 1_920 }
    })
  );
  branch = addShortFormVideoAsset(branch, videoInput("stale-right", 0, 1_000, {
    destinationRect: { x: 541, y: 0, width: 539, height: 1_920 }
  }));
  const [finding] = detectShortFormCompositeCanvasGaps(branch);
  assert.ok(finding);

  assert.throws(() => repairShortFormCompositeCanvasGap(branch, {
    ...finding,
    repairs: finding.repairs.map((repair, index) => index === 0
      ? { ...repair, directions: ["top"] }
      : repair)
  }), InvalidShortFormCompositeCanvasGapError);

  const changed = updateShortFormVideoAsset(branch, "stale-left", {
    destinationRect: { x: 0, y: 0, width: 541, height: 1_920 }
  });
  assert.throws(
    () => repairShortFormCompositeCanvasGap(changed, finding),
    InvalidShortFormCompositeCanvasGapError
  );
  assert.deepEqual(
    changed.videoAssets.find(({ id }) => id === "stale-right")?.destinationRect,
    { x: 541, y: 0, width: 539, height: 1_920 }
  );
});

test("v5 implicit base와 overlay는 v7 전역 영상 및 명시적 원본 음성으로 이행한다", () => {
  const migrated = normalizeShortFormBranch({
    schema: LEGACY_SHORT_FORM_SCHEMA_V5,
    clips: [
      {
        id: "old-a",
        selectionId: "selection-a",
        sourceStartMs: 10_000,
        sourceEndMs: 12_000,
        selectionStartMs: 9_000,
        selectionEndMs: 13_000,
        timelineStartMs: 0,
        enabled: true
      },
      {
        id: "old-b",
        selectionId: "selection-b",
        sourceStartMs: 20_000,
        sourceEndMs: 23_000,
        selectionStartMs: 20_000,
        selectionEndMs: 23_000,
        timelineStartMs: 2_000,
        enabled: true
      }
    ],
    scenes: [
      {
        clipId: "old-a",
        sourceClipId: "parent-a",
        selectionId: "selection-a",
        fit: "cover",
        positionX: 0.7,
        positionY: 0.2,
        zoom: 1.4,
        canvasX: 0.5,
        canvasY: 0.5,
        canvasScale: 1,
        sourceRect,
        destinationRect,
        videoLayers: [{
          id: "overlay",
          sourceAssetId: "project-primary",
          sourceClipId: "parent-b",
          sourceSelectionStartMs: 20_000,
          sourceSelectionEndMs: 24_000,
          sourceStartMs: 20_000,
          sourceEndMs: 21_000,
          startOffsetMs: 500,
          endOffsetMs: 1_500,
          sourceRect,
          destinationRect,
          opacity: 0.8,
          visible: true,
          zIndex: 3
        }]
      },
      {
        clipId: "old-b",
        sourceClipId: "parent-b",
        selectionId: "selection-b",
        fit: "contain",
        sourceRect,
        destinationRect
      }
    ],
    subtitles: [subtitle("legacy-cue", "old-b", 100, 900)],
    imageAssets: [],
    audioRegions: []
  });

  assert.equal(migrated.schema, SHORT_FORM_SCHEMA);
  assert.equal(migrated.durationMs, 5_000);
  assert.deepEqual(migrated.videoAssets.map((asset) => ({
    id: asset.id,
    start: asset.timelineStartMs,
    end: asset.timelineEndMs,
    sourceClipId: asset.sourceClipId
  })), [
    {
      id: shortFormBaseVideoLayerId("old-a"),
      start: 0,
      end: 2_000,
      sourceClipId: "parent-a"
    },
    {
      id: shortFormBaseVideoLayerId("old-b"),
      start: 2_000,
      end: 5_000,
      sourceClipId: "parent-b"
    },
    { id: "overlay", start: 500, end: 1_500, sourceClipId: "parent-b" }
  ]);
  assert.equal(migrated.sourceAudioAssets.length, 2);
  assert.deepEqual(migrated.sourceAudioAssets.map((asset) => [
    asset.timelineStartMs,
    asset.timelineEndMs
  ]), [[0, 2_000], [2_000, 5_000]]);
  assert.equal(migrated.subtitles[0]?.clipId, SHORT_FORM_CANVAS_CLIP_ID);
  assert.deepEqual([
    migrated.subtitles[0]?.startOffsetMs,
    migrated.subtitles[0]?.endOffsetMs
  ], [2_100, 2_900]);
  assert.equal(migrated.scenes[0]?.videoLayers?.[0]?.id, "overlay");
});

test("foreign source registry 자산은 v7와 legacy 양쪽에서 정규화하지 않는다", () => {
  const valid = videoInput("valid");
  assert.deepEqual(normalizeShortFormVideoAssets([
    valid,
    { ...valid, id: "foreign", sourceAssetId: "foreign-file" }
  ], 3_000).map((asset) => asset.id), ["valid"]);

  const migrated = normalizeShortFormBranch({
    schema: LEGACY_SHORT_FORM_SCHEMA_V5,
    clips: [{
      id: "old",
      selectionId: "old",
      sourceStartMs: 10_000,
      sourceEndMs: 12_000,
      selectionStartMs: 10_000,
      selectionEndMs: 12_000,
      timelineStartMs: 0,
      enabled: true
    }],
    scenes: [{
      clipId: "old",
      sourceClipId: "clip-a",
      selectionId: "old",
      fit: "cover",
      sourceRect,
      destinationRect,
      videoLayers: [{
        id: "foreign-overlay",
        sourceAssetId: "foreign-file",
        sourceClipId: "clip-a",
        sourceSelectionStartMs: 10_000,
        sourceSelectionEndMs: 12_000,
        sourceStartMs: 10_000,
        sourceEndMs: 11_000,
        startOffsetMs: 0,
        endOffsetMs: 1_000,
        sourceRect,
        destinationRect
      }]
    }]
  });
  assert.equal(migrated.videoAssets.some(({ id }) => id === "foreign-overlay"), false);
});

test("append slice는 원본 clip 경계로 자르고 영상+원본 음성을 순차 추가한다", () => {
  const parent = project();
  const [clipA] = parent.clips;
  assert.ok(clipA);
  parent.subtitles = [subtitle("cue", clipA.id, 500, 3_500)];
  parent.imageAssets = [image("image", clipA.id, 1_000, 2_000)];
  parent.audioRegions = [audioRegion("region", clipA.id, 2_000, 3_000)];

  const first = appendShortFormSlices(parent, createDefaultShortFormBranch(), [{
    sourceClipId: clipA.id,
    sourceStartMs: 9_000,
    sourceEndMs: 15_000,
    sourceRect,
    destinationRect
  }]);
  assert.equal(first.durationMs, 4_000);
  assert.deepEqual(first.videoAssets.map((asset) => [
    asset.sourceStartMs,
    asset.sourceEndMs,
    asset.timelineStartMs,
    asset.timelineEndMs
  ]), [[10_000, 14_000, 0, 4_000]]);
  assert.equal(first.sourceAudioAssets.length, 1);
  assert.equal(first.subtitles.length, 1);
  assert.equal(first.imageAssets.length, 1);
  assert.equal(first.audioRegions.length, 1);
  assert.equal(first.subtitles[0]?.clipId, SHORT_FORM_CANVAS_CLIP_ID);

  const second = appendShortFormSlices(parent, first, [{
    sourceClipId: clipA.id,
    sourceStartMs: 11_000,
    sourceEndMs: 13_000,
    sourceRect,
    destinationRect
  }]);
  assert.equal(second.durationMs, 6_000);
  assert.deepEqual(second.videoAssets.map((asset) => [
    asset.timelineStartMs,
    asset.timelineEndMs
  ]), [[0, 4_000], [4_000, 6_000]]);
  assert.deepEqual(second.sourceAudioAssets.map((asset) => [
    asset.timelineStartMs,
    asset.timelineEndMs
  ]), [[0, 4_000], [4_000, 6_000]]);
});

test("append slice는 64개 영상 경계에서 음성·timed item·canvas 꼬리를 함께 fail closed한다", () => {
  const parent = project();
  const clipA = parent.clips[0]!;
  parent.subtitles = [subtitle("cue", clipA.id, 100, 900)];
  parent.imageAssets = [image("image", clipA.id, 100, 900)];
  parent.audioRegions = [audioRegion("region", clipA.id, 100, 900)];
  const request = {
    sourceClipId: clipA.id,
    sourceStartMs: clipA.sourceStartMs,
    sourceEndMs: clipA.sourceEndMs,
    sourceRect,
    destinationRect
  };
  const clipDuration = clipA.sourceEndMs - clipA.sourceStartMs;

  const full = appendShortFormSlices(
    parent,
    createDefaultShortFormBranch(),
    Array.from({ length: SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS }, () => request)
  );
  assert.equal(full.videoAssets.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(full.sourceAudioAssets.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(full.subtitles.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(full.imageAssets.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(full.audioRegions.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(
    full.durationMs,
    SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS * clipDuration
  );

  assert.throws(
    () => appendShortFormSlices(parent, full, [request]),
    (error: unknown) => (
      error instanceof ShortFormVideoLayerLimitError
      && error.message.includes(`최대 ${SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS}개`)
    )
  );
  assert.equal(full.videoAssets.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(full.sourceAudioAssets.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
  assert.equal(
    full.durationMs,
    SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS * clipDuration
  );
});

test("영상 lane 9개 제한은 숨김 여부와 무관하고 half-open 경계로 계산한다", () => {
  let branch = createDefaultShortFormBranch();
  for (let index = 0; index < SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS; index += 1) {
    branch = addShortFormVideoAsset(branch, videoInput(`video-${index}`));
  }
  assert.equal(branch.videoAssets.length, SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS);
  assert.equal(canAddShortFormVideoAsset(branch, 0, 1_000), false);
  assert.equal(canAddShortFormVideoAsset(branch, 1_000, 2_000), true);
  assert.throws(
    () => addShortFormVideoAsset(branch, videoInput("overflow")),
    ShortFormVideoLayerLimitError
  );
  assert.throws(
    () => addShortFormVideoAsset(branch, {
      ...videoInput("hidden"),
      visible: false
    }),
    ShortFormVideoLayerLimitError
  );
  assert.throws(
    () => addShortFormVideoAsset(branch, {
      ...videoInput("transparent"),
      opacity: 0
    }),
    ShortFormVideoLayerLimitError
  );
  const adjacent = addShortFormVideoAsset(
    branch,
    videoInput("adjacent", 1_000, 2_000)
  );
  assert.equal(adjacent.videoAssets.length, SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS + 1);

  const normalized = normalizeShortFormVideoAssets(
    Array.from({ length: SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS + 4 }, (_, index) => (
      videoInput(`total-${index}`, index * 1_000, (index + 1) * 1_000)
    )),
    100_000
  );
  assert.equal(normalized.length, SHORT_FORM_MAX_TOTAL_VIDEO_ASSETS);
});

test("첫 A/V 영상 삭제는 결합 원본 음성만 함께 지우고 캔버스·자막·사진은 보존한다", () => {
  const parent = project();
  const clipA = parent.clips[0]!;
  parent.subtitles = [subtitle("cue", clipA.id, 100, 900)];
  parent.imageAssets = [image("image", clipA.id, 100, 900)];
  const added = appendShortFormSlices(parent, createDefaultShortFormBranch(), [{
    sourceClipId: clipA.id,
    sourceStartMs: clipA.sourceStartMs,
    sourceEndMs: clipA.sourceEndMs,
    sourceRect,
    destinationRect
  }]);
  const firstVideo = added.videoAssets[0]!;
  const removed = removeShortFormVideoAsset(added, firstVideo.id);
  assert.deepEqual(removed.videoAssets, []);
  assert.equal(removed.durationMs, added.durationMs);
  assert.deepEqual(removed.sourceAudioAssets, []);
  assert.deepEqual(removed.subtitles, added.subtitles);
  assert.deepEqual(removed.imageAssets, added.imageAssets);
  assert.deepEqual(shortFormVideoAssetsAtTimeline(removed, 500), []);
});

test("영상 update와 reorder는 시간·geometry·z-order를 독립적으로 보존한다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("back", 0, 2_000)
  );
  branch = addShortFormVideoAsset(
    branch,
    videoInput("front", 500, 1_500, { zIndex: 9 })
  );
  branch = updateShortFormVideoAsset(branch, "front", {
    destinationRect: { x: 540, y: 960, width: 540, height: 960 },
    opacity: 0.6
  });
  assert.equal(branch.videoAssets.find(({ id }) => id === "front")?.opacity, 0.6);
  assert.deepEqual(
    branch.videoAssets.find(({ id }) => id === "front")?.destinationRect,
    { x: 540, y: 960, width: 540, height: 960 }
  );
  branch = reorderShortFormVideoAssets(branch, ["front", "back"]);
  assert.deepEqual(branch.videoAssets.map(({ id, zIndex }) => ({ id, zIndex })), [
    { id: "front", zIndex: 0 },
    { id: "back", zIndex: 1 }
  ]);
  assert.deepEqual(shortFormVideoAssetsAtTimeline(branch, 750).map(({ id }) => id), [
    "front",
    "back"
  ]);
});

test("원본 음성 에셋은 영상과 별도로 추가·수정·삭제한다", () => {
  let branch = addShortFormSourceAudioAsset(
    createDefaultShortFormBranch(),
    sourceAudioInput("voice-a")
  );
  assert.equal(activeShortFormSourceAudioAsset(branch, 500)?.id, "voice-a");
  branch = updateShortFormSourceAudioAsset(branch, "voice-a", {
    gain: 0.4,
    muted: true,
    fadeInMs: 100
  });
  assert.deepEqual({
    gain: branch.sourceAudioAssets[0]?.gain,
    muted: branch.sourceAudioAssets[0]?.muted,
    fadeInMs: branch.sourceAudioAssets[0]?.fadeInMs
  }, { gain: 0.4, muted: true, fadeInMs: 100 });
  assert.throws(() => addShortFormSourceAudioAsset(
    branch,
    sourceAudioInput("overlap", 500, 1_500)
  ), /겹칠 수 없습니다/u);
  branch = addShortFormVideoAsset(branch, videoInput("visual"));
  const removed = removeShortFormSourceAudioAsset(branch, "voice-a");
  assert.deepEqual(removed.sourceAudioAssets, []);
  assert.equal(removed.videoAssets[0]?.id, "visual");
});

test("쇼츠 에셋 trim은 최초 선택 envelope와 원본 anchor를 바꾸지 못한다", () => {
  const withVideo = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("immutable-video", 0, 1_000)
  );
  const trimmed = updateShortFormVideoAsset(withVideo, "immutable-video", {
    sourceStartMs: 10_100,
    sourceEndMs: 10_900,
    timelineEndMs: 800
  });
  assert.deepEqual({
    selectionStartMs: trimmed.videoAssets[0]?.sourceSelectionStartMs,
    selectionEndMs: trimmed.videoAssets[0]?.sourceSelectionEndMs,
    sourceStartMs: trimmed.videoAssets[0]?.sourceStartMs,
    sourceEndMs: trimmed.videoAssets[0]?.sourceEndMs
  }, {
    selectionStartMs: 10_000,
    selectionEndMs: 20_000,
    sourceStartMs: 10_100,
    sourceEndMs: 10_900
  });
  assert.throws(
    () => updateShortFormVideoAsset(withVideo, "immutable-video", {
      sourceSelectionStartMs: 9_000
    }),
    /선택 envelope/u
  );
  assert.throws(
    () => updateShortFormVideoAsset(withVideo, "immutable-video", {
      sourceClipId: "other-clip"
    }),
    /원본 anchor/u
  );
  assert.throws(
    () => updateShortFormVideoAsset(withVideo, "immutable-video", {
      sourceStartMs: 9_999
    }),
    /처음 선택한 범위/u
  );

  const withAudio = addShortFormSourceAudioAsset(
    createDefaultShortFormBranch(),
    sourceAudioInput("immutable-audio")
  );
  assert.throws(
    () => updateShortFormSourceAudioAsset(withAudio, "immutable-audio", {
      sourceEndMs: 20_001
    }),
    /처음 선택한 범위/u
  );
});

test("구형 exact 음성 twin은 A/V 영상의 이동·trim을 그대로 따라간다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("coupled-video", 0, 1_000)
  );
  branch = addShortFormSourceAudioAsset(
    branch,
    sourceAudioInput("legacy-exact-twin", 0, 1_000, {
      gain: 0.6,
      fadeInMs: 500,
      fadeOutMs: 500
    })
  );
  branch = updateShortFormVideoAsset(branch, "coupled-video", {
    sourceStartMs: 10_100,
    sourceEndMs: 10_800,
    timelineStartMs: 2_000,
    timelineEndMs: 2_700
  });
  assert.deepEqual(branch.sourceAudioAssets.map((audio) => ({
    sourceStartMs: audio.sourceStartMs,
    sourceEndMs: audio.sourceEndMs,
    timelineStartMs: audio.timelineStartMs,
    timelineEndMs: audio.timelineEndMs,
    gain: audio.gain,
    fadeInMs: audio.fadeInMs,
    fadeOutMs: audio.fadeOutMs
  })), [{
    sourceStartMs: 10_100,
    sourceEndMs: 10_800,
    timelineStartMs: 2_000,
    timelineEndMs: 2_700,
    gain: 0.6,
    fadeInMs: 500,
    fadeOutMs: 500
  }]);
});

test("active 영상은 전역 half-open 시간과 deterministic z-order를 쓴다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("a", 500, 1_500, { zIndex: 3 })
  );
  branch = addShortFormVideoAsset(
    branch,
    videoInput("b", 500, 1_500, {
      sourceStartMs: 12_000,
      sourceEndMs: 13_000,
      zIndex: 1
    })
  );
  assert.deepEqual(shortFormVideoAssetsAtTimeline(branch, 499), []);
  assert.deepEqual(shortFormVideoAssetsAtTimeline(branch, 500).map((asset) => ({
    id: asset.id,
    sourceTimeMs: asset.sourceTimeMs
  })), [
    { id: "b", sourceTimeMs: 12_000 },
    { id: "a", sourceTimeMs: 10_000 }
  ]);
  assert.deepEqual(shortFormVideoAssetsAtTimeline(branch, 1_500), []);
  assert.deepEqual(shortFormVideoLayersAtTimeline(branch, 750).map(({ kind }) => kind), [
    "base",
    "additional"
  ]);
});

test("workspace는 하나의 synthetic canvas clip만 사용하고 timed item을 왕복한다", () => {
  const parent = project();
  parent.shortForm = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("visual", 0, 2_000)
  );
  const workspace = createShortFormWorkspaceProject(parent);
  assert.equal(workspace.clips.length, 1);
  assert.equal(workspace.clips[0]?.id, SHORT_FORM_CANVAS_CLIP_ID);
  assert.equal(workspace.clips[0]?.shortFormCanvasClock, true);
  workspace.subtitles = [subtitle("canvas-cue", SHORT_FORM_CANVAS_CLIP_ID, 200, 800)];
  workspace.playheadMs = 700;
  const saved = shortFormBranchFromWorkspace(parent, workspace);
  assert.equal(saved.videoAssets[0]?.id, "visual");
  assert.equal(saved.subtitles[0]?.clipId, SHORT_FORM_CANVAS_CLIP_ID);
  assert.equal(saved.playheadMs, 700);
  const persisted = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
  assert.equal("clips" in persisted, false);
  assert.equal("scenes" in persisted, false);
});

test("영상이 0개여도 유효한 검은 캔버스 render workspace를 만든다", () => {
  const parent = project();
  parent.shortForm = createDefaultShortFormBranch();
  const render = deriveShortFormRenderProject(parent);
  assert.equal(render.clips.length, 1);
  assert.equal(render.clips[0]?.id, SHORT_FORM_CANVAS_CLIP_ID);
  assert.deepEqual(render.shortForm.videoAssets, []);
  assert.deepEqual(render.shortForm.sourceAudioAssets, []);
});

test("canvas duration은 명시적으로 늘고 content 아래로는 줄지 않는다", () => {
  let branch = addShortFormVideoAsset(
    createDefaultShortFormBranch(),
    videoInput("long", 0, 5_000)
  );
  assert.equal(branch.durationMs, 5_000);
  branch = setShortFormCanvasDuration(branch, 8_000);
  assert.equal(branch.durationMs, 8_000);
  branch = setShortFormCanvasDuration(branch, 1_000);
  assert.equal(branch.durationMs, 5_000);
});

test("canvas 범위 trim은 모든 에셋을 같은 0초 clock으로 자르고 source anchor를 보존한다", () => {
  const initial = normalizeShortFormBranch({
    ...createDefaultShortFormBranch(),
    durationMs: 10_000,
    videoLaneCount: 3,
    videoAssets: [
      videoInput("before", 500, 1_500),
      videoInput("left", 1_500, 3_500, {
        sourceStartMs: 20_000,
        sourceEndMs: 22_000,
        sourceSelectionStartMs: 19_000,
        sourceSelectionEndMs: 23_000
      }),
      videoInput("inside", 3_000, 5_000),
      videoInput("right", 7_000, 9_000, {
        sourceStartMs: 30_000,
        sourceEndMs: 32_000,
        sourceSelectionStartMs: 29_000,
        sourceSelectionEndMs: 33_000
      }),
      videoInput("both", 1_000, 9_000, {
        sourceStartMs: 40_000,
        sourceEndMs: 48_000,
        sourceSelectionStartMs: 39_000,
        sourceSelectionEndMs: 49_000,
        opacity: 0,
        visible: false
      }),
      videoInput("after", 8_500, 9_500)
    ],
    sourceAudioAssets: [sourceAudioInput("voice", 1_500, 3_500, {
      sourceStartMs: 50_000,
      sourceEndMs: 52_000,
      sourceSelectionStartMs: 49_000,
      sourceSelectionEndMs: 53_000,
      fadeInMs: 700,
      fadeOutMs: 500,
      muted: true
    })],
    subtitles: [
      subtitle("cue-cross", SHORT_FORM_CANVAS_CLIP_ID, 1_950, 2_700),
      subtitle("cue-out", SHORT_FORM_CANVAS_CLIP_ID, 8_100, 8_900)
    ],
    imageAssets: [image("image-cross", SHORT_FORM_CANVAS_CLIP_ID, 7_500, 8_100)],
    audioRegions: [{
      ...audioRegion("audio-cross", SHORT_FORM_CANVAS_CLIP_ID, 1_800, 2_600),
      fadeInMs: 400,
      fadeOutMs: 300
    }],
    selectedVideoLayerId: "before",
    selectedSourceAudioAssetId: "voice",
    selectedCueId: "cue-out",
    selectedImageAssetId: "image-cross",
    selectedAudioRegionId: "audio-cross",
    playheadMs: 7_500,
    revision: 9
  });

  const trimmed = trimShortFormCanvasRange(initial, 2_000, 8_000);
  assert.equal(trimmed.durationMs, 6_000);
  assert.equal(trimmed.revision, 10);
  assert.equal(trimmed.playheadMs, 5_500);
  assert.deepEqual(trimmed.videoAssets.map((asset) => ({
    id: asset.id,
    timeline: [asset.timelineStartMs, asset.timelineEndMs],
    source: [asset.sourceStartMs, asset.sourceEndMs]
  })), [
    { id: "left", timeline: [0, 1_500], source: [20_500, 22_000] },
    { id: "inside", timeline: [1_000, 3_000], source: [10_000, 12_000] },
    { id: "right", timeline: [5_000, 6_000], source: [30_000, 31_000] },
    { id: "both", timeline: [0, 6_000], source: [41_000, 47_000] }
  ]);
  for (const asset of trimmed.videoAssets) {
    assert.equal(
      asset.sourceEndMs - asset.sourceStartMs,
      asset.timelineEndMs - asset.timelineStartMs
    );
  }
  const left = trimmed.videoAssets.find((asset) => asset.id === "left");
  assert.equal(left?.sourceSelectionStartMs, 19_000);
  assert.equal(left?.sourceSelectionEndMs, 23_000);
  assert.deepEqual(left?.sourceRect, sourceRect);
  assert.deepEqual(left?.destinationRect, destinationRect);
  const both = trimmed.videoAssets.find((asset) => asset.id === "both");
  assert.equal(both?.visible, false);
  assert.equal(both?.opacity, 0);

  assert.deepEqual(trimmed.sourceAudioAssets.map((asset) => ({
    timeline: [asset.timelineStartMs, asset.timelineEndMs],
    source: [asset.sourceStartMs, asset.sourceEndMs],
    selection: [asset.sourceSelectionStartMs, asset.sourceSelectionEndMs],
    fades: [asset.fadeInMs, asset.fadeOutMs],
    muted: asset.muted
  })), [{
    timeline: [0, 1_500],
    source: [50_500, 52_000],
    selection: [49_000, 53_000],
    fades: [0, 500],
    muted: true
  }]);
  assert.deepEqual(trimmed.subtitles.map((cue) => [
    cue.id,
    cue.startOffsetMs,
    cue.endOffsetMs
  ]), [["cue-cross", 0, 700]]);
  assert.deepEqual(trimmed.imageAssets.map((asset) => [
    asset.id,
    asset.startOffsetMs,
    asset.endOffsetMs
  ]), [["image-cross", 5_500, 6_000]]);
  assert.deepEqual(trimmed.audioRegions.map((region) => [
    region.id,
    region.startOffsetMs,
    region.endOffsetMs,
    region.fadeInMs,
    region.fadeOutMs
  ]), [["audio-cross", 0, 600, 0, 300]]);
  assert.equal(trimmed.selectedVideoLayerId, null);
  assert.equal(trimmed.selectedSourceAudioAssetId, "voice");
  assert.equal(trimmed.selectedCueId, null);
  assert.equal(trimmed.selectedImageAssetId, "image-cross");
  assert.equal(trimmed.selectedAudioRegionId, "audio-cross");
  assert.equal(initial.durationMs, 10_000);
  assert.equal(initial.videoAssets.find((asset) => asset.id === "left")?.sourceStartMs, 20_000);
});

test("앞뒤 빈 구간 trim은 다섯 종류의 authored content 경계를 모두 포함하고 workspace carrier도 줄인다", () => {
  const branch = normalizeShortFormBranch({
    ...createDefaultShortFormBranch(),
    durationMs: 12_000,
    videoAssets: [videoInput("hidden-video", 2_000, 6_000, {
      visible: false,
      opacity: 0
    })],
    sourceAudioAssets: [sourceAudioInput("muted-source", 2_500, 7_000, {
      muted: true
    })],
    subtitles: [subtitle("first", SHORT_FORM_CANVAS_CLIP_ID, 1_500, 2_500)],
    imageAssets: [image("photo", SHORT_FORM_CANVAS_CLIP_ID, 3_000, 8_000)],
    audioRegions: [{
      ...audioRegion("last", SHORT_FORM_CANVAS_CLIP_ID, 9_000, 10_000),
      muted: true
    }],
    playheadMs: 11_000
  });
  assert.deepEqual(shortFormCanvasContentRange(branch), {
    startMs: 1_500,
    endMs: 10_000
  });
  const trimmed = trimShortFormCanvasToContent(branch);
  assert.equal(trimmed.durationMs, 8_500);
  assert.equal(trimmed.playheadMs, 8_500);
  assert.equal(trimmed.subtitles[0]?.startOffsetMs, 0);
  assert.equal(trimmed.audioRegions[0]?.endOffsetMs, 8_500);

  const workspace = shortFormWorkspaceProjectWithBranch(
    createShortFormWorkspaceProject({ ...project(), shortForm: branch }),
    trimmed
  );
  assert.equal(workspace.clips[0]?.sourceEndMs, 8_500);
  assert.equal(workspace.shortForm.durationMs, 8_500);
  assert.deepEqual(workspace.subtitles, trimmed.subtitles);
  assert.deepEqual(workspace.imageAssets, trimmed.imageAssets);
  assert.deepEqual(workspace.audioRegions, trimmed.audioRegions);
  assert.equal(
    shortFormBranchFromWorkspace({ ...project(), shortForm: trimmed }, workspace).durationMs,
    8_500
  );
});

test("canvas trim은 빈 캔버스를 보존하고 0.1초·half-open 경계를 fail closed한다", () => {
  const empty = createDefaultShortFormBranch();
  assert.equal(shortFormCanvasContentRange(empty), null);
  assert.deepEqual(trimShortFormCanvasToContent(empty), empty);
  assert.deepEqual(trimShortFormCanvasRange(empty, 0, empty.durationMs), empty);
  assert.equal(trimShortFormCanvasToContent(empty).revision, empty.revision);
  assert.throws(
    () => trimShortFormCanvasRange(empty, 0, 99),
    /0\.1초/u
  );
  assert.throws(
    () => trimShortFormCanvasRange(empty, -1, 100),
    /현재 캔버스 안/u
  );
  assert.throws(
    () => trimShortFormCanvasRange(empty, 0, empty.durationMs + 1),
    /현재 캔버스 안/u
  );

  const edge = normalizeShortFormBranch({
    ...empty,
    durationMs: 1_000,
    videoAssets: [
      videoInput("ends-at-start", 0, 200),
      videoInput("exact-100", 200, 300),
      videoInput("starts-at-end", 300, 500)
    ]
  });
  const exact = trimShortFormCanvasRange(edge, 200, 300);
  assert.deepEqual(exact.videoAssets.map((asset) => asset.id), ["exact-100"]);
  assert.deepEqual([
    exact.videoAssets[0]?.timelineStartMs,
    exact.videoAssets[0]?.timelineEndMs
  ], [0, 100]);
});

test("seed compatibility는 선택 scene을 v7 영상+원본 음성으로 변환한다", () => {
  const parent = project();
  const seeded = seedShortFormBranch(parent, [{
    selectionId: "a",
    fit: "cover",
    positionX: 0.7,
    positionY: 0.2,
    zoom: 1.4
  }]);
  assert.equal(seeded.videoAssets.length, 1);
  assert.equal(seeded.sourceAudioAssets.length, 1);
  assert.equal(seeded.videoAssets[0]?.sourceClipId, parent.clips[0]?.id);
  assert.equal(seeded.videoAssets[0]?.positionX, 0.7);
});

test("미래 schema는 빈 문서로 덮지 않고 fail closed한다", () => {
  assert.throws(
    () => normalizeShortFormBranch({ schema: "kirinuki-short-form/v8" }),
    UnsupportedShortFormSchemaError
  );
});
