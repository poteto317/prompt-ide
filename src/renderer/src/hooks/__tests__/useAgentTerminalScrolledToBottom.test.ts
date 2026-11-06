// src/renderer/src/hooks/__tests__/useAgentTerminalScrolledToBottom.test.ts
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useAgentTerminalScrolledToBottom } from '../useAgentTerminalScrolledToBottom'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'

const render = (
  controller: FakeController
): ReturnType<typeof renderHook<boolean, FakeController>> =>
  renderHook((c: FakeController) => useAgentTerminalScrolledToBottom(c), {
    initialProps: controller
  })

describe('useAgentTerminalScrolledToBottom', () => {
  it('最初の描画で controller の値を返す', () => {
    const controller = makeFakeController()
    controller.scrolledToBottom = false
    expect(render(controller).result.current).toBe(false)
  })

  it('xterm のスクロール(onScroll)をきっかけに読み直す', () => {
    const controller = makeFakeController()
    const { result } = render(controller)
    expect(result.current).toBe(true)
    act(() => controller.scrollTo(false))
    expect(result.current).toBe(false)
    act(() => controller.scrollTo(true))
    expect(result.current).toBe(true)
  })

  it('出力の書き込みの通知(onOutputWritten)でも読み直す', () => {
    const controller = makeFakeController()
    const { result } = render(controller)
    controller.scrolledToBottom = false
    act(() => controller.emitOutputWritten())
    expect(result.current).toBe(false)
  })

  it('ターミナルの大きさの変化の通知(onResized)でも読み直す(行を増やすと出力もスクロールの通知も無く末尾に着きうる)', () => {
    const controller = makeFakeController()
    controller.scrolledToBottom = false
    const { result } = render(controller)
    expect(result.current).toBe(false)
    controller.scrolledToBottom = true
    act(() => controller.emitResized())
    expect(result.current).toBe(true)
  })

  it('タブを選び直す(controller が替わる)と、新しい controller の値を返し、前の controller の購読を外す', () => {
    const first = makeFakeController()
    const second = makeFakeController()
    second.scrolledToBottom = false
    const { result, rerender } = render(first)
    rerender(second)
    expect(result.current).toBe(false)
    expect(first.scrollListeners.size).toBe(0)
    expect(first.outputWrittenListeners.size).toBe(0)
    expect(first.resizedListeners.size).toBe(0)
    expect(second.scrollListeners.size).toBe(1)
    expect(second.outputWrittenListeners.size).toBe(1)
    expect(second.resizedListeners.size).toBe(1)
  })

  it('外すと購読を外す', () => {
    const controller = makeFakeController()
    const { unmount } = render(controller)
    unmount()
    expect(controller.scrollListeners.size).toBe(0)
    expect(controller.outputWrittenListeners.size).toBe(0)
    expect(controller.resizedListeners.size).toBe(0)
  })
})
