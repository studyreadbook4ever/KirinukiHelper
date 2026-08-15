import { createHash } from "node:crypto";
import path from "node:path";

import {
  KIRINUKI_WHISPER_CONNECTION_FILENAME,
  WHISPER_MODEL_CATALOG
} from "../src/lib/whisper-connection.js";
import type { WhisperModelId } from "../src/lib/whisper-connection.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  isKirinukiLocalStudioOrigin,
  resolveKirinukiAppOrigin
} from "../src/lib/local-runtime-origin.js";
import type { KirinukiAppOrigin } from "../src/lib/local-runtime-origin.js";

export const LOCAL_CAPTION_STACK_SCHEMA =
  "chzzk-kirinuki-local-caption-stack/v1";
export const LOCAL_CAPTION_STACK_SERVICE =
  "kirinuki-caption-stack.service";
export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_STT_PORT = 4318;
export const DEFAULT_GATEWAY_PORT = 4319;
export const MINIMUM_NODE_VERSION = "22.0.0";

export const PINNED_WHISPER_CPP = Object.freeze({
  version: "v1.8.6",
  commit: "23ee03506a91ac3d3f0071b40e66a430eebdfa1d",
  archive: Object.freeze({
    name: "whisper.cpp-v1.8.6.tar.gz",
    url:
      "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/23ee03506a91ac3d3f0071b40e66a430eebdfa1d",
    sha256: "c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032",
    size: 8_846_418
  })
});

const WHISPER_MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
const WHISPER_VAD_REVISION = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";

export const PINNED_MODELS = Object.freeze({
  draft: Object.freeze({
    id: "tiny-q5_1",
    name: "ggml-tiny-q5_1.bin",
    url:
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-tiny-q5_1.bin`,
    sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7",
    size: WHISPER_MODEL_CATALOG["tiny-q5_1"].downloadSizeBytes
  }),
  light: Object.freeze({
    id: "base-q5_1",
    name: "ggml-base-q5_1.bin",
    url:
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-base-q5_1.bin`,
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    size: WHISPER_MODEL_CATALOG["base-q5_1"].downloadSizeBytes
  }),
  auto: Object.freeze({
    id: "small-q5_1",
    name: "ggml-small-q5_1.bin",
    url:
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-small-q5_1.bin`,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    size: WHISPER_MODEL_CATALOG["small-q5_1"].downloadSizeBytes
  }),
  quality: Object.freeze({
    id: "medium-q5_0",
    name: "ggml-medium-q5_0.bin",
    url:
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-medium-q5_0.bin`,
    sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
    size: WHISPER_MODEL_CATALOG["medium-q5_0"].downloadSizeBytes
  })
});

export const PINNED_VAD_MODEL = Object.freeze({
  id: "silero-v6.2.0",
  name: "ggml-silero-v6.2.0.bin",
  url:
    `https://huggingface.co/ggml-org/whisper-vad/resolve/${WHISPER_VAD_REVISION}/ggml-silero-v6.2.0.bin`,
  sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
  size: 885_098
});

const PROFILE_NAMES = Object.freeze([
  "draft",
  "auto",
  "light",
  "quality"
] as const);
const BACKEND_NAMES = Object.freeze(["auto", "cpu", "cuda"] as const);
const SIX_GIB = 6 * 1024 ** 3;

export type CaptionStackProfile = typeof PROFILE_NAMES[number];
export type CaptionStackBackendPreference =
  typeof BACKEND_NAMES[number];
export type CaptionStackBackend = Exclude<
  CaptionStackBackendPreference,
  "auto"
>;

export interface LocalCaptionStackOptions {
  profile: CaptionStackProfile;
  backend: CaptionStackBackendPreference;
  foreground: boolean;
  dryRun: boolean;
  json: boolean;
}

export interface LocalCaptionStackPaths {
  packageRoot: string;
  dataRoot: string;
  configRoot: string;
  stateRoot: string;
  runtimeRoot: string;
  downloadsRoot: string;
  sourcesRoot: string;
  buildsRoot: string;
  modelsRoot: string;
  runtimeNoticesPath: string;
  configPath: string;
  connectionPath: string;
  unitPath: string;
  pidPath: string;
}

export interface CaptionHardware {
  platform?: string;
  nvidiaDetected?: boolean;
  nvccAvailable?: boolean;
  cpuCount?: number;
  totalMemoryBytes?: number;
}

export interface SemanticProfile {
  requestedProfile: CaptionStackProfile;
  effectiveProfile: CaptionStackProfile;
  backendPreference: CaptionStackBackendPreference;
  backend: CaptionStackBackend;
  model: typeof PINNED_MODELS[CaptionStackProfile];
  vadModel: typeof PINNED_VAD_MODEL;
  threads: number;
  buildJobs: number;
  semantics: {
    language: string;
    timestamps: string;
    vad: boolean;
    maxSpeechSeconds: number;
  };
}

export interface InstallConfig {
  schema: typeof LOCAL_CAPTION_STACK_SCHEMA;
  installedAt: string;
  profile: CaptionStackProfile;
  effectiveProfile: CaptionStackProfile;
  backendPreference: CaptionStackBackendPreference;
  backend: CaptionStackBackend;
  threads: number;
  buildJobs: number;
  host: typeof LOOPBACK_HOST;
  sttPort: number;
  gatewayPort: number;
  origin: string;
  whisper: {
    version: string;
    commit: string;
    sourceDir: string;
    buildRoot: string;
    binaryPath: string;
  };
  model: {
    id: WhisperModelId;
    path: string;
    sha256: string;
    size: number;
  };
  vad: {
    id: string;
    path: string;
    sha256: string;
    size: number;
  };
  semantics: SemanticProfile["semantics"];
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function supportedNodeVersion(
  version: unknown,
  minimum: unknown = MINIMUM_NODE_VERSION
): boolean {
  const parse = (value: unknown) => String(value || "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));
  const actual = parse(version);
  const required = parse(minimum);
  if (
    actual.length < 2
    || required.length < 2
    || [...actual, ...required].some((part) => !Number.isInteger(part))
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index] || 0;
    const requiredPart = required[index] || 0;
    if (actualPart !== requiredPart) {
      return actualPart > requiredPart;
    }
  }
  return true;
}

function bounded(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function requiredAbsolutePath(value: unknown, label: string): string {
  const raw = String(value || "");
  if (
    !raw
    || raw.trim() !== raw
    || /[\0\r\n]/u.test(raw)
    || !path.isAbsolute(raw)
  ) {
    throw new TypeError(
      `${label} 경로는 앞뒤 공백이나 줄바꿈이 없는 절대 경로여야 합니다.`
    );
  }
  return path.resolve(raw);
}

export function parseLocalCaptionStackArgs(
  argv: readonly unknown[] = []
): {
  command: string;
  options: LocalCaptionStackOptions;
} {
  const values = [...argv].map((value) => String(value));
  const command = values.shift() || "help";
  const options: {
    profile: string;
    backend: string;
    foreground: boolean;
    dryRun: boolean;
    json: boolean;
  } = {
    profile: "draft",
    backend: "auto",
    foreground: false,
    dryRun: false,
    json: false
  };
  const takeValue = (
    flag: string,
    inlineValue: string | undefined
  ): string => {
    const value = inlineValue ?? values.shift();
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${flag} 값이 필요합니다.`);
    }
    return value;
  };

  while (values.length > 0) {
    const raw = values.shift();
    if (raw === undefined) {
      break;
    }
    const [flag = "", inlineValue] = raw.split("=", 2);
    if (/api[-_]?key|token|secret/iu.test(flag)) {
      throw new TypeError(
        "API 키는 지원하지 않고 연결 정보는 Kirinuki 내부 자막 엔진이 자동 발급하므로 명령행 인자로 받을 수 없습니다."
      );
    }
    if (flag === "--profile") {
      options.profile = takeValue(flag, inlineValue);
      continue;
    }
    if (flag === "--backend") {
      options.backend = takeValue(flag, inlineValue);
      continue;
    }
    if (flag === "--foreground" || flag === "--no-systemd") {
      options.foreground = true;
      continue;
    }
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    throw new TypeError(`알 수 없는 옵션입니다: ${raw}`);
  }

  if (!PROFILE_NAMES.includes(options.profile as CaptionStackProfile)) {
    throw new TypeError(
      `profile은 ${PROFILE_NAMES.join(", ")} 중 하나여야 합니다.`
    );
  }
  if (
    !BACKEND_NAMES.includes(
      options.backend as CaptionStackBackendPreference
    )
  ) {
    throw new TypeError(
      `backend는 ${BACKEND_NAMES.join(", ")} 중 하나여야 합니다.`
    );
  }
  return {
    command,
    options: options as LocalCaptionStackOptions
  };
}

export function resolveStackPaths({
  env = {},
  homeDir,
  packageRoot
}: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  packageRoot?: string;
} = {}): Readonly<LocalCaptionStackPaths> {
  const resolvedHome = requiredAbsolutePath(homeDir, "홈");
  const fallbackPackageRoot = requiredAbsolutePath(packageRoot, "패키지");
  const resolvedPackage = env.KIRINUKI_PACKAGE_ROOT === undefined
    ? fallbackPackageRoot
    : requiredAbsolutePath(
      env.KIRINUKI_PACKAGE_ROOT,
      "KIRINUKI_PACKAGE_ROOT"
    );
  const dataBase = env.XDG_DATA_HOME
    ? requiredAbsolutePath(env.XDG_DATA_HOME, "XDG_DATA_HOME")
    : path.join(resolvedHome, ".local", "share");
  const configBase = env.XDG_CONFIG_HOME
    ? requiredAbsolutePath(env.XDG_CONFIG_HOME, "XDG_CONFIG_HOME")
    : path.join(resolvedHome, ".config");
  const stateBase = env.XDG_STATE_HOME
    ? requiredAbsolutePath(env.XDG_STATE_HOME, "XDG_STATE_HOME")
    : path.join(resolvedHome, ".local", "state");
  const runtimeBase = env.XDG_RUNTIME_DIR
    ? requiredAbsolutePath(env.XDG_RUNTIME_DIR, "XDG_RUNTIME_DIR")
    : path.join(stateBase, "run");
  const dataRoot = path.join(dataBase, "kirinuki-caption-stack");
  const configRoot = path.join(configBase, "kirinuki-caption-stack");
  const stateRoot = path.join(stateBase, "kirinuki-caption-stack");
  const runtimeRoot = path.join(runtimeBase, "kirinuki-caption-stack");
  return Object.freeze({
    packageRoot: resolvedPackage,
    dataRoot,
    configRoot,
    stateRoot,
    runtimeRoot,
    downloadsRoot: path.join(dataRoot, "downloads"),
    sourcesRoot: path.join(dataRoot, "sources"),
    buildsRoot: path.join(dataRoot, "builds"),
    modelsRoot: path.join(dataRoot, "models"),
    runtimeNoticesPath: path.join(dataRoot, "THIRD_PARTY_NOTICES.md"),
    configPath: path.join(configRoot, "config.json"),
    connectionPath: path.join(
      configRoot,
      KIRINUKI_WHISPER_CONNECTION_FILENAME
    ),
    unitPath: path.join(
      configBase,
      "systemd",
      "user",
      LOCAL_CAPTION_STACK_SERVICE
    ),
    pidPath: path.join(runtimeRoot, "stack.pid")
  });
}

export function detectBackend(
  hardware: CaptionHardware = {},
  preference: string = "auto"
): CaptionStackBackend {
  if (
    !BACKEND_NAMES.includes(
      preference as CaptionStackBackendPreference
    )
  ) {
    throw new TypeError(`지원하지 않는 backend입니다: ${preference}`);
  }
  const cudaReady = Boolean(
    hardware.platform === "linux"
    && hardware.nvidiaDetected
    && hardware.nvccAvailable
  );
  if (preference === "cuda" && !cudaReady) {
    throw new Error(
      "CUDA backend를 요청했지만 NVIDIA GPU와 CUDA compiler를 함께 찾지 못했습니다."
    );
  }
  if (preference === "cpu") {
    return "cpu";
  }
  return cudaReady ? "cuda" : "cpu";
}

export function resolveSemanticProfile(
  requestedProfile: string = "draft",
  hardware: CaptionHardware = {},
  backendPreference: string = "auto"
): Readonly<SemanticProfile> {
  if (
    !PROFILE_NAMES.includes(requestedProfile as CaptionStackProfile)
  ) {
    throw new TypeError(`지원하지 않는 profile입니다: ${requestedProfile}`);
  }
  const cpuCount = positiveInteger(hardware.cpuCount, 2);
  const memoryBytes = positiveInteger(hardware.totalMemoryBytes, SIX_GIB);
  const effectiveProfile: CaptionStackProfile = (
    requestedProfile === "auto" && memoryBytes < SIX_GIB
  )
    ? "light"
    : requestedProfile as CaptionStackProfile;
  const backend = detectBackend(hardware, backendPreference);
  const threadTargets: Record<CaptionStackProfile, number> = {
    draft: bounded(Math.floor(cpuCount / 2), 2, 4),
    light: bounded(Math.floor(cpuCount / 2), 2, 4),
    auto: bounded(Math.floor(cpuCount * 0.75), 2, 8),
    quality: bounded(cpuCount - 1, 4, 12)
  };
  const threads = backend === "cuda"
    ? Math.min(4, threadTargets[effectiveProfile])
    : threadTargets[effectiveProfile];
  return Object.freeze({
    requestedProfile: requestedProfile as CaptionStackProfile,
    effectiveProfile,
    backendPreference: backendPreference as CaptionStackBackendPreference,
    backend,
    model: PINNED_MODELS[effectiveProfile],
    vadModel: PINNED_VAD_MODEL,
    threads,
    buildJobs: bounded(cpuCount - 1, 1, 8),
    semantics: Object.freeze({
      language: "ko",
      timestamps: "segment+word",
      vad: true,
      maxSpeechSeconds: effectiveProfile === "quality" ? 30 : 25
    })
  });
}

export function createInstallConfig(
  paths: LocalCaptionStackPaths,
  semanticProfile: SemanticProfile,
  {
  sttPort = DEFAULT_STT_PORT,
  gatewayPort = DEFAULT_GATEWAY_PORT,
  origin = KIRINUKI_LOCAL_STUDIO_ORIGIN
}: {
  sttPort?: number;
  gatewayPort?: number;
  origin?: KirinukiAppOrigin;
} = {}
): Readonly<InstallConfig> {
  const binaryName = process.platform === "win32"
    ? "whisper-server.exe"
    : "whisper-server";
  const buildRoot = path.join(
    paths.buildsRoot,
    `${PINNED_WHISPER_CPP.commit}-${semanticProfile.backend}`
  );
  return Object.freeze({
    schema: LOCAL_CAPTION_STACK_SCHEMA,
    installedAt: new Date().toISOString(),
    profile: semanticProfile.requestedProfile,
    effectiveProfile: semanticProfile.effectiveProfile,
    backendPreference: semanticProfile.backendPreference,
    backend: semanticProfile.backend,
    threads: semanticProfile.threads,
    buildJobs: semanticProfile.buildJobs,
    host: LOOPBACK_HOST,
    sttPort,
    gatewayPort,
    origin: resolveKirinukiAppOrigin(origin),
    whisper: Object.freeze({
      version: PINNED_WHISPER_CPP.version,
      commit: PINNED_WHISPER_CPP.commit,
      sourceDir: path.join(
        paths.sourcesRoot,
        `whisper.cpp-${PINNED_WHISPER_CPP.commit}`
      ),
      buildRoot,
      binaryPath: path.join(buildRoot, "bin", binaryName)
    }),
    model: Object.freeze({
      id: semanticProfile.model.id,
      path: path.join(paths.modelsRoot, semanticProfile.model.name),
      sha256: semanticProfile.model.sha256,
      size: semanticProfile.model.size
    }),
    vad: Object.freeze({
      id: semanticProfile.vadModel.id,
      path: path.join(paths.modelsRoot, semanticProfile.vadModel.name),
      sha256: semanticProfile.vadModel.sha256,
      size: semanticProfile.vadModel.size
    }),
    semantics: semanticProfile.semantics
  });
}

export function installedProfileSummary(
  config: Partial<InstallConfig> | null | undefined
) {
  if (!config) {
    return null;
  }
  return Object.freeze({
    requested: String(config.profile || ""),
    effective: String(config.effectiveProfile || ""),
    model: String(config.model?.id || ""),
    backend: String(config.backend || "")
  });
}

export function buildWhisperServerArgs(
  config: InstallConfig,
  { requestPath }: { requestPath?: string } = {}
): string[] {
  if (config.host !== LOOPBACK_HOST) {
    throw new Error("로컬 STT 서버는 127.0.0.1에만 바인딩할 수 있습니다.");
  }
  const privateRequestPath = String(requestPath || "");
  if (!/^\/kirinuki-[a-f0-9]{48}$/u.test(privateRequestPath)) {
    throw new Error("로컬 STT 서버에는 매 실행 새 192-bit 비공개 요청 경로가 필요합니다.");
  }
  const args = [
    "--host", LOOPBACK_HOST,
    "--port", String(config.sttPort),
    "--request-path", privateRequestPath,
    "--model", config.model.path,
    "--language", "ko",
    "--threads", String(config.threads),
    "--processors", "1",
    "--split-on-word",
    "--vad",
    "--vad-model", config.vad.path,
    "--vad-threshold", "0.50",
    "--vad-min-speech-duration-ms", "160",
    "--vad-min-silence-duration-ms", "120",
    "--vad-max-speech-duration-s",
    String(config.semantics?.maxSpeechSeconds || 25),
    "--vad-speech-pad-ms", "80",
    "--vad-samples-overlap", "0.15"
  ];
  if (config.backend === "cpu") {
    args.push("--no-gpu");
  } else if (config.backend === "cuda") {
    args.push("--flash-attn");
  } else {
    throw new Error(`지원하지 않는 설치 backend입니다: ${config.backend}`);
  }
  return args;
}

function systemdQuote(value: unknown): string {
  const escaped = String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("$", "$$")
    .replaceAll("%", "%%");
  return `"${escaped}"`;
}

function systemdWorkingDirectory(value: string): string {
  const absolutePath = requiredAbsolutePath(value, "패키지");
  if (/[\0\r\n]/u.test(absolutePath)) {
    throw new TypeError("systemd 작업 경로에 제어 문자를 사용할 수 없습니다.");
  }
  return absolutePath
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "%%");
}

export function renderSystemdUserUnit({
  nodePath,
  runtimeArgs = [],
  cliPath,
  packageRoot,
  origin,
  writableDataRoot,
  writableVodStateRoot
}: {
  nodePath: string;
  runtimeArgs?: readonly string[];
  cliPath: string;
  packageRoot: string;
  origin: string;
  writableDataRoot?: string;
  writableVodStateRoot?: string;
}): string {
  const exactOrigin = String(origin || "");
  if (!isKirinukiLocalStudioOrigin(exactOrigin)) {
    throw new TypeError(
      "systemd unit에는 정확한 Kirinuki Studio Origin이 필요합니다."
    );
  }
  const execStart = [
    systemdQuote(requiredAbsolutePath(nodePath, "Node")),
    ...runtimeArgs.map((argument) => {
      const value = String(argument);
      if (!value || /[\0\r\n]/u.test(value)) {
        throw new TypeError("systemd runtime 인자에 빈 값이나 제어 문자를 사용할 수 없습니다.");
      }
      return systemdQuote(value);
    }),
    systemdQuote(requiredAbsolutePath(cliPath, "CLI")),
    "start",
    "--foreground"
  ].join(" ");
  const writableRoots = [writableDataRoot, writableVodStateRoot]
    .filter((value): value is string => value !== undefined)
    .map((value) => requiredAbsolutePath(value, "쓰기 가능 로컬 데이터"))
    .filter((value, index, values) => values.indexOf(value) === index);
  return [
    "[Unit]",
    "Description=Kirinuki local Whisper caption stack",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdWorkingDirectory(packageRoot)}`,
    `Environment=${systemdQuote(`KIRINUKI_PACKAGE_ROOT=${requiredAbsolutePath(packageRoot, "패키지")}`)}`,
    `ExecStart=${execStart}`,
    "Restart=on-failure",
    "RestartSec=3",
    "TimeoutStopSec=20",
    "UMask=0077",
    "RuntimeDirectory=kirinuki-caption-stack",
    "Environment=KIRINUKI_AUTO_PAIR=1",
    "Environment=KIRINUKI_STT_MODE=local-whispercpp",
    `Environment=${systemdQuote(`KIRINUKI_ALLOWED_ORIGIN=${exactOrigin}`)}`,
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=read-only",
    ...writableRoots.map((root) => (
      `ReadWritePaths=${systemdWorkingDirectory(root)}`
    )),
    "ProtectClock=true",
    "ProtectKernelLogs=true",
    "ProtectKernelModules=true",
    "ProtectKernelTunables=true",
    "RestrictRealtime=true",
    "RestrictSUIDSGID=true",
    "LockPersonality=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}

export function systemdStartCommands(): Array<{
  file: string;
  args: string[];
}> {
  return [
    { file: "systemctl", args: ["--user", "daemon-reload"] },
    {
      file: "systemctl",
      args: ["--user", "start", LOCAL_CAPTION_STACK_SERVICE]
    }
  ];
}

export function systemdRestartCommands(): Array<{
  file: string;
  args: string[];
}> {
  return [
    { file: "systemctl", args: ["--user", "daemon-reload"] },
    {
      file: "systemctl",
      args: ["--user", "restart", LOCAL_CAPTION_STACK_SERVICE]
    }
  ];
}

export function systemdStopCommands(): Array<{
  file: string;
  args: string[];
}> {
  return [
    {
      file: "systemctl",
      args: ["--user", "stop", LOCAL_CAPTION_STACK_SERVICE]
    }
  ];
}

export function sha256Hex(
  value: import("node:crypto").BinaryLike
): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSha256(
  value: import("node:crypto").BinaryLike,
  expected: unknown,
  label = "artifact"
): string {
  const actual = sha256Hex(value);
  if (actual !== String(expected || "").toLowerCase()) {
    throw new Error(
      `${label} SHA-256 불일치: expected ${expected}, received ${actual}`
    );
  }
  return actual;
}

export function secretFreeConfigJson(
  config: unknown,
  secretValues: readonly unknown[] = []
): string {
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  if (/(?:api[_-]?key|agent[_-]?token|secret)/iu.test(serialized)) {
    throw new Error("설정 파일에 비밀 필드가 포함되었습니다.");
  }
  for (const secret of secretValues) {
    if (secret && serialized.includes(String(secret))) {
      throw new Error("설정 파일에 런타임 비밀 값이 포함되었습니다.");
    }
  }
  return serialized;
}
