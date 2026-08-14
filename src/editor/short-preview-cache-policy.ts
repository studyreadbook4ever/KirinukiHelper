import type {
  ShortFormSourceAudioAsset,
  ShortFormVideoAsset
} from "../lib/short-form.js";

export type ShortPreviewSourceAsset =
  | ShortFormVideoAsset
  | ShortFormSourceAudioAsset;

export interface ShortPreviewCacheCoverage {
  sourceStartMs: number;
  sourceEndMs: number;
}

const MINIMUM_GROWTH_MS = 1_000;

function finiteTime(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${label}이(가) 올바르지 않습니다.`);
  }
  return Math.round(parsed);
}

function normalizedCoverage(
  value: ShortPreviewCacheCoverage
): ShortPreviewCacheCoverage {
  const sourceStartMs = finiteTime(value.sourceStartMs, "캐시 시작 시각");
  const sourceEndMs = finiteTime(value.sourceEndMs, "캐시 종료 시각");
  if (sourceEndMs <= sourceStartMs) {
    throw new RangeError("캐시 종료 시각은 시작 시각보다 뒤여야 합니다.");
  }
  return { sourceStartMs, sourceEndMs };
}

function activeCoverage(
  asset: ShortPreviewSourceAsset
): ShortPreviewCacheCoverage {
  return normalizedCoverage({
    sourceStartMs: asset.sourceStartMs,
    sourceEndMs: asset.sourceEndMs
  });
}

/**
 * The project keeps the immutable selection envelope. Preview cache coverage is
 * deliberately derived from the range that is active now, so a five-second
 * shorts layer never turns into a multi-minute cache merely because it may be
 * expanded later.
 */
export function initialShortPreviewCacheCoverage(
  asset: ShortPreviewSourceAsset
): ShortPreviewCacheCoverage {
  return activeCoverage(asset);
}

export function shortPreviewCacheCoverageContainsRange(
  coverage: ShortPreviewCacheCoverage,
  range: Pick<ShortPreviewSourceAsset, "sourceStartMs" | "sourceEndMs">
): boolean {
  const normalized = normalizedCoverage(coverage);
  const active = normalizedCoverage(range);
  return normalized.sourceStartMs <= active.sourceStartMs
    && normalized.sourceEndMs >= active.sourceEndMs;
}

/** Source samples use half-open ranges: the exact end belongs to no layer. */
export function shortPreviewCacheCoverageContainsTime(
  coverage: ShortPreviewCacheCoverage,
  sourceTimeMs: unknown
): boolean {
  const normalized = normalizedCoverage(coverage);
  const timeMs = Number(sourceTimeMs);
  return Number.isFinite(timeMs)
    && timeMs >= normalized.sourceStartMs
    && timeMs < normalized.sourceEndMs;
}

/**
 * Grow an overlapping cache geometrically after a committed trim. This keeps
 * repeated edge drags logarithmic without pre-rendering the whole selection
 * envelope. A disjoint request replaces the old window instead of encoding a
 * large unused gap.
 */
export function nextShortPreviewCacheCoverage(
  asset: ShortPreviewSourceAsset,
  current: ShortPreviewCacheCoverage | null
): ShortPreviewCacheCoverage {
  const active = activeCoverage(asset);
  if (!current) {
    return active;
  }
  const previous = normalizedCoverage(current);
  if (shortPreviewCacheCoverageContainsRange(previous, active)) {
    return previous;
  }
  if (
    active.sourceEndMs <= previous.sourceStartMs
    || active.sourceStartMs >= previous.sourceEndMs
  ) {
    return active;
  }

  const envelopeStartMs = finiteTime(
    asset.sourceSelectionStartMs,
    "원본 선택 시작 시각"
  );
  const envelopeEndMs = finiteTime(
    asset.sourceSelectionEndMs,
    "원본 선택 종료 시각"
  );
  if (envelopeEndMs <= envelopeStartMs) {
    throw new RangeError("원본 선택 종료 시각은 시작 시각보다 뒤여야 합니다.");
  }
  const growthMs = Math.max(
    MINIMUM_GROWTH_MS,
    previous.sourceEndMs - previous.sourceStartMs,
    active.sourceEndMs - active.sourceStartMs
  );
  return {
    sourceStartMs: Math.max(
      envelopeStartMs,
      Math.min(previous.sourceStartMs, active.sourceStartMs) - (
        active.sourceStartMs < previous.sourceStartMs ? growthMs : 0
      )
    ),
    sourceEndMs: Math.min(
      envelopeEndMs,
      Math.max(previous.sourceEndMs, active.sourceEndMs) + (
        active.sourceEndMs > previous.sourceEndMs ? growthMs : 0
      )
    )
  };
}
