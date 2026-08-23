import assert from "node:assert/strict";
import test from "node:test";

import {
  installKirinukiCutShortcutGuard,
  trustedCutShortcutEventCode
} from "../src/desktop/cut-window-shortcut-guard.js";
import type {
  CutShortcutKeyboardEventLike
} from "../src/desktop/cut-window-shortcut-guard.js";

function target(
  tagName: string,
  options: Readonly<{ editable?: boolean; role?: string }> = {}
) {
  return {
    nodeType: 1,
    tagName,
    isContentEditable: options.editable === true,
    getAttribute: (name: string) => name === "role" ? options.role ?? "" : ""
  };
}

function trustedEvent(
  code: string,
  path: readonly unknown[],
  overrides: Partial<CutShortcutKeyboardEventLike> = {}
): CutShortcutKeyboardEventLike {
  return {
    type: "keydown",
    isTrusted: true,
    code,
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    composedPath: () => path,
    ...overrides
  };
}

test("physical shortcut guard는 video의 F/T 기본 동작을 동기적으로 막는다", () => {
  let listener: ((event: CutShortcutKeyboardEventLike) => void) | null = null;
  let installed = 0;
  const host = {
    addEventListener: (
      type: string,
      next: (event: CutShortcutKeyboardEventLike) => void,
      options: Readonly<{ capture: true; passive: false }>
    ) => {
      assert.equal(type, "keydown");
      assert.deepEqual(options, { capture: true, passive: false });
      installed += 1;
      listener = next;
    }
  };
  assert.deepEqual(installKirinukiCutShortcutGuard(host), {
    status: "installed",
    marker: "kirinuki-cut-shortcut-guard/v1"
  });
  assert.deepEqual(installKirinukiCutShortcutGuard(host), {
    status: "installed",
    marker: "kirinuki-cut-shortcut-guard/v1"
  });
  assert.equal(installed, 1);
  assert.ok(listener);
  const dispatch = listener as (event: CutShortcutKeyboardEventLike) => void;

  for (const code of ["KeyF", "KeyT"]) {
    let prevented = 0;
    let stopped = 0;
    dispatch({
      ...trustedEvent(code, [target("VIDEO")]),
      preventDefault: () => { prevented += 1; },
      stopImmediatePropagation: () => { stopped += 1; }
    });
    assert.equal(prevented, 1, code);
    assert.equal(stopped, 1, code);
  }
});

test("shortcut guard는 INPUT·contenteditable·shadow path·IME를 건드리지 않는다", () => {
  const editableCases = [
    trustedEvent("KeyE", [target("INPUT")]),
    trustedEvent("KeyR", [target("SPAN", { editable: true })]),
    trustedEvent("KeyA", [target("INPUT"), target("DIV")]),
    trustedEvent("KeyF", [target("DIV", { role: "textbox" })]),
    trustedEvent("KeyT", [target("VIDEO")], { isComposing: true }),
    trustedEvent("KeyT", [target("VIDEO")], { repeat: true }),
    trustedEvent("KeyT", [target("VIDEO")], { ctrlKey: true }),
    trustedEvent("KeyT", [target("VIDEO")], { isTrusted: false })
  ];
  for (const event of editableCases) {
    assert.equal(trustedCutShortcutEventCode(event), null);
  }
});

test("shortcut guard는 key 문자가 아니라 영문 physical code를 사용한다", () => {
  const video = target("VIDEO");
  assert.equal(
    trustedCutShortcutEventCode(trustedEvent("KeyE", [video])),
    "KeyE"
  );
  assert.equal(
    trustedCutShortcutEventCode(trustedEvent("KeyS", [video])),
    null
  );
});
