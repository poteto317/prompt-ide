import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import { useDiscardFileChanges } from '../useDiscardFileChanges'
import type { DiscardFileChangesOptions } from '../useDiscardFileChanges'

const files: GitFileStatus[] = [
  { path: 'src/a.ts', index: ' ', workingDir: 'M' },
  { path: 'new.txt', index: '?', workingDir: '?' },
  { path: 'newdir/', index: '?', workingDir: '?' }
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
})
