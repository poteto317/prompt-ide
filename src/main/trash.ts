import { shell } from 'electron'

// OS のゴミ箱への移動。Electron への依存をここに閉じ、gitService には関数として
// 注入する(gitService の単体テストで Electron をモックせずに済むようにする)
export function moveToTrash(absolutePath: string): Promise<void> {
  return shell.trashItem(absolutePath)
}
