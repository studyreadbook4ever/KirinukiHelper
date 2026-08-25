import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  parseLocalMediaEngineReleaseChannel,
  type LocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";

const verifiedLinuxPreview = parseLocalMediaEngineReleaseChannel({
  schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  status: "verified-linux-preview",
  tag: "v3.0.16",
  commit: "d698108ac02762dce5bcf9e1d45b2962fb20333a",
  aggregateManifestSha256:
    "edeedcdbe6e3fac2d4a3e26d812497d609c7df5c4e0ab47f4cc4a3cfd25d5e98",
  sourceOffer: {
    bytes: 2032,
    fileName: "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt",
    sha256:
      "01805d27987ccf2da4b622282e921892c78d5626e89c2714a30b19014d055e13",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.16/Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt"
  },
  archInstaller: {
    bytes: 199930668,
    fileName: "Kirinuki-Engine-arch-x64-preview.pkg.tar.zst",
    sha256:
      "2fdcfa13172b28bb723630247dcce8842f3c0f25fe9deb6d9cfe5ff25f4f103e",
    url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.16/Kirinuki-Engine-arch-x64-preview.pkg.tar.zst"
  },
  installers: {
    "linux-x64": {
      bytes: 172375212,
      fileName: "Kirinuki-Engine-linux-x64-preview.deb",
      sha256:
        "afb6407372dc40c2d583153f838ed189086edd760c503814b9406ef7183bf6e2",
      url: "https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.16/Kirinuki-Engine-linux-x64-preview.deb"
    }
  }
});

if (!verifiedLinuxPreview) {
  throw new Error("고정된 Linux 도우미 release channel이 검증 형식과 다릅니다.");
}

export const PINNED_WEB_ENGINE_RELEASE_CHANNEL:
  Readonly<LocalMediaEngineReleaseChannel> = verifiedLinuxPreview;
