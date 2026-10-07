import { realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { BrowserWindow } from 'electron'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { openFolderDialog } from '../dialogService'
import {
  readDirRecursive,
  readFileContent,
  writeFileContent,
  createFile,
  createDirectory,
  renameEntry,
  deleteEntry,
  isSymbolicLink
} from '../fileSystem'
import { addToGitignore } from '../gitignoreService'
import type { FolderAccessManager } from '../folderAccessManager'
import { getAllowedFolder, assertFileAccess, assertFileWithinFolder } from './fileAccessGuard'
import { assertValidEntryName } from './entryNameValidator'
import { convertFsError, convertFsAccessError } from '../fsErrorConverter'
import { isMissingPathError } from '../fsErrors'
import { resolveAndAssertRelativePath } from './gitPathResolver'

// .gitignore がシンボリックリンクかどうか。存在しない場合は false(新規作成の経路)。
// isSymbolicLink(lstat)は対象が無ければ ENOENT を投げるため、ここで吸収する。
// 祖先ディレクトリが同名ファイルに置き換わっていた場合(git checkout 等)は
// ENOTDIR になる。ENOENT だけを見ていると、このケースで未変換の ENOTDIR が
// そのまま fs:addToGitignore 全体を失敗させてしまう(assertFileWithinFolder/
// resolveCanonicalPath は ENOTDIR も「対象なし」として扱っているのと揃える)
async function isGitignoreSymlink(gitignorePath: string): Promise<boolean> {
  try {
    return await isSymbolicLink(gitignorePath)
  } catch (err) {
    if (isMissingPathError(err)) return false
    throw err
  }
}

// fs:createFile と fs:createDirectory は、実際に呼び出す fs 操作以外は
// 名前検証・アクセス境界チェック・エラー変換まで全く同じ流れのため共通化する
function registerCreateEntryHandler(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  channel: 'fs:createFile' | 'fs:createDirectory',
  createEntry: (path: string) => Promise<void>
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, parentPath: string, name: string) => {
    assertValidEntryName(name)
    const allowedFolder = getAllowedFolder(folderAccess, event)
    try {
      const resolvedParent = await folderAccess.assertParentWithinFolder(allowedFolder, parentPath)
      await createEntry(join(resolvedParent, name))
    } catch (err) {
      throw convertFsError(err, name, parentPath)
    }
  })
}

export function registerFileSystemHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager
): void {
  ipcMain.handle('dialog:openFolder', async (event: IpcMainInvokeEvent) => {
    // 送信元のウィンドウのモーダルにする(表示中に clone などの画面の操作をさせない)
    const result = await openFolderDialog(BrowserWindow.fromWebContents(event.sender))
    if (result !== null) folderAccess.set(event.sender.id, await realpath(result))
    return result
  })

  ipcMain.handle('fs:readDirectory', async (event: IpcMainInvokeEvent, folderPath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    const resolvedTarget = await realpath(folderPath)
    if (resolvedTarget !== allowedFolder) {
      throw new Error(`Access denied: ${folderPath}`)
    }
    return readDirRecursive(folderPath)
  })

  ipcMain.handle('fs:readFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    try {
      await assertFileAccess(folderAccess, event, filePath)
      return await readFileContent(filePath)
    } catch (err) {
      throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
    }
  })

  ipcMain.handle(
    'fs:writeFile',
    async (event: IpcMainInvokeEvent, filePath: string, content: string) => {
      try {
        await assertFileAccess(folderAccess, event, filePath)
        return await writeFileContent(filePath, content)
      } catch (err) {
        throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
      }
    }
  )

  registerCreateEntryHandler(ipcMain, folderAccess, 'fs:createFile', createFile)
  registerCreateEntryHandler(ipcMain, folderAccess, 'fs:createDirectory', createDirectory)

  ipcMain.handle(
    'fs:renameEntry',
    async (event: IpcMainInvokeEvent, targetPath: string, newName: string) => {
      assertValidEntryName(newName)
      const allowedFolder = getAllowedFolder(folderAccess, event)
      try {
        // assertWithinFolder は「許可フォルダの内部」のみ許可するため、
        // ルートフォルダ自体のリネームはここで自動的に拒否される
        await folderAccess.assertWithinFolder(allowedFolder, targetPath)
        await renameEntry(targetPath, join(dirname(targetPath), newName))
      } catch (err) {
        throw convertFsError(err, newName, targetPath)
      }
    }
  )

  ipcMain.handle('fs:deleteEntry', async (event: IpcMainInvokeEvent, targetPath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    try {
      // assertWithinFolder により、ルートフォルダ自体の削除は自動的に拒否される
      await folderAccess.assertWithinFolder(allowedFolder, targetPath)
      await deleteEntry(targetPath)
    } catch (err) {
      throw convertFsAccessError(err, `対象が見つかりません: ${targetPath}`, targetPath)
    }
  })

  ipcMain.handle('fs:addToGitignore', async (event: IpcMainInvokeEvent, targetPath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    let relativePath: string
    try {
      // エクスプローラーのツリーが未更新のまま、ディスク上では既に削除された
      // ファイルに対して呼ばれることがある(git:stage 等と同じ理由)。
      // resolveAndAssertRelativePath 内の assertFileWithinFolder の ENOENT
      // フォールバックで許容する
      relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, targetPath)
    } catch (err) {
      throw convertFsAccessError(err, `対象が見つかりません: ${targetPath}`, targetPath)
    }
    const gitignorePath = join(allowedFolder, '.gitignore')
    try {
      // 書き込み先の .gitignore 自体も境界チェックする。addToGitignore は
      // readFileContent/writeFileContent で素に読み書きしており、これらは
      // シンボリックリンクを辿るため、悪意あるリポジトリで .gitignore が
      // サンドボックス外(~/.zshrc 等)へのリンクだと、その実体が書き換えられて
      // しまう。他の fs ハンドラは全て realpath ベースの境界チェックを通している。
      // まだ .gitignore が無い場合は ENOENT フォールバックで親(allowedFolder 自身)が
      // 検証されるため、新規作成の経路は塞がれない
      await assertFileWithinFolder(folderAccess, allowedFolder, gitignorePath)
      // realpath ベースのチェックだけでは、リンク先がまだ存在しない
      // 「壊れたシンボリックリンク」を防げない。realpath が ENOENT を返すため
      // 上の ENOENT フォールバックが親(allowedFolder 自身)の検証だけで通してしまい、
      // その後 writeFileContent が symlink を辿ってサンドボックス外にファイルを
      // 新規作成する(実機で再現確認済み)。lstat ベースで symlink 自体を弾く。
      // .gitignore が存在しなければ lstat は ENOENT を投げるが、それは
      // 「これから新規作成する」正常な経路なので通す
      if (await isGitignoreSymlink(gitignorePath)) {
        throw new Error(`Access denied: ${gitignorePath} はシンボリックリンクです`)
      }
      await addToGitignore(allowedFolder, relativePath)
    } catch (err) {
      // ここで失敗する原因は targetPath ではなく .gitignore 自体(境界チェック・
      // 書き込み権限・ディスクフル等)にあるため、対象ファイルとは別のパスを提示する
      throw convertFsAccessError(
        err,
        `.gitignore が見つかりません: ${gitignorePath}`,
        gitignorePath
      )
    }
  })
}
