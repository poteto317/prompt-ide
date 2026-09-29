import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import { useDiscardFileChanges } from '../useDiscardFileChanges'
import type { DiscardFileChangesOptions } from '../useDiscardFileChanges'

const files: GitFileStatus[] = [
  { path: 'src/a.ts', index: ' ', workingDir: 'M' },
  { path: 'new.txt', index: '?', workingDir: '?' },
  { path: 'newdir/', index: '?', workingDir: '?' },
  { path: 'ita.txt', index: ' ', workingDir: 'A' }
]

const setup = (
  overrides: Partial<DiscardFileChangesOptions> = {}
): { discard: (path: string) => Promise<boolean>; options: DiscardFileChangesOptions } => {
  const options: DiscardFileChangesOptions = {
    folderPath: '/project',
    files,
    discardFile: vi.fn().mockResolvedValue(true),
    hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
    reloadOpenFile: vi.fn().mockResolvedValue(undefined),
    closeTabsAtOrInside: vi.fn(),
    refreshTree: vi.fn().mockResolvedValue(true),
    onConfirm: vi.fn().mockReturnValue(true),
    ...overrides
  }
  const { result } = renderHook(() => useDiscardFileChanges(options))
  return { discard: (path: string) => result.current(path), options }
}

describe('useDiscardFileChanges', () => {
  it('確認でキャンセルしたら取り消しもタブの同期もしない', async () => {
    const { discard, options } = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    let result = true
    await act(async () => {
      result = await discard('src/a.ts')
    })
    expect(result).toBe(false)
    expect(options.discardFile).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('追跡済みは成功後に対象タブだけを再読込する(絶対パスで渡す)', async () => {
    const { discard, options } = setup()
    await act(async () => {
      await discard('src/a.ts')
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'src/a.ts の変更を取り消しますか？この操作は元に戻せません。'
    )
    expect(options.discardFile).toHaveBeenCalledWith('src/a.ts')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/project/src/a.ts')
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
  })

  it('未追跡は成功後に対象と配下のタブを閉じる', async () => {
    const { discard, options } = setup()
    await act(async () => {
      await discard('newdir/')
    })
    expect(options.onConfirm).toHaveBeenCalledWith('newdir/ をゴミ箱へ移動しますか？')
    expect(options.closeTabsAtOrInside).toHaveBeenCalledWith('/project/newdir/')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  // intent-to-add(git add -N)は main 側で index から外してゴミ箱へ移すため、
  // 未追跡と同じ文言・タブの扱いにする(最終レビューで追加)
  it('intent-to-add は未追跡と同じくゴミ箱への移動として確認し、成功後にタブを閉じる', async () => {
    const { discard, options } = setup()
    await act(async () => {
      await discard('ita.txt')
    })
    expect(options.onConfirm).toHaveBeenCalledWith('ita.txt をゴミ箱へ移動しますか？')
    expect(options.closeTabsAtOrInside).toHaveBeenCalledWith('/project/ita.txt')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('対象のタブに未保存の編集があれば、確認文言に追記する', async () => {
    const { discard, options } = setup({ hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true) })
    await act(async () => {
      await discard('src/a.ts')
    })
    expect(options.hasDirtyTabAtOrInside).toHaveBeenCalledWith('/project/src/a.ts')
    expect(options.onConfirm).toHaveBeenCalledWith(
      'src/a.ts の変更を取り消しますか？この操作は元に戻せません。\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  // 失敗・no-op で同期すると、取り消されていないファイルのタブの未保存の編集が
  // ディスクの内容で上書きされて失われる(docs/review-findings-patterns.md パターン20)
  it('取り消しが成功しなかったらタブに触れない', async () => {
    const { discard, options } = setup({ discardFile: vi.fn().mockResolvedValue(false) })
    let result = true
    await act(async () => {
      result = await discard('src/a.ts')
    })
    expect(result).toBe(false)
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
  })

  it('フォルダが開かれていなければ何もしない', async () => {
    const { discard, options } = setup({ folderPath: null })
    await act(async () => {
      await discard('src/a.ts')
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(options.discardFile).not.toHaveBeenCalled()
  })

  // ファイルウォッチャーが無いため、ゴミ箱へ移した未追跡ファイルがツリーに残り、
  // 復元された削除済みファイルがツリーに現れない(最終レビューで追加)
  it.each(['src/a.ts', 'new.txt'])(
    '取り消しが成功したらファイルツリーを読み直す(%s)',
    async (path) => {
      const { discard, options } = setup()
      await act(async () => {
        await discard(path)
      })
      expect(options.refreshTree).toHaveBeenCalledTimes(1)
    }
  )

  it('キャンセル・失敗のときはファイルツリーを読み直さない', async () => {
    const cancelled = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    const failed = setup({ discardFile: vi.fn().mockResolvedValue(false) })
    await act(async () => {
      await cancelled.discard('src/a.ts')
      await failed.discard('src/a.ts')
    })
    expect(cancelled.options.refreshTree).not.toHaveBeenCalled()
    expect(failed.options.refreshTree).not.toHaveBeenCalled()
  })

  // ツリーの読み直しの失敗はツリー側が自身のエラー表示へ報告するため、
  // 取り消し自体の成功は変えない
  it('ファイルツリーの読み直しが失敗しても取り消しは成功として返す', async () => {
    const { discard } = setup({ refreshTree: vi.fn().mockRejectedValue(new Error('read failed')) })
    let result = false
    await act(async () => {
      result = await discard('new.txt')
    })
    expect(result).toBe(true)
  })
})
