import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_YOUTUBE,
  canonicalSourceUrl,
  inferSourceIdentifiers,
  sourcePlatformFromUrl
} from "./lib/source-platform.js";

declare global {
  var __kirinukiSourceBridgeLoaded: boolean | undefined;
}

interface ChzzkChannelMetadata {
  channelId?: string;
  channelName?: string;
}

interface ChzzkMetadata {
  channel?: ChzzkChannelMetadata;
  openDate?: string;
  liveOpenDate?: string;
  liveTitle?: string;
  videoTitle?: string;
  clipActive?: boolean;
  timeMachineActive?: boolean;
  liveCategoryValue?: string;
  videoCategoryValue?: string;
}

interface MetadataCache {
  fetchedAt: number;
  value: ChzzkMetadata | null;
  channelId?: string;
  videoId?: string;
}

interface PlayerState {
  found: boolean;
  positionSeconds: number | null;
  positionSource: string;
  confidence: string;
  adActive: boolean;
  durationSeconds?: number | null;
  durationIsInfinite?: boolean;
  liveInProgress?: boolean;
  seekableStartSeconds?: number | null;
  seekableEndSeconds?: number | null;
  liveEdgeOffsetSeconds?: number | null;
  paused?: boolean;
  playbackRate?: number;
  readyState?: number;
  rawMediaPositionSeconds?: number;
  elapsedAtLiveEdgeSeconds?: number;
}

interface PlayerCommand {
  type?: string;
  action?: "play" | "pause" | "seek" | string;
  positionSeconds?: number;
  playbackRate?: number;
}

if (!globalThis.__kirinukiSourceBridgeLoaded) {
  globalThis.__kirinukiSourceBridgeLoaded = true;

  const CHZZK_METADATA_FETCH_TIMEOUT_MS = 8_000;
  let liveMetadataCache: MetadataCache | null = null;
  let vodMetadataCache: MetadataCache | null = null;
  const liveMetadataRequests = new Map<
    string,
    Promise<ChzzkMetadata | null>
  >();
  const vodMetadataRequests = new Map<
    string,
    Promise<ChzzkMetadata | null>
  >();

  const isVisible = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0
      && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none"
    );
  };

  const choosePrimaryVideo = () => {
    const videos = [...document.querySelectorAll("video")].filter(isVisible);
    return videos.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftScore = (
        leftRect.width * leftRect.height
        + (left.readyState >= 2 ? 1_000_000 : 0)
      );
      const rightScore = (
        rightRect.width * rightRect.height
        + (right.readyState >= 2 ? 1_000_000 : 0)
      );
      return rightScore - leftScore;
    })[0] ?? null;
  };

  const readMeta = (...selectors: string[]): string => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)
        ?.getAttribute("content")
        ?.trim();
      if (value) {
        return value;
      }
    }
    return "";
  };

  const readText = (...selectors: string[]): string => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) {
        return value;
      }
    }
    return "";
  };

  const linkedUrls = () => [...document.querySelectorAll("a[href], link[href]")]
    .map((element): string => {
      const href = element.getAttribute("href");
      if (!href) {
        return "";
      }
      try {
        return new URL(href, location.href).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const currentYouTubeChannelUrls = () => [
    ...document.querySelectorAll(
      "#owner #channel-name a[href], "
      + "ytd-watch-metadata ytd-channel-name a[href], "
      + "ytd-reel-video-renderer a[href*='/@']"
    )
  ].map((element): string => {
    const href = element.getAttribute("href");
    if (!href) {
      return "";
    }
    try {
      return new URL(href, location.href).toString();
    } catch {
      return "";
    }
  }).filter(Boolean);

  const cleanPageTitle = (title: unknown, platform: string): string => {
    const text = String(title ?? "");
    if (platform === SOURCE_PLATFORM_YOUTUBE) {
      return text.replace(/\s*[-|]\s*YouTube\s*$/iu, "").trim();
    }
    return text
      .replace(/\s*[-|:]\s*CHZZK\s*$/iu, "")
      .replace(/\s*[-|:]\s*치지직\s*$/iu, "")
      .trim();
  };

  const youtubeAdActive = () => Boolean(
    document.querySelector("#movie_player.ad-showing")
    || document.querySelector(".html5-video-player.ad-showing")
  );

  const youtubeLiveInProgress = (
    video: HTMLVideoElement | null,
    { metadataFresh = false }: { metadataFresh?: boolean } = {}
  ): boolean => {
    const player = document.querySelector(
      "#movie_player, .html5-video-player"
    );
    const metadataSaysLive = (
      metadataFresh
      && /^(?:true|1)$/iu.test(
        readMeta("meta[itemprop='isLiveBroadcast']")
      )
    );
    const hasBroadcastEnd = Boolean(
      readMeta("meta[itemprop='endDate']")
    );
    return Boolean(
      video?.duration === Number.POSITIVE_INFINITY
      || player?.classList.contains("ytp-live")
      || (metadataSaysLive && !hasBroadcastEnd)
    );
  };

  const youtubeVideoIdFromCandidate = (value: unknown): string => {
    const candidate = String(value || "").trim();
    if (!candidate) {
      return "";
    }
    try {
      const absoluteUrl = new URL(candidate, location.href).toString();
      const fromUrl = inferSourceIdentifiers(absoluteUrl).contentId;
      if (fromUrl) {
        return fromUrl;
      }
    } catch {
      // Raw video IDs are handled below.
    }
    return inferSourceIdentifiers(
      `https://www.youtube.com/watch?v=${encodeURIComponent(candidate)}`
    ).contentId;
  };

  const readActiveYouTubeVideoId = () => {
    const watchFlexy = document.querySelector(
      "ytd-watch-flexy[video-id]"
    );
    const watchVideoId = youtubeVideoIdFromCandidate(
      watchFlexy?.getAttribute("video-id")
    );
    if (watchVideoId) {
      return watchVideoId;
    }

    const primaryVideo = choosePrimaryVideo();
    const primaryShortRenderer = primaryVideo?.closest?.(
      "ytd-reel-video-renderer"
    );
    const shortsRenderers = [
      ...document.querySelectorAll("ytd-reel-video-renderer")
    ];
    const activeShort = primaryShortRenderer
      || shortsRenderers.find((renderer) => (
        isVisible(renderer)
        && (
          renderer.hasAttribute("is-active")
          || renderer.hasAttribute("active")
          || renderer.getAttribute("aria-hidden") === "false"
        )
      ))
      || shortsRenderers.find(isVisible);
    if (!activeShort) {
      return "";
    }
    const nestedVideoId = activeShort.querySelector("[video-id]")
      ?.getAttribute("video-id");
    const activeShortLink = activeShort.querySelector(
      "a.ytp-title-link[href], a[href*='/shorts/'], a[href*='/watch?']"
    )?.getAttribute("href");
    for (const candidate of [
      activeShort.getAttribute("video-id"),
      activeShort.getAttribute("data-video-id"),
      nestedVideoId,
      activeShortLink
    ]) {
      const videoId = youtubeVideoIdFromCandidate(candidate);
      if (videoId) {
        return videoId;
      }
    }
    return "";
  };

  const readPlayer = (
    platform: string,
    { youtubeMetadataFresh = false }: {
      youtubeMetadataFresh?: boolean;
    } = {}
  ): PlayerState => {
    const video = choosePrimaryVideo();
    if (!video) {
      return {
        found: false,
        positionSeconds: null,
        positionSource: "unavailable",
        confidence: "none",
        adActive: false
      };
    }
    const adActive = (
      platform === SOURCE_PLATFORM_YOUTUBE
      && youtubeAdActive()
    );
    const liveInProgress = (
      platform === SOURCE_PLATFORM_YOUTUBE
      && youtubeLiveInProgress(video, {
        metadataFresh: youtubeMetadataFresh
      })
    );
    const currentTime = (
      !adActive
      && video.readyState >= 1
      && Number.isFinite(video.currentTime)
    )
      ? video.currentTime
      : null;
    const duration = Number.isFinite(video.duration)
      ? video.duration
      : null;
    const seekableStart = video.seekable.length > 0
      ? video.seekable.start(0)
      : null;
    const seekableEnd = video.seekable.length > 0
      ? video.seekable.end(video.seekable.length - 1)
      : null;
    const liveEdgeOffsetSeconds = (
      currentTime !== null
      && seekableEnd !== null
    )
      ? Math.max(0, seekableEnd - currentTime)
      : null;

    return {
      found: true,
      positionSeconds: currentTime,
      positionSource: adActive
        ? "youtube-ad-blocked"
        : liveInProgress
          ? "youtube-live-in-progress"
        : "html-video-currentTime",
      confidence: adActive ? "none" : duration !== null ? "high" : "medium",
      durationSeconds: duration,
      durationIsInfinite: video.duration === Number.POSITIVE_INFINITY,
      liveInProgress,
      seekableStartSeconds: seekableStart,
      seekableEndSeconds: seekableEnd,
      liveEdgeOffsetSeconds,
      paused: video.paused,
      playbackRate: video.playbackRate,
      readyState: video.readyState,
      adActive
    };
  };

  const fetchChzzkMetadata = (
    requestKey: string,
    endpoint: string,
    pendingRequests: Map<string, Promise<ChzzkMetadata | null>>,
    cacheValue: (value: ChzzkMetadata | null) => void
  ): Promise<ChzzkMetadata | null> => {
    const pendingRequest = pendingRequests.get(requestKey);
    if (pendingRequest) {
      return pendingRequest;
    }
    const request = Promise.resolve().then(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        CHZZK_METADATA_FETCH_TIMEOUT_MS
      );
      try {
        const response = await fetch(endpoint, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          return null;
        }
        const payload = await response.json() as {
          code?: number;
          content?: ChzzkMetadata;
        };
        const value = payload?.code === 200 && payload?.content
          ? payload.content
          : null;
        cacheValue(value);
        return value;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    });
    pendingRequests.set(requestKey, request);
    const clearPendingRequest = () => {
      if (pendingRequests.get(requestKey) === request) {
        pendingRequests.delete(requestKey);
      }
    };
    void request.then(clearPendingRequest, clearPendingRequest);
    return request;
  };

  const fetchLiveMetadata = (
    channelId: string | null | undefined
  ): Promise<ChzzkMetadata | null> => {
    if (!channelId) {
      return Promise.resolve(null);
    }
    if (
      liveMetadataCache?.channelId === channelId
      && Date.now() - liveMetadataCache.fetchedAt < 15_000
    ) {
      return Promise.resolve(liveMetadataCache.value);
    }
    const endpoint = (
      "https://api.chzzk.naver.com/polling/v3.1/channels/"
      + `${encodeURIComponent(channelId)}/live-status`
      + "?includePlayerRecommendContent=false"
    );
    return fetchChzzkMetadata(
      channelId,
      endpoint,
      liveMetadataRequests,
      (value) => {
        liveMetadataCache = {
          channelId,
          fetchedAt: Date.now(),
          value
        };
      }
    );
  };

  const fetchVodMetadata = (
    videoId: string | null | undefined
  ): Promise<ChzzkMetadata | null> => {
    if (!videoId) {
      return Promise.resolve(null);
    }
    if (
      vodMetadataCache?.videoId === videoId
      && Date.now() - vodMetadataCache.fetchedAt < 60_000
    ) {
      return Promise.resolve(vodMetadataCache.value);
    }
    const endpoint = (
      "https://api.chzzk.naver.com/service/v3/videos/"
      + encodeURIComponent(videoId)
    );
    return fetchChzzkMetadata(
      videoId,
      endpoint,
      vodMetadataRequests,
      (value) => {
        vodMetadataCache = {
          videoId,
          fetchedAt: Date.now(),
          value
        };
      }
    );
  };

  const parseChzzkOpenDate = (value: unknown): number | null => {
    if (!value) {
      return null;
    }
    const text = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(text)
      ? `${text.replace(" ", "T")}+09:00`
      : text;
    const milliseconds = Date.parse(normalized);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  };

  const normalizeLivePlayerPosition = (
    player: PlayerState,
    liveMetadata: ChzzkMetadata | null,
    capturedAt: string
  ): PlayerState => {
    const openDateMilliseconds = parseChzzkOpenDate(
      liveMetadata?.openDate
    );
    if (
      !player.found
      || !Number.isFinite(player.positionSeconds)
      || openDateMilliseconds === null
    ) {
      return player;
    }
    const capturedMilliseconds = Date.parse(capturedAt);
    if (
      !Number.isFinite(capturedMilliseconds)
      || capturedMilliseconds < openDateMilliseconds
    ) {
      return player;
    }
    const elapsedAtLiveEdge = (
      capturedMilliseconds - openDateMilliseconds
    ) / 1_000;
    const playerPosition = player.positionSeconds as number;
    const liveEdgeOffset = Number.isFinite(player.liveEdgeOffsetSeconds)
      ? player.liveEdgeOffsetSeconds as number
      : 0;
    return {
      ...player,
      rawMediaPositionSeconds: playerPosition,
      positionSeconds: Math.max(
        0,
        elapsedAtLiveEdge - liveEdgeOffset
      ),
      positionSource: "chzzk-openDate+wallclock-liveEdge",
      confidence: Number.isFinite(player.liveEdgeOffsetSeconds)
        ? "high"
        : "medium",
      elapsedAtLiveEdgeSeconds: elapsedAtLiveEdge
    };
  };

  const getContext = async () => {
    const requestedUrl = location.href;
    const platform = sourcePlatformFromUrl(requestedUrl);
    if (!platform) {
      throw new Error("지원하지 않는 영상 페이지입니다.");
    }
    const identifiers = inferSourceIdentifiers(requestedUrl, {
      linkedUrls: platform === SOURCE_PLATFORM_YOUTUBE
        ? currentYouTubeChannelUrls()
        : linkedUrls()
    });
    if (
      platform === SOURCE_PLATFORM_YOUTUBE
      && !identifiers.contentId
    ) {
      throw new Error(
        "YouTube 영상 ID가 있는 watch·shorts·embed 페이지에서 사용해 주세요."
      );
    }
    const youtubeMetadataIdentifiers = platform === SOURCE_PLATFORM_YOUTUBE
      ? inferSourceIdentifiers(readMeta(
        "meta[property='og:url']",
        "meta[itemprop='url']"
      ))
      : null;
    const youtubeMetadataFresh = Boolean(
      platform !== SOURCE_PLATFORM_YOUTUBE
      || (
        youtubeMetadataIdentifiers?.contentId
        && youtubeMetadataIdentifiers.contentId === identifiers.contentId
      )
    );
    const pageTitle = cleanPageTitle(
      (
        youtubeMetadataFresh
          ? readMeta(
            "meta[property='og:title']",
            "meta[name='twitter:title']"
          )
          : ""
      ) || document.title,
      platform
    );
    const titleParts = pageTitle
      .split(/\s+-\s+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const [liveMetadata, vodMetadata] = platform === SOURCE_PLATFORM_CHZZK
      ? await Promise.all([
        identifiers.contentType === "live"
          ? fetchLiveMetadata(identifiers.channelId)
          : null,
        identifiers.contentType === "vod"
          ? fetchVodMetadata(identifiers.contentId)
          : null
      ])
      : [null, null];
    if (location.href !== requestedUrl) {
      throw new Error(
        "영상 페이지가 전환되는 중입니다. 잠시 후 다시 시도해 주세요."
      );
    }

    const metadataChannel = liveMetadata?.channel
      || vodMetadata?.channel
      || null;
    const channelId = platform === SOURCE_PLATFORM_YOUTUBE
      ? (
        (
          youtubeMetadataFresh
            ? readMeta(
              "meta[itemprop='channelId']",
              "meta[itemprop='identifier']"
            )
            : ""
        )
        || identifiers.channelId
      )
      : metadataChannel?.channelId || identifiers.channelId;
    const hasCreatorTitlePair = (
      platform === SOURCE_PLATFORM_CHZZK
      && ["live", "vod", "clip"].includes(identifiers.contentType)
      && titleParts.length >= 2
    );
    const streamerName = platform === SOURCE_PLATFORM_YOUTUBE
      ? (
        readText(
          "#owner #channel-name a",
          "ytd-channel-name a",
          "#channel-name #text"
        )
        || (
          youtubeMetadataFresh
            ? readMeta("meta[itemprop='author']", "meta[name='author']")
            : ""
        )
      )
      : (
        metadataChannel?.channelName
        || (hasCreatorTitlePair ? titleParts[0] : "")
      );
    const broadcastTitle = platform === SOURCE_PLATFORM_YOUTUBE
      ? pageTitle
      : (
        liveMetadata?.liveTitle
        || vodMetadata?.videoTitle
        || (hasCreatorTitlePair
          ? titleParts.slice(1).join(" - ")
          : pageTitle)
      );
    const description = (
      platform === SOURCE_PLATFORM_YOUTUBE
      && !youtubeMetadataFresh
    )
      ? ""
      : readMeta(
        "meta[property='og:description']",
        "meta[name='description']"
      );
    const imageUrl = (
      platform === SOURCE_PLATFORM_YOUTUBE
      && !youtubeMetadataFresh
    )
      ? ""
      : readMeta(
        "meta[property='og:image']",
        "meta[name='twitter:image']"
      );
    const capturedAt = new Date().toISOString();
    const rawPlayer = readPlayer(platform, {
      youtubeMetadataFresh
    });
    const normalizedPlayer = (
      platform === SOURCE_PLATFORM_CHZZK
      && identifiers.contentType === "live"
    )
      ? normalizeLivePlayerPosition(
        rawPlayer,
        liveMetadata,
        capturedAt
      )
      : rawPlayer;
    const contentType = (
      platform === SOURCE_PLATFORM_YOUTUBE
      && normalizedPlayer.liveInProgress
    )
      ? "live"
      : identifiers.contentType;
    const player = contentType === "live"
      ? normalizedPlayer
      : {
        ...normalizedPlayer,
        liveEdgeOffsetSeconds: null
      };

    if (platform === SOURCE_PLATFORM_YOUTUBE) {
      const activeVideoId = readActiveYouTubeVideoId();
      if (
        activeVideoId
        && activeVideoId !== identifiers.contentId
      ) {
        throw new Error(
          "YouTube 영상이 전환되는 중입니다. 잠시 후 다시 시도해 주세요."
        );
      }
    }
    if (location.href !== requestedUrl) {
      throw new Error(
        "영상 페이지가 전환되는 중입니다. 잠시 후 다시 시도해 주세요."
      );
    }

    return {
      platform,
      url: requestedUrl,
      canonicalUrl: canonicalSourceUrl(requestedUrl, identifiers),
      pageTitle,
      streamerName,
      broadcastTitle,
      description,
      imageUrl,
      channelId,
      contentId: identifiers.contentId,
      contentType,
      broadcastStartedAt: (
        liveMetadata?.openDate
        || vodMetadata?.liveOpenDate
        || ""
      ),
      clipActive: typeof (
        liveMetadata?.clipActive
        ?? vodMetadata?.clipActive
      ) === "boolean"
        ? liveMetadata?.clipActive ?? vodMetadata?.clipActive
        : null,
      timeMachineActive: typeof liveMetadata?.timeMachineActive === "boolean"
        ? liveMetadata.timeMachineActive
        : null,
      category: (
        liveMetadata?.liveCategoryValue
        || vodMetadata?.videoCategoryValue
        || ""
      ),
      capturedAt,
      player
    };
  };

  const applyPlayerCommand = async (
    message: PlayerCommand
  ): Promise<{
    paused: boolean;
    currentTime: number;
    playbackRate: number;
  }> => {
    const platform = sourcePlatformFromUrl(location.href);
    const video = choosePrimaryVideo();
    if (!video) {
      throw new Error("영상 플레이어를 찾지 못했습니다.");
    }
    if (
      platform === SOURCE_PLATFORM_YOUTUBE
      && youtubeAdActive()
    ) {
      throw new Error(
        "YouTube 광고 재생 중에는 원본 시각을 제어하지 않습니다."
      );
    }
    if (message.action === "play") {
      await video.play();
    } else if (message.action === "pause") {
      video.pause();
    } else if (message.action === "seek") {
      if (
        !Number.isFinite(message.positionSeconds)
        || (message.positionSeconds ?? -1) < 0
      ) {
        throw new Error("이동할 영상 시각이 올바르지 않습니다.");
      }
      const identifiers = inferSourceIdentifiers(location.href);
      let target = message.positionSeconds as number;
      if (
        platform === SOURCE_PLATFORM_CHZZK
        && identifiers.contentType === "live"
      ) {
        const context = await getContext();
        const normalizedPosition = context.player.positionSeconds;
        if (Number.isFinite(normalizedPosition)) {
          target = (
            video.currentTime
            + target
            - (normalizedPosition as number)
          );
        }
      }
      if (video.seekable.length > 0) {
        const start = video.seekable.start(0);
        const end = video.seekable.end(
          video.seekable.length - 1
        );
        target = Math.min(end, Math.max(start, target));
      }
      video.currentTime = target;
    } else if (message.action === "set-playback-rate") {
      if (
        message.playbackRate !== 0.25
        && message.playbackRate !== 2
      ) {
        throw new Error(
          "재생 속도는 0.25배 또는 2배만 선택할 수 있습니다."
        );
      }
      video.playbackRate = message.playbackRate;
    } else {
      throw new Error(
        `지원하지 않는 플레이어 명령입니다: ${message.action}`
      );
    }
    return {
      paused: video.paused,
      currentTime: video.currentTime,
      playbackRate: video.playbackRate
    };
  };

  chrome.runtime.onMessage.addListener(
    (
      message: PlayerCommand,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (message?.type === "KIRINUKI_GET_CONTEXT") {
        void getContext()
          .then((context) => sendResponse({ ok: true, context }))
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error
              ? error.message
              : String(error)
          }));
        return true;
      }
      if (message?.type === "KIRINUKI_PLAYER_COMMAND") {
        void applyPlayerCommand(message)
          .then((player) => sendResponse({ ok: true, player }))
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error
              ? error.message
              : String(error)
          }));
        return true;
      }
      return false;
    }
  );
}
