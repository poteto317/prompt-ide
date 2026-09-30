export type BranchMenuShortcut = 'delete' | 'merge'

/** radio に付ける aria-keyshortcuts の告知文字列。getBranchMenuShortcut の判定と同じ
 *  ファイルに置き、告知と実際のキー判定が食い違わないようにする */
export const BRANCH_MENU_ARIA_KEYSHORTCUTS = 'Delete M'

/** ブランチ一覧の radio 上のキー入力を、削除・マージのショートカットへ解釈する。
 *  Delete は修飾キーに関係なく削除。M は Cmd+M(ウィンドウの最小化)等のショートカットを
 *  奪わないよう、Ctrl・Meta・Alt のいずれも無いときだけマージ。該当しなければ null */
export function getBranchMenuShortcut(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): BranchMenuShortcut | null {
  if (e.key === 'Delete') return 'delete'
  if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) return 'merge'
  return null
}
