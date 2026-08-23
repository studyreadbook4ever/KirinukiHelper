import { contextBridge, ipcRenderer } from "electron";

import {
  EDITOR_HANDOFF_MAXIMUM_BYTES,
  normalizeEditorHandoffSubmission
} from "../lib/editor-handoff.js";
import { exactCutWindowExternalSourceUrl } from "./cut-window-security.js";

import {
  CUT_WINDOW_BIND_DOCUMENT_CHANNEL,
  CUT_WINDOW_HANDOFF_CHANNEL,
  CUT_WINDOW_OPEN_SOURCE_CHANNEL,
  CUT_WINDOW_PLAYER_ACTION_CHANNEL,
  CUT_WINDOW_SHORTCUT_CHANNEL,
  normalizeCutWindowPlayerActionEnvelope,
  normalizeTrustedCutShortcutMessage
} from "./cut-window-contract.js";

function freshDocumentNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  let bits = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      result += alphabet[(bits >>> bitCount) & 63];
    }
  }
  if (bitCount > 0) {
    result += alphabet[(bits << (6 - bitCount)) & 63];
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(result)) {
    throw new Error("컷 문서 nonce를 안전하게 만들지 못했습니다.");
  }
  return result;
}

let activeTrustedHandoffTicket: symbol | null = null;

function requireActiveUserGesture(operation: string): void {
  if (globalThis.navigator.userActivation?.isActive !== true) {
    throw new Error(`${operation}은 사용자가 직접 누른 동작에서만 실행할 수 있습니다.`);
  }
}

function consumeHandoffAuthorization(): void {
  if (globalThis.navigator.userActivation?.isActive === true) {
    activeTrustedHandoffTicket = null;
    return;
  }
  if (activeTrustedHandoffTicket === null) {
    throw new Error(
      "편집기 열기는 직접 누르거나 검증된 A 단축키로만 실행할 수 있습니다."
    );
  }
  activeTrustedHandoffTicket = null;
}

const documentNonce = freshDocumentNonce();
interface BoundCutDocument {
  windowGeneration: number;
  documentGeneration: number;
}
let boundDocument: Readonly<BoundCutDocument> | null = null;
let documentBindingPromise: Promise<Readonly<BoundCutDocument>> | null = null;

function bindCurrentDocument(): Promise<Readonly<BoundCutDocument>> {
  if (documentBindingPromise) {
    return documentBindingPromise;
  }
  const attemptBinding = async (): Promise<Readonly<BoundCutDocument>> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const value: unknown = await ipcRenderer.invoke(
          CUT_WINDOW_BIND_DOCUMENT_CHANNEL,
          documentNonce
        );
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("컷 문서 binding 응답이 없습니다.");
        }
        const record = value as Record<string, unknown>;
        if (
          Object.keys(record).sort().join(",")
            !== "documentGeneration,status,windowGeneration"
          || record.status !== "bound"
          || !Number.isSafeInteger(record.windowGeneration)
          || Number(record.windowGeneration) <= 0
          || !Number.isSafeInteger(record.documentGeneration)
          || Number(record.documentGeneration) <= 0
        ) {
          throw new Error("컷 문서 binding 응답이 올바르지 않습니다.");
        }
        boundDocument = Object.freeze({
          windowGeneration: Number(record.windowGeneration),
          documentGeneration: Number(record.documentGeneration)
        });
        return boundDocument;
      } catch (error) {
        lastError = error;
        if (attempt < 4) {
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
      }
    }
    throw lastError;
  };
  const pending = attemptBinding();
  documentBindingPromise = pending;
  void pending.catch(() => {
    if (documentBindingPromise === pending) {
      documentBindingPromise = null;
      boundDocument = null;
    }
  });
  return pending;
}
import type {
  CutWindowHandoffResult,
  CutWindowHostApi,
  TrustedCutShortcutMessage
} from "./cut-window-contract.js";

const api: CutWindowHostApi = Object.freeze({
  handoffEditor: async (
  submission: unknown
  ): Promise<Readonly<CutWindowHandoffResult>> => {
    consumeHandoffAuthorization();
    await bindCurrentDocument();
    const normalized = normalizeEditorHandoffSubmission(submission);
    if (
      new TextEncoder().encode(JSON.stringify(normalized)).byteLength
        > EDITOR_HANDOFF_MAXIMUM_BYTES
    ) {
      throw new TypeError("편집기 인계 데이터가 너무 큽니다.");
    }
    const result = await ipcRenderer.invoke(
      CUT_WINDOW_HANDOFF_CHANNEL,
      normalized,
      documentNonce
    ) as CutWindowHandoffResult;
    if (
      !result
      || result.status !== "acknowledged"
      || !Number.isSafeInteger(result.handoffGeneration)
      || result.handoffGeneration <= 0
    ) {
      throw new Error("편집기 인계 완료 응답이 올바르지 않습니다.");
    }
    return Object.freeze({
      status: "acknowledged",
      handoffGeneration: result.handoffGeneration
    });
  },
  playerAction: async (request: unknown): Promise<unknown> => {
    await bindCurrentDocument();
    const normalized = normalizeCutWindowPlayerActionEnvelope(request);
    if (!normalized) {
      throw new TypeError("원본 플레이어 동작 요청이 올바르지 않습니다.");
    }
    return ipcRenderer.invoke(
      CUT_WINDOW_PLAYER_ACTION_CHANNEL,
      normalized,
      documentNonce
    );
  },
  openCanonicalSource: async (sourceUrl: unknown): Promise<void> => {
    requireActiveUserGesture("원본 페이지 열기");
    await bindCurrentDocument();
    const canonicalSourceUrl = exactCutWindowExternalSourceUrl(sourceUrl);
    if (!canonicalSourceUrl) {
      throw new TypeError("지원하는 canonical VOD 원본 주소가 아닙니다.");
    }
    const result: unknown = await ipcRenderer.invoke(
      CUT_WINDOW_OPEN_SOURCE_CHANNEL,
      canonicalSourceUrl,
      documentNonce
    );
    if (
      !result
      || typeof result !== "object"
      || Array.isArray(result)
      || Object.keys(result).sort().join(",") !== "sourceUrl,status"
      || (result as Record<string, unknown>).status !== "opened"
      || (result as Record<string, unknown>).sourceUrl !== canonicalSourceUrl
    ) {
      throw new Error("원본 페이지 열기 응답이 올바르지 않습니다.");
    }
  },
  onTrustedShortcut: (
    listener: (message: Readonly<TrustedCutShortcutMessage>) => void
  ): (() => void) => {
    if (typeof listener !== "function") {
      throw new TypeError("컷 단축키 listener가 함수가 아닙니다.");
    }
    let disposed = false;
    const receive = (_event: unknown, value: unknown): void => {
      const message = normalizeTrustedCutShortcutMessage(value);
      if (
        message
        && boundDocument
        && message.windowGeneration === boundDocument.windowGeneration
        && message.documentGeneration === boundDocument.documentGeneration
      ) {
        const ticket = message.key === "A" ? Symbol("trusted-A") : null;
        if (ticket) {
          activeTrustedHandoffTicket = ticket;
        }
        try {
          listener(message);
        } finally {
          if (ticket && activeTrustedHandoffTicket === ticket) {
            activeTrustedHandoffTicket = null;
          }
        }
      }
    };
    void bindCurrentDocument().then(() => {
      if (!disposed) {
        ipcRenderer.on(CUT_WINDOW_SHORTCUT_CHANNEL, receive);
      }
    }).catch(() => undefined);
    return () => {
      disposed = true;
      ipcRenderer.removeListener(CUT_WINDOW_SHORTCUT_CHANNEL, receive);
    };
  }
});

contextBridge.exposeInMainWorld("kirinukiCutHost", api);
