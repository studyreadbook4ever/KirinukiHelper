import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STUDIO_CAPTURE_SHORTCUT_BINDINGS,
  studioCaptureShortcutBinding,
  studioCaptureShortcutLetterFromEvent
} from "../src/web/studio-capture-console.js";
import {
  YOUTUBE_IFRAME_API_LOAD_TIMEOUT_MS,
  YOUTUBE_IFRAME_API_SCRIPT_URL,
  loadYouTubeIframeApi,
  readYouTubePlayerSnapshot
} from "../src/web/youtube-iframe-api.js";
import type {
  YouTubeIframePlayer
} from "../src/web/youtube-iframe-api.js";

test("웹 컷 콘솔은 핵심 제어만 보이고 중복 진입 동작은 기존 CTA에 연결한다", async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.css", import.meta.url), "utf8")
  ]);
  assert.deepEqual(
    STUDIO_CAPTURE_SHORTCUT_BINDINGS.map(({ key }) => key),
    ["Q", "W", "E", "R", "T", "A", "D", "F", "Y", "U"]
  );
  assert.equal(
    new Set(STUDIO_CAPTURE_SHORTCUT_BINDINGS.flatMap(
      ({ targetId }) => targetId ? [targetId] : []
    )).size,
    8
  );
  const domKeyOrder = [
    "W", "Y", "U", "D", "F", "E", "R", "T"
  ] as const;
  const bindingByKey = new Map(
    STUDIO_CAPTURE_SHORTCUT_BINDINGS.map((binding) => [binding.key, binding])
  );
  let previousButtonPosition = html.indexOf('id="stream-cut-console"');
  for (const key of domKeyOrder) {
    const binding = bindingByKey.get(key);
    assert.ok(binding, `${key} 단축키 binding`);
    assert.ok(binding.targetId, `${key} visible target`);
    const buttonPosition = html.indexOf(`id="${binding.targetId}"`);
    assert(buttonPosition > previousButtonPosition, `${binding.key} 버튼 DOM 순서`);
    previousButtonPosition = buttonPosition;
    const buttonTag = html.slice(buttonPosition, html.indexOf(">", buttonPosition) + 1);
    assert.match(buttonTag, new RegExp(
      `aria-keyshortcuts="${binding.key}"[^>]*title="[^"]+\\(단축키 ${binding.key}\\)"`,
      "u"
    ));
    assert.match(
      html.slice(buttonPosition, html.indexOf("</button>", buttonPosition)),
      new RegExp(`<kbd>${binding.key}</kbd>`, "u")
    );
    assert.match(binding.title, new RegExp(`\\(단축키 ${binding.key}\\)$`, "u"));
    assert.equal(studioCaptureShortcutBinding(binding.key), binding);
  }
  assert.equal(bindingByKey.get("Q")?.targetId, null);
  assert.equal(bindingByKey.get("A")?.targetId, null);
  assert.match(html, /id="refresh-local-projects"[^>]*aria-keyshortcuts="Q"/u);
  assert.match(html, /id="start-editor"[^>]*aria-keyshortcuts="A"/u);
  assert.doesNotMatch(html, /id="(?:refresh-recovery-sessions|open-editor|create-codex-job)"/u);
  const consoleStart = html.indexOf('id="stream-cut-console"');
  const footerStart = html.indexOf('<div class="stream-preview-footer">');
  assert.match(
    html,
    /<\/div>\s*<section id="stream-cut-console" class="stream-cut-console"/u
  );
  assert(consoleStart >= 0 && footerStart > consoleStart);
  assert.match(source, /studioCaptureShortcutLetterFromEvent\(event\)/u);
  assert.doesNotMatch(source, /studioCaptureShortcutLetterFromEvent\([^)]*,/u);
  assert.match(source, /button\.title = binding\.title/u);
  assert.match(source, /button\.setAttribute\("aria-keyshortcuts", binding\.key\)/u);
  assert.match(
    css,
    /"refresh refresh quarter double"[\s\S]*"back back forward forward"[\s\S]*"capture-start capture-start capture-end capture-end"[\s\S]*"save save save save"/u
  );
});

test("웹 컷 콘솔은 Extension 전용 작업폴더 동작에 의존하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  assert.equal(studioCaptureShortcutBinding("S"), null);
  assert.doesNotMatch(source, /createWebCodexJobFolder|createCodexJobFromCurrentForm/u);
});

test("W는 iframe과 버퍼를 버리지 않고 현재 플레이어 문맥만 다시 읽는다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  const refresh = source.slice(
    source.indexOf("async function refreshActivePlayerContext"),
    source.indexOf("function reloadActivePlayerFrame")
  );
  assert.match(refresh, /currentYouTubePlayerSnapshot\(\)/u);
  assert.match(refresh, /streamingBridgeClient[\s\S]*client\.snapshot\(\)/u);
  assert.doesNotMatch(refresh, /updateStreamPreview|replaceFrame|\.src\s*=/u);
  assert.match(
    source,
    /case "refresh-source":[\s\S]*refreshActivePlayerContext\(\)/u
  );
  assert.match(
    source,
    /elements\.reloadStream\.addEventListener[\s\S]*reloadActivePlayerFrame\(\)/u
  );
});

test("컷 단축키는 document에서만 동작하고 미디어·입력·IME·수정키 보호를 유지한다", () => {
  const documentSurface = { tagName: "DIV" };
  const streamVideo = { tagName: "VIDEO" };
  const textInput = { tagName: "INPUT" };
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "Process",
    code: "KeyE",
    target: documentSurface
  }), "E");
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "e",
    code: "KeyE",
    target: streamVideo
  }), null);
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "e",
    code: "KeyE",
    ctrlKey: true,
    target: documentSurface
  }), null);
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "Process",
    code: "KeyE",
    isComposing: true,
    target: documentSurface
  }), null);
  assert.equal(studioCaptureShortcutLetterFromEvent({
    key: "e",
    code: "KeyE",
    target: textInput
  }), null);
});

test("T는 현재 행을 검증·확정하고 빈 다음 행을 만들며 빈 draft는 제출에서 제외한다", async () => {
  const source = await readFile(
    new URL("../src/web/main.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /function finalizeCurrentDraftRow[\s\S]*endSeconds - startSeconds < MINIMUM_SELECTION_SECONDS[\s\S]*row\.dataset\.finalized = "true"[\s\S]*addClipRow\(\)/u
  );
  assert.match(
    source,
    /const populatedRows = clipRows\(\)\.filter[\s\S]*startInput\.value\.trim\(\)[\s\S]*const segments = populatedRows\.map/u
  );
});

test("A는 화면 아래의 단일 편집기 CTA와 같은 검증 경로를 사용한다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  assert.match(source, /case "open-editor":[\s\S]*elements\.startEditor\.click\(\)/u);
  assert.match(
    html,
    /id="start-editor"[^>]*aria-keyshortcuts="A"[^>]*>편집기 열기<\/button>/u
  );
  assert.doesNotMatch(html, /id="(?:open-editor|create-codex-job)"/u);
  const queuedActions = source.slice(
    source.indexOf("async function runQueuedSourceClockAction"),
    source.indexOf("function runStudioCaptureAction")
  );
  assert.match(
    queuedActions,
    /case "open-editor":[\s\S]*elements\.startEditor\.click\(\)/u,
    "빠른 E/R/T/A 입력도 캡처 상태 뒤에 직렬화돼야 합니다."
  );
});

test("YouTube 시계는 공식 YT.Player getter만 안전하게 읽는다", () => {
  assert.equal(YOUTUBE_IFRAME_API_SCRIPT_URL, "https://www.youtube.com/iframe_api");
  const player = {
    getCurrentTime: () => 12.5,
    getDuration: () => 80,
    getPlaybackRate: () => 2,
    getPlayerState: () => 1
  } as YouTubeIframePlayer;
  assert.deepEqual(readYouTubePlayerSnapshot(player), {
    currentTime: 12.5,
    duration: 80,
    playbackRate: 2,
    playerState: 1
  });
  assert.equal(readYouTubePlayerSnapshot({
    ...player,
    getCurrentTime: () => {
      throw new Error("not ready");
    }
  }), null);
});

test("YouTube 제어는 raw 메시지가 아니라 공식 lazy YT.Player 계약을 쓴다", async () => {
  const [source, adapter] = await Promise.all([
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/web/youtube-iframe-api.ts", import.meta.url), "utf8")
  ]);
  assert.match(adapter, /https:\/\/www\.youtube\.com\/iframe_api/u);
  assert.match(adapter, /script\.referrerPolicy = "strict-origin-when-cross-origin"/u);
  assert.match(source, /new api\.Player\(frame/u);
  assert.match(source, /player\.seekTo\(target, true\)/u);
  assert.match(source, /player\.setPlaybackRate\(playbackRate\)/u);
  assert.doesNotMatch(source, /postMessage|infoDelivery|youtubeIframeCommandMessage/u);
});

test("멈춘 YouTube API load는 제한 시간 뒤 정리되고 새 script로 재시도된다", async (t) => {
  assert.equal(YOUTUBE_IFRAME_API_LOAD_TIMEOUT_MS, 15_000);
  const originalDescriptors = new Map(
    ["window", "document", "HTMLScriptElement"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name)
    ])
  );
  const scripts = new Map<string, FakeScriptElement>();
  class FakeScriptElement {
    id = "";
    src = "";
    async = false;
    referrerPolicy = "";
    readonly listeners = new Map<string, Set<() => void>>();

    addEventListener(type: string, listener: () => void): void {
      const callbacks = this.listeners.get(type) ?? new Set<() => void>();
      callbacks.add(listener);
      this.listeners.set(type, callbacks);
    }

    removeEventListener(type: string, listener: () => void): void {
      this.listeners.get(type)?.delete(listener);
    }

    remove(): void {
      if (scripts.get(this.id) === this) {
        scripts.delete(this.id);
      }
    }
  }
  let previousReadyCalls = 0;
  const previousReady = (): void => {
    previousReadyCalls += 1;
  };
  const fakeWindow: Record<string, unknown> = {
    onYouTubeIframeAPIReady: previousReady,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  };
  const fakeDocument = {
    getElementById: (id: string) => scripts.get(id) ?? null,
    createElement: (tagName: string) => {
      assert.equal(tagName, "script");
      return new FakeScriptElement();
    },
    head: {
      append: (script: FakeScriptElement) => {
        scripts.set(script.id, script);
      }
    }
  };
  for (const [name, value] of [
    ["window", fakeWindow],
    ["document", fakeDocument],
    ["HTMLScriptElement", FakeScriptElement]
  ] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value
    });
  }
  t.after(() => {
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  const stalled = loadYouTubeIframeApi({ timeoutMs: 5 });
  const firstScript = scripts.get("kirinuki-youtube-iframe-api");
  assert.ok(firstScript);
  await assert.rejects(stalled, /5ms 안에 준비되지 않았습니다/u);
  assert.equal(scripts.size, 0, "시간 초과 script가 DOM에 남았습니다.");
  assert.equal(fakeWindow.onYouTubeIframeAPIReady, previousReady);
  assert.equal(previousReadyCalls, 0);

  const retried = loadYouTubeIframeApi({ timeoutMs: 30 });
  const secondScript = scripts.get("kirinuki-youtube-iframe-api");
  assert.ok(secondScript);
  assert.notEqual(secondScript, firstScript);
  const fakeApi = { Player: class FakePlayer {} };
  fakeWindow.YT = fakeApi;
  const ready = fakeWindow.onYouTubeIframeAPIReady;
  assert.equal(typeof ready, "function");
  (ready as () => void)();
  assert.equal(await retried, fakeApi);
  assert.equal(fakeWindow.onYouTubeIframeAPIReady, previousReady);
  assert.equal(previousReadyCalls, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(
    scripts.get("kirinuki-youtube-iframe-api"),
    secondScript,
    "성공한 재시도의 오래된 timeout이 새 script를 지웠습니다."
  );
});

test("세 플랫폼의 컷 제어는 YouTube API 또는 client-only streaming bridge만 사용한다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  assert.match(
    html,
    /이 화면에서는 영상을 내려받지 않습니다[\s\S]*선택한 구간은 편집기를 열 때 이 PC에 준비합니다/u
  );
  assert.doesNotMatch(
    html,
    /local-preview-video|local-preview-anchor|prepare-local-preview/u
  );
  for (const targetId of [
    "capture-start",
    "capture-end",
    "seek-backward-five",
    "seek-forward-five",
    "playback-rate-quarter",
    "playback-rate-double"
  ]) {
    assert.match(html, new RegExp(`id="${targetId}"[^>]*disabled`, "u"));
  }
  assert.match(
    source,
    /activeStreamPlatform === SOURCE_PLATFORM_YOUTUBE[\s\S]*youtubePlayerReady/u
  );
  assert.match(
    source,
    /function currentStreamingSourceIdentity[\s\S]*SOURCE_PLATFORM_CHZZK[\s\S]*SOURCE_PLATFORM_SOOP[\s\S]*SOURCE_PLATFORM_YOUTUBE[\s\S]*createStreamingBridgeSourceIdentity/u
  );
  assert.match(
    source,
    /createStreamingBridgeWindowTransport\([\s\S]*new StreamingBridgeClient\([\s\S]*requestTimeoutMs/u
  );
  assert.match(
    source,
    /async function captureCurrentPlayerTime[\s\S]*runTransientSafeStreamingAction\([\s\S]*client\.snapshot\(\)/u
  );
  assert.match(
    source,
    /async function seekPlayerBy[\s\S]*const before = await runTransientSafeStreamingAction\([\s\S]*client\.snapshot\(\)[\s\S]*client\.seekAbsolute\(target\)/u
  );
  assert.match(
    source,
    /async function setPlayerRate[\s\S]*client\.setPlaybackRate\(playbackRate\)/u
  );
  assert.match(source, /resetYouTubeIframePlayer\(\{ replaceFrame: true \}\)/u);
  assert.match(source, /generation !== youtubePlayerGeneration/u);
  assert.doesNotMatch(
    source,
    /LOCAL_VOD_COMPANION_ENDPOINT|startChzzkVodMaterialization|waitForChzzkVodMaterialization|localPreviewVideo/u
  );
  assert.doesNotMatch(source, /fetch\([^\n]*(?:youtube|chzzk|soop)/iu);
  assert.doesNotMatch(source, /setInterval\([^\n]*(?:fake|localClock)/iu);
});
