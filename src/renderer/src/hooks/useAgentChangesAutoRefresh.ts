import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentNotificationTab } from '../lib/agentNotificationEvents'
import { advanceAgentNotifications } from '../lib/agentNotificationEvents'
import type { AgentChangesRefreshOptions } from './useAgentChanges'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

// エージェントの変更の一覧の自動の取り直し(設計書「自動の取り直し」)。契機は、活動の出来事(完了・許可待ち・確認待ち。通知と同じ
// advanceAgentNotifications の events で、通知の設定・方式に依らない。閉じる途中のタブは出来事にならない)と、ウィンドウの focus・
// visibilitychange(visible のときだけ)。表示用の派生値の並びは契機にしない(L-417)。最後の契機から AUTO_REFRESH_WAIT_MS 待って
// 1 回にまとめ、最初の未処理の契機から AUTO_REFRESH_MAX_WAIT_MS を上限に必ず走らせる(L-399)。記録が無い間は契機を捨てる。
// 取り直すのはエージェントの変更の一覧だけで(git status は取り直さない。ソース管理の既存の手動テストの前提を変えない)、件数は読み上げない
// (完了・許可待ちは通知が読み上げる)。静かに取る(取得中も isLoading を立てず戻すボタンを押せなくしない。一覧の中身が同じなら写しを置き換えない。
// アクティブな agent の diff タブは、wiring が前の内容を出したまま静かに取り直す)。既存の契機(変更を確認・更新・git status・セッションの終了)はこの hook を通さない

/** 最後の契機からの待ち */
export const AUTO_REFRESH_WAIT_MS = 300
/** 最初の未処理の契機からの上限 */
export const AUTO_REFRESH_MAX_WAIT_MS = 1_000

export interface AgentChangesAutoRefreshOptions {
  /** 記録中か(view.kind === 'recording')。記録中でない間は契機を捨て、タイマーを張らない */
  isRecording: boolean
  /** 開いているフォルダ(変わったら予約を取り消す) */
  folderPath: string | null
  /** 一覧の取り直し(useAgentChanges.refresh。選んでいる範囲で取る) */
  refresh: (options?: AgentChangesRefreshOptions) => Promise<void>
  /** エージェントのタブ(通知と同じ形) */
  tabs: readonly AgentNotificationTab[]
  /** タブごとの活動(useAgentActivity) */
  activities: ReadonlyMap<string, AgentActivity>
}

// 合流の控え(待ちと上限のタイマー・実行中・もう 1 回の印・世代)。寿命は hook と同じ(useAgentActivity の TabWatch と同じ作り)
interface AutoRefreshState {
  waitTimer: ReturnType<typeof setTimeout> | null
  maxTimer: ReturnType<typeof setTimeout> | null
  running: boolean
  rerun: boolean
  /** 記録の終わり・フォルダの切り替え・アンマウントで進め、古い取り直しの完了を区別する */
  generation: number
}

// タイマーの中から呼ぶため、呼んだ時点の最新を読む
interface AutoRefreshDeps {
  isRecording: boolean
  refresh: () => Promise<void>
}

const cancelTimers = (state: AutoRefreshState): void => {
  if (state.waitTimer !== null) clearTimeout(state.waitTimer)
  if (state.maxTimer !== null) clearTimeout(state.maxTimer)
  state.waitTimer = null
  state.maxTimer = null
}

// 取り直す(待ちと上限のどちらで呼ばれても両方を取り消す)。実行中なら「もう 1 回」の印だけ立て、終わった後に 1 回だけ走らせ直す
function runAutoRefresh(state: AutoRefreshState, deps: RefObject<AutoRefreshDeps>): void {
  cancelTimers(state)
  if (!deps.current.isRecording) return
  if (state.running) {
    state.rerun = true
    return
  }
  state.running = true
  const generation = state.generation
  void deps.current
    .refresh()
    .catch(() => undefined)
    .finally(() => {
      if (state.generation !== generation) return
      state.running = false
      if (!state.rerun) return
      state.rerun = false
      runAutoRefresh(state, deps)
    })
}

// 予約する。待ちは契機のたびに張り直し、上限は最初の未処理の契機で張る
function scheduleAutoRefresh(state: AutoRefreshState, deps: RefObject<AutoRefreshDeps>): void {
  if (!deps.current.isRecording) return
  if (state.waitTimer !== null) clearTimeout(state.waitTimer)
  state.waitTimer = setTimeout(() => runAutoRefresh(state, deps), AUTO_REFRESH_WAIT_MS)
  if (state.maxTimer === null) {
    state.maxTimer = setTimeout(() => runAutoRefresh(state, deps), AUTO_REFRESH_MAX_WAIT_MS)
  }
}

// 予約を取り消し、実行中の取り直しの完了を古いものとして扱う
function resetAutoRefresh(state: AutoRefreshState): void {
  state.generation += 1
  cancelTimers(state)
  state.running = false
  state.rerun = false
}

export function useAgentChangesAutoRefresh({
  isRecording,
  folderPath,
  refresh,
  tabs,
  activities
}: AgentChangesAutoRefreshOptions): void {
  const stateRef = useRef<AutoRefreshState>({
    waitTimer: null,
    maxTimer: null,
    running: false,
    rerun: false,
    generation: 0
  })
  const depsRef = useLatestRef<AutoRefreshDeps>({
    isRecording,
    // 静かに取る(isLoading を立てない・一覧が同じなら写しを置き換えない。設計書「自動の取り直し」)
    refresh: () => refresh({ announce: false, quiet: true })
  })
  // タブごとの最後の確かな活動(通知の useAgentNotifications と同じ純粋な関数で出来事を決める。こちらは自分の控えを持つ)
  const settledRef = useRef<ReadonlyMap<string, AgentActivity>>(new Map())

  // 活動の出来事。活動の Map は内容が同じなら同じ参照のままなので、タブの一覧の変化でも見直す(useAgentNotifications と同じ)
  useEffect(() => {
    const { settled, events } = advanceAgentNotifications(settledRef.current, tabs, activities)
    settledRef.current = settled
    if (events.length > 0) scheduleAutoRefresh(stateRef.current, depsRef)
  }, [tabs, activities, depsRef])

  // ウィンドウのフォーカスの復帰(useExternalFileChanges と同じ購読の形)。アンマウントで予約も取り消す
  useEffect(() => {
    const state = stateRef.current
    const onFocus = (): void => scheduleAutoRefresh(state, depsRef)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') scheduleAutoRefresh(state, depsRef)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resetAutoRefresh(state)
    }
  }, [depsRef])

  // 記録中でなくなった・フォルダが変わったら、予約を取り消す(記録中に戻ったときに古い予約で走らない)
  useOnChange(isRecording, () => {
    if (!isRecording) resetAutoRefresh(stateRef.current)
  })
  useOnChange(folderPath, () => resetAutoRefresh(stateRef.current))
}
