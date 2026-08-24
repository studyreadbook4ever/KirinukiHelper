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
  | "capture-start"
  | "capture-end"
  | "save-segment"
  | "open-editor"
  | "player-seek-backward-five"
  | "player-seek-forward-five"
  | "player-rate-quarter"
  | "player-rate-double";

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
    key: "E",
    action: "capture-start",
    targetId: "capture-start",
    label: "현재 시각을 시작점으로 캡처"
  },
  {
    key: "R",
    action: "capture-end",
    targetId: "capture-end",
    label: "현재 시각을 끝점으로 캡처"
  },
  {
    key: "T",
    action: "save-segment",
    targetId: "save-segment",
    label: "다음 빈 구간 추가"
  },
  {
    key: "A",
    action: "open-editor",
    targetId: null,
    label: "권리 확인 후 편집기 열기"
  },
  {
    key: "D",
    action: "player-seek-backward-five",
    targetId: "seek-backward-five",
    label: "원본 영상을 5초 이전으로 이동"
  },
  {
    key: "F",
    action: "player-seek-forward-five",
    targetId: "seek-forward-five",
    label: "원본 영상을 5초 이후로 이동"
  },
  {
    key: "Y",
    action: "player-rate-quarter",
    targetId: "playback-rate-quarter",
    label: "원본 영상을 0.25배속으로 재생"
  },
  {
    key: "U",
    action: "player-rate-double",
    targetId: "playback-rate-double",
    label: "원본 영상을 2배속으로 재생"
  }
] as const satisfies readonly Omit<StudioCaptureShortcutBinding, "title">[];

/** The public web capture screen owns every visible PR16-era cut shortcut. */
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
