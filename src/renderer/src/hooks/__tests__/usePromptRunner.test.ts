import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { AgentHistoryInfo } from '@shared/types'
import type { HistoryEntry, OpenFile, Prompt } from '../../types'
import type { AgentSendOptions } from '../../lib/agentPromptRequest'
import type { PreparedAgentReferences } from '../../lib/agentReferenceCandidates'
import { makeAgentReferencesState } from '../../__tests__/makeAgentReferencesState'
import type { AgentReferencesState } from '../useAgentReferences'
import { usePromptRunner } from '../usePromptRunner'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 会話の ID を持たない種類(sessionResume が偽)の記録の省略を確かめるため、能力の表を差し替える(段階 3a で copilot も再開に
// 対応し、今の表には該当する種類が無い)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

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
  executedAt: 2000,
  agent: null
}

const SENT_TO: AgentHistoryInfo = {
  claudeSessionId: '11111111-1111-4111-8111-111111111111',
  cliKind: 'claude',
  tabLabel: 'claude 2',
  folderPath: '/repo'
}

const COPILOT_SENT_TO: AgentHistoryInfo = {
  claudeSessionId: '33333333-3333-4333-8333-333333333333',
  cliKind: 'copilot',
  tabLabel: 'copilot 1',
  folderPath: '/repo'
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
        folderPath: '/repo',
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
        folderPath: '/repo',
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
        folderPath: '/repo',
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
  it('エージェント CLI 方式では本文だけをエージェントへ送り、従来の実行をしない。送っただけでは履歴に記録しない(送れたときの onSent でだけ記録する)', async () => {
    const executePrompt = vi.fn()
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt,
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.runPrompt('送る本文', 'claude', prompt)
    // ファイル内容を添付しない(C2)・送れたときの onSent で記録する。プロンプトの id は確認の戻り先を探すため
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送る本文', {
      promptId: 'p1',
      unsavedPaths: [],
      onSent: expect.any(Function),
      composeText: expect.any(Function)
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
        folderPath: '/repo',
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

  it('エージェント CLI 方式では従来のエントリ(agent が null)を再実行しない(処理の側の守り。L-058)', async () => {
    const executePrompt = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
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
        folderPath: '/repo',
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
      {
        promptId: 'p1',
        unsavedPaths: ['src/app.ts'],
        onSent: expect.any(Function),
        composeText: expect.any(Function)
      }
    )
    // 足したファイルを外すのは送れたときだけ(押した時点の写しを渡す。L-407)
    expect(agentReferences.markSent).not.toHaveBeenCalled()
    sendToAgent.mock.calls[0][1].onSent?.(SENT_TO, 'claude', '送る本文')
    expect(agentReferences.markSent).toHaveBeenCalledExactlyOnceWith(prepared)
  })

  it('従来の方式では参照を足さず、参照の写しも取らない', async () => {
    const executePrompt = vi.fn()
    const agentReferences = makeAgentReferencesState()
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
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

describe('usePromptRunner: 送れたときの履歴への記録', () => {
  type AddHistoryEntry = (entry: Omit<HistoryEntry, 'id'>) => void
  // runPrompt で送り、sendToAgent に渡した onSent を返す
  const runAndTakeOnSent = async ({
    addHistoryEntry = vi.fn<AddHistoryEntry>(),
    agentReferences = makeAgentReferencesState({
      prepare: vi.fn(() => ({
        references: [{ path: 'src/app.ts', lineRange: null }],
        unsavedPaths: [],
        addedPaths: []
      }))
    })
  }: {
    addHistoryEntry?: Mock<AddHistoryEntry>
    agentReferences?: AgentReferencesState
  } = {}): Promise<{
    onSent: NonNullable<AgentSendOptions['onSent']>
    addHistoryEntry: Mock<AddHistoryEntry>
    agentReferences: AgentReferencesState
  }> => {
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences
      })
    )
    await result.current.runPrompt('送る本文', 'claude', prompt)
    const onSent = sendToAgent.mock.calls[0][1].onSent
    if (onSent === undefined) throw new Error('onSent がありません')
    return { onSent, addHistoryEntry, agentReferences }
  }

  let consoleErrorSpy: MockInstance<typeof console.error> | null = null
  afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
    capabilityOverrides.sessionResumeUnsupportedKinds.clear()
  })

  it('送れたら(onSent)、送った全文(参照を含む)と控えた送り先を status: sent で記録する', async () => {
    const { onSent, addHistoryEntry } = await runAndTakeOnSent()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    onSent(SENT_TO, 'claude', '送る本文\n\n参照:\n- @src/app.ts')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith({
      promptId: 'p1',
      promptTitle: 'プロンプトタイトル',
      promptContent: '送る本文\n\n参照:\n- @src/app.ts',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: expect.any(Number),
      agent: SENT_TO
    })
  })

  it('onSent の第 3 引数(引数を付けた全文)を履歴に記録する(一覧の実行)', async () => {
    const { onSent, addHistoryEntry } = await runAndTakeOnSent()
    onSent(SENT_TO, 'claude', '/review 123')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ promptContent: '/review 123' })
    )
  })

  it('claude の送り先で送り先を控えられなかった(null)ときは、参照の後始末だけ行い、記録を省いてログに残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
    onSent(null, 'claude', '送る本文')
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('copilot の送り先で送れたら、cliKind: copilot のエントリを記録する(ツールの欄は claude のまま。段階 3a)', async () => {
    const { onSent, addHistoryEntry } = await runAndTakeOnSent()
    onSent(COPILOT_SENT_TO, 'copilot', '送る本文')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'sent', toolId: 'claude', agent: COPILOT_SENT_TO })
    )
  })

  it('copilot の送り先で送り先を控えられなかった(null)ときは、claude と同じく記録を省いてログに残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
    onSent(null, 'copilot', '送る本文')
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('会話の ID を持たない種類(能力の表を差し替えた copilot)の送り先で送れたときは、参照の後始末だけ行い、記録もログもしない', async () => {
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
    onSent(null, 'copilot', '送る本文')
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('参照の後始末が投げても記録し、記録が投げても参照の後始末は済んでいる(段ごとに別の try。L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = await runAndTakeOnSent({
      agentReferences: makeAgentReferencesState({
        markSent: vi.fn(() => {
          throw new Error('markSent broken')
        })
      })
    })
    expect(() => first.onSent(SENT_TO, 'claude', '送る本文')).not.toThrow()
    expect(first.addHistoryEntry).toHaveBeenCalledOnce()

    const addHistoryEntry = vi.fn<AddHistoryEntry>(() => {
      throw new Error('addHistoryEntry broken')
    })
    const agentReferences = makeAgentReferencesState()
    const second = await runAndTakeOnSent({ addHistoryEntry, agentReferences })
    expect(() => second.onSent(SENT_TO, 'claude', '送る本文')).not.toThrow()
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
  })
})

describe('usePromptRunner: エージェントのエントリの再実行', () => {
  const agentEntry: HistoryEntry = {
    ...historyEntry,
    id: 'h-agent',
    promptContent: '送った全文\n\n参照:\n- @src/app.ts',
    fileContent: null,
    status: 'sent',
    resultText: null,
    agent: SENT_TO
  }

  it('エージェント CLI 方式では今の送り先へ同じ全文を送り(参照は足し直さない)、送れたら新しいエントリとして記録する', async () => {
    const addHistoryEntry = vi.fn()
    const agentReferences = makeAgentReferencesState()
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    expect(agentReferences.prepare).not.toHaveBeenCalled()
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送った全文\n\n参照:\n- @src/app.ts', {
      promptId: 'p2',
      unsavedPaths: [],
      onSent: expect.any(Function)
    })
    expect(addHistoryEntry).not.toHaveBeenCalled()
    const resent = {
      ...SENT_TO,
      claudeSessionId: '22222222-2222-4222-9222-222222222222',
      cliKind: 'claude',
      tabLabel: 'claude 1'
    }
    sendToAgent.mock.calls[0][1].onSent?.(resent, 'claude', '送った全文\n\n参照:\n- @src/app.ts')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        promptId: 'p2',
        promptTitle: '履歴タイトル',
        promptContent: '送った全文\n\n参照:\n- @src/app.ts',
        status: 'sent',
        agent: resent
      })
    )
    expect(agentReferences.markSent).not.toHaveBeenCalled()
  })

  it('再実行で引数を付けて送れたら、onSent の第 3 引数(送った全文)を履歴に記録する', async () => {
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    sendToAgent.mock.calls[0][1].onSent?.(SENT_TO, 'claude', '/review 123')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ promptContent: '/review 123' })
    )
  })

  it('copilot のタブへ再実行して送れたときは、copilot の送り先で新しいエントリを記録する(エントリの種類は見ない)', async () => {
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    sendToAgent.mock.calls[0][1].onSent?.(
      COPILOT_SENT_TO,
      'copilot',
      '送った全文\n\n参照:\n- @src/app.ts'
    )
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        promptId: 'p2',
        promptContent: '送った全文\n\n参照:\n- @src/app.ts',
        status: 'sent',
        agent: COPILOT_SENT_TO
      })
    )
  })

  it('従来の方式ではエージェントのエントリを再実行しない(処理の側の守り。L-058)', async () => {
    const executePrompt = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt,
        addHistoryEntry: vi.fn(),
        executionMode: 'legacy',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    expect(executePrompt).not.toHaveBeenCalled()
    expect(sendToAgent).not.toHaveBeenCalled()
  })

  it('記録したフォルダと違うフォルダ・フォルダを開いていないときは送らない(処理の側の守り。L-058)', async () => {
    for (const folderPath of ['/other', null]) {
      const sendToAgent = vi.fn(async () => undefined)
      const { result } = renderHook(() =>
        usePromptRunner({
          openFile,
          folderPath,
          executePrompt: vi.fn(),
          addHistoryEntry: vi.fn(),
          executionMode: 'agent-cli',
          sendToAgent,
          agentReferences: makeAgentReferencesState()
        })
      )
      await result.current.rerunHistoryEntry(agentEntry)
      expect(sendToAgent).not.toHaveBeenCalled()
    }
  })
})
