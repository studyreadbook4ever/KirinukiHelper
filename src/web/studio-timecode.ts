/** Maximum source clock accepted by the capture form: exactly seven days. */
export const MAX_STUDIO_SOURCE_SECONDS = 7 * 24 * 60 * 60;

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
