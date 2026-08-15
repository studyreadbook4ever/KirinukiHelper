import process from "node:process";

interface DevToolsTarget {
  id?: unknown;
  type?: unknown;
  url?: unknown;
  webSocketDebuggerUrl?: unknown;
}

interface CdpEnvelope {
  id?: unknown;
  result?: {
    result?: {
      value?: unknown;
      description?: unknown;
    };
    exceptionDetails?: unknown;
  };
  error?: unknown;
}

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`${name} 인자가 필요합니다.`);
  }
  return value;
}

function debuggerPort(): number {
  const port = Number(argumentValue("--port"));
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("--port는 유효한 loopback 포트여야 합니다.");
  }
  return port;
}

function targetMatches(target: DevToolsTarget): boolean {
  const requestedId = process.argv.includes("--target-id")
    ? argumentValue("--target-id")
    : "";
  const requestedPrefix = process.argv.includes("--url-prefix")
    ? argumentValue("--url-prefix")
    : "";
  if (Boolean(requestedId) === Boolean(requestedPrefix)) {
    throw new Error("--target-id 또는 --url-prefix 중 하나만 지정해야 합니다.");
  }
  return requestedId
    ? target.id === requestedId
    : typeof target.url === "string" && target.url.startsWith(requestedPrefix);
}

function asTargets(value: unknown): DevToolsTarget[] {
  if (!Array.isArray(value)) {
    throw new Error("DevTools target 목록이 배열이 아닙니다.");
  }
  return value.filter((target): target is DevToolsTarget => (
    Boolean(target) && typeof target === "object" && !Array.isArray(target)
  ));
}

async function evaluate(
  webSocketDebuggerUrl: string,
  expression: string
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("CDP 평가가 30초 안에 끝나지 않았습니다."));
    }, 30_000);
    const finish = (callback: () => void): void => {
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true
        }
      }));
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error("CDP WebSocket 연결에 실패했습니다.")));
    });
    socket.addEventListener("message", (event) => {
      let envelope: CdpEnvelope;
      try {
        envelope = JSON.parse(String(event.data)) as CdpEnvelope;
      } catch {
        return;
      }
      if (envelope.id !== 1) {
        return;
      }
      if (envelope.error || envelope.result?.exceptionDetails) {
        finish(() => reject(new Error(
          `CDP 평가 오류: ${JSON.stringify(envelope.error || envelope.result?.exceptionDetails)}`
        )));
        return;
      }
      finish(() => resolve(
        envelope.result?.result?.value
        ?? envelope.result?.result?.description
        ?? null
      ));
    });
  });
}

const port = debuggerPort();
const expression = argumentValue("--expression");
const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
  signal: AbortSignal.timeout(5_000)
});
if (!response.ok) {
  throw new Error(`DevTools target 목록 요청이 실패했습니다: HTTP ${response.status}`);
}
const matches = asTargets(await response.json()).filter(targetMatches);
if (matches.length !== 1) {
  throw new Error(`일치하는 CDP target은 정확히 하나여야 합니다: ${matches.length}개`);
}
const target = matches[0]!;
if (
  target.type !== "page"
  || typeof target.webSocketDebuggerUrl !== "string"
  || !target.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`)
) {
  throw new Error("CDP target이 안전한 loopback page가 아닙니다.");
}
console.log(JSON.stringify(await evaluate(
  target.webSocketDebuggerUrl,
  expression
)));
