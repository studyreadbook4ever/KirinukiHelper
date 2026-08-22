# Third-party notices — public web editor and local media engine

이 문서는 Kirinuki 소스 저장소, 공개 full web editor, 저장소 전용 검증 다운로드,
Windows x64·macOS arm64·Linux x64의 로컬 엔진 installer에 관계된 전체
고지입니다. 웹 ZIP의 더 좁은 고지는 `web/THIRD_PARTY_NOTICES.md`를 기준으로
합니다. ASAR에 고정되는 플레이어 제어 코드는 Kirinuki가 직접 작성했으며
아래 제3자 구성요소를 추가하지 않습니다. Electron full editor, 외부 Chrome 확장,
별도 player-action resource는 제품 산출물이 아닙니다.

Kirinuki 프로젝트가 직접 작성한 코드는 루트 `UNLICENSE`에 따라 퍼블릭 도메인에
헌정됩니다. 공개 웹 ZIP에는 같은 원문을 `web/licenses/UNLICENSE.txt`로
싣습니다. 아래 구성요소는 그 헌정 대상이 아니며
각각의 라이선스와 저작권 고지를 유지합니다. 인벤토리와 자동 검사는 법률 자문이나 법적 무위험 보증이
아닙니다. 실제 web·local engine·container 배포 산출물은 출시 때 다시 감사해야
합니다.

로컬 엔진 installer 관련 절은 아직 공개 바이너리용 완결 고지가 아닙니다. 최종
Electron/Chromium/Node SBOM, FFmpeg build별 조건과 yt-dlp standalone embedded
component 검토와 OS signing이 끝나지 않았으므로 installer를 외부에 배포하지
않습니다.

## 공개 웹 편집기에 포함되는 browser assets

<!-- attribution-id: mediabunny -->
### Mediabunny 1.51.0

- Copyright © 2026-present Vanilagy and contributors
- License: Mozilla Public License 2.0 (`MPL-2.0`)
- Upstream: https://github.com/Vanilagy/mediabunny
- Exact corresponding source:
  https://registry.npmjs.org/mediabunny/-/mediabunny-1.51.0.tgz
- npm integrity:
  `sha512-u327374xU8Ho0gCaMII7fUK8t0PnqkabCox1k8uUwvgvGb9o6YQGZEG2Qr4DTe7nTMpzfL7ukgnHDvDROySZ+Q==`
- Distributed license: `web/licenses/MEDIABUNNY-MPL-2.0.txt`
- License file size: `16726` bytes
- License SHA-256:
  `3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04`

Mediabunny는 브라우저의 로컬 미디어 read/encode/mux 경로에 사용됩니다.
upstream 코드는 로컬 patch 없이 번들되며, MPL-2.0 대응 소스는 위의 고정
npm source package에서 받을 수 있습니다.

<!-- attribution-id: audseg -->
### AudSeg browser port 0.1.0

- Copyright © 2026 AudSeg contributors
- License: MIT
- Source: `AudSeg/` and `src/editor/audseg.ts`
- Corresponding source:
  https://github.com/studyreadbook4ever/KirinukiHelper/tree/eef841a336613fe8fe825ab231d9bbe770751ee2/AudSeg
- Distributed license: `web/licenses/AUDSEG-MIT.txt`
- License file size: `1076` bytes
- License SHA-256:
  `e492735a5732fcd497ce6854a6ee09ff7ff6a27977d5e54b2269a60788a98e25`

별도 MIT 라이선스인 Python 알고리즘을 TypeScript로 port했습니다. 소스의
`@license` 주석은 esbuild의 `legalComments: "eof"`를 통해 컴파일된
`web/editor/editor.js`와 `web/editor/audseg-worker.js`에도 남습니다.

<!-- attribution-id: pretendard -->
### Pretendard ExtraBold 1.3.9

- Copyright © 2021 Kil Hyung-jin
- License: SIL Open Font License 1.1 (`OFL-1.1`)
- Reserved Font Name: Pretendard
- Upstream: https://github.com/orioncactus/pretendard/tree/v1.3.9
- Font: `web/editor/fonts/Pretendard-ExtraBold.woff2`
- Font size: `793540` bytes
- Font SHA-256:
  `dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3`
- License: `web/licenses/PRETENDARD-OFL-1.1.txt`
- License size: `4418` bytes
- License SHA-256:
  `d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04`

<!-- attribution-id: paperlogy -->
### Paperlogy 8 ExtraBold 1.001

- Copyright © 2024 The PAPERLOGY Authors
- License: SIL Open Font License 1.1 (`OFL-1.1`)
- Official project: https://freesentation.blog/paperlogyfont
- Pinned commit: `8ef35f53b318c7ca914c52b1b382b9a8bad07a61`
- Upstream:
  https://github.com/Freesentation/paperlogy/tree/8ef35f53b318c7ca914c52b1b382b9a8bad07a61
- Font: `web/editor/fonts/Paperlogy-8ExtraBold.woff2`
- Font size: `430124` bytes
- Font SHA-256:
  `5047db061c39ec5ed5c9d0b71c7aaad4b9547ed15ce48d1cd74090169f132bc0`
- License: `web/licenses/PAPERLOGY-OFL-1.1.txt`
- License size: `4380` bytes
- License SHA-256:
  `603b2e7ef9effb9037b0b67f0530cacdc05e71a4e569032d7e4d98c2e6763135`

두 WOFF2 모두 표시한 upstream revision의 파일을 수정 없이 포함합니다.

## 저장소 전용 source-run 경로가 검증해 내려받는 runtime

아래 파일은 공개 웹 ZIP이나 세 OS 로컬 엔진 installer의 구성요소라고 주장하지
않습니다. 저장소 전용 source-run·선택적 로컬 자막 setup은 HTTPS URL, 바이트
수와 SHA-256을 모두 고정하고, 검증에 실패하면 설치하지 않습니다.
설치 위치와 운영 방식은 `legal/RUNTIME_DEPENDENCIES.md`를 확인하세요.

<!-- attribution-id: whisper-cpp -->
### whisper.cpp v1.8.6

- Copyright © 2023-2026 The ggml authors
- License: MIT
- Upstream: https://github.com/ggml-org/whisper.cpp
- Commit: `23ee03506a91ac3d3f0071b40e66a430eebdfa1d`
- Artifact: `whisper.cpp-v1.8.6.tar.gz`
- URL:
  https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/23ee03506a91ac3d3f0071b40e66a430eebdfa1d
- Size: `8846418` bytes
- SHA-256:
  `c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032`
- License source:
  https://github.com/ggml-org/whisper.cpp/blob/23ee03506a91ac3d3f0071b40e66a430eebdfa1d/LICENSE

현재 setup은 이 source archive에서 `whisper-server`를 로컬 빌드합니다.
archive와 서버 빌드에는 적어도 다음 upstream 또는 vendored 소스가 관련될 수
있으므로, 완성된 바이너리를 배포할 때 실제 build/link 결과와 헤더 안의
고지를 다시 수집해야 합니다.

- ggml — `source at pinned whisper.cpp commit` — MIT —
  https://github.com/ggml-org/ggml
- cpp-httplib — `vendored header at pinned whisper.cpp commit` — MIT —
  https://github.com/yhirose/cpp-httplib
- nlohmann/json — `vendored header at pinned whisper.cpp commit` — MIT —
  https://github.com/nlohmann/json
- stb_vorbis — `vendored source at pinned whisper.cpp commit` —
  `MIT-or-Unlicense` 선택지 —
  https://github.com/nothings/stb
- miniaudio — `vendored header at pinned whisper.cpp commit` —
  `MIT-0-or-Unlicense` 선택지 —
  https://github.com/mackron/miniaudio

이 목록은 “archive 전체가 서버에 링크된다”는 뜻이 아닙니다. 반대로 최상위
whisper.cpp MIT 한 줄만으로 향후 배포 바이너리의 모든 embedded 의무가
끝난다고 가정해서도 안 됩니다. 서버 바이너리·동적 라이브러리·활성 backend를
릴리스 산출물 그대로 감사하는 것이 배포 gate입니다.

<!-- attribution-id: openai-whisper-models -->
### Quantized OpenAI Whisper models for whisper.cpp

- Copyright © 2022 OpenAI
- License: MIT
- Converted model repository: https://huggingface.co/ggerganov/whisper.cpp
- Pinned revision: `5359861c739e955e79d9a303bcbc70fb988958b1`
- Original source and license: https://github.com/openai/whisper

| Artifact | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| [`ggml-tiny-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny-q5_1.bin) | `32152673` | `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7` |
| [`ggml-base-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin) | `59707625` | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |
| [`ggml-small-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin) | `190085487` | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| [`ggml-medium-q5_0.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium-q5_0.bin) | `539212467` | `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` |

각 URL은 다음 고정 prefix와 artifact 이름을 결합합니다.

`https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/`

<!-- attribution-id: silero-vad -->
### Silero VAD 6.2 converted for whisper.cpp

- Copyright © 2020-present Silero Team
- License: MIT
- Original project: https://github.com/snakers4/silero-vad
- Converted repository: https://huggingface.co/ggml-org/whisper-vad
- Pinned revision: `9ffd54a1e1ee413ddf265af9913beaf518d1639b`
- Artifact: `ggml-silero-v6.2.0.bin`
- URL:
  https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin
- Size: `885098` bytes
- SHA-256:
  `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`

<!-- attribution-id: yt-dlp -->
### yt-dlp Unix zipimport executable 2026.07.04

- License: Unlicense
- Upstream: https://github.com/yt-dlp/yt-dlp
- License source:
  https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/LICENSE
- Official artifact: `yt-dlp`
- URL:
  https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp
- Size: `3071553` bytes
- SHA-256:
  `495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd`

이 exact zipimport artifact에는 YouTube JavaScript challenge 처리를 위한
`yt-dlp-ejs` 0.8.0(Unlicense)가 포함됩니다. 그 생성된 JavaScript header가
다음 bundled dependencies와 라이선스 원문을 함께 보존합니다.

- Meriyah 6.1.4 — ISC — Copyright (c) 2019 and later, KFlash and others —
  https://github.com/meriyah/meriyah
- Astring 1.9.0 — MIT — Copyright (c) 2015 David Bonnet —
  https://github.com/davidbonnet/astring
- yt-dlp-ejs 0.8.0 — Unlicense — https://github.com/yt-dlp/ejs

Meriyah의 ISC 조건은 저작권·허가 고지를 모든 사본에 보존하는 것이고,
Astring의 MIT 조건은 저작권·허가 고지를 소프트웨어의 모든 사본 또는 상당
부분에 포함하는 것입니다. 공식 zipimport 안의 `lib.min.js` header에 두
원문이 들어 있지만, 재패키징하거나 분리 배포할 때 해당 header를 제거하면
안 됩니다.

## 로컬 엔진 installer에 들어가는 구성요소

이 절은 현재 개발 package의 차이를 드러내기 위한 inventory이며 공개 배포
승인이 아닙니다. 대상별 정확한 도구 URL·바이트·SHA-256은
`src/desktop/tool-manifest.ts`, 공개 차단 조건은
`legal/DESKTOP_BINARY_RELEASE_GATE.md`를 기준으로 합니다.

<!-- attribution-id: desktop-local-engine-runtime -->
### Electron 43.4.1 background runtime

- Electron source license: MIT
- Source and license: https://github.com/electron/electron/tree/v43.4.1
- npm package: `electron@43.4.1`
- npm source artifact:
  https://registry.npmjs.org/electron/-/electron-43.4.1.tgz

Electron runtime에는 Chromium, Node.js와 다수의 제3자 구성요소가 포함됩니다.
최종 패키지의 Electron `LICENSE`와 `LICENSES.chromium.html`을 보존하고 실제
플랫폼 archive의 hash와 packaged-file SBOM을 대조해야 합니다. 현재 버전 핀만으로
그 검토가 끝난 것으로 간주하지 않습니다.

### Electron packaging toolchain

- `electron-builder@26.15.3` — MIT, build-only transitive licenses 별도 gate —
  https://github.com/electron-userland/electron-builder
- `@electron/asar@4.2.1` — MIT —
  https://github.com/electron/asar
- `@electron/packager@20.3.0` — BSD-2-Clause —
  https://github.com/electron/packager
- `@electron/fuses@2.1.3` — MIT —
  https://github.com/electron/fuses

이 패키지들은 build dependency이며 최종 engine runtime에 npm package 그대로 넣지
않습니다. 전체 transitive lockfile inventory와 canonical positive allowlist
검토는 아직 완료되지 않았습니다.

### FFmpeg·ffprobe n8.1.2 static sidecars

- Distribution project/tag:
  https://github.com/shaka-project/static-ffmpeg-binaries/releases/tag/n8.1.2-1
- FFmpeg upstream: https://ffmpeg.org/
- Legal guidance: https://ffmpeg.org/legal.html

현재 installer stage는 대상별 executable과 canonical GPLv3 원문인
`FFMPEG-LICENSE.txt`를 포함합니다. 최종 `-version`, `-buildconf`와 link evidence를 수집하고
`--enable-nonfree`가 없음을 확인하며 적용 조건에 맞는 라이선스 원문·대응 소스
또는 source offer를 제공하기 전에는 공개 배포하지 않습니다.

### yt-dlp 2026.07.04 standalone sidecar

- License: Unlicense
- Source and license:
  https://github.com/yt-dlp/yt-dlp/tree/2026.07.04
- Release: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04

저장소 전용 Unix zipimport artifact와 달리 로컬 엔진 installer는 대상별 official
standalone executable을 포함합니다. standalone에 포함된 Python runtime,
yt-dlp-ejs와 그 밖의 embedded component를 대상별로 다시 조사해 고지를
완성하기 전에는 이 절을 최종 배포 notice로 사용하지 않습니다.

### MIT notice for runtime components

- Copyright (c) 2023-2026 The ggml authors
- Copyright (c) 2022 OpenAI
- Copyright (c) 2020-present Silero Team
- Copyright (c) 2015 David Bonnet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 개발/source-run에서 운영체제가 제공하는 도구

<!-- attribution-id: ffmpeg -->
### FFmpeg

`ffmpeg -version`과 `ffmpeg -buildconf`로 감지합니다. 공개 웹 ZIP은 FFmpeg를
재배포하지 않습니다. 로컬 엔진 installer는 위 별도 절의 target sidecar를
포함하므로 이 system-provided 분류를 재사용하지 않습니다. FFmpeg의 정확한
LGPL/GPL 및 외부 라이브러리
의무는 사용한 build configuration에 따라 달라집니다.
Upstream: https://ffmpeg.org/

<!-- attribution-id: ffprobe -->
### ffprobe

`ffprobe -version`과 같은 FFmpeg build 정보를 확인합니다. 공개 웹 ZIP은
재배포하지 않고 로컬 엔진 installer는 위 별도 절의 sidecar를 포함합니다.
라이선스 범위는 실제 FFmpeg build에 따라 달라집니다.
Upstream: https://ffmpeg.org/ffprobe.html

<!-- attribution-id: nodejs -->
### Node.js

`node --version`과 `node -p process.versions`로 감지합니다. 저장소 CLI와 빌드
도구의 host runtime일 뿐 공개 웹 ZIP에는 포함되지 않습니다. Node.js
배포본에는 여러 제3자 라이선스가 있으므로 향후 컨테이너에 넣을 때 해당
배포본의 `LICENSE`를 함께 감사합니다. Upstream: https://github.com/nodejs/node

<!-- attribution-id: python -->
### Python

`python3 --version`으로 감지하며 managed yt-dlp zipimport를 실행합니다.
현재 공개 웹 ZIP에는 포함되지 않습니다. Upstream: https://www.python.org/

<!-- attribution-id: chromium -->
### Chromium / Google Chrome / ChromeDriver

사용자의 공개 웹 편집기와 E2E 검증에 사용하는 외부 브라우저 도구입니다. 공개
웹 ZIP은 재배포하지 않지만 로컬 엔진 installer에는 Electron이 제공하는 별도
Chromium runtime이 포함됩니다. 브라우저 배포본의 정확한 구성과 라이선스는
제공자·build에 따라 달라집니다. Upstream:
https://www.chromium.org/chromium-projects/

## 저장소 전용 엔진 npm runtime

<!-- attribution-id: tsx-runtime -->
저장소의 setup·자막 엔진·VOD 미디어 엔진은 TypeScript CLI를 직접 실행하므로
다음 패키지는 단순 build tool이 아니라 **repository-local runtime**
입니다. `package-lock.json`을 이용해 repository-local `node_modules`에
설치되며 공개 웹 ZIP과 세 OS installer에는 이 npm package 내용이 포함되지
않습니다.
Upstream: https://github.com/privatenumber/tsx

- tsx 4.23.1 — MIT
- esbuild 0.28.1 및 실제 OS platform package — MIT
- fsevents 2.3.3 — MIT, macOS optional dependency

## 개발·build 전용 npm 도구

<!-- attribution-id: typescript-toolchain -->
정확한 artifact URL·integrity는 `package-lock.json`에 고정하며
`npm run license:check`가 승인 목록 밖의 패키지를 거부합니다. 이 패키지는
공개 웹 ZIP이나 로컬 엔진 runtime에 들어가지 않습니다.
TypeScript upstream: https://github.com/microsoft/TypeScript

- TypeScript 5.9.3 — Apache-2.0
- `@types/node` 20.19.43, `undici-types` 6.21.0 — MIT

## CI-only GitHub Actions

<!-- attribution-id: github-actions-ci -->
아래 구성요소는 `.github/workflows/typescript-quality.yml`에서만 실행되며
공개 web·로컬 엔진 산출물에 재배포하지 않습니다. workflow는 mutable
major tag 대신 full commit SHA를 사용합니다. Upstream:
https://docs.github.com/actions

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
  (`v4`) — MIT — 대응 소스·원문:
  https://github.com/actions/checkout/tree/11d5960a326750d5838078e36cf38b85af677262
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
  (`v4`) — MIT — 대응 소스·원문:
  https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020
- `browser-actions/setup-chrome@2e1d749697dd1612b833dba4a722266286fbefcd`
  (`v2.1.2`/`v2`) — MIT — source release commit과 원문:
  https://github.com/browser-actions/setup-chrome/tree/73954683cc80eced513145a42b668b9b91f753c3

## 외부 서비스·상표 참조

아래 이름은 지원하는 외부 원본 페이지를 식별하기 위한 참조입니다. 해당
서비스의 코드·로고를 이 항목으로 재배포한다는 뜻이 아니며, 각 운영사와의
제휴·보증을 주장하지 않습니다. 서비스 약관, 콘텐츠 권리와 API/페이지 접근
허가는 오픈소스 라이선스와 별개의 문제입니다.

<!-- attribution-id: chzzk-service -->
- CHZZK — NAVER Corp. and/or its licensors — https://chzzk.naver.com/
<!-- attribution-id: youtube-service -->
- YouTube — Google LLC and/or its licensors — https://www.youtube.com/
<!-- attribution-id: soop-service -->
- SOOP — SOOP Co., Ltd. and/or its licensors — https://www.sooplive.co.kr/

## Corresponding source

공개 web·로컬 엔진 소스, TypeScript build scripts, installer 구성,
exact lockfile와
이 인벤토리의 canonical typed registry는 다음 위치에 있습니다.

- Repository: https://github.com/studyreadbook4ever/KirinukiHelper
- Registry: `src/lib/third-party-attributions.ts`
- Human inventory: `legal/OPEN_SOURCE_INVENTORY.md`
- Runtime boundary: `legal/RUNTIME_DEPENDENCIES.md`
- Web release gate: `legal/WEB_DEPLOYMENT_CHECKLIST.md`
