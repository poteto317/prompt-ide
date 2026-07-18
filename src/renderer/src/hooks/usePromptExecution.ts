import { useState, useCallback, useRef } from 'react'
import type { PromptToolId } from '@shared/types'
import { invokePrompt } from '../lib/promptInvoker'
import * as promptStreamApi from '../lib/promptStreamApi'
import { useStreamingText } from './useStreamingText'

// usePromptExecution は履歴機能から疎結合であるべきため、HistoryEntry 等の型には依存しない。
// 実行完了時の記録は onExecuted コールバック経由で呼び出し側に委譲する。
export interface ExecutionContext {
  promptId: string | null
  promptTitle: string
}

export interface ExecutionOutcome extends ExecutionContext {
  promptContent: string
  fileContent: string | null
  toolId: PromptToolId
  status: 'success' | 'error'
  resultText: string | null
  errorMessage: string | null
  executedAt: number
}

export interface PromptExecutionState {
  isExecuting: boolean
  result: string | null
  streamingText: string
  executionError: Error | null
  executePrompt: (
    promptContent: string,
    fileContent: string | null,
    toolId: PromptToolId,
    context?: ExecutionContext,
    onExecuted?: (outcome: ExecutionOutcome) => void
  ) => Promise<void>
  cancelExecution: () => void
  clearResult: () => void
}

function buildOutcome(
  context: ExecutionContext,
  promptContent: string,
  fileContent: string | null,
  toolId: PromptToolId,
  result: Pick<ExecutionOutcome, 'status' | 'resultText' | 'errorMessage'>
): ExecutionOutcome {
  return { ...context, promptContent, fileContent, toolId, executedAt: Date.now(), ...result }
}

export function usePromptExecution(): PromptExecutionState {
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [executionError, setExecutionError] = useState<Error | null>(null)
  const requestIdRef = useRef(0)
  // キャンセル対象を特定するための現在アクティブな requestId(uuid)。
  // ストリーミング購読のフィルタキーは useStreamingText 側で独立して管理しており、
  // こちらはキャンセル(cancelExecution)専用の追跡。
  const activeUuidRef = useRef<string | null>(null)
  const { streamingText, startStreaming, stopStreaming } = useStreamingText()

  const executePrompt = useCallback(
    async (
      promptContent: string,
      fileContent: string | null,
      toolId: PromptToolId,
      context: ExecutionContext = { promptId: null, promptTitle: '' },
      onExecuted?: (outcome: ExecutionOutcome) => void
    ): Promise<void> => {
      const currentId = ++requestIdRef.current
      const uuid = crypto.randomUUID()
      activeUuidRef.current = uuid
      startStreaming(uuid)
      setIsExecuting(true)
      setResult(null)
      setExecutionError(null)
      try {
        const text = await invokePrompt(toolId, promptContent, fileContent, uuid)
        if (currentId !== requestIdRef.current) return
        setResult(text)
        onExecuted?.(
          buildOutcome(context, promptContent, fileContent, toolId, {
            status: 'success',
            resultText: text,
            errorMessage: null
          })
        )
      } catch (err) {
        if (currentId !== requestIdRef.current) return
        const error = err instanceof Error ? err : new Error(String(err))
        setExecutionError(error)
        onExecuted?.(
          buildOutcome(context, promptContent, fileContent, toolId, {
            status: 'error',
            resultText: null,
            errorMessage: error.message
          })
        )
      } finally {
        if (currentId === requestIdRef.current) {
          setIsExecuting(false)
          activeUuidRef.current = null
          stopStreaming()
        }
      }
    },
    [startStreaming, stopStreaming]
  )

  // キャンセル結果は invoke の reject('キャンセルされました')として既存エラーパスに合流するため、
  // ここは fire-and-forget でよい
  const cancelExecution = useCallback((): void => {
    const uuid = activeUuidRef.current
    if (uuid === null) return
    promptStreamApi.cancelPrompt(uuid).catch((err) => {
      console.error('[usePromptExecution] cancelPrompt failed:', err)
    })
  }, [])

  const clearResult = useCallback((): void => {
    setResult(null)
    setExecutionError(null)
  }, [])

  return {
    isExecuting,
    result,
    streamingText,
    executionError,
    executePrompt,
    cancelExecution,
    clearResult
  }
}
