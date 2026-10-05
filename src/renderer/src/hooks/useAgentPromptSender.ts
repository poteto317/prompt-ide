import { useCallback, useRef, useState } from 'react'
import type { Announcement } from '../types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import { sendAgentPrompt, realClock } from '../lib/agentPromptSend'
import type { AgentSendClock, AgentSendOutcome } from '../lib/agentPromptSend'
import {
  AGENT_SEND_ERROR_PREFIX,
  AGENT_SEND_FAILURE_MESSAGES,
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE
} from '../lib/agentSendMessages'
import { toError } from '../lib/errorUtils'
import { useTransientNotice } from './useTransientNotice'

/** 送信の結果の通知を消すまでの時間 */
export const AGENT_SEND_NOTICE_DURATION_MS = 3_000

export interface AgentPromptSenderState {
  isSending: boolean
  /** 失敗の文言(プロンプトパネルの上部に role="alert")。次の送信で消える */
  error: string | null
  /** 成功の通知(role="status") */
  notice: Announcement | null
  /** 送る。送信中は何もしない(undefined を返す)。途中で例外が起きたときも reject せず undefined を返す */
  send: (text: string) => Promise<AgentSendOutcome | undefined>
}

export interface UseAgentPromptSenderOptions {
  controller: AgentTerminalController
  /** 送った後・失敗した後に呼ぶ(ターミナルのパネルを開く) */
  onSettled: () => void
  clock?: AgentSendClock
}

export function useAgentPromptSender({
  controller,
  onSettled,
  clock = realClock
}: UseAgentPromptSenderOptions): AgentPromptSenderState {
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { notice, announce, clear } = useTransientNotice(AGENT_SEND_NOTICE_DURATION_MS)
  // 2 つの貼り付けが混ざらないよう、同期的に二重の送信を止める(state は次の描画まで変わらないため ref で)
  const sendingRef = useRef(false)

  const send = useCallback(
    async (text: string): Promise<AgentSendOutcome | undefined> => {
      if (sendingRef.current) return undefined
      sendingRef.current = true
      setIsSending(true)
      setError(null)
      clear()
      // 送信の手順の間は利用者のキー入力を溜める(貼り付けの途中に打鍵が混ざらないように)。finally で必ず解く
      controller.beginSending()
      try {
        const outcome = await sendAgentPrompt(
          {
            isBracketedPasteEnabled: () => controller.isBracketedPasteEnabled(),
            readViewport: () => controller.readViewport(),
            getCols: () => controller.getSize().cols,
            write: (data) => controller.writeToSession(data)
          },
          text,
          clock
        )
        if (outcome.kind === 'sent') {
          announce(outcome.clearedDraft ? AGENT_SENT_AFTER_CLEAR_NOTICE : AGENT_SENT_NOTICE)
        } else {
          setError(AGENT_SEND_FAILURE_MESSAGES[outcome.reason])
        }
        onSettled()
        return outcome
      } catch (err) {
        // write・readViewport が例外を投げると sendAgentPrompt は reject する。実行ボタンの処理へ
        // 未処理の拒否として漏らさず、理由を出してパネルを開く
        console.error('[useAgentPromptSender] sendAgentPrompt failed:', err)
        setError(`${AGENT_SEND_ERROR_PREFIX}${toError(err).message}`)
        onSettled()
        return undefined
      } finally {
        controller.endSending()
        sendingRef.current = false
        setIsSending(false)
      }
    },
    [controller, onSettled, clock, announce, clear]
  )

  return { isSending, error, notice, send }
}
