import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistoryPanel from '../HistoryPanel'
import type { HistoryEntry } from '../../../types'

const entry1: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'タイトル1',
  promptContent: 'プロンプト1',
  fileContent: null,
  toolId: 'claude',
  status: 'success',
  resultText: '結果1',
  errorMessage: null,
  executedAt: 2000
}

const entry2: HistoryEntry = {
  id: 'h2',
  promptId: 'p2',
  promptTitle: 'タイトル2',
  promptContent: 'プロンプト2',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果2',
  errorMessage: null,
  executedAt: 1000
}

const handlers = {
  onDelete: vi.fn(),
  onClear: vi.fn(),
  onRerun: vi.fn()
}

function getDetail(container: HTMLElement) {
  return container.querySelector('.history-detail') as HTMLElement
}

describe('HistoryPanel', () => {
  it('履歴が無ければ空メッセージを表示する', () => {
    render(<HistoryPanel history={[]} {...handlers} />)
    expect(screen.getByText('履歴がありません')).toBeInTheDocument()
  })

  it('履歴一覧を表示する', () => {
    const { container } = render(<HistoryPanel history={[entry1, entry2]} {...handlers} />)
    const list = container.querySelector('.history-panel__list') as HTMLElement
    expect(within(list).getByText('タイトル1')).toBeInTheDocument()
    expect(within(list).getByText('タイトル2')).toBeInTheDocument()
  })

  it('先頭の履歴が初期選択され詳細が表示される', () => {
    const { container } = render(<HistoryPanel history={[entry1, entry2]} {...handlers} />)
    expect(within(getDetail(container)).getByText('結果1')).toBeInTheDocument()
  })

  it('別の履歴をクリックすると詳細が切り替わる', async () => {
    const { container } = render(<HistoryPanel history={[entry1, entry2]} {...handlers} />)
    await userEvent.click(screen.getByText('タイトル2'))
    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()
  })

  it('すべて削除ボタンで onClear が呼ばれる', async () => {
    const onClear = vi.fn()
    render(<HistoryPanel history={[entry1]} {...handlers} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'すべて削除' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('履歴が空のとき、すべて削除ボタンは無効化される', () => {
    render(<HistoryPanel history={[]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'すべて削除' })).toBeDisabled()
  })

  it('選択中の履歴を削除すると選択が先頭にフォールバックする', async () => {
    const onDelete = vi.fn()
    const { container, rerender } = render(
      <HistoryPanel history={[entry1, entry2]} {...handlers} onDelete={onDelete} />
    )
    // entry1 が初期選択されている状態で削除する
    await userEvent.click(screen.getByRole('button', { name: 'この履歴を削除' }))
    expect(onDelete).toHaveBeenCalledWith('h1')
    // 親から entry1 が取り除かれた新しい history で再レンダリング
    rerender(<HistoryPanel history={[entry2]} {...handlers} onDelete={onDelete} />)
    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()
  })

  it('選択中でない履歴が親から削除されても選択状態は変わらない', async () => {
    const { container, rerender } = render(
      <HistoryPanel history={[entry1, entry2]} {...handlers} />
    )
    // entry2 を選択した状態で、親側の history から entry1（未選択）が取り除かれる
    await userEvent.click(screen.getByText('タイトル2'))
    rerender(<HistoryPanel history={[entry2]} {...handlers} />)
    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()
  })

  it('選択中の履歴を削除してリストが空になると空メッセージにフォールバックする', () => {
    const { rerender } = render(<HistoryPanel history={[entry1]} {...handlers} />)
    rerender(<HistoryPanel history={[]} {...handlers} />)
    expect(screen.getByText('履歴がありません')).toBeInTheDocument()
  })

  it('再実行等で新しい履歴が先頭に追加されると、選択がその新しい結果に自動で切り替わる', async () => {
    const { container, rerender } = render(
      <HistoryPanel history={[entry1, entry2]} {...handlers} />
    )
    // entry2 を選択している状態で、新しい実行結果が先頭に追加される
    await userEvent.click(screen.getByText('タイトル2'))
    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()

    const newEntry: HistoryEntry = {
      ...entry1,
      id: 'h3',
      promptTitle: 'タイトル3',
      resultText: '結果3'
    }
    rerender(<HistoryPanel history={[newEntry, entry1, entry2]} {...handlers} />)
    expect(within(getDetail(container)).getByText('結果3')).toBeInTheDocument()
  })
})
