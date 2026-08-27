import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("installed desktop main은 평상시 windowless이고 컷 창은 native smoke에서만 연다", async () => {
  const [main, supervisor, packageFiles, packageScript] = await Promise.all([
    readFile(path.join(root, "src/desktop/main.ts"), "utf8"),
    readFile(path.join(root, "src/desktop/runtime-supervisor.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-package-files.ts"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop.ts"), "utf8")
  ]);
  assert.match(main, /BrowserWindow/u);
  assert.match(main, /CUT_WINDOW_URL/u);
  assert.match(main, /CUT_WINDOW_PLAYER_ACTION_CHANNEL/u);
  assert.match(main, /if \(nativeSmoke\) \{\s*installCutWindowIpcHandler/u);
  assert.match(main, /if \(nativeSmoke && cutWindowRequested\) \{\s*await openCutWindow/u);
  assert.match(main, /app\.on\("activate", \(\) => \{\s*\/\/ The installed product is a windowless media engine/u);
  assert.match(main, /app\.on\("window-all-closed", \(\) => \{/u);
  assert.match(main, /else if \(nativeSmoke && launchCommand\?\.kind === "cut"\) \{\s*requestCutWindow/u);
  assert.match(packageFiles, /preload\.cjs/u);
  for (const source of [main, supervisor, packageFiles, packageScript]) {
    assert.doesNotMatch(source, /chrome-extension:\/\/|Player Bridge/u);
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
    desktopPackageSmoke,
    powershellEnvironment,
    builderEnvironment,
    nsisInclude
  ] = await Promise.all([
    readFile(path.join(root, "electron-builder.yml"), "utf8"),
    readFile(path.join(root, "electron-builder.release.yml"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop-installer.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-installer-smoke.ts"), "utf8"),
    readFile(path.join(root, "scripts/desktop-package-smoke.ts"), "utf8"),
    readFile(path.join(root, "scripts/windows-powershell-environment.ts"), "utf8"),
    readFile(path.join(root, "scripts/electron-builder-environment.ts"), "utf8"),
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
    assert.match(config, /differentialPackage:\s*false/u);
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
  assert.match(packageScript, /Microsoft\.PowerShell\.Security\\\\Get-AuthenticodeSignature/u);
  assert.match(packageScript, /\$securityModule=\$PSHOME\+'/u);
  assert.doesNotMatch(packageScript, /(?:runCaptured|execFileAsync)\("powershell\.exe"/u);
  for (const source of [packageScript, installerSmoke, desktopPackageSmoke]) {
    assert.match(source, /windowsPowerShellEnvironment/u);
    assert.match(source, /windowsPowerShellExecutable/u);
  }
  assert.match(powershellEnvironment, /WINPSMODULEPATH/u);
  assert.match(powershellEnvironment, /delete environment\[key\]/u);
  assert.match(packageScript, /electronBuilderEnvironment/u);
  assert.match(builderEnvironment, /normalized === "DEBUG"/u);
  assert.match(builderEnvironment, /normalized === "CSC_IDENTITY_AUTO_DISCOVERY"/u);
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
  assert.match(installerSmoke, /IShellLinkW/u);
  assert.match(installerSmoke, /\(\(IPersistFile\)instance\)\.Load\(path, 0\)/u);
  assert.match(installerSmoke, /link\.GetPath\(targetPath, targetPath\.Capacity, IntPtr\.Zero, 0\)/u);
  assert.doesNotMatch(installerSmoke, /link\.Resolve\(/u);
  assert.match(installerSmoke, /Start Menu recovery launcher/u);
  assert.match(installerSmoke, /autostartMode: "production"/u);
  assert.match(installerSmoke, /CurrentVersion/u);
  assert.match(installerSmoke, /StartupApproved/u);
  assert.match(installerSmoke, /Windows uninstaller가 owned protocol\/Run\/StartupApproved 값을 제거하지 못했습니다/u);
  assert.match(installerSmoke, /production-xdg-autostart-readback-removal/u);
  assert.match(installerSmoke, /assertPathAbsent\(recoveryShortcut\)/u);
  assert.match(installerSmoke, /ItemType Junction/u);
  assert.match(installerSmoke, /junction target sentinel/u);
  assert.match(nsisInclude, /customInit/u);
  assert.match(nsisInclude, /customInstall/u);
  assert.match(nsisInclude, /customUnInstall/u);
  const checkAppRunningMacro = /^!ifdef BUILD_UNINSTALLER\r?\n!macro customCheckAppRunning\r?\n([\s\S]*?)^!macroend\r?\n!endif$/mu.exec(
    nsisInclude
  );
  assert.notEqual(checkAppRunningMacro, null);
  const uninstallerPreflight = checkAppRunningMacro![1]!;
  assert.equal(
    uninstallerPreflight.includes(
      "ExecWait '\"$INSTDIR\\${APP_EXECUTABLE_FILENAME}\" --kirinuki-internal-owned-uninstall'"
    ),
    true
  );
  assert.match(uninstallerPreflight, /StrCmp \$0 "0"/u);
  assert.match(uninstallerPreflight, /Abort "Kirinuki Local Engine is still running\./u);
  assert.doesNotMatch(uninstallerPreflight, /_CHECK_APP_RUNNING/u);
  assert.doesNotMatch(uninstallerPreflight, /^\s*!else\s*$/mu);
  assert.doesNotMatch(nsisInclude, /!insertmacro _CHECK_APP_RUNNING/u);
  assert.equal(
    nsisInclude.match(/--kirinuki-internal-owned-uninstall/gu)?.length,
    1
  );
  assert.match(nsisInclude, /Kirinuki Local Engine/u);
  assert.match(nsisInclude, /Software\\Classes\\kirinuki-engine\\shell\\open\\command/u);
  assert.match(nsisInclude, /WriteRegStr HKCU/u);
  assert.match(nsisInclude, /"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" "%1"/u);
  assert.match(nsisInclude, /Another application owns the kirinuki-engine protocol/u);
  assert.match(nsisInclude, /An incomplete kirinuki-engine protocol registration already exists/u);
  assert.match(nsisInclude, /URL:kirinuki-engine/u);
  assert.match(nsisInclude, /DeleteRegKey \/ifempty/u);
  assert.match(installerSmoke, /\^"\(\[\^"\\r\\n\]\+\)" "%1"\$/u);
  assert.match(installerSmoke, /canonicalProtocolExecutable\.toLowerCase\(\)[\s\S]*canonicalInstalledExecutable\.toLowerCase\(\)/u);
  assert.match(installerSmoke, /canonicalShortcutTarget\.toLowerCase\(\)[\s\S]*canonicalInstalledExecutable\.toLowerCase\(\)/u);
  assert.match(installerSmoke, /canonicalShortcutWorkingDirectory\.toLowerCase\(\)[\s\S]*canonicalInstallRoot\.toLowerCase\(\)/u);
  assert.match(installerSmoke, /protocolCommand: null/u);
  assert.match(installerSmoke, /protocolRootDefault: null/u);
  assert.match(installerSmoke, /protocolRootExists: false/u);
  assert.match(installerSmoke, /protocolUrlMarkerPresent: false/u);
  assert.match(installerSmoke, /ToBase64String\(\[Text\.Encoding\]::UTF8\.GetBytes\(\$json\)\)/u);
  assert.match(installerSmoke, /Buffer\.from\(encoded, "base64"\)\.toString\("utf8"\)/u);
  assert.match(installerSmoke, /Buffer\.from\(shortcutEnvelope, "base64"\)\.toString\("utf8"\)/u);
  assert.doesNotMatch(nsisInclude, /DefaultIcon/u);
  assert.doesNotMatch(nsisInclude, /DeleteRegKey HKCU "Software\\Classes\\kirinuki-engine\\shell\\open\\command"/u);
  assert.doesNotMatch(nsisInclude, /RMDir\s+\/r/iu);
  assert.doesNotMatch(nsisInclude, /\$LOCALAPPDATA\\Kirinuki/u);
  assert.doesNotMatch(nsisInclude, /DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run"/u);
});
