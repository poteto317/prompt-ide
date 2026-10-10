import { Notification } from 'electron'
import type { AgentNotificationHandle } from './agentNotifications'

// エージェントの通知の Electron の実物(agentRuntime.ts と同じく、Electron に触る部分だけを置く)。ipcHandlers.ts が center へ注入する

/** Electron の Notification を包む。包んだ関数が Notification を参照し続け、center の記録が押されるまで包みを持つ(GC で click が失われないように) */
export function createElectronAgentNotification(options: {
  title: string
  body: string
}): AgentNotificationHandle {
  const notification = new Notification(options)
  return {
    show: () => notification.show(),
    close: () => notification.close(),
    onClick: (listener) => {
      notification.on('click', () => listener())
    }
  }
}
