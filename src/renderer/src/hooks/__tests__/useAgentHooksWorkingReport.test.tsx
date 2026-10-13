import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'

const mockReport = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
vi.mock('../../lib/agentTerminalApi', () => ({ reportAgentSessionWorking: mockReport }))

import { useAgentHooksWorkingReport } from '../useAgentHooksWorkingReport'
import type {
  AgentHooksWorkingReportTab,
  UseAgentHooksWorkingReportOptions
} from '../useAgentHooksWorkingReport'

const tab = (slotId: string, sessionId: string | null): AgentHooksWorkingReportTab => ({
  slotId,
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
