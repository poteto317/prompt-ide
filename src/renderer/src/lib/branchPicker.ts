import type { GitBranch } from '@shared/types'

export interface BranchPickerItem {
  name: string
  isCurrent: boolean
}

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

// 開いたときの選択。現在のブランチの次の候補、無ければ先頭、候補が 0 件なら null
export function initialBranchPickerSelection(items: readonly BranchPickerItem[]): string | null {
  const currentIndex = items.findIndex((item) => item.isCurrent)
  return (items[currentIndex + 1] ?? items[0])?.name ?? null
}

// 選択中の名前を今の候補に合わせる。候補から消えていたら先頭、候補が 0 件なら null
export function resolveBranchPickerSelection(
  items: readonly BranchPickerItem[],
  selected: string | null
): string | null {
  if (items.some((item) => item.name === selected)) return selected
  return items[0]?.name ?? null
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
