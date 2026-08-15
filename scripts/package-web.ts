import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
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
import {
  PUBLIC_WEB_PACKAGE_FILES,
  WEB_PACKAGE_FILES
} from "./web-package-files.js";
import { readPackageSourceFile } from "./package-source-reader.js";

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
  readonly environment?: NodeJS.ProcessEnv;
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
  { cwd, capture = false, environment }: RunOptions = {}
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
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
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(
          (signal
            ? `${command}가 ${signal} 신호로 종료됐습니다.`
            : `${command}가 종료 코드 ${String(code)}로 끝났습니다.`)
          + (stderr ? `\n${stderr.trim()}` : "")
        ));
      }
    });
  });
}

try {
  const releaseSourceRevision = process.env.KIRINUKI_RELEASE_SOURCE_REVISION;
  assert(
    releaseSourceRevision === undefined
      || process.env.KIRINUKI_RELEASE_LOCK_TOKEN !== undefined,
    "release source revision은 활성 release lock과 함께 전달되어야 합니다."
  );
  const archiveToolEnvironment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => (
        name !== "UNZIPOPT" && name !== "ZIPOPT"
      ))
    ),
    TZ: "UTC"
  } satisfies NodeJS.ProcessEnv;
  const metadata = JSON.parse(
    (await readPackageSourceFile({
      repositoryRoot: root,
      repositoryPath: "package.json",
      ...(releaseSourceRevision === undefined
        ? {}
        : { sourceRevision: releaseSourceRevision })
    })).toString("utf8")
  ) as { readonly name?: string; readonly version?: string };
  assert(
    metadata.name === "kirinuki-app",
    "기본 패키지 이름이 Kirinuki 단일 앱을 가리키지 않습니다."
  );
  assert(
    typeof metadata.version === "string" && /^\d+\.\d+\.\d+$/u.test(metadata.version),
    "package.json version이 유효한 semver가 아닙니다."
  );

  const expectedApplicationFiles = [...WEB_PACKAGE_FILES].sort();
  const actualFiles = await listFiles(webRoot);
  assert(
    JSON.stringify(actualFiles) === JSON.stringify(expectedApplicationFiles),
    "앱 web 파일 목록이 allowlist와 다릅니다.\n"
      + `expected=${JSON.stringify(expectedApplicationFiles, null, 2)}\n`
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
  const [canonicalRoot, canonicalDistRoot, distMetadata] = await Promise.all([
    realpath(root),
    realpath(distRoot),
    lstat(distRoot)
  ]);
  assert(
    distMetadata.isDirectory()
      && canonicalDistRoot === path.join(canonicalRoot, "dist"),
    "dist 경로는 repository 바로 아래의 실제 디렉터리여야 합니다."
  );
  for (const entry of await readdir(distRoot)) {
    if (/^kirinuki-web-v.+\.zip(?:\.sha256)?$/u.test(entry)) {
      await rm(path.join(distRoot, entry), { force: true });
    }
  }

  const expectedFiles = PUBLIC_WEB_PACKAGE_FILES.map(
    ({ archivePath: packagedPath }) => packagedPath
  ).sort();
  const packageStageRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-public-shell-stage-"));
  try {
    const deterministicTimestamp = new Date("2000-01-01T00:00:00.000Z");
    for (const { archivePath: packagedPath, sourcePath } of PUBLIC_WEB_PACKAGE_FILES) {
      const destination = path.join(packageStageRoot, packagedPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, await readPackageSourceFile({
        repositoryRoot: root,
        repositoryPath: sourcePath,
        ...(releaseSourceRevision === undefined
          ? {}
          : { sourceRevision: releaseSourceRevision })
      }), {
        flag: "wx",
        mode: 0o644
      });
      await chmod(destination, 0o644);
      await utimes(destination, deterministicTimestamp, deterministicTimestamp);
    }
    await run("zip", ["-X", "-q", archivePath, ...expectedFiles], {
      cwd: packageStageRoot,
      environment: archiveToolEnvironment
    });
    await chmod(archivePath, 0o644);
  } finally {
    await rm(packageStageRoot, { recursive: true, force: true });
  }
  const archiveEntries = (await run(
    "unzip",
    ["-Z1", archivePath],
    { capture: true, environment: archiveToolEnvironment }
  )).stdout.split(/\r?\n/u).filter(Boolean).filter((entry) => !entry.endsWith("/")).sort();
  assert(
    JSON.stringify(archiveEntries) === JSON.stringify(expectedFiles),
    "생성된 공개 launch shell ZIP의 파일 목록이 allowlist와 다릅니다."
  );

  const extractRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-web-package-"));
  try {
    await run("unzip", ["-q", archivePath, "-d", extractRoot], {
      environment: archiveToolEnvironment
    });
    assert(
      (await listFiles(extractRoot)).every((relativePath) => (
        !relativePath.startsWith("extension/")
      )),
      "압축을 푼 기본 web 패키지에 extension 디렉터리가 있습니다."
    );
    const [indexHtml, publicCss, publicNotices, responseHeaders, hosts] = await Promise.all([
      readFile(path.join(extractRoot, "index.html"), "utf8"),
      readFile(path.join(extractRoot, "public.css"), "utf8"),
      readFile(path.join(extractRoot, "THIRD_PARTY_NOTICES.md"), "utf8"),
      readFile(path.join(extractRoot, "_headers"), "utf8"),
      readFile(path.join(extractRoot, ".popovic-hosts"), "utf8")
    ]);
    assert(
      indexHtml.includes(`href="/public.css?v=${metadata.version}"`)
        && !/<script\b/iu.test(indexHtml)
        && !indexHtml.includes("chrome-extension://"),
      "압축된 공개 HTML 진입점이 무스크립트 앱 실행 shell을 가리키지 않습니다."
    );
    assert(
      indexHtml.includes('class="public-launch-shell"')
        && indexHtml.includes('href="kirinuki://open"')
        && !indexHtml.includes("local-app-surface")
        && /script-src 'none'/u.test(
          /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u
            .exec(indexHtml)?.[1] || ""
        )
        && responseHeaders.includes("frame-ancestors 'none'")
        && responseHeaders.includes("X-Content-Type-Options: nosniff")
        && responseHeaders.includes("X-Frame-Options: DENY")
        && responseHeaders.includes("Permissions-Policy:")
        && responseHeaders.includes("Cross-Origin-Opener-Policy: same-origin")
        && responseHeaders.includes("Cross-Origin-Resource-Policy: same-origin")
        && hosts === "kirinuki.eff0rtchung.kr\n"
        && /제3자 JavaScript, 글꼴,\s*분석/u.test(publicNotices)
        && !/127\.0\.0\.1|localhost|:4319|\/v1\/|editor\.html|studio\.js|audseg-worker/iu.test(
          `${indexHtml}\n${publicCss}\n${publicNotices}\n${responseHeaders}`
        ),
      "공개 web 패키지가 shell-only 또는 public-safe CSP 계약과 맞지 않습니다."
    );
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }

  const archive = await readFile(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  await writeFile(checksumPath, `${digest}  ${archiveName}\n`, {
    mode: 0o644
  });
  await chmod(checksumPath, 0o644);
  console.log(JSON.stringify({
    archive: path.relative(root, archivePath),
    bytes: archive.byteLength,
    files: expectedFiles.length,
    sha256: digest,
    checksum: path.relative(root, checksumPath),
    sourceRevision: releaseSourceRevision ?? null,
    runtime: "public-launch-shell",
    chromeExtensionIncluded: false
  }, null, 2));
} finally {
  await releaseDevRunnerLock(devRunnerLockLease);
}
