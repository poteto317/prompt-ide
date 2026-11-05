import { randomBytes, randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import type { IpcMain } from 'electron'
import { app, shell, BrowserWindow, Notification } from 'electron'
import { FolderAccessManager } from './folderAccessManager'
import { setupFolderAccessLifecycle } from './folderAccessLifecycle'
import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
import { registerAgentInstructionsHandlers } from './handlers/agentInstructionsHandlers'
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
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentSessionRecordStore } from './agentSessionRecordStore'
import {
  AGENT_SESSION_RECORD_FILE_NAMES,
  createAgentSessionRecordFileIo
} from './agentSessionRecordFileIo'
import { createCliSessionReservations } from './cliSessionReservations'
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
import { sweepStaleBaselineTempDirs } from './agentBaselineTempSweep'
import { moveToTrash } from './trash'
import { AGENT_CHANGES_UNDO_MAX_BYTES, executeAgentChangesUndo } from './agentChangesUndo'
import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from './agentChangesQuery'
import { createAgentNotificationCenter } from './agentNotifications'
import { createElectronAgentNotification } from './agentNotificationRuntime'
import { setupAgentNotificationLifecycle } from './agentNotificationLifecycle'
import { registerAgentNotificationHandlers } from './handlers/agentNotificationHandlers'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const folderAccess = new FolderAccessManager()

  setupFolderAccessLifecycle(app, folderAccess)

  registerFileSystemHandlers(ipcMain, folderAccess)
  registerAgentInstructionsHandlers(ipcMain, folderAccess)
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
  // エージェント CLI のセッションの起動の記録(種類ごとに userData の別のファイル。claude は agent-sessions.json)。読み込みはここで
  // 一度だけ始める。種類を足したときに記録の決め忘れを型エラーにするため、種類をキーにしたオブジェクトで作る(L-060)
  const userDataDir = app.getPath('userData')
  const recordStoreOf = (kind: AgentCliKind): AgentSessionRecordStore =>
    createAgentSessionRecordStore(
      createAgentSessionRecordFileIo(userDataDir, AGENT_SESSION_RECORD_FILE_NAMES[kind])
    )
  const agentSessionRecords: Record<AgentCliKind, AgentSessionRecordStore> = {
    claude: recordStoreOf('claude'),
    copilot: recordStoreOf('copilot')
  }
  // claude・copilot の hooks(ツールの区間の追跡・127.0.0.1 の受け口・起動ごとの準備・copilot のプラグインのフォルダ〈userData の下〉)。実物の依存の組み立ては agentHooksRuntime.ts。
  // 追跡の合図の変化・PreToolUse の待ち・待ちの打ち切りを記録の registry につなぐ(設計書「registry へのつなぎ方」)。runtime は生成の中で
  // これらを呼ばず、最初に呼ぶのは組み立てが終わった後の IPC(起動の activate・hooks の知らせ)なので、後で作る registry を参照してよい
  const agentHooks = createAgentHooksRuntime({
    onPhaseChange: (ownerId) => agentBaselineRegistry.notifyAttributionSignal(ownerId),
    onToolStart: (ownerId, signal) => agentBaselineRegistry.waitForAgentPhase(ownerId, signal),
    onToolStartTimedOut: (ownerId) => agentBaselineRegistry.markToolStartTimedOut(ownerId),
    devLog: app.isPackaged ? null : (line) => console.log(line),
    userDataDir
  })
  // 受け口・設定のディレクトリ・copilot の hooks の設定のファイル(hooks.json)・追跡のタイマーは will-quit で片付ける(before-quit の
  // 停止の待ちの間も知らせを受ける)
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
    reservations: createCliSessionReservations(),
    createCliSessionId: randomUUID,
    hooks: agentHooks.sessions
  })
  registerAgentTerminalHandlers(ipcMain, {
    registry: agentRegistry,
    startSession: agentStarter.start,
    sessionInfoOf: agentStarter.sessionInfoOf,
    getLastSession: agentStarter.lastSessionOf,
    reportWorking: agentHooks.tracker.reportWorking,
    reportWorkingEnded: agentHooks.tracker.reportWorkingEnded
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
  // 記録中は記録の tree を専用の ref から守る(hook の無いディレクトリは userData の下)。main の起動ごとの ID は 1 回だけ作り、
  // 保護の ref の名前と記録の一時ディレクトリの名前に同じ値を使う(起動時の掃除が自分の記録を消さない)
  const instanceId = createProtectionInstanceId(process.pid, randomBytes(4).toString('hex'))
  // 記録の一時ディレクトリの親。記録を取る関数と起動時の掃除に同じ値をここから渡す(記録の側の既定値に掃除が頼らない)
  const baselineTempRoot = tmpdir()
  const agentBaselineRegistry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) =>
      takeBaselineSnapshot(folderPath, { ...options, instanceId, tempRoot: baselineTempRoot }),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId,
      noHooksDir: prepareAgentChangesNoHooksDir(app.getPath('userData')),
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine
    },
    executeUndo: (folderPath, undo) =>
      executeAgentChangesUndo({ folderPath, undo, trash: moveToTrash }),
    collectBetween: collectAgentChangeEntriesBetween,
    collectCurrent: collectAgentChangeEntries,
    // 区別の合図と通し番号は hooks の追跡から読む(生成の順は hooks の runtime → registry のまま)
    attributionSource: agentHooks.tracker,
    attributionDevLog: app.isPackaged ? null : (line) => console.log(line),
    attributionWarn: (message, err) => console.warn(message, err)
  })
  setupAgentBaselineLifecycle(app, agentBaselineRegistry, folderAccess)
  // 前の起動の異常終了で残った記録の一時ディレクトリを消す(待たない。自分の instanceId のものは消さないため、最初の記録と並んでも消さない)
  void sweepStaleBaselineTempDirs({
    tempRoot: baselineTempRoot,
    instanceId,
    isProcessAlive: isProcessAliveOnThisMachine
  }).catch(() => undefined)
  registerAgentChangesHandlers(ipcMain, {
    registry: agentBaselineRegistry,
    folderAccess,
    trash: moveToTrash,
    undoCapture: { tempRoot: tmpdir(), maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
  })
}
