// エージェント CLI の入力欄へ送る本文の正規化と、送るバイト列(設計書「プロンプトの送信」3・7・9、2026-10-22「本文の検査」)。純粋関数と定数
import type { AgentCliKind } from './agentCliKinds'

/** 送る本文の上限(正規化の後の UTF-16 の単位) */
export const AGENT_PROMPT_MAX_LENGTH = 200_000

/**
 * claude の入力欄を空にする 1 回の書き込み: Ctrl+K × 12 + Ctrl+U × 12(24 バイト)。64 バイト以上をまとめて送ると効かない(確認の結果 18)。
 * claude の手順(claudePromptSend.ts)だけが使う。copilot へは消去のキーを書かない(L-041)
 */
export const AGENT_CLEAR_INPUT_CHUNK = '\x0b'.repeat(12) + '\x15'.repeat(12)

/** 貼り付けた本文を送信する Enter */
export const AGENT_SUBMIT_KEY = '\r'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang' | 'leading-slash'

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

/** 正規化の後の本文を CLI ごとに断る規則(空・長すぎるの後にかける)。送信の手順の表は renderer の agentPromptSendSpecs.ts */
type AgentPromptTextRule = (text: string) => AgentPromptRejection | null

export const AGENT_PROMPT_TEXT_RULES: Record<AgentCliKind, AgentPromptTextRule> = {
  // 「!」で始まる本文は claude のシェルのモードに入る(確認の結果 23。今までどおり 1 文字目だけを見る)
  claude: (text) => (text.startsWith('!') ? 'leading-bang' : null),
  // copilot 1.0.87: 先頭の ! はシェルの実行、先頭の / はスラッシュコマンドの実行(段階 2b の追加の記録)。先頭の空白の後は記録していないので、
  // 空白を除いた最初の文字で見る。末尾の @ の語は断らず、copilotPromptSend.ts の buildCopilotPasteText が空白を足す
  copilot: (text) => {
    const head = text.trimStart()
    if (head.startsWith('!')) return 'leading-bang'
    if (head.startsWith('/')) return 'leading-slash'
    return null
  }
}

/**
 * 本文を正規化する。\r\n・\r を \n に統一し、制御文字を取り除く。前後の空白だけ・上限を超える・送り先の CLI の規則
 * (AGENT_PROMPT_TEXT_RULES)に当たるなら拒否する。判定は正規化の後に行う(除去の後に先頭へ来る「!」を見逃さない。L-083)。
 * 種類は省略できない(L-060)
 */
export function normalizeAgentPrompt(raw: string, kind: AgentCliKind): NormalizedAgentPrompt {
  const text = cleanAgentPromptText(raw)
  if (text.trim() === '') return { kind: 'rejected', reason: 'empty' }
  if (text.length > AGENT_PROMPT_MAX_LENGTH) return { kind: 'rejected', reason: 'too-long' }
  const rejection = AGENT_PROMPT_TEXT_RULES[kind](text)
  if (rejection !== null) return { kind: 'rejected', reason: rejection }
  return { kind: 'ok', text }
}

/** bracketed paste で囲んだ貼り付けのバイト列(正規化した本文を渡す) */
export function buildAgentPasteBytes(text: string): string {
  return PASTE_START + text + PASTE_END
}
