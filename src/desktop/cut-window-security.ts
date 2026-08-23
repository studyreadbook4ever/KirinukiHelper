const SOOP_EMBED_PATH = /^\/player\/\d{1,32}\/embed$/u;
const PARTITION_NONCE = /^[a-f0-9]{32}$/u;
const CUT_SHORTCUT_KEYS = new Set([
  "Q", "W", "E", "R", "T", "A", "D", "F", "Y", "U"
]);

export interface ExactStreamingFrameIdentity {
  readonly platform: "CHZZK" | "YOUTUBE" | "SOOP";
  readonly contentId: string;
}

export interface ElectronInputLike {
  readonly type?: unknown;
  readonly key?: unknown;
  readonly code?: unknown;
  readonly isAutoRepeat?: unknown;
  readonly isComposing?: unknown;
  readonly control?: unknown;
  readonly meta?: unknown;
  readonly alt?: unknown;
  readonly shift?: unknown;
}

export function createCutWindowPartitionName(
  generationValue: unknown,
  nonceValue: unknown
): string {
  const generation = Number(generationValue);
  const nonce = String(nonceValue || "");
  if (
    !Number.isSafeInteger(generation)
    || generation <= 0
    || !PARTITION_NONCE.test(nonce)
  ) {
    throw new TypeError("컷 창 임시 세션 식별자가 올바르지 않습니다.");
  }
  return `kirinuki-cut-window-${generation}-${nonce}`;
}

export function exactStreamingFrameIdentity(
  value: unknown
): Readonly<ExactStreamingFrameIdentity> | null {
  let url: URL;
  try {
    url = new URL(String(value || ""));
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || url.hash
  ) {
    return null;
  }
  const chzzkId = hostname === "chzzk.naver.com" && !url.search
    ? /^\/video\/(\d{1,32})\/?$/u.exec(url.pathname)?.[1]
    : undefined;
  if (chzzkId) {
    return Object.freeze({ platform: "CHZZK", contentId: chzzkId });
  }
  const youtubeId = hostname === "www.youtube-nocookie.com"
    && url.searchParams.size === 1
    && url.searchParams.get("playsinline") === "1"
    ? /^\/embed\/([A-Za-z0-9_-]{11})$/u.exec(url.pathname)?.[1]
    : undefined;
  if (youtubeId) {
    return Object.freeze({ platform: "YOUTUBE", contentId: youtubeId });
  }
  const entries = [...url.searchParams.entries()];
  const keys = entries.map(([key]) => key).sort().join(",");
  const soopId = hostname === "vod.sooplive.com"
    && SOOP_EMBED_PATH.test(url.pathname)
    && entries.length === 3
    && keys === "autoPlay,mutePlay,showChat"
    && url.searchParams.get("autoPlay") === "true"
    && url.searchParams.get("mutePlay") === "true"
    && url.searchParams.get("showChat") === "false"
    ? /^\/player\/(\d{1,32})\/embed$/u.exec(url.pathname)?.[1]
    : undefined;
  return soopId
    ? Object.freeze({ platform: "SOOP", contentId: soopId })
    : null;
}

export function exactCutWindowExternalSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const canonical = canonicalSupportedVodSourceUrl(value);
  return canonical === value ? canonical : null;
}

export function trustedCutShortcutKey({
  input,
  focusedFrameUrl,
  mainFrameFocused
}: {
  readonly input: Readonly<ElectronInputLike>;
  readonly focusedFrameUrl: unknown;
  readonly mainFrameFocused: boolean;
}): string | null {
  const physicalKey = /^Key([A-Z])$/u.exec(String(input.code || ""))?.[1];
  if (
    mainFrameFocused
    || input.type !== "keyDown"
    || input.isAutoRepeat === true
    || input.isComposing === true
    || input.control === true
    || input.meta === true
    || input.alt === true
    || input.shift === true
    || !exactStreamingFrameIdentity(focusedFrameUrl)
    || !physicalKey
    || !CUT_SHORTCUT_KEYS.has(physicalKey)
  ) {
    return null;
  }
  return physicalKey;
}

export async function loadExactCutWindowDocumentFailClosed({
  load,
  currentUrl,
  expectedUrl,
  isDestroyed,
  destroy
}: {
  readonly load: () => Promise<void>;
  readonly currentUrl: () => string;
  readonly expectedUrl: string;
  readonly isDestroyed: () => boolean;
  readonly destroy: () => void;
}): Promise<void> {
  try {
    await load();
    if (isDestroyed() || currentUrl() !== expectedUrl) {
      throw new Error("컷 창이 허용된 시작 문서에서 열리지 않았습니다.");
    }
  } catch (error) {
    if (!isDestroyed()) {
      destroy();
    }
    throw error;
  }
}

/**
 * An acknowledged handoff is a privileged terminal transition. Electron's
 * regular `close()` path can be cancelled by the remote document's
 * `beforeunload` handler, so this path deliberately requires the synchronous,
 * non-cancellable `destroy()` primitive and verifies its postcondition.
 */
export function destroyAcknowledgedCutWindow({
  isDestroyed,
  destroy
}: {
  readonly isDestroyed: () => boolean;
  readonly destroy: () => void;
}): void {
  if (isDestroyed()) {
    return;
  }
  destroy();
  if (!isDestroyed()) {
    throw new Error("인계가 끝난 컷 창을 확실히 닫지 못했습니다.");
  }
}

export function settleCutWindowHandoffBeforeDocumentReset({
  status,
  cancel,
  destroyAcknowledged
}: {
  readonly status: () => "pending" | "claimed" | "acknowledged" | "absent";
  readonly cancel: () => boolean;
  readonly destroyAcknowledged: () => void;
}): "acknowledged" | "cancelled" {
  if (status() === "acknowledged") {
    destroyAcknowledged();
    return "acknowledged";
  }
  cancel();
  // status() and cancel() share the synchronous in-process broker. If ACK won
  // immediately before cancellation, cancel is false and this second read
  // observes its tombstone; if cancellation won, a later ACK cannot succeed.
  if (status() === "acknowledged") {
    destroyAcknowledged();
    return "acknowledged";
  }
  return "cancelled";
}

export function shouldRejectCutWindowNavigation({
  url,
  expectedUrl,
  isMainFrame
}: {
  readonly url: unknown;
  readonly expectedUrl: string;
  readonly isMainFrame: boolean;
}): boolean {
  return isMainFrame && url !== expectedUrl;
}

export function shouldRejectDirectCutFrameNavigation({
  url,
  expectedMainUrl,
  isMainFrame,
  isDirectChild
}: {
  readonly url: unknown;
  readonly expectedMainUrl: string;
  readonly isMainFrame: boolean;
  readonly isDirectChild: boolean;
}): boolean {
  if (isMainFrame) {
    return url !== expectedMainUrl;
  }
  if (!isDirectChild || url === "about:blank") {
    return false;
  }
  return exactStreamingFrameIdentity(url) === null;
}
import { canonicalSupportedVodSourceUrl } from "../lib/source-embed.js";
