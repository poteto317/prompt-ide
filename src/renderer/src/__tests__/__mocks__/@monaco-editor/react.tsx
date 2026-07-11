interface EditorProps {
  value?: string
  options?: Record<string, unknown>
  onChange?: (value: string | undefined) => void
  [key: string]: unknown
}

export default function Editor({ options, value, onChange }: EditorProps) {
  return (
    <div data-testid="monaco-editor" data-readonly={String(options?.readOnly ?? false)}>
      <textarea
        data-testid="monaco-editor-textarea"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}
