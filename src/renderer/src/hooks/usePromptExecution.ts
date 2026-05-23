import { useState, useCallback } from 'react'
import * as claudeApi from '../lib/claudeApi'

interface PromptExecutionState {
  isExecuting: boolean
  result: string | null
  executionError: Error | null
  executePrompt: (promptContent: string, fileContent: string | null) => Promise<void>
  clearResult: () => void
}

export function usePromptExecution(): PromptExecutionState {
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [executionError, setExecutionError] = useState<Error | null>(null)

  const executePrompt = useCallback(
    async (promptContent: string, fileContent: string | null): Promise<void> => {
      setIsExecuting(true)
      setResult(null)
      setExecutionError(null)
      try {
        setResult(await claudeApi.runPrompt(promptContent, fileContent))
      } catch (err) {
        setExecutionError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setIsExecuting(false)
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
