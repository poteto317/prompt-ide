import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentInterruptResult, AgentLaunchRequest, AgentSessionExit } from '@shared/types'
import { isAgentStartCanceled } from '@shared/types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import type { AgentSessionTab, AgentSessionTabs } from '../lib/agentSessionTabs'
import * as agentTerminalApi from '../lib/agentTerminalApi'
import {
  AGENT_EXITED_SOON_NOTE,
  AGENT_START_ERROR_PREFIX,
  AGENT_STOP_ERROR_PREFIX,
  agentCloseTabConfirm,
  describeAgentStartError,
  formatAgentTabLabel
} from '../lib/agentSessionMessages'
import {
  AGENT_INTERRUPT_ERROR_NO_SESSION,
  AGENT_INTERRUPT_ERROR_PREFIX,
  AGENT_INTERRUPT_ERROR_WRITE_FAILED,
  agentInterruptError
} from '../lib/agentInterruptMessages'
import { toError } from '../lib/errorUtils'
import {
  agentAddTabDisabledReason,
  agentStartDisabledReason,
  agentTabSessionFieldsOf,
  findAgentSlotBySessionId,
  isAgentExitedSoon,
  isAnyAgentSessionActive,
  isAnyAgentSessionStarting
} from '../lib/agentSessionTabState'
import type {
  AgentSessionExitView,
  AgentSessionStatus,
  AgentTabSessionFields
} from '../lib/agentSessionTabState'

// エージェントのセッションのタブごとの状態(設計書「セッションの状態」)。タブの一覧と controller はタブの置き場
// (agentSessionTabs)が持ち、ここはタブごとの起動・停止・終了の状態を slotId をキーにして持つ

export interface AgentSessionTabView {
  slotId: string
  /** タブの番号(agentSessionTabs の AgentSessionTab.number。通知の題・読み上げに使う) */
  number: number
  /** formatAgentTabLabel(番号) */
  label: string
  status: AgentSessionStatus
  exit: AgentSessionExitView | null
  /** 起動・停止の失敗、起動の直後の終了の文言(role="alert")。次の起動で消える */
  error: string | null
  /** 起動中・実行中のセッションの claude の会話の ID(AgentTabSessionFields.claudeSessionId)。それ以外は null */
  claudeSessionId: string | null
  /** 閉じる途中(確認の後、停止を待つ間)。送信・閉じる・終了・起動を押せない */
  isClosing: boolean
  controller: AgentTerminalController
}

/** 中断(帯の 中断)の結果。送れたかだけを扱い、作業が止まったかは claude の画面の判定で分かる(L-001) */
export type AgentInterruptOutcome =
  | { kind: 'sent' }
  /** そのタブにセッションが無い(IPC を呼ばない) */
  | { kind: 'skipped' }
  /** 結果が届いた時点で、そのタブの sessionId が送った値と違う(起動し直した・終了した・閉じた)。何も出さない */
  | { kind: 'stale' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  /** invoke の拒否・同期の例外 */
  | { kind: 'error'; message: string }

export interface AgentLastExit extends AgentSessionExitView {
  sessionId: string
}

export interface AgentSessionsState {
  tabs: AgentSessionTabView[]
  selected: AgentSessionTabView
  /** 起動を押せない理由(フォルダ無し・起動を受け付けない間)。押せるなら null */
  startDisabledReason: string | null
  /** + を押せない理由(フォルダ無し・起動を受け付けない間・上限)。押せるなら null */
  addDisabledReason: string | null
  /** 起動する。launch は新しく起動するか、記録した claude のセッションを再開するか(省略できない)。ほかのタブで同じ ID が
   *  起動中・実行中の resume は何もしない(拒否の正は main) */
  start: (slotId: string, launch: AgentLaunchRequest) => Promise<void>
  /** 確認なしで止める。止め終わってから解決し、失敗したら false(エラーはそのタブに出す) */
  stop: (slotId: string) => Promise<boolean>
  /** そのタブの claude に中断(Esc を 1 回)を送る。そのタブにセッションが無ければ IPC を呼ばず skipped(何も出さない)。
   *  押した時点の sessionId を控え、結果が届いた時点で同じときだけ結果を出す(違えば stale)。送れなかったらそのタブの error に出し、
   *  送れたらそのタブの中断の失敗の文言だけを消す。拒否しない */
  interrupt: (slotId: string) => Promise<AgentInterruptOutcome>
  /** タブを作って選択し、起動する */
  addTab: () => Promise<void>
  /** 新しいタブを足して選択し、そのタブで claudeSessionId を再開する(+ と同じ検査の後。同じ ID のタブが起動中・実行中なら
   *  何もしない)。足したタブの slotId、足さなかったら null。起動の完了は待たない(失敗は足したタブのエラーとして出す) */
  resumeInNewTab: (claudeSessionId: string) => string | null
  /** 動いていれば確認して止め、止まったらタブを消す。消したら true。取りやめ・停止の失敗・最後の 1 つ・閉じる途中なら
   *  消さず false(フォーカスの移し先を呼び出し元が決めるため) */
  closeTab: (slotId: string) => Promise<boolean>
  selectTab: (slotId: string) => void
  /** セッションを持つすべてのタブを止める(実行方式の切り替え)。起動中のタブは対象にしない(呼び出し元は起動中の間は切り替えない)。
   *  すべて止まったら true。失敗したタブがあれば、最初のそのタブを選択する。止めている間に起動した(起動中を含む)タブが
   *  残っていれば false(呼び出し元は startBlockedReason で起動を止めているが、その前に押された起動の分の守り) */
  stopAll: () => Promise<boolean>
  /** starting か running のタブがある */
  isAnyActive: boolean
  /** starting のタブがある(実行方式の切り替えを止める) */
  isAnyStarting: boolean
  /** いずれかのタブの最後の終了(終了のたびに新しいオブジェクト。閉じたタブのセッションの終了も含む) */
  lastExit: AgentLastExit | null
  /** 起動の結果(started・already-running)を受け取った回数。main が「前回」を記録し直した契機で、「前回」の取り直しに使う
   *  (起動の結果より先に終了が届き、実行中のタブの ID が一度も描画されない起動でも増える) */
  startConfirmedCount: number
}

export interface UseAgentSessionsOptions {
  folderPath: string | null
  tabs: AgentSessionTabs
  /** エージェント CLI 方式のときだけ true(従来の方式ではセッションを持たない) */
  enabled: boolean
  /** 起動・+ を受け付けない理由(実行方式の切り替えの途中)。受け付けるなら null(既定) */
  startBlockedReason?: string | null
  /** 動いているタブを閉じる前の確認(既定は window.confirm。テストで差し替える) */
  onConfirm?: (message: string) => boolean
  now?: () => number
}

export function useAgentSessions({
  folderPath,
  tabs,
  enabled,
  startBlockedReason = null,
  onConfirm = confirm,
  now = Date.now
}: UseAgentSessionsOptions): AgentSessionsState {
  const snapshot = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot)
  const [states, setStates] = useState<ReadonlyMap<string, AgentTabSessionFields>>(() => new Map())
  const [lastExit, setLastExit] = useState<AgentLastExit | null>(null)
  const [startConfirmedCount, setStartConfirmedCount] = useState(0)
  // 生きているセッションの id(タブ → id)。終了の振り分けの逆引きにも使う。controller の setSession と同じ値で、購読・非同期の
  // 手順から最新の値を同期的に読むためにここに持つ(描画には使わないため state には持たない)。2 つは adoptSession でまとめて
  // 更新する(閉じたタブは forgetTab で消す)
  const sessionIdBySlotRef = useRef(new Map<string, string>())
  // 起動中・実行中のタブの claude の会話の ID(タブ → ID)。同じ ID の再開を同期で止める判定に使う(描画は states の claudeSessionId)。
  // states の claudeSessionId と同じ値を、setTabClaudeSessionId でまとめて更新する
  const claudeSessionIdBySlotRef = useRef(new Map<string, string>())
  // 起動中の依頼(起動の手順が終わると解決する)。2 回目の起動の抑止と、closeTab が起動の結果を待つのに使う
  const startingBySlotRef = useRef(new Map<string, Promise<void>>())
  // 起動の結果(started・already-running)を受け取った時刻(タブ → now())。起動の直後の終了の判定(isAgentExitedSoon)だけに使う。
  // 依頼の時刻ではないため、起動中に届いて溜めた終了は常に直後として扱われる
  const startedAtRef = useRef(new Map<string, number>())
  // 起動の結果より先に届いた終了(sessionId をキー)。起動中のタブがあるときだけ溜め、起動の結果で照らし合わせる
  const exitsWhileStartingRef = useRef(new Map<string, AgentSessionExit>())
  // 閉じる途中のタブ(確認・停止を重ねない)。確認の前から入れる(同期的に読むため ref)
  const closingRef = useRef(new Set<string>())
  // 閉じる途中のタブのうち、確認を通って停止を待っているもの(描画用。送信・閉じる・終了・起動を押せなくする)
  const [closingSlotIds, setClosingSlotIds] = useState<ReadonlySet<string>>(() => new Set())
  // アンマウントの後(起動の結果を待つ間に部品が外れた)は state を更新しない。controller はタブの置き場に残るため、そちらには渡す
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const findTab = useCallback(
    (slotId: string): AgentSessionTab | undefined =>
      tabs.getSnapshot().tabs.find((tab) => tab.slotId === slotId),
    [tabs]
  )

  // 置き場に無いタブ(forgetTab の後)の状態は作り直さない(閉じた後に届いた停止の失敗などを、消したタブの状態として残さない。
  // ローカルレビュー第 3 周の指摘 2 で追加)
  const patchTab = useCallback(
    (slotId: string, patch: Partial<AgentTabSessionFields>): void => {
      if (!mountedRef.current) return
      if (findTab(slotId) === undefined) return
      setStates((prev) =>
        new Map(prev).set(slotId, { ...agentTabSessionFieldsOf(prev, slotId), ...patch })
      )
    },
    [findTab]
  )

  // 閉じたタブの状態(sessionId・起動の時刻・タブごとの状態)を消す
  const forgetTab = useCallback((slotId: string): void => {
    sessionIdBySlotRef.current.delete(slotId)
    startedAtRef.current.delete(slotId)
    claudeSessionIdBySlotRef.current.delete(slotId)
    if (!mountedRef.current) return
    setStates((prev) => {
      const next = new Map(prev)
      next.delete(slotId)
      return next
    })
  }, [])

  // 起動中か、生きているセッションを持つ(起動を重ねない・閉じる前に確認する)
  const hasSessionOrStarting = useCallback(
    (slotId: string): boolean =>
      startingBySlotRef.current.has(slotId) || sessionIdBySlotRef.current.has(slotId),
    []
  )

  const adoptSession = useCallback(
    (slotId: string, id: string | null): void => {
      if (id === null) sessionIdBySlotRef.current.delete(slotId)
      else sessionIdBySlotRef.current.set(slotId, id)
      findTab(slotId)?.controller.setSession(id)
    },
    [findTab]
  )

  // タブの claude の会話の ID を、同期の判定用の ref と描画用の状態の両方に置く
  const setTabClaudeSessionId = useCallback(
    (slotId: string, claudeSessionId: string | null): void => {
      if (claudeSessionId === null) claudeSessionIdBySlotRef.current.delete(slotId)
      else claudeSessionIdBySlotRef.current.set(slotId, claudeSessionId)
      patchTab(slotId, { claudeSessionId })
    },
    [patchTab]
  )

  // except 以外のタブで、claudeSessionId のセッションが起動中・実行中か
  const isClaudeSessionIdActiveElsewhere = useCallback(
    (claudeSessionId: string, except: string | null): boolean => {
      for (const [slotId, id] of claudeSessionIdBySlotRef.current) {
        if (id === claudeSessionId && slotId !== except) return true
      }
      return false
    },
    []
  )

  const applyExit = useCallback(
    (slotId: string, event: AgentSessionExit): void => {
      const exitedSoon = isAgentExitedSoon(event, startedAtRef.current.get(slotId), now())
      adoptSession(slotId, null)
      setTabClaudeSessionId(slotId, null)
      patchTab(slotId, {
        exit: { exitCode: event.exitCode, reason: event.reason },
        status: 'exited',
        ...(exitedSoon ? { error: AGENT_EXITED_SOON_NOTE } : {})
      })
    },
    [adoptSession, setTabClaudeSessionId, patchTab, now]
  )

  // 起動中として記録し、起動の手順の終わりに呼ぶ後始末を返す(起動中の依頼の解決と、溜めた終了の破棄)
  const beginStarting = useCallback((slotId: string): (() => void) => {
    let finish: () => void = () => undefined
    startingBySlotRef.current.set(slotId, new Promise<void>((resolve) => (finish = resolve)))
    return () => {
      startingBySlotRef.current.delete(slotId)
      if (startingBySlotRef.current.size === 0) exitsWhileStartingRef.current = new Map()
      finish()
    }
  }, [])

  // 起動の失敗・取り消し。セッションを外し、状態を none に戻す(error が null なら文言を出さない)
  const failStart = useCallback(
    (slotId: string, error: string | null): void => {
      adoptSession(slotId, null)
      setTabClaudeSessionId(slotId, null)
      patchTab(slotId, { error, status: 'none' })
    },
    [adoptSession, setTabClaudeSessionId, patchTab]
  )

  // 部品の作り直しの後に、main のセッションに合わせる(リロードではセッションは止まるため、通常は空)。
  // 置き場に無い slotId は、上限の範囲でタブを作って合わせる
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void agentTerminalApi
      .getAgentSessions()
      .then((entries) => {
        if (cancelled) return
        for (const entry of entries) {
          const tab = tabs.ensure(entry.slotId)
          if (tab === null) continue
          // 起動中は起動の結果に任せる(取り消しで none に戻ることがある)
          if (hasSessionOrStarting(tab.slotId)) continue
          adoptSession(tab.slotId, entry.sessionId)
          setTabClaudeSessionId(tab.slotId, entry.claudeSessionId)
          patchTab(tab.slotId, { status: 'running' })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, tabs, hasSessionOrStarting, adoptSession, setTabClaudeSessionId, patchTab])

  // 終了の購読は controller ではなく hook が 1 つだけ張り、sessionId でタブへ振り分ける。effect の後始末で外す
  useEffect(
    () =>
      agentTerminalApi.onAgentExit((event) => {
        const owner = findAgentSlotBySessionId(sessionIdBySlotRef.current, event.sessionId)
        if (owner !== undefined) applyExit(owner, event)
        else if (startingBySlotRef.current.size > 0)
          exitsWhileStartingRef.current.set(event.sessionId, event)
        // 閉じたタブのセッションの終了も、変更の確認の一覧の取り直しのきっかけにする(取り直しは害が無い)
        if (mountedRef.current)
          setLastExit({
            sessionId: event.sessionId,
            exitCode: event.exitCode,
            reason: event.reason
          })
      }),
    [applyExit]
  )

  const setClosing = useCallback((slotId: string, closing: boolean): void => {
    if (!mountedRef.current) return
    setClosingSlotIds((prev) => {
      if (prev.has(slotId) === closing) return prev
      const next = new Set(prev)
      if (closing) next.add(slotId)
      else next.delete(slotId)
      return next
    })
  }, [])

  const startDisabledReason = agentStartDisabledReason(folderPath, startBlockedReason)

  const start = useCallback(
    async (slotId: string, launch: AgentLaunchRequest): Promise<void> => {
      // フォルダ無し・起動を受け付けない間(実行方式の切り替えの途中。切り替えた後に見えないセッションが残るため)
      if (folderPath === null || startDisabledReason !== null) return
      if (hasSessionOrStarting(slotId)) return
      // 閉じる途中のタブで起動すると、直後の削除で controller が捨てられ、main に持ち主のいないセッションが残る
      if (closingRef.current.has(slotId)) return
      // ほかのタブで同じ ID が起動中・実行中なら再開しない(入口のボタンは押せないが、処理の側でも同じ条件で守る。L-058)
      if (
        launch.kind === 'resume' &&
        isClaudeSessionIdActiveElsewhere(launch.claudeSessionId, slotId)
      )
        return
      const tab = findTab(slotId)
      if (tab === undefined) return
      const { controller } = tab
      // 起動の依頼より前に「起動中」を記録する(依頼の最中に届いた終了を溜めるため)
      const endStarting = beginStarting(slotId)
      patchTab(slotId, { status: 'starting', error: null, exit: null })
      // resume は依頼した ID を起動中から持つ(同じ ID の二重の起動を renderer でも押せなくする)。new は結果が届いてから
      setTabClaudeSessionId(slotId, launch.kind === 'resume' ? launch.claudeSessionId : null)
      try {
        // 呼び順は controller の約束どおり: prepareForStart → fit → 起動の依頼 → setSession
        controller.prepareForStart()
        const { cols, rows } = controller.fit()
        const result = await agentTerminalApi.startAgentSession({
          slotId,
          folderPath,
          cols,
          rows,
          launch
        })
        if (result.kind === 'error') {
          // 起動の途中の停止(フォルダ・実行方式の切り替え)は利用者の操作の結果なので、エラーとして出さない。
          // too-many-sessions(renderer の数え方とずれたとき)・unknown-session・session-in-use もこのタブのエラーとして出す
          failStart(slotId, isAgentStartCanceled(result) ? null : describeAgentStartError(result))
          return
        }
        // started・already-running(StrictMode の二重の依頼など)はどちらも、そのセッションに合わせる。already-running の ID は
        // 動いているセッションのもので、resume で依頼した ID と違えば結果の値で上書きする
        startedAtRef.current.set(slotId, now())
        if (mountedRef.current) setStartConfirmedCount((count) => count + 1)
        adoptSession(slotId, result.sessionId)
        setTabClaudeSessionId(slotId, result.claudeSessionId)
        patchTab(slotId, { status: 'running' })
        const earlyExit = exitsWhileStartingRef.current.get(result.sessionId)
        if (earlyExit !== undefined) applyExit(slotId, earlyExit)
      } catch (err) {
        failStart(slotId, `${AGENT_START_ERROR_PREFIX}${toError(err).message}`)
      } finally {
        endStarting()
      }
    },
    [
      folderPath,
      startDisabledReason,
      hasSessionOrStarting,
      isClaudeSessionIdActiveElsewhere,
      findTab,
      beginStarting,
      patchTab,
      setTabClaudeSessionId,
      failStart,
      adoptSession,
      applyExit,
      now
    ]
  )

  const stop = useCallback(
    async (slotId: string): Promise<boolean> => {
      const id = sessionIdBySlotRef.current.get(slotId)
      if (id === undefined) return true
      try {
        await agentTerminalApi.stopAgentSession(id)
        return true
      } catch (err) {
        patchTab(slotId, { error: `${AGENT_STOP_ERROR_PREFIX}${toError(err).message}` })
        return false
      }
    },
    [patchTab]
  )

  // 送れたときに、そのタブの error が中断の失敗の文言なら消す(終了の失敗などほかの文言は消さない)
  const clearInterruptError = useCallback(
    (slotId: string): void => {
      if (!mountedRef.current) return
      if (findTab(slotId) === undefined) return
      setStates((prev) => {
        const fields = agentTabSessionFieldsOf(prev, slotId)
        if (fields.error?.startsWith(AGENT_INTERRUPT_ERROR_PREFIX) !== true) return prev
        return new Map(prev).set(slotId, { ...fields, error: null })
      })
    },
    [findTab]
  )

  const interrupt = useCallback(
    async (slotId: string): Promise<AgentInterruptOutcome> => {
      const id = sessionIdBySlotRef.current.get(slotId)
      if (id === undefined) return { kind: 'skipped' }
      // 結果が届いた時点で、そのタブのセッションが送った相手のままか(古いセッションの結果を今のタブに出さない。L-037)
      const isCurrent = (): boolean => sessionIdBySlotRef.current.get(slotId) === id
      let result: AgentInterruptResult
      try {
        // 同期の例外も拒否と同じ経路で扱う(L-055)
        result = await Promise.resolve().then(() => agentTerminalApi.interruptAgentSession(id))
      } catch (err) {
        if (!isCurrent()) return { kind: 'stale' }
        const message = toError(err).message
        patchTab(slotId, { error: agentInterruptError(message) })
        return { kind: 'error', message }
      }
      if (!isCurrent()) return { kind: 'stale' }
      if (result.kind === 'sent') {
        clearInterruptError(slotId)
        return { kind: 'sent' }
      }
      patchTab(slotId, {
        error:
          result.kind === 'no-session'
            ? AGENT_INTERRUPT_ERROR_NO_SESSION
            : AGENT_INTERRUPT_ERROR_WRITE_FAILED
      })
      // ここでは no-session か write-failed(sent は上で返した)
      return result
    },
    [patchTab, clearInterruptError]
  )

  const closeTab = useCallback(
    async (slotId: string): Promise<boolean> => {
      const tab = findTab(slotId)
      if (tab === undefined || tabs.getSnapshot().tabs.length <= 1) return false
      if (closingRef.current.has(slotId)) return false
      closingRef.current.add(slotId)
      try {
        const starting = startingBySlotRef.current.get(slotId)
        if (
          hasSessionOrStarting(slotId) &&
          !onConfirm(agentCloseTabConfirm(formatAgentTabLabel(tab.number)))
        )
          return false
        setClosing(slotId, true)
        // 起動中は sessionId が決まるまで main で止められないため、起動の結果を待ってから止める(取り消しなら止めるものは無い)
        if (starting !== undefined) await starting
        if (!(await stop(slotId))) return false
        // 停止を待つ間にほかのタブが閉じられ、最後の 1 つになったら消さない。状態は残し、止めたセッションの終了を受ける
        if (!tabs.remove(slotId)) return false
        forgetTab(slotId)
        return true
      } finally {
        closingRef.current.delete(slotId)
        setClosing(slotId, false)
      }
    },
    [tabs, findTab, hasSessionOrStarting, onConfirm, setClosing, stop, forgetTab]
  )

  const addDisabledReason = agentAddTabDisabledReason(
    folderPath,
    snapshot.tabs.length,
    startBlockedReason
  )

  const addTab = useCallback(async (): Promise<void> => {
    if (addDisabledReason !== null) return
    const tab = tabs.add()
    if (tab === null) return
    await start(tab.slotId, { kind: 'new' })
  }, [addDisabledReason, tabs, start])

  const resumeInNewTab = useCallback(
    (claudeSessionId: string): string | null => {
      // + と同じ検査(フォルダ無し・起動を受け付けない間・上限)。押してから条件が変わったら何もしない
      if (addDisabledReason !== null) return null
      if (isClaudeSessionIdActiveElsewhere(claudeSessionId, null)) return null
      const tab = tabs.add()
      if (tab === null) return null
      // start は拒否しない(失敗は足したタブのエラーとして出す)
      void start(tab.slotId, { kind: 'resume', claudeSessionId })
      return tab.slotId
    },
    [addDisabledReason, isClaudeSessionIdActiveElsewhere, tabs, start]
  )

  const stopAll = useCallback(async (): Promise<boolean> => {
    const targets = new Map(sessionIdBySlotRef.current)
    const slotIds = [...targets.keys()]
    const results = await Promise.all(slotIds.map((slotId) => stop(slotId)))
    // 停止に失敗したタブのエラーは、見えるように最初に失敗したタブを選択して示す
    const failedIndex = results.findIndex((ok) => !ok)
    if (failedIndex !== -1) {
      tabs.select(slotIds[failedIndex])
      return false
    }
    // 止めている間に起動した(起動中を含む)タブが残っていれば、すべて止まったとはいえない。止めたセッションは終了の通知が
    // 届くまで ref に残るため、止める前に控えた sessionId と違うものだけを数える
    if (startingBySlotRef.current.size > 0) return false
    for (const [slotId, id] of sessionIdBySlotRef.current) {
      if (targets.get(slotId) !== id) return false
    }
    return true
  }, [stop, tabs])

  const selectTab = useCallback((slotId: string): void => tabs.select(slotId), [tabs])

  const tabViews = useMemo(
    () =>
      snapshot.tabs.map(
        (tab): AgentSessionTabView => ({
          slotId: tab.slotId,
          number: tab.number,
          label: formatAgentTabLabel(tab.number),
          ...agentTabSessionFieldsOf(states, tab.slotId),
          isClosing: closingSlotIds.has(tab.slotId),
          controller: tab.controller
        })
      ),
    [snapshot, states, closingSlotIds]
  )
  // 置き場は少なくとも 1 つのタブを持ち、選択中のタブは一覧にある
  const selected = tabViews.find((tab) => tab.slotId === snapshot.selectedSlotId) ?? tabViews[0]

  return {
    tabs: tabViews,
    selected,
    startDisabledReason,
    addDisabledReason,
    start,
    stop,
    interrupt,
    addTab,
    resumeInNewTab,
    closeTab,
    selectTab,
    stopAll,
    isAnyActive: isAnyAgentSessionActive(tabViews),
    isAnyStarting: isAnyAgentSessionStarting(tabViews),
    lastExit,
    startConfirmedCount
  }
}
