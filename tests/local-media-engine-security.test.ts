import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";

import {
  CAPTION_AGENT_REQUEST_SCHEMA,
  captionAgentRequestHeaders,
  captionAgentSessionEndpoint,
  clearLocalMediaEngineSessionState,
  pairCaptionAgent
} from "../src/editor/caption-agent.js";
import {
  localMediaEngineTransportFetch,
  hasLocalMediaEngineTransport
} from "../src/editor/local-media-engine-transport.js";
import {
  currentAuthenticatedLocalMediaEngine
} from "../src/editor/local-media-engine-trust.js";
import type {
  LocalMediaEngineDevicePin,
  LocalMediaEngineTrustStore
} from "../src/editor/local-media-engine-trust.js";
import {
  LOCAL_MEDIA_ENGINE_TRUST_SCHEMA
} from "../src/editor/local-media-engine-trust.js";
import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
  LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  decodeBase64Url,
  encodeBase64Url,
  freshLocalMediaEngineChallenge,
  localMediaEngineProofTranscript,
  localMediaEnginePublicKeyId,
  pairingResponseUnsignedPayload,
  parseLocalMediaEngineSessionEncryptionOffer,
  prepareLocalMediaEngineSessionRequest
} from "../src/lib/local-media-engine-auth.js";
import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA
} from "../src/lib/local-media-engine-transport.js";
import {
  createCaptionGatewayServer
} from "../scripts/caption-gateway.js";
import {
  LOCAL_WHISPERCPP_TRANSCRIPTION_MODE
} from "../src/caption-agent/caption-gateway-core.js";
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP
} from "../scripts/local-vod-runtime-core.js";

const FIXED_ENDPOINT = "http://127.0.0.1:4319/v1/captions";
const SOURCE_URL = "https://www.youtube.com/watch?v=abcdefghijk";

interface DeviceFixture {
  readonly pin: Readonly<LocalMediaEngineDevicePin>;
  readonly signer: Readonly<{
    algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
    keyId: string;
    sign: (transcript: Uint8Array) => Promise<string>;
  }>;
  readonly trustStore: Readonly<LocalMediaEngineTrustStore>;
}

interface WireRecord {
  readonly method: string;
  readonly path: string;
  readonly requestBody: string;
  readonly responseBody: string;
  readonly status: number;
}

async function deviceFixture(): Promise<DeviceFixture> {
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeySpki = encodeBase64Url(new Uint8Array(
    await webcrypto.subtle.exportKey("spki", keys.publicKey)
  ));
  const keyId = await localMediaEnginePublicKeyId(publicKeySpki);
  assert.ok(keyId);
  const sign = async (transcript: Uint8Array): Promise<string> => (
    encodeBase64Url(new Uint8Array(await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      Uint8Array.from(transcript).buffer
    )))
  );
  const pin = Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId,
    publicKeySpki,
    enrolledAt: new Date().toISOString(),
    maxSeenVersion: "3.0.0"
  });
  const trustStore = Object.freeze({
    read: async () => pin,
    pin: async () => pin,
    observeVersion: async (expectedKeyId: string, engineVersion: string) => {
      assert.equal(expectedKeyId, keyId);
      return Object.freeze({ ...pin, maxSeenVersion: engineVersion });
    },
    reset: async () => undefined
  });
  return {
    pin,
    signer: Object.freeze({
      algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
      keyId,
      sign
    }),
    trustStore
  };
}

function requestBodyText(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "";
}

function forwardedInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Origin", KIRINUKI_PUBLIC_STUDIO_ORIGIN);
  return { ...init, headers };
}

function mappedUrl(input: URL | RequestInfo, port: number): URL {
  const url = new URL(String(input));
  assert.equal(url.origin, "http://127.0.0.1:4319");
  url.port = String(port);
  return url;
}

function recordingFetch(port: number, records: WireRecord[]): typeof fetch {
  return (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = mappedUrl(input, port);
    const response = await fetch(url, forwardedInit(init));
    records.push(Object.freeze({
      method: String(init.method || "GET").toUpperCase(),
      path: `${url.pathname}${url.search}`,
      requestBody: requestBodyText(init.body),
      responseBody: await response.clone().text(),
      status: response.status
    }));
    return response;
  }) as typeof fetch;
}

async function startPublicGateway(t: TestContext, device: DeviceFixture) {
  const stateRoot = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-security-gateway-"
  ));
  const runtime = createCaptionGatewayServer({
    deviceProofSigner: device.signer,
    env: {
      KIRINUKI_STT_MODE: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
      KIRINUKI_STT_ENDPOINT: "http://127.0.0.1:4318/test/inference",
      KIRINUKI_STT_MODEL: "tiny-q5_1",
      KIRINUKI_AGENT_TOKEN: encodeBase64Url(new Uint8Array(32).fill(0x51)),
      KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      KIRINUKI_LOCAL_ENGINE_VERSION: "3.0.0",
      KIRINUKI_MAX_AUDIO_BYTES: "1048576",
      KIRINUKI_VOD_RUNTIME_SCHEMA: LOCAL_VOD_RUNTIME_SCHEMA,
      KIRINUKI_VOD_RUNTIME_KIND: "vod-only",
      KIRINUKI_VOD_RUNTIME_READY: "1",
      KIRINUKI_VOD_YT_DLP_VERSION: PINNED_YT_DLP.version,
      KIRINUKI_VOD_EJS_VERSION: PINNED_YT_DLP.bundledJavascript.version,
      KIRINUKI_VOD_INSTANCE_NONCE: encodeBase64Url(
        new Uint8Array(32).fill(0x52)
      ),
      KIRINUKI_VOD_STATE_DIR: stateRoot
    }
  });
  await runtime.ready;
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    clearLocalMediaEngineSessionState();
    await runtime.shutdown({ graceMs: 0, deadlineMs: 2_000 });
    await rm(stateRoot, { recursive: true, force: true });
  });
  return {
    port: (address as AddressInfo).port,
    runtime
  };
}

async function rawHealth(fetchImpl: typeof fetch): Promise<{
  readonly challenge: string;
  readonly payload: Record<string, unknown>;
}> {
  const challenge = freshLocalMediaEngineChallenge();
  const response = await fetchImpl("http://127.0.0.1:4319/v1/health", {
    method: "GET",
    headers: {
      "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
      [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: challenge
    }
  });
  assert.equal(response.status, 200);
  return {
    challenge,
    payload: await response.json() as Record<string, unknown>
  };
}

test("public loopback v2는 session/control plaintext를 숨기고 exact actions·replay·route allowlist를 강제한다", async (t) => {
  const device = await deviceFixture();
  const { port } = await startPublicGateway(t, device);
  const records: WireRecord[] = [];
  const fetchImpl = recordingFetch(port, records);

  const token = await pairCaptionAgent({
    endpoint: FIXED_ENDPOINT,
    purpose: "vod",
    projectId: "보안 프로젝트 A",
    sourceUrl: SOURCE_URL,
    fetchImpl,
    trustStore: device.trustStore
  });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  const sessionWire = records.find((record) => (
    record.path === "/v1/session" && record.method === "POST"
  ));
  assert.ok(sessionWire);
  assert.deepEqual(
    Object.keys(JSON.parse(sessionWire.requestBody) as object).sort(),
    ["ciphertext", "clientPublicKey", "grantId", "iv", "schema"]
  );
  assert.doesNotMatch(sessionWire.requestBody, /보안 프로젝트|youtube|cache-delete|vod/u);
  assert.doesNotMatch(sessionWire.responseBody, new RegExp(token, "u"));
  assert.equal(
    (JSON.parse(sessionWire.responseBody) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA
  );

  const statusUrl = "http://127.0.0.1:4319/v1/session/status";
  await assert.rejects(
    localMediaEngineTransportFetch(statusUrl, {
      method: "GET",
      headers: {
        "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
        ...captionAgentRequestHeaders(token)
      }
    }, fetchImpl),
    /POST 또는 DELETE/u
  );
  let duplicatedInit: RequestInit | null = null;
  let duplicateStatuses: number[] = [];
  let encryptedStatusResponse = "";
  const duplicateFetch = (async (
    input: URL | RequestInfo,
    init: RequestInit = {}
  ) => {
    const url = mappedUrl(input, port);
    duplicatedInit = {
      ...init,
      headers: new Headers(init.headers),
      body: requestBodyText(init.body)
    };
    const makeRequest = () => fetch(url, forwardedInit({
      ...init,
      headers: new Headers(init.headers),
      body: requestBodyText(init.body)
    }));
    const responses = await Promise.all([makeRequest(), makeRequest()]);
    duplicateStatuses = responses.map((response) => response.status).sort();
    const accepted = responses.find((response) => response.status === 200);
    const rejected = responses.find((response) => response.status === 401);
    assert.ok(accepted && rejected);
    encryptedStatusResponse = await accepted.clone().text();
    await rejected.arrayBuffer();
    return accepted;
  }) as typeof fetch;
  const statusResponse = await localMediaEngineTransportFetch(statusUrl, {
    method: "POST",
    headers: {
      "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
      ...captionAgentRequestHeaders(token)
    }
  }, duplicateFetch);
  assert.deepEqual(duplicateStatuses, [200, 401]);
  assert.equal(
    (JSON.parse(encryptedStatusResponse) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA
  );
  assert.doesNotMatch(encryptedStatusResponse, new RegExp(token, "u"));
  const statusBody = await statusResponse.json() as Record<string, unknown>;
  assert.deepEqual({ ...statusBody, expiresAt: undefined }, {
    schema: "kirinuki-local-engine-session-status-response/v1",
    status: "active",
    actions: ["vod", "cache-delete"],
    sourceBound: true,
    expiresAt: undefined
  });
  assert.ok(Date.parse(String(statusBody.expiresAt)) > Date.now());

  const replayInit = duplicatedInit as RequestInit | null;
  assert.ok(replayInit);
  const replay = await fetch(
    mappedUrl(statusUrl, port),
    forwardedInit({
      ...replayInit,
      signal: null,
      headers: new Headers(replayInit.headers)
    })
  );
  assert.equal(replay.status, 401);
  assert.equal(
    ((await replay.json()) as { error: { code: string } }).error.code,
    "ENCRYPTED_TRANSPORT_REPLAYED"
  );

  const forbiddenCaption = await localMediaEngineTransportFetch(
    FIXED_ENDPOINT,
    {
      method: "POST",
      headers: {
        "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA,
        ...captionAgentRequestHeaders(token)
      }
    },
    fetchImpl
  );
  assert.equal(forbiddenCaption.status, 403);
  assert.equal(
    ((await forbiddenCaption.json()) as { error: { code: string } }).error.code,
    "CAPABILITY_ACTION_NOT_ALLOWED"
  );

  const unknownRoute = await fetchImpl("http://127.0.0.1:4319/v1/admin", {
    method: "GET"
  });
  assert.equal(unknownRoute.status, 404);
  const downgrade = await fetchImpl(statusUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kirinuki-Client-Nonce": freshLocalMediaEngineChallenge(),
      "X-Kirinuki-Protocol": "kirinuki-local-engine-session-request/v1"
    },
    body: JSON.stringify({ token: "plaintext-downgrade" })
  });
  assert.notEqual(downgrade.status, 200);

  clearLocalMediaEngineSessionState();
  assert.equal(hasLocalMediaEngineTransport(), false);
  assert.equal(currentAuthenticatedLocalMediaEngine(), null);
  assert.equal((await device.trustStore.read())?.keyId, device.pin.keyId);

  const captionToken = await pairCaptionAgent({
    endpoint: FIXED_ENDPOINT,
    purpose: "captions",
    projectId: "보안 프로젝트 B",
    fetchImpl,
    trustStore: device.trustStore
  });
  const captionStatus = await localMediaEngineTransportFetch(statusUrl, {
    method: "POST",
    headers: {
      "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
      ...captionAgentRequestHeaders(captionToken)
    }
  }, fetchImpl);
  const captionStatusBody = await captionStatus.json() as Record<string, unknown>;
  assert.deepEqual(captionStatusBody.actions, ["captions"]);
  assert.equal(captionStatusBody.sourceBound, false);
});

test("signed health/session tamper와 one-shot ECDH grant oracle를 fail closed한다", async (t) => {
  const device = await deviceFixture();
  const { port } = await startPublicGateway(t, device);
  const baseFetch = recordingFetch(port, []);

  const forgedHealthFetch = (async (
    input: URL | RequestInfo,
    init: RequestInit = {}
  ) => {
    const response = await baseFetch(input, init);
    if (new URL(String(input)).pathname !== "/v1/health") return response;
    const payload = await response.json() as Record<string, unknown>;
    const proof = payload.deviceProof as Record<string, unknown>;
    proof.signature = encodeBase64Url(new Uint8Array(64).fill(0x7f));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  await assert.rejects(
    pairCaptionAgent({
      endpoint: FIXED_ENDPOINT,
      purpose: "vod",
      projectId: "takeover-project",
      sourceUrl: SOURCE_URL,
      fetchImpl: forgedHealthFetch,
      trustStore: device.trustStore
    }),
    /서명을 확인하지 못했습니다/u
  );

  for (const mode of ["plaintext", "tampered"] as const) {
    clearLocalMediaEngineSessionState();
    const alteredSessionFetch = (async (
      input: URL | RequestInfo,
      init: RequestInit = {}
    ) => {
      const response = await baseFetch(input, init);
      if (
        new URL(String(input)).pathname !== "/v1/session"
        || String(init.method || "GET").toUpperCase() !== "POST"
      ) {
        return response;
      }
      if (mode === "plaintext") {
        return new Response(JSON.stringify({
          token: encodeBase64Url(new Uint8Array(32).fill(0x33))
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      const envelope = await response.json() as Record<string, unknown>;
      const ciphertext = decodeBase64Url(envelope.ciphertext);
      assert.ok(ciphertext);
      ciphertext[0] = ciphertext[0]! ^ 1;
      envelope.ciphertext = encodeBase64Url(ciphertext);
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;
    await assert.rejects(
      pairCaptionAgent({
        endpoint: FIXED_ENDPOINT,
        purpose: "vod",
        projectId: `session-${mode}`,
        sourceUrl: SOURCE_URL,
        fetchImpl: alteredSessionFetch,
        trustStore: device.trustStore
      }),
      /암호화된 연결 응답 인증에 실패/u
    );
  }

  const health = await rawHealth(baseFetch);
  const offer = parseLocalMediaEngineSessionEncryptionOffer(
    health.payload.sessionEncryption
  );
  assert.ok(offer);
  const responseChallenge = freshLocalMediaEngineChallenge();
  const clientNonce = freshLocalMediaEngineChallenge();
  const prepared = await prepareLocalMediaEngineSessionRequest({
    offer,
    responseChallenge,
    plaintext: JSON.stringify({
      schema: LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
      clientNonce,
      projectId: "one-shot-oracle",
      actions: ["vod", "cache-delete"],
      sourceUrl: SOURCE_URL
    })
  });
  const tampered = structuredClone(prepared.request);
  const requestCiphertext = decodeBase64Url(tampered.ciphertext);
  assert.ok(requestCiphertext);
  requestCiphertext[0] = requestCiphertext[0]! ^ 1;
  (tampered as { ciphertext: string }).ciphertext = encodeBase64Url(
    requestCiphertext
  );
  const sessionHeaders = {
    "Content-Type": "application/json",
    "X-Kirinuki-Client-Nonce": clientNonce,
    "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
    [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: responseChallenge
  };
  const first = await baseFetch(captionAgentSessionEndpoint(FIXED_ENDPOINT), {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify(tampered)
  });
  assert.equal(first.status, 400);
  const oracleReplay = await baseFetch(captionAgentSessionEndpoint(FIXED_ENDPOINT), {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify(prepared.request)
  });
  assert.equal(oracleReplay.status, 400);
  prepared.sharedKey.fill(0);
});

test("custom-scheme pairing handoff는 state/challenge에 묶여 loopback에서 한 번만 claim된다", async (t) => {
  const device = await deviceFixture();
  const { port, runtime } = await startPublicGateway(t, device);
  const fetchImpl = recordingFetch(port, []);
  const state = freshLocalMediaEngineChallenge();
  const challenge = freshLocalMediaEngineChallenge();
  const unsigned = {
    schema: LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    state,
    challenge,
    keyId: device.pin.keyId,
    publicKeySpki: device.pin.publicKeySpki,
    engineVersion: "3.0.0",
    issuedAt: new Date().toISOString()
  };
  const response = Object.freeze({
    ...unsigned,
    signature: await device.signer.sign(localMediaEngineProofTranscript({
      kind: "pairing",
      challenge,
      instanceNonce: "",
      requestBinding: state,
      payload: pairingResponseUnsignedPayload(unsigned)
    }))
  });
  await runtime.publishPairingResponse(response);
  const poll = (pollChallenge: string) => fetchImpl(
    "http://127.0.0.1:4319/v1/pairing",
    {
      method: "GET",
      headers: {
        "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
        [LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER]: state,
        [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: pollChallenge
      }
    }
  );
  const wrongChallenge = await poll(freshLocalMediaEngineChallenge());
  assert.equal(wrongChallenge.status, 202);
  const claimed = await poll(challenge);
  assert.equal(claimed.status, 200);
  assert.equal((await claimed.json() as Record<string, unknown>).state, state);
  const replay = await poll(challenge);
  assert.equal(replay.status, 202);
});
