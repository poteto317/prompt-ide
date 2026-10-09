import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { AgentSessionRegistry } from './agentSessionRegistry'
import { AGENT_KILL_GRACE_MS, AGENT_KILL_SETTLE_MS, AGENT_PS_TIMEOUT_MS } from './agentProcessTree'
import { onOwnerContextEnded } from './ownerContextLifecycle'

// エージェントのセッションを止める契機(設計書「停止の契機」)。ウィンドウの破棄(destroyed)、renderer のプロセスの終了、
// renderer のリロード(メインフレームの文書が実際に入れ替わったとき。will-navigate で止めた遷移では止めない)、フォルダの切り替え
// (作業ディレクトリ = 許可のフォルダ の不変条件を守る)、アプリの終了(before-quit で止め終わるのを待ってから終了し直す)。
// 終了以外の契機の検知は ownerContextLifecycle.ts

/**
 * アプリの終了で、停止を待つ上限(ps の打ち切り + 猶予 + SIGKILL の後の待ち = 6 秒)。SIGTERM の前に ps で子孫を控えるため、
 * ps の時間を含めないと、ps が遅く子が SIGTERM を無視するときに SIGKILL より先に quit して孤児を残す(PR #46 のレビュー対応で
 * 猶予 + 1 秒 = 4 秒から変えた)
 */
export const AGENT_QUIT_TIMEOUT_MS =
  AGENT_PS_TIMEOUT_MS + AGENT_KILL_GRACE_MS + AGENT_KILL_SETTLE_MS

export interface AgentSessionLifecycleOptions {
  quitTimeoutMs?: number
}

export function setupAgentSessionLifecycle(
  app: App,
  registry: AgentSessionRegistry,
  folderAccess: FolderAccessManager,
  { quitTimeoutMs = AGENT_QUIT_TIMEOUT_MS }: AgentSessionLifecycleOptions = {}
): void {
  // 停止の失敗は未処理の拒否にしない(止める契機の呼び出し元は結果を待たない)
  const stopOwner = (
    ownerId: number,
    reason: Parameters<AgentSessionRegistry['stopOwner']>[1]
  ): void => {
    void registry.stopOwner(ownerId, reason).catch(() => undefined)
  }

  // 所有者の文脈が終わる契機(破棄・renderer のプロセスの終了・リロード・フォルダの切り替え。ownerContextLifecycle.ts)で止める。
  // フォルダの切り替えだけ理由を folder-changed にする
  onOwnerContextEnded(app, folderAccess, (end) => {
    if (end.cause === 'folder-changed') {
      stopOwner(end.ownerId, 'folder-changed')
      return
    }
    stopOwner(end.ownerId, 'stopped')
    // ターミナルにフォーカスがあるままリロードすると renderer の blur が届かず、Windows・Linux でメニューのショートカットの
    // 無視(agentTerminal:focus)が残るため解除する(macOS では設定しないので解除しても変わらない)
    if (end.cause === 'reloaded') end.webContents.setIgnoreMenuShortcuts(false)
  })

  // 終了を止めて全セッションを止め、終わったら(または上限で)もう一度 quit する。2 回目の before-quit は素通しする。
  // 止め始めたら registry を閉じ、停止を待つ間に届いた起動を取り消す(2 回目の before-quit は素通しのため、その間に
  // 起動したセッションは止める手順を通らずに main が終わってしまう)
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !registry.hasAny()) return
    event.preventDefault()
    quitting = true
    registry.close()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, quitTimeoutMs)
    })
    void Promise.race([registry.stopAll('stopped').catch(() => undefined), timeout]).then(() => {
      clearTimeout(timer)
      app.quit()
    })
  })
}
