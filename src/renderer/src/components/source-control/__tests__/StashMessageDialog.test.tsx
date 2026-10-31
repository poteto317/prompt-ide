import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StashMessageDialog from '../StashMessageDialog'

describe('StashMessageDialog', () => {
  it('メッセージを入力して OK すると、trim 済みのメッセージで onSubmit を呼ぶ', async () => {
    const onSubmit = vi.fn()
    render(<StashMessageDialog onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox'), '  wip  ')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith('wip')
  })

  it('入力欄のアクセシブルネームは「stash のメッセージ」', () => {
    render(<StashMessageDialog onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'stash のメッセージ' })).toBeInTheDocument()
  })

  // メッセージは任意。空のまま OK できる(NameInputDialog の既定の「空は不可」を使わない)
  it('空のまま OK すると、空文字で onSubmit を呼ぶ', async () => {
    const onSubmit = vi.fn()
    render(<StashMessageDialog onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith('')
  })

  it('NUL を含むメッセージは onSubmit を呼ばずにエラーを出す', async () => {
    const onSubmit = vi.fn()
    render(<StashMessageDialog onSubmit={onSubmit} onCancel={vi.fn()} />)
    // user-event は NUL を入力できないため、input の値を直接設定する
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a\u0000b' } })
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'メッセージに使用できない文字が含まれています'
    )
  })

  it('キャンセルで onCancel を呼ぶ', async () => {
    const onCancel = vi.fn()
    render(<StashMessageDialog onSubmit={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('ダイアログのタイトルは「stash のメッセージ（任意）」', () => {
    render(<StashMessageDialog onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'stash のメッセージ（任意）' })).toBeInTheDocument()
  })
})
