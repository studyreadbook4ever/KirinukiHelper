/** A source-space rectangle. Normalized edges survive media resolution changes. */
export interface VideoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoCropPixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const FULL_VIDEO_CROP: Readonly<VideoCrop> = Object.freeze({
  x: 0, y: 0, width: 1, height: 1
});

/** The existing main-video delivery frame: at most 1080p, codec-safe even edges. */
export function mainVideoOutputDimensions(width: number | null, height: number | null) {
  const sourceWidth = Math.max(2, width || 1280);
  const sourceHeight = Math.max(2, height || 720);
  const scale = Math.min(1, 1920 / sourceWidth, 1080 / sourceHeight);
  return {
    width: Math.max(2, Math.round(sourceWidth * scale / 2) * 2),
    height: Math.max(2, Math.round(sourceHeight * scale / 2) * 2)
  };
}

/** null means the original full frame; old projects need no migration flag. */
export function normalizeVideoCrop(value: unknown): VideoCrop | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (![raw.x, raw.y, raw.width, raw.height].every((part) => (
    typeof part === "number" && Number.isFinite(part)
  ))) return null;
  const x = Math.max(0, Math.min(1, raw.x as number));
  const y = Math.max(0, Math.min(1, raw.y as number));
  const width = Math.min(1 - x, raw.width as number);
  const height = Math.min(1 - y, raw.height as number);
  if (width <= 0 || height <= 0) return null;
  if (x === 0 && y === 0 && width === 1 && height === 1) return null;
  return { x, y, width, height };
}

function dimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

/** Integer display pixels, shared by the native-video preview and the encoder. */
export function videoCropSourceRect(
  sourceWidthValue: number,
  sourceHeightValue: number,
  value: unknown
): VideoCropPixelRect {
  const sourceWidth = dimension(sourceWidthValue);
  const sourceHeight = dimension(sourceHeightValue);
  const crop = normalizeVideoCrop(value) ?? FULL_VIDEO_CROP;
  const left = Math.min(sourceWidth - 1, Math.round(crop.x * sourceWidth));
  const top = Math.min(sourceHeight - 1, Math.round(crop.y * sourceHeight));
  const right = Math.min(sourceWidth, Math.max(left + 1, Math.round((crop.x + crop.width) * sourceWidth)));
  const bottom = Math.min(sourceHeight, Math.max(top + 1, Math.round((crop.y + crop.height) * sourceHeight)));
  return { left, top, width: right - left, height: bottom - top };
}

/** Keep the output frame and overlay coordinates; contain the selected region. */
export function videoCropDrawGeometry(
  sourceWidth: number,
  sourceHeight: number,
  outputWidthValue: number,
  outputHeightValue: number,
  crop: unknown
): { source: VideoCropPixelRect; destination: VideoCropPixelRect } {
  const source = videoCropSourceRect(sourceWidth, sourceHeight, crop);
  const outputWidth = dimension(outputWidthValue);
  const outputHeight = dimension(outputHeightValue);
  const scale = Math.min(outputWidth / source.width, outputHeight / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    source,
    destination: { left: (outputWidth - width) / 2, top: (outputHeight - height) / 2, width, height }
  };
}
