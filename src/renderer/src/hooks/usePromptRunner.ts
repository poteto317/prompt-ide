import { useCallback } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import type { HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'
import type { ExecutionContext, PromptExecutionState } from './usePromptExecution'
import type { AgentReferencesState } from './useAgentReferences'
import { buildAgentPromptRequest } from '../lib/agentPromptRequest'
import type { AgentSendOptions } from '../lib/agentPromptRequest'

interface Deps {
  openFile: OpenFile | null
  executePrompt: PromptExecutionState['executePrompt']
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void
  /** 実行方式。読み込み中は null(何もしない) */
  executionMode: PromptExecutionMode | null
  /** エージェント CLI 方式の送信(useAgentWorkspace.sendToAgent。送信前の確認の設定がオンなら、送る前に確認を開く)。options の
   *  promptId は確認をキャンセルで閉じたとき・確認からの送信が失敗したときのフォーカスの戻り先を探すのに使う。ファイル内容は添付しない(C2) */
  sendToAgent: (text: string, options: AgentSendOptions) => Promise<unknown>
  /** エージェントへ送るプロンプトの参照(useAgentReferences)。実行を押した時点の写しを本文の末尾へ足し、送れたら写しの分の
   *  エクスプローラのファイルを外す。従来の方式では使わない。省略できない(L-060) */
  agentReferences: Pick<AgentReferencesState, 'prepare' | 'markSent'>
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
  sendToAgent,
  agentReferences
}: Deps): PromptRunner {
  // useCallback の依存に入れるため、描画をまたいで同じ参照の関数だけを取り出す
  const { prepare: prepareAgentReferences, markSent: markAgentReferencesSent } = agentReferences
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
        // 変数を差し込んだ後の本文の末尾へ、押した時点の参照を足す(送信前の確認には足した後の全文が出る)。エクスプローラから
        // 足したファイルは、送れたときだけ、この写しの分を外す(確認のキャンセル・送信の失敗では外さない。L-407)
        const prepared = prepareAgentReferences()
        const request = buildAgentPromptRequest(content, prompt.id, prepared, () =>
          markAgentReferencesSent(prepared)
        )
        await sendToAgent(request.text, request.options)
        return
      }
      if (executionMode !== 'legacy') return
      await run(content, openFile?.content ?? null, toolId, {
        promptId: prompt.id,
        promptTitle: prompt.title
      })
    },
    [run, openFile, executionMode, sendToAgent, prepareAgentReferences, markAgentReferencesSent]
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
