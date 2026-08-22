import assert from "node:assert/strict";
import test from "node:test";

import {
  localPreviewMediaSeconds,
  localPreviewSourceAtMediaZero,
  localPreviewSourceSeconds,
  planLocalPreviewRange
} from "../src/web/local-preview-range.js";

test("긴 VOD는 요청 지점 앞 30초와 뒤 90초만 준비한다", () => {
  assert.deepEqual(planLocalPreviewRange(3_600, 600), {
    targetSeconds: 600,
    startSeconds: 570,
    endSeconds: 690,
    startMs: 570_000,
    endMs: 690_000
  });
});

test("시작·끝과 짧은 VOD에서도 전체 파일을 넘지 않는 half-open 범위를 만든다", () => {
  assert.deepEqual(planLocalPreviewRange(50, 0), {
    targetSeconds: 0,
    startSeconds: 0,
    endSeconds: 50,
    startMs: 0,
    endMs: 50_000
  });
  assert.deepEqual(planLocalPreviewRange(200, 999), {
    targetSeconds: 200,
    startSeconds: 170,
    endSeconds: 200,
    startMs: 170_000,
    endMs: 200_000
  });
  assert.throws(() => planLocalPreviewRange(0.09, 0), /0\.1초보다 짧/u);
});

test("로컬 파일 offset을 원본 source clock으로 왕복한다", () => {
  const sourceAtMediaZero = localPreviewSourceAtMediaZero({
    fetchedSourceStartMs: 570_000,
    fetchedSourceEndMs: 690_000,
    mediaStartMs: 4_000,
    mediaEndMs: 124_000
  });
  assert.equal(sourceAtMediaZero, 566);
  assert.equal(localPreviewSourceSeconds(sourceAtMediaZero, 34), 600);
  assert.equal(localPreviewMediaSeconds(sourceAtMediaZero, 600), 34);
});

test("NaN·음수·역순 시계 매핑은 사용자 컷 좌표로 승격하지 않는다", () => {
  assert.throws(() => planLocalPreviewRange(Number.NaN, 0), /유한한 숫자/u);
  assert.throws(() => planLocalPreviewRange(10, -1), /유한한 숫자/u);
  assert.throws(() => localPreviewSourceAtMediaZero({
    fetchedSourceStartMs: 10,
    fetchedSourceEndMs: 10,
    mediaStartMs: 0,
    mediaEndMs: 1
  }), /매핑이 올바르지/u);
});
