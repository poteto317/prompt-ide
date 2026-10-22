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
    notifyAgentSent({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' }, onSent)
    expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'claude')
  })

  it('送れたときは、結果の sentTo(控えた送り先)を onSent に渡す', () => {
    const onSent = vi.fn()
    const sentTo = {
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      tabLabel: 'claude 1',
      folderPath: '/work'
    }
    notifyAgentSent({ kind: 'sent', clearedDraft: false, sentTo, cliKind: 'claude' }, onSent)
    expect(onSent).toHaveBeenCalledExactlyOnceWith(sentTo, 'claude')
  })

  it('失敗・結果なし(undefined)では呼ばない', () => {
    const onSent = vi.fn()
    notifyAgentSent({ kind: 'failed', reason: 'input-not-found' }, onSent)
    notifyAgentSent(undefined, onSent)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('onSent が無ければ何もしない', () => {
    expect(() =>
      notifyAgentSent(
        { kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' },
        undefined
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
        onSent
      )
    ).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[notifyAgentSent] onSent failed:',
      expect.any(Error)
    )
  })

  it('送り先の種類を onSent に渡す(copilot の送り先は sentTo が null で、種類で記録を省くかを決める)', () => {
    const onSent = vi.fn()
    notifyAgentSent({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'copilot' }, onSent)
    expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'copilot')
  })
})
