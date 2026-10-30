// 配列から要素が消えたとき、消えた要素があった位置を基準に次にアクティブにする
// 要素を返す。右隣を優先し、無ければ左隣、どちらも無ければ null
// (右優先はエディタタブの一般的な挙動に合わせる)。
// lib/openTabs.ts(実ファイルタブ)と useDiffTabs.ts(diff タブ)の両方が
// 同じ「閉じた後どちらへ移るか」のロジックを必要とするため、ここに切り出して共有する
export function computeAdjacentItem<T>(next: readonly T[], removedIndex: number): T | null {
  if (removedIndex === -1) return next[0] ?? null
  if (removedIndex < next.length) return next[removedIndex]
  if (removedIndex - 1 >= 0 && removedIndex - 1 < next.length) return next[removedIndex - 1]
  return next[next.length - 1] ?? null
}
