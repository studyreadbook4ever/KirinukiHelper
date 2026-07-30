import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { EXTENSION_PACKAGE_FILES } from "./extension-package-files.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const generatedBanner =
  "// Generated from TypeScript sources. Do not edit directly.";
const generatedJavaScript = new Set([
  "content-script.js",
  "editor/audseg-worker.js",
  "editor/editor.js",
  "lib/caption-style.js",
  "lib/core.js",
  "lib/editor-core.js",
  "lib/session-recovery.js",
  "lib/source-platform.js",
  "service-worker.js",
  "sidepanel.js"
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(
        path.join(directory, entry.name),
        relativePath
      ));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`작성 소스에 특수 파일을 둘 수 없습니다: ${relativePath}`);
    }
  }
  return files.sort();
}

const authoredFiles = (
  await Promise.all(
    ["scripts", "src", "tests"].map(async (directory) => (
      (await listFiles(path.join(root, directory)))
        .map((relativePath) => `${directory}/${relativePath}`)
    ))
  )
).flat().sort();
const nonTypeScriptSources = authoredFiles.filter((relativePath) => (
  /\.(?:js|jsx|mjs|cjs)$/iu.test(relativePath)
));
assert(
  nonTypeScriptSources.length === 0,
  `작성 JavaScript가 다시 생겼습니다: ${nonTypeScriptSources.join(", ")}`
);
assert(
  authoredFiles.every((relativePath) => relativePath.endsWith(".ts")),
  "scripts/, src/, tests/에는 TypeScript 작성 소스만 둘 수 있습니다."
);

const forbiddenTypeSyntax: string[] = [];
for (const relativePath of authoredFiles) {
  const contents = await readFile(path.join(root, relativePath), "utf8");
  const sourceFile = ts.createSourceFile(
    relativePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      forbiddenTypeSyntax.push(
        `${relativePath}:${position.line + 1}:${position.character + 1} (any)`
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (/@ts-(?:expect-error|ignore|nocheck)\b/u.test(contents)) {
    forbiddenTypeSyntax.push(`${relativePath} (TypeScript 억제 지시문)`);
  }
}
assert(
  forbiddenTypeSyntax.length === 0,
  `명시적 any 또는 TypeScript 억제 지시문이 있습니다: ${forbiddenTypeSyntax.join(", ")}`
);

const extensionRoot = path.join(root, "extension");
const actualGeneratedJavaScript = new Set(
  (await listFiles(extensionRoot))
    .filter((relativePath) => relativePath.endsWith(".js"))
);
assert(
  JSON.stringify([...actualGeneratedJavaScript].sort())
    === JSON.stringify([...generatedJavaScript].sort()),
  "Extension JavaScript 생성물 목록이 승인된 10개와 다릅니다."
);
for (const relativePath of generatedJavaScript) {
  const contents = await readFile(
    path.join(extensionRoot, relativePath),
    "utf8"
  );
  assert(
    contents.startsWith(`${generatedBanner}\n`),
    `TypeScript 생성물 표시가 없습니다: extension/${relativePath}`
  );
  assert(
    !contents.includes("sourceMappingURL="),
    `배포 JavaScript에 source map 참조가 있습니다: extension/${relativePath}`
  );
}

const forbiddenPackageFiles = EXTENSION_PACKAGE_FILES.filter(
  (relativePath) => (
    /\.(?:ts|tsx|map)$/iu.test(relativePath)
    || relativePath === "tsconfig.json"
    || relativePath.startsWith("node_modules/")
  )
);
assert(
  forbiddenPackageFiles.length === 0,
  `Extension ZIP에 TypeScript 도구·소스가 들어갑니다: ${forbiddenPackageFiles.join(", ")}`
);

const [packageJsonText, tsconfigText, launcherText] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8"),
  readFile(path.join(root, "tsconfig.json"), "utf8"),
  readFile(path.join(root, "kirinuki.sh"), "utf8")
]);
const packageJson = JSON.parse(packageJsonText) as {
  scripts?: Record<string, string>;
};
const tsconfig = JSON.parse(tsconfigText) as {
  compilerOptions?: {
    strict?: boolean;
    allowJs?: boolean;
    noEmit?: boolean;
  };
};
assert(tsconfig.compilerOptions?.strict === true, "TypeScript strict가 꺼져 있습니다.");
assert(tsconfig.compilerOptions.allowJs === false, "TypeScript allowJs는 false여야 합니다.");
assert(tsconfig.compilerOptions.noEmit === true, "tsc는 작성 위치에 JavaScript를 내보내면 안 됩니다.");
assert(
  Object.values(packageJson.scripts || {}).every((command) => (
    !/\b(?:scripts|src|tests)\/[^\s]+?\.(?:js|mjs|cjs|jsx)\b/u.test(command)
  )),
  "package script가 작성 JavaScript 진입점을 실행합니다."
);
assert(
  !/\bnode\s+-(?:e|p)\b/u.test(launcherText),
  "Linux launcher에 inline JavaScript가 있습니다."
);
assert(
  !/\bscripts\/[^\s"']+\.(?:js|mjs|cjs|jsx)\b/u.test(launcherText),
  "Linux launcher가 작성 JavaScript 진입점을 실행합니다."
);

console.log(JSON.stringify({
  ok: true,
  authoredTypeScriptFiles: authoredFiles.length,
  authoredJavaScriptFiles: 0,
  explicitAnyTypes: 0,
  typeSuppressionDirectives: 0,
  generatedJavaScriptFiles: generatedJavaScript.size,
  extensionShipsTypeScript: false
}, null, 2));
