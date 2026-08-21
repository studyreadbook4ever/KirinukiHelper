# Security Policy

## 신고 방법

보안 문제는 공개 issue 대신 **lostfragment@naver.com**으로 보내 주세요. 영향받는
commit 또는 버전, 재현 조건, 예상 영향과 최소 재현 자료를 포함하되 실제 사용자
데이터, 계정 cookie, VOD 접근 token 또는 개인 키는 보내지 마세요. 수정과 공개
시점이 정해지기 전에는 제3자 플랫폼이나 다른 사용자를 대상으로 검증하지 말아
주세요. 현재 별도 bug bounty 지급 약속은 없습니다.

현재 공개 서명 release는 아직 승인되지 않았습니다. 지원 보안 경계는 기본 branch의
현재 코드와, 향후 이 저장소가 공식 배포했다고 명시한 최신 서명 release입니다.

## 시스템과 범위

- `kirinuki.eff0rtchung.kr`의 정적 웹 편집기
- Windows x64, macOS arm64, Linux x64의 화면 없는 로컬 미디어 엔진과 installer
- loopback pairing, capability, 암호화된 control session과 로컬 media access
- CHZZK·YouTube·SOOP 공개 완료 VOD의 구간 준비와 외부 도구 실행
- build, signing, provenance, release workflow와 배포 산출물

공개 웹·VOD metadata·사용자 입력 URL·프로젝트 파일·다른 웹 Origin·LAN peer·같은
기기의 다른 프로세스는 신뢰하지 않습니다. 운영체제, 브라우저 보안 경계와 검토된
서명 키는 신뢰 기반입니다.

## 반드시 지켜야 하는 보안 불변식

- 엔진은 loopback에만 bind하고 exact public Origin·Host·fresh challenge·문서별
  capability와 project/source scope를 검증해야 합니다.
- token, 원본 URL과 control payload는 평문 loopback에 남기지 않고 replay와 다른
  프로젝트 재사용을 거절해야 합니다.
- 로그인, 서버 저장 session, analytics, telemetry 또는 숨은 update polling을
  만들지 않아야 합니다.
- 외부 도구는 고정 출처·크기·hash로 검증하고 shell이나 사용자 cookie·설정을
  상속하지 않으며, 입력·redirect·출력·시간·프로세스 수를 제한해야 합니다.
- 설치·업데이트·제거는 정확히 소유한 실행 파일, 자식 프로세스, 자동시작·protocol
  등록만 변경해야 하며, 불확실한 경로나 다른 프로세스를 삭제·종료하지 않아야
  합니다.
- 공개 installer는 target별 서명·공증·provenance와 native lifecycle 검증이
  완료되지 않으면 fail closed해야 합니다.

## 신고 가치가 높은 문제

다른 Origin이나 LAN에서 엔진 사용, capability 우회·재사용, loopback token/URL 노출,
임의 명령·경로 접근, 다른 프로젝트나 사용자 파일 혼합·삭제, 외부 도구 공급망
검증 우회, installer signature 또는 release gate 우회, uninstall의 외부 파일·
프로세스 손상은 실제 도달 경로가 있으면 보고 대상입니다.

## 알려진 제한과 범위 밖

최초 정상 pairing 전에 같은 OS 사용자 권한의 악성 프로그램이 custom protocol을
선점하는 TOFU 한계는 알려진 경계입니다. 이미 고정된 기기 키 불일치는 자동 승인하지
않는 것으로 완화합니다. DRM·비공개·로그인 필요·지역 제한 원본 우회는 지원 범위가
아닙니다. 제3자 플랫폼 자체의 취약점, 실제 영향 경로가 없는 dependency 버전 알림,
사용자가 개발자 도구에 직접 실행한 코드만으로 생기는 self-XSS는 이 저장소의
취약점으로 보지 않습니다. 다만 Kirinuki 경계를 통해 현실적으로 도달한다면
신고해 주세요.
