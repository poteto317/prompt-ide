import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import type { RemoteSetupFocusTarget } from '../../lib/remoteSetupState'
import { useRemoteSetupFocus } from '../useRemoteSetupFocus'

type RequestFocus = ReturnType<typeof useRemoteSetupFocus>['requestFocus']

// 描画ごとの requestFocus を外へ渡す(要求を出す部品の代わり。ボタンを押して要求するとフォーカスがそのボタンへ移り、
// 「フォーカスが body のときだけ移す」を試せないため)
function Harness({
  onRender,
  target = 'push',
  showTarget = true,
  disabled = false
}: {
  onRender: (requestFocus: RequestFocus) => void
  target?: RemoteSetupFocusTarget
  showTarget?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const { requestFocus } = useRemoteSetupFocus(rootRef)
  onRender(requestFocus)
  return (
    <div ref={rootRef}>
      {showTarget && (
        <button type="button" data-remote-setup-focus={target} disabled={disabled}>
          移す先
        </button>
      )}
      <input aria-label="外の入力欄" />
    </div>
  )
}

const setup = (
  props: Omit<Parameters<typeof Harness>[0], 'onRender'> = {}
): {
  request: (target: RemoteSetupFocusTarget) => void
  requestFocusOfEachRender: RequestFocus[]
  rerenderWith: (next: Omit<Parameters<typeof Harness>[0], 'onRender'>) => void
} => {
  const requestFocusOfEachRender: RequestFocus[] = []
  const onRender = (requestFocus: RequestFocus): void => {
    requestFocusOfEachRender.push(requestFocus)
  }
  const { rerender } = render(<Harness onRender={onRender} {...props} />)
  return {
    request: (target) => act(() => requestFocusOfEachRender.at(-1)?.(target)),
    requestFocusOfEachRender,
    rerenderWith: (next) => rerender(<Harness onRender={onRender} {...next} />)
  }
}
const targetButton = (): HTMLElement => screen.getByRole('button', { name: '移す先' })

// 成功の後に、次の操作のボタンへ描画の後で移す。フォーカスが body のときだけ移し、要求は 1 回だけ扱う(パターン 86)
describe('useRemoteSetupFocus', () => {
  it('要求があり、フォーカスが body なら、印の付いたボタンへ移す', () => {
    const { request } = setup()
    expect(document.body).toHaveFocus()
    request('push')
    expect(targetButton()).toHaveFocus()
  })

  it('利用者が別の要素へ移していたら奪わない', () => {
    const { request } = setup()
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    request('push')
    expect(outside).toHaveFocus()
  })

  // 要求は呼ぶたびに別の要求として扱うため、同じ先をもう一度要求しても描画の後に移す
  it('同じ先を続けて要求しても、毎回移す', () => {
    const { request } = setup()
    request('push')
    expect(targetButton()).toHaveFocus()
    act(() => targetButton().blur())
    expect(document.body).toHaveFocus()
    request('push')
    expect(targetButton()).toHaveFocus()
  })

  // 移せなかった要求は持ち越さない。後から現れたボタンへ遅れて移さない(例: 追加の後に detached でバナーが出ない)
  it('移す先が無ければ何もせず、後から現れても移さない', () => {
    const { request, rerenderWith } = setup({ showTarget: false })
    request('push')
    expect(document.body).toHaveFocus()
    rerenderWith({ showTarget: true })
    expect(document.body).toHaveFocus()
  })

  it('移す先が disabled なら移さず、後から押せるようになっても移さない', () => {
    const { request, rerenderWith } = setup({ disabled: true })
    request('push')
    expect(targetButton()).not.toHaveFocus()
    rerenderWith({ disabled: false })
    expect(targetButton()).not.toHaveFocus()
  })

  it('別の先の要求では、印の違うボタンへ移さない', () => {
    const { request } = setup({ target: 'push' })
    request('set-upstream')
    expect(document.body).toHaveFocus()
  })

  it('要求が無ければ何もしない', () => {
    setup()
    expect(document.body).toHaveFocus()
  })

  // 子の部品へ props で渡すため、描画ごとに変わらない
  it('requestFocus の参照は再描画で変わらない', () => {
    const { request, requestFocusOfEachRender } = setup()
    request('push')
    expect(requestFocusOfEachRender.length).toBeGreaterThan(1)
    expect(new Set(requestFocusOfEachRender).size).toBe(1)
  })
})
