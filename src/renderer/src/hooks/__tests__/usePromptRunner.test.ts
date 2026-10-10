import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { HistoryEntry, OpenFile, Prompt } from '../../types'
import type { AgentSendOptions } from '../../lib/agentPromptRequest'
import type { PreparedAgentReferences } from '../../lib/agentReferenceCandidates'
import { makeAgentReferencesState } from '../../__tests__/makeAgentReferencesState'
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
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry,
        executionMode: 'legacy',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )

    result.current.runPrompt('実行する内容', 'claude', prompt)

    expect(executePrompt).toHaveBeenCalledWith(
      '実行する内容',
      openFile.content,
      'claude',
      { promptId: prompt.id, promptTitle: prompt.title },
      addHistoryEntry
    )
    // 従来の方式ではエージェントへ送らない
    expect(sendToAgent).not.toHaveBeenCalled()
  })

  it('openFile が null のとき fileContent は null になる', () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile: null,
        executePrompt,
        addHistoryEntry,
        executionMode: 'legacy',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )

    result.current.runPrompt('実行する内容', 'claude', prompt)

    expect(executePrompt).toHaveBeenCalledWith(
      '実行する内容',
      null,
      'claude',
      { promptId: prompt.id, promptTitle: prompt.title },
      addHistoryEntry
    )
    // 従来の方式ではエージェントへ送らない
    expect(sendToAgent).not.toHaveBeenCalled()
  })

  it('rerunHistoryEntry は現在の openFile に関係なく entry のスナップショットを使う', () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    // 現在開いているファイルは履歴保存時のものと異なる
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry,
        executionMode: 'legacy',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )

    result.current.rerunHistoryEntry(historyEntry)

    expect(executePrompt).toHaveBeenCalledWith(
      historyEntry.promptContent,
      historyEntry.fileContent,
      historyEntry.toolId,
      { promptId: historyEntry.promptId, promptTitle: historyEntry.promptTitle },
      addHistoryEntry
    )
    // 従来の方式ではエージェントへ送らない
    expect(sendToAgent).not.toHaveBeenCalled()
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

describe('usePromptRunner: 実行方式', () => {
  it('エージェント CLI 方式では本文だけをエージェントへ送り、従来の実行と履歴の記録をしない', async () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.runPrompt('送る本文', 'claude', prompt)
    // ファイル内容を添付しない(C2)・履歴に記録しない(C11)。プロンプトの id は確認の戻り先を探すため
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送る本文', {
      promptId: 'p1',
      unsavedPaths: [],
      onSent: expect.any(Function)
    })
    expect(executePrompt).not.toHaveBeenCalled()
    expect(addHistoryEntry).not.toHaveBeenCalled()
  })

  it('実行方式の読み込み中(null)は何もしない', async () => {
    const executePrompt = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry: vi.fn(),
        executionMode: null,
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.runPrompt('本文', 'claude', prompt)
    await result.current.rerunHistoryEntry(historyEntry)
    expect(sendToAgent).not.toHaveBeenCalled()
    expect(executePrompt).not.toHaveBeenCalled()
  })

  it('エージェント CLI 方式では履歴の再実行をしない', async () => {
    const executePrompt = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry: vi.fn(),
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(historyEntry)
    expect(executePrompt).not.toHaveBeenCalled()
    expect(sendToAgent).not.toHaveBeenCalled()
  })
  it('エージェント CLI 方式では、押した時点の参照を本文の末尾に足し、未保存の一覧と送れたときの知らせを添えて送る', async () => {
    const prepared: PreparedAgentReferences = {
      references: [
        { path: 'src/app.ts', lineRange: null },
        { path: 'src/app.ts', lineRange: '#L10-20' },
        { path: 'docs/notes.md', lineRange: null }
      ],
      unsavedPaths: ['src/app.ts'],
      addedPaths: ['/repo/docs/notes.md']
    }
    const agentReferences = makeAgentReferencesState({ prepare: vi.fn(() => prepared) })
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt: vi.fn(),
        addHistoryEntry: vi.fn(),
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences
      })
    )
    await result.current.runPrompt('送る本文', 'claude', prompt)
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith(
      '送る本文\n\n参照:\n- @src/app.ts\n- @src/app.ts#L10-20\n- @docs/notes.md',
      { promptId: 'p1', unsavedPaths: ['src/app.ts'], onSent: expect.any(Function) }
    )
    // 足したファイルを外すのは送れたときだけ(押した時点の写しを渡す。L-407)
    expect(agentReferences.markSent).not.toHaveBeenCalled()
    sendToAgent.mock.calls[0][1].onSent?.()
    expect(agentReferences.markSent).toHaveBeenCalledExactlyOnceWith(prepared)
  })

  it('従来の方式では参照を足さず、参照の写しも取らない', async () => {
    const executePrompt = vi.fn()
    const agentReferences = makeAgentReferencesState()
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry: vi.fn(),
        executionMode: 'legacy',
        sendToAgent: vi.fn(async () => undefined),
        agentReferences
      })
    )
    await result.current.runPrompt('実行する内容', 'claude', prompt)
    expect(agentReferences.prepare).not.toHaveBeenCalled()
    expect(executePrompt.mock.calls[0][0]).toBe('実行する内容')
  })
})
