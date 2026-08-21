import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { StrictMode, createElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { useQuickOpen } from '../useQuickOpen'
import type { QuickOpenController } from '../useQuickOpen'
import type { FileTreeNode } from '../../types'
import type { OpenedFileSignal } from '../useFileSystem'

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
  selectFile?: (node: FileTreeNode, options?: { moveFocusToEditor?: boolean }) => Promise<boolean>
  folderLoadError?: Error | null
  /** StrictMode で包み、レンダーの二重実行下での挙動を確認する */
  strict?: boolean
}

type HookProps = {
  openFilePath: string | null
  openedFileSignal: OpenedFileSignal
  fileTree?: FileTreeNode[]
}

const NO_SIGNAL: OpenedFileSignal = { events: [] }

// 「ファイルを実際に開いた」ことを模す。path の変更と信号の前進を同時に行う。
// 実装と同様、直近のイベントだけを積んだ列を渡す
let signalSeq = 0
let signalEvents: OpenedFileSignal['events'] = []
const openPath = (rerender: (props: HookProps) => void, path: string): void => {
  signalSeq += 1
  signalEvents = [...signalEvents, { id: signalSeq, path, moveFocusToEditor: false }].slice(-10)
  rerender({ openFilePath: path, openedFileSignal: { events: signalEvents } })
}
type Setup = RenderHookResult<QuickOpenController, HookProps> & {
  selectFile: (node: FileTreeNode, options?: { moveFocusToEditor?: boolean }) => Promise<boolean>
  /** フックが評価された回数。レンダーの連鎖が起きていないかの確認に使う */
  renderCount: () => number
}

const setup = (overrides: Overrides = {}): Setup => {
  // テスト間で信号の列が漏れないようリセットする
  signalEvents = []
  const selectFile = overrides.selectFile ?? vi.fn(() => Promise.resolve(true))
  let renders = 0
  const view = renderHook(
    (props: HookProps) => {
      renders++
      return useQuickOpen({
        fileTree: props.fileTree ?? overrides.fileTree ?? tree,
        folderPath: overrides.folderPath === undefined ? FOLDER : overrides.folderPath,
        openFilePath: props.openFilePath,
        openedFileSignal: props.openedFileSignal,
        folderLoadError: overrides.folderLoadError ?? null,
        selectFile
      })
    },
    {
      initialProps: {
        openFilePath: overrides.openFilePath ?? null,
        openedFileSignal: NO_SIGNAL
      },
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

// document 自身を target にすると capture と bubble が同じ AT_TARGET 段階になり、
// stopPropagation の効果を確認できない。実際の操作と同じく子要素から発生させる
const pressKeyOnElement = (element: Element, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  act(() => {
    element.dispatchEvent(event)
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

  it('開閉のたびに keydown リスナーを登録し直さない', () => {
    // リスナーが isOpen に依存して張り替わると、state 更新から
    // 再登録(passive effect)までの間に古いクロージャが残り、
    // その窓に届いた Ctrl+P が古い isOpen で握り潰される
    const addSpy = vi.spyOn(document, 'addEventListener')
    const countKeydown = (): number =>
      addSpy.mock.calls.filter((call) => call[0] === 'keydown').length
    const { result } = setup()
    const before = countKeydown()
    act(() => result.current.open())
    act(() => result.current.close())
    expect(countKeydown()).toBe(before)
    addSpy.mockRestore()
  })

  it('読み込み中の Ctrl+P は握り潰さず開き直す', () => {
    // Enter 直後は読み込み待ちでまだ isOpen が true。ここで Ctrl+P を無視すると
    // 直後に閉じてエディタへフォーカスが移り、続けて打った文字がファイルに入る
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    act(() => result.current.confirm())
    pressKey({ key: 'p', ctrlKey: true })
    expect(result.current.isOpen).toBe(true)
    expect(result.current.query).toBe('')
    // 先行する読み込みが解決しても開き直したダイアログは閉じない
    act(() => resolveSelect(true))
    expect(result.current.isOpen).toBe(true)
  })

  it('Escape で閉じる', () => {
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true })
    pressKey({ key: 'Escape' })
    expect(result.current.isOpen).toBe(false)
  })

  it('フォーカスがダイアログの外にあっても Escape で閉じられる', () => {
    // 入力欄の onKeyDown だけで処理すると、何らかの理由でフォーカスが外れた場合に
    // 閉じる手段が無くなる。document で購読して復帰不能な状態を作らない
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true })
    outside.focus()
    pressKey({ key: 'Escape' })
    expect(result.current.isOpen).toBe(false)
    outside.remove()
  })

  it('IME 変換中の Escape では閉じない', () => {
    // 変換のキャンセルを意図した Escape でダイアログごと消さない
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true })
    const event = pressKey({ key: 'Escape', isComposing: true })
    expect(result.current.isOpen).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('IME 変換中の Ctrl+P では開かない', () => {
    const { result } = setup()
    pressKey({ key: 'p', ctrlKey: true, isComposing: true })
    expect(result.current.isOpen).toBe(false)
  })

  it('閉じているときの Escape は既定動作を妨げない', () => {
    // エディタ側が Escape を使うため、開いていないときに横取りしない
    setup()
    const event = pressKey({ key: 'Escape' })
    expect(event.defaultPrevented).toBe(false)
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

  it('confirm で選択中のファイルを開き、ダイアログを閉じる', async () => {
    const { result, selectFile } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    await act(async () => result.current.confirm())
    expect(selectFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/project/src/App.tsx' }),
      { moveFocusToEditor: true }
    )
    expect(result.current.isOpen).toBe(false)
  })

  it('confirm に index を渡すとその候補を開く(クリック選択用)', async () => {
    const { result, selectFile } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('tsx'))
    const target = result.current.results[1].node.path
    await act(async () => result.current.confirm(1))
    expect(selectFile).toHaveBeenCalledWith(expect.objectContaining({ path: target }), {
      moveFocusToEditor: true
    })
  })

  it('ファイルを開けなかったときダイアログを閉じずクエリも保持する', async () => {
    // 未保存変更の破棄をキャンセルした場合など。閉じてしまうと入力をやり直す羽目になる
    const selectFile = vi.fn(() => Promise.resolve(false))
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    await act(async () => result.current.confirm())
    expect(selectFile).toHaveBeenCalled()
    expect(result.current.isOpen).toBe(true)
    expect(result.current.query).toBe('app')
  })

  it('解決前に confirm を連打しても selectFile は 1 回しか呼ばれない', async () => {
    // Enter のキーリピート対策。selectFile の解決までダイアログは開いたままのため、
    // ガードが無いと破棄確認が複数回出て、後着の読み込みが表示を上書きし得る
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    act(() => result.current.confirm())
    act(() => result.current.confirm())
    act(() => result.current.confirm())
    expect(selectFile).toHaveBeenCalledTimes(1)
    await act(async () => resolveSelect(true))
    expect(result.current.isOpen).toBe(false)
  })

  it('開けずに終わったあとは再度 confirm できる', async () => {
    const selectFile = vi.fn(() => Promise.resolve(false))
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    await act(async () => result.current.confirm())
    await act(async () => result.current.confirm())
    expect(selectFile).toHaveBeenCalledTimes(2)
  })

  it('読み込み中に閉じて開き直した場合、古い結果で新しいダイアログを閉じない', async () => {
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    act(() => result.current.confirm())
    // 読み込みの解決を待たずに閉じ、別の検索を始める
    act(() => result.current.close())
    act(() => result.current.open())
    act(() => result.current.setQuery('main'))
    await act(async () => resolveSelect(true))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.query).toBe('main')
  })

  it('読み込みが解決しないまま閉じても次の confirm がブロックされない', async () => {
    // IPC が長時間保留したまま実行中フラグが残ると、以降ファイルを開けなくなる
    const selectFile = vi.fn(() => new Promise<boolean>(() => {}))
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    act(() => result.current.confirm())
    act(() => result.current.close())
    act(() => result.current.open())
    act(() => result.current.setQuery('main'))
    act(() => result.current.confirm())
    expect(selectFile).toHaveBeenCalledTimes(2)
  })

  it('候補が減ったとき選択位置を有効な範囲に収める', () => {
    const { result, rerender } = setup()
    act(() => result.current.open())
    act(() => result.current.setActiveIndex(3))
    expect(result.current.activeIndex).toBe(3)
    // 現在開いているファイルが除外され候補が 4 件から 3 件に減る
    openPath(rerender, '/project/README.md')
    expect(result.current.results).toHaveLength(3)
    expect(result.current.activeIndex).toBe(2)
  })

  it('候補が減ったあとの moveSelection は補正後の位置から動く', () => {
    const { result, rerender } = setup()
    act(() => result.current.open())
    act(() => result.current.setActiveIndex(3))
    openPath(rerender, '/project/README.md')
    // 表示上は末尾(index 2)。ここから ArrowDown は先頭へラップする
    expect(result.current.activeIndex).toBe(2)
    act(() => result.current.moveSelection(1))
    expect(result.current.activeIndex).toBe(0)
  })

  it('候補が減ったあとの moveSelection(-1) は補正後の位置から戻る', () => {
    const { result, rerender } = setup()
    act(() => result.current.open())
    act(() => result.current.setActiveIndex(3))
    openPath(rerender, '/project/README.md')
    act(() => result.current.moveSelection(-1))
    expect(result.current.activeIndex).toBe(1)
  })

  it('表示中の Escape は他の document ハンドラへ伝播させない', () => {
    // 背後に残っているコンテキストメニュー等が同時に閉じないよう、
    // モーダルの Escape はクイックオープンだけが消費する
    const other = vi.fn()
    document.addEventListener('keydown', other)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const { result } = setup()
    act(() => result.current.open())
    pressKeyOnElement(target, { key: 'Escape' })
    expect(result.current.isOpen).toBe(false)
    expect(other).not.toHaveBeenCalled()
    document.removeEventListener('keydown', other)
    target.remove()
  })

  it('閉じているときの Escape は他のハンドラへ伝播する', () => {
    const other = vi.fn()
    document.addEventListener('keydown', other)
    const target = document.createElement('div')
    document.body.appendChild(target)
    setup()
    pressKeyOnElement(target, { key: 'Escape' })
    expect(other).toHaveBeenCalled()
    document.removeEventListener('keydown', other)
    target.remove()
  })

  it('候補が空になったとき選択位置は 0 になる', () => {
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.setActiveIndex(3))
    act(() => result.current.setQuery('zzzz'))
    expect(result.current.activeIndex).toBe(0)
  })

  it('候補が空のとき confirm しても何も開かず閉じない', async () => {
    const { result, selectFile } = setup()
    act(() => result.current.open())
    act(() => result.current.setQuery('zzzz'))
    await act(async () => result.current.confirm())
    expect(selectFile).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(true)
  })

  it('クエリが空のとき最近開いたファイルを新しい順に並べる', () => {
    const { result, rerender } = setup()
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/main.tsx')
    openPath(rerender, '/project/README.md')
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual(['main.tsx', 'App.tsx'])
  })

  it('クエリが空のとき現在開いているファイルを候補から除外する', () => {
    // 除外しないと Ctrl+P → Enter が現在のファイルの開き直しになり、
    // 未保存の編集がある場合は破棄確認から編集内容を失う経路になる
    const { result, rerender } = setup()
    openPath(rerender, '/project/src/App.tsx')
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.path)).not.toContain('/project/src/App.tsx')
  })

  it('クエリを入力すれば現在開いているファイルも候補に出る', () => {
    const { result, rerender } = setup()
    openPath(rerender, '/project/src/App.tsx')
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    expect(result.current.results.map((r) => r.node.name)).toEqual(['App.tsx'])
  })

  it('同じファイルを開き直しても履歴が重複しない', () => {
    const { result, rerender } = setup()
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/README.md')
    openPath(rerender, '/project/src/main.tsx')
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/index.ts')
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual([
      'App.tsx',
      'main.tsx',
      'README.md'
    ])
  })

  it('リネームによる path 変更では履歴を消費しない', () => {
    // path の変化で積むと、リネームのたびに存在しないパスが履歴の枠を埋め、
    // 実際に開いた別ファイルが空クエリの候補から押し出される
    const { result, rerender } = setup()
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/main.tsx')
    // リネーム相当: openFilePath だけが変わり、信号は進まない
    rerender({
      openFilePath: '/project/src/renamed.tsx',
      openedFileSignal: { events: signalEvents }
    })
    act(() => result.current.open())
    // 履歴は App.tsx と main.tsx のまま。renamed.tsx は積まれない
    expect(result.current.results.map((r) => r.node.name)).toEqual(['main.tsx', 'App.tsx'])
  })

  it('ツリーに存在しないパスは履歴の枠を占有しない', () => {
    // 隠すだけだと枠が埋まり、有効な履歴が上限で押し出される
    const many = Array.from({ length: 12 }, (_, i) => file(`file${i}.ts`, `/project/file${i}.ts`))
    const { result, rerender } = setup({ fileTree: many })
    // ツリーに無いファイルを 5 件開いたことにする
    for (let i = 0; i < 5; i++) openPath(rerender, `/project/ghost${i}.ts`)
    // そのあと実在するファイルを 6 件開く
    for (let i = 0; i < 6; i++) openPath(rerender, `/project/file${i}.ts`)
    act(() => result.current.open())
    // 現在開いている file5.ts を除いた 5 件がすべて残る
    expect(result.current.results.map((r) => r.node.name)).toEqual([
      'file4.ts',
      'file3.ts',
      'file2.ts',
      'file1.ts',
      'file0.ts'
    ])
  })

  it('ツリーから消えたファイルは履歴に残っていても表示しない', () => {
    const { result, rerender } = setup()
    openPath(rerender, '/project/deleted.ts')
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

  it('フォルダ走査の失敗でツリーが空のとき loadError を返す', () => {
    const { result } = setup({ fileTree: [], folderLoadError: new Error('走査に失敗しました') })
    expect(result.current.loadError).toBe('走査に失敗しました')
  })

  it('ツリーが読めていれば loadError は null', () => {
    const { result } = setup({ folderLoadError: new Error('別のエラー') })
    expect(result.current.loadError).toBeNull()
  })

  it('走査以外の失敗(CRUD など)では loadError にしない', () => {
    // 空フォルダで CRUD が失敗しただけなのに「読み込めませんでした」と出さない
    const { result } = setup({ fileTree: [], folderLoadError: null })
    expect(result.current.loadError).toBeNull()
  })

  it('hasHandedOverFocus の参照はレンダーをまたいで安定している', () => {
    // 毎レンダー新しい関数だと、依存に含める側の effect が打鍵ごとに再実行され、
    // フォーカスが外れて戻る(IME の変換が中断され得る)
    const { result } = setup()
    const before = result.current.hasHandedOverFocus
    act(() => result.current.open())
    act(() => result.current.setQuery('app'))
    expect(result.current.hasHandedOverFocus).toBe(before)
  })

  it('読み込み中に閉じてもフォーカスの引き渡しは保持する', async () => {
    // selectFile はキャンセルできないため、Escape で閉じてもファイルは開く。
    // ここで元の要素へフォーカスを戻すと、EditorPanel は「他要素がフォーカス中」
    // として要求を捨て、開いたファイルにフォーカスが移らない
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.confirm())
    act(() => result.current.close())
    expect(result.current.hasHandedOverFocus()).toBe(true)
    await act(async () => {
      resolveSelect(true)
    })
    expect(result.current.hasHandedOverFocus()).toBe(true)
  })

  it('読み込み中に開き直しても、成功した操作の引き渡しは保持する', async () => {
    // 再オープンで世代が進んでも、先行する selectFile はファイルを開き
    // moveFocusToEditor の信号を出す。ここで引き渡しを落とすと、閉じたときに
    // ダイアログが元の要素へフォーカスを戻し、エディタが要求を破棄する
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.confirm())
    // 読み込み中に Ctrl+P で開き直す(世代が進む)
    act(() => result.current.open())
    await act(async () => {
      resolveSelect(true)
    })
    expect(result.current.hasHandedOverFocus()).toBe(true)
  })

  it('閉じたあとに開けなかったと分かったらフォーカスを元へ戻す', async () => {
    // 破棄確認のキャンセルで開けなかった場合、信号も出ないため
    // 引き渡したままだとフォーカスが body に取り残される
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    try {
      const { result } = setup({ selectFile })
      act(() => result.current.open())
      act(() => result.current.rememberFocusOrigin(origin))
      act(() => result.current.confirm())
      act(() => result.current.close())
      await act(async () => {
        resolveSelect(false)
      })
      expect(document.activeElement).toBe(origin)
    } finally {
      origin.remove()
    }
  })

  it('開き直したダイアログを閉じても、成功済みの引き渡しを取り消さない', async () => {
    // 再オープンで世代が進むと startNewGeneration が引き渡しを倒すため、
    // close() のたびに成功済みの状態が消えてツリーへ復帰してしまう
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.confirm())
    // 読み込み中に開き直す
    act(() => result.current.open())
    await act(async () => {
      resolveSelect(true)
    })
    // 再表示中のダイアログを閉じる
    act(() => result.current.close())
    expect(result.current.hasHandedOverFocus()).toBe(true)
  })

  it('結果待ちのまま閉じた場合は復帰を保留する', async () => {
    // 先に元の要素へ戻すと、あとから成功しても EditorPanel が要求を破棄する
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const { result } = setup({ selectFile })
    act(() => result.current.open())
    act(() => result.current.confirm())
    act(() => result.current.open())
    act(() => result.current.close())
    expect(result.current.hasHandedOverFocus()).toBe(true)
    await act(async () => {
      resolveSelect(true)
    })
    expect(result.current.hasHandedOverFocus()).toBe(true)
  })

  it('結果待ちの間は body での上書きから復帰先を守る', async () => {
    // 閉じて開き直すと入力欄のアンマウント後は activeElement が body になる。
    // これで復帰先を上書きすると、失敗時に元の要素へ戻せなくなる
    let resolveSelect: (opened: boolean) => void = () => {}
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSelect = resolve
        })
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    try {
      const { result } = setup({ selectFile })
      act(() => result.current.open())
      act(() => result.current.rememberFocusOrigin(origin))
      act(() => result.current.confirm())
      act(() => result.current.close())
      // 開き直しで body を渡しても、未解決の試行がある間は上書きしない
      act(() => result.current.rememberFocusOrigin(document.body))
      act(() => result.current.close())
      await act(async () => {
        resolveSelect(false)
      })
      expect(document.activeElement).toBe(origin)
    } finally {
      origin.remove()
    }
  })

  it('未解決の試行が残っている間は前回の成功を捨てない', async () => {
    // A が成功・B が未解決のまま閉じて開き直すと、成功済みフラグだけ消える。
    // その後 B が失敗すると復帰処理が走り、A のエディタからフォーカスを奪う
    const resolvers: ((opened: boolean) => void)[] = []
    const selectFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    try {
      const { result } = setup({ selectFile })
      act(() => result.current.open())
      act(() => result.current.rememberFocusOrigin(origin))
      act(() => result.current.confirm())
      // 2 件目を未解決のまま積む
      act(() => result.current.open())
      act(() => result.current.confirm())
      await act(async () => {
        resolvers[0](true)
      })
      act(() => result.current.close())
      act(() => result.current.open())
      act(() => result.current.close())
      await act(async () => {
        resolvers[1](false)
      })
      expect(result.current.hasHandedOverFocus()).toBe(true)
      expect(document.activeElement).not.toBe(origin)
    } finally {
      origin.remove()
    }
  })

  it('読み込み中でなければ閉じてもフォーカスは引き渡さない', () => {
    // 単に Escape で閉じた場合は、元の要素へフォーカスを戻す
    const { result } = setup()
    act(() => result.current.open())
    act(() => result.current.close())
    expect(result.current.hasHandedOverFocus()).toBe(false)
  })

  it('Windows では大文字小文字だけ違う現在のファイルも候補から除外する', () => {
    // case-only rename 直後は openFilePath が新しい表記、ツリーが古い表記になる。
    // 生の比較だと現在のファイルが残り、Ctrl+P → Enter が開き直しになって
    // 未保存の編集を破棄確認から失う経路ができる
    const winTree: FileTreeNode[] = [
      { name: 'a.ts', path: 'C:\\project\\a.ts', type: 'file' },
      { name: 'b.ts', path: 'C:\\project\\b.ts', type: 'file' }
    ]
    const { result } = setup({
      fileTree: winTree,
      folderPath: 'C:\\project',
      openFilePath: 'C:\\Project\\A.ts'
    })
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.path)).toEqual(['C:\\project\\b.ts'])
  })

  it('Windows では表記が違っても履歴からツリーの実体を引ける', () => {
    // 3 件用意する。履歴が引けないと「履歴なし」として全件表示に落ちるため、
    // その差でしか引けたかどうかを判別できない
    const winTree: FileTreeNode[] = [
      { name: 'a.ts', path: 'C:\\project\\a.ts', type: 'file' },
      { name: 'b.ts', path: 'C:\\project\\b.ts', type: 'file' },
      { name: 'c.ts', path: 'C:\\project\\c.ts', type: 'file' }
    ]
    const { result, rerender } = setup({ fileTree: winTree, folderPath: 'C:\\project' })
    // 表記違いで開いた履歴を積み、別ファイルへ移る
    openPath(rerender, 'C:\\Project\\A.ts')
    openPath(rerender, 'C:\\project\\c.ts')
    act(() => result.current.open())
    // 履歴の a.ts はツリーの実体(小文字表記)として引けること
    expect(result.current.results.map((r) => r.node.path)).toEqual(['C:\\project\\a.ts'])
  })

  it('フォルダを開いていれば hasFolder が true になる', () => {
    const { result } = setup()
    expect(result.current.hasFolder).toBe(true)
  })

  it('表示する履歴は上限 10 件までで、古いものから落とす', () => {
    const manyFiles = Array.from({ length: 14 }, (_, i) =>
      file(`file${i}.ts`, `/project/file${i}.ts`)
    )
    const { result, rerender } = setup({ fileTree: manyFiles })
    for (const node of manyFiles) openPath(rerender, node.path)
    act(() => result.current.open())
    // 現在開いている file13 を除き、新しい順に 10 件
    expect(result.current.results.map((r) => r.node.name)).toEqual([
      'file12.ts',
      'file11.ts',
      'file10.ts',
      'file9.ts',
      'file8.ts',
      'file7.ts',
      'file6.ts',
      'file5.ts',
      'file4.ts',
      'file3.ts'
    ])
  })

  it('一時的に存在しなかったパスが有効な履歴を押し出さない', () => {
    // 削除・リネーム直後はツリー更新まで旧パスが files に残る。保持の時点で
    // 存在確認して切り詰めると、その一時的に有効なパスが枠を埋めてしまう
    const base = Array.from({ length: 12 }, (_, i) => file(`file${i}.ts`, `/project/file${i}.ts`))
    const withTemp = [...base, file('temp.ts', '/project/temp.ts')]
    const { result, rerender } = setup({ fileTree: withTemp })
    openPath(rerender, '/project/temp.ts')
    for (let i = 0; i < 11; i++) openPath(rerender, `/project/file${i}.ts`)
    // temp.ts がツリーから消える(削除・リネーム後の再読込)
    rerender({
      openFilePath: '/project/file10.ts',
      openedFileSignal: { events: signalEvents },
      fileTree: base
    })
    act(() => result.current.open())
    const names = result.current.results.map((r) => r.node.name)
    expect(names).not.toContain('temp.ts')
    // 表示上限まで有効な履歴で埋まる(temp.ts に枠を奪われない)
    expect(names).toHaveLength(10)
  })

  it('履歴の途中にあるファイルを開き直すと先頭へ移動する', () => {
    const { result, rerender } = setup()
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/main.tsx')
    openPath(rerender, '/project/README.md')
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/index.ts')
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
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/main.tsx')
    openPath(rerender, '/project/README.md')
    act(() => result.current.open())
    expect(result.current.results.map((r) => r.node.name)).toEqual(['main.tsx', 'App.tsx'])
  })

  it('同じ openFilePath で再レンダーしても履歴が増えない', () => {
    const { result, rerender } = setup({ strict: true })
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/src/App.tsx')
    openPath(rerender, '/project/README.md')
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
    openPath(rerender, '/project/src/App.tsx')
    expect(renderCount() - before).toBeLessThanOrEqual(8)
  })
})
