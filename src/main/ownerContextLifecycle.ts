import type { App, WebContents } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import { onMainFrameDocumentReplaced } from './mainFrameDocumentReplaced'

// 所有者(webContents)の文脈が終わる契機を 1 か所にまとめる。所有者ごとの状態(エージェントのセッション・開いているタブの監視)は
// これを購読して片付ける。契機は 4 つ:
// - destroyed: ウィンドウの破棄
// - crashed: renderer のプロセスの終了(render-process-gone。リロードも閉じもされないまま残ることがある)
// - reloaded: メインフレームの文書が実際に入れ替わった(リロード・許可した遷移・エラーの画面。判定は mainFrameDocumentReplaced.ts)
// - folder-changed: 許可のフォルダの切り替え(FolderAccessManager.onDidChange)

export type OwnerContextEnd =
  | { ownerId: number; cause: 'destroyed' | 'crashed' | 'reloaded'; webContents: WebContents }
  | { ownerId: number; cause: 'folder-changed' }

export function onOwnerContextEnded(
  app: App,
  folderAccess: Pick<FolderAccessManager, 'onDidChange'>,
  listener: (end: OwnerContextEnd) => void
): void {
  app.on('web-contents-created', (_event, webContents) => {
    // 破棄済みの webContents の id を読むと例外になるため、作成時に控える
    const ownerId = webContents.id
    webContents.on('destroyed', () => listener({ ownerId, cause: 'destroyed', webContents }))
    webContents.on('render-process-gone', () =>
      listener({ ownerId, cause: 'crashed', webContents })
    )
    onMainFrameDocumentReplaced(webContents, () =>
      listener({ ownerId, cause: 'reloaded', webContents })
    )
  })
  folderAccess.onDidChange((ownerId) => listener({ ownerId, cause: 'folder-changed' }))
}
