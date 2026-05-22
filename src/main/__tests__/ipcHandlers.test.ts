import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockOpenFolderDialog = vi.hoisted(() => vi.fn())
const mockReadDirRecursive = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('../dialogService', () => ({
  openFolderDialog: mockOpenFolderDialog,
}))

vi.mock('../fileSystem', () => ({
  readDirRecursive: mockReadDirRecursive,
  readFileContent: mockReadFileContent,
}))

vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath,
}))

import { resolve as resolvePath } from 'path'
import { registerIpcHandlers } from '../ipcHandlers'

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  registerIpcHandlers(mockIpcMain)
})

async function openFolder(path: string): Promise<void> {
  mockOpenFolderDialog.mockResolvedValue(path)
  await getRegisteredHandler('dialog:openFolder')()
}

describe('registerIpcHandlers', () => {
  it('dialog:openFolder: openFolderDialog に委譲する', async () => {
    mockOpenFolderDialog.mockResolvedValue('/project')
    const handler = getRegisteredHandler('dialog:openFolder')
    const result = await handler()
    expect(mockOpenFolderDialog).toHaveBeenCalledOnce()
    expect(result).toBe('/project')
  })

  it('dialog:openFolder: openFolderDialog が null を返したとき null を返す', async () => {
    mockOpenFolderDialog.mockResolvedValue(null)
    const handler = getRegisteredHandler('dialog:openFolder')
    const result = await handler()
    expect(result).toBeNull()
  })

  describe('fs:readDirectory', () => {
    it('allowedFolder が未設定のとき "No folder open" エラーをスロー', async () => {
      const handler = getRegisteredHandler('fs:readDirectory')
      await expect(handler(null, '/project')).rejects.toThrow('No folder open')
    })

    it('dialog:openFolder 成功後に allowedFolder と同じパスで readDirRecursive を呼ぶ', async () => {
      await openFolder('/project')
      mockReadDirRecursive.mockResolvedValue([])
      const handler = getRegisteredHandler('fs:readDirectory')
      await handler(null, '/project')
      expect(mockReadDirRecursive).toHaveBeenCalledWith('/project')
    })

    it('allowedFolder と異なるパスは "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      const handler = getRegisteredHandler('fs:readDirectory')
      await expect(handler(null, '/other')).rejects.toThrow('Access denied')
      expect(mockReadDirRecursive).not.toHaveBeenCalled()
    })
  })

  describe('fs:readFile', () => {
    it('allowedFolder が未設定のとき "No folder open" エラーをスロー', async () => {
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/index.ts')).rejects.toThrow('No folder open')
    })

    it('dialog:openFolder 成功後に allowedFolder 内のファイルを readFileContent で読む', async () => {
      await openFolder('/project')
      mockReadFileContent.mockResolvedValue('const x = 1')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(null, '/project/src/index.ts')
      expect(mockReadFileContent).toHaveBeenCalledWith('/project/src/index.ts')
      expect(result).toBe('const x = 1')
    })

    it('allowedFolder 外のパスは "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/etc/passwd')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('パストラバーサル (/project/../etc/passwd) は "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/../etc/passwd')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('..foo という名前のファイルは allowedFolder 内なら許可される', async () => {
      await openFolder('/project')
      mockReadFileContent.mockResolvedValue('data')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(null, '/project/..foo')
      expect(mockReadFileContent).toHaveBeenCalledWith('/project/..foo')
      expect(result).toBe('data')
    })

    it('シンボリックリンク経由の allowedFolder 外パスは "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/project/link') return Promise.resolve('/etc/passwd')
        return Promise.resolve(p)
      })
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/link')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('allowedFolder がルート "/" のとき配下ファイルへのアクセスが許可される', async () => {
      await openFolder('/')
      mockReadFileContent.mockResolvedValue('data')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(null, '/etc/passwd')
      expect(mockReadFileContent).toHaveBeenCalledWith('/etc/passwd')
      expect(result).toBe('data')
    })

    it('dialog:openFolder が null を返したとき allowedFolder は変わらない', async () => {
      mockOpenFolderDialog.mockResolvedValue(null)
      await getRegisteredHandler('dialog:openFolder')()
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/index.ts')).rejects.toThrow('No folder open')
    })
  })
})
