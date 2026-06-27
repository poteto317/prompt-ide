import { useState, useCallback, useRef } from 'react'
import type { CLIToolId } from '@shared/types'
import { invokePrompt } from '../lib/promptInvoker'

interface PromptExecutionState {
  isExecuting: boolean
  result: string | null
  executionError: Error | null
  executePrompt: (promptContent: string, fileContent: string | null, toolId: CLIToolId) => Promise<void>
  clearResult: () => void
}

export function usePromptExecution(): PromptExecutionState {
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [executionError, setExecutionError] = useState<Error | null>(null)
  const requestIdRef = useRef(0)

  const executePrompt = useCallback(
    async (promptContent: string, fileContent: string | null, toolId: CLIToolId): Promise<void> => {
      const currentId = ++requestIdRef.current
      setIsExecuting(true)
      setResult(null)
      setExecutionError(null)
      try {
        const text = await invokePrompt(toolId, promptContent, fileContent)
        if (currentId !== requestIdRef.current) return
        setResult(text)
      } catch (err) {
        if (currentId !== requestIdRef.current) return
        setExecutionError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (currentId === requestIdRef.current) setIsExecuting(false)
      }
    },
    []
  )

  const clearResult = useCallback((): void => {
    setResult(null)
    setExecutionError(null)
  }, [])

  return { isExecuting, result, executionError, executePrompt, clearResult }
}
