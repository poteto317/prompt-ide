import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'

const mockHandle = vi.hoisted(() => vi.fn())
const mockSetupFolderAccessLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterFileSystemHandlers = vi.hoisted(() => vi.fn())
const mockRegisterAgentInstructionsHandlers = vi.hoisted(() => vi.fn())
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
const mockSessionInfoOf = vi.hoisted(() => vi.fn())
const mockLastSessionOf = vi.hoisted(() => vi.fn())
const mockCreateAgentSessionStarter = vi.hoisted(() =>
  vi.fn(() => ({
    start: mockStartAgentSession,
    sessionInfoOf: mockSessionInfoOf,
    lastSessionOf: mockLastSessionOf
  }))
)
const mockToolActivity = vi.hoisted(() => ({
  reportWorking: vi.fn(),
  reportWorkingEnded: vi.fn(),
  activityOf: vi.fn(() => ({ phase: 'paused', lost: null, unassignable: false })),
  toolStartSeqOf: vi.fn(() => 0)
}))
const mockHookSessions = vi.hoisted(() => ({ marker: 'hook-sessions' }))
const mockHooksLifecycleParts = vi.hoisted(() => ({ marker: 'hooks-lifecycle-parts' }))
const mockCreateAgentHooksRuntime = vi.hoisted(() =>
  vi.fn(() => ({
    tracker: mockToolActivity,
    sessions: mockHookSessions,
    lifecycleParts: mockHooksLifecycleParts
  }))
)
vi.mock('../agentHooksRuntime', () => ({ createAgentHooksRuntime: mockCreateAgentHooksRuntime }))
const mockSetupAgentHooksLifecycle = vi.hoisted(() => vi.fn())
vi.mock('../agentHooksLifecycle', () => ({
  setupAgentHooksLifecycle: mockSetupAgentHooksLifecycle
}))
// 記録の store と入出力の偽物。種類ごとに作られた値を見分けられるよう、受け取った値を持たせる
const mockCreateAgentSessionRecordStore = vi.hoisted(() =>
  vi.fn((io: unknown) => ({ marker: 'records', io }))
)
const mockCreateAgentSessionRecordFileIo = vi.hoisted(() =>
  vi.fn((_userDataDir: string, fileName: string) => ({ marker: 'record-io', fileName }))
)
vi.mock('../agentSessionRecordStore', () => ({
  createAgentSessionRecordStore: mockCreateAgentSessionRecordStore
}))
// ファイル名の表(AGENT_SESSION_RECORD_FILE_NAMES)は本物を使う
vi.mock('../agentSessionRecordFileIo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentSessionRecordFileIo')>()),
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
const mockSetupFolderChangeWatcherLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterFolderChangeHandlers = vi.hoisted(() => vi.fn())
const mockSendFolderChange = vi.hoisted(() => vi.fn())
// 親ディレクトリの監視(fs.watch)。実物のディレクトリを監視しない
const mockWatch = vi.hoisted(() => vi.fn(() => ({ close: vi.fn(), on: vi.fn() })))
const mockMkdirSync = vi.hoisted(() => vi.fn())

// 記録を取る関数と起動時の掃除(実物の git・一時ディレクトリを使わない。takeSnapshot の包みと掃除の引数を見る)
const mockTakeBaselineSnapshot = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ kind: 'canceled' }>>(async () => ({ kind: 'canceled' }))
)
vi.mock('../agentBaselineSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentBaselineSnapshot')>()),
  takeBaselineSnapshot: mockTakeBaselineSnapshot
}))
const mockSweepStaleBaselineTempDirs = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0)
)
vi.mock('../agentBaselineTempSweep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentBaselineTempSweep')>()),
  sweepStaleBaselineTempDirs: mockSweepStaleBaselineTempDirs
}))
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
// app.isPackaged・app.dock はテストごとに差し替える(beforeEach で開発版・Dock 無しに戻す)
const mockApp = vi.hoisted(() => ({
  getPath: vi.fn(() => '/mock/userData'),
  isPackaged: false,
  dock: undefined as { setBadge: (text: string) => void } | undefined
}))
const mockNotificationIsSupported = vi.hoisted(() => vi.fn(() => true))
vi.mock('electron', () => ({
  app: mockApp,
  shell: { openExternal: vi.fn() },
  BrowserWindow: { fromWebContents: mockFromWebContents },
  Notification: Object.assign(vi.fn(), { isSupported: mockNotificationIsSupported })
}))
// 取り消しの実行は差し替え、組み立てが渡す引数だけを見る(上限の定数は本物を使う)
const mockExecuteAgentChangesUndo = vi.hoisted(() => vi.fn())
vi.mock('../agentChangesUndo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentChangesUndo')>()),
  executeAgentChangesUndo: mockExecuteAgentChangesUndo
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
vi.mock('../folderChangeWatcherLifecycle', () => ({
  setupFolderChangeWatcherLifecycle: mockSetupFolderChangeWatcherLifecycle
}))
vi.mock('../handlers/folderChangeHandlers', () => ({
  registerFolderChangeHandlers: mockRegisterFolderChangeHandlers,
  sendFolderChange: mockSendFolderChange
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
vi.mock('../handlers/agentInstructionsHandlers', () => ({
  registerAgentInstructionsHandlers: mockRegisterAgentInstructionsHandlers
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
import { isCliSessionId } from '@shared/types'
import { CloneRegistry } from '../cloneRegistry'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from '../agentChangesQuery'
import { isProcessAliveOnThisMachine } from '../agentChangesProtectionRef'
import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../agentChangesUndo'
import { OpenFileWatcher, EXTERNAL_CHANGE_DEBOUNCE_MS } from '../openFileWatcher'
import { FolderChangeWatcher, FOLDER_CHANGE_WAIT_MS } from '../folderChangeWatcher'

const mockIpcMain = { handle: mockHandle } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockApp.isPackaged = false
  mockApp.dock = undefined
})

// 通知の center の組み立てに渡した依存
function notificationCenterDeps(): {
  isSupported: () => boolean
  setDockBadge: (text: string) => void
} {
  return mockCreateAgentNotificationCenter.mock.calls[0][0] as never
}

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

  it('registerFileSystemHandlers を ipcMain と FolderAccessManager と全体の指示ファイルの文脈を引数に呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterFileSystemHandlers).toHaveBeenCalledOnce()
    const [ipc, folderAccess, globalInstructions] = mockRegisterFileSystemHandlers.mock.calls[0]
    expect(ipc).toBe(mockIpcMain)
    expect(folderAccess).toBeInstanceOf(FolderAccessManager)
    // ホームは resolve で正規化した値(HOME の末尾の区切りで、場所とホームの文字列の比較を食い違わせない)
    expect(globalInstructions).toEqual(
      expect.objectContaining({ locations: expect.anything(), homeDir: resolve(homedir()) })
    )
  })

  it('registerAgentInstructionsHandlers を ipcMain と registerFileSystemHandlers と同じ FolderAccessManager と全体の指示ファイルの文脈で呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterAgentInstructionsHandlers).toHaveBeenCalledOnce()
    const [ipcMain, folderAccess] = mockRegisterAgentInstructionsHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    // 同じインスタンス(深い比較ではなく参照)。別の FolderAccessManager だと許可フォルダが常に無い
    expect(folderAccess).toBe(mockRegisterFileSystemHandlers.mock.calls[0][1])
    // 全体の指示ファイルの文脈も同じ値を共有する(L-060)
    const globalInstructions = mockRegisterFileSystemHandlers.mock.calls[0][2]
    expect(mockRegisterAgentInstructionsHandlers.mock.calls[0][2]).toBe(globalInstructions)
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
      sessionInfoOf: mockSessionInfoOf,
      getLastSession: mockLastSessionOf,
      reportWorking: mockToolActivity.reportWorking,
      reportWorkingEnded: mockToolActivity.reportWorkingEnded
    })
    expect(deps.registry).toBe(registry)
    expect(deps.startSession).toBe(mockStartAgentSession)
    expect(deps.sessionInfoOf).toBe(mockSessionInfoOf)
    expect(deps.getLastSession).toBe(mockLastSessionOf)
    expect(deps.reportWorking).toBe(mockToolActivity.reportWorking)
    expect(deps.reportWorkingEnded).toBe(mockToolActivity.reportWorkingEnded)
  })

  it('hooks のつなぎ先を、記録の registry の notifyAttributionSignal・waitForAgentPhase・markToolStartTimedOut にする(生成の順は hooks の runtime → registry のまま)', async () => {
    const notify = vi.spyOn(AgentBaselineRegistry.prototype, 'notifyAttributionSignal')
    const wait = vi.spyOn(AgentBaselineRegistry.prototype, 'waitForAgentPhase')
    const mark = vi.spyOn(AgentBaselineRegistry.prototype, 'markToolStartTimedOut')
    try {
      registerIpcHandlers(mockIpcMain)
      expect(mockCreateAgentHooksRuntime).toHaveBeenCalledOnce()
      const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1]
      const options = (mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0] as {
        onPhaseChange: (ownerId: number) => void
        onToolStart: (ownerId: number, signal: AbortSignal) => Promise<void>
        onToolStartTimedOut: (ownerId: number) => void
        devLog: ((line: string) => void) | null
      }
      options.onPhaseChange(3)
      expect(notify).toHaveBeenCalledExactlyOnceWith(3)
      expect(notify.mock.contexts[0]).toBe(registry)
      const controller = new AbortController()
      await expect(options.onToolStart(3, controller.signal)).resolves.toBeUndefined()
      expect(wait).toHaveBeenCalledExactlyOnceWith(3, controller.signal)
      expect(wait.mock.contexts[0]).toBe(registry)
      options.onToolStartTimedOut(3)
      expect(mark).toHaveBeenCalledExactlyOnceWith(3)
      expect(mark.mock.contexts[0]).toBe(registry)
      expect(typeof options.devLog).toBe('function')
    } finally {
      notify.mockRestore()
      wait.mockRestore()
      mark.mockRestore()
    }
  })

  it('段階の通知・打ち切りのつなぎ先は、記録が無いときも registry の close の後も投げない', () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    const options = (mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0] as {
      onPhaseChange: (ownerId: number) => void
      onToolStartTimedOut: (ownerId: number) => void
    }
    expect(() => options.onPhaseChange(1)).not.toThrow()
    expect(() => options.onToolStartTimedOut(1)).not.toThrow()
    registry.close()
    expect(() => options.onPhaseChange(1)).not.toThrow()
    expect(() => options.onToolStartTimedOut(1)).not.toThrow()
  })

  it('組み立てた hooks の準備を starter に、片付けるものを will-quit の後始末に渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const starterDeps = (mockCreateAgentSessionStarter.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(starterDeps.hooks).toBe(mockHookSessions)
    expect(mockSetupAgentHooksLifecycle).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      mockHooksLifecycleParts
    )
  })

  it('copilot の hooks のフォルダの置き場として userData のパスを hooks の組み立てに渡す', () => {
    registerIpcHandlers(mockIpcMain)
    expect((mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0]).toMatchObject({
      userDataDir: '/mock/userData'
    })
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

  it('通知の対応の有無は、呼ばれたときに Notification.isSupported で調べる', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockNotificationIsSupported).not.toHaveBeenCalled()
    mockNotificationIsSupported.mockReturnValueOnce(false)
    expect(notificationCenterDeps().isSupported()).toBe(false)
    expect(mockNotificationIsSupported).toHaveBeenCalledOnce()
  })

  it('Dock があればバッジを app.dock.setBadge で付け、Dock が無い環境(macOS 以外)では何もしない', () => {
    registerIpcHandlers(mockIpcMain)
    const { setDockBadge } = notificationCenterDeps()
    expect(() => setDockBadge('1')).not.toThrow()
    const setBadge = vi.fn()
    mockApp.dock = { setBadge }
    setDockBadge('2')
    expect(setBadge).toHaveBeenCalledExactlyOnceWith('2')
  })

  it('開発版(app.isPackaged でない)では、hooks と区別のログを console.log へ出す', () => {
    registerIpcHandlers(mockIpcMain)
    const hooksOptions = (mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0] as {
      devLog: ((line: string) => void) | null
    }
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      hooksOptions.devLog?.('hooks line')
      deps.attributionDevLog?.('attribution line')
      expect(logSpy.mock.calls).toEqual([['hooks line'], ['attribution line']])
    } finally {
      logSpy.mockRestore()
    }
  })

  it('配布版(app.isPackaged)では、hooks と区別のログを出さない(null を渡す)', () => {
    mockApp.isPackaged = true
    registerIpcHandlers(mockIpcMain)
    expect((mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0]).toMatchObject({
      devLog: null
    })
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    expect(deps.attributionDevLog).toBeNull()
  })

  it('記録の registry の取り消しは、許可のフォルダ・控え・ゴミ箱(moveToTrash)で executeAgentChangesUndo を呼ぶ', async () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    const execution = { kind: 'done', restoredPaths: [], trashedPaths: [] }
    mockExecuteAgentChangesUndo.mockResolvedValueOnce(execution)
    const undo = { undoId: 1, operation: 'file', dir: '/tmp/undo', items: [] } as never
    await expect(deps.executeUndo('/folder', undo)).resolves.toBe(execution)
    expect(mockExecuteAgentChangesUndo).toHaveBeenCalledExactlyOnceWith({
      folderPath: '/folder',
      undo,
      trash: mockMoveToTrash
    })
  })

  it('起動時の掃除が失敗しても、組み立ては続き、失敗を握りつぶす(未処理の拒否にしない)', async () => {
    // vi.fn は戻り値の Promise に結果の追跡の then を付けるため、unhandledRejection では検出できない。
    // 返す Promise に catch が付けられ、その catch が拒否を解決に変えることを直接確かめる
    const rejected = Promise.reject(new Error('sweep failed'))
    const catchSpy = vi.spyOn(rejected, 'catch')
    mockSweepStaleBaselineTempDirs.mockReturnValueOnce(rejected)
    expect(() => registerIpcHandlers(mockIpcMain)).not.toThrow()
    expect(catchSpy).toHaveBeenCalledOnce()
    await expect(catchSpy.mock.results[0].value).resolves.toBeUndefined()
    expect(mockRegisterAgentChangesHandlers).toHaveBeenCalledOnce()
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

  it('記録の registry に、追跡(区別の合図と通し番号)・区切りの差分・今の区間の比較・開発版の区別のログ(app.isPackaged でないとき)・失敗のログ(console.warn)を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    // 依存は private のため、組み立ての確認に限って型を外して読む
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    expect(deps.attributionSource).toBe(mockToolActivity)
    expect(deps.collectBetween).toBe(collectAgentChangeEntriesBetween)
    expect(deps.collectCurrent).toBe(collectAgentChangeEntries)
    expect(typeof deps.attributionDevLog).toBe('function')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const err = new Error('boom')
      deps.attributionWarn('[agent-attribution] 同期に失敗しました:', err)
      expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
        '[agent-attribution] 同期に失敗しました:',
        err
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('起動ごとの ID を 1 回だけ作り、保護の ref と記録を取る関数(takeSnapshot の包み)と起動時の掃除に同じ値を渡す(L-060)。一時ディレクトリの親も同じ値を両方に渡す', async () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    // 依存は private のため、組み立ての確認に限って型を外して読む
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    const { instanceId } = deps.protection
    expect(instanceId).toMatch(new RegExp(`^${process.pid}-[0-9a-f]{8}$`))
    const isCanceled = (): boolean => false
    const now = (): number => 7
    await deps.takeSnapshot('/folder', { isCanceled, now })
    expect(mockTakeBaselineSnapshot).toHaveBeenCalledExactlyOnceWith('/folder', {
      isCanceled,
      now,
      instanceId,
      tempRoot: tmpdir()
    })
    expect(mockSweepStaleBaselineTempDirs).toHaveBeenCalledExactlyOnceWith({
      tempRoot: tmpdir(),
      instanceId,
      isProcessAlive: isProcessAliveOnThisMachine
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
    // 起動の記録は種類ごとに userData の別のファイル(claude は今の agent-sessions.json)。読み込みは組み立ての時点で一度だけ始める
    expect(mockCreateAgentSessionRecordFileIo.mock.calls).toEqual([
      ['/mock/userData', 'agent-sessions.json'],
      ['/mock/userData', 'agent-sessions-copilot.json']
    ])
    expect(mockCreateAgentSessionRecordStore).toHaveBeenCalledTimes(2)
    expect(starterDeps.records).toEqual({
      claude: { marker: 'records', io: { marker: 'record-io', fileName: 'agent-sessions.json' } },
      copilot: {
        marker: 'records',
        io: { marker: 'record-io', fileName: 'agent-sessions-copilot.json' }
      }
    })
    // 予約の集合は 1 つ(同じ ID の 2 回目は null)
    const reservations = starterDeps.reservations as {
      tryReserve: (id: string) => (() => void) | null
    }
    expect(reservations.tryReserve('11111111-1111-4111-8111-111111111111')).not.toBeNull()
    expect(reservations.tryReserve('11111111-1111-4111-8111-111111111111')).toBeNull()
    // 新しい会話の ID(再開に対応する種類で共通)は呼ぶたびに別の小文字の UUID v4
    const createCliSessionId = starterDeps.createCliSessionId as () => string
    const cliId = createCliSessionId()
    expect(isCliSessionId(cliId)).toBe(true)
    expect(createCliSessionId()).not.toBe(cliId)
  })

  it('外部変更の IPC と監視の寿命に、同じ FolderAccessManager と同じ OpenFileWatcher と、同じ全体の指示ファイルの文脈を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const [, watcher, lifecycleFolderAccess] = mockSetupOpenFileWatcherLifecycle.mock.calls[0]
    expect(watcher).toBeInstanceOf(OpenFileWatcher)
    expect(lifecycleFolderAccess).toBe(folderAccess)
    const globalInstructions = mockRegisterFileSystemHandlers.mock.calls[0][2]
    expect(globalInstructions.homeDir).toBe(resolve(homedir()))
    expect(mockRegisterExternalChangeHandlers).toHaveBeenCalledOnce()
    const [ipc, externalFolderAccess, externalWatcher, externalGlobal] =
      mockRegisterExternalChangeHandlers.mock.calls[0]
    expect(ipc).toBe(mockIpcMain)
    expect(externalFolderAccess).toBe(folderAccess)
    expect(externalWatcher).toBe(watcher)
    expect(externalGlobal).toBe(globalInstructions)
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

  it('開いているフォルダの監視の寿命と IPC に、同じ FolderAccessManager と同じ FolderChangeWatcher を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const [lifecycleApp, watcher, lifecycleFolderAccess] =
      mockSetupFolderChangeWatcherLifecycle.mock.calls[0]
    expect(lifecycleApp).toBe(mockApp)
    expect(watcher).toBeInstanceOf(FolderChangeWatcher)
    expect(lifecycleFolderAccess).toBe(folderAccess)
    expect(mockRegisterFolderChangeHandlers).toHaveBeenCalledExactlyOnceWith(mockIpcMain, watcher)
  })

  it('FolderChangeWatcher は許可フォルダを recursive・persistent: false で監視し、変化を sendFolderChange で所有者へ送る', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      vi.useFakeTimers()
      registerIpcHandlers(mockIpcMain)
      const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1] as FolderAccessManager
      const watcher = mockSetupFolderChangeWatcherLifecycle.mock.calls[0][1] as FolderChangeWatcher
      folderAccess.set(1, '/repo')
      mockWatch.mockClear()
      watcher.enable(1)
      expect(mockWatch).toHaveBeenCalledExactlyOnceWith(
        '/repo',
        { recursive: true, persistent: false },
        expect.any(Function)
      )
      const listener = (mockWatch.mock.calls[0] as unknown[])[2] as (
        eventType: string,
        filename: string | null
      ) => void
      listener('rename', 'a.txt')
      await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
      expect(mockSendFolderChange).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
      watcher.disable(1)
    } finally {
      platform.mockRestore()
    }
  })

  it('Linux では開いているフォルダの監視を張らない(設計書 2 章の 5)', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    try {
      registerIpcHandlers(mockIpcMain)
      const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1] as FolderAccessManager
      const watcher = mockSetupFolderChangeWatcherLifecycle.mock.calls[0][1] as FolderChangeWatcher
      folderAccess.set(1, '/repo')
      mockWatch.mockClear()
      watcher.enable(1)
      expect(mockWatch).not.toHaveBeenCalled()
      expect(watcher.watchedFolder(1)).toBeNull()
    } finally {
      platform.mockRestore()
    }
  })
})
