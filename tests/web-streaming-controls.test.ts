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
  assert.match(source, /ElectronCutSession/u);
  assert.match(source, /connectElectronPlayer/u);
  assert.doesNotMatch(`${source}\n${bundle}`, /chrome-extension:\/\//u);
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

test("desktop package는 headless 엔진과 격리된 컷 창 preload·frame action을 묶는다", async () => {
  const [build, packageFiles, manifest] = await Promise.all([
    readFile(new URL("../scripts/build-desktop.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/desktop-package-files.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  assert.match(build, /entryPoints: \["src\/desktop\/main\.ts"\]/u);
  assert.match(build, /src\/desktop\/cut-window-preload\.ts/u);
  assert.match(build, /src\/streaming-electron-frame-action\.ts/u);
  assert.match(packageFiles, /preload\.cjs/u);
  assert.doesNotMatch(manifest, /chrome-extension:\/\//u);
});

test("구 Extension은 없고 Electron 컷 호스트는 desktop 경계에만 있다", async () => {
  const [validator, migration] = await Promise.all([
    readFile(new URL("../scripts/validate-local-studio.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/check-typescript-migration.ts", import.meta.url), "utf8")
  ]);
  assert.match(validator, /packageScripts\["test:electron:cut-window"\] === undefined/u);
  assert.match(validator, /!buildWebSource\.includes\("streaming-electron-frame-action"\)/u);
  assert.doesNotMatch(migration, /build-extension-legacy|dev-extension/u);
});
