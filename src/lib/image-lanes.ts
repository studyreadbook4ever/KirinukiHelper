export const MIN_IMAGE_LANES = 1;
export const MAX_IMAGE_LANES = 8;

interface LaneAsset {
  readonly clipId: string;
  readonly startOffsetMs: number;
  readonly endOffsetMs: number;
  readonly lane?: number;
}

interface LaneClip {
  readonly id: string;
  readonly timelineStartMs: number;
}

export function imageLaneAvailable(
  assets: readonly LaneAsset[],
  clips: readonly LaneClip[],
  lane: number,
  startMs: number,
  endMs: number
): boolean {
  return !assets.some((asset) => {
    if ((asset.lane ?? 0) !== lane) return false;
    const clip = clips.find((candidate) => candidate.id === asset.clipId);
    return Boolean(clip
      && clip.timelineStartMs + asset.startOffsetMs < endMs
      && clip.timelineStartMs + asset.endOffsetMs > startMs);
  });
}

/** Migrate only missing lanes; never reorder the paint stack or alter content. */
export function normalizeImageLaneLayout<T extends LaneAsset>(
  assets: readonly T[],
  clips: readonly LaneClip[],
  requestedCount: unknown
): { imageAssets: Array<T & { lane: number }>; imageLaneCount: number } {
  const requested = typeof requestedCount === "number" && Number.isSafeInteger(requestedCount)
    ? Math.max(1, Math.min(4_096, requestedCount)) : MIN_IMAGE_LANES;
  const limit = Math.max(MAX_IMAGE_LANES, requested, assets.length);
  const validLane = (lane: unknown): lane is number => typeof lane === "number"
    && Number.isSafeInteger(lane) && lane >= 0 && lane < limit;
  const assigned = new Map<number, number>();
  const occupied: Array<LaneAsset> = assets.filter((asset) => validLane(asset.lane));
  const ordered = assets.map((asset, index) => ({
    asset, index,
    startMs: (clips.find((clip) => clip.id === asset.clipId)?.timelineStartMs ?? 0) + asset.startOffsetMs
  })).sort((a, b) => a.startMs - b.startMs
    || a.asset.endOffsetMs - a.asset.startOffsetMs - (b.asset.endOffsetMs - b.asset.startOffsetMs)
    || a.index - b.index);
  for (const { asset, index, startMs } of ordered) {
    if (validLane(asset.lane)) {
      assigned.set(index, asset.lane);
      continue;
    }
    let lane = 0;
    while (!imageLaneAvailable(occupied, clips, lane, startMs,
      startMs + asset.endOffsetMs - asset.startOffsetMs)) lane += 1;
    assigned.set(index, lane);
    occupied.push({ ...asset, lane });
  }
  const imageAssets = assets.map((asset, index) => ({ ...asset, lane: assigned.get(index)! }));
  return {
    imageAssets,
    imageLaneCount: Math.max(requested, ...imageAssets.map((asset) => asset.lane + 1))
  };
}

export function lastEmptyLane(
  count: number,
  items: readonly { readonly lane?: number }[],
  minimum: number
): number | null {
  if (count <= minimum) return null;
  for (let lane = count - 1; lane >= 0; lane -= 1) {
    if (!items.some((item) => (item.lane ?? 0) === lane)) return lane;
  }
  return null;
}
