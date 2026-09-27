import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useEditorFocusManager } from '../useEditorFocusManager'
import type { editor } from 'monaco-editor'
import type { OpenedFileSignal } from '../useFileSystem'

function makeEditor(
  overrides?: Partial<editor.IStandaloneCodeEditor>
): editor.IStandaloneCodeEditor {
  return {
    focus: vi.fn(),
    getModel: vi.fn(() => ({})),
    ...overrides
  } as unknown as editor.IStandaloneCodeEditor
}

function makeSignal(id: number, path: string, moveFocusToEditor = true): OpenedFileSignal {
  return { events: [{ id, path, moveFocusToEditor }] }
}

function makeParams(
  overrides?: Partial<Parameters<typeof useEditorFocusManager>[0]>
): Parameters<typeof useEditorFocusManager>[0] {
  return {
    openFilePath: '/a.ts',
    openedFileSignal: { events: [] },
    isOverlayOpen: false,
    ...overrides
  }
}

describe('useEditorFocusManager', () => {
  it('マウント済みのエディタへ、開いた信号に応じてフォーカスする', () => {
    const editorInstance = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams()
    })
    result.current.handleEditorMount(editorInstance, '/a.ts')

    rerender(makeParams({ openedFileSignal: makeSignal(1, '/a.ts') }))

    expect(editorInstance.focus).toHaveBeenCalled()
  })

  it('オーバーレイが開いている間はフォーカスしない', () => {
    const editorInstance = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams({ isOverlayOpen: true })
    })
    result.current.handleEditorMount(editorInstance, '/a.ts')

    rerender(makeParams({ isOverlayOpen: true, openedFileSignal: makeSignal(1, '/a.ts') }))

    expect(editorInstance.focus).not.toHaveBeenCalled()
  })

  it('オーバーレイが閉じた時点で保留中の要求を消費する', () => {
    const editorInstance = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams({ isOverlayOpen: true })
    })
    result.current.handleEditorMount(editorInstance, '/a.ts')
    rerender(makeParams({ isOverlayOpen: true, openedFileSignal: makeSignal(1, '/a.ts') }))
    expect(editorInstance.focus).not.toHaveBeenCalled()

    rerender(makeParams({ isOverlayOpen: false, openedFileSignal: makeSignal(1, '/a.ts') }))

    expect(editorInstance.focus).toHaveBeenCalled()
  })

  it('他の要素がフォーカスを持っているときは奪わない', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const editorInstance = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams()
    })
    result.current.handleEditorMount(editorInstance, '/a.ts')

    rerender(makeParams({ openedFileSignal: makeSignal(1, '/a.ts') }))

    expect(editorInstance.focus).not.toHaveBeenCalled()
    expect(input).toHaveFocus()
    input.remove()
  })

  it('moveFocusToEditor が false の信号はフォーカス要求を立てない', () => {
    const editorInstance = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams()
    })
    result.current.handleEditorMount(editorInstance, '/a.ts')

    rerender(makeParams({ openedFileSignal: makeSignal(1, '/a.ts', false) }))

    expect(editorInstance.focus).not.toHaveBeenCalled()
  })

  it('要求と異なるファイルの onMount は現在のものとして扱わない(false を返す)', () => {
    const editorInstance = makeEditor()
    const { result } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams({ openFilePath: '/a.ts' })
    })

    const isCurrent = result.current.handleEditorMount(editorInstance, '/other.ts')

    expect(isCurrent).toBe(false)
  })

  it('破棄済み(モデルを失った)エディタの onMount は現在のものとして扱わない', () => {
    const editorInstance = makeEditor({ getModel: vi.fn(() => null) })
    const { result } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams({ openFilePath: '/a.ts' })
    })

    const isCurrent = result.current.handleEditorMount(editorInstance, '/a.ts')

    expect(isCurrent).toBe(false)
  })

  it('ファイルを閉じて開き直しても新しいインスタンスでフォーカスする(古いインスタンスは参照しない)', () => {
    const oldEditor = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams({ openFilePath: '/a.ts' })
    })
    result.current.handleEditorMount(oldEditor, '/a.ts')
    rerender(makeParams({ openFilePath: '/a.ts', openedFileSignal: makeSignal(1, '/a.ts') }))
    expect(oldEditor.focus).toHaveBeenCalledTimes(1)

    // ファイルを閉じる(アンマウント)
    rerender(makeParams({ openFilePath: null }))
    // 同じパスを開き直す
    const newEditor = makeEditor()
    rerender(makeParams({ openFilePath: '/a.ts', openedFileSignal: makeSignal(2, '/a.ts') }))
    result.current.handleEditorMount(newEditor, '/a.ts')
    rerender(makeParams({ openFilePath: '/a.ts', openedFileSignal: makeSignal(2, '/a.ts') }))

    expect(newEditor.focus).toHaveBeenCalledTimes(1)
  })

  it('リネームで openFilePath だけが変わってもフォーカスしない', () => {
    const editorInstance = makeEditor()
    const { result, rerender } = renderHook((props) => useEditorFocusManager(props), {
      initialProps: makeParams({ openFilePath: '/a.ts' })
    })
    result.current.handleEditorMount(editorInstance, '/a.ts')
    rerender(makeParams({ openFilePath: '/a.ts', openedFileSignal: makeSignal(1, '/a.ts') }))
    expect(editorInstance.focus).toHaveBeenCalledTimes(1)
    ;(editorInstance.focus as ReturnType<typeof vi.fn>).mockClear()

    rerender(
      makeParams({ openFilePath: '/a-renamed.ts', openedFileSignal: makeSignal(1, '/a.ts') })
    )

    expect(editorInstance.focus).not.toHaveBeenCalled()
  })
})
