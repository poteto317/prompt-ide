// claude の入力欄へ送る本文の正規化と、送るバイト列(設計書「プロンプトの送信」3・7・9)。純粋関数と定数

/** 送る本文の上限(正規化の後の UTF-16 の単位) */
export const AGENT_PROMPT_MAX_LENGTH = 200_000

/** 入力欄を空にする 1 回の書き込み: Ctrl+K × 12 + Ctrl+U × 12(24 バイト)。64 バイト以上をまとめて送ると効かない(確認の結果 18) */
export const AGENT_CLEAR_INPUT_CHUNK = '\x0b'.repeat(12) + '\x15'.repeat(12)

/** 貼り付けた本文を送信する Enter */
export const AGENT_SUBMIT_KEY = '\r'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang'

export type NormalizedAgentPrompt =
  | { kind: 'ok'; text: string }
  | { kind: 'rejected'; reason: AgentPromptRejection }

// 改行(\n)とタブ(\t)以外の C0 制御文字(ESC を含む)・DEL・C1 制御文字。本文の ESC[201~ で貼り付けが終わり、
// 残りがキー入力(\r で送信など)として解釈されるのを防ぐ
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * 本文の改行を \n にそろえ(\r\n・\r)、制御文字を取り除く。拒否の判定はしない(送信前の確認の画面は、送れない本文も
 * 正規化した後の全文と文字数を出すため、normalizeAgentPrompt と同じ正規化をここから使う)
 */
export function cleanAgentPromptText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '')
}

/**
 * 本文を正規化する。\r\n・\r を \n に統一し、制御文字を取り除く。前後の空白だけ・上限を超える・1 文字目が「!」なら拒否する
 * (「!」で始まる本文は claude のシェルのモードに入り、Enter でシェルのコマンドとして実行される。確認の結果 23)
 */
export function normalizeAgentPrompt(raw: string): NormalizedAgentPrompt {
  const text = cleanAgentPromptText(raw)
  if (text.trim() === '') return { kind: 'rejected', reason: 'empty' }
  if (text.length > AGENT_PROMPT_MAX_LENGTH) return { kind: 'rejected', reason: 'too-long' }
  if (text.startsWith('!')) return { kind: 'rejected', reason: 'leading-bang' }
  return { kind: 'ok', text }
}

/** bracketed paste で囲んだ貼り付けのバイト列(正規化した本文を渡す) */
export function buildAgentPasteBytes(text: string): string {
  return PASTE_START + text + PASTE_END
}
