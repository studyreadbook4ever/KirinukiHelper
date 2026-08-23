import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("제품 본체는 공개 웹이고 설치 도우미는 화면 없는 부분 VOD 엔진이다", async () => {
  const [agents, readme, html, webMain, desktopMain] = await Promise.all([
    source("AGENTS.md"),
    source("README.md"),
    source("web/index.html"),
    source("src/web/main.ts"),
    source("src/desktop/main.ts")
  ]);

  assert.match(agents, /웹사이트가 제품 본체/u);
  assert.match(agents, /제품 runtime은 `BrowserWindow`를 만들지 않/u);
  assert.match(readme, /URL 입력부터 컷 선택·전체 편집까지 공개 웹사이트/u);
  assert.match(html, /id="source-url"[\s\S]*id="stream-cut-console"[\s\S]*id="start-editor"/u);
  assert.doesNotMatch(html, /id="cut-host-launch-panel"|id="launch-kirinuki-cut"/u);
  assert.doesNotMatch(webMain, /kirinukiSurface=cut-host|kirinuki-engine:\/\/cut/u);
  assert.doesNotMatch(webMain, /kirinukiCutHost|EditorHandoff/u);
  assert.doesNotMatch(desktopMain, /BrowserWindow|openCutWindow|CUT_WINDOW/u);
});

test("새 컷은 웹에서 선택하고 확정 범위 준비 완료 뒤 같은 브라우저 편집기로 이동한다", async () => {
  const [html, webMain] = await Promise.all([
    source("web/index.html"),
    source("src/web/main.ts")
  ]);

  assert.match(html, /링크를 붙여넣고 이 페이지의 원본 화면에서 바로 컷을 고르세요/u);
  assert.match(html, /도우미는 선택 사항/u);
  assert.match(webMain, /beginInstallPolling: true/u);
  assert.match(webMain, /allowImmediateProtocolLaunch: true/u);
  assert.match(html, /id="cut-preparation-progress"/u);
  assert.match(html, /id="cut-preparation-stage"/u);
  assert.match(webMain, /startChzzkVodMaterialization/u);
  assert.match(webMain, /waitForChzzkVodMaterialization/u);
  assert.match(webMain, /ensureLocalMediaEngineReady/u);
  assert.match(webMain, /beginWebEditorSession/u);

  const prepareIndex = webMain.indexOf("await prepareSelectedVodForEditor(");
  const sessionIndex = webMain.indexOf("await beginWebEditorSession(", prepareIndex);
  const navigationIndex = webMain.indexOf("location.assign(session.editorUrl)", sessionIndex);
  assert.ok(prepareIndex >= 0, "확정 범위 준비가 없습니다.");
  assert.ok(sessionIndex > prepareIndex, "준비 전에 편집기 session을 만들었습니다.");
  assert.ok(navigationIndex > sessionIndex, "준비·session 뒤 브라우저 이동이 없습니다.");
});

test("PR16·확장프로그램의 컷 단축키 열 개는 웹 문서에서 같은 동작으로 유지된다", async () => {
  const [html, webMain, bindings] = await Promise.all([
    source("web/index.html"),
    source("src/web/main.ts"),
    source("src/web/studio-capture-console.ts")
  ]);

  for (const key of ["Q", "W", "E", "R", "T", "A", "D", "F", "Y", "U"]) {
    assert.match(bindings, new RegExp(`key: "${key}"`, "u"));
  }
  for (const id of [
    "stream-preview-video",
    "refresh-source",
    "capture-start",
    "capture-end",
    "save-segment",
    "seek-backward-five",
    "seek-forward-five",
    "playback-rate-quarter",
    "playback-rate-double"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(webMain, /installStudioCaptureConsole/u);
  assert.match(webMain, /HTMLVideoElement/u);
  assert.match(webMain, /captureCurrentPlayerTime/u);
  assert.match(webMain, /seekPlayerBy/u);
  assert.match(webMain, /setPlayerRate/u);
});

test("세 설치 대상과 headless 자동 시작 계약은 그대로 고정된다", async () => {
  const [installer, desktopMain, packageFiles, qualityWorkflow] = await Promise.all([
    source("src/desktop/installer-contract.ts"),
    source("src/desktop/main.ts"),
    source("scripts/desktop-package-files.ts"),
    source(".github/workflows/typescript-quality.yml")
  ]);

  for (const marker of [
    "windows-x64",
    "macos-arm64",
    "linux-x64"
  ]) {
    assert.match(installer, new RegExp(marker, "u"));
  }
  assert.match(desktopMain, /ensureEngineAutostart/u);
  assert.match(desktopMain, /startDesktopRuntimeSupervisor/u);
  assert.match(desktopMain, /webContents\.getAllWebContents\(\)\.length/u);
  assert.doesNotMatch(packageFiles, /preload\.cjs/u);
  assert.doesNotMatch(
    qualityWorkflow,
    /test:electron:cut-window|sandboxed cut host/u
  );
  assert.match(qualityWorkflow, /Run the packaged desktop liveness smoke/u);
  assert.match(qualityWorkflow, /test:semantic:engine/u);
});
