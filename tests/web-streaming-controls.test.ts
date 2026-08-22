import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("컷 단계는 원본 iframe과 컷 전용 bridge만 쓰고 로컬 미디어 준비를 시작하지 않는다", async () => {
  const [html, mainSource, bundle] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /<iframe[^>]+id="stream-preview-frame"/u);
  assert.match(html, /id="stream-cut-console"[\s\S]*id="stream-current-time"/u);
  assert.match(html, /강조된 행에 E로 시작, R로 끝 시각을 기록합니다/u);
  assert.doesNotMatch(
    html,
    /local-preview-video|local-preview-anchor|prepare-local-preview/u
  );
  assert.match(
    mainSource,
    /StreamingBridgeClient[\s\S]*captureCurrentPlayerTime[\s\S]*seekPlayerBy[\s\S]*setPlayerRate/u
  );
  assert.doesNotMatch(
    mainSource,
    /ChzzkVodMaterialization|LOCAL_VOD_COMPANION_ENDPOINT|KIRINUKI_MEDIA_ENGINE_ENDPOINT|startChzzkVodMaterialization|waitForChzzkVodMaterialization|localPreviewVideo|\/v1\/vod\/materializations/u
  );
  assert.match(bundle, /kirinuki-streaming-bridge\/v2/u);
  assert.doesNotMatch(bundle, /chrome-extension:\/\//u);
});

test("표준 browser smoke는 Electron preload 부재를 fail-closed하고 수동 입력과 0회 acquisition을 유지한다", async () => {
  const smoke = await readFile(
    new URL("../scripts/local-studio-browser-smoke.ts", import.meta.url),
    "utf8"
  );
  const capturePhaseStart = smoke.indexOf(
    "const chzzkFrame = await setSourceAndVerify"
  );
  const capturePhaseEnd = smoke.indexOf(
    "const clipInitialState = await execute",
    capturePhaseStart
  );
  assert(capturePhaseStart >= 0 && capturePhaseEnd > capturePhaseStart);
  const capturePhase = smoke.slice(capturePhaseStart, capturePhaseEnd);
  assert.doesNotMatch(capturePhase, /\/v1\/vod\/materializations|#local-preview-video/u);
  assert.match(
    capturePhase,
    /extensionlessCaptureState[\s\S]*bridgeConsolePresent[\s\S]*playerControlsDisabled[\s\S]*manualInputsEnabled[\s\S]*iframeVisible/u
  );
  assert.match(
    capturePhase,
    /acquisitionRequests\s*===\s*0/u
  );
  assert.match(smoke, /browserExtension: "not-loaded"/u);
  assert.match(smoke, /playerBridge: "present-fail-closed-without-electron-preload"/u);
});

test("browser smoke는 저장소 준비 장벽 뒤 fixture를 기록하고 모든 IndexedDB 실패를 종료한다", async () => {
  const smoke = await readFile(
    new URL("../scripts/local-studio-browser-smoke.ts", import.meta.url),
    "utf8"
  );
  const startupBarrier = smoke.indexOf(
    "fixture 기록 전 브라우저 저장소의 명시적 새로 읽기를 완료하지 못했습니다."
  );
  const fixtureWrite = smoke.indexOf(
    "await storeBrowserProjects([\n    staleBrowserProject"
  );
  assert(startupBarrier >= 0 && fixtureWrite > startupBarrier);

  const writerStart = smoke.indexOf("async function storeBrowserProjects(");
  const writerEnd = smoke.indexOf(
    "async function storeBrowserProject(",
    writerStart
  );
  assert(writerStart >= 0 && writerEnd > writerStart);
  const writer = smoke.slice(writerStart, writerEnd);
  assert.match(writer, /open\.onblocked/u);
  assert.match(writer, /transaction\.onerror/u);
  assert.match(writer, /transaction\.onabort/u);
  assert.match(writer, /request\.onerror/u);
  assert.match(writer, /closeDatabase/u);

  const barrier = smoke.slice(
    smoke.lastIndexOf("await webdriver", startupBarrier),
    fixtureWrite
  );
  assert.match(barrier, /document\.readyState === "complete"/u);
  assert.match(barrier, /getAttribute\("aria-busy"\) === "false"/u);
  assert.match(barrier, /#local-projects-error/u);
  assert.match(barrier, /#refresh-local-projects/u);
});

test("player 제어는 unpacked extension 대신 ASAR 고정 frame action만 배포한다", async () => {
  const [buildSource, packageSource, packageManifest] = await Promise.all([
    readFile(new URL("../scripts/build-desktop.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-desktop.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  assert.match(buildSource, /streaming-electron-frame-action\.ts/u);
  assert.match(packageSource, /isolatedResources\.toolsRoot/u);
  assert.doesNotMatch(packageManifest, /package-linux-app|verify-linux-app-package/u);
});
