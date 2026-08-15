# Kirinuki 런타임 의존성과 배포 경계

이 문서는 Linux v1 소스 설치판에서 무엇을 Kirinuki가 배포하고, 무엇을 설치
중 검증해 내려받으며, 무엇을 사용자의 운영체제가 제공해야 하는지 구분합니다.
라이선스 법률 의견이나 무위험 보증은 아닙니다.

Kirinuki는 사용자 관점에서 앱 하나이지만 현재 모든 실행 파일을 포함한
AppImage가 아닙니다. 편집 화면, 미디어 준비, 자막, 캐시와 내보내기를 하나의 앱
생명주기로 관리한다는 뜻이며, 내부 구현이 단일 프로세스라는 뜻은 아닙니다.
내부 프로세스와 연결 주소는 사용자용 독립 제품이나 관리 대상이 아닙니다.

## 한눈에 보는 경계

| 구분 | 현재 Linux v1 처리 | 사용자에게 필요한 일 |
| --- | --- | --- |
| Kirinuki first-party 소스와 웹 에셋 | Git 저장소와 릴리스 소스에 포함 | `./setup.sh` 1회 실행 |
| npm 런타임·빌드 패키지 | `package-lock.json` 기준으로 설치 시 provision | 네트워크가 필요할 수 있음 |
| yt-dlp | 고정 artifact를 크기와 SHA-256까지 검증해 사용자 데이터 경로에 다운로드 | 별도 명령 없음 |
| whisper.cpp·모델·Silero VAD | Whisper 선택 시에만 고정 artifact를 검증해 다운로드·로컬 빌드 | 설치 화면에서 방식 선택 |
| Node.js 22+·npm·Chromium 120+·Python 3.11+·FFmpeg·ffprobe | 현재 Kirinuki가 재배포하지 않음 | 운영체제에 미리 설치 |
| CMake·tar·C++ 컴파일러 | Whisper를 선택한 경우에만 whisper.cpp 로컬 빌드에 사용하며 재배포하지 않음 | Whisper를 쓸 PC에만 미리 설치 |
| 공개 사이트 | 소개·설치·엄격한 앱 링크만 배포 | 편집은 설치된 앱에서 진행 |

## 저장소 또는 웹 산출물에 포함되는 구성요소

Kirinuki first-party 소스에는 루트 `UNLICENSE`가 적용됩니다. Linux 소스 앱의
browser editor assets에 포함되는 Mediabunny, AudSeg와 글꼴은 각 라이선스
원문과 고지를 함께 배포합니다. 공개 shell ZIP에는 이 editor assets를 넣지
않습니다. exact 파일·해시와 대응 소스는
[`OPEN_SOURCE_INVENTORY.md`](OPEN_SOURCE_INVENTORY.md)와
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)가 canonical 기록입니다.

공개 `kirinuki.eff0rtchung.kr` 산출물은 앱 소개·설치·앱 링크 shell만
포함합니다. 실제 편집 bundle과 앱 내부 엔진은 공개 페이지에서 초기화하거나
연결하지 않습니다. 향후 installer, AppImage, container 또는 CDN artifact에
새 실행 파일을 포함하면 이 문서의 “provisioned/비재배포” 분류를 그대로
재사용할 수 없습니다.

## 설치 중 검증해 내려받는 artifact

설치기는 사용자별 XDG 데이터 디렉터리만 사용합니다. 아래 artifact는 HTTPS
URL, 정확한 바이트 수, SHA-256이 **모두** 일치해야 채택합니다. 검증이 실패하면
중단하며 floating `latest`, 임의 shell plugin, 사용자 yt-dlp 설정, cookie 또는
다른 mirror로 폴백하지 않습니다.

이 파일들은 저장소 소스 ZIP이나 공개 웹 산출물에 미리 포함되지 않습니다.
그러나 Kirinuki 설치기가 내려받아 실행하므로 고지·출처·무결성 기록은 제품
release gate에 포함합니다.

<!-- attribution-id: yt-dlp -->
### yt-dlp 2026.07.04

- Artifact: official Unix zipimport `yt-dlp`
- URL:
  `https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp`
- Size: `3071553`
- SHA-256:
  `495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd`
- Upstream/license: https://github.com/yt-dlp/yt-dlp — Unlicense

이 exact artifact의 JavaScript solver에는 다음 header가 포함됩니다.

- yt-dlp-ejs 0.8.0 — Unlicense — https://github.com/yt-dlp/ejs
- Meriyah 6.1.4 — ISC — https://github.com/meriyah/meriyah
- Astring 1.9.0 — MIT — https://github.com/davidbonnet/astring

artifact를 그대로 설치하는 현재 경로는 embedded header를 보존합니다. 향후
압축 해제·재번들·일부 파일 추출을 한다면 ISC/MIT 원문과 저작권 고지를 함께
옮기는 별도 gate가 필요합니다.

<!-- attribution-id: whisper-cpp -->
### whisper.cpp v1.8.6 source

- Artifact: `whisper.cpp-v1.8.6.tar.gz`
- Commit: `23ee03506a91ac3d3f0071b40e66a430eebdfa1d`
- URL:
  `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/23ee03506a91ac3d3f0071b40e66a430eebdfa1d`
- Size: `8846418`
- SHA-256:
  `c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032`
- Upstream/license: https://github.com/ggml-org/whisper.cpp — MIT

Whisper를 선택하면 source를 보존하고 `whisper-server`를 이 기기에서 빌드합니다.
현재 소스 설치판은 그 binary를 다른 사용자에게 재배포하지 않습니다. 향후
installer/container에 binary를 포함할 때는 실제 compile flags, link map 또는
동적 라이브러리 목록을 기준으로 ggml, cpp-httplib, nlohmann/json, stb_vorbis,
miniaudio와 활성 backend의 라이선스·고지를 다시 판정해야 합니다.

<!-- attribution-id: openai-whisper-models -->
### Quantized Whisper models

공통 prefix:
`https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/`

| Name | Size | SHA-256 |
| --- | ---: | --- |
| [`ggml-tiny-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny-q5_1.bin) | `32152673` | `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7` |
| [`ggml-base-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin) | `59707625` | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |
| [`ggml-small-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin) | `190085487` | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| [`ggml-medium-q5_0.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium-q5_0.bin) | `539212467` | `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` |

Revision `5359861c739e955e79d9a303bcbc70fb988958b1`; model lineage and license
reference: https://github.com/openai/whisper (MIT).

<!-- attribution-id: silero-vad -->
### Silero VAD 6.2 conversion

- Artifact: `ggml-silero-v6.2.0.bin`
- URL:
  `https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin`
- Size: `885098`
- SHA-256:
  `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`
- Original upstream/license: https://github.com/snakers4/silero-vad — MIT

## 운영체제가 제공하는 도구 — 현재 재배포하지 않음

아래 도구는 현재 저장소, 공개 사이트, installer 또는 앱 archive에 포함하지
않습니다. `./setup.sh`가 버전·기능을 진단할 뿐 설치하거나 시스템 설정을
변경하지 않습니다. 사용자는 배포판 패키지 관리자 등 신뢰하는 방법으로 먼저
설치해야 합니다.

Node.js·npm·Chromium·Python·FFmpeg·ffprobe는 모든 자막 방식에 공통인 기본
요구사항입니다. **CMake, tar와 C++ 컴파일러(`g++` 또는 `clang++`)는 Whisper를
선택할 때만 추가로 필요**합니다. 기본 AudSeg 사용에는 이 세 빌드 도구가
필요하지 않습니다.

<!-- attribution-id: nodejs -->
### Node.js 22 이상과 npm

- Detection: `node --version`, `node -p process.versions`, `npm --version`
- License depends on distributed build/components: **yes**
- Redistributed by Kirinuki today: **no**

npm은 현재 Node.js 설치와 함께 시스템에서 provision된 명령을 사용합니다.
향후 Node/npm을 AppImage나 installer에 넣으면 해당 배포본의 전체 라이선스와
bundled component notices를 산출물에 포함해야 합니다.

<!-- attribution-id: python -->
### Python 3.11 이상

- Detection: `python3 --version`
- License depends on distributed build/components: **yes**
- Redistributed by Kirinuki today: **no**

<!-- attribution-id: chromium -->
### Chromium 120 이상

- Detection: browser `--version`
- License depends on provider/build/components: **yes**
- Redistributed by Kirinuki today: **no**

Chrome/ChromeDriver를 포함하는 별도 배포를 만들면 provider와 build별 재배포
조건을 별도로 확인해야 합니다. 현재 제품 실행은 지원되는 시스템 Chromium을
사용하며 Kirinuki 전용 데이터 경계를 앱이 관리합니다.

<!-- attribution-id: ffmpeg -->
### FFmpeg

- Detection: `ffmpeg -version`, `ffmpeg -buildconf`
- License depends on build: **yes**
- Redistributed by Kirinuki today: **no**

<!-- attribution-id: ffprobe -->
### ffprobe

- Detection: `ffprobe -version`, `ffmpeg -buildconf`
- License depends on build: **yes**
- Redistributed by Kirinuki today: **no**

FFmpeg와 ffprobe는 같은 build family로 취급하되 binary별 정보를 남깁니다.
LGPL/GPL 여부, enabled codec, 외부 library와 hardware backend는 배포판 build마다
다릅니다. 향후 Kirinuki 산출물에 넣으면 최종 binary의 `-buildconf`를 기준으로
판정하며 `--enable-nonfree`가 있으면 자동 배포를 차단해야 합니다.

## npm으로 provision되는 앱 런타임과 개발 도구

이 패키지들은 현재 소스 archive에 `node_modules` 형태로 포함하지 않습니다.
`package-lock.json`에 고정하고 설치 시 저장소 로컬 경계에 provision합니다.

<!-- attribution-id: tsx-runtime -->
`tsx` 4.23.1(MIT), `esbuild` 0.28.1과 현재 OS platform package(MIT), macOS의
optional `fsevents` 2.3.3(MIT)는 현재 TypeScript로 작성된 Kirinuki 앱 내부
CLI를 실행합니다. 공개 웹 shell에는 포함하지 않습니다. Upstream:
https://github.com/privatenumber/tsx

향후 미리 컴파일한 앱 패키지로 바꾸면 이 runtime이 최종 산출물에 실제로
남는지 SBOM과 파일 스캔으로 다시 확인합니다.

<!-- attribution-id: typescript-toolchain -->
TypeScript 5.9.3과 `@types`/undici-types는 `package-lock.json`으로 고정한
development/build-only 패키지입니다. 공개 웹 shell 또는 현재 사용자용 실행
archive에 별도 패키지로 재배포하지 않습니다.

<!-- attribution-id: github-actions-ci -->
GitHub-hosted CI의 checkout/setup-node/setup-chrome Actions는 제품 runtime이
아닙니다. `.github/workflows/typescript-quality.yml`에서 full commit SHA로만
실행하며 정확한 대응 소스와 MIT 경계는
[`OPEN_SOURCE_INVENTORY.md`](OPEN_SOURCE_INVENTORY.md)에 기록합니다.

## 외부 서비스와 상표

<!-- attribution-id: chzzk-service -->
CHZZK, <!-- attribution-id: youtube-service --> YouTube,
<!-- attribution-id: soop-service --> SOOP은 외부 서비스·상표 참조이며 Kirinuki가
재배포하는 소프트웨어 의존성이 아닙니다. 서비스 페이지 접근, 콘텐츠 권리,
다운로드·편집·게시 권한과 플랫폼 약관은 오픈소스 라이선스와 별도의 release
gate입니다. Kirinuki는 공식 제휴나 승인을 주장하지 않습니다.

## 향후 독립 패키지로 전환할 때

현재 “system-provided”, “설치 시 provision” 또는 “검증 후 다운로드”라는 분류는
미래 배포에도 자동으로 유지되지 않습니다. Docker image, server layer, CDN,
desktop bundle, AppImage, deb/rpm, installer 또는 자체 mirror에 artifact를 넣는
순간 **재배포**로 다시 분류합니다.

독립 패키지를 출시하기 전에는 최소한 다음을 완료해야 합니다.

1. 최종 산출물과 모든 transitive file의 SBOM을 생성합니다.
2. Node.js·npm·Python·Chromium·FFmpeg·ffprobe의 실제 포함 여부와 build 옵션을
   검사합니다.
3. 각 라이선스 원문, 저작권 고지, 대응 소스 또는 source offer를 산출물과 함께
   제공합니다.
4. artifact별 immutable URL, 바이트 수와 SHA-256을 release evidence에
   보관합니다.
5. 공개 웹 shell과 로컬 앱 패키지의 고지 범위를 혼합하지 않습니다.
