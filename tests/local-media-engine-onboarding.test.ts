import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_MEDIA_ENGINE_HEALTH_ENDPOINT,
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
  LOCAL_MEDIA_ENGINE_PROTOCOL,
  LocalMediaEngineConnectionError,
  detectLocalMediaEngineTarget,
  ensureLocalMediaEngineReady,
  invalidatePrimedLocalMediaEngineTrust,
  localMediaEngineArchInstaller,
  localMediaEnginePermissionState,
  localMediaEngineInstaller,
  localMediaEngineReleaseMessage,
  primeLocalMediaEngineTrust,
  probeLocalMediaEngine
} from "../src/editor/local-media-engine-onboarding.js";
import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY,
  LOCAL_MEDIA_ENGINE_PRODUCT,
  LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA
} from "../src/lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
  LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  encodeBase64Url,
  localMediaEngineProofTranscript,
  localMediaEnginePublicKeyId
} from "../src/lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_TRUST_SCHEMA
} from "../src/editor/local-media-engine-trust.js";
import type {
  LocalMediaEngineDevicePin,
  LocalMediaEngineTrustStore
} from "../src/editor/local-media-engine-trust.js";
import {
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
  LOCAL_MEDIA_ENGINE_RELEASE_FILES,
  LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE,
  LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE
} from "../src/editor/local-media-engine-release.js";
import type {
  LocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";

function verifiedReleaseChannel(): Readonly<LocalMediaEngineReleaseChannel> {
  const tag = "v3.0.1";
  const installers = Object.fromEntries(
    Object.entries(LOCAL_MEDIA_ENGINE_RELEASE_FILES).map(([target, fileName]) => [
      target,
      Object.freeze({
        bytes: 1024,
        fileName,
        sha256: "a".repeat(64),
        url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/${fileName}`
      })
    ])
  ) as unknown as LocalMediaEngineReleaseChannel["installers"];
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: "verified-public-release",
    tag,
    commit: "b".repeat(40),
    aggregateManifestSha256: "c".repeat(64),
    installers
  });
}

function linuxPreviewReleaseChannel(): Readonly<LocalMediaEngineReleaseChannel> {
  const tag = "v3.0.5";
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL_SCHEMA,
    status: "verified-linux-preview",
    tag,
    commit: "d".repeat(40),
    aggregateManifestSha256: "e".repeat(64),
    archInstaller: Object.freeze({
      bytes: 2048,
      fileName: LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE,
      sha256: "2".repeat(64),
      url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/${LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE}`
    }),
    sourceOffer: Object.freeze({
      bytes: 2048,
      fileName: "Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt",
      sha256: "1".repeat(64),
      url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/Kirinuki-Engine-linux-preview-SOURCE-OFFER.txt`
    }),
    installers: Object.freeze({
      "linux-x64": Object.freeze({
        bytes: 1024,
        fileName: LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE,
        sha256: "f".repeat(64),
        url: `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/${tag}/${LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE}`
      })
    })
  });
}

interface SigningFixture {
  readonly privateKey: CryptoKey;
  readonly pin: Readonly<LocalMediaEngineDevicePin>;
  readonly trustStore: Readonly<LocalMediaEngineTrustStore>;
}

async function signingFixture(): Promise<SigningFixture> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeySpki = encodeBase64Url(new Uint8Array(
    await crypto.subtle.exportKey("spki", keys.publicKey)
  ));
  const keyId = await localMediaEnginePublicKeyId(publicKeySpki);
  assert.ok(keyId);
  const pin = Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId,
    publicKeySpki,
    enrolledAt: new Date().toISOString(),
    maxSeenVersion: "3.0.1"
  });
  const trustStore: Readonly<LocalMediaEngineTrustStore> = Object.freeze({
    read: async () => pin,
    pin: async () => pin,
    observeVersion: async (keyId: string, engineVersion: string) => {
      assert.equal(keyId, pin.keyId);
      return Object.freeze({ ...pin, maxSeenVersion: engineVersion });
    },
    reset: async () => undefined
  });
  return { privateKey: keys.privateKey, pin, trustStore };
}

async function compatibleHealth(): Promise<Record<string, unknown>> {
  const sessionKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  return {
    schema: LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
    status: "ok",
    managed: true,
    engine: {
      backgroundStart: "ready",
      product: LOCAL_MEDIA_ENGINE_PRODUCT,
      protocol: LOCAL_MEDIA_ENGINE_API_PROTOCOL,
      version: "3.0.1"
    },
    originBinding: "exact-public-studio",
    authentication: "bearer-memory-capability",
    transcriptionMode: "whisper.cpp-local-process",
    vodRuntime: {
      schema: LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA,
      kind: "vod-only",
      ready: true,
      ytDlp: { version: "2026.07.04" },
      ejs: { version: "0.8.0" },
      instanceNonce: encodeBase64Url(new Uint8Array(32).fill(0x41))
    },
    sessionEncryption: {
      schema: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
      algorithm: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
      grantId: encodeBase64Url(new Uint8Array(32).fill(0x47)),
      serverPublicKey: encodeBase64Url(new Uint8Array(
        await crypto.subtle.exportKey("raw", sessionKeys.publicKey)
      )),
      expiresAt: new Date(Date.now() + 30_000).toISOString()
    }
  };
}

async function signedHealthResponse(
  fixture: SigningFixture,
  init: RequestInit | undefined,
  mutate?: (payload: Record<string, unknown>) => void
): Promise<Response> {
  const challenge = new Headers(init?.headers).get(
    LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER
  ) || "";
  const payload = await compatibleHealth();
  mutate?.(payload);
  const runtime = payload.vodRuntime as Record<string, unknown> | undefined;
  const instanceNonce = String(runtime?.instanceNonce || "");
  const signature = encodeBase64Url(new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    fixture.privateKey,
    Uint8Array.from(localMediaEngineProofTranscript({
      kind: "health",
      challenge,
      instanceNonce,
      payload
    })).buffer
  )));
  return new Response(JSON.stringify({
    ...payload,
    deviceProof: {
      schema: LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
      algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
      keyId: fixture.pin.keyId,
      challenge,
      instanceNonce,
      signature
    }
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function navigatorFixture({
  platform,
  architecture,
  bitness = "64",
  platformVersion = "15.0.0",
  legacyPlatform = "",
  userAgent = ""
}: {
  platform: string;
  architecture: string;
  bitness?: string;
  platformVersion?: string;
  legacyPlatform?: string;
  userAgent?: string;
}): Navigator {
  return {
    platform: legacyPlatform,
    userAgent,
    userAgentData: {
      platform,
      async getHighEntropyValues() {
        return { platform, architecture, bitness, platformVersion };
      }
    }
  } as unknown as Navigator;
}

test("영상 준비 엔진 대상은 정확한 세 OS/architecture만 허용한다", async () => {
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "Windows",
    architecture: "x86",
    bitness: "64"
  })), "windows-x64");
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "macOS",
    architecture: "arm"
  })), "macos-arm64");
  assert.equal(await detectLocalMediaEngineTarget({
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    userAgentData: { platform: "macOS" }
  } as unknown as Navigator), "macos-arm64");
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "Linux",
    architecture: "x86",
    bitness: "64"
  })), "linux-x64");
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "macOS",
    architecture: "x86"
  })), "unsupported");
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "macOS",
    architecture: "arm",
    platformVersion: "14.7.0"
  })), "unsupported");
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "Windows",
    architecture: "x86",
    bitness: "32",
    legacyPlatform: "Win32",
    userAgent: "Windows NT"
  })), "unsupported");
  assert.equal(await detectLocalMediaEngineTarget(navigatorFixture({
    platform: "Linux",
    architecture: "arm"
  })), "unsupported");
});

test("온보딩 installer는 verified channel이 있을 때만 고정된 세 파일을 연다", () => {
  const releaseChannel = verifiedReleaseChannel();
  assert.equal(localMediaEngineInstaller("windows-x64"), null);
  assert.deepEqual(
    ["windows-x64", "macos-arm64", "linux-x64"].map((target) => (
      localMediaEngineInstaller(
        target as Parameters<typeof localMediaEngineInstaller>[0],
        releaseChannel
      )
        ?.fileName
    )),
    [
      "Kirinuki-Engine-windows-x64-setup.exe",
      "Kirinuki-Engine-macos-arm64.dmg",
      "Kirinuki-Engine-linux-x64.deb"
    ]
  );
  assert.equal(localMediaEngineInstaller("unsupported", releaseChannel), null);
  assert.match(
    localMediaEngineInstaller("windows-x64", releaseChannel)?.url || "",
    /^https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper\/releases\/download\/v3\.0\.1\//u
  );
  assert.match(
    localMediaEngineInstaller("windows-x64", releaseChannel)?.installInstruction || "",
    /다운로드를 요청했습니다[\s\S]*자동으로 확인/u
  );
  assert.match(
    localMediaEngineInstaller("macos-arm64", releaseChannel)?.installInstruction || "",
    /macOS[\s\S]*응용 프로그램[\s\S]*한 번 실행/u
  );
  assert.match(
    localMediaEngineInstaller("linux-x64", releaseChannel)?.installInstruction || "",
    /deb를 설치[\s\S]*설치 후 연결 확인[\s\S]*자동으로 감지/u
  );
  assert.equal(
    localMediaEngineInstaller("linux-x64", releaseChannel)?.label,
    "Debian/Ubuntu용 도우미 (.deb)"
  );
});

test("Linux preview 온보딩은 Linux만 다운로드하고 다른 OS에 범위를 명확히 알린다", () => {
  const releaseChannel = linuxPreviewReleaseChannel();
  const linux = localMediaEngineInstaller("linux-x64", releaseChannel);
  assert.equal(linux?.fileName, LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE);
  assert.equal(linux?.label, "Debian/Ubuntu용 도우미 (.deb)");
  assert.match(linux?.installInstruction || "", /다운로드를 요청[\s\S]*설치 후 연결 확인/u);
  const arch = localMediaEngineArchInstaller(releaseChannel);
  assert.equal(arch?.fileName, LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE);
  assert.equal(arch?.label, "Arch Linux용 도우미 (.pkg.tar.zst)");
  assert.equal(localMediaEngineInstaller("windows-x64", releaseChannel), null);
  assert.equal(localMediaEngineInstaller("macos-arm64", releaseChannel), null);
  assert.match(
    localMediaEngineReleaseMessage("windows-x64", releaseChannel),
    /Debian\/Ubuntu·Arch Linux[\s\S]*Windows와 macOS용 도우미는 아직 제공하지 않습니다/u
  );
});

test("LNA 권한은 프롬프트를 띄우지 않고 표준 이름과 Chromium alias 순으로 읽는다", async () => {
  const queried: string[] = [];
  const sourceNavigator = {
    permissions: {
      async query(descriptor: PermissionDescriptor) {
        queried.push(String(descriptor.name));
        if (String(descriptor.name) === "loopback-network") {
          throw new TypeError("not exposed by this Chromium version");
        }
        return { state: "prompt" } as PermissionStatus;
      }
    }
  } as unknown as Navigator;
  assert.equal(await localMediaEnginePermissionState(sourceNavigator), "prompt");
  assert.deepEqual(queried, ["loopback-network", "local-network-access"]);
  assert.equal(
    await localMediaEnginePermissionState({} as Navigator),
    null
  );
});

test("health probe는 exact loopback URL·protocol과 무자격 CORS 요청만 사용한다", async () => {
  const fixture = await signingFixture();
  assert.equal(
    LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
    "kirinuki-local-media-engine/health-v1"
  );
  assert.equal(
    LOCAL_MEDIA_ENGINE_PROTOCOL,
    "kirinuki-local-media-engine/health-proof-v2"
  );
  assert.deepEqual(LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY, {
    id: "kirinuki-local-media-engine/v1-additive-compatibility",
    apiProtocol: "kirinuki-local-media-engine/v1",
    evolution: "additive-only",
    breakingChange: "new-parallel-protocol",
    installedEngineReplacement: "signed-stable-path-installer-only",
    automaticUpdater: "disabled",
    unsignedUpdatesAllowed: false,
    publicNetworkPolling: false
  });
  const calls: Array<{ url: string; init: RequestInit }> = [];
  await probeLocalMediaEngine(undefined, async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return signedHealthResponse(fixture, init);
  }, 5_000, fixture.trustStore);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, LOCAL_MEDIA_ENGINE_HEALTH_ENDPOINT);
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(calls[0]?.init.mode, "cors");
  assert.equal(calls[0]?.init.credentials, "omit");
  assert.equal(calls[0]?.init.cache, "no-store");
  assert.equal(calls[0]?.init.redirect, "error");
  assert.equal(
    (calls[0]?.init as RequestInit & { targetAddressSpace?: string })
      .targetAddressSpace,
    "loopback"
  );
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get("X-Kirinuki-Protocol"), LOCAL_MEDIA_ENGINE_PROTOCOL);
  assert.match(
    headers.get(LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER) || "",
    /^[A-Za-z0-9_-]{43}$/u
  );
});

test("v2 signed health compatibility는 app release 번호와 독립적이다", async () => {
  const fixture = await signingFixture();
  await probeLocalMediaEngine(undefined, (_input, init) => (
    signedHealthResponse(fixture, init, (payload) => {
      (payload.engine as Record<string, unknown>).version = "99.42.7";
    })
  ), 5_000, fixture.trustStore);
});

test("health probe는 부재·과대·호환되지 않는 엔진을 fail closed한다", async () => {
  const fixture = await signingFixture();
  await assert.rejects(
    probeLocalMediaEngine(undefined, async () => {
      throw new TypeError("connection refused");
    }, 5_000, fixture.trustStore),
    (error: unknown) => error instanceof LocalMediaEngineConnectionError
      && error.code === "ENGINE_UNAVAILABLE"
  );
  await assert.rejects(
    probeLocalMediaEngine(undefined, async () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(64 * 1024 + 1) }
    }), 5_000, fixture.trustStore),
    (error: unknown) => error instanceof LocalMediaEngineConnectionError
      && error.code === "ENGINE_INCOMPATIBLE"
  );
  await assert.rejects(
    probeLocalMediaEngine(undefined, async () => new Response(JSON.stringify({
      schema: "older-engine",
      status: "ok",
      vodRuntime: {}
    }), { status: 200 }), 5_000, fixture.trustStore),
    (error: unknown) => error instanceof LocalMediaEngineConnectionError
      && error.code === "ENGINE_INCOMPATIBLE"
  );
  for (const mutate of [
    (value: Record<string, unknown>) => { delete value.engine; },
    (value: Record<string, unknown>) => {
      (value.engine as Record<string, unknown>).product = "lookalike";
    },
    (value: Record<string, unknown>) => {
      (value.engine as Record<string, unknown>).protocol = "older/v0";
    },
    (value: Record<string, unknown>) => {
      (value.engine as Record<string, unknown>).version = "2.9.9";
    },
    (value: Record<string, unknown>) => {
      (value.vodRuntime as Record<string, unknown>).kind = "caption-vod";
    },
    (value: Record<string, unknown>) => {
      (value.vodRuntime as Record<string, unknown>).ready = false;
    },
    (value: Record<string, unknown>) => {
      const runtime = value.vodRuntime as Record<string, unknown>;
      (runtime.ytDlp as Record<string, unknown>).version = "2026.06.30";
    },
    (value: Record<string, unknown>) => {
      const runtime = value.vodRuntime as Record<string, unknown>;
      (runtime.ejs as Record<string, unknown>).version = "0.7.9";
    }
  ]) {
    await assert.rejects(
      probeLocalMediaEngine(undefined, (_input, init) => (
        signedHealthResponse(fixture, init, mutate)
      ), 5_000, fixture.trustStore),
      (error: unknown) => error instanceof LocalMediaEngineConnectionError
        && error.code === "ENGINE_INCOMPATIBLE"
    );
  }
  await assert.rejects(
    probeLocalMediaEngine(undefined, (_input, init) => (
      signedHealthResponse(fixture, init, (payload) => {
        (payload.engine as Record<string, unknown>).backgroundStart =
          "requires-approval";
      })
    ), 5_000, fixture.trustStore),
    (error: unknown) => error instanceof LocalMediaEngineConnectionError
      && error.code === "ENGINE_UNAVAILABLE"
      && /로그인 항목/u.test(error.message)
  );
});

test("health probe는 응답 없는 loopback/LNA를 bounded timeout으로 끝낸다", async () => {
  const fixture = await signingFixture();
  const startedAt = Date.now();
  await assert.rejects(
    probeLocalMediaEngine(undefined, async (_input, init) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        }, { once: true });
      })
    ), 10, fixture.trustStore),
    (error: unknown) => error instanceof LocalMediaEngineConnectionError
      && error.code === "ENGINE_UNAVAILABLE"
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("이미 실행 중인 pinned 엔진은 prepare 때 protocol handler를 열지 않는다", async () => {
  const fixture = await signingFixture();
  let probeCalls = 0;
  let pairCalls = 0;
  try {
    await primeLocalMediaEngineTrust({
      trustStore: fixture.trustStore,
      permissionState: async () => "granted",
      probe: async () => {
        probeCalls += 1;
      }
    });
    assert.equal(await ensureLocalMediaEngineReady(undefined, {
      permissionState: async () => "granted",
      pair: async () => {
        pairCalls += 1;
        return fixture.pin;
      },
      probe: async () => {
        probeCalls += 1;
      }
    }), "ready");
    assert.equal(probeCalls, 2);
    assert.equal(pairCalls, 0);
  } finally {
    invalidatePrimedLocalMediaEngineTrust();
  }
});

test("sleeping pinned 엔진은 첫 prepare 활성화에서 protocol handler를 정확히 한 번 연다", async () => {
  const fixture = await signingFixture();
  let pairCalls = 0;
  let runtimeProbeCalls = 0;
  try {
    await primeLocalMediaEngineTrust({
      trustStore: fixture.trustStore,
      permissionState: async () => "granted",
      probe: async () => {
        throw new LocalMediaEngineConnectionError(
          "sleeping",
          "ENGINE_UNAVAILABLE"
        );
      }
    });
    const outcome = ensureLocalMediaEngineReady(undefined, {
      allowImmediateProtocolLaunch: true,
      permissionState: async () => "granted",
      pair: async () => {
        pairCalls += 1;
        return fixture.pin;
      },
      probe: async () => {
        runtimeProbeCalls += 1;
      }
    });
    // pair() is entered before ensureLocalMediaEngineReady yields, preserving
    // the prepare button's transient user activation for the custom scheme.
    assert.equal(pairCalls, 1);
    assert.equal(await outcome, "ready");
    assert.equal(pairCalls, 1);
    assert.equal(runtimeProbeCalls, 1);
  } finally {
    invalidatePrimedLocalMediaEngineTrust();
  }
});

test("온보딩 재시도는 마지막 연결 오류가 요구할 때 click stack에서 pair를 먼저 연다", async () => {
  class RetryFixtureElement extends EventTarget {
    className = "";
    dataset: Record<string, string> = {};
    download = "";
    disabled = false;
    hidden = false;
    href = "";
    open = false;
    textContent = "";

    close(): void {
      this.open = false;
    }

    focus(): void {}

    removeAttribute(name: string): void {
      if (name === "href") this.href = "";
      if (name === "download") this.download = "";
    }

    showModal(): void {
      this.open = true;
    }
  }
  const selectors = new Map<string, RetryFixtureElement>([
    ["#local-media-engine-dialog", new RetryFixtureElement()],
    ["#local-media-engine-download", new RetryFixtureElement()],
    ["#local-media-engine-arch-download", new RetryFixtureElement()],
    ["#local-media-engine-download-label", new RetryFixtureElement()],
    ["#local-media-engine-source-offer", new RetryFixtureElement()],
    ["#local-media-engine-retry", new RetryFixtureElement()],
    ["#local-media-engine-reset", new RetryFixtureElement()],
    ["#local-media-engine-cancel", new RetryFixtureElement()],
    ["#local-media-engine-status", new RetryFixtureElement()],
    ["#local-media-engine-unsupported", new RetryFixtureElement()]
  ]);
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window")
  };
  const restore = (name: keyof typeof previous) => {
    const descriptor = previous[name];
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  };
  const fixture = await signingFixture();
  const order: string[] = [];
  let probeCalls = 0;
  let pairCalls = 0;
  let resolvePair: ((pin: Readonly<LocalMediaEngineDevicePin>) => void)
    | undefined;
  const pendingPair = new Promise<Readonly<LocalMediaEngineDevicePin>>(
    (resolve) => {
      resolvePair = resolve;
    }
  );
  try {
    invalidatePrimedLocalMediaEngineTrust();
    await primeLocalMediaEngineTrust({
      trustStore: fixture.trustStore,
      permissionState: async () => "granted",
      probe: async () => {
        throw new LocalMediaEngineConnectionError(
          "sleeping",
          "ENGINE_UNAVAILABLE"
        );
      }
    });
    Object.defineProperties(globalThis, {
      document: {
        configurable: true,
        value: {
          querySelector: (selector: string) => selectors.get(selector) ?? null
        }
      },
      navigator: {
        configurable: true,
        value: navigatorFixture({ platform: "Windows", architecture: "x86" })
      },
      window: {
        configurable: true,
        value: { clearTimeout, setTimeout }
      }
    });
    const outcome = ensureLocalMediaEngineReady(undefined, {
      permissionState: async () => "granted",
      pair: () => {
        pairCalls += 1;
        order.push("pair");
        return pendingPair;
      },
      probe: async () => {
        probeCalls += 1;
        if (probeCalls === 1) {
          throw new LocalMediaEngineConnectionError(
            "not running",
            "ENGINE_UNAVAILABLE"
          );
        }
        order.push(`probe-${probeCalls}`);
        if (probeCalls === 2) {
          throw new LocalMediaEngineConnectionError(
            "incompatible",
            "ENGINE_INCOMPATIBLE"
          );
        }
      }
    });
    const dialog = selectors.get("#local-media-engine-dialog")!;
    const retry = selectors.get("#local-media-engine-retry")!;
    const status = selectors.get("#local-media-engine-status")!;
    for (let index = 0; index < 20 && !dialog.open; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(dialog.open, true);
    assert.equal(pairCalls, 0, "명시 클릭 전 protocol을 열면 안 됩니다");
    assert.equal(retry.textContent, "도우미 깨우고 다시 확인");

    queueMicrotask(() => order.push("first-microtask"));
    retry.dispatchEvent(new Event("click"));
    assert.deepEqual(order, ["pair"]);
    assert.equal(pairCalls, 1);
    assert.equal(probeCalls, 1);
    await Promise.resolve();
    assert.deepEqual(order, ["pair", "first-microtask"]);
    assert.equal(probeCalls, 1, "pair가 끝나기 전 probe하면 안 됩니다");

    resolvePair?.(fixture.pin);
    for (
      let index = 0;
      index < 20 && status.dataset.state !== "error";
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual(order, ["pair", "first-microtask", "probe-2"]);
    assert.equal(retry.textContent, "설치 완료 · 다시 확인");

    retry.dispatchEvent(new Event("click"));
    assert.equal(pairCalls, 1, "호환 오류 뒤에는 protocol을 다시 열면 안 됩니다");
    assert.equal(probeCalls, 3);
    assert.equal(await outcome, "ready");
  } finally {
    invalidatePrimedLocalMediaEngineTrust();
    restore("window");
    restore("navigator");
    restore("document");
  }
});

test("첫 LNA 질문은 재다운로드보다 먼저 나오고 내 파일 선택은 명시적 결과로 끝난다", async () => {
  class FakeElement extends EventTarget {
    dataset: Record<string, string> = {};
    download = "";
    disabled = false;
    hidden = false;
    href = "";
    open = false;
    textContent = "";

    close(): void {
      this.open = false;
    }

    focus(): void {}

    removeAttribute(name: string): void {
      if (name === "href") this.href = "";
      if (name === "download") this.download = "";
    }

    showModal(): void {
      this.open = true;
    }
  }
  const selectors = new Map<string, FakeElement>([
    ["#local-media-engine-dialog", new FakeElement()],
    ["#local-media-engine-download", new FakeElement()],
    ["#local-media-engine-arch-download", new FakeElement()],
    ["#local-media-engine-download-label", new FakeElement()],
    ["#local-media-engine-source-offer", new FakeElement()],
    ["#local-media-engine-retry", new FakeElement()],
    ["#local-media-engine-reset", new FakeElement()],
    ["#local-media-engine-cancel", new FakeElement()],
    ["#local-media-engine-status", new FakeElement()],
    ["#local-media-engine-unsupported", new FakeElement()]
  ]);
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window")
  };
  let fetchCalls = 0;
  let pairCalls = 0;
  const restore = (name: keyof typeof previous) => {
    const descriptor = previous[name];
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  };
  try {
    invalidatePrimedLocalMediaEngineTrust();
    Object.defineProperties(globalThis, {
      document: {
        configurable: true,
        value: { querySelector: (selector: string) => selectors.get(selector) ?? null }
      },
      fetch: {
        configurable: true,
        value: async () => {
          fetchCalls += 1;
          throw new TypeError("not running");
        }
      },
      navigator: {
        configurable: true,
        value: Object.assign(
          navigatorFixture({ platform: "Windows", architecture: "x86" }),
          {
            permissions: {
              async query() {
                return { state: "prompt" } as PermissionStatus;
              }
            }
          }
        )
      },
      window: {
        configurable: true,
        value: { clearTimeout, setTimeout }
      }
    });
    const outcome = ensureLocalMediaEngineReady(undefined, {
      permissionState: async () => "prompt",
      pair: async () => {
        pairCalls += 1;
        throw new Error("first use must stay explicit");
      }
    });
    for (let index = 0; index < 20; index += 1) {
      if ((selectors.get("#local-media-engine-dialog") as FakeElement).open) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 0);
    assert.equal(pairCalls, 0);
    assert.equal(
      (selectors.get("#local-media-engine-download") as FakeElement).hidden,
      true
    );
    assert.equal(
      (selectors.get("#local-media-engine-retry") as FakeElement).textContent,
      "이 PC 연결 허용하고 계속"
    );
    (selectors.get("#local-media-engine-cancel") as FakeElement)
      .dispatchEvent(new Event("click"));
    assert.equal(await outcome, "manual-file");
  } finally {
    invalidatePrimedLocalMediaEngineTrust();
    restore("window");
    restore("navigator");
    restore("fetch");
    restore("document");
  }
});
