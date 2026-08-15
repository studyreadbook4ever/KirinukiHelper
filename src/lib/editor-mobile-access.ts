export interface EditorClientSignals {
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  readonly userAgentDataMobile?: boolean;
  /** Deliberately ignored: a narrow desktop window is still a desktop editor. */
  readonly viewportWidth?: number;
  /** Deliberately ignored: touch-enabled Windows laptops remain supported. */
  readonly coarsePointer?: boolean;
}

const MOBILE_USER_AGENT_PATTERN = /(?:android|iphone|ipad|ipod|mobile|webos|blackberry|iemobile|opera mini)/iu;

export function shouldBlockEditorOnClient(
  signals: EditorClientSignals
): boolean {
  if (signals.userAgentDataMobile === true) {
    return true;
  }
  const userAgent = String(signals.userAgent || "");
  if (MOBILE_USER_AGENT_PATTERN.test(userAgent)) {
    return true;
  }
  // iPadOS desktop-mode Safari reports Macintosh/MacIntel. Multi-touch is the
  // stable discriminator; viewport width would incorrectly reject desktop
  // windows and touch-capable Windows PCs.
  return (
    /macintosh/iu.test(userAgent)
    || String(signals.platform || "").toLowerCase() === "macintel"
  ) && Number(signals.maxTouchPoints) > 1;
}

export function currentClientCannotUseEditor(): boolean {
  const navigatorWithUserAgentData = navigator as Navigator & {
    readonly userAgentData?: { readonly mobile?: boolean };
  };
  const userAgentDataMobile = navigatorWithUserAgentData.userAgentData?.mobile;
  return shouldBlockEditorOnClient({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    ...(typeof userAgentDataMobile === "boolean"
      ? { userAgentDataMobile }
      : {})
  });
}
