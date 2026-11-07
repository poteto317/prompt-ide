import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '@shared/agentPasteText'
import { isAgentActivityWaitingForUser } from './agentActivity'
import { realClock } from './agentPromptSend'
import type {
  AgentSendClock,
  AgentSendFailure,
  AgentSendOutcome,
  AgentSendScreenFailure,
  AgentSendTarget
} from './agentPromptSend'
import { findInputBox, isInputBoxEmpty, isPasteEchoed } from './agentInputBox'
import { classifyClaudeScreen } from './claudeScreenActivity'

// プロンプトを起動中の claude の入力欄へ送る手順(設計書「プロンプトの送信」3〜13)。正規化 → 入力欄の特定 →
// 消去を最低 1 回 → 空の確認 → 貼り付け → 現れたかの確認 → Enter。入力欄が空と判定されても消去を省かない
// (isInputBoxEmpty は画面の属性だけでは書きかけを区別できない場合がある。空の入力欄に送っても害は無い)。
// 各段で確かめられなければ、その時点で止めてそれ以上送らない(Enter は送らない)。最初と、消去・貼り付け・Enter を書く直前の
// 読み取りでは、画面の末尾の活動も確かめ、許可待ち・確認待ちなら screen-* で止める(設計書 2026-11-07)。
// React に依らない関数にし、待ち時間は注入する(テストでは仮想の時計で進める)。段階 2b で agentPromptSend.ts から中身を変えずに移し、
// sendAgentPrompt を sendClaudePrompt に改名した(送信の手順の表 agentPromptSendSpecs.ts の claude。copilot は copilotPromptSend.ts)

/** 消去の書き込みの間隔(1 回 24 バイト。間を空けずに続けると一部しか効かない。確認の結果 18) */
export const AGENT_CLEAR_INTERVAL_MS = 30
/** 入力欄を空にするまでの上限(300 行の入力で 1.6〜2.1 秒。確認の結果 20) */
export const AGENT_CLEAR_TIMEOUT_MS = 3_000
/** 空の確認の間隔(描き直しの途中の画面で判定しないため、2 回続けて空を確かめる) */
export const AGENT_EMPTY_CONFIRM_INTERVAL_MS = 50
/** 貼り付けた本文が現れたかを確かめる間隔と上限(実測 13〜24ms。確認の結果 8) */
export const AGENT_ECHO_POLL_MS = 16
export const AGENT_ECHO_TIMEOUT_MS = 1_000

/**
 * 画面の末尾(readScreen。活動の判定〈useAgentActivity〉と同じ読み方・同じ判定)が利用者の操作を待っている活動(許可待ち・確認待ち)なら
 * screen-*。表示中の行(readViewport)は利用者のスクロールで末尾とずれ、前の描画の入力欄を読みうるので、こちらは末尾を読む(設計書 2026-11-07)
 */
function blockedByScreen(target: AgentSendTarget): AgentSendScreenFailure | null {
  const activity = classifyClaudeScreen(target.readScreen())
  return isAgentActivityWaitingForUser(activity) ? `screen-${activity}` : null
}

/**
 * 入力欄を空にする(5〜8)。入力欄を特定してから、空と判定されても消去を 1 回送り、その後は空が 2 回続くまで
 * (空でなければ消去を送り直す)確かめる。見つからなくなれば input-not-found、上限で clear-failed、画面の末尾が許可待ち・確認待ちになれば
 * screen-permission・screen-confirm(消去・貼り付けを書く前に止める)
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
    // 許可待ち・確認待ちの画面へ消去・貼り付けを送らない(空が 2 回続いて貼り付けへ進む直前の読み取りも、ここを通る)
    const blocked = blockedByScreen(target)
    if (blocked !== null) return { kind: 'failed', reason: blocked }
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
 * プロンプトを claude の入力欄へ送る。正規化 → 画面の末尾が許可待ち・確認待ちでないかの確認 → bracketed paste の確認 → 入力欄の特定 → 消去を最低 1 回(空と判定されても
 * 省かない) → 空を 2 回続けて確認 → 貼り付け(消去とは別の書き込み) → 本文が現れたかの確認 → Enter。
 * どこかで確かめられなければ failed を返し、Enter は送らない。消去・貼り付け・Enter の直前の読み取りでも、許可待ち・確認待ちなら
 * screen-* で止める
 */
export async function sendClaudePrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome> {
  const normalized = normalizeAgentPrompt(rawText, 'claude')
  if (normalized.kind === 'rejected') return { kind: 'failed', reason: normalized.reason }
  // 許可待ち・確認待ちの画面へは何も書かない(bracketed paste の確認より先に見る。答えてからもう一度実行する方が直し方がはっきりしている)。
  // 消去の最初の書き込みの前の確かめも兼ねる(同じ同期の区間)
  const blockedAtStart = blockedByScreen(target)
  if (blockedAtStart !== null) return { kind: 'failed', reason: blockedAtStart }
  // bracketed paste が無効のまま送ると、本文の改行がそれぞれ Enter になり途中で送信される
  if (!target.isBracketedPasteEnabled()) return { kind: 'failed', reason: 'not-accepting' }
  const cleared = await clearInput(target, clock)
  if (cleared.kind === 'failed') return cleared
  // 消去とは別の書き込みで送る(同じ本文の [Pasted text #N …] が展開されないように。確認の結果 19)
  target.write(buildAgentPasteBytes(normalized.text))
  const deadline = clock.now() + AGENT_ECHO_TIMEOUT_MS
  let consecutiveBlocked = 0
  for (;;) {
    await clock.sleep(AGENT_ECHO_POLL_MS)
    // Enter を書く前に、どの回も必ず判定する(許可待ち・確認待ちの画面で Enter を既定の選択肢への答えにしない)。
    // 止める判定の回は Enter を書かずに読み直す。貼り付けの後は claude が入力欄を描き直している途中のフレームがあり、
    // 入力欄の無い画面では字下げした `❯ ` の行や履歴に残った `Enter to confirm` の行で confirm と判定されうるため、
    // 1 回で止めると溜めた入力まで捨てる。2 回続いたら止め、間に止めない判定が入ったら数え直す(設計書 2026-11-07)
    const blocked = blockedByScreen(target)
    if (blocked !== null) {
      consecutiveBlocked += 1
      // 2 回続く前に時間切れになったら、最後の読み取りの止める判定の理由を返す。not-echoed(「本文が現れない」)より、
      // 最後に見た画面が許可・確認を待っていることの方が利用者の直し方(答えてから送り直す)に合う
      if (consecutiveBlocked >= 2 || clock.now() >= deadline)
        return { kind: 'failed', reason: blocked }
      continue
    }
    consecutiveBlocked = 0
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
