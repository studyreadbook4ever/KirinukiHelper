import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testsRoot = path.join(root, "tests");
const args = process.argv.slice(2);
if (args.length > 0) {
  throw new TypeError("사용법: run-tests.ts");
}

const allTestFiles = (await readdir(testsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => `tests/${entry.name}`)
  .sort();
if (allTestFiles.length === 0) {
  throw new Error("실행할 TypeScript test가 없습니다.");
}

function runTestGroup(testFiles: readonly string[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      "--test",
      ...testFiles
    ], {
      cwd: root,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`TypeScript test가 ${signal} 신호로 종료됐습니다.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const exitCode = await runTestGroup(allTestFiles);
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
