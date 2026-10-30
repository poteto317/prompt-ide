import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useDiffTabs } from '../useDiffTabs'

describe('useDiffTabs', () => {
  it('openDiffTab で開いたタブが diffTabs に追加され、アクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'src/index.ts', kind: 'unstaged' })
    })
    expect(result.current.diffTabs).toEqual([{ path: 'src/index.ts', kind: 'unstaged' }])
    expect(result.current.activeDiffTab).toEqual({ path: 'src/index.ts', kind: 'unstaged' })
  })

  it('同じ path/staged のタブを再度開いても重複追加せず、アクティブにするだけ', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.diffTabs).toHaveLength(2)
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', kind: 'unstaged' })
  })

  it('同一レンダーサイクル内で複数回 openDiffTab を呼んでも、activeDiffTab は diffTabs 内の既存参照を再利用する', () => {
    // setActiveDiffTab に渡す resolveActiveKey が外側スコープの diffTabs
    // (前回レンダー時点のクロージャ)を見ていると、同一レンダーサイクル内で
    // 複数回 openDiffTab が呼ばれた場合、後続の呼び出しは「まだ何も追加
    // されていない」diffTabs を基準に判定してしまい、既に diffTabs に
    // 追加済みのはずのタブに対しても、呼び出し元が渡した新しいオブジェクトを
    // そのまま activeDiffTab にしてしまう。参照が変わるたびに activeDiffTab を
    // 依存配列に持つ useDiffOperations の effect が無駄に diff を再取得する
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
      // path/staged は1回目と同じだが、別オブジェクト
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    const aInDiffTabs = result.current.diffTabs.find((t) => t.path === 'a.ts')
    expect(result.current.activeDiffTab).toBe(aInDiffTabs)
  })

  it('同じ path で staged が異なる場合は別タブとして扱う', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'a.ts', kind: 'staged' })
    })
    expect(result.current.diffTabs).toHaveLength(2)
  })

  it('closeDiffTab でタブが削除され、閉じたのがアクティブタブなら直前のタブがアクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'b.ts', kind: 'unstaged' })
    })
    expect(result.current.diffTabs).toEqual([{ path: 'a.ts', kind: 'unstaged' }])
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', kind: 'unstaged' })
  })

  it('中間のアクティブタブを閉じると、実ファイルタブ(useFileSystem.ts の computeAdjacentPath)と同じく右隣が優先してアクティブになる', () => {
    // 実ファイルタブと diff タブは同一のタブバーに統合表示されるため、片方が
    // 左隣・もう片方が右隣を優先すると、同じ「タブを閉じる」操作でもタブの種類に
    // よってアクティブの移り先が変わってしまい、ユーザーから見て一貫性が無い
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'c.ts', kind: 'unstaged' })
      result.current.activateDiffTab({ path: 'b.ts', kind: 'unstaged' })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'b.ts', kind: 'unstaged' })
    })
    expect(result.current.activeDiffTab).toEqual({ path: 'c.ts', kind: 'unstaged' })
  })

  it('closeDiffTab で全タブを閉じると activeDiffTab は null になる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.diffTabs).toEqual([])
    expect(result.current.activeDiffTab).toBeNull()
  })

  it('activateDiffTab で指定したタブがアクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
      result.current.activateDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', kind: 'unstaged' })
  })

  it('activateDiffTab に diffTabs に存在しないキーを渡しても、activeDiffTab を「ゴーストタブ」にしない', () => {
    // openDiffTab は必ず diffTabs に追加してから activeDiffTab を設定するが、
    // activateDiffTab は「既存タブをアクティブにする」用途のはずなのに、
    // diffTabs に存在するかどうかの確認をしていなかった。useAppState.ts の
    // gitStatus.files effect による自動 closeDiffTab とタイミングが重なると、
    // 既に閉じられたタブのキーで activateDiffTab が呼ばれ、diffTabs のどの
    // タブとも対応しない activeDiffTab(タブバーにハイライトが無いのに
    // diff 表示だけが残る「ゴーストタブ」)が生まれてしまう
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.closeDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.diffTabs).toEqual([])
    act(() => {
      result.current.activateDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.activeDiffTab).toBeNull()
  })

  it('activateDiffTab に既にアクティブなタブと同じキー(別オブジェクト)を渡しても、activeDiffTab の参照は変わらない', () => {
    // decodeDiffTabPath は呼ぶたびに新しいオブジェクトを生成するため、同じタブを
    // クリックし直すたびに参照が変わると、activeDiffTab を依存配列に持つ
    // useDiffOperations の effect が無駄に diff を再取得してしまう
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    const before = result.current.activeDiffTab
    act(() => {
      result.current.activateDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.activeDiffTab).toBe(before)
  })

  it('deactivateDiffTab で非アクティブ化した後、同じタブを activateDiffTab で再アクティブ化すると diffTabs 内の既存参照を再利用する', () => {
    // deactivateDiffTab 後は activeDiffTab が null になるため、
    // resolveActiveKey の「current と同じキーなら再利用する」ガードが効かず、
    // decodeDiffTabPath が毎回生成する新しいオブジェクトがそのまま
    // activeDiffTab に入ってしまうと、参照が変わるたびに activeDiffTab を
    // 依存配列に持つ useDiffOperations の effect が無駄に diff を再取得してしまう
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    const original = result.current.diffTabs[0]
    act(() => {
      result.current.deactivateDiffTab()
    })
    act(() => {
      // decodeDiffTabPath 相当: 同じ内容だが別オブジェクトを渡す
      result.current.activateDiffTab({ path: 'a.ts', kind: 'unstaged' })
    })
    expect(result.current.activeDiffTab).toBe(original)
  })

  it('deactivateDiffTab で activeDiffTab が null になり、diffTabs 配列自体は変わらない', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
    })
    act(() => {
      result.current.deactivateDiffTab()
    })
    expect(result.current.activeDiffTab).toBeNull()
    expect(result.current.diffTabs).toEqual([
      { path: 'a.ts', kind: 'unstaged' },
      { path: 'b.ts', kind: 'unstaged' }
    ])
  })

  describe('closeDiffTab(境界値)', () => {
    it('開いていないキーを閉じても、diffTabs は同じ参照のままで、アクティブも変わらない', () => {
      const { result } = renderHook(() => useDiffTabs())
      act(() => {
        result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
      })
      const tabsBefore = result.current.diffTabs
      const activeBefore = result.current.activeDiffTab
      act(() => {
        // 同じ path でも kind が違えば別のタブ
        result.current.closeDiffTab({ path: 'a.ts', kind: 'staged' })
      })
      expect(result.current.diffTabs).toBe(tabsBefore)
      expect(result.current.activeDiffTab).toBe(activeBefore)
    })

    it('アクティブでないタブを閉じても、アクティブのタブ(参照)は変えない', () => {
      const { result } = renderHook(() => useDiffTabs())
      act(() => {
        result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
        result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
      })
      const activeBefore = result.current.activeDiffTab
      act(() => {
        result.current.closeDiffTab({ path: 'a.ts', kind: 'unstaged' })
      })
      expect(result.current.diffTabs).toEqual([{ path: 'b.ts', kind: 'unstaged' }])
      expect(result.current.activeDiffTab).toBe(activeBefore)
    })

    it('どの diff タブもアクティブでないときに閉じても、null のまま(残りのタブをアクティブにしない)', () => {
      const { result } = renderHook(() => useDiffTabs())
      act(() => {
        result.current.openDiffTab({ path: 'a.ts', kind: 'unstaged' })
        result.current.openDiffTab({ path: 'b.ts', kind: 'unstaged' })
      })
      act(() => {
        result.current.deactivateDiffTab()
      })
      act(() => {
        result.current.closeDiffTab({ path: 'b.ts', kind: 'unstaged' })
      })
      expect(result.current.diffTabs).toEqual([{ path: 'a.ts', kind: 'unstaged' }])
      expect(result.current.activeDiffTab).toBeNull()
    })
  })
})
