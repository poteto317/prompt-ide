import { useEffect, useRef } from 'react'
import { afterEach, vi } from 'vitest'

// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockAddCommand = vi.fn()

afterEach(() => {
  mockAddCommand.mockClear()
})

interface EditorProps {
  value?: string
  options?: Record<string, unknown>
  onChange?: (value: string | undefined) => void
  onMount?: (editorInstance: unknown, monaco: unknown) => void
  [key: string]: unknown
}

export default function Editor({ options, value, onChange, onMount }: EditorProps) {
  const mountedRef = useRef(false)

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    onMount?.({ addCommand: mockAddCommand }, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } })
  }, [onMount])

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
