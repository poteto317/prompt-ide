import { useEffect, useRef } from 'react'
import { afterEach, vi } from 'vitest'

// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockAddCommand = vi.fn()
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockFocus = vi.fn()
// 破棄済みインスタンスは Monaco がモデルを失う。テストから状態を差し替えられるようにする
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockEditorModel = { current: {} as object | null }

afterEach(() => {
  mockAddCommand.mockClear()
  mockFocus.mockClear()
  mockEditorModel.current = {}
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
    onMount?.(
      { addCommand: mockAddCommand, focus: mockFocus, getModel: () => mockEditorModel.current },
      { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }
    )
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
