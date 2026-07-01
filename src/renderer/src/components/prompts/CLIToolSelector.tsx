'use client'
import type { PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS } from '@shared/types'

interface Props {
  selectedTool: PromptToolId
  onSelectTool: (tool: PromptToolId) => void
}

export default function CLIToolSelector({ selectedTool, onSelectTool }: Props) {
  return (
    <select
      className="prompts-panel__tool-select"
      value={selectedTool}
      onChange={(e) => onSelectTool(e.target.value as PromptToolId)}
      aria-label="実行ツールを選択"
    >
      {EXECUTION_TOOLS.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.label}
        </option>
      ))}
    </select>
  )
}
