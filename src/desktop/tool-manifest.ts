import type { DesktopBundleTarget } from "./runtime-spec.js";

export const DESKTOP_TOOL_MANIFEST_SCHEMA =
  "kirinuki-desktop-tools/v1" as const;

export const DESKTOP_FFMPEG_RELEASE = Object.freeze({
  projectVersion: "7.0.2",
  distributionTag: "b6.1.1",
  baseUrl:
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"
});

export const DESKTOP_YT_DLP_RELEASE = Object.freeze({
  version: "2026.07.04",
  baseUrl:
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04"
});

export interface DesktopToolArtifact {
  readonly fileName: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
  readonly compressedSize?: number;
  readonly compression: "gzip" | "none";
}

export interface DesktopToolTargetManifest {
  readonly schema: typeof DESKTOP_TOOL_MANIFEST_SCHEMA;
  readonly target: DesktopBundleTarget;
  readonly ffmpeg: Readonly<DesktopToolArtifact>;
  readonly ffprobe: Readonly<DesktopToolArtifact>;
  readonly ffmpegLicense: Readonly<DesktopToolArtifact>;
  readonly ytDlp: Readonly<DesktopToolArtifact>;
}

interface TargetValues {
  readonly ffmpegSize: number;
  readonly ffmpegCompressedSize: number;
  readonly ffmpegSha256: string;
  readonly ffprobeSize: number;
  readonly ffprobeCompressedSize: number;
  readonly ffprobeSha256: string;
  readonly licenseSize: number;
  readonly licenseSha256: string;
  readonly ytDlpAsset: string;
  readonly ytDlpSize: number;
  readonly ytDlpSha256: string;
}

const TARGET_VALUES = Object.freeze({
  "linux-x64": {
    ffmpegSize: 79_826_272,
    ffmpegCompressedSize: 29_354_986,
    ffmpegSha256:
      "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
    ffprobeSize: 79_665_792,
    ffprobeCompressedSize: 29_276_839,
    ffprobeSha256:
      "4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d",
    licenseSize: 35_147,
    licenseSha256:
      "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
    ytDlpAsset: "yt-dlp_linux",
    ytDlpSize: 39_924_536,
    ytDlpSha256:
      "6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae"
  },
  "linux-arm64": {
    ffmpegSize: 51_134_160,
    ffmpegCompressedSize: 25_568_691,
    ffmpegSha256:
      "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
    ffprobeSize: 50_994_160,
    ffprobeCompressedSize: 25_493_573,
    ffprobeSha256:
      "d17ae9b4c297d48e2521ba14e417bb0537c6ff77c584cdbcd6bb0d8d0307a2e8",
    licenseSize: 35_147,
    licenseSha256:
      "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
    ytDlpAsset: "yt-dlp_linux_aarch64",
    ytDlpSize: 39_675_904,
    ytDlpSha256:
      "b6ce97646773070d7a7ffd6bbbdcaecb47c48483909c54c915bf08a7a9b5e0b1"
  },
  "darwin-x64": {
    ffmpegSize: 78_862_176,
    ffmpegCompressedSize: 25_296_431,
    ffmpegSha256:
      "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
    ffprobeSize: 78_780_408,
    ffprobeCompressedSize: 25_239_438,
    ffprobeSha256:
      "fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0",
    licenseSize: 4_346,
    licenseSha256:
      "2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af",
    ytDlpAsset: "yt-dlp_macos",
    ytDlpSize: 38_256_544,
    ytDlpSha256:
      "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
  },
  "darwin-arm64": {
    ffmpegSize: 45_568_216,
    ffmpegCompressedSize: 19_246_198,
    ffmpegSha256:
      "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584",
    ffprobeSize: 45_528_808,
    ffprobeCompressedSize: 19_207_077,
    ffprobeSha256:
      "bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64",
    licenseSize: 4_376,
    licenseSha256:
      "cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2",
    ytDlpAsset: "yt-dlp_macos",
    ytDlpSize: 38_256_544,
    ytDlpSha256:
      "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
  },
  "win32-x64": {
    ffmpegSize: 82_797_568,
    ffmpegCompressedSize: 29_581_307,
    ffmpegSha256:
      "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
    ffprobeSize: 82_668_032,
    ffprobeCompressedSize: 29_521_644,
    ffprobeSha256:
      "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4",
    licenseSize: 35_147,
    licenseSha256:
      "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
    ytDlpAsset: "yt-dlp.exe",
    ytDlpSize: 18_226_085,
    ytDlpSha256:
      "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8"
  }
} satisfies Readonly<Partial<Record<DesktopBundleTarget, TargetValues>>>);

export const DESKTOP_PACKAGED_TARGETS = Object.freeze(
  Object.keys(TARGET_VALUES).sort() as DesktopBundleTarget[]
);

function executableName(target: DesktopBundleTarget, base: string): string {
  return target.startsWith("win32-") ? `${base}.exe` : base;
}

export function desktopToolTargetManifest(
  target: DesktopBundleTarget | string
): Readonly<DesktopToolTargetManifest> {
  const values = TARGET_VALUES[target as keyof typeof TARGET_VALUES];
  if (!values) {
    throw new TypeError(
      `지원하는 데스크톱 패키지 대상이 아닙니다: ${String(target)}`
    );
  }
  const ffmpegTarget = target;
  const ffmpegAssetBase = `ffmpeg-${ffmpegTarget}`;
  const ffprobeAssetBase = `ffprobe-${ffmpegTarget}`;
  const licenseAsset = `${ffmpegTarget}.LICENSE`;
  const artifact = (
    fileName: string,
    url: string,
    size: number,
    sha256: string,
    compression: "gzip" | "none",
    compressedSize?: number
  ): Readonly<DesktopToolArtifact> => Object.freeze({
    fileName,
    url,
    size,
    sha256,
    compression,
    ...(compressedSize === undefined ? {} : { compressedSize })
  });
  return Object.freeze({
    schema: DESKTOP_TOOL_MANIFEST_SCHEMA,
    target: target as DesktopBundleTarget,
    ffmpeg: artifact(
      executableName(target as DesktopBundleTarget, "ffmpeg"),
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/${ffmpegAssetBase}.gz`,
      values.ffmpegSize,
      values.ffmpegSha256,
      "gzip",
      values.ffmpegCompressedSize
    ),
    ffprobe: artifact(
      executableName(target as DesktopBundleTarget, "ffprobe"),
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/${ffprobeAssetBase}.gz`,
      values.ffprobeSize,
      values.ffprobeSha256,
      "gzip",
      values.ffprobeCompressedSize
    ),
    ffmpegLicense: artifact(
      "FFMPEG-LICENSE.txt",
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/${licenseAsset}`,
      values.licenseSize,
      values.licenseSha256,
      "none"
    ),
    ytDlp: artifact(
      executableName(target as DesktopBundleTarget, "yt-dlp"),
      `${DESKTOP_YT_DLP_RELEASE.baseUrl}/${values.ytDlpAsset}`,
      values.ytDlpSize,
      values.ytDlpSha256,
      "none"
    )
  });
}
