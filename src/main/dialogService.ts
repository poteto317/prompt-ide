import { dialog } from 'electron'

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }]

export async function openFolderDialog(): Promise<string | null> {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  return filePaths[0] ?? null
}

/** JSON 保存先を選ぶダイアログ。キャンセル時は null を返す。 */
export async function saveJsonDialog(defaultFileName: string): Promise<string | null> {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: defaultFileName,
    filters: JSON_FILTERS,
  })
  return filePath ?? null
}

/** JSON 読み込み元を選ぶダイアログ。キャンセル時は null を返す。 */
export async function openJsonDialog(): Promise<string | null> {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: JSON_FILTERS,
  })
  return filePaths[0] ?? null
}
