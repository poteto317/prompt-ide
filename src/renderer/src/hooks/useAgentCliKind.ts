import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKindSetting } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import {
  AGENT_CLI_KIND_SAVE_ERROR_PREFIX,
  AGENT_CLI_KIND_SAVE_ERROR_REASON
} from '../lib/agentCliMessages'

// 使うエージェント CLI の設定(設計書 2026-10-20「設定」の「画面」。useExecutionMode と同じ形)。読み込みは main が既定に戻した理由
// (fallback)も返す。useAgentWorkspace が 1 つだけ持ち、設定の画面と入口(タブの名前・再開の理由)が同じ値を読む(L-466)

export interface AgentCliKindState {
  /** 読み込みが終わるまでは null(選べない。入口は既定の claude で出す) */
  kind: AgentCliKind | null
  /** main が既定に戻した理由(設定の画面の注記)。保存に成功したら null に戻す */
  fallback: AgentCliKindSetting['fallback']
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeKind: (next: AgentCliKind) => Promise<boolean>
}

export function useAgentCliKind(): AgentCliKindState {
  const [kind, setKind] = useState<AgentCliKind | null>(null)
  const [fallback, setFallback] = useState<AgentCliKindSetting['fallback']>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const kindRef = useRef<AgentCliKind | null>(null)

  useEffect(() => {
    let cancelled = false
    // main は投げない(壊れた値は既定に戻して理由を返す)が、IPC が失敗したら既定で続け、読めなかった旨を出す
    settingsApi
      .getAgentCliKind()
      .then((loaded) => {
        if (cancelled) return
        kindRef.current = loaded.kind
        setKind(loaded.kind)
        setFallback(loaded.fallback)
      })
      .catch((err) => {
        console.error('[useAgentCliKind] getAgentCliKind failed:', err)
        if (cancelled) return
        kindRef.current = DEFAULT_AGENT_CLI_KIND
        setKind(DEFAULT_AGENT_CLI_KIND)
        setFallback('read-failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeKind = useCallback(async (next: AgentCliKind): Promise<boolean> => {
    const previous = kindRef.current
    kindRef.current = next
    setKind(next)
    setSaveError(null)
    try {
      await settingsApi.setAgentCliKind(next)
      // 選び直して保存できたので、既定に戻した旨は消す
      setFallback(null)
      return true
    } catch {
      // 例外の文言は出さない(壊れた settings.json の中身の断片を含みうる。L-017)。理由は固定の文言にする
      kindRef.current = previous
      setKind(previous)
      setSaveError(`${AGENT_CLI_KIND_SAVE_ERROR_PREFIX}${AGENT_CLI_KIND_SAVE_ERROR_REASON}`)
      return false
    }
  }, [])

  return { kind, fallback, saveError, changeKind }
}
