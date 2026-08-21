import {
  LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  exactBase64UrlBytes,
  localMediaEngineProofTranscript,
  pairingResponseUnsignedPayload
} from "../lib/local-media-engine-auth.js";
import type {
  LocalMediaEnginePairingRequest,
  LocalMediaEnginePairingResponse
} from "../lib/local-media-engine-auth.js";
import { isLocalMediaEngineVersion } from "../lib/local-media-engine-contract.js";
import type { DesktopDeviceIdentity } from "./device-identity.js";

export async function desktopPairingResponse({
  identity,
  request,
  engineVersion,
  now = Date.now
}: {
  readonly identity: Readonly<DesktopDeviceIdentity>;
  readonly request: Readonly<LocalMediaEnginePairingRequest>;
  readonly engineVersion: string;
  readonly now?: () => number;
}): Promise<Readonly<LocalMediaEnginePairingResponse>> {
  if (
    !exactBase64UrlBytes(request.state, 32)
    || !exactBase64UrlBytes(request.challenge, 32)
    || !exactBase64UrlBytes(identity.keyId, 32)
    || identity.algorithm !== LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM
    || typeof identity.publicKeySpki !== "string"
    || !isLocalMediaEngineVersion(engineVersion)
  ) {
    throw new TypeError("Kirinuki 엔진 연결 응답 identity가 올바르지 않습니다.");
  }
  const timestamp = now();
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new TypeError("Kirinuki 엔진 연결 응답 시간이 올바르지 않습니다.");
  }
  const unsigned = pairingResponseUnsignedPayload({
    schema: LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    state: request.state,
    challenge: request.challenge,
    keyId: identity.keyId,
    publicKeySpki: identity.publicKeySpki,
    engineVersion,
    issuedAt: new Date(timestamp).toISOString()
  });
  const signature = await identity.sign(localMediaEngineProofTranscript({
    kind: "pairing",
    challenge: request.challenge,
    instanceNonce: "",
    requestBinding: request.state,
    payload: unsigned
  }));
  const response: LocalMediaEnginePairingResponse = {
    ...unsigned,
    signature
  };
  return Object.freeze(response);
}
