import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockOpenFolderDialog = vi.hoisted(() => vi.fn())
const mockReadDirRecursive = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())

vi.mock('../dialogService', () => ({
  openFolderDialog: mockOpenFolderDialog,
}))

vi.mock('../fileSystem', () => ({
  readDirRecursive: mockReadDirRecursive,
  readFileContent: mockReadFileContent,
}))

import { registerIpcHandlers } from '../ipcHandlers'

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
  registerIpcHandlers(mockIpcMain)
})

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

  it('fs:readDirectory: readDirRecursive を folderPath で呼ぶ', async () => {
    mockReadDirRecursive.mockResolvedValue([])
    const handler = getRegisteredHandler('fs:readDirectory')
    await handler(null, '/project')
    expect(mockReadDirRecursive).toHaveBeenCalledWith('/project')
  })

  describe('fs:readFile', () => {
    it('allowedFolder が未設定のとき "No folder open" エラーをスロー', async () => {
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/index.ts')).rejects.toThrow('No folder open')
    })

    it('dialog:openFolder 成功後に allowedFolder 内のファイルを readFileContent で読む', async () => {
      mockOpenFolderDialog.mockResolvedValue('/project')
      await getRegisteredHandler('dialog:openFolder')()

      mockReadFileContent.mockResolvedValue('const x = 1')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(null, '/project/src/index.ts')
      expect(mockReadFileContent).toHaveBeenCalledWith('/project/src/index.ts')
      expect(result).toBe('const x = 1')
    })

    it('allowedFolder 外のパスは "Access denied" エラーをスロー', async () => {
      mockOpenFolderDialog.mockResolvedValue('/project')
      await getRegisteredHandler('dialog:openFolder')()

      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/etc/passwd')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('パストラバーサル (/project/../etc/passwd) は "Access denied" エラーをスロー', async () => {
      mockOpenFolderDialog.mockResolvedValue('/project')
      await getRegisteredHandler('dialog:openFolder')()

      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/../etc/passwd')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('dialog:openFolder が null を返したとき allowedFolder は変わらない', async () => {
      mockOpenFolderDialog.mockResolvedValue(null)
      await getRegisteredHandler('dialog:openFolder')()

      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(null, '/project/index.ts')).rejects.toThrow('No folder open')
    })
  })
})
