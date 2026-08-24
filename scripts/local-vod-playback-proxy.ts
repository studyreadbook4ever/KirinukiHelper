import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import {
  LOCAL_VOD_PLAYBACK_SESSION_SCHEMA
} from "../src/lib/local-vod-playback.js";
import {
  assertExternalVodTransferUrl,
  fetchExternalVodPlaylist,
  fetchExternalVodResponse,
  safeExternalVodRequestHeaders
} from "./external-vod-transfer.js";
import type {
  ExternalVodTransferPlatform
} from "./external-vod-transfer.js";
import type {
  ResolvedLocalVodPlayback,
  ResolvedLocalVodPlaybackPart
} from "./local-vod-playback-resolver.js";

const SESSION_TTL_MS = 30 * 60 * 1_000;
const MAXIMUM_SESSIONS = 8;
const MAXIMUM_RESOURCES_PER_SESSION = 100_000;

interface PlaybackResource {
  readonly platform: ExternalVodTransferPlatform;
  readonly url: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
}

interface PlaybackPartState {
  readonly resolved: ResolvedLocalVodPlaybackPart;
  manifest: string | null;
  readonly resources: Map<string, PlaybackResource>;
  readonly resourceKeyByUrl: Map<string, string>;
}

interface PlaybackSessionState {
  readonly accessToken: string;
  readonly resolved: ResolvedLocalVodPlayback;
  readonly parts: readonly PlaybackPartState[];
  expiresAt: number;
  resourceCount: number;
}

export type LocalVodPlaybackResolver = (
  sourceUrl: string,
  signal?: AbortSignal
) => Promise<ResolvedLocalVodPlayback>;

function writeText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string
): void {
  const bytes = Buffer.from(body, "utf8");
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", String(bytes.byteLength));
  response.setHeader("cross-origin-resource-policy", "cross-origin");
  response.end(bytes);
}

function sessionPartUrl(accessToken: string, index: number): string {
  return `http://127.0.0.1:4319/v1/playback/${accessToken}/part/${index}/index.m3u8`;
}

function resourceUrl(accessToken: string, key: string): string {
  return `http://127.0.0.1:4319/v1/playback/${accessToken}/resource/${key}`;
}

function exactRangeHeader(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = String(value);
  return /^bytes=\d+-\d*$/u.test(normalized) ? normalized : undefined;
}

export function createLocalVodPlaybackProxy({
  resolvePlayback,
  fetchImpl = globalThis.fetch,
  randomBytesImpl = randomBytes,
  now = Date.now
}: {
  readonly resolvePlayback: LocalVodPlaybackResolver;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly randomBytesImpl?: typeof randomBytes;
  readonly now?: () => number;
}) {
  const sessions = new Map<string, PlaybackSessionState>();
  const prune = (): void => {
    const timestamp = now();
    for (const [token, session] of sessions) {
      if (timestamp >= session.expiresAt) {
        sessions.delete(token);
      }
    }
  };
  const freshToken = (): string => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = randomBytesImpl(32).toString("base64url");
      if (/^[A-Za-z0-9_-]{43}$/u.test(token) && !sessions.has(token)) {
        return token;
      }
    }
    throw new Error("로컬 원본 재생 session을 만들지 못했습니다.");
  };
  const requireSession = (token: string): PlaybackSessionState | null => {
    prune();
    const session = sessions.get(token) || null;
    if (session) {
      session.expiresAt = now() + SESSION_TTL_MS;
    }
    return session;
  };
  const createSession = async (
    sourceUrl: string,
    signal?: AbortSignal
  ): Promise<Readonly<Record<string, unknown>>> => {
    prune();
    if (sessions.size >= MAXIMUM_SESSIONS) {
      throw new Error("활성 원본 재생 session이 너무 많습니다.");
    }
    const resolved = await resolvePlayback(sourceUrl, signal);
    const accessToken = freshToken();
    const parts = resolved.parts.map((part) => ({
      resolved: part,
      manifest: null,
      resources: new Map<string, PlaybackResource>(),
      resourceKeyByUrl: new Map<string, string>()
    }));
    const session: PlaybackSessionState = {
      accessToken,
      resolved,
      parts,
      expiresAt: now() + SESSION_TTL_MS,
      resourceCount: 0
    };
    sessions.set(accessToken, session);
    let startSeconds = 0;
    return Object.freeze({
      schema: LOCAL_VOD_PLAYBACK_SESSION_SCHEMA,
      platform: resolved.platform,
      contentId: resolved.contentId,
      sourceUrl: resolved.sourceUrl,
      durationSeconds: resolved.durationSeconds,
      parts: Object.freeze(resolved.parts.map((part, index) => {
        const partStart = startSeconds;
        const partEnd = partStart + part.durationSeconds;
        startSeconds = partEnd;
        return Object.freeze({
          index,
          startSeconds: partStart,
          endSeconds: partEnd,
          manifestUrl: sessionPartUrl(accessToken, index)
        });
      }))
    });
  };
  const registerResource = (
    session: PlaybackSessionState,
    part: PlaybackPartState,
    rawUrl: string,
    baseUrl: string
  ): string => {
    const url = assertExternalVodTransferUrl(
      session.resolved.platform,
      new URL(rawUrl, baseUrl)
    ).href;
    const existing = part.resourceKeyByUrl.get(url);
    if (existing) {
      return resourceUrl(session.accessToken, existing);
    }
    if (session.resourceCount >= MAXIMUM_RESOURCES_PER_SESSION) {
      throw new Error("원본 HLS 조각 수가 안전 상한을 넘습니다.");
    }
    const key = session.resourceCount.toString(36);
    session.resourceCount += 1;
    part.resourceKeyByUrl.set(url, key);
    part.resources.set(key, Object.freeze({
      platform: session.resolved.platform,
      url,
      requestHeaders: part.resolved.requestHeaders
    }));
    return resourceUrl(session.accessToken, key);
  };
  const rewrittenManifest = async (
    session: PlaybackSessionState,
    part: PlaybackPartState,
    signal?: AbortSignal
  ): Promise<string> => {
    if (part.manifest !== null) {
      return part.manifest;
    }
    const fetched = await fetchExternalVodPlaylist({
      platform: session.resolved.platform,
      url: part.resolved.manifestUrl,
      requestHeaders: part.resolved.requestHeaders,
      fetchImpl,
      ...(signal ? { signal } : {})
    });
    const lines = fetched.text.split(/\r?\n/u);
    if (lines[0] !== "#EXTM3U") {
      throw new Error("원본 HLS 재생목록 표식이 없습니다.");
    }
    const rewritten = lines.map((line) => {
      if (/^#EXT-X-KEY:(?!.*(?:^|,)METHOD=NONE(?:,|$))/u.test(line)) {
        throw new Error("암호화된 HLS 원본은 로컬 재생 경계에서 지원하지 않습니다.");
      }
      if (!line || line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/gu, (_match, uri: string) => (
          `URI="${registerResource(session, part, uri, fetched.finalUrl)}"`
        ));
      }
      return registerResource(session, part, line, fetched.finalUrl);
    }).join("\n");
    part.manifest = rewritten.endsWith("\n") ? rewritten : `${rewritten}\n`;
    return part.manifest;
  };
  const serveManifest = async ({
    accessToken,
    partIndex,
    request,
    response
  }: {
    readonly accessToken: string;
    readonly partIndex: number;
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<boolean> => {
    const session = requireSession(accessToken);
    const part = session?.parts[partIndex];
    if (!session || !part || request.method !== "GET") {
      return false;
    }
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    const manifest = await rewrittenManifest(session, part, controller.signal);
    writeText(response, 200, "application/vnd.apple.mpegurl; charset=utf-8", manifest);
    return true;
  };
  const serveResource = async ({
    accessToken,
    resourceKey,
    request,
    response
  }: {
    readonly accessToken: string;
    readonly resourceKey: string;
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<boolean> => {
    const session = requireSession(accessToken);
    const resource = session?.parts
      .map((part) => part.resources.get(resourceKey))
      .find((candidate) => candidate !== undefined);
    if (!session || !resource || request.method !== "GET") {
      return false;
    }
    const range = exactRangeHeader(request.headers.range);
    if (request.headers.range !== undefined && range === undefined) {
      return false;
    }
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    const fetched = await fetchExternalVodResponse({
      platform: resource.platform,
      url: resource.url,
      headers: safeExternalVodRequestHeaders({
        ...resource.requestHeaders,
        ...(range ? { range } : {})
      }),
      fetchImpl,
      signal: controller.signal
    });
    const upstream = fetched.response;
    response.statusCode = upstream.status;
    response.setHeader("cache-control", "no-store");
    response.setHeader("cross-origin-resource-policy", "cross-origin");
    for (const name of [
      "accept-ranges",
      "content-length",
      "content-range",
      "content-type",
      "etag",
      "last-modified"
    ]) {
      const value = upstream.headers.get(name);
      if (value !== null) {
        response.setHeader(name, value);
      }
    }
    if (!upstream.body) {
      response.end();
      return true;
    }
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        if (chunk.value.byteLength > 0 && !response.write(Buffer.from(chunk.value))) {
          await once(response, "drain");
        }
      }
      response.end();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return true;
  };
  const removeSession = (accessToken: string): boolean => (
    sessions.delete(accessToken)
  );
  const shutdown = (): void => {
    sessions.clear();
  };
  return Object.freeze({
    createSession,
    removeSession,
    serveManifest,
    serveResource,
    shutdown,
    get sessionCount() {
      prune();
      return sessions.size;
    }
  });
}
