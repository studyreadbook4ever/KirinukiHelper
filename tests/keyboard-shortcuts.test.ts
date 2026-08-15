import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPTION_COLOR_SHORTCUT_DIGITS,
  DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS,
  EDITOR_SHORTCUT_BINDINGS,
  captionColorShortcutDigitFromEvent,
  clipNavigationShortcutDirectionFromEvent,
  editorKeyboardShortcutBinding,
  findKeyboardShortcutCollisions,
  formatKeyboardShortcutHint,
  isDangerousKeyboardShortcutAction,
  isKeyboardShortcutEventBlocked,
  isKeyboardShortcutInteractiveTarget,
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

test("web 편집기 A-Z 단축키는 충돌 없이 안전한 실제 대상만 가리킨다", async () => {
  const [editorHtml, editorSource] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  assert.deepEqual(
    EDITOR_SHORTCUT_BINDINGS.map(({ key }) => key),
    ["A", "S", "D", "F", "G", "H", "J", "K", "M", "N", "P", "Q", "C", "V", "B", "X", "W", "E", "I", "O"]
  );
  assert.deepEqual(findKeyboardShortcutCollisions(EDITOR_SHORTCUT_BINDINGS), []);
  assert.equal(new Set(EDITOR_SHORTCUT_BINDINGS.map(({ action }) => action)).size, EDITOR_SHORTCUT_BINDINGS.length);
  assert.equal(new Set(EDITOR_SHORTCUT_BINDINGS.map(({ targetId }) => targetId)).size, EDITOR_SHORTCUT_BINDINGS.length);
  for (const binding of EDITOR_SHORTCUT_BINDINGS) {
    assert.equal(isDangerousKeyboardShortcutAction(binding.action), false);
    for (const targetId of [binding.targetId, ...(binding.alternateTargetIds || [])]) {
      assert.match(editorHtml, new RegExp(`id="${targetId}"`, "u"));
      assert.equal(isDangerousKeyboardShortcutAction(targetId), false);
    }
    assert.match(
      formatKeyboardShortcutHint(binding.label, binding.key),
      new RegExp(`\\(단축키 ${binding.key}\\)$`, "u")
    );
  }
  assert.match(editorSource, /installEditorShortcutHints\(\)/u);
  assert.match(editorSource, /editorKeyboardShortcutBinding\(shortcutLetter\)/u);
  assert.equal(editorKeyboardShortcutBinding("J")?.targetId, "previous-cue-in-lane");
  assert.equal(editorKeyboardShortcutBinding("K")?.targetId, "next-cue-in-lane");
  assert.equal(editorKeyboardShortcutBinding("L"), null);
});

test("위험 동작 denylist는 파괴적이거나 고비용인 편집 동작을 fail closed한다", () => {
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
  for (const action of ["save-segment", "focus-cue-text", "play-toggle", "fit-timeline"]) {
    assert.equal(isDangerousKeyboardShortcutAction(action), false, action);
  }
});

test("웹 편집기 키 정규화와 event guard는 IME·반복·수정키를 차단한다", () => {
  assert.equal(normalizeKeyboardShortcutLetter("a"), "A");
  assert.equal(normalizeKeyboardShortcutLetter("Z"), "Z");
  for (const key of ["", "AA", "1", " ", "ㄱ", "Escape", null]) {
    assert.equal(normalizeKeyboardShortcutLetter(key), null);
  }
  assert.throws(() => formatKeyboardShortcutHint("", "Q"), /동작 이름과 A-Z 키/u);
  for (const event of [
    { key: "a", isComposing: true },
    { key: "a", keyCode: 229 },
    { key: "a", which: 229 },
    { key: "a", repeat: true },
    { key: "a", defaultPrevented: true },
    { key: "a", altKey: true },
    { key: "a", ctrlKey: true },
    { key: "a", metaKey: true },
    { key: "a", shiftKey: true }
  ]) {
    assert.equal(isKeyboardShortcutEventBlocked(event), true);
    assert.equal(keyboardShortcutLetterFromEvent(event), null);
    assert.equal(shouldHandleKeyboardShortcut(event), false);
  }
  assert.equal(keyboardShortcutLetterFromEvent({ key: "j" }), "J");
  assert.equal(shouldHandleKeyboardShortcut({ key: "j" }), true);
});

test("웹 편집기 단축키는 입력·미디어·편집 가능한 조상 안에서 실행되지 않는다", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"] as const) {
    assert.equal(isKeyboardShortcutInteractiveTarget(fakeElement({ tagName })), true);
  }
  for (const role of ["textbox", "combobox", "searchbox", "slider", "spinbutton"] as const) {
    assert.equal(isKeyboardShortcutInteractiveTarget(fakeElement({ role })), true);
  }
  const editableParent = fakeElement({ contentEditable: "true" });
  assert.equal(
    isKeyboardShortcutInteractiveTarget(fakeElement({ parentElement: editableParent })),
    true
  );
  assert.equal(isKeyboardShortcutInteractiveTarget(fakeElement({ tagName: "BUTTON" })), false);
  assert.equal(isKeyboardShortcutInteractiveTarget(fakeElement({ tagName: "A" })), false);
  assert.equal(isKeyboardShortcutInteractiveTarget(fakeElement()), false);
});

test("자막 색상과 컷 이동 보조키는 허용된 물리 키만 해석한다", () => {
  assert.deepEqual(CAPTION_COLOR_SHORTCUT_DIGITS, ["1", "2", "3", "4", "5", "6"]);
  for (let digit = 1; digit <= 6; digit += 1) {
    assert.equal(
      captionColorShortcutDigitFromEvent({ key: String(digit), code: `Digit${digit}` }),
      String(digit)
    );
    assert.equal(
      captionColorShortcutDigitFromEvent({ key: String(digit), code: `Numpad${digit}` }),
      String(digit)
    );
  }
  assert.equal(captionColorShortcutDigitFromEvent({ key: "7", code: "Digit7" }), null);
  assert.equal(captionColorShortcutDigitFromEvent({ key: "End", code: "Numpad1" }), null);
  assert.equal(clipNavigationShortcutDirectionFromEvent({ key: ",", code: "Comma" }), -1);
  assert.equal(clipNavigationShortcutDirectionFromEvent({ key: ".", code: "Period" }), 1);
  assert.equal(clipNavigationShortcutDirectionFromEvent({ key: "<", code: "Comma", shiftKey: true }), null);
});
