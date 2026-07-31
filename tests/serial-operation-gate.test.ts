import assert from "node:assert/strict";
import test from "node:test";

import {
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
