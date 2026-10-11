import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { AgentSendConfirmDialogState, AgentSendConfirmPending } from '../../../types'
import {
  AGENT_SEND_FAILURE_MESSAGES,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING
} from '../../../lib/agentSendMessages'
import AgentSendConfirmDialog from '../AgentSendConfirmDialog'

const makePending = (
  overrides: Partial<AgentSendConfirmPending> = {}
): AgentSendConfirmPending => ({
  text: 'このフォルダのファイルを一覧して',
  slotId: 'slot-2',
  label: 'claude 2',
  promptId: 'p1',
  unsavedPaths: [],
  ...overrides
})

const makeState = (
  overrides: Partial<AgentSendConfirmDialogState> = {}
): AgentSendConfirmDialogState => ({
  pending: makePending(),
  targetBlockedReason: null,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  ...overrides
})

const getDialog = (): HTMLElement => screen.getByRole('dialog', { name: '送信前の確認' })
const submitButton = (): HTMLElement => screen.getByRole('button', { name: '送信' })
const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'キャンセル' })

// 開いた元の要素・一覧の実行ボタン(data-prompt-run)とダイアログを並べる。開くのは state を閉じた状態から開いた状態へ変えたとき
interface HarnessProps {
  state: AgentSendConfirmDialogState
  showOpener?: boolean
  openerDisabled?: boolean
  showRunButton?: boolean
}
function Harness({
  state,
  showOpener = true,
  openerDisabled = false,
  showRunButton = true
}: HarnessProps): React.JSX.Element {
  return (
    <>
      {showOpener && (
        <button type="button" disabled={openerDisabled}>
          開いた元
        </button>
      )}
      {showRunButton && (
        <button type="button" data-prompt-run="p1">
          一覧の実行
        </button>
      )}
      <button type="button" data-prompt-run="p2">
        ほかのプロンプトの実行
      </button>
      <AgentSendConfirmDialog state={state} />
    </>
  )
}

describe('AgentSendConfirmDialog', () => {
  describe('表示', () => {
    it('閉じていれば何も描画しない', () => {
      render(<AgentSendConfirmDialog state={makeState({ pending: null })} />)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // 開いたときのフォーカスは送信なので、送り先はダイアログの説明として読ませる(本文は長くなりうるので含めない)
    it('ダイアログの説明に送り先を結び付ける', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription('送り先: claude 2')
    })

    // 理由があると開いたときのフォーカスはキャンセルに置くため、押せない送信だけでなくダイアログの説明にも理由を含める
    it('送れない理由があれば、ダイアログの説明に理由も含める', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ targetBlockedReason: RUN_DISABLED_NO_SESSION })}
        />
      )
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
        `送り先: claude 2 ${RUN_DISABLED_NO_SESSION}`
      )
    })

    it('見出しを名前にしたモーダルのダイアログに、送り先・本文・文字数を出す', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      const dialog = getDialog()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(within(dialog).getByText('送り先: claude 2')).toBeInTheDocument()
      expect(within(dialog).getByRole('region', { name: '送る内容' })).toHaveTextContent(
        'このフォルダのファイルを一覧して'
      )
      expect(within(dialog).getByText('16 文字')).toBeInTheDocument()
    })

    it('本文は正規化した後の文字列を、改行を保って出し、文字数も正規化した後の長さ', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ text: 'line1\r\nline2\x07' }) })}
        />
      )
      expect(screen.getByRole('region', { name: '送る内容' }).textContent).toBe('line1\nline2')
      expect(screen.getByText('11 文字')).toBeInTheDocument()
    })

    it('文字数は 3 桁ごとに区切る', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ text: 'a'.repeat(1234) }) })}
        />
      )
      expect(screen.getByText('1,234 文字')).toBeInTheDocument()
    })

    it('本文の領域はキーボードでもスクロールできるよう Tab で止まる', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.getByRole('region', { name: '送る内容' })).toHaveAttribute('tabindex', '0')
    })

    it('送れるなら理由を出さず、送信を押せる', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(submitButton()).toBeEnabled()
    })
  })

  describe('未保存の注意', () => {
    const NOTICE =
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts、docs/a.md'

    it('未保存のファイルがあれば注意を出し、ダイアログの説明に含める(送信は止めない)', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ unsavedPaths: ['src/app.ts', 'docs/a.md'] }) })}
        />
      )
      expect(within(getDialog()).getByText(NOTICE)).toBeInTheDocument()
      expect(getDialog()).toHaveAccessibleDescription(`送り先: claude 2 ${NOTICE}`)
      expect(submitButton()).toBeEnabled()
    })

    it('未保存の注意と送れない理由が両方あれば、送り先・未保存の注意・理由の順に説明に含める', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({
            pending: makePending({ text: '!ls', unsavedPaths: ['src/app.ts', 'docs/a.md'] })
          })}
        />
      )
      expect(getDialog()).toHaveAccessibleDescription(
        `送り先: claude 2 ${NOTICE} ${AGENT_SEND_FAILURE_MESSAGES['leading-bang']}`
      )
    })

    it('未保存のファイルが無ければ注意を出さない', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.queryByText(/未保存の変更があるファイル/)).toBeNull()
    })
  })

  describe('送れない理由', () => {
    it.each([
      ['先頭が「!」', '!ls', AGENT_SEND_FAILURE_MESSAGES['leading-bang']],
      ['空白だけ', '  \n', AGENT_SEND_FAILURE_MESSAGES.empty],
      ['長すぎる', 'a'.repeat(200_001), AGENT_SEND_FAILURE_MESSAGES['too-long']]
    ])(
      '本文が %s なら理由を role="alert" で出し、送信を押せず、理由を送信の説明にする',
      (_label, text, message) => {
        render(<AgentSendConfirmDialog state={makeState({ pending: makePending({ text }) })} />)
        expect(screen.getByRole('alert')).toHaveTextContent(message)
        expect(submitButton()).toBeDisabled()
        expect(submitButton()).toHaveAccessibleDescription(message)
      }
    )

    it('長すぎるときも文字数を出す', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ text: 'a'.repeat(200_001) }) })}
        />
      )
      expect(screen.getByText('200,001 文字')).toBeInTheDocument()
    })

    it.each([
      ['終了した', RUN_DISABLED_NO_SESSION],
      ['閉じる途中', RUN_DISABLED_CLOSING],
      ['送信中', RUN_DISABLED_SENDING]
    ])('送り先が %s なら、その理由を出して送信を押せない', (_label, reason) => {
      render(<AgentSendConfirmDialog state={makeState({ targetBlockedReason: reason })} />)
      expect(screen.getByRole('alert')).toHaveTextContent(reason)
      expect(submitButton()).toBeDisabled()
      expect(submitButton()).toHaveAccessibleDescription(reason)
    })

    it('本文と送り先の両方に理由があれば、本文の理由を 1 つだけ出す', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({
            pending: makePending({ text: '!ls' }),
            targetBlockedReason: RUN_DISABLED_NO_SESSION
          })}
        />
      )
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.getByRole('alert')).toHaveTextContent(
        AGENT_SEND_FAILURE_MESSAGES['leading-bang']
      )
    })
  })

  describe('操作', () => {
    it('送信を押すと onConfirm', async () => {
      const state = makeState()
      render(<AgentSendConfirmDialog state={state} />)
      await userEvent.click(submitButton())
      expect(state.onConfirm).toHaveBeenCalledOnce()
      expect(state.onCancel).not.toHaveBeenCalled()
    })

    // 契機ごとに 1 回ずつ確かめる(合計の回数では、ある契機の 2 回呼びと別の契機の抜けが打ち消し合って見逃す)
    it.each([
      ['キャンセル', (): Promise<void> => userEvent.click(cancelButton())],
      [
        'Esc',
        async (): Promise<void> => {
          await userEvent.keyboard('{Escape}')
        }
      ],
      [
        '背景のクリック',
        (): Promise<void> =>
          userEvent.click(document.querySelector('.agent-send-confirm__overlay')!)
      ]
    ])('%s で onCancel を 1 回だけ呼ぶ(送らない)', async (_label, close) => {
      const state = makeState()
      render(<AgentSendConfirmDialog state={state} />)
      await close()
      expect(state.onCancel).toHaveBeenCalledOnce()
      expect(state.onConfirm).not.toHaveBeenCalled()
    })

    // 一覧の実行・変数のフォームで押した Enter を押し続けると、リピートの keydown が開いた直後の送信を押してしまう。
    // ボタンの Enter は keydown の既定の動作で click になるため、既定の動作を止めているか(fireEvent の戻り値)で確かめる
    it.each([['Enter'], [' ']])(
      'キーリピートの %j の keydown は既定の動作を止める(押し続けても確認を飛ばして送らない)',
      (key) => {
        const state = makeState()
        render(<AgentSendConfirmDialog state={state} />)
        expect(fireEvent.keyDown(submitButton(), { key, repeat: true })).toBe(false)
        expect(fireEvent.keyDown(cancelButton(), { key, repeat: true })).toBe(false)
        expect(state.onConfirm).not.toHaveBeenCalled()
      }
    )

    // 本文の領域は Space の押し続けでスクロールするため、ボタン以外のリピートは止めない
    it('本文の領域でのキーリピートの Space は止めない', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      const region = screen.getByRole('region', { name: '送る内容' })
      expect(fireEvent.keyDown(region, { key: ' ', repeat: true })).toBe(true)
    })

    it.each([['Enter'], [' ']])('リピートでない %j の keydown は止めない', (key) => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(fireEvent.keyDown(submitButton(), { key })).toBe(true)
    })

    it('ダイアログの中のクリックでは閉じない', async () => {
      const state = makeState()
      render(<AgentSendConfirmDialog state={state} />)
      await userEvent.click(screen.getByRole('region', { name: '送る内容' }))
      await userEvent.click(screen.getByText('送り先: claude 2'))
      expect(state.onCancel).not.toHaveBeenCalled()
    })

    // 背景はフォーカスできない要素なので、mousedown の既定の動作を止めないとフォーカスが body へ落ち、Esc が届かなくなる
    describe('背景の押下でフォーカスを動かさない', () => {
      const getOverlay = (): HTMLElement =>
        document.querySelector<HTMLElement>('.agent-send-confirm__overlay')!

      it('背景の mousedown は既定の動作を止める。ダイアログの中の mousedown は止めない', () => {
        render(<AgentSendConfirmDialog state={makeState()} />)
        expect(fireEvent.mouseDown(getOverlay())).toBe(false)
        expect(fireEvent.mouseDown(screen.getByText('送り先: claude 2'))).toBe(true)
        expect(fireEvent.mouseDown(screen.getByRole('region', { name: '送る内容' }))).toBe(true)
      })

      it('背景を右クリックしても閉じず、フォーカスは送信に残り、続けて Esc で閉じられる', async () => {
        const state = makeState()
        render(<AgentSendConfirmDialog state={state} />)
        await userEvent.pointer({ keys: '[MouseRight]', target: getOverlay() })
        expect(state.onCancel).not.toHaveBeenCalled()
        expect(submitButton()).toHaveFocus()
        await userEvent.keyboard('{Escape}')
        expect(state.onCancel).toHaveBeenCalledOnce()
      })

      // 実行をダブルクリックすると、2 回目の mousedown・mouseup・click は開いた直後の背景に届く(AGT-172)
      it('連続のクリックの 2 回目(detail: 2)の背景の click では閉じない。1 回目(detail: 1)では閉じる', () => {
        const state = makeState()
        render(<AgentSendConfirmDialog state={state} />)
        fireEvent.mouseDown(getOverlay(), { detail: 2 })
        fireEvent.mouseUp(getOverlay(), { detail: 2 })
        fireEvent.click(getOverlay(), { detail: 2 })
        expect(state.onCancel).not.toHaveBeenCalled()
        fireEvent.mouseDown(getOverlay(), { detail: 1 })
        fireEvent.mouseUp(getOverlay(), { detail: 1 })
        fireEvent.click(getOverlay(), { detail: 1 })
        expect(state.onCancel).toHaveBeenCalledOnce()
      })

      // 狭いウィンドウでは 2 回目が送信・キャンセルの上に落ちる(AGT-172)。キーボードの click は detail が 0
      it('連続のクリックの 2 回目(detail: 2)の送信・キャンセルの click では送らず・閉じない。detail: 0(キーボード)・1 では動く', () => {
        const state = makeState()
        render(<AgentSendConfirmDialog state={state} />)
        fireEvent.click(submitButton(), { detail: 2 })
        fireEvent.click(cancelButton(), { detail: 2 })
        expect(state.onConfirm).not.toHaveBeenCalled()
        expect(state.onCancel).not.toHaveBeenCalled()
        fireEvent.click(submitButton(), { detail: 0 })
        expect(state.onConfirm).toHaveBeenCalledTimes(1)
        fireEvent.click(submitButton(), { detail: 1 })
        expect(state.onConfirm).toHaveBeenCalledTimes(2)
        fireEvent.click(cancelButton(), { detail: 0 })
        expect(state.onCancel).toHaveBeenCalledTimes(1)
        fireEvent.click(cancelButton(), { detail: 1 })
        expect(state.onCancel).toHaveBeenCalledTimes(2)
      })

      it('背景で押してダイアログの中で離しても閉じず、続けて Esc で閉じられる(AGT-154)', async () => {
        const state = makeState()
        render(<AgentSendConfirmDialog state={state} />)
        await userEvent.pointer([
          { keys: '[MouseLeft>]', target: getOverlay() },
          { keys: '[/MouseLeft]', target: screen.getByRole('region', { name: '送る内容' }) }
        ])
        expect(state.onCancel).not.toHaveBeenCalled()
        expect(submitButton()).toHaveFocus()
        await userEvent.keyboard('{Escape}')
        expect(state.onCancel).toHaveBeenCalledOnce()
      })
    })
  })

  describe('フォーカス', () => {
    it('開いたら送信にフォーカスを置く', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(submitButton()).toHaveFocus()
    })

    it('開いた時点で送信を押せなければ、キャンセルにフォーカスを置く', () => {
      render(
        <AgentSendConfirmDialog state={makeState({ pending: makePending({ text: '!ls' }) })} />
      )
      expect(cancelButton()).toHaveFocus()
    })

    it('開いている間に送信を押せなくなったら、送信にあったフォーカスをキャンセルへ移す', () => {
      const { rerender } = render(<AgentSendConfirmDialog state={makeState()} />)
      expect(submitButton()).toHaveFocus()
      rerender(
        <AgentSendConfirmDialog
          state={makeState({ targetBlockedReason: RUN_DISABLED_NO_SESSION })}
        />
      )
      expect(cancelButton()).toHaveFocus()
    })

    it('Tab・Shift+Tab は本文・送信・キャンセルの間を回り、背後へ出ない', async () => {
      render(<Harness state={makeState()} />)
      const body = screen.getByRole('region', { name: '送る内容' })
      expect(submitButton()).toHaveFocus()
      await userEvent.tab()
      expect(cancelButton()).toHaveFocus()
      await userEvent.tab()
      expect(body).toHaveFocus()
      await userEvent.tab()
      expect(submitButton()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(body).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(cancelButton()).toHaveFocus()
    })

    it('キャンセルで閉じたら、開いた時点の要素へ戻す', async () => {
      const closed = makeState({ pending: null })
      const { rerender } = render(<Harness state={closed} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      const open = makeState()
      rerender(<Harness state={open} />)
      expect(submitButton()).toHaveFocus()
      await userEvent.click(cancelButton())
      expect(open.onCancel).toHaveBeenCalledOnce()
      expect(opener).toHaveFocus()
    })

    it('Esc で閉じたときも、開いた時点の要素へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      rerender(<Harness state={makeState()} />)
      await userEvent.keyboard('{Escape}')
      expect(opener).toHaveFocus()
    })

    it('開いた時点の要素が外れていたら(変数のフォームの実行から開いた)、同じプロンプトの一覧の実行へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      screen.getByRole('button', { name: '開いた元' }).focus()
      // 変数のフォームは確認を開くのと同じ描画で閉じる
      rerender(<Harness state={makeState()} showOpener={false} />)
      await userEvent.click(cancelButton())
      expect(screen.getByRole('button', { name: '一覧の実行' })).toHaveFocus()
    })

    it('開いた時点の要素が disabled になっていたら、同じプロンプトの一覧の実行へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      screen.getByRole('button', { name: '開いた元' }).focus()
      rerender(<Harness state={makeState()} />)
      rerender(<Harness state={makeState()} openerDisabled />)
      await userEvent.click(cancelButton())
      expect(screen.getByRole('button', { name: '一覧の実行' })).toHaveFocus()
    })

    it('開いた時点の要素が見えていなければ(checkVisibility が false)、同じプロンプトの一覧の実行へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      rerender(<Harness state={makeState()} />)
      Object.defineProperty(opener, 'checkVisibility', { value: () => false })
      await userEvent.click(cancelButton())
      expect(opener).not.toHaveFocus()
      expect(screen.getByRole('button', { name: '一覧の実行' })).toHaveFocus()
    })

    it('戻り先がどちらも無ければフォーカスを動かさず、閉じる依頼だけを出す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      screen.getByRole('button', { name: '開いた元' }).focus()
      const open = makeState()
      rerender(<Harness state={open} showOpener={false} showRunButton={false} />)
      await userEvent.click(cancelButton())
      expect(open.onCancel).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: 'ほかのプロンプトの実行' })).not.toHaveFocus()
    })

    it('送信で閉じるときは、開いた時点の要素へ戻さない(送り先のターミナルへ移すのは呼び出し側)', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      rerender(<Harness state={makeState()} />)
      await userEvent.click(submitButton())
      expect(opener).not.toHaveFocus()
    })
  })

  it('ウィンドウが低くてもダイアログの中をスクロールして送信・キャンセルへ届く(ダイアログが overflow-y: auto、本文は中身 3 行分の min-height: 6em〈border-box のため padding と枠を含む〉)', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(getComputedStyle(getDialog()).overflowY).toBe('auto')
      const body = screen.getByText('このフォルダのファイルを一覧して')
      expect(getComputedStyle(body).minHeight).toBe('6em')
    } finally {
      style.remove()
    }
  })

  it('送信・キャンセルはタッチで押せる 32px 以上の高さ', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(getComputedStyle(submitButton()).minHeight).toBe('32px')
      expect(getComputedStyle(cancelButton()).minHeight).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
