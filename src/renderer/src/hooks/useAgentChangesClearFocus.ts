import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { isAgentChangesSectionVisible } from '../lib/agentChangesAvailability'
import type { AgentChangesPanelState } from './useAgentChangesWiring'

// 従来の方式では、セクション「エージェントの変更」は記録がある間だけ出る。「確認を終える」でセクションごと消えると
// フォーカスの戻し先が無い(body に落ちる)ため、押したときに予約し、セクションが消えた描画の後でツールバーの「更新」へ移す
// (パターン 86・152。利用者が移したフォーカスは奪わない)。
// 「更新」は rootRef の中から探す(SourceControlPanel のツールバー)。予約は消えたときに 1 回だけ扱い、残さない。
// 返す値は clear を「予約してから元の clear を呼ぶ」ものに包んだ props(描画のたびに新しいオブジェクト)
export function useAgentChangesClearFocus(
  rootRef: RefObject<HTMLElement | null>,
  agentChanges: AgentChangesPanelState | undefined
): AgentChangesPanelState | undefined {
  const isAgentChangesHidden =
    agentChanges !== undefined &&
    !isAgentChangesSectionVisible(agentChanges.isAgentMode, agentChanges.changes.view.kind)
  const isClearFocusReservedRef = useRef(false)
  useEffect(() => {
    if (!isAgentChangesHidden || !isClearFocusReservedRef.current) return
    isClearFocusReservedRef.current = false
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    rootRef.current
      ?.querySelector<HTMLButtonElement>('.source-control-panel__refresh-btn:not(:disabled)')
      ?.focus()
  }, [rootRef, isAgentChangesHidden])
  if (agentChanges === undefined) return undefined
  return {
    ...agentChanges,
    changes: {
      ...agentChanges.changes,
      clear: () => {
        if (!agentChanges.isAgentMode) isClearFocusReservedRef.current = true
        return agentChanges.changes.clear()
      }
    }
  }
}
