import { useEffect, useRef, useState } from 'react'
import type { AgentCliKind } from '@shared/agentCliKinds'
import * as agentTerminalApi from '../lib/agentTerminalApi'
import type { AgentLastSessionLookup } from '../lib/agentResumeAvailability'
import { useOnChange } from './useOnChange'

// このフォルダで最後に起動が確定した、設定の種類のセッション(「前回の続きから」の相手)の取得と取り直し(設計書「前回の続きから」)。
// 照合は main(許可のフォルダの記録の先頭)。フォルダ・種類が変わったとき・取り直しの契機(起動の確定の回数)が変わったときに取り直し、
// 最新の依頼でない結果・依頼の後にフォルダ・種類が変わった結果・依頼と違う種類の結果は捨てる(L-037・L-040)

export interface UseAgentLastSessionOptions {
  folderPath: string | null
  /** 取りに行く種類(設定の種類。次に起動する CLI)。省略できない(L-060)。変わったら取り直す */
  cliKind: AgentCliKind
  /** エージェント CLI 方式のときだけ取りに行く */
  enabled: boolean
  /** 取り直しの契機(変わったら取り直す)。useAgentResume が起動の確定の回数から作る(main の記録は起動の確定でしか変わらない) */
  refreshKey: string
}

const NONE: AgentLastSessionLookup = { kind: 'none' }
const LOADING: AgentLastSessionLookup = { kind: 'loading' }

interface ResolvedLastSession {
  /** 取りに行ったフォルダ */
  folderPath: string
  /** 取りに行った種類 */
  cliKind: AgentCliKind
  lookup: AgentLastSessionLookup
}

export function useAgentLastSession({
  folderPath,
  cliKind,
  enabled,
  refreshKey
}: UseAgentLastSessionOptions): AgentLastSessionLookup {
  const [resolved, setResolved] = useState<ResolvedLastSession | null>(null)
  // 依頼の連番(最新の依頼でない結果を捨てる)
  const requestIdRef = useRef(0)
  // フォルダ・種類・方式が変わったら、前に取った結果を捨てる(ほかのフォルダ・種類から戻ったときに古い結果を出さない)
  const clearResolved = (): void => setResolved(null)
  useOnChange(folderPath, clearResolved)
  useOnChange(enabled, clearResolved)
  useOnChange(cliKind, clearResolved)

  useEffect(() => {
    if (!enabled || folderPath === null) return
    const requestId = ++requestIdRef.current
    let cancelled = false
    void agentTerminalApi
      .getLastAgentSession(folderPath, cliKind)
      .then((last): AgentLastSessionLookup => {
        if (last === null) return NONE
        // 依頼と違う種類の結果は記録なしとして扱う(起きない想定。main は依頼の種類の記録だけを返す。L-037)
        if (last.cliKind !== cliKind) {
          console.error('[useAgentLastSession] 依頼と違う種類の前回が返りました:', last.cliKind)
          return NONE
        }
        return { kind: 'found', cliKind: last.cliKind, cliSessionId: last.cliSessionId }
      })
      .catch((err: unknown): AgentLastSessionLookup => {
        // 取得の失敗は記録なしとして扱う(前回の続きから は押せない)
        console.error('[useAgentLastSession] getLastAgentSession failed:', err)
        return NONE
      })
      .then((lookup) => {
        // 依頼の後にフォルダ・種類・契機が変わった(effect の後始末)・より新しい依頼がある結果は捨てる
        if (cancelled || requestId !== requestIdRef.current) return
        setResolved({ folderPath, cliKind, lookup })
      })
    return () => {
      cancelled = true
    }
    // refreshKey は取り直しの契機としてだけ使う
  }, [enabled, folderPath, cliKind, refreshKey])

  if (!enabled || folderPath === null) return NONE
  // 同じフォルダ・種類の取り直しの間は前の結果を出し続ける(起動のたびに理由がちらつかないように)。フォルダか種類が変わったら、
  // そのフォルダと種類の結果が届くまで取得中
  return resolved !== null && resolved.folderPath === folderPath && resolved.cliKind === cliKind
    ? resolved.lookup
    : LOADING
}
