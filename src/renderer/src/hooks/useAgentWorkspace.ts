import { useCallback, useMemo, useRef, useState } from 'react'
import { DEFAULT_AGENT_SEND_CONFIRM_ENABLED } from '@shared/types'
import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'
import type {
  AgentNotificationPanelState,
  AgentSendConfirmDialogState,
  AgentSendConfirmPanelState,
  ExecutionModePanelState,
  HistoryEntry,
  HistoryEntryActions,
  PromptRunPanelState
} from '../types'
import type { AgentSendOptions } from '../lib/agentPromptRequest'
import { useAgentNotificationSetting } from './useAgentNotificationSetting'
import { useAgentSendConfirmSetting } from './useAgentSendConfirmSetting'
import { useAgentSendConfirm } from './useAgentSendConfirm'
import type { AgentSendSettled } from './useAgentSendConfirm'
import { usePromptRunFocus } from './usePromptRunFocus'
import { useExecutionMode } from './useExecutionMode'
import { useAgentSessions } from './useAgentSessions'
import type { AgentSessionsState } from './useAgentSessions'
import { useAgentActivity } from './useAgentActivity'
import { useAgentHooksWorkingReport } from './useAgentHooksWorkingReport'
import { useAgentStatusBar } from './useAgentStatusBar'
import { useAgentTabActivation } from './useAgentTabActivation'
import { useAgentNotifications } from './useAgentNotifications'
import type { AgentStatusBarState } from './useAgentStatusBar'
import { useAgentPromptSender } from './useAgentPromptSender'
import type { AgentPromptSenderState } from './useAgentPromptSender'
import { useAgentTerminalPanel } from './useAgentTerminalPanel'
import type { AgentTerminalPanelLayout } from './useAgentTerminalPanel'
import { useOnChange } from './useOnChange'
import { useAgentResume } from './useAgentResume'
import type { AgentResumeLastState } from './useAgentResume'
import { useLatestRef } from './useLatestRef'
import type { AgentActivity } from '../lib/agentActivity'
import { getAgentSessionTabs } from '../lib/xtermFactory'
import { buildPromptRunPanelState } from '../lib/promptRunState'
import { getHistoryRerunAvailability, getPromptRunAvailability } from '../lib/agentSendMessages'
import { notifyAgentSent } from '../lib/agentSendCallbacks'
import { describeAgentTabSession } from '../lib/agentTabSessionInfo'
import {
  AGENT_START_DISABLED_SWITCHING_MODE,
  AGENT_STOP_ON_MODE_CHANGE_CONFIRM,
  EXECUTION_MODE_LOCKED_WHILE_EXECUTING
} from '../lib/agentSessionMessages'

// 実行方式とエージェント(ターミナル・セッション・活動・ステータスバーのまとめ・送信前の確認・送信)の組み立て。useAppState から使う。
// 実行方式の切り替えの手順(再入防止・確認・停止を待ってから保存)と、フォルダの切り替えの前のエージェントの停止の確認を持つ

// ターミナルのパネルへ渡す状態(useAgentWorkspace が組み立て、EditorPanel → AgentTerminalPanel へ渡す)
export interface AgentTerminalPanelState {
  sessions: AgentSessionsState
  layout: AgentTerminalPanelLayout
  /** 送信中のタブ(× を押せない)。送信中でなければ null */
  sendingSlotId: string | null
  /** タブごとの claude の活動(画面から判定。running でないタブ・未判定は 'unknown') */
  activities: ReadonlyMap<string, AgentActivity>
  /** 「前回の続きから」の押せない理由と操作 */
  resumeLast: AgentResumeLastState
}

export interface UseAgentWorkspaceOptions {
  /** 開いているフォルダ(エージェントの作業フォルダ) */
  folderPath: string | null
  /** 従来の方式で実行しているか */
  isExecuting: boolean
  /** 確認のダイアログ(既定は window.confirm。テストで差し替える) */
  onConfirm?: (message: string) => boolean
  /** プロンプトをエージェントへ送る前に待つ準備(useAgentChangesRecording の beginForSendAndRefresh。エージェントの変更の記録を始め(記録があれば実行の区切りを足し)、一覧を取り直す) */
  beforeAgentSend?: () => Promise<void>
}

export interface AgentWorkspaceState {
  /** 設定パネルの実行方式の項目。mode は読み込み中は null。isLocked は読み込み中・エージェントの起動中・切り替えの途中・
   *  従来の方式の実行中。lockedReason は従来の方式の実行中だけ。onSelect は従来の方式へ切り替えるとき、実行中の
   *  エージェントがあれば確認してから止める */
  executionModePanel: ExecutionModePanelState
  /** 設定パネルのエージェントの通知の項目 */
  agentNotificationPanel: AgentNotificationPanelState
  /** 設定パネルの送信前の確認の項目 */
  agentSendConfirmPanel: AgentSendConfirmPanelState
  /** フォルダの切り替えの前に、実行中(起動中を含む)のエージェントを終了してよいかを確かめる。無ければ確認せずに true */
  confirmStopAgent: (message: string) => boolean
  /** 実行ボタンの押せる条件と送信の結果(履歴の再実行の押せる条件はエントリごとに getHistoryActions) */
  promptRun: PromptRunPanelState
  /** エディタの領域の下部のパネル */
  bottomPanel: 'output' | 'agent-terminal' | 'none'
  agentTerminal: AgentTerminalPanelState
  /** ステータスバーのエージェントのまとめ。エージェント CLI 方式でなければ null */
  statusBarAgent: AgentStatusBarState | null
  /** エージェントの状態の変化の読み上げの文言(App がステータスバーの隣の常設の aria-live の領域に出す) */
  agentAnnouncement: string
  /** 送信前の確認のダイアログ(App が描画する) */
  agentSendConfirmDialog: AgentSendConfirmDialogState
  /** プロンプトを送る(usePromptRunner に渡す)。送信前の確認の設定がオン(読み込み中は既定に従う)なら送らずに確認を開き、undefined で
   *  resolve する。オフなら押した時点の選択中のタブへすぐ送る。options の promptId は確認をキャンセルで閉じたとき・確認からの送信が
   *  失敗したときのフォーカスの戻り先、unsavedPaths は確認のダイアログの未保存の注意、onSent は送れた(sent)ときだけ呼ぶ知らせ */
  sendToAgent: (
    text: string,
    options: AgentSendOptions
  ) => ReturnType<AgentPromptSenderState['send']>
  /** 履歴のエントリごとの 再実行・このセッションで再開 の押せる条件と理由(Sidebar → HistoryPanel → HistoryDetail)。エントリによって
   *  押せる条件が変わるため、全体で 1 つの値にしない */
  getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
  /** 履歴の このセッションで再開。押した時点の理由を求め直し、押せるときだけ新しいタブで再開して、パネルを開き、そのタブの
   *  ターミナルへ移る(+ と同じ。L-048・L-058) */
  onResume: (entry: HistoryEntry) => void
}

export function useAgentWorkspace({
  folderPath,
  isExecuting,
  onConfirm = confirm,
  beforeAgentSend
}: UseAgentWorkspaceOptions): AgentWorkspaceState {
  const executionMode = useExecutionMode()
  const notificationSetting = useAgentNotificationSetting()
  const sendConfirmSetting = useAgentSendConfirmSetting()
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
  // タブの一覧は useAgentSessions がタブの状態の変わったときだけ作り直すため、そのまま渡す
  // (useAgentActivity はタブの配列が変わったときだけ区切りを見直す)
  const activities = useAgentActivity({ tabs: agentSessions.tabs })
  // タブの活動が作業中に変わったら、main へ知らせる(hooks が効いているかの確かめ。画面・一覧は変えない)
  useAgentHooksWorkingReport({ tabs: agentSessions.tabs, activities })
  const agentSender = useAgentPromptSender({
    onSettled: agentLayout.open,
    beforeSend: beforeAgentSend
  })
  const isAgentMode = executionMode.mode === 'agent-cli'
  // タブへ移る(パネルを開く・選ぶ・描画の後のフォーカス)。ステータスバーのまとめ・通知を押したとき・送信前の確認の送信で使う
  const activateAgentTab = useAgentTabActivation({
    selected: agentSessions.selected,
    selectTab: agentSessions.selectTab,
    openPanel: agentLayout.open
  })
  // セッションの再開(前回の続きから・このセッションで再開)。足したタブへはステータスバーと同じく activateAgentTab で移る
  const agentResume = useAgentResume({
    folderPath,
    mode: executionMode.mode,
    sessions: agentSessions,
    activateTab: activateAgentTab
  })
  // 確認からの送信が失敗したときのフォーカスの戻り先(確認を開いた時点の要素、無ければ同じプロンプトの一覧の実行)。送信中が解けた描画の後に移す
  const focusPromptRun = usePromptRunFocus({ isBlocked: agentSender.isSending })
  // 送信前の確認(設計書「流れ」)。送り先は確認を開いた時点の選択中のタブ。確認は送信を押した時点で閉じるが、フォーカスは送信が
  // 終わるまで移さない(送信の前の準備〈変更の記録。最大 10 秒〉の間は sender がキー入力を保留しないため、先にターミナルへ移すと
  // 打った文字が claude へ直接届く)。送れたらそのタブのターミナルへ、失敗したら確認を開いた時点の要素(履歴の詳細の再実行 など。
  // 一覧は隠れていることがある)へ、それが無ければ同じプロンプトの実行へ戻す。
  // ただし、フォーカスが閉じたダイアログから body へ落ちたままのときだけ移す。送信中に利用者が別の場所(エディタ・
  // クイックオープン・通知で選んだ別のタブ など)へ移していれば、送れてもタブの選択を戻さず、フォーカスも奪わない
  // (見えているモーダルの背後や別のタブへ、続けて打った文字が届かないように。パネルを開くのは sender の onSettled)
  const handleSendSettled = useCallback(
    ({ slotId, promptId, opener, outcome }: AgentSendSettled): void => {
      const active = document.activeElement
      if (active !== null && active !== document.body) return
      if (outcome?.kind === 'sent') activateAgentTab(slotId)
      else focusPromptRun(promptId, opener)
    },
    [activateAgentTab, focusPromptRun]
  )
  // 送り先の claude のセッションを控える関数(設計書「履歴への記録」)。slotId のタブの今の状態と開いているフォルダを ref から引き、
  // sender が送信の手順を始める時点(beginSending の直前)に呼ぶ(L-037)。タブの状態(useAgentSessions)は送信の手段を知らないままにする
  const describeSourceRef = useLatestRef({ tabs: agentSessions.tabs, folderPath })
  const describeSessionOf = useCallback(
    (slotId: string) => (): AgentHistoryInfo | null => {
      const { tabs, folderPath: currentFolder } = describeSourceRef.current
      return describeAgentTabSession(tabs, slotId, currentFolder)
    },
    [describeSourceRef]
  )
  // 選択中のタブを送り先にするところ(すぐ送るときの target と、確認へ渡す selected)。選択中のタブが変わらなければ同じ参照
  const {
    slotId: selectedSlotId,
    controller: selectedController,
    label: selectedLabel
  } = agentSessions.selected
  const selectedTarget = useMemo(
    () => ({
      slotId: selectedSlotId,
      controller: selectedController,
      label: selectedLabel,
      describeSession: describeSessionOf(selectedSlotId)
    }),
    [selectedSlotId, selectedController, selectedLabel, describeSessionOf]
  )
  const sendConfirm = useAgentSendConfirm({
    selected: selectedTarget,
    send: agentSender.send,
    onSendSettled: handleSendSettled
  })
  // 送り先は押した時点の選択中のタブ。送信の途中でタブを切り替えても変えない(sender が target を控える)
  // usePromptRunner の useCallback の依存に入るため、選択中のタブ・send・確認の要否が変わらなければ同じ参照を返す
  const sendAgentPrompt = agentSender.send
  const requestSendConfirm = sendConfirm.request
  const clearSendResult = agentSender.clearResult
  // 設定がオンなら、すぐには送らず確認を開く。読み込み中(null)は設定の既定に従う(既定はオン)
  const isSendConfirmRequired = sendConfirmSetting.enabled ?? DEFAULT_AGENT_SEND_CONFIRM_ENABLED
  const sendToAgent = useCallback(
    async (text: string, options: AgentSendOptions): ReturnType<AgentPromptSenderState['send']> => {
      if (isSendConfirmRequired) {
        // 送るまで send の setError(null) が呼ばれないので、前の送信の結果をここで消す(今のプロンプトの文言に見えないように)
        clearSendResult()
        requestSendConfirm(text, options)
        return undefined
      }
      const outcome = await sendAgentPrompt(text, {
        slotId: selectedTarget.slotId,
        controller: selectedTarget.controller,
        describeSession: selectedTarget.describeSession
      })
      // 確認を開かない分岐でも、送れたときだけ知らせる(確認から送ったときは useAgentSendConfirm が知らせる)
      notifyAgentSent(outcome, options.onSent)
      return outcome
    },
    [isSendConfirmRequired, clearSendResult, requestSendConfirm, sendAgentPrompt, selectedTarget]
  )
  // 確認を開いている間に、元の状態が終わったら閉じる(送らない。L-405): 従来の方式への切り替え・フォルダの切り替え・送り先の
  // タブを閉じた。送り先のセッションが終わっただけ(タブは残る)なら閉じず、下の理由で送信を押せなくする。設定をオフにしても閉じない
  const cancelSendConfirm = sendConfirm.cancel
  useOnChange(isAgentMode, () => {
    if (!isAgentMode) cancelSendConfirm()
  })
  useOnChange(folderPath, cancelSendConfirm)
  const pendingSend = sendConfirm.pending
  const pendingTab =
    pendingSend === null
      ? undefined
      : agentSessions.tabs.find((tab) => tab.slotId === pendingSend.target.slotId)
  const isPendingTabClosed = pendingSend !== null && pendingTab === undefined
  useOnChange(isPendingTabClosed, () => {
    if (isPendingTabClosed) cancelSendConfirm()
  })
  // 送り先のタブが今は送れない理由。控えた slotId のタブの今の状態と、全体で 1 つの送信中から、実行ボタンと同じ規則で求める
  const targetBlockedReason =
    pendingTab === undefined
      ? null
      : getPromptRunAvailability({
          mode: executionMode.mode,
          isExecuting,
          isSessionRunning: pendingTab.status === 'running',
          isSessionClosing: pendingTab.isClosing,
          isSending: agentSender.isSending
        }).reason
  const statusBarAgent = useAgentStatusBar({
    enabled: isAgentMode,
    tabs: agentSessions.tabs,
    selectedSlotId: agentSessions.selected.slotId,
    activities,
    openPanel: agentLayout.open,
    activateTab: activateAgentTab
  })
  // 通知を押したときのタブへの移動。送信前の確認が開いていれば、送らずに先に閉じる(利用者が別の作業へ移ったため。L-405)。
  // 確認はモーダルで背後を覆うので、開いたままターミナルへフォーカスを移すと、閉じるつもりの Esc・Enter が claude へ届く。
  // ステータスバーのまとめは、確認の背景に覆われて押せないため包まない
  const activateAgentTabFromNotification = useCallback(
    (slotId: string): void => {
      cancelSendConfirm()
      activateAgentTab(slotId)
    },
    [cancelSendConfirm, activateAgentTab]
  )
  // 完了・許可待ちの知らせ(読み上げ・OS の通知・バッジ)。通知を押したときはステータスバーと同じくタブへ移る。
  // ステータスバーと同じく、エージェント CLI 方式でなければ知らせない
  const agentAnnouncement = useAgentNotifications({
    tabs: agentSessions.tabs,
    activities,
    enabled: notificationSetting.enabled,
    isAgentMode,
    activateTab: activateAgentTabFromNotification
  })
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
  const getHistoryActions = (entry: HistoryEntry): HistoryEntryActions => {
    // 再実行の送り先は選択中のタブ(一覧の 実行 と同じ)
    const rerun = getHistoryRerunAvailability({
      recordedFolderPath: entry.agent?.folderPath ?? null,
      folderPath,
      mode: executionMode.mode,
      isExecuting,
      isSessionRunning: agentSessions.selected.status === 'running',
      isSessionClosing: agentSessions.selected.isClosing,
      isSending: agentSender.isSending
    })
    return { rerun, resume: agentResume.resumeActionOf(entry) }
  }
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
    agentNotificationPanel: {
      enabled: notificationSetting.enabled,
      saveError: notificationSetting.saveError,
      // changeEnabled は失敗を false で返し、拒否しない(失敗は saveError に出る)
      onChange: (enabled) => {
        void notificationSetting.changeEnabled(enabled)
      }
    },
    agentSendConfirmPanel: {
      enabled: sendConfirmSetting.enabled,
      saveError: sendConfirmSetting.saveError,
      // changeEnabled は失敗を false で返し、拒否しない(失敗は saveError に出る)
      onChange: (enabled) => {
        void sendConfirmSetting.changeEnabled(enabled)
      }
    },
    confirmStopAgent,
    promptRun,
    bottomPanel: executionMode.mode === null ? 'none' : isAgentMode ? 'agent-terminal' : 'output',
    agentTerminal: {
      sessions: agentSessions,
      layout: agentLayout,
      sendingSlotId: agentSender.sendingSlotId,
      activities,
      resumeLast: agentResume.resumeLast
    },
    statusBarAgent,
    agentAnnouncement,
    agentSendConfirmDialog: {
      pending:
        pendingSend === null
          ? null
          : {
              text: pendingSend.text,
              slotId: pendingSend.target.slotId,
              label: pendingSend.label,
              promptId: pendingSend.promptId,
              unsavedPaths: pendingSend.unsavedPaths
            },
      targetBlockedReason,
      onConfirm: sendConfirm.confirm,
      onCancel: sendConfirm.cancel
    },
    sendToAgent,
    getHistoryActions,
    onResume: agentResume.onResumeEntry
  }
}
