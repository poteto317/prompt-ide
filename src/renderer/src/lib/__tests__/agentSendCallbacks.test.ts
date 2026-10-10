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
    notifyAgentSent({ kind: 'sent', clearedDraft: false }, onSent)
    expect(onSent).toHaveBeenCalledOnce()
  })

  it('失敗・結果なし(undefined)では呼ばない', () => {
    const onSent = vi.fn()
    notifyAgentSent({ kind: 'failed', reason: 'input-not-found' }, onSent)
    notifyAgentSent(undefined, onSent)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('onSent が無ければ何もしない', () => {
    expect(() => notifyAgentSent({ kind: 'sent', clearedDraft: false }, undefined)).not.toThrow()
  })

  it('onSent が投げても呼び出し元へ投げず、理由を記録する(L-053)', () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onSent = vi.fn(() => {
      throw new Error('broken')
    })
    expect(() => notifyAgentSent({ kind: 'sent', clearedDraft: false }, onSent)).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[notifyAgentSent] onSent failed:',
      expect.any(Error)
    )
  })
})
