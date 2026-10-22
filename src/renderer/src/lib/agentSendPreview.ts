import { cleanAgentPromptText, normalizeAgentPrompt } from '@shared/agentPasteText'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { agentSendFailureMessage } from './agentSendMessages'

// 送信前の確認のダイアログに出す値(設計書「ダイアログ」)。本文と文字数は送るときと同じ正規化の後の値。送れない理由は送る前の
// 検査(normalizeAgentPrompt)の結果から、送った後の失敗と同じ文言を引く。規則と文言は確認を開いた時点に控えた送り先の種類で引く
// (設計書 2026-10-22「送信前の確認のプレビュー」。copilot の送り先では /help も開いた時点で送信が押せない)

export interface AgentSendPreview {
  /** 正規化した後の本文(改行の統一・制御文字の除去。送れないときも) */
  text: string
  /** 正規化した後の長さ(上限の判定と同じ基準) */
  length: number
  /** 送れない理由の文言(空・長すぎる・先頭の文字)。送れるなら null */
  rejection: string | null
}

export function buildAgentSendPreview(raw: string, cliKind: AgentCliKind): AgentSendPreview {
  const text = cleanAgentPromptText(raw)
  const normalized = normalizeAgentPrompt(raw, cliKind)
  return {
    text,
    length: text.length,
    rejection:
      normalized.kind === 'rejected' ? agentSendFailureMessage(normalized.reason, cliKind) : null
  }
}
