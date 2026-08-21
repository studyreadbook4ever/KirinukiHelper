export const SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA =
  "kirinuki-soop-vod-source-clock/v1";

export const MAX_SOOP_VOD_SOURCE_CLOCK_PARTS = 512;
export const MAX_SOOP_VOD_SOURCE_CLOCK_SECONDS = 2_592_000;

export interface SoopVodSourceClockPartIdentity {
  readonly id: string;
  readonly index: number;
  readonly order: number;
  readonly durationSeconds: number;
}

/**
 * Secret-free identity for the exact official SOOP multipart clock. The local
 * media engine derives this from one yt-dlp root dump and its complete ordered
 * `entries`; an older browser/player vector may still be compared with it as
 * an optional compatibility assertion. It intentionally contains no URL,
 * token, header, title, creator metadata, or playback history.
 */
export interface SoopVodSourceClockIdentity {
  readonly schema: typeof SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA;
  readonly platform: "SOOP";
  readonly contentId: string;
  readonly totalDurationSeconds: number;
  readonly parts: readonly SoopVodSourceClockPartIdentity[];
}

type UnknownRecord = Record<string, unknown>;

const SOOP_CONTENT_ID_PATTERN = /^\d{1,32}$/u;
const SOOP_PART_ID_PATTERN = /^[A-Za-z0-9_-]{1,240}$/u;

export interface SoopVodOfficialClockPartMetadata {
  readonly id: string;
  readonly durationSeconds: number;
}

export interface SoopVodOfficialClockMetadata {
  readonly contentId: string;
  readonly totalDurationSeconds: number;
  readonly parts: readonly SoopVodOfficialClockPartMetadata[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function normalizeSoopVodSourceClockIdentity(
  value: unknown
): SoopVodSourceClockIdentity | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "schema",
      "platform",
      "contentId",
      "totalDurationSeconds",
      "parts"
    ])
    || value.schema !== SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
    || value.platform !== "SOOP"
    || typeof value.contentId !== "string"
    || !SOOP_CONTENT_ID_PATTERN.test(value.contentId)
    || !Array.isArray(value.parts)
    || value.parts.length === 0
    || value.parts.length > MAX_SOOP_VOD_SOURCE_CLOCK_PARTS
  ) {
    return null;
  }

  const ids = new Set<string>();
  const parts: SoopVodSourceClockPartIdentity[] = [];
  let totalDurationSeconds = 0;
  for (let index = 0; index < value.parts.length; index += 1) {
    const part = value.parts[index];
    if (
      !isRecord(part)
      || !hasExactKeys(part, ["id", "index", "order", "durationSeconds"])
      || typeof part.id !== "string"
      || !SOOP_PART_ID_PATTERN.test(part.id)
      || ids.has(part.id)
      || part.index !== index
      || part.order !== index + 1
      || !Number.isSafeInteger(part.durationSeconds)
      || Number(part.durationSeconds) <= 0
    ) {
      return null;
    }
    totalDurationSeconds += Number(part.durationSeconds);
    if (
      !Number.isSafeInteger(totalDurationSeconds)
      || totalDurationSeconds > MAX_SOOP_VOD_SOURCE_CLOCK_SECONDS
    ) {
      return null;
    }
    ids.add(part.id);
    parts.push(Object.freeze({
      id: part.id,
      index,
      order: index + 1,
      durationSeconds: Number(part.durationSeconds)
    }));
  }
  if (value.totalDurationSeconds !== totalDurationSeconds) {
    return null;
  }
  return Object.freeze({
    schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
    platform: "SOOP",
    contentId: value.contentId,
    totalDurationSeconds,
    parts: Object.freeze(parts)
  });
}

/**
 * Builds the canonical identity from the complete official root/entry clock.
 * Returning `null` is deliberately fail-closed: callers must not invent part
 * IDs, round fractional durations, or continue with a partial playlist.
 */
export function deriveSoopVodSourceClockIdentity(
  metadata: SoopVodOfficialClockMetadata
): SoopVodSourceClockIdentity | null {
  if (
    !isRecord(metadata)
    || !hasExactKeys(metadata, ["contentId", "totalDurationSeconds", "parts"])
    || !Array.isArray(metadata.parts)
  ) {
    return null;
  }
  return normalizeSoopVodSourceClockIdentity({
    schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
    platform: "SOOP",
    contentId: metadata.contentId,
    totalDurationSeconds: metadata.totalDurationSeconds,
    parts: metadata.parts.map((part, index) => ({
      id: part?.id,
      index,
      order: index + 1,
      durationSeconds: part?.durationSeconds
    }))
  });
}

export function sameSoopVodSourceClockIdentity(
  left: SoopVodSourceClockIdentity,
  right: SoopVodSourceClockIdentity
): boolean {
  return left.schema === right.schema
    && left.platform === right.platform
    && left.contentId === right.contentId
    && left.totalDurationSeconds === right.totalDurationSeconds
    && left.parts.length === right.parts.length
    && left.parts.every((part, index) => {
      const other = right.parts[index];
      return Boolean(
        other
        && part.id === other.id
        && part.index === other.index
        && part.order === other.order
        && part.durationSeconds === other.durationSeconds
      );
    });
}
