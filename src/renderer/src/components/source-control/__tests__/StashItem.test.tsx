import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitStashEntry } from '@shared/types'
import StashItem from '../StashItem'

const entry: GitStashEntry = {
  sha: 'a'.repeat(40),
  message: 'fix bug',
  branch: 'main',
  createdAt: '2026-10-01T10:00:00+09:00'
}
const baseProps = { entry, pending: null, isBlocked: false, onPop: vi.fn(), onDrop: vi.fn() }

describe('StashItem', () => {
  it('メッセージとブランチを表示する', () => {
    render(<StashItem {...baseProps} />)
    expect(screen.getByText('fix bug')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('メッセージが空なら (メッセージなし) を表示する', () => {
    render(<StashItem {...baseProps} entry={{ ...entry, message: '' }} />)
    expect(screen.getByText('(メッセージなし)')).toBeInTheDocument()
  })

  it('「戻す」「捨てる」ボタンは aria-label に stash の名前を含む', () => {
    render(<StashItem {...baseProps} />)
    expect(screen.getByRole('button', { name: 'stash fix bug を戻す' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'stash fix bug を捨てる' })).toBeInTheDocument()
  })

  it('「戻す」で onPop を SHA で、「捨てる」で onDrop を stash ごと呼ぶ', async () => {
    const onPop = vi.fn()
    const onDrop = vi.fn()
    render(<StashItem {...baseProps} onPop={onPop} onDrop={onDrop} />)
    await userEvent.click(screen.getByRole('button', { name: 'stash fix bug を戻す' }))
    await userEvent.click(screen.getByRole('button', { name: 'stash fix bug を捨てる' }))
    expect(onPop).toHaveBeenCalledWith(entry.sha)
    expect(onDrop).toHaveBeenCalledWith(entry)
  })

  it('他の操作中(isBlocked)は両方のボタンが disabled', () => {
    render(<StashItem {...baseProps} isBlocked />)
    expect(screen.getByRole('button', { name: 'stash fix bug を戻す' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'stash fix bug を捨てる' })).toBeDisabled()
  })

  // 押したボタンだけ実行中の表示にする(別の行の同じボタンは変えない)
  it('この stash の復元が実行中なら「戻し中...」(aria-label は「stash を戻し中」)で両方 disabled', () => {
    render(<StashItem {...baseProps} pending={{ kind: 'pop', sha: entry.sha }} />)
    const pop = screen.getByRole('button', { name: 'stash を戻し中' })
    expect(pop).toHaveTextContent('戻し中...')
    expect(pop).toBeDisabled()
    expect(screen.getByRole('button', { name: 'stash fix bug を捨てる' })).toBeDisabled()
  })

  it('この stash の削除が実行中なら「削除中...」(aria-label は「stash を削除中」)', () => {
    render(<StashItem {...baseProps} pending={{ kind: 'drop', sha: entry.sha }} />)
    expect(screen.getByRole('button', { name: 'stash を削除中' })).toHaveTextContent('削除中...')
  })

  it('別の stash に対する操作が実行中のとき、この行は通常の表示のまま disabled だけになる', () => {
    render(<StashItem {...baseProps} pending={{ kind: 'pop', sha: 'b'.repeat(40) }} />)
    expect(screen.getByRole('button', { name: 'stash fix bug を戻す' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'stash を戻し中' })).not.toBeInTheDocument()
  })
})
