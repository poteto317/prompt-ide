import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'

export class FolderAccessManager {
  private readonly folders = new Map<number, string>()

  set(webContentsId: number, path: string): void {
    this.folders.set(webContentsId, path)
  }

  get(webContentsId: number): string | undefined {
    return this.folders.get(webContentsId)
  }

  delete(webContentsId: number): void {
    this.folders.delete(webContentsId)
  }

  async assertWithinFolder(allowedPath: string, targetPath: string): Promise<void> {
    const resolvedTarget = await realpath(targetPath)
    const prefix = allowedPath.endsWith(sep) ? allowedPath : allowedPath + sep
    if (!resolvedTarget.startsWith(prefix)) {
      throw new Error(`Access denied: ${targetPath}`)
    }
  }
}
