import {
  formatKeyboardShortcutHint,
  keyboardShortcutLetterFromEvent,
  normalizeKeyboardShortcutLetter
} from "../lib/keyboard-shortcuts.js";
import type {
  KeyboardShortcutEventLike,
  KeyboardShortcutLetter
} from "../lib/keyboard-shortcuts.js";

export type StudioCaptureAction =
  | "refresh-recovery-sessions"
  | "open-editor";

export interface StudioCaptureShortcutBinding {
  readonly key: KeyboardShortcutLetter;
  readonly action: StudioCaptureAction;
  readonly targetId: string | null;
  readonly label: string;
  readonly title: string;
}

const RAW_STUDIO_CAPTURE_SHORTCUT_BINDINGS = [
  {
    key: "Q",
    action: "refresh-recovery-sessions",
    targetId: null,
    label: "저장된 편집 새로고침"
  },
  {
    key: "A",
    action: "open-editor",
    targetId: null,
    label: "권리 확인 후 편집기 열기"
  }
] as const satisfies readonly Omit<StudioCaptureShortcutBinding, "title">[];

/** The web start screen owns only its two visible, user-facing shortcuts. */
export const STUDIO_CAPTURE_SHORTCUT_BINDINGS = Object.freeze(
  RAW_STUDIO_CAPTURE_SHORTCUT_BINDINGS.map((binding) => Object.freeze({
    ...binding,
    title: formatKeyboardShortcutHint(binding.label, binding.key)
  }))
) satisfies readonly StudioCaptureShortcutBinding[];

export function studioCaptureShortcutBinding(
  value: unknown
): StudioCaptureShortcutBinding | null {
  const key = normalizeKeyboardShortcutLetter(value);
  if (!key) {
    return null;
  }
  return STUDIO_CAPTURE_SHORTCUT_BINDINGS.find(
    (binding) => binding.key === key
  ) || null;
}

/** Keep the shared IME, modifier, repeat, and interactive-target protections. */
export function studioCaptureShortcutLetterFromEvent(
  event: KeyboardShortcutEventLike
): KeyboardShortcutLetter | null {
  return keyboardShortcutLetterFromEvent(event);
}
