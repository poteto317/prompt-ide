import { vi } from 'vitest'
import type {
  AgentChangeEntry,
  AgentChangesList,
  AgentChangesListResult,
  AgentChangesRun,
  AgentChangesScope,
  AgentChangesScopeUnavailableReason,
  AgentChangesState
} from '@shared/types'
import type { AgentChangesController } from '../hooks/useAgentChanges'
import type { AgentChangesView, AgentDiffActions } from '../types'
import type { AgentChangesRevertState } from '../hooks/useAgentChangesRevert'
import type { AgentChangesPanelState } from '../hooks/useAgentChangesWiring'

// エージェントの変更(行・一覧・記録中の view・controller・戻す操作・パネル・diff タブのハンクの操作)の型付きの偽物(1 か所から作る。パターン 102)。
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

/** 実行 1 つ。既定は runId・number 1、開始 100、最後の実行(終わり null)、選べる */
export function makeAgentChangesRun(overrides: Partial<AgentChangesRun> = {}): AgentChangesRun {
  return {
    runId: 1,
    number: 1,
    startedAt: 100,
    endedAt: null,
    availability: { kind: 'available' },
    ...overrides
  }
}

/** IPC の記録中の状態(begin・getState の応答)。startedAt の既定は 100、実行なし */
export function makeAgentChangesRecordingState(
  overrides: { startedAt?: number; runs?: AgentChangesRun[] } = {}
): Extract<AgentChangesState, { kind: 'recording' }> {
  const { startedAt = 100, runs = [] } = overrides
  return { kind: 'recording', startedAt, runs }
}

/** 記録中の view。entries が null なら一覧をまだ取っていない記録中。startedAt の既定は 100、実行なし、一覧の範囲は累積 */
export function makeAgentChangesRecordingView(
  entries: AgentChangeEntry[] | null,
  overrides: {
    startedAt?: number
    totalCount?: number
    truncated?: boolean
    headChanged?: boolean
    runs?: AgentChangesRun[]
    scope?: AgentChangesScope
  } = {}
): AgentChangesView {
  const { startedAt = 100, runs = [], scope = { kind: 'all' }, ...listOverrides } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    list:
      entries === null
        ? null
        : { kind: 'listed', scope, ...makeAgentChangesList(entries, listOverrides) }
  }
}

/** 範囲の一覧を出せない(写しが古い)記録中の view。startedAt の既定は 100、実行なし */
export function makeAgentChangesScopeUnavailableView(
  scope: AgentChangesScope,
  reason: AgentChangesScopeUnavailableReason,
  overrides: { startedAt?: number; runs?: AgentChangesRun[] } = {}
): AgentChangesView {
  return {
    ...makeAgentChangesRecordingState(overrides),
    list: { kind: 'scope-unavailable', scope, reason }
  }
}

/** IPC の list の結果(kind: 'recording')。startedAt の既定は 100、実行なし、範囲は累積 */
export function makeAgentChangesListResult(
  entries: AgentChangeEntry[],
  overrides: Partial<
    Omit<Extract<AgentChangesListResult, { kind: 'recording' }>, 'kind' | 'entries'>
  > = {}
): AgentChangesListResult {
  const { startedAt = 100, runs = [], scope = { kind: 'all' }, ...listOverrides } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    scope,
    ...makeAgentChangesList(entries, listOverrides)
  }
}

/** IPC の list の結果(kind: 'scope-unavailable'。範囲の一覧を出せない)。startedAt の既定は 100、実行なし */
export function makeAgentChangesScopeUnavailableListResult(
  scope: AgentChangesScope,
  reason: AgentChangesScopeUnavailableReason,
  overrides: { startedAt?: number; runs?: AgentChangesRun[] } = {}
): AgentChangesListResult {
  const { startedAt = 100, runs = [] } = overrides
  return { kind: 'scope-unavailable', startedAt, runs, scope, reason }
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
    quietRefreshCount: 0,
    scope: { kind: 'all' },
    begin: vi.fn<AgentChangesController['begin']>(async () => undefined),
    refresh: vi.fn<AgentChangesController['refresh']>(async () => undefined),
    clear: vi.fn<AgentChangesController['clear']>(async () => undefined),
    markSaved: vi.fn<AgentChangesController['markSaved']>(),
    announce: vi.fn<AgentChangesController['announce']>(),
    selectScope: vi.fn<AgentChangesController['selectScope']>(),
    ...overrides
  }
}

/** セクションへ渡す changes(パネルの begin は引数なし)。既定は makeAgentChangesController の既定と、resolve する begin の vi.fn */
export function makeAgentChangesPanelChanges(
  overrides: Partial<AgentChangesPanelState['changes']> = {}
): AgentChangesPanelState['changes'] {
  return {
    ...makeAgentChangesController(),
    begin: vi.fn<AgentChangesPanelState['changes']['begin']>(async () => undefined),
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
    errorPath: null,
    isErrorAnnouncedInDiff: false,
    hunkNotice: null,
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
    changes: makeAgentChangesPanelChanges(),
    focusRequest: { isRequested: false, consume: vi.fn<() => void>() },
    revert: makeAgentChangesRevertState(),
    folderPath: '/repo',
    isAgentMode: true,
    onOpenDiff: vi.fn<AgentChangesPanelState['onOpenDiff']>(),
    ...overrides
  }
}

/** diff タブのハンクの操作(EditorPanel・DiffView へ渡す)。既定は戻せる・累積の内容(実行の番号なし)・理由も失敗も通知もなし */
export function makeAgentDiffActions(overrides: Partial<AgentDiffActions> = {}): AgentDiffActions {
  return {
    canRevertHunk: true,
    contentRunNumber: null,
    disabledReason: null,
    error: null,
    notice: null,
    onRevertHunk: vi.fn<AgentDiffActions['onRevertHunk']>(),
    ...overrides
  }
}
