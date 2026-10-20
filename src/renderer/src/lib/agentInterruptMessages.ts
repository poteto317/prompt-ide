import type { AgentActivity } from './agentActivity'

// 帯の 中断 の文言(ボタンの名前・押せない理由・読み上げ・送れなかったときの文言。設計書 2026-10-19「画面」「エラー処理」)。
// 押せるかの判定(どの理由を選ぶかの順)は agentInterrupt.ts に置く

/** 帯の中断のボタン(選択中のタブの claude に Esc を 1 回送る。設計書 2026-10-19「画面」) */
export const AGENT_INTERRUPT_LABEL = '中断'
/** 帯の 中断 の aria-label。可視の文言「中断」で始める(パターン 76)。commandName は選択中のタブの種類のコマンド名 */
export function agentInterruptAriaLabel(commandName: string): string {
  return `${AGENT_INTERRUPT_LABEL}（作業中の ${commandName} に Esc を送る）`
}
/** セッションが無い・終了した(帯には出さないが、押した処理の判定でも同じ純関数を使うため理由を持つ) */
export const AGENT_INTERRUPT_NOT_RUNNING = 'claude が動いていないため中断できません'
export const AGENT_INTERRUPT_DISABLED_STARTING = '起動中は中断できません'
export const AGENT_INTERRUPT_DISABLED_CLOSING = '閉じる途中のタブは中断できません'
export const AGENT_INTERRUPT_DISABLED_SENDING = 'プロンプトを送信している間は中断できません'
export const AGENT_INTERRUPT_DISABLED_SEND_CONFIRM = '送信前の確認を開いている間は中断できません'
/** 送っている途中・押してから 1,000ms 以内(待ちはタブごと) */
export const AGENT_INTERRUPT_DISABLED_COOLDOWN =
  '中断を送りました。まだ作業中なら、少し待つと押せます'
/** 選択中のタブの CLI が中断に対応していない */
export function agentInterruptUnsupportedReason(commandName: string): string {
  return `${commandName} では中断のボタンを使えません（ターミナルで操作してください）`
}
/** 活動が working でないときの理由。活動を増やしたときの決め忘れを型エラーにする */
export const AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY: Record<
  Exclude<AgentActivity, 'working'>,
  string
> = {
  permission:
    '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）',
  confirm: '確認待ちのため中断できません（ターミナルで選んでください）',
  idle: '入力待ちのため、中断する作業がありません',
  unknown: '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）'
}
/** 中断を送れたときの読み上げ(label は押した時点のタブの名前。formatAgentTabLabel) */
export function agentInterruptSentNotice(label: string): string {
  return `${label} に中断（Esc）を送りました`
}
/** 中断を送れなかったときの文言の接頭辞(AGENT_STOP_ERROR_PREFIX と同じ形)。送れたときは、この接頭辞で始まる error だけを消す */
export const AGENT_INTERRUPT_ERROR_PREFIX = '中断を送れませんでした: '
/** main が no-session を返した(終了の知らせが renderer より先・起動し直した・停止中) */
export const AGENT_INTERRUPT_ERROR_NO_SESSION = `${AGENT_INTERRUPT_ERROR_PREFIX}claude が終了したか、起動し直しました`
/** main が write-failed を返した(pty への書き込みが例外) */
export const AGENT_INTERRUPT_ERROR_WRITE_FAILED = `${AGENT_INTERRUPT_ERROR_PREFIX}ターミナルへの書き込みに失敗しました`
/** invoke の拒否・window.api の同期の例外 */
export function agentInterruptError(message: string): string {
  return `${AGENT_INTERRUPT_ERROR_PREFIX}${message}`
}
