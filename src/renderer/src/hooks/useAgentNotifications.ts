import { useEffect, useRef, useState } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentNotificationTab } from '../lib/agentNotificationEvents'
import {
  advanceAgentNotifications,
  countAgentTabsWaitingForUser,
  findRemovedAgentNotificationTabs,
  formatAgentNotificationAnnouncement
} from '../lib/agentNotificationEvents'
import * as agentNotificationApi from '../lib/agentNotificationApi'
import { useLatestRef } from './useLatestRef'

// エージェントの完了・許可待ちの知らせ(設計書「活動の変化の監視」)。タブごとの最後の確かな活動を覚え、決まった出来事の
// 読み上げの文言を返し、設定がオンなら OS の通知を main へ頼む(フォーカスの有無は main が判断する。オフなら出来事のタブの前の通知を閉じるよう頼む)。待っているタブの数を
// バッジとして送り、閉じたタブ・待っている状態が終わったタブの通知を閉じるよう頼み、通知を押した知らせを受けてタブへ移る。出来事の決定・読み上げの文言・待っている数の集計は agentNotificationEvents に、
// 活動の判定とそのデバウンスは useAgentActivity に任せる(L-399)。エージェント CLI 方式でないとき(ターミナルのパネルが出ない)は
// 知らせず、バッジは 0 にし、方式が変わった回に一覧のタブすべての通知を閉じるよう頼み、押した知らせではタブへ移らない

export type { AgentNotificationTab }

export interface UseAgentNotificationsOptions {
  tabs: readonly AgentNotificationTab[]
  activities: ReadonlyMap<string, AgentActivity>
  /** 通知の設定。読み込み中は null(通知もバッジも出さない。読み上げはする) */
  enabled: boolean | null
  /** エージェント CLI 方式か。false(従来の方式・方式の読み込み中)なら読み上げ・通知・バッジを出さず、押してもタブへ移らない */
  isAgentMode: boolean
  /** 通知を押したときにタブへ移る(useAgentWorkspace が useAgentTabActivation の関数を、送信前の確認を閉じてから呼ぶ関数で包んで渡す) */
  activateTab: (slotId: string) => void
}

/** IPC の失敗(拒否・同期の例外)を握りつぶして記録する。通知が出せなくても活動の表示・読み上げは止めない(L-053) */
function callQuietly(label: string, call: () => Promise<void>): void {
  try {
    call().catch((err: unknown) => console.warn(`[useAgentNotifications] ${label} failed:`, err))
  } catch (err) {
    console.warn(`[useAgentNotifications] ${label} failed:`, err)
  }
}

/** 読み上げの文言(常設の aria-live の領域に渡す)。まだ出来事が無ければ '' */
export function useAgentNotifications({
  tabs,
  activities,
  enabled,
  isAgentMode,
  activateTab
}: UseAgentNotificationsOptions): string {
  const [announcement, setAnnouncement] = useState('')
  // タブごとの最後の確かな活動(unknown を除いた直近の活動)
  const settledRef = useRef<ReadonlyMap<string, AgentActivity>>(new Map())
  // 前回送ったバッジの数。未送信は null(マウントの直後は 0 でも送り、リロードの前のバッジを上書きする)
  const lastBadgeRef = useRef<number | null>(null)
  // 前回見たタブの一覧(閉じたタブを見分ける。マウントの直後は空なので何も閉じない)
  const previousTabsRef = useRef<readonly AgentNotificationTab[]>([])
  // 前回の描画の方式(エージェント CLI 方式でなくなった回を見分ける。マウントの時点の方式から始め、マウントでは何も閉じない)
  const previousAgentModeRef = useRef(isAgentMode)
  const enabledRef = useLatestRef(enabled)
  const isAgentModeRef = useLatestRef(isAgentMode)
  const tabsRef = useLatestRef(tabs)
  const activateTabRef = useLatestRef(activateTab)

  // 出来事の決定。活動の Map は内容が同じなら同じ参照のまま(running でないタブは unknown)なので、unknown のまま終了・
  // 再起動したタブは活動の Map だけでは変化が見えない。タブの一覧(status・isClosing)の変化でも必ず見直す
  useEffect(() => {
    // set-state-in-effect の対策で、setState は effect 内のローカル関数から呼ぶ(useAgentActivity の commit と同じ)
    const announce = (message: string): void => {
      setAnnouncement(message)
    }
    const { settled, events, finishedWaiting } = advanceAgentNotifications(
      settledRef.current,
      tabs,
      activities
    )
    settledRef.current = settled
    // 許可・選択に答えたタブの「許可待ち」「確認待ち」の通知を閉じるよう頼む。設定がオフでも頼む(オンのときに出した通知が
    // 残っているかもしれない)。作業の完了の通知は閉じない(待っている状態が終わったタブに done は含まれない)
    const agentMode = isAgentModeRef.current
    const notifying = agentMode && enabledRef.current === true
    // 設定がオフ・読み込み中・従来の方式のときは通知を出さないが、出来事のタブの前の通知(オンのときに出したもの)は古いので閉じるよう頼む
    // (閉じたタブ・待っている状態が終わったタブと同じ考え方。オンのときは main の show が前の通知を入れ替える)
    const dismissing = new Set(finishedWaiting)
    if (!notifying) for (const { slotId } of events) dismissing.add(slotId)
    for (const slotId of dismissing) {
      callQuietly('dismissAgentNotification', () =>
        agentNotificationApi.dismissAgentNotification({ slotId })
      )
    }
    // エージェント CLI 方式でないときは読み上げもしない(最後の確かな活動は上で更新しておき、戻ったときに古い活動と比べない)
    if (events.length === 0 || !agentMode) return
    announce(formatAgentNotificationAnnouncement(events))
    if (!notifying) return
    for (const event of events) {
      callQuietly('showAgentNotification', () => agentNotificationApi.showAgentNotification(event))
    }
  }, [tabs, activities, enabledRef, isAgentModeRef])

  // エージェント CLI 方式でなくなった回に 1 度、一覧のタブすべての通知を閉じるよう頼む。従来の方式ではパネルが出ず、
  // 作業の完了の通知(終了では閉じない)を押しても何も起きないため。StrictMode の取り付け直しでは前回の方式と同じなので頼まない
  useEffect(() => {
    const wasAgentMode = previousAgentModeRef.current
    previousAgentModeRef.current = isAgentMode
    if (isAgentMode || !wasAgentMode) return
    for (const { slotId } of tabsRef.current) {
      callQuietly('dismissAgentNotification', () =>
        agentNotificationApi.dismissAgentNotification({ slotId })
      )
    }
  }, [isAgentMode, tabsRef])

  // 閉じたタブ(一覧から消えたタブ)の通知を閉じるよう頼む。設定がオフでも頼む(オンのときに出した通知が残っているかもしれない)。
  // StrictMode の取り付け直しでは同じ一覧で走り直すだけなので、何も頼まない
  useEffect(() => {
    const removed = findRemovedAgentNotificationTabs(previousTabsRef.current, tabs)
    previousTabsRef.current = tabs
    for (const slotId of removed) {
      callQuietly('dismissAgentNotification', () =>
        agentNotificationApi.dismissAgentNotification({ slotId })
      )
    }
  }, [tabs])

  // バッジ。上の effect の後に走り、更新された最後の確かな活動で数える
  useEffect(() => {
    const next =
      isAgentMode && enabled === true ? countAgentTabsWaitingForUser(tabs, settledRef.current) : 0
    if (lastBadgeRef.current === next) return
    lastBadgeRef.current = next
    callQuietly('setAgentNotificationBadge', () =>
      agentNotificationApi.setAgentNotificationBadge(next)
    )
  }, [tabs, activities, enabled, isAgentMode])

  // アンマウントでバッジを消す(StrictMode の取り付け直しでは、次の取り付けで未送信として送り直す)
  useEffect(
    () => () => {
      lastBadgeRef.current = null
      callQuietly('setAgentNotificationBadge', () =>
        agentNotificationApi.setAgentNotificationBadge(0)
      )
    },
    []
  )

  // 通知を押した知らせ。今のタブの一覧にあればそのタブへ移り、無ければ(閉じたタブ)・エージェント CLI 方式でなければ何もしない
  useEffect(
    () =>
      agentNotificationApi.onAgentNotificationActivated(({ slotId }) => {
        if (!isAgentModeRef.current) return
        if (!tabsRef.current.some((tab) => tab.slotId === slotId)) return
        activateTabRef.current(slotId)
      }),
    [tabsRef, activateTabRef, isAgentModeRef]
  )

  return announcement
}
