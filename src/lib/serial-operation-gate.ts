export interface SerialOperationReservation {
  waitForTurn: Promise<void>;
  release: () => void;
}

export interface SerialOperationGate {
  reserve: () => SerialOperationReservation;
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
