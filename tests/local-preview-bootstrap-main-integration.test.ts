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

test("컷 단계는 다운로드 없이 스트리밍 플레이어 명령만 직렬화한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const controls = sourceSection(
    source,
    "async function captureCurrentPlayerTime",
    "function reportStudioCaptureActionError"
  );

  assert.match(controls, /client\.snapshot\(\)/u);
  assert.match(
    controls,
    /const before = await runTransientSafeStreamingAction\([\s\S]*client\.snapshot\(\)[\s\S]*client\.seekAbsolute\(target\)/u
  );
  assert.match(
    controls,
    /client\.setPlaybackRate\(playbackRate\)/u
  );
  assert.match(
    controls,
    /sourceClockOperationQueue\.enqueue\([\s\S]*runQueuedSourceClockAction/u,
    "E/R/D/F/Y/U는 같은 source-clock 직렬 큐를 통과해야 합니다."
  );
  assert.doesNotMatch(
    controls,
    /fetch\s*\(|XMLHttpRequest|startChzzkVodMaterialization|waitForChzzkVodMaterialization|prepareLocalPreview|localPreviewVideo|\/v1\/vod\/materializations/iu,
    "컷 명령이 미디어 acquisition 또는 로컬 대체 영상 준비를 시작했습니다."
  );
  assert.doesNotMatch(
    controls,
    /streamFrame\.(?:hidden|src)|replaceStreamFrame/u,
    "컷 명령은 현재 스트리밍 iframe의 표시나 URL을 바꾸면 안 됩니다."
  );
});

test("원본 입력 변경은 이전 bridge와 source-clock 세대를 즉시 폐기한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const reset = sourceSection(
    source,
    "function resetStreamingBridge",
    "function syncStreamingBridgeSource"
  );
  assert.match(reset, /sourceClockOperationQueue\.advanceGeneration\(\)/u);
  assert.match(reset, /streamingBridgeGeneration \+= 1/u);
  assert.match(reset, /streamingBridgeClient\?\.destroy\(\)/u);
  assert.match(reset, /streamingBridgeClient = null/u);
  assert.match(reset, /latestStreamingSnapshot = null/u);

  const inputHandler = sourceSection(
    source,
    'elements.sourceUrl.addEventListener("input"',
    'elements.projectName.addEventListener("input"'
  );
  const resetIndex = inputHandler.indexOf("resetStreamingBridge()");
  const scheduleIndex = inputHandler.indexOf("scheduleStreamPreview()");
  assert(resetIndex >= 0 && scheduleIndex > resetIndex);
});

test("새 원본은 같은 iframe을 보이는 상태로 연결하고 로컬 video로 대체하지 않는다", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/index.html", import.meta.url), "utf8")
  ]);
  assert.match(html, /<iframe[^>]+id="stream-preview-frame"/u);
  assert.doesNotMatch(
    html,
    /id="local-preview-video"|id="prepare-local-preview"|id="local-preview-anchor"/u
  );

  const preview = sourceSection(
    source,
    "function updateStreamPreview",
    "function scheduleStreamPreview"
  );
  const showFrame = preview.indexOf("elements.streamFrame.hidden = false");
  const assignSource = preview.indexOf(
    "elements.streamFrame.src = descriptor.embedUrl"
  );
  assert(showFrame >= 0 && assignSource > showFrame);
  assert.match(preview, /syncStreamingBridgeSource\(\)/u);
  assert.doesNotMatch(
    preview,
    /fetch\s*\(|materialization|localPreview|HTMLVideoElement/iu
  );

  const loadHandler = sourceSection(
    source,
    "function installStreamFrameLoadHandler",
    'elements.form.addEventListener("submit"'
  );
  assert.match(loadHandler, /frame !== elements\.streamFrame/u);
  assert.match(loadHandler, /frame\.src !== activeStreamEmbedUrl/u);
  assert.match(
    loadHandler,
    /connectStreamingBridge\(frame, activeStreamEmbedUrl\)/u
  );
  assert.doesNotMatch(loadHandler, /streamFrame\.hidden\s*=\s*true/u);
});

test("한 번의 플랫폼 전환 실패가 시계 polling과 컷 버튼을 영구 차단하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const polling = sourceSection(
    source,
    "async function pollStreamingBridgeClock",
    "function streamingBridgeReady"
  );
  assert.match(polling, /!streamingBridgeClockPollingEnabled/u);
  assert.doesNotMatch(
    polling,
    /\|\| !streamingBridgeReady\(\)/u,
    "최근 snapshot 하나가 실패했다는 이유로 polling 자체를 막으면 안 됩니다."
  );
  assert.match(
    polling,
    /const recoverable = recoverableStreamingClockError\(error\)[\s\S]*if \(!recoverable\) \{[\s\S]*latestStreamingSnapshot = null/u,
    "복구 가능한 실패에서는 마지막 정상 시계를 유지해야 합니다."
  );
  assert.match(
    source,
    /function transientStreamingPlayerStateError[\s\S]*player-unavailable[\s\S]*source-unavailable/u,
    "일시적인 플레이어·원본 상태를 복구 대상으로 분류해야 합니다."
  );
  assert.match(
    source,
    /runTransientSafeStreamingAction[\s\S]*attempt < 6/u,
    "사용자 E/R/D/F/Y/U 동작도 일시적인 플레이어 전환을 재시도해야 합니다."
  );
});
