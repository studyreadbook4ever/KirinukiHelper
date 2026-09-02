import {
  mergeUiCopyCatalogs
} from "../lib/ui-localization.js";
import type {
  UiCopyCatalog,
  UiCopyPattern
} from "../lib/ui-localization.js";

const studioStaticCopy = {
  "이 기기의 저장 공간을 안전하게 확인하지 못했습니다. 저장 장치를 확인한 뒤 다시 시도해 주세요.": {
    en: "Kirinuki could not safely check this device's free space. Check the drive and try again.",
    ja: "このデバイスの空き容量を安全に確認できませんでした。ドライブを確認して、もう一度お試しください。"
  },
  "VOD 구간을 안전하게 준비할 저장 공간이 부족합니다. 여유 공간을 확보한 뒤 다시 시도해 주세요.": {
    en: "There is not enough free space to prepare the selected VOD clips safely. Free up space and try again.",
    ja: "選択した VOD クリップを安全に準備するための空き容量が不足しています。空き容量を確保して、もう一度お試しください。"
  },
  "이전 영상 준비가 중단되었습니다. 다시 시도할 수 있습니다": {
    en: "The previous media-preparation job stopped. You can try it again.",
    ja: "前回の動画準備は中断されました。再試行できます。"
  },
  "대기 중 브라우저 연결이 만료되어 VOD 구간 준비를 다시 연결해야 합니다.": {
    en: "The browser connection expired while the VOD job was queued. Reconnect and try again.",
    ja: "VOD 準備の待機中にブラウザー接続が切れました。再接続してもう一度お試しください。"
  },
  "로컬 미리보기 연결이 만료되었습니다. 필요한 위치에서 다시 준비해 주세요.": {
    en: "The local preview connection expired. Prepare it again at the position you need.",
    ja: "ローカルプレビューの接続が切れました。必要な位置でもう一度準備してください。"
  },
  "영상 준비 도우미가 종료되어 VOD 구간 준비가 중단되었습니다. 도우미 연결을 다시 확인해 주세요.": {
    en: "The media helper stopped, so VOD preparation ended. Check the helper connection and try again.",
    ja: "動画準備ヘルパーが終了したため、VOD の準備が中断されました。ヘルパーの接続を確認してください。"
  },
  "VOD 구간 준비가 안전 실행 시간 한도를 넘었습니다. 선택한 구간을 확인한 뒤 다시 시도해 주세요.": {
    en: "VOD preparation reached its safe runtime limit. Check the selected clips and try again.",
    ja: "VOD の準備が安全な実行時間の上限に達しました。選択クリップを確認して、もう一度お試しください。"
  },
  "VOD 구간 준비가 사용자 요청과 다른 이유로 중단되었습니다.": {
    en: "VOD preparation stopped for a reason other than a user request.",
    ja: "ユーザー操作以外の理由で VOD の準備が中断されました。"
  },
  "VOD 구간 준비를 취소했습니다.": {
    en: "Cancelled VOD preparation.",
    ja: "VOD の準備をキャンセルしました。"
  },
  "VOD 준비 작업을 찾지 못했습니다.": {
    en: "The VOD preparation job is no longer available. Use Retry to start it again.",
    ja: "VOD 準備ジョブが見つかりません。再開するには「再試行」を選んでください。"
  },
  "저장된 편집 전체의 브라우저 저장 데이터를 삭제했습니다.": {
    en: "Deleted all browser-saved edits.",
    ja: "保存済みの編集をすべてブラウザーから削除しました。"
  },
  "선택한 편집의 브라우저 저장 데이터를 삭제했습니다.": {
    en: "Deleted browser-saved data for the selected edit.",
    ja: "選択した編集のブラウザー保存データを削除しました。"
  },
  "화면 언어": {
    en: "Interface language",
    ja: "表示言語"
  },
  "Kirinuki 시작 화면": {
    en: "Kirinuki home",
    ja: "Kirinuki スタート画面"
  },
  "Kirinuki를 불러오는 중입니다": {
    en: "Loading Kirinuki",
    ja: "Kirinukiを読み込んでいます"
  },
  "잠시만 기다려 주세요.": {
    en: "Please wait a moment.",
    ja: "しばらくお待ちください。"
  },
  "VOD에서 편집할 구간을 선택하세요": {
    en: "Select Clips from a VOD",
    ja: "VODから編集するクリップを選択"
  },
  "링크를 붙여넣고 이 페이지에서 바로 컷을 고르세요. YouTube는 즉시 열리고, CHZZK·SOOP은 영상 준비 도우미가 연결되면 같은 플레이어에서 재생됩니다.": {
    en: "Paste a link and choose your cuts right on this page. YouTube opens immediately; CHZZK and SOOP play in the same viewer once the media helper is connected.",
    ja: "リンクを貼り付け、このページ上でカット範囲を選択します。YouTubeはすぐに開き、CHZZK・SOOPは動画準備ヘルパーの接続後に同じプレーヤーで再生されます。"
  },
  "영상 준비 도우미 다운로드": {
    en: "Download the media helper",
    ja: "動画準備ヘルパーをダウンロード"
  },
  "저장된 편집": {
    en: "Saved edits",
    ja: "保存済みの編集"
  },
  "브라우저 저장소를 확인하는 중입니다.": {
    en: "Checking browser storage.",
    ja: "ブラウザーの保存データを確認しています。"
  },
  "직접 저장한 편집과 복구본은 이 브라우저에만 보관됩니다.": {
    en: "Saved edits and recovery snapshots are stored only in this browser.",
    ja: "保存した編集と復元データは、このブラウザー内にのみ保管されます。"
  },
  "저장된 편집 새로고침 (단축키 Q)": {
    en: "Refresh saved edits (shortcut Q)",
    ja: "保存済みの編集を更新（ショートカット Q）"
  },
  "새로고침": {
    en: "Refresh",
    ja: "更新"
  },
  "모두 삭제": {
    en: "Delete all",
    ja: "すべて削除"
  },
  "저장된 편집을 확인하는 중…": {
    en: "Checking saved edits…",
    ja: "保存済みの編集を確認しています…"
  },
  "저장된 편집 목록을 읽지 못했습니다.": {
    en: "Could not read the saved edits.",
    ja: "保存済みの編集を読み込めませんでした。"
  },
  "오류가 난 항목은 임의로 삭제하지 않았습니다. 다시 시도해 주세요.": {
    en: "Nothing with an error was deleted. Please try again.",
    ja: "エラーが発生した項目は削除していません。もう一度お試しください。"
  },
  "다시 시도": {
    en: "Try again",
    ja: "再試行"
  },
  "작업 중 오류가 발생했습니다. 다시 시도해 주세요.": {
    en: "Something went wrong. Try again.",
    ja: "処理中にエラーが発生しました。もう一度お試しください。"
  },
  "저장된 편집이 없습니다.": {
    en: "There are no saved edits.",
    ja: "保存済みの編集はありません。"
  },
  "아래에 VOD 링크를 입력해 새 편집을 시작하세요.": {
    en: "Enter a VOD link below to start a new edit.",
    ja: "下にVODリンクを入力して、新しい編集を始めてください。"
  },
  "이 브라우저에 저장된 편집": {
    en: "Edits saved in this browser",
    ja: "このブラウザーに保存された編集"
  },
  "현재 입력한 VOD": {
    en: "Current VOD",
    ja: "現在入力中のVOD"
  },
  "다른 탭에서 편집 중": {
    en: "Open in another tab",
    ja: "別のタブで編集中"
  },
  "계속 편집": {
    en: "Continue editing",
    ja: "編集を続ける"
  },
  "복구본 선택": {
    en: "Choose recovery snapshot",
    ja: "復元データを選択"
  },
  "삭제": {
    en: "Delete",
    ja: "削除"
  },
  "원본 VOD": {
    en: "Source VOD",
    ja: "元のVOD"
  },
  "URL 대기": {
    en: "Waiting for URL",
    ja: "URL入力待ち"
  },
  "CHZZK·YouTube·SOOP 공개 VOD 주소": {
    en: "Public CHZZK, YouTube, or SOOP VOD URL",
    ja: "CHZZK・YouTube・SOOPの公開VOD URL"
  },
  "원본 페이지 열기": {
    en: "Open source page",
    ja: "元ページを開く"
  },
  "백업 파일 불러오기": {
    en: "Import backup file",
    ja: "バックアップを読み込む"
  },
  "공개 VOD만 지원합니다. 로그인이나 접근 제한을 우회하지 않으며, 백업 파일은 이 브라우저에서만 읽습니다.": {
    en: "Only public VODs are supported. Kirinuki does not bypass sign-in or access restrictions, and backup files are read only in this browser.",
    ja: "公開VODのみ対応しています。ログインやアクセス制限を回避することはなく、バックアップファイルはこのブラウザー内でのみ読み取ります。"
  },
  "프로젝트 이름": {
    en: "Project name",
    ja: "プロジェクト名"
  },
  "예: 0520 히오스": {
    en: "e.g. 0520 Heroes",
    ja: "例：0520 Heroes"
  },
  "원본 스트리밍 창": {
    en: "Source viewer",
    ja: "元動画プレーヤー"
  },
  "현재 편집본 영상 길이:": {
    en: "Selected duration:",
    ja: "現在の編集尺："
  },
  "원본 VOD 스트리밍 플레이어": {
    en: "Source VOD player",
    ja: "元VODプレーヤー"
  },
  "도우미가 연결한 원본 VOD 웹 플레이어": {
    en: "Source VOD web player connected by the helper",
    ja: "ヘルパーが接続した元VODウェブプレーヤー"
  },
  "VOD 주소를 붙여 넣으세요.": {
    en: "Paste a VOD URL.",
    ja: "VODのURLを貼り付けてください。"
  },
  "주소를 확인한 뒤 플랫폼의 플레이어를 이 자리에 엽니다.": {
    en: "Once the URL is verified, the platform player will open here.",
    ja: "URLを確認すると、ここに各プラットフォームのプレーヤーが開きます。"
  },
  "컷 캡처": {
    en: "Cut selection",
    ja: "カット範囲"
  },
  "현재 시각": {
    en: "Playhead",
    ja: "現在位置"
  },
  "현재 입력 #01": {
    en: "Active range #01",
    ja: "入力中の区間 #01"
  },
  "VOD 주소를 입력하면 가능한 플레이어 동작을 활성화합니다.": {
    en: "Enter a VOD URL to enable the available player controls.",
    ja: "VODのURLを入力すると、利用可能なプレーヤー操作が有効になります。"
  },
  "컷 캡처 단축키": {
    en: "Cut-selection shortcuts",
    ja: "カット範囲のショートカット"
  },
  "원본 영상을 0.25배속으로 재생 (단축키 Y)": {
    en: "Play the source at 0.25× (shortcut Y)",
    ja: "元動画を0.25倍速で再生（ショートカット Y）"
  },
  "원본 영상을 2배속으로 재생 (단축키 U)": {
    en: "Play the source at 2× (shortcut U)",
    ja: "元動画を2倍速で再生（ショートカット U）"
  },
  "원본 영상을 5초 이전으로 이동 (단축키 D)": {
    en: "Move the source 5 seconds back (shortcut D)",
    ja: "元動画を5秒戻す（ショートカット D）"
  },
  "원본 영상을 5초 이후로 이동 (단축키 F)": {
    en: "Move the source 5 seconds forward (shortcut F)",
    ja: "元動画を5秒進める（ショートカット F）"
  },
  "−5초": {
    en: "−5 sec",
    ja: "−5秒"
  },
  "+5초": {
    en: "+5 sec",
    ja: "+5秒"
  },
  "현재 시각을 시작점으로 캡처 (단축키 E)": {
    en: "Set the current playhead as the In point (shortcut E)",
    ja: "現在位置をイン点に設定（ショートカット E）"
  },
  "현재 시각을 끝점으로 캡처 (단축키 R)": {
    en: "Set the current playhead as the Out point (shortcut R)",
    ja: "現在位置をアウト点に設定（ショートカット R）"
  },
  "다음 빈 구간 추가 (단축키 T)": {
    en: "Add the next empty range (shortcut T)",
    ja: "次の空の区間を追加（ショートカット T）"
  },
  "시작 캡처": {
    en: "Set In",
    ja: "イン点"
  },
  "끝 캡처": {
    en: "Set Out",
    ja: "アウト点"
  },
  "다음 구간": {
    en: "Next range",
    ja: "次の区間"
  },
  "YouTube는 공식 임베드에서, CHZZK·SOOP은 도우미가 이 자리에 연결한 웹 플레이어에서 E/R/D/F/Y/U가 보이는 영상의 실제 재생 시각에 바로 연결됩니다.": {
    en: "E/R/D/F/Y/U follow the visible video's actual playhead: in YouTube's official embed, or in the web player connected here by the helper for CHZZK and SOOP.",
    ja: "E/R/D/F/Y/Uは、YouTubeでは公式埋め込み、CHZZK・SOOPではヘルパーがここに接続したウェブプレーヤーの、表示中の動画の実再生位置に連動します。"
  },
  "원본 전체 위치": {
    en: "Full source position",
    ja: "元動画全体の位置"
  },
  "이 위치로 정확히 이동": {
    en: "Go to this exact position",
    ja: "この位置へ正確に移動"
  },
  "이 타임라인과 컷 입력은 화면에서 재생 중인 영상과 같은 원본 시각을 사용합니다.": {
    en: "This timeline and the cut fields use the same source clock as the video playing above.",
    ja: "このタイムラインとカット入力は、画面で再生中の動画と同じ元動画の時間軸を使用します。"
  },
  "YouTube는 공식 플레이어로, CHZZK·SOOP은 이 PC의 도우미를 통해 같은 웹 화면에서 재생합니다.": {
    en: "YouTube plays in its official player; CHZZK and SOOP play on this same web page through the helper on this PC.",
    ja: "YouTubeは公式プレーヤーで、CHZZK・SOOPはこのPCのヘルパーを通じて同じウェブ画面で再生します。"
  },
  "플레이어 다시 시작": {
    en: "Reload player",
    ja: "プレーヤーを再読み込み"
  },
  "가져올 구간": {
    en: "Selected ranges",
    ja: "取り込む区間"
  },
  "가져올 구간 작업": {
    en: "Selected-range actions",
    ja: "取り込む区間の操作"
  },
  "현재 컷 백업": {
    en: "Back up selections",
    ja: "カット範囲をバックアップ"
  },
  "빈 구간 추가": {
    en: "Add empty range",
    ja: "空の区間を追加"
  },
  "원본 링크·프로젝트 이름·구간 메모가 백업 파일에 포함됩니다. 영상은 포함되지 않습니다.": {
    en: "The backup includes the source link, project name, and range notes. It does not include video.",
    ja: "バックアップには元リンク、プロジェクト名、区間メモが含まれます。動画は含まれません。"
  },
  "플레이어를 보면서 강조된 행에 E로 시작, R로 끝 시각을 기록합니다. 여러 구간은 T로 이어서 추가할 수 있습니다.": {
    en: "While watching the player, press E to set the In point and R to set the Out point in the highlighted row. Press T to continue with another range.",
    ja: "プレーヤーを見ながら、強調表示された行にEで開始点、Rで終了点を記録します。Tで次の区間を追加できます。"
  },
  "시작": {
    en: "In",
    ja: "開始"
  },
  "끝": {
    en: "Out",
    ja: "終了"
  },
  "메모 (선택)": {
    en: "Note (optional)",
    ja: "メモ（任意）"
  },
  "장면 설명": {
    en: "Scene description",
    ja: "シーンの説明"
  },
  "이 구간 삭제": {
    en: "Delete this range",
    ja: "この区間を削除"
  },
  "권리 확인": {
    en: "Rights confirmation",
    ja: "権利確認"
  },
  "편집 전 필수": {
    en: "Required before editing",
    ja: "編集前に必須"
  },
  "허용된 VOD에만 사용하세요.": {
    en: "Use only with authorized VODs.",
    ja: "許可されたVODにのみ使用してください。"
  },
  "스트리머·소속사의 명시적 키리누키 허용, 별도 서면 허락, 또는 공식 편집 권한이 있는 작업만 가능합니다. 취득·편집·게시·수익화와 제3자 권리 확인 결과에 대한 책임은 전적으로(100%) 사용자에게 있습니다.": {
    en: "Use is limited to work covered by explicit clipping permission from the streamer or their agency, separate written permission, or official editing authorization. You are solely and fully responsible for acquisition, editing, publication, monetization, and verification of third-party rights.",
    ja: "配信者・所属事務所から切り抜きの明示的な許可を得ている場合、別途書面による許可がある場合、または正式な編集権限がある場合にのみ使用できます。取得・編集・公開・収益化および第三者の権利確認については、すべて（100%）利用者が責任を負います。"
  },
  "이 입력은 권리를 새로 만들거나 Kirinuki가 법적 적합성을 심사·보증하는 절차가 아닙니다.": {
    en: "This confirmation does not create any rights, nor does it mean Kirinuki has reviewed or guaranteed legal compliance.",
    ja: "この確認によって新たな権利が生じるものではなく、Kirinukiが法的適合性を審査・保証するものでもありません。"
  },
  "이 원본 VOD가 실제 허용 또는 별도 권한 범위에 포함됨을 확인했습니다.": {
    en: "I confirm that this source VOD is covered by actual permission or separate authorization.",
    ja: "この元VODが、実際の許可または別途与えられた権限の範囲内であることを確認しました。"
  },
  "필요 구간의 로컬 취득과 편집이 그 허용 범위에 포함됨을 확인했습니다.": {
    en: "I confirm that locally acquiring and editing the required sections is covered by that permission.",
    ja: "必要な区間をローカルに取得して編集することが、その許可範囲に含まれることを確認しました。"
  },
  "편집 허용과 게시·수익화 허용은 별개일 수 있음을 확인했습니다.": {
    en: "I understand that permission to edit may be separate from permission to publish or monetize.",
    ja: "編集の許可と、公開・収益化の許可が別の場合があることを確認しました。"
  },
  "음악·이미지·인물 등 제3자 권리는 별도로 확인할 책임이 있음을 확인했습니다.": {
    en: "I understand that I must separately verify third-party rights, including music, images, and likeness rights.",
    ja: "音楽・画像・人物など、第三者の権利を別途確認する責任があることを確認しました。"
  },
  "플랫폼 약관을 확인하고 접근 통제·DRM을 우회하지 않겠습니다.": {
    en: "I will follow the platform terms and will not bypass access controls or DRM.",
    ja: "プラットフォームの規約を確認し、アクセス制御やDRMを回避しません。"
  },
  "입력 내용과 사용 결과의 책임이 전적으로(100%) 사용자에게 있음을 확인했습니다.": {
    en: "I confirm that I am solely and fully responsible for what I enter and for the results of using this service.",
    ja: "入力内容および利用結果について、すべて（100%）利用者が責任を負うことを確認しました。"
  },
  "편집기는 모바일에서 사용할 수 없습니다.": {
    en: "The editor is not available on mobile devices.",
    ja: "エディターはモバイル端末では利用できません。"
  },
  "컷 구간은 확인할 수 있지만 편집기 열기는 PC 브라우저에서만 가능합니다.": {
    en: "You can review the cut ranges here, but the editor can only be opened in a desktop browser.",
    ja: "カット範囲は確認できますが、エディターを開けるのはPCブラウザーのみです。"
  },
  "권리 확인 후 편집기 열기 (단축키 A)": {
    en: "Open editor after confirming rights (shortcut A)",
    ja: "権利確認後にエディターを開く（ショートカット A）"
  },
  "편집기 열기": {
    en: "Open editor",
    ja: "エディターを開く"
  },
  "위 항목을 확인하면 편집기를 열 수 있습니다.": {
    en: "Confirm the items above to open the editor.",
    ja: "上記の項目を確認すると、エディターを開けます。"
  },
  "선택한 구간을 준비하고 있습니다": {
    en: "Preparing the selected ranges",
    ja: "選択した区間を準備しています"
  },
  "최신 도우미 받기": {
    en: "Get the latest helper",
    ja: "最新のヘルパーを入手"
  },
  "내 파일로 계속": {
    en: "Continue with my file",
    ja: "手元のファイルで続ける"
  },
  "컷 선택은 이 웹 화면에서 끝납니다. 도우미가 필요한 경우에는 편집기로 넘어갈 때 선택한 영상 구간만 준비합니다.": {
    en: "Cut selection is completed on this web page. If the helper is needed, it prepares only the selected video sections when you proceed to the editor.",
    ja: "カット範囲の選択はこのウェブ画面で完了します。ヘルパーが必要な場合は、エディターへ進む際に選択した動画区間だけを準備します。"
  },
  "개인정보 및 오픈소스 안내": {
    en: "Privacy and open-source information",
    ja: "プライバシーとオープンソースの案内"
  },
  "Kirinuki 운영 서버는 원본 VOD 주소, 컷, 자막과 편집 프로젝트를 애플리케이션 기록으로 보관하지 않습니다. 사이트 전달·광고·원본 미리보기 과정에서는 각 제공자가 접속정보 등을 처리할 수 있습니다.": {
    en: "Kirinuki's operating server does not retain source VOD URLs, cuts, subtitles, or editing projects as application records. Site delivery, advertising, and source-preview providers may process connection information and similar data.",
    ja: "Kirinukiの運用サーバーは、元VODのURL、カット、字幕、編集プロジェクトをアプリケーション記録として保管しません。サイト配信・広告・元動画プレビューの過程では、各提供者が接続情報などを処理する場合があります。"
  },
  "개인정보 처리 안내": {
    en: "Privacy notice",
    ja: "プライバシーに関する案内"
  },
  "원본 미리보기와 구간 준비는 브라우저와 이 PC에서 직접 처리됩니다. 문의사항은": {
    en: "Source previews and range preparation are processed directly in the browser and on this PC. For questions, email",
    ja: "元動画のプレビューと区間準備は、ブラウザーとこのPCで直接処理されます。お問い合わせは"
  },
  "으로 보내 주세요.": {
    en: ".",
    ja: "までお送りください。"
  },
  "이 프로젝트는 오픈소스입니다:": {
    en: "This project is open source:",
    ja: "このプロジェクトはオープンソースです："
  },
  "KirinukiHelper GitHub 저장소 새 탭에서 열기": {
    en: "Open the KirinukiHelper GitHub repository in a new tab",
    ja: "KirinukiHelperのGitHubリポジトリを新しいタブで開く"
  },
  "GitHub에서 소스 보기": {
    en: "View source on GitHub",
    ja: "GitHubでソースを見る"
  },
  "오픈소스 라이선스": {
    en: "Open-source licenses",
    ja: "オープンソースライセンス"
  },
  "브라우저 저장 데이터를 삭제할까요?": {
    en: "Delete browser-saved data?",
    ja: "ブラウザーの保存データを削除しますか？"
  },
  "삭제할 편집을 다시 확인해 주세요.": {
    en: "Review the edit you are about to delete.",
    ja: "削除する編集をもう一度確認してください。"
  },
  "이 브라우저에 저장한 편집과 복구본만 삭제합니다. 원본 파일, 내보낸 영상, 편집용 VOD는 삭제하지 않습니다. 편집용 VOD는 편집기에서 ‘작업 끝내고 임시 파일 삭제’를 선택할 때만 삭제됩니다.": {
    en: "This deletes only edits and recovery snapshots stored in this browser. Source files, exported videos, and editing VODs are not deleted. An editing VOD is deleted only when you choose ‘Finish and delete temporary files’ in the editor.",
    ja: "このブラウザーに保存した編集と復元データだけを削除します。元ファイル、書き出した動画、編集用VODは削除されません。編集用VODは、エディターで「作業を終了して一時ファイルを削除」を選んだ場合にのみ削除されます。"
  },
  "취소": {
    en: "Cancel",
    ja: "キャンセル"
  }
} satisfies UiCopyCatalog;

const studioRuntimeCopy = {
  "내 PC용 도우미 다운로드": { en: "Download the helper for this PC", ja: "このPC用ヘルパーをダウンロード" },
  "영상 준비 도우미 연결됨": { en: "Media helper connected", ja: "動画準備ヘルパーに接続済み" },
  "Arch Linux 도우미 (.pkg.tar.zst)": { en: "Arch Linux helper (.pkg.tar.zst)", ja: "Arch Linux用ヘルパー（.pkg.tar.zst）" },
  "Arch Linux 도우미 연결됨": { en: "Arch Linux helper connected", ja: "Arch Linux用ヘルパーに接続済み" },
  "다운로드 요청됨 · 설치 후 연결 확인": { en: "Download started · Check connection after installation", ja: "ダウンロードを開始しました · インストール後に接続を確認" },
  "도우미도 연결됐습니다. YouTube 컷 제어는 이 웹 플레이어에서 바로 동작합니다.": { en: "The helper is connected. YouTube cut controls work directly in this web player.", ja: "ヘルパーに接続しました。YouTubeのカット操作はこのウェブプレーヤーで直接動作します。" },
  "도우미가 연결됐습니다. 컷 선택은 이 웹 화면에서 계속하고, 편집기로 넘어갈 때 선택 구간만 준비합니다.": { en: "The helper is connected. Keep selecting cuts on this page; only the selected ranges are prepared when you open the editor.", ja: "ヘルパーに接続しました。このウェブ画面でカット選択を続け、エディターへ進む際に選択した区間だけを準備します。" },
  "영상 준비 도우미가 연결됐습니다. VOD 주소를 붙여 넣어 컷을 선택하세요.": { en: "The media helper is connected. Paste a VOD URL to select cuts.", ja: "動画準備ヘルパーに接続しました。VODのURLを貼り付けてカット範囲を選択してください。" },
  "Windows 도우미 연결됨": { en: "Windows helper connected", ja: "Windows用ヘルパーに接続済み" },
  "Debian/Ubuntu 도우미 연결됨": { en: "Debian/Ubuntu helper connected", ja: "Debian/Ubuntu用ヘルパーに接続済み" },
  "편집기는 모바일에서 사용할 수 없습니다. PC 브라우저에서 열어 주세요.": { en: "The editor is not available on mobile devices. Open it in a desktop browser.", ja: "エディターはモバイル端末では利用できません。PCブラウザーで開いてください。" },
  "편집기는 모바일에서 사용할 수 없습니다": { en: "The editor is not available on mobile devices", ja: "エディターはモバイル端末では利用できません" },
  "도우미가 요청을 확인하고 있습니다": { en: "The helper is checking the request", ja: "ヘルパーがリクエストを確認しています" },
  "원본 VOD를 안전하게 확인하고 있습니다": { en: "Verifying the source VOD", ja: "元VODを安全に確認しています" },
  "선택한 구간만 계산하고 있습니다": { en: "Calculating only the selected ranges", ja: "選択した区間だけを計算しています" },
  "선택한 구간을 이 PC에 받고 있습니다": { en: "Downloading the selected ranges to this PC", ja: "選択した区間をこのPCにダウンロードしています" },
  "받은 영상과 원본 시각을 검증하고 있습니다": { en: "Verifying the downloaded media and source timecodes", ja: "取得した動画と元動画のタイムコードを検証しています" },
  "웹 편집기용 영상을 구성하고 있습니다": { en: "Building media for the web editor", ja: "ウェブエディター用の動画を作成しています" },
  "선택한 구간 준비를 마쳤습니다": { en: "Selected ranges are ready", ja: "選択した区間の準備が完了しました" },
  "선택한 구간을 준비하지 못했습니다": { en: "Could not prepare the selected ranges", ja: "選択した区間を準備できませんでした" },
  "선택한 구간 준비를 취소했습니다": { en: "Preparing the selected ranges was canceled", ja: "選択した区間の準備をキャンセルしました" },
  "영상 준비": { en: "Media preparation", ja: "動画の準備" },
  "영상 준비를 취소했습니다. 컷 선택 내용은 그대로 유지됩니다.": { en: "Media preparation was canceled. Your cut selections were preserved.", ja: "動画の準備をキャンセルしました。カット選択はそのまま保持されています。" },
  "도우미 연결 다시 확인": { en: "Check helper connection again", ja: "ヘルパー接続を再確認" },
  "원본 다시 확인하고 재시도": { en: "Verify source and try again", ja: "元動画を再確認して再試行" },
  "YouTube 플레이어 연결 완료 · E/R 캡처와 D/F/Y/U 제어를 사용할 수 있습니다.": { en: "YouTube player connected · E/R capture and D/F/Y/U controls are ready.", ja: "YouTubeプレーヤーに接続しました · E/Rでの記録とD/F/Y/U操作を使用できます。" },
  "이 PC의 영상 준비 도우미에서 원본 플레이어를 연결하는 중입니다…": { en: "Connecting the source player through the media helper on this PC…", ja: "このPCの動画準備ヘルパーから元動画プレーヤーに接続しています…" },
  "처음 한 번 브라우저가 로컬 네트워크 연결 허용을 요청할 수 있습니다.": { en: "Your browser may ask once for permission to access the local network.", ja: "初回のみ、ブラウザーがローカルネットワークへの接続許可を求める場合があります。" },
  "도우미가 연결한 원본 VOD를 이 웹 플레이어에서 재생합니다.": { en: "This web player plays the source VOD connected by the helper.", ja: "このウェブプレーヤーで、ヘルパーが接続した元VODを再生します。" },
  "연결 완료 · 보이는 영상과 E/R/D/F/Y/U 타임스탬프가 같은 재생 시계를 사용합니다.": { en: "Connected · The visible video and E/R/D/F/Y/U timecodes use the same playback clock.", ja: "接続完了 · 表示中の動画とE/R/D/F/Y/Uのタイムコードは同じ再生時計を使用します。" },
  "구간은 하나 이상 필요합니다.": { en: "At least one range is required.", ja: "区間が1つ以上必要です。" },
  "시작과 끝을 기록하면 편집기에서 준비할 범위를 보여드립니다.": { en: "Set an In and Out point to see the range that will be prepared for the editor.", ja: "開始点と終了点を記録すると、エディター用に準備する範囲が表示されます。" },
  "시작과 끝이 정해진 구간이 아직 없습니다.": { en: "No range has both an In and Out point yet.", ja: "開始点と終了点が揃った区間はまだありません。" },
  "구간 입력 템플릿을 읽지 못했습니다.": { en: "Could not read the range-entry template.", ja: "区間入力テンプレートを読み込めませんでした。" },
  "구간 입력 행을 만들지 못했습니다.": { en: "Could not create a range-entry row.", ja: "区間入力行を作成できませんでした。" },
  "프로젝트 이름을 1~160자로 입력해 주세요.": { en: "Enter a project name between 1 and 160 characters.", ja: "プロジェクト名を1〜160文字で入力してください。" },
  "라이브·클립이 아닌 CHZZK·YouTube·SOOP의 단일 공개 VOD 주소를 입력해 주세요.": { en: "Enter a single public CHZZK, YouTube, or SOOP VOD URL—not a live stream or clip.", ja: "ライブやクリップではなく、CHZZK・YouTube・SOOPの単一の公開VOD URLを入力してください。" },
  "Kirinuki 로컬 컷 제어": { en: "Kirinuki local cut controls", ja: "Kirinuki ローカルカット操作" },
  "편집할 구간을 하나 이상 입력해 주세요.": { en: "Enter at least one range to edit.", ja: "編集する区間を1つ以上入力してください。" },
  "현재 컷 백업을 만드는 중입니다…": { en: "Creating a backup of the current cuts…", ja: "現在のカット範囲をバックアップしています…" },
  "원본 또는 목표 위치 변경으로 오래된 미리보기를 폐기했습니다.": { en: "The previous preview was discarded because the source or target position changed.", ja: "元動画または対象位置が変わったため、古いプレビューを破棄しました。" },
  "원본 변경으로 오래된 미리보기를 폐기했습니다.": { en: "The previous preview was discarded because the source changed.", ja: "元動画が変わったため、古いプレビューを破棄しました。" },
  "도우미가 로컬 미리보기의 원본 시각을 검증하지 못했습니다.": { en: "The helper could not verify the local preview's source timecode.", ja: "ヘルパーがローカルプレビューの元動画タイムコードを検証できませんでした。" },
  "도우미가 준비한 짧은 로컬 구간을 이 웹페이지에서 재생합니다.": { en: "This page plays the short local range prepared by the helper.", ja: "ヘルパーが準備した短いローカル区間をこのページで再生します。" },
  "연결됐습니다. E/R/D/F/Y/U 단축키가 현재 원본 시각에 맞춰 동작합니다.": { en: "Connected. E/R/D/F/Y/U now follow the current source timecode.", ja: "接続しました。E/R/D/F/Y/Uショートカットが現在の元動画タイムコードに連動します。" },
  "로컬 VOD를 준비하기 전에 아래 권리 확인 항목을 확인해 주세요.": { en: "Complete the rights confirmation below before preparing the VOD locally.", ja: "VODをローカルに準備する前に、下の権利確認項目を確認してください。" },
  "이 PC의 영상 준비 도우미 연결을 확인하고 있습니다…": { en: "Checking the media helper connection on this PC…", ja: "このPCの動画準備ヘルパー接続を確認しています…" },
  "더 새로운 미리보기 요청이 시작됐습니다.": { en: "A newer preview request has started.", ja: "新しいプレビュー要求が開始されました。" },
  "도우미 연결을 건너뛰었습니다. 시간은 직접 입력하고 편집기에서 파일을 연결할 수 있습니다.": { en: "Helper connection was skipped. You can enter timecodes manually and choose a file in the editor.", ja: "ヘルパー接続をスキップしました。時刻を手動入力し、エディターでファイルを選択できます。" },
  "원본 VOD의 전체 길이를 확인하지 못했습니다.": { en: "Could not determine the full duration of the source VOD.", ja: "元VODの全体の長さを確認できませんでした。" },
  "내 파일로 계속합니다. 편집기에서 ‘내 파일 직접 연결’을 선택해 주세요.": { en: "Continuing with your own file. Choose ‘Choose Local File’ in the editor.", ja: "手元のファイルで続行します。エディターで「ローカルファイルを選択」を選んでください。" },
  "이 PC의 영상 준비 도우미를 확인하고 있습니다": { en: "Checking the media helper on this PC", ja: "このPCの動画準備ヘルパーを確認しています" },
  "도우미 없이 계속합니다. 편집기에서 ‘내 파일 직접 연결’을 선택해 주세요.": { en: "Continuing without the helper. Choose ‘Choose Local File’ in the editor.", ja: "ヘルパーなしで続行します。エディターで「ローカルファイルを選択」を選んでください。" },
  "선택한 VOD 구간을 부분 준비 범위로 바꾸지 못했습니다.": { en: "Could not convert the selected VOD ranges into a partial preparation range.", ja: "選択したVOD区間を部分準備範囲に変換できませんでした。" },
  "도우미와 이 편집만을 위한 안전한 연결을 만들고 있습니다": { en: "Creating a secure connection for this edit and the helper", ja: "この編集専用の安全なヘルパー接続を作成しています" },
  "도우미가 선택한 구간의 영상과 원본 시각 검증을 완료하지 못했습니다.": { en: "The helper could not finish verifying the selected media and source timecodes.", ja: "ヘルパーが選択区間の動画と元動画タイムコードの検証を完了できませんでした。" },
  "준비가 끝났습니다. 같은 브라우저 편집기를 여는 중입니다": { en: "Preparation is complete. Opening the editor in this browser", ja: "準備が完了しました。同じブラウザーでエディターを開いています" },
  "필수 책임 확인 항목을 모두 선택해 주세요.": { en: "Select every required responsibility confirmation.", ja: "必須の責任確認項目をすべて選択してください。" },
  "새 편집을 만들려면 원본 VOD와 한 개 이상의 구간이 필요합니다.": { en: "A source VOD and at least one range are required to create a new edit.", ja: "新しい編集を作成するには、元VODと1つ以上の区間が必要です。" },
  "백업 파일 크기가 허용 범위를 벗어났습니다.": { en: "The backup file size is outside the allowed range.", ja: "バックアップファイルのサイズが許容範囲外です。" },
  "백업 파일과 원본·구간을 확인하는 중입니다…": { en: "Checking the backup file, source, and ranges…", ja: "バックアップファイル、元動画、区間を確認しています…" },
  "백업 파일 불러오기를 취소했습니다.": { en: "Backup import was canceled.", ja: "バックアップの読み込みをキャンセルしました。" },
  "URL 확인 필요": { en: "URL needs verification", ja: "URLの確認が必要" },
  "링크 대기": { en: "Waiting for link", ja: "リンク入力待ち" },
  "지원되는 단일 공개 VOD 주소를 입력하면 플레이어가 열립니다.": { en: "Enter a supported single public VOD URL to open the player.", ja: "対応する単一の公開VOD URLを入力するとプレーヤーが開きます。" },
  "플랫폼 공식 임베드에 브라우저가 직접 연결하는 중입니다…": { en: "Connecting directly to the platform's official embed…", ja: "プラットフォームの公式埋め込みにブラウザーから直接接続しています…" },
  "CHZZK VOD 페이지에 브라우저가 직접 연결하는 중입니다…": { en: "Connecting directly to the CHZZK VOD page…", ja: "CHZZK VODページにブラウザーから直接接続しています…" },
  "원본 플레이어 연결을 아직 확인하지 못했습니다. 도우미 실행 상태를 확인한 뒤 ‘플레이어 다시 시작’을 눌러 주세요.": { en: "The source player connection is not ready. Check that the helper is running, then select ‘Reload player’.", ja: "元動画プレーヤーへの接続をまだ確認できません。ヘルパーの実行状態を確認し、「プレーヤーを再読み込み」を押してください。" },
  "저장 시각 정보 없음": { en: "No saved-time information", ja: "保存日時の情報なし" },
  "현재 다른 탭에서 편집 중입니다": { en: "Currently being edited in another tab", ja: "現在、別のタブで編集中です" },
  "복구본 없음 · 마지막 저장 상태에서 계속할 수 있습니다": { en: "No recovery snapshots · You can continue from the last saved state", ja: "復元データなし · 最後の保存状態から続行できます" },
  "복구본 없음": { en: "No recovery snapshots", ja: "復元データなし" },
  "다른 탭에서 편집 중입니다. 그 탭에서 작업을 끝내거나 닫은 뒤 목록을 새로고침해 주세요.": { en: "This edit is open in another tab. Finish or close it there, then refresh the list.", ja: "別のタブで編集中です。そのタブで作業を終了するか閉じてから、一覧を更新してください。" },
  "이 프로젝트의 마지막 브라우저 저장본을 계속 편집": { en: "Continue editing the last browser-saved version of this project", ja: "このプロジェクトの最後のブラウザー保存版を引き続き編集" },
  "이 프로젝트의 최근 5개 자동·수동 복구본 중에서 선택": { en: "Choose from this project's five most recent automatic or manual recovery snapshots", ja: "このプロジェクトの直近5件の自動・手動復元データから選択" },
  "이 프로젝트에는 선택할 복구본이 없습니다": { en: "This project has no recovery snapshots to choose from", ja: "このプロジェクトには選択できる復元データがありません" },
  "이 프로젝트와 연결된 브라우저 저장 데이터 삭제": { en: "Delete browser-saved data for this project", ja: "このプロジェクトに関連するブラウザー保存データを削除" },
  "다른 탭에서 편집 중인 작업을 먼저 끝내거나 닫아 주세요.": { en: "Finish or close edits open in other tabs first.", ja: "先に、別のタブで編集中の作業を終了するか閉じてください。" },
  "이 브라우저의 모든 저장 편집 삭제": { en: "Delete all edits saved in this browser", ja: "このブラウザーに保存された編集をすべて削除" },
  "목록 준비에 실패했습니다. 오류가 난 항목은 임의로 삭제하지 않았습니다.": { en: "Could not prepare the list. No items with errors were deleted.", ja: "一覧を準備できませんでした。エラーが発生した項目は削除していません。" },
  "저장된 편집 없음 · 아래 입력은 항상 새 프로젝트로 시작합니다.": { en: "No saved edits · The fields below always start a new project.", ja: "保存済みの編集なし · 下の入力欄からは常に新しいプロジェクトが始まります。" },
  "알 수 없음": { en: "Unknown", ja: "不明" },
  "지원하지 않는 브라우저 프로젝트가 있습니다: 알 수 없음": {
    en: "An unsupported browser project was found: Unknown",
    ja: "対応していないブラウザープロジェクトがあります: 不明"
  },
  "이 브라우저에 저장된 편집이 없습니다.": { en: "No edits are saved in this browser.", ja: "このブラウザーに保存された編集はありません。" },
  "브라우저 편집 목록을 읽지 못했습니다.": { en: "Could not read the browser edit list.", ja: "ブラウザーの編集一覧を読み込めませんでした。" },
  "자동 이전 편집 브라우저 저장 상태 정리에 실패했습니다.": { en: "Could not automatically clean up the previous edit's browser state.", ja: "以前の編集のブラウザー保存状態を自動整理できませんでした。" },
  "이전 편집의 브라우저 저장 상태를 정리하지 못했습니다.": { en: "Could not clean up the previous edit's browser state.", ja: "以前の編集のブラウザー保存状態を整理できませんでした。" },
  "이전 편집 정리를 확인하지 못해 새 편집을 열지 않았습니다. 브라우저 저장 편집에서 ‘다시 읽기’를 눌러 정리를 완료한 뒤 다시 시도해 주세요.": { en: "A new edit was not opened because cleanup of the previous edit could not be confirmed. Select ‘Reload’ under browser-saved edits, finish cleanup, and try again.", ja: "以前の編集の整理を確認できなかったため、新しい編集は開きませんでした。ブラウザー保存済み編集で「再読み込み」を押して整理を完了し、もう一度お試しください。" },
  "삭제할 브라우저 편집을 목록에서 찾지 못했습니다.": { en: "The browser edit to delete was not found in the list.", ja: "削除するブラウザー編集が一覧に見つかりませんでした。" },
  "이 편집 삭제": { en: "Delete this edit", ja: "この編集を削除" },
  "이 브라우저의 모든 편집을 삭제할까요?": { en: "Delete every edit in this browser?", ja: "このブラウザーの編集をすべて削除しますか？" },
  "모든 편집 삭제": { en: "Delete all edits", ja: "すべての編集を削除" },
  "이 편집이 다른 탭에서 열려 있어 삭제하지 않았습니다. 편집기 탭을 닫은 뒤 다시 시도해 주세요.": { en: "This edit was not deleted because it is open in another tab. Close the editor tab and try again.", ja: "別のタブで開いているため、この編集は削除しませんでした。エディターのタブを閉じてから再試行してください。" },
  "다른 탭에서 편집 중인 프로젝트가 있어 모두 삭제하지 않았습니다. 모든 편집기 탭을 닫은 뒤 다시 시도해 주세요.": { en: "Nothing was deleted because a project is open in another tab. Close all editor tabs and try again.", ja: "別のタブで編集中のプロジェクトがあるため、すべての削除は行いませんでした。エディターのタブをすべて閉じてから再試行してください。" },
  "선택한 편집": { en: "Selected edit", ja: "選択した編集" },
  "저장된 편집 전체": { en: "All saved edits", ja: "保存済みの編集すべて" },
  "YouTube 플레이어가 준비되는 중입니다. 영상이 열린 뒤 E/R을 다시 눌러 주세요.": { en: "The YouTube player is getting ready. Once the video opens, press E or R again.", ja: "YouTubeプレーヤーを準備しています。動画が開いたら、EまたはRをもう一度押してください。" },
  "웹 원본 플레이어가 아직 시각을 확정하지 못했습니다. 재생 또는 이동이 끝난 뒤 다시 눌러 주세요.": { en: "The web source player has not resolved its playhead yet. Try again after playback or seeking settles.", ja: "ウェブの元動画プレーヤーが再生位置をまだ確定できていません。再生またはシークが落ち着いてから、もう一度押してください。" },
  "웹 원본 플레이어가 아직 재생 시각을 확정하지 못했습니다.": { en: "The web source player has not resolved its playhead yet.", ja: "ウェブの元動画プレーヤーが再生位置をまだ確定できていません。" },
  "로컬 미리보기가 준비된 뒤에 영상 위치를 이동할 수 있습니다.": { en: "You can seek after the local preview is ready.", ja: "ローカルプレビューの準備後にシークできます。" },
  "웹 원본 플레이어가 아직 준비되지 않았습니다.": { en: "The web source player is not ready yet.", ja: "ウェブの元動画プレーヤーはまだ準備できていません。" },
  "로컬 미리보기가 준비된 뒤에 재생 속도를 바꿀 수 있습니다.": { en: "You can change playback speed after the local preview is ready.", ja: "ローカルプレビューの準備後に再生速度を変更できます。" },
  "구간을 확정하고 다음 빈 구간을 열었습니다.": { en: "The range was confirmed and the next empty range was opened.", ja: "区間を確定し、次の空の区間を開きました。" },
  "플랫폼 원본 미리보기를 브라우저에 직접 불러왔습니다.": { en: "The platform's source preview was loaded directly in the browser.", ja: "プラットフォームの元動画プレビューをブラウザーに直接読み込みました。" },
  "CHZZK·SOOP 원본을 이 웹 플레이어에 연결하고 있습니다…": { en: "Connecting the CHZZK or SOOP source to this web player…", ja: "CHZZK・SOOPの元動画をこのウェブプレーヤーに接続しています…" },
  "원본 VOD 회차를 식별하지 못했습니다.": { en: "Could not identify the source VOD episode.", ja: "元VODの回を識別できませんでした。" },
  "도우미가 선택한 구간만 준비합니다. 이 페이지에서 진행 상황을 확인할 수 있습니다.": { en: "The helper prepares only the selected ranges. Progress appears on this page.", ja: "ヘルパーは選択した区間だけを準備します。進行状況はこのページで確認できます。" },
  "같은 브라우저에서 편집기를 여는 중입니다…": { en: "Opening the editor in this browser…", ja: "同じブラウザーでエディターを開いています…" },
  "치지직 VOD": { en: "CHZZK VOD", ja: "CHZZK VOD" }
} satisfies UiCopyCatalog;

const helperCopy = {
  "웹 편집을 위한 로컬 영상 준비": { en: "Prepare local media for web editing", ja: "ウェブ編集用のローカル動画を準備" },
  "영상 준비 도우미만 연결하면 바로 이어집니다": { en: "Connect the media helper to continue", ja: "動画準備ヘルパーを接続すると、そのまま続行できます" },
  "컷 선택과 편집은 계속 이 웹사이트에서 합니다. 도우미는 선택한 영상 구간만 이 PC에 준비하며 별도 작업 창을 열지 않습니다.": { en: "Cut selection and editing stay on this website. The helper prepares only the selected media ranges on this PC and does not open a separate workspace.", ja: "カット選択と編集は引き続きこのウェブサイトで行います。ヘルパーは選択した動画区間だけをこのPCに準備し、別の作業画面は開きません。" },
  "영상 준비 도우미 연결 순서": { en: "How to connect the media helper", ja: "動画準備ヘルパーの接続手順" },
  "내 PC용 도우미 받기": { en: "Get the helper for this PC", ja: "このPC用ヘルパーを入手" },
  "운영체제에 맞는 설치 파일을 고릅니다.": { en: "Choose the installer for your operating system.", ja: "お使いのOSに合うインストーラーを選びます。" },
  "다운로드 후 설치·실행": { en: "Install and run after downloading", ja: "ダウンロード後にインストールして起動" },
  "설치 파일을 실행하고 도우미를 한 번 시작합니다.": { en: "Run the installer, then launch the helper once.", ja: "インストーラーを実行し、ヘルパーを一度起動します。" },
  "이 화면에서 연결 확인": { en: "Check the connection on this screen", ja: "この画面で接続を確認" },
  "도우미 실행을 확인한 뒤 이 브라우저에서 원래 작업을 이어갑니다.": { en: "Once the helper is running, continue your original work in this browser.", ja: "ヘルパーの起動を確認したら、このブラウザーで元の作業を続けます。" },
  "현재 공개 테스트는 Debian/Ubuntu·Arch Linux x64를 지원합니다.": { en: "The current public test supports Debian/Ubuntu and Arch Linux x64.", ja: "現在の公開テストはDebian/Ubuntu・Arch Linux x64に対応しています。" },
  "다운로드를 누르면 이 화면에 다음 행동을 계속 안내합니다. 실제 파일 진행률은 브라우저의 다운로드 표시에서 확인할 수 있습니다.": { en: "After you start the download, this screen continues with the next steps. Check your browser's download indicator for actual file progress.", ja: "ダウンロードを開始すると、この画面で次の手順を案内します。実際のファイル進捗はブラウザーのダウンロード表示で確認できます。" },
  "도우미 소스·라이선스 안내": { en: "Helper source and license information", ja: "ヘルパーのソース・ライセンス情報" },
  "이번에는 파일로 계속": { en: "Use my file this time", ja: "今回は手元のファイルで続ける" },
  "연결 기억 지우기": { en: "Forget helper connection", ja: "接続情報を消去" },
  "설치 후 연결 확인": { en: "Check connection after installation", ja: "インストール後に接続を確認" },
  "Arch Linux용 도우미 (.pkg.tar.zst)": { en: "Arch Linux helper (.pkg.tar.zst)", ja: "Arch Linux用ヘルパー（.pkg.tar.zst）" },
  "컷과 준비한 영상은 이 브라우저와 PC에서 처리되며 Kirinuki 운영 서버의 프로젝트 데이터베이스로 보내지지 않습니다.": { en: "Cuts and prepared media are processed in this browser and on this PC; they are not sent to Kirinuki's project database.", ja: "カットと準備した動画は、このブラウザーとPCで処理され、Kirinuki運用サーバーのプロジェクトデータベースには送信されません。" },
  "이 PC의 영상 준비 도우미에 연결하지 못했습니다. 이미 설치했다면 주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 ‘설치 후 연결 확인’을 눌러 주세요.": { en: "Could not connect to the media helper on this PC. If it is installed, allow local-network access in this site's browser settings, then select ‘Check connection after installation’.", ja: "このPCの動画準備ヘルパーに接続できませんでした。インストール済みの場合は、アドレスバーのサイト設定でローカルネットワークアクセスを許可し、「インストール後に接続を確認」を押してください。" },
  "아직 이 PC의 영상 준비 도우미가 연결되지 않았습니다. 처음이라면 아래 다운로드부터, 이미 설치했다면 ‘설치 후 연결 확인’을 눌러 주세요.": { en: "The media helper is not connected yet. If this is your first time, start with the download below. If it is already installed, select ‘Check connection after installation’.", ja: "このPCの動画準備ヘルパーはまだ接続されていません。初めての場合は下のダウンロードから、インストール済みの場合は「インストール後に接続を確認」を押してください。" },
  "설치된 영상 준비 도구의 응답 크기가 올바르지 않습니다.": { en: "The installed media helper returned an invalid response size.", ja: "インストール済みの動画準備ヘルパーから無効なサイズの応答が返されました。" },
  "설치된 영상 준비 도구의 응답이 허용 크기를 넘었습니다.": { en: "The installed media helper's response exceeded the allowed size.", ja: "インストール済みの動画準備ヘルパーの応答が許容サイズを超えました。" },
  "설치된 영상 준비 도구의 응답 문자가 올바르지 않습니다.": { en: "The installed media helper's response contains invalid characters.", ja: "インストール済みの動画準備ヘルパーの応答に無効な文字が含まれています。" },
  "Kirinuki 엔진 연결 응답이 만료됐거나 지원 version보다 오래됐습니다.": { en: "The Kirinuki engine connection response has expired or is older than the supported version.", ja: "Kirinukiエンジンの接続応答が期限切れか、対応バージョンより古くなっています。" },
  "Kirinuki 엔진 연결 응답의 설치 identity 서명이 올바르지 않습니다.": { en: "The installation identity signature in the Kirinuki engine response is invalid.", ja: "Kirinukiエンジン接続応答のインストールID署名が無効です。" },
  "이 브라우저가 이전에 연결한 영상 준비 도우미와 현재 도우미의 identity가 다릅니다. 자동 교체하지 않았습니다. 설치를 확인한 뒤 ‘연결 기억 지우기’를 명시적으로 선택해 주세요.": { en: "This helper has a different identity from the one previously connected to this browser. It was not replaced automatically. Verify the installation, then explicitly select ‘Forget helper connection’.", ja: "現在のヘルパーは、このブラウザーが以前接続したヘルパーとIDが異なります。自動では置き換えていません。インストールを確認し、「接続情報を消去」を明示的に選択してください。" },
  "Kirinuki 엔진 연결 제한 시간이 올바르지 않습니다.": { en: "The Kirinuki engine connection timeout is invalid.", ja: "Kirinukiエンジンの接続タイムアウトが無効です。" },
  "Kirinuki 엔진 연결을 취소했습니다.": { en: "Kirinuki engine connection was canceled.", ja: "Kirinukiエンジンへの接続をキャンセルしました。" },
  "영상 준비 도우미에서 연결 응답을 받지 못했습니다. 도우미 설치가 끝났는지 확인해 주세요.": { en: "No connection response was received from the media helper. Check that installation is complete.", ja: "動画準備ヘルパーから接続応答を受信できませんでした。インストールが完了しているか確認してください。" },
  "Kirinuki 엔진 pairing poll 응답이 JSON이 아닙니다.": { en: "The Kirinuki engine pairing-poll response is not JSON.", ja: "Kirinukiエンジンのペアリング確認応答がJSONではありません。" },
  "Kirinuki 엔진 pairing 대기 응답이 올바르지 않습니다.": { en: "The Kirinuki engine pairing-pending response is invalid.", ja: "Kirinukiエンジンのペアリング待機応答が無効です。" },
  "Kirinuki 엔진 pairing 응답이 현재 요청과 다릅니다.": { en: "The Kirinuki engine pairing response does not match the current request.", ja: "Kirinukiエンジンのペアリング応答が現在のリクエストと一致しません。" },
  "로컬 영상 준비 도구 확인 제한 시간이 올바르지 않습니다.": { en: "The local media-helper check timeout is invalid.", ja: "ローカル動画準備ヘルパーの確認タイムアウトが無効です。" },
  "이 브라우저의 Kirinuki 엔진 identity 저장소를 읽지 못했습니다.": { en: "Could not read the Kirinuki engine identity stored in this browser.", ja: "このブラウザーに保存されたKirinukiエンジンIDを読み込めませんでした。" },
  "이 브라우저는 아직 영상 준비 도우미와 연결되지 않았습니다. ‘이 PC 연결’ 버튼을 눌러 한 번 연결해 주세요.": { en: "This browser has not connected to the media helper yet. Select ‘Connect this PC’ once to pair it.", ja: "このブラウザーはまだ動画準備ヘルパーに接続されていません。「このPCに接続」を一度押して接続してください。" },
  "로컬 영상 준비 도구 확인 시간이 초과되었습니다.": { en: "The local media-helper check timed out.", ja: "ローカル動画準備ヘルパーの確認がタイムアウトしました。" },
  "설치된 영상 준비 도구의 버전을 확인하지 못했습니다.": { en: "Could not determine the installed media helper's version.", ja: "インストール済みの動画準備ヘルパーのバージョンを確認できませんでした。" },
  "현재 도우미의 응답은 이 브라우저에 기억된 도우미 identity와 다릅니다. 연결 정보를 자동 교체하지 않았습니다.": { en: "The current helper's response has a different identity from the helper remembered by this browser. Connection data was not replaced automatically.", ja: "現在のヘルパー応答は、このブラウザーに記憶されたヘルパーIDと異なります。接続情報は自動更新していません。" },
  "현재 영상 준비 도우미의 응답에서 기억된 도우미의 서명을 확인하지 못했습니다.": { en: "The remembered helper signature could not be verified in the current media helper response.", ja: "現在の動画準備ヘルパー応答で、記憶済みヘルパーの署名を確認できませんでした。" },
  "macOS 시스템 설정의 일반 > 로그인 항목에서 Kirinuki 백그라운드 실행을 한 번 허용해 주세요. 허용되면 자동으로 이어집니다.": { en: "In macOS System Settings, open General > Login Items and allow Kirinuki to run in the background once. Setup will continue automatically.", ja: "macOSのシステム設定で「一般」>「ログイン項目」を開き、Kirinukiのバックグラウンド実行を一度許可してください。許可後は自動で続行します。" },
  "설치된 영상 준비 도구가 현재 안전 기준과 맞지 않거나 손상됐습니다. 아래 공식 서명 설치 파일을 실행한 뒤 ‘이 PC 연결’을 한 번 눌러 주세요.": { en: "The installed media helper does not meet current security requirements or is damaged. Run the officially signed installer below, then select ‘Connect this PC’ once.", ja: "インストール済みの動画準備ヘルパーが現在の安全基準に適合していないか、破損しています。下の公式署名済みインストーラーを実行し、「このPCに接続」を一度押してください。" },
  "확인 중 로컬 엔진 identity가 바뀌었습니다. 연결 정보를 자동 교체하지 않았습니다.": { en: "The local engine identity changed during verification. Connection data was not replaced automatically.", ja: "確認中にローカルエンジンIDが変わりました。接続情報は自動更新していません。" },
  "설치된 로컬 엔진 version이 이 브라우저의 신뢰 기록과 맞지 않습니다.": { en: "The installed local engine version does not match this browser's trust record.", ja: "インストール済みローカルエンジンのバージョンが、このブラウザーの信頼記録と一致しません。" },
  "Windows 도우미 미리보기 다운로드를 요청했습니다. 다운로드한 exe를 실행하세요. Windows가 앱 보호 화면을 표시하면 ‘추가 정보’에서 실행을 선택할 수 있습니다. 설치가 끝나면 도우미가 자동으로 시작되고 이 화면이 연결을 계속 확인합니다.": { en: "The Windows helper preview download has started. Run the downloaded EXE. If Windows shows an app-protection screen, choose to run it under ‘More info’. The helper starts automatically after installation while this screen continues checking the connection.", ja: "Windows用ヘルパーのプレビュー版をダウンロードしています。ダウンロードしたEXEを実行してください。Windowsの保護画面が表示された場合は、「詳細情報」から実行できます。インストール後にヘルパーが自動起動し、この画面で接続確認が続きます。" },
  "Windows 도우미 미리보기 (.exe)": { en: "Windows helper preview (.exe)", ja: "Windows用ヘルパー プレビュー版（.exe）" },
  "Windows 설치 파일 다운로드를 요청했습니다. 브라우저 다운로드 표시가 완료되면 파일을 실행하세요. 이 화면은 설치된 도우미를 자동으로 확인하고 있습니다.": { en: "The Windows installer download has started. Run the file after your browser reports that the download is complete. This screen is automatically checking for the installed helper.", ja: "Windowsインストーラーのダウンロードを開始しました。ブラウザーで完了を確認したら、ファイルを実行してください。この画面はインストール済みヘルパーを自動確認しています。" },
  "Windows용 도우미 다운로드": { en: "Download helper for Windows", ja: "Windows用ヘルパーをダウンロード" },
  "macOS 설치 파일 다운로드를 요청했습니다. 완료된 DMG를 열어 Kirinuki를 응용 프로그램에 넣고 한 번 실행하세요. 이 화면은 도우미 연결을 자동으로 확인하고 있습니다.": { en: "The macOS installer download has started. Open the downloaded DMG, move Kirinuki to Applications, and launch it once. This screen is automatically checking the helper connection.", ja: "macOSインストーラーのダウンロードを開始しました。ダウンロードしたDMGを開き、Kirinukiをアプリケーションに移して一度起動してください。この画面はヘルパー接続を自動確認しています。" },
  "macOS용 도우미 다운로드": { en: "Download helper for macOS", ja: "macOS用ヘルパーをダウンロード" },
  "Debian/Ubuntu용 다운로드를 요청했습니다. 다운로드가 끝나면 deb를 설치하고 도우미를 한 번 실행한 뒤 이 화면의 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.": { en: "The Debian/Ubuntu download has started. Install the DEB, launch the helper once, then select ‘Check connection after installation’ on this screen. A running helper is detected automatically.", ja: "Debian/Ubuntu用ファイルのダウンロードを開始しました。DEBをインストールし、ヘルパーを一度起動してから、この画面の「インストール後に接続を確認」を押してください。実行中のヘルパーは自動検出されます。" },
  "Debian/Ubuntu용 도우미 다운로드를 요청했습니다. 다운로드가 끝나면 deb를 설치하고 도우미를 한 번 실행한 뒤 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.": { en: "The Debian/Ubuntu helper download has started. Install the DEB, launch the helper once, then select ‘Check connection after installation’. A running helper is detected automatically.", ja: "Debian/Ubuntu用ヘルパーのダウンロードを開始しました。DEBをインストールし、ヘルパーを一度起動してから「インストール後に接続を確認」を押してください。実行中のヘルパーは自動検出されます。" },
  "Debian/Ubuntu용 도우미 (.deb)": { en: "Debian/Ubuntu helper (.deb)", ja: "Debian/Ubuntu用ヘルパー（.deb）" },
  "Arch Linux용 도우미 다운로드를 요청했습니다. 다운로드가 끝나면 pacman으로 패키지를 설치하고 도우미를 한 번 실행한 뒤 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.": { en: "The Arch Linux helper download has started. Install the package with pacman, launch the helper once, then select ‘Check connection after installation’. A running helper is detected automatically.", ja: "Arch Linux用ヘルパーのダウンロードを開始しました。pacmanでパッケージをインストールし、ヘルパーを一度起動してから「インストール後に接続を確認」を押してください。実行中のヘルパーは自動検出されます。" },
  "현재 공개 테스트는 Windows x64·Debian/Ubuntu·Arch Linux x64를 지원합니다. macOS용 도우미는 아직 제공하지 않습니다.": { en: "The current public test supports Windows x64, Debian/Ubuntu, and Arch Linux x64. A macOS helper is not available yet.", ja: "現在の公開テストはWindows x64、Debian/Ubuntu、Arch Linux x64に対応しています。macOS用ヘルパーはまだ提供していません。" },
  "현재 공개 테스트는 Debian/Ubuntu·Arch Linux x64에서만 지원합니다. Windows와 macOS용 도우미는 아직 제공하지 않습니다.": { en: "The current public test supports only Debian/Ubuntu and Arch Linux x64. Windows and macOS helpers are not available yet.", ja: "現在の公開テストはDebian/Ubuntu・Arch Linux x64のみ対応しています。Windows・macOS用ヘルパーはまだ提供していません。" },
  "현재는 Windows 64비트, Apple Silicon macOS 15 이상, Debian/Ubuntu·Arch Linux 64비트만 지원합니다.": { en: "Currently supported: 64-bit Windows, Apple Silicon on macOS 15 or later, and 64-bit Debian/Ubuntu or Arch Linux.", ja: "現在は64ビットWindows、macOS 15以降のApple Silicon、64ビットDebian/Ubuntu・Arch Linuxに対応しています。" },
  "Windows 도우미 받기": { en: "Get the Windows helper", ja: "Windows用ヘルパーを入手" },
  "Windows 11 x64용 설치 파일(.exe)을 받습니다.": { en: "Download the installer (.exe) for Windows 11 x64.", ja: "Windows 11 x64用インストーラー（.exe）をダウンロードします。" },
  "다운로드한 설치 파일을 실행합니다. 미리보기 빌드에서는 Windows 앱 보호 안내가 표시될 수 있습니다.": { en: "Run the downloaded installer. Preview builds may trigger a Windows app-protection notice.", ja: "ダウンロードしたインストーラーを実行します。プレビュー版ではWindowsのアプリ保護メッセージが表示される場合があります。" },
  "설치가 끝나면 도우미 실행을 확인하고 원래 웹 작업을 이어갑니다.": { en: "After installation, check that the helper is running and continue your original web workflow.", ja: "インストール後にヘルパーの起動を確認し、元のウェブ作業を続けます。" },
  "Linux 도우미 받기": { en: "Get the Linux helper", ja: "Linux用ヘルパーを入手" },
  "Debian/Ubuntu 또는 Arch Linux x64용 파일을 고릅니다.": { en: "Choose the file for Debian/Ubuntu or Arch Linux x64.", ja: "Debian/UbuntuまたはArch Linux x64用のファイルを選びます。" },
  "패키지를 설치하고 앱 메뉴에서 Kirinuki 도우미를 한 번 실행합니다.": { en: "Install the package, then launch the Kirinuki helper once from the app menu.", ja: "パッケージをインストールし、アプリメニューからKirinukiヘルパーを一度起動します。" },
  "이 화면으로 돌아와 연결을 다시 확인하면 원래 웹 작업이 이어집니다.": { en: "Return to this screen and check the connection to resume your original web workflow.", ja: "この画面に戻って接続を再確認すると、元のウェブ作業を続けられます。" },
  "지원되는 운영체제용 설치 파일을 확인합니다.": { en: "Check the installer for a supported operating system.", ja: "対応OS用のインストーラーを確認します。" },
  "도우미 연결이 확인되면 원래 웹 작업을 이어갑니다.": { en: "Once the helper connection is confirmed, continue your original web workflow.", ja: "ヘルパー接続が確認できたら、元のウェブ作業を続けます。" },
  "Windows 미리보기 소스·라이선스 안내": { en: "Windows preview source and license information", ja: "Windowsプレビュー版のソース・ライセンス情報" },
  "Linux 미리보기 소스·라이선스 안내": { en: "Linux preview source and license information", ja: "Linuxプレビュー版のソース・ライセンス情報" },
  "이 PC 연결 허용하고 계속": { en: "Allow connection to this PC and continue", ja: "このPCへの接続を許可して続行" },
  "권한 설정 후 다시 확인": { en: "Check again after granting permission", ja: "権限を設定して再確認" },
  "이 PC 연결": { en: "Connect this PC", ja: "このPCに接続" },
  "도우미 실행 후 연결 확인": { en: "Launch helper and check connection", ja: "ヘルパーを起動して接続を確認" },
  "도우미 깨우고 다시 확인": { en: "Wake helper and check again", ja: "ヘルパーを起動して再確認" },
  "설치 완료 · 다시 확인": { en: "Installation complete · Check again", ja: "インストール完了 · 再確認" },
  "주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 다시 확인해 주세요.": { en: "Allow local-network access in this site's browser settings, then check again.", ja: "アドレスバーのサイト設定でローカルネットワークアクセスを許可してから、再確認してください。" },
  "먼저 이 사이트가 이 PC의 영상 준비 도구에 연결하도록 한 번 허용해 주세요. 이미 설치했다면 곧바로 원래 작업이 이어집니다.": { en: "First, allow this site to connect to the media helper on this PC. If it is already installed, your original workflow will resume immediately.", ja: "まず、このサイトがこのPCの動画準備ヘルパーに接続することを一度許可してください。インストール済みなら、すぐに元の作業へ戻ります。" },
  "현재 PC는 자동 설치 지원 대상이 아닙니다.": { en: "Automatic installation is not supported on this PC.", ja: "このPCは自動インストールの対象外です。" },
  "준비됐습니다. 선택한 영상 구간을 이어서 불러옵니다.": { en: "Ready. Loading the selected media ranges.", ja: "準備できました。選択した動画区間を続けて読み込みます。" },
  "이 PC의 영상 준비 도구를 확인하는 중…": { en: "Checking the media helper on this PC…", ja: "このPCの動画準備ヘルパーを確認しています…" },
  "영상 준비 도우미에서 이 브라우저의 연결 요청을 확인하는 중…": { en: "Waiting for the media helper to confirm this browser's connection request…", ja: "動画準備ヘルパーで、このブラウザーの接続要求を確認しています…" },
  "브라우저의 로컬 네트워크 접근 질문에서 허용을 선택해 주세요.": { en: "Choose Allow when your browser asks for local-network access.", ja: "ブラウザーのローカルネットワークアクセス確認で「許可」を選んでください。" },
  "도우미 실행을 확인했습니다. ‘이 PC 연결’을 누르면 이 브라우저 등록과 원래 작업을 이어갑니다.": { en: "The helper is running. Select ‘Connect this PC’ to register this browser and resume your original work.", ja: "ヘルパーの起動を確認しました。「このPCに接続」を押すと、このブラウザーを登録して元の作業を続けます。" },
  "도우미가 아직 실행되지 않았습니다. 앱 메뉴에서 Kirinuki 도우미를 한 번 실행한 뒤 연결을 다시 확인해 주세요.": { en: "The helper is not running yet. Launch the Kirinuki helper once from the app menu, then check the connection again.", ja: "ヘルパーはまだ起動していません。アプリメニューからKirinukiヘルパーを一度起動し、接続を再確認してください。" },
  "도우미가 아직 실행되지 않았습니다. 설치가 끝났다면 Kirinuki 도우미를 한 번 실행한 뒤 연결을 다시 확인해 주세요.": { en: "The helper is not running yet. If installation is complete, launch the Kirinuki helper once, then check the connection again.", ja: "ヘルパーはまだ起動していません。インストール済みの場合はKirinukiヘルパーを一度起動し、接続を再確認してください。" },
  "도우미는 실행 중이지만 연결 프로그램이 이어지지 않으면 터미널에서 `xdg-mime default kr.eff0rtchung.kirinuki.desktop x-scheme-handler/kirinuki-engine`를 한 번 실행한 뒤 다시 확인해 주세요.": { en: "If the helper is running but the protocol handler does not open, run `xdg-mime default kr.eff0rtchung.kirinuki.desktop x-scheme-handler/kirinuki-engine` once in a terminal, then check again.", ja: "ヘルパーが実行中でもプロトコルハンドラーが開かない場合は、ターミナルで `xdg-mime default kr.eff0rtchung.kirinuki.desktop x-scheme-handler/kirinuki-engine` を一度実行してから再確認してください。" },
  "그래도 연결되지 않으면 터미널에서 `xdg-mime query default x-scheme-handler/kirinuki-engine`로 현재 연결 프로그램만 확인해 주세요.": { en: "If it still does not connect, run `xdg-mime query default x-scheme-handler/kirinuki-engine` in a terminal to check the current protocol handler.", ja: "それでも接続できない場合は、ターミナルで `xdg-mime query default x-scheme-handler/kirinuki-engine` を実行し、現在のプロトコルハンドラーを確認してください。" },
  "설치가 끝난 뒤 다시 확인해 주세요.": { en: "Check again after installation is complete.", ja: "インストール完了後に再確認してください。" },
  "이 브라우저에 기억된 영상 준비 도우미 identity를 지울까요? 설치된 도우미를 직접 확인한 경우에만 계속하세요.": { en: "Forget the media-helper identity remembered by this browser? Continue only if you have personally verified the installed helper.", ja: "このブラウザーに記憶された動画準備ヘルパーIDを消去しますか？インストール済みヘルパーを自分で確認した場合のみ続行してください。" },
  "연결 identity를 초기화했습니다. ‘이 PC 연결’을 눌러 다시 확인해 주세요.": { en: "Connection identity was reset. Select ‘Connect this PC’ to verify it again.", ja: "接続IDをリセットしました。「このPCに接続」を押して再確認してください。" },
  "기기 연결 정보를 초기화하지 못했습니다.": { en: "Could not reset device connection information.", ja: "デバイス接続情報をリセットできませんでした。" },
  "영상 준비 연결을 취소했습니다.": { en: "Media-helper connection was canceled.", ja: "動画準備ヘルパーへの接続をキャンセルしました。" },
  "이 PC용 공식 도우미 설치판을 준비하고 있습니다. 서명과 배포 검증이 끝나면 이 화면의 다운로드 버튼에서 바로 받을 수 있습니다.": { en: "The official helper installer for this PC is being prepared. Once signing and release verification are complete, it will be available from the download button on this screen.", ja: "このPC用の公式ヘルパーインストーラーを準備しています。署名と配布検証が完了すると、この画面のダウンロードボタンから入手できます。" }
} satisfies UiCopyCatalog;

const surfacedModuleCopy = {
  "시작과 끝 시각을 올바르게 입력해 주세요.": { en: "Enter valid In and Out timecodes.", ja: "開始・終了タイムコードを正しく入力してください。" },
  "끝 시각은 시작 시각보다 0.1초 이상 뒤여야 합니다.": { en: "The Out point must be at least 0.1 seconds after the In point.", ja: "終了点は開始点より0.1秒以上後に設定してください。" },
  "저장된 편집 새로고침": { en: "Refresh saved edits", ja: "保存済みの編集を更新" },
  "현재 시각을 시작점으로 캡처": { en: "Set the current playhead as the In point", ja: "現在位置をイン点に設定" },
  "현재 시각을 끝점으로 캡처": { en: "Set the current playhead as the Out point", ja: "現在位置をアウト点に設定" },
  "다음 빈 구간 추가": { en: "Add the next empty range", ja: "次の空の区間を追加" },
  "권리 확인 후 편집기 열기": { en: "Open editor after confirming rights", ja: "権利確認後にエディターを開く" },
  "원본 영상을 5초 이전으로 이동": { en: "Move the source 5 seconds back", ja: "元動画を5秒戻す" },
  "원본 영상을 5초 이후로 이동": { en: "Move the source 5 seconds forward", ja: "元動画を5秒進める" },
  "원본 영상을 0.25배속으로 재생": { en: "Play the source at 0.25×", ja: "元動画を0.25倍速で再生" },
  "원본 영상을 2배속으로 재생": { en: "Play the source at 2×", ja: "元動画を2倍速で再生" },
  "YouTube VOD 식별자가 없습니다.": { en: "The YouTube VOD ID is missing.", ja: "YouTube VODのIDがありません。" },
  "YouTube 이동 시각이 올바르지 않습니다.": { en: "The YouTube seek time is invalid.", ja: "YouTubeのシーク時刻が無効です。" },
  "YouTube 재생 속도가 올바르지 않습니다.": { en: "The YouTube playback rate is invalid.", ja: "YouTubeの再生速度が無効です。" },
  "YouTube 플레이어가 이 VOD를 재생하지 못했습니다.": { en: "The YouTube player could not play this VOD.", ja: "YouTubeプレーヤーでこのVODを再生できませんでした。" },
  "YouTube 플레이어가 입력한 VOD와 다른 영상을 보고했습니다.": { en: "The YouTube player reported a video different from the requested VOD.", ja: "YouTubeプレーヤーから、入力したVODとは異なる動画が報告されました。" },
  "원본 영상과 컷 시각을 같은 위치로 맞추지 못했습니다.": { en: "Could not align the source video and cut timecode.", ja: "元動画とカットのタイムコードを同じ位置に合わせられませんでした。" },
  "이 브라우저가 웹 HLS 원본 재생을 지원하지 않습니다.": { en: "This browser does not support web playback of the source HLS stream.", ja: "このブラウザーは元HLSストリームのウェブ再生に対応していません。" },
  "영상 준비 도우미가 원본 재생 정보를 열지 못했습니다.": { en: "The media helper could not open the source playback information.", ja: "動画準備ヘルパーが元動画の再生情報を開けませんでした。" },
  "영상 준비 도우미의 원본 재생 응답이 올바르지 않습니다.": { en: "The media helper returned invalid source playback information.", ja: "動画準備ヘルパーの元動画再生応答が無効です。" },
  "이동할 원본 시각이 올바르지 않습니다.": { en: "The source seek time is invalid.", ja: "シーク先の元動画時刻が無効です。" },
  "영상 재생 시각과 컷 시각이 일치하지 않습니다.": { en: "The playback time and cut timecode do not match.", ja: "動画の再生時刻とカットのタイムコードが一致しません。" },
  "원본 영상 재생 속도를 바꾸지 못했습니다.": { en: "Could not change the source playback rate.", ja: "元動画の再生速度を変更できませんでした。" },
  "원본 VOD 파트를 열 수 없습니다.": { en: "Could not open the source VOD segment.", ja: "元VODのパートを開けませんでした。" },
  "더 새로운 원본 재생 요청이 시작됐습니다.": { en: "A newer source playback request has started.", ja: "新しい元動画再生リクエストが開始されました。" },
  "VOD 길이": { en: "VOD duration", ja: "VODの長さ" },
  "미리보기 위치": { en: "Preview position", ja: "プレビュー位置" },
  "0.1초보다 짧은 VOD는 미리보기를 준비할 수 없습니다.": { en: "A preview cannot be prepared for a VOD shorter than 0.1 seconds.", ja: "0.1秒未満のVODはプレビューを準備できません。" },
  "미리보기 범위를 안전한 원본 시각으로 바꾸지 못했습니다.": { en: "Could not convert the preview range to safe source timecodes.", ja: "プレビュー範囲を安全な元動画タイムコードに変換できませんでした。" },
  "미리보기 원본 시작": { en: "Preview source start", ja: "プレビュー元動画の開始" },
  "미리보기 원본 끝": { en: "Preview source end", ja: "プレビュー元動画の終了" },
  "미리보기 파일 시작": { en: "Preview file start", ja: "プレビューファイルの開始" },
  "미리보기 파일 끝": { en: "Preview file end", ja: "プレビューファイルの終了" },
  "미리보기 원본 시계 매핑이 올바르지 않습니다.": { en: "The preview-to-source time mapping is invalid.", ja: "プレビューと元動画の時間マッピングが無効です。" },
  "미리보기 재생 시각": { en: "Preview playhead", ja: "プレビュー再生位置" },
  "미리보기 원본 기준 시각이 유한하지 않습니다.": { en: "The preview's source-reference time is not finite.", ja: "プレビューの元動画基準時刻が有限値ではありません。" },
  "원본 이동 시각": { en: "Source seek time", ja: "元動画のシーク時刻" },
  "백업할 프로젝트 이름은 1~160자여야 합니다.": { en: "The project name in the backup must be between 1 and 160 characters.", ja: "バックアップするプロジェクト名は1〜160文字にしてください。" },
  "백업할 CHZZK·YouTube·SOOP 단일 공개 VOD 주소를 확인하지 못했습니다.": { en: "Could not verify a single public CHZZK, YouTube, or SOOP VOD URL for the backup.", ja: "バックアップ対象のCHZZK・YouTube・SOOPの単一公開VOD URLを確認できませんでした。" },
  "백업할 VOD 플랫폼을 확인하지 못했습니다.": { en: "Could not identify the VOD platform for the backup.", ja: "バックアップ対象VODのプラットフォームを確認できませんでした。" },
  "백업할 편집 프로젝트 ID가 올바르지 않습니다.": { en: "The edit project ID in the backup is invalid.", ja: "バックアップする編集プロジェクトIDが無効です。" },
  "만든 백업 파일을 현재 컷 불러오기 형식으로 재검증하지 못했습니다.": { en: "Could not revalidate the generated backup against the current cut-import format.", ja: "作成したバックアップを現在のカット読み込み形式として再検証できませんでした。" },
  "복원 JSON에서 CHZZK·YouTube·SOOP 단일 공개 VOD 주소를 확인하지 못했습니다.": { en: "Could not verify a single public CHZZK, YouTube, or SOOP VOD URL in the restore JSON.", ja: "復元JSON内のCHZZK・YouTube・SOOPの単一公開VOD URLを確認できませんでした。" },
  "복원 JSON의 원본 영상 링크와 미디어 복구 identity가 서로 다릅니다.": { en: "The source video URL and media-recovery identity in the restore JSON do not match.", ja: "復元JSONの元動画URLとメディア復元IDが一致しません。" },
  "복원 JSON의 컷 배열을 일관되게 복원하지 못했습니다.": { en: "Could not restore the cut list consistently from the restore JSON.", ja: "復元JSONのカット配列を一貫した状態で復元できませんでした。" },
  "복원 JSON 프로젝트": { en: "Restore JSON project", ja: "復元JSONプロジェクト" },
  "복원 JSON 프로젝트에 컷 배열이 없습니다.": { en: "The restore JSON project has no cut list.", ja: "復元JSONプロジェクトにカット配列がありません。" },
  "복원 JSON에 다시 가져올 활성 본편 구간이 없습니다.": { en: "The restore JSON has no active main-edit range to import.", ja: "復元JSONに再読み込みできる有効な本編区間がありません。" },
  "복원 JSON의 편집 프로젝트를 안전하게 정규화하지 못했습니다.": { en: "Could not safely normalize the edit project in the restore JSON.", ja: "復元JSONの編集プロジェクトを安全に正規化できませんでした。" },
  "복원 JSON의 프로젝트 이름은 1~160자여야 합니다.": { en: "The project name in the restore JSON must be between 1 and 160 characters.", ja: "復元JSONのプロジェクト名は1〜160文字にしてください。" },
  "Kirinuki 웹 Origin": { en: "Kirinuki web origin", ja: "Kirinukiウェブオリジン" },
  "YouTube 임베드 플레이어": { en: "YouTube embedded player", ja: "YouTube埋め込みプレーヤー" },
  "SOOP 임베드 플레이어": { en: "SOOP embedded player", ja: "SOOP埋め込みプレーヤー" },
  "CHZZK VOD 원본 창": { en: "CHZZK VOD source window", ja: "CHZZK VOD元動画ウィンドウ" },
  "치지직": { en: "CHZZK", ja: "CHZZK" },
  "지원하지 않음": { en: "Unsupported", ja: "未対応" },
  "영상 플레이어 미검출": { en: "Video player not detected", ja: "動画プレーヤーを検出できません" },
  "YouTube 광고 재생 중 · 스탬프 일시 중지": { en: "YouTube ad playing · Timecode capture paused", ja: "YouTube広告を再生中 · タイムコード記録を一時停止" },
  "일시정지": { en: "Paused", ja: "一時停止" },
  "재생 중": { en: "Playing", ja: "再生中" },
  "허용": { en: "Allowed", ja: "許可" },
  "미허용": { en: "Not allowed", ja: "未許可" },
  "클립 허용": { en: "Clipping allowed", ja: "クリップ許可" },
  "클립 미허용": { en: "Clipping not allowed", ja: "クリップ未許可" },
  "복원 JSON 프로젝트 형식이 올바르지 않습니다.": { en: "The restore JSON project has an invalid format.", ja: "復元JSONプロジェクトの形式が無効です。" }
} satisfies UiCopyCatalog;

export const CUT_UI_COPY_CATALOG: UiCopyCatalog = mergeUiCopyCatalogs(
  studioStaticCopy,
  studioRuntimeCopy,
  helperCopy,
  surfacedModuleCopy
);

export const CUT_UI_COPY_PATTERNS = [
  {
    source: /^재생 중 · 라이브 지연 ([0-9.]+)초 · 클립 허용$/u,
    en: "Playing · Live latency $1 sec · Clipping allowed",
    ja: "再生中 · ライブ遅延 $1秒 · クリップ許可"
  },
  {
    source: /^재생 중 · 라이브 지연 ([0-9.]+)초 · 클립 미허용$/u,
    en: "Playing · Live latency $1 sec · Clipping not allowed",
    ja: "再生中 · ライブ遅延 $1秒 · クリップ未許可"
  },
  {
    source: /^일시정지 · 라이브 지연 ([0-9.]+)초 · 클립 허용$/u,
    en: "Paused · Live latency $1 sec · Clipping allowed",
    ja: "一時停止 · ライブ遅延 $1秒 · クリップ許可"
  },
  {
    source: /^일시정지 · 라이브 지연 ([0-9.]+)초 · 클립 미허용$/u,
    en: "Paused · Live latency $1 sec · Clipping not allowed",
    ja: "一時停止 · ライブ遅延 $1秒 · クリップ未許可"
  },
  {
    source: /^재생 중 · 라이브 지연 ([0-9.]+)초$/u,
    en: "Playing · Live latency $1 sec",
    ja: "再生中 · ライブ遅延 $1秒"
  },
  {
    source: /^일시정지 · 라이브 지연 ([0-9.]+)초$/u,
    en: "Paused · Live latency $1 sec",
    ja: "一時停止 · ライブ遅延 $1秒"
  },
  {
    source: /^재생 중 · 클립 허용$/u,
    en: "Playing · Clipping allowed",
    ja: "再生中 · クリップ許可"
  },
  {
    source: /^재생 중 · 클립 미허용$/u,
    en: "Playing · Clipping not allowed",
    ja: "再生中 · クリップ未許可"
  },
  {
    source: /^일시정지 · 클립 허용$/u,
    en: "Paused · Clipping allowed",
    ja: "一時停止 · クリップ許可"
  },
  {
    source: /^일시정지 · 클립 미허용$/u,
    en: "Paused · Clipping not allowed",
    ja: "一時停止 · クリップ未許可"
  },
  {
    source: /^([0-9]+)번 구간: 시작과 끝 시각을 올바르게 입력해 주세요\.$/u,
    en: "Range $1: Enter valid In and Out timecodes.",
    ja: "区間$1：開始・終了タイムコードを正しく入力してください。"
  },
  {
    source: /^([0-9]+)번 구간: 끝 시각은 시작 시각보다 0\.1초 이상 뒤여야 합니다\.$/u,
    en: "Range $1: The Out point must be at least 0.1 seconds after the In point.",
    ja: "区間$1：終了点は開始点より0.1秒以上後に設定してください。"
  },
  {
    source: /^([0-9]+)번 컷 형식이 올바르지 않습니다\.$/u,
    en: "Cut $1 has an invalid format.",
    ja: "カット$1の形式が無効です。"
  },
  {
    source: /^([0-9]+)번 컷$/u,
    en: "Cut $1",
    ja: "カット$1"
  },
  {
    source: /^([0-9]+)번 컷 시작 시각은 0 이상의 안전한 정수 밀리초여야 합니다\.$/u,
    en: "The start time of cut $1 must be a safe integer number of milliseconds greater than or equal to zero.",
    ja: "カット$1の開始時刻は0以上の安全な整数ミリ秒である必要があります。"
  },
  {
    source: /^([0-9]+)번 컷 끝 시각은 0 이상의 안전한 정수 밀리초여야 합니다\.$/u,
    en: "The end time of cut $1 must be a safe integer number of milliseconds greater than or equal to zero.",
    ja: "カット$1の終了時刻は0以上の安全な整数ミリ秒である必要があります。"
  },
  {
    source: /^VOD 길이은 0 이상의 유한한 숫자여야 합니다\.$/u,
    en: "The VOD duration must be a finite number greater than or equal to zero.",
    ja: "VODの長さは0以上の有限数である必要があります。"
  },
  {
    source: /^미리보기 위치은 0 이상의 유한한 숫자여야 합니다\.$/u,
    en: "The preview position must be a finite number greater than or equal to zero.",
    ja: "プレビュー位置は0以上の有限数である必要があります。"
  },
  {
    source: /^미리보기 재생 시각은 0 이상의 유한한 숫자여야 합니다\.$/u,
    en: "The preview playhead must be a finite number greater than or equal to zero.",
    ja: "プレビュー再生位置は0以上の有限数である必要があります。"
  },
  {
    source: /^원본 이동 시각은 0 이상의 유한한 숫자여야 합니다\.$/u,
    en: "The source seek time must be a finite number greater than or equal to zero.",
    ja: "元動画のシーク時刻は0以上の有限数である必要があります。"
  },
  {
    source: /^저장된 편집 ([0-9,.]+)개 · 최근 수정순 · 다른 탭 작업 중 ([0-9,.]+)개$/u,
    en: "$1 saved edits · Most recently modified first · $2 open in other tabs",
    ja: "保存済みの編集$1件 · 更新が新しい順 · 別タブで編集中$2件"
  },
  {
    source: /^Kirinuki 시작 화면 요소가 없습니다: (.+)$/u,
    en: "Kirinuki home element is missing: $1",
    ja: "Kirinukiスタート画面の要素がありません：$1"
  },
  {
    source: /^Kirinuki 시작 화면 하위 요소가 없습니다: (.+)$/u,
    en: "Kirinuki home child element is missing: $1",
    ja: "Kirinukiスタート画面の子要素がありません：$1"
  },
  {
    source: /^로컬 영상 준비 안내 요소가 없습니다: (.+)$/u,
    en: "Media-helper onboarding element is missing: $1",
    ja: "動画準備ヘルパー案内の要素がありません：$1"
  },
  {
    source: /^도우미 연결을 확인하지 못했습니다: (.+)$/u,
    en: "Could not verify the helper connection: $1",
    ja: "ヘルパー接続を確認できませんでした：$1"
  },
  {
    source: /^웹 원본 플레이어를 연결하지 못했습니다: (.+) 도우미를 실행한 뒤 다시 시도해 주세요\.$/u,
    en: "Could not connect the web source player: $1 Launch the helper and try again.",
    ja: "ウェブの元動画プレーヤーに接続できませんでした：$1 ヘルパーを起動して再試行してください。"
  },
  {
    source: /^영상 준비 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped.",
    ja: "動画の準備が停止しました。"
  },
  {
    source: /^도우미가 요청을 확인하고 있습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped while the helper was checking the request.",
    ja: "ヘルパーがリクエストを確認している段階で動画の準備が停止しました。"
  },
  {
    source: /^원본 VOD를 안전하게 확인하고 있습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped while checking the source VOD.",
    ja: "元の VOD を確認している段階で動画の準備が停止しました。"
  },
  {
    source: /^선택한 구간만 계산하고 있습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped while calculating the selected ranges.",
    ja: "選択範囲を計算している段階で動画の準備が停止しました。"
  },
  {
    source: /^선택한 구간을 이 PC에 받고 있습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped while downloading the selected ranges to this PC.",
    ja: "選択範囲をこの PC にダウンロードしている段階で動画の準備が停止しました。"
  },
  {
    source: /^받은 영상과 원본 시각을 검증하고 있습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped while verifying the downloaded video against the source timecodes.",
    ja: "ダウンロードした動画と元動画のタイムコードを検証している段階で動画の準備が停止しました。"
  },
  {
    source: /^웹 편집기용 영상을 구성하고 있습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped while assembling the video for the web editor.",
    ja: "ウェブエディター用の動画を作成している段階で動画の準備が停止しました。"
  },
  {
    source: /^선택한 구간 준비를 마쳤습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped immediately after the selected ranges were ready.",
    ja: "選択範囲の準備が完了した直後に処理が停止しました。"
  },
  {
    source: /^선택한 구간을 준비하지 못했습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped after the selected ranges could not be prepared.",
    ja: "選択範囲を準備できず、処理が停止しました。"
  },
  {
    source: /^선택한 구간 준비를 취소했습니다 단계에서 멈췄습니다$/u,
    en: "Media preparation stopped after preparation was canceled.",
    ja: "選択範囲の準備がキャンセルされ、処理が停止しました。"
  },
  {
    source: /^편집기에서 준비할 범위 ([0-9:.]+) ~ ([0-9:.]+) \(앞뒤 10초 포함\)$/u,
    en: "Range prepared for the editor: $1–$2 (includes 10-second handles)",
    ja: "エディター用に準備する範囲：$1〜$2（前後10秒の余裕を含む）"
  },
  {
    source: /^정확한 편집본 길이 ([0-9:.]+)$/u,
    en: "Exact edit duration: $1",
    ja: "正確な編集尺：$1"
  },
  {
    source: /^현재 입력 #([0-9]+)$/u,
    en: "Active range #$1",
    ja: "入力中の区間 #$1"
  },
  {
    source: /^구간 입력 요소가 없습니다: (.+)$/u,
    en: "Range-entry element is missing: $1",
    ja: "区間入力要素がありません：$1"
  },
  {
    source: /^([0-9]+)번 구간: (.+)$/u,
    en: "Range $1: $2",
    ja: "区間$1：$2"
  },
  {
    source: /^([0-9]+)번 구간의 내부 식별자를 확인하지 못했습니다\.$/u,
    en: "Could not verify the internal ID for range $1.",
    ja: "区間$1の内部IDを確認できませんでした。"
  },
  {
    source: /^컷 단축키 대상이 없습니다: #(.+)$/u,
    en: "Cut-shortcut target is missing: #$1",
    ja: "カットショートカットの対象がありません：#$1"
  },
  {
    source: /^(.+)-컷백업-([0-9]{8}-[0-9]{6}Z)\.kirinuki-session\.json$/u,
    en: "$1-cut-backup-$2.kirinuki-session.json",
    ja: "$1-カットバックアップ-$2.kirinuki-session.json"
  },
  {
    source: /^원본 링크와 ([0-9,.]+)개 구간의 백업 다운로드를 시작했습니다\. 영상은 포함되지 않으며, 링크와 메모가 든 파일 공유에 주의하세요\.$/u,
    en: "Started downloading a backup of the source link and $1 ranges. Video is not included; take care when sharing a file that contains links and notes.",
    ja: "元リンクと$1区間のバックアップをダウンロードしています。動画は含まれません。リンクとメモを含むファイルの共有にはご注意ください。"
  },
  {
    source: /^현재 컷을 백업하지 못했습니다: (.+)$/u,
    en: "Could not back up the current cuts: $1",
    ja: "現在のカット範囲をバックアップできませんでした：$1"
  },
  {
    source: /^로컬 미리보기를 준비하지 못했습니다: (.+)$/u,
    en: "Could not prepare the local preview: $1",
    ja: "ローカルプレビューを準備できませんでした：$1"
  },
  {
    source: /^“(.+)”의 복구본을 권리 확인 후 선택합니다\.$/u,
    en: "Confirm rights, then choose a recovery snapshot for “$1”.",
    ja: "権利を確認してから「$1」の復元データを選択します。"
  },
  {
    source: /^“(.+)”의 마지막 저장 상태를 권리 확인 후 이어서 엽니다\.$/u,
    en: "Confirm rights, then continue “$1” from its last saved state.",
    ja: "権利を確認してから「$1」の最後の保存状態を開きます。"
  },
  {
    source: /^이 VOD의 브라우저 저장 편집이 ([0-9,.]+)개 있습니다\. 아래 버튼은 항상 별도의 새 편집을 만들며 기존 저장본과 섞지 않습니다\.$/u,
    en: "$1 browser-saved edits use this VOD. The button below always creates a separate new edit and never mixes it with an existing one.",
    ja: "このVODにはブラウザー保存済みの編集が$1件あります。下のボタンは常に別の新規編集を作成し、既存の保存データとは混在しません。"
  },
  {
    source: /^현재 입력을 ‘(.+)’의 원본 링크와 ([0-9,.]+)개 구간으로 바꿀까요\? 현재 편집기 세션과 정책 확인은 건드리지 않습니다\.$/u,
    en: "Replace the current input with “$1”'s source link and $2 ranges? The current editor session and policy confirmations will not be changed.",
    ja: "現在の入力を「$1」の元リンクと$2区間に置き換えますか？現在のエディターセッションとポリシー確認は変更しません。"
  },
  {
    source: /^백업 파일에서 원본 링크와 ([0-9,.]+)개 구간을 불러왔습니다\. 권리 확인은 다시 진행해 주세요\.$/u,
    en: "Imported the source link and $1 ranges from the backup. Complete the rights confirmation again.",
    ja: "バックアップから元リンクと$1区間を読み込みました。権利確認をもう一度行ってください。"
  },
  {
    source: /^컷 ([0-9,.]+)개 · 자막 ([0-9,.]+)개$/u,
    en: "$1 clips · $2 captions",
    ja: "クリップ$1件 · 字幕$2件"
  },
  {
    source: /^복구본 ([0-9,.]+)개$/u,
    en: "$1 recovery snapshots",
    ja: "復元データ$1件"
  },
  {
    source: /^복구본 선택 \(([0-9,.]+)\)$/u,
    en: "Choose recovery snapshot ($1)",
    ja: "復元データを選択（$1）"
  },
  {
    source: /^“(.+)” 계속 편집$/u,
    en: "Continue editing “$1”",
    ja: "「$1」の編集を続ける"
  },
  {
    source: /^“(.+)” 복구본 ([0-9,.]+)개 중 선택$/u,
    en: "Choose from $2 recovery snapshots for “$1”",
    ja: "「$1」の復元データ$2件から選択"
  },
  {
    source: /^“(.+)” 선택할 복구본 없음$/u,
    en: "No recovery snapshots available for “$1”",
    ja: "「$1」に選択できる復元データはありません"
  },
  {
    source: /^“(.+)” 브라우저 저장 데이터 삭제$/u,
    en: "Delete browser-saved data for “$1”",
    ja: "「$1」のブラウザー保存データを削除"
  },
  {
    source: /^저장된 편집 ([0-9,.]+)개 · 최근 수정순$/u,
    en: "$1 saved edits · Most recently modified first",
    ja: "保存済みの編集$1件 · 更新が新しい順"
  },
  {
    source: /^지원하지 않는 브라우저 프로젝트가 있습니다: (.+)$/u,
    en: "An unsupported browser project was found: $1",
    ja: "未対応のブラウザープロジェクトがあります：$1"
  },
  {
    source: /^저장으로 확정하지 않은 이전 작업 ([0-9,.]+)개를 정리했습니다\. 수동 임시저장은 남기고 나머지는 열기 전 상태로 되돌렸습니다\.$/u,
    en: "Cleaned up $1 previous unsaved edits. Manual temporary saves were kept; everything else was restored to its pre-open state.",
    ja: "保存が確定していない以前の作業$1件を整理しました。手動の一時保存は残し、それ以外は開く前の状態に戻しました。"
  },
  {
    source: /^저장된 편집 ([0-9,.]+)개를 다시 읽었습니다\.$/u,
    en: "Reloaded $1 saved edits.",
    ja: "保存済みの編集$1件を再読み込みしました。"
  },
  {
    source: /^브라우저 편집 목록을 읽지 못했습니다: (.+)$/u,
    en: "Could not read the browser edit list: $1",
    ja: "ブラウザーの編集一覧を読み込めませんでした：$1"
  },
  {
    source: /^브라우저에 남은 이전 편집의 정리 상태를 확인하지 못했습니다(?: \((.+)\))?$/u,
    en: "Could not verify cleanup of the previous edit left in the browser.$1",
    ja: "ブラウザーに残った以前の編集の整理状態を確認できませんでした。$1"
  },
  {
    source: /^“(.+)”을 브라우저에서 삭제할까요\?$/u,
    en: "Delete “$1” from this browser?",
    ja: "「$1」をこのブラウザーから削除しますか？"
  },
  {
    source: /^컷 ([0-9,.]+)개 · 자막 ([0-9,.]+)개 · 복구본 ([0-9,.]+)개를 이 브라우저에서 삭제합니다\.$/u,
    en: "This deletes $1 clips, $2 captions, and $3 recovery snapshots from this browser.",
    ja: "このブラウザーからクリップ$1件、字幕$2件、復元データ$3件を削除します。"
  },
  {
    source: /^프로젝트 ([0-9,.]+)개와 표시된 복구본 ([0-9,.]+)개 및 연결된 브라우저 데이터를 모두 삭제합니다\.$/u,
    en: "This deletes all $1 projects, $2 listed recovery snapshots, and associated browser data.",
    ja: "プロジェクト$1件、表示中の復元データ$2件、および関連するブラウザーデータをすべて削除します。"
  },
  {
    source: /^(.+)의 브라우저 저장 데이터를 삭제했습니다\.$/u,
    en: "Deleted browser-saved data for $1.",
    ja: "$1のブラウザー保存データを削除しました。"
  },
  {
    source: /^시작을 ([0-9:.]+)로 기록했습니다\.$/u,
    en: "Set the In point to $1.",
    ja: "開始点を$1に設定しました。"
  },
  {
    source: /^끝을 ([0-9:.]+)로 기록했습니다\.$/u,
    en: "Set the Out point to $1.",
    ja: "終了点を$1に設定しました。"
  },
  {
    source: /^YouTube 플레이어를 ([0-9:.]+)로 이동했습니다\.$/u,
    en: "Moved the YouTube player to $1.",
    ja: "YouTubeプレーヤーを$1へ移動しました。"
  },
  {
    source: /^원본 영상을 ([0-9:.]+)로 이동했고 컷 시각도 일치합니다\.$/u,
    en: "Moved the source video to $1; the cut timecode is aligned.",
    ja: "元動画を$1へ移動し、カットのタイムコードも一致しました。"
  },
  {
    source: /^YouTube 재생 속도를 ([0-9.]+)배로 바꿨습니다\.$/u,
    en: "Changed YouTube playback to $1×.",
    ja: "YouTubeの再生速度を$1倍に変更しました。"
  },
  {
    source: /^원본 영상과 컷 시계를 함께 ([0-9.]+)배속으로 바꿨습니다\.$/u,
    en: "Changed the source video and cut clock together to $1×.",
    ja: "元動画とカットの時計を同時に$1倍速へ変更しました。"
  },
  {
    source: /^재생 속도를 ([0-9.]+)배로 바꿨습니다\.$/u,
    en: "Changed playback to $1×.",
    ja: "再生速度を$1倍に変更しました。"
  },
  {
    source: /^원본 영상과 컷 시각을 ([0-9:.]+)로 맞췄습니다\.$/u,
    en: "Aligned the source video and cut timecode at $1.",
    ja: "元動画とカットのタイムコードを$1に合わせました。"
  },
  {
    source: /^백업 파일을 불러오지 못했습니다: (.+)$/u,
    en: "Could not import the backup file: $1",
    ja: "バックアップファイルを読み込めませんでした：$1"
  },
  {
    source: /^(.+)은 0 이상의 유한한 숫자여야 합니다\.$/u,
    en: "$1 must be a finite number greater than or equal to zero.",
    ja: "$1は0以上の有限数である必要があります。"
  },
  {
    source: /^원본 HLS 재생 실패: (.+)$/u,
    en: "Source HLS playback failed: $1",
    ja: "元HLSの再生に失敗しました：$1"
  },
  {
    source: /^(.+) 형식이 올바르지 않습니다\.$/u,
    en: "$1 has an invalid format.",
    ja: "$1の形式が無効です。"
  },
  {
    source: /^(.+)은 0 이상의 안전한 정수 밀리초여야 합니다\.$/u,
    en: "$1 must be a safe integer number of milliseconds greater than or equal to zero.",
    ja: "$1は0以上の安全な整数ミリ秒である必要があります。"
  },
  {
    source: /^백업할 컷은 1~([0-9,.]+)개여야 합니다\.$/u,
    en: "The backup must contain between 1 and $1 cuts.",
    ja: "バックアップするカット数は1〜$1件にしてください。"
  },
  {
    source: /^([0-9]+)번 컷 시각이 올바르지 않습니다\.$/u,
    en: "Cut $1 has invalid timecodes.",
    ja: "カット$1のタイムコードが無効です。"
  },
  {
    source: /^([0-9]+)번 컷 시각이 안전한 밀리초 범위를 넘었습니다\.$/u,
    en: "Cut $1 exceeds the safe millisecond range.",
    ja: "カット$1の時刻が安全なミリ秒範囲を超えています。"
  },
  {
    source: /^([0-9]+)번 컷은 0\.1초 이상이어야 합니다\.$/u,
    en: "Cut $1 must be at least 0.1 seconds long.",
    ja: "カット$1は0.1秒以上必要です。"
  },
  {
    source: /^([0-9]+)번 컷 메모는 160자 이하여야 합니다\.$/u,
    en: "The note for cut $1 must be 160 characters or fewer.",
    ja: "カット$1のメモは160文字以内にしてください。"
  },
  {
    source: /^복원 JSON의 컷은 1~([0-9,.]+)개여야 합니다\.$/u,
    en: "The restore JSON must contain between 1 and $1 cuts.",
    ja: "復元JSONのカット数は1〜$1件にしてください。"
  },
  {
    source: /^([0-9]+)번 컷의 출력 여부가 올바르지 않습니다\.$/u,
    en: "Cut $1 has an invalid output setting.",
    ja: "カット$1の出力設定が無効です。"
  },
  {
    source: /^([0-9]+)번 컷의 쇼츠 캔버스 표식이 올바르지 않습니다\.$/u,
    en: "Cut $1 has an invalid Shorts-canvas marker.",
    ja: "カット$1のショート動画キャンバスマーカーが無効です。"
  },
  {
    source: /^([0-9]+)번 컷 시작 시각$/u,
    en: "Cut $1 start time",
    ja: "カット$1の開始時刻"
  },
  {
    source: /^([0-9]+)번 컷 끝 시각$/u,
    en: "Cut $1 end time",
    ja: "カット$1の終了時刻"
  },
  {
    source: /^([0-9]+)번 컷이 복원 과정에서 달라져 안전하게 불러올 수 없습니다\.$/u,
    en: "Cut $1 changed during restoration and cannot be imported safely.",
    ja: "カット$1が復元中に変化したため、安全に読み込めません。"
  },
  {
    source: /^라이브 지연 ([0-9.]+)초$/u,
    en: "Live latency $1 sec",
    ja: "ライブ遅延 $1秒"
  },
] as const satisfies readonly UiCopyPattern[];
