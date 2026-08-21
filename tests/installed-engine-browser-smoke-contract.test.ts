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
  assert.match(source, /fetch\("\/probe-event"/u);
  assert.match(source, /credentials:\s*"omit"/u);
  assert.match(source, /AbortSignal\.timeout\(5_000\)/u);
  assert.match(source, /kirinuki-browser-probe-nonce/u);
  const resultReport = source.indexOf(
    'await reportProbeEvent({ kind: "result", result });'
  );
  const selfReload = source.indexOf("location.reload();");
  assert.ok(resultReport >= 0 && selfReload > resultReport);
  assert.doesNotMatch(source, /mock|fixture|localStorage/iu);
});

test("installed-browser runner는 public origin·LNA·pair-once·reload를 exact 검증한다", async () => {
  const source = await readFile(
    path.join(root, "scripts/installed-engine-browser-smoke.ts"),
    "utf8"
  );
  assert.match(source, /KIRINUKI_PUBLIC_STUDIO_ORIGIN/u);
  assert.match(source, /--host-resolver-rules=MAP/u);
  assert.match(source, /pageLoadStrategy:\s*"none"/u);
  assert.match(source, /Browser\.setPermission/u);
  assert.match(source, /local-network-access/u);
  assert.match(source, /loopback-network/u);
  assert.match(source, /launchPairingUrl\(exactPairingUrl/u);
  assert.match(source, /randomBytes\(32\)\.toString\("base64url"\)/u);
  assert.match(source, /ChromeDriver initial browser tab/u);
  assert.match(source, /cmd:\s*"Page\.stopLoading"/u);
  assert.match(source, /cmd:\s*"Page\.navigate"/u);
  assert.match(source, /navigationAttempt < 2/u);
  assert.match(source, /navigation\.loaderId === undefined \|\| validLoaderId/u);
  assert.match(source, /navigation\.errorText === "net::ERR_ABORTED"/u);
  assert.match(source, /probeEvents\.length > 0 \|\| observedPaths\.length > 0/u);
  assert.match(source, /retryWindow === probeWindow/u);
  assert.match(source, /navigationOutcomePromise/u);
  assert.match(source, /Chrome navigation과 실제 browser pairing request가 모두 실패했습니다/u);
  assert.match(source, /nonce-bound HTTPS event is stronger proof/u);
  assert.match(source, /params:\s*\{ url: `\$\{KIRINUKI_PUBLIC_STUDIO_ORIGIN\}\/` \}/u);
  assert.match(source, /connect-src 'self' http:\/\/127\.0\.0\.1:4319/u);
  assert.match(source, /request\.headers\.origin === KIRINUKI_PUBLIC_STUDIO_ORIGIN/u);
  assert.match(source, /bytes <= 8 \* 1024/u);
  assert.match(source, /probeEventCursor === 3 && probeEvents\.length === 3/u);
  assert.match(source, /entry === "\/probe-event"\)\.length === 3/u);
  assert.doesNotMatch(source, /execute\/sync/u);
  assert.doesNotMatch(source, /cmd:\s*"Target\.createTarget"/u);
  assert.doesNotMatch(source, /\/window\/new/u);
  assert.doesNotMatch(source, /\/session\/\$\{sessionId\}\/url/u);
  assert.doesNotMatch(source, /\/session\/\$\{sessionId\}\/refresh/u);
  assert.match(source, /assertProbeResult\(second\.result, "reconnected", keyId\)/u);
  assert.match(source, /assertProbeResult\(first\.result, "paired"\)/u);
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
