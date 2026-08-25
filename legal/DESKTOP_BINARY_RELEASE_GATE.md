# Kirinuki 로컬 미디어 엔진 공개 배포 차단 조건

이 문서는 웹 편집기와 함께 쓰는 **화면 없는 로컬 구간 준비 엔진**의 설치 파일을
공개하기 전에 닫아야 할 공학적·법적 조건입니다. Electron 편집기나 브라우저
확장 프로그램의 출시 문서가 아닙니다. 법률 자문 또는 무위험 보증도 아닙니다.

## 현재 상태: 공개 차단

native CI는 다음 unsigned package를 만들지만 OS별 smoke 범위는 동일하지 않습니다.
공통 검증은 격리된 사용자 상태에서 windowless 실행, loopback health, 두 번째 실행,
정상 종료와 격리 임시 경로 정리입니다. Windows는 임시 경로 silent install에 더해
실제 HKCU Run의 exact name/path/argument/enabled 등록·readback과, 엔진 실행 중 실제
NSIS 제거가 owned Run/StartupApproved 값만 제거하고 외부 junction을 보존하는지
확인합니다. Linux는 deb 설치 뒤 격리된 실제 XDG 사용자 profile의 autostart
등록·readback, 엔진 실행 중 `dpkg --remove`, purge와 package-owned
파일 부재를 확인합니다. 실행 파일이 먼저 사라진 managed XDG entry는 다음 로그인에
자기 파일만 회수하지만, dpkg가 임의의 기존 다중 사용자 profile을 즉시 정리한다는
증거는 아닙니다. macOS는 DMG를 read-only mount한 뒤 앱을 `/Applications`에 복사해
실행하고, 실행 중 bundle 이동을 감지해 자체 runtime을 정리하는 것과 DMG detach를
확인합니다. 실제 macOS 로그인 항목 승인과 일반 사용자 profile cleanup은
비대화형 CI에서 아직 검증하지 않습니다.

| 대상 | 파일 | 형식 |
| --- | --- | --- |
| Windows x64 | `UNSIGNED-TEST-ONLY-Kirinuki-Engine-windows-x64-setup.exe` | per-user NSIS |
| macOS arm64 | `UNSIGNED-TEST-ONLY-Kirinuki-Engine-macos-arm64.dmg` | DMG, macOS 15.0+ |
| Linux x64 | `UNSIGNED-TEST-ONLY-Kirinuki-Engine-linux-x64.deb` | Debian package |

현재 artifact는 Windows Authenticode 서명이 없고 macOS Developer ID 서명·공증·
staple이 없으며, installer 전체 SBOM·provenance도 완결되지 않았습니다. 그러므로
CI 산출물을 Release, 웹 다운로드, mirror, 자동 업데이트에 올리면 안 됩니다.
hash 고정, unit test 또는 한 개발 PC의 성공은 이 차단을 해제하지 않습니다.

### 임시 Linux x64 공개 테스트 예외

Apple Developer Program과 Windows 서명 준비가 끝나기 전의 제품 흐름 검증을 위해
`Linux x64 preview release` workflow만 별도 prerelease를 만들 수 있습니다. 이는
`UNSIGNED-TEST-ONLY-*` 파일을 그대로 공개하는 경로가 아닙니다. exact tagged main과
green quality CI를 확인하고, GitHub-hosted Ubuntu의 deb와 격리된 Arch 환경의
pkg.tar.zst에서 install, XDG autostart, 실제 Chrome↔loopback 연결, 재실행, 제거를
모두 통과한 byte만 `Kirinuki-Engine-linux-x64-preview.deb` 및
`Kirinuki-Engine-arch-x64-preview.pkg.tar.zst`로 승격합니다. release에는 exact preview
manifest, SHA-256, tag/commit과 FFmpeg·linked component·yt-dlp·Electron source 위치를
고정한 source/license offer를 함께 넣고 모든 asset에 GitHub build-provenance
attestation을 발급하며, release와 웹 UI 모두 **unsigned Linux preview**임을 표시합니다.

이 예외는 Debian/Ubuntu·Arch Linux x64 한정 공개 테스트이고 stable/latest release,
자동 업데이트, Linux 배포 서명 완료, Windows/macOS 지원 또는 아래 정식 세 OS gate의
완료로 간주하지 않습니다. 웹 링크는 exact published prerelease readback 뒤
`KIRINUKI_INSTALLER_CHANNEL=linux-preview npm run build:web:release`로만 열 수 있고,
tag-pinned Linux URL 두 개만 포함해야 합니다.

`Signed desktop installer release` workflow는 수동 dispatch, exact existing tag,
`PUBLISH_SIGNED_INSTALLERS`, protected `installer-release` environment가 모두 맞을 때만
시작합니다. 현재 저장소에 아래 서명·공증·provenance secret과 사람이 승인한 묶음이
없으면 public asset을 만들거나 Release를 publish하지 못하는 것이 정상입니다.

일반 `npm run build`는 아직 검증·고정되지 않은 설치 파일 URL을 싣지 않습니다.
최종 remote asset 전체의 tag·size·SHA-256 digest와 이 문서의 readback을 대조한
배포 작업만 release channel을 소스에 고정할 수 있습니다. 고정 전에는 absolute
`KIRINUKI_WEB_ENGINE_RELEASE_READBACK`을 주고 `npm run build:web:release`를 실행해
tag에 고정된 installer URL을 검증합니다. 검증이 실패하거나 source pin이 없으면
웹은 **설치 파일 준비 중** 상태를 유지합니다. 검증된 source pin은 이후 일반
build도 같은 정적 bytes를 재현하게 하며, 브라우저 runtime은 GitHub API나
`latest` alias를 조회하지 않습니다.

- Windows: PFX/password, exact SHA-1 thumbprint·publisher subject
- macOS: Developer ID P12/password, exact identity·Team ID, App Store Connect API key
- Linux/release integrity: exact OpenPGP private key·fingerprint·passphrase
- provenance: credential 없는 HTTPS URL과 exact SHA-256으로 고정한
  `Kirinuki-Engine-source-provenance.tar.gz`

provenance archive는 linked FFmpeg component의 exact source revision·license 원문,
대응 소스, Shaka build scripts, source offer, CycloneDX 1.6 SBOM을 포함해야 합니다.
세 native job이 같은 archive bytes를 검증하고, 최종 GitHub Release도 그 archive를
installer·signed checksum과 함께 공개합니다. archive가 없거나 tree/hash/review가
다르면 installer signing 전 단계에서 fail closed합니다.

## 실제 제품 계약

- 제품 UI는 `https://kirinuki.eff0rtchung.kr`의 전체 웹 편집기입니다.
- 설치 파일은 편집 창을 만들지 않고 background engine만 설치합니다.
- 운영체제 로그인 시 화면 없이 시작하고 `127.0.0.1`의 고정 내부 연결에만
  bind합니다.
- 정확한 public Origin과 문서별 memory capability만 허용합니다.
- 로그인, 서버 저장 세션, analytics, telemetry, 자동 업데이트 요청이 없습니다.
- 공개 Kirinuki 서버는 VOD proxy가 아닙니다.
- uninstall은 엔진 등록과 package-owned 파일을 제거하되 사용자 원본이나 다른 앱
  데이터를 건드리지 않아야 합니다. Windows 사용자 데이터는 현재 reparse-safe
  ownership 검증이 없으므로 재귀 삭제하지 않고 cache residue를 보존합니다.

## 고정된 빌드 입력

| 구성요소 | 고정점 | 역할 |
| --- | --- | --- |
| Electron | `43.4.1` | background runtime; Chromium·Node 포함 |
| electron-builder | `26.15.3` | NSIS·DMG·deb installer 생성 |
| `@electron/asar` | `4.2.1` | ASAR exact-file 검증 |
| `@electron/packager` | `20.3.0` | target app stage 생성 |
| `@electron/fuses` | `2.1.3` | fuse 설정·readback |
| `@electron/osx-sign` | `2.6.0` | macOS nested executable·app signing |
| FFmpeg·ffprobe | `n8.1.2`, Shaka tag `n8.1.2-1` | target media sidecar |
| yt-dlp | `2026.07.04` | target public-VOD sidecar |

npm wrapper·build 도구는 `package-lock.json`의 exact version, HTTPS registry URL,
integrity로 고정합니다. target sidecar의 URL·크기·SHA-256은
`src/desktop/tool-manifest.ts`, 지원 target과 파일명은
`src/desktop/installer-contract.ts`가 canonical 기록입니다. 이 입력 고정은 아래
최종 산출물 검토를 대체하지 않습니다.

release 승인 job은 yt-dlp의 고정 공개키 fingerprint로 공식 release checksum 서명을
검증한 뒤 세 target hash를 manifest와 대조합니다. Electron runtime archive는
`electron` npm package에 integrity로 묶인 exact version의 upstream checksum map에서
대상 파일 hash를 읽어 packager download gate에 전달합니다. FFmpeg artifact는 현재
고정 hash와 GitHub release digest의 사람 검토에 의존하므로 공개 승인 전 독립된 두
검토자가 provenance bundle과 target manifest 일치를 확인해야 합니다.

## 라이선스·SBOM hard gate

### Electron·Chromium·Node

Electron 소스는 MIT이지만 runtime에는 Chromium, Node.js와 다수의 제3자 파일이
포함됩니다. 각 target에서 실제로 내려받은 Electron archive의 immutable URL,
byte size, SHA-256과 upstream checksum을 release manifest에 기록하고, 최종
installer가 보존한 `LICENSE`·`LICENSES.chromium.html`을 packaged-file SBOM과
대조해야 합니다.

- Source/license: https://github.com/electron/electron/tree/v43.4.1
- Distribution guide: https://www.electronjs.org/docs/latest/tutorial/application-distribution/

electron-builder와 모든 transitive build dependency는 build-only라는 이유로
검토에서 제외하지 않습니다. exact artifact·license·source를 canonical registry와
release evidence에 기록하고 최종 installer에 잘못 섞이지 않았는지 검사합니다.

### FFmpeg·ffprobe

현재 target sidecar는 `shaka-project/static-ffmpeg-binaries` tag `n8.1.2-1`에서
가져옵니다. 각 target의 실제 `ffmpeg -version`, `ffprobe -version`,
`ffmpeg -buildconf`, linked library와 codec 구성을 보관해 LGPL/GPL 적용 범위를
확정해야 합니다.

`--enable-nonfree`가 있으면 자동 배포를 **차단**합니다. GPL component가
활성화되면 실제 조건에 맞는 전체 원문·대응 소스 또는 source offer를 같은
release에서 제공합니다. `FFMPEG-LICENSE.txt` 하나나 hash 일치만으로 충분하지
않습니다. Mbed TLS 등 정적 linked component도 별도 취약성·라이선스 검토
대상입니다.

- Guidance: https://ffmpeg.org/legal.html
- Development provenance: https://github.com/shaka-project/static-ffmpeg-binaries/releases/tag/n8.1.2-1

### yt-dlp standalone

target별 official standalone은 본체 Unlicense 외에도 Python runtime,
yt-dlp-ejs와 기타 embedded component를 포함할 수 있습니다. 각 Windows x64,
macOS arm64, Linux x64 binary에서 실제 inventory와 notice를 수집합니다. 저장소
source-run용 Unix zipimport 고지를 그대로 복사해 완료 처리하지 않습니다.

- Source/license: https://github.com/yt-dlp/yt-dlp/tree/2026.07.04
- Artifacts: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04

## 서명·공증 hard gate

macOS는 앱과 모든 nested executable·dylib·FFmpeg·ffprobe·yt-dlp를 Developer ID로
서명하고 hardened runtime·최소 entitlement를 적용한 뒤 notarization과 ticket
staple을 완료합니다. 최종 DMG에서 `codesign --verify --deep --strict`,
`spctl --assess --type execute`, `stapler validate`를 모두 실행합니다. 서명으로
upstream 도구 byte가 바뀌므로 signed byte의 size/SHA-256은 앱 내부 manifest에
기록하되, 런타임은 그 manifest를 읽기 전에 outer `.app` seal을 검증하고 모든
도구를 hash한 뒤 seal을 다시 검증합니다. 따라서 mutable manifest 단독으로는
신뢰 근거가 되지 않습니다.

Windows는 installer, app executable과 Kirinuki가 빌드한 native launcher를
Authenticode로 서명하고 신뢰할 수 있는 timestamp를 적용합니다. 검토한 upstream
FFmpeg·ffprobe·yt-dlp는 재서명하지 않고 pinned size/SHA-256 bytes를 installer 생성
뒤에도 다시 확인합니다. 최종 EXE의 signature readback과 깨끗한 사용자 계정에서
SmartScreen/설치·제거·실제 엔진 기동을 확인합니다.

Linux deb도 exact manifest·digest·SBOM·notice와 배포 채널의 서명·검증 절차를
release record에 포함합니다.

Electron의 공식 안내도 Windows/macOS 코드 서명과 macOS 외부 배포의 공증을
요구 경계로 설명합니다:
https://www.electronjs.org/docs/latest/tutorial/code-signing

## 생명주기·안전성 hard gate

- [ ] 세 OS에서 설치 전 → 설치 → 첫 실행 → 로그인 자동 시작 → 두 번째 실행 →
  업데이트 재설치 → uninstall을 실제 native runner에서 검증했다.
- [ ] 실행 중 창/webContents가 0이고 편집 UI가 공개 웹사이트에만 있음을 readback했다.
- [ ] loopback listener가 LAN/공인 interface에 노출되지 않고 정확한 Origin·Host·
  nonce·capability scope를 강제한다.
- [ ] 같은 엔진이 이미 있을 때 멱등적으로 재사용하고 다른 프로세스가 port를
  차지하면 takeover하거나 종료하지 않고 fail closed한다.
- [ ] 정상 종료·취소·timeout·crash·uninstall 뒤 gateway, FFmpeg, ffprobe, yt-dlp와
  임시 파일이 남지 않는다.
- [ ] Windows는 외부 도구 전체를 native Job Object에 원자적으로 묶고
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`로 descendant orphan이 없음을 실제
  회귀 테스트한다. 이 조건이 구현·검증되기 전에는 Windows 공개 배포를 차단한다.
- [ ] macOS/Linux는 process group과 PID identity를 재확인해 다른 프로세스를
  종료하지 않으며 전체 descendant 소멸을 검사한다.
- [ ] uninstall이 사용자가 직접 선택한 원본 파일과 다른 프로젝트의 자료를
  삭제하지 않는다.
- [ ] 업데이트 agent나 숨은 network poll이 없고 protocol 불일치는 웹에서 최신
  설치 파일을 명시적으로 다시 설치하도록 안내한다.

## 1회 설치 호환성과 업데이트 경계

Windows NSIS, macOS DMG, Linux deb 전부에서 동일한 보안 수준의 무인 자동 업데이트를
제공하려면 서명된 update metadata, freshness·rollback 보호, 실패 복구와 Linux package
권한 모델까지 별도 설계해야 합니다. 이 기반 없이 background engine이 파일을
내려받아 실행하거나 unsigned update를 적용하는 기능은 넣지 않습니다.

대신 `kirinuki-local-media-engine/v1`은 앱 release 번호와 독립된 additive-only
호환성 경계입니다. 같은 v1을 광고하는 기존 설치는 이후 웹에서도 계속 사용해야
하며, 기존 필드·endpoint·request schema를 제거하거나 의미를 바꾸면 안 됩니다.
breaking change가 불가피하면 v1을 깨는 대신 parallel protocol을 추가하고, 사용자
교체가 정말 필요할 때만 같은 stable install path에 서명된 installer를 다시
실행합니다. 자동 network polling, unsigned updater, 조용한 binary replacement는
release manifest에서 모두 `false`로 readback합니다.

이 정책은 실제 OS별 old→new 설치 덮어쓰기 smoke를 대체하지 않습니다. 해당 native
검증이 완료되기 전에는 위 업데이트 재설치 체크를 완료 처리하지 않습니다.

## 공개 release 승인 체크

다음 항목은 하나라도 미완료이면 fail closed합니다.

- [ ] 세 installer의 exact file tree, byte size, SHA-256, SBOM, notice와 build
  provenance를 같은 commit의 release record에 고정했다.
- [ ] Electron archive provenance와 Electron/Chromium/Node 전체 고지를 검증했다.
- [ ] electron-builder를 포함한 installer build dependency의 exact license
  inventory와 최종 비포함 여부를 검증했다.
- [ ] FFmpeg·ffprobe target별 build/link evidence와 적용 조건에 맞는 대응 소스를
  제공했다.
- [ ] yt-dlp standalone의 target별 embedded component 인벤토리를 제공했다.
- [ ] Windows x64 native CI의 silent install·Start Menu readback·liveness·uninstall
  smoke를 같은 commit에서 통과했다.
- [ ] Linux x64 native CI의 deb install·liveness·remove/purge와 package-owned path
  smoke를 같은 commit에서 통과했다.
- [ ] macOS arm64에서 `/Applications` copy, 로그인 자동 시작, uninstall과 실제 사용자
  profile cleanup을 포함한 native lifecycle smoke를 같은 commit에서 통과했다.
- [ ] 세 플랫폼 CHZZK·YouTube·SOOP 공개 VOD의 부분 준비와 범위·시간축 검증을
  실제 브라우저↔설치 엔진 경로에서 통과했다.
- [ ] 같은 commit의 일반 사용자 네트워크에서 YouTube 무쿠키 부분 준비를
  통과했다. GitHub-hosted runner에서는 로그인/cookie로 bot 차단을 우회하지 않고
  공개 oEmbed identity를 확인하며 CHZZK·SOOP fresh-state 부분 준비를 통과했다.
- [ ] 실제 Chrome에서 최초 custom-scheme pairing, signed health, 암호화 VOD
  session, 같은 profile 새로고침 뒤 무재pairing 재연결을 설치본마다 통과했다.
- [ ] Windows Job Object/orphan gate를 닫았다.
- [ ] Windows Authenticode/timestamp와 macOS Developer ID/notarization/staple을
  최종 artifact에서 검증했다.
- [ ] digest, signing identity, timestamp/notarization request와 readback log를
  release record에 보관했다.
- [ ] publish 뒤 exact remote asset digest readback으로 `build:web:release`를
  실행하고, 그 전 web bundle에 installer URL이 없음을 확인했다.

`npm run license:check` 성공, unsigned installer 생성, checksum 고정, 개발 PC
실행 성공 중 어느 것도 위 항목을 완료 처리하지 않습니다.
