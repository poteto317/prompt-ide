import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockAppOn = vi.hoisted(() => vi.fn())
const mockRegisterFileSystemHandlers = vi.hoisted(() => vi.fn())
const mockRegisterGitHandlers = vi.hoisted(() => vi.fn())
const mockRegisterSettingsHandlers = vi.hoisted(() => vi.fn())
const mockRegisterPromptsHandlers = vi.hoisted(() => vi.fn())
const mockRegisterClaudeHandlers = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { on: mockAppOn },
}))

vi.mock('../handlers/fileSystemHandlers', () => ({
  registerFileSystemHandlers: mockRegisterFileSystemHandlers,
}))
vi.mock('../handlers/gitHandlers', () => ({
  registerGitHandlers: mockRegisterGitHandlers,
}))
vi.mock('../handlers/settingsHandlers', () => ({
  registerSettingsHandlers: mockRegisterSettingsHandlers,
}))
vi.mock('../handlers/promptsHandlers', () => ({
  registerPromptsHandlers: mockRegisterPromptsHandlers,
}))
vi.mock('../handlers/claudeHandlers', () => ({
  registerClaudeHandlers: mockRegisterClaudeHandlers,
}))

import { registerIpcHandlers } from '../ipcHandlers'

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerIpcHandlers', () => {
  it('registerFileSystemHandlers を ipcMain と FolderAccessManager を引数に呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterFileSystemHandlers).toHaveBeenCalledOnce()
    expect(mockRegisterFileSystemHandlers).toHaveBeenCalledWith(mockIpcMain, expect.any(Object))
  })

  it('registerGitHandlers を ipcMain と FolderAccessManager を引数に呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterGitHandlers).toHaveBeenCalledOnce()
    expect(mockRegisterGitHandlers).toHaveBeenCalledWith(mockIpcMain, expect.any(Object))
  })

  it('registerSettingsHandlers を呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterSettingsHandlers).toHaveBeenCalledWith(mockIpcMain)
  })

  it('registerPromptsHandlers を呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterPromptsHandlers).toHaveBeenCalledWith(mockIpcMain)
  })

  it('registerClaudeHandlers を呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterClaudeHandlers).toHaveBeenCalledWith(mockIpcMain)
  })

  it('app.on("web-contents-created") リスナーを登録する', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockAppOn).toHaveBeenCalledWith('web-contents-created', expect.any(Function))
  })

  it('fileSystemHandlers と gitHandlers に同一の FolderAccessManager インスタンスを渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const fsArg = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const gitArg = mockRegisterGitHandlers.mock.calls[0][1]
    expect(fsArg).toBe(gitArg)
  })

  it('webContents が destroyed になっても FolderAccessManager の delete がエラーにならない', () => {
    registerIpcHandlers(mockIpcMain)
    const webContentsCreatedCb = mockAppOn.mock.calls.find(
      ([event]) => event === 'web-contents-created'
    )![1]

    let destroyedCb: (() => void) | undefined
    const mockWebContents = {
      id: 1,
      on: (_event: string, cb: () => void) => {
        if (_event === 'destroyed') destroyedCb = cb
      },
    }
    webContentsCreatedCb(null, mockWebContents)
    expect(destroyedCb).toBeDefined()
    expect(() => destroyedCb!()).not.toThrow()
  })
})
