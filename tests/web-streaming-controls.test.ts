import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("웹 컷 화면은 공식 iframe과 같은 페이지의 검증된 로컬 video를 함께 쓴다", async () => {
  const [html, source, bundle] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /<iframe[^>]+id="stream-preview-frame"/u);
  assert.match(html, /<video[^>]+id="stream-preview-video"/u);
  assert.match(source, /materializeLocalPreviewRange[\s\S]*startChzzkVodMaterialization/u);
  assert.match(source, /localPreviewSourceAtMediaZero\(window\)/u);
  assert.match(source, /currentLocalPreviewSourceTime[\s\S]*localPreviewSourceSeconds/u);
  assert.match(source, /targetMediaSeconds[\s\S]*prepareLocalPreview\(targetSourceSeconds\)/u);
  assert.match(source, /function cancelActiveLocalPreviewOperation/u);
  assert.match(source, /cancelChzzkVodMaterialization\(\{/u);
  assert.match(source, /signal: operation\.controller\.signal/u);
  assert.doesNotMatch(`${source}\n${bundle}`, /streaming-bridge|chrome-extension:\/\//u);
});

test("확정 구간 요청은 사용자 선택을 millisecond 범위로 그대로 보낸다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /prepareSelectedVodForEditor[\s\S]*captureSeed\.segments[\s\S]*id: captureSegmentEditorClipId\(segment, index\)[\s\S]*startMs: Math\.round\(startSeconds \* 1_000\)[\s\S]*endMs: Math\.round\(endSeconds \* 1_000\)/u
  );
  assert.match(
    source,
    /startChzzkVodMaterialization\(\{[\s\S]*consumerId: projectId,[\s\S]*clips,[\s\S]*rightsConfirmed: true/u
  );
  assert.match(source, /status\.state !== "completed"[\s\S]*waitForChzzkVodMaterialization/u);
});

test("desktop package는 UI·preload·frame action 없이 headless main만 묶는다", async () => {
  const [build, packageFiles, manifest] = await Promise.all([
    readFile(new URL("../scripts/build-desktop.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/desktop-package-files.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  assert.match(build, /entryPoints: \["src\/desktop\/main\.ts"\]/u);
  assert.doesNotMatch(
    `${build}\n${packageFiles}\n${manifest}`,
    /cut-window|preload|streaming-electron-frame-action|test:electron:cut-window/u
  );
});

test("구 Extension과 Electron 컷 호스트 모듈은 build·test inventory에 없다", async () => {
  const [validator, migration] = await Promise.all([
    readFile(new URL("../scripts/validate-local-studio.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/check-typescript-migration.ts", import.meta.url), "utf8")
  ]);
  assert.match(validator, /test:electron:cut-window/u);
  assert.match(validator, /!buildWebSource\.includes\("streaming-electron-frame-action"\)/u);
  assert.doesNotMatch(migration, /build-extension-legacy|dev-extension/u);
});
