# First-party rights review

KirinukiHelper는 권리자가 허락한 자체 작성 코드를 `UNLICENSE`로
퍼블릭 도메인에 헌정합니다. 이 문서는 다른 사람의 저작권을
임의로 변경하거나 third-party 라이선스를 Unlicense로 재허가하지
않도록 웹 배포 전에 확인할 first-party provenance gate를 기록합니다.

현재 Git commit 기록에는 둘 이상의 author identity가 있습니다. Git 이름·메일은
같은 사람의 복수 identity일 수도, 자동화·위임 agent일 수도,
실제로 다른 기여자일 수도 있어 자체로 권리 소유나 재허가 동의를
증명하지 않습니다. 그러므로 공개 웹·installer·container 릴리스 전에
다음 항목을 사람이 확인해야 합니다.

- [ ] 모든 실질적 first-party commit의 author가 동일 권리자, 권한을 받은
  agent 또는 명시적 Unlicense 동의를 제공한 기여자임을 확인했다.
- [ ] 고용·용역·양도 관계가 있다면 저작권 소유·재허가 권한의 근거를
  릴리스 기록에 보관했다.
- [ ] 동의를 확인할 수 없는 기여는 해당 코드의 원래 허가 조건을
  보존하거나 제거·대체했다.
- [ ] Mediabunny, AudSeg, 글꼴, whisper.cpp, 모델, yt-dlp/EJS 등은
  `legal/THIRD_PARTY_NOTICES.md`의 별도 권리와 고지를 그대로 유지했다.

## 자체 영상 보정 코드

`src/editor/adaptive-video-scaler.ts`의 품질 계획, WebGL2 제어 코드와 shader는
KirinukiHelper를 위해 작성한 first-party TypeScript/GLSL입니다. 외부 shader,
초해상도 모델, CDN 코드 또는 새 runtime dependency를 포함하지 않습니다.
공개 웹 릴리스 전에는 이 파일의 실제 기여 이력과 위 Unlicense 동의 gate를
다시 확인하며, 이후 외부 알고리즘 구현을 복사하거나 모델·WASM을 붙이면 이를
first-party라고 유지하지 말고 canonical third-party inventory와 고지를 먼저
갱신해야 합니다.

이 checklist가 완료되지 않은 상태에서 `UNLICENSE`는 코드의 형식적
의도를 나타내지만, 모든 기여자의 권리가 확정됐다는 법적 보증은
아닙니다.
