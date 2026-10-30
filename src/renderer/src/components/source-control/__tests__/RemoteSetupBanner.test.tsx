import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import RemoteSetupBanner from '../RemoteSetupBanner'
import { SETTING_UPSTREAM_NOTICE } from '../../../lib/remoteSetupState'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

type Props = ComponentProps<typeof RemoteSetupBanner>

const renderBanner = (
  overrides: Partial<Props> = {}
): Props & { container: HTMLElement; rerenderWith: (next: Partial<Props>) => void } => {
  const props: Props = {
    kind: 'no-origin',
    branch: 'main',
    remoteSetup: makeRemoteSetupPanelState(),
    isBlocked: false,
    requestFocus: vi.fn<Props['requestFocus']>(),
    ...overrides
  }
  const { container, rerender } = render(<RemoteSetupBanner {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<RemoteSetupBanner {...props} {...next} />)
  return { ...props, container, rerenderWith }
}
const addButton = (): HTMLElement => screen.getByRole('button', { name: 'リモートを追加' })
const setUpstreamButton = (): HTMLElement =>
  screen.getByRole('button', { name: '初回 push（upstream を設定）' })

describe('RemoteSetupBanner', () => {
  it('kind が null なら何も出さない', () => {
    const { container } = renderBanner({ kind: null })
    expect(container).toBeEmptyDOMElement()
  })

  describe('origin が無い(no-origin)', () => {
    it('文言(status)と「リモートを追加」を出し、フォーカスの移し先の印を付ける', () => {
      renderBanner()
      expect(screen.getByRole('status')).toHaveTextContent('リモートが未設定です')
      expect(addButton()).toHaveAttribute('data-remote-setup-focus', 'add-remote')
      expect(addButton()).toBeEnabled()
    })

    it.each([
      ['追加中', { remoteSetup: makeRemoteSetupPanelState({ isAddingOrigin: true }) }],
      ['他の操作中', { isBlocked: true }]
    ] as Array<[string, Partial<Props>]>)('%s は disabled', (_label, overrides) => {
      renderBanner(overrides)
      expect(addButton()).toBeDisabled()
    })

    it('押すと前回のエラーを消して追加のダイアログを開く', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      renderBanner({ remoteSetup })
      await userEvent.click(addButton())
      expect(remoteSetup.clearAddOriginError).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toBeInTheDocument()
    })

    it('成功するとダイアログを閉じ、「初回 push（upstream を設定）」へのフォーカスを要求する', async () => {
      const { remoteSetup, requestFocus } = renderBanner()
      await userEvent.click(addButton())
      await userEvent.type(
        screen.getByRole('textbox', { name: 'URL' }),
        'https://github.com/a/b.git{Enter}'
      )
      expect(remoteSetup.addOrigin).toHaveBeenCalledWith('https://github.com/a/b.git')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(requestFocus).toHaveBeenCalledWith('set-upstream')
      // 戻さずに閉じる(開いたボタンへの戻しと、次の操作のボタンへの移しを重ねない)。否定のアサーションは、
      // 遅れて走る effect を見逃さないよう、描画をもう 1 回待ってから評価する
      await act(async () => {})
      expect(addButton()).not.toHaveFocus()
    })

    it('失敗(false)ならダイアログを閉じず、フォーカスの要求もしない', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      remoteSetup.addOrigin = async () => false
      const { requestFocus } = renderBanner({ remoteSetup })
      await userEvent.click(addButton())
      await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), '/abs/bare.git{Enter}')
      expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toBeInTheDocument()
      expect(requestFocus).not.toHaveBeenCalled()
    })

    // 別のプロセスが先に origin を追加した場合など、失敗の取り直しでバナーの種類が変わっても、
    // 開いているダイアログと失敗の表示を残す(結果の行き先を消さない。パターン 85)
    it('ダイアログを開いたままバナーの種類が変わっても、ダイアログと失敗を出し続ける', async () => {
      const { rerenderWith } = renderBanner()
      await userEvent.click(addButton())
      rerenderWith({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({
          addOriginError: new Error('リモート origin は既に設定されています')
        })
      })
      expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('リモート origin は既に設定されています')
    })

    // 戻す条件(実行中・body のときだけ・アンマウント)は useDialogFocusReturn のテストで確かめる。ここは配線だけ
    it('キャンセルで閉じると「リモートを追加」へフォーカスを戻す', async () => {
      renderBanner()
      await userEvent.click(addButton())
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      // フォーカスを戻す処理は passive な useEffect で、ダイアログが消えた後に走る。消えた直後に同期で評価せず待つ
      await waitFor(() => expect(addButton()).toHaveFocus())
    })
  })

  describe('upstream が無い(no-upstream)', () => {
    it('ブランチ名を添えた文言と「初回 push（upstream を設定）」を出し、フォーカスの移し先の印を付ける', () => {
      renderBanner({ kind: 'no-upstream', branch: 'feat/x' })
      expect(screen.getByRole('status')).toHaveTextContent('upstream が未設定です（feat/x）')
      expect(setUpstreamButton()).toHaveAttribute('data-remote-setup-focus', 'set-upstream')
      expect(setUpstreamButton()).toBeEnabled()
    })

    it.each([
      ['push 中', { remoteSetup: makeRemoteSetupPanelState({ isPushing: true }) }],
      ['pull 中・ロック中', { remoteSetup: makeRemoteSetupPanelState({ isPushBlocked: true }) }],
      ['他の操作中', { isBlocked: true }]
    ] as Array<[string, Partial<Props>]>)('%s は disabled', (_label, overrides) => {
      renderBanner({ kind: 'no-upstream', ...overrides })
      expect(setUpstreamButton()).toBeDisabled()
    })

    it('押すと初回 push し、成功したらツールバーの「…」へのフォーカスを要求する', async () => {
      const { remoteSetup, requestFocus } = renderBanner({ kind: 'no-upstream' })
      await userEvent.click(setUpstreamButton())
      expect(remoteSetup.pushSetUpstream).toHaveBeenCalledOnce()
      await waitFor(() => expect(requestFocus).toHaveBeenCalledWith('push'))
    })

    it('失敗(false)ならフォーカスの要求をしない', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      remoteSetup.pushSetUpstream = async () => false
      const { requestFocus } = renderBanner({ kind: 'no-upstream', remoteSetup })
      await userEvent.click(setUpstreamButton())
      expect(requestFocus).not.toHaveBeenCalled()
    })

    it('初回 push 中は「push 中...」と、打ち切りまでの秒数の案内(status)を出す', () => {
      renderBanner({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({ isSettingUpstream: true, isPushing: true })
      })
      const button = screen.getByRole('button', { name: 'push 中' })
      expect(button).toHaveTextContent('push 中...')
      expect(button).toBeDisabled()
      expect(screen.getByText(SETTING_UPSTREAM_NOTICE)).toHaveAttribute('role', 'status')
    })

    // 失敗の直後(取り直しの間は実行中のままエラーが入る)に、案内とパネル上部のエラーを重ねない(パターン 87)
    it('エラーがあれば、初回 push 中でも案内を出さない', () => {
      renderBanner({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({
          isSettingUpstream: true,
          isPushing: true,
          remoteOperationError: new Error('初回 push に失敗しました: x')
        })
      })
      expect(screen.queryByText(SETTING_UPSTREAM_NOTICE)).not.toBeInTheDocument()
    })

    // ツールバーの push の実行中は、バナーのボタンは disabled だが「push 中...」にはしない(どちらの push かを区別する)
    it('ツールバーの push の実行中は、ボタンの文言を変えず案内も出さない', () => {
      renderBanner({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({ isPushing: true })
      })
      expect(setUpstreamButton()).toBeDisabled()
      // 名前(aria-label)だけでなく、画面に見える文言も変えない
      expect(setUpstreamButton()).toHaveTextContent('初回 push（upstream を設定）')
      expect(screen.queryByText(SETTING_UPSTREAM_NOTICE)).not.toBeInTheDocument()
    })

    // 実行中はボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して押せるに戻っても
    // body のままだと、キーボードの利用者がボタンへ戻れない。そのため実行中が解けたとき(失敗)に、フォーカスが
    // body ならボタンへ戻す(パターン 86)。戻す条件(外のフォーカスは奪わない・実行中を経ていない描画では
    // 何もしない)は useFocusOnRunningEnd のテストで確かめる。ここは配線(エラーの有無で戻すかを決める)だけ
    describe('初回 push の失敗の後のフォーカス', () => {
      const running = makeRemoteSetupPanelState({ isSettingUpstream: true, isPushing: true })
      const failed = makeRemoteSetupPanelState({
        remoteOperationError: new Error('初回 push に失敗しました: x')
      })

      it('失敗して実行中が解けたら、フォーカスが body ならボタンへ戻す', () => {
        const { rerenderWith } = renderBanner({ kind: 'no-upstream', remoteSetup: running })
        expect(document.body).toHaveFocus()
        rerenderWith({ remoteSetup: failed })
        expect(setUpstreamButton()).toHaveFocus()
      })

      // 成功するとバナーが消える。戻す先が無いので何もしない(ツールバーの「…」へは useRemoteSetupFocus が移す)
      it('成功してバナーが消えたら、何もしない', () => {
        const { rerenderWith } = renderBanner({ kind: 'no-upstream', remoteSetup: running })
        rerenderWith({ kind: null, remoteSetup: makeRemoteSetupPanelState() })
        expect(document.body).toHaveFocus()
      })

      // 成功してもバナーが残る場合(fetch の設定の無い origin で upstream が表示されない)は、成功の後の
      // フォーカスの要求(ツールバーの「…」)に任せ、バナーのボタンへは移さない
      it('エラーが無ければ(成功)、バナーが残ってもボタンへは移さない', () => {
        const { rerenderWith } = renderBanner({ kind: 'no-upstream', remoteSetup: running })
        rerenderWith({ remoteSetup: makeRemoteSetupPanelState() })
        expect(document.body).toHaveFocus()
      })
    })
  })
})
