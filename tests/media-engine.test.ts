import assert from "node:assert/strict";
import test from "node:test";

import { AudioSample } from "mediabunny";

import {
  materializedMediaTimelineMatches,
  type ChzzkVodMaterialization
} from "../src/lib/chzzk-vod-materialization.js";

import {
  AdaptiveShortFormFrameRenderer,
  AdaptiveShortFormRenderRestartRequiredError,
  activeCuesAt,
  activeImageAssetsAt,
  activeShortFormRenderVideoAssets,
  analyzeCaptionPlacementFrame,
  applyAudioAutomationToSample,
  applyShortFormSourceAudioAssetToSample,
  assertEditorMediaSourceMode,
  audioAutomationGainAt,
  audioTrimFrameRange,
  buildAudioAutomation,
  buildRenderEncodingSettings,
  buildVideoFrameDrawPlan,
  captionFontSizeForSurface,
  cfrFrameRange,
  cfrFrameTiming,
  chooseOutputCodecs,
  clampCaptionBoxCenter,
  createFileWriteTransaction,
  createImageAssetRenderCache,
  drawCaption,
  drawImageAsset,
  drawShortFormVideoSample,
  enableHighQualityImageSmoothing,
  exportProgressPercent,
  fallbackCaptionPlacementHints,
  fitSingleLineCaptionFontSize,
  imageAssetDrawRect,
  LOCAL_MEDIA_BLOB_SOURCE_OPTIONS,
  MAX_ACTIVE_IMAGE_ASSET_RGBA_BYTES,
  mixShortFormAudioContributions,
  normalizeMaterializedLoopbackMediaSource,
  normalizeMediaTimeline,
  RENDER_LETTERBOX_COLOR,
  requireRenderBaseVideoSample,
  requireRenderShortFormVideoAssetSample,
  resolveShortFormRenderScene,
  runShortFormRenderWithCanvasRetry,
  SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS,
  shortFormCanvasCfrFrameRange,
  shortFormCanvasCfrFrameTiming,
  shortFormCoverCrop,
  shortFormDestinationRectForTarget,
  shortFormSourceCropFromNormalizedRect,
  shortFormSourceAudioAssetGainAt,
  shortFormVideoAssetDrawGeometry,
  shortFormVideoAssetSourceTimeMs,
  shortFormVideoAssetSourceTimestamps,
  shortFormVideoLayerDrawGeometry,
  shortFormVideoLayerSourceTimeMs,
  shortFormVideoLayerSourceTimestamps,
  shortFormVideoDrawGeometry,
  singleLineCaptionText,
  validateRenderTimeline,
  validateRenderClips,
  validateShortFormCanvasRenderLayout,
  validateShortFormRenderVideoLayers,
  wrapCaption
} from "../src/editor/media-engine.js";

type RenderProjectFixture = Parameters<typeof activeCuesAt>[0];
type RenderClipFixture = Parameters<typeof cfrFrameRange>[0];
type CaptionContextFixture = Parameters<typeof wrapCaption>[0];
type AssetCanvasFixture = Parameters<typeof drawImageAsset>[1];
type AssetImageFixture = Parameters<typeof drawImageAsset>[3];
type AssetDrawContextFixture = Parameters<typeof drawImageAsset>[0];
type AudioSampleFixture = Parameters<typeof audioTrimFrameRange>[0];

function asRenderProject(value: unknown): RenderProjectFixture {
  return value as RenderProjectFixture;
}

function asRenderClip(value: unknown): RenderClipFixture {
  return value as RenderClipFixture;
}

function renderVideoLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: "layer-a",
    sourceAssetId: "project-primary",
    sourceClipId: "source-a",
    sourceSelectionStartMs: 20_000,
    sourceSelectionEndMs: 24_000,
    sourceStartMs: 20_000,
    sourceEndMs: 22_000,
    startOffsetMs: 500,
    endOffsetMs: 2_500,
    sourceRect: {
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
      referenceWidth: 1920,
      referenceHeight: 1080
    },
    destinationRect: { x: 540, y: 0, width: 540, height: 960 },
    opacity: 0.75,
    visible: true,
    zIndex: 1,
    ...overrides
  };
}

function renderCanvasVideoAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-a",
    sourceAssetId: "project-primary",
    sourceClipId: "source-a",
    sourceSelectionStartMs: 20_000,
    sourceSelectionEndMs: 24_000,
    sourceStartMs: 20_000,
    sourceEndMs: 22_000,
    timelineStartMs: 500,
    timelineEndMs: 2_500,
    sourceRect: {
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
      referenceWidth: 1920,
      referenceHeight: 1080
    },
    destinationRect: { x: 540, y: 0, width: 540, height: 960 },
    opacity: 0.75,
    audioGain: 1,
    lane: 0,
    visible: true,
    zIndex: 1,
    ...overrides
  };
}

function renderCanvasSourceAudioAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-audio-a",
    sourceAssetId: "project-primary",
    sourceClipId: "source-a",
    sourceSelectionStartMs: 20_000,
    sourceSelectionEndMs: 24_000,
    sourceStartMs: 20_000,
    sourceEndMs: 22_000,
    timelineStartMs: 500,
    timelineEndMs: 2_500,
    gain: 1,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...overrides
  };
}

function placementFrame(
  width: number,
  height: number,
  busyBand: "top" | "center" | "bottom" | null = null
) {
  const data = new Uint8ClampedArray(width * height * 4);
  const ranges: Record<
    "top" | "center" | "bottom",
    readonly [number, number]
  > = {
    top: [0.06, 0.34],
    center: [0.36, 0.64],
    bottom: [0.66, 0.94]
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const inBusyBand = busyBand && (
        y >= Math.floor(height * ranges[busyBand][0])
        && y < Math.ceil(height * ranges[busyBand][1])
      );
      const value = inBusyBand && (x + y) % 2 === 0 ? 255 : 80;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

test("로컬 대용량 미디어는 Chromium stream reader를 피하고 제한된 캐시를 쓴다", () => {
  assert.deepEqual(LOCAL_MEDIA_BLOB_SOURCE_OPTIONS, {
    maxCacheSize: 16 * 1024 * 1024,
    useStreamReader: false
  });
  assert.equal(Object.isFrozen(LOCAL_MEDIA_BLOB_SOURCE_OPTIONS), true);
});

test("materialized engine 미디어는 exact loopback capability URL과 불변 파일 메타데이터만 허용한다", () => {
  const mediaUrl = (
    "http://127.0.0.1:4319/v1/vod/media/job-0123456789abcdef"
    + `?access=${"A".repeat(43)}`
  );
  const materialized = normalizeMaterializedLoopbackMediaSource({
    kind: "local-url",
    url: mediaUrl,
    name: "CHZZK-선택-구간.mp4",
    size: 1_024,
    type: "video/mp4",
    lastModified: 1_800_000_000_000
  });
  assert.deepEqual(materialized, {
    kind: "local-url",
    url: mediaUrl,
    name: "CHZZK-선택-구간.mp4",
    size: 1_024,
    type: "video/mp4",
    lastModified: 1_800_000_000_000
  });
  assert.doesNotThrow(() => assertEditorMediaSourceMode(
    materialized,
    "chzzk-vod-selection"
  ));
  assert.throws(
    () => assertEditorMediaSourceMode(materialized, "manual-file"),
    /materialization/u
  );
  const manual = new File([new Uint8Array([0])], "manual.mp4", {
    type: "video/mp4",
    lastModified: 1
  });
  assert.doesNotThrow(() => assertEditorMediaSourceMode(manual, "manual-file"));
  assert.throws(
    () => assertEditorMediaSourceMode(manual, "chzzk-vod-selection"),
    /materialization/u
  );
  assert.throws(() => normalizeMaterializedLoopbackMediaSource({
    kind: "local-url",
    url: "https://cdn.example/video.mp4",
    name: "remote.mp4",
    size: 1,
    type: "video/mp4",
    lastModified: 1
  }), /보안 범위/);
  for (const url of [
    `http://localhost:4319/v1/vod/media/job-0123456789abcdef?access=${"A".repeat(43)}`,
    `http://127.0.0.1:9999/v1/vod/media/job-0123456789abcdef?access=${"A".repeat(43)}`,
    `http://127.0.0.1:4319/v1/chzzk-vod/media/job-0123456789abcdef?access=${"A".repeat(43)}`,
    `http://127.0.0.1:4319/v1/vod/media/job-0123456789abcdef?access=${"A".repeat(42)}`,
    `http://127.0.0.1:4319/v1/vod/media/job-0123456789abcdef?access=${"A".repeat(43)}&extra=1`
  ]) {
    assert.throws(() => normalizeMaterializedLoopbackMediaSource({
      kind: "local-url",
      url,
      name: "wrong.mp4",
      size: 1,
      type: "video/mp4",
      lastModified: 1
    }), /보안 범위/);
  }
  assert.throws(() => normalizeMaterializedLoopbackMediaSource({
    kind: "local-url",
    url: "http://127.0.0.1:4319/video.mp4",
    name: "wrong.mkv",
    size: 1,
    type: "video/x-matroska",
    lastModified: 1
  }), /메타데이터/);
});

test("최종 렌더는 cue별 글씨 크기를 우선하고 값이 없으면 프로젝트 기본값을 쓴다", () => {
  const createContext = () => ({
    save() {},
    restore() {},
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    strokeText() {},
    fillText() {},
    textAlign: "center",
    textBaseline: "middle",
    lineJoin: "round",
    font: "",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    shadowColor: "",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0
  });
  const project = {
    subtitleDefaults: {
      fontFamily: "Pretendard",
      fontWeight: 800,
      fontScale: 0.0675,
      lineHeight: 1.24,
      maxLines: 1,
      maxWidth: 0.86,
      outlineWidth: 0.006,
      outlineColor: "#111111",
      backgroundColor: "transparent",
      backgroundRadiusEm: 0,
      color: "#ffffff",
      shadowColor: "transparent",
      shadowOffsetXEm: 0,
      shadowOffsetYEm: 0,
      shadowBlurEm: 0,
      align: "center"
    }
  };
  const cue = {
    text: "자막",
    color: "#ffffff",
    x: 0.5,
    y: 0.84,
    fontScale: 0.04
  };
  const canvas = { width: 1_000, height: 1_000 } as HTMLCanvasElement;

  const overriddenContext = createContext();
  drawCaption(
    overriddenContext as unknown as CanvasRenderingContext2D,
    canvas,
    project as RenderProjectFixture,
    cue as never
  );
  assert.match(overriddenContext.font, / 40px /u);

  const inheritedContext = createContext();
  drawCaption(
    inheritedContext as unknown as CanvasRenderingContext2D,
    canvas,
    project as RenderProjectFixture,
    { ...cue, fontScale: undefined } as never
  );
  assert.match(inheritedContext.font, / 68px /u);

  const longFormContext = createContext();
  drawCaption(
    longFormContext as unknown as CanvasRenderingContext2D,
    { width: 1_920, height: 1_080 } as HTMLCanvasElement,
    project as RenderProjectFixture,
    { ...cue, fontScale: undefined } as never
  );
  const shortFormContext = createContext();
  drawCaption(
    shortFormContext as unknown as CanvasRenderingContext2D,
    { width: 1_080, height: 1_920 } as HTMLCanvasElement,
    project as RenderProjectFixture,
    { ...cue, fontScale: undefined } as never
  );
  assert.match(longFormContext.font, / 73px /u);
  assert.match(shortFormContext.font, / 130px /u);
  assert.equal(longFormContext.lineWidth / 1_080, 0.006);
  assert.equal(shortFormContext.lineWidth / 1_920, 0.006);
});

test("자막 fontScale은 가로세로 비율과 무관하게 화면 높이 비율을 유지한다", () => {
  const fontScale = 0.0675;
  const longFormFontSize = captionFontSizeForSurface(1_080, fontScale, 18);
  const shortFormFontSize = captionFontSizeForSurface(1_920, fontScale, 18);

  assert.equal(longFormFontSize, 73);
  assert.equal(shortFormFontSize, 130);
  assert.ok(
    Math.abs(longFormFontSize / 1_080 - shortFormFontSize / 1_920) < 0.0005,
    "본편과 쇼츠의 자막 높이 비율이 같아야 합니다."
  );
});

test("자막 배경 토글은 켜면 텍스트보다 먼저 각진 배경을 그리고 끄면 배경을 생략한다", () => {
  const calls: string[] = [];
  let fillStyle = "";
  const context = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    measureText: (text: string) => ({ width: text.length * 20 }),
    fillRect: () => calls.push("fillRect"),
    beginPath: () => calls.push("beginPath"),
    roundRect: () => calls.push("roundRect"),
    fill: () => calls.push("fill"),
    strokeText: () => calls.push("strokeText"),
    fillText: () => calls.push(`fillText:${fillStyle}`),
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    textAlign: "center",
    textBaseline: "middle",
    lineJoin: "round",
    font: "",
    lineWidth: 0,
    strokeStyle: "",
    shadowColor: "",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0
  };
  const project = {
    subtitleDefaults: {
      fontFamily: "Pretendard",
      fontWeight: 800,
      fontScale: 0.0675,
      lineHeight: 1.24,
      maxLines: 1,
      maxWidth: 0.86,
      outlineWidth: 0.006,
      outlineColor: "#111111",
      backgroundColor: "transparent",
      backgroundRadiusEm: 0,
      color: "#ffffff",
      shadowColor: "transparent",
      shadowOffsetXEm: 0,
      shadowOffsetYEm: 0,
      shadowBlurEm: 0,
      align: "center"
    }
  };
  const cue: {
    text: string;
    color: string;
    x: number;
    y: number;
    backgroundEnabled?: boolean;
  } = {
    text: "사용자 색",
    color: "#f06088",
    x: 0.5,
    y: 0.84,
    backgroundEnabled: true
  };

  drawCaption(
    context as unknown as CanvasRenderingContext2D,
    { width: 1_920, height: 1_080 } as HTMLCanvasElement,
    project as RenderProjectFixture,
    cue as never
  );

  assert.ok(calls.indexOf("fillRect") < calls.indexOf("strokeText"));
  assert.ok(calls.indexOf("fillRect") < calls.indexOf("fillText:#f06088"));
  assert.equal(calls.includes("roundRect"), false);

  calls.length = 0;
  cue.backgroundEnabled = false;
  drawCaption(
    context as unknown as CanvasRenderingContext2D,
    { width: 1_920, height: 1_080 } as HTMLCanvasElement,
    project as RenderProjectFixture,
    cue as never
  );
  assert.equal(calls.includes("fillRect"), false);
  assert.equal(calls.includes("roundRect"), false);
  assert.ok(calls.includes("fillText:#f06088"));

  calls.length = 0;
  delete cue.backgroundEnabled;
  project.subtitleDefaults.backgroundColor = "#000000";
  drawCaption(
    context as unknown as CanvasRenderingContext2D,
    { width: 1_920, height: 1_080 } as HTMLCanvasElement,
    project as RenderProjectFixture,
    cue as never
  );
  assert.ok(calls.includes("fillRect"), "override가 없는 기존 cue는 전역 검은 배경을 상속해야 합니다.");

  calls.length = 0;
  cue.backgroundEnabled = false;
  drawCaption(
    context as unknown as CanvasRenderingContext2D,
    { width: 1_920, height: 1_080 } as HTMLCanvasElement,
    project as RenderProjectFixture,
    cue as never
  );
  assert.equal(calls.includes("fillRect"), false, "개별 OFF는 전역 검은 배경보다 우선해야 합니다.");
});

test("내보내기 진행률은 실제 commit 전까지 99%를 넘지 않는다", () => {
  assert.equal(exportProgressPercent(-1), 0);
  assert.equal(exportProgressPercent(Number.NaN), 0);
  assert.equal(exportProgressPercent(0), 0);
  assert.equal(exportProgressPercent(0.5), 50);
  assert.equal(exportProgressPercent(0.995), 99);
  assert.equal(exportProgressPercent(0.999_999), 99);
  assert.equal(exportProgressPercent(1), 100);
  assert.equal(exportProgressPercent(2), 100);
});

test("로컬 대표 프레임 방해도는 복잡한 밴드를 피하고 평탄하면 bottom을 택한다", () => {
  const width = 32;
  const height = 30;
  const topBusy = analyzeCaptionPlacementFrame(
    placementFrame(width, height, "top"),
    width,
    height
  );
  assert(topBusy.topScore > topBusy.bottomScore);
  assert.equal(topBusy.preferredPlacement, "bottom");

  const bottomBusy = analyzeCaptionPlacementFrame(
    placementFrame(width, height, "bottom"),
    width,
    height
  );
  assert(bottomBusy.bottomScore > bottomBusy.topScore);
  assert.equal(bottomBusy.preferredPlacement, "top");

  const flat = analyzeCaptionPlacementFrame(
    placementFrame(width, height),
    width,
    height
  );
  assert.deepEqual(
    {
      top: flat.topScore,
      center: flat.centerScore,
      bottom: flat.bottomScore,
      preferred: flat.preferredPlacement
    },
    {
      top: 0,
      center: 0,
      bottom: 0,
      preferred: "bottom"
    }
  );
  assert.deepEqual(
    fallbackCaptionPlacementHints(1),
    {
      analysis: "local-three-band-edge-density-v1",
      framesShared: false,
      samples: [{
        atMs: 0,
        topScore: 500,
        centerScore: 500,
        bottomScore: 500,
        preferredPlacement: "bottom"
      }]
    }
  );
});

test("컨테이너 PTS 원점을 프로젝트 0초와 분리해 실제 재생 길이를 계산한다", () => {
  assert.deepEqual(normalizeMediaTimeline(120.25, 180.75), {
    originSeconds: 120.25,
    endSeconds: 180.75,
    durationSeconds: 60.5,
    mediaOriginMs: 120_250,
    mediaEndTimestampMs: 180_750,
    durationMs: 60_500
  });
  assert.deepEqual(normalizeMediaTimeline(-0.125, 10), {
    originSeconds: 0,
    endSeconds: 10,
    durationSeconds: 10,
    mediaOriginMs: 0,
    mediaEndTimestampMs: 10_000,
    durationMs: 10_000
  });
});

test("렌더 대상은 활성 컷·원본 범위·연속 타임라인을 모두 검증한다", () => {
  const valid = {
    clips: [
      {
        id: "first",
        sourceStartMs: 1_000,
        sourceEndMs: 2_000,
        timelineStartMs: 0,
        enabled: true
      },
      {
        id: "disabled",
        sourceStartMs: -100,
        sourceEndMs: -50,
        timelineStartMs: 1_000,
        enabled: false
      },
      {
        id: "second",
        sourceStartMs: 4_000,
        sourceEndMs: 5_500,
        timelineStartMs: 1_000,
        enabled: true
      }
    ]
  };
  assert.deepEqual(
    validateRenderClips(asRenderProject(valid), 6_000).map((clip) => clip.id),
    ["first", "second"]
  );
  assert.throws(
    () => validateRenderClips(asRenderProject({
      clips: [{ ...valid.clips[0], enabled: false }]
    }), 6_000),
    /활성/
  );
  assert.throws(
    () => validateRenderClips(asRenderProject({
      clips: [{ ...valid.clips[0], sourceEndMs: 6_001 }]
    }), 6_000),
    /영상 길이 밖/
  );
  assert.throws(
    () => validateRenderClips(asRenderProject({
      clips: [
        valid.clips[0],
        { ...valid.clips[2], timelineStartMs: 1_010 }
      ]
    }), 6_000),
    /컷 순서와 맞지/
  );
});

test("컷별 CFR 격자는 사용자 컷 경계를 정확히 잇고 마지막 프레임만 짧게 만든다", () => {
  const firstClip = {
    sourceStartMs: 0,
    sourceEndMs: 510,
    timelineStartMs: 0
  };
  const secondClip = {
    sourceStartMs: 2_000,
    sourceEndMs: 2_490,
    timelineStartMs: 510
  };
  const first = cfrFrameRange(asRenderClip(firstClip), 30);
  const second = cfrFrameRange(asRenderClip(secondClip), 30);
  const firstLastFrame = cfrFrameTiming(
    asRenderClip(firstClip),
    first.endFrameIndex - 1,
    30
  );
  const secondFirstFrame = cfrFrameTiming(
    asRenderClip(secondClip),
    second.firstFrameIndex,
    30
  );

  assert.deepEqual(first, { firstFrameIndex: 0, endFrameIndex: 16 });
  assert.deepEqual(second, { firstFrameIndex: 0, endFrameIndex: 15 });
  assert.ok(firstLastFrame.duration < 1 / 30);
  assert.ok(Math.abs(
    firstLastFrame.outputTimestamp
      + firstLastFrame.duration
      - secondFirstFrame.outputTimestamp
  ) < 1e-12);
  assert.equal(secondFirstFrame.outputTimestamp, 0.51);
});

test("최종 렌더는 기본 영상 원본 프레임 누락을 검은 화면으로 숨기지 않고 fail closed한다", () => {
  const sample = { frame: "base" };
  assert.equal(requireRenderBaseVideoSample(sample, "clip-a"), sample);
  assert.throws(
    () => requireRenderBaseVideoSample(null, "clip-a"),
    /clip-a 기본 영상의 원본 프레임을 읽지 못했습니다/u
  );
  assert.throws(
    () => requireRenderBaseVideoSample(undefined, ""),
    /현재 컷 기본 영상의 원본 프레임을 읽지 못했습니다/u
  );
});

test("긴 자막 박스 중심은 5% 위치에서도 캔버스 안으로 이동한다", () => {
  const boxWidth = 1_650;
  const boxHeight = 180;
  const safeInset = 6;
  const center = clampCaptionBoxCenter({
    requestedX: 1_920 * 0.05,
    requestedY: 1_080 * 0.05,
    boxWidth,
    boxHeight,
    canvasWidth: 1_920,
    canvasHeight: 1_080,
    safeInset
  });
  assert.ok(center.x - boxWidth / 2 >= safeInset);
  assert.ok(center.y - boxHeight / 2 >= safeInset);
  assert.ok(center.x + boxWidth / 2 <= 1_920 - safeInset);
  assert.ok(center.y + boxHeight / 2 <= 1_080 - safeInset);
});

test("겹치는 사람 자막과 네 줄을 넘는 텍스트를 렌더 단계에서 버리지 않는다", () => {
  const project = {
    clips: [{
      id: "clip",
      timelineStartMs: 0,
      enabled: true
    }],
    subtitles: [
      {
        id: "first",
        clipId: "clip",
        startOffsetMs: 0,
        endOffsetMs: 2_000,
        text: "첫 자막"
      },
      {
        id: "second",
        clipId: "clip",
        startOffsetMs: 500,
        endOffsetMs: 1_500,
        text: "둘째 자막"
      }
    ]
  };
  assert.deepEqual(
    activeCuesAt(asRenderProject(project), 1).map((cue) => cue.id),
    ["first", "second"]
  );

  const context = {
    measureText: (text: string) => ({ width: text.length * 10 })
  };
  assert.deepEqual(
    wrapCaption(
      context as unknown as CaptionContextFixture,
      "하나\n둘\n셋\n넷\n다섯",
      100
    ),
    ["하나", "둘", "셋", "넷", "다섯"]
  );
  assert.equal(
    singleLineCaptionText("  하나\n 둘\t셋  "),
    "하나 둘 셋"
  );
  assert.equal(
    fitSingleLineCaptionFontSize({
      baseFontSize: 72,
      measuredWidth: 1_800,
      maxWidth: 1_500
    }),
    57
  );
  assert.equal(
    fitSingleLineCaptionFontSize({
      baseFontSize: 72,
      measuredWidth: 1_400,
      maxWidth: 1_500
    }),
    72
  );
});

test("동시 이미지 에셋은 프로젝트 배열 순서대로 활성화한다", () => {
  const project = {
    clips: [{
      id: "clip",
      timelineStartMs: 1_000,
      enabled: true
    }],
    imageAssets: [
      {
        id: "behind",
        clipId: "clip",
        startOffsetMs: 0,
        endOffsetMs: 2_000
      },
      {
        id: "front",
        clipId: "clip",
        startOffsetMs: 500,
        endOffsetMs: 1_500
      }
    ]
  };
  assert.deepEqual(
    activeImageAssetsAt(asRenderProject(project), 1.75).map((asset) => asset.id),
    ["behind", "front"]
  );
  assert.deepEqual(activeImageAssetsAt(asRenderProject(project), 3), []);
});

test("이미지 에셋은 비율·투명도를 보존해 영상 위에 합성한다", () => {
  const canvas = { width: 1_920, height: 1_080 };
  const image = { width: 1_000, height: 500 };
  const asset = {
    x: 0.5,
    y: 0.5,
    scale: 1,
    opacity: 0.4,
    naturalWidth: 1_000,
    naturalHeight: 500
  };
  assert.deepEqual(imageAssetDrawRect(
    canvas as unknown as AssetCanvasFixture,
    asset as unknown as Parameters<typeof imageAssetDrawRect>[1],
    image as unknown as AssetImageFixture
  ), {
    x: 624,
    y: 372,
    width: 672,
    height: 336
  });

  const events: unknown[][] = [];
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: "copy",
    save() {
      events.push(["save"]);
    },
    drawImage(...args: unknown[]) {
      events.push([
        "drawImage",
        ...args,
        this.globalAlpha,
        this.globalCompositeOperation
      ]);
    },
    restore() {
      events.push(["restore"]);
    }
  };
  drawImageAsset(
    context as unknown as AssetDrawContextFixture,
    canvas as unknown as AssetCanvasFixture,
    asset as unknown as Parameters<typeof drawImageAsset>[2],
    image as unknown as AssetImageFixture
  );
  assert.deepEqual(events, [
    ["save"],
    ["drawImage", image, 624, 372, 672, 336, 0.4, "source-over"],
    ["restore"]
  ]);
});

test("작은 이미지 에셋은 같은 화면비의 미리보기와 출력에서 비례한다", () => {
  const asset = {
    x: 0.32903981264637056,
    y: 0.42922196200447277,
    scale: 2.77,
    opacity: 1,
    naturalWidth: 505,
    naturalHeight: 229
  };
  const image = { width: 505, height: 229 };
  const previewRect = imageAssetDrawRect(
    { width: 960, height: 540 },
    asset as unknown as Parameters<typeof imageAssetDrawRect>[1],
    image
  );
  const outputRect = imageAssetDrawRect(
    { width: 1_920, height: 1_080 },
    asset as unknown as Parameters<typeof imageAssetDrawRect>[1],
    image
  );

  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(
      Math.abs(outputRect[key] - previewRect[key] * 2) < 1e-9,
      `${key}가 해상도에 비례하지 않습니다: ${JSON.stringify({ previewRect, outputRect })}`
    );
  }
  assert.ok(Math.abs(outputRect.x - -298.96355971896855) < 1e-9);
  assert.ok(Math.abs(outputRect.y - 41.51045163809789) < 1e-9);
  assert.ok(Math.abs(outputRect.width - 1_861.44) < 1e-9);
  assert.ok(Math.abs(outputRect.height - 844.0985346534654) < 1e-9);
});

test("렌더 캐시는 현재 활성 이미지 에셋만 디코드하고 구간 종료 즉시 해제한다", async () => {
  const firstBlob = new Blob(["first"], { type: "image/png" });
  const secondBlob = new Blob(["second"], { type: "image/png" });
  const blobs = new Map([
    ["first-key", firstBlob],
    ["second-key", secondBlob]
  ]);
  const dimensions = new Map([
    [firstBlob, { width: 20, height: 10, id: "first" }],
    [secondBlob, { width: 8, height: 8, id: "second" }]
  ]);
  const resolved: string[] = [];
  const decoded: string[] = [];
  const closed: string[] = [];
  const project = {
    clips: [{
      id: "clip",
      timelineStartMs: 0,
      enabled: true
    }],
    imageAssets: [
      {
        id: "first",
        clipId: "clip",
        name: "첫 에셋",
        mimeType: "image/png",
        source: { kind: "blob-key", value: "first-key" },
        startOffsetMs: 0,
        endOffsetMs: 500
      },
      {
        id: "second",
        clipId: "clip",
        name: "둘째 에셋",
        mimeType: "image/png",
        source: { kind: "blob-key", value: "second-key" },
        startOffsetMs: 1_000,
        endOffsetMs: 1_500
      }
    ]
  };
  const cache = createImageAssetRenderCache(asRenderProject(project), {
    resolveImageAsset: async (source) => {
      resolved.push(source.value);
      const blob = blobs.get(source.value);
      assert.ok(blob);
      return blob;
    },
    decodeImageAsset: async (blob) => {
      const metadata = dimensions.get(blob);
      assert.ok(metadata);
      decoded.push(metadata.id);
      return {
        width: metadata.width,
        height: metadata.height,
        close: () => closed.push(metadata.id)
      };
    }
  });

  assert.equal(MAX_ACTIVE_IMAGE_ASSET_RGBA_BYTES, 256 * 1024 * 1024);
  assert.deepEqual(
    (await cache.prepareAt(0.1)).map(({ asset }) => asset.id),
    ["first"]
  );
  assert.deepEqual(resolved, ["first-key"]);
  assert.deepEqual(decoded, ["first"]);
  assert.equal(cache.decodedBytes, 20 * 10 * 4);

  await cache.prepareAt(0.2);
  assert.deepEqual(decoded, ["first"]);
  cache.releaseThrough(0.4996);
  assert.deepEqual(closed, ["first"]);
  assert.equal(cache.decodedBytes, 0);

  assert.deepEqual(
    (await cache.prepareAt(1.1)).map(({ asset }) => asset.id),
    ["second"]
  );
  assert.deepEqual(resolved, ["first-key", "second-key"]);
  cache.closeAll();
  assert.deepEqual(closed, ["first", "second"]);
  assert.equal(cache.decodedCount, 0);
});

test("동시 활성 이미지의 실제 RGBA 용량이 상한을 넘으면 모두 닫고 명확히 실패한다", async () => {
  const closed: string[] = [];
  let decodeIndex = 0;
  const project = {
    clips: [{
      id: "clip",
      timelineStartMs: 0,
      enabled: true
    }],
    imageAssets: ["behind", "front"].map((id) => ({
      id,
      clipId: "clip",
      name: id,
      mimeType: "image/png",
      source: { kind: "blob-key", value: id },
      startOffsetMs: 0,
      endOffsetMs: 1_000,
      naturalWidth: 4,
      naturalHeight: 4
    }))
  };
  const cache = createImageAssetRenderCache(asRenderProject(project), {
    maxDecodedBytes: 100,
    resolveImageAsset: async () => new Blob(["image"], { type: "image/png" }),
    decodeImageAsset: async (_blob) => {
      const id = project.imageAssets[decodeIndex]?.id || "front";
      decodeIndex += 1;
      return {
        width: 4,
        height: 4,
        close: () => closed.push(id)
      };
    }
  });

  await assert.rejects(
    cache.prepareAt(0.1),
    /디코드 메모리가 100 B를 넘습니다/
  );
  assert.equal(decodeIndex, 1);
  assert.deepEqual(closed, ["behind"]);
  assert.equal(cache.decodedBytes, 0);
  assert.equal(cache.decodedCount, 0);

  let mismatchedClosed = 0;
  const mismatchedCache = createImageAssetRenderCache(asRenderProject({
    clips: project.clips,
    imageAssets: [{
      ...project.imageAssets[0],
      naturalWidth: 1,
      naturalHeight: 1
    }]
  }), {
    maxDecodedBytes: 32,
    resolveImageAsset: async () => new Blob(["image"], { type: "image/png" }),
    decodeImageAsset: async () => ({
      width: 4,
      height: 4,
      close: () => {
        mismatchedClosed += 1;
      }
    })
  });
  await assert.rejects(
    mismatchedCache.prepareAt(0.1),
    /디코드 메모리가 32 B를 넘습니다/
  );
  assert.equal(mismatchedClosed, 1);
  assert.equal(mismatchedCache.decodedBytes, 0);
});

test("오디오 경계는 가장 가까운 PCM 프레임으로 자른다", () => {
  const sample = {
    timestamp: 10,
    sampleRate: 48_000,
    numberOfFrames: 4_800
  };
  assert.deepEqual(
    audioTrimFrameRange(
      sample as unknown as AudioSampleFixture,
      10.000_01,
      10.099_98
    ),
    { frameStart: 0, frameEnd: 4_799 }
  );
  assert.deepEqual(
    audioTrimFrameRange(sample as unknown as AudioSampleFixture, 9, 11),
    { frameStart: 0, frameEnd: 4_800 }
  );
});

test("렌더 검증은 다른 자막 레인의 동시 자막을 허용하고 같은 레인·음성 구간 충돌만 막는다", () => {
  const clips = [{
    id: "clip",
    sourceStartMs: 0,
    sourceEndMs: 4_000,
    timelineStartMs: 0,
    enabled: true
  }];
  const simultaneousCaptions = {
    clips,
    imageAssets: [
      {
        id: "asset-a",
        clipId: "clip",
        startOffsetMs: 0,
        endOffsetMs: 2_000
      },
      {
        id: "asset-b",
        clipId: "clip",
        startOffsetMs: 500,
        endOffsetMs: 1_500
      }
    ],
    subtitles: [
      {
        id: "top",
        clipId: "clip",
        startOffsetMs: 0,
        endOffsetMs: 2_000,
        lane: 0
      },
      {
        id: "bottom",
        clipId: "clip",
        startOffsetMs: 500,
        endOffsetMs: 1_500,
        lane: 1
      }
    ],
    audioRegions: []
  };
  // One visual lane deliberately permits overlap. Array order defines back→front,
  // so export validation only rejects ambiguous subtitle/audio lane collisions.
  assert.doesNotThrow(() => (
    validateRenderTimeline(asRenderProject(simultaneousCaptions))
  ));
  assert.throws(
    () => validateRenderTimeline(asRenderProject({
      ...simultaneousCaptions,
      subtitles: simultaneousCaptions.subtitles.map((cue) => ({ ...cue, lane: 0 }))
    })),
    /같은 자막 레인/
  );
  assert.throws(
    () => validateRenderTimeline(asRenderProject({
      ...simultaneousCaptions,
      audioRegions: [
        {
          id: "first",
          clipId: "clip",
          startOffsetMs: 0,
          endOffsetMs: 2_000
        },
        {
          id: "second",
          clipId: "clip",
          startOffsetMs: 1_000,
          endOffsetMs: 3_000
        }
      ]
    })),
    /겹치는 음성/
  );
});

test("음성 자동화는 컷 타임라인에 맞춰 볼륨·뮤트와 양쪽 페이드를 계산한다", () => {
  const project = {
    clips: [{
      id: "clip",
      timelineStartMs: 2_000,
      enabled: true
    }],
    audioRegions: [{
      id: "quiet",
      clipId: "clip",
      startOffsetMs: 1_000,
      endOffsetMs: 5_000,
      gain: 0.25,
      muted: false,
      fadeInMs: 1_000,
      fadeOutMs: 2_000
    }]
  };
  const automation = buildAudioAutomation(asRenderProject(project));
  assert.deepEqual(automation, [{
    id: "quiet",
    startSeconds: 3,
    endSeconds: 7,
    targetGain: 0.25,
    fadeInSeconds: 1,
    fadeOutSeconds: 2
  }]);
  assert.equal(audioAutomationGainAt(automation, 2.9), 1);
  assert.equal(audioAutomationGainAt(automation, 3), 1);
  assert.equal(audioAutomationGainAt(automation, 3.5), 0.625);
  assert.equal(audioAutomationGainAt(automation, 4), 0.25);
  assert.equal(audioAutomationGainAt(automation, 5), 0.25);
  assert.equal(audioAutomationGainAt(automation, 6), 0.625);
  assert.equal(audioAutomationGainAt(automation, 7), 1);

  const muted = buildAudioAutomation(asRenderProject({
    ...project,
    audioRegions: [{
      ...project.audioRegions[0],
      muted: true,
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 0
    }]
  }));
  assert.equal(audioAutomationGainAt(muted, 4), 0);
});

test("PCM 샘플에는 설정 구간의 프레임만 모든 채널에 동일하게 반영한다", () => {
  const sourceData = new Float32Array([
    1, -1,
    1, -1,
    1, -1,
    1, -1,
    1, -1,
    1, -1,
    1, -1,
    1, -1
  ]);
  const source = new AudioSample({
    data: sourceData,
    format: "f32",
    numberOfChannels: 2,
    sampleRate: 4,
    timestamp: 0
  });
  const automation = [{
    id: "quiet",
    startSeconds: 0.5,
    endSeconds: 1.5,
    targetGain: 0.25,
    fadeInSeconds: 0,
    fadeOutSeconds: 0
  }];
  const rendered = applyAudioAutomationToSample(source, automation);
  try {
    assert.notEqual(rendered, source);
    const actual = new Float32Array(sourceData.length);
    rendered.copyTo(actual, { planeIndex: 0, format: "f32" });
    assert.deepEqual([...actual], [
      1, -1,
      1, -1,
      0.25, -0.25,
      0.25, -0.25,
      0.25, -0.25,
      0.25, -0.25,
      1, -1,
      1, -1
    ]);
    assert.equal(applyAudioAutomationToSample(source, []), source);
  } finally {
    rendered.close();
    source.close();
  }
});

test("쇼츠 원본 음성 자산은 absolute clock 볼륨·뮤트·페이드를 PCM에 적용한다", () => {
  const asset = renderCanvasSourceAudioAsset({
    timelineStartMs: 500,
    timelineEndMs: 2_500,
    sourceStartMs: 20_000,
    sourceEndMs: 22_000,
    gain: 0.8,
    fadeInMs: 1_000,
    fadeOutMs: 1_000
  });
  assert.equal(shortFormSourceAudioAssetGainAt(asset as never, 0.499), 0);
  assert.equal(shortFormSourceAudioAssetGainAt(asset as never, 0.5), 0);
  assert.equal(shortFormSourceAudioAssetGainAt(asset as never, 1), 0.4);
  assert.equal(shortFormSourceAudioAssetGainAt(asset as never, 1.5), 0.8);
  assert.equal(shortFormSourceAudioAssetGainAt(asset as never, 2), 0.4);
  assert.equal(shortFormSourceAudioAssetGainAt(asset as never, 2.5), 0);
  assert.equal(shortFormSourceAudioAssetGainAt({
    ...asset,
    muted: true
  } as never, 1.5), 0);
  assert.equal(shortFormSourceAudioAssetGainAt({
    ...asset,
    gain: 2,
    fadeInMs: 0,
    fadeOutMs: 0
  } as never, 1.5), 2);

  const sourceData = new Float32Array([
    1, -1,
    1, -1,
    1, -1,
    1, -1,
    1, -1
  ]);
  const source = new AudioSample({
    data: sourceData,
    format: "f32",
    numberOfChannels: 2,
    sampleRate: 2,
    timestamp: 0.5
  });
  const rendered = applyShortFormSourceAudioAssetToSample(
    source,
    asset as never
  );
  try {
    assert.notEqual(rendered, source);
    const actual = new Float32Array(sourceData.length);
    rendered.copyTo(actual, { planeIndex: 0, format: "f32" });
    assert.deepEqual([...actual], [...new Float32Array([
      0, -0,
      0.4, -0.4,
      0.8, -0.8,
      0.4, -0.4,
      0, -0
    ])]);
  } finally {
    rendered.close();
    source.close();
  }
});

test("v7 음성 mixer는 0부터 연속 PCM을 만들고 겹침 합산 뒤 automation과 clamp를 적용한다", () => {
  const baseAsset = renderCanvasSourceAudioAsset({
    timelineStartMs: 0,
    timelineEndMs: 2_000,
    sourceStartMs: 20_000,
    sourceEndMs: 22_000
  });
  const overlapAsset = renderCanvasSourceAudioAsset({
    id: "source-audio-overlap",
    timelineStartMs: 500,
    timelineEndMs: 1_500,
    sourceStartMs: 25_000,
    sourceEndMs: 26_000,
    sourceSelectionStartMs: 25_000,
    sourceSelectionEndMs: 26_000
  });
  const mixed = mixShortFormAudioContributions(2_000, [
    {
      data: new Float32Array([0.4, -0.4, 0.4, -0.4, 0.4, -0.4, 0.4, -0.4]),
      numberOfChannels: 2,
      sampleRate: 2,
      timelineStartSeconds: 0,
      asset: baseAsset as never
    },
    {
      data: new Float32Array([0.8, -0.8, 0.8, -0.8]),
      numberOfChannels: 2,
      sampleRate: 2,
      timelineStartSeconds: 0.5,
      asset: overlapAsset as never
    }
  ], [{
    id: "duck-overlap-tail",
    startSeconds: 1,
    endSeconds: 1.5,
    targetGain: 0.5,
    fadeInSeconds: 0,
    fadeOutSeconds: 0
  }]);
  assert.equal(mixed.numberOfFrames, 4);
  assert.equal(mixed.sampleRate, 2);
  assert.equal(mixed.numberOfChannels, 2);
  assert.deepEqual([...mixed.data], [...new Float32Array([
    0.4, -0.4,
    1, -1,
    0.6, -0.6,
    0.4, -0.4
  ])]);
});

test("v7 음성 mixer는 무음 선두를 유지하고 단일 unity PCM을 바꾸지 않는다", () => {
  const asset = renderCanvasSourceAudioAsset({
    timelineStartMs: 500,
    timelineEndMs: 1_500,
    sourceStartMs: 20_000,
    sourceEndMs: 21_000
  });
  const mixed = mixShortFormAudioContributions(2_000, [{
    data: new Float32Array([0.25, -0.25, 0.5, -0.5]),
    numberOfChannels: 2,
    sampleRate: 2,
    timelineStartSeconds: 0.5,
    asset: asset as never
  }]);
  assert.deepEqual([...mixed.data], [...new Float32Array([
    0, 0,
    0.25, -0.25,
    0.5, -0.5,
    0, 0
  ])]);
});

test("쇼츠 layout은 원본 크기와 무관하게 1080x1920 인코딩 설정을 쓴다", () => {
  const sourceSettings = buildRenderEncodingSettings(
    640,
    360,
    30,
    true
  );
  const shortFormSettings = buildRenderEncodingSettings(
    640,
    360,
    30,
    true,
    { kind: "short-form", scenes: [] }
  );

  assert.deepEqual(
    { width: sourceSettings.width, height: sourceSettings.height },
    { width: 640, height: 360 },
    "기존 본편 출력은 원본 비율과 크기를 유지해야 합니다."
  );
  assert.deepEqual(
    { width: shortFormSettings.width, height: shortFormSettings.height },
    { width: 1080, height: 1920 }
  );
  assert.equal(shortFormSettings.frameRate, sourceSettings.frameRate);
  assert.equal(shortFormSettings.hasAudio, sourceSettings.hasAudio);
  assert.equal(
    shortFormSettings.videoBitrate,
    Math.max(8_000_000, Math.round(1080 * 1920 * 30 * 0.16))
  );
  assert.equal(
    sourceSettings.videoBitrate,
    Math.max(2_500_000, Math.round(640 * 360 * 30 * 0.08)),
    "본편 출력의 기존 용량 정책은 바뀌지 않아야 합니다."
  );
});

test("독립 쇼츠 소스 캐시는 임의 크롭을 위해 UHD 원본 디테일을 보존한다", () => {
  const normal = buildRenderEncodingSettings(3840, 2160, 30, true);
  const cache = buildRenderEncodingSettings(
    3840,
    2160,
    30,
    true,
    null,
    "source-quality-cache"
  );
  const bounded8kCache = buildRenderEncodingSettings(
    7680,
    4320,
    30,
    true,
    null,
    "source-quality-cache"
  );
  const portraitCache = buildRenderEncodingSettings(
    2160,
    3840,
    30,
    true,
    null,
    "source-quality-cache"
  );

  assert.deepEqual(
    { width: normal.width, height: normal.height },
    { width: 1920, height: 1080 }
  );
  assert.deepEqual(
    { width: cache.width, height: cache.height },
    { width: 3840, height: 2160 }
  );
  assert.deepEqual(
    { width: bounded8kCache.width, height: bounded8kCache.height },
    { width: 3840, height: 2160 }
  );
  assert.deepEqual(
    { width: portraitCache.width, height: portraitCache.height },
    { width: 2160, height: 3840 }
  );
});

test("쇼츠 확대 전용 캔버스는 브라우저 기본 low 대신 high 보간을 강제한다", () => {
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low" as ImageSmoothingQuality
  };

  enableHighQualityImageSmoothing(context);

  assert.equal(context.imageSmoothingEnabled, true);
  assert.equal(context.imageSmoothingQuality, "high");
});

test("쇼츠 최종 프레임은 적응형 canonical surface를 먼저 합성하고 수명주기 끝에 해제한다", () => {
  const surface = { width: 1_080, height: 1_920 };
  const placements: unknown[] = [];
  const composites: unknown[][] = [];
  let scalerDestroyCount = 0;
  let fallbackDrawCount = 0;
  const sample = {
    displayWidth: 1_920,
    displayHeight: 1_080,
    draw() {
      fallbackDrawCount += 1;
    }
  };
  const renderer = new AdaptiveShortFormFrameRenderer(1_080, 1_920, {
    createSurface: (width, height) => {
      assert.deepEqual([width, height], [1_080, 1_920]);
      return surface as unknown as OffscreenCanvas;
    },
    createScaler: (receivedSurface) => ({
      surface: receivedSurface,
      renderVideoSample(receivedSample, placement) {
        assert.equal(receivedSample, sample);
        placements.push(placement);
      },
      destroy() {
        scalerDestroyCount += 1;
      }
    })
  });
  const context = {
    drawImage(...args: unknown[]) {
      composites.push(args);
    }
  } as unknown as OffscreenCanvasRenderingContext2D;
  const geometry = {
    source: { left: 656, top: 0, width: 608, height: 1_080 },
    destination: { left: 0, top: 0, width: 1_080, height: 1_920 }
  };

  assert.equal(renderer.draw(sample, context, geometry), "adaptive");
  assert.deepEqual(placements, [{
    sourceRect: { x: 656, y: 0, width: 608, height: 1_080 },
    destinationRect: { x: 0, y: 0, width: 1_080, height: 1_920 },
    outputWidth: 1_080,
    outputHeight: 1_920
  }]);
  assert.deepEqual(composites, [[surface, 0, 0]]);
  assert.equal(fallbackDrawCount, 0);

  renderer.destroy();
  renderer.destroy();
  assert.equal(scalerDestroyCount, 1, "WebGL 자원은 정확히 한 번 해제해야 합니다.");
  assert.throws(
    () => renderer.draw(sample, context, geometry),
    /종료된 쇼츠 프레임 렌더러/u
  );
});

test("첫 적응형 프레임 전에 실패하면 현재 프레임부터 Canvas2D로 영구 고정한다", () => {
  const failure = new Error("simulated context loss");
  const fallbackCalls: unknown[][] = [];
  let adaptiveDrawCount = 0;
  let scalerDestroyCount = 0;
  let failureReportCount = 0;
  const sample = {
    displayWidth: 1_920,
    displayHeight: 1_080,
    draw(...args: unknown[]) {
      fallbackCalls.push(args);
    }
  };
  const renderer = new AdaptiveShortFormFrameRenderer(1_080, 1_920, {
    createSurface: () => ({ width: 1_080, height: 1_920 }) as OffscreenCanvas,
    createScaler: (surface) => ({
      surface,
      renderVideoSample() {
        adaptiveDrawCount += 1;
        throw failure;
      },
      destroy() {
        scalerDestroyCount += 1;
      }
    }),
    onFailure(error) {
      failureReportCount += 1;
      assert.equal(error, failure);
    }
  });
  const context = {
    drawImage() {
      assert.fail("실패한 적응형 surface를 합성하면 안 됩니다.");
    }
  } as unknown as OffscreenCanvasRenderingContext2D;
  const geometry = {
    source: { left: 12, top: 34, width: 560, height: 1_000 },
    destination: { left: 20, top: 40, width: 1_000, height: 1_800 }
  };

  assert.equal(renderer.draw(sample, context, geometry), "canvas2d");
  assert.equal(renderer.draw(sample, context, geometry), "canvas2d");
  assert.equal(adaptiveDrawCount, 1, "실패한 WebGL 경로를 다시 호출하면 안 됩니다.");
  assert.equal(scalerDestroyCount, 1);
  assert.equal(failureReportCount, 1);
  assert.equal(fallbackCalls.length, 2);
  assert.deepEqual(fallbackCalls[0], [
    context,
    12,
    34,
    560,
    1_000,
    20,
    40,
    1_000,
    1_800
  ]);

  renderer.destroy();
  assert.equal(scalerDestroyCount, 1);
});

test("적응형 프레임을 한 장이라도 합성한 뒤 실패하면 Canvas를 섞지 않고 재시작 오류를 낸다", () => {
  const contextLoss = new Error("simulated context loss after output");
  let adaptiveDrawCount = 0;
  let adaptiveCompositeCount = 0;
  let fallbackDrawCount = 0;
  let scalerDestroyCount = 0;
  let failureReportCount = 0;
  const sample = {
    displayWidth: 1_920,
    displayHeight: 1_080,
    draw() {
      fallbackDrawCount += 1;
    }
  };
  const renderer = new AdaptiveShortFormFrameRenderer(1_080, 1_920, {
    createSurface: () => ({ width: 1_080, height: 1_920 }) as OffscreenCanvas,
    createScaler: (surface) => ({
      surface,
      renderVideoSample() {
        adaptiveDrawCount += 1;
        if (adaptiveDrawCount === 2) {
          throw contextLoss;
        }
      },
      destroy() {
        scalerDestroyCount += 1;
      }
    }),
    onFailure(error) {
      failureReportCount += 1;
      assert.equal(error, contextLoss);
    }
  });
  const context = {
    drawImage() {
      adaptiveCompositeCount += 1;
    }
  } as unknown as OffscreenCanvasRenderingContext2D;
  const geometry = {
    source: { left: 656, top: 0, width: 608, height: 1_080 },
    destination: { left: 0, top: 0, width: 1_080, height: 1_920 }
  };

  assert.equal(renderer.draw(sample, context, geometry), "adaptive");
  let restartError: unknown;
  assert.throws(
    () => renderer.draw(sample, context, geometry),
    (error: unknown) => {
      assert.ok(error instanceof AdaptiveShortFormRenderRestartRequiredError);
      assert.equal(error.cause, contextLoss);
      restartError = error;
      return true;
    }
  );
  assert.throws(
    () => renderer.draw(sample, context, geometry),
    (error: unknown) => error === restartError,
    "호출자가 오류를 잡더라도 같은 renderer에서 Canvas2D로 이어가면 안 됩니다."
  );

  assert.equal(adaptiveDrawCount, 2);
  assert.equal(adaptiveCompositeCount, 1);
  assert.equal(fallbackDrawCount, 0);
  assert.equal(scalerDestroyCount, 1);
  assert.equal(failureReportCount, 1);
  renderer.destroy();
  assert.equal(scalerDestroyCount, 1);
});

test("WebGL2 초기화 실패도 한 번만 진단하고 모든 프레임을 Canvas2D로 그린다", () => {
  const initializationFailure = new Error("WebGL2 unavailable");
  let surfaceCreateCount = 0;
  let scalerCreateCount = 0;
  let failureReportCount = 0;
  let fallbackDrawCount = 0;
  const renderer = new AdaptiveShortFormFrameRenderer(1_080, 1_920, {
    createSurface: () => {
      surfaceCreateCount += 1;
      return { width: 1_080, height: 1_920 } as OffscreenCanvas;
    },
    createScaler: () => {
      scalerCreateCount += 1;
      throw initializationFailure;
    },
    onFailure(error) {
      failureReportCount += 1;
      assert.equal(error, initializationFailure);
    }
  });
  const sample = {
    displayWidth: 1_920,
    displayHeight: 1_080,
    draw() {
      fallbackDrawCount += 1;
    }
  };
  const context = { drawImage() {} } as unknown as OffscreenCanvasRenderingContext2D;
  const geometry = {
    source: { left: 0, top: 0, width: 1_920, height: 1_080 },
    destination: { left: 0, top: 656, width: 1_080, height: 608 }
  };

  assert.equal(renderer.draw(sample, context, geometry), "canvas2d");
  assert.equal(renderer.draw(sample, context, geometry), "canvas2d");
  renderer.destroy();

  assert.equal(surfaceCreateCount, 1);
  assert.equal(scalerCreateCount, 1);
  assert.equal(failureReportCount, 1);
  assert.equal(fallbackDrawCount, 2);
});

test("쇼츠 scene은 occurrence clipId로 찾고 같은 selection의 framing도 각각 유지한다", () => {
  const layout = {
    kind: "short-form" as const,
    scenes: [
      {
        clipId: "short-a-first",
        sourceClipId: "parent-a",
        selectionId: "scene-a",
        fit: "contain",
        positionX: 0.25,
        positionY: 0.75,
        zoom: 2.5,
        canvasX: 0.25,
        canvasY: 0.75,
        canvasScale: 1.2
      },
      {
        clipId: "short-a-repeat",
        sourceClipId: "parent-a",
        selectionId: "scene-a",
        fit: "cover",
        positionX: 0.8,
        positionY: 0.2,
        zoom: 1.5,
        canvasX: 0.8,
        canvasY: 0.2,
        canvasScale: 0.6
      },
      {
        clipId: "short-b",
        selectionId: "scene-b",
        fit: "invalid",
        positionX: Number.NaN,
        positionY: "",
        zoom: 0
      },
      {
        clipId: "short-c",
        selectionId: "scene-c",
        fit: "cover",
        positionX: -2,
        positionY: 5,
        zoom: 9
      }
    ]
  };

  assert.deepEqual(resolveShortFormRenderScene(layout, " short-a-first "), {
    clipId: "short-a-first",
    fit: "contain",
    positionX: 0.5,
    positionY: 0.5,
    zoom: 1,
    canvasX: 0.25,
    canvasY: 0.75,
    canvasScale: 1.2
  });
  assert.deepEqual(resolveShortFormRenderScene(layout, "short-a-repeat"), {
    clipId: "short-a-repeat",
    fit: "cover",
    positionX: 0.8,
    positionY: 0.2,
    zoom: 1.5,
    canvasX: 0.8,
    canvasY: 0.2,
    canvasScale: 0.6
  });
  assert.deepEqual(resolveShortFormRenderScene(layout, "short-b"), {
    clipId: "short-b",
    fit: "cover",
    positionX: 0.5,
    positionY: 0.5,
    zoom: 1,
    canvasX: 0.5,
    canvasY: 0.5,
    canvasScale: 1
  });
  assert.deepEqual(resolveShortFormRenderScene(layout, "short-c"), {
    clipId: "short-c",
    fit: "cover",
    positionX: 0,
    positionY: 1,
    zoom: 3,
    canvasX: 0.5,
    canvasY: 0.5,
    canvasScale: 1
  });
  assert.deepEqual(resolveShortFormRenderScene(layout, "missing"), {
    clipId: "missing",
    fit: "cover",
    positionX: 0.5,
    positionY: 0.5,
    zoom: 1,
    canvasX: 0.5,
    canvasY: 0.5,
    canvasScale: 1
  });
});

test("쇼츠 scene의 명시적 source·destination rect는 경계를 정규화해 보존한다", () => {
  const scene = resolveShortFormRenderScene({
    kind: "short-form",
    scenes: [{
      clipId: "short-exact",
      fit: "cover",
      positionX: 0.9,
      positionY: 0.1,
      zoom: 2,
      canvasX: 0.8,
      canvasY: 0.2,
      canvasScale: 1.5,
      sourceRect: {
        x: -0.1,
        y: 0.25,
        width: 0.6,
        height: 1,
        referenceWidth: 1919.4,
        referenceHeight: 1078.6
      },
      destinationRect: {
        x: 10.4,
        y: 20.6,
        width: 400.6,
        height: 700.4
      }
    }]
  }, "short-exact");

  assert.deepEqual(scene.sourceRect, {
    x: 0,
    y: 0.25,
    width: 0.6,
    height: 0.75,
    referenceWidth: 1919,
    referenceHeight: 1079
  });
  assert.deepEqual(scene.destinationRect, {
    x: 10,
    y: 21,
    width: 401,
    height: 700
  });
});

test("정규화 source rect는 odd decoded frame에서도 기준 해상도의 정확한 픽셀 경계를 복원한다", () => {
  assert.deepEqual(shortFormSourceCropFromNormalizedRect(
    1919,
    1079,
    {
      x: 137 / 1919,
      y: 53 / 1079,
      width: 701 / 1919,
      height: 509 / 1079,
      referenceWidth: 1919,
      referenceHeight: 1079
    }
  ), {
    left: 137,
    top: 53,
    width: 701,
    height: 509
  });
});

test("정규화 source rect는 actual decoded frame에 맞춰 overflow를 자르고 최소 1픽셀을 지킨다", () => {
  assert.deepEqual(shortFormSourceCropFromNormalizedRect(
    1919,
    1079,
    {
      x: -0.2,
      y: 0.8,
      width: 0.45,
      height: 0.5,
      referenceWidth: 640,
      referenceHeight: 360
    }
  ), {
    left: 0,
    top: 863,
    width: 864,
    height: 216
  });
  assert.deepEqual(shortFormSourceCropFromNormalizedRect(
    7,
    5,
    {
      x: 0.999,
      y: 0.999,
      width: 0.0005,
      height: 0.0005,
      referenceWidth: 7,
      referenceHeight: 5
    }
  ), {
    left: 6,
    top: 4,
    width: 1,
    height: 1
  });
  assert.deepEqual(shortFormSourceCropFromNormalizedRect(
    1920,
    1080,
    {
      x: 1.1,
      y: 0,
      width: 0.2,
      height: 1,
      referenceWidth: 1920,
      referenceHeight: 1080
    }
  ), {
    left: 1919,
    top: 0,
    width: 1,
    height: 1080
  });
});

test("canonical destination rect는 export 픽셀을 그대로 쓰고 preview에는 경계 단위로 축소한다", () => {
  const destinationRect = { x: 137, y: 251, width: 401, height: 703 };
  assert.deepEqual(shortFormDestinationRectForTarget(
    1080,
    1920,
    destinationRect
  ), {
    left: 137,
    top: 251,
    width: 401,
    height: 703
  });
  assert.deepEqual(shortFormDestinationRectForTarget(
    540,
    960,
    destinationRect
  ), {
    left: 69,
    top: 126,
    width: 200,
    height: 351
  });
  assert.deepEqual(shortFormDestinationRectForTarget(
    1080,
    1920,
    { x: -101, y: 1900, width: 301, height: 101 }
  ), {
    left: -101,
    top: 1900,
    width: 301,
    height: 101
  });
});

test("명시적 source·destination rect는 legacy fit·focal·canvas 값보다 우선한다", () => {
  const sourceRect = {
    x: 137 / 1919,
    y: 53 / 1079,
    width: 701 / 1919,
    height: 509 / 1079,
    referenceWidth: 1919,
    referenceHeight: 1079
  };
  const scene = {
    fit: "contain" as const,
    positionX: 0.99,
    positionY: 0.01,
    zoom: 3,
    canvasX: 0.9,
    canvasY: 0.1,
    canvasScale: 2,
    sourceRect,
    destinationRect: { x: 137, y: 251, width: 401, height: 703 }
  };
  assert.deepEqual(shortFormVideoDrawGeometry(
    1919,
    1079,
    1080,
    1920,
    scene
  ), {
    source: { left: 137, top: 53, width: 701, height: 509 },
    destination: { left: 137, top: 251, width: 401, height: 703 }
  });
  assert.deepEqual(shortFormVideoDrawGeometry(
    1919,
    1079,
    540,
    960,
    scene
  ), {
    source: { left: 137, top: 53, width: 701, height: 509 },
    destination: { left: 69, top: 126, width: 200, height: 351 }
  });
});

test("명시적 rect는 쌍이 완전할 때만 활성화되고 draw plan에서도 legacy contain보다 우선한다", () => {
  const exactLayout = {
    kind: "short-form" as const,
    scenes: [{
      clipId: "short-exact-plan",
      fit: "contain",
      sourceRect: {
        x: 137 / 1919,
        y: 53 / 1079,
        width: 701 / 1919,
        height: 509 / 1079,
        referenceWidth: 1919,
        referenceHeight: 1079
      },
      destinationRect: { x: 137, y: 251, width: 401, height: 703 }
    }]
  };
  assert.deepEqual(buildVideoFrameDrawPlan(
    exactLayout,
    { id: "short-exact-plan", selectionId: "parent" },
    1919,
    1079,
    1080,
    1920
  ), {
    fit: "fill",
    crop: { left: 137, top: 53, width: 701, height: 509 }
  });

  const incomplete = resolveShortFormRenderScene({
    kind: "short-form",
    scenes: [{
      clipId: "short-incomplete",
      fit: "contain",
      sourceRect: exactLayout.scenes[0]!.sourceRect
    }]
  }, "short-incomplete");
  assert.equal(incomplete.sourceRect, undefined);
  assert.equal(incomplete.destinationRect, undefined);
  assert.deepEqual(buildVideoFrameDrawPlan(
    { kind: "short-form", scenes: [incomplete] },
    { id: "short-incomplete", selectionId: "parent" },
    1919,
    1079,
    1080,
    1920
  ), { fit: "contain" });
});

test("쇼츠 cover 영상은 crop과 캔버스 크기·위치를 하나의 draw geometry로 계산한다", () => {
  assert.deepEqual(shortFormVideoDrawGeometry(
    1920,
    1080,
    1080,
    1920,
    {
      fit: "cover",
      positionX: 0.25,
      positionY: 0.75,
      zoom: 2,
      canvasX: 0.25,
      canvasY: 0.8,
      canvasScale: 0.5
    }
  ), {
    source: { left: 404, top: 405, width: 304, height: 540 },
    destination: { left: 0, top: 1056, width: 540, height: 960 }
  });
});

test("쇼츠 contain 영상도 원본 비율을 보존한 채 캔버스 크기·위치를 적용한다", () => {
  assert.deepEqual(shortFormVideoDrawGeometry(
    1920,
    1080,
    1080,
    1920,
    {
      fit: "contain",
      positionX: 0.1,
      positionY: 0.9,
      zoom: 3,
      canvasX: 0.8,
      canvasY: 0.25,
      canvasScale: 1.5
    }
  ), {
    source: { left: 0, top: 0, width: 1920, height: 1080 },
    destination: { left: 54, top: 25, width: 1620, height: 911 }
  });
});

test("쇼츠 cover crop은 9:16 창을 scene별 가로·세로 위치에 맞춘다", () => {
  assert.deepEqual(shortFormCoverCrop(
    1920,
    1080,
    1080,
    1920,
    0,
    0.5
  ), {
    left: 0,
    top: 0,
    width: 608,
    height: 1080
  });
  assert.deepEqual(shortFormCoverCrop(
    1920,
    1080,
    1080,
    1920,
    1,
    0.5
  ), {
    left: 1312,
    top: 0,
    width: 608,
    height: 1080
  });
  assert.deepEqual(shortFormCoverCrop(
    1080,
    2160,
    1080,
    1920,
    0.5,
    1
  ), {
    left: 0,
    top: 240,
    width: 1080,
    height: 1920
  });
  assert.deepEqual(shortFormCoverCrop(
    1080,
    1920,
    1080,
    1920,
    Number.NaN,
    Number.NaN
  ), {
    left: 0,
    top: 0,
    width: 1080,
    height: 1920
  });
  assert.deepEqual(shortFormCoverCrop(
    1920,
    1080,
    1080,
    1920,
    0.25,
    0.75,
    2
  ), {
    left: 404,
    top: 405,
    width: 304,
    height: 540
  });
});

test("본편은 contain을 유지하고 쇼츠만 scene별 contain 또는 focal crop을 적용한다", () => {
  const clip = { id: "short-a", selectionId: "scene-a" };
  assert.deepEqual(buildVideoFrameDrawPlan(
    null,
    clip,
    1920,
    1080,
    1920,
    1080
  ), { fit: "contain" });

  const containLayout = {
    kind: "short-form" as const,
    scenes: [{
      clipId: "short-a",
      selectionId: "scene-a",
      fit: "contain",
      positionX: 0.2,
      positionY: 0.8,
      zoom: 2
    }]
  };
  assert.deepEqual(buildVideoFrameDrawPlan(
    containLayout,
    clip,
    1920,
    1080,
    1080,
    1920
  ), { fit: "contain" });

  const coverLayout = {
    kind: "short-form" as const,
    scenes: [{
      clipId: "short-a",
      selectionId: "scene-a",
      fit: "cover",
      positionX: 0.25,
      positionY: 0.5,
      zoom: 2
    }]
  };
  assert.deepEqual(buildVideoFrameDrawPlan(
    coverLayout,
    clip,
    1920,
    1080,
    1080,
    1920
  ), {
    fit: "fill",
    crop: {
      left: 404,
      top: 270,
      width: 304,
      height: 540
    }
  });
  assert.deepEqual(buildVideoFrameDrawPlan(
    { kind: "short-form", scenes: [] },
    clip,
    1920,
    1080,
    1080,
    1920
  ), {
    fit: "fill",
    crop: {
      left: 656,
      top: 0,
      width: 608,
      height: 1080
    }
  });
  assert.equal(RENDER_LETTERBOX_COLOR, "#000000");
});

test("쇼츠 cover crop은 끝 초점·확대·홀수 원본에서도 정수 픽셀 경계를 지킨다", () => {
  const cases: Array<readonly [number, number, number, number, number]> = [
    [1920, 1080, 0, 0, 1],
    [1920, 1080, 0.5, 0.5, 1.05],
    [1920, 1080, 1, 1, 1],
    [1920, 1080, 1, 0.5, 3],
    [1919, 1079, 1, 1, 1.35],
    [1081, 2161, 1, 1, 1.05]
  ];
  for (const [sourceWidth, sourceHeight, positionX, positionY, zoom] of cases) {
    const crop = shortFormCoverCrop(
      sourceWidth,
      sourceHeight,
      1080,
      1920,
      positionX,
      positionY,
      zoom
    );
    assert(Object.values(crop).every(Number.isInteger));
    assert(crop.left >= 0);
    assert(crop.top >= 0);
    assert(crop.width >= 1);
    assert(crop.height >= 1);
    assert(crop.left + crop.width <= sourceWidth);
    assert(crop.top + crop.height <= sourceHeight);
  }
});

test("코덱 probe는 실제 출력 크기·비트레이트를 쓰고 무음 영상에서 오디오를 요구하지 않는다", async () => {
  const settings = buildRenderEncodingSettings(3_840, 2_160, 59.94, false);
  const videoCalls: Array<{
    codec: string;
    options: unknown;
  }> = [];
  let audioCalls = 0;
  const profile = await chooseOutputCodecs(settings, {
    videoProbe: async (codec, options) => {
      assert.ok(options);
      videoCalls.push({ codec, options });
      return codec === "avc";
    },
    audioProbe: async () => {
      audioCalls += 1;
      return false;
    }
  });

  assert.equal(profile.extension, "mp4");
  assert.equal(profile.audioCodec, null);
  assert.equal(profile.hardwareAcceleration, "prefer-hardware");
  assert.equal(audioCalls, 0);
  assert.deepEqual(videoCalls, [{
    codec: "avc",
    options: {
      width: 1_920,
      height: 1_080,
      bitrate: settings.videoBitrate,
      hardwareAcceleration: "prefer-hardware",
      latencyMode: "quality"
    }
  }]);
});

test("하드웨어 인코더가 없으면 지원되는 소프트웨어 프로필로 내려간다", async () => {
  const settings = buildRenderEncodingSettings(1_280, 720, 30, true);
  const videoCalls: Array<{
    codec: string;
    preference: string | undefined;
  }> = [];
  const profile = await chooseOutputCodecs(settings, {
    videoProbe: async (codec, options) => {
      assert.ok(options);
      videoCalls.push({ codec, preference: options.hardwareAcceleration });
      return codec === "vp9" && options.hardwareAcceleration === "no-preference";
    },
    audioProbe: async (codec) => codec === "opus"
  });

  assert.equal(profile.extension, "webm");
  assert.equal(profile.videoCodec, "vp9");
  assert.equal(profile.audioCodec, "opus");
  assert.equal(profile.hardwareAcceleration, "no-preference");
  assert.deepEqual(videoCalls, [
    { codec: "vp9", preference: "prefer-hardware" },
    { codec: "vp9", preference: "no-preference" }
  ]);
});

test("파일 스트림은 finalize 준비 전 close에서는 abort하고 성공 경로에서만 commit한다", async () => {
  const abortedEvents: Array<[string, unknown?]> = [];
  const abortedFile = {
    async write(chunk: FileSystemWriteChunkType) {
      abortedEvents.push(["write", chunk]);
    },
    async close() {
      abortedEvents.push(["close"]);
    },
    async abort(reason?: unknown) {
      abortedEvents.push(["abort", reason]);
    }
  };
  const abortedTransaction = createFileWriteTransaction(
    abortedFile as unknown as FileSystemWritableFileStream
  );
  const abortedWriter = abortedTransaction.writable.getWriter();
  await abortedWriter.write({ type: "write", position: 0, data: new Uint8Array([1]) });
  await abortedWriter.close();
  assert.deepEqual(abortedEvents.map(([event]) => event), ["write", "abort"]);

  const committedEvents: Array<[string, unknown?]> = [];
  const committedFile = {
    async write(chunk: FileSystemWriteChunkType) {
      committedEvents.push(["write", chunk]);
    },
    async close() {
      committedEvents.push(["close"]);
    },
    async abort(reason?: unknown) {
      committedEvents.push(["abort", reason]);
    }
  };
  const committedTransaction = createFileWriteTransaction(
    committedFile as unknown as FileSystemWritableFileStream
  );
  const committedWriter = committedTransaction.writable.getWriter();
  await committedWriter.write({ type: "write", position: 0, data: new Uint8Array([2]) });
  committedTransaction.prepareCommit();
  await committedWriter.close();
  assert.deepEqual(committedEvents.map(([event]) => event), ["write", "close"]);
});

test("적응형 부분 파일을 abort한 뒤 같은 내보내기를 Canvas2D로 처음부터 한 번만 재시작한다", async () => {
  const events: string[] = [];
  const attempts: string[] = [];
  const adaptiveFailure = new Error("adaptive frame 2 failed");

  const result = await runShortFormRenderWithCanvasRetry(async (backend) => {
    attempts.push(backend);
    events.push(`${backend}:start`);
    const file = {
      async write(chunk: FileSystemWriteChunkType) {
        const positionedChunk = chunk as {
          position?: number;
        };
        assert.equal(positionedChunk.position, 0);
        events.push(`${backend}:write-from-zero`);
      },
      async close() {
        events.push(`${backend}:commit`);
      },
      async abort() {
        events.push(`${backend}:abort`);
      }
    };
    const transaction = createFileWriteTransaction(
      file as unknown as FileSystemWritableFileStream
    );
    const writer = transaction.writable.getWriter();
    await writer.write({
      type: "write",
      position: 0,
      data: new Uint8Array(backend === "adaptive" ? [1] : [2])
    });

    if (backend === "adaptive") {
      await writer.abort(adaptiveFailure);
      throw new AdaptiveShortFormRenderRestartRequiredError(adaptiveFailure);
    }

    transaction.prepareCommit();
    await writer.close();
    return backend;
  }, {
    onFallback(error) {
      assert.equal(error.cause, adaptiveFailure);
      events.push("fallback-restart");
    }
  });

  assert.equal(result, "canvas2d");
  assert.deepEqual(attempts, ["adaptive", "canvas2d"]);
  assert.deepEqual(events, [
    "adaptive:start",
    "adaptive:write-from-zero",
    "adaptive:abort",
    "fallback-restart",
    "canvas2d:start",
    "canvas2d:write-from-zero",
    "canvas2d:commit"
  ]);
});

test("호환 렌더러 재시작은 취소 시 생략하고 Canvas2D 실패를 다시 재시도하지 않는다", async () => {
  const controller = new AbortController();
  const canceledAttempts: string[] = [];
  await assert.rejects(
    runShortFormRenderWithCanvasRetry(async (backend) => {
      canceledAttempts.push(backend);
      controller.abort();
      throw new AdaptiveShortFormRenderRestartRequiredError(
        new Error("context lost while canceling")
      );
    }, { signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError"
  );
  assert.deepEqual(canceledAttempts, ["adaptive"]);

  const canvasFailure = new Error("Canvas encoder failed");
  const failedAttempts: string[] = [];
  await assert.rejects(
    runShortFormRenderWithCanvasRetry(async (backend) => {
      failedAttempts.push(backend);
      if (backend === "adaptive") {
        throw new AdaptiveShortFormRenderRestartRequiredError(
          new Error("context lost")
        );
      }
      throw canvasFailure;
    }),
    (error: unknown) => error === canvasFailure
  );
  assert.deepEqual(failedAttempts, ["adaptive", "canvas2d"]);
});

test("파일 commit 자체가 실패해도 원본 오류를 유지한 채 abort로 정리할 수 있다", async () => {
  const events: string[] = [];
  const networkError = new DOMException("network error", "NetworkError");
  const file = {
    async write() {},
    async close() {
      events.push("close");
      throw networkError;
    },
    async abort() {
      events.push("abort");
    }
  };
  const transaction = createFileWriteTransaction(
    file as unknown as FileSystemWritableFileStream
  );
  const writer = transaction.writable.getWriter();
  transaction.prepareCommit();
  await assert.rejects(
    writer.close(),
    (error: unknown) => error === networkError
  );
  await transaction.abort();
  assert.deepEqual(events, ["close", "abort"]);
});

test("추가 영상 레이어 source clock은 시작 포함·끝 제외이며 decoder timestamp가 단조 증가한다", () => {
  const layer = renderVideoLayer();
  assert.equal(shortFormVideoLayerSourceTimeMs(layer, 499.999), null);
  assert.equal(shortFormVideoLayerSourceTimeMs(layer, 500), 20_000);
  assert.equal(shortFormVideoLayerSourceTimeMs(layer, 2_000), 21_500);
  assert.equal(shortFormVideoLayerSourceTimeMs(layer, 2_500), null);

  const clip = asRenderClip({
    id: "short-a",
    selectionId: "scene-a",
    sourceStartMs: 10_000,
    sourceEndMs: 14_000,
    timelineStartMs: 0,
    enabled: true
  });
  assert.deepEqual(
    [...shortFormVideoLayerSourceTimestamps(layer, clip, 2, 3)],
    [23, 23.5, 24, 24.5]
  );
});

test("추가 영상 레이어는 독립 source crop과 canonical destination을 계산한다", () => {
  assert.deepEqual(shortFormVideoLayerDrawGeometry(
    1920,
    1080,
    1080,
    1920,
    renderVideoLayer()
  ), {
    source: { left: 480, top: 0, width: 960, height: 1080 },
    destination: { left: 540, top: 0, width: 540, height: 960 }
  });
});

test("추가 영상 opacity는 sample draw 동안만 적용하고 반드시 context를 복원한다", () => {
  const events: string[] = [];
  const mockContext = {
    globalAlpha: 1,
    save() {
      events.push(`save:${mockContext.globalAlpha}`);
    },
    restore() {
      events.push(`restore:${mockContext.globalAlpha}`);
      mockContext.globalAlpha = 1;
    }
  };
  const context = mockContext as unknown as OffscreenCanvasRenderingContext2D;
  const sample = {
    draw() {
      events.push(`draw:${context.globalAlpha}`);
    }
  } as unknown as import("mediabunny").VideoSample;
  drawShortFormVideoSample(sample, context, {
    source: { left: 0, top: 0, width: 10, height: 10 },
    destination: { left: 1, top: 2, width: 3, height: 4 }
  }, null, 0.35);
  assert.deepEqual(events, ["save:1", "draw:0.35", "restore:0.35"]);
  assert.equal(context.globalAlpha, 1);
});

test("쇼츠 render scene은 추가 영상을 정규화하고 동일 primary source만 허용한다", () => {
  const resolved = resolveShortFormRenderScene({
    kind: "short-form",
    scenes: [{
      clipId: "short-a",
      videoLayers: [
        renderVideoLayer({ sourceAssetId: undefined }),
        renderVideoLayer({ id: "foreign", sourceAssetId: "foreign-file" })
      ]
    }]
  }, "short-a", 4_000);
  assert.deepEqual(resolved.videoLayers?.map(({ id, sourceAssetId }) => ({
    id,
    sourceAssetId
  })), [{ id: "layer-a", sourceAssetId: "project-primary" }]);
});

test("export layer 검증은 decoder 상한·잘못된 asset·원본 밖 시간을 fail closed한다", () => {
  const clip = asRenderClip({
    id: "short-a",
    selectionId: "scene-a",
    sourceStartMs: 10_000,
    sourceEndMs: 14_000,
    timelineStartMs: 0,
    enabled: true
  });
  assert.doesNotThrow(() => validateShortFormRenderVideoLayers({
    kind: "short-form",
    scenes: [{ clipId: "short-a", videoLayers: [renderVideoLayer()] }]
  }, [clip], 30_000));
  assert.throws(() => validateShortFormRenderVideoLayers({
    kind: "short-form",
    scenes: [{
      clipId: "short-a",
      videoLayers: [renderVideoLayer({ sourceStartMs: 29_000, sourceEndMs: 31_000 })]
    }]
  }, [clip], 30_000), /원본 길이 밖/u);
  assert.throws(() => validateShortFormRenderVideoLayers({
    kind: "short-form",
    scenes: [{
      clipId: "short-a",
      videoLayers: [renderVideoLayer({ sourceAssetId: "foreign-file" })]
    }]
  }, [clip], 30_000), /정보가 올바르지/u);
  assert.throws(() => validateShortFormRenderVideoLayers({
    kind: "short-form",
    scenes: [{
      clipId: "short-a",
      videoLayers: Array.from({ length: 9 }, (_, index) => (
        renderVideoLayer({ id: `layer-${index}` })
      ))
    }]
  }, [clip], 30_000), /최대 8개/u);

  for (const malformed of [
    renderVideoLayer({ sourceAssetId: undefined }),
    renderVideoLayer({ sourceEndMs: 23_000 }),
    renderVideoLayer({ opacity: 2 }),
    renderVideoLayer({ visible: "false" }),
    renderVideoLayer({ zIndex: 0 }),
    renderVideoLayer({ startOffsetMs: "500" }),
    renderVideoLayer({
      sourceRect: {
        x: 0.25,
        y: 0,
        width: 2,
        height: 1,
        referenceWidth: 1920,
        referenceHeight: 1080
      }
    }),
    renderVideoLayer({
      destinationRect: { x: 540.5, y: 0, width: 540, height: 960 }
    })
  ]) {
    assert.throws(() => validateShortFormRenderVideoLayers({
      kind: "short-form",
      scenes: [{ clipId: "short-a", videoLayers: [malformed] }]
    }, [clip], 30_000), /정보가 올바르지|저장값이 정규 형식/u);
  }

  assert.throws(() => validateShortFormRenderVideoLayers({
    kind: "short-form",
    scenes: [{ clipId: "short-a", videoLayers: {} as never }]
  }, [clip], 30_000), /레이어 목록이 올바르지/u);

  assert.throws(() => validateShortFormRenderVideoLayers({
    kind: "short-form",
    scenes: [{
      clipId: "short-a",
      videoLayers: [renderVideoLayer(), renderVideoLayer()]
    }]
  }, [clip], 30_000), /저장값이 정규 형식/u);
});

test("v7 검은 캔버스 CFR은 영상 자산이 없어도 명시한 전체 길이를 프레임으로 만든다", () => {
  const layout = validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 510,
    videoLaneCount: 1,
    videoAssets: [],
    sourceAudioAssets: []
  }, 30_000);
  assert.deepEqual(layout, {
    durationMs: 510,
    videoLaneCount: 1,
    videoAssets: [],
    sourceAudioAssets: []
  });
  assert.deepEqual(shortFormCanvasCfrFrameRange(layout.durationMs, 30), {
    firstFrameIndex: 0,
    endFrameIndex: 16
  });
  const finalFrame = shortFormCanvasCfrFrameTiming(510, 15, 30);
  assert.ok(finalFrame.duration < 1 / 30);
  assert.ok(Math.abs(
    finalFrame.outputTimestamp + finalFrame.duration - 0.51
  ) < 1e-12);
  assert.deepEqual(activeShortFormRenderVideoAssets(layout, 250), []);
});

test("v7 영상 자산은 audioGain을 자동 음성과 exact legacy override에 한 번만 조합한다", () => {
  const layout = validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 4_000,
    videoLaneCount: 1,
    videoAssets: [
      renderCanvasVideoAsset({
        id: "video-with-default-audio",
        audioGain: 1.5
      }),
      renderCanvasVideoAsset({
        id: "video-with-explicit-audio",
        audioGain: 2,
        sourceStartMs: 25_000,
        sourceEndMs: 26_000,
        sourceSelectionStartMs: 25_000,
        sourceSelectionEndMs: 26_000,
        timelineStartMs: 3_000,
        timelineEndMs: 4_000
      })
    ],
    sourceAudioAssets: [renderCanvasSourceAudioAsset({
      id: "explicit-video-audio",
      sourceStartMs: 25_000,
      sourceEndMs: 26_000,
      sourceSelectionStartMs: 24_500,
      sourceSelectionEndMs: 26_500,
      timelineStartMs: 3_000,
      timelineEndMs: 4_000,
      gain: 0.35,
      muted: true,
      fadeInMs: 100,
      fadeOutMs: 200
    })]
  }, 30_000);

  assert.equal(layout.sourceAudioAssets.length, 2);
  assert.deepEqual(
    layout.sourceAudioAssets.map((asset) => ({
      id: asset.id,
      sourceStartMs: asset.sourceStartMs,
      timelineStartMs: asset.timelineStartMs,
      gain: asset.gain,
      muted: asset.muted,
      fadeInMs: asset.fadeInMs,
      fadeOutMs: asset.fadeOutMs
    })),
    [
      {
        id: "video-audio:video-with-default-audio",
        sourceStartMs: 20_000,
        timelineStartMs: 500,
        gain: 1.5,
        muted: false,
        fadeInMs: 0,
        fadeOutMs: 0
      },
      {
        id: "explicit-video-audio",
        sourceStartMs: 25_000,
        timelineStartMs: 3_000,
        gain: 0.7,
        muted: true,
        fadeInMs: 100,
        fadeOutMs: 200
      }
    ]
  );
});

test("v7 별도 legacy 음성은 자동 영상 음성과 겹쳐도 함께 보존한다", () => {
  const layout = validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 4_000,
    videoLaneCount: 1,
    videoAssets: [renderCanvasVideoAsset()],
    sourceAudioAssets: [renderCanvasSourceAudioAsset({
      id: "legacy-overlay-audio",
      sourceStartMs: 25_000,
      sourceEndMs: 26_000,
      sourceSelectionStartMs: 25_000,
      sourceSelectionEndMs: 26_000,
      timelineStartMs: 1_000,
      timelineEndMs: 2_000
    })]
  }, 30_000);
  assert.equal(layout.sourceAudioAssets.length, 2);
  assert.deepEqual(
    layout.sourceAudioAssets.map(({ id }) => id),
    ["video-audio:video-a", "legacy-overlay-audio"]
  );
});

test("v7 숨김·완전 투명 영상은 결합 음성을 내보내지 않는다", () => {
  const hidden = renderCanvasVideoAsset({
    id: "hidden-av",
    visible: false
  });
  const transparent = renderCanvasVideoAsset({
    id: "transparent-av",
    opacity: 0,
    sourceStartMs: 22_000,
    sourceEndMs: 24_000,
    timelineStartMs: 2_500,
    timelineEndMs: 4_500
  });
  const audible = renderCanvasVideoAsset({
    id: "audible-av",
    sourceStartMs: 20_000,
    sourceEndMs: 21_000,
    timelineStartMs: 4_500,
    timelineEndMs: 5_500
  });
  const layout = validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 5_500,
    videoLaneCount: 1,
    videoAssets: [hidden, transparent, audible],
    sourceAudioAssets: [renderCanvasSourceAudioAsset({
      id: "hidden-legacy-override",
      visible: undefined
    })]
  }, 30_000);
  assert.deepEqual(
    layout.sourceAudioAssets.map(({ id }) => id),
    ["video-audio:audible-av"]
  );
});

test("같은 원본·시각의 영상 둘은 각 audioGain과 legacy gain을 곱해 중복 없는 contribution을 유지한다", () => {
  const layout = validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 2_500,
    videoLaneCount: 2,
    videoAssets: [
      renderCanvasVideoAsset({ id: "same-a", zIndex: 0, audioGain: 0.5 }),
      renderCanvasVideoAsset({
        id: "same-b",
        zIndex: 1,
        lane: 1,
        audioGain: 2
      })
    ],
    sourceAudioAssets: [renderCanvasSourceAudioAsset({
      id: "shared-legacy-settings",
      gain: 0.4
    })]
  }, 30_000);
  assert.equal(layout.sourceAudioAssets.length, 2);
  assert.deepEqual(
    layout.sourceAudioAssets.map(({ gain }) => gain),
    [0.2, 0.8]
  );
  assert.equal(new Set(layout.sourceAudioAssets.map(({ id }) => id)).size, 2);

  assert.throws(() => validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 2_500,
    videoLaneCount: 1,
    videoAssets: [renderCanvasVideoAsset()],
    sourceAudioAssets: [
      renderCanvasSourceAudioAsset({ id: "duplicate-override-a" }),
      renderCanvasSourceAudioAsset({ id: "duplicate-override-b" })
    ]
  }, 30_000), /exact legacy 설정을 중복 적용/u);
});

test("허용된 compact media shortfall의 마지막 window는 v7 source-end 검증과 일치한다", () => {
  const materialization = {
    mediaDurationMs: 42_000
  } as ChzzkVodMaterialization;
  const acceptedMediaDurationMs = 41_999.5;
  assert.equal(materializedMediaTimelineMatches(materialization, {
    durationMs: acceptedMediaDurationMs,
    mediaOriginMs: 0
  }), true);
  assert.doesNotThrow(() => validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 1_000,
    videoLaneCount: 1,
    videoAssets: [renderCanvasVideoAsset({
      sourceSelectionStartMs: 41_000,
      sourceSelectionEndMs: 42_000,
      sourceStartMs: 41_000,
      sourceEndMs: 42_000,
      timelineStartMs: 0,
      timelineEndMs: 1_000
    })],
    sourceAudioAssets: []
  }, acceptedMediaDurationMs));

  const rejectedMediaDurationMs = 41_999.49;
  assert.equal(materializedMediaTimelineMatches(materialization, {
    durationMs: rejectedMediaDurationMs,
    mediaOriginMs: 0
  }), false);
  assert.throws(() => validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 1_000,
    videoLaneCount: 1,
    videoAssets: [renderCanvasVideoAsset({
      sourceSelectionStartMs: 41_000,
      sourceSelectionEndMs: 42_000,
      sourceStartMs: 41_000,
      sourceEndMs: 42_000,
      timelineStartMs: 0,
      timelineEndMs: 1_000
    })],
    sourceAudioAssets: []
  }, rejectedMediaDurationMs), /저장값이 정규 형식과 일치하지 않습니다/u);
});

test("v7 영상 자산은 모두 동등한 absolute clock으로 활성화하고 z/id 순서로 그린다", () => {
  const layout = validateShortFormCanvasRenderLayout({
    kind: "short-form",
    durationMs: 4_000,
    videoLaneCount: 3,
    videoAssets: [
      renderCanvasVideoAsset({ id: "front-b", zIndex: 3, lane: 2 }),
      renderCanvasVideoAsset({ id: "back", zIndex: 1, lane: 0 }),
      renderCanvasVideoAsset({ id: "front-a", zIndex: 3, lane: 1 }),
      renderCanvasVideoAsset({
        id: "later",
        sourceSelectionStartMs: 25_000,
        sourceSelectionEndMs: 26_000,
        sourceStartMs: 25_000,
        sourceEndMs: 26_000,
        timelineStartMs: 3_000,
        timelineEndMs: 4_000,
        zIndex: 0
      })
    ],
    sourceAudioAssets: [renderCanvasSourceAudioAsset()]
  }, 30_000);

  assert.deepEqual(
    activeShortFormRenderVideoAssets(layout, 500).map(({ id }) => id),
    ["back", "front-a", "front-b"]
  );
  assert.deepEqual(
    activeShortFormRenderVideoAssets(layout, 2_500).map(({ id }) => id),
    []
  );
  assert.deepEqual(
    activeShortFormRenderVideoAssets(layout, 3_000).map(({ id }) => id),
    ["later"]
  );
  const back = layout.videoAssets.find(({ id }) => id === "back")!;
  assert.equal(shortFormVideoAssetSourceTimeMs(back, 499.999), null);
  assert.equal(shortFormVideoAssetSourceTimeMs(back, 500), 20_000);
  assert.equal(shortFormVideoAssetSourceTimeMs(back, 2_000), 21_500);
  assert.equal(shortFormVideoAssetSourceTimeMs(back, 2_500), null);
  assert.deepEqual(
    [...shortFormVideoAssetSourceTimestamps(
      back,
      layout.durationMs,
      2,
      3
    )],
    [23, 23.5, 24, 24.5]
  );
});

test("v7 영상 자산은 독립 crop·destination을 계산하고 active sample 누락을 fail closed한다", () => {
  assert.deepEqual(shortFormVideoAssetDrawGeometry(
    1920,
    1080,
    1080,
    1920,
    renderCanvasVideoAsset() as never
  ), {
    source: { left: 480, top: 0, width: 960, height: 1080 },
    destination: { left: 540, top: 0, width: 540, height: 960 }
  });
  const sample = { frame: "asset" };
  assert.equal(
    requireRenderShortFormVideoAssetSample(sample, "video-a"),
    sample
  );
  assert.throws(
    () => requireRenderShortFormVideoAssetSample(null, "video-a"),
    /video-a 영상 자산의 원본 프레임을 읽지 못했습니다/u
  );
});

test("v7 export 검증은 corrupt asset과 active decoder 폭주를 fail closed한다", () => {
  const valid = {
    kind: "short-form" as const,
    durationMs: 4_000,
    videoLaneCount: 1,
    videoAssets: [renderCanvasVideoAsset()],
    sourceAudioAssets: [renderCanvasSourceAudioAsset()]
  };
  assert.doesNotThrow(() => validateShortFormCanvasRenderLayout(valid, 30_000));

  assert.throws(() => validateShortFormCanvasRenderLayout({
    ...valid,
    videoLaneCount: 1,
    videoAssets: [
      renderCanvasVideoAsset({ id: "lane-first" }),
      renderCanvasVideoAsset({ id: "lane-overlap" })
    ]
  }, 30_000), /같은 쇼츠 영상 에셋 라인/u);
  assert.doesNotThrow(() => validateShortFormCanvasRenderLayout({
    ...valid,
    videoLaneCount: 2,
    videoAssets: [
      renderCanvasVideoAsset({ id: "lane-first" }),
      renderCanvasVideoAsset({ id: "lane-parallel", lane: 1 })
    ]
  }, 30_000));

  for (const malformed of [
    { ...valid, durationMs: "4000" },
    { ...valid, videoLaneCount: undefined },
    { ...valid, videoLaneCount: "1" },
    { ...valid, videoLaneCount: Number.NaN },
    { ...valid, videoLaneCount: 0 },
    { ...valid, videoLaneCount: 10 },
    { ...valid, videoAssets: {} },
    { ...valid, sourceAudioAssets: {} },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ id: " video-a " })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ id: "v".repeat(161) })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ sourceClipId: " source-a " })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ sourceAssetId: "foreign" })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ timelineStartMs: "500" })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ timelineEndMs: 3_000 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ sourceStartMs: 19_999 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ sourceSelectionEndMs: 31_000 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ sourceEndMs: 31_000 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ opacity: 2 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ audioGain: undefined })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ audioGain: "1" })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ audioGain: Number.NaN })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ audioGain: -0.01 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ audioGain: 2.01 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ lane: -1 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ lane: 1 })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ visible: "false" })] },
    { ...valid, videoAssets: [renderCanvasVideoAsset({ zIndex: -1 })] },
    {
      ...valid,
      sourceAudioAssets: [renderCanvasSourceAudioAsset({ gain: 1.01 })]
    },
    {
      ...valid,
      sourceAudioAssets: [renderCanvasSourceAudioAsset({ gain: Number.NaN })]
    },
    {
      ...valid,
      sourceAudioAssets: [renderCanvasSourceAudioAsset({ muted: "false" })]
    },
    {
      ...valid,
      sourceAudioAssets: [renderCanvasSourceAudioAsset({ fadeInMs: "100" })]
    },
    {
      ...valid,
      sourceAudioAssets: [renderCanvasSourceAudioAsset({ fadeOutMs: 2_001 })]
    },
    {
      ...valid,
      videoAssets: [renderCanvasVideoAsset(), renderCanvasVideoAsset()]
    }
  ]) {
    assert.throws(
      () => validateShortFormCanvasRenderLayout(malformed as never, 30_000),
      /올바르지|정규 형식|중복/u
    );
  }

  assert.throws(() => validateShortFormCanvasRenderLayout({
    ...valid,
    videoAssets: Array.from(
      { length: SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS + 1 },
      (_, index) => renderCanvasVideoAsset({ id: `overlap-${index}` })
    )
  }, 30_000), /최대 9개/u);

  assert.doesNotThrow(() => validateShortFormCanvasRenderLayout({
    ...valid,
    durationMs: (SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS + 1) * 100,
    videoAssets: Array.from(
      { length: SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS + 1 },
      (_, index) => renderCanvasVideoAsset({
        id: `serial-${index}`,
        sourceStartMs: 20_000 + index * 100,
        sourceEndMs: 20_100 + index * 100,
        timelineStartMs: index * 100,
        timelineEndMs: (index + 1) * 100
      })
    ),
    sourceAudioAssets: []
  }, 30_000));

  assert.throws(() => validateShortFormCanvasRenderLayout({
    ...valid,
    durationMs: 6_500,
    videoAssets: Array.from(
      { length: 65 },
      (_, index) => renderCanvasVideoAsset({
        id: `serial-overflow-${index}`,
        sourceSelectionEndMs: 27_000,
        sourceStartMs: 20_000 + index * 100,
        sourceEndMs: 20_100 + index * 100,
        timelineStartMs: index * 100,
        timelineEndMs: (index + 1) * 100
      })
    ),
    sourceAudioAssets: []
  }, 30_000), /최대 64개/u);

  assert.doesNotThrow(() => validateShortFormCanvasRenderLayout({
    ...valid,
    sourceAudioAssets: [
      renderCanvasSourceAudioAsset(),
      renderCanvasSourceAudioAsset({
        id: "source-audio-b",
        sourceSelectionStartMs: 25_000,
        sourceSelectionEndMs: 26_000,
        sourceStartMs: 25_000,
        sourceEndMs: 26_000,
        timelineStartMs: 2_000,
        timelineEndMs: 3_000
      })
    ]
  }, 30_000));
});
