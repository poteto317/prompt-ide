import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StatusBarBranch from '../StatusBarBranch'
import type { StatusBarBranchState } from '../StatusBarBranch'
import type { BranchOperationKind } from '../../types'

const makeState = (overrides: Partial<StatusBarBranchState> = {}): StatusBarBranchState => ({
  currentBranch: 'feature/login',
  branches: [
    { name: 'feature/login', current: true },
    { name: 'develop', current: false }
  ],
  pendingBranchOperation: null,
  isBlocked: false,
  error: null,
  remoteError: null,
  ahead: 0,
  behind: 0,
  isSyncing: false,
  isSyncBlocked: false,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onSync: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

const getTrigger = (): HTMLElement => screen.getByRole('button')
const getBranchButton = (): HTMLElement => screen.getByRole('button', { name: /ブランチ/ })
const getSyncButton = (): HTMLElement => screen.getByRole('button', { name: /^変更を同期/ })
const querySyncButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: /^変更を同期/ })
const queryCreateDialog = (): HTMLElement | null =>
  screen.queryByRole('dialog', { name: '新しいブランチ名' })
const CREATE_LABEL = '＋ 新しいブランチを作成…'
const openCreateDialog = async (): Promise<void> => {
  await userEvent.click(getTrigger())
  await userEvent.click(screen.getByRole('option', { name: CREATE_LABEL }))
}
const queryOverlay = (): HTMLElement | null => screen.queryByTestId('branch-picker-overlay')

describe('StatusBarBranch', () => {
  describe('ボタンの表示', () => {
    it('渡された現在のブランチ名を出す', () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(getTrigger()).toHaveTextContent('feature/login')
      expect(getTrigger().querySelector('svg')).not.toBeNull()
    })

    it('detached(currentBranch が null)なら (no branch) と出す', () => {
      render(<StatusBarBranch state={makeState({ currentBranch: null })} />)
      expect(getTrigger()).toHaveTextContent('(no branch)')
    })

    it('一覧を開くボタンとしての ARIA を持つ', () => {
      render(<StatusBarBranch state={makeState()} />)
      const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
      expect(trigger).toHaveAttribute('type', 'button')
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('ブランチ操作の実行中は文言を変えて押せなくする', () => {
      render(<StatusBarBranch state={makeState({ pendingBranchOperation: 'checkout' })} />)
      const trigger = screen.getByRole('button', { name: 'ブランチ切り替え中' })
      expect(trigger).toHaveTextContent('切り替え中...')
      expect(trigger).toBeDisabled()
    })

    it.each([
      ['create', '作成中...', 'ブランチ作成中'],
      ['delete', '削除中...', 'ブランチ削除中'],
      ['merge', 'マージ中...', 'ブランチのマージ中']
    ] as const)('%s の実行中も文言と aria-label を変えて押せなくする', (kind, text, name) => {
      render(<StatusBarBranch state={makeState({ pendingBranchOperation: kind })} />)
      const trigger = screen.getByRole('button', { name })
      expect(trigger).toHaveTextContent(text)
      expect(trigger).toBeDisabled()
    })

    it('他の操作中は、ブランチ名を出したまま押せなくし、理由を aria-label で伝える', () => {
      render(<StatusBarBranch state={makeState({ isBlocked: true })} />)
      const trigger = screen.getByRole('button', {
        name: '他の操作が完了するまでブランチを切り替えられません'
      })
      expect(trigger).toHaveTextContent('feature/login')
      expect(trigger).toBeDisabled()
    })
  })

  describe('一覧の開閉', () => {
    it('押すと一覧を開き、aria-expanded が true になる', async () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(queryOverlay()).not.toBeInTheDocument()
      await userEvent.click(getTrigger())
      expect(queryOverlay()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    })

    it('押せない状態では開かない', async () => {
      render(<StatusBarBranch state={makeState({ isBlocked: true })} />)
      await userEvent.click(getTrigger())
      expect(queryOverlay()).not.toBeInTheDocument()
    })

    it('別のブランチを確定すると、閉じて onCheckoutBranch を呼ぶ', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      await userEvent.click(screen.getByRole('option', { name: 'develop' }))
      expect(state.onCheckoutBranch).toHaveBeenCalledTimes(1)
      expect(state.onCheckoutBranch).toHaveBeenCalledWith('develop')
      expect(queryOverlay()).not.toBeInTheDocument()
    })

    it('現在のブランチを確定すると、切り替えずに閉じてボタンへフォーカスを戻す', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      await userEvent.click(screen.getByRole('option', { name: /feature\/login/ }))
      expect(state.onCheckoutBranch).not.toHaveBeenCalled()
      expect(queryOverlay()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('Escape で閉じるとボタンへフォーカスを戻す', async () => {
      render(<StatusBarBranch state={makeState()} />)
      await userEvent.click(getTrigger())
      await userEvent.keyboard('{Escape}')
      expect(queryOverlay()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('オーバーレイのクリックで閉じるとボタンへフォーカスを戻す', async () => {
      render(<StatusBarBranch state={makeState()} />)
      await userEvent.click(getTrigger())
      const overlay = screen.getByTestId('branch-picker-overlay')
      fireEvent.mouseDown(overlay)
      fireEvent.click(overlay)
      expect(queryOverlay()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('開いている間に押せない状態になると、一覧の確定を無視する', async () => {
      const state = makeState()
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      rerender(<StatusBarBranch state={{ ...state, isBlocked: true }} />)
      expect(screen.getByRole('status')).toHaveTextContent(
        '他の操作が完了するまで切り替えられません'
      )
      await userEvent.click(screen.getByRole('option', { name: 'develop' }))
      expect(state.onCheckoutBranch).not.toHaveBeenCalled()
    })
  })

  describe('切り替えの後のフォーカス', () => {
    // 実物と同じく、確定と同じ描画で実行中になる形にする。rerender で後から実行中にすると、
    // 確定の時点では押せるままなのでフォーカスがすぐ戻り、実行中の待ちを確かめられない
    const renderWithPendingOperation = (
      kind: BranchOperationKind = 'checkout'
    ): { finish: () => void } => {
      let finishOperation = (): void => {}
      function Harness(): React.JSX.Element {
        const [pending, setPending] = useState<BranchOperationKind | null>(null)
        const start = async (): Promise<void> => {
          setPending(kind)
          finishOperation = () => setPending(null)
        }
        const state = makeState({
          pendingBranchOperation: pending,
          onCheckoutBranch: start,
          onCreateBranch: async () => {
            await start()
            return true
          },
          onDeleteBranch: async () => {
            await start()
            return true
          },
          onMergeBranch: start
        })
        return <StatusBarBranch state={state} />
      }
      render(<Harness />)
      return { finish: () => act(() => finishOperation()) }
    }

    it('実行が解けた後にボタンへフォーカスを戻す', async () => {
      const { finish } = renderWithPendingOperation()
      await userEvent.click(getTrigger())
      await userEvent.click(screen.getByRole('option', { name: 'develop' }))

      // 実行中はボタンが disabled のため、フォーカスの行き場が無い
      expect(getTrigger()).toBeDisabled()
      expect(document.activeElement).toBe(document.body)

      finish()
      expect(getTrigger()).toBeEnabled()
      expect(document.activeElement).toBe(getTrigger())
    })

    it.each([
      ['merge', 'ブランチ develop を現在のブランチにマージ'],
      ['delete', 'ブランチ develop を削除']
    ] as const)('%s のボタンの実行が解けた後にボタンへフォーカスを戻す', async (kind, name) => {
      const { finish } = renderWithPendingOperation(kind)
      await userEvent.click(getTrigger())
      await userEvent.click(screen.getByRole('button', { name }))

      expect(queryOverlay()).not.toBeInTheDocument()
      expect(getTrigger()).toBeDisabled()
      expect(document.activeElement).toBe(document.body)

      finish()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('作成の実行が解けた後にボタンへフォーカスを戻す', async () => {
      const { finish } = renderWithPendingOperation('create')
      await openCreateDialog()
      await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/new')
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))

      expect(queryCreateDialog()).not.toBeInTheDocument()
      expect(getTrigger()).toBeDisabled()
      expect(document.activeElement).toBe(document.body)

      finish()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('実行中に利用者が移したフォーカスは奪わない', async () => {
      const { finish } = renderWithPendingOperation('merge')
      await userEvent.click(getTrigger())
      await userEvent.click(
        screen.getByRole('button', { name: 'ブランチ develop を現在のブランチにマージ' })
      )
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()
      finish()
      expect(document.activeElement).toBe(outside)
      outside.remove()
    })
  })

  describe('ブランチの作成', () => {
    it('絞り込みの文字をダイアログの初期値に引き継ぐ(候補が 0 件の Enter)', async () => {
      render(<StatusBarBranch state={makeState()} />)
      await userEvent.click(getTrigger())
      await userEvent.keyboard('  feature/new  {Enter}')
      expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('feature/new')
      expect(queryOverlay()).not.toBeInTheDocument()
    })

    it('前回の絞り込みの文字を、次に開いたダイアログへ持ち越さない', async () => {
      render(<StatusBarBranch state={makeState()} />)
      await userEvent.click(getTrigger())
      await userEvent.keyboard('feature/new{Enter}')
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      await openCreateDialog()
      expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('')
    })

    it('作成の項目を押すと、一覧を閉じてダイアログを開く', async () => {
      render(<StatusBarBranch state={makeState()} />)
      await openCreateDialog()
      expect(queryOverlay()).not.toBeInTheDocument()
      expect(queryCreateDialog()).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: '名前' })).toHaveFocus()
    })

    it('Enter で作成の項目を確定してもダイアログを開く', async () => {
      render(<StatusBarBranch state={makeState()} />)
      await userEvent.click(getTrigger())
      await userEvent.keyboard('{ArrowUp}{ArrowUp}{Enter}')
      expect(queryCreateDialog()).toBeInTheDocument()
    })

    it('ダブルクリックの 2 回目がダイアログのオーバーレイに落ちても閉じない', async () => {
      const { container } = render(<StatusBarBranch state={makeState()} />)
      await openCreateDialog()
      const overlay = container.querySelector('.name-input-dialog__overlay') as HTMLElement
      fireEvent.click(overlay, { detail: 2 })
      expect(queryCreateDialog()).toBeInTheDocument()
    })

    it('名前を入力して OK を押すと、閉じて onCreateBranch を呼び、ボタンへフォーカスを戻す', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await openCreateDialog()
      await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/new')
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(state.onCreateBranch).toHaveBeenCalledTimes(1)
      expect(state.onCreateBranch).toHaveBeenCalledWith('feature/new')
      expect(queryCreateDialog()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('既存のブランチ名はダイアログの中でエラーになり、onCreateBranch を呼ばない', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await openCreateDialog()
      await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'develop')
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
      expect(state.onCreateBranch).not.toHaveBeenCalled()
    })

    it.each([
      [
        'キャンセルのボタン',
        async (): Promise<void> => {
          await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
        }
      ],
      [
        'Escape',
        async (): Promise<void> => {
          await userEvent.keyboard('{Escape}')
        }
      ],
      [
        'オーバーレイのクリック',
        async (): Promise<void> => {
          fireEvent.click(document.querySelector('.name-input-dialog__overlay') as HTMLElement)
        }
      ]
    ])('%s で閉じるとボタンへフォーカスを戻し、作成しない', async (_label, close) => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await openCreateDialog()
      await close()
      expect(queryCreateDialog()).not.toBeInTheDocument()
      expect(state.onCreateBranch).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('開いている間に押せない状態になると、OK を押せなくして案内を出す', async () => {
      const state = makeState()
      const { rerender } = render(<StatusBarBranch state={state} />)
      await openCreateDialog()
      rerender(<StatusBarBranch state={{ ...state, isBlocked: true }} />)
      expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent('他の操作が完了するまで実行できません')
    })

    it('ブランチ操作の実行中も OK を押せない', async () => {
      const state = makeState()
      const { rerender } = render(<StatusBarBranch state={state} />)
      await openCreateDialog()
      rerender(<StatusBarBranch state={{ ...state, pendingBranchOperation: 'checkout' }} />)
      expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    })

    it('押せない状態のまま閉じても、解けた後にボタンへフォーカスを戻す', async () => {
      const state = makeState()
      const { rerender } = render(<StatusBarBranch state={state} />)
      await openCreateDialog()
      rerender(<StatusBarBranch state={{ ...state, isBlocked: true }} />)
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(document.activeElement).toBe(document.body)
      rerender(<StatusBarBranch state={state} />)
      expect(document.activeElement).toBe(getTrigger())
    })
  })

  describe('マージと削除', () => {
    it('マージのボタンは、閉じて onMergeBranch を呼び、ボタンへフォーカスを戻す', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      await userEvent.click(
        screen.getByRole('button', { name: 'ブランチ develop を現在のブランチにマージ' })
      )
      expect(state.onMergeBranch).toHaveBeenCalledTimes(1)
      expect(state.onMergeBranch).toHaveBeenCalledWith('develop')
      expect(state.onCheckoutBranch).not.toHaveBeenCalled()
      expect(queryOverlay()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('削除のボタンは、閉じて onDeleteBranch を呼び、ボタンへフォーカスを戻す', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      await userEvent.click(screen.getByRole('button', { name: 'ブランチ develop を削除' }))
      expect(state.onDeleteBranch).toHaveBeenCalledTimes(1)
      expect(state.onDeleteBranch).toHaveBeenCalledWith('develop')
      expect(state.onCheckoutBranch).not.toHaveBeenCalled()
      expect(queryOverlay()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getTrigger())
    })

    it('Alt+M で選択中の行をマージする', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'µ', code: 'KeyM', altKey: true })
      expect(state.onMergeBranch).toHaveBeenCalledWith('develop')
      expect(queryOverlay()).not.toBeInTheDocument()
    })

    it('Shift+Delete で選択中の行を削除する', async () => {
      const state = makeState()
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Delete', shiftKey: true })
      expect(state.onDeleteBranch).toHaveBeenCalledWith('develop')
      expect(queryOverlay()).not.toBeInTheDocument()
    })

    it('開いている間に押せない状態になると、マージも削除も実行しない', async () => {
      const state = makeState()
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getTrigger())
      rerender(<StatusBarBranch state={{ ...state, isBlocked: true }} />)
      await userEvent.click(
        screen.getByRole('button', { name: 'ブランチ develop を現在のブランチにマージ' })
      )
      await userEvent.click(screen.getByRole('button', { name: 'ブランチ develop を削除' }))
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Delete', shiftKey: true })
      expect(state.onMergeBranch).not.toHaveBeenCalled()
      expect(state.onDeleteBranch).not.toHaveBeenCalled()
      expect(queryOverlay()).toBeInTheDocument()
    })
  })

  describe('同期のボタン', () => {
    // 完了を待たせる onSync。押した後の描画の順序をテストが決める
    const deferredSync = (): { onSync: () => Promise<void>; resolve: () => Promise<void> } => {
      let resolveSync = (): void => {}
      const onSync = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSync = resolve
          })
      )
      return {
        onSync,
        resolve: async () => {
          await act(async () => resolveSync())
        }
      }
    }

    // 実行中はボタンが disabled になり、ブラウザはフォーカスを body へ落とす(jsdom は落とさない)
    const dropFocusToBody = (): void => act(() => (document.activeElement as HTMLElement).blur())

    it('ahead も behind も 0 なら出さない', () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(querySyncButton()).not.toBeInTheDocument()
    })

    it.each([
      [1, 0, '↑1'],
      [0, 2, '↓2'],
      [3, 2, '↓2 ↑3']
    ])('ahead %i・behind %i なら %s と出す', (ahead, behind, text) => {
      render(<StatusBarBranch state={makeState({ ahead, behind })} />)
      expect(getSyncButton()).toHaveTextContent(new RegExp(`^${text}$`))
    })

    it('aria-label はコミット欄の主ボタンと同じ', () => {
      render(<StatusBarBranch state={makeState({ ahead: 3, behind: 2 })} />)
      expect(getSyncButton()).toHaveAccessibleName('変更を同期(プル 2 件、プッシュ 3 件)')
    })

    it('ブランチの項目の右に置く', () => {
      render(<StatusBarBranch state={makeState({ ahead: 1 })} />)
      expect(getBranchButton().nextElementSibling).toBe(getSyncButton())
    })

    it('押すと onSync を 1 回呼ぶ', async () => {
      const state = makeState({ ahead: 1 })
      render(<StatusBarBranch state={state} />)
      await userEvent.click(getSyncButton())
      expect(state.onSync).toHaveBeenCalledTimes(1)
    })

    it('ダブルクリックの 2 回目(detail: 2)は無視する', () => {
      const state = makeState({ ahead: 1 })
      render(<StatusBarBranch state={state} />)
      fireEvent.click(getSyncButton(), { detail: 2 })
      expect(state.onSync).not.toHaveBeenCalled()
    })

    it('キーボードの click(detail: 0)は実行する', () => {
      const state = makeState({ ahead: 1 })
      render(<StatusBarBranch state={state} />)
      fireEvent.click(getSyncButton(), { detail: 0 })
      expect(state.onSync).toHaveBeenCalledTimes(1)
    })

    it('Enter のリピートは既定の動作を止める', () => {
      render(<StatusBarBranch state={makeState({ ahead: 1 })} />)
      expect(fireEvent.keyDown(getSyncButton(), { key: 'Enter', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(getSyncButton(), { key: 'Enter' })).toBe(true)
    })

    it('実行中は押せない', () => {
      render(<StatusBarBranch state={makeState({ ahead: 1, isSyncing: true })} />)
      expect(getSyncButton()).toBeDisabled()
    })

    it('isSyncBlocked の間は押せない', () => {
      render(<StatusBarBranch state={makeState({ ahead: 1, isSyncBlocked: true })} />)
      expect(getSyncButton()).toBeDisabled()
    })

    it('完了後にボタンが残っていてフォーカスが body なら、同期のボタンへ移す', async () => {
      const { onSync, resolve } = deferredSync()
      const state = makeState({ ahead: 1, behind: 1, onSync })
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getSyncButton())
      rerender(<StatusBarBranch state={{ ...state, isSyncing: true }} />)
      dropFocusToBody()
      rerender(<StatusBarBranch state={state} />)
      await resolve()
      expect(document.activeElement).toBe(getSyncButton())
    })

    it('完了後にボタンが消えていたら、ブランチの項目へ移す', async () => {
      const { onSync, resolve } = deferredSync()
      const state = makeState({ ahead: 1, onSync })
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getSyncButton())
      rerender(<StatusBarBranch state={{ ...state, isSyncing: true }} />)
      dropFocusToBody()
      rerender(<StatusBarBranch state={{ ...state, ahead: 0 }} />)
      await resolve()
      expect(querySyncButton()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getBranchButton())
    })

    it('ボタンが押せない状態で残ったら(コンフリクトなど)、ブランチの項目へ移す', async () => {
      const { onSync, resolve } = deferredSync()
      const state = makeState({ ahead: 1, behind: 1, onSync })
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getSyncButton())
      dropFocusToBody()
      rerender(<StatusBarBranch state={{ ...state, isSyncBlocked: true }} />)
      await resolve()
      expect(document.activeElement).toBe(getBranchButton())
    })

    it('移し先が押せるようになるまで待つ', async () => {
      const { onSync, resolve } = deferredSync()
      const state = makeState({ ahead: 1, onSync })
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getSyncButton())
      dropFocusToBody()
      rerender(<StatusBarBranch state={{ ...state, ahead: 0, isBlocked: true }} />)
      await resolve()
      expect(document.activeElement).toBe(document.body)
      rerender(<StatusBarBranch state={{ ...state, ahead: 0 }} />)
      expect(document.activeElement).toBe(getBranchButton())
    })

    it('完了の時点でフォーカスが body でなければ奪わない', async () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      const { onSync, resolve } = deferredSync()
      render(<StatusBarBranch state={makeState({ ahead: 1, onSync })} />)
      await userEvent.click(getSyncButton())
      outside.focus()
      await resolve()
      expect(document.activeElement).toBe(outside)
      outside.remove()
    })

    it('別の場所から始めた同期の完了ではフォーカスを動かさない', () => {
      const state = makeState({ ahead: 1, isSyncing: true })
      const { rerender } = render(<StatusBarBranch state={state} />)
      expect(document.activeElement).toBe(document.body)
      rerender(<StatusBarBranch state={{ ...state, isSyncing: false }} />)
      expect(document.activeElement).toBe(document.body)
    })

    it('同期の完了の後は、別の同期の完了でフォーカスを動かさない(予約を持ち越さない)', async () => {
      const { onSync, resolve } = deferredSync()
      const state = makeState({ ahead: 1, onSync })
      const { rerender } = render(<StatusBarBranch state={state} />)
      await userEvent.click(getSyncButton())
      await resolve()
      dropFocusToBody()
      rerender(<StatusBarBranch state={{ ...state, isSyncing: true }} />)
      rerender(<StatusBarBranch state={state} />)
      expect(document.activeElement).toBe(document.body)
    })
  })

  describe('Enter のキーリピート', () => {
    // jsdom は keydown から click を合成しないため、fireEvent.keyDown の戻り値(既定の動作を許すか)で固定する
    it('リピートの Enter は既定の動作を止める', () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(fireEvent.keyDown(getTrigger(), { key: 'Enter', repeat: true })).toBe(false)
    })

    it('リピートでない Enter は止めない', () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(fireEvent.keyDown(getTrigger(), { key: 'Enter' })).toBe(true)
    })

    it('リピートの Space は止めない(keyup で押すため対象外)', () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(fireEvent.keyDown(getTrigger(), { key: ' ', repeat: true })).toBe(true)
    })
  })

  describe('失敗の表示', () => {
    it('error が無ければ出さない', () => {
      render(<StatusBarBranch state={makeState()} />)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('error があれば、ボタンの右に role="alert" でメッセージを出し、全文を title に入れる', () => {
      const message = 'ブランチを切り替えられませんでした: 未コミットの変更があります'
      render(<StatusBarBranch state={makeState({ error: new Error(message) })} />)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(alert).toHaveAttribute('title', message)
      expect(getTrigger().nextElementSibling).toBe(alert)
    })

    it('remoteError があれば、同じ形で出す', () => {
      const message = 'プッシュできませんでした'
      render(<StatusBarBranch state={makeState({ remoteError: new Error(message) })} />)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(alert).toHaveAttribute('title', message)
    })

    it('error と remoteError が両方あれば、別の項目として両方出す', () => {
      render(
        <StatusBarBranch
          state={makeState({
            error: new Error('切り替えの失敗'),
            remoteError: new Error('同期の失敗')
          })}
        />
      )
      const alerts = screen.getAllByRole('alert')
      expect(alerts.map((alert) => alert.textContent)).toEqual(['切り替えの失敗', '同期の失敗'])
      expect(alerts[0]).toHaveClass('status-bar__item')
      expect(alerts[1]).toHaveClass('status-bar__item')
    })

    it('失敗は同期のボタンの右に出す', () => {
      render(<StatusBarBranch state={makeState({ ahead: 1, remoteError: new Error('失敗') })} />)
      expect(getSyncButton().nextElementSibling).toBe(screen.getByRole('alert'))
    })

    it('error が消えれば表示も消える', () => {
      const state = makeState({ error: new Error('失敗') })
      const { rerender } = render(<StatusBarBranch state={state} />)
      rerender(<StatusBarBranch state={{ ...state, error: null }} />)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
