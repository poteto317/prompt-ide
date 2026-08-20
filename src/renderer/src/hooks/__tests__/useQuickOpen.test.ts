import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { StrictMode, createElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { useQuickOpen } from '../useQuickOpen'
import type { QuickOpenController } from '../useQuickOpen'
import type { FileTreeNode } from '../../types'

const file = (name: string, path: string): FileTreeNode => ({ name, path, type: 'file' })

const FOLDER = '/project'

const tree: FileTreeNode[] = [
  {
    name: 'src',
    path: '/project/src',
    type: 'directory',
    children: [
      file('App.tsx', '/project/src/App.tsx'),
      file('main.tsx', '/project/src/main.tsx'),
      file('index.ts', '/project/src/index.ts')
    ]
  },
  file('README.md', '/project/README.md')
]

type Overrides = {
  fileTree?: FileTreeNode[]
  folderPath?: string | null
  openFilePath?: string | null
  selectFile?: (node: FileTreeNode) => void
  /** StrictMode で包み、レンダーの二重実行下での挙動を確認する */
  strict?: boolean
}

type HookProps = { openFilePath: string | null }
type Setup = RenderHookResult<QuickOpenController, HookProps> & {
  selectFile: (node: FileTreeNode) => void
  /** フックが評価された回数。レンダーの連鎖が起きていないかの確認に使う */
  renderCount: () => number
}

const setup = (overrides: Overrides = {}): Setup => {
  const selectFile = overrides.selectFile ?? vi.fn()
  let renders = 0
  const view = renderHook(
    (props: HookProps) => {
      renders++
      return useQuickOpen({
        fileTree: overrides.fileTree ?? tree,
        folderPath: overrides.folderPath === undefined ? FOLDER : overrides.folderPath,
        openFilePath: props.openFilePath,
        selectFile
      })
    },
    {
      initialProps: { openFilePath: overrides.openFilePath ?? null },
      ...(overrides.strict === true
        ? { wrapper: ({ children }) => createElement(StrictMode, null, children) }
        : {})
    }
  )
  return { ...view, selectFile, renderCount: () => renders }
}

const pressKey = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  act(() => {
    document.dispatchEvent(event)
  })
  return event
}

describe('useQuickOpen', () => {
  it('初期状態は閉じていてクエリが空、選択位置は先頭', () => {
    const { result } = setup()
    expect(result.current.isOpen).toBe(false)
    expect(result.current.query).toBe('')
    expect(result.current.activeIndex).toBe(0)
  })

  it('Ctrl+P で開く', () => {
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true })
    expect(result.current.isOpen).toBe(true)
  })

  it('Cmd+P で開く', () => {
    const { result } = setup()
    pressKey({ key: 'p', metaKey: true })
    expect(result.current.isOpen).toBe(true)
  })

  it('Ctrl+P の既定動作(ブラウザの印刷)を抑止する', () => {
    setup()
    const event = pressKey({ key: 'p', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
  })

  it('大文字の P でも開く', () => {
    const { result } = setup()
    pressKey({ key: 'P', ctrlKey: true })
    expect(result.current.isOpen).toBe(true)
  })

  it('修飾キーなしの P では開かない', () => {
    const { result } = setup()
    pressKey({ key: 'p' })
    expect(result.current.isOpen).toBe(false)
  })

  it('Shift+Ctrl+P では開かない(コマンドパレットと衝突させない)', () => {
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true, shiftKey: true })
    expect(result.current.isOpen).toBe(false)
  })

  it('アンマウント後は keydown を購読しない', () => {
    const { result, unmount } = setup()
    unmount()
    const event = pressKey({ key: 'p', ctrlKey: true })
    expect(event.defaultPrevented).toBe(false)
    expect(result.current.isOpen).toBe(false)
  })

  it('表示中に Ctrl+P を押してもクエリと選択位置を保持する', () => {
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true })
    act(() => result.current.setQuery('app'))
    act(() => result.current.moveSelection(1))
    const activeIndex = result.current.activeIndex
    pressKey({ key: 'p', ctrlKey: true })
    expect(result.current.isOpen).toBe(true)
    expect(result.current.query).toBe('app')
    expect(result.current.activeIndex).toBe(activeIndex)
  })

  it('表示中の Ctrl+P でも既定動作は抑止する', () => {
    setup()
    pressKey({ key: 'p', ctrlKey: true })
    const event = pressKey({ key: 'p', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
  })

  it('close で閉じる', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
  })

  it('開き直すとクエリと選択位置がリセットされる', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    act(() => result.current.close())
    act(() => result.current.open())
    expect(result.current.query).toBe('')
    expect(result.current.activeIndex).toBe(0)
  })

  it('クエリでファイルを絞り込む', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    expect(result.current.results.map((r) => r.node.name)).toEqual(['App.tsx'])
  })

  it('クエリ変更で選択位置が先頭に戻る', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.moveSelection(1))
    act(() => result.current.setQuery('x'))
    expect(result.current.activeIndex).toBe(0)
  })

  it('moveSelection(1) で次の候補へ移動する', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.moveSelection(1))
    expect(result.current.activeIndex).toBe(1)
  })

  it('末尾で moveSelection(1) すると先頭へラップする', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.setActiveIndex(result.current.results.length - 1))
    act(() => result.current.moveSelection(1))
    expect(result.current.activeIndex).toBe(0)
  })

  it('先頭で moveSelection(-1) すると末尾へラップする', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.moveSelection(-1))
    expect(result.current.activeIndex).toBe(result.current.results.length - 1)
  })

  it('候補が空のとき moveSelection しても選択位置は 0 のまま', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('zzzz'))
    act(() => result.current.moveSelection(1))
    expect(result.current.activeIndex).toBe(0)
  })

  it('confirm で選択中のファイルを開き、ダイアログを閉じる', () => {
    const { result, selectFile } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    act(() => result.current.confirm())
    expect(selectFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/project/src/App.tsx' })
    )
    expect(result.current.isOpen).toBe(false)
  })

  it('confirm に index を渡すとその候補を開く(クリック選択用)', () => {
    const { result, selectFile } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('tsx'))
    const target = result.current.results[1].node.path
    act(() => result.current.confirm(1))
    expect(selectFile).toHaveBeenCalledWith(expect.objectContaining({ path: target }))
  })

  it('候補が空のとき confirm しても何も開かず閉じない', () => {
    const { result, selectFile } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('zzzz'))
    act(() => result.current.confirm())
    expect(selectFile).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(true)
  })

  it('クエリが空のとき最近開いたファイルを新しい順に並べる', () => {
    const { result, rerender } = setup()
    rerender({ openFilePath: '/project/src/App.tsx' })
    rerender({ openFilePath: '/project/README.md' })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual(['README.md', 'App.tsx'])
  })

  it('同じファイルを開き直しても履歴が重複しない', () => {
    const { result, rerender } = setup()
    rerender({ openFilePath: '/project/src/App.tsx' })
    rerender({ openFilePath: '/project/README.md' })
    rerender({ openFilePath: '/project/src/App.tsx' })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual(['App.tsx', 'README.md'])
  })

  it('ツリーから消えたファイルは履歴に残っていても表示しない', () => {
    const { result, rerender } = setup()
    rerender({ openFilePath: '/project/deleted.ts' })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.path)).not.toContain('/project/deleted.ts')
  })

  it('履歴が空のときはクエリが空でも全ファイルを表示する', () => {
    const { result } = setup()
    act(() => result.current.open())
    expect(result.current.results).toHaveLength(4)
  })

  it('フォルダ未オープンのとき hasFolder が false で候補が空になる', () => {
    const { result } = setup({ fileTree: [], folderPath: null })
    act(() => result.current.open())
    expect(result.current.hasFolder).toBe(false)
    expect(result.current.results).toEqual([])
  })

  it('フォルダを開いていれば hasFolder が true になる', () => {
    const { result } = setup()
    expect(result.current.hasFolder).toBe(true)
  })

  it('履歴は上限 10 件までしか保持しない', () => {
    const manyFiles = Array.from({ length: 12 }, (_, i) =>
      file(`file${i}.ts`, `/project/file${i}.ts`)
    )
    const { result, rerender } = setup({ fileTree: manyFiles })
    for (const node of manyFiles) rerender({ openFilePath: node.path })
    act(() => result.current.open())
    expect(result.current.results).toHaveLength(10)
  })

  it('履歴の途中にあるファイルを開き直すと先頭へ移動する', () => {
    const { result, rerender } = setup()
    rerender({ openFilePath: '/project/src/App.tsx' })
    rerender({ openFilePath: '/project/src/main.tsx' })
    rerender({ openFilePath: '/project/README.md' })
    rerender({ openFilePath: '/project/src/App.tsx' })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual([
      'App.tsx',
      'README.md',
      'main.tsx'
    ])
  })
})

describe('useQuickOpen (StrictMode)', () => {
  it('レンダーが二重実行されても履歴が重複しない', () => {
    const { result, rerender } = setup({ strict: true })
    rerender({ openFilePath: '/project/src/App.tsx' })
    rerender({ openFilePath: '/project/README.md' })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual(['README.md', 'App.tsx'])
  })

  it('同じ openFilePath で再レンダーしても履歴が増えない', () => {
    const { result, rerender } = setup({ strict: true })
    rerender({ openFilePath: '/project/src/App.tsx' })
    rerender({ openFilePath: '/project/src/App.tsx' })
    rerender({ openFilePath: '/project/src/App.tsx' })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual(['App.tsx'])
  })

  it('履歴更新がレンダーの連鎖を起こさない', () => {
    // openFilePath 由来の state 更新はレンダー中に行っているため、条件ガードが
    // 壊れると更新が収束せず React が "Too many re-renders" を投げる。
    // 収束することに加えて、1 回の prop 変更で走るレンダー回数が
    // StrictMode の二重実行の範囲に収まっていることを確認する。
    const { rerender, renderCount } = setup({ strict: true })
    const before = renderCount()
    rerender({ openFilePath: '/project/src/App.tsx' })
    expect(renderCount() - before).toBeLessThanOrEqual(8)
  })
})
