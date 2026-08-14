import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHORT_PREVIEW_PLAYBACK_POLICY,
  shortPreviewCombinedAvCacheReady,
  shortPreviewSourceAudioExactlyOverridesVideo,
  shortPreviewVideoLayerAudioDecision,
  shortPreviewPlaybackDecision
} from "../src/editor/short-preview-playback-policy.js";

const sourceSpan = (overrides: Partial<{
  sourceAssetId: string;
  sourceClipId: string;
  sourceSelectionStartMs: number;
  sourceSelectionEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
}> = {}) => ({
  sourceAssetId: "project-primary",
  sourceClipId: "clip-a",
  sourceSelectionStartMs: 9_000,
  sourceSelectionEndMs: 15_000,
  sourceStartMs: 10_000,
  sourceEndMs: 14_000,
  timelineStartMs: 2_000,
  timelineEndMs: 6_000,
  ...overrides
});

test("paused와 priming은 정지 프레임 정확도만큼 벗어날 때 exact seek한다", () => {
  for (const phase of ["paused", "priming"] as const) {
    const aligned = shortPreviewPlaybackDecision({
      phase,
      targetSeconds: 12,
      decoderSeconds: 11.99
    });
    assert.equal(aligned.shouldSeek, false);
    assert.equal(aligned.useDecoderClock, false);

    const drifted = shortPreviewPlaybackDecision({
      phase,
      targetSeconds: 12,
      decoderSeconds: 11.95
    });
    assert.equal(drifted.shouldSeek, true);
    assert.equal(drifted.seekTargetSeconds, 12);
    assert.equal(drifted.reanchorMasterAfterSeek, false);
    assert.equal(drifted.reason, `${phase}-exact-seek`);
  }
});

test("playing은 300ms 안쪽의 정상 decode 지연을 seek하지 않고 decoder clock에 맡긴다", () => {
  const decision = shortPreviewPlaybackDecision({
    phase: "playing",
    targetSeconds: 10,
    decoderSeconds: 9.72
  });

  assert.equal(
    DEFAULT_SHORT_PREVIEW_PLAYBACK_POLICY.playingHardResyncThresholdSeconds,
    0.3
  );
  assert.equal(decision.shouldSeek, false);
  assert.equal(decision.seekTargetSeconds, null);
  assert.equal(decision.useDecoderClock, true);
  assert.equal(decision.reason, "playing-decoder-clock");
  assert.ok(Math.abs(decision.targetMinusDecoderSeconds - 0.28) < 1e-9);
});

test("RAF moving target과 80ms decoder 지연은 연속 seek를 만들지 않는다", () => {
  let decoderSeconds = 4;
  let seekCount = 0;

  for (let frame = 1; frame <= 120; frame += 1) {
    const targetSeconds = 4 + frame / 60;
    // A normally playing decoder remains about 80ms behind the wall clock.
    decoderSeconds = targetSeconds - 0.08;
    const decision = shortPreviewPlaybackDecision({
      phase: "playing",
      targetSeconds,
      decoderSeconds
    });
    if (decision.shouldSeek) {
      seekCount += 1;
    }
    assert.equal(decision.useDecoderClock, true);
  }

  assert.equal(seekCount, 0);
  assert.ok(decoderSeconds > 5.8, "decoder clock 자체가 계속 전진해야 합니다.");
});

test("playing의 큰 불연속만 hard resync하고 진행 중 seek에는 덮어쓰지 않는다", () => {
  const discontinuity = shortPreviewPlaybackDecision({
    phase: "playing",
    targetSeconds: 8,
    decoderSeconds: 7.61
  });
  assert.equal(discontinuity.shouldSeek, true);
  assert.equal(discontinuity.seekTargetSeconds, 8);
  assert.equal(discontinuity.useDecoderClock, false);
  assert.equal(discontinuity.reanchorMasterAfterSeek, true);
  assert.equal(discontinuity.reason, "playing-hard-resync");

  const inFlight = shortPreviewPlaybackDecision({
    phase: "playing",
    targetSeconds: 8.2,
    decoderSeconds: 7.61,
    seeking: true
  });
  assert.equal(inFlight.shouldSeek, false);
  assert.equal(inFlight.seekTargetSeconds, null);
  assert.equal(inFlight.reason, "seek-in-flight");
});

test("결합 A/V cache는 source 일치·현재 시각 coverage·audio track을 모두 요구한다", () => {
  assert.equal(shortPreviewCombinedAvCacheReady({
    cacheMatches: true,
    cacheCoversSourceTime: true,
    cacheHasAudio: true
  }), true);

  for (const missing of [
    "cacheMatches",
    "cacheCoversSourceTime",
    "cacheHasAudio"
  ] as const) {
    const readiness = {
      cacheMatches: true,
      cacheCoversSourceTime: true,
      cacheHasAudio: true
    };
    readiness[missing] = false;
    assert.equal(
      shortPreviewCombinedAvCacheReady(readiness),
      false,
      `${missing}=false는 video-only 성공을 A/V ready로 올리면 안 됩니다.`
    );
  }
  assert.equal(shortPreviewCombinedAvCacheReady({}), false);
});

test("legacy 원본 음성 override는 같은 source·timeline span에만 exact match한다", () => {
  const video = sourceSpan();
  assert.equal(
    shortPreviewSourceAudioExactlyOverridesVideo(video, sourceSpan()),
    true
  );
  assert.equal(shortPreviewSourceAudioExactlyOverridesVideo(
    video,
    sourceSpan({
      sourceSelectionStartMs: 9_001,
      sourceSelectionEndMs: 14_999
    })
  ), true, "선택 envelope는 같은 활성 PCM의 cache 경계일 뿐입니다.");
  for (const audio of [
    sourceSpan({ sourceAssetId: "other-source" }),
    sourceSpan({ sourceClipId: "clip-b" }),
    sourceSpan({ sourceStartMs: 10_001 }),
    sourceSpan({ sourceEndMs: 13_999 }),
    sourceSpan({ timelineStartMs: 2_001 }),
    sourceSpan({ timelineEndMs: 5_999 })
  ]) {
    assert.equal(
      shortPreviewSourceAudioExactlyOverridesVideo(video, audio),
      false
    );
  }
  assert.equal(shortPreviewSourceAudioExactlyOverridesVideo(video, null), false);
  assert.equal(shortPreviewSourceAudioExactlyOverridesVideo(
    video,
    sourceSpan({ sourceEndMs: 10_000 })
  ), false);
});

test("영상 layer audio는 같은 decoder가 ready·playing·sync일 때만 열린다", () => {
  const base = {
    combinedAvCacheReady: true,
    decoderReady: true,
    decoderPlaying: true,
    decoderSynchronized: true,
    legacyExactAudioOverride: false,
    previewMuted: false,
    requestedVolume: 0.65
  };
  assert.deepEqual(shortPreviewVideoLayerAudioDecision(base), {
    audible: true,
    muted: false,
    mediaElementVolume: 1,
    webAudioGain: 0.65,
    reason: "combined-av-audible"
  });

  for (const [field, reason] of [
    ["combinedAvCacheReady", "combined-av-cache-not-ready"],
    ["decoderReady", "decoder-not-ready"],
    ["decoderPlaying", "decoder-not-playing"],
    ["decoderSynchronized", "decoder-not-synchronized"]
  ] as const) {
    const decision = shortPreviewVideoLayerAudioDecision({
      ...base,
      [field]: false
    });
    assert.equal(decision.audible, false);
    assert.equal(decision.muted, true);
    assert.equal(decision.mediaElementVolume, 0);
    assert.equal(decision.webAudioGain, 0);
    assert.equal(decision.reason, reason);
  }
});

test("exact legacy audio override와 전역 mute는 결합 audio 중복·누출을 막는다", () => {
  const base = {
    combinedAvCacheReady: true,
    decoderReady: true,
    decoderPlaying: true,
    decoderSynchronized: true,
    previewMuted: false,
    requestedVolume: 1
  };
  assert.deepEqual(shortPreviewVideoLayerAudioDecision({
    ...base,
    legacyExactAudioOverride: true
  }), {
    audible: false,
    muted: true,
    mediaElementVolume: 0,
    webAudioGain: 0,
    reason: "legacy-exact-audio-override"
  });
  assert.equal(shortPreviewVideoLayerAudioDecision({
    ...base,
    previewMuted: true
  }).reason, "preview-muted");
  assert.equal(shortPreviewVideoLayerAudioDecision({
    ...base,
    requestedVolume: 0
  }).reason, "zero-volume");
});

test("영상 layer 음량 0·1·2는 HTML media unity와 Web Audio 증폭으로 분리한다", () => {
  const base = {
    combinedAvCacheReady: true,
    decoderReady: true,
    decoderPlaying: true,
    decoderSynchronized: true,
    previewMuted: false
  };
  assert.deepEqual(shortPreviewVideoLayerAudioDecision({
    ...base,
    requestedVolume: 0
  }), {
    audible: false,
    muted: true,
    mediaElementVolume: 0,
    webAudioGain: 0,
    reason: "zero-volume"
  });
  for (const requestedVolume of [1, 2]) {
    assert.deepEqual(shortPreviewVideoLayerAudioDecision({
      ...base,
      requestedVolume
    }), {
      audible: true,
      muted: false,
      mediaElementVolume: 1,
      webAudioGain: requestedVolume,
      reason: "combined-av-audible"
    });
  }
});

test("잘못된 정책값과 시각을 거절한다", () => {
  assert.throws(() => shortPreviewPlaybackDecision({
    phase: "playing",
    targetSeconds: 1,
    decoderSeconds: 1,
    policy: {
      exactSeekToleranceSeconds: 0.3,
      playingHardResyncThresholdSeconds: 0.3
    }
  }), /must be greater/u);
  assert.throws(() => shortPreviewPlaybackDecision({
    phase: "paused",
    targetSeconds: Number.NaN,
    decoderSeconds: 0
  }), /targetSeconds/u);
  assert.throws(() => shortPreviewVideoLayerAudioDecision({
    combinedAvCacheReady: true,
    decoderReady: true,
    decoderPlaying: true,
    decoderSynchronized: true,
    requestedVolume: Number.NaN
  }), /requestedVolume/u);
  assert.throws(() => shortPreviewVideoLayerAudioDecision({
    combinedAvCacheReady: true,
    decoderReady: true,
    decoderPlaying: true,
    decoderSynchronized: true,
    requestedVolume: -0.01
  }), /requestedVolume/u);
  assert.throws(() => shortPreviewVideoLayerAudioDecision({
    combinedAvCacheReady: true,
    decoderReady: true,
    decoderPlaying: true,
    decoderSynchronized: true,
    requestedVolume: 2.01
  }), /at most 2/u);
});
