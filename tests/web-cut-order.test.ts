import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { createEditorProjectFromCapture } from "../src/lib/editor-core.js";
import { translateUiCopy } from "../src/lib/ui-localization.js";
import { confirmedCutOrder, planCutMove } from "../src/web/cut-order.js";
import {
  sessionArchiveCaptureFromJson,
  sessionArchiveJsonFromCaptureState
} from "../src/web/session-archive-capture.js";
import { CUT_UI_COPY_CATALOG, CUT_UI_COPY_PATTERNS } from "../src/web/ui-copy.js";

test("cut moves reject boundaries, missing rows and ambiguous duplicate identities", () => {
  const first = {}, last = {};
  assert.equal(planCutMove([first, last], first, -1), null);
  assert.equal(planCutMove([first, last], last, 1), null);
  assert.equal(planCutMove([first], first, -1), null);
  assert.equal(planCutMove([first], first, 1), null);
  assert.equal(planCutMove([], first, 1), null);
  assert.equal(planCutMove([first, last], {}, -1), null);
  assert.equal(planCutMove([first, first, last], first, 1), null);
});

test("confirmed neighboring moves preserve exact raw values, identity and manual order", () => {
  const later = { id: "later", start: "00:31.125", end: "00:45.500", note: "  뒤 장면  ", finalized: true };
  const earlier = { id: "earlier", start: "00:02.001", end: "00:03.125", note: "앞 장면", finalized: true };
  const unfinished = { id: "draft", start: "invalid", end: "", note: "작성 중", finalized: false };
  const original = [later, earlier, unfinished];
  const before = structuredClone(original);
  const plan = planCutMove(original, unfinished, -1)!;
  const result = confirmedCutOrder(plan, original, true)!;
  assert.deepEqual(result.map((row) => row.id), ["later", "draft", "earlier"]);
  assert.strictEqual(result[0], later);
  assert.strictEqual(result[1], unfinished);
  assert.strictEqual(result[2], earlier);
  assert.deepEqual(original, before);
  assert.equal(confirmedCutOrder(plan, result, true), null, "a previous approval cannot move the new order again");
  const nextPlan = planCutMove(result, unfinished, 1)!;
  assert.deepEqual(confirmedCutOrder(nextPlan, result, true), original);
});

test("cancel and stale list changes leave every row untouched", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const order = [a, b, c];
  const plan = planCutMove(order, b, -1)!;
  assert.equal(confirmedCutOrder(plan, order, false), null);
  for (const changed of [[b, a, c], [a, b], [a, b, c, { id: "d" }], [a, { ...b }, c]]) {
    const before = [...changed];
    assert.equal(confirmedCutOrder(plan, changed, true), null);
    assert.deepEqual(changed, before);
  }
  assert.deepEqual(order, [a, b, c]);
});

test("approved manual order survives editor entry and session backup without sorting source times", async () => {
  const early = { id: "early", startSeconds: 2.001, endSeconds: 3.125, description: "앞 장면" };
  const late = { id: "late", startSeconds: 31.125, endSeconds: 45.5, description: "뒤 장면" };
  const initial = [early, late];
  const segments = confirmedCutOrder(planCutMove(initial, late, -1)!, initial, true)!;
  const capture = {
    source: {
      platform: "CHZZK", contentType: "vod", contentId: "14514980",
      canonicalUrl: "https://chzzk.naver.com/video/14514980",
      url: "https://chzzk.naver.com/video/14514980"
    },
    projectName: "수동 순서", segments
  };
  const project = createEditorProjectFromCapture(capture, { id: "ordered-cuts" });
  assert.deepEqual(project.clips.map((clip) => [clip.sourceStartMs, clip.sourceEndMs]), [
    [31_125, 45_500], [2_001, 3_125]
  ]);
  const imported = await sessionArchiveCaptureFromJson(await sessionArchiveJsonFromCaptureState(capture, {
    projectId: "ordered-backup", createdAt: "2026-11-12T00:00:00.000Z"
  }));
  assert.deepEqual(imported.segments, [
    { startSeconds: 31.125, endSeconds: 45.5, note: "뒤 장면" },
    { startSeconds: 2.001, endSeconds: 3.125, note: "앞 장면" }
  ]);
});

interface CutMoveHarness extends Record<string, unknown> {
  rows: { id: string; scrollIntoView?: () => void }[];
  sourceIdentity: string;
  busy: boolean;
  mutations: number;
  resets: number;
  cutReviewGeneration: number;
  pendingCutMove: unknown;
  elements: {
    cutReviewStatus: { textContent: string };
    cutReorderDialog: { open: boolean; close(): void };
    clipList: { insertBefore(item: object, next: object | null): void };
  };
  confirmCutMove(): void;
  resetCutReviewSession(): void;
}

async function pendingMoveHarness(): Promise<CutMoveHarness> {
  const source = await readFile(new URL("../src/web/main.ts", import.meta.url), "utf8");
  // Exercise the actual handlers with isolated DOM/controller boundaries. This
  // allows source/import races that a modal intentionally prevents users from
  // initiating with a pointer, without booting a media engine.
  const handlers = source.slice(source.indexOf("function closeCutReorderDialog("), source.indexOf("function undoDeletedCut("));
  const reset = source.slice(source.indexOf("function resetCutReviewSession("), source.indexOf("function cutReviewBusy("));
  const button = { disabled: false, isConnected: true, focus() {} };
  const a = { id: "a", scrollIntoView() {} }, b = { id: "b", scrollIntoView() {} };
  const rows = [a, b];
  const context: CutMoveHarness = {
    planCutMove, confirmedCutOrder,
    pendingCutMove: { plan: planCutMove(rows, b, -1), source: "source-a", generation: 4, button },
    cutReviewGeneration: 4, activeCutSeek: {}, lastCutReviewRenderKey: "old",
    activeClipRow: null, sourceIdentity: "source-a", busy: false, mutations: 0, resets: 0,
    rows, syncCutReviewAvailability() {}, updateClipRows() {},
    confirmCutMove() { throw new Error("Confirmation handler was not loaded"); },
    resetCutReviewSession() { throw new Error("Reset handler was not loaded"); },
    uiLocalization: { translate: (value: string) => value },
    deletedCutHistory: { clear() { context.resets += 1; } },
    elements: {
      cutReviewStatus: { textContent: "old" },
      cutReorderDialog: { open: true, close() { this.open = false; } },
      clipList: { insertBefore(item: object, next: object | null) {
        context.mutations += 1;
        rows.splice(rows.indexOf(item as typeof a), 1);
        rows.splice(next === null ? rows.length : rows.indexOf(next as typeof a), 0, item as typeof a);
      } }
    },
    clipRows: () => rows,
    cutReviewSource: () => context.sourceIdentity,
    cutReviewBusy: () => context.busy || context.pendingCutMove !== null
  };
  runInNewContext(transformSync(`${reset}\n${handlers}`, { loader: "ts", target: "es2022" }).code, context);
  return context;
}

test("actual confirmation rejects changed source, generation, busy state and row membership", async () => {
  for (const change of [
    (context: CutMoveHarness) => { context.sourceIdentity = "source-b"; },
    (context: CutMoveHarness) => { context.cutReviewGeneration += 1; },
    (context: CutMoveHarness) => { context.busy = true; },
    (context: CutMoveHarness) => { context.rows.push({ id: "new" }); }
  ]) {
    const context = await pendingMoveHarness();
    change(context);
    const before = [...context.rows];
    context.confirmCutMove();
    assert.equal(context.mutations, 0);
    assert.deepEqual(context.rows, before);
    assert.equal(context.pendingCutMove, null);
    assert.equal(context.elements.cutReorderDialog.open, false);
  }
});

test("source/import reset invalidates pending approval while an accepted approval moves only once", async () => {
  const reset = await pendingMoveHarness();
  reset.resetCutReviewSession();
  reset.confirmCutMove();
  assert.equal(reset.mutations, 0);
  assert.equal(reset.resets, 1);
  assert.equal(reset.cutReviewGeneration, 5);
  assert.equal(reset.pendingCutMove, null);
  assert.equal(reset.elements.cutReorderDialog.open, false);

  const accepted = await pendingMoveHarness();
  accepted.confirmCutMove();
  accepted.confirmCutMove();
  assert.equal(accepted.mutations, 1);
  assert.deepEqual(accepted.rows.map((row: { id: string }) => row.id), ["b", "a"]);
});

test("cut order controls have a labeled modal while source seek retains only its start action", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /data-action="seek-start"/u);
  assert.doesNotMatch(html, /data-action="seek-end"/u);
  for (const action of ["move-up", "move-down"]) {
    assert.ok(html.includes(`data-action="${action}"`));
  }
  assert.match(html, /id="cut-reorder-dialog"[^>]*aria-labelledby="cut-reorder-title"[^>]*aria-describedby="cut-reorder-summary cut-reorder-description"/u);
  assert.match(html, /id="cancel-cut-reorder"/u);
  assert.match(html, /id="confirm-cut-reorder"/u);
});

test("cut move dialog, position announcements and accessible labels are localized", () => {
  for (const language of ["en", "ja"] as const) {
    for (const text of [
      "위로", "아래로", "구간 순서를 바꿀까요?", "순서 바꾸기",
      "시작·끝 시각과 메모는 그대로 두고 재생 순서만 바꿉니다.",
      "구간 목록이나 원본이 바뀌어 순서를 바꾸지 않았습니다. 다시 선택해 주세요.",
      "12번 구간을 11번째로 옮길까요?", "12번 구간을 11번째로 옮겼습니다.",
      "12번 구간을 한 칸 위로 이동", "12번 구간을 한 칸 아래로 이동"
    ]) {
      const translated = translateUiCopy(text, language, CUT_UI_COPY_CATALOG, CUT_UI_COPY_PATTERNS);
      assert.doesNotMatch(translated, /[가-힣]/u, `${language}: ${text}`);
      for (const number of text.match(/[0-9]+/gu) ?? []) assert.ok(translated.includes(number));
    }
  }
});
