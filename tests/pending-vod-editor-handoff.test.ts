import assert from "node:assert/strict";
import test from "node:test";
import {
  PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX,
  PENDING_VOD_EDITOR_HANDOFF_TTL_MS,
  PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY,
  PENDING_VOD_EDITOR_HANDOFF_OWNER_LOCK_PREFIX,
  claimPendingVodEditorHandoffOwner,
  clearPendingVodEditorHandoff,
  createPendingVodEditorHandoff,
  loadPendingVodEditorHandoff,
  pendingVodEditorHandoffWithTerminal,
  pendingVodEditorHandoffWithJob,
  prunePendingVodEditorHandoffs,
  retryPendingVodEditorHandoff,
  savePendingVodEditorHandoff
} from "../src/web/pending-vod-editor-handoff.js";
import {
  USAGE_POLICY_CONFIRMATION_PHRASE,
  createPerUseConfirmationAttestation
} from "../src/lib/usage-policy.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeExclusiveLockManager {
  readonly held = new Set<string>();

  request(
    name: string,
    options: {
      mode: "exclusive";
      ifAvailable: true;
    },
    callback: (
      lock: { readonly name: string } | null
    ) => Promise<void> | void
  ): Promise<unknown> {
    assert.equal(options.mode, "exclusive");
    assert.equal(options.ifAvailable, true);
    assert.equal(Object.hasOwn(options, "signal"), false, "ifAvailable and signal cannot be combined");
    if (this.held.has(name)) {
      return Promise.resolve().then(() => callback(null));
    }
    this.held.add(name);
    return Promise.resolve().then(() => callback({ name })).finally(() => {
      this.held.delete(name);
    });
  }
}

class FakeBroadcastHub {
  readonly channels = new Set<FakeBroadcastChannel>();

  open = (_name: string): FakeBroadcastChannel => {
    const channel = new FakeBroadcastChannel(this);
    this.channels.add(channel);
    return channel;
  };
}

class FakeBroadcastChannel {
  readonly listeners = new Set<(event: { readonly data: unknown }) => void>();
  closed = false;
  private readonly hub: FakeBroadcastHub;

  constructor(hub: FakeBroadcastHub) {
    this.hub = hub;
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new DOMException("closed", "InvalidStateError");
    for (const peer of this.hub.channels) {
      if (peer === this || peer.closed) continue;
      queueMicrotask(() => {
        if (peer.closed) return;
        for (const listener of peer.listeners) {
          listener({ data: structuredClone(message) });
        }
      });
    }
  }

  addEventListener(
    type: "message",
    listener: (event: { readonly data: unknown }) => void
  ): void {
    assert.equal(type, "message");
    this.listeners.add(listener);
  }

  close(): void {
    this.closed = true;
    this.hub.channels.delete(this);
    this.listeners.clear();
  }
}

function uuidSequence(...values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    assert.ok(value, `UUID fixture exhausted at ${index}`);
    index += 1;
    return value;
  };
}

const nowMs = Date.parse("2026-09-02T00:00:00.000Z");
const ownerId = "11111111-1111-4111-8111-111111111111";
const storageKey = `${PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX}${ownerId}`;
const target = {
  projectId: "project-72",
  sourceSessionId: "vod:72",
  purpose: "editor-new" as const
};
const attestation = createPerUseConfirmationAttestation({
  target,
  confirmationText: USAGE_POLICY_CONFIRMATION_PHRASE,
  confirmedAt: new Date(nowMs).toISOString()
});

async function fixture() {
  return createPendingVodEditorHandoff({
    ownerId,
    ...target,
    sourceUrl: "https://chzzk.naver.com/video/72",
    captureSeed: {
      source: {
        platform: "CHZZK",
        contentId: "72",
        contentType: "vod",
        canonicalUrl: "https://chzzk.naver.com/video/72"
      },
      projectName: "화면 잠금 복구",
      segments: [{
        id: "clip-a",
        startSeconds: 1,
        endSeconds: 4,
        description: "사용자 메모"
      }]
    },
    attestation,
    clips: [{ id: "clip-clip-a", startMs: 1_000, endMs: 4_000 }],
    nowMs
  });
}

test("pending VOD handoff는 secret 없이 exact request fingerprint를 저장하고 복구한다", async () => {
  const storage = new MemoryStorage();
  const pending = await fixture();
  assert.match(pending.requestFingerprint, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(pending.request.continuationPolicy, "bounded-persistent-editor");
  assert.equal(pending.request.schema, "chzzk-kirinuki-vod-materialization-request/v4");
  assert.equal(pending.expiresAtMs, nowMs + PENDING_VOD_EDITOR_HANDOFF_TTL_MS);

  savePendingVodEditorHandoff(pending, storage);
  const serialized = storage.getItem(storageKey)!;
  for (const forbidden of [
    '"token"',
    '"authorization"',
    '"clientNonce"',
    '"capability"',
    '"mediaUrl"'
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "u"));
  }
  const restored = await loadPendingVodEditorHandoff(
    ownerId,
    storage,
    nowMs + 1_000
  );
  assert.deepEqual(restored, pending);

  const jobId = `vod_${pending.requestFingerprint.slice(0, 40)}`;
  const running = pendingVodEditorHandoffWithJob(pending, jobId, nowMs + 2_000);
  savePendingVodEditorHandoff(running, storage);
  assert.equal(
    (await loadPendingVodEditorHandoff(ownerId, storage, nowMs + 3_000))?.jobId,
    jobId
  );
  assert.equal(clearPendingVodEditorHandoff(ownerId, "wrong", storage), false);
  assert.equal(
    clearPendingVodEditorHandoff(ownerId, pending.requestFingerprint, storage),
    true
  );
  assert.equal(storage.getItem(storageKey), null);
});

test("pending VOD handoff는 변조·만료·다른 job identity를 fail closed 한다", async () => {
  const pending = await fixture();
  const storage = new MemoryStorage();

  assert.throws(
    () => pendingVodEditorHandoffWithJob(pending, "vod_wrong", nowMs + 1),
    /identity/u
  );

  savePendingVodEditorHandoff(pending, storage);
  const tampered = JSON.parse(
    storage.getItem(storageKey)!
  ) as Record<string, unknown>;
  (tampered.request as Record<string, unknown>).sourceUrl =
    "https://chzzk.naver.com/video/different";
  storage.setItem(
    storageKey,
    JSON.stringify(tampered)
  );
  assert.equal(
    await loadPendingVodEditorHandoff(ownerId, storage, nowMs + 1),
    null
  );
  assert.equal(storage.getItem(storageKey), null);

  savePendingVodEditorHandoff(pending, storage);
  assert.equal(
    await loadPendingVodEditorHandoff(
      ownerId,
      storage,
      nowMs + PENDING_VOD_EDITOR_HANDOFF_TTL_MS
    ),
    null
  );
});

test("startup prune은 만료·손상 orphan만 지우고 다른 탭의 유효 작업은 보존한다", async () => {
  const storage = new MemoryStorage();
  const active = await fixture();
  savePendingVodEditorHandoff(active, storage);
  const expiredOwner = "22222222-2222-4222-8222-222222222222";
  const expired = { ...active, ownerId: expiredOwner };
  storage.setItem(
    `${PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX}${expiredOwner}`,
    JSON.stringify(expired)
  );
  storage.setItem(
    `${PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX}broken`,
    "{not-json"
  );
  storage.setItem("unrelated", "keep");

  assert.equal(
    await prunePendingVodEditorHandoffs(
      storage,
      nowMs + PENDING_VOD_EDITOR_HANDOFF_TTL_MS
    ),
    3
  );
  assert.equal(storage.getItem(storageKey), null);
  assert.equal(
    storage.getItem(`${PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX}${expiredOwner}`),
    null
  );
  assert.equal(
    storage.getItem(`${PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX}broken`),
    null
  );
  assert.equal(storage.getItem("unrelated"), "keep");

  savePendingVodEditorHandoff(active, storage);
  assert.equal(await prunePendingVodEditorHandoffs(storage, nowMs + 1), 0);
  assert.ok(await loadPendingVodEditorHandoff(ownerId, storage, nowMs + 1));
});

test("pending VOD handoff는 탭별 key를 쓰고 terminal은 명시적 retry 전 재실행하지 않는다", async () => {
  const storage = new MemoryStorage();
  const pending = await fixture();
  savePendingVodEditorHandoff(pending, storage);
  const otherOwner = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    await loadPendingVodEditorHandoff(otherOwner, storage, nowMs + 1),
    null
  );
  assert.ok(await loadPendingVodEditorHandoff(ownerId, storage, nowMs + 1));

  const jobId = `vod_${pending.requestFingerprint.slice(0, 40)}`;
  const active = pendingVodEditorHandoffWithJob(pending, jobId, nowMs + 1);
  const terminal = pendingVodEditorHandoffWithTerminal(
    active,
    "EXECUTION_DEADLINE",
    nowMs + 2
  );
  assert.equal(terminal.jobId, jobId);
  savePendingVodEditorHandoff(terminal, storage);
  assert.equal(
    (await loadPendingVodEditorHandoff(ownerId, storage, nowMs + 3))?.lifecycle,
    "terminal"
  );
  const retried = retryPendingVodEditorHandoff(terminal, nowMs + 4);
  assert.equal(retried.lifecycle, "pending");
  assert.equal(retried.terminalCode, undefined);
  assert.equal(retried.jobId, undefined);
});

test("pending VOD handoff는 request와 다른 capture source·range를 거부한다", async () => {
  const pending = await fixture();
  const storage = new MemoryStorage();
  const raw = structuredClone(pending) as unknown as Record<string, unknown>;
  const seed = raw.captureSeed as {
    source: Record<string, unknown>;
    segments: Array<Record<string, unknown>>;
  };
  seed.source.canonicalUrl = "https://chzzk.naver.com/video/999";
  seed.source.url = "https://chzzk.naver.com/video/999";
  seed.source.contentId = "999";
  seed.segments[0]!.startSeconds = 90;
  seed.segments[0]!.endSeconds = 120;
  storage.setItem(storageKey, JSON.stringify(raw));
  assert.equal(
    await loadPendingVodEditorHandoff(ownerId, storage, nowMs + 1),
    null
  );
});

test("복제 탭은 활성 owner lock을 재사용하지 않고 reload는 같은 owner를 되찾는다", async () => {
  const lockManager = new FakeExclusiveLockManager();
  const firstSession = new MemoryStorage();
  const sharedLocal = new MemoryStorage();
  const first = await claimPendingVodEditorHandoffOwner({
    storage: firstSession,
    lockManager,
    broadcastChannelFactory: null,
    randomUUID: uuidSequence(
      ownerId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    ),
    claimWaitMs: 20
  });
  assert.equal(first.ownerId, ownerId);
  const pending = await fixture();
  savePendingVodEditorHandoff(pending, sharedLocal);

  // Browsers copy sessionStorage when a live tab is duplicated. The copied
  // candidate receives null for the original document's exclusive lock
  // and is replaced before any pending record can be read.
  const duplicateSession = new MemoryStorage();
  for (const [key, value] of firstSession.values) {
    duplicateSession.setItem(key, value);
  }
  const duplicateOwner = "22222222-2222-4222-8222-222222222222";
  const duplicate = await claimPendingVodEditorHandoffOwner({
    storage: duplicateSession,
    lockManager,
    broadcastChannelFactory: null,
    randomUUID: uuidSequence(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      duplicateOwner,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    ),
    claimWaitMs: 20
  });
  assert.equal(duplicate.ownerId, duplicateOwner);
  assert.equal(
    duplicateSession.getItem(
      "kirinuki:pending-vod-editor-handoff-owner:v1"
    ),
    duplicateOwner
  );
  assert.equal(
    await loadPendingVodEditorHandoff(duplicate.ownerId, sharedLocal, nowMs + 1),
    null
  );
  assert.ok(
    await loadPendingVodEditorHandoff(first.ownerId, sharedLocal, nowMs + 1)
  );

  // A real reload destroys the old document and releases its Web Lock. The
  // replacement document retains sessionStorage and atomically reclaims A.
  first.release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const reload = await claimPendingVodEditorHandoffOwner({
    storage: firstSession,
    lockManager,
    broadcastChannelFactory: null,
    randomUUID: uuidSequence(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    ),
    claimWaitMs: 20
  });
  assert.equal(reload.ownerId, ownerId);
  assert.ok(
    await loadPendingVodEditorHandoff(reload.ownerId, sharedLocal, nowMs + 1)
  );
  assert.notEqual(reload.ownerId, duplicate.ownerId);

  reload.release();
  duplicate.release();
});

test("경쟁자가 없는 Web Lock callback이 160ms보다 늦어도 reload owner를 교체하지 않는다", async () => {
  const session = new MemoryStorage();
  session.setItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY, ownerId);
  const manager = new FakeExclusiveLockManager();
  let deliverCallback: () => void = () => undefined;
  const deliveryGate = new Promise<void>((resolve) => { deliverCallback = resolve; });
  let returned = false;
  const pending = claimPendingVodEditorHandoffOwner({
    storage: session,
    lockManager: {
      request: (name, options, callback) => manager.request(name, options, async (lock) => {
        await deliveryGate;
        await callback(lock);
      })
    },
    broadcastChannelFactory: null,
    randomUUID: uuidSequence("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
  }).then((claim) => { returned = true; return claim; });
  void pending.catch(() => undefined);
  try {
    // The manager has already granted the free lock; only delivery to this
    // document is held back. A timer must not classify that as another tab.
    assert.deepEqual([...manager.held], [`${PENDING_VOD_EDITOR_HANDOFF_OWNER_LOCK_PREFIX}${ownerId}`]);
    await new Promise<void>((resolve) => setTimeout(resolve, 220));
    assert.equal(returned, false);
    assert.equal(session.getItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY), ownerId);
    deliverCallback();
    const claim = await pending;
    assert.equal(claim.ownerId, ownerId);
    claim.release();
    claim.release();
  } finally {
    deliverCallback();
    (await pending.catch(() => null))?.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(manager.held.size, 0);
});

test("실제 활성 owner 충돌은 늦은 null 응답 뒤에만 복제 탭 owner를 분리한다", async () => {
  const firstSession = new MemoryStorage();
  firstSession.setItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY, ownerId);
  const manager = new FakeExclusiveLockManager();
  const first = await claimPendingVodEditorHandoffOwner({
    storage: firstSession, lockManager: manager, broadcastChannelFactory: null,
    randomUUID: uuidSequence("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
  });
  const duplicateSession = new MemoryStorage();
  duplicateSession.setItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY, ownerId);
  const duplicateOwner = "22222222-2222-4222-8222-222222222222";
  let deliverConflict: () => void = () => undefined;
  const conflictGate = new Promise<void>((resolve) => { deliverConflict = resolve; });
  let returned = false;
  let conflictResponses = 0;
  const pending = claimPendingVodEditorHandoffOwner({
    storage: duplicateSession,
    lockManager: {
      request: (name, options, callback) => manager.request(name, options, async (lock) => {
        if (!lock) {
          conflictResponses += 1;
          await conflictGate;
        }
        await callback(lock);
      })
    },
    broadcastChannelFactory: null,
    randomUUID: uuidSequence(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", duplicateOwner,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    )
  }).then((claim) => { returned = true; return claim; });
  void pending.catch(() => undefined);
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 220));
    assert.equal(conflictResponses, 1);
    assert.equal(returned, false);
    assert.equal(duplicateSession.getItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY), ownerId);
    deliverConflict();
    const duplicate = await pending;
    assert.equal(duplicate.ownerId, duplicateOwner);
    assert.equal(firstSession.getItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY), ownerId);
    assert.equal(manager.held.size, 2, "both live documents have distinct held locks");
    duplicate.release();
  } finally {
    deliverConflict();
    (await pending.catch(() => null))?.release();
    first.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(manager.held.size, 0);
});

test("Web Locks의 동기·비동기 거부는 이전 owner를 재사용하지 않고 bounded fallback한다", async () => {
  for (const synchronous of [true, false]) {
    const session = new MemoryStorage();
    session.setItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY, ownerId);
    let calls = 0;
    let uuidIndex = 0;
    const claim = await claimPendingVodEditorHandoffOwner({
      storage: session,
      lockManager: {
        request: () => {
          calls += 1;
          const error = new DOMException("denied", "SecurityError");
          if (synchronous) throw error;
          return Promise.reject(error);
        }
      },
      broadcastChannelFactory: null,
      randomUUID: () => `${(++uuidIndex).toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
    });
    assert.equal(calls, 4);
    assert.notEqual(claim.ownerId, ownerId);
    assert.equal(session.getItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY), claim.ownerId);
    assert.doesNotThrow(() => { claim.release(); claim.release(); });
  }
});

test("Web Locks가 없을 때도 BroadcastChannel handshake가 복제 탭 owner를 분리한다", async () => {
  const hub = new FakeBroadcastHub();
  const firstSession = new MemoryStorage();
  const first = await claimPendingVodEditorHandoffOwner({
    storage: firstSession,
    lockManager: null,
    broadcastChannelFactory: hub.open,
    randomUUID: uuidSequence(
      ownerId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    ),
    claimWaitMs: 5
  });
  const copiedSession = new MemoryStorage();
  for (const [key, value] of firstSession.values) {
    copiedSession.setItem(key, value);
  }
  const splitOwner = "33333333-3333-4333-8333-333333333333";
  const duplicate = await claimPendingVodEditorHandoffOwner({
    storage: copiedSession,
    lockManager: null,
    broadcastChannelFactory: hub.open,
    randomUUID: uuidSequence(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      splitOwner,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    ),
    claimWaitMs: 5
  });
  assert.equal(first.ownerId, ownerId);
  assert.equal(duplicate.ownerId, splitOwner);

  first.release();
  const reload = await claimPendingVodEditorHandoffOwner({
    storage: firstSession,
    lockManager: null,
    broadcastChannelFactory: hub.open,
    randomUUID: uuidSequence(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    ),
    claimWaitMs: 5
  });
  assert.equal(reload.ownerId, ownerId);

  reload.release();
  duplicate.release();
});
