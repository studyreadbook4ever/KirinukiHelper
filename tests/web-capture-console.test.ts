import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STUDIO_CAPTURE_SHORTCUT_BINDINGS,
  studioCaptureShortcutBinding,
  studioCaptureShortcutLetterFromEvent
} from "../src/web/studio-capture-console.js";

test("웹 컷 화면은 PR16 단축키 의미를 소유하는 캡처 콘솔을 노출한다", async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.css", import.meta.url), "utf8")
  ]);

  assert.deepEqual(
    STUDIO_CAPTURE_SHORTCUT_BINDINGS.map(({ key }) => key),
    ["Q", "W", "E", "R", "T", "A", "D", "F", "Y", "U"]
  );
  assert.equal(studioCaptureShortcutBinding("Q")?.targetId, null);
  assert.equal(studioCaptureShortcutBinding("A")?.targetId, null);
  assert(STUDIO_CAPTURE_SHORTCUT_BINDINGS
    .filter(({ key }) => key !== "Q" && key !== "A")
    .every(({ targetId }) => typeof targetId === "string"));
  for (const binding of STUDIO_CAPTURE_SHORTCUT_BINDINGS) {
    assert.match(binding.title, new RegExp(`\\(단축키 ${binding.key}\\)$`, "u"));
    assert.equal(studioCaptureShortcutBinding(binding.key), binding);
  }

  assert.match(html, /id="refresh-local-projects"[^>]*aria-keyshortcuts="Q"/u);
  assert.match(html, /id="start-editor"[^>]*aria-keyshortcuts="A"/u);
  assert.match(html, /강조된 행에 E로 시작, R로 끝 시각을 기록합니다/u);
  assert.match(html, /id="add-clip"[^>]*>빈 구간 추가<\/button>/u);
  assert.match(html, /data-field="start"[^>]*required/u);
  assert.match(html, /data-field="end"[^>]*required/u);
  for (const id of [
    "stream-cut-console",
    "capture-start",
    "capture-end",
    "seek-backward-five",
    "seek-forward-five",
    "playback-rate-quarter",
    "playback-rate-double"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(css, /\.stream-cut-console[\s\S]*\.stream-cut-buttons/u);
  assert.match(source, /studioCaptureShortcutLetterFromEvent\(event\)/u);
  assert.match(source, /function installStudioCaptureConsole\([\s\S]*runStudioCaptureAction\(binding\.action\)/u);
});

test("웹 컷 화면의 보이는 단축키는 IME·수정키·입력 요소 보호를 유지한다", () => {
  const documentSurface = { tagName: "DIV" };
  const textInput = { tagName: "INPUT" };
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "Process",
    code: "KeyQ",
    target: documentSurface
  }), "Q");
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "q",
    code: "KeyQ",
    ctrlKey: true,
    target: documentSurface
  }), null);
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "Process",
    code: "KeyQ",
    isComposing: true,
    target: documentSurface
  }), null);
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "q",
    code: "KeyQ",
    target: textInput
  }), null);
});

test("빈 구간 추가와 T 확정은 값이 들어간 행만 처리한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /elements\.addClip\.addEventListener\("click", \(\) => addClipRow\(\)\)/u);
  assert.match(
    source,
    /const populatedRows = clipRows\(\)\.filter[\s\S]*startInput\.value\.trim\(\)[\s\S]*const segments = populatedRows\.map/u
  );
  assert.match(source, /function finalizeCurrentDraftRow[\s\S]*validateStudioSelectionRange/u);
  assert.match(source, /case "save-segment":[\s\S]*finalizeCurrentDraftRow\(\)/u);
});

test("역순·0.1초 미만 구간은 즉시 표시하고 편집기 CTA와 A 진입을 함께 막는다", async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /class="coverage"[^>]*role="status"[^>]*aria-live="polite"/u);
  assert.match(
    source,
    /const invalid = populated && validation\.status !== "valid"[\s\S]*row\.dataset\.rangeValidity = invalid[\s\S]*setAttribute\("aria-invalid", "true"\)/u
  );
  assert.match(
    source,
    /function renderEditorEntryAvailability\([\s\S]*mobileEditorBlocked \|\| openingEditor \|\| invalidRow[\s\S]*elements\.startEditor\.disabled/u
  );
  assert.match(
    source,
    /function firstKnownInvalidClipRow\([\s\S]*if \(resumeProject\)[\s\S]*return null[\s\S]*rangeValidity === "invalid"/u
  );
  assert.match(
    source,
    /validation\.status === "invalid-order"[\s\S]*STUDIO_SELECTION_RANGE_ORDER_ERROR/u
  );
  assert.match(
    source,
    /binding\.action === "open-editor" && elements\.startEditor\.disabled[\s\S]*return;[\s\S]*runStudioCaptureAction\(binding\.action\)/u
  );
  assert.match(css, /\.clip-row\.invalid \.coverage \{[^}]*#ff9292/u);
});

test("A는 화면 아래의 단일 편집기 CTA와 같은 검증 경로를 사용한다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  assert.match(
    source,
    /case "open-editor":[\s\S]*elements\.startEditor\.click\(\)/u
  );
  assert.match(
    html,
    /id="start-editor"[^>]*aria-keyshortcuts="A"[^>]*>편집기 열기<\/button>/u
  );
  assert.doesNotMatch(html, /id="(?:open-editor|create-codex-job)"/u);
});

test("웹은 짧은 로컬 미리보기와 확정 컷 준비를 무창 도우미에 의미 단위로 요청한다", async () => {
  const [html, source, server] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local-studio-server-core.ts", import.meta.url), "utf8")
  ]);
  assert.match(
    html,
    /링크를 붙여넣으면 이 페이지에서 바로 컷을 고를 수 있습니다\.[\s\S]*도우미는 별도 편집 창을 열지 않[\s\S]*강조된 행에 E로 시작, R로 끝 시각을 기록합니다/u
  );
  assert.match(html, /data-field="start"[^>]*required/u);
  assert.match(html, /data-field="end"[^>]*required/u);
  assert.match(html, /id="start-editor"[^>]*>편집기 열기<\/button>/u);
  assert.match(source, /function replaceStreamFrame\(\)/u);
  assert.match(source, /elements\.reloadStream\.addEventListener[\s\S]*reloadActivePlayerFrame\(\)/u);
  assert.match(html, /id="stream-preview-video"[\s\S]*id="stream-preview-timeline"/u);
  assert.match(source, /prepareLocalPreview[\s\S]*captureCurrentPlayerTime[\s\S]*seekPlayerBy[\s\S]*setPlayerRate/u);
  assert.match(source, /materializeLocalPreviewRange[\s\S]*startChzzkVodMaterialization/u);
  assert.match(source, /prepareSelectedVodForEditor[\s\S]*waitForChzzkVodMaterialization/u);
  assert.doesNotMatch(source, /StreamingBridgeClient|kirinukiCutHost|kirinukiSurface=cut-host/u);
  assert.doesNotMatch(source, /youtube-iframe-api|window\.YT|onYouTubeIframeAPIReady|new api\.Player/u);
  assert.doesNotMatch(source, /fetch\([^\n]*(?:youtube|chzzk|soop)/iu);
  assert.match(server, /"script-src 'self'"/u);
  assert.doesNotMatch(server, /script-src[^\n]*youtube/u);
});

test("웹 컷 화면은 PR16 단축키를 직접 쓰되 Electron·구 Codex 작업폴더에는 의존하지 않는다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  assert.equal(studioCaptureShortcutBinding("W")?.action, "refresh-source");
  assert.equal(studioCaptureShortcutBinding("S"), null);
  assert.doesNotMatch(source, /Electron|kirinukiCutHost/u);
  assert.doesNotMatch(source, /createWebCodexJobFolder|createCodexJobFromCurrentForm/u);
  assert.doesNotMatch(html, /chrome-extension:\/\//u);
});
