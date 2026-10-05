import type { IpcMainInvokeEvent } from 'electron'
import type { FolderAccessManager } from '../folderAccessManager'

export function getAllowedFolder(
  folderAccess: FolderAccessManager,
  event: IpcMainInvokeEvent
): string {
  const allowedFolder = folderAccess.get(event.sender.id)
  if (allowedFolder === undefined) throw new Error('No folder open')
  return allowedFolder
}

export async function assertFileAccess(
  folderAccess: FolderAccessManager,
  event: IpcMainInvokeEvent,
  filePath: string
): Promise<void> {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  await folderAccess.assertWithinFolder(allowedFolder, filePath)
}

// 境界の規則(イベントに依らない)は main 直下。既存の handler の import を変えないよう、ここからも出す
export { assertFileWithinFolder } from '../fileWithinFolder'
