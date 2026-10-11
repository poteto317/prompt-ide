import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '@shared/agentPasteText'
import type { AgentPromptRejection } from '@shared/agentPasteText'
import type { AgentHistoryInfo } from '@shared/types'
import type { ViewportLine } from './agentViewport'
import { findInputBox, isInputBoxEmpty, isPasteEchoed } from './agentInputBox'

// プロンプトを起動中の claude の入力欄へ送る手順(設計書「プロンプトの送信」3〜13)。正規化 → 入力欄の特定 →
// 消去を最低 1 回 → 空の確認 → 貼り付け → 現れたかの確認 → Enter。入力欄が空と判定されても消去を省かない
// (isInputBoxEmpty は画面の属性だけでは書きかけを区別できない場合がある。空の入力欄に送っても害は無い)。
// 各段で確かめられなければ、その時点で止めてそれ以上送らない(Enter は送らない)。
// React に依らない関数にし、待ち時間は注入する(テストでは仮想の時計で進める)

/** 消去の書き込みの間隔(1 回 24 バイト。間を空けずに続けると一部しか効かない。確認の結果 18) */
export const AGENT_CLEAR_INTERVAL_MS = 30
/** 入力欄を空にするまでの上限(300 行の入力で 1.6〜2.1 秒。確認の結果 20) */
export const AGENT_CLEAR_TIMEOUT_MS = 3_000
/** 空の確認の間隔(描き直しの途中の画面で判定しないため、2 回続けて空を確かめる) */
export const AGENT_EMPTY_CONFIRM_INTERVAL_MS = 50
/** 貼り付けた本文が現れたかを確かめる間隔と上限(実測 13〜24ms。確認の結果 8) */
export const AGENT_ECHO_POLL_MS = 16
export const AGENT_ECHO_TIMEOUT_MS = 1_000

export type AgentSendFailure =
  | AgentPromptRejection
  | 'not-accepting'
  | 'input-not-found'
  | 'clear-failed'
  | 'not-echoed'

/** clearedDraft: 消去の前・途中に、入力欄が空でない(書きかけがある)と判定できたか */
export type AgentSendOutcome =
  | { kind: 'sent'; clearedDraft: boolean }
  | { kind: 'failed'; reason: AgentSendFailure }

/**
 * 送信の手順を含めた送信(useAgentPromptSender.send)の結果。送れたときは、送信の手順を始める時点に控えた送り先(履歴の
 * HistoryEntry.agent と同じ形。控えられなかったら null)を足す。純粋な sendAgentPrompt の AgentSendOutcome は変えない
 */
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & { sentTo: AgentHistoryInfo | null })
  | Extract<AgentSendOutcome, { kind: 'failed' }>

/** 送り先(agentTerminalController の一部)。write は利用者のキー入力の保留とは別に、直接 pty へ送る */
export interface AgentSendTarget {
  isBracketedPasteEnabled(): boolean
  readViewport(): ViewportLine[]
  getCols(): number
  write(data: string): void
}

export interface AgentSendClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: AgentSendClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 入力欄を空にする(5〜8)。入力欄を特定してから、空と判定されても消去を 1 回送り、その後は空が 2 回続くまで
 * (空でなければ消去を送り直す)確かめる。見つからなくなれば input-not-found、上限で clear-failed
 */
async function clearInput(
  target: AgentSendTarget,
  clock: AgentSendClock
): Promise<
  { kind: 'empty'; clearedDraft: boolean } | { kind: 'failed'; reason: AgentSendFailure }
> {
  const deadline = clock.now() + AGENT_CLEAR_TIMEOUT_MS
  const first = findInputBox(target.readViewport())
  // 確認画面(フォルダの信頼など)へキーを送らない
  if (first === null) return { kind: 'failed', reason: 'input-not-found' }
  let clearedDraft = !isInputBoxEmpty(first)
  target.write(AGENT_CLEAR_INPUT_CHUNK)
  await clock.sleep(AGENT_CLEAR_INTERVAL_MS)
  let consecutiveEmpty = 0
  for (;;) {
    const box = findInputBox(target.readViewport())
    // 途中で確認の画面が出た場合に、その画面へキーを送り続けない
    if (box === null) return { kind: 'failed', reason: 'input-not-found' }
    if (isInputBoxEmpty(box)) {
      consecutiveEmpty += 1
      if (consecutiveEmpty >= 2) return { kind: 'empty', clearedDraft }
      if (clock.now() >= deadline) return { kind: 'failed', reason: 'clear-failed' }
      await clock.sleep(AGENT_EMPTY_CONFIRM_INTERVAL_MS)
      continue
    }
    consecutiveEmpty = 0
    if (clock.now() >= deadline) return { kind: 'failed', reason: 'clear-failed' }
    target.write(AGENT_CLEAR_INPUT_CHUNK)
    clearedDraft = true
    await clock.sleep(AGENT_CLEAR_INTERVAL_MS)
  }
}

/**
 * プロンプトを claude の入力欄へ送る。正規化 → bracketed paste の確認 → 入力欄の特定 → 消去を最低 1 回(空と判定されても
 * 省かない) → 空を 2 回続けて確認 → 貼り付け(消去とは別の書き込み) → 本文が現れたかの確認 → Enter。
 * どこかで確かめられなければ failed を返し、Enter は送らない
 */
export async function sendAgentPrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome> {
  const normalized = normalizeAgentPrompt(rawText)
  if (normalized.kind === 'rejected') return { kind: 'failed', reason: normalized.reason }
  // bracketed paste が無効のまま送ると、本文の改行がそれぞれ Enter になり途中で送信される
  if (!target.isBracketedPasteEnabled()) return { kind: 'failed', reason: 'not-accepting' }
  const cleared = await clearInput(target, clock)
  if (cleared.kind === 'failed') return cleared
  // 消去とは別の書き込みで送る(同じ本文の [Pasted text #N …] が展開されないように。確認の結果 19)
  target.write(buildAgentPasteBytes(normalized.text))
  const deadline = clock.now() + AGENT_ECHO_TIMEOUT_MS
  for (;;) {
    await clock.sleep(AGENT_ECHO_POLL_MS)
    const box = findInputBox(target.readViewport())
    if (box !== null && isPasteEchoed(box, normalized.text, target.getCols())) {
      target.write(AGENT_SUBMIT_KEY)
      return { kind: 'sent', clearedDraft: cleared.clearedDraft }
    }
    // シェルのモード(!)に入った・時間切れ: Enter を送らない(確認画面の選択肢を確定させない)
    if (box?.symbol === 'shell' || clock.now() >= deadline)
      return { kind: 'failed', reason: 'not-echoed' }
  }
}
