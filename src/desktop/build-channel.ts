export const DESKTOP_BUILD_CHANNELS = Object.freeze([
  "ci-test-only",
  "public-release"
] as const);

export type DesktopBuildChannel = typeof DESKTOP_BUILD_CHANNELS[number];

declare const __KIRINUKI_DESKTOP_BUILD_CHANNEL__: unknown;

export function normalizeDesktopBuildChannel(
  value: unknown
): DesktopBuildChannel {
  if (value === undefined) {
    return "ci-test-only";
  }
  if (
    typeof value !== "string"
    || !(DESKTOP_BUILD_CHANNELS as readonly string[]).includes(value)
  ) {
    throw new TypeError("desktop build channel이 exact contract와 다릅니다.");
  }
  return value as DesktopBuildChannel;
}

/**
 * esbuild substitutes this token before app.asar is created. On a signed
 * macOS release the outer code signature therefore authenticates the channel
 * decision together with the application source; a mutable Resources sidecar
 * can never downgrade the signed-tool verification policy.
 */
export const DESKTOP_BUILD_CHANNEL = normalizeDesktopBuildChannel(
  typeof __KIRINUKI_DESKTOP_BUILD_CHANNEL__ === "undefined"
    ? undefined
    : __KIRINUKI_DESKTOP_BUILD_CHANNEL__
);

