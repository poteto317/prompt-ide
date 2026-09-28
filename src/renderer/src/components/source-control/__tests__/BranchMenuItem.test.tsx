import { render, screen, fireEvent } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import BranchMenuItem from '../BranchMenuItem'

const baseProps = {
  isTabbable: true,
  registerRef: vi.fn(),
  onFocus: vi.fn(),
  onSelect: vi.fn(),
  onDelete: vi.fn()
}

// radiogroup の子として描画される前提のため、テストでも radiogroup で包む
const renderItem = (
  props: Partial<React.ComponentProps<typeof BranchMenuItem>> = {}
): RenderResult =>
  render(
    <div role="radiogroup" aria-label="ブランチ">
      <BranchMenuItem {...baseProps} branch={{ name: 'feature/x', current: false }} {...props} />
    </div>
  )

describe('BranchMenuItem(現在以外のブランチ)', () => {
  it('radio を描画し、クリックで onSelect を branch 名で呼ぶ', async () => {
    const onSelect = vi.fn()
    renderItem({ onSelect })
    const radio = screen.getByRole('radio', { name: 'feature/x' })
    expect(radio).toHaveAttribute('aria-checked', 'false')
    expect(radio).not.toBeDisabled()
    await userEvent.click(radio)
    expect(onSelect).toHaveBeenCalledWith('feature/x')
  })

  it('isTabbable に応じて tabIndex を 0 / -1 にする(roving tabindex)', () => {
    const { unmount } = renderItem({ isTabbable: true })
    expect(screen.getByRole('radio')).toHaveAttribute('tabindex', '0')
    unmount()
    renderItem({ isTabbable: false })
    expect(screen.getByRole('radio')).toHaveAttribute('tabindex', '-1')
  })

  it('削除ボタンを tabIndex=-1 で描画し、クリックで onDelete だけを呼ぶ', async () => {
    const onDelete = vi.fn()
    const onSelect = vi.fn()
    renderItem({ onDelete, onSelect })
    const deleteButton = screen.getByRole('button', { name: 'ブランチ feature/x を削除' })
    expect(deleteButton).toHaveAttribute('tabindex', '-1')
    await userEvent.click(deleteButton)
    expect(onDelete).toHaveBeenCalledWith('feature/x')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('radio 上の Delete キーで onDelete を呼び、既定動作を止める', () => {
    const onDelete = vi.fn()
    renderItem({ onDelete })
    const notCanceled = fireEvent.keyDown(screen.getByRole('radio'), { key: 'Delete' })
    expect(onDelete).toHaveBeenCalledWith('feature/x')
    expect(notCanceled).toBe(false)
  })

  // 矢印キー等は親(radiogroup)の roving フォーカス処理に任せ、ここでは何もしない
  it.each(['ArrowDown', 'Backspace', 'Enter'])('%s キーでは onDelete を呼ばない', (key) => {
    const onDelete = vi.fn()
    renderItem({ onDelete })
    fireEvent.keyDown(screen.getByRole('radio'), { key })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('aria-keyshortcuts="Delete" で削除ショートカットを告知する', () => {
    renderItem()
    expect(screen.getByRole('radio')).toHaveAttribute('aria-keyshortcuts', 'Delete')
  })

  it('フォーカスされたら onFocus を branch 名で呼ぶ', () => {
    const onFocus = vi.fn()
    renderItem({ onFocus })
    fireEvent.focus(screen.getByRole('radio'))
    expect(onFocus).toHaveBeenCalledWith('feature/x')
  })

  it('マウント時に registerRef へ branch 名と radio 要素を渡し、アンマウントで null を渡す', () => {
    const registerRef = vi.fn()
    const { unmount } = renderItem({ registerRef })
    expect(registerRef).toHaveBeenCalledWith('feature/x', screen.getByRole('radio'))
    unmount()
    expect(registerRef).toHaveBeenLastCalledWith('feature/x', null)
  })
})

describe('BranchMenuItem(現在のブランチ)', () => {
  const current = { name: 'main', current: true }

  it('radio は aria-checked=true・disabled で、✓ を付けて表示する', () => {
    renderItem({ branch: current })
    const radio = screen.getByRole('radio', { name: /main/ })
    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(radio).toBeDisabled()
    expect(radio).toHaveTextContent('✓ main')
  })

  it('削除ボタンと aria-keyshortcuts を持たない', () => {
    renderItem({ branch: current })
    expect(screen.queryByRole('button', { name: 'ブランチ main を削除' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio')).not.toHaveAttribute('aria-keyshortcuts')
  })

  // disabled の要素には通常キーイベントが届かないが、万一届いても削除しない
  it('Delete キーのイベントが届いても onDelete を呼ばない', () => {
    const onDelete = vi.fn()
    renderItem({ branch: current, onDelete })
    fireEvent.keyDown(screen.getByRole('radio'), { key: 'Delete' })
    expect(onDelete).not.toHaveBeenCalled()
  })
})
