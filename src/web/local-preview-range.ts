export const LOCAL_PREVIEW_LEAD_SECONDS = 30;
export const LOCAL_PREVIEW_TRAIL_SECONDS = 90;
export const MINIMUM_LOCAL_PREVIEW_SECONDS = 0.1;

export interface LocalPreviewRangePlan {
  readonly targetSeconds: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface LocalPreviewWindowMapping {
  readonly fetchedSourceStartMs: number;
  readonly fetchedSourceEndMs: number;
  readonly mediaStartMs: number;
  readonly mediaEndMs: number;
}

function finiteNonNegative(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new TypeError(`${label}은 0 이상의 유한한 숫자여야 합니다.`);
  }
  return normalized;
}

export function planLocalPreviewRange(
  durationValue: unknown,
  targetValue: unknown
): LocalPreviewRangePlan {
  const durationSeconds = finiteNonNegative(durationValue, "VOD 길이");
  const requestedTarget = finiteNonNegative(targetValue, "미리보기 위치");
  if (durationSeconds < MINIMUM_LOCAL_PREVIEW_SECONDS) {
    throw new TypeError("0.1초보다 짧은 VOD는 미리보기를 준비할 수 없습니다.");
  }
  const targetSeconds = Math.min(durationSeconds, requestedTarget);
  const startSeconds = Math.max(
    0,
    Math.min(
      targetSeconds - LOCAL_PREVIEW_LEAD_SECONDS,
      durationSeconds - MINIMUM_LOCAL_PREVIEW_SECONDS
    )
  );
  const endSeconds = Math.min(
    durationSeconds,
    Math.max(
      startSeconds + MINIMUM_LOCAL_PREVIEW_SECONDS,
      targetSeconds + LOCAL_PREVIEW_TRAIL_SECONDS
    )
  );
  const startMs = Math.round(startSeconds * 1_000);
  const endMs = Math.round(endSeconds * 1_000);
  if (
    !Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(endMs)
    || endMs <= startMs
  ) {
    throw new TypeError("미리보기 범위를 안전한 원본 시각으로 바꾸지 못했습니다.");
  }
  return Object.freeze({
    targetSeconds,
    startSeconds: startMs / 1_000,
    endSeconds: endMs / 1_000,
    startMs,
    endMs
  });
}

export function localPreviewSourceAtMediaZero(
  mapping: LocalPreviewWindowMapping
): number {
  const fetchedSourceStartMs = finiteNonNegative(
    mapping.fetchedSourceStartMs,
    "미리보기 원본 시작"
  );
  const fetchedSourceEndMs = finiteNonNegative(
    mapping.fetchedSourceEndMs,
    "미리보기 원본 끝"
  );
  const mediaStartMs = finiteNonNegative(
    mapping.mediaStartMs,
    "미리보기 파일 시작"
  );
  const mediaEndMs = finiteNonNegative(
    mapping.mediaEndMs,
    "미리보기 파일 끝"
  );
  if (
    fetchedSourceEndMs <= fetchedSourceStartMs
    || mediaEndMs <= mediaStartMs
  ) {
    throw new TypeError("미리보기 원본 시계 매핑이 올바르지 않습니다.");
  }
  return (fetchedSourceStartMs - mediaStartMs) / 1_000;
}

export function localPreviewSourceSeconds(
  sourceAtMediaZeroValue: unknown,
  mediaSecondsValue: unknown
): number {
  const sourceAtMediaZero = Number(sourceAtMediaZeroValue);
  const mediaSeconds = finiteNonNegative(mediaSecondsValue, "미리보기 재생 시각");
  if (!Number.isFinite(sourceAtMediaZero)) {
    throw new TypeError("미리보기 원본 기준 시각이 유한하지 않습니다.");
  }
  return sourceAtMediaZero + mediaSeconds;
}

export function localPreviewMediaSeconds(
  sourceAtMediaZeroValue: unknown,
  sourceSecondsValue: unknown
): number {
  const sourceAtMediaZero = Number(sourceAtMediaZeroValue);
  const sourceSeconds = finiteNonNegative(sourceSecondsValue, "원본 이동 시각");
  if (!Number.isFinite(sourceAtMediaZero)) {
    throw new TypeError("미리보기 원본 기준 시각이 유한하지 않습니다.");
  }
  return sourceSeconds - sourceAtMediaZero;
}
