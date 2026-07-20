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

  // allowedPath がドライブルート('C:\\')やファイルシステムルート('/')など既に
  // 区切り文字で終わっている場合、prefix は allowedPath と同一になってしまう
  // (末尾に区切りを重ねて付けない)。assertWithinFolder/assertParentWithinFolder の
  // 両方で使うため一箇所にまとめる。
  private toPrefix(allowedPath: string): string {
    return allowedPath.endsWith(sep) ? allowedPath : allowedPath + sep
  }

  async assertWithinFolder(allowedPath: string, targetPath: string): Promise<void> {
    const resolvedTarget = await realpath(targetPath)
    // prefix が allowedPath と同一になるケース(上記参照)では、
    // 「resolvedTarget === allowedPath(= 開いているフォルダそのもの)」も
    // startsWith(prefix) を満たしてしまう(文字列は自分自身で始まるため)。
    // 等値は許可フォルダ末尾の区切り有無に関わらず常に拒否することを明示する。
    if (resolvedTarget === allowedPath) {
      throw new Error(`Access denied: ${targetPath}`)
    }
    if (!resolvedTarget.startsWith(this.toPrefix(allowedPath))) {
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
    if (resolvedParent !== allowedPath && !resolvedParent.startsWith(this.toPrefix(allowedPath))) {
      throw new Error(`Access denied: ${parentPath}`)
    }
    return resolvedParent
  }
}
