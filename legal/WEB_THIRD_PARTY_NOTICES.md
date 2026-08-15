# Kirinuki app browser-assets third-party notices

이 문서는 **Kirinuki Linux 소스 앱의 `web/` browser assets에 실제로 포함되는
구성요소만** 다룹니다. 공개 사이트의 shell-only ZIP에는 이 editor bundle과
아래 제3자 구성요소가 들어가지 않습니다.
Kirinuki 앱 setup이 나중에 내려받는 실행 파일·모델, 운영체제가 제공하는 도구,
앱 내부 엔진 실행용·개발 전용 npm 패키지는 이 패키지의 일부가 아닙니다.
전체 개발·앱 runtime
인벤토리는 저장소의 `legal/OPEN_SOURCE_INVENTORY.md`와
`legal/RUNTIME_DEPENDENCIES.md`를 확인하세요.

Kirinuki 프로젝트가 직접 작성한 코드는 패키지의 `UNLICENSE`를 따릅니다. 아래
제3자 구성요소와 별도 라이선스 소스는 그 퍼블릭 도메인 헌정 대상이 아니며
Unlicense로 재허가되지 않습니다.

<!-- attribution-id: mediabunny -->
## Mediabunny 1.51.0

- License: Mozilla Public License 2.0 (`MPL-2.0`)
- Upstream: https://github.com/Vanilagy/mediabunny
- Exact corresponding source package:
  https://registry.npmjs.org/mediabunny/-/mediabunny-1.51.0.tgz
- npm integrity:
  `sha512-u327374xU8Ho0gCaMII7fUK8t0PnqkabCox1k8uUwvgvGb9o6YQGZEG2Qr4DTe7nTMpzfL7ukgnHDvDROySZ+Q==`
- License file size: `16726` bytes
- License SHA-256:
  `3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04`
- Full license text: `licenses/MEDIABUNNY-MPL-2.0.txt`

Mediabunny는 브라우저에서 로컬 미디어를 읽고 인코딩·mux하는 데 사용됩니다.
`mediabunny@1.51.0` TypeScript 소스가 위의 정확한 npm source package에
포함되어 있습니다. Kirinuki의 adapter와 upstream Mediabunny의
MPL-2.0 코드를 구분해 관리합니다.

<!-- attribution-id: audseg -->
## AudSeg browser port 0.1.0

- License: MIT
- Corresponding source: `AudSeg/` and `src/editor/audseg.ts`
- Repository source:
  https://github.com/studyreadbook4ever/KirinukiHelper/tree/eef841a336613fe8fe825ab231d9bbe770751ee2/AudSeg
- Full license text: `licenses/AUDSEG-MIT.txt`

편집기는 별도 MIT 라이선스인 AudSeg 알고리즘의 TypeScript browser port를
포함합니다. 모델 없이 오디오 활동 구간과 빈 자막 타이밍을 계산합니다.
컴파일된 `editor/editor.js`와 `editor/audseg-worker.js` 끝에도
AudSeg 이름·버전·MIT 고지가 보존됩니다.

<!-- attribution-id: pretendard -->
## Pretendard ExtraBold 1.3.9

- Copyright © 2021 Kil Hyung-jin
- License: SIL Open Font License 1.1 (`OFL-1.1`)
- Reserved Font Name: Pretendard
- Upstream: https://github.com/orioncactus/pretendard/tree/v1.3.9
- Bundled font: `editor/fonts/Pretendard-ExtraBold.woff2`
- Font size: `793540` bytes
- Font SHA-256:
  `dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3`
- Full license text: `licenses/PRETENDARD-OFL-1.1.txt`
- License size: `4418` bytes
- License SHA-256:
  `d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04`

공식 `v1.3.9` ExtraBold WOFF2를 수정 없이 포함합니다.

<!-- attribution-id: paperlogy -->
## Paperlogy 8 ExtraBold 1.001

- Copyright © 2024 The PAPERLOGY Authors
- License: SIL Open Font License 1.1 (`OFL-1.1`)
- Official project: https://freesentation.blog/paperlogyfont
- Pinned upstream commit:
  `8ef35f53b318c7ca914c52b1b382b9a8bad07a61`
- Upstream:
  https://github.com/Freesentation/paperlogy/tree/8ef35f53b318c7ca914c52b1b382b9a8bad07a61
- Bundled font: `editor/fonts/Paperlogy-8ExtraBold.woff2`
- Font size: `430124` bytes
- Font SHA-256:
  `5047db061c39ec5ed5c9d0b71c7aaad4b9547ed15ce48d1cd74090169f132bc0`
- Full license text: `licenses/PAPERLOGY-OFL-1.1.txt`
- License size: `4380` bytes
- License SHA-256:
  `603b2e7ef9effb9037b0b67f0530cacdc05e71a4e569032d7e4d98c2e6763135`

고정한 upstream commit의 8 ExtraBold WOFF2를 수정 없이 포함합니다.

## External service runtime boundary

Kirinuki 앱의 YouTube 원본 확인 화면은 YouTube 주소를 연 경우에만 브라우저가
Google의 공식
`https://www.youtube.com/iframe_api` loader와
`https://www.youtube-nocookie.com` embed에 직접 연결합니다. 이 원격 서비스
코드는 Kirinuki 앱 browser assets에 포함하거나 재허가하지 않으며, YouTube의 현재
서비스 약관·개발자 정책과 콘텐츠 권리는 위 오픈소스 라이선스와 별도로
적용됩니다. Kirinuki는 이 연결을 서버에서 proxy하지 않습니다.

## Corresponding source and scope

앱 UI의 TypeScript 소스, 고정된 `package-lock.json`, 빌드
스크립트와 전체 인벤토리는 다음 저장소에 있습니다.

https://github.com/studyreadbook4ever/KirinukiHelper

이 문서는 현재 패키지 구성에 대한 공학적 인벤토리이지 법률 자문이나
무위험 보증이 아닙니다. 새 파일이나 dependency를 배포할 때는 실제 산출물을
다시 감사해야 합니다.
