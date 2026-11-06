// src/renderer/src/lib/agentPermissionAnswerMessages.ts
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentPermissionAnswerResult } from '@shared/types'
import type { AgentPermissionChoice } from './agentPermissionPrompt'
import { AGENT_PERMISSION_OPTION_WORDS } from './agentPermissionPrompt'

// 帯の 許可・拒否 の文言(ボタンの名前・押せない理由・読み上げ・送れなかったときの文言。設計書 2026-11-06「画面」「エラー処理」)。
// CLI で違う部分(番号キーが効かないときの理由・拒否の後の案内)は種類ごとの表で引き、CLI の名前は AGENT_CLI_PROFILES のコマンド名から
// 作る(直書きしない)。押せるかの判定(どの理由を選ぶかの順)は agentPermissionAnswer.ts に置く

interface AgentPermissionAnswerTexts {
  /** 番号キーが選択肢の選択として効かない画面の理由 */
  numberKeysRejected: string
  /** 拒否を送れた後の読み上げに足す案内(拒否が即決せず入力欄を開く種類だけ。即決する種類は null) */
  denyFollowUp: string | null
}

/** CLI ごとの文言。種類を足したときの決め忘れを型エラーにする */
export const AGENT_PERMISSION_ANSWER_TEXTS: Record<AgentCliKind, AgentPermissionAnswerTexts> = {
  claude: {
    numberKeysRejected:
      'カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）',
    denyFollowUp: null
  },
  copilot: {
    numberKeysRejected: `${AGENT_CLI_PROFILES.copilot.commandName} は、代わりにしてほしいことの入力を待っています（ターミナルで入力して Enter を押してください。何も入れずに Esc を押すと操作ごと取り消します）`,
    denyFollowUp: 'ターミナルで、代わりにしてほしいことを入力して Enter を押してください'
  }
}

/** 選択肢ごとの見える文字(名前・理由に出す選択肢の語は、選択肢の規則と同じ AGENT_PERMISSION_OPTION_WORDS) */
const CHOICE_LABELS: Record<AgentPermissionChoice, string> = {
  allow: '許可',
  deny: '拒否'
}

/** ボタンの見える文字(許可・拒否) */
export function agentPermissionAnswerLabel(choice: AgentPermissionChoice): string {
  return CHOICE_LABELS[choice]
}

/**
 * ボタンの aria-label。見える文字で始める(パターン 76)。tabLabel は formatAgentTabLabel。question は問いの全文(行を半角空白でつないだもの。折り返した 2 行目のファイル名も名前に入れる)。問いと番号のどちらかが無いとき
 * (読み取れない・その選択肢が無い)は「許可の確認に <選択肢の語> で答える」(語は AGENT_PERMISSION_OPTION_WORDS。allow なら Yes、deny なら No)
 */
export function agentPermissionAnswerAriaLabel(
  choice: AgentPermissionChoice,
  tabLabel: string,
  question: string | null,
  optionNumber: number | null
): string {
  const label = CHOICE_LABELS[choice]
  const optionWord = AGENT_PERMISSION_OPTION_WORDS[choice]
  if (question === null || optionNumber === null) {
    return `${label}（${tabLabel} の許可の確認に ${optionWord} で答える）`
  }
  return `${label}（${tabLabel} の「${question}」に ${optionNumber} 番の ${optionWord} で答える）`
}

/** セッションが動いていない(帯には出さないが、押した処理の判定でも同じ純関数を使うため理由を持つ) */
export function agentPermissionAnswerNotRunningReason(commandName: string): string {
  return `${commandName} が動いていないため答えられません`
}
/** 能力の表の permissionAnswer が false の種類(帯には出さない) */
export function agentPermissionAnswerUnsupportedReason(commandName: string): string {
  return `${commandName} では許可のボタンを使えません（ターミナルで答えてください）`
}
/** 活動が permission でない(帯には出さない) */
export function agentPermissionAnswerNotPermissionReason(commandName: string): string {
  return `${commandName} は許可待ちではありません`
}
export const AGENT_PERMISSION_ANSWER_DISABLED_CLOSING = '閉じる途中のタブでは答えられません'
export const AGENT_PERMISSION_ANSWER_DISABLED_SENDING = 'プロンプトを送信している間は答えられません'
export const AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM =
  '送信前の確認を開いている間は答えられません'
export const AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING =
  '中断を送った直後は答えられません（少し待つと押せます）'
/** 送っている途中・押してから 1,000ms 以内・送った後の画面を読み直す前 */
export const AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN =
  '答えを押した直後です（少し待つと押せます）'
/** 許可の確認が帯に出た(または別の確認に替わった)描画から AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS 以内 */
export const AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED =
  '許可の確認が出た直後です（少し待つと押せます）'
/**
 * パネルを閉じている間の 許可(拒否 は押せる)。許可する内容(コマンドなど)は本文にしかなく帯には問いの 1 行目だけなので、ターミナルで
 * 確かめないまま Yes を送らない
 */
export const AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED =
  'ターミナルを開いて、許可する内容を確かめてから押してください'
/**
 * ターミナルを上へスクロールして前の出力を読み返している間の、許可 だけの理由。許可の確認(本文のコマンドなど)は画面の末尾に描かれて
 * 見えていないので、帯の問いだけを見て Yes を送らない(claude は通常の画面に描く。copilot は代替画面でスクロールしない)
 */
export const AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP =
  'ターミナルを一番下までスクロールして、許可する内容を確かめてから押してください'
/**
 * 許可の確認の本文の上の端(claude は全幅の罫線、copilot は行頭の ╭)が画面の上へ流れて無い間の、許可 だけの理由。本文(コマンドなど)が
 * 欠けたまま Yes を送らない(ターミナルを低くした・複数行のコマンドや大きな差分の確認)
 */
export const AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT =
  'ターミナルを広げて、許可する内容が全部見える状態で押してください（最大化しても収まらないときはターミナルで答えてください）'
export const AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE =
  '画面の選択肢を読み取れませんでした（ターミナルで答えてください）'
export function agentPermissionAnswerNumberKeysRejectedReason(kind: AgentCliKind): string {
  return AGENT_PERMISSION_ANSWER_TEXTS[kind].numberKeysRejected
}
export function agentPermissionAnswerOptionMissingReason(choice: AgentPermissionChoice): string {
  return `画面に「${AGENT_PERMISSION_OPTION_WORDS[choice]}」の選択肢が見つかりません（ターミナルで答えてください）`
}
/** 押した時点の読み直しで許可待ちでなかった */
export function agentPermissionAnswerNoLongerPermissionReason(commandName: string): string {
  return `${commandName} は許可待ちではなくなりました。画面を確かめてください`
}
/** 押した時点の読み直しで、本文・問い・選択肢が描画のものと違った */
export const AGENT_PERMISSION_ANSWER_PROMPT_CHANGED =
  '許可の確認の内容が変わりました。ターミナルで内容を確かめてからもう一度押してください'

/** 送れたときの読み上げ(label は押した時点のタブの名前、optionNumber は送った番号) */
export function agentPermissionAnswerSentNotice(
  label: string,
  kind: AgentCliKind,
  choice: AgentPermissionChoice,
  optionNumber: number
): string {
  const choiceLabel = CHOICE_LABELS[choice]
  const optionWord = AGENT_PERMISSION_OPTION_WORDS[choice]
  const followUp = AGENT_PERMISSION_ANSWER_TEXTS[kind].denyFollowUp
  if (choice === 'deny' && followUp !== null) {
    return `${label} で${choiceLabel}（${optionNumber} 番）を選びました。${followUp}`
  }
  return `${label} に${choiceLabel}（${optionNumber} 番の ${optionWord}）を送りました`
}

/** 送れなかったときの文言の接頭辞(AGENT_INTERRUPT_ERROR_PREFIX と同じ形)。送れたときは、この接頭辞で始まる error だけを消す */
export const AGENT_PERMISSION_ANSWER_ERROR_PREFIX = '許可の答えを送れませんでした: '
/** main が返した失敗(IPC の結果の型の sent 以外から作り、種類を写し直さない) */
export type AgentPermissionAnswerFailureKind = Exclude<AgentPermissionAnswerResult['kind'], 'sent'>
export function agentPermissionAnswerFailureError(
  kind: AgentPermissionAnswerFailureKind,
  commandName: string
): string {
  switch (kind) {
    case 'no-session':
      return `${AGENT_PERMISSION_ANSWER_ERROR_PREFIX}${commandName} が終了したか、起動し直しました`
    case 'write-failed':
      return `${AGENT_PERMISSION_ANSWER_ERROR_PREFIX}ターミナルへの書き込みに失敗しました`
  }
}
/** invoke の拒否・window.api の同期の例外 */
export function agentPermissionAnswerError(message: string): string {
  return `${AGENT_PERMISSION_ANSWER_ERROR_PREFIX}${message}`
}
