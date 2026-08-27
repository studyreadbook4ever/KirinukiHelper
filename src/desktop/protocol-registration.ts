import { execFile } from "node:child_process";
import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DesktopProtocolClientApplication {
  readonly isDefaultProtocolClient: (scheme: string) => boolean;
  readonly setAsDefaultProtocolClient: (scheme: string) => boolean;
  readonly removeAsDefaultProtocolClient?: (scheme: string) => boolean;
}

export type DesktopProtocolRegistrationResult =
  | "already-registered"
  | "registered"
  | "skipped-isolated-smoke";

export type DesktopProtocolRemovalResult =
  | "already-absent"
  | "removed"
  | "skipped-isolated-smoke";

export const KIRINUKI_LINUX_DESKTOP_ID =
  "kr.eff0rtchung.kirinuki.desktop" as const;
export const KIRINUKI_LINUX_DESKTOP_EXEC =
  "/opt/Kirinuki/Kirinuki %U" as const;
export const KIRINUKI_LINUX_PROTOCOL_MIME =
  "x-scheme-handler/kirinuki-engine" as const;
export const KIRINUKI_OWNED_LEGACY_DESKTOP_IDS = Object.freeze([
  "Kirinuki.desktop",
  "kirinuki-app.desktop"
] as const);

export type LinuxProtocolAssociationResult =
  | "already-registered"
  | "registered"
  | "migrated-owned-legacy";

export class LinuxProtocolAssociationError extends Error {
  readonly code: "CURRENT_ENTRY_INVALID" | "FOREIGN_HANDLER" | "READBACK_FAILED";

  constructor(
    message: string,
    code: "CURRENT_ENTRY_INVALID" | "FOREIGN_HANDLER" | "READBACK_FAILED"
  ) {
    super(message);
    this.name = "LinuxProtocolAssociationError";
    this.code = code;
  }
}

export interface LinuxDesktopEntryInspection {
  readonly content: string;
  readonly executableExists: boolean;
  readonly regularFile: boolean;
}

function desktopEntryValue(content: string, key: string): string | null {
  const matches = content.match(new RegExp(`^${key}=([^\\r\\n]*)$`, "gmu")) || [];
  return matches.length === 1 ? matches[0]!.slice(key.length + 1) : null;
}

function currentDesktopEntryIsExact(entry: Readonly<LinuxDesktopEntryInspection>): boolean {
  return entry.regularFile
    && desktopEntryValue(entry.content, "Type") === "Application"
    && desktopEntryValue(entry.content, "Name") === "Kirinuki"
    && desktopEntryValue(entry.content, "Exec") === KIRINUKI_LINUX_DESKTOP_EXEC
    && String(desktopEntryValue(entry.content, "MimeType") || "")
      .split(";")
      .filter(Boolean)
      .includes(KIRINUKI_LINUX_PROTOCOL_MIME);
}

function legacyDesktopEntryIsOwned(
  desktopId: string,
  entry: Readonly<LinuxDesktopEntryInspection>
): boolean {
  if (
    !KIRINUKI_OWNED_LEGACY_DESKTOP_IDS.includes(
      desktopId as typeof KIRINUKI_OWNED_LEGACY_DESKTOP_IDS[number]
    )
    || !entry.regularFile
    || entry.executableExists
    || desktopEntryValue(entry.content, "Type") !== "Application"
    || desktopEntryValue(entry.content, "Name") !== "Kirinuki"
    || !String(desktopEntryValue(entry.content, "MimeType") || "")
      .split(";")
      .filter(Boolean)
      .includes(KIRINUKI_LINUX_PROTOCOL_MIME)
  ) {
    return false;
  }
  const command = desktopEntryValue(entry.content, "Exec") || "";
  return /^(?:"[^"\r\n]+"|\/[^\r\n ]+) %U$/u.test(command);
}

export async function reconcileLinuxProtocolAssociation({
  queryDefault,
  setDefault,
  inspect
}: {
  readonly queryDefault: () => Promise<string>;
  readonly setDefault: (desktopId: string) => Promise<void>;
  readonly inspect: (desktopId: string) => Promise<LinuxDesktopEntryInspection | null>;
}): Promise<LinuxProtocolAssociationResult> {
  const currentEntry = await inspect(KIRINUKI_LINUX_DESKTOP_ID);
  if (!currentEntry || !currentDesktopEntryIsExact(currentEntry)) {
    throw new LinuxProtocolAssociationError(
      "설치된 Kirinuki desktop entry의 실행 계약을 확인하지 못했습니다.",
      "CURRENT_ENTRY_INVALID"
    );
  }
  const selected = String(await queryDefault()).trim();
  if (selected === KIRINUKI_LINUX_DESKTOP_ID) {
    return "already-registered";
  }
  let result: LinuxProtocolAssociationResult = "registered";
  if (selected) {
    const legacyEntry = await inspect(selected);
    if (!legacyEntry || !legacyDesktopEntryIsOwned(selected, legacyEntry)) {
      throw new LinuxProtocolAssociationError(
        "다른 프로그램이 Kirinuki 연결 주소를 사용하고 있어 자동으로 바꾸지 않았습니다.",
        "FOREIGN_HANDLER"
      );
    }
    result = "migrated-owned-legacy";
  }
  await setDefault(KIRINUKI_LINUX_DESKTOP_ID);
  if (String(await queryDefault()).trim() !== KIRINUKI_LINUX_DESKTOP_ID) {
    throw new LinuxProtocolAssociationError(
      "Kirinuki 연결 주소 복구를 운영체제에서 확인하지 못했습니다.",
      "READBACK_FAILED"
    );
  }
  return result;
}

function xdgDataRoots(environment: Readonly<NodeJS.ProcessEnv>): readonly string[] {
  const home = String(environment.HOME || "");
  const userRoot = String(environment.XDG_DATA_HOME || "")
    || (path.isAbsolute(home) ? path.join(home, ".local", "share") : "");
  const systemRoots = String(environment.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(":");
  return [userRoot, ...systemRoots].filter((root) => path.isAbsolute(root));
}

function desktopExecutable(content: string): string | null {
  const command = desktopEntryValue(content, "Exec") || "";
  const match = /^(?:"([^"\r\n]+)"|(\/[^\r\n ]+)) %U$/u.exec(command);
  return match?.[1] || match?.[2] || null;
}

export async function ensureLinuxProtocolAssociation({
  environment = process.env,
  runXdgMime = async (args: readonly string[]) => {
    const result = await execFileAsync("xdg-mime", [...args], {
      env: { ...environment },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024
    });
    return String(result.stdout || "");
  }
}: {
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly runXdgMime?: (args: readonly string[]) => Promise<string>;
} = {}): Promise<LinuxProtocolAssociationResult> {
  const roots = xdgDataRoots(environment);
  const inspect = async (desktopId: string): Promise<LinuxDesktopEntryInspection | null> => {
    if (!/^[A-Za-z0-9._-]{1,128}\.desktop$/u.test(desktopId)) {
      return null;
    }
    for (const root of roots) {
      const candidate = path.join(root, "applications", desktopId);
      try {
        const stat = await lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          return { content: "", executableExists: false, regularFile: false };
        }
        const content = await readFile(candidate, "utf8");
        const executable = desktopExecutable(content);
        let executableExists = false;
        if (executable) {
          try {
            await access(executable);
            executableExists = true;
          } catch {
            executableExists = false;
          }
        }
        return { content, executableExists, regularFile: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    return null;
  };
  return reconcileLinuxProtocolAssociation({
    queryDefault: () => runXdgMime([
      "query",
      "default",
      KIRINUKI_LINUX_PROTOCOL_MIME
    ]),
    setDefault: async (desktopId) => {
      await runXdgMime([
        "default",
        desktopId,
        KIRINUKI_LINUX_PROTOCOL_MIME
      ]);
    },
    inspect
  });
}

function safeScheme(value: string): string {
  if (!/^[a-z][a-z0-9+.-]{1,63}$/u.test(value)) {
    throw new TypeError("desktop custom protocol scheme이 올바르지 않습니다.");
  }
  return value;
}

/** Removes only the exact scheme currently owned by this Electron app. */
export function removeDesktopProtocolRegistration({
  application,
  scheme,
  isolatedSmoke
}: {
  readonly application: Readonly<DesktopProtocolClientApplication>;
  readonly scheme: string;
  readonly isolatedSmoke: boolean;
}): DesktopProtocolRemovalResult {
  const verifiedScheme = safeScheme(scheme);
  if (isolatedSmoke) {
    return "skipped-isolated-smoke";
  }
  if (!application.isDefaultProtocolClient(verifiedScheme)) {
    return "already-absent";
  }
  if (
    typeof application.removeAsDefaultProtocolClient !== "function"
    || !application.removeAsDefaultProtocolClient(verifiedScheme)
  ) {
    throw new Error("Kirinuki 엔진 연결 프로토콜을 운영체제에서 제거하지 못했습니다.");
  }
  if (application.isDefaultProtocolClient(verifiedScheme)) {
    throw new Error("Kirinuki 엔진 연결 프로토콜 제거를 운영체제에서 확인하지 못했습니다.");
  }
  return "removed";
}

/**
 * Makes protocol setup idempotent: an existing registration is preserved,
 * a missing registration is attempted once, and success is accepted only
 * after an independent OS readback.
 */
export function ensureDesktopProtocolRegistration({
  application,
  scheme,
  isolatedSmoke
}: {
  readonly application: Readonly<DesktopProtocolClientApplication>;
  readonly scheme: string;
  readonly isolatedSmoke: boolean;
}): DesktopProtocolRegistrationResult {
  const verifiedScheme = safeScheme(scheme);
  if (isolatedSmoke) {
    return "skipped-isolated-smoke";
  }
  if (application.isDefaultProtocolClient(verifiedScheme)) {
    return "already-registered";
  }
  if (!application.setAsDefaultProtocolClient(verifiedScheme)) {
    throw new Error("Kirinuki 엔진 연결 프로토콜을 운영체제에 등록하지 못했습니다.");
  }
  if (!application.isDefaultProtocolClient(verifiedScheme)) {
    throw new Error("Kirinuki 엔진 연결 프로토콜 등록을 운영체제에서 확인하지 못했습니다.");
  }
  return "registered";
}
