import { vi } from 'vitest'
import type { AgentSessionTabView, AgentSessionsState } from '../hooks/useAgentSessions'
import { formatAgentTabLabel } from '../lib/agentSessionMessages'
import { isAnyAgentSessionActive, isAnyAgentSessionStarting } from '../lib/agentSessionTabState'
import { makeFakeController } from './makeFakeAgentTerminal'

// useAgentSessions の戻り値の型付きの偽物(1 か所から作る。パターン 102)

/** タブ 1 つ分の表示の偽物。既定は「claude 1・未起動」 */
export function makeAgentSessionTabView(
  overrides: Partial<AgentSessionTabView> = {}
): AgentSessionTabView {
  return {
    slotId: 'slot-1',
    number: 1,
    label: formatAgentTabLabel(1),
    status: 'none',
    exit: null,
    error: null,
    claudeSessionId: null,
    isClosing: false,
    controller: makeFakeController(),
    ...overrides
  }
}

function selectedTabOf(
  tabs: AgentSessionTabView[],
  slotId: string | undefined
): AgentSessionTabView {
  const tab = slotId === undefined ? tabs[0] : tabs.find((t) => t.slotId === slotId)
  if (tab === undefined) throw new Error(`selected のタブが tabs にありません: ${slotId}`)
  return tab
}

/** 既定はタブ 1 つ(selected の上書きを反映する)。tabs を渡したら selected はその中のタブ(slotId で選ぶ。省略時は
 *  先頭)。本物と同じく selected は tabs の要素そのもので、tabs に無い slotId を選んだら投げる */
export function makeAgentSessionsState(
  overrides: Partial<Omit<AgentSessionsState, 'selected'>> & {
    selected?: Partial<AgentSessionTabView>
  } = {}
): AgentSessionsState {
  const { selected: selectedOverrides, tabs: tabsOverride, ...rest } = overrides
  const selected =
    tabsOverride === undefined
      ? makeAgentSessionTabView(selectedOverrides)
      : selectedTabOf(tabsOverride, selectedOverrides?.slotId)
  const tabs = tabsOverride ?? [selected]
  return {
    tabs,
    selected,
    startDisabledReason: null,
    addDisabledReason: null,
    start: vi.fn<AgentSessionsState['start']>(async () => undefined),
    stop: vi.fn<AgentSessionsState['stop']>(async () => true),
    interrupt: vi.fn<AgentSessionsState['interrupt']>(async () => ({ kind: 'sent' })),
    addTab: vi.fn<AgentSessionsState['addTab']>(async () => undefined),
    resumeInNewTab: vi.fn<AgentSessionsState['resumeInNewTab']>(() => null),
    closeTab: vi.fn<AgentSessionsState['closeTab']>(async () => true),
    selectTab: vi.fn<AgentSessionsState['selectTab']>(),
    stopAll: vi.fn<AgentSessionsState['stopAll']>(async () => true),
    isAnyActive: isAnyAgentSessionActive(tabs),
    isAnyStarting: isAnyAgentSessionStarting(tabs),
    lastExit: null,
    startConfirmedCount: 0,
    ...rest
  }
}
