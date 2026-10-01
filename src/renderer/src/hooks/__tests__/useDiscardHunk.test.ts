import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useDiscardHunk } from '../useDiscardHunk'
import type { DiscardHunkOptions } from '../useDiscardHunk'

const setup = (
  overrides: Partial<DiscardHunkOptions> = {}
): { run: (patch: string, hunkHeader: string) => Promise<void>; options: DiscardHunkOptions } => {
  const options: DiscardHunkOptions = {
    folderPath: '/repo',
    activeDiffTabPath: 'src/a.ts',
    discardHunk: vi.fn().mockResolvedValue(true),
    hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
    reloadOpenFile: vi.fn().mockResolvedValue(undefined),
    refreshTree: vi.fn().mockResolvedValue(true),
    onConfirm: vi.fn().mockReturnValue(true),
    ...overrides
  }
  const { result } = renderHook(() => useDiscardHunk(options))
  return { run: result.current, options }
}

describe('useDiscardHunk', () => {
  it('確認で拒否すると discardHunk も再読込も呼ばない', async () => {
    const { run, options } = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    await run('PATCH', '@@ -1 +1 @@')
    expect(options.discardHunk).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.refreshTree).not.toHaveBeenCalled()
  })

  it('確認文言にパス・ハンクの見出し・未保存の編集の有無(絶対パスで判定)を使う', async () => {
    const hasDirtyTabAtOrInside = vi.fn().mockReturnValue(true)
    const onConfirm = vi.fn().mockReturnValue(false)
    const { run } = setup({ hasDirtyTabAtOrInside, onConfirm })
    await run('PATCH', '@@ -1 +1 @@')
    expect(hasDirtyTabAtOrInside).toHaveBeenCalledWith('/repo/src/a.ts')
    expect(onConfirm).toHaveBeenCalledWith(
      'src/a.ts の次のハンクを取り消しますか？この操作は元に戻せません。\n\n@@ -1 +1 @@\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  it('成功すると patch で取り消し、対象ファイルの再読込とツリーの再読込を行う', async () => {
    const { run, options } = setup()
    await run('PATCH', '@@ -1 +1 @@')
    expect(options.discardHunk).toHaveBeenCalledWith('PATCH')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/src/a.ts')
    expect(options.refreshTree).toHaveBeenCalledOnce()
  })

  it('refreshTree が reject しても例外にならない', async () => {
    const { run, options } = setup({ refreshTree: vi.fn().mockRejectedValue(new Error('ng')) })
    await expect(run('PATCH', '@@ -1 +1 @@')).resolves.toBeUndefined()
    expect(options.reloadOpenFile).toHaveBeenCalledOnce()
  })

  it('取り消しが実行されなかった・失敗した(false)ときは再読込もツリーの再読込もしない', async () => {
    const { run, options } = setup({ discardHunk: vi.fn().mockResolvedValue(false) })
    await run('PATCH', '@@ -1 +1 @@')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.refreshTree).not.toHaveBeenCalled()
  })

  it('folderPath が null なら確認も出さず何もしない', async () => {
    const { run, options } = setup({ folderPath: null })
    await run('PATCH', '@@ -1 +1 @@')
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(options.discardHunk).not.toHaveBeenCalled()
  })

  it('activeDiffTabPath が null なら確認も出さず何もしない', async () => {
    const { run, options } = setup({ activeDiffTabPath: null })
    await run('PATCH', '@@ -1 +1 @@')
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(options.discardHunk).not.toHaveBeenCalled()
  })
})
