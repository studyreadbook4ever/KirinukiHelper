export const LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA =
  "kirinuki-web/local-media-engine-release-v1" as const;
export const LOCAL_MEDIA_ENGINE_RELEASE_UNAVAILABLE_MESSAGE =
  "이 PC용 공식 도우미 설치판을 준비하고 있습니다. 서명과 배포 검증이 끝나면 이 화면의 다운로드 버튼에서 바로 받을 수 있습니다." as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/u;
const RELEASE_OWNER = "studyreadbook4ever";
const RELEASE_REPOSITORY = "KirinukiHelper";

export const LOCAL_MEDIA_ENGINE_RELEASE_FILES = Object.freeze({
  "windows-x64": "Kirinuki-Engine-windows-x64-setup.exe",
  "macos-arm64": "Kirinuki-Engine-macos-arm64.dmg",
  "linux-x64": "Kirinuki-Engine-linux-x64.deb"
} as const);

export const LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE =
  "Kirinuki-Engine-linux-x64-preview.deb" as const;
export const LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_SOURCE_OFFER_FILE =
  "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt" as const;

export type LocalMediaEngineReleaseTarget =
  keyof typeof LOCAL_MEDIA_ENGINE_RELEASE_FILES;

export interface LocalMediaEngineReleaseArtifact {
  readonly bytes: number;
  readonly fileName: string;
  readonly sha256: string;
  readonly url: string;
}

export interface LocalMediaEngineReleaseChannel {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA;
  readonly status: "verified-public-release" | "verified-linux-preview";
  readonly tag: string;
  readonly commit: string;
  readonly aggregateManifestSha256: string;
  readonly sourceOffer?: Readonly<LocalMediaEngineReleaseArtifact>;
  readonly installers: Readonly<Partial<Record<
    LocalMediaEngineReleaseTarget,
    Readonly<LocalMediaEngineReleaseArtifact>
  >>>;
}

declare const __KIRINUKI_LOCAL_MEDIA_ENGINE_RELEASE__: unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function exactReleaseAssetUrl(
  value: unknown,
  tag: string,
  fileName: string
): value is string {
  if (typeof value !== "string" || value.length > 512) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:"
    && parsed.username === ""
    && parsed.password === ""
    && parsed.hostname === "github.com"
    && parsed.port === ""
    && parsed.search === ""
    && parsed.hash === ""
    && parsed.pathname === (
      `/${RELEASE_OWNER}/${RELEASE_REPOSITORY}/releases/download/${tag}/${fileName}`
    );
}

/**
 * A channel is accepted only when the trusted web build embedded exact remote
 * release readback evidence. Runtime GitHub polling is deliberately absent.
 */
export function parseLocalMediaEngineReleaseChannel(
  value: unknown
): Readonly<LocalMediaEngineReleaseChannel> | null {
  const preview = isRecord(value) && value.status === "verified-linux-preview";
  if (
    !isRecord(value)
    || !exactKeys(value, [
      "aggregateManifestSha256",
      "commit",
      "installers",
      "schema",
      "status",
      "tag",
      ...(preview ? ["sourceOffer"] : [])
    ])
    || value.schema !== LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA
    || (value.status !== "verified-public-release"
      && value.status !== "verified-linux-preview")
    || typeof value.tag !== "string"
    || !TAG_PATTERN.test(value.tag)
    || typeof value.commit !== "string"
    || !COMMIT_PATTERN.test(value.commit)
    || typeof value.aggregateManifestSha256 !== "string"
    || !SHA256_PATTERN.test(value.aggregateManifestSha256)
    || !isRecord(value.installers)
  ) {
    return null;
  }
  const expectedTargets: readonly LocalMediaEngineReleaseTarget[] =
    value.status === "verified-linux-preview"
      ? ["linux-x64"]
      : Object.keys(LOCAL_MEDIA_ENGINE_RELEASE_FILES) as LocalMediaEngineReleaseTarget[];
  if (!exactKeys(value.installers, expectedTargets)) {
    return null;
  }
  let sourceOffer: Readonly<LocalMediaEngineReleaseArtifact> | undefined;
  if (preview) {
    const artifact = value.sourceOffer;
    if (
      !isRecord(artifact)
      || !exactKeys(artifact, ["bytes", "fileName", "sha256", "url"])
      || artifact.fileName !== LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_SOURCE_OFFER_FILE
      || !Number.isSafeInteger(artifact.bytes)
      || Number(artifact.bytes) <= 0
      || Number(artifact.bytes) > 1024 * 1024
      || typeof artifact.sha256 !== "string"
      || !SHA256_PATTERN.test(artifact.sha256)
      || !exactReleaseAssetUrl(
        artifact.url,
        value.tag,
        LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_SOURCE_OFFER_FILE
      )
    ) {
      return null;
    }
    sourceOffer = Object.freeze({
      bytes: Number(artifact.bytes),
      fileName: LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_SOURCE_OFFER_FILE,
      sha256: artifact.sha256,
      url: artifact.url
    });
  }
  const installers = {} as Record<
    LocalMediaEngineReleaseTarget,
    Readonly<LocalMediaEngineReleaseArtifact>
  >;
  for (const target of expectedTargets) {
    const expectedFileName = value.status === "verified-linux-preview"
      ? LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE
      : LOCAL_MEDIA_ENGINE_RELEASE_FILES[target];
    const artifact = value.installers[target];
    if (
      !isRecord(artifact)
      || !exactKeys(artifact, ["bytes", "fileName", "sha256", "url"])
      || artifact.fileName !== expectedFileName
      || !Number.isSafeInteger(artifact.bytes)
      || Number(artifact.bytes) <= 0
      || Number(artifact.bytes) > 2 * 1024 * 1024 * 1024
      || typeof artifact.sha256 !== "string"
      || !SHA256_PATTERN.test(artifact.sha256)
      || !exactReleaseAssetUrl(
        artifact.url,
        value.tag,
        expectedFileName
      )
    ) {
      return null;
    }
    installers[target] = Object.freeze({
      bytes: Number(artifact.bytes),
      fileName: expectedFileName,
      sha256: artifact.sha256,
      url: artifact.url
    });
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: value.status,
    tag: value.tag,
    commit: value.commit,
    aggregateManifestSha256: value.aggregateManifestSha256,
    ...(sourceOffer ? { sourceOffer } : {}),
    installers: Object.freeze(installers)
  });
}

const embeddedValue = typeof __KIRINUKI_LOCAL_MEDIA_ENGINE_RELEASE__ === "undefined"
  ? null
  : __KIRINUKI_LOCAL_MEDIA_ENGINE_RELEASE__;

export const LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL =
  embeddedValue === null
    ? null
    : parseLocalMediaEngineReleaseChannel(embeddedValue);
