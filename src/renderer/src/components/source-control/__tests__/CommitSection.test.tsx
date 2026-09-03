import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CommitSection from '../CommitSection'

describe('CommitSection', () => {
  it('メッセージ入力欄とコミットボタンを表示する', () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
  })

  it('メッセージが空のときコミットボタンは無効', () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージが空白のみのときコミットボタンは無効', async () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), '   ')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('stagedCount が 0 のときコミットボタンは無効', async () => {
    render(<CommitSection stagedCount={0} isCommitting={false} onCommit={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージ入力済み・ステージあり・実行中でないときコミットボタンは有効', async () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
  })

  it('コミットボタンをクリックすると onCommit がメッセージで呼ばれる', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={onCommit} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(onCommit).toHaveBeenCalledWith('feat: 新機能')
  })

  it('コミット成功時にメッセージ入力欄をクリアする', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={onCommit} />)
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('')
  })

  it('コミット失敗時はメッセージ入力欄を保持する', async () => {
    const onCommit = vi.fn().mockResolvedValue(false)
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={onCommit} />)
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('feat: 新機能')
  })

  it('isCommitting が true のときコミットボタンは無効かつ実行中表示', async () => {
    render(<CommitSection stagedCount={1} isCommitting={true} onCommit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /コミット/ })).toBeDisabled()
  })
})
