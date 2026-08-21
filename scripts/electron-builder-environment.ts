/**
 * Keep electron-builder's child environment deterministic. A runner-level
 * DEBUG namespace enables builder-debug.yml, which is diagnostic output rather
 * than a distributable installer artifact. Remove every inherited casing and
 * then pass one explicit deny-all namespace because Windows environment names
 * are case-insensitive and an omitted/empty value can be reintroduced by a
 * parent runner before debug is initialized.
 */
export function electronBuilderEnvironment(
  base: NodeJS.ProcessEnv,
  identityAutoDiscovery: boolean
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(environment)) {
    const normalized = key.toUpperCase();
    if (normalized === "DEBUG" || normalized === "CSC_IDENTITY_AUTO_DISCOVERY") {
      delete environment[key];
    }
  }
  environment.DEBUG = "-*";
  environment.CSC_IDENTITY_AUTO_DISCOVERY = identityAutoDiscovery
    ? "true"
    : "false";
  return environment;
}
