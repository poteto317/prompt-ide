import type { PromptExecutionMode } from '@shared/types'
import type { AgentSendFailure } from './agentPromptSend'

// プロンプトの送信の文言(設計書「プロンプトの送信」「セッションが無いときのボタン」「エラー処理」)

export const AGENT_SEND_FAILURE_MESSAGES: Record<AgentSendFailure, string> = {
  empty: '送信する内容がありません',
  'too-long': 'プロンプトが長すぎます',
  'leading-bang':
    '先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）',
  'not-accepting': 'エージェントが入力を受け付けていません',
  'input-not-found':
    'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください',
  'clear-failed':
    'エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください',
  'not-echoed':
    'エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
}

/** 送信の途中で例外が起きたとき(pty への書き込みの失敗など)の文言の接頭辞。後ろに理由を付ける */
export const AGENT_SEND_ERROR_PREFIX = 'エージェントへ送信できませんでした: '

export const AGENT_SENT_NOTICE = 'エージェントに送信しました'

/** 実行ボタンの aria-label。可視の文言「実行」で始める(パターン 76) */
export const PROMPT_RUN_ARIA_LABEL_AGENT = '実行（エージェントに送信）'
export const PROMPT_RUN_ARIA_LABEL_LEGACY = 'プロンプトを実行'
/**
 * 書きかけがあると判定できたとき(clearedDraft)の通知。clearedDraft は画面の属性からの判定で、書きかけを
 * 見逃す(空と判定される形の書きかけ)・空のシェルのモードを書きかけとみなす場合がある(設計書の既知の制約)。
 * そのため、送信したことを先に伝え、書きかけについては参考として断定しない言い方で添える
 */
export const AGENT_SENT_AFTER_CLEAR_NOTICE =
  'エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）'

export const RUN_DISABLED_LOADING_MODE = '設定を読み込んでいます'
export const RUN_DISABLED_NO_SESSION =
  'エージェントが起動していません（ターミナルの「起動」を押してください）'
export const RUN_DISABLED_SENDING = 'エージェントへ送信しています'
export const RUN_DISABLED_CLOSING = 'このタブを閉じています（エージェントを終了しています）'
export const RERUN_DISABLED_AGENT_MODE =
  'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'
/** エージェント CLI 方式で記録した履歴(agent のあるエントリ)を、従来の方式で再実行しようとしたとき */
export const RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE =
  'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'

export interface PromptRunAvailability {
  disabled: boolean
  /** 押せない理由(画面に 1 か所だけ表示し、aria-describedby で参照する)。従来の方式の実行中は理由を出さない(従来どおり) */
  reason: string | null
}

/** 実行ボタンを押せるか(設計書 C13: エージェント CLI 方式は「セッションが running で、送信中でない」。複数タブでは加えて
 *  「送り先のタブが閉じる途中でない」。閉じる途中のタブへ送ると、止めたセッションに届かず捨てられるため) */
export function getPromptRunAvailability(params: {
  mode: PromptExecutionMode | null
  isExecuting: boolean
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
}): PromptRunAvailability {
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'legacy') return { disabled: params.isExecuting, reason: null }
  if (params.isSessionClosing) return { disabled: true, reason: RUN_DISABLED_CLOSING }
  if (!params.isSessionRunning) return { disabled: true, reason: RUN_DISABLED_NO_SESSION }
  if (params.isSending) return { disabled: true, reason: RUN_DISABLED_SENDING }
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
 * 従来のエントリは getRerunAvailability のまま。エージェントのエントリは、エージェント CLI 方式では一覧の 実行 と同じ条件
 * (選択中のタブへ送るため。L-048)、エージェント CLI 方式でない(従来の方式)ときは押せない
 */
export function getHistoryRerunAvailability(params: {
  isAgentEntry: boolean
  mode: PromptExecutionMode | null
  isExecuting: boolean
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
}): PromptRunAvailability {
  if (!params.isAgentEntry) {
    return getRerunAvailability({ mode: params.mode, isExecuting: params.isExecuting })
  }
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  // 方式を足したときに選択中のタブへ送れる扱いにしないよう、エージェント CLI 方式でないものはすべて止める
  if (params.mode !== 'agent-cli') {
    return { disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE }
  }
  return getPromptRunAvailability(params)
}
