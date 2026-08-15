export interface SerialOperationReservation {
  waitForTurn: Promise<void>;
  release: () => void;
}

export interface SerialOperationGate {
  reserve: () => SerialOperationReservation;
}

export class StaleSerialOperationGenerationError extends Error {
  override readonly name = "StaleSerialOperationGenerationError";

  constructor() {
    super("이전 세대에서 예약한 작업이라 적용하지 않았습니다.");
  }
}

export interface GenerationBoundSerialOperationQueue {
  readonly generation: number;
  readonly pendingCount: number;
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
  advanceGeneration: () => number;
  waitForIdle: () => Promise<void>;
}

export interface LatestSerialOperationQueue {
  readonly pendingCount: number;
  enqueue: (operation: () => Promise<void>) => Promise<void>;
  waitForLatest: () => Promise<void>;
}

export function createSerialOperationGate(): SerialOperationGate {
  let tail: Promise<void> = Promise.resolve();
  return {
    reserve: () => {
      const waitForTurn = tail;
      let finish = (): void => {};
      let released = false;
      tail = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        waitForTurn,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          finish();
        }
      };
    }
  };
}

export function createGenerationBoundSerialOperationQueue():
GenerationBoundSerialOperationQueue {
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<unknown>>();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const expectedGeneration = generation;
    const queued = tail.then(() => {
      if (expectedGeneration !== generation) {
        throw new StaleSerialOperationGenerationError();
      }
      return operation();
    });
    tail = queued.then(
      () => undefined,
      () => undefined
    );
    pending.add(queued);
    void queued.then(
      () => pending.delete(queued),
      () => pending.delete(queued)
    );
    return queued;
  };

  return {
    get generation() {
      return generation;
    },
    get pendingCount() {
      return pending.size;
    },
    enqueue,
    advanceGeneration: () => {
      generation += 1;
      return generation;
    },
    waitForIdle: async () => {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    }
  };
}

/**
 * Serializes refresh-style operations while retaining a barrier for the most
 * recently requested run. A failed run does not poison the queue: a later
 * explicit retry can still run and become the new authoritative result.
 */
export function createLatestSerialOperationQueue(): LatestSerialOperationQueue {
  let tail: Promise<void> = Promise.resolve();
  let latest = tail;
  let pendingCount = 0;

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const queued = tail.then(operation);
    tail = queued.then(
      () => undefined,
      () => undefined
    );
    latest = queued;
    pendingCount += 1;
    void queued.then(
      () => {
        pendingCount -= 1;
      },
      () => {
        pendingCount -= 1;
      }
    );
    return queued;
  };

  return {
    get pendingCount() {
      return pendingCount;
    },
    enqueue,
    waitForLatest: async () => {
      while (true) {
        const observed = latest;
        try {
          await observed;
        } catch (error) {
          // A newer request supersedes both success and failure. Only the
          // result that is still latest may open or block the next phase.
          if (observed !== latest) {
            continue;
          }
          throw error;
        }
        if (observed === latest) {
          return;
        }
      }
    }
  };
}
