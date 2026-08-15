import {
  installAuthenticatedStudioStreamingRelay
} from "./web/streaming-bridge-auth.js";

declare global {
  var __kirinukiStudioStreamingRelayLoaded: boolean | undefined;
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

if (!globalThis.__kirinukiStudioStreamingRelayLoaded) {
  globalThis.__kirinukiStudioStreamingRelayLoaded = true;
  void installAuthenticatedStudioStreamingRelay({
    allowedStudioOrigins: configuredStudioOrigins()
  }).catch(() => {
    // The relay is security-sensitive and has no direct-message fallback.
    // Studio exposes bridge unavailability through its bounded request timeout.
  });
}
