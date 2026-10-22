import { useCallback, useRef, useState } from 'react'
import { agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentHistoryInfo } from '@shared/types'
import type { Announcement } from '../types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import { realClock } from '../lib/agentPromptSend'
import { AGENT_PROMPT_SEND_SPECS } from '../lib/agentPromptSendSpecs'
import type { AgentPromptSendResult, AgentSendClock } from '../lib/agentPromptSend'
import {
  AGENT_SEND_ERROR_PREFIX,
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE,
  agentSendFailureMessage
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
  /** 失敗の文言。見える文字は見えているパネル(プロンプト・実行履歴)の上部(AgentSendFeedbackMessages。aria-hidden)、読み上げは
   *  Sidebar がパネルの外に常に置く AgentSendFeedbackAnnouncer の role="alert"。次の送信、または clearResult(送信前の確認を開いたとき)で消える */
  error: string | null
  /** 成功の通知(見える文字と読み上げの置き場は error と同じ。読み上げは AgentSendFeedbackAnnouncer の role="status") */
  notice: Announcement | null
  /** 送信中のタブ(パネルはそのタブの × を押せなくする)。送信中でなければ null */
  sendingSlotId: string | null
  /** target のタブへ送る。送信中は何もしない(undefined を返す)。途中で例外が起きたときも reject せず undefined を返す。
   *  送れたときは、送信の手順を始める時点に控えた送り先(sentTo)と送り先の種類(cliKind)を結果に載せる */
  send: (text: string, target: AgentSendTarget) => Promise<AgentPromptSendResult | undefined>
  /** 前の送信の結果(失敗の文言・成功の通知)を消す。送信前の確認を開いたとき、今のプロンプトの文言に見えないように呼ぶ */
  clearResult: () => void
}

/** 送り先のタブ。押した時点の選択中のタブを控え、途中でタブを切り替えても送り先を変えない */
export interface AgentSendTarget {
  slotId: string
  controller: AgentTerminalController
  /** 送り先のタブの CLI の種類(押した時点の値。送信に対応しない種類には書き込まない。実行ボタンと同じ判定。L-058) */
  cliKind: AgentCliKind
  /**
   * 送り先のタブの今の claude の会話の ID・名前・フォルダ(履歴の HistoryEntry.agent と同じ形)。送信の手順を始める時点
   * (beginSending の直前)に呼んで控える(送信の後で読むと、その間にタブが起動し直した・閉じた・フォルダが変わったときに、
   * 届いた先と違う ID を記録するため。L-037)
   */
  describeSession: () => AgentHistoryInfo | null
}

export interface UseAgentPromptSenderOptions {
  /** 送った後・失敗した後に呼ぶ(ターミナルのパネルを開く) */
  onSettled: () => void
  /** 送信の手順(送り先の種類の手順。claude は消去・貼り付け・Enter、copilot は貼り付け・Enter)の前に待つ準備(エージェントの変更の記録を始める)。失敗しても・上限を超えても送る */
  beforeSend?: () => Promise<void>
  /**
   * そのタブが中断の流れの間か(useAgentInterrupt の isInterrupting。押した時点の判定。省略できない。L-060)。送り先の種類の手順が
   * requiresIdle(copilot)なら、間のときは準備・控え・入力の保留・書き込みをどれもせずに interrupting で断る
   */
  isInterrupting: (slotId: string) => boolean
  clock?: AgentSendClock
}

export function useAgentPromptSender({
  onSettled,
  beforeSend,
  isInterrupting,
  clock = realClock
}: UseAgentPromptSenderOptions): AgentPromptSenderState {
  const [error, setError] = useState<string | null>(null)
  // 送信中のタブ。送信中か(isSending)もここから求め、別の state に持たない
  const [sendingSlotId, setSendingSlotId] = useState<string | null>(null)
  const { notice, announce, clear } = useTransientNotice(AGENT_SEND_NOTICE_DURATION_MS)
  // 2 つの貼り付けが混ざらないよう、同期的に二重の送信を止める(state は次の描画まで変わらないため ref で)
  const sendingRef = useRef(false)

  const send = useCallback(
    async (text: string, target: AgentSendTarget): Promise<AgentPromptSendResult | undefined> => {
      if (sendingRef.current) return undefined
      // 準備(変更の記録)・送り先の控え・入力の保留・書き込みをどれもせずに断る(実行ボタンの理由と同じ判定・同じ文言。見た目だけで
      // 止めない。L-058)。ほかの失敗と同じくパネルを開く
      const rejectBeforeSending = (
        reason: 'unsupported-cli' | 'interrupting'
      ): AgentPromptSendResult => {
        clear()
        setError(agentSendFailureMessage(reason, target.cliKind))
        onSettled()
        return { kind: 'failed', reason }
      }
      // 送り先の CLI が送信に対応していない
      if (!agentCliCapabilities(target.cliKind).promptSend) {
        return rejectBeforeSending('unsupported-cli')
      }
      // 入力待ちのときだけ送る種類(copilot)は、そのタブが中断の流れの間なら断る(2 回目の Esc が貼った本文を消しうる。L-594)
      if (AGENT_PROMPT_SEND_SPECS[target.cliKind].requiresIdle && isInterrupting(target.slotId)) {
        return rejectBeforeSending('interrupting')
      }
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
      // 送り先は送信の手順を始める時点で控える(準備〈変更の記録〉の後。L-037)。控えられなくても送る(記録だけが抜ける)
      let sentTo: AgentHistoryInfo | null = null
      try {
        sentTo = target.describeSession()
      } catch (err) {
        console.error('[useAgentPromptSender] describeSession failed:', err)
      }
      // 送信の手順の間は利用者のキー入力を溜める(貼り付けの途中に打鍵が混ざらないように)。finally で必ず解く
      controller.beginSending()
      try {
        // 手順は送り先の CLI の種類の表から引く(claude は今の手順のまま。copilot は画面の末尾を読む)
        const outcome = await AGENT_PROMPT_SEND_SPECS[target.cliKind].send(
          {
            isBracketedPasteEnabled: () => controller.isBracketedPasteEnabled(),
            readViewport: () => controller.readViewport(),
            readScreen: () => controller.readScreen(),
            getCols: () => controller.getSize().cols,
            write: (data) => controller.writeToSession(data)
          },
          text,
          clock
        )
        if (outcome.kind === 'sent') {
          announce(outcome.clearedDraft ? AGENT_SENT_AFTER_CLEAR_NOTICE : AGENT_SENT_NOTICE)
        } else {
          setError(agentSendFailureMessage(outcome.reason, target.cliKind))
        }
        onSettled()
        return outcome.kind === 'sent' ? { ...outcome, sentTo, cliKind: target.cliKind } : outcome
      } catch (err) {
        // write・画面の読み取りが例外を投げると送信の手順は reject する(copilot の貼り付けの後の読み取りの例外は、手順の中で
        // not-echoed・not-confirmed に倒すのでここへは来ない)。実行ボタンの処理へ未処理の拒否として漏らさず、理由を出してパネルを開く
        console.error('[useAgentPromptSender] 送信の手順が失敗しました:', err)
        setError(`${AGENT_SEND_ERROR_PREFIX}${toError(err).message}`)
        onSettled()
        return undefined
      } finally {
        controller.endSending()
        sendingRef.current = false
        setSendingSlotId(null)
      }
    },
    [onSettled, beforeSend, isInterrupting, clock, announce, clear]
  )

  const clearResult = useCallback((): void => {
    setError(null)
    clear()
  }, [clear])

  return { isSending: sendingSlotId !== null, error, notice, sendingSlotId, send, clearResult }
}
