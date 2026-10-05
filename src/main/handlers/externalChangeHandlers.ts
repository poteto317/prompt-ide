import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { WriteFileCheckedResult } from '@shared/types'
import type { FolderAccessManager } from '../folderAccessManager'
import type { OpenFileWatcher } from '../openFileWatcher'
import { isAbsolute } from 'node:path'
import { writeFileChecked } from '../checkedFileWrite'
import { convertFsAccessError } from '../fsErrorConverter'
import { getAllowedFolder } from './fileAccessGuard'
import { sendToOwner } from '../safeWebContentsSend'

// 外部変更の検知の IPC(設計書「外部変更の検知」)。照合付きの保存と、開いているタブの監視の登録

/** 監視の登録で受け付けるパスの数の上限(開いているタブの数) */
export const MAX_WATCHED_FILES = 1_000

/** 監視の登録で受け付けるパスの文字列の長さの上限 */
export const MAX_WATCHED_PATH_LENGTH = 4_096

/** 開いているタブの外部変更の通知を、その所有者(webContents)へ送る。破棄済み・見つからなければ送らない */
export function sendExternalChange(ownerId: number, paths: string[]): void {
  sendToOwner(ownerId, 'fs:externalChange', { paths })
}

export function registerExternalChangeHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  watcher: OpenFileWatcher
): void {
  // baseContent はタブが最後にディスクと一致した内容(savedContent)。null は照合せずに書く(上書きの確認で OK の後)。
  // 許可の確認・照合・書き込み方式の選択は checkedFileWrite.ts
  ipcMain.handle(
    'fs:writeFileChecked',
    async (
      event: IpcMainInvokeEvent,
      filePath: unknown,
      content: unknown,
      baseContent: unknown
    ): Promise<WriteFileCheckedResult> => {
      if (typeof filePath !== 'string' || typeof content !== 'string') {
        throw new Error('filePath と content は文字列である必要があります')
      }
      if (baseContent !== null && typeof baseContent !== 'string') {
        throw new Error('baseContent は文字列か null である必要があります')
      }
      try {
        const allowedFolder = getAllowedFolder(folderAccess, event)
        return await writeFileChecked({
          folderAccess,
          allowedFolder,
          filePath,
          content,
          baseContent
        })
      } catch (err) {
        throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
      }
    }
  )

  // 開いているタブのパスの一覧。許可の範囲外・存在しないものは黙って除く
  ipcMain.handle(
    'fs:setWatchedFiles',
    async (event: IpcMainInvokeEvent, paths: unknown): Promise<void> => {
      if (!Array.isArray(paths) || paths.length > MAX_WATCHED_FILES) {
        throw new Error(`paths は ${MAX_WATCHED_FILES} 件以下の配列である必要があります`)
      }
      const ownerId = event.sender.id
      const allowedFolder = folderAccess.get(ownerId)
      if (allowedFolder === undefined) {
        watcher.clear(ownerId)
        return
      }
      // 呼び出しが重なったとき(タブの一覧は変わるたびに送られる)、後から出た呼び出しや、検証の間の clear
      // (リロード・フォルダの切り替え・破棄)より古い呼び出しの一覧を反映しない
      const generation = watcher.beginUpdate(ownerId)
      const valid: string[] = []
      for (const path of paths) {
        if (
          typeof path !== 'string' ||
          path.length > MAX_WATCHED_PATH_LENGTH ||
          !isAbsolute(path)
        ) {
          continue
        }
        try {
          await folderAccess.assertWithinFolder(allowedFolder, path)
          valid.push(path)
        } catch {
          // 範囲外・存在しない
        }
        // await の後ごとに確かめる(後の呼び出しや clear があれば、残りの検証もせずに打ち切る)
        if (!watcher.isCurrentUpdate(ownerId, generation)) return
      }
      // 検証の間にフォルダが切り替わっていたら、古いフォルダのパスで監視を張らない
      if (folderAccess.get(ownerId) !== allowedFolder) return
      watcher.setWatchedFiles(ownerId, valid)
    }
  )
}
