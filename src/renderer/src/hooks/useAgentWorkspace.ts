import { useCallback, useRef, useState } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import type { ExecutionModePanelState, PromptRunPanelState } from '../types'
import { useExecutionMode } from './useExecutionMode'
import { useAgentSessions } from './useAgentSessions'
import type { AgentSessionsState } from './useAgentSessions'
import { useAgentPromptSender } from './useAgentPromptSender'
import type { AgentPromptSenderState } from './useAgentPromptSender'
import { useAgentTerminalPanel } from './useAgentTerminalPanel'
import type { AgentTerminalPanelLayout } from './useAgentTerminalPanel'
import { getAgentSessionTabs } from '../lib/xtermFactory'
import { buildPromptRunPanelState } from '../lib/promptRunState'
import {
  AGENT_START_DISABLED_SWITCHING_MODE,
  AGENT_STOP_ON_MODE_CHANGE_CONFIRM,
  EXECUTION_MODE_LOCKED_WHILE_EXECUTING
} from '../lib/agentSessionMessages'

// 実行方式とエージェント(ターミナル・セッション・送信)の組み立て。useAppState から使う。実行方式の切り替えの手順(再入防止・
// 確認・停止を待ってから保存)と、フォルダの切り替えの前のエージェントの停止の確認を持つ

// ターミナルのパネルへ渡す状態(useAgentWorkspace が組み立て、EditorPanel → AgentTerminalPanel へ渡す)
export interface AgentTerminalPanelState {
  sessions: AgentSessionsState
  layout: AgentTerminalPanelLayout
  /** 送信中のタブ(× を押せない)。送信中でなければ null */
  sendingSlotId: string | null
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
  /** プロンプトを、押した時点の選択中のタブのエージェントへ送る(usePromptRunner に渡す) */
  sendToAgent: (text: string) => ReturnType<AgentPromptSenderState['send']>
}

export function useAgentWorkspace({
  folderPath,
  isExecuting,
  onConfirm = confirm,
  beforeAgentSend
}: UseAgentWorkspaceOptions): AgentWorkspaceState {
  const executionMode = useExecutionMode()
  // タブの一覧と xterm の controller を持つ、文書ごとに 1 つの置き場(StrictMode・パネルの開閉で作り直さない)
  const [agentTabs] = useState(getAgentSessionTabs)
  const agentLayout = useAgentTerminalPanel()
  // 切り替えの途中(エージェントの停止を待つ間)は、もう一度選んでも確認・停止・保存を重ねない。ref は同じ描画の中の
  // 2 回目の呼び出しを止め、state は選択肢と、起動・+ を押せなくする
  const switchingModeRef = useRef(false)
  const [isSwitchingMode, setIsSwitchingMode] = useState(false)
  const agentSessions = useAgentSessions({
    folderPath,
    tabs: agentTabs,
    enabled: executionMode.mode === 'agent-cli',
    // 停止を待つ間に別のタブで起動すると、そのセッションは止める対象に入らず、従来の方式でパネルが隠れた後も動き続けるため
    startBlockedReason: isSwitchingMode ? AGENT_START_DISABLED_SWITCHING_MODE : null,
    onConfirm
  })
  const agentSender = useAgentPromptSender({
    onSettled: agentLayout.open,
    beforeSend: beforeAgentSend
  })
  // 送り先は押した時点の選択中のタブ。送信の途中でタブを切り替えても変えない(sender が target を控える)
  // usePromptRunner の useCallback の依存に入るため、選択中のタブと send が変わらなければ同じ参照を返す
  const { slotId: selectedSlotId, controller: selectedController } = agentSessions.selected
  const sendAgentPrompt = agentSender.send
  const sendToAgent = useCallback(
    (text: string): ReturnType<AgentPromptSenderState['send']> =>
      sendAgentPrompt(text, { slotId: selectedSlotId, controller: selectedController }),
    [sendAgentPrompt, selectedSlotId, selectedController]
  )
  const isAgentMode = executionMode.mode === 'agent-cli'
  const isAnyAgentSessionActive = agentSessions.isAnyActive
  const isAnyAgentStarting = agentSessions.isAnyStarting
  // 実行ボタンの押せる条件は選択中のタブ(送り先)の状態で決まる
  const promptRun = buildPromptRunPanelState({
    mode: executionMode.mode,
    isExecuting,
    sessionStatus: agentSessions.selected.status,
    isSessionClosing: agentSessions.selected.isClosing,
    isSending: agentSender.isSending,
    sendError: agentSender.error,
    sendNotice: agentSender.notice
  })
  // フォルダの切り替え・従来の方式への切り替えの前に、実行中のエージェントを終了してよいかを確かめる
  const confirmStopAgent = (message: string): boolean =>
    !isAnyAgentSessionActive || onConfirm(message)
  const selectExecutionMode = async (next: PromptExecutionMode): Promise<void> => {
    if (switchingModeRef.current) return
    // 従来の方式の実行中に切り替えると、出力パネルが消えてキャンセルできないまま実行が続くため切り替えない
    if (next === executionMode.mode || isAnyAgentStarting || isExecuting) return
    switchingModeRef.current = true
    setIsSwitchingMode(true)
    try {
      if (next === 'legacy' && isAnyAgentSessionActive) {
        if (!onConfirm(AGENT_STOP_ON_MODE_CHANGE_CONFIRM)) return
        // stopAll は main の停止(プロセスの終了の待ちまで)が終わってから解決し、失敗しても reject しない(失敗はそのタブに
        // 出す)。保存(=セッションを持たない方式への切り替え)はすべてのタブが止まってからにする。止められなかったタブが
        // あれば方式を変えない(パネルが隠れて、動き続けるセッションを止められなくなるため)。止めている間に起動したタブが
        // 残っていても false になり、方式を変えない
        if (!(await agentSessions.stopAll())) return
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
      isLocked: executionMode.mode === null || isAnyAgentStarting || isSwitchingMode || isExecuting,
      lockedReason: isExecuting ? EXECUTION_MODE_LOCKED_WHILE_EXECUTING : null,
      // 選択肢のクリックは完了を待たない。changeMode は失敗を false で返し、stopAll は reject しないので本来は
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
    agentTerminal: {
      sessions: agentSessions,
      layout: agentLayout,
      sendingSlotId: agentSender.sendingSlotId
    },
    sendToAgent
  }
}
