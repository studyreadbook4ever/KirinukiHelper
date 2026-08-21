import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STUDIO_CAPTURE_SHORTCUT_BINDINGS,
  studioCaptureShortcutBinding,
  studioCaptureShortcutLetterFromEvent
} from "../src/web/studio-capture-console.js";

test("웹 컷 화면은 수동 구간 입력만 노출하고 플레이어 브리지 콘솔을 싣지 않는다", async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.css", import.meta.url), "utf8")
  ]);

  assert.deepEqual(
    STUDIO_CAPTURE_SHORTCUT_BINDINGS.map(({ key }) => key),
    ["Q", "A"]
  );
  assert(STUDIO_CAPTURE_SHORTCUT_BINDINGS.every(({ targetId }) => targetId === null));
  for (const binding of STUDIO_CAPTURE_SHORTCUT_BINDINGS) {
    assert.match(binding.title, new RegExp(`\\(단축키 ${binding.key}\\)$`, "u"));
    assert.equal(studioCaptureShortcutBinding(binding.key), binding);
  }

  assert.match(html, /id="refresh-local-projects"[^>]*aria-keyshortcuts="Q"/u);
  assert.match(html, /id="start-editor"[^>]*aria-keyshortcuts="A"/u);
  assert.match(html, /원본을 보며 가져올 시작과 끝 시각을 직접 입력하세요/u);
  assert.match(html, /id="add-clip"[^>]*>빈 구간 추가<\/button>/u);
  assert.match(html, /data-field="start"[^>]*required/u);
  assert.match(html, /data-field="end"[^>]*required/u);
  assert.doesNotMatch(
    html,
    /stream-cut-console|capture-start|capture-end|seek-backward-five|seek-forward-five|playback-rate-quarter|playback-rate-double/u
  );
  assert.doesNotMatch(css, /\.stream-cut-console|\.stream-cut-buttons/u);
  assert.match(source, /studioCaptureShortcutLetterFromEvent\(event\)/u);
  assert.match(source, /binding\.action === "open-editor"[\s\S]*elements\.startEditor\.click\(\)/u);
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

test("빈 구간 추가와 제출은 값이 들어간 수동 행만 처리한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /elements\.addClip\.addEventListener\("click", \(\) => addClipRow\(\)\)/u);
  assert.match(
    source,
    /const populatedRows = clipRows\(\)\.filter[\s\S]*startInput\.value\.trim\(\)[\s\S]*const segments = populatedRows\.map/u
  );
  assert.doesNotMatch(source, /finalizeCurrentDraftRow|case "save-segment"/u);
});

test("A는 화면 아래의 단일 편집기 CTA와 같은 검증 경로를 사용한다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  assert.match(
    source,
    /binding\.action === "open-editor" && !elements\.startEditor\.disabled[\s\S]*elements\.startEditor\.click\(\)/u
  );
  assert.match(
    html,
    /id="start-editor"[^>]*aria-keyshortcuts="A"[^>]*>편집기 열기<\/button>/u
  );
  assert.doesNotMatch(html, /id="(?:open-editor|create-codex-job)"/u);
});

test("플레이어 브리지 없이 수동 구간 입력과 편집기 진입이 완결된다", async () => {
  const [html, source, server] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local-studio-server-core.ts", import.meta.url), "utf8")
  ]);
  assert.match(
    html,
    /편집기를 열 때 선택한 구간만 이 PC에 준비합니다[\s\S]*원본을 보며 가져올 시작과 끝 시각을 직접 입력하세요/u
  );
  assert.match(html, /data-field="start"[^>]*required/u);
  assert.match(html, /data-field="end"[^>]*required/u);
  assert.match(html, /id="start-editor"[^>]*>편집기 열기<\/button>/u);
  assert.match(source, /function replaceStreamFrame\(\)/u);
  assert.match(source, /elements\.reloadStream\.addEventListener[\s\S]*reloadActivePlayerFrame\(\)/u);
  assert.doesNotMatch(
    source,
    /streaming-bridge|StreamingBridge|streamingBridge|captureCurrentPlayerTime|seekPlayerBy|setPlayerRate/u
  );
  assert.doesNotMatch(source, /youtube-iframe-api|window\.YT|onYouTubeIframeAPIReady|new api\.Player/u);
  assert.doesNotMatch(
    source,
    /LOCAL_VOD_COMPANION_ENDPOINT|KIRINUKI_MEDIA_ENGINE_ENDPOINT|localPreviewVideo/u
  );
  assert.doesNotMatch(source, /fetch\([^\n]*(?:youtube|chzzk|soop)/iu);
  assert.match(server, /"script-src 'self'"/u);
  assert.doesNotMatch(server, /script-src[^\n]*youtube/u);
});

test("웹 컷 화면은 Extension 작업폴더나 브라우저 확장 실행에 의존하지 않는다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  assert.equal(studioCaptureShortcutBinding("W"), null);
  assert.equal(studioCaptureShortcutBinding("S"), null);
  assert.doesNotMatch(source, /createWebCodexJobFolder|createCodexJobFromCurrentForm/u);
  assert.doesNotMatch(html, /chrome-extension:\/\/|chrome:\/\/extensions|확장 프로그램/u);
});
