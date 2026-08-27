export type CutPreparationRecoveryKind =
  | "reconnect"
  | "update"
  | "source"
  | "retry";

function errorCodeValue(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

/** Returns only a stable public code; messages, URLs, paths and stacks stay out. */
export function safeCutPreparationErrorCode(error: unknown): string {
  const raw = errorCodeValue(error);
  return typeof raw === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(raw)
    ? raw
    : "UNEXPECTED_FAILURE";
}

export function cutPreparationRecoveryKind(
  code: string
): CutPreparationRecoveryKind {
  if (["ENGINE_UNAVAILABLE", "ENGINE_UNPAIRED"].includes(code)) {
    return "reconnect";
  }
  if (
    code === "TOOL_NOT_INSTALLED"
    || code === "ENGINE_INCOMPATIBLE"
    || /(?:RUNTIME|VERSION)/u.test(code)
  ) {
    return "update";
  }
  if (
    code === "SOURCE_CLOCK_VERIFICATION_FAILED"
    || /SOURCE|VOD_UNAVAILABLE/u.test(code)
  ) {
    return "source";
  }
  return "retry";
}
