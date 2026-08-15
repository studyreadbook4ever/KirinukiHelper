# Kirinuki 공개 웹·데스크톱 앱 출시 체크리스트

이 문서는 `kirinuki.eff0rtchung.kr`의 공개 시작 페이지, 사용자 지원 Linux 소스
설치판과 Linux·Windows·macOS Electron 앱을 서로 다른 보안·배포 산출물로
검증하기 위한 release gate입니다. 공개 사이트는 소개·설치·엄격한 앱 링크만
제공하고, 실제 편집은 설치된 앱이 소유한 창에서만 실행합니다.

법률 자문이나 무위험 보증이 아닙니다. 출시 지역, 수익 모델, 플랫폼 약관과
콘텐츠 권리는 실제 산출물을 기준으로 별도 검토해야 합니다.

## 0. 출시 경계 동결

- [ ] 공개 shell, Linux 앱 소스/설치 진입점, 앱 내부 편집 bundle, 설치 중
  다운로드 artifact, 시스템 provision 도구를 각각 별도 manifest로 동결했다.
- [ ] `legal/FIRST_PARTY_RIGHTS_REVIEW.md`에서 기여자 권리와 명시적 Unlicense
  동의를 실제 release 기준으로 다시 확인했다.
- [ ] 공개 shell을 “브라우저 편집기”나 “설치 없이 전체 기능 사용”으로 표시하지
  않는다.
- [ ] Linux v1은 아직 자체 Node·Chromium·Python·FFmpeg를 포함한 AppImage가
  아니라는 사실과 시스템 요구사항을 다운로드 페이지에 표시했다.
- [ ] Electron 프리뷰는 unsigned·unnotarized unpacked 개발 디렉터리이고 공개
  다운로드나 Linux 소스 설치판의 대체물이 아니라는 사실을 표시했다.
- [ ] `legal/DESKTOP_BINARY_RELEASE_GATE.md`의 Electron archive provenance,
  SBOM·notice, FFmpeg buildconf·대응 소스, yt-dlp standalone 고지와 OS signing
  조건이 하나라도 미완료이면 native package 업로드·release를 차단한다.
- [ ] 사용자는 `./setup.sh`를 한 번 실행한 뒤 앱 아이콘 또는 `kirinuki`만
  사용한다. 별도 내부 프로세스·브라우저 확장·연결 주소를 시작하거나 구성하는
  절차가 사용자 문서와 UI에 없다.
- [ ] 앱 내부에서 여러 프로세스를 쓰더라도 설치·시작·상태 확인·업데이트·복구·
  종료의 소유자는 하나의 Kirinuki 앱이다.
- [ ] 배포 후보 commit과 공개 shell digest, 앱 source archive digest, lockfile,
  build log를 같은 release record에 고정했다.

## 1. 공개 사이트 기능 경계 — hard gate

- [ ] 정적 호스트의 배포 루트는 tracked `public-shell/` 또는 검증된
  `kirinuki-web-v*.zip`이며, 앱 내부 `web/` 디렉터리를 직접 mount·Git deploy하지
  않는다.
- [ ] `kirinuki.eff0rtchung.kr`은 제품 소개, 시스템 요구사항, 설치 안내,
  **Kirinuki에서 열기**와 라이선스/문의 링크만 제공한다.
- [ ] 공개 HTML·CSS·JavaScript가 `editor.html`을 열거나 편집 프로젝트·IndexedDB·
  worker·미디어 엔진·자막 엔진을 초기화하지 않는다.
- [ ] 공개 산출물의 HTML, CSS, JavaScript, source map, manifest와 CSP에 loopback
  host, 내부 port, 내부 API route, WebSocket, localhost media URL 또는 앱 내부
  health probe가 없다.
- [ ] 공개 CSP의 `connect-src`, `media-src`, `worker-src`가 앱 내부 서비스를
  허용하지 않는다. `default-src 'self'`에서 꼭 필요한 HTTPS 리소스만 최소로
  추가했다.
- [ ] 공개 페이지는 브라우저의 Local Network Access 권한을 요청하지 않고,
  방문자 PC의 내부 서비스 존재 여부를 탐지·fingerprint하지 않는다.
- [ ] 공개 페이지에서 앱 실행 실패를 편집 오류로 표현하지 않는다. 앱이 없거나
  외부 앱 열기를 거절한 경우 설치 안내와 수동 **앱 열기** 폴백을 계속
  제공한다.
- [ ] 앱 실행 전 자동 redirect loop, 숨은 iframe, 반복 custom-scheme 호출 또는
  사용자 gesture 없는 무한 재시도를 사용하지 않는다.
- [ ] JavaScript가 비활성화되어도 앱 설치 요구사항, 직접 실행 방법과 문의처를
  읽을 수 있다.
- [ ] 모바일에서는 편집을 시작하지 않으며 지원되는 데스크톱 설치판이 필요하다는
  설명과 설치 가능한 기기에서 다시 여는 방법만 제공한다. 공개 전인 Windows·
  macOS 프리뷰를 다운로드 가능한 제품처럼 안내하지 않는다.

## 2. 엄격한 앱 링크

- [ ] 공개 shell과 desktop 등록이 canonical `kirinuki://open`만 사용한다.
- [ ] 원본 전달은 선택적인
  `kirinuki://open?source=<URLSearchParams encoded HTTPS URL>` 하나로 제한한다.
- [ ] parser가 scheme과 `open` host를 exact 비교하고 username, password, 임의
  port, fragment, 추가 path, 알 수 없는 key, 중복 `source`, 제어 문자와 길이
  초과를 거절한다.
- [ ] `source`는 CHZZK·YouTube·SOOP의 명시적 HTTPS host allowlist와 지원 path
  검증을 통과해야 하며 `youtube.com.evil.example`, URL userinfo, encoded
  delimiter 혼동과 redirector를 통과시키지 않는다.
- [ ] 앱 링크는 원본 입력만 채우며 프로젝트 생성, 컷 시각, 파일 권한, 저장본
  복구 또는 권리 확인을 자동 승인하지 않는다.
- [ ] 설치되지 않은 앱, 브라우저 거절, malformed link, 앱이 이미 열린 경우와
  중복 클릭을 실제 Chromium에서 검증했다.
- [ ] 같은 링크를 여러 번 받아도 내부 구성요소를 중복 시작하거나 서로 다른
  프로젝트 상태를 혼합하지 않는다.

## 3. 공개 호스팅과 개인정보

- [ ] Cloudflare Tunnel은 `kirinuki.eff0rtchung.kr`의 공개 정적 listener 하나에만
  연결하고 앱 내부 listener, LAN 주소 또는 사용자 PC로 ingress하지 않는다.
- [ ] 응답에 `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, 최소 `Permissions-Policy`, 적절한 COOP/CORP를
  적용했다. `public-shell/_headers`를 무시하는 origin이라면 동등한 server
  설정을 적용하고 실제 HTTPS 응답을 다시 probe한다.
- [ ] HTTPS edge에 HSTS를 적용했다. 부모 도메인 전체 정책을 확인하기 전에는
  `includeSubDomains`나 `preload`를 넣지 않는다.
- [ ] immutable asset에는 content/version 기반 cache key를 쓰고 HTML은 새 앱
  링크·설치 요구사항을 안정적으로 갱신할 정책을 사용한다.
- [ ] analytics, telemetry, fingerprinting, advertising identifier, session replay,
  로그인, 계정 또는 사용자별 서버 저장소가 없다.
- [ ] Cloudflare zone의 Network Error Logging을 꺼 실제 응답에 `NEL`과
  `Report-To`가 없고, Scrape Shield Email Address Obfuscation을 꺼
  `email-decode.min.js`가 주입되지 않는다. 공개 HTML의 메일 링크에도
  Cloudflare 공식 `email_off` 범위를 유지한다.
- [ ] 검증된 공개 ZIP과 실제 응답을 바이트 단위로 대조할 수 있도록 Cloudflare
  Auto Minify, Rocket Loader와 HTML·CSS를 다시 쓰는 Transform Rule을 끈다.
  압축 전송은 허용하되 브라우저가 해제한 응답 본문은 릴리스 artifact와 정확히
  같아야 한다.
- [ ] 정적 호스트가 자동 RED/request metric을 영속화한다면 완전히 비활성화하고
  기존 metric bucket을 비운 뒤 새 요청으로 기록이 생기지 않음을 검증했다.
- [ ] 앱 링크의 `source`를 서버 log, analytics URL, referrer용 외부 링크 또는
  광고 요청에 전달하지 않는다.
- [ ] 광고를 붙일 경우 편집 내용·원본 URL·로컬 capability를 광고 SDK에
  전달하지 않고, 개인정보·쿠키 동의·상업 라이선스 검토를 별도 완료했다.

## 4. Kirinuki 앱 생명주기

- [ ] Linux 소스 설치판과 Electron package의 요구사항·캐시 위치·종료 소유권을
  섞지 않고 채널별 manifest로 고정했다.
- [ ] `./setup.sh`가 현재 저장소를 식별해 사용자 명령과 desktop entry를
  원자적으로 설치·갱신하고, Kirinuki marker가 없는 기존 파일은 덮어쓰지 않는다.
- [ ] 앱 아이콘과 인자 없는 `kirinuki`는 같은 bootstrap 경로로 들어가며 첫
  실행·두 번째 실행·업데이트 뒤 첫 실행이 모두 멱등적이다.
- [ ] 앱이 저장소 관리 npm 구성요소, web/editor build, 고정 runtime artifact와
  선택한 자막 구성을 스스로 확인하고 필요한 항목만 준비한다.
- [ ] 시스템 Node.js 22.17.0+, npm, Chromium 120+, Python 3.11+, FFmpeg, ffprobe가
  없으면 정확한 항목을 안내하고 fail closed한다. `sudo`, `curl | sh`, 임의
  package-manager 설치를 자동 실행하지 않는다.
- [ ] 앱 내부 프로세스는 이 기기에서만 접근 가능하고 임의 LAN interface나 공개
  host에 bind하지 않는다. 사용자는 해당 주소나 process를 알거나 관리할 필요가
  없다.
- [ ] 기존 Kirinuki 인스턴스의 PID, 실행 파일, 시작 시각, profile과 protocol을
  모두 검증한 경우에만 재사용·정상 종료한다. 이름이나 port만 보고 다른
  프로세스에 신호를 보내지 않는다.
- [ ] 앱 창 종료, 재실행, crash recovery, update, 충돌 프로세스, stale PID와
  부분 설치를 각각 검증했다.
- [ ] 일반 사용자 문서에서 저수준 내부 명령은 제거하고 `doctor`, `status`,
  `stop`만 개발자·관리자 진단 폴백으로 분리했다.
- [ ] Electron 앱은 native single-instance/deep-link 경로로 시작하고 마지막 창
  종료 시 자신이 소유한 loopback server와 child process를 정상 종료한다.

## 5. 프로젝트·캐시·세션 불변조건

- [ ] 로그인·서버 세션·방문자 재식별이 없고, 앱을 다시 열 때 과거 작업을 새
  프로젝트에 자동 혼합하지 않는다.
- [ ] 저장하지 않은 프로젝트는 창을 닫으면 폐기하는 것이 기본이며, 이어서
  작업하려면 사용자가 **지금 저장** 또는 복구본을 명시적으로 선택한다.
- [ ] 비정상 종료 복구 후보는 기존 프로젝트 ID·원본·workspace를 검증한 뒤
  제안만 하고, 선택 전에는 현재 프로젝트로 적용하지 않는다.
- [ ] 같은 원본의 여러 프로젝트와 한 롱폼의 여러 쇼츠가 서로 다른 명시적 ID와
  소유권을 가지며 캐시·컷·자막을 섞지 않는다.
- [ ] A 작업을 닫고 B 작업을 열 때 URL, project, workspace와 미디어 binding
  전환이 멱등적이며 stale 비동기 응답이 B에 적용되지 않는다.
- [ ] 내보내기와 모든 sidecar의 크기·SHA-256·복원 무결성이 확인된 경우에만
  **세션 완료·로컬 재료 삭제**를 허용한다.
- [ ] 정리는 해당 프로젝트가 단독 소유한 준비 조각·compact 영상·영수증·저장본·
  이미지·파일 핸들만 대상으로 한다. 사용자 원본과 다른 프로젝트 자료는
  삭제하지 않는다.
- [ ] 일반 다운로드 폴백, 검증 실패, 중복 열린 작업공간, 취소와 crash 중에는
  캐시를 삭제하지 않는다.
- [ ] 원본 전송 주소, access token, pairing token과 platform cookie를 프로젝트,
  복구본, log 또는 telemetry에 저장하지 않는다.

## 6. 실제 편집·미디어 검증

- [ ] 사용자가 확정한 컷 경계와 순서를 AI 또는 자동 준비가 변경하지 않는다.
- [ ] 최초 준비 범위, 앞/뒤 확장, 겹치는 컷, 원본 0초가 아닌 구간과 매우 긴 VOD를
  실제 시간축으로 검증한다. container PTS를 원본 페이지 시각으로 오인하지
  않는다.
- [ ] 새 미디어의 원본 version, 범위, byte, decode 가능성, timestamp mapping과
  저장이 모두 성공한 뒤에만 현재 편집 미디어를 원자적으로 교체한다.
- [ ] 준비 중 원본 정보가 달라지면 제한된 재조회와 일관된 snapshot으로 다시
  시도하고, 실제 원본 불일치와 일시적 signed URL 변화는 구분한다.
- [ ] 자동 준비 실패는 권한 있는 **내 파일 직접 연결**로 복구할 수 있으며 다른
  프로젝트의 로컬 파일 핸들을 자동 연결하지 않는다.
- [ ] 자막은 자유롭게 이동·분할할 수 있고 전역 4초 제한이 없다. AudSeg의
  segmentation 조건을 편집 계약으로 오인하지 않는다.
- [ ] 쇼츠 다중 영상의 source clock, crop, destination, z-order, visibility,
  opacity와 음성 포함 여부가 저장·미리보기·최종 출력에서 일치한다.
- [ ] 적응형 GPU 경로 실패 시 부분 출력은 폐기하고 같은 canonical 좌표의 안전한
  경로로 처음부터 한 번만 재시작한다. 한 파일에 backend를 섞지 않는다.
- [ ] GPU vendor/renderer와 성능 계측을 사용자 식별, analytics 또는 세션 밖
  저장에 사용하지 않는다.

## 7. 웹·앱 번들 라이선스

<!-- attribution-id: mediabunny -->
- [ ] Mediabunny 1.51.0 MPL-2.0 고지, 전체 license, 수정 여부와 exact
  corresponding source 접근 경로를 실제 포함 산출물과 함께 제공한다.
<!-- attribution-id: audseg -->
- [ ] AudSeg 0.1.0 MIT 원문과 저작권 고지를 유지하고 esbuild 결과의 `@license`
  주석을 보존한다.
<!-- attribution-id: pretendard -->
- [ ] Pretendard 1.3.9 WOFF2, OFL-1.1 원문과 Reserved Font Name 고지를 함께
  제공한다.
<!-- attribution-id: paperlogy -->
- [ ] Paperlogy 1.001 pinned WOFF2와 OFL-1.1 원문을 함께 제공한다.
- [ ] 공개 shell과 앱 편집 bundle 중 실제로 파일을 포함한 산출물에만 해당
  고지를 넣되, 둘을 합쳐 누락을 숨기지 않는다.
- [ ] `licenses.html`과 고지 링크를 키보드·스크린리더로 열 수 있고 모든 local
  license 링크가 최종 package에 실제로 있다.
- [ ] minifier/banner 변경 뒤에도 license comment, source map 경계와 notice
  파일을 검사한다.

## 8. 설치 시 다운로드·시스템 도구 라이선스

<!-- attribution-id: desktop-preview-runtime -->
- [ ] Electron `43.4.0` 플랫폼 archive의 URL·크기·SHA-256과 upstream checksum,
  Electron `LICENSE`, `LICENSES.chromium.html`, Chromium·Node 포함 SBOM을 target별
  release evidence에 기록했다.
- [ ] `@electron/packager@20.3.0`, `@electron/fuses@2.1.3`와 모든 transitive
  build dependency의 exact lock artifact·라이선스를 canonical registry에서
  검토했다.

<!-- attribution-id: whisper-cpp -->
- [ ] whisper.cpp source commit, archive byte/hash와 MIT 원문을 보존했다. binary를
  배포한다면 compile flags와 실제 linked component를 다시 조사했다.
<!-- attribution-id: openai-whisper-models -->
- [ ] OpenAI Whisper model lineage, converted repository revision, 선택 model의
  exact size/hash와 MIT 고지를 기록했다.
<!-- attribution-id: silero-vad -->
- [ ] Silero VAD 원본, conversion revision, exact size/hash와 MIT 고지를
  기록했다.
<!-- attribution-id: yt-dlp -->
- [ ] yt-dlp 2026.07.04 exact artifact, Unlicense와 embedded yt-dlp-ejs,
  Meriyah, Astring header를 보존했다.
- [ ] Electron package의 target별 yt-dlp standalone에 포함된 Python/EJS/기타
  component를 실제 바이너리 기준으로 다시 inventory하고 최종 고지에 포함했다.
<!-- attribution-id: ffmpeg -->
- [ ] FFmpeg를 산출물에 포함하면 최종 `ffmpeg -version`과 `-buildconf`를
  증거로 남기고 `--enable-nonfree`가 있으면 자동 배포를 **차단**한다.
<!-- attribution-id: ffprobe -->
- [ ] ffprobe의 실제 binary·build family·외부 library와 고지 의무를 FFmpeg와
  함께 검사한다.
<!-- attribution-id: nodejs -->
- [ ] Node.js/npm을 installer나 archive에 넣으면 해당 배포본의 full license와
  bundled component notices를 포함한다.
<!-- attribution-id: python -->
- [ ] Python을 넣으면 해당 배포본의 PSF license와 bundled component notices를
  포함한다.
<!-- attribution-id: chromium -->
- [ ] Chromium/Chrome/ChromeDriver를 넣으면 provider/build별 라이선스와
  redistribution 조건을 확인한다. 현재 시스템 provision 전제와 혼동하지 않는다.
<!-- attribution-id: tsx-runtime -->
- [ ] 현재 소스 설치가 실행하는 tsx·esbuild·OS platform package를 provision
  manifest에 포함하고 MIT 고지를 유지한다. 미리 컴파일했다면 최종 package에
  정말 남지 않았는지 스캔한다.
<!-- attribution-id: typescript-toolchain -->
- [ ] TypeScript와 types package가 build-only인지 최종 package에 포함됐는지
  SBOM으로 구분한다.

## 9. 상업 이용과 외부 서비스

- [ ] [`legal/COMMERCIAL_USE_POLICY.md`](COMMERCIAL_USE_POLICY.md)의 positive
  allowlist를 release 기준으로 다시 실행했다.
- [ ] NonCommercial, Commons Clause, PolyForm, SSPL, BUSL, Elastic License,
  field-of-use 제한, `LicenseRef-*`, `NOASSERTION`, unknown 또는 원문 누락이
  있으면 배포를 차단한다.
- [ ] 광고 SDK, consent manager, 결제·analytics package를 도입했다면 모든
  transitive dependency와 원격 script를 registry/SBOM에 추가했다.
<!-- attribution-id: chzzk-service -->
- [ ] CHZZK 명칭·URL·아이콘이 공식 제휴나 승인을 암시하지 않으며 현재 플랫폼
  약관과 기술적 접근 방식을 출시 시점에 다시 확인했다.
<!-- attribution-id: youtube-service -->
- [ ] YouTube 원본 보기는 공식 privacy-enhanced embed와 앱에 포함된 격리
  Player Bridge만 사용하고 로그인·cookie·DRM을 우회하지 않는다.
<!-- attribution-id: soop-service -->
- [ ] SOOP 명칭·URL·아이콘이 공식 제휴나 승인을 암시하지 않으며 지원되는 공개
  VOD 방식만 사용한다.
- [ ] 공개 페이지 접근 가능성을 다운로드·편집·게시 허가로 간주하지 않고,
  매 작업 권리 확인과 게시 전 human review를 유지한다.

## 10. 출시 증거와 승인

<!-- attribution-id: github-actions-ci -->
- [ ] GitHub Actions full commit SHA 세 개를 다시 확인하고, 각 action을 full
  commit SHA로 고정해 대응 소스·MIT 원문, 최소 권한과 runner image를 release
  evidence에 기록했다.
- [ ] whisper.cpp를 빌드한 C/C++ compiler, CMake, CUDA toolkit과 실제 linked
  native library의 버전·라이선스·build manifest를 보관했다.
- [ ] `npm ci --ignore-scripts`, `npm run license:check`, `npm run build`,
  `npm run validate`, unit tests, browser tests와 release artifact scan을 같은
  commit에서 통과했다.
- [ ] GitHub Actions native matrix가 Linux x64, Windows x64와 macOS arm64 각각의
  실제 host에서 `npm run typecheck`, `npm test`, `npm run package:desktop`을
  통과했고 예상한 `process.platform-process.arch`와 일치했다.
- [ ] unsigned CI package는 업로드하지 않으며, 공개 후보는 별도 보호된 release
  job에서만 signing secret을 사용해 생성했다.
- [ ] macOS 앱과 모든 nested executable·dylib·FFmpeg·ffprobe·yt-dlp를 Developer
  ID로 서명하고 hardened runtime·최소 entitlement·Apple notarization·ticket
  staple 뒤 `codesign`, `spctl`, `stapler` 검증을 통과했다.
- [ ] Windows 앱과 native sidecar를 Authenticode 서명·timestamp하고 최종
  signature와 새 사용자 환경의 실행 경고를 검사했다.
- [ ] 공개 artifact를 별도로 풀어 loopback 문자열, 내부 route, editor 초기화,
  내부 CSP 허용과 source map 비밀이 없음을 검사했다.
- [ ] 깨끗한 Linux 계정에서 최초 설치, 첫 실행, 두 번째 실행, deep link, 앱 미설치
  fallback, 업데이트, crash recovery와 제거 후 재설치를 검증했다.
- [ ] 지원 플랫폼의 실제 공개 VOD로 부분 준비·범위 확장·내보내기를 수행하되
  테스트 계정·cookie·비공개 콘텐츠를 release log에 남기지 않았다.
- [ ] 생성한 SBOM, dependency/license scan, notice, 대응 소스 URL, exact hash,
  FFmpeg buildconf와 공개/app artifact digest를 release record에 보관했다.
- [ ] 보안·개인정보·데이터 보존 검토를 라이선스 검토와 별도로 완료했다.
- [ ] 출시 승인자는 이 체크리스트가 법적 보증이 아니라 evidence checklist임을
  이해하고 실제 산출물 기준으로 승인했다.
