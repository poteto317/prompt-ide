import { BrowserWindow } from 'electron'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { CloneRepositoryResult } from '@shared/types'
import type { CloneRegistry } from '../cloneRegistry'
import { chooseCloneParentDialog } from '../dialogService'
import type { FolderAccessManager } from '../folderAccessManager'
import { assertValidCloneRequest, cloneRepository } from '../gitCloneService'

// IPC 境界は任意の値を受け付けるため、service が TypeError で落ちる前に引数の型を検証する(gitHandlers の
// assertRemoteUrlArg と同じ流儀)。値の中身(URL の許可リスト・フォルダ名の規則)は service が検証する
function assertCloneUrlArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid remote url')
}

function assertCloneFolderNameArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid folder name')
}

// リポジトリの clone。フォルダが開いていなくても使える(getAllowedFolder を使わない)。保存先の親フォルダは OS の
// ダイアログで main が選ぶ(renderer からパスを受け取らない)。成功したときだけ、そのフォルダを開く許可に切り替える
// (失敗・中止では、開いているフォルダの許可はそのまま)。service の第 5 引数(打ち切りの時間など)はテスト用。
// renderer から届いた余分な引数は渡さない
export function registerCloneHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  registry: CloneRegistry
): void {
  ipcMain.handle(
    'git:cloneRepository',
    async (
      event: IpcMainInvokeEvent,
      url: unknown,
      folderName: unknown
    ): Promise<CloneRepositoryResult> => {
      assertCloneUrlArg(url)
      assertCloneFolderNameArg(folderName)
      // OS のダイアログを出す前に、URL とフォルダ名を検証する(不正な入力で保存先を選ばせない。パターン 94)
      assertValidCloneRequest(url, folderName)
      const ownerId = event.sender.id
      const controller = registry.begin(ownerId)
      try {
        const parentDir = await chooseCloneParentDialog(BrowserWindow.fromWebContents(event.sender))
        // 選んでいる間に中止された(ウィンドウを閉じた)ら clone へ進まない
        if (parentDir === null || controller.signal.aborted) return { status: 'canceled' }
        const result = await cloneRepository(url, folderName, parentDir, controller.signal)
        if (result.status !== 'cloned') return result
        // 閉じたウィンドウの id で許可を残さない(destroyed の後に登録すると、FolderAccessManager から消えない)
        if (event.sender.isDestroyed()) return { status: 'canceled' }
        // 中止された(リロードなど)後に許可を clone 先へ書き換えない。service も中止なら canceled を返すが、
        // 再読み込み後に開いたフォルダの許可を奪わないための防御の 2 層目
        if (controller.signal.aborted) return { status: 'canceled' }
        folderAccess.set(ownerId, result.path)
        return result
      } finally {
        registry.end(ownerId, controller)
      }
    }
  )

  // 実行中の clone を中止する。実行中でなければ何もしない(冪等)
  ipcMain.handle('git:cancelCloneRepository', (event: IpcMainInvokeEvent): void => {
    registry.cancel(event.sender.id)
  })
}
