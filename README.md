# Kirinuki — 웹 VOD 편집기

Kirinuki는 CHZZK·YouTube·SOOP의 공개 완료 VOD에서 사용자가 직접 고른 구간만
이 PC로 준비해 컷, 이미지, 음성, 자막을 편집하고 영상으로 내보내는 로컬 우선
웹 편집기입니다.

제품의 본체는 [`https://kirinuki.eff0rtchung.kr`](https://kirinuki.eff0rtchung.kr)입니다.
Windows x64, Apple Silicon Mac, Linux x64 사용자는 처음 한 번만 **Kirinuki 영상
준비 도구**를 설치합니다. 그 뒤에는 사이트에서 컷 선택을 누르면 설치 앱의
원본 플레이어 창이 자동으로 열리고, 컷을 확정하면 기본 브라우저 편집기로 자동
돌아옵니다. 연결 주소나 포트를 조작할 필요가 없습니다.

> 현재 저장소는 이 구조의 구현과 검증 단계입니다. 세 OS용 package를 CI에서
> 만들고 아래에 명시한 OS별 범위만 검사하지만 아직 서명·공증된 공개 Release가
> 아닙니다. 웹의 다운로드 링크를 일반 사용자에게 열기 전에
> [데스크톱 바이너리 출시 게이트](legal/DESKTOP_BINARY_RELEASE_GATE.md)를 모두
> 충족해야 합니다.

원본 플레이어 위에서 `E/R`, `D/F`, `Y/U`를 쓰는 선택 기능은 설치 앱의 ASAR에
고정된 플레이어 제어 코드가 담당합니다. 별도 Chrome 확장, Web Store 설치 또는
개발자 모드는 필요하지 않습니다. 이 코드는 컷 선택 전용 격리 창의 정확한 플랫폼
frame에서만 실행되고 일반 브라우저 편집기에는 주입되지 않습니다.

## 사용자 흐름

1. 웹사이트에서 **새 컷 선택 열기**를 누릅니다. 영상 준비 도구가 없을 때만
   OS에 맞는 설치 안내가 한 번 나타납니다.
2. 설치 앱의 컷 창에 CHZZK·YouTube·SOOP VOD URL을 붙여넣습니다.
3. 원본 플레이어에서 시작·끝을 직접 입력하거나 `E/R`, `D/F`, `Y/U`
   단축키로 정하고, 프로젝트 이름과 이번 사용의 권리·책임 확인을 완료합니다.
4. **편집기 열기**를 누르면 선택값이 암호화된 일회성 인계로 전달되고 기본
   브라우저 편집기가 열립니다. 컷 창은 닫히며 엔진은 background로 남습니다.
5. 최초 연결 때 브라우저가 로컬 네트워크 접근을 물으면 한 번 허용합니다.
6. 필요한 VOD 구간이 이 PC에 준비되면 컷과 자막을 검수한 뒤 내보낼 파일 제목과
   저장 위치를 정합니다.

이후 방문에서는 같은 흐름을 반복합니다. 영상 준비 도구의 보이는 창은 컷 선택에만
쓰이며 full editor, 로그인·계정·동기화 기능은 없습니다. 운영체제 로그인 시에는
창 없이 시작해 웹사이트가 필요할 때만 선택한 구간을 준비합니다.

라이브, 비공개, 로그인 필요, DRM 또는 지역 제한 원본은 우회하지 않습니다.
자동 준비가 불가능한 원본에는 사용 권한이 있는 파일을 **내 파일 직접 연결**로
선택할 수 있습니다.

## 무엇이 어디에서 실행되나

```text
kirinuki.eff0rtchung.kr
  ├─ 시작·자막·레이어·미리보기·내보내기 UI (일반 브라우저)
  └─ 설치 앱 호출
       └─ 컷 선택 전용 Electron 창 + ASAR 고정 player action
            ├─ 암호화된 일회성 컷→브라우저 인계
            └─ 127.0.0.1:4319 (사용자에게 숨긴 고정 내부 연결)
                 └─ 필요한 VOD 구간 취득·검증·로컬 캐시

원본 플랫폼 ────────────────┘
```

- 공개 서버는 정적 웹 파일만 제공합니다. VOD 바이트를 프록시하거나 편집
  프로젝트를 저장하지 않습니다.
- 브라우저가 컷, 자막, 이미지, 레이어, 미리보기와 내보내기를 담당합니다.
- 로컬 엔진은 브라우저만으로 안정적으로 할 수 없는 공개 VOD 구간 취득과
  검증만 담당합니다.
- Cloudflare Tunnel은 공개 웹 origin으로만 연결합니다. 로컬 엔진 포트는
  Tunnel, LAN 또는 공인 인터페이스에 노출하지 않습니다.
- Electron의 창은 원본을 보며 컷을 고르는 동안에만 하나 열립니다. full editor와
  저장본 관리는 일반 브라우저에만 있고 로그인 자동 시작은 계속 windowless입니다.
- 플레이어 제어 코드는 build 때 `app.asar`에 고정되며, 별도 extension·
  `extraResource`·Chrome profile 설치물을 만들지 않습니다.

## 구간과 시간축

사용자가 입력한 컷 경계와 순서는 확정값입니다. Kirinuki는 장면을 대신 고르거나
컷 경계를 임의로 옮기지 않습니다. 자동 준비는 선택 범위 앞뒤의 디코딩 여유를
로컬 파일에 포함할 수 있지만, 편집기의 원본 시간축은 사용자가 입력한 VOD
시각을 그대로 유지합니다.

- CHZZK·YouTube·SOOP 모두 같은 범위 계획과 검증 절차를 사용합니다.
- 이미 준비한 조각이 있으면 같은 원본 시간축임을 증명한 뒤 재사용하고, 부족한
  방향만 추가로 가져옵니다.
- 원본 playlist나 SOOP 파트 구성의 identity가 준비 도중 바뀌면 다른 영상이
  섞이지 않도록 게시 전에 중단합니다.
- 제목 같은 표시 정보의 변화는 원본 교체로 오인하지 않습니다.
- 인증 토큰, 서명된 CDN URL, 쿠키는 프로젝트나 영구 receipt에 저장하지 않습니다.

자막은 자유롭게 이동·분할할 수 있으며 모든 자막에 4초 상한을 강제하지 않습니다.
4초 분할은 AudSeg가 처음 만드는 빈 타이밍의 생성 규칙일 뿐입니다.

## 저장과 개인정보

Kirinuki는 로그인 계정이나 서버 저장 프로젝트를 만들지 않습니다. 방문·사용
기록, 원본 URL, 편집 내용, 세션 식별자, 기기 정보, 광고 식별자, telemetry 또는
analytics를 수집하지 않습니다.

- 탭을 그냥 닫으면 저장하지 않은 이번 변경을 폐기하는 것이 기본입니다.
- 계속 작업하려면 사용자가 **지금 저장** 또는 종료 창의 저장 동작을 명시적으로
  선택합니다.
- 저장본과 임시 복구본은 브라우저의 이 사이트 저장소에만 남습니다.
- 준비한 VOD 조각은 로컬 엔진의 전용 캐시에만 남고 프로젝트별 소유권을 확인해
  삭제합니다.
- 새 프로젝트를 열 때 예전 프로젝트의 미디어나 캐시를 자동으로 혼합하지
  않습니다.
- 새로고침은 현재 프로젝트를 다시 열며, 뒤로가기 뒤 다른 원본을 시작하면 새
  프로젝트 세대와 로컬 작업 권한을 발급합니다.

원본 플랫폼과 GitHub Release는 사용자가 요청한 원본과 설치 파일을 전달하기
위해 각자의 정책에 따라 네트워크 정보를 처리할 수 있습니다. Kirinuki 자체
서버로 그 정보를 복제하지 않습니다.

## 로컬 연결의 보안 경계

웹페이지가 로컬 엔진을 임의의 범위로 사용할 수 없도록 다음 경계를 둡니다.

- `https://kirinuki.eff0rtchung.kr`의 정확한 Origin만 허용합니다.
- loopback의 고정 Host·포트만 사용하고 DNS rebinding과 forwarded host를
  거절합니다.
- 편집기 문서마다 메모리 전용 capability를 새로 발급합니다.
- 최초 연결 뒤 설치 identity의 P-256 공개키를 브라우저에 고정하고, health와
  session을 매번 새 challenge로 검증합니다. 기존 pin과 다른 키는 자동 교체하지
  않습니다.
- session 발급과 이후 JSON control traffic은 one-shot ECDH에서 만든 AES-GCM
  transport로 봉인합니다. token, 프로젝트 ID와 원본 URL을 plaintext loopback에
  보내지 않으며 counter replay도 거절합니다.
- 컷 선택 결과도 같은 암호화 채널에서 짧게 살아 있는 nonce·project scope·claim
  ID로 한 번만 수령하고, 브라우저 저장과 ACK가 끝난 뒤 폐기합니다. 주소에는
  payload나 token을 넣지 않고 불투명 nonce fragment도 읽자마자 지웁니다.
- 컷 창은 비영구 partition을 쓰며 top-frame 이동, popup, webview, download와
  권한 요청을 차단합니다. 플랫폼 iframe은 preload·Node IPC에 접근할 수 없습니다.
- capability는 프로젝트, canonical 원본 URL, 허용 작업에 묶이고 만료됩니다.
- 다른 탭의 nonce 재사용, 다른 프로젝트·원본으로의 scope 변경, 과대 요청을
  거절합니다.
- `<video>`가 사용자 정의 헤더를 붙일 수 없는 미디어 읽기는 정확한 Origin과
  작업별 추측 불가능한 access URL로 제한합니다.

엔진을 재시작하면 기존 capability는 사라집니다. 웹페이지는 새 capability를
자동으로 받아 이어가며 사용자가 토큰이나 연결 설정을 다루지 않습니다.

알려진 신뢰 경계: 첫 연결 전에 같은 OS 사용자 권한의 악성 프로그램이
`kirinuki-engine:` scheme 자체를 먼저 탈취하면, 외부 trust anchor가 없는
TOFU(first-use) 단계에서는 진짜 설치와 완전히 구별할 수 없습니다. 한 번 정상
키가 고정된 뒤의 key mismatch는 fail closed하며 자동 재등록하지 않습니다. 이
제외는 다른 사용자·웹 Origin·LAN 공격자를 신뢰한다는 뜻이 아닙니다.

## 지원 설치 대상

공개 Release가 열릴 때 웹사이트가 자동 선택할 파일 이름은 다음과 같습니다.

| 운영체제 | 대상 | 설치 파일 |
|---|---|---|
| Windows | x64 | `Kirinuki-Engine-windows-x64-setup.exe` |
| macOS | Apple Silicon ARM64 | `Kirinuki-Engine-macos-arm64.dmg` |
| Linux | x64, Debian 계열 | `Kirinuki-Engine-linux-x64.deb` |

현재 macOS x64, Windows ARM64, Linux ARM64와 모바일 편집은 지원하지 않습니다.
지원하지 않는 환경에서는 임의의 바이너리를 권하지 않고 로컬 파일 직접 연결을
안내합니다.

웹 편집기와 로컬 연결의 현재 검증 대상은 최신 Chrome/Chromium입니다. Chrome
142 이상에서는 공개 사이트가 이 PC의 loopback 엔진에 처음 연결할 때 로컬
네트워크 접근 권한을 한 번 묻습니다.

Windows 설치기는 사용자 범위에 설치하고 완료 뒤 엔진을 시작합니다. macOS는
DMG에서 앱을 설치하고 최초 한 번 실행해야 하며, 배포 전 Developer ID 서명과
공증이 필요합니다. Linux deb도 설치 뒤 앱 메뉴에서 최초 한 번 실행해야 자동
시작이 등록됩니다. 세 OS 모두 이후 로그인부터 화면 없이 시작합니다.

업데이트 기능이나 사용 통계를 위한 별도 백그라운드 네트워크 요청은 넣지
않습니다. 공개 엔진의 `kirinuki-local-media-engine/v1` 계약은 앱 버전과 독립된
additive-only 장기 호환 경계입니다. 다만 컷 전용 Electron 창과 browser handoff를
처음 포함하는 shell 기준은 `3.0.1`이므로 `3.0.0` 이하는 한 번 명시적으로 다시
설치해야 합니다. 웹은 구버전에 cut protocol을 보내 무응답으로 만들지 않고 먼저
재설치 안내를 보여 줍니다. 이 기준 이후의 일반적인 additive v1 변경 때문에 매번
재설치를 요구하지 않으며, 로컬 바이너리 교체가 불가피한 경우에만 동일한 stable
install path의 서명된 installer를 명시적으로 제공합니다. unsigned 자동 업데이트나
조용한 binary replacement는 허용하지 않습니다.

## 편집 기능

- 본편과 여러 개의 독립된 쇼츠 작업공간
- 컷별 활성화, 순서와 위·아래 레이어 조정
- 이미지와 추가 영상 레이어
- 자막 레인, 위치, 글꼴, 색상, 배경, 외곽선과 겹침 검사
- 브라우저 안에서 실행하는 AudSeg 빈 타이밍
- 사람이 완성한 컷을 유지한 채 노래 가사 타이밍을 1/60초 단위로 검수하는
  **에이전트로 자막 넣기** 프롬프트
- 파일 제목과 저장 위치를 정하는 영상 내보내기
- 명시적 임시저장·복구·폐기와 로컬 캐시 관리

AI 또는 Whisper가 만든 자막은 초안입니다. 컷 구도와 최종 자막은 사람이
검수해야 합니다.

현재 공개용 영상 준비 도구는 설치 크기와 생명주기를 예측 가능하게 유지하기
위해 Whisper 모델을 포함하지 않습니다. 저장소의 기존 Whisper 코드는 로컬 개발
및 이전 저장본 호환 경계이며 공개 웹 UI에서는 선택할 수 없습니다.

## 온프레미스 웹 배포

웹 배포는 정적 산출물만 사용합니다.

```bash
npm ci --ignore-scripts
npm run build
npm run package:web
```

Cloudflare Tunnel은 정적 origin 서버로 연결하고 외부 Host를
`kirinuki.eff0rtchung.kr`로 유지합니다. 공개 응답은 쿠키, 세션, analytics,
보고 endpoint를 만들지 않아야 합니다.

로컬 관리 Tunnel을 쓴다면 최소 ingress 경계는 다음과 같습니다. 마지막 404
catch-all을 유지하고 `httpHostHeader`로 정적 서버의 canonical Host 검사를
통과시킵니다.

```yaml
ingress:
  - hostname: kirinuki.eff0rtchung.kr
    service: http://127.0.0.1:4330
    originRequest:
      httpHostHeader: kirinuki.eff0rtchung.kr
  - service: http_status:404
```

```bash
npm run public-shell:start
npm run public-shell:check -- https://kirinuki.eff0rtchung.kr
```

명령 이름의 `public-shell`은 기존 내부 이름이며, 현재 산출물은 소개 shell이
아니라 시작 화면과 전체 편집기를 포함합니다. 실제 배포 전
[웹 배포 체크리스트](legal/WEB_DEPLOYMENT_CHECKLIST.md)를 확인하세요.

## 개발과 검증

일반 사용자는 아래 명령을 실행할 필요가 없습니다.

```bash
npm ci --ignore-scripts
npm run typecheck
npm run build
npm run validate
npm test
npm run audit
```

현재 OS용 unsigned 엔진과 installer를 만들고 검사하려면 다음을 실행합니다.

```bash
npm run package:desktop:installer
npm run test:package:desktop
npm run test:package:desktop:installer
```

CI는 Linux x64, Windows x64, macOS ARM64에서 같은 소스를 typecheck하고 unit
test를 실행합니다. 공통 native smoke는 격리된 사용자 상태에서 창 없는 실행,
loopback health, 두 번째 실행의 멱등성, 정상 종료와 격리 임시 경로 정리를 검사합니다.
설치 형식별 검증 범위는 서로 다릅니다. Windows는 임시 경로 silent install,
실제 HKCU Run 등록·exact path/argument/enabled readback, Start Menu 대상 readback과
엔진 실행 중 NSIS uninstall의 owned Run/StartupApproved 제거·외부 junction 보존을
검사합니다. Linux는 deb를 설치한 뒤 격리된 실제 XDG 사용자 profile에서 autostart를
확인하고, 엔진 실행 중 remove와 purge 및 package-owned 파일 부재를 검사합니다.
실행 파일이 먼저 사라져도 managed XDG 항목은 다음 로그인 때 자기 항목만 회수합니다.
macOS는 DMG를 read-only로 mount하고 `/Applications`에 복사해 실행한 다음 실행 중
bundle 이동 감지·runtime 정리와 detach를 확인합니다. 실제 macOS 로그인 항목의
사용자 승인과 기존 사용자 profile 정리는 비대화형 CI에서 검증하지 않습니다. Linux도 임의의
기존 다중 사용자 profile이나 사용자 cache를 dpkg가 즉시 정리한다고 검증한 것은
아닙니다. 실제 공개 VOD 네트워크 검증은 명시적으로
켜는 fresh-state liveness smoke로 CHZZK·YouTube·SOOP을 각각 검사합니다.

저장소 구조의 주요 경계는 다음과 같습니다.

```text
src/web/          시작 화면
src/editor/       브라우저 편집기
src/lib/          공유 도메인·시간축·저장 계약
src/desktop/      background 엔진·컷 전용 창 패키지와 OS 생명주기
scripts/          빌드·gateway·VOD materializer·검증 도구
tests/            결정론적 unit/contract 테스트
web/              생성된 정적 배포 산출물
legal/            라이선스·배포·출시 게이트
```

## 오픈소스와 제3자 구성요소

Kirinuki의 first-party 소스는 저장소 루트의 [UNLICENSE](UNLICENSE)를 따릅니다.
필요에 맞게 읽고 고치고 재배포할 수 있습니다. 번들 글꼴·라이브러리·미디어
도구에는 각자의 라이선스와 소스 제공 의무가 적용됩니다.

- [전체 제3자 고지](legal/THIRD_PARTY_NOTICES.md)
- [웹 제3자 고지](legal/WEB_THIRD_PARTY_NOTICES.md)
- [오픈소스 인벤토리](legal/OPEN_SOURCE_INVENTORY.md)
- [런타임 의존성 경계](legal/RUNTIME_DEPENDENCIES.md)
- [상업 이용 정책](legal/COMMERCIAL_USE_POLICY.md)
- [데스크톱 바이너리 출시 게이트](legal/DESKTOP_BINARY_RELEASE_GATE.md)
- [기여 가이드](CONTRIBUTING.md)
- [프로젝트 거버넌스](GOVERNANCE.md)
- [보안 정책과 신고](SECURITY.md)
- [상표·브랜드 정책](TRADEMARKS.md)

보안 문제나 문의: **lostfragment@naver.com**
