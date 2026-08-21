# Kirinuki 거버넌스

Kirinuki는 maintainer-led 오픈소스 프로젝트입니다. 제안과 검토는 공개 저장소에서
진행하며, 최종 merge·release 권한은 저장소 maintainer가 가집니다. 기여 횟수만으로
commit 또는 release 권한이 자동 부여되지는 않습니다.

## 의사결정 우선순위

1. 사용자 원본·프로젝트·기기와 로컬 엔진의 안전
2. 로그인·추적 없이 일반 웹사이트처럼 쓰는 흐름
3. 완성된 편집 기능과 사용자 확정 시간축의 보존
4. 클라이언트 우선 처리와 공개 서버 부담 최소화
5. 로딩 속도와 유지보수성

호환되지 않는 선택지는 영향, 대안, 보안·개인정보·운영 trade-off와 검증 증거를
남긴 뒤 결정합니다. `kirinuki-local-media-engine/v1`의 breaking change는 같은
이름으로 덮지 않고 병렬 protocol로 다룹니다.

## 변경과 출시

- 일반 변경은 관련 테스트와 문서가 함께 통과해야 merge할 수 있습니다.
- 보안상 중요한 변경은 threat boundary와 실패 시 동작을 별도로 검토합니다.
- 외부 실행 바이너리의 출처·hash·라이선스와 공개 installer release record는
  maintainer 외 독립된 두 번째 사람의 검토가 없으면 승인하지 않습니다.
- 서명·공증·provenance·3OS native smoke 중 하나라도 불완전하면 공개 다운로드를
  열지 않습니다.
- 긴급 보안 수정도 개인정보 비수집, exact-origin, fail-closed cleanup과 서명된
  배포 경계를 우회할 수 없습니다.

프로젝트 방향에 큰 영향을 주는 변경은 issue 또는 proposal에서 먼저 논의합니다.
보안 취약점은 공개 논의 전에 [보안 정책](SECURITY.md)의 비공개 신고 경로를
사용해 주세요.
