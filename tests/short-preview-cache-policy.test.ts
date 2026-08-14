import assert from "node:assert/strict";
import test from "node:test";

import {
  initialShortPreviewCacheCoverage,
  nextShortPreviewCacheCoverage,
  shortPreviewCacheCoverageContainsRange,
  shortPreviewCacheCoverageContainsTime
} from "../src/editor/short-preview-cache-policy.js";
import type { ShortFormVideoAsset } from "../src/lib/short-form.js";

function asset(
  sourceStartMs: number,
  sourceEndMs: number
): ShortFormVideoAsset {
  return {
    id: "short-a",
    sourceAssetId: "project-primary",
    sourceClipId: "clip-a",
    sourceSelectionStartMs: 10_000,
    sourceSelectionEndMs: 40_000,
    sourceStartMs,
    sourceEndMs,
    timelineStartMs: 0,
    timelineEndMs: sourceEndMs - sourceStartMs,
    sourceRect: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      referenceWidth: 1_920,
      referenceHeight: 1_080
    },
    destinationRect: { x: 0, y: 0, width: 1_080, height: 1_920 },
    opacity: 1,
    visible: true,
    zIndex: 0,
    lane: 0,
    audioGain: 1
  };
}

test("쇼츠 미리보기의 첫 캐시는 선택 envelope가 아니라 활성 구간만 쓴다", () => {
  assert.deepEqual(initialShortPreviewCacheCoverage(asset(20_000, 23_000)), {
    sourceStartMs: 20_000,
    sourceEndMs: 23_000
  });
});

test("캐시 범위와 재생 시각은 half-open containment를 사용한다", () => {
  const coverage = { sourceStartMs: 20_000, sourceEndMs: 23_000 };
  assert.equal(
    shortPreviewCacheCoverageContainsRange(coverage, asset(20_500, 22_500)),
    true
  );
  assert.equal(
    shortPreviewCacheCoverageContainsRange(coverage, asset(19_999, 22_500)),
    false
  );
  assert.equal(shortPreviewCacheCoverageContainsTime(coverage, 20_000), true);
  assert.equal(shortPreviewCacheCoverageContainsTime(coverage, 22_999), true);
  assert.equal(shortPreviewCacheCoverageContainsTime(coverage, 23_000), false);
});

test("겹친 trim은 선택 범위 안에서 기하급수로 넓히고 disjoint trim은 교체한다", () => {
  assert.deepEqual(
    nextShortPreviewCacheCoverage(
      asset(19_000, 23_000),
      { sourceStartMs: 20_000, sourceEndMs: 23_000 }
    ),
    { sourceStartMs: 15_000, sourceEndMs: 23_000 }
  );
  assert.deepEqual(
    nextShortPreviewCacheCoverage(
      asset(30_000, 32_000),
      { sourceStartMs: 20_000, sourceEndMs: 23_000 }
    ),
    { sourceStartMs: 30_000, sourceEndMs: 32_000 }
  );
  assert.deepEqual(
    nextShortPreviewCacheCoverage(
      asset(23_000, 25_000),
      { sourceStartMs: 20_000, sourceEndMs: 23_000 }
    ),
    { sourceStartMs: 23_000, sourceEndMs: 25_000 }
  );
});
