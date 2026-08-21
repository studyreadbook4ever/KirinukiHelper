import assert from "node:assert/strict";
import test from "node:test";

import {
  DesktopGatewayPortConflictError,
  createDesktopRuntimeRecoveryController,
} from "../src/desktop/runtime-supervisor.js";

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return Object.freeze({ promise, resolve });
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(`${label} 상태를 기다리다 시간이 초과되었습니다.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

test("4319 충돌은 응답 내용과 무관하게 foreign owner로 처리한다", () => {
  const conflict = new DesktopGatewayPortConflictError(
    "127.0.0.1:4319 포트를 다른 프로세스가 선점했습니다."
  );
  assert.equal(conflict.name, "DesktopGatewayPortConflictError");
  assert.match(conflict.message, /4319/u);
});

test("런타임 복구 중 겹친 failure는 하나의 quiesce와 restart로 합친다", async () => {
  const releaseQuiesce = deferred();
  let quiesceCalls = 0;
  let restartCalls = 0;
  const recovery = createDesktopRuntimeRecoveryController({
    quiesce: async () => {
      quiesceCalls += 1;
      if (quiesceCalls === 1) {
        await releaseQuiesce.promise;
      }
    },
    restart: async () => {
      restartCalls += 1;
    },
    restartDelaysMs: [1],
    stableResetMs: 1_000
  });

  recovery.reportFailure(new Error("first"));
  recovery.reportFailure(new Error("duplicate-a"));
  recovery.reportFailure(new Error("duplicate-b"));

  assert.deepEqual(recovery.snapshot(), {
    circuitOpen: false,
    consecutiveFailures: 1,
    recovering: true,
    stopped: false
  });
  assert.equal(quiesceCalls, 1);

  releaseQuiesce.resolve();
  await waitFor(
    () => restartCalls === 1 && !recovery.snapshot().recovering,
    "합쳐진 단일 재시작 완료"
  );
  assert.equal(quiesceCalls, 1);
  assert.equal(restartCalls, 1);

  await recovery.stop();
  assert.equal(await recovery.terminalFailure, null);
});

test("런타임 복구는 증가하는 bounded backoff 뒤 circuit을 열고 멈춘다", async () => {
  const startedAt = performance.now();
  const restartTimes: number[] = [];
  let quiesceCalls = 0;
  const recovery = createDesktopRuntimeRecoveryController({
    quiesce: async () => {
      quiesceCalls += 1;
    },
    restart: async () => {
      restartTimes.push(performance.now());
      throw new Error(`restart-${restartTimes.length}`);
    },
    restartDelaysMs: [10, 20, 40],
    stableResetMs: 600_000
  });

  recovery.reportFailure(new Error("runtime-gone"));
  await waitFor(
    () => recovery.snapshot().circuitOpen && !recovery.snapshot().recovering,
    "bounded 재시도 회로 개방"
  );
  const terminal = await recovery.terminalFailure;

  assert.equal(restartTimes.length, 3);
  assert.equal(quiesceCalls, 4);
  assert.ok(restartTimes[0]! - startedAt >= 7, "첫 10ms backoff가 생략되었습니다.");
  assert.ok(restartTimes[1]! - restartTimes[0]! >= 17, "둘째 20ms backoff가 생략되었습니다.");
  assert.ok(restartTimes[2]! - restartTimes[1]! >= 37, "셋째 40ms backoff가 생략되었습니다.");
  assert.match(terminal?.message ?? "", /3회 bounded 재시도/u);
  assert.deepEqual(recovery.snapshot(), {
    circuitOpen: true,
    consecutiveFailures: 4,
    recovering: false,
    stopped: false
  });

  recovery.reportFailure(new Error("late-duplicate"));
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(restartTimes.length, 3);
});

test("정상 stop은 대기 중 backoff를 취소하고 절대 restart하지 않는다", async () => {
  let quiesceCalls = 0;
  let restartCalls = 0;
  const recovery = createDesktopRuntimeRecoveryController({
    quiesce: async () => {
      quiesceCalls += 1;
    },
    restart: async () => {
      restartCalls += 1;
    },
    restartDelaysMs: [1_000],
    stableResetMs: 1_000
  });

  recovery.reportFailure(new Error("runtime-gone"));
  await waitFor(
    () => quiesceCalls === 1 && recovery.snapshot().recovering,
    "backoff 진입 전 quiesce"
  );
  // Let the resolved quiesce continuation install its cancellable delay.
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  const firstStop = recovery.stop();
  const secondStop = recovery.stop();
  assert.equal(firstStop, secondStop);
  const stoppedPromptly = await Promise.race([
    firstStop.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 300))
  ]);
  assert.equal(stoppedPromptly, true, "stop이 1초 backoff 만료까지 기다렸습니다.");
  assert.equal(restartCalls, 0);
  assert.equal(quiesceCalls, 2);
  assert.equal(await recovery.terminalFailure, null);
  assert.deepEqual(recovery.snapshot(), {
    circuitOpen: false,
    consecutiveFailures: 1,
    recovering: false,
    stopped: true
  });

  recovery.reportFailure(new Error("after-stop"));
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(restartCalls, 0);
});

test("quiesce 중 stop 경합은 새 backoff를 만들지 않고 즉시 종료한다", async () => {
  const releaseQuiesce = deferred();
  let quiesceCalls = 0;
  let restartCalls = 0;
  const recovery = createDesktopRuntimeRecoveryController({
    quiesce: async () => {
      quiesceCalls += 1;
      if (quiesceCalls === 1) {
        await releaseQuiesce.promise;
      }
    },
    restart: async () => {
      restartCalls += 1;
    },
    restartDelaysMs: [1_000],
    stableResetMs: 1_000
  });

  recovery.reportFailure(new Error("runtime-gone"));
  await waitFor(
    () => quiesceCalls === 1 && recovery.snapshot().recovering,
    "막힌 quiesce"
  );
  const stopped = recovery.stop();
  releaseQuiesce.resolve();

  const stoppedPromptly = await Promise.race([
    stopped.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 300))
  ]);
  assert.equal(stoppedPromptly, true, "stop 뒤에 새 1초 backoff가 설치되었습니다.");
  assert.equal(quiesceCalls, 2);
  assert.equal(restartCalls, 0);
  assert.equal(await recovery.terminalFailure, null);
  assert.deepEqual(recovery.snapshot(), {
    circuitOpen: false,
    consecutiveFailures: 1,
    recovering: false,
    stopped: true
  });
});

test("stable window 이전 실패는 누적하고 경계 이후에는 backoff를 1단계로 원자적으로 reset한다", async () => {
  let logicalNow = 0;
  let restartCalls = 0;
  const recovery = createDesktopRuntimeRecoveryController({
    quiesce: async () => undefined,
    restart: async () => {
      restartCalls += 1;
    },
    restartDelaysMs: [1, 1, 1],
    stableResetMs: 100,
    now: () => logicalNow
  });

  recovery.reportFailure(new Error("failure-1"));
  await waitFor(
    () => restartCalls === 1 && !recovery.snapshot().recovering,
    "첫 재시작"
  );
  assert.equal(recovery.snapshot().consecutiveFailures, 1);

  logicalNow = 99;
  recovery.reportFailure(new Error("failure-2"));
  await waitFor(
    () => restartCalls === 2 && !recovery.snapshot().recovering,
    "stable window 이전 둘째 재시작"
  );
  assert.equal(recovery.snapshot().consecutiveFailures, 2);

  logicalNow = 199;
  recovery.reportFailure(new Error("failure-after-stable-window"));
  recovery.reportFailure(new Error("same-outage-duplicate"));
  assert.equal(recovery.snapshot().consecutiveFailures, 1);
  await waitFor(
    () => restartCalls === 3 && !recovery.snapshot().recovering,
    "stable reset 뒤 첫 단계 재시작"
  );
  assert.deepEqual(recovery.snapshot(), {
    circuitOpen: false,
    consecutiveFailures: 1,
    recovering: false,
    stopped: false
  });

  const firstStop = recovery.stop();
  const secondStop = recovery.stop();
  assert.equal(firstStop, secondStop);
  await firstStop;
  assert.equal(await recovery.terminalFailure, null);
});
