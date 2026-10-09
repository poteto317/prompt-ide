import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { AgentSessionSnapshotEntry, AgentStartResult } from '@shared/types'
import type { AgentSessionRegistry } from '../agentSessionRegistry'
import type { AgentSessionStarter } from '../agentSessionStarter'
import { isDestroyedSafely, sendSafely } from '../safeWebContentsSend'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from './agentTerminalPayloadParser'

// エージェントのセッションの IPC の受け口(設計書「IPC」)。起動のコマンド・作業ディレクトリ・環境変数は main で決め、
// renderer からは slotId(タブ)・folderPath(許可との一致の確認だけ)・桁数・行数・書き込む文字列・sessionId だけを受け取る

export interface AgentTerminalHandlerDeps {
  /** 書き込み・リサイズ・停止・状態の取得の相手(所有者・枠ごとのセッション) */
  registry: Pick<AgentSessionRegistry, 'write' | 'resize' | 'stop' | 'snapshot'>
  /** 起動の規則(許可のフォルダとの照合・起動の途中の取り消し)と pty の配線。組み立ては ipcHandlers.ts
   *  (agentSessionStarter.createAgentSessionStarter) */
  startSession: AgentSessionStarter
  platform?: NodeJS.Platform
}

const NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'

export function registerAgentTerminalHandlers(
  ipcMain: IpcMain,
  { registry, startSession, platform = process.platform }: AgentTerminalHandlerDeps
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

  ipcMain.handle(
    'agentTerminal:getState',
    (event: IpcMainInvokeEvent): AgentSessionSnapshotEntry[] => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return registry.snapshot(event.sender.id)
    }
  )

  // Windows・Linux の既定のメニューのショートカット(Ctrl+W など)がターミナルの入力を奪わないよう、ターミナルにフォーカスが
  // ある間はメニューのショートカットを止める。macOS は Cmd の組み合わせで重ならず、Edit メニューのコピー・貼り付けを生かす
  ipcMain.on('agentTerminal:focus', (event: IpcMainEvent, focused: unknown) => {
    if (!isMainFrameSender(event) || typeof focused !== 'boolean') return
    if (platform === 'darwin') return
    event.sender.setIgnoreMenuShortcuts(focused)
  })
}
