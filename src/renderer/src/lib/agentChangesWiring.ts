import type { AgentChangeEntry, AgentChangesScope } from '@shared/types'
import { toAgentChangeRelativePath } from '@shared/types'
import type { AgentChangesView } from '../types'
import type { DiffTabKey } from '../hooks/useDiffTabs'
import { findAgentChangesRun, getListedAgentChanges } from './agentChangesScope'
import { isSamePath } from './pathUtils'

// エージェントの変更の配線(useAgentChangesWiring)の業務規則。hook から外して、描画なしで検査できるようにする

/**
 * エージェントの変更の一覧から消えたパスの agent の diff タブ(記録が無くなったらすべての agent のタブ)。
 * 記録中で一覧をまだ取っていない(list が null)・範囲の一覧が取れない(scope-unavailable)ときは、消えたかが分からないため
 * null(何もしない)を返す。一覧の行のフォルダ('<dir>/')とタブのパス('<dir>')は同じものとして扱う。unstaged・staged のタブは対象外
 */
export function findAgentDiffTabsToClose(
  tabs: readonly DiffTabKey[],
  view: AgentChangesView
): DiffTabKey[] | null {
  if (view.kind === 'recording' && view.list?.kind !== 'listed') return null
  const paths = (getListedAgentChanges(view)?.entries ?? []).map((entry) =>
    toAgentChangeRelativePath(entry.path)
  )
  return tabs.filter(
    (tab) => tab.kind === 'agent' && !paths.some((path) => isSamePath(path, tab.path))
  )
}

/** 記録中で、選んでいる範囲の一覧が取れない(scope-unavailable)か */
export function isAgentChangesScopeUnavailable(view: AgentChangesView): boolean {
  return view.kind === 'recording' && view.list?.kind === 'scope-unavailable'
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
  if (activeDiffTab?.kind !== 'agent') return undefined
  return getListedAgentChanges(view)?.entries.find((entry) =>
    isSamePath(entry.path, activeDiffTab.path)
  )
}

/**
 * 表示中の agent の diff の内容を取った範囲が累積か(ハンクを戻せるのはこのときだけ)。実行の範囲の diff から作ったパッチは、
 * 逆適用すると戻す先が実行の開始の時点になる(L-058)。内容が無い間(null)は累積ではない
 */
export function isCumulativeAgentDiffScope(
  scope: AgentChangesScope | null
): scope is { kind: 'all' } {
  return scope?.kind === 'all'
}

/** 表示中の agent の diff の内容を取った範囲が実行なら、写しの実行の番号(diff タブのラベルの「実行 N」)。それ以外は null */
export function agentDiffContentRunNumber(
  view: AgentChangesView,
  scope: AgentChangesScope | null
): number | null {
  if (scope?.kind !== 'run' || view.kind !== 'recording') return null
  return findAgentChangesRun(view.runs, scope.runId)?.number ?? null
}
