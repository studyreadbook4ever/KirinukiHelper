import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMERCIAL_USE_APPROVED_LICENSE_IDS,
  THIRD_PARTY_ATTRIBUTIONS,
  THIRD_PARTY_ATTRIBUTION_IDS,
  commercialUseLicenseRejectionReason,
  commercialUseRestrictiveLicenseMarker
} from "../src/lib/third-party-attributions.js";
import { WEB_PACKAGE_FILES } from "./web-package-files.js";
import {
  MINIMUM_NODE_VERSION,
  PINNED_MODELS,
  PINNED_VAD_MODEL,
  PINNED_WHISPER_CPP
} from "./local-caption-stack-core.js";
import {
  MINIMUM_VOD_NODE_VERSION,
  PINNED_YT_DLP
} from "./local-vod-runtime-core.js";
import { PAPERLOGY_FONT } from "./paperlogy-font.js";
import { PRETENDARD_FONT } from "./pretendard-font.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const embeddedAudSegRoot = path.join(root, "AudSeg");
const webRoot = path.join(root, "web");
const publicShellRoot = path.join(root, "public-shell");
if (process.argv.slice(2).length > 0) {
  throw new TypeError("사용법: check-third-party-licenses.ts");
}
const EXPECTED_NPM_INVENTORY_SHA256 =
  "48dee2a9d866ee2150a2c9359bd782f42c88b35c3b127927970eb343b0cd5f7a";
const EXPECTED_PROJECT_UNLICENSE_SIZE = 1_212;
const EXPECTED_PROJECT_UNLICENSE_SHA256 =
  "b5065838cbac452dfc855ba6e6e031481ad2c68406f70d21ead9321374653e6c";

interface LockPackage {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dev?: boolean;
  optional?: boolean;
  hasInstallScript?: boolean;
}

interface PackageLock {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
}

interface PackageManifest {
  name?: string;
  license?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function bytes(relativePath: string, base: string = root) {
  return readFile(path.join(base, relativePath));
}

async function assertAbsent(relativePath: string) {
  try {
    await access(path.join(root, relativePath));
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`저장소에 없어야 하는 파일이 다시 생겼습니다: ${relativePath}`);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson<T>(value: Buffer): T {
  return JSON.parse(value.toString("utf8")) as T;
}

function assertExactObject(
  actual: unknown,
  expected: unknown,
  label: string
) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} 목록이 승인된 라이선스 인벤토리와 다릅니다.`
  );
}

function assertRegistryArtifact(
  packagePath: string,
  metadata: LockPackage
) {
  assert(
    metadata.resolved?.startsWith("https://registry.npmjs.org/"),
    `${packagePath}는 고정된 npm HTTPS registry artifact여야 합니다.`
  );
  assert(
    /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(metadata.integrity || ""),
    `${packagePath}의 npm integrity가 없거나 SHA-512 형식이 아닙니다.`
  );
}

function assertLockPackage(packagePath: string, metadata: LockPackage) {
  const version = String(metadata?.version || "");
  const license = String(metadata?.license || "");
  const commercialUseRejection = commercialUseLicenseRejectionReason(license);
  assert(
    commercialUseRejection === null,
    `${packagePath}의 라이선스가 상업 이용 positive allowlist를 통과하지 못했습니다: ${commercialUseRejection}`
  );
  assertRegistryArtifact(packagePath, metadata);
  if (packagePath === "node_modules/mediabunny") {
    assert(version === "1.51.0", "Mediabunny 버전이 승인된 1.51.0과 다릅니다.");
    assert(license === "MPL-2.0", "Mediabunny 라이선스가 MPL-2.0이 아닙니다.");
    assert(metadata.dev !== true, "Mediabunny가 runtime dependency가 아닙니다.");
    return;
  }
  if (packagePath === "node_modules/esbuild") {
    assert(version === "0.28.1", "esbuild 버전이 승인된 0.28.1과 다릅니다.");
    assert(license === "MIT", "esbuild 라이선스가 MIT가 아닙니다.");
    assert(
      metadata.dev !== true && metadata.hasInstallScript === true,
      "esbuild는 설치 스크립트가 명시된 production companion dependency여야 합니다."
    );
    return;
  }
  if (/^node_modules\/@esbuild\/[^/]+$/u.test(packagePath)) {
    assert(version === "0.28.1", `${packagePath} 버전이 esbuild와 다릅니다.`);
    assert(license === "MIT", `${packagePath} 라이선스가 MIT가 아닙니다.`);
    assert(
      metadata.dev !== true && metadata.optional === true,
      `${packagePath}는 optional production companion binary여야 합니다.`
    );
    return;
  }
  const approvedPackages = new Map<string, {
    version: string;
    license: string;
    dev?: boolean;
    optional?: boolean;
    hasInstallScript?: boolean;
  }>([
    ["node_modules/@types/dom-mediacapture-transform", {
      version: "0.1.12",
      license: "MIT"
    }],
    ["node_modules/@types/dom-webcodecs", {
      version: "0.1.13",
      license: "MIT"
    }],
    ["node_modules/@types/node", {
      version: "20.19.43",
      license: "MIT",
      dev: true
    }],
    ["node_modules/fsevents", {
      version: "2.3.3",
      license: "MIT",
      optional: true,
      hasInstallScript: true
    }],
    ["node_modules/tsx", {
      version: "4.23.1",
      license: "MIT"
    }],
    ["node_modules/typescript", {
      version: "5.9.3",
      license: "Apache-2.0",
      dev: true
    }],
    ["node_modules/undici-types", {
      version: "6.21.0",
      license: "MIT",
      dev: true
    }]
  ]);
  const approved = approvedPackages.get(packagePath);
  if (approved) {
    assert(version === approved.version, `${packagePath} 버전이 승인 목록과 다릅니다.`);
    assert(license === approved.license, `${packagePath} 라이선스가 승인 목록과 다릅니다.`);
    assert(
      Boolean(metadata.dev) === Boolean(approved.dev),
      `${packagePath}의 npm dev-flag 분류가 승인 목록과 다릅니다.`
    );
    assert(
      Boolean(metadata.optional) === Boolean(approved.optional),
      `${packagePath}의 optional 분류가 승인 목록과 다릅니다.`
    );
    assert(
      Boolean(metadata.hasInstallScript) === Boolean(approved.hasInstallScript),
      `${packagePath}의 install script 분류가 승인 목록과 다릅니다.`
    );
    return;
  }
  // Desktop preview tooling is an exact root devDependency closure. Every
  // artifact is still registry+integrity checked above and the complete
  // version/license/flag set is pinned by EXPECTED_NPM_INVENTORY_SHA256.
  if (metadata.dev === true) {
    return;
  }
  throw new Error(
    `승인되지 않은 npm 패키지입니다: ${packagePath} ${version} (${license || "license 없음"})`
  );
}

const [packageJson, packageLock] = await Promise.all([
  bytes("package.json").then(parseJson<PackageManifest>),
  bytes("package-lock.json").then(parseJson<PackageLock>)
]);
assert(
  packageJson.name === "kirinuki-app"
    && packageLock.name === "kirinuki-app"
    && packageLock.packages?.[""]?.name === "kirinuki-app",
  "root package metadata가 localhost web studio를 가리키지 않습니다."
);
assert(
  packageJson.license === "Unlicense",
  "KirinukiHelper package license는 SPDX Unlicense여야 합니다."
);
assert(
  commercialUseLicenseRejectionReason(packageJson.license) === null,
  "KirinukiHelper package license가 상업 이용 positive allowlist를 통과하지 못했습니다."
);
assert(
  packageJson.engines?.node === ">=22.13.0",
  "node:sqlite lease와 managed yt-dlp EJS runtime의 Node 하한은 >=22.13.0이어야 합니다."
);
assert(
  MINIMUM_NODE_VERSION === "22.13.0"
    && MINIMUM_VOD_NODE_VERSION === "22.13.0",
  "로컬 caption/VOD runtime의 Node 하한이 license inventory와 다릅니다."
);
await Promise.all([
  assertAbsent("LICENSE"),
  assertAbsent("extension"),
  assertAbsent("scripts/acquire-youtube.ts"),
  assertAbsent("tests/youtube-acquire.test.ts"),
  assertAbsent("scripts/create-synthetic-beta.py"),
  assertAbsent("scripts/solar-caption-gateway.js"),
  assertAbsent("scripts/solar-caption-gateway.ts"),
  assertAbsent("src/caption-agent/solar-gateway-core.js"),
  assertAbsent("src/caption-agent/solar-gateway-core.ts")
]);
assert(
  packageJson.scripts?.["acquire:youtube"] === undefined,
  "관리형 runtime을 우회하는 전체 YouTube 다운로드 script가 남아 있습니다."
);
const mediabunnyLock = packageLock.packages?.["node_modules/mediabunny"];

assertExactObject(
  packageJson.dependencies,
  {
    esbuild: "0.28.1",
    mediabunny: "1.51.0",
    tsx: "4.23.1"
  },
  "runtime dependency"
);
assertExactObject(
  packageJson.devDependencies,
  {
    "@electron/asar": "4.2.1",
    "@electron/fuses": "2.1.3",
    "@electron/packager": "20.3.0",
    "@types/node": "20.19.43",
    electron: "43.4.0",
    typescript: "5.9.3"
  },
  "development dependency"
);
assert(
  packageLock.lockfileVersion === 3,
  "package-lock.json lockfileVersion은 3이어야 합니다."
);
assert(
  packageLock.packages?.[""]?.license === "Unlicense",
  "package-lock root license는 SPDX Unlicense여야 합니다."
);
assert(
  mediabunnyLock?.resolved
    === "https://registry.npmjs.org/mediabunny/-/mediabunny-1.51.0.tgz",
  "Mediabunny 대응 소스 package URL이 고정값과 다릅니다."
);
assert(
  mediabunnyLock?.integrity
    === "sha512-u327374xU8Ho0gCaMII7fUK8t0PnqkabCox1k8uUwvgvGb9o6YQGZEG2Qr4DTe7nTMpzfL7ukgnHDvDROySZ+Q==",
  "Mediabunny 대응 소스 package integrity가 고정값과 다릅니다."
);
for (const [packagePath, metadata] of Object.entries(packageLock.packages || {})) {
  if (!packagePath) {
    continue;
  }
  assertLockPackage(packagePath, metadata);
}
const npmInventory = Object.entries(packageLock.packages || {})
  .filter(([packagePath]) => Boolean(packagePath))
  .map(([packagePath, metadata]) => ({
    packagePath,
    version: metadata.version || "",
    license: metadata.license || "",
    resolved: metadata.resolved || "",
    integrity: metadata.integrity || "",
    dev: Boolean(metadata.dev),
    optional: Boolean(metadata.optional),
    hasInstallScript: Boolean(metadata.hasInstallScript)
  }))
  .sort((left, right) => left.packagePath.localeCompare(right.packagePath));
assert(
  sha256(JSON.stringify(npmInventory)) === EXPECTED_NPM_INVENTORY_SHA256,
  "package-lock npm artifact 전체 지문이 승인된 인벤토리와 다릅니다."
);

const [
  projectLicense,
  distributedProjectLicense,
  mediabunnyInstalledLicense,
  mediabunnyDistributedLicense,
  audSegSourceLicense,
  audSegDistributedLicense,
  webNotices,
  webNoticeSource,
  runtimeNotices,
  openSourceInventory,
  runtimeDependencies,
  webDeploymentChecklist,
  firstPartyRightsReview,
  commercialUsePolicy,
  licensePage,
  audSegSource,
  mediaEngineSource,
  compiledEditor,
  compiledAudSegWorker,
  localCaptionStackSource,
  typescriptQualityWorkflow,
  publicShellNotice,
  publicShellProjectLicense
] = await Promise.all([
  bytes("UNLICENSE"),
  bytes("licenses/UNLICENSE.txt", webRoot),
  bytes("node_modules/mediabunny/LICENSE"),
  bytes("licenses/MEDIABUNNY-MPL-2.0.txt", webRoot),
  bytes("LICENSE", embeddedAudSegRoot),
  bytes("licenses/AUDSEG-MIT.txt", webRoot),
  bytes("THIRD_PARTY_NOTICES.md", webRoot),
  bytes("legal/WEB_THIRD_PARTY_NOTICES.md"),
  bytes("legal/THIRD_PARTY_NOTICES.md"),
  bytes("legal/OPEN_SOURCE_INVENTORY.md"),
  bytes("legal/RUNTIME_DEPENDENCIES.md"),
  bytes("legal/WEB_DEPLOYMENT_CHECKLIST.md"),
  bytes("legal/FIRST_PARTY_RIGHTS_REVIEW.md"),
  bytes("legal/COMMERCIAL_USE_POLICY.md"),
  bytes("licenses.html", webRoot),
  bytes("src/editor/audseg.ts"),
  bytes("src/editor/media-engine.ts"),
  bytes("editor/editor.js", webRoot),
  bytes("editor/audseg-worker.js", webRoot),
  bytes("scripts/local-caption-stack.ts"),
  bytes(".github/workflows/typescript-quality.yml"),
  bytes("THIRD_PARTY_NOTICES.md", publicShellRoot),
  bytes("licenses/UNLICENSE.txt", publicShellRoot)
]);
assert(
  projectLicense.equals(distributedProjectLicense),
  "KirinukiHelper Unlicense 원문과 web 배포 사본이 다릅니다."
);
assert(
  projectLicense.equals(publicShellProjectLicense),
  "KirinukiHelper Unlicense 원문과 공개 shell 사본이 다릅니다."
);
assert(
  projectLicense.toString("utf8").startsWith(
    "This is free and unencumbered software released into the public domain.\n"
  )
    && projectLicense.toString("utf8").includes(
      "For more information, please refer to <https://unlicense.org/>"
    ),
  "KirinukiHelper Unlicense 원문이 표준 문구와 일치하지 않습니다."
);
assert(
  projectLicense.byteLength === EXPECTED_PROJECT_UNLICENSE_SIZE
    && sha256(projectLicense) === EXPECTED_PROJECT_UNLICENSE_SHA256,
  "KirinukiHelper Unlicense 원문에 addendum 또는 예상하지 않은 변경이 있습니다."
);

assert(
  mediabunnyInstalledLicense.equals(mediabunnyDistributedLicense),
  "Mediabunny MPL-2.0 원문과 web 배포 사본이 다릅니다."
);
assert(
  audSegSourceLicense.equals(audSegDistributedLicense),
  "AudSeg MIT 원문과 web 배포 사본이 다릅니다."
);
for (const [label, licenseText] of [
  ["KirinukiHelper Unlicense", projectLicense],
  ["Mediabunny MPL-2.0", mediabunnyInstalledLicense],
  ["AudSeg MIT", audSegSourceLicense]
] as const) {
  const restrictiveMarker = commercialUseRestrictiveLicenseMarker(
    licenseText.toString("utf8")
  );
  assert(
    restrictiveMarker === null,
    `${label} 원문에 허용하지 않는 상업·field-of-use 제한 표식이 있습니다: ${restrictiveMarker}`
  );
}
assert(
  webNotices.equals(webNoticeSource),
  "web 고지가 scoped source 문서와 다릅니다. npm run build를 실행하세요."
);
assert(
  !webNotices.equals(runtimeNotices),
  "web 정적 고지와 전체 runtime 고지는 서로 다른 배포 범위를 가져야 합니다."
);
await access(path.join(root, "node_modules", "mediabunny", "src", "index.ts"));

for (const font of [PRETENDARD_FONT, PAPERLOGY_FONT]) {
  const [
    sourceFont,
    distributedFont,
    sourceLicense,
    distributedLicense
  ] = await Promise.all([
    bytes(font.sourceFontPath),
    bytes(font.webFontPath, webRoot),
    bytes(font.sourceLicensePath),
    bytes(font.webLicensePath, webRoot)
  ]);
  assert(sourceFont.equals(distributedFont), `${font.family || "Pretendard"} 글꼴 사본이 다릅니다.`);
  assert(sourceLicense.equals(distributedLicense), `${font.family || "Pretendard"} OFL 사본이 다릅니다.`);
  assert(sha256(sourceFont) === font.fontSha256, `${font.family || "Pretendard"} 글꼴 SHA-256이 다릅니다.`);
  assert(sha256(sourceLicense) === font.licenseSha256, `${font.family || "Pretendard"} OFL SHA-256이 다릅니다.`);
  const restrictiveMarker = commercialUseRestrictiveLicenseMarker(
    sourceLicense.toString("utf8")
  );
  assert(
    restrictiveMarker === null,
    `${font.family || "Pretendard"} OFL 원문에 허용하지 않는 상업·field-of-use 제한 표식이 있습니다: ${restrictiveMarker}`
  );
}

for (const requiredPath of [
  "THIRD_PARTY_NOTICES.md",
  "licenses.css",
  "licenses.html",
  "licenses/AUDSEG-MIT.txt",
  "licenses/MEDIABUNNY-MPL-2.0.txt",
  "licenses/UNLICENSE.txt",
  PRETENDARD_FONT.webLicensePath,
  PAPERLOGY_FONT.webLicensePath
]) {
  assert(
    WEB_PACKAGE_FILES.includes(requiredPath),
    `앱 web assets allowlist에 라이선스 파일이 없습니다: ${requiredPath}`
  );
}
assert(
  WEB_PACKAGE_FILES.every((relativePath) => (
    !relativePath.startsWith("knowledge/")
  )),
  "정책 캐시 또는 내부 지식 파일이 앱 web assets 목록에 있습니다."
);

const webNoticeText = webNotices.toString("utf8");
const runtimeNoticeText = runtimeNotices.toString("utf8");
const inventoryText = openSourceInventory.toString("utf8");
const runtimeDependenciesText = runtimeDependencies.toString("utf8");
const webChecklistText = webDeploymentChecklist.toString("utf8");
const firstPartyRightsReviewText = firstPartyRightsReview.toString("utf8");
const commercialUsePolicyText = commercialUsePolicy.toString("utf8");
const licensePageText = licensePage.toString("utf8");
const localCaptionStackText = localCaptionStackSource.toString("utf8");
const typescriptQualityWorkflowText = typescriptQualityWorkflow.toString("utf8");
const audSegProjectMetadata = (await bytes("AudSeg/pyproject.toml")).toString("utf8");

assert(
  !webNoticeText.includes("studyreadbook4ever/myChangGo")
    && !runtimeNoticeText.includes("studyreadbook4ever/myChangGo")
    && !audSegProjectMetadata.includes("studyreadbook4ever/myChangGo"),
  "삭제된 myChangGo 하위 경로를 대응 소스 또는 패키지 메타데이터 위치로 고지하면 안 됩니다."
);
assert(
  audSegProjectMetadata.includes(
    'Repository = "https://github.com/studyreadbook4ever/KirinukiHelper/tree/eef841a336613fe8fe825ab231d9bbe770751ee2/AudSeg"'
  )
    && audSegProjectMetadata.includes("dependencies = []")
    && audSegProjectMetadata.includes('requires = ["hatchling>=1.27"]')
    && audSegProjectMetadata.includes('"pytest>=8.3,<10"')
    && audSegProjectMetadata.includes('"pytest-cov>=6,<8"')
    && audSegProjectMetadata.includes('"ruff>=0.8,<1"'),
  "AudSeg 패키지 메타데이터는 고정 commit의 대응 소스 위치를 가리켜야 합니다."
);

const expectedAttributionIds = [
  "mediabunny",
  "pretendard",
  "paperlogy",
  "audseg",
  "whisper-cpp",
  "openai-whisper-models",
  "silero-vad",
  "yt-dlp",
  "ffmpeg",
  "ffprobe",
  "nodejs",
  "python",
  "chromium",
  "tsx-runtime",
  "desktop-preview-runtime",
  "typescript-toolchain",
  "github-actions-ci",
  "chzzk-service",
  "youtube-service",
  "soop-service"
] as const;
assert(
  JSON.stringify(THIRD_PARTY_ATTRIBUTION_IDS)
    === JSON.stringify(expectedAttributionIds),
  "canonical third-party registry ID 또는 순서가 승인된 전체 인벤토리와 다릅니다."
);
assert(
  new Set(THIRD_PARTY_ATTRIBUTION_IDS).size
    === THIRD_PARTY_ATTRIBUTION_IDS.length,
  "canonical third-party registry에 중복 ID가 있습니다."
);

for (const entry of THIRD_PARTY_ATTRIBUTIONS) {
  const marker = `<!-- attribution-id: ${entry.id} -->`;
  assert(runtimeNoticeText.includes(marker), `전체 고지에 registry marker가 없습니다: ${entry.id}`);
  assert(inventoryText.includes(marker), `사람용 인벤토리에 registry marker가 없습니다: ${entry.id}`);
  assert(webChecklistText.includes(marker), `웹 배포 gate에 registry marker가 없습니다: ${entry.id}`);
  assert(
    /^https:\/\//u.test(entry.upstream)
      && runtimeNoticeText.includes(entry.upstream),
    `전체 고지에 ${entry.id}의 exact HTTPS upstream이 없습니다.`
  );

  if (entry.kind === "system-provided") {
    assert(
      entry.license === "build-dependent" && entry.redistributed === false,
      `${entry.id}의 build-dependent 표식은 비재배포 system-provided 경계에서만 허용됩니다.`
    );
  } else if (entry.kind === "external-service-reference") {
    assert(
      entry.license === "external-terms" && entry.redistributed === false,
      `${entry.id}의 external-terms 표식은 비재배포 서비스 참조에서만 허용됩니다.`
    );
  } else if (
    entry.kind === "development-only"
    || entry.kind === "ci-only"
    || entry.kind === "desktop-preview-bundle"
  ) {
    assert(
      entry.license === "mixed-see-packages"
        && (entry.kind === "desktop-preview-bundle"
          ? entry.redistributed === true && entry.publicReleaseBlocked === true
          : entry.redistributed === false),
      `${entry.id}의 mixed-see-packages 표식 또는 preview 배포 경계가 올바르지 않습니다.`
    );
  } else {
    const commercialUseRejection = commercialUseLicenseRejectionReason(
      entry.license
    );
    assert(
      commercialUseRejection === null,
      `${entry.id}의 라이선스가 상업 이용 positive allowlist를 통과하지 못했습니다: ${commercialUseRejection}`
    );
  }

  if (entry.kind === "web-bundled") {
    assert(
      webNoticeText.includes(marker)
        && licensePageText.includes(`id="${entry.id}"`),
      `web 고지/라이선스 페이지에 packaged 구성요소가 없습니다: ${entry.id}`
    );
    const packagedLicensePath = entry.licenseTextPath.replace(
      /^web\//u,
      ""
    );
    assert(
      WEB_PACKAGE_FILES.includes(packagedLicensePath),
      `${entry.id} license가 web allowlist에 없습니다.`
    );
    for (const file of entry.bundledFiles) {
      const content = await bytes(file.path);
      assert(content.byteLength === file.size, `${file.path} byte size가 registry와 다릅니다.`);
      assert(sha256(content) === file.sha256, `${file.path} SHA-256이 registry와 다릅니다.`);
      assert(
        webNoticeText.includes(String(file.size))
          && webNoticeText.includes(file.sha256),
        `web 고지에 ${file.path}의 exact size/hash가 없습니다.`
      );
    }
    continue;
  }

  if (entry.kind === "separately-licensed-source") {
    assert(
      webNoticeText.includes(marker)
        && licensePageText.includes(`id="${entry.id}"`),
      `web 고지/라이선스 페이지에 별도 라이선스 소스가 없습니다: ${entry.id}`
    );
    for (const sourcePath of entry.sourcePaths) {
      await access(path.join(root, sourcePath));
    }
    const separateLicenseText = await bytes(entry.licenseTextPath);
    assert(
      separateLicenseText.byteLength === entry.licenseTextSize
        && sha256(separateLicenseText) === entry.licenseTextSha256
        && runtimeNoticeText.includes(String(entry.licenseTextSize))
        && runtimeNoticeText.includes(entry.licenseTextSha256),
      `${entry.id} 별도 라이선스 원문 size/hash 또는 전체 고지가 canonical registry와 다릅니다.`
    );
    assert(
      audSegSource.toString("utf8").includes("/*! @license")
        && audSegSource.toString("utf8").includes(entry.compiledNotice),
      "AudSeg 소스의 bundle-preserved @license provenance가 없습니다."
    );
    continue;
  }

  if (entry.kind === "runtime-downloaded") {
    assert(
      runtimeDependenciesText.includes(marker),
      `runtime dependency 문서에 verified download가 없습니다: ${entry.id}`
    );
    for (const artifact of entry.artifacts) {
      assert(
        /^https:\/\//u.test(artifact.url)
          && Number.isSafeInteger(artifact.size)
          && artifact.size > 0
          && /^[a-f0-9]{64}$/u.test(artifact.sha256),
        `${entry.id}/${artifact.name}는 HTTPS+size+SHA-256이 모두 필요합니다.`
      );
      for (const document of [runtimeNoticeText, runtimeDependenciesText]) {
        assert(
          document.includes(artifact.name)
            && document.includes(artifact.url)
            && document.includes(String(artifact.size))
            && document.includes(artifact.sha256),
          `${entry.id}/${artifact.name} exact artifact 근거가 runtime 문서에 없습니다.`
        );
      }
    }
    const embeddedComponents = "embeddedComponents" in entry
      ? entry.embeddedComponents
      : [];
    for (const embedded of embeddedComponents) {
      const embeddedLicenseRejection = commercialUseLicenseRejectionReason(
        embedded.license
      );
      assert(
        embeddedLicenseRejection === null
          && runtimeNoticeText.includes(embedded.name)
          && runtimeNoticeText.includes(embedded.version)
          && runtimeNoticeText.includes(embedded.license)
          && runtimeNoticeText.includes(embedded.upstream),
        `${entry.id} embedded component의 상업 이용 승인 또는 고지가 불완전합니다: ${embedded.name} (${embeddedLicenseRejection || "notice mismatch"})`
      );
    }
    continue;
  }

  if (entry.kind === "system-provided") {
    assert(
      entry.redistributed === false
        && typeof entry.licenseDependsOnBuild === "boolean"
        && entry.detection.length > 0
        && runtimeDependenciesText.includes(marker),
      `${entry.id} system tool은 detection/build-license/비재배포 경계가 필요합니다.`
    );
    continue;
  }

  if (entry.kind === "development-only") {
    assert(
      entry.redistributed === false
        && entry.lockfile === "package-lock.json"
        && entry.packages.length > 0
        && runtimeDependenciesText.includes(marker),
      `${entry.id} development-only 경계가 불완전합니다.`
    );
    continue;
  }

  if (entry.kind === "desktop-preview-bundle") {
    assert(
      entry.redistributed === true
        && entry.publicReleaseBlocked === true
        && entry.lockfile === "package-lock.json"
        && entry.packages.length > 0
        && entry.releaseGate === "legal/DESKTOP_BINARY_RELEASE_GATE.md"
        && runtimeDependenciesText.includes(marker),
      `${entry.id} desktop preview 공개 차단 경계가 불완전합니다.`
    );
    continue;
  }

  if (entry.kind === "local-companion-runtime") {
    assert(
      entry.redistributed === false
        && entry.lockfile === "package-lock.json"
        && entry.executionScope === "repository-local-node-modules"
        && entry.packages.length > 0
        && runtimeDependenciesText.includes(marker),
      `${entry.id} local companion runtime 경계가 불완전합니다.`
    );
    continue;
  }

  if (entry.kind === "ci-only") {
    assert(
      entry.redistributed === false
        && entry.workflowPath === ".github/workflows/typescript-quality.yml"
        && entry.actions.length > 0
        && runtimeDependenciesText.includes(marker),
      `${entry.id} CI-only provenance 경계가 불완전합니다.`
    );
    for (const action of entry.actions) {
      const actionLicenseRejection = commercialUseLicenseRejectionReason(
        action.license
      );
      assert(
        /^[a-f0-9]{40}$/u.test(action.ref)
          && actionLicenseRejection === null
          && action.license === "MIT"
          && /^https:\/\/github\.com\//u.test(action.source)
          && /^https:\/\/github\.com\//u.test(action.licenseSource)
          && typescriptQualityWorkflowText.includes(
            `uses: ${action.slug}@${action.ref}`
          )
          && runtimeNoticeText.includes(action.ref)
          && inventoryText.includes(action.ref),
        `${entry.id}/${action.slug}의 full SHA·MIT 대응 소스가 불완전합니다.`
      );
    }
    continue;
  }

  assert(
    entry.kind === "external-service-reference"
      && entry.redistributed === false
      && entry.affiliationClaimed === false
      && runtimeDependenciesText.includes(marker),
    `${entry.id} 외부 서비스·상표 참조 경계가 불완전합니다.`
  );
}

const registryEntry = (id: string) => THIRD_PARTY_ATTRIBUTIONS.find(
  (entry) => entry.id === id
);
const whisperRegistry = registryEntry("whisper-cpp");
assert(whisperRegistry?.kind === "runtime-downloaded", "whisper.cpp registry type이 잘못되었습니다.");
assertExactObject(
  whisperRegistry.artifacts[0],
  {
    name: PINNED_WHISPER_CPP.archive.name,
    url: PINNED_WHISPER_CPP.archive.url,
    size: PINNED_WHISPER_CPP.archive.size,
    sha256: PINNED_WHISPER_CPP.archive.sha256
  },
  "whisper.cpp runtime pin"
);

const modelRegistry = registryEntry("openai-whisper-models");
assert(modelRegistry?.kind === "runtime-downloaded", "Whisper model registry type이 잘못되었습니다.");
for (const model of Object.values(PINNED_MODELS)) {
  const registered = modelRegistry.artifacts.find(({ name }) => name === model.name);
  assert(
    registered !== undefined
      && registered.url === model.url
      && registered.size === model.size
      && registered.sha256 === model.sha256,
    `Whisper model runtime pin과 registry가 다릅니다: ${model.id}`
  );
}
assert(
  modelRegistry.artifacts.length === Object.keys(PINNED_MODELS).length,
  "Whisper model registry에 runtime이 사용하지 않는 artifact가 있습니다."
);

const vadRegistry = registryEntry("silero-vad");
assert(vadRegistry?.kind === "runtime-downloaded", "Silero VAD registry type이 잘못되었습니다.");
assertExactObject(vadRegistry.artifacts[0], {
  name: PINNED_VAD_MODEL.name,
  url: PINNED_VAD_MODEL.url,
  size: PINNED_VAD_MODEL.size,
  sha256: PINNED_VAD_MODEL.sha256
}, "Silero VAD runtime pin");

const ytDlpRegistry = registryEntry("yt-dlp");
assert(ytDlpRegistry?.kind === "runtime-downloaded", "yt-dlp registry type이 잘못되었습니다.");
assertExactObject(ytDlpRegistry.artifacts[0], {
  name: PINNED_YT_DLP.name,
  url: PINNED_YT_DLP.url,
  size: PINNED_YT_DLP.size,
  sha256: PINNED_YT_DLP.sha256
}, "yt-dlp runtime pin");
assert(
  ytDlpRegistry.version === PINNED_YT_DLP.version
    && "embeddedComponents" in ytDlpRegistry
    && ytDlpRegistry.embeddedComponents.some((component) => (
      component.name === PINNED_YT_DLP.bundledJavascript.package
      && component.version === PINNED_YT_DLP.bundledJavascript.version
    )),
  "yt-dlp/ejs runtime pin과 registry가 다릅니다."
);

assert(
  webNoticeText.includes("Kirinuki Linux 소스 앱의 `web/` browser assets에 실제로 포함되는")
    && !webNoticeText.includes(PINNED_YT_DLP.sha256)
    && !webNoticeText.includes(PINNED_WHISPER_CPP.archive.sha256)
    && !webNoticeText.includes("ffmpeg -buildconf")
    && !webNoticeText.includes("TypeScript 5.9.3"),
  "web 고지가 runtime/system/development 범위를 포함하고 있습니다."
);
const publicShellNoticeText = publicShellNotice.toString("utf8");
assert(
  publicShellNoticeText.includes("Kirinuki public launch shell notices")
    && publicShellNoticeText.includes("제3자 JavaScript, 글꼴")
    && !publicShellNoticeText.includes("<!-- attribution-id:")
    && !/(?:Mediabunny|AudSeg|Pretendard|Paperlogy|iframe_api|127\.0\.0\.1|localhost)/u.test(
      publicShellNoticeText
    )
    && !publicShellNoticeText.includes(PINNED_YT_DLP.sha256)
    && !publicShellNoticeText.includes(PINNED_WHISPER_CPP.archive.sha256),
  "공개 launch shell 고지가 앱 내부·runtime 제3자 범위를 포함하고 있습니다."
);
assert(
  runtimeNoticeText.includes("법률 자문")
    && runtimeNoticeText.includes("무위험 보증")
    && inventoryText.includes("법률 자문")
    && webChecklistText.includes("법률 자문")
    && webChecklistText.includes("--enable-nonfree")
    && webChecklistText.includes("자동 배포를 **차단**")
    && runtimeDependenciesText.includes("cpp-httplib")
    && runtimeDependenciesText.includes("nlohmann/json")
    && runtimeDependenciesText.includes("stb_vorbis")
    && runtimeDependenciesText.includes("miniaudio")
    && runtimeDependenciesText.includes("ggml"),
  "법적 한계·FFmpeg nonfree gate·whisper-server embedded 의무 문서가 불완전합니다."
);
assert(
  webChecklistText.includes("legal/FIRST_PARTY_RIGHTS_REVIEW.md")
    && firstPartyRightsReviewText.includes("둘 이상의 author identity")
    && firstPartyRightsReviewText.includes("명시적 Unlicense 동의")
    && firstPartyRightsReviewText.includes("모든 기여자의 권리가 확정됐다는 법적 보증")
    && firstPartyRightsReviewText.includes("third-party 라이선스를 Unlicense로 재허가하지"),
  "first-party 기여자 권리·Unlicense 동의 release gate가 불완전합니다."
);
assert(
  commercialUsePolicyText.includes("positive allowlist")
    && commercialUsePolicyText.includes("광고")
    && commercialUsePolicyText.includes("SaaS")
    && commercialUsePolicyText.includes("Commons Clause")
    && commercialUsePolicyText.includes("PolyForm")
    && commercialUsePolicyText.includes("SSPL")
    && commercialUsePolicyText.includes("BUSL")
    && commercialUsePolicyText.includes("Elastic License")
    && commercialUsePolicyText.includes("Prosperity")
    && commercialUsePolicyText.includes("LicenseRef")
    && commercialUsePolicyText.includes("MPL-2.0")
    && commercialUsePolicyText.includes("OFL-1.1")
    && commercialUsePolicyText.includes("광고 SDK")
    && webChecklistText.includes("legal/COMMERCIAL_USE_POLICY.md")
    && inventoryText.includes("legal/COMMERCIAL_USE_POLICY.md"),
  "광고·유료·SaaS 상업 이용 라이선스 정책과 release gate 문서가 불완전합니다."
);
for (const approvedLicense of COMMERCIAL_USE_APPROVED_LICENSE_IDS) {
  assert(
    commercialUsePolicyText.includes(`\`${approvedLicense}\``),
    `상업 이용 정책에 approved license가 없습니다: ${approvedLicense}`
  );
}
assert(
  inventoryText.includes("저장소 전용 Python·CI 도구의 미고정 경계")
    && inventoryText.includes("재현 가능한 배포")
    && inventoryText.includes("인벤토리로 간주하지 않습니다")
    && inventoryText.includes("full commit")
    && inventoryText.includes("SHA와 MIT 대응 소스를 고정")
    && webChecklistText.includes("GitHub Actions full commit SHA 세 개")
    && webChecklistText.includes("full commit SHA")
    && webChecklistText.includes("C/C++ compiler, CMake, CUDA toolkit"),
  "Python/CI/native build tool의 향후 배포 provenance gate가 불완전합니다."
);
assert(
  licensePageText.includes('<main id="license-content">')
    && licensePageText.includes('class="skip-link"')
    && !/<script\b/iu.test(licensePageText),
  "packaged licenses.html의 접근성 또는 정적 페이지 경계가 불완전합니다."
);
assert(
  mediaEngineSource.toString("utf8").includes("Mediabunny 1.51.0 is MPL-2.0 licensed")
    && compiledEditor.toString("utf8").includes("Mediabunny 1.51.0 is MPL-2.0 licensed")
    && compiledEditor.toString("utf8").includes("AudSeg 0.1.0 browser integration")
    && compiledAudSegWorker.toString("utf8").includes("AudSeg 0.1.0 browser integration"),
  "소스/compiled editor·worker의 Mediabunny·AudSeg provenance comment가 없습니다."
);
assert(
  localCaptionStackText.includes("config.noticesSize")
    && localCaptionStackText.includes("config.noticesSha256")
    && localCaptionStackText.includes("config.noticesPath")
    && localCaptionStackText.includes("stackPaths(env).runtimeNoticesPath")
    && localCaptionStackText.includes("requireExecutable: false")
    && localCaptionStackText.includes("noticeInspections.some"),
  "Whisper 시작은 source·VOD·caption runtime 고지의 크기/SHA를 모두 검증해야 합니다."
);
assert(
  /node-version:\s*["']22\.13\.0["']/u.test(typescriptQualityWorkflowText),
  "GitHub TypeScript quality workflow는 프로젝트 최소 Node 22.13.0에서 실행돼야 합니다."
);
assert(
  !/uses:\s*[^\s@]+@v\d+/u.test(typescriptQualityWorkflowText),
  "GitHub Actions workflow에 mutable major tag 참조가 남아 있습니다."
);

console.log(JSON.stringify({
  ok: true,
  projectLicense: "Unlicense",
  npmPackages: Object.keys(packageLock.packages).length - 1,
  runtimeDependencies: packageJson.dependencies,
  buildDependencies: packageJson.devDependencies,
  localCompanionRuntime: [
    "tsx 4.23.1 MIT",
    "esbuild 0.28.1 + platform package MIT"
  ],
  ciOnlyPinnedActions: [
    "actions/checkout v4 MIT",
    "actions/setup-node v4 MIT",
    "browser-actions/setup-chrome v2.1.2 MIT"
  ],
  distributedLicenses: [
    "Mediabunny MPL-2.0",
    "AudSeg MIT",
    "Pretendard OFL-1.1",
    "Paperlogy OFL-1.1"
  ],
  runtimeDownloaded: [
    "whisper.cpp MIT",
    "OpenAI Whisper models MIT",
    "Silero VAD MIT",
    "yt-dlp 2026.07.04 Unlicense + ejs/ISC/MIT"
  ],
  systemProvidedNotRedistributed: [
    "FFmpeg/ffprobe",
    "Node.js/Python",
    "Chromium/ChromeDriver"
  ],
  documentation: [
    "legal/OPEN_SOURCE_INVENTORY.md",
    "legal/RUNTIME_DEPENDENCIES.md",
    "legal/WEB_DEPLOYMENT_CHECKLIST.md",
    "legal/FIRST_PARTY_RIGHTS_REVIEW.md",
    "legal/COMMERCIAL_USE_POLICY.md"
  ]
}, null, 2));
