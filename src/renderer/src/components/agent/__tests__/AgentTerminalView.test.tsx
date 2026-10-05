import { render, screen, fireEvent } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import AgentTerminalView, { AGENT_TERMINAL_RESIZE_DEBOUNCE_MS } from '../AgentTerminalView'
import { makeFakeController } from '../../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../../__tests__/makeFakeAgentTerminal'
import { isInsideAgentTerminal } from '../../../lib/agentTerminalKeys'

let controller: FakeController

beforeEach(() => {
  controller = makeFakeController()
  window.api.setAgentTerminalFocused = vi.fn()
})

describe('AgentTerminalView', () => {
  it('ターミナルの目印と名前を付け、controller に取り付ける', () => {
    render(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
    const area = screen.getByRole('group', { name: 'エージェントのターミナル' })
    expect(isInsideAgentTerminal(area)).toBe(true)
    expect(controller.attach).toHaveBeenCalledWith(area)
  })

  it('StrictMode の二重マウントでも、最後は取り付けた状態になる', () => {
    render(
      <StrictMode>
        <AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />
      </StrictMode>
    )
    expect(controller.attach.mock.calls.length - controller.detach.mock.calls.length).toBe(1)
  })

  it('表示されているときに fit し、隠れているときは fit しない', () => {
    const { rerender } = render(
      <AgentTerminalView controller={controller} isVisible={false} onFocusOut={vi.fn()} />
    )
    expect(controller.fit).not.toHaveBeenCalled()
    rerender(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
    expect(controller.fit).toHaveBeenCalled()
  })

  it('アンマウントで取り外し、F6 の抜け先を外す', () => {
    const { unmount } = render(
      <AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />
    )
    unmount()
    expect(controller.detach).toHaveBeenCalled()
    expect(controller.setFocusOutHandler).toHaveBeenLastCalledWith(null)
  })

  it('フォーカスの出入りを main へ知らせる(領域の中の移動では外れたとみなさない)', () => {
    render(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
    const area = screen.getByRole('group', { name: 'エージェントのターミナル' })
    const a = document.createElement('textarea')
    const b = document.createElement('textarea')
    area.append(a, b)
    fireEvent.focus(a)
    fireEvent.blur(a, { relatedTarget: b })
    fireEvent.blur(b, { relatedTarget: document.body })
    expect(vi.mocked(window.api.setAgentTerminalFocused).mock.calls).toEqual([[true], [false]])
  })

  describe('大きさの変化(ResizeObserver)', () => {
    let resizeCallback: (() => void) | null
    const disconnect = vi.fn()

    beforeEach(() => {
      resizeCallback = null
      disconnect.mockReset()
      vi.useFakeTimers()
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resizeCallback = callback
          }
          observe = vi.fn()
          disconnect(): void {
            disconnect()
          }
        }
      )
    })

    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('続けて変わっても、落ち着いてから 1 回だけ fit する(デバウンス)', () => {
      render(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
      expect(controller.fit).toHaveBeenCalledTimes(1)
      resizeCallback?.()
      resizeCallback?.()
      resizeCallback?.()
      vi.advanceTimersByTime(AGENT_TERMINAL_RESIZE_DEBOUNCE_MS - 1)
      expect(controller.fit).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)
      expect(controller.fit).toHaveBeenCalledTimes(2)
    })

    it('隠れたら購読をやめ、待っている fit も取り消す', () => {
      const { rerender } = render(
        <AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />
      )
      resizeCallback?.()
      rerender(<AgentTerminalView controller={controller} isVisible={false} onFocusOut={vi.fn()} />)
      expect(disconnect).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(AGENT_TERMINAL_RESIZE_DEBOUNCE_MS)
      expect(controller.fit).toHaveBeenCalledTimes(1)
    })
  })
})
