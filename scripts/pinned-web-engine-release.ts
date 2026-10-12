import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_SCHEMA,
  parseLocalMediaEngineReleaseChannel,
  parseLocalMediaEngineWindowsPreviewChannel,
  type LocalMediaEngineReleaseChannel,
  type LocalMediaEngineWindowsPreviewChannel
} from "../src/editor/local-media-engine-release.js";

const verifiedLinuxPreview = parseLocalMediaEngineReleaseChannel({
  schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  status: "verified-linux-preview",
  tag: "v3.0.28",
  commit: "9f4f6cb79f66867a15a5895ec3a2a289dae2dd64",
  aggregateManifestSha256:
    "4f45ff3c448d0eca3eb5f1c28f2374df4f7edd238432af077032d3f9d11d3faf",
  sourceOffer: {
    bytes: 2032,
    fileName: "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt",
    sha256:
      "50706ff37411bfca1a92cac0e108fea95e9111759001fd545668f3431d723938",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.28/Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt"
  },
  archInstaller: {
    bytes: 201202371,
    fileName: "Kirinuki-Engine-arch-x64-preview.pkg.tar.zst",
    sha256:
      "79371e659dda699d5a19fda6c715a6f85718531a5731f6ac3e9b0070b6945512",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.28/Kirinuki-Engine-arch-x64-preview.pkg.tar.zst"
  },
  installers: {
    "linux-x64": {
      bytes: 173553320,
      fileName: "Kirinuki-Engine-linux-x64-preview.deb",
      sha256:
        "06a77aaff4c3150231f373cc93263137df51a4d063d7641e325380d3c3da9142",
      url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.28/Kirinuki-Engine-linux-x64-preview.deb"
    }
  }
});

if (!verifiedLinuxPreview) {
  throw new Error("고정된 Linux 도우미 release channel이 검증 형식과 다릅니다.");
}

export const PINNED_WEB_ENGINE_RELEASE_CHANNEL:
  Readonly<LocalMediaEngineReleaseChannel> = verifiedLinuxPreview;

const verifiedWindowsPreview = parseLocalMediaEngineWindowsPreviewChannel({
  schema: LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_SCHEMA,
  status: "verified-windows-preview",
  tag: "windows-preview-v3.0.28",
  commit: "9f4f6cb79f66867a15a5895ec3a2a289dae2dd64",
  aggregateManifestSha256:
    "6397be62939c24af904d8fb801d524b493aebd44634135c6ca3a404f03f848e3",
  sourceOffer: {
    bytes: 919,
    fileName: "Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt",
    sha256:
      "f0c9c2fcdb4b12983d173838b664af4ab14e4e191f6905fec4d268474393087f",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/windows-preview-v3.0.28/Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt"
  },
  installer: {
    bytes: 129003460,
    fileName: "Kirinuki-Engine-windows-x64-preview-setup.exe",
    sha256:
      "94de170454593f8f60b3872ac729e5c7ad05fb27522e3ee6ad06496260266c49",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/windows-preview-v3.0.28/Kirinuki-Engine-windows-x64-preview-setup.exe"
  }
});

if (!verifiedWindowsPreview) {
  throw new Error("고정된 Windows 도우미 preview channel이 검증 형식과 다릅니다.");
}

export const PINNED_WEB_ENGINE_WINDOWS_PREVIEW_CHANNEL:
  Readonly<LocalMediaEngineWindowsPreviewChannel> = verifiedWindowsPreview;
