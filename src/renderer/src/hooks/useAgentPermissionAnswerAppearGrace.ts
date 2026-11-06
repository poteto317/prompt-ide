// src/renderer/src/hooks/useAgentPermissionAnswerAppearGrace.ts
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS } from '../lib/agentPermissionAnswer'
import type { AgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import { isSameAgentPermissionPrompt } from '../lib/agentPermissionPrompt'

// 帯の 許可・拒否 の「出た直後の猶予」(設計書 2026-11-06「連打の対策」)。許可・拒否 は利用者の操作ではなく CLI の出力をきっかけに 中断 の
// 直前へ挿し込まれるので、幅が足りず帯の要素が縮んでいるとき(帯があふれる幅、または記録があって 変更を確認 が縮む幅)は 中断・終了 が右へずれ、中断 を押そうとした 1 回目のクリックが出たばかりの 許可 に届く。選択中のタブで
// 帯に出た描画(visible が偽から真・別のタブを選んだ描画)と、表示用の読み取りが別の確認に替わった描画(読み取れない → 読み取れた を含む)
// から AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS は押せない。描画が読む値(state)と押した処理が読む値(ref)を両方持つ。
// 始めるのは useLayoutEffect(出た描画が画面に出る前に state と ref の両方を立て、最初に見えたフレームから押せない)。
// タイマーはアンマウントで消す(L-052)。StrictMode の付け直しでは控えも消し、付け直した描画で数え直す(猶予が立ったまま残らない)

export interface AgentPermissionAnswerAppearGrace {
  /** 描画用(state): 出た直後の猶予の間 */
  isJustAppeared: boolean
  /** 押した時点用(ref。参照は安定): isJustAppeared と同じ間 */
  isJustAppearedNow: () => boolean
}

export interface UseAgentPermissionAnswerAppearGraceOptions {
  /** 選択中のタブ */
  slotId: string
  /** 帯に 許可・拒否 を出しているか(isAgentPermissionAnswerVisible) */
  visible: boolean
  /** 表示用の読み取り(useAgentPermissionPrompt の displayPrompt。問いとボタンの名前に使う値。帯の並びはこれで変わる) */
  prompt: AgentPermissionPrompt | null
}

interface ShownView {
  slotId: string
  prompt: AgentPermissionPrompt | null
}

/** 前に出ていた帯から、出し直し・別の確認への替わりがあったか(カーソルや番号キーの効き方だけの変化は替わりにしない) */
function hasAppeared(previous: ShownView | null, next: ShownView): boolean {
  if (previous === null || previous.slotId !== next.slotId) return true
  if (next.prompt === null) return false
  return previous.prompt === null || !isSameAgentPermissionPrompt(previous.prompt, next.prompt)
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null }

const clearTimer = (timerRef: TimerRef): void => {
  if (timerRef.current !== null) clearTimeout(timerRef.current)
  timerRef.current = null
}

export function useAgentPermissionAnswerAppearGrace({
  slotId,
  visible,
  prompt
}: UseAgentPermissionAnswerAppearGraceOptions): AgentPermissionAnswerAppearGrace {
  const [isJustAppeared, setJustAppeared] = useState(false)
  // 猶予のタイマー。押した処理はこれがあるかで猶予の間かを読む
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 前の描画で出ていた帯(出ていなければ null)
  const shownRef = useRef<ShownView | null>(null)

  useLayoutEffect(() => {
    const previous = shownRef.current
    if (!visible) {
      shownRef.current = null
      if (timerRef.current !== null) {
        clearTimer(timerRef)
        setJustAppeared(false)
      }
      return
    }
    const next: ShownView = { slotId, prompt }
    shownRef.current = next
    if (!hasAppeared(previous, next)) return
    clearTimer(timerRef)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setJustAppeared(false)
    }, AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    setJustAppeared(true)
  }, [visible, slotId, prompt])

  useEffect(
    () => () => {
      clearTimer(timerRef)
      shownRef.current = null
    },
    []
  )

  const isJustAppearedNow = useCallback((): boolean => timerRef.current !== null, [])

  return { isJustAppeared, isJustAppearedNow }
}
