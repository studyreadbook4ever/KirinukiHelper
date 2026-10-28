import {
  cueTimelineRange,
  subtitleCueNeedsReview
} from "./editor-core.js";
import type {
  EditorProject,
  EditorSubtitleCue
} from "./editor-core.js";

export type CaptionReviewFilter = "all" | "review" | "blank";

export interface CaptionReviewEntry {
  readonly cue: EditorSubtitleCue;
  readonly startMs: number;
  readonly endMs: number;
  readonly needsReview: boolean;
  readonly blank: boolean;
}

export interface CaptionReviewList {
  readonly entries: readonly CaptionReviewEntry[];
  readonly matchingEntries: readonly CaptionReviewEntry[];
  readonly reviewCount: number;
  readonly blankCount: number;
}

function searchableText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** A transient view of active captions; never edits captions or their order. */
export function createCaptionReviewList(
  project: EditorProject,
  { query = "", filter = "all" }: {
    readonly query?: string;
    readonly filter?: CaptionReviewFilter;
  } = {}
): CaptionReviewList {
  const entries = project.subtitles.flatMap((cue): CaptionReviewEntry[] => {
    const range = cueTimelineRange(project, cue);
    return range ? [{
      cue,
      ...range,
      needsReview: subtitleCueNeedsReview(cue),
      blank: cue.text.trim().length === 0
    }] : [];
  }).sort((left, right) => left.startMs - right.startMs);
  const needle = searchableText(query);
  return {
    entries,
    matchingEntries: entries.filter((entry) => (
      (filter === "all" || (filter === "review" ? entry.needsReview : entry.blank))
      && (!needle || searchableText(entry.cue.text).includes(needle))
    )),
    reviewCount: entries.filter((entry) => entry.needsReview).length,
    blankCount: entries.filter((entry) => entry.blank).length
  };
}

/** Advances across all lanes and wraps, independently of the list filter. */
export function nextCaptionNeedingReview(
  entries: readonly CaptionReviewEntry[],
  selectedCueId: string | null | undefined,
  playheadMs: number
): EditorSubtitleCue | null {
  const selectedIndex = entries.findIndex(({ cue }) => cue.id === selectedCueId);
  if (selectedIndex >= 0) {
    for (let offset = 1; offset <= entries.length; offset += 1) {
      const entry = entries[(selectedIndex + offset) % entries.length];
      if (entry?.needsReview) {
        return entry.cue;
      }
    }
    return null;
  }
  return entries.find((entry) => entry.needsReview && entry.startMs >= playheadMs)?.cue
    ?? entries.find((entry) => entry.needsReview)?.cue
    ?? null;
}
