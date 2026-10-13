import type { App } from 'electron'
import type { AgentHookReceiver } from './agentHookReceiver'
import type { AgentHookSettingsDir } from './agentHookSettings'
import type { AgentToolActivity } from './agentToolActivity'

// claude の hooks の後始末の契機(設計書「アプリの終了の後始末」)。agentSessionLifecycle.ts は 1 回目の before-quit を止めて
// セッションの停止を待つため、before-quit で受け口を閉じると止める途中の claude の SessionEnd が届かず、動いている claude の
// 設定のファイルが先に消える。will-quit(停止を待った後の終了)で、受け口・設定のディレクトリ・追跡のタイマーを片付ける。
// 1 つが失敗しても残りを試す(L-010)

export interface AgentHooksLifecycleParts {
  receiver: Pick<AgentHookReceiver, 'close'>
  settingsDir: Pick<AgentHookSettingsDir, 'removeSync'>
  tracker: Pick<AgentToolActivity, 'close'>
}

export function setupAgentHooksLifecycle(
  app: Pick<App, 'on'>,
  { receiver, settingsDir, tracker }: AgentHooksLifecycleParts
): void {
  app.on('will-quit', () => {
    for (const step of [
      () => receiver.close(),
      () => settingsDir.removeSync(),
      () => tracker.close()
    ]) {
      try {
        step()
      } catch (err) {
        console.error('[agent-hooks] 終了の後始末に失敗しました:', err)
      }
    }
  })
}
