import { useCallback, useRef, useState } from 'react'
import type { AgentSendTarget } from './useAgentPromptSender'
import type { AgentPromptSendResult } from '../lib/agentPromptSend'
import type { AgentSendOptions } from '../lib/agentPromptRequest'
import { notifyAgentSent } from '../lib/agentSendCallbacks'
import { useLatestRef } from './useLatestRef'

// エージェントへの送信前の確認の状態(設計書「送信前の確認の状態」)。開いている依頼(送る全文・開いた時点の送り先のタブと名前・
// 依頼に添える値(開いた元のプロンプト・未保存の一覧・送れたときの知らせ))を持ち、送信で控えた送り先へ送って、送れたときだけ
// 知らせを呼ぶ。確認を開くか・すぐ送るかの判断と、閉じる契機(方式・フォルダ・タブ)は呼び出し側(useAgentWorkspace)が持つ

export interface PendingAgentSend extends AgentSendOptions {
  /** 送る全文(正規化の前。送るときに sendAgentPrompt が正規化する) */
  text: string
  /** 開いた時点の選択中のタブ(送り先) */
  target: AgentSendTarget
  /** 開いた時点の送り先のタブの名前(表示はこれで固定) */
  label: string
  /** 開いた時点のフォーカスのある要素(一覧の実行・履歴の詳細の再実行 など)。確認からの送信が失敗したときの戻り先 */
  opener: Element | null
}

/** 確認からの送信が終わったときの知らせ */
export interface AgentSendSettled {
  /** 控えた送り先のタブ */
  slotId: string
  /** 開いた元のプロンプトの id */
  promptId: string | null
  /** 開いた時点のフォーカスのある要素(失敗したときの戻り先。一覧が隠れていても戻れるように、一覧の実行より先に試す) */
  opener: Element | null
  /** 送信の結果。send が undefined を返した・投げた・拒否したときは undefined */
  outcome: AgentPromptSendResult | undefined
}

export interface UseAgentSendConfirmOptions {
  /** 選択中のタブ(request の時点の値を送り先として控える) */
  selected: AgentSendTarget & { label: string }
  /** 控えた送り先へ送る(useAgentPromptSender.send) */
  send: (text: string, target: AgentSendTarget) => Promise<AgentPromptSendResult | undefined>
  /** 確認からの送信が終わった後に呼ぶ(結果に応じてフォーカスを移す)。閉じるのは送信を押した時点で、これは待たない */
  onSendSettled: (settled: AgentSendSettled) => void
}

export interface AgentSendConfirmState {
  pending: PendingAgentSend | null
  /** 確認を開く(すでに開いていれば無視)。options(プロンプト・未保存の一覧・送れたときの知らせ)は開いた時点の写しとして控える。描画をまたいで同じ参照 */
  request: (text: string, options: AgentSendOptions) => void
  /** 閉じて、控えた送り先へ送り、送信が終わったら(送れたときは控えた onSent の後に)onSendSettled を呼ぶ */
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
    (text: string, options: AgentSendOptions): void => {
      if (pendingRef.current !== null) return
      const { slotId, controller, describeSession, label } = selectedRef.current
      // 送り先は開いた時点のタブ。送り先の控え(describeSession)も写す(写し忘れると確認を経由した送信だけ履歴の記録が抜ける)
      const next: PendingAgentSend = {
        ...options,
        text,
        target: { slotId, controller, describeSession },
        label,
        opener: document.activeElement
      }
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
    const { text, target, promptId, opener, onSent } = current
    void (async (): Promise<void> => {
      let outcome: AgentPromptSendResult | undefined
      try {
        outcome = await send(text, target)
      } catch (err) {
        console.error('[useAgentSendConfirm] send failed:', err)
      } finally {
        // 送れたときだけ知らせる(エクスプローラから足した参照を外す)。知らせが投げてもフォーカスの移動は止めない(L-053)
        notifyAgentSent(outcome, onSent)
        onSendSettledRef.current({ slotId: target.slotId, promptId, opener, outcome })
      }
    })()
  }, [send, onSendSettledRef])

  return { pending, request, confirm, cancel }
}
