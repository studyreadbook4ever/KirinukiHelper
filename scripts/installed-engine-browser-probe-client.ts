import {
  pairCaptionAgent
} from "../src/editor/caption-agent.js";
import {
  pairLocalMediaEngine
} from "../src/editor/local-media-engine-onboarding.js";
import {
  createLocalMediaEngineTrustStore
} from "../src/editor/local-media-engine-trust.js";

declare global {
  interface Window {
    __kirinukiInstalledEnginePairingUrl?: string;
    __kirinukiInstalledEngineResult?: Readonly<{
      origin: string;
      phase: "paired" | "reconnected";
      keyId: string;
      sessionCapabilityBytes: number;
      sessionRenewed: boolean;
      status: "ok";
    }>;
    __kirinukiInstalledEngineError?: string;
  }
}

const ENGINE_ENDPOINT = "http://127.0.0.1:4319/v1/captions";
const SOURCE_URL = "https://www.youtube.com/watch?v=abcdefghijk";
const PREVIOUS_SESSION_FINGERPRINT_KEY =
  "kirinuki-installed-browser-smoke/previous-session-fingerprint";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

async function sessionFingerprint(capability: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(capability)
  )));
}

async function run(): Promise<void> {
  window.__kirinukiInstalledEnginePairingUrl = "";
  window.__kirinukiInstalledEngineError = "";
  const trustStore = createLocalMediaEngineTrustStore(indexedDB);
  const existing = await trustStore.read();
  const pin = existing ?? await pairLocalMediaEngine(undefined, {
    trustStore,
    openProtocol: (url) => {
      window.__kirinukiInstalledEnginePairingUrl = url;
    },
    timeoutMs: 30_000
  });
  const capability = await pairCaptionAgent({
    endpoint: ENGINE_ENDPOINT,
    projectId: "installed-browser-e2e",
    sourceUrl: SOURCE_URL,
    trustStore,
    timeoutMs: 15_000
  });
  const fingerprint = await sessionFingerprint(capability);
  const previousFingerprint = sessionStorage.getItem(
    PREVIOUS_SESSION_FINGERPRINT_KEY
  );
  sessionStorage.setItem(PREVIOUS_SESSION_FINGERPRINT_KEY, fingerprint);
  window.__kirinukiInstalledEngineResult = Object.freeze({
    origin: location.origin,
    phase: existing ? "reconnected" : "paired",
    keyId: pin.keyId,
    sessionCapabilityBytes: new TextEncoder().encode(capability).byteLength,
    sessionRenewed: existing !== null
      && previousFingerprint !== null
      && previousFingerprint !== fingerprint,
    status: "ok"
  });
  document.documentElement.dataset.status = "ok";
}

void run().catch((error: unknown) => {
  window.__kirinukiInstalledEngineError = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  document.documentElement.dataset.status = "failed";
});
