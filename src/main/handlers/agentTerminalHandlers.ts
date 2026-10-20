import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type {
  AgentInterruptResult,
  AgentLastSession,
  AgentSessionSnapshotEntry,
  AgentStartResult
} from '@shared/types'
import type { AgentSessionRegistry } from '../agentSessionRegistry'
import type { AgentSessionStarter, AgentSessionStarterService } from '../agentSessionStarter'
import { isDestroyedSafely, sendSafely } from '../safeWebContentsSend'
import { attachSessionInfo } from '../agentSessionSnapshot'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentFolderPath,
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from './agentTerminalPayloadParser'

// エージェントのセッションの IPC の受け口(設計書「IPC」)。起動のコマンド・作業ディレクトリ・環境変数は main で決め、
// renderer からは slotId(タブ)・folderPath(許可との一致の確認だけ)・桁数・行数・起動の指定(新規・再開の列挙型)・書き込む文字列・sessionId(作業中・作業の終わりの知らせ・中断を含む)だけを受け取る

export interface AgentTerminalHandlerDeps {
  /** 書き込み・リサイズ・停止・中断・状態の取得の相手(所有者・枠ごとのセッション) */
  registry: Pick<AgentSessionRegistry, 'write' | 'resize' | 'stop' | 'snapshot' | 'interrupt'>
  /** 起動の規則(許可のフォルダとの照合・起動の途中の取り消し・再開の照合・同じ会話の二重の起動の拒否)と pty の配線。組み立ては
   *  ipcHandlers.ts(agentSessionStarter.createAgentSessionStarter の start) */
  startSession: AgentSessionStarter
  /** pty の sessionId → 種類と claude の会話の ID(starter の Map)。作り直しの後の合わせ込み(getState)で足す */
  sessionInfoOf: AgentSessionStarterService['sessionInfoOf']
  /** 「前回」の取得(starter の lastSessionOf。許可のフォルダとの照合は starter が行う) */
  getLastSession: AgentSessionStarterService['lastSessionOf']
  /** 作業中の知らせ(送信元のウィンドウの id と pty の sessionId)。組み立ては agentHooksRuntime.ts(区間の追跡の reportWorking)で、ipcHandlers.ts が渡す。
   *  そのウィンドウに無いセッションは追跡が捨てる */
  reportWorking: (ownerId: number, sessionId: string) => void
  /** 作業の終わりの知らせ(送信元のウィンドウの id と pty の sessionId)。組み立ては agentHooksRuntime.ts(区間の追跡の
   *  reportWorkingEnded)で、ipcHandlers.ts が渡す。そのウィンドウに無いセッションは追跡が捨てる */
  reportWorkingEnded: (ownerId: number, sessionId: string) => void
  platform?: NodeJS.Platform
}

const NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'

export function registerAgentTerminalHandlers(
  ipcMain: IpcMain,
  {
    registry,
    startSession,
    sessionInfoOf,
    getLastSession,
    reportWorking,
    reportWorkingEnded,
    platform = process.platform
  }: AgentTerminalHandlerDeps
): void {
  ipcMain.handle(
    'agentTerminal:start',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<AgentStartResult> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      const request = parseAgentStartRequest(payload)
      const webContents = event.sender
      // startSession は最初の await より前に停止の世代を控える(ここでも await を挟まずに呼ぶ)
      return startSession(webContents.id, request, {
        isGone: () => isDestroyedSafely(webContents),
        onData: (data) => sendSafely(webContents, 'agentTerminal:data', data),
        onExit: (exit) => sendSafely(webContents, 'agentTerminal:exit', exit)
      })
    }
  )

  ipcMain.on('agentTerminal:write', (event: IpcMainEvent, sessionId: unknown, data: unknown) => {
    if (!isMainFrameSender(event)) return
    const parsed = parseAgentWrite(sessionId, data)
    if (parsed === null) return
    registry.write(event.sender.id, parsed.sessionId, parsed.data)
  })

  ipcMain.on(
    'agentTerminal:resize',
    (event: IpcMainEvent, sessionId: unknown, cols: unknown, rows: unknown) => {
      if (!isMainFrameSender(event)) return
      const parsed = parseAgentResize(sessionId, cols, rows)
      if (parsed === null) return
      registry.resize(event.sender.id, parsed.sessionId, parsed.cols, parsed.rows)
    }
  )

  ipcMain.handle(
    'agentTerminal:stop',
    async (event: IpcMainInvokeEvent, sessionId: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      await registry.stop(event.sender.id, 'stopped', parseAgentSessionId(sessionId))
    }
  )

  // 中断(claude に Esc を 1 回)。renderer からは sessionId だけを受け取り、書くバイト列は main が決める(L-019)。
  // 書けたか・セッションが無かったかを返すため invoke にする(L-001)。照合は write と同じ(送信元のウィンドウの今のセッション)
  ipcMain.handle(
    'agentTerminal:interrupt',
    (event: IpcMainInvokeEvent, sessionId: unknown): AgentInterruptResult => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return registry.interrupt(event.sender.id, parseAgentSessionId(sessionId))
    }
  )

  ipcMain.handle(
    'agentTerminal:getState',
    (event: IpcMainInvokeEvent): AgentSessionSnapshotEntry[] => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return attachSessionInfo(registry.snapshot(event.sender.id), sessionInfoOf)
    }
  )

  ipcMain.handle(
    'agentTerminal:getLastSession',
    async (event: IpcMainInvokeEvent, folderPath: unknown): Promise<AgentLastSession | null> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return getLastSession(event.sender.id, parseAgentFolderPath(folderPath))
    }
  )

  // 作業中の知らせ・作業の終わりの知らせ(設計書「作業中の知らせ」「hooks が届かなくなったことの検知」)。効果は印を増やさない側
  // (unconfirmed・保留)だけで、renderer の値は送信元のウィンドウのセッションを指すだけ(L-019)。send なので失敗を renderer に返さない
  const onSessionReport = (
    channel: string,
    label: string,
    report: (ownerId: number, sessionId: string) => void
  ): void => {
    ipcMain.on(channel, (event: IpcMainEvent, sessionId: unknown) => {
      if (!isMainFrameSender(event)) return
      let parsed: string
      try {
        parsed = parseAgentSessionId(sessionId)
      } catch {
        console.warn(`[agent-hooks] ${label}の sessionId が不正です`)
        return
      }
      report(event.sender.id, parsed)
    })
  }
  onSessionReport('agentTerminal:reportWorking', '作業中の知らせ', reportWorking)
  onSessionReport('agentTerminal:reportWorkingEnded', '作業の終わりの知らせ', reportWorkingEnded)

  // Windows・Linux の既定のメニューのショートカット(Ctrl+W など)がターミナルの入力を奪わないよう、ターミナルにフォーカスが
  // ある間はメニューのショートカットを止める。macOS は Cmd の組み合わせで重ならず、Edit メニューのコピー・貼り付けを生かす
  ipcMain.on('agentTerminal:focus', (event: IpcMainEvent, focused: unknown) => {
    if (!isMainFrameSender(event) || typeof focused !== 'boolean') return
    if (platform === 'darwin') return
    event.sender.setIgnoreMenuShortcuts(focused)
  })
}
