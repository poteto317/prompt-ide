import { useMemo } from 'react'
import type { OpenFile } from '../types'
import type { DiffTabKey } from './useDiffTabs'
import { isSameKey } from './useDiffTabs'
import { encodeDiffTabPath, isDiffTabPath, decodeDiffTabPath } from './diffTabPath'

// EditorTabs.tsx(唯一の消費者)の Tab 型と構造が同一だったため、二重定義を避けて
// ここから export し EditorTabs.tsx 側で import する
export interface TabItem {
  path: string
  name: string
  isDirty: boolean
  /** ドラッグでの並び替え対象か。並び替えの実体(useFileSystem の reorderTabs)は
   *  実ファイルタブの配列だけを操作するため、diff タブは対象外にする。
   *  これを渡さずに全タブをドラッグ可能にすると、diff タブが絡むドラッグが
   *  範囲外インデックスとして無言で破棄され、ユーザーには「ドラッグできるのに
   *  何も起きない」だけが見える */
  isReorderable: boolean
}

interface Params {
  openFiles: OpenFile[]
  activeFilePath: string | null
  isDirty: boolean
  diffTabs: DiffTabKey[]
  activeDiffTab: DiffTabKey | null
  /** アクティブな agent の diff タブの内容を取った範囲の実行の番号(累積・内容が無い間は null) */
  agentDiffRunNumber: number | null
  /** 実ファイルタブへ切り替える。戻り値は実際に切り替わったか
   *  (開いていないパスなら false)。diff タブの非アクティブ化を
   *  「切り替えが成立したときだけ」に限るために見る */
  onActivateTab: (path: string) => boolean
  onCloseTab: (path: string) => void
  onActivateDiffTab: (key: DiffTabKey) => void
  onCloseDiffTab: (key: DiffTabKey) => void
  /** 実ファイルタブがアクティブ化されるとき、diff タブを非アクティブ化するために呼ぶ */
  onDeactivateDiffTab: () => void
}

interface CombinedEditorTabs {
  combinedTabs: TabItem[]
  activeTabPath: string | null
  handleActivateTab: (path: string) => void
  handleCloseTab: (path: string) => void
}

// diff タブのラベル。フルパス + 種類で一意にする(下の combinedTabs の説明)。エージェントの変更は、内容を取った範囲が実行なら番号を添える
export function diffTabLabel(tab: DiffTabKey, runNumber: number | null): string {
  if (tab.kind === 'agent') {
    return runNumber === null
      ? `${tab.path} (エージェントの変更)`
      : `${tab.path} (エージェントの変更・実行 ${runNumber})`
  }
  return `${tab.path} (${tab.kind === 'staged' ? 'ステージ済み' : '未ステージ'}差分)`
}

// 実ファイルタブと diff タブ(擬似パスでエンコードされたタブ)を1本のタブバーへ
// 統合する責務のみを担う。フォーカス管理等の Monaco 固有ロジックとは責務が異なるため
// EditorPanel から分離している。
export function useCombinedEditorTabs({
  openFiles,
  activeFilePath,
  isDirty,
  diffTabs,
  activeDiffTab,
  agentDiffRunNumber,
  onActivateTab,
  onCloseTab,
  onActivateDiffTab,
  onCloseDiffTab,
  onDeactivateDiffTab
}: Params): CombinedEditorTabs {
  // EditorPanel は isDirty や openFiles の変化(エディタでの1キー入力ごと)で
  // 再レンダーされる。useMemo が無いと、diff タブの有無や中身が何も変わって
  // いないときでも毎回新しい配列・新しい TabItem オブジェクトが作られ、
  // EditorTabs(dnd-kit の DndContext/SortableContext をラップする)へ渡る props
  // が無駄に変化してしまう
  const combinedTabs = useMemo(() => {
    // basename だけだと、ディレクトリが異なる同名ファイルや、同じファイルの
    // staged/unstaged 両方の diff タブが同じラベルになりタブバー上で区別が付かない。
    // フルパス + ステージ状態でラベルの一意性を保つ
    const diffTabItems = diffTabs.map((tab) => ({
      path: encodeDiffTabPath(tab),
      // 実行の番号は内容を持つアクティブなタブにだけ付ける(ほかの agent のタブは内容を取っていない)
      name: diffTabLabel(
        tab,
        activeDiffTab !== null && isSameKey(tab, activeDiffTab) ? agentDiffRunNumber : null
      ),
      isDirty: false,
      isReorderable: false
    }))
    return [
      ...openFiles.map((f) => ({
        path: f.path,
        name: f.name,
        // アクティブなタブは呼び出し元(useFileEditing)が算出した isDirty を使う。
        // 非アクティブなタブにはその算出値が無いため、同じ式で自前に求める
        isDirty: f.path === activeFilePath ? isDirty : f.content !== f.savedContent,
        isReorderable: true
      })),
      ...diffTabItems
    ]
  }, [openFiles, activeFilePath, isDirty, diffTabs, activeDiffTab, agentDiffRunNumber])
  const activeTabPath = activeDiffTab !== null ? encodeDiffTabPath(activeDiffTab) : activeFilePath

  const handleActivateTab = (path: string): void => {
    if (isDiffTabPath(path)) {
      onActivateDiffTab(decodeDiffTabPath(path))
    } else {
      // 実ファイルタブへの切り替え時、diff タブを非アクティブ化する。しないと
      // activeFilePath は更新されてもタブバーのハイライト・本文表示が diff タブの
      // ままになり、実ファイルタブへ二度と戻れなくなる。
      // ただし切り替えが成立したときだけにする。先に無条件で非アクティブ化すると、
      // 開いていないパスを渡されたときに実ファイルタブは変わらないまま diff タブ
      // だけが消え、どちらも表示されないプレースホルダ状態になる
      const activated = onActivateTab(path)
      if (activated) onDeactivateDiffTab()
    }
  }

  const handleCloseTab = (path: string): void => {
    if (isDiffTabPath(path)) {
      onCloseDiffTab(decodeDiffTabPath(path))
    } else {
      onCloseTab(path)
    }
  }

  return { combinedTabs, activeTabPath, handleActivateTab, handleCloseTab }
}
