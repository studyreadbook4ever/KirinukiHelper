# Open-source inventory

이 문서는 웹·소스 설치판·데스크톱 개발 프리뷰의 범위를 사람이 빠르게 파악하기
위한 표입니다.
기계가 검사하는 canonical 목록은 `src/lib/third-party-attributions.ts`, 상세
고지는 `legal/THIRD_PARTY_NOTICES.md`입니다. 등록 ID, 고정 버전·artifact,
필수 provenance marker와 배포 사본이 어긋나면 `npm run license:check`가
실패합니다. 서술형 법적 판단은 이 자동 검사만으로 대체하지 않습니다.

이 인벤토리는 현재 저장소와 고정 산출물에 대한 공학적 기록이며 법률 자문,
모든 관할권에서의 적법성 판단 또는 무위험 보증이 아닙니다.

## 상업 이용 dependency gate

현재 제품 경계의 실제 라이선스인 Unlicense, MIT/ISC, Apache-2.0, MPL-2.0과
OFL-1.1은 광고·유료 배포·SaaS 같은 상업 이용 자체를 금지하지 않습니다. 다만
MPL의 파일 수준 대응 소스·고지와 OFL의 원문·Reserved Font Name·글꼴 단독 판매
제한 등 각 배포 의무는 그대로 남습니다. 이는 사업 전체의 적법성 보증이나 외부
서비스 영상의 수익화 승인이 아닙니다.

정확한 positive allowlist, NC·Commons Clause·PolyForm·SSPL·BUSL·Elastic·
Prosperity·불명확한 LicenseRef 차단, pseudo-license의 비재배포 kind 제한과
광고 SDK/analytics 사전 inventory 규칙은
[`legal/COMMERCIAL_USE_POLICY.md`](COMMERCIAL_USE_POLICY.md)를 기준으로 합니다.
새 구성요소는 “상업 이용 가능해 보임”으로 통과하지 않으며 typed registry,
고지와 negative test를 함께 갱신하기 전까지 fail closed합니다.

## 배포 경계 한눈에 보기

| ID | 구성요소 | 버전/고정점 | 라이선스 | 현재 배포 경계 |
| --- | --- | --- | --- | --- |
| `mediabunny` | Mediabunny | 1.51.0 | MPL-2.0 | Linux 소스 앱의 editor JS에 bundle |
| `audseg` | AudSeg browser port | 0.1.0 | MIT | Linux 소스 앱의 source와 editor JS에 포함 |
| `pretendard` | Pretendard ExtraBold | 1.3.9 | OFL-1.1 | Linux 소스 앱의 WOFF2 포함 |
| `paperlogy` | Paperlogy 8 ExtraBold | 1.001 / `8ef35f…` | OFL-1.1 | Linux 소스 앱의 WOFF2 포함 |
| `whisper-cpp` | whisper.cpp | v1.8.6 / `23ee035…` | MIT 및 embedded 고지 | 선택 시 XDG에 source download·local build |
| `openai-whisper-models` | quantized Whisper models | `535986…` | MIT | 선택한 모델만 XDG에 download |
| `silero-vad` | Silero VAD 6.2 conversion | `9ffd54…` | MIT | XDG에 download |
| `yt-dlp` | official Unix zipimport | 2026.07.04 | Unlicense + ejs/ISC/MIT | XDG에 verified download |
| `ffmpeg`, `ffprobe` | FFmpeg tools | host build | build-dependent | 시스템 도구, 현재 재배포 안 함 |
| `nodejs`, `python` | host runtimes | detected | build-dependent distribution | 시스템 도구, 현재 재배포 안 함 |
| `chromium` | Chromium/Chrome/ChromeDriver | detected | build-dependent distribution | 시스템 도구, 현재 재배포 안 함 |
| `tsx-runtime` | tsx/esbuild/platform binary | lockfile pins | MIT | Kirinuki 앱 내부 엔진 실행 필수, web 정적 ZIP 제외 |
| `typescript-toolchain` | TypeScript/types | lockfile pins | Apache-2.0/MIT | 개발·build 전용, web 정적 ZIP 제외 |
| `github-actions-ci` | checkout/setup-node/setup-chrome Actions | full commit SHA | MIT | GitHub-hosted CI 전용, 제품 산출물 제외 |
| `chzzk-service`, `youtube-service`, `soop-service` | 외부 서비스 이름 | external | 서비스 약관·상표 | 코드 의존성과 분리된 참조 |

### 데스크톱 프리뷰 추가 경계

아래 항목은 현재 canonical registry의 공개 배포 승인 항목이 아니라, CI가 만드는
unsigned 개발 패키지에서 새로 생긴 **검토 대기 재배포 경계**입니다.

| 구성요소 | 고정점 | 알려진 라이선스 경계 | 현재 판정 |
| --- | --- | --- | --- |
<!-- attribution-id: desktop-preview-runtime -->
| Electron runtime | `43.4.0` | Electron MIT + bundled Chromium/Node/third-party notices | 최종 runtime archive hash·SBOM·고지 미완료, 공개 차단 |
| `@electron/asar` | `4.2.1` | MIT 및 transitive build dependencies | build-only, 패키지 내부 allowlist·hash 검증 |
| `@electron/packager` | `20.3.0` | BSD-2-Clause 및 transitive build dependencies | build-only, canonical lock inventory 검토 미완료 |
| `@electron/fuses` | `2.1.3` | MIT 및 transitive build dependencies | build-only, canonical lock inventory 검토 미완료 |
| FFmpeg·ffprobe sidecar | FFmpeg `n8.1.2`, Shaka build tag `n8.1.2-1` | GPLv3·정적 외부 library 조건 | buildconf·link·대응 소스 검토 전 공개 차단 |
| yt-dlp standalone | `2026.07.04` | Unlicense + embedded Python/EJS/기타 component | target별 embedded notice 검토 전 공개 차단 |

대상별 sidecar URL·바이트·SHA-256은 `src/desktop/tool-manifest.ts`에 있습니다.
Electron npm package의 version/integrity는 lockfile에 고정되어 있지만, 패키징 때
받는 Electron 플랫폼 archive 자체의 URL·크기·SHA-256을 release record에 아직
고정하지 않았습니다. 자세한 승인 조건은
[`DESKTOP_BINARY_RELEASE_GATE.md`](DESKTOP_BINARY_RELEASE_GATE.md)입니다.

## Linux 소스 앱의 browser assets에 실제로 포함되는 것

first-party canonical 원문은 루트 `UNLICENSE`입니다. Linux 소스 앱은
`web/licenses/UNLICENSE.txt`와 아래 browser asset 라이선스도 포함합니다.
공개 shell-only ZIP은 별도의 `public-shell/licenses/UNLICENSE.txt`만 포함하고
editor JavaScript·글꼴·아래 제3자 구성요소를 배포하지 않습니다.

<!-- attribution-id: mediabunny -->
### Mediabunny

`mediabunny@1.51.0`을 `package-lock.json`에 고정합니다. MPL-2.0 원문은
`web/licenses/MEDIABUNNY-MPL-2.0.txt`, exact corresponding source는
https://registry.npmjs.org/mediabunny/-/mediabunny-1.51.0.tgz 입니다.
upstream: https://github.com/Vanilagy/mediabunny

<!-- attribution-id: audseg -->
### AudSeg

`AudSeg/` Python 소스와 `src/editor/audseg.ts` TypeScript port는 별도 MIT
라이선스입니다. `web/licenses/AUDSEG-MIT.txt`를 패키지하며 컴파일된
JS에도 `@license AudSeg 0.1.0` 고지를 남깁니다.

<!-- attribution-id: pretendard -->
### Pretendard

공식 v1.3.9 ExtraBold WOFF2와 OFL-1.1 원문을 함께 배포합니다.
upstream: https://github.com/orioncactus/pretendard/tree/v1.3.9

<!-- attribution-id: paperlogy -->
### Paperlogy

공식 commit `8ef35f53b318c7ca914c52b1b382b9a8bad07a61`의 8 ExtraBold
WOFF2와 OFL-1.1 원문을 함께 배포합니다.
upstream: https://github.com/Freesentation/paperlogy/tree/8ef35f53b318c7ca914c52b1b382b9a8bad07a61

정확한 크기와 SHA-256은 canonical registry 및
`web/THIRD_PARTY_NOTICES.md`에 있습니다. 기술 경로
`streaming-companion/`에는 앱이 관리하는 first-party Player Bridge 코드만
생성되며 위 제3자 구성요소를 다시 번들하지 않습니다.

## 설치 시 내려받는 것

<!-- attribution-id: whisper-cpp -->
- whisper.cpp v1.8.6 source archive, commit
  `23ee03506a91ac3d3f0071b40e66a430eebdfa1d`, MIT. 빌드되는
  `whisper-server`의 ggml/cpp-httplib/nlohmann/json/stb_vorbis/miniaudio
  구성은 향후 바이너리 배포 전에 별도 검사합니다.
<!-- attribution-id: openai-whisper-models -->
- quantized OpenAI Whisper models, revision
  `5359861c739e955e79d9a303bcbc70fb988958b1`, MIT.
<!-- attribution-id: silero-vad -->
- converted Silero VAD 6.2 model, revision
  `9ffd54a1e1ee413ddf265af9913beaf518d1639b`, MIT.
<!-- attribution-id: yt-dlp -->
- official yt-dlp 2026.07.04 Unix zipimport. 이 exact artifact에
  yt-dlp-ejs 0.8.0(Unlicense), Meriyah 6.1.4(ISC), Astring 1.9.0(MIT)의
  고지 포함 JavaScript가 들어 있습니다.

모든 runtime download는 URL·size·SHA-256 세 값을 함께 고정합니다. 전체 값은
`legal/RUNTIME_DEPENDENCIES.md`에 있습니다.

## Linux 소스 설치판의 시스템 제공 도구

<!-- attribution-id: ffmpeg -->
- FFmpeg는 `ffmpeg -version`, `ffmpeg -buildconf`로 실제 build를 확인합니다.
<!-- attribution-id: ffprobe -->
- ffprobe는 `ffprobe -version` 및 동일 FFmpeg build 정보로 확인합니다.
<!-- attribution-id: nodejs -->
- Node.js 22.17.0 이상은 `node --version`, `process.versions`로 확인합니다.
<!-- attribution-id: python -->
- Python 3.11 이상은 `python3 --version`으로 확인합니다.
<!-- attribution-id: chromium -->
- Chromium/Chrome/ChromeDriver는 각 `--version`으로 테스트 환경을 확인합니다.

현재는 어느 것도 web 정적 ZIP이나 Linux 소스 archive에 재배포하지 않습니다.
Electron 개발 프리뷰에는 Electron의 Chromium·Node와 FFmpeg·ffprobe sidecar가
포함되므로 이 분류가 이미 바뀌었습니다. 개발 패키지를 공개하려면 실제 binary
build의 전체 라이선스를 새로 수집해야 합니다.

## Kirinuki 앱 내부 runtime용 npm 패키지

<!-- attribution-id: tsx-runtime -->
`tsx` 4.23.1, `esbuild` 0.28.1과 현재 OS용 platform binary는
TypeScript로 작성된 Kirinuki setup·자막 엔진·VOD 미디어 엔진을 실행하는
**앱 내부 runtime 필수 구성요소**입니다. `package-lock.json`의 exact
URL·integrity로 repository-local `node_modules`에 설치하며 web 정적 ZIP에는
들어가지 않습니다. 현재 Linux source-app archive도 `node_modules`를 포함하지
않으므로 이 패키지들을 번들한다고 간주하지 않습니다. 향후 설치 프로그램이나
container에 실제 패키지 내용을 포함하면 이 npm runtime의 MIT 고지와 실제
platform package를 산출물 단위로 수집합니다.
upstream: https://github.com/privatenumber/tsx

## 개발·build 전용 패키지

<!-- attribution-id: typescript-toolchain -->
TypeScript 5.9.3(Apache-2.0)과 `@types/*`/undici-types(MIT)를 정확한
`package-lock.json`으로 관리합니다. 이들은 타입 검사·build 전용이며
web 정적 ZIP에 포함되지 않습니다.

## 저장소 전용 Python·CI 도구의 미고정 경계

`AudSeg/pyproject.toml`의 `hatchling>=1.27`, `pytest`/`pytest-cov`, `ruff`
범위는 AudSeg build·개발용이며 Kirinuki 앱의 일반 setup이 내려받지
않습니다. 현재 exact lockfile이 없으므로 이 범위 자체를 재현 가능한 배포
인벤토리로 간주하지 않습니다. AudSeg Python package나 그 build image를
배포하기 전에는 실제 resolve 결과를 고정하고 각 artifact의 출처·라이선스·해시를
별도로 수집해야 합니다. AudSeg의 제품 runtime dependency는 현재 0개입니다.

<!-- attribution-id: github-actions-ci -->
`.github/workflows/typescript-quality.yml`의 GitHub Actions도 CI 전용 외부
실행 구성요소이며 제품 산출물에 포함되지 않습니다. 현재 다음 full commit
SHA와 MIT 대응 소스를 고정합니다.

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262` (`v4`)
  — https://github.com/actions/checkout/tree/11d5960a326750d5838078e36cf38b85af677262
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (`v4`)
  — https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020
- `browser-actions/setup-chrome@2e1d749697dd1612b833dba4a722266286fbefcd`
  (`v2.1.2` action release); 대응 소스·MIT 원문은
  https://github.com/browser-actions/setup-chrome/tree/73954683cc80eced513145a42b668b9b91f753c3
  입니다.

upstream: https://docs.github.com/actions
제품 릴리스 때에는 고정 SHA가 그대로인지, action dependency bundle과 runner
image까지 포함한 실제 CI provenance를 다시 기록합니다.

## 외부 서비스·상표

<!-- attribution-id: chzzk-service -->
- CHZZK: https://chzzk.naver.com/ — NAVER Corp. and/or its licensors
<!-- attribution-id: youtube-service -->
- YouTube: https://www.youtube.com/ — Google LLC and/or its licensors
<!-- attribution-id: soop-service -->
- SOOP: https://www.sooplive.co.kr/ — SOOP Co., Ltd. and/or its licensors

플랫폼 이름과 URL은 지원 대상을 식별하기 위한 참조입니다. 제휴·승인·보증을
주장하지 않으며, 콘텐츠 권리·플랫폼 약관·상표 사용은 오픈소스 라이선스와
별도로 검토합니다.

## 변경할 때

1. dependency, CDN asset, WASM, 글꼴, 모델, container package를 추가하기
   전에 canonical registry에 정확한 provenance와 배포 경계를 기록합니다.
2. 내려받아 재배포하는 artifact는 immutable URL, byte size와 SHA-256이 모두
   없으면 허용하지 않습니다.
3. 시스템 도구는 detection 명령과 build별 라이선스 여부를 기록합니다.
4. `public-shell` notice에는 공개 shell 파일만, `web` notice에는 앱 browser
   assets만, root notice에는 Kirinuki 앱 내부 runtime과 설치 시 내려받는
   구성요소까지 적습니다. 서로 다른 배포 경계를 동일하게 만들지 않습니다.
5. `npm run license:check`, `npm run build`, `npm run validate`, 실제 release
   archive 검사를 통과시킵니다.
6. 데스크톱 binary는 target별 SBOM과 sidecar build evidence, Windows 서명,
   macOS 서명·공증까지 모두 끝나기 전에는 공개하지 않습니다.
