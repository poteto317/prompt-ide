import { useCallback } from 'react'
import type { HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'
import type { ExecutionContext, PromptExecutionState } from './usePromptExecution'

interface Deps {
  openFile: OpenFile | null
  executePrompt: PromptExecutionState['executePrompt']
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void
}

interface PromptRunner {
  runPrompt: (content: string, toolId: PromptToolId, prompt: Prompt) => Promise<void>
  rerunHistoryEntry: (entry: HistoryEntry) => Promise<void>
}

export function usePromptRunner({ openFile, executePrompt, addHistoryEntry }: Deps): PromptRunner {
  const run = useCallback(
    (
      content: string,
      fileContent: string | null,
      toolId: PromptToolId,
      context: ExecutionContext
    ) => executePrompt(content, fileContent, toolId, context, addHistoryEntry),
    [executePrompt, addHistoryEntry]
  )

  const runPrompt = useCallback(
    (content: string, toolId: PromptToolId, prompt: Prompt) =>
      run(content, openFile?.content ?? null, toolId, {
        promptId: prompt.id,
        promptTitle: prompt.title
      }),
    [run, openFile]
  )

  // 履歴からの再実行は「実行時のファイル内容スナップショット」をそのまま再現する
  // （現在開いているファイルではなく entry.fileContent を使う）
  const rerunHistoryEntry = useCallback(
    (entry: HistoryEntry) =>
      run(entry.promptContent, entry.fileContent, entry.toolId, {
        promptId: entry.promptId,
        promptTitle: entry.promptTitle
      }),
    [run]
  )

  return { runPrompt, rerunHistoryEntry }
}
