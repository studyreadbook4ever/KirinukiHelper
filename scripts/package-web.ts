import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireDevRunnerLock,
  failClosedOnDevRunnerOwnerLoss,
  releaseDevRunnerLock
} from "./dev-runner-lock.js";
import { WEB_PACKAGE_FILES } from "./web-package-files.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = path.join(root, "web");
const devRunnerLockLease = await acquireDevRunnerLock(
  path.join(root, ".dev-editor.lock"),
  {
    pid: process.pid,
    role: "package",
    ...(process.env.KIRINUKI_RELEASE_LOCK_TOKEN === undefined
      ? {}
      : { inheritedToken: process.env.KIRINUKI_RELEASE_LOCK_TOKEN }),
    onOwnerLost: failClosedOnDevRunnerOwnerLoss("package:web")
  }
);

interface RunOptions {
  readonly cwd?: string;
  readonly capture?: boolean;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(
        `웹 패키지에 심볼릭 링크나 특수 파일을 넣을 수 없습니다: ${relativePath}`
      );
    }
  }
  return files.sort();
}

async function run(
  command: string,
  args: readonly string[],
  { cwd, capture = false }: RunOptions = {}
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(
          `${command}가 종료 코드 ${String(code)}로 끝났습니다.`
          + (stderr ? `\n${stderr.trim()}` : "")
        ));
      }
    });
  });
}

try {
  const metadata = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  ) as { readonly name?: string; readonly version?: string };
  assert(
    metadata.name === "kirinuki-local-web-studio",
    "기본 패키지 이름이 localhost web studio를 가리키지 않습니다."
  );
  assert(
    typeof metadata.version === "string" && /^\d+\.\d+\.\d+$/u.test(metadata.version),
    "package.json version이 유효한 semver가 아닙니다."
  );

  const expectedFiles = [...WEB_PACKAGE_FILES].sort();
  const actualFiles = await listFiles(webRoot);
  assert(
    JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
    "web 패키지 파일 목록이 allowlist와 다릅니다.\n"
      + `expected=${JSON.stringify(expectedFiles, null, 2)}\n`
      + `actual=${JSON.stringify(actualFiles, null, 2)}`
  );
  assert(
    actualFiles.every((relativePath) => (
      !relativePath.includes("manifest.json")
      && !relativePath.includes("sidepanel")
      && !relativePath.includes("service-worker")
      && !relativePath.includes("storage-migration")
    )),
    "기본 web 배포물에 Chrome Extension 또는 migration 전용 진입점이 섞였습니다."
  );

  const distRoot = path.join(root, "dist");
  const archiveName = `kirinuki-web-v${metadata.version}.zip`;
  const archivePath = path.join(distRoot, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  await mkdir(distRoot, { recursive: true });
  for (const entry of await readdir(distRoot)) {
    if (/^kirinuki-web-v.+\.zip(?:\.sha256)?$/u.test(entry)) {
      await rm(path.join(distRoot, entry), { force: true });
    }
  }

  await run("zip", ["-q", archivePath, ...expectedFiles], { cwd: webRoot });
  const archiveEntries = (await run(
    "unzip",
    ["-Z1", archivePath],
    { capture: true }
  )).stdout.split(/\r?\n/u).filter(Boolean).filter((entry) => !entry.endsWith("/")).sort();
  assert(
    JSON.stringify(archiveEntries) === JSON.stringify(expectedFiles),
    "생성된 web ZIP의 파일 목록이 allowlist와 다릅니다."
  );

  const extractRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-web-package-"));
  try {
    await run("unzip", ["-q", archivePath, "-d", extractRoot]);
    assert(
      (await listFiles(extractRoot)).every((relativePath) => (
        !relativePath.startsWith("extension/")
      )),
      "압축을 푼 기본 web 패키지에 extension 디렉터리가 있습니다."
    );
    const [indexHtml, editorHtml] = await Promise.all([
      readFile(path.join(extractRoot, "index.html"), "utf8"),
      readFile(path.join(extractRoot, "editor.html"), "utf8")
    ]);
    assert(
      indexHtml.includes(`src="/studio.js?v=${metadata.version}"`)
        && editorHtml.includes(`src="editor/editor.js?v=${metadata.version}"`)
        && !indexHtml.includes("chrome-extension://")
        && !editorHtml.includes("chrome-extension://"),
      "압축된 web HTML 진입점이 Extension-free runtime을 가리키지 않습니다."
    );
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }

  const archive = await readFile(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  await writeFile(checksumPath, `${digest}  ${archiveName}\n`);
  console.log(JSON.stringify({
    archive: path.relative(root, archivePath),
    bytes: archive.byteLength,
    files: expectedFiles.length,
    sha256: digest,
    checksum: path.relative(root, checksumPath),
    runtime: "localhost-web",
    chromeExtensionIncluded: false
  }, null, 2));
} finally {
  await releaseDevRunnerLock(devRunnerLockLease);
}
