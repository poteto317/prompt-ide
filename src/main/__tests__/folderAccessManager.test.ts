import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'path'

const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath,
}))

import { FolderAccessManager } from '../folderAccessManager'

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
      await expect(
        manager.assertWithinFolder('/project', '/etc/passwd')
      ).rejects.toThrow('Access denied')
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
      await expect(
        manager.assertWithinFolder('/project', '/project/link')
      ).rejects.toThrow('Access denied')
    })

    it('許可フォルダがルート "/" のとき配下ファイルへのアクセスが許可される', async () => {
      const manager = new FolderAccessManager()
      await expect(
        manager.assertWithinFolder('/', '/etc/passwd')
      ).resolves.toBeUndefined()
    })

    it('..foo という名前のファイルは allowedFolder 内なら許可される', async () => {
      const manager = new FolderAccessManager()
      await expect(
        manager.assertWithinFolder('/project', '/project/..foo')
      ).resolves.toBeUndefined()
    })
  })
})
