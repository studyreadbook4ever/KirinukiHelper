import { randomBytes, webcrypto } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  open,
  unlink
} from "node:fs/promises";
import path from "node:path";

import {
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  decodeBase64Url,
  encodeBase64Url,
  exactBase64UrlBytes,
  localMediaEnginePublicKeyId,
  verifyLocalMediaEngineSignature
} from "../lib/local-media-engine-auth.js";
import { preparePrivateDirectories } from "./private-directory.js";
import type { DesktopPlatform } from "./runtime-spec.js";

const DESKTOP_DEVICE_IDENTITY_SCHEMA =
  "kirinuki-local-media-engine/device-identity-v1" as const;
const DESKTOP_DEVICE_IDENTITY_FILE = "device-identity-v1.json";
const MAX_DEVICE_IDENTITY_BYTES = 16 * 1024;

export interface DesktopDeviceIdentityProtector {
  readonly protect: (plainText: string) => Promise<Uint8Array>;
  readonly unprotect: (protectedBytes: Uint8Array) => Promise<string>;
}

export interface DesktopDeviceIdentity {
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly sign: (transcript: Uint8Array) => Promise<string>;
}

/** Deterministic race-injection seam used by the security regression suite. */
export interface DesktopDeviceIdentityFileHooks {
  readonly afterInitialLstat?: (filePath: string) => Promise<void>;
  readonly afterReadBeforeRestat?: (filePath: string) => Promise<void>;
  readonly beforePublish?: (filePath: string) => Promise<void>;
}

interface StoredDesktopDeviceIdentity {
  readonly schema: typeof DESKTOP_DEVICE_IDENTITY_SCHEMA;
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly protectedPrivateKey: string;
}

function missingPath(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

function exactStoredIdentity(value: unknown): StoredDesktopDeviceIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",")
      !== "algorithm,keyId,protectedPrivateKey,publicKeySpki,schema"
    || record.schema !== DESKTOP_DEVICE_IDENTITY_SCHEMA
    || record.algorithm !== LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM
    || !exactBase64UrlBytes(record.keyId, 32)
    || typeof record.publicKeySpki !== "string"
    || (decodeBase64Url(record.publicKeySpki)?.byteLength ?? 0) < 80
    || (decodeBase64Url(record.publicKeySpki)?.byteLength ?? 0) > 160
    || typeof record.protectedPrivateKey !== "string"
    || (decodeBase64Url(record.protectedPrivateKey)?.byteLength ?? 0) < 64
    || (decodeBase64Url(record.protectedPrivateKey)?.byteLength ?? 0)
      > MAX_DEVICE_IDENTITY_BYTES
  ) {
    return null;
  }
  return {
    schema: DESKTOP_DEVICE_IDENTITY_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId: record.keyId,
    publicKeySpki: record.publicKeySpki,
    protectedPrivateKey: record.protectedPrivateKey
  };
}

async function readStoredIdentity(
  filePath: string,
  hooks: Readonly<DesktopDeviceIdentityFileHooks>
): Promise<unknown | null> {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (missingPath(error)) {
      return null;
    }
    throw error;
  }
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size <= 0
    || metadata.size > MAX_DEVICE_IDENTITY_BYTES
  ) {
    throw new Error("로컬 엔진 device identity 파일이 안전한 regular file이 아닙니다.");
  }
  await hooks.afterInitialLstat?.(filePath);
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat();
    if (metadata.dev !== before.dev || metadata.ino !== before.ino) {
      throw new Error("로컬 엔진 device identity 파일이 여는 동안 바뀌었습니다.");
    }
    const text = await handle.readFile({ encoding: "utf8" });
    await hooks.afterReadBeforeRestat?.(filePath);
    const after = await handle.stat();
    const pathAfter = await lstat(filePath);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || !pathAfter.isFile()
      || pathAfter.isSymbolicLink()
      || pathAfter.dev !== after.dev
      || pathAfter.ino !== after.ino
      || text.length === 0
      || Buffer.byteLength(text, "utf8") > MAX_DEVICE_IDENTITY_BYTES
    ) {
      throw new Error("로컬 엔진 device identity 파일이 읽는 동안 바뀌었습니다.");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("로컬 엔진 device identity 파일이 손상되었습니다.");
    }
  } finally {
    await handle.close();
  }
}

async function writeNewIdentity(
  filePath: string,
  value: StoredDesktopDeviceIdentity,
  platform: DesktopPlatform,
  hooks: Readonly<DesktopDeviceIdentityFileHooks>
): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${randomBytes(12).toString("hex")}`;
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > MAX_DEVICE_IDENTITY_BYTES) {
    throw new Error("로컬 엔진 device identity 파일이 허용 크기를 넘습니다.");
  }
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Same-directory hard-link publication is atomic and fails with EEXIST;
    // unlike rename(), it can never replace an identity that appeared after
    // generation began in another process.
    await hooks.beforePublish?.(filePath);
    await link(temporaryPath, filePath);
    await unlink(temporaryPath);
    if (platform !== "win32") {
      await chmod(filePath, 0o600);
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function importIdentity(
  stored: StoredDesktopDeviceIdentity,
  protector: Readonly<DesktopDeviceIdentityProtector>
): Promise<DesktopDeviceIdentity> {
  const publicKeyId = await localMediaEnginePublicKeyId(stored.publicKeySpki);
  if (publicKeyId !== stored.keyId) {
    throw new Error("로컬 엔진 device identity 공개키 지문이 다릅니다.");
  }
  const protectedBytes = decodeBase64Url(stored.protectedPrivateKey)!;
  let privateKeyBytes: Uint8Array;
  try {
    const privateKeyText = await protector.unprotect(protectedBytes);
    const decoded = decodeBase64Url(privateKeyText);
    if (!decoded || decoded.byteLength < 100 || decoded.byteLength > 256) {
      throw new Error("invalid-private-key");
    }
    privateKeyBytes = decoded;
  } catch {
    throw new Error("운영체제 보호 저장소에서 로컬 엔진 identity를 열지 못했습니다.");
  } finally {
    protectedBytes.fill(0);
  }
  let privateKey: CryptoKey;
  try {
    privateKey = await webcrypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  } finally {
    privateKeyBytes.fill(0);
  }
  const sign = async (transcript: Uint8Array): Promise<string> => {
    if (!(transcript instanceof Uint8Array) || transcript.byteLength === 0) {
      throw new TypeError("로컬 엔진 identity 서명 transcript가 비어 있습니다.");
    }
    const signature = new Uint8Array(await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      transcript
    ));
    if (signature.byteLength !== 64) {
      throw new Error("로컬 엔진 identity 서명 길이가 올바르지 않습니다.");
    }
    return encodeBase64Url(signature);
  };
  const selfTest = new TextEncoder().encode(
    "kirinuki-local-media-engine/device-identity-self-test-v1"
  );
  const selfSignature = await sign(selfTest);
  if (!await verifyLocalMediaEngineSignature({
    publicKeySpki: stored.publicKeySpki,
    signature: selfSignature,
    transcript: selfTest
  })) {
    throw new Error("로컬 엔진 device identity 개인키와 공개키가 다릅니다.");
  }
  return Object.freeze({
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId: stored.keyId,
    publicKeySpki: stored.publicKeySpki,
    sign
  });
}

async function createStoredIdentity(
  protector: Readonly<DesktopDeviceIdentityProtector>
): Promise<StoredDesktopDeviceIdentity> {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const [publicKey, privateKey] = await Promise.all([
    webcrypto.subtle.exportKey("spki", keyPair.publicKey),
    webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  ]);
  const publicKeySpki = encodeBase64Url(new Uint8Array(publicKey));
  const keyId = await localMediaEnginePublicKeyId(publicKeySpki);
  if (!keyId) {
    throw new Error("로컬 엔진 device identity 공개키를 만들지 못했습니다.");
  }
  const privateBytes = new Uint8Array(privateKey);
  let protectedPrivateKey: Uint8Array;
  try {
    protectedPrivateKey = await protector.protect(encodeBase64Url(privateBytes));
  } finally {
    privateBytes.fill(0);
  }
  if (
    !(protectedPrivateKey instanceof Uint8Array)
    || protectedPrivateKey.byteLength < 64
    || protectedPrivateKey.byteLength > MAX_DEVICE_IDENTITY_BYTES
  ) {
    protectedPrivateKey.fill(0);
    throw new Error("운영체제 보호 저장소가 올바른 identity 값을 반환하지 않았습니다.");
  }
  const encodedProtectedPrivateKey = encodeBase64Url(protectedPrivateKey);
  protectedPrivateKey.fill(0);
  return Object.freeze({
    schema: DESKTOP_DEVICE_IDENTITY_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId,
    publicKeySpki,
    protectedPrivateKey: encodedProtectedPrivateKey
  });
}

export async function loadOrCreateDesktopDeviceIdentity({
  stateRoot,
  platform,
  protector,
  fileHooks = {}
}: {
  readonly stateRoot: string;
  readonly platform: DesktopPlatform;
  readonly protector: Readonly<DesktopDeviceIdentityProtector>;
  readonly fileHooks?: Readonly<DesktopDeviceIdentityFileHooks>;
}): Promise<DesktopDeviceIdentity> {
  if (
    !path.isAbsolute(stateRoot)
    || stateRoot.trim() !== stateRoot
    || /[\u0000-\u001f\u007f]/u.test(stateRoot)
    || typeof protector?.protect !== "function"
    || typeof protector?.unprotect !== "function"
  ) {
    throw new TypeError("로컬 엔진 device identity 저장 경계가 올바르지 않습니다.");
  }
  preparePrivateDirectories([
    { path: stateRoot, label: "앱 데이터" }
  ], { platform });
  const identityPath = path.join(stateRoot, DESKTOP_DEVICE_IDENTITY_FILE);
  const existing = await readStoredIdentity(identityPath, fileHooks);
  if (existing !== null) {
    const stored = exactStoredIdentity(existing);
    if (!stored) {
      throw new Error("로컬 엔진 device identity 파일 형식이 손상되었습니다.");
    }
    return importIdentity(stored, protector);
  }
  const created = await createStoredIdentity(protector);
  await writeNewIdentity(identityPath, created, platform, fileHooks);
  return importIdentity(created, protector);
}
