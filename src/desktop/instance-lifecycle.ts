import type { DesktopBundleTarget } from "./runtime-spec.js";
import { desktopBundleTarget } from "./runtime-spec.js";
import { isLocalMediaEngineVersion } from "../lib/local-media-engine-contract.js";
import {
  exactBase64UrlBytes
} from "../lib/local-media-engine-auth.js";
import type {
  LocalMediaEnginePairingRequest
} from "../lib/local-media-engine-auth.js";

export const ENGINE_INSTANCE_SCHEMA =
  "kirinuki-local-engine-instance/v1" as const;
export const ENGINE_OWNED_UNINSTALL_ARGUMENT =
  "--kirinuki-internal-owned-uninstall" as const;

export interface EngineInstanceIdentity {
  readonly schema: typeof ENGINE_INSTANCE_SCHEMA;
  readonly command: "activate" | "cleanup-owned-installation";
  readonly target: DesktopBundleTarget;
  readonly version: string;
  readonly pairingRequest?: Readonly<LocalMediaEnginePairingRequest>;
}

export type EngineInstanceHandoffDecision =
  | "ignore-invalid"
  | "keep-current"
  | "cleanup-owned-installation"
  | "relaunch-newer-installed-version";

function exactIdentity(value: unknown): Readonly<EngineInstanceIdentity> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pairingRequest = exactPairingRequest(record.pairingRequest);
  const expectedKeys = record.pairingRequest === undefined
    ? "command,schema,target,version"
    : "command,pairingRequest,schema,target,version";
  if (
    Object.keys(record).sort().join(",") !== expectedKeys
    || record.schema !== ENGINE_INSTANCE_SCHEMA
    || !["activate", "cleanup-owned-installation"].includes(String(record.command))
    || !isLocalMediaEngineVersion(record.version)
    || !["linux-x64", "darwin-arm64", "win32-x64"].includes(
      String(record.target)
    )
    || (record.pairingRequest !== undefined && pairingRequest === null)
    || (record.command === "cleanup-owned-installation" && pairingRequest !== null)
  ) {
    return null;
  }
  return Object.freeze({
    schema: ENGINE_INSTANCE_SCHEMA,
    command: record.command as EngineInstanceIdentity["command"],
    target: record.target as DesktopBundleTarget,
    version: record.version,
    ...(pairingRequest ? { pairingRequest } : {})
  });
}

function exactPairingRequest(
  value: unknown
): Readonly<LocalMediaEnginePairingRequest> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "challenge,state"
    || !exactBase64UrlBytes(record.state, 32)
    || !exactBase64UrlBytes(record.challenge, 32)
  ) {
    return null;
  }
  return Object.freeze({
    state: record.state,
    challenge: record.challenge
  });
}

function numericRelease(version: string): readonly [number, number, number] {
  const [release = ""] = version.split("-", 1);
  const parts = release.split(".").map(Number);
  if (
    parts.length !== 3
    || parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    throw new TypeError("로컬 엔진 release version이 올바르지 않습니다.");
  }
  return Object.freeze(parts as [number, number, number]);
}

function compareReleaseVersions(left: string, right: string): number {
  const leftRelease = numericRelease(left);
  const rightRelease = numericRelease(right);
  for (let index = 0; index < leftRelease.length; index += 1) {
    const difference = leftRelease[index]! - rightRelease[index]!;
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  // A stable release supersedes its prerelease with the same numeric tuple.
  const leftPrerelease = left.includes("-");
  const rightPrerelease = right.includes("-");
  if (leftPrerelease !== rightPrerelease) {
    return leftPrerelease ? -1 : 1;
  }
  return left.localeCompare(right, "en");
}

export function engineInstanceIdentity({
  platform,
  arch,
  version,
  pairingRequest,
  cleanupOwnedInstallation = false
}: {
  readonly platform: string;
  readonly arch: string;
  readonly version: string;
  readonly pairingRequest?: Readonly<LocalMediaEnginePairingRequest>;
  readonly cleanupOwnedInstallation?: boolean;
}): Readonly<EngineInstanceIdentity> {
  if (!isLocalMediaEngineVersion(version)) {
    throw new TypeError("로컬 엔진 release version identity가 올바르지 않습니다.");
  }
  const target = desktopBundleTarget({ platform, arch });
  if (!["linux-x64", "darwin-arm64", "win32-x64"].includes(target)) {
    throw new TypeError(`지원하지 않는 로컬 엔진 target입니다: ${target}`);
  }
  if (pairingRequest !== undefined && exactPairingRequest(pairingRequest) === null) {
    throw new TypeError("로컬 엔진 pairing request가 올바르지 않습니다.");
  }
  if (cleanupOwnedInstallation && pairingRequest !== undefined) {
    throw new TypeError("설치 정리 요청에는 pairing payload를 함께 보낼 수 없습니다.");
  }
  return Object.freeze({
    schema: ENGINE_INSTANCE_SCHEMA,
    command: cleanupOwnedInstallation
      ? "cleanup-owned-installation"
      : "activate",
    target,
    version,
    ...(pairingRequest === undefined ? {} : { pairingRequest })
  });
}

export function exactOwnedUninstallRequestFromArgv(
  argv: readonly unknown[]
): boolean {
  const occurrences = argv.filter(
    (argument) => argument === ENGINE_OWNED_UNINSTALL_ARGUMENT
  ).length;
  if (occurrences === 0) {
    return false;
  }
  if (occurrences !== 1 || argv.some((argument) => (
    typeof argument === "string"
      && argument.startsWith("--kirinuki-internal-owned-uninstall=")
  ))) {
    throw new TypeError("Kirinuki owned uninstall 요청이 exact하지 않습니다.");
  }
  return true;
}

export function engineInstancePairingRequest(
  value: unknown
): Readonly<LocalMediaEnginePairingRequest> | null {
  return exactIdentity(value)?.pairingRequest ?? null;
}

export function decideEngineInstanceHandoff({
  current,
  incoming
}: {
  readonly current: Readonly<EngineInstanceIdentity>;
  readonly incoming: unknown;
}): EngineInstanceHandoffDecision {
  const parsedCurrent = exactIdentity(current);
  const parsedIncoming = exactIdentity(incoming);
  if (!parsedCurrent || !parsedIncoming || parsedCurrent.target !== parsedIncoming.target) {
    return "ignore-invalid";
  }
  if (parsedIncoming.command === "cleanup-owned-installation") {
    return parsedCurrent.command === "activate"
      && parsedIncoming.version === parsedCurrent.version
      ? "cleanup-owned-installation"
      : "ignore-invalid";
  }
  if (parsedCurrent.command !== "activate") {
    return "ignore-invalid";
  }
  return compareReleaseVersions(parsedIncoming.version, parsedCurrent.version) > 0
    ? "relaunch-newer-installed-version"
    : "keep-current";
}
