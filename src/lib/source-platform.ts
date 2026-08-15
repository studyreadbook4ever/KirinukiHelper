export const SOURCE_PLATFORM_CHZZK = "CHZZK";
export const SOURCE_PLATFORM_YOUTUBE = "YOUTUBE";
export const SOURCE_PLATFORM_SOOP = "SOOP";

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const CHZZK_CHANNEL_ID_PATTERN = /^[a-f0-9]{32}$/iu;
const SOOP_VOD_ID_PATTERN = /^\d+$/u;

export interface SourceIdentifiers {
  platform: string;
  channelId: string;
  contentId: string;
  contentType: string;
}

interface SourceIdentityInput {
  platform?: unknown;
  url?: unknown;
  canonicalUrl?: unknown;
  channelId?: unknown;
  contentId?: unknown;
  contentType?: unknown;
}

interface SourceTab {
  id?: unknown;
  url?: unknown;
  active?: unknown;
}

interface SourcePlayerContext {
  contentType?: unknown;
  clipActive?: unknown;
  player?: {
    found?: unknown;
    adActive?: unknown;
    paused?: unknown;
    liveEdgeOffsetSeconds?: number;
  } | null;
}

function parsedHttpsUrl(value: unknown): URL | null {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
  ) {
    return null;
  }
  return url;
}

function isSoopVodHostname(hostname: string): boolean {
  return (
    hostname === "vod.sooplive.com"
    || hostname === "vod.sooplive.co.kr"
    || hostname === "vod.afreecatv.com"
  );
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}

function isYouTubeHostname(hostname: string): boolean {
  return (
    hostname === "youtube.com"
    || hostname === "www.youtube.com"
    || hostname === "m.youtube.com"
    || hostname === "youtu.be"
  );
}

export function sourcePlatformFromUrl(value: unknown): string {
  const url = parsedHttpsUrl(value);
  if (!url) {
    return "";
  }
  const hostname = normalizedHostname(url);
  if (hostname === "chzzk.naver.com") {
    return SOURCE_PLATFORM_CHZZK;
  }
  if (isYouTubeHostname(hostname)) {
    return SOURCE_PLATFORM_YOUTUBE;
  }
  if (isSoopVodHostname(hostname)) {
    return SOURCE_PLATFORM_SOOP;
  }
  return "";
}

export function isSupportedSourceUrl(value: unknown): boolean {
  const identifiers = inferSourceIdentifiers(value);
  if (identifiers.platform === SOURCE_PLATFORM_YOUTUBE) {
    return Boolean(
      identifiers.contentType === "vod"
      && identifiers.contentId
    );
  }
  if (identifiers.platform === SOURCE_PLATFORM_SOOP) {
    return Boolean(
      identifiers.contentType === "vod"
      && identifiers.contentId
    );
  }
  if (identifiers.platform !== SOURCE_PLATFORM_CHZZK) {
    return false;
  }
  if (identifiers.contentType === "live") {
    return Boolean(identifiers.channelId);
  }
  return Boolean(
    ["vod", "clip"].includes(identifiers.contentType)
    && identifiers.contentId
  );
}

function sameSourceIdentity(
  left: Partial<SourceIdentifiers> | null | undefined,
  right: Partial<SourceIdentifiers> | null | undefined
): boolean {
  if (!left?.platform || !right?.platform || left.platform !== right.platform) {
    return false;
  }
  const leftContentType = String(left.contentType || "unknown").toLowerCase();
  const rightContentType = String(right.contentType || "unknown").toLowerCase();
  if (leftContentType !== rightContentType) {
    return false;
  }
  if (left.contentId || right.contentId) {
    return Boolean(
      left.contentId
      && right.contentId
      && left.contentId === right.contentId
    );
  }
  return Boolean(
    left.channelId
    && right.channelId
    && left.channelId === right.channelId
    && left.contentType === right.contentType
  );
}

function expectedSourceIdentifiers(expectedSource: SourceIdentityInput | unknown): SourceIdentifiers {
  const source = (
    expectedSource
    && typeof expectedSource === "object"
    && !Array.isArray(expectedSource)
  )
    ? expectedSource as SourceIdentityInput
    : {};
  const inferred = inferSourceIdentifiers(
    source.canonicalUrl || source.url || ""
  );
  const explicitPlatform = String(source.platform || "")
    .trim()
    .toUpperCase();
  const platform = [
    SOURCE_PLATFORM_CHZZK,
    SOURCE_PLATFORM_YOUTUBE,
    SOURCE_PLATFORM_SOOP
  ].includes(explicitPlatform)
    ? explicitPlatform
    : inferred.platform;
  const explicitContentType = String(source.contentType || "")
    .trim()
    .toLowerCase();
  const hasExplicitContentType = Boolean(
    explicitContentType && explicitContentType !== "unknown"
  );
  const canUseInferredIdentity = Boolean(
    (!explicitPlatform || explicitPlatform === inferred.platform)
    && (
      !hasExplicitContentType
      || explicitContentType === inferred.contentType
    )
  );
  const contentType = hasExplicitContentType
    ? explicitContentType
    : inferred.contentType;
  return {
    platform,
    channelId: String(
      source.channelId
      || (canUseInferredIdentity ? inferred.channelId : "")
      || ""
    ).trim(),
    contentId: String(
      (contentType === "live" ? "" : source.contentId)
      || (canUseInferredIdentity ? inferred.contentId : "")
      || ""
    ).trim(),
    contentType
  };
}

export function selectSupportedSourceTab(tabs: readonly SourceTab[] | unknown, {
  expectedSource = null,
  preferExpectedSource = false,
  preferredTabId = null
}: {
  expectedSource?: SourceIdentityInput | null;
  preferExpectedSource?: boolean;
  preferredTabId?: number | null;
} = {}): SourceTab | null {
  const candidates = ((Array.isArray(tabs) ? tabs : []) as SourceTab[])
    .filter((tab) => (
      Number.isInteger(tab?.id)
      && isSupportedSourceUrl(tab?.url)
    ));
  const expectedIdentity = expectedSourceIdentifiers(expectedSource);
  const expectedMatches = expectedIdentity.platform
    ? candidates.filter((tab) => sameSourceIdentity(
      inferSourceIdentifiers(tab.url),
      expectedIdentity
    ))
    : [];

  if (preferExpectedSource) {
    const preferredCandidate = candidates.find(
      (tab) => tab.id === preferredTabId
    );
    if (preferredCandidate) {
      return preferredCandidate;
    }
    if (expectedMatches.length === 0) {
      const activeCandidate = candidates.find(
        (tab) => tab.active === true
      );
      return activeCandidate
        || (candidates.length === 1 ? candidates[0] ?? null : null);
    }
    const activeExpected = expectedMatches.find(
      (tab) => tab.active === true
    );
    if (activeExpected) {
      return activeExpected;
    }
    return expectedMatches.length === 1
      ? expectedMatches[0] ?? null
      : null;
  }

  const active = candidates.find((tab) => tab.active === true);
  if (active) {
    return active;
  }

  if (expectedMatches.length === 1) {
    return expectedMatches[0] ?? null;
  }

  return candidates.length === 1 ? candidates[0] ?? null : null;
}

export function sourceRefreshFailureAction({
  silent = false,
  hasCurrentContext = false,
  sourceUnavailable = false
} = {}) {
  return (
    silent
    && hasCurrentContext
    && !sourceUnavailable
  )
    ? "retain"
    : "clear";
}

export function canStartSourceRefresh({
  silent = false,
  foregroundRequestCount = 0,
  backgroundRequestCount = 0
} = {}) {
  const pendingRequestCount = (
    Math.max(0, Number(foregroundRequestCount) || 0)
    + Math.max(0, Number(backgroundRequestCount) || 0)
  );
  return !(
    silent
    && pendingRequestCount > 0
  );
}

function youtubeVideoId(value: unknown): string {
  const candidate = String(value || "").trim();
  return YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : "";
}

function youtubeChannelIdFromUrls(values: readonly unknown[]): string {
  for (const value of values) {
    const url = parsedHttpsUrl(value);
    if (!url || !isYouTubeHostname(normalizedHostname(url))) {
      continue;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const channelIndex = parts.indexOf("channel");
    const channelId = parts[channelIndex + 1];
    if (channelIndex >= 0 && channelId) {
      return channelId.slice(0, 128);
    }
    const handle = parts.find((part) => part.startsWith("@"));
    if (handle) {
      return handle.slice(0, 128);
    }
  }
  return "";
}

function inferYouTubeIdentifiers(url: URL, linkedUrls: readonly unknown[]): SourceIdentifiers {
  const hostname = normalizedHostname(url);
  const parts = url.pathname.split("/").filter(Boolean);
  let contentId = "";
  if (hostname === "youtu.be") {
    contentId = youtubeVideoId(parts[0]);
  } else if (url.pathname === "/watch") {
    contentId = youtubeVideoId(url.searchParams.get("v"));
  } else if (
    ["shorts", "embed", "live"].includes(parts[0] ?? "")
  ) {
    contentId = youtubeVideoId(parts[1]);
  }
  return {
    platform: SOURCE_PLATFORM_YOUTUBE,
    channelId: youtubeChannelIdFromUrls(linkedUrls),
    contentId,
    contentType: contentId ? "vod" : "unknown"
  };
}

function inferChzzkIdentifiers(url: URL, linkedUrls: readonly unknown[]): SourceIdentifiers {
  const parts = url.pathname.split("/").filter(Boolean);
  const linkedChannelId = linkedUrls
    .flatMap((value) => {
      const linkedUrl = parsedHttpsUrl(value);
      if (
        !linkedUrl
        || normalizedHostname(linkedUrl) !== "chzzk.naver.com"
      ) {
        return [];
      }
      return linkedUrl.pathname.split("/").filter(Boolean);
    })
    .find((part) => CHZZK_CHANNEL_ID_PATTERN.test(part));
  const channelId = parts.find(
    (part) => CHZZK_CHANNEL_ID_PATTERN.test(part)
  ) || linkedChannelId || "";
  const videoIndex = parts.indexOf("video");
  const liveIndex = parts.indexOf("live");
  const clipsIndex = parts.indexOf("clips");

  if (videoIndex >= 0) {
    return {
      platform: SOURCE_PLATFORM_CHZZK,
      channelId,
      contentId: parts[videoIndex + 1] || "",
      contentType: "vod"
    };
  }
  if (clipsIndex >= 0) {
    return {
      platform: SOURCE_PLATFORM_CHZZK,
      channelId,
      contentId: parts[clipsIndex + 1] || "",
      contentType: "clip"
    };
  }
  return {
    platform: SOURCE_PLATFORM_CHZZK,
    channelId,
    contentId: "",
    contentType: liveIndex >= 0
      ? "live"
      : channelId
        ? "channel"
        : "unknown"
  };
}

function inferSoopIdentifiers(
  url: URL,
  linkedUrls: readonly unknown[]
): SourceIdentifiers {
  const normalizedPath = url.pathname.replace(/\/+$/u, "") || "/";
  const match = /^\/(?:player|PLAYER\/STATION)\/(\d+)$/u.exec(normalizedPath);
  const contentId = match && SOOP_VOD_ID_PATTERN.test(match[1] || "")
    ? match[1] || ""
    : "";
  const channelId = linkedUrls.flatMap((value) => {
    const linkedUrl = parsedHttpsUrl(value);
    if (!linkedUrl) {
      return [];
    }
    const hostname = normalizedHostname(linkedUrl);
    if (
      hostname !== "sooplive.com"
      && hostname !== "www.sooplive.com"
      && hostname !== "afreecatv.com"
      && hostname !== "www.afreecatv.com"
    ) {
      return [];
    }
    const linkedMatch = /^\/station\/([^/?#]+)(?:\/|$)/u.exec(
      linkedUrl.pathname
    );
    return linkedMatch?.[1] ? [linkedMatch[1].slice(0, 128)] : [];
  })[0] || "";
  return {
    platform: SOURCE_PLATFORM_SOOP,
    channelId,
    contentId,
    contentType: contentId ? "vod" : "unknown"
  };
}

export function inferSourceIdentifiers(
  value: unknown,
  { linkedUrls = [] }: { linkedUrls?: readonly unknown[] } = {}
): SourceIdentifiers {
  const url = parsedHttpsUrl(value);
  const platform = sourcePlatformFromUrl(value);
  const normalizedLinkedUrls = Array.isArray(linkedUrls)
    ? linkedUrls
    : [];
  if (!url || !platform) {
    return {
      platform: "",
      channelId: "",
      contentId: "",
      contentType: "unknown"
    };
  }
  if (platform === SOURCE_PLATFORM_YOUTUBE) {
    return inferYouTubeIdentifiers(url, normalizedLinkedUrls);
  }
  if (platform === SOURCE_PLATFORM_SOOP) {
    return inferSoopIdentifiers(url, normalizedLinkedUrls);
  }
  return inferChzzkIdentifiers(url, normalizedLinkedUrls);
}

export function canonicalSourceUrl(
  value: unknown,
  identifiers: SourceIdentifiers | null = null
): string {
  const url = parsedHttpsUrl(value);
  const resolved = identifiers || inferSourceIdentifiers(value);
  if (!url || !resolved?.platform) {
    return "";
  }
  if (
    resolved.platform === SOURCE_PLATFORM_YOUTUBE
    && resolved.contentId
  ) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(resolved.contentId)}`;
  }
  if (
    resolved.platform === SOURCE_PLATFORM_SOOP
    && resolved.contentId
  ) {
    return `https://vod.sooplive.com/player/${encodeURIComponent(resolved.contentId)}`;
  }
  if (resolved.platform === SOURCE_PLATFORM_CHZZK) {
    const contentType = String(resolved.contentType || "").toLowerCase();
    if (contentType === "live" && resolved.channelId) {
      return `https://chzzk.naver.com/live/${encodeURIComponent(resolved.channelId)}`;
    }
    if (contentType === "vod" && resolved.contentId) {
      return `https://chzzk.naver.com/video/${encodeURIComponent(resolved.contentId)}`;
    }
    if (contentType === "clip" && resolved.contentId) {
      return `https://chzzk.naver.com/clips/${encodeURIComponent(resolved.contentId)}`;
    }
  }
  url.hash = "";
  return url.toString();
}

export function sourcePlatformLabel(platform: unknown): string {
  if (platform === SOURCE_PLATFORM_YOUTUBE) {
    return "YouTube";
  }
  if (platform === SOURCE_PLATFORM_SOOP) {
    return "SOOP";
  }
  return platform === SOURCE_PLATFORM_CHZZK ? "치지직" : "지원하지 않음";
}

export function sourcePlayerStatusText(context: SourcePlayerContext | null | undefined): string {
  const player = context?.player || {};
  if (!player.found) {
    return "영상 플레이어 미검출";
  }
  if (player.adActive) {
    return "YouTube 광고 재생 중 · 스탬프 일시 중지";
  }
  const parts = [player.paused ? "일시정지" : "재생 중"];
  if (
    context?.contentType === "live"
    && Number.isFinite(player.liveEdgeOffsetSeconds)
  ) {
    parts.push(`라이브 지연 ${(player.liveEdgeOffsetSeconds as number).toFixed(1)}초`);
  }
  if (typeof context?.clipActive === "boolean") {
    parts.push(`클립 ${context.clipActive ? "허용" : "미허용"}`);
  }
  return parts.join(" · ");
}
