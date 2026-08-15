# Web deployment license and provenance checklist

현재 기본 실행은 고정 `http://127.0.0.1:4320` localhost 웹 UI와
`127.0.0.1:4319` gateway, 선택적인 private `127.0.0.1:4318` Whisper 엔진을
사용합니다. 이 체크리스트는 이를 원격 웹 서비스, worker, container 또는
desktop installer로 옮길 때 기존 provenance와 local/remote 보안 경계를 잃지
않기 위한 release gate입니다. 이전 브라우저 확장 Origin에서 localhost로 옮기는
단발성 호환 endpoint는 남아 있지만, 과거 전체 확장 bundle은 현재 릴리스
산출물이 아닙니다. 법률 자문이나 “문제가 절대 없다”는 보증이 아니며, 실제 출시
지역·배포 형태·수익 모델은 전문가 검토가 필요할 수 있습니다.

## 0. 광고·유료·SaaS 상업 이용 license gate

- [ ] [`legal/COMMERCIAL_USE_POLICY.md`](COMMERCIAL_USE_POLICY.md)의 exact
  positive allowlist를 release 기준으로 다시 확인했다.
- [ ] 코드·글꼴·모델·asset·WASM·runtime·container·CDN 항목에 CC-NC 등
  NonCommercial, Commons Clause, PolyForm restricted-use, SSPL, BUSL/Business
  Source License, Elastic License, Prosperity, 매출·업종·field-of-use·경쟁·
  SaaS/hosting 제한이 하나도 없다.
- [ ] `LicenseRef-*`, `SEE LICENSE IN ...`, `UNLICENSED`, `NOASSERTION`, unknown,
  원문 누락을 사람이 추측한 SPDX ID로 바꾸지 않고 배포를 차단했다.
- [ ] `build-dependent`, `external-terms`, `mixed-see-packages`를 라이선스 허가로
  취급하지 않고 각각 비재배포 system/service/dev·CI kind에만 사용했다.
- [ ] 현재 허용 license가 상업 이용 자체를 막지 않는다는 확인과 별개로 MPL-2.0
  대응 소스·고지, OFL-1.1 원문·RFN·수정명, MIT/ISC/Apache notice 의무를
  최종 산출물에서 이행했다.
- [ ] 광고 SDK, analytics/telemetry, consent manager, 결제 SDK와 그 transitive
  package·원격 script를 도입 전에 registry/SBOM에 넣고 같은 gate를 통과시켰다.
- [ ] 광고·수익 모델에 관한 개인정보·쿠키 동의·플랫폼 계약·콘텐츠 권리는
  dependency license와 별도 검토했다. 이 체크리스트를 법적 보증으로 표현하지
  않았다.

## 1. 실제 산출물부터 동결

- [ ] canonical 루트 `UNLICENSE`를 유지하고, Popovic가 extensionless
  `web/UNLICENSE`를 누락하는 경계를 피하도록 같은 원문을
  `web/licenses/UNLICENSE.txt`에 포함했다. “first-party에만 적용되며
  third-party를 재허가하지 않음” 고지도 최종 산출물에서 확인했다.
- [ ] `legal/FIRST_PARTY_RIGHTS_REVIEW.md`의 기여자 권리·Unlicense
  동의 gate를 사람이 완료했다.
- [ ] web bundle, 최소 streaming companion manifest/JS, source map, WASM,
  worker, font, model, container layer,
  downloadable CLI와 CDN asset의 정확한 목록을 생성했다.
- [ ] 각 항목을 `src/lib/third-party-attributions.ts`의 ID와 연결했다.
- [ ] lockfile만 보지 않고 최종 bundle/container/SBOM을 직접 검사했다.
- [ ] floating URL, `latest`, unverified installer와 런타임 plugin이 없다.
- [ ] 재배포 download는 immutable URL + exact byte size + SHA-256이 모두 있다.
- [ ] web 정적 파일, 최소 streaming companion, 로컬 runtime의 고지 범위를 실제
  배포 경계대로 분리했다. 단발성 Origin migration 호환 코드를 과거 bundle의
  재배포로 잘못 표시하지 않았다.

## 2. 브라우저 bundle

- [ ] localhost 단계에서 exact `http://127.0.0.1:4320` Origin, 4319 gateway,
  선택적 private 4318 경계를 지키며 최소 streaming companion 밖의 광범위한
  브라우저 권한이나 다른 탭 접근을 요구하지 않는다.
- [ ] 공개 배포용 최소 companion build와 각 사용자 PC의 VOD runtime·caption stack
  setup에 exact `KIRINUKI_ALLOWED_ORIGIN=https://kirinuki.eff0rtchung.kr`를 동일하게
  적용했다. 다른 HTTPS Origin, wildcard, trailing slash와 혼합 localhost/public
  companion build가 모두 거절되는지 확인했다.
- [ ] Popovic 같은 정적 서버는 HTML의 Studio Origin token을 응답 시점에 바꾸지
  못한다. 따라서 tracked `web/`의 token은 문서 Origin이 위 exact 공개 Origin일
  때만 자체 해석되고, 임의 host에서는 실패하는지 확인했다. `studio.css`,
  `studio.js`, `editor.css`, `editor.js`, AudSeg worker의 package-version query가
  한 릴리스에서 일치해 immutable cache를 확실히 갱신하는지도 검사했다.
- [ ] Popovic Git 앱의 repository 등록에 `repo_subdir=web`과
  `hostnames=kirinuki.eff0rtchung.kr`를 설정했다. `web/.popovic-hosts`는
  mounted-source용이며 Git 배포에서 복사되지 않는다는 경계를 혼동하지 않았다.
- [ ] Popovic의 `Store::record_red`를 완전 no-op으로 만들고, 프로세스를 정상
  정지한 뒤 실제 `$POPOVIC_HOME/popovic.json`의 `metric_buckets`를 비웠다. 정적
  요청 후 15초 저장 주기를 지나도 모든 RED request/error가 0이고 app RED가 비어
  있어 사용기록을 남기지 않는지 확인했다.
- [ ] Popovic 또는 Cloudflare 응답에 `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, 최소 `Permissions-Policy`, COOP·CORP를 설정하고 HTML별
  CSP에 `frame-ancestors 'none'`을 넣었다. HTTPS edge에는 1년 HSTS를 적용하되
  부모 도메인 전체 정책을 확인하기 전 `includeSubDomains`·`preload`는 넣지 않았다.
- [ ] Cloudflare Tunnel은 `kirinuki.eff0rtchung.kr` Host와 HTTPS를 보존하며
  Popovic 정적 listener로만 연결한다. 로컬 4320과 사용자 PC의 4318/4319를 Tunnel
  ingress나 LAN 주소에 노출하지 않았고 두 runtime이 `127.0.0.1`에만 bind함을
  socket 수준에서 확인했다.
- [ ] Chromium의 공개 HTTPS→loopback LNA 권한 프롬프트를 최초 연결 UX에서
  설명하고, 허용·거절·재시도 모두를 실제 브라우저에서 검증했다. 구형 PNA 호환
  header가 wrong Origin이나 일반 응답에 노출되지 않는지도 확인했다.
- [ ] client-side source viewer는 YouTube·SOOP 공식 embed와 CHZZK canonical VOD
  page만 frame하며, undocumented CHZZK VOD embed route를 만들지 않고 항상 보이는
  new-tab fallback을 제공한다.
- [ ] viewer stream은 server proxy·cookie·token 경로가 없고 시간 선택용 frame과
  로컬 materialized edit media의 데이터 흐름·보존·권리 고지를 분리했다.
- [ ] CSP `frame-src`의 세 exact HTTPS Origin과 source URL canonicalization을
  산출물에서 확인하고 unsupported path·spoof host가 fail-closed함을 테스트했다.
- [ ] 고정 port를 바꾸면 IndexedDB Origin이 달라진다는 점과 one-shot 저장소
  migration을 release/data migration 계획에 명시했다. migration은 기본·공개
  모드에서 닫혀 있고, 명시적으로 켠 loopback 서버가 exact 이전 Origin과
  분리된 single-use nonce를 검증한 뒤 한 번만 소비하는지 확인했다.
- [ ] 1세션 1편집 완료·내보내기 검증 뒤 exact consumer 소유 캐시만 정리하고,
  중복 탭·검증 실패·일반 다운로드 fallback에서는 삭제하지 않는 계약을 보존한다.

<!-- attribution-id: mediabunny -->
- [ ] Mediabunny 1.51.0 MPL-2.0 고지, 전체 license, 수정 여부와 exact
  corresponding source 접근 경로를 릴리스와 함께 제공한다.
<!-- attribution-id: audseg -->
- [ ] AudSeg 0.1.0 MIT 원문과 저작권 고지를 유지하고 esbuild 결과의
  `@license` 주석이 살아 있는지 확인한다.
<!-- attribution-id: pretendard -->
- [ ] Pretendard 1.3.9 WOFF2와 OFL-1.1 원문, Reserved Font Name 고지를
  함께 제공한다.
<!-- attribution-id: paperlogy -->
- [ ] Paperlogy 1.001 pinned WOFF2와 OFL-1.1 원문을 함께 제공한다.
- [ ] `licenses.html`을 키보드와 스크린리더로 열 수 있고 모든 로컬 license
  링크가 실제 패키지 안에 있다.
- [ ] minifier/banner 변경 뒤에도 license comments와 notice 파일을 검사한다.
- [ ] 쇼츠 영상의 `원본 crop → canonical destination → 실제 축별 확대율` 품질
  계획이 UI·미리보기·worker·최종 출력에서 같은 의미와 좌표를 사용한다.
- [ ] 웹 저장 schema에서는 각 영상 레이어의 crop을 source asset ID·원본 clock
  range·scene-local range·decoded display transform·authored display size와 함께
  묶고, 같은 화면비의 해상도 변경만 명시적으로 rebase한다. v1~v4 fit/focal
  필드는 v5 import 경계에서만 변환한다.
- [ ] v5 다중 영상 장면은 레이어별 독립 clock을 단조 증가 방향으로 decode하고,
  결정적인 z-order·visibility·opacity를 적용한 뒤 이미지·자막을 합성한다. 추가
  영상 음성을 묵시적으로 섞지 않으며 현재의 `project-primary` source 경계를
  넘어서는 서로 다른 파일은 asset registry가 생기기 전까지 fail closed한다.
- [ ] WebGL2 고품질 경로는 세션 내 capability·정확성·시간 budget을 통과한
  경우에만 켠다. 미리보기 오류는 같은 canonical 좌표의 Canvas2D 경로로
  전환하고, 최종 출력에서 적응형 프레임 뒤 오류가 나면 부분 출력을 폐기한
  다음 Canvas2D로 처음부터 한 번만 재시작해 한 파일에 backend를 섞지 않는다.
- [ ] GPU vendor/renderer 문자열을 사용자 식별이나 analytics에 사용·저장·전송하지
  않으며, 품질 경로 선택에 필요한 일시적 계측도 세션 밖으로 남기지 않는다.
- [ ] 임의 crop·비등방 확대·부분 off-canvas·회전 영상·1픽셀 배치와 저메모리
  기기를 실제 브라우저에서 검증하고, 보정이 원본에 없던 사실적 디테일을
  복원한다고 표시하지 않는다.

## 3. 로컬/서버 AI runtime

<!-- attribution-id: whisper-cpp -->
- [ ] whisper.cpp source commit, archive hash와 MIT 원문을 보존한다.
- [ ] 배포할 `whisper-server` binary의 compile flags, link map 또는 동적
  library 목록을 캡처했다.
- [ ] cpp-httplib, nlohmann/json, stb_vorbis, miniaudio, ggml 및 활성 backend의
  실제 포함 여부를 확인하고 필요한 원문·저작권 고지를 묶었다.
<!-- attribution-id: openai-whisper-models -->
- [ ] OpenAI Whisper model lineage, converted repository revision, 선택한
  model의 exact size/hash와 MIT 고지를 기록했다.
<!-- attribution-id: silero-vad -->
- [ ] Silero VAD 원본 프로젝트, conversion revision, exact size/hash와 MIT
  고지를 기록했다.
<!-- attribution-id: yt-dlp -->
- [ ] yt-dlp 2026.07.04 exact artifact와 Unlicense를 기록했다.
- [ ] bundled yt-dlp-ejs 0.8.0(Unlicense), Meriyah 6.1.4(ISC), Astring
  1.9.0(MIT) header를 재패키징 과정에서 제거하지 않았다.
- [ ] 로컬 실행과 서버 실행의 플랫폼 약관·콘텐츠 권한 차이를 별도 검토했다.

## 4. FFmpeg container hard gate

<!-- attribution-id: ffmpeg -->
<!-- attribution-id: ffprobe -->
- [ ] 최종 image 안에서 `ffmpeg -version`, `ffmpeg -buildconf`,
  `ffprobe -version` 출력을 release evidence로 저장했다.
- [ ] `--enable-nonfree`가 하나라도 있으면 자동 배포를 **차단**한다. 단순 고지로
  통과시키지 않는다.
- [ ] `--enable-gpl`, linked GPL library, LGPL-only build를 구분했다.
- [ ] codec library, hardware backend, CUDA/NVENC 등 외부 component의 실제
  license와 redistributability를 image 단위로 조사했다.
- [ ] 요구되는 notice, exact corresponding source/source offer, relink 조건과
  build scripts를 배포 방식에 맞게 제공한다.
- [ ] codec patent와 콘텐츠 권리는 오픈소스 라이선스 준수와 별개로 검토했다.

“시스템 FFmpeg를 썼다”는 현재 전제는 container image에 FFmpeg를 넣는 순간
끝납니다. distro package 이름만으로 허가하지 않고 최종 binary buildconf를
기준으로 판정합니다.

## 5. Host runtimes and build tools

<!-- attribution-id: nodejs -->
- [ ] Node.js를 image/installer에 넣으면 해당 배포본의 full license 및 bundled
  component notices를 포함한다.
<!-- attribution-id: python -->
- [ ] Python을 넣으면 해당 배포본의 PSF license와 bundled component notices를
  포함한다.
<!-- attribution-id: chromium -->
- [ ] Chromium/Chrome/ChromeDriver를 넣으면 provider/build별 라이선스와
  redistribution 조건을 확인한다. “테스트에만 설치”와 “고객에게 배포”를
  구분한다.
<!-- attribution-id: tsx-runtime -->
- [ ] 현재 로컬 companion이 실행 중 사용하는 tsx·esbuild·해당 OS
  platform package를 production SBOM에 포함하고 MIT 고지를 배포한다.
- [ ] companion을 미리 컴파일해 tsx를 제거했다면 최종 image/installer에
  정말 남지 않았는지 SBOM과 파일 스캔으로 입증한다.
<!-- attribution-id: typescript-toolchain -->
- [ ] build image에만 있는 TypeScript/types와 production layer의 npm
  runtime을 SBOM에서 구분한다.

## 6. 외부 서비스·상표·콘텐츠 권리

<!-- attribution-id: chzzk-service -->
<!-- attribution-id: youtube-service -->
<!-- attribution-id: soop-service -->
- [ ] CHZZK, YouTube, SOOP 명칭·URL·아이콘 사용이 제휴나 공식 승인을 암시하지
  않는다.
- [ ] 각 플랫폼의 현재 약관, robots/API 정책과 기술적 접근 방식을 출시 시점에
  다시 확인한다.
- [ ] YouTube viewer가 privacy-enhanced embed와 문서화된 `YT.Player`만 쓰고,
  raw `postMessage` 내부 규약이나 서버 proxy로 되돌아가지 않았는지 확인한다.
- [ ] 사용자가 공개 페이지를 볼 수 있다는 사실을 다운로드·편집·게시 허가로
  간주하지 않는다.
- [ ] per-use 권리 확인, 제3자 음원·게임·게스트 권리와 게시 전 human review를
  기술적 gate와 운영 정책에 유지한다.

## 7. 출시 증거와 승인

<!-- attribution-id: github-actions-ci -->
- [ ] AudSeg Python package/build image를 배포한다면 `hatchling`, `pytest`,
  `pytest-cov`, `ruff`의 floating 범위를 exact lock/artifact로 바꾸고 실제
  라이선스·해시를 기록했다.
- [ ] 현재 GitHub Actions full commit SHA 세 개와 대응 소스·MIT 원문을
  재확인하고, action 권한·업데이트 절차 및 runner image를 release evidence에
  기록했다.
- [ ] whisper.cpp를 빌드한 C/C++ compiler, CMake, CUDA toolkit·linked native
  library의 실제 버전·라이선스·build manifest를 보관했다.
- [ ] `npm run license:check`, `npm run build`, `npm run validate`, unit/browser
  tests와 release archive 검사를 같은 commit에서 통과했다.
- [ ] 일반 `npm run test:browser`가 과거 전체 확장 build/package/test에 의존하지
  않는 web E2E인지 확인했고, CI가 tracked `web/`과 `streaming-companion/`의
  생성물 drift를 모두 거부했다.
- [ ] 생성한 SBOM, dependency scan, license texts, 대응 소스 URL, exact hashes,
  FFmpeg buildconf와 container digest를 release record에 보관했다.
- [ ] 보안·개인정보·데이터 보존 검토를 라이선스 검토와 별도로 완료했다.
- [ ] 새 관할권, 상업적 호스팅 또는 불명확한 의무는 출시 전에 자격 있는
  전문가에게 확인했다.
- [ ] 출시 승인자는 이 체크리스트가 법적 보증이 아니라 evidence checklist임을
  이해하고 실제 산출물에 서명했다.
