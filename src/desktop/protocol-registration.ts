export interface DesktopProtocolClientApplication {
  readonly isDefaultProtocolClient: (scheme: string) => boolean;
  readonly setAsDefaultProtocolClient: (scheme: string) => boolean;
  readonly removeAsDefaultProtocolClient?: (scheme: string) => boolean;
}

export type DesktopProtocolRegistrationResult =
  | "already-registered"
  | "registered"
  | "skipped-isolated-smoke";

export type DesktopProtocolRemovalResult =
  | "already-absent"
  | "removed"
  | "skipped-isolated-smoke";

function safeScheme(value: string): string {
  if (!/^[a-z][a-z0-9+.-]{1,63}$/u.test(value)) {
    throw new TypeError("desktop custom protocol scheme이 올바르지 않습니다.");
  }
  return value;
}

/** Removes only the exact scheme currently owned by this Electron app. */
export function removeDesktopProtocolRegistration({
  application,
  scheme,
  isolatedSmoke
}: {
  readonly application: Readonly<DesktopProtocolClientApplication>;
  readonly scheme: string;
  readonly isolatedSmoke: boolean;
}): DesktopProtocolRemovalResult {
  const verifiedScheme = safeScheme(scheme);
  if (isolatedSmoke) {
    return "skipped-isolated-smoke";
  }
  if (!application.isDefaultProtocolClient(verifiedScheme)) {
    return "already-absent";
  }
  if (
    typeof application.removeAsDefaultProtocolClient !== "function"
    || !application.removeAsDefaultProtocolClient(verifiedScheme)
  ) {
    throw new Error("Kirinuki 엔진 연결 프로토콜을 운영체제에서 제거하지 못했습니다.");
  }
  if (application.isDefaultProtocolClient(verifiedScheme)) {
    throw new Error("Kirinuki 엔진 연결 프로토콜 제거를 운영체제에서 확인하지 못했습니다.");
  }
  return "removed";
}

/**
 * Makes protocol setup idempotent: an existing registration is preserved,
 * a missing registration is attempted once, and success is accepted only
 * after an independent OS readback.
 */
export function ensureDesktopProtocolRegistration({
  application,
  scheme,
  isolatedSmoke
}: {
  readonly application: Readonly<DesktopProtocolClientApplication>;
  readonly scheme: string;
  readonly isolatedSmoke: boolean;
}): DesktopProtocolRegistrationResult {
  const verifiedScheme = safeScheme(scheme);
  if (isolatedSmoke) {
    return "skipped-isolated-smoke";
  }
  if (application.isDefaultProtocolClient(verifiedScheme)) {
    return "already-registered";
  }
  if (!application.setAsDefaultProtocolClient(verifiedScheme)) {
    throw new Error("Kirinuki 엔진 연결 프로토콜을 운영체제에 등록하지 못했습니다.");
  }
  if (!application.isDefaultProtocolClient(verifiedScheme)) {
    throw new Error("Kirinuki 엔진 연결 프로토콜 등록을 운영체제에서 확인하지 못했습니다.");
  }
  return "registered";
}
