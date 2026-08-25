import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  parseLocalMediaEngineReleaseChannel,
  type LocalMediaEngineReleaseChannel
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
