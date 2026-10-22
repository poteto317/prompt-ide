import {
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '@shared/agentPasteText'
import { realClock } from './agentPromptSend'
import type {
  AgentSendClock,
  AgentSendFailure,
  AgentSendOutcome,
  AgentSendTarget
} from './agentPromptSend'
import { isCopilotPasteEchoed, readCopilotInputState } from './copilotInputBox'
import type { ViewportLine } from './agentViewport'
import { classifyCopilotScreen, isCopilotSubmitConfirmed } from './copilotScreenActivity'

// プロンプトを copilot の入力欄へ送る手順(設計書 2026-10-22「copilot の手順」)。claude の手順(claudePromptSend.ts)と違い、
// 入力欄を消さない(書きかけがあれば断る)・入力待ちのときだけ送る・Enter の後に送れたことを画面で確かめる。書くのは括弧付きの
// 貼り付けと \r の 2 回だけで、Esc・Ctrl+U・Ctrl+K・Ctrl+C・Backspace は書かない(L-019・L-041)。どの段でも確かめられなければ
// その場で止め、Enter の前の失敗では Enter を送らず、Enter の後の失敗でも送り直さない(L-001・L-414)。React に依らない関数にし、
// 待ち時間は注入する(テストでは仮想の時計で進める)。規則は GitHub Copilot CLI 1.0.87 の記録(copilotInputScreens.json)に合わせた。
// 1 回の読み取りの画面の判定(checkCopilotInputBeforePaste・checkCopilotPasteEcho・isCopilotSubmitConfirmed)は純粋関数にし、
// 待ちの関数(waitFor*)は読み取り・読み直しの間隔・上限だけを持つ。入力欄の形の読み方は copilotInputBox.ts に閉じる

/** 入力欄が空か書きかけかを決められない間(一時的な帯)に読み直す間隔と上限(一時的な帯の最長 約 2,000ms + 500ms。記録の 6) */
export const COPILOT_INPUT_STATE_POLL_MS = 50
export const COPILOT_INPUT_STATE_TIMEOUT_MS = 2_500
/** 貼り付けた本文が入力欄に現れたかを確かめる間隔と上限(記録の echo は 約 210〜300ms。アプリの xterm と IPC の遅れを見て約 5 倍) */
export const COPILOT_ECHO_POLL_MS = 16
export const COPILOT_ECHO_TIMEOUT_MS = 1_500
/** Enter の後に送れたことを確かめる間隔と上限(記録では 11〜91ms。最も遅い 91ms の 20 倍の余裕) */
export const COPILOT_SUBMIT_CONFIRM_POLL_MS = 16
export const COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS = 2_000

/** 末尾の空白(改行を含む)を除いた本文の最後の語が @ で始まる(copilot が補完の候補の一覧を開く形。report.md の 8) */
const TRAILING_AT_WORD = /(?:^|\s)@\S*$/

const failed = (reason: AgentSendFailure): AgentSendOutcome => ({ kind: 'failed', reason })

/**
 * 貼る本文。末尾の空白(改行を含む)を除いた最後の語が @ で始まれば、末尾の空白を除いて空白を 1 つ足す(補完の一覧を開かせず、
 * Enter を補完の確定に取られない。末尾の空白は copilot が送るときに落とすので、届く本文は変わらない。report.md の 8)
 */
export function buildCopilotPasteText(text: string): string {
  const trimmed = text.trimEnd()
  return TRAILING_AT_WORD.test(trimmed) ? `${trimmed} ` : text
}

/** 手順 3 の 1 回の読み取りの判定。empty は空(送ってよい候補)、undetermined は読み直す、blocked は送らない(理由つき) */
export type CopilotPrePasteCheck =
  | { kind: 'empty' }
  | { kind: 'undetermined' }
  | { kind: 'blocked'; reason: AgentSendFailure }

/** 手順 3 の 1 回の読み取りの判定(純粋関数)。画面の活動が入力待ちでなければ screen-*、入力欄の状態で止めるものは理由を返す */
export function checkCopilotInputBeforePaste(lines: readonly ViewportLine[]): CopilotPrePasteCheck {
  const activity = classifyCopilotScreen(lines)
  if (activity !== 'idle') return { kind: 'blocked', reason: `screen-${activity}` }
  const state = readCopilotInputState(lines)
  // 書きかけ・シェルのモードには書かない(書きかけは消さない。利用者の決定)
  if (state === 'shell') return { kind: 'blocked', reason: 'shell-mode' }
  if (state === 'draft') return { kind: 'blocked', reason: 'draft-present' }
  // idle と判定された画面には入力欄があるので起きない(型の網羅のための守り)
  if (state === 'not-found') return { kind: 'blocked', reason: 'input-not-found' }
  return { kind: state }
}

/**
 * 手順 5 の 1 回の読み取りの判定(純粋関数)。echoed は貼った本文が入力欄に現れた、shell はシェルのモード(!)に入った
 * (Enter を送らない。送ると本文がシェルのコマンドとして実行される)、pending はまだ現れていない(読み直す)
 */
export function checkCopilotPasteEcho(
  lines: readonly ViewportLine[],
  pasteText: string
): 'echoed' | 'shell' | 'pending' {
  if (isCopilotPasteEchoed(lines, pasteText)) return 'echoed'
  if (readCopilotInputState(lines) === 'shell') return 'shell'
  return 'pending'
}

/**
 * 手順 3: 画面が入力待ちで入力欄が空であることを、空が 2 回続くまで確かめる(決められない間は読み直し、上限で止める)。
 * 送ってよければ null、送らないなら失敗の理由(どちらも何も書いていない)。1 回ごとの判定は checkCopilotInputBeforePaste
 */
async function waitForEmptyInput(
  target: AgentSendTarget,
  clock: AgentSendClock
): Promise<AgentSendFailure | null> {
  const deadline = clock.now() + COPILOT_INPUT_STATE_TIMEOUT_MS
  let consecutiveEmpty = 0
  for (;;) {
    // 1 回目の読み取りが押した時点の確かめ(L-058)。保留の間に作業中・確認の画面へ変わっても止める
    const check = checkCopilotInputBeforePaste(target.readScreen())
    if (check.kind === 'blocked') return check.reason
    if (check.kind === 'empty') {
      consecutiveEmpty += 1
      // 描き直しの途中の画面で判定しないよう、空を 2 回続けて確かめる(claude の消去の後の確かめと同じ)
      if (consecutiveEmpty >= 2) return null
    } else {
      consecutiveEmpty = 0
    }
    if (clock.now() >= deadline) return 'input-undetermined'
    await clock.sleep(COPILOT_INPUT_STATE_POLL_MS)
  }
}

/**
 * 手順 5: 貼った本文が入力欄に現れるのを待つ(1 回ごとの判定は checkCopilotPasteEcho)。現れたら null。シェルのモードに
 * 変わったら shell-mode-after-paste(本文を送るとシェルで実行されるので、送るよう案内しない)、上限を過ぎた・画面を読めなくなったら
 * not-echoed。読み取りの例外を reject にしない: 貼り付けの後は本文が入力欄に残りうるので、例外の文言(送信できませんでした)ではなく、
 * 本文が残りうることを伝える not-echoed に倒す(どれも Enter は送らない)
 */
async function waitForEcho(
  target: AgentSendTarget,
  pasteText: string,
  clock: AgentSendClock
): Promise<AgentSendFailure | null> {
  const deadline = clock.now() + COPILOT_ECHO_TIMEOUT_MS
  for (;;) {
    await clock.sleep(COPILOT_ECHO_POLL_MS)
    let lines: ViewportLine[]
    try {
      lines = target.readScreen()
    } catch (err) {
      console.error('[copilotPromptSend] 貼り付けの後の画面の読み取りが失敗しました:', err)
      return 'not-echoed'
    }
    const echo = checkCopilotPasteEcho(lines, pasteText)
    if (echo === 'echoed') return null
    // シェルのモード(!)に入った: Enter を送らない(送ると本文がシェルのコマンドとして実行される)。
    // 時間切れ: Enter を送らない(本文が入力欄に届いたか分からないまま、確認の画面の選択肢などを確定させない)
    if (echo === 'shell') return 'shell-mode-after-paste'
    if (clock.now() >= deadline) return 'not-echoed'
  }
}

/**
 * 手順 7: Enter の後に、送れたことを確かめられるまで待つ(判定は copilotScreenActivity.ts の isCopilotSubmitConfirmed)。確かめられたら
 * true、上限を過ぎた・画面を読めなくなったら false。読み取りの例外を reject にしない: Enter の後は実際には送れていることがあり、
 * 例外の文言(送信できませんでした)を出すと利用者が送り直して二重に送りうるため、not-confirmed に倒す(L-001)
 */
async function waitForSubmit(target: AgentSendTarget, clock: AgentSendClock): Promise<boolean> {
  const deadline = clock.now() + COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS
  for (;;) {
    await clock.sleep(COPILOT_SUBMIT_CONFIRM_POLL_MS)
    let confirmed: boolean
    try {
      confirmed = isCopilotSubmitConfirmed(target.readScreen())
    } catch (err) {
      console.error('[copilotPromptSend] Enter の後の画面の読み取りが失敗しました:', err)
      return false
    }
    if (confirmed) return true
    if (clock.now() >= deadline) return false
  }
}

/**
 * プロンプトを copilot の入力欄へ送る。正規化 → bracketed paste の確認 → 入力待ちと空の確かめ → 括弧付きの貼り付け(1 回の書き込み)
 * → echo の確かめ → 別の書き込みの Enter → 送れたことの確かめ。どこかで確かめられなければ failed を返す
 */
export async function sendCopilotPrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome> {
  const normalized = normalizeAgentPrompt(rawText, 'copilot')
  if (normalized.kind === 'rejected') return failed(normalized.reason)
  // bracketed paste が無効のまま送ると、本文の改行がそれぞれ Enter になり途中で送信される
  if (!target.isBracketedPasteEnabled()) return failed('not-accepting')
  const blocked = await waitForEmptyInput(target, clock)
  if (blocked !== null) return failed(blocked)
  // 送る時点の入力欄は空なので、消去のキーは送らない。echo の確かめは実際に貼った本文で行う
  const pasteText = buildCopilotPasteText(normalized.text)
  target.write(buildAgentPasteBytes(pasteText))
  const notEchoed = await waitForEcho(target, pasteText, clock)
  if (notEchoed !== null) return failed(notEchoed)
  // 貼り付けとは別の書き込み(本文が入力欄に入ったことを確かめてから送る。記録の 3)
  target.write(AGENT_SUBMIT_KEY)
  // 確かめられなくても Enter は送り直さない(送れていることがある。L-001)
  if (!(await waitForSubmit(target, clock))) return failed('not-confirmed')
  // 書きかけを消さないので clearedDraft は常に false
  return { kind: 'sent', clearedDraft: false }
}
