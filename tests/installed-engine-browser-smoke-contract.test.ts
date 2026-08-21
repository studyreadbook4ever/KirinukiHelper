import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("installed-browser probe는 실제 onboarding/trust/session code를 두 load에 사용한다", async () => {
  const source = await readFile(
    path.join(root, "scripts/installed-engine-browser-probe-client.ts"),
    "utf8"
  );
  assert.match(source, /pairLocalMediaEngine/u);
  assert.match(source, /createLocalMediaEngineTrustStore\(indexedDB\)/u);
  assert.match(source, /pairCaptionAgent/u);
  assert.match(source, /sourceUrl:\s*SOURCE_URL/u);
  assert.match(source, /existing \? "reconnected" : "paired"/u);
  assert.match(source, /sessionRenewed/u);
  assert.doesNotMatch(source, /mock|fixture|localStorage/iu);
});

test("installed-browser runner는 public origin·LNA·pair-once·reload를 exact 검증한다", async () => {
  const source = await readFile(
    path.join(root, "scripts/installed-engine-browser-smoke.ts"),
    "utf8"
  );
  assert.match(source, /KIRINUKI_PUBLIC_STUDIO_ORIGIN/u);
  assert.match(source, /--host-resolver-rules=MAP/u);
  assert.match(source, /Browser\.setPermission/u);
  assert.match(source, /local-network-access/u);
  assert.match(source, /loopback-network/u);
  assert.match(source, /launchPairingUrl\(exactPairingUrl/u);
  assert.match(source, /\/session\/\$\{sessionId\}\/refresh/u);
  assert.match(source, /assertProbeResult\(second\.result, "reconnected", keyId\)/u);
  assert.match(source, /second\.pairingUrl === ""/u);
  assert.match(source, /sessionCapabilityBytes === 43/u);
  assert.match(source, /result\.sessionRenewed === \(phase === "reconnected"\)/u);
});

test("installer smoke와 native matrix는 세 OS의 installed browser proof를 opt-in 실행한다", async () => {
  const [installerSmoke, packageSmoke, workflow] = await Promise.all([
    readFile(path.join(root, "scripts/desktop-installer-smoke.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-package-smoke.ts"), "utf8"),
    readFile(path.join(root, ".github/workflows/typescript-quality.yml"), "utf8")
  ]);
  assert.match(installerSmoke, /KIRINUKI_INSTALLED_BROWSER_SMOKE/u);
  assert.equal(
    (installerSmoke.match(/browserSmoke:\s*runInstalledEngineBrowserSmoke/gu) || []).length,
    3
  );
  assert.match(packageSmoke, /browserPairingLaunches === 1/u);
  assert.match(packageSmoke, /DESKTOP_NATIVE_SMOKE_ARGUMENT,\s*url/u);
  assert.match(packageSmoke, /parseLocalMediaEnginePairingRequest/u);
  assert.match(workflow, /browser-actions\/setup-chrome@2e1d749697dd1612b833dba4a722266286fbefcd/u);
  assert.match(workflow, /CHROMIUM_BINARY:/u);
  assert.match(workflow, /CHROMEDRIVER_BINARY:/u);
  assert.equal(
    (workflow.match(/KIRINUKI_INSTALLED_BROWSER_SMOKE:\s*"1"/gu) || []).length,
    2
  );
});
