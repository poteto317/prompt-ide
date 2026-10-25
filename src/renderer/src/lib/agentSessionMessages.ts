import { AGENT_CLI_PROFILES, DEFAULT_AGENT_CLI_COMMAND_NAME } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentStartResult } from '@shared/types'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import type { AgentActivity } from './agentActivity'
import type { AgentSessionExitView, AgentSessionStatus } from './agentSessionTabState'

// エージェントのセッションの表示の文言(設計書「エラー処理」「配置の案」、活動の文言は状態表示の設計書の「状態」)

export const AGENT_START_DISABLED_NO_FOLDER = 'フォルダを開いてください'
/** 帯の 起動 の aria-label。可視の文言「起動」で始める(パターン 76)。commandName は設定の種類のコマンド名 */
export function agentStartAriaLabel(commandName: string): string {
  return `起動（開いているフォルダで ${commandName} を起動）`
}
/** 従来の方式への切り替えの途中(エージェントの停止を待つ間)に、起動・+ を押せない理由 */
export const AGENT_START_DISABLED_SWITCHING_MODE = '実行方式を切り替えています'
/** 使う CLI の切り替えの途中(エージェントの停止を待つ間)に、起動・+・前回の続きからを押せない理由 */
export const AGENT_START_DISABLED_SWITCHING_CLI_KIND = '使うエージェント CLI を切り替えています'
export const AGENT_EXITED_SOON_NOTE = '起動の直後に終了しました。ターミナルの表示を確かめてください'
/**
 * 再開の失敗(isAgentResumeFailure)の文言。種類ごとの表で、claude は今の「起動の直後に終了しました」のまま(null)。copilot は
 * 何も送らずに閉じたセッションを --resume で開けない(GitHub Copilot CLI 1.0.87 の記録の 5f)。原因を言い切らず、copilot の出力は写さずに
 * ターミナルの表示を見るよう案内する(L-017)。起動の記録は消さない(終了コード 1 には別の原因もある。L-002)
 */
export const AGENT_RESUME_FAILURE_NOTES: Record<AgentCliKind, string | null> = {
  claude: null,
  copilot: `${AGENT_CLI_PROFILES.copilot.commandName} がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、${AGENT_CLI_PROFILES.copilot.commandName} が保存しないため再開できません）`
}

/** 同時に動かせるセッションの数の上限に達したときの文言(main が起動を拒否したとき用) */
export const AGENT_TOO_MANY_SESSIONS = `同時に動かせるエージェントは ${AGENT_MAX_SESSIONS_PER_WINDOW} つまでです`
/** 「＋」を押せない理由(タブが上限に達している。動いている数ではなくタブの数の制限なので、閉じれば追加できることを伝える) */
export const AGENT_ADD_TAB_DISABLED_LIMIT = `タブは ${AGENT_MAX_SESSIONS_PER_WINDOW} つまでです（使わないタブを閉じると追加できます）`
/** 再開の ID が main の起動の記録に無い(main が unknown-session で拒んだ) */
export const AGENT_UNKNOWN_SESSION =
  'このセッションは再開できません（アプリの起動の記録にありません）'
/** 同じ ID のエージェント CLI がほかのタブかウィンドウで動いている(main が session-in-use で拒んだ) */
export const AGENT_SESSION_IN_USE = 'このセッションはほかのタブかウィンドウで動いています'
/** 再開の依頼だが、使う CLI が再開に対応していない(main が resume-unsupported で拒んだ) */
export const AGENT_RESUME_UNSUPPORTED =
  '使っているエージェント CLI は、セッションの再開に対応していません'
/** 再開の依頼の種類が main の読んだ設定の種類と違った(main が resume-cli-mismatch で拒んだ。別のウィンドウで設定を変えたとき) */
export const AGENT_RESUME_CLI_MISMATCH =
  '使うエージェント CLI の設定が変わったため、再開しませんでした（設定を確かめてから、もう一度押してください）'

/** ターミナルのタブの「前回の続きから」(このフォルダで最後に起動が確定した、設定の種類のセッションを再開する) */
export const AGENT_RESUME_LAST_LABEL = '前回の続きから'
/** 帯の 前回の続きから の aria-label。可視の文言「前回の続きから」で始める(パターン 76)。commandName は設定の種類のコマンド名
 *  (claude では段階 3a より前と同じ文字列) */
export function agentResumeLastAriaLabel(commandName: string): string {
  return `前回の続きから（このフォルダで最後に起動した ${commandName} のセッションを再開）`
}
export const AGENT_RESUME_LAST_LOADING = '前回のセッションを確かめています'
export const AGENT_RESUME_LAST_NO_RECORD = 'このフォルダで前回起動したセッションの記録がありません'
/** 前回の続きから の押せない理由(設定の種類が再開に対応していない) */
export function agentResumeLastUnsupportedReason(commandName: string): string {
  return `${commandName} では「前回の続きから」を使えません（設定で ${DEFAULT_AGENT_CLI_COMMAND_NAME} に戻すと使えます）`
}
/** 前回のセッションがほかのタブで起動中・実行中のとき(label はそのタブの名前) */
export function agentResumeLastInUse(label: string): string {
  return `前回のセッションは ${label} で動いています`
}

/** 実行の履歴の詳細の「このセッションで再開」(新しいタブを開いて、エントリのセッションを再開する) */
export const AGENT_RESUME_ENTRY_LABEL = 'このセッションで再開'
export const AGENT_RESUME_ENTRY_LEGACY_MODE =
  'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
/** 履歴の このセッションで再開 の押せない理由(設定の種類が再開に対応していない) */
export function agentResumeEntryUnsupportedReason(commandName: string): string {
  return `${commandName} では「このセッションで再開」を使えません（設定で ${DEFAULT_AGENT_CLI_COMMAND_NAME} に戻すと使えます）`
}
/** 履歴の このセッションで再開 の押せない理由(エントリの種類と設定の種類が違う。設定を切り替えると再開できる) */
export function agentResumeEntryCliMismatch(
  entryCommandName: string,
  appCommandName: string
): string {
  return `${entryCommandName} のセッションのため、${appCommandName} では再開できません（設定の「使うエージェント CLI」で ${entryCommandName} に切り替えると再開できます）`
}
/** 履歴の このセッションで再開 の押せない理由(エントリの種類をこの版が知らない)。cliKind は main が形を検証した履歴の値(L-017) */
export function agentResumeEntryUnknownCli(cliKind: string): string {
  return `このアプリの版が知らないエージェント CLI（${cliKind}）のセッションのため、再開できません`
}
/** 開いているフォルダが記録したフォルダと違う・フォルダを開いていない */
export function agentResumeEntryFolderMismatch(folderPath: string): string {
  return `記録したフォルダ（${folderPath}）を開いているときだけ再開できます`
}
/** エントリのセッションがほかのタブで起動中・実行中(label はそのタブの名前) */
export function agentResumeEntryInUse(label: string): string {
  return `このセッションは ${label} で動いています`
}

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
    case 'command-not-found': {
      // 結果の種類(main が探したコマンド)の名前で出す。省略で claude の文言に流さない(L-044)
      const profile = AGENT_CLI_PROFILES[result.cliKind]
      return (
        `${profile.commandName} コマンドが見つかりません。${profile.displayName} をインストールしてください（探した場所: ログインシェルの PATH）` +
        (result.shellPathUnavailable
          ? '（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
          : '')
      )
    }
    case 'too-many-sessions':
      return AGENT_TOO_MANY_SESSIONS
    case 'unknown-session':
      return AGENT_UNKNOWN_SESSION
    case 'session-in-use':
      return AGENT_SESSION_IN_USE
    case 'resume-unsupported':
      return AGENT_RESUME_UNSUPPORTED
    case 'resume-cli-mismatch':
      return AGENT_RESUME_CLI_MISMATCH
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

/** タブのラベル。main の OS の通知の題でも使うため共有に置き、ここから再 export する */
export { formatAgentTabLabel } from '@shared/agentTabLabel'

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
/** 使う CLI の切り替えの前の確認(動いているタブをすべて止めてから保存する) */
export const AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM =
  '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？'
/** 従来の方式で実行している間に実行方式を選べない理由(切り替えると出力パネルが消え、キャンセルできないまま実行が続くため) */
export const EXECUTION_MODE_LOCKED_WHILE_EXECUTING =
  '従来の方式で実行している間は、実行方式を切り替えられません'
