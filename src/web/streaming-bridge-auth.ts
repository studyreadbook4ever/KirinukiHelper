import {
  STREAMING_BRIDGE_RESPONSE,
  STREAMING_BRIDGE_SHORTCUT,
  parseStreamingBridgeRequest,
  parseStreamingBridgeResponse,
  parseStreamingBridgeShortcutMessage
} from "./streaming-bridge-protocol.js";
import type {
  StreamingBridgeRequest,
  StreamingBridgeResponse,
  StreamingBridgeShortcutMessage
} from "./streaming-bridge-protocol.js";

export const STREAMING_BRIDGE_AUTH_PROTOCOL =
  "kirinuki-streaming-bridge-auth/v1";
export const STREAMING_BRIDGE_STUDIO_REQUEST =
  "KIRINUKI_STREAMING_BRIDGE_STUDIO_REQUEST";
export const STREAMING_BRIDGE_FRAME_REQUEST =
  "KIRINUKI_STREAMING_BRIDGE_FRAME_REQUEST";
export const STREAMING_BRIDGE_FRAME_DELIVERY =
  "KIRINUKI_STREAMING_BRIDGE_FRAME_DELIVERY";
export const STREAMING_BRIDGE_STUDIO_DELIVERY =
  "KIRINUKI_STREAMING_BRIDGE_STUDIO_DELIVERY";
export const STREAMING_BRIDGE_STUDIO_FRAME_ID = "stream-preview-frame";
export const STREAMING_BRIDGE_CHANNEL_STORAGE_PREFIX =
  "kirinuki-streaming-channel:";

const STREAMING_BRIDGE_CHANNEL_SCHEMA =
  "kirinuki-streaming-channel/v1";
const CHANNEL_BYTES = 32;
const CHANNEL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const AUTH_TAG_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CHANNEL_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const CHANNEL_RENEWAL_WINDOW_MS = 60 * 60 * 1_000;

type UnknownRecord = Record<string, unknown>;
type AuthenticatedInnerMessage =
  | StreamingBridgeResponse
  | StreamingBridgeShortcutMessage;

export interface StreamingBridgeStudioRequest {
  readonly protocol: typeof STREAMING_BRIDGE_AUTH_PROTOCOL;
  readonly type: typeof STREAMING_BRIDGE_STUDIO_REQUEST;
  readonly targetOrigin: "https://chzzk.naver.com" | "https://www.youtube-nocookie.com";
  readonly frameId: typeof STREAMING_BRIDGE_STUDIO_FRAME_ID;
  readonly inner: StreamingBridgeRequest;
}

export interface StreamingBridgeFrameRequest {
  readonly protocol: typeof STREAMING_BRIDGE_AUTH_PROTOCOL;
  readonly type: typeof STREAMING_BRIDGE_FRAME_REQUEST;
  readonly channelId: string;
  readonly studioOrigin: string;
  readonly targetOrigin: StreamingBridgeStudioRequest["targetOrigin"];
  readonly inner: StreamingBridgeRequest;
  readonly authTag: string;
}

export interface StreamingBridgeFrameDelivery {
  readonly protocol: typeof STREAMING_BRIDGE_AUTH_PROTOCOL;
  readonly type: typeof STREAMING_BRIDGE_FRAME_DELIVERY;
  readonly channelId: string;
  readonly studioOrigin: string;
  readonly targetOrigin: StreamingBridgeStudioRequest["targetOrigin"];
  readonly inner: AuthenticatedInnerMessage;
  readonly authTag: string;
}

export interface StreamingBridgeStudioDelivery {
  readonly protocol: typeof STREAMING_BRIDGE_AUTH_PROTOCOL;
  readonly type: typeof STREAMING_BRIDGE_STUDIO_DELIVERY;
  readonly targetOrigin: StreamingBridgeStudioRequest["targetOrigin"];
  readonly inner: AuthenticatedInnerMessage;
}

export interface StreamingBridgeChannelRecord {
  readonly schema: typeof STREAMING_BRIDGE_CHANNEL_SCHEMA;
  readonly channelId: string;
  readonly studioOrigin: string;
  readonly key: string;
  readonly expiresAt: number;
}

export interface ExtensionLocalStorageArea {
  readonly get: (
    keys?: string | readonly string[] | null
  ) => Promise<Record<string, unknown>>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
  readonly remove: (keys: string | readonly string[]) => Promise<void>;
}

export interface StreamingBridgeCrypto {
  readonly getRandomValues: <T extends ArrayBufferView>(array: T) => T;
  readonly subtle: SubtleCrypto;
}

export interface StudioStreamingRelayOptions {
  readonly allowedStudioOrigins: readonly string[];
  readonly hostWindow?: Window;
  readonly hostDocument?: Document;
  readonly storageArea?: ExtensionLocalStorageArea;
  readonly cryptoImpl?: StreamingBridgeCrypto;
  readonly now?: () => number;
  /** Test seam; production must use the default native `event.isTrusted`. */
  readonly isTrustedMessageEvent?: (event: MessageEvent<unknown>) => boolean;
}

export interface AuthenticatedContentTransportOptions {
  readonly allowedParentOrigins: readonly string[];
  readonly hostWindow?: Window;
  readonly storageArea?: ExtensionLocalStorageArea;
  readonly cryptoImpl?: StreamingBridgeCrypto;
  readonly now?: () => number;
  /** Test seam; production must use the default native `event.isTrusted`. */
  readonly isTrustedMessageEvent?: (event: MessageEvent<unknown>) => boolean;
}

export interface AuthenticatedStreamingBridgeContentTransport {
  readonly subscribe: (
    listener: (message: unknown, origin: string) => void
  ) => () => void;
  readonly send: (
    message: AuthenticatedInnerMessage,
    targetOrigin: string
  ) => Promise<void>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function exactGenericTargetOrigin(
  value: unknown
): StreamingBridgeStudioRequest["targetOrigin"] | null {
  return value === "https://chzzk.naver.com"
    || value === "https://www.youtube-nocookie.com"
    ? value
    : null;
}

function exactAllowedStudioOrigin(
  value: unknown,
  allowedOrigins: ReadonlySet<string>
): string | null {
  if (typeof value !== "string" || !allowedOrigins.has(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopback = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  return value === url.origin
    && (loopback || url.protocol === "https:")
    && !url.username
    && !url.password
    ? value
    : null;
}

function normalizedInnerDelivery(
  value: unknown
): AuthenticatedInnerMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === STREAMING_BRIDGE_RESPONSE) {
    return parseStreamingBridgeResponse(value);
  }
  if (value.type === STREAMING_BRIDGE_SHORTCUT) {
    return parseStreamingBridgeShortcutMessage(value);
  }
  return null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!CHANNEL_TOKEN_PATTERN.test(value)) {
    return null;
  }
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=";
  try {
    const binary = atob(padded);
    if (binary.length !== CHANNEL_BYTES) {
      return null;
    }
    const bytes = new Uint8Array(CHANNEL_BYTES);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function randomToken(cryptoImpl: StreamingBridgeCrypto): string {
  return bytesToBase64Url(
    cryptoImpl.getRandomValues(new Uint8Array(CHANNEL_BYTES))
  );
}

function storageKey(channelId: string): string {
  return `${STREAMING_BRIDGE_CHANNEL_STORAGE_PREFIX}${channelId}`;
}

function extensionLocalStorage(): ExtensionLocalStorageArea {
  const candidate = (globalThis as {
    readonly chrome?: {
      readonly storage?: {
        readonly local?: ExtensionLocalStorageArea;
      };
    };
  }).chrome?.storage?.local;
  if (
    !candidate
    || typeof candidate.get !== "function"
    || typeof candidate.set !== "function"
    || typeof candidate.remove !== "function"
  ) {
    throw new Error("Kirinuki Player Bridge 저장소를 사용할 수 없습니다.");
  }
  return candidate;
}

function webCrypto(): StreamingBridgeCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Kirinuki Player Bridge WebCrypto를 사용할 수 없습니다.");
  }
  return globalThis.crypto;
}

function normalizeChannelRecord(
  value: unknown,
  channelId: string,
  studioOrigin: string,
  now: number
): StreamingBridgeChannelRecord | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "schema", "channelId", "studioOrigin", "key", "expiresAt"
    ])
    || value.schema !== STREAMING_BRIDGE_CHANNEL_SCHEMA
    || value.channelId !== channelId
    || value.studioOrigin !== studioOrigin
    || typeof value.key !== "string"
    || !base64UrlToBytes(value.key)
    || typeof value.expiresAt !== "number"
    || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= now
  ) {
    return null;
  }
  return {
    schema: STREAMING_BRIDGE_CHANNEL_SCHEMA,
    channelId,
    studioOrigin,
    key: value.key,
    expiresAt: value.expiresAt
  };
}

async function importHmacKey(
  encodedKey: string,
  cryptoImpl: StreamingBridgeCrypto
): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(encodedKey);
  if (!bytes) {
    throw new TypeError("Kirinuki Player Bridge 채널 키가 올바르지 않습니다.");
  }
  return cryptoImpl.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function authenticatedPayload(
  type: typeof STREAMING_BRIDGE_FRAME_REQUEST
    | typeof STREAMING_BRIDGE_FRAME_DELIVERY,
  channelId: string,
  studioOrigin: string,
  targetOrigin: StreamingBridgeStudioRequest["targetOrigin"],
  inner: StreamingBridgeRequest | AuthenticatedInnerMessage
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({
    protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
    type,
    channelId,
    studioOrigin,
    targetOrigin,
    inner
  }));
}

async function signPayload(
  payload: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  cryptoImpl: StreamingBridgeCrypto
): Promise<string> {
  const signature = await cryptoImpl.subtle.sign("HMAC", key, payload);
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyPayload(
  payload: Uint8Array<ArrayBuffer>,
  authTag: string,
  key: CryptoKey,
  cryptoImpl: StreamingBridgeCrypto
): Promise<boolean> {
  const signature = base64UrlToBytes(authTag);
  if (!signature) {
    return false;
  }
  return cryptoImpl.subtle.verify(
    "HMAC",
    key,
    signature,
    payload
  );
}

export function createStreamingBridgeStudioRequest(
  request: StreamingBridgeRequest,
  targetOrigin: unknown
): StreamingBridgeStudioRequest {
  const inner = parseStreamingBridgeRequest(request);
  const origin = exactGenericTargetOrigin(targetOrigin);
  if (!inner || !origin) {
    throw new TypeError("인증 스트리밍 브리지 요청이 올바르지 않습니다.");
  }
  return {
    protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
    type: STREAMING_BRIDGE_STUDIO_REQUEST,
    targetOrigin: origin,
    frameId: STREAMING_BRIDGE_STUDIO_FRAME_ID,
    inner
  };
}

export function parseStreamingBridgeStudioRequest(
  value: unknown
): StreamingBridgeStudioRequest | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "protocol", "type", "targetOrigin", "frameId", "inner"
    ])
    || value.protocol !== STREAMING_BRIDGE_AUTH_PROTOCOL
    || value.type !== STREAMING_BRIDGE_STUDIO_REQUEST
    || value.frameId !== STREAMING_BRIDGE_STUDIO_FRAME_ID
  ) {
    return null;
  }
  const targetOrigin = exactGenericTargetOrigin(value.targetOrigin);
  const inner = parseStreamingBridgeRequest(value.inner);
  return targetOrigin && inner
    ? {
      protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
      type: STREAMING_BRIDGE_STUDIO_REQUEST,
      targetOrigin,
      frameId: STREAMING_BRIDGE_STUDIO_FRAME_ID,
      inner
    }
    : null;
}

export function parseStreamingBridgeStudioDelivery(
  value: unknown
): StreamingBridgeStudioDelivery | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["protocol", "type", "targetOrigin", "inner"])
    || value.protocol !== STREAMING_BRIDGE_AUTH_PROTOCOL
    || value.type !== STREAMING_BRIDGE_STUDIO_DELIVERY
  ) {
    return null;
  }
  const targetOrigin = exactGenericTargetOrigin(value.targetOrigin);
  const inner = normalizedInnerDelivery(value.inner);
  return targetOrigin && inner
    ? {
      protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
      type: STREAMING_BRIDGE_STUDIO_DELIVERY,
      targetOrigin,
      inner
    }
    : null;
}

function parseAuthenticatedEnvelope(
  value: unknown,
  expectedType: typeof STREAMING_BRIDGE_FRAME_REQUEST
): StreamingBridgeFrameRequest | null;
function parseAuthenticatedEnvelope(
  value: unknown,
  expectedType: typeof STREAMING_BRIDGE_FRAME_DELIVERY
): StreamingBridgeFrameDelivery | null;
function parseAuthenticatedEnvelope(
  value: unknown,
  expectedType: typeof STREAMING_BRIDGE_FRAME_REQUEST
    | typeof STREAMING_BRIDGE_FRAME_DELIVERY
): StreamingBridgeFrameRequest | StreamingBridgeFrameDelivery | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "protocol", "type", "channelId", "studioOrigin", "targetOrigin",
      "inner", "authTag"
    ])
    || value.protocol !== STREAMING_BRIDGE_AUTH_PROTOCOL
    || value.type !== expectedType
    || typeof value.channelId !== "string"
    || !CHANNEL_TOKEN_PATTERN.test(value.channelId)
    || typeof value.studioOrigin !== "string"
    || typeof value.authTag !== "string"
    || !AUTH_TAG_PATTERN.test(value.authTag)
  ) {
    return null;
  }
  const targetOrigin = exactGenericTargetOrigin(value.targetOrigin);
  const inner = expectedType === STREAMING_BRIDGE_FRAME_REQUEST
    ? parseStreamingBridgeRequest(value.inner)
    : normalizedInnerDelivery(value.inner);
  return targetOrigin && inner
    ? {
      protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
      type: expectedType,
      channelId: value.channelId,
      studioOrigin: value.studioOrigin,
      targetOrigin,
      inner,
      authTag: value.authTag
    } as StreamingBridgeFrameRequest | StreamingBridgeFrameDelivery
    : null;
}

async function authenticatedFrameRequest(
  studioRequest: StreamingBridgeStudioRequest,
  channel: StreamingBridgeChannelRecord,
  key: CryptoKey,
  cryptoImpl: StreamingBridgeCrypto
): Promise<StreamingBridgeFrameRequest> {
  const common = {
    protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
    type: STREAMING_BRIDGE_FRAME_REQUEST,
    channelId: channel.channelId,
    studioOrigin: channel.studioOrigin,
    targetOrigin: studioRequest.targetOrigin,
    inner: studioRequest.inner
  } as const;
  return {
    ...common,
    authTag: await signPayload(
      authenticatedPayload(
        common.type,
        common.channelId,
        common.studioOrigin,
        common.targetOrigin,
        common.inner
      ),
      key,
      cryptoImpl
    )
  };
}

export async function createStreamingBridgeFrameDelivery(
  innerValue: AuthenticatedInnerMessage,
  channel: StreamingBridgeChannelRecord,
  targetOriginValue: unknown,
  key: CryptoKey,
  cryptoImpl: StreamingBridgeCrypto = webCrypto()
): Promise<StreamingBridgeFrameDelivery> {
  const inner = normalizedInnerDelivery(innerValue);
  const targetOrigin = exactGenericTargetOrigin(targetOriginValue);
  if (!inner || !targetOrigin) {
    throw new TypeError("인증 스트리밍 브리지 응답이 올바르지 않습니다.");
  }
  const common = {
    protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
    type: STREAMING_BRIDGE_FRAME_DELIVERY,
    channelId: channel.channelId,
    studioOrigin: channel.studioOrigin,
    targetOrigin,
    inner
  } as const;
  return {
    ...common,
    authTag: await signPayload(
      authenticatedPayload(
        common.type,
        common.channelId,
        common.studioOrigin,
        common.targetOrigin,
        common.inner
      ),
      key,
      cryptoImpl
    )
  };
}

export async function importStreamingBridgeChannelKey(
  channel: StreamingBridgeChannelRecord,
  cryptoImpl: StreamingBridgeCrypto = webCrypto()
): Promise<CryptoKey> {
  return importHmacKey(channel.key, cryptoImpl);
}

function frameElementForRequest(
  hostDocument: Document,
  request: StreamingBridgeStudioRequest
): { readonly contentWindow: Window; readonly origin: string } | null {
  const element = hostDocument.getElementById(request.frameId);
  const frame = element as (HTMLElement & {
    readonly contentWindow?: Window | null;
    readonly src?: string;
  }) | null;
  if (
    !frame
    || frame.tagName.toUpperCase() !== "IFRAME"
    || !frame.isConnected
    || !frame.contentWindow
  ) {
    return null;
  }
  let source: URL;
  try {
    source = new URL(String(frame.getAttribute("src") || frame.src || ""),
      hostDocument.baseURI);
  } catch {
    return null;
  }
  return source.origin === request.targetOrigin
    ? { contentWindow: frame.contentWindow, origin: source.origin }
    : null;
}

function currentFrameStillMatches(
  hostDocument: Document,
  expectedWindow: Window,
  expectedOrigin: StreamingBridgeStudioRequest["targetOrigin"]
): boolean {
  const element = hostDocument.getElementById(STREAMING_BRIDGE_STUDIO_FRAME_ID);
  const frame = element as (HTMLElement & {
    readonly contentWindow?: Window | null;
    readonly src?: string;
  }) | null;
  if (
    !frame
    || frame.tagName.toUpperCase() !== "IFRAME"
    || !frame.isConnected
    || frame.contentWindow !== expectedWindow
  ) {
    return false;
  }
  try {
    return new URL(
      String(frame.getAttribute("src") || frame.src || ""),
      hostDocument.baseURI
    ).origin === expectedOrigin;
  } catch {
    return false;
  }
}

async function pruneExpiredStreamingBridgeChannels(
  storageArea: ExtensionLocalStorageArea,
  now: number
): Promise<void> {
  const values = await storageArea.get(null);
  const staleKeys = Object.entries(values).flatMap(([key, value]) => {
    if (!key.startsWith(STREAMING_BRIDGE_CHANNEL_STORAGE_PREFIX)) {
      return [];
    }
    const record = isRecord(value) ? value : null;
    return !record
      || record.schema !== STREAMING_BRIDGE_CHANNEL_SCHEMA
      || typeof record.channelId !== "string"
      || key !== storageKey(record.channelId)
      || !CHANNEL_TOKEN_PATTERN.test(record.channelId)
      || typeof record.expiresAt !== "number"
      || !Number.isSafeInteger(record.expiresAt)
      || record.expiresAt <= now
      ? [key]
      : [];
  });
  if (staleKeys.length > 0) {
    await storageArea.remove(staleKeys);
  }
}

/**
 * Runs only in the isolated top-frame content-script world. The page can ask
 * for a player operation, but only this relay can read the HMAC key and turn a
 * verified iframe delivery back into a same-window Studio delivery.
 */
export async function installAuthenticatedStudioStreamingRelay({
  allowedStudioOrigins,
  hostWindow = window,
  hostDocument = document,
  storageArea = extensionLocalStorage(),
  cryptoImpl = webCrypto(),
  now = Date.now,
  isTrustedMessageEvent = (event) => event.isTrusted
}: StudioStreamingRelayOptions): Promise<() => void> {
  const origins = new Set(allowedStudioOrigins);
  const studioOrigin = exactAllowedStudioOrigin(
    hostWindow.location.origin,
    origins
  );
  if (!studioOrigin || hostWindow.parent !== hostWindow) {
    return () => undefined;
  }
  const channelId = randomToken(cryptoImpl);
  const keyBytes = cryptoImpl.getRandomValues(new Uint8Array(CHANNEL_BYTES));
  const encodedKey = bytesToBase64Url(keyBytes);
  let channel: StreamingBridgeChannelRecord = {
    schema: STREAMING_BRIDGE_CHANNEL_SCHEMA,
    channelId,
    studioOrigin,
    key: encodedKey,
    expiresAt: now() + CHANNEL_LIFETIME_MS
  };
  const key = await importHmacKey(encodedKey, cryptoImpl);
  let persistedExpiresAt = 0;
  let disposed = false;
  let activeFrame: {
    readonly contentWindow: Window;
    readonly origin: StreamingBridgeStudioRequest["targetOrigin"];
  } | null = null;

  const persistChannel = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    if (channel.expiresAt - now() <= CHANNEL_RENEWAL_WINDOW_MS) {
      channel = { ...channel, expiresAt: now() + CHANNEL_LIFETIME_MS };
    }
    if (persistedExpiresAt !== channel.expiresAt) {
      await storageArea.set({ [storageKey(channelId)]: channel });
      persistedExpiresAt = channel.expiresAt;
    }
  };
  await pruneExpiredStreamingBridgeChannels(storageArea, now());
  await persistChannel();

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || !isTrustedMessageEvent(event)) {
      return;
    }
    if (event.source === hostWindow && event.origin === studioOrigin) {
      const request = parseStreamingBridgeStudioRequest(event.data);
      if (!request) {
        return;
      }
      void persistChannel().then(async () => {
        const frame = frameElementForRequest(hostDocument, request);
        if (!frame || disposed) {
          return;
        }
        activeFrame = {
          contentWindow: frame.contentWindow,
          origin: request.targetOrigin
        };
        const authenticated = await authenticatedFrameRequest(
          request,
          channel,
          key,
          cryptoImpl
        );
        if (
          !disposed
          && activeFrame?.contentWindow === frame.contentWindow
          && activeFrame.origin === request.targetOrigin
        ) {
          frame.contentWindow.postMessage(authenticated, request.targetOrigin);
        }
      }).catch(() => {
        // Storage, frame replacement, or WebCrypto failure is fail-closed. The
        // app's bounded request timeout exposes the unavailable bridge.
      });
      return;
    }

    const delivery = parseAuthenticatedEnvelope(
      event.data,
      STREAMING_BRIDGE_FRAME_DELIVERY
    );
    const frame = activeFrame;
    if (
      !delivery
      || !frame
      || event.source !== frame.contentWindow
      || event.origin !== frame.origin
      || delivery.channelId !== channelId
      || delivery.studioOrigin !== studioOrigin
      || delivery.targetOrigin !== frame.origin
      || !currentFrameStillMatches(
        hostDocument,
        frame.contentWindow,
        frame.origin
      )
    ) {
      return;
    }
    void verifyPayload(
      authenticatedPayload(
        delivery.type,
        delivery.channelId,
        delivery.studioOrigin,
        delivery.targetOrigin,
        delivery.inner
      ),
      delivery.authTag,
      key,
      cryptoImpl
    ).then((verified) => {
      if (!verified || disposed || activeFrame !== frame) {
        return;
      }
      const studioDelivery: StreamingBridgeStudioDelivery = {
        protocol: STREAMING_BRIDGE_AUTH_PROTOCOL,
        type: STREAMING_BRIDGE_STUDIO_DELIVERY,
        targetOrigin: delivery.targetOrigin,
        inner: delivery.inner
      };
      hostWindow.postMessage(studioDelivery, studioOrigin);
    }).catch(() => {
      // Invalid or unverifiable iframe messages never cross into the app.
    });
  };

  const cleanupChannel = (): void => {
    persistedExpiresAt = 0;
    void storageArea.remove(storageKey(channelId)).catch(() => undefined);
  };
  hostWindow.addEventListener("message", onMessage);
  hostWindow.addEventListener("pagehide", cleanupChannel, { once: true });
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    activeFrame = null;
    hostWindow.removeEventListener("message", onMessage);
    hostWindow.removeEventListener("pagehide", cleanupChannel);
    cleanupChannel();
  };
}

/**
 * Platform-frame side of the authenticated channel. Unsigned messages never
 * reach the player endpoint, and every response/shortcut carries an HMAC that
 * only the top-frame isolated relay can verify.
 */
export function createAuthenticatedStreamingBridgeContentTransport({
  allowedParentOrigins,
  hostWindow = window,
  storageArea = extensionLocalStorage(),
  cryptoImpl = webCrypto(),
  now = Date.now,
  isTrustedMessageEvent = (event) => event.isTrusted
}: AuthenticatedContentTransportOptions): AuthenticatedStreamingBridgeContentTransport {
  const origins = new Set(allowedParentOrigins);
  const parentWindow = hostWindow.parent;
  let disposed = false;
  let activeChannel: {
    readonly record: StreamingBridgeChannelRecord;
    readonly key: CryptoKey;
    readonly targetOrigin: StreamingBridgeStudioRequest["targetOrigin"];
  } | null = null;
  const cachedChannels = new Map<string, {
    readonly record: StreamingBridgeChannelRecord;
    readonly key: CryptoKey;
  }>();

  const loadChannel = async (
    request: StreamingBridgeFrameRequest
  ): Promise<{ readonly record: StreamingBridgeChannelRecord; readonly key: CryptoKey } | null> => {
    const cached = cachedChannels.get(request.channelId);
    if (
      cached
      && cached.record.studioOrigin === request.studioOrigin
      && cached.record.expiresAt > now()
    ) {
      return cached;
    }
    cachedChannels.delete(request.channelId);
    const keyName = storageKey(request.channelId);
    const values = await storageArea.get(keyName);
    const record = normalizeChannelRecord(
      values[keyName],
      request.channelId,
      request.studioOrigin,
      now()
    );
    if (!record) {
      return null;
    }
    const key = await importHmacKey(record.key, cryptoImpl);
    const result = { record, key };
    cachedChannels.set(request.channelId, result);
    return result;
  };

  return {
    subscribe(listener): () => void {
      if (parentWindow === hostWindow) {
        return () => undefined;
      }
      const onMessage = (event: MessageEvent<unknown>): void => {
        if (
          disposed
          || !isTrustedMessageEvent(event)
          || event.source !== parentWindow
          || !origins.has(event.origin)
        ) {
          return;
        }
        const request = parseAuthenticatedEnvelope(
          event.data,
          STREAMING_BRIDGE_FRAME_REQUEST
        );
        if (
          !request
          || request.studioOrigin !== event.origin
          || request.targetOrigin !== hostWindow.location.origin
        ) {
          return;
        }
        void loadChannel(request).then(async (channel) => {
          if (!channel || disposed) {
            return;
          }
          const verified = await verifyPayload(
            authenticatedPayload(
              request.type,
              request.channelId,
              request.studioOrigin,
              request.targetOrigin,
              request.inner
            ),
            request.authTag,
            channel.key,
            cryptoImpl
          );
          if (!verified || disposed) {
            return;
          }
          activeChannel = {
            ...channel,
            targetOrigin: request.targetOrigin
          };
          listener(request.inner, event.origin);
        }).catch(() => {
          // Missing, expired, or malformed channel records fail closed.
        });
      };
      hostWindow.addEventListener("message", onMessage);
      return () => {
        hostWindow.removeEventListener("message", onMessage);
        disposed = true;
        activeChannel = null;
        cachedChannels.clear();
      };
    },
    async send(message, targetOrigin): Promise<void> {
      const channel = activeChannel;
      if (
        disposed
        || !channel
        || channel.record.studioOrigin !== targetOrigin
        || channel.record.expiresAt <= now()
        || channel.targetOrigin !== hostWindow.location.origin
      ) {
        return;
      }
      const delivery = await createStreamingBridgeFrameDelivery(
        message,
        channel.record,
        channel.targetOrigin,
        channel.key,
        cryptoImpl
      );
      if (!disposed && activeChannel === channel) {
        parentWindow.postMessage(delivery, targetOrigin);
      }
    }
  };
}
