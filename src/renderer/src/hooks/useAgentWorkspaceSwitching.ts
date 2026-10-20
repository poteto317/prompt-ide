import { useCallback, useRef, useState } from 'react'
import {
  AGENT_START_DISABLED_SWITCHING_CLI_KIND,
  AGENT_START_DISABLED_SWITCHING_MODE
} from '../lib/agentSessionMessages'

// 実行方式と使う CLI の切り替えの途中(エージェントの停止を待つ間)の状態と再入防止。useAgentWorkspace から使う。
// 2 つの切り替えを 1 つの値で持ち、片方の途中はもう片方も始めない。切り替えの手順(確認・停止・保存)は useAgentWorkspace が持つ

/** 切り替えの途中の種類。途中でなければ null */
export type AgentWorkspaceSwitching = 'mode' | 'cli-kind' | null

export interface AgentWorkspaceSwitchingState {
  /** 切り替えの途中の種類(選択肢を押せなくする描画用の値) */
  switching: AgentWorkspaceSwitching
  /** 切り替えの途中に、起動・+・前回の続きからを受け付けない理由。途中でなければ null */
  startBlockedReason: string | null
  /**
   * kind の切り替えの手順(task)を、途中の印を付けて行う。どちらかの切り替えの途中なら task を呼ばずに終わる
   * (同じ描画の中の 2 回目の呼び出しも ref で止める)。task が終わる(投げる)と印を外す
   */
  runSwitching: (kind: 'mode' | 'cli-kind', task: () => Promise<void>) => Promise<void>
}

/** 切り替えの途中に、起動・+・前回の続きからを受け付けない理由 */
export function startBlockedReasonOf(switching: AgentWorkspaceSwitching): string | null {
  switch (switching) {
    case 'mode':
      return AGENT_START_DISABLED_SWITCHING_MODE
    case 'cli-kind':
      return AGENT_START_DISABLED_SWITCHING_CLI_KIND
    case null:
      return null
  }
}

export function useAgentWorkspaceSwitching(): AgentWorkspaceSwitchingState {
  // ref は同じ描画の中の 2 回目の呼び出しを止め、state は選択肢と、起動・+ を押せなくする
  const switchingRef = useRef(false)
  const [switching, setSwitching] = useState<AgentWorkspaceSwitching>(null)
  const runSwitching = useCallback(
    async (kind: 'mode' | 'cli-kind', task: () => Promise<void>): Promise<void> => {
      if (switchingRef.current) return
      switchingRef.current = true
      setSwitching(kind)
      try {
        await task()
      } finally {
        switchingRef.current = false
        setSwitching(null)
      }
    },
    []
  )
  return { switching, startBlockedReason: startBlockedReasonOf(switching), runSwitching }
}
