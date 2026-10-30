import type { GitBranch } from '@shared/types'

export interface BranchPickerItem {
  name: string
  isCurrent: boolean
}

/** 一覧の先頭の「新しいブランチを作成」の項目の識別子。実在のブランチと衝突しないよう、Git のブランチ名に使えない文字を含める */
export const CREATE_BRANCH_OPTION = '\0create'

export type BranchPickerShortcut = 'merge' | 'delete'

/** 入力欄に付ける aria-keyshortcuts の告知。getBranchPickerShortcut の判定と同じ場所に置き、食い違わないようにする */
export const BRANCH_PICKER_ARIA_KEYSHORTCUTS = 'Alt+M Shift+Delete'

// 一覧の候補。現在のブランチは gitStatus 由来の currentBranch だけで決める(branches は履歴の再取得でしか
// 更新されず、gitStatus より遅れることがある)。null は detached。同じ理由で GitBranch.current は使わず、
// 実在しない疑似項目は取得元の getBranches が付けた isDetachedHead で除く
export function buildBranchPickerItems(
  branches: readonly GitBranch[],
  currentBranch: string | null,
  query: string
): BranchPickerItem[] {
  const needle = query.trim().toLowerCase()
  const others = branches
    .filter((branch) => !branch.isDetachedHead && branch.name !== currentBranch)
    .map((branch) => ({ name: branch.name, isCurrent: false }))
  // branches に無くても足す(コミットの無いリポジトリでは branches が空になる)
  const items =
    currentBranch === null ? others : [{ name: currentBranch, isCurrent: true }, ...others]
  return items.filter((item) => item.name.toLowerCase().includes(needle))
}

// 候補の先頭に作成の項目を足す。絞り込みの影響を受けないよう、絞り込みの後に足す
export function withCreateBranchOption(items: readonly BranchPickerItem[]): BranchPickerItem[] {
  return [{ name: CREATE_BRANCH_OPTION, isCurrent: false }, ...items]
}

// 開いたときの選択(items はブランチの候補だけ)。現在のブランチの次の候補、無ければ先頭、候補が 0 件なら null
export function initialBranchPickerSelection(items: readonly BranchPickerItem[]): string | null {
  const currentIndex = items.findIndex((item) => item.isCurrent)
  return (items[currentIndex + 1] ?? items[0])?.name ?? null
}

// 選択中の名前を今の候補に合わせる。候補から消えていたら先頭のブランチ、ブランチが無ければ作成の項目、
// 候補が 0 件なら null。作成の項目を優先すると、一覧の更新だけで選択がブランチから離れてしまう
export function resolveBranchPickerSelection(
  items: readonly BranchPickerItem[],
  selected: string | null
): string | null {
  if (items.some((item) => item.name === selected)) return selected
  const firstBranch = items.find((item) => item.name !== CREATE_BRANCH_OPTION)
  return (firstBranch ?? items[0])?.name ?? null
}

// 選択を delta(1 / -1)だけ循環して動かす。候補に無い選択は、画面と同じく先頭が選ばれている扱いにする
export function moveBranchPickerSelection(
  items: readonly BranchPickerItem[],
  selected: string | null,
  delta: 1 | -1
): string | null {
  if (items.length === 0) return null
  const resolved = resolveBranchPickerSelection(items, selected)
  const index = items.findIndex((item) => item.name === resolved)
  return items[(index + delta + items.length) % items.length].name
}

// 入力欄のキーを、選択中の行のマージ・削除へ解釈する。絞り込みの入力と衝突しないよう修飾キーを必須にする。
// macOS の Option+M は e.key が µ になるため、物理キー(code)で判定する。該当しなければ null
export function getBranchPickerShortcut(e: {
  key: string
  code: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): BranchPickerShortcut | null {
  if (e.ctrlKey || e.metaKey) return null
  if (e.code === 'KeyM' && e.altKey && !e.shiftKey) return 'merge'
  if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey && !e.altKey) return 'delete'
  return null
}
