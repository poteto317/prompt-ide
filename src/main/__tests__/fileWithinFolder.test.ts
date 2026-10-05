import { describe, it, expect, vi } from 'vitest'
import type { FolderAccessManager } from '../folderAccessManager'
import { assertFileWithinFolder } from '../fileWithinFolder'

function makeFolderAccess(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn(),
    ...overrides
  } as unknown as FolderAccessManager
}

describe('assertFileWithinFolder', () => {
  it('assertWithinFolder が成功すればそのまま解決する', async () => {
    const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
    const assertParentWithinFolder = vi.fn()
    const folderAccess = makeFolderAccess({ assertWithinFolder, assertParentWithinFolder })
    await assertFileWithinFolder(folderAccess, '/project', '/project/src/index.ts')
    expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    expect(assertParentWithinFolder).not.toHaveBeenCalled()
  })

  it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、親ディレクトリの境界チェックにフォールバックする', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT'
    })
    const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
    const assertParentWithinFolder = vi.fn().mockResolvedValue(undefined)
    const folderAccess = makeFolderAccess({ assertWithinFolder, assertParentWithinFolder })
    await assertFileWithinFolder(folderAccess, '/project', '/project/deleted.ts')
    expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
  })

  it('assertWithinFolder が ENOTDIR で失敗した場合(祖先がディレクトリではなくファイルに置き換わった)、親ディレクトリの境界チェックにフォールバックする', async () => {
    // git checkout 等でディレクトリだった箇所が同名ファイルに置き換わった場合、
    // realpath は ENOENT ではなく ENOTDIR を投げる。ENOENT だけを見ていると、
    // このケースがフォールバックをすり抜け、未変換の ENOTDIR がそのまま
    // ユーザーへ伝播してしまう
    const enotdir = Object.assign(new Error('ENOTDIR: not a directory'), {
      code: 'ENOTDIR'
    })
    const assertWithinFolder = vi.fn().mockRejectedValue(enotdir)
    const assertParentWithinFolder = vi.fn().mockResolvedValue(undefined)
    const folderAccess = makeFolderAccess({ assertWithinFolder, assertParentWithinFolder })
    await assertFileWithinFolder(folderAccess, '/project', '/project/replaced/file.ts')
    expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project/replaced')
  })

  it('ディレクトリごと削除されていた場合(親も存在しない)、さらに上の祖先まで遡って境界チェックする', async () => {
    // ネストしたディレクトリごと削除されたファイル(例: src/foo/bar/ が丸ごと消えた
    // src/foo/bar/baz.ts)に対する操作では、親ディレクトリ(bar)自体も存在しないため、
    // 1段階のフォールバックだけでは親の realpath が ENOENT で失敗し伝播してしまう
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT'
    })
    const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
    const assertParentWithinFolder = vi
      .fn()
      .mockRejectedValueOnce(enoent)
      .mockResolvedValueOnce('/project/foo')
    const folderAccess = makeFolderAccess({ assertWithinFolder, assertParentWithinFolder })

    await assertFileWithinFolder(folderAccess, '/project', '/project/foo/bar/baz.ts')

    // assertWithinFolder は resolvedPath に対して1回だけ呼ぶ。既に存在しないと
    // 分かっている中間ディレクトリに対して同じ realpath を再度発行しない
    expect(assertWithinFolder).toHaveBeenCalledTimes(1)
    expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/foo/bar/baz.ts')
    expect(assertParentWithinFolder).toHaveBeenNthCalledWith(1, '/project', '/project/foo/bar')
    expect(assertParentWithinFolder).toHaveBeenNthCalledWith(2, '/project', '/project/foo')
  })

  it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、フォールバックせずエラーが伝播する', async () => {
    const assertWithinFolder = vi
      .fn()
      .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
    const assertParentWithinFolder = vi.fn()
    const folderAccess = makeFolderAccess({ assertWithinFolder, assertParentWithinFolder })
    await expect(
      assertFileWithinFolder(folderAccess, '/project', '/outside/deleted.ts')
    ).rejects.toThrow('Access denied')
    expect(assertParentWithinFolder).not.toHaveBeenCalled()
  })
})
