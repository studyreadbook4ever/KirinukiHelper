import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DeletedCutHistory,
  MAX_DELETED_CUT_HISTORY,
  studioCutReview
} from "../src/web/cut-review.js";
import { translateUiCopy } from "../src/lib/ui-localization.js";
import { CUT_UI_COPY_CATALOG, CUT_UI_COPY_PATTERNS } from "../src/web/ui-copy.js";

test("deletion undo preserves exact identity, incomplete input, notes and original order", () => {
  const first = { id: "a", start: "01:20.500", end: "01:35", note: "첫 메모" };
  const middle = { id: "b", start: "invalid", end: "", note: "아직 작성 중" };
  const last = { id: "c", start: "", end: "", note: "" };
  const rows = [first, middle, last];
  const history = new DeletedCutHistory<typeof first>();
  const remove = (index: number): void => {
    history.push("source-a", rows[index]!, index);
    rows.splice(index, 1);
  };
  remove(1);
  remove(0);
  rows.push({ id: "d", start: "02:00", end: "02:10", note: "새 구간" });
  for (const expected of [first, middle]) {
    const restored = history.pop("source-a");
    assert.ok(restored);
    assert.strictEqual(restored.item, expected);
    rows.splice(restored.index, 0, restored.item);
  }
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d"]);
  assert.equal(rows[1]?.start, "invalid");
  assert.equal(rows[1]?.note, "아직 작성 중");
  assert.equal(history.pop("source-a"), null);
});

test("deletion history is bounded and never crosses source changes or imports", () => {
  const history = new DeletedCutHistory<number>();
  for (let index = 0; index < MAX_DELETED_CUT_HISTORY + 3; index += 1) {
    history.push("source-a", index, index);
  }
  assert.equal(history.count("source-a"), 30);
  for (let index = 32; index >= 3; index -= 1) {
    assert.equal(history.pop("source-a")?.item, index);
  }
  assert.equal(history.pop("source-a"), null);
  history.push("source-a", 1, 0);
  assert.equal(history.count("source-b"), 0);
  assert.equal(history.pop("source-a"), null, "A→B→A must not resurrect old cuts");
  history.push("source-a", 2, 0);
  history.clear();
  assert.equal(history.pop("source-a"), null, "importing the same source also clears history");
  history.push("", 3, 0);
  assert.equal(history.pop("")?.item, 3, "manual drafts can be restored before URL entry");
  assert.throws(() => history.push("source-a", 4, -1));
});

test("cut review rejects blank, malformed, incomplete, reversed and subminimum ranges", () => {
  for (const [start, end] of [
    ["", ""], ["", "00:01"], ["garbage", "00:02"], ["00:60", "01:10"],
    ["00:02", "00:01"], ["00:02", "00:02"], ["00:01", "00:01.099"]
  ]) {
    assert.deepEqual(studioCutReview(start!, end!, 60), {
      durationSeconds: null, startTarget: null, endTarget: null
    });
  }
});

test("cut review shows exact millisecond duration without acquisition handles", () => {
  assert.deepEqual(studioCutReview("00:01:20.500", "00:01:35", 120), {
    durationSeconds: 14.5, startTarget: 80.5, endTarget: 95
  });
  assert.deepEqual(studioCutReview("00:00:00.001", "00:00:00.101", 120), {
    durationSeconds: 0.1, startTarget: 0.001, endTarget: 0.101
  });
});

test("seek targets require a ready source clock and never clamp saved cut boundaries", () => {
  for (const unavailable of [null, 0, -1, Infinity, NaN]) {
    assert.deepEqual(studioCutReview("00:00", "00:10", unavailable), {
      durationSeconds: 10, startTarget: null, endTarget: null
    });
  }
  assert.deepEqual(studioCutReview("00:09", "00:11", 10), {
    durationSeconds: 2, startTarget: 9, endTarget: null
  });
  assert.deepEqual(studioCutReview("00:00", "00:10", 10), {
    durationSeconds: 10, startTarget: 0, endTarget: 10
  });
});

test("cut review controls retain source, busy and asynchronous response guards", async () => {
  const source = await readFile(new URL("../src/web/main.ts", import.meta.url), "utf8");
  assert.match(source, /return openingEditor \|\| Boolean\(resumeProject\) \|\| activeCutSeek !== null\s*\|\| localPreviewBusy/u);
  assert.match(source, /elements\.sourceUrl\.addEventListener\("input", \(\) => \{\s*resetCutReviewSession\(\)/u);
  assert.match(source, /resetCutReviewSession\(\);\s*clearResumeMode\(\);\s*elements\.sourceUrl\.value = imported\.sourceUrl/u);
  const seek = source.slice(source.indexOf("async function seekToClipBoundary"), source.indexOf("async function seekPlayerBy"));
  assert.match(seek, /generation === cutReviewGeneration && cutReviewSource\(\) === source/u);
  assert.match(seek, /if \(isCurrent\(\) && vod === localVodPlayback\)/u);
  assert.match(seek, /if \(activeCutSeek === operation\)/u);
  assert.doesNotMatch(seek, /\.value\s*=|startSeconds\s*=|endSeconds\s*=/u);
});

test("cut review controls and announcements are localized without altering timestamps", () => {
  for (const language of ["en", "ja"] as const) {
    for (const text of [
      "삭제 되돌리기", "시작으로 이동", "끝으로 이동", "길이 --:--", "길이 00:00:14.500",
      "최근 삭제한 구간 30개까지 이 탭에서 되돌릴 수 있습니다. 원본을 바꾸면 기록이 지워집니다.",
      "원본 플레이어가 준비되면 이 시각으로 이동합니다.",
      "먼저 올바른 시작과 끝 시각을 기록하세요.",
      "원본 길이 안의 시각으로 이동할 수 있습니다.",
      "입력한 구간을 바꾸지 않고 원본 영상만 이동합니다.",
      "삭제한 구간을 원래 위치로 되돌렸습니다.",
      "구간을 삭제했습니다. ‘삭제 되돌리기’로 복구할 수 있습니다.",
      "원본 영상을 00:01:20.500로 이동했습니다.",
      "원본 플레이어에 00:01:20.500 이동을 요청했습니다.",
      "구간 위치로 이동하지 못했습니다: TimeoutError"
    ]) {
      const translated = translateUiCopy(text, language, CUT_UI_COPY_CATALOG, CUT_UI_COPY_PATTERNS);
      assert.doesNotMatch(translated, /[가-힣]/u, `${language}: ${text}`);
      for (const timecode of text.match(/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}/gu) ?? []) {
        assert.ok(translated.includes(timecode));
      }
    }
  }
});
