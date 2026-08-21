import {
  LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA,
  localMediaEngineTransportAad,
  parseLocalMediaEngineTransportResponse
} from "../lib/local-media-engine-transport.js";
import { exactBase64UrlBytes } from "../lib/local-media-engine-auth.js";
import {
  localMediaEngineLoopbackRequestInit
} from "../lib/local-media-engine-contract.js";

interface ActiveLocalMediaEngineTransport {
  readonly transportId: string;
  readonly clientNonce: string;
  readonly key: CryptoKey;
  nextCounter: number;
}

let activeTransport: ActiveLocalMediaEngineTransport | null = null;

export class LocalMediaEngineTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalMediaEngineTransportError";
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function encodeBase64UrlFast(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function decodeBase64UrlFast(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("로컬 엔진 transport ciphertext가 base64url이 아닙니다.");
  }
  const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = (4 - (standard.length % 4)) % 4;
  const binary = atob(`${standard}${"=".repeat(padding)}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function establishLocalMediaEngineTransport({
  transportId,
  clientNonce,
  sharedKey
}: {
  readonly transportId: string;
  readonly clientNonce: string;
  readonly sharedKey: Uint8Array;
}): Promise<void> {
  if (
    !exactBase64UrlBytes(transportId, 32)
    || !exactBase64UrlBytes(clientNonce, 32)
    || !(sharedKey instanceof Uint8Array)
    || sharedKey.byteLength !== 32
  ) {
    throw new TypeError("로컬 엔진 encrypted transport identity가 올바르지 않습니다.");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(sharedKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  activeTransport = {
    transportId,
    clientNonce,
    key,
    nextCounter: 1
  };
}

export function forgetLocalMediaEngineTransport(): void {
  activeTransport = null;
}

export function hasLocalMediaEngineTransport(): boolean {
  return activeTransport !== null;
}

async function encryptedLocalMediaEngineTransportFetch(
  input: URL | RequestInfo,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const transport = activeTransport;
  if (!transport) {
    throw new Error("로컬 엔진 encrypted transport가 아직 설정되지 않았습니다.");
  }
  const url = new URL(String(input));
  if (url.origin !== "http://127.0.0.1:4319") {
    throw new Error("로컬 엔진 encrypted transport는 고정된 loopback origin만 허용합니다.");
  }
  const method = String(init.method || "GET").toUpperCase();
  if (!["POST", "DELETE"].includes(method)) {
    throw new Error(
      "로컬 엔진 encrypted control transport는 POST 또는 DELETE만 지원합니다."
    );
  }
  const headers = new Headers(init.headers);
  const protocol = headers.get("X-Kirinuki-Protocol") || "";
  const clientNonce = headers.get("X-Kirinuki-Client-Nonce") || "";
  if (clientNonce !== transport.clientNonce) {
    throw new Error("로컬 엔진 encrypted transport의 문서 nonce가 다릅니다.");
  }
  const authorization = headers.get("Authorization") || "";
  const tokenMatch = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);
  if (!tokenMatch) {
    throw new Error("로컬 엔진 encrypted transport에 memory capability가 없습니다.");
  }
  const mediaAccess = headers.get("X-Kirinuki-Media-Access");
  const bodyText = init.body === undefined || init.body === null
    ? null
    : typeof init.body === "string"
      ? init.body
      : (() => {
        throw new TypeError("로컬 엔진 encrypted transport body는 JSON 문자열이어야 합니다.");
      })();
  const counter = transport.nextCounter;
  transport.nextCounter += 1;
  if (!Number.isSafeInteger(transport.nextCounter)) {
    forgetLocalMediaEngineTransport();
    throw new Error("로컬 엔진 encrypted transport counter가 소진됐습니다.");
  }
  const plaintext = new TextEncoder().encode(JSON.stringify({
    token: tokenMatch[1],
    mediaAccess,
    bodyText
  }));
  const ivBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(ivBytes);
  const iv = encodeBase64UrlFast(ivBytes);
  const path = `${url.pathname}${url.search}`;
  const aad = localMediaEngineTransportAad({
    direction: "request",
    transportId: transport.transportId,
    counter,
    method,
    path,
    protocol,
    clientNonce,
    iv
  });
  const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    },
    transport.key,
    ownedArrayBuffer(plaintext)
  ));
  headers.delete("Authorization");
  headers.delete("X-Kirinuki-Media-Access");
  headers.set("Content-Type", "application/json");
  headers.set(LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER, transport.transportId);
  headers.set(LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER, String(counter));
  const response = await fetchImpl(url, localMediaEngineLoopbackRequestInit({
    ...init,
    method,
    headers,
    body: JSON.stringify({
      schema: LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA,
      transportId: transport.transportId,
      counter,
      iv,
      ciphertext: encodeBase64UrlFast(ciphertext)
    })
  }));
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024 * 1024) {
    throw new Error("로컬 엔진 encrypted response가 허용 크기를 넘었습니다.");
  }
  const encryptedText = await response.text();
  if (encryptedText.length > 16 * 1024 * 1024) {
    throw new Error("로컬 엔진 encrypted response가 허용 크기를 넘었습니다.");
  }
  let encryptedValue: unknown;
  try {
    encryptedValue = JSON.parse(encryptedText);
  } catch {
    throw new Error("로컬 엔진 encrypted response가 JSON이 아닙니다.");
  }
  const encrypted = parseLocalMediaEngineTransportResponse(
    encryptedValue,
    16 * 1024 * 1024
  );
  if (
    !encrypted
    || encrypted.transportId !== transport.transportId
    || encrypted.counter !== counter
  ) {
    throw new Error("로컬 엔진 encrypted response identity가 요청과 다릅니다.");
  }
  const responseIv = decodeBase64UrlFast(encrypted.iv);
  const responseAad = localMediaEngineTransportAad({
    direction: "response",
    transportId: transport.transportId,
    counter,
    method,
    path,
    protocol,
    clientNonce,
    iv: encrypted.iv,
    status: response.status
  });
  let decrypted: ArrayBuffer;
  try {
    decrypted = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedArrayBuffer(responseIv),
        additionalData: ownedArrayBuffer(responseAad),
        tagLength: 128
      },
      transport.key,
      ownedArrayBuffer(decodeBase64UrlFast(encrypted.ciphertext))
    );
  } catch {
    throw new Error("로컬 엔진 encrypted response 인증에 실패했습니다.");
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.delete("content-length");
  return new Response(decrypted, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

export async function localMediaEngineTransportFetch(
  input: URL | RequestInfo,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  try {
    return await encryptedLocalMediaEngineTransportFetch(input, init, fetchImpl);
  } catch (error) {
    if (error instanceof LocalMediaEngineTransportError) {
      throw error;
    }
    throw new LocalMediaEngineTransportError(
      error instanceof Error
        ? error.message
        : "로컬 엔진 encrypted transport가 실패했습니다.",
      { cause: error }
    );
  }
}
