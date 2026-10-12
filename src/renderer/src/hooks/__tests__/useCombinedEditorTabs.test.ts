import type { DiffTabKey } from '../useDiffTabs'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { diffTabLabel, useCombinedEditorTabs } from '../useCombinedEditorTabs'
import { encodeDiffTabPath } from '../diffTabPath'
import type { OpenFile } from '../../types'

const fileA: OpenFile = {
  path: '/a.ts',
  name: 'a.ts',
  content: 'a',
  savedContent: 'a',
  language: 'typescript'
}

const dirtyFileB: OpenFile = {
  path: '/b.ts',
  name: 'b.ts',
  content: 'changed',
  savedContent: 'original',
  language: 'typescript'
}

function makeParams(
  overrides?: Partial<Parameters<typeof useCombinedEditorTabs>[0]>
): Parameters<typeof useCombinedEditorTabs>[0] {
  return {
    openFiles: [fileA],
    activeFilePath: fileA.path,
    isDirty: false,
    diffTabs: [],
    activeDiffTab: null,
    agentDiffRunNumber: null,
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onActivateDiffTab: vi.fn(),
    onCloseDiffTab: vi.fn(),
    onDeactivateDiffTab: vi.fn(),
    ...overrides
  }
}

describe('useCombinedEditorTabs', () => {
  it('実ファイルタブが combinedTabs に含まれる', () => {
    const { result } = renderHook(() => useCombinedEditorTabs(makeParams()))
    expect(result.current.combinedTabs).toEqual([
      { path: '/a.ts', name: 'a.ts', isDirty: false, isReorderable: true }
    ])
  })

  it('実ファイルタブは並び替え可能、diff タブは並び替え不可としてマークされる', () => {
    // 並び替えの実体(useFileSystem の reorderTabs)は実ファイルタブだけの配列を
    // 操作するため、diff タブをドラッグ可能にすると範囲外インデックスとして
    // 無言で破棄され、ユーザーには「ドラッグできるのに何も起きない」だけが見える
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ diffTabs: [{ path: 'src/index.ts', kind: 'unstaged' }] }))
    )
    expect(result.current.combinedTabs.map((t) => t.isReorderable)).toEqual([true, false])
  })

  it('diff タブは擬似パスにエンコードされ、名前はフルパス+ステージ状態で表示する', () => {
    // basename だけだと、ディレクトリが違う同名ファイル(src/a/index.ts と
    // src/b/index.ts)や、同じファイルの staged/unstaged 両方の diff タブが
    // 全く同じラベル("index.ts (差分)")になり、タブバー上で区別が付かない
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ diffTabs: [{ path: 'src/index.ts', kind: 'unstaged' }] }))
    )
    expect(result.current.combinedTabs).toContainEqual({
      path: encodeDiffTabPath({ path: 'src/index.ts', kind: 'unstaged' }),
      name: 'src/index.ts (未ステージ差分)',
      isDirty: false,
      isReorderable: false
    })
  })

  it('staged の diff タブは名前に "(ステージ済み差分)" が付く', () => {
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ diffTabs: [{ path: 'src/index.ts', kind: 'staged' }] }))
    )
    expect(result.current.combinedTabs).toContainEqual({
      path: encodeDiffTabPath({ path: 'src/index.ts', kind: 'staged' }),
      name: 'src/index.ts (ステージ済み差分)',
      isDirty: false,
      isReorderable: false
    })
  })

  it('ディレクトリが異なる同名ファイルの diff タブは別ラベルになる', () => {
    const { result } = renderHook(() =>
      useCombinedEditorTabs(
        makeParams({
          diffTabs: [
            { path: 'src/a/index.ts', kind: 'unstaged' },
            { path: 'src/b/index.ts', kind: 'unstaged' }
          ]
        })
      )
    )
    const names = result.current.combinedTabs.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('アクティブな実ファイルタブの isDirty は引数の isDirty をそのまま使う', () => {
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ activeFilePath: fileA.path, isDirty: true }))
    )
    expect(result.current.combinedTabs[0].isDirty).toBe(true)
  })

  it('非アクティブな実ファイルタブの isDirty は content !== savedContent から算出する', () => {
    const { result } = renderHook(() =>
      useCombinedEditorTabs(
        makeParams({
          openFiles: [fileA, dirtyFileB],
          activeFilePath: fileA.path,
          isDirty: false
        })
      )
    )
    expect(result.current.combinedTabs.find((t) => t.path === dirtyFileB.path)?.isDirty).toBe(true)
  })

  it('activeDiffTab がある場合、activeTabPath はエンコードされた diff タブのパスになる', () => {
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ activeDiffTab: { path: 'src/index.ts', kind: 'staged' } }))
    )
    expect(result.current.activeTabPath).toBe(
      encodeDiffTabPath({ path: 'src/index.ts', kind: 'staged' })
    )
  })

  it('activeDiffTab が無い場合、activeTabPath は activeFilePath になる', () => {
    const { result } = renderHook(() => useCombinedEditorTabs(makeParams()))
    expect(result.current.activeTabPath).toBe(fileA.path)
  })

  it('handleActivateTab に diff タブの擬似パスを渡すと onActivateDiffTab がデコードされたキーで呼ばれる', () => {
    const onActivateDiffTab = vi.fn()
    const { result } = renderHook(() => useCombinedEditorTabs(makeParams({ onActivateDiffTab })))
    result.current.handleActivateTab(encodeDiffTabPath({ path: 'src/index.ts', kind: 'staged' }))
    expect(onActivateDiffTab).toHaveBeenCalledWith({ path: 'src/index.ts', kind: 'staged' })
  })

  it('handleActivateTab に実ファイルパスを渡すと onDeactivateDiffTab と onActivateTab が呼ばれる', () => {
    const onDeactivateDiffTab = vi.fn()
    const onActivateTab = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ onDeactivateDiffTab, onActivateTab }))
    )
    result.current.handleActivateTab('/b.ts')
    expect(onDeactivateDiffTab).toHaveBeenCalledOnce()
    expect(onActivateTab).toHaveBeenCalledWith('/b.ts')
  })

  it('onActivateTab が切り替えに失敗した(開いていないパス)場合、diff タブを非アクティブ化しない', () => {
    // 非アクティブ化を先に無条件で行うと、実ファイルタブは切り替わらないのに
    // diff タブだけが消えてプレースホルダ表示になる。useAppState 側の
    // activateTab ラッパーが同じ不変条件を守るために boolean を返すようにした
    // 意図が、ここで打ち消されてしまう
    const onDeactivateDiffTab = vi.fn()
    const onActivateTab = vi.fn().mockReturnValue(false)
    const { result } = renderHook(() =>
      useCombinedEditorTabs(makeParams({ onDeactivateDiffTab, onActivateTab }))
    )
    result.current.handleActivateTab('/not-open.ts')
    expect(onActivateTab).toHaveBeenCalledWith('/not-open.ts')
    expect(onDeactivateDiffTab).not.toHaveBeenCalled()
  })

  it('handleCloseTab に diff タブの擬似パスを渡すと onCloseDiffTab がデコードされたキーで呼ばれる', () => {
    const onCloseDiffTab = vi.fn()
    const { result } = renderHook(() => useCombinedEditorTabs(makeParams({ onCloseDiffTab })))
    result.current.handleCloseTab(encodeDiffTabPath({ path: 'src/index.ts', kind: 'unstaged' }))
    expect(onCloseDiffTab).toHaveBeenCalledWith({ path: 'src/index.ts', kind: 'unstaged' })
  })

  it('handleCloseTab に実ファイルパスを渡すと onCloseTab が呼ばれる', () => {
    const onCloseTab = vi.fn()
    const { result } = renderHook(() => useCombinedEditorTabs(makeParams({ onCloseTab })))
    result.current.handleCloseTab('/a.ts')
    expect(onCloseTab).toHaveBeenCalledWith('/a.ts')
  })

  it('入力(openFiles/activeFilePath/isDirty/diffTabs/activeDiffTab)が変わらないまま再レンダーしても、combinedTabs の参照は変わらない', () => {
    // combinedTabs は毎レンダー map/spread で再構築されており、EditorPanel は
    // isDirty や openFiles の変化(エディタでの1キー入力ごと)で再レンダーされる。
    // useMemo が無いと、diff タブの有無や中身が何も変わっていないときでも
    // 毎回新しい配列・新しい TabItem オブジェクトが作られ、EditorTabs
    // (dnd-kit の DndContext/SortableContext をラップする)へ渡る props が
    // 無駄に変化してしまう
    const params = makeParams()
    const { result, rerender } = renderHook((p) => useCombinedEditorTabs(p), {
      initialProps: params
    })
    const firstCombinedTabs = result.current.combinedTabs
    rerender(params)
    expect(result.current.combinedTabs).toBe(firstCombinedTabs)
  })

  it('diffTabs の中身が変わると combinedTabs の参照も変わる', () => {
    const params = makeParams()
    const { result, rerender } = renderHook((p) => useCombinedEditorTabs(p), {
      initialProps: params
    })
    const firstCombinedTabs = result.current.combinedTabs
    rerender(makeParams({ diffTabs: [{ path: 'src/index.ts', kind: 'unstaged' }] }))
    expect(result.current.combinedTabs).not.toBe(firstCombinedTabs)
  })
})

describe('diffTabLabel', () => {
  it.each<[DiffTabKey, string]>([
    [{ path: 'src/a.ts', kind: 'unstaged' }, 'src/a.ts (未ステージ差分)'],
    [{ path: 'src/a.ts', kind: 'staged' }, 'src/a.ts (ステージ済み差分)'],
    [{ path: 'src/a.ts', kind: 'agent' }, 'src/a.ts (エージェントの変更)']
  ])('%o → %s', (tab, label) => {
    expect(diffTabLabel(tab, null)).toBe(label)
  })
})

describe('エージェントの変更の diff タブのラベルの実行の番号', () => {
  it('実行の番号はアクティブな agent の diff タブにだけ付け、ほかの agent のタブは累積と同じラベル', () => {
    const active = { path: 'a.txt', kind: 'agent' } as const
    const other = { path: 'b.txt', kind: 'agent' } as const
    const { result } = renderHook(() =>
      useCombinedEditorTabs(
        makeParams({
          openFiles: [],
          diffTabs: [active, other],
          activeDiffTab: active,
          agentDiffRunNumber: 2
        })
      )
    )
    expect(result.current.combinedTabs.map((tab) => tab.name)).toEqual([
      'a.txt (エージェントの変更・実行 2)',
      'b.txt (エージェントの変更)'
    ])
  })

  it('diffTabLabel は実行の番号が null なら累積のラベル', () => {
    expect(diffTabLabel({ path: 'a.txt', kind: 'agent' }, null)).toBe('a.txt (エージェントの変更)')
    expect(diffTabLabel({ path: 'a.txt', kind: 'agent' }, 3)).toBe(
      'a.txt (エージェントの変更・実行 3)'
    )
  })
})
