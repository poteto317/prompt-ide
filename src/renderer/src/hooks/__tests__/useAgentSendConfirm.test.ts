import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import { useAgentSendConfirm } from '../useAgentSendConfirm'
import type { AgentSendConfirmState, UseAgentSendConfirmOptions } from '../useAgentSendConfirm'
import type { AgentSendOutcome } from '../../lib/agentPromptSend'

const tab1 = { slotId: 'slot-1', label: 'claude 1', controller: makeFakeController() }
const tab2 = { slotId: 'slot-2', label: 'claude 2', controller: makeFakeController() }

const SENT: AgentSendOutcome = { kind: 'sent', clearedDraft: false }

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  consoleErrorSpy = null
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

const renderConfirm = (
  overrides: Partial<UseAgentSendConfirmOptions> = {}
): RenderHookResult<AgentSendConfirmState, UseAgentSendConfirmOptions> & {
  send: Mock<UseAgentSendConfirmOptions['send']>
  onSendSettled: Mock<UseAgentSendConfirmOptions['onSendSettled']>
} => {
  const send = vi.fn<UseAgentSendConfirmOptions['send']>(async () => SENT)
  const onSendSettled = vi.fn<UseAgentSendConfirmOptions['onSendSettled']>()
  const hook = renderHook((props: UseAgentSendConfirmOptions) => useAgentSendConfirm(props), {
    initialProps: { selected: tab1, send, onSendSettled, ...overrides }
  })
  return { ...hook, send, onSendSettled }
}

describe('useAgentSendConfirm', () => {
  it('request で開き、開いた時点の選択中のタブ・名前・プロンプトの id を控える。まだ送らない', () => {
    const { result, send } = renderConfirm()
    expect(result.current.pending).toBeNull()
    act(() => result.current.request('hello', 'p1'))
    expect(result.current.pending).toEqual({
      text: 'hello',
      target: { slotId: 'slot-1', controller: tab1.controller },
      label: 'claude 1',
      promptId: 'p1'
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('開いている間の request は無視する(二重に開かない。同じ描画の中で 2 回呼んでも)', () => {
    const { result } = renderConfirm()
    act(() => {
      result.current.request('first', 'p1')
      result.current.request('second', 'p2')
    })
    act(() => result.current.request('third', null))
    expect(result.current.pending?.text).toBe('first')
    expect(result.current.pending?.promptId).toBe('p1')
  })

  it('confirm で閉じ、控えた送り先へ送り、送信が終わってから onSendSettled に送り先・プロンプト・結果を渡す(開いた後にタブを切り替えても送り先は変わらない)', async () => {
    let resolveSend: (outcome: AgentSendOutcome | undefined) => void = () => undefined
    const send = vi.fn<UseAgentSendConfirmOptions['send']>(
      () => new Promise((resolve) => (resolveSend = resolve))
    )
    const { result, rerender, onSendSettled } = renderConfirm({ send })
    act(() => result.current.request('hello', 'p1'))
    rerender({ selected: tab2, send, onSendSettled })
    act(() => result.current.confirm())
    // 閉じるのは押した時点
    expect(result.current.pending).toBeNull()
    expect(send).toHaveBeenCalledExactlyOnceWith('hello', {
      slotId: 'slot-1',
      controller: tab1.controller
    })
    // 送信が終わるまではフォーカスを移さない(送信の前の準備の間のキー入力がターミナルへ届かないように)
    await act(async () => {
      await Promise.resolve()
    })
    expect(onSendSettled).not.toHaveBeenCalled()
    const failed: AgentSendOutcome = { kind: 'failed', reason: 'input-not-found' }
    await act(async () => {
      resolveSend(failed)
    })
    expect(onSendSettled).toHaveBeenCalledExactlyOnceWith({
      slotId: 'slot-1',
      promptId: 'p1',
      outcome: failed
    })
  })

  it('cancel で閉じ、送らない', () => {
    const { result, send, onSendSettled } = renderConfirm()
    act(() => result.current.request('hello', 'p1'))
    act(() => result.current.cancel())
    expect(result.current.pending).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(onSendSettled).not.toHaveBeenCalled()
  })

  it('閉じているときの confirm は何もしない', () => {
    const { result, send, onSendSettled } = renderConfirm()
    act(() => result.current.confirm())
    expect(send).not.toHaveBeenCalled()
    expect(onSendSettled).not.toHaveBeenCalled()
  })

  it('閉じた後は、また開ける', () => {
    const { result } = renderConfirm()
    act(() => result.current.request('first', 'p1'))
    act(() => result.current.cancel())
    act(() => result.current.request('second', 'p2'))
    expect(result.current.pending?.text).toBe('second')
  })

  it.each([
    [
      '拒否し',
      vi.fn<UseAgentSendConfirmOptions['send']>(async () => {
        throw new Error('broken')
      })
    ],
    [
      '同期で投げ',
      vi.fn<UseAgentSendConfirmOptions['send']>(() => {
        throw new Error('broken')
      })
    ]
  ])(
    'send が%sても閉じて onSendSettled を結果なし(undefined)で呼び、理由を記録して呼び出し元へ投げない(L-053)',
    async (_label, send) => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { result, onSendSettled } = renderConfirm({ send })
      act(() => result.current.request('hello', null))
      await act(async () => {
        result.current.confirm()
        await Promise.resolve()
      })
      expect(result.current.pending).toBeNull()
      expect(onSendSettled).toHaveBeenCalledExactlyOnceWith({
        slotId: 'slot-1',
        promptId: null,
        outcome: undefined
      })
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useAgentSendConfirm] send failed:',
        expect.any(Error)
      )
    }
  )

  // sendToAgent(usePromptRunner の useCallback の依存)が描画ごとに変わらないように
  it('request は描画をまたいで同じ参照(選択中のタブが変わっても)', () => {
    const { result, rerender, send, onSendSettled } = renderConfirm()
    const first = result.current.request
    rerender({ selected: tab2, send, onSendSettled })
    expect(result.current.request).toBe(first)
  })

  it('選択中のタブを切り替えた後に開くと、その時点のタブを控える', () => {
    const { result, rerender, send, onSendSettled } = renderConfirm()
    rerender({ selected: tab2, send, onSendSettled })
    act(() => result.current.request('hello', 'p1'))
    expect(result.current.pending?.target.slotId).toBe('slot-2')
    expect(result.current.pending?.label).toBe('claude 2')
  })
})
