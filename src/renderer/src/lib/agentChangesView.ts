import type {
  AgentChangesListResult,
  AgentChangesRun,
  AgentChangesScope,
  AgentChangesState
} from '@shared/types'
import type { AgentChangesView } from '../types'
import { isObjectLike } from '@shared/typeGuards'
import { findAgentChangesRun } from './agentChangesScope'

// main の応答(状態・一覧)を記録の写し(AgentChangesView)へどう反映するかの規則(記録の区別の要約 attribution と記録の置き場 storage も写す)と、
// 写しの記録の見分け方(同じ記録か・始点の時刻)(設計書「記録の写しと範囲」)。useAgentChanges から外して、描画なしで検査できるようにする。
// 古い結果の破棄・読み上げ・取り直しの実行は hook が行う

type RecordingView = Extract<AgentChangesView, { kind: 'recording' }>

/**
 * 写しが startedAt の記録と同じ記録か(記録は始点の時刻で見分ける)。状態の反映(一覧を残すか)と、
 * 写しの差し替え(実行中に保存したパスを残すか)が同じ規則で判定する
 */
export function isSameAgentChangesRecording(
  view: AgentChangesView,
  startedAt: number
): view is RecordingView {
  return view.kind === 'recording' && view.startedAt === startedAt
}

/**
 * 写しの記録の始点の時刻(記録中でなければ null)。記録を見分ける値で、実行の共有の世代・ハンクの読み上げを消す契機と、
 * 戻す操作の依頼の時点の記録の控えが同じ値を読む
 */
export function recordingStartedAtOf(view: AgentChangesView): number | null {
  return view.kind === 'recording' ? view.startedAt : null
}

// 写しは IPC で届いた素のデータ(オブジェクト・配列・数・文字列・真偽・null)だけでできているため、構造で比べる
function isSamePlainData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!isObjectLike(a) || !isObjectLike(b)) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aRecord = a
  const bRecord = b
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined)
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => isSamePlainData(aRecord[key], bRecord[key]))
}

/**
 * 写しの中身(記録・実行の一覧・一覧の行の並びと状態・HEAD の帯など)が同じか。静かな取り直し(自動の取り直し)は、
 * 同じなら写しを置き換えない(参照を保ち、一覧の変化として扱わない。diff タブは useAgentChangesWiring が静かに取り直す)
 */
export function isSameAgentChangesView(a: AgentChangesView, b: AgentChangesView): boolean {
  return isSamePlainData(a, b)
}

/**
 * 選んでいた実行が main で消えていた(保持の上限〈AGENT_CHANGES_MAX_RUNS〉を超えて捨てた)。runId と、読み上げに使う消える前の写しの実行の一覧。
 * 状態の反映と一覧の反映が同じ形で返し、hook は同じ手順(範囲を累積に戻す・読み上げ・取り直し)で扱う
 */
export interface MissingAgentChangesRun {
  runId: number
  previousRuns: readonly AgentChangesRun[]
}

/** 記録中の状態の反映の計画 */
export interface RecordingStatePlan {
  view: RecordingView
  /** 新しい記録になったため、範囲を累積に戻す(runId は記録をまたいで重ならず、前の記録の実行を指したまま空の一覧を見せない) */
  resetScope: boolean
  /** 同じ記録で、選んでいた実行が消えた(消える前の写しの実行の一覧と runId)。消えていなければ null */
  missingRun: MissingAgentChangesRun | null
}

/**
 * 記録中の状態を写しへ反映する計画。同じ記録(始点の時刻が同じ)なら一覧を残し、選んでいた実行が消えていれば一覧を空にする。
 * 別の記録なら一覧を空にする
 */
export function planRecordingState(
  previous: AgentChangesView,
  state: Extract<AgentChangesState, { kind: 'recording' }>,
  selected: AgentChangesScope
): RecordingStatePlan {
  const sameRecording = isSameAgentChangesRecording(previous, state.startedAt) ? previous : null
  const missingRun =
    sameRecording !== null &&
    selected.kind === 'run' &&
    findAgentChangesRun(state.runs, selected.runId) === undefined
      ? { runId: selected.runId, previousRuns: sameRecording.runs }
      : null
  return {
    view: {
      kind: 'recording',
      startedAt: state.startedAt,
      runs: state.runs,
      list: sameRecording !== null && missingRun === null ? sameRecording.list : null,
      undo: state.undo,
      attribution: state.attribution,
      storage: state.storage
    },
    resetScope: sameRecording === null && selected.kind !== 'all',
    missingRun
  }
}

/** 一覧の結果の反映の計画 */
export type ListResultPlan =
  /** main が記録を捨てていた(フォルダの切り替えの直後など) */
  | { kind: 'none' }
  /** 選んでいた実行が main で消えていた。範囲を累積に戻して取り直す */
  | { kind: 'run-missing'; view: RecordingView; missingRun: MissingAgentChangesRun }
  /** 範囲の一覧を出せない(写しが古い) */
  | { kind: 'scope-unavailable'; view: RecordingView }
  /** 範囲の一覧を取れた。totalCount は読み上げに使う */
  | { kind: 'listed'; view: RecordingView; totalCount: number }

/**
 * 一覧の結果を写しへ反映する計画(結果が今の依頼・範囲のものかの照合は hook が先に行う)。previous は反映する前の写しで、
 * 実行が消えていたときの読み上げの番号を引く
 */
export function planListResult(
  result: AgentChangesListResult,
  previous: AgentChangesView
): ListResultPlan {
  if (result.kind === 'none') return { kind: 'none' }
  if (result.kind === 'scope-unavailable') {
    const base = {
      kind: 'recording' as const,
      startedAt: result.startedAt,
      runs: result.runs,
      undo: result.undo,
      attribution: result.attribution,
      storage: result.storage
    }
    if (result.reason === 'run-missing' && result.scope.kind === 'run') {
      return {
        kind: 'run-missing',
        view: { ...base, list: null },
        missingRun: {
          runId: result.scope.runId,
          previousRuns: previous.kind === 'recording' ? previous.runs : []
        }
      }
    }
    return {
      kind: 'scope-unavailable',
      view: {
        ...base,
        list: { kind: 'scope-unavailable', scope: result.scope, reason: result.reason }
      }
    }
  }
  const {
    startedAt,
    runs,
    undo,
    attribution,
    storage,
    scope,
    entries,
    totalCount,
    truncated,
    headChanged
  } = result
  return {
    kind: 'listed',
    view: {
      kind: 'recording',
      startedAt,
      runs,
      list: { kind: 'listed', scope, entries, totalCount, truncated, headChanged },
      undo,
      attribution,
      storage
    },
    totalCount
  }
}
