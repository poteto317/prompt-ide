import { useState } from 'react'
import { computeAdjacentItem } from '../lib/computeAdjacentItem'
import { isSamePath } from '../lib/pathUtils'

/**
 * diff タブの種類。unstaged: 未ステージ(index → 作業ツリー)、staged: ステージ済み(HEAD → index)、
 * agent: エージェントの変更(記録の時点 → 作業ツリー。ステージの操作は無く、実行前に戻す操作だけ)
 */
export type DiffTabKind = 'unstaged' | 'staged' | 'agent'

export interface DiffTabKey {
  path: string
  kind: DiffTabKind
}

export interface DiffTabsState {
  diffTabs: DiffTabKey[]
  activeDiffTab: DiffTabKey | null
  openDiffTab: (key: DiffTabKey) => void
  closeDiffTab: (key: DiffTabKey) => void
  activateDiffTab: (key: DiffTabKey) => void
  /** diff タブをどれもアクティブでない状態に戻す(実ファイルタブへ切り替えるときに使う) */
  deactivateDiffTab: () => void
}

// useFileSystem.ts/useFileEditing.ts/useFileTreeOperations.ts と同じく isSamePath で
// 区切り文字・(Windows の)大文字小文字の表記揺れを吸収する。素の === のままだと、
// 同一ファイルの diff タブが表記違いで重複して開いてしまう。
// useDiffOperations.ts でも同じ DiffTabKey 同士の比較が必要なため export する
// (別実装で再現すると、path 正規化ルールを変更したときに片方だけ更新されずずれる)
export function isSameKey(a: DiffTabKey, b: DiffTabKey): boolean {
  return isSamePath(a.path, b.path) && a.kind === b.kind
}

// 既にアクティブなタブと同じキーであれば、新しいオブジェクト参照を作らず既存の
// 参照を保つ。参照が変わるたびに activeDiffTab を依存配列に持つ useDiffOperations
// の effect が発火し、diff を無駄に再取得してしまうため。openDiffTab/activateDiffTab
// の両方で必要な判定のため共有する。
// current が null(deactivateDiffTab 直後等)の場合はこのガードだけでは再利用
// できないため、呼び出し元から渡された tabs(diffTabs 配列)の中に同じキーの
// 既存オブジェクトが無いかも確認する。無いと、実ファイルタブへ切り替えて
// 戻ってくるたびに(decodeDiffTabPath が毎回生成する新しいオブジェクトが
// そのまま入り)無駄な diff 再取得が発生する
function resolveActiveKey(
  current: DiffTabKey | null,
  key: DiffTabKey,
  tabs: DiffTabKey[]
): DiffTabKey {
  if (current !== null && isSameKey(current, key)) return current
  return tabs.find((t) => isSameKey(t, key)) ?? key
}

export function useDiffTabs(): DiffTabsState {
  const [diffTabs, setDiffTabs] = useState<DiffTabKey[]>([])
  const [activeDiffTab, setActiveDiffTab] = useState<DiffTabKey | null>(null)

  // setActiveDiffTab に渡す resolveActiveKey は「diffTabs 内に既存の同じキーの
  // オブジェクトがあれば再利用する」ためのもの。外側スコープの diffTabs(前回
  // レンダー時点のクロージャ)を見ていると、同一レンダーサイクル内で複数回
  // openDiffTab が呼ばれた場合、後続の呼び出しが「まだ何も追加されていない」
  // diffTabs を基準に判定してしまい、既に diffTabs に追加済みのタブに対しても
  // 呼び出し元が渡した新しいオブジェクトをそのまま activeDiffTab にしてしまう
  // (closeDiffTab と同じ理由で setDiffTabs の updater 内から判定する)
  const openDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => {
      const next = prev.some((t) => isSameKey(t, key)) ? prev : [...prev, key]
      setActiveDiffTab((current) => resolveActiveKey(current, key, next))
      return next
    })
  }

  // setDiffTabs の updater 内から setActiveDiffTab を呼ぶ形にしているのは、
  // 「閉じた後どのタブへ移るか」の算出に “その時点の” タブ配列(prev)が要るため。
  // useAppState.ts は同じレンダー内で closeDiffTab をループで連続呼び出しする
  // (gitStatus から消えたタブを閉じる/フォルダ切替で全タブを閉じる)ので、
  // 外側スコープの diffTabs から算出して外に出すと、2 件目以降が 1 件目の削除を
  // 反映していない古い配列を基準にしてしまい、削除が取りこぼされる。
  // updater を純粋に保つなら tabs と activeTab を 1 つの state へ統合する必要があり、
  // 単純に外へ出すだけの変更は上記の取りこぼしを招くので行わないこと
  const closeDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => {
      const index = prev.findIndex((t) => isSameKey(t, key))
      if (index === -1) return prev
      const next = prev.filter((t) => !isSameKey(t, key))
      setActiveDiffTab((current) => {
        if (current === null || !isSameKey(current, key)) return current
        // 実ファイルタブ(useFileSystem.ts)と同じ「閉じた後どちらへ移るか」の
        // ロジックを computeAdjacentItem として共有している。片方だけ実装がずれると、
        // 同じタブバー上でタブの種類によって挙動が変わり一貫性が無くなる
        return computeAdjacentItem(next, index)
      })
      return next
    })
  }

  // openDiffTab は必ず diffTabs に追加してから activeDiffTab を設定するが、
  // activateDiffTab は「既存タブをアクティブにする」用途のため、diffTabs に
  // 存在しないキーでは activateDiffTab しない。存在確認を怠ると、
  // useAppState.ts の gitStatus.files effect による自動 closeDiffTab と
  // タイミングが重なった場合に、既に閉じられたタブのキーで activeDiffTab が
  // 設定され、diffTabs のどのタブとも対応しない「ゴーストタブ」
  // (タブバーにハイライトが無いのに diff 表示だけ残る)が生まれてしまう。
  // setDiffTabs の updater 内で判定するのは、openDiffTab/closeDiffTab と同じ理由
  // (外側スコープの diffTabs は前回レンダー時点のクロージャで、同一レンダー
  // サイクル内の直前の変更を反映していない可能性があるため)
  const activateDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => {
      if (!prev.some((t) => isSameKey(t, key))) return prev
      setActiveDiffTab((current) => resolveActiveKey(current, key, prev))
      return prev
    })
  }

  const deactivateDiffTab = (): void => {
    setActiveDiffTab(null)
  }

  return { diffTabs, activeDiffTab, openDiffTab, closeDiffTab, activateDiffTab, deactivateDiffTab }
}
