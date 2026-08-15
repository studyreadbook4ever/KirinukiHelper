import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import type { BuildOptions, LogLevel } from "esbuild";

import { GENERATED_JAVASCRIPT_BANNER } from "./generated-javascript.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  resolveKirinukiAppOrigin
} from "../src/lib/local-runtime-origin.js";

export const STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN =
  KIRINUKI_LOCAL_STUDIO_ORIGIN;
export const STREAMING_COMPANION_STUDIO_ORIGIN_ENV =
  "KIRINUKI_ALLOWED_ORIGIN";
export const STREAMING_COMPANION_HTTPS_ORIGINS_ENV =
  "KIRINUKI_STREAMING_COMPANION_HTTPS_ORIGINS";
export const STREAMING_COMPANION_JAVASCRIPT_PATH =
  "streaming-companion.js";
export const SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH =
  "soop-streaming-companion.js";
export const STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH =
  "studio-streaming-relay.js";
export const STREAMING_COMPANION_MANIFEST_PATH = "manifest.json";
export const STREAMING_COMPANION_SOURCE_PATH =
  "src/streaming-companion.ts";
export const SOOP_STREAMING_COMPANION_SOURCE_PATH =
  "src/soop-streaming-companion.ts";
export const STUDIO_STREAMING_RELAY_SOURCE_PATH =
  "src/studio-streaming-relay.ts";
export const STREAMING_COMPANION_JAVASCRIPT_PATHS = Object.freeze([
  SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_JAVASCRIPT_PATH,
  STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH
].sort());

const STREAMING_COMPANION_GENERIC_SOURCE_MATCHES = Object.freeze([
  "https://chzzk.naver.com/*",
  "https://www.youtube-nocookie.com/*"
].sort());
const STREAMING_COMPANION_SOOP_SOURCE_MATCHES = Object.freeze([
  "https://vod.sooplive.com/*"
]);

export interface StreamingCompanionBuildOptions {
  readonly rootDirectory: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: boolean;
  readonly logLevel?: LogLevel;
}

export interface StreamingCompanionBuildResult {
  readonly allowedStudioOrigins: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: ReadonlyMap<string, Uint8Array>;
}

export function resolveStreamingCompanionStudioOrigins(
  env: NodeJS.ProcessEnv = process.env
): readonly string[] {
  const sharedOrigin = env[STREAMING_COMPANION_STUDIO_ORIGIN_ENV];
  const legacyBuildOrigin = env[STREAMING_COMPANION_HTTPS_ORIGINS_ENV];
  if (
    sharedOrigin !== undefined
    && legacyBuildOrigin !== undefined
    && sharedOrigin !== legacyBuildOrigin
  ) {
    throw new TypeError(
      "스트리밍 companion의 Studio Origin 환경 설정이 서로 다릅니다."
    );
  }
  const configured = sharedOrigin ?? legacyBuildOrigin;
  return Object.freeze([resolveKirinukiAppOrigin(configured)]);
}

function studioContentScriptMatch(studioOrigin: string): Readonly<{
  matches: readonly string[];
  include_globs: readonly string[];
}> {
  const url = new URL(studioOrigin);
  const host = url.hostname === "[::1]" ? "[::1]" : url.hostname;
  return {
    // Chromium match patterns do not express a port. include_globs binds the
    // one configured Studio port without granting another loopback service a
    // top-frame relay.
    matches: [`${url.protocol}//${host}/*`],
    include_globs: [`${studioOrigin}/*`]
  };
}

function manifestBytes(
  appVersion: string,
  allowedStudioOrigins: readonly string[]
): Uint8Array {
  const studioMatches = allowedStudioOrigins.flatMap((origin) => (
    studioContentScriptMatch(origin).matches
  )).sort();
  const studioIncludeGlobs = allowedStudioOrigins.flatMap((origin) => (
    studioContentScriptMatch(origin).include_globs
  )).sort();
  const manifest = {
    manifest_version: 3,
    name: "Kirinuki Player Bridge",
    version: appVersion,
    description: "Kirinuki 앱에 포함된 원본 플레이어 연결 구성요소입니다.",
    minimum_chrome_version: "120",
    permissions: ["storage"],
    content_scripts: [
      {
        matches: studioMatches,
        include_globs: studioIncludeGlobs,
        js: [STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH],
        all_frames: false,
        run_at: "document_start"
      },
      {
        matches: STREAMING_COMPANION_GENERIC_SOURCE_MATCHES,
        js: [STREAMING_COMPANION_JAVASCRIPT_PATH],
        all_frames: true,
        run_at: "document_start"
      },
      {
        matches: STREAMING_COMPANION_SOOP_SOURCE_MATCHES,
        js: [SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH],
        all_frames: true,
        run_at: "document_start",
        world: "MAIN"
      }
    ]
  } as const;
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export async function buildStreamingCompanion({
  rootDirectory,
  env = process.env,
  write = true,
  logLevel = write ? "info" : "silent"
}: StreamingCompanionBuildOptions): Promise<StreamingCompanionBuildResult> {
  const companionRoot = path.join(rootDirectory, "streaming-companion");
  const allowedStudioOrigins = resolveStreamingCompanionStudioOrigins(env);
  const packageMetadata = JSON.parse(
    await readFile(path.join(rootDirectory, "package.json"), "utf8")
  ) as { readonly version?: unknown };
  if (
    typeof packageMetadata.version !== "string"
    || !/^\d+(?:\.\d+){0,3}$/u.test(packageMetadata.version)
  ) {
    throw new TypeError(
      "Kirinuki 앱 version은 Chromium manifest와 공유할 숫자 형식이어야 합니다."
    );
  }
  const commonBuildOptions = {
    absWorkingDir: rootDirectory,
    bundle: true,
    platform: "browser",
    target: "chrome120",
    format: "iife",
    sourcemap: false,
    minify: true,
    legalComments: "eof",
    banner: { js: GENERATED_JAVASCRIPT_BANNER },
    define: {
      __KIRINUKI_STREAMING_COMPANION_ALLOWED_STUDIO_ORIGINS__:
        JSON.stringify(JSON.stringify(allowedStudioOrigins))
    },
    logLevel,
    metafile: true,
    write: false
  } satisfies BuildOptions;
  const builds = await Promise.all([
    build({
      ...commonBuildOptions,
      entryPoints: [STREAMING_COMPANION_SOURCE_PATH],
      outfile: path.join(
        companionRoot,
        STREAMING_COMPANION_JAVASCRIPT_PATH
      )
    }),
    build({
      ...commonBuildOptions,
      entryPoints: [SOOP_STREAMING_COMPANION_SOURCE_PATH],
      outfile: path.join(
        companionRoot,
        SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH
      )
    }),
    build({
      ...commonBuildOptions,
      entryPoints: [STUDIO_STREAMING_RELAY_SOURCE_PATH],
      outfile: path.join(
        companionRoot,
        STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH
      )
    })
  ]);
  const [genericJavaScript, soopJavaScript, studioRelayJavaScript] = builds.map(
    (result) => result.outputFiles?.[0]
  );
  if (!genericJavaScript || !soopJavaScript || !studioRelayJavaScript) {
    throw new Error("최소 스트리밍 companion JavaScript 출력이 누락되었습니다.");
  }
  const outputs = new Map<string, Uint8Array>([
    [STREAMING_COMPANION_JAVASCRIPT_PATH, genericJavaScript.contents],
    [SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH, soopJavaScript.contents],
    [STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH, studioRelayJavaScript.contents],
    [
      STREAMING_COMPANION_MANIFEST_PATH,
      manifestBytes(packageMetadata.version, allowedStudioOrigins)
    ]
  ]);
  if (write) {
    await mkdir(companionRoot, { recursive: true });
    await Promise.all([...outputs].map(([relativePath, contents]) => (
      writeFile(path.join(companionRoot, relativePath), contents)
    )));
  }
  const inputPaths = new Set(builds.flatMap((result) => (
    Object.keys(result.metafile?.inputs || {})
  )));
  const inputs = [...inputPaths].map((inputPath) => {
    const absolute = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(rootDirectory, inputPath);
    return toPosixPath(path.relative(rootDirectory, absolute));
  }).sort();
  return {
    allowedStudioOrigins,
    inputs,
    outputs
  };
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  await buildStreamingCompanion({ rootDirectory: root });
  const manifest = await readFile(
    path.join(root, "streaming-companion", STREAMING_COMPANION_MANIFEST_PATH),
    "utf8"
  );
  if (!manifest.endsWith("\n")) {
    throw new Error("최소 스트리밍 companion manifest가 결정적 LF로 끝나지 않습니다.");
  }
  console.log("최소 스트리밍 companion 빌드 완료: streaming-companion/");
}
