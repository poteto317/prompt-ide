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

  /**
   * 新規作成先・リネーム先の検証用。assertWithinFolder は realpath(target) を使うため
   * まだ存在しないパスに使えない — 代わりに親ディレクトリを realpath して
   * 「許可フォルダ自身またはその内部」であることを検証し、解決済みの親パスを返す。
   * (許可フォルダ直下への作成があるため、assertWithinFolder と違い等値も許可する)
   */
  async assertParentWithinFolder(allowedPath: string, parentPath: string): Promise<string> {
    const resolvedParent = await realpath(parentPath)
    const prefix = allowedPath.endsWith(sep) ? allowedPath : allowedPath + sep
    if (resolvedParent !== allowedPath && !resolvedParent.startsWith(prefix)) {
      throw new Error(`Access denied: ${parentPath}`)
    }
    return resolvedParent
  }
}
