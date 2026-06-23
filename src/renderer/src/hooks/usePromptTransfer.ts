import { useCallback, useEffect, useRef } from 'react'
import type { Prompt } from '../types'
import { cloneAsNewPrompt } from '../lib/promptFactory'
import { exportPrompts as apiExportPrompts, importPrompts as apiImportPrompts } from '../lib/promptsApi'
import type { Transform } from './useBufferedPersistence'

interface PromptTransfer {
  exportPrompts: () => Promise<boolean>
  importPrompts: () => Promise<number>
}

/** プロンプトの JSON インポート/エクスポートを担うフック。永続化は `apply` に委譲。 */
export function usePromptTransfer(
  prompts: Prompt[],
  apply: (transform: Transform<Prompt>) => void
): PromptTransfer {
  const promptsRef = useRef<Prompt[]>(prompts)
  useEffect(() => {
    promptsRef.current = prompts
  }, [prompts])

  const exportPrompts = useCallback((): Promise<boolean> => {
    return apiExportPrompts(promptsRef.current)
  }, [])

  const importPrompts = useCallback(async (): Promise<number> => {
    const imported = await apiImportPrompts()
    if (imported === null || imported.length === 0) return 0
    const added = imported.map(cloneAsNewPrompt)
    apply((prev) => [...prev, ...added])
    return added.length
  }, [apply])

  return { exportPrompts, importPrompts }
}
