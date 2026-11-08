import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { FolderChangeWatcher } from './folderChangeWatcher'
import { onOwnerContextEnded } from './ownerContextLifecycle'

// 開いているフォルダの監視の寿命(設計書 2026-11-08「寿命」)。フォルダの切り替えでは、有効な所有者だけ新しいフォルダを張り直す
// (renderer の送り直しに頼らない。L-571)。破棄・クラッシュ・リロードでは無効に戻す(リロードの後は、新しい文書の renderer が
// マウント時に有効にし直す。reloaded は新しい文書の preload より先に届く)。アプリの終了では閉じない(persistent: false)
export function setupFolderChangeWatcherLifecycle(
  app: App,
  watcher: Pick<FolderChangeWatcher, 'onFolderChanged' | 'disable'>,
  folderAccess: FolderAccessManager
): void {
  onOwnerContextEnded(app, folderAccess, (end) => {
    if (end.cause === 'folder-changed') watcher.onFolderChanged(end.ownerId)
    else watcher.disable(end.ownerId)
  })
}
