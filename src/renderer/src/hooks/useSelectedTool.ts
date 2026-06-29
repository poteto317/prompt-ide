import { useState } from 'react'
import type { CLIToolId } from '@shared/types'

// 後方互換のため API をデフォルトにする（CLI 未インストール環境でも従来通り動作する）
export const DEFAULT_CLI_TOOL: CLIToolId = 'api'

export function useSelectedTool(): {
  selectedTool: CLIToolId
  selectTool: (tool: CLIToolId) => void
} {
  const [selectedTool, setSelectedTool] = useState<CLIToolId>(DEFAULT_CLI_TOOL)
  return { selectedTool, selectTool: setSelectedTool }
}
