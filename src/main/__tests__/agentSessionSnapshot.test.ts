import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { attachClaudeSessionIds } from '../agentSessionSnapshot'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-9222-222222222222'

describe('attachClaudeSessionIds', () => {
  let warnSpy: MockInstance<typeof console.warn> | null = null

  afterEach(() => {
    warnSpy?.mockRestore()
    warnSpy = null
  })

  it('各セッションに claude の会話の ID を足し、順序を保つ', () => {
    const ids = new Map([
      ['s1', ID_A],
      ['s2', ID_B]
    ])
    expect(
      attachClaudeSessionIds(
        [
          { slotId: 'tab-1', sessionId: 's1' },
          { slotId: 'tab-2', sessionId: 's2' }
        ],
        (sessionId) => ids.get(sessionId)
      )
    ).toEqual([
      { slotId: 'tab-1', sessionId: 's1', claudeSessionId: ID_A },
      { slotId: 'tab-2', sessionId: 's2', claudeSessionId: ID_B }
    ])
  })

  it('ID が引けないセッションだけを外して警告を出し、ほかは返す', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      attachClaudeSessionIds(
        [
          { slotId: 'tab-1', sessionId: 'gone' },
          { slotId: 'tab-2', sessionId: 's2' }
        ],
        (sessionId) => (sessionId === 's2' ? ID_B : undefined)
      )
    ).toEqual([{ slotId: 'tab-2', sessionId: 's2', claudeSessionId: ID_B }])
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), 'gone')
  })

  it('空の一覧は空', () => {
    expect(attachClaudeSessionIds([], () => ID_A)).toEqual([])
  })
})
