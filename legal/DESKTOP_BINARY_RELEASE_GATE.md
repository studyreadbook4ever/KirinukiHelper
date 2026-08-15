# Kirinuki 데스크톱 바이너리 공개 배포 차단 조건

이 문서는 Linux·Windows·macOS Electron 패키지의 현재 공학적·법적 경계를
기록합니다. 법률 자문이나 특정 관할권의 적법성 보증이 아닙니다.

## 현재 상태

`npm run package:desktop`은 실행한 운영체제와 아키텍처에 맞는 **unsigned,
unpacked 개발 검증용 앱 디렉터리**를 만듭니다. CI도 이 디렉터리를 빌드하고
실제로 실행해 내부 Studio·gateway health, Player Bridge 로드, 고정 미디어 도구
버전, 검증용 H.264/AAC MP4의 production 검사 경계, 정상 종료 뒤 자식 프로세스·
포트·임시 데이터 회수까지 검사합니다. CI 결과를 release artifact로 업로드하거나
게시하지 않습니다.

현재 패키지는 installer, AppImage, DMG, PKG, MSI 또는 서명된 ZIP이 아닙니다.
아래 라이선스·provenance·서명 조건이 모두 닫힐 때까지 공개 다운로드, 자동
업데이트, 미러 또는 최종 사용자 배포에 사용하면 안 됩니다. Linux 소스 설치판의
기존 지원 상태와도 혼동하지 않습니다.

## 고정된 개발 입력

| 구성요소 | 현재 고정점 | 개발 패키지에서의 위치·역할 |
| --- | --- | --- |
| Electron | `43.4.0` | Chromium·Node가 포함된 앱 shell/runtime |
| `@electron/asar` | `4.2.1` | 생성된 ASAR의 정확한 파일 목록·바이트 검증 |
| `@electron/packager` | `20.3.0` | 빌드 시 unpacked 앱 디렉터리 생성 |
| `@electron/fuses` | `2.1.3` | Electron fuse 검증·설정용 build dependency |
| FFmpeg·ffprobe | FFmpeg `7.0.2`, `ffmpeg-static` tag `b6.1.1` | 대상별 native media sidecar |
| yt-dlp | `2026.07.04` official standalone | 대상별 공개 VOD metadata·media 준비 sidecar |

Electron npm wrapper와 패키징 도구는 `package-lock.json`의 exact version,
registry URL과 integrity로 고정합니다. Electron이 패키징 시 내려받는 실제
플랫폼 runtime은 버전만으로 공개 release provenance가 완성되지 않습니다.
최종 Electron archive의 URL, 바이트 수, SHA-256과 upstream checksum 검증 결과를
별도 release manifest에 고정해야 합니다.

FFmpeg·ffprobe와 yt-dlp의 대상별 URL, 압축·해제 바이트 수와 SHA-256은
`src/desktop/tool-manifest.ts`가 canonical 개발 manifest입니다. 현재 대상은
다음 다섯 개입니다.

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Windows arm64는 경로 타입에는 예약되어 있지만 실제 artifact manifest와 공개
지원 대상이 아닙니다. CI의 현재 네이티브 대표 대상은 `linux-x64`, `win32-x64`,
`darwin-arm64`입니다.

## 아직 끝나지 않은 라이선스 검토

### Electron, Chromium과 Node

Electron 소스 자체는 MIT이지만 배포 runtime에는 Chromium, Node.js와 다수의
제3자 구성요소가 포함됩니다. 최종 패키지의 Electron `LICENSE`와
`LICENSES.chromium.html`을 보존하고, 실제 포함 파일 SBOM과 대응 고지를
산출물별로 검사해야 합니다. npm의 `electron@43.4.0` 핀만으로 Electron runtime
전체의 재배포 인벤토리가 완성되었다고 간주하지 않습니다.

- Electron license: https://github.com/electron/electron/blob/v43.4.0/LICENSE
- Electron distribution guide:
  https://www.electronjs.org/docs/latest/tutorial/application-distribution/

`@electron/packager@20.3.0`은 BSD-2-Clause, `@electron/fuses@2.1.3`은 MIT입니다.
이들과 전체 transitive build dependency의 license·source·integrity를 canonical
registry가 아직 승인하지 않았으므로 기존 `license:check` 통과를 데스크톱
바이너리 승인으로 해석하면 안 됩니다.

### FFmpeg와 ffprobe

현재 개발 패키지는 `eugeneware/ffmpeg-static`의 `b6.1.1` 대상별 executable과
해당 release의 `FFMPEG-LICENSE.txt`를 함께 준비합니다. 그러나 공개 배포 전에는
각 대상에서 실제 `ffmpeg -version`, `ffprobe -version`, `ffmpeg -buildconf`,
linked library와 codec 구성을 증거로 남겨 LGPL/GPL 적용 범위를 확정해야 합니다.

`--enable-nonfree`가 발견되면 해당 바이너리의 자동 공개 배포를 차단합니다.
GPL component가 활성화된 경우에는 그 실제 조건에 맞는 전체 고지·대응 소스 또는
source offer를 준비해야 합니다. `FFMPEG-LICENSE.txt` 한 파일만 존재한다는 사실은
이 검토를 대체하지 않습니다.

- FFmpeg legal and license considerations: https://ffmpeg.org/legal.html
- 개발 artifact provenance:
  https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1

### yt-dlp standalone

대상별 official standalone artifact의 URL, 바이트 수와 SHA-256은
`src/desktop/tool-manifest.ts`에 고정되어 있습니다. yt-dlp 본체는 Unlicense지만
standalone 실행 파일에 포함된 Python runtime, yt-dlp-ejs와 그 밖의 embedded
component 고지·라이선스를 실제 대상별 바이너리에서 다시 수집해야 합니다.
기존 Linux Unix zipimport용 고지를 standalone 패키지에 그대로 재사용하지
않습니다.

- yt-dlp license: https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/LICENSE
- release artifacts: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04

## 서명·공증과 배포 형식

macOS 공개 배포에는 최소한 Developer ID Application 서명, hardened runtime,
필요한 최소 entitlement, 모든 nested executable·dylib·FFmpeg·ffprobe·yt-dlp
sidecar 서명, Apple notarization과 ticket staple이 필요합니다. 최종 산출물은
`codesign --verify --deep --strict`, `spctl --assess --type execute`와
`stapler validate`를 통과해야 합니다.

Windows 공개 배포에는 앱과 native sidecar의 Authenticode 서명, 신뢰할 수 있는
timestamp와 최종 서명 검증이 필요합니다. 서명은 SmartScreen reputation을 즉시
보장하지 않으므로 새 사용자 계정의 실제 설치·실행 경고도 별도로 검사합니다.

또한 현재 `taskkill /T /F` 경계는 helper 종료와 leader PID 소멸을 bounded하게
검증하지만, 이미 reparent된 descendant와 PID 재사용 identity까지 증명하지는
못합니다. 따라서 Windows 공개 바이너리는 native
`CreateJobObject`/`AssignProcessToJobObject`와
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`를 적용하고, 정상 종료·취소·timeout·강제
종료 각각에서 descendant orphan이 없다는 실제 Windows 회귀 테스트를 통과할
때까지 fail closed합니다.

Linux 공개 배포 형식을 정한 뒤에는 파일 manifest·SHA-256·SBOM·provenance와
선택한 패키지 형식의 서명·검증 절차를 함께 제공해야 합니다.

Electron도 Windows와 macOS에 배포할 앱은 코드 서명을 권고하며, macOS 외부
배포에는 서명 뒤 공증 단계가 필요하다고 설명합니다:
https://www.electronjs.org/docs/latest/tutorial/code-signing

## 공개 release 승인 체크

다음 항목은 하나라도 미완료이면 fail closed합니다.

- [ ] Electron 플랫폼 archive의 immutable URL·크기·SHA-256과 upstream checksum을
  release manifest에 고정했다.
- [ ] Electron/Chromium/Node와 전체 packaged file의 SBOM·license·copyright·
  대응 고지를 최종 산출물에 포함했다.
- [ ] FFmpeg·ffprobe 대상별 version/buildconf/link evidence를 저장하고
  `--enable-nonfree`가 없음을 자동 확인했다.
- [ ] FFmpeg의 실제 LGPL/GPL 조건에 맞는 원문·대응 소스 또는 source offer를
  최종 산출물과 같은 release에서 제공했다.
- [ ] yt-dlp standalone의 대상별 embedded component 인벤토리와 고지를 포함했다.
- [ ] `npm run license:check`가 Electron packaging dependency와 세 sidecar의 실제
  재배포 경계를 canonical registry로 검사한다.
- [ ] Linux x64·Windows x64·macOS arm64 native CI에서 같은 commit의 typecheck,
  unit test, package 검증과 packaged-runtime liveness smoke를 통과했다.
- [ ] 지원한다고 표시할 각 OS·architecture에서 실제 Player Bridge, VOD 부분
  준비, 컷 편집, 내보내기, 종료와 orphan-process 회귀를 통과했다.
- [ ] macOS 앱과 모든 nested code를 서명·공증·staple한 뒤 Gatekeeper 검증을
  통과했다.
- [ ] Windows 앱과 모든 native sidecar를 서명·timestamp한 뒤 새 사용자 환경에서
  검증했다.
- [ ] Windows에서 모든 외부 미디어 도구를 native Job Object에 원자적으로 묶고
  `KILL_ON_JOB_CLOSE`와 실제 orphan-process 회귀를 검증했다.
- [ ] 최종 installer/archive의 digest, signing identity, timestamp/notarization
  request와 검증 로그를 release record에 남겼다.

CI에서 unsigned package가 만들어졌다는 사실, 버전과 SHA-256을 핀했다는 사실,
또는 개발 PC에서 실행됐다는 사실만으로 위 항목을 완료 처리하지 않습니다.
