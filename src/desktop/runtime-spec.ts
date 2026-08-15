import path from "node:path";

export const DESKTOP_PLATFORMS = Object.freeze([
  "linux",
  "darwin",
  "win32"
] as const);
export type DesktopPlatform = typeof DESKTOP_PLATFORMS[number];

export const DESKTOP_ARCHITECTURES = Object.freeze([
  "x64",
  "arm64"
] as const);
export type DesktopArchitecture = typeof DESKTOP_ARCHITECTURES[number];

export type DesktopBundleTarget =
  `${DesktopPlatform}-${DesktopArchitecture}`;

export interface DesktopRuntimePathInputs {
  /** Dedicated durable root, such as Electron's app-specific userData path. */
  readonly appDataRoot: string;
  /** Dedicated disposable cache root. */
  readonly cacheRoot: string;
  /** Dedicated application log root. */
  readonly logsRoot: string;
  /** Dedicated disposable runtime root, preferably below appDataRoot. */
  readonly tempRoot: string;
  /** Read-only packaged resource root outside app.asar. */
  readonly resourcesRoot: string;
}

export interface DesktopRuntimePaths extends DesktopRuntimePathInputs {
  readonly platform: DesktopPlatform;
  readonly arch: DesktopArchitecture;
  readonly bundleTarget: DesktopBundleTarget;
  readonly browserSessionRoot: string;
  readonly captionDataRoot: string;
  readonly vodCacheRoot: string;
  readonly jobsTempRoot: string;
}

export interface DesktopToolExecutableNames {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly whisperServer: string;
  readonly ytDlp: string;
}

export interface DesktopToolCommand {
  readonly command: string;
  readonly argsPrefix: readonly string[];
}

export interface DesktopYtDlpCommand extends DesktopToolCommand {
  /** Desktop builds execute a bundled standalone artifact, never Python. */
  readonly artifactKind: "standalone";
}

export interface DesktopBundledTools {
  readonly platform: DesktopPlatform;
  readonly arch: DesktopArchitecture;
  readonly bundleTarget: DesktopBundleTarget;
  readonly toolsRoot: string;
  readonly executableNames: Readonly<DesktopToolExecutableNames>;
  readonly ffmpeg: Readonly<DesktopToolCommand>;
  readonly ffprobe: Readonly<DesktopToolCommand>;
  readonly whisperServer: Readonly<DesktopToolCommand>;
  readonly ytDlp: Readonly<DesktopYtDlpCommand>;
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const WINDOWS_DEVICE_NAMESPACE_PATTERN = /^\\\\[?.]\\/u;
const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_ABSOLUTE_PATTERN =
  /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u;
const WINDOWS_INVALID_SEGMENT_CHARACTER_PATTERN = /[<>:"|?*]/u;
const WINDOWS_RESERVED_SEGMENT_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

const POSIX_EXECUTABLE_NAMES = Object.freeze({
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  whisperServer: "whisper-server",
  ytDlp: "yt-dlp"
} satisfies DesktopToolExecutableNames);

const WINDOWS_EXECUTABLE_NAMES = Object.freeze({
  ffmpeg: "ffmpeg.exe",
  ffprobe: "ffprobe.exe",
  whisperServer: "whisper-server.exe",
  ytDlp: "yt-dlp.exe"
} satisfies DesktopToolExecutableNames);

const NO_ARGUMENT_PREFIX: readonly string[] = Object.freeze([] as string[]);

function requiredDesktopPlatform(value: unknown): DesktopPlatform {
  if (
    typeof value !== "string"
    || !DESKTOP_PLATFORMS.includes(value as DesktopPlatform)
  ) {
    throw new TypeError(
      "데스크톱 플랫폼은 linux, darwin, win32 중 하나여야 합니다."
    );
  }
  return value as DesktopPlatform;
}

function requiredDesktopArchitecture(value: unknown): DesktopArchitecture {
  if (
    typeof value !== "string"
    || !DESKTOP_ARCHITECTURES.includes(value as DesktopArchitecture)
  ) {
    throw new TypeError(
      "데스크톱 아키텍처는 x64 또는 arm64여야 합니다."
    );
  }
  return value as DesktopArchitecture;
}

function pathImplementation(platform: DesktopPlatform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function comparisonKey(value: string, platform: DesktopPlatform): string {
  return platform === "win32" ? value.toLowerCase() : value;
}

function rawPathSegments(value: string, platform: DesktopPlatform): string[] {
  return value
    .split(platform === "win32" ? /[\\/]+/u : /\/+/u)
    .filter(Boolean);
}

function validateWindowsSegment(segment: string, label: string): void {
  if (
    WINDOWS_INVALID_SEGMENT_CHARACTER_PATTERN.test(segment)
    || /[. ]$/u.test(segment)
    || WINDOWS_RESERVED_SEGMENT_PATTERN.test(segment)
  ) {
    throw new TypeError(`${label}에 Windows에서 안전하지 않은 경로 조각이 있습니다.`);
  }
}

/**
 * Performs target-platform lexical validation without reading the filesystem.
 * Callers that mutate an existing path must additionally lstat it and reject
 * symbolic links immediately before the mutation.
 */
export function validateDesktopAbsolutePath(
  value: unknown,
  {
    platform: platformInput,
    label = "데스크톱"
  }: {
    readonly platform: DesktopPlatform | string;
    readonly label?: string;
  }
): string {
  const platform = requiredDesktopPlatform(platformInput);
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} 경로는 앞뒤 공백이나 제어 문자가 없는 절대 경로여야 합니다.`
    );
  }
  const rawSegments = rawPathSegments(value, platform);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError(`${label} 경로에 . 또는 .. 조각을 사용할 수 없습니다.`);
  }

  const pathApi = pathImplementation(platform);
  if (platform === "win32") {
    if (
      WINDOWS_DEVICE_NAMESPACE_PATTERN.test(value)
      || (
        !WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(value)
        && !WINDOWS_UNC_ABSOLUTE_PATTERN.test(value)
      )
    ) {
      throw new TypeError(
        `${label} 경로는 로컬 드라이브 또는 완전한 UNC 절대 경로여야 합니다.`
      );
    }
  } else if (!pathApi.isAbsolute(value)) {
    throw new TypeError(`${label} 경로는 POSIX 절대 경로여야 합니다.`);
  }

  const normalized = pathApi.normalize(value);
  const parsedRoot = pathApi.parse(normalized).root;
  if (
    !parsedRoot
    || comparisonKey(normalized, platform) === comparisonKey(parsedRoot, platform)
  ) {
    throw new TypeError(`${label} 경로로 파일시스템 루트를 사용할 수 없습니다.`);
  }

  if (platform === "win32") {
    const relativeSegments = normalized
      .slice(parsedRoot.length)
      .split(/[\\/]+/u)
      .filter(Boolean);
    for (const segment of relativeSegments) {
      validateWindowsSegment(segment, label);
    }
  }
  return normalized;
}

function requiredChildSegment(
  value: unknown,
  platform: DesktopPlatform,
  label: string
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || value === "."
    || value === ".."
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes("/")
    || (platform === "win32" && value.includes("\\"))
  ) {
    throw new TypeError(`${label}은 안전한 단일 경로 조각이어야 합니다.`);
  }
  if (platform === "win32") {
    validateWindowsSegment(value, label);
  }
  return value;
}

/** Resolves constant or previously validated single segments below a root. */
export function resolveDesktopPathWithinRoot({
  platform: platformInput,
  root: rootInput,
  segments,
  label = "관리 경로"
}: {
  readonly platform: DesktopPlatform | string;
  readonly root: unknown;
  readonly segments: readonly unknown[];
  readonly label?: string;
}): string {
  const platform = requiredDesktopPlatform(platformInput);
  const root = validateDesktopAbsolutePath(rootInput, { platform, label });
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError(`${label}에는 하나 이상의 하위 경로 조각이 필요합니다.`);
  }
  const pathApi = pathImplementation(platform);
  const candidate = pathApi.join(
    root,
    ...segments.map((segment) => requiredChildSegment(segment, platform, label))
  );
  const relative = pathApi.relative(root, candidate);
  if (
    !relative
    || relative === ".."
    || relative.startsWith(`..${pathApi.sep}`)
    || pathApi.isAbsolute(relative)
  ) {
    throw new TypeError(`${label}가 관리 루트를 벗어났습니다.`);
  }
  return candidate;
}

function assertDistinctRoots(
  paths: readonly { readonly label: string; readonly value: string }[],
  platform: DesktopPlatform
): void {
  const seen = new Map<string, string>();
  for (const entry of paths) {
    const key = comparisonKey(entry.value, platform);
    const previous = seen.get(key);
    if (previous) {
      throw new TypeError(`${previous}와 ${entry.label} 루트는 서로 달라야 합니다.`);
    }
    seen.set(key, entry.label);
  }
}

export function desktopBundleTarget({
  platform: platformInput,
  arch: archInput
}: {
  readonly platform: DesktopPlatform | string;
  readonly arch: DesktopArchitecture | string;
}): DesktopBundleTarget {
  const platform = requiredDesktopPlatform(platformInput);
  const arch = requiredDesktopArchitecture(archInput);
  return `${platform}-${arch}`;
}

export function resolveDesktopRuntimePaths({
  platform: platformInput,
  arch: archInput,
  roots
}: {
  readonly platform: DesktopPlatform | string;
  readonly arch: DesktopArchitecture | string;
  readonly roots: DesktopRuntimePathInputs;
}): Readonly<DesktopRuntimePaths> {
  const platform = requiredDesktopPlatform(platformInput);
  const arch = requiredDesktopArchitecture(archInput);
  const appDataRoot = validateDesktopAbsolutePath(roots.appDataRoot, {
    platform,
    label: "앱 데이터"
  });
  const cacheRoot = validateDesktopAbsolutePath(roots.cacheRoot, {
    platform,
    label: "캐시"
  });
  const logsRoot = validateDesktopAbsolutePath(roots.logsRoot, {
    platform,
    label: "로그"
  });
  const tempRoot = validateDesktopAbsolutePath(roots.tempRoot, {
    platform,
    label: "임시 작업"
  });
  const resourcesRoot = validateDesktopAbsolutePath(roots.resourcesRoot, {
    platform,
    label: "패키지 리소스"
  });
  assertDistinctRoots([
    { label: "앱 데이터", value: appDataRoot },
    { label: "캐시", value: cacheRoot },
    { label: "로그", value: logsRoot },
    { label: "임시 작업", value: tempRoot },
    { label: "패키지 리소스", value: resourcesRoot }
  ], platform);

  return Object.freeze({
    platform,
    arch,
    bundleTarget: desktopBundleTarget({ platform, arch }),
    appDataRoot,
    cacheRoot,
    logsRoot,
    tempRoot,
    resourcesRoot,
    browserSessionRoot: resolveDesktopPathWithinRoot({
      platform,
      root: appDataRoot,
      segments: ["browser-session"],
      label: "브라우저 세션"
    }),
    captionDataRoot: resolveDesktopPathWithinRoot({
      platform,
      root: appDataRoot,
      segments: ["captions"],
      label: "자막 데이터"
    }),
    vodCacheRoot: resolveDesktopPathWithinRoot({
      platform,
      root: cacheRoot,
      segments: ["vod-fragments"],
      label: "VOD 캐시"
    }),
    jobsTempRoot: resolveDesktopPathWithinRoot({
      platform,
      root: tempRoot,
      segments: ["jobs"],
      label: "임시 작업"
    })
  });
}

/**
 * Resolves the writable roots used by the Electron application itself.
 * Production data, cache, log, and temporary state stay below the dedicated
 * user-data root. Native-smoke runs may override only the temporary root with
 * their runner-owned isolation directory.
 */
export function resolveDesktopApplicationRuntimePaths({
  platform: platformInput,
  arch: archInput,
  userDataRoot: userDataRootInput,
  resourcesRoot,
  tempRootOverride
}: {
  readonly platform: DesktopPlatform | string;
  readonly arch: DesktopArchitecture | string;
  readonly userDataRoot: unknown;
  readonly resourcesRoot: string;
  readonly tempRootOverride?: string;
}): Readonly<DesktopRuntimePaths> {
  const platform = requiredDesktopPlatform(platformInput);
  const userDataRoot = validateDesktopAbsolutePath(userDataRootInput, {
    platform,
    label: "앱 데이터"
  });
  const managedChild = (segment: string, label: string): string => (
    resolveDesktopPathWithinRoot({
      platform,
      root: userDataRoot,
      segments: [segment],
      label
    })
  );
  return resolveDesktopRuntimePaths({
    platform,
    arch: archInput,
    roots: {
      appDataRoot: userDataRoot,
      cacheRoot: managedChild("cache", "캐시"),
      logsRoot: managedChild("logs", "로그"),
      tempRoot: tempRootOverride
        ?? managedChild("runtime-temp", "임시 작업"),
      resourcesRoot
    }
  });
}

export function desktopToolExecutableNames({
  platform: platformInput,
  arch: archInput
}: {
  readonly platform: DesktopPlatform | string;
  readonly arch: DesktopArchitecture | string;
}): Readonly<DesktopToolExecutableNames> {
  const platform = requiredDesktopPlatform(platformInput);
  requiredDesktopArchitecture(archInput);
  return platform === "win32"
    ? WINDOWS_EXECUTABLE_NAMES
    : POSIX_EXECUTABLE_NAMES;
}

function commandSpecification(command: string): Readonly<DesktopToolCommand> {
  return Object.freeze({ command, argsPrefix: NO_ARGUMENT_PREFIX });
}

export function resolveDesktopBundledTools({
  platform: platformInput,
  arch: archInput,
  resourcesRoot: resourcesRootInput
}: {
  readonly platform: DesktopPlatform | string;
  readonly arch: DesktopArchitecture | string;
  readonly resourcesRoot: unknown;
}): Readonly<DesktopBundledTools> {
  const platform = requiredDesktopPlatform(platformInput);
  const arch = requiredDesktopArchitecture(archInput);
  const resourcesRoot = validateDesktopAbsolutePath(resourcesRootInput, {
    platform,
    label: "패키지 리소스"
  });
  const bundleTarget = desktopBundleTarget({ platform, arch });
  const executableNames = desktopToolExecutableNames({ platform, arch });
  const toolsRoot = resolveDesktopPathWithinRoot({
    platform,
    root: resourcesRoot,
    segments: ["desktop-tools", bundleTarget],
    label: "번들 도구"
  });
  const toolPath = (name: string): string => resolveDesktopPathWithinRoot({
    platform,
    root: toolsRoot,
    segments: [name],
    label: "번들 도구 실행 파일"
  });
  const ffmpeg = commandSpecification(toolPath(executableNames.ffmpeg));
  const ffprobe = commandSpecification(toolPath(executableNames.ffprobe));
  const whisperServer = commandSpecification(
    toolPath(executableNames.whisperServer)
  );
  const ytDlp = Object.freeze({
    command: toolPath(executableNames.ytDlp),
    argsPrefix: NO_ARGUMENT_PREFIX,
    artifactKind: "standalone" as const
  });
  return Object.freeze({
    platform,
    arch,
    bundleTarget,
    toolsRoot,
    executableNames,
    ffmpeg,
    ffprobe,
    whisperServer,
    ytDlp
  });
}
