import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { isGitTimeoutError } from './gitStepErrors'

// push/pull/fetch/初回 push はネットワークI/Oを伴う。認証プロンプト待ち(認証情報未設定で
// 端末から起動した場合、git が /dev/tty を開いてプロンプトを出し誰も応答しない)や
// 到達不能なホストへの接続では、タイムアウトが無いと simple-git の Promise が
// 永久に解決せず、呼び出し元(useGitRemoteOperations.ts)の実行中フラグが true の
// まま戻らずボタンが恒久的に disabled のまま固まる(pull の場合は共有ロックも
// 解除されず commit/ハンク操作まで巻き添えになる、runGitApply の
// GIT_APPLY_TIMEOUT_MS と同じ理由)。simple-git 標準の timeout プラグイン
// (stdout/stderr に一定時間データが来ないと強制終了する)を使う。
// env() 経由で GIT_TERMINAL_PROMPT 等を渡す方式は、blockUnsafeOperationsPlugin が
// GIT_SSH_COMMAND 等の継承環境変数を検査して GitPluginError を投げる既存の地雷
// (getLog 参照)を再び踏むため採用しない。
// 元は gitService.ts の非公開の関数だったが、初回 push(gitRemoteSetupService)も同じ打ち切りを使うため
// 切り出した(振る舞いは変えていない)。timeoutMs はテストで実時間を待たないための引数(パターン 84)
export function simpleGitWithRemoteTimeout(
  folderPath: string,
  timeoutMs: number = GIT_REMOTE_TIMEOUT_MS
): SimpleGit {
  return simpleGit(folderPath, {
    timeout: { block: timeoutMs },
    // git は stderr が tty に接続されていないと既定で進捗行を出力しない。
    // simple-git は progress オプションを渡した場合のみ push/pull/fetch に
    // --progress を自動付与する(渡さないと timeout プラグインが見ている
    // stdout/stderr に実際の転送中(圧縮・送受信)も何も流れず、正常に進行中の
    // 操作まで誤ってタイムアウトしてしまう)。--progress は引数の末尾に足されるため、
    // push の引数に `--` を使うと --progress が refspec として扱われて失敗する(実機で確認)。
    // コールバックの中身は使わないため no-op
    progress: () => {}
  })
}

export const REMOTE_OPERATION_TIMEOUT_MESSAGE =
  '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'

// timeout プラグインが投げる GitPluginError のメッセージは "block timeout
// reached" という固定の英語の内部文字列で、ユーザーに見せても原因が伝わらない
// (アプリの他の文言はすべて日本語)。plugin === 'timeout' のときだけ、原因の
// 推測もセットにした日本語メッセージへ差し替える。それ以外の GitPluginError
// (timeout プラグイン以外が投げたもの)は素通しする
export function toRemoteOperationError(err: unknown): unknown {
  if (isGitTimeoutError(err)) return new Error(REMOTE_OPERATION_TIMEOUT_MESSAGE)
  return err
}
