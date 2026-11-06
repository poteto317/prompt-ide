import { AGENT_PERMISSION_OPTION_NUMBER_MAX } from '@shared/agentPermissionAnswer'
import type { ViewportLine } from './agentViewport'

// 画面から読み取った許可の確認の型と、CLI に依らない規則(帯の 許可・拒否 に使う選択肢・描画と押した時点の照合・形の確かめ)。
// 設計書 2026-11-06「選択肢の読み取り」。CLI ごとの読み取りは claudePermissionPrompt.ts・copilotPermissionPrompt.ts、
// 種類ごとの表は agentPermissionPromptReaders.ts(このファイルに置くと読み取りの import と循環するため)

export interface AgentPermissionOption {
  /** 画面の番号(1〜AGENT_PERMISSION_OPTION_NUMBER_MAX) */
  number: number
  /** 番号の後の文言。折り返しの行は字下げを除いて半角空白 1 つでつなぐ(照合と Yes・No の判定にだけ使う) */
  text: string
}

export interface AgentPermissionPrompt {
  /** 問いの上の、許可の画面の中の行(コマンドなど。枠と前後の空白を除き、空の行は除く)。照合にだけ使う */
  body: readonly string[]
  /** 問いの行(前後の空白を除く)。帯に出すのは 1 行目 */
  question: readonly string[]
  /** 番号の順(1 から欠けずに並ぶ) */
  options: readonly AgentPermissionOption[]
  /** カーソルのある選択肢の番号 */
  cursorNumber: number
  /** 今の画面で、番号キーが選択肢の選択として効くか(CLI ごとの規則。L-041) */
  numberKeysAccepted: boolean
  /**
   * 本文の上の端(claude は全幅の罫線、copilot は行頭の ╭)を画面の中で見つけたか。偽なら本文は画面の先頭からで、上が欠けているかもしれない
   * (ターミナルが低い・本文が長い)。偽の間は 許可 だけを押せなくする(押せるかの判定)
   */
  bodyStartVisible: boolean
}

/** 画面の行から許可の確認を読み取る。許可待ちの画面でない・形が崩れているなら null。例外は投げない */
export type AgentPermissionPromptReader = (
  lines: readonly ViewportLine[]
) => AgentPermissionPrompt | null

export type AgentPermissionChoice = 'allow' | 'deny'

/**
 * 帯のボタンに使う選択肢の語(画面の選択肢の文言)。選択肢の規則(CHOICE_RULES)と、ボタンの名前・押せない理由・読み上げに出す語
 * (agentPermissionAnswerMessages.ts)が同じ語を使う(CLI の版で語が変わったときに、ここだけを直せば規則と文言が揃う)
 */
export const AGENT_PERMISSION_OPTION_WORDS: Record<AgentPermissionChoice, string> = {
  allow: 'Yes',
  deny: 'No'
}

/**
 * 帯のボタンに使う選択肢の規則。allow は文言がちょうど `Yes`(「今後は確かめない」系の `Yes, and …` を許可にしない)、
 * deny は `No` そのものか `No,` で始まる(`Not now`・`Nothing` に当てない)
 */
const CHOICE_RULES: Record<AgentPermissionChoice, (text: string) => boolean> = {
  allow: (text) => text === AGENT_PERMISSION_OPTION_WORDS.allow,
  deny: (text) =>
    text === AGENT_PERMISSION_OPTION_WORDS.deny ||
    text.startsWith(`${AGENT_PERMISSION_OPTION_WORDS.deny},`)
}

/** 規則に当たる選択肢がちょうど 1 つのときだけ返す。無い・複数なら null */
export function findAgentPermissionOption(
  prompt: Pick<AgentPermissionPrompt, 'options'>,
  choice: AgentPermissionChoice
): AgentPermissionOption | null {
  const matched = prompt.options.filter((option) => CHOICE_RULES[choice](option.text))
  return matched.length === 1 ? matched[0] : null
}

const sameLines = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((line, index) => line === b[index])

/**
 * 本文・問い・選択肢の {番号, 文言} の並びの完全一致(件数ではなく中身で比べる。L-036)。cursorNumber・numberKeysAccepted・
 * bodyStartVisible は比べない(押した時点の値で別に確かめ、「内容が変わった」より具体的な理由を出す)
 */
export function isSameAgentPermissionPrompt(
  a: AgentPermissionPrompt,
  b: AgentPermissionPrompt
): boolean {
  return (
    sameLines(a.body, b.body) &&
    sameLines(a.question, b.question) &&
    a.options.length === b.options.length &&
    a.options.every(
      (option, index) =>
        option.number === b.options[index].number && option.text === b.options[index].text
    )
  )
}

/**
 * 照合の項目(isSameAgentPermissionPrompt)に加えて、カーソル・番号キー・本文の上の端も同じか。描画の読み取りの控え(useAgentPermissionPrompt)が、
 * 変わったときだけ state を更新するのに使う。どちらも null なら同じ、片方だけ null なら違う
 */
export function isSameAgentPermissionPromptState(
  a: AgentPermissionPrompt | null,
  b: AgentPermissionPrompt | null
): boolean {
  if (a === null || b === null) return a === b
  return (
    isSameAgentPermissionPrompt(a, b) &&
    a.cursorNumber === b.cursorNumber &&
    a.numberKeysAccepted === b.numberKeysAccepted &&
    a.bodyStartVisible === b.bodyStartVisible
  )
}

/** 形の確かめ: 番号が 1 から欠けずに並び、上限以下で、カーソルの行がちょうど 1 つ */
export function isWellFormedAgentPermissionOptions(
  options: readonly AgentPermissionOption[],
  cursorNumbers: readonly number[]
): boolean {
  return (
    options.length > 0 &&
    options.length <= AGENT_PERMISSION_OPTION_NUMBER_MAX &&
    options.every((option, index) => option.number === index + 1) &&
    cursorNumbers.length === 1
  )
}
