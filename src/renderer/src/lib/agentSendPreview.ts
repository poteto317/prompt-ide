import { cleanAgentPromptText, normalizeAgentPrompt } from '@shared/agentPasteText'
import { AGENT_SEND_FAILURE_MESSAGES } from './agentSendMessages'

// 送信前の確認のダイアログに出す値(設計書「ダイアログ」)。本文と文字数は送るときと同じ正規化の後の値。送れない理由は送る前の
// 検査(normalizeAgentPrompt)の結果から、送った後の失敗と同じ文言を引く(sendAgentPrompt は変えない)

export interface AgentSendPreview {
  /** 正規化した後の本文(改行の統一・制御文字の除去。送れないときも) */
  text: string
  /** 正規化した後の長さ(上限の判定と同じ基準) */
  length: number
  /** 送れない理由の文言(空・長すぎる・先頭が「!」)。送れるなら null */
  rejection: string | null
}

export function buildAgentSendPreview(raw: string): AgentSendPreview {
  const text = cleanAgentPromptText(raw)
  const normalized = normalizeAgentPrompt(raw)
  return {
    text,
    length: text.length,
    rejection:
      normalized.kind === 'rejected' ? AGENT_SEND_FAILURE_MESSAGES[normalized.reason] : null
  }
}
