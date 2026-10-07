import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { AgentBaselineRegistry } from './agentBaselineRegistry'
import { onOwnerContextEnded } from './ownerContextLifecycle'

// エージェントの変更の記録を捨てる契機(設計書「エラー処理」・決定した点 4): ウィンドウの破棄・renderer のプロセスの終了・
// リロード(メインフレームの文書が実際に入れ替わったとき)・フォルダの切り替え(ownerContextLifecycle.ts)と、アプリの終了
// (before-quit で一時ディレクトリを待たずに消す)。異常終了で残った一時ディレクトリは OS の掃除に任せる
export function setupAgentBaselineLifecycle(
  app: App,
  registry: Pick<AgentBaselineRegistry, 'clear' | 'close'>,
  folderAccess: Pick<FolderAccessManager, 'onDidChange'>
): void {
  onOwnerContextEnded(app, folderAccess, ({ ownerId }) => {
    void registry.clear(ownerId).catch(() => undefined)
  })
  app.on('before-quit', () => registry.close())
}
