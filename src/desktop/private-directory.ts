import {
  chmodSync,
  lstatSync,
  mkdirSync,
  realpathSync
} from "node:fs";
import path from "node:path";

import type { DesktopPlatform } from "./runtime-spec.js";

export interface PrivateDirectoryTarget {
  readonly path: string;
  readonly label: string;
  /** Another target in the same batch that must canonically contain this one. */
  readonly containedBy?: string;
}

export interface PrivateDirectoryMetadata {
  readonly mode: number;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface PrivateDirectoryFileSystem {
  readonly chmod: (targetPath: string, mode: number) => void;
  readonly lstat: (targetPath: string) => PrivateDirectoryMetadata;
  readonly mkdir: (
    targetPath: string,
    options: Readonly<{ recursive: true; mode: number }>
  ) => unknown;
  readonly realpath: (targetPath: string) => string;
}

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_DIRECTORY_PERMISSION_MASK = 0o7777;

const nodeFileSystem = Object.freeze({
  chmod: chmodSync,
  lstat: lstatSync,
  mkdir: mkdirSync,
  realpath: (targetPath: string) => realpathSync.native(targetPath)
}) satisfies PrivateDirectoryFileSystem;

function isMissingPath(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

function assertRealDirectory(
  target: Readonly<PrivateDirectoryTarget>,
  metadata: Readonly<PrivateDirectoryMetadata>
): void {
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(
      `${target.label} 경로가 실제 디렉터리가 아니거나 심볼릭 링크/junction입니다.`
    );
  }
}

function pathImplementation(platform: DesktopPlatform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function pathKey(value: string, platform: DesktopPlatform): string {
  const normalized = pathImplementation(platform).normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathWithin(
  candidate: string,
  parent: string,
  platform: DesktopPlatform,
  allowEqual: boolean
): boolean {
  const pathApi = pathImplementation(platform);
  const relative = pathApi.relative(parent, candidate);
  if (relative.length === 0) {
    return allowEqual;
  }
  return relative !== ".."
    && !relative.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relative);
}

function assertCanonicalContainment(
  target: Readonly<PrivateDirectoryTarget>,
  parent: Readonly<PrivateDirectoryTarget>,
  fileSystem: Readonly<PrivateDirectoryFileSystem>,
  platform: DesktopPlatform
): void {
  const canonicalParent = fileSystem.realpath(parent.path);
  const canonicalTarget = fileSystem.realpath(target.path);
  if (!isPathWithin(canonicalTarget, canonicalParent, platform, false)) {
    throw new Error(`${target.label} 경로가 의도한 ${parent.label} 경계를 벗어났습니다.`);
  }
}

function nearestExistingCanonicalAncestor(
  targetPath: string,
  fileSystem: Readonly<PrivateDirectoryFileSystem>,
  platform: DesktopPlatform
): string {
  const pathApi = pathImplementation(platform);
  let candidate = pathApi.dirname(targetPath);
  while (true) {
    try {
      return fileSystem.realpath(candidate);
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }
    const parent = pathApi.dirname(candidate);
    if (parent === candidate) {
      throw new Error("private 디렉터리의 기존 상위 경로를 확인하지 못했습니다.");
    }
    candidate = parent;
  }
}

function assertMissingTargetAncestorContainment(
  target: Readonly<PrivateDirectoryTarget>,
  parent: Readonly<PrivateDirectoryTarget>,
  fileSystem: Readonly<PrivateDirectoryFileSystem>,
  platform: DesktopPlatform
): void {
  const canonicalParent = fileSystem.realpath(parent.path);
  const canonicalAncestor = nearestExistingCanonicalAncestor(
    target.path,
    fileSystem,
    platform
  );
  if (!isPathWithin(canonicalAncestor, canonicalParent, platform, true)) {
    throw new Error(`${target.label} 경로의 상위 디렉터리가 ${parent.label} 경계를 벗어났습니다.`);
  }
}

function existingMetadata(
  target: Readonly<PrivateDirectoryTarget>,
  fileSystem: Readonly<PrivateDirectoryFileSystem>
): Readonly<PrivateDirectoryMetadata> | null {
  try {
    return fileSystem.lstat(target.path);
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Preflights every existing final path before mutating any of them, then
 * creates and revalidates each private application directory. Deliberately
 * validates the managed final paths rather than expanding policy to all
 * operating-system-owned ancestors.
 */
export function preparePrivateDirectories(
  targets: readonly Readonly<PrivateDirectoryTarget>[],
  {
    platform,
    fileSystem = nodeFileSystem
  }: {
    readonly platform: DesktopPlatform;
    readonly fileSystem?: Readonly<PrivateDirectoryFileSystem>;
  }
): void {
  if (targets.length === 0) {
    throw new TypeError("하나 이상의 private 디렉터리 경로가 필요합니다.");
  }
  const targetsByPath = new Map<string, Readonly<PrivateDirectoryTarget>>();
  const existingPaths = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      typeof target.path !== "string"
      || target.path.length === 0
      || target.path.trim() !== target.path
      || /[\u0000-\u001f\u007f]/u.test(target.path)
      || typeof target.label !== "string"
      || target.label.trim().length === 0
    ) {
      throw new TypeError("private 디렉터리 경로와 이름이 올바르지 않습니다.");
    }
    const targetKey = pathKey(target.path, platform);
    if (targetsByPath.has(targetKey)) {
      throw new TypeError("private 디렉터리 경로가 중복되었습니다.");
    }
    targetsByPath.set(targetKey, target);
    if (target.containedBy !== undefined) {
      const parentKey = pathKey(target.containedBy, platform);
      const parent = targetsByPath.get(parentKey);
      if (!parent || parent === target || index === 0) {
        throw new TypeError(
          `${target.label}의 포함 경로는 같은 배치에서 먼저 선언되어야 합니다.`
        );
      }
      if (!isPathWithin(target.path, parent.path, platform, false)) {
        throw new TypeError(`${target.label} 경로가 지정된 관리 경로 아래에 있지 않습니다.`);
      }
    }
    const metadata = existingMetadata(target, fileSystem);
    if (metadata) {
      assertRealDirectory(target, metadata);
      existingPaths.add(targetKey);
    }
  }

  // Canonicalize every already-existing managed endpoint before the first
  // mkdir/chmod. For a missing endpoint, resolve its nearest existing
  // ancestor when its intended parent already exists; this catches an
  // intermediate symlink escape without rejecting benign OS ancestors.
  for (const target of targets) {
    if (target.containedBy === undefined) {
      continue;
    }
    const targetKey = pathKey(target.path, platform);
    const parentKey = pathKey(target.containedBy, platform);
    const parent = targetsByPath.get(parentKey)!;
    if (existingPaths.has(targetKey)) {
      assertCanonicalContainment(target, parent, fileSystem, platform);
    } else if (existingPaths.has(parentKey)) {
      assertMissingTargetAncestorContainment(
        target,
        parent,
        fileSystem,
        platform
      );
    }
  }

  for (const target of targets) {
    if (target.containedBy !== undefined) {
      const parent = targetsByPath.get(pathKey(target.containedBy, platform))!;
      if (!existingPaths.has(pathKey(target.path, platform))) {
        assertMissingTargetAncestorContainment(
          target,
          parent,
          fileSystem,
          platform
        );
      }
    }
    fileSystem.mkdir(target.path, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE
    });
    assertRealDirectory(target, fileSystem.lstat(target.path));
    if (platform === "win32") {
      if (target.containedBy !== undefined) {
        assertCanonicalContainment(
          target,
          targetsByPath.get(pathKey(target.containedBy, platform))!,
          fileSystem,
          platform
        );
      }
      continue;
    }
    fileSystem.chmod(target.path, PRIVATE_DIRECTORY_MODE);
    const secured = fileSystem.lstat(target.path);
    assertRealDirectory(target, secured);
    if (
      (secured.mode & PRIVATE_DIRECTORY_PERMISSION_MASK)
      !== PRIVATE_DIRECTORY_MODE
    ) {
      throw new Error(`${target.label} 경로의 POSIX 권한을 0700으로 제한하지 못했습니다.`);
    }
    if (target.containedBy !== undefined) {
      assertCanonicalContainment(
        target,
        targetsByPath.get(pathKey(target.containedBy, platform))!,
        fileSystem,
        platform
      );
    }
  }
}
