import { useState } from 'react'

interface PromptVariablesFormState {
  values: Record<string, string>
  isDisabled: boolean
  handleChange: (name: string, value: string) => void
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  reset: () => void
}

/**
 * プロンプト変数の値入力フォームの状態管理フック。
 * すべての変数が（trim 後に）非空でない限り送信不可（`usePromptForm` の検証作法に準拠）。
 */
export function usePromptVariablesForm(
  variables: string[],
  onSubmit: (values: Record<string, string>) => void
): PromptVariablesFormState {
  const [values, setValues] = useState<Record<string, string>>({})

  const isDisabled = variables.some((name) => (values[name] ?? '').trim() === '')

  const handleChange = (name: string, value: string): void => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (isDisabled) return
    onSubmit(values)
  }

  const reset = (): void => {
    setValues({})
  }

  return { values, isDisabled, handleChange, handleSubmit, reset }
}
