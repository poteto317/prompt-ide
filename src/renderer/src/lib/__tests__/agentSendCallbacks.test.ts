import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { notifyAgentSent } from '../agentSendCallbacks'

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('notifyAgentSent', () => {
  it('送れた(sent)ときだけ onSent を呼ぶ', () => {
    const onSent = vi.fn()
    notifyAgentSent(
      { kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' },
      onSent,
      '全文'
    )
    expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'claude', '全文')
  })

  it('送れたときは、結果の sentTo(控えた送り先)を onSent に渡す', () => {
    const onSent = vi.fn()
    const sentTo = {
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      cliKind: 'claude',
      tabLabel: 'claude 1',
      folderPath: '/work'
    }
    notifyAgentSent(
      { kind: 'sent', clearedDraft: false, sentTo, cliKind: 'claude' },
      onSent,
      '全文'
    )
    expect(onSent).toHaveBeenCalledExactlyOnceWith(sentTo, 'claude', '全文')
  })

  it('失敗・結果なし(undefined)では呼ばない', () => {
    const onSent = vi.fn()
    notifyAgentSent({ kind: 'failed', reason: 'input-not-found' }, onSent, '全文')
    notifyAgentSent(undefined, onSent, '全文')
    expect(onSent).not.toHaveBeenCalled()
  })

  it('onSent が無ければ何もしない', () => {
    expect(() =>
      notifyAgentSent(
        { kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' },
        undefined,
        '全文'
      )
    ).not.toThrow()
  })

  it('onSent が投げても呼び出し元へ投げず、理由を記録する(L-053)', () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onSent = vi.fn(() => {
      throw new Error('broken')
    })
    expect(() =>
      notifyAgentSent(
        { kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' },
        onSent,
        '全文'
      )
    ).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[notifyAgentSent] onSent failed:',
      expect.any(Error)
    )
  })

  it('送り先の種類を onSent に渡す(copilot の送り先も、控えた送り先を渡す。段階 3a)', () => {
    const onSent = vi.fn()
    const sentTo = {
      claudeSessionId: '33333333-3333-4333-8333-333333333333',
      cliKind: 'copilot',
      tabLabel: 'copilot 1',
      folderPath: '/work'
    }
    notifyAgentSent(
      { kind: 'sent', clearedDraft: false, sentTo, cliKind: 'copilot' },
      onSent,
      '全文'
    )
    expect(onSent).toHaveBeenCalledExactlyOnceWith(sentTo, 'copilot', '全文')
  })

  it('送った全文を第 3 引数で渡す', () => {
    const onSent = vi.fn()
    notifyAgentSent(
      { kind: 'sent', sentTo: null, cliKind: 'claude', clearedDraft: false },
      onSent,
      '/review 123'
    )
    expect(onSent).toHaveBeenCalledWith(null, 'claude', '/review 123')
  })
})
