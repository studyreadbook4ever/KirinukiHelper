# Kirinuki 런타임 의존성과 배포 경계

Kirinuki의 제품 구조는 **공개 정적 웹 편집기 + 사용자가 한 번 설치하는 화면 없는
로컬 미디어 엔진**입니다. 공개 서버는 VOD 바이트, 프로젝트, 로그인, 세션,
telemetry 또는 analytics를 처리하지 않습니다. 브라우저 확장 프로그램과 Electron
편집기 창은 현재 제품 경계가 아닙니다.

이 문서는 실제 파일이 어느 산출물에 들어가는지와 공개 배포 전에 남은 검증을
구분하는 공학적 기록입니다. 법률 자문이나 무위험 보증이 아닙니다.

## 산출물별 경계

| 산출물 | 포함하는 것 | 포함하지 않는 것 |
| --- | --- | --- |
| `kirinuki-web-v*.zip` | 전체 시작 화면·편집기·worker·글꼴·웹 고지 | 로컬 엔진, FFmpeg, yt-dlp, Electron, 서버 세션 |
| Windows x64 NSIS | 화면 없는 Electron 엔진과 target sidecar | 웹 편집기 창, 브라우저 확장, 자동 업데이트 |
| macOS arm64 DMG | 화면 없는 Electron 엔진과 target sidecar | 웹 편집기 창, 브라우저 확장, 자동 업데이트 |
| Linux x64 deb | 화면 없는 Electron 엔진과 target sidecar | 웹 편집기 창, 브라우저 확장, 자동 업데이트 |
| 저장소 전용 source-run 경로 | 고정 npm 설치와 선택적 로컬 도구 | 일반 사용자용 공개 설치 계약 |

설치 파일 이름은 `Kirinuki-Engine-windows-x64-setup.exe`,
`Kirinuki-Engine-macos-arm64.dmg`, `Kirinuki-Engine-linux-x64.deb`로 고정합니다.
세 설치기는 아직 unsigned·unnotarized 개발 산출물이며
[`DESKTOP_BINARY_RELEASE_GATE.md`](DESKTOP_BINARY_RELEASE_GATE.md)가 닫히기 전에는
공개 Release로 배포하지 않습니다.

## 공개 웹 편집기

<!-- attribution-id: mediabunny -->
Mediabunny 1.51.0(MPL-2.0),
<!-- attribution-id: audseg -->
AudSeg browser port 0.1.0(MIT),
<!-- attribution-id: pretendard -->
Pretendard ExtraBold 1.3.9(OFL-1.1),
<!-- attribution-id: paperlogy -->
Paperlogy 8 ExtraBold 1.001(OFL-1.1)가 정적 웹 ZIP에 포함됩니다. 파일별 hash,
라이선스 원문과 대응 소스는 [`WEB_THIRD_PARTY_NOTICES.md`](WEB_THIRD_PARTY_NOTICES.md)
및 [`OPEN_SOURCE_INVENTORY.md`](OPEN_SOURCE_INVENTORY.md)가 고정합니다.

사용자의 Chrome/Chromium은 운영체제가 제공합니다. 첫 연결에서 브라우저가 Local
Network Access를 물을 수 있지만, 이후 `https://kirinuki.eff0rtchung.kr`이 정확한
loopback 엔진을 자동 감지합니다. 사용자가 포트·endpoint·프로세스를 구성하는
UI는 제품에 두지 않습니다.

## 화면 없는 로컬 미디어 엔진 설치기

<!-- attribution-id: desktop-local-engine-runtime -->
엔진은 Electron 43.4.1을 **UI shell이 아니라 background runtime**으로 사용합니다.
빌드 입력은 `electron-builder@26.15.3`, `@electron/asar@4.2.1`,
`@electron/packager@20.3.0`, `@electron/fuses@2.1.3`과 exact lockfile입니다.
설치 후 운영체제 로그인 시 화면 없이 시작하며 loopback에만 bind합니다.

각 설치기는 `src/desktop/tool-manifest.ts`에 고정된 다음 target용 파일도
포함합니다.

- FFmpeg·ffprobe `n8.1.2`, Shaka distribution tag `n8.1.2-1`
- yt-dlp `2026.07.04` official standalone executable
- 해당 FFmpeg license 파일

URL·바이트·SHA-256 검증은 패키징 전에 수행합니다. 그러나 hash가 맞는다는 사실은
공개 배포 승인이 아닙니다. Electron/Chromium/Node와 installer 전체 SBOM,
FFmpeg buildconf·linked component·대응 소스, yt-dlp standalone의 Python/EJS 등
embedded component 고지, Windows Authenticode, macOS Developer ID 서명·hardened
runtime·notarization·staple이 아직 release hard gate입니다.

엔진은 업데이트 확인, 광고, telemetry 또는 analytics를 위해 독자적인 외부
요청을 하지 않습니다. 원본 VOD URL을 받았을 때 필요한 범위만 원본 플랫폼에서
직접 준비합니다. 공개 Kirinuki 서버를 VOD proxy로 사용하지 않습니다.

## 저장소 전용으로 검증해 내려받는 runtime

아래 항목은 현재 공개 웹 ZIP이나 세 OS installer의 구성요소라고 주장하지
않습니다. 저장소에서 source-run·선택적 로컬 자막 경로를 실행할 때만 HTTPS URL,
정확한 바이트 수와 SHA-256을 모두 검증해 사용자별 로컬 디렉터리에 채택합니다.
floating `latest`, 임의 mirror, cookie 또는 사용자 설정으로 검증을 우회하지
않습니다.

<!-- attribution-id: yt-dlp -->
### yt-dlp Unix zipimport 2026.07.04

- Artifact: `yt-dlp`
- URL: https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp
- Size: `3071553`
- SHA-256: `495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd`
- Upstream: https://github.com/yt-dlp/yt-dlp — Unlicense

이 파일에는 yt-dlp-ejs 0.8.0(Unlicense), Meriyah 6.1.4(ISC), Astring
1.9.0(MIT)의 고지가 포함됩니다. installer에 들어가는 target별 standalone과는
별개의 artifact이므로 고지를 서로 대체하지 않습니다.

<!-- attribution-id: whisper-cpp -->
### whisper.cpp v1.8.6 source

- Artifact: `whisper.cpp-v1.8.6.tar.gz`
- URL: https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/23ee03506a91ac3d3f0071b40e66a430eebdfa1d
- Size: `8846418`
- SHA-256: `c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032`
- Upstream: https://github.com/ggml-org/whisper.cpp — MIT

source-run Whisper는 이 기기에서 `whisper-server`를 빌드합니다. binary를 다른
사용자에게 배포하려면 실제 link 결과를 기준으로 ggml, cpp-httplib,
nlohmann/json, stb_vorbis, miniaudio와 활성 backend를 다시 inventory해야 합니다.

<!-- attribution-id: openai-whisper-models -->
### Quantized Whisper models

Revision `5359861c739e955e79d9a303bcbc70fb988958b1`, upstream
https://huggingface.co/ggerganov/whisper.cpp 입니다.

| Artifact | URL | Size | SHA-256 |
| --- | --- | ---: | --- |
| `ggml-tiny-q5_1.bin` | https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny-q5_1.bin | `32152673` | `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7` |
| `ggml-base-q5_1.bin` | https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin | `59707625` | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |
| `ggml-small-q5_1.bin` | https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin | `190085487` | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| `ggml-medium-q5_0.bin` | https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium-q5_0.bin | `539212467` | `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` |

Model lineage: https://github.com/openai/whisper — MIT.

<!-- attribution-id: silero-vad -->
### Silero VAD 6.2 conversion

- Artifact: `ggml-silero-v6.2.0.bin`
- URL: https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin
- Size: `885098`
- SHA-256: `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`
- Upstream: https://github.com/snakers4/silero-vad — MIT

## 시스템 제공·저장소 실행 경계

아래 `system-provided` 분류는 개발/source-run 경로에만 적용됩니다. 세 OS 엔진
installer가 포함하는 Electron·FFmpeg·ffprobe·yt-dlp에는 적용되지 않습니다.

<!-- attribution-id: ffmpeg -->
- **FFmpeg** — `ffmpeg -version`, `ffmpeg -buildconf`로 감지. 실제 build에 따라
  라이선스가 달라집니다. https://ffmpeg.org/
<!-- attribution-id: ffprobe -->
- **ffprobe** — `ffprobe -version`과 같은 build family를 확인합니다.
  https://ffmpeg.org/ffprobe.html
<!-- attribution-id: nodejs -->
- **Node.js 22.17.0+** — 저장소 CLI/build host입니다. https://github.com/nodejs/node
<!-- attribution-id: python -->
- **Python 3.11+** — source-run yt-dlp zipimport host입니다. https://www.python.org/
<!-- attribution-id: chromium -->
- **Chrome/Chromium/ChromeDriver** — 사용자의 웹 편집기와 E2E host입니다.
  https://www.chromium.org/chromium-projects/

이들을 installer, container 또는 archive에 새로 포함하면 해당 binary 전체
license와 notices를 다시 조사합니다. Whisper source build의 C/C++ compiler,
CMake, CUDA toolkit과 실제 linked library도 release 인벤토리로 간주하지 않고
재현 가능한 배포 증거를 별도로 만들어야 합니다.

<!-- attribution-id: tsx-runtime -->
저장소 TypeScript 엔진은 exact `package-lock.json`의 tsx 4.23.1, esbuild 0.28.1,
OS별 esbuild package와 optional fsevents 2.3.3을 repository-local
`node_modules`에서 실행합니다. 공개 웹 ZIP에는 포함되지 않습니다.
Upstream: https://github.com/privatenumber/tsx

<!-- attribution-id: typescript-toolchain -->
TypeScript 5.9.3, `@types/node` 20.19.43, `undici-types` 6.21.0은 build-only입니다.
Upstream: https://github.com/microsoft/TypeScript

<!-- attribution-id: github-actions-ci -->
CI action은 `.github/workflows/typescript-quality.yml`에서만 실행하고 full commit
SHA로 고정합니다. Upstream: https://docs.github.com/actions

## 외부 서비스 경계

<!-- attribution-id: chzzk-service -->
CHZZK(https://chzzk.naver.com/),
<!-- attribution-id: youtube-service -->
YouTube(https://www.youtube.com/),
<!-- attribution-id: soop-service -->
SOOP(https://www.sooplive.co.kr/)은 지원 원본과 상표를 식별하기 위한 참조입니다.
서비스 코드·로고 재배포나 제휴를 뜻하지 않으며, 플랫폼 약관과 사용자의 콘텐츠
권리는 오픈소스 라이선스와 별도로 적용됩니다.

## 출시 불변조건

1. 공개 웹 ZIP과 각 installer의 exact file manifest·digest·SBOM·notice를 따로
   생성합니다.
2. unsigned Windows installer, unsigned·unnotarized macOS DMG, provenance가
   불완전한 Linux deb는 공개하지 않습니다.
3. `--enable-nonfree`가 발견된 FFmpeg 산출물은 자동 배포를 **차단**합니다.
4. 브라우저 확장 또는 별도 편집기 창을 제품 의존성으로 다시 넣으려면 새
   아키텍처·보안·라이선스 검토를 먼저 수행합니다.
5. `npm run license:check`가 통과해도 최종 산출물 SBOM과 사람의 출시 승인을
   대체하지 않습니다.
