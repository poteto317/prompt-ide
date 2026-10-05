import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
const mockSetupAgentSessionLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterAgentTerminalHandlers = vi.hoisted(() => vi.fn())
const mockStartAgentSession = vi.hoisted(() => vi.fn())
const mockCreateAgentSessionStarter = vi.hoisted(() => vi.fn(() => mockStartAgentSession))
const mockRuntime = vi.hoisted(() => ({
  resolveAgentLaunchFromSystem: vi.fn(),
  spawnAgentPty: vi.fn(),
  stopAgentPtyTree: vi.fn()
}))
const mockSetupOpenFileWatcherLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterExternalChangeHandlers = vi.hoisted(() => vi.fn())
const mockRegisterShellHandlers = vi.hoisted(() => vi.fn())
const mockSendExternalChange = vi.hoisted(() => vi.fn())
// 親ディレクトリの監視(fs.watch)。実物のディレクトリを監視しない
const mockWatch = vi.hoisted(() => vi.fn(() => ({ close: vi.fn(), on: vi.fn() })))

vi.mock('electron', () => ({
  app: {},
  shell: { openExternal: vi.fn() }
}))
vi.mock('../agentSessionLifecycle', () => ({
  setupAgentSessionLifecycle: mockSetupAgentSessionLifecycle
}))
vi.mock('../handlers/agentTerminalHandlers', () => ({
  registerAgentTerminalHandlers: mockRegisterAgentTerminalHandlers
}))
vi.mock('../agentSessionStarter', () => ({
  createAgentSessionStarter: mockCreateAgentSessionStarter
}))
// 実物の node-pty・ログインシェルを読まない
vi.mock('../agentRuntime', () => mockRuntime)
vi.mock('../openFileWatcherLifecycle', () => ({
  setupOpenFileWatcherLifecycle: mockSetupOpenFileWatcherLifecycle
}))
vi.mock('../handlers/externalChangeHandlers', () => ({
  registerExternalChangeHandlers: mockRegisterExternalChangeHandlers,
  sendExternalChange: mockSendExternalChange
}))
// ipcHandlers は名前付きの import(watch)だが、組み込みのモジュールは default 経由で解決されるため両方を差し替える
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, default: { ...actual, watch: mockWatch }, watch: mockWatch }
})
vi.mock('../handlers/shellHandlers', () => ({
  registerShellHandlers: mockRegisterShellHandlers
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
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { OpenFileWatcher, EXTERNAL_CHANGE_DEBOUNCE_MS } from '../openFileWatcher'

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
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

  it('エージェントのセッションの寿命と IPC に、ファイル操作と同じ FolderAccessManager と同じ registry を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const [, registry, lifecycleFolderAccess] = mockSetupAgentSessionLifecycle.mock.calls[0]
    expect(registry).toBeInstanceOf(AgentSessionRegistry)
    expect(lifecycleFolderAccess).toBe(folderAccess)
    const [ipcMain, deps] = mockRegisterAgentTerminalHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    // IPC の受け口には registry と組み立てた starter だけを渡す
    expect(deps).toEqual({ registry, startSession: mockStartAgentSession })
    expect(deps.registry).toBe(registry)
    expect(deps.startSession).toBe(mockStartAgentSession)
  })

  it('エージェントの起動の規則(starter)を、同じ FolderAccessManager・同じ registry・実物の起動の部品で組み立てる', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const registry = mockSetupAgentSessionLifecycle.mock.calls[0][1]
    expect(mockCreateAgentSessionStarter).toHaveBeenCalledOnce()
    const starterDeps = (mockCreateAgentSessionStarter.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(starterDeps.folderAccess).toBe(folderAccess)
    expect(starterDeps.registry).toBe(registry)
    expect(starterDeps.resolveLaunch).toBe(mockRuntime.resolveAgentLaunchFromSystem)
    expect(starterDeps.spawnPty).toBe(mockRuntime.spawnAgentPty)
    expect(starterDeps.stopTree).toBe(mockRuntime.stopAgentPtyTree)
    // セッションの id は呼ぶたびに別の UUID
    const createSessionId = starterDeps.createSessionId as () => string
    const first = createSessionId()
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(createSessionId()).not.toBe(first)
  })

  it('外部変更の IPC と監視の寿命に、同じ FolderAccessManager と同じ OpenFileWatcher を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const [, watcher, lifecycleFolderAccess] = mockSetupOpenFileWatcherLifecycle.mock.calls[0]
    expect(watcher).toBeInstanceOf(OpenFileWatcher)
    expect(lifecycleFolderAccess).toBe(folderAccess)
    expect(mockRegisterExternalChangeHandlers).toHaveBeenCalledWith(
      mockIpcMain,
      folderAccess,
      watcher
    )
    expect(mockRegisterShellHandlers).toHaveBeenCalledWith(mockIpcMain, expect.any(Function))
  })

  it('OpenFileWatcher は親ディレクトリを persistent: false で監視し、変更を sendExternalChange で所有者へ送る', async () => {
    vi.useFakeTimers()
    registerIpcHandlers(mockIpcMain)
    const watcher = mockSetupOpenFileWatcherLifecycle.mock.calls[0][1] as OpenFileWatcher
    watcher.setWatchedFiles(1, ['/a/b.txt'])
    // 監視が main プロセスの終了を妨げない
    expect(mockWatch).toHaveBeenCalledExactlyOnceWith(
      '/a',
      { persistent: false },
      expect.any(Function)
    )
    const listener = (mockWatch.mock.calls[0] as unknown[])[2] as (
      eventType: string,
      filename: string | null
    ) => void
    listener('change', 'b.txt')
    await vi.advanceTimersByTimeAsync(EXTERNAL_CHANGE_DEBOUNCE_MS)
    expect(mockSendExternalChange).toHaveBeenCalledExactlyOnceWith(1, ['/a/b.txt'])
    watcher.setWatchedFiles(1, [])
  })
})
