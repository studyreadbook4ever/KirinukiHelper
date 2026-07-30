export const PREVIEW_BOUNDARY_TOLERANCE_MS = 20;

export interface PreviewClip {
  id: string;
  enabled?: boolean;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
}

export interface PreparedPreview {
  ready?: boolean;
  clipId?: string;
  targetSeconds?: number;
}

export function nextEnabledPreviewClip<T extends PreviewClip>(
  clips: readonly T[] | unknown,
  activeClipId: string | null | undefined
): T | null {
  if (!Array.isArray(clips) || !activeClipId) {
    return null;
  }
  const enabled = clips.filter((clip) => clip?.enabled !== false);
  const activeIndex = enabled.findIndex((clip) => clip.id === activeClipId);
  return activeIndex >= 0 ? enabled[activeIndex + 1] || null : null;
}

export function previewReachedClipBoundary(
  sourceMs: number,
  sourceEndMs: number,
  toleranceMs: number = PREVIEW_BOUNDARY_TOLERANCE_MS
): boolean {
  if (!Number.isFinite(sourceMs) || !Number.isFinite(sourceEndMs)) {
    return false;
  }
  const tolerance = Math.max(0, Number(toleranceMs) || 0);
  return sourceMs >= sourceEndMs - tolerance;
}

export function preparedPreviewMatches(
  prepared: PreparedPreview | null | undefined,
  clip: PreviewClip | null | undefined,
  targetSeconds: number
): boolean {
  const preparedTargetSeconds = prepared?.targetSeconds;
  return Boolean(
    prepared
    && clip
    && prepared.ready === true
    && prepared.clipId === clip.id
    && Number.isFinite(preparedTargetSeconds)
    && Number.isFinite(targetSeconds)
    && Math.abs((preparedTargetSeconds as number) - targetSeconds) <= 0.03
  );
}
