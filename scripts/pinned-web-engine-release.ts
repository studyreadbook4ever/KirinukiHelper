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
  tag: "v3.0.17",
  commit: "78b2fa553a16fac689428be97cf2d2bb153b22bc",
  aggregateManifestSha256:
    "bd6ea391ff85dd177a455ed2d38ae8ca7589fe49748c21f3cca03915ec655980",
  sourceOffer: {
    bytes: 2032,
    fileName: "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt",
    sha256:
      "fa79711dcc28920dc7f5205e67f9e23461e0f3fb0324586cdfc28a4d6eb2649d",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.17/Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt"
  },
  archInstaller: {
    bytes: 199937795,
    fileName: "Kirinuki-Engine-arch-x64-preview.pkg.tar.zst",
    sha256:
      "450ceb72e5a0535440c491408c92e5be56213ae4e19f4a57985a579d06adae76",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.17/Kirinuki-Engine-arch-x64-preview.pkg.tar.zst"
  },
  installers: {
    "linux-x64": {
      bytes: 172376316,
      fileName: "Kirinuki-Engine-linux-x64-preview.deb",
      sha256:
        "ce0f985607692e2dff4b2e8f2e9ea3e565e645690656e9b8caf394644fdd4f6f",
      url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.17/Kirinuki-Engine-linux-x64-preview.deb"
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
  tag: "windows-preview-v3.0.22",
  commit: "463f2b96877668b505a1dc90e5ff8914366d52a9",
  aggregateManifestSha256:
    "dc4af4ae23adfc6605e785080deaba10ca5c0610cc97bba8b368e701072602d4",
  sourceOffer: {
    bytes: 919,
    fileName: "Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt",
    sha256:
      "1e39be2e206621c522a51b11d2722ca61496b32e3d230c9314b1393dd62c3a35",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/windows-preview-v3.0.22/Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt"
  },
  installer: {
    bytes: 128384044,
    fileName: "Kirinuki-Engine-windows-x64-preview-setup.exe",
    sha256:
      "142f4ecff45e06093cbe668b31e8cad025c157f9ef050141cc22ba3146fbaff4",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/windows-preview-v3.0.22/Kirinuki-Engine-windows-x64-preview-setup.exe"
  }
});

if (!verifiedWindowsPreview) {
  throw new Error("고정된 Windows 도우미 preview channel이 검증 형식과 다릅니다.");
}

export const PINNED_WEB_ENGINE_WINDOWS_PREVIEW_CHANNEL:
  Readonly<LocalMediaEngineWindowsPreviewChannel> = verifiedWindowsPreview;
