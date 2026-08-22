export const LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA =
  "kirinuki-local-media-engine/health-v1" as const;
export const LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL =
  "kirinuki-local-media-engine/health-probe-v1" as const;
export const LOCAL_MEDIA_ENGINE_REQUEST_PROTOCOL =
  "chzzk-kirinuki-caption-request/v1" as const;
export const LOCAL_MEDIA_ENGINE_PRODUCT =
  "kr.eff0rtchung.kirinuki.local-vod-engine" as const;

/**
 * Compatibility boundary between the public website and the installed engine.
 * Release versions may advance independently while this protocol remains
 * compatible; the browser must gate this value instead of pinning an app
 * release number.
 */
export const LOCAL_MEDIA_ENGINE_API_PROTOCOL =
  "kirinuki-local-media-engine/v1" as const;
export const MINIMUM_LOCAL_MEDIA_ENGINE_VERSION = "3.0.1" as const;
export const MINIMUM_LOCAL_MEDIA_ENGINE_YT_DLP_VERSION =
  "2026.07.04" as const;
export const MINIMUM_LOCAL_MEDIA_ENGINE_EJS_VERSION = "0.8.0" as const;
export const LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY = Object.freeze({
  id: "kirinuki-local-media-engine/v1-additive-compatibility" as const,
  apiProtocol: LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  evolution: "additive-only" as const,
  breakingChange: "new-parallel-protocol" as const,
  installedEngineReplacement: "signed-stable-path-installer-only" as const,
  automaticUpdater: "disabled" as const,
  unsignedUpdatesAllowed: false as const,
  publicNetworkPolling: false as const
});
export const LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA =
  "kirinuki-local-vod-runtime/v1" as const;

export const LOCAL_MEDIA_ENGINE_DEVELOPMENT_VERSION =
  "0.0.0-development" as const;

/**
 * Chromium's Local Network Access API is newer than the DOM typings shipped
 * by some TypeScript versions. Keep the intent on every browser request to
 * the fixed loopback engine without widening RequestInit throughout the app.
 */
export function localMediaEngineLoopbackRequestInit(
  init: RequestInit
): RequestInit {
  return {
    ...init,
    targetAddressSpace: "loopback"
  } as RequestInit;
}

const ENGINE_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;

export function isLocalMediaEngineVersion(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 80
    && ENGINE_VERSION_PATTERN.test(value);
}

export function dottedReleaseAtLeast(
  value: unknown,
  minimum: string
): value is string {
  if (typeof value !== "string" || typeof minimum !== "string") {
    return false;
  }
  const parse = (candidate: string): readonly number[] | null => {
    const release = candidate.split("-", 1)[0] || "";
    if (!/^(?:0|[1-9]\d*)(?:\.(?:0|\d+)){2}$/u.test(release)) {
      return null;
    }
    const parts = release.split(".").map(Number);
    return parts.length === 3
      && parts.every((part) => Number.isSafeInteger(part) && part >= 0)
      ? parts
      : null;
  };
  const actual = parse(value);
  const floor = parse(minimum);
  if (!actual || !floor) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== floor[index]) {
      return actual[index]! > floor[index]!;
    }
  }
  // A prerelease at the exact numeric floor is older than the stable floor.
  return !value.includes("-") || minimum.includes("-");
}
