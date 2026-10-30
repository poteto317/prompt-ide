import { useCallback, useState } from 'react'
import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKindSetting } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { AGENT_CLI_KIND_SAVE_ERROR_PREFIX } from '../lib/agentCliMessages'
import { useSavedSetting } from './useSavedSetting'

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

const readLoadedKind = (loaded: AgentCliKindSetting): AgentCliKind => loaded.kind

export function useAgentCliKind(): AgentCliKindState {
  const [fallback, setFallback] = useState<AgentCliKindSetting['fallback']>(null)
  const onLoaded = useCallback((loaded: AgentCliKindSetting): void => {
    setFallback(loaded.fallback)
  }, [])
  const onLoadFailed = useCallback((): void => setFallback('read-failed'), [])
  // 選び直して保存できたので、既定に戻した旨は消す
  const onSaved = useCallback((): void => setFallback(null), [])
  const { value, saveError, change } = useSavedSetting({
    load: settingsApi.getAgentCliKind,
    readValue: readLoadedKind,
    save: settingsApi.setAgentCliKind,
    defaultValue: DEFAULT_AGENT_CLI_KIND,
    saveErrorPrefix: AGENT_CLI_KIND_SAVE_ERROR_PREFIX,
    // main は投げない(壊れた値は既定に戻して理由を返す)が、IPC が失敗したら既定で続け、読めなかった旨を出す
    loadLogLabel: '[useAgentCliKind] getAgentCliKind failed:',
    saveLogLabel: '[useAgentCliKind] setAgentCliKind failed:',
    onLoaded,
    onLoadFailed,
    onSaved
  })
  return { kind: value, fallback, saveError, changeKind: change }
}
