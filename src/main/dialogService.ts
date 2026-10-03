import { dialog } from 'electron'
import type { BrowserWindow, OpenDialogOptions } from 'electron'

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }]

const OPEN_FOLDER_DIALOG_OPTIONS: OpenDialogOptions = { properties: ['openDirectory'] }

/** 開くフォルダを選ぶダイアログ。キャンセル時は null を返す。
 *  ウィンドウがあれば、そのウィンドウのモーダル(macOS はシート)にする。親ウィンドウ無しのダイアログは独立したウィンドウに
 *  なり、表示中も画面を操作できる(clone を押して成功した後に、残ったダイアログで選んだフォルダへ許可が書き換わる)ため。
 *  省略時(null)は従来どおり親ウィンドウ無し */
export async function openFolderDialog(
  window: BrowserWindow | null = null
): Promise<string | null> {
  const { filePaths } =
    window === null
      ? await dialog.showOpenDialog(OPEN_FOLDER_DIALOG_OPTIONS)
      : await dialog.showOpenDialog(window, OPEN_FOLDER_DIALOG_OPTIONS)
  return filePaths[0] ?? null
}

/** JSON 保存先を選ぶダイアログ。キャンセル時は null を返す。 */
export async function saveJsonDialog(defaultFileName: string): Promise<string | null> {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: defaultFileName,
    filters: JSON_FILTERS
  })
  return filePath ?? null
}

/** JSON 読み込み元を選ぶダイアログ。キャンセル時は null を返す。 */
export async function openJsonDialog(): Promise<string | null> {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: JSON_FILTERS
  })
  return filePaths[0] ?? null
}

const CLONE_PARENT_DIALOG_OPTIONS: OpenDialogOptions = {
  title: 'clone の保存先（親フォルダ）を選択',
  buttonLabel: 'ここに clone',
  properties: ['openDirectory', 'createDirectory']
}

/** clone の保存先の親フォルダを選ぶダイアログ。キャンセル時は null を返す。
 *  ウィンドウがあれば、そのウィンドウのモーダル(macOS はシート)にする。選んでいる間は画面の操作(clone のダイアログの
 *  `キャンセル` など)を受け付けず、中止は OS のダイアログで行う */
export async function chooseCloneParentDialog(
  window: BrowserWindow | null
): Promise<string | null> {
  const { canceled, filePaths } =
    window === null
      ? await dialog.showOpenDialog(CLONE_PARENT_DIALOG_OPTIONS)
      : await dialog.showOpenDialog(window, CLONE_PARENT_DIALOG_OPTIONS)
  if (canceled) return null
  return filePaths[0] ?? null
}
