import type { App } from 'electron'
import type { AgentNotificationCenter } from './agentNotifications'
import { onMainFrameDocumentReplaced } from './mainFrameDocumentReplaced'

// 通知の後始末の契機(設計書「main」)。フォーカスで点滅を止め、ウィンドウを閉じた・リロードした(メインフレームの文書が実際に
// 入れ替わった。will-navigate で止めた遷移では閉じない。判定は mainFrameDocumentReplaced.ts)ときに残っている通知を閉じる。
// 閉じたときはバッジも 0 に戻す(renderer のアンマウントの後始末が届かないことがあり、macOS ではアプリが残るため。1 ウィンドウの前提)

export function setupAgentNotificationLifecycle(
  app: App,
  center: Pick<AgentNotificationCenter, 'handleWindowFocus' | 'clearWindow' | 'setBadge'>
): void {
  app.on('browser-window-created', (_event, window) => {
    window.on('focus', () => center.handleWindowFocus(window))
    window.on('closed', () => {
      center.clearWindow(window)
      center.setBadge(0)
    })
    onMainFrameDocumentReplaced(window.webContents, () => center.clearWindow(window))
  })
}
