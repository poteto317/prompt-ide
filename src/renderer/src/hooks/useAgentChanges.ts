import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentChangesBeginTrigger, AgentChangesScope, AgentChangesState } from '@shared/types'
import { isSameAgentChangesScope } from '@shared/types'
import type { AgentChangesView, Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  AGENT_CHANGES_CLEARED_NOTICE,
  formatAgentChangesListedNotice,
  formatAgentChangesRunMissingNotice
} from '../lib/agentChangesMessages'
import { AGENT_CHANGES_ALL_SCOPE, findAgentChangesRun } from '../lib/agentChangesScope'
import type { MissingAgentChangesRun } from '../lib/agentChangesView'
import {
  isSameAgentChangesRecording,
  isSameAgentChangesView,
  planListResult,
  planRecordingState
} from '../lib/agentChangesView'
import { toError } from '../lib/errorUtils'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'

// エージェントの変更の記録の状態と一覧(設計書「データフロー」「状態の持ち主」「記録の写しと範囲」)。記録の真実の源は main の registry で、
// ここは写し(表示と押せる条件に使う。戻す操作は main が実行時に照合する)。一覧は要求の番号と範囲で古い結果を捨てる
// (useGitStatus と同じ作り。L-037・L-040)。一覧はそれを取った範囲と組で持つ。実行中にアプリで保存したパスの真実の源はここ
// (記録ごとに持ち、記録が変われば捨てる。実行を足しても捨てない)

/** 読み上げの通知を消すまでの時間 */
export const AGENT_CHANGES_NOTICE_DURATION_MS = 5_000

/** 一覧の取り直しの選択肢 */
export interface AgentChangesRefreshOptions {
  /** 結果の件数を読み上げる */
  announce?: boolean
  /** 静かに取る(自動の取り直し。設計書「自動の取り直し」) */
  quiet?: boolean
}

export interface AgentChangesController {
  view: AgentChangesView
  /** 一覧の取得中 */
  isLoading: boolean
  /** 記録の開始の依頼中(いまから記録する・実行の前) */
  isBeginning: boolean
  /** 直前の一覧の取得の失敗(前回の一覧は残す。戻す操作は押せない) */
  listError: string | null
  /** セクションの aria-live の通知 */
  notice: Announcement | null
  /** 記録を始めた後にアプリで保存したファイル(絶対パス) */
  savedPaths: ReadonlySet<string>
  /**
   * 静かな取り直しが一覧を反映した回数(一覧が同じで写しを置き換えなかったときも進める)。useAgentChangesWiring が、
   * これが進んだら開いている agent の diff タブを静かに取り直す(同じファイルの続きの変更を出す)
   */
  quietRefreshCount: number
  /** 選んでいる範囲(既定は累積) */
  scope: AgentChangesScope
  /** 範囲を選ぶ。一覧を空にして、その範囲で取り直す */
  selectScope: (scope: AgentChangesScope) => void
  /** 記録を始める(send: 記録があれば区切りを足す、manual: 記録があれば何もしない)。失敗しても reject しない */
  begin: (trigger: AgentChangesBeginTrigger) => Promise<void>
  /**
   * 記録があれば選んでいる範囲の一覧を取り直す。announce なら結果の件数を読み上げる。quiet(自動の取り直し)なら、取得中も isLoading を
   * 立てず(戻すボタンを押せなくしない)、結果の中身が前と同じなら写しを置き換えない(参照を保つ)
   */
  refresh: (options?: AgentChangesRefreshOptions) => Promise<void>
  /** 確認を終える(記録を捨てる) */
  clear: () => Promise<void>
  /** アプリで保存した(useFileSystem の onSaveSucceeded から呼ぶ)。記録中だけ覚える */
  markSaved: (absolutePath: string) => void
  /** 戻す操作の結果などをセクションの通知に出す */
  announce: (text: string) => void
}

export function useAgentChanges(folderPath: string | null): AgentChangesController {
  const [view, setView] = useState<AgentChangesView>({ kind: 'none' })
  const [scope, setScope] = useState<AgentChangesScope>(AGENT_CHANGES_ALL_SCOPE)
  const [isLoading, setIsLoading] = useState(false)
  const [isBeginning, setIsBeginning] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [quietRefreshCount, setQuietRefreshCount] = useState(0)
  const [savedPaths, setSavedPaths] = useState<ReadonlySet<string>>(new Set())
  const { notice, announce } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  const viewRef = useRef(view)
  const scopeRef = useRef<AgentChangesScope>(AGENT_CHANGES_ALL_SCOPE)
  const folderPathRef = useRef(folderPath)
  const requestIdRef = useRef(0)
  // 記録の写しの世代。フォルダの切り替え・確認の終了で進め、送った時と違う世代の begin・状態の結果は捨てる
  // (/a → /b → /a と戻ったときに、フォルダの文字列では古い結果を見分けられない。最終レビュー B の I-1)
  const generationRef = useRef(0)
  // 実行中の begin の数(2 回続けても、両方が終わるまで isBeginning を下ろさない)
  const beginCountRef = useRef(0)
  // 取り直しの依頼で読み上げを頼まれたか。後の依頼に追い越されても、最後に反映した結果を読み上げる。
  // フォルダの切り替え・確認の終了・取得の失敗・main に記録が無かったときは捨てる(頼んだ操作の結果ではないため)
  const announcePendingRef = useRef(false)
  // まだ答えていない手動の取り直しがあるか(静かな取り直しが追い越したとき、その失敗を手動の失敗として出すため)
  const manualPendingRef = useRef(false)
  // 範囲を戻した後の取り直しで、自分(refresh)を呼ぶための参照。描画の後に最新にする
  const refreshRef = useRef<AgentChangesController['refresh']>(async () => undefined)

  const changeScope = useCallback((next: AgentChangesScope): void => {
    scopeRef.current = next
    setScope(next)
  }, [])

  // 選んでいた実行が消えた(保持の上限〈AGENT_CHANGES_MAX_RUNS〉を超えて捨てた・記録を捨てた)。範囲を累積に戻し、消える前の写しの番号で、
  // セクションの常設の aria-live に読み上げ(L-153)、累積の範囲で取り直す。状態の反映と一覧の反映の両方がこの手順を使う
  // (写しの反映〈applyView〉の後に呼ぶ)
  const recoverFromMissingRun = useCallback(
    ({ runId, previousRuns }: MissingAgentChangesRun): void => {
      changeScope(AGENT_CHANGES_ALL_SCOPE)
      const run = findAgentChangesRun(previousRuns, runId)
      if (run !== undefined) announce(formatAgentChangesRunMissingNotice(run.number))
      void refreshRef.current()
    },
    [changeScope, announce]
  )

  const applyView = useCallback((next: AgentChangesView): void => {
    const previous = viewRef.current
    viewRef.current = next
    setView(next)
    // 記録が変わったら(無くなった・別の記録になった)、実行中に保存したパスを捨てる
    const sameRecording =
      next.kind === 'recording' && isSameAgentChangesRecording(previous, next.startedAt)
    if (!sameRecording) setSavedPaths(new Set())
  }, [])

  const applyState = useCallback(
    (state: AgentChangesState): void => {
      if (state.kind === 'recording') {
        const plan = planRecordingState(viewRef.current, state, scopeRef.current)
        if (plan.resetScope) changeScope(AGENT_CHANGES_ALL_SCOPE)
        applyView(plan.view)
        if (plan.missingRun !== null) recoverFromMissingRun(plan.missingRun)
      } else if (state.kind === 'unavailable') {
        applyView({ kind: 'unavailable', state })
      } else {
        applyView({ kind: 'none' })
      }
    },
    [applyView, changeScope, recoverFromMissingRun]
  )

  // 写しを捨てる前に、送ってある依頼(begin・状態・一覧)の結果と読み上げの依頼をすべて捨てる。フォルダの切り替えと
  // 確認の終了の 2 か所で同じ規則にする(世代・要求の番号を片方だけ進めると、古い結果が混ざる)。isBeginning は
  // begin の数で下ろすため、ここでは触らない(送った begin は結果を捨てても終わるまで数える)
  const invalidateInFlight = useCallback((): void => {
    generationRef.current++
    requestIdRef.current++
    announcePendingRef.current = false
    manualPendingRef.current = false
    setIsLoading(false)
  }, [])

  // フォルダが変わったら記録の写しを捨て、範囲を累積に戻す(main もフォルダの切り替えで記録を捨てる)
  useOnChange(folderPath, () => {
    folderPathRef.current = folderPath
    invalidateInFlight()
    setListError(null)
    changeScope(AGENT_CHANGES_ALL_SCOPE)
    applyView({ kind: 'none' })
  })

  // 部品の作り直しの後に main の記録に合わせる(リロードでは main が記録を捨てるため、通常は none)
  useEffect(() => {
    if (folderPath === null) return
    let cancelled = false
    const generation = generationRef.current
    void agentChangesApi
      .getAgentChangesState()
      .then((state) => {
        if (!cancelled && generationRef.current === generation && state.kind === 'recording') {
          applyState(state)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [folderPath, applyState])

  const begin = useCallback(
    async (trigger: AgentChangesBeginTrigger): Promise<void> => {
      if (folderPathRef.current === null) return
      const generation = generationRef.current
      beginCountRef.current++
      setIsBeginning(true)
      try {
        const state = await agentChangesApi.beginAgentChanges(trigger)
        // 送った後にフォルダが変わった(戻ってきた場合も含む)・確認を終えたら、前の世代の結果は捨てる
        if (generationRef.current !== generation) return
        applyState(state)
      } catch {
        if (generationRef.current !== generation) return
        // 記録がある間の send の失敗は写しを変えない(記録はある。区切りを取れなかったことは main の runs で分かる)
        if (trigger === 'send' && viewRef.current.kind === 'recording') return
        applyView({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } })
      } finally {
        beginCountRef.current--
        if (beginCountRef.current === 0) setIsBeginning(false)
      }
    },
    [applyState, applyView]
  )

  const refresh = useCallback(
    async (options: AgentChangesRefreshOptions = {}): Promise<void> => {
      if (viewRef.current.kind !== 'recording') return
      if (options.announce === true) announcePendingRef.current = true
      const requestId = ++requestIdRef.current
      const requested = scopeRef.current
      // 静かな取り直しは isLoading を立てない(古い結果は要求の番号と範囲で捨てる。古い一覧で戻すことは main の照合が防ぐ)。
      // 手動の取り直しを追い越したときは、下の finally が isLoading を下ろす
      const quiet = options.quiet === true
      if (!quiet) {
        manualPendingRef.current = true
        setIsLoading(true)
      }
      try {
        const result = await agentChangesApi.listAgentChanges(requested)
        // 後の依頼に追い越された・範囲が変わった結果は捨てる(L-037・L-040)
        if (
          requestId !== requestIdRef.current ||
          !isSameAgentChangesScope(requested, scopeRef.current)
        ) {
          return
        }
        manualPendingRef.current = false
        setListError(null)
        const plan = planListResult(result, viewRef.current)
        if (plan.kind === 'none') {
          announcePendingRef.current = false
          applyView({ kind: 'none' })
          return
        }
        // 範囲の一覧が取れないまま続く静かな取り直しも、一覧が出ているときと同じく扱う(写しが同じなら置き換えず、diff を静かに取り直す)。
        // 置き換えると wiring が手動の diff の取り直しとみなし、開いている diff タブが毎回 読み込み中... に変わる
        if (plan.kind === 'scope-unavailable' && quiet) {
          announcePendingRef.current = false
          if (!isSameAgentChangesView(viewRef.current, plan.view)) applyView(plan.view)
          setQuietRefreshCount((count) => count + 1)
          return
        }
        if (plan.kind !== 'listed') {
          announcePendingRef.current = false
          applyView(plan.view)
          if (plan.kind === 'run-missing') recoverFromMissingRun(plan.missingRun)
          return
        }
        // 静かな取り直しで中身が同じなら、写しを置き換えない(一覧の変化として扱わない。diff タブは wiring が下の quietRefreshCount で静かに取り直す)
        if (!quiet || !isSameAgentChangesView(viewRef.current, plan.view)) applyView(plan.view)
        // 一覧が同じでも、開いている diff の中身は変わり得る(行の状態が M のまま続きを書いた)。wiring に diff の静かな取り直しを頼む
        if (quiet) setQuietRefreshCount((count) => count + 1)
        if (announcePendingRef.current) {
          announcePendingRef.current = false
          announce(formatAgentChangesListedNotice(plan.totalCount))
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        announcePendingRef.current = false
        const answersManual = !quiet || manualPendingRef.current
        manualPendingRef.current = false
        // 静かな取り直しの失敗はエラーを出さない(listError は戻すボタンを押せなくし、フォーカスを body に落とす)。
        // 前の一覧を残し、次の取り直しで回復させる。手動の取り直しを追い越したときは、押した更新の答えとしてエラーを出す
        if (!answersManual) return
        setListError(toError(err).message)
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false)
      }
    },
    [applyView, announce, recoverFromMissingRun]
  )

  useLayoutEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const selectScope = useCallback(
    (next: AgentChangesScope): void => {
      if (isSameAgentChangesScope(next, scopeRef.current)) return
      changeScope(next)
      // 前の範囲の一覧を新しい範囲の見出しの下に残さない
      const current = viewRef.current
      if (current.kind === 'recording') applyView({ ...current, list: null })
      void refreshRef.current()
    },
    [applyView, changeScope]
  )

  const clear = useCallback(async (): Promise<void> => {
    // main の応答を待つ前に捨てる(応答待ちに届いた前の依頼の結果で写しを戻さない。応答待ちに新しく送った依頼は捨てない)
    invalidateInFlight()
    changeScope(AGENT_CHANGES_ALL_SCOPE)
    try {
      await agentChangesApi.clearAgentChanges()
    } catch {
      // main で消せなくても写しは捨てる(次の取り直しで main の状態に合わせる)
    }
    setListError(null)
    applyView({ kind: 'none' })
    announce(AGENT_CHANGES_CLEARED_NOTICE)
  }, [invalidateInFlight, changeScope, applyView, announce])

  const markSaved = useCallback((absolutePath: string): void => {
    if (viewRef.current.kind !== 'recording') return
    setSavedPaths((previous) =>
      previous.has(absolutePath) ? previous : new Set([...previous, absolutePath])
    )
  }, [])

  return {
    view,
    isLoading,
    isBeginning,
    listError,
    notice,
    savedPaths,
    quietRefreshCount,
    scope,
    selectScope,
    begin,
    refresh,
    clear,
    markSaved,
    announce
  }
}
