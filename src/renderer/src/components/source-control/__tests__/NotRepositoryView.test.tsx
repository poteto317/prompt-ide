import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import NotRepositoryView from '../NotRepositoryView'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

type Props = ComponentProps<typeof NotRepositoryView>

// props に加え、同じ props を基に一部だけ変えて描き直す rerenderWith を返す
const renderView = (
  overrides: Partial<Props> = {}
): Props & { rerenderWith: (next: Partial<Props>) => void } => {
  const props: Props = {
    remoteSetup: makeRemoteSetupPanelState(),
    isBlocked: false,
    requestFocus: vi.fn<Props['requestFocus']>(),
    ...overrides
  }
  const { rerender } = render(<NotRepositoryView {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<NotRepositoryView {...props} {...next} />)
  return { ...props, rerenderWith }
}
const openButton = (): HTMLElement => screen.getByRole('button', { name: 'リポジトリを初期化' })

describe('NotRepositoryView', () => {
  it('「Git リポジトリではありません」と「リポジトリを初期化」ボタンを出す', () => {
    renderView()
    expect(screen.getByText('Git リポジトリではありません')).toBeInTheDocument()
    expect(openButton()).toBeEnabled()
  })

  it('初期化中だけボタンを disabled にする', () => {
    renderView({ remoteSetup: makeRemoteSetupPanelState({ isInitializing: true }) })
    expect(openButton()).toBeDisabled()
  })

  it('押すと前回のエラーを消してダイアログを開く', async () => {
    const { remoteSetup } = renderView()
    await userEvent.click(openButton())
    expect(remoteSetup.clearInitError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toBeInTheDocument()
  })

  // 戻す条件(実行中・body のときだけ・アンマウント)は useDialogFocusReturn のテストで確かめる。ここは配線だけ
  it('キャンセルで閉じると、ボタンへフォーカスを戻す', async () => {
    renderView()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // フォーカスを戻す処理は passive な useEffect で、ダイアログが消えた後に走る。消えた直後に同期で評価せず待つ
    await waitFor(() => expect(openButton()).toHaveFocus())
  })

  // 成功するとボタンは(リポジトリの表示に切り替わって)消えるため、次の操作のボタンへフォーカスを移す要求を出す
  it('成功するとダイアログを閉じ、「リモートを追加」へのフォーカスを要求する', async () => {
    const { remoteSetup, requestFocus } = renderView()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: '初期化' }))
    expect(remoteSetup.initRepository).toHaveBeenCalledWith('main')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requestFocus).toHaveBeenCalledWith('add-remote')
  })

  // 成功しても取り直しが失敗すると(握りつぶされる)、この部品が残り、移す先(バナー)が無い。フォーカスを body に
  // 落とさず開いたボタンへ戻す。通常の経路ではこの部品ごと外れるため戻さない(RemoteSetupFlow のテストで確かめる)
  it('成功した後もこの部品が残っていれば(Git 管理外のまま)、ボタンへフォーカスを戻す', async () => {
    renderView()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: '初期化' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(openButton()).toHaveFocus())
  })

  it('失敗(false)ならダイアログを閉じず、フォーカスの要求もしない', async () => {
    const remoteSetup = makeRemoteSetupPanelState()
    remoteSetup.initRepository = async () => false
    const { requestFocus } = renderView({ remoteSetup })
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: '初期化' }))
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toBeInTheDocument()
    expect(requestFocus).not.toHaveBeenCalled()
  })

  it('失敗は開いているダイアログ内に alert で出す', async () => {
    const { rerenderWith } = renderView()
    await userEvent.click(openButton())
    rerenderWith({
      remoteSetup: makeRemoteSetupPanelState({
        initError: new Error('ブランチ名として使用できない名前です: a..b')
      })
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ブランチ名として使用できない名前です: a..b'
    )
  })

  it('他の Git 操作のロック中(isBlocked)は、ダイアログの「初期化」を disabled にする', async () => {
    renderView({ isBlocked: true })
    await userEvent.click(openButton())
    expect(screen.getByRole('button', { name: '初期化' })).toBeDisabled()
  })
})
