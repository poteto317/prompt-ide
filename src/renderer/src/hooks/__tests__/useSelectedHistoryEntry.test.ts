import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { HistoryEntry } from '../../types'
import { useSelectedHistoryEntry } from '../useSelectedHistoryEntry'

const makeEntry = (id: string): HistoryEntry => ({
  id,
  promptId: 'p1',
  promptTitle: `タイトル${id}`,
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 1000,
  agent: null
})

describe('useSelectedHistoryEntry', () => {
  it('未選択時は先頭要素にフォールバックする', () => {
    const history = [makeEntry('a'), makeEntry('b')]
    const { result } = renderHook(() => useSelectedHistoryEntry(history))
    expect(result.current.selectedEntry?.id).toBe('a')
  })

  it('history が空のとき selectedEntry は null になる', () => {
    const { result } = renderHook(() => useSelectedHistoryEntry([]))
    expect(result.current.selectedEntry).toBeNull()
  })

  it('selectEntry で選択が切り替わる', () => {
    const history = [makeEntry('a'), makeEntry('b')]
    const { result } = renderHook(() => useSelectedHistoryEntry(history))
    act(() => result.current.selectEntry('b'))
    expect(result.current.selectedEntry?.id).toBe('b')
  })

  it('選択中の項目が history から消えると先頭にフォールバックする', () => {
    const history = [makeEntry('a'), makeEntry('b')]
    const { result, rerender } = renderHook(({ history }) => useSelectedHistoryEntry(history), {
      initialProps: { history }
    })
    act(() => result.current.selectEntry('b'))
    rerender({ history: [makeEntry('a')] })
    expect(result.current.selectedEntry?.id).toBe('a')
  })

  it('deselectIfMatches は id が一致するときのみ選択を解除する', () => {
    const history = [makeEntry('a'), makeEntry('b')]
    const { result } = renderHook(() => useSelectedHistoryEntry(history))
    act(() => result.current.selectEntry('b'))

    act(() => result.current.deselectIfMatches('a'))
    expect(result.current.selectedEntry?.id).toBe('b')

    act(() => result.current.deselectIfMatches('b'))
    expect(result.current.selectedEntry?.id).toBe('a')
  })

  it('先頭に新しいエントリが追加されると、選択がその新しい結果に自動的に切り替わる（再実行時に古い結果を表示し続けない）', () => {
    const history = [makeEntry('a'), makeEntry('b')]
    const { result, rerender } = renderHook(({ history }) => useSelectedHistoryEntry(history), {
      initialProps: { history }
    })
    act(() => result.current.selectEntry('b'))
    expect(result.current.selectedEntry?.id).toBe('b')

    rerender({ history: [makeEntry('z'), ...history] })
    expect(result.current.selectedEntry?.id).toBe('z')
  })

  it('先頭以外を選択中に、先頭エントリが削除されて既存エントリが繰り上がっても選択は奪われない', () => {
    const history = [makeEntry('a'), makeEntry('b'), makeEntry('c')]
    const { result, rerender } = renderHook(({ history }) => useSelectedHistoryEntry(history), {
      initialProps: { history }
    })
    act(() => result.current.selectEntry('c'))
    expect(result.current.selectedEntry?.id).toBe('c')

    // 先頭の 'a' が削除され、既存の 'b' が繰り上がって先頭になる（新規追加ではない）
    rerender({ history: [makeEntry('b'), makeEntry('c')] })
    expect(result.current.selectedEntry?.id).toBe('c')
  })

  it('StrictMode 下でも二重実行によって選択が不安定にならない（新規追加への追従が1回だけ反映される）', () => {
    const history = [makeEntry('a'), makeEntry('b')]
    const { result, rerender } = renderHook(({ history }) => useSelectedHistoryEntry(history), {
      initialProps: { history },
      wrapper: StrictMode
    })
    expect(result.current.selectedEntry?.id).toBe('a')

    act(() => result.current.selectEntry('b'))
    expect(result.current.selectedEntry?.id).toBe('b')

    rerender({ history: [makeEntry('z'), ...history] })
    expect(result.current.selectedEntry?.id).toBe('z')

    // 内容が変わらない再レンダーでは選択が巻き戻らない（無限ループや余計な追従が起きない）
    rerender({ history: [makeEntry('z'), ...history] })
    expect(result.current.selectedEntry?.id).toBe('z')
  })
})
