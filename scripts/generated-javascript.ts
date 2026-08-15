/**
 * Shared provenance marker for generated browser JavaScript.
 *
 * This module deliberately has no dependency on either browser target so the
 * localhost web build never imports legacy Extension tooling.
 */
export const GENERATED_JAVASCRIPT_BANNER =
  "// Generated from TypeScript sources. Do not edit directly.";
