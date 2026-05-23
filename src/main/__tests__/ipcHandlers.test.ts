import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockOpenFolderDialog = vi.hoisted(() => vi.fn())
const mockReadDirRecursive = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())
const mockAppOn = vi.hoisted(() => vi.fn())
const mockGetGitStatus = vi.hoisted(() => vi.fn())
const mockGetApiKey = vi.hoisted(() => vi.fn())
const mockSetApiKey = vi.hoisted(() => vi.fn())
const mockRunPrompt = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { on: mockAppOn },
}))

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

vi.mock('../gitService', () => ({
  getGitStatus: mockGetGitStatus,
}))

vi.mock('../settingsStore', () => ({
  getApiKey: mockGetApiKey,
  setApiKey: mockSetApiKey,
}))

vi.mock('../claudeService', () => ({
  runPrompt: mockRunPrompt,
}))

import { resolve as resolvePath } from 'path'
import { registerIpcHandlers } from '../ipcHandlers'

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function getWebContentsCreatedCallback(): (
  _event: unknown,
  webContents: { id: number; on: (event: string, cb: () => void) => void }
) => void {
  const call = mockAppOn.mock.calls.find(([event]) => event === 'web-contents-created')
  if (!call) throw new Error('web-contents-created handler not found')
  return call[1]
}

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  registerIpcHandlers(mockIpcMain)
})

function makeEvent(senderId: number) {
  return { sender: { id: senderId } }
}

async function openFolder(path: string, senderId = 1): Promise<void> {
  mockOpenFolderDialog.mockResolvedValue(path)
  await getRegisteredHandler('dialog:openFolder')(makeEvent(senderId))
}

describe('registerIpcHandlers', () => {
  it('dialog:openFolder: openFolderDialog に委譲する', async () => {
    mockOpenFolderDialog.mockResolvedValue('/project')
    const handler = getRegisteredHandler('dialog:openFolder')
    const result = await handler(makeEvent(1))
    expect(mockOpenFolderDialog).toHaveBeenCalledOnce()
    expect(result).toBe('/project')
  })

  it('dialog:openFolder: openFolderDialog が null を返したとき null を返す', async () => {
    mockOpenFolderDialog.mockResolvedValue(null)
    const handler = getRegisteredHandler('dialog:openFolder')
    const result = await handler(makeEvent(1))
    expect(result).toBeNull()
  })

  describe('fs:readDirectory', () => {
    it('allowedFolder が未設定のとき "No folder open" エラーをスロー', async () => {
      const handler = getRegisteredHandler('fs:readDirectory')
      await expect(handler(makeEvent(1), '/project')).rejects.toThrow('No folder open')
    })

    it('dialog:openFolder 成功後に allowedFolder と同じパスで readDirRecursive を呼ぶ', async () => {
      await openFolder('/project')
      mockReadDirRecursive.mockResolvedValue([])
      const handler = getRegisteredHandler('fs:readDirectory')
      await handler(makeEvent(1), '/project')
      expect(mockReadDirRecursive).toHaveBeenCalledWith('/project')
    })

    it('allowedFolder と異なるパスは "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      const handler = getRegisteredHandler('fs:readDirectory')
      await expect(handler(makeEvent(1), '/other')).rejects.toThrow('Access denied')
      expect(mockReadDirRecursive).not.toHaveBeenCalled()
    })
  })

  describe('fs:readFile', () => {
    it('allowedFolder が未設定のとき "No folder open" エラーをスロー', async () => {
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(makeEvent(1), '/project/index.ts')).rejects.toThrow('No folder open')
    })

    it('dialog:openFolder 成功後に allowedFolder 内のファイルを readFileContent で読む', async () => {
      await openFolder('/project')
      mockReadFileContent.mockResolvedValue('const x = 1')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(makeEvent(1), '/project/src/index.ts')
      expect(mockReadFileContent).toHaveBeenCalledWith('/project/src/index.ts')
      expect(result).toBe('const x = 1')
    })

    it('allowedFolder 外のパスは "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(makeEvent(1), '/etc/passwd')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('パストラバーサル (/project/../etc/passwd) は "Access denied" エラーをスロー', async () => {
      await openFolder('/project')
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(makeEvent(1), '/project/../etc/passwd')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('..foo という名前のファイルは allowedFolder 内なら許可される', async () => {
      await openFolder('/project')
      mockReadFileContent.mockResolvedValue('data')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(makeEvent(1), '/project/..foo')
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
      await expect(handler(makeEvent(1), '/project/link')).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('allowedFolder がルート "/" のとき配下ファイルへのアクセスが許可される', async () => {
      await openFolder('/')
      mockReadFileContent.mockResolvedValue('data')
      const handler = getRegisteredHandler('fs:readFile')
      const result = await handler(makeEvent(1), '/etc/passwd')
      expect(mockReadFileContent).toHaveBeenCalledWith('/etc/passwd')
      expect(result).toBe('data')
    })

    it('dialog:openFolder が null を返したとき allowedFolder は変わらない', async () => {
      mockOpenFolderDialog.mockResolvedValue(null)
      await getRegisteredHandler('dialog:openFolder')(makeEvent(1))
      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(makeEvent(1), '/project/index.ts')).rejects.toThrow('No folder open')
    })
  })

  describe('マルチウィンドウ', () => {
    it('WebContents が destroyed になると allowedFolder が解放される', async () => {
      await openFolder('/project')

      const webContentsCreatedCb = getWebContentsCreatedCallback()
      let destroyedCb: (() => void) | undefined
      const mockWebContents = {
        id: 1,
        on: (_event: string, cb: () => void) => {
          if (_event === 'destroyed') destroyedCb = cb
        },
      }
      webContentsCreatedCb(null, mockWebContents)
      expect(destroyedCb).toBeDefined()
      destroyedCb!()

      const handler = getRegisteredHandler('fs:readFile')
      await expect(handler(makeEvent(1), '/project/index.ts')).rejects.toThrow('No folder open')
    })

    it('異なる sender.id のウィンドウは独立した allowedFolder を持つ', async () => {
      await openFolder('/project-a', 1)
      await openFolder('/project-b', 2)

      mockReadFileContent.mockResolvedValue('data')
      const handler = getRegisteredHandler('fs:readFile')

      await expect(handler(makeEvent(1), '/project-a/index.ts')).resolves.toBe('data')
      await expect(handler(makeEvent(1), '/project-b/index.ts')).rejects.toThrow('Access denied')
      await expect(handler(makeEvent(2), '/project-b/index.ts')).resolves.toBe('data')
      await expect(handler(makeEvent(2), '/project-a/index.ts')).rejects.toThrow('Access denied')
    })
  })

  describe('git:getStatus', () => {
    it('allowedFolder が未設定のとき "No folder open" エラーをスロー', async () => {
      const handler = getRegisteredHandler('git:getStatus')
      await expect(handler(makeEvent(1))).rejects.toThrow('No folder open')
    })

    it('dialog:openFolder 成功後に allowedFolder を引数に getGitStatus を呼ぶ', async () => {
      await openFolder('/project')
      const mockResult = { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] }
      mockGetGitStatus.mockResolvedValue(mockResult)
      const handler = getRegisteredHandler('git:getStatus')
      const result = await handler(makeEvent(1))
      expect(mockGetGitStatus).toHaveBeenCalledWith('/project')
      expect(result).toEqual(mockResult)
    })

    it('getGitStatus が throw した場合エラーが伝播する', async () => {
      await openFolder('/project')
      mockGetGitStatus.mockRejectedValue(new Error('git error'))
      const handler = getRegisteredHandler('git:getStatus')
      await expect(handler(makeEvent(1))).rejects.toThrow('git error')
    })
  })

  describe('settings:getApiKey', () => {
    it('getApiKey がキーを返すとき true を返す（平文キーは renderer に渡さない）', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-test')
      const handler = getRegisteredHandler('settings:getApiKey')
      const result = await handler(makeEvent(1))
      expect(mockGetApiKey).toHaveBeenCalledOnce()
      expect(result).toBe(true)
    })

    it('getApiKey が空文字を返すとき false を返す', async () => {
      mockGetApiKey.mockResolvedValue('')
      const handler = getRegisteredHandler('settings:getApiKey')
      const result = await handler(makeEvent(1))
      expect(result).toBe(false)
    })

    it('getApiKey が空白のみを返すとき false を返す（trim ベース判定）', async () => {
      mockGetApiKey.mockResolvedValue('   ')
      const handler = getRegisteredHandler('settings:getApiKey')
      const result = await handler(makeEvent(1))
      expect(result).toBe(false)
    })
  })

  describe('settings:setApiKey', () => {
    it('setApiKey を呼び出す', async () => {
      mockSetApiKey.mockResolvedValue(undefined)
      const handler = getRegisteredHandler('settings:setApiKey')
      await handler(makeEvent(1), 'sk-ant-new')
      expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    })

    it('trim した値を setApiKey に渡す', async () => {
      mockSetApiKey.mockResolvedValue(undefined)
      const handler = getRegisteredHandler('settings:setApiKey')
      await handler(makeEvent(1), '  sk-ant-new  ')
      expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    })

    it('空文字のとき "API キーが空です" エラーをスロー', async () => {
      const handler = getRegisteredHandler('settings:setApiKey')
      await expect(handler(makeEvent(1), '')).rejects.toThrow('API キーが空です')
      expect(mockSetApiKey).not.toHaveBeenCalled()
    })

    it('空白のみのとき "API キーが空です" エラーをスロー', async () => {
      const handler = getRegisteredHandler('settings:setApiKey')
      await expect(handler(makeEvent(1), '   ')).rejects.toThrow('API キーが空です')
      expect(mockSetApiKey).not.toHaveBeenCalled()
    })
  })

  describe('claude:runPrompt', () => {
    it('API キーが未設定のとき "API キーが設定されていません" エラーをスロー', async () => {
      mockGetApiKey.mockResolvedValue('')
      const handler = getRegisteredHandler('claude:runPrompt')
      await expect(
        handler(makeEvent(1), { promptContent: 'プロンプト', fileContent: null })
      ).rejects.toThrow('API キーが設定されていません')
      expect(mockRunPrompt).not.toHaveBeenCalled()
    })

    it('API キーが空白のみのとき "API キーが設定されていません" エラーをスロー', async () => {
      mockGetApiKey.mockResolvedValue('   ')
      const handler = getRegisteredHandler('claude:runPrompt')
      await expect(
        handler(makeEvent(1), { promptContent: 'プロンプト', fileContent: null })
      ).rejects.toThrow('API キーが設定されていません')
      expect(mockRunPrompt).not.toHaveBeenCalled()
    })

    it('API キーが設定されているとき runPrompt を呼んで結果を返す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPrompt.mockResolvedValue('回答テキスト')
      const handler = getRegisteredHandler('claude:runPrompt')
      const result = await handler(makeEvent(1), { promptContent: 'プロンプト', fileContent: 'ファイル' })
      expect(mockRunPrompt).toHaveBeenCalledWith('sk-ant-key', 'プロンプト', 'ファイル')
      expect(result).toBe('回答テキスト')
    })

    it('runPrompt が throw した場合エラーが伝播する', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPrompt.mockRejectedValue(new Error('api error'))
      const handler = getRegisteredHandler('claude:runPrompt')
      await expect(
        handler(makeEvent(1), { promptContent: 'プロンプト', fileContent: null })
      ).rejects.toThrow('api error')
    })
  })
})
