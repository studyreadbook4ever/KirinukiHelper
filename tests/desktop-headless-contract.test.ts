import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("installed desktop main은 window·4320 Studio·extension product UX를 갖지 않는다", async () => {
  const [main, supervisor, packageFiles, packageScript] = await Promise.all([
    readFile(path.join(root, "src/desktop/main.ts"), "utf8"),
    readFile(path.join(root, "src/desktop/runtime-supervisor.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-package-files.ts"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop.ts"), "utf8")
  ]);
  for (const source of [main, supervisor, packageFiles, packageScript]) {
    assert.doesNotMatch(source, /BrowserWindow|window-all-closed/u);
    assert.doesNotMatch(source, /streaming-companion|Player Bridge/u);
  }
  assert.doesNotMatch(supervisor, /4320|createLocalStudioHttpServer/u);
  assert.match(supervisor, /DEFAULT_CAPTION_GATEWAY_PORT/u);
  assert.match(supervisor, /KIRINUKI_PUBLIC_STUDIO_ORIGIN/u);
  assert.match(main, /requestSingleInstanceLock/u);
  assert.match(main, /decideEngineInstanceHandoff/u);
  assert.match(main, /relaunch-newer-installed-version/u);
  assert.match(main, /app\.relaunch/u);
  assert.match(main, /ensureEngineAutostart/u);
  assert.match(main, /SIGINT/u);
  assert.match(main, /SIGTERM/u);
});

test("installer config는 unsigned CI와 signed public-release·managed uninstall을 분리한다", async () => {
  const [
    ciConfig,
    releaseConfig,
    packageManifest,
    packageScript,
    installerSmoke,
    nsisInclude
  ] = await Promise.all([
    readFile(path.join(root, "electron-builder.yml"), "utf8"),
    readFile(path.join(root, "electron-builder.release.yml"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop-installer.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-installer-smoke.ts"), "utf8"),
    readFile(path.join(root, "build/installer.nsh"), "utf8")
  ]);
  for (const fileName of [
    "Kirinuki-Engine-windows-x64-setup.exe",
    "Kirinuki-Engine-macos-arm64.dmg",
    "Kirinuki-Engine-linux-x64.deb"
  ]) {
    assert.equal(
      releaseConfig.includes(`QUARANTINED-NOT-FOR-PUBLISH-${fileName}`),
      true
    );
    assert.doesNotMatch(
      releaseConfig,
      new RegExp(`artifactName:\\s*${fileName.replaceAll(".", "\\.")}$`, "mu")
    );
    assert.equal(ciConfig.includes(`UNSIGNED-TEST-ONLY-${fileName}`), true);
  }
  assert.match(ciConfig, /forceCodeSigning:\s*false/u);
  assert.match(ciConfig, /identity:\s*null/u);
  assert.match(ciConfig, /signAndEditExecutable:\s*true/u);
  assert.match(ciConfig, /signExecutable:\s*false/u);
  assert.match(releaseConfig, /forceCodeSigning:\s*true/u);
  assert.match(releaseConfig, /identity:\s*"\$\{env\.CSC_NAME\}"/u);
  assert.match(releaseConfig, /hardenedRuntime:\s*true/u);
  assert.match(releaseConfig, /signAndEditExecutable:\s*true/u);
  assert.match(releaseConfig, /rfc3161TimeStampServer:/u);
  for (const config of [ciConfig, releaseConfig]) {
    assert.match(config, /include:\s*build\/installer\.nsh/u);
    assert.match(config, /LSUIElement:\s*true/u);
    assert.match(config, /createStartMenuShortcut:\s*true/u);
    assert.match(config, /deleteAppDataOnUninstall:\s*false/u);
  }
  assert.match(packageManifest, /"electron-builder": "26\.15\.3"/u);
  assert.match(packageManifest, /"@electron\/osx-sign": "2\.6\.0"/u);
  assert.match(packageManifest, /"tar": "7\.5\.22"/u);
  assert.doesNotMatch(packageManifest, /electron-updater/u);
  assert.match(packageScript, /unsigned-ci-test-only-never-publish/u);
  assert.match(packageScript, /verified-public-release/u);
  assert.match(packageScript, /notarytool/u);
  assert.match(packageScript, /NOTARIZATION_TIMEOUT_MS/u);
  assert.match(packageScript, /timeoutMs: NOTARIZATION_TIMEOUT_MS/u);
  assert.match(packageScript, /QUARANTINED-NOT-FOR-PUBLISH-/u);
  assert.match(packageScript, /await rename\(artifactPath, publishedArtifactPath\)/u);
  assert.match(packageScript, /Get-AuthenticodeSignature/u);
  assert.match(packageScript, /KIRINUKI_WINDOWS_AUTHENTICODE_PATH/u);
  assert.match(packageScript, /KIRINUKI_WINDOWS_CERTIFICATE_THUMBPRINT/u);
  assert.match(installerSmoke, /KIRINUKI_WINDOWS_SHORTCUT_PATH/u);
  assert.match(installerSmoke, /KIRINUKI_WINDOWS_JUNCTION_PATH/u);
  assert.match(installerSmoke, /KIRINUKI_WINDOWS_JUNCTION_TARGET/u);
  assert.doesNotMatch(packageScript, /\$args\[/u);
  assert.doesNotMatch(installerSmoke, /\$args\[/u);
  assert.match(packageScript, /VALIDSIG/u);
  assert.match(packageScript, /plutil/u);
  assert.match(packageScript, /LSUIElement/u);
  assert.match(packageScript, /telemetry: false/u);
  assert.match(installerSmoke, /Kirinuki\.lnk/u);
  assert.match(installerSmoke, /WScript\.Shell/u);
  assert.match(installerSmoke, /Start Menu recovery launcher/u);
  assert.match(installerSmoke, /autostartMode: "production"/u);
  assert.match(installerSmoke, /CurrentVersion/u);
  assert.match(installerSmoke, /StartupApproved/u);
  assert.match(installerSmoke, /Windows uninstaller가 owned Run\/StartupApproved 값을 제거하지 못했습니다/u);
  assert.match(installerSmoke, /production-xdg-autostart-readback-removal/u);
  assert.match(installerSmoke, /assertPathAbsent\(recoveryShortcut\)/u);
  assert.match(installerSmoke, /ItemType Junction/u);
  assert.match(installerSmoke, /junction target sentinel/u);
  assert.match(nsisInclude, /customUnInstall/u);
  assert.match(nsisInclude, /Kirinuki Local Engine/u);
  assert.doesNotMatch(nsisInclude, /RMDir\s+\/r/iu);
  assert.doesNotMatch(nsisInclude, /\$LOCALAPPDATA\\Kirinuki/u);
  assert.doesNotMatch(nsisInclude, /DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run"/u);
});
