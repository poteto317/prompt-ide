export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

/** ディスク上の外部変更の種類(保存の直前の照合・監視の通知の結果) */
export type ExternalChangeKind = 'modified' | 'deleted'

/** fs:writeFileChecked の結果。照合が一致すれば書き込み、違えば書き込まずに理由を返す */
export type WriteFileCheckedResult =
  | { kind: 'written' }
  | { kind: 'conflict'; reason: ExternalChangeKind }

/** fs:externalChange の通知。変わった可能性のある、開いているタブのパス */
export interface ExternalFileChangeEvent {
  paths: string[]
}

/** fs:folderChange の通知。開いているフォルダの中で何かが変わった合図(パスは含めない。renderer は今のフォルダを読み直す)。
 *  treeChanged が偽なら、git status だけが変わりうる(ツリーに出ない深さ・.git の中の変化) */
export interface FolderChangeEvent {
  treeChanged: boolean
}
