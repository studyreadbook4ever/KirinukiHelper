import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PUBLIC_SHELL_PORT,
  MAX_PUBLIC_SHELL_ASSET_BYTES,
  PUBLIC_SHELL_BIND_HOST,
  PUBLIC_SHELL_CANONICAL_HOST,
  PUBLIC_SHELL_CANONICAL_URL,
  PUBLIC_SHELL_SECURITY_HEADERS,
  createPublicShellHttpServer,
  hasExactPublicShellHost,
  loadPublicShellSecurityHeaders,
  normalizedPublicShellDeviceId,
  parsePublicShellHeaders,
  publicShellRequestPath,
  resolvePublicShellStaticAsset,
  samePublicShellFileObjectIdentity
} from "../scripts/public-shell-server-core.js";
import {
  PUBLIC_SHELL_BIND_ENV,
  PUBLIC_SHELL_PORT_ENV,
  parsePublicShellServerArgs,
  publicShellServerHelpText
} from "../scripts/public-shell-server.js";
import {
  parsePublicDeploymentCheckArgs,
  parsePublicDeploymentUrl,
  publicDeploymentViolations,
  validatePublicDeploymentSnapshot
} from "../scripts/check-public-deployment.js";
import { PUBLIC_WEB_PACKAGE_FILES } from "../scripts/web-package-files.js";

interface HttpResult {
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly status: number;
}

const repositoryWeb = new URL("../web/", import.meta.url);

test("Windows public-shell path/fd identity는 low32 dev만 정규화한다", () => {
  const low32 = 0x89abcdefn;
  const pathDevice = (0x12345678n << 32n) | low32;
  const pathIdentity = { dev: pathDevice, ino: 7n, size: 11n, nlink: 1n };
  const handleIdentity = { ...pathIdentity, dev: low32 };
  assert.equal(normalizedPublicShellDeviceId(pathDevice, "win32"), low32);
  assert.equal(normalizedPublicShellDeviceId(pathDevice, "linux"), pathDevice);
  assert.equal(samePublicShellFileObjectIdentity(
    pathIdentity,
    handleIdentity,
    "win32"
  ), true);
  assert.equal(samePublicShellFileObjectIdentity(
    pathIdentity,
    handleIdentity,
    "linux"
  ), false);
  assert.equal(samePublicShellFileObjectIdentity(pathIdentity, {
    ...handleIdentity,
    ino: 8n
  }, "win32"), false);
  assert.equal(samePublicShellFileObjectIdentity(pathIdentity, {
    ...handleIdentity,
    nlink: 2n
  }, "win32"), false);
});

async function createPublicShellFixture(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-public-shell-"
  )));
  for (const { archivePath: relativePath } of PUBLIC_WEB_PACKAGE_FILES) {
    await mkdir(path.dirname(path.join(root, ...relativePath.split("/"))), {
      recursive: true
    });
    await writeFile(
      path.join(root, ...relativePath.split("/")),
      await readFile(new URL(relativePath, repositoryWeb))
    );
  }
  return root;
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

async function requestServer(
  port: number,
  target: string,
  {
    body,
    headers = {},
    host = PUBLIC_SHELL_CANONICAL_HOST,
    method = "GET"
  }: {
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly host?: string;
    readonly method?: string;
  } = {}
): Promise<HttpResult> {
  return await new Promise<HttpResult>((resolve, reject) => {
    const request = httpRequest({
      headers: { Host: host, ...headers },
      host: PUBLIC_SHELL_BIND_HOST,
      method,
      path: target,
      port
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode || 0
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function assertSecurityHeaders(result: HttpResult): void {
  for (const [name, value] of Object.entries(PUBLIC_SHELL_SECURITY_HEADERS)) {
    assert.equal(result.headers[name.toLowerCase()], value, name);
  }
  for (const forbidden of [
    "set-cookie",
    "nel",
    "report-to",
    "access-control-allow-origin"
  ]) {
    assert.equal(result.headers[forbidden], undefined, forbidden);
  }
}

function deploymentHeaders(body: string): Headers {
  return new Headers({
    ...PUBLIC_SHELL_SECURITY_HEADERS,
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "Content-Type": "text/html; charset=utf-8"
  });
}

test("공개 shell 설정은 loopback bind와 canonical port만 엄격히 받는다", () => {
  assert.deepEqual(parsePublicShellServerArgs(), {
    bindHost: "127.0.0.1",
    help: false,
    port: 4330
  });
  assert.equal(DEFAULT_PUBLIC_SHELL_PORT, 4330);
  assert.deepEqual(parsePublicShellServerArgs([], {
    [PUBLIC_SHELL_BIND_ENV]: "::1",
    [PUBLIC_SHELL_PORT_ENV]: "8443",
    HOST: "0.0.0.0",
    PORT: "9999"
  }), {
    bindHost: "::1",
    help: false,
    port: 8443
  });
  assert.deepEqual(parsePublicShellServerArgs([
    "--bind=127.0.0.1",
    "--port",
    "65535"
  ], {
    [PUBLIC_SHELL_BIND_ENV]: "::1",
    [PUBLIC_SHELL_PORT_ENV]: "8443"
  }), {
    bindHost: "127.0.0.1",
    help: false,
    port: 65_535
  });
  assert.equal(parsePublicShellServerArgs(["--help"]).help, true);
  for (const argv of [
    ["--bind", "0.0.0.0"],
    ["--bind", "localhost"],
    ["--bind", "127.0.0.1", "--bind=::1"],
    ["--port", "0"],
    ["--port", "04330"],
    ["--port", "65536"],
    ["--port", "43.30"],
    ["--port=4330", "--port", "4331"],
    ["--root", "/tmp/public-shell"],
    ["serve"],
    ["--help", "--port", "4330"]
  ]) {
    assert.throws(() => parsePublicShellServerArgs(argv), /옵션|중복|loopback|canonical|범위|help/u);
  }
  assert.throws(() => parsePublicShellServerArgs([], {
    [PUBLIC_SHELL_PORT_ENV]: " 4330"
  }), /canonical/u);
  const help = publicShellServerHelpText();
  assert.match(help, /127\.0\.0\.1/u);
  assert.match(help, /4330/u);
  assert.match(help, /요청 기록, 쿠키, 세션, 분석 기능/u);
});

test("공개 웹 request target은 allowlist의 전체 앱 파일만 허용한다", () => {
  const usageGate = "a".repeat(64);
  const supportedSourceQueries = [
    "https://chzzk.naver.com/video/14514980",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://vod.sooplive.com/player/123456789"
  ].map((source) => `source=${encodeURIComponent(source)}`);
  for (const target of [
    "/",
    ...supportedSourceQueries.map((query) => `/?${query}`),
    "/index.html",
    ...supportedSourceQueries.map((query) => `/index.html?${query}`),
    "/editor.html",
    "/editor.html?project=project-123&usageGate=" + usageGate,
    "/editor.html?project=project-123",
    "/editor.html?project=project-123&session=resume",
    "/editor.html?project=project-123&session=resume&recovery=drafts&workspace=short-form",
    "/editor.html?project=project-123&workspace=short-form&short=shorts-1",
    "/editor.html?project=project-123&workspace=short-form&short=shorts-68a9bcf1-08c0-4a67-a197-8fa6d37b5d35",
    `/editor.html?project=${encodeURIComponent("한글-프로젝트")}`,
    "/studio.css",
    "/studio.css?v=3.0.0",
    "/studio.js?v=3.0.0",
    "/editor/editor.css?v=3.0.0",
    "/editor/editor.js?v=3.0.0",
    "/THIRD_PARTY_NOTICES.md",
    "/licenses/UNLICENSE.txt"
  ]) {
    const requestPath = publicShellRequestPath(target);
    assert(requestPath);
    assert(resolvePublicShellStaticAsset(requestPath));
  }
  for (const target of [
    "",
    "index.html",
    "//index.html",
    "/../index.html",
    "/%2e%2e/index.html",
    "/licenses%2FUNLICENSE.txt",
    "/licenses\\UNLICENSE.txt",
    "/index.html?x=1",
    "/?source=javascript%3Aalert%281%29",
    "/?source=https%3A%2F%2Fexample.com%2Fvideo%2F14514980",
    `/index.html?${supportedSourceQueries[0]}&unknown=1`,
    "/editor.html?",
    "/editor.html?project=",
    "/editor.html?project=project-123&project=project-456",
    "/editor.html?project=project-123&unknown=1",
    "/editor.html?project=project-123&usageGate=abc",
    "/editor.html?project=project-123&session=new",
    "/editor.html?project=project-123&recovery=drafts",
    "/editor.html?project=project-123&workspace=main",
    "/editor.html?project=project-123&short=shorts-1",
    "/editor.html?project=project-123&workspace=short-form&short=%2Fbad",
    `/editor.html?project=project-123&workspace=short-form&short=${"a".repeat(129)}`,
    "/editor.html?project=%GG",
    "/studio.css?",
    "/studio.css?v=03.0.0",
    "/studio.css?v=3.0.0&x=1",
    "/index.html#x",
    "/index.html\n"
  ]) {
    assert.equal(publicShellRequestPath(target), null, target);
  }
  for (const target of [
    "/_headers",
    "/.popovic-hosts",
    "/licenses/",
    "/health",
    "/v1/health",
    "/extension/manifest.json",
    "/studio.css.map"
  ]) {
    assert.equal(resolvePublicShellStaticAsset(target), null, target);
  }
});

test("공개 Host는 raw Host 하나의 exact domain만 허용한다", () => {
  const request = (host: string, rawValues = ["Host", host]) => ({
    headers: { host },
    rawHeaders: rawValues
  });
  assert.equal(hasExactPublicShellHost(request(PUBLIC_SHELL_CANONICAL_HOST)), true);
  for (const host of [
    "127.0.0.1:4330",
    "localhost:4330",
    "KIRINUKI.EFF0RTCHUNG.KR",
    "kirinuki.eff0rtchung.kr:443",
    "kirinuki.eff0rtchung.kr.attacker.example"
  ]) {
    assert.equal(hasExactPublicShellHost(request(host)), false);
  }
  assert.equal(hasExactPublicShellHost(request(
    PUBLIC_SHELL_CANONICAL_HOST,
    [
      "Host",
      PUBLIC_SHELL_CANONICAL_HOST,
      "Host",
      PUBLIC_SHELL_CANONICAL_HOST
    ]
  )), false);
  assert.equal(hasExactPublicShellHost({
    headers: { host: PUBLIC_SHELL_CANONICAL_HOST },
    rawHeaders: ["Host", "attacker.example"]
  }), false);
});

test("_headers는 HSTS를 포함한 exact 보안 계약만 파싱한다", async () => {
  const actual = await loadPublicShellSecurityHeaders(
    await realpath(fileURLToPath(repositoryWeb))
  );
  assert.deepEqual(actual, PUBLIC_SHELL_SECURITY_HEADERS);
  assert.equal(
    actual["Strict-Transport-Security"],
    "max-age=31536000"
  );
  assert.match(actual["Content-Security-Policy"] || "", /frame-ancestors 'none'/u);
  const source = await readFile(new URL("_headers", repositoryWeb), "utf8");
  for (const invalid of [
    source.replace("  X-Frame-Options: DENY\n", ""),
    source.replace("DENY", "SAMEORIGIN"),
    `${source}  Set-Cookie: session=bad\n`,
    source.replace(
      "  Referrer-Policy: strict-origin-when-cross-origin\n",
      "  Referrer-Policy: strict-origin-when-cross-origin\n  Referrer-Policy: strict-origin-when-cross-origin\n"
    ),
    source.replace("  Cache-Control", " Cache-Control")
  ]) {
    assert.throws(() => parsePublicShellHeaders(invalid), /_headers|규칙/u);
  }
});

test("공개 웹 서버는 GET·HEAD 앱 content와 모든 오류에 같은 보안 헤더를 적용한다", async (t) => {
  const root = await createPublicShellFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = await createPublicShellHttpServer({ publicShellRoot: root });
  t.after(() => closeServer(server));
  const port = await listenEphemeral(server);

  const routes = [
    ["/", "index.html", "text/html; charset=utf-8"],
    [
      `/?source=${encodeURIComponent("https://chzzk.naver.com/video/14514980")}`,
      "index.html",
      "text/html; charset=utf-8"
    ],
    ["/index.html", "index.html", "text/html; charset=utf-8"],
    ["/editor.html", "editor.html", "text/html; charset=utf-8"],
    [
      `/editor.html?project=project-123&usageGate=${"a".repeat(64)}`,
      "editor.html",
      "text/html; charset=utf-8"
    ],
    [
      "/editor.html?project=project-123&workspace=short-form&short=shorts-1",
      "editor.html",
      "text/html; charset=utf-8"
    ],
    ["/studio.css?v=3.0.0", "studio.css", "text/css; charset=utf-8"],
    ["/studio.js?v=3.0.0", "studio.js", "text/javascript; charset=utf-8"],
    ["/editor/editor.css?v=3.0.0", "editor/editor.css", "text/css; charset=utf-8"],
    [
      "/THIRD_PARTY_NOTICES.md",
      "THIRD_PARTY_NOTICES.md",
      "text/markdown; charset=utf-8"
    ],
    [
      "/licenses/UNLICENSE.txt",
      "licenses/UNLICENSE.txt",
      "text/plain; charset=utf-8"
    ]
  ] as const;
  for (const [target, relativePath, contentType] of routes) {
    const expected = await readFile(path.join(root, ...relativePath.split("/")));
    const get = await requestServer(port, target, {
      headers: { Cookie: "ignored=1" }
    });
    assert.equal(get.status, 200, target);
    assert.deepEqual(get.body, expected, target);
    assert.equal(get.headers["content-type"], contentType);
    assert.equal(get.headers["content-length"], String(expected.byteLength));
    assertSecurityHeaders(get);

    const head = await requestServer(port, target, { method: "HEAD" });
    assert.equal(head.status, 200, target);
    assert.equal(head.body.byteLength, 0, target);
    assert.equal(head.headers["content-length"], String(expected.byteLength));
    assertSecurityHeaders(head);
  }
  assert.deepEqual(
    (await requestServer(port, "/")).body,
    (await requestServer(port, "/index.html")).body
  );

  const errors = [
    await requestServer(port, "/", { host: "127.0.0.1:4330" }),
    await requestServer(port, "/_headers"),
    await requestServer(port, "/.popovic-hosts"),
    await requestServer(port, "/health"),
    await requestServer(port, "/%2e%2e/index.html"),
    await requestServer(port, "/", { method: "OPTIONS" })
  ];
  assert.deepEqual(errors.map(({ status }) => status), [421, 404, 404, 404, 400, 405]);
  assert.equal(errors.at(-1)?.headers.allow, "GET, HEAD");
  for (const result of errors) {
    assertSecurityHeaders(result);
  }
});

test("공개 웹 startup은 symlink·hardlink·oversize content를 fail-closed한다", async (t) => {
  const roots: string[] = [];
  t.after(async () => {
    await Promise.all(roots.map((root) => rm(root, {
      recursive: true,
      force: true
    })));
  });

  const finalSymlinkRoot = await createPublicShellFixture();
  roots.push(finalSymlinkRoot);
  const outsideCss = path.join(finalSymlinkRoot, "outside.css");
  await writeFile(outsideCss, "body{}\n");
  await rm(path.join(finalSymlinkRoot, "studio.css"));
  await symlink(outsideCss, path.join(finalSymlinkRoot, "studio.css"));
  await assert.rejects(
    createPublicShellHttpServer({ publicShellRoot: finalSymlinkRoot }),
    /studio\.css/u
  );

  const directorySymlinkRoot = await createPublicShellFixture();
  roots.push(directorySymlinkRoot);
  const outsideDirectory = path.join(directorySymlinkRoot, "outside-licenses");
  await mkdir(outsideDirectory);
  await writeFile(path.join(outsideDirectory, "UNLICENSE.txt"), "outside\n");
  await rm(path.join(directorySymlinkRoot, "licenses"), {
    recursive: true,
    force: true
  });
  await symlink(outsideDirectory, path.join(directorySymlinkRoot, "licenses"));
  await assert.rejects(
    createPublicShellHttpServer({ publicShellRoot: directorySymlinkRoot }),
    /licenses\//u
  );

  const hardlinkRoot = await createPublicShellFixture();
  roots.push(hardlinkRoot);
  await link(
    path.join(hardlinkRoot, "studio.css"),
    path.join(hardlinkRoot, "studio-copy.css")
  );
  await assert.rejects(
    createPublicShellHttpServer({ publicShellRoot: hardlinkRoot }),
    /studio\.css/u
  );

  const oversizeRoot = await createPublicShellFixture();
  roots.push(oversizeRoot);
  await writeFile(
    path.join(oversizeRoot, "studio.css"),
    Buffer.alloc(MAX_PUBLIC_SHELL_ASSET_BYTES + 1, 0x61)
  );
  await assert.rejects(
    createPublicShellHttpServer({ publicShellRoot: oversizeRoot }),
    /studio\.css/u
  );

  const headerSymlinkRoot = await createPublicShellFixture();
  roots.push(headerSymlinkRoot);
  const outsideHeaders = path.join(headerSymlinkRoot, "outside-headers");
  await writeFile(
    outsideHeaders,
    await readFile(new URL("_headers", repositoryWeb))
  );
  await rm(path.join(headerSymlinkRoot, "_headers"));
  await symlink(outsideHeaders, path.join(headerSymlinkRoot, "_headers"));
  await assert.rejects(
    createPublicShellHttpServer({ publicShellRoot: headerSymlinkRoot }),
    /_headers/u
  );
});

test("공개 배포 checker는 exact HTTPS와 무쿠키·무NEL·무주입 전체 앱만 통과시킨다", async () => {
  const body = await readFile(new URL("index.html", repositoryWeb), "utf8");
  const headers = deploymentHeaders(body);
  const validSnapshot = {
    body,
    finalUrl: PUBLIC_SHELL_CANONICAL_URL,
    headers,
    requestedUrl: PUBLIC_SHELL_CANONICAL_URL,
    status: 200
  };
  assert.deepEqual(validatePublicDeploymentSnapshot(validSnapshot), {
    bytes: Buffer.byteLength(body, "utf8"),
    status: 200,
    url: PUBLIC_SHELL_CANONICAL_URL
  });
  assert.deepEqual(publicDeploymentViolations(validSnapshot), []);
  assert.equal(parsePublicDeploymentUrl(PUBLIC_SHELL_CANONICAL_URL), PUBLIC_SHELL_CANONICAL_URL);
  assert.equal(parsePublicDeploymentCheckArgs([]).url, PUBLIC_SHELL_CANONICAL_URL);
  for (const invalid of [
    "http://kirinuki.eff0rtchung.kr/",
    "https://KIRINUKI.EFF0RTCHUNG.KR/",
    "https://kirinuki.eff0rtchung.kr",
    "https://kirinuki.eff0rtchung.kr:443/",
    "https://kirinuki.eff0rtchung.kr/path",
    "https://kirinuki.eff0rtchung.kr/?x=1",
    "https://user@kirinuki.eff0rtchung.kr/",
    "https://kirinuki.eff0rtchung.kr.attacker.example/"
  ]) {
    assert.throws(() => parsePublicDeploymentUrl(invalid), /정확히/u);
  }

  for (const forbiddenHeader of ["Set-Cookie", "NEL", "Report-To"] as const) {
    const mutated = deploymentHeaders(body);
    mutated.set(forbiddenHeader, "forbidden");
    assert.match(
      publicDeploymentViolations({ ...validSnapshot, headers: mutated }).join("\n"),
      new RegExp(forbiddenHeader, "iu")
    );
  }
  for (const injection of [
    '<script src="/cdn-cgi/scripts/email-decode.min.js"></script>',
    '<a data-cfemail="bad">email</a>',
    '<a href="http://127.0.0.1:4320/editor.html">editor</a>',
    '<script src="https://www.googletagmanager.com/gtag/js"></script>'
  ]) {
    assert.ok(publicDeploymentViolations({
      ...validSnapshot,
      body: `${body}${injection}`
    }).length > 0);
  }

});
