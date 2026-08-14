import { createHash } from "node:crypto";
import path from "node:path";

export const VOD_CONSUMER_SCOPE_HASH_DOMAIN =
  "kirinuki/vod-consumer-scope/v1";
export const VOD_CONSUMER_SCOPE_DIRECTORY = "consumers";
export const MAX_VOD_CONSUMER_ID_LENGTH = 256;
export const MAX_VOD_CONSUMER_ID_UTF8_BYTES = 1_024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MATERIALIZATION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const PLATFORM_DIRECTORY_PATTERN = /^(?:chzzk|youtube|soop)$/u;

export function normalizeVodConsumerId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("로컬 VOD 캐시 사용 세션 ID가 올바르지 않습니다.");
  }
  const consumerId = value.normalize("NFC").trim();
  if (
    !consumerId
    || consumerId.length > MAX_VOD_CONSUMER_ID_LENGTH
    || Buffer.byteLength(consumerId, "utf8") > MAX_VOD_CONSUMER_ID_UTF8_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/u.test(consumerId)
  ) {
    throw new TypeError("로컬 VOD 캐시 사용 세션 ID가 올바르지 않습니다.");
  }
  return consumerId;
}

export function vodConsumerScopeHash(value: unknown): string {
  const consumerId = normalizeVodConsumerId(value);
  return createHash("sha256")
    .update(VOD_CONSUMER_SCOPE_HASH_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(consumerId, "utf8")
    .digest("hex");
}

export function vodConsumerScopeRootFromHash(
  stateDirectory: string,
  consumerScopeHash: string
): string {
  if (!path.isAbsolute(stateDirectory) || !SHA256_PATTERN.test(consumerScopeHash)) {
    throw new TypeError("로컬 VOD 캐시 scope 경로가 올바르지 않습니다.");
  }
  return path.join(
    path.resolve(stateDirectory),
    VOD_CONSUMER_SCOPE_DIRECTORY,
    consumerScopeHash
  );
}

export function vodConsumerScopeRoot(
  stateDirectory: string,
  consumerId: unknown
): string {
  return vodConsumerScopeRootFromHash(
    stateDirectory,
    vodConsumerScopeHash(consumerId)
  );
}

export function vodConsumerMaterializationDirectory({
  stateDirectory,
  consumerScopeHash,
  platform,
  materializationId
}: {
  stateDirectory: string;
  consumerScopeHash: string;
  platform: string;
  materializationId: string;
}): string {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  if (
    !PLATFORM_DIRECTORY_PATTERN.test(normalizedPlatform)
    || !MATERIALIZATION_ID_PATTERN.test(materializationId)
  ) {
    throw new TypeError("로컬 VOD materialization 경로가 올바르지 않습니다.");
  }
  return path.join(
    vodConsumerScopeRootFromHash(stateDirectory, consumerScopeHash),
    "jobs",
    normalizedPlatform,
    materializationId
  );
}

export function vodConsumerChzzkContentRoot(
  stateDirectory: string,
  consumerScopeHash: string
): string {
  return path.join(
    vodConsumerScopeRootFromHash(stateDirectory, consumerScopeHash),
    "content",
    "chzzk"
  );
}
