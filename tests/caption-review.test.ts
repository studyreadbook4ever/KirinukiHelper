import assert from "node:assert/strict";
import test from "node:test";

import {
  createCaptionReviewList,
  nextCaptionNeedingReview
} from "../src/lib/caption-review.js";
import {
  createEditorProjectFromCapture,
  createSubtitleCue,
  serializeSrt
} from "../src/lib/editor-core.js";
import type { EditorProject, EditorSubtitleCue } from "../src/lib/editor-core.js";
import { EDITOR_STATIC_UI_COPY } from "../src/editor/ui-copy-static.js";
import { EDITOR_RUNTIME_UI_COPY_PATTERNS } from "../src/editor/ui-copy-runtime.js";
import { translateUiCopy } from "../src/lib/ui-localization.js";

function fixture(): EditorProject {
  const project = createEditorProjectFromCapture({
    projectName: "Caption review",
    source: {
      platform: "YOUTUBE",
      contentType: "vod",
      contentId: "abcdefghijk",
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk"
    },
    segments: [
      { id: "first", startSeconds: 10, endSeconds: 20 },
      { id: "second", startSeconds: 30, endSeconds: 40 }
    ]
  });
  const clip = project.clips[0];
  const disabledClip = project.clips[1];
  assert.ok(clip && disabledClip);
  const clipId = clip.id;
  disabledClip.enabled = false;
  function cue(id: string, timeMs: number, overrides: Partial<EditorSubtitleCue> = {}) {
    return {
      ...createSubtitleCue(project, {
        clipId,
        startOffsetMs: timeMs,
        endOffsetMs: timeMs + 500,
        text: id,
        lane: 0
      }),
      id,
      ...overrides
    };
  }
  project.subtitles = [
    cue("later", 5_000, { origin: "ai", humanEdited: false, lane: 1, remoteMeta: { reviewRequired: true } }),
    cue("human", 0, { text: "안녕 HELLO [.*] <b>  세상\n노래" }),
    cue("blank", 1_000, { text: " \n\t", origin: "ai", humanEdited: true, remoteMeta: { reviewRequired: true, qualityCodes: ["AUDSEG_BLANK_TIMING"] } }),
    cue("same-time", 1_000, { origin: "ai", humanEdited: false, lane: 1, remoteMeta: { reviewRequired: true } }),
    cue("reviewed", 3_000, { origin: "ai", humanEdited: true, remoteMeta: { reviewRequired: true } }),
    cue("manual-blank", 4_000, { text: "" }),
    cue("disabled", 6_000, { clipId: disabledClip.id, origin: "ai", humanEdited: false, remoteMeta: { reviewRequired: true } }),
    cue("orphan", 7_000, { clipId: "missing" })
  ];
  return project;
}

test("caption review includes active cues only, keeps stable time order, and counts blanks independently", () => {
  const project = fixture();
  const all = createCaptionReviewList(project);
  assert.deepEqual(all.entries.map(({ cue }) => cue.id), [
    "human", "blank", "same-time", "reviewed", "manual-blank", "later"
  ]);
  assert.equal(all.reviewCount, 3);
  assert.equal(all.blankCount, 2);
  assert.deepEqual(
    createCaptionReviewList(project, { filter: "review" }).matchingEntries.map(({ cue }) => cue.id),
    ["blank", "same-time", "later"]
  );
  assert.deepEqual(
    createCaptionReviewList(project, { filter: "blank" }).matchingEntries.map(({ cue }) => cue.id),
    ["blank", "manual-blank"]
  );
});

test("caption search is a literal Unicode-normalized substring and combines with review filters", () => {
  const project = fixture();
  for (const query of ["hello", "ＨＥＬＬＯ", "[.*]", "<b>", "세상 노래", "안녕".normalize("NFD")]) {
    const view = createCaptionReviewList(project, { query });
    assert.deepEqual(view.matchingEntries.map(({ cue }) => cue.id), ["human"], query);
    assert.equal(view.entries.length, 6);
    assert.equal(view.reviewCount, 3);
  }
  assert.equal(createCaptionReviewList(project, { query: "^.*$" }).matchingEntries.length, 0);
  assert.equal(createCaptionReviewList(project, { query: "hello", filter: "review" }).matchingEntries.length, 0);
  assert.deepEqual(
    createCaptionReviewList(project, { query: "LATER", filter: "review" }).matchingEntries.map(({ cue }) => cue.id),
    ["later"]
  );
  assert.equal(createCaptionReviewList(project, { query: " \n " }).matchingEntries.length, 6);
});

test("review navigation crosses lanes, includes simultaneous cues, wraps, and uses the playhead without selection", () => {
  const view = createCaptionReviewList(fixture(), { query: "human", filter: "blank" });
  assert.equal(view.matchingEntries.length, 0);
  for (const [selected, expected] of [
    ["human", "blank"], ["blank", "same-time"], ["same-time", "later"],
    ["reviewed", "later"], ["later", "blank"]
  ]) {
    assert.equal(nextCaptionNeedingReview(view.entries, selected, 0)?.id, expected);
  }
  assert.equal(nextCaptionNeedingReview(view.entries, null, 2_000)?.id, "later");
  assert.equal(nextCaptionNeedingReview(view.entries, "deleted", 9_000)?.id, "blank");
  const only = view.entries.filter(({ cue }) => cue.id === "blank");
  assert.equal(nextCaptionNeedingReview(only, "blank", 0)?.id, "blank");
  assert.equal(nextCaptionNeedingReview([], null, 0), null);
  assert.equal(nextCaptionNeedingReview(view.entries.filter((entry) => !entry.needsReview), "human", 0), null);
});

test("search and navigation preserve every cue, source boundary, selection, and serialized SRT", () => {
  const project = fixture();
  project.selectedCueId = "reviewed";
  project.playheadMs = 3_500;
  const before = JSON.stringify(project);
  const srt = serializeSrt(project);
  for (const cue of project.subtitles) {
    Object.freeze(cue.remoteMeta);
    Object.freeze(cue);
  }
  Object.freeze(project.subtitles);
  Object.freeze(project.clips);
  Object.freeze(project);
  for (const filter of ["all", "review", "blank"] as const) {
    const view = createCaptionReviewList(project, { query: "LATER", filter });
    nextCaptionNeedingReview(view.entries, project.selectedCueId, project.playheadMs);
  }
  assert.equal(JSON.stringify(project), before);
  assert.equal(serializeSrt(project), srt);
});

test("caption search counts and empty states retain Korean, English, and Japanese UI coverage", () => {
  const copy = [
    "검수 필요 3개", "표시 1 / 활성 자막 6 · 빈 자막 2",
    "조건에 맞는 자막이 없습니다. 검색어나 보기 조건을 바꿔 주세요."
  ];
  for (const source of copy) {
    assert.equal(translateUiCopy(source, "ko", EDITOR_STATIC_UI_COPY, EDITOR_RUNTIME_UI_COPY_PATTERNS), source);
    for (const language of ["en", "ja"] as const) {
      assert.doesNotMatch(
        translateUiCopy(source, language, EDITOR_STATIC_UI_COPY, EDITOR_RUNTIME_UI_COPY_PATTERNS),
        /[가-힣]/u
      );
    }
  }
});
