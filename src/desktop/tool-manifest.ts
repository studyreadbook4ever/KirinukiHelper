import type { DesktopBundleTarget } from "./runtime-spec.js";

export const DESKTOP_TOOL_MANIFEST_SCHEMA =
  "kirinuki-desktop-tools/v1" as const;

export const DESKTOP_FFMPEG_RELEASE = Object.freeze({
  distributionTag: "n8.1.2-1",
  baseUrl:
    "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1",
  licenseUrl:
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.LICENSE"
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
  readonly ffmpegVersion: string;
  readonly ffprobeVersion: string;
  readonly ffmpeg: Readonly<DesktopToolArtifact>;
  readonly ffprobe: Readonly<DesktopToolArtifact>;
  readonly ffmpegLicense: Readonly<DesktopToolArtifact>;
  readonly ytDlp: Readonly<DesktopToolArtifact>;
}

interface TargetValues {
  readonly ffmpegVersion: string;
  readonly ffprobeVersion: string;
  readonly ffmpegAsset: string;
  readonly ffmpegSize: number;
  readonly ffmpegSha256: string;
  readonly ffprobeAsset: string;
  readonly ffprobeSize: number;
  readonly ffprobeSha256: string;
  readonly ytDlpAsset: string;
  readonly ytDlpSize: number;
  readonly ytDlpSha256: string;
}

const TARGET_VALUES = Object.freeze({
  "linux-x64": {
    ffmpegVersion: "n8.1.2",
    ffprobeVersion: "n8.1.2",
    ffmpegAsset: "ffmpeg-linux-x64",
    ffmpegSize: 48_299_480,
    ffmpegSha256:
      "9eac5b2b5076db5ff853a6fa0dcd6b8de7d0cac8481eadda6c47cd935825f1ee",
    ffprobeAsset: "ffprobe-linux-x64",
    ffprobeSize: 48_090_488,
    ffprobeSha256:
      "065d3c56926052a76e884c4e4b51b7d95248da9391ab7effdcca6b94ceab98cf",
    ytDlpAsset: "yt-dlp_linux",
    ytDlpSize: 39_924_536,
    ytDlpSha256:
      "6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae"
  },
  "linux-arm64": {
    ffmpegVersion: "n8.1.2",
    ffprobeVersion: "n8.1.2",
    ffmpegAsset: "ffmpeg-linux-arm64",
    ffmpegSize: 36_523_320,
    ffmpegSha256:
      "6e7b1d7d1aa8c35e3fedd78a140aa0968717aeb7386ecfb0ee00773d9f0a4503",
    ffprobeAsset: "ffprobe-linux-arm64",
    ffprobeSize: 36_326_648,
    ffprobeSha256:
      "fd2aca1456f0261cabef4514b6d97a70fa342003347f51b39c473dd364328089",
    ytDlpAsset: "yt-dlp_linux_aarch64",
    ytDlpSize: 39_675_904,
    ytDlpSha256:
      "b6ce97646773070d7a7ffd6bbbdcaecb47c48483909c54c915bf08a7a9b5e0b1"
  },
  "darwin-x64": {
    ffmpegVersion: "n8.1.2",
    ffprobeVersion: "n8.1.2",
    ffmpegAsset: "ffmpeg-osx-x64",
    ffmpegSize: 42_745_472,
    ffmpegSha256:
      "62c87854d851f202fc4a29bdda0fe7b6ebcddd37b863482ce1bdc81151b03fe4",
    ffprobeAsset: "ffprobe-osx-x64",
    ffprobeSize: 42_555_344,
    ffprobeSha256:
      "d530823f480a3c7eb6334f18a00197d1e9f1070e86172b9aa89c4bf4022bd879",
    ytDlpAsset: "yt-dlp_macos",
    ytDlpSize: 38_256_544,
    ytDlpSha256:
      "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
  },
  "darwin-arm64": {
    ffmpegVersion: "n8.1.2",
    ffprobeVersion: "n8.1.2",
    ffmpegAsset: "ffmpeg-osx-arm64",
    ffmpegSize: 34_074_040,
    ffmpegSha256:
      "e7b9fcd97f95f333512d6e8b8ac24d9dbc08f189f36047695499bd7b57214b22",
    ffprobeAsset: "ffprobe-osx-arm64",
    ffprobeSize: 33_882_408,
    ffprobeSha256:
      "ded4c698b8ff38d0bc1fd30fcc5e768dc46f58bc15a8dfd61f98615ba49cde5c",
    ytDlpAsset: "yt-dlp_macos",
    ytDlpSize: 38_256_544,
    ytDlpSha256:
      "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
  },
  "win32-x64": {
    ffmpegVersion: "n8.1.2",
    ffprobeVersion: "n8.1.2",
    ffmpegAsset: "ffmpeg-win-x64.exe",
    ffmpegSize: 53_763_072,
    ffmpegSha256:
      "4044b3924c977ad31229d504c5d5b8685f9553124fbaff6e9c99048b42830341",
    ffprobeAsset: "ffprobe-win-x64.exe",
    ffprobeSize: 53_558_272,
    ffprobeSha256:
      "fc37ca23d31ee08bb8f7e108edf3822f6ef3efc1a8d306bbe0b779190230710b",
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
    ffmpegVersion: values.ffmpegVersion,
    ffprobeVersion: values.ffprobeVersion,
    ffmpeg: artifact(
      executableName(target as DesktopBundleTarget, "ffmpeg"),
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/${values.ffmpegAsset}`,
      values.ffmpegSize,
      values.ffmpegSha256,
      "none"
    ),
    ffprobe: artifact(
      executableName(target as DesktopBundleTarget, "ffprobe"),
      `${DESKTOP_FFMPEG_RELEASE.baseUrl}/${values.ffprobeAsset}`,
      values.ffprobeSize,
      values.ffprobeSha256,
      "none"
    ),
    ffmpegLicense: artifact(
      "FFMPEG-LICENSE.txt",
      DESKTOP_FFMPEG_RELEASE.licenseUrl,
      35_147,
      "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
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
