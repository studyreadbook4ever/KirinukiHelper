/** Maximum source clock accepted by the capture form: exactly seven days. */
export const MAX_STUDIO_SOURCE_SECONDS = 7 * 24 * 60 * 60;
export const MINIMUM_STUDIO_SELECTION_MILLISECONDS = 100;
export const STUDIO_SELECTION_RANGE_INPUT_ERROR =
  "시작과 끝 시각을 올바르게 입력해 주세요.";
export const STUDIO_SELECTION_RANGE_ORDER_ERROR =
  "끝 시각은 시작 시각보다 0.1초 이상 뒤여야 합니다.";

export type StudioSelectionRangeValidation = Readonly<{
  status: "blank" | "invalid-timecode" | "invalid-order" | "valid";
  startSeconds: number | null;
  endSeconds: number | null;
}>;

export function parseStudioTimecode(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text || !/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/u.test(text)) {
    return null;
  }
  const parts = text.split(":");
  if (parts.length > 3) {
    return null;
  }
  const seconds = Number(parts.at(-1));
  const minutes = parts.length >= 2 ? Number(parts.at(-2)) : 0;
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (
    !Number.isFinite(seconds)
    || !Number.isFinite(minutes)
    || !Number.isFinite(hours)
    || seconds >= 60
    || (parts.length === 3 && minutes >= 60)
  ) {
    return null;
  }
  const total = hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(total)
    && total >= 0
    && total <= MAX_STUDIO_SOURCE_SECONDS
    ? total
    : null;
}

export function formatStudioTimecode(value: number): string {
  const milliseconds = Math.max(0, Math.round(value * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const fraction = milliseconds % 1_000;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":") + (fraction ? `.${String(fraction).padStart(3, "0")}` : "");
}

export function formatStudioDurationSummary(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "--:--";
  }
  const totalSeconds = Math.max(1, Math.round(value));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":")
    : [minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
}

export function validateStudioSelectionRange(
  startValue: unknown,
  endValue: unknown
): StudioSelectionRangeValidation {
  const startText = String(startValue ?? "").trim();
  const endText = String(endValue ?? "").trim();
  if (!startText && !endText) {
    return { status: "blank", startSeconds: null, endSeconds: null };
  }
  const startSeconds = parseStudioTimecode(startText);
  const endSeconds = parseStudioTimecode(endText);
  if (startSeconds === null || endSeconds === null) {
    return { status: "invalid-timecode", startSeconds, endSeconds };
  }
  const durationMilliseconds = (
    Math.round(endSeconds * 1_000) - Math.round(startSeconds * 1_000)
  );
  return {
    status: durationMilliseconds < MINIMUM_STUDIO_SELECTION_MILLISECONDS
      ? "invalid-order"
      : "valid",
    startSeconds,
    endSeconds
  };
}
