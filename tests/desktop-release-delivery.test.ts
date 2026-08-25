import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("ordinary CI persists only unsigned JSON evidence and never installer bytes", async () => {
  const workflow = await readFile(path.join(
    root,
    ".github/workflows/typescript-quality.yml"
  ), "utf8");
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u);
  assert.match(workflow, /unsigned-test-evidence-\$\{\{ matrix\.target \}\}/u);
  assert.match(
    workflow,
    /path:\s*dist\/installers\/\$\{\{ matrix\.target \}\}\/UNSIGNED-TEST-ONLY-installer-manifest\.json/u
  );
  assert.doesNotMatch(
    workflow,
    /path:\s*dist\/installers\/\$\{\{ matrix\.target \}\}\/[ \t]*$/mu
  );
  assert.match(workflow, /retention-days:\s*7/u);
  assert.match(
    workflow,
    /Install and read back exact Linux deb runtime dependencies[\s\S]*apt-get install --yes --no-install-recommends libnotify4 libsecret-1-0[\s\S]*dpkg-query --show --showformat='\$\{Status\}'/u
  );
  assert.doesNotMatch(workflow, /gh release (?:create|upload|edit)/u);
  assert.doesNotMatch(workflow, /contents:\s*write/u);
});

test("public installer release는 explicit manual/tag confirmation과 protected environment만 사용한다", async () => {
  const workflow = await readFile(path.join(
    root,
    ".github/workflows/desktop-installer-release.yml"
  ), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /push:\s*\n\s*tags:/u);
  assert.match(workflow, /PUBLISH_SIGNED_INSTALLERS/u);
  assert.match(workflow, /test "\$GITHUB_REF_TYPE" = "tag"/u);
  assert.match(workflow, /actions:\s*read/u);
  assert.match(workflow, /git merge-base --is-ancestor "\$commit" refs\/remotes\/origin\/main/u);
  assert.match(workflow, /actions\/workflows\/typescript-quality\.yml\/runs/u);
  assert.match(workflow, /\.head_branch == "main"/u);
  assert.match(workflow, /\.event == "push"/u);
  assert.match(workflow, /\.conclusion == "success"/u);
  assert.match(workflow, /environment:\s*installer-release/gu);
  assert.match(workflow, /KIRINUKI_WINDOWS_PFX_BASE64/u);
  assert.match(workflow, /Import-PfxCertificate/u);
  assert.match(workflow, /security import/u);
  assert.match(workflow, /notarized public-release DMG/u);
  assert.match(workflow, /KIRINUKI_LINUX_GPG_PRIVATE_KEY_BASE64/u);
  assert.match(workflow, /--list-secret-keys/u);
  assert.match(workflow, /KIRINUKI_RELEASE_PROVENANCE_URL/u);
  assert.match(workflow, /prepare:desktop:release-provenance/gu);
  assert.equal(
    workflow.match(/npm run verify:upstream-tool-provenance/gu)?.length,
    1
  );
  assert.match(
    workflow,
    /jobs:[\s\S]*authorize:[\s\S]*npm ci --ignore-scripts[\s\S]*npm run verify:upstream-tool-provenance[\s\S]*Fail closed unless dispatch ref/u
  );
  assert.match(workflow, /KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256/u);
  assert.match(workflow, /gh release create[\s\S]*--draft/u);
  assert.match(workflow, /gh release download/u);
  assert.match(workflow, /test:package:desktop:release-readback/u);
  assert.match(workflow, /gh release edit[\s\S]*--draft=false --latest/u);
  assert.match(workflow, /releases\/latest\/download\/\$asset/u);
  assert.match(workflow, /attest-build-provenance@[0-9a-f]{40}/u);
  assert.equal(
    workflow.match(/browser-actions\/setup-chrome@[0-9a-f]{40}/gu)?.length,
    3
  );
  assert.equal(
    workflow.match(/KIRINUKI_INSTALLED_BROWSER_SMOKE:\s*"1"/gu)?.length,
    3
  );
  assert.equal(workflow.match(/npm run test:liveness:live-vod/gu)?.length, 1);
  assert.match(
    workflow,
    /youtube\.com\/oembed\?url=[^'\n]+jNQXAC9IVRw[^'\n]+[\s\S]*npm run test:liveness:live-vod -- CHZZK SOOP/u
  );
  assert.doesNotMatch(workflow, /--cookies(?:-from-browser)?/u);
  assert.match(
    workflow,
    /Install and read back exact Linux deb runtime dependencies[\s\S]*apt-get install --yes --no-install-recommends libnotify4 libsecret-1-0[\s\S]*dpkg-query --show --showformat='\$\{Status\}'/u
  );
});

test("Linux preview release는 stable gate와 분리해 install E2E·prerelease·attestation을 강제한다", async () => {
  const workflow = await readFile(path.join(
    root,
    ".github/workflows/linux-preview-release.yml"
  ), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /push:[\s\S]*tags:[\s\S]*- "v\*"/u);
  assert.match(workflow, /PUBLISH_LINUX_PREVIEW/u);
  assert.match(
    workflow,
    /git log -1 --format=%B[\s\S]*grep -Fxq -- "Release-Confirmation: PUBLISH_LINUX_PREVIEW"/u
  );
  assert.match(workflow, /test "\$GITHUB_REF_TYPE" = "tag"/u);
  assert.match(workflow, /refs\/remotes\/origin\/main\)" = "\$commit"/u);
  assert.match(workflow, /typescript-quality\.yml\/runs/u);
  assert.match(workflow, /npm run package:desktop:installer/u);
  assert.match(workflow, /npm run package:desktop:arch/u);
  assert.match(workflow, /KIRINUKI_ARCH_INSTALLER_SYSTEM_SMOKE=1/u);
  assert.match(workflow, /npm run test:semantic:engine/u);
  assert.match(workflow, /KIRINUKI_INSTALLER_SYSTEM_SMOKE:\s*"1"/u);
  assert.match(workflow, /KIRINUKI_INSTALLED_BROWSER_SMOKE:\s*"1"/u);
  assert.match(workflow, /npm run package:desktop:linux-preview/u);
  assert.match(workflow, /attest-build-provenance@[0-9a-f]{40}/u);
  assert.match(workflow, /gh release create[\s\S]*--draft[\s\S]*--prerelease/u);
  assert.match(workflow, /exact_draft_release_by_tag/u);
  assert.match(workflow, /releases\?per_page=100/u);
  assert.match(
    workflow,
    /\[\.\[\] \| select\(\.tag_name == \$tag\)\] \| length/u
  );
  assert.match(workflow, /test "\$matches" = 1/u);
  assert.match(
    workflow,
    /release_json="\$\(exact_draft_release_by_tag\)"[\s\S]*\.draft'[\s\S]*= true/u
  );
  assert.match(workflow, /gh release download/u);
  assert.match(workflow, /test:package:desktop:linux-preview/u);
  assert.match(workflow, /\.prerelease'[\s\S]*= true/u);
  assert.match(workflow, /not stable signed releases/u);
  assert.match(workflow, /source\/license offer/u);
  assert.doesNotMatch(workflow, /--latest|releases\/latest\/download/u);
  assert.doesNotMatch(workflow, /KIRINUKI_(?:WINDOWS|APPLE|MACOS)_/u);
});

test("Windows helper preview는 main quality와 native lifecycle 뒤에만 GitHub prerelease를 만든다", async () => {
  const workflow = await readFile(path.join(
    root,
    ".github/workflows/windows-preview-release.yml"
  ), "utf8");
  assert.match(workflow, /push:[\s\S]*tags:[\s\S]*windows-preview-v\*/u);
  assert.match(workflow, /PUBLISH_WINDOWS_PREVIEW/u);
  assert.match(workflow, /git\/ref\/tags\/\$tag/u);
  assert.match(workflow, /\.object\.type'[\s\S]*= tag/u);
  assert.match(workflow, /git\/tags\/\$tag_object_sha/u);
  assert.match(workflow, /\.object\.type'[\s\S]*= commit/u);
  assert.match(workflow, /Release-Confirmation: PUBLISH_WINDOWS_PREVIEW/u);
  assert.match(workflow, /refs\/remotes\/origin\/main\)" = "\$commit"/u);
  assert.match(workflow, /typescript-quality\.yml\/runs/u);
  assert.match(workflow, /authorize:[\s\S]*runs-on:\s*ubuntu-24\.04/u);
  assert.match(
    workflow,
    /authorize:[\s\S]*verify:upstream-tool-provenance[\s\S]*publish:[\s\S]*needs:\s*authorize/u
  );
  assert.match(workflow, /runs-on:\s*windows-2025/u);
  assert.match(workflow, /npm run test:windows:job-launcher/u);
  assert.match(workflow, /npm run test:package:desktop && npm run test:semantic:engine/u);
  assert.match(workflow, /KIRINUKI_INSTALLER_SYSTEM_SMOKE:\s*"1"/u);
  assert.match(workflow, /KIRINUKI_INSTALLED_BROWSER_SMOKE:\s*"1"/u);
  assert.match(workflow, /Get-AuthenticodeSignature[\s\S]*NotSigned/gu);
  assert.match(workflow, /npm run package:desktop:windows-preview/u);
  assert.match(workflow, /attest-build-provenance@[0-9a-f]{40}/u);
  assert.match(workflow, /gh release create[\s\S]*--draft[\s\S]*--prerelease/u);
  assert.match(workflow, /gh release download/u);
  assert.match(workflow, /for attempt in \$\(seq 1 24\)[\s\S]*release_match_count[\s\S]*draft release discovery pending[\s\S]*remote_digest_count[\s\S]*sleep 5/u);
  assert.match(workflow, /digest_ready[\s\S]*GitHub did not expose every asset digest/u);
  assert.match(workflow, /test:package:desktop:windows-preview/u);
  assert.match(workflow, /SmartScreen/u);
  assert.doesNotMatch(workflow, /--latest|releases\/latest\/download/u);
  assert.doesNotMatch(workflow, /KIRINUKI_(?:APPLE|MACOS)_/u);
});

test("release assembler는 exact remote set, native evidence, hashes, GPG readback을 모두 강제한다", async () => {
  const source = await readFile(path.join(
    root,
    "scripts/desktop-release-assets.ts"
  ), "utf8");
  assert.match(source, /DESKTOP_PUBLIC_RELEASE_ASSET_FILES/u);
  assert.match(source, /verified-public-release/u);
  assert.match(source, /authenticode-rfc3161-sha256/u);
  assert.match(source, /developer-id-hardened-runtime-notarized-stapled-dmg/u);
  assert.match(source, /openpgp-detached-signature-sha256-manifest/u);
  assert.match(source, /VALIDSIG/u);
  assert.match(source, /download readback SHA-256/u);
  assert.match(source, /releaseSigning/u);
  assert.match(source, /DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE/u);
  assert.match(source, /aggregate provenance archive readback/u);
  assert.match(source, /LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY/u);
});

test("release는 unsigned auto-update 대신 v1 additive compatibility와 signed replacement만 허용한다", async () => {
  const [contract, packageManifest, packager] = await Promise.all([
    readFile(path.join(root, "src/lib/local-media-engine-contract.ts"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop-installer.ts"), "utf8")
  ]);
  assert.match(contract, /v1-additive-compatibility/u);
  assert.match(contract, /evolution:\s*"additive-only"/u);
  assert.match(contract, /breakingChange:\s*"new-parallel-protocol"/u);
  assert.match(contract, /signed-stable-path-installer-only/u);
  assert.match(contract, /unsignedUpdatesAllowed:\s*false/u);
  assert.match(contract, /publicNetworkPolling:\s*false/u);
  assert.doesNotMatch(packageManifest, /electron-updater/u);
  assert.match(packager, /publicNetworkPolling:\s*false/u);
  assert.match(packager, /unsignedUpdatesAllowed:\s*false/u);
});

test("세 OS 설치기는 웹 상표와 Linux desktop identity를 명시한다", async () => {
  const [
    packageManifest,
    testConfig,
    releaseConfig,
    icon,
    desktopMain,
    desktopPackager
  ] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "electron-builder.yml"), "utf8"),
    readFile(path.join(root, "electron-builder.release.yml"), "utf8"),
    readFile(path.join(root, "build/icon.svg"), "utf8"),
    readFile(path.join(root, "src/desktop/main.ts"), "utf8"),
    readFile(path.join(root, "scripts/package-desktop.ts"), "utf8")
  ]);
  assert.equal(
    JSON.parse(packageManifest).desktopName,
    "kr.eff0rtchung.kirinuki.desktop"
  );
  for (const config of [testConfig, releaseConfig]) {
    assert.match(config, /mac:[\s\S]*icon: build\/icon\.icns/u);
    assert.match(config, /^dmg:\n(?:  .*\n)*  writeUpdateInfo: false$/mu);
    assert.match(config, /win:[\s\S]*icon: build\/icon\.ico/u);
    assert.match(config, /linux:[\s\S]*icon: build\/icon\.svg/u);
    assert.match(config, /linux:[\s\S]*syncDesktopName: true/u);
  }
  assert.match(testConfig, /signAndEditExecutable: true/u);
  assert.match(testConfig, /signExecutable: false/u);
  assert.match(icon, /viewBox="0 0 1024 1024"/u);
  assert.match(icon, /aria-label="Kirinuki"/u);
  assert.match(desktopMain, /app\.setDesktopName\(`\$\{APP_ID\}\.desktop`\)/u);
  assert.doesNotMatch(desktopMain, /setDesktopName\("kirinuki\.desktop"\)/u);
  assert.match(desktopPackager, /darwin: path\.join\(root, "build", "icon\.icns"\)/u);
  assert.match(desktopPackager, /win32: path\.join\(root, "build", "icon\.ico"\)/u);
  assert.match(desktopPackager, /CFBundleIconFile: "Kirinuki\.icns"/u);
});

test("provenance gate는 actual archive hash와 exact linked source versions를 강제한다", async () => {
  const [preparer, verifier] = await Promise.all([
    readFile(path.join(root, "scripts/prepare-desktop-release-provenance.ts"), "utf8"),
    readFile(path.join(root, "scripts/verify-desktop-release-provenance.ts"), "utf8")
  ]);
  assert.match(preparer, /redirect:\s*"manual"/u);
  assert.match(preparer, /entry\.type !== "File"/u);
  assert.match(preparer, /archive SHA-256이 secret pin과 다릅니다/u);
  assert.match(verifier, /kirinuki-desktop-release-provenance\/v2/u);
  for (const version of [
    "n8.1.2",
    "v1.16.0",
    "v4.1.0",
    "0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee",
    "4.2",
    "3.100",
    "v1.6.1",
    "v3.4.1"
  ]) {
    assert.equal(verifier.includes(version), true);
  }
  assert.match(verifier, /bundleContentSha256/u);
  assert.doesNotMatch(verifier, /manifest\.bundleArchiveSha256/u);
});
