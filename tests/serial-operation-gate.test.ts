import assert from "node:assert/strict";
import test from "node:test";

import {
  StaleSerialOperationGenerationError,
  createGenerationBoundSerialOperationQueue,
  createLatestSerialOperationQueue,
  createSerialOperationGate
} from "../src/lib/serial-operation-gate.js";

const deferred = () => {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("원본 영상 시계 작업은 예약 순서대로 하나씩 실행한다", async () => {
  const gate = createSerialOperationGate();
  const first = gate.reserve();
  const second = gate.reserve();
  const third = gate.reserve();
  const firstMayFinish = deferred();
  const order: string[] = [];

  const firstRun = (async () => {
    await first.waitForTurn;
    order.push("first-start");
    await firstMayFinish.promise;
    order.push("first-end");
    first.release();
  })();
  const secondRun = (async () => {
    await second.waitForTurn;
    order.push("second");
    second.release();
  })();
  const thirdRun = (async () => {
    await third.waitForTurn;
    order.push("third");
    third.release();
  })();

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  firstMayFinish.resolve();
  await Promise.all([firstRun, secondRun, thirdRun]);
  assert.deepEqual(order, ["first-start", "first-end", "second", "third"]);
});

test("작업 오류 뒤 release와 중복 release는 다음 예약을 막지 않는다", async () => {
  const gate = createSerialOperationGate();
  const failed = gate.reserve();
  const next = gate.reserve();

  await assert.rejects(async () => {
    await failed.waitForTurn;
    try {
      throw new Error("expected failure");
    } finally {
      failed.release();
      failed.release();
    }
  }, /expected failure/u);

  await next.waitForTurn;
  next.release();
});

test("세대를 바꾸면 기다리던 옛 저장은 폐기하고 새 저장을 순서대로 실행한다", async () => {
  const queue = createGenerationBoundSerialOperationQueue();
  const firstMayFinish = deferred();
  const order: string[] = [];

  const first = queue.enqueue(async () => {
    order.push("old-running-start");
    await firstMayFinish.promise;
    order.push("old-running-end");
  });
  const stale = queue.enqueue(async () => {
    order.push("old-waiting");
  });
  const staleResult = stale.then(
    () => null,
    (error: unknown) => error
  );

  await Promise.resolve();
  assert.deepEqual(order, ["old-running-start"]);
  assert.equal(queue.generation, 0);
  assert.equal(queue.advanceGeneration(), 1);

  const current = queue.enqueue(async () => {
    order.push("new-current");
  });
  firstMayFinish.resolve();
  await Promise.all([first, current]);

  assert.ok(
    await staleResult instanceof StaleSerialOperationGenerationError
  );
  assert.deepEqual(order, [
    "old-running-start",
    "old-running-end",
    "new-current"
  ]);
  await queue.waitForIdle();
  assert.equal(queue.pendingCount, 0);
});

test("세대 큐는 작업 실패 뒤에도 다음 작업과 idle 대기를 완료한다", async () => {
  const queue = createGenerationBoundSerialOperationQueue();
  const failed = queue.enqueue(async () => {
    throw new Error("expected failure");
  });
  const next = queue.enqueue(async () => "saved");

  await assert.rejects(failed, /expected failure/u);
  assert.equal(await next, "saved");
  await queue.waitForIdle();
  assert.equal(queue.pendingCount, 0);
});

test("최신 CURRENT barrier 뒤 replacement가 실패해도 durable 상태는 최신값이다", async () => {
  const queue = createGenerationBoundSerialOperationQueue();
  const oldWriterMayFinish = deferred();
  let durableCurrent = "initial";

  const oldWriter = queue.enqueue(async () => {
    await oldWriterMayFinish.promise;
    durableCurrent = "older-queued";
  });
  const replace = (async () => {
    await queue.enqueue(async () => {
      durableCurrent = "latest-before-restore";
    });
    queue.advanceGeneration();
    await queue.enqueue(async () => {
      throw new Error("atomic restore failed");
    });
  })();

  oldWriterMayFinish.resolve();
  await oldWriter;
  await assert.rejects(replace, /atomic restore failed/u);
  assert.equal(durableCurrent, "latest-before-restore");
  await queue.waitForIdle();
});

test("latest 직렬 큐는 겹친 정리를 순서대로 실행하고 가장 늦은 결과까지 기다린다", async () => {
  const queue = createLatestSerialOperationQueue();
  const firstMayFinish = deferred();
  const order: string[] = [];

  const first = queue.enqueue(async () => {
    order.push("first-start");
    await firstMayFinish.promise;
    order.push("first-end");
  });
  const waitingForLatest = queue.waitForLatest().then(() => {
    order.push("barrier");
  });
  const second = queue.enqueue(async () => {
    order.push("second");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  assert.equal(queue.pendingCount, 2);
  firstMayFinish.resolve();
  await Promise.all([first, second, waitingForLatest]);
  assert.deepEqual(order, ["first-start", "first-end", "second", "barrier"]);
  assert.equal(queue.pendingCount, 0);
});

test("latest 직렬 큐는 실패를 닫아 막되 다음 명시적 재시도로 복구한다", async () => {
  const queue = createLatestSerialOperationQueue();
  const failed = queue.enqueue(async () => {
    throw new Error("cleanup failed");
  });

  await assert.rejects(failed, /cleanup failed/u);
  await assert.rejects(queue.waitForLatest(), /cleanup failed/u);

  const retried = queue.enqueue(async () => {});
  await retried;
  await queue.waitForLatest();
  assert.equal(queue.pendingCount, 0);
});

test("latest barrier는 기다리던 실패보다 뒤에 예약된 성공을 권위로 삼는다", async () => {
  const queue = createLatestSerialOperationQueue();
  const firstMayFail = deferred();
  const failed = queue.enqueue(async () => {
    await firstMayFail.promise;
    throw new Error("superseded cleanup failure");
  });
  const failedObserved = failed.catch(() => undefined);
  const barrier = queue.waitForLatest();
  const retry = queue.enqueue(async () => {});

  firstMayFail.resolve();
  await Promise.all([failedObserved, retry, barrier]);
  assert.equal(queue.pendingCount, 0);
});
