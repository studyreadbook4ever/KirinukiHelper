import path from "node:path";

import {
  canonicalSupportedVodSourceUrl
} from "../src/lib/source-embed.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  inferSourceIdentifiers
} from "../src/lib/source-platform.js";
import {
  assertExternalVodTransferUrl,
  safeExternalVodRequestHeaders
} from "./external-vod-transfer.js";
import {
  runExternalProcess
} from "./external-vod-materializer.js";
import type {
  ExternalProcessRunner
} from "./external-vod-materializer.js";

const MAXIMUM_PARTS = 512;
const MAXIMUM_DURATION_SECONDS = 2_592_000;
const RESOLVE_TIMEOUT_MS = 30_000;

export interface ResolvedLocalVodPlaybackPart {
  readonly durationSeconds: number;
  readonly manifestUrl: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
}

export interface ResolvedLocalVodPlayback {
  readonly platform: typeof SOURCE_PLATFORM_CHZZK | typeof SOURCE_PLATFORM_SOOP;
  readonly contentId: string;
  readonly sourceUrl: string;
  readonly durationSeconds: number;
  readonly parts: readonly ResolvedLocalVodPlaybackPart[];
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}이 객체가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

function playbackProbeArgs(sourceUrl: string, platform: string, nodeBinary: string): string[] {
  if (!path.isAbsolute(nodeBinary) || /[\0\r\n,]/u.test(nodeBinary)) {
    throw new TypeError("검증된 Node 실행 경로가 필요합니다.");
  }
  return [
    "--ignore-config",
    "--no-config-locations",
    "--no-plugin-dirs",
    "--no-cache-dir",
    "--no-batch-file",
    "--no-cookies",
    "--no-cookies-from-browser",
    "--no-exec",
    "--no-update",
    "--no-remote-components",
    "--no-js-runtimes",
    "--js-runtimes", `node:${nodeBinary}`,
    "--no-warnings",
    "--quiet",
    "--skip-download",
    "--dump-single-json",
    ...(platform === SOURCE_PLATFORM_SOOP
      ? ["--yes-playlist", "--playlist-end", String(MAXIMUM_PARTS + 1)]
      : ["--no-playlist"]),
    "--",
    sourceUrl
  ];
}

function selectedHlsFormat(
  entry: Readonly<Record<string, unknown>>,
  platform: typeof SOURCE_PLATFORM_CHZZK | typeof SOURCE_PLATFORM_SOOP
): Readonly<{ manifestUrl: string; requestHeaders: Readonly<Record<string, string>> }> {
  const formats = Array.isArray(entry.formats) ? entry.formats : [];
  const candidates = formats.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const format = value as Record<string, unknown>;
    const height = Number(format.height || 0);
    const bitrate = Number(format.tbr || format.vbr || 0);
    if (
      (format.protocol !== "m3u8_native" && format.protocol !== "m3u8")
      || typeof format.url !== "string"
      || format.vcodec === "none"
      || format.acodec === "none"
      || !Number.isFinite(height)
      || height <= 0
      || height > 1_080
    ) {
      return [];
    }
    const manifestUrl = assertExternalVodTransferUrl(platform, format.url).href;
    return [{
      height,
      bitrate: Number.isFinite(bitrate) ? bitrate : 0,
      manifestUrl,
      requestHeaders: safeExternalVodRequestHeaders(format.http_headers)
    }];
  });
  candidates.sort((left, right) => (
    right.height - left.height || right.bitrate - left.bitrate
  ));
  const selected = candidates[0];
  if (!selected) {
    throw new TypeError(`${platform} 공개 VOD의 HLS 재생 소스를 찾지 못했습니다.`);
  }
  return Object.freeze({
    manifestUrl: selected.manifestUrl,
    requestHeaders: selected.requestHeaders
  });
}

export async function resolveLocalVodPlayback(
  sourceValue: unknown,
  {
    ytDlpBinary,
    nodeBinary = process.execPath,
    processEnv = process.env,
    cwd = process.cwd(),
    runProcess = runExternalProcess,
    signal
  }: {
    readonly ytDlpBinary: string;
    readonly nodeBinary?: string;
    readonly processEnv?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly runProcess?: ExternalProcessRunner;
    readonly signal?: AbortSignal;
  }
): Promise<ResolvedLocalVodPlayback> {
  const sourceUrl = canonicalSupportedVodSourceUrl(sourceValue);
  const identifiers = sourceUrl ? inferSourceIdentifiers(sourceUrl) : null;
  if (
    !sourceUrl
    || !identifiers?.contentId
    || (identifiers.platform !== SOURCE_PLATFORM_CHZZK
      && identifiers.platform !== SOURCE_PLATFORM_SOOP)
    || !path.isAbsolute(ytDlpBinary)
  ) {
    throw new TypeError("CHZZK·SOOP 공개 VOD와 검증된 yt-dlp가 필요합니다.");
  }
  const platform: typeof SOURCE_PLATFORM_CHZZK | typeof SOURCE_PLATFORM_SOOP =
    identifiers.platform;
  const result = await runProcess(
    ytDlpBinary,
    playbackProbeArgs(sourceUrl, platform, nodeBinary),
    {
      cwd,
      env: processEnv,
      shell: false,
      timeoutMs: RESOLVE_TIMEOUT_MS,
      ...(signal ? { signal } : {})
    }
  );
  if (result.exitCode !== 0) {
    throw new Error(`${identifiers.platform} 공개 VOD 재생 정보를 확인하지 못했습니다.`);
  }
  let rootValue: unknown;
  try {
    rootValue = JSON.parse(result.stdout);
  } catch {
    throw new TypeError("공개 VOD 재생 정보가 JSON이 아닙니다.");
  }
  const root = exactRecord(rootValue, "공개 VOD 재생 정보");
  const rawEntries = Array.isArray(root.entries) && root.entries.length > 0
    ? root.entries
    : [root];
  if (rawEntries.length > MAXIMUM_PARTS) {
    throw new TypeError("SOOP VOD 파트 수가 안전 상한을 넘습니다.");
  }
  const parts = rawEntries.map((value, index) => {
    const entry = exactRecord(value, `${index + 1}번 VOD 파트`);
    const durationSeconds = Number(entry.duration);
    if (
      !Number.isFinite(durationSeconds)
      || durationSeconds <= 0
      || durationSeconds > MAXIMUM_DURATION_SECONDS
    ) {
      throw new TypeError(`${index + 1}번 VOD 파트 길이가 올바르지 않습니다.`);
    }
    return Object.freeze({
      durationSeconds,
      ...selectedHlsFormat(entry, platform)
    });
  });
  const durationSeconds = parts.reduce((sum, part) => sum + part.durationSeconds, 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds > MAXIMUM_DURATION_SECONDS) {
    throw new TypeError("VOD 전체 길이가 안전 상한을 넘습니다.");
  }
  return Object.freeze({
    platform,
    contentId: identifiers.contentId,
    sourceUrl,
    durationSeconds,
    parts: Object.freeze(parts)
  });
}
