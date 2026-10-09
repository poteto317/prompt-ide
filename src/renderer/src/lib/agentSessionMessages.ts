import type { AgentStartResult } from '@shared/types'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import type { AgentActivity } from './agentActivity'
import type { AgentSessionExitView, AgentSessionStatus } from './agentSessionTabState'

// エージェントのセッションの表示の文言(設計書「エラー処理」「配置の案」、活動の文言は状態表示の設計書の「状態」)

export const AGENT_START_DISABLED_NO_FOLDER = 'フォルダを開いてください'
/** 従来の方式への切り替えの途中(エージェントの停止を待つ間)に、起動・+ を押せない理由 */
export const AGENT_START_DISABLED_SWITCHING_MODE = '実行方式を切り替えています'
export const AGENT_EXITED_SOON_NOTE = '起動の直後に終了しました。ターミナルの表示を確かめてください'

/** 同時に動かせるセッションの数の上限に達したときの文言(main が起動を拒否したとき用) */
export const AGENT_TOO_MANY_SESSIONS = `同時に動かせるエージェントは ${AGENT_MAX_SESSIONS_PER_WINDOW} つまでです`
/** 「＋」を押せない理由(タブが上限に達している。動いている数ではなくタブの数の制限なので、閉じれば追加できることを伝える) */
export const AGENT_ADD_TAB_DISABLED_LIMIT = `タブは ${AGENT_MAX_SESSIONS_PER_WINDOW} つまでです（使わないタブを閉じると追加できます）`

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
    case 'too-many-sessions':
      return AGENT_TOO_MANY_SESSIONS
    case 'spawn-failed':
      return `${AGENT_START_ERROR_PREFIX}${result.detail ?? ''}`
  }
}

/** パネルの帯の状態の文言。終了の前はタブの文言と同じで、終了だけ終了コードを添える */
export function describeAgentStatus(
  status: AgentSessionStatus,
  exit: AgentSessionExitView | null,
  activity: AgentActivity = 'unknown'
): string {
  if (status !== 'exited') return describeAgentTabStatus(status, activity)
  if (exit === null || exit.exitCode === null) return '終了しました'
  return `終了しました（終了コード ${exit.exitCode}）`
}

/** タブの状態の文言(タブの aria-label に含めて読み上げる)。running のときだけ、判定した活動の文言になる。
 * 活動は省略させない(呼び出し側が活動を渡し忘れると、running のタブが常に「実行中」になるため) */
export function describeAgentTabStatus(
  status: AgentSessionStatus,
  activity: AgentActivity
): string {
  switch (status) {
    case 'none':
      return '未起動'
    case 'starting':
      return '起動中'
    case 'running':
      return describeAgentActivity(activity)
    case 'exited':
      return '終了'
  }
}

/** 実行中(running)のセッションの活動の文言(タブの読み上げの名前・パネルの帯・ステータスバーのまとめ。unknown は従来の「実行中」) */
export function describeAgentActivity(activity: AgentActivity): string {
  switch (activity) {
    case 'working':
      return '作業中'
    case 'idle':
      return '入力待ち'
    case 'permission':
      return '許可待ち'
    case 'confirm':
      return '確認待ち'
    case 'unknown':
      return '実行中'
  }
}

/** タブのラベル(番号の振り方は agentSessionTabs の AgentSessionTab.number) */
export function formatAgentTabLabel(number: number): string {
  return `claude ${number}`
}

/** タブを閉じる前の確認(実行中のエージェントを終了する) */
export function agentCloseTabConfirm(label: string): string {
  return `${label} のエージェントを終了してタブを閉じますか？`
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
