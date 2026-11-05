import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'path'

const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath
}))

import { FolderAccessManager, FolderAccessDeniedError } from '../folderAccessManager'

beforeEach(() => {
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
})

describe('FolderAccessManager', () => {
  describe('set / get / delete', () => {
    it('set した値を get で取得できる', () => {
      const manager = new FolderAccessManager()
      manager.set(1, '/project')
      expect(manager.get(1)).toBe('/project')
    })

    it('未設定の ID は undefined を返す', () => {
      const manager = new FolderAccessManager()
      expect(manager.get(99)).toBeUndefined()
    })

    it('delete 後は undefined を返す', () => {
      const manager = new FolderAccessManager()
      manager.set(1, '/project')
      manager.delete(1)
      expect(manager.get(1)).toBeUndefined()
    })

    it('異なる ID の値は独立している', () => {
      const manager = new FolderAccessManager()
      manager.set(1, '/project-a')
      manager.set(2, '/project-b')
      expect(manager.get(1)).toBe('/project-a')
      expect(manager.get(2)).toBe('/project-b')
    })

    it('同じ ID に上書きできる', () => {
      const manager = new FolderAccessManager()
      manager.set(1, '/old')
      manager.set(1, '/new')
      expect(manager.get(1)).toBe('/new')
    })

    it('存在しない ID を delete してもエラーにならない', () => {
      const manager = new FolderAccessManager()
      expect(() => manager.delete(999)).not.toThrow()
    })
  })

  describe('assertWithinFolder', () => {
    it('許可フォルダ内のパスはエラーをスローしない', async () => {
      const manager = new FolderAccessManager()
      await expect(
        manager.assertWithinFolder('/project', '/project/src/index.ts')
      ).resolves.toBeUndefined()
    })

    it('許可フォルダ外のパスは "Access denied" エラーをスロー', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertWithinFolder('/project', '/etc/passwd')).rejects.toThrow(
        'Access denied'
      )
    })

    it('パストラバーサル (/project/../etc/passwd) は "Access denied" エラーをスロー', async () => {
      const manager = new FolderAccessManager()
      await expect(
        manager.assertWithinFolder('/project', '/project/../etc/passwd')
      ).rejects.toThrow('Access denied')
    })

    it('シンボリックリンク経由の外部パスは "Access denied" エラーをスロー', async () => {
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/project/link') return Promise.resolve('/etc/passwd')
        return Promise.resolve(resolvePath(p))
      })
      const manager = new FolderAccessManager()
      await expect(manager.assertWithinFolder('/project', '/project/link')).rejects.toThrow(
        'Access denied'
      )
    })

    it('許可フォルダがルート "/" のとき配下ファイルへのアクセスが許可される', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertWithinFolder('/', '/etc/passwd')).resolves.toBeUndefined()
    })

    it('..foo という名前のファイルは allowedFolder 内なら許可される', async () => {
      const manager = new FolderAccessManager()
      await expect(
        manager.assertWithinFolder('/project', '/project/..foo')
      ).resolves.toBeUndefined()
    })

    it('許可フォルダ自体は「内部」ではないため拒否される(ルートの削除・リネーム防止)', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertWithinFolder('/project', '/project')).rejects.toThrow(
        'Access denied'
      )
    })

    it('許可フォルダがファイルシステムルート "/" 自体でも、そのルート自身は「内部」ではないため拒否される', async () => {
      // allowedPath が既に区切り文字('/')で終わっている場合、prefix が allowedPath と
      // 同一になり、resolvedTarget === allowedPath も startsWith(prefix) を満たして
      // しまう(文字列は自分自身で始まるため)。等値の明示チェックが無いと、開いている
      // フォルダそのもの(この場合はルート "/")へのリネーム・削除が誤って許可される。
      const manager = new FolderAccessManager()
      await expect(manager.assertWithinFolder('/', '/')).rejects.toThrow('Access denied')
    })
  })

  describe('assertParentWithinFolder', () => {
    it('親が許可フォルダ内のとき解決済みの親パスを返す', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertParentWithinFolder('/project', '/project/src')).resolves.toBe(
        '/project/src'
      )
    })

    it('親が許可フォルダ自身のときも許可される(ルート直下への作成)', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertParentWithinFolder('/project', '/project')).resolves.toBe(
        '/project'
      )
    })

    it('親が許可フォルダ外のとき "Access denied" エラーをスロー', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertParentWithinFolder('/project', '/etc')).rejects.toThrow(
        'Access denied'
      )
    })

    it('パストラバーサル (/project/../etc) は "Access denied" エラーをスロー', async () => {
      const manager = new FolderAccessManager()
      await expect(manager.assertParentWithinFolder('/project', '/project/../etc')).rejects.toThrow(
        'Access denied'
      )
    })

    it('シンボリックリンク経由で外部を指す親は "Access denied" エラーをスロー', async () => {
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/project/link') return Promise.resolve('/etc')
        return Promise.resolve(resolvePath(p))
      })
      const manager = new FolderAccessManager()
      await expect(manager.assertParentWithinFolder('/project', '/project/link')).rejects.toThrow(
        'Access denied'
      )
    })

    it('シンボリックリンクの親は解決済みの実パスを返す(内部を指す場合)', async () => {
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/project/link') return Promise.resolve('/project/real')
        return Promise.resolve(resolvePath(p))
      })
      const manager = new FolderAccessManager()
      await expect(manager.assertParentWithinFolder('/project', '/project/link')).resolves.toBe(
        '/project/real'
      )
    })

    it('親が存在しないとき realpath の ENOENT が伝播する', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      mockRealpath.mockRejectedValue(enoent)
      const manager = new FolderAccessManager()
      await expect(
        manager.assertParentWithinFolder('/project', '/project/missing')
      ).rejects.toThrow('ENOENT')
    })
  })
})

describe('FolderAccessManager.onDidChange', () => {
  it('別のパスに変わったときだけ通知し、解除の後は通知しない', () => {
    const manager = new FolderAccessManager()
    const listener = vi.fn()
    const dispose = manager.onDidChange(listener)
    manager.set(1, '/a')
    manager.set(1, '/a')
    manager.set(1, '/b')
    manager.set(2, '/b')
    expect(listener.mock.calls).toEqual([
      [1, '/a'],
      [1, '/b'],
      [2, '/b']
    ])
    dispose()
    manager.set(1, '/c')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('delete は通知しない(ウィンドウの破棄は destroyed で扱う)', () => {
    const manager = new FolderAccessManager()
    manager.set(1, '/a')
    const listener = vi.fn()
    manager.onDidChange(listener)
    manager.delete(1)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('FolderAccessDeniedError', () => {
  it('assertWithinFolder の範囲外 → FolderAccessDeniedError で、文言は Access denied のまま', async () => {
    const manager = new FolderAccessManager()
    const promise = manager.assertWithinFolder('/allowed', '/outside/a.txt')
    await expect(promise).rejects.toBeInstanceOf(FolderAccessDeniedError)
    await expect(promise).rejects.toThrow('Access denied: /outside/a.txt')
  })

  it('assertParentWithinFolder の範囲外 → FolderAccessDeniedError', async () => {
    const manager = new FolderAccessManager()
    await expect(manager.assertParentWithinFolder('/allowed', '/outside')).rejects.toBeInstanceOf(
      FolderAccessDeniedError
    )
  })

  it('name は Error のまま(IPC 越しの文言の前置きを変えない)', () => {
    expect(new FolderAccessDeniedError('x').name).toBe('Error')
  })
})
