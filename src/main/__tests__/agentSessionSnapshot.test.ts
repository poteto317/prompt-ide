import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { attachSessionInfo } from '../agentSessionSnapshot'
import type { AgentSessionInfo } from '../agentSessionStarter'

const ID_A = '11111111-1111-4111-8111-111111111111'

describe('attachSessionInfo', () => {
  let warnSpy: MockInstance<typeof console.warn> | null = null

  afterEach(() => {
    warnSpy?.mockRestore()
    warnSpy = null
  })

  it('各セッションに種類と会話の ID(再開に対応しない種類は null)を足し、順序を保つ', () => {
    const infos = new Map<string, AgentSessionInfo>([
      ['s1', { cliKind: 'claude', cliSessionId: ID_A }],
      ['s2', { cliKind: 'copilot', cliSessionId: null }]
    ])
    expect(
      attachSessionInfo(
        [
          { slotId: 'tab-1', sessionId: 's1' },
          { slotId: 'tab-2', sessionId: 's2' }
        ],
        (sessionId) => infos.get(sessionId)
      )
    ).toEqual([
      { slotId: 'tab-1', sessionId: 's1', cliKind: 'claude', cliSessionId: ID_A },
      { slotId: 'tab-2', sessionId: 's2', cliKind: 'copilot', cliSessionId: null }
    ])
  })

  it('情報が引けないセッションだけを外して警告を出し、ほかは返す', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      attachSessionInfo(
        [
          { slotId: 'tab-1', sessionId: 'gone' },
          { slotId: 'tab-2', sessionId: 's2' }
        ],
        (sessionId) => (sessionId === 's2' ? { cliKind: 'copilot', cliSessionId: null } : undefined)
      )
    ).toEqual([{ slotId: 'tab-2', sessionId: 's2', cliKind: 'copilot', cliSessionId: null }])
    expect(warnSpy).toHaveBeenCalledWith(
      '[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:',
      'gone'
    )
  })

  it('空の一覧は空', () => {
    expect(attachSessionInfo([], () => ({ cliKind: 'claude', cliSessionId: ID_A }))).toEqual([])
  })
})
