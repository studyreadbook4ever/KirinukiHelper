import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";

import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../lib/local-runtime-origin.js";
import {
  DEFAULT_STUDIO_PORT,
  createLocalStudioHttpServer,
  createStudioInstanceNonce
} from "../../scripts/local-studio-server-core.js";
import {
  startCaptionGateway
} from "../../scripts/caption-gateway.js";
import {
  materializeChzzkVod
} from "../../scripts/chzzk-vod-materializer.js";
import {
  materializeExternalVod
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
import {
  DESKTOP_TOOL_MANIFEST_SCHEMA,
  DESKTOP_YT_DLP_RELEASE,
  desktopToolTargetManifest
} from "./tool-manifest.js";

export interface DesktopRuntimeSupervisorOptions {
  readonly appRoot: string;
  readonly paths: Readonly<DesktopRuntimePaths>;
  readonly nodeBinary: string;
}

export interface DesktopRuntimeSupervisor {
  readonly studioUrl: string;
  readonly stop: () => Promise<void>;
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

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  server.closeIdleConnections?.();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 2_000);
    timer.unref?.();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
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
}> {
  const expected = desktopToolTargetManifest(paths.bundleTarget);
  const toolsRoot = path.join(
    paths.resourcesRoot,
    "desktop-tools",
    paths.bundleTarget
  );
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
  return Object.freeze({ ffmpeg, ffprobe, ytDlp });
}

function gatewayEnvironment({
  appRoot,
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
    KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_LOCAL_STUDIO_ORIGIN,
    KIRINUKI_AUTO_PAIR: "1",
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
  const environment = gatewayEnvironment({
    ...options,
    appRoot,
    nodeBinary,
    tools
  });
  const studioServer = createLocalStudioHttpServer({
    repoRoot: appRoot,
    instanceNonce: createStudioInstanceNonce()
  });
  let gateway: Awaited<ReturnType<typeof startCaptionGateway>> | null = null;
  try {
    await listen(studioServer, DEFAULT_STUDIO_PORT);
    gateway = await startCaptionGateway({
      env: environment,
      chzzkMaterializer: (request) => materializeChzzkVod(
        { ...request, stateDir: options.paths.vodCacheRoot },
        {
          ffmpegBinary: tools.ffmpeg,
          ffprobeBinary: tools.ffprobe
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
          ffprobeBinary: tools.ffprobe
        }
      )
    });
  } catch (error) {
    await Promise.allSettled([
      gateway?.shutdown(),
      closeServer(studioServer)
    ]);
    throw error;
  }
  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      await Promise.allSettled([
        gateway?.shutdown(),
        closeServer(studioServer)
      ]).then((results) => {
        const errors = results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (errors.length > 0) {
          throw new AggregateError(errors, "Kirinuki 내부 런타임 종료에 실패했습니다.");
        }
      });
    })();
    return stopPromise;
  };
  return Object.freeze({
    studioUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/`,
    stop
  });
}
