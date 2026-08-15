import { canonicalSupportedVodSourceUrl } from "./source-embed.js";

export const KIRINUKI_DEEP_LINK = "kirinuki://open";

export interface KirinukiDeepLinkRequest {
  readonly sourceUrl: string | null;
}

export function validateSourceUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new TypeError(
      "CHZZK·YouTube·SOOP의 단일 공개 완료 VOD HTTPS URL을 입력하세요."
    );
  }
  if (raw.length > 2_048 || /[\0-\x1f\x7f]/u.test(raw)) {
    throw new TypeError("영상 URL에 허용되지 않는 제어 문자나 길이가 있습니다.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("올바른 HTTPS 영상 URL을 입력하세요.");
  }
  const rawAuthority = raw.startsWith("https://")
    ? raw.slice("https://".length).split(/[/?#]/u, 1)[0] ?? ""
    : "";
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
    || parsed.hostname.endsWith(".")
    || rawAuthority.toLowerCase() !== parsed.hostname.toLowerCase()
  ) {
    throw new TypeError(
      "원본 URL에는 정확한 HTTPS host만 사용할 수 있으며 계정 정보·port·fragment는 허용하지 않습니다."
    );
  }
  const sourceUrl = canonicalSupportedVodSourceUrl(raw);
  if (
    !sourceUrl
    || canonicalSupportedVodSourceUrl(sourceUrl) !== sourceUrl
  ) {
    throw new TypeError(
      "CHZZK·YouTube·SOOP의 단일 공개 완료 VOD HTTPS URL만 열 수 있습니다."
    );
  }
  return sourceUrl;
}

export function parseKirinukiDeepLink(
  value: unknown
): Readonly<KirinukiDeepLinkRequest> {
  const raw = String(value || "").trim();
  if (
    raw.length === 0
    || raw.length > 4_096
    || /[\0-\x1f\x7f]/u.test(raw)
    || (
      raw !== KIRINUKI_DEEP_LINK
      && !raw.startsWith(`${KIRINUKI_DEEP_LINK}?`)
    )
  ) {
    throw new TypeError("Kirinuki 앱 링크 형식이 올바르지 않습니다.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Kirinuki 앱 링크 형식이 올바르지 않습니다.");
  }
  if (
    parsed.protocol !== "kirinuki:"
    || parsed.hostname !== "open"
    || parsed.pathname !== ""
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
  ) {
    throw new TypeError(
      `Kirinuki 앱 링크는 ${KIRINUKI_DEEP_LINK} 형식만 허용합니다.`
    );
  }
  const entries = [...parsed.searchParams.entries()];
  if (
    entries.length > 1
    || (entries.length === 1 && entries[0]?.[0] !== "source")
  ) {
    throw new TypeError(
      "Kirinuki 앱 링크에는 source 원본 URL 하나만 넣을 수 있습니다."
    );
  }
  if (entries.length === 0) {
    return Object.freeze({ sourceUrl: null });
  }
  const source = String(entries[0]?.[1] || "");
  if (!source) {
    throw new TypeError("Kirinuki 앱 링크의 source 원본 URL이 비어 있습니다.");
  }
  let sourceUrl: string;
  try {
    sourceUrl = validateSourceUrl(source);
  } catch {
    throw new TypeError(
      "Kirinuki 앱 링크의 source가 지원하는 단일 공개 완료 VOD HTTPS URL이 아닙니다."
    );
  }
  return Object.freeze({ sourceUrl });
}

/**
 * Extract an exact protocol argument from Electron's cold-start process argv or
 * warm-start `second-instance` argv. Chromium/application flags may surround
 * the URL, but a second protocol argument is always rejected. On macOS the
 * `open-url` event value should be passed straight to parseKirinukiDeepLink.
 */
export function extractKirinukiDeepLinkFromArgv(
  argv: readonly unknown[]
): Readonly<KirinukiDeepLinkRequest> | null {
  if (!Array.isArray(argv)) {
    throw new TypeError("Kirinuki 앱 링크 argv는 배열이어야 합니다.");
  }
  const candidates: string[] = [];
  for (const value of argv) {
    if (typeof value !== "string") {
      throw new TypeError("Kirinuki 앱 링크 argv에는 문자열만 허용합니다.");
    }
    const argument = value.trim();
    if (/^kirinuki:/iu.test(argument)) {
      candidates.push(argument);
    }
  }
  if (candidates.length > 1) {
    throw new TypeError("Kirinuki 앱 링크는 한 번에 하나만 열 수 있습니다.");
  }
  return candidates[0]
    ? parseKirinukiDeepLink(candidates[0])
    : null;
}
