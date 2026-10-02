import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { useDialogFocusReturn } from '../useDialogFocusReturn'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う。開くボタンは実行中に disabled になる
// (呼び出し元の 3 か所と同じ)。ダイアログの中の「閉じる」は、実行中に閉じる経路(成功)を試すため disabled にしない
function Harness({
  isRunning,
  onOpen
}: {
  isRunning: boolean
  onOpen?: () => void
}): React.JSX.Element {
  const openerRef = useRef<HTMLButtonElement>(null)
  const dialog = useDialogFocusReturn({ isRunning, onOpen, openerRef })
  return (
    <>
      <button ref={openerRef} type="button" disabled={isRunning} onClick={dialog.open}>
        開く
      </button>
      {dialog.isOpen && (
        <div role="dialog" aria-label="ダイアログ">
          <button type="button" onClick={dialog.close}>
            閉じる
          </button>
          <button type="button" onClick={dialog.closeWithoutReturn}>
            戻さずに閉じる
          </button>
        </div>
      )}
      <input aria-label="外の入力欄" />
    </>
  )
}

const opener = (): HTMLElement => screen.getByRole('button', { name: '開く' })
// ボタンへフォーカスを移さずに押す(userEvent.click はフォーカスを押したボタンへ移す。フォーカスが body のまま・
// 外へ移したままの状態を保つために使う)
const clickWithoutFocus = (name: string): void =>
  act(() => screen.getByRole('button', { name }).click())

// 開く → 閉じるときに戻す予約 → 閉じて実行中でもなくなった描画の後、body のときだけ開いたボタンへ戻す(パターン 86)
describe('useDialogFocusReturn', () => {
  it('開くと onOpen を呼んでから開く', async () => {
    const onOpen = vi.fn()
    render(<Harness isRunning={false} onOpen={onOpen} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(opener())
    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toBeInTheDocument()
  })

  it('閉じる(キャンセル)と、開いたボタンへフォーカスを戻す', async () => {
    render(<Harness isRunning={false} />)
    await userEvent.click(opener())
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener()).toHaveFocus()
  })

  // 成功の経路: 実行中フラグの解除が反映される前に閉じる。disabled のボタンへの focus() は無視されるため、
  // 実行中の間は戻さず(予約は残す)、解けた描画の後で戻す(パターン 73・86)
  it('実行中に閉じたら(成功の経路)、実行中の間は戻さず、解けてから戻す', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    clickWithoutFocus('開く')
    rerender(<Harness isRunning={true} />)
    clickWithoutFocus('閉じる')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} />)
    expect(opener()).toHaveFocus()
  })

  it('利用者が別の要素へ移していたら奪わない', async () => {
    render(<Harness isRunning={false} />)
    await userEvent.click(opener())
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    clickWithoutFocus('閉じる')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })

  // 成功の後に次の操作のボタンへ移す呼び出し元(初期化・リモートの追加)は、戻さずに閉じる
  it('戻さずに閉じたら、開いたボタンへ戻さない', () => {
    render(<Harness isRunning={false} />)
    clickWithoutFocus('開く')
    clickWithoutFocus('戻さずに閉じる')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  // 予約は部品ごとに持ち、アンマウントで消える(フォルダの切り替え等で、別の部品のボタンへ持ち越さない)
  it('予約はアンマウントで消え、次にマウントした部品で戻さない', () => {
    const { rerender, unmount } = render(<Harness isRunning={false} />)
    clickWithoutFocus('開く')
    rerender(<Harness isRunning={true} />)
    clickWithoutFocus('閉じる')
    unmount()
    render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
  })
})
