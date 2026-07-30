// SPDX-License-Identifier: MIT
/*
 * Browser integration of AudSeg 0.1.0.
 *
 * Ported from the sibling MIT-licensed AudSeg Python package in this
 * repository. Sample indexes remain the canonical timebase. The editor uses a
 * 4-second cue ceiling so blank timing drafts follow its existing subtitle
 * readability policy.
 */

export const AUDSEG_ENGINE_ID = "audseg";
export const AUDSEG_ENGINE_VERSION = "0.1.0";
export const AUDSEG_DRAFT_MODEL = "audseg-local";
export const AUDSEG_SAMPLE_RATE_HZ = 16_000;
export const MAX_AUDSEG_CLIP_DURATION_MS = 30 * 60 * 1_000;
export const MAX_AUDSEG_PCM_BYTES = 128 * 1024 * 1024;
export const AUDSEG_PIPELINE_FINGERPRINT =
  "audseg-browser-v1-0.1.0-frame20-hop10-max4000";

export const DEFAULT_AUDSEG_CONFIG = Object.freeze({
  detector: Object.freeze({
    frameMs: 20,
    hopMs: 10,
    noisePercentile: 0.2,
    noiseCeilingDbfs: -45,
    minimumOnDbfs: -65,
    minimumOffDbfs: -68,
    onMarginDb: 10,
    offMarginDb: 6,
    peakGuardDb: 6,
    hysteresisDb: 4,
    fixedThresholdDbfs: null,
    onsetMs: 40,
    releaseMs: 250,
    minRegionMs: 120,
    mergeGapMs: 100,
    padStartMs: 40,
    padEndMs: 80
  }),
  cues: Object.freeze({
    maxDurationMs: 4_000,
    minSplitDurationMs: 500,
    splitSearchMs: 2_000
  })
});

const DBFS_FLOOR = -120;

export interface AudSegDetectorConfig {
  frameMs: number;
  hopMs: number;
  noisePercentile: number;
  noiseCeilingDbfs: number;
  minimumOnDbfs: number;
  minimumOffDbfs: number;
  onMarginDb: number;
  offMarginDb: number;
  peakGuardDb: number;
  hysteresisDb: number;
  fixedThresholdDbfs: number | null;
  onsetMs: number;
  releaseMs: number;
  minRegionMs: number;
  mergeGapMs: number;
  padStartMs: number;
  padEndMs: number;
}

export interface AudSegCuePolicy {
  maxDurationMs: number | null;
  minSplitDurationMs: number;
  splitSearchMs: number;
}

export interface AudSegFrameLevel {
  startSample: number;
  endSample: number;
  dbfs: number;
}

interface AudSegRawRegion {
  startSample: number;
  endSample: number;
  endReason: string;
}

export interface AudSegActivityRegion extends AudSegRawRegion {
  peakDbfs: number;
  meanDbfs: number;
}

export interface AudSegSegment {
  startSample: number;
  endSample: number;
  sourceRegion: number;
  forcedSplit: boolean;
  splitMethod: string | null;
}

export interface AudSegResult {
  schema: "kirinuki-audseg-browser-result/v1";
  engine: {
    id: typeof AUDSEG_ENGINE_ID;
    version: typeof AUDSEG_ENGINE_VERSION;
    modelFree: true;
    transcription: false;
    fingerprint: typeof AUDSEG_PIPELINE_FINGERPRINT;
  };
  sampleRateHz: number;
  totalSamples: number;
  estimatedNoiseDbfs: number;
  effectiveNoiseDbfs: number;
  peakDbfs: number;
  startThresholdDbfs: number;
  stopThresholdDbfs: number;
  activityRegions: AudSegActivityRegion[];
  segments: AudSegSegment[];
  warnings: string[];
}

export function audSegAudioFootprint(durationMs: unknown): {
  durationMs: number;
  sampleCount: number;
  floatPcmBytes: number;
} {
  const duration = Math.round(Number(durationMs));
  if (
    !Number.isFinite(duration)
    || duration <= 0
    || duration > MAX_AUDSEG_CLIP_DURATION_MS
  ) {
    throw new RangeError(
      "AudSeg 빈 타이밍은 한 컷당 30분 이하에서 실행할 수 있습니다. 긴 컷은 먼저 여러 컷으로 나눠 주세요."
    );
  }
  const sampleCount = Math.ceil(
    duration * AUDSEG_SAMPLE_RATE_HZ / 1_000
  );
  const floatPcmBytes = sampleCount * Float32Array.BYTES_PER_ELEMENT;
  if (floatPcmBytes > MAX_AUDSEG_PCM_BYTES) {
    throw new RangeError(
      "AudSeg 브라우저 분석용 PCM이 128MiB 안전 상한을 넘습니다. 긴 컷은 먼저 여러 컷으로 나눠 주세요."
    );
  }
  return {
    durationMs: duration,
    sampleCount,
    floatPcmBytes
  };
}

function millisecondsToSamples(milliseconds: number, sampleRateHz: number, {
  minimum = 0
}: { minimum?: number } = {}): number {
  return Math.max(
    minimum,
    Math.round(Number(milliseconds) * sampleRateHz / 1_000)
  );
}

function powerToDbfs(power: number): number {
  return 10 * Math.log10(Math.max(power, 1e-12));
}

function frameDbfs(sampleSum: number, squareSum: number, count: number): number {
  const mean = sampleSum / count;
  const variance = Math.max(0, squareSum / count - mean * mean);
  return powerToDbfs(variance);
}

function validateSamples(samples: Float32Array, sampleRateHz: number): void {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("AudSeg에는 Float32 PCM 오디오가 필요합니다.");
  }
  if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError("AudSeg sample rate는 양의 정수여야 합니다.");
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (
      !Number.isFinite(sample)
      || sample < -1.000_001
      || sample > 1.000_001
    ) {
      throw new RangeError("AudSeg PCM 표본은 -1부터 1 사이의 유한한 값이어야 합니다.");
    }
    if (sample < -1 || sample > 1) {
      samples[index] = Math.max(-1, Math.min(1, sample));
    }
  }
}

export function extractAudSegFrameLevels(
  samples: Float32Array,
  sampleRateHz: number = AUDSEG_SAMPLE_RATE_HZ,
  detector: AudSegDetectorConfig = DEFAULT_AUDSEG_CONFIG.detector
): { levels: AudSegFrameLevel[]; totalSamples: number } {
  validateSamples(samples, sampleRateHz);
  const frameSamples = Math.max(
    1,
    millisecondsToSamples(detector.frameMs, sampleRateHz)
  );
  const hopSamples = Math.min(
    frameSamples,
    Math.max(1, millisecondsToSamples(detector.hopMs, sampleRateHz))
  );
  const levels: AudSegFrameLevel[] = [];
  let frameStart = 0;
  let lastEmittedEnd = 0;

  while (frameStart + frameSamples <= samples.length) {
    let sampleSum = 0;
    let squareSum = 0;
    const frameEnd = frameStart + frameSamples;
    for (let index = frameStart; index < frameEnd; index += 1) {
      const sample = samples[index];
      sampleSum += sample;
      squareSum += sample * sample;
    }
    levels.push({
      startSample: frameStart,
      endSample: frameEnd,
      dbfs: frameDbfs(sampleSum, squareSum, frameSamples)
    });
    lastEmittedEnd = frameEnd;
    frameStart += hopSamples;
  }

  if (frameStart < samples.length && lastEmittedEnd < samples.length) {
    let sampleSum = 0;
    let squareSum = 0;
    for (let index = frameStart; index < samples.length; index += 1) {
      const sample = samples[index];
      sampleSum += sample;
      squareSum += sample * sample;
    }
    levels.push({
      startSample: frameStart,
      endSample: samples.length,
      dbfs: frameDbfs(
        sampleSum,
        squareSum,
        samples.length - frameStart
      )
    });
  }

  return {
    levels,
    totalSamples: samples.length
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return DBFS_FLOOR;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return ordered[lower];
  }
  const weight = position - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

function thresholds(
  levels: readonly AudSegFrameLevel[],
  detector: AudSegDetectorConfig
): {
  estimatedNoiseDbfs: number;
  effectiveNoiseDbfs: number;
  peakDbfs: number;
  startThresholdDbfs: number;
  stopThresholdDbfs: number;
} {
  const values = levels.map((frame) => frame.dbfs);
  const estimatedNoiseDbfs = percentile(values, detector.noisePercentile);
  const effectiveNoiseDbfs = Math.min(
    estimatedNoiseDbfs,
    detector.noiseCeilingDbfs
  );
  const peakDbfs = values.reduce(
    (peak, value) => Math.max(peak, value),
    DBFS_FLOOR
  );
  let startThresholdDbfs;
  let stopThresholdDbfs;

  if (detector.fixedThresholdDbfs != null) {
    startThresholdDbfs = detector.fixedThresholdDbfs;
    stopThresholdDbfs = Math.max(
      DBFS_FLOOR,
      startThresholdDbfs - detector.hysteresisDb
    );
  } else {
    const adaptiveOn = effectiveNoiseDbfs + detector.onMarginDb;
    const peakGuarded = peakDbfs - detector.peakGuardDb;
    startThresholdDbfs = Math.max(
      detector.minimumOnDbfs,
      Math.min(adaptiveOn, peakGuarded)
    );
    const adaptiveOff = effectiveNoiseDbfs + detector.offMarginDb;
    stopThresholdDbfs = Math.max(
      detector.minimumOffDbfs,
      Math.min(
        adaptiveOff,
        startThresholdDbfs - detector.hysteresisDb
      )
    );
    if (stopThresholdDbfs >= startThresholdDbfs) {
      stopThresholdDbfs = Math.max(
        DBFS_FLOOR,
        startThresholdDbfs - 0.1
      );
    }
  }

  return {
    estimatedNoiseDbfs,
    effectiveNoiseDbfs,
    peakDbfs,
    startThresholdDbfs,
    stopThresholdDbfs
  };
}

function rawRegions(
  levels: readonly AudSegFrameLevel[],
  totalSamples: number,
  sampleRateHz: number,
  detector: AudSegDetectorConfig,
  startThresholdDbfs: number,
  stopThresholdDbfs: number
): AudSegRawRegion[] {
  const onsetSamples = millisecondsToSamples(
    detector.onsetMs,
    sampleRateHz,
    { minimum: 1 }
  );
  const releaseSamples = millisecondsToSamples(
    detector.releaseMs,
    sampleRateHz,
    { minimum: 1 }
  );
  let candidateStart: number | null = null;
  let activeStart: number | null = null;
  let lastActiveEnd: number | null = null;
  const regions: AudSegRawRegion[] = [];

  for (const frame of levels) {
    if (activeStart == null) {
      if (frame.dbfs >= startThresholdDbfs) {
        candidateStart ??= frame.startSample;
        if (frame.endSample - candidateStart >= onsetSamples) {
          activeStart = candidateStart;
          lastActiveEnd = frame.endSample;
          candidateStart = null;
        }
      } else {
        candidateStart = null;
      }
      continue;
    }

    if (frame.dbfs >= stopThresholdDbfs && frame.dbfs > DBFS_FLOOR) {
      lastActiveEnd = Math.max(lastActiveEnd ?? frame.endSample, frame.endSample);
      continue;
    }
    if (
      lastActiveEnd !== null
      && frame.endSample - lastActiveEnd >= releaseSamples
    ) {
      regions.push({
        startSample: activeStart,
        endSample: Math.min(lastActiveEnd, totalSamples),
        endReason: "silence"
      });
      activeStart = null;
      lastActiveEnd = null;
      candidateStart = null;
    }
  }

  if (activeStart != null && lastActiveEnd != null) {
    regions.push({
      startSample: activeStart,
      endSample: Math.min(lastActiveEnd, totalSamples),
      endReason: "eof"
    });
  }
  return regions;
}

function mergeRawRegions(
  regions: readonly AudSegRawRegion[],
  sampleRateHz: number,
  detector: AudSegDetectorConfig
): AudSegRawRegion[] {
  const mergeGap = millisecondsToSamples(
    detector.mergeGapMs,
    sampleRateHz
  );
  const minimum = millisecondsToSamples(
    detector.minRegionMs,
    sampleRateHz
  );
  const merged: AudSegRawRegion[] = [];
  for (const region of regions) {
    if (region.endSample - region.startSample < minimum) {
      continue;
    }
    const previous = merged.at(-1);
    if (previous && region.startSample - previous.endSample <= mergeGap) {
      previous.endSample = Math.max(previous.endSample, region.endSample);
      previous.endReason = region.endReason === "silence"
        ? "merged"
        : region.endReason;
    } else {
      merged.push({ ...region });
    }
  }
  return merged;
}

function levelStats(values: readonly number[]): {
  peakDbfs: number;
  meanDbfs: number;
} {
  if (values.length === 0) {
    return { peakDbfs: DBFS_FLOOR, meanDbfs: DBFS_FLOOR };
  }
  const meanPower = values.reduce(
    (total, value) => total + 10 ** (value / 10),
    0
  ) / values.length;
  return {
    peakDbfs: values.reduce(
      (peak, value) => Math.max(peak, value),
      DBFS_FLOOR
    ),
    meanDbfs: powerToDbfs(meanPower)
  };
}

function padRegions(
  regions: readonly AudSegRawRegion[],
  levels: readonly AudSegFrameLevel[],
  totalSamples: number,
  sampleRateHz: number,
  detector: AudSegDetectorConfig
): AudSegActivityRegion[] {
  const padStart = millisecondsToSamples(
    detector.padStartMs,
    sampleRateHz
  );
  const padEnd = millisecondsToSamples(
    detector.padEndMs,
    sampleRateHz
  );
  const padded = regions.map((region) => ({
    startSample: Math.max(0, region.startSample - padStart),
    endSample: Math.min(totalSamples, region.endSample + padEnd),
    rawStartSample: region.startSample,
    rawEndSample: region.endSample,
    endReason: region.endReason
  }));

  for (let index = 1; index < padded.length; index += 1) {
    const previous = padded[index - 1];
    const current = padded[index];
    if (previous.endSample <= current.startSample) {
      continue;
    }
    let midpoint = Math.floor(
      (previous.rawEndSample + current.rawStartSample) / 2
    );
    midpoint = Math.max(previous.startSample + 1, midpoint);
    midpoint = Math.min(current.endSample - 1, midpoint);
    previous.endSample = midpoint;
    current.startSample = midpoint;
  }

  let firstLevel = 0;
  return padded.flatMap((region) => {
    if (region.endSample <= region.startSample) {
      return [];
    }
    while (
      firstLevel < levels.length
      && levels[firstLevel].endSample <= region.startSample
    ) {
      firstLevel += 1;
    }
    let lastLevel = firstLevel;
    const values = [];
    while (
      lastLevel < levels.length
      && levels[lastLevel].startSample < region.endSample
    ) {
      values.push(levels[lastLevel].dbfs);
      lastLevel += 1;
    }
    return [{
      startSample: region.startSample,
      endSample: region.endSample,
      endReason: region.endReason,
      ...levelStats(values)
    }];
  });
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

interface AudSegSplitChoice {
  boundary: number;
  method: string;
}

function chooseSplit(
  levels: readonly AudSegFrameLevel[],
  starts: readonly number[],
  { lower, upper, ideal }: { lower: number; upper: number; ideal: number }
): AudSegSplitChoice {
  const hardBoundary = Math.min(Math.max(ideal, lower), upper);
  const first = lowerBound(starts, lower);
  const last = upperBound(starts, upper);
  const candidates = levels.slice(first, last);
  if (candidates.length === 0) {
    return { boundary: hardBoundary, method: "hard_limit" };
  }
  const quietest = candidates.reduce((best, frame) => (
    frame.dbfs < best.dbfs
    || (
      frame.dbfs === best.dbfs
      && Math.abs(frame.startSample - ideal)
        < Math.abs(best.startSample - ideal)
    )
      ? frame
      : best
  ));
  const medianLevel = median(candidates.map((frame) => frame.dbfs));
  return quietest.dbfs <= medianLevel - 3
    ? { boundary: quietest.startSample, method: "quiet_valley" }
    : { boundary: hardBoundary, method: "hard_limit" };
}

function splitRegion(
  region: AudSegActivityRegion,
  sourceRegion: number,
  levels: readonly AudSegFrameLevel[],
  levelStarts: readonly number[],
  sampleRateHz: number,
  cuePolicy: AudSegCuePolicy
): AudSegSegment[] {
  if (cuePolicy.maxDurationMs == null) {
    return [{
      startSample: region.startSample,
      endSample: region.endSample,
      sourceRegion,
      forcedSplit: false,
      splitMethod: null
    }];
  }
  const maximum = millisecondsToSamples(
    cuePolicy.maxDurationMs,
    sampleRateHz,
    { minimum: 1 }
  );
  if (region.endSample - region.startSample <= maximum) {
    return [{
      startSample: region.startSample,
      endSample: region.endSample,
      sourceRegion,
      forcedSplit: false,
      splitMethod: null
    }];
  }
  const minimum = millisecondsToSamples(
    cuePolicy.minSplitDurationMs,
    sampleRateHz,
    { minimum: 1 }
  );
  const search = millisecondsToSamples(
    cuePolicy.splitSearchMs,
    sampleRateHz
  );
  const boundaries: AudSegSplitChoice[] = [];
  let cursor = region.startSample;
  while (region.endSample - cursor > maximum) {
    const ideal = cursor + maximum;
    const lower = Math.max(cursor + minimum, ideal - search);
    const upper = Math.min(ideal, region.endSample - minimum);
    let selected;
    if (upper < lower) {
      selected = {
        boundary: Math.min(ideal, region.endSample - minimum),
        method: "hard_limit"
      };
    } else {
      selected = chooseSplit(levels, levelStarts, {
        lower,
        upper,
        ideal
      });
    }
    if (
      selected.boundary <= cursor
      || selected.boundary >= region.endSample
    ) {
      selected = {
        boundary: Math.min(
          cursor + maximum,
          region.endSample - minimum
        ),
        method: "hard_limit"
      };
    }
    boundaries.push(selected);
    cursor = selected.boundary;
  }
  const points = [
    region.startSample,
    ...boundaries.map(({ boundary }) => boundary),
    region.endSample
  ];
  return points.slice(0, -1).map((startSample, index) => ({
    startSample,
    endSample: points[index + 1],
    sourceRegion,
    forcedSplit: true,
    splitMethod: boundaries[
      Math.min(index, boundaries.length - 1)
    ].method
  }));
}

export function segmentAudSegPcm(
  samples: Float32Array,
  {
    sampleRateHz = AUDSEG_SAMPLE_RATE_HZ,
    config
  }: {
    sampleRateHz?: number;
    config?: typeof DEFAULT_AUDSEG_CONFIG;
  } = {}
): AudSegResult {
  if (config !== undefined && config !== DEFAULT_AUDSEG_CONFIG) {
    throw new Error(
      "KirinukiHelper의 AudSeg 설정은 재현 가능한 기본값으로 고정되어 있습니다."
    );
  }
  const appliedConfig = DEFAULT_AUDSEG_CONFIG;
  const { levels, totalSamples } = extractAudSegFrameLevels(
    samples,
    sampleRateHz,
    appliedConfig.detector
  );
  const analysis = thresholds(levels, appliedConfig.detector);
  const raw = rawRegions(
    levels,
    totalSamples,
    sampleRateHz,
    appliedConfig.detector,
    analysis.startThresholdDbfs,
    analysis.stopThresholdDbfs
  );
  const merged = mergeRawRegions(raw, sampleRateHz, appliedConfig.detector);
  const activityRegions = padRegions(
    merged,
    levels,
    totalSamples,
    sampleRateHz,
    appliedConfig.detector
  );
  const levelStarts = levels.map((frame) => frame.startSample);
  const segments = activityRegions.flatMap((region, sourceRegion) => (
    splitRegion(
      region,
      sourceRegion,
      levels,
      levelStarts,
      sampleRateHz,
      appliedConfig.cues
    )
  ));
  const activeSamples = activityRegions.reduce(
    (total, region) => total + region.endSample - region.startSample,
    0
  );
  const warnings: string[] = [];
  if (totalSamples === 0) {
    warnings.push("empty_audio");
  } else if (activityRegions.length === 0) {
    warnings.push("no_activity_detected");
  }
  if (totalSamples > 0 && activeSamples / totalSamples >= 0.95) {
    warnings.push("nearly_continuous_activity");
  }
  if (
    analysis.peakDbfs - analysis.effectiveNoiseDbfs < 6
    && analysis.peakDbfs > DBFS_FLOOR
  ) {
    warnings.push("low_level_contrast");
  }
  if (analysis.estimatedNoiseDbfs > analysis.effectiveNoiseDbfs) {
    warnings.push("noise_floor_capped");
  }
  return {
    schema: "kirinuki-audseg-browser-result/v1",
    engine: {
      id: AUDSEG_ENGINE_ID,
      version: AUDSEG_ENGINE_VERSION,
      modelFree: true,
      transcription: false,
      fingerprint: AUDSEG_PIPELINE_FINGERPRINT
    },
    sampleRateHz,
    totalSamples,
    ...analysis,
    activityRegions,
    segments,
    warnings
  };
}

export function segmentAudSegPcmInWorker(
  samples: Float32Array,
  {
    sampleRateHz = AUDSEG_SAMPLE_RATE_HZ,
    signal,
    workerFactory = () => new Worker(
      new URL("./audseg-worker.js", import.meta.url),
      { type: "module", name: "kirinuki-audseg" }
    )
  }: {
    sampleRateHz?: number;
    signal?: AbortSignal;
    workerFactory?: () => Worker;
  } = {}
): Promise<AudSegResult> {
  if (!(samples instanceof Float32Array)) {
    return Promise.reject(
      new TypeError("AudSeg에는 Float32 PCM 오디오가 필요합니다.")
    );
  }
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("작업이 취소되었습니다.", "AbortError")
    );
  }
  let worker: Worker;
  try {
    worker = workerFactory();
  } catch (error) {
    return Promise.reject(error);
  }
  const requestId = globalThis.crypto.randomUUID();
  return new Promise<AudSegResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      worker.terminate();
    };
    const finish = <T>(callback: (value: T) => void, value: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => {
      const abortReason = signal?.reason;
      finish(
        reject,
        abortReason instanceof Error
          ? abortReason
          : new DOMException("작업이 취소되었습니다.", "AbortError")
      );
    };
    const onMessage = (event: MessageEvent<{
      requestId?: string;
      ok?: boolean;
      result?: AudSegResult;
      error?: { name?: string; message?: string };
    }>) => {
      if (event.data?.requestId !== requestId) {
        return;
      }
      if (event.data?.ok) {
        if (!event.data.result) {
          finish(reject, new Error("AudSeg Worker 결과가 없습니다."));
          return;
        }
        finish(resolve, event.data.result);
        return;
      }
      const error = new Error(
        String(event.data?.error?.message || "AudSeg Worker 실행에 실패했습니다.")
      );
      error.name = String(event.data?.error?.name || "Error");
      finish(reject, error);
    };
    const onError = (event: ErrorEvent) => {
      finish(
        reject,
        new Error(
          String(event?.message || "AudSeg Worker를 불러오지 못했습니다.")
        )
      );
    };
    const onMessageError = () => {
      finish(
        reject,
        new Error("AudSeg Worker 응답을 복제하지 못했습니다.")
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    const transferable = (
      samples.byteOffset === 0
      && samples.byteLength === samples.buffer.byteLength
    )
      ? samples
      : samples.slice();
    try {
      worker.postMessage(
        {
          requestId,
          sampleRateHz,
          samples: transferable
        },
        [transferable.buffer]
      );
    } catch (error) {
      finish(reject, error);
    }
  });
}

export interface AudSegBlankSubtitleDraft {
  startOffsetMs: number;
  endOffsetMs: number;
  text: "";
  remoteMeta: {
    speakerId: "unknown";
    reviewRequired: true;
    placement: "bottom";
    qualityStatus: "review-required";
    qualityCodes: string[];
  };
}

export function audSegBlankSubtitleDrafts(
  result: AudSegResult
): AudSegBlankSubtitleDraft[] {
  if (result?.schema !== "kirinuki-audseg-browser-result/v1") {
    throw new Error("AudSeg 결과 스키마가 올바르지 않습니다.");
  }
  return result.segments.map((segment) => ({
    startOffsetMs: Math.round(
      segment.startSample * 1_000 / result.sampleRateHz
    ),
    endOffsetMs: Math.round(
      segment.endSample * 1_000 / result.sampleRateHz
    ),
    text: "",
    remoteMeta: {
      speakerId: "unknown",
      reviewRequired: true,
      placement: "bottom",
      qualityStatus: "review-required",
      qualityCodes: [
        "AUDSEG_BLANK_TIMING",
        `AUDSEG_RANGE_${segment.startSample}_${segment.endSample}`,
        ...(segment.forcedSplit
          ? [`AUDSEG_${String(segment.splitMethod || "hard_limit").toUpperCase()}`]
          : [])
      ]
    }
  }));
}
