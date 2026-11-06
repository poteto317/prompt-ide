// src/renderer/src/hooks/useAgentPermissionPrompt.ts
import { useLayoutEffect, useRef, useState } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import { isSameAgentPermissionPromptState } from '../lib/agentPermissionPrompt'
import { readAgentPermissionPromptFor } from '../lib/agentPermissionPromptReaders'
import { classifyAgentScreenFor } from '../lib/agentScreenClassifiers'
import {
  AGENT_PERMISSION_ANSWER_COOLDOWN_MS,
  isAgentPermissionAnswerVisible
} from '../lib/agentPermissionAnswer'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import type { AgentSessionTabView } from './useAgentSessions'
import { AGENT_ACTIVITY_MAX_WAIT_MS, AGENT_ACTIVITY_SETTLE_MS } from './useAgentActivity'

// 帯の 許可・拒否 の描画に使う、選択中のタブの許可の確認の読み取り(設計書 2026-11-06「描画に使う読み取り」)。選択中のタブが running で、
// 能力の permissionAnswer が true で、活動が permission の間(帯に出す間。isAgentPermissionAnswerVisible)だけ働く(それ以外は購読もタイマーも持たない)。useAgentActivity は変えない。
// 判定と読み取りは同じ行から行う(L-041)。答えを送ったタブは「読み直し待ち」の間、判定用の prompt に null を返す。前の読み取りで押させないのは
// isAnswering(読み直し待ちを含む)が先に止める。prompt: null は判定の順が変わったときの予備の守り(二重の守り。L-408)。表示用の displayPrompt は直前の控えのまま返す(押した直後にボタンの名前と問いが変わらないように)。
// 読み直しの控えの更新と onReread を同じコールバックで呼ぶ(React が 1 回の描画にまとめる)

/** 読み取りに使う選択中のタブの値(AgentSessionTabView の一部) */
export type AgentPermissionPromptTab = Pick<
  AgentSessionTabView,
  'slotId' | 'status' | 'cliKind'
> & {
  controller: Pick<AgentTerminalController, 'onOutputWritten' | 'onResized' | 'readScreen'>
}

export interface UseAgentPermissionPromptOptions {
  /** 選択中のタブ */
  selected: AgentPermissionPromptTab
  /** 選択中のタブの活動(描画に使った値。未記録は unknown) */
  activity: AgentActivity
  /** 描画用: そのタブが「送った後の画面の読み直し待ち」か(useAgentPermissionAnswerCooldown の isAwaitingReread。state) */
  isAwaitingReread: (slotId: string) => boolean
  /** 読み直し待ちのタブを読み直した(または読む必要が無くなった)ことを知らせる(useAgentPermissionAnswerCooldown の markReread。参照は安定) */
  onReread: (slotId: string) => void
}

export interface AgentPermissionPromptState {
  /** 判定用: 選択中のタブの、最後に読み取った許可の確認。許可待ちでない・読み取れない・読み直し待ちなら null */
  prompt: AgentPermissionPrompt | null
  /**
   * 表示用(問い・ボタンの名前): prompt と同じだが、読み直し待ちの間も同じタブの直前の読み取りを返す(押した直後に名前と問いが変わらない
   * ように)。押せるかの判定と送る番号には使わない
   */
  displayPrompt: AgentPermissionPrompt | null
}

interface PromptEntry {
  slotId: string
  prompt: AgentPermissionPrompt | null
}

export function useAgentPermissionPrompt({
  selected,
  activity,
  isAwaitingReread,
  onReread
}: UseAgentPermissionPromptOptions): AgentPermissionPromptState {
  const { slotId, status, cliKind, controller } = selected
  const [entry, setEntry] = useState<PromptEntry | null>(null)
  // 控え(前の値と比べて、変わったときだけ setEntry する)
  const entryRef = useRef<PromptEntry | null>(null)
  // 前の effect のタブ。読み直し待ちのタブを選び直した描画では待たずにすぐ読む
  const effectSlotRef = useRef<string | null>(null)
  // 帯に出す条件と同じ(判定の lib で 1 か所に決める)
  const active = isAgentPermissionAnswerVisible({ status, cliKind, activity })
  const awaiting = isAwaitingReread(slotId)

  // 描画の前に反映する(読み取る前の一瞬に「読み取れない」の理由が出ないように)
  useLayoutEffect(() => {
    const switched = effectSlotRef.current !== slotId
    effectSlotRef.current = slotId
    if (!active) {
      // 許可して作業中になったタブ・running でなくなったタブで、中断の理由が読み直し待ちのまま残らないように
      if (awaiting) onReread(slotId)
      return
    }
    const commit = (prompt: AgentPermissionPrompt | null): void => {
      const previous = entryRef.current
      if (
        previous === null ||
        previous.slotId !== slotId ||
        !isSameAgentPermissionPromptState(previous.prompt, prompt)
      ) {
        const next: PromptEntry = { slotId, prompt }
        entryRef.current = next
        setEntry(next)
      }
      // 控えの更新と同じコールバックで読み直し待ちを外す(待ちが外れた描画には必ず新しい読み取りが入っている)
      if (awaiting) onReread(slotId)
    }
    // 出力の通知からの読み直しのタイマー(最後の通知からの待ちと、最初の未読の通知からの上限。useAgentActivity と同じ)
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    const clearOutputTimers = (): void => {
      if (settleTimer !== null) clearTimeout(settleTimer)
      if (deadlineTimer !== null) clearTimeout(deadlineTimer)
      settleTimer = null
      deadlineTimer = null
    }
    /**
     * 画面を読んで控える。byDeadline は上限(出力が続いている最中)からの読み直しか。上限の読み直しは CLI の描き直しの途中を
     * 読みうるため、その画面の活動の判定が unknown なら採らずに前の控えと読み直し待ちを保ち、待ちのタイマー(上限が来たときは
     * 必ず張られている)を残して出力が途絶えた後の読み直しに任せる(useAgentActivity の上限の判定と同じ規則)
     */
    const read = (byDeadline: boolean): void => {
      let prompt: AgentPermissionPrompt | null = null
      try {
        const lines = controller.readScreen()
        if (byDeadline && classifyAgentScreenFor(cliKind, lines) === 'unknown') {
          // 上限の起点だけを消す(次の上限は次の通知から数える)。待ちのタイマーは残す
          deadlineTimer = null
          return
        }
        prompt = readAgentPermissionPromptFor(cliKind, lines)
      } catch (error) {
        console.error('[useAgentPermissionPrompt] 画面を読めませんでした:', error)
      }
      // 読んだら待ちと上限の両方を消す(次の通知から数え直す)
      clearOutputTimers()
      commit(prompt)
    }
    // 同じタブのまま読み直し待ちになった描画: CLI が数字を受け取って描き直すのを待つ(次の通知の 150ms 後〈通知が続けば最初の通知の 500ms 後〉か 1,000ms 後の早い方)
    const waitForRedraw = awaiting && !switched
    const rereadTimer = waitForRedraw
      ? setTimeout(() => read(false), AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
      : null
    if (!waitForRedraw) read(false)
    // 最後の通知から AGENT_ACTIVITY_SETTLE_MS 後と、最初の未読の通知から AGENT_ACTIVITY_MAX_WAIT_MS 後の早い方で読む
    // (CLI が 150ms より短い間隔で描き続けても控えが古いままにならないように)
    const onChanged = (): void => {
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => read(false), AGENT_ACTIVITY_SETTLE_MS)
      if (deadlineTimer === null)
        deadlineTimer = setTimeout(() => read(true), AGENT_ACTIVITY_MAX_WAIT_MS)
    }
    const unsubscribeOutput = controller.onOutputWritten(onChanged)
    // ターミナルの大きさの変化も同じタイマーで読み直す。行を増やすと xterm は出力が無くてもスクロールバックの行(本文の上の端)を
    // 画面へ下ろすが、claude は行を増やしただけでは描き直さず出力の通知が来ない(広げても bodyStartVisible が偽のまま残らないように)
    const unsubscribeResized = controller.onResized(onChanged)
    return () => {
      unsubscribeOutput()
      unsubscribeResized()
      clearOutputTimers()
      if (rereadTimer !== null) clearTimeout(rereadTimer)
    }
  }, [active, awaiting, slotId, cliKind, controller, onReread])

  // 読み直し待ちの間は、state を変えずに判定用だけ null を返す(effect で null を入れない)。表示用は同じタブの直前の控えのまま
  const displayPrompt = active && entry !== null && entry.slotId === slotId ? entry.prompt : null
  const prompt = awaiting ? null : displayPrompt
  return { prompt, displayPrompt }
}
