# KirinukiHelper 운영·개발 계약

이 파일은 사용자와 자동화 에이전트가 KirinukiHelper를 안전하고 재현 가능하게 운용·수정하기 위한 지속 지침이다. 현재 제품의 자막 초벌 방식은 정확히 둘이다. 새 환경의 기본은 `audseg-local`이며 `whisper-tiny`는 사용자가 Whisper 탭을 열고 이 PC의 실행 상태를 검증해 연결한 뒤에만 사용한다.

1. `whisper-tiny`: 이 기기의 whisper.cpp companion이 한국어 글과 실제 STT 타임스탬프를 만든다.
2. `audseg-local`: 브라우저 안의 AudSeg DSP가 오디오 활동 구간과 **비어 있는 편집용 cue**만 만든다.

둘 다 로컬 전용이다. 자막 API 키, 인터넷 자막 제공자, 원격 companion, 자동 네트워크 폴백을 제품에 추가하지 않는다.

## 가장 짧은 사용 절차

Linux의 사람 사용자는 먼저 대화형 도우미를 사용한다.

```bash
./setup.sh
./kirinuki.sh start "https://chzzk.naver.com/video/..."
```

Whisper 수동 설치가 필요할 때:

```bash
npm ci --ignore-scripts
npm run build
npm run caption-stack:doctor
npm run caption-stack:setup
npm run caption-stack:start
```

그 뒤 전용 Chromium 프로필로 열린 `http://127.0.0.1:4320`에서:

1. CHZZK·YouTube·SOOP VOD URL과 사용 구간의 시작·끝을 직접 입력한다.
2. **정책 입력 후 편집기 열기**에서 이번 원본 회차의 권한 근거와 책임을 직접 확인한다.
3. 공개 CHZZK·YouTube·SOOP VOD는 도메인별 adapter가 선택 구간 ±10초를 최초 로컬 범위로 준비한다. 사람이 컷 경계를 더 옮기면 필요한 방향만 추가 준비하고, 지원 밖 소스는 권한이 있는 로컬 원본을 연결한다.
4. 기본 **AudSeg 이용하기**를 쓰거나, 오른쪽 **Whisper**를 누른 뒤 **이 PC의 Whisper 자동 연결**을 누른다. 편집기는 fixed loopback gateway와 실제 모델을 직접 검증한다.
5. **활성 컷 전체 초벌 만들기**를 누른다.
6. 모든 cue를 원음과 대조한다.
7. 임시저장 후 영상·프로젝트 JSON·SRT를 내보낸다.

AudSeg만 쓸 때는 caption stack 설치·실행이 필요 없다.

## Linux 사람용 셸 도우미 계약

- `setup.sh`는 `kirinuki.sh setup`의 얇고 안정적인 첫 진입점이다.
- `kirinuki.sh`는 Bash preflight 뒤 Node 내장 모듈만 쓰는
  `scripts/linux-helper.ts`에 인자를 그대로 전달한다.
- 성공한 `setup`은 `~/.local/bin/kirinuki` 래퍼와 XDG 앱 메뉴 항목을
  원자적으로 설치·갱신한다. 앱 메뉴는 `http`, `https`, `text/html` MIME
  기본 앱을 등록하거나 가로채지 않는다. 과거 도우미의 이름·GenericName·
  launcher·세 MIME 서명이 모두 일치하는 `chromium-kirinuki.desktop`만
  복구 가능한 `.retired-*` 이름으로 옮기며, 동명인 다른 파일은 건드리지
  않는다. `update-desktop-database`가 있으면 사용자 applications 디렉터리만
  argv 배열로 갱신한다. 일반 기본 브라우저 association을 추측하거나 바꾸지
  않는다.
- 인자 없는 사용자 래퍼와 앱 메뉴는 `open`으로 전달해 최신 엔진을 즉시
  실행한다. 명시한 인자는 그대로 전달한다. 저장소의 `./kirinuki.sh`만
  인자 없는 실행에서 한글 메뉴를 유지한다.
- 설치 대상의 일반 파일은 현재 생성물, 구조까지 검증된 managed marker,
  정확히 알려진 구 Kirinuki 내용일 때만 교체한다. 구 내용은 `.backup-*`으로
  보존한다. unrelated 파일·심볼릭 링크·특수 파일·읽기 불가 경로는 두
  진입점을 모두 수정하기 전에 fail-closed한다.
- 사용자 래퍼는 현재 저장소, browser profile, 최소 streaming companion
  절대경로를 함께 고정한다.
  `doctor/status`는 누락·권한 이상·다른 체크아웃을 가리키는
  stale 래퍼와 앱 메뉴를 조용히 정상으로 취급하지 않고 실제 대상을 표시한다.
- 저장소의 `./kirinuki.sh`를 인자 없이 TTY에서 실행하면 한글 메뉴를 열고,
  비대화형 실행은 입력을 기다리며 멈추지 않고 명령 사용법을 보여 준다.
- 시스템 패키지를 대신 설치하거나 `sudo`, `su`, `curl | sh`, 원격 설치
  스크립트를 실행하지 않는다. 빠진 도구와 대표 배포판별 설치 힌트만
  표시한다.
- AudSeg 선택은 companion을 설치·조회·시작하지 않는다.
- Whisper 선택만 기존 `local-caption-stack.ts`의
  `doctor/setup/start/status/stop` 계약을 사용한다.
- 브라우저 실행은 고정된 XDG 사용자 전용 프로필과 인자 배열을 사용해 exact
  `http://127.0.0.1:4320`을 연다. `KIRINUKI_BROWSER_PROFILE_ROOT`는 검증된
  절대경로만 허용하고 상대경로·빈 값·앞뒤 공백·줄바꿈은 fail-closed한다.
  `--load-extension`과 `--disable-extensions-except`는 생성된
  `streaming-companion/`의 exact 절대경로 하나에만 사용한다. 다른 unpacked
  확장·`eval`·문자열 셸 실행·원격 디버깅 포트는
  사용하지 않는다. shared `STREAMING_BRIDGE_PROTOCOL` 값은
  `--kirinuki-streaming-companion-protocol=<value>` argv marker로 정확히 한 번
  넣는다. exact companion 경로라도 marker가 없거나 다르거나 중복되면 stale
  build로 분류하고 재사용·자동 종료하지 않는다.
- 같은 전용 프로필에서 실행 중인 과거 전체 확장판은 browser path, root PID,
  process start tick, 프로필, 정확한 두 load flag와 명령행을 연속 재검증한 경우에만
  `transition-exact-legacy`로 분류한다. 그 프로세스에 `SIGTERM`을 한 번 보내
  정상 종료를 기다린 뒤 같은 프로필을 최소 companion으로 다시 연다. 식별값이
  달라지거나 새 프로세스가 끼면 더 신호를 보내지 않는다.
- 자동 브라우저 후보는 `chromium`, `chromium-browser`이며 Chromium 120+만
  허용한다. branded Chrome은 unpacked companion 자동 로드를 지원한다고
  간주하지 않는다. 향후 HTTPS 배포판은 검증된 별도 설치 채널의 companion을
  사용하며, 정상 로컬 실행에 과거 전체 확장판의 개발자 모드를 안내하지 않는다.
- localhost studio는 정확히 `127.0.0.1:4320`에만 bind하고 exact Host를
  검사한다. 외부 인터페이스, 임의 포트 fallback, symlink·traversal 정적 파일,
  다른 프로세스가 점유한 포트를 Kirinuki 것으로 취급하지 않는다. PID, process
  start tick, boot ID, CLI path와 nonce가 모두 맞는 관리형 인스턴스만 stop한다.
- 4319는 공개 VOD 준비·검증·로컬 media Range와 caption session의 gateway다.
  4318은 Whisper를 명시적으로 연결했을 때 gateway가 호출하는 private loopback
  엔진이며 localhost 웹 페이지가 직접 의존하지 않는다.
- 허용된 HTTPS 치지직·YouTube·SOOP·`naver.me` URL만 브라우저 인자로 받고 제어
  문자를 거부한다.
- 실행 중인 Chromium을 강제 종료하지 않는다. `stop`은 관리하는 localhost
  4320 서버, 4319 gateway와 선택적 Whisper stack만 정상 종료한다.
- foreground Whisper의 PID claim은 exact CLI 경로, Linux process start tick,
  boot ID가 모두 맞을 때만 관리형으로 인정한다. 동시 start는 배타적 PID
  claim으로 실패시키며 검증되지 않은 stale claim이나 외부 포트의 프로세스를
  임의로 제거하지 않는다.
- helper의 Whisper 재설정은 직전 manager가 foreground일 때만 완전 종료를
  확인한 뒤 같은 manager로 복원한다. active systemd-user는 저수준 setup의
  restart 계약을 사용한다.
- 브라우저 데이터 Origin은 기본 `http://127.0.0.1:4320`, 공개 배포 opt-in은
  exact `https://kirinuki.eff0rtchung.kr`이다. 저장소 경로나 프로필을 옮겨도
  포트를 바꾸거나 두 Origin의 저장소를 조용히 섞어 재사용하지 않는다.
- API 키, 세션 토큰, 브라우저 쿠키와 프로젝트 데이터를 helper 설정·인자·
  로그에 기록하지 않는다.
- `--dry-run`은 설치·브라우저·서비스 상태를 바꾸지 않고 예정된 동작만
  검증 가능하게 출력한다.
- 셸과 Node helper의 구문, URL 검증, 비대화형 동작, XDG 경로, dry-run과
  자막 방식 분기는 `tests/linux-helper.test.ts`에서 회귀 검사한다.

## 절대 불변조건

- 사용자가 저장한 컷 시작·끝과 순서는 `authority: USER`다.
- 자동 로직은 컷을 새로 고르거나 경계를 조용히 확장·축소·병합·삭제하지 않는다.
- 영상 중간 삭제는 명시적인 사용자 동작으로만 실행한다.
- 내부 삭제 뒤 영상에 결속된 자막·에셋·음성은 같은 시간축 변환을 적용한다.
- 원본 전체와 최종 렌더는 이 기기 밖으로 보내지 않는다.
- 시작 화면의 client-side viewer는 시각 선택·확인 전용이다. YouTube·SOOP은
  공식 embed URL만 만들고, CHZZK는 문서화되지 않은 VOD embed route를 발명하지
  않고 canonical VOD 페이지와 항상 보이는 새 탭 fallback을 사용한다.
- viewer와 편집 미디어를 혼동하지 않는다. 4320/4319 서버는 iframe stream을
  proxy하거나 플랫폼 cookie·token을 받지 않으며 편집·자막·렌더는 검증된 로컬
  compact media만 사용한다.
- Whisper 오디오는 loopback companion에만 전달한다.
- AudSeg는 브라우저 안에서만 실행하며 네트워크를 호출하지 않는다.
- 새 환경은 AudSeg를 선택한 채 시작하고 Whisper startup pairing·probe를 보내지 않는다.
- Whisper는 AudSeg 오른쪽의 단계적 탭이다. 첫 클릭은 연결 패널만 열고, 연결 또는 자막 만들기 버튼이 fixed loopback gateway에 자동 pair·probe한 뒤 실제 capability와 모델을 검증한다.
- 정상 사용자 흐름은 연결 JSON이나 Whisper 실행 파일·`.bin` 모델을 고르게 하지 않는다. 브라우저가 binary를 실행하거나 모델을 설치·교체한다고 표현하면 안 된다.
- setup이 남기는 진단용 연결 JSON은 `kirinuki-whisper-connection/v1`, 16KiB 이하, 현재 명시된 exact Studio Origin, exact `http://127.0.0.1:4319/v1/captions`, 지원 profile·backend·모델의 정확한 필드만 허용한다. 정상 자동 연결은 이 파일에 의존하지 않는다. token, 로컬 경로, hash, 임의 필드는 저장·수용하지 않는다. 4318 whisper.cpp route는 gateway만 사용한다.
- AudSeg는 STT가 아니다. 텍스트·화자·언어 판정을 만들어 내지 않는다.
- AudSeg 결과 cue의 텍스트는 실제로 비어 있고 모두 `reviewRequired`다.
- Whisper 결과도 초안이며 사람 검수 없이 게시 준비 완료로 표시하지 않는다.
- 사람이 직접 만든 cue와 사람이 고친 AI cue를 재실행으로 덮어쓰지 않는다.
- 자동 본문 위치는 아래 중앙 `x=0.5`, `y=0.84`다.
- 새 자막은 레인 번호와 무관하게 아래 중앙 `x=0.5`, `y=0.84`에서 시작한다.
- 자막 크기 조절은 선택한 cue의 `fontScale`만 바꾸며 값이 없는 기존 cue만 프로젝트 기본 크기를 상속한다.
- 자막 속성 시트는 cue 본문을 데이터, DOM, 접근성 이름, tooltip, dataset 어디에도 포함하지 않고 실제 적용 위치·크기·색상·검은 상자만 파생해 보여 준다.
- 편집기 자막 전체에는 최대 4초 제한이 없다. 최대 4초는 AudSeg가 **빈 타이밍 cue를 처음 만들 때만** 적용하는 생성 조건이다. Whisper 초벌을 포함해 편집기에 만들어진 뒤에는 사람이 모든 cue의 시작·끝을 자유롭게 이동하거나 늘릴 수 있다.
- 문장 끝의 불필요한 `.`은 제거하고 `?`, `!`, `…`, `~`는 보존한다.
- 프로젝트 변경은 현재본에 원자적으로 저장하고 오래된 복구본을 자동 우선하지 않는다.
- 민감한 토큰을 프로젝트, IndexedDB, 브라우저 저장소, CLI 인자, service unit, 로그에 기록하지 않는다.
- 방송인별 정책 목록·정책 본문·과거 판정 결과를 내장, 캐시하거나 다음 작업에 자동 적용하지 않는다.
- 새 편집, 이어 편집과 복구본 선택은 각각 정확한 `projectId`·`sourceSessionId`·목적에 결속된 `UsagePolicyAttestation`을 새로 요구한다.
- 권한 근거는 이번 1회 직접 확인, 최신 공개 정책, 별도 서면 허락, 공식 편집자·소속사 권한 중 하나다. 공개 정책은 공식 HTTPS URL만 받고, 다른 증빙 방식은 메일 주소·링크·파일 경로가 없는 비민감 참조명만 받는다.
- 이 게이트는 양식의 필수 값과 형식만 검증한다. URL reachability, 실제 허락·증빙의 진실성, 법적 적합성을 네트워크나 휴리스틱으로 판정하지 않으며 확인 시각만으로 열린 편집기를 만료시키지 않는다. 프로젝트·원본·목적·탭/session·일회 토큰 결속은 유지하고 양식/런타임/세션 오류를 분리한다.
- 실제 메일·계약서·스크린샷·첨부파일을 입력하거나 저장하지 않는다. 편집기 열기의 전체 진술은 프로젝트·복구본에 복제하지 않고 브라우저 세션의 대상 고정 gate·lease에는 최소 정보만 둔다.
- 게시·업로드·수익화·정책 승인을 자동으로 실행하지 않는다.
- 승인되지 않은 라이선스, 버전, 글꼴·원문 사본이 들어오면 `license:check`가 배포 전에 실패해야 한다.

## 자막 방식의 의미

### `whisper-tiny`

Whisper 흐름:

```text
활성 컷
→ 16kHz mono PCM/WAV
→ loopback caption companion
→ whisper.cpp multilingual timed transcript
→ segment 본문 + word 경계 anchor 정규화
→ 로컬 cue 초벌
→ kr-vtuber-clean-v1 품질 하네스
→ 편집기 검수 cue
```

계약:

- 정상 웹 클라이언트의 companion 주소는 exact `http://127.0.0.1:4319`만 허용한다.
- 기본 Whisper 설치 profile은 고정된 다국어 `tiny-q5_1`이다. 제품 초기 자막 방식의 기본값은 AudSeg이다.
- 실제 word timestamp를 cue 경계와 긴 cue 분할의 우선 anchor로 사용한다.
- LLM식 글자 수 비례 시간 추정을 넣지 않는다.
- segment↔word coverage가 낮으면 시간을 꾸며 내지 않고 검수 사유를 남긴다.
- companion capability의 provider와 transcription mode는 모두 `local-whispercpp`여야 한다.
- 로컬 실패를 인터넷 서비스로 자동 전환하지 않는다.

### `audseg-local`

AudSeg 흐름:

```text
활성 컷
→ 16kHz mono Float32 PCM
→ 브라우저 AudSeg DSP
→ 오디오 활동 구간
→ AudSeg가 생성하는 최대 4초 빈 timing cue
→ 빈 텍스트 + reviewRequired
→ 편집기에서 사람 전사
```

AudSeg는 저장소 루트의 독립 Python 패키지 `AudSeg/` 0.1.0 철학과 알고리즘을 브라우저 TypeScript로 충실히 옮긴 것이다.

- 기준 구현: `AudSeg/src/audseg/`
- 브라우저 구현: `src/editor/audseg.ts`
- 라이선스: MIT
- 런타임: 브라우저 JavaScript, Python·companion 불필요
- 입력: 16kHz mono PCM
- 리소스 상한: 컷당 30분, Float32 PCM 128MiB
- 분석: 20ms RMS frame, 10ms hop
- threshold: adaptive noise floor
- 상태 전환: Schmitt hysteresis
- 후처리: debounce, padding, merge
- 긴 구간: quiet valley 우선 분할, hard limit 폴백
- AudSeg가 처음 생성하는 빈 timing cue 상한: 4,000ms

음악, 효과음, 박수, 키보드 소리도 활동으로 감지될 수 있다. 이것은 오작동이 아니라 활동 검출기의 한계다. 에이전트나 UI는 AudSeg 결과를 전사, 발화 확정, 화자 분리, 언어 판정으로 표현하면 안 된다.

Python 기준 구현의 기본 placeholder 정책과 별개로 편집기 모델은 빈 텍스트를 보존할 수 있으므로 실제 cue 본문을 비워 둔다. 타임라인은 빈 cue임을 시각적으로 표시하되 그 표시 문구를 프로젝트 자막 텍스트로 저장하거나 SRT로 내보내지 않는다.

## 설치와 프로필

요구 환경:

- Node.js 22 이상
- 자동 도우미와 localhost 웹 UI는 Chromium 120 이상
- Linux에서 Whisper를 쓸 경우 C/C++ build toolchain
- 실제 브라우저 통합 검증에는 Chromium과 ChromeDriver
- 미디어 통합 검증에는 FFmpeg와 ffprobe
- YouTube·SOOP 선택 구간 자동 준비에는 로컬 `yt-dlp`, FFmpeg, ffprobe

Whisper 설치:

```bash
npm run caption-stack:doctor
npm run caption-stack:setup
npm run caption-stack:start
npm run caption-stack:status
```

`setup`은 고정 revision, 크기와 SHA-256을 검증한 whisper.cpp, 선택 모델, VAD를 XDG 사용자 데이터 경로에 설치한다. 저장소와 브라우저 배포물 안에 binary나 모델을 넣지 않는다. `./kirinuki.sh setup`은 관리형 foreground를 `stop → setup → foreground 복원`으로 처리한다. 저수준 `caption-stack:setup`은 foreground가 실행 중이면 fail-closed하고 명시적인 `stop → setup → start`를 요구하며, active-like systemd-user 서비스만 자체 재시작한다.

caption gateway가 허용하는 브라우저 Origin은 저장소 절대경로와 무관하게 기본
exact `http://127.0.0.1:4320`, 또는 명시적 공개 배포의 exact
`https://kirinuki.eff0rtchung.kr` 하나다. 예전 `chrome-extension://...` Origin이
든 연결 파일은 정상 웹 실행에서 거절하고 같은 Origin 설정의
`caption-stack:setup`으로 원자적으로 다시 쓴다. 4320을 다른 포트로 바꾸는 것은
단순 설정 변경이 아니라 IndexedDB Origin 변경이므로 지원하지 않는다.

프로필과 편집기에서 자동 감지하는 실제 모델:

- `draft`: 기본 `tiny-q5_1`, 저사양·빠른 초벌
- `auto`: 기본 `small-q5_1`, 6GiB 미만에서는 `light` / `base-q5_1`로 안전하게 하향
- `light`: `base-q5_1`
- `quality`: `medium-q5_0`, 정확도 우선

기본 Whisper 설치 동작과 문서는 `draft`를 기준으로 한다. 사용자가 명시적으로 설치한 더 무거운 프로필을 `start`가 조용히 바꾸지 않는다. setup은 내부 진단용 `${XDG_CONFIG_HOME:-~/.config}/kirinuki-caption-stack/kirinuki-whisper-connection.json`을 원자적으로 새로 쓰지만 정상 편집 흐름은 이 파일에 의존하지 않는다. 편집기는 fixed loopback gateway에 직접 pair·probe하고 companion이 보고한 capability와 실제 모델이 지원 계약에 맞을 때만 연결 완료로 표시한다.

종료:

```bash
npm run caption-stack:stop
```

AudSeg에는 위 명령이 필요 없다. 모델 설치 안내나 companion 오류를 AudSeg 모드에 표시하면 회귀다.

## 매 작업 운영 절차

### 1. 시작 화면에서 소스와 컷 저장

- canonical VOD URL과 시작·끝을 사람이 직접 입력한다.
- 시작 화면은 다른 브라우저 탭의 DOM·플레이어·로그인 상태를 읽거나 제어하지 않는다.
- 메모는 선택 사항이다.
- 페이지 시각과 로컬 파일 시각이 다르면 오프셋을 기록한다.
- 여러 방송 회차를 한 프로젝트에 섞지 않는다.

### 2. 매 작업 확인 후 편집기 CURRENT 열기

새 편집기, **계속 편집**, **복구본 선택**을 실행할 때마다 이번 원본 회차와
열기 목적에 맞는 권리·책임 입력을 새로 받는다. 과거 입력을 자동으로 채우지
않으며, 대상이 바뀌면 같은 확인으로 열지 않는다.

닫은 세션을 이어 갈 때 localhost 시작 화면의 **이 기기의 최근 편집 → 계속 편집**을 사용한다. 이 경로는 정확한 `projectId`의 현재본을 연다.

- 같은 프로젝트 편집기 탭이 이미 열려 있으면 중복 세션을 만들지 않는다.
- 시작 화면의 새 URL·시간을 기존 프로젝트에 자동 합치지 않는다.
- 복구본을 불러오기 전 현재본을 `복원 직전`으로 저장한다.
- 오류가 났다는 이유로 가장 오래된 백업을 강제 복원하지 않는다.

### 3. VOD 로컬 편집 영상 또는 수동 파일 연결

- 공개 VOD 자동 준비는 domain/origin으로 CHZZK·YouTube·SOOP adapter를 자동 선택해 필요한 범위만 compact 로컬 편집 영상으로 물질화한다. 사용자 selection의 ±10초는 최초 논리 편집 범위다. 사람이 해당 컷의 앞·뒤 추가 로딩이나 경계 넘김을 명시한 때만 그 clip lineage의 범위를 단조롭게 넓히며, 사용자 selection anchor 자체는 바꾸지 않는다. 키프레임용 prefix는 trim 범위에 포함하지 않는다.
- 추가 준비는 현재 본편·쇼츠가 참조하는 모든 clip lineage의 기존 범위를 합쳐 어느 컷도 줄이지 않는다. CHZZK는 검증된 세그먼트 캐시, YouTube·SOOP은 검증된 원본 조각을 재사용하고 차집합만 받는다. 새 세대의 receipt·MP4가 완전히 검증된 뒤에만 편집기 바인딩을 교체하며 실패·취소·원본 버전 변경 때는 이전 영상·프로젝트·재생 위치를 유지한다.
- CHZZK는 공개 DASH 조각을 우선 직접 계획하고, exact `VOD_UNAVAILABLE`이면서 공개 HLS인 완료 VOD만 고정 외부 materializer로 fallback한다. 다른 native 오류를 fallback으로 숨기지 않는다. YouTube·SOOP은 `shell:false`, 사용자 설정·쿠키·로그인·netrc 없이 로컬 `yt-dlp`/FFmpeg를 실행하며 SOOP multi-part를 연속 시간축으로 변환한다. DRM·인증·지역·접근 제한 우회나 원격 재생 폴백을 추가하지 않는다.
- signed CDN URL·inKey·loopback access token·artifact 절대경로를 프로젝트나 로그에 저장하지 않는다.
- 진행 중인 라이브·비공개·로그인 필요 원본에는 자동 준비를 적용하지 않고 권한 있는 같은 원본을 직접 연결한다.
- 쇼츠 브랜치는 `kirinuki-short-form/v5` 독립 occurrence 타임라인과 고정 1080×1920 출력을 저장한다. 본편 구간을 보낼 때마다 같은 원본이어도 새 occurrence와 결속 자막·에셋·음성 복사본을 append한다. 각 장면은 기존 영상을 암묵적 base로 유지하고, 현재 `project-primary` 원본 안의 다른 구간을 추가 영상 레이어 최대 8개로 합성할 수 있다. 레이어별 source clock·scene-local range·crop·배치·불투명도·표시 여부·z-order를 보존하며 추가 영상 음성은 섞지 않는다. occurrence별 trim·분할·재정렬·삭제와 쇼츠 전용 편집은 본편과 분리하고, 모든 원본 clip lineage와 immutable selection anchor는 추가 로컬 준비 범위 계산에 유지한다. v1~v4는 import에서 v5로 올리고 알 수 없는 미래 schema는 fail-closed한다.
- 파일 identity는 이름, 크기, 수정 시각, 길이, 시작 시각, 해상도, 코덱을 포함한다.
- identity가 바뀌면 낡은 자막 체크포인트를 폐기한다.
- 파일 권한만 만료됐으면 프로젝트를 초기화하지 않고 같은 파일을 다시 고른다.

### 4. 초벌 방식 선택

글 초안이 필요하면 Whisper, 타이밍 틀만 필요하면 AudSeg를 고른다.

실행 전:

- 활성 컷이 1개 이상인지 확인한다.
- Whisper는 한 번에 활성 컷 최대 16개까지만 처리한다.
- AudSeg는 프로젝트의 모든 활성 컷을 한 컷씩 순차 처리하고 각 컷 뒤 결과와 체크포인트를 저장한다.
- 총 길이와 선택 방식을 표시한다.
- Whisper라면 companion capability와 실제 모델 지문을 확인한다.
- AudSeg라면 companion probe, 권한 요청, session 발급을 수행하지 않는다.
- AudSeg는 저장된 Whisper endpoint·token이 비어 있거나 잘못되어도 그 값을 읽거나 검증하지 않고 실행한다.
- 사용자가 취소하면 오디오 추출을 시작하지 않는다.

### 5. 사람 검수

Whisper:

- 고유명사
- 빠른 말과 짧은 감탄사
- 겹친 화자
- 잡음과 음악
- STT coverage 경고
- cue 시작·끝
- 화자 색

AudSeg:

- 모든 빈 cue의 실제 발화 여부
- 음악·효과음 오검출
- 누락된 조용한 발화
- cue 시작·끝
- 직접 입력한 전체 텍스트
- 화자와 색

공통:

- 같은 시각에 여러 자막이 필요하면 별도 레인을 사용한다.
- 타임라인 자막 블록의 양끝 손잡이와 숫자 입력을 모두 지원한다.
- 자막 레인은 기본 2개이고 사용자가 늘릴 수 있다.
- 색상 레지스터는 고정 흰색과 최근 비흰색 5개다.
- 자막↔에셋 자석과 정확히 맞춤은 사용자의 명시 동작이다.
- 사람이 고친 cue는 `humanEdited` 보호를 유지한다.

### 6. 저장과 내보내기

- 큰 변경 전 **지금 임시저장**
- 5분마다 자동 임시저장
- 프로젝트별 최근 5개
- 복구 직전 현재본 자동 저장
- 영상과 함께 프로젝트 JSON·SRT 보관
- 내보내기 직전 현재본과 복구 초안을 강제로 저장하고, 저장 실패 시 렌더를
  시작하지 않는다.
- 대용량 로컬 원본의 `BlobSource`는 Chromium descriptor 누수를 피하도록
  `useStreamReader: false`를 유지한다.
- 영상 파일 커밋 전 진행률은 최대 99%이며 실제 커밋 뒤에만 100%다.
- 실패 정리는 확실히 빈 파일에만 적용한다. 기록된 바이트가 있거나 커밋
  여부가 모호한 산출물을 복구 불가능하게 삭제하지 않는다.
- 기본 운영 단위는 1세션 1편집이다. **세션 완료·로컬 재료 삭제**는 완성 영상과
  sidecar를 재검증한 뒤 정확한 `projectId + consumer + materialization + source`
  소유권에 결속된 VOD 조각·compact 영상·receipt와 같은 IndexedDB transaction의
  프로젝트·복구본·쇼츠 캐시·이미지·파일 핸들만 정리한다.
- 같은 프로젝트 탭이 둘 이상이거나 검증·다운로드 fallback·출력 commit이
  불확실하면 캐시 정리를 실행하지 않는다. 사용자가 직접 고른 원본 파일과 다른
  프로젝트의 artifact는 절대 삭제하지 않는다.

빈 AudSeg cue는 타임라인과 프로젝트에는 보존할 수 있지만 SRT에 가짜 문구로 출력하면 안 된다. 내보내기 전에 모든 빈 cue가 의도적인지 검수한다.

## 체크포인트와 재개

체크포인트 키에는 최소한 다음이 들어간다.

- clip ID
- 원본 시작·끝 밀리초
- 자막 방식 (`whisper-tiny` 또는 `audseg-local`)
- pipeline fingerprint
- 품질 프로필과 하네스 fingerprint
- 필요한 경우 편집 문맥 fingerprint
- 완료 request ID와 시각

Whisper pipeline fingerprint에는 companion이 보고한 실제 모델과 실행 방식이 포함된다.

AudSeg pipeline fingerprint에는 다음이 포함된다.

- `local-audseg`
- `audseg-0.1.0-dsp`
- `browser-audio-activity`
- 알고리즘 또는 기본 config가 바뀌면 달라지는 안정적 지문

동일 범위·방식·지문의 완료 컷만 재개 시 건너뛴다. 새 전체 실행, 다른 원본, 범위 변경, 방식 변경, 구현 지문 변경은 낡은 체크포인트를 재사용하지 않는다.

## 자막 스타일과 품질 계약

자동 본문 기본값:

- Pretendard ExtraBold
- 배경 없음
- 한 줄
- 아래 중앙 `x=0.5`, `y=0.84`
- 한국어 폭 20 단위 hard limit
- 가능한 최소 650ms
- 목표 읽기 속도 초당 16폭 단위
- 끝 `.` 제거
- `?`, `!`, `…`, `~` 유지
- 기본 화자 흰색
- 다른 speaker ID는 결정적인 고유 색

구조 위반 결과는 일반 완료본으로 저장하지 않는다. 내용 불확실성은 cue별 `qualityCodes`와 `reviewRequired`로 보존한다.

초벌 생성 뒤 편집기 cue에는 전역 최대 표시 시간을 적용하지 않는다. 사람이 발화·연출에 맞춰 시작과 끝을 자유롭게 옮기거나 늘릴 수 있고, 그 편집을 로딩·재실행이 4초로 다시 자르면 안 된다.

AudSeg가 생성한 빈 cue에는 읽기 속도 검사를 적용할 텍스트가 없다. 빈 본문을 품질 하네스가 삭제하거나 임의 문구로 대체하지 않게 별도 경로를 유지한다. 대신 생성 시점의 시간 범위, 4초 상한, 정렬, 겹침, clip 경계만 검사한다. 생성 뒤 사람이 옮기거나 늘린 cue에는 4초 상한을 다시 적용하지 않는다.

## 데이터·보안 경계

```text
Whisper
Studio (기본 http://127.0.0.1:4320 / 공개 https://kirinuki.eff0rtchung.kr)
  └─ 활성 컷 16kHz mono WAV
       └─ http://127.0.0.1:4319/v1/captions
            ├─ 현재 설정된 exact Studio Origin
            ├─ process-memory bearer session
            └─ private 127.0.0.1:4318 whisper-server route

AudSeg
localhost editor
  └─ 활성 컷 16kHz mono PCM
       └─ 같은 브라우저 탭의 DSP
```

보안 규칙:

- 정상 웹 런타임은 최소 companion 밖의 광범위한 브라우저 권한이나 다른 탭 접근을
  요구하지 않는다. 최소 companion은 현재 embed frame의 HTML video만 제어하고
  YouTube No-Cookie frame에서는 단축키만 전달하며, URL·쿠키·token·미디어
  바이트를 bridge payload로 보내지 않는다.
- 4320 정적 서버는 loopback bind, 기본 exact loopback Host를 유지한다. 명시적
  공개 모드만 exact `kirinuki.eff0rtchung.kr` Host와 HTTPS forwarded proto를
  받으며 관리 health/migration endpoint는 Tunnel에 노출하지 않는다. allowlisted
  regular file, symlink/traversal 차단, CSP·nosniff·no-referrer를 유지한다.
- Popovic 같은 rewrite 없는 정적 배포에서는 tracked `web/`의 Studio Origin token을
  exact `https://kirinuki.eff0rtchung.kr` 문서에서만 자체 해석한다. Git 앱 등록은
  `repo_subdir=web`, `hostnames=kirinuki.eff0rtchung.kr`를 사용한다.
  `web/.popovic-hosts`는 mounted-source 전용이며 Git deploy가 복사하지 않는다.
  CSS·JS·AudSeg worker의 package-version query는 한 release에서 일치해야 한다.
- 공개 전 Popovic의 RED 요청 집계를 코드에서 완전히 비활성화하고 기존 metric
  bucket을 지운다. Popovic 또는 Cloudflare에서 clickjacking·nosniff·최소 권한·
  COOP/CORP/HSTS 응답 헤더를 적용한다. meta CSP만으로 완료됐다고 간주하지 않는다.
- CSP `frame-src` allowlist는 실제 frame이 사용하는 정확한 세 Origin
  `https://chzzk.naver.com`, `https://www.youtube-nocookie.com`,
  `https://vod.sooplive.com`이다. source descriptor는 단일 지원 VOD의 canonical
  ID만 받아 live·clip·playlist·unsupported path·host spoof를 fail-closed한다.
- caption endpoint 정규화는 loopback HTTP만 허용한다.
- URL 사용자정보, 쿼리, fragment를 거부한다.
- session token은 현재 탭과 companion 메모리에만 둔다.
- `POST /v1/session`은 현재 설정된 exact Studio Origin과 프로토콜 헤더를 요구한다.
- companion 재시작 시 session을 폐기한다.
- health probe가 session을 발급하거나 rate limit을 소비하지 않게 한다.
- 모델 다운로드는 `.part-*`로 받은 뒤 크기와 SHA-256을 확인하고 원자적으로 바꾼다.
- runtime child에 환경의 secret·credential 변수를 전달하지 않는다.
- loopback 통신은 proxy를 우회한다.

## 라이선스

AudSeg 기준 구현은 MIT 라이선스다.

- 루트 원문: `AudSeg/LICENSE`
- 웹 배포 사본: `web/licenses/AUDSEG-MIT.txt`
- 웹 고지: `web/THIRD_PARTY_NOTICES.md`
- 전체 인벤토리 고지: `legal/THIRD_PARTY_NOTICES.md`

알고리즘을 포팅하거나 수정해도 저작권 고지와 MIT 전문을 제거하지 않는다.

그 밖의 주요 고지:

- Mediabunny: MPL-2.0
- Pretendard: SIL OFL 1.1
- Paperlogy: SIL OFL 1.1
- whisper.cpp와 변환 모델·VAD: 각 고지문 참조

first-party canonical 원문은 루트 `UNLICENSE`에 유지하고, Popovic 정적 배포
사본은 extensionless 파일 대신 `web/licenses/UNLICENSE.txt`로 제공한다.

광고·유료 배포·SaaS를 포함한 상업 이용 dependency 정책은
`legal/COMMERCIAL_USE_POLICY.md`를 따른다. 새 코드·글꼴·모델·asset·광고 SDK·
analytics는 canonical positive allowlist와 final-artifact inventory를 먼저
통과해야 한다. NC, Commons Clause, PolyForm restricted-use, SSPL, BUSL,
Elastic/Prosperity, field-of-use·revenue 제한 또는 불명확한 `LicenseRef`를 임시
예외로 우회하지 않는다. `build-dependent`, `external-terms`,
`mixed-see-packages`는 비재배포 경계 표식이지 라이선스 승인이 아니다.

## 파일 지도

- `src/editor/audseg.ts`: 브라우저 AudSeg DSP와 timing cue 변환
- `src/editor/caption-agent.ts`: 두 방식 설정, Whisper session/client, 체크포인트
- `src/editor/main.ts`: 방식별 실행 분기, 컷별 저장·재개
- `src/editor/studio-runtime.ts`: localhost web runtime의 canonical entry
- `src/editor/studio-runtime-web.ts`: 브라우저 표준 API만 쓰는 web adapter
- `src/web/main.ts`: URL·수동 시간·매 작업 정책 localhost 시작 화면
- `src/streaming-companion.ts`: CHZZK·SOOP 제어와 YouTube iframe 단축키용 최소 client-side entry
- `src/web/streaming-bridge-*.ts`: exact origin/source/generation typed 재생 bridge
- `src/caption-agent/protocol.ts`: Whisper companion 요청·응답 계약
- `src/caption-agent/caption-quality-harness.ts`: Whisper 초벌 품질 계약
- `src/caption-agent/editorial-context.ts`: bounded 편집 문맥과 지문
- `scripts/local-caption-stack.ts`: setup/start/status/stop
- `scripts/local-caption-stack-core.ts`: artifact·프로필·service 생성
- `scripts/local-studio-server.ts`: 고정 127.0.0.1:4320 서버 lifecycle CLI
- `scripts/local-studio-server-core.ts`: loopback 정적 서버 identity·보안 계약
- `src/lib/editor-core.ts`: 프로젝트·cue 모델의 작성 소스
- `src/lib/source-platform.ts`: CHZZK·YouTube·SOOP 원본 판별·canonical URL
- `src/lib/source-embed.ts`: 공식 embed/canonical frame descriptor와 exact Origin gate
- `src/lib/chzzk-vod-materialization.ts`: 플랫폼 공용 compact 미디어 시간 매핑(레거시 schema명 유지)
- `src/lib/short-form.ts`: 본편 불변 쇼츠 브랜치와 파생 렌더 프로젝트
- `src/lib/usage-policy.ts`: 매 작업 권리 진술과 대상 고정 gate 검증
- `src/lib/caption-properties-sheet.ts`: 본문 없는 자막 속성 시트의 파생 행·설정 묶음
- `src/lib/session-recovery.ts`: CURRENT와 최근 복구본의 작성 소스
- `src/lib/origin-storage-migration.ts`: 이전 브라우저 Origin에서 localhost로 옮기는 bounded·integrity-checked envelope
- `scripts/web-javascript-build.ts`: localhost web 생성물의 typed build manifest
- `scripts/build-streaming-companion.ts`: 최소 companion manifest·JS 결정적 build
- `scripts/local-studio-migration-stage.ts`: 명시적 opt-in·exact 이전 Origin·single-use nonce migration stage
- `scripts/check-typescript-migration.ts`: 저장소 전체 TS migration·생성물 provenance gate
- `scripts/chzzk-vod-materializer.ts`: CHZZK 공개 DASH 선택 조각 우선 로컬 준비
- `scripts/external-vod-materializer.ts`: YouTube·SOOP 공개 VOD 선택 범위 로컬 준비
- `scripts/chzzk-vod-job-manager.ts`: 호환 schema 아래 플랫폼 공용 VOD 작업·로컬 media lease
- `web/index.html`, `web/studio.css`, `web/studio.js`: localhost 시작 화면
- `web/editor.html`, `web/editor/**`: 정상 web 편집기 HTML·CSS·typed 생성물
- `streaming-companion/**`: action·service worker·UI가 없는 정상 실행 연결부
- `web/THIRD_PARTY_NOTICES.md`, `web/licenses/**`: 정상 web 배포 고지·원문
- `web/.popovic-hosts`: Popovic mounted-source용 exact 공개 hostname 선언
- `tests/audseg.test.ts`: DSP 결정성·경계·AudSeg 생성 빈 cue의 4초 상한
- `tests/caption-agent-client.test.ts`: loopback client·session·재개
- `tests/local-caption-stack.test.ts`: 설치·runtime·보안

파일명이 바뀌면 이 지도를 같은 변경에서 갱신한다.

## 수정 에이전트 작업 순서

1. 이 파일을 끝까지 읽는다.
2. `git status --short`로 사용자 변경과 다른 에이전트 변경을 확인한다.
3. 관련 소스·테스트·문서를 함께 찾는다.
4. 사용자 세션의 현재 프로젝트를 덮어쓰지 않는다.
5. 비밀 값을 읽거나 출력하지 않는다.
6. 정상 런타임에는 typed 최소 streaming bridge 밖의 브라우저 권한·ID 의존을
   추가하지 않는다. 이전 브라우저 Origin은 기존 저장소의 일회성 마이그레이션
   범위에서만 허용한다.
7. 모델 다운로드를 `npm install`, `build`, 기본 CI에 넣지 않는다.
8. Whisper private route를 고정 공개 path로 바꾸지 않는다.
9. AudSeg를 전사기로 표현하거나 텍스트를 꾸며 내지 않는다.
10. 루트 Python 구현과 브라우저 포트의 핵심 config·golden fixture parity를 유지한다.
11. 사람이 수정한 cue와 시간축 불변조건을 지킨다.
12. 문서와 UI copy를 실제 코드 상태와 맞춘다.
13. 변경 범위에 맞는 테스트 뒤 전체 검증을 실행한다.

### 개발용 안전 핫 리로드

- `npm run dev:editor`의 marker와 reload 요청은 localhost 개발 runner 전용이며,
  정상 사용자는 exact localhost URL에 `dev=1`이 없으면 읽지 않는다.
- 기본 runner는 `scripts/dev-web.ts`와 `web/dev-reload.json`만 사용한다.
- CSS만 바뀌면 stylesheet만 교체하고 File 객체·영상 연결·재생 위치·CURRENT를 유지한다.
- 편집기 TypeScript 번들·Worker를 다시 열기 전에는 진행 중인 작업, 같은 프로젝트 중복 탭과 저장되지 않은 원본 파일 핸들을 검사한다.
- 현재 입력을 확정하고 모든 선행 project write를 기다린 뒤 CURRENT를 다시 읽어 fingerprint가 같을 때만 `project=<id>&session=resume&dev=1`로 재로드한다.
- 저장 확인 중 새 capture seed가 도착하면 재로드하지 않고 잠금을 풀어 그 seed를 먼저 반영한다.
- 핫 리로드 때문에 최근 5개 사용자 임시저장을 새로 만들거나 밀어내지 않는다.
- TypeScript 번들 재로드는 CURRENT만 보존한다. undo/redo, 타임라인 범위·확대 같은 탭 메모리를 보존한다고 표현하지 않는다.
- localhost 시작 화면·편집기·gateway 공용 모듈 변경은 혼합 runtime을 막도록
  관리형 4320 서버 재시작 대상으로 분류한다.
- 개발 runner·validator·패키저는 같은 OS 커널 mutex를 원자적으로 점유한다. 강제 종료 후 stale 파일 삭제 경쟁으로 상호 배제를 구현하지 않는다.
- `npm run package`는 build·`check:full`·ZIP·체크섬 전체를 하나의 최상위 release lease로 감싸고, 자식 validator·패키저는 일치하는 live owner token으로만 그 lease를 빌린다.
- 핫 리로드 browser smoke는 같은 mutex에 참여하고 임시 복사본의 marker만
  조작한다. 실제 작업 프로필의 CURRENT나 개발 reload marker를 테스트 revision으로
  덮어쓰지 않는다.
- 개발 runner와 marker·lock·임시 marker는 패키지에 포함하지 않는다. 실행 중 runner가 있으면 릴리스 검증과 패키징은 fail closed한다.

기본:

```bash
npm run check
git diff --check
```

`npm run check`에는 fail-closed third-party 라이선스 인벤토리 검사가 포함된다. 현재 허용 목록은 browser runtime `mediabunny@1.51.0`(MPL-2.0), 로컬 companion runtime `tsx@4.23.1`·`esbuild@0.28.1` 및 고정 platform 패키지(MIT), build-only `typescript@5.9.3`(Apache-2.0)·타입 패키지(MIT), AudSeg(MIT), 두 OFL-1.1 글꼴이다. CI의 checkout/setup-node/setup-chrome Actions도 full commit SHA와 MIT 대응 소스를 고정한다. 이 npm·CI 도구들은 브라우저 배포물에 포함하지 않지만, companion을 installer/container로 배포할 때는 runtime과 build-only 범위를 구분해 SBOM·고지를 만든다. 새 패키지·버전·라이선스·바이너리 에셋을 추가하려면 원문과 배포 의무를 먼저 검토하고 고지·allowlist·검사를 같은 변경에서 명시적으로 갱신한다.

`npm run typecheck`와 `npm test`는 활성 web·최소 companion 소스, 도구와 테스트를
검사한다. 과거 전체 확장판을 다시 build하거나 별도 test 경계로 포함하지 않는다.

`npm run migration:check`는 빌드보다 먼저, 작업 트리를 수정하지 않고
실행한다. 정상 web 경계에서는 typed manifest에 선언된 web·최소 companion
생성물 외 JS 계열 파일,
first-party `.d.ts`, HTML inline script/event handler, shell·package inline
JavaScript와 작성 JS 진입점, tsconfig 검사 대상 누락을 차단한다. 명시적 `any`,
`@ts-ignore`·`@ts-nocheck`·`@ts-expect-error`, production의 `unknown` 이중
단언도 TypeScript AST와 원문 기준으로 막는다. 정상적인 표준 API·문장 안의
`any` 문자열은 막지 않는다. esbuild `write:false`·`metafile` 재빌드가
first-party 입력의 TS provenance와 추적된 모든 web·companion JS의 바이트 일치를
증명해야 하며, 배너만 붙인 수동 JavaScript는 생성물로 인정하지 않는다.

KirinukiHelper가 직접 작성한 코드는 `UNLICENSE`에 따라 퍼블릭 도메인에 헌정한다. 이것은
Mediabunny(MPL-2.0), Pretendard·Paperlogy(OFL-1.1)와 별도 다운로드되는
whisper.cpp·Whisper 모델·Silero VAD의 고유 라이선스를 덮어쓰지 않는다.
브라우저·서버 배포물에는 프로젝트 Unlicense 원문과 모든 제3자 고지·필수 원문을 함께 넣고,
`license:check`가 소스와 배포 사본의 바이트 일치 및 고정 dependency 인벤토리를
검증해야 한다.

Chromium·ChromeDriver·FFmpeg가 있으면:

```bash
npm run check:full
```

`test:browser`는 localhost 웹의 결정적 smoke이고 외부 embed와 4319 요청을 CDP에서
차단한다. 실제 3사 OOPIF 응답은 네트워크 의존 `test:browser:live-embeds`에서만
검사한다. 편집기 상호작용·출력 계약은 현재 web smoke와 단위 테스트로 검증하며,
삭제된 전체 확장판 전용 E2E를 릴리스 근거로 사용하지 않는다. 단발성 Origin
migration은 별도 단위·localhost 통합 테스트로 검증한다.

caption stack 변경 시:

```bash
node --import tsx --test tests/local-caption-stack.test.ts
npm run caption-stack:doctor -- --json
npm run caption-stack:setup -- --dry-run
```

AudSeg 변경 시:

```bash
node --import tsx --test tests/audseg.test.ts
uv run --project AudSeg --extra dev pytest -q AudSeg/tests
uv run --project AudSeg --extra dev ruff check AudSeg
uv run --project AudSeg --extra dev ruff format --check AudSeg
```

실제 setup 통합은 native build와 모델 다운로드가 필요하므로 기본 CI에 넣지 않는다. 실행했다면 profile, backend, whisper revision, model SHA와 fixture 결과를 기록한다.

## 릴리스 합격 기준

- [ ] UI 방식이 `audseg-local`, `whisper-tiny` 두 개뿐이고 새 환경은 AudSeg 기본이며 Whisper 탭 첫 클릭은 연결 패널만 염
- [ ] 새 편집·이어 편집·복구마다 정확한 대상의 매 작업 권리·책임 확인을 새로 요구함
- [ ] 공개 정책 URL과 비민감 증빙 참조명 검증이 근거별로 분리되고 실제 증빙 원문을 저장하지 않음
- [ ] 정책 게이트가 양식만 검증하며 URL reachability·실제 허락을 판정하거나 시간만으로 편집기를 잠그지 않음
- [ ] 방송인별 정책 목록·과거 확인 캐시가 배포물에 없고 권리 확인 전체 입력을 프로젝트·복구본에 복제하지 않음
- [ ] 저장된 과거 설정의 지원하지 않는 모델·주소·자격증명을 폐기함
- [ ] 정상 런타임이 최소 companion 밖의 광범위한 브라우저 권한 없이 exact 127.0.0.1:4320에서 열리고 다른 탭을 읽지 않음
- [ ] Chromium의 두 load flag가 exact `streaming-companion/` 절대경로 하나만 가리키고 shared bridge protocol marker가 정확히 한 번 있으며 다른 unpacked 확장·원격 디버깅 포트가 없음
- [ ] protocol marker 누락·불일치·중복 companion은 stale로 표시하고 재사용하거나 자동 종료하지 않음
- [ ] 과거 관리 프로세스 전환은 exact 프로필·PID·시작 시각·실행 파일·명령행을 연속 재검증한 경우에만 한 번 정상 종료하며, 불명확한 프로세스에는 신호를 보내지 않음
- [ ] Origin migration은 명시적으로 켠 loopback 서버에서 exact 이전 Origin·분리된 single-use nonce만 허용하고 기본·공개 모드에서는 닫힘
- [ ] Popovic Git 앱 repository의 `hostnames=kirinuki.eff0rtchung.kr`, `web/.popovic-hosts`, versioned immutable asset query가 일치하며 `web/licenses/UNLICENSE.txt`와 루트 `UNLICENSE`가 모두 보존됨
- [ ] 4320 정적 서버가 loopback·exact Host·allowlist·traversal/symlink 차단을 검증함
- [ ] CHZZK·YouTube·SOOP VOD가 도메인으로 자동 분기되고 최초 범위는 선택 ±10초이며, 사람의 명시적 추가 로딩만 clip별 범위를 단조롭게 넓힘
- [ ] 추가 로딩이 검증된 기존 조각을 재사용해 필요한 차집합만 받고, 실패·취소·원본 변경 시 이전 로컬 영상과 편집 상태를 보존함
- [ ] YouTube·SOOP 도구 실행이 shell/config/cookie/login/netrc 없이 이루어지고 원격 재생 폴백이 없음
- [ ] 4319 gateway가 현재 설정된 exact Studio Origin 하나만 허용하고 4318 Whisper는 선택적 private route로 남으며 둘 다 127.0.0.1에만 bind함
- [ ] 계속 편집이 localhost IndexedDB의 정확한 project ID를 열며 새 URL·시간을 기존 프로젝트에 합치지 않음
- [ ] 1세션 1편집 완료 뒤 검증된 소유 범위의 캐시만 정리하고 중복 탭·검증 실패에서는 아무것도 삭제하지 않음
- [ ] 쇼츠가 빈 상태에서도 지속형 1080×1920 작업 공간으로 열리고, 본편 컷의 반복 append·occurrence별 삭제/undo·trim/분할/병합/재정렬·독립 자막/에셋/음성·crop/크기/위치·저장 후 재진입을 지원하며 본편 프로젝트를 변형하지 않음
- [ ] 자막 API 키 입력 UI와 요청 헤더가 없음
- [ ] Whisper endpoint가 loopback HTTP만 허용됨
- [ ] Whisper가 exact Origin·process-memory session을 검증함
- [ ] setup의 진단용 Whisper 연결 JSON이 exact 필드·현재 Studio Origin·127.0.0.1·16KiB·모델/profile 계약을 지키고 path·token·secret을 포함하지 않으며 정상 자동 연결은 파일 없이 동작함
- [ ] Tiny·Base·Small·Medium 실제 모델을 runtime에서 자동 감지하며 companion capability나 보고 모델이 지원 계약과 다르면 사용 불가
- [ ] AudSeg가 companion, Python, 모델, 네트워크 없이 브라우저에서 실행됨
- [ ] AudSeg 결과가 실제 빈 텍스트이고 모두 검수 대상임
- [ ] AudSeg가 처음 생성한 빈 cue가 clip 범위 안이고 최대 4초이며, 이후 사람이 조정한 모든 cue에는 전역 4초 제한이 없음
- [ ] 음악·효과음 감지 가능성이 UI와 문서에 명시됨
- [ ] Python 기준 구현과 TypeScript 포트의 핵심 fixture가 일치함
- [ ] 자동 자막 기본 위치와 문장부호 계약이 결정적임
- [ ] 사람 cue와 human-edited cue가 재실행 후 보존됨
- [ ] Whisper 활성 컷 0/16/17 경계와 AudSeg 17개 이상 실행이 오디오 추출 전에 올바르게 분기함
- [ ] 컷별 저장과 동일 지문 재개가 동작함
- [ ] 다른 원본·방식·pipeline은 낡은 체크포인트를 재사용하지 않음
- [ ] 빈 cue가 가짜 SRT 문구로 출력되지 않음
- [ ] 모델·binary·partial download·secret이 브라우저 배포물에 없음
- [ ] AudSeg MIT 전문과 third-party 고지가 배포물에 포함됨
- [ ] `npm run license:check`가 승인된 정확한 버전·라이선스·고지·대응 소스만 확인함
- [ ] `npm run check`와 `git diff --check`가 통과함
