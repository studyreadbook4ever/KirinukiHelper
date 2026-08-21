import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "./local-runtime-origin.js";
import { exactBase64UrlBytes } from "./local-media-engine-auth.js";

export const LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA =
  "kirinuki-local-media-engine/transport-request-v1" as const;
export const LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA =
  "kirinuki-local-media-engine/transport-response-v1" as const;
export const LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER =
  "X-Kirinuki-Transport" as const;
export const LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER =
  "X-Kirinuki-Transport-Counter" as const;

export interface LocalMediaEngineTransportRequest {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA;
  readonly transportId: string;
  readonly counter: number;
  readonly iv: string;
  readonly ciphertext: string;
}

export interface LocalMediaEngineTransportResponse {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA;
  readonly transportId: string;
  readonly counter: number;
  readonly iv: string;
  readonly ciphertext: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function possibleCiphertext(value: unknown, maximumCharacters: number): value is string {
  return typeof value === "string"
    && value.length >= 23
    && value.length <= maximumCharacters
    && /^[A-Za-z0-9_-]+$/u.test(value);
}

export function parseLocalMediaEngineTransportRequest(
  value: unknown,
  maximumCiphertextCharacters = 180 * 1024 * 1024
): Readonly<LocalMediaEngineTransportRequest> | null {
  const request = record(value);
  if (
    !request
    || Object.keys(request).sort().join(",")
      !== "ciphertext,counter,iv,schema,transportId"
    || request.schema !== LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA
    || !exactBase64UrlBytes(request.transportId, 32)
    || !Number.isSafeInteger(request.counter)
    || Number(request.counter) < 1
    || !exactBase64UrlBytes(request.iv, 12)
    || !possibleCiphertext(request.ciphertext, maximumCiphertextCharacters)
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA,
    transportId: request.transportId,
    counter: Number(request.counter),
    iv: request.iv,
    ciphertext: request.ciphertext
  });
}

export function parseLocalMediaEngineTransportResponse(
  value: unknown,
  maximumCiphertextCharacters = 180 * 1024 * 1024
): Readonly<LocalMediaEngineTransportResponse> | null {
  const response = record(value);
  if (
    !response
    || Object.keys(response).sort().join(",")
      !== "ciphertext,counter,iv,schema,transportId"
    || response.schema !== LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA
    || !exactBase64UrlBytes(response.transportId, 32)
    || !Number.isSafeInteger(response.counter)
    || Number(response.counter) < 1
    || !exactBase64UrlBytes(response.iv, 12)
    || !possibleCiphertext(response.ciphertext, maximumCiphertextCharacters)
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
    transportId: response.transportId,
    counter: Number(response.counter),
    iv: response.iv,
    ciphertext: response.ciphertext
  });
}

export function localMediaEngineTransportAad({
  direction,
  transportId,
  counter,
  method,
  path,
  protocol,
  clientNonce,
  iv,
  status = 0
}: {
  readonly direction: "request" | "response";
  readonly transportId: string;
  readonly counter: number;
  readonly method: string;
  readonly path: string;
  readonly protocol: string;
  readonly clientNonce: string;
  readonly iv: string;
  readonly status?: number;
}): Uint8Array {
  if (
    !exactBase64UrlBytes(transportId, 32)
    || !Number.isSafeInteger(counter)
    || counter < 1
    || !["GET", "POST", "DELETE"].includes(method)
    || !path.startsWith("/v1/")
    || path.length > 1_024
    || !protocol
    || protocol.length > 200
    || !exactBase64UrlBytes(clientNonce, 32)
    || !exactBase64UrlBytes(iv, 12)
    || !Number.isInteger(status)
    || status < 0
    || status > 599
    || (direction === "request" && status !== 0)
  ) {
    throw new TypeError("로컬 엔진 transport AAD가 올바르지 않습니다.");
  }
  return new TextEncoder().encode(JSON.stringify([
    direction === "request"
      ? LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA
      : LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
    KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    "127.0.0.1:4319",
    direction,
    transportId,
    counter,
    method,
    path,
    protocol,
    clientNonce,
    iv,
    status
  ]));
}
