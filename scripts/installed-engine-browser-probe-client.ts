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

type BrowserProbeEvent = Readonly<
  | { kind: "pairing"; pairingUrl: string }
  | { kind: "result"; result: NonNullable<Window["__kirinukiInstalledEngineResult"]> }
  | { kind: "error"; error: string }
>;

function browserProbeNonce(): string {
  const nonce = document.querySelector<HTMLMetaElement>(
    'meta[name="kirinuki-browser-probe-nonce"]'
  )?.content;
  if (!nonce || !/^[A-Za-z0-9_-]{43}$/u.test(nonce)) {
    throw new Error("browser probe nonce is missing or invalid");
  }
  return nonce;
}

async function reportProbeEvent(event: BrowserProbeEvent): Promise<void> {
  const response = await fetch("/probe-event", {
    body: JSON.stringify({ ...event, nonce: browserProbeNonce() }),
    cache: "no-store",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    throw new Error(`browser probe event report failed: ${response.status}`);
  }
}

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
  let pairingReport = Promise.resolve();
  let pairingReportError: unknown = null;
  const pin = existing ?? await pairLocalMediaEngine(undefined, {
    trustStore,
    openProtocol: (url) => {
      window.__kirinukiInstalledEnginePairingUrl = url;
      pairingReport = reportProbeEvent({ kind: "pairing", pairingUrl: url })
        .catch((error: unknown) => {
          pairingReportError = error;
        });
    },
    timeoutMs: 30_000
  });
  await pairingReport;
  if (pairingReportError !== null) {
    throw pairingReportError;
  }
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
  const result = Object.freeze({
    origin: location.origin,
    phase: existing ? "reconnected" : "paired",
    keyId: pin.keyId,
    sessionCapabilityBytes: new TextEncoder().encode(capability).byteLength,
    sessionRenewed: existing !== null
      && previousFingerprint !== null
      && previousFingerprint !== fingerprint,
    status: "ok"
  });
  window.__kirinukiInstalledEngineResult = result;
  document.documentElement.dataset.status = "ok";
  await reportProbeEvent({ kind: "result", result });
  if (existing === null) {
    location.reload();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  window.__kirinukiInstalledEngineError = message.slice(0, 2_000);
  document.documentElement.dataset.status = "failed";
  void reportProbeEvent({
    kind: "error",
    error: window.__kirinukiInstalledEngineError
  }).catch(() => undefined);
});
