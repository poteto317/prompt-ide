import { useState, useCallback } from 'react'
import type { CLIToolId } from '@shared/types'

export const DEFAULT_CLI_TOOL: CLIToolId = 'claude'

export function useSelectedTool(): {
  selectedTool: CLIToolId
  selectTool: (tool: CLIToolId) => void
} {
  const [selectedTool, setSelectedTool] = useState<CLIToolId>(DEFAULT_CLI_TOOL)
  const selectTool = useCallback((tool: CLIToolId): void => {
    setSelectedTool(tool)
  }, [])
  return { selectedTool, selectTool }
}
