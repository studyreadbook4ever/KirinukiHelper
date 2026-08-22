import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../lib/local-runtime-origin.js";
import {
  isLocalMediaEngineVersion
} from "../lib/local-media-engine-contract.js";
import type {
  LocalMediaEnginePairingResponse
} from "../lib/local-media-engine-auth.js";
import {
  DEFAULT_CAPTION_GATEWAY_PORT,
  createCaptionGatewayServer
} from "../../scripts/caption-gateway.js";
import {
  materializeChzzkVod,
  runMaterializerProcess
} from "../../scripts/chzzk-vod-materializer.js";
import {
  materializeExternalVod,
  runExternalProcess
} from "../../scripts/external-vod-materializer.js";
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP,
  createVodInstanceNonce
} from "../../scripts/local-vod-runtime-core.js";
import { preparePrivateDirectories } from "./private-directory.js";
import type {
  DesktopRuntimePaths
} from "./runtime-spec.js";
import type { DesktopDeviceIdentity } from "./device-identity.js";
import {
  DESKTOP_TOOL_MANIFEST_SCHEMA,
  DESKTOP_YT_DLP_RELEASE,
  desktopToolTargetManifest
} from "./tool-manifest.js";
import {
  createWindowsJobObjectSpawn,
  verifyPackagedWindowsJobLauncher
} from "./windows-job-object.js";
import {
  verifyMacosSealedDesktopTools
} from "./macos-sealed-tools.js";
import { DESKTOP_BUILD_CHANNEL } from "./build-channel.js";

export interface DesktopRuntimeSupervisorOptions {
  readonly appRoot: string;
  readonly backgroundStart: "ready" | "requires-approval";
  readonly engineVersion: string;
  readonly deviceIdentity: Readonly<DesktopDeviceIdentity>;
  readonly paths: Readonly<DesktopRuntimePaths>;
  readonly nodeBinary: string;
}

export interface DesktopRuntimeSupervisor {
  readonly allowedOrigin: typeof KIRINUKI_PUBLIC_STUDIO_ORIGIN;
  readonly port: typeof DEFAULT_CAPTION_GATEWAY_PORT;
  /** Evidence-only readback: foreign port owners are never adopted. */
  readonly reusedExisting: false;
  readonly publishPairingResponse: (
    response: Readonly<LocalMediaEnginePairingResponse>
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly terminalFailure: Promise<Error | null>;
}

export class DesktopGatewayPortConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DesktopGatewayPortConflictError";
  }
}

function safeAbsolutePath(value: string, label: string): string {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || !path.isAbsolute(value)
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label}는 안전한 절대 경로여야 합니다.`);
  }
  return path.resolve(value);
}

function managedParent(
  candidate: string,
  parent: string,
  platform: Readonly<DesktopRuntimePaths>["platform"]
): Readonly<{ containedBy: string }> | Readonly<Record<string, never>> {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const relative = pathApi.relative(parent, candidate);
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith(`..${pathApi.sep}`)
    || pathApi.isAbsolute(relative)
  ) {
    return Object.freeze({});
  }
  return Object.freeze({ containedBy: parent });
}

export const DESKTOP_RUNTIME_RESTART_DELAYS_MS = Object.freeze([
  250,
  1_000,
  4_000
] as const);
export const DESKTOP_RUNTIME_STABLE_RESET_MS = 30_000;

export interface DesktopRuntimeRecoverySnapshot {
  readonly circuitOpen: boolean;
  readonly consecutiveFailures: number;
  readonly recovering: boolean;
  readonly stopped: boolean;
}

export interface DesktopRuntimeRecoveryController {
  readonly reportFailure: (error: unknown) => void;
  readonly snapshot: () => Readonly<DesktopRuntimeRecoverySnapshot>;
  readonly stop: () => Promise<void>;
  readonly terminalFailure: Promise<Error | null>;
}

function runtimeFailure(error: unknown, label: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(`${label}: ${String(error)}`);
}

/**
 * Keeps one in-process runtime alive without turning a persistent failure into
 * an unbounded restart loop. The caller owns the runtime instance; `quiesce`
 * must be idempotent and `restart` must publish at most one new instance.
 */
export function createDesktopRuntimeRecoveryController({
  quiesce,
  restart,
  restartDelaysMs = DESKTOP_RUNTIME_RESTART_DELAYS_MS,
  stableResetMs = DESKTOP_RUNTIME_STABLE_RESET_MS,
  now = Date.now
}: {
  readonly quiesce: () => Promise<void>;
  readonly restart: () => Promise<void>;
  readonly restartDelaysMs?: readonly number[];
  readonly stableResetMs?: number;
  readonly now?: () => number;
}): DesktopRuntimeRecoveryController {
  if (
    typeof quiesce !== "function"
    || typeof restart !== "function"
    || !Array.isArray(restartDelaysMs)
    || restartDelaysMs.length < 1
    || restartDelaysMs.length > 8
    || restartDelaysMs.some((delay, index) => (
      !Number.isSafeInteger(delay)
      || delay < 1
      || delay > 60_000
      || (index > 0 && delay < restartDelaysMs[index - 1]!)
    ))
    || !Number.isSafeInteger(stableResetMs)
    || stableResetMs < 1
    || stableResetMs > 10 * 60_000
    || typeof now !== "function"
  ) {
    throw new TypeError("내부 런타임 복구 정책이 안전한 bounded 값이 아닙니다.");
  }

  const delays = Object.freeze([...restartDelaysMs]);
  let circuitOpen = false;
  let consecutiveFailures = 0;
  let healthySince = now();
  let recoveryTask: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopped = false;
  let cancelDelay: (() => void) | null = null;
  let terminalSettled = false;
  let settleTerminal!: (failure: Error | null) => void;
  const terminalFailure = new Promise<Error | null>((resolve) => {
    settleTerminal = resolve;
  });

  const settleTerminalOnce = (failure: Error | null): void => {
    if (terminalSettled) {
      return;
    }
    terminalSettled = true;
    settleTerminal(failure);
  };

  const waitForDelay = (delayMs: number): Promise<void> => (
    new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (cancelDelay === finish) {
          cancelDelay = null;
        }
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      cancelDelay = finish;
    })
  );

  const openCircuit = (failure: Error): void => {
    if (circuitOpen || stopped) {
      return;
    }
    circuitOpen = true;
    recoveryTask = (async () => {
      let terminal = failure;
      try {
        await quiesce();
      } catch (error) {
        terminal = new AggregateError(
          [failure, runtimeFailure(error, "내부 런타임 최종 정리 실패")],
          "Kirinuki 내부 런타임 복구 회로가 열렸고 정리도 실패했습니다."
        );
      }
      settleTerminalOnce(terminal);
    })().finally(() => {
      recoveryTask = null;
    });
    void recoveryTask.catch(() => undefined);
  };

  const reportFailure = (error: unknown): void => {
    if (stopped || circuitOpen || recoveryTask) {
      return;
    }
    const timestamp = now();
    if (
      Number.isFinite(timestamp)
      && Number.isFinite(healthySince)
      && timestamp - healthySince >= stableResetMs
    ) {
      consecutiveFailures = 0;
    }
    consecutiveFailures += 1;
    const failure = runtimeFailure(error, "내부 런타임 실패");
    if (consecutiveFailures > delays.length) {
      openCircuit(new Error(
        `Kirinuki 내부 런타임이 ${delays.length}회 bounded 재시도 뒤에도 안정화되지 않았습니다.`,
        { cause: failure }
      ));
      return;
    }
    const delayMs = delays[consecutiveFailures - 1]!;
    let nextFailure: Error | null = null;
    recoveryTask = (async () => {
      try {
        await quiesce();
      } catch (quiesceError) {
        nextFailure = new AggregateError(
          [failure, runtimeFailure(quiesceError, "내부 런타임 정리 실패")],
          "Kirinuki 내부 런타임을 안전하게 정리하지 못했습니다."
        );
        return;
      }
      if (stopped || circuitOpen) {
        return;
      }
      await waitForDelay(delayMs);
      if (stopped || circuitOpen) {
        return;
      }
      try {
        await restart();
        healthySince = now();
      } catch (restartError) {
        nextFailure = new AggregateError(
          [failure, runtimeFailure(restartError, "내부 런타임 재시작 실패")],
          "Kirinuki 내부 런타임 재시작에 실패했습니다."
        );
      }
    })().catch((unexpected) => {
      nextFailure = runtimeFailure(unexpected, "내부 런타임 복구 실패");
    }).finally(() => {
      recoveryTask = null;
      if (nextFailure && !stopped && !circuitOpen) {
        reportFailure(nextFailure);
      }
    });
    void recoveryTask.catch(() => undefined);
  };

  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      stopped = true;
      cancelDelay?.();
      await recoveryTask?.catch(() => undefined);
      try {
        await quiesce();
      } finally {
        settleTerminalOnce(null);
      }
    })();
    return stopPromise;
  };

  return Object.freeze({
    reportFailure,
    snapshot: () => Object.freeze({
      circuitOpen,
      consecutiveFailures,
      recovering: recoveryTask !== null,
      stopped
    }),
    stop,
    terminalFailure
  });
}

async function sha256OpenFile(filePath: string): Promise<{
  readonly sha256: string;
  readonly size: number;
}> {
  const metadata = await lstat(filePath, { bigint: true });
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size <= 0n
    || metadata.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(`번들 도구가 regular non-symlink 파일이 아닙니다: ${filePath}`);
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position
      );
      if (bytesRead <= 0) {
        throw new Error(`번들 도구를 끝까지 읽지 못했습니다: ${filePath}`);
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error(`검증 중 번들 도구가 바뀌었습니다: ${filePath}`);
    }
    return { sha256: hash.digest("hex"), size: Number(before.size) };
  } finally {
    await handle.close();
  }
}

async function verifyDesktopTools(paths: Readonly<DesktopRuntimePaths>): Promise<{
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly ytDlp: string;
  readonly windowsJobLauncher?: string;
}> {
  const expected = desktopToolTargetManifest(paths.bundleTarget);
  const toolsRoot = path.join(
    paths.resourcesRoot,
    "desktop-tools",
    paths.bundleTarget
  );
  if (
    paths.bundleTarget === "darwin-arm64"
    && DESKTOP_BUILD_CHANNEL === "public-release"
  ) {
    const sealed = await verifyMacosSealedDesktopTools({
      resourcesRoot: paths.resourcesRoot
    });
    return Object.freeze({
      ffmpeg: sealed.ffmpeg,
      ffprobe: sealed.ffprobe,
      ytDlp: sealed.ytDlp
    });
  }
  const recordedPath = path.join(toolsRoot, "manifest.json");
  let recorded: unknown;
  try {
    recorded = JSON.parse(await readFile(recordedPath, "utf8"));
  } catch (error) {
    throw new Error("번들 미디어 도구 manifest를 읽지 못했습니다.", { cause: error });
  }
  if (
    !recorded
    || typeof recorded !== "object"
    || (recorded as { schema?: unknown }).schema !== DESKTOP_TOOL_MANIFEST_SCHEMA
    || JSON.stringify(recorded) !== JSON.stringify(expected)
  ) {
    throw new Error("번들 미디어 도구 manifest가 현재 앱과 다릅니다.");
  }
  const verify = async (artifact: typeof expected.ffmpeg): Promise<string> => {
    const filePath = path.join(toolsRoot, artifact.fileName);
    const metadata = await lstat(filePath);
    if (process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
      throw new Error(`번들 미디어 도구 실행 권한이 없습니다: ${artifact.fileName}`);
    }
    const actual = await sha256OpenFile(filePath);
    if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) {
      throw new Error(`번들 미디어 도구 무결성 검증 실패: ${artifact.fileName}`);
    }
    return filePath;
  };
  const [ffmpeg, ffprobe, ytDlp] = await Promise.all([
    verify(expected.ffmpeg),
    verify(expected.ffprobe),
    verify(expected.ytDlp)
  ]);
  const windowsJobLauncher = paths.bundleTarget === "win32-x64"
    ? (await verifyPackagedWindowsJobLauncher(
      paths.resourcesRoot,
      paths.bundleTarget
    )).executable
    : undefined;
  return Object.freeze({
    ffmpeg,
    ffprobe,
    ytDlp,
    ...(windowsJobLauncher ? { windowsJobLauncher } : {})
  });
}

function gatewayEnvironment({
  appRoot,
  backgroundStart,
  engineVersion,
  paths,
  nodeBinary,
  tools
}: DesktopRuntimeSupervisorOptions & {
  readonly tools: Awaited<ReturnType<typeof verifyDesktopTools>>;
}): NodeJS.ProcessEnv {
  return {
    COMSPEC: process.env.COMSPEC,
    ELECTRON_RUN_AS_NODE: "1",
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    LC_CTYPE: process.env.LC_CTYPE,
    NO_COLOR: "1",
    NO_PROXY: "127.0.0.1,localhost",
    PATH: [
      path.dirname(tools.ffmpeg),
      path.dirname(nodeBinary)
    ].join(path.delimiter),
    PATHEXT: process.env.PATHEXT,
    SYSTEMROOT: process.env.SYSTEMROOT,
    WINDIR: process.env.WINDIR,
    no_proxy: "127.0.0.1,localhost",
    KIRINUKI_AGENT_PORT: "4319",
    KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    KIRINUKI_LOCAL_ENGINE_BACKGROUND_START: backgroundStart,
    KIRINUKI_LOCAL_ENGINE_VERSION: engineVersion,
    KIRINUKI_FFMPEG_BINARY: tools.ffmpeg,
    KIRINUKI_FFPROBE_BINARY: tools.ffprobe,
    KIRINUKI_PACKAGE_ROOT: appRoot,
    KIRINUKI_VOD_EJS_VERSION: PINNED_YT_DLP.bundledJavascript.version,
    KIRINUKI_VOD_INSTANCE_NONCE: createVodInstanceNonce(),
    KIRINUKI_VOD_RUNTIME_KIND: "vod-only",
    KIRINUKI_VOD_RUNTIME_READY: "1",
    KIRINUKI_VOD_RUNTIME_SCHEMA: LOCAL_VOD_RUNTIME_SCHEMA,
    KIRINUKI_VOD_STATE_DIR: paths.vodCacheRoot,
    KIRINUKI_VOD_YT_DLP_VERSION: DESKTOP_YT_DLP_RELEASE.version,
    KIRINUKI_YT_DLP_BINARY: tools.ytDlp,
    KIRINUKI_YT_DLP_MODE: "standalone",
    KIRINUKI_YT_DLP_NODE_BINARY: nodeBinary
  };
}

export async function startDesktopRuntimeSupervisor(
  options: DesktopRuntimeSupervisorOptions
): Promise<DesktopRuntimeSupervisor> {
  const appRoot = safeAbsolutePath(options.appRoot, "앱 리소스");
  const nodeBinary = safeAbsolutePath(options.nodeBinary, "내장 Node");
  if (!isLocalMediaEngineVersion(options.engineVersion)) {
    throw new TypeError("로컬 엔진 release version identity가 올바르지 않습니다.");
  }
  preparePrivateDirectories([
    {
      path: options.paths.appDataRoot,
      label: "앱 데이터"
    },
    {
      path: options.paths.cacheRoot,
      label: "캐시",
      ...managedParent(
        options.paths.cacheRoot,
        options.paths.appDataRoot,
        options.paths.platform
      )
    },
    {
      path: options.paths.logsRoot,
      label: "로그",
      ...managedParent(
        options.paths.logsRoot,
        options.paths.appDataRoot,
        options.paths.platform
      )
    },
    {
      path: options.paths.tempRoot,
      label: "임시 작업",
      ...managedParent(
        options.paths.tempRoot,
        options.paths.appDataRoot,
        options.paths.platform
      )
    },
    {
      path: options.paths.jobsTempRoot,
      label: "작업 디렉터리",
      containedBy: options.paths.tempRoot
    },
    {
      path: options.paths.vodCacheRoot,
      label: "VOD 캐시",
      containedBy: options.paths.cacheRoot
    }
  ], { platform: options.paths.platform });
  const tools = await verifyDesktopTools(options.paths);
  if (
    (options.paths.platform === "win32")
      !== (tools.windowsJobLauncher !== undefined)
  ) {
    throw new Error("Windows Job Object launcher와 runtime target이 일치하지 않습니다.");
  }
  const windowsSpawn = tools.windowsJobLauncher
    ? createWindowsJobObjectSpawn({ launcherPath: tools.windowsJobLauncher })
    : undefined;
  const environment = gatewayEnvironment({
    ...options,
    appRoot,
    nodeBinary,
    tools
  });
  const createGateway = () => createCaptionGatewayServer({
    env: environment,
    deviceProofSigner: options.deviceIdentity,
    chzzkMaterializer: (request) => materializeChzzkVod(
      { ...request, stateDir: options.paths.vodCacheRoot },
      {
        ffmpegBinary: tools.ffmpeg,
        ffprobeBinary: tools.ffprobe,
        ...(windowsSpawn
          ? {
            runProcess: (command, args, processOptions) => (
              runMaterializerProcess(command, args, processOptions, {
                spawnImpl: windowsSpawn,
                platform: "win32"
              })
            )
          }
          : {})
      }
    ),
    externalMaterializer: (request) => materializeExternalVod(
      { ...request, stateDir: options.paths.vodCacheRoot },
      {
        processEnv: environment,
        ytDlpBinary: tools.ytDlp,
        ytDlpMode: "standalone",
        nodeBinary,
        ffmpegBinary: tools.ffmpeg,
        ffprobeBinary: tools.ffprobe,
        ...(windowsSpawn
          ? {
            runProcess: (command, args, processOptions) => (
              runExternalProcess(command, args, processOptions, {
                spawnImpl: windowsSpawn,
                platform: "win32"
              })
            )
          }
          : {})
      }
    )
  });
  type Gateway = ReturnType<typeof createGateway>;
  const startGateway = async (): Promise<Gateway> => {
    const candidate = createGateway();
    try {
      await candidate.ready;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          candidate.server.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          candidate.server.removeListener("error", onError);
          resolve();
        };
        candidate.server.once("error", onError);
        candidate.server.once("listening", onListening);
        candidate.server.listen({
          host: "127.0.0.1",
          port: DEFAULT_CAPTION_GATEWAY_PORT,
          exclusive: true
        });
      });
      return candidate;
    } catch (error) {
      await candidate.shutdown().catch(() => undefined);
      throw error;
    }
  };
  let gateway: Gateway;
  try {
    gateway = await startGateway();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
      throw new DesktopGatewayPortConflictError(
        `127.0.0.1:${DEFAULT_CAPTION_GATEWAY_PORT} 포트를 다른 프로세스가 선점했습니다.`,
        { cause: error }
      );
    }
    throw error;
  }

  let currentGateway: Gateway | null = gateway;
  let retiringGateway: Promise<void> | null = null;
  let detachGatewayFailureMonitor: () => void = () => undefined;
  let recovery: DesktopRuntimeRecoveryController | null = null;

  const monitorGateway = (candidate: Gateway): void => {
    const onError = (error: Error) => {
      recovery?.reportFailure(error);
    };
    const onClose = () => {
      recovery?.reportFailure(new Error(
        "Kirinuki 내부 런타임의 loopback 서버가 예기치 않게 닫혔습니다."
      ));
    };
    candidate.server.once("error", onError);
    candidate.server.once("close", onClose);
    detachGatewayFailureMonitor = () => {
      candidate.server.removeListener("error", onError);
      candidate.server.removeListener("close", onClose);
      detachGatewayFailureMonitor = () => undefined;
    };
  };

  const quiesceGateway = (): Promise<void> => {
    if (retiringGateway) {
      return retiringGateway;
    }
    const candidate = currentGateway;
    if (!candidate) {
      return Promise.resolve();
    }
    detachGatewayFailureMonitor();
    currentGateway = null;
    const shutdown = candidate.shutdown();
    const retirement = shutdown.then(
      () => {
        if (retiringGateway === retirement) {
          retiringGateway = null;
        }
      },
      (error) => {
        // Keep the rejected quiesce identity. Starting another gateway while
        // old handlers ignored abort could race the same cache and port.
        throw error;
      }
    );
    retiringGateway = retirement;
    return retiringGateway;
  };

  const restartGateway = async (): Promise<void> => {
    if (currentGateway || retiringGateway) {
      throw new Error("내부 런타임이 완전히 정리되기 전에 재시작할 수 없습니다.");
    }
    const next = await startGateway();
    currentGateway = next;
    monitorGateway(next);
  };

  recovery = createDesktopRuntimeRecoveryController({
    quiesce: quiesceGateway,
    restart: restartGateway
  });
  monitorGateway(gateway);

  return Object.freeze({
    allowedOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    port: DEFAULT_CAPTION_GATEWAY_PORT,
    reusedExisting: false,
    publishPairingResponse: async (
      response: Readonly<LocalMediaEnginePairingResponse>
    ) => {
      const candidate = currentGateway;
      if (!candidate || recovery.snapshot().stopped) {
        throw new Error("로컬 엔진 pairing response를 받을 runtime이 없습니다.");
      }
      await candidate.publishPairingResponse(response);
    },
    stop: recovery.stop,
    terminalFailure: recovery.terminalFailure
  });
}
