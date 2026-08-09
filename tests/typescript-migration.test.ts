import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertGeneratedBuildInputs,
  assertGeneratedJavaScriptBytes,
  assertNoJavaScriptRuntimeShebang,
  assertNoInlineJavaScript,
  assertNoInlineJavaScriptCommand,
  assertPackageManifestHasNoAuthoredJavaScript,
  assertRequiredCompilerOptions,
  assertRootTypeSafetyScripts,
  findAuthoredJavaScriptFiles,
  findForbiddenTypeScriptSyntax,
  runTypeScriptMigrationCheck
} from "../scripts/check-typescript-migration.js";
import {
  EXTENSION_JAVASCRIPT_PATHS,
  GENERATED_JAVASCRIPT_BANNER
} from "../scripts/extension-javascript-build.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("저장소 전체 JavaScript inventory는 typed 생성물만 허용한다", () => {
  assert.deepEqual(findAuthoredJavaScriptFiles([
    "extension/editor/editor.js",
    "extension/sidepanel.js"
  ]), []);
  assert.deepEqual(findAuthoredJavaScriptFiles([
    "extension/editor/editor.js",
    "extension/rogue.JS",
    "root.cjs",
    "tools/build.mjs",
    "web/client.jsx"
  ]), [
    "extension/rogue.JS",
    "root.cjs",
    "tools/build.mjs",
    "web/client.jsx"
  ]);
});

test("HTML과 명령행의 inline 또는 작성 JavaScript를 fail closed한다", async () => {
  assert.doesNotThrow(() => assertNoInlineJavaScript(
    "extension/editor.html",
    '<script type="module" src="editor/editor.js"></script>'
  ));
  assert.throws(
    () => assertNoInlineJavaScript("extension/editor.html", "<script>alert(1)</script>"),
    /inline script/u
  );
  assert.throws(
    () => assertNoInlineJavaScript(
      "extension/editor.html",
      '<button onclick="run()">실행</button>'
    ),
    /event handler/u
  );
  assert.throws(
    () => assertNoInlineJavaScript(
      "extension/editor.html",
      "<svg/onload=run()></svg>"
    ),
    /event handler/u
  );
  assert.throws(
    () => assertNoInlineJavaScript(
      "extension/editor.html",
      "<a href=javascript:run()>실행</a>"
    ),
    /javascript: URL/u
  );
  assert.throws(
    () => assertNoInlineJavaScript(
      "extension/editor.html",
      "<a href=java&#115;cript&colon;run()>실행</a>"
    ),
    /javascript: URL/u
  );
  assert.throws(
    () => assertNoInlineJavaScript(
      "extension/editor.html",
      '<script src="rogue.js"></script>'
    ),
    /승인되지 않은 JavaScript/u
  );
  assert.throws(
    () => assertNoInlineJavaScriptCommand("package.json#bad", "node --eval 'run()'"),
    /inline JavaScript/u
  );
  assert.throws(
    () => assertNoInlineJavaScriptCommand("setup.sh", "node tools/build.js"),
    /작성 JavaScript 진입점/u
  );
  assert.throws(
    () => assertNoInlineJavaScriptCommand(
      "setup.sh",
      "node <<'JS'\nconsole.log('inline')\nJS"
    ),
    /stdin\/heredoc JavaScript/u
  );
  assert.throws(
    () => assertNoInlineJavaScriptCommand(
      "setup.sh",
      "node --input-type=module <<<\"console.log('inline')\""
    ),
    /stdin\/heredoc JavaScript/u
  );
  assert.throws(
    () => assertNoInlineJavaScriptCommand("setup.sh", "node tools/build"),
    /확장자 없는 JavaScript 진입점/u
  );
  assert.throws(
    () => assertNoJavaScriptRuntimeShebang(
      "tools/build",
      "#!/usr/bin/env node\nconsole.log('hidden');\n"
    ),
    /runtime 파일/u
  );
  assert.doesNotThrow(() => assertNoJavaScriptRuntimeShebang(
    "scripts/build.ts",
    "#!/usr/bin/env node\nexport {};\n"
  ));
  const launcher = await readFile(path.join(root, "kirinuki.sh"), "utf8");
  assert.doesNotThrow(() => assertNoInlineJavaScriptCommand(
    "kirinuki.sh",
    launcher
  ));
});

test("package 진입점과 compiler strict 하위 옵션 우회를 막는다", () => {
  assert.doesNotThrow(() => assertPackageManifestHasNoAuthoredJavaScript(
    "package.json",
    {
      scripts: {
        check: "node --import tsx scripts/check.ts"
      }
    }
  ));
  assert.throws(
    () => assertPackageManifestHasNoAuthoredJavaScript(
      "package.json",
      { exports: { ".": "./dist/index.js" } }
    ),
    /작성 JavaScript를 노출/u
  );

  const compilerOptions = {
    allowImportingTsExtensions: false,
    allowJs: false,
    allowUnreachableCode: false,
    allowUnusedLabels: false,
    alwaysStrict: true,
    checkJs: false,
    erasableSyntaxOnly: true,
    exactOptionalPropertyTypes: true,
    forceConsistentCasingInFileNames: true,
    isolatedModules: true,
    moduleDetection: "force",
    noEmit: true,
    noFallthroughCasesInSwitch: true,
    noImplicitAny: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noImplicitThis: true,
    noUncheckedIndexedAccess: true,
    noUncheckedSideEffectImports: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noCheck: false,
    strict: true,
    strictBindCallApply: true,
    strictBuiltinIteratorReturn: true,
    strictFunctionTypes: true,
    strictNullChecks: true,
    strictPropertyInitialization: true,
    useUnknownInCatchVariables: true,
    verbatimModuleSyntax: true
  };
  assert.doesNotThrow(() => assertRequiredCompilerOptions({ compilerOptions }));
  assert.throws(
    () => assertRequiredCompilerOptions({
      compilerOptions: { ...compilerOptions, strictNullChecks: false }
    }),
    /strictNullChecks/u
  );
  assert.throws(
    () => assertRequiredCompilerOptions({
      compilerOptions: { ...compilerOptions, noCheck: true }
    }),
    /noCheck/u
  );
  assert.throws(
    () => assertRequiredCompilerOptions({
      compilerOptions: { ...compilerOptions, strictBuiltinIteratorReturn: false }
    }),
    /strictBuiltinIteratorReturn/u
  );

  const requiredScripts = {
    typecheck: "tsc --noEmit && tsc --noEmit -p tsconfig.source.json",
    "migration:check": "node --import tsx scripts/check-typescript-migration.ts",
    check: "npm run typecheck && npm run migration:check && npm run build && npm run validate && npm run license:check && npm test && npm run audit"
  };
  assert.doesNotThrow(() => assertRootTypeSafetyScripts({ scripts: requiredScripts }));
  assert.throws(
    () => assertRootTypeSafetyScripts({
      scripts: {
        ...requiredScripts,
        typecheck: "tsc --noEmit --noCheck"
      }
    }),
    /typecheck script/u
  );
});

test("production 이중 타입 단언은 괄호와 unknown 별칭으로 우회할 수 없다", () => {
  assert.deepEqual(findForbiddenTypeScriptSyntax(
    "src/safe.ts",
    "declare const value: unknown; export const safe = value as { id?: string };"
  ), []);
  const violations = findForbiddenTypeScriptSyntax(
    "src/unsafe.ts",
    [
      "type Opaque = unknown;",
      "declare const value: string;",
      "export const unsafe = (value as Opaque) as { id: string };"
    ].join("\n")
  );
  assert.match(violations.join("\n"), /이중 타입 단언/u);
});

test("생성물 provenance와 바이트 drift를 검증한다", () => {
  assert.doesNotThrow(() => assertGeneratedBuildInputs([
    "src/editor/main.ts",
    "node_modules/mediabunny/dist/modules/src/index.js",
    "(disabled):node_modules/mediabunny/dist/modules/src/node.js"
  ]));
  assert.throws(
    () => assertGeneratedBuildInputs(["vendor/rogue.js"]),
    /승인되지 않은 입력/u
  );

  const expected = Buffer.from(`${GENERATED_JAVASCRIPT_BANNER}\nconsole.log("safe");\n`);
  assert.doesNotThrow(() => assertGeneratedJavaScriptBytes(
    "safe.js",
    expected,
    expected,
    "/checkout/kirinuki"
  ));
  assert.throws(
    () => assertGeneratedJavaScriptBytes(
      "tampered.js",
      Buffer.from(`${GENERATED_JAVASCRIPT_BANNER}\nconsole.log("tampered");\n`),
      expected,
      "/checkout/kirinuki"
    ),
    /일치하지 않습니다/u
  );
});

test("현재 저장소는 작성 JS 0개와 생성 JS 12개의 완전한 migration을 증명한다", async () => {
  const report = await runTypeScriptMigrationCheck(root);
  assert.equal(report.ok, true);
  assert.equal(report.authoredJavaScriptFiles, 0);
  assert.equal(report.generatedJavaScriptFiles, EXTENSION_JAVASCRIPT_PATHS.length);
  assert.equal(report.generatedJavaScriptMatchesTypeScript, true);
  assert.equal(report.generatedFirstPartyInputsAreTypeScript, true);
  assert.ok(report.authoredTypeScriptFiles >= 73);
});
