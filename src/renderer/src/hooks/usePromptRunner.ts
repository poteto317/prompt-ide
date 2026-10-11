import { useCallback } from 'react'
import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'
import type { HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'
import type { ExecutionContext, PromptExecutionState } from './usePromptExecution'
import type { AgentReferencesState } from './useAgentReferences'
import { buildAgentPromptRequest } from '../lib/agentPromptRequest'
import type { AgentSendOptions } from '../lib/agentPromptRequest'
import { buildAgentSentHistoryEntry } from '../lib/historyEntryFactory'

interface Deps {
  openFile: OpenFile | null
  executePrompt: PromptExecutionState['executePrompt']
  /** 履歴に足す(従来の方式は実行の結果、エージェント CLI 方式は送れたとき) */
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

  // エージェント CLI 方式で送れたときの記録(結果の文章は記録しない)。送り先(sentTo)は送信の手順を始める時点に控えた値。
  // 控えられなかった(null。ありえない想定)ときは記録を省いてログに残す。記録が投げても呼び出し元(参照の後始末)を止めない
  const recordAgentSent = useCallback(
    (context: ExecutionContext, text: string, sentTo: AgentHistoryInfo | null): void => {
      if (sentTo === null) {
        console.error('[usePromptRunner] 送り先のセッションが分からないため、履歴に記録しません')
        return
      }
      try {
        addHistoryEntry(buildAgentSentHistoryEntry(context, text, sentTo, Date.now()))
      } catch (err) {
        console.error('[usePromptRunner] addHistoryEntry failed:', err)
      }
    },
    [addHistoryEntry]
  )

  // エージェント CLI 方式は起動中のセッションへ送り、送れたときに記録する(結果の文章は記録しない)。従来の方式は従来どおり
  const runPrompt = useCallback(
    async (content: string, toolId: PromptToolId, prompt: Prompt): Promise<void> => {
      if (executionMode === 'agent-cli') {
        // 変数を差し込んだ後の本文の末尾へ、押した時点の参照を足す(送信前の確認には足した後の全文が出る)。エクスプローラから
        // 足したファイルは、送れたときだけ、この写しの分を外す(確認のキャンセル・送信の失敗では外さない。L-407)
        const prepared = prepareAgentReferences()
        const context: ExecutionContext = { promptId: prompt.id, promptTitle: prompt.title }
        const request = buildAgentPromptRequest(content, prompt.id, prepared, (sentTo) => {
          // 参照の後始末と履歴の記録は段ごとに別の try で包み、片方が投げてももう片方を止めない(L-053)
          try {
            markAgentReferencesSent(prepared)
          } catch (err) {
            console.error('[usePromptRunner] markSent failed:', err)
          }
          recordAgentSent(context, request.text, sentTo)
        })
        await sendToAgent(request.text, request.options)
        return
      }
      if (executionMode !== 'legacy') return
      await run(content, openFile?.content ?? null, toolId, {
        promptId: prompt.id,
        promptTitle: prompt.title
      })
    },
    [
      run,
      openFile,
      executionMode,
      sendToAgent,
      prepareAgentReferences,
      markAgentReferencesSent,
      recordAgentSent
    ]
  )

  // 履歴からの再実行。従来のエントリは「実行時のファイル内容スナップショット」をそのまま再現する（現在開いているファイルではなく
  // entry.fileContent を使う）。エージェントのエントリは、今の選択中のタブへ同じ全文を送り(参照は全文に含まれているので足し直さない)、
  // 送れたら新しいエントリとして記録する。方式とエントリの種類が合わないものは何もしない(ボタンは押せないが、処理の側でも
  // 同じ条件で守る。L-058)
  const rerunHistoryEntry = useCallback(
    async (entry: HistoryEntry): Promise<void> => {
      const context: ExecutionContext = { promptId: entry.promptId, promptTitle: entry.promptTitle }
      if (executionMode === 'agent-cli') {
        if (entry.agent === null) return
        await sendToAgent(entry.promptContent, {
          promptId: entry.promptId,
          // 記録した全文をそのまま送る。全文から参照を解析し直すのは脆いので、未保存の注意は出さない(既知の制約。設計書の「既知の制約」)
          unsavedPaths: [],
          onSent: (sentTo) => recordAgentSent(context, entry.promptContent, sentTo)
        })
        return
      }
      if (executionMode !== 'legacy') return
      if (entry.agent !== null) return
      await run(entry.promptContent, entry.fileContent, entry.toolId, context)
    },
    [run, executionMode, sendToAgent, recordAgentSent]
  )

  return { runPrompt, rerunHistoryEntry }
}
