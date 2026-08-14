import {
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  inferSourceIdentifiers,
  sourcePlatformFromUrl
} from "./lib/source-platform.js";
import {
  createHtmlVideoStreamingBridgeAdapter,
  installStreamingBridgeContentEndpoint
} from "./web/streaming-bridge-content.js";

declare global {
  var __kirinukiStreamingCompanionLoaded: boolean | undefined;
}

declare const __KIRINUKI_STREAMING_COMPANION_ALLOWED_STUDIO_ORIGINS__:
  string;

function configuredStudioOrigins(): string[] {
  const parsed: unknown = JSON.parse(
    __KIRINUKI_STREAMING_COMPANION_ALLOWED_STUDIO_ORIGINS__
  );
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || !parsed.every((value) => typeof value === "string")
  ) {
    throw new TypeError("Kirinuki Studio origin build 설정이 올바르지 않습니다.");
  }
  return parsed;
}

function sourceIdentityFromFrameUrl() {
  let frameUrl: URL | null = null;
  try {
    frameUrl = new URL(location.href);
  } catch {
    // Fall through to the existing platform parser, which returns an empty
    // identity for malformed or unsupported URLs.
  }
  if (
    frameUrl
    && frameUrl.protocol === "https:"
    && !frameUrl.port
    && !frameUrl.username
    && !frameUrl.password
    && frameUrl.hostname.toLowerCase().replace(/\.$/u, "")
      === "www.youtube-nocookie.com"
  ) {
    const match = /^\/embed\/([A-Za-z0-9_-]{11})$/u.exec(frameUrl.pathname);
    if (match?.[1]) {
      return {
        platform: SOURCE_PLATFORM_YOUTUBE,
        channelId: "",
        contentId: match[1],
        contentType: "vod"
      };
    }
    return {
      platform: "",
      channelId: "",
      contentId: "",
      contentType: "unknown"
    };
  }

  const platform = sourcePlatformFromUrl(location.href);
  let identifiers = inferSourceIdentifiers(location.href);

  // SOOP must use the dedicated MAIN-world adapter. Refuse to expose a raw
  // per-file HTMLVideoElement clock if this generic bundle is ever injected
  // into a SOOP frame outside the current manifest.
  if (platform === SOURCE_PLATFORM_SOOP) {
    return {
      platform: "",
      channelId: "",
      contentId: "",
      contentType: "unknown"
    };
  }

  return {
    platform,
    channelId: identifiers.channelId,
    contentId: identifiers.contentId,
    contentType: identifiers.contentType
  };
}

if (!globalThis.__kirinukiStreamingCompanionLoaded) {
  globalThis.__kirinukiStreamingCompanionLoaded = true;
  if (window.parent !== window) {
    installStreamingBridgeContentEndpoint({
      allowedParentOrigins:
        configuredStudioOrigins(),
      adapter: createHtmlVideoStreamingBridgeAdapter({
        readSource: sourceIdentityFromFrameUrl
      })
    });
  }
}
