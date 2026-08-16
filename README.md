배포를 완료하고 싶은데 코덱스 토큰이 없어요...


# Kirinuki — 로컬 우선 VOD 편집 앱



Kirinuki는 CHZZK·YouTube·SOOP VOD에서 사용자가 직접 고른 구간을 이 기기에
필요한 만큼만 준비해 컷, 이미지, 음성, 자막을 편집하고 영상으로 내보내는
로컬 우선 앱입니다.

사용자는 별도 서버나 브라우저 확장, 보조 프로그램, 포트, 연결 주소를 설치하거나
관리하지 않습니다. **Kirinuki 앱 하나**를 실행하면 편집 화면, VOD 부분 준비,
자막 엔진, 캐시와 내보내기 생명주기를 앱이 함께 준비하고 점검합니다. 구현상
여러 내부 프로세스가 사용될 수 있지만 이는 앱의 비공개 구성요소이며 사용자용
제품이나 별도 서비스가 아닙니다.

사용자가 입력한 시작·끝과 컷 순서는 확정값입니다. Kirinuki는 재미있는 장면을
대신 고르거나 컷 경계를 임의로 늘리지 않습니다. 자막 초안, 위치, 레인, 색상,
글씨 크기, 구간별 음량과 내부 삭제 범위는 편집 화면에서 사람이 검수하고
수정할 수 있습니다. 자막 길이에 일괄 4초 제한을 두지 않습니다.

이 프로젝트는 NAVER·CHZZK·YouTube·Google·SOOP의 공식 또는 제휴 제품이
아닙니다. 서비스명과 상표의 권리는 각 권리자에게 있습니다.

## 현재 제공 형태

현재 일반 사용자에게 제공하는 경로는 **Linux 소스 설치판**입니다. 아직 자체
런타임을 모두 포함한 AppImage, Flatpak, deb/rpm 또는 완전 독립 실행형
바이너리가 아닙니다. 설치할 PC에 다음 기본 시스템 도구가 먼저 있어야 합니다.
이 목록은 어떤 자막 방식을 고르더라도 필요한 요구사항입니다.

- Node.js 22.17.0 이상과 npm (`node:sqlite`와 Windows 파일 identity 수정이 포함된 버전)
- Chromium 120 이상
- Python 3.11 이상
- FFmpeg와 ffprobe

Whisper 자막 방식을 선택할 때만 다음 빌드 도구가 추가로 필요합니다.

- CMake
- tar
- C++ 컴파일러(예: `g++` 또는 `clang++`)

`./setup.sh`는 빠진 시스템 패키지를 관리자 권한으로 대신 설치하지 않습니다.
필요한 도구를 진단해 알려 주고 안전하게 멈춥니다. 저장소가 관리하는 npm
구성요소와 고정 버전·크기·SHA-256으로 검증하는 미디어 도구는 첫 실행 때 앱이
자동으로 준비합니다. Whisper를 선택한 경우 위 추가 빌드 도구를 검증한 뒤
검증된 whisper.cpp 소스와 모델도 사용자 데이터 폴더에 준비합니다.

자세한 배포 경계는
[`legal/RUNTIME_DEPENDENCIES.md`](legal/RUNTIME_DEPENDENCIES.md)에 있습니다.

Linux·Windows·macOS용 Electron 앱은 현재 **개발·CI 프리뷰**입니다. 이 경로는
Electron `43.4.0`, FFmpeg/ffprobe `n8.1.2`(Shaka 정적 빌드 tag
`n8.1.2-1`)와 yt-dlp `2026.07.04` standalone artifact를 대상 OS용 앱 디렉터리에
넣습니다. 현재 manifest 대상은 Linux x64/arm64, macOS x64/arm64와 Windows
x64입니다. 현재 정적 FFmpeg의 실행 하한에 맞춰 macOS 프리뷰는 15.0 이상을
package metadata로 강제합니다. CI는 Linux x64·Windows x64·macOS arm64에서 unsigned 패키지를 만든 뒤
실제로 실행해 내부 Studio·gateway health, 번들 미디어 도구, 검증용 MP4 처리,
정상 종료를 검사합니다. Linux·macOS는 exact process group과 자식 프로세스,
포트·임시 데이터를 모두 확인합니다. Windows는 앱이 보고한 다중 프로세스 실행,
exact root 종료, 포트 회수와 전용 session 디렉터리 삭제를 확인하며, descendant
전체 소유권은 아래 공개 배포용 Job Object 차단 조건으로 남깁니다.

이 프리뷰 산출물은 installer가 아닌 unpacked 앱 디렉터리이며 아직 공개 다운로드가
아닙니다. Electron/Chromium/Node 전체 고지와 SBOM, FFmpeg build configuration과
대응 소스 의무, yt-dlp standalone의 embedded component 고지, Windows 코드 서명,
macOS Developer ID 서명·hardened runtime·공증·staple 검증이 완료되지 않았습니다.
따라서 `npm run package:desktop` 결과를 최종 사용자에게 배포하거나 기존 Linux
설치판 대신 제공하면 안 됩니다. 정확한 차단 조건은
[`legal/DESKTOP_BINARY_RELEASE_GATE.md`](legal/DESKTOP_BINARY_RELEASE_GATE.md)를
따릅니다.

## Linux 소스 설치

저장소를 내려받아 `KirinukiHelper` 폴더에서 처음 한 번 실행합니다.

```bash
./setup.sh
```

이 명령은 추가 모델이 필요 없는 AudSeg로 설치합니다. 로컬 Whisper 자막도 사용할
PC라면 위의 Whisper 전용 빌드 도구를 준비한 뒤 처음부터 다음 명령을 사용합니다.

```bash
./setup.sh --mode whisper
```

GitHub 소스 ZIP에서 실행 권한이 보존되지 않았다면 다음과 같이 실행할 수
있습니다.

```bash
bash setup.sh
```

Whisper 설치라면 `bash setup.sh --mode whisper`를 사용합니다.

설치가 끝나면 앱 메뉴의 **Kirinuki** 아이콘 또는 다음 명령만 사용합니다.

```bash
kirinuki
```

첫 실행은 저장소가 관리하는 구성요소를 준비하고 현재 버전을 검증한 뒤
Kirinuki 전용 창을 엽니다. 이후 실행도 같은 진입점이 필요한 업데이트와 복구를
먼저 처리합니다. 일반 브라우저에서 내부 편집 주소를 직접 열거나 별도 구성요소를
미리 시작할 필요가 없습니다.

원본 URL을 미리 넣어 열고 싶다면 다음 중 하나를 사용합니다.

```bash
kirinuki open "https://chzzk.naver.com/video/..."
kirinuki open "https://www.youtube.com/watch?v=..."
```

공개 사이트나 데스크톱 통합은 아래의 엄격한 앱 링크만 사용합니다.

```text
kirinuki://open
kirinuki://open?source=<URLSearchParams로 인코딩한 지원 VOD HTTPS URL>
```

앱 링크는 `open` host와 선택적인 `source` 하나만 허용합니다. 중복 매개변수,
계정 정보, 임의 포트, fragment, 지원하지 않는 host나 HTTPS가 아닌 원본은
거절합니다. `source`는 시작 화면의 원본 입력만 채우며 컷 시각이나 권리 확인을
자동 승인하지 않습니다.

`kirinuki doctor`, `kirinuki status`, `kirinuki stop`과 저장소 안의 저수준 npm
명령은 일반 사용 흐름이 아니라 개발자·관리자용 진단 폴백입니다. 평상시에는 앱
아이콘이나 `kirinuki`만 사용하세요.

## 공개 사이트의 역할

`https://kirinuki.eff0rtchung.kr`은 앱 소개, 설치 안내와 **Kirinuki에서 열기**만
제공하는 가벼운 시작 페이지입니다. 공개 페이지에서 편집기를 초기화하거나 VOD를
부분 다운로드하지 않으며, 방문자의 기기 안에 있는 내부 서비스로 연결을
시도하지 않습니다.

**Kirinuki에서 열기**는 등록된 `kirinuki://open` 링크를 호출합니다. 앱이 아직
설치되지 않았거나 브라우저가 앱 열기를 거절해도 페이지는 오류 상태의 편집기를
보여 주지 않고 설치 안내를 그대로 유지합니다. 실제 프로젝트 생성과 편집은
항상 앱이 소유한 전용 창에서 시작합니다.

온프레미스 운영자는 `npm run public-shell:start`로 이 공개 정적 shell만
실행할 수 있습니다. 기본 listener는 `127.0.0.1:4330`이며 Cloudflare Tunnel은
이 listener 하나에 연결하고 원본 `Host`를 `kirinuki.eff0rtchung.kr`로
유지해야 합니다. 포트와 loopback bind를 바꿔야 할 때만
`KIRINUKI_PUBLIC_SHELL_PORT`, `KIRINUKI_PUBLIC_SHELL_BIND`를 사용합니다. 이
서버는 요청 로그·쿠키·세션·분석 기능이나 별도 health 경로를 만들지 않습니다.
배포 뒤에는 `npm run public-shell:check`로 실제 HTTPS 응답의 보안·개인정보
경계를 읽기 전용으로 확인합니다.

## 편집 흐름

1. 앱 메뉴의 **Kirinuki**를 엽니다.
2. CHZZK·YouTube·SOOP의 지원 VOD URL을 붙여넣습니다.
3. 원본을 확인하고 사용할 시작·끝을 `초`, `MM:SS` 또는 `HH:MM:SS`로 직접
   입력합니다. **빈 구간 추가**로 컷을 더 만들 수 있습니다.
4. 프로젝트 이름을 정하고 이번 사용의 권리·책임 확인란을 직접 선택합니다.
5. **편집기 열기**를 누릅니다. 공개 완료 VOD라면 앱이 선택 범위의 앞뒤 여유와
   독립 디코딩에 필요한 최소 조각만 이 PC에 준비합니다. 로그인·쿠키·DRM·지역
   제한은 우회하지 않습니다.
6. 라이브, 비공개, 접근 제한 또는 지원 밖의 원본은 **내 파일 직접 연결**에서
   사용 권한이 있는 로컬 파일을 선택합니다.
7. 컷, 이미지, 음성, 자막을 검수합니다. 컷을 준비 범위 밖으로 넓히면 앱이
   필요한 방향의 누락 구간만 이어서 준비합니다.
8. **영상 내보내기**에서 제목과 저장 위치를 정하고 결과를 확인합니다.

원본 스트리밍 화면은 시각 확인용입니다. YouTube는 공식 privacy-enhanced
embed와 앱에 포함된 격리 Player Bridge를 사용하고, CHZZK는 문서화되지 않은
embed 경로를 만들지 않으며, SOOP은 지원되는 공식 VOD 화면만 사용합니다. 실제
편집·자막·내보내기는 앱이
검증해 준비한 로컬 미디어 또는 사용자가 직접 연결한 파일을 사용합니다.

## 자막

- **AudSeg**: 모델 없이 브라우저 안에서 음성 활동을 찾아 사람이 채울 빈 cue를
  만듭니다.
- **Whisper**: 글과 타이밍 초안이 필요할 때 이 PC에서 실행합니다. 오디오는 외부
  자막 API로 전송하지 않습니다.
- **에이전트로 자막 넣기**: 사람이 완성한 컷 구도를 바꾸지 않고 노래 가사의
  타이밍을 1/60초 단위로 검수하도록 돕는 프롬프트입니다. 결과는 사람이 최종
  확인해야 합니다.

자동 초벌은 컷 경계와 순서를 바꾸지 않습니다. 자막은 자유롭게 이동·분할할 수
있고 레인별로 겹침을 검수할 수 있습니다.

## 저장, 캐시와 종료

Kirinuki는 로그인 계정이나 서버 프로젝트를 만들지 않습니다. 방문·사용 기록,
편집 내용, 원본 URL, 세션 식별자, GPU 정보 또는 광고 식별자를 수집·전송하지
않습니다.

- 저장하지 않은 프로젝트는 앱 창을 닫으면 폐기하는 것이 기본입니다.
- 이어서 작업하려면 닫기 전에 **지금 저장**을 명시적으로 선택합니다.
- 저장본과 준비한 VOD 조각은 이 기기에만 남고 앱의 **저장 목록/로컬 자료
  관리**에서 확인하고 지울 수 있습니다.
- 내보내기 검증 뒤 **세션 완료·로컬 재료 삭제**를 선택하면 해당 프로젝트가
  단독 소유한 캐시만 정리합니다. 다른 프로젝트의 캐시와 사용자가 직접 고른
  원본 파일은 삭제하지 않습니다.
- 앱을 다시 열 때 이전 세션을 현재 작업에 자동 혼합하지 않습니다. 저장본을
  계속하려면 목록에서 명시적으로 선택합니다.

브라우저 탭의 자동 복구나 서버 세션 보존을 프로젝트 저장으로 간주하지
않습니다. 운영체제나 브라우저가 비정상 종료된 경우 제안되는 복구본도 사용자가
선택하기 전에는 현재 프로젝트가 되지 않습니다.

## 개인정보와 네트워크

Kirinuki의 원격 자체 서버는 없으며 로그인, 계정, telemetry, analytics, 사용기록
수집 기능을 두지 않습니다. 네트워크 요청은 사용자가 지정한 원본 플랫폼,
설치 시 고정 artifact 다운로드, 공개 소개 페이지에 필요한 범위로 제한합니다.
원본 플랫폼이 자체적으로 처리하는 요청과 정책은 각 서비스에 따릅니다.

앱 내부 구성요소는 이 기기에서만 접근하도록 제한되며 Cloudflare Tunnel, LAN,
공개 도메인에 노출하는 배포 대상이 아닙니다. 인증 토큰과 만료형 CDN 미디어
직링크는 프로젝트에 저장하지 않습니다. 사용자가 입력한 원본 VOD 주소는 편집을
이어가기 위해 이 기기의 프로젝트에만 남습니다.

## 지원 범위와 알려진 제한

- 현재 사용자 지원 설치·실행 경로는 Linux와 Chromium 120 이상입니다.
- Windows와 macOS 코드는 네이티브 CI에서 typecheck·unit test·unpacked package와
  실제 packaged-runtime liveness smoke를 검사하는 단계입니다. 서명·공증,
  실제 VOD·편집·내보내기 운영체제별 검증과 바이너리 단위 라이선스 검토 전에는
  공개 배포판 또는 사용자 지원판으로 간주하지 않습니다.
- 공개 완료 CHZZK·YouTube·SOOP VOD를 대상으로 하며 라이브·비공개·DRM·지역
  제한을 우회하지 않습니다.
- 플랫폼 페이지 구조나 전송 형식이 바뀌면 해당 소스 준비가 일시적으로 실패할
  수 있습니다. 이때 권한 있는 로컬 파일을 직접 연결할 수 있습니다.
- 장시간·고해상도·다중 레이어 출력은 브라우저 메모리와 GPU 성능의 영향을
  받습니다.
- 현재 소스 설치판은 시스템 Node.js, npm, Chromium, Python, FFmpeg, ffprobe에
  의존합니다. “앱 하나”는 사용자 생명주기와 UI의 단일 경계를 뜻하며 아직
  모든 바이너리를 포함한 AppImage라는 뜻은 아닙니다.

## 개발과 검증

일반 사용자는 이 절의 명령을 실행할 필요가 없습니다.

```bash
npm ci --ignore-scripts
npm run build
npm run build:desktop
npm run validate
npm test
```

현재 OS용 unsigned 개발 패키지를 검증할 때만 다음 명령을 사용합니다. 이 명령은
고정한 Electron과 미디어 sidecar를 내려받을 수 있으며 결과를 공개 release로
업로드하지 않습니다.

```bash
npm run package:desktop
```

공개 사이트와 앱 편집 산출물은 서로 다른 보안 경계입니다. 공개 산출물은 앱
링크와 설치 폴백만 포함해야 하며 내부 편집 초기화, 내부 네트워크 주소, 내부
서비스용 CSP 권한을 포함하면 배포를 차단합니다. 출시 점검은
[`legal/WEB_DEPLOYMENT_CHECKLIST.md`](legal/WEB_DEPLOYMENT_CHECKLIST.md)를
따릅니다.

## 라이선스

Kirinuki의 first-party 소스는 저장소 루트의 [UNLICENSE](UNLICENSE)를
따릅니다. 번들된 글꼴·라이브러리, 실행 시 내려받는 구성요소와 시스템 도구는
각자의 라이선스가 적용됩니다.

- [전체 제3자 고지](legal/THIRD_PARTY_NOTICES.md)
- [오픈소스 인벤토리](legal/OPEN_SOURCE_INVENTORY.md)
- [런타임 의존성 경계](legal/RUNTIME_DEPENDENCIES.md)
- [상업 이용 정책](legal/COMMERCIAL_USE_POLICY.md)

문의: **lostfragment@naver.com**
