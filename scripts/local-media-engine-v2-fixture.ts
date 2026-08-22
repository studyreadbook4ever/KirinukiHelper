import { randomBytes, webcrypto } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
  LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
  LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA,
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  decodeBase64Url,
  decryptLocalMediaEngineSessionRequest,
  deriveLocalMediaEngineSharedKey,
  encodeBase64Url,
  encryptLocalMediaEngineSessionResponse,
  exactBase64UrlBytes,
  localMediaEngineProofTranscript,
  localMediaEnginePublicKeyId,
  pairingResponseUnsignedPayload,
  parseLocalMediaEngineEncryptedSessionRequest
} from "../src/lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
  LOCAL_MEDIA_ENGINE_PRODUCT,
  LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA
} from "../src/lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
  localMediaEngineTransportAad,
  parseLocalMediaEngineTransportRequest
} from "../src/lib/local-media-engine-transport.js";

const LOCAL_ENGINE_SESSION_REQUEST_SCHEMA =
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL;
const LOCAL_ENGINE_SESSION_RESPONSE_SCHEMA =
  "kirinuki-local-engine-session/v1" as const;
const MAXIMUM_REQUEST_BYTES = 512 * 1024;

export interface LocalMediaEngineV2FixtureRecord {
  readonly authorization: string;
  readonly clientNonce: string;
  readonly cookie: string;
  readonly encrypted: boolean;
  readonly method: string;
  readonly origin: string;
  readonly path: string;
  readonly protocol: string;
  readonly requestedPrivateNetwork: string;
  readonly transportCounter: string;
  readonly transportId: string;
}

export interface LocalMediaEngineV2Session {
  readonly actions: readonly string[];
  readonly clientNonce: string;
  readonly expiresAt: string;
  readonly projectId: string;
  readonly sourceUrl?: string;
  readonly token: string;
  readonly transportId: string;
}

export interface LocalMediaEngineV2ControlRequest {
  readonly body: unknown;
  readonly clientNonce: string;
  readonly mediaAccess: string | null;
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly protocol: string;
  readonly session: Readonly<LocalMediaEngineV2Session>;
  readonly token: string;
}

export interface LocalMediaEngineV2JsonResponse {
  readonly payload: unknown;
  readonly status?: number;
  readonly statusText?: string;
}

export interface LocalMediaEngineV2MediaRequest {
  readonly method: "GET" | "HEAD";
  readonly path: string;
  readonly request: IncomingMessage;
  readonly response: ServerResponse<IncomingMessage>;
}

export interface LocalMediaEngineV2FixtureOptions {
  readonly allowedOrigin: string;
  readonly errors?: string[];
  readonly originBinding: "exact-local-studio" | "exact-public-studio";
  readonly onControlRequest: (
    request: Readonly<LocalMediaEngineV2ControlRequest>
  ) => Promise<Readonly<LocalMediaEngineV2JsonResponse>>
    | Readonly<LocalMediaEngineV2JsonResponse>;
  readonly onMediaRequest?: (
    request: Readonly<LocalMediaEngineV2MediaRequest>
  ) => Promise<boolean> | boolean;
  readonly records?: LocalMediaEngineV2FixtureRecord[];
}

export interface LocalMediaEngineV2Fixture {
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly sessions: readonly Readonly<LocalMediaEngineV2Session>[];
  readonly listen: () => Promise<void>;
  readonly close: () => Promise<void>;
}

interface SessionGrant {
  readonly expiresAtMs: number;
  readonly privateKey: CryptoKey;
}

interface TransportState {
  readonly clientNonce: string;
  readonly key: Uint8Array;
  readonly session: Readonly<LocalMediaEngineV2Session>;
  readonly seenCounters: Set<number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function exactHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? "" : String(value || "");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > MAXIMUM_REQUEST_BYTES) {
      throw new Error("v2 fixture 요청 본문이 허용 크기를 넘었습니다.");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "null") as unknown;
}

function corsHeaders(origin: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "DELETE, GET, HEAD, OPTIONS, POST",
    "Access-Control-Allow-Headers": [
      "Authorization",
      "Content-Type",
      "Range",
      "X-Kirinuki-Client-Nonce",
      "X-Kirinuki-Media-Access",
      "X-Kirinuki-Pairing-State",
      "X-Kirinuki-Protocol",
      "X-Kirinuki-Server-Challenge",
      "X-Kirinuki-Transport",
      "X-Kirinuki-Transport-Counter"
    ].join(", "),
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Expose-Headers": [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "ETag"
    ].join(", "),
    "Access-Control-Max-Age": "0",
    "Cache-Control": "no-store",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
  });
}

function sendJson(
  response: ServerResponse<IncomingMessage>,
  origin: string,
  status: number,
  payload: unknown,
  statusText?: string
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, statusText, {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(bytes.byteLength),
    "X-Content-Type-Options": "nosniff"
  });
  response.end(bytes);
}

async function createIdentity(): Promise<Readonly<{
  keyId: string;
  publicKeySpki: string;
  sign: (transcript: Uint8Array) => Promise<string>;
}>> {
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeySpki = encodeBase64Url(new Uint8Array(
    await webcrypto.subtle.exportKey("spki", keys.publicKey)
  ));
  const keyId = await localMediaEnginePublicKeyId(publicKeySpki);
  if (!keyId) {
    throw new Error("v2 fixture device identity 지문을 만들지 못했습니다.");
  }
  return Object.freeze({
    keyId,
    publicKeySpki,
    sign: async (transcript: Uint8Array): Promise<string> => encodeBase64Url(
      new Uint8Array(await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        ownedArrayBuffer(transcript)
      ))
    )
  });
}

export async function createLocalMediaEngineV2Fixture(
  options: Readonly<LocalMediaEngineV2FixtureOptions>
): Promise<Readonly<LocalMediaEngineV2Fixture>> {
  const identity = await createIdentity();
  const instanceNonce = randomBytes(32).toString("base64url");
  const grants = new Map<string, SessionGrant>();
  const transports = new Map<string, TransportState>();
  const mutableSessions: Readonly<LocalMediaEngineV2Session>[] = [];
  const records = options.records || [];

  const signedProof = async ({
    kind,
    challenge,
    payload,
    requestBinding = ""
  }: {
    readonly kind: "health" | "session";
    readonly challenge: string;
    readonly payload: unknown;
    readonly requestBinding?: string;
  }) => Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId: identity.keyId,
    challenge,
    instanceNonce,
    signature: await identity.sign(localMediaEngineProofTranscript({
      kind,
      challenge,
      instanceNonce,
      requestBinding,
      payload
    }))
  });

  const sendEncryptedJson = async ({
    response,
    request,
    path,
    protocol,
    transportId,
    counter,
    transport,
    reply
  }: {
    readonly response: ServerResponse<IncomingMessage>;
    readonly request: IncomingMessage;
    readonly path: string;
    readonly protocol: string;
    readonly transportId: string;
    readonly counter: number;
    readonly transport: Readonly<TransportState>;
    readonly reply: Readonly<LocalMediaEngineV2JsonResponse>;
  }): Promise<void> => {
    const status = reply.status ?? 200;
    const ivBytes = randomBytes(12);
    const iv = ivBytes.toString("base64url");
    const key = await webcrypto.subtle.importKey(
      "raw",
      ownedArrayBuffer(transport.key),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    const aad = localMediaEngineTransportAad({
      direction: "response",
      transportId,
      counter,
      method: String(request.method || "").toUpperCase(),
      path,
      protocol,
      clientNonce: transport.clientNonce,
      iv,
      status
    });
    const plaintext = new TextEncoder().encode(JSON.stringify(reply.payload));
    const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    }, key, ownedArrayBuffer(plaintext)));
    sendJson(response, options.allowedOrigin, status, {
      schema: LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
      transportId,
      counter,
      iv,
      ciphertext: encodeBase64Url(ciphertext)
    }, reply.statusText);
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<void> => {
    const method = String(request.method || "").toUpperCase();
    const origin = exactHeader(request, "origin");
    const host = exactHeader(request, "host");
    const pathWithQuery = String(request.url || "/");
    const url = new URL(pathWithQuery, "http://127.0.0.1:4319");
    const protocol = exactHeader(request, "x-kirinuki-protocol");
    const clientNonce = exactHeader(request, "x-kirinuki-client-nonce");
    const transportId = exactHeader(
      request,
      LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER
    );
    const transportCounter = exactHeader(
      request,
      LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER
    );
    records.push(Object.freeze({
      authorization: exactHeader(request, "authorization"),
      clientNonce,
      cookie: exactHeader(request, "cookie"),
      encrypted: Boolean(transportId || transportCounter),
      method,
      origin,
      path: pathWithQuery,
      protocol,
      requestedPrivateNetwork: exactHeader(
        request,
        "access-control-request-private-network"
      ),
      transportCounter,
      transportId
    }));
    if (
      host !== "127.0.0.1:4319"
      || origin !== options.allowedOrigin
      || exactHeader(request, "cookie") !== ""
    ) {
      request.resume();
      sendJson(response, options.allowedOrigin, 403, {
        error: { code: "FIXTURE_FORBIDDEN", message: "exact loopback binding required" }
      });
      return;
    }
    if (method === "OPTIONS") {
      request.resume();
      response.writeHead(204, corsHeaders(options.allowedOrigin));
      response.end();
      return;
    }
    if (url.pathname === "/v1/pairing" && method === "GET") {
      request.resume();
      const state = exactHeader(request, LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER);
      const challenge = exactHeader(
        request,
        LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER
      );
      if (
        protocol !== LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL
        || !exactBase64UrlBytes(state, 32)
        || !exactBase64UrlBytes(challenge, 32)
      ) {
        sendJson(response, options.allowedOrigin, 400, {
          error: { code: "INVALID_PAIRING_POLL", message: "invalid pairing fixture request" }
        });
        return;
      }
      const unsigned = pairingResponseUnsignedPayload({
        schema: LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
        algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
        state,
        challenge,
        keyId: identity.keyId,
        publicKeySpki: identity.publicKeySpki,
        engineVersion: "3.0.1",
        issuedAt: new Date().toISOString()
      });
      sendJson(response, options.allowedOrigin, 200, {
        ...unsigned,
        signature: await identity.sign(localMediaEngineProofTranscript({
          kind: "pairing",
          challenge,
          instanceNonce: "",
          requestBinding: state,
          payload: unsigned
        }))
      });
      return;
    }
    if (url.pathname === "/v1/health" && method === "GET") {
      request.resume();
      const challenge = exactHeader(
        request,
        LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER
      );
      if (
        protocol !== LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL
        || !exactBase64UrlBytes(challenge, 32)
      ) {
        sendJson(response, options.allowedOrigin, 403, {
          error: { code: "HEALTH_PROBE_NOT_ALLOWED", message: "signed health proof required" }
        });
        return;
      }
      const grantId = randomBytes(32).toString("base64url");
      const keys = await webcrypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
      );
      const expiresAtMs = Date.now() + 30_000;
      grants.set(grantId, {
        expiresAtMs,
        privateKey: keys.privateKey
      });
      const sessionEncryption = Object.freeze({
        schema: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
        algorithm: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
        grantId,
        serverPublicKey: encodeBase64Url(new Uint8Array(
          await webcrypto.subtle.exportKey("raw", keys.publicKey)
        )),
        expiresAt: new Date(expiresAtMs).toISOString()
      });
      const healthPayload = Object.freeze({
        schema: LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
        status: "ok",
        managed: true,
        engine: {
          backgroundStart: "ready",
          product: LOCAL_MEDIA_ENGINE_PRODUCT,
          protocol: LOCAL_MEDIA_ENGINE_API_PROTOCOL,
          version: "3.0.1"
        },
        originBinding: options.originBinding,
        authentication: "bearer-memory-capability",
        transcriptionMode: "local-whispercpp",
        vodRuntime: {
          schema: LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA,
          kind: "vod-only",
          ready: true,
          ytDlp: { version: "2026.07.04" },
          ejs: { version: "0.8.0" },
          instanceNonce
        },
        sessionEncryption
      });
      sendJson(response, options.allowedOrigin, 200, {
        ...healthPayload,
        deviceProof: await signedProof({
          kind: "health",
          challenge,
          payload: healthPayload
        })
      });
      return;
    }
    if (url.pathname === "/v1/session" && method === "POST") {
      const challenge = exactHeader(
        request,
        LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER
      );
      const encrypted = parseLocalMediaEngineEncryptedSessionRequest(
        await readJsonBody(request)
      );
      const grant = encrypted ? grants.get(encrypted.grantId) : undefined;
      if (
        protocol !== LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL
        || !exactBase64UrlBytes(challenge, 32)
        || !encrypted
        || !grant
        || Date.now() >= grant.expiresAtMs
      ) {
        sendJson(response, options.allowedOrigin, 400, {
          error: { code: "INVALID_SESSION_REQUEST", message: "invalid encrypted session" }
        });
        return;
      }
      grants.delete(encrypted.grantId);
      const [plaintext, sharedKey] = await Promise.all([
        decryptLocalMediaEngineSessionRequest({
          privateKey: grant.privateKey,
          request: encrypted,
          responseChallenge: challenge
        }),
        deriveLocalMediaEngineSharedKey({
          privateKey: grant.privateKey,
          peerPublicKey: encrypted.clientPublicKey
        })
      ]);
      const sessionRequest = JSON.parse(plaintext) as unknown;
      if (
        !isRecord(sessionRequest)
        || sessionRequest.schema !== LOCAL_ENGINE_SESSION_REQUEST_SCHEMA
        || sessionRequest.clientNonce !== clientNonce
        || !exactBase64UrlBytes(clientNonce, 32)
        || typeof sessionRequest.projectId !== "string"
        || sessionRequest.projectId.length === 0
        || !Array.isArray(sessionRequest.actions)
        || !sessionRequest.actions.every((action) => typeof action === "string")
        || (
          sessionRequest.sourceUrl !== undefined
          && typeof sessionRequest.sourceUrl !== "string"
        )
      ) {
        sharedKey.fill(0);
        sendJson(response, options.allowedOrigin, 400, {
          error: { code: "INVALID_SESSION_REQUEST", message: "invalid decrypted session" }
        });
        return;
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const session: Readonly<LocalMediaEngineV2Session> = Object.freeze({
        actions: Object.freeze([...sessionRequest.actions]),
        clientNonce,
        expiresAt,
        projectId: sessionRequest.projectId,
        ...(sessionRequest.sourceUrl === undefined
          ? {}
          : { sourceUrl: sessionRequest.sourceUrl }),
        token,
        transportId: encrypted.grantId
      });
      mutableSessions.push(session);
      transports.set(encrypted.grantId, {
        clientNonce,
        key: sharedKey,
        session,
        seenCounters: new Set()
      });
      const sessionPayload = Object.freeze({
        schema: LOCAL_ENGINE_SESSION_RESPONSE_SCHEMA,
        authentication: "bearer-memory-capability",
        expiresAt,
        token
      });
      const encryptedResponse = await encryptLocalMediaEngineSessionResponse({
        sharedKey,
        request: encrypted,
        responseChallenge: challenge,
        plaintext: JSON.stringify({
          ...sessionPayload,
          deviceProof: await signedProof({
            kind: "session",
            challenge,
            requestBinding: JSON.stringify(sessionRequest),
            payload: sessionPayload
          })
        })
      });
      sendJson(response, options.allowedOrigin, 200, encryptedResponse);
      return;
    }
    if (
      /^\/v1\/vod\/media\/[A-Za-z0-9_-]{16,128}$/u.test(url.pathname)
      && (method === "GET" || method === "HEAD")
    ) {
      const handled = await options.onMediaRequest?.({
        method,
        path: pathWithQuery,
        request,
        response
      });
      if (!handled) {
        request.resume();
        sendJson(response, options.allowedOrigin, 404, {
          error: { code: "MEDIA_NOT_FOUND", message: "fixture media not found" }
        });
      }
      return;
    }
    if (!["GET", "POST", "DELETE"].includes(method)) {
      request.resume();
      sendJson(response, options.allowedOrigin, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "unsupported method" }
      });
      return;
    }
    const counter = /^[1-9][0-9]{0,15}$/u.test(transportCounter)
      ? Number(transportCounter)
      : Number.NaN;
    const transport = transports.get(transportId);
    const envelope = parseLocalMediaEngineTransportRequest(
      await readJsonBody(request),
      MAXIMUM_REQUEST_BYTES
    );
    if (
      !transport
      || transport.clientNonce !== clientNonce
      || !Number.isSafeInteger(counter)
      || transport.seenCounters.has(counter)
      || !envelope
      || envelope.transportId !== transportId
      || envelope.counter !== counter
    ) {
      sendJson(response, options.allowedOrigin, 401, {
        error: { code: "ENCRYPTED_TRANSPORT_REQUIRED", message: "invalid transport" }
      });
      return;
    }
    transport.seenCounters.add(counter);
    const ivBytes = decodeBase64Url(envelope.iv);
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    if (!ivBytes || !ciphertext) {
      sendJson(response, options.allowedOrigin, 400, {
        error: { code: "INVALID_ENCRYPTED_REQUEST", message: "invalid ciphertext" }
      });
      return;
    }
    const key = await webcrypto.subtle.importKey(
      "raw",
      ownedArrayBuffer(transport.key),
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const aad = localMediaEngineTransportAad({
      direction: "request",
      transportId,
      counter,
      method,
      path: pathWithQuery,
      protocol,
      clientNonce,
      iv: envelope.iv
    });
    const decrypted = await webcrypto.subtle.decrypt({
      name: "AES-GCM",
      iv: ownedArrayBuffer(ivBytes),
      additionalData: ownedArrayBuffer(aad),
      tagLength: 128
    }, key, ownedArrayBuffer(ciphertext));
    const container = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(decrypted)
    ) as unknown;
    if (
      !isRecord(container)
      || container.token !== transport.session.token
      || (container.mediaAccess !== null
        && !exactBase64UrlBytes(container.mediaAccess, 32))
      || (container.bodyText !== null
        && typeof container.bodyText !== "string")
    ) {
      sendJson(response, options.allowedOrigin, 401, {
        error: { code: "CAPABILITY_SCOPE_MISMATCH", message: "invalid capability" }
      });
      return;
    }
    let body: unknown = null;
    if (typeof container.bodyText === "string") {
      body = JSON.parse(container.bodyText) as unknown;
    }
    const controlRequest: LocalMediaEngineV2ControlRequest = Object.freeze({
      body,
      clientNonce,
      mediaAccess: container.mediaAccess as string | null,
      method: method as "GET" | "POST" | "DELETE",
      path: pathWithQuery,
      protocol,
      session: transport.session,
      token: transport.session.token
    });
    const reply = url.pathname === "/v1/session/status"
      && method === "POST"
      && protocol === LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL
      ? {
        status: 200,
        payload: {
          schema: LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA,
          status: "active",
          actions: [...transport.session.actions],
          sourceBound: transport.session.sourceUrl !== undefined,
          expiresAt: transport.session.expiresAt
        }
      }
      : await options.onControlRequest(controlRequest);
    await sendEncryptedJson({
      response,
      request,
      path: pathWithQuery,
      protocol,
      transportId,
      counter,
      transport,
      reply
    });
  };

  const server: Server = createServer({
    insecureHTTPParser: false,
    maxHeaderSize: 16 * 1024
  }, (request, response) => {
    void handle(request, response).catch((error) => {
      options.errors?.push(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      );
      sendJson(response, options.allowedOrigin, 500, {
        error: {
          code: "V2_FIXTURE_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    });
  });

  return Object.freeze({
    keyId: identity.keyId,
    publicKeySpki: identity.publicKeySpki,
    sessions: mutableSessions,
    listen: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 4319, exclusive: true }, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    },
    close: async (): Promise<void> => {
      for (const transport of transports.values()) {
        transport.key.fill(0);
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  });
}
