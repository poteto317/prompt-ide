import * as gitApi from './gitApi'
import * as agentChangesApi from './agentChangesApi'
import type { DiffTabKey } from '../hooks/useDiffTabs'

export interface DiffTabFetchContext {
  /** 対象ファイルが未追跡か。renderer が持っている git status から渡す
   *  (diff タブを開くたびにリポジトリ全体を再スキャンしないため) */
  isUntracked: boolean
  /** ステージ済みリネームの旧パス。新パスだけだと git がリネーム検出をせず
   *  「新規ファイル + 全行追加」の diff になり、それをアンステージすると
   *  旧パスの削除だけがステージに残ってファイルが消えてしまう */
  renamedFrom: string | undefined
}

/**
 * diff タブの種類ごとに取得元を選んで diff を取得する。
 * エージェントの変更(kind: 'agent')は記録の時点との比較で、git status の情報を使わない
 * (main が記録のインデックスで判定する)。それ以外は git の index・HEAD との比較。
 */
export function fetchDiffForTab(tab: DiffTabKey, context: DiffTabFetchContext): Promise<string> {
  if (tab.kind === 'agent') return agentChangesApi.getAgentChangeDiff(tab.path)
  return gitApi.getDiff(tab.path, tab.kind === 'staged', context.isUntracked, context.renamedFrom)
}
