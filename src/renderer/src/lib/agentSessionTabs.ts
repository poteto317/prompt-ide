import type { AgentTerminalController } from './agentTerminalController'

// エージェントのセッションのタブの一覧と選択(設計書「タブの置き場」)。React の外で文書ごとに 1 つ持ち、StrictMode の
// 二重マウントで xterm を作り直さない。useSyncExternalStore で読む

export interface AgentSessionTab {
  slotId: string
  /** タブの番号(1〜上限)。作るときに使われていない最小の番号を振り、ほかのタブを閉じても振り直さない(閉じた番号は次に作る
   *  タブが使う)。文言は formatAgentTabLabel(number, kind) */
  number: number
  controller: AgentTerminalController
}

export interface AgentSessionTabsSnapshot {
  tabs: readonly AgentSessionTab[]
  selectedSlotId: string
}

export interface AgentSessionTabs {
  /** useSyncExternalStore 用。変化が無ければ同じオブジェクトを返す */
  getSnapshot(): AgentSessionTabsSnapshot
  subscribe(listener: () => void): () => void
  /** 上限未満ならタブを作って選択し、作ったタブを返す。上限なら null */
  add(): AgentSessionTab | null
  /** main の一覧に合わせるとき用。同じ slotId のタブがあればそれを、無ければ上限の範囲で作って返す(選択は変えない) */
  ensure(slotId: string): AgentSessionTab | null
  /** controller を dispose してタブを消し、選択中なら左隣(無ければ右隣)を選ぶ。最後の 1 つは消さず false を返す */
  remove(slotId: string): boolean
  select(slotId: string): void
}

export interface AgentSessionTabsDeps {
  createController: () => AgentTerminalController
  createSlotId: () => string
  max: number
}

export function createAgentSessionTabs({
  createController,
  createSlotId,
  max
}: AgentSessionTabsDeps): AgentSessionTabs {
  const listeners = new Set<() => void>()
  const makeTab = (slotId: string, number: number): AgentSessionTab => ({
    slotId,
    number,
    controller: createController()
  })
  const first = makeTab(createSlotId(), 1)
  let snapshot: AgentSessionTabsSnapshot = { tabs: [first], selectedSlotId: first.slotId }

  const update = (next: AgentSessionTabsSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const smallestFreeNumber = (): number => {
    const used = new Set(snapshot.tabs.map((tab) => tab.number))
    let number = 1
    while (used.has(number)) number++
    return number
  }
  const createTabIfRoom = (slotId: string): AgentSessionTab | null => {
    if (snapshot.tabs.length >= max) return null
    const tab = makeTab(slotId, smallestFreeNumber())
    return tab
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    add() {
      const tab = createTabIfRoom(createSlotId())
      if (tab === null) return null
      update({ tabs: [...snapshot.tabs, tab], selectedSlotId: tab.slotId })
      return tab
    },
    ensure(slotId) {
      const existing = snapshot.tabs.find((tab) => tab.slotId === slotId)
      if (existing !== undefined) return existing
      const tab = createTabIfRoom(slotId)
      if (tab === null) return null
      update({ ...snapshot, tabs: [...snapshot.tabs, tab] })
      return tab
    },
    remove(slotId) {
      const index = snapshot.tabs.findIndex((tab) => tab.slotId === slotId)
      if (index === -1 || snapshot.tabs.length <= 1) return false
      const removed = snapshot.tabs[index]
      const tabs = snapshot.tabs.filter((tab) => tab.slotId !== slotId)
      const selectedSlotId =
        snapshot.selectedSlotId === slotId
          ? (tabs[index - 1] ?? tabs[index]).slotId
          : snapshot.selectedSlotId
      update({ tabs, selectedSlotId })
      removed.controller.dispose()
      return true
    },
    select(slotId) {
      if (slotId === snapshot.selectedSlotId) return
      if (!snapshot.tabs.some((tab) => tab.slotId === slotId)) return
      update({ ...snapshot, selectedSlotId: slotId })
    }
  }
}
