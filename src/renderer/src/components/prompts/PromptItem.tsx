'use client'
import { useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Prompt } from '../../types'
import { extractVariables, interpolatePrompt } from '../../lib/templateVariables'
import PromptItemView from './PromptItemView'
import PromptEditForm from './PromptEditForm'
import PromptVariablesForm from './PromptVariablesForm'

interface Props {
  prompt: Prompt
  onDelete: (id: string) => void
  onRun: (content: string) => void
  onEdit: (id: string, title: string, content: string, tags: string[]) => void
  onTogglePin: (id: string) => void
  isRunDisabled?: boolean
  isSortable?: boolean
}

export default function PromptItem({
  prompt,
  onDelete,
  onRun,
  onEdit,
  onTogglePin,
  isRunDisabled = false,
  isSortable = false
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [isFillingVariables, setIsFillingVariables] = useState(false)

  const variables = useMemo(() => extractVariables(prompt.content), [prompt.content])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
    disabled: !isSortable
  })

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const handleRunClick = (): void => {
    // 変数を含まないプロンプトは従来どおり即実行。含む場合は値入力モードへ。
    if (variables.length === 0) {
      onRun(prompt.content)
      return
    }
    setIsFillingVariables(true)
  }

  const handleVariablesSubmit = (values: Record<string, string>): void => {
    onRun(interpolatePrompt(prompt.content, values))
    setIsFillingVariables(false)
  }

  const handleEditSubmit = (title: string, content: string, tags: string[]): void => {
    onEdit(prompt.id, title, content, tags)
    setIsEditing(false)
  }

  const className = isFillingVariables
    ? 'prompt-item prompt-item--filling-variables'
    : isEditing
      ? 'prompt-item prompt-item--editing'
      : `prompt-item${isSortable ? ' prompt-item--sortable' : ''}${prompt.pinned ? ' prompt-item--pinned' : ''}`

  return (
    <div ref={setNodeRef} style={dragStyle} className={className}>
      {isFillingVariables ? (
        <PromptVariablesForm
          variables={variables}
          onSubmit={handleVariablesSubmit}
          onCancel={() => setIsFillingVariables(false)}
          isRunDisabled={isRunDisabled}
        />
      ) : isEditing ? (
        <PromptEditForm
          prompt={prompt}
          onSubmit={handleEditSubmit}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <PromptItemView
          prompt={prompt}
          isSortable={isSortable}
          dragHandleProps={{ attributes, listeners }}
          isRunDisabled={isRunDisabled}
          onRun={handleRunClick}
          onEditStart={() => setIsEditing(true)}
          onDelete={() => onDelete(prompt.id)}
          onTogglePin={() => onTogglePin(prompt.id)}
        />
      )}
    </div>
  )
}
