import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useOverlayDismiss } from '../useOverlayDismiss'

// 実際の DOM のイベントの経路(target と currentTarget)を見るため、renderHook ではなく小さな部品で使う。
// ダイアログの中のクリックはダイアログ側の stopPropagation で止まるが、中で押してオーバーレイで離したときの click は
// Chromium が共通の祖先(オーバーレイ)へ送るため、その経路はダイアログを通らない
function Harness({
  onDismiss,
  stopInside = true
}: {
  onDismiss: () => void
  stopInside?: boolean
}): React.JSX.Element {
  const overlayHandlers = useOverlayDismiss(onDismiss)
  return (
    <div data-testid="overlay" role="presentation" {...overlayHandlers}>
      <form
        role="dialog"
        aria-label="ダイアログ"
        onClick={stopInside ? (e) => e.stopPropagation() : undefined}
      >
        <input aria-label="入力欄" />
      </form>
    </div>
  )
}

describe('useOverlayDismiss', () => {
  it('オーバーレイで押して離すと onDismiss を呼ぶ', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // オーバーレイで押してダイアログの中(入力欄)で離すと、Chromium は共通の祖先(オーバーレイ)へ click を送る
  // (Electron の sendInputEvent で確認: 記録は down:overlay → click:overlay)。jsdom は click の target を
  // 自動で決めないため、mouseUp は入力欄、click はオーバーレイに手動で送る
  it('オーバーレイで押してダイアログの中で離しても onDismiss を呼ばない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByRole('textbox', { name: '入力欄' }))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // 離した位置の記録は click ごとにリセットする。前回の「オーバーレイで離した」を次の click に持ち越さない
  it('離した位置の記録は次の click に持ち越さない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    // 1 回目: オーバーレイで押して離す(閉じる)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    // 2 回目: オーバーレイで押し、mouseup がオーバーレイに届かない(中で離した)まま click だけが届く
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // 押下と離した位置の両方の記録を click の後で捨てる。押下の無い click(スクリプトからの click など)を、
  // 前回の操作の記録で閉じる判定にしない
  it('押下と離した位置の記録は click の後で捨て、押下の無い click では閉じない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // 長い URL のドラッグ選択など: mousedown は入力欄、mouseup と click はオーバーレイ
  it('ダイアログの中で押してオーバーレイで離しても onDismiss を呼ばない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByRole('textbox', { name: '入力欄' }))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('押下の記録は次の押下で上書きされる(中で押した後でも、オーバーレイで押し直せば閉じる)', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByRole('textbox', { name: '入力欄' }))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // 中の click を止めない部品でも、子を target にした click では閉じない(押下の判定だけに頼らない)
  it('オーバーレイで押しても、click の target が子なら onDismiss を呼ばない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} stopInside={false} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByRole('textbox', { name: '入力欄' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
