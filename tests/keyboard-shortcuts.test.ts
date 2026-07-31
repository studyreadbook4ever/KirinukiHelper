import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS,
  EDITOR_SHORTCUT_BINDINGS,
  KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE,
  SIDEPANEL_SHORTCUT_BINDINGS,
  findKeyboardShortcutCollisions,
  formatKeyboardShortcutHint,
  isDangerousKeyboardShortcutAction,
  isKeyboardShortcutEventBlocked,
  isKeyboardShortcutInteractiveTarget,
  keyboardShortcutBindingForScope,
  keyboardShortcutLetterFromEvent,
  normalizeKeyboardShortcutLetter,
  shouldHandleKeyboardShortcut
} from "../src/lib/keyboard-shortcuts.js";

function fakeElement({
  tagName = "DIV",
  role = "",
  contentEditable = "",
  parentElement = null
}: {
  tagName?: string;
  role?: string;
  contentEditable?: string;
  parentElement?: unknown;
} = {}) {
  return {
    tagName,
    contentEditable,
    isContentEditable: (
      contentEditable !== ""
      && contentEditable !== "false"
      && contentEditable !== "inherit"
    ),
    parentElement,
    getAttribute(name: string) {
      if (name === "role") {
        return role || null;
      }
      if (name === "contenteditable") {
        return contentEditable || null;
      }
      return null;
    }
  };
}

test("scope별 A-Z 단축키는 충돌 없이 안전한 동작만 포함한다", () => {
  assert.deepEqual(
    SIDEPANEL_SHORTCUT_BINDINGS.map(({ key }) => key),
    ["Q", "W", "E", "R", "T", "A", "S", "D", "F", "G", "H", "Y", "U"]
  );
  assert.deepEqual(
    EDITOR_SHORTCUT_BINDINGS.map(({ key }) => key),
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "C", "V", "B", "W", "E", "I", "O"]
  );
  for (const [scope, bindings] of Object.entries(
    KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE
  )) {
    assert.deepEqual(
      findKeyboardShortcutCollisions(bindings),
      [],
      `${scope} 단축키에 키 충돌이 없어야 합니다.`
    );
    assert.equal(new Set(bindings.map(({ action }) => action)).size, bindings.length);
    assert.equal(new Set(bindings.map(({ targetId }) => targetId)).size, bindings.length);
    for (const binding of bindings) {
      assert.equal(
        isDangerousKeyboardShortcutAction(binding.action),
        false,
        `${scope}:${binding.key}가 위험 동작 ${binding.action}을 가리킵니다.`
      );
      assert.equal(isDangerousKeyboardShortcutAction(binding.targetId), false);
      for (const targetId of binding.alternateTargetIds || []) {
        assert.equal(isDangerousKeyboardShortcutAction(targetId), false);
      }
      assert.match(formatKeyboardShortcutHint(binding.label, binding.key), new RegExp(
        `\\(단축키 ${binding.key}\\)$`,
        "u"
      ));
    }
  }
});

test("모든 단축키 대상은 실제 화면에 있고 두 화면 모두 공용 정책을 설치한다", async () => {
  const [sidepanelHtml, editorHtml, sidepanelSource, editorSource] = await Promise.all([
    readFile(new URL("../extension/sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/sidepanel.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);

  for (const binding of SIDEPANEL_SHORTCUT_BINDINGS) {
    for (const targetId of [
      binding.targetId,
      ...(binding.alternateTargetIds || [])
    ]) {
      assert.match(sidepanelHtml, new RegExp(`id="${targetId}"`, "u"));
    }
  }
  for (const binding of EDITOR_SHORTCUT_BINDINGS) {
    for (const targetId of [
      binding.targetId,
      ...(binding.alternateTargetIds || [])
    ]) {
      assert.match(editorHtml, new RegExp(`id="${targetId}"`, "u"));
    }
  }
  assert.match(sidepanelSource, /installShortcutHints\(\)/u);
  assert.match(sidepanelSource, /keyboardShortcutBindingForScope\("sidepanel"/u);
  assert.match(
    sidepanelSource,
    /binding\.action === "save-segment"[\s\S]+state\.draft\.editingId/u,
    "기존 구간 편집 중에는 T 저장 단축키가 실행되면 안 됩니다."
  );
  assert.match(
    sidepanelSource,
    /saveSegment\.removeAttribute\("aria-keyshortcuts"\)/u,
    "기존 구간 편집 중에는 저장 버튼의 단축키 표기도 제거해야 합니다."
  );
  assert.match(
    sidepanelSource,
    /seekBackwardFive\.addEventListener\([\s\S]+seekSourceBy\(-5\)/u
  );
  assert.match(
    sidepanelSource,
    /seekForwardFive\.addEventListener\([\s\S]+seekSourceBy\(5\)/u
  );
  assert.match(
    sidepanelSource,
    /async function captureCurrentPosition[\s\S]+reserveSourceClockOperation\(\)[\s\S]+await sourceClockOperation\.waitForTurn;[\s\S]+requestForegroundPageContext\(\)/u,
    "D/F와 E/R은 입력 순서대로 원본 영상 시계를 읽고 바꿔야 합니다."
  );
  const captureFunction = /async function captureCurrentPosition[\s\S]+?(?=\nfunction captureOriginLabel)/u.exec(
    sidepanelSource
  )?.[0] || "";
  assert.doesNotMatch(
    captureFunction,
    /segmentDescription\.focus/u,
    "R 캡처 뒤 설명 입력으로 포커스를 옮기면 즉시 T 저장을 할 수 없습니다."
  );
  assert.match(
    sidepanelSource,
    /async function saveSegment[\s\S]+reserveSourceClockOperation\(\)[\s\S]+await sourceClockOperation\.waitForTurn;[\s\S]+syncDraftFromForm\(\)/u,
    "R 직후 T를 누르면 끝 스탬프 저장 완료 뒤 구간을 저장해야 합니다."
  );
  assert.match(
    sidepanelSource,
    /async function seekSourceBy[\s\S]+reserveSourceClockOperation\(\)[\s\S]+await sourceClockOperation\.waitForTurn;[\s\S]+action: "seek-relative"/u,
    "D/F 이동도 E/R 캡처와 같은 원본 영상 시계 큐를 사용해야 합니다."
  );
  assert.match(
    sidepanelSource,
    /async function setSourcePlaybackRate[\s\S]+const operationGeneration = stateGeneration;[\s\S]+await sourceClockOperation\.waitForTurn;[\s\S]+assertOperationCurrent\(operationGeneration\);[\s\S]+getActiveSourceTab\(\)/u,
    "대기 중 초기화된 Y/U 명령은 새 원본 탭에 실행되면 안 됩니다."
  );
  assert.match(
    sidepanelSource,
    /async function seekSourceBy[\s\S]+const operationGeneration = stateGeneration;[\s\S]+await sourceClockOperation\.waitForTurn;[\s\S]+assertOperationCurrent\(operationGeneration\);[\s\S]+getActiveSourceTab\(\)/u,
    "대기 중 초기화된 D/F 명령은 새 원본 탭에 실행되면 안 됩니다."
  );
  assert.match(
    sidepanelSource,
    /async function setSourcePlaybackRate[\s\S]+await sendMessageToSourceTab\(tab, message\);\s+assertOperationCurrent\(operationGeneration\);/u,
    "Y/U 응답 대기 중 초기화되면 이전 응답을 새 상태에 적용하면 안 됩니다."
  );
  assert.match(
    sidepanelSource,
    /async function seekSourceBy[\s\S]+await sendMessageToSourceTab\(tab, \{[\s\S]+action: "seek-relative"[\s\S]+\}\);\s+assertOperationCurrent\(operationGeneration\);/u,
    "D/F 응답 대기 중 초기화되면 이전 응답을 새 상태에 적용하면 안 됩니다."
  );
  assert.match(
    sidepanelSource,
    /refreshSourceTabAfterPlayerCommand\([\s\S]+requestPageContextFromTab\(tab\)[\s\S]+requestSequence !== contextRequestSequence/u,
    "D/F 직후에는 같은 원본 탭의 최신 SPA 문맥만 다시 표시해야 합니다."
  );
  assert.match(
    sidepanelSource,
    /playbackRateQuarter\.addEventListener\([\s\S]+setSourcePlaybackRate\(0\.25\)/u
  );
  assert.match(
    sidepanelSource,
    /playbackRateDouble\.addEventListener\([\s\S]+setSourcePlaybackRate\(2\)/u
  );
  assert.match(editorSource, /installEditorShortcutHints\(\)/u);
  assert.match(editorSource, /keyboardShortcutBindingForScope\("editor"/u);
});

test("사이드패널 D/F와 Y/U는 원본 영상 이동·배속 버튼에 고정한다", () => {
  assert.deepEqual(keyboardShortcutBindingForScope("sidepanel", "d"), {
    key: "D",
    action: "player-seek-backward-five",
    targetId: "seek-backward-five",
    label: "원본 영상을 5초 이전으로 이동",
    trigger: "click"
  });
  assert.deepEqual(keyboardShortcutBindingForScope("sidepanel", "F"), {
    key: "F",
    action: "player-seek-forward-five",
    targetId: "seek-forward-five",
    label: "원본 영상을 5초 이후로 이동",
    trigger: "click"
  });
  assert.deepEqual(keyboardShortcutBindingForScope("sidepanel", "y"), {
    key: "Y",
    action: "player-rate-quarter",
    targetId: "playback-rate-quarter",
    label: "원본 영상을 0.25배속으로 재생",
    trigger: "click"
  });
  assert.deepEqual(keyboardShortcutBindingForScope("sidepanel", "U"), {
    key: "U",
    action: "player-rate-double",
    targetId: "playback-rate-double",
    label: "원본 영상을 2배속으로 재생",
    trigger: "click"
  });
  assert.equal(keyboardShortcutBindingForScope("sidepanel", "Z"), null);
  assert.equal(keyboardShortcutBindingForScope("sidepanel", "X"), null);
  assert.equal(keyboardShortcutBindingForScope("editor", "X"), null);
});

test("위험 동작 denylist는 초기화·삭제·복구·취소·내보내기·생성을 fail closed 한다", () => {
  assert(DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS.includes("reset"));
  for (const action of [
    "reset-project",
    "delete-range",
    "remove-asset",
    "restore-local-draft",
    "cancel-job",
    "export-video",
    "generate-captions",
    "apply-source-offset",
    "overwrite-project",
    "shutdown-service"
  ]) {
    assert.equal(isDangerousKeyboardShortcutAction(action), true, action);
  }
  for (const action of [
    "save-segment",
    "create-local-draft",
    "copy-prompt",
    "play-toggle",
    "fit-timeline"
  ]) {
    assert.equal(isDangerousKeyboardShortcutAction(action), false, action);
  }
});

test("키 정규화와 scope 조회는 영문 A-Z 밖에서 fail closed 한다", () => {
  assert.equal(normalizeKeyboardShortcutLetter("a"), "A");
  assert.equal(normalizeKeyboardShortcutLetter("Z"), "Z");
  for (const key of ["", "AA", "1", " ", "ㄱ", "Escape", null]) {
    assert.equal(normalizeKeyboardShortcutLetter(key), null);
  }
  assert.equal(keyboardShortcutBindingForScope("sidepanel", "1"), null);
  assert.throws(
    () => formatKeyboardShortcutHint("", "Q"),
    /동작 이름과 A-Z 키/
  );
  assert.throws(
    () => formatKeyboardShortcutHint("현재 영상", "Escape"),
    /동작 이름과 A-Z 키/
  );
});

test("충돌 검사는 대소문자를 같은 키로 취급한다", () => {
  assert.deepEqual(
    findKeyboardShortcutCollisions([
      { key: "A", action: "first" },
      { key: "A", action: "second" },
      { key: "B", action: "third" }
    ]),
    [{ key: "A", actions: ["first", "second"] }]
  );
});

test("IME·반복·수정키·이미 처리된 이벤트는 전역 단축키를 차단한다", () => {
  const blockers = [
    { key: "a", isComposing: true },
    { key: "a", keyCode: 229 },
    { key: "a", which: 229 },
    { key: "a", repeat: true },
    { key: "a", defaultPrevented: true },
    { key: "a", altKey: true },
    { key: "a", ctrlKey: true },
    { key: "a", metaKey: true },
    { key: "a", shiftKey: true }
  ];
  for (const event of blockers) {
    assert.equal(isKeyboardShortcutEventBlocked(event), true);
    assert.equal(keyboardShortcutLetterFromEvent(event), null);
    assert.equal(shouldHandleKeyboardShortcut(event), false);
  }
});

test("문자 입력·미디어·ARIA 편집 control·contenteditable 내부는 차단한다", () => {
  for (const tagName of [
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "VIDEO",
    "AUDIO"
  ]) {
    assert.equal(
      isKeyboardShortcutInteractiveTarget(fakeElement({ tagName })),
      true,
      tagName
    );
  }
  assert.equal(
    isKeyboardShortcutInteractiveTarget(fakeElement({ role: "slider" })),
    true
  );
  assert.equal(
    isKeyboardShortcutInteractiveTarget(fakeElement({
      contentEditable: "plaintext-only"
    })),
    true
  );
});

test("버튼·링크 포커스는 안전한 A-Z 흐름을 막지 않는다", () => {
  for (const tagName of ["BUTTON", "A"]) {
    assert.equal(
      isKeyboardShortcutInteractiveTarget(fakeElement({ tagName })),
      false,
      tagName
    );
  }
  for (const role of ["button", "link", "tab"]) {
    assert.equal(
      isKeyboardShortcutInteractiveTarget(fakeElement({ role })),
      false,
      role
    );
  }
  const button = fakeElement({ tagName: "BUTTON" });
  const nestedIcon = fakeElement({ tagName: "SPAN", parentElement: button });
  assert.equal(isKeyboardShortcutInteractiveTarget(nestedIcon), false);
  assert.equal(
    keyboardShortcutLetterFromEvent({ key: "a", target: nestedIcon }),
    "A"
  );
});

test("비대화형 편집기 표면의 단일 영문 키만 처리한다", () => {
  const stage = fakeElement({ tagName: "DIV" });
  assert.equal(isKeyboardShortcutInteractiveTarget(stage), false);
  assert.equal(
    keyboardShortcutLetterFromEvent({ key: "a", target: stage }),
    "A"
  );
  assert.equal(
    shouldHandleKeyboardShortcut({ key: "a", target: stage }),
    true
  );
  assert.equal(
    keyboardShortcutLetterFromEvent({ key: "Escape", target: stage }),
    null
  );
  assert.equal(
    keyboardShortcutLetterFromEvent({
      key: "Process",
      code: "KeyA",
      target: stage
    }),
    "A",
    "한글 자판이어도 물리 A-Z 위치를 사용해야 합니다."
  );
});
