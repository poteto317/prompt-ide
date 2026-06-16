'use client'
import { useId } from 'react'
import { usePromptVariablesForm } from '../../hooks/usePromptVariablesForm'

interface Props {
  variables: string[]
  onSubmit: (values: Record<string, string>) => void
  onCancel: () => void
  isRunDisabled?: boolean
}

export default function PromptVariablesForm({
  variables,
  onSubmit,
  onCancel,
  isRunDisabled = false
}: Props) {
  const { values, isDisabled, handleChange, handleSubmit } = usePromptVariablesForm(
    variables,
    onSubmit
  )
  // インスタンスごとに一意な id 接頭辞（複数プロンプト同時編集での id 衝突を防ぐ）
  const fieldIdPrefix = useId()

  return (
    <form className="prompt-item__variables-form" onSubmit={handleSubmit}>
      <div className="prompt-item__variables-title">変数を入力して実行</div>
      {variables.map((name) => {
        const fieldId = `${fieldIdPrefix}-${name}`
        return (
          <div key={name} className="prompt-item__variable-row">
            <label className="prompt-item__variable-label" htmlFor={fieldId}>
              {name}
            </label>
            <input
              id={fieldId}
              className="prompt-item__variable-input"
              type="text"
              value={values[name] ?? ''}
              onChange={(e) => handleChange(name, e.target.value)}
              aria-label={`変数 ${name} の値`}
            />
          </div>
        )
      })}
      <div className="prompt-item__edit-actions">
        <button
          type="submit"
          className="prompt-item__save"
          aria-label="変数を差し込んで実行"
          disabled={isDisabled || isRunDisabled}
        >
          実行
        </button>
        <button
          type="button"
          className="prompt-item__cancel"
          aria-label="変数入力をキャンセル"
          onClick={onCancel}
        >
          キャンセル
        </button>
      </div>
    </form>
  )
}
