import type { AgentChangeEntry } from '@shared/types'
import { toAgentChangeRelativePath } from '@shared/types'
import type { AgentChangesView } from '../hooks/useAgentChanges'
import type { DiffTabKey } from '../hooks/useDiffTabs'
import { isSamePath } from './pathUtils'

// エージェントの変更の配線(useAgentChangesWiring)の業務規則。hook から外して、描画なしで検査できるようにする

/**
 * エージェントの変更の一覧から消えたパスの agent の diff タブ(記録が無くなったらすべての agent のタブ)。
 * 記録中で一覧をまだ取っていない(list が null)ときは、消えたかが分からないため null(何もしない)を返す。
 * 一覧の行のフォルダ('<dir>/')とタブのパス('<dir>')は同じものとして扱う。unstaged・staged のタブは対象外
 */
export function findAgentDiffTabsToClose(
  tabs: readonly DiffTabKey[],
  view: AgentChangesView
): DiffTabKey[] | null {
  const list = view.kind === 'recording' ? view.list : null
  if (view.kind === 'recording' && list === null) return null
  const paths = (list?.entries ?? []).map((entry) => toAgentChangeRelativePath(entry.path))
  return tabs.filter(
    (tab) => tab.kind === 'agent' && !paths.some((path) => isSamePath(path, tab.path))
  )
}

/**
 * diff タブのハンクで戻せる行か。戻せるのは記録した変更(M)だけ。追加・削除・種類の変更(T)はファイル単位で戻す
 * (設計書「diff タブ」「戻す」。main の revertAgentChangeHunk も T を拒否する)。記録していないファイルを含む行・フォルダの行も戻せない
 */
export function canRevertAgentHunk(entry: AgentChangeEntry | undefined): boolean {
  return entry !== undefined && entry.status === 'M' && !entry.notRecorded && !entry.isDirectory
}

/** アクティブな agent の diff タブの、一覧の行(タブが agent でない・記録が無い・一覧に無いなら undefined) */
export function findActiveAgentEntry(
  view: AgentChangesView,
  activeDiffTab: DiffTabKey | null
): AgentChangeEntry | undefined {
  if (activeDiffTab?.kind !== 'agent' || view.kind !== 'recording') return undefined
  return view.list?.entries.find((entry) => isSamePath(entry.path, activeDiffTab.path))
}
