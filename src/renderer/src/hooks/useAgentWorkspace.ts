import { useRef, useState } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import type { ExecutionModePanelState, PromptRunPanelState } from '../types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import { useExecutionMode } from './useExecutionMode'
import { useAgentSession } from './useAgentSession'
import type { AgentSessionState } from './useAgentSession'
import { useAgentPromptSender } from './useAgentPromptSender'
import type { AgentPromptSenderState } from './useAgentPromptSender'
import { useAgentTerminalPanel } from './useAgentTerminalPanel'
import type { AgentTerminalPanelLayout } from './useAgentTerminalPanel'
import { getAgentTerminalController } from '../lib/xtermFactory'
import { buildPromptRunPanelState } from '../lib/promptRunState'
import {
  AGENT_STOP_ON_MODE_CHANGE_CONFIRM,
  EXECUTION_MODE_LOCKED_WHILE_EXECUTING
} from '../lib/agentSessionMessages'

// 実行方式とエージェント(ターミナル・セッション・送信)の組み立て。useAppState から使う。実行方式の切り替えの手順(再入防止・
// 確認・停止を待ってから保存)と、フォルダの切り替えの前のエージェントの停止の確認を持つ

// ターミナルのパネルへ渡す状態(useAgentWorkspace が組み立て、EditorPanel → AgentTerminalPanel へ渡す)
export interface AgentTerminalPanelState {
  controller: AgentTerminalController
  session: AgentSessionState
  layout: AgentTerminalPanelLayout
}

export interface UseAgentWorkspaceOptions {
  /** 開いているフォルダ(エージェントの作業フォルダ) */
  folderPath: string | null
  /** 従来の方式で実行しているか */
  isExecuting: boolean
  /** 確認のダイアログ(既定は window.confirm。テストで差し替える) */
  onConfirm?: (message: string) => boolean
  /** プロンプトをエージェントへ送る前に待つ準備(useAgentChangesRecording の beginAndRefresh。エージェントの変更の記録を始め、一覧を取り直す) */
  beforeAgentSend?: () => Promise<void>
}

export interface AgentWorkspaceState {
  /** 設定パネルの実行方式の項目。mode は読み込み中は null。isLocked は読み込み中・エージェントの起動中・切り替えの途中・
   *  従来の方式の実行中。lockedReason は従来の方式の実行中だけ。onSelect は従来の方式へ切り替えるとき、実行中の
   *  エージェントがあれば確認してから止める */
  executionModePanel: ExecutionModePanelState
  /** フォルダの切り替えの前に、実行中(起動中を含む)のエージェントを終了してよいかを確かめる。無ければ確認せずに true */
  confirmStopAgent: (message: string) => boolean
  /** 実行ボタン・再実行の押せる条件と送信の結果 */
  promptRun: PromptRunPanelState
  /** エディタの領域の下部のパネル */
  bottomPanel: 'output' | 'agent-terminal' | 'none'
  agentTerminal: AgentTerminalPanelState
  /** プロンプトをエージェントへ送る(usePromptRunner に渡す) */
  sendToAgent: AgentPromptSenderState['send']
}

export function useAgentWorkspace({
  folderPath,
  isExecuting,
  onConfirm = confirm,
  beforeAgentSend
}: UseAgentWorkspaceOptions): AgentWorkspaceState {
  const executionMode = useExecutionMode()
  // xterm と IPC の購読を持つ、文書ごとに 1 つの部品(StrictMode・パネルの開閉で作り直さない)
  const [agentController] = useState(getAgentTerminalController)
  const agentLayout = useAgentTerminalPanel()
  const agentSession = useAgentSession({
    folderPath,
    controller: agentController,
    enabled: executionMode.mode === 'agent-cli'
  })
  const agentSender = useAgentPromptSender({
    controller: agentController,
    onSettled: agentLayout.open,
    beforeSend: beforeAgentSend
  })
  const isAgentMode = executionMode.mode === 'agent-cli'
  const isAgentSessionActive =
    agentSession.status === 'running' || agentSession.status === 'starting'
  const promptRun = buildPromptRunPanelState({
    mode: executionMode.mode,
    isExecuting,
    sessionStatus: agentSession.status,
    isSending: agentSender.isSending,
    sendError: agentSender.error,
    sendNotice: agentSender.notice
  })
  // フォルダの切り替え・従来の方式への切り替えの前に、実行中のエージェントを終了してよいかを確かめる
  const confirmStopAgent = (message: string): boolean => !isAgentSessionActive || onConfirm(message)
  // 切り替えの途中(エージェントの停止を待つ間)は、もう一度選んでも確認・停止・保存を重ねない。ref は同じ描画の中の
  // 2 回目の呼び出しを止め、state は選択肢を押せなくする
  const switchingModeRef = useRef(false)
  const [isSwitchingMode, setIsSwitchingMode] = useState(false)
  const selectExecutionMode = async (next: PromptExecutionMode): Promise<void> => {
    if (switchingModeRef.current) return
    // 従来の方式の実行中に切り替えると、出力パネルが消えてキャンセルできないまま実行が続くため切り替えない
    if (next === executionMode.mode || agentSession.status === 'starting' || isExecuting) return
    switchingModeRef.current = true
    setIsSwitchingMode(true)
    try {
      if (next === 'legacy' && isAgentSessionActive) {
        if (!onConfirm(AGENT_STOP_ON_MODE_CHANGE_CONFIRM)) return
        // stop は main の停止(プロセスの終了の待ちまで)が終わってから解決し、失敗しても reject しない(Task 19)。
        // 保存(=セッションを持たない方式への切り替え)は停止が終わってからにする
        await agentSession.stop()
      }
      await executionMode.changeMode(next)
    } finally {
      switchingModeRef.current = false
      setIsSwitchingMode(false)
    }
  }
  return {
    executionModePanel: {
      mode: executionMode.mode,
      saveError: executionMode.saveError,
      isLocked:
        executionMode.mode === null ||
        agentSession.status === 'starting' ||
        isSwitchingMode ||
        isExecuting,
      lockedReason: isExecuting ? EXECUTION_MODE_LOCKED_WHILE_EXECUTING : null,
      // 選択肢のクリックは完了を待たない。changeMode は失敗を false で返し、stop は reject しない(Task 19)ので本来は
      // 投げないが、投げたら記録して握る(ロックは finally で戻している)
      onSelect: (mode) => {
        selectExecutionMode(mode).catch((err: unknown) => {
          console.error('[useAgentWorkspace] selectExecutionMode failed:', err)
        })
      }
    },
    confirmStopAgent,
    promptRun,
    bottomPanel: executionMode.mode === null ? 'none' : isAgentMode ? 'agent-terminal' : 'output',
    agentTerminal: { controller: agentController, session: agentSession, layout: agentLayout },
    sendToAgent: agentSender.send
  }
}
