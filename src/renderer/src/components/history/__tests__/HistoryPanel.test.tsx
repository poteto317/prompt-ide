import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistoryPanel from '../HistoryPanel'
import type { HistoryEntry, HistoryEntryActions } from '../../../types'

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
  executedAt: 2000,
  agent: null
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
  executedAt: 1000,
  agent: null
}

const handlers = {
  onDelete: vi.fn(),
  onClear: vi.fn(),
  onRerun: vi.fn(),
  onResume: vi.fn(),
  agentSend: null,
  getHistoryActions: vi.fn(
    (): HistoryEntryActions => ({ rerun: { disabled: false, reason: null }, resume: null })
  )
}

function getDetail(container: HTMLElement): HTMLElement {
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

  it('履歴一覧が radiogroup として支援技術に選択状態を伝える', () => {
    render(<HistoryPanel history={[entry1, entry2]} {...handlers} />)
    const group = screen.getByRole('radiogroup', { name: '履歴一覧' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    // 先頭（entry1）が初期選択されている
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveAttribute('aria-checked', 'false')
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

  it('ArrowDown で次の履歴に選択とフォーカスが移動する（roving tabindex）', async () => {
    const { container } = render(<HistoryPanel history={[entry1, entry2]} {...handlers} />)
    const group = screen.getByRole('radiogroup', { name: '履歴一覧' })
    const radios = within(group).getAllByRole('radio')
    radios[0].focus()

    await userEvent.keyboard('{ArrowDown}')

    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()
    expect(radios[1]).toHaveFocus()
    expect(radios[1]).toHaveAttribute('tabIndex', '0')
    expect(radios[0]).toHaveAttribute('tabIndex', '-1')
  })

  it('ArrowUp で先頭にいる場合は末尾の履歴に循環する', async () => {
    const { container } = render(<HistoryPanel history={[entry1, entry2]} {...handlers} />)
    const group = screen.getByRole('radiogroup', { name: '履歴一覧' })
    const radios = within(group).getAllByRole('radio')
    radios[0].focus()

    await userEvent.keyboard('{ArrowUp}')

    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()
    expect(radios[1]).toHaveFocus()
  })

  it('id に CSS セレクタの特殊文字（" や ]）が含まれていても矢印キー移動でクラッシュしない', async () => {
    // history.json は手動編集・破損等で任意の文字列が id に入り得る。
    // フォーカス対象の解決は ref の Map（文字列キー）で行うため、CSS セレクタへの
    // 変換が発生せず、この種の文字が id に含まれていても問題なく動作する。
    const entryWithSpecialId: HistoryEntry = { ...entry2, id: 'weird"id]with[chars' }
    const { container } = render(
      <HistoryPanel history={[entry1, entryWithSpecialId]} {...handlers} />
    )
    const group = screen.getByRole('radiogroup', { name: '履歴一覧' })
    const radios = within(group).getAllByRole('radio')
    radios[0].focus()

    await userEvent.keyboard('{ArrowDown}')

    expect(within(getDetail(container)).getByText('結果2')).toBeInTheDocument()
    expect(radios[1]).toHaveFocus()
  })

  it('履歴が1件のときに矢印キーを押しても同じ項目に留まる（クラッシュや不正な状態にならない）', async () => {
    render(<HistoryPanel history={[entry1]} {...handlers} />)
    const group = screen.getByRole('radiogroup', { name: '履歴一覧' })
    const radios = within(group).getAllByRole('radio')
    radios[0].focus()

    await userEvent.keyboard('{ArrowDown}')
    expect(radios[0]).toHaveFocus()
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')

    await userEvent.keyboard('{ArrowUp}')
    expect(radios[0]).toHaveFocus()
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  })
})

describe('HistoryPanel: エントリごとの操作', () => {
  it('選んだエントリの getHistoryActions の結果で詳細のボタンを出し、このセッションで再開 を onResume へ渡す', async () => {
    const agentEntry: HistoryEntry = {
      ...entry1,
      status: 'sent',
      resultText: null,
      agent: {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        tabLabel: 'claude 1',
        folderPath: '/w'
      }
    }
    const getHistoryActions = vi.fn(
      (entry: HistoryEntry): HistoryEntryActions => ({
        rerun: { disabled: false, reason: null },
        resume: entry.agent === null ? null : { disabled: false, reason: null }
      })
    )
    const onResume = vi.fn()
    render(
      <HistoryPanel
        history={[agentEntry]}
        {...handlers}
        getHistoryActions={getHistoryActions}
        onResume={onResume}
      />
    )
    await userEvent.click(screen.getByRole('radio'))
    expect(getHistoryActions).toHaveBeenCalledWith(agentEntry)
    await userEvent.click(screen.getByRole('button', { name: 'このセッションで再開' }))
    expect(onResume).toHaveBeenCalledExactlyOnceWith(agentEntry)
  })

  it('2 件目を選ぶとそのエントリの getHistoryActions の結果を出し、1 件目に戻すとそのエントリの結果に戻る(先頭と取り違えない)', async () => {
    const agentEntry: HistoryEntry = {
      ...entry2,
      status: 'sent',
      resultText: null,
      agent: {
        claudeSessionId: '22222222-2222-4222-8222-222222222222',
        tabLabel: 'claude 1',
        folderPath: '/w'
      }
    }
    const getHistoryActions = vi.fn(
      (entry: HistoryEntry): HistoryEntryActions => ({
        rerun: { disabled: false, reason: null },
        resume: entry.agent === null ? null : { disabled: false, reason: null }
      })
    )
    render(
      <HistoryPanel
        history={[entry1, agentEntry]}
        {...handlers}
        getHistoryActions={getHistoryActions}
      />
    )
    expect(screen.queryByRole('button', { name: 'このセッションで再開' })).toBeNull()
    await userEvent.click(screen.getByText('タイトル2'))
    expect(getHistoryActions).toHaveBeenLastCalledWith(agentEntry)
    expect(screen.getByRole('button', { name: 'このセッションで再開' })).toBeInTheDocument()
    await userEvent.click(screen.getByText('タイトル1'))
    expect(getHistoryActions).toHaveBeenLastCalledWith(entry1)
    expect(screen.queryByRole('button', { name: 'このセッションで再開' })).toBeNull()
  })
})
