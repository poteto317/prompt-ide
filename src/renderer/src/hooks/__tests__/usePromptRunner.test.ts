import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { HistoryEntry, OpenFile, Prompt } from '../../types'
import { usePromptRunner } from '../usePromptRunner'

const prompt: Prompt = {
  id: 'p1',
  title: 'プロンプトタイトル',
  content: 'プロンプト内容',
  createdAt: 1000
}

const historyEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p2',
  promptTitle: '履歴タイトル',
  promptContent: '履歴プロンプト内容',
  fileContent: 'スナップショット時のファイル内容',
  toolId: 'claude',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 2000
}

const openFile: OpenFile = {
  path: '/current/file.md',
  name: 'file.md',
  content: '現在開いているファイル内容',
  savedContent: '現在開いているファイル内容',
  language: 'markdown'
}

describe('usePromptRunner', () => {
  it('runPrompt は content・openFile.content・toolId・prompt のコンテキストを executePrompt に渡す', () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    const { result } = renderHook(() =>
      usePromptRunner({ openFile, executePrompt, addHistoryEntry })
    )

    result.current.runPrompt('実行する内容', 'claude', prompt)

    expect(executePrompt).toHaveBeenCalledWith(
      '実行する内容',
      openFile.content,
      'claude',
      { promptId: prompt.id, promptTitle: prompt.title },
      addHistoryEntry
    )
  })

  it('openFile が null のとき fileContent は null になる', () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    const { result } = renderHook(() =>
      usePromptRunner({ openFile: null, executePrompt, addHistoryEntry })
    )

    result.current.runPrompt('実行する内容', 'claude', prompt)

    expect(executePrompt).toHaveBeenCalledWith(
      '実行する内容',
      null,
      'claude',
      { promptId: prompt.id, promptTitle: prompt.title },
      addHistoryEntry
    )
  })

  it('rerunHistoryEntry は現在の openFile に関係なく entry のスナップショットを使う', () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    // 現在開いているファイルは履歴保存時のものと異なる
    const { result } = renderHook(() =>
      usePromptRunner({ openFile, executePrompt, addHistoryEntry })
    )

    result.current.rerunHistoryEntry(historyEntry)

    expect(executePrompt).toHaveBeenCalledWith(
      historyEntry.promptContent,
      historyEntry.fileContent,
      historyEntry.toolId,
      { promptId: historyEntry.promptId, promptTitle: historyEntry.promptTitle },
      addHistoryEntry
    )
    // 現在開いているファイル内容が使われていないこと
    expect(executePrompt).not.toHaveBeenCalledWith(
      expect.anything(),
      openFile.content,
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})
