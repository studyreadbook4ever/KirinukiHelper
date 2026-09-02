import type {
  UiCopyCatalog,
  UiCopyPattern
} from "../lib/ui-localization.js";

/**
 * Runtime copy emitted by the editor bundle.
 *
 * Keep keys byte-for-byte aligned with the Korean source. User-authored text,
 * filenames, protocol identifiers, shortcuts, and timecodes intentionally do
 * not belong in this catalog. Dynamic copy is handled only by the narrowly
 * anchored patterns at the end of this file.
 */
export const EDITOR_RUNTIME_UI_COPY = {
  "이 기기의 저장 공간을 안전하게 확인하지 못했습니다. 저장 장치를 확인한 뒤 다시 시도해 주세요.": {
    en: "Kirinuki could not safely check this device's free space. Check the drive and try again.",
    ja: "このデバイスの空き容量を安全に確認できませんでした。ドライブを確認して、もう一度お試しください。"
  },
  "VOD 구간을 안전하게 준비할 저장 공간이 부족합니다. 여유 공간을 확보한 뒤 다시 시도해 주세요.": {
    en: "There is not enough free space to prepare the selected VOD clips safely. Free up space and try again.",
    ja: "選択した VOD クリップを安全に準備するための空き容量が不足しています。空き容量を確保して、もう一度お試しください。"
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
  "저장 파일:": {
    en: "Saved files:",
    ja: "保存ファイル:"
  },
  ".(영상 형식) ·": {
    en: ".(video format) ·",
    ja: ".（動画形式） ·"
  },
  "· 자막이 있으면 같은 이름의 SRT (중복 이름은 번호를 붙여 보존)": {
    en: "· Captions are saved as an SRT with the same name (numbered if the name already exists)",
    ja: "· 字幕がある場合は同名の SRT として保存（同名ファイルは番号を付けて保持）"
  },
  "와 편집 복원 파일": {
    en: " and edit-recovery file",
    ja: "と編集復元ファイル"
  },
  "·자막 파일": {
    en: " and caption file",
    ja: "・字幕ファイル"
  },
  "이 제대로 저장됐는지 확인했습니다.": {
    en: " were saved correctly.",
    ja: "が正しく保存されたことを確認しました。"
  },
  "작업 중 오류가 발생했습니다. 다시 시도해 주세요.": {
    en: "Something went wrong. Try again.",
    ja: "処理中にエラーが発生しました。もう一度お試しください。"
  },
  "저장된 자막 위치가 가장 많이 쓰인 값과 다릅니다. 오류로 확정된 것은 아닙니다.": {
    en: "The saved caption position differs from the most-used value. This does not necessarily indicate an error.",
    ja: "保存済みの字幕位置が最も多く使われている値と異なります。エラーと確定したわけではありません。"
  },
  "설정 크기가 가장 많이 쓰인 값과 다릅니다. 오류로 확정된 것은 아닙니다.": {
    en: "The configured size differs from the most-used value. This does not necessarily indicate an error.",
    ja: "設定サイズが最も多く使われている値と異なります。エラーと確定したわけではありません。"
  },
  "글자색이 가장 많이 쓰인 값과 다릅니다. 오류로 확정된 것은 아닙니다.": {
    en: "The text color differs from the most-used value. This does not necessarily indicate an error.",
    ja: "文字色が最も多く使われている値と異なります。エラーと確定したわけではありません。"
  },
  "검은 상자가 가장 많이 쓰인 값과 다릅니다. 오류로 확정된 것은 아닙니다.": {
    en: "The black-box setting differs from the most-used value. This does not necessarily indicate an error.",
    ja: "黒いボックスの設定が最も多く使われている値と異なります。エラーと確定したわけではありません。"
  },
  "진행 중인 편집·저장·내보내기 작업이 끝난 뒤 작업을 끝내 주세요.": {
    en: "Finish the active edit, save, or export operation before ending the session.",
    ja: "進行中の編集・保存・書き出し処理が完了してから、作業を終了してください。"
  },
  "쇼츠 미리보기·화면 조정 작업이 끝난 뒤 작업을 끝내 주세요.": {
    en: "Finish the Shorts preview or framing adjustment before ending the session.",
    ja: "ショート動画のプレビュー・画面調整が完了してから、作業を終了してください。"
  },
  "VOD 편집 영상 준비 작업이 끝난 뒤 작업을 끝내 주세요.": {
    en: "Finish preparing the VOD editing media before ending the session.",
    ja: "VOD 編集用メディアの準備が完了してから、作業を終了してください。"
  },
  "열려 있는 내보내기·세션 정리 확인창이 끝난 뒤 작업을 끝내 주세요.": {
    en: "Close the export or session-cleanup confirmation before ending the session.",
    ja: "開いている書き出し・セッション整理の確認画面を閉じてから、作業を終了してください。"
  },
  "진행 중인 편집·저장·내보내기 작업이 끝난 뒤 다시 선택해 주세요.": {
    en: "Wait for the active edit, save, or export operation to finish, then choose again.",
    ja: "進行中の編集・保存・書き出し処理が完了してから、もう一度選択してください。"
  },
  "쇼츠 미리보기·화면 조정 작업이 끝난 뒤 다시 선택해 주세요.": {
    en: "Wait for the Shorts preview or framing adjustment to finish, then choose again.",
    ja: "ショート動画のプレビュー・画面調整が完了してから、もう一度選択してください。"
  },
  "VOD 편집 영상 준비 작업이 끝난 뒤 다시 선택해 주세요.": {
    en: "Wait for the VOD editing media to finish preparing, then choose again.",
    ja: "VOD 編集用メディアの準備が完了してから、もう一度選択してください。"
  },
  "열려 있는 내보내기·세션 정리 확인창이 끝난 뒤 다시 선택해 주세요.": {
    en: "Close the export or session-cleanup confirmation, then choose again.",
    ja: "開いている書き出し・セッション整理の確認画面を閉じてから、もう一度選択してください。"
  },
  "· 5분 간격": {
    en: "· every 5 minutes",
    ja: "· 5 分間隔"
  },
  "· 탭 종료 시 임시본 폐기": {
    en: "· temporary copies discarded when the tab closes",
    ja: "· タブ終了時に一時データを破棄"
  },
  "내보낸 영상과 편집 복원 파일은 그대로 보존했습니다.": {
    en: "The exported video and edit-recovery file were preserved.",
    ja: "書き出した動画と編集復元ファイルは保持しました。"
  },
  "내보낸 영상과 편집 복원 파일은 그대로 보존했고,": {
    en: "The exported video and edit-recovery file were preserved.",
    ja: "書き出した動画と編集復元ファイルは保持しました。"
  },
  "만 삭제했습니다.": {
    en: " were deleted.",
    ja: "のみ削除しました。"
  },
  "을 삭제했습니다.": {
    en: " were deleted.",
    ja: "を削除しました。"
  },
  "남은 연결 정보는 브라우저를 닫을 때 다시 정리합니다:": {
    en: "Remaining connection data will be cleaned up when the browser closes:",
    ja: "残っている接続情報はブラウザーを閉じる際に再整理します:"
  },
  "로컬 연결 정리는 다음 영상 준비 도구 시작 때 다시 시도됩니다:": {
    en: "Local connection cleanup will be retried the next time the media helper starts:",
    ja: "ローカル接続の整理は、次回動画準備ヘルパーを起動した際に再試行します:"
  },
  // Preview, export verification, and completed-session recovery failures.
  "쇼츠 원본 음성 미리보기를 읽지 못했습니다.": {
    en: "Could not load the source-audio preview for Shorts.",
    ja: "ショート動画の元音声プレビューを読み込めませんでした。"
  },
  "쇼츠 대체 미리보기 캔버스를 준비하지 못했습니다.": {
    en: "Could not prepare the fallback Shorts preview canvas.",
    ja: "ショート動画の代替プレビュー用キャンバスを準備できませんでした。"
  },
  "현재 시점의 쇼츠 미리보기 영상이 아직 준비되지 않았습니다.": {
    en: "The Shorts preview at the current playhead is not ready yet.",
    ja: "現在位置のショート動画プレビューはまだ準備できていません。"
  },
  "로컬 쇼츠 영상을 제한 시간 안에 디코딩하지 못했습니다. 미리보기를 다시 만들어 주세요.": {
    en: "Could not decode the local Shorts video in time. Rebuild the preview.",
    ja: "ローカルのショート動画を時間内にデコードできませんでした。プレビューを作り直してください。"
  },
  "쇼츠 재생 준비가 취소되었습니다.": {
    en: "Shorts playback preparation was canceled.",
    ja: "ショート動画の再生準備をキャンセルしました。"
  },
  "백업 파일의 VOD 원본 주소와 이 기기에 준비된 영상 기록이 일치하지 않습니다.": {
    en: "The source VOD URL in the backup does not match the media prepared on this device.",
    ja: "バックアップ内の元 VOD URL が、このデバイスで準備済みの動画記録と一致しません。"
  },
  "내보낸 세션 복원 JSON 파일 핸들이 없습니다.": {
    en: "The exported session-recovery JSON file handle is missing.",
    ja: "書き出したセッション復元 JSON のファイルハンドルがありません。"
  },
  "내보낸 sidecar 파일명이 중복되어 전체 묶음을 검증할 수 없습니다.": {
    en: "Duplicate exported sidecar filenames prevent verification of the complete set.",
    ja: "書き出したサイドカーファイルの名前が重複しているため、ファイル一式を検証できません。"
  },
  "내보낸 묶음에는 세션 복원 JSON이 정확히 하나 있어야 합니다.": {
    en: "The exported set must contain exactly one session-recovery JSON file.",
    ja: "書き出したファイル一式には、セッション復元 JSON が 1 つだけ必要です。"
  },
  "같은 이름의 내보내기가 너무 많습니다. 출력 영상 제목을 바꿔 주세요.": {
    en: "Too many exports use the same name. Change the output title.",
    ja: "同名の書き出しが多すぎます。出力動画のタイトルを変更してください。"
  },
  "저장된 영상 파일이 비어 있습니다.": {
    en: "The saved video file is empty.",
    ja: "保存された動画ファイルが空です。"
  },
  "저장된 파일의 영상 트랙과 재생 길이를 확인하지 못했습니다.": {
    en: "Could not verify the video track and duration of the saved file.",
    ja: "保存されたファイルの映像トラックと再生時間を確認できませんでした。"
  },
  "편집본에 필요한 음성 트랙이 저장된 영상에서 누락됐습니다.": {
    en: "The saved video is missing the audio track required by the edit.",
    ja: "保存された動画に、編集内容で必要な音声トラックがありません。"
  },
  "저장된 영상 파일이 검증 중 변경되어 임시 파일을 유지합니다.": {
    en: "The saved video changed during verification, so the temporary file was kept.",
    ja: "検証中に保存動画が変更されたため、一時ファイルを保持します。"
  },
  "세션 정리 저장을 시작하지 못했습니다.": {
    en: "Could not start saving the session cleanup state.",
    ja: "セッション整理状態の保存を開始できませんでした。"
  },
  "이전 종료가 이 세션의 VOD 작업 재료 정리 도중 발생했습니다. 원본 연결을 검증하고 필요하면 세션 전용 재료를 다시 준비합니다.": {
    en: "The previous shutdown occurred while this session's VOD working files were being cleaned up. Kirinuki will verify the source connection and rebuild session-only media if needed.",
    ja: "前回は、このセッションの VOD 作業ファイルを整理中に終了しました。元動画の接続を確認し、必要に応じてセッション専用メディアを再準備します。"
  },
  "이전 세션 정리 표식이 현재 VOD 작업 범위와 정확히 일치하지 않아 아무 파일도 지우지 않았습니다. 현재 원본 연결을 다시 검증합니다.": {
    en: "The previous cleanup marker did not exactly match the current VOD workspace, so no files were deleted. Kirinuki will verify the current source connection again.",
    ja: "前回の整理マーカーが現在の VOD 作業範囲と完全には一致しなかったため、ファイルは削除していません。現在の元動画接続を再確認します。"
  },
  "이전 종료 전에 이 세션의 VOD 작업 재료 삭제가 끝난 것을 확인해 브라우저 편집 세션 정리도 마무리했습니다.": {
    en: "Kirinuki confirmed that this session's VOD working files were deleted before the previous shutdown and finished cleaning up the browser editing session.",
    ja: "前回の終了前にこのセッションの VOD 作業ファイルが削除済みであることを確認し、ブラウザーの編集セッション整理も完了しました。"
  },
  "현재 연결된 편집용 VOD의 정확한 준비 기록을 확인하지 못해 영상을 삭제하지 않았습니다.": {
    en: "The exact preparation record for the connected editing VOD could not be verified, so the video was not deleted.",
    ja: "接続中の編集用 VOD の正確な準備記録を確認できなかったため、動画は削除していません。"
  },
  "현재 Kirinuki 내부 미디어 엔진의 접근 정보가 없어 이번 편집용 VOD를 삭제하지 않았습니다.": {
    en: "The current Kirinuki media-engine credentials are unavailable, so this editing VOD was not deleted.",
    ja: "現在の Kirinuki 内部メディアエンジンへの接続情報がないため、今回の編集用 VOD は削除していません。"
  },
  "저장을 마친 뒤 VOD 준비 기록을 유지하지 못했습니다.": {
    en: "Could not retain the VOD preparation record after saving.",
    ja: "保存後に VOD の準備記録を維持できませんでした。"
  },
  "브라우저의 원본 연결 세션을 확인하지 못했습니다.": {
    en: "Could not verify the browser's source-connection session.",
    ja: "ブラウザーの元動画接続セッションを確認できませんでした。"
  },
  // Shared media-helper copy can surface from either the cut page or editor.
  "진행 중인 영상 작업이 끝난 뒤 쇼츠 요소를 조정해 주세요.": {
    en: "Wait for the active media job to finish before adjusting Shorts elements.",
    ja: "進行中のメディア処理が完了してから、ショート動画の要素を調整してください。"
  },
  "이 위치를 쇼츠 소스 시작점으로": {
    en: "Set Shorts Source In Here",
    ja: "ここをショート動画のソースイン点に設定"
  },
  "이 위치를 쇼츠 소스 끝점으로": {
    en: "Set Shorts Source Out Here",
    ja: "ここをショート動画のソースアウト点に設定"
  },
  "영상 준비": {
    en: "Media preparation",
    ja: "動画の準備"
  },
  "설치된 영상 준비 도구의 응답 크기가 올바르지 않습니다.": {
    en: "The installed media helper returned an invalid response size.",
    ja: "インストール済みの動画準備ヘルパーから無効なサイズの応答が返されました。"
  },
  "설치된 영상 준비 도구의 응답이 허용 크기를 넘었습니다.": {
    en: "The installed media helper's response exceeded the allowed size.",
    ja: "インストール済みの動画準備ヘルパーの応答が許容サイズを超えました。"
  },
  "설치된 영상 준비 도구의 응답 문자가 올바르지 않습니다.": {
    en: "The installed media helper's response contains invalid characters.",
    ja: "インストール済みの動画準備ヘルパーの応答に無効な文字が含まれています。"
  },
  "Kirinuki 엔진 연결 응답이 만료됐거나 지원 version보다 오래됐습니다.": {
    en: "The Kirinuki engine connection response has expired or is older than the supported version.",
    ja: "Kirinukiエンジンの接続応答が期限切れか、対応バージョンより古くなっています。"
  },
  "Kirinuki 엔진 연결 응답의 설치 identity 서명이 올바르지 않습니다.": {
    en: "The installation identity signature in the Kirinuki engine response is invalid.",
    ja: "Kirinukiエンジン接続応答のインストールID署名が無効です。"
  },
  "이 브라우저가 이전에 연결한 영상 준비 도우미와 현재 도우미의 identity가 다릅니다. 자동 교체하지 않았습니다. 설치를 확인한 뒤 ‘연결 기억 지우기’를 명시적으로 선택해 주세요.": {
    en: "This helper has a different identity from the one previously connected to this browser. It was not replaced automatically. Verify the installation, then explicitly select ‘Forget helper connection’.",
    ja: "現在のヘルパーは、このブラウザーが以前接続したヘルパーとIDが異なります。自動では置き換えていません。インストールを確認し、「接続情報を消去」を明示的に選択してください。"
  },
  "Kirinuki 엔진 연결 제한 시간이 올바르지 않습니다.": {
    en: "The Kirinuki engine connection timeout is invalid.",
    ja: "Kirinukiエンジンの接続タイムアウトが無効です。"
  },
  "Kirinuki 엔진 pairing poll 응답이 JSON이 아닙니다.": {
    en: "The Kirinuki engine pairing-poll response is not JSON.",
    ja: "Kirinukiエンジンのペアリング確認応答がJSONではありません。"
  },
  "Kirinuki 엔진 pairing 대기 응답이 올바르지 않습니다.": {
    en: "The Kirinuki engine pairing-pending response is invalid.",
    ja: "Kirinukiエンジンのペアリング待機応答が無効です。"
  },
  "Kirinuki 엔진 pairing 응답이 현재 요청과 다릅니다.": {
    en: "The Kirinuki engine pairing response does not match the current request.",
    ja: "Kirinukiエンジンのペアリング応答が現在のリクエストと一致しません。"
  },
  "로컬 영상 준비 도구 확인 제한 시간이 올바르지 않습니다.": {
    en: "The local media-helper check timeout is invalid.",
    ja: "ローカル動画準備ヘルパーの確認タイムアウトが無効です。"
  },
  "이 브라우저의 Kirinuki 엔진 identity 저장소를 읽지 못했습니다.": {
    en: "Could not read the Kirinuki engine identity stored in this browser.",
    ja: "このブラウザーに保存されたKirinukiエンジンIDを読み込めませんでした。"
  },
  "현재 도우미의 응답은 이 브라우저에 기억된 도우미 identity와 다릅니다. 연결 정보를 자동 교체하지 않았습니다.": {
    en: "The current helper's response has a different identity from the helper remembered by this browser. Connection data was not replaced automatically.",
    ja: "現在のヘルパー応答は、このブラウザーに記憶されたヘルパーIDと異なります。接続情報は自動更新していません。"
  },
  "현재 영상 준비 도우미의 응답에서 기억된 도우미의 서명을 확인하지 못했습니다.": {
    en: "The remembered helper signature could not be verified in the current media helper response.",
    ja: "現在の動画準備ヘルパー応答で、記憶済みヘルパーの署名を確認できませんでした。"
  },
  "macOS 시스템 설정의 일반 > 로그인 항목에서 Kirinuki 백그라운드 실행을 한 번 허용해 주세요. 허용되면 자동으로 이어집니다.": {
    en: "In macOS System Settings, open General > Login Items and allow Kirinuki to run in the background once. Setup will continue automatically.",
    ja: "macOSのシステム設定で「一般」>「ログイン項目」を開き、Kirinukiのバックグラウンド実行を一度許可してください。許可後は自動で続行します。"
  },
  "설치된 영상 준비 도구가 현재 안전 기준과 맞지 않거나 손상됐습니다. 아래 공식 서명 설치 파일을 실행한 뒤 ‘이 PC 연결’을 한 번 눌러 주세요.": {
    en: "The installed media helper does not meet current security requirements or is damaged. Run the officially signed installer below, then select ‘Connect this PC’ once.",
    ja: "インストール済みの動画準備ヘルパーが現在の安全基準に適合していないか、破損しています。下の公式署名済みインストーラーを実行し、「このPCに接続」を一度押してください。"
  },
  "확인 중 로컬 엔진 identity가 바뀌었습니다. 연결 정보를 자동 교체하지 않았습니다.": {
    en: "The local engine identity changed during verification. Connection data was not replaced automatically.",
    ja: "確認中にローカルエンジンIDが変わりました。接続情報は自動更新していません。"
  },
  "설치된 로컬 엔진 version이 이 브라우저의 신뢰 기록과 맞지 않습니다.": {
    en: "The installed local engine version does not match this browser's trust record.",
    ja: "インストール済みローカルエンジンのバージョンが、このブラウザーの信頼記録と一致しません。"
  },
  "Windows 도우미 미리보기 다운로드를 요청했습니다. 다운로드한 exe를 실행하세요. Windows가 앱 보호 화면을 표시하면 ‘추가 정보’에서 실행을 선택할 수 있습니다. 설치가 끝나면 도우미가 자동으로 시작되고 이 화면이 연결을 계속 확인합니다.": {
    en: "The Windows helper preview download has started. Run the downloaded EXE. If Windows shows an app-protection screen, choose to run it under ‘More info’. The helper starts automatically after installation while this screen continues checking the connection.",
    ja: "Windows用ヘルパーのプレビュー版をダウンロードしています。ダウンロードしたEXEを実行してください。Windowsの保護画面が表示された場合は、「詳細情報」から実行できます。インストール後にヘルパーが自動起動し、この画面で接続確認が続きます。"
  },
  "Windows 설치 파일 다운로드를 요청했습니다. 브라우저 다운로드 표시가 완료되면 파일을 실행하세요. 이 화면은 설치된 도우미를 자동으로 확인하고 있습니다.": {
    en: "The Windows installer download has started. Run the file after your browser reports that the download is complete. This screen is automatically checking for the installed helper.",
    ja: "Windowsインストーラーのダウンロードを開始しました。ブラウザーで完了を確認したら、ファイルを実行してください。この画面はインストール済みヘルパーを自動確認しています。"
  },
  "macOS 설치 파일 다운로드를 요청했습니다. 완료된 DMG를 열어 Kirinuki를 응용 프로그램에 넣고 한 번 실행하세요. 이 화면은 도우미 연결을 자동으로 확인하고 있습니다.": {
    en: "The macOS installer download has started. Open the downloaded DMG, move Kirinuki to Applications, and launch it once. This screen is automatically checking the helper connection.",
    ja: "macOSインストーラーのダウンロードを開始しました。ダウンロードしたDMGを開き、Kirinukiをアプリケーションに移して一度起動してください。この画面はヘルパー接続を自動確認しています。"
  },
  "Debian/Ubuntu용 다운로드를 요청했습니다. 다운로드가 끝나면 deb를 설치하고 도우미를 한 번 실행한 뒤 이 화면의 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.": {
    en: "The Debian/Ubuntu download has started. Install the DEB, launch the helper once, then select ‘Check connection after installation’ on this screen. A running helper is detected automatically.",
    ja: "Debian/Ubuntu用ファイルのダウンロードを開始しました。DEBをインストールし、ヘルパーを一度起動してから、この画面の「インストール後に接続を確認」を押してください。実行中のヘルパーは自動検出されます。"
  },
  "Debian/Ubuntu용 도우미 다운로드를 요청했습니다. 다운로드가 끝나면 deb를 설치하고 도우미를 한 번 실행한 뒤 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.": {
    en: "The Debian/Ubuntu helper download has started. Install the DEB, launch the helper once, then select ‘Check connection after installation’. A running helper is detected automatically.",
    ja: "Debian/Ubuntu用ヘルパーのダウンロードを開始しました。DEBをインストールし、ヘルパーを一度起動してから「インストール後に接続を確認」を押してください。実行中のヘルパーは自動検出されます。"
  },
  "Arch Linux용 도우미 다운로드를 요청했습니다. 다운로드가 끝나면 pacman으로 패키지를 설치하고 도우미를 한 번 실행한 뒤 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.": {
    en: "The Arch Linux helper download has started. Install the package with pacman, launch the helper once, then select ‘Check connection after installation’. A running helper is detected automatically.",
    ja: "Arch Linux用ヘルパーのダウンロードを開始しました。pacmanでパッケージをインストールし、ヘルパーを一度起動してから「インストール後に接続を確認」を押してください。実行中のヘルパーは自動検出されます。"
  },
  "도우미는 실행 중이지만 연결 프로그램이 이어지지 않으면 터미널에서 `xdg-mime default kr.eff0rtchung.kirinuki.desktop x-scheme-handler/kirinuki-engine`를 한 번 실행한 뒤 다시 확인해 주세요.": {
    en: "If the helper is running but the protocol handler does not open, run `xdg-mime default kr.eff0rtchung.kirinuki.desktop x-scheme-handler/kirinuki-engine` once in a terminal, then check again.",
    ja: "ヘルパーが実行中でもプロトコルハンドラーが開かない場合は、ターミナルで `xdg-mime default kr.eff0rtchung.kirinuki.desktop x-scheme-handler/kirinuki-engine` を一度実行してから再確認してください。"
  },
  "그래도 연결되지 않으면 터미널에서 `xdg-mime query default x-scheme-handler/kirinuki-engine`로 현재 연결 프로그램만 확인해 주세요.": {
    en: "If it still does not connect, run `xdg-mime query default x-scheme-handler/kirinuki-engine` in a terminal to check the current protocol handler.",
    ja: "それでも接続できない場合は、ターミナルで `xdg-mime query default x-scheme-handler/kirinuki-engine` を実行し、現在のプロトコルハンドラーを確認してください。"
  },
  "허용": {
    en: "Allowed",
    ja: "許可"
  },
  // Editor entry, policy, and session lifecycle.
  "현재 공개 설치판은 Whisper를 제공하지 않습니다. AudSeg 또는 자막 작업 프롬프트를 사용해 주세요.": {
    en: "The current public build does not include Whisper. Use AudSeg or the caption-work prompt instead.",
    ja: "現在の公開ビルドには Whisper は含まれていません。代わりに AudSeg または字幕作業プロンプトを使用してください。"
  },
  "설치 안내가 보이면 이 PC용 영상 준비 도구를 한 번 설치한 뒤 같은 버튼을 다시 눌러 주세요.": {
    en: "If an installation prompt appears, install the video-preparation helper for this PC once, then press the same button again.",
    ja: "インストール案内が表示された場合は、この PC 用の動画準備ヘルパーを一度インストールしてから、同じボタンをもう一度押してください。"
  },
  "편집기 필수 UI 요소 타입이 올바르지 않습니다.": {
    en: "A required editor UI element has an invalid type.",
    ja: "エディターに必要な UI 要素の型が正しくありません。"
  },
  "편집기 정책 세션 응답 형식이 올바르지 않습니다.": {
    en: "The editor policy-session response has an invalid format.",
    ja: "エディターのポリシーセッション応答の形式が正しくありません。"
  },
  "편집 세션 활성 상태를 확인하지 못했습니다.": {
    en: "Could not verify whether the editing session is active.",
    ja: "編集セッションが有効か確認できませんでした。"
  },
  "편집 세션 활성 상태가 올바르지 않습니다.": {
    en: "The editing-session activity state is invalid.",
    ja: "編集セッションの有効状態が正しくありません。"
  },
  "다른 편집 작업으로 전환되어 이전 화면을 종료합니다.": {
    en: "Another edit is now active, so this previous editor will close.",
    ja: "別の編集作業に切り替わったため、以前の編集画面を終了します。"
  },
  "편집 세션 활성 상태를 이번 주기에 갱신하지 못했습니다.": {
    en: "Could not refresh the editing-session activity state this cycle.",
    ja: "今回の周期では編集セッションの有効状態を更新できませんでした。"
  },
  "사용자 진술을 기록한 상태이며 Kirinuki의 법률·권리 검증이나 게시 승인을 뜻하지 않습니다.": {
    en: "This records your declaration only; it is not legal or rights verification, nor publication approval by Kirinuki.",
    ja: "これはユーザーの申告を記録したものであり、Kirinuki による法的確認・権利確認・公開承認を意味しません。"
  },
  "직접 편집기 URL로는 시작할 수 없습니다. 시작 화면에서 이번 사용 정책을 입력해 주세요.": {
    en: "The editor cannot be opened from its URL directly. Enter the usage policy for this session on the start screen.",
    ja: "エディターの URL から直接開始することはできません。開始画面で今回の利用ポリシーを入力してください。"
  },
  "이 탭에서 이번 사용 확인을 찾지 못했습니다. 저장 구간은 유지됩니다. 시작 화면에서 편집기를 다시 열어 주세요.": {
    en: "This tab has no usage confirmation for the current session. Your saved ranges are intact. Reopen the editor from the start screen.",
    ja: "このタブでは今回の利用確認が見つかりません。保存した範囲は維持されています。開始画面からエディターを開き直してください。"
  },
  "편집기 정책 세션이 현재 프로젝트 또는 열기 목적과 일치하지 않습니다. 시작 화면에서 다시 입력해 주세요.": {
    en: "The editor policy session does not match this project or the way it was opened. Enter it again on the start screen.",
    ja: "エディターのポリシーセッションが現在のプロジェクトまたは起動目的と一致しません。開始画面で再入力してください。"
  },
  "편집 작업을 시작한 탭과 현재 탭의 실행 상태가 달라 결과를 적용하지 않았습니다.": {
    en: "The current tab no longer matches the tab that started this edit, so the result was not applied.",
    ja: "編集を開始したタブと現在のタブの実行状態が異なるため、結果を適用しませんでした。"
  },
  "저장본을 불러오려면 시작 화면의 최근 편집에서 ‘저장본’을 선택하고 이번 사용 정책을 다시 입력해 주세요.": {
    en: "To load a saved version, choose “Saved version” under Recent edits on the start screen and enter the usage policy again.",
    ja: "保存版を読み込むには、開始画面の最近の編集から「保存版」を選び、今回の利用ポリシーを再入力してください。"
  },
  "이번 편집의 시작 상태를 확인하지 못했습니다.": {
    en: "Could not verify the starting state of this edit.",
    ja: "今回の編集の開始状態を確認できませんでした。"
  },
  "이번 편집의 시작 상태를 확인하지 못해 작업을 끝낼 수 없습니다. 현재 탭을 닫고 시작 화면에서 다시 열어 주세요.": {
    en: "This edit cannot be finished because its starting state could not be verified. Close this tab and reopen it from the start screen.",
    ja: "編集の開始状態を確認できないため、作業を完了できません。このタブを閉じ、開始画面から開き直してください。"
  },
  "브라우저가 이번 편집의 완료 상태를 확인하지 못했습니다.": {
    en: "The browser could not verify that this edit was completed.",
    ja: "ブラウザーで今回の編集の完了状態を確認できませんでした。"
  },
  "편집 종료 뒤 앱 내부 연결 정리를 확인하지 못했습니다.": {
    en: "Could not verify cleanup of the app connection after closing the editor.",
    ja: "編集終了後のアプリ内接続のクリーンアップを確認できませんでした。"
  },
  "현재 편집을 이 기기에 확정하는 중…": {
    en: "Committing the current edit on this device…",
    ja: "現在の編集をこのデバイスに確定しています…"
  },
  "이번 편집의 변경을 버리고 열기 전 상태로 되돌리는 중…": {
    en: "Discarding this edit and restoring the state from before it was opened…",
    ja: "今回の変更を破棄し、開く前の状態に戻しています…"
  },
  "확정할 현재 편집 상태를 저장하지 못했습니다.": {
    en: "Could not save the current edit before committing it.",
    ja: "確定する現在の編集状態を保存できませんでした。"
  },
  "현재 편집 체크포인트가 달라 저장을 확정하지 않았습니다.": {
    en: "The current edit checkpoint has changed, so the save was not committed.",
    ja: "現在の編集チェックポイントが異なるため、保存を確定しませんでした。"
  },
  "현재 편집 체크포인트가 달라 변경을 폐기하지 않았습니다.": {
    en: "The current edit checkpoint has changed, so the changes were not discarded.",
    ja: "現在の編集チェックポイントが異なるため、変更を破棄しませんでした。"
  },
  "저장을 확정했습니다. 시작 화면으로 돌아갑니다…": {
    en: "Save committed. Returning to the start screen…",
    ja: "保存を確定しました。開始画面に戻ります…"
  },
  "이번 변경을 폐기했습니다. 시작 화면으로 돌아갑니다…": {
    en: "Changes discarded. Returning to the start screen…",
    ja: "今回の変更を破棄しました。開始画面に戻ります…"
  },
  "편집 체크포인트를 정리한 뒤 화면 이동에 실패했습니다.": {
    en: "Navigation failed after the edit checkpoint was cleaned up.",
    ja: "編集チェックポイントの整理後に画面を移動できませんでした。"
  },
  "진행 중인 편집·저장·내보내기 작업": {
    en: "an edit, save, or export in progress",
    ja: "進行中の編集・保存・書き出し処理"
  },
  "쇼츠 미리보기·화면 조정 작업": {
    en: "a Short preview or framing operation",
    ja: "ショートのプレビューまたは画面調整処理"
  },
  "VOD 편집 영상 준비 작업": {
    en: "VOD editing-media preparation",
    ja: "VOD 編集用動画の準備処理"
  },
  "열려 있는 내보내기·세션 정리 확인창": {
    en: "an open export or session-cleanup confirmation",
    ja: "開いている書き出しまたはセッション整理の確認画面"
  },
  "쇼츠 로컬 미리보기 준비 작업": {
    en: "local Short preview preparation",
    ja: "ショートのローカルプレビュー準備処理"
  },
  "재시작용 원본 파일 핸들이 없는 현재 세션": {
    en: "the current session has no source-file handle for restart",
    ja: "再起動用の元ファイルハンドルがない現在のセッション"
  },

  // Save, recovery, and undo.
  "편집 중 임시 복구 실패": {
    en: "Edit recovery failed",
    ja: "編集中の一時復元に失敗"
  },
  "편집 중 임시 복구 중…": {
    en: "Saving edit recovery…",
    ja: "編集中の一時復元データを保存中…"
  },
  "편집 중 임시 복구 준비됨": {
    en: "Edit recovery ready",
    ja: "編集中の一時復元を準備済み"
  },
  "직접 저장": {
    en: "Manual save",
    ja: "手動保存"
  },
  "편집 중 복구": {
    en: "Edit recovery",
    ja: "編集中の復元"
  },
  "불러오기 전 복구": {
    en: "Pre-load recovery",
    ja: "読み込み前の復元"
  },
  "저장": {
    en: "Save",
    ja: "保存"
  },
  "저장할 편집 작업이 없습니다.": {
    en: "There is no edit to save.",
    ja: "保存する編集作業がありません。"
  },
  "현재 상태를 이 기기에 저장했습니다.": {
    en: "The current state was saved on this device.",
    ja: "現在の状態をこのデバイスに保存しました。"
  },
  "진행 중인 편집 작업이 끝난 뒤 다시 눌러 주세요.": {
    en: "Try again after the current editing operation finishes.",
    ja: "進行中の編集処理が完了してから、もう一度押してください。"
  },
  "같은 프로젝트 편집기 탭이 둘 이상 열려 있습니다. 다른 탭을 닫고 다시 눌러 주세요.": {
    en: "This project is open in more than one editor tab. Close the other tab and try again.",
    ja: "同じプロジェクトのエディタータブが複数開いています。ほかのタブを閉じて、もう一度押してください。"
  },
  "모든 자동 생성 자막이 이미 기본 위치에 있습니다.": {
    en: "All auto-generated captions are already in their default positions.",
    ja: "自動生成された字幕はすべて既定の位置にあります。"
  },
  "5분 간격의 편집 중 임시 복구에 실패했습니다.": {
    en: "The five-minute edit-recovery save failed.",
    ja: "5 分間隔の編集中一時復元に失敗しました。"
  },
  "진행 중인 작업이 끝난 뒤 저장본 목록을 열어 주세요.": {
    en: "Open the saved-version list after the current operation finishes.",
    ja: "進行中の処理が完了してから保存版の一覧を開いてください。"
  },
  "다시 열 수 있도록 저장할 현재 프로젝트가 없습니다.": {
    en: "There is no current project to save for reopening.",
    ja: "再度開けるように保存する現在のプロジェクトがありません。"
  },
  "방금 저장한 프로젝트를 다시 확인한 결과가 달라 자동 새로고침을 중단했습니다.": {
    en: "Automatic reload was stopped because the project changed when the new save was verified.",
    ja: "保存直後のプロジェクトを再確認した結果が異なるため、自動再読み込みを中止しました。"
  },
  "코드 변경 직전에 저장한 프로젝트와 다시 불러온 프로젝트가 다릅니다.": {
    en: "The project saved immediately before the code change differs from the reloaded project.",
    ja: "コード変更直前に保存したプロジェクトと再読み込みしたプロジェクトが異なります。"
  },
  "편집 중 복구본을 덮어쓰지 않았으니 저장 목록을 확인해 주세요.": {
    en: "The edit-recovery copy was not overwritten. Check the saved-version list.",
    ja: "編集中の復元データは上書きしていません。保存一覧を確認してください。"
  },
  "다른 영상·불러오기 작업이 끝난 뒤 저장본을 불러와 주세요.": {
    en: "Load the saved version after the other media or loading operation finishes.",
    ja: "ほかの動画処理または読み込み処理が完了してから保存版を読み込んでください。"
  },
  "같은 프로젝트 편집기 탭이 둘 이상 열려 있습니다. 다른 탭을 닫고 다시 불러와 주세요.": {
    en: "This project is open in more than one editor tab. Close the other tab, then load it again.",
    ja: "同じプロジェクトのエディタータブが複数開いています。ほかのタブを閉じてから再度読み込んでください。"
  },
  "선택한 저장본을 찾지 못했습니다.": {
    en: "The selected saved version could not be found.",
    ja: "選択した保存版が見つかりませんでした。"
  },
  "다른 편집 작업의 저장본은 불러올 수 없습니다.": {
    en: "A saved version from another edit cannot be loaded here.",
    ja: "別の編集作業の保存版は読み込めません。"
  },
  "현재 사용자 진술과 원본 회차가 다른 저장본은 불러올 수 없습니다.": {
    en: "A saved version for a different source episode or user declaration cannot be loaded.",
    ja: "現在のユーザー申告または元動画の回が異なる保存版は読み込めません。"
  },
  "이 저장본의 본편·쇼츠 범위가 현재 준비된 편집 영상을 벗어납니다. 필요한 구간을 먼저 더 받은 뒤 다시 불러와 주세요.": {
    en: "This saved version uses main-video or Short ranges outside the prepared media. Prepare the missing ranges, then load it again.",
    ja: "この保存版の本編・ショート範囲は現在準備済みの編集用動画を超えています。必要な範囲を追加で準備してから再度読み込んでください。"
  },
  "이 저장본의 본편·쇼츠 범위가 현재 연결한 파일 길이를 벗어납니다. 같은 원본 파일인지 확인해 주세요.": {
    en: "This saved version uses main-video or Short ranges beyond the connected file. Make sure this is the same source file.",
    ja: "この保存版の本編・ショート範囲は現在接続しているファイルの長さを超えています。同じ元ファイルか確認してください。"
  },
  "저장본을 확인하는 동안 다른 작업이 시작되어 불러오기를 중단했습니다. 다시 시도해 주세요.": {
    en: "Another operation started while the saved version was being checked, so loading was stopped. Try again.",
    ja: "保存版の確認中に別の処理が開始されたため、読み込みを中止しました。もう一度お試しください。"
  },
  "복원 뒤 임시저장 상태를 갱신하지 못했습니다.": {
    en: "Could not refresh the recovery-save state after restoring.",
    ja: "復元後に一時保存の状態を更新できませんでした。"
  },
  "저장본을 불러오고 이전 영상을 분리했습니다. 이 저장본의 VOD 편집 영상을 다시 준비해 주세요.": {
    en: "The saved version was loaded and the previous media was disconnected. Prepare its VOD editing media again.",
    ja: "保存版を読み込み、以前の動画を切り離しました。この保存版の VOD 編集用動画を再度準備してください。"
  },
  "저장본을 불러오고 이전 영상을 분리했습니다. 이 저장본의 원본 파일을 ‘내 파일 직접 연결’에서 다시 선택해 주세요.": {
    en: "The saved version was loaded and the previous media was disconnected. Select its source again under “Connect my file.”",
    ja: "保存版を読み込み、以前の動画を切り離しました。「自分のファイルを直接接続」でこの保存版の元ファイルを再選択してください。"
  },
  "저장본을 불러오고 이전 영상을 분리했습니다. 저장본의 원본 파일 권한을 다시 허용하거나 파일을 직접 연결해 주세요.": {
    en: "The saved version was loaded and the previous media was disconnected. Allow access to its source file again, or connect the file manually.",
    ja: "保存版を読み込み、以前の動画を切り離しました。元ファイルへのアクセスを再許可するか、ファイルを直接接続してください。"
  },
  "저장본을 불러왔습니다. 직전 상태도 자동으로 저장했습니다.": {
    en: "Saved version loaded. The previous state was saved automatically as well.",
    ja: "保存版を読み込みました。直前の状態も自動保存しました。"
  },
  "사용하지 않는 이미지 데이터를 정리하지 못했습니다.": {
    en: "Could not clean up unused image data.",
    ja: "使用していない画像データを整理できませんでした。"
  },
  "현재 로컬 미디어와 맞지 않는 실행 취소 상태는 복원할 수 없습니다.": {
    en: "An undo state that does not match the current local media cannot be restored.",
    ja: "現在のローカルメディアと一致しない取り消し状態は復元できません。"
  },

  // Source media and preparation.
  "이 프로젝트의 로컬 편집 영상 매핑이 유효하지 않습니다. 편집 영상을 다시 준비해 주세요.": {
    en: "This project's local editing-media mapping is invalid. Prepare the editing media again.",
    ja: "このプロジェクトのローカル編集用動画のマッピングが無効です。編集用動画を再度準備してください。"
  },
  "이 컷이 준비된 VOD 편집 범위 밖에 있습니다. 선택 구간을 다시 준비해 주세요.": {
    en: "This clip is outside the prepared VOD editing range. Prepare the selected range again.",
    ja: "このクリップは準備済みの VOD 編集範囲外です。選択範囲を再度準備してください。"
  },
  "쇼츠 영상과 음성이 준비된 VOD 편집 범위 밖에 있습니다. 이 구간의 편집 영상을 다시 준비해 주세요.": {
    en: "The Short's video and audio are outside the prepared VOD editing range. Prepare the media for this range again.",
    ja: "ショートの動画と音声が準備済みの VOD 編集範囲外です。この範囲の編集用動画を再度準備してください。"
  },
  "원래 영상 탭과 연결됨": {
    en: "Connected to the source-video tab",
    ja: "元動画のタブに接続済み"
  },
  "원래 영상 탭을 찾지 못함": {
    en: "Source-video tab not found",
    ja: "元動画のタブが見つかりません"
  },
  "원래 영상 탭을 찾지 못했습니다.": {
    en: "Could not find the source-video tab.",
    ja: "元動画のタブが見つかりませんでした。"
  },
  "편집 영상 다시 준비": {
    en: "Prepare editing media again",
    ja: "編集用動画を再準備"
  },
  "내 파일을 직접 연결하면 바로 미리볼 수 있어요": {
    en: "Connect your own file to preview it immediately",
    ja: "自分のファイルを直接接続すると、すぐにプレビューできます"
  },
  "본인 소유이거나 사용 허가를 받은 영상 파일을 사용합니다": {
    en: "Use a video file you own or are authorized to use",
    ja: "所有している、または使用許可を得た動画ファイルを使用してください"
  },
  "영상 파일 미연결": {
    en: "No video file connected",
    ja: "動画ファイル未接続"
  },
  "본인 소유·사용 허가 파일을 직접 연결하세요": {
    en: "Connect a file you own or are authorized to use",
    ja: "所有している、または使用許可を得たファイルを直接接続してください"
  },
  "VOD 편집 영상 다시 준비 필요": {
    en: "VOD editing media must be prepared again",
    ja: "VOD 編集用動画の再準備が必要です"
  },
  "원본 또는 컷이 바뀌어 이전 편집 영상을 사용하지 않습니다": {
    en: "The source or clips changed, so the previous editing media will not be used",
    ja: "元動画またはクリップが変更されたため、以前の編集用動画は使用しません"
  },
  "먼저 내 영상 파일을 직접 연결해 주세요.": {
    en: "Connect your video file first.",
    ja: "先に自分の動画ファイルを直接接続してください。"
  },
  "다른 미디어 작업이 끝난 뒤 다시 시도해 주세요.": {
    en: "Try again after the other media operation finishes.",
    ja: "ほかのメディア処理が完了してから、もう一度お試しください。"
  },
  "영상 파일": {
    en: "Video file",
    ja: "動画ファイル"
  },
  "선택한 원본 파일을 불러오지 못했습니다.": {
    en: "Could not load the selected source file.",
    ja: "選択した元ファイルを読み込めませんでした。"
  },
  "원본은 현재 탭에 연결했지만 파일 권한을 저장하지 못했습니다. 편집기를 다시 열면 원본을 다시 선택해 주세요.": {
    en: "The source is connected in this tab, but file permission could not be saved. Select the source again after reopening the editor.",
    ja: "元動画は現在のタブに接続しましたが、ファイル権限を保存できませんでした。エディターを開き直した際に元ファイルを再選択してください。"
  },
  "Chrome 영상 플레이어가 파일을 열지 못했습니다.": {
    en: "The Chrome video player could not open the file.",
    ja: "Chrome の動画プレーヤーでファイルを開けませんでした。"
  },
  "loopback VOD 편집 영상에는 현재 원본의 권리 확인이 필요하며 수동 파일 핸들을 붙일 수 없습니다.": {
    en: "Loopback VOD editing media requires a rights confirmation for the current source and cannot use a manually selected file handle.",
    ja: "ループバック VOD 編集用動画には現在の元動画の権利確認が必要であり、手動選択したファイルハンドルは使用できません。"
  },
  "직접 연결한 파일에는 자동 준비된 VOD의 권리 확인 정보를 붙일 수 없습니다.": {
    en: "Rights-confirmation data from an automatically prepared VOD cannot be attached to a manually connected file.",
    ja: "自動準備された VOD の権利確認情報を、直接接続したファイルに関連付けることはできません。"
  },
  "로컬 편집 영상을 확인하고 있어요": {
    en: "Checking the local editing media",
    ja: "ローカル編集用動画を確認しています"
  },
  "내 영상 파일을 확인하고 있어요": {
    en: "Checking your video file",
    ja: "動画ファイルを確認しています"
  },
  "준비된 편집 영상의 파일 정보와 영상·음성 트랙을 확인합니다.": {
    en: "Checking the prepared media's file information and video/audio tracks.",
    ja: "準備済み編集用動画のファイル情報と映像・音声トラックを確認します。"
  },
  "파일 정보와 영상·음성 트랙을 확인합니다.": {
    en: "Checking file information and video/audio tracks.",
    ja: "ファイル情報と映像・音声トラックを確認します。"
  },
  "영상 트랙이 없는 파일입니다.": {
    en: "This file has no video track.",
    ja: "このファイルには映像トラックがありません。"
  },
  "VOD 로컬 미디어의 시간 매핑이 올바르지 않습니다.": {
    en: "The VOD local-media time mapping is invalid.",
    ja: "VOD ローカルメディアの時間マッピングが正しくありません。"
  },
  "현재 VOD에 대한 편집 권리 확인 정보가 없습니다.": {
    en: "There is no editing-rights confirmation for the current VOD.",
    ja: "現在の VOD に対する編集権利の確認情報がありません。"
  },
  "VOD 로컬 미디어의 실제 재생 시간과 시간 매핑이 다릅니다.": {
    en: "The VOD local media's actual duration does not match its time mapping.",
    ja: "VOD ローカルメディアの実際の再生時間と時間マッピングが一致しません。"
  },
  "선택 구간 일부가 준비된 ±10초 편집 범위 밖에 있습니다. 편집 영상을 다시 준비해 주세요.": {
    en: "Part of the selection is outside the prepared ±10-second editing range. Prepare the editing media again.",
    ja: "選択範囲の一部が準備済みの ±10 秒編集範囲外です。編集用動画を再度準備してください。"
  },
  "선택 구간 일부가 직접 연결한 영상 길이 밖에 있습니다. 페이지↔로컬 정렬값을 확인해 주세요.": {
    en: "Part of the selection is outside the connected video's duration. Check the page-to-local alignment value.",
    ja: "選択範囲の一部が直接接続した動画の長さを超えています。ページ↔ローカルの位置合わせ値を確認してください。"
  },
  "원본 영상을 연결했습니다.": {
    en: "Source video connected.",
    ja: "元動画を接続しました。"
  },
  "필요한 편집 범위를 이 기기의 로컬 영상에 준비했습니다.": {
    en: "The required editing ranges are ready in local media on this device.",
    ja: "必要な編集範囲をこのデバイスのローカル動画に準備しました。"
  },
  "로컬 편집 영상 교체 뒤 UI 동기화에 실패했습니다.": {
    en: "The UI could not be synchronized after replacing the local editing media.",
    ja: "ローカル編集用動画の交換後に UI を同期できませんでした。"
  },
  "준비 순서를 기다리는 중": {
    en: "Waiting in the preparation queue",
    ja: "準備順を待っています"
  },
  "필요한 로컬 편집 범위 계산 중": {
    en: "Calculating the required local editing range",
    ja: "必要なローカル編集範囲を計算中"
  },
  "필요한 VOD 조각을 이 기기로 받는 중": {
    en: "Downloading the required VOD segments to this device",
    ja: "必要な VOD セグメントをこのデバイスに取得中"
  },
  "조각·키프레임·코덱 확인 중": {
    en: "Checking segments, keyframes, and codecs",
    ja: "セグメント・キーフレーム・コーデックを確認中"
  },
  "로컬 편집 영상을 구성 중": {
    en: "Assembling local editing media",
    ja: "ローカル編集用動画を構成中"
  },
  "로컬 편집 영상 준비 완료": {
    en: "Local editing media ready",
    ja: "ローカル編集用動画の準備完了"
  },
  "지원하는 공개 치지직·YouTube·SOOP VOD에서만 선택 구간을 자동 준비할 수 있습니다.": {
    en: "Selected ranges can be prepared automatically only from supported public CHZZK, YouTube, and SOOP VODs.",
    ja: "選択範囲の自動準備は、対応している公開 CHZZK・YouTube・SOOP VOD でのみ利用できます。"
  },
  "먼저 준비할 사용자 선택 구간을 하나 이상 활성화해 주세요.": {
    en: "Enable at least one selected range to prepare first.",
    ja: "準備するユーザー選択範囲を 1 つ以上有効にしてください。"
  },
  "이 기기의 편집 영상을 다시 연결하는 중": {
    en: "Reconnecting editing media on this device",
    ja: "このデバイスの編集用動画を再接続中"
  },
  "필요한 편집 범위를 더 받는 중": {
    en: "Downloading more of the required editing range",
    ja: "必要な編集範囲を追加取得中"
  },
  "편집 영상을 준비하는 중": {
    en: "Preparing editing media",
    ja: "編集用動画を準備中"
  },
  "기존 로컬 범위를 유지하고 부족한 앞뒤 구간만 추가합니다.": {
    en: "Keeping the existing local range and adding only the missing portions before and after it.",
    ja: "既存のローカル範囲を維持し、不足している前後の範囲だけを追加します。"
  },
  "로컬 엔진 session을 bounded retry 뒤에도 복구하지 못했습니다.": {
    en: "The local-engine session could not be recovered after bounded retries.",
    ja: "回数を制限した再試行後もローカルエンジンのセッションを復旧できませんでした。"
  },
  "Kirinuki 내부 미디어 엔진이 안전한 VOD 시간 정보를 확인하지 못했습니다.": {
    en: "Kirinuki's internal media engine could not verify safe VOD timing information.",
    ja: "Kirinuki の内部メディアエンジンで安全な VOD 時間情報を確認できませんでした。"
  },
  "준비된 미디어가 현재 본편·쇼츠 편집 범위를 정확히 덮지 않습니다.": {
    en: "The prepared media does not fully cover the current main-video and Short editing ranges.",
    ja: "準備済みメディアが現在の本編・ショート編集範囲を正確にカバーしていません。"
  },
  "편집 영상 준비 중 프로젝트 또는 원본이 바뀌어 완료 결과를 현재 화면에 적용하지 않았습니다.": {
    en: "The project or source changed while media was being prepared, so the completed result was not applied to this screen.",
    ja: "編集用動画の準備中にプロジェクトまたは元動画が変わったため、完了結果を現在の画面に適用しませんでした。"
  },
  "이전 수동 원본 파일 핸들을 정리하지 못했습니다.": {
    en: "Could not clean up the previous manually selected source-file handle.",
    ja: "以前の手動選択された元ファイルハンドルを整理できませんでした。"
  },
  "VOD 편집 영상 준비를 취소했습니다.": {
    en: "VOD editing-media preparation was canceled.",
    ja: "VOD 編集用動画の準備をキャンセルしました。"
  },

  // Caption diagnostics and controls.
  "AudSeg가 잡은 빈 오디오 타이밍 · 원음을 듣고 텍스트 입력 필요": {
    en: "Empty audio timing detected by AudSeg · listen to the source and enter text",
    ja: "AudSeg が検出した空の音声タイミング · 元音声を聞いてテキスト入力が必要"
  },
  "AI가 불명확한 발화로 표시함 · 원음 재확인 필요": {
    en: "AI marked the speech as unclear · review the source audio",
    ja: "AI が不明瞭な発話としてマーク · 元音声の再確認が必要"
  },
  "인식된 발화 없음": {
    en: "No speech recognized",
    ja: "認識された発話なし"
  },
  "AudSeg 활동 구간 없음": {
    en: "No AudSeg activity ranges",
    ja: "AudSeg の活動区間なし"
  },
  "AudSeg 연속 활동·경계 검수 필요": {
    en: "Review continuous AudSeg activity and boundaries",
    ja: "AudSeg の連続活動と境界の確認が必要"
  },
  "AudSeg 음량 대비 낮음": {
    en: "Low AudSeg level contrast",
    ja: "AudSeg の音量差が小さい"
  },
  "AudSeg 잡음 바닥 상한 적용": {
    en: "AudSeg noise-floor cap applied",
    ja: "AudSeg のノイズフロア上限を適用"
  },
  "AudSeg 타이밍 검수 필요": {
    en: "AudSeg timing needs review",
    ja: "AudSeg タイミングの確認が必要"
  },
  "화면 위치 분석 실패·하단 기본값 사용": {
    en: "Position analysis failed · using bottom default",
    ja: "画面位置の解析に失敗 · 下部の既定位置を使用"
  },
  "유효하지 않은 자막 제외": {
    en: "Invalid captions omitted",
    ja: "無効な字幕を除外"
  },
  "빈 시간 자막 제외": {
    en: "Zero-duration captions omitted",
    ja: "時間が空の字幕を除外"
  },
  "0.1초 미만 자막 자동 보정": {
    en: "Captions under 0.1 seconds corrected automatically",
    ja: "0.1 秒未満の字幕を自動補正"
  },
  "긴 텍스트 축약": {
    en: "Long text shortened",
    ja: "長いテキストを短縮"
  },
  "자동 생성 자막 시간 분할": {
    en: "Auto-generated caption timing split",
    ja: "自動生成字幕の時間を分割"
  },
  "추가 처리 경고 생략": {
    en: "Additional processing warnings omitted",
    ja: "追加の処理警告を省略"
  },
  "자막 개수 상한으로 일부 제외": {
    en: "Some captions omitted at the caption limit",
    ja: "字幕数の上限により一部を除外"
  },
  "공백·종결 마침표 정리": {
    en: "Whitespace and final periods cleaned up",
    ja: "空白と文末の句点を整理"
  },
  "한 줄 길이·읽기속도 기준 시간 분할": {
    en: "Timing split by line length and reading speed",
    ja: "1 行の長さと読み速度に基づいて時間を分割"
  },
  "읽을 시간 확보": {
    en: "Reading time extended",
    ja: "読める時間を確保"
  },
  "짧은 자막 표시시간 확보": {
    en: "Display time extended for short caption",
    ja: "短い字幕の表示時間を確保"
  },
  "완성본 기준 하단 고정": {
    en: "Pinned to bottom in final output",
    ja: "完成動画基準で下部に固定"
  },
  "같은 화자 겹침 보정": {
    en: "Same-speaker overlap corrected",
    ja: "同一話者の重なりを補正"
  },
  "읽기속도 재검수 필요": {
    en: "Reading speed needs review",
    ja: "読み速度の再確認が必要"
  },
  "STT 대비 발화 누락 가능성": {
    en: "Possible speech omitted compared with STT",
    ja: "STT と比べて発話が欠けている可能性"
  },
  "STT에 없는 문구 가능성": {
    en: "Possible text not present in STT",
    ja: "STT にない文言の可能性"
  },
  "너무 짧은 자막 재검수 필요": {
    en: "Very short caption needs review",
    ja: "短すぎる字幕の再確認が必要"
  },
  "같은 화자 겹침 재검수 필요": {
    en: "Same-speaker overlap needs review",
    ja: "同一話者の重なりを再確認する必要があります"
  },
  "한 줄 폭 재검수 필요": {
    en: "Single-line width needs review",
    ja: "1 行の幅を再確認する必要があります"
  },
  "여러 줄 자막 재검수 필요": {
    en: "Multiline caption needs review",
    ja: "複数行字幕の再確認が必要"
  },
  "기타 처리 경고": {
    en: "Other processing warning",
    ja: "その他の処理警告"
  },
  "AudSeg 텍스트 입력 필요": {
    en: "AudSeg text required",
    ja: "AudSeg テキスト入力が必要"
  },
  "오디오 활동 시각만 만든 빈 칸입니다. 원음을 듣고 자막을 직접 입력해 주세요.": {
    en: "This is an empty cue created from audio activity only. Listen to the source and enter the caption yourself.",
    ja: "音声活動のタイミングだけから作成した空のキューです。元音声を聞いて字幕を入力してください。"
  },
  "이 자막 검은 상자 끄기 · X": {
    en: "Turn off this caption's black box · X",
    ja: "この字幕の黒いボックスをオフ · X"
  },
  "선택 이미지": {
    en: "Selected image",
    ja: "選択中の画像"
  },
  "선택 이미지의 시작·끝 시각을 그대로 적용합니다.": {
    en: "Apply the selected image's exact start and end times.",
    ja: "選択中の画像の開始・終了時刻をそのまま適用します。"
  },
  "선택 이미지가 다른 컷에 있어 시각을 맞출 수 없습니다.": {
    en: "The selected image is in another clip, so its timing cannot be matched.",
    ja: "選択した画像は別のクリップにあるため、時刻を合わせられません。"
  },
  "이미지 · 겹친 이미지는 이미지 트랙의 별도 줄에 표시됩니다.": {
    en: "Image · Overlapping images appear on separate rows of the image track.",
    ja: "画像 · 重なった画像は画像トラックの別の行に表示されます。"
  },
  "투명 배경 지원": {
    en: "Transparent backgrounds supported",
    ja: "透過背景に対応"
  },
  "빈 자막": {
    en: "Empty caption",
    ja: "空の字幕"
  },
  "“빈 자막”의 시작·끝 시각을 그대로 적용합니다.": {
    en: "Apply the empty caption's exact start and end times.",
    ja: "空の字幕の開始・終了時刻をそのまま適用します。"
  },
  "저장본을 적용했습니다. 원본 파일 ‘영상’을 다시 연결해 주세요.": {
    en: "Saved version applied. Reconnect the source video.",
    ja: "保存版を適用しました。元動画を再接続してください。"
  },
  "(빈 자막)": {
    en: "(Empty caption)",
    ja: "（空の字幕）"
  },
  "선택 자막이 다른 컷에 있어 시각을 맞출 수 없습니다.": {
    en: "The selected caption is in another clip, so its timing cannot be matched.",
    ja: "選択した字幕は別のクリップにあるため、時刻を合わせられません。"
  },
  "이미지 미리보기를 불러오지 못했습니다.": {
    en: "Could not load the image preview.",
    ja: "画像プレビューを読み込めませんでした。"
  },
  "이 구간 음소거 해제": {
    en: "Unmute this range",
    ja: "この範囲のミュートを解除"
  },
  "출력 제외 컷을 활성화하면 이 자막을 편집할 수 있습니다.": {
    en: "Enable the excluded clip to edit this caption.",
    ja: "出力対象外のクリップを有効にすると、この字幕を編集できます。"
  },
  "출력 제외": {
    en: "Excluded from output",
    ja: "出力対象外"
  },
  "비활성 컷에 속한 자막": {
    en: "Caption in a disabled clip",
    ja: "無効なクリップ内の字幕"
  },
  "비활성 컷 안에서의 시작 시각": {
    en: "Start time within a disabled clip",
    ja: "無効なクリップ内での開始時刻"
  },
  "저장된 자막 위치": {
    en: "Saved caption position",
    ja: "保存済みの字幕位置"
  },
  "켬": {
    en: "On",
    ja: "オン"
  },
  "끔": {
    en: "Off",
    ja: "オフ"
  },
  "단독": {
    en: "Unique",
    ja: "単独"
  },
  "같은 화면 설정을 쓰는 자막이 하나뿐입니다.": {
    en: "Only one caption uses this visual setup.",
    ja: "この画面設定を使用する字幕は 1 つだけです。"
  },
  "프로젝트 공통 외곽선 없음 · 행별 검은 상자 설정만 비교": {
    en: "No project-wide outline · comparing each row's black-box setting only",
    ja: "プロジェクト共通の縁取りなし · 行ごとの黒いボックス設定のみ比較"
  },
  "진행 중인 창을 닫은 뒤 자막 스타일 비교를 열어 주세요.": {
    en: "Close the open dialog before opening caption-style comparison.",
    ja: "開いているダイアログを閉じてから字幕スタイル比較を開いてください。"
  },
  "진행 중인 창을 닫은 뒤 노래 자막 싱크 팁을 열어 주세요.": {
    en: "Close the open dialog before opening the song-caption sync guide.",
    ja: "開いているダイアログを閉じてから歌字幕同期のヒントを開いてください。"
  },
  "이 브라우저에서 클립보드 복사를 사용할 수 없습니다.": {
    en: "Clipboard copying is unavailable in this browser.",
    ja: "このブラウザーではクリップボードへのコピーを利用できません。"
  },
  "SKILL.md 전체를 복사했습니다.": {
    en: "Copied the full SKILL.md.",
    ja: "SKILL.md 全文をコピーしました。"
  },
  "복사하지 못했습니다.": {
    en: "Could not copy.",
    ja: "コピーできませんでした。"
  },
  "출력 제외 컷을 활성화한 뒤 이 자막을 편집해 주세요.": {
    en: "Enable the excluded clip before editing this caption.",
    ja: "出力対象外のクリップを有効にしてから、この字幕を編集してください。"
  },
  "자막 시작 시각 형식을 확인해 주세요.": {
    en: "Check the caption start-time format.",
    ja: "字幕の開始時刻形式を確認してください。"
  },
  "자막 종료 시각 형식을 확인해 주세요.": {
    en: "Check the caption end-time format.",
    ja: "字幕の終了時刻形式を確認してください。"
  },
  "같은 컷의 자막과 이미지를 먼저 선택해 주세요.": {
    en: "Select a caption and image from the same clip first.",
    ja: "先に同じクリップの字幕と画像を選択してください。"
  },
  "맞춘 구간이 같은 자막 레인의 다른 자막과 겹칩니다.": {
    en: "The matched range overlaps another caption in the same track.",
    ja: "合わせた範囲が同じ字幕トラックの別の字幕と重なっています。"
  },
  "자막을 선택 이미지의 시작·끝 시각에 정확히 맞췄습니다.": {
    en: "The caption now matches the selected image's exact start and end times.",
    ja: "字幕を選択画像の開始・終了時刻に正確に合わせました。"
  },
  "이미지 시작 시각 형식을 확인해 주세요.": {
    en: "Check the image start-time format.",
    ja: "画像の開始時刻形式を確認してください。"
  },
  "이미지 종료 시각 형식을 확인해 주세요.": {
    en: "Check the image end-time format.",
    ja: "画像の終了時刻形式を確認してください。"
  },
  "같은 컷의 이미지와 자막을 먼저 선택해 주세요.": {
    en: "Select an image and caption from the same clip first.",
    ja: "先に同じクリップの画像と字幕を選択してください。"
  },
  "이미지를 선택 자막의 시작·끝 시각에 정확히 맞췄습니다.": {
    en: "The image now matches the selected caption's exact start and end times.",
    ja: "画像を選択字幕の開始・終了時刻に正確に合わせました。"
  },
  "음성 구간 시작 시각 형식을 확인해 주세요.": {
    en: "Check the audio-range start-time format.",
    ja: "音声範囲の開始時刻形式を確認してください。"
  },
  "음성 구간 종료 시각 형식을 확인해 주세요.": {
    en: "Check the audio-range end-time format.",
    ja: "音声範囲の終了時刻形式を確認してください。"
  },
  "이 자막에 검은 사각 배경을 켰습니다.": {
    en: "Black-box background enabled for this caption.",
    ja: "この字幕の黒い四角背景をオンにしました。"
  },
  "이 자막의 검은 배경을 껐습니다.": {
    en: "Black-box background disabled for this caption.",
    ja: "この字幕の黒い背景をオフにしました。"
  },
  "타임라인 자석 꺼짐": {
    en: "Timeline snapping off",
    ja: "タイムラインのスナップ：オフ"
  },
  "타임라인 자석을 켰습니다. 드래그 중 Alt로 잠시 해제할 수 있어요.": {
    en: "Timeline snapping enabled. Hold Alt while dragging to bypass it temporarily.",
    ja: "タイムラインのスナップをオンにしました。ドラッグ中は Alt で一時的に解除できます。"
  },
  "타임라인 자석을 껐습니다.": {
    en: "Timeline snapping disabled.",
    ja: "タイムラインのスナップをオフにしました。"
  },

  // Clip, timeline, and inspector controls.
  "위로": {
    en: "up",
    ja: "上へ"
  },
  "아래로": {
    en: "down",
    ja: "下へ"
  },
  "출력 비활성 컷도 묶음 순서 이동 가능": {
    en: "Excluded clips can also be reordered as a group",
    ja: "出力対象外のクリップもグループで並べ替え可能"
  },
  "묶음 이동할 컷 체크": {
    en: "Select clip for group move",
    ja: "グループ移動するクリップを選択"
  },
  "맨 처음으로 이동": {
    en: "Move to beginning",
    ja: "先頭へ移動"
  },
  "한 칸 위로 이동": {
    en: "Move up one",
    ja: "1 つ上へ移動"
  },
  "한 칸 아래로 이동": {
    en: "Move down one",
    ja: "1 つ下へ移動"
  },
  "맨 마지막으로 이동": {
    en: "Move to end",
    ja: "末尾へ移動"
  },
  "현재 로컬 범위": {
    en: "Current local range",
    ja: "現在のローカル範囲"
  },
  "정렬점": {
    en: "Snap point",
    ja: "スナップ点"
  },
  "컷 시작": {
    en: "Clip start",
    ja: "クリップ開始"
  },
  "컷 끝": {
    en: "Clip end",
    ja: "クリップ終了"
  },
  "자막 시작": {
    en: "Caption start",
    ja: "字幕開始"
  },
  "자막 끝": {
    en: "Caption end",
    ja: "字幕終了"
  },
  "에셋 시작": {
    en: "Asset start",
    ja: "素材開始"
  },
  "에셋 끝": {
    en: "Asset end",
    ja: "素材終了"
  },
  "캔버스 시작": {
    en: "Canvas start",
    ja: "キャンバス開始"
  },
  "캔버스 끝": {
    en: "Canvas end",
    ja: "キャンバス終了"
  },
  "재생 헤드": {
    en: "Playhead",
    ja: "再生ヘッド"
  },
  "시작 시각 조정": {
    en: "Adjust start time",
    ja: "開始時刻を調整"
  },
  "끝 시각 조정": {
    en: "Adjust end time",
    ja: "終了時刻を調整"
  },
  "←/→ 0.1초 · Shift+←/→ 1초": {
    en: "←/→ 0.1 sec · Shift+←/→ 1 sec",
    ja: "←/→ 0.1 秒 · Shift+←/→ 1 秒"
  },
  "드래그 또는 ←/→ 0.1초 · Shift+←/→ 1초": {
    en: "Drag or ←/→ 0.1 sec · Shift+←/→ 1 sec",
    ja: "ドラッグまたは ←/→ 0.1 秒 · Shift+←/→ 1 秒"
  },
  "같은 자막 레인 안에서는 자막이 겹칠 수 없습니다.": {
    en: "Captions cannot overlap within the same caption track.",
    ja: "同じ字幕トラック内で字幕を重ねることはできません。"
  },
  "음성 설정 구간끼리는 겹칠 수 없습니다.": {
    en: "Audio-setting ranges cannot overlap.",
    ja: "音声設定範囲同士を重ねることはできません。"
  },
  "원본 음성끼리는 겹칠 수 없습니다.": {
    en: "Source-audio regions cannot overlap.",
    ja: "元音声同士を重ねることはできません。"
  },
  "진행 중인 타임라인 조정을 마친 뒤 다시 시도해 주세요.": {
    en: "Finish the current timeline adjustment, then try again.",
    ja: "進行中のタイムライン調整を完了してから、もう一度お試しください。"
  },
  "본편 원본": {
    en: "Main-video source",
    ja: "本編の元動画"
  },
  "이 원본 음성만 삭제": {
    en: "Remove only this source audio",
    ja: "この元音声だけを削除"
  },
  "원본 음성만 삭제했습니다. 영상·자막·사진은 그대로 유지됩니다.": {
    en: "Source audio removed. Video, captions, and images are unchanged.",
    ja: "元音声だけを削除しました。動画・字幕・画像はそのまま維持されます。"
  },
  "사용자 선택": {
    en: "User selection",
    ja: "ユーザー選択"
  },
  "클릭하면 이 위치에 음성 설정 구간을 만듭니다.": {
    en: "Click to create an audio-setting range here.",
    ja: "クリックすると、この位置に音声設定範囲を作成します。"
  },
  "현재 음성 설정 구간이 음소거됨": {
    en: "Current audio-setting range is muted",
    ja: "現在の音声設定範囲はミュートされています"
  },
  "미리보기 음소거 해제": {
    en: "Unmute preview",
    ja: "プレビューのミュートを解除"
  },
  "미리보기 음소거": {
    en: "Mute preview",
    ja: "プレビューをミュート"
  },
  "새 자막": {
    en: "New caption",
    ja: "新しい字幕"
  },
  "자막을 추가할 영상 구간이 없습니다.": {
    en: "There is no video range where a caption can be added.",
    ja: "字幕を追加できる動画範囲がありません。"
  },
  "이 레인의 다음 자막과 간격이 너무 짧습니다.": {
    en: "There is not enough space before the next caption in this track.",
    ja: "このトラックの次の字幕までの間隔が短すぎます。"
  },
  "음성을 조절할 영상 구간이 없습니다.": {
    en: "There is no video range where audio can be adjusted.",
    ja: "音声を調整できる動画範囲がありません。"
  },
  "현재 시각의 음성 설정 구간을 선택했습니다.": {
    en: "Selected the audio-setting range at the current time.",
    ja: "現在時刻の音声設定範囲を選択しました。"
  },
  "다음 음성 설정 구간과 간격이 너무 짧습니다.": {
    en: "There is not enough space before the next audio-setting range.",
    ja: "次の音声設定範囲までの間隔が短すぎます。"
  },
  "이미지를 삭제했습니다. 실행 취소로 되돌릴 수 있습니다.": {
    en: "Image deleted. You can restore it with Undo.",
    ja: "画像を削除しました。取り消しで元に戻せます。"
  },
  "컷 체크를 모두 해제함": {
    en: "Cleared all checked clips",
    ja: "クリップの選択をすべて解除しました"
  },

  // Image import and preview.
  "클립보드나 파일에 이미지 데이터가 없습니다.": {
    en: "No image data was found in the clipboard or file.",
    ja: "クリップボードまたはファイルに画像データがありません。"
  },
  "PNG, JPEG, WebP 또는 GIF 이미지만 사용할 수 있습니다. SVG는 안전을 위해 제외합니다.": {
    en: "Only PNG, JPEG, WebP, or GIF images can be used. SVG is excluded for safety.",
    ja: "使用できる画像は PNG、JPEG、WebP、GIF のみです。安全のため SVG は対象外です。"
  },
  "이미지가 너무 큽니다": {
    en: "The image is too large",
    ja: "画像が大きすぎます"
  },
  "손상되었거나 브라우저가 읽을 수 없는 이미지입니다.": {
    en: "The image is damaged or cannot be read by this browser.",
    ja: "画像が破損しているか、このブラウザーでは読み取れません。"
  },
  "다른 미디어 작업이 끝난 뒤 이미지를 추가해 주세요.": {
    en: "Add the image after the other media operation finishes.",
    ja: "ほかのメディア処理が完了してから画像を追加してください。"
  },
  "이미지를 추가할 영상 구간이 없습니다.": {
    en: "There is no video range where an image can be added.",
    ja: "画像を追加できる動画範囲がありません。"
  },
  "컷 끝에서 최소 0.1초 앞쪽에 이미지를 추가해 주세요.": {
    en: "Add the image at least 0.1 seconds before the end of the clip.",
    ja: "クリップ終了の 0.1 秒以上前に画像を追加してください。"
  },
  "투명 배경도 유지됩니다.": {
    en: "Transparent backgrounds are preserved.",
    ja: "透過背景も維持されます。"
  },
  "편집기에서 Ctrl/Cmd+V를 눌러 이미지를 붙여넣어 주세요.": {
    en: "Press Ctrl/Cmd+V in the editor to paste the image.",
    ja: "エディターで Ctrl/Cmd+V を押して画像を貼り付けてください。"
  },
  "클립보드에 PNG, JPEG, WebP 또는 GIF 이미지가 없습니다.": {
    en: "The clipboard does not contain a PNG, JPEG, WebP, or GIF image.",
    ja: "クリップボードに PNG、JPEG、WebP、GIF の画像がありません。"
  },
  "클립보드 읽기가 차단됐습니다. 웹에서 ‘이미지 복사’ 후 편집기에서 Ctrl/Cmd+V를 눌러 주세요.": {
    en: "Clipboard access was blocked. Choose “Copy image” on the web, then press Ctrl/Cmd+V in the editor.",
    ja: "クリップボードの読み取りがブロックされました。Web 上で「画像をコピー」を選び、エディターで Ctrl/Cmd+V を押してください。"
  },

  // Short-form workspace and framing.
  "쇼츠가 연결된 본편 프로젝트를 찾지 못했습니다.": {
    en: "Could not find the main project linked to this Short.",
    ja: "このショートに紐づく本編プロジェクトが見つかりませんでした。"
  },
  "⚠ 원본과 배치 영역의 크기를 확인해 주세요": {
    en: "⚠ Check the source and placement dimensions",
    ja: "⚠ 元動画と配置領域のサイズを確認してください"
  },
  "표준 호환 보간": {
    en: "Standard compatible interpolation",
    ja: "標準互換補間"
  },
  "자동 고품질 보정": {
    en: "Automatic high-quality correction",
    ja: "自動高品質補正"
  },
  "자동 품질 확인 중": {
    en: "Checking quality automatically",
    ja: "画質を自動確認中"
  },
  "숨김": {
    en: "Hidden",
    ja: "非表示"
  },
  "본편 영상": {
    en: "Main video",
    ja: "本編動画"
  },
  "숨김 · 다시 표시": {
    en: "Hidden · show again",
    ja: "非表示 · 再表示"
  },
  "표시 중 · 숨기기": {
    en: "Visible · hide",
    ja: "表示中 · 非表示にする"
  },
  "빈 쇼츠 화면 · ‘영상 추가’로 본편 구간을 가져올 수 있습니다.": {
    en: "Empty Short canvas · use “Add video” to bring in a main-video range.",
    ja: "空のショート画面 · 「動画を追加」で本編の範囲を取り込めます。"
  },
  "품질 계산 중": {
    en: "Calculating quality",
    ja: "画質を計算中"
  },
  "영상을 선택하면 픽셀 단위 배치값과 품질 상태가 표시됩니다.": {
    en: "Select a video to see pixel-precise placement values and quality status.",
    ja: "動画を選択すると、ピクセル単位の配置値と画質状態が表示されます。"
  },
  "왼쪽": {
    en: "left",
    ja: "左"
  },
  "오른쪽": {
    en: "right",
    ja: "右"
  },
  "위": {
    en: "top",
    ja: "上"
  },
  "아래": {
    en: "bottom",
    ja: "下"
  },
  "영상을 선택하면 1–24px의 미세한 가장자리 틈을 검사합니다.": {
    en: "Select a video to check for subtle 1–24 px edge gaps.",
    ja: "動画を選択すると、1〜24 px のわずかな端の隙間を検査します。"
  },
  "밀어낼 미세 틈이 없습니다. 크게 비운 영역은 의도적 배치로 유지합니다.": {
    en: "There are no small gaps to push closed. Larger empty areas are kept as intentional placement.",
    ja: "押し広げて埋める微細な隙間はありません。大きな空き領域は意図した配置として維持します。"
  },
  "본편 원본 컷": {
    en: "Main source clip",
    ja: "本編の元クリップ"
  },
  "빈 1080×1920 쇼츠 화면": {
    en: "Empty 1080×1920 Short canvas",
    ja: "空の 1080×1920 ショート画面"
  },
  "빈 1080대1920 쇼츠 화면. 영상을 자유롭게 추가할 수 있습니다.": {
    en: "Empty 1080×1920 Short canvas. Videos can be added freely.",
    ja: "空の 1080×1920 ショート画面です。動画を自由に追加できます。"
  },
  "9:16 화면 맞춤": {
    en: "9:16 framing",
    ja: "9:16 画面調整"
  },
  "구간별 음성": {
    en: "Range audio",
    ja: "範囲別音声"
  },
  "영상 위 이미지": {
    en: "Images over video",
    ja: "動画上の画像"
  },
  "개별": {
    en: "Override",
    ja: "個別"
  },
  "기본": {
    en: "Default",
    ja: "既定"
  },
  "이 자막에 따로 저장된 설정": {
    en: "Settings saved specifically for this caption",
    ja: "この字幕に個別保存された設定"
  },
  "프로젝트 기본값을 상속한 설정": {
    en: "Settings inherited from project defaults",
    ja: "プロジェクトの既定値を継承した設定"
  },
  "다름": {
    en: "Different",
    ja: "異なる"
  },
  "마지막 쇼츠 작업은 삭제할 수 없습니다.": {
    en: "The last Shorts workspace cannot be deleted.",
    ja: "最後のショート動画プロジェクトは削除できません。"
  },
  "쇼츠 영상 가져오기": {
    en: "Import video into Short",
    ja: "ショートに動画を取り込む"
  },
  "쇼츠 전용 편집": {
    en: "Short editing",
    ja: "ショート専用編集"
  },
  "영상 가져오기를 취소하고 쇼츠 편집으로 돌아갑니다.": {
    en: "Cancel video import and return to Short editing.",
    ja: "動画の取り込みをキャンセルしてショート編集に戻ります。"
  },
  "현재 쇼츠 편집을 유지한 채 본편 편집으로 돌아갑니다.": {
    en: "Keep the current Short edit and return to main-video editing.",
    ja: "現在のショート編集を維持したまま本編編集に戻ります。"
  },
  "영상 가져오기를 취소하고 쇼츠 편집으로 돌아가기": {
    en: "Cancel import and return to Short editing",
    ja: "取り込みをキャンセルしてショート編集に戻る"
  },
  "쇼츠 편집으로": {
    en: "To Short editing",
    ja: "ショート編集へ"
  },
  "쇼츠 9:16 미리보기": {
    en: "9:16 Short preview",
    ja: "9:16 ショートプレビュー"
  },
  "쇼츠에 추가할 본편 영상 선택": {
    en: "Choose main video to add to the Short",
    ja: "ショートに追加する本編動画を選択"
  },
  "쇼츠 내보내기": {
    en: "Export Short",
    ja: "ショートを書き出す"
  },
  "쇼츠 화면": {
    en: "Short canvas",
    ja: "ショート画面"
  },
  "하나의 쇼츠 화면에서 영상·사진·자막·음성을 서로 독립적으로 배치합니다.": {
    en: "Place video, images, captions, and audio independently on one Short canvas.",
    ja: "1 つのショート画面に動画・画像・字幕・音声をそれぞれ独立して配置します。"
  },
  "1080×1920 쇼츠 화면이 준비됐습니다. ‘본편 편집으로’에서 영상을 추가해 주세요.": {
    en: "The 1080×1920 Short canvas is ready. Use “To main-video editing” to add video.",
    ja: "1080×1920 のショート画面を準備しました。「本編編集へ」から動画を追加してください。"
  },
  "펼치기": {
    en: "Expand",
    ja: "展開"
  },
  "타임라인 펼치기": {
    en: "Expand timeline",
    ja: "タイムラインを展開"
  },
  "쇼츠 영상 미리보기를 만들 원본이 연결되지 않았습니다.": {
    en: "No source is connected for creating the Short video preview.",
    ja: "ショート動画プレビューを作成する元動画が接続されていません。"
  },
  "원본 압축 패킷을 그대로 복사할 수 없어 브라우저 변환으로 전환합니다.": {
    en: "The compressed source packets cannot be copied directly; switching to browser transcoding.",
    ja: "元動画の圧縮パケットをそのままコピーできないため、ブラウザー変換に切り替えます。"
  },
  "쇼츠 영상 미리보기 파일이 생성되지 않았습니다.": {
    en: "The Short video preview file was not created.",
    ja: "ショート動画のプレビューファイルが作成されませんでした。"
  },
  "쇼츠 영상 미리보기 파일 형식이 올바르지 않습니다.": {
    en: "The Short video preview file has an invalid format.",
    ja: "ショート動画のプレビューファイル形式が正しくありません。"
  },
  "쇼츠 미리보기 원본이 교체되었습니다.": {
    en: "The source for the Short preview was replaced.",
    ja: "ショートプレビューの元動画が置き換えられました。"
  },
  "쇼츠 미리보기 복사본에서 원본 음성 트랙이 누락되었습니다.": {
    en: "The source audio track is missing from the Short preview copy.",
    ja: "ショートプレビューのコピーに元音声トラックがありません。"
  },
  "쇼츠 미리보기 준비 요청이 더 최신 상태로 교체되었습니다.": {
    en: "The Short preview request was superseded by a newer state.",
    ja: "ショートプレビューの準備要求が、より新しい状態に置き換えられました。"
  },
  "현재 연결한 원본에는 음성 트랙이 없어 쇼츠 원본 음성을 준비할 수 없습니다.": {
    en: "The connected source has no audio track, so source audio for the Short cannot be prepared.",
    ja: "接続中の元動画には音声トラックがないため、ショートの元音声を準備できません。"
  },
  "손상된 쇼츠 미리보기 캐시를 다시 만듭니다.": {
    en: "Rebuilding the damaged Short preview cache.",
    ja: "破損したショートプレビューキャッシュを再作成します。"
  },
  "다른 미디어 작업이 끝난 뒤 쇼츠 영상 복사본을 준비해 주세요.": {
    en: "Prepare the Short video copy after the other media operation finishes.",
    ja: "ほかのメディア処理が完了してからショート動画のコピーを準備してください。"
  },
  "다른 미디어 작업이 끝난 뒤 미리보기를 다시 만들어 주세요.": {
    en: "Rebuild the preview after the other media operation finishes.",
    ja: "ほかのメディア処理が完了してからプレビューを再作成してください。"
  },
  "기존 로컬 미리보기 정리 중": {
    en: "Cleaning up the previous local preview",
    ja: "既存のローカルプレビューを整理中"
  },
  "쇼츠 영상 미리보기를 다시 만들었습니다.": {
    en: "The Short video preview was rebuilt.",
    ja: "ショート動画のプレビューを再作成しました。"
  },
  "쇼츠 편집을 열었습니다. 영상·사진·자막·음성은 이 쇼츠 작업 안에서 함께 저장됩니다.": {
    en: "Short editing opened. Video, images, captions, and audio are saved together in this Shorts workspace.",
    ja: "ショート編集を開きました。動画・画像・字幕・音声はこのショート動画プロジェクト内にまとめて保存されます。"
  },
  "쇼츠 편집을 저장하고 본편 편집으로 돌아왔습니다.": {
    en: "Short edit saved; returned to main-video editing.",
    ja: "ショート編集を保存し、本編編集に戻りました。"
  },
  "영상 가져오기를 취소하고 쇼츠 편집으로 돌아왔습니다.": {
    en: "Video import canceled; returned to Short editing.",
    ja: "動画の取り込みをキャンセルし、ショート編集に戻りました。"
  },
  "현재 본편 원본을 먼저 연결하거나 준비해 주세요.": {
    en: "Connect or prepare the current main-video source first.",
    ja: "先に現在の本編元動画を接続または準備してください。"
  },
  "현재 본편에서 가져올 구간과 화면을 고르세요. 영상은 쇼츠의 현재 재생 시각부터 추가됩니다.": {
    en: "Choose the range and frame to take from the current main video. It will be added at the Short's current playhead.",
    ja: "現在の本編から取り込む範囲と画面を選んでください。動画はショートの現在の再生位置から追加されます。"
  },
  "진행 중인 편집 작업이 끝난 뒤 쇼츠 소스를 만들어 주세요.": {
    en: "Create the Short source after the current editing operation finishes.",
    ja: "進行中の編集処理が完了してからショート素材を作成してください。"
  },
  "편집 영상을 먼저 준비하거나 내 파일을 연결해 주세요.": {
    en: "Prepare editing media or connect your file first.",
    ja: "先に編集用動画を準備するか、自分のファイルを接続してください。"
  },
  "영상 화면 크기를 읽는 중입니다. 잠시 뒤 다시 눌러 주세요.": {
    en: "The video dimensions are still being read. Try again shortly.",
    ja: "動画の画面サイズを読み取っています。しばらくしてからもう一度押してください。"
  },
  "쇼츠 소스로 쓸 수 있는 영상 구간이 없습니다.": {
    en: "There is no video range available as a Short source.",
    ja: "ショート素材として使用できる動画範囲がありません。"
  },
  "타임라인에서 구간을 맞추고, 영상 위 사각형을 드래그해 쇼츠에 쓸 화면을 정하세요.": {
    en: "Set the range on the timeline, then drag the rectangle over the video to choose the frame for the Short.",
    ja: "タイムラインで範囲を合わせ、動画上の四角形をドラッグしてショートに使う画面を決めてください。"
  },
  "선택 구간이 컷 경계에서 0.1초 미만 영상 조각을 만듭니다. 시작·끝을 경계에서 0.1초 이상 떨어뜨려 주세요.": {
    en: "The selection creates a video fragment under 0.1 seconds at a clip boundary. Move its start and end at least 0.1 seconds from the boundary.",
    ja: "選択範囲によりクリップ境界で 0.1 秒未満の動画断片ができます。開始・終了を境界から 0.1 秒以上離してください。"
  },
  "진행 중인 편집 작업이 끝난 뒤 쇼츠 소스를 추가해 주세요.": {
    en: "Add the Short source after the current editing operation finishes.",
    ja: "進行中の編集処理が完了してからショート素材を追加してください。"
  },
  "0.1초 이상의 영상 구간과 사용할 화면을 먼저 정해 주세요.": {
    en: "Choose a video range of at least 0.1 seconds and the frame to use first.",
    ja: "0.1 秒以上の動画範囲と使用する画面を先に指定してください。"
  },
  "선택 구간과 겹치는 활성 본편 영상이 없습니다.": {
    en: "No active main-video layer overlaps the selected range.",
    ja: "選択範囲と重なる有効な本編動画がありません。"
  },
  "쇼츠 영상을 추가하지 못했습니다. 구간을 다시 확인해 주세요.": {
    en: "Could not add the video to the Short. Check the range again.",
    ja: "ショート動画を追加できませんでした。範囲を再確認してください。"
  },
  "밀대로 보정할 쇼츠 영상을 먼저 선택해 주세요.": {
    en: "Select a Short video to correct with the edge-push tool first.",
    ja: "先に押し広げツールで補正するショート動画を選択してください。"
  },
  "선택한 방향에는 1–24px의 미세한 틈이 없습니다.": {
    en: "There is no subtle 1–24 px gap in the selected direction.",
    ja: "選択した方向に 1〜24 px の微細な隙間はありません。"
  },
  "감지된 모든 방향": {
    en: "All detected edges",
    ja: "検出されたすべての方向"
  },
  "선택 영상을 삭제했습니다. 사진·자막·음성과 쇼츠 길이는 그대로 유지됩니다.": {
    en: "Selected video deleted. Images, captions, audio, and the Short duration are unchanged.",
    ja: "選択した動画を削除しました。画像・字幕・音声・ショートの長さはそのまま維持されます。"
  },
  "마지막 영상도 삭제했습니다. 빈 쇼츠 화면과 사진·자막·음성은 그대로 유지됩니다.": {
    en: "The last video was deleted. The empty Short canvas, images, captions, and audio are unchanged.",
    ja: "最後の動画も削除しました。空のショート画面・画像・字幕・音声はそのまま維持されます。"
  },
  "영상 화면 준비 중": {
    en: "Preparing video frame",
    ja: "動画画面を準備中"
  },
  "쇼츠 합성 미리보기를 준비하지 못했습니다": {
    en: "Could not prepare the composited Short preview",
    ja: "ショートの合成プレビューを準備できませんでした"
  },
  "쇼츠 실제 합성 미리보기를 그리지 못했습니다.": {
    en: "Could not render the composited Short preview.",
    ja: "ショートの実際の合成プレビューを描画できませんでした。"
  },
  "쇼츠 소스 설정 펼치기": {
    en: "Expand Short source settings",
    ja: "ショート素材の設定を展開"
  },
  "설정 펼치기": {
    en: "Expand settings",
    ja: "設定を展開"
  },
  "쇼츠 편집으로 돌아가기": {
    en: "Return to Short editing",
    ja: "ショート編集に戻る"
  },
  "현재 쇼츠에 추가할 영상": {
    en: "Video to add to the current Short",
    ja: "現在のショートに追加する動画"
  },
  "현재 본편에서 시간 범위와 화면을 고릅니다. 쇼츠의 현재 재생 시각부터 새 영상으로 배치됩니다.": {
    en: "Choose a time range and frame from the current main video. It will be placed as a new video at the Short's current playhead.",
    ja: "現在の本編から時間範囲と画面を選びます。ショートの現在の再生位置から新しい動画として配置されます。"
  },
  "영상 추가하고 쇼츠 편집으로": {
    en: "Add video and open Short editing",
    ja: "動画を追加してショート編集へ"
  },
  "선택 시작점이 속한 컷 전체": {
    en: "Entire clip containing the selection start",
    ja: "選択開始点を含むクリップ全体"
  },
  "선택 시작점부터 그 컷의 끝까지": {
    en: "From the selection start to the end of that clip",
    ja: "選択開始点からそのクリップの終わりまで"
  },
  "0.1초 이상의 구간과 사용할 화면을 정해 주세요.": {
    en: "Choose a range of at least 0.1 seconds and the frame to use.",
    ja: "0.1 秒以上の範囲と使用する画面を指定してください。"
  },
  "쇼츠에 사용할 원본 화면": {
    en: "Source frame for the Short",
    ja: "ショートに使用する元画面"
  },
  "쇼츠 소스 시작 시각": {
    en: "Short source start time",
    ja: "ショート素材の開始時刻"
  },
  "쇼츠 소스 끝 시각": {
    en: "Short source end time",
    ja: "ショート素材の終了時刻"
  },
  "쇼츠 소스": {
    en: "Short source",
    ja: "ショート素材"
  },
  "쇼츠 소스 영상 구간": {
    en: "Short source video range",
    ja: "ショート素材の動画範囲"
  },
  "현재 재생 위치를 쇼츠 소스 시작점으로 지정 (I)": {
    en: "Set playhead as Short source start (I)",
    ja: "現在の再生位置をショート素材の開始点に設定 (I)"
  },
  "현재 재생 위치를 쇼츠 소스 끝점으로 지정 (O)": {
    en: "Set playhead as Short source end (O)",
    ja: "現在の再生位置をショート素材の終了点に設定 (O)"
  },
  "쇼츠 소스 구간 선택 해제 (Esc)": {
    en: "Clear Short source range (Esc)",
    ja: "ショート素材範囲の選択を解除 (Esc)"
  },
  "쇼츠 소스는 0.1초 이상이어야 합니다.": {
    en: "A Short source must be at least 0.1 seconds long.",
    ja: "ショート素材は 0.1 秒以上必要です。"
  },
  "선택 시작점이 속한 컷을 찾지 못했습니다.": {
    en: "Could not find the clip containing the selection start.",
    ja: "選択開始点を含むクリップが見つかりませんでした。"
  },
  "선택 시작점이 속한 컷 전체를 쇼츠 소스로 맞췄습니다.": {
    en: "Set the entire clip containing the selection start as the Short source.",
    ja: "選択開始点を含むクリップ全体をショート素材に設定しました。"
  },
  "선택 시작점부터 이 컷의 끝까지 맞췄습니다.": {
    en: "Set the range from the selection start to the end of this clip.",
    ja: "選択開始点からこのクリップの終わりまでを設定しました。"
  },
  "이 시각이 속한 컷을 찾지 못했습니다.": {
    en: "Could not find the clip containing this time.",
    ja: "この時刻を含むクリップが見つかりませんでした。"
  },
  "진행 중인 편집 동작을 마친 뒤 쇼츠 앞뒤를 정리해 주세요.": {
    en: "Finish the current edit operation before trimming the Short's head and tail.",
    ja: "進行中の編集操作を完了してからショートの前後を整理してください。"
  },
  "앞뒤를 맞출 영상·사진·자막·음성이 없습니다. 빈 쇼츠 화면은 그대로 유지됩니다.": {
    en: "There is no video, image, caption, or audio to trim to. The empty Short canvas remains unchanged.",
    ja: "前後を合わせる動画・画像・字幕・音声がありません。空のショート画面はそのまま維持されます。"
  },
  "쇼츠 앞뒤에 제거할 빈 구간이 없습니다.": {
    en: "There is no empty range to remove from the beginning or end of the Short.",
    ja: "ショートの前後に削除する空白範囲はありません。"
  },
  "쇼츠에서는 영상 블록의 양끝을 직접 자르거나 블록을 삭제해 주세요.": {
    en: "In a Short, trim either end of a video block directly or delete the block.",
    ja: "ショートでは、動画ブロックの両端を直接トリミングするか、ブロックを削除してください。"
  },
  "쇼츠 소스 작성 중에는 선택 구간이 삭제되지 않습니다. 먼저 작성을 취소해 주세요.": {
    en: "A selected range cannot be deleted while composing a Short source. Cancel composition first.",
    ja: "ショート素材の作成中は選択範囲を削除できません。先に作成をキャンセルしてください。"
  },
  "삭제할 구간의 시작과 끝을 0.1초 이상 벌려 지정해 주세요.": {
    en: "Set the start and end of the range to delete at least 0.1 seconds apart.",
    ja: "削除範囲の開始と終了を 0.1 秒以上離して指定してください。"
  },
  "손잡이 조정을 마친 뒤 선택 구간을 삭제해 주세요.": {
    en: "Finish adjusting the handles before deleting the selected range.",
    ja: "ハンドルの調整を完了してから選択範囲を削除してください。"
  },
  "진행 중인 미디어 작업이 끝난 뒤 구간을 삭제해 주세요.": {
    en: "Delete the range after the current media operation finishes.",
    ja: "進行中のメディア処理が完了してから範囲を削除してください。"
  },
  "영상의 쇼츠 시작·끝 시각을 다시 확인해 주세요.": {
    en: "Check the video's Short start and end times again.",
    ja: "動画のショート開始・終了時刻を再確認してください。"
  },
  "같은 영상 라인에서는 블록이 겹칠 수 없습니다. 타임라인에서 빈 라인으로 옮기거나 + 버튼으로 라인을 추가해 주세요.": {
    en: "Blocks cannot overlap on the same video track. Move the block to an empty track on the timeline or add a track with the + button.",
    ja: "同じ動画トラック内でブロックを重ねることはできません。タイムラインの空きトラックへ移動するか、+ ボタンでトラックを追加してください。"
  },
  "영상을 숨겼습니다.": {
    en: "Video hidden.",
    ja: "動画を非表示にしました。"
  },
  "영상을 다시 표시했습니다.": {
    en: "Video shown again.",
    ja: "動画を再表示しました。"
  },
  "선택 영상의 쇼츠 화면 배치를 초기화했습니다.": {
    en: "Reset the selected video's Short framing.",
    ja: "選択した動画のショート画面配置をリセットしました。"
  },

  // Local caption generation.
  "원본 영상의 시작 또는 끝에 도달했습니다.": {
    en: "Reached the beginning or end of the source video.",
    ja: "元動画の先頭または末尾に到達しました。"
  },
  "다시 연결해야 합니다 · 이 PC의 Whisper를 자동으로 다시 확인해 주세요": {
    en: "Reconnect required · check Whisper on this PC again automatically",
    ja: "再接続が必要です · この PC の Whisper を自動で再確認してください"
  },
  "Whisper 다시 확인": {
    en: "Check Whisper again",
    ja: "Whisper を再確認"
  },
  "이 PC의 Whisper 자동 연결": {
    en: "Connect to Whisper on this PC automatically",
    ja: "この PC の Whisper に自動接続"
  },
  "버튼을 누르면 실행 중인 Tiny·Base·Small·Medium 모델을 자동으로 확인합니다": {
    en: "Press the button to detect a running Tiny, Base, Small, or Medium model automatically",
    ja: "ボタンを押すと、実行中の Tiny・Base・Small・Medium モデルを自動検出します"
  },
  "아직 연결하지 않았습니다 · 버튼을 누르면 Kirinuki가 내장 Whisper를 확인합니다": {
    en: "Not connected yet · press the button and Kirinuki will check its built-in Whisper",
    ja: "まだ接続していません · ボタンを押すと Kirinuki が内蔵 Whisper を確認します"
  },
  "아직 연결되지 않았습니다 · 아래 버튼이나 자막 만들기를 누르면 자동 연결합니다": {
    en: "Not connected yet · use the button below or create captions to connect automatically",
    ja: "まだ接続されていません · 下のボタンまたは字幕作成を押すと自動接続します"
  },
  "로컬 자막 엔진 세션을 확인하는 중": {
    en: "Checking the local caption-engine session",
    ja: "ローカル字幕エンジンのセッションを確認中"
  },
  "로컬 자막 엔진에 자동 연결하는 중": {
    en: "Connecting to the local caption engine automatically",
    ja: "ローカル字幕エンジンに自動接続中"
  },
  "로컬 Whisper STT가 준비되지 않았습니다.": {
    en: "Local Whisper STT is not ready.",
    ja: "ローカル Whisper STT の準備ができていません。"
  },
  "이 PC의 Whisper 연결 정보가 올바르지 않습니다. AudSeg를 사용해 주세요.": {
    en: "The Whisper connection information on this PC is invalid. Use AudSeg instead.",
    ja: "この PC の Whisper 接続情報が正しくありません。AudSeg を使用してください。"
  },
  "AudSeg 타이밍": {
    en: "AudSeg timing",
    ja: "AudSeg タイミング"
  },
  "Whisper 자막": {
    en: "Whisper captions",
    ja: "Whisper 字幕"
  },
  "AudSeg 빈 타이밍": {
    en: "AudSeg empty timing",
    ja: "AudSeg 空タイミング"
  },
  "Whisper 로컬 자막": {
    en: "Local Whisper captions",
    ja: "Whisper ローカル字幕"
  },
  "소리가 있는 구간만 4초 이하 빈 자막 칸으로 만듭니다": {
    en: "Create empty caption cues up to 4 seconds long only where audio is active",
    ja: "音がある区間だけを 4 秒以下の空字幕キューとして作成します"
  },
  "음악·효과음도 잡힐 수 있고 텍스트는 직접 입력해야 합니다": {
    en: "Music and sound effects may also be detected; enter the text yourself",
    ja: "音楽や効果音も検出される場合があり、テキストは手動入力が必要です"
  },
  "연결 모델": {
    en: "Connected model",
    ja: "接続モデル"
  },
  "STT가 만든 발화 시작·끝을 기준으로 검수용 자막 초안을 만듭니다": {
    en: "Create review-ready caption drafts from the speech start and end times produced by STT",
    ja: "STT が作成した発話の開始・終了時刻を基に、確認用の字幕下書きを作成します"
  },
  "취소하면 오디오 추출을 시작하지 않습니다.": {
    en: "Canceling will prevent audio extraction from starting.",
    ja: "キャンセルすると音声抽出は開始されません。"
  },
  "확인 불가": {
    en: "Unavailable",
    ja: "確認不可"
  },
  "· 로컬 STT 설정 미완료": {
    en: "· Local STT setup incomplete",
    ja: "· ローカル STT 設定未完了"
  },
  "Whisper 설정을 확인해 주세요": {
    en: "Check Whisper settings",
    ja: "Whisper の設定を確認してください"
  },
  "Whisper 연결 확인을 취소했습니다.": {
    en: "Whisper connection check canceled.",
    ja: "Whisper の接続確認をキャンセルしました。"
  },
  "자막 초벌을 만들려면 먼저 내 영상 파일을 직접 연결해 주세요.": {
    en: "Connect your video file before creating a caption draft.",
    ja: "字幕下書きを作成するには、先に自分の動画ファイルを直接接続してください。"
  },
  "선택한 구간이 없습니다.": {
    en: "No ranges are selected.",
    ja: "選択された範囲がありません。"
  },
  "일부 컷이 현재 로컬 편집 범위 밖에 있습니다. 해당 컷의 앞·뒤 30초 추가 버튼으로 필요한 구간을 먼저 받아 주세요.": {
    en: "Some clips are outside the current local editing range. Use the add-30-seconds-before/after buttons on those clips to prepare the required ranges first.",
    ja: "一部のクリップが現在のローカル編集範囲外です。該当クリップの前後 30 秒追加ボタンで必要な範囲を先に準備してください。"
  },
  "일부 컷이 연결된 원본 길이 밖에 있습니다.": {
    en: "Some clips are outside the connected source's duration.",
    ja: "一部のクリップが接続中の元動画の長さを超えています。"
  },
  "저장된 컷별 자막 체크포인트를 확인했습니다. 다시 처리할 컷이 없습니다.": {
    en: "Saved per-clip caption checkpoints were verified. There are no clips to process again.",
    ja: "保存済みのクリップ別字幕チェックポイントを確認しました。再処理するクリップはありません。"
  },
  "자막 초벌을 시작하지 않았습니다.": {
    en: "Caption drafting was not started.",
    ja: "字幕下書きの作成は開始されませんでした。"
  },
  "AudSeg 빈 타이밍을 만드는 중": {
    en: "Creating empty AudSeg timings",
    ja: "AudSeg の空タイミングを作成中"
  },
  "로컬 Whisper 자막 초안을 만드는 중": {
    en: "Creating local Whisper caption drafts",
    ja: "ローカル Whisper 字幕の下書きを作成中"
  },
  "이 탭에서 오디오 활동 구간만 찾습니다. 음성을 글로 바꾸지 않으며 음악·효과음도 포함될 수 있습니다.": {
    en: "Only audio activity ranges are detected in this tab. Speech is not transcribed, and music or sound effects may be included.",
    ja: "このタブでは音声活動区間だけを検出します。音声を文字には変換せず、音楽や効果音が含まれる場合があります。"
  },
  "자막 실행 중 실제 STT 모델이 바뀌었습니다. 서로 다른 전사 결과를 섞지 않고 중단합니다.": {
    en: "The active STT model changed while captions were being generated. Processing stopped to avoid mixing transcription results.",
    ja: "字幕生成中に実際の STT モデルが変わりました。異なる文字起こし結果を混在させないため処理を中止します。"
  },
  "빈 타이밍": {
    en: "Empty timing",
    ja: "空タイミング"
  },
  "자막 초안": {
    en: "Caption draft",
    ja: "字幕下書き"
  },
  "선택 구간 빈 타이밍 초안 완료": {
    en: "Empty timing drafts completed for selected ranges",
    ja: "選択範囲の空タイミング下書きが完了"
  },
  "선택 구간 자막 초안 완료": {
    en: "Caption drafts completed for selected ranges",
    ja: "選択範囲の字幕下書きが完了"
  },
  "AudSeg가 오디오 활동 구간을 찾지 못했습니다. 음성·음량을 직접 확인해 주세요.": {
    en: "AudSeg found no audio activity ranges. Check the speech and volume manually.",
    ja: "AudSeg は音声活動区間を検出できませんでした。音声と音量を直接確認してください。"
  },
  "AI 자막 작업을 취소했습니다.": {
    en: "AI caption operation canceled.",
    ja: "AI 字幕処理をキャンセルしました。"
  },
  "사용자가 작업을 취소했습니다.": {
    en: "The operation was canceled by the user.",
    ja: "ユーザーが処理をキャンセルしました。"
  },

  // Export and session archive.
  "내보낼 사용자 선택 구간이 없습니다.": {
    en: "There are no selected ranges to export.",
    ja: "書き出すユーザー選択範囲がありません。"
  },
  "같은 레인 안에서 겹치는 자막이 있습니다. 자막 시각을 먼저 조정해 주세요.": {
    en: "Some captions overlap in the same track. Adjust their timing first.",
    ja: "同じトラック内で重なっている字幕があります。先に字幕の時刻を調整してください。"
  },
  "서로 겹치는 음성 설정 구간이 있습니다. 구간 시각을 먼저 조정해 주세요.": {
    en: "Some audio-setting ranges overlap. Adjust their timing first.",
    ja: "重なっている音声設定範囲があります。先に範囲の時刻を調整してください。"
  },
  "이 브라우저는 영상과 편집 복원 파일을 같은 폴더에 안전하게 저장하는 기능을 지원하지 않습니다. Chromium 기반 최신 브라우저에서 다시 시도해 주세요.": {
    en: "This browser cannot safely save the video and edit-recovery file to the same folder. Try again in a current Chromium-based browser.",
    ja: "このブラウザーは動画と編集復元ファイルを同じフォルダーへ安全に保存する機能に対応していません。最新の Chromium ベースのブラウザーで再度お試しください。"
  },
  "원본 파일이 연결 후 변경되었습니다. 잘못된 구간을 내보내지 않도록 중단했습니다. ‘내 파일 직접 연결’에서 현재 파일을 다시 확인해 주세요.": {
    en: "The source file changed after it was connected. Export was stopped to avoid using incorrect ranges. Verify the current file under “Connect my file.”",
    ja: "接続後に元ファイルが変更されました。誤った範囲を書き出さないよう処理を中止しました。「自分のファイルを直接接続」で現在のファイルを再確認してください。"
  },
  "선택 장면을 세로 쇼츠로 만드는 중": {
    en: "Creating a vertical Short from the selected scenes",
    ja: "選択したシーンから縦型ショートを作成中"
  },
  "컷과 자막을 영상으로 만드는 중": {
    en: "Rendering clips and captions to video",
    ja: "クリップと字幕を動画に書き出し中"
  },
  "호환 렌더러로 처음부터 다시 처리": {
    en: "Restarting with the compatibility renderer",
    ja: "互換レンダラーで最初から再処理"
  },
  "파일을 마무리하는 중 · 이 단계는 취소할 수 없습니다": {
    en: "Finalizing file · this step cannot be canceled",
    ja: "ファイルを仕上げています · この段階はキャンセルできません"
  },
  "컷 연결과 자막 합성 중": {
    en: "Joining clips and compositing captions",
    ja: "クリップの連結と字幕の合成中"
  },
  "폴더 출력 핸들을 전달했지만 영상이 폴더 파일 대신 메모리에 생성되어 내보내기를 완료하지 않았습니다.": {
    en: "A folder output handle was supplied, but the video was created in memory instead of as a folder file, so export was not completed.",
    ja: "フォルダー出力ハンドルを渡しましたが、動画がフォルダー内のファイルではなくメモリ上に生成されたため、書き出しを完了しませんでした。"
  },
  "저장된 영상 파일 핸들이 없어 묶음을 검증할 수 없습니다.": {
    en: "The export bundle cannot be verified because there is no handle for the saved video file.",
    ja: "保存された動画ファイルのハンドルがないため、書き出し一式を検証できません。"
  },
  "저장된 영상 트랙·길이·파일 크기 검증 중": {
    en: "Verifying the saved video track, duration, and file size",
    ja: "保存された映像トラック・長さ・ファイルサイズを検証中"
  },
  "편집 복원 파일과 자막 파일이 제대로 저장됐는지 확인하는 중": {
    en: "Verifying that the edit-recovery and caption files were saved correctly",
    ja: "編集復元ファイルと字幕ファイルが正しく保存されたか確認中"
  },
  "임시 자료를 지우기 전에 저장 파일을 다시 확인하는 중": {
    en: "Rechecking saved files before deleting temporary data",
    ja: "一時データを削除する前に保存ファイルを再確認中"
  },
  "확인창이 열린 동안 영상·편집 복원 파일·자막 파일이 바뀌지 않았는지 다시 확인합니다.": {
    en: "Checking that the video, edit-recovery file, and caption file did not change while the confirmation dialog was open.",
    ja: "確認画面が開いている間に動画・編集復元ファイル・字幕ファイルが変更されていないか再確認します。"
  },
  "임시 자료를 지우기 직전에 저장 파일이 달라져 아무 자료도 삭제하지 않았습니다.": {
    en: "A saved file changed immediately before cleanup, so no temporary data was deleted.",
    ja: "一時データ削除の直前に保存ファイルが変わったため、何も削除しませんでした。"
  },
  "같은 편집 작업이 다른 탭에도 열려 있어 아무 자료도 삭제하지 않았습니다. 다른 탭을 닫고 다시 내보내거나 임시 파일을 유지해 주세요.": {
    en: "The same edit is open in another tab, so no data was deleted. Close the other tab and export again, or keep the temporary files.",
    ja: "同じ編集作業が別のタブでも開いているため、何も削除しませんでした。ほかのタブを閉じて再度書き出すか、一時ファイルを保持してください。"
  },
  "현재 편집 작업의 임시 자료를 정리하는 중": {
    en: "Cleaning up temporary data for the current edit",
    ja: "現在の編集作業の一時データを整理中"
  },
  "이 작업에만 속한 VOD 구간·저장본·이미지·미리보기인지 확인한 뒤 정리합니다.": {
    en: "Verifying and removing only VOD ranges, saved versions, images, and previews belonging to this edit.",
    ja: "この作業だけに属する VOD 範囲・保存版・画像・プレビューか確認してから整理します。"
  },
  "남은 연결 정보는 브라우저를 닫을 때 한 번 더 정리됩니다.": {
    en: "Remaining connection data will be cleaned up once more when the browser closes.",
    ja: "残った接続情報はブラウザーを閉じる際にもう一度整理されます。"
  },
  "확인 결과가 없습니다.": {
    en: "No verification result is available.",
    ja: "確認結果がありません。"
  },
  "생성된 빈 영상 파일은 지우지 못했습니다.": {
    en: "The empty video file that was created could not be deleted.",
    ja: "生成された空の動画ファイルを削除できませんでした。"
  },
  "영상 파일 마무리 실패": {
    en: "Video finalization failed",
    ja: "動画ファイルの仕上げに失敗"
  },
  "영상 내보내기 실패": {
    en: "Video export failed",
    ja: "動画の書き出しに失敗"
  },
  "영상 내보내기 요청이 이미 진행 중입니다.": {
    en: "A video export request is already in progress.",
    ja: "動画の書き出し要求はすでに進行中です。"
  },
  "다른 편집기 탭에서 이미 영상을 내보내고 있습니다. 그 작업이 끝난 뒤 다시 눌러 주세요.": {
    en: "Another editor tab is already exporting video. Try again after it finishes.",
    ja: "別のエディタータブですでに動画を書き出しています。その処理が完了してから、もう一度押してください。"
  },
  "이전 내보내기 정리 확인이 아직 끝나지 않았습니다.": {
    en: "Cleanup verification for the previous export is still in progress.",
    ja: "前回の書き出しの整理確認がまだ完了していません。"
  },
  "다른 미디어 작업이 끝난 뒤 내보내기 설정을 열어 주세요.": {
    en: "Open export settings after the other media operation finishes.",
    ja: "ほかのメディア処理が完了してから書き出し設定を開いてください。"
  },
  "편집 복원 파일 크기가 허용 범위를 벗어났습니다.": {
    en: "The edit-recovery file size is outside the allowed range.",
    ja: "編集復元ファイルのサイズが許容範囲外です。"
  },
  "현재 정책을 확인한 원본과 복원 파일의 원본이 다릅니다. 해당 원본 탭에서 이번 사용 정책을 다시 입력한 뒤 복원해 주세요.": {
    en: "The recovery file uses a different source from the one confirmed by the current policy. Enter the usage policy again in that source tab before restoring.",
    ja: "現在のポリシーで確認した元動画と復元ファイルの元動画が異なります。該当する元動画のタブで今回の利用ポリシーを再入力してから復元してください。"
  },
  "편집 복원 파일을 확인하는 중": {
    en: "Checking the edit-recovery file",
    ja: "編集復元ファイルを確認中"
  },
  "파일과 이미지를 모두 확인한 뒤 현재 편집 작업에 한 번에 적용합니다.": {
    en: "All files and images will be verified before being applied to the current edit atomically.",
    ja: "すべてのファイルと画像を確認してから、現在の編集作業に一括適用します。"
  },
  "저장된 이미지 확인 중": {
    en: "Checking saved images",
    ja: "保存済み画像を確認中"
  },
  "복원 파일의 편집 프로젝트 버전을 현재 Kirinuki가 읽지 못합니다.": {
    en: "This version of Kirinuki cannot read the edit-project version in the recovery file.",
    ja: "現在の Kirinuki では、復元ファイル内の編集プロジェクトバージョンを読み取れません。"
  },
  "현재 편집에 저장본 적용 중": {
    en: "Applying the saved version to the current edit",
    ja: "現在の編集に保存版を適用中"
  },
  "복원 완료": {
    en: "Restore complete",
    ja: "復元完了"
  },
  "저장본을 적용했습니다. ‘편집 영상 준비’로 필요한 VOD 구간만 다시 받아 주세요.": {
    en: "Saved version applied. Use “Prepare editing media” to download only the required VOD ranges again.",
    ja: "保存版を適用しました。「編集用動画を準備」で必要な VOD 範囲だけを再取得してください。"
  },
  "저장본을 적용했고 현재 원본 연결도 그대로 사용할 수 있습니다.": {
    en: "Saved version applied. The current source connection can still be used.",
    ja: "保存版を適用しました。現在の元動画接続もそのまま使用できます。"
  },
  "출력 영상 제목을 입력해 주세요.": {
    en: "Enter a title for the exported video.",
    ja: "出力動画のタイトルを入力してください。"
  },
  "내보내기 설정을 연 뒤 편집 상태가 바뀌어 검사를 갱신했습니다. 내용을 확인하고 한 번 더 눌러 주세요.": {
    en: "The edit changed after export settings were opened, so the checks were refreshed. Review them and press again.",
    ja: "書き出し設定を開いた後に編集状態が変わったため、検査を更新しました。内容を確認してもう一度押してください。"
  },
  "정렬 오프셋을 초 단위 숫자로 입력해 주세요.": {
    en: "Enter the alignment offset as a number of seconds.",
    ja: "位置合わせのオフセットを秒単位の数値で入力してください。"
  },
  "오프셋을 적용했지만 일부 컷이 원본 길이 밖입니다.": {
    en: "The offset was applied, but some clips are outside the source duration.",
    ja: "オフセットを適用しましたが、一部のクリップが元動画の長さを超えています。"
  },
  "라이브와 로컬 VOD 정렬 오프셋을 적용했습니다.": {
    en: "Applied the alignment offset between the live source and local VOD.",
    ja: "ライブとローカル VOD の位置合わせオフセットを適用しました。"
  },

  // Startup validation and local caption-draft handoff.
  "편집할 캡처 데이터 형식이 올바르지 않습니다.": {
    en: "The capture data to edit has an invalid format.",
    ja: "編集するキャプチャーデータの形式が正しくありません。"
  },
  "캡처 원본 정보 형식이 올바르지 않습니다.": {
    en: "The captured source information has an invalid format.",
    ja: "キャプチャー元情報の形式が正しくありません。"
  },
  "캡처 임시 구간 형식이 올바르지 않습니다.": {
    en: "The temporary capture range has an invalid format.",
    ja: "キャプチャーの一時範囲の形式が正しくありません。"
  },
  "캡처 구간 목록 형식이 올바르지 않습니다.": {
    en: "The capture-range list has an invalid format.",
    ja: "キャプチャー範囲一覧の形式が正しくありません。"
  },
  "다시 열 편집 프로젝트 ID가 없습니다.": {
    en: "There is no edit-project ID to reopen.",
    ja: "再度開く編集プロジェクト ID がありません。"
  },
  "이번 편집 세대와 캡처 원본 데이터가 달라 새 프로젝트를 만들지 않았습니다. 시작 화면에서 다시 열어 주세요.": {
    en: "The capture source does not match this edit generation, so a new project was not created. Open it again from the start screen.",
    ja: "今回の編集世代とキャプチャー元データが異なるため、新しいプロジェクトを作成しませんでした。開始画面から開き直してください。"
  },
  "저장된 VOD 편집 구간 정보가 올바르지 않습니다. ‘편집 영상 준비’를 다시 실행해 주세요.": {
    en: "The saved VOD editing-range information is invalid. Run “Prepare editing media” again.",
    ja: "保存された VOD 編集範囲情報が正しくありません。「編集用動画を準備」を再実行してください。"
  },
  "이 원본의 파일 권한은 저장되지 않았습니다. ‘내 파일 직접 연결’에서 파일을 다시 선택해 주세요.": {
    en: "File permission for this source was not saved. Select the file again under “Connect my file.”",
    ja: "この元動画のファイル権限は保存されていません。「自分のファイルを直接接続」でファイルを再選択してください。"
  },
  "저장된 파일 핸들이 현재 편집 원본과 달라 자동 연결하지 않고 제거했습니다.": {
    en: "The saved file handle did not match the current edit source, so it was removed without being connected.",
    ja: "保存済みファイルハンドルが現在の編集元と異なるため、自動接続せず削除しました。"
  },
  "저장된 파일 핸들이 현재 편집 원본과 달라 자동 연결하지 않았습니다. 브라우저 사이트 데이터를 정리하거나 원본을 직접 다시 연결해 주세요.": {
    en: "The saved file handle did not match the current edit source, so it was not connected automatically. Clear the browser's site data or reconnect the source manually.",
    ja: "保存済みファイルハンドルが現在の編集元と異なるため、自動接続しませんでした。ブラウザーのサイトデータを整理するか、元動画を直接再接続してください。"
  },
  "저장된 원본 파일을 다시 쓰려면 ‘내 파일 직접 연결’을 눌러 권한을 확인해 주세요.": {
    en: "To use the saved source file again, choose “Connect my file” and confirm permission.",
    ja: "保存済みの元ファイルを再利用するには、「自分のファイルを直接接続」を押して権限を確認してください。"
  },
  "저장된 원본 파일 연결이 만료되었습니다. ‘내 파일 직접 연결’에서 다시 선택해 주세요.": {
    en: "The saved source-file connection has expired. Select the file again under “Connect my file.”",
    ja: "保存済み元ファイルの接続が期限切れです。「自分のファイルを直接接続」で再選択してください。"
  },
  "로컬 엔진 identity 사전 확인에 실패했습니다.": {
    en: "The local-engine identity precheck failed.",
    ja: "ローカルエンジンの識別情報を事前確認できませんでした。"
  },
  "이 프로젝트가 이미 다른 탭에서 편집 중입니다. 기존 탭을 사용하거나 닫은 뒤 다시 열어 주세요.": {
    en: "This project is already being edited in another tab. Use that tab, or close it before reopening the project.",
    ja: "このプロジェクトは別のタブですでに編集中です。既存のタブを使用するか、閉じてから開き直してください。"
  },
  "이번 편집의 고유 세대 식별자를 확인하지 못해 시작 상태를 저장하지 않았습니다.": {
    en: "The unique generation ID for this edit could not be verified, so its starting state was not saved.",
    ja: "今回の編集の固有世代 ID を確認できなかったため、開始状態を保存しませんでした。"
  },
  "이번 편집의 시작 상태 체크포인트가 현재 세션과 다릅니다.": {
    en: "This edit's starting-state checkpoint does not match the current session.",
    ja: "今回の編集の開始状態チェックポイントが現在のセッションと一致しません。"
  },
  "정책 확인 대상과 편집 프로젝트가 다릅니다.": {
    en: "The policy-confirmation target does not match the edit project.",
    ja: "ポリシー確認対象と編集プロジェクトが異なります。"
  },
  "새 편집 ID가 이 기기의 저장 프로젝트와 충돌했습니다. 기존 편집은 변경하지 않았습니다. 시작 화면에서 새 프로젝트를 다시 열어 주세요.": {
    en: "The new edit ID conflicts with a project saved on this device. The existing edit was not changed. Open the new project again from the start screen.",
    ja: "新しい編集 ID がこのデバイスの保存済みプロジェクトと競合しました。既存の編集は変更していません。開始画面から新しいプロジェクトを開き直してください。"
  },
  "이번 편집기 열기에 연결된 캡처 데이터를 찾지 못했습니다. 시작 화면에서 정책을 다시 입력해 열어 주세요.": {
    en: "Could not find the capture data associated with this editor launch. Enter the policy again on the start screen and reopen it.",
    ja: "今回のエディター起動に関連付けられたキャプチャーデータが見つかりませんでした。開始画面でポリシーを再入力して開き直してください。"
  },
  "이 기기에서 다시 열 편집 프로젝트를 찾지 못했습니다.": {
    en: "Could not find the edit project to reopen on this device.",
    ja: "このデバイスで再度開く編集プロジェクトが見つかりませんでした。"
  },
  "자막 에이전트 설정을 불러오지 못했습니다.": {
    en: "Could not load caption-agent settings.",
    ja: "字幕エージェントの設定を読み込めませんでした。"
  },
  "새 편집의 캡처 데이터를 확인하지 못했습니다.": {
    en: "Could not verify the capture data for the new edit.",
    ja: "新しい編集のキャプチャーデータを確認できませんでした。"
  },
  "다시 열 편집 프로젝트를 확인하지 못했습니다.": {
    en: "Could not verify the edit project to reopen.",
    ja: "再度開く編集プロジェクトを確認できませんでした。"
  },
  "정책을 확인한 원본 회차와 저장된 편집 프로젝트의 원본이 다릅니다. 시작 화면에서 다시 입력해 주세요.": {
    en: "The policy-confirmed source episode differs from the source in the saved edit project. Enter it again on the start screen.",
    ja: "ポリシーを確認した元動画の回と保存済み編集プロジェクトの元動画が異なります。開始画面で再入力してください。"
  },
  "복구된 완료 세션의 편집 체크포인트를 확정하지 못했습니다.": {
    en: "Could not commit the edit checkpoint for the recovered completed session.",
    ja: "復旧した完了セッションの編集チェックポイントを確定できませんでした。"
  },
  "브라우저가 복구된 편집의 완료 상태를 확인하지 못했습니다.": {
    en: "The browser could not verify completion of the recovered edit.",
    ja: "ブラウザーで復旧した編集の完了状態を確認できませんでした。"
  },
  "현재 프로젝트를 저장한 뒤 일회성 시작 데이터를 정리하지 못했습니다.": {
    en: "The current project was saved, but one-time startup data could not be cleaned up.",
    ja: "現在のプロジェクトを保存しましたが、一時的な起動データを整理できませんでした。"
  },
  "자막 폰트를 미리 불러오지 못했습니다.": {
    en: "Could not preload the caption font.",
    ja: "字幕フォントを事前に読み込めませんでした。"
  },
  "이 프로젝트에는 같은 레인 안에서 겹치는 자막이 있습니다. 자막 시각을 조정해 주세요.": {
    en: "This project has overlapping captions in the same track. Adjust their timing.",
    ja: "このプロジェクトには同じトラック内で重なる字幕があります。字幕の時刻を調整してください。"
  },
  "이 프로젝트에는 서로 겹치는 음성 설정 구간이 있습니다. 구간 시각을 조정해 주세요.": {
    en: "This project has overlapping audio-setting ranges. Adjust their timing.",
    ja: "このプロジェクトには重なっている音声設定範囲があります。範囲の時刻を調整してください。"
  },
  "로컬 임시저장 목록을 준비하지 못했습니다.": {
    en: "Could not prepare the local saved-version list.",
    ja: "ローカル一時保存の一覧を準備できませんでした。"
  },
  "저장본 목록 확인 실패": {
    en: "Could not check saved versions",
    ja: "保存版の確認に失敗"
  },
  "코드 변경 직전 저장본을 확인하고 같은 프로젝트를 다시 열었습니다.": {
    en: "Verified the save made before the code change and reopened the same project.",
    ja: "コード変更直前の保存版を確認し、同じプロジェクトを開き直しました。"
  },
  "로컬 자막 초벌 데이터 형식이 올바르지 않습니다.": {
    en: "The local caption-draft data has an invalid format.",
    ja: "ローカル字幕下書きデータの形式が正しくありません。"
  },
  "로컬 자막 초벌 실행 ID가 올바르지 않습니다.": {
    en: "The local caption-draft run ID is invalid.",
    ja: "ローカル字幕下書きの実行 ID が正しくありません。"
  },
  "추가할 로컬 자막 초벌이 없습니다.": {
    en: "There are no local caption drafts to add.",
    ja: "追加するローカル字幕下書きがありません。"
  },
  "현재 프로젝트에 적용할 로컬 자막 초벌이 아닙니다.": {
    en: "These local caption drafts do not belong to the current project.",
    ja: "現在のプロジェクトに適用するローカル字幕下書きではありません。"
  },
  "진행 중인 편집 동작이 끝난 뒤 로컬 자막 초벌을 적용해 주세요.": {
    en: "Apply the local caption drafts after the current editing operation finishes.",
    ja: "進行中の編集操作が完了してからローカル字幕下書きを適用してください。"
  },
  "새로 추가할 로컬 자막 초벌이 없습니다.": {
    en: "There are no new local caption drafts to add.",
    ja: "新しく追加するローカル字幕下書きがありません。"
  },
  "로컬 엔진 identity 재확인에 실패했습니다.": {
    en: "The local-engine identity recheck failed.",
    ja: "ローカルエンジンの識別情報を再確認できませんでした。"
  },

  // Labels returned by directly imported, user-visible modules.
  "현재 위치에 자막 추가": {
    en: "Add caption at playhead",
    ja: "現在位置に字幕を追加"
  },
  "현재 편집 로컬 임시저장": {
    en: "Save local recovery copy",
    ja: "現在の編集をローカル一時保存"
  },
  "현재 위치에 음성 설정 추가": {
    en: "Add audio settings at playhead",
    ja: "現在位置に音声設定を追加"
  },
  "타임라인 전체 보기": {
    en: "Fit timeline",
    ja: "タイムライン全体を表示"
  },
  "타임라인 자석 전환": {
    en: "Toggle timeline snapping",
    ja: "タイムラインのスナップを切り替え"
  },
  "현재 위치에 이미지 붙여넣기": {
    en: "Paste image at playhead",
    ja: "現在位置に画像を貼り付け"
  },
  "같은 자막 라인의 이전 자막으로 이동": {
    en: "Go to previous caption in the same track",
    ja: "同じ字幕トラックの前の字幕へ移動"
  },
  "같은 자막 라인의 다음 자막으로 이동": {
    en: "Go to next caption in the same track",
    ja: "同じ字幕トラックの次の字幕へ移動"
  },
  "미리보기 음소거 전환": {
    en: "Toggle preview mute",
    ja: "プレビューのミュートを切り替え"
  },
  "원본 영상 탭으로 이동": {
    en: "Go to source-video tab",
    ja: "元動画のタブへ移動"
  },
  "최근 로컬 임시저장 목록 열기": {
    en: "Open recent local recovery copies",
    ja: "最近のローカル一時保存一覧を開く"
  },
  "자막 편집 탭 열기": {
    en: "Open caption editing tab",
    ja: "字幕編集タブを開く"
  },
  "에셋 편집 탭 열기": {
    en: "Open asset editing tab",
    ja: "アセット編集タブを開く"
  },
  "음성 편집 탭 열기": {
    en: "Open audio editing tab",
    ja: "音声編集タブを開く"
  },
  "선택 자막 검은 상자 전환": {
    en: "Toggle black box for selected caption",
    ja: "選択字幕の黒いボックスを切り替え"
  },
  "원본 영상의 현재 시각으로 이동": {
    en: "Go to current time in source video",
    ja: "元動画の現在時刻へ移動"
  },
  "원본 미디어 선택": {
    en: "Choose source media",
    ja: "元メディアを選択"
  },
  "현재 위치를 구간 시작점으로 지정": {
    en: "Set playhead as range start",
    ja: "現在位置を範囲の開始点に設定"
  },
  "현재 위치를 구간 끝점으로 지정": {
    en: "Set playhead as range end",
    ja: "現在位置を範囲の終了点に設定"
  },
  "최신 공개 키리누키 규정": {
    en: "Current public Kirinuki policy",
    ja: "最新の公開 Kirinuki ポリシー"
  },
  "별도 서면 허락": {
    en: "Separate written permission",
    ja: "個別の書面許可"
  },
  "공식 편집자·소속사 권한": {
    en: "Official editor or agency authorization",
    ja: "公式編集者・所属事務所の権限"
  },
  "이번 1회 사용자 확인": {
    en: "User confirmation for this one use",
    ja: "今回 1 回のユーザー確認"
  },
  "치지직": {
    en: "CHZZK",
    ja: "CHZZK"
  },
  "지원하지 않음": {
    en: "Unsupported",
    ja: "未対応"
  },
  "영상 플레이어 미검출": {
    en: "Video player not detected",
    ja: "動画プレーヤーを検出できません"
  },
  "YouTube 광고 재생 중 · 스탬프 일시 중지": {
    en: "YouTube ad playing · stamping paused",
    ja: "YouTube 広告を再生中 · スタンプを一時停止"
  },
  "일시정지": {
    en: "Paused",
    ja: "一時停止"
  },
  "재생 중": {
    en: "Playing",
    ja: "再生中"
  },
  "한국 버튜버 키리누키 · 클린": {
    en: "Korean VTuber Kirinuki · Clean",
    ja: "韓国 VTuber Kirinuki · クリーン"
  },
  "한국 버튜버 키리누키 · 검은 직사각형": {
    en: "Korean VTuber Kirinuki · Black rectangle",
    ja: "韓国 VTuber Kirinuki · 黒い長方形"
  },
  "한국 버튜버 키리누키 · Paperlogy": {
    en: "Korean VTuber Kirinuki · Paperlogy",
    ja: "韓国 VTuber Kirinuki · Paperlogy"
  },
  "Pretendard · 기존 프로젝트": {
    en: "Pretendard · Legacy project",
    ja: "Pretendard · 既存プロジェクト"
  },
  "Tiny · 빠른 초안": {
    en: "Tiny · Fast draft",
    ja: "Tiny · 高速下書き"
  },
  "가장 빠르게 자막 초안을 만듭니다.": {
    en: "Creates caption drafts as quickly as possible.",
    ja: "字幕下書きを最速で作成します。"
  },
  "Base · 가벼운 품질": {
    en: "Base · Lightweight quality",
    ja: "Base · 軽量品質"
  },
  "저사양 PC에서 속도와 품질을 가볍게 높입니다.": {
    en: "Provides a modest quality boost while staying fast on lower-spec PCs.",
    ja: "低スペック PC でも速度を保ちながら品質を少し高めます。"
  },
  "Small · 균형": {
    en: "Small · Balanced",
    ja: "Small · バランス"
  },
  "속도와 자막 품질의 균형을 우선합니다.": {
    en: "Prioritizes a balance of speed and caption quality.",
    ja: "速度と字幕品質のバランスを優先します。"
  },
  "Medium · 정확도 우선": {
    en: "Medium · Accuracy first",
    ja: "Medium · 精度優先"
  },
  "더 많은 자원을 사용해 정확도를 우선합니다.": {
    en: "Uses more resources to prioritize accuracy.",
    ja: "より多くのリソースを使い、精度を優先します。"
  },

  // Directly surfaced onboarding/help copy from the local media helper.
  "이 PC의 영상 준비 도우미에 연결하지 못했습니다. 이미 설치했다면 주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 ‘설치 후 연결 확인’을 눌러 주세요.": {
    en: "Could not connect to the video-preparation helper on this PC. If it is installed, allow local-network access in this site's address-bar settings, then choose “Check connection after install.”",
    ja: "この PC の動画準備ヘルパーに接続できませんでした。インストール済みの場合は、アドレスバーのサイト設定でローカルネットワークへのアクセスを許可し、「インストール後に接続を確認」を押してください。"
  },
  "아직 이 PC의 영상 준비 도우미가 연결되지 않았습니다. 처음이라면 아래 다운로드부터, 이미 설치했다면 ‘설치 후 연결 확인’을 눌러 주세요.": {
    en: "The video-preparation helper on this PC is not connected yet. If this is your first time, download it below; if it is installed, choose “Check connection after install.”",
    ja: "この PC の動画準備ヘルパーはまだ接続されていません。初回は下からダウンロードし、インストール済みの場合は「インストール後に接続を確認」を押してください。"
  },
  "Kirinuki 엔진 연결을 취소했습니다.": {
    en: "Kirinuki engine connection canceled.",
    ja: "Kirinuki エンジンへの接続をキャンセルしました。"
  },
  "영상 준비 도우미에서 연결 응답을 받지 못했습니다. 도우미 설치가 끝났는지 확인해 주세요.": {
    en: "The video-preparation helper did not return a connection response. Make sure its installation has finished.",
    ja: "動画準備ヘルパーから接続応答を受信できませんでした。インストールが完了しているか確認してください。"
  },
  "이 브라우저는 아직 영상 준비 도우미와 연결되지 않았습니다. ‘이 PC 연결’ 버튼을 눌러 한 번 연결해 주세요.": {
    en: "This browser has not connected to the video-preparation helper yet. Choose “Connect this PC” once to connect it.",
    ja: "このブラウザーはまだ動画準備ヘルパーに接続されていません。「この PC を接続」を一度押して接続してください。"
  },
  "로컬 영상 준비 도구 확인 시간이 초과되었습니다.": {
    en: "Checking the local video-preparation helper timed out.",
    ja: "ローカル動画準備ヘルパーの確認がタイムアウトしました。"
  },
  "설치된 영상 준비 도구의 버전을 확인하지 못했습니다.": {
    en: "Could not verify the installed video-preparation helper version.",
    ja: "インストール済み動画準備ヘルパーのバージョンを確認できませんでした。"
  },
  "Windows 도우미 미리보기 (.exe)": {
    en: "Windows helper preview (.exe)",
    ja: "Windows ヘルパープレビュー (.exe)"
  },
  "Windows용 도우미 다운로드": {
    en: "Download helper for Windows",
    ja: "Windows 用ヘルパーをダウンロード"
  },
  "macOS용 도우미 다운로드": {
    en: "Download helper for macOS",
    ja: "macOS 用ヘルパーをダウンロード"
  },
  "Debian/Ubuntu용 도우미 (.deb)": {
    en: "Helper for Debian/Ubuntu (.deb)",
    ja: "Debian/Ubuntu 用ヘルパー (.deb)"
  },
  "현재 공개 테스트는 Windows x64·Debian/Ubuntu·Arch Linux x64를 지원합니다. macOS용 도우미는 아직 제공하지 않습니다.": {
    en: "The current public test supports Windows x64, Debian/Ubuntu, and Arch Linux x64. A macOS helper is not available yet.",
    ja: "現在の公開テストは Windows x64・Debian/Ubuntu・Arch Linux x64 に対応しています。macOS 用ヘルパーはまだ提供していません。"
  },
  "현재 공개 테스트는 Debian/Ubuntu·Arch Linux x64에서만 지원합니다. Windows와 macOS용 도우미는 아직 제공하지 않습니다.": {
    en: "The current public test supports only Debian/Ubuntu and Arch Linux x64. Windows and macOS helpers are not available yet.",
    ja: "現在の公開テストは Debian/Ubuntu・Arch Linux x64 のみに対応しています。Windows と macOS 用ヘルパーはまだ提供していません。"
  },
  "현재는 Windows 64비트, Apple Silicon macOS 15 이상, Debian/Ubuntu·Arch Linux 64비트만 지원합니다.": {
    en: "Currently supported: 64-bit Windows, Apple Silicon on macOS 15 or later, and 64-bit Debian/Ubuntu or Arch Linux.",
    ja: "現在は 64 ビット Windows、Apple Silicon 搭載 macOS 15 以降、64 ビット Debian/Ubuntu・Arch Linux のみに対応しています。"
  },
  "Windows 도우미 받기": {
    en: "Get the Windows helper",
    ja: "Windows ヘルパーを入手"
  },
  "Windows 11 x64용 설치 파일(.exe)을 받습니다.": {
    en: "Download the installer (.exe) for Windows 11 x64.",
    ja: "Windows 11 x64 用インストーラー（.exe）をダウンロードします。"
  },
  "다운로드한 설치 파일을 실행합니다. 미리보기 빌드에서는 Windows 앱 보호 안내가 표시될 수 있습니다.": {
    en: "Run the downloaded installer. Windows may show an app-protection notice for preview builds.",
    ja: "ダウンロードしたインストーラーを実行します。プレビュービルドでは Windows のアプリ保護案内が表示される場合があります。"
  },
  "설치가 끝나면 도우미 실행을 확인하고 원래 웹 작업을 이어갑니다.": {
    en: "After installation, confirm the helper is running and continue the original web task.",
    ja: "インストール後にヘルパーの起動を確認し、元の Web 作業を続行します。"
  },
  "Linux 도우미 받기": {
    en: "Get the Linux helper",
    ja: "Linux ヘルパーを入手"
  },
  "Debian/Ubuntu 또는 Arch Linux x64용 파일을 고릅니다.": {
    en: "Choose the package for Debian/Ubuntu or Arch Linux x64.",
    ja: "Debian/Ubuntu または Arch Linux x64 用のファイルを選びます。"
  },
  "패키지를 설치하고 앱 메뉴에서 Kirinuki 도우미를 한 번 실행합니다.": {
    en: "Install the package and launch the Kirinuki helper once from the app menu.",
    ja: "パッケージをインストールし、アプリメニューから Kirinuki ヘルパーを一度起動します。"
  },
  "이 화면으로 돌아와 연결을 다시 확인하면 원래 웹 작업이 이어집니다.": {
    en: "Return to this screen and check the connection again to continue the original web task.",
    ja: "この画面に戻って接続を再確認すると、元の Web 作業を続行できます。"
  },
  "지원되는 운영체제용 설치 파일을 확인합니다.": {
    en: "Choose an installer for a supported operating system.",
    ja: "対応している OS 用のインストーラーを確認します。"
  },
  "도우미 연결이 확인되면 원래 웹 작업을 이어갑니다.": {
    en: "Once the helper connection is confirmed, the original web task continues.",
    ja: "ヘルパーへの接続が確認されると、元の Web 作業を続行します。"
  },
  "Windows 미리보기 소스·라이선스 안내": {
    en: "Windows preview source and license information",
    ja: "Windows プレビューのソース・ライセンス情報"
  },
  "Linux 미리보기 소스·라이선스 안내": {
    en: "Linux preview source and license information",
    ja: "Linux プレビューのソース・ライセンス情報"
  },
  "이 PC 연결 허용하고 계속": {
    en: "Allow this PC connection and continue",
    ja: "この PC への接続を許可して続行"
  },
  "권한 설정 후 다시 확인": {
    en: "Check again after changing permission",
    ja: "権限設定後に再確認"
  },
  "이 PC 연결": {
    en: "Connect this PC",
    ja: "この PC を接続"
  },
  "도우미 실행 후 연결 확인": {
    en: "Check connection after starting helper",
    ja: "ヘルパー起動後に接続を確認"
  },
  "도우미 깨우고 다시 확인": {
    en: "Wake helper and check again",
    ja: "ヘルパーを起動して再確認"
  },
  "설치 완료 · 다시 확인": {
    en: "Installation complete · check again",
    ja: "インストール完了 · 再確認"
  },
  "주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 다시 확인해 주세요.": {
    en: "Allow local-network access in the address-bar site settings, then check again.",
    ja: "アドレスバーのサイト設定でローカルネットワークへのアクセスを許可してから、再確認してください。"
  },
  "먼저 이 사이트가 이 PC의 영상 준비 도구에 연결하도록 한 번 허용해 주세요. 이미 설치했다면 곧바로 원래 작업이 이어집니다.": {
    en: "First allow this site to connect to the video-preparation helper on this PC. If it is already installed, the original task will continue immediately.",
    ja: "まず、このサイトがこの PC の動画準備ヘルパーに接続することを一度許可してください。インストール済みなら、元の作業がすぐに続行されます。"
  },
  "현재 PC는 자동 설치 지원 대상이 아닙니다.": {
    en: "Automatic installation is not supported on this PC.",
    ja: "この PC は自動インストールの対象外です。"
  },
  "준비됐습니다. 선택한 영상 구간을 이어서 불러옵니다.": {
    en: "Ready. Continuing to load the selected video ranges.",
    ja: "準備できました。選択した動画範囲の読み込みを続行します。"
  },
  "이 PC의 영상 준비 도구를 확인하는 중…": {
    en: "Checking the video-preparation helper on this PC…",
    ja: "この PC の動画準備ヘルパーを確認中…"
  },
  "영상 준비 도우미에서 이 브라우저의 연결 요청을 확인하는 중…": {
    en: "Waiting for the video-preparation helper to confirm this browser's connection request…",
    ja: "動画準備ヘルパーでこのブラウザーの接続要求を確認中…"
  },
  "브라우저의 로컬 네트워크 접근 질문에서 허용을 선택해 주세요.": {
    en: "Choose Allow when the browser asks for local-network access.",
    ja: "ブラウザーのローカルネットワークアクセス確認で「許可」を選んでください。"
  },
  "도우미 실행을 확인했습니다. ‘이 PC 연결’을 누르면 이 브라우저 등록과 원래 작업을 이어갑니다.": {
    en: "The helper is running. Choose “Connect this PC” to register this browser and continue the original task.",
    ja: "ヘルパーの起動を確認しました。「この PC を接続」を押すと、このブラウザーを登録して元の作業を続行します。"
  },
  "도우미가 아직 실행되지 않았습니다. 앱 메뉴에서 Kirinuki 도우미를 한 번 실행한 뒤 연결을 다시 확인해 주세요.": {
    en: "The helper is not running yet. Launch the Kirinuki helper once from the app menu, then check the connection again.",
    ja: "ヘルパーがまだ起動していません。アプリメニューから Kirinuki ヘルパーを一度起動し、接続を再確認してください。"
  },
  "도우미가 아직 실행되지 않았습니다. 설치가 끝났다면 Kirinuki 도우미를 한 번 실행한 뒤 연결을 다시 확인해 주세요.": {
    en: "The helper is not running yet. If installation is complete, launch the Kirinuki helper once, then check the connection again.",
    ja: "ヘルパーがまだ起動していません。インストール済みなら Kirinuki ヘルパーを一度起動し、接続を再確認してください。"
  },
  "설치가 끝난 뒤 다시 확인해 주세요.": {
    en: "Check again after installation finishes.",
    ja: "インストール完了後に再確認してください。"
  },
  "기기 연결 정보를 초기화하지 못했습니다.": {
    en: "Could not reset device-connection information.",
    ja: "デバイス接続情報をリセットできませんでした。"
  },
  "영상 준비 연결을 취소했습니다.": {
    en: "Video-preparation connection canceled.",
    ja: "動画準備への接続をキャンセルしました。"
  },
  "로컬 엔진 identity 초기화를 취소했습니다.": {
    en: "Canceled the local-engine identity reset.",
    ja: "ローカルエンジンの識別情報のリセットをキャンセルしました。"
  },
  "이 구간을 새 쇼츠 장면으로 만들도록 전환했습니다.": {
    en: "This range will now be added as a new Shorts scene.",
    ja: "この範囲を新しいショート動画のシーンとして追加する設定に切り替えました。"
  },
  "쇼츠 소스 시각 형식을 확인해 주세요.": {
    en: "Check the Shorts source timecode.",
    ja: "ショート動画のソースタイムコードを確認してください。"
  },
  "치지직 원본 확인 중": {
    en: "Checking CHZZK source",
    ja: "CHZZK の元動画を確認中"
  },
  "치지직 원본 시각과 최초 ±10초 편집 핸들을 확인합니다.": {
    en: "Checking the CHZZK source timing and initial ±10-second editing handles.",
    ja: "CHZZK の元動画時刻と初期 ±10 秒編集ハンドルを確認します。"
  },
  "먼저 치지직 편집 영상을 준비해 주세요.": {
    en: "Prepare CHZZK editing media first.",
    ja: "先に CHZZK の編集用動画を準備してください。"
  },
  "현재 컷과 맞는 치지직 VOD 선택 구간을 다시 준비해 주세요.": {
    en: "Prepare the selected CHZZK VOD range matching the current clip again.",
    ja: "現在のクリップに合う CHZZK VOD の選択範囲を再度準備してください。"
  },
  "치지직 로컬 편집 영상의 컷 범위를 다시 확인해 주세요.": {
    en: "Check the clip ranges in the local CHZZK editing media again.",
    ja: "CHZZK のローカル編集用動画のクリップ範囲を再確認してください。"
  },
  "현재 쇼츠 구성과 정확히 일치하는 미리보기 영상이 없습니다. 미리보기를 다시 만들어 주세요.": {
    en: "No preview matches the current Shorts edit. Rebuild the preview.",
    ja: "現在のショート動画編集と一致するプレビューがありません。プレビューを再作成してください。"
  },
  "연결 identity를 초기화했습니다. ‘이 PC 연결’을 눌러 다시 확인해 주세요.": {
    en: "Connection identity reset. Choose “Connect this PC” to check again.",
    ja: "接続識別情報をリセットしました。「この PC を接続」を押して再確認してください。"
  },
  "이 브라우저에 기억된 영상 준비 도우미 identity를 지울까요? 설치된 도우미를 직접 확인한 경우에만 계속하세요.": {
    en: "Forget the media helper identity saved in this browser? Continue only if you have verified the installed helper yourself.",
    ja: "このブラウザーに保存された動画準備ヘルパーの識別情報を削除しますか？インストール済みのヘルパーを自分で確認した場合のみ続行してください。"
  },
  "영상 미리보기 준비 실패": {
    en: "Video preview preparation failed",
    ja: "動画プレビューの準備に失敗"
  },
  "미리보기 준비됨": {
    en: "Preview ready",
    ja: "プレビュー準備完了"
  },
  "미리보기 준비 필요": {
    en: "Preview needs preparation",
    ja: "プレビューの準備が必要"
  },
  "원본": {
    en: "Source",
    ja: "元動画"
  },
  "미세한 검은 틈 감지": {
    en: "Small black gaps detected",
    ja: "微細な黒い隙間を検出"
  },
  "쇼츠 캔버스에서 별도 이동·크기 조절": {
    en: "Move and resize independently on the Shorts canvas",
    ja: "ショート動画のキャンバス上で個別に移動・サイズ調整"
  },
  "0.1초 이상 필요": {
    en: "At least 0.1 seconds required",
    ja: "0.1 秒以上必要"
  }
} satisfies UiCopyCatalog;

/**
 * Dynamic editor copy. Every expression is anchored at both ends and captures
 * only the value that the editor inserted. Do not add catch-all Korean
 * sentence patterns here: that could rewrite filenames or user-authored copy.
 */
export const EDITOR_RUNTIME_UI_COPY_PATTERNS = [
  // Normal Shorts authoring path. These stay fully anchored so captured source
  // notes, image names, timecodes, and error details remain user-owned data.
  {
    source: /^기본 흰색 · (#[0-9A-Fa-f]{3,8}) · (.+)$/u,
    en: "Default white · $1 · $2",
    ja: "既定の白 · $1 · $2"
  },
  {
    source: /^최근 색상 (\d+) · (#[0-9A-Fa-f]{3,8}) · (.+)$/u,
    en: "Recent color $1 · $2 · $3",
    ja: "最近使った色 $1 · $2 · $3"
  },
  {
    source: /^영상 (\d+), (\d+)번 라인, 음량 ([\d.]+)%, 표시 중, 쇼츠 (.+?)부터 (.+?), 원본 (.+?)부터 (.+)$/u,
    en: "Video $1, track $2, volume $3%, visible, Short $4 to $5, source $6 to $7",
    ja: "動画 $1、トラック $2、音量 $3%、表示中、ショート $4 から $5、元動画 $6 から $7"
  },
  {
    source: /^영상 (\d+), (\d+)번 라인, 음량 ([\d.]+)%, 숨김, 쇼츠 (.+?)부터 (.+?), 원본 (.+?)부터 (.+)$/u,
    en: "Video $1, track $2, volume $3%, hidden, Short $4 to $5, source $6 to $7",
    ja: "動画 $1、トラック $2、音量 $3%、非表示、ショート $4 から $5、元動画 $6 から $7"
  },
  {
    source: /^쇼츠 (.+?)–(.+?) · 원본 (.+?)–(.+?) · 길이 (.+)$/u,
    en: "Short $1–$2 · source $3–$4 · duration $5",
    ja: "ショート $1〜$2 · 元動画 $3〜$4 · 長さ $5"
  },
  {
    source: /^쇼츠 (.+?)–(.+?) · 원본 (.+?)–(.+)$/u,
    en: "Short $1–$2 · source $3–$4",
    ja: "ショート $1〜$2 · 元動画 $3〜$4"
  },
  {
    source: /^영상 ([\d,.]+)개$/u,
    en: "$1 videos",
    ja: "動画 $1 件"
  },
  {
    source: /^영상 ([\d,.]+)\/([\d,.]+)개$/u,
    en: "Videos $1/$2",
    ja: "動画 $1/$2"
  },
  {
    source: /^기존 방식 음성 ([\d,.]+)개$/u,
    en: "$1 legacy audio tracks",
    ja: "旧方式の音声 $1 件"
  },
  {
    source: /^기존 방식 음성 ([\d,.]+)\/([\d,.]+)개$/u,
    en: "Legacy audio $1/$2",
    ja: "旧方式の音声 $1/$2"
  },
  {
    source: /^영상 ([\d,.]+)\/([\d,.]+) ·$/u,
    en: "Video $1/$2 ·",
    ja: "動画 $1/$2 ·"
  },
  {
    source: /^· 길이 (.+)$/u,
    en: "· duration $1",
    ja: "· 長さ $1"
  },
  {
    source: /^쇼츠 9대16 화면\. 영상 ([\d,.]+)개 중 선택 영상은 원본 (-?[\d,.]+), (-?[\d,.]+)에서 ([\d,.]+) 곱하기 ([\d,.]+)픽셀을 가져와 쇼츠 화면 X (-?[\d,.]+), Y (-?[\d,.]+), ([\d,.]+) 곱하기 ([\d,.]+)픽셀로 배치합니다\.$/u,
    en: "9:16 Short canvas. Of $1 videos, the selected video uses a $4 by $5 pixel source region at $2, $3 and is placed at X $6, Y $7 with a size of $8 by $9 pixels.",
    ja: "9:16 のショート画面。動画 $1 件のうち、選択中の動画は元動画の $2, $3 にある $4 × $5 ピクセルの範囲を使い、ショート画面の X $6、Y $7 に $8 × $9 ピクセルで配置されています。"
  },
  {
    source: /^사용할 원본 화면 (-?[\d,.]+), (-?[\d,.]+), ([\d,.]+) 곱하기 ([\d,.]+)픽셀\. 드래그로 이동하고 가장자리 손잡이로 크기를 조절합니다\.$/u,
    en: "Source frame at $1, $2, sized $3 by $4 pixels. Drag to move it and use the edge handles to resize it.",
    ja: "使用する元画面は $1, $2 の位置、$3 × $4 ピクセルです。ドラッグで移動し、端のハンドルでサイズを調整できます。"
  },
  {
    source: /^(.+) 구간을 영상 ([\d,.]+)개로 추가했습니다\. 화면과 원본 음성은 함께 준비되며 이동·자르기·삭제도 같이 적용됩니다\.$/u,
    en: "Added $2 videos covering $1. Their visuals and source audio are prepared together; moving, trimming, or deleting them applies to both.",
    ja: "$1 の範囲を動画 $2 本として追加しました。画面と元音声は一緒に準備され、移動・トリミング・削除も同時に適用されます。"
  },
  {
    source: /^앞뒤 빈 구간을 (.+)만큼 제거하고 모든 요소를 0초 기준으로 맞췄습니다\. Ctrl\+Z로 되돌릴 수 있습니다\.$/u,
    en: "Removed $1 of empty space from the beginning and end, then aligned every element to start at 0 seconds. Press Ctrl+Z to undo.",
    ja: "前後の空白を $1 削除し、すべての要素を 0 秒基準に揃えました。Ctrl+Z で元に戻せます。"
  },
  {
    source: /^(.+) 구간을 삭제했습니다\. Ctrl\+Z로 되돌릴 수 있습니다\.$/u,
    en: "Deleted a $1 range. Press Ctrl+Z to undo.",
    ja: "$1 の範囲を削除しました。Ctrl+Z で元に戻せます。"
  },
  {
    source: /^(CHZZK|YouTube|SOOP) 편집 영상을 다시 준비한 뒤 조정할 수 있습니다$/u,
    en: "Prepare the $1 editing media again before adjusting.",
    ja: "$1 の編集用動画を再準備すると調整できます"
  },
  {
    source: /^치지직 편집 영상을 다시 준비한 뒤 조정할 수 있습니다$/u,
    en: "Prepare the CHZZK editing media again before adjusting.",
    ja: "CHZZK の編集用動画を再準備すると調整できます"
  },
  {
    source: /^(CHZZK|YouTube|SOOP) 편집 영상을 다시 준비한 뒤 컷 경계를 조정해 주세요\.$/u,
    en: "Prepare the $1 editing media again before adjusting clip boundaries.",
    ja: "$1 の編集用動画を再準備してからクリップ境界を調整してください。"
  },
  {
    source: /^치지직 편집 영상을 다시 준비한 뒤 컷 경계를 조정해 주세요\.$/u,
    en: "Prepare the CHZZK editing media again before adjusting clip boundaries.",
    ja: "CHZZK の編集用動画を再準備してからクリップ境界を調整してください。"
  },
  {
    source: /^캔버스 (.+?)–(.+?) · 원본 (.+?)–(.+?) · (\d+)번 라인 · 음량 ([\d.]+)% · 앞뒤 영상과 독립적으로 이동·자르기 가능$/u,
    en: "Canvas $1–$2 · source $3–$4 · track $5 · volume $6% · can be moved and trimmed independently of adjacent videos",
    ja: "キャンバス $1〜$2 · 元動画 $3〜$4 · トラック $5 · 音量 $6% · 前後の動画とは独立して移動・トリミング可能"
  },
  {
    source: /^캔버스 (.+?)–(.+?) · 원본 (.+?)–(.+)$/u,
    en: "Canvas $1–$2 · source $3–$4",
    ja: "キャンバス $1〜$2 · 元動画 $3〜$4"
  },
  {
    source: /^(\d+) · 음소거 ·$/u,
    en: "$1 · muted ·",
    ja: "$1 · ミュート ·"
  },
  {
    source: /^(\d+) · 원본 ([\d.]+)% ·$/u,
    en: "$1 · source $2% ·",
    ja: "$1 · 元音声 $2% ·"
  },
  {
    source: /^(.+) · 겹친 이미지는 이미지 트랙의 별도 줄에 표시됩니다\.$/u,
    en: "$1 · Overlapping images appear on separate rows of the image track.",
    ja: "$1 · 重なった画像は画像トラックの別の行に表示されます。"
  },
  {
    source: /^쇼츠 재생을 준비하지 못했습니다: (.+)$/u,
    en: "Could not prepare Shorts playback: $1",
    ja: "ショート動画の再生を準備できませんでした: $1"
  },
  {
    source: /^(.+)을 이미지 트랙에 추가했습니다\. 투명 배경도 유지됩니다\.$/u,
    en: "Added $1 to the image track. Transparent backgrounds are preserved.",
    ja: "$1 を画像トラックに追加しました。透過背景も維持されます。"
  },
  {
    source: /^(.+)을 이미지 트랙에 추가했습니다\.$/u,
    en: "Added $1 to the image track.",
    ja: "$1 を画像トラックに追加しました。"
  },
  {
    source: /^약 (.+)$/u,
    en: "about $1",
    ja: "約 $1"
  },
  {
    source: /^자막 에이전트 연결 확인 완료(.*) · Whisper · STT (.+) · 로컬 STT 설정 미완료$/u,
    en: "Caption-agent connection check complete$1 · Whisper · STT $2 · local STT setup incomplete",
    ja: "字幕エージェントの接続確認完了$1 · Whisper · STT $2 · ローカル STT 設定未完了"
  },
  {
    source: /^자막 에이전트 연결 확인 완료(.*) · Whisper · STT (.+)$/u,
    en: "Caption-agent connection check complete$1 · Whisper · STT $2",
    ja: "字幕エージェントの接続確認完了$1 · Whisper · STT $2"
  },
  {
    source: /^자막 방식 설정 저장 실패: (.+)$/u,
    en: "Could not save the caption-method settings: $1",
    ja: "字幕方式の設定を保存できませんでした: $1"
  },
  {
    source: /^SKILL\.md를 복사하지 못했습니다: (.+)$/u,
    en: "Could not copy SKILL.md: $1",
    ja: "SKILL.md をコピーできませんでした: $1"
  },
  {
    source: /^원본은 현재 탭에 연결했지만 재시작용 파일 권한을 저장하지 못했습니다: (.+)$/u,
    en: "The source is connected in this tab, but its file permission could not be saved for the next session: $1",
    ja: "元動画は現在のタブに接続しましたが、次回起動用のファイル権限を保存できませんでした: $1"
  },
  {
    source: /^로컬 편집 영상은 교체했지만 화면 동기화에 실패했습니다: (.+)$/u,
    en: "The local editing media was replaced, but the editor view could not be synchronized: $1",
    ja: "ローカル編集用動画は置き換えましたが、エディター画面を同期できませんでした: $1"
  },
  {
    source: /^(.+) 이전 미리보기도 복구하지 못했습니다: (.+)$/u,
    en: "$1 The previous preview could not be restored either: $2",
    ja: "$1 以前のプレビューも復元できませんでした: $2"
  },
  {
    source: /^VOD 원본 시각으로 정렬값을 되돌리지 못했습니다: (.+)$/u,
    en: "Could not reset alignment to the VOD source timecode: $1",
    ja: "VOD の元タイムコードに合わせて位置を戻せませんでした: $1"
  },
  {
    source: /^본편·쇼츠 로컬 범위를 합치지 못했습니다: (.+)$/u,
    en: "Could not merge the local ranges for the Main Edit and Shorts: $1",
    ja: "本編とショート動画のローカル範囲を統合できませんでした: $1"
  },
  {
    source: /^연결됨 · 이 PC의 (.+)$/u,
    en: "Connected · $1 on this PC",
    ja: "接続済み · この PC の $1"
  },
  {
    source: /^쇼츠 작업은 최대 ([\d,.]+)개까지 만들 수 있습니다\.$/u,
    en: "You can create up to $1 Shorts workspaces.",
    ja: "ショート動画の作業は最大 $1 件まで作成できます。"
  },
  {
    source: /^(\d+) · 사용자 선택$/u,
    en: "$1 · User selection",
    ja: "$1 · ユーザー選択"
  },
  {
    source: /^(\d+)번 레인 자막: 빈 자막$/u,
    en: "Track $1 caption: Empty caption",
    ja: "$1 番トラックの字幕：空の字幕"
  },
  // Runtime/media-engine recovery.
  {
    source: /^(.+?)용 내부 미디어 엔진을 시작하지 못했습니다\. (.+)$/u,
    en: "Could not start the internal media engine for $1. $2",
    ja: "$1 用の内部メディアエンジンを起動できませんでした。$2"
  },
  {
    source: /^(.+?)용 내부 미디어 엔진이 현재 편집 세션을 확인하지 못했습니다\. (.+)$/u,
    en: "The internal media engine for $1 could not verify the current editing session. $2",
    ja: "$1 用の内部メディアエンジンで現在の編集セッションを確認できませんでした。$2"
  },
  {
    source: /^(.+?)용 내부 미디어 엔진이 다른 작업을 마무리하고 있습니다\. 잠시 뒤 같은 버튼을 다시 눌러 주세요\.$/u,
    en: "The internal media engine for $1 is finishing another operation. Press the same button again shortly.",
    ja: "$1 用の内部メディアエンジンが別の処理を終了中です。しばらくしてから同じボタンをもう一度押してください。"
  },
  {
    source: /^(.+?)용 내부 미디어 엔진을 준비하지 못했습니다\. (.+)$/u,
    en: "Could not prepare the internal media engine for $1. $2",
    ja: "$1 用の内部メディアエンジンを準備できませんでした。$2"
  },
  {
    source: /^편집기 필수 UI 요소를 찾지 못했습니다: #(\S+)$/u,
    en: "Required editor UI element not found: #$1",
    ja: "エディターに必要な UI 要素が見つかりません: #$1"
  },
  {
    source: /^편집기 단축키 대상이 없습니다: #(\S+)$/u,
    en: "Editor shortcut target not found: #$1",
    ja: "エディターのショートカット対象がありません: #$1"
  },
  {
    source: /^(.+?) 시작 화면에서 계속할 작업을 다시 선택합니다\.$/u,
    en: "$1 Select the edit to continue again on the start screen.",
    ja: "$1 開始画面で続行する作業を選び直します。"
  },
  {
    source: /^이번 사용 확인 · (.+)$/u,
    en: "Usage confirmation · $1",
    ja: "今回の利用確認 · $1"
  },

  // Localized durations and recovery summaries. Media timecodes themselves
  // deliberately have no matching pattern and remain byte-for-byte stable.
  {
    source: /^(\d+(?:\.\d+)?)초$/u,
    en: "$1 sec",
    ja: "$1 秒"
  },
  {
    source: /^(\d+)분 (\d+)초$/u,
    en: "$1 min $2 sec",
    ja: "$1 分 $2 秒"
  },
  {
    source: /^편집 중 임시 복구됨 (.+)$/u,
    en: "Edit recovery saved $1",
    ja: "編集中の一時復元を保存 $1"
  },
  {
    source: /^· 최근 5분 복구 (.+)$/u,
    en: "· Latest five-minute recovery $1",
    ja: "· 最新の 5 分復元 $1"
  },
  {
    source: /^· 현재 복구본 ([0-5])\/5$/u,
    en: "· Current recovery copies $1/5",
    ja: "· 現在の復元データ $1/5"
  },
  {
    source: /^컷 ([\d,.]+)개$/u,
    en: "Clips: $1",
    ja: "クリップ: $1"
  },
  {
    source: /^자막 ([\d,.]+)개$/u,
    en: "Captions: $1",
    ja: "字幕: $1"
  },
  {
    source: /^이미지 ([\d,.]+)개$/u,
    en: "Images: $1",
    ja: "画像: $1"
  },
  {
    source: /^음성 ([\d,.]+)개$/u,
    en: "Audio: $1",
    ja: "音声: $1"
  },
  {
    source: /^저장·복구본 ([\d,.]+)개 불러오기$/u,
    en: "Load $1 saved/recovery copies",
    ja: "保存・復元データ $1 件を読み込む"
  },
  {
    source: /^자동 생성 자막 ([\d,.]+)개의 화면 위치를 아래 중앙 기본값으로 맞췄습니다\.$/u,
    en: "Reset the on-screen position of $1 auto-generated captions to bottom center.",
    ja: "自動生成字幕 $1 件の画面位置を下中央の既定値に合わせました。"
  },

  // Stable error wrappers. The captured diagnostic is intentionally retained
  // verbatim until its producer exposes a stable error code.
  {
    source: /^프로젝트 저장 실패: (.+)$/u,
    en: "Could not save project: $1",
    ja: "プロジェクトの保存に失敗: $1"
  },
  {
    source: /^저장 실패: (.+)$/u,
    en: "Save failed: $1",
    ja: "保存に失敗: $1"
  },
  {
    source: /^편집 중 임시 복구 실패: (.+)$/u,
    en: "Edit recovery failed: $1",
    ja: "編集中の一時復元に失敗: $1"
  },
  {
    source: /^저장본 목록을 열지 못했습니다: (.+)$/u,
    en: "Could not open saved versions: $1",
    ja: "保存版の一覧を開けませんでした: $1"
  },
  {
    source: /^편집 종료는 완료했지만 시작 화면으로 이동하지 못했습니다\. 주소의 첫 화면으로 이동해 주세요: (.+)$/u,
    en: "The edit was closed, but the start screen could not be opened. Go to the first page of this address: $1",
    ja: "編集は終了しましたが、開始画面へ移動できませんでした。このアドレスの最初の画面へ移動してください: $1"
  },
  {
    source: /^편집 시작 상태가 사라져 저장·폐기를 확정하지 않았습니다\. 이 탭에서는 더 쓰지 않고 시작 화면에서 다시 확인해 주세요: (.+)$/u,
    en: "The edit's starting state is gone, so save or discard was not committed. Stop using this tab and check again from the start screen: $1",
    ja: "編集の開始状態が失われたため、保存・破棄を確定しませんでした。このタブは使用せず、開始画面から再確認してください: $1"
  },
  {
    source: /^작업 종료를 완료하지 못했습니다\. 현재 편집은 그대로 열어 두었습니다: (.+)$/u,
    en: "Could not finish closing the edit. The current editor remains open: $1",
    ja: "作業の終了を完了できませんでした。現在の編集はそのまま開いています: $1"
  },
  {
    source: /^저장본 불러오기 실패: (.+)$/u,
    en: "Could not load saved version: $1",
    ja: "保存版の読み込みに失敗: $1"
  },
  {
    source: /^경계 프레임을 열지 못했습니다: (.+)$/u,
    en: "Could not open the boundary frame: $1",
    ja: "境界フレームを開けませんでした: $1"
  },
  {
    source: /^이미지를 저장하지 못했습니다: (.+)$/u,
    en: "Could not save the image: $1",
    ja: "画像を保存できませんでした: $1"
  },
  {
    source: /^클립보드 이미지를 읽지 못했습니다: (.+)$/u,
    en: "Could not read the clipboard image: $1",
    ja: "クリップボードの画像を読み取れませんでした: $1"
  },
  {
    source: /^원본 파일을 열지 못했습니다: (.+)$/u,
    en: "Could not open the source file: $1",
    ja: "元ファイルを開けませんでした: $1"
  },
  {
    source: /^VOD 편집 영상을 준비하지 못했습니다: (.+) 내 파일 직접 연결도 사용할 수 있습니다\.$/u,
    en: "Could not prepare VOD editing media: $1 You can also connect your own file.",
    ja: "VOD 編集用動画を準備できませんでした: $1 自分のファイルを直接接続することもできます。"
  },
  {
    source: /^추가 편집 범위를 준비하지 못했습니다: (.+)$/u,
    en: "Could not prepare the additional editing range: $1",
    ja: "追加の編集範囲を準備できませんでした: $1"
  },
  {
    source: /^Whisper 자동 연결 실패: (.+)$/u,
    en: "Automatic Whisper connection failed: $1",
    ja: "Whisper の自動接続に失敗: $1"
  },
  {
    source: /^자동 연결 실패 · (.+)$/u,
    en: "Automatic connection failed · $1",
    ja: "自動接続に失敗 · $1"
  },
  {
    source: /^자막 초벌 설정을 확인해 주세요: (.+)$/u,
    en: "Check the caption-draft settings: $1",
    ja: "字幕下書きの設定を確認してください: $1"
  },
  {
    source: /^Whisper를 준비하지 못했습니다: (.+) AudSeg는 바로 사용할 수 있습니다\.$/u,
    en: "Could not prepare Whisper: $1 AudSeg is available immediately.",
    ja: "Whisper を準備できませんでした: $1 AudSeg はすぐに使用できます。"
  },
  {
    source: /^AI 자막 실패: (.+)$/u,
    en: "AI caption operation failed: $1",
    ja: "AI 字幕処理に失敗: $1"
  },
  {
    source: /^내보내기 전 안전 백업에 실패해 작업을 중단했습니다: (.+)$/u,
    en: "Export stopped because the safety backup failed: $1",
    ja: "安全バックアップに失敗したため書き出しを中止しました: $1"
  },
  {
    source: /^저장 폴더를 열지 못했습니다: (.+)$/u,
    en: "Could not open the save folder: $1",
    ja: "保存フォルダーを開けませんでした: $1"
  },
  {
    source: /^자막 폰트를 준비하지 못했습니다: (.+)$/u,
    en: "Could not prepare the caption font: $1",
    ja: "字幕フォントを準備できませんでした: $1"
  },
  {
    source: /^이 브라우저에서 영상 인코더를 준비하지 못했습니다: (.+)$/u,
    en: "Could not prepare a video encoder in this browser: $1",
    ja: "このブラウザーで動画エンコーダーを準備できませんでした: $1"
  },
  {
    source: /^저장 폴더를 확인하지 못했습니다: (.+)$/u,
    en: "Could not verify the save folder: $1",
    ja: "保存フォルダーを確認できませんでした: $1"
  },
  {
    source: /^다시 편집할 때 필요한 복원 파일을 만들지 못해 내보내기를 중단했습니다: (.+)$/u,
    en: "Export stopped because the recovery file needed for future editing could not be created: $1",
    ja: "再編集に必要な復元ファイルを作成できなかったため、書き出しを中止しました: $1"
  },
  {
    source: /^영상 출력 파일을 만들지 못했습니다: (.+)$/u,
    en: "Could not create the video output file: $1",
    ja: "動画出力ファイルを作成できませんでした: $1"
  },
  {
    source: /^쇼츠 편집을 열지 못했습니다: (.+)$/u,
    en: "Could not open Short editing: $1",
    ja: "ショート編集を開けませんでした: $1"
  },
  {
    source: /^본편으로 돌아가지 못했습니다: (.+)$/u,
    en: "Could not return to the main video: $1",
    ja: "本編に戻れませんでした: $1"
  },
  {
    source: /^쇼츠 소스를 추가하지 못했습니다: (.+)$/u,
    en: "Could not add the Short source: $1",
    ja: "ショート素材を追加できませんでした: $1"
  },
  {
    source: /^편집 복원 파일을 열지 못했습니다: (.+)$/u,
    en: "Could not open the edit-recovery file: $1",
    ja: "編集復元ファイルを開けませんでした: $1"
  },
  {
    source: /^쇼츠 미리보기를 다시 만들지 못했습니다: (.+)$/u,
    en: "Could not rebuild the Short preview: $1",
    ja: "ショートプレビューを再作成できませんでした: $1"
  },
  {
    source: /^(.+) 영상의 이 기기 재생을 시작하지 못했습니다\.$/u,
    en: "Could not start local playback for video $1.",
    ja: "動画 $1 のローカル再生を開始できませんでした。"
  },
  {
    source: /^(.+) 영상의 미리보기를 준비하지 못했습니다\.$/u,
    en: "Could not prepare the preview for video $1.",
    ja: "動画 $1 のプレビューを準備できませんでした。"
  },
  {
    source: /^(.+) 영상의 화면 배치를 계산하지 못했습니다\.$/u,
    en: "Could not calculate the framing for video $1.",
    ja: "動画 $1 の画面配置を計算できませんでした。"
  },
  {
    source: /^쇼츠 작업 전환 실패: (.+)$/u,
    en: "Could not switch Shorts workspaces: $1",
    ja: "ショート動画プロジェクトの切り替えに失敗: $1"
  },
  {
    source: /^새 쇼츠 작업 생성 실패: (.+)$/u,
    en: "Could not create the Shorts workspace: $1",
    ja: "新しいショート動画プロジェクトの作成に失敗: $1"
  },
  {
    source: /^쇼츠 작업 복제 실패: (.+)$/u,
    en: "Could not duplicate the Shorts workspace: $1",
    ja: "ショート動画プロジェクトの複製に失敗: $1"
  },
  {
    source: /^쇼츠 작업 삭제 실패: (.+)$/u,
    en: "Could not delete the Shorts workspace: $1",
    ja: "ショート動画プロジェクトの削除に失敗: $1"
  },
  {
    source: /^영상 추가를 시작하지 못했습니다: (.+)$/u,
    en: "Could not start adding video: $1",
    ja: "動画の追加を開始できませんでした: $1"
  },
  {
    source: /^AI 자막 위치를 정렬하지 못했습니다: (.+)$/u,
    en: "Could not align AI caption positions: $1",
    ja: "AI 字幕の位置を整列できませんでした: $1"
  },
  {
    source: /^Codex 로컬 자막 초벌을 적용하지 못했습니다: (.+)$/u,
    en: "Could not apply the Codex local caption draft: $1",
    ja: "Codex のローカル字幕下書きを適用できませんでした: $1"
  },

  // Clip list, colors, captions, and audio.
  {
    source: /^품질 검수 필요 ([\d,.]+)건 · (.+)\. 표시된 컷 원음을 확인해 주세요\.$/u,
    en: "$1 quality issues need review · $2. Check the source audio for the marked clips.",
    ja: "品質確認が必要な項目 $1 件 · $2。マークされたクリップの元音声を確認してください。"
  },
  {
    source: /^자동 품질 검사에서 정리한 항목 ([\d,.]+)건 · (.+)$/u,
    en: "$1 items cleaned up by automatic quality checks · $2",
    ja: "自動品質検査で整理した項目 $1 件 · $2"
  },
  {
    source: /^([\d,.]+)개 컷 체크됨$/u,
    en: "$1 clips checked",
    ja: "クリップ $1 件を選択"
  },
  {
    source: /^(\d+)번 컷 선택 구간 (\d+), 묶음 이동 선택$/u,
    en: "Clip $1 selected range $2, select for group move",
    ja: "$1 番クリップ 選択範囲 $2、グループ移動に選択"
  },
  {
    source: /^(\d+)번 컷 선택 구간 (\d+), 맨 처음으로 이동$/u,
    en: "Clip $1 selected range $2, move to beginning",
    ja: "$1 番クリップ 選択範囲 $2、先頭へ移動"
  },
  {
    source: /^(\d+)번 컷 선택 구간 (\d+), 한 칸 위로 이동$/u,
    en: "Clip $1 selected range $2, move up one",
    ja: "$1 番クリップ 選択範囲 $2、1 つ上へ移動"
  },
  {
    source: /^(\d+)번 컷 선택 구간 (\d+), 한 칸 아래로 이동$/u,
    en: "Clip $1 selected range $2, move down one",
    ja: "$1 番クリップ 選択範囲 $2、1 つ下へ移動"
  },
  {
    source: /^(\d+)번 컷 선택 구간 (\d+), 맨 마지막으로 이동$/u,
    en: "Clip $1 selected range $2, move to end",
    ja: "$1 番クリップ 選択範囲 $2、末尾へ移動"
  },
  {
    source: /^([\d,.]+)개 컷을 한 단계 위로 이동$/u,
    en: "Move $1 clips up one position",
    ja: "クリップ $1 件を 1 つ上へ移動"
  },
  {
    source: /^([\d,.]+)개 컷을 한 단계 아래로 이동$/u,
    en: "Move $1 clips down one position",
    ja: "クリップ $1 件を 1 つ下へ移動"
  },
  {
    source: /^선택 구간 ([\d,.]+)$/u,
    en: "Selected range $1",
    ja: "選択範囲 $1"
  },
  {
    source: /^(\d+)번 컷 (.+), 묶음 이동 선택$/u,
    en: "Clip $1 $2, select for group move",
    ja: "$1 番クリップ $2、グループ移動に選択"
  },
  {
    source: /^(\d+)번 컷 (.+), 맨 처음으로 이동$/u,
    en: "Clip $1 $2, move to beginning",
    ja: "$1 番クリップ $2、先頭へ移動"
  },
  {
    source: /^(\d+)번 컷 (.+), 한 칸 위로 이동$/u,
    en: "Clip $1 $2, move up one",
    ja: "$1 番クリップ $2、1 つ上へ移動"
  },
  {
    source: /^(\d+)번 컷 (.+), 한 칸 아래로 이동$/u,
    en: "Clip $1 $2, move down one",
    ja: "$1 番クリップ $2、1 つ下へ移動"
  },
  {
    source: /^(\d+)번 컷 (.+), 맨 마지막으로 이동$/u,
    en: "Clip $1 $2, move to end",
    ja: "$1 番クリップ $2、末尾へ移動"
  },
  {
    source: /^(\d+)번 컷 앞쪽 30초를 이 기기에 추가$/u,
    en: "Add 30 seconds before clip $1 to this device",
    ja: "$1 番クリップの前 30 秒をこのデバイスに追加"
  },
  {
    source: /^(\d+)번 컷 뒤쪽 30초를 이 기기에 추가$/u,
    en: "Add 30 seconds after clip $1 to this device",
    ja: "$1 番クリップの後 30 秒をこのデバイスに追加"
  },
  {
    source: /^비어 있는 최근 색상 슬롯 (\d+) · 단축키 (.+)$/u,
    en: "Empty recent-color slot $1 · shortcut $2",
    ja: "空の最近使った色スロット $1 · ショートカット $2"
  },
  {
    source: /^비어 있는 색상 슬롯 · (.+)$/u,
    en: "Empty color slot · $1",
    ja: "空の色スロット · $1"
  },
  {
    source: /^기본 흰색 (#[0-9A-Fa-f]{3,8}) · 단축키 (.+)$/u,
    en: "Default white $1 · shortcut $2",
    ja: "既定の白 $1 · ショートカット $2"
  },
  {
    source: /^최근 자막 색상 (\d+) (#[0-9A-Fa-f]{3,8}) · 단축키 (.+)$/u,
    en: "Recent caption color $1 $2 · shortcut $3",
    ja: "最近の字幕色 $1 $2 · ショートカット $3"
  },
  {
    source: /^(.+)의 시작·끝 시각을 그대로 적용합니다\.$/u,
    en: "Apply $1's start and end times exactly.",
    ja: "$1 の開始・終了時刻をそのまま適用します。"
  },
  {
    source: /^“(.+)”의 시작·끝 시각을 그대로 적용합니다\.$/u,
    en: "Apply the exact start and end times of “$1.”",
    ja: "「$1」の開始・終了時刻をそのまま適用します。"
  },
  {
    source: /^(.+) 미리보기$/u,
    en: "$1 preview",
    ja: "$1 プレビュー"
  },
  {
    source: /^(\d+)번 컷 · 음성 설정$/u,
    en: "Clip $1 · audio settings",
    ja: "$1 番クリップ · 音声設定"
  },

  // Source-media readiness.
  {
    source: /^(CHZZK|치지직) 편집 영상 미준비$/u,
    en: "CHZZK editing media not prepared",
    ja: "CHZZK 編集用動画は未準備"
  },
  {
    source: /^YouTube 편집 영상 미준비$/u,
    en: "YouTube editing media not prepared",
    ja: "YouTube 編集用動画は未準備"
  },
  {
    source: /^SOOP 편집 영상 미준비$/u,
    en: "SOOP editing media not prepared",
    ja: "SOOP 編集用動画は未準備"
  },
  {
    source: /^(CHZZK|치지직) 편집 영상 준비됨$/u,
    en: "CHZZK editing media ready",
    ja: "CHZZK 編集用動画を準備済み"
  },
  {
    source: /^YouTube 편집 영상 준비됨$/u,
    en: "YouTube editing media ready",
    ja: "YouTube 編集用動画を準備済み"
  },
  {
    source: /^SOOP 편집 영상 준비됨$/u,
    en: "SOOP editing media ready",
    ja: "SOOP 編集用動画を準備済み"
  },
  {
    source: /^(.+?) · 구간 ([\d,.]+)개 · 필요한 앞뒤 범위를 더 준비할 수 있음$/u,
    en: "$1 · $2 ranges · more media can be prepared before and after them",
    ja: "$1 · 範囲 $2 件 · 必要な前後の範囲を追加準備可能"
  },
  {
    source: /^(CHZZK|YouTube|SOOP) 원본 확인 중$/u,
    en: "Checking $1 source",
    ja: "$1 の元動画を確認中"
  },
  {
    source: /^치지직 원본 확인 중$/u,
    en: "Checking CHZZK source",
    ja: "CHZZK の元動画を確認中"
  },
  {
    source: /^(CHZZK|YouTube|SOOP) 원본 시각과 최초 ±10초 편집 핸들을 확인합니다\.$/u,
    en: "Checking the $1 source timing and initial ±10-second editing handles.",
    ja: "$1 の元動画時刻と初期 ±10 秒編集ハンドルを確認します。"
  },
  {
    source: /^치지직 원본 시각과 최초 ±10초 편집 핸들을 확인합니다\.$/u,
    en: "Checking the CHZZK source timing and initial ±10-second editing handles.",
    ja: "CHZZK の元動画時刻と初期 ±10 秒編集ハンドルを確認します。"
  },
  {
    source: /^먼저 (CHZZK|YouTube|SOOP) 편집 영상을 준비해 주세요\.$/u,
    en: "Prepare $1 editing media first.",
    ja: "先に $1 の編集用動画を準備してください。"
  },
  {
    source: /^먼저 치지직 편집 영상을 준비해 주세요\.$/u,
    en: "Prepare CHZZK editing media first.",
    ja: "先に CHZZK の編集用動画を準備してください。"
  },
  {
    source: /^현재 컷과 맞는 (CHZZK|YouTube|SOOP) VOD 선택 구간을 다시 준비해 주세요\.$/u,
    en: "Prepare the selected $1 VOD range matching the current clip again.",
    ja: "現在のクリップに合う $1 VOD の選択範囲を再度準備してください。"
  },
  {
    source: /^현재 컷과 맞는 치지직 VOD 선택 구간을 다시 준비해 주세요\.$/u,
    en: "Prepare the selected CHZZK VOD range matching the current clip again.",
    ja: "現在のクリップに合う CHZZK VOD の選択範囲を再度準備してください。"
  },
  {
    source: /^(CHZZK|YouTube|SOOP) 로컬 편집 영상의 컷 범위를 다시 확인해 주세요\.$/u,
    en: "Check the clip ranges in the local $1 editing media again.",
    ja: "$1 のローカル編集用動画のクリップ範囲を再確認してください。"
  },
  {
    source: /^치지직 로컬 편집 영상의 컷 범위를 다시 확인해 주세요\.$/u,
    en: "Check the clip ranges in the local CHZZK editing media again.",
    ja: "CHZZK のローカル編集用動画のクリップ範囲を再確認してください。"
  },

  // Shorts workspace, layer list, geometry, and accessibility.
  {
    source: /^⚠ 비율 변형 · 가로 ([\d.]+)배 \/ 세로 ([\d.]+)배 · (.+)$/u,
    en: "⚠ Aspect distortion · horizontal $1× / vertical $2× · $3",
    ja: "⚠ 比率変形 · 横 $1 倍 / 縦 $2 倍 · $3"
  },
  {
    source: /^⚠ 원본 (\d+)×(\d+)px을 ([\d.]+)배 확대 · (.+) · 원본 디테일 한계$/u,
    en: "⚠ Source $1×$2 px enlarged $3× · $4 · limited by source detail",
    ja: "⚠ 元画像 $1×$2 px を $3 倍に拡大 · $4 · 元のディテールが上限"
  },
  {
    source: /^원본 (\d+)×(\d+)px을 ([\d.]+)배 확대 · (.+)$/u,
    en: "Source $1×$2 px enlarged $3× · $4",
    ja: "元画像 $1×$2 px を $3 倍に拡大 · $4"
  },
  {
    source: /^원본 (\d+)×(\d+)px에서 고품질 축소$/u,
    en: "High-quality downscaling from $1×$2 px source",
    ja: "$1×$2 px の元画像から高品質縮小"
  },
  {
    source: /^원본 (\d+)×(\d+)px · 원본 크기 수준$/u,
    en: "Source $1×$2 px · near native size",
    ja: "元画像 $1×$2 px · 元サイズ相当"
  },
  {
    source: /^현재 시각 최대 ([\d,.]+)개$/u,
    en: "Up to $1 at the current time",
    ja: "現在時刻では最大 $1 個"
  },
  {
    source: /^본편 컷 (\d+)$/u,
    en: "Main clip $1",
    ja: "本編クリップ $1"
  },
  {
    source: /^쇼츠 (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)–(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/u,
    en: "Short $1–$2",
    ja: "ショート $1–$2"
  },
  {
    source: /^· 원본 (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)–(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/u,
    en: "· Source $1–$2",
    ja: "· 元動画 $1–$2"
  },
  {
    source: /^L(\d+) · 화면 ([\d.]+)% · 소리 ([\d.]+)%$/u,
    en: "L$1 · visual $2% · audio $3%",
    ja: "L$1 · 画面 $2% · 音声 $3%"
  },
  {
    source: /^(\d+)번 영상 (.+) 삭제$/u,
    en: "Delete video $1 $2",
    ja: "$1 番動画「$2」を削除"
  },
  {
    source: /^영상 ([\d,.]+)\/([\d,.]+)개 · 이 기기에서 미리보기 준비 중$/u,
    en: "Videos $1/$2 · preparing previews on this device",
    ja: "動画 $1/$2 · このデバイスでプレビューを準備中"
  },
  {
    source: /^영상 미리보기 준비 실패 · (.+)$/u,
    en: "Video preview preparation failed · $1",
    ja: "動画プレビューの準備に失敗 · $1"
  },
  {
    source: /^영상 ([\d,.]+)개 · 미리보기 준비됨$/u,
    en: "$1 video previews ready",
    ja: "動画 $1 件のプレビューを準備済み"
  },
  {
    source: /^영상 ([\d,.]+)\/([\d,.]+)개 · 미리보기 준비 필요$/u,
    en: "Videos $1/$2 · previews need preparation",
    ja: "動画 $1/$2 · プレビューの準備が必要"
  },
  {
    source: /^현재 화면의 최종 합성에서 미세 틈 ([\d,.]+)개 감지 · ‘모두 밀기’로 관련 영상만 맞닿게 확장할 수 있습니다\.$/u,
    en: "$1 small gaps detected in the final composite at the current time · “Push all” can extend only the related videos until they touch.",
    ja: "現在画面の最終合成で微細な隙間を $1 件検出 · 「すべて押す」で関連する動画だけを接するまで拡張できます。"
  },
  {
    source: /^미세한 검은 틈 감지 · (.+)$/u,
    en: "Small black gaps detected · $1",
    ja: "微細な黒い隙間を検出 · $1"
  },
  {
    source: /^영상 (\d+)\/(\d+) · (.+)$/u,
    en: "Video $1/$2 · $3",
    ja: "動画 $1/$2 · $3"
  },
  {
    source: /^영상이 없는 시간도 정상 편집 상태입니다 · 전체 (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/u,
    en: "Times with no video are valid editing states · total $1",
    ja: "動画がない時間も正常な編集状態です · 全体 $1"
  },
  {
    source: /^(.+)이 가장 많이 쓰인 값과 다릅니다\. 오류로 확정된 것은 아닙니다\.$/u,
    en: "$1 differs from the most-used value. This does not necessarily indicate an error.",
    ja: "$1 は最も多く使われている値と異なります。エラーと確定したわけではありません。"
  },
  {
    source: /^컷 안 (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/u,
    en: "$1 into clip",
    ja: "クリップ内 $1"
  },
  {
    source: /^(\d+)번 자막 편집 · (\d+)번 컷 · 컷 안 (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?) · (\d+)번 레인$/u,
    en: "Edit caption $1 · clip $2 · $3 into clip · track $4",
    ja: "$1 番字幕を編集 · $2 番クリップ · クリップ内 $3 · $4 番トラック"
  },
  {
    source: /^(\d+)번 자막 편집 · (\d+)번 컷 · (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?) · (\d+)번 레인$/u,
    en: "Edit caption $1 · clip $2 · $3 · track $4",
    ja: "$1 番字幕を編集 · $2 番クリップ · $3 · $4 番トラック"
  },
  {
    source: /^(\d+)번 출력 제외 자막 · 편집하려면 (\d+)번 컷을 활성화하세요$/u,
    en: "Excluded caption $1 · enable clip $2 to edit it",
    ja: "$1 番の出力対象外字幕 · 編集するには $2 番クリップを有効にしてください"
  },
  {
    source: /^컷 (\d+)$/u,
    en: "Clip $1",
    ja: "クリップ $1"
  },
  {
    source: /^(.+) · ([\d,.]+)개$/u,
    en: "$1 · $2",
    ja: "$1 · $2 件"
  },
  {
    source: /^설정 ([\d,.]+)묶음$/u,
    en: "$1 setting groups",
    ja: "設定 $1 グループ"
  },
  {
    source: /^가장 많이 쓰인 값과 다른 자막 ([\d,.]+)개$/u,
    en: "$1 captions differ from the most-used values",
    ja: "最も多く使われている値と異なる字幕 $1 件"
  },
  {
    source: /^단독 설정 ([\d,.]+)개$/u,
    en: "$1 unique settings",
    ja: "単独設定 $1 件"
  },
  {
    source: /^출력 제외 ([\d,.]+)개$/u,
    en: "$1 excluded",
    ja: "出力対象外 $1 件"
  },
  {
    source: /^연결된 컷 없음 ([\d,.]+)개$/u,
    en: "$1 with no linked clip",
    ja: "接続クリップなし $1 件"
  },
  {
    source: /^프로젝트 공통 외곽선 (#[A-Fa-f0-9]{6}) · ([\d.]+%) · 행별 검은 상자와는 별도$/u,
    en: "Project-wide outline $1 · $2 · separate from each row's black box",
    ja: "プロジェクト共通の縁取り $1 · $2 · 行ごとの黒いボックスとは別設定"
  },
  {
    source: /^“(.+)” 작업 삭제$/u,
    en: "Delete “$1” workspace",
    ja: "「$1」作業を削除"
  },
  {
    source: /^“(.+)” 쇼츠 작업으로 전환했습니다\.$/u,
    en: "Switched to the “$1” Shorts workspace.",
    ja: "「$1」ショート動画プロジェクトに切り替えました。"
  },
  {
    source: /^(.+) 복사본$/u,
    en: "$1 copy",
    ja: "$1 のコピー"
  },
  {
    source: /^“(.+)”을 만들었습니다\. 원본 작업과 독립적으로 편집됩니다\.$/u,
    en: "Created “$1.” It can be edited independently of the original workspace.",
    ja: "「$1」を作成しました。元の作業とは独立して編集されます。"
  },
  {
    source: /^“(.+)” 새 쇼츠 작업을 만들었습니다\.$/u,
    en: "Created the new “$1” Shorts workspace.",
    ja: "新しい「$1」ショート動画プロジェクトを作成しました。"
  },
  {
    source: /^“(.+)” 쇼츠 작업을 삭제할까요\? 이 작업의 자막·영상 배치·실행 취소 기록은 복구할 수 없습니다\.$/u,
    en: "Delete the “$1” Shorts workspace? Its captions, video layout, and undo history cannot be recovered.",
    ja: "「$1」ショート動画プロジェクトを削除しますか？この作業の字幕・動画配置・取り消し履歴は復元できません。"
  },
  {
    source: /^“(.+)” 쇼츠 작업을 삭제했습니다\.$/u,
    en: "Deleted the “$1” Shorts workspace.",
    ja: "「$1」ショート動画プロジェクトを削除しました。"
  },
  {
    source: /^쇼츠 편집기 열기, 현재 영상 조각 ([\d,.]+)개$/u,
    en: "Open Short editor, currently $1 video fragments",
    ja: "ショートエディターを開く、現在の動画断片 $1 件"
  },
  {
    source: /^영상 0\/([\d,.]+) · 이 기기에서 미리보기 준비 시작$/u,
    en: "Videos 0/$1 · starting preview preparation on this device",
    ja: "動画 0/$1 · このデバイスでプレビュー準備を開始"
  },
  {
    source: /^영상 (\d+)\/(\d+) · ([\d.]+)% · 이 기기에서 미리보기 준비 중$/u,
    en: "Video $1/$2 · $3% · preparing preview on this device",
    ja: "動画 $1/$2 · $3% · このデバイスでプレビューを準備中"
  },
  {
    source: /^영상 ([\d,.]+)개 미리보기 준비 완료$/u,
    en: "Previews ready for $1 videos",
    ja: "動画 $1 件のプレビュー準備完了"
  },
  {
    source: /^기존 쇼츠 ([\d,.]+)개를 픽셀 편집 방식으로 변환했습니다\. 화면 모양은 그대로 유지됩니다\.$/u,
    en: "Converted $1 existing Shorts to pixel-based editing. Their appearance is unchanged.",
    ja: "既存のショート $1 件をピクセル編集方式に変換しました。画面の見た目は維持されます。"
  },
  {
    source: /^같은 시각에는 영상을 최대 ([\d,.]+)개까지 겹칠 수 있습니다\.$/u,
    en: "Up to $1 videos can overlap at the same time.",
    ja: "同じ時刻には最大 $1 本の動画を重ねられます。"
  },
  {
    source: /^현재 쇼츠 시각에는 영상을 더 겹칠 수 없습니다\. 동시에 최대 ([\d,.]+)개까지 놓을 수 있습니다\.$/u,
    en: "No more videos can overlap at the current Short time. Up to $1 can be placed simultaneously.",
    ja: "現在のショート時刻にはこれ以上動画を重ねられません。同時に配置できるのは最大 $1 本です。"
  },
  {
    source: /^영상 ([\d,.]+)개를 쇼츠에 추가했습니다\. 화면과 원본 음성이 함께 움직입니다\.$/u,
    en: "Added $1 videos to the Short. Their visuals and source audio move together.",
    ja: "動画 $1 本をショートに追加しました。画面と元音声は一緒に移動します。"
  },
  {
    source: /^쇼츠 영상 미리보기를 준비하지 못했습니다\. 편집 내용은 유지됩니다: (.+)$/u,
    en: "Could not prepare the Short video preview. Your edits are preserved: $1",
    ja: "ショート動画のプレビューを準備できませんでした。編集内容は維持されています: $1"
  },
  {
    source: /^현재 합성 화면의 미세한 검은 틈 ([\d,.]+)개를 관련 영상끼리 맞닿게 밀었습니다\. 원본 크롭은 유지됩니다\.$/u,
    en: "Closed $1 small black gaps in the current composite by extending related videos until they touch. Source crops are unchanged.",
    ja: "現在の合成画面の微細な黒い隙間 $1 件を、関連動画同士が接するまで押し広げました。元のクロップは維持されます。"
  },
  {
    source: /^(.+?)의 미세한 검은 틈을 화면 끝까지 보정했습니다\. 가져올 원본 영역은 유지됩니다\.$/u,
    en: "Corrected the small black gap on the $1 edge to the canvas boundary. The selected source region is unchanged.",
    ja: "$1側の微細な黒い隙間を画面端まで補正しました。取り込む元領域は維持されます。"
  },
  {
    source: /^선택 영상\. 쇼츠 화면 X (-?\d+), Y (-?\d+), 너비 (\d+), 높이 (\d+)픽셀\.$/u,
    en: "Selected video. Short canvas X $1, Y $2, width $3, height $4 pixels.",
    ja: "選択中の動画。ショート画面 X $1、Y $2、幅 $3、高さ $4 ピクセル。"
  },
  {
    source: /^(\d+)번 컷의 시작부터 끝까지 선택$/u,
    en: "Select all of clip $1",
    ja: "$1 番クリップの開始から終了までを選択"
  },
  {
    source: /^(\d+)번 컷 끝까지 (.+)$/u,
    en: "$1 to the end of clip $2",
    ja: "$1 番クリップの終わりまで $2"
  },
  {
    source: /^L(\d+) 영상 시작$/u,
    en: "L$1 video start",
    ja: "L$1 動画開始"
  },
  {
    source: /^L(\d+) 영상 끝$/u,
    en: "L$1 video end",
    ja: "L$1 動画終了"
  },
  {
    source: /^자막 (\d+) 레인$/u,
    en: "Caption track $1",
    ja: "字幕トラック $1"
  },
  {
    source: /^(\d+)번 쇼츠 영상 시작 시각$/u,
    en: "Short video $1 start time",
    ja: "$1 番ショート動画の開始時刻"
  },
  {
    source: /^(\d+)번 쇼츠 영상 끝 시각$/u,
    en: "Short video $1 end time",
    ja: "$1 番ショート動画の終了時刻"
  },
  {
    source: /^(\d+)번 원본 음성 삭제$/u,
    en: "Delete source audio $1",
    ja: "$1 番の元音声を削除"
  },
  {
    source: /^(\d+)번 원본 음성 시작 시각$/u,
    en: "Source audio $1 start time",
    ja: "$1 番元音声の開始時刻"
  },
  {
    source: /^(\d+)번 원본 음성 끝 시각$/u,
    en: "Source audio $1 end time",
    ja: "$1 番元音声の終了時刻"
  },
  {
    source: /^(\d+)번 컷 시작 시각$/u,
    en: "Clip $1 start time",
    ja: "$1 番クリップの開始時刻"
  },
  {
    source: /^(\d+)번 컷 끝 시각$/u,
    en: "Clip $1 end time",
    ja: "$1 番クリップの終了時刻"
  },
  {
    source: /^(\d+) · 원본 음성$/u,
    en: "$1 · source audio",
    ja: "$1 · 元音声"
  },
  {
    source: /^이미지 (\d+)$/u,
    en: "Image $1",
    ja: "画像 $1"
  },
  {
    source: /^(\d+)번 이미지 시작 시각$/u,
    en: "Image $1 start time",
    ja: "$1 番画像の開始時刻"
  },
  {
    source: /^(\d+)번 이미지 끝 시각$/u,
    en: "Image $1 end time",
    ja: "$1 番画像の終了時刻"
  },
  {
    source: /^음량 ([\d.]+)%$/u,
    en: "Volume $1%",
    ja: "音量 $1%"
  },
  {
    source: /^(\d+)번 음성 설정 시작 시각$/u,
    en: "Audio setting $1 start time",
    ja: "$1 番音声設定の開始時刻"
  },
  {
    source: /^(\d+)번 음성 설정 끝 시각$/u,
    en: "Audio setting $1 end time",
    ja: "$1 番音声設定の終了時刻"
  },
  {
    source: /^(\d+)번 자막 시작 시각$/u,
    en: "Caption $1 start time",
    ja: "$1 番字幕の開始時刻"
  },
  {
    source: /^(\d+)번 자막 끝 시각$/u,
    en: "Caption $1 end time",
    ja: "$1 番字幕の終了時刻"
  },
  {
    source: /^이미지: (.+)$/u,
    en: "Image: $1",
    ja: "画像: $1"
  },
  {
    source: /^(\d+)번 레인 자막: (.+)$/u,
    en: "Track $1 caption: $2",
    ja: "$1 番トラックの字幕: $2"
  },

  // Caption-agent progress and summaries.
  {
    source: /^연결된 모델: (.+?) \(([^)]+)\)$/u,
    en: "Connected model: $1 ($2)",
    ja: "接続モデル: $1 ($2)"
  },
  {
    source: /^(.+) · 모델 파일 (.+)$/u,
    en: "$1 · model file $2",
    ja: "$1 · モデルファイル $2"
  },
  {
    source: /^AudSeg (\S+) 준비됨 · 모델·전사·네트워크 없음$/u,
    en: "AudSeg $1 ready · no model, transcription, or network",
    ja: "AudSeg $1 準備完了 · モデル・文字起こし・ネットワークなし"
  },
  {
    source: /^현재 Kirinuki가 검증하는 Whisper 모델이 아닙니다: (.+)$/u,
    en: "This is not a Whisper model verified by the current Kirinuki build: $1",
    ja: "現在の Kirinuki が検証している Whisper モデルではありません: $1"
  },
  {
    source: /^요청한 모델\(([^)]+)\)과 실행 중인 모델\(([^)]+)\)이 다릅니다\.$/u,
    en: "The requested model ($1) differs from the running model ($2).",
    ja: "要求したモデル（$1）と実行中のモデル（$2）が異なります。"
  },
  {
    source: /^연결됨 · 이 PC의 (.+?) \(([^)]+)\)$/u,
    en: "Connected · $1 on this PC ($2)",
    ja: "接続済み · この PC の $1（$2）"
  },
  {
    source: /^(\d+)시간$/u,
    en: "$1 hr",
    ja: "$1 時間"
  },
  {
    source: /^(\d+)분$/u,
    en: "$1 min",
    ja: "$1 分"
  },
  {
    source: /^중단된 AudSeg 타이밍 초벌을 이어서 할까요\?$/u,
    en: "Resume the interrupted AudSeg timing draft?",
    ja: "中断した AudSeg タイミングの下書きを再開しますか？"
  },
  {
    source: /^중단된 Whisper 자막 초벌을 이어서 할까요\?$/u,
    en: "Resume the interrupted Whisper caption draft?",
    ja: "中断した Whisper 字幕の下書きを再開しますか？"
  },
  {
    source: /^AudSeg 빈 타이밍 초벌을 시작할까요\?$/u,
    en: "Start an AudSeg empty-timing draft?",
    ja: "AudSeg 空タイミングの下書きを開始しますか？"
  },
  {
    source: /^Whisper 로컬 자막 초벌을 시작할까요\?$/u,
    en: "Start a local Whisper caption draft?",
    ja: "ローカル Whisper 字幕の下書きを開始しますか？"
  },
  {
    source: /^저장 완료된 컷 ([\d,.]+)개는 건너뜁니다$/u,
    en: "$1 completed clips will be skipped",
    ja: "保存完了済みのクリップ $1 件をスキップします"
  },
  {
    source: /^활성 컷 ([\d,.]+)개 · 총 (.+)$/u,
    en: "$1 active clips · total $2",
    ja: "有効なクリップ $1 件 · 合計 $2"
  },
  {
    source: /^AudSeg (\S+) · 모델·네트워크 호출 없음$/u,
    en: "AudSeg $1 · no model or network calls",
    ja: "AudSeg $1 · モデル・ネットワーク呼び出しなし"
  },
  {
    source: /^로컬 Whisper (.+?) · 유료 API 호출 없음$/u,
    en: "Local Whisper $1 · no paid API calls",
    ja: "ローカル Whisper $1 · 有料 API 呼び出しなし"
  },
  {
    source: /^AudSeg (\S+) 준비 완료 · 모델과 서버 없이 이 탭에서 실행됩니다\.$/u,
    en: "AudSeg $1 ready · runs in this tab without a model or server.",
    ja: "AudSeg $1 準備完了 · モデルやサーバーを使わずこのタブで実行します。"
  },
  {
    source: /^Kirinuki 내장 자막 엔진이 (.+) 모델을 지원하지 않습니다\.$/u,
    en: "Kirinuki's built-in caption engine does not support the $1 model.",
    ja: "Kirinuki の内蔵字幕エンジンは $1 モデルに対応していません。"
  },
  {
    source: /^한 번에 Whisper 자막 초안을 만들 수 있는 활성 컷은 최대 ([\d,.]+)개입니다\. 컷을 ([\d,.]+)개 이하 묶음으로 나눠 실행해 주세요\.$/u,
    en: "Whisper drafts can process up to $1 active clips at once. Run them in groups of $2 or fewer.",
    ja: "Whisper 字幕下書きで一度に処理できる有効クリップは最大 $1 件です。$2 件以下のグループに分けて実行してください。"
  },
  {
    source: /^이미 저장된 ([\d,.]+)개 컷은 건너뛰고 실패 지점부터 이어서 처리합니다\.$/u,
    en: "Skipping $1 already saved clips and resuming from the failure point.",
    ja: "保存済みのクリップ $1 件をスキップし、失敗箇所から処理を再開します。"
  },
  {
    source: /^활성 컷 음성을 이 기기의 Whisper (.+)로 전사하고 실제 단어 타임스탬프를 우선해 초벌 자막으로 만듭니다\.$/u,
    en: "Transcribing active-clip audio with Whisper $1 on this device and creating draft captions using actual word timestamps where available.",
    ja: "有効クリップの音声をこのデバイスの Whisper $1 で文字起こしし、実際の単語タイムスタンプを優先して字幕下書きを作成します。"
  },
  {
    source: /^(\d+)\/(\d+) · 선택 구간의 음성을 준비하는 중$/u,
    en: "$1/$2 · preparing audio for the selected range",
    ja: "$1/$2 · 選択範囲の音声を準備中"
  },
  {
    source: /^(\d+)\/(\d+) · 로컬 분석용 음성 추출 중$/u,
    en: "$1/$2 · extracting audio for local analysis",
    ja: "$1/$2 · ローカル解析用の音声を抽出中"
  },
  {
    source: /^(\d+)\/(\d+) · AudSeg가 오디오 활동 구간을 찾는 중$/u,
    en: "$1/$2 · AudSeg is detecting audio activity ranges",
    ja: "$1/$2 · AudSeg が音声活動区間を検出中"
  },
  {
    source: /^(\d+)\/(\d+) · 빈 자막 타이밍 ([\d,.]+)개 준비됨$/u,
    en: "$1/$2 · $3 empty caption timings ready",
    ja: "$1/$2 · 空字幕タイミング $3 件を準備済み"
  },
  {
    source: /^(\d+)\/(\d+) · Whisper 요청 준비 중$/u,
    en: "$1/$2 · preparing Whisper request",
    ja: "$1/$2 · Whisper 要求を準備中"
  },
  {
    source: /^(\d+)\/(\d+) · 자막 엔진에 선택 구간 음성을 보내는 중$/u,
    en: "$1/$2 · sending the selected audio to the caption engine",
    ja: "$1/$2 · 選択範囲の音声を字幕エンジンへ送信中"
  },
  {
    source: /^(\d+)\/(\d+) · 음성인식과 자막 초벌 정리 중$/u,
    en: "$1/$2 · transcribing audio and refining the caption draft",
    ja: "$1/$2 · 音声認識と字幕下書きを整理中"
  },
  {
    source: /^(\d+)\/(\d+) · 로컬 Whisper 자막 초안 수신 완료$/u,
    en: "$1/$2 · local Whisper caption draft received",
    ja: "$1/$2 · ローカル Whisper の字幕下書きを受信完了"
  },
  {
    source: /^로컬 Whisper (.+)에 다시 연결됨 · 초벌을 이어갑니다$/u,
    en: "Reconnected to local Whisper $1 · resuming the draft",
    ja: "ローカル Whisper $1 に再接続 · 下書きを再開します"
  },
  {
    source: /^한 번에 만들 수 있는 AI 자막은 최대 ([\d,.]+)개입니다\. 활성 컷을 나눠서 실행해 주세요\.$/u,
    en: "Up to $1 AI captions can be created at once. Split the active clips into smaller runs.",
    ja: "一度に作成できる AI 字幕は最大 $1 件です。有効なクリップを分けて実行してください。"
  },
  {
    source: /^(\d+)\/(\d+) · 빈 타이밍 저장 완료$/u,
    en: "$1/$2 · Empty timings saved",
    ja: "$1/$2 · 空タイミングの保存完了"
  },
  {
    source: /^(\d+)\/(\d+) · 자막 초안 저장 완료$/u,
    en: "$1/$2 · Caption drafts saved",
    ja: "$1/$2 · 字幕下書きの保存完了"
  },
  {
    source: /^AudSeg (\S+) 빈 타이밍$/u,
    en: "AudSeg $1 empty timings",
    ja: "AudSeg $1 空タイミング"
  },
  {
    source: /^로컬 Whisper (.+) 자막$/u,
    en: "Local Whisper $1 captions",
    ja: "ローカル Whisper $1 字幕"
  },
  {
    source: /^(.+?) ([\d,.]+)개를 만들었습니다\. 각 빈 칸에 원음을 들으며 텍스트를 입력해 주세요\.$/u,
    en: "Created $2 $1 cues. Listen to the source and enter text in each empty cue.",
    ja: "$1 を $2 件作成しました。元音声を聞きながら各空欄にテキストを入力してください。"
  },
  {
    source: /^(.+?)과 로컬 하네스 처리를 마쳤습니다\. 재확인이 필요한 품질 경고 ([\d,.]+)건을 확인해 주세요\.$/u,
    en: "$1 and local harness processing completed. Review $2 quality warnings that need attention.",
    ja: "$1 とローカルハーネス処理が完了しました。再確認が必要な品質警告 $2 件を確認してください。"
  },
  {
    source: /^(.+?) 초안을 만들었습니다\. 재확인이 필요한 ([\d,.]+)개 자막은 노란색으로 표시했습니다\.$/u,
    en: "$1 draft created. $2 captions that need review are highlighted in yellow.",
    ja: "$1 の下書きを作成しました。再確認が必要な字幕 $2 件を黄色で表示しました。"
  },
  {
    source: /^(.+?) 초안을 만들고 키리누키 품질 하네스가 ([\d,.]+)건을 자동 정리했습니다\.$/u,
    en: "$1 draft created; the Kirinuki quality harness cleaned up $2 items automatically.",
    ja: "$1 の下書きを作成し、Kirinuki 品質ハーネスが $2 件を自動整理しました。"
  },
  {
    source: /^(.+?) 초안을 만들었습니다\. 텍스트·시간을 한 번 검수해 주세요\.$/u,
    en: "$1 draft created. Review its text and timing.",
    ja: "$1 の下書きを作成しました。テキストと時間を確認してください。"
  },

  // Export verification and archive restore. Filenames and hashes are captures
  // and are never altered.
  {
    source: /^같은 본편에서 가져온 영상의 원본 선택 기준이 서로 다릅니다: (.+)$/u,
    en: "Videos taken from the same Main Edit use different source-selection anchors: $1",
    ja: "同じ本編から取り込んだ動画で元動画の選択基準が一致しません: $1"
  },
  {
    source: /^이 기기에 저장된 범위에 같은 원본 선택 기준이 중복돼 있습니다: (.+)$/u,
    en: "The locally saved ranges contain a duplicate source-selection anchor: $1",
    ja: "このデバイスに保存された範囲に同じ元動画の選択基準が重複しています: $1"
  },
  {
    source: /^쇼츠의 원본 선택 기준이 올바르지 않습니다: (.+)$/u,
    en: "The Shorts source-selection anchor is invalid: $1",
    ja: "ショート動画の元動画選択基準が正しくありません: $1"
  },
  {
    source: /^(.+) 파일 핸들이 다른 파일 (.+)을\(를\) 가리킵니다\.$/u,
    en: "The file handle for $1 points to a different file, $2.",
    ja: "$1 のファイルハンドルが別のファイル $2 を参照しています。"
  },
  {
    source: /^(.+) 파일이 최종 안정성 확인 중 변경되었습니다\.$/u,
    en: "$1 changed during the final stability check.",
    ja: "$1 は最終安定性チェック中に変更されました。"
  },
  {
    source: /^(.+) 파일의 최종 안정성 SHA-256이 일치하지 않습니다\.$/u,
    en: "The final stability SHA-256 for $1 does not match.",
    ja: "$1 の最終安定性 SHA-256 が一致しません。"
  },
  {
    source: /^저장된 영상 형식이 예상과 다릅니다: (.+) \/ (.+)$/u,
    en: "The saved video format differs from the expected format: $1 / $2",
    ja: "保存された動画形式が想定と異なります: $1 / $2"
  },
  {
    source: /^VOD 삭제 요청과 정리 표식 복구가 모두 실패했습니다: (.+) \/ (.+)$/u,
    en: "Both the VOD deletion request and cleanup-marker recovery failed: $1 / $2",
    ja: "VOD の削除要求と整理マーカーの復元がどちらも失敗しました: $1 / $2"
  },
  {
    source: /^이 세션의 VOD 재료는 삭제했지만 브라우저 편집 세션 정리를 완료하지 못했습니다\. 다음 실행에서 삭제 완료 표식 또는 정확한 원본 상태를 확인해 복구합니다: (.+)$/u,
    en: "This session's VOD working media was deleted, but browser-session cleanup did not finish. On the next launch, Kirinuki will recover from the deletion marker or the exact source state: $1",
    ja: "このセッションの VOD 作業素材は削除しましたが、ブラウザー編集セッションの整理を完了できませんでした。次回起動時に削除完了マーカーまたは正確な元動画の状態から復元します: $1"
  },
  {
    source: /^브라우저 편집 세션을 원자적으로 정리하지 못해 현재 편집과 원본 파일 연결을 모두 유지했습니다: (.+)$/u,
    en: "Browser-session cleanup could not be completed atomically, so the current edit and source-file connection were both kept: $1",
    ja: "ブラウザー編集セッションをアトミックに整理できなかったため、現在の編集と元ファイルの接続をどちらも維持しました: $1"
  },
  {
    source: /^복원 이미지 (.+)의 검증된 Blob을 찾지 못했습니다\.$/u,
    en: "Could not find the verified Blob for recovered image $1.",
    ja: "復元画像 $1 の検証済み Blob が見つかりません。"
  },
  {
    source: /^복원 이미지 (.+)의 새 저장 키를 만들지 못했습니다\.$/u,
    en: "Could not create a new storage key for recovered image $1.",
    ja: "復元画像 $1 の新しい保存キーを作成できませんでした。"
  },
  {
    source: /^이 작업의 기기 내 데이터 ([\d,.]+)건$/u,
    en: "$1 local records from this edit",
    ja: "この編集のデバイス内データ $1 件"
  },
  {
    source: /^과 VOD 작업 파일 ([\d,.]+)개\((.+)\)$/u,
    en: " and $1 VOD working files ($2)",
    ja: "と VOD 作業ファイル $1 件（$2）"
  },
  {
    source: /^과 VOD 작업 재료 (.+)$/u,
    en: " and VOD working media ($1)",
    ja: "と VOD 作業メディア（$1）"
  },
  {
    source: /^(.+) 파일이 이름 확인 뒤 새로 생겨 덮어쓰지 않았습니다\. 다시 내보내 주세요\.$/u,
    en: "$1 appeared after the filename check and was not overwritten. Export again.",
    ja: "名前確認後に $1 ファイルが新しく作成されたため、上書きしませんでした。再度書き出してください。"
  },
  {
    source: /^(.+) 생성 바이트가 비어 있습니다\.$/u,
    en: "Generated bytes for $1 are empty.",
    ja: "$1 の生成バイトが空です。"
  },
  {
    source: /^(.+) 저장 크기가 예상과 다릅니다: ([\d,.]+) \/ ([\d,.]+)$/u,
    en: "$1 saved size differs from expected: $2 / $3",
    ja: "$1 の保存サイズが想定と異なります: $2 / $3"
  },
  {
    source: /^(.+) 저장 바이트의 SHA-256이 생성한 파일과 다릅니다\.$/u,
    en: "The SHA-256 of the saved $1 bytes differs from the generated file.",
    ja: "保存した $1 バイトの SHA-256 が生成ファイルと異なります。"
  },
  {
    source: /^(.+) 복원 무결성을 다시 검증하지 못했습니다: (.+)$/u,
    en: "Could not reverify $1 recovery integrity: $2",
    ja: "$1 の復元整合性を再検証できませんでした: $2"
  },
  {
    source: /^(.+) 파일이 검증 중 변경되었습니다\.$/u,
    en: "$1 changed during verification.",
    ja: "$1 ファイルが検証中に変更されました。"
  },
  {
    source: /^(.+) 파일이 검증 중 바뀌어 SHA-256이 일치하지 않습니다\.$/u,
    en: "$1 changed during verification, so its SHA-256 no longer matches.",
    ja: "$1 ファイルが検証中に変わったため、SHA-256 が一致しません。"
  },
  {
    source: /^저장된 영상 해상도가 예상과 다릅니다: (\d+)×(\d+) \/ (\d+)×(\d+)$/u,
    en: "Saved video resolution differs from expected: $1×$2 / $3×$4",
    ja: "保存された動画の解像度が想定と異なります: $1×$2 / $3×$4"
  },
  {
    source: /^저장된 영상 길이가 편집본과 다릅니다: (.+) \/ (.+)$/u,
    en: "Saved video duration differs from the edit: $1 / $2",
    ja: "保存された動画の長さが編集内容と異なります: $1 / $2"
  },
  {
    source: /^원본 파일을 내보내기 직전에 다시 확인하지 못했습니다: (.+)\. ‘내 파일 직접 연결’에서 파일 권한을 확인해 주세요\.$/u,
    en: "Could not reverify the source file immediately before export: $1. Check file permission under “Connect my file.”",
    ja: "書き出し直前に元ファイルを再確認できませんでした: $1。「自分のファイルを直接接続」でファイル権限を確認してください。"
  },
  {
    source: /^준비된 편집 영상에 컷·이미지·자막을 합치고 있습니다\.$/u,
    en: "Compositing clips, images, and captions onto the prepared editing media.",
    ja: "準備済み編集用動画にクリップ・画像・字幕を合成しています。"
  },
  {
    source: /^준비된 편집 영상에 세로 화면 배치·컷·이미지·자막을 합치고 있습니다\.$/u,
    en: "Compositing the vertical layout, clips, images, and captions onto the prepared editing media.",
    ja: "準備済み編集用動画に縦画面レイアウト・クリップ・画像・字幕を合成しています。"
  },
  {
    source: /^직접 연결한 영상에 컷·이미지·자막을 합치고 있습니다\.$/u,
    en: "Compositing clips, images, and captions onto the connected video.",
    ja: "直接接続した動画にクリップ・画像・字幕を合成しています。"
  },
  {
    source: /^직접 연결한 영상에 세로 화면 배치·컷·이미지·자막을 합치고 있습니다\.$/u,
    en: "Compositing the vertical layout, clips, images, and captions onto the connected video.",
    ja: "直接接続した動画に縦画面レイアウト・クリップ・画像・字幕を合成しています。"
  },
  {
    source: /^쇼츠 영상과 복원 파일은 보존했지만 저장 완료를 확인하지 못해 임시 자료를 모두 유지했습니다: (.+)$/u,
    en: "The Shorts video and recovery file were preserved, but save completion could not be verified, so all temporary data was kept: $1",
    ja: "ショート動画と復元ファイルは保持しましたが、保存完了を確認できなかったため一時データをすべて維持しました: $1"
  },
  {
    source: /^영상과 복원 파일은 보존했지만 저장 완료를 확인하지 못해 임시 자료를 모두 유지했습니다: (.+)$/u,
    en: "The video and recovery file were preserved, but save completion could not be verified, so all temporary data was kept: $1",
    ja: "動画と復元ファイルは保持しましたが、保存完了を確認できなかったため一時データをすべて維持しました: $1"
  },
  {
    source: /^쇼츠 영상과 편집 복원 파일은 안전하게 저장했지만 임시 자료는 정리하지 못했습니다: (.+)$/u,
    en: "The Shorts video and edit-recovery file were saved safely, but temporary data could not be cleaned up: $1",
    ja: "ショート動画と編集復元ファイルは安全に保存しましたが、一時データを整理できませんでした: $1"
  },
  {
    source: /^영상과 편집 복원 파일은 안전하게 저장했지만 임시 자료는 정리하지 못했습니다: (.+)$/u,
    en: "The video and edit-recovery file were saved safely, but temporary data could not be cleaned up: $1",
    ja: "動画と編集復元ファイルは安全に保存しましたが、一時データを整理できませんでした: $1"
  },
  {
    source: /^영상 내보내기를 취소했습니다\.(.*)$/u,
    en: "Video export canceled.$1",
    ja: "動画の書き出しをキャンセルしました。$1"
  },
  {
    source: /^영상은 보존했지만 편집 복원 파일·자막 파일을 저장하거나 확인하지 못했습니다: (.+)\. 임시 자료는 유지했습니다\.$/u,
    en: "The video was preserved, but the edit-recovery and caption files could not be saved or verified: $1. Temporary data was kept.",
    ja: "動画は保持しましたが、編集復元ファイル・字幕ファイルを保存または確認できませんでした: $1。一時データは維持しました。"
  },
  {
    source: /^최종 합성 화면의 ([\d,.]+)개 시간 구간에서 1–24px 외곽 틈·영상 사이 seam을 감지했습니다\. 취소한 뒤 영상 탭의 밀대 도구를 쓰거나, 의도한 여백이면 그대로 내보낼 수 있습니다\.$/u,
    en: "Detected 1–24 px outer gaps or seams between videos in $1 time ranges of the final composite. Cancel and use the edge-push tool in the Video tab, or export as-is if the spacing is intentional.",
    ja: "最終合成画面の時間範囲 $1 件で 1〜24 px の外周の隙間または動画間の継ぎ目を検出しました。キャンセルして動画タブの押し広げツールを使うか、意図した余白ならそのまま書き出せます。"
  },
  {
    source: /^저장 파일: (.+)\.\(영상 형식\) · (.+)\.kirinuki-session\.json$/u,
    en: "Saved files: $1.(video format) · $2.kirinuki-session.json",
    ja: "保存ファイル: $1.（動画形式） · $2.kirinuki-session.json"
  },
  {
    source: /^(.+?)이 끝난 뒤 편집 복원 파일을 열어 주세요\.$/u,
    en: "Open the edit-recovery file after $1 finishes.",
    ja: "$1 が完了してから編集復元ファイルを開いてください。"
  },
  {
    source: /^현재 편집을 안전하게 저장한 뒤 ‘(.+)’ 저장본으로 교체할까요\? 편집 복원 파일에는 원본 VOD가 들어 있지 않으므로 필요하면 원본을 다시 연결하거나 준비합니다\.$/u,
    en: "Safely save the current edit, then replace it with the “$1” saved version? The edit-recovery file does not contain the source VOD, so reconnect or prepare the source if needed.",
    ja: "現在の編集を安全に保存してから「$1」の保存版に置き換えますか？編集復元ファイルには元の VOD が含まれないため、必要に応じて元動画を再接続または準備します。"
  },
  {
    source: /^파일을 확인하는 동안 (.+?)이 시작되어 세션 복원을 중단했습니다\. 다시 시도해 주세요\.$/u,
    en: "$1 started while the file was being checked, so session restore was stopped. Try again.",
    ja: "ファイルの確認中に $1 が開始されたため、セッション復元を中止しました。もう一度お試しください。"
  },
  {
    source: /^저장본을 적용했습니다\. 원본 파일 ‘(.+)’을 다시 연결해 주세요\.$/u,
    en: "Saved version applied. Reconnect the source file “$1.”",
    ja: "保存版を適用しました。元ファイル「$1」を再接続してください。"
  },
  {
    source: /^영상 라인은 최대 ([\d,.]+)개까지 만들 수 있습니다\.$/u,
    en: "Up to $1 video tracks can be created.",
    ja: "動画トラックは最大 $1 本まで作成できます。"
  },
  {
    source: /^(\d+)번째 영상 라인을 추가했습니다\.$/u,
    en: "Added video track $1.",
    ja: "$1 番目の動画トラックを追加しました。"
  },
  {
    source: /^현재 화면 배치를 영상 ([\d,.]+)개에 적용했습니다\. 각 영상에서 가져올 원본 영역은 유지됩니다\.$/u,
    en: "Applied the current framing to $1 videos. Each video's selected source region is unchanged.",
    ja: "現在の画面配置を動画 $1 本に適用しました。各動画から取り込む元領域は維持されます。"
  },
  {
    source: /^자막 레인은 최대 ([\d,.]+)개까지 만들 수 있습니다\.$/u,
    en: "Up to $1 caption tracks can be created.",
    ja: "字幕トラックは最大 $1 本まで作成できます。"
  },
  {
    source: /^현재 시각의 ([\d,.]+)개 자막 레인이 모두 사용 중입니다\.$/u,
    en: "All $1 caption tracks at the playhead are in use.",
    ja: "現在位置では $1 本の字幕トラックがすべて使用中です。"
  },
  {
    source: /^(\d+)번째 자막 레인을 추가했습니다\.$/u,
    en: "Added caption track $1.",
    ja: "$1 番目の字幕トラックを追加しました。"
  },
  {
    source: /^(.+) 스타일을 적용했습니다\.$/u,
    en: "Applied the $1 style.",
    ja: "$1 スタイルを適用しました。"
  },
  {
    source: /^한 번에 추가할 수 있는 로컬 자막은 최대 ([\d,.]+)개입니다\.$/u,
    en: "Up to $1 local captions can be added at once.",
    ja: "一度に追加できるローカル字幕は最大 $1 件です。"
  },
  {
    source: /^(\d+)번 로컬 자막 형식이 올바르지 않습니다\.$/u,
    en: "Local caption $1 has an invalid format.",
    ja: "$1 番のローカル字幕形式が正しくありません。"
  },
  {
    source: /^(\d+)번 로컬 자막의 컷을 찾을 수 없습니다\.$/u,
    en: "Could not find the clip for local caption $1.",
    ja: "$1 番のローカル字幕に対応するクリップが見つかりません。"
  },
  {
    source: /^(\d+)번 로컬 자막은 컷 안의 0\.1~5초 구간이어야 합니다\.$/u,
    en: "Local caption $1 must span 0.1–5 seconds within its clip.",
    ja: "$1 番のローカル字幕はクリップ内の 0.1〜5 秒の範囲である必要があります。"
  },
  {
    source: /^(\d+)번 로컬 자막 텍스트가 비었거나 너무 깁니다\.$/u,
    en: "Local caption $1 is empty or too long.",
    ja: "$1 番のローカル字幕テキストが空か長すぎます。"
  },
  {
    source: /^Codex 로컬 초벌 자막 ([\d,.]+)개를 기존 자막과 별도로 추가했습니다\.$/u,
    en: "Added $1 Codex local draft captions separately from the existing captions.",
    ja: "Codex のローカル下書き字幕 $1 件を既存の字幕とは別に追加しました。"
  }
] as const satisfies readonly UiCopyPattern[];
