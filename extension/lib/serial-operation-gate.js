// Generated from TypeScript sources. Do not edit directly.
function createSerialOperationGate() {
  let tail = Promise.resolve();
  return {
    reserve: () => {
      const waitForTurn = tail;
      let finish = () => {
      };
      let released = false;
      tail = new Promise((resolve) => {
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
export {
  createSerialOperationGate
};
