import type { FileTreeNode } from '../types'
import type { ContextMenuItem } from '../components/explorer/ExplorerContextMenu'
import { AGENT_REFERENCE_MENU_LABEL } from './agentReferenceMessages'

export interface ExplorerMenuActions {
  onCreateFile: (parentPath: string) => void
  onCreateDirectory: (parentPath: string) => void
  onRename: (node: FileTreeNode) => void
  onDelete: (node: FileTreeNode) => void
  onAddToGitignore: (node: FileTreeNode) => void
  /** 参照として添える(エージェント CLI 方式のときだけ渡す。ファイルにだけ出す) */
  onAddReference?: (node: FileTreeNode) => void
}

// エクスプローラーの右クリックメニューに表示する項目を、対象ノードの種類に応じて構築する。
// node === null はツリー空白領域(ルート直下への新規作成のみ許可)を表す。
export function buildMenuItems(
  folderPath: string | null,
  node: FileTreeNode | null,
  actions: ExplorerMenuActions
): ContextMenuItem[] {
  if (folderPath === null) return []
  const items: ContextMenuItem[] = []

  // ツリー空白領域(node === null)はルート直下、ディレクトリはその直下に作成できる
  if (node === null || node.type === 'directory') {
    const parentPath = node === null ? folderPath : node.path
    items.push(
      { id: 'createFile', label: '新規ファイル', onSelect: () => actions.onCreateFile(parentPath) },
      {
        id: 'createDirectory',
        label: '新規フォルダ',
        onSelect: () => actions.onCreateDirectory(parentPath)
      }
    )
  }
  if (node !== null) {
    items.push(
      { id: 'rename', label: 'リネーム', onSelect: () => actions.onRename(node) },
      { id: 'delete', label: '削除', onSelect: () => actions.onDelete(node) },
      {
        id: 'addToGitignore',
        label: '.gitignore に追加',
        onSelect: () => actions.onAddToGitignore(node)
      }
    )
  }
  // エージェントへ送るプロンプトの参照として足す(ファイルだけ。フォルダ・空白には出さない)
  const { onAddReference } = actions
  if (node !== null && node.type === 'file' && onAddReference !== undefined) {
    items.push({
      id: 'addReference',
      label: AGENT_REFERENCE_MENU_LABEL,
      onSelect: () => onAddReference(node)
    })
  }
  return items
}
