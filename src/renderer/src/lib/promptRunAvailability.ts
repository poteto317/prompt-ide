import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { PromptExecutionMode } from '@shared/types'
import type { AgentActivity } from './agentActivity'
import { AGENT_PROMPT_SEND_SPECS } from './agentPromptSendSpecs'
import {
  RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE,
  RERUN_DISABLED_AGENT_MODE,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_INTERRUPTING,
  RUN_DISABLED_LOADING_MODE,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING,
  agentPromptSendUnsupportedReason,
  agentSendBlockedByActivityReason,
  rerunDisabledAgentEntryFolderMismatch
} from './agentSendMessages'
import { isSamePath } from './pathUtils'

// 実行ボタン・履歴の再実行・送信前の確認を押せるかの判定(設計書 C13・「決定した点」5・2026-10-22「押せる条件」)。React に依らない
// 純粋関数。押せない理由の文言は agentSendMessages.ts、送り先の種類が入力待ちを求めるか(requiresIdle)は送信の手順の表
// agentPromptSendSpecs.ts から引く。段階 2b のリファクタリングで agentSendMessages.ts から中身を変えずに移した

export interface PromptRunAvailability {
  disabled: boolean
  /** 押せない理由(画面に 1 か所だけ表示し、aria-describedby で参照する)。従来の方式の実行中は理由を出さない(従来どおり) */
  reason: string | null
}

/** 実行ボタンを押せるかの判定に使う状態 */
export interface AgentRunConditions {
  mode: PromptExecutionMode | null
  isExecuting: boolean
  /** 能力の判定に使う CLI の種類。実行ボタンでは agentCapabilityCliKindOf で選ぶ(動いているタブはタブの種類〈起動の結果の種類〉、
   *  未起動・終了したタブは次に起動する設定の種類)。送信前の確認では、確認を開いた時点に控えた送り先の種類を渡す */
  cliKind: AgentCliKind
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
  /** 送り先のタブの活動(activities.get(slotId) ?? 'unknown'。中断の判定と同じ写像)。requiresIdle の種類だけが見る */
  activity: AgentActivity
  /** 送り先のタブが中断の流れの間か(useAgentInterrupt の isInterruptPending)。requiresIdle の種類だけが見る */
  isInterrupting: boolean
}

/** 実行ボタンを押せるか(設計書 C13: エージェント CLI 方式は「セッションが running で、送信中でない」。複数タブでは加えて
 *  「送り先のタブが閉じる途中でない」。閉じる途中のタブへ送ると、止めたセッションに届かず捨てられるため)。
 *  送り先の CLI が送信に対応していなければ押せない。送り先の種類の手順が requiresIdle(copilot)なら、加えて「送り先のタブが
 *  中断の流れの外」で「画面の活動が入力待ち」のときだけ押せる(設計書 2026-10-22「押せる条件」。claude は活動を見ない) */
export function getPromptRunAvailability(params: AgentRunConditions): PromptRunAvailability {
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'legacy') return { disabled: params.isExecuting, reason: null }
  const { commandName } = AGENT_CLI_PROFILES[params.cliKind]
  // 送り先の CLI が送信に対応していない。実行ボタンでは未起動・終了したタブの種類は次に起動する設定の種類なので
  // (呼び出し側が agentCapabilityCliKindOf で選ぶ)、起動しても送れない。閉じる途中・未起動より前に見る
  if (!agentCliCapabilities(params.cliKind).promptSend) {
    return { disabled: true, reason: agentPromptSendUnsupportedReason(commandName) }
  }
  if (params.isSessionClosing) return { disabled: true, reason: RUN_DISABLED_CLOSING }
  if (!params.isSessionRunning) return { disabled: true, reason: RUN_DISABLED_NO_SESSION }
  if (params.isSending) return { disabled: true, reason: RUN_DISABLED_SENDING }
  if (AGENT_PROMPT_SEND_SPECS[params.cliKind].requiresIdle) {
    // 中断の 2 回目を待つ間に貼り付けると、2 回目の Esc が貼った本文を消しうる(L-594)
    if (params.isInterrupting) return { disabled: true, reason: RUN_DISABLED_INTERRUPTING }
    // 作業中の Enter は送信待ちになり、作業が終わると勝手に送られる。許可待ち・確認待ちの画面へ貼らない
    if (params.activity !== 'idle') {
      return {
        disabled: true,
        reason: agentSendBlockedByActivityReason(params.activity, commandName)
      }
    }
  }
  return { disabled: false, reason: null }
}

/** 従来のエントリ(agent が null)の履歴の再実行を押せるか(設計書「決定した点」5。エージェントのエントリは getHistoryRerunAvailability) */
export function getRerunAvailability(params: {
  mode: PromptExecutionMode | null
  isExecuting: boolean
}): PromptRunAvailability {
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'agent-cli') return { disabled: true, reason: RERUN_DISABLED_AGENT_MODE }
  return { disabled: params.isExecuting, reason: null }
}

/**
 * 履歴のエントリごとの 再実行 を押せるか(セッションの再開の設計書「エージェントのエントリの 再実行 の押せない理由」)。
 * 従来のエントリは getRerunAvailability のまま。エージェントのエントリは、エージェント CLI 方式でない(従来の方式)ときと、
 * 記録したフォルダを開いていない(isSamePath。このセッションで再開 と同じ判定・同じ順)ときは押せず、それ以外は一覧の 実行 と
 * 同じ条件(選択中のタブへ送るため。L-048)
 */
export function getHistoryRerunAvailability(
  params: AgentRunConditions & {
    /** エージェントのエントリの記録したフォルダ(entry.agent.folderPath)。従来のエントリ(agent が null)は null */
    recordedFolderPath: string | null
    /** 今開いているフォルダ。開いていなければ null */
    folderPath: string | null
  }
): PromptRunAvailability {
  const { recordedFolderPath, folderPath } = params
  if (recordedFolderPath === null) {
    return getRerunAvailability({ mode: params.mode, isExecuting: params.isExecuting })
  }
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  // 方式を足したときに選択中のタブへ送れる扱いにしないよう、エージェント CLI 方式でないものはすべて止める
  if (params.mode !== 'agent-cli') {
    return { disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE }
  }
  if (folderPath === null || !isSamePath(folderPath, recordedFolderPath)) {
    return { disabled: true, reason: rerunDisabledAgentEntryFolderMismatch(recordedFolderPath) }
  }
  return getPromptRunAvailability(params)
}
