import { vi } from 'vitest'
import type {
  AgentChangeEntry,
  AgentChangesList,
  AgentChangesListResult,
  AgentChangesRun,
  AgentChangesScope,
  AgentChangesScopeUnavailableReason,
  AgentChangesState,
  AgentChangesUndoResult,
  AgentChangesUndoSummary,
  AgentRevertAllResult,
  AgentRevertResult,
  AgentRevertUndoOutcome
} from '@shared/types'
import type { AgentChangesController } from '../hooks/useAgentChanges'
import type { AgentChangesView, AgentDiffActions } from '../types'
import type { AgentChangesRevertState } from '../hooks/useAgentChangesRevert'
import type { AgentChangesUndoState } from '../hooks/useAgentChangesUndo'
import type { AgentChangesPanelState } from '../hooks/useAgentChangesWiring'

// エージェントの変更(行・一覧・記録中の view・main の応答・controller・戻す操作と取り消しの結果と状態・パネル・diff タブのハンクの操作)の型付きの偽物(1 か所から作る。パターン 102)。
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

/** IPC の記録中の状態(begin・getState の応答)。startedAt の既定は 100、実行なし、取り消しの控えなし */
export function makeAgentChangesRecordingState(
  overrides: {
    startedAt?: number
    runs?: AgentChangesRun[]
    undo?: AgentChangesUndoSummary | null
  } = {}
): Extract<AgentChangesState, { kind: 'recording' }> {
  const { startedAt = 100, runs = [], undo = null } = overrides
  return { kind: 'recording', startedAt, runs, undo }
}

/** 記録中の view。entries が null なら一覧をまだ取っていない記録中。startedAt の既定は 100、実行なし、一覧の範囲は累積、取り消しの控えなし */
export function makeAgentChangesRecordingView(
  entries: AgentChangeEntry[] | null,
  overrides: {
    startedAt?: number
    totalCount?: number
    truncated?: boolean
    headChanged?: boolean
    runs?: AgentChangesRun[]
    scope?: AgentChangesScope
    undo?: AgentChangesUndoSummary | null
  } = {}
): AgentChangesView {
  const {
    startedAt = 100,
    runs = [],
    scope = { kind: 'all' },
    undo = null,
    ...listOverrides
  } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    list:
      entries === null
        ? null
        : { kind: 'listed', scope, ...makeAgentChangesList(entries, listOverrides) },
    undo
  }
}

/** 範囲の一覧を出せない(写しが古い)記録中の view。startedAt の既定は 100、実行なし、取り消しの控えなし */
export function makeAgentChangesScopeUnavailableView(
  scope: AgentChangesScope,
  reason: AgentChangesScopeUnavailableReason,
  overrides: {
    startedAt?: number
    runs?: AgentChangesRun[]
    undo?: AgentChangesUndoSummary | null
  } = {}
): AgentChangesView {
  const { startedAt = 100, runs = [], undo = null } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    list: { kind: 'scope-unavailable', scope, reason },
    undo
  }
}

/** IPC の list の結果(kind: 'recording')。startedAt の既定は 100、実行なし、取り消しの控えなし、範囲は累積 */
export function makeAgentChangesListResult(
  entries: AgentChangeEntry[],
  overrides: Partial<
    Omit<Extract<AgentChangesListResult, { kind: 'recording' }>, 'kind' | 'entries'>
  > = {}
): AgentChangesListResult {
  const {
    startedAt = 100,
    runs = [],
    undo = null,
    scope = { kind: 'all' },
    ...listOverrides
  } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    undo,
    scope,
    ...makeAgentChangesList(entries, listOverrides)
  }
}

/** IPC の list の結果(kind: 'scope-unavailable'。範囲の一覧を出せない)。startedAt の既定は 100、実行なし、取り消しの控えなし */
export function makeAgentChangesScopeUnavailableListResult(
  scope: AgentChangesScope,
  reason: AgentChangesScopeUnavailableReason,
  overrides: {
    startedAt?: number
    runs?: AgentChangesRun[]
    undo?: AgentChangesUndoSummary | null
  } = {}
): AgentChangesListResult {
  const { startedAt = 100, runs = [], undo = null } = overrides
  return { kind: 'scope-unavailable', startedAt, runs, undo, scope, reason }
}

/** 取り消しの控えの要約。既定は undoId 1・ファイル・a.txt の書き戻し */
export function makeAgentChangesUndoSummary(
  overrides: Partial<AgentChangesUndoSummary> = {}
): AgentChangesUndoSummary {
  return {
    undoId: 1,
    operation: 'file',
    entries: [{ path: 'a.txt', action: 'rewrite' }],
    ...overrides
  }
}

/** ファイル・ハンクを戻した結果。既定は控えが取れた */
export function makeAgentRevertResult(
  overrides: Partial<AgentRevertResult> = {}
): AgentRevertResult {
  return { undo: { kind: 'saved' }, undoSummary: makeAgentChangesUndoSummary(), ...overrides }
}

/** すべて戻した結果。既定は done・1 件・控えが取れた。status: 'partial' なら message(既定 'partial')を付ける */
export function makeAgentRevertAllResult(
  overrides: {
    status?: 'done' | 'partial'
    message?: string
    revertedCount?: number
    undo?: AgentRevertUndoOutcome
    undoSummary?: AgentChangesUndoSummary | null
  } = {}
): AgentRevertAllResult {
  const common = {
    revertedCount: overrides.revertedCount ?? 1,
    undo: overrides.undo ?? { kind: 'saved' as const },
    undoSummary:
      overrides.undoSummary === undefined
        ? makeAgentChangesUndoSummary({ operation: 'all' })
        : overrides.undoSummary
  }
  return overrides.status === 'partial'
    ? { status: 'partial', message: overrides.message ?? 'partial', ...common }
    : { status: 'done', ...common }
}

/** 取り消しの結果。既定は done・a.txt を書き戻した */
export function makeAgentChangesUndoResult(
  overrides: Partial<Extract<AgentChangesUndoResult, { status: 'done' }>> = {}
): AgentChangesUndoResult {
  return {
    status: 'done',
    restoredPaths: ['a.txt'],
    trashedPaths: [],
    undoSummary: null,
    ...overrides
  }
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
    applyUndoSummary: vi.fn<AgentChangesController['applyUndoSummary']>(),
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
    runningOperation: null,
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

/** useAgentChangesUndo の戻り値。既定は押せる(帯の控えは changes.view の undo で決める) */
export function makeAgentChangesUndoState(
  overrides: Partial<AgentChangesUndoState> = {}
): AgentChangesUndoState {
  return {
    undoDisabledReason: null,
    undoLastRevert: vi.fn<AgentChangesUndoState['undoLastRevert']>(async () => undefined),
    ...overrides
  }
}

/**
 * セクション「エージェントの変更」へ渡す状態(isNotRepository を除く props)。changes・revert・undo は上のファクトリで作る。
 * 既定はエージェント CLI 方式・フォルダ '/repo'・フォーカスの依頼なし
 */
export function makeAgentChangesPanelState(
  overrides: Partial<AgentChangesPanelState> = {}
): AgentChangesPanelState {
  return {
    changes: makeAgentChangesPanelChanges(),
    focusRequest: { isRequested: false, consume: vi.fn<() => void>() },
    revert: makeAgentChangesRevertState(),
    undo: makeAgentChangesUndoState(),
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
