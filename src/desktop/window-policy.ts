import path from "node:path";

import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../lib/local-runtime-origin.js";
import {
  validateSourceUrl
} from "../lib/kirinuki-deep-link.js";
import type { KirinukiDeepLinkRequest } from "../lib/kirinuki-deep-link.js";

const EXTERNAL_NAVIGATION_PROTOCOLS = Object.freeze(new Set([
  "https:",
  "mailto:"
]));

export interface DesktopFileSystemPermissionRequest {
  readonly managedWebContents: boolean;
  readonly requestingOrigin: unknown;
  readonly requestingUrl: unknown;
  readonly fileAccessType: unknown;
  readonly filePath: unknown;
}

export function desktopStudioUrl(
  request: Readonly<KirinukiDeepLinkRequest> | null = null
): string {
  const url = new URL("/", KIRINUKI_LOCAL_STUDIO_ORIGIN);
  if (request?.sourceUrl) {
    url.searchParams.set("source", request.sourceUrl);
  }
  return url.href;
}

export function isAllowedDesktopMainFrameUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    const allowedRoute = ["/", "/index.html", "/editor.html"].includes(
      url.pathname
    ) || (
      url.pathname === "/licenses.html"
      && url.search === ""
    );
    return url.origin === KIRINUKI_LOCAL_STUDIO_ORIGIN
      && !url.username
      && !url.password
      && url.hash === ""
      && allowedRoute;
  } catch {
    return false;
  }
}

function isAllowedDesktopFileSystemFrameUrl(value: unknown): boolean {
  if (!isAllowedDesktopMainFrameUrl(value)) {
    return false;
  }
  try {
    return ["/", "/index.html", "/editor.html"].includes(
      new URL(String(value)).pathname
    );
  } catch {
    return false;
  }
}

function exactSourceNavigationUrl(raw: string): string | null {
  try {
    if (validateSourceUrl(raw) === raw) {
      return raw;
    }
  } catch {
    // A time-decorated source is checked against its canonical base below.
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const youtubeTime = url.hostname === "www.youtube.com"
    && url.pathname === "/watch"
    && [...url.searchParams.keys()].sort().join(",") === "t,v"
    && url.searchParams.getAll("t").length === 1
    && url.searchParams.getAll("v").length === 1
    ? url.searchParams.get("t")
    : null;
  const soopTime = url.hostname === "vod.sooplive.com"
    && /^\/player\/\d+$/u.test(url.pathname)
    && [...url.searchParams.keys()].join(",") === "change_second"
    && url.searchParams.getAll("change_second").length === 1
    ? url.searchParams.get("change_second")
    : null;
  const rawSeconds = youtubeTime?.match(/^(0|[1-9]\d{0,7})s$/u)?.[1]
    ?? soopTime?.match(/^(0|[1-9]\d{0,7})$/u)?.[1]
    ?? "";
  const seconds = Number(rawSeconds);
  if (
    !rawSeconds
    || !Number.isSafeInteger(seconds)
    || seconds < 0
    || seconds > 2_592_000
  ) {
    return null;
  }
  const base = new URL(url.href);
  base.searchParams.delete(youtubeTime === null ? "change_second" : "t");
  try {
    return validateSourceUrl(base.href) === base.href ? url.href : null;
  } catch {
    return null;
  }
}

export function allowedExternalNavigationUrl(value: unknown): string | null {
  try {
    const raw = String(value);
    if (raw.trim() !== raw) {
      return null;
    }
    const url = new URL(raw);
    if (
      !EXTERNAL_NAVIGATION_PROTOCOLS.has(url.protocol)
      || url.username
      || url.password
      || url.protocol === "mailto:"
        && (
          url.pathname.toLowerCase() !== "lostfragment@naver.com"
          || url.search
          || url.hash
        )
    ) {
      return null;
    }
    if (url.protocol === "https:" && ![
      "github.com",
      "kirinuki.eff0rtchung.kr"
    ].includes(url.hostname.toLowerCase())) {
      if (exactSourceNavigationUrl(raw) === null) {
        return null;
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

export function isAllowedDesktopFileSystemPermission({
  managedWebContents,
  requestingOrigin,
  requestingUrl,
  fileAccessType,
  filePath
}: Readonly<DesktopFileSystemPermissionRequest>): boolean {
  if (
    !managedWebContents
    || requestingOrigin !== KIRINUKI_LOCAL_STUDIO_ORIGIN
    || !isAllowedDesktopFileSystemFrameUrl(requestingUrl)
    || !["readable", "writable"].includes(String(fileAccessType))
    || typeof filePath !== "string"
    || filePath.trim() !== filePath
    || !path.isAbsolute(filePath)
    || /[\u0000-\u001f\u007f]/u.test(filePath)
  ) {
    return false;
  }
  return true;
}

export function isAllowedDesktopRestrictedFileSystemPrompt({
  origin,
  filePath,
  isDirectory
}: {
  readonly origin: unknown;
  readonly filePath: unknown;
  readonly isDirectory: unknown;
}): boolean {
  return origin === KIRINUKI_LOCAL_STUDIO_ORIGIN
    && typeof isDirectory === "boolean"
    && typeof filePath === "string"
    && filePath.trim() === filePath
    && path.isAbsolute(filePath)
    && !/[\u0000-\u001f\u007f]/u.test(filePath);
}
