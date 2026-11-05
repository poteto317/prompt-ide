import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'

/** 開いているフォルダが変わったときの通知(webContents の id と新しいフォルダ) */
export type FolderChangeListener = (webContentsId: number, path: string) => void

/** 開いているフォルダの外を指したときの拒否。受け口が範囲外を他の失敗(realpath の ENOENT など)と見分けるために使う。
 *  name は設定しない(IPC 越しに renderer へ届く `Error invoking remote method '...': Error: Access denied: ...` を変えないため) */
export class FolderAccessDeniedError extends Error {}

export class FolderAccessManager {
  private readonly folders = new Map<number, string>()
  private readonly changeListeners = new Set<FolderChangeListener>()

  /** フォルダを設定する。前と違うパスになったときだけ購読者へ通知する(同じフォルダを開き直したときは通知しない) */
  set(webContentsId: number, path: string): void {
    const previous = this.folders.get(webContentsId)
    this.folders.set(webContentsId, path)
    if (previous === path) return
    for (const listener of [...this.changeListeners]) listener(webContentsId, path)
  }

  /** フォルダの変更を購読する。戻り値で解除する(セッションの停止・監視の解除が使う。FolderAccessManager はそれらを知らない) */
  onDidChange(listener: FolderChangeListener): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
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
      throw new FolderAccessDeniedError(`Access denied: ${targetPath}`)
    }
    if (!resolvedTarget.startsWith(this.toPrefix(allowedPath))) {
      throw new FolderAccessDeniedError(`Access denied: ${targetPath}`)
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
      throw new FolderAccessDeniedError(`Access denied: ${parentPath}`)
    }
    return resolvedParent
  }
}
