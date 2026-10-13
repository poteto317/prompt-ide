import { randomBytes, randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import type { IpcMain } from 'electron'
import { app, shell, BrowserWindow, Notification } from 'electron'
import { FolderAccessManager } from './folderAccessManager'
import { setupFolderAccessLifecycle } from './folderAccessLifecycle'
import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
import { registerGitHandlers } from './handlers/gitHandlers'
import { registerCloneHandlers } from './handlers/cloneHandlers'
import { CloneRegistry } from './cloneRegistry'
import { setupCloneLifecycle } from './cloneLifecycle'
import { registerSettingsHandlers } from './handlers/settingsHandlers'
import { registerPromptsHandlers } from './handlers/promptsHandlers'
import { registerProgressHandlers } from './handlers/progressHandlers'
import { registerClaudeHandlers } from './handlers/claudeHandlers'
import { registerCLIHandlers } from './handlers/cliHandlers'
import { registerPromptCancelHandlers } from './handlers/promptCancelHandlers'
import { registerHistoryHandlers } from './handlers/historyHandlers'
import { AgentSessionRegistry } from './agentSessionRegistry'
import { setupAgentSessionLifecycle } from './agentSessionLifecycle'
import { registerAgentTerminalHandlers } from './handlers/agentTerminalHandlers'
import { createAgentSessionStarter } from './agentSessionStarter'
import { createAgentSessionRecordStore } from './agentSessionRecordStore'
import { createAgentSessionRecordFileIo } from './agentSessionRecordFileIo'
import { createClaudeSessionReservations } from './claudeSessionReservations'
import { createAgentHooksRuntime } from './agentHooksRuntime'
import { setupAgentHooksLifecycle } from './agentHooksLifecycle'
import { resolveAgentLaunchFromSystem, spawnAgentPty, stopAgentPtyTree } from './agentRuntime'
import { OpenFileWatcher } from './openFileWatcher'
import { setupOpenFileWatcherLifecycle } from './openFileWatcherLifecycle'
import {
  registerExternalChangeHandlers,
  sendExternalChange
} from './handlers/externalChangeHandlers'
import { registerShellHandlers } from './handlers/shellHandlers'
import { AgentBaselineRegistry } from './agentBaselineRegistry'
import { setupAgentBaselineLifecycle } from './agentBaselineLifecycle'
import {
  removeBaselineDir,
  removeBaselineDirSync,
  takeBaselineSnapshot
} from './agentBaselineSnapshot'
import { registerAgentChangesHandlers } from './handlers/agentChangesHandlers'
import {
  isProcessAliveOnThisMachine,
  prepareAgentChangesNoHooksDir,
  protectionRefGit
} from './agentChangesProtectionRef'
import { createProtectionInstanceId } from './agentChangesProtectionRules'
import { moveToTrash } from './trash'
import { AGENT_CHANGES_UNDO_MAX_BYTES, executeAgentChangesUndo } from './agentChangesUndo'
import { createAgentNotificationCenter } from './agentNotifications'
import { createElectronAgentNotification } from './agentNotificationRuntime'
import { setupAgentNotificationLifecycle } from './agentNotificationLifecycle'
import { registerAgentNotificationHandlers } from './handlers/agentNotificationHandlers'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const folderAccess = new FolderAccessManager()

  setupFolderAccessLifecycle(app, folderAccess)

  registerFileSystemHandlers(ipcMain, folderAccess)
  registerGitHandlers(ipcMain, folderAccess)
  // clone は成功したフォルダを開く許可に切り替えるため、同じ FolderAccessManager を渡す
  const cloneRegistry = new CloneRegistry()
  setupCloneLifecycle(app, cloneRegistry)
  registerCloneHandlers(ipcMain, folderAccess, cloneRegistry)
  registerSettingsHandlers(ipcMain)
  registerPromptsHandlers(ipcMain)
  registerProgressHandlers(ipcMain)
  registerClaudeHandlers(ipcMain)
  registerCLIHandlers(ipcMain)
  registerPromptCancelHandlers(ipcMain)
  registerHistoryHandlers(ipcMain)
  // エージェントのセッション。作業ディレクトリは開いているフォルダ(同じ FolderAccessManager)で、フォルダの切り替えで止める
  const agentRegistry = new AgentSessionRegistry()
  setupAgentSessionLifecycle(app, agentRegistry, folderAccess)
  // claude のセッションの起動の記録(userData/agent-sessions.json)。読み込みはここで一度だけ始める
  const agentSessionRecords = createAgentSessionRecordStore(
    createAgentSessionRecordFileIo(app.getPath('userData'))
  )
  // claude の hooks(ツールの区間の追跡・127.0.0.1 の受け口・起動ごとの準備)。実物の依存の組み立ては agentHooksRuntime.ts。
  // 段階 A の追跡の段階は内部で持ち、開発版のログに出すだけ。onToolStart はすぐ解決し、onToolStartTimedOut は何もしない
  // (段階 B で記録の registry の syncAttribution・waitForAgentPhase・markPeriodUnassignable につなぐ)
  const agentHooks = createAgentHooksRuntime({
    onPhaseChange: () => undefined,
    onToolStart: async () => undefined,
    onToolStartTimedOut: () => undefined,
    devLog: app.isPackaged ? null : (line) => console.log(line)
  })
  // 受け口・設定のディレクトリ・追跡のタイマーは will-quit で片付ける(before-quit の停止の待ちの間も知らせを受ける)
  setupAgentHooksLifecycle(app, agentHooks.lifecycleParts)
  // 起動の規則(許可のフォルダとの照合・起動の途中の取り消し・再開の照合・同じ会話の二重の起動の拒否)と pty の配線は
  // agentSessionStarter.ts。IPC の受け口は registry(書き込み・リサイズ・停止・状態の取得)と、組み立てた starter の起動・ID の
  // 引き当て・「前回」の取得と、区間の追跡の作業中の知らせだけを受け取る
  const agentStarter = createAgentSessionStarter({
    folderAccess,
    registry: agentRegistry,
    resolveLaunch: resolveAgentLaunchFromSystem,
    spawnPty: spawnAgentPty,
    stopTree: stopAgentPtyTree,
    createSessionId: randomUUID,
    records: agentSessionRecords,
    // 全ウィンドウで共有する(別のウィンドウで同じ会話を同時に開かせない)
    reservations: createClaudeSessionReservations(),
    createClaudeSessionId: randomUUID,
    hooks: agentHooks.sessions
  })
  registerAgentTerminalHandlers(ipcMain, {
    registry: agentRegistry,
    startSession: agentStarter.start,
    claudeSessionIdOf: agentStarter.claudeSessionIdOf,
    getLastSession: agentStarter.lastSessionOf,
    reportWorking: agentHooks.tracker.reportWorking
  })
  // エージェントの完了・許可待ちの通知。Electron の Notification・Dock・BrowserWindow をここで注入する
  const agentNotificationCenter = createAgentNotificationCenter({
    platform: process.platform,
    isSupported: () => Notification.isSupported(),
    createNotification: createElectronAgentNotification,
    setDockBadge: (text) => app.dock?.setBadge(text)
  })
  setupAgentNotificationLifecycle(app, agentNotificationCenter)
  registerAgentNotificationHandlers(ipcMain, {
    center: agentNotificationCenter,
    windowOf: (sender) => BrowserWindow.fromWebContents(sender)
  })
  // 開いているタブの外部変更の検知(保存の直前の照合と、親ディレクトリの監視)
  const openFileWatcher = new OpenFileWatcher({
    // persistent: false で、監視が main プロセスの終了を妨げない
    watch: (dir, listener) => watch(dir, { persistent: false }, listener),
    notify: sendExternalChange
  })
  setupOpenFileWatcherLifecycle(app, openFileWatcher, folderAccess)
  registerExternalChangeHandlers(ipcMain, folderAccess, openFileWatcher)
  registerShellHandlers(ipcMain, (url) => shell.openExternal(url))
  // エージェントの変更の記録(所有者ごと)。フォルダの切り替え・リロード・破棄・アプリの終了で捨てる。
  // 記録中は記録の tree を専用の ref から守る(instanceId は起動ごとに 1 回だけ作る。hook の無いディレクトリは userData の下)
  const agentBaselineRegistry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, options),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId: createProtectionInstanceId(process.pid, randomBytes(4).toString('hex')),
      noHooksDir: prepareAgentChangesNoHooksDir(app.getPath('userData')),
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine
    },
    executeUndo: (folderPath, undo) =>
      executeAgentChangesUndo({ folderPath, undo, trash: moveToTrash })
  })
  setupAgentBaselineLifecycle(app, agentBaselineRegistry, folderAccess)
  registerAgentChangesHandlers(ipcMain, {
    registry: agentBaselineRegistry,
    folderAccess,
    trash: moveToTrash,
    undoCapture: { tempRoot: tmpdir(), maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
  })
}
