import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'

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
const mockClaudeSessionIdOf = vi.hoisted(() => vi.fn())
const mockLastSessionOf = vi.hoisted(() => vi.fn())
const mockCreateAgentSessionStarter = vi.hoisted(() =>
  vi.fn(() => ({
    start: mockStartAgentSession,
    claudeSessionIdOf: mockClaudeSessionIdOf,
    lastSessionOf: mockLastSessionOf
  }))
)
const mockAgentSessionRecords = vi.hoisted(() => ({ marker: 'records' }))
const mockAgentSessionRecordIo = vi.hoisted(() => ({ marker: 'record-io' }))
const mockCreateAgentSessionRecordStore = vi.hoisted(() => vi.fn(() => mockAgentSessionRecords))
const mockCreateAgentSessionRecordFileIo = vi.hoisted(() => vi.fn(() => mockAgentSessionRecordIo))
vi.mock('../agentSessionRecordStore', () => ({
  createAgentSessionRecordStore: mockCreateAgentSessionRecordStore
}))
vi.mock('../agentSessionRecordFileIo', () => ({
  createAgentSessionRecordFileIo: mockCreateAgentSessionRecordFileIo
}))
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
const mockMkdirSync = vi.hoisted(() => vi.fn())

const mockSetupAgentBaselineLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterAgentChangesHandlers = vi.hoisted(() => vi.fn())
const mockMoveToTrash = vi.hoisted(() => vi.fn())
vi.mock('../agentBaselineLifecycle', () => ({
  setupAgentBaselineLifecycle: mockSetupAgentBaselineLifecycle
}))
vi.mock('../handlers/agentChangesHandlers', () => ({
  registerAgentChangesHandlers: mockRegisterAgentChangesHandlers
}))
vi.mock('../trash', () => ({ moveToTrash: mockMoveToTrash }))
const mockCreateAgentNotificationCenter = vi.hoisted(() =>
  vi.fn<(deps: unknown) => object>(() => ({ marker: 'center' }))
)
const mockSetupAgentNotificationLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterAgentNotificationHandlers = vi.hoisted(() => vi.fn())
const mockFromWebContents = vi.hoisted(() => vi.fn())
vi.mock('../agentNotifications', () => ({
  createAgentNotificationCenter: mockCreateAgentNotificationCenter
}))
const mockCreateElectronAgentNotification = vi.hoisted(() => vi.fn())
vi.mock('../agentNotificationRuntime', () => ({
  createElectronAgentNotification: mockCreateElectronAgentNotification
}))
vi.mock('../agentNotificationLifecycle', () => ({
  setupAgentNotificationLifecycle: mockSetupAgentNotificationLifecycle
}))
vi.mock('../handlers/agentNotificationHandlers', () => ({
  registerAgentNotificationHandlers: mockRegisterAgentNotificationHandlers
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { fromWebContents: mockFromWebContents },
  Notification: vi.fn()
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
  return {
    ...actual,
    default: { ...actual, watch: mockWatch, mkdirSync: mockMkdirSync },
    watch: mockWatch,
    mkdirSync: mockMkdirSync
  }
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
import { isClaudeSessionId } from '@shared/types'
import { CloneRegistry } from '../cloneRegistry'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../agentChangesUndo'
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
    // IPC の受け口には registry と、組み立てた starter の起動・ID の引き当て・「前回」の取得だけを渡す
    expect(deps).toEqual({
      registry,
      startSession: mockStartAgentSession,
      claudeSessionIdOf: mockClaudeSessionIdOf,
      getLastSession: mockLastSessionOf
    })
    expect(deps.registry).toBe(registry)
    expect(deps.startSession).toBe(mockStartAgentSession)
    expect(deps.claudeSessionIdOf).toBe(mockClaudeSessionIdOf)
    expect(deps.getLastSession).toBe(mockLastSessionOf)
  })

  it('通知の center を寿命の後始末と IPC の受け口に渡し、送信元のウィンドウは BrowserWindow.fromWebContents で引く', () => {
    registerIpcHandlers(mockIpcMain)
    const center = mockCreateAgentNotificationCenter.mock.results[0].value
    expect(mockSetupAgentNotificationLifecycle).toHaveBeenCalledWith(expect.any(Object), center)
    const [ipcMain, deps] = mockRegisterAgentNotificationHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    expect(deps.center).toBe(center)
    const sender = { id: 7 }
    mockFromWebContents.mockReturnValueOnce({ marker: 'window' })
    expect(deps.windowOf(sender)).toEqual({ marker: 'window' })
    expect(mockFromWebContents).toHaveBeenCalledWith(sender)
    expect(mockCreateAgentNotificationCenter.mock.calls[0][0]).toMatchObject({
      platform: process.platform,
      // 通知の実物は agentNotificationRuntime.ts のものを注入する
      createNotification: mockCreateElectronAgentNotification
    })
  })

  it('エージェントの変更の記録の寿命と IPC に、ファイル操作と同じ FolderAccessManager・同じ記録の registry・ゴミ箱・取り消しの控えの置き場所と上限を渡し、userData の下に hook の無いディレクトリを用意する', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const [, registry, lifecycleFolderAccess] = mockSetupAgentBaselineLifecycle.mock.calls[0]
    expect(registry).toBeInstanceOf(AgentBaselineRegistry)
    expect(lifecycleFolderAccess).toBe(folderAccess)
    const [ipcMain, deps] = mockRegisterAgentChangesHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    expect(deps.registry).toBe(registry)
    expect(deps.folderAccess).toBe(folderAccess)
    expect(deps.trash).toBe(mockMoveToTrash)
    // 戻す操作の取り消しの控えは OS の一時ディレクトリに、上限は記録の未追跡のファイルの合計の上限と同じ値で取る
    expect(deps.undoCapture).toEqual({ tempRoot: tmpdir(), maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES })
    // 記録の tree を守る ref の hook の無いディレクトリを userData の下に 0700 で用意する
    expect(mockMkdirSync).toHaveBeenCalledWith('/mock/userData/agent-changes-no-hooks', {
      recursive: true,
      mode: 0o700
    })
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
    // 起動の記録は userData の agent-sessions.json(読み込みは組み立ての時点で一度だけ始める)
    expect(mockCreateAgentSessionRecordFileIo).toHaveBeenCalledExactlyOnceWith('/mock/userData')
    expect(mockCreateAgentSessionRecordStore).toHaveBeenCalledExactlyOnceWith(
      mockAgentSessionRecordIo
    )
    expect(starterDeps.records).toBe(mockAgentSessionRecords)
    // 予約の集合は 1 つ(同じ ID の 2 回目は null)
    const reservations = starterDeps.reservations as {
      tryReserve: (id: string) => (() => void) | null
    }
    expect(reservations.tryReserve('11111111-1111-4111-8111-111111111111')).not.toBeNull()
    expect(reservations.tryReserve('11111111-1111-4111-8111-111111111111')).toBeNull()
    // claude のセッション ID は呼ぶたびに別の小文字の UUID v4
    const createClaudeSessionId = starterDeps.createClaudeSessionId as () => string
    const claudeId = createClaudeSessionId()
    expect(isClaudeSessionId(claudeId)).toBe(true)
    expect(createClaudeSessionId()).not.toBe(claudeId)
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
