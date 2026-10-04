import { useEffect, useLayoutEffect, useRef } from 'react'
import { afterEach, vi } from 'vitest'
import { createMockEditorInstance } from '../createMockEditorInstance'
import type { MockEditorHandle } from '../createMockEditorInstance'

// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockAddCommand = vi.fn()
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockFocus = vi.fn()
// 破棄済みインスタンスは Monaco がモデルを失う。テストから状態を差し替えられるようにする
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockEditorModel = { current: {} as object | null }

// 最後にマウントされた偽のエディタ(テストから選択範囲を変え、編集の呼び出しを確かめる)
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockEditor = { current: null as MockEditorHandle | null }

afterEach(() => {
  mockAddCommand.mockClear()
  mockFocus.mockClear()
  mockEditorModel.current = {}
  mockEditor.current = null
})

interface EditorProps {
  value?: string
  options?: Record<string, unknown>
  onChange?: (value: string | undefined) => void
  onMount?: (editorInstance: unknown, monaco: unknown) => void
  [key: string]: unknown
}

// 注意(このモックの限界):
// - StrictMode では使えない。StrictMode の擬似アンマウントで下の破棄の effect が走ってエディタが破棄済みになり、
//   mountedRef により再マウントの通知(onMount)は送られない(実物は作り直す)
// - useLayoutEffect(依存配列なし)が再描画のたびに valueRef を prop の value へ戻す。onChange が state を
//   更新しない(vi.fn のままの)テストで executeEdits を 2 回続けると、2 回目は再描画の後なら元の value に対して
//   編集され、実物(モデルが編集を保持する)とずれる。続けて反映するテストは value を state で制御すること
export default function Editor({
  options,
  value,
  onChange,
  onMount
}: EditorProps): React.JSX.Element {
  const mountedRef = useRef(false)
  const disposeRef = useRef<(() => void) | null>(null)
  // 編集は描画の外(テストの操作)から呼ばれるため、最新の value・onChange を ref で読む
  const valueRef = useRef(value ?? '')
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    valueRef.current = value ?? ''
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    // 選択範囲・編集・破棄の購読は createMockEditorInstance(テキストの編集は fakeTextBuffer)
    const mock = createMockEditorInstance({
      readValue: () => valueRef.current,
      commitValue: (next) => {
        valueRef.current = next
        onChangeRef.current?.(next)
      },
      getModel: () => mockEditorModel.current
    })
    mockEditor.current = mock.handle
    disposeRef.current = mock.dispose
    onMount?.(
      { ...mock.instance, addCommand: mockAddCommand, focus: mockFocus },
      { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }
    )
  }, [onMount])

  // アンマウントで破棄する(@monaco-editor/react はアンマウントでエディタとモデルを dispose する)
  useEffect(() => () => disposeRef.current?.(), [])

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
