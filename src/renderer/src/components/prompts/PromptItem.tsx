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
  /** `編集`・`削除` を出すか(一覧の編集モードのときだけ true)。false になったら編集中のフォームを閉じる。省略できない(L-060) */
  canEdit: boolean
  onDelete: (id: string) => void
  onRun: (content: string, prompt: Prompt) => void
  onEdit: (id: string, title: string, content: string, tags: string[]) => void
  onTogglePin: (id: string) => void
  isRunDisabled?: boolean
  isSortable?: boolean
  /** 実行ボタンを押せない理由の要素の id(押せないときだけ渡す) */
  runDisabledReasonId?: string
  runAriaLabel?: string
}

export default function PromptItem({
  prompt,
  canEdit,
  onDelete,
  onRun,
  onEdit,
  onTogglePin,
  isRunDisabled = false,
  isSortable = false,
  runDisabledReasonId,
  runAriaLabel
}: Props): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [isFillingVariables, setIsFillingVariables] = useState(false)

  // 表示モード(canEdit が false)になったら、編集中のフォームを閉じて入力を破棄する(確認は出さない)。isEditing を残したまま
  // 隠すと、編集モードへ戻したときに初期値のフォームが突然開く隠れた状態になる(L-475)。描画の最中に戻すので、閉じる前の
  // フォームは画面に出ない。変数の入力フォーム(isFillingVariables)は実行の操作なので閉じない
  if (!canEdit && isEditing) setIsEditing(false)

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
      onRun(prompt.content, prompt)
      return
    }
    setIsFillingVariables(true)
  }

  const handleVariablesSubmit = (values: Record<string, string>): void => {
    onRun(interpolatePrompt(prompt.content, values), prompt)
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
          runDisabledReasonId={runDisabledReasonId}
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
          canEdit={canEdit}
          dragHandleProps={{ attributes, listeners }}
          isRunDisabled={isRunDisabled}
          runDisabledReasonId={runDisabledReasonId}
          runAriaLabel={runAriaLabel}
          onRun={handleRunClick}
          onEditStart={() => setIsEditing(true)}
          onDelete={() => onDelete(prompt.id)}
          onTogglePin={() => onTogglePin(prompt.id)}
        />
      )}
    </div>
  )
}
