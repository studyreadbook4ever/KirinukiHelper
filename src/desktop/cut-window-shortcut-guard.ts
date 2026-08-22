const CUT_SHORTCUT_CODES = new Set([
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyT",
  "KeyA",
  "KeyD",
  "KeyF",
  "KeyY",
  "KeyU"
]);

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox"]);
const INSTALLATION_MARKER = "kirinuki-cut-shortcut-guard/v1";
const INSTALLATION_SLOT = "__kirinukiCutShortcutGuardV1";

export interface CutShortcutEventTargetLike {
  readonly nodeType?: unknown;
  readonly parentElement?: CutShortcutEventTargetLike | null;
  readonly tagName?: unknown;
  readonly isContentEditable?: unknown;
  readonly getAttribute?: (name: string) => unknown;
}

export interface CutShortcutKeyboardEventLike {
  readonly type?: unknown;
  readonly isTrusted?: unknown;
  readonly code?: unknown;
  readonly repeat?: unknown;
  readonly isComposing?: unknown;
  readonly ctrlKey?: unknown;
  readonly metaKey?: unknown;
  readonly altKey?: unknown;
  readonly shiftKey?: unknown;
  readonly target?: CutShortcutEventTargetLike | null;
  readonly composedPath?: () => readonly unknown[];
  readonly preventDefault?: () => void;
  readonly stopImmediatePropagation?: () => void;
}

interface CutShortcutGuardHost {
  readonly addEventListener: (
    type: string,
    listener: (event: CutShortcutKeyboardEventLike) => void,
    options: Readonly<{ capture: true; passive: false }>
  ) => void;
  readonly [INSTALLATION_SLOT]?: unknown;
}

function eventPath(
  event: Readonly<CutShortcutKeyboardEventLike>
): readonly CutShortcutEventTargetLike[] {
  let values: readonly unknown[] = [];
  try {
    values = event.composedPath?.() ?? [];
  } catch {
    return [];
  }
  if (values.length === 0 && event.target) {
    values = [event.target];
  }
  return values.filter((value): value is CutShortcutEventTargetLike => (
    value !== null && typeof value === "object"
  ));
}

function isEditableTarget(value: Readonly<CutShortcutEventTargetLike>): boolean {
  const element = value.nodeType === 3 ? value.parentElement : value;
  if (!element) {
    return false;
  }
  const tag = String(element.tagName || "").toUpperCase();
  if (EDITABLE_TAGS.has(tag) || element.isContentEditable === true) {
    return true;
  }
  let role = "";
  try {
    role = String(element.getAttribute?.("role") || "").toLowerCase();
  } catch {
    return true;
  }
  return EDITABLE_ROLES.has(role);
}

export function trustedCutShortcutEventCode(
  event: Readonly<CutShortcutKeyboardEventLike>
): string | null {
  const code = String(event.code || "");
  if (
    event.type !== "keydown"
    || event.isTrusted !== true
    || event.repeat === true
    || event.isComposing === true
    || event.ctrlKey === true
    || event.metaKey === true
    || event.altKey === true
    || event.shiftKey === true
    || !CUT_SHORTCUT_CODES.has(code)
    || eventPath(event).some(isEditableTarget)
  ) {
    return null;
  }
  return code;
}

export function installKirinukiCutShortcutGuard(
  host: CutShortcutGuardHost = globalThis as CutShortcutGuardHost
): Readonly<{ status: "installed"; marker: string }> {
  const existing = host[INSTALLATION_SLOT];
  if (existing === INSTALLATION_MARKER) {
    return Object.freeze({ status: "installed", marker: INSTALLATION_MARKER });
  }
  const listener = (event: CutShortcutKeyboardEventLike): void => {
    if (!trustedCutShortcutEventCode(event)) {
      return;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  };
  host.addEventListener("keydown", listener, Object.freeze({
    capture: true,
    passive: false
  }));
  Object.defineProperty(host, INSTALLATION_SLOT, Object.freeze({
    value: INSTALLATION_MARKER,
    configurable: false,
    enumerable: false,
    writable: false
  }));
  return Object.freeze({ status: "installed", marker: INSTALLATION_MARKER });
}
