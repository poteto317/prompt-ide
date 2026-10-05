import type { AgentExitReason, AgentStartResult } from '@shared/types'

// エージェントのセッションの表示の文言(設計書「エラー処理」「配置の案」)

/** セッションの状態(useAgentSession が持ち、帯の文言の入力にもなる) */
export type AgentSessionStatus = 'none' | 'starting' | 'running' | 'exited'

export const AGENT_START_DISABLED_NO_FOLDER = 'フォルダを開いてください'
export const AGENT_EXITED_SOON_NOTE = '起動の直後に終了しました。ターミナルの表示を確かめてください'
/** 起動の直後とみなす時間(node-pty は起動の失敗を終了コード 1 で返すため。確認の結果 4) */
export const AGENT_EXITED_SOON_MS = 2_000

/** 起動の失敗(spawn-failed・起動の依頼の例外)の文言の接頭辞。後ろに理由を付ける */
export const AGENT_START_ERROR_PREFIX = 'エージェントを起動できませんでした: '
/** 終了の依頼の例外の文言の接頭辞。後ろに理由を付ける */
export const AGENT_STOP_ERROR_PREFIX = 'エージェントを終了できませんでした: '

/** 起動の失敗の文言(パネルの帯の下に role="alert" で出す) */
export function describeAgentStartError(
  result: Extract<AgentStartResult, { kind: 'error' }>
): string {
  switch (result.error) {
    case 'no-folder':
      return AGENT_START_DISABLED_NO_FOLDER
    case 'folder-mismatch':
      return '開いているフォルダが切り替わりました。もう一度「起動」を押してください'
    case 'folder-missing':
      return `開いているフォルダが見つかりません: ${result.detail ?? ''}`
    case 'command-not-found':
      return (
        'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）' +
        (result.shellPathUnavailable === true
          ? '（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
          : '')
      )
    case 'spawn-failed':
      return `${AGENT_START_ERROR_PREFIX}${result.detail ?? ''}`
  }
}

/** パネルの帯の状態の文言 */
export function describeAgentStatus(
  status: AgentSessionStatus,
  exit: { exitCode: number | null; reason: AgentExitReason } | null
): string {
  if (status === 'none') return '未起動'
  if (status === 'starting' || status === 'running') return '起動中'
  if (exit === null || exit.exitCode === null) return '終了しました'
  return `終了しました（終了コード ${exit.exitCode}）`
}

/** フォルダの切り替え(「フォルダを変更」「リポジトリを clone」)の前の確認 */
export const AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM =
  'フォルダを切り替えると、実行中のエージェントを終了します。続けますか？'
/** 従来の方式への切り替えの前の確認 */
export const AGENT_STOP_ON_MODE_CHANGE_CONFIRM =
  '従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？'
/** 従来の方式で実行している間に実行方式を選べない理由(切り替えると出力パネルが消え、キャンセルできないまま実行が続くため) */
export const EXECUTION_MODE_LOCKED_WHILE_EXECUTING =
  '従来の方式で実行している間は、実行方式を切り替えられません'
