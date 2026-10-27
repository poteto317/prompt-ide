import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentCliKind } from '@shared/agentCliKinds'

const mockReport = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
const mockReportEnded = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
vi.mock('../../lib/agentTerminalApi', () => ({
  reportAgentSessionWorking: mockReport,
  reportAgentSessionWorkingEnded: mockReportEnded
}))

import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 区別をしない種類のタブを知らせない絞り込みを確かめるため、能力の表の changeAttribution を種類ごとに偽にできるようにする
// (段階 3b で copilot も区別に対応し、今の表には該当する種類が無い)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

afterEach(() => {
  capabilityOverrides.changeAttributionUnsupportedKinds.clear()
})

import { useAgentHooksWorkingReport } from '../useAgentHooksWorkingReport'
import type {
  AgentHooksWorkingReportTab,
  UseAgentHooksWorkingReportOptions
} from '../useAgentHooksWorkingReport'

const tab = (
  slotId: string,
  sessionId: string | null,
  cliKind: AgentCliKind = 'claude'
): AgentHooksWorkingReportTab => ({
  slotId,
  cliKind,
  controller: { getSessionId: () => sessionId }
})
const activitiesOf = (
  entries: Array<[string, AgentActivity]>
): ReadonlyMap<string, AgentActivity> => new Map(entries)

const render = (
  initialProps: UseAgentHooksWorkingReportOptions,
  wrapper?: (props: { children: ReactNode }) => ReactNode
): RenderHookResult<void, UseAgentHooksWorkingReportOptions> =>
  renderHook<void, UseAgentHooksWorkingReportOptions>(
    (props) => useAgentHooksWorkingReport(props),
    {
      initialProps,
      wrapper
    }
  )

beforeEach(() => {
  mockReport.mockClear()
  mockReportEnded.mockClear()
})

describe('useAgentHooksWorkingReport', () => {
  it('working 以外から working に変わったときに、そのタブの sessionId を送る', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'unknown']]) })
    expect(mockReport).not.toHaveBeenCalled()
    rerender({ tabs, activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('同じ working が続く間(Map が作り直されても)は送らない', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).toHaveBeenCalledOnce()
  })

  it('working から離れて戻れば、もう一度送る', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).toHaveBeenCalledTimes(2)
  })

  it('初めて見たタブが working なら送る(StrictMode の二重の effect でも 1 回)', () => {
    render(
      { tabs: [tab('a', 'sid-a')], activities: activitiesOf([['a', 'working']]) },
      ({ children }) => <StrictMode>{children}</StrictMode>
    )
    expect(mockReport).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('controller.getSessionId() が null のタブは送らない', () => {
    render({ tabs: [tab('a', null)], activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('タブごとに独立して見る', () => {
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'idle']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a']])
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'working']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a'], ['sid-b']])
  })

  it('消えたタブの控えは捨て、同じ slotId で戻ってきて working なら送る', () => {
    const { rerender } = render({
      tabs: [tab('a', 'sid-a')],
      activities: activitiesOf([['a', 'working']])
    })
    rerender({ tabs: [], activities: activitiesOf([]) })
    rerender({ tabs: [tab('a', 'sid-a2')], activities: activitiesOf([['a', 'working']]) })
    expect(mockReport.mock.calls).toEqual([['sid-a'], ['sid-a2']])
  })
})

describe('useAgentHooksWorkingReport(作業の終わり)', () => {
  it('working → idle で reportAgentSessionWorkingEnded を 1 回送る', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('working → permission・confirm・unknown では送らず、続く idle で送る(利用者の操作待ち・判定できない画面はターンの終わりではない)', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'permission']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'confirm']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'unknown']]) })
    expect(mockReportEnded).not.toHaveBeenCalled()
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('working を見ていない idle(起動の直後)では送らない', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'unknown']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('idle が続いても 2 回送らない(Map が作り直されても)', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).toHaveBeenCalledOnce()
  })

  it('controller.getSessionId() が null のタブは送らない', () => {
    const tabs = [tab('a', null)]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('タブごとに独立して見る', () => {
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'idle']
      ])
    })
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'idle'],
        ['b', 'idle']
      ])
    })
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })
})

describe('useAgentHooksWorkingReport(変更の区別をする種類・しない種類)', () => {
  it('copilot のタブも、作業中・作業の終わりを知らせる(段階 3b で copilot も区別に対応した)', () => {
    const tabs = [tab('a', 'sid-a', 'copilot')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReport).toHaveBeenCalledExactlyOnceWith('sid-a')
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('能力の表で区別をしない種類(差し替えた copilot)のタブは、作業中・作業の終わりを知らせない', () => {
    capabilityOverrides.changeAttributionUnsupportedKinds.add('copilot')
    const tabs = [tab('a', 'sid-a', 'copilot')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReport).not.toHaveBeenCalled()
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('claude と区別をしない種類のタブが並んでいても、claude のタブだけを今までどおり知らせる', () => {
    capabilityOverrides.changeAttributionUnsupportedKinds.add('copilot')
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b', 'copilot')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'working']
      ])
    })
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'idle'],
        ['b', 'idle']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a']])
    expect(mockReportEnded.mock.calls).toEqual([['sid-a']])
  })
})
