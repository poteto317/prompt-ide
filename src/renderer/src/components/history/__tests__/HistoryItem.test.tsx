import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistoryItem from '../HistoryItem'
import type { HistoryEntry } from '../../../types'

const successEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'テストタイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'claude',
  status: 'success',
  resultText: '成功結果テキスト',
  errorMessage: null,
  executedAt: new Date('2024-01-01T00:00:00').getTime()
}

const errorEntry: HistoryEntry = {
  ...successEntry,
  id: 'h2',
  status: 'error',
  resultText: null,
  errorMessage: 'エラーメッセージ'
}

describe('HistoryItem', () => {
  it('タイトル・ツール名・成功バッジ・プレビューを表示する', () => {
    render(<HistoryItem entry={successEntry} isSelected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.getByText('Claude CLI')).toBeInTheDocument()
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('成功結果テキスト')).toBeInTheDocument()
  })

  it('エラー時はエラーバッジとエラーメッセージのプレビューを表示する', () => {
    render(<HistoryItem entry={errorEntry} isSelected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('エラー')).toBeInTheDocument()
    expect(screen.getByText('エラーメッセージ')).toBeInTheDocument()
  })

  it('クリックで onSelect が呼ばれる', async () => {
    const onSelect = vi.fn()
    render(<HistoryItem entry={successEntry} isSelected={false} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('isSelected のとき aria-pressed が true になる', () => {
    render(<HistoryItem entry={successEntry} isSelected={true} onSelect={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('未知の toolId のとき生の toolId をそのまま表示する', () => {
    const entry: HistoryEntry = { ...successEntry, toolId: 'unknown-tool' as never }
    render(<HistoryItem entry={entry} isSelected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('unknown-tool')).toBeInTheDocument()
  })

  it('実行日時が整形されて表示される', () => {
    render(<HistoryItem entry={successEntry} isSelected={false} onSelect={vi.fn()} />)
    expect(
      screen.getByText(new Date(successEntry.executedAt).toLocaleString())
    ).toBeInTheDocument()
  })

  it('resultText・errorMessage が両方 null のときプレビューは空になる', () => {
    const entry: HistoryEntry = { ...successEntry, resultText: null, errorMessage: null }
    const { container } = render(<HistoryItem entry={entry} isSelected={false} onSelect={vi.fn()} />)
    expect(container.querySelector('.history-item__preview')).toHaveTextContent('')
  })
})
