import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";
import type {
  BuildOptions,
  LogLevel,
  Metafile
} from "esbuild";

import { GENERATED_JAVASCRIPT_BANNER } from "./generated-javascript.js";
import {
  parseLocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";

interface WebJavaScriptTarget {
  readonly sourcePath: string;
  readonly outputPath: string;
}

export const WEB_JAVASCRIPT_TARGETS = Object.freeze([
  {
    sourcePath: "src/web/main.ts",
    outputPath: "studio.js"
  },
  {
    sourcePath: "src/editor/main.ts",
    outputPath: "editor/editor.js"
  },
  {
    sourcePath: "src/editor/audseg-worker.ts",
    outputPath: "editor/audseg-worker.js"
  }
] satisfies readonly WebJavaScriptTarget[]);

export const WEB_JAVASCRIPT_PATHS = Object.freeze(
  WEB_JAVASCRIPT_TARGETS.map(({ outputPath }) => outputPath).sort()
);

export interface WebJavaScriptBuildOptions {
  readonly rootDirectory: string;
  readonly write?: boolean;
  readonly logLevel?: LogLevel;
  readonly engineRelease?: unknown;
}

export interface WebJavaScriptBuildResult {
  readonly inputs: readonly string[];
  readonly outputs: ReadonlyMap<string, Uint8Array>;
}

const FORBIDDEN_WEB_RUNTIME_INPUTS = Object.freeze([
  "src/content-script.ts",
  "src/service-worker.ts",
  "src/sidepanel.ts",
  "src/editor/studio-runtime-extension-legacy.ts"
]);

const FORBIDDEN_WEB_RUNTIME_OUTPUT_PATTERNS = Object.freeze([
  {
    pattern: /\bchrome\s*\.\s*(?:runtime|storage|tabs|sidePanel)\b/u,
    label: "Chrome API"
  },
  {
    pattern: /chrome:\/\/extensions/u,
    label: "Chrome Extension settings URL"
  },
  {
    pattern: /KIRINUKI_(?:PREPARE_EDITOR_NAVIGATION|SOURCE_BINDING_STATUS|CAPTURE_SEED_UPDATED)/u,
    label: "legacy runtime message"
  },
  {
    pattern: /SIDEPANEL_SHORTCUT_BINDINGS/u,
    label: "legacy side-panel shortcut table"
  }
]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function collectInputs(
  rootDirectory: string,
  metafiles: readonly Metafile[]
): string[] {
  return [...new Set(metafiles.flatMap((metafile) => (
    Object.keys(metafile.inputs).map((inputPath) => {
      const absolute = path.isAbsolute(inputPath)
        ? inputPath
        : path.resolve(rootDirectory, inputPath);
      return toPosixPath(path.relative(rootDirectory, absolute));
    })
  )))].sort();
}

function assertWebRuntimePurity(
  inputs: readonly string[],
  outputs: ReadonlyMap<string, Uint8Array>
): void {
  const forbiddenInput = inputs.find((inputPath) => (
    FORBIDDEN_WEB_RUNTIME_INPUTS.includes(inputPath)
  ));
  if (forbiddenInput) {
    throw new Error(
      `localhost web build가 legacy browser runtime을 포함했습니다: ${forbiddenInput}`
    );
  }
  const decoder = new TextDecoder();
  for (const [outputPath, contents] of outputs) {
    const source = decoder.decode(contents);
    for (const { pattern, label } of FORBIDDEN_WEB_RUNTIME_OUTPUT_PATTERNS) {
      if (pattern.test(source)) {
        throw new Error(
          `localhost web JavaScript에 ${label}이 남았습니다: ${outputPath}`
        );
      }
    }
    if (/chrome-extension:\\?\/\\?\//u.test(source)) {
      throw new Error(
        `localhost web JavaScript에 legacy origin URL이 남았습니다: ${outputPath}`
      );
    }
  }
}

export async function buildWebJavaScript({
  rootDirectory,
  write = true,
  logLevel = write ? "info" : "silent",
  engineRelease = null
}: WebJavaScriptBuildOptions): Promise<WebJavaScriptBuildResult> {
  const webRoot = path.join(rootDirectory, "web");
  const subtitleSyncSkill = await readFile(
    path.join(rootDirectory, "skills/align-song-subtitles-60fps/SKILL.md"),
    "utf8"
  );
  const verifiedEngineRelease = parseLocalMediaEngineReleaseChannel(
    engineRelease
  );
  if (engineRelease !== null && !verifiedEngineRelease) {
    throw new Error(
      "웹 빌드에 전달된 local media engine release channel이 검증 형식과 다릅니다."
    );
  }
  const common = {
    absWorkingDir: rootDirectory,
    bundle: true,
    platform: "browser",
    target: "chrome120",
    format: "esm",
    sourcemap: false,
    // These are shipped browser artifacts rather than debugging sources.
    // Property names stay intact, while whitespace/local identifiers are
    // compressed to reduce first-load and editor-navigation cost.
    minify: true,
    legalComments: "eof",
    banner: { js: GENERATED_JAVASCRIPT_BANNER },
    define: {
      __KIRINUKI_SUBTITLE_SYNC_SKILL_MARKDOWN__: JSON.stringify(subtitleSyncSkill),
      __KIRINUKI_LOCAL_MEDIA_ENGINE_RELEASE__: JSON.stringify(
        verifiedEngineRelease
      )
    },
    logLevel,
    metafile: true,
    write: false
  } satisfies BuildOptions;
  const results = await Promise.all(WEB_JAVASCRIPT_TARGETS.map((target) => (
    build({
      ...common,
      entryPoints: [target.sourcePath],
      outfile: path.join(webRoot, target.outputPath)
    })
  )));
  const outputs = new Map<string, Uint8Array>();
  for (const outputFile of results.flatMap((result) => result.outputFiles || [])) {
    const relativePath = toPosixPath(path.relative(webRoot, outputFile.path));
    if (
      relativePath.startsWith("../")
      || path.isAbsolute(relativePath)
      || !WEB_JAVASCRIPT_PATHS.includes(relativePath)
      || outputs.has(relativePath)
    ) {
      throw new Error(`승인되지 않은 localhost web JavaScript 출력입니다: ${outputFile.path}`);
    }
    outputs.set(relativePath, outputFile.contents);
  }
  if (outputs.size !== WEB_JAVASCRIPT_PATHS.length) {
    throw new Error("localhost web JavaScript 출력이 typed manifest와 다릅니다.");
  }
  const inputs = collectInputs(
    rootDirectory,
    results.map((result) => result.metafile)
  );
  assertWebRuntimePurity(inputs, outputs);
  if (write) {
    await Promise.all([...outputs].map(async ([relativePath, contents]) => {
      const outputPath = path.join(webRoot, relativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents);
    }));
  }
  return {
    inputs,
    outputs
  };
}
