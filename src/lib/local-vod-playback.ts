import { canonicalSupportedVodSourceUrl } from "./source-embed.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  inferSourceIdentifiers
} from "./source-platform.js";

export const LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL =
  "kirinuki-local-vod-playback-create/v1";
export const LOCAL_VOD_PLAYBACK_SESSION_SCHEMA =
  "kirinuki-local-vod-playback-session/v1";

export interface LocalVodPlaybackPart {
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly manifestUrl: string;
}

export interface LocalVodPlaybackSession {
  readonly schema: typeof LOCAL_VOD_PLAYBACK_SESSION_SCHEMA;
  readonly platform: typeof SOURCE_PLATFORM_CHZZK | typeof SOURCE_PLATFORM_SOOP;
  readonly contentId: string;
  readonly sourceUrl: string;
  readonly durationSeconds: number;
  readonly parts: readonly LocalVodPlaybackPart[];
}

export function localVodPlaybackPartForSourceTime(
  session: LocalVodPlaybackSession,
  sourceSeconds: number
): LocalVodPlaybackPart {
  if (!Number.isFinite(sourceSeconds)) {
    throw new TypeError("원본 재생 시각이 올바르지 않습니다.");
  }
  const clamped = Math.max(0, Math.min(session.durationSeconds, sourceSeconds));
  return session.parts.find((part) => clamped < part.endSeconds)
    || session.parts.at(-1)!;
}

export function localVodPlaybackSourceSeconds(
  part: LocalVodPlaybackPart,
  mediaSeconds: number
): number {
  if (!Number.isFinite(mediaSeconds)) {
    throw new TypeError("영상 재생 시각이 올바르지 않습니다.");
  }
  return Math.max(
    part.startSeconds,
    Math.min(part.endSeconds, part.startSeconds + mediaSeconds)
  );
}

export function localVodPlaybackCreateRequest(sourceValue: unknown): Readonly<{
  schema: typeof LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL;
  sourceUrl: string;
}> {
  const sourceUrl = canonicalSupportedVodSourceUrl(sourceValue);
  const identifiers = sourceUrl ? inferSourceIdentifiers(sourceUrl) : null;
  if (
    !sourceUrl
    || !identifiers?.contentId
    || ![SOURCE_PLATFORM_CHZZK, SOURCE_PLATFORM_SOOP].includes(
      identifiers.platform as typeof SOURCE_PLATFORM_CHZZK | typeof SOURCE_PLATFORM_SOOP
    )
  ) {
    throw new TypeError("CHZZK·SOOP 공개 VOD의 정규 주소가 필요합니다.");
  }
  return Object.freeze({
    schema: LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL,
    sourceUrl
  });
}

export function parseLocalVodPlaybackCreateRequest(value: unknown): Readonly<{
  schema: typeof LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL;
  sourceUrl: string;
}> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL
    || Object.keys(record).sort().join(",") !== "schema,sourceUrl"
  ) {
    return null;
  }
  try {
    return localVodPlaybackCreateRequest(record.sourceUrl);
  } catch {
    return null;
  }
}

export function parseLocalVodPlaybackSession(
  value: unknown,
  expectedSourceUrl?: string
): LocalVodPlaybackSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",")
      !== "contentId,durationSeconds,parts,platform,schema,sourceUrl"
    || record.schema !== LOCAL_VOD_PLAYBACK_SESSION_SCHEMA
    || (record.platform !== SOURCE_PLATFORM_CHZZK
      && record.platform !== SOURCE_PLATFORM_SOOP)
    || typeof record.contentId !== "string"
    || !/^\d{1,32}$/u.test(record.contentId)
    || typeof record.sourceUrl !== "string"
    || canonicalSupportedVodSourceUrl(record.sourceUrl) !== record.sourceUrl
    || (expectedSourceUrl !== undefined && record.sourceUrl !== expectedSourceUrl)
    || typeof record.durationSeconds !== "number"
    || !Number.isFinite(record.durationSeconds)
    || record.durationSeconds <= 0
    || record.durationSeconds > 2_592_000
    || !Array.isArray(record.parts)
    || record.parts.length === 0
    || record.parts.length > 512
  ) {
    return null;
  }
  let expectedStart = 0;
  const parts: LocalVodPlaybackPart[] = [];
  for (const [index, valuePart] of record.parts.entries()) {
    if (!valuePart || typeof valuePart !== "object" || Array.isArray(valuePart)) {
      return null;
    }
    const part = valuePart as Record<string, unknown>;
    if (
      Object.keys(part).sort().join(",")
        !== "endSeconds,index,manifestUrl,startSeconds"
      || part.index !== index
      || part.startSeconds !== expectedStart
      || typeof part.endSeconds !== "number"
      || !Number.isFinite(part.endSeconds)
      || part.endSeconds <= expectedStart
      || typeof part.manifestUrl !== "string"
    ) {
      return null;
    }
    let manifestUrl: URL;
    try {
      manifestUrl = new URL(part.manifestUrl);
    } catch {
      return null;
    }
    if (
      manifestUrl.origin !== "http://127.0.0.1:4319"
      || manifestUrl.search
      || manifestUrl.hash
      || !/^\/v1\/playback\/[-_A-Za-z0-9]{43}\/part\/\d+\/index\.m3u8$/u
        .test(manifestUrl.pathname)
    ) {
      return null;
    }
    parts.push(Object.freeze({
      index,
      startSeconds: expectedStart,
      endSeconds: part.endSeconds,
      manifestUrl: manifestUrl.href
    }));
    expectedStart = part.endSeconds;
  }
  if (Math.abs(expectedStart - record.durationSeconds) > 0.001) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_VOD_PLAYBACK_SESSION_SCHEMA,
    platform: record.platform,
    contentId: record.contentId,
    sourceUrl: record.sourceUrl,
    durationSeconds: record.durationSeconds,
    parts: Object.freeze(parts)
  });
}
