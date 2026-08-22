import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_STUDIO_PORT,
  LOCAL_STUDIO_HEALTH_SCHEMA,
  LOCAL_STUDIO_PID_SCHEMA,
  LOCAL_STUDIO_SERVER_SCHEMA,
  STUDIO_LOOPBACK_HOST,
  classifyStudioEndpoint,
  commandLineRunsExactStudioCli,
  createLocalStudioHttpServer,
  createStudioInstanceNonce,
  hasExactStudioHost,
  isManagedStudioHealthPayload,
  isValidStudioInstanceNonce,
  normalizedStudioStaticAssetDeviceId,
  openStudioStaticAsset,
  parseProcStartTime,
  readVerifiedStudioStaticAsset,
  resolveStudioServerPaths,
  resolveStudioStaticAsset,
  studioRequestPath,
  studioHealthPayload,
  studioSecurityHeaders,
  sameStudioStaticAssetCrossApiObjectIdentity,
  validStudioPidRecord,
  withoutStaticContentSecurityPolicyMeta
} from "../scripts/local-studio-server-core.js";
import type {
  StudioHealthPayload,
  StudioServerPidRecord
} from "../scripts/local-studio-server-core.js";
import {
  helpText,
  parseLocalStudioServerArgs,
  studioBrowserUrl
} from "../scripts/local-studio-server.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";

const TEST_NONCE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

test("Windows Studio static path/fd identity는 low32 dev만 정규화한다", () => {
  const low32 = 0x89abcdefn;
  const pathDevice = (0x12345678n << 32n) | low32;
  const pathIdentity = { dev: pathDevice, ino: 7n, size: 11n, nlink: 1n };
  const handleIdentity = { ...pathIdentity, dev: low32 };
  assert.equal(normalizedStudioStaticAssetDeviceId(pathDevice, "win32"), low32);
  assert.equal(normalizedStudioStaticAssetDeviceId(pathDevice, "linux"), pathDevice);
  assert.equal(sameStudioStaticAssetCrossApiObjectIdentity(
    pathIdentity,
    handleIdentity,
    "win32"
  ), true);
  assert.equal(sameStudioStaticAssetCrossApiObjectIdentity(
    pathIdentity,
    handleIdentity,
    "linux"
  ), false);
  assert.equal(sameStudioStaticAssetCrossApiObjectIdentity(pathIdentity, {
    ...handleIdentity,
    ino: 8n
  }, "win32"), false);
  assert.equal(sameStudioStaticAssetCrossApiObjectIdentity(pathIdentity, {
    ...handleIdentity,
    nlink: 2n
  }, "win32"), false);
});

interface HttpResult {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: Buffer;
}

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, STUDIO_LOOPBACK_HOST, () => resolve());
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
    method = "GET",
    host = `${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`,
    headers = {},
    body = ""
  }: {
    method?: string;
    host?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
  } = {}
): Promise<HttpResult> {
  return await new Promise<HttpResult>((resolve, reject) => {
    const request = httpRequest({
      host: STUDIO_LOOPBACK_HOST,
      port,
      path: target,
      method,
      headers: { Host: host, ...headers }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

async function createStaticFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-studio-http-"));
  await Promise.all([
    mkdir(path.join(root, "web", "assets"), { recursive: true }),
    mkdir(path.join(root, "web", "editor", "fonts"), {
      recursive: true
    }),
    mkdir(path.join(root, "web", "licenses"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      path.join(root, "web", "index.html"),
      "<!doctype html>\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'self'\">\n<meta name=\"kirinuki-studio-origin\" content=\"__KIRINUKI_STUDIO_ORIGIN__\"><title>Kirinuki localhost</title>\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "studio.css"),
      "body { color: white; }\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "studio.js"),
      "export const studioReady = true;\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "dev-reload.json"),
      "{\"revision\":\"fixture\"}\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "assets", "app-a1.js"),
      "export const ready = true;\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "editor.html"),
      "<!doctype html>\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'self'\">\n<meta name=\"kirinuki-studio-origin\" content=\"__KIRINUKI_STUDIO_ORIGIN__\"><title>Editor</title>\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "editor", "editor.css"),
      "body { color: white; }\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "editor", "editor.js"),
      "export const webEditor = true;\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "editor", "audseg-worker.js"),
      "self.onmessage = () => {};\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "editor", "fonts", "Studio.woff2"),
      Buffer.from([0x77, 0x4f, 0x46, 0x32])
    ),
    writeFile(
      path.join(root, "web", "licenses.html"),
      "<!doctype html><title>Licenses</title>\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "licenses.css"),
      "body { color: white; }\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "licenses", "DEPENDENCY.txt"),
      "license text\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "THIRD_PARTY_NOTICES.md"),
      "# Notices\n",
      "utf8"
    ),
    writeFile(
      path.join(root, "web", "licenses", "UNLICENSE.txt"),
      "Unlicense fixture\n",
      "utf8"
    )
  ]);
  return root;
}

test("localhost studio는 고정 loopback 주소와 독립 XDG PID/log 경로를 쓴다", () => {
  assert.equal(STUDIO_LOOPBACK_HOST, "127.0.0.1");
  assert.equal(DEFAULT_STUDIO_PORT, 4320);
  const fixtureRoot = path.resolve(os.tmpdir(), "kirinuki-studio-test");
  const repositoryRoot = path.join(fixtureRoot, "repository");
  const stateHome = path.join(fixtureRoot, "state");
  const runtimeDirectory = path.join(fixtureRoot, "run");
  const paths = resolveStudioServerPaths({
    env: {
      XDG_STATE_HOME: stateHome,
      XDG_RUNTIME_DIR: runtimeDirectory
    },
    homeDir: path.join(fixtureRoot, "home"),
    repoRoot: repositoryRoot
  });
  assert.equal(paths.repoRoot, repositoryRoot);
  assert.equal(
    paths.pidPath,
    path.join(runtimeDirectory, "kirinuki-studio", "localhost-server.pid")
  );
  assert.equal(
    paths.logPath,
    path.join(stateHome, "kirinuki-studio", "localhost-server.log")
  );
  assert.throws(() => resolveStudioServerPaths({
    env: { XDG_STATE_HOME: "relative" },
    homeDir: path.join(fixtureRoot, "home"),
    repoRoot: repositoryRoot
  }), /절대 경로/u);
});

test("CLI는 start/status/stop과 command별 옵션만 받는다", () => {
  assert.deepEqual(parseLocalStudioServerArgs([]), {
    command: "help",
    options: {
      foreground: false,
      json: false,
      studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
    }
  });
  assert.deepEqual(
    parseLocalStudioServerArgs([
      "start",
      "--foreground",
      "--json"
    ]),
    {
      command: "start",
      options: {
        foreground: true,
        json: true,
        studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
      }
    }
  );
  assert.deepEqual(parseLocalStudioServerArgs(["status", "--json"]), {
    command: "status",
    options: {
      foreground: false,
      json: true,
      studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
    }
  });
  assert.throws(
    () => parseLocalStudioServerArgs(["start", "--public-origin"]),
    /알 수 없는 옵션/u
  );
  assert.throws(
    () => parseLocalStudioServerArgs(["stop", "--foreground"]),
    /start에서만/u
  );
  assert.throws(
    () => parseLocalStudioServerArgs(["start", "--cookie=value"]),
    /인증 정보나 쿠키/u
  );
  assert.throws(
    () => parseLocalStudioServerArgs(["doctor"]),
    /알 수 없는 명령/u
  );
  assert.match(helpText(), /127\.0\.0\.1:4320/u);
});

test("health와 PID는 예측 불가능한 nonce 및 정확한 process identity를 요구한다", () => {
  const generated = createStudioInstanceNonce();
  assert.equal(isValidStudioInstanceNonce(generated), true);
  assert.equal(isValidStudioInstanceNonce("short"), false);

  const health = studioHealthPayload(TEST_NONCE);
  assert.equal(health.schema, LOCAL_STUDIO_HEALTH_SCHEMA);
  assert.equal(health.server.schema, LOCAL_STUDIO_SERVER_SCHEMA);
  assert.equal(health.server.studioOrigin, KIRINUKI_LOCAL_STUDIO_ORIGIN);
  assert.equal(isManagedStudioHealthPayload(health, {
    instanceNonce: TEST_NONCE
  }), true);
  assert.equal(isManagedStudioHealthPayload(health, {
    instanceNonce: generated
  }), false);
  const publicHealth = studioHealthPayload(
    TEST_NONCE,
    DEFAULT_STUDIO_PORT,
    KIRINUKI_PUBLIC_STUDIO_ORIGIN
  );
  assert.equal(isManagedStudioHealthPayload(publicHealth, {
    studioOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN
  }), true);
  assert.equal(isManagedStudioHealthPayload(publicHealth, {
    studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
  }), false);
  const legacyHealth = {
    ...health,
    server: {
      schema: health.server.schema,
      host: health.server.host,
      port: health.server.port,
      instanceNonce: health.server.instanceNonce
    }
  };
  assert.equal(isManagedStudioHealthPayload(legacyHealth, {
    studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
  }), true);
  assert.equal(isManagedStudioHealthPayload(legacyHealth, {
    studioOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN
  }), false);

  const cli = path.resolve("/opt/kirinuki/scripts/local-studio-server.ts");
  const record: StudioServerPidRecord = {
    schema: LOCAL_STUDIO_PID_SCHEMA,
    pid: 3210,
    command: "start",
    startedAt: "2026-08-12T00:00:00.000Z",
    procStartTime: "987654",
    bootId: "01234567-89ab-cdef-0123-456789abcdef",
    cliPath: cli,
    instanceNonce: TEST_NONCE
  };
  assert.equal(validStudioPidRecord(record, cli), true);
  assert.equal(validStudioPidRecord({ ...record, pid: 1 }, cli), false);
  assert.equal(validStudioPidRecord({
    ...record,
    instanceNonce: "not-valid"
  }, cli), false);
  assert.equal(commandLineRunsExactStudioCli({
    commandLine:
      `/usr/bin/node\0--import\0tsx\0${cli}\0start\0--foreground\0`,
    processCwd: path.resolve("/opt/kirinuki"),
    expectedCliPath: cli
  }), true);
  assert.equal(commandLineRunsExactStudioCli({
    commandLine:
      `/usr/bin/node\0--import\0tsx\0${path.resolve(
        "/opt/foreign/server.ts"
      )}\0start\0--foreground\0`,
    processCwd: path.resolve("/opt/foreign"),
    expectedCliPath: cli
  }), false);

  const procFields = ["S", ...Array<string>(18).fill("0"), "987654", "0"];
  assert.equal(
    parseProcStartTime(`3210 (studio worker) ${procFields.join(" ")}`),
    "987654"
  );
  assert.equal(parseProcStartTime("invalid"), null);
});

test("foreign port는 compatible health만으로 소유했다고 간주하지 않는다", () => {
  const health = studioHealthPayload(TEST_NONCE);
  const pidRecord: StudioServerPidRecord = {
    schema: LOCAL_STUDIO_PID_SCHEMA,
    pid: 3210,
    command: "start",
    startedAt: "2026-08-12T00:00:00.000Z",
    procStartTime: "987654",
    bootId: "01234567-89ab-cdef-0123-456789abcdef",
    cliPath: "/opt/kirinuki/scripts/local-studio-server.ts",
    instanceNonce: TEST_NONCE
  };
  assert.equal(classifyStudioEndpoint({
    portOccupied: false,
    health: null,
    pidRecord: null
  }), "down");
  assert.equal(classifyStudioEndpoint({
    portOccupied: true,
    health,
    pidRecord: null
  }), "foreign");
  assert.equal(classifyStudioEndpoint({
    portOccupied: true,
    health,
    pidRecord: { ...pidRecord, instanceNonce: createStudioInstanceNonce() }
  }), "foreign");
  assert.equal(classifyStudioEndpoint({
    portOccupied: true,
    health,
    pidRecord
  }), "managed");
});

test("static resolver는 공개 allowlist만 받고 encoding과 traversal을 거절한다", () => {
  assert.deepEqual(resolveStudioStaticAsset("/"), {
    relativePath: "web/index.html",
    contentType: "text/html; charset=utf-8",
    html: true
  });
  assert.equal(
    resolveStudioStaticAsset("/assets/app-a1.js")?.relativePath,
    "web/assets/app-a1.js"
  );
  assert.equal(resolveStudioStaticAsset("/studio.js")?.relativePath, "web/studio.js");
  assert.equal(
    resolveStudioStaticAsset("/dev-reload.json")?.relativePath,
    "web/dev-reload.json"
  );
  assert.equal(
    resolveStudioStaticAsset("/editor/editor.js")?.relativePath,
    "web/editor/editor.js"
  );
  assert.equal(
    resolveStudioStaticAsset("/editor/fonts/Studio.woff2")?.contentType,
    "font/woff2"
  );
  assert.equal(
    resolveStudioStaticAsset("/licenses/DEPENDENCY.txt")?.relativePath,
    "web/licenses/DEPENDENCY.txt"
  );
  for (const rejected of [
    "/../secret.js",
    "/assets/../secret.js",
    "/assets/%2e%2e/secret.js",
    "/assets/app.js?cache=1",
    "/assets/app.js%00.css",
    "/assets/app.exe",
    "/editor/fonts/nested/Studio.woff2",
    "/extension/manifest.json",
    "//foreign.example/index.html"
  ]) {
    assert.equal(resolveStudioStaticAsset(rejected), null, rejected);
  }
});

test("request target은 query를 filesystem path와 분리하고 path 공격은 거절한다", () => {
  assert.equal(
    studioRequestPath("/?source=https%3A%2F%2Fchzzk.naver.com%2Fvideo%2F14514980"),
    "/"
  );
  assert.equal(
    studioRequestPath("/editor.html?project=project-1&usageGate=abc"),
    "/editor.html"
  );
  assert.equal(studioRequestPath("/missing.html?safe=1"), "/missing.html");
  assert.equal(studioRequestPath("/assets/%2e%2e/secret.js?x=1"), null);
  assert.equal(studioRequestPath("/assets/../secret.js?x=1"), null);
  assert.equal(studioRequestPath("//foreign.example/index.html"), null);
});

test("Host 검사는 127.0.0.1:4320 단 하나의 raw Host만 허용한다", () => {
  assert.equal(hasExactStudioHost({
    headers: { host: "127.0.0.1:4320" },
    rawHeaders: ["Host", "127.0.0.1:4320"]
  }), true);
  assert.equal(hasExactStudioHost({
    headers: { host: "localhost:4320" },
    rawHeaders: ["Host", "localhost:4320"]
  }), false);
  assert.equal(hasExactStudioHost({
    headers: { host: "127.0.0.1:4320" },
    rawHeaders: [
      "Host",
      "127.0.0.1:4320",
      "Host",
      "attacker.example"
    ]
  }), false);
  assert.equal(hasExactStudioHost({
    headers: {
      host: "127.0.0.1:4320",
      "x-forwarded-proto": "https"
    },
    rawHeaders: [
      "Host",
      "127.0.0.1:4320",
      "X-Forwarded-Proto",
      "https"
    ]
  }), false);
});

test("공개 opt-in Host 검사는 exact HTTPS Cloudflare 전달만 허용한다", () => {
  const publicHost = "kirinuki.eff0rtchung.kr";
  assert.equal(hasExactStudioHost({
    headers: {
      host: publicHost,
      "x-forwarded-proto": "https"
    },
    rawHeaders: ["Host", publicHost, "X-Forwarded-Proto", "https"]
  }, DEFAULT_STUDIO_PORT, KIRINUKI_PUBLIC_STUDIO_ORIGIN), true);
  assert.equal(hasExactStudioHost({
    headers: {
      host: "127.0.0.1:4320",
      "x-forwarded-host": publicHost,
      "x-forwarded-proto": "https"
    },
    rawHeaders: [
      "Host",
      "127.0.0.1:4320",
      "X-Forwarded-Host",
      publicHost,
      "X-Forwarded-Proto",
      "https"
    ]
  }, DEFAULT_STUDIO_PORT, KIRINUKI_PUBLIC_STUDIO_ORIGIN), true);
  for (const candidate of [
    {
      headers: { host: publicHost },
      rawHeaders: ["Host", publicHost]
    },
    {
      headers: {
        host: publicHost,
        "x-forwarded-proto": "http"
      },
      rawHeaders: ["Host", publicHost, "X-Forwarded-Proto", "http"]
    },
    {
      headers: {
        host: "kirinuki.eff0rtchung.kr.attacker.example",
        "x-forwarded-proto": "https"
      },
      rawHeaders: [
        "Host",
        "kirinuki.eff0rtchung.kr.attacker.example",
        "X-Forwarded-Proto",
        "https"
      ]
    },
    {
      headers: {
        host: publicHost,
        "x-forwarded-proto": "https",
        forwarded: "proto=https;host=kirinuki.eff0rtchung.kr"
      },
      rawHeaders: [
        "Host",
        publicHost,
        "X-Forwarded-Proto",
        "https",
        "Forwarded",
        "proto=https;host=kirinuki.eff0rtchung.kr"
      ]
    }
  ]) {
    assert.equal(hasExactStudioHost(
      candidate,
      DEFAULT_STUDIO_PORT,
      KIRINUKI_PUBLIC_STUDIO_ORIGIN
    ), false);
  }
});

test("HTML 보안 헤더는 CSP, no-store, COOP, nosniff와 origin-only referrer를 고정한다", () => {
  const headers = studioSecurityHeaders({ html: true });
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(headers["Content-Security-Policy"] || "", /default-src 'self'/u);
  assert.match(headers["Content-Security-Policy"] || "", /frame-ancestors 'none'/u);
  assert.match(
    headers["Content-Security-Policy"] || "",
    /script-src 'self'(?:;|$)/u
  );
  assert.doesNotMatch(
    headers["Content-Security-Policy"] || "",
    /script-src[^;]*https:/u
  );
  assert.match(
    headers["Content-Security-Policy"] || "",
    /frame-src https:\/\/chzzk\.naver\.com https:\/\/www\.youtube-nocookie\.com https:\/\/vod\.sooplive\.com(?:;|$)/u
  );
  assert.doesNotMatch(
    headers["Content-Security-Policy"] || "",
    /frame-src[^;]*(?:www\.youtube\.com|vod\.sooplive\.co\.kr|vod\.afreecatv\.com)/u
  );
  assert.match(
    headers["Content-Security-Policy"] || "",
    /media-src 'self' blob: http:\/\/127\.0\.0\.1:4319/u
  );
  assert.match(
    headers["Content-Security-Policy"] || "",
    /connect-src 'self' http:\/\/127\.0\.0\.1:4319(?:;|$)/u
  );
  assert.doesNotMatch(
    headers["Content-Security-Policy"] || "",
    /127\.0\.0\.1:4318/u
  );
});

test("localhost 개발 서버는 public meta CSP 하나만 제거하고 HTTP CSP를 단독 적용한다", () => {
  const source = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\'">\n<main>웹</main>\n';
  assert.equal(
    withoutStaticContentSecurityPolicyMeta(source),
    "<main>웹</main>\n"
  );
  assert.throws(
    () => withoutStaticContentSecurityPolicyMeta("<main>없음</main>"),
    /정확히 하나/u
  );
  assert.throws(
    () => withoutStaticContentSecurityPolicyMeta(source + source),
    /정확히 하나/u
  );
});

test("HTTP server는 health와 allowlist 파일만 정확한 MIME/보안 헤더로 제공한다", async () => {
  const root = await createStaticFixture();
  const server = createLocalStudioHttpServer({
    repoRoot: root,
    instanceNonce: TEST_NONCE
  });
  try {
    const port = await listenEphemeral(server);

    const index = await requestServer(port, "/");
    assert.equal(index.status, 200);
    assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(index.headers["cache-control"], "no-store");
    assert.equal(index.headers["cross-origin-opener-policy"], "same-origin");
    assert.equal(index.headers["x-content-type-options"], "nosniff");
    assert.equal(
      index.headers["referrer-policy"],
      "strict-origin-when-cross-origin"
    );
    assert.match(String(index.headers["content-security-policy"]), /object-src 'none'/u);
    assert.match(index.body.toString("utf8"), /Kirinuki localhost/u);
    assert.doesNotMatch(
      index.body.toString("utf8"),
      /http-equiv="Content-Security-Policy"/u
    );
    assert.match(
      index.body.toString("utf8"),
      /content="http:\/\/127\.0\.0\.1:4320"/u
    );
    assert.doesNotMatch(
      index.body.toString("utf8"),
      /__KIRINUKI_STUDIO_ORIGIN__/u
    );

    const javascript = await requestServer(port, "/assets/app-a1.js");
    assert.equal(javascript.status, 200);
    assert.equal(
      javascript.headers["content-type"],
      "text/javascript; charset=utf-8"
    );
    assert.match(javascript.body.toString("utf8"), /ready = true/u);

    const queriedEditor = await requestServer(
      port,
      "/editor.html?project=project-1&usageGate=abc"
    );
    assert.equal(queriedEditor.status, 200);

    const queriedIndex = await requestServer(
      port,
      "/?source=https%3A%2F%2Fchzzk.naver.com%2Fvideo%2F14514980"
    );
    assert.equal(queriedIndex.status, 200);

    const webEditor = await requestServer(port, "/editor/editor.js");
    assert.equal(webEditor.status, 200);
    assert.match(webEditor.body.toString("utf8"), /webEditor = true/u);

    const devMarker = await requestServer(port, "/dev-reload.json");
    assert.equal(devMarker.status, 200);
    assert.equal(devMarker.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(devMarker.body.toString("utf8")), {
      revision: "fixture"
    });
    await rm(path.join(root, "web", "dev-reload.json"));
    assert.equal((await requestServer(port, "/dev-reload.json")).status, 404);

    const font = await requestServer(port, "/editor/fonts/Studio.woff2");
    assert.equal(font.status, 200);
    assert.equal(font.headers["content-type"], "font/woff2");
    assert.deepEqual(font.body, Buffer.from([0x77, 0x4f, 0x46, 0x32]));

    const license = await requestServer(port, "/licenses/DEPENDENCY.txt");
    assert.equal(license.status, 200);
    assert.equal(license.headers["content-type"], "text/plain; charset=utf-8");

    const healthResponse = await requestServer(
      port,
      "/v1/studio/health"
    );
    assert.equal(healthResponse.status, 200);
    const health: unknown = JSON.parse(healthResponse.body.toString("utf8"));
    assert.equal(isManagedStudioHealthPayload(health, {
      instanceNonce: TEST_NONCE
    }), true);
    const head = await requestServer(port, "/editor.html", {
      method: "HEAD"
    });
    assert.equal(head.status, 200);
    assert.equal(head.body.byteLength, 0);
    assert.equal(head.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(Number(head.headers["content-length"]) > 0, true);

    const wrongHost = await requestServer(port, "/", {
      host: "localhost:4320"
    });
    assert.equal(wrongHost.status, 421);

    const encodedTraversal = await requestServer(
      port,
      "/assets/%2e%2e/secret.js"
    );
    assert.equal(encodedTraversal.status, 400);

    const rawTraversal = await requestServer(
      port,
      "/assets/../secret.js"
    );
    assert.equal(rawTraversal.status, 400);

    const post = await requestServer(port, "/v1/studio/health", {
      method: "POST"
    });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");

    const missing = await requestServer(port, "/sidepanel.html");
    assert.equal(missing.status, 404);
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("localhost 개발 서버는 공개 Origin 모드 생성을 거부한다", () => {
  assert.throws(() => createLocalStudioHttpServer({
    repoRoot: "/opt/kirinuki",
    instanceNonce: TEST_NONCE,
    studioOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN
  }), /Kirinuki localhost Origin/u);
});

test("Studio CLI URL은 개발용 localhost Origin 하나만 연다", () => {
  assert.equal(
    studioBrowserUrl(KIRINUKI_LOCAL_STUDIO_ORIGIN),
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  );
});

test("regular file이 아닌 symlink와 symlink parent는 allowlist 경로여도 제공하지 않는다", async () => {
  const root = await createStaticFixture();
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-studio-http-external-")
  );
  const outside = path.join(root, "outside.js");
  const externalHardlinkSource = path.join(externalRoot, "external.js");
  await writeFile(outside, "throw new Error('leak');\n", "utf8");
  await writeFile(
    externalHardlinkSource,
    "export const externallyOwned = true;\n",
    "utf8"
  );
  await symlink(outside, path.join(root, "web", "assets", "leak.js"));
  await link(
    externalHardlinkSource,
    path.join(root, "web", "assets", "hardlink.js")
  );
  await mkdir(path.join(root, "linked-assets"), { recursive: true });
  await writeFile(
    path.join(root, "linked-assets", "nested.js"),
    "export const leaked = true;\n",
    "utf8"
  );
  await symlink(
    path.join(root, "linked-assets"),
    path.join(root, "web", "assets", "linked")
  );
  const server = createLocalStudioHttpServer({
    repoRoot: root,
    instanceNonce: TEST_NONCE
  });
  try {
    const port = await listenEphemeral(server);
    assert.equal((await requestServer(port, "/assets/leak.js")).status, 404);
    assert.equal((await requestServer(port, "/assets/hardlink.js")).status, 404);
    assert.equal(
      (await requestServer(port, "/assets/linked/nested.js")).status,
      404
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(externalRoot, { recursive: true, force: true })
    ]);
  }
});

test("Studio static fd는 path ABA와 same-inode tamper를 모두 응답 전에 거부한다", async () => {
  const root = await createStaticFixture();
  const descriptor = resolveStudioStaticAsset("/assets/app-a1.js");
  assert.ok(descriptor);
  const assetPath = path.join(root, descriptor.relativePath);
  const originalBytes = await readFile(assetPath);
  try {
    const tampered = await openStudioStaticAsset(root, descriptor);
    assert.ok(tampered);
    try {
      await writeFile(
        assetPath,
        Buffer.alloc(originalBytes.byteLength + 1, 0x78)
      );
      await assert.rejects(
        readVerifiedStudioStaticAsset(tampered, true),
        /응답 준비 중 바뀌었습니다/u
      );
    } finally {
      await tampered.handle.close();
      await writeFile(assetPath, originalBytes);
    }

    const opened = await openStudioStaticAsset(root, descriptor);
    assert.ok(opened);
    const backupPath = `${assetPath}.verified-backup`;
    try {
      await rename(assetPath, backupPath);
      await writeFile(assetPath, Buffer.alloc(originalBytes.byteLength, 0x79));
      // Neutralize any platform-specific ctime effect from rename so this
      // assertion proves the current pathname is rebound to the open fd.
      const fdAfterRename = await opened.handle.stat({ bigint: true });
      await assert.rejects(
        readVerifiedStudioStaticAsset({
          ...opened,
          status: fdAfterRename
        }, true),
        /응답 준비 중 바뀌었습니다/u
      );
    } finally {
      await opened.handle.close();
      await rm(assetPath, { force: true });
      await rename(backupPath, assetPath);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("health 타입은 직접 구성한 foreign schema를 거절한다", () => {
  const foreign = {
    ...studioHealthPayload(TEST_NONCE),
    schema: "foreign/health-v1"
  } as unknown as StudioHealthPayload;
  assert.equal(isManagedStudioHealthPayload(foreign), false);
});
