import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentExitReason, AgentSessionExit } from '@shared/types'
import { isAgentStartCanceled } from '@shared/types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import * as agentTerminalApi from '../lib/agentTerminalApi'
import {
  AGENT_EXITED_SOON_MS,
  AGENT_EXITED_SOON_NOTE,
  AGENT_START_DISABLED_NO_FOLDER,
  AGENT_START_ERROR_PREFIX,
  AGENT_STOP_ERROR_PREFIX,
  describeAgentStartError
} from '../lib/agentSessionMessages'
import type { AgentSessionStatus } from '../lib/agentSessionMessages'
import { toError } from '../lib/errorUtils'

export interface AgentSessionExitView {
  exitCode: number | null
  reason: AgentExitReason
}

export interface AgentSessionState {
  status: AgentSessionStatus
  sessionId: string | null
  exit: AgentSessionExitView | null
  /** 起動の失敗・起動の直後の終了の文言(role="alert")。次の起動で消える */
  error: string | null
  /** 起動を押せない理由(フォルダを開いていない)。押せるなら null */
  startDisabledReason: string | null
  start: () => Promise<void>
  /** 確認なしで止める。止め終わってから解決する */
  stop: () => Promise<void>
}

export interface UseAgentSessionOptions {
  folderPath: string | null
  controller: AgentTerminalController
  /** エージェント CLI 方式のときだけ true(従来の方式ではセッションを持たない) */
  enabled: boolean
  now?: () => number
}

export function useAgentSession({
  folderPath,
  controller,
  enabled,
  now = Date.now
}: UseAgentSessionOptions): AgentSessionState {
  const [status, setStatus] = useState<AgentSessionStatus>('none')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exit, setExit] = useState<AgentSessionExitView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const startedAtRef = useRef(0)
  const startingRef = useRef(false)
  // 起動の結果より先に届いた終了(sessionId が決まる前に終わったセッション)。起動の結果で照らし合わせる
  const exitsWhileStartingRef = useRef(new Map<string, AgentSessionExit>())
  // アンマウントの後(起動の結果を待つ間に部品が外れた)は state を更新しない。controller は文書ごとに 1 つで残るため、そちらには渡す
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const adoptSession = useCallback(
    (id: string | null): void => {
      sessionIdRef.current = id
      controller.setSession(id)
      if (mountedRef.current) setSessionId(id)
    },
    [controller]
  )

  const applyExit = useCallback(
    (event: AgentSessionExit): void => {
      const exitedSoon =
        event.reason === 'exited' &&
        event.exitCode !== 0 &&
        now() - startedAtRef.current < AGENT_EXITED_SOON_MS
      adoptSession(null)
      if (!mountedRef.current) return
      setExit({ exitCode: event.exitCode, reason: event.reason })
      setStatus('exited')
      if (exitedSoon) setError(AGENT_EXITED_SOON_NOTE)
    },
    [adoptSession, now]
  )

  // 部品の作り直しの後に、main のセッションに合わせる(リロードではセッションは止まるため、通常は null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void agentTerminalApi
      .getAgentSession()
      .then((snapshot) => {
        if (cancelled || snapshot === null) return
        // 起動中は起動の結果に任せる(取り消しで none に戻ることがある)
        if (sessionIdRef.current !== null || startingRef.current) return
        adoptSession(snapshot.sessionId)
        setStatus('running')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, adoptSession])

  // controller は IPC の購読を解除しない(文書ごとに 1 つ)。ここでは controller の終了の購読だけを張り、effect の後始末で外す
  useEffect(
    () =>
      controller.onExit((event) => {
        if (event.sessionId !== sessionIdRef.current) {
          if (startingRef.current) exitsWhileStartingRef.current.set(event.sessionId, event)
          return
        }
        applyExit(event)
      }),
    [controller, applyExit]
  )

  const start = useCallback(async (): Promise<void> => {
    if (folderPath === null || startingRef.current || sessionIdRef.current !== null) return
    startingRef.current = true
    exitsWhileStartingRef.current = new Map()
    setStatus('starting')
    setError(null)
    setExit(null)
    // 呼び順は controller の約束どおり: prepareForStart → fit → 起動の依頼 → setSession
    controller.prepareForStart()
    const { cols, rows } = controller.fit()
    try {
      const result = await agentTerminalApi.startAgentSession({ folderPath, cols, rows })
      if (result.kind === 'error') {
        controller.setSession(null)
        if (!mountedRef.current) return
        // 起動の途中の停止(フォルダ・実行方式の切り替え)は利用者の操作の結果なので、エラーとして出さない
        setError(isAgentStartCanceled(result) ? null : describeAgentStartError(result))
        setStatus('none')
        return
      }
      // started・already-running(StrictMode の二重の依頼など)はどちらも、そのセッションに合わせる
      startedAtRef.current = now()
      adoptSession(result.sessionId)
      if (mountedRef.current) setStatus('running')
      const earlyExit = exitsWhileStartingRef.current.get(result.sessionId)
      if (earlyExit !== undefined) applyExit(earlyExit)
    } catch (err) {
      controller.setSession(null)
      if (!mountedRef.current) return
      setError(`${AGENT_START_ERROR_PREFIX}${toError(err).message}`)
      setStatus('none')
    } finally {
      startingRef.current = false
      exitsWhileStartingRef.current = new Map()
    }
  }, [folderPath, controller, adoptSession, applyExit, now])

  const stop = useCallback(async (): Promise<void> => {
    const id = sessionIdRef.current
    if (id === null) return
    try {
      await agentTerminalApi.stopAgentSession(id)
    } catch (err) {
      if (mountedRef.current) setError(`${AGENT_STOP_ERROR_PREFIX}${toError(err).message}`)
    }
  }, [])

  return {
    status,
    sessionId,
    exit,
    error,
    startDisabledReason: folderPath === null ? AGENT_START_DISABLED_NO_FOLDER : null,
    start,
    stop
  }
}
