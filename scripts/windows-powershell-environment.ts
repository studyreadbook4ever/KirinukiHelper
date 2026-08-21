import path from "node:path";

/**
 * Node can inherit PowerShell 7's module path and then launch Windows
 * PowerShell 5.1 directly, bypassing pwsh's WinPSModulePath translation. Keep
 * only the Windows PowerShell-compatible path so built-in modules cannot be
 * shadowed by incompatible PS7 copies.
 */
export function windowsPowerShellEnvironment(
  base: NodeJS.ProcessEnv,
  values: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base, ...values };
  const windowsModulePaths = new Set<string>();
  for (const [key, value] of Object.entries(environment)) {
    if (
      key.toUpperCase() === "WINPSMODULEPATH"
      && typeof value === "string"
      && value.length > 0
    ) {
      windowsModulePaths.add(value);
    }
  }
  if (windowsModulePaths.size > 1) {
    throw new Error("conflicting WinPSModulePath environment values");
  }
  for (const key of Object.keys(environment)) {
    if (
      key.toUpperCase() === "PSMODULEPATH"
      || key.toUpperCase() === "WINPSMODULEPATH"
    ) {
      delete environment[key];
    }
  }
  const [windowsModulePath] = windowsModulePaths;
  if (windowsModulePath) {
    environment.PSModulePath = windowsModulePath;
    environment.WinPSModulePath = windowsModulePath;
  }
  return environment;
}

/**
 * Never let Windows resolve a release-verification PowerShell command through
 * the current working directory. Resolve the OS-owned Windows PowerShell 5.1
 * executable from the case-insensitive SystemRoot environment instead.
 */
export function windowsPowerShellExecutable(
  base: NodeJS.ProcessEnv
): string {
  const systemRoots = new Set<string>();
  for (const [key, value] of Object.entries(base)) {
    if (
      key.toUpperCase() === "SYSTEMROOT"
      && typeof value === "string"
      && value.trim().length > 0
    ) {
      systemRoots.add(value);
    }
  }
  if (systemRoots.size !== 1) {
    throw new Error("Windows SystemRoot environment is missing or conflicting");
  }
  const [systemRoot] = systemRoots;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot) || systemRoot.includes("\0")) {
    throw new Error("Windows SystemRoot environment is not an absolute path");
  }
  return path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}
