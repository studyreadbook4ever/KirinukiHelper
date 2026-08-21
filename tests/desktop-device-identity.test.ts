import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadOrCreateDesktopDeviceIdentity
} from "../src/desktop/device-identity.js";
import type {
  DesktopDeviceIdentityProtector
} from "../src/desktop/device-identity.js";
import {
  DesktopSecureStorageUnavailableError,
  createDesktopDeviceIdentityProtector
} from "../src/desktop/device-identity-protector.js";
import type {
  DesktopSafeStorageAdapter,
  DesktopSafeStorageBackend
} from "../src/desktop/device-identity-protector.js";
import {
  verifyLocalMediaEngineSignature
} from "../src/lib/local-media-engine-auth.js";
import type { DesktopPlatform } from "../src/desktop/runtime-spec.js";

const IDENTITY_FILE = "device-identity-v1.json";
const hostPlatform = process.platform as DesktopPlatform;

function xorProtector(observed?: {
  protectOutput?: Uint8Array;
  unprotectInput?: Uint8Array;
}): Readonly<DesktopDeviceIdentityProtector> {
  return Object.freeze({
    protect: async (plainText: string) => {
      const bytes = new TextEncoder().encode(plainText);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = bytes[index]! ^ 0xa5;
      }
      if (observed) observed.protectOutput = bytes;
      return bytes;
    },
    unprotect: async (protectedBytes: Uint8Array) => {
      if (observed) observed.unprotectInput = protectedBytes;
      const plain = Uint8Array.from(
        protectedBytes,
        (byte) => byte ^ 0xa5
      );
      return new TextDecoder().decode(plain);
    }
  });
}

async function temporaryState(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-identity-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

test("device identity는 생성·재로드·서명되고 임시 보호 byte를 즉시 zeroize한다", async (t) => {
  const stateRoot = await temporaryState(t);
  const observed: {
    protectOutput?: Uint8Array;
    unprotectInput?: Uint8Array;
  } = {};
  const protector = xorProtector(observed);
  const created = await loadOrCreateDesktopDeviceIdentity({
    stateRoot,
    platform: hostPlatform,
    protector
  });
  assert.ok(observed.protectOutput?.every((byte) => byte === 0));
  assert.ok(observed.unprotectInput?.every((byte) => byte === 0));
  const transcript = new TextEncoder().encode("identity-regression-proof");
  assert.equal(await verifyLocalMediaEngineSignature({
    publicKeySpki: created.publicKeySpki,
    signature: await created.sign(transcript),
    transcript
  }), true);

  const reloaded = await loadOrCreateDesktopDeviceIdentity({
    stateRoot,
    platform: hostPlatform,
    protector
  });
  assert.equal(reloaded.keyId, created.keyId);
  assert.equal(reloaded.publicKeySpki, created.publicKeySpki);
  assert.ok(observed.unprotectInput?.every((byte) => byte === 0));
});

test("device identity는 corrupt·public/private mismatch·symlink·directory를 fail closed한다", async (t) => {
  const protector = xorProtector();

  const corruptRoot = await temporaryState(t);
  await writeFile(path.join(corruptRoot, IDENTITY_FILE), "{broken", { mode: 0o600 });
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot: corruptRoot,
      platform: hostPlatform,
      protector
    }),
    /손상/u
  );

  const firstRoot = await temporaryState(t);
  const secondRoot = await temporaryState(t);
  await loadOrCreateDesktopDeviceIdentity({
    stateRoot: firstRoot,
    platform: hostPlatform,
    protector
  });
  await loadOrCreateDesktopDeviceIdentity({
    stateRoot: secondRoot,
    platform: hostPlatform,
    protector
  });
  const firstPath = path.join(firstRoot, IDENTITY_FILE);
  const secondPath = path.join(secondRoot, IDENTITY_FILE);
  const first = JSON.parse(await readFile(firstPath, "utf8")) as Record<string, unknown>;
  const second = JSON.parse(await readFile(secondPath, "utf8")) as Record<string, unknown>;
  first.keyId = second.keyId;
  first.publicKeySpki = second.publicKeySpki;
  await writeFile(firstPath, `${JSON.stringify(first)}\n`, { mode: 0o600 });
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot: firstRoot,
      platform: hostPlatform,
      protector
    }),
    /개인키와 공개키/u
  );

  const symlinkRoot = await temporaryState(t);
  await symlink(secondPath, path.join(symlinkRoot, IDENTITY_FILE));
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot: symlinkRoot,
      platform: hostPlatform,
      protector
    }),
    /regular file/u
  );

  const directoryRoot = await temporaryState(t);
  await mkdir(path.join(directoryRoot, IDENTITY_FILE));
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot: directoryRoot,
      platform: hostPlatform,
      protector
    }),
    /regular file/u
  );
});

test("device identity publication은 경쟁 파일을 덮어쓰지 않고 EEXIST로 끝난다", async (t) => {
  const winnerRoot = await temporaryState(t);
  const contenderRoot = await temporaryState(t);
  const protector = xorProtector();
  const winner = await loadOrCreateDesktopDeviceIdentity({
    stateRoot: winnerRoot,
    platform: hostPlatform,
    protector
  });
  const winnerBytes = await readFile(path.join(winnerRoot, IDENTITY_FILE));
  const contenderPath = path.join(contenderRoot, IDENTITY_FILE);
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot: contenderRoot,
      platform: hostPlatform,
      protector,
      fileHooks: {
        beforePublish: async (filePath) => {
          assert.equal(filePath, contenderPath);
          await writeFile(filePath, winnerBytes, { mode: 0o600, flag: "wx" });
        }
      }
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "EEXIST"
  );
  assert.deepEqual(await readFile(contenderPath), winnerBytes);
  const loadedWinner = await loadOrCreateDesktopDeviceIdentity({
    stateRoot: contenderRoot,
    platform: hostPlatform,
    protector
  });
  assert.equal(loadedWinner.keyId, winner.keyId);
});

test("device identity read는 lstat/open과 read/restat TOCTOU를 결정적으로 거부한다", async (t) => {
  const protector = xorProtector();
  const stateRoot = await temporaryState(t);
  await loadOrCreateDesktopDeviceIdentity({
    stateRoot,
    platform: hostPlatform,
    protector
  });
  const identityPath = path.join(stateRoot, IDENTITY_FILE);
  const original = await readFile(identityPath);
  const displaced = `${identityPath}.displaced`;
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot,
      platform: hostPlatform,
      protector,
      fileHooks: {
        afterInitialLstat: async () => {
          await rename(identityPath, displaced);
          await writeFile(identityPath, original, { mode: 0o600, flag: "wx" });
        }
      }
    }),
    /여는 동안 바뀌었습니다/u
  );

  await rm(identityPath);
  await rename(displaced, identityPath);
  await assert.rejects(
    loadOrCreateDesktopDeviceIdentity({
      stateRoot,
      platform: hostPlatform,
      protector,
      fileHooks: {
        afterReadBeforeRestat: async (filePath) => {
          await writeFile(filePath, Buffer.concat([original, Buffer.from(" ")]));
        }
      }
    }),
    /읽는 동안 바뀌었습니다/u
  );
});

function safeStorageFixture({
  available = true,
  backend = "gnome_libsecret"
}: {
  available?: boolean;
  backend?: DesktopSafeStorageBackend;
} = {}): {
  readonly adapter: Readonly<DesktopSafeStorageAdapter>;
  readonly observed: {
    encryptedOutput?: Buffer;
    decryptInput?: Buffer;
  };
} {
  const observed: { encryptedOutput?: Buffer; decryptInput?: Buffer } = {};
  return {
    observed,
    adapter: Object.freeze({
      isAsyncEncryptionAvailable: async () => available,
      getSelectedStorageBackend: () => backend,
      encryptStringAsync: async (plainText: string) => {
        const output = Buffer.from(`protected:${plainText}`, "utf8");
        observed.encryptedOutput = output;
        return output;
      },
      decryptStringAsync: async (encrypted: Buffer) => {
        observed.decryptInput = encrypted;
        return {
          result: encrypted.toString("utf8").replace(/^protected:/u, ""),
          shouldReEncrypt: false
        };
      }
    })
  };
}

test("safeStorage는 unavailable/unknown/basic_text production을 거부하고 adapter Buffer를 zeroize한다", async () => {
  await assert.rejects(
    createDesktopDeviceIdentityProtector({
      safeStorage: safeStorageFixture({ available: false }).adapter,
      platform: "win32",
      requireProtectedLinuxBackend: true
    }),
    DesktopSecureStorageUnavailableError
  );
  for (const backend of ["unknown", "basic_text"] as const) {
    await assert.rejects(
      createDesktopDeviceIdentityProtector({
        safeStorage: safeStorageFixture({ backend }).adapter,
        platform: "linux",
        requireProtectedLinuxBackend: true
      }),
      DesktopSecureStorageUnavailableError
    );
  }

  for (const [platform, backend, requireProtectedLinuxBackend] of [
    ["linux", "gnome_libsecret", true],
    ["linux", "kwallet6", true],
    ["linux", "basic_text", false],
    ["win32", "unknown", true],
    ["darwin", "unknown", true]
  ] as const) {
    const fixture = safeStorageFixture({ backend });
    const protector = await createDesktopDeviceIdentityProtector({
      safeStorage: fixture.adapter,
      platform,
      requireProtectedLinuxBackend
    });
    const protectedCopy = await protector.protect("private-key");
    assert.equal(new TextDecoder().decode(protectedCopy), "protected:private-key");
    assert.ok(fixture.observed.encryptedOutput?.every((byte) => byte === 0));
    assert.equal(await protector.unprotect(protectedCopy), "private-key");
    assert.ok(fixture.observed.decryptInput?.every((byte) => byte === 0));
  }
});
