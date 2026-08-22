import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const destructiveTeardownCalls = [
  "clearLocalMediaEngineSessionState()",
  "invalidatePrimedLocalMediaEngineTrust()",
  "invalidateShortPreviewCacheOperation()",
  "clearUsagePolicyExpiryTimer()",
  "stopDevReloadObserver()",
  "stopLocalDraftAutosave()",
  "stopShortCanvasPlayback()",
  "stopPreviewPlaybackClock()",
  "stopPreviewAudioClock({ sync: false })",
  "cancelPreviewPreload({ clearSource: true })",
  "releaseShortPreviewLayerVideos()",
  "releaseShortPreviewSourceAudio()",
  "URL.revokeObjectURL(mediaUrl)",
  "releaseAllImageAssetObjectUrls()",
  "cancelScheduledShortWorkspacePreview()",
  "releaseShortPreviewAdaptiveScaler()",
  "releaseShortPreviewFallbackSurface()",
  "cancelActiveJob()"
] as const;

test("취소될 수 있는 beforeunload는 편집 작업을 해체하지 않고 실제 pagehide만 해체한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const beforeUnloadStart = source.indexOf(
    'window.addEventListener("beforeunload"'
  );
  const pageHideStart = source.indexOf(
    'window.addEventListener("pagehide"'
  );
  const visibilityChangeStart = source.indexOf(
    'document.addEventListener("visibilitychange"',
    pageHideStart
  );

  assert.equal(
    source.match(/window\.addEventListener\("beforeunload"/gu)?.length,
    1,
    "beforeunload 정리 경계는 하나여야 합니다."
  );
  assert.equal(
    source.match(/window\.addEventListener\("pagehide"/gu)?.length,
    1,
    "pagehide 정리 경계는 하나여야 합니다."
  );
  assert.notEqual(pageHideStart, -1, "pagehide 수명주기 경계를 찾지 못했습니다.");
  assert.notEqual(
    visibilityChangeStart,
    -1,
    "pagehide 수명주기 끝 경계를 찾지 못했습니다."
  );
  const beforeUnload = beforeUnloadStart === -1
    ? ""
    : source.slice(beforeUnloadStart, pageHideStart);
  const pageHide = source.slice(pageHideStart, visibilityChangeStart);
  const bfcacheReturn = pageHide.indexOf("if (event.persisted)");
  const fullTeardown = pageHide.indexOf("clearLocalMediaEngineSessionState()");

  assert.ok(
    bfcacheReturn >= 0 && fullTeardown > bfcacheReturn,
    "BFCache에 남은 편집기는 미디어를 폐기하기 전에 빠져나가야 합니다."
  );

  // Chromium can fire beforeunload even when the document remains alive, but
  // pagehide identifies the real document-exit boundary.
  for (const call of destructiveTeardownCalls) {
    assert.doesNotMatch(
      beforeUnload,
      new RegExp(call.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `취소될 수 있는 beforeunload에서 ${call}을 실행하면 안 됩니다.`
    );
    assert.match(
      pageHide,
      new RegExp(call.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `실제 문서 이탈인 pagehide에서 ${call}을 실행해야 합니다.`
    );
  }
});
