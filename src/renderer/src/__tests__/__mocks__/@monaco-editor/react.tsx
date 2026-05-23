interface EditorProps {
  options?: Record<string, unknown>
  [key: string]: unknown
}

export default function Editor({ options }: EditorProps) {
  return (
    <div
      data-testid="monaco-editor"
      data-readonly={String(options?.readOnly ?? false)}
    />
  )
}
