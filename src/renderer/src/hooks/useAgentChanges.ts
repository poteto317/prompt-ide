import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentChangesList, AgentChangesState } from '@shared/types'
import type { Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  AGENT_CHANGES_CLEARED_NOTICE,
  formatAgentChangesListedNotice
} from '../lib/agentChangesMessages'
import { toError } from '../lib/errorUtils'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'

// エージェントの変更の記録の状態と一覧(設計書「データフロー」「状態の持ち主」)。記録の真実の源は main の registry で、
// ここは写し(表示と押せる条件に使う。戻す操作は main が実行時に照合する)。一覧は要求の番号で古い結果を捨てる(useGitStatus と
// 同じ作り)。実行中にアプリで保存したパスの真実の源はここ(記録ごとに持ち、記録が変われば捨てる)

/** 読み上げの通知を消すまでの時間 */
export const AGENT_CHANGES_NOTICE_DURATION_MS = 5_000

export type AgentChangesView =
  | { kind: 'none' }
  | { kind: 'unavailable'; state: Extract<AgentChangesState, { kind: 'unavailable' }> }
  /** list は取り直す前は null */
  | { kind: 'recording'; startedAt: number; list: AgentChangesList | null }

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
  /** 記録を始める(記録があれば main は何もしない)。失敗しても reject しない */
  begin: () => Promise<void>
  /** 記録があれば一覧を取り直す。announce なら結果の件数を読み上げる */
  refresh: (options?: { announce?: boolean }) => Promise<void>
  /** 確認を終える(記録を捨てる) */
  clear: () => Promise<void>
  /** アプリで保存した(useFileSystem の onSaveSucceeded から呼ぶ)。記録中だけ覚える */
  markSaved: (absolutePath: string) => void
  /** 戻す操作の結果などをセクションの通知に出す */
  announce: (text: string) => void
}

export function useAgentChanges(folderPath: string | null): AgentChangesController {
  const [view, setView] = useState<AgentChangesView>({ kind: 'none' })
  const [isLoading, setIsLoading] = useState(false)
  const [isBeginning, setIsBeginning] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [savedPaths, setSavedPaths] = useState<ReadonlySet<string>>(new Set())
  const { notice, announce } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  const viewRef = useRef(view)
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

  const applyView = useCallback((next: AgentChangesView): void => {
    const previous = viewRef.current
    viewRef.current = next
    setView(next)
    // 記録が変わったら(無くなった・別の記録になった)、実行中に保存したパスを捨てる
    const sameRecording =
      previous.kind === 'recording' &&
      next.kind === 'recording' &&
      previous.startedAt === next.startedAt
    if (!sameRecording) setSavedPaths(new Set())
  }, [])

  const applyState = useCallback(
    (state: AgentChangesState): void => {
      if (state.kind === 'recording') {
        const previous = viewRef.current
        const list =
          previous.kind === 'recording' && previous.startedAt === state.startedAt
            ? previous.list
            : null
        applyView({ kind: 'recording', startedAt: state.startedAt, list })
      } else if (state.kind === 'unavailable') {
        applyView({ kind: 'unavailable', state })
      } else {
        applyView({ kind: 'none' })
      }
    },
    [applyView]
  )

  // 写しを捨てる前に、送ってある依頼(begin・状態・一覧)の結果と読み上げの依頼をすべて捨てる。フォルダの切り替えと
  // 確認の終了の 2 か所で同じ規則にする(世代・要求の番号を片方だけ進めると、古い結果が混ざる)。isBeginning は
  // begin の数で下ろすため、ここでは触らない(送った begin は結果を捨てても終わるまで数える)
  const invalidateInFlight = useCallback((): void => {
    generationRef.current++
    requestIdRef.current++
    announcePendingRef.current = false
    setIsLoading(false)
  }, [])

  // フォルダが変わったら記録の写しを捨てる(main もフォルダの切り替えで記録を捨てる)
  useOnChange(folderPath, () => {
    folderPathRef.current = folderPath
    invalidateInFlight()
    setListError(null)
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

  const begin = useCallback(async (): Promise<void> => {
    if (folderPathRef.current === null) return
    const generation = generationRef.current
    beginCountRef.current++
    setIsBeginning(true)
    try {
      const state = await agentChangesApi.beginAgentChanges()
      // 送った後にフォルダが変わった(戻ってきた場合も含む)・確認を終えたら、前の世代の結果は捨てる
      if (generationRef.current !== generation) return
      applyState(state)
    } catch {
      if (generationRef.current === generation) {
        applyView({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } })
      }
    } finally {
      beginCountRef.current--
      if (beginCountRef.current === 0) setIsBeginning(false)
    }
  }, [applyState, applyView])

  const refresh = useCallback(
    async (options: { announce?: boolean } = {}): Promise<void> => {
      if (viewRef.current.kind !== 'recording') return
      if (options.announce === true) announcePendingRef.current = true
      const requestId = ++requestIdRef.current
      setIsLoading(true)
      try {
        const result = await agentChangesApi.listAgentChanges()
        if (requestId !== requestIdRef.current) return
        setListError(null)
        if (result.kind === 'none') {
          // main が記録を捨てていた(フォルダの切り替えの直後など)
          announcePendingRef.current = false
          applyView({ kind: 'none' })
          return
        }
        const { startedAt, entries, totalCount, truncated, headChanged } = result
        applyView({
          kind: 'recording',
          startedAt,
          list: { entries, totalCount, truncated, headChanged }
        })
        if (announcePendingRef.current) {
          announcePendingRef.current = false
          announce(formatAgentChangesListedNotice(totalCount))
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        announcePendingRef.current = false
        setListError(toError(err).message)
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false)
      }
    },
    [applyView, announce]
  )

  const clear = useCallback(async (): Promise<void> => {
    // main の応答を待つ前に捨てる(応答待ちに届いた前の依頼の結果で写しを戻さない。応答待ちに新しく送った依頼は捨てない)
    invalidateInFlight()
    try {
      await agentChangesApi.clearAgentChanges()
    } catch {
      // main で消せなくても写しは捨てる(次の取り直しで main の状態に合わせる)
    }
    setListError(null)
    applyView({ kind: 'none' })
    announce(AGENT_CHANGES_CLEARED_NOTICE)
  }, [invalidateInFlight, applyView, announce])

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
    begin,
    refresh,
    clear,
    markSaved,
    announce
  }
}
