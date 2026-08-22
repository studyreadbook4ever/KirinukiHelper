import type { DesktopBundleTarget } from "./runtime-spec.js";

export const DESKTOP_INSTALLER_MANIFEST_SCHEMA =
  "kirinuki-desktop-installer-manifest/v2" as const;

export const DESKTOP_INSTALLER_CHANNELS = Object.freeze([
  "ci-test-only",
  "public-release"
] as const);
export type DesktopInstallerChannel =
  typeof DESKTOP_INSTALLER_CHANNELS[number];

export const DESKTOP_RELEASE_MANIFEST_SCHEMA =
  "kirinuki-desktop-release-manifest/v1" as const;
export const DESKTOP_RELEASE_MANIFEST_FILE =
  "Kirinuki-Engine-release-manifest.json" as const;
export const DESKTOP_RELEASE_CHECKSUM_FILE =
  "Kirinuki-Engine-SHA256SUMS.txt" as const;
export const DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE =
  "Kirinuki-Engine-SHA256SUMS.txt.asc" as const;
export const DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE =
  "Kirinuki-Engine-source-provenance.tar.gz" as const;

export const LINUX_PREVIEW_RELEASE_MANIFEST_SCHEMA =
  "kirinuki-linux-preview-release/v1" as const;
export const LINUX_PREVIEW_INSTALLER_FILE =
  "Kirinuki-Engine-linux-x64-preview.deb" as const;
export const LINUX_PREVIEW_RELEASE_MANIFEST_FILE =
  "Kirinuki-Engine-linux-preview-manifest.json" as const;
export const LINUX_PREVIEW_RELEASE_CHECKSUM_FILE =
  "Kirinuki-Engine-linux-preview-SHA256.txt" as const;
export const LINUX_PREVIEW_RELEASE_ASSET_FILES = Object.freeze([
  LINUX_PREVIEW_INSTALLER_FILE,
  LINUX_PREVIEW_RELEASE_CHECKSUM_FILE,
  LINUX_PREVIEW_RELEASE_MANIFEST_FILE
].sort());

export interface DesktopInstallerTarget {
  readonly target: DesktopBundleTarget;
  readonly platform: "linux" | "darwin" | "win32";
  readonly arch: "x64" | "arm64";
  readonly builderFlag: "--linux" | "--mac" | "--win";
  readonly builderTarget: "deb" | "dmg" | "nsis";
  readonly format: "deb" | "dmg" | "nsis";
  /** Stable, signed public-release asset consumed by the website. */
  readonly fileName: string;
  /** Deliberately incompatible name for unsigned CI lifecycle testing. */
  readonly ciTestFileName: string;
  /**
   * electron-builder public-channel output before wrapper verification. This
   * name is deliberately impossible to confuse with a publishable asset; only
   * the release wrapper may promote it to `fileName` after every gate passes.
   */
  readonly releaseCandidateFileName: string;
  /** Unique evidence file produced beside a public-release installer. */
  readonly releaseEvidenceFileName: string;
  /** Linux alone carries a detached release signature. */
  readonly detachedSignatureFileName: string | null;
}

const TARGETS = Object.freeze({
  "linux-x64": Object.freeze({
    target: "linux-x64",
    platform: "linux",
    arch: "x64",
    builderFlag: "--linux",
    builderTarget: "deb",
    format: "deb",
    fileName: "Kirinuki-Engine-linux-x64.deb",
    ciTestFileName: "UNSIGNED-TEST-ONLY-Kirinuki-Engine-linux-x64.deb",
    releaseCandidateFileName:
      "QUARANTINED-NOT-FOR-PUBLISH-Kirinuki-Engine-linux-x64.deb",
    releaseEvidenceFileName: "Kirinuki-Engine-linux-x64.release.json",
    detachedSignatureFileName: "Kirinuki-Engine-linux-x64.deb.asc"
  }),
  "darwin-arm64": Object.freeze({
    target: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    builderFlag: "--mac",
    builderTarget: "dmg",
    format: "dmg",
    fileName: "Kirinuki-Engine-macos-arm64.dmg",
    ciTestFileName: "UNSIGNED-TEST-ONLY-Kirinuki-Engine-macos-arm64.dmg",
    releaseCandidateFileName:
      "QUARANTINED-NOT-FOR-PUBLISH-Kirinuki-Engine-macos-arm64.dmg",
    releaseEvidenceFileName: "Kirinuki-Engine-macos-arm64.release.json",
    detachedSignatureFileName: null
  }),
  "win32-x64": Object.freeze({
    target: "win32-x64",
    platform: "win32",
    arch: "x64",
    builderFlag: "--win",
    builderTarget: "nsis",
    format: "nsis",
    fileName: "Kirinuki-Engine-windows-x64-setup.exe",
    ciTestFileName: "UNSIGNED-TEST-ONLY-Kirinuki-Engine-windows-x64-setup.exe",
    releaseCandidateFileName:
      "QUARANTINED-NOT-FOR-PUBLISH-Kirinuki-Engine-windows-x64-setup.exe",
    releaseEvidenceFileName: "Kirinuki-Engine-windows-x64.release.json",
    detachedSignatureFileName: null
  })
} satisfies Record<string, Readonly<DesktopInstallerTarget>>);

export const DESKTOP_INSTALLER_TARGETS = Object.freeze(
  Object.keys(TARGETS).sort() as readonly DesktopBundleTarget[]
);

export function desktopInstallerTarget(
  target: DesktopBundleTarget | string
): Readonly<DesktopInstallerTarget> {
  const selected = TARGETS[target as keyof typeof TARGETS];
  if (!selected) {
    throw new TypeError(`지원하는 installer target이 아닙니다: ${String(target)}`);
  }
  return selected;
}

export function desktopInstallerArtifactFileName(
  target: DesktopBundleTarget | string,
  channel: DesktopInstallerChannel
): string {
  const contract = desktopInstallerTarget(target);
  if (!DESKTOP_INSTALLER_CHANNELS.includes(channel)) {
    throw new TypeError(`지원하는 installer channel이 아닙니다: ${String(channel)}`);
  }
  return channel === "public-release"
    ? contract.fileName
    : contract.ciTestFileName;
}

/**
 * Exact filename electron-builder is allowed to create. Public stable names
 * are intentionally absent here: the wrapper promotes a verified candidate
 * only after provenance, signing/notarization, and readback all succeed.
 */
export function desktopInstallerBuilderArtifactFileName(
  target: DesktopBundleTarget | string,
  channel: DesktopInstallerChannel
): string {
  const contract = desktopInstallerTarget(target);
  if (!DESKTOP_INSTALLER_CHANNELS.includes(channel)) {
    throw new TypeError(`지원하는 installer channel이 아닙니다: ${String(channel)}`);
  }
  return channel === "public-release"
    ? contract.releaseCandidateFileName
    : contract.ciTestFileName;
}

export function desktopInstallerManifestFileName(
  target: DesktopBundleTarget | string,
  channel: DesktopInstallerChannel
): string {
  const contract = desktopInstallerTarget(target);
  return channel === "public-release"
    ? contract.releaseEvidenceFileName
    : "UNSIGNED-TEST-ONLY-installer-manifest.json";
}

export const DESKTOP_PUBLIC_RELEASE_ASSET_FILES = Object.freeze([
  ...Object.values(TARGETS).map(({ fileName }) => fileName),
  "Kirinuki-Engine-linux-x64.deb.asc",
  DESKTOP_RELEASE_MANIFEST_FILE,
  DESKTOP_RELEASE_CHECKSUM_FILE,
  DESKTOP_RELEASE_CHECKSUM_SIGNATURE_FILE,
  DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
].sort());
