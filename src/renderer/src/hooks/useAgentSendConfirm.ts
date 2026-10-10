import { useCallback, useRef, useState } from 'react'
import type { AgentSendTarget } from './useAgentPromptSender'
import type { AgentSendOutcome } from '../lib/agentPromptSend'
import { useLatestRef } from './useLatestRef'

// エージェントへの送信前の確認の状態(設計書「送信前の確認の状態」)。開いている依頼(送る全文・開いた時点の送り先のタブと名前・
// 開いた元のプロンプト)を持ち、送信で控えた送り先へ送る。確認を開くか・すぐ送るかの判断と、閉じる契機(方式・フォルダ・タブ)は
// 呼び出し側(useAgentWorkspace)が持つ

export interface PendingAgentSend {
  /** 送る全文(正規化の前。送るときに sendAgentPrompt が正規化する) */
  text: string
  /** 開いた時点の選択中のタブ(送り先) */
  target: AgentSendTarget
  /** 開いた時点の送り先のタブの名前(表示はこれで固定) */
  label: string
  /** 開いた元のプロンプトの id(キャンセルで閉じたとき・送信が失敗したときのフォーカスの戻り先を探す) */
  promptId: string | null
}

/** 確認からの送信が終わったときの知らせ */
export interface AgentSendSettled {
  /** 控えた送り先のタブ */
  slotId: string
  /** 開いた元のプロンプトの id */
  promptId: string | null
  /** 送信の結果。send が undefined を返した・投げた・拒否したときは undefined */
  outcome: AgentSendOutcome | undefined
}

export interface UseAgentSendConfirmOptions {
  /** 選択中のタブ(request の時点の値を送り先として控える) */
  selected: AgentSendTarget & { label: string }
  /** 控えた送り先へ送る(useAgentPromptSender.send) */
  send: (text: string, target: AgentSendTarget) => Promise<AgentSendOutcome | undefined>
  /** 確認からの送信が終わった後に呼ぶ(結果に応じてフォーカスを移す)。閉じるのは送信を押した時点で、これは待たない */
  onSendSettled: (settled: AgentSendSettled) => void
}

export interface AgentSendConfirmState {
  pending: PendingAgentSend | null
  /** 確認を開く(すでに開いていれば無視)。描画をまたいで同じ参照 */
  request: (text: string, promptId: string | null) => void
  /** 閉じて、控えた送り先へ送り、送信が終わったら onSendSettled を呼ぶ */
  confirm: () => void
  /** 送らずに閉じる */
  cancel: () => void
}

export function useAgentSendConfirm({
  selected,
  send,
  onSendSettled
}: UseAgentSendConfirmOptions): AgentSendConfirmState {
  const [pending, setPending] = useState<PendingAgentSend | null>(null)
  // 同じ描画の中の 2 回目の request・confirm を止めるため、state とは別に同期的に持つ
  const pendingRef = useRef<PendingAgentSend | null>(null)
  // request を描画をまたいで同じ参照にするため、選択中のタブは ref から読む
  const selectedRef = useLatestRef(selected)
  // 送信の完了は描画をまたぐため、その時点の最新の関数を呼ぶ
  const onSendSettledRef = useLatestRef(onSendSettled)

  const request = useCallback(
    (text: string, promptId: string | null): void => {
      if (pendingRef.current !== null) return
      const { slotId, controller, label } = selectedRef.current
      const next: PendingAgentSend = { text, target: { slotId, controller }, label, promptId }
      pendingRef.current = next
      setPending(next)
    },
    [selectedRef]
  )

  const cancel = useCallback((): void => {
    pendingRef.current = null
    setPending(null)
  }, [])

  const confirm = useCallback((): void => {
    const current = pendingRef.current
    if (current === null) return
    pendingRef.current = null
    setPending(null)
    // send は拒否しない約束だが、同期で投げても・拒否しても、後続(フォーカスの移動)は止めない(L-053)
    const { text, target, promptId } = current
    void (async (): Promise<void> => {
      let outcome: AgentSendOutcome | undefined
      try {
        outcome = await send(text, target)
      } catch (err) {
        console.error('[useAgentSendConfirm] send failed:', err)
      } finally {
        onSendSettledRef.current({ slotId: target.slotId, promptId, outcome })
      }
    })()
  }, [send, onSendSettledRef])

  return { pending, request, confirm, cancel }
}
