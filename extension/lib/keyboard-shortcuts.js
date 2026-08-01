// Generated from TypeScript sources. Do not edit directly.
const KEYBOARD_SHORTCUT_LETTERS = Object.freeze([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z"
]);
const DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS = Object.freeze([
  "reset",
  "delete",
  "remove",
  "restore",
  "cancel",
  "export",
  "generate-captions",
  "overwrite",
  "replace",
  "discard",
  "clear",
  "destroy",
  "erase",
  "shutdown",
  "terminate",
  "stop-service",
  "service-stop",
  "close-service",
  "service-close",
  "apply-source-offset",
  "apply-offset",
  "offset-apply"
]);
const INTERACTIVE_TAG_NAMES = /* @__PURE__ */ new Set([
  "AUDIO",
  "DETAILS",
  "EMBED",
  "IFRAME",
  "INPUT",
  "OBJECT",
  "OPTION",
  "SELECT",
  "SUMMARY",
  "TEXTAREA",
  "VIDEO"
]);
const INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
  "checkbox",
  "combobox",
  "gridcell",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "textbox",
  "treeitem"
]);
function normalizedActionName(value) {
  return String(value || "").trim().toLowerCase().replace(/[_\s]+/gu, "-");
}
function normalizeKeyboardShortcutLetter(value) {
  const key = String(value || "").toUpperCase();
  return key.length === 1 && KEYBOARD_SHORTCUT_LETTERS.includes(key) ? key : null;
}
function isDangerousKeyboardShortcutAction(value) {
  const action = normalizedActionName(value);
  return Boolean(
    action && DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS.some((token) => action.includes(token))
  );
}
function targetAttribute(target, record, name) {
  const getter = record.getAttribute;
  if (typeof getter !== "function") {
    return "";
  }
  try {
    return String(Reflect.apply(getter, target, [name]) || "").trim();
  } catch {
    return "";
  }
}
function parentElementOf(record) {
  return record.parentElement || null;
}
function isKeyboardShortcutInteractiveTarget(target) {
  const visited = /* @__PURE__ */ new Set();
  let current = target;
  for (let depth = 0; depth < 32; depth += 1) {
    if (!current || typeof current !== "object" || visited.has(current)) {
      return false;
    }
    visited.add(current);
    const record = current;
    const tagName = String(record.tagName || "").trim().toUpperCase();
    if (INTERACTIVE_TAG_NAMES.has(tagName)) {
      return true;
    }
    const role = (targetAttribute(current, record, "role") || String(record.role || "")).trim().toLowerCase();
    if (INTERACTIVE_ROLES.has(role)) {
      return true;
    }
    const contentEditable = (targetAttribute(current, record, "contenteditable") || String(record.contentEditable || "")).trim().toLowerCase();
    if (record.isContentEditable === true || contentEditable && contentEditable !== "false" && contentEditable !== "inherit") {
      return true;
    }
    current = parentElementOf(record);
  }
  return false;
}
function isKeyboardShortcutEventBlocked(event) {
  return Boolean(
    event.defaultPrevented === true || event.repeat === true || event.isComposing === true || Number(event.keyCode) === 229 || Number(event.which) === 229 || event.altKey === true || event.ctrlKey === true || event.metaKey === true || event.shiftKey === true || isKeyboardShortcutInteractiveTarget(event.target)
  );
}
function keyboardShortcutLetterFromEvent(event) {
  if (isKeyboardShortcutEventBlocked(event)) {
    return null;
  }
  const codeMatch = /^Key([A-Z])$/u.exec(String(event.code || ""));
  return normalizeKeyboardShortcutLetter(codeMatch?.[1] || event.key);
}
function shouldHandleKeyboardShortcut(event) {
  return keyboardShortcutLetterFromEvent(event) !== null;
}
function formatKeyboardShortcutHint(label, key) {
  const normalizedLabel = String(label || "").trim();
  const normalizedKey = normalizeKeyboardShortcutLetter(key);
  if (!normalizedLabel || !normalizedKey) {
    throw new TypeError("\uB2E8\uCD95\uD0A4 \uD78C\uD2B8\uC5D0\uB294 \uB3D9\uC791 \uC774\uB984\uACFC A-Z \uD0A4\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  }
  return `${normalizedLabel} (\uB2E8\uCD95\uD0A4 ${normalizedKey})`;
}
function findKeyboardShortcutCollisions(bindings) {
  const actionsByKey = /* @__PURE__ */ new Map();
  for (const binding of bindings) {
    const key = normalizeKeyboardShortcutLetter(binding.key);
    if (!key) {
      continue;
    }
    const actions = actionsByKey.get(key) || [];
    actions.push(String(binding.action || "").trim());
    actionsByKey.set(key, actions);
  }
  return Object.freeze(
    [...actionsByKey.entries()].filter(([, actions]) => actions.length > 1).map(([key, actions]) => Object.freeze({
      key,
      actions: Object.freeze([...actions])
    }))
  );
}
function defineKeyboardShortcutBindings(scope, bindings) {
  for (const binding of bindings) {
    const targetIds = [
      binding.targetId,
      ...binding.alternateTargetIds || []
    ];
    if (!normalizeKeyboardShortcutLetter(binding.key) || !binding.action.trim() || targetIds.some((targetId) => !targetId.trim()) || !binding.label.trim()) {
      throw new TypeError(`${scope} \uB2E8\uCD95\uD0A4 \uC815\uC758\uAC00 \uBD88\uC644\uC804\uD569\uB2C8\uB2E4.`);
    }
    if (isDangerousKeyboardShortcutAction(binding.action) || targetIds.some(isDangerousKeyboardShortcutAction)) {
      throw new TypeError(
        `${scope} \uB2E8\uCD95\uD0A4\uC5D0 \uC704\uD5D8 \uB3D9\uC791\uC744 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${binding.action}`
      );
    }
  }
  const collisions = findKeyboardShortcutCollisions(bindings);
  if (collisions.length > 0) {
    throw new TypeError(
      `${scope} \uB2E8\uCD95\uD0A4 \uD0A4 \uCDA9\uB3CC: ${collisions.map(({ key }) => key).join(", ")}`
    );
  }
  return Object.freeze(bindings.map((binding) => Object.freeze(
    binding.alternateTargetIds ? {
      ...binding,
      alternateTargetIds: Object.freeze([...binding.alternateTargetIds])
    } : { ...binding }
  )));
}
const SIDEPANEL_SHORTCUT_BINDINGS = defineKeyboardShortcutBindings(
  "sidepanel",
  [
    {
      key: "Q",
      action: "refresh-recovery-sessions",
      targetId: "refresh-recovery-sessions",
      label: "\uCD5C\uADFC \uD3B8\uC9D1 \uB2E4\uC2DC \uC77D\uAE30",
      trigger: "click"
    },
    {
      key: "W",
      action: "refresh-source",
      targetId: "refresh-source",
      label: "\uD604\uC7AC \uC601\uC0C1 \uB2E4\uC2DC \uC77D\uAE30",
      trigger: "click"
    },
    {
      key: "E",
      action: "capture-start",
      targetId: "capture-start",
      label: "\uD604\uC7AC \uC2DC\uAC01\uC744 \uC2DC\uC791\uC810\uC73C\uB85C \uCEA1\uCC98",
      trigger: "click"
    },
    {
      key: "R",
      action: "capture-end",
      targetId: "capture-end",
      label: "\uD604\uC7AC \uC2DC\uAC01\uC744 \uB05D\uC810\uC73C\uB85C \uCEA1\uCC98",
      trigger: "click"
    },
    {
      key: "T",
      action: "save-segment",
      targetId: "save-segment",
      label: "\uAD6C\uAC04 \uC800\uC7A5",
      trigger: "click"
    },
    {
      key: "A",
      action: "open-editor",
      targetId: "open-editor",
      label: "\uD3B8\uC9D1\uAE30 \uC5F4\uAE30",
      trigger: "click"
    },
    {
      key: "S",
      action: "preview-prompt",
      targetId: "generate-prompt",
      label: "\uD504\uB86C\uD504\uD2B8 \uBBF8\uB9AC\uBCF4\uAE30",
      trigger: "click"
    },
    {
      key: "D",
      action: "player-seek-backward-five",
      targetId: "seek-backward-five",
      label: "\uC6D0\uBCF8 \uC601\uC0C1\uC744 5\uCD08 \uC774\uC804\uC73C\uB85C \uC774\uB3D9",
      trigger: "click"
    },
    {
      key: "F",
      action: "player-seek-forward-five",
      targetId: "seek-forward-five",
      label: "\uC6D0\uBCF8 \uC601\uC0C1\uC744 5\uCD08 \uC774\uD6C4\uB85C \uC774\uB3D9",
      trigger: "click"
    },
    {
      key: "G",
      action: "download-prompt",
      targetId: "download-prompt",
      label: "\uD504\uB86C\uD504\uD2B8 MD \uB2E4\uC6B4\uB85C\uB4DC",
      trigger: "click"
    },
    {
      key: "H",
      action: "close-preview",
      targetId: "close-preview",
      label: "\uD504\uB86C\uD504\uD2B8 \uBBF8\uB9AC\uBCF4\uAE30 \uC811\uAE30",
      trigger: "click"
    },
    {
      key: "Y",
      action: "player-rate-quarter",
      targetId: "playback-rate-quarter",
      label: "\uC6D0\uBCF8 \uC601\uC0C1\uC744 0.25\uBC30\uC18D\uC73C\uB85C \uC7AC\uC0DD",
      trigger: "click"
    },
    {
      key: "U",
      action: "player-rate-double",
      targetId: "playback-rate-double",
      label: "\uC6D0\uBCF8 \uC601\uC0C1\uC744 2\uBC30\uC18D\uC73C\uB85C \uC7AC\uC0DD",
      trigger: "click"
    }
  ]
);
const EDITOR_SHORTCUT_BINDINGS = defineKeyboardShortcutBindings(
  "editor",
  [
    {
      key: "A",
      action: "add-cue",
      targetId: "add-cue",
      alternateTargetIds: ["add-cue-top"],
      label: "\uD604\uC7AC \uC704\uCE58\uC5D0 \uC790\uB9C9 \uCD94\uAC00",
      trigger: "click"
    },
    {
      key: "S",
      action: "create-local-draft",
      targetId: "create-local-draft",
      label: "\uD604\uC7AC \uD3B8\uC9D1 \uB85C\uCEEC \uC784\uC2DC\uC800\uC7A5",
      trigger: "click"
    },
    {
      key: "D",
      action: "add-audio-region",
      targetId: "add-audio-region",
      label: "\uD604\uC7AC \uC704\uCE58\uC5D0 \uC74C\uC131 \uC124\uC815 \uCD94\uAC00",
      trigger: "click"
    },
    {
      key: "F",
      action: "fit-timeline",
      targetId: "fit-timeline",
      label: "\uD0C0\uC784\uB77C\uC778 \uC804\uCCB4 \uBCF4\uAE30",
      trigger: "click"
    },
    {
      key: "G",
      action: "toggle-timeline-snap",
      targetId: "toggle-timeline-snap",
      label: "\uD0C0\uC784\uB77C\uC778 \uC790\uC11D \uC804\uD658",
      trigger: "click"
    },
    {
      key: "H",
      action: "paste-image-asset",
      targetId: "paste-image-asset",
      alternateTargetIds: ["asset-paste"],
      label: "\uD604\uC7AC \uC704\uCE58\uC5D0 \uC774\uBBF8\uC9C0 \uBD99\uC5EC\uB123\uAE30",
      trigger: "click"
    },
    {
      key: "J",
      action: "previous-clip",
      targetId: "previous-clip",
      label: "\uC774\uC804 \uAD6C\uAC04\uC73C\uB85C \uC774\uB3D9",
      trigger: "click"
    },
    {
      key: "K",
      action: "play-toggle",
      targetId: "play-toggle",
      label: "\uBBF8\uB9AC\uBCF4\uAE30 \uC7AC\uC0DD \uB610\uB294 \uC77C\uC2DC\uC815\uC9C0",
      trigger: "click"
    },
    {
      key: "L",
      action: "next-clip",
      targetId: "next-clip",
      label: "\uB2E4\uC74C \uAD6C\uAC04\uC73C\uB85C \uC774\uB3D9",
      trigger: "click"
    },
    {
      key: "M",
      action: "toggle-mute",
      targetId: "toggle-mute",
      label: "\uBBF8\uB9AC\uBCF4\uAE30 \uC74C\uC18C\uAC70 \uC804\uD658",
      trigger: "click"
    },
    {
      key: "N",
      action: "add-subtitle-lane",
      targetId: "add-subtitle-lane",
      label: "\uC790\uB9C9 \uB808\uC778 \uCD94\uAC00",
      trigger: "click"
    },
    {
      key: "P",
      action: "focus-source",
      targetId: "focus-source",
      label: "\uC6D0\uBCF8 \uC601\uC0C1 \uD0ED\uC73C\uB85C \uC774\uB3D9",
      trigger: "click"
    },
    {
      key: "Q",
      action: "open-local-drafts",
      targetId: "open-local-drafts",
      label: "\uCD5C\uADFC \uB85C\uCEEC \uC784\uC2DC\uC800\uC7A5 \uBAA9\uB85D \uC5F4\uAE30",
      trigger: "click"
    },
    {
      key: "C",
      action: "caption-mode-tab",
      targetId: "caption-mode-tab",
      label: "\uC790\uB9C9 \uD3B8\uC9D1 \uD0ED \uC5F4\uAE30",
      trigger: "click"
    },
    {
      key: "V",
      action: "asset-mode-tab",
      targetId: "asset-mode-tab",
      label: "\uC5D0\uC14B \uD3B8\uC9D1 \uD0ED \uC5F4\uAE30",
      trigger: "click"
    },
    {
      key: "B",
      action: "audio-mode-tab",
      targetId: "audio-mode-tab",
      label: "\uC74C\uC131 \uD3B8\uC9D1 \uD0ED \uC5F4\uAE30",
      trigger: "click"
    },
    {
      key: "X",
      action: "toggle-cue-caption-background",
      targetId: "toggle-caption-background",
      label: "\uC120\uD0DD \uC790\uB9C9 \uAC80\uC740 \uC0C1\uC790 \uC804\uD658",
      trigger: "click"
    },
    {
      key: "W",
      action: "preview-source-tab",
      targetId: "preview-source-tab",
      label: "\uC6D0\uBCF8 \uC601\uC0C1\uC758 \uD604\uC7AC \uC2DC\uAC01\uC73C\uB85C \uC774\uB3D9",
      trigger: "click"
    },
    {
      key: "E",
      action: "pick-media",
      targetId: "pick-media",
      alternateTargetIds: ["pick-media-empty"],
      label: "\uC6D0\uBCF8 \uBBF8\uB514\uC5B4 \uC120\uD0DD",
      trigger: "click"
    },
    {
      key: "I",
      action: "set-range-start",
      targetId: "set-range-start",
      label: "\uD604\uC7AC \uC704\uCE58\uB97C \uAD6C\uAC04 \uC2DC\uC791\uC810\uC73C\uB85C \uC9C0\uC815",
      trigger: "click"
    },
    {
      key: "O",
      action: "set-range-end",
      targetId: "set-range-end",
      label: "\uD604\uC7AC \uC704\uCE58\uB97C \uAD6C\uAC04 \uB05D\uC810\uC73C\uB85C \uC9C0\uC815",
      trigger: "click"
    }
  ]
);
const KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE = Object.freeze({
  sidepanel: SIDEPANEL_SHORTCUT_BINDINGS,
  editor: EDITOR_SHORTCUT_BINDINGS
});
function keyboardShortcutBindingForScope(scope, key) {
  const normalizedKey = normalizeKeyboardShortcutLetter(key);
  if (!normalizedKey) {
    return null;
  }
  return KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE[scope].find((binding) => binding.key === normalizedKey) || null;
}
export {
  DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS,
  EDITOR_SHORTCUT_BINDINGS,
  KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE,
  KEYBOARD_SHORTCUT_LETTERS,
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
};
