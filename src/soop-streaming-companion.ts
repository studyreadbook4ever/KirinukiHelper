import {
  createSoopVodStreamingBridgeAdapter,
  installStreamingBridgeContentEndpoint
} from "./web/streaming-bridge-content.js";

declare global {
  var __kirinukiSoopStreamingCompanionLoaded: boolean | undefined;
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

function sourceIdentityFromSoopFrame() {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return {
      platform: "",
      channelId: "",
      contentId: "",
      contentType: "unknown"
    };
  }
  const match = /^\/player\/(\d{1,32})\/embed\/?$/u.exec(url.pathname);
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase().replace(/\.$/u, "")
      !== "vod.sooplive.com"
    || url.port
    || url.username
    || url.password
    || !match?.[1]
  ) {
    return {
      platform: "",
      channelId: "",
      contentId: "",
      contentType: "unknown"
    };
  }
  return {
    platform: "SOOP",
    channelId: "",
    contentId: match[1],
    contentType: "vod"
  };
}

if (!globalThis.__kirinukiSoopStreamingCompanionLoaded) {
  globalThis.__kirinukiSoopStreamingCompanionLoaded = true;
  if (window.parent !== window) {
    installStreamingBridgeContentEndpoint({
      allowedParentOrigins: configuredStudioOrigins(),
      adapter: createSoopVodStreamingBridgeAdapter({
        readSource: sourceIdentityFromSoopFrame
      })
    });
  }
}
