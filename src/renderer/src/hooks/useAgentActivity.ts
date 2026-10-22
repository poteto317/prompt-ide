import { useEffect, useMemo, useRef, useState } from 'react'
import { agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { classifyAgentScreenFor } from '../lib/agentScreenClassifiers'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentSessionStatus } from '../lib/agentSessionTabState'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import type { ViewportLine } from '../lib/agentViewport'

// タブごとのエージェント CLI の活動(設計書「活動の hook」「再判定のきっかけ」)。controller の書き込みの通知(onOutputWritten)を購読し、
// 最後の通知から出力が途絶えたら(続いていても最初の未判定の通知から上限が経てば)画面の末尾を読んで判定する。セッションの起動・停止の手順(useAgentSessions)とは分ける。
// 判定の関数は、判定の時点のタブの種類で種類ごとの表(agentScreenClassifiers)から引く。画面の判定が無い種類
// (能力の表の screenActivity が false の種類。段階 2a の時点では無い)のタブは購読しない

/** 最後の書き込みの通知から判定までの待ち。背面でも止まらないよう requestAnimationFrame ではなく setTimeout で待つ */
export const AGENT_ACTIVITY_SETTLE_MS = 150

/**
 * 最初の未判定の通知から判定までの上限の待ち。エージェント CLI は作業中にスピナーなどを描き続け、通知が待ちより短い間隔で
 * 続くことがあるため、出力が途絶えなくてもこの時間が経てば判定する(lodash の debounce の maxWait に当たる)
 */
export const AGENT_ACTIVITY_MAX_WAIT_MS = 500

// セッションの区切りは status の変化(running へ入る・出る)で見る。新しいセッションは必ず starting(または none)から
// running へ入り、その間に描画が挟まるため。sessionId はタブの表示の状態に持たせない(useAgentSessions の ref と controller が持つ)
export interface AgentActivityTab {
  slotId: string
  status: AgentSessionStatus
  controller: AgentTerminalController
  /** タブの CLI の種類。判定の関数を引く(agentScreenClassifiers)。画面の判定(screenActivity)が無い種類は購読しない */
  cliKind: AgentCliKind
}

export interface UseAgentActivityOptions {
  tabs: readonly AgentActivityTab[]
  /** タブの種類と画面の行から活動を判定する(既定は classifyAgentScreenFor。種類ごとの判定の表を引く)。行は読むだけ */
  classify?: (kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity
}

// タブごとに持つもの(購読・待っている判定のタイマー〈待ちと上限〉・前回 running だったか)。寿命はタブと同じで、
// タブが消えたとき・アンマウントのときに releaseWatch でまとめて手放す(寿命の同じ控えを 1 つの記録に置き、手放し漏れを防ぐ)。
// TabWatch・acquireWatch はこの hook の内部の控えで、テストは hook を通して確かめる
interface TabWatch {
  controller: AgentTerminalController
  unsubscribe: () => void
  /** 最後の通知からの待ち(AGENT_ACTIVITY_SETTLE_MS)のタイマー */
  timer: ReturnType<typeof setTimeout> | null
  /** 最初の未判定の通知からの上限(AGENT_ACTIVITY_MAX_WAIT_MS)のタイマー。判定したら消す */
  deadline: ReturnType<typeof setTimeout> | null
  /** セッションの区切りを見るための、前回 running だったか */
  wasRunning: boolean
}

/** 待っている判定(待ちと上限の両方)を取り消す */
const cancelTimer = (watch: TabWatch): void => {
  if (watch.timer !== null) clearTimeout(watch.timer)
  if (watch.deadline !== null) clearTimeout(watch.deadline)
  watch.timer = null
  watch.deadline = null
}

const releaseWatch = (watch: TabWatch): void => {
  watch.unsubscribe()
  cancelTimer(watch)
}

/**
 * タブの控えを用意する(releaseWatch の対)。購読は初めて見たとき・controller が変わったときだけ張る。
 * 初めて見たタブは「前回 running でなかった」として控えを作る。既にある控えの wasRunning・timer は変えない
 */
function acquireWatch(
  watches: Map<string, TabWatch>,
  tab: Pick<AgentActivityTab, 'slotId' | 'controller'>,
  onWritten: () => void
): TabWatch {
  const watch = watches.get(tab.slotId)
  if (watch === undefined) {
    const created: TabWatch = {
      controller: tab.controller,
      unsubscribe: tab.controller.onOutputWritten(onWritten),
      timer: null,
      deadline: null,
      wasRunning: false
    }
    watches.set(tab.slotId, created)
    return created
  }
  if (watch.controller !== tab.controller) {
    watch.unsubscribe()
    watch.controller = tab.controller
    watch.unsubscribe = tab.controller.onOutputWritten(onWritten)
  }
  return watch
}

/** タブごとの活動。running でないタブ・まだ判定していないタブは 'unknown' */
export function useAgentActivity({
  tabs,
  classify = classifyAgentScreenFor
}: UseAgentActivityOptions): ReadonlyMap<string, AgentActivity> {
  const [entries, setEntries] = useState<ReadonlyMap<string, AgentActivity>>(() => new Map())
  // 判定の結果の控え。結果が前と同じなら setState を呼ばない(関数の更新で prev を返しても描画が 1 回走りうるため)
  const entriesRef = useRef(entries)
  const tabsRef = useRef(new Map<string, AgentActivityTab>())
  const classifyRef = useRef(classify)
  const watchesRef = useRef(new Map<string, TabWatch>())

  useEffect(() => {
    classifyRef.current = classify
  }, [classify])

  useEffect(() => {
    const watches = watchesRef.current
    const commit = (next: ReadonlyMap<string, AgentActivity>): void => {
      entriesRef.current = next
      setEntries(next)
    }
    /**
     * 画面を読んで判定する。byDeadline は上限(出力が続いている最中)での判定か。上限の判定は CLI の描き直しの途中
     * (入力欄・スピナーを消した後、描く前)を読みうるため、結果が unknown なら採らずに前の活動を保ち、
     * 待ちのタイマー(上限が来たときは必ず張られている)を残して出力が途絶えた後の判定に任せる
     */
    const judge = (slotId: string, byDeadline: boolean): void => {
      const watch = watches.get(slotId)
      const tab = tabsRef.current.get(slotId)
      if (tab === undefined || tab.status !== 'running') {
        if (watch !== undefined) cancelTimer(watch)
        return
      }
      // 判定の時点のタブ(tabsRef の最新)の種類で判定の関数を引く。控えに種類は持たない(同じタブで別の種類を起動し直すときは
      // 必ず running から出て入り直すので、その区切りで判定の予約も記録も消える)
      const activity = classifyRef.current(tab.cliKind, tab.controller.readScreen())
      if (watch !== undefined) {
        if (byDeadline && activity === 'unknown') {
          // 上限の起点だけを消す(次の上限は次の通知から数える)。待ちのタイマーは残す
          watch.deadline = null
          return
        }
        // 待ちと上限のどちらで判定しても、もう一方も取り消して上限の起点を消す
        cancelTimer(watch)
      }
      if (entriesRef.current.get(slotId) === activity) return
      commit(new Map(entriesRef.current).set(slotId, activity))
    }
    const schedule = (slotId: string): void => {
      const watch = watches.get(slotId)
      if (watch === undefined || tabsRef.current.get(slotId)?.status !== 'running') return
      // 待ちは通知のたびに張り直す。上限は最初の未判定の通知で張り、判定するまで張り直さない
      if (watch.timer !== null) clearTimeout(watch.timer)
      watch.timer = setTimeout(() => judge(slotId, false), AGENT_ACTIVITY_SETTLE_MS)
      if (watch.deadline === null) {
        watch.deadline = setTimeout(() => judge(slotId, true), AGENT_ACTIVITY_MAX_WAIT_MS)
      }
    }

    tabsRef.current = new Map(tabs.map((tab) => [tab.slotId, tab]))
    const reset: string[] = []
    /** 購読とタイマーを(あれば)手放し、結果を捨てる */
    const forget = (slotId: string): void => {
      const watch = watches.get(slotId)
      if (watch !== undefined) {
        releaseWatch(watch)
        watches.delete(slotId)
      }
      reset.push(slotId)
    }

    // 消えたタブ: 購読とタイマーを手放し、結果を捨てる
    for (const slotId of [...watches.keys()]) {
      if (!tabsRef.current.has(slotId)) forget(slotId)
    }

    for (const tab of tabs) {
      // 画面の判定が無い種類(能力の表の screenActivity が false の種類): 購読・タイマーを持たず、記録も消す(種類が変わったタブ〈同じタブで起動し直した〉の区切り)。
      // 常に unknown を返す判定に差し替えず、購読そのものを張らない。記録の無いタブは各機能が unknown として扱う
      if (!agentCliCapabilities(tab.cliKind).screenActivity) {
        forget(tab.slotId)
        continue
      }
      const running = tab.status === 'running'
      // 初めて見たタブは「前回 running でなかった」として扱い、running なら下で判定を予約する
      const previous = watches.get(tab.slotId)?.wasRunning
      const watch = acquireWatch(watches, tab, () => schedule(tab.slotId))
      // セッションの区切り(running へ入る・出る)では unknown に戻し、待っている判定を取り消す
      if (previous !== undefined && previous !== running) {
        cancelTimer(watch)
        reset.push(tab.slotId)
      }
      watch.wasRunning = running
      // running に入ったら(初めて見たタブを含む)、通知を待たずに判定を予約する。起動の直後の書き込みの通知は
      // running になる前に届いて捨てられ、その後 CLI が何も描かずに入力欄で待つことがあるため
      if (running && previous !== true) schedule(tab.slotId)
    }

    if (reset.some((slotId) => entriesRef.current.has(slotId))) {
      const next = new Map(entriesRef.current)
      for (const slotId of reset) next.delete(slotId)
      commit(next)
    }
  }, [tabs])

  // アンマウントでタブごとの控えをすべて手放す(StrictMode の取り付け直しでは、次の取り付けで初めて見たタブとして張り直す)
  useEffect(() => {
    const watches = watchesRef.current
    return () => {
      for (const watch of watches.values()) releaseWatch(watch)
      watches.clear()
    }
  }, [])

  // タブの配列が作り直されても、内容が同じなら同じ Map を返す(使う側の描画を増やさない)
  const resolved = tabs.map((tab): [string, AgentActivity] => {
    // 種類が変わった描画で、effect が記録を消す前の古い活動を返さない
    const judged = tab.status === 'running' && agentCliCapabilities(tab.cliKind).screenActivity
    const activity = judged ? entries.get(tab.slotId) : undefined
    return [tab.slotId, activity ?? 'unknown']
  })
  const signature = resolved
    .map(([slotId, activity]) => `${slotId}\u0000${activity}`)
    .join('\u0001')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 内容は signature が表す
  return useMemo(() => new Map(resolved), [signature])
}
