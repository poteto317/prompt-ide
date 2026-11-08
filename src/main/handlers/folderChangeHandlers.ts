import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { FolderChangeEvent } from '@shared/types'
import type { FolderChangeWatcher } from '../folderChangeWatcher'
import { sendToOwner } from '../safeWebContentsSend'

// 開いているフォルダの監視の IPC(設計書 2026-11-08「IPC」)。renderer は張るかだけを送り(パスは送らない)、どのフォルダかは
// main の許可フォルダで決める。通知の payload にもパスは入れない(今の所有者のフォルダで何かが変わった合図)

/**
 * 開いているフォルダの変化の合図を、その所有者(webContents)へ送る。破棄済み・見つからなければ送らない。
 * payload は送ってよい欄だけを組み直して送る(パスなど余分な欄が実行時に紛れても渡さない境界。欄を足すときはここも足す。
 * 受ける側の検査は preload)。sendToOwner の payload は unknown なので、組み直しを satisfies で型に結び、必須の欄を足したときの
 * 直し忘れを型エラーにする(省略できる欄は satisfies でも捕まえない)
 */
export function sendFolderChange(ownerId: number, event: FolderChangeEvent): void {
  sendToOwner(ownerId, 'fs:folderChange', {
    treeChanged: event.treeChanged
  } satisfies FolderChangeEvent)
}

export function registerFolderChangeHandlers(
  ipcMain: IpcMain,
  watcher: Pick<FolderChangeWatcher, 'enable' | 'disable'>
): void {
  // 同期の関数を渡す(await を挟まず、StrictMode の true → false → true を到着の順に処理する。L-469)
  ipcMain.handle('fs:setFolderWatch', (event: IpcMainInvokeEvent, enabled: unknown): void => {
    if (typeof enabled !== 'boolean') throw new Error('enabled は真偽値である必要があります')
    if (enabled) watcher.enable(event.sender.id)
    else watcher.disable(event.sender.id)
  })
}
