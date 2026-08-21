/**
 * Keep electron-builder's child environment deterministic. A runner-level
 * DEBUG namespace enables builder-debug.yml, which is diagnostic output rather
 * than a distributable installer artifact. Remove every casing because
 * Windows environment names are case-insensitive.
 */
export function electronBuilderEnvironment(
  base: NodeJS.ProcessEnv,
  identityAutoDiscovery: boolean
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(environment)) {
    const normalized = key.toUpperCase();
    if (
      normalized === "DEBUG"
      || normalized === "CSC_IDENTITY_AUTO_DISCOVERY"
    ) {
      delete environment[key];
    }
  }
  environment.CSC_IDENTITY_AUTO_DISCOVERY = identityAutoDiscovery
    ? "true"
    : "false";
  return environment;
}
