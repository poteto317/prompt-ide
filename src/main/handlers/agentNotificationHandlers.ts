import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { AgentNotificationCenter, AgentNotificationWindow } from '../agentNotifications'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentNotificationBadgeRequest,
  parseAgentNotificationDismissRequest,
  parseAgentNotificationShowRequest
} from './agentNotificationPayloadParser'

// エージェントの通知の IPC の受け口(設計書「main」)。renderer からは slotId・タブの番号・出来事・待っている数だけを受け取り、
// 通知の文字列・出すかどうか(フォーカスの有無)は main が決める

export interface AgentNotificationHandlerDeps {
  center: Pick<AgentNotificationCenter, 'show' | 'setBadge' | 'dismiss'>
  /** 送信元の webContents のウィンドウ(BrowserWindow.fromWebContents)。無ければ null */
  windowOf: (sender: WebContents) => AgentNotificationWindow | null
}

const NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'

export function registerAgentNotificationHandlers(
  ipcMain: IpcMain,
  { center, windowOf }: AgentNotificationHandlerDeps
): void {
  ipcMain.handle(
    'agentNotification:show',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      const request = parseAgentNotificationShowRequest(payload)
      const window = windowOf(event.sender)
      if (window === null) return
      center.show(window, request)
    }
  )

  ipcMain.handle(
    'agentNotification:setBadge',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      // ウィンドウが 1 つの前提で、最後に送られた値を出す(複数ウィンドウの合算はしない。既知の制約)
      center.setBadge(parseAgentNotificationBadgeRequest(payload).count)
    }
  )

  ipcMain.handle(
    'agentNotification:dismiss',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      const { slotId } = parseAgentNotificationDismissRequest(payload)
      const window = windowOf(event.sender)
      if (window === null) return
      center.dismiss(window, slotId)
    }
  )
}
