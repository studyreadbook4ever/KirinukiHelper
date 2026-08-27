import assert from "node:assert/strict";
import test from "node:test";

import {
  KIRINUKI_LINUX_DESKTOP_EXEC,
  KIRINUKI_LINUX_DESKTOP_ID,
  LinuxProtocolAssociationError,
  ensureDesktopProtocolRegistration,
  reconcileLinuxProtocolAssociation,
  removeDesktopProtocolRegistration
} from "../src/desktop/protocol-registration.js";

const currentEntry = {
  content: `[Desktop Entry]\nType=Application\nName=Kirinuki\nExec=${KIRINUKI_LINUX_DESKTOP_EXEC}\nMimeType=x-scheme-handler/kirinuki-engine;\n`,
  executableExists: true,
  regularFile: true
} as const;

test("Linux association 없음·현재·owned stale·foreign을 exact readback으로 구분한다", async () => {
  for (const scenario of ["absent", "current", "legacy"] as const) {
    let selected = scenario === "current"
      ? KIRINUKI_LINUX_DESKTOP_ID
      : scenario === "legacy" ? "Kirinuki.desktop" : "";
    const writes: string[] = [];
    const result = await reconcileLinuxProtocolAssociation({
      queryDefault: async () => selected,
      setDefault: async (desktopId) => {
        writes.push(desktopId);
        selected = desktopId;
      },
      inspect: async (desktopId) => desktopId === KIRINUKI_LINUX_DESKTOP_ID
        ? currentEntry
        : desktopId === "Kirinuki.desktop"
          ? {
              content: "[Desktop Entry]\nType=Application\nName=Kirinuki\nExec=/old/checkout/Kirinuki %U\nMimeType=x-scheme-handler/kirinuki-engine;\n",
              executableExists: false,
              regularFile: true
            }
          : null
    });
    assert.equal(result, scenario === "current"
      ? "already-registered"
      : scenario === "legacy" ? "migrated-owned-legacy" : "registered");
    assert.deepEqual(writes, scenario === "current" ? [] : [KIRINUKI_LINUX_DESKTOP_ID]);
  }

  let writes = 0;
  await assert.rejects(reconcileLinuxProtocolAssociation({
    queryDefault: async () => "foreign.desktop",
    setDefault: async () => { writes += 1; },
    inspect: async (desktopId) => desktopId === KIRINUKI_LINUX_DESKTOP_ID
      ? currentEntry
      : {
          content: "[Desktop Entry]\nType=Application\nName=Other\nExec=/usr/bin/other %U\nMimeType=x-scheme-handler/kirinuki-engine;\n",
          executableExists: true,
          regularFile: true
        }
  }), (error: unknown) => (
    error instanceof LinuxProtocolAssociationError
    && error.code === "FOREIGN_HANDLER"
  ));
  assert.equal(writes, 0);
});

test("이미 등록된 protocol은 변경하지 않고 idempotent readback으로 통과한다", () => {
  let setCalls = 0;
  const result = ensureDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => true,
      setAsDefaultProtocolClient: () => {
        setCalls += 1;
        return true;
      }
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  });
  assert.equal(result, "already-registered");
  assert.equal(setCalls, 0);
});

test("protocol 제거는 현재 앱 소유 readback이 true일 때만 실행하고 재확인한다", () => {
  let registered = true;
  let removeCalls = 0;
  assert.equal(removeDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => registered,
      setAsDefaultProtocolClient: () => true,
      removeAsDefaultProtocolClient: () => {
        removeCalls += 1;
        registered = false;
        return true;
      }
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  }), "removed");
  assert.equal(removeCalls, 1);
  assert.equal(removeDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => false,
      setAsDefaultProtocolClient: () => true,
      removeAsDefaultProtocolClient: () => {
        removeCalls += 1;
        return true;
      }
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  }), "already-absent");
  assert.equal(removeCalls, 1);
});

test("protocol 제거 API 주장 뒤 association이 남거나 API가 없으면 fail closed한다", () => {
  assert.throws(() => removeDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => true,
      setAsDefaultProtocolClient: () => true
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  }), /제거하지 못했습니다/u);
  assert.throws(() => removeDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => true,
      setAsDefaultProtocolClient: () => true,
      removeAsDefaultProtocolClient: () => true
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  }), /확인하지 못했습니다/u);
});

test("미등록 protocol은 한 번 등록한 뒤 OS readback이 true여야 통과한다", () => {
  let registered = false;
  let readbacks = 0;
  let setCalls = 0;
  const result = ensureDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => {
        readbacks += 1;
        return registered;
      },
      setAsDefaultProtocolClient: () => {
        setCalls += 1;
        registered = true;
        return true;
      }
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  });
  assert.equal(result, "registered");
  assert.equal(readbacks, 2);
  assert.equal(setCalls, 1);
});

test("set 성공 주장 뒤 OS readback이 false이면 fail closed한다", () => {
  let readbacks = 0;
  assert.throws(() => ensureDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => {
        readbacks += 1;
        return false;
      },
      setAsDefaultProtocolClient: () => true
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: false
  }), /운영체제에서 확인하지 못했습니다/u);
  assert.equal(readbacks, 2);
});

test("격리 smoke는 사용자 protocol association을 읽거나 바꾸지 않는다", () => {
  let calls = 0;
  const result = ensureDesktopProtocolRegistration({
    application: {
      isDefaultProtocolClient: () => {
        calls += 1;
        return false;
      },
      setAsDefaultProtocolClient: () => {
        calls += 1;
        return false;
      }
    },
    scheme: "kirinuki-engine",
    isolatedSmoke: true
  });
  assert.equal(result, "skipped-isolated-smoke");
  assert.equal(calls, 0);
});
