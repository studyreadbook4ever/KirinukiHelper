import assert from "node:assert/strict";

import {
  app,
  BrowserWindow,
  ipcMain,
  session
} from "electron";
import type {
  Event as ElectronEvent,
  Input as ElectronInput,
  IpcMainInvokeEvent,
  WebFrameMain
} from "electron";

import {
  CUT_WINDOW_BIND_DOCUMENT_CHANNEL,
  CUT_WINDOW_HANDOFF_CHANNEL,
  CUT_WINDOW_PLAYER_ACTION_CHANNEL,
  CUT_WINDOW_SHORTCUT_CHANNEL,
  CUT_WINDOW_URL
} from "../src/desktop/cut-window-contract.js";

declare const __KIRINUKI_SMOKE_FRAME_ACTION_SOURCE__: string;
declare const __KIRINUKI_SMOKE_PRELOAD_PATH__: string;
declare const __KIRINUKI_SMOKE_SHORTCUT_GUARD_SOURCE__: string;

const RESULT_PREFIX = "KIRINUKI_CUT_WINDOW_ELECTRON_SMOKE=";
const FRAME_ACTION_SOURCE = __KIRINUKI_SMOKE_FRAME_ACTION_SOURCE__;
const PRELOAD_PATH = __KIRINUKI_SMOKE_PRELOAD_PATH__;
const SHORTCUT_GUARD_SOURCE = __KIRINUKI_SMOKE_SHORTCUT_GUARD_SOURCE__;
const DOCUMENT_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RESPONSE_SCHEMA = "kirinuki-electron-frame-action/v1";
const FRAME_WAIT_TIMEOUT_MS = 10_000;

const frameFixtures = Object.freeze([
  Object.freeze({
    platform: "CHZZK" as const,
    contentId: "169475287",
    url: "https://chzzk.naver.com/video/169475287",
    initialSeconds: 12.5,
    seekSeconds: 37.25
  }),
  Object.freeze({
    platform: "YOUTUBE" as const,
    contentId: "dQw4w9WgXcQ",
    url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1",
    initialSeconds: 12.5,
    seekSeconds: 37.25
  }),
  Object.freeze({
    platform: "SOOP" as const,
    contentId: "296331085",
    url: "https://vod.sooplive.com/player/296331085/embed?autoPlay=true&mutePlay=true&showChat=false",
    initialSeconds: 125,
    seekSeconds: 245
  })
]);

type Fixture = (typeof frameFixtures)[number];

const handoffSubmission = Object.freeze({
  schema: "kirinuki-editor-handoff-submission/v1",
  confirmedAt: "2026-08-22T00:00:00.000Z",
  acknowledgements: Object.freeze({
    vodCovered: true,
    localAcquisitionAndEditing: true,
    publicationIsSeparate: true,
    thirdPartyRights: true,
    platformTermsAndNoCircumvention: true,
    userResponsibility: true
  }),
  captureSeed: Object.freeze({
    source: Object.freeze({
      platform: "YOUTUBE",
      channelId: "",
      contentId: "dQw4w9WgXcQ",
      contentType: "vod",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      broadcastTitle: "0520 히오스"
    }),
    projectName: "0520 히오스",
    segments: Object.freeze([Object.freeze({
      id: "12345678-1234-1234-1234-123456789abc",
      startSeconds: 80.5,
      endSeconds: 85.5,
      description: "첫 구간",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z"
    })])
  })
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = FRAME_WAIT_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await delay(20);
  }
  throw new Error(message);
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), label);
  return value as Record<string, unknown>;
}

function htmlVideoFixture(): string {
  return String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><title>HTML video fixture</title></head>
<body>
  <video id="player" tabindex="0" style="display:block;width:1280px;height:720px"></video>
  <input id="edit-input" value="">
  <textarea id="edit-textarea"></textarea>
  <div id="edit-content" contenteditable="true"></div>
  <div id="shadow-host"></div>
  <script>
    (() => {
      "use strict";
      const video = document.getElementById("player");
      const state = { currentTime: 12.5, playbackRate: 1 };
      Object.defineProperties(video, {
        currentTime: {
          configurable: true,
          get: () => state.currentTime,
          set: (value) => { state.currentTime = Number(value); }
        },
        duration: { configurable: true, get: () => 180 },
        paused: { configurable: true, get: () => true },
        playbackRate: {
          configurable: true,
          get: () => state.playbackRate,
          set: (value) => { state.playbackRate = Number(value); }
        },
        readyState: { configurable: true, get: () => 4 },
        seeking: { configurable: true, get: () => false },
        seekable: {
          configurable: true,
          get: () => ({
            length: 1,
            start: (index) => {
              if (index !== 0) throw new DOMException("Index", "IndexSizeError");
              return 0;
            },
            end: (index) => {
              if (index !== 0) throw new DOMException("Index", "IndexSizeError");
              return 180;
            }
          })
        }
      });
      video.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 1280,
        bottom: 720,
        left: 0,
        width: 1280,
        height: 720,
        toJSON: () => ({})
      });
      Object.defineProperty(window, "__kirinukiFixtureState", {
        configurable: false,
        enumerable: false,
        value: state,
        writable: false
      });
      const nativeProbe = {
        codes: [],
        capture: [],
        fullscreen: 0,
        theater: 0
      };
      window.addEventListener("keydown", (event) => {
        nativeProbe.capture.push({
          code: event.code,
          isTrusted: event.isTrusted,
          target: event.target?.tagName || "",
          path: event.composedPath().map((value) => value?.tagName || "")
        });
      }, { capture: true });
      window.addEventListener("keydown", (event) => {
        nativeProbe.codes.push(event.code);
        if (event.code === "KeyF") nativeProbe.fullscreen += 1;
        if (event.code === "KeyT") nativeProbe.theater += 1;
      });
      const shadowRoot = document.getElementById("shadow-host")
        .attachShadow({ mode: "open" });
      const shadowInput = document.createElement("input");
      shadowInput.id = "shadow-input";
      shadowRoot.append(shadowInput);
      Object.defineProperty(window, "__kirinukiNativeProbe", {
        configurable: false,
        enumerable: false,
        value: nativeProbe,
        writable: false
      });
    })();
  </script>
</body>
</html>`;
}

function soopVideoFixture(): string {
  return String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><title>SOOP video fixture</title></head>
<body>
  <video id="player" style="display:block;width:1280px;height:720px"></video>
  <script>
    (() => {
      "use strict";
      const parts = Object.freeze([
        Object.freeze({
          idx: 0,
          file_order: 1,
          id: "20260813_957F0226_296331085_1",
          duration: 100
        }),
        Object.freeze({
          idx: 1,
          file_order: 2,
          id: "20260813_2E5CCAED_296331085_2",
          duration: 200
        })
      ]);
      const state = { currentIndex: 1, localTime: 25, playbackRate: 1 };
      const partStart = (index) => parts
        .slice(0, index)
        .reduce((sum, part) => sum + part.duration, 0);
      const video = document.getElementById("player");
      Object.defineProperties(video, {
        currentTime: {
          configurable: true,
          get: () => state.localTime,
          set: (value) => { state.localTime = Number(value); }
        },
        duration: {
          configurable: true,
          get: () => parts[state.currentIndex].duration + 0.5
        },
        paused: { configurable: true, get: () => true },
        playbackRate: {
          configurable: true,
          get: () => state.playbackRate,
          set: (value) => { state.playbackRate = Number(value); }
        },
        readyState: { configurable: true, get: () => 4 },
        seeking: { configurable: true, get: () => false },
        seekable: {
          configurable: true,
          get: () => ({
            length: 1,
            start: (index) => {
              if (index !== 0) throw new DOMException("Index", "IndexSizeError");
              return 0;
            },
            end: (index) => {
              if (index !== 0) throw new DOMException("Index", "IndexSizeError");
              return parts[state.currentIndex].duration;
            }
          })
        }
      });
      video.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 1280,
        bottom: 720,
        left: 0,
        width: 1280,
        height: 720,
        toJSON: () => ({})
      });
      const controller = {
        get fileItems() { return parts; },
        get playIdx() { return state.currentIndex; },
        get currentFileItem() { return parts[state.currentIndex]; },
        get playingTime() {
          return partStart(state.currentIndex) + state.localTime;
        },
        get media() { return video; },
        get isChangeFileSeeking() { return false; },
        get isSeeking() { return false; },
        get isPreloadingNextMedia() { return false; }
      };
      const core = {
        fileItems: parts,
        playerController: controller,
        config: Object.freeze({ titleNo: "296331085", totalFileDuration: 300 }),
        seek(targetSeconds) {
          const target = Number(targetSeconds);
          state.currentIndex = target === 300 || target >= 100 ? 1 : 0;
          state.localTime = target - partStart(state.currentIndex);
        }
      };
      Object.defineProperty(window, "vodCore", {
        configurable: false,
        enumerable: true,
        value: core,
        writable: false
      });
      Object.defineProperty(window, "__kirinukiFixtureState", {
        configurable: false,
        enumerable: false,
        value: state,
        writable: false
      });
    })();
  </script>
</body>
</html>`;
}

function cutHostFixture(): string {
  const frames = frameFixtures.map(({ platform, url }) => (
    `<iframe title="${platform}" src="${url}"></iframe>`
  )).join("\n");
  const serializedHandoff = JSON.stringify(handoffSubmission);
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Kirinuki cut smoke</title></head>
<body>
  ${frames}
  <script>
    (() => {
      "use strict";
      const api = globalThis.kirinukiCutHost;
      globalThis.__kirinukiPreloadProbe = {
        apiKeys: api ? Object.keys(api).sort() : [],
        requireType: typeof globalThis.require,
        processType: typeof globalThis.process,
        subscriptionCreated: false,
        handoffStatus: "idle",
        handoffError: null,
        error: null
      };
      try {
        const unsubscribe = api.onTrustedShortcut((message) => {
          if (message.key !== "A") return;
          api.handoffEditor(${serializedHandoff}).then((result) => {
            globalThis.__kirinukiPreloadProbe.handoffStatus = result.status;
          }).catch((error) => {
            globalThis.__kirinukiPreloadProbe.handoffStatus = "failed";
            globalThis.__kirinukiPreloadProbe.handoffError = String(error);
          });
        });
        globalThis.__kirinukiPreloadProbe.subscriptionCreated = true;
        globalThis.__kirinukiPreloadProbe.unsubscribe = unsubscribe;
      } catch (error) {
        globalThis.__kirinukiPreloadProbe.error = String(error);
      }
      globalThis.__kirinukiAttemptHandoffWithoutActivation = () => (
        api.handoffEditor(${serializedHandoff}).then(
          () => ({ status: "unexpected-success" }),
          (error) => ({ status: "rejected", error: String(error) })
        )
      );
      globalThis.__kirinukiInvalidate = (transportEpoch) => (
        api.playerAction({ type: "invalidate", transportEpoch })
      );
    })();
  </script>
</body>
</html>`;
}

function fixtureResponse(request: Request): Response {
  let body: string | null = null;
  if (request.url === CUT_WINDOW_URL) {
    body = cutHostFixture();
  } else if (request.url === frameFixtures[0]!.url) {
    body = htmlVideoFixture();
  } else if (request.url === frameFixtures[1]!.url) {
    body = htmlVideoFixture();
  } else if (request.url === frameFixtures[2]!.url) {
    body = soopVideoFixture();
  }
  return new Response(body ?? "not found", {
    status: body === null ? 404 : 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function waitForDirectFrame(
  mainFrame: WebFrameMain,
  expectedUrl: string
): Promise<WebFrameMain> {
  const deadline = Date.now() + FRAME_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const found = mainFrame.frames.find((frame) => (
      !frame.isDestroyed()
      && frame.parent === mainFrame
      && frame.url === expectedUrl
    ));
    if (found) {
      const readyState = await found.executeJavaScript("document.readyState");
      if (readyState === "complete") {
        return found;
      }
    }
    await delay(25);
  }
  throw new Error(`exact direct fixture frame을 기다리지 못했습니다: ${expectedUrl}`);
}

async function executeFrameAction(
  frame: WebFrameMain,
  fixture: Fixture,
  action: Readonly<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const sourceBefore = frame.url;
  const result = await frame.executeJavaScript(
    `${FRAME_ACTION_SOURCE}\n;KirinukiStreamingFrameAction.executeKirinukiStreamingFrameAction(${JSON.stringify(action)})`,
    false
  );
  assert.equal(frame.url, sourceBefore, "frame action 중 fixture URL이 바뀌었습니다.");
  const response = exactRecord(result, `${fixture.platform} frame action 응답`);
  assert.deepEqual(
    Object.keys(response).sort(),
    ["contentId", "platform", "player", "schema"],
    `${fixture.platform} frame action 응답 필드가 exact하지 않습니다.`
  );
  assert.equal(response.schema, RESPONSE_SCHEMA);
  assert.equal(response.platform, fixture.platform);
  assert.equal(response.contentId, fixture.contentId);
  return response;
}

async function installShortcutGuard(
  frame: WebFrameMain,
  fixture: Fixture
): Promise<void> {
  const sourceBefore = frame.url;
  const result = exactRecord(
    await frame.executeJavaScript(
      `"use strict";${SHORTCUT_GUARD_SOURCE}\n;KirinukiStreamingShortcutGuard.installKirinukiCutShortcutGuard(globalThis)`,
      false
    ),
    `${fixture.platform} shortcut guard 설치 응답`
  );
  assert.equal(frame.url, sourceBefore);
  assert.deepEqual(Object.keys(result).sort(), ["marker", "status"]);
  assert.equal(result.status, "installed");
  assert.equal(result.marker, "kirinuki-cut-shortcut-guard/v1");
}

function assertPlayerSnapshot(
  response: Record<string, unknown>,
  expectedSeconds: number,
  expectedRate: number,
  label: string
): Record<string, unknown> {
  const player = exactRecord(response.player, `${label} player snapshot`);
  assert.equal(player.found, true, `${label} player를 찾지 못했습니다.`);
  assert.equal(player.currentTime, expectedSeconds, `${label} currentTime 불일치`);
  assert.equal(player.playbackRate, expectedRate, `${label} playbackRate 불일치`);
  assert.equal(player.readyState, 4, `${label} readyState 불일치`);
  return player;
}

async function verifyFrame(
  mainFrame: WebFrameMain,
  fixture: Fixture
): Promise<Readonly<Record<string, unknown>>> {
  const frame = await waitForDirectFrame(mainFrame, fixture.url);
  assert.equal(frame.top, mainFrame, `${fixture.platform} top frame binding 불일치`);
  await installShortcutGuard(frame, fixture);

  const snapshot = await executeFrameAction(frame, fixture, { action: "snapshot" });
  const initialPlayer = assertPlayerSnapshot(
    snapshot,
    fixture.initialSeconds,
    1,
    `${fixture.platform} snapshot`
  );
  if (fixture.platform === "SOOP") {
    const clockIdentity = exactRecord(
      initialPlayer.sourceClockIdentity,
      "SOOP source clock identity"
    );
    assert.equal(clockIdentity.platform, "SOOP");
    assert.equal(clockIdentity.contentId, fixture.contentId);
    assert.equal(clockIdentity.totalDurationSeconds, 300);
  }

  const seek = await executeFrameAction(frame, fixture, {
    action: "seek-absolute",
    targetSeconds: fixture.seekSeconds
  });
  assertPlayerSnapshot(
    seek,
    fixture.seekSeconds,
    1,
    `${fixture.platform} seek`
  );

  const playbackRate = await executeFrameAction(frame, fixture, {
    action: "set-playback-rate",
    playbackRate: 2
  });
  assertPlayerSnapshot(
    playbackRate,
    fixture.seekSeconds,
    2,
    `${fixture.platform} playback rate`
  );

  return Object.freeze({
    contentId: fixture.contentId,
    directFrame: true,
    initialSeconds: fixture.initialSeconds,
    playbackRate: 2,
    seekSeconds: fixture.seekSeconds
  });
}

async function focusFrameTarget(
  cutWindow: BrowserWindow,
  frame: WebFrameMain,
  selector: "#player" | "#edit-input" | "#edit-textarea" | "#edit-content"
    | "#shadow-input"
): Promise<void> {
  cutWindow.show();
  cutWindow.focus();
  cutWindow.webContents.focus();
  await frame.executeJavaScript(`(() => {
    const selector = ${JSON.stringify(selector)};
    const target = selector === "#shadow-input"
      ? document.querySelector("#shadow-host")?.shadowRoot?.querySelector("input")
      : document.querySelector(selector);
    if (!target) throw new Error("focus fixture target missing");
    target.focus();
  })()`);
  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    const targetFocused = await frame.executeJavaScript(`(() => {
      const selector = ${JSON.stringify(selector)};
      if (selector === "#shadow-input") {
        return document.activeElement?.id === "shadow-host"
          && document.activeElement.shadowRoot?.activeElement?.id === "shadow-input";
      }
      return document.activeElement?.matches(selector) === true;
    })()`);
    if (cutWindow.webContents.focusedFrame === frame && targetFocused === true) {
      return;
    }
    await delay(20);
  }
  throw new Error(`fixture target focus가 direct frame으로 가지 않았습니다: ${selector}`);
}

async function sendPhysicalKey(
  cutWindow: BrowserWindow,
  expectedFrame: WebFrameMain,
  letter: "A" | "E" | "F" | "R" | "T"
): Promise<Readonly<ElectronInput>> {
  const observations: ElectronInput[] = [];
  const listener = (_event: ElectronEvent, input: ElectronInput): void => {
    if (
      input.type === "keyDown"
      && cutWindow.webContents.focusedFrame === expectedFrame
    ) {
      observations.push(input);
    }
  };
  cutWindow.webContents.on("before-input-event", listener);
  try {
    if (!cutWindow.webContents.debugger.isAttached()) {
      cutWindow.webContents.debugger.attach("1.3");
    }
    await cutWindow.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: letter.toLowerCase(),
      code: `Key${letter}`,
      windowsVirtualKeyCode: letter.charCodeAt(0),
      nativeVirtualKeyCode: letter.charCodeAt(0)
    });
    await cutWindow.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: letter.toLowerCase(),
      code: `Key${letter}`,
      windowsVirtualKeyCode: letter.charCodeAt(0),
      nativeVirtualKeyCode: letter.charCodeAt(0)
    });
    await delay(40);
  } finally {
    cutWindow.webContents.removeListener("before-input-event", listener);
  }
  if (observations.length === 1) {
    const input = observations[0]!;
    assert.equal(input.code, `Key${letter}`);
    assert.equal(input.isAutoRepeat, false);
    assert.equal(input.isComposing, false);
    return input;
  }
  return Object.freeze({
    type: "keyDown",
    key: letter.toLowerCase(),
    code: `Key${letter}`,
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: []
  });
}

async function verifyWebContentsPhysicalInput(
  cutWindow: BrowserWindow,
  frame: WebFrameMain
): Promise<Readonly<Record<string, unknown>>> {
  await focusFrameTarget(cutWindow, frame, "#player");
  const observed: ElectronInput[] = [];
  const listener = (_event: ElectronEvent, input: ElectronInput): void => {
    if (
      input.type === "keyDown"
      && cutWindow.webContents.focusedFrame === frame
      && (input.code === "KeyF" || input.code === "KeyT")
    ) {
      observed.push(input);
    }
  };
  cutWindow.webContents.on("before-input-event", listener);
  try {
    for (const letter of ["F", "T"] as const) {
      cutWindow.webContents.sendInputEvent({
        type: "rawKeyDown",
        keyCode: letter
      });
      cutWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: letter });
      await delay(40);
    }
  } finally {
    cutWindow.webContents.removeListener("before-input-event", listener);
  }
  assert.deepEqual(
    observed.map(({ code }) => code),
    ["KeyF", "KeyT"],
    "webContents.sendInputEvent physical F/T가 main 입력 경로에 exact 1회씩 오지 않았습니다."
  );
  assert.ok(observed.every(({ isAutoRepeat, isComposing }) => (
    isAutoRepeat === false && isComposing === false
  )));
  return Object.freeze({
    codes: Object.freeze(observed.map(({ code }) => code)),
    exactOnce: true
  });
}

async function nativeProbe(frame: WebFrameMain): Promise<Readonly<{
  codes: readonly string[];
  capture: readonly unknown[];
  fullscreen: number;
  theater: number;
}>> {
  const result = exactRecord(
    await frame.executeJavaScript(`({
      codes: [...globalThis.__kirinukiNativeProbe.codes],
      capture: structuredClone(globalThis.__kirinukiNativeProbe.capture),
      fullscreen: globalThis.__kirinukiNativeProbe.fullscreen,
      theater: globalThis.__kirinukiNativeProbe.theater
    })`),
    "platform native shortcut probe"
  );
  assert.ok(Array.isArray(result.codes));
  return Object.freeze({
    codes: Object.freeze([...(result.codes as string[])]),
    capture: Object.freeze([...(result.capture as unknown[])]),
    fullscreen: Number(result.fullscreen),
    theater: Number(result.theater)
  });
}

async function resetNativeProbe(frame: WebFrameMain): Promise<void> {
  await frame.executeJavaScript(`(() => {
    globalThis.__kirinukiNativeProbe.codes.length = 0;
    globalThis.__kirinukiNativeProbe.capture.length = 0;
    globalThis.__kirinukiNativeProbe.fullscreen = 0;
    globalThis.__kirinukiNativeProbe.theater = 0;
  })()`);
}

async function verifyShortcutSuppression(
  cutWindow: BrowserWindow,
  frame: WebFrameMain
): Promise<Readonly<Record<string, unknown>>> {
  await resetNativeProbe(frame);
  await focusFrameTarget(cutWindow, frame, "#player");
  for (const letter of ["E", "R", "F", "T", "A"] as const) {
    await sendPhysicalKey(cutWindow, frame, letter);
  }
  const suppressed = await nativeProbe(frame);
  assert.deepEqual(
    suppressed.codes,
    [],
    "non-editable player key가 platform native listener까지 도달했습니다."
  );
  assert.equal(suppressed.fullscreen, 0, "platform native F가 함께 실행됐습니다.");
  assert.equal(suppressed.theater, 0, "platform native T가 함께 실행됐습니다.");
  assert.deepEqual(
    suppressed.capture.map((entry) => exactRecord(entry, "trusted capture").code),
    ["KeyE", "KeyR", "KeyF", "KeyT", "KeyA"]
  );
  assert.ok(suppressed.capture.every((entry) => (
    exactRecord(entry, "trusted capture").isTrusted === true
  )), "renderer guard 검증 입력이 trusted event가 아닙니다.");

  const editableSelectors = [
    "#edit-input",
    "#edit-textarea",
    "#edit-content",
    "#shadow-input"
  ] as const;
  const editableEvidence: Record<string, readonly string[]> = {};
  for (const selector of editableSelectors) {
    await resetNativeProbe(frame);
    await focusFrameTarget(cutWindow, frame, selector);
    await sendPhysicalKey(cutWindow, frame, "F");
    const preserved = await nativeProbe(frame);
    assert.deepEqual(
      preserved.codes,
      ["KeyF"],
      `${selector} 입력에서 key가 보존되지 않았습니다: ${JSON.stringify(preserved.capture)}`
    );
    assert.equal(preserved.capture.length, 1);
    assert.equal(
      exactRecord(preserved.capture[0], `${selector} capture`).isTrusted,
      true
    );
    editableEvidence[selector] = preserved.codes;
  }

  const pureGuardEvidence = exactRecord(
    await frame.executeJavaScript(`(() => {
      const base = {
        type: "keydown",
        isTrusted: true,
        code: "KeyF",
        repeat: false,
        isComposing: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target: document.querySelector("#player"),
        composedPath: () => [document.querySelector("#player")]
      };
      return {
        koreanPhysicalCode: KirinukiStreamingShortcutGuard
          .trustedCutShortcutEventCode({ ...base, key: "ㄹ" }),
        imeComposing: KirinukiStreamingShortcutGuard
          .trustedCutShortcutEventCode({ ...base, isComposing: true })
      };
    })()`),
    "physical-code/IME guard evidence"
  );
  assert.equal(pureGuardEvidence.koreanPhysicalCode, "KeyF");
  assert.equal(pureGuardEvidence.imeComposing, null);
  if (cutWindow.webContents.debugger.isAttached()) {
    cutWindow.webContents.debugger.detach();
  }

  return Object.freeze({
    editablePreserved: editableEvidence,
    imeComposingSuppressed: true,
    kirinukiPhysicalDeliveries: 5,
    koreanLayoutPhysicalCode: "KeyF",
    nativeFullscreen: 0,
    nativeTheater: 0
  });
}

async function runElectronSmoke(): Promise<void> {
  assert.ok(app.commandLine.hasSwitch("headless"), "headless 실행 인자가 없습니다.");
  await app.whenReady();

  const fixtureSession = session.fromPartition(
    `kirinuki-cut-electron-smoke-${process.pid}-${Date.now()}`,
    { cache: false }
  );
  fixtureSession.setPermissionCheckHandler(() => false);
  fixtureSession.setPermissionRequestHandler((_webContents, _permission, reply) => {
    reply(false);
  });
  fixtureSession.on("will-download", (event) => event.preventDefault());
  fixtureSession.protocol.handle("https", fixtureResponse);

  let cutWindow: BrowserWindow | null = null;
  let bindingCount = 0;
  let documentGeneration = 0;
  let boundNonce: string | null = null;
  const boundNonces: string[] = [];
  let handoffCount = 0;
  let playerActionCount = 0;
  let bindingResolve: (() => void) | null = null;
  const bindingReady = new Promise<void>((resolve) => {
    bindingResolve = resolve;
  });

  ipcMain.handle(
    CUT_WINDOW_BIND_DOCUMENT_CHANNEL,
    (event: IpcMainInvokeEvent, nonce: unknown) => {
      assert.ok(cutWindow && !cutWindow.isDestroyed(), "binding 중 cut window가 없습니다.");
      assert.equal(event.sender, cutWindow.webContents, "다른 WebContents가 binding을 요청했습니다.");
      assert.equal(
        event.senderFrame,
        cutWindow.webContents.mainFrame,
        "하위 frame이 cut document binding을 요청했습니다."
      );
      assert.equal(event.senderFrame.url, CUT_WINDOW_URL, "binding main document URL이 다릅니다.");
      assert.equal(typeof nonce, "string");
      assert.match(String(nonce), DOCUMENT_NONCE_PATTERN);
      assert.ok(documentGeneration > 0, "binding document generation이 없습니다.");
      if (boundNonce === null) {
        boundNonce = String(nonce);
        boundNonces.push(boundNonce);
        bindingCount += 1;
      } else {
        assert.equal(String(nonce), boundNonce, "같은 문서가 다른 nonce로 재binding했습니다.");
      }
      bindingResolve?.();
      return Object.freeze({
        status: "bound",
        windowGeneration: 1,
        documentGeneration
      });
    }
  );
  const exactCurrentDocumentIpc = (
    event: IpcMainInvokeEvent,
    nonce: unknown
  ): boolean => Boolean(
    cutWindow
    && !cutWindow.isDestroyed()
    && event.sender === cutWindow.webContents
    && event.senderFrame === cutWindow.webContents.mainFrame
    && event.senderFrame.url === CUT_WINDOW_URL
    && typeof nonce === "string"
    && nonce === boundNonce
  );
  ipcMain.handle(
    CUT_WINDOW_HANDOFF_CHANNEL,
    (event: IpcMainInvokeEvent, submission: unknown, nonce: unknown) => {
      assert.equal(exactCurrentDocumentIpc(event, nonce), true, "handoff nonce가 current document와 다릅니다.");
      assert.deepEqual(submission, handoffSubmission);
      handoffCount += 1;
      return Object.freeze({ status: "acknowledged", handoffGeneration: handoffCount });
    }
  );
  ipcMain.handle(
    CUT_WINDOW_PLAYER_ACTION_CHANNEL,
    (event: IpcMainInvokeEvent, _envelope: unknown, nonce: unknown) => {
      assert.equal(exactCurrentDocumentIpc(event, nonce), true, "player action nonce가 current document와 다릅니다.");
      playerActionCount += 1;
      return Object.freeze({ status: "accepted", documentGeneration });
    }
  );

  try {
    cutWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: fixtureSession,
        preload: PRELOAD_PATH,
        webSecurity: true
      }
    });
    cutWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    cutWindow.webContents.on("did-start-navigation", (details) => {
      if (
        details.isMainFrame
        && !details.isSameDocument
        && details.url === CUT_WINDOW_URL
      ) {
        documentGeneration += 1;
        boundNonce = null;
      }
    });
    await cutWindow.loadURL(CUT_WINDOW_URL);

    await Promise.race([
      bindingReady,
      delay(FRAME_WAIT_TIMEOUT_MS).then(() => {
        throw new Error("sandboxed preload document binding이 제한 시간 안에 오지 않았습니다.");
      })
    ]);
    assert.equal(bindingCount, 1, "document nonce binding이 한 번이 아닙니다.");
    assert.ok(boundNonce);
    assert.match(boundNonce, DOCUMENT_NONCE_PATTERN);

    const preloadProbe = exactRecord(
      await cutWindow.webContents.mainFrame.executeJavaScript(
        "globalThis.__kirinukiPreloadProbe"
      ),
      "sandboxed preload probe"
    );
    assert.deepEqual(preloadProbe.apiKeys, [
      "handoffEditor",
      "onTrustedShortcut",
      "openCanonicalSource",
      "playerAction"
    ]);
    assert.equal(preloadProbe.requireType, "undefined");
    assert.equal(preloadProbe.processType, "undefined");
    assert.equal(preloadProbe.subscriptionCreated, true);
    assert.equal(preloadProbe.error, null);

    const noActivation = exactRecord(
      await cutWindow.webContents.mainFrame.executeJavaScript(
        "globalThis.__kirinukiAttemptHandoffWithoutActivation()",
        false
      ),
      "handoff without user activation"
    );
    assert.equal(noActivation.status, "rejected");
    assert.match(String(noActivation.error), /직접 누르거나 검증된 A 단축키/u);
    assert.equal(handoffCount, 0, "user activation 없는 handoff가 main IPC까지 왔습니다.");

    cutWindow.webContents.send(CUT_WINDOW_SHORTCUT_CHANNEL, Object.freeze({
      key: "A",
      platform: "YOUTUBE",
      contentId: frameFixtures[1]!.contentId,
      windowGeneration: 1,
      documentGeneration,
      transportEpoch: 1,
      bridgeGeneration: 1
    }));
    await waitUntil(async () => (
      await cutWindow!.webContents.mainFrame.executeJavaScript(
        "globalThis.__kirinukiPreloadProbe.handoffStatus"
      ) === "acknowledged"
    ), "trusted A ticket handoff가 완료되지 않았습니다.");
    assert.equal(handoffCount, 1, "trusted A ticket handoff가 exact 1회가 아닙니다.");

    const spentTicket = exactRecord(
      await cutWindow.webContents.mainFrame.executeJavaScript(
        "globalThis.__kirinukiAttemptHandoffWithoutActivation()",
        false
      ),
      "spent handoff ticket"
    );
    assert.equal(spentTicket.status, "rejected");
    assert.equal(handoffCount, 1, "A ticket이 재사용됐습니다.");

    const platformResults: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const fixture of frameFixtures) {
      platformResults[fixture.platform] = await verifyFrame(
        cutWindow.webContents.mainFrame,
        fixture
      );
    }

    const youtubeFrame = await waitForDirectFrame(
      cutWindow.webContents.mainFrame,
      frameFixtures[1]!.url
    );
    const webContentsPhysicalInput = await verifyWebContentsPhysicalInput(
      cutWindow,
      youtubeFrame
    );
    const shortcutGuard = Object.freeze({
      ...await verifyShortcutSuppression(cutWindow, youtubeFrame),
      webContentsPhysicalInput
    });

    const oldNonce = boundNonce;
    const reloadFinished = new Promise<void>((resolve) => {
      cutWindow!.webContents.once("did-finish-load", () => resolve());
    });
    cutWindow.webContents.reloadIgnoringCache();
    await reloadFinished;
    await waitUntil(
      () => bindingCount === 2,
      "reload 뒤 새 renderer document binding이 오지 않았습니다."
    );
    assert.equal(documentGeneration, 2);
    assert.equal(boundNonces.length, 2);
    assert.notEqual(boundNonce, oldNonce, "reload 뒤 document nonce가 교체되지 않았습니다.");
    assert.equal(
      oldNonce === boundNonce,
      false,
      "old document nonce가 current generation gate를 통과했습니다."
    );
    const invalidation = exactRecord(
      await cutWindow.webContents.mainFrame.executeJavaScript(
        "globalThis.__kirinukiInvalidate(1)"
      ),
      "reload player invalidation"
    );
    assert.equal(invalidation.status, "accepted");
    assert.equal(invalidation.documentGeneration, 2);
    assert.equal(playerActionCount, 1);
    const reloadedChzzkFrame = await waitForDirectFrame(
      cutWindow.webContents.mainFrame,
      frameFixtures[0]!.url
    );
    const reloadSnapshot = await executeFrameAction(
      reloadedChzzkFrame,
      frameFixtures[0]!,
      { action: "snapshot" }
    );
    assertPlayerSnapshot(reloadSnapshot, 12.5, 1, "reload CHZZK snapshot");

    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
      binding: Object.freeze({
        mainFrameOnly: true,
        nonceBytes: 32,
        reloadGeneration: documentGeneration,
        reloadNonceRotated: true,
        sandbox: true
      }),
      electron: process.versions.electron,
      handoff: Object.freeze({
        noActivationRejected: true,
        trustedATicketOneShot: true
      }),
      platforms: platformResults,
      shortcutGuard,
      schema: "kirinuki-cut-window-electron-smoke/v1",
      status: "ok"
    })}\n`);
  } finally {
    ipcMain.removeHandler(CUT_WINDOW_BIND_DOCUMENT_CHANNEL);
    ipcMain.removeHandler(CUT_WINDOW_HANDOFF_CHANNEL);
    ipcMain.removeHandler(CUT_WINDOW_PLAYER_ACTION_CHANNEL);
    fixtureSession.protocol.unhandle("https");
    if (cutWindow && !cutWindow.isDestroyed()) {
      cutWindow.destroy();
    }
  }
}

void runElectronSmoke().then(() => {
  app.exit(0);
}).catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`cut-window Electron smoke 실패: ${detail}\n`);
  app.exit(1);
});
