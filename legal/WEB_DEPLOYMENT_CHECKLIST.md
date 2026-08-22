# Kirinuki 웹·로컬 엔진 출시 체크리스트

이 문서는 `https://kirinuki.eff0rtchung.kr`의 **전체 웹 편집기**와 사용자가 한 번
설치하는 **로컬 미디어 엔진**을 함께 출시하는 hard gate입니다.
플레이어 제어 코드는 build 때 설치 앱의 `app.asar`에 고정되어 컷 선택 전용
Electron 창의 정확한 플랫폼 frame에서만 실행됩니다. Electron full editor, 외부
Chrome 확장과 서버 VOD proxy는 제품 구조가 아닙니다.

법률 자문이나 무위험 보증이 아닙니다. 체크 표시는 같은 release candidate의
실제 산출물과 readback 증거가 있을 때만 합니다.

## 1. 제품 경계 동결

- [ ] 웹 ZIP에는 시작 화면, full editor, worker, font, license만 있고 로컬
  executable·server secret·사용자 데이터가 없다.
- [ ] 설치 파일에는 background range engine, 컷 전용 격리 창, target sidecar와
  ASAR에 고정된 player action만 있고 Electron full editor·extension·auto-updater가 없다.
- [ ] player action은 정확한 CHZZK·YouTube·SOOP frame에만 실행하며 Chrome
  profile에 extension으로 설치하거나 임의 외부 웹페이지에 주입하지 않는다.
- [ ] 공개 서버는 정적 파일만 제공하며 VOD, 프로젝트, 로그인, 사용자 session,
  analytics, telemetry를 받거나 저장하지 않는다.
- [ ] Windows x64, macOS arm64, Linux x64 이외의 설치 파일을 자동 추천하지 않는다.
- [ ] [`legal/FIRST_PARTY_RIGHTS_REVIEW.md`](FIRST_PARTY_RIGHTS_REVIEW.md)에서 기여자
  권리와 명시적 Unlicense 동의를 release commit 기준으로 재확인했다.
- [ ] [`legal/DESKTOP_BINARY_RELEASE_GATE.md`](DESKTOP_BINARY_RELEASE_GATE.md)의
  SBOM·provenance·signing·notarization 조건이 하나라도 남으면 installer 공개를
  차단한다.
- [ ] 공개 웹 digest, 세 installer digest, lockfile, build log, test log를 같은
  release record에 고정했다.

## 2. 일반 웹사이트 같은 사용자 흐름

- [ ] 사용자는 사이트 → **컷 선택 열기** → 설치 앱에서 URL·구간 확정 →
  자동으로 열린 기본 브라우저 편집기 흐름만 수행한다.
- [ ] 엔진이 없을 때만 OS에 맞는 installer와 1회 설치 안내를 보여 준다.
- [ ] 설치 뒤 사이트가 앱을 자동 호출하며 사용자가 port, endpoint, token, process,
  시작·종료 상태, 확장 프로그램 또는 handoff 값을 입력하거나 관리하지 않는다.
- [ ] Chrome Local Network Access prompt는 최초 연결 안내에 포함하고, 허용·거절·
  재시도·브라우저 정책 차단을 실제 Chrome에서 검증했다.
- [ ] 설치 완료, 엔진 이미 실행 중, 엔진 재시작, protocol 불일치, port 충돌이
  각각 이해 가능한 한 문장과 단일 다음 행동으로 복구된다.
- [ ] 모바일에서는 편집을 시작하지 않고 데스크톱에서 다시 열도록 안내한다.
- [ ] 자동 준비가 불가능한 권한 있는 원본에는 **내 파일 직접 연결**을 제공한다.
- [ ] UI와 사용자 문서는 컷 전용 설치 앱 창과 일반 브라우저 full editor의 경계를
  사실대로 표시하고 localhost 주소나 별도 관리 CLI를 사용자 절차로 노출하지 않는다.
- [ ] 컷 창의 최소 embed host 범위, 비영구 partition, navigation·권한 차단,
  세 플랫폼 실제 단축키와 창→브라우저 인계를 검증하기 전에는 공개 출시하지 않는다.

## 3. 공개 정적 웹 배포

- [ ] `npm run build` 뒤 `npm run package:web`으로 만든 검증 ZIP만 배포한다.
- [ ] 컷 전용 Electron 창·`kirinuki-engine://cut`·일회성 editor handoff를 처음
  요구하는 웹은 로컬 엔진 최소 버전을 `3.0.1` 이상으로 검사한다. `3.0.0` 이하를
  감지하면 custom protocol을 호출해 무응답으로 만들지 않고 같은 stable install
  path의 최신 서명 installer를 먼저 안내한다.
- [ ] 전환 순서는 **서명된 3.0.1+ 세 installer publish → remote size·SHA-256·서명
  readback → 그 release channel을 고정한 웹 build → 웹 원자적 교체**다. 새 웹을
  installer보다 먼저 공개하거나, 새 앱을 요구하는 웹과 구버전 installer 링크를
  동시에 제공하지 않는다.
- [ ] 교체 직후 일반 시작 URL과
  `/?kirinukiSurface=cut-host`의 실제 HTTPS bytes·cache header를 각각 확인하고,
  이전 `studio.js`/HTML cache가 섞이지 않도록 release version과 immutable asset
  query가 모두 바뀌었음을 확인한다.
- [ ] rollback은 `3.0.1+` 컷 host 계약을 이해하는 직전 호환 웹으로만 수행한다.
  컷-host query를 모르는 구 UI로 되돌려 Electron 안에서 full editor navigation을
  유도하지 않는다.
- [ ] 서명된 엔진 Release 전의 일반 build에는 installer URL이 없고 **설치 파일
  준비 중**으로 표시된다.
- [ ] installer 링크를 여는 배포는 published remote asset 전체의 exact
  size·SHA-256 digest readback 뒤 `npm run build:web:release`로 별도 생성했으며,
  tag-pinned 세 URL만 포함하고 runtime GitHub API/`latest` 조회가 없다.
- [ ] `web/`은 full editor allowlist와 고지 파일만 포함하고 source map, test fixture,
  cache, key, `.env`, 설치 executable을 포함하지 않는다.
- [ ] 시작 화면과 `editor.html` deep link가 모두 exact HTTPS origin에서 직접
  동작하며 새로고침이 프로젝트를 잠그거나 다른 프로젝트로 바꾸지 않는다.
- [ ] CSP는 `'self'`와 필요한 공식 embed, exact `http://127.0.0.1:4319`만
  허용하며 wildcard LAN, `localhost`, 임의 port, remote script를 허용하지 않는다.
- [ ] `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, 최소
  `Permissions-Policy`, 적절한 COOP/CORP와 HSTS를 실제 HTTPS 응답에서 확인했다.
- [ ] Cloudflare Tunnel은 public static origin으로만 ingress하고 사용자 PC의
  loopback, LAN 또는 engine port를 tunnel에 연결하지 않는다.
- [ ] Cloudflare Auto Minify, Rocket Loader, HTML rewriting, Email Address
  Obfuscation과 NEL/Report-To를 꺼 release bytes와 실제 응답을 대조할 수 있다.
- [ ] analytics, telemetry, fingerprinting, session replay, 광고 식별자, login,
  cookie와 서버 저장 project가 없다.
- [ ] 정적 host나 Tunnel이 access log/metric을 보존한다면 사용자 무수집 정책과
  맞게 비활성화·최소화하고 운영 evidence를 남겼다.
- [ ] 광고를 도입할 경우 source URL, project, capability, local media metadata를
  광고 SDK에 전달하지 않고 개인정보·동의·라이선스를 별도 승인한다.

## 4. HTTPS 웹↔loopback 보안

- [ ] engine listener는 `127.0.0.1`에만 bind하고 IPv6/LAN/공인 interface로
  노출되지 않는다.
- [ ] 정확한 `https://kirinuki.eff0rtchung.kr` Origin, exact Host와 protocol
  header만 허용하고 missing/`null`/lookalike Origin을 거절한다.
- [ ] `Forwarded`, `X-Forwarded-Host` 등 proxy header로 Host 검사를 우회할 수 없다.
- [ ] 편집기 문서마다 32-byte memory-only nonce와 짧은 bearer capability를
  발급하고 disk, IndexedDB, URL, log에 저장하지 않는다.
- [ ] capability는 project ID, canonical source URL, `vod`/`captions`/
  `cache-delete` action에 묶이며 scope 확대·재사용·만료 후 사용을 거절한다.
- [ ] POST/JSON route는 Content-Type, body size, schema, unknown field와 method를
  fail closed한다.
- [ ] `<video>` media GET/HEAD는 exact Origin과 job별 추측 불가능한 access value,
  exact range·ownership을 확인한다.
- [ ] DNS rebinding, CSRF, 다른 탭 nonce, 다른 project/source/action, malformed
  bearer, OPTIONS preflight, redirect와 timing race를 negative test했다.
- [ ] 엔진 재시작 뒤 웹은 새 capability를 자동 발급받고 사용자가 다시 설치하거나
  연결 설정을 열지 않는다.
- [ ] 컷 창은 exact public top frame만 허용하고 popup, webview, download, 임의
  navigation과 모든 permission request를 차단한다.
- [ ] preload는 context isolation·sandbox·최소 API를 유지하고 renderer payload를
  main process가 source·범위·크기·schema·권리 확인까지 다시 검증한다.
- [ ] 컷→브라우저 handoff는 기존 device proof와 ECDH/AES-GCM channel, 짧은 TTL,
  project/source scope, 단일 claim ID, ACK·replay tombstone을 사용한다.
- [ ] handoff URL에는 payload·source·project·token·key가 없고 opaque nonce fragment는
  브라우저가 읽는 즉시 제거한다.

## 5. 프로젝트·세션·캐시 의미

- [ ] 로그인 또는 서버 session이 없고 탭을 닫으면 저장하지 않은 작업 폐기가
  기본이다.
- [ ] 사용자가 **지금 저장** 또는 복구를 명시적으로 선택한 경우에만 브라우저
  origin storage에 작업이 남는다.
- [ ] 새로고침은 같은 project/workspace를 다시 열며 “편집기를 잠갔습니다” 같은
  일회성 잠금이 없다.
- [ ] A 작업을 닫고 B 작업을 열면 project generation, source binding, capability,
  pending async response가 원자적으로 교체되고 A의 media가 B에 섞이지 않는다.
- [ ] 같은 롱폼의 여러 쇼츠는 독립 ID·저장·media ownership을 가지며 사용자가
  이름과 source/range로 구분할 수 있다.
- [ ] stale recovery는 자동 적용하지 않고 exact project/source/workspace를
  보여 준 뒤 사용자가 선택하게 한다.
- [ ] cache 목록에서 source, range, size, last-used와 owner를 이해할 수 있고 다른
  project 또는 사용자 원본을 삭제하지 않는다.
- [ ] token, signed CDN URL, cookie, authorization header를 project, receipt,
  recovery, log 또는 telemetry에 저장하지 않는다.

## 6. 세 플랫폼 VOD·시간축 검증

- [ ] CHZZK·YouTube·SOOP의 공개 완료 VOD를 각각 URL → 구간 → 웹 편집기 → 설치
  엔진의 실제 경로로 준비했다.
- [ ] 로그인 필요, private, DRM, 지역 제한, live 원본을 우회하지 않고 안전하게
  거절한다.
- [ ] 요청 범위 앞뒤 decode margin을 받아도 편집기의 원본 시각은 사용자가 입력한
  start/end를 그대로 유지한다.
- [ ] 0초가 아닌 시작, 매우 긴 VOD, part 경계, 겹친 range, 앞/뒤 확장, 재사용,
  취소·재시도를 검증한다.
- [ ] playlist/part identity는 pre/post로 비교하고 실제 원본 교체는 publish 전에
  차단하되 제목·timestamp·signed URL의 무해한 변화는 원본 교체로 오인하지 않는다.
- [ ] 완성 media의 byte, hash, duration, stream, timestamp mapping을 검증한 뒤에만
  project binding을 원자적으로 교체한다.
- [ ] 요청 중 project/source가 바뀌면 stale result를 폐기하고 캐시·UI를 오염시키지
  않는다.
- [ ] 자막은 자유롭게 이동·분할할 수 있고 전역 4초 상한이 없다. 4초는 AudSeg의
  초기 segmentation 규칙일 뿐이다.
- [ ] 컷 순서·z-order·visibility·crop·audio가 preview와 최종 export에서 동일하다.

## 7. 엔진 설치·자동 시작·제거

- [ ] Windows x64 NSIS, macOS arm64 DMG, Linux x64 deb를 각 native runner에서
  실제 설치한다.
- [ ] 첫 실행이 자동 시작을 등록하고 readback하며, 두 번째 실행은 중복 engine을
  만들지 않는다.
- [ ] background 시작에는 BrowserWindow/webContents가 0이며, 명시적인 컷 요청에만
  격리된 창 하나가 열리고 편집기 인계가 확인된 뒤 닫힌다.
- [ ] port를 다른 process가 차지하면 그 process를 종료하거나 takeover하지 않고
  명확히 fail closed한다.
- [ ] 정상 종료·취소·timeout·crash 뒤 gateway와 child process, temp directory가
  남지 않는다.
- [ ] uninstall이 autostart·engine process·앱 전용 data를 제거하고 다른 앱이나
  사용자 원본은 보존한다.
- [ ] Windows Job Object, POSIX process group과 PID identity로 descendant orphan과
  PID 재사용 오종료가 없음을 실제 OS에서 검사한다.
- [ ] 자동 업데이트나 숨은 poll이 없고 protocol upgrade는 사용자의 명시적
  installer 재실행으로만 수행한다.

## 8. 웹 bundle 라이선스

<!-- attribution-id: mediabunny -->
- [ ] Mediabunny 1.51.0 MPL-2.0 원문, 수정 여부, exact corresponding source를
  웹 ZIP과 함께 제공한다.
<!-- attribution-id: audseg -->
- [ ] AudSeg 0.1.0 MIT 원문과 compiled editor/worker의 `@license`를 보존한다.
<!-- attribution-id: pretendard -->
- [ ] Pretendard 1.3.9 WOFF2, OFL-1.1 원문과 Reserved Font Name을 제공한다.
<!-- attribution-id: paperlogy -->
- [ ] Paperlogy 1.001 pinned WOFF2와 OFL-1.1 원문을 제공한다.
- [ ] `web/THIRD_PARTY_NOTICES.md`가 canonical
  `legal/WEB_THIRD_PARTY_NOTICES.md`와 byte-for-byte 일치한다.

## 9. 엔진·도구 라이선스

<!-- attribution-id: desktop-local-engine-runtime -->
- [ ] Electron `43.4.1` archive URL·size·SHA-256, `LICENSE`,
  `LICENSES.chromium.html`, Chromium·Node SBOM을 target별로 기록했다.
- [ ] electron-builder `26.15.3`, asar, packager, fuses와 모든 transitive build
  package의 exact artifact/license 및 최종 비포함 여부를 검사했다.
<!-- attribution-id: yt-dlp -->
- [ ] source-run Unix zipimport와 installer target standalone을 구분하고 각각
  yt-dlp·Python·EJS·Meriyah·Astring 등의 실제 고지를 제공했다.
<!-- attribution-id: ffmpeg -->
- [ ] target별 `ffmpeg -version`·`-buildconf`·linked components를 기록하고
  `--enable-nonfree`가 있으면 자동 배포를 **차단**한다.
<!-- attribution-id: ffprobe -->
- [ ] ffprobe가 FFmpeg와 동일한 검증된 build family인지 확인했다.
<!-- attribution-id: whisper-cpp -->
- [ ] whisper.cpp source·hash·MIT 원문을 보존하고 binary 배포 시 실제 linked
  ggml·cpp-httplib·nlohmann/json·stb_vorbis·miniaudio를 다시 조사했다.
<!-- attribution-id: openai-whisper-models -->
- [ ] Whisper model lineage·revision·size·hash·MIT 고지를 기록했다.
<!-- attribution-id: silero-vad -->
- [ ] Silero VAD 원본·conversion revision·size·hash·MIT 고지를 기록했다.
<!-- attribution-id: nodejs -->
- [ ] Node를 새 산출물에 넣으면 해당 binary의 full license/notices를 제공한다.
<!-- attribution-id: python -->
- [ ] Python을 새 산출물에 넣으면 PSF 및 bundled notices를 제공한다.
<!-- attribution-id: chromium -->
- [ ] system browser와 Electron bundled Chromium을 구분해 각각 inventory한다.
<!-- attribution-id: tsx-runtime -->
- [ ] repository-local tsx·esbuild·platform package의 exact MIT 고지를 유지한다.
<!-- attribution-id: typescript-toolchain -->
- [ ] TypeScript/types package가 build-only인지 최종 artifact scan으로 확인한다.

## 10. 상업 이용·외부 서비스·CI

- [ ] [`legal/COMMERCIAL_USE_POLICY.md`](COMMERCIAL_USE_POLICY.md)의 positive
  allowlist를 실행하고 NonCommercial, Commons Clause, PolyForm, SSPL, BUSL,
  Elastic License, Prosperity, LicenseRef, NOASSERTION, unknown을 fail closed한다.
- [ ] 광고 SDK, consent manager, 결제 또는 analytics dependency를 추가했다면
  모든 transitive package·remote script를 registry와 SBOM에 먼저 등록했다.
<!-- attribution-id: chzzk-service -->
- [ ] CHZZK 이름·링크가 공식 제휴를 암시하지 않고 현재 약관·접근 조건을 확인했다.
<!-- attribution-id: youtube-service -->
- [ ] YouTube 이름·embed·접근 방식이 공식 제휴를 암시하지 않고 login/cookie/DRM을
  우회하지 않는다.
<!-- attribution-id: soop-service -->
- [ ] SOOP 이름·링크가 공식 제휴를 암시하지 않고 공개 완료 VOD만 지원한다.
- [ ] 접근 가능성을 다운로드·편집·게시 허가로 간주하지 않고 사용자 권리 확인과
  게시 전 human review를 유지한다.
<!-- attribution-id: github-actions-ci -->
- [ ] GitHub Actions 세 항목을 mutable tag가 아닌 full commit SHA로 고정하고 MIT
  대응 소스·runner image·최소 권한을 release evidence에 기록했다.
- [ ] C/C++ compiler, CMake, CUDA toolkit과 linked native library를 사용했다면
  재현 가능한 build manifest를 보관했다.

## 11. 최종 승인

- [ ] `npm ci --ignore-scripts`, typecheck, build, validate, license check, unit,
  browser, package, installer, security, live VOD smoke를 같은 commit에서 통과했다.
- [ ] 웹 ZIP과 실제 HTTPS 응답을 대조하고 cookie/session/reporting header가 없음을
  확인했다.
- [ ] Linux x64·Windows x64·macOS arm64에서 실제 install→autostart→웹 자동 감지→
  3플랫폼 부분 준비→편집→export→uninstall을 검증했다.
- [ ] Electron/Chromium/Node, FFmpeg, yt-dlp를 포함한 target별 SBOM·notice·
  corresponding source·digest를 보관했다.
- [ ] Windows 서명/timestamp와 macOS 서명/notarization/staple readback을 완료했다.
- [ ] 보안·개인정보·데이터 보존·플랫폼 약관 검토를 라이선스 검토와 별도로
  완료했다.
- [ ] 승인자는 이 체크리스트가 법적 보증이 아니라 evidence gate임을 이해하고
  실제 산출물 기준으로 서명했다.
