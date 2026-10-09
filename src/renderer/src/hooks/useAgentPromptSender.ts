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
/** 送信の前の準備(エージェントの変更の記録)を待つ上限。main の記録の打ち切りと同じ 10 秒 */
export const AGENT_BEFORE_SEND_TIMEOUT_MS = 10_000

export interface AgentPromptSenderState {
  /** 送信中か(sendingSlotId が null でない) */
  isSending: boolean
  /** 失敗の文言(プロンプトパネルの上部に role="alert")。次の送信で消える */
  error: string | null
  /** 成功の通知(role="status") */
  notice: Announcement | null
  /** 送信中のタブ(パネルはそのタブの × を押せなくする)。送信中でなければ null */
  sendingSlotId: string | null
  /** target のタブへ送る。送信中は何もしない(undefined を返す)。途中で例外が起きたときも reject せず undefined を返す */
  send: (text: string, target: AgentSendTarget) => Promise<AgentSendOutcome | undefined>
}

/** 送り先のタブ。押した時点の選択中のタブを控え、途中でタブを切り替えても送り先を変えない */
export interface AgentSendTarget {
  slotId: string
  controller: AgentTerminalController
}

export interface UseAgentPromptSenderOptions {
  /** 送った後・失敗した後に呼ぶ(ターミナルのパネルを開く) */
  onSettled: () => void
  /** 送信の手順(消去・貼り付け・Enter)の前に待つ準備(エージェントの変更の記録を始める)。失敗しても・上限を超えても送る */
  beforeSend?: () => Promise<void>
  clock?: AgentSendClock
}

export function useAgentPromptSender({
  onSettled,
  beforeSend,
  clock = realClock
}: UseAgentPromptSenderOptions): AgentPromptSenderState {
  const [error, setError] = useState<string | null>(null)
  // 送信中のタブ。送信中か(isSending)もここから求め、別の state に持たない
  const [sendingSlotId, setSendingSlotId] = useState<string | null>(null)
  const { notice, announce, clear } = useTransientNotice(AGENT_SEND_NOTICE_DURATION_MS)
  // 2 つの貼り付けが混ざらないよう、同期的に二重の送信を止める(state は次の描画まで変わらないため ref で)
  const sendingRef = useRef(false)

  const send = useCallback(
    async (text: string, target: AgentSendTarget): Promise<AgentSendOutcome | undefined> => {
      if (sendingRef.current) return undefined
      const { controller } = target
      sendingRef.current = true
      setSendingSlotId(target.slotId)
      setError(null)
      clear()
      // エージェントが書き始めるのは Enter の後なので、記録はその前に終わらせる(設計書「記録の開始」)。記録はおまけで、
      // 送ることが主のため、失敗しても上限を超えても送る。待つ間は利用者のキー入力を溜めない
      if (beforeSend !== undefined) {
        await Promise.race([
          // 同期の例外も reject と同じに扱う(try/finally の外で投げて送信中のまま固まらないように)
          Promise.resolve()
            .then(beforeSend)
            .catch(() => undefined),
          clock.sleep(AGENT_BEFORE_SEND_TIMEOUT_MS)
        ])
      }
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
        setSendingSlotId(null)
      }
    },
    [onSettled, beforeSend, clock, announce, clear]
  )

  return { isSending: sendingSlotId !== null, error, notice, sendingSlotId, send }
}
