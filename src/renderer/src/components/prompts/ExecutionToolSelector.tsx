'use client'
import type { PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS } from '@shared/types'

interface Props {
  selectedTool: PromptToolId
  onSelectTool: (tool: PromptToolId) => void
}

export default function ExecutionToolSelector({ selectedTool, onSelectTool }: Props) {
  return (
    <select
      className="prompts-panel__tool-select"
      value={selectedTool}
      onChange={(e) => {
        const matched = EXECUTION_TOOLS.find((t) => t.id === e.target.value)
        if (matched) onSelectTool(matched.id)
      }}
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
