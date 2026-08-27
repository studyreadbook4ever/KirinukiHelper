import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function boundedSection(
  contents: string,
  startMarker: string,
  endMarker: string
): string {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} 시작을 찾지 못했습니다.`);
  assert.ok(end > start, `${startMarker} 끝을 찾지 못했습니다.`);
  return contents.slice(start, end);
}

test("컷 창 reload는 nonce·player 세대·진행 중 handoff를 원자적으로 폐기한다", async () => {
  const main = await source("src/desktop/main.ts");
  const generation = boundedSection(
    main,
    "function beginCutWindowDocumentGeneration(",
    "async function openCutWindow("
  );
  for (const required of [
    "state.documentGeneration += 1",
    "state.documentReady = false",
    "state.documentNonce = null",
    "state.handoffLaunchUsed = false",
    "state.frameEpoch = 0",
    "state.transportEpoch = 0",
    "state.bridgeGeneration = 0",
    "state.requests.clear()",
    "pendingHandoff.abortController.abort()",
    "pendingHandoff.activeRuntime.cancelEditorHandoff(",
    "pendingHandoff.activeRuntime.editorHandoffStatus(",
    "settleCutWindowHandoffBeforeDocumentReset({"
  ]) {
    assert.match(generation, new RegExp(
      required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      "u"
    ));
  }
  assert.ok(
    generation.indexOf("settleCutWindowHandoffBeforeDocumentReset({")
      < generation.indexOf("state.documentGeneration += 1"),
    "ACK tombstone은 reload 세대 reset보다 먼저 창을 terminal 처리해야 합니다."
  );

  const binding = boundedSection(
    main,
    "ipcMain.handle(CUT_WINDOW_BIND_DOCUMENT_CHANNEL",
    "ipcMain.handle(CUT_WINDOW_HANDOFF_CHANNEL"
  );
  assert.match(binding, /!state\.documentReady/u);
  assert.match(binding, /event\.senderFrame !== window\.webContents\.mainFrame/u);
  assert.match(binding, /state\.documentNonce !== null && state\.documentNonce !== value/u);
  assert.match(binding, /state\.documentNonce = value/u);
  assert.match(binding, /documentGeneration: state\.documentGeneration/u);
});

test("컷 privilege는 document nonce와 직접 사용자 동작 또는 검증된 A ticket에 묶인다", async () => {
  const preload = await source("src/desktop/cut-window-preload.ts");
  const handoff = boundedSection(
    preload,
    "handoffEditor: async (",
    "playerAction: async ("
  );
  const openSource = boundedSection(
    preload,
    "openCanonicalSource: async (",
    "onTrustedShortcut: ("
  );
  assert.ok(
    handoff.indexOf("consumeHandoffAuthorization()")
      < handoff.indexOf("await bindCurrentDocument()"),
    "handoff activation/ticket은 첫 await 전에 소비해야 합니다."
  );
  assert.ok(
    openSource.indexOf('requireActiveUserGesture("원본 페이지 열기")')
      < openSource.indexOf("await bindCurrentDocument()"),
    "외부 원본 열기 activation은 첫 await 전에 검사해야 합니다."
  );
  for (const channel of [
    "CUT_WINDOW_HANDOFF_CHANNEL",
    "CUT_WINDOW_PLAYER_ACTION_CHANNEL",
    "CUT_WINDOW_OPEN_SOURCE_CHANNEL"
  ]) {
    assert.match(preload, new RegExp(`${channel},[\\s\\S]{0,180}documentNonce`, "u"));
  }
  assert.match(
    preload,
    /const ticket = message\.key === "A" \? Symbol\("trusted-A"\) : null;[\s\S]*try \{[\s\S]*listener\(message\);[\s\S]*finally \{[\s\S]*activeTrustedHandoffTicket = null;/u
  );
});

test("handoff 실패는 재시도 가능하지만 ACK tombstone 뒤 실패는 terminal이다", async () => {
  const main = await source("src/desktop/main.ts");
  const handler = boundedSection(
    main,
    "ipcMain.handle(CUT_WINDOW_HANDOFF_CHANNEL",
    "ipcMain.handle(CUT_WINDOW_PLAYER_ACTION_CHANNEL"
  );
  const publish = handler.indexOf("activeRuntime.publishEditorHandoff(submission)");
  const markUsed = handler.indexOf("state.handoffLaunchUsed = true");
  assert.ok(publish >= 0 && markUsed > publish);
  assert.match(
    handler,
    /const handoffStatus = activeRuntime\.editorHandoffStatus\([\s\S]*handoffStatus !== "acknowledged"[\s\S]*state\.handoffLaunchUsed = false;[\s\S]*if \(handoffStatus !== "acknowledged"\) \{[\s\S]*cancelEditorHandoff/u
  );
  assert.match(handler, /destroyAcknowledgedCutWindow/u);
});

test("trusted player shortcut은 installed guard와 exact direct frame·모든 세대가 필요하다", async () => {
  const main = await source("src/desktop/main.ts");
  const input = boundedSection(
    main,
    'window.webContents.on("before-input-event"',
    'window.webContents.on("render-process-gone"'
  );
  for (const required of [
    "focusedFrame.parent !== window.webContents.mainFrame",
    "!identity",
    "actionState.documentReady !== true",
    "actionState.transportEpoch <= 0",
    "actionState.bridgeGeneration <= 0",
    "!guard",
    "guard.url !== focusedFrame.url",
    "guard.documentGeneration !== actionState.documentGeneration",
    "guard.frameEpoch !== actionState.frameEpoch",
    "currentFocusedFrame !== focusedFrame",
    "focusedFrame.url !== frameUrl",
    "editable !== false"
  ]) {
    assert.equal(input.includes(required), true, required);
  }
  assert.match(
    main,
    /let shadowDepth = 0;[\s\S]*active\.shadowRoot\.activeElement[\s\S]*shadowDepth < 8/u
  );
  assert.match(
    main,
    /state\.frameEpoch \+= 1;[\s\S]*state\.requests\.clear\(\)[\s\S]*const frameEpoch = state\.frameEpoch[\s\S]*state\.frameEpoch !== frameEpoch[\s\S]*executeStreamingFrameAction\([\s\S]*frameEpoch/u
  );
});

test("production plain activation은 windowless이고 cut 창은 isolated smoke만 도달한다", async () => {
  const main = await source("src/desktop/main.ts");
  const secondInstance = boundedSection(
    main,
    'app.on("second-instance"',
    "app.whenReady().then(async () => {"
  );
  assert.match(secondInstance, /else if \(nativeSmoke && launchCommand\?\.kind === "cut"\)/u);
  assert.doesNotMatch(secondInstance, /!launchCommand[\s\S]{0,180}requestCutWindow/u);
  assert.doesNotMatch(secondInstance, /ENGINE_BACKGROUND_ARGUMENT[\s\S]{0,180}requestCutWindow/u);
  assert.match(main, /app\.on\("activate"[\s\S]{0,220}windowless media engine/u);
  assert.match(main, /cutWindowRequested = Boolean\([\s\S]*nativeSmoke[\s\S]*initialLaunchCommand\?\.kind === "cut"/u);
});
