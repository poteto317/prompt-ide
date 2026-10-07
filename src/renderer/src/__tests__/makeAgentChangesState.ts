import { vi } from 'vitest'
import type { AgentChangeEntry, AgentChangesList, AgentChangesListResult } from '@shared/types'
import type { AgentChangesController, AgentChangesView } from '../hooks/useAgentChanges'
import type { AgentChangesRevertState } from '../hooks/useAgentChangesRevert'
import type { AgentChangesPanelState } from '../hooks/useAgentChangesWiring'

// エージェントの変更(行・一覧・記録中の view・controller・戻す操作・パネル)の型付きの偽物(1 か所から作る。パターン 102)。
// 型にフィールドが増えたときに、試す対象ではないテストまで直さずに済むようにする(SRP L3-03)。
// 操作はそれぞれの型で vi.fn を作るため、戻り値の契約から外れた上書きは型検査で分かる

/** 一覧の行。既定は status 'M'・ファイル・記録済み */
export function makeAgentChangeEntry(
  path: string,
  overrides: Partial<AgentChangeEntry> = {}
): AgentChangeEntry {
  return { path, status: 'M', isDirectory: false, notRecorded: false, ...overrides }
}

/** 一覧(記録の時点との比較)。totalCount の既定は entries.length、打ち切りなし・HEAD は変わっていない */
export function makeAgentChangesList(
  entries: AgentChangeEntry[],
  overrides: Partial<Omit<AgentChangesList, 'entries'>> = {}
): AgentChangesList {
  return {
    entries,
    totalCount: overrides.totalCount ?? entries.length,
    truncated: overrides.truncated ?? false,
    headChanged: overrides.headChanged ?? false
  }
}

/** 記録中の view。entries が null なら一覧をまだ取っていない記録中。startedAt の既定は 100 */
export function makeAgentChangesRecordingView(
  entries: AgentChangeEntry[] | null,
  overrides: {
    startedAt?: number
    totalCount?: number
    truncated?: boolean
    headChanged?: boolean
  } = {}
): AgentChangesView {
  const { startedAt = 100, ...listOverrides } = overrides
  return {
    kind: 'recording',
    startedAt,
    list: entries === null ? null : makeAgentChangesList(entries, listOverrides)
  }
}

/** IPC の list の結果(kind: 'recording')。startedAt の既定は 100 */
export function makeAgentChangesListResult(
  entries: AgentChangeEntry[],
  overrides: Partial<
    Omit<Extract<AgentChangesListResult, { kind: 'recording' }>, 'kind' | 'entries'>
  > = {}
): AgentChangesListResult {
  const { startedAt = 100, ...listOverrides } = overrides
  return { kind: 'recording', startedAt, ...makeAgentChangesList(entries, listOverrides) }
}

/** useAgentChanges の戻り値。既定は記録なし・読み込みなし・失敗なし・通知なし。操作はすべて resolve する vi.fn */
export function makeAgentChangesController(
  overrides: Partial<AgentChangesController> = {}
): AgentChangesController {
  return {
    view: { kind: 'none' },
    isLoading: false,
    isBeginning: false,
    listError: null,
    notice: null,
    savedPaths: new Set(),
    begin: vi.fn<AgentChangesController['begin']>(async () => undefined),
    refresh: vi.fn<AgentChangesController['refresh']>(async () => undefined),
    clear: vi.fn<AgentChangesController['clear']>(async () => undefined),
    markSaved: vi.fn<AgentChangesController['markSaved']>(),
    announce: vi.fn<AgentChangesController['announce']>(),
    ...overrides
  }
}

/** useAgentChangesRevert の戻り値。既定は押せる・実行していない・失敗なし。操作はすべて resolve する vi.fn */
export function makeAgentChangesRevertState(
  overrides: Partial<AgentChangesRevertState> = {}
): AgentChangesRevertState {
  return {
    isReverting: false,
    error: null,
    revertDisabledReason: null,
    revertAllDisabledReason: null,
    revertFile: vi.fn<AgentChangesRevertState['revertFile']>(async () => undefined),
    revertHunk: vi.fn<AgentChangesRevertState['revertHunk']>(async () => undefined),
    revertAll: vi.fn<AgentChangesRevertState['revertAll']>(async () => undefined),
    ...overrides
  }
}

/**
 * セクション「エージェントの変更」へ渡す状態(isNotRepository を除く props)。changes・revert は上の 2 つで作る。
 * 既定はエージェント CLI 方式・フォルダ '/repo'・フォーカスの依頼なし
 */
export function makeAgentChangesPanelState(
  overrides: Partial<AgentChangesPanelState> = {}
): AgentChangesPanelState {
  return {
    changes: makeAgentChangesController(),
    focusRequest: { isRequested: false, consume: vi.fn<() => void>() },
    revert: makeAgentChangesRevertState(),
    folderPath: '/repo',
    isAgentMode: true,
    onOpenDiff: vi.fn<AgentChangesPanelState['onOpenDiff']>(),
    ...overrides
  }
}
