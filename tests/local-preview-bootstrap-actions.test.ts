import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function sourceSection(
  source: string,
  startMarker: string,
  endMarker: string
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `시작 marker를 찾지 못했습니다: ${startMarker}`);
  assert(end > start, `끝 marker를 찾지 못했습니다: ${endMarker}`);
  return source.slice(start, end);
}

test("E/R은 저장된 추정 시각이 아니라 플레이어의 fresh snapshot을 기록한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const capture = sourceSection(
    source,
    "async function captureCurrentPlayerTime",
    "function finalizeCurrentDraftRow"
  );
  assert.match(
    capture,
    /const client = streamingBridgeClient[\s\S]*await runTransientSafeStreamingAction\([\s\S]*client\.snapshot\(\)[\s\S]*latestStreamingSnapshot\.currentTime/u
  );
  assert.match(capture, /writeCapturedPlayerTime\(field, currentTime\)/u);
  assert.doesNotMatch(
    capture,
    /SOURCE_PLATFORM_YOUTUBE|currentYouTubePlayerTime|localPreview|materialization|setInterval|Date\.now/iu,
    "플랫폼별 추정 시계나 제거된 YouTube 직접 API로 우회해서는 안 됩니다."
  );
});

test("D/F/Y/U는 정확한 상대 탐색·배속 값을 streaming player 명령에 전달한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const actions = sourceSection(
    source,
    "async function runQueuedSourceClockAction",
    "function queueSourceClockAction"
  );
  assert.match(
    actions,
    /case "player-seek-backward-five":[\s\S]*await seekPlayerBy\(-5\)/u
  );
  assert.match(
    actions,
    /case "player-seek-forward-five":[\s\S]*await seekPlayerBy\(5\)/u
  );
  assert.match(
    actions,
    /case "player-rate-quarter":[\s\S]*await setPlayerRate\(0\.25\)/u
  );
  assert.match(
    actions,
    /case "player-rate-double":[\s\S]*await setPlayerRate\(2\)/u
  );
});

test("E/R/D/F/Y/U는 source generation에 묶인 단일 직렬 큐를 통과한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const queue = sourceSection(
    source,
    "function queueSourceClockAction",
    "function runStudioCaptureAction"
  );
  assert.match(queue, /sourceClockOperationQueue\.generation/u);
  assert.match(queue, /sourceClockOperationQueue\.enqueue/u);
  assert.match(queue, /await runQueuedSourceClockAction\(action\)/u);
  assert.match(
    queue,
    /expectedGeneration !== sourceClockOperationQueue\.generation[\s\S]*StaleSerialOperationGenerationError/u
  );

  const dispatch = sourceSection(
    source,
    "function runStudioCaptureAction",
    "function reportStudioCaptureActionError"
  );
  assert.match(dispatch, /default:\s*queueSourceClockAction\(action\)/u);
  const playerGate = sourceSection(
    source,
    "function studioCaptureActionNeedsPlayer",
    "function playerControlAvailable"
  );
  for (const action of [
    "capture-start",
    "capture-end",
    "player-seek-backward-five",
    "player-seek-forward-five",
    "player-rate-quarter",
    "player-rate-double"
  ]) {
    assert.match(playerGate, new RegExp(`action === "${action}"`, "u"));
  }
  assert.doesNotMatch(
    dispatch,
    /prepareLocalPreview|startChzzkVodMaterialization|localPreviewVideo/u
  );
});
