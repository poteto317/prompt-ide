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
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

const getTrigger = (): HTMLElement => screen.getByRole('button')
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
      expect(screen.getByRole('button', { hidden: true })).toHaveAttribute('aria-expanded', 'true')
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
    const renderWithPendingOperation = (): { finish: () => void } => {
      let finishOperation = (): void => {}
      function Harness(): React.JSX.Element {
        const [pending, setPending] = useState<BranchOperationKind | null>(null)
        const state = makeState({
          pendingBranchOperation: pending,
          onCheckoutBranch: async () => {
            setPending('checkout')
            finishOperation = () => setPending(null)
          }
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

    it('error が消えれば表示も消える', () => {
      const state = makeState({ error: new Error('失敗') })
      const { rerender } = render(<StatusBarBranch state={state} />)
      rerender(<StatusBarBranch state={{ ...state, error: null }} />)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
