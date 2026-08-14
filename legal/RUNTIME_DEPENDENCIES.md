# Local runtime dependencies and verified downloads

KirinukiHelper의 로컬 companion이 사용하는 파일과 시스템 경계를 정리합니다.
이 문서는 설치 가시성과 향후 웹/컨테이너 설계를 위한 기록이지 설치된 모든
운영체제 패키지에 대한 법률 의견이나 무위험 보증이 아닙니다.

## 다운로드 불변 조건

runtime installer는 사용자별 XDG 데이터 디렉터리만 사용합니다. 아래
artifact는 HTTPS URL, 정확한 바이트 수, SHA-256이 **모두** 맞아야 채택합니다.
검증 실패 시 fail closed하며 floating `latest`, shell plugin, 사용자 yt-dlp
config 또는 쿠키로 폴백하지 않습니다.

<!-- attribution-id: yt-dlp -->
### yt-dlp 2026.07.04

- Artifact: official Unix zipimport `yt-dlp`
- URL:
  `https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp`
- Size: `3071553`
- SHA-256:
  `495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd`
- Upstream/license: https://github.com/yt-dlp/yt-dlp — Unlicense

이 exact artifact의 JavaScript solver에는 다음 header가 들어 있습니다.

- yt-dlp-ejs 0.8.0 — Unlicense — https://github.com/yt-dlp/ejs
- Meriyah 6.1.4 — ISC — https://github.com/meriyah/meriyah
- Astring 1.9.0 — MIT — https://github.com/davidbonnet/astring

artifact를 그대로 설치하는 현재 경로에서는 embedded header도 그대로
보존됩니다. 향후 압축 해제·재번들·일부 파일 추출 시 ISC/MIT 원문과 저작권
고지를 함께 옮기는 별도 gate가 필요합니다.

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

setup은 source를 보존하고 `whisper-server`를 로컬 빌드합니다. 서버 또는
컨테이너를 나중에 배포할 때는 최상위 MIT만 확인하고 끝내지 않습니다.
실제 build/link 산출물에서 다음 embedded source를 추적합니다.

| Component | License signal in pinned source | Required release action |
| --- | --- | --- |
| ggml | MIT | ggml/whisper notice와 실제 backend 목록 보존 |
| cpp-httplib | MIT | `examples/server/httplib.h` 저작권·허가 고지 보존 |
| nlohmann/json | MIT | `examples/json.hpp` SPDX/허가 고지 보존 |
| stb_vorbis | MIT 또는 public domain/Unlicense | 선택한 조건과 파일 끝 license 보존 |
| miniaudio | MIT-0 또는 public domain/Unlicense | 선택한 조건과 파일 끝 license 보존 |

소스 archive 안에 존재하는 것과 실제 서버 binary에 들어가는 것은 같지 않을
수 있습니다. 따라서 배포 gate는 컴파일 옵션, link map/동적 라이브러리,
생성 binary와 함께 검사합니다.

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

Revision `5359861c739e955e79d9a303bcbc70fb988958b1`; model lineage and
license reference: https://github.com/openai/whisper (MIT).

<!-- attribution-id: silero-vad -->
### Silero VAD 6.2 conversion

- Artifact: `ggml-silero-v6.2.0.bin`
- URL:
  `https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin`
- Size: `885098`
- SHA-256:
  `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`
- Original upstream/license: https://github.com/snakers4/silero-vad — MIT

## 시스템 의존성 — 현재 재배포하지 않음

<!-- attribution-id: ffmpeg -->
### FFmpeg

- Detection: `ffmpeg -version`, `ffmpeg -buildconf`
- License depends on build: **yes**
- Redistribution today: **no**

<!-- attribution-id: ffprobe -->
### ffprobe

- Detection: `ffprobe -version`, `ffmpeg -buildconf`
- License depends on build: **yes**
- Redistribution today: **no**

FFmpeg와 ffprobe는 같은 build family로 취급하되 binary별 정보를 남깁니다.
LGPL/GPL 여부, enabled codecs와 외부 library가 build마다 다릅니다.

<!-- attribution-id: nodejs -->
### Node.js 22+

- Detection: `node --version`, `node -p process.versions`
- License depends on distributed build/components: **yes**
- Redistribution today: **no**

<!-- attribution-id: python -->
### Python 3.11+

- Detection: `python3 --version`
- License depends on distributed build/components: **yes**
- Redistribution today: **no**

<!-- attribution-id: chromium -->
### Chromium/Chrome/ChromeDriver

- Detection: browser `--version`, `chromedriver --version`
- License depends on provider/build/components: **yes**
- Redistribution today: **no**

## 로컬 companion npm runtime·개발 도구·외부 서비스 경계

<!-- attribution-id: tsx-runtime -->
`tsx` 4.23.1(MIT), `esbuild` 0.28.1과 현재 OS platform package(MIT),
macOS의 optional `fsevents` 2.3.3(MIT)는 현재 TypeScript companion CLI를
실행하는 runtime입니다. `package-lock.json`에 고정되며 저장소 로컬
`node_modules` 경계에서 실행하지만 web 정적 ZIP이나 최소 streaming companion에는
들어가지 않습니다. Upstream: https://github.com/privatenumber/tsx

<!-- attribution-id: typescript-toolchain -->
TypeScript 5.9.3과 `@types`/undici-types는 `package-lock.json`으로 고정한
development/build-only 패키지이며 web 정적 ZIP이나 최소 streaming companion에는
넣지 않습니다.

<!-- attribution-id: github-actions-ci -->
GitHub-hosted CI의 checkout/setup-node/setup-chrome Actions는 제품 runtime이
아니며 `.github/workflows/typescript-quality.yml`에서만 full commit SHA로
실행합니다. 정확한 대응 소스와 MIT 경계는
`legal/OPEN_SOURCE_INVENTORY.md`에 기록합니다.

<!-- attribution-id: chzzk-service -->
CHZZK, <!-- attribution-id: youtube-service --> YouTube,
<!-- attribution-id: soop-service --> SOOP은 외부 서비스·상표 참조입니다.
서비스 페이지 접근, 콘텐츠 권리와 약관은 runtime 오픈소스 라이선스와 별도
gate입니다.

## 웹/컨테이너 전환 시 분류 변경

현재 “system-provided”나 “runtime-downloaded”라는 말은 미래 배포에도 자동
유지되지 않습니다. Docker image, serverless layer, CDN cache, desktop bundle,
installer 또는 자체 mirror에 artifact를 넣는 순간 **재배포**로 다시 분류하고
source offer/notice/license/SBOM을 산출물과 함께 준비해야 합니다.
