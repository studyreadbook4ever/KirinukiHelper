/**
 * Canonical third-party provenance registry.
 *
 * This is compliance metadata, not a dependency loader and not legal advice.
 * Runtime installers keep their own executable configuration, while
 * `npm run license:check` fails closed unless those pins match this registry.
 */

/**
 * Exact licenses approved for the current advertising, paid-distribution and
 * hosted-service roadmap. This is deliberately a positive list: a license can
 * permit commercial use and still require a fresh review before it is added.
 */
export const COMMERCIAL_USE_APPROVED_LICENSE_IDS = Object.freeze([
  "Apache-2.0",
  "ISC",
  "MIT",
  "MIT-or-Unlicense",
  "MIT-0-or-Unlicense",
  "MPL-2.0",
  "OFL-1.1",
  "Unlicense"
] as const);

export type CommercialUseApprovedLicenseId =
  (typeof COMMERCIAL_USE_APPROVED_LICENSE_IDS)[number];

/** These values describe a non-product boundary; they are not license grants. */
export const THIRD_PARTY_BOUNDARY_LICENSE_IDS = Object.freeze([
  "build-dependent",
  "external-terms",
  "mixed-see-packages"
] as const);

export type ThirdPartyBoundaryLicenseId =
  (typeof THIRD_PARTY_BOUNDARY_LICENSE_IDS)[number];

export type ThirdPartyLicenseId =
  | CommercialUseApprovedLicenseId
  | ThirdPartyBoundaryLicenseId;

const commercialUseApprovedLicenseIdSet: ReadonlySet<string> = new Set(
  COMMERCIAL_USE_APPROVED_LICENSE_IDS
);
const thirdPartyBoundaryLicenseIdSet: ReadonlySet<string> = new Set(
  THIRD_PARTY_BOUNDARY_LICENSE_IDS
);

const COMMERCIAL_USE_RESTRICTIVE_LICENSE_PATTERNS = Object.freeze([
  {
    label: "NonCommercial/Creative Commons NC",
    // Do not match permissive prose such as Unlicense's
    // "commercial or non-commercial purposes". Exact metadata still fails
    // closed, while the concatenated NonCommercial name and CC-NC IDs are
    // unambiguous restrictive markers.
    pattern: /(?:\bNONCOMMERCIAL\b|\bCC(?:[- ]BY)?[- ]NC(?:[- .]|$))/iu
  },
  {
    label: "Commons Clause",
    pattern: /\bCOMMONS[- ]CLAUSE\b/iu
  },
  {
    label: "PolyForm restricted-use license",
    pattern: /\bPOLYFORM\b/iu
  },
  {
    label: "Server Side Public License (SSPL)",
    pattern: /\b(?:SSPL(?:-\d+(?:\.\d+)*)?|SERVER[- ]SIDE[- ]PUBLIC[- ]LICENSE)\b/iu
  },
  {
    // SPDX BSL-1.0 is the unrelated Boost Software License. BUSL and BSL-1.1
    // identify the Business Source License family that this policy rejects.
    label: "Business Source License (BUSL/BSL-1.1)",
    pattern: /\b(?:BUSL(?:-\d+(?:\.\d+)*)?|BSL-1\.1|BUSINESS[- ]SOURCE[- ]LICENSE)\b/iu
  },
  {
    label: "Elastic License",
    pattern: /\b(?:ELASTIC[- ]LICENSE|ELASTIC-\d+(?:\.\d+)*)\b/iu
  },
  {
    label: "Prosperity restricted-use license",
    pattern: /\bPROSPERITY(?:[- ]PUBLIC)?[- ]LICENSE\b/iu
  },
  {
    label: "unresolved LicenseRef/SEE LICENSE metadata",
    pattern: /(?:\bLICENSE[- ]?REF\b|\bSEE[- ]LICENSE[- ]IN\b)/iu
  },
  {
    label: "missing or unresolved license metadata",
    pattern: /\b(?:UNLICENSED|NOASSERTION|UNKNOWN)\b/iu
  }
] as const);

export function isCommercialUseApprovedLicenseId(
  value: unknown
): value is CommercialUseApprovedLicenseId {
  return typeof value === "string"
    && commercialUseApprovedLicenseIdSet.has(value);
}

export function isThirdPartyBoundaryLicenseId(
  value: unknown
): value is ThirdPartyBoundaryLicenseId {
  return typeof value === "string"
    && thirdPartyBoundaryLicenseIdSet.has(value);
}

/** Detects known restrictive or unresolved markers inside an ID or license. */
export function commercialUseRestrictiveLicenseMarker(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return COMMERCIAL_USE_RESTRICTIVE_LICENSE_PATTERNS.find(
    ({ pattern }) => pattern.test(value)
  )?.label ?? null;
}

/**
 * Returns null only for an exact approved license identifier. Boundary markers,
 * source-available/noncommercial terms and every unknown value fail closed.
 */
export function commercialUseLicenseRejectionReason(
  value: unknown
): string | null {
  const license = typeof value === "string" ? value : "";
  if (isCommercialUseApprovedLicenseId(license)) {
    return null;
  }
  if (!license.trim()) {
    return "라이선스 값이 없으므로 상업 이용 승인 목록과 대조할 수 없습니다.";
  }
  if (isThirdPartyBoundaryLicenseId(license)) {
    return `${license}는 배포 경계 표식이지 상업 이용을 허가하는 라이선스가 아닙니다.`;
  }
  const restrictive = commercialUseRestrictiveLicenseMarker(license);
  if (restrictive) {
    return `${restrictive}은 광고·유료·SaaS 배포 정책에서 허용하지 않습니다.`;
  }
  return `${license}은 현재의 상업 이용 positive allowlist에 없습니다.`;
}

export interface VerifiedRedistributedArtifact {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

export interface VerifiedBundledFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

interface AttributionBase<TLicense extends ThirdPartyLicenseId> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: TLicense;
  readonly upstream: string;
  readonly purpose: string;
}

export interface WebBundledAttribution
  extends AttributionBase<CommercialUseApprovedLicenseId> {
  readonly kind: "web-bundled";
  readonly bundledFiles: readonly [
    VerifiedBundledFile,
    ...VerifiedBundledFile[]
  ];
  readonly licenseTextPath: string;
  readonly correspondingSource: string;
}

export interface SeparatelyLicensedSourceAttribution
  extends AttributionBase<CommercialUseApprovedLicenseId> {
  readonly kind: "separately-licensed-source";
  readonly sourcePaths: readonly [string, ...string[]];
  readonly licenseTextPath: string;
  readonly licenseTextSize: number;
  readonly licenseTextSha256: string;
  readonly compiledNotice: string;
}

export interface RuntimeDownloadedAttribution
  extends AttributionBase<CommercialUseApprovedLicenseId> {
  readonly kind: "runtime-downloaded";
  readonly artifacts: readonly [
    VerifiedRedistributedArtifact,
    ...VerifiedRedistributedArtifact[]
  ];
  readonly installScope: "per-user-xdg";
  readonly embeddedComponents?: readonly EmbeddedComponent[];
}

export interface EmbeddedComponent {
  readonly name: string;
  readonly version: string;
  readonly license: CommercialUseApprovedLicenseId;
  readonly upstream: string;
}

export interface SystemProvidedAttribution
  extends AttributionBase<"build-dependent"> {
  readonly kind: "system-provided";
  readonly redistributed: false;
  readonly detection: readonly [string, ...string[]];
  readonly licenseDependsOnBuild: boolean;
}

export interface DevelopmentOnlyAttribution
  extends AttributionBase<"mixed-see-packages"> {
  readonly kind: "development-only";
  readonly redistributed: false;
  readonly packages: readonly [string, ...string[]];
  readonly lockfile: "package-lock.json";
}

export interface LocalCompanionRuntimeAttribution
  extends AttributionBase<CommercialUseApprovedLicenseId> {
  readonly kind: "local-companion-runtime";
  readonly redistributed: false;
  readonly packages: readonly [string, ...string[]];
  readonly lockfile: "package-lock.json";
  readonly executionScope: "repository-local-node-modules";
}

export interface CiOnlyAttribution
  extends AttributionBase<"mixed-see-packages"> {
  readonly kind: "ci-only";
  readonly redistributed: false;
  readonly workflowPath: ".github/workflows/typescript-quality.yml";
  readonly actions: readonly [{
    readonly slug: string;
    readonly ref: string;
    readonly releaseLabel: string;
    readonly license: CommercialUseApprovedLicenseId;
    readonly source: string;
    readonly licenseSource: string;
  }, ...Array<{
    readonly slug: string;
    readonly ref: string;
    readonly releaseLabel: string;
    readonly license: CommercialUseApprovedLicenseId;
    readonly source: string;
    readonly licenseSource: string;
  }>];
}

export interface ExternalReferenceAttribution
  extends AttributionBase<"external-terms"> {
  readonly kind: "external-service-reference";
  readonly redistributed: false;
  readonly trademarkOwner: string;
  readonly affiliationClaimed: false;
}

export type ThirdPartyAttribution =
  | CiOnlyAttribution
  | DevelopmentOnlyAttribution
  | WebBundledAttribution
  | ExternalReferenceAttribution
  | LocalCompanionRuntimeAttribution
  | RuntimeDownloadedAttribution
  | SeparatelyLicensedSourceAttribution
  | SystemProvidedAttribution;

const WHISPER_MODEL_REVISION =
  "5359861c739e955e79d9a303bcbc70fb988958b1";
const WHISPER_VAD_REVISION =
  "9ffd54a1e1ee413ddf265af9913beaf518d1639b";

/**
 * Release-significant externally authored components and externally controlled
 * service names used by the current product/runtime are represented here.
 * Final web/container artifacts still require an SBOM and binary-level review.
 */
export const THIRD_PARTY_ATTRIBUTIONS = [
  {
    id: "mediabunny",
    kind: "web-bundled",
    name: "Mediabunny",
    version: "1.51.0",
    license: "MPL-2.0",
    upstream: "https://github.com/Vanilagy/mediabunny",
    purpose: "브라우저 안에서 로컬 미디어를 읽고 인코딩·mux합니다.",
    bundledFiles: [{
      path: "web/licenses/MEDIABUNNY-MPL-2.0.txt",
      size: 16_726,
      sha256:
        "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04"
    }],
    licenseTextPath: "web/licenses/MEDIABUNNY-MPL-2.0.txt",
    correspondingSource:
      "https://registry.npmjs.org/mediabunny/-/mediabunny-1.51.0.tgz"
  },
  {
    id: "pretendard",
    kind: "web-bundled",
    name: "Pretendard ExtraBold",
    version: "1.3.9",
    license: "OFL-1.1",
    upstream: "https://github.com/orioncactus/pretendard/tree/v1.3.9",
    purpose: "기본 한국어 자막 글꼴입니다.",
    bundledFiles: [
      {
        path: "web/editor/fonts/Pretendard-ExtraBold.woff2",
        size: 793_540,
        sha256:
          "dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3"
      },
      {
        path: "web/licenses/PRETENDARD-OFL-1.1.txt",
        size: 4_418,
        sha256:
          "d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04"
      }
    ],
    licenseTextPath: "web/licenses/PRETENDARD-OFL-1.1.txt",
    correspondingSource:
      "https://github.com/orioncactus/pretendard/releases/tag/v1.3.9"
  },
  {
    id: "paperlogy",
    kind: "web-bundled",
    name: "Paperlogy 8 ExtraBold",
    version: "1.001",
    license: "OFL-1.1",
    upstream:
      "https://github.com/Freesentation/paperlogy/tree/8ef35f53b318c7ca914c52b1b382b9a8bad07a61",
    purpose: "선택 가능한 한국어 자막 글꼴입니다.",
    bundledFiles: [
      {
        path: "web/editor/fonts/Paperlogy-8ExtraBold.woff2",
        size: 430_124,
        sha256:
          "5047db061c39ec5ed5c9d0b71c7aaad4b9547ed15ce48d1cd74090169f132bc0"
      },
      {
        path: "web/licenses/PAPERLOGY-OFL-1.1.txt",
        size: 4_380,
        sha256:
          "603b2e7ef9effb9037b0b67f0530cacdc05e71a4e569032d7e4d98c2e6763135"
      }
    ],
    licenseTextPath: "web/licenses/PAPERLOGY-OFL-1.1.txt",
    correspondingSource:
      "https://github.com/Freesentation/paperlogy/tree/8ef35f53b318c7ca914c52b1b382b9a8bad07a61"
  },
  {
    id: "audseg",
    kind: "separately-licensed-source",
    name: "AudSeg browser port",
    version: "0.1.0",
    license: "MIT",
    upstream:
      "https://github.com/studyreadbook4ever/KirinukiHelper/tree/eef841a336613fe8fe825ab231d9bbe770751ee2/AudSeg",
    purpose: "모델 없이 음성 활동 구간과 빈 자막 타이밍을 만듭니다.",
    sourcePaths: ["AudSeg/", "src/editor/audseg.ts"],
    licenseTextPath: "web/licenses/AUDSEG-MIT.txt",
    licenseTextSize: 1_076,
    licenseTextSha256:
      "e492735a5732fcd497ce6854a6ee09ff7ff6a27977d5e54b2269a60788a98e25",
    compiledNotice:
      "AudSeg 0.1.0 browser integration — SPDX-License-Identifier: MIT"
  },
  {
    id: "whisper-cpp",
    kind: "runtime-downloaded",
    name: "whisper.cpp",
    version: "v1.8.6 / 23ee03506a91ac3d3f0071b40e66a430eebdfa1d",
    license: "MIT",
    upstream: "https://github.com/ggml-org/whisper.cpp",
    purpose: "선택한 로컬 Whisper 자막 서버를 사용자 기기에서 빌드합니다.",
    installScope: "per-user-xdg",
    artifacts: [{
      name: "whisper.cpp-v1.8.6.tar.gz",
      url:
        "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/23ee03506a91ac3d3f0071b40e66a430eebdfa1d",
      size: 8_846_418,
      sha256:
        "c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032"
    }],
    embeddedComponents: [
      {
        name: "ggml",
        version: "source at pinned whisper.cpp commit",
        license: "MIT",
        upstream: "https://github.com/ggml-org/ggml"
      },
      {
        name: "cpp-httplib",
        version: "vendored header at pinned whisper.cpp commit",
        license: "MIT",
        upstream: "https://github.com/yhirose/cpp-httplib"
      },
      {
        name: "nlohmann/json",
        version: "vendored header at pinned whisper.cpp commit",
        license: "MIT",
        upstream: "https://github.com/nlohmann/json"
      },
      {
        name: "stb_vorbis",
        version: "vendored source at pinned whisper.cpp commit",
        license: "MIT-or-Unlicense",
        upstream: "https://github.com/nothings/stb"
      },
      {
        name: "miniaudio",
        version: "vendored header at pinned whisper.cpp commit",
        license: "MIT-0-or-Unlicense",
        upstream: "https://github.com/mackron/miniaudio"
      }
    ]
  },
  {
    id: "openai-whisper-models",
    kind: "runtime-downloaded",
    name: "Quantized OpenAI Whisper models for whisper.cpp",
    version: WHISPER_MODEL_REVISION,
    license: "MIT",
    upstream: "https://huggingface.co/ggerganov/whisper.cpp",
    purpose: "사용자가 고른 로컬 음성 인식 프로필의 모델 가중치입니다.",
    installScope: "per-user-xdg",
    artifacts: [
      {
        name: "ggml-tiny-q5_1.bin",
        url:
          `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-tiny-q5_1.bin`,
        size: 32_152_673,
        sha256:
          "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"
      },
      {
        name: "ggml-base-q5_1.bin",
        url:
          `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-base-q5_1.bin`,
        size: 59_707_625,
        sha256:
          "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
      },
      {
        name: "ggml-small-q5_1.bin",
        url:
          `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-small-q5_1.bin`,
        size: 190_085_487,
        sha256:
          "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"
      },
      {
        name: "ggml-medium-q5_0.bin",
        url:
          `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-medium-q5_0.bin`,
        size: 539_212_467,
        sha256:
          "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f"
      }
    ]
  },
  {
    id: "silero-vad",
    kind: "runtime-downloaded",
    name: "Silero VAD converted for whisper.cpp",
    version: `6.2 / ${WHISPER_VAD_REVISION}`,
    license: "MIT",
    upstream: "https://github.com/snakers4/silero-vad",
    purpose: "로컬 Whisper 입력에서 음성 활동을 검출합니다.",
    installScope: "per-user-xdg",
    artifacts: [{
      name: "ggml-silero-v6.2.0.bin",
      url:
        `https://huggingface.co/ggml-org/whisper-vad/resolve/${WHISPER_VAD_REVISION}/ggml-silero-v6.2.0.bin`,
      size: 885_098,
      sha256:
        "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
    }]
  },
  {
    id: "yt-dlp",
    kind: "runtime-downloaded",
    name: "yt-dlp Unix zipimport executable",
    version: "2026.07.04",
    license: "Unlicense",
    upstream: "https://github.com/yt-dlp/yt-dlp",
    purpose: "권한이 확인된 공개 YouTube·SOOP VOD의 선택 구간을 준비합니다.",
    installScope: "per-user-xdg",
    artifacts: [{
      name: "yt-dlp",
      url:
        "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp",
      size: 3_071_553,
      sha256:
        "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd"
    }],
    embeddedComponents: [
      {
        name: "yt-dlp-ejs",
        version: "0.8.0",
        license: "Unlicense",
        upstream: "https://github.com/yt-dlp/ejs"
      },
      {
        name: "Meriyah",
        version: "6.1.4",
        license: "ISC",
        upstream: "https://github.com/meriyah/meriyah"
      },
      {
        name: "Astring",
        version: "1.9.0",
        license: "MIT",
        upstream: "https://github.com/davidbonnet/astring"
      }
    ]
  },
  {
    id: "ffmpeg",
    kind: "system-provided",
    name: "FFmpeg",
    version: "detected at runtime",
    license: "build-dependent",
    upstream: "https://ffmpeg.org/",
    purpose: "로컬 구간의 디코딩·리먹싱·인코딩을 수행합니다.",
    redistributed: false,
    detection: ["ffmpeg -version", "ffmpeg -buildconf"],
    licenseDependsOnBuild: true
  },
  {
    id: "ffprobe",
    kind: "system-provided",
    name: "ffprobe",
    version: "detected at runtime",
    license: "build-dependent",
    upstream: "https://ffmpeg.org/ffprobe.html",
    purpose: "로컬 구간의 스트림·시간축 정보를 검사합니다.",
    redistributed: false,
    detection: ["ffprobe -version", "ffmpeg -buildconf"],
    licenseDependsOnBuild: true
  },
  {
    id: "nodejs",
    kind: "system-provided",
    name: "Node.js",
    version: ">=22",
    license: "build-dependent",
    upstream: "https://github.com/nodejs/node",
    purpose: "빌드 스크립트와 Kirinuki 내부 엔진을 실행합니다.",
    redistributed: false,
    detection: ["node --version", "node -p process.versions"],
    licenseDependsOnBuild: true
  },
  {
    id: "python",
    kind: "system-provided",
    name: "Python",
    version: ">=3.11 for managed yt-dlp zipimport",
    license: "build-dependent",
    upstream: "https://www.python.org/",
    purpose: "검증된 yt-dlp zipimport 실행 파일을 구동합니다.",
    redistributed: false,
    detection: ["python3 --version"],
    licenseDependsOnBuild: true
  },
  {
    id: "chromium",
    kind: "system-provided",
    name: "Chromium or Google Chrome and ChromeDriver",
    version: "detected at test/runtime",
    license: "build-dependent",
    upstream: "https://www.chromium.org/chromium-projects/",
    purpose: "localhost 웹 실행과 브라우저 E2E 검증에 사용합니다.",
    redistributed: false,
    detection: [
      "chromium --version or google-chrome --version",
      "chromedriver --version"
    ],
    licenseDependsOnBuild: true
  },
  {
    id: "tsx-runtime",
    kind: "local-companion-runtime",
    name: "tsx and esbuild Kirinuki internal runtime",
    version: "package-lock.json exact pins",
    license: "MIT",
    upstream: "https://github.com/privatenumber/tsx",
    purpose: "TypeScript로 작성된 Kirinuki 내부 엔진·설치·연결 CLI를 실행합니다.",
    redistributed: false,
    packages: [
      "tsx@4.23.1 (MIT)",
      "esbuild@0.28.1 and platform packages (MIT)",
      "fsevents@2.3.3 optional on macOS (MIT)"
    ],
    lockfile: "package-lock.json",
    executionScope: "repository-local-node-modules"
  },
  {
    id: "typescript-toolchain",
    kind: "development-only",
    name: "TypeScript build and type toolchain",
    version: "package-lock.json exact pins",
    license: "mixed-see-packages",
    upstream: "https://github.com/microsoft/TypeScript",
    purpose: "TypeScript 타입 검사와 브라우저 번들 생성에 사용합니다.",
    redistributed: false,
    packages: [
      "typescript@5.9.3 (Apache-2.0)",
      "@types/node@20.19.43 and undici-types@6.21.0 (MIT)"
    ],
    lockfile: "package-lock.json"
  },
  {
    id: "github-actions-ci",
    kind: "ci-only",
    name: "Pinned GitHub Actions CI components",
    version: "full commit SHA pins",
    license: "mixed-see-packages",
    upstream: "https://docs.github.com/actions",
    purpose: "TypeScript 품질 검사와 실제 9:16 Shorts browser/render E2E를 실행합니다.",
    redistributed: false,
    workflowPath: ".github/workflows/typescript-quality.yml",
    actions: [
      {
        slug: "actions/checkout",
        ref: "11d5960a326750d5838078e36cf38b85af677262",
        releaseLabel: "v4",
        license: "MIT",
        source:
          "https://github.com/actions/checkout/tree/11d5960a326750d5838078e36cf38b85af677262",
        licenseSource:
          "https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/LICENSE"
      },
      {
        slug: "actions/setup-node",
        ref: "49933ea5288caeca8642d1e84afbd3f7d6820020",
        releaseLabel: "v4",
        license: "MIT",
        source:
          "https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020",
        licenseSource:
          "https://github.com/actions/setup-node/blob/49933ea5288caeca8642d1e84afbd3f7d6820020/LICENSE"
      },
      {
        slug: "browser-actions/setup-chrome",
        ref: "2e1d749697dd1612b833dba4a722266286fbefcd",
        releaseLabel: "v2.1.2 / v2",
        license: "MIT",
        source:
          "https://github.com/browser-actions/setup-chrome/tree/73954683cc80eced513145a42b668b9b91f753c3",
        licenseSource:
          "https://github.com/browser-actions/setup-chrome/blob/73954683cc80eced513145a42b668b9b91f753c3/LICENSE"
      }
    ]
  },
  {
    id: "chzzk-service",
    kind: "external-service-reference",
    name: "CHZZK",
    version: "external service",
    license: "external-terms",
    upstream: "https://chzzk.naver.com/",
    purpose: "지원 원본 플랫폼 이름과 공개 페이지 연결에만 사용합니다.",
    redistributed: false,
    trademarkOwner: "NAVER Corp. and/or its licensors",
    affiliationClaimed: false
  },
  {
    id: "youtube-service",
    kind: "external-service-reference",
    name: "YouTube",
    version: "external service",
    license: "external-terms",
    upstream: "https://www.youtube.com/",
    purpose: "공식 No-Cookie embed와 IFrame Player API를 통한 client-side 원본 확인에 사용합니다.",
    redistributed: false,
    trademarkOwner: "Google LLC and/or its licensors",
    affiliationClaimed: false
  },
  {
    id: "soop-service",
    kind: "external-service-reference",
    name: "SOOP",
    version: "external service",
    license: "external-terms",
    upstream: "https://www.sooplive.co.kr/",
    purpose: "지원 원본 플랫폼 이름과 공개 페이지 연결에만 사용합니다.",
    redistributed: false,
    trademarkOwner: "SOOP Co., Ltd. and/or its licensors",
    affiliationClaimed: false
  }
] as const satisfies readonly ThirdPartyAttribution[];

export const THIRD_PARTY_ATTRIBUTION_IDS = Object.freeze(
  THIRD_PARTY_ATTRIBUTIONS.map(({ id }) => id)
);

export function thirdPartyAttributionById(
  id: string
): ThirdPartyAttribution | undefined {
  return THIRD_PARTY_ATTRIBUTIONS.find((entry) => entry.id === id);
}
