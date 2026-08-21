#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer
} from "node:https";
import type { IncomingMessage } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  localMediaEnginePairingUrl,
  parseLocalMediaEnginePairingRequest
} from "../src/lib/local-media-engine-auth.js";
import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const probeClientPath = path.join(
  repositoryRoot,
  "scripts",
  "installed-engine-browser-probe-client.ts"
);
const canonicalHost = new URL(KIRINUKI_PUBLIC_STUDIO_ORIGIN).hostname;
const maximumDriverOutputBytes = 128 * 1024;

// Test-only keypair for the exact public hostname. Chrome is launched with
// certificate errors ignored; no production trust decision depends on it.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDABirtLoDFExMm
Hb5K7fwZhnyAapU8llJ+IGKUZm+0Jlu8uVRH/T5TmOvOqVWxa4cuDHFI6e5Hoaqf
ESjHhKezpynYDStr7DDX167z2hcCiLSvyuEF5hX2ww8r9PzDSfWUefaZdJtzViW+
kslxxN3Rszwf63EhRe6UbklVNSpJ0rrr8w3ndBzqFiCDeVgN2vxXSobNJ5+9bJPF
oUNMr+IeKnbT6Ea0s6v5VjkqD5ir4ytZo2P+JKAoJWtY4T+A2U3R+tQ8hOoV91fH
OcWtZgE2SHTgnHaSQKkZYcGVe+e7L+t8DTySTD9nniA4nN8B+Ejq9UIyl8ZNDQMS
DVzUoE3xAgMBAAECggEAB1w1KQIvTV59zWg2cwjMMO5Gt2VecwQQBWWYYbfLcExI
F+PCpz+9s9aYs0MqVbKZa9puPS06ROSddZtixMMA6pHtuKpIj8pt1NgfjJk/aIl0
44gTN/apwNuZKUYqqhGbqCVEnn0puDIFIFjf/8xb9D26gD62B2B21Jmlle6DwHCS
TYA11C7R6v1Wyh77oqM5WZC6u5wZxeBFr5FP09LWmMLOu7uSpp/5R/smKWiKRMyZ
Hy+yrd/uRS0oYPRdqYohu/kNY+m3y9+lRxwDsgVA/vy/wSpGaXwagX+5t2qd57MS
zX6XICmSXr73KKWsfb1HkFrS9gc30K1TRJX7fplgAQKBgQDvd768KYl7zwlFdxnf
JJrzH2VFez/UknCASHl5d+kowaeXi+WrUZ5Oxp9zVNokHgjWuVBHSoG4yuyyg3bc
BKvnVvjjF4bE+hv1dCw9AmDiI67+0atT5OLkXqfBfhRRPMwblicgter9/Gupfgnp
pSdLMEszIIKzIhERqr+OXFBh4QKBgQDNR+w8GME+RYVWNi337kITVDf58qLC0EeI
6A9kNlbIfCoOt3gsSLoPwB9RmQKIZGOCtkD8Vm182z3c5g2WPw1FPzUqhhpNTaV1
M/C2hjxA4el8yxD5h5tS1WdUJ0TNsnfwc53kjGkme13jM48sdEd7hj4aZdWzykGn
1T1+Gt+OEQKBgDx/hxtobwhtZM086rdaOx9DBkXIfnbIzE1MggvzBF+8lQePW2Wt
yA3k1jG/9SB8ygTdam+oXh9+fNAYsHWjZH6clWJh9jVbbqbTQ73iFPHsy/AqrlsS
j1PcqgsTPDTN5E7v31C/RPAHzndSlVSG2ed/+u+evgZdi+xns99WaSRhAoGBAIuU
xgqvAmbnOpy+Rk95EDC4aT9pPkac/KcYs65+TFASLT7IfcwOv4UKK8F9+vzm1csB
RfrOgbAOG2hifQaWZN2a9vmtKaE6lLC22owhhkLP2cVjBm3FSVXviUztTplXKrqy
wr+uwajK5bIhUs71Wc2iIAQvDjor4qzOD/v5Jd0hAoGBAONR06fQT8e81WNkaAhQ
SWTKRoIAMCDU1o1e9fY4pITDsNuCZ7uoTORhRGbHJhmIEi0/83R3JCTsouXfNUZP
KOIhElLHqCBnTuxIT/ukJc+HzbZVl/SkyhipJSsBO0efOw2e317KP6+q7dQM8Wz8
D/4qhHDiU9B0xJTqqfX2BCgN
-----END PRIVATE KEY-----`;

const TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUaUGf4jHAswmh83t72J9qcFaxwNUwDQYJKoZIhvcNAQEL
BQAwIjEgMB4GA1UEAwwXa2lyaW51a2kuZWZmMHJ0Y2h1bmcua3IwHhcNMjYwODIx
MDU0NTI3WhcNMzYwODE4MDU0NTI3WjAiMSAwHgYDVQQDDBdraXJpbnVraS5lZmYw
cnRjaHVuZy5rcjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMAGKu0u
gMUTEyYdvkrt/BmGfIBqlTyWUn4gYpRmb7QmW7y5VEf9PlOY686pVbFrhy4McUjp
7kehqp8RKMeEp7OnKdgNK2vsMNfXrvPaFwKItK/K4QXmFfbDDyv0/MNJ9ZR59pl0
m3NWJb6SyXHE3dGzPB/rcSFF7pRuSVU1KknSuuvzDed0HOoWIIN5WA3a/FdKhs0n
n71sk8WhQ0yv4h4qdtPoRrSzq/lWOSoPmKvjK1mjY/4koCgla1jhP4DZTdH61DyE
6hX3V8c5xa1mATZIdOCcdpJAqRlhwZV757sv63wNPJJMP2eeIDic3wH4SOr1QjKX
xk0NAxINXNSgTfECAwEAAaN3MHUwHQYDVR0OBBYEFOTbejDQYUa+RI/1V7iX8I95
poDVMB8GA1UdIwQYMBaAFOTbejDQYUa+RI/1V7iX8I95poDVMA8GA1UdEwEB/wQF
MAMBAf8wIgYDVR0RBBswGYIXa2lyaW51a2kuZWZmMHJ0Y2h1bmcua3IwDQYJKoZI
hvcNAQELBQADggEBAALGtNDTN9vGiPob1IDwhinKyyO2PjLf7hLCCmUX5FOZNsZE
yNjgYiCr52ACLHUclcvD4H8cUoqf9FBYmSLV7txbICHOaLIYWaob1drymul9bOIS
yaqJGbS72yLk5NsOGEYFncBx8Drgn8VQ9I53vDQn3K2kT7AH/L4SG1i8/SNbOlRk
aXw4ueqIo8iKENuEMPx5k6zmokYg5EsipxZR6Snupj4nUAzwT4vEKU8MEwgmlCtL
RSO1YhaopN6oSiSV3GkLz6fjhnDqEPsLSohgR4dpJTu9F5jUTxeY+p2mNV0UsDb+
Ioa7p2ZgI+SulrAm4Oza/idEwDtk03DZ1nWnIbI=
-----END CERTIFICATE-----`;

type ManagedChild = ChildProcess & {
  readonly stdout: Readable;
  readonly stderr: Readable;
};

interface WebDriverSession {
  readonly sessionId?: unknown;
}

interface WebDriverWindowCreation {
  readonly handle?: unknown;
  readonly type?: unknown;
}

interface CdpPageNavigation {
  readonly errorText?: unknown;
  readonly frameId?: unknown;
  readonly isDownload?: unknown;
  readonly loaderId?: unknown;
}

interface BrowserProbeResult {
  readonly origin?: unknown;
  readonly phase?: unknown;
  readonly keyId?: unknown;
  readonly sessionCapabilityBytes?: unknown;
  readonly sessionRenewed?: unknown;
  readonly status?: unknown;
}

type BrowserProbeEvent = Readonly<
  | { kind: "pairing"; pairingUrl: string }
  | { kind: "result"; result: BrowserProbeResult }
  | { kind: "error"; error: string }
>;

export interface InstalledEngineBrowserSmokeOptions {
  readonly launchPairingUrl: (url: string) => Promise<void>;
}

export interface InstalledEngineBrowserSmokeResult {
  readonly browser: string;
  readonly driver: string;
  readonly keyId: string;
  readonly origin: typeof KIRINUKI_PUBLIC_STUDIO_ORIGIN;
  readonly pairingLaunches: 1;
  readonly sessions: 2;
  readonly status: "ok";
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendOutput(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > maximumDriverOutputBytes
    ? next.slice(-maximumDriverOutputBytes)
    : next;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(
  environmentName: string,
  candidates: readonly string[]
): Promise<string> {
  const configured = process.env[environmentName];
  const names = configured ? [configured, ...candidates] : [...candidates];
  const directories = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const name of names) {
    if (path.isAbsolute(name) || name.includes(path.sep)) {
      const candidate = path.resolve(name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
      continue;
    }
    for (const directory of directories) {
      for (const suffix of process.platform === "win32" ? ["", ".exe"] : [""]) {
        const candidate = path.join(directory, `${name}${suffix}`);
        if (await isExecutable(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new Error(
    `${environmentName} 또는 PATH에서 설치된 실행 파일을 찾지 못했습니다: ${names.join(", ")}`
  );
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  invariant(Number.isInteger(port) && port >= 1_024, "ChromeDriver 포트를 받지 못했습니다.");
  return port;
}

async function listenLoopback(server: HttpsServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
  });
  const address = server.address();
  invariant(
    typeof address === "object"
      && address !== null
      && address.address === "127.0.0.1"
      && Number.isInteger(address.port)
      && address.port >= 1_024,
    "browser probe HTTPS port를 받지 못했습니다."
  );
  return address.port;
}

async function closeServer(server: HttpsServer): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function stopChild(child: ManagedChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    delay(3_000).then(() => false)
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(2_000)
    ]);
  }
}

async function fetchJson(
  url: string,
  method = "GET",
  body?: unknown,
  timeoutMs = 30_000
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) as unknown : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${url} 실패 (${response.status}): ${text.slice(0, 2_000)}`);
  }
  return payload;
}

async function browserBundle(): Promise<Buffer> {
  const result = await build({
    entryPoints: [probeClientPath],
    bundle: true,
    format: "esm",
    legalComments: "none",
    minify: false,
    platform: "browser",
    sourcemap: false,
    target: ["chrome142"],
    write: false
  });
  invariant(result.outputFiles.length === 1, "browser probe bundle 결과가 유일하지 않습니다.");
  return Buffer.from(result.outputFiles[0]!.contents);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  return JSON.stringify(Object.keys(value).sort())
    === JSON.stringify([...expected].sort());
}

async function readProbeEvent(
  request: IncomingMessage,
  expectedNonce: string
): Promise<BrowserProbeEvent> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    invariant(bytes <= 8 * 1024, "browser probe event가 너무 큽니다.");
    chunks.push(buffer);
  }
  invariant(bytes > 0, "browser probe event body가 없습니다.");
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  invariant(isRecord(value), "browser probe event가 object가 아닙니다.");
  invariant(value.nonce === expectedNonce, "browser probe event nonce가 다릅니다.");
  if (value.kind === "pairing") {
    invariant(
      hasExactKeys(value, ["kind", "nonce", "pairingUrl"])
        && typeof value.pairingUrl === "string"
        && value.pairingUrl.length <= 4_096,
      "browser pairing event 형식이 올바르지 않습니다."
    );
    return Object.freeze({ kind: "pairing", pairingUrl: value.pairingUrl });
  }
  if (value.kind === "result") {
    invariant(
      hasExactKeys(value, ["kind", "nonce", "result"])
        && isRecord(value.result)
        && hasExactKeys(value.result, [
          "keyId",
          "origin",
          "phase",
          "sessionCapabilityBytes",
          "sessionRenewed",
          "status"
        ]),
      "browser result event 형식이 올바르지 않습니다."
    );
    return Object.freeze({ kind: "result", result: value.result });
  }
  invariant(
    value.kind === "error"
      && hasExactKeys(value, ["error", "kind", "nonce"])
      && typeof value.error === "string"
      && value.error.length > 0
      && value.error.length <= 2_000,
    "browser error event 형식이 올바르지 않습니다."
  );
  return Object.freeze({ kind: "error", error: value.error });
}

function createProbeServer(
  javaScript: Buffer,
  observedPaths: string[],
  events: BrowserProbeEvent[],
  probeNonce: string
): HttpsServer {
  const html = Buffer.from(
    "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">"
      + `<meta name="kirinuki-browser-probe-nonce" content="${probeNonce}">`
      + "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; connect-src 'self' http://127.0.0.1:4319\">"
      + "<title>Kirinuki installed engine smoke</title></head>"
      + "<body><main>installed engine browser smoke</main><script type=\"module\" src=\"/probe.js\"></script></body></html>",
    "utf8"
  );
  const server = createHttpsServer({
    cert: TEST_CERTIFICATE,
    key: TEST_PRIVATE_KEY
  }, (request, response) => {
    void (async () => {
      const host = String(request.headers.host || "").replace(/:\d+$/u, "");
      invariant(host === canonicalHost, "browser probe Host가 다릅니다.");
      const requestUrl = new URL(request.url || "/", KIRINUKI_PUBLIC_STUDIO_ORIGIN);
      observedPaths.push(requestUrl.pathname);
      const headers = {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self' http://127.0.0.1:4319",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "permissions-policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY"
      };
      if (request.method === "POST" && requestUrl.pathname === "/probe-event") {
        invariant(
          request.headers.origin === KIRINUKI_PUBLIC_STUDIO_ORIGIN,
          "browser probe event Origin이 다릅니다."
        );
        invariant(
          request.headers["content-type"] === "application/json",
          "browser probe event Content-Type이 다릅니다."
        );
        events.push(await readProbeEvent(request, probeNonce));
        response.writeHead(204, headers);
        response.end();
        return;
      }
      invariant(request.method === "GET", "browser probe method가 허용되지 않습니다.");
      if (requestUrl.pathname === "/") {
        response.writeHead(200, {
          ...headers,
          "content-length": String(html.byteLength),
          "content-type": "text/html; charset=utf-8"
        });
        response.end(html);
        return;
      }
      if (requestUrl.pathname === "/probe.js") {
        response.writeHead(200, {
          ...headers,
          "content-length": String(javaScript.byteLength),
          "content-type": "text/javascript; charset=utf-8"
        });
        response.end(javaScript);
        return;
      }
      if (requestUrl.pathname === "/favicon.ico") {
        response.writeHead(204, headers);
        response.end();
        return;
      }
      response.writeHead(404, { ...headers, "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    })().catch((error: unknown) => {
      events.push(Object.freeze({
        kind: "error",
        error: `probe server rejected request: ${errorMessage(error).slice(0, 1_800)}`
      }));
      if (!response.headersSent) {
        response.writeHead(400, { connection: "close" });
      }
      response.end();
      request.destroy();
    });
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 2_000;
  server.maxHeadersCount = 64;
  return server;
}

function exactPairingUrl(value: unknown): string {
  invariant(typeof value === "string" && value.length > 0, "브라우저 pairing URL이 없습니다.");
  const request = parseLocalMediaEnginePairingRequest(value);
  invariant(
    localMediaEnginePairingUrl(request) === value,
    "브라우저 pairing URL이 canonical exact form이 아닙니다."
  );
  return value;
}

function assertProbeResult(
  result: BrowserProbeResult | null,
  phase: "paired" | "reconnected",
  expectedKeyId?: string
): string {
  invariant(result !== null, `browser ${phase} 결과가 없습니다.`);
  invariant(
    result.status === "ok"
      && result.origin === KIRINUKI_PUBLIC_STUDIO_ORIGIN
      && result.phase === phase
      && typeof result.keyId === "string"
      && /^[A-Za-z0-9_-]{43}$/u.test(result.keyId)
      && result.sessionCapabilityBytes === 43
      && result.sessionRenewed === (phase === "reconnected"),
    `browser ${phase} 결과가 signed/encrypted session 계약과 다릅니다: ${JSON.stringify(result)}`
  );
  if (expectedKeyId !== undefined) {
    invariant(result.keyId === expectedKeyId, "reload 뒤 고정된 engine identity가 바뀌었습니다.");
  }
  return result.keyId;
}

export async function runInstalledEngineBrowserSmoke({
  launchPairingUrl
}: InstalledEngineBrowserSmokeOptions): Promise<Readonly<InstalledEngineBrowserSmokeResult>> {
  const temporaryRoot = await mkdtemp(path.join(
    os.tmpdir(),
    "키리누키 installed-browser-사용자 "
  ));
  let driver: ManagedChild | null = null;
  let driverOutput = "";
  let sessionId = "";
  let server: HttpsServer | null = null;
  let primaryFailure: Error | null = null;
  try {
    const [javaScript, chromePath, chromeDriverPath, driverPort] = await Promise.all([
      browserBundle(),
      resolveExecutable("CHROMIUM_BINARY", [
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable"
      ]),
      resolveExecutable("CHROMEDRIVER_BINARY", ["chromedriver"]),
      reservePort()
    ]);
    const observedPaths: string[] = [];
    const probeEvents: BrowserProbeEvent[] = [];
    const probeNonce = randomBytes(32).toString("base64url");
    server = createProbeServer(javaScript, observedPaths, probeEvents, probeNonce);
    const publicPort = await listenLoopback(server);
    driver = spawn(chromeDriverPath, [`--port=${driverPort}`], {
      cwd: temporaryRoot,
      detached: false,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }) as ManagedChild;
    driver.stdout.on("data", (chunk: Buffer | string) => {
      driverOutput = appendOutput(driverOutput, chunk);
    });
    driver.stderr.on("data", (chunk: Buffer | string) => {
      driverOutput = appendOutput(driverOutput, chunk);
    });

    const webdriver = async <T = unknown>(
      method: string,
      commandPath: string,
      body?: unknown,
      timeoutMs = 30_000
    ): Promise<T> => {
      const payload = await fetchJson(
        `http://127.0.0.1:${driverPort}${commandPath}`,
        method,
        body,
        timeoutMs
      );
      invariant(isRecord(payload), `WebDriver 응답이 object가 아닙니다: ${commandPath}`);
      if (isRecord(payload.value) && payload.value.error) {
        throw new Error(
          `${String(payload.value.error)}: ${String(payload.value.message || "WebDriver 명령 실패")}`
        );
      }
      return payload.value as T;
    };
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (driver.exitCode !== null) {
        throw new Error(`ChromeDriver가 준비 전에 종료했습니다.\n${driverOutput}`);
      }
      try {
        const status = await webdriver<Record<string, unknown>>(
          "GET",
          "/status",
          undefined,
          1_000
        );
        if (status.ready === true) {
          break;
        }
      } catch {
        // Listener가 올라올 때까지만 bounded retry한다.
      }
      if (attempt === 99) {
        throw new Error(`ChromeDriver가 10초 안에 준비되지 않았습니다.\n${driverOutput}`);
      }
      await delay(100);
    }
    const profileRoot = path.join(temporaryRoot, "Chrome profile-사용자 이름");
    const created = await webdriver<WebDriverSession>("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          browserName: "chrome",
          // ChromeDriver's blocking NavigationTracker can race the first
          // renderer target swap on macOS. The smoke owns the stronger waits
          // below, so navigation itself must be non-blocking.
          pageLoadStrategy: "none",
          "goog:loggingPrefs": { browser: "ALL" },
          "goog:chromeOptions": {
            binary: chromePath,
            args: [
              "--headless=new",
              "--no-sandbox",
              "--disable-gpu",
              "--disable-dev-shm-usage",
              "--disable-background-networking",
              "--disable-component-update",
              "--disable-default-apps",
              "--disable-domain-reliability",
              "--disable-extensions",
              "--disable-sync",
              "--enable-features=LocalNetworkAccessChecks",
              "--ignore-certificate-errors",
              "--metrics-recording-only",
              "--no-default-browser-check",
              "--no-first-run",
              "--no-proxy-server",
              "--password-store=basic",
              "--use-mock-keychain",
              `--host-resolver-rules=MAP ${canonicalHost}:443 127.0.0.1:${publicPort},EXCLUDE localhost`,
              `--user-data-dir=${profileRoot}`
            ]
          }
        }
      }
    }, 45_000);
    invariant(typeof created.sessionId === "string" && created.sessionId, "WebDriver session ID가 없습니다.");
    sessionId = created.sessionId;

    let probeEventCursor = 0;
    const waitForNextProbeEvent = async (
      label: string,
      timeoutMs = 45_000
    ): Promise<BrowserProbeEvent> => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const event = probeEvents[probeEventCursor];
        if (event) {
          probeEventCursor += 1;
          if (event.kind === "error") {
            throw new Error(`브라우저 probe 실패: ${event.error}`);
          }
          return event;
        }
        invariant(driver?.exitCode === null, "ChromeDriver가 browser probe 중 종료했습니다.");
        await delay(100);
      }
      const summaries = probeEvents.map((event) => event.kind === "result"
        ? `${event.kind}:${String(event.result.phase || "unknown")}`
        : event.kind);
      throw new Error(
        `${label} 시간 제한을 초과했습니다: events=${JSON.stringify(summaries)} paths=${JSON.stringify(observedPaths)}`
      );
    };

    const grantedPermissions: string[] = [];
    for (const permissionName of ["local-network-access", "loopback-network"] as const) {
      try {
        await webdriver(
          "POST",
          `/session/${sessionId}/goog/cdp/execute`,
          {
            cmd: "Browser.setPermission",
            params: {
              permission: { name: permissionName },
              setting: "granted",
              origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN
            }
          }
        );
        grantedPermissions.push(permissionName);
      } catch {
        // Chrome version에 따라 legacy/split permission 중 하나만 존재한다.
      }
    }
    invariant(grantedPermissions.length >= 1, "Chrome LNA/loopback permission을 자동 확인하지 못했습니다.");
    // ChromeDriver 152 on macOS can acknowledge WebDriver navigation without
    // dispatching it, while Target.createTarget only proves target creation.
    // Select a fresh stable tab first, then use Page.navigate so the response
    // proves a cross-document navigation was accepted without waiting on
    // ChromeDriver's renderer NavigationTracker.
    const probeWindow = await webdriver<WebDriverWindowCreation>(
      "POST",
      `/session/${sessionId}/window/new`,
      { type: "tab" },
      10_000
    );
    invariant(
      typeof probeWindow.handle === "string"
        && probeWindow.handle.length >= 1
        && probeWindow.handle.length <= 512
        && probeWindow.type === "tab",
      "Chrome browser probe tab을 만들지 못했습니다."
    );
    await webdriver(
      "POST",
      `/session/${sessionId}/window`,
      { handle: probeWindow.handle },
      10_000
    );
    const selectedWindow = await webdriver<unknown>(
      "GET",
      `/session/${sessionId}/window`,
      undefined,
      10_000
    );
    invariant(
      selectedWindow === probeWindow.handle,
      "Chrome browser probe tab 선택을 readback하지 못했습니다."
    );
    const navigationOutcomePromise = webdriver<CdpPageNavigation>(
      "POST",
      `/session/${sessionId}/goog/cdp/execute`,
      {
        cmd: "Page.navigate",
        params: { url: `${KIRINUKI_PUBLIC_STUDIO_ORIGIN}/` }
      },
      10_000
    ).then((navigation) => {
      invariant(
        typeof navigation.frameId === "string"
          && navigation.frameId.length >= 1
          && navigation.frameId.length <= 256
          && typeof navigation.loaderId === "string"
          && navigation.loaderId.length >= 1
          && navigation.loaderId.length <= 256
          && navigation.errorText === undefined
          && navigation.isDownload !== true,
        `Chrome browser probe navigation이 거부되었습니다: ${JSON.stringify(navigation)}`
      );
      return { ok: true as const };
    }).catch((error: unknown) => ({ ok: false as const, error }));
    let requested: BrowserProbeEvent;
    try {
      requested = await waitForNextProbeEvent(
        "첫 설치 browser pairing request"
      );
    } catch (eventError) {
      const navigationOutcome = await navigationOutcomePromise;
      if (!navigationOutcome.ok) {
        throw new AggregateError(
          [navigationOutcome.error, eventError],
          "Chrome navigation과 실제 browser pairing request가 모두 실패했습니다."
        );
      }
      throw eventError;
    }
    // Page.navigate's callback can disappear during a renderer swap on macOS.
    // The nonce-bound HTTPS event is stronger proof that the exact document and
    // probe script loaded. navigationOutcomePromise always handles its own
    // rejection and is consulted only when no authoritative event arrives.
    invariant(requested.kind === "pairing", "첫 browser probe event가 pairing 요청이 아닙니다.");
    await launchPairingUrl(exactPairingUrl(requested.pairingUrl));
    const first = await waitForNextProbeEvent(
      "첫 설치 signed pairing/encrypted session"
    );
    invariant(first.kind === "result", "두 번째 browser probe event가 pairing 결과가 아닙니다.");
    const keyId = assertProbeResult(first.result, "paired");

    const second = await waitForNextProbeEvent(
      "브라우저 자체 새로고침 뒤 무재페어링 재연결"
    );
    invariant(second.kind === "result", "세 번째 browser probe event가 재연결 결과가 아닙니다.");
    assertProbeResult(second.result, "reconnected", keyId);
    await delay(250);
    invariant(
      probeEventCursor === 3 && probeEvents.length === 3,
      `browser probe event 순서/개수가 pairing→paired→reconnected와 다릅니다: ${JSON.stringify(probeEvents.map((event) => event.kind))}`
    );
    invariant(
      observedPaths.filter((entry) => entry === "/").length === 2
        && observedPaths.filter((entry) => entry === "/probe.js").length === 2
        && observedPaths.filter((entry) => entry === "/probe-event").length === 3
        && observedPaths.every((entry) => [
          "/",
          "/probe.js",
          "/probe-event",
          "/favicon.ico"
        ].includes(entry)),
      `browser probe HTTPS 요청이 exact two-load allowlist와 다릅니다: ${JSON.stringify(observedPaths)}`
    );
    return Object.freeze({
      browser: chromePath,
      driver: chromeDriverPath,
      keyId,
      origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      pairingLaunches: 1,
      sessions: 2,
      status: "ok"
    });
  } catch (error) {
    primaryFailure = new Error(
      `installed-engine browser smoke 실패: ${errorMessage(error)}`
        + (driverOutput.trim() ? `\nChromeDriver:\n${driverOutput.trim()}` : ""),
      { cause: error }
    );
  } finally {
    const cleanupErrors: Error[] = [];
    if (sessionId && driver) {
      try {
        await fetchJson(
          `http://127.0.0.1:${(driver.spawnargs.find((entry) => entry.startsWith("--port=")) || "").slice(7)}/session/${sessionId}`,
          "DELETE",
          undefined,
          3_000
        );
      } catch {
        // Driver termination below is the bounded fallback.
      }
    }
    if (driver) {
      try {
        await stopChild(driver);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error("ChromeDriver cleanup 실패"));
      }
    }
    if (server) {
      try {
        await closeServer(server);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error("HTTPS probe cleanup 실패"));
      }
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error("browser profile cleanup 실패"));
    }
    if (cleanupErrors.length > 0) {
      const cleanupFailure = new AggregateError(cleanupErrors, "browser smoke cleanup을 증명하지 못했습니다.");
      primaryFailure = primaryFailure
        ? new AggregateError([primaryFailure, cleanupFailure], "browser smoke와 cleanup이 모두 실패했습니다.")
        : cleanupFailure;
    }
  }
  throw primaryFailure ?? new Error("installed-engine browser smoke가 결과 없이 끝났습니다.");
}
