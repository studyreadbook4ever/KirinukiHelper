import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WEB_STUDIO_SESSION_IDLE_TTL_MS,
  WEB_STUDIO_SESSION_STORAGE_KEY,
  WEB_STUDIO_TRANSITION_GENERATION_KEY,
  beginWebEditorSession,
  clearCurrentTabWebEditorSession,
  completeStudioEditorSession,
  runStudioSourceAction,
  studioEditorReady,
  verifyStudioUsagePolicyGate
} from "../src/editor/studio-runtime-web.js";
import {
  USAGE_POLICY_CONFIRMATION_PHRASE,
  createPerUseConfirmationAttestation
} from "../src/lib/usage-policy.js";

class MemoryStorage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#values.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    this.#values.set(normalizedKey, normalizedValue);
    Object.defineProperty(this, normalizedKey, {
      configurable: true,
      enumerable: true,
      get: () => this.#values.get(normalizedKey)
    });
  }

  removeItem(key: string): void {
    const normalizedKey = String(key);
    this.#values.delete(normalizedKey);
    delete (this as unknown as Record<string, unknown>)[normalizedKey];
  }

  clear(): void {
    for (const key of [...this.#values.keys()]) {
      this.removeItem(key);
    }
  }
}

function attestation({
  projectId,
  sourceSessionId,
  confirmedAt = "2026-08-15T00:00:00.000Z"
}: {
  projectId: string;
  sourceSessionId: string;
  confirmedAt?: string;
}) {
  return createPerUseConfirmationAttestation({
    target: {
      projectId,
      sourceSessionId,
      purpose: "editor-new"
    },
    confirmationText: USAGE_POLICY_CONFIRMATION_PHRASE,
    confirmedAt
  });
}

async function withWebRuntimeGlobals(
  operation: (
    sessionStorage: MemoryStorage,
    localStorage: MemoryStorage
  ) => Promise<void>
): Promise<void> {
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const replace = (key: PropertyKey, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  replace("sessionStorage", session);
  replace("localStorage", local);
  replace("location", { origin: "http://127.0.0.1:4320" });
  replace("navigator", {});
  try {
    await operation(session, local);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<PropertyKey, unknown>)[key];
      }
    }
  }
}

test("same-source 재진입은 confirmedAt이 같아도 새 lease·세대로 CAS된다", async () => {
  await withWebRuntimeGlobals(async (storage) => {
    const projectId = "project-same-source";
    const sourceSessionId = "vod:111";
    const captureSeed = {
      source: { platform: "CHZZK", contentType: "vod", contentId: "111" },
      segments: [{ id: "a", startSeconds: 10, endSeconds: 20 }]
    };
    const first = await beginWebEditorSession({
      attestation: attestation({ projectId, sourceSessionId }),
      captureSeed
    });
    const firstVerified = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: first.gateToken
    });
    assert.equal(firstVerified.ok, true);
    const firstLease = firstVerified.usagePolicy as {
      sessionLeaseId: string;
      transitionGeneration: number;
    };
    assert.match(firstLease.sessionLeaseId, /^[a-f0-9]{64}$/u);
    assert.equal(firstLease.transitionGeneration, 1);

    const second = await beginWebEditorSession({
      attestation: attestation({ projectId, sourceSessionId }),
      captureSeed
    });
    const staleGate = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: first.gateToken
    });
    assert.equal(staleGate.ok, false);
    const secondVerified = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: second.gateToken
    });
    assert.equal(secondVerified.ok, true);
    const secondLease = secondVerified.usagePolicy as {
      sessionLeaseId: string;
      transitionGeneration: number;
    };
    assert.notEqual(secondLease.sessionLeaseId, firstLease.sessionLeaseId);
    assert.equal(secondLease.transitionGeneration, 2);
    assert.equal(
      storage.getItem(WEB_STUDIO_TRANSITION_GENERATION_KEY),
      "2"
    );

    const staleReady = await studioEditorReady({
      projectId,
      sourceSessionId,
      ...firstLease,
      sourceUrl: "https://chzzk.naver.com/video/111"
    });
    assert.deepEqual(
      { ok: staleReady.ok, connected: staleReady.connected },
      { ok: false, connected: false }
    );
    const staleAction = await runStudioSourceAction({
      projectId,
      sourceSessionId,
      ...firstLease,
      sourceUrl: "https://chzzk.naver.com/video/111",
      action: "focus",
      sourceSeconds: null
    });
    assert.equal(staleAction.ok, false);
    const staleCompletion = await completeStudioEditorSession({
      projectId,
      sourceSessionId,
      ...firstLease
    });
    assert.equal(staleCompletion.ok, false);

    const activeSession = JSON.parse(String(
      storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY)
    )) as Record<string, unknown>;
    assert.equal(activeSession.sessionLeaseId, secondLease.sessionLeaseId);
    assert.equal(activeSession.transitionGeneration, 2);
    const completed = await completeStudioEditorSession({
      projectId,
      sourceSessionId,
      ...secondLease
    });
    assert.equal(completed.ok, true);
    assert.equal(storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY), null);
  });
});

test("A→B 전환은 A seed를 보존 캐시와 혼동하지 않고 B envelope만 남긴다", async () => {
  await withWebRuntimeGlobals(async (storage, persistentStorage) => {
    const firstProjectId = "project-a";
    const secondProjectId = "project-b";
    const seedPrefix = "kirinuki:local-web:storage:chzzkKirinukiEditorSeed:";
    persistentStorage.setItem(
      `${seedPrefix}legacy-project`,
      JSON.stringify({ captureState: { source: { contentId: "legacy" } } })
    );
    await beginWebEditorSession({
      attestation: attestation({
        projectId: firstProjectId,
        sourceSessionId: "vod:111"
      }),
      captureSeed: { source: { contentId: "111" }, segments: [] }
    });
    const firstSeed = JSON.parse(String(
      storage.getItem(`${seedPrefix}${firstProjectId}`)
    )) as Record<string, unknown>;

    const second = await beginWebEditorSession({
      attestation: attestation({
        projectId: secondProjectId,
        sourceSessionId: "vod:222"
      }),
      captureSeed: { source: { contentId: "222" }, segments: [] }
    });
    assert.equal(
      persistentStorage.getItem(`${seedPrefix}legacy-project`),
      null
    );
    assert.equal(storage.getItem(`${seedPrefix}${firstProjectId}`), null);
    const secondSeed = JSON.parse(String(
      storage.getItem(`${seedPrefix}${secondProjectId}`)
    )) as Record<string, unknown>;
    assert.equal(secondSeed.projectId, secondProjectId);
    assert.equal(secondSeed.sourceSessionId, "vod:222");
    assert.equal(secondSeed.transitionGeneration, 2);
    assert.notEqual(secondSeed.sessionLeaseId, firstSeed.sessionLeaseId);
    const staleA = await verifyStudioUsagePolicyGate({
      projectId: firstProjectId,
      gateToken: ""
    });
    assert.equal(staleA.ok, false);
    const admittedB = await verifyStudioUsagePolicyGate({
      projectId: secondProjectId,
      gateToken: second.gateToken
    });
    assert.equal(admittedB.ok, true);
  });
});

test("같은 탭의 정상 F5는 admitted lease를 그대로 쓰고 지운 lease를 재생성하지 않는다", async () => {
  await withWebRuntimeGlobals(async (storage) => {
    const projectId = "project-reload";
    const sourceSessionId = "vod:reload";
    const opened = await beginWebEditorSession({
      attestation: attestation({ projectId, sourceSessionId }),
      captureSeed: { source: { contentId: "reload" }, segments: [] }
    });
    const admitted = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: opened.gateToken
    });
    assert.equal(admitted.ok, true);
    const reloaded = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: ""
    });
    assert.equal(reloaded.ok, true);
    assert.deepEqual(reloaded.usagePolicy, admitted.usagePolicy);

    clearCurrentTabWebEditorSession();
    assert.equal(storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY), null);
    const closedTab = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: ""
    });
    assert.equal(closedTab.ok, false);
    assert.equal(storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY), null);
  });
});

test("24시간 idle lease는 fail-closed로 seed까지 지우고 활성 lease는 sliding 갱신한다", async () => {
  await withWebRuntimeGlobals(async (storage) => {
    const projectId = "project-ttl";
    const sourceSessionId = "vod:ttl";
    const opened = await beginWebEditorSession({
      attestation: attestation({ projectId, sourceSessionId }),
      captureSeed: { source: { contentId: "ttl" }, segments: [] }
    });
    const seedKey =
      `kirinuki:local-web:storage:chzzkKirinukiEditorSeed:${projectId}`;
    const admitted = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: opened.gateToken
    });
    assert.equal(admitted.ok, true);

    const active = JSON.parse(String(
      storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY)
    )) as Record<string, unknown>;
    const staleButValid = Date.now() - 60_000;
    active.createdAtMs = staleButValid;
    active.lastSeenAtMs = staleButValid;
    storage.setItem(WEB_STUDIO_SESSION_STORAGE_KEY, JSON.stringify(active));
    const refreshed = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: ""
    });
    assert.equal(refreshed.ok, true);
    const refreshedRecord = JSON.parse(String(
      storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY)
    )) as Record<string, unknown>;
    assert.ok(Number(refreshedRecord.lastSeenAtMs) > staleButValid);

    refreshedRecord.createdAtMs = Date.now() - WEB_STUDIO_SESSION_IDLE_TTL_MS - 2;
    refreshedRecord.lastSeenAtMs = Date.now() - WEB_STUDIO_SESSION_IDLE_TTL_MS - 1;
    storage.setItem(
      WEB_STUDIO_SESSION_STORAGE_KEY,
      JSON.stringify(refreshedRecord)
    );
    const expired = await verifyStudioUsagePolicyGate({
      projectId,
      gateToken: ""
    });
    assert.equal(expired.ok, false);
    assert.equal(storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY), null);
    assert.equal(storage.getItem(seedKey), null);
  });
});

test("시작 화면의 탭 owner 정리는 저장 데이터와 A→B 세대는 보존한다", async () => {
  await withWebRuntimeGlobals(async (storage) => {
    await beginWebEditorSession({
      attestation: attestation({
        projectId: "project-owner",
        sourceSessionId: "vod:owner"
      }),
      captureSeed: { source: { contentId: "owner" }, segments: [] }
    });
    clearCurrentTabWebEditorSession();
    assert.equal(storage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY), null);
    assert.equal(
      storage.getItem(WEB_STUDIO_TRANSITION_GENERATION_KEY),
      "1"
    );

    const second = await beginWebEditorSession({
      attestation: attestation({
        projectId: "project-next",
        sourceSessionId: "vod:next"
      })
    });
    const verified = await verifyStudioUsagePolicyGate({
      projectId: "project-next",
      gateToken: second.gateToken
    });
    assert.equal(verified.ok, true);
    assert.equal(
      (verified.usagePolicy as { transitionGeneration: number })
        .transitionGeneration,
      2
    );
  });
});

test("editor는 BFCache·seed·checkpoint·늦은 materialization을 같은 lease로 묶는다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /function sameUsagePolicyLease\([\s\S]*left\.sessionLeaseId === right\.sessionLeaseId[\s\S]*left\.transitionGeneration === right\.transitionGeneration/u
  );
  assert.match(
    source,
    /event\.persisted[\s\S]*same tab may have[\s\S]*refreshUsagePolicyLease\(expected\)[\s\S]*resumeEditorAfterPageShow\(\);/u
  );
  assert.match(
    source,
    /async function refreshUsagePolicyLease[\s\S]*!sameUsagePolicyLease\(refreshed, expected\)[\s\S]*throw new ReplacedUsagePolicyLeaseError/u
  );
  assert.match(
    source,
    /function handleUsagePolicyLeaseRefreshFailure[\s\S]*ReplacedUsagePolicyLeaseError[\s\S]*leaveReplacedUsagePolicySession[\s\S]*transient case only/u
  );
  assert.doesNotMatch(
    source,
    /reverifyUsagePolicyLeaseAfterPageRestore|lockEditorForUsagePolicy|편집기를 잠갔습니다/u
  );
  assert.match(
    source,
    /seed\.projectId !== requestedProjectId[\s\S]*seed\.sourceSessionId !== activePolicy\.sourceSessionId[\s\S]*seed\.sessionLeaseId !== activePolicy\.sessionLeaseId[\s\S]*seed\.transitionGeneration !== activePolicy\.transitionGeneration/u
  );
  assert.match(
    source,
    /editingSessionCheckpointId = \([\s\S]*checkpointPolicy\.transitionGeneration[\s\S]*checkpointPolicy\.sessionLeaseId/u
  );
  const materializationStart = source.indexOf("async function prepareChzzkVodMedia(");
  const materializationEnd = source.indexOf(
    "function mergePendingVodHotLoadRange(",
    materializationStart
  );
  const materialization = source.slice(materializationStart, materializationEnd);
  const leaseCheck = materialization.indexOf(
    "requireSameUsagePolicyLease(activePolicy)"
  );
  const attach = materialization.indexOf("await attachMediaSource(");
  assert.ok(leaseCheck >= 0 && attach > leaseCheck);
  assert.match(
    materialization,
    /project\.id !== sourceClockProject\.id[\s\S]*liveSourceSessionId !== activePolicy\.sourceSessionId/u
  );
});
