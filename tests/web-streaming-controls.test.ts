import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("컷 단계는 원본 iframe과 수동 입력만 유지하고 삭제된 브리지 경로를 싣지 않는다", async () => {
  const [html, mainSource, bundle] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /<iframe[^>]+id="stream-preview-frame"/u);
  assert.match(html, /원본을 보며 가져올 시작과 끝 시각을 직접 입력하세요/u);
  assert.doesNotMatch(
    html,
    /stream-cut-console|local-preview-video|local-preview-anchor|prepare-local-preview/u
  );
  assert.doesNotMatch(
    mainSource,
    /streaming-bridge|StreamingBridge|streamingBridge|captureCurrentPlayerTime|seekPlayerBy|setPlayerRate|ChzzkVodMaterialization|LOCAL_VOD_COMPANION_ENDPOINT/u
  );
  assert.doesNotMatch(
    bundle,
    /chrome-extension|streaming-companion|streaming-bridge|StreamingBridge|stream-cut-console/u
  );
});

test("browser smoke는 확장을 로드하지 않고 임베드·수동 구간 입력·0회 acquisition을 검증한다", async () => {
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
  assert.match(capturePhase, /extensionlessCaptureState/u);
  assert.match(capturePhase, /obsoleteBridgeControlsAbsent[\s\S]*manualInputsEnabled[\s\S]*iframeVisible/u);
  assert.match(capturePhase, /(?:acquisition|materialization|download|gateway)\w*\s*===\s*0/iu);
  assert.doesNotMatch(smoke, /buildStreamingCompanion|production-companion-fixtures/u);
  assert.doesNotMatch(smoke, /`--load-extension=|`--disable-extensions-except=/u);
});

test("표준 package script는 확장·구 Linux source archive 경로를 노출하지 않는다", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url),
    "utf8"
  )) as { scripts?: Record<string, string> };
  const scripts = manifest.scripts || {};
  assert.equal(scripts["test:browser:live-vod"], undefined);
  assert.equal(scripts["test:browser:live-vod-cut"], undefined);
  assert.equal(scripts["streaming:companion:build"], undefined);
  assert.equal(scripts["package:linux"], undefined);
  assert.doesNotMatch(
    JSON.stringify(scripts),
    /--load-extension|streaming-companion|package-linux-app|verify-linux-app-package/u
  );
});
