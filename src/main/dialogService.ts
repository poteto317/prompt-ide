import { dialog } from 'electron'

export async function openFolderDialog(): Promise<string | null> {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  return filePaths[0] ?? null
}
