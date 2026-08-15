import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { GENERATED_JAVASCRIPT_BANNER } from "./generated-javascript.js";
import {
  SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
  SOOP_STREAMING_COMPANION_SOURCE_PATH,
  STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_JAVASCRIPT_PATHS,
  STREAMING_COMPANION_SOURCE_PATH,
  buildStreamingCompanion
} from "./build-streaming-companion.js";
import {
  WEB_JAVASCRIPT_PATHS,
  WEB_JAVASCRIPT_TARGETS,
  buildWebJavaScript
} from "./web-javascript-build.js";
import { WEB_PACKAGE_FILES } from "./web-package-files.js";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const ignoredDependencyDirectoryNames = new Set([
  ".mypy_cache",
  ".nyc_output",
  ".pytest_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv"
]);
const ignoredRootDirectories = new Set([".git", "coverage", "dist"]);
const javaScriptFamilyPattern = /\.(?:cjs|js|jsx|mjs)$/iu;
const typeScriptFamilyPattern = /\.(?:cts|mts|ts|tsx)$/iu;
const declarationFilePattern = /\.d\.(?:cts|mts|ts)$/iu;
export interface TypeScriptMigrationReport {
  readonly ok: true;
  readonly authoredTypeScriptFiles: number;
  readonly authoredJavaScriptFiles: 0;
  readonly explicitAnyTypes: 0;
  readonly typeSuppressionDirectives: 0;
  readonly generatedJavaScriptFiles: number;
  readonly generatedJavaScriptMatchesTypeScript: true;
  readonly generatedFirstPartyInputsAreTypeScript: true;
  readonly browserDistributionShipsTypeScript: false;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function sortedValues(values: Iterable<string>): string[] {
  return [...values].sort();
}

function sameStrings(left: Iterable<string>, right: Iterable<string>): boolean {
  return JSON.stringify(sortedValues(left)) === JSON.stringify(sortedValues(right));
}

export function findAuthoredJavaScriptFiles(
  repositoryFiles: readonly string[]
): string[] {
  const approvedGeneratedJavaScript = new Set(
    [
      ...WEB_JAVASCRIPT_PATHS.map((relativePath) => `web/${relativePath}`),
      ...STREAMING_COMPANION_JAVASCRIPT_PATHS.map((relativePath) => (
        `streaming-companion/${relativePath}`
      ))
    ]
  );
  return repositoryFiles.filter((relativePath) => (
    javaScriptFamilyPattern.test(relativePath)
    && !approvedGeneratedJavaScript.has(relativePath)
  ));
}

export async function listRepositoryFiles(
  rootDirectory: string,
  directory = rootDirectory,
  prefix = ""
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (
        !ignoredDependencyDirectoryNames.has(entry.name)
        && !ignoredRootDirectories.has(relativePath)
      ) {
        files.push(...await listRepositoryFiles(
          rootDirectory,
          path.join(directory, entry.name),
          relativePath
        ));
      }
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`저장소에 심볼릭 링크나 특수 파일을 둘 수 없습니다: ${relativePath}`);
    }
  }
  return files.sort();
}

export function assertNoInlineJavaScript(
  relativePath: string,
  contents: string
): void {
  const inlineHandlers = [...contents.matchAll(/(?:\s|\/)on[a-z][\w:-]*\s*=/giu)];
  assert(
    inlineHandlers.length === 0,
    `HTML inline event handler가 있습니다: ${relativePath}`
  );
  const executableText = contents
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (
      match,
      hexadecimal: string | undefined,
      decimal: string | undefined
    ) => {
      const codePoint = Number.parseInt(hexadecimal || decimal || "", hexadecimal ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/&colon;/giu, ":")
    .replace(/&(?:newline|tab);/giu, "")
    .replace(/[\u0000-\u0020\u007f-\u009f]+/gu, "");
  assert(
    !/javascript:/iu.test(executableText),
    `HTML javascript: URL이 있습니다: ${relativePath}`
  );

  for (const match of contents.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu
  )) {
    const attributes = match[1] || "";
    const body = match[2] || "";
    const sourceMatch = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/iu);
    assert(sourceMatch, `HTML inline script가 있습니다: ${relativePath}`);
    assert(body.trim() === "", `외부 script 태그 안에 inline 코드가 있습니다: ${relativePath}`);
    const runtimeRoot = relativePath.startsWith("web/") ? "web" : "";
    assert(runtimeRoot, `승인되지 않은 HTML이 JavaScript를 실행합니다: ${relativePath}`);
    const approvedPaths = WEB_JAVASCRIPT_PATHS;
    const source = (sourceMatch[2] || "").split(/[?#]/u, 1)[0] || "";
    const htmlPath = relativePath.slice(runtimeRoot.length + 1);
    const resolvedSource = path.posix.normalize(
      path.posix.join(path.posix.dirname(htmlPath), source.replace(/^\//u, ""))
    );
    assert(
      approvedPaths.includes(resolvedSource),
      `HTML이 승인되지 않은 JavaScript를 실행합니다: ${relativePath} -> ${source}`
    );
  }

  const openingScripts = [...contents.matchAll(/<script\b/giu)].length;
  const closedScripts = [...contents.matchAll(/<\/script\s*>/giu)].length;
  assert(
    openingScripts === closedScripts,
    `HTML script 태그가 완결되지 않았습니다: ${relativePath}`
  );
}

function authoredJavaScriptTokens(command: string): string[] {
  return (command.match(/[\w./${}@:+-]+\.(?:cjs|js|jsx|mjs)\b/giu) || [])
    .filter((token) => (
      token.toLowerCase() !== "node.js"
      && !token.includes("node_modules/")
    ));
}

export function assertNoInlineJavaScriptCommand(
  relativePath: string,
  command: string
): void {
  const inlineRuntime = /\b(?:bun|deno|node|tsx)\b[^\r\n]*(?:^|\s)(?:-[a-z]*[ep][a-z]*(?=\s|$)|--eval(?:=|\s)|--print(?:=|\s))/imu;
  assert(!inlineRuntime.test(command), `inline JavaScript 명령이 있습니다: ${relativePath}`);
  assert(
    !/\bdeno\s+eval(?:\s|$)/imu.test(command),
    `inline JavaScript 명령이 있습니다: ${relativePath}`
  );
  assert(
    !/\bnode\b[^\r\n]*\s(?:-|\/dev\/stdin)(?:\s|$)/imu.test(command),
    `stdin JavaScript 명령이 있습니다: ${relativePath}`
  );
  assert(
    !/\b(?:bun|deno|node|tsx)\b[^\r\n]*<{1,3}/imu.test(command),
    `stdin/heredoc JavaScript 명령이 있습니다: ${relativePath}`
  );
  assert(
    !/(?:\||<<-?\s*\S+)[^\r\n]*\b(?:node|tsx)\b/imu.test(command),
    `pipe/heredoc JavaScript 명령이 있습니다: ${relativePath}`
  );
  const directRuntimeEntrypoints = [...command.matchAll(
    /\b(?:node|tsx)\b\s+(?!-)(["']?)([^\s"';&|<>]+)\1/gimu
  )].map((match) => match[2] || "");
  const extensionlessEntrypoints = directRuntimeEntrypoints.filter((entrypoint) => (
    !typeScriptFamilyPattern.test(entrypoint)
    && !javaScriptFamilyPattern.test(entrypoint)
  ));
  assert(
    extensionlessEntrypoints.length === 0,
    `확장자 없는 JavaScript 진입점을 실행합니다: ${relativePath} -> ${extensionlessEntrypoints.join(", ")}`
  );
  const entrypoints = authoredJavaScriptTokens(command);
  assert(
    entrypoints.length === 0,
    `작성 JavaScript 진입점을 실행합니다: ${relativePath} -> ${entrypoints.join(", ")}`
  );
}

export function assertNoJavaScriptRuntimeShebang(
  relativePath: string,
  contents: string
): void {
  if (typeScriptFamilyPattern.test(relativePath)) {
    return;
  }
  assert(
    !/^#![^\r\n]*\b(?:bun|deno|node|tsx)\b/iu.test(contents),
    `확장자 없는 JavaScript runtime 파일이 있습니다: ${relativePath}`
  );
}

export function assertRootTypeSafetyScripts(manifest: unknown): void {
  assert(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "root package manifest가 객체가 아닙니다."
  );
  const scripts = (manifest as Record<string, unknown>).scripts;
  assert(
    scripts && typeof scripts === "object" && !Array.isArray(scripts),
    "root package scripts가 없습니다."
  );
  const scriptRecord = scripts as Record<string, unknown>;
  const requiredScripts = {
    build: "node --import tsx scripts/build-web.ts",
    validate: "node --import tsx scripts/validate-local-studio.ts",
    typecheck: "tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.web.source.json",
    "migration:check": "node --import tsx scripts/check-typescript-migration.ts",
    test: "node --import tsx scripts/run-tests.ts",
    check: "npm run typecheck && npm run migration:check && npm run build && npm run validate && npm run license:check && npm test && npm run audit"
  } as const;
  for (const [name, expected] of Object.entries(requiredScripts)) {
    assert(
      scriptRecord[name] === expected,
      `root package ${name} script는 ${JSON.stringify(expected)}여야 합니다.`
    );
  }
  const removedScripts = Object.keys(scriptRecord).filter((name) => (
    name.startsWith("legacy:extension:")
  ));
  assert(
    removedScripts.length === 0,
    `삭제된 전체 Extension script가 다시 생겼습니다: ${removedScripts.join(", ")}`
  );
}

function collectStringsAndKeys(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStringsAndKeys);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nestedValue]) => (
      [key, ...collectStringsAndKeys(nestedValue)]
    ));
  }
  return [];
}

export function assertPackageManifestHasNoAuthoredJavaScript(
  relativePath: string,
  manifest: unknown
): void {
  assert(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    `package manifest가 객체가 아닙니다: ${relativePath}`
  );
  const record = manifest as Record<string, unknown>;
  const entrypointFields = [
    "bin",
    "browser",
    "exports",
    "imports",
    "main",
    "module"
  ];
  const entrypoints = entrypointFields.flatMap((field) => (
    collectStringsAndKeys(record[field])
  )).filter((value) => javaScriptFamilyPattern.test(value.split(/[?#]/u, 1)[0] || ""));
  assert(
    entrypoints.length === 0,
    `package manifest가 작성 JavaScript를 노출합니다: ${relativePath} -> ${entrypoints.join(", ")}`
  );

  const scripts = record.scripts;
  if (scripts !== undefined) {
    assert(
      scripts && typeof scripts === "object" && !Array.isArray(scripts),
      `package scripts가 객체가 아닙니다: ${relativePath}`
    );
    for (const [name, command] of Object.entries(scripts)) {
      assert(typeof command === "string", `package script가 문자열이 아닙니다: ${relativePath}#${name}`);
      assertNoInlineJavaScriptCommand(`${relativePath}#${name}`, command);
    }
  }
}

function formatTypeScriptDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  rootDirectory: string
): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => rootDirectory,
    getNewLine: () => "\n"
  });
}

function readParsedTypeScriptConfig(rootDirectory: string, relativePath: string) {
  const configPath = path.join(rootDirectory, relativePath);
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  assert(
    !readResult.error,
    `TypeScript config를 읽을 수 없습니다: ${relativePath}\n${formatTypeScriptDiagnostics(
      readResult.error ? [readResult.error] : [],
      rootDirectory
    )}`
  );
  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    rootDirectory,
    undefined,
    configPath
  );
  assert(
    parsed.errors.length === 0,
    `TypeScript config가 유효하지 않습니다: ${relativePath}\n${formatTypeScriptDiagnostics(
      parsed.errors,
      rootDirectory
    )}`
  );
  return { parsed, raw: readResult.config as Record<string, unknown> };
}

function configFileSet(
  rootDirectory: string,
  fileNames: readonly string[]
): Set<string> {
  return new Set(fileNames.map((fileName) => (
    toPosixPath(path.relative(rootDirectory, fileName))
  )));
}

export function assertRequiredCompilerOptions(config: Record<string, unknown>): void {
  const compilerOptions = config.compilerOptions;
  assert(
    compilerOptions && typeof compilerOptions === "object" && !Array.isArray(compilerOptions),
    "tsconfig compilerOptions가 없습니다."
  );
  const options = compilerOptions as Record<string, unknown>;
  const requiredTrue = [
    "alwaysStrict",
    "erasableSyntaxOnly",
    "exactOptionalPropertyTypes",
    "forceConsistentCasingInFileNames",
    "isolatedModules",
    "moduleDetection",
    "noFallthroughCasesInSwitch",
    "noImplicitAny",
    "noImplicitOverride",
    "noImplicitReturns",
    "noImplicitThis",
    "noUncheckedIndexedAccess",
    "noUncheckedSideEffectImports",
    "noUnusedLocals",
    "noUnusedParameters",
    "strict",
    "strictBindCallApply",
    "strictBuiltinIteratorReturn",
    "strictFunctionTypes",
    "strictNullChecks",
    "strictPropertyInitialization",
    "useUnknownInCatchVariables",
    "verbatimModuleSyntax"
  ];
  for (const option of requiredTrue) {
    const expected = option === "moduleDetection" ? "force" : true;
    assert(
      options[option] === expected,
      `TypeScript ${option}는 ${JSON.stringify(expected)}여야 합니다.`
    );
  }
  for (const option of [
    "allowImportingTsExtensions",
    "allowJs",
    "allowUnreachableCode",
    "allowUnusedLabels",
    "checkJs",
    "noCheck"
  ]) {
    assert(options[option] === false, `TypeScript ${option}는 false여야 합니다.`);
  }
  assert(options.noEmit === true, "tsc는 작성 위치에 JavaScript를 내보내면 안 됩니다.");
}

function scriptKindFor(relativePath: string): ts.ScriptKind {
  return relativePath.toLowerCase().endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
}

function unwrapAssertionOperand(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function findForbiddenTypeScriptSyntax(
  relativePath: string,
  contents: string
): string[] {
  const forbiddenTypeSyntax: string[] = [];
  const sourceFile = ts.createSourceFile(
    relativePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relativePath)
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics || [];
  if (parseDiagnostics.length > 0) {
    forbiddenTypeSyntax.push(`${relativePath} (TypeScript parse 오류)`);
  }
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      forbiddenTypeSyntax.push(
        `${relativePath}:${position.line + 1}:${position.character + 1} (any)`
      );
    }
    if (
      relativePath.startsWith("src/")
      && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
    ) {
      const innerExpression = unwrapAssertionOperand(node.expression);
      if (
        ts.isAsExpression(innerExpression)
        || ts.isTypeAssertionExpression(innerExpression)
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        forbiddenTypeSyntax.push(
          `${relativePath}:${position.line + 1}:${position.character + 1} (이중 타입 단언)`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (/@ts-(?:expect-error|ignore|nocheck)\b/u.test(contents)) {
    forbiddenTypeSyntax.push(`${relativePath} (TypeScript 억제 지시문)`);
  }
  return forbiddenTypeSyntax;
}

async function assertTypeScriptSyntaxPolicy(
  rootDirectory: string,
  authoredTypeScriptFiles: readonly string[]
): Promise<void> {
  const forbiddenTypeSyntax: string[] = [];
  for (const relativePath of authoredTypeScriptFiles) {
    const contents = await readFile(path.join(rootDirectory, relativePath), "utf8");
    forbiddenTypeSyntax.push(...findForbiddenTypeScriptSyntax(relativePath, contents));
  }
  assert(
    forbiddenTypeSyntax.length === 0,
    `금지된 TypeScript 구문이 있습니다: ${forbiddenTypeSyntax.join(", ")}`
  );
}

export function assertGeneratedBuildInputs(inputs: readonly string[]): void {
  const approvedDependencyInput = /^(?:\(disabled\):)?node_modules\/mediabunny\/dist\/modules\/.+\.js$/u;
  const invalidInputs = inputs.filter((inputPath) => (
    !(inputPath.startsWith("src/") && typeScriptFamilyPattern.test(inputPath))
    && !approvedDependencyInput.test(inputPath)
  ));
  assert(
    invalidInputs.length === 0,
    `생성 JavaScript가 승인되지 않은 입력을 포함합니다: ${invalidInputs.join(", ")}`
  );
}

export function assertGeneratedJavaScriptBytes(
  relativePath: string,
  actualContents: Uint8Array,
  expectedContents: Uint8Array,
  rootDirectory: string
): void {
  const actualBuffer = Buffer.from(actualContents);
  assert(
    actualBuffer.subarray(0, GENERATED_JAVASCRIPT_BANNER.length).toString("utf8")
      === GENERATED_JAVASCRIPT_BANNER,
    `TypeScript 생성물 표시가 없습니다: ${relativePath}`
  );
  assert(
    !actualBuffer.includes(Buffer.from("sourceMappingURL=")),
    `배포 JavaScript에 source map 참조가 있습니다: ${relativePath}`
  );
  assert(
    Buffer.compare(actualBuffer, Buffer.from(expectedContents)) === 0,
    `TypeScript 원본과 생성 JavaScript가 일치하지 않습니다: ${relativePath}\n` +
      "npm run build로 생성물을 갱신하세요."
  );
  assert(
    !actualBuffer.includes(Buffer.from(rootDirectory)),
    `생성 JavaScript에 checkout 절대경로가 포함됐습니다: ${relativePath}`
  );
}

async function assertGeneratedJavaScript(
  rootDirectory: string,
  repositoryFiles: readonly string[]
): Promise<void> {
  const expectedWebJavaScript = new Set(
    WEB_JAVASCRIPT_PATHS.map((relativePath) => `web/${relativePath}`)
  );
  const actualWebJavaScript = repositoryFiles.filter((relativePath) => (
    relativePath.startsWith("web/") && javaScriptFamilyPattern.test(relativePath)
  ));
  assert(
    sameStrings(actualWebJavaScript, expectedWebJavaScript),
    "localhost web JavaScript 생성물 목록이 typed manifest와 다릅니다.\n" +
      `expected=${JSON.stringify(sortedValues(expectedWebJavaScript))}\n` +
      `actual=${JSON.stringify(actualWebJavaScript)}`
  );

  const actualCompanionJavaScript = repositoryFiles.filter((relativePath) => (
    relativePath.startsWith("streaming-companion/")
    && javaScriptFamilyPattern.test(relativePath)
  ));
  assert(
    sameStrings(actualCompanionJavaScript, (
      STREAMING_COMPANION_JAVASCRIPT_PATHS.map((relativePath) => (
        `streaming-companion/${relativePath}`
      ))
    )),
    "최소 스트리밍 companion JavaScript 생성물 목록이 typed manifest와 다릅니다."
  );

  const builds = [
    {
      rootName: "web",
      paths: WEB_JAVASCRIPT_PATHS,
      targets: WEB_JAVASCRIPT_TARGETS,
      result: await buildWebJavaScript({
        rootDirectory,
        write: false,
        logLevel: "silent"
      })
    },
    {
      rootName: "streaming-companion",
      paths: STREAMING_COMPANION_JAVASCRIPT_PATHS,
      targets: [
        {
          sourcePath: STREAMING_COMPANION_SOURCE_PATH,
          outputPath: STREAMING_COMPANION_JAVASCRIPT_PATH
        },
        {
          sourcePath: SOOP_STREAMING_COMPANION_SOURCE_PATH,
          outputPath: SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH
        }
      ],
      result: await buildStreamingCompanion({
        rootDirectory,
        write: false,
        logLevel: "silent"
      })
    }
  ];
  for (const built of builds) {
    assertGeneratedBuildInputs(built.result.inputs);
    const inputSet = new Set(built.result.inputs);
    const missingEntryPoints = built.targets
      .map(({ sourcePath }) => sourcePath)
      .filter((sourcePath) => !inputSet.has(sourcePath));
    assert(
      missingEntryPoints.length === 0,
      `typed build manifest 진입점이 실제 빌드 입력에서 빠졌습니다: ${missingEntryPoints.join(", ")}`
    );
    for (const relativePath of built.paths) {
      const expectedContents = built.result.outputs.get(relativePath);
      assert(
        expectedContents,
        `생성 예정 JavaScript가 없습니다: ${built.rootName}/${relativePath}`
      );
      const actualContents = await readFile(
        path.join(rootDirectory, built.rootName, relativePath)
      );
      assertGeneratedJavaScriptBytes(
        `${built.rootName}/${relativePath}`,
        actualContents,
        expectedContents,
        rootDirectory
      );
    }
  }
}

export async function runTypeScriptMigrationCheck(
  rootDirectory = defaultRoot
): Promise<TypeScriptMigrationReport> {
  const repositoryFiles = await listRepositoryFiles(rootDirectory);
  const removedExtensionArtifacts = repositoryFiles.filter((relativePath) => (
    relativePath.startsWith("extension/")
  ));
  assert(
    removedExtensionArtifacts.length === 0,
    `삭제된 전체 Extension 산출물이 다시 생겼습니다: ${removedExtensionArtifacts.join(", ")}`
  );
  for (const relativePath of repositoryFiles.filter((filePath) => (
    !typeScriptFamilyPattern.test(filePath)
  ))) {
    const contents = await readFile(path.join(rootDirectory, relativePath));
    assertNoJavaScriptRuntimeShebang(
      relativePath,
      contents.subarray(0, 512).toString("utf8")
    );
  }
  const authoredJavaScript = findAuthoredJavaScriptFiles(repositoryFiles);
  assert(
    authoredJavaScript.length === 0,
    `작성 JavaScript가 다시 생겼습니다: ${authoredJavaScript.join(", ")}`
  );

  const declarationFiles = repositoryFiles.filter((relativePath) => (
    declarationFilePattern.test(relativePath)
  ));
  assert(
    declarationFiles.length === 0,
    `작성 declaration만으로 JavaScript를 우회할 수 없습니다: ${declarationFiles.join(", ")}`
  );
  const allAuthoredTypeScriptFiles = repositoryFiles.filter((relativePath) => (
    typeScriptFamilyPattern.test(relativePath)
    && !declarationFilePattern.test(relativePath)
  ));
  const authoredTypeScriptFiles = allAuthoredTypeScriptFiles;
  await assertTypeScriptSyntaxPolicy(rootDirectory, authoredTypeScriptFiles);

  const tsconfigFiles = repositoryFiles.filter((relativePath) => (
    /(?:^|\/)tsconfig(?:\.[\w-]+)*\.json$/u.test(relativePath)
  ));
  const expectedTypeScriptConfigs = [
    "tsconfig.json",
    "tsconfig.web.json",
    "tsconfig.web.source.json"
  ];
  assert(
    sameStrings(tsconfigFiles, expectedTypeScriptConfigs),
    `승인되지 않았거나 빠진 tsconfig이 있습니다: ${tsconfigFiles.join(", ")}`
  );
  const rootConfig = JSON.parse(
    await readFile(path.join(rootDirectory, "tsconfig.json"), "utf8")
  ) as Record<string, unknown>;
  assertRequiredCompilerOptions(rootConfig);
  assert(
    Array.isArray(rootConfig.include)
      && rootConfig.include.length === 0,
    "공통 tsconfig.json은 독립적으로 TypeScript 파일을 선택하면 안 됩니다."
  );
  const webConfig = readParsedTypeScriptConfig(rootDirectory, "tsconfig.web.json");
  const compiledFiles = configFileSet(rootDirectory, webConfig.parsed.fileNames);
  const webAuthoredTypeScriptFiles = allAuthoredTypeScriptFiles;
  assert(
    sameStrings(compiledFiles, webAuthoredTypeScriptFiles),
    "localhost web 작성 TypeScript와 tsc 검사 대상이 다릅니다.\n" +
      `authored=${JSON.stringify(webAuthoredTypeScriptFiles)}\n` +
      `compiled=${JSON.stringify(sortedValues(compiledFiles))}`
  );
  const sourceConfig = readParsedTypeScriptConfig(
    rootDirectory,
    "tsconfig.web.source.json"
  );
  const productionSources = webAuthoredTypeScriptFiles.filter((relativePath) => (
    relativePath.startsWith("src/")
  ));
  const sourceCompiledFiles = configFileSet(rootDirectory, sourceConfig.parsed.fileNames);
  assert(
    sameStrings(sourceCompiledFiles, productionSources),
    "localhost web production TypeScript 검사 대상이 다릅니다."
  );

  const forbiddenWebPackageFiles = WEB_PACKAGE_FILES.filter((relativePath) => (
    typeScriptFamilyPattern.test(relativePath)
    || declarationFilePattern.test(relativePath)
    || /\.(?:map|tsbuildinfo)$/iu.test(relativePath)
    || relativePath === "tsconfig.json"
    || relativePath.startsWith("node_modules/")
    || relativePath.startsWith("extension/")
  ));
  assert(
    forbiddenWebPackageFiles.length === 0,
    `앱 web assets에 도구·소스·Extension 파일이 들어갑니다: ${forbiddenWebPackageFiles.join(", ")}`
  );
  const packagedWebJavaScript = WEB_PACKAGE_FILES.filter((relativePath) => (
    javaScriptFamilyPattern.test(relativePath)
  ));
  assert(
    sameStrings(packagedWebJavaScript, WEB_JAVASCRIPT_PATHS),
    "앱 web assets JavaScript와 typed build manifest가 다릅니다."
  );

  for (const relativePath of repositoryFiles.filter((filePath) => (
    filePath.toLowerCase().endsWith(".html")
  ))) {
    assertNoInlineJavaScript(
      relativePath,
      await readFile(path.join(rootDirectory, relativePath), "utf8")
    );
  }
  for (const relativePath of repositoryFiles.filter((filePath) => (
    filePath.toLowerCase().endsWith(".sh")
  ))) {
    assertNoInlineJavaScriptCommand(
      relativePath,
      await readFile(path.join(rootDirectory, relativePath), "utf8")
    );
  }
  for (const relativePath of repositoryFiles.filter((filePath) => (
    path.posix.basename(filePath).toLowerCase() === "package.json"
  ))) {
    const manifest = JSON.parse(
      await readFile(path.join(rootDirectory, relativePath), "utf8")
    ) as unknown;
    assertPackageManifestHasNoAuthoredJavaScript(relativePath, manifest);
    if (relativePath === "package.json") {
      assertRootTypeSafetyScripts(manifest);
    }
  }

  const attributes = await readFile(path.join(rootDirectory, ".gitattributes"), "utf8");
  assert(
    /^web\/\*\*\/\*\.js\s+linguist-generated=true$/mu.test(attributes),
    "GitHub 언어 통계에서 localhost web 생성 JavaScript를 명시해야 합니다."
  );
  assert(
    /^streaming-companion\/\*\*\/\*\.js\s+linguist-generated=true$/mu.test(attributes),
    "GitHub 언어 통계에서 최소 companion 생성 JavaScript를 명시해야 합니다."
  );
  await assertGeneratedJavaScript(
    rootDirectory,
    repositoryFiles
  );

  return {
    ok: true,
    authoredTypeScriptFiles: authoredTypeScriptFiles.length,
    authoredJavaScriptFiles: 0,
    explicitAnyTypes: 0,
    typeSuppressionDirectives: 0,
    generatedJavaScriptFiles: WEB_JAVASCRIPT_PATHS.length
      + STREAMING_COMPANION_JAVASCRIPT_PATHS.length,
    generatedJavaScriptMatchesTypeScript: true,
    generatedFirstPartyInputsAreTypeScript: true,
    browserDistributionShipsTypeScript: false
  };
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    throw new TypeError("사용법: check-typescript-migration.ts");
  }
  console.log(JSON.stringify(await runTypeScriptMigrationCheck(defaultRoot), null, 2));
}
