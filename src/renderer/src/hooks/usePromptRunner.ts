import { useCallback } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import type { HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'
import type { ExecutionContext, PromptExecutionState } from './usePromptExecution'

interface Deps {
  openFile: OpenFile | null
  executePrompt: PromptExecutionState['executePrompt']
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void
  /** 実行方式。読み込み中は null(何もしない) */
  executionMode: PromptExecutionMode | null
  /** エージェント CLI 方式の送信(useAgentWorkspace.sendToAgent。送信前の確認の設定がオンなら、送る前に確認を開く)。プロンプトの
   *  id は、確認をキャンセルで閉じたとき・確認からの送信が失敗したときのフォーカスの戻り先を探すのに使う。ファイル内容は添付しない(C2) */
  sendToAgent: (text: string, promptId: string) => Promise<unknown>
}

interface PromptRunner {
  runPrompt: (content: string, toolId: PromptToolId, prompt: Prompt) => Promise<void>
  rerunHistoryEntry: (entry: HistoryEntry) => Promise<void>
}

export function usePromptRunner({
  openFile,
  executePrompt,
  addHistoryEntry,
  executionMode,
  sendToAgent
}: Deps): PromptRunner {
  const run = useCallback(
    (
      content: string,
      fileContent: string | null,
      toolId: PromptToolId,
      context: ExecutionContext
    ) => executePrompt(content, fileContent, toolId, context, addHistoryEntry),
    [executePrompt, addHistoryEntry]
  )

  // エージェント CLI 方式は起動中のセッションへ送る(履歴に記録しない。C11)。従来の方式は従来どおり
  const runPrompt = useCallback(
    async (content: string, toolId: PromptToolId, prompt: Prompt): Promise<void> => {
      if (executionMode === 'agent-cli') {
        await sendToAgent(content, prompt.id)
        return
      }
      if (executionMode !== 'legacy') return
      await run(content, openFile?.content ?? null, toolId, {
        promptId: prompt.id,
        promptTitle: prompt.title
      })
    },
    [run, openFile, executionMode, sendToAgent]
  )

  // 履歴からの再実行は「実行時のファイル内容スナップショット」をそのまま再現する
  // （現在開いているファイルではなく entry.fileContent を使う）。エージェント CLI 方式では再実行しない(ボタンも押せない)
  const rerunHistoryEntry = useCallback(
    async (entry: HistoryEntry): Promise<void> => {
      if (executionMode !== 'legacy') return
      await run(entry.promptContent, entry.fileContent, entry.toolId, {
        promptId: entry.promptId,
        promptTitle: entry.promptTitle
      })
    },
    [run, executionMode]
  )

  return { runPrompt, rerunHistoryEntry }
}
