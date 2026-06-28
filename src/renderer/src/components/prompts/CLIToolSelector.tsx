'use client'
import type { CLIToolId } from '@shared/types'
import { CLI_TOOLS } from '@shared/types'

interface Props {
  selectedTool: CLIToolId
  onSelectTool: (tool: CLIToolId) => void
}

export default function CLIToolSelector({ selectedTool, onSelectTool }: Props) {
  return (
    <select
      className="prompts-panel__tool-select"
      value={selectedTool}
      onChange={(e) => onSelectTool(e.target.value as CLIToolId)}
      aria-label="実行ツールを選択"
    >
      {CLI_TOOLS.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.label}
        </option>
      ))}
    </select>
  )
}
