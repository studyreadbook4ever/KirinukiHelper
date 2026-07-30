import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

export const DEV_RUNNER_LOCK_SCHEMA = "chzzk-kirinuki-dev-runner-lock/v1";
const DEV_RUNNER_ROLES = new Set([
  "editor",
  "package",
  "validate"
] as const);
type DevRunnerRole = "editor" | "package" | "validate";
interface TcpMutexEndpoint {
  host: string;
  port: number;
  exclusive: true;
}
type MutexEndpoint = string | TcpMutexEndpoint;

export interface DevRunnerLock {
  schema: typeof DEV_RUNNER_LOCK_SCHEMA;
  pid: number;
  role: DevRunnerRole;
  createdAt: string;
  token: string;
}

interface LegacyDevRunnerLock {
  schema?: undefined;
  pid: number;
  role?: DevRunnerRole;
  createdAt: string;
  token?: undefined;
}

interface OwnerState {
  expectedClose: boolean;
  lost: boolean;
  lossError: Error | null;
  onLost: ((error: Error) => void) | null;
}

interface MutexState {
  closing: boolean;
  pendingSockets: Set<net.Socket>;
  borrowerSockets: Set<net.Socket>;
  drainWaiters: Set<() => void>;
}

export interface DevRunnerLease {
  lock: DevRunnerLock;
  lockPath: string;
  endpoint: MutexEndpoint;
  server: net.Server | null;
  ownerSockets?: Set<net.Socket>;
  ownerSocket: net.Socket | null;
  ownerState: OwnerState | null;
  mutexState?: MutexState;
  borrowed: boolean;
  released: boolean;
}

interface CreateLockOptions {
  pid?: number;
  role?: DevRunnerRole;
  createdAt?: Date | string | number;
  token?: string;
}

interface AcquireLockOptions extends CreateLockOptions {
  inheritedToken?: string;
  endpoint?: MutexEndpoint;
  onOwnerLost?: (error: Error) => void;
}

function hasErrorCode(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === code
  );
}

export function createDevRunnerLock({
  pid = process.pid,
  role = "editor",
  createdAt = new Date(),
  token = randomUUID()
}: CreateLockOptions = {}): DevRunnerLock {
  const createdAtDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError("개발 runner 잠금 PID가 올바르지 않습니다.");
  }
  if (!DEV_RUNNER_ROLES.has(role)) {
    throw new TypeError(`지원하지 않는 개발 runner 잠금 역할입니다: ${role}`);
  }
  if (!Number.isFinite(createdAtDate.getTime())) {
    throw new TypeError("개발 runner 잠금 생성 시각이 올바르지 않습니다.");
  }
  if (
    typeof token !== "string"
    || token.length < 16
    || token.length > 128
    || !/^[a-zA-Z0-9-]+$/u.test(token)
  ) {
    throw new TypeError("개발 runner 잠금 token이 올바르지 않습니다.");
  }
  return {
    schema: DEV_RUNNER_LOCK_SCHEMA,
    pid,
    role,
    createdAt: createdAtDate.toISOString(),
    token
  };
}

export function isDevRunnerLock(
  value: unknown
): value is DevRunnerLock | LegacyDevRunnerLock {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const role = candidate.role;
  return Boolean(
    (
      (
        candidate.schema === DEV_RUNNER_LOCK_SCHEMA
        && typeof candidate.token === "string"
        && candidate.token.length >= 16
        && candidate.token.length <= 128
        && /^[a-zA-Z0-9-]+$/u.test(candidate.token)
      )
      || (
        candidate.schema === undefined
        && candidate.token === undefined
      )
    )
    && Number.isInteger(candidate.pid)
    && Number(candidate.pid) > 0
    && (
      candidate.role === undefined
      || (
        typeof role === "string"
        && DEV_RUNNER_ROLES.has(role as DevRunnerRole)
      )
    )
    && typeof candidate.createdAt === "string"
    && Number.isFinite(Date.parse(candidate.createdAt))
  );
}

export async function readDevRunnerLock(
  lockPath: string
): Promise<DevRunnerLock | null> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  try {
    const value = JSON.parse(raw);
    if (!isDevRunnerLock(value)) {
      return null;
    }
    return {
      ...value,
      schema: DEV_RUNNER_LOCK_SCHEMA,
      role: value.role ?? "editor",
      token: value.token ?? ""
    };
  } catch {
    return null;
  }
}

export function devRunnerMutexEndpoint(
  lockPath: string,
  platform = process.platform
): MutexEndpoint {
  const digest = createHash("sha256")
    .update(path.resolve(lockPath))
    .digest("hex")
    .slice(0, 24);
  if (platform === "linux") {
    return `\0chzzk-kirinuki-${digest}`;
  }
  if (platform === "win32") {
    return `\\\\.\\pipe\\chzzk-kirinuki-${digest}`;
  }
  return {
    host: "127.0.0.1",
    port: 49_152 + (Number.parseInt(digest.slice(0, 4), 16) % 16_384),
    exclusive: true
  };
}

function listen(
  server: net.Server,
  endpoint: MutexEndpoint
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    if (typeof endpoint === "string") {
      server.listen(endpoint);
    } else {
      server.listen(endpoint);
    }
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function roleLabel(role: DevRunnerRole): string {
  return {
    editor: "dev:editor",
    package: "릴리스 패키징",
    validate: "릴리스 검증"
  }[role] ?? role;
}

export function failClosedOnDevRunnerOwnerLoss(label: string) {
  return (error: Error) => {
    console.error(
      `[${label}] 상위 릴리스 잠금이 사라져 즉시 중단합니다: ${error.message}`
    );
    process.exit(1);
  };
}

function connectToDevRunnerMutex(
  endpoint: MutexEndpoint,
  expectedToken: string
): Promise<{
  socket: net.Socket;
  token: string;
  ownerState: OwnerState;
}> {
  return new Promise((resolve, reject) => {
    const socket = typeof endpoint === "string"
      ? net.createConnection(endpoint)
      : net.createConnection(endpoint);
    const ownerState: OwnerState = {
      expectedClose: false,
      lost: false,
      lossError: null,
      onLost: null
    };
    let settled = false;
    let response = "";
    const finish = (error: Error | null, token = "") => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("connect", onConnect);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        const markOwnerLost = (lossError: Error) => {
          if (ownerState.lost || ownerState.expectedClose) {
            return;
          }
          ownerState.lost = true;
          ownerState.lossError = lossError;
          ownerState.onLost?.(lossError);
        };
        socket.on("error", (socketError: Error) => {
          markOwnerLost(socketError);
        });
        socket.once("close", () => {
          markOwnerLost(new Error("상위 릴리스 mutex 연결이 종료됐습니다."));
        });
        resolve({ socket, token, ownerState });
      }
    };
    const onConnect = () => {
      socket.write(`BORROW ${expectedToken}\n`);
    };
    const onData = (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (response.length > 256) {
        finish(new Error("개발 runner mutex handshake가 너무 큽니다."));
        return;
      }
      const newlineIndex = response.indexOf("\n");
      if (newlineIndex >= 0) {
        const line = response.slice(0, newlineIndex);
        finish(null, line.match(/^OK ([a-zA-Z0-9-]{16,128})$/u)?.[1] ?? line);
      }
    };
    const onError = (error: Error) => {
      finish(error);
    };
    const onClose = () => {
      finish(new Error("개발 runner mutex가 handshake 전에 종료됐습니다."));
    };
    const timeout = setTimeout(() => {
      finish(new Error("개발 runner mutex handshake 시간 초과"));
    }, 2_000);
    socket.once("connect", onConnect);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

export async function acquireDevRunnerLock(
  lockPath: string,
  options: AcquireLockOptions = {}
): Promise<DevRunnerLease> {
  const inheritedToken = String(options.inheritedToken || "").trim();
  const endpoint = options.endpoint ?? devRunnerMutexEndpoint(lockPath);
  if (inheritedToken) {
    if (typeof options.onOwnerLost !== "function") {
      throw new TypeError(
        "상위 릴리스 잠금을 빌릴 때 onOwnerLost fail-closed 처리가 필요합니다."
      );
    }
    let handshake: Awaited<
      ReturnType<typeof connectToDevRunnerMutex>
    >;
    try {
      handshake = await connectToDevRunnerMutex(endpoint, inheritedToken);
    } catch (error) {
      throw new Error(
        `상위 릴리스 잠금 프로세스가 더 이상 실행 중이지 않습니다: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (handshake.token !== inheritedToken) {
      handshake.ownerState.expectedClose = true;
      handshake.socket.destroy();
      throw new Error("상위 릴리스 mutex token이 현재 소유자와 일치하지 않습니다.");
    }
    const owner = await readDevRunnerLock(lockPath);
    if (
      !owner
      || owner.role !== "package"
      || owner.token !== inheritedToken
    ) {
      handshake.ownerState.expectedClose = true;
      handshake.socket.destroy();
      throw new Error("상위 릴리스 잠금 token이 현재 소유자와 일치하지 않습니다.");
    }
    if (handshake.ownerState.lost) {
      throw new Error(
        `상위 릴리스 잠금 프로세스가 handshake 중 종료됐습니다: `
        + handshake.ownerState.lossError?.message
      );
    }
    handshake.ownerState.onLost = options.onOwnerLost;
    return {
      lock: owner,
      lockPath,
      endpoint,
      server: null,
      ownerSocket: handshake.socket,
      ownerState: handshake.ownerState,
      borrowed: true,
      released: false
    };
  }

  const lock = createDevRunnerLock(options);
  const mutexState: MutexState = {
    closing: false,
    pendingSockets: new Set<net.Socket>(),
    borrowerSockets: new Set<net.Socket>(),
    drainWaiters: new Set<() => void>()
  };
  const resolveBorrowerDrain = () => {
    if (mutexState.borrowerSockets.size !== 0) {
      return;
    }
    for (const resolve of mutexState.drainWaiters) {
      resolve();
    }
    mutexState.drainWaiters.clear();
  };
  const ownerSockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    ownerSockets.add(socket);
    mutexState.pendingSockets.add(socket);
    socket.on("error", () => {});
    let request = "";
    const timer = setTimeout(() => socket.destroy(), 2_000);
    const onData = (chunk: Buffer) => {
      request += chunk.toString("utf8");
      if (request.length > 256) {
        socket.destroy();
        return;
      }
      const newlineIndex = request.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      socket.off("data", onData);
      clearTimeout(timer);
      mutexState.pendingSockets.delete(socket);
      const requestedToken = request
        .slice(0, newlineIndex)
        .match(/^BORROW ([a-zA-Z0-9-]{16,128})$/u)?.[1];
      if (
        mutexState.closing
        || requestedToken !== lock.token
      ) {
        socket.end("DENY\n");
        return;
      }
      mutexState.borrowerSockets.add(socket);
      socket.write(`OK ${lock.token}\n`);
    };
    socket.on("data", onData);
    socket.once("close", () => {
      clearTimeout(timer);
      ownerSockets.delete(socket);
      mutexState.pendingSockets.delete(socket);
      mutexState.borrowerSockets.delete(socket);
      resolveBorrowerDrain();
    });
  });
  try {
    await listen(server, endpoint);
  } catch (error) {
    if (!hasErrorCode(error, "EADDRINUSE")) {
      throw error;
    }
    const owner = await readDevRunnerLock(lockPath);
    const ownerDescription = owner
      ? `${roleLabel(owner.role)} (pid ${owner.pid})`
      : "다른 로컬 프로세스";
    throw new Error(
      `${ownerDescription}가 개발·검증·패키징 잠금을 사용 중입니다.`
    );
  }

  try {
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  } catch (error) {
    await close(server);
    throw error;
  }
  return {
    lock,
    lockPath,
    endpoint,
    server,
    ownerSockets,
    ownerSocket: null,
    ownerState: null,
    mutexState,
    borrowed: false,
    released: false
  };
}

export async function releaseDevRunnerLock(
  lease: DevRunnerLease | null | undefined
): Promise<boolean> {
  if (!lease || lease.released) {
    return false;
  }
  lease.released = true;
  if (lease.borrowed) {
    if (lease.ownerState) {
      lease.ownerState.expectedClose = true;
    }
    lease.ownerSocket?.destroy();
    return true;
  }
  if (!lease.mutexState || !lease.server) {
    throw new Error("직접 소유한 개발 runner mutex 상태가 없습니다.");
  }
  lease.mutexState.closing = true;
  for (const socket of lease.mutexState.pendingSockets) {
    socket.destroy();
  }
  if (lease.mutexState.borrowerSockets.size > 0) {
    const mutexState = lease.mutexState;
    await new Promise<void>((resolve) => {
      mutexState.drainWaiters.add(resolve);
    });
  }
  await close(lease.server);
  return true;
}

export function releaseDevRunnerLockSync(
  lease: DevRunnerLease | null | undefined
): boolean {
  if (!lease || lease.released) {
    return false;
  }
  lease.released = true;
  if (lease.borrowed) {
    if (lease.ownerState) {
      lease.ownerState.expectedClose = true;
    }
    lease.ownerSocket?.destroy();
    return true;
  }
  if (!lease.mutexState || !lease.server || !lease.ownerSockets) {
    throw new Error("직접 소유한 개발 runner mutex 상태가 없습니다.");
  }
  lease.mutexState.closing = true;
  for (const socket of lease.ownerSockets) {
    socket.destroy();
  }
  lease.server.close();
  return true;
}
