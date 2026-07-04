import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistoryDetail from '../HistoryDetail'
import type { HistoryEntry } from '../../../types'

const successEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'テストタイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'copilot',
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
  errorMessage: 'エラーメッセージ本文'
}

const defaultProps = {
  entry: successEntry,
  onRerun: vi.fn(),
  onDelete: vi.fn(),
  isRerunDisabled: false
}

describe('HistoryDetail', () => {
  it('タイトル・ツール名を表示する', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.getByText('GitHub Copilot')).toBeInTheDocument()
  })

  it('成功時は結果テキストを表示する', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.getByText('成功結果テキスト')).toBeInTheDocument()
  })

  it('エラー時はエラーメッセージを表示する', () => {
    render(<HistoryDetail {...defaultProps} entry={errorEntry} />)
    expect(screen.getByText('エラーメッセージ本文')).toBeInTheDocument()
  })

  it('再実行ボタンで onRerun が entry とともに呼ばれる', async () => {
    const onRerun = vi.fn()
    render(<HistoryDetail {...defaultProps} onRerun={onRerun} />)
    await userEvent.click(screen.getByRole('button', { name: '再実行' }))
    expect(onRerun).toHaveBeenCalledWith(successEntry)
  })

  it('isRerunDisabled のとき再実行ボタンが無効化される', () => {
    render(<HistoryDetail {...defaultProps} isRerunDisabled={true} />)
    expect(screen.getByRole('button', { name: '再実行' })).toBeDisabled()
  })

  it('削除ボタンで onDelete が id とともに呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<HistoryDetail {...defaultProps} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'この履歴を削除' }))
    expect(onDelete).toHaveBeenCalledWith('h1')
  })

  it('実行日時が整形されて表示される', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.getByText(new Date(successEntry.executedAt).toLocaleString())).toBeInTheDocument()
  })

  it('status が success でも resultText が null のときコンテンツ領域は空でクラッシュしない', () => {
    const entry: HistoryEntry = { ...successEntry, resultText: null }
    const { container } = render(<HistoryDetail {...defaultProps} entry={entry} />)
    expect(container.querySelector('.history-detail__content')).toBeEmptyDOMElement()
  })

  it('status が error でも errorMessage が null のときコンテンツ領域は空でクラッシュしない', () => {
    const entry: HistoryEntry = { ...errorEntry, errorMessage: null }
    const { container } = render(<HistoryDetail {...defaultProps} entry={entry} />)
    expect(container.querySelector('.history-detail__content')).toBeEmptyDOMElement()
  })
})
