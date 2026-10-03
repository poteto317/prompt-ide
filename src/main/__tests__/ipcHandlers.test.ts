import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockSetupFolderAccessLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterFileSystemHandlers = vi.hoisted(() => vi.fn())
const mockRegisterGitHandlers = vi.hoisted(() => vi.fn())
const mockRegisterSettingsHandlers = vi.hoisted(() => vi.fn())
const mockRegisterPromptsHandlers = vi.hoisted(() => vi.fn())
const mockRegisterProgressHandlers = vi.hoisted(() => vi.fn())
const mockRegisterClaudeHandlers = vi.hoisted(() => vi.fn())
const mockRegisterCloneHandlers = vi.hoisted(() => vi.fn())
const mockSetupCloneLifecycle = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {}
}))

vi.mock('../folderAccessLifecycle', () => ({
  setupFolderAccessLifecycle: mockSetupFolderAccessLifecycle
}))

vi.mock('../handlers/fileSystemHandlers', () => ({
  registerFileSystemHandlers: mockRegisterFileSystemHandlers
}))
vi.mock('../handlers/gitHandlers', () => ({
  registerGitHandlers: mockRegisterGitHandlers
}))
vi.mock('../handlers/cloneHandlers', () => ({
  registerCloneHandlers: mockRegisterCloneHandlers
}))
// CloneRegistry は実物を使い、app へのイベントの登録(setupCloneLifecycle)だけを差し替える(app はモックの空オブジェクト)
vi.mock('../cloneLifecycle', () => ({
  setupCloneLifecycle: mockSetupCloneLifecycle
}))
vi.mock('../handlers/settingsHandlers', () => ({
  registerSettingsHandlers: mockRegisterSettingsHandlers
}))
vi.mock('../handlers/promptsHandlers', () => ({
  registerPromptsHandlers: mockRegisterPromptsHandlers
}))
vi.mock('../handlers/progressHandlers', () => ({
  registerProgressHandlers: mockRegisterProgressHandlers
}))
vi.mock('../handlers/claudeHandlers', () => ({
  registerClaudeHandlers: mockRegisterClaudeHandlers
}))

import { registerIpcHandlers } from '../ipcHandlers'
import { CloneRegistry } from '../cloneRegistry'

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerIpcHandlers', () => {
  it('registerCloneHandlers に、ファイル操作と同じ FolderAccessManager と、ウィンドウを閉じたときに中止する CloneRegistry を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterCloneHandlers).toHaveBeenCalledOnce()
    const [ipcMain, folderAccess, registry] = mockRegisterCloneHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    expect(folderAccess).toBe(mockRegisterFileSystemHandlers.mock.calls[0][1])
    expect(registry).toBeInstanceOf(CloneRegistry)
    expect(mockSetupCloneLifecycle).toHaveBeenCalledOnce()
    expect(mockSetupCloneLifecycle.mock.calls[0][1]).toBe(registry)
  })

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

  it('registerProgressHandlers を呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterProgressHandlers).toHaveBeenCalledWith(mockIpcMain)
  })

  it('registerClaudeHandlers を呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterClaudeHandlers).toHaveBeenCalledWith(mockIpcMain)
  })

  it('setupFolderAccessLifecycle を app と FolderAccessManager を引数に呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockSetupFolderAccessLifecycle).toHaveBeenCalledOnce()
    expect(mockSetupFolderAccessLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object)
    )
  })

  it('fileSystemHandlers と gitHandlers に同一の FolderAccessManager インスタンスを渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const fsArg = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const gitArg = mockRegisterGitHandlers.mock.calls[0][1]
    expect(fsArg).toBe(gitArg)
  })
})
