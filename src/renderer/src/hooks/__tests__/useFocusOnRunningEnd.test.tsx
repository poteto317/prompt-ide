import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { useFocusOnRunningEnd } from '../useFocusOnRunningEnd'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({
  isRunning,
  enabled,
  withContainer = false
}: {
  isRunning: boolean
  enabled?: boolean
  withContainer?: boolean
}): React.JSX.Element {
  const targetRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLFormElement>(null)
  useFocusOnRunningEnd(isRunning, targetRef, {
    containerRef: withContainer ? containerRef : undefined,
    enabled
  })
  return (
    <>
      <form ref={containerRef}>
        <input ref={targetRef} aria-label="対象" />
        <button type="button">中のボタン</button>
      </form>
      <input aria-label="外の入力欄" />
    </>
  )
}

const target = (): HTMLElement => screen.getByRole('textbox', { name: '対象' })

// 実行中に disabled になった要素から body に落ちたフォーカスを、実行中が解けたときに対象へ戻す(パターン 86)
describe('useFocusOnRunningEnd', () => {
  it('実行中が true→false になったとき、フォーカスが body なら対象へ戻す', () => {
    const { rerender } = render(<Harness isRunning={true} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} />)
    expect(target()).toHaveFocus()
  })

  it('外の要素にあるフォーカスは奪わない', () => {
    const { rerender } = render(<Harness isRunning={true} withContainer />)
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    rerender(<Harness isRunning={false} withContainer />)
    expect(outside).toHaveFocus()
  })

  it('containerRef の中にあるフォーカスも対象へ戻す', () => {
    const { rerender } = render(<Harness isRunning={true} withContainer />)
    act(() => screen.getByRole('button', { name: '中のボタン' }).focus())
    rerender(<Harness isRunning={false} withContainer />)
    expect(target()).toHaveFocus()
  })

  it('enabled が false なら戻さない', () => {
    const { rerender } = render(<Harness isRunning={true} enabled={false} />)
    rerender(<Harness isRunning={false} enabled={false} />)
    expect(document.body).toHaveFocus()
  })

  it('false→true や、実行中を経ていない描画(初回のマウント・false のままの再描画)では何もしない', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={true} />)
    expect(document.body).toHaveFocus()
  })

  // 直前の実行中の状態は部品ごとに持ち、アンマウントで消える(次にマウントした部品へ持ち越さない)
  it('アンマウントした部品の実行中の状態で、次にマウントした部品が戻さない', () => {
    const { unmount } = render(<Harness isRunning={true} />)
    unmount()
    render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
  })
})
