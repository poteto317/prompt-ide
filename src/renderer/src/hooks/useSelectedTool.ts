import { useState } from 'react'
import type { PromptToolId } from '@shared/types'

// API をデフォルトにする（CLI 未インストール環境でも従来通り動作する）
export const DEFAULT_PROMPT_TOOL: PromptToolId = 'api'

export function useSelectedTool(): {
  selectedTool: PromptToolId
  selectTool: (tool: PromptToolId) => void
} {
  const [selectedTool, setSelectedTool] = useState<PromptToolId>(DEFAULT_PROMPT_TOOL)
  return { selectedTool, selectTool: setSelectedTool }
}
