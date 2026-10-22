import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentCliKind } from '@shared/agentCliKinds'

const mockReport = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
const mockReportEnded = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
vi.mock('../../lib/agentTerminalApi', () => ({
  reportAgentSessionWorking: mockReport,
  reportAgentSessionWorkingEnded: mockReportEnded
}))

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

describe('useAgentHooksWorkingReport(変更の区別をしない種類)', () => {
  it('copilot のタブは、作業中・作業の終わりを知らせない(main の hooks は cli-unsupported で使わない)', () => {
    const tabs = [tab('a', 'sid-a', 'copilot')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReport).not.toHaveBeenCalled()
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('claude と copilot のタブが並んでいても、claude のタブだけを今までどおり知らせる', () => {
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
