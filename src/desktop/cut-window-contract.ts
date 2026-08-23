import { KIRINUKI_PUBLIC_STUDIO_ORIGIN } from "../lib/local-runtime-origin.js";
import { parseStreamingBridgeRequest } from "../web/streaming-bridge-protocol.js";
import type { StreamingBridgeRequest } from "../web/streaming-bridge-protocol.js";

export const CUT_WINDOW_SURFACE_PARAMETER = "kirinukiSurface" as const;
export const CUT_WINDOW_SURFACE_VALUE = "cut-host" as const;
export const CUT_WINDOW_HANDOFF_CHANNEL =
  "kirinuki:cut-window:handoff-editor" as const;
export const CUT_WINDOW_BIND_DOCUMENT_CHANNEL =
  "kirinuki:cut-window:bind-document" as const;
export const CUT_WINDOW_SHORTCUT_CHANNEL =
  "kirinuki:cut-window:trusted-shortcut" as const;
export const CUT_WINDOW_PLAYER_ACTION_CHANNEL =
  "kirinuki:cut-window:player-action" as const;
export const CUT_WINDOW_OPEN_SOURCE_CHANNEL =
  "kirinuki:cut-window:open-canonical-source" as const;

export const CUT_WINDOW_URL = `${KIRINUKI_PUBLIC_STUDIO_ORIGIN}/?${
  new URLSearchParams({
    [CUT_WINDOW_SURFACE_PARAMETER]: CUT_WINDOW_SURFACE_VALUE
  })
}` as const;

export const CUT_WINDOW_PLAYER_ACTION_MAXIMUM_BYTES = 64 * 1024;

export type CutWindowPlayerActionEnvelope =
  | Readonly<{
    readonly type: "invalidate";
    readonly transportEpoch: number;
  }>
  | Readonly<{
    readonly type: "request";
    readonly transportEpoch: number;
    readonly documentGeneration: number;
    readonly request: Readonly<StreamingBridgeRequest>;
  }>;

export function normalizeCutWindowPlayerActionEnvelope(
  value: unknown
): Readonly<CutWindowPlayerActionEnvelope> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const transportEpoch = Number(record.transportEpoch);
  if (!Number.isSafeInteger(transportEpoch) || transportEpoch <= 0) {
    return null;
  }
  let normalized: Readonly<CutWindowPlayerActionEnvelope> | null = null;
  if (
    record.type === "invalidate"
    && Object.keys(record).sort().join(",") === "transportEpoch,type"
  ) {
    normalized = Object.freeze({ type: "invalidate", transportEpoch });
  } else if (
    record.type === "request"
    && Object.keys(record).sort().join(",")
      === "documentGeneration,request,transportEpoch,type"
    && Number.isSafeInteger(record.documentGeneration)
    && Number(record.documentGeneration) > 0
  ) {
    const request = parseStreamingBridgeRequest(record.request);
    if (request) {
      normalized = Object.freeze({
        type: "request",
        transportEpoch,
        documentGeneration: Number(record.documentGeneration),
        request
      });
    }
  }
  if (!normalized) {
    return null;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(normalized)).byteLength
      <= CUT_WINDOW_PLAYER_ACTION_MAXIMUM_BYTES
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export interface CutWindowHandoffResult {
  readonly status: "acknowledged";
  readonly handoffGeneration: number;
}

export interface TrustedCutShortcutMessage {
  readonly key: string;
  readonly platform: "CHZZK" | "YOUTUBE" | "SOOP";
  readonly contentId: string;
  readonly windowGeneration: number;
  readonly documentGeneration: number;
  readonly transportEpoch: number;
  readonly bridgeGeneration: number;
}

export function normalizeTrustedCutShortcutMessage(
  value: unknown
): Readonly<TrustedCutShortcutMessage> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const platform = record.platform;
  const contentId = record.contentId;
  const contentIdValid = platform === "YOUTUBE"
    ? typeof contentId === "string" && /^[A-Za-z0-9_-]{11}$/u.test(contentId)
    : typeof contentId === "string" && /^\d{1,32}$/u.test(contentId);
  if (
    Object.keys(record).sort().join(",")
      !== "bridgeGeneration,contentId,documentGeneration,key,platform,transportEpoch,windowGeneration"
    || typeof record.key !== "string"
    || !/^[QWERTADFYU]$/u.test(record.key)
    || !["CHZZK", "YOUTUBE", "SOOP"].includes(String(platform))
    || !contentIdValid
    || !Number.isSafeInteger(record.windowGeneration)
    || Number(record.windowGeneration) <= 0
    || !Number.isSafeInteger(record.transportEpoch)
    || Number(record.transportEpoch) <= 0
    || !Number.isSafeInteger(record.documentGeneration)
    || Number(record.documentGeneration) <= 0
    || !Number.isSafeInteger(record.bridgeGeneration)
    || Number(record.bridgeGeneration) <= 0
  ) {
    return null;
  }
  return Object.freeze({
    key: record.key,
    platform,
    contentId,
    windowGeneration: Number(record.windowGeneration),
    documentGeneration: Number(record.documentGeneration),
    transportEpoch: Number(record.transportEpoch),
    bridgeGeneration: Number(record.bridgeGeneration)
  } as TrustedCutShortcutMessage);
}

export interface CutWindowHostApi {
  readonly handoffEditor: (
    submission: unknown
  ) => Promise<Readonly<CutWindowHandoffResult>>;
  readonly onTrustedShortcut: (
    listener: (message: Readonly<TrustedCutShortcutMessage>) => void
  ) => () => void;
  readonly playerAction: (request: unknown) => Promise<unknown>;
  readonly openCanonicalSource: (sourceUrl: unknown) => Promise<void>;
}

export function isExactCutWindowUrl(value: unknown): boolean {
  return typeof value === "string" && value === CUT_WINDOW_URL;
}
