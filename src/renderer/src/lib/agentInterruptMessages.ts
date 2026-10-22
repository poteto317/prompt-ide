import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInterruptFollowUpResult, AgentInterruptResult } from '@shared/types'
import type { AgentActivity } from './agentActivity'

// 帯の 中断 の文言(ボタンの名前・押せない理由・読み上げ・送れなかったときの文言。設計書 2026-10-19「画面」「エラー処理」、
// 2026-10-21「文言」)。CLI で違う部分(押すキーの説明・許可待ちでの Esc の意味・判定できないときの案内)は種類ごとの表で引き、
// CLI の名前は AGENT_CLI_PROFILES のコマンド名から作る(直書きしない)。押すキーの回数(copilot の `Esc を 2 回`)は main の送り方の表
// (src/main/agentCliInterruptSpecs.ts の AGENT_CLI_INTERRUPT_SPECS)と合わせる(別のプロセスの持ち物なので、それぞれのテストで固定する)。
// 押せるかの判定(どの理由を選ぶかの順)は agentInterrupt.ts に置く

interface AgentInterruptKeyTexts {
  /** aria-label の動作(`Esc を送る`) */
  ariaAction: string
  /** 送れたときの読み上げの括弧の中(`Esc`) */
  sentKeys: string
  /** 判定できないときの、ターミナルでの中断の案内 */
  terminalHint: string
  /** 許可待ちで Esc を押したときの意味 */
  permissionEscEffect: string
}

/** CLI ごとの押すキーの文言。種類を足したときの決め忘れを型エラーにする */
export const AGENT_INTERRUPT_KEY_TEXTS: Record<AgentCliKind, AgentInterruptKeyTexts> = {
  claude: {
    ariaAction: 'Esc を送る',
    sentKeys: 'Esc',
    terminalHint: 'ターミナルで Esc を押すと中断できます',
    permissionEscEffect: '許可の拒否'
  },
  copilot: {
    ariaAction: 'Esc を 2 回送る',
    sentKeys: 'Esc を 2 回',
    terminalHint: 'ターミナルで Esc を続けて 2 回押すと中断できます',
    permissionEscEffect: '操作の取り消し'
  }
}

const commandNameOf = (kind: AgentCliKind): string => AGENT_CLI_PROFILES[kind].commandName

/** 帯の中断のボタン(選択中のタブの CLI に Esc を送る。設計書 2026-10-19「画面」) */
export const AGENT_INTERRUPT_LABEL = '中断'
/** 帯の 中断 の aria-label。可視の文言「中断」で始める(パターン 76)。kind は選択中のタブの種類 */
export function agentInterruptAriaLabel(kind: AgentCliKind): string {
  return `${AGENT_INTERRUPT_LABEL}（作業中の ${commandNameOf(kind)} に ${AGENT_INTERRUPT_KEY_TEXTS[kind].ariaAction}）`
}
/** セッションが無い・終了した(帯には出さないが、押した処理の判定でも同じ純関数を使うため理由を持つ) */
export function agentInterruptNotRunningReason(commandName: string): string {
  return `${commandName} が動いていないため中断できません`
}
export const AGENT_INTERRUPT_DISABLED_STARTING = '起動中は中断できません'
export const AGENT_INTERRUPT_DISABLED_CLOSING = '閉じる途中のタブは中断できません'
export const AGENT_INTERRUPT_DISABLED_SENDING = 'プロンプトを送信している間は中断できません'
export const AGENT_INTERRUPT_DISABLED_SEND_CONFIRM = '送信前の確認を開いている間は中断できません'
/** 送っている途中・押してから 1,000ms 以内(2 回目の要る種類は 2 回目の流れが終わってから 1,000ms 以内。待ちはタブごと) */
export const AGENT_INTERRUPT_DISABLED_COOLDOWN =
  '中断を送りました。まだ作業中なら、少し待つと押せます'
/** 選択中のタブの CLI が中断に対応していない(能力の表の interrupt が false の種類) */
export function agentInterruptUnsupportedReason(commandName: string): string {
  return `${commandName} では中断のボタンを使えません（ターミナルで操作してください）`
}
/** 活動が working でないときの理由。permission・unknown は種類の表から作り、confirm・idle は CLI に依らない */
export function agentInterruptBlockedByActivityReason(
  activity: Exclude<AgentActivity, 'working'>,
  kind: AgentCliKind
): string {
  switch (activity) {
    case 'permission':
      return `許可待ちのため中断できません（Esc は${AGENT_INTERRUPT_KEY_TEXTS[kind].permissionEscEffect}になります。ターミナルで答えてください）`
    case 'unknown':
      return `作業中か判定できないため押せません（${AGENT_INTERRUPT_KEY_TEXTS[kind].terminalHint}）`
    case 'confirm':
      return '確認待ちのため中断できません（ターミナルで選んでください）'
    case 'idle':
      return '入力待ちのため、中断する作業がありません'
  }
}
/** 中断を送れたときの読み上げ(label は押した時点のタブの名前。formatAgentTabLabel。2 回目の要る種類は 2 回目まで送れたとき) */
export function agentInterruptSentNotice(label: string, kind: AgentCliKind): string {
  return `${label} に中断（${AGENT_INTERRUPT_KEY_TEXTS[kind].sentKeys}）を送りました`
}
/** 2 回目の前に作業中でなくなった・判定できなかったため、2 回目を頼まなかったときの読み上げ(1 回目は届いている。L-001) */
export function agentInterruptFollowUpSkippedNotice(
  label: string,
  activity: Exclude<AgentActivity, 'working'>
): string {
  // 判定できないときは作業が続いていることがあるので、待ってから押し直す案内を添える
  if (activity === 'unknown') {
    return `${label} が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）`
  }
  return `${label} が作業中でなくなったため、2 回目の Esc は送りませんでした`
}
/** 中断を送れなかったときの文言の接頭辞(AGENT_STOP_ERROR_PREFIX と同じ形)。送れたときは、この接頭辞で始まる error だけを消す */
export const AGENT_INTERRUPT_ERROR_PREFIX = '中断を送れませんでした: '
/** main が no-session を返した(終了の知らせが renderer より先・起動し直した・停止中)。commandName はタブの種類のコマンド名 */
export function agentInterruptNoSessionError(commandName: string): string {
  return `${AGENT_INTERRUPT_ERROR_PREFIX}${commandName} が終了したか、起動し直しました`
}
/** main が write-failed を返した(pty への書き込みが例外) */
export const AGENT_INTERRUPT_ERROR_WRITE_FAILED = `${AGENT_INTERRUPT_ERROR_PREFIX}ターミナルへの書き込みに失敗しました`
/** 2 回目が 1 回目から期限を過ぎた(main の expired。負荷で遅れた) */
export const AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED = `${AGENT_INTERRUPT_ERROR_PREFIX}2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）`
/** 2 回目を受け付けていない(main の not-pending) */
export const AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING = `${AGENT_INTERRUPT_ERROR_PREFIX}2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）`
/**
 * main が返した中断の失敗(1 回目は no-session・write-failed、2 回目はさらに not-pending・expired)。IPC の結果の型
 * (AgentInterruptResult・AgentInterruptFollowUpResult)の sent 以外から作り、種類を写し直さない(main が種類を足すと下の switch が型エラーになる)
 */
export type AgentInterruptFailureKind = Exclude<
  AgentInterruptResult['kind'] | AgentInterruptFollowUpResult['kind'],
  'sent'
>
/** main が返した中断の失敗の、タブの error に出す文言。commandName はタブの種類のコマンド名(no-session の文言にだけ使う) */
export function agentInterruptFailureError(
  kind: AgentInterruptFailureKind,
  commandName: string
): string {
  switch (kind) {
    case 'no-session':
      return agentInterruptNoSessionError(commandName)
    case 'write-failed':
      return AGENT_INTERRUPT_ERROR_WRITE_FAILED
    case 'not-pending':
      return AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING
    case 'expired':
      return AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED
  }
}
/** invoke の拒否・window.api の同期の例外 */
export function agentInterruptError(message: string): string {
  return `${AGENT_INTERRUPT_ERROR_PREFIX}${message}`
}
