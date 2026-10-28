import { validateStudioSelectionRange } from "./studio-timecode.js";

export const MAX_DELETED_CUT_HISTORY = 30;

/** Tab-memory only: changing the source discards every retained deletion. */
export class DeletedCutHistory<T> {
  #source = "";
  #entries: Array<{ item: T; index: number }> = [];

  clear(): void {
    this.#entries = [];
  }

  #synchronizeSource(source: string): void {
    if (this.#source !== source) {
      this.clear();
      this.#source = source;
    }
  }

  count(source: string): number {
    this.#synchronizeSource(source);
    return this.#entries.length;
  }

  push(source: string, item: T, index: number): void {
    this.#synchronizeSource(source);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new TypeError("Invalid deleted cut position");
    }
    this.#entries.push({ item, index });
    if (this.#entries.length > MAX_DELETED_CUT_HISTORY) {
      this.#entries.shift();
    }
  }

  pop(source: string): { item: T; index: number } | null {
    this.#synchronizeSource(source);
    return this.#entries.pop() ?? null;
  }
}

/** Read-only review never repairs, clamps, or rewrites user-selected ranges. */
export function studioCutReview(
  start: string,
  end: string,
  sourceDuration: number | null
): {
  durationSeconds: number | null;
  startTarget: number | null;
  endTarget: number | null;
} {
  const validation = validateStudioSelectionRange(start, end);
  if (validation.status !== "valid") {
    return { durationSeconds: null, startTarget: null, endTarget: null };
  }
  const startSeconds = validation.startSeconds!;
  const endSeconds = validation.endSeconds!;
  const canSeek = sourceDuration !== null
    && Number.isFinite(sourceDuration)
    && sourceDuration > 0;
  return {
    durationSeconds: (
      Math.round(endSeconds * 1_000) - Math.round(startSeconds * 1_000)
    ) / 1_000,
    startTarget: canSeek && startSeconds <= sourceDuration ? startSeconds : null,
    endTarget: canSeek && endSeconds <= sourceDuration ? endSeconds : null
  };
}
