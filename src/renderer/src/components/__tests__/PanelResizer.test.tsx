import { render, screen, fireEvent } from '@testing-library/react'
import type { Mock } from 'vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PanelResizer from '../PanelResizer'

type Overrides = Partial<React.ComponentProps<typeof PanelResizer>>

const setup = (
  overrides: Overrides = {}
): {
  onChange: Mock
  onCommit: Mock
  handle: HTMLElement
} => {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  render(
    <PanelResizer
      orientation="vertical"
      label="サイドバーの幅"
      value={240}
      limits={() => ({ min: 160, max: 600 })}
      step={16}
      valueFromPointer={(x) => x}
      onChange={onChange}
      onCommit={onCommit}
      {...overrides}
    />
  )
  return { onChange, onCommit, handle: screen.getByRole('separator', { name: 'サイドバーの幅' }) }
}

describe('PanelResizer', () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
  })

  afterEach(() => {
    // @ts-expect-error jsdom に無いので消す
    delete Element.prototype.setPointerCapture
    // @ts-expect-error jsdom に無いので消す
    delete Element.prototype.hasPointerCapture
    // @ts-expect-error jsdom に無いので消す
    delete Element.prototype.releasePointerCapture
  })

  it('separator として値と向きを持つ', () => {
    const { handle } = setup()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '240')
    expect(handle).toHaveAttribute('aria-valuemin', '160')
    expect(handle).toHaveAttribute('aria-valuemax', '600')
    expect(handle).toHaveAttribute('tabindex', '0')
  })

  it('ドラッグで値を伝え、離したら 1 回保存する', () => {
    const { handle, onChange, onCommit } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1)
    expect(handle).toHaveClass('panel-resizer--dragging')
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    expect(onChange).toHaveBeenLastCalledWith(300)
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 })
    expect(onCommit).toHaveBeenCalledOnce()
    expect(handle).not.toHaveClass('panel-resizer--dragging')
  })

  it('主ボタン以外では始めない', () => {
    const { handle, onChange } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('値が開始時と同じなら保存しない', () => {
    const { handle, onCommit } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 240 })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('2 本目のポインタは無視する', () => {
    const { handle, onChange, onCommit } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 500 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 500 })
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 500 })
    expect(onChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(300)
  })

  it('pointercancel でも終える', () => {
    const { handle, onChange, onCommit } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    fireEvent.pointerCancel(handle, { pointerId: 1 })
    expect(onCommit).toHaveBeenCalledOnce()
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('lostpointercapture でも終える(ID の違うものは無視する)', () => {
    const { handle, onChange, onCommit } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    fireEvent.lostPointerCapture(handle, { pointerId: 2 })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.lostPointerCapture(handle, { pointerId: 1 })
    expect(onCommit).toHaveBeenCalledOnce()
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('範囲の端の矢印キーは何もしない', () => {
    const { handle, onChange, onCommit } = setup({ value: 600 })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('今の範囲があれば、値・ドラッグ・キーをその範囲で扱う', () => {
    const { handle, onChange, onCommit } = setup({
      value: 600,
      limits: () => ({ min: 160, max: 300 })
    })
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    expect(handle).toHaveAttribute('aria-valuemax', '300')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(284)
    expect(onCommit).toHaveBeenCalledOnce()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 })
    expect(onChange).toHaveBeenCalledOnce()
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 })
    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('動かしても元の値へ戻して離したら保存しない', () => {
    const { handle, onCommit } = setup()
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 240 })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('保存値が範囲の外なら、動かして開始の位置へ戻しても保存する', () => {
    const { handle, onCommit } = setup({ value: 600, limits: () => ({ min: 160, max: 300 }) })
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 })
    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('保存値が範囲の外でも、動かさなければ保存しない', () => {
    const { handle, onCommit } = setup({ value: 600, limits: () => ({ min: 160, max: 300 }) })
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('描画の後に範囲が変わっても、矢印キーは今の範囲から動かす', () => {
    let high = 600
    const { handle, onChange } = setup({ value: 600, limits: () => ({ min: 160, max: high }) })
    high = 300
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(284)
  })

  it('描画の後に範囲が変わっても、押した時点の範囲から始める', () => {
    let high = 600
    const { handle, onChange, onCommit } = setup({
      value: 600,
      limits: () => ({ min: 160, max: high })
    })
    high = 300
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 })
    expect(onChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('mousedown の既定の動作を止める(フォーカスと選択を動かさない)', () => {
    const { handle } = setup()
    expect(fireEvent.mouseDown(handle)).toBe(false)
  })

  it.each([
    ['vertical', 'ArrowRight', 256],
    ['vertical', 'ArrowLeft', 224],
    ['horizontal', 'ArrowUp', 256],
    ['horizontal', 'ArrowDown', 224]
  ] as const)('%s の %s で step ずつ変えて保存する', (orientation, key, expected) => {
    const { handle, onChange, onCommit } = setup({ orientation })
    expect(fireEvent.keyDown(handle, { key })).toBe(false)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected)
    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('向きと違う矢印キーは何もしない', () => {
    const { handle, onChange } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
