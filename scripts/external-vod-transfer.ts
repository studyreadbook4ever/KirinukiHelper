import { isIP } from "node:net";

export type ExternalVodTransferPlatform = "CHZZK" | "YOUTUBE" | "SOOP";

export const MAX_EXTERNAL_VOD_TRANSFER_REDIRECTS = 5;
export const MAX_EXTERNAL_VOD_PLAYLIST_BYTES = 4 * 1024 * 1024;
export const MAX_EXTERNAL_VOD_RUNTIME_URL_LENGTH = 16 * 1024;

const SAFE_REQUEST_HEADER_NAMES = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "sec-fetch-mode",
  "user-agent"
]);

const PLATFORM_HOST_SUFFIXES: Readonly<Record<
  ExternalVodTransferPlatform,
  readonly string[]
>> = Object.freeze({
  CHZZK: Object.freeze([
    "akamaized.net",
    "naver.com",
    "navercdn.com",
    "pstatic.net"
  ]),
  YOUTUBE: Object.freeze([
    "googlevideo.com",
    "youtube.com",
    "youtube-nocookie.com",
    "ytimg.com"
  ]),
  SOOP: Object.freeze([
    "afreecatv.com",
    "afreecatv.co.kr",
    "sooplive.com",
    "sooplive.co.kr"
  ])
});

const VOLATILE_PATH_SEGMENT = (
  /(?:^|[~_-])(?:hdntl|hdnts|token|auth|signature|sig|hmac|policy|expires?|key-pair-id)=/iu
);

export class ExternalVodTransferError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodTransferError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodTransferError(message, code);
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("외부 VOD 전송이 취소되었습니다.", "CANCELLED");
  }
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/u, "");
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function assertExternalVodTransferUrl(
  platform: ExternalVodTransferPlatform,
  value: URL | string
): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    fail("외부 VOD 미디어 주소가 올바르지 않습니다.", "UNSAFE_TRANSFER_URL");
  }
  const hostname = normalizedHost(url.hostname);
  const allowedSuffixes = PLATFORM_HOST_SUFFIXES[platform];
  if (
    url.href.length > MAX_EXTERNAL_VOD_RUNTIME_URL_LENGTH
    || url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.hash
    || !hostname
    || isIP(hostname) !== 0
    || !allowedSuffixes.some((suffix) => hostMatchesSuffix(hostname, suffix))
  ) {
    fail(
      `${platform} VOD가 허용되지 않은 미디어 호스트를 가리켰습니다.`,
      "UNSAFE_TRANSFER_URL"
    );
  }
  return url;
}

/**
 * Produces a stable runtime-only locator without query credentials or signed
 * path components. Receipts store only a digest of this value.
 */
export function secretFreeExternalVodUrlIdentity(value: URL | string): string {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    fail("외부 VOD 미디어 주소가 올바르지 않습니다.", "UNSAFE_TRANSFER_URL");
  }
  const segments = url.pathname.split("/").map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Preserve malformed percent bytes as data. URL validation still owns
      // transport safety, while this function never emits a runtime URL.
    }
    return VOLATILE_PATH_SEGMENT.test(decoded)
      ? ":signed-path-component:"
      : segment;
  });
  return `${url.protocol}//${normalizedHost(url.hostname)}${segments.join("/")}`;
}

export function safeExternalVodRequestHeaders(
  value: unknown
): Readonly<Record<string, string>> {
  if (value === undefined || value === null) {
    return Object.freeze({ "accept-encoding": "identity" });
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    fail("외부 VOD 요청 헤더가 올바르지 않습니다.", "UNSAFE_TRANSFER_HEADERS");
  }
  const normalized: Record<string, string> = {
    "accept-encoding": "identity"
  };
  for (const [rawName, rawValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    const name = rawName.trim().toLowerCase();
    if (!SAFE_REQUEST_HEADER_NAMES.has(name)) {
      continue;
    }
    if (
      typeof rawValue !== "string"
      || rawValue.length === 0
      || rawValue.length > 4_096
      || /[\0\r\n]/u.test(rawValue)
    ) {
      fail("외부 VOD 요청 헤더가 올바르지 않습니다.", "UNSAFE_TRANSFER_HEADERS");
    }
    normalized[name] = rawValue;
  }
  return Object.freeze(normalized);
}

function redirectStatus(status: number): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}

function responseUrl(response: Response, fallback: URL): URL {
  if (!response.url) {
    return new URL(fallback.href);
  }
  try {
    return new URL(response.url);
  } catch {
    fail("외부 VOD 응답 주소가 올바르지 않습니다.", "UNSAFE_TRANSFER_URL");
  }
}

async function fetchExternalVodResponse({
  platform,
  url: initialValue,
  headers,
  fetchImpl,
  signal
}: {
  platform: ExternalVodTransferPlatform;
  url: URL | string;
  headers: Readonly<Record<string, string>>;
  fetchImpl: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = assertExternalVodTransferUrl(platform, initialValue);
  for (
    let redirects = 0;
    redirects <= MAX_EXTERNAL_VOD_TRANSFER_REDIRECTS;
    redirects += 1
  ) {
    abortIfRequested(signal);
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        ...(signal ? { signal } : {})
      });
    } catch {
      abortIfRequested(signal);
      fail("외부 VOD 공개 미디어 요청에 실패했습니다.", "TRANSFER_FAILED");
    }
    const observedUrl = assertExternalVodTransferUrl(
      platform,
      responseUrl(response, currentUrl)
    );
    if (!redirectStatus(response.status)) {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        fail("외부 VOD 공개 미디어 응답이 실패했습니다.", "TRANSFER_FAILED");
      }
      const contentEncoding = response.headers.get("content-encoding");
      if (
        contentEncoding
        && contentEncoding.trim().toLowerCase() !== "identity"
      ) {
        await response.body?.cancel().catch(() => undefined);
        fail("외부 VOD 미디어가 요청하지 않은 압축으로 응답했습니다.", "UNSAFE_TRANSFER_ENCODING");
      }
      return { response, finalUrl: observedUrl };
    }
    await response.body?.cancel().catch(() => undefined);
    if (redirects === MAX_EXTERNAL_VOD_TRANSFER_REDIRECTS) {
      fail("외부 VOD 미디어 이동 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
    }
    const location = response.headers.get("location");
    if (!location) {
      fail("외부 VOD 미디어 이동 주소가 없습니다.", "INVALID_REDIRECT");
    }
    try {
      currentUrl = assertExternalVodTransferUrl(
        platform,
        new URL(location, observedUrl)
      );
    } catch (error) {
      if (error instanceof ExternalVodTransferError) {
        throw error;
      }
      fail("외부 VOD 미디어 이동 주소가 올바르지 않습니다.", "INVALID_REDIRECT");
    }
  }
  fail("외부 VOD 미디어 이동 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
}

async function readResponseBytesLimited(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    fail("외부 VOD 응답 크기 상한이 올바르지 않습니다.", "INVALID_TRANSFER_LIMIT");
  }
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength < 0
      || declaredLength > maximumBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      fail("외부 VOD 응답이 크기 안전 상한을 넘습니다.", "TRANSFER_TOO_LARGE");
    }
  }
  if (!response.body) {
    fail("외부 VOD 응답 본문이 없습니다.", "TRANSFER_FAILED");
  }
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      abortIfRequested(signal);
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0) {
        continue;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        fail("외부 VOD 응답이 크기 안전 상한을 넘습니다.", "TRANSFER_TOO_LARGE");
      }
      chunks.push(Uint8Array.from(chunk.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (totalBytes <= 0) {
    fail("외부 VOD 응답 본문이 비었습니다.", "TRANSFER_FAILED");
  }
  return Uint8Array.from(Buffer.concat(
    chunks.map((chunk) => Buffer.from(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength
    )),
    totalBytes
  ));
}

export interface ExternalVodFetchedBytes {
  bytes: Uint8Array;
  finalUrl: string;
  finalSemanticUri: string;
}

export async function fetchExternalVodBytes({
  platform,
  url,
  requestHeaders,
  maximumBytes,
  fetchImpl = globalThis.fetch,
  signal
}: {
  platform: ExternalVodTransferPlatform;
  url: URL | string;
  requestHeaders?: unknown;
  maximumBytes: number;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<ExternalVodFetchedBytes> {
  if (typeof fetchImpl !== "function") {
    fail("외부 VOD 전송 기능을 사용할 수 없습니다.", "TRANSFER_UNAVAILABLE");
  }
  const { response, finalUrl } = await fetchExternalVodResponse({
    platform,
    url,
    headers: safeExternalVodRequestHeaders(requestHeaders),
    fetchImpl,
    ...(signal ? { signal } : {})
  });
  return {
    bytes: await readResponseBytesLimited(response, maximumBytes, signal),
    finalUrl: finalUrl.href,
    finalSemanticUri: secretFreeExternalVodUrlIdentity(finalUrl)
  };
}

export async function fetchExternalVodPlaylist({
  platform,
  url,
  requestHeaders,
  fetchImpl = globalThis.fetch,
  signal
}: {
  platform: ExternalVodTransferPlatform;
  url: URL | string;
  requestHeaders?: unknown;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<{
  text: string;
  finalUrl: string;
  finalSemanticUri: string;
}> {
  const fetched = await fetchExternalVodBytes({
    platform,
    url,
    requestHeaders,
    maximumBytes: MAX_EXTERNAL_VOD_PLAYLIST_BYTES,
    fetchImpl,
    ...(signal ? { signal } : {})
  });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(fetched.bytes);
  } catch {
    fail("HLS 재생목록이 올바른 UTF-8이 아닙니다.", "INVALID_PLAYLIST_ENCODING");
  }
  return {
    text,
    finalUrl: fetched.finalUrl,
    finalSemanticUri: fetched.finalSemanticUri
  };
}
