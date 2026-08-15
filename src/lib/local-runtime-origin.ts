/** Browser origins that may be explicitly bound to Kirinuki's loopback runtime. */
export const KIRINUKI_LOCAL_STUDIO_ORIGIN = "http://127.0.0.1:4320";
export const KIRINUKI_PUBLIC_STUDIO_ORIGIN =
  "https://kirinuki.eff0rtchung.kr";

export const KIRINUKI_STUDIO_ORIGIN_META_NAME =
  "kirinuki-studio-origin";
export const KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER =
  "__KIRINUKI_STUDIO_ORIGIN__";

export const KIRINUKI_GATEWAY_ORIGIN_BINDING = "exact-local-studio";

export type KirinukiStudioOrigin =
  | typeof KIRINUKI_LOCAL_STUDIO_ORIGIN
  | typeof KIRINUKI_PUBLIC_STUDIO_ORIGIN;

export function isKirinukiStudioOrigin(
  value: unknown
): value is KirinukiStudioOrigin {
  return value === KIRINUKI_LOCAL_STUDIO_ORIGIN
    || value === KIRINUKI_PUBLIC_STUDIO_ORIGIN;
}

export function requireKirinukiStudioOrigin(
  value: unknown,
  label: string = "Kirinuki Studio Origin"
): KirinukiStudioOrigin {
  if (!isKirinukiStudioOrigin(value)) {
    throw new TypeError(
      `${label}은 고정된 loopback 또는 공개 배포 Origin이어야 합니다.`
    );
  }
  return value;
}

/**
 * Resolve deployment configuration without accepting aliases or arbitrary
 * origins. Omitting the value preserves the existing loopback-only default;
 * the public origin therefore always requires an explicit opt-in.
 */
export function resolveKirinukiStudioOrigin(
  value: unknown = undefined
): KirinukiStudioOrigin {
  if (value === undefined || value === "") {
    return KIRINUKI_LOCAL_STUDIO_ORIGIN;
  }
  return requireKirinukiStudioOrigin(value);
}

export function assertKirinukiStudioDocumentOrigin(
  documentOrigin: unknown,
  configuredOrigin: unknown
): KirinukiStudioOrigin {
  const actual = requireKirinukiStudioOrigin(
    documentOrigin,
    "현재 문서 Origin"
  );
  // The localhost server replaces this build-time token before serving HTML.
  // A static origin such as Popovic cannot rewrite HTML, so the tracked web/
  // distribution may resolve the token only from an already allowlisted
  // document origin. Arbitrary hosts still fail in requireKirinukiStudioOrigin
  // above; the token never broadens the two-origin allowlist.
  const configured = configuredOrigin === KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER
    ? actual
    : requireKirinukiStudioOrigin(
      configuredOrigin,
      "서버가 지정한 Studio Origin"
    );
  if (actual !== configured) {
    throw new TypeError(
      "현재 문서 Origin과 서버의 Kirinuki Studio Origin 설정이 다릅니다."
    );
  }
  return actual;
}

export function isKirinukiLocalStudioOrigin(
  value: unknown
): value is typeof KIRINUKI_LOCAL_STUDIO_ORIGIN {
  return value === KIRINUKI_LOCAL_STUDIO_ORIGIN;
}

export function isKirinukiPublicStudioOrigin(
  value: unknown
): value is typeof KIRINUKI_PUBLIC_STUDIO_ORIGIN {
  return value === KIRINUKI_PUBLIC_STUDIO_ORIGIN;
}
