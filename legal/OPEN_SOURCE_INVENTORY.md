# Kirinuki 오픈소스·배포 인벤토리

이 문서는 공개 웹 편집기, 로컬 미디어 엔진 installer, 저장소 전용
도구의 경계를 사람이 빠르게 확인하기 위한 목록입니다. 기계가 검사하는 canonical
목록은 `src/lib/third-party-attributions.ts`, 자세한 고지는
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)입니다. 이 기록은 법률 자문이나
무위험 보증이 아니며 실제 출시 산출물별 SBOM 검사를 대체하지 않습니다.

## 제품 구조

- `kirinuki.eff0rtchung.kr`: 전체 정적 웹 편집기. 로그인·서버 세션·analytics·
  telemetry·서버 VOD proxy가 없습니다.
- Windows x64, macOS arm64, Linux x64: 한 번 설치하는 로컬 구간 준비 엔진과
  컷 선택 전용 격리 창. 사용자는 port나 endpoint를 구성하지 않습니다.
- `src/streaming-electron-frame-action.ts`: Kirinuki가 직접 작성한 플레이어 제어 코드.
  build 때 ASAR main bundle에 고정하며 사용자의 Chrome profile에 설치하지 않습니다.
- Electron full editor: 제품 산출물이 아닙니다. full editor는 일반 브라우저에서
  실행됩니다.
- first-party 소스: 루트 `UNLICENSE`. 제3자 파일은 각 라이선스를 그대로 유지하며
  Unlicense로 재허가하지 않습니다.

## 공개 웹 ZIP에 포함되는 제3자 파일

| Registry ID | 구성요소 | 버전·라이선스 | 실제 범위 |
| --- | --- | --- | --- |
<!-- attribution-id: mediabunny -->
| `mediabunny` | Mediabunny | 1.51.0 · MPL-2.0 | 브라우저 media read/encode/mux bundle |
<!-- attribution-id: audseg -->
| `audseg` | AudSeg browser port | 0.1.0 · MIT | source와 compiled editor/worker 고지 |
<!-- attribution-id: pretendard -->
| `pretendard` | Pretendard ExtraBold | 1.3.9 · OFL-1.1 | 고정 WOFF2와 OFL 원문 |
<!-- attribution-id: paperlogy -->
| `paperlogy` | Paperlogy 8 ExtraBold | 1.001 · OFL-1.1 | 고정 WOFF2와 OFL 원문 |

정확한 크기·SHA-256·대응 소스는
[`WEB_THIRD_PARTY_NOTICES.md`](WEB_THIRD_PARTY_NOTICES.md)에 있습니다. 웹 ZIP은
FFmpeg, yt-dlp, Electron, Whisper model 또는 npm build tool을 포함하지 않습니다.

## 로컬 엔진 installer의 공개 차단 경계

<!-- attribution-id: desktop-local-engine-runtime -->
| 구성요소 | 고정점 | 상태 |
| --- | --- | --- |
| Electron runtime | `43.4.1` | Chromium·Node 전체 SBOM/notice 및 archive provenance 대기 |
| electron-builder | `26.15.3` | build-only transitive license 검토 대기 |
| `@electron/asar` | `4.2.1` | build/ASAR 검증 도구 |
| `@electron/packager` | `20.3.0` | BSD-2-Clause build 도구 |
| `@electron/fuses` | `2.1.3` | MIT build 도구 |
| FFmpeg·ffprobe | `n8.1.2`, Shaka tag `n8.1.2-1` | target별 binary·license 포함, buildconf/대응 소스 gate 미완료 |
| yt-dlp standalone | `2026.07.04` | target별 binary 포함, embedded Python/EJS inventory 미완료 |

지원 installer는 Windows x64 NSIS, macOS arm64 DMG, Linux x64 deb 세 개뿐입니다.
현재 산출물은 unsigned이고 macOS는 unnotarized입니다. exact hash가 맞고 native
smoke가 통과해도 [`DESKTOP_BINARY_RELEASE_GATE.md`](DESKTOP_BINARY_RELEASE_GATE.md)의
SBOM·provenance·signing 조건이 하나라도 남으면 공개 배포하지 않습니다.

## 저장소 전용 검증 다운로드

이 절은 공개 웹 ZIP이나 세 installer의 포함 목록이 아닙니다. source-run 또는
선택적 로컬 Whisper 경로가 고정 URL·size·SHA-256을 확인해 사용자별 디렉터리에
내려받는 항목입니다.

<!-- attribution-id: yt-dlp -->
- `yt-dlp` Unix zipimport 2026.07.04 — Unlicense; embedded yt-dlp-ejs 0.8.0
  (Unlicense), Meriyah 6.1.4(ISC), Astring 1.9.0(MIT).
<!-- attribution-id: whisper-cpp -->
- whisper.cpp v1.8.6 commit `23ee03506a91ac3d3f0071b40e66a430eebdfa1d` — MIT;
  local source build only.
<!-- attribution-id: openai-whisper-models -->
- Quantized Whisper models revision `5359861c739e955e79d9a303bcbc70fb988958b1`
  — MIT lineage.
<!-- attribution-id: silero-vad -->
- Silero VAD 6.2 conversion revision `9ffd54a1e1ee413ddf265af9913beaf518d1639b`
  — MIT.

whisper-server를 binary로 재배포할 때는 ggml, cpp-httplib, nlohmann/json,
stb_vorbis, miniaudio와 실제 backend/link 결과를 다시 고지합니다. 고정 source
archive만으로 완성 binary의 SBOM이 되지는 않습니다.

## 시스템 제공 경계

다음 항목은 개발/source-run 또는 사용자의 브라우저 환경에서 Kirinuki가
재배포하지 않는 경계입니다. installer에 포함된 동명의 Electron/sidecar와
혼동하지 않습니다.

<!-- attribution-id: ffmpeg -->
- FFmpeg — build-dependent; 실제 `-version`과 `-buildconf`가 라이선스 판정 근거.
<!-- attribution-id: ffprobe -->
- ffprobe — FFmpeg와 같은 build family 기준.
<!-- attribution-id: nodejs -->
- Node.js 22.17.0+ — 저장소 CLI/build host.
<!-- attribution-id: python -->
- Python 3.11+ — source-run yt-dlp/선택 도구 host.
<!-- attribution-id: chromium -->
- Chrome/Chromium/ChromeDriver — 사용자 웹 브라우저와 E2E host.

이들 binary를 새 installer, container, server image 또는 archive에 넣는 순간
system-provided 분류를 폐기하고 해당 배포본의 전체 고지·SBOM을 새로 만듭니다.

## npm과 CI

<!-- attribution-id: tsx-runtime -->
- `tsx@4.23.1`, `esbuild@0.28.1`과 OS platform package, optional
  `fsevents@2.3.3`: repository-local source-run 엔진 runtime. 웹 ZIP에는 없음.
<!-- attribution-id: typescript-toolchain -->
- TypeScript 5.9.3, `@types/node` 20.19.43, `undici-types` 6.21.0: build-only.

저장소 전용 native/Python build 도구와 runner image를 고정된 product dependency
인벤토리로 간주하지 않습니다. 공개 binary를 재현 가능한 배포로 만들 때는 C/C++
compiler, CMake, CUDA toolkit, Python package와 linked library를 별도 build
manifest에 고정해야 합니다.

<!-- attribution-id: github-actions-ci -->
GitHub Actions는 mutable tag 대신 다음 full commit SHA와 MIT 대응 소스를 고정합니다.

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
- `browser-actions/setup-chrome@2e1d749697dd1612b833dba4a722266286fbefcd`

Actions는 CI-only이고 제품 산출물에 재배포하지 않습니다.

## 외부 서비스·상표

<!-- attribution-id: chzzk-service -->
- CHZZK — NAVER Corp. and/or its licensors.
<!-- attribution-id: youtube-service -->
- YouTube — Google LLC and/or its licensors.
<!-- attribution-id: soop-service -->
- SOOP — SOOP Co., Ltd. and/or its licensors.

이 이름은 지원 원본을 식별하기 위한 참조이며 제휴·보증을 주장하지 않습니다.
플랫폼 약관과 사용자의 다운로드·편집·게시 권리는 소프트웨어 라이선스와 별도입니다.

## 출시 때 다시 확인할 것

1. `npm run license:check`와
   [`COMMERCIAL_USE_POLICY.md`](COMMERCIAL_USE_POLICY.md)의 positive allowlist를
   실행합니다.
2. 웹 ZIP, Windows installer, macOS installer, Linux installer를 각각 풀어 exact
   file manifest·SHA-256·SBOM·notice를 만듭니다.
3. Electron/Chromium/Node, target FFmpeg/ffprobe, target yt-dlp standalone의 실제
   포함 파일과 대응 소스를 검사합니다.
4. Windows Authenticode와 timestamp, macOS Developer ID·hardened runtime·
   notarization·staple을 최종 artifact에서 검증합니다.
5. first-party 기여 권리는
   [`FIRST_PARTY_RIGHTS_REVIEW.md`](FIRST_PARTY_RIGHTS_REVIEW.md), 광고·유료·SaaS
   dependency는 [`COMMERCIAL_USE_POLICY.md`](COMMERCIAL_USE_POLICY.md)로 별도 승인합니다.
