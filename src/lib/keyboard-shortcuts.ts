export const KEYBOARD_SHORTCUT_LETTERS = Object.freeze([
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
] as const);

export type KeyboardShortcutLetter = typeof KEYBOARD_SHORTCUT_LETTERS[number];
export const CAPTION_COLOR_SHORTCUT_DIGITS = Object.freeze([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6"
] as const);
export type CaptionColorShortcutDigit =
  typeof CAPTION_COLOR_SHORTCUT_DIGITS[number];
export type ClipNavigationShortcutDirection = -1 | 1;
export type KeyboardShortcutScope = "sidepanel" | "editor";
export type KeyboardShortcutTrigger = "click" | "focus";

export interface KeyboardShortcutBinding {
  key: KeyboardShortcutLetter;
  action: string;
  targetId: string;
  alternateTargetIds?: readonly string[];
  label: string;
  trigger: KeyboardShortcutTrigger;
}

export interface KeyboardShortcutCollision {
  key: KeyboardShortcutLetter;
  actions: readonly string[];
}

export interface KeyboardShortcutEventLike {
  key?: unknown;
  code?: unknown;
  keyCode?: unknown;
  which?: unknown;
  repeat?: unknown;
  isComposing?: unknown;
  defaultPrevented?: unknown;
  altKey?: unknown;
  ctrlKey?: unknown;
  metaKey?: unknown;
  shiftKey?: unknown;
  target?: unknown;
}

export const DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS = Object.freeze([
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
] as const);

const INTERACTIVE_TAG_NAMES = new Set([
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

const INTERACTIVE_ROLES = new Set([
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

function normalizedActionName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/gu, "-");
}

export function normalizeKeyboardShortcutLetter(
  value: unknown
): KeyboardShortcutLetter | null {
  const key = String(value || "").toUpperCase();
  return (
    key.length === 1
    && KEYBOARD_SHORTCUT_LETTERS.includes(key as KeyboardShortcutLetter)
  )
    ? key as KeyboardShortcutLetter
    : null;
}

export function isDangerousKeyboardShortcutAction(value: unknown): boolean {
  const action = normalizedActionName(value);
  return Boolean(
    action
    && DANGEROUS_KEYBOARD_SHORTCUT_ACTION_TOKENS.some((token) => (
      action.includes(token)
    ))
  );
}

function targetAttribute(
  target: object,
  record: Record<string, unknown>,
  name: string
): string {
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

function parentElementOf(record: Record<string, unknown>): unknown {
  return record.parentElement || null;
}

export function isKeyboardShortcutInteractiveTarget(target: unknown): boolean {
  const visited = new Set<object>();
  let current = target;
  for (let depth = 0; depth < 32; depth += 1) {
    if (!current || typeof current !== "object" || visited.has(current)) {
      return false;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    const tagName = String(record.tagName || "").trim().toUpperCase();
    if (INTERACTIVE_TAG_NAMES.has(tagName)) {
      return true;
    }

    const role = (
      targetAttribute(current, record, "role")
      || String(record.role || "")
    ).trim().toLowerCase();
    if (INTERACTIVE_ROLES.has(role)) {
      return true;
    }

    const contentEditable = (
      targetAttribute(current, record, "contenteditable")
      || String(record.contentEditable || "")
    ).trim().toLowerCase();
    if (
      record.isContentEditable === true
      || (
        contentEditable
        && contentEditable !== "false"
        && contentEditable !== "inherit"
      )
    ) {
      return true;
    }
    current = parentElementOf(record);
  }
  return false;
}

export function isKeyboardShortcutEventBlocked(
  event: KeyboardShortcutEventLike
): boolean {
  return Boolean(
    event.defaultPrevented === true
    || event.repeat === true
    || event.isComposing === true
    || Number(event.keyCode) === 229
    || Number(event.which) === 229
    || event.altKey === true
    || event.ctrlKey === true
    || event.metaKey === true
    || event.shiftKey === true
    || isKeyboardShortcutInteractiveTarget(event.target)
  );
}

export function keyboardShortcutLetterFromEvent(
  event: KeyboardShortcutEventLike
): KeyboardShortcutLetter | null {
  if (isKeyboardShortcutEventBlocked(event)) {
    return null;
  }
  const codeMatch = /^Key([A-Z])$/u.exec(String(event.code || ""));
  return normalizeKeyboardShortcutLetter(codeMatch?.[1] || event.key);
}

export function captionColorShortcutDigitFromEvent(
  event: KeyboardShortcutEventLike
): CaptionColorShortcutDigit | null {
  if (isKeyboardShortcutEventBlocked(event)) {
    return null;
  }
  const code = String(event.code || "");
  const topRowMatch = /^Digit([1-6])$/u.exec(code);
  if (topRowMatch) {
    return topRowMatch[1] as CaptionColorShortcutDigit;
  }
  const numpadMatch = /^Numpad([1-6])$/u.exec(code);
  if (numpadMatch) {
    return String(event.key || "") === numpadMatch[1]
      ? numpadMatch[1] as CaptionColorShortcutDigit
      : null;
  }
  if (code && code !== "Unidentified") {
    return null;
  }
  const key = String(event.key || "");
  return CAPTION_COLOR_SHORTCUT_DIGITS.includes(
    key as CaptionColorShortcutDigit
  )
    ? key as CaptionColorShortcutDigit
    : null;
}

export function clipNavigationShortcutDirectionFromEvent(
  event: KeyboardShortcutEventLike
): ClipNavigationShortcutDirection | null {
  if (isKeyboardShortcutEventBlocked(event)) {
    return null;
  }
  const code = String(event.code || "");
  if (code === "Comma") {
    return -1;
  }
  if (code === "Period") {
    return 1;
  }
  if (code && code !== "Unidentified") {
    return null;
  }
  if (event.key === ",") {
    return -1;
  }
  if (event.key === ".") {
    return 1;
  }
  return null;
}

export function shouldHandleKeyboardShortcut(
  event: KeyboardShortcutEventLike
): boolean {
  return keyboardShortcutLetterFromEvent(event) !== null;
}

export function formatKeyboardShortcutHint(
  label: unknown,
  key: unknown
): string {
  const normalizedLabel = String(label || "").trim();
  const normalizedKey = normalizeKeyboardShortcutLetter(key);
  if (!normalizedLabel || !normalizedKey) {
    throw new TypeError("단축키 힌트에는 동작 이름과 A-Z 키가 필요합니다.");
  }
  return `${normalizedLabel} (단축키 ${normalizedKey})`;
}

export function findKeyboardShortcutCollisions(
  bindings: readonly Pick<KeyboardShortcutBinding, "key" | "action">[]
): readonly KeyboardShortcutCollision[] {
  const actionsByKey = new Map<KeyboardShortcutLetter, string[]>();
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
    [...actionsByKey.entries()]
      .filter(([, actions]) => actions.length > 1)
      .map(([key, actions]) => Object.freeze({
        key,
        actions: Object.freeze([...actions])
      }))
  );
}

function defineKeyboardShortcutBindings(
  scope: KeyboardShortcutScope,
  bindings: readonly KeyboardShortcutBinding[]
): readonly KeyboardShortcutBinding[] {
  for (const binding of bindings) {
    const targetIds = [
      binding.targetId,
      ...(binding.alternateTargetIds || [])
    ];
    if (
      !normalizeKeyboardShortcutLetter(binding.key)
      || !binding.action.trim()
      || targetIds.some((targetId) => !targetId.trim())
      || !binding.label.trim()
    ) {
      throw new TypeError(`${scope} 단축키 정의가 불완전합니다.`);
    }
    if (
      isDangerousKeyboardShortcutAction(binding.action)
      || targetIds.some(isDangerousKeyboardShortcutAction)
    ) {
      throw new TypeError(
        `${scope} 단축키에 위험 동작을 연결할 수 없습니다: ${binding.action}`
      );
    }
  }
  const collisions = findKeyboardShortcutCollisions(bindings);
  if (collisions.length > 0) {
    throw new TypeError(
      `${scope} 단축키 키 충돌: ${collisions.map(({ key }) => key).join(", ")}`
    );
  }
  return Object.freeze(bindings.map((binding) => Object.freeze(
    binding.alternateTargetIds
      ? {
        ...binding,
        alternateTargetIds: Object.freeze([...binding.alternateTargetIds])
      }
      : { ...binding }
  )));
}

export const SIDEPANEL_SHORTCUT_BINDINGS = defineKeyboardShortcutBindings(
  "sidepanel",
  [
    {
      key: "Q",
      action: "refresh-recovery-sessions",
      targetId: "refresh-recovery-sessions",
      label: "최근 편집 다시 읽기",
      trigger: "click"
    },
    {
      key: "W",
      action: "refresh-source",
      targetId: "refresh-source",
      label: "현재 영상 다시 읽기",
      trigger: "click"
    },
    {
      key: "E",
      action: "capture-start",
      targetId: "capture-start",
      label: "현재 시각을 시작점으로 캡처",
      trigger: "click"
    },
    {
      key: "R",
      action: "capture-end",
      targetId: "capture-end",
      label: "현재 시각을 끝점으로 캡처",
      trigger: "click"
    },
    {
      key: "T",
      action: "save-segment",
      targetId: "save-segment",
      label: "구간 저장",
      trigger: "click"
    },
    {
      key: "A",
      action: "open-editor",
      targetId: "open-editor",
      label: "편집기 열기",
      trigger: "click"
    },
    {
      key: "S",
      action: "preview-prompt",
      targetId: "generate-prompt",
      label: "프롬프트 미리보기",
      trigger: "click"
    },
    {
      key: "D",
      action: "player-seek-backward-five",
      targetId: "seek-backward-five",
      label: "원본 영상을 5초 이전으로 이동",
      trigger: "click"
    },
    {
      key: "F",
      action: "player-seek-forward-five",
      targetId: "seek-forward-five",
      label: "원본 영상을 5초 이후로 이동",
      trigger: "click"
    },
    {
      key: "G",
      action: "download-prompt",
      targetId: "download-prompt",
      label: "프롬프트 MD 다운로드",
      trigger: "click"
    },
    {
      key: "H",
      action: "close-preview",
      targetId: "close-preview",
      label: "프롬프트 미리보기 접기",
      trigger: "click"
    },
    {
      key: "Y",
      action: "player-rate-quarter",
      targetId: "playback-rate-quarter",
      label: "원본 영상을 0.25배속으로 재생",
      trigger: "click"
    },
    {
      key: "U",
      action: "player-rate-double",
      targetId: "playback-rate-double",
      label: "원본 영상을 2배속으로 재생",
      trigger: "click"
    }
  ]
);

export const EDITOR_SHORTCUT_BINDINGS = defineKeyboardShortcutBindings(
  "editor",
  [
    {
      key: "A",
      action: "add-cue",
      targetId: "add-cue",
      alternateTargetIds: ["add-cue-top"],
      label: "현재 위치에 자막 추가",
      trigger: "click"
    },
    {
      key: "S",
      action: "create-local-draft",
      targetId: "create-local-draft",
      label: "현재 편집 로컬 임시저장",
      trigger: "click"
    },
    {
      key: "D",
      action: "add-audio-region",
      targetId: "add-audio-region",
      label: "현재 위치에 음성 설정 추가",
      trigger: "click"
    },
    {
      key: "F",
      action: "fit-timeline",
      targetId: "fit-timeline",
      label: "타임라인 전체 보기",
      trigger: "click"
    },
    {
      key: "G",
      action: "toggle-timeline-snap",
      targetId: "toggle-timeline-snap",
      label: "타임라인 자석 전환",
      trigger: "click"
    },
    {
      key: "H",
      action: "paste-image-asset",
      targetId: "paste-image-asset",
      alternateTargetIds: ["asset-paste"],
      label: "현재 위치에 이미지 붙여넣기",
      trigger: "click"
    },
    {
      key: "J",
      action: "previous-cue-in-lane",
      targetId: "previous-cue-in-lane",
      label: "같은 자막 라인의 이전 자막으로 이동",
      trigger: "click"
    },
    {
      key: "K",
      action: "next-cue-in-lane",
      targetId: "next-cue-in-lane",
      label: "같은 자막 라인의 다음 자막으로 이동",
      trigger: "click"
    },
    {
      key: "M",
      action: "toggle-mute",
      targetId: "toggle-mute",
      label: "미리보기 음소거 전환",
      trigger: "click"
    },
    {
      key: "N",
      action: "add-subtitle-lane",
      targetId: "add-subtitle-lane",
      label: "자막 레인 추가",
      trigger: "click"
    },
    {
      key: "P",
      action: "focus-source",
      targetId: "focus-source",
      label: "원본 영상 탭으로 이동",
      trigger: "click"
    },
    {
      key: "Q",
      action: "open-local-drafts",
      targetId: "open-local-drafts",
      label: "최근 로컬 임시저장 목록 열기",
      trigger: "click"
    },
    {
      key: "C",
      action: "caption-mode-tab",
      targetId: "caption-mode-tab",
      label: "자막 편집 탭 열기",
      trigger: "click"
    },
    {
      key: "V",
      action: "asset-mode-tab",
      targetId: "asset-mode-tab",
      label: "에셋 편집 탭 열기",
      trigger: "click"
    },
    {
      key: "B",
      action: "audio-mode-tab",
      targetId: "audio-mode-tab",
      label: "음성 편집 탭 열기",
      trigger: "click"
    },
    {
      key: "X",
      action: "toggle-cue-caption-background",
      targetId: "toggle-caption-background",
      label: "선택 자막 검은 상자 전환",
      trigger: "click"
    },
    {
      key: "W",
      action: "preview-source-tab",
      targetId: "preview-source-tab",
      label: "원본 영상의 현재 시각으로 이동",
      trigger: "click"
    },
    {
      key: "E",
      action: "pick-media",
      targetId: "pick-media",
      alternateTargetIds: ["pick-media-empty"],
      label: "원본 미디어 선택",
      trigger: "click"
    },
    {
      key: "I",
      action: "set-range-start",
      targetId: "set-range-start",
      label: "현재 위치를 구간 시작점으로 지정",
      trigger: "click"
    },
    {
      key: "O",
      action: "set-range-end",
      targetId: "set-range-end",
      label: "현재 위치를 구간 끝점으로 지정",
      trigger: "click"
    }
  ]
);

export const KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE = Object.freeze({
  sidepanel: SIDEPANEL_SHORTCUT_BINDINGS,
  editor: EDITOR_SHORTCUT_BINDINGS
});

export function keyboardShortcutBindingForScope(
  scope: KeyboardShortcutScope,
  key: unknown
): KeyboardShortcutBinding | null {
  const normalizedKey = normalizeKeyboardShortcutLetter(key);
  if (!normalizedKey) {
    return null;
  }
  return (
    KEYBOARD_SHORTCUT_BINDINGS_BY_SCOPE[scope]
      .find((binding) => binding.key === normalizedKey)
    || null
  );
}
