/**
 * Pure synchronization policy for an independently cached short-form video.
 *
 * Paused scrubbing and initial priming need frame-accurate seeks. Once playback
 * has started, however, the decoder clock must be allowed to run: repeatedly
 * seeking to a requestAnimationFrame-driven target turns normal decode latency
 * into a moving-target seek loop. Only a genuine discontinuity is therefore a
 * hard resynchronization while playing.
 */

export type ShortPreviewPlaybackPhase = "paused" | "priming" | "playing";

export interface ShortPreviewPlaybackPolicy {
  readonly exactSeekToleranceSeconds: number;
  readonly playingHardResyncThresholdSeconds: number;
}

export const DEFAULT_SHORT_PREVIEW_PLAYBACK_POLICY: ShortPreviewPlaybackPolicy =
  Object.freeze({
    exactSeekToleranceSeconds: 0.02,
    playingHardResyncThresholdSeconds: 0.3
  });

export type ShortPreviewPlaybackDecisionReason =
  | "seek-in-flight"
  | "paused-aligned"
  | "paused-exact-seek"
  | "priming-aligned"
  | "priming-exact-seek"
  | "playing-decoder-clock"
  | "playing-hard-resync";

export interface ShortPreviewPlaybackDecisionInput {
  readonly phase: ShortPreviewPlaybackPhase;
  /** Desired media time derived from the canvas master clock. */
  readonly targetSeconds: number;
  /** Current media time reported by the independent video decoder. */
  readonly decoderSeconds: number;
  readonly seeking?: boolean;
  readonly policy?: ShortPreviewPlaybackPolicy;
}

export interface ShortPreviewPlaybackDecision {
  readonly phase: ShortPreviewPlaybackPhase;
  readonly targetSeconds: number;
  readonly decoderSeconds: number;
  /** Positive means that the decoder is behind the canvas target. */
  readonly targetMinusDecoderSeconds: number;
  readonly absoluteDriftSeconds: number;
  readonly shouldSeek: boolean;
  readonly seekTargetSeconds: number | null;
  /**
   * True only when normal playback should continue from the decoder clock.
   * Consumers should not rewrite currentTime while this is true.
   */
  readonly useDecoderClock: boolean;
  /** A playing hard seek must re-anchor the master clock when it completes. */
  readonly reanchorMasterAfterSeek: boolean;
  readonly reason: ShortPreviewPlaybackDecisionReason;
}

/**
 * The three independent facts required before an active layer can use one
 * cached HTMLVideoElement as its combined picture + sound decoder.
 *
 * `cacheHasAudio` is deliberately not inferred from a successful video load:
 * an MP4 can decode pictures perfectly while carrying no usable audio track.
 */
export interface ShortPreviewCombinedAvCacheReadinessInput {
  readonly cacheMatches?: boolean;
  readonly cacheCoversSourceTime?: boolean;
  readonly cacheHasAudio?: boolean;
}

/** Minimal active source span shared by a video and its legacy audio override. */
export interface ShortPreviewSourceBackedTimelineSpan {
  readonly sourceAssetId: string;
  readonly sourceClipId: string;
  readonly sourceSelectionStartMs: number;
  readonly sourceSelectionEndMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly timelineStartMs: number;
  readonly timelineEndMs: number;
}

export type ShortPreviewVideoLayerAudioDecisionReason =
  | "legacy-exact-audio-override"
  | "combined-av-cache-not-ready"
  | "decoder-not-ready"
  | "decoder-not-playing"
  | "decoder-not-synchronized"
  | "preview-muted"
  | "zero-volume"
  | "combined-av-audible";

export interface ShortPreviewVideoLayerAudioDecisionInput {
  /** Result of shortPreviewCombinedAvCacheReady for this active layer. */
  readonly combinedAvCacheReady: boolean;
  /** The same decoder that supplies the drawn video frame has current data. */
  readonly decoderReady: boolean;
  /** The same decoder's play() promise has settled and it is not paused. */
  readonly decoderPlaying: boolean;
  /** The same decoder is not seeking and is within the accepted clock drift. */
  readonly decoderSynchronized: boolean;
  /** A separate, exactly matching legacy source-audio asset owns the sound. */
  readonly legacyExactAudioOverride?: boolean;
  readonly previewMuted?: boolean;
  readonly requestedVolume: number;
}

export interface ShortPreviewVideoLayerAudioDecision {
  readonly audible: boolean;
  readonly muted: boolean;
  /**
   * Safe value to assign to HTMLMediaElement.volume. This is deliberately
   * either zero or unity: HTML media volume cannot represent amplification.
   */
  readonly mediaElementVolume: 0 | 1;
  /** Gain for the layer's Web Audio GainNode, including 1x..2x boost. */
  readonly webAudioGain: number;
  readonly reason: ShortPreviewVideoLayerAudioDecisionReason;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

/**
 * Fail closed unless the cache is the right source, covers this exact source
 * time, and contains a usable audio track. Video-only cache success is not
 * sufficient for combined A/V playback.
 */
export function shortPreviewCombinedAvCacheReady(
  input: ShortPreviewCombinedAvCacheReadinessInput
): boolean {
  return input.cacheMatches === true
    && input.cacheCoversSourceTime === true
    && input.cacheHasAudio === true;
}

function validSourceBackedTimelineSpan(
  value: ShortPreviewSourceBackedTimelineSpan | null | undefined
): value is ShortPreviewSourceBackedTimelineSpan {
  return Boolean(
    value
    && typeof value.sourceAssetId === "string"
    && value.sourceAssetId.length > 0
    && typeof value.sourceClipId === "string"
    && value.sourceClipId.length > 0
    && Number.isFinite(value.sourceSelectionStartMs)
    && Number.isFinite(value.sourceSelectionEndMs)
    && Number.isFinite(value.sourceStartMs)
    && Number.isFinite(value.sourceEndMs)
    && Number.isFinite(value.timelineStartMs)
    && Number.isFinite(value.timelineEndMs)
    && value.sourceStartMs >= 0
    && value.timelineStartMs >= 0
    && value.sourceSelectionStartMs >= 0
    && value.sourceSelectionEndMs > value.sourceSelectionStartMs
    && value.sourceStartMs >= value.sourceSelectionStartMs
    && value.sourceEndMs <= value.sourceSelectionEndMs
    && value.sourceEndMs > value.sourceStartMs
    && value.timelineEndMs > value.timelineStartMs
  );
}

/**
 * A legacy source-audio asset overrides only the exact audible video span it
 * mirrors. The immutable selection envelope is a cache/edit boundary rather
 * than audible content identity, so a wider historical envelope does not turn
 * the same source+timeline PCM into a second sound. Partial active overlaps
 * still remain independent.
 */
export function shortPreviewSourceAudioExactlyOverridesVideo(
  video: ShortPreviewSourceBackedTimelineSpan | null | undefined,
  audio: ShortPreviewSourceBackedTimelineSpan | null | undefined
): boolean {
  return validSourceBackedTimelineSpan(video)
    && validSourceBackedTimelineSpan(audio)
    && video.sourceAssetId === audio.sourceAssetId
    && video.sourceClipId === audio.sourceClipId
    && video.sourceStartMs === audio.sourceStartMs
    && video.sourceEndMs === audio.sourceEndMs
    && video.timelineStartMs === audio.timelineStartMs
    && video.timelineEndMs === audio.timelineEndMs;
}

/**
 * Decide whether an active video layer may expose its embedded audio.
 *
 * Picture and sound deliberately share one decoder. The sound therefore stays
 * muted until that exact decoder is ready, playing, and synchronized. A legacy
 * exact audio asset has first refusal so old projects cannot double their
 * volume during migration to combined A/V caches.
 */
export function shortPreviewVideoLayerAudioDecision(
  input: ShortPreviewVideoLayerAudioDecisionInput
): ShortPreviewVideoLayerAudioDecision {
  const requestedVolume = finiteNonNegative(
    input.requestedVolume,
    "requestedVolume"
  );
  if (requestedVolume > 2) {
    throw new RangeError("requestedVolume must be at most 2.");
  }
  const reason: ShortPreviewVideoLayerAudioDecisionReason =
    input.legacyExactAudioOverride === true
      ? "legacy-exact-audio-override"
      : input.combinedAvCacheReady !== true
        ? "combined-av-cache-not-ready"
        : input.decoderReady !== true
          ? "decoder-not-ready"
          : input.decoderPlaying !== true
            ? "decoder-not-playing"
            : input.decoderSynchronized !== true
              ? "decoder-not-synchronized"
              : input.previewMuted === true
                ? "preview-muted"
                : requestedVolume <= 0
                  ? "zero-volume"
                  : "combined-av-audible";
  const audible = reason === "combined-av-audible";
  return {
    audible,
    muted: !audible,
    mediaElementVolume: audible ? 1 : 0,
    webAudioGain: audible ? requestedVolume : 0,
    reason
  };
}

function normalizedPolicy(
  value: ShortPreviewPlaybackPolicy | undefined
): ShortPreviewPlaybackPolicy {
  const policy = value || DEFAULT_SHORT_PREVIEW_PLAYBACK_POLICY;
  const exactSeekToleranceSeconds = finiteNonNegative(
    policy.exactSeekToleranceSeconds,
    "exactSeekToleranceSeconds"
  );
  const playingHardResyncThresholdSeconds = finiteNonNegative(
    policy.playingHardResyncThresholdSeconds,
    "playingHardResyncThresholdSeconds"
  );
  if (playingHardResyncThresholdSeconds <= exactSeekToleranceSeconds) {
    throw new RangeError(
      "playingHardResyncThresholdSeconds must be greater than "
      + "exactSeekToleranceSeconds."
    );
  }
  return {
    exactSeekToleranceSeconds,
    playingHardResyncThresholdSeconds
  };
}

function decisionReason(
  phase: ShortPreviewPlaybackPhase,
  shouldSeek: boolean
): ShortPreviewPlaybackDecisionReason {
  if (phase === "playing") {
    return shouldSeek ? "playing-hard-resync" : "playing-decoder-clock";
  }
  if (phase === "priming") {
    return shouldSeek ? "priming-exact-seek" : "priming-aligned";
  }
  return shouldSeek ? "paused-exact-seek" : "paused-aligned";
}

/**
 * Decide whether assigning HTMLMediaElement.currentTime is semantically safe.
 *
 * The caller must report an in-flight seek. The policy never issues another
 * assignment until that seek settles. A playing hard-resync signal is handled
 * by freezing and globally re-priming every active decoder at one timeline.
 */
export function shortPreviewPlaybackDecision(
  input: ShortPreviewPlaybackDecisionInput
): ShortPreviewPlaybackDecision {
  const targetSeconds = finiteNonNegative(input.targetSeconds, "targetSeconds");
  const decoderSeconds = finiteNonNegative(input.decoderSeconds, "decoderSeconds");
  const policy = normalizedPolicy(input.policy);
  const targetMinusDecoderSeconds = targetSeconds - decoderSeconds;
  const absoluteDriftSeconds = Math.abs(targetMinusDecoderSeconds);

  if (input.seeking === true) {
    return {
      phase: input.phase,
      targetSeconds,
      decoderSeconds,
      targetMinusDecoderSeconds,
      absoluteDriftSeconds,
      shouldSeek: false,
      seekTargetSeconds: null,
      useDecoderClock: false,
      reanchorMasterAfterSeek: false,
      reason: "seek-in-flight"
    };
  }

  const toleranceSeconds = input.phase === "playing"
    ? policy.playingHardResyncThresholdSeconds
    : policy.exactSeekToleranceSeconds;
  const shouldSeek = absoluteDriftSeconds > toleranceSeconds;

  return {
    phase: input.phase,
    targetSeconds,
    decoderSeconds,
    targetMinusDecoderSeconds,
    absoluteDriftSeconds,
    shouldSeek,
    seekTargetSeconds: shouldSeek ? targetSeconds : null,
    useDecoderClock: input.phase === "playing" && !shouldSeek,
    reanchorMasterAfterSeek: input.phase === "playing" && shouldSeek,
    reason: decisionReason(input.phase, shouldSeek)
  };
}
