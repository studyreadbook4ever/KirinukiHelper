import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  canonicalSourceUrl,
  inferSourceIdentifiers
} from "./source-platform.js";
import type { SourceIdentifiers } from "./source-platform.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  requireKirinukiStudioOrigin
} from "./local-runtime-origin.js";

export type SourceEmbedKind = "official-embed" | "framed-source";

export interface SourceEmbedDescriptor {
  platform: string;
  sourceUrl: string;
  embedUrl: string;
  kind: SourceEmbedKind;
  label: string;
}

function exactStudioOrigin(value: unknown): string {
  return requireKirinukiStudioOrigin(value, "Kirinuki 웹 Origin");
}

function exactEmbeddablePath(
  value: unknown,
  platform: string,
  contentId: string
): boolean {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return false;
  }
  const encodedId = encodeURIComponent(contentId);
  if (platform === SOURCE_PLATFORM_YOUTUBE) {
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (hostname === "youtu.be") {
      return url.pathname === `/${encodedId}` || url.pathname === `/${encodedId}/`;
    }
    if (url.pathname === "/watch") {
      return url.searchParams.get("v") === contentId;
    }
    return url.pathname === `/shorts/${encodedId}`
      || url.pathname === `/shorts/${encodedId}/`
      || url.pathname === `/embed/${encodedId}`
      || url.pathname === `/embed/${encodedId}/`
      // YouTube uses /live/<video-id> for both an active broadcast and its
      // completed archive. Treat it as a candidate VOD here; the local
      // materializer still rejects is_live/is_upcoming metadata before it
      // downloads a byte.
      || url.pathname === `/live/${encodedId}`
      || url.pathname === `/live/${encodedId}/`;
  }
  if (platform === SOURCE_PLATFORM_CHZZK) {
    return /^\d+$/u.test(contentId)
      && (url.pathname === `/video/${encodedId}`
        || url.pathname === `/video/${encodedId}/`);
  }
  if (platform === SOURCE_PLATFORM_SOOP) {
    return /^\/(?:player|PLAYER\/STATION)\/\d+\/?$/u.test(url.pathname);
  }
  return false;
}

interface SupportedVodSource {
  identifiers: SourceIdentifiers;
  sourceUrl: string;
}

function supportedVodSource(value: unknown): SupportedVodSource | null {
  const identifiers = inferSourceIdentifiers(value);
  const sourceUrl = canonicalSourceUrl(value, identifiers);
  if (
    !sourceUrl
    || identifiers.contentType !== "vod"
    || !identifiers.contentId
    || !exactEmbeddablePath(
      value,
      identifiers.platform,
      identifiers.contentId
    )
  ) {
    return null;
  }
  return { identifiers, sourceUrl };
}

/**
 * Return the canonical URL only when the input is an exact VOD route that the
 * editor can open. Redirectors and broader platform pages intentionally do not
 * belong to this contract.
 */
export function canonicalSupportedVodSourceUrl(value: unknown): string | null {
  return supportedVodSource(value)?.sourceUrl ?? null;
}

/**
 * Build only platform-owned browser player URLs. No media URL, cookie, token,
 * proxy, or server-side fetch is introduced at this boundary.
 */
export function sourceEmbedDescriptor(
  value: unknown,
  {
    studioOrigin = KIRINUKI_LOCAL_STUDIO_ORIGIN
  }: { studioOrigin?: string } = {}
): Readonly<SourceEmbedDescriptor> | null {
  const supported = supportedVodSource(value);
  if (!supported) {
    return null;
  }
  const { identifiers, sourceUrl } = supported;
  if (identifiers.platform === SOURCE_PLATFORM_YOUTUBE) {
    const origin = exactStudioOrigin(studioOrigin);
    const embed = new URL(
      `https://www.youtube-nocookie.com/embed/${encodeURIComponent(identifiers.contentId)}`
    );
    embed.searchParams.set("playsinline", "1");
    embed.searchParams.set("enablejsapi", "1");
    embed.searchParams.set("origin", origin);
    return Object.freeze({
      platform: SOURCE_PLATFORM_YOUTUBE,
      sourceUrl,
      embedUrl: embed.href,
      kind: "official-embed",
      label: "YouTube 임베드 플레이어"
    });
  }
  if (identifiers.platform === SOURCE_PLATFORM_SOOP) {
    const embed = new URL(
      `https://vod.sooplive.com/player/${encodeURIComponent(identifiers.contentId)}/embed`
    );
    // SOOP does not create its official controller media object until playback
    // starts. Muted autoplay prepares the clock without surprising the user
    // with sound and lets the cut controls connect on first load.
    embed.searchParams.set("autoPlay", "true");
    embed.searchParams.set("showChat", "false");
    embed.searchParams.set("mutePlay", "true");
    return Object.freeze({
      platform: SOURCE_PLATFORM_SOOP,
      sourceUrl,
      embedUrl: embed.href,
      kind: "official-embed",
      label: "SOOP 임베드 플레이어"
    });
  }
  if (identifiers.platform === SOURCE_PLATFORM_CHZZK) {
    // CHZZK publicly documents a clip embed but not a VOD-specific embed URL.
    // Its current VOD response allows framing, so use the canonical platform
    // page without inventing an undocumented player route. The UI always keeps
    // a new-tab escape hatch in case CHZZK changes that response policy.
    return Object.freeze({
      platform: SOURCE_PLATFORM_CHZZK,
      sourceUrl,
      embedUrl: sourceUrl,
      kind: "framed-source",
      label: "CHZZK VOD 원본 창"
    });
  }
  return null;
}
