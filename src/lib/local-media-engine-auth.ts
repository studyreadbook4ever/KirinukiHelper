import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "./local-runtime-origin.js";
import { isLocalMediaEngineVersion } from "./local-media-engine-contract.js";

export const LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL =
  "kirinuki-local-media-engine/health-proof-v2" as const;
export const LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL =
  "kirinuki-local-engine-session-request/v2" as const;
export const LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL =
  "kirinuki-local-engine-session-status/v1" as const;
export const LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA =
  "kirinuki-local-engine-session-status-response/v1" as const;
export const LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA =
  "kirinuki-local-media-engine/device-proof-v1" as const;
export const LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA =
  "kirinuki-local-media-engine/pairing-response-v1" as const;
export const LOCAL_MEDIA_ENGINE_PAIRING_SCHEME = "kirinuki-engine" as const;
export const LOCAL_MEDIA_ENGINE_PAIRING_URL =
  `${LOCAL_MEDIA_ENGINE_PAIRING_SCHEME}://pair` as const;
export const LOCAL_MEDIA_ENGINE_CUT_URL =
  `${LOCAL_MEDIA_ENGINE_PAIRING_SCHEME}://cut` as const;
export const LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL =
  "kirinuki-local-media-engine/pairing-poll-v1" as const;
export const LOCAL_MEDIA_ENGINE_PAIRING_POLL_STATUS_SCHEMA =
  "kirinuki-local-media-engine/pairing-poll-status-v1" as const;
export const LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER =
  "X-Kirinuki-Pairing-State" as const;
export const LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER =
  "X-Kirinuki-Server-Challenge" as const;
export const LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM =
  "ECDSA-P256-SHA256" as const;
export const LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA =
  "kirinuki-local-media-engine/session-encryption-offer-v1" as const;
export const LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_REQUEST_SCHEMA =
  "kirinuki-local-media-engine/encrypted-session-request-v1" as const;
export const LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA =
  "kirinuki-local-media-engine/encrypted-session-response-v1" as const;
export const LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM =
  "ECDH-P256-AES-256-GCM" as const;

const PROOF_TRANSCRIPT_SCHEMA =
  "kirinuki-local-media-engine/proof-transcript-v1";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type LocalMediaEngineProofKind = "health" | "session" | "pairing";

export interface LocalMediaEnginePairingRequest {
  readonly state: string;
  readonly challenge: string;
}

export type LocalMediaEngineLaunchCommand =
  | Readonly<{
    readonly kind: "pair";
    readonly pairingRequest: Readonly<LocalMediaEnginePairingRequest>;
  }>
  | Readonly<{ readonly kind: "cut" }>;

export interface LocalMediaEngineDeviceProof {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA;
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
  readonly keyId: string;
  readonly challenge: string;
  readonly instanceNonce: string;
  readonly signature: string;
}

export interface LocalMediaEnginePairingResponse {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA;
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
  readonly state: string;
  readonly challenge: string;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly engineVersion: string;
  readonly issuedAt: string;
  readonly signature: string;
}

export interface LocalMediaEngineSessionEncryptionOffer {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA;
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM;
  readonly grantId: string;
  readonly serverPublicKey: string;
  readonly expiresAt: string;
}

export interface LocalMediaEngineEncryptedSessionRequest {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_REQUEST_SCHEMA;
  readonly grantId: string;
  readonly clientPublicKey: string;
  readonly iv: string;
  readonly ciphertext: string;
}

export interface LocalMediaEngineEncryptedSessionResponse {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA;
  readonly grantId: string;
  readonly iv: string;
  readonly ciphertext: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const packed = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(packed >>> 18) & 63];
    output += alphabet[(packed >>> 12) & 63];
    if (second !== undefined) {
      output += alphabet[(packed >>> 6) & 63];
    }
    if (third !== undefined) {
      output += alphabet[packed & 63];
    }
  }
  return output;
}

export function decodeBase64Url(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || !BASE64URL_PATTERN.test(value)
  ) {
    return null;
  }
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lookup = new Map([...alphabet].map((character, index) => [character, index]));
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const decoded = lookup.get(character);
    if (decoded === undefined) {
      return null;
    }
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    return null;
  }
  const result = new Uint8Array(bytes);
  return encodeBase64Url(result) === value ? result : null;
}

export function exactBase64UrlBytes(
  value: unknown,
  byteLength: number
): value is string {
  const bytes = decodeBase64Url(value);
  return bytes?.byteLength === byteLength;
}

export function freshLocalMediaEngineChallenge(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function localMediaEngineProofTranscript({
  kind,
  challenge,
  instanceNonce,
  payload,
  requestBinding = ""
}: {
  readonly kind: LocalMediaEngineProofKind;
  readonly challenge: string;
  readonly instanceNonce: string;
  readonly payload: unknown;
  readonly requestBinding?: string;
}): Uint8Array {
  if (
    !["health", "session", "pairing"].includes(kind)
    || !exactBase64UrlBytes(challenge, 32)
    || (
      kind !== "pairing"
      && !exactBase64UrlBytes(instanceNonce, 32)
    )
    || (kind === "pairing" && instanceNonce !== "")
    || typeof requestBinding !== "string"
    || requestBinding.length > 32 * 1024
  ) {
    throw new TypeError("로컬 엔진 proof transcript 값이 올바르지 않습니다.");
  }
  return new TextEncoder().encode(JSON.stringify([
    PROOF_TRANSCRIPT_SCHEMA,
    kind,
    KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    "127.0.0.1:4319",
    challenge,
    instanceNonce,
    requestBinding,
    payload
  ]));
}

export function parseLocalMediaEngineDeviceProof(
  value: unknown
): Readonly<LocalMediaEngineDeviceProof> | null {
  const proof = record(value);
  if (
    !proof
    || Object.keys(proof).sort().join(",")
      !== "algorithm,challenge,instanceNonce,keyId,schema,signature"
    || proof.schema !== LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA
    || proof.algorithm !== LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM
    || !exactBase64UrlBytes(proof.keyId, 32)
    || !exactBase64UrlBytes(proof.challenge, 32)
    || !exactBase64UrlBytes(proof.instanceNonce, 32)
    || !exactBase64UrlBytes(proof.signature, 64)
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId: proof.keyId,
    challenge: proof.challenge,
    instanceNonce: proof.instanceNonce,
    signature: proof.signature
  });
}

export function parseLocalMediaEnginePairingRequest(
  value: unknown
): Readonly<LocalMediaEnginePairingRequest> {
  const raw = String(value ?? "").trim();
  if (
    raw.length === 0
    || raw.length > 2_048
    || /[\u0000-\u001f\u007f]/u.test(raw)
    || !raw.startsWith(`${LOCAL_MEDIA_ENGINE_PAIRING_URL}?`)
  ) {
    throw new TypeError("Kirinuki 엔진 연결 링크가 올바르지 않습니다.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Kirinuki 엔진 연결 링크가 올바르지 않습니다.");
  }
  const entries = [...parsed.searchParams.entries()];
  const keys = entries.map(([key]) => key).sort().join(",");
  const state = parsed.searchParams.get("state");
  const challenge = parsed.searchParams.get("challenge");
  if (
    parsed.protocol !== `${LOCAL_MEDIA_ENGINE_PAIRING_SCHEME}:`
    || parsed.hostname !== "pair"
    || parsed.pathname !== ""
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
    || entries.length !== 3
    || keys !== "challenge,state,v"
    || parsed.searchParams.get("v") !== "1"
    || !exactBase64UrlBytes(state, 32)
    || !exactBase64UrlBytes(challenge, 32)
  ) {
    throw new TypeError("Kirinuki 엔진 연결 링크 필드가 올바르지 않습니다.");
  }
  return Object.freeze({ state, challenge });
}

export function extractLocalMediaEnginePairingRequestFromArgv(
  argv: readonly unknown[]
): Readonly<LocalMediaEnginePairingRequest> | null {
  if (!Array.isArray(argv)) {
    throw new TypeError("Kirinuki 엔진 연결 argv가 배열이 아닙니다.");
  }
  const candidates: string[] = [];
  for (const value of argv) {
    if (typeof value !== "string") {
      throw new TypeError("Kirinuki 엔진 연결 argv에는 문자열만 허용합니다.");
    }
    const argument = value.trim();
    if (new RegExp(`^${LOCAL_MEDIA_ENGINE_PAIRING_SCHEME}:`, "iu").test(argument)) {
      candidates.push(argument);
    }
  }
  if (candidates.length > 1) {
    throw new TypeError("Kirinuki 엔진 연결 링크는 한 번에 하나만 허용합니다.");
  }
  return candidates[0]
    ? parseLocalMediaEnginePairingRequest(candidates[0])
    : null;
}

export function parseLocalMediaEngineLaunchCommand(
  value: unknown
): Readonly<LocalMediaEngineLaunchCommand> {
  const raw = String(value ?? "").trim();
  if (raw === LOCAL_MEDIA_ENGINE_CUT_URL) {
    return Object.freeze({ kind: "cut" });
  }
  return Object.freeze({
    kind: "pair",
    pairingRequest: parseLocalMediaEnginePairingRequest(raw)
  });
}

export function extractLocalMediaEngineLaunchCommandFromArgv(
  argv: readonly unknown[]
): Readonly<LocalMediaEngineLaunchCommand> | null {
  if (!Array.isArray(argv)) {
    throw new TypeError("Kirinuki 엔진 실행 argv가 배열이 아닙니다.");
  }
  const candidates: string[] = [];
  for (const value of argv) {
    if (typeof value !== "string") {
      throw new TypeError("Kirinuki 엔진 실행 argv에는 문자열만 허용합니다.");
    }
    const argument = value.trim();
    if (new RegExp(`^${LOCAL_MEDIA_ENGINE_PAIRING_SCHEME}:`, "iu").test(argument)) {
      candidates.push(argument);
    }
  }
  if (candidates.length > 1) {
    throw new TypeError("Kirinuki 엔진 실행 링크는 한 번에 하나만 허용합니다.");
  }
  return candidates[0]
    ? parseLocalMediaEngineLaunchCommand(candidates[0])
    : null;
}

export function localMediaEnginePairingUrl(
  request: Readonly<LocalMediaEnginePairingRequest>
): string {
  if (
    !exactBase64UrlBytes(request.state, 32)
    || !exactBase64UrlBytes(request.challenge, 32)
  ) {
    throw new TypeError("Kirinuki 엔진 연결 nonce가 올바르지 않습니다.");
  }
  return `${LOCAL_MEDIA_ENGINE_PAIRING_URL}?${new URLSearchParams({
    v: "1",
    state: request.state,
    challenge: request.challenge
  })}`;
}

export function parseLocalMediaEnginePairingResponse(
  value: unknown
): Readonly<LocalMediaEnginePairingResponse> | null {
  const response = record(value);
  if (
    !response
    || Object.keys(response).sort().join(",")
      !== "algorithm,challenge,engineVersion,issuedAt,keyId,publicKeySpki,schema,signature,state"
    || response.schema !== LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA
    || response.algorithm !== LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM
    || !exactBase64UrlBytes(response.state, 32)
    || !exactBase64UrlBytes(response.challenge, 32)
    || !exactBase64UrlBytes(response.keyId, 32)
    || !exactBase64UrlBytes(response.signature, 64)
    || typeof response.publicKeySpki !== "string"
    || (decodeBase64Url(response.publicKeySpki)?.byteLength ?? 0) < 80
    || (decodeBase64Url(response.publicKeySpki)?.byteLength ?? 0) > 160
    || !isLocalMediaEngineVersion(response.engineVersion)
    || typeof response.issuedAt !== "string"
    || !Number.isFinite(Date.parse(response.issuedAt))
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    state: response.state,
    challenge: response.challenge,
    keyId: response.keyId,
    publicKeySpki: response.publicKeySpki,
    engineVersion: response.engineVersion,
    issuedAt: response.issuedAt,
    signature: response.signature
  });
}

export function parseLocalMediaEngineSessionEncryptionOffer(
  value: unknown
): Readonly<LocalMediaEngineSessionEncryptionOffer> | null {
  const offer = record(value);
  if (
    !offer
    || Object.keys(offer).sort().join(",")
      !== "algorithm,expiresAt,grantId,schema,serverPublicKey"
    || offer.schema !== LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA
    || offer.algorithm !== LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM
    || !exactBase64UrlBytes(offer.grantId, 32)
    || !exactBase64UrlBytes(offer.serverPublicKey, 65)
    || typeof offer.expiresAt !== "string"
    || !Number.isFinite(Date.parse(offer.expiresAt))
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
    grantId: offer.grantId,
    serverPublicKey: offer.serverPublicKey,
    expiresAt: offer.expiresAt
  });
}

export function parseLocalMediaEngineEncryptedSessionRequest(
  value: unknown
): Readonly<LocalMediaEngineEncryptedSessionRequest> | null {
  const request = record(value);
  const ciphertextBytes = decodeBase64Url(request?.ciphertext);
  if (
    !request
    || Object.keys(request).sort().join(",")
      !== "ciphertext,clientPublicKey,grantId,iv,schema"
    || request.schema !== LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_REQUEST_SCHEMA
    || !exactBase64UrlBytes(request.grantId, 32)
    || !exactBase64UrlBytes(request.clientPublicKey, 65)
    || !exactBase64UrlBytes(request.iv, 12)
    || typeof request.ciphertext !== "string"
    || !ciphertextBytes
    || ciphertextBytes.byteLength < 17
    || ciphertextBytes.byteLength > 24 * 1024
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_REQUEST_SCHEMA,
    grantId: request.grantId,
    clientPublicKey: request.clientPublicKey,
    iv: request.iv,
    ciphertext: request.ciphertext
  });
}

export function parseLocalMediaEngineEncryptedSessionResponse(
  value: unknown
): Readonly<LocalMediaEngineEncryptedSessionResponse> | null {
  const response = record(value);
  const ciphertextBytes = decodeBase64Url(response?.ciphertext);
  if (
    !response
    || Object.keys(response).sort().join(",")
      !== "ciphertext,grantId,iv,schema"
    || response.schema !== LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA
    || !exactBase64UrlBytes(response.grantId, 32)
    || !exactBase64UrlBytes(response.iv, 12)
    || typeof response.ciphertext !== "string"
    || !ciphertextBytes
    || ciphertextBytes.byteLength < 17
    || ciphertextBytes.byteLength > 32 * 1024
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA,
    grantId: response.grantId,
    iv: response.iv,
    ciphertext: response.ciphertext
  });
}

export function localMediaEngineSessionEncryptionAad({
  responseChallenge,
  grantId,
  clientPublicKey,
  iv
}: {
  readonly responseChallenge: string;
  readonly grantId: string;
  readonly clientPublicKey: string;
  readonly iv: string;
}): Uint8Array {
  if (
    !exactBase64UrlBytes(responseChallenge, 32)
    || !exactBase64UrlBytes(grantId, 32)
    || !exactBase64UrlBytes(clientPublicKey, 65)
    || !exactBase64UrlBytes(iv, 12)
  ) {
    throw new TypeError("로컬 엔진 session encryption AAD가 올바르지 않습니다.");
  }
  return new TextEncoder().encode(JSON.stringify([
    LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_REQUEST_SCHEMA,
    KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    "127.0.0.1:4319",
    responseChallenge,
    grantId,
    clientPublicKey,
    iv
  ]));
}

export function localMediaEngineSessionResponseAad({
  responseChallenge,
  grantId,
  clientPublicKey,
  iv,
  status = 200
}: {
  readonly responseChallenge: string;
  readonly grantId: string;
  readonly clientPublicKey: string;
  readonly iv: string;
  readonly status?: number;
}): Uint8Array {
  if (
    !exactBase64UrlBytes(responseChallenge, 32)
    || !exactBase64UrlBytes(grantId, 32)
    || !exactBase64UrlBytes(clientPublicKey, 65)
    || !exactBase64UrlBytes(iv, 12)
    || status !== 200
  ) {
    throw new TypeError("로컬 엔진 session response AAD가 올바르지 않습니다.");
  }
  return new TextEncoder().encode(JSON.stringify([
    LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA,
    KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    "127.0.0.1:4319",
    "response",
    responseChallenge,
    grantId,
    clientPublicKey,
    "POST",
    "/v1/session",
    LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
    iv,
    status
  ]));
}

export async function encryptLocalMediaEngineSessionRequest({
  offer,
  responseChallenge,
  plaintext
}: {
  readonly offer: Readonly<LocalMediaEngineSessionEncryptionOffer>;
  readonly responseChallenge: string;
  readonly plaintext: string;
}): Promise<Readonly<LocalMediaEngineEncryptedSessionRequest>> {
  return (await prepareLocalMediaEngineSessionRequest({
    offer,
    responseChallenge,
    plaintext
  })).request;
}

export async function deriveLocalMediaEngineSharedKey({
  privateKey,
  peerPublicKey
}: {
  readonly privateKey: CryptoKey;
  readonly peerPublicKey: string;
}): Promise<Uint8Array> {
  const peerBytes = decodeBase64Url(peerPublicKey);
  if (!peerBytes || peerBytes.byteLength !== 65) {
    throw new TypeError("로컬 엔진 ECDH peer 공개키가 올바르지 않습니다.");
  }
  const publicKey = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(peerBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  ));
}

export async function prepareLocalMediaEngineSessionRequest({
  offer,
  responseChallenge,
  plaintext
}: {
  readonly offer: Readonly<LocalMediaEngineSessionEncryptionOffer>;
  readonly responseChallenge: string;
  readonly plaintext: string;
}): Promise<Readonly<{
  request: Readonly<LocalMediaEngineEncryptedSessionRequest>;
  sharedKey: Uint8Array;
}>> {
  const parsedOffer = parseLocalMediaEngineSessionEncryptionOffer(offer);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  if (
    !parsedOffer
    || !exactBase64UrlBytes(responseChallenge, 32)
    || plaintextBytes.byteLength === 0
    || plaintextBytes.byteLength > 16 * 1024
  ) {
    throw new TypeError("암호화할 로컬 엔진 session request가 올바르지 않습니다.");
  }
  const clientKeys = await globalThis.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const sharedKey = await deriveLocalMediaEngineSharedKey({
    privateKey: clientKeys.privateKey,
    peerPublicKey: parsedOffer.serverPublicKey
  });
  const encryptionKey = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(sharedKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const clientPublicKey = encodeBase64Url(new Uint8Array(
    await globalThis.crypto.subtle.exportKey("raw", clientKeys.publicKey)
  ));
  const ivBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(ivBytes);
  const iv = encodeBase64Url(ivBytes);
  const aad = localMediaEngineSessionEncryptionAad({
    responseChallenge,
    grantId: parsedOffer.grantId,
    clientPublicKey,
    iv
  });
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    },
    encryptionKey,
    ownedArrayBuffer(plaintextBytes)
  );
  return Object.freeze({
    request: Object.freeze({
      schema: LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_REQUEST_SCHEMA,
      grantId: parsedOffer.grantId,
      clientPublicKey,
      iv,
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext))
    }),
    sharedKey
  });
}

export async function decryptLocalMediaEngineSessionRequest({
  privateKey,
  request,
  responseChallenge
}: {
  readonly privateKey: CryptoKey;
  readonly request: Readonly<LocalMediaEngineEncryptedSessionRequest>;
  readonly responseChallenge: string;
}): Promise<string> {
  const parsed = parseLocalMediaEngineEncryptedSessionRequest(request);
  const clientPublicBytes = parsed
    ? decodeBase64Url(parsed.clientPublicKey)
    : null;
  const ivBytes = parsed ? decodeBase64Url(parsed.iv) : null;
  const ciphertextBytes = parsed ? decodeBase64Url(parsed.ciphertext) : null;
  if (!parsed || !clientPublicBytes || !ivBytes || !ciphertextBytes) {
    throw new TypeError("암호화된 로컬 엔진 session request가 올바르지 않습니다.");
  }
  const sharedKey = await deriveLocalMediaEngineSharedKey({
    privateKey,
    peerPublicKey: parsed.clientPublicKey
  });
  const decryptionKey = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(sharedKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const aad = localMediaEngineSessionEncryptionAad({
    responseChallenge,
    grantId: parsed.grantId,
    clientPublicKey: parsed.clientPublicKey,
    iv: parsed.iv
  });
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    },
    decryptionKey,
    ownedArrayBuffer(ciphertextBytes)
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export async function encryptLocalMediaEngineSessionResponse({
  sharedKey,
  request,
  responseChallenge,
  plaintext
}: {
  readonly sharedKey: Uint8Array;
  readonly request: Readonly<LocalMediaEngineEncryptedSessionRequest>;
  readonly responseChallenge: string;
  readonly plaintext: string;
}): Promise<Readonly<LocalMediaEngineEncryptedSessionResponse>> {
  const parsedRequest = parseLocalMediaEngineEncryptedSessionRequest(request);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  if (
    !(sharedKey instanceof Uint8Array)
    || sharedKey.byteLength !== 32
    || !parsedRequest
    || !exactBase64UrlBytes(responseChallenge, 32)
    || plaintextBytes.byteLength === 0
    || plaintextBytes.byteLength > 24 * 1024
  ) {
    throw new TypeError("암호화할 로컬 엔진 session response가 올바르지 않습니다.");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(sharedKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ivBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(ivBytes);
  const iv = encodeBase64Url(ivBytes);
  const aad = localMediaEngineSessionResponseAad({
    responseChallenge,
    grantId: parsedRequest.grantId,
    clientPublicKey: parsedRequest.clientPublicKey,
    iv
  });
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    },
    key,
    ownedArrayBuffer(plaintextBytes)
  );
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA,
    grantId: parsedRequest.grantId,
    iv,
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext))
  });
}

export async function decryptLocalMediaEngineSessionResponse({
  sharedKey,
  request,
  responseChallenge,
  response
}: {
  readonly sharedKey: Uint8Array;
  readonly request: Readonly<LocalMediaEngineEncryptedSessionRequest>;
  readonly responseChallenge: string;
  readonly response: unknown;
}): Promise<string> {
  const parsedRequest = parseLocalMediaEngineEncryptedSessionRequest(request);
  const parsedResponse = parseLocalMediaEngineEncryptedSessionResponse(response);
  const ivBytes = parsedResponse ? decodeBase64Url(parsedResponse.iv) : null;
  const ciphertextBytes = parsedResponse
    ? decodeBase64Url(parsedResponse.ciphertext)
    : null;
  if (
    !(sharedKey instanceof Uint8Array)
    || sharedKey.byteLength !== 32
    || !parsedRequest
    || !parsedResponse
    || parsedResponse.grantId !== parsedRequest.grantId
    || !exactBase64UrlBytes(responseChallenge, 32)
    || !ivBytes
    || !ciphertextBytes
  ) {
    throw new TypeError("암호화된 로컬 엔진 session response가 올바르지 않습니다.");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(sharedKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const aad = localMediaEngineSessionResponseAad({
    responseChallenge,
    grantId: parsedRequest.grantId,
    clientPublicKey: parsedRequest.clientPublicKey,
    iv: parsedResponse.iv
  });
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    },
    key,
    ownedArrayBuffer(ciphertextBytes)
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export function pairingResponseUnsignedPayload(
  response: Omit<LocalMediaEnginePairingResponse, "signature">
): Readonly<Omit<LocalMediaEnginePairingResponse, "signature">> {
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    state: response.state,
    challenge: response.challenge,
    keyId: response.keyId,
    publicKeySpki: response.publicKeySpki,
    engineVersion: response.engineVersion,
    issuedAt: response.issuedAt
  });
}

export async function verifyLocalMediaEngineSignature({
  publicKeySpki,
  signature,
  transcript
}: {
  readonly publicKeySpki: string;
  readonly signature: string;
  readonly transcript: Uint8Array;
}): Promise<boolean> {
  const publicKeyBytes = decodeBase64Url(publicKeySpki);
  const signatureBytes = decodeBase64Url(signature);
  if (
    !publicKeyBytes
    || publicKeyBytes.byteLength < 80
    || publicKeyBytes.byteLength > 160
    || signatureBytes?.byteLength !== 64
  ) {
    return false;
  }
  try {
    const publicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      ownedArrayBuffer(publicKeyBytes),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      ownedArrayBuffer(signatureBytes),
      ownedArrayBuffer(transcript)
    );
  } catch {
    return false;
  }
}

export async function localMediaEnginePublicKeyId(
  publicKeySpki: string
): Promise<string | null> {
  const bytes = decodeBase64Url(publicKeySpki);
  if (!bytes || bytes.byteLength < 80 || bytes.byteLength > 160) {
    return null;
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    ownedArrayBuffer(bytes)
  );
  return encodeBase64Url(new Uint8Array(digest));
}
