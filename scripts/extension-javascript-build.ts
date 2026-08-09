import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";
import type { BuildOptions, LogLevel, Metafile, OutputFile } from "esbuild";

export const GENERATED_JAVASCRIPT_BANNER =
  "// Generated from TypeScript sources. Do not edit directly.";

type ExtensionJavaScriptBuildMode =
  | "bundle-esm"
  | "bundle-iife"
  | "module";

interface ExtensionJavaScriptTarget {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly mode: ExtensionJavaScriptBuildMode;
}

export const EXTENSION_JAVASCRIPT_TARGETS = Object.freeze([
  {
    sourcePath: "src/content-script.ts",
    outputPath: "content-script.js",
    mode: "bundle-iife"
  },
  {
    sourcePath: "src/editor/audseg-worker.ts",
    outputPath: "editor/audseg-worker.js",
    mode: "bundle-esm"
  },
  {
    sourcePath: "src/editor/main.ts",
    outputPath: "editor/editor.js",
    mode: "bundle-esm"
  },
  {
    sourcePath: "src/lib/caption-style.ts",
    outputPath: "lib/caption-style.js",
    mode: "module"
  },
  {
    sourcePath: "src/lib/core.ts",
    outputPath: "lib/core.js",
    mode: "module"
  },
  {
    sourcePath: "src/lib/editor-core.ts",
    outputPath: "lib/editor-core.js",
    mode: "module"
  },
  {
    sourcePath: "src/lib/keyboard-shortcuts.ts",
    outputPath: "lib/keyboard-shortcuts.js",
    mode: "module"
  },
  {
    sourcePath: "src/lib/serial-operation-gate.ts",
    outputPath: "lib/serial-operation-gate.js",
    mode: "module"
  },
  {
    sourcePath: "src/lib/session-recovery.ts",
    outputPath: "lib/session-recovery.js",
    mode: "module"
  },
  {
    sourcePath: "src/lib/source-platform.ts",
    outputPath: "lib/source-platform.js",
    mode: "module"
  },
  {
    sourcePath: "src/service-worker.ts",
    outputPath: "service-worker.js",
    mode: "module"
  },
  {
    sourcePath: "src/sidepanel.ts",
    outputPath: "sidepanel.js",
    mode: "module"
  }
] satisfies readonly ExtensionJavaScriptTarget[]);

export const EXTENSION_JAVASCRIPT_PATHS = Object.freeze(
  EXTENSION_JAVASCRIPT_TARGETS.map(({ outputPath }) => outputPath).sort()
);

export interface ExtensionJavaScriptBuildOptions {
  readonly rootDirectory: string;
  readonly write?: boolean;
  readonly logLevel?: LogLevel;
}

export interface ExtensionJavaScriptBuildResult {
  readonly inputs: readonly string[];
  readonly outputs: ReadonlyMap<string, Uint8Array>;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeInputPath(rootDirectory: string, inputPath: string): string {
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(rootDirectory, inputPath);
  return toPosixPath(path.relative(rootDirectory, absolutePath));
}

function collectInputs(
  rootDirectory: string,
  metafiles: readonly Metafile[]
): string[] {
  return [...new Set(metafiles.flatMap((metafile) => (
    Object.keys(metafile.inputs).map((inputPath) => (
      normalizeInputPath(rootDirectory, inputPath)
    ))
  )))].sort();
}

function collectOutputs(
  extensionRoot: string,
  outputFiles: readonly OutputFile[]
): Map<string, Uint8Array> {
  const outputs = new Map<string, Uint8Array>();
  for (const outputFile of outputFiles) {
    const relativePath = toPosixPath(path.relative(extensionRoot, outputFile.path));
    if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
      throw new Error(`Extension 밖의 JavaScript 출력입니다: ${outputFile.path}`);
    }
    if (outputs.has(relativePath)) {
      throw new Error(`중복된 Extension JavaScript 출력입니다: ${relativePath}`);
    }
    outputs.set(relativePath, outputFile.contents);
  }
  const actualPaths = [...outputs.keys()].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(EXTENSION_JAVASCRIPT_PATHS)) {
    throw new Error(
      "Extension JavaScript 빌드 출력이 typed manifest와 다릅니다.\n" +
      `expected=${JSON.stringify(EXTENSION_JAVASCRIPT_PATHS)}\n` +
      `actual=${JSON.stringify(actualPaths)}`
    );
  }
  return outputs;
}

export async function buildExtensionJavaScript({
  rootDirectory,
  write = true,
  logLevel = write ? "info" : "silent"
}: ExtensionJavaScriptBuildOptions): Promise<ExtensionJavaScriptBuildResult> {
  const extensionRoot = path.join(rootDirectory, "extension");
  const sourceRoot = path.join(rootDirectory, "src");
  const common = {
    absWorkingDir: rootDirectory,
    bundle: true,
    platform: "browser",
    target: "chrome120",
    format: "esm",
    sourcemap: false,
    minify: false,
    legalComments: "eof",
    banner: { js: GENERATED_JAVASCRIPT_BANNER },
    logLevel,
    metafile: true,
    write: false
  } satisfies BuildOptions;

  const bundledTargets = EXTENSION_JAVASCRIPT_TARGETS.filter(({ mode }) => (
    mode !== "module"
  ));
  const moduleTargets = EXTENSION_JAVASCRIPT_TARGETS.filter(({ mode }) => (
    mode === "module"
  ));

  const results = await Promise.all([
    ...bundledTargets.map((target) => build({
      ...common,
      format: target.mode === "bundle-iife" ? "iife" : "esm",
      entryPoints: [target.sourcePath],
      outfile: path.join(extensionRoot, target.outputPath)
    })),
    build({
      ...common,
      bundle: false,
      entryPoints: moduleTargets.map(({ sourcePath }) => sourcePath),
      outbase: sourceRoot,
      outdir: extensionRoot
    })
  ]);
  const outputFiles = results.flatMap((result) => result.outputFiles || []);
  const outputs = collectOutputs(extensionRoot, outputFiles);
  if (write) {
    await Promise.all([...outputs].map(async ([relativePath, contents]) => {
      const outputPath = path.join(extensionRoot, relativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents);
    }));
  }
  return {
    inputs: collectInputs(
      rootDirectory,
      results.map((result) => result.metafile)
    ),
    outputs
  };
}
