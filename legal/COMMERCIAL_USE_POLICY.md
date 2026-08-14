# Commercial-use dependency policy

KirinukiHelper는 장래의 광고, 유료 배포·구독과 SaaS/호스팅을 염두에 둡니다.
따라서 코드가 공개되어 있다는 이유만으로 dependency, 모델, 글꼴 또는 asset을
받아들이지 않습니다. 이 문서는 **상업 이용을 금지하거나 매출·업종·호스팅
방식에 제한을 두는 조건을 제품 경계에 넣지 않기 위한 공학적 release gate**입니다.
법률 자문이나 특정 사업·관할권의 적법성 보증은 아닙니다.

## Exact positive allowlist

현재 canonical registry가 제품·로컬 runtime에 승인하는 license ID는 아래
여덟 개뿐입니다.

- `Apache-2.0`
- `ISC`
- `MIT`
- `MIT-or-Unlicense`
- `MIT-0-or-Unlicense`
- `MPL-2.0`
- `OFL-1.1`
- `Unlicense`

이 목록은 “상업 이용 자체를 막지 않는다”는 최소 조건과 현재 배포 구조를 함께
검토한 결과입니다. 허용 목록에 없는 라이선스가 곧 비상업 라이선스라는 뜻은
아닙니다. 예를 들어 GPL·AGPL 계열도 상업 이용을 금지하는 라이선스는 아니지만,
배포·네트워크 소스 제공 의무를 별도로 설계하지 않았으므로 현재 positive
allowlist에는 없습니다. `CC0-1.0`, `CC-BY-4.0`, Boost의 `BSL-1.0`처럼 다른
용도에서 상업 이용이 가능할 수 있는 조건도 사람이 실제 원문과 산출물 경계를
검토하고 이 목록·고지·테스트를 함께 바꾸기 전에는 fail closed합니다.

`src/lib/third-party-attributions.ts`가 위 ID를 typed registry로 고정하고,
`npm run license:check`가 npm lockfile의 모든 package, runtime download와 embedded
component를 exact ID로 대조합니다. 공백, 복합 SPDX 식, `LicenseRef-*`, 알 수 없는
값도 자동 추측하거나 비슷한 라이선스로 치환하지 않습니다.

## 허용하지 않는 조건

다음 조건은 별도 유료 계약을 협상했다는 이유로 자동 예외 처리하지 않으며,
현재 공개 배포 코드베이스와 기본 build에는 넣지 않습니다.

- Creative Commons `NC` 및 모든 NonCommercial 조건
- Apache/MIT 등에 덧붙인 **Commons Clause**
- PolyForm Noncommercial, Small Business, Perimeter, Shield, Internal Use, Trial 등
  **PolyForm** restricted-use 계열
- **SSPL**(Server Side Public License)
- **BUSL**/Business Source License와 혼동 가능한 `BSL-1.1`
  (`BSL-1.0`은 별개의 Boost Software License지만 현재 목록에는 없으므로 역시
  사전 검토 없이 통과하지 않음)
- **Elastic License**, **Prosperity** 계열
- 매출 상한, 업종·field-of-use, 경쟁 금지, 비생산·평가판, 사용자 수, 광고,
  유료 서비스 또는 SaaS/호스팅을 제한하는 source-available·custom 조건
- `LicenseRef-*`, `SEE LICENSE IN ...`, `UNLICENSED`, `NOASSERTION`, `unknown`,
  라이선스 누락과 원문을 찾지 못한 구성요소

이 목록은 예시를 열거한 denylist로 끝나지 않습니다. 정확히 승인된 ID가 아니면
무조건 실패하는 positive allowlist가 최종 판정입니다. Open Source Initiative의
정의도 사업 등 특정 field of endeavor를 차별하지 않는 것을 요구합니다:
https://opensource.org/osd

## 현재 허용 항목에도 남는 의무

상업 이용 가능 여부와 고지·소스 제공 의무는 서로 다른 질문입니다.

- **MPL-2.0**: 개인과 회사의 모든 목적 사용을 허용하지만, web editor bundle로
  전달하는 MPL 파일의 원문·고지와 대응 소스 접근 경로를 유지해야 합니다.
  MPL 코드를 수정하면 해당 파일 수준의 소스 의무도 다시 검토합니다.
  https://www.mozilla.org/en-US/MPL/2.0/FAQ/
- **OFL-1.1**: 글꼴을 앱·웹·영상에 사용하고 함께 배포하는 상업 이용을
  금지하지 않지만 글꼴 파일 단독 판매 금지, OFL 원문, Reserved Font Name과
  수정 글꼴 이름 의무를 지킵니다. 현재 Pretendard·Paperlogy WOFF2와 원문은
  파일 단위 hash로 고정합니다.
- **MIT/ISC/Apache-2.0/Unlicense 계열**: 현재 사용 형태에서 상업 이용 자체를
  막지 않더라도 각 저작권·허가 고지, Apache notice/patent 조건, 제3자 embedded
  component를 산출물 단위로 계속 확인합니다.

현재 FFmpeg·ffprobe, Node.js, Python, Chromium은 시스템 제공·비재배포 경계이고
`build-dependent`는 허가가 아니라 경계 표식입니다. installer/container/server
image에 하나라도 포함하는 순간 실제 binary와 linked component를 새로 감사해야
합니다. `external-terms`와 `mixed-see-packages`도 상업 이용 승인 ID가 아니며 각각
비재배포 외부 서비스, exact 하위 package를 가리키는 표식으로만 허용합니다.

## 광고·웹 배포 시 추가 inventory

광고 SDK, analytics/telemetry, consent manager, 결제 SDK, CDN script, UI kit,
아이콘·스톡 이미지·음원, 웹 폰트, 모델, codec, WASM, worker, server package와
container layer도 도입 **전에** canonical registry와 final-artifact inventory에
등록해야 합니다. 무료 요금제나 공개 CDN은 라이선스 승인이 아닙니다. SDK의
소프트웨어 라이선스가 통과해도 개인정보, 쿠키·동의, 광고 플랫폼 계약, 데이터
국외 이전과 보존 정책은 별도 검토 대상입니다.

CHZZK·YouTube·SOOP의 서비스 약관, 상표와 사용자가 편집하는 영상·음원·출연자의
권리는 dependency 라이선스와 별개입니다. 이 gate 통과가 해당 플랫폼 영상의
다운로드, 편집, 게시 또는 수익화를 승인하지 않습니다.

## 변경·출시 절차

1. 새 구성요소를 import·복사·다운로드하거나 광고/analytics snippet을 붙이기
   전에 license 원문, copyright, upstream, exact version/artifact/hash와 실제
   배포 경계를 기록합니다.
2. 현재 positive allowlist ID가 아니거나 addendum·custom terms가 있으면 build에
   넣지 않고 사람의 검토를 거칩니다. 검토 결과를 코드·고지·테스트와 함께
   남기기 전에는 임시 예외 환경 변수로 우회하지 않습니다.
3. `npm run license:check`와 negative fixture를 통과시키고, web bundle,
   최소 streaming companion, source map, server/container SBOM을 실제 산출물
   기준으로 다시 검사합니다.
4. 광고·유료·SaaS 출시 시점의 라이선스 원문과 플랫폼·SDK 약관은 변경될 수
   있으므로 release evidence에 보관하고 사람이 승인합니다.
