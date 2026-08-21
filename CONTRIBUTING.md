# Kirinuki 기여 가이드

Kirinuki는 완성된 웹 편집기를 유지하면서, 공개 VOD의 사용자가 고른 구간만 이
PC에 준비하는 화면 없는 로컬 엔진을 제공합니다. 기여는 이 제품 경계와
[개발 계약](AGENTS.md)을 먼저 지켜야 합니다.

## 시작하기

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

- 변경 목적, 사용자에게 보이는 차이, 검증 결과와 남은 제약을 함께 적어 주세요.
- 버그 수정에는 가능하면 먼저 실패하는 회귀 테스트를 추가해 주세요.
- 편집기의 컷·자막·레이어 동작을 로컬 엔진 작업과 무관하게 축소하거나
  다시 구현하지 마세요.
- 로그인, 서버 저장 세션, analytics, telemetry, 원격 VOD proxy를 추가하지 마세요.
- 사용자 원본·프로젝트·토큰·서명 URL·쿠키를 로그나 fixture에 넣지 마세요.
- 외부 명령은 배열 인자와 `shell: false`를 사용하고, 입력 경로·URL·응답 크기·
  timeout을 명시적으로 제한해 주세요.

## 의존성과 바이너리

새 npm dependency나 네이티브 도구는 필요한 이유, exact version·출처·hash,
라이선스, 포함되는 target과 제거 방법을 제안에 기록해야 합니다. 공개 설치 파일은
[데스크톱 바이너리 출시 게이트](legal/DESKTOP_BINARY_RELEASE_GATE.md)를 우회할 수
없습니다. 생성된 바이너리나 개인 키·인증서는 commit하지 마세요.

## 호환성과 검토

`kirinuki-local-media-engine/v1`은 additive-only 계약입니다. 기존 필드나 endpoint의
의미를 바꿔야 한다면 기존 v1을 깨지 말고 병렬 protocol을 제안해 주세요. 보안,
개인정보, installer 생명주기, 외부 바이너리 provenance 변경은 일반 코드 검토와
별도로 해당 출시 게이트의 독립 검토가 필요합니다.

기여를 제출하면 프로젝트가 first-party 소스를 [UNLICENSE](UNLICENSE) 조건으로
배포할 수 있음을 확인하는 것입니다. 제3자 자료는 그 자료를 제공할 권한과 정확한
고지를 함께 갖춘 경우에만 제출해 주세요.
