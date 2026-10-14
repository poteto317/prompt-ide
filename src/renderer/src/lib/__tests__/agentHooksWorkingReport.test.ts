import { describe, it, expect } from 'vitest'
import { nextWorkingReport } from '../agentHooksWorkingReport'
import type { AgentActivity } from '../agentActivity'

describe('nextWorkingReport', () => {
  it('新しいタブが working なら作業中を送り、idle を待つ', () => {
    expect(nextWorkingReport(undefined, 'working')).toEqual({
      state: { activity: 'working', awaitingIdle: true },
      report: 'working'
    })
  })

  it('working が続いている間は送らない', () => {
    expect(nextWorkingReport({ activity: 'working', awaitingIdle: true }, 'working')).toEqual({
      state: { activity: 'working', awaitingIdle: true },
      report: null
    })
  })

  it('working 以外から working に戻ったら、idle を待っていても作業中を送る', () => {
    expect(nextWorkingReport({ activity: 'permission', awaitingIdle: true }, 'working')).toEqual({
      state: { activity: 'working', awaitingIdle: true },
      report: 'working'
    })
  })

  it('working を見た後に idle になったら作業の終わりを送り、待ちを下ろす', () => {
    expect(nextWorkingReport({ activity: 'working', awaitingIdle: true }, 'idle')).toEqual({
      state: { activity: 'idle', awaitingIdle: false },
      report: 'ended'
    })
  })

  it('working を見ていなければ idle でも送らない(新しいタブ・終わりを送った後)', () => {
    expect(nextWorkingReport(undefined, 'idle')).toEqual({
      state: { activity: 'idle', awaitingIdle: false },
      report: null
    })
    expect(nextWorkingReport({ activity: 'idle', awaitingIdle: false }, 'idle')).toEqual({
      state: { activity: 'idle', awaitingIdle: false },
      report: null
    })
  })

  it.each<AgentActivity>(['permission', 'confirm', 'unknown'])(
    '%s では作業の終わりにせず、working を見た控えを残す',
    (activity) => {
      expect(nextWorkingReport({ activity: 'working', awaitingIdle: true }, activity)).toEqual({
        state: { activity, awaitingIdle: true },
        report: null
      })
    }
  )

  it('working を見た後に permission を挟んで idle になったら作業の終わりを送る', () => {
    const { state } = nextWorkingReport({ activity: 'working', awaitingIdle: true }, 'permission')
    expect(nextWorkingReport(state, 'idle').report).toBe('ended')
  })
})
