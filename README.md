# 치지직·YouTube·SOOP 키리누키 로컬 웹 스튜디오

CHZZK·YouTube·SOOP VOD의 URL과 사용할 시작·끝 시각을 직접 입력하고, 이 PC의
`http://127.0.0.1:4320`에서 컷·투명 이미지 에셋·구간별 음성·다중 한국어
자막을 검수해 영상을 내보내는 로컬 우선 웹 도구입니다. 일반 실행에는 과거의
사이드패널·service worker·수동 `chrome://extensions` 설정이 필요하지 않습니다.
`kirinuki`가 전용 Chromium에 UI 없는 최소 `streaming-companion/`만 자동으로
로드해, CHZZK·SOOP iframe의 재생 시계와 세 플랫폼 iframe 안의 단축키를 서버
중계 없이 현재 웹 화면에 연결합니다. YouTube 재생 제어 자체는 공식 IFrame API만
사용합니다.

사용자가 찍은 시작·끝은 `authority: USER`인 확정 범위입니다. AI는 재미있는 구간을 대신 고르거나 경계를 자동으로 늘리지 않고, 선택된 범위의 한국어 자막 초안만 만듭니다. 텍스트, cue 시작·끝·레인·색상·자막별 글씨 크기, 영상 위 자막 위치, 구간별 음량과 컷 경계·내부 삭제 범위는 사람이 직접 고칠 수 있습니다. 새 자막은 어느 레인에 추가해도 화면 아래 중앙 `x=0.5`, `y=0.84`에서 시작합니다.

미디어 입력은 두 가지입니다. 공개 완료 **CHZZK·YouTube·SOOP VOD**에서는 사용자가 확정한 각 구간의 앞뒤 10초와 독립 디코딩에 필요한 최소 조각만 로컬 companion이 이 PC에 먼저 준비합니다. 사람이 컷을 그 범위 밖으로 더 옮기면 필요한 방향의 구간만 이어 받아 검증된 새 로컬 편집 영상으로 바꿉니다. 원격 스트리밍 편집이나 전체 VOD 다운로드가 아니며, 전송 주소와 session 값은 프로젝트에 저장하지 않습니다. 라이브·비공개·접근 제한 원본과 수동 작업은 사용 권한이 있는 로컬 원본 파일을 직접 연결합니다. 로그인·쿠키·DRM·지역·접근 제한은 우회하지 않습니다. 준비한 조각과 최종 렌더는 이 기기에 남습니다. 자막 초벌의 기본 화면은 **AudSeg 이용하기**입니다. AudSeg는 브라우저 안에서 모델 없이 소리 활동을 찾아 사람이 채울 빈 타이밍만 만듭니다. 글 초안도 필요할 때만 오른쪽 **Whisper**를 누르고 이 PC의 loopback companion을 연결합니다. 두 방식 모두 인터넷 자막 서비스나 API 키를 사용하지 않습니다.

편집기 열기·저장 프로젝트 재개·복구본 선택 전에는 이번 VOD의 권리·책임 경고를 읽고 여섯 확인란을 매번 직접 선택해야 합니다. Kirinuki는 방송인별 정책 목록이나 과거 판정을 내장·캐시·자동 재사용하지 않으며, 이 확인이 실제 권리나 게시 허가를 만들어 내지도 않습니다.

이 프로젝트는 NAVER·치지직·YouTube·Google·SOOP의 공식 제품이나 제휴 제품이
아닙니다. 각 서비스명과 상표의 권리는 해당 권리자에게 있습니다.

## Linux 빠른 설치

다른 Linux PC에서 저장소를 내려받은 뒤 `KirinukiHelper` 폴더에서 다음 하나를
실행합니다.

```bash
./setup.sh
```

GitHub 소스 ZIP처럼 실행 권한이 보존되지 않은 파일을 받았다면
`bash setup.sh`로 같은 절차를 시작할 수 있습니다. 설정이 성공하면 도우미가
두 셸 파일의 사용자 실행 권한을 복원합니다. 설정이 의존성 안내에서 멈췄다면
필요한 도구를 설치한 뒤 다시 `bash setup.sh`를 실행하세요.

대화형 도우미가 환경을 진단하고, npm 의존성 설치·웹 편집기 빌드·정적 검증을
순서대로 수행합니다. 자막 방식은 모델이나 서비스가 필요 없는 **AudSeg**와
로컬 **Whisper** 중에서 고를 수 있습니다. 두 방식 모두 공개 VOD 구간 준비용
고정 `yt-dlp` artifact와 고지를 검증해 사용자 XDG 경로에 설치하며, Whisper를
고른 경우에만 `whisper.cpp`와 검증된 모델도 설치합니다. 셸 도우미는 `sudo`나 `curl | sh`를
자동 실행하지 않으며, 시스템 도구가 빠졌다면 Debian/Ubuntu·Fedora·Arch용
설치 예시를 모두 보여 준 뒤 멈춥니다.

설치 뒤에는 로컬 스튜디오 서버와 미디어 gateway를 시작하고 전용 Chromium
프로필로 `http://127.0.0.1:4320`을 엽니다.
설정 과정은 현재 저장소를 가리키는 `~/.local/bin/kirinuki` 명령과 앱 메뉴의
**KirinukiHelper** 항목도 원자적으로 설치·갱신합니다. 데스크톱 항목은 일반
웹 링크나 HTML의 기본 앱을 가로채지 않습니다. 새 터미널에서 다음처럼
저장소 위치와 무관하게 실행할 수 있습니다.

```bash
kirinuki
kirinuki open "https://chzzk.naver.com/video/..."
kirinuki status
kirinuki doctor
```

인자 없는 `kirinuki`와 앱 메뉴 항목은 곧바로 최신 엔진의 `open`을 실행합니다.
평상시에는 일반 `chromium` 명령이 아니라 `kirinuki start [영상 URL]`을
사용해야 전용 프로필과 현재 로컬 런타임이 함께 열립니다. URL을 넘기면 시작
화면의 원본 URL에만 안전하게 채워지며 시작·끝 시각은 사람이 직접 입력합니다.
코드 갱신 뒤에는 `kirinuki stop` 후 `kirinuki start`로 로컬 서버를 다시
시작하세요. 확장 프로그램을 새로고침할 단계는 없습니다.
저장소 안의 `./kirinuki.sh`를 인자 없이 실행할 때만 기존 한글 메뉴가 열립니다.
`kirinuki`를 찾지 못하면 `~/.local/bin`을 `PATH`에 한 번 추가하거나 기존처럼
`./kirinuki.sh`를 사용하세요. `doctor`와 `status`는 사용자 명령이나 앱 메뉴가
다른 체크아웃을 가리키는 stale 상태를 실제 경로와 함께 표시합니다.
과거 도우미가 만든 것으로 정확히 식별된 `chromium-kirinuki.desktop`이
HTTP·HTTPS·HTML 기본 앱을 가로채고 있으면 `setup`이 삭제하지 않고
`.retired-시각` 이름으로 옮겨 비활성화합니다. 이름만 같은 다른 앱 파일은
자동으로 변경하지 않습니다. `update-desktop-database`가 설치돼 있으면 사용자
앱 디렉터리의 캐시만 인자 배열로 갱신하고, 없으면 다음 로그인 때 갱신될 수
있다고 안내합니다. 어느 경우에도 일반 기본 브라우저 연결을 추측해 바꾸지
않습니다.

설치 대상에 KirinukiHelper marker가 없는 사용자의 파일·심볼릭 링크·특수
파일이 이미 있으면 `setup`은 어느 진입점도 덮어쓰지 않고 멈춥니다. 현재
생성물과 정확히 식별한 구 Kirinuki 진입점만 갱신하며, 구 파일은 같은 폴더의
`.backup-*` 복구본으로 보존합니다.

이 자동 경로는 **Chromium 120 이상**용입니다. 실행 인자는 생성된
`streaming-companion/`의 exact 절대경로 하나만 `--load-extension`과
`--disable-extensions-except`에 넣습니다. 다른 unpacked 확장은 함께 로드하지
않습니다. 같은 실행에는 현재 typed bridge와 같은
`--kirinuki-streaming-companion-protocol=kirinuki-streaming-bridge/v2` marker를
정확히 한 번 넣습니다. 이미 실행 중인 전용 Chromium에서 이 marker가 없거나
다르거나 중복되면 이전 companion을 재사용하거나 강제 종료하지 않고, 창을
정상 종료한 뒤 `kirinuki`를 다시 실행하라고 안내합니다.

단, `linux-helper`가 같은 전용 프로필·실행 파일·PID·시작 시각·명령행을 모두
재검증해 과거 전체 확장판의 정확한 관리 프로세스라고 판정한 경우에는 그
프로세스에 한 번만 `SIGTERM`을 보내 정상 종료를 기다린 뒤 같은 프로필을 최소
companion으로 다시 엽니다. 식별값이 바뀌거나 다른 프로세스가 섞이면 신호를 더
보내지 않고 사용자가 창을 닫도록 안내합니다.

```bash
./kirinuki.sh start "https://chzzk.naver.com/video/..."
./kirinuki.sh start "https://www.youtube.com/watch?v=..."
```

명령 없이 `./kirinuki.sh`만 실행하면 설치·실행·상태·진단·종료를 고르는 한글
메뉴가 열립니다.

```text
./kirinuki.sh setup    # 설치 또는 자막 방식 다시 선택
./kirinuki.sh doctor   # 읽기 전용 환경 진단
./kirinuki.sh start    # 전용 Chromium 실행, URL은 선택
./kirinuki.sh status   # 도우미와 로컬 Whisper 상태
./kirinuki.sh stop     # 관리형 4320/4319와 선택적 Whisper를 정상 종료
./kirinuki.sh help
```

Chromium은 XDG 사용자 데이터 경로의 Kirinuki 전용 프로필을 사용합니다. 이
프로필은 `http://127.0.0.1:4320` Origin의 IndexedDB·파일 권한을 안정적으로
이어 가기 위한 것이며 기존 일반 브라우저 프로필을 초기화하거나 브라우저를
강제 종료하지 않습니다. 포트를 임의로 바꾸면 브라우저 저장소 Origin도 달라지므로
4320은 고정입니다. `KIRINUKI_BROWSER_PROFILE_ROOT`를 쓰는 고급 설정은 검증된
절대경로만 허용합니다.

이전 전체 브라우저 확장판에만 저장된 프로젝트가 있다면 그 버전이 이미 설치된
전용 프로필에서 **저장소 한 번 옮기기**를 먼저 실행합니다. 현재 릴리스는 과거
전체 bundle을 다시 배포하거나 빌드하지 않으며, 프로젝트·복구본·이미지 에셋을
localhost IndexedDB로 가져오는 단발성 Origin 호환 창구만 유지합니다. 브라우저
파일 핸들과 이미 삭제된 임시 캐시는 자동 이전 대상으로 간주하지 않습니다.
마이그레이션 HTTP 경로는 정상 실행과 공개 web 릴리스에서 기본으로 닫혀 있습니다.
이전 데이터를 옮길 때만 실행 중인 studio server를 정상 종료한 뒤
`node --import tsx scripts/local-studio-server.ts start --enable-legacy-migration`
으로 한 번 명시해 시작하고, 이동이 끝나면 다시 옵션 없이 시작합니다. 이 opt-in은
관리용 health nonce와 분리된 일회성 migration nonce를 정확히 식별한 이전
브라우저 Origin에만 전달하며 localhost가 한 번 소비하면 재사용할 수 없습니다.

### 수동 설치와 실행

셸 도우미 없이 설치하려면:

1. Node.js 22 이상에서 `npm ci --ignore-scripts && npm run build`를 실행합니다.
2. `npm run studio-server:start`로 고정 `127.0.0.1:4320` 서버를 시작합니다.
3. VOD 자동 준비에는 `127.0.0.1:4319` gateway도 실행합니다.
4. Chromium 120 이상에서 아래 **전용 Chromium 프로필을 직접
   열기**의 두 exact `streaming-companion/` 플래그와 함께
   `http://127.0.0.1:4320`을 엽니다. URL만 일반 창에서 열면 YouTube 공식 API는
   동작해도 CHZZK·SOOP 재생 시계 bridge는 활성화되지 않습니다.
5. 원본 URL과 사용할 시작·끝 시각을 직접 입력합니다.

Linux에서 로컬 자막 초벌까지 쓰려면 최초 한 번 다음을 이어서 실행합니다.

```bash
npm run caption-stack:doctor
npm run caption-stack:setup
npm run caption-stack:start
```

`setup`은 고정 revision과 SHA-256의 whisper.cpp·다국어 모델·Silero VAD를 사용자 데이터 폴더에 설치하고 제3자 고지문도 함께 둡니다. 옵션 없이 실행하면 기본 `draft` 프로필의 다국어 `tiny-q5_1` 모델을 준비합니다. API 키는 받거나 저장하지 않습니다. `./kirinuki.sh setup`은 실행 중인 관리형 foreground 서비스를 안전하게 중지·재설정·복원하고, active systemd-user 서비스는 저수준 setup이 재시작합니다. 저수준 `caption-stack:setup`을 직접 쓰는 중 foreground가 실행 중이면 자동으로 덮어쓰지 않고 `caption-stack:stop → setup → start` 순서를 안내하며 멈춥니다. 다음 작업부터는 `npm run caption-stack:start`만 실행하면 됩니다. `auto`, `light(base-q5_1)`, `quality(medium-q5_0)`는 Tiny보다 더 무거운 모델을 명시적으로 선택할 때 사용합니다. 상세 운영법과 개발 불변조건은 [AGENTS.md](AGENTS.md)에 있습니다.

`setup`은 내부 진단용 연결 JSON도 exact 브라우저 Origin
`http://127.0.0.1:4320`과 gateway `http://127.0.0.1:4319`에 맞춰 씁니다.
정상 편집 흐름은 이 파일을 열거나 읽지 않고 fixed loopback gateway에 직접
자동 pair·probe합니다. 이전 브라우저 확장 Origin으로 setup한 적이 있다면
`caption-stack:setup`을 한 번 다시 실행하세요. AudSeg는 companion 설치가
필요 없습니다.

### 전용 Chromium 프로필을 직접 열기

기존 브라우저 프로필과 분리하고 싶다면 저장소 최상위에서 다음처럼 실행할 수 있습니다.

```bash
chromium \
  --user-data-dir="$HOME/.config/chromium-kirinuki" \
  --disable-extensions-except="$PWD/streaming-companion" \
  --load-extension="$PWD/streaming-companion" \
  --kirinuki-streaming-companion-protocol=kirinuki-streaming-bridge/v2 \
  --no-first-run \
  --no-default-browser-check \
  http://127.0.0.1:4320/
```

이 명령은 서버를 시작하지 않으므로 먼저 `kirinuki start` 또는 로컬 서버 명령을
실행해야 합니다. 두 확장 로드 플래그는 exact 최소 companion 경로에만 필요하고,
protocol marker는 현재 빌드와 실행 중인 companion의 일치를 판별합니다. 이전
전체 브라우저 확장판이나 원격 디버깅 포트는 사용하지 않습니다.

## 통합 편집 흐름

1. `kirinuki start [VOD URL]`로 `http://127.0.0.1:4320`을 엽니다. URL을
   생략했다면 시작 화면에 CHZZK·YouTube·SOOP VOD URL을 붙여넣습니다.
2. 원본 페이지에서 장면을 확인한 뒤 시작·끝을 `초`, `MM:SS` 또는
   `HH:MM:SS`로 직접 입력합니다. **빈 구간 추가**로 필요한 컷을 반복합니다.
3. 프로젝트 이름을 입력하고 이번 사용의 권리·책임 확인란 여섯 개를 직접
   선택합니다. 합격은 양식과 형식만 검사하며 실제 허락의 진실성을
   네트워크로 판정하지 않습니다.
4. **편집기 열기**를 누릅니다. 입력한 URL·시간과 정확한 프로젝트 ID가
   같은 브라우저 세션의 편집기에 전달되며 다른 원본 탭을 제어하지 않습니다.
5. 지원하는 공개 VOD라면 정책 확인 뒤 편집기가 각 선택의 최초 `±10초` 준비를 자동으로 시작합니다. 도메인에 따라 CHZZK·YouTube·SOOP용 로컬 준비 방식을 자동 선택하며, 실패했거나 같은 범위를 다시 확인할 때만 **편집 영상 준비/다시 준비**를 누릅니다. 지원 밖의 소스는 **내 파일 직접 연결**에서 권한이 있는 로컬 영상 파일을 선택합니다.
6. 수동 로컬 파일의 시작점이 페이지 영상 시각과 다르면 **페이지 시각 ↔ 로컬 원본 정렬** 오프셋을 먼저 맞춥니다. 자동 준비한 VOD는 원본 VOD 시각으로 고정되어 별도 오프셋을 쓰지 않습니다.
7. 필요하면 컷 트랙 양끝 손잡이를 끌어 경계를 직접 조정합니다. 준비된 경계를 넘겨 놓거나 컷의 **앞 30초·뒤 30초 더 받기**를 누르면 그 방향에 필요한 부분만 추가로 준비한 뒤 같은 편집 위치에서 이어집니다.
8. 기본 **AudSeg 이용하기**로 빈 타이밍을 바로 만듭니다. 글 초안도 필요하면 오른쪽 **Whisper**에서 **이 PC의 Whisper 자동 연결** 또는 **활성 컷 전체 자막 초안 만들기**를 누릅니다. 편집기가 loopback PC 도우미와 실제 실행 모델을 자동 확인하며 파일 탐색기를 열지 않습니다.
9. `영상 → 에셋 → 음성 → 자막` 타임라인에서 이미지·자막·음성을 검수합니다. 영상 중간을 덜어낼 때는 재생헤드에서 `시작 [I]`와 `끝 [O]`을 찍고 **구간 삭제**를 누릅니다. 삭제 뒤 영상과 연결된 에셋·음성·자막은 함께 당겨집니다. 웹 이미지 자체를 복사한 뒤 편집기에서 `Ctrl/Cmd+V`를 누르면 현재 위치에 에셋으로 들어가며 PNG·WebP의 투명 영역도 보존됩니다. 자막 레인은 기본 2개이며 `+`로 늘릴 수 있습니다. **선택 자막 색상** 오른쪽 레지스터는 고정 흰색 `#FFFFFF`와 최근 비흰색 5개를 기억하고 `1`~`6`으로 바로 적용합니다. **자막 속성 시트**는 본문을 전혀 싣지 않고 모든 자막의 위치·설정 크기·색상·검은 상자와 반복 설정 묶음을 시간순으로 비교해, 가장 흔한 값과 다른 항목을 검수 후보로 표시합니다. `J`/`K`는 같은 레인의 이전·다음 자막, `,`/`.`는 이전·다음 컷, `Space`는 재생·일시정지입니다. 타임라인 **자석**으로 자막↔에셋 경계를 가까이 끌어 붙이고, 같은 컷의 둘을 선택한 뒤 **선택 에셋 구간에 정확히 맞춤** 또는 **선택 자막 구간에 정확히 맞춤**으로 양끝을 한 번에 일치시킬 수 있습니다. 구버전 AI 초벌의 화면 위치가 섞여 있으면 **AI 자막 전체를 기본 위치로 정렬**을 한 번 누릅니다.
10. 큰 편집 전에는 **지금 저장**을 누를 수 있습니다. 편집기는 5분마다 자동 저장본을 만들며, **저장 목록**에서 이 기기의 최근 5개 중 하나를 고르면 현재 상태를 먼저 저장한 뒤 불러옵니다.
11. 별도 세로 파일도 필요하면 본편의 **쇼츠 소스 만들기**를 누릅니다. 임의 시간 구간과 원본 픽셀 영역을 고르면 컷 경계마다 독립 영상으로 나뉘어 1080×1920 검은 캔버스에 들어갑니다. 자막·사진·음성은 자동 복사하지 않으며 필요한 원본 음성은 선택 영상의 **원본 음성 에셋 추가**로 넣습니다. 최초 영상을 포함한 모든 영상은 삭제·표시·순서·불투명도·crop·배치를 독립적으로 바꿀 수 있고, **+ 영상 추가**로 현재 시각에 최대 9개를 겹칩니다. 각 영상은 긴 원본을 반복 탐색하지 않도록 별도 로컬 미리보기 파일로 준비하며 4K 소스는 임의 crop 품질을 위해 UHD 범위까지 보존합니다. 실행 취소나 분리된 원본 음성도 이 파일을 재사용합니다. 1–24px 외곽 틈·내부 seam은 최종 합성 검사와 **밀대로 모두 밀기**로 관련 사각형만 보정합니다. 미리보기와 1080×1920 출력은 같은 crop·배치 및 적응형 품질 정책을 사용하며 쇼츠 변경은 본편을 바꾸지 않습니다.
12. **영상 내보내기**에서 폴더를 한 번 고르면 MP4 또는 WebM, 무결성 검증 가능한 `.kirinuki-session.json`, 자막이 있을 때 SRT가 같은 폴더에 저장됩니다. 영상과 모든 sidecar의 크기·SHA-256·복원 무결성을 확인하고 확인창 뒤에도 한 번 더 같은 파일인지 검증한 경우에만 **세션 완료·로컬 재료 삭제**를 고를 수 있습니다. 삭제를 고르면 이 프로젝트가 단독 소유한 CHZZK·YouTube·SOOP 준비 조각·compact 영상·영수증과 브라우저 프로젝트·임시저장·쇼츠 영상 캐시·이미지 에셋·파일 핸들을 한 세션 단위로 정리합니다. 다른 프로젝트와 사용자가 직접 고른 원본 파일은 삭제하지 않습니다. 삭제 도중 종료되어 격리본이 남아도 다음 companion 시작에서 정확한 관리형 root와 이름·실경로·파일 유형을 모두 검증한 orphan만 회수하며, 이상 항목이 있으면 VOD 시작을 중단합니다. 일반 다운로드 폴백, 검증 실패, 같은 프로젝트의 다른 편집기 탭이 열린 경우에는 아무 캐시도 삭제하지 않습니다.

### 원본 스트리밍 창과 로컬 편집 미디어

시작 화면의 **원본 스트리밍 창**은 구간 시각을 고르고 확인하기 위한 client-side
viewer입니다. YouTube는 공식 `youtube-nocookie.com/embed/<video-id>`와 문서화된
IFrame Player API(`YT.Player`)를 브라우저에서 직접 사용하고, SOOP은 공식
`vod.sooplive.com/player/<vod-id>/embed` URL을 사용합니다. CHZZK는 공개된
VOD 전용 embed 경로를 임의로 만들지 않고 canonical
`chzzk.naver.com/video/<video-id>` 페이지를 frame에 표시하며, 플랫폼의 frame
정책으로 보이지 않을 때를 위해 **원본 새 탭** 버튼을 항상 둡니다.

viewer는 브라우저에서 플랫폼으로 직접 연결되며 4320/4319 서버가 영상을 proxy
하거나 쿠키·token을 받지 않습니다. 이 frame은 시각 선택용일 뿐, 미리보기·자막
오디오·내보내기에 쓰는 미디어는 4319가 별도로 준비·검증한 로컬 compact MP4입니다.
`frame-src`는 CHZZK, YouTube No-Cookie, SOOP의 실제 frame용 세 Origin만
허용합니다. YouTube 주소일 때만 공식 API loader를 받도록 `script-src`에
`https://www.youtube.com`을 exact host로 허용합니다. YouTube의 탐색·배속은
raw 메시지가 아니라 공식 API만 쓰고, iframe에 포커스된 단축키만 source·세대·
WindowProxy·exact origin을 검증하는 typed bridge로 전달합니다. 라이브·clip·
playlist·지원 밖 경로·스푸핑 host는 player
URL로 변환하지 않고 fail-closed합니다. 이 외부 서비스 연결은 코드 재배포
라이선스가 아니라 각 플랫폼의 현재 서비스 약관이 적용되는 별도 경계입니다.

CHZZK·SOOP이 광고와 본편 사이에서 video DOM이나 MediaSource `TimeRanges`를
순간 교체해도 마지막으로 검증한 원본 시계를 유지한 채 client-side polling을
계속합니다. 광고 의미가 표시된 DOM의 video는 원본 시계 후보에서 제외하고,
일시적인 player/source 상태 실패는 같은 iframe에서 자동 재확인합니다. E/R/D/F/Y/U
명령도 절대 시각·멱등 배속으로 제한해 짧게 재시도하므로 이 전환만으로 frame을
새로고치거나 원본을 내려받지 않습니다. 원본 회차 불일치처럼 복구하면 안 되는
오류만 제어를 중단하고 W로 현재 문맥을 다시 확인하도록 안내합니다.

최소 companion이 parent 명령을 받는 기본 allowlist는 exact
`http://127.0.0.1:4320` 하나입니다. HTTPS 웹 배포용 companion은
`KIRINUKI_ALLOWED_ORIGIN=https://kirinuki.eff0rtchung.kr`를 명시해 해당 공개
Origin 하나로 빌드하고, 각 사용자 PC의 VOD runtime·caption stack도 같은 Origin으로
setup합니다. 공개 프론트엔드는 Popovic이 정적으로 제공하며 로컬 4320 서버를
Tunnel에 노출하지 않습니다. 4319와 선택적 4318도 사용자 PC의 127.0.0.1에만
남습니다. 경로·쿼리·wildcard·다른 HTTPS Origin은 빌드·설정 단계에서 거부하며,
localhost와 공개 Origin을 한 companion allowlist에 묵시적으로 섞지 않습니다.

Popovic 같은 정적 서버는 응답 시점에 HTML의 Studio Origin token을 바꿀 수
없습니다. tracked `web/`은 현재 문서가 위의 exact 공개 Origin일 때만 그 token을
자체 해석하고 다른 host에서는 실패합니다. `studio.css`, `studio.js`, editor CSS·JS,
AudSeg worker의 `?v=<package version>`도 한 릴리스에서 함께 바뀌어 Popovic의
immutable cache가 이전 bundle을 섞어 제공하지 않게 합니다.

Popovic에 등록할 때 Git 앱 설정은 `repo_subdir=web`과
`hostnames=kirinuki.eff0rtchung.kr`를 함께 지정합니다. `web/.popovic-hosts`는
mounted-source bootstrap용 선언이며 Git 앱 라우팅에는 사용되지 않습니다.
Popovic Git 배포는 확장자 없는 dotfile과 `web/UNLICENSE`를 복사하지 않으므로
공개 first-party 원문은 `web/licenses/UNLICENSE.txt`에서 제공하고 저장소의
canonical `UNLICENSE`도 유지합니다.

공개 전에는 Popovic의 요청·오류·최대 지연시간 RED 집계를 완전히 비활성화하고
기존 `popovic.json`의 `metric_buckets`를 지워야 합니다. 또한 HTTP 응답에
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, 최소
`Permissions-Policy`, COOP·CORP와 HTTPS HSTS를 적용해야 합니다. HTML의 meta CSP는
정적 호스팅의 안전한 fallback일 뿐 클릭재킹 방지 응답 헤더를 대신하지 않습니다.

내보내기를 시작하면 현재 프로젝트를 먼저 로컬 복구 초안으로 저장합니다. 수동
연결 영상은 파일이 편집 중 바뀌지 않았는지 다시 확인하고, 자동 준비 VOD는 이미
무결성을 확인해 둔 compact 로컬 편집 영상과 원본 시각 매핑을 사용하므로
내보내기 중 원격 VOD를 다시 읽지 않습니다. 긴 출력은 파일 인코딩과 브라우저
파일 커밋이 모두 끝날 때까지 최대 99%로 표시되며, 실제 커밋 뒤에만 100%가
됩니다. 실패 시 확실히 빈 출력만 정리하고, 기록된 바이트가 있거나 커밋 여부를
확인할 수 없는 파일은 복구 가능성을 위해 지우지 않습니다.
따라서 `NetworkError`가 나더라도 임시저장 목록과 출력 폴더를 먼저 확인하세요.

### 닫은 편집 이어서 열기

다시 작업할 때는 원래 치지직·YouTube·SOOP 탭을 먼저 찾을 필요가 없습니다.

1. 같은 전용 Chrome/Chromium 프로필에서 `http://127.0.0.1:4320`을 엽니다.
2. **저장된 편집**에서 제목, 최근 시각과 `컷 · 자막 · 이미지 · 음성` 수를 확인합니다.
3. 마지막으로 저장된 현재본을 열려면 **계속 편집**을 누르고 이번 사용의 권리·책임 정보를 새로 입력합니다. 저장된 CHZZK·YouTube·SOOP 공개 원본 링크는 필요할 때 별도 탭으로 열 수 있지만 편집기 재개와 결속은 저장된 프로젝트 identity를 기준으로 합니다.
4. 최근 5개의 수동·자동·복원 직전 저장 중 하나를 고르려면 **복구본 선택**을 누른 뒤 같은 확인을 완료합니다. 편집기가 열리면서 저장 목록이 바로 표시됩니다.
5. 복구본을 실제로 불러오기 전 현재본은 자동으로 `복원 직전` 임시저장되므로 잘못 골라도 다시 돌아갈 수 있습니다.

이 경로는 저장된 `projectId`를 직접 열며 시작 화면의 새 URL·시간을 기존 프로젝트에 합치지 않습니다. 원본 URL은 목록 UI나 요청값을 신뢰하지 않고 저장된 CURRENT 프로젝트에서 다시 읽어 지원 플랫폼의 공개 canonical URL로 정규화합니다. 원본이 삭제·비공개 상태이거나 같은 회차임을 확인할 수 없으면 로컬 편집기는 그대로 열고 원본 연결 실패만 안내합니다. 권리·책임 입력도 정확한 저장 프로젝트와 재개·복구 목적에 묶이며 과거 작업의 값을 자동으로 채우지 않습니다. 같은 프로젝트가 이미 다른 탭에서 편집 중이면 두 번째 편집기는 저장을 시작하지 않고 기존 탭을 사용하라는 안내와 함께 잠깁니다. 자동 준비한 CHZZK·YouTube·SOOP VOD는 저장된 materialization ID와 무결성 영수증으로 이 기기의 MP4를 먼저 다시 열므로 이미 완료된 작업은 원격 원본 연결 없이도 복원할 수 있습니다. 파일이 없거나 손상됐을 때만 같은 계획을 다시 확인·준비합니다. 수동 원본의 파일 권한이 만료된 경우에는 **내 파일 직접 연결**에서 같은 파일을 다시 고르세요. 두 초벌 방식 모두 API 키가 필요 없습니다. companion session은 탭을 닫으면 사라지고 다음 연결 때 자동으로 다시 발급됩니다.

공개 CHZZK·YouTube·SOOP VOD 편집은 긴 원본 파일을 먼저 연결해 필요한 바이트를 그때그때 읽는 흐름을 사용하지 않습니다. companion이 활성 컷마다 최초 `선택 범위 ±10초`와 독립 디코딩에 필요한 제한된 앞 조각의 합집합만 받아 로컬 편집 영상을 먼저 만듭니다. 사람이 더 넓은 경계를 명시하면 기존에 검증한 조각을 재사용하고 아직 없는 구간의 차집합만 받아, 불변 새 세대의 compact MP4와 매핑을 만듭니다. 새 결과가 완전히 검증되기 전에는 기존 영상·편집본·재생 위치를 바꾸지 않습니다. 이후 미리보기·자막용 오디오 추출·렌더링은 모두 원본 VOD 시각↔이 짧은 편집 영상의 compact 시각 매핑을 거칩니다. 디코더용 앞 조각은 재생 안정성에만 쓰이며 사용자가 편집할 수 있는 범위에는 포함되지 않습니다. 수동 로컬 파일 연결은 라이브·비공개·권한 제한 원본과 자동 준비 실패 소스용 명시적 호환 경로로 남습니다.

편집기가 `127.0.0.1`에 보내는 미디어 Range 요청은 CHZZK·YouTube·SOOP 원본을 중계하는 원격 스트리밍이 아닙니다. 준비가 끝나 무결성 검증까지 통과한 compact MP4를 같은 PC의 companion이 브라우저에 전달하는 로컬 파일 전송이며, 완료본은 원격 플랫폼이 응답하지 않아도 다시 열 수 있습니다.

Whisper를 연결했을 때의 자막 파이프라인은 로컬에서 결정적으로 실행됩니다.

```text
활성 컷 오디오
→ 이 기기에 연결된 whisper.cpp 다국어 모델 timed STT
→ segment 문장 + 중복 본문 없는 word 경계 anchor의 canonical timed units
→ STT 타임스탬프 경계를 우선한 로컬 cue 초벌
→ 로컬 kr-vtuber-clean-v2 품질 하네스
→ 실제 word 경계 분할·화자 alias 정규화·cue별 품질 gate
→ 편집기의 검수용 자막 초안
```

Whisper 로컬 초벌은 LLM이 문장 길이로 싱크를 다시 추정하지 않습니다. sentence-like segment의 본문을 보존하고 실제 word timestamp를 cue 시작·끝과 분할 경계의 우선 anchor로 사용합니다. coverage가 낮으면 시간을 꾸며 내지 않고 검수 표시를 남기며, 로컬 `kr-vtuber-clean-v2` 품질 하네스가 최종 시각·구조를 결정합니다.

AudSeg 경로는 별도의 모델·서버·키 없이 같은 16kHz PCM을 브라우저에서 분석합니다. 20ms RMS 프레임과 적응형 소음 바닥, 히스테리시스, debounce·padding·merge를 사용해 소리 활동 구간을 찾고 **처음 생성하는 빈 타이밍 cue만** 최대 4초 단위로 나눕니다. 결과는 실제 텍스트가 비어 있는 검수용 cue이며 음악·효과음도 활동으로 잡힐 수 있습니다. 따라서 AudSeg는 STT의 대체 전사기가 아니라 **수동 자막을 빠르게 시작하기 위한 타이밍 도구**입니다.

`kr-vtuber-clean-v1`의 자동 본문 자막은 **배경 없는 한 줄·아래 중앙 고정**(`x=0.5`, `y=0.84`, `placement=bottom`)입니다. 같은 스타일 선택기에서 **흰 자막 · 검은 사각 배경**을 프로젝트 기본값으로 고를 수 있고, 선택 자막 패널의 **이 자막 검은 상자 켜기/끄기** 버튼 또는 `X` 키로 자막 하나씩 기본값을 덮어쓸 수 있습니다. 자막 텍스트 입력 중에는 이 단축키가 실행되지 않으며, 편집기 미리보기와 최종 영상은 같은 개별 배경 설정을 사용합니다. 동시 화자가 별도 타임라인 레인을 사용해도 화면 위치를 위로 자동으로 쌓지 않습니다. 한글·한자·이모지는 1, 공백은 0.35, 라틴 문자는 0.55처럼 계산한 한국어 폭 단위를 기준으로 한 줄 20을 상한으로 사용합니다. 표시 시간은 가능한 650ms 이상, 읽기 속도는 초당 16폭 단위 이하를 목표로 합니다. 프로젝트 자막 전체에는 최대 표시 시간 제한이 없습니다. 최대 4초는 AudSeg가 처음 만드는 빈 타이밍 cue에만 적용되는 생성 조건입니다. Whisper 초벌을 포함해 만들어진 모든 cue의 시작·끝은 자유롭게 옮기거나 늘릴 수 있고, 사람이 조정한 길이를 로딩·재실행이 4초로 되돌리지 않습니다. 문장 끝의 `.`은 제거하지만 `?`, `!`, `…`, `~`는 유지합니다. 기본 화자는 흰색, 구분 가능한 다른 화자는 안정적인 고유 색을 사용합니다. 사람이 만든 자막, 사람이 고친 AI 자막과 강조용 추가 레인은 덮어쓰지 않습니다. 사용자가 **AI 자막 전체를 기본 위치로 정렬**을 명시적으로 누른 경우에만 적용 직전 임시저장 뒤 기존 AI origin 자막의 위치 전체를 초기화하며, 글·시각·색과 직접 만든 자막은 유지합니다.

Whisper는 한 번에 활성 컷 최대 16개, 두 방식은 한 번의 실행에서 새 AI cue 최대 10,000개로 제한합니다. AudSeg는 활성 컷 개수 상한 없이 프로젝트의 모든 활성 컷을 한 컷씩 순차 처리합니다. 실행 전 활성 컷 수·총 길이와 선택 방식이 표시됩니다. AudSeg는 컷 하나당 30분·16kHz mono Float32 PCM 128MiB 안전 상한을 적용하며 Whisper endpoint나 session 상태를 읽지 않습니다. 취소하면 아직 시작하지 않은 컷은 처리하지 않습니다. 컷 하나가 끝날 때마다 결과와 체크포인트를 저장하며, AudSeg는 16개를 넘는 프로젝트에서도 완료한 모든 컷의 체크포인트를 보존합니다. 따라서 중간 실패·취소·탭 종료 뒤 같은 범위·선택 방식·실행 지문·품질 하네스 지문으로 다시 누르면 완료 컷을 건너뛰고 실패 지점부터 재개합니다. 필요한 지문이 없거나 달라진 예전 체크포인트, 새 전체 실행과 다른 원본 연결의 체크포인트는 재사용하지 않습니다.

로컬 하네스가 공백·종결 마침표, 길이·표시 시간과 하단 위치를 안전하게 고친 경우에는 **자동 정리 경고**로 알려 줍니다. Whisper의 STT 대비 발화 누락·추가 가능성, segment↔word anchor coverage 저하, 해결되지 않은 읽기 속도·너비·짧은 표시 시간은 cue 자체의 **품질 검수 필요** 사유로 저장되어 노란 검수 상태로 보입니다. 구조 계약을 로컬 복구 뒤에도 위반하면 원래 STT 경계를 조용히 움직이거나 일반 완료본으로 저장하지 않고 격리합니다. AudSeg cue는 텍스트를 만들지 않으므로 항상 사람 검수 대상입니다.

### 로컬 Whisper와 AudSeg

새 환경은 **AudSeg 이용하기**로 시작합니다. AudSeg는 현재 브라우저 탭에서만 실행되고 companion 연결을 요구하지 않습니다. 생성된 빈 cue마다 원음을 듣고 글·화자·색을 직접 채우세요. 이 기본 화면은 Whisper companion에 startup 요청을 보내지 않습니다.

글 초안이 필요하면 Whisper stack을 setup·start한 뒤 편집기의 오른쪽 **Whisper**를 누릅니다. 첫 클릭은 연결 화면만 열며 자막 생성을 시작하지 않습니다. **이 PC의 Whisper 자동 연결**이나 자막 만들기를 누르면 편집기가 exact `http://127.0.0.1:4319` gateway에 자동 pair·probe하고 실제 companion 모델을 검증한 뒤에만 **연결됨**을 표시합니다. 파일이나 실행 경로를 고를 필요가 없습니다. 선택적인 whisper.cpp 엔진은 gateway 뒤의 private loopback `127.0.0.1:4318`에서만 동작하며 브라우저가 직접 공개 API로 사용하지 않습니다. session token은 현재 탭 메모리에만 있고 프로젝트나 브라우저 저장소에 저장하지 않습니다.

설치할 수 있는 profile과 실제 모델은 다음 넷입니다.

| profile | 실제 모델 | 용도 | 다운로드 크기 |
|---|---|---|---:|
| `draft` | `tiny-q5_1` | 빠른 초안 | 약 32 MB |
| `light` | `base-q5_1` | 저사양 PC용 | 약 60 MB |
| `auto` | `small-q5_1` | 속도·품질 균형 | 약 190 MB |
| `quality` | `medium-q5_0` | 정확도 우선 | 약 539 MB |

`auto`는 메모리가 6GiB 미만이면 `light` / `base-q5_1`로 하향될 수 있습니다. 편집기의 모델 목록은 설치나 교체 버튼이 아니며, 현재 실행 중인 모델을 자동으로 설명하는 안내입니다. 모델을 바꾸려면 `caption-stack:stop → caption-stack:setup -- --profile ... → caption-stack:start` 순서로 다시 설치·실행한 뒤 편집기에서 자동 연결을 다시 누르세요.

```bash
npm run caption-stack:doctor
npm run caption-stack:start
npm run caption-stack:status
npm run caption-stack:stop
```

정상 웹 클라이언트는 exact `http://127.0.0.1:4319` companion만 허용합니다. 예전 버전에 저장된 `localhost` 별칭·다른 포트·원격 주소·모델·자격증명 필드는 불러올 때 버리고 실행에 사용하지 않습니다. Whisper가 실패해도 다른 네트워크 서비스로 자동 전환하지 않습니다. 전체 설치·프로필·복구·보안·트러블슈팅은 [AGENTS.md](AGENTS.md), 화면별 사용법은 [HELP.md](HELP.md)를 참고하세요.

### CHZZK·YouTube·SOOP VOD 자동 준비

- CHZZK, YouTube, SOOP VOD 페이지에서 같은 구간 선택 UI를 사용합니다. 주소의 도메인과 원본 ID로 플랫폼을 자동 판별하므로 사용자가 다운로드 방식을 고르지 않습니다.
- YouTube의 watch·짧은 주소·Shorts·최상위 embed는 같은 영상 ID라면 안정적인 watch URL 하나로 정규화합니다. 광고 재생 중에는 광고 시각이 프로젝트에 섞이지 않도록 캡처를 막습니다.
- SOOP은 현재 `vod.sooplive.com/player/...`와 호환용 레거시 VOD 재생 주소를 같은 원본으로 정규화합니다. 채널·라이브 페이지는 VOD로 오인하지 않습니다.
- 새 편집기로 들어오면 활성 사용자 선택 구간을 합친 뒤 각 구간의 최초 앞뒤 10초 준비를 자동으로 시작합니다. **편집 영상 준비/다시 준비**는 자동 준비 실패나 명시적인 재확인에 사용합니다. 이후 사람이 컷별 앞·뒤 추가 로딩을 명시하면 기존 범위를 유지한 채 그 방향의 누락분만 받습니다. 서로 겹치는 범위는 한 번만 받으며 전체 장시간 VOD 파일을 먼저 만들지 않습니다.
- CHZZK·SOOP은 `yt-dlp`가 고른 정확한 공개 HLS rendition을 고정한 뒤 누적 `EXTINF` 플레이어 시계에 걸치는 fMP4 조각만 받고, 원격 조각의 원시 PTS가 아니라 그 플레이어 시계에서 로컬 구간을 자릅니다. YouTube는 선택된 H.264 video/AAC audio 입력의 포맷 identity·0초 원점·길이를 먼저 증명한 뒤 같은 원본 시각으로 필요한 범위만 준비합니다. SOOP의 여러 파트는 공식 브라우저 플레이어가 제공한 전체 파트 벡터와 추출 메타데이터가 정확히 같을 때만 하나의 연속 원본 시계로 다룹니다.
- 로그인·브라우저 쿠키·netrc·DRM·지역 또는 접근 제한 우회는 사용하지 않습니다. 공개적으로 접근할 수 없거나 진행 중인 라이브는 실패로 표시합니다.
- 결과는 검증이 끝난 H.264/AAC MP4와 원본↔로컬 시간 매핑으로 캐시됩니다. 추가 로딩은 본편·쇼츠가 참조하는 clip별 범위를 모두 합쳐 다른 컷을 줄이지 않으며, 실패·취소·원본 버전 변경 때는 이전 결과를 그대로 둡니다. 편집기 재생은 원격 스트리밍 폴백 없이 이 로컬 결과만 사용합니다.

일반 실행 경로는 사용자의 임의 `yt-dlp`나 설정 파일을 사용하지 않습니다. `./kirinuki.sh setup`이 공식 `yt-dlp` 2026.07.04 Unix artifact를 사용자별 XDG 데이터 경로에 내려받고 정확한 크기와 SHA-256을 확인한 뒤, 설정 시 확인한 Node·Python·FFmpeg·ffprobe의 절대 경로와 함께 고정합니다. Node 22+, Python 3.11+, FFmpeg와 ffprobe가 시스템에 없거나 필요한 H.264/AAC/MP4 기능을 제공하지 않으면 이유를 표시하고 중단하며, 도우미가 관리자 권한이나 시스템 패키지 설치를 대신 수행하지 않습니다. 설치·상태·종료를 따로 점검하려면 `npm run vod-runtime:doctor`, `npm run vod-runtime:setup`, `npm run vod-runtime:status`, `npm run vod-runtime:stop`을 사용할 수 있습니다. 전체 VOD를 별도로 받는 레거시 CLI는 제거했으며, 지원 플랫폼은 모두 같은 최초 `선택 구간 ±10초`와 명시적 누락 구간 추가 준비 흐름을 사용합니다.

### LIVE와 다시보기·로컬 파일 시간 맞추기

같은 채널의 LIVE와 공식 다시보기가 같은 방송 시작 시각을 가지면 편집기는 둘을 같은 회차로 연결합니다. 기준은 `channelId + broadcastStartedAt/liveOpenDate`입니다. 원본 파일의 0초가 치지직 방송의 0초와 같다면 오프셋은 `0`으로 둡니다.

CHZZK·YouTube·SOOP 자동 준비본과 직접 연결한 로컬 파일 모두 편집기 공식은
다음과 같습니다.

```text
로컬 원본 시각 = 페이지에서 선택한 시각 + 오프셋
```

예를 들어 페이지의 100초 장면이 로컬 파일 90초에 있다면 오프셋은 `-10`초입니다. 첫 컷의 화면·음성이 맞지 않거나 컷이 파일 길이 밖이라는 경고가 나오면 이 값을 먼저 확인하세요. 오프셋을 바꾸더라도 사용자가 찍은 원래 구간 자체를 조용히 변경하지 않습니다.

## 사용자 확정 컷 원칙

- 저장한 시작·끝은 최종 컷 경계이며 AI가 자동 확장·축소하지 않습니다.
- 겹치는 선택도 자동 병합하거나 삭제하지 않습니다.
- 기본 연결 순서는 사용자가 저장하고 편집기에서 정한 순서입니다.
- 편집기에서 사용자가 지정한 내부 범위를 삭제하면 컷을 필요한 조각으로 나누고 뒤 영상·에셋·음성·자막을 한 번에 리플 이동합니다.
- 음성 인식이 경계 밖 문맥을 참고하더라도 결과 영상과 자막 cue는 선택 범위 안에만 생성됩니다.
- 더 나은 경계가 있어 보여도 제안으로만 표시하며, 사용자가 직접 핸들을 움직인 경우에만 반영됩니다.

이 원칙은 시작 화면에서 전달하는 capture seed, 편집기의 시간축 변환과 관련
단위 테스트에 같은 계약으로 적용됩니다.

## 매 작업 권리·책임 게이트

Kirinuki는 특정 방송인·소속사·플랫폼의 규정 목록이나 과거 판정을 내장하지
않습니다. 방송인 이름을 내부 목록과 대조하거나 이전 입력을 다음 작업에 자동
적용하지도 않습니다.

편집기 열기와 저장 프로젝트 재개·복구마다 대상 VOD의 키리누키 허용, 별도
서면 허락 또는 공식 편집 권한 중 실제로 해당하는 근거가 있는지 사용자가 앱
밖에서 확인합니다. Kirinuki에는 증빙 파일이나 참조명을 입력하지 않습니다.
화면에는 이 기기에서의 취득·편집, 게시·수익화, 제3자 권리, 플랫폼 제한과
100% 사용자 책임을 한 번에 고지하며 사용자는 여섯 확인란을 직접 선택합니다.

이 게이트는 필수 값과 형식만 검사합니다. 네트워크에 접속해 실제 허락 여부나 증빙의 진실성을 심사하지 않으며, 한 번 열린 같은 프로젝트·원본·목적의 편집기를 시간만으로 자동 잠그지도 않습니다. 입력 오류, 구버전 런타임, 프로젝트·세션·목적 불일치는 서로 다른 오류로 표시합니다.

이 입력은 `UsagePolicyAttestation`으로 정규화되어 정확한
`projectId + sourceSessionId + purpose`에 묶입니다. 새 편집, 재개와 복구는 서로
다른 목적이므로 다른 실행의 입력으로 대신할 수 없습니다. localhost 런타임은
전체 입력을 프로젝트에 복제하지 않고 현재 브라우저 세션의 최소 gate만
`sessionStorage`에 둡니다.

사용자 진술은 Kirinuki의 승인이나 법률 판단이 아닙니다. 수익·음원·제3자 권리는 별도로 확인하고, 근거를 읽거나 확인할 수 없으면 `SOURCE_UNREADABLE`, `THIRD_PARTY_UNVERIFIED` 또는 `PUBLICATION_BLOCKED`로 남깁니다. 사람 검수 전 자동 게시·업로드·수익화는 금지합니다.

## 정확도와 데이터 보존

- 시작 화면은 CHZZK·YouTube·SOOP VOD의 canonical URL과 사람이 직접 입력한 시작·끝 시각을 사용합니다. 다른 웹사이트 탭의 DOM·플레이어·로그인 상태를 읽거나 제어하지 않습니다.
- 편집 프로젝트·자막·파일 핸들·붙여넣은 이미지 Blob은 고정 `http://127.0.0.1:4320` Origin의 IndexedDB에 자동 저장됩니다. 작은 로컬 UI 설정은 같은 Origin의 `localStorage`에 둡니다.
- 편집기용 권리 확인의 전체 입력은 프로젝트·IndexedDB에 복사하지 않습니다. 정확한 프로젝트·원본 회차·목적에 묶인 최소 gate만 현재 탭의 `sessionStorage`에 둡니다.
- 공개 CHZZK·YouTube·SOOP VOD에서 자동 준비한 조각·compact MP4·무결성 영수증은 Linux 기본값으로 `${XDG_STATE_HOME:-~/.local/state}/kirinuki-vod-runtime/vod-fragments`에 저장됩니다. 프로젝트 JSON에는 원본 시각↔compact MP4 매핑과 materialization ID만 들어가며 원격 전송 URL, `inKey`, bearer token, 로컬 파일 경로는 들어가지 않습니다.
- 편집기의 수동·5분 자동·복원 직전 임시저장은 프로젝트별 최근 5개만 같은 IndexedDB에 보관합니다. 원격 서버로 전송하지 않으며 localhost 사이트 데이터를 지우면 함께 사라질 수 있습니다.
- 시작 화면의 **저장된 편집**은 IndexedDB에서 제목·최근 시각·항목 수만 읽어 표시합니다. 프로젝트 내용이나 세션 접근값을 목록 데이터로 복사하지 않으며 **계속 편집**은 정확한 `projectId`의 현재본, **복구본 선택**은 최근 5개 이 기기 저장본을 엽니다.
- 원본 전체, 대표 프레임 픽셀, 이미지 에셋과 최종 렌더는 자막 처리기에 보내지 않습니다. Whisper 모드의 활성 컷 16kHz 오디오는 이 기기의 whisper.cpp와 로컬 하네스만 거칩니다. AudSeg 모드는 같은 PCM을 브라우저 안에서 분석합니다.
- 자동 session token은 현재 편집기 탭·companion 프로세스 메모리에만 두고 loopback endpoint와 자막 방식 선택만 localhost `localStorage`에 보관합니다.
- 시작 화면에 다른 URL을 입력했을 때 기존 구간과 원본이 섞이지 않도록 플랫폼과 회차·영상 ID 충돌을 감지해 새 기록을 막습니다.
- 같은 채널의 서로 다른 생방송은 `channelId + broadcastStartedAt`으로 구분합니다.
- 같은 YouTube 영상 ID의 watch·Shorts·embed·짧은 URL은 같은 회차로, 서로 다른 ID는 다른 회차로 구분합니다.
- 같은 프로젝트의 중복 편집기 탭은 Web Locks의 단일 writer lease로 차단합니다. Web Locks가 없는 브라우저는 `BroadcastChannel` 동시 진입 검사로 보완하고 두 API가 모두 없으면 저장 손실을 피하기 위해 편집기를 열지 않습니다.
- 새 프로젝트의 기본 `한국 버튜버 키리누키 · 클린` 스타일은 사용자의 완성본 2개에서 뽑은 190개 표본 프레임을 기준으로 측정한 화면 높이 6.75%의 배경 없는 흰색 `Pretendard ExtraBold` 800, 검정 외곽선, 하단 `y=0.84`입니다. `Paperlogy ExtraBold` 800을 쓰는 한 줄 OFL 대안도 스타일 선택에서 고를 수 있습니다. 사람이 이미 정한 기존 프로젝트 스타일은 유지됩니다.

두 글꼴은 SIL Open Font License 1.1 원문과 출처를 함께 배포합니다. Pretendard는 공식 `v1.3.9` WOFF2를 고정했으며 글꼴 SHA-256은 `dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3`, 라이선스 SHA-256은 `d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04`입니다. Paperlogy는 공식 commit `8ef35f53b318c7ca914c52b1b382b9a8bad07a61`의 `Paperlogy-8ExtraBold.woff2`를 고정했으며 글꼴 SHA-256은 `5047db061c39ec5ed5c9d0b71c7aaad4b9547ed15ce48d1cd74090169f132bc0`, upstream 라이선스 SHA-256은 `603b2e7ef9effb9037b0b67f0530cacdc05e71a4e569032d7e4d98c2e6763135`입니다. 정확한 소스 링크, bundled license 해시와 준수 문구는 [Third-party notices](legal/THIRD_PARTY_NOTICES.md)를 기준으로 합니다.

`npm run license:check`는 npm 패키지 이름·버전·라이선스, Mediabunny 대응 소스와 MPL 원문, AudSeg MIT 원문, 두 글꼴과 OFL 사본, runtime Whisper·Silero 모델 고지를 fail-closed로 대조합니다. 승인 목록 밖의 패키지나 라이선스가 추가되면 일반 빌드 검증이 실패합니다. 이 검사는 배포 구성의 오픈소스 의무를 자동 점검하는 장치이며, 사용자가 가져오는 영상·음원·이미지의 이용 허가를 대신하지는 않습니다.

저장된 수동 원본 권한이 만료되면 **내 파일 직접 연결**을 다시 눌러 같은 파일을 선택하세요. 시작 화면의 **모든 로컬 작업 초기화**는 브라우저의 구간·편집 프로젝트·임시저장·파일 핸들을 지우지만, 디스크의 원본 영상·내보낸 파일·companion이 준비한 VOD 조각은 삭제하지 않습니다. VOD 조각을 비우려면 먼저 `./kirinuki.sh stop`으로 현재 companion을 정상 종료한 뒤 위 `vod-fragments` 폴더를 파일 관리자에서 명시적으로 삭제하세요. 삭제하면 해당 프로젝트는 다시 다운로드하기 전까지 자동 복원되지 않습니다. localhost 사이트 데이터를 지우거나 다른 포트·프로필로 열면 저장 프로젝트를 볼 수 없습니다.

### 권한과 네트워크

정상 실행은 탭·storage·side-panel 같은 광범위한 브라우저 권한을 사용하지 않습니다.
최소 companion은 현재 Studio가 직접 embed한 CHZZK·SOOP frame의 HTML video만
제어하고, YouTube No-Cookie frame에서는 단축키만 부모 Studio로 전달합니다.
URL·쿠키·token·미디어 바이트를 메시지로 보내지 않으며 다른 열린 탭을 읽지
않습니다. YouTube 재생 제어는 공식 IFrame API만 사용합니다. 사용자가 입력한 공개
VOD URL만 `127.0.0.1:4319` gateway에 전달합니다. 웹 페이지가 허용하는 로컬
연결은 기본 exact `http://127.0.0.1:4320`, 또는 명시적 공개 배포의 exact
`https://kirinuki.eff0rtchung.kr` Origin에서 다음으로 한정됩니다. 공개 HTTPS
페이지에서는 Chromium의 최초 로컬 네트워크 접근 권한 허용이 필요합니다.

- `http://127.0.0.1:4319`: VOD 준비·검증·Range 전송과 caption session gateway
- `127.0.0.1:4318`: Whisper를 선택했을 때 gateway 뒤에서만 쓰는 선택적 private 엔진
- AudSeg: 현재 브라우저 탭 내부 처리

자동 session token은 탭을 닫으면 사라지고 저장된 프로젝트·임시저장·브라우저
저장소에는 들어가지 않습니다. 원격 자막 호스트·API 키·원본 업로드는 없습니다.

## 알려진 제한

- 자동 선택 조각 준비는 공개·무쿠키·무DRM CHZZK·YouTube·SOOP 완료 VOD를 지원하며, 최초 각 선택의 앞뒤 10초와 사람이 추가로 요구한 누락 구간 및 디코딩 조각만 받습니다. 라이브·비공개·로그인 필요·접근 제한 원본은 자동 준비하지 않습니다. 모든 소스는 본인이 소유하거나 다운로드·편집 권한을 받은 경우에만 사용해야 합니다.
- YouTube는 VOD만 지원합니다. 진행 중인 라이브, 광고 재생 시각, 임의 사이트 내부 iframe은 타임스탬프 대상으로 사용하지 않습니다.
- 입력 컨테이너를 읽을 수 있어도 Chrome이 영상·오디오 코덱을 디코딩하지 못하면 미리보기·자막용 오디오 추출·렌더가 실패할 수 있습니다.
- 새 편집기의 자막 기본값은 AudSeg입니다. Linux에서 Whisper를 선택해 새로 설치할 때의 기본 profile은 `draft tiny-q5_1`이며, 로컬 whisper.cpp와 하네스가 STT 타임스탬프 경계를 우선해 초안을 만듭니다. AudSeg는 모델 없이 활동 구간만 만들며 전사를 제공하지 않습니다.
- 선택 컷 오디오는 이 기기 밖으로 전송되지 않습니다. 제품에는 자막용 인터넷 API, API 키 입력, 원격 companion 폴백이 없습니다.
- 주 영상 트랙과 주 오디오 트랙만 사용합니다. 본편 출력은 최대 1920×1080, 쇼츠 출력은 고정 1080×1920이고 둘 다 최대 60fps입니다. VFR 입력은 컷 경계를 보존하는 CFR 출력으로 바뀝니다.
- 이미지 에셋은 PNG·JPEG·WebP·GIF를 지원하며 GIF는 정지 프레임 에셋으로 처리합니다. 같은 시각의 에셋은 선택 가능한 하위 줄로 펼쳐지고, 내보낼 때는 현재 필요한 이미지만 순차 디코드합니다. 동시에 표시되는 이미지의 실제 RGBA 메모리 상한은 256MiB입니다. SVG와 원격 URL만 붙여넣는 방식은 지원하지 않습니다.
- 음성은 고정 1개 레인에서 구간별 음량·뮤트·페이드만 조절합니다. 음원 분리, 다중 오디오 트랙과 플러그인 효과는 제공하지 않습니다.
- 출력은 가능한 경우 H.264/AAC MP4, 그렇지 않으면 VP9/Opus WebM입니다. 하드웨어 인코더가 없으면 Chrome이 제공하는 기본·소프트웨어 인코더로 내려갑니다.
- Chrome의 폴더 저장 API를 쓸 수 없는 환경에서는 영상과 sidecar가 개별 다운로드되고, 영상 출력 전체가 메모리에 머뭅니다. 긴 고해상도 작업은 Chrome 120+의 폴더 저장 경로를 권장합니다.
- 자막이 하나도 없으면 `.ko.srt`는 만들지 않습니다. 영상과 `.kirinuki.json`은 항상 생성합니다.

## 개발 검증

Node.js 22 이상에서 localhost 시작 화면·편집기 번들, 로컬 서버 정적 검증과
단위 테스트를 실행합니다.

편집기 코드를 자주 고칠 때는 개발 전용 안전 핫 리로드를 사용할 수 있습니다.

```bash
npm run dev:editor
```

이 명령은 `scripts/dev-web.ts`에서 `web/`만 빌드·감시하고 개발 marker도
`web/dev-reload.json`에만 둡니다. 최소 companion은 일반 `npm run build` 또는
`npm run streaming:companion:build`에서 별도로 생성합니다.

runner가 준비된 뒤 현재 localhost 편집기 URL의 쿼리에 `dev=1`을 붙여 한 번만 새로고침합니다(기존 `?project=…`가 있으면 `&dev=1`). CSS 변경은 영상 연결·재생 위치를 유지한 채 stylesheet만 교체합니다. 편집기 TypeScript 번들·AudSeg Worker 변경은 입력 중인 값을 먼저 반영하고 CURRENT를 IndexedDB에 저장한 뒤 다시 읽은 지문까지 같을 때만 `session=resume`으로 같은 프로젝트를 다시 엽니다. AI·내보내기·드래그·복구 작업 중이거나 같은 프로젝트 탭이 둘 이상이거나 수동 연결 영상의 재시작용 파일 핸들이 없으면 자동 재로드를 보류합니다. CHZZK·YouTube·SOOP의 관리형 로컬 편집 영상은 materialization ID와 영수증으로 다시 연결하므로 파일 핸들을 요구하지 않습니다. 시작 화면·편집기·gateway의 공용 계약이 바뀌면 혼합 버전 실행을 막도록 4320 서버를 다시 시작합니다.

이 개발용 TypeScript 번들 재로드가 보존하는 범위는 저장된 **CURRENT 프로젝트**입니다. 실행 취소·다시 실행 스택, 선택한 타임라인 범위와 확대 상태 같은 탭 메모리는 초기화됩니다. 일반 사용자가 자막 글·색·크기·위치를 직접 고칠 때는 이 runner나 페이지 새로고침이 필요하지 않으며, 입력 즉시 미리보기·타임라인에 반영되고 IndexedDB 저장이 시작됩니다. 릴리스 검사·패키징 전에는 runner를 종료해야 합니다. runner·validator·패키저는 같은 OS 커널 mutex를 원자적으로 점유하므로 동시에 실행되지 않으며, 프로세스가 강제 종료돼도 mutex는 운영체제가 해제합니다. `npm run package`는 전체 `check:full` 시작부터 ZIP·체크섬 완료까지 그 mutex를 계속 보유합니다. `.dev-editor.lock`은 현재 소유자 진단용 메타데이터라 종료 뒤 남을 수 있지만 Git·배포물에서는 제외됩니다. 비정상 종료로 남은 stale reload marker와 구형 임시 lock은 validator가 mutex를 점유한 상태에서 정리합니다.

작성 소스·테스트·개발 도구는 모두 TypeScript입니다. typed build manifest가
localhost 시작 화면·편집기와 worker의 TS 진입점·출력 경로를 정의하고,
`npm run build`는 `web/` 생성물 3개와 `streaming-companion/`의 결정적인
manifest·typed JavaScript를 만듭니다. 배포물에는 TypeScript compiler,
`node_modules`, `.ts`·`.tsx`, source map, `tsconfig.json`을 넣지 않습니다.

`npm run typecheck`는 `tsconfig.web.json`과 `tsconfig.web.source.json`으로
활성 web·최소 companion 소스, 도구와 테스트를 검사합니다.
`exactOptionalPropertyTypes`, unchecked index 접근, unused·implicit
return·fallthrough 검사를 모두 유지합니다. `npm test`도 같은 web 경계의 테스트만
선택합니다. `npm run migration:check`는 작업 트리를 고치지 않고 활성 web 경계의
JS 계열 파일, HTML·shell·package의 inline/작성 JS 진입점,
명시적 `any`, 타입 오류 억제, production의 `unknown` 이중 단언과 tsconfig
검사 누락을 fail-closed로 차단합니다. 이어 esbuild `metafile`로 first-party
입력이 전부 TS인지 확인하고, 정상 web 생성물 3개를 메모리에서 다시 빌드해
추적된 web JavaScript와 최소 companion JavaScript를 바이트 단위로 비교합니다.
PR과 `main` push의 GitHub Actions도 같은 web·companion 경계를 검사합니다.

```bash
npm run check
```

Chromium/ChromeDriver가 있는 릴리스 환경에서는 아래 명령으로 정적 검사에 더해
결정적인 localhost 브라우저 smoke를 실행합니다. 시작 화면·정책 gate·편집기 진입·
세션 전환·저장소 격리와 UI wiring을 검사하지만, 실제 완성 영상의 A/V 렌더·파일
재생 검증까지 실행하는 명령은 아닙니다.

```bash
npm run check:full
```

`npm run test:browser`는 외부 플랫폼과 4319를 CDP에서 차단한 채 localhost 시작
화면·임베드 URL 변환·정책 게이트·편집기 진입을 결정적으로 검사합니다. 실제
CHZZK·YouTube·SOOP frame 응답까지 점검할 때만 네트워크 의존 검사인
`npm run test:browser:live-embeds`를 별도로 실행합니다. 단발성 Origin 저장소
이전은 별도의 단위·localhost 통합 테스트로 검증하며 과거 전체 bundle을
브라우저 E2E 입력으로 다시 빌드하지 않습니다.

실제 공개 CHZZK·SOOP VOD에서 컷 단계만 검사하려면
`npm run test:browser:live-vod-cut`을 사용합니다. 이 검사는 E→F→R, 동일 iframe
유지, 컷 단계 4319 acquisition 0회를 확인하고 편집기 materialization에는 진입하지
않습니다. 편집기 준비와 exact cache cleanup까지 포함하는 더 긴 검사는
`npm run test:browser:live-vod`입니다.

기본 테스트는 `whisper-tiny`가 loopback companion만 사용하고 `audseg-local`이 네트워크 없이 결정적인 타이밍 초안을 만드는 계약을 검증합니다. 실제 API 자격증명은 필요하지 않습니다.

릴리스 archive는 하나의 배타적 release lease 안에서 현재 `web/`의 브라우저
smoke를 포함한 전체 검증을 먼저 실행합니다. 그다음 정확한 web 파일 allowlist만
묶고, 압축 엔트리와 다시 푼 HTML의 배포 경계를 확인한 뒤 SHA-256을 기록합니다.
최소 `streaming-companion/`은 저장소와 setup 경로에서
별도로 빌드·검증되며 web ZIP에 묵시적으로 포함되지 않습니다. 단발성 Origin
migration endpoint도 기본·공개 서버에서는 닫혀 있고 별도 과거 archive를
배포하지 않습니다. 시스템 `zip`과 `unzip`이 필요합니다.

```bash
npm run package
```

## 검증 상태

순수 프로젝트 모델에서는 방송 회차 분리, 사용자 확정 컷 변환, 시간축 매핑, 투명 이미지, 다중 자막 레인, 구간별 음성, 사람 수정 보존, 컷 재정렬과 SRT 출력을 단위 테스트합니다. 자막 테스트는 Whisper의 로컬 요청·응답, 실제 STT 단어 경계 분할, 품질 검사, AudSeg가 처음 만든 빈 자막의 4초 상한과 이후 자막에 전역 상한이 없다는 계약을 확인합니다. 웹 브라우저 검증은 시작·편집 진입, 모바일 차단, 세션·프로젝트 격리와 결정적인 UI 동작을 확인합니다. 외부 VOD liveness 검사는 실제 구간 취득과 결과 길이·무결성까지 별도로 검증합니다.

마지막 로컬 검증 환경은 Arch Linux, Node.js 26.5.1, npm 12.0.2, Chromium/ChromeDriver 151.0.7922.71, FFmpeg/ffprobe 8.1.2입니다. 선언한 Node 22·Chrome 120 하한은 빌드 target과 API 기준이며 동일 버전 CI 매트릭스에서 직접 실행한 결과는 아닙니다.

제3자 코드와 라이선스·소스 위치는 [Third-party notices](legal/THIRD_PARTY_NOTICES.md)에 기록합니다. 합성 미디어, 실제 음성 샘플, 자격증명과 실제 서비스 응답은 저장소에 포함하지 않습니다.

## 라이선스

KirinukiHelper가 직접 작성한 코드는 [The Unlicense](UNLICENSE)에 따라
퍼블릭 도메인에 헌정합니다.
정적 web 배포에서는 같은 원문을 `web/licenses/UNLICENSE.txt`로 함께 제공합니다.
브라우저 배포물에 포함되는 Mediabunny(MPL-2.0), Pretendard·Paperlogy(OFL-1.1),
별도 라이선스 AudSeg port(MIT), 선택적으로 내려받는 yt-dlp·whisper.cpp·모델,
시스템 FFmpeg, 로컬 companion runtime과 개발·CI 도구는 이 헌정에 포함되지 않습니다.

- [전체 third-party 고지](legal/THIRD_PARTY_NOTICES.md)
- [사람이 읽는 오픈소스 인벤토리](legal/OPEN_SOURCE_INVENTORY.md)
- [runtime 다운로드·시스템 경계](legal/RUNTIME_DEPENDENCIES.md)
- [광고·유료·SaaS 상업 이용 dependency gate](legal/COMMERCIAL_USE_POLICY.md)
- [향후 웹 배포 체크리스트](legal/WEB_DEPLOYMENT_CHECKLIST.md)
- [first-party Unlicense 권리 확인 gate](legal/FIRST_PARTY_RIGHTS_REVIEW.md)

localhost 스튜디오의 라이선스 화면에서도 실제 포함된 구성요소의 license 원문과
대응 소스를 바로 열 수 있습니다. `npm run license:check`는 typed registry,
runtime pin, exact size/hash, notice 범위와 packaged 파일을 fail closed로
검사합니다. 현재 승인한 license는 광고·유료 사용 자체를 금지하지 않지만
MPL·OFL을 포함한 각 고지·소스 의무는 남습니다. 새 광고 SDK·analytics도 같은
positive allowlist와 산출물 inventory를 먼저 통과해야 합니다. 이 인벤토리와
검사는 법률 자문이나 법적 무위험 보증이 아닙니다.
