import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { OpenFileWatcher } from './openFileWatcher'
import { onOwnerContextEnded } from './ownerContextLifecycle'

// 開いているタブの監視を閉じる契機: ウィンドウの破棄・renderer のプロセスの終了(クラッシュ)・リロード(メインフレームの文書が
// 実際に入れ替わったとき。will-navigate で止めた遷移では閉じない)・フォルダの切り替え。契機の検知は ownerContextLifecycle.ts
export function setupOpenFileWatcherLifecycle(
  app: App,
  watcher: OpenFileWatcher,
  folderAccess: FolderAccessManager
): void {
  onOwnerContextEnded(app, folderAccess, ({ ownerId }) => watcher.clear(ownerId))
}
