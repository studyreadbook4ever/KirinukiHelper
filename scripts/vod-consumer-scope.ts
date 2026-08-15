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
const BASE32HEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv";

function lowercaseBase32Hex(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  let accumulator = 0;
  let availableBits = 0;
  let encoded = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    availableBits += 8;
    while (availableBits >= 5) {
      availableBits -= 5;
      encoded += BASE32HEX_ALPHABET[(accumulator >>> availableBits) & 31];
      accumulator &= availableBits === 0 ? 0 : (1 << availableBits) - 1;
    }
  }
  if (availableBits > 0) {
    encoded += BASE32HEX_ALPHABET[(accumulator << (5 - availableBits)) & 31];
  }
  return encoded;
}

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

/**
 * Keeps all 256 digest bits while avoiding avoidable MAX_PATH pressure on
 * Windows. Lowercase base32hex is deliberately case-fold-safe on default
 * NTFS; mixed-case base64url would permit distinct digests to collide there.
 * The logical identity remains canonical lowercase hex in receipts/capabilities.
 */
export function vodConsumerScopePathSegment(
  consumerScopeHash: string,
  platform: NodeJS.Platform | string = process.platform
): string {
  if (!SHA256_PATTERN.test(consumerScopeHash)) {
    throw new TypeError("로컬 VOD 캐시 scope hash가 올바르지 않습니다.");
  }
  return platform === "win32"
    ? lowercaseBase32Hex(consumerScopeHash)
    : consumerScopeHash;
}

export function vodMaterializationPathSegment(
  materializationId: string,
  platform: NodeJS.Platform | string = process.platform
): string {
  if (!MATERIALIZATION_ID_PATTERN.test(materializationId)) {
    throw new TypeError("로컬 VOD materialization ID가 올바르지 않습니다.");
  }
  return platform === "win32"
    ? lowercaseBase32Hex(materializationId)
    : materializationId;
}

export function vodConsumerScopeRootFromHash(
  stateDirectory: string,
  consumerScopeHash: string,
  platform: NodeJS.Platform | string = process.platform
): string {
  if (!path.isAbsolute(stateDirectory) || !SHA256_PATTERN.test(consumerScopeHash)) {
    throw new TypeError("로컬 VOD 캐시 scope 경로가 올바르지 않습니다.");
  }
  return path.join(
    path.resolve(stateDirectory),
    platform === "win32" ? "c" : VOD_CONSUMER_SCOPE_DIRECTORY,
    vodConsumerScopePathSegment(consumerScopeHash, platform)
  );
}

export function vodConsumerScopeRoot(
  stateDirectory: string,
  consumerId: unknown,
  platform: NodeJS.Platform | string = process.platform
): string {
  return vodConsumerScopeRootFromHash(
    stateDirectory,
    vodConsumerScopeHash(consumerId),
    platform
  );
}

export function vodConsumerMaterializationDirectory({
  stateDirectory,
  consumerScopeHash,
  platform,
  materializationId,
  runtimePlatform = process.platform
}: {
  stateDirectory: string;
  consumerScopeHash: string;
  platform: string;
  materializationId: string;
  runtimePlatform?: NodeJS.Platform | string;
}): string {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  if (
    !PLATFORM_DIRECTORY_PATTERN.test(normalizedPlatform)
    || !MATERIALIZATION_ID_PATTERN.test(materializationId)
  ) {
    throw new TypeError("로컬 VOD materialization 경로가 올바르지 않습니다.");
  }
  const platformDirectory = runtimePlatform === "win32"
    ? normalizedPlatform === "chzzk"
      ? "c"
      : normalizedPlatform === "youtube"
        ? "y"
        : "s"
    : normalizedPlatform;
  return path.join(
    vodConsumerScopeRootFromHash(
      stateDirectory,
      consumerScopeHash,
      runtimePlatform
    ),
    runtimePlatform === "win32" ? "j" : "jobs",
    platformDirectory,
    vodMaterializationPathSegment(materializationId, runtimePlatform)
  );
}

export function vodConsumerChzzkContentRoot(
  stateDirectory: string,
  consumerScopeHash: string,
  runtimePlatform: NodeJS.Platform | string = process.platform
): string {
  return path.join(
    vodConsumerScopeRootFromHash(
      stateDirectory,
      consumerScopeHash,
      runtimePlatform
    ),
    runtimePlatform === "win32" ? "d" : "content",
    runtimePlatform === "win32" ? "c" : "chzzk"
  );
}
