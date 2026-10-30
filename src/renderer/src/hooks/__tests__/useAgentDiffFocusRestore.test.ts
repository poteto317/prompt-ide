import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { AgentDiffFocusRestore } from '../useAgentDiffFocusRestore'
import { useAgentDiffFocusRestore } from '../useAgentDiffFocusRestore'

let panel: HTMLDivElement | null = null

afterEach(() => {
  panel?.remove()
  panel = null
  vi.restoreAllMocks()
})

// jsdom は文書に無い要素へ focus() できないので、body に append する
function makePanel(inner: string): HTMLDivElement {
  const div = document.createElement('div')
  div.innerHTML = inner
  document.body.appendChild(div)
  panel = div
  return div
}

function setup(div: HTMLDivElement): ReturnType<typeof renderHook<AgentDiffFocusRestore, unknown>> {
  const hook = renderHook(() => useAgentDiffFocusRestore())
  hook.result.current.panelRef.current = div
  return hook
}

const TABS =
  '<button role="tab" aria-selected="false" id="t0">a</button><button role="tab" aria-selected="true" id="t1">b</button>'

describe('useAgentDiffFocusRestore', () => {
  it('予約が無い描画ではフォーカスを動かさない', () => {
    const div = makePanel(TABS)
    const { rerender } = setup(div)
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender()
    expect(document.activeElement).toBe(document.body)
  })

  it('予約の後、フォーカスが body にあれば選択中のタブへ戻す', () => {
    const div = makePanel(TABS)
    const { result, rerender } = setup(div)
    result.current.reserveFocusRestore()
    rerender()
    expect(document.activeElement).toBe(div.querySelector('#t1'))
  })

  it('予約の後、パネル内の無効化されたボタンにフォーカスがあれば選択中のタブへ移す', () => {
    const div = makePanel(TABS + '<button id="hunk">戻す</button>')
    const hunk = div.querySelector<HTMLButtonElement>('#hunk')!
    const { result, rerender } = setup(div)
    hunk.focus()
    result.current.reserveFocusRestore()
    hunk.disabled = true
    // jsdom は無効化してもフォーカスを外さない(ここが body だと、body の経路のテストになってしまう)
    expect(document.activeElement).toBe(hunk)
    rerender()
    expect(document.activeElement).toBe(div.querySelector('#t1'))
  })

  it('予約の後、選択中のタブが無ければ予約を解除し、以後の描画で動かさない', () => {
    const div = makePanel('<button role="tab" aria-selected="false" id="t0">a</button>')
    const { result, rerender } = setup(div)
    result.current.reserveFocusRestore()
    rerender()
    expect(document.activeElement).toBe(document.body)
    // 後からタブが選択中になっても、予約は解除済みなので動かさない
    div.querySelector('#t0')!.setAttribute('aria-selected', 'true')
    rerender()
    expect(document.activeElement).toBe(document.body)
  })

  it('予約の後、利用者がパネルの外へフォーカスを移していたら奪わず、予約を解除する', () => {
    const div = makePanel(TABS)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      const { result, rerender } = setup(div)
      result.current.reserveFocusRestore()
      outside.focus()
      rerender()
      expect(document.activeElement).toBe(outside)
      // 解除済みなので、body に落ちても戻さない
      outside.blur()
      rerender()
      expect(document.activeElement).toBe(document.body)
    } finally {
      outside.remove()
    }
  })

  it.each(['pointerdown', 'keydown'])('予約の後の %s で予約を解除する', (type) => {
    const div = makePanel(TABS)
    const { result, rerender } = setup(div)
    result.current.reserveFocusRestore()
    document.dispatchEvent(new Event(type))
    rerender()
    expect(document.activeElement).toBe(document.body)
  })

  it('reserveFocusRestore を 2 回呼んでもリスナーは 1 組だけ', () => {
    const div = makePanel(TABS)
    const { result } = setup(div)
    // 描画の後に張る(初回の描画で React が document へ張る selectionchange を数えない)
    const add = vi.spyOn(document, 'addEventListener')
    result.current.reserveFocusRestore()
    result.current.reserveFocusRestore()
    expect(add).toHaveBeenCalledTimes(2)
    expect(add.mock.calls.map((c) => c[0])).toEqual(['pointerdown', 'keydown'])
  })

  it('アンマウントでリスナーを外す', () => {
    const div = makePanel(TABS)
    const remove = vi.spyOn(document, 'removeEventListener')
    const { result, unmount } = setup(div)
    result.current.reserveFocusRestore()
    unmount()
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['keydown', 'pointerdown'])
  })
})
