# KirinukiHelper 개발 계약

이 문서는 저장소를 수정하는 사람과 자동화 에이전트가 지켜야 할 현재 제품 계약이다.
예전 Linux 소스 앱, 별도 브라우저 확장 프로그램, Electron 안에서 전체 편집기를
실행하는 구조, 사용자가 직접 주소·포트·프로세스를 관리하는 흐름은 제품 계약이
아니다.

## 제품 한 문장

Kirinuki는 `https://kirinuki.eff0rtchung.kr`에서 실행되는 일반 브라우저 컷 선택기와
전체 편집기, Windows x64·macOS Apple Silicon·Linux x64에 처음 한 번 설치하는
화면 없는 로컬 미디어 엔진으로 구성된다. 웹사이트가 제품 본체이고 설치 엔진은
브라우저만으로 안전하게 수행할 수 없는 VOD 범위 취득·검증만 보조한다.

일반 사용자는 다음 흐름만 경험해야 한다.

1. 웹사이트에 CHZZK·YouTube·SOOP 공개 완료 VOD URL을 붙여넣는다.
2. 같은 웹페이지의 원본 화면에서 Y/U/D/F/E/R/T 단축키와 보이는 버튼으로
   시작·끝·메모를 정한다.
3. 사용자는 원하면 시작 화면의 보조 링크에서 화면 없는 영상 준비 도우미를 미리
   받을 수 있다. 초기 컷 선택은 도우미와 무관하게 웹에서 끝내며, YouTube는
   E/R/D/F/Y/U가 공식 iframe 메시지 경계로 동작하고 CHZZK·SOOP은 플레이어 시각과
   웹의 컷 기준 시각을 맞춰 E/R/D/F를 쓴다.
4. **편집기 열기**를 누를 때 엔진이 아직 없으면 웹사이트가 같은 설치 안내를
   보여 주고, 엔진에 확정한 구간만 요청해 다운로드·
   검증·로컬 영상 구성 진행률을 같은 화면에서 설명한다.
5. 준비가 끝나면 같은 브라우저의 전체 편집기로 이동한다.
6. 컷·자막·레이어를 검수하고 제목과 저장 위치를 정해 내보낸다.

설치 뒤 사용자가 별도 앱 창, 로컬 주소, 포트, 토큰, 실행·종료 상태 또는 브라우저
확장을 보거나 조작해야 한다면 제품 회귀다. URL 입력부터 컷 선택과 전체 편집까지
항상 공개 웹사이트가 소유해야 하며, 설치 앱이나 custom protocol이 새 컷의 시작
화면이 되어서는 안 된다. Chrome이 최초 연결에서 표시하는 Local Network Access
권한은 운영체제·브라우저가 요구하는 한 번의 온보딩으로 설명하고, 그 뒤에는 일반
웹사이트처럼 동작해야 한다.

## 현재 배포 경계

```text
https://kirinuki.eff0rtchung.kr
  └─ URL 입력·원본 확인·컷 선택·full editor·자막·렌더 (일반 브라우저)
       └─ 127.0.0.1:4319 (내부 고정 loopback API)
            └─ 필요한 VOD 범위 취득·검증·로컬 캐시 (화면 없는 설치 엔진)

CHZZK / YouTube / SOOP ───────────────────────────────┘
```

- 공개 서버는 검증된 정적 웹 파일만 제공한다.
- 공개 서버는 VOD proxy, 프로젝트 저장소, 로그인 서버, 사용자 session 또는
  analytics·telemetry 수집기가 아니다.
- Cloudflare Tunnel은 정적 웹 origin에만 연결한다. 사용자 PC의 loopback 엔진을
  Tunnel, LAN 또는 공인 인터페이스에 노출하지 않는다.
- Electron은 세 OS의 동일한 background engine을 패키징하는 수단일 뿐이다.
  제품 runtime은 `BrowserWindow`를 만들지 않으며 background autostart도 창을 열지
  않는다. 컷 선택, 저장본 관리, 자막·렌더 UI는 모두 공개 웹에만 둔다.
- 엔진은 사용 통계나 업데이트 확인을 위한 독자적 네트워크 polling을 하지 않는다.
  사용자가 요청한 공개 VOD 범위를 원본 플랫폼에서 준비할 때만 외부로 연결한다.
- 장기 제품 설치 대상은 Windows x64, macOS arm64, Linux x64다. 현재 임시 공개
  테스트 배포는 Debian/Ubuntu와 Arch Linux x64만 제공하며 Windows/macOS에서는
  설치 링크를 숨기고 현재 지원 범위를 명확히 설명한다. 모바일은 편집 진입을
  막고 데스크톱 안내만 제공한다.
- 공개 installer 이름과 지원 범위는 `src/desktop/installer-contract.ts`가
  canonical 기록이다.

## 개발 실행

일반 사용자가 아래 명령을 실행하게 안내하지 않는다. 소스 체크아웃의 개발·검증
경로일 뿐이다.

```bash
npm ci --ignore-scripts
npm run build
npm run studio -- start
```

- `setup.sh`는 `npm ci --ignore-scripts`와 web build만 수행하는 개발 편의
  스크립트다. OS 앱 메뉴, XDG launcher 또는 사용자 명령을 설치하지 않는다.
- `kirinuki.sh`는 npm과 저장소 경로를 확인한 뒤 `npm run studio-server --`에
  인자를 그대로 전달하는 얇은 래퍼다.
- `package.json`의 `studio`가 `kirinuki.sh`를 호출하고, `kirinuki.sh`는
  `studio-server`를 호출한다. `studio`를 다시 호출하는 재귀를 만들지 않는다.
- `npm run studio -- start|status|stop`은 개발용 localhost 웹 서버만 관리한다.
  제품 설치기나 공개 웹사이트 실행 절차가 아니다.
- foreground 개발은 `npm run dev:web`을 사용한다.
- 개발 서버의 `127.0.0.1:4320`은 로컬 테스트 Origin이다. 공개 제품 문서나 UI가
  사용자에게 4320을 연결 대상으로 안내하면 안 된다.
- `npm run public-shell:start`는 기존 명령 이름을 유지하지만 현재 `web/`의 전체
  정적 앱을 제공한다. 기본 개발 origin은 loopback 4330이고, Cloudflare origin의
  Host 계약은 `kirinuki.eff0rtchung.kr`이다.
- 시스템 패키지를 대신 설치하거나 `sudo`, `su`, `curl | sh`를 실행하지 않는다.

## 선택적 저장소 전용 Whisper

공개 제품의 기본 자막 초벌은 브라우저 안의 `audseg-local`이다. 저장소에는 기존
작업 호환과 로컬 개발을 위한 `whisper-tiny` 경로가 남아 있지만, 현재 세 OS용
공개 미디어 엔진 installer에는 Whisper 모델을 포함하지 않고 공개 UI에서도
선택하게 하지 않는다.

저장소에서 Whisper 경계를 개발할 때만 다음 명령을 사용한다.

```bash
npm run caption-stack:doctor
npm run caption-stack:setup
npm run caption-stack:start
npm run caption-stack:status
npm run caption-stack:stop
```

- AudSeg 실행은 Whisper 설치, 모델, Python, session 발급 또는 네트워크 probe에
  의존하지 않는다.
- Whisper는 이 기기 안의 고정 loopback 경로만 사용하고 실패를 원격 STT로
  자동 전환하지 않는다.
- 모델과 binary는 고정 revision·크기·SHA-256을 검증한 뒤 저장소 밖 사용자 전용
  경로에 둔다. 기본 build나 CI에서 모델을 내려받지 않는다.
- 저장된 옛 Whisper endpoint·token이 잘못되어도 AudSeg 실행을 막지 않는다.
- repository-only Whisper는 한 번에 활성 컷 최대 16개, 컷당 최대 30분만
  처리한다. 실제 word timestamp를 cue 경계의 우선 anchor로 쓰며 글자 수 비례
  추정으로 시간을 꾸며 내지 않는다.
- 고정 profile은 `draft=tiny-q5_1`, `light=base-q5_1`, `auto=small-q5_1`,
  `quality=medium-q5_0`이다. `auto`는 메모리 6GiB 미만에서만 `light`로 내린다.
  사용자가 고른 더 무거운 profile을 다음 실행이 조용히 바꾸지 않는다.
- Whisper 코드를 일반 사용자용 기능으로 다시 노출하려면 installer 크기,
  모델 라이선스, 세 OS 생명주기, 보안과 실제 사용자 흐름을 별도 승인해야 한다.

## 사용자가 확정하는 값

- 컷 시작·끝, 활성 여부와 순서는 `authority: USER`다.
- 자동 로직은 컷을 새로 고르거나 경계를 조용히 확장·축소·병합·삭제·재정렬하지
  않는다.
- 영상 중간 삭제와 레이어 순서 변경은 명시적인 사용자 동작으로만 실행한다.
- 삭제나 시간축 변환 뒤 영상에 결속된 자막·이미지·음성은 같은 변환을 적용한다.
- 원본 전체와 최종 렌더를 Kirinuki 서버로 보내지 않는다.
- 시작 화면의 원본 frame은 시각 확인용이다. 실제 편집·분석·렌더는 검증된 로컬
  compact media 또는 사용자가 직접 고른 파일만 사용한다.
- 시작 화면은 다른 탭의 DOM, 로그인 상태, 쿠키 또는 플레이어를 읽거나 제어하지
  않는다.
- 자동 준비가 지원되지 않는 권한 있는 원본에는 실제 파일 선택기를 여는
  **내 파일 직접 연결**을 제공한다.

## VOD 범위와 원본 시간축

- 지원 원본은 CHZZK·YouTube·SOOP의 공개 완료 VOD다. live, private, 로그인 필요,
  DRM, 지역 제한을 우회하지 않는다.
- 사용자의 selection 앞뒤 10초는 최초 로컬 준비 여유다. 이 여유 때문에 편집기
  컷이 10초 밀리거나 원본 시각이 바뀌면 안 된다.
- decode/keyframe prefix는 로컬 파일 내부 구현이며 editable range나 selection
  anchor에 포함하지 않는다.
- 컷을 준비 범위 밖으로 명시적으로 옮겼을 때만 해당 clip lineage의 필요한
  방향을 단조롭게 넓힌다. 기존 범위를 줄이거나 다른 컷의 준비분을 잃지 않는다.
- CHZZK는 검증된 segment, YouTube·SOOP은 검증된 원본 조각을 재사용하고 누락된
  차집합만 받는다.
- 새 receipt와 media의 byte, duration, stream, hash, source-clock mapping이 모두
  검증된 뒤에만 현재 편집기 binding을 원자적으로 교체한다.
- 취소, timeout, 다운로드 실패 또는 진짜 원본 identity 변경 때는 기존 media,
  project와 재생 위치를 보존한다.
- 제목, signed CDN URL, 조회 시각 같은 가변 표시 정보만으로 원본 교체를
  판정하지 않는다. playlist·part·stream identity는 준비 전후에 비교한다.
- SOOP multi-part는 원본의 연속 시각으로 정규화한다.
- 외부 도구는 `shell:false`로 실행하고 사용자 cookie, login, netrc, 임의 yt-dlp
  설정 또는 remote playback fallback을 사용하지 않는다.
- signed URL, inKey, authorization header, loopback access value와 로컬 절대경로를
  project, recovery, 영구 receipt 또는 로그에 저장하지 않는다.

## 프로젝트·세션·복구

- 로그인과 서버 저장 session은 없다.
- URL 입력·컷 선택·편집기 진입은 같은 공개 웹 Origin과 같은 브라우저 저장 경계에서
  이어진다. 설치 엔진 창이나 별도 브라우저로 프로젝트를 handoff하지 않는다.
- 컷→편집기 전환은 canonical source, 사용자 selection, 이번 1회 권리 확인과 새
  `projectId`를 같은 탭의 짧은 session seed로 전달한다. URL에는 source, selection,
  access token, 암호키 또는 로컬 파일 위치를 넣지 않는다.
- 편집기 전환 전에 확정한 selection의 로컬 부분 준비를 완료한다. 편집기 진입 뒤
  같은 exact request를 다시 확인할 수 있지만 managed cache를 재사용해야 하며 전체
  VOD를 다시 받거나 별도 앱 화면으로 되돌아가면 안 된다.
- 탭을 닫으면 저장하지 않은 이번 작업을 폐기하는 것이 기본이다. 이어서 쓸
  저장본은 사용자가 **지금 저장** 또는 종료 확인에서 명시적으로 선택한다.
- 편집 중 CURRENT와 5분 복구본은 crash 복구용이다. 탭 종료 시 임시본을 정리하며,
  이를 계정 동기화나 영구 자동 저장으로 표현하지 않는다.
- 새 URL·구간으로 새 편집을 시작하면 새 `projectId`, `sourceSessionId`, generation과
  memory capability를 만든다. 이전 프로젝트의 media, pending response, undo,
  재생 위치 또는 캐시를 자동으로 섞지 않는다.
- 새로고침은 URL의 정확한 project/workspace를 다시 열고 일회성 “편집기 잠금”을
  만들지 않는다.
- 비동기 응답은 요청 당시 project/source/generation이 현재 값과 모두 같을 때만
  반영한다. A 작업을 닫은 뒤 B 작업에서 A 응답이 도착하면 폐기한다.
- 복구본은 exact project/source/workspace를 보여 준 뒤 사용자가 골랐을 때만
  적용한다. 오류를 이유로 오래된 복구본을 자동 우선하지 않는다.
- 복구 전 현재본을 별도로 보존하고, 미래 schema는 fail closed한다.
- 파일 권한만 만료됐으면 프로젝트를 초기화하지 않고 동일 identity의 파일을
  다시 선택하게 한다. 파일 identity가 바뀌면 낡은 자막 체크포인트를 폐기한다.
- 하나의 롱폼에서 여러 쇼츠 workspace를 만들 수 있다. 각 workspace는 독립 ID,
  이름, occurrence, 자막·이미지·음성·레이어와 저장 경계를 가진다.
- session 완료 정리는 검증된 출력 뒤 현재 project와 materialization의 단독 소유
  캐시만 지운다. 다른 프로젝트, 사용자가 직접 고른 원본, 불확실한 출력은
  삭제하지 않는다.

## 매 사용 권리 확인

- 새 편집, 이어 편집, 복구본 열기는 대상 project·source·목적에 결속된 이번 1회
  권리·책임 확인을 각각 새로 요구한다.
- 과거 확인이나 방송인별 정책을 캐시해 다음 작업에 자동 적용하지 않는다.
- 확인 gate는 필수 입력과 형식만 검증한다. 실제 허락, 정책 reachability 또는
  법적 적합성을 네트워크나 휴리스틱으로 판정하지 않는다.
- 실제 메일, 계약서, 스크린샷, 첨부파일, 계정 정보를 입력·저장하지 않는다.
- 게시, 업로드, 수익화 또는 플랫폼 승인을 자동 실행하지 않는다.

## AudSeg와 자막 불변조건

`audseg-local` 흐름은 다음과 같다.

```text
활성 컷
→ 16kHz mono Float32 PCM
→ 같은 브라우저 탭의 AudSeg DSP
→ 오디오 활동 구간
→ 최대 4초의 빈 timing cue
→ 사람 전사·타이밍 검수
```

- AudSeg는 STT가 아니다. 글, 언어, 화자 또는 발화를 꾸며 내지 않는다.
- AudSeg가 만든 cue 본문은 실제로 비어 있고 모두 `reviewRequired`다.
- 4,000ms 상한은 AudSeg가 **처음 빈 cue를 생성할 때만** 적용한다.
- 편집기에 생성된 뒤에는 모든 cue의 시작·끝을 자유롭게 옮기거나 늘릴 수 있다.
  불러오기, 재실행, 저장 또는 내보내기가 다시 4초로 자르면 안 된다.
- 음악, 효과음, 박수와 키보드 소리도 활동으로 감지될 수 있음을 UI에 알린다.
- 빈 cue를 가짜 문구로 바꾸거나 SRT에 placeholder로 출력하지 않는다.
- 사람이 직접 만든 cue와 `humanEdited` cue를 자동 재실행으로 덮어쓰지 않는다.
- 같은 시각에 여러 자막이 필요하면 별도 레인을 사용한다. 레인 수와 cue 위치,
  크기, 색, 배경, 외곽선은 사용자가 바꿀 수 있다.
- 자동 본문 기본 위치는 아래 중앙 `x=0.5`, `y=0.84`다. 새 cue의 lane 번호가
  달라도 기본 위치를 임의로 흩뜨리지 않는다.
- cue별 `fontScale`이 있으면 프로젝트 기본 크기보다 우선한다.
- 자막 속성 시트는 cue 본문을 DOM, 접근성 이름, tooltip 또는 dataset에 복제하지
  않고 위치·크기·색·상자 같은 파생 속성만 보여 준다.
- 자동 자막의 문장 끝 불필요한 `.`은 제거하고 `?`, `!`, `…`, `~`는 보존한다.
- 자동 본문은 Pretendard ExtraBold, 배경 없음, 한 줄을 기본으로 하고 한국어 폭
  20 단위 hard limit, 가능한 최소 650ms, 목표 읽기 속도 초당 16폭 단위를
  결정적으로 적용한다.
- `skills/align-song-subtitles-60fps/SKILL.md`는 사람이 완성한 영상 구도는 유지한
  채 노래 가사 타이밍을 1/60초 단위로 검수하는 반자동 프롬프트다. 결과는 사람이
  최종 검수하며, 컷을 자동 재구성하는 기능으로 설명하지 않는다.

AudSeg 기준 구현은 `AudSeg/src/audseg/`, 브라우저 포트는
`src/editor/audseg.ts`다. config와 golden fixture parity를 유지한다.

- 입력은 16kHz mono Float32 PCM이고 컷당 30분, PCM 128MiB를 넘기지 않는다.
- 분석은 20ms RMS frame과 10ms hop, adaptive noise floor, Schmitt hysteresis,
  debounce, padding과 merge를 사용한다.
- 긴 활동 구간은 quiet valley를 우선해 나누고 찾지 못할 때만 hard limit을 쓴다.
- 모든 활성 컷을 한 컷씩 처리하고 각 컷 뒤 결과와 checkpoint를 저장한다.

## 자막 checkpoint와 재개

- checkpoint에는 clip ID, 원본 시작·끝, 방식, pipeline·quality harness 지문,
  필요한 편집 문맥 지문, 완료 request ID와 시각을 포함한다.
- 동일 source, 범위, 방식과 지문의 완료 컷만 재개 시 건너뛴다.
- 새 전체 실행, 다른 source, 범위·방식·모델·알고리즘 지문 변경은 낡은
  checkpoint를 재사용하지 않는다.
- AudSeg 지문에는 `local-audseg`, `audseg-0.1.0-dsp`,
  `browser-audio-activity`와 config revision이 들어간다.
- Whisper 지문에는 실제 보고 모델, backend와 실행 방식을 포함한다.
- 구조 위반 결과는 정상 완료로 저장하지 않는다. 내용 불확실성은 cue별
  `qualityCodes`와 `reviewRequired`로 남긴다.

## 쇼츠·레이어·내보내기

- 쇼츠는 본편과 분리된 1080×1920 workspace다. 본편 구간을 보낼 때마다 새
  occurrence를 append하고 본편 프로젝트를 변형하지 않는다.
- occurrence별 trim, split, merge, reorder, delete와 undo를 지원한다.
- 영상 레이어별 source clock, scene-local range, crop, 위치, 크기, 불투명도,
  표시 여부와 z-order를 보존한다.
- 영상·이미지 레이어의 위·아래 관계는 버튼으로 조작할 수 있어야 한다.
- 이미지·추가 음성·자막은 workspace에 명시적으로 추가하며 다른 workspace에서
  조용히 공유하거나 복사하지 않는다.
- 내보내기 전에 사용자가 결과 파일 제목과 폴더를 정한다.
- 영상, project recovery JSON과 자막이 있으면 SRT를 함께 저장하고 최종 파일의
  byte·duration·stream을 확인한다.
- 저장 실패 시 렌더를 시작하지 않는다. 커밋 전 진행률을 100%로 표시하지 않는다.
- 실패 정리는 확실히 빈 임시 파일에만 적용한다. 기록된 byte가 있거나 commit
  여부가 모호한 파일은 복구 불가능하게 삭제하지 않는다.

## 웹↔로컬 엔진 보안

- 엔진 listener는 `127.0.0.1`에만 bind한다.
- production은 exact `https://kirinuki.eff0rtchung.kr` Origin, exact Host와
  protocol header만 허용한다. missing, `null`, lookalike Origin과 wildcard
  CORS를 거절한다.
- `Forwarded`, `X-Forwarded-Host`, DNS rebinding 또는 proxy 환경변수로 Host와
  loopback 경계를 우회하지 못하게 한다.
- health는 session을 만들지 않고 product, API protocol, engine version과 runtime
  readiness를 bounded timeout 안에 검증한다.
- 편집기 문서마다 memory-only nonce와 짧은 bearer capability를 발급한다.
- capability는 project, canonical source와 허용 action에 묶이고 만료된다.
  다른 탭, source, project, action이나 재시작 전 token을 받아들이지 않는다.
- `<video>`가 header를 붙이지 못하는 media GET/HEAD는 exact Origin과 job별
  추측 불가능한 access URL, range와 ownership을 함께 확인한다.
- token과 nonce를 URL query, disk, IndexedDB, project, CLI 인자 또는 로그에
  기록하지 않는다.
- 웹 컷 화면의 단축키는 문서가 직접 소유하고 IME, modifier, repeat, input·textarea·
  contenteditable을 건드리지 않는다. iframe script나 로컬 엔진 응답이 사용자 입력인
  것처럼 컷 경계를 조용히 바꾸면 안 된다.
- YouTube 공식 iframe은 exact source window·origin을 검증한 브라우저 메시지 경계로
  현재 시각과 E/R/D/F/Y/U 제어를 제공한다. CHZZK·SOOP처럼 브라우저 SOP 안에서
  신뢰할 시각 API가 없는 플랫폼은 플레이어에 표시된 시각을 사용자가 시작·끝 칸에
  직접 입력한다. 어느 경우에도 초기 컷 선택에서 loopback 엔진 설치를 요구하지
  않으며, 공개 서버 proxy나 Electron frame injection으로 우회하지 않는다.
- preview와 확정 구간 준비 요청은 device proof와 ECDH/AES-GCM channel 안에서만
  수행한다. 짧은 TTL, project/source/action scope, replay 방지와 제한된 pending
  개수를 적용한다.
- 엔진 재시작이나 업데이트 뒤 웹은 새 capability를 자동으로 발급받는다.
- 같은 exact engine이 이미 실행 중이면 멱등적으로 재사용한다. 다른 프로세스가
  내부 포트를 사용하면 takeover하거나 임의 종료하지 않고 안전하게 실패한다.
- 종료는 직접 만든 child/process group과 identity를 재검증한 뒤 수행한다.
  PID만 보고 다른 프로세스를 종료하지 않는다.
- Windows descendant는 Job Object, macOS·Linux는 검증된 process group 생명주기로
  orphan이 남지 않아야 한다. 이 native 보장이 없으면 공개 release를 막는다.

## 개인정보와 사용자 데이터

- 로그인, cookie 기반 Kirinuki session, analytics, telemetry, fingerprinting,
  session replay와 사용기록 수집을 추가하지 않는다.
- 원본 URL, 편집 내용, 저장본과 캐시는 사용자의 브라우저 origin storage 또는
  로컬 엔진 전용 저장소에만 둔다.
- API key, 플랫폼 cookie, authorization header와 개인 증빙 원문을 받거나
  저장하지 않는다.
- 광고를 넣더라도 source URL, project, capability, local media metadata를 광고
  SDK에 전달하지 않는다. 새로운 SDK는 개인정보·라이선스 검토를 먼저 거친다.
- 삭제는 exact project ownership과 regular-file 경계를 검증한다. symlink,
  traversal, unrelated 파일과 사용자 원본은 건드리지 않는다.

## 저장소 지도

- `src/web/`: 공개 시작 화면, PR16 계열 컷 선택 UX와 브라우저 플레이어 제어
- `src/editor/`: 브라우저 편집기, AudSeg, 로컬 엔진 onboarding/client
- `src/lib/`: source, project, time mapping, session과 capability 공용 계약
- `src/desktop/`: 화면 없는 background engine entry, autostart, 단일 인스턴스,
  installer 계약
- `scripts/caption-gateway.ts`: exact-Origin loopback gateway와 VOD job API
- `scripts/chzzk-vod-materializer.ts`: CHZZK 공개 VOD 범위 준비
- `scripts/external-vod-materializer.ts`: YouTube·SOOP 범위 준비
- `scripts/chzzk-vod-job-manager.ts`: 공용 VOD job, receipt, media lease와 cache
- `scripts/local-studio-server.ts`: 4320 개발용 정적 서버 lifecycle
- `scripts/public-shell-server.ts`: full `web/` 배포물을 제공하는 정적 origin 서버
- `scripts/build-web.ts`, `scripts/web-javascript-build.ts`: typed web build
- `scripts/package-web.ts`: 공개 정적 ZIP과 checksum
- `scripts/build-desktop.ts`, `scripts/package-desktop.ts`: native engine stage
- `scripts/package-desktop-installer.ts`: target installer build와 공개 서명 gate
- `scripts/linux-preview-release.ts`: Debian/Ubuntu·Arch Linux x64 테스트 설치본의 exact prerelease
  manifest·checksum·readback gate
- `web/`: 생성된 전체 정적 웹 배포물
- `public-shell/_headers`, `public-shell/.popovic-hosts`: web build의 배포 정책 원본
- `legal/`: 라이선스, provenance, 웹 배포와 binary release hard gate
- `tests/`: unit·contract·browser·native package 검증

삭제된 외부 browser extension, Linux-only helper, Electron full editor 또는 Origin
migration 파일을 문서·build·test inventory에 다시 넣지 않는다. 과거 Chrome
extension과 PR16은 웹 컷 UX·단축키의 회귀 기준이지 제품 runtime이나 배포물이
아니다. 파일이나 명령 이름이 바뀌면 이 지도를 같은 변경에서 갱신한다.

## 수정 절차

1. `AGENTS.md`를 끝까지 읽는다.
2. `git status --short`로 사용자와 다른 에이전트의 변경을 확인한다.
3. 관련 source, 생성물, test와 문서를 함께 찾는다.
4. 사용자 세션의 실제 project나 로컬 cache를 테스트 fixture처럼 수정하지 않는다.
5. 비밀 값과 credential 환경변수를 읽거나 출력하지 않는다.
6. 제품 UI 문구는 일반 사용자의 다음 행동을 설명한다. 내부 포트·프로세스 관리나
   개발 CLI를 해결책으로 노출하지 않는다.
7. 모델 download나 live VOD network test를 기본 build·unit CI에 넣지 않는다.
8. source/time mapping과 사람 cue 불변조건을 먼저 테스트한다.
9. 변경 범위의 focused test를 실행한 뒤 전체 gate를 실행한다.
10. generated `web/*.js`는 직접 편집하지 않고 `npm run build`로 갱신한다.

## 개발용 핫 리로드

- `npm run dev:editor`와 `web/dev-reload.json`은 localhost 개발 전용이다. 공개
  제품은 `dev=1` marker를 읽거나 reload observer를 시작하지 않는다.
- CSS만 바뀌면 stylesheet만 바꾸고 File handle, media binding, 재생 위치와
  CURRENT를 유지한다.
- TypeScript bundle이나 Worker를 다시 열기 전에는 진행 중인 작업, 같은 project의
  중복 탭과 저장되지 않은 파일 handle을 확인한다.
- 모든 선행 project write가 끝나고 CURRENT fingerprint가 같은 경우에만 exact
  `project=<id>&session=resume&dev=1`로 재로드한다.
- bundle 재로드가 보존한다고 약속할 수 있는 것은 CURRENT다. undo/redo,
  timeline 확대·스크롤 같은 탭 메모리를 보존한다고 표현하지 않는다.
- dev runner, validator와 packager는 같은 release lease를 사용한다. 강제 종료 뒤
  stale 파일 삭제 경쟁으로 상호 배제를 구현하지 않는다.
- 개발 marker, lock, source map과 test fixture는 공개 package에 포함하지 않는다.

## 기본 검증

```bash
npm run typecheck
npm run migration:check
npm run build
npm run build:desktop
npm run validate
npm run license:check
npm test
npm run audit
git diff --check
```

위 순서는 `npm run check`에 묶여 있다. Chromium·ChromeDriver가 있으면
`npm run check:full`로 localhost browser smoke도 실행한다.

변경 범위별 추가 검증:

```bash
# 공개 HTTPS와 Local Network Access/loopback 경계
npm run test:browser:public-shell
npm run public-shell:check -- https://kirinuki.eff0rtchung.kr

# native engine stage와 installer
npm run test:package:desktop
npm run test:package:desktop:installer
npm run test:semantic:engine

# web package
npm run package:web
npm run test:package:web:reproducibility

# 명시적으로 허가된 네트워크 liveness만
npm run test:liveness:live-vod
# GitHub-hosted release runner의 무쿠키 경계와 같은 부분 집합
npm run test:liveness:live-vod -- CHZZK SOOP
```

AudSeg 변경 시 Python 기준과 브라우저 포트를 함께 검사한다.

```bash
node --import tsx --test tests/audseg.test.ts tests/audseg-parity.test.ts
uv run --project AudSeg --extra dev pytest -q AudSeg/tests
uv run --project AudSeg --extra dev ruff check AudSeg
uv run --project AudSeg --extra dev ruff format --check AudSeg
```

`npm run migration:check`는 작성 JavaScript, inline script/event handler, type
suppression, generated bundle provenance와 삭제된 외부 extension 배포 경계의 재유입을
fail closed한다. `npm run license:check`는 승인된 dependency와 배포 고지를
검사하지만 native installer의 최종 SBOM·corresponding source·서명·공증을
대체하지 않는다.

## 오픈소스와 공개 release

- first-party 코드는 루트 `UNLICENSE`를 따른다.
- AudSeg는 MIT, Mediabunny는 MPL-2.0, Pretendard·Paperlogy는 OFL-1.1이다.
- Electron/Chromium/Node, FFmpeg·ffprobe, yt-dlp standalone은 target별 최종
  artifact inventory, notice, source·build provenance를 별도로 검증한다.
- 일반 CI가 만든 `UNSIGNED-TEST-ONLY-*` artifact는 계속 test-only이며 그대로
  업로드하지 않는다. 임시 Linux 공개 테스트만 native install/autostart/browser/
  uninstall smoke를 통과한 동일 byte를 별도 `*-preview.deb` 이름, exact manifest,
  SHA-256, GitHub build-provenance attestation과 prerelease 표기로 공개할 수 있다.
  이 예외를 stable signed release, 자동 업데이트 또는 다른 OS 지원으로 표현하지
  않는다.
- Windows Authenticode와 timestamp, macOS Developer ID·hardened runtime·
  notarization·staple, Linux 배포 서명과 세 OS readback이 완료되어야 한다.
- FFmpeg의 실제 buildconf에 GPL component가 있으면 적용 조건에 맞는 전체 원문과
  대응 소스 또는 source offer를 같은 release에서 제공한다. `--enable-nonfree`가
  있으면 공개를 차단한다.
- canonical hard gate는 `legal/WEB_DEPLOYMENT_CHECKLIST.md`와
  `legal/DESKTOP_BINARY_RELEASE_GATE.md`다. 항목이 하나라도 미완료이면 공개
  release를 만들지 않는다.

## 릴리스 합격 기준

- [ ] 제품 본체가 URL 입력·컷 선택·full editor를 모두 소유하는 public HTTPS 웹임
- [ ] 설치 엔진은 `BrowserWindow`, preload 또는 제품 UI 없이 필요한 VOD 범위만 준비함
- [ ] 설치 뒤 사용자가 포트·endpoint·token·프로세스를 관리하지 않음
- [ ] Q/E/R/T/A/D/F/Y/U가 PR16·최종 Chrome extension과 같은 의미로 웹에서 동작함
- [ ] 컷→편집기 전환 전에 확정 구간만 준비하고 같은 탭의 편집기가 cache를 재사용함
- [ ] CHZZK·YouTube·SOOP 실제 구간이 원본 시각과 정확히 맞음
- [ ] 새로고침과 A→B 전환이 project/source/generation 단위로 멱등적임
- [ ] 새 작업에 이전 media, cache, pending response 또는 recovery가 섞이지 않음
- [ ] 저장 의도를 명시한 경우와 폐기한 경우가 각각 예측 가능하게 동작함
- [ ] AudSeg는 빈 cue만 만들고 4초 조건을 전체 자막에 강제하지 않음
- [ ] 외부 브라우저 확장·Electron full editor·서버 VOD proxy·login·analytics가 없음
- [ ] exact Origin·Host·protocol·capability와 loopback-only bind가 negative test됨
- [ ] Windows x64·macOS arm64·Linux x64 설치→자동 시작→웹 연결→재설치→삭제를
      실제 native 환경에서 검증함
- [ ] 웹 ZIP과 세 installer의 manifest, digest, SBOM, notice, provenance가 고정됨
- [ ] 서명·공증·source 제공 의무와 실제 artifact readback이 모두 완료됨
- [ ] `npm run check`, 필요한 browser/native E2E와 `git diff --check`가 통과함

임시 Linux 공개 테스트에서는 마지막 세 OS installer 항목 대신 Debian/Ubuntu deb와
Arch pkg.tar.zst의 실제 install→autostart→웹 연결→remove, exact prerelease asset readback,
SHA-256과 GitHub attestation을 같은 commit에서 통과해야 한다. Windows/macOS 링크는
0개여야 하며 이 한정 승인은 위의 정식 세 OS 안정판 gate를 완료 처리하지 않는다.
