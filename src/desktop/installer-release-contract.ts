import type { DesktopBundleTarget } from "./runtime-spec.js";
import type { DesktopInstallerChannel } from "./installer-contract.js";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const CERTIFICATE_SHA1_PATTERN = /^[0-9A-F]{40}$/u;
const APPLE_IDENTIFIER_PATTERN = /^[A-Z0-9]{10}$/u;
const APPLE_ISSUER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export const DESKTOP_INSTALLER_CHANNEL_ENV =
  "KIRINUKI_INSTALLER_CHANNEL" as const;

export const DESKTOP_RELEASE_COMMON_ENVIRONMENT_KEYS = Object.freeze([
  "KIRINUKI_RELEASE_TAG",
  "KIRINUKI_RELEASE_COMMIT",
  "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_PATH",
  "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256",
  "KIRINUKI_RELEASE_PROVENANCE_ROOT"
] as const);

export const DESKTOP_SIGNING_ENVIRONMENT_KEYS = Object.freeze([
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_TEAM_ID",
  "CSC_KEYCHAIN",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_NAME",
  "KIRINUKI_LINUX_SIGNING_FINGERPRINT",
  "KIRINUKI_LINUX_SIGNING_PASSPHRASE",
  "KIRINUKI_WINDOWS_CERTIFICATE_SHA1",
  "KIRINUKI_WINDOWS_PUBLISHER_SUBJECT",
  "KIRINUKI_WINDOWS_SIGNTOOL",
  "WIN_CSC_KEY_PASSWORD",
  "WIN_CSC_LINK"
] as const);

export type InstallerReleaseEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface DesktopInstallerBuildRequest {
  readonly channel: DesktopInstallerChannel;
  readonly release: null | Readonly<{
    readonly tag: string;
    readonly commit: string;
    readonly provenanceArchivePath: string;
    readonly provenanceArchiveSha256: string;
    readonly provenanceRoot: string;
    readonly signingIdentity: string;
  }>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function optionalEnvironmentValue(
  env: InstallerReleaseEnvironment,
  key: string
): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredEnvironmentValue(
  env: InstallerReleaseEnvironment,
  key: string,
  { secret = false }: { readonly secret?: boolean } = {}
): string {
  const value = optionalEnvironmentValue(env, key);
  invariant(value !== undefined, `public-release에 ${key} 값이 필요합니다.`);
  invariant(
    value.trim() === value
      && value.length <= (secret ? 32_768 : 1_024)
      && !CONTROL_CHARACTER_PATTERN.test(value),
    `public-release의 ${key} 값 형식이 올바르지 않습니다.`
  );
  return value;
}

function assertSecret(
  env: InstallerReleaseEnvironment,
  key: string
): void {
  requiredEnvironmentValue(env, key, { secret: true });
}

function assertUnsignedEnvironment(env: InstallerReleaseEnvironment): void {
  const configured = [
    ...DESKTOP_RELEASE_COMMON_ENVIRONMENT_KEYS,
    ...DESKTOP_SIGNING_ENVIRONMENT_KEYS
  ].filter((key) => optionalEnvironmentValue(env, key) !== undefined);
  invariant(
    configured.length === 0,
    `ci-test-only installer에 release/signing 환경을 전달할 수 없습니다: ${configured.join(",")}`
  );
}

function windowsSigningIdentity(env: InstallerReleaseEnvironment): string {
  assertSecret(env, "WIN_CSC_LINK");
  assertSecret(env, "WIN_CSC_KEY_PASSWORD");
  const tool = requiredEnvironmentValue(env, "KIRINUKI_WINDOWS_SIGNTOOL");
  invariant(/^(?:[A-Za-z]:[\\/]|\\\\)/u.test(tool), "Windows signtool은 절대 경로여야 합니다.");
  const thumbprint = requiredEnvironmentValue(
    env,
    "KIRINUKI_WINDOWS_CERTIFICATE_SHA1"
  ).toUpperCase();
  invariant(
    CERTIFICATE_SHA1_PATTERN.test(thumbprint),
    "Windows certificate SHA-1 thumbprint 형식이 올바르지 않습니다."
  );
  requiredEnvironmentValue(env, "KIRINUKI_WINDOWS_PUBLISHER_SUBJECT");
  return thumbprint;
}

function macSigningIdentity(env: InstallerReleaseEnvironment): string {
  assertSecret(env, "CSC_LINK");
  assertSecret(env, "CSC_KEY_PASSWORD");
  const identity = requiredEnvironmentValue(env, "CSC_NAME");
  requiredEnvironmentValue(env, "CSC_KEYCHAIN");
  const teamId = requiredEnvironmentValue(env, "APPLE_TEAM_ID");
  const keyId = requiredEnvironmentValue(env, "APPLE_API_KEY_ID");
  const issuer = requiredEnvironmentValue(env, "APPLE_API_ISSUER").toLowerCase();
  requiredEnvironmentValue(env, "APPLE_API_KEY");
  invariant(
    APPLE_IDENTIFIER_PATTERN.test(teamId),
    "Apple Team ID 형식이 올바르지 않습니다."
  );
  invariant(
    APPLE_IDENTIFIER_PATTERN.test(keyId),
    "Apple API Key ID 형식이 올바르지 않습니다."
  );
  invariant(
    APPLE_ISSUER_PATTERN.test(issuer),
    "Apple API Issuer ID 형식이 올바르지 않습니다."
  );
  invariant(
    identity.startsWith("Developer ID Application: ")
      && identity.endsWith(` (${teamId})`),
    "macOS signing identity는 exact Developer ID Application/Team ID여야 합니다."
  );
  return identity;
}

function linuxSigningIdentity(env: InstallerReleaseEnvironment): string {
  const fingerprint = requiredEnvironmentValue(
    env,
    "KIRINUKI_LINUX_SIGNING_FINGERPRINT"
  ).toUpperCase();
  assertSecret(env, "KIRINUKI_LINUX_SIGNING_PASSPHRASE");
  invariant(
    CERTIFICATE_SHA1_PATTERN.test(fingerprint),
    "Linux release GPG fingerprint 형식이 올바르지 않습니다."
  );
  return fingerprint;
}

export function resolveDesktopInstallerBuildRequest(
  target: DesktopBundleTarget,
  env: InstallerReleaseEnvironment,
  appVersion: string
): Readonly<DesktopInstallerBuildRequest> {
  invariant(SEMVER_PATTERN.test(appVersion), "installer app version이 semver가 아닙니다.");
  const channelValue = optionalEnvironmentValue(env, DESKTOP_INSTALLER_CHANNEL_ENV);
  const channel = channelValue ?? "ci-test-only";
  invariant(
    channel === "ci-test-only" || channel === "public-release",
    `지원하는 installer channel이 아닙니다: ${String(channel)}`
  );
  if (channel === "ci-test-only") {
    assertUnsignedEnvironment(env);
    return Object.freeze({ channel, release: null });
  }

  const tag = requiredEnvironmentValue(env, "KIRINUKI_RELEASE_TAG");
  const commit = requiredEnvironmentValue(env, "KIRINUKI_RELEASE_COMMIT");
  const provenanceArchiveSha256 = requiredEnvironmentValue(
    env,
    "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256"
  ).toLowerCase();
  const provenanceArchivePath = requiredEnvironmentValue(
    env,
    "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_PATH"
  );
  const provenanceRoot = requiredEnvironmentValue(
    env,
    "KIRINUKI_RELEASE_PROVENANCE_ROOT"
  );
  invariant(tag === `v${appVersion}`, "release tag와 package version이 다릅니다.");
  invariant(COMMIT_PATTERN.test(commit), "release commit은 lowercase 40자리 SHA여야 합니다.");
  invariant(
    /^[0-9a-f]{64}$/u.test(provenanceArchiveSha256),
    "release provenance archive SHA-256이 올바르지 않습니다."
  );

  let signingIdentity: string;
  if (target === "win32-x64") {
    signingIdentity = windowsSigningIdentity(env);
  } else if (target === "darwin-arm64") {
    signingIdentity = macSigningIdentity(env);
  } else if (target === "linux-x64") {
    signingIdentity = linuxSigningIdentity(env);
  } else {
    throw new Error(`public-release를 지원하지 않는 target입니다: ${target}`);
  }
  return Object.freeze({
    channel,
    release: Object.freeze({
      tag,
      commit,
      provenanceArchivePath,
      provenanceArchiveSha256,
      provenanceRoot,
      signingIdentity
    })
  });
}
