import type {
  AgentChangesBeginTrigger,
  AgentChangesListResult,
  AgentChangesScope,
  AgentChangesState,
  AgentChangesUndoResult,
  AgentRevertAllEntry,
  AgentRevertAllResult,
  AgentRevertResult
} from '@shared/types'

// エージェントの変更の IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う。
// 記録の開始の種類と範囲は省略できない(渡し忘れを既定の解釈に流さない。L-044・L-060)

export function beginAgentChanges(trigger: AgentChangesBeginTrigger): Promise<AgentChangesState> {
  return window.api.beginAgentChanges(trigger)
}

export function getAgentChangesState(): Promise<AgentChangesState> {
  return window.api.getAgentChangesState()
}

export function listAgentChanges(scope: AgentChangesScope): Promise<AgentChangesListResult> {
  return window.api.listAgentChanges(scope)
}

export function getAgentChangeDiff(path: string, scope: AgentChangesScope): Promise<string> {
  return window.api.getAgentChangeDiff(path, scope)
}

export function revertAgentChange(
  path: string,
  scope: AgentChangesScope
): Promise<AgentRevertResult> {
  return window.api.revertAgentChange(path, scope)
}

export function revertAgentChangeHunk(
  path: string,
  patch: string,
  scope: AgentChangesScope
): Promise<AgentRevertResult> {
  return window.api.revertAgentChangeHunk(path, patch, scope)
}

export function revertAllAgentChanges(
  expected: AgentRevertAllEntry[],
  scope: AgentChangesScope
): Promise<AgentRevertAllResult> {
  return window.api.revertAllAgentChanges(expected, scope)
}

/** 直前の戻す操作を取り消す。undoId は帯に出した写しの控えの ID(main が今の控えと照合する) */
export function undoAgentChangesRevert(undoId: number): Promise<AgentChangesUndoResult> {
  return window.api.undoAgentChangesRevert(undoId)
}

export function clearAgentChanges(): Promise<void> {
  return window.api.clearAgentChanges()
}
