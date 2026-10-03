import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { useFocusOnRunningStart } from '../useFocusOnRunningStart'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({
  isRunning,
  withContainer = false
}: {
  isRunning: boolean
  withContainer?: boolean
}): React.JSX.Element {
  const targetRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLFormElement>(null)
  useFocusOnRunningStart(isRunning, targetRef, {
    containerRef: withContainer ? containerRef : undefined
  })
  return (
    <>
      <form ref={containerRef}>
        <input aria-label="中の入力欄" />
        <button ref={targetRef} type="button">
          対象
        </button>
      </form>
      <input aria-label="外の入力欄" />
    </>
  )
}

const target = (): HTMLElement => screen.getByRole('button', { name: '対象' })
const insideInput = (): HTMLElement => screen.getByRole('textbox', { name: '中の入力欄' })
const outsideInput = (): HTMLElement => screen.getByRole('textbox', { name: '外の入力欄' })

// 実行が始まって入力欄などが disabled になり body に落ちたフォーカスを、押せる対象(`キャンセル`)へ移す(パターン 86)
describe('useFocusOnRunningStart', () => {
  it('実行中が false→true になったとき、フォーカスが body なら対象へ移す', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={true} />)
    expect(target()).toHaveFocus()
  })

  it('containerRef の中にあるフォーカスも対象へ移す', () => {
    const { rerender } = render(<Harness isRunning={false} withContainer />)
    act(() => insideInput().focus())
    rerender(<Harness isRunning={true} withContainer />)
    expect(target()).toHaveFocus()
  })

  it('containerRef が無ければ、中の要素にあるフォーカスも移さない', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    act(() => insideInput().focus())
    rerender(<Harness isRunning={true} />)
    expect(insideInput()).toHaveFocus()
  })

  it('外の要素へ移したフォーカスは奪わない', () => {
    const { rerender } = render(<Harness isRunning={false} withContainer />)
    act(() => outsideInput().focus())
    rerender(<Harness isRunning={true} withContainer />)
    expect(outsideInput()).toHaveFocus()
  })

  it('マウントした時点で実行中なら移さない', () => {
    render(<Harness isRunning={true} withContainer />)
    expect(document.body).toHaveFocus()
  })

  // effect は依存(実行中・ref)が変わったときだけ走る。containerRef を付け替えて、実行中が変わらない再描画でも
  // 判定を通す(そうしないと、条件を外しても effect が走らず落ちない)
  it('実行中のままの再描画(true→true)では移さない', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    rerender(<Harness isRunning={true} />)
    expect(target()).toHaveFocus()
    // 実行中に body へ落ちたフォーカスは、実行が始まったときではないため移さない
    act(() => target().blur())
    rerender(<Harness isRunning={true} withContainer />)
    expect(document.body).toHaveFocus()
  })

  it('true→false や、false のままの再描画では移さない', () => {
    const { rerender } = render(<Harness isRunning={true} />)
    rerender(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} withContainer />)
    expect(document.body).toHaveFocus()
  })

  // 直前の実行中の状態は部品ごとに持ち、アンマウントで消える(次にマウントした部品へ持ち越さない)
  it('アンマウントした部品の状態で、次にマウントした部品が移さない', () => {
    const { unmount } = render(<Harness isRunning={false} />)
    unmount()
    render(<Harness isRunning={true} />)
    expect(document.body).toHaveFocus()
  })
})
