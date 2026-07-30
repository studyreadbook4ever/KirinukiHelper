import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXTENSION_PACKAGE_FILES } from "./extension-package-files.js";
import {
  PINNED_MODELS,
  PINNED_VAD_MODEL,
  PINNED_WHISPER_CPP
} from "./local-caption-stack-core.js";
import { PAPERLOGY_FONT } from "./paperlogy-font.js";
import { PRETENDARD_FONT } from "./pretendard-font.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const embeddedAudSegRoot = path.join(root, "AudSeg");
const extensionRoot = path.join(root, "extension");
const EXPECTED_NPM_INVENTORY_SHA256 =
  "3271bf18a3b05164b4ea89de11f9a8d1e6908ba11589a970e9cafdabba567118";

interface LockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dev?: boolean;
  optional?: boolean;
  hasInstallScript?: boolean;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
}

interface PackageManifest {
  license?: string;
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
  throw new Error(`삭제한 외부 서비스·재배포 캐시 파일이 다시 생겼습니다: ${relativePath}`);
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
      metadata.dev === true && metadata.hasInstallScript === true,
      "esbuild는 설치 스크립트가 명시된 build-only dependency여야 합니다."
    );
    return;
  }
  if (/^node_modules\/@esbuild\/[^/]+$/u.test(packagePath)) {
    assert(version === "0.28.1", `${packagePath} 버전이 esbuild와 다릅니다.`);
    assert(license === "MIT", `${packagePath} 라이선스가 MIT가 아닙니다.`);
    assert(
      metadata.dev === true && metadata.optional === true,
      `${packagePath}는 optional build-only binary여야 합니다.`
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
    ["node_modules/@types/chrome", {
      version: "0.2.2",
      license: "MIT",
      dev: true
    }],
    ["node_modules/@types/dom-mediacapture-transform", {
      version: "0.1.12",
      license: "MIT"
    }],
    ["node_modules/@types/dom-webcodecs", {
      version: "0.1.13",
      license: "MIT"
    }],
    ["node_modules/@types/filesystem", {
      version: "0.0.36",
      license: "MIT",
      dev: true
    }],
    ["node_modules/@types/filewriter", {
      version: "0.0.33",
      license: "MIT",
      dev: true
    }],
    ["node_modules/@types/har-format", {
      version: "1.2.16",
      license: "MIT",
      dev: true
    }],
    ["node_modules/@types/node", {
      version: "20.19.43",
      license: "MIT",
      dev: true
    }],
    ["node_modules/fsevents", {
      version: "2.3.3",
      license: "MIT",
      dev: true,
      optional: true,
      hasInstallScript: true
    }],
    ["node_modules/tsx", {
      version: "4.23.1",
      license: "MIT",
      dev: true
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
      `${packagePath}의 build-only 분류가 승인 목록과 다릅니다.`
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
  throw new Error(
    `승인되지 않은 npm 패키지입니다: ${packagePath} ${version} (${license || "license 없음"})`
  );
}

const [packageJson, packageLock] = await Promise.all([
  bytes("package.json").then(parseJson<PackageManifest>),
  bytes("package-lock.json").then(parseJson<PackageLock>)
]);
assert(packageJson.license === "MIT", "KirinukiHelper package license는 MIT여야 합니다.");
await Promise.all([
  assertAbsent("scripts/create-synthetic-beta.py"),
  assertAbsent("scripts/solar-caption-gateway.js"),
  assertAbsent("scripts/solar-caption-gateway.ts"),
  assertAbsent("src/caption-agent/solar-gateway-core.js"),
  assertAbsent("src/caption-agent/solar-gateway-core.ts"),
  assertAbsent("extension/knowledge/creator-policies/charon-universe-w.md")
]);
const mediabunnyLock = packageLock.packages?.["node_modules/mediabunny"];

assertExactObject(
  packageJson.dependencies,
  { mediabunny: "1.51.0" },
  "runtime dependency"
);
assertExactObject(
  packageJson.devDependencies,
  {
    "@types/chrome": "0.2.2",
    "@types/node": "20.19.43",
    esbuild: "0.28.1",
    tsx: "4.23.1",
    typescript: "5.9.3"
  },
  "development dependency"
);
assert(
  packageLock.lockfileVersion === 3,
  "package-lock.json lockfileVersion은 3이어야 합니다."
);
assert(
  packageLock.packages?.[""]?.license === "MIT",
  "package-lock root license는 MIT여야 합니다."
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
  extensionNotices,
  runtimeNotices
] = await Promise.all([
  bytes("LICENSE"),
  bytes("LICENSE", extensionRoot),
  bytes("node_modules/mediabunny/LICENSE"),
  bytes("licenses/MEDIABUNNY-MPL-2.0.txt", extensionRoot),
  bytes("LICENSE", embeddedAudSegRoot),
  bytes("licenses/AUDSEG-MIT.txt", extensionRoot),
  bytes("THIRD_PARTY_NOTICES.md", extensionRoot),
  bytes("legal/THIRD_PARTY_NOTICES.md")
]);
assert(
  projectLicense.equals(distributedProjectLicense),
  "KirinukiHelper MIT 원문과 Extension 배포 사본이 다릅니다."
);
assert(
  projectLicense.toString("utf8").startsWith("MIT License\n")
    && projectLicense.toString("utf8").includes(
      "Copyright (c) 2026 studyreadbook4ever"
    ),
  "KirinukiHelper MIT 라이선스 원문 또는 저작권 고지가 올바르지 않습니다."
);

assert(
  mediabunnyInstalledLicense.equals(mediabunnyDistributedLicense),
  "Mediabunny MPL-2.0 원문과 Extension 배포 사본이 다릅니다."
);
assert(
  audSegSourceLicense.equals(audSegDistributedLicense),
  "AudSeg MIT 원문과 Extension 배포 사본이 다릅니다."
);
assert(
  extensionNotices.equals(runtimeNotices),
  "Extension 고지와 로컬 runtime 설치 고지가 다릅니다."
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
    bytes(font.extensionFontPath, extensionRoot),
    bytes(font.sourceLicensePath),
    bytes(font.extensionLicensePath, extensionRoot)
  ]);
  assert(sourceFont.equals(distributedFont), `${font.family || "Pretendard"} 글꼴 사본이 다릅니다.`);
  assert(sourceLicense.equals(distributedLicense), `${font.family || "Pretendard"} OFL 사본이 다릅니다.`);
  assert(sha256(sourceFont) === font.fontSha256, `${font.family || "Pretendard"} 글꼴 SHA-256이 다릅니다.`);
  assert(sha256(sourceLicense) === font.licenseSha256, `${font.family || "Pretendard"} OFL SHA-256이 다릅니다.`);
}

for (const requiredPath of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/AUDSEG-MIT.txt",
  "licenses/MEDIABUNNY-MPL-2.0.txt",
  PRETENDARD_FONT.extensionLicensePath,
  PAPERLOGY_FONT.extensionLicensePath
]) {
  assert(
    EXTENSION_PACKAGE_FILES.includes(requiredPath),
    `Extension 배포 allowlist에 라이선스 파일이 없습니다: ${requiredPath}`
  );
}

assert(
  EXTENSION_PACKAGE_FILES.every((relativePath) => !relativePath.startsWith("knowledge/creator-policies/")),
  "재배포 허가가 확인되지 않은 방송인 정책 본문이 Extension 배포 목록에 있습니다."
);
const creatorPolicyIndex = JSON.parse(
  (await bytes("knowledge/creator-policy-index.json", extensionRoot))
    .toString("utf8")
) as { policies?: unknown[] };
assert(
  Array.isArray(creatorPolicyIndex.policies)
    && creatorPolicyIndex.policies.every((policy) => (
      !policy
      || typeof policy !== "object"
      || !Object.hasOwn(policy, "cache")
    )),
  "방송인 정책 인덱스에는 공식 링크만 허용되며 본문 캐시 메타데이터를 둘 수 없습니다."
);

const notices = extensionNotices.toString("utf8");
const audSegProjectMetadata = (await bytes("AudSeg/pyproject.toml")).toString("utf8");
assert(
  !notices.includes("studyreadbook4ever/myChangGo")
    && !audSegProjectMetadata.includes("studyreadbook4ever/myChangGo"),
  "삭제된 myChangGo 하위 경로를 대응 소스 또는 패키지 메타데이터 위치로 고지하면 안 됩니다."
);
assert(
  audSegProjectMetadata.includes(
    'Repository = "https://github.com/studyreadbook4ever/KirinukiHelper/tree/main/AudSeg"'
  ),
  "AudSeg 패키지 메타데이터는 standalone KirinukiHelper 대응 소스 위치를 가리켜야 합니다."
);
for (const requiredNotice of [
  "Mediabunny 1.51.0",
  "Mozilla Public License 2.0",
  mediabunnyLock.resolved,
  mediabunnyLock.integrity,
  "AudSeg 0.1.0",
  "License: MIT",
  "Pretendard 1.3.9",
  "SIL Open Font License 1.1",
  "Paperlogy 1.001",
  "TypeScript 5.9.3",
  "Apache License 2.0",
  "tsx 4.23.1",
  "esbuild 0.28.1",
  "https://github.com/studyreadbook4ever/KirinukiHelper",
  PINNED_WHISPER_CPP.commit,
  PINNED_WHISPER_CPP.archive.sha256,
  PINNED_VAD_MODEL.sha256,
  "https://github.com/openai/whisper/blob/main/LICENSE",
  "https://github.com/snakers4/silero-vad"
]) {
  assert(notices.includes(requiredNotice), `Third-party 고지에 필수 근거가 없습니다: ${requiredNotice}`);
}
for (const model of Object.values(PINNED_MODELS)) {
  assert(
    notices.includes(model.name) && notices.includes(model.sha256),
    `Third-party 고지에 Whisper 모델 근거가 없습니다: ${model.id}`
  );
}

console.log(JSON.stringify({
  ok: true,
  projectLicense: "MIT",
  npmPackages: Object.keys(packageLock.packages).length - 1,
  runtimeDependencies: packageJson.dependencies,
  buildDependencies: packageJson.devDependencies,
  distributedLicenses: [
    "Mediabunny MPL-2.0",
    "AudSeg MIT",
    "Pretendard OFL-1.1",
    "Paperlogy OFL-1.1"
  ],
  runtimeDownloaded: [
    "whisper.cpp MIT",
    "OpenAI Whisper models MIT",
    "Silero VAD MIT"
  ]
}, null, 2));
