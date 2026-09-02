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
  tag: "v3.0.26",
  commit: "29e1c29391105f70d575b6fa0375fa664761cf99",
  aggregateManifestSha256:
    "b6a0c1f6a1623ef8a1bd9f1a441ba05dc830712738dd1d33f059cc1a89124373",
  sourceOffer: {
    bytes: 2032,
    fileName: "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt",
    sha256:
      "02a7355bb60a9703321ed47a015859540acd7fa7792f377a6950dc14897ffebf",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.26/Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt"
  },
  archInstaller: {
    bytes: 199946626,
    fileName: "Kirinuki-Engine-arch-x64-preview.pkg.tar.zst",
    sha256:
      "071682b3e9e9c34e6fe23b70e93bbde4d6c0a167e4d9ab3c9c3af3dd4f423421",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.26/Kirinuki-Engine-arch-x64-preview.pkg.tar.zst"
  },
  installers: {
    "linux-x64": {
      bytes: 172386432,
      fileName: "Kirinuki-Engine-linux-x64-preview.deb",
      sha256:
        "8f841600e55aff23885e233b4221fe2a795f46c507f04cd3b15c191dfcae68ea",
      url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.26/Kirinuki-Engine-linux-x64-preview.deb"
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
  tag: "windows-preview-v3.0.26",
  commit: "29e1c29391105f70d575b6fa0375fa664761cf99",
  aggregateManifestSha256:
    "84bf147102d0ced969ca05fabeeffc4055edcd4c72f7c6cbf1a17ca6659c81e5",
  sourceOffer: {
    bytes: 919,
    fileName: "Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt",
    sha256:
      "895c00bbf49c2b871e09314fac9644ed237bc5f913ddb1268a7cdd629ceaf96e",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/windows-preview-v3.0.26/Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt"
  },
  installer: {
    bytes: 128394665,
    fileName: "Kirinuki-Engine-windows-x64-preview-setup.exe",
    sha256:
      "c2c8d3d144969b58f3c6965af480b3ceeb988912a71bb1fba9cc549918287d6d",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/windows-preview-v3.0.26/Kirinuki-Engine-windows-x64-preview-setup.exe"
  }
});

if (!verifiedWindowsPreview) {
  throw new Error("고정된 Windows 도우미 preview channel이 검증 형식과 다릅니다.");
}

export const PINNED_WEB_ENGINE_WINDOWS_PREVIEW_CHANNEL:
  Readonly<LocalMediaEngineWindowsPreviewChannel> = verifiedWindowsPreview;
