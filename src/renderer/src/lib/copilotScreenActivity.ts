import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { copilotScreenTexts, locateCopilotInputBox, readCopilotInputState } from './copilotInputBox'

// 画面の末尾から、copilot の活動の状態を判定する純粋関数(設計書 2026-10-21「copilot の判定」)。GitHub Copilot CLI 1.0.87 の
// 画面で記録した(copilotScreens.json)。規則の定数(文言)はこのファイルに閉じ、claude の規則(claudeScreenActivity.ts の
// `esc to interrupt`・スピナーの記号・`Enter to confirm` など)とは共有しない。分からない画面は、作業中でないのに working・
// 利用者の操作を待っているのに idle にならない側(unknown・confirm)に倒す(L-041)。判定は上から順に、最初に当てはまったもの。
// dim・反転の属性は使わない(--screen-reader でも同じ文言が出るため)。例外は投げない
// 入力欄の特定(罫線・記号の行・続きの行と帯)は copilotInputBox.ts(段階 2b で送信の手順と共有するために切り出した)

/** 作業中の案内(帯だけで見る) */
const INTERRUPT_HINTS = ['esc interrupt', 'esc again to interrupt'] as const
/** 帯の先頭のスピナー(作業中の補助の手がかり。案内が見えなくても入力待ちとしない) */
const BAND_SPINNER = /^[○◎◉●] \S/
/** 選択の画面の案内(`↑/↓ to navigate · enter to select · esc to cancel`・`↑↓ Navigate · Enter Select · Esc Cancel`) */
const SELECTION_HINT = /navigate\s*·\s*enter (?:to )?select/i
/** 許可の問い(枠の │・┃ と空白を除いた行頭) */
const PERMISSION_QUESTION = /^Do you want to /
/** 問いの前に除く、枠の縦線と空白 */
export const FRAME_PREFIX = /^[│┃\s]+/
/** 選択の画面の外枠の上端(行頭の ╭)。問いを探すのはこの行より下だけ */
export const DIALOG_TOP = /^╭/

/** 許可の確認の画面の位置(選択の案内の行と、許可の問いの行) */
export interface CopilotPermissionQuestionLocation {
  hintRow: number
  questionRow: number
}

/**
 * 選択の案内の行から上へ、外枠の上端(行頭の ╭)に当たるまでの間に、枠の縦線と空白を除くと許可の問いで始まる行を探す。
 * 判定(hasPermissionQuestion)と読み取り(copilotPermissionPrompt.ts)が同じ位置を使う(設計書 2026-11-06「選択肢の読み取り」)。
 * 上から最初に当たった案内の行の位置を返す
 */
export function locateCopilotPermissionQuestion(
  texts: readonly string[]
): CopilotPermissionQuestionLocation | null {
  for (let y = 0; y < texts.length; y++) {
    if (!SELECTION_HINT.test(texts[y])) continue
    for (let above = y - 1; above >= 0; above--) {
      if (DIALOG_TOP.test(texts[above])) break
      if (PERMISSION_QUESTION.test(texts[above].replace(FRAME_PREFIX, ''))) {
        return { hintRow: y, questionRow: above }
      }
    }
  }
  return null
}

function hasPermissionQuestion(texts: readonly string[]): boolean {
  return locateCopilotPermissionQuestion(texts) !== null
}

export function classifyCopilotScreen(lines: readonly ViewportLine[]): AgentActivity {
  // アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてある。どちらでも同じ判定にするため末尾の空白を除く
  const texts = copilotScreenTexts(lines)
  const box = locateCopilotInputBox(texts)
  if (box === null) {
    // シェルのコマンドの許可の確認(記録済み)。シェル以外のツールの確認も同じ部品の画面だと見込んで同じ規則で拾う
    if (hasPermissionQuestion(texts)) return 'permission'
    // フォルダの信頼の確認・巻き戻しの画面(記録済み)と、問いの分からない選択の画面
    if (texts.some((text) => SELECTION_HINT.test(text))) return 'confirm'
    // 描き直しの途中・終了の後の通常画面・未知の画面・入力欄が画面の高さを超えた書きかけ
    return 'unknown'
  }
  // 入力欄の外(上の罫線より上と帯)の選択の案内は、問いがあっても確認待ち(ask_user などの未知の選択の画面を作業中・入力待ちと
  // しない)。書きかけ(入力欄の中)の同じ文字は見ない
  const outside = [...texts.slice(0, box.top), ...texts.slice(box.bottom + 1)]
  if (outside.some((text) => SELECTION_HINT.test(text))) return 'confirm'
  // 中断の案内は帯だけで見る(会話の本文・`❯ …` の履歴・上の罫線の上の行の同じ文字で作業中とせず、Esc を送る側に倒さない)
  if (INTERRUPT_HINTS.some((hint) => box.band.includes(hint))) return 'working'
  // 帯が空(描き直しの途中)
  if (box.bandHead === null) return 'unknown'
  // 作業中の帯はスピナーで始まる。案内の語が変わった・折り返しで案内が切れた作業中の画面を入力待ちとしない
  if (BAND_SPINNER.test(box.bandHead)) return 'unknown'
  // 入力待ちの帯(空・書きかけ・シェルのモード・Esc や Ctrl+C の直後・`?`・`/`)はどれもスピナーで始まらず、中断の案内を含まない
  return 'idle'
}

/**
 * 送れたことの確かめ(送信の手順 copilotPromptSend.ts の手順 7 の判定)。Enter の後の画面で、帯が作業中になったか入力欄が空に
 * 戻ったら送れたとみなす。即答では作業中が約 36ms しか見えず入力待ちに戻るが、そのときは入力欄が空なので拾える(記録の 4)。
 * Enter が補完の確定に取られた(入力欄が書き換わったまま)なら偽。活動の判定と入力欄の読み取りの両方を使うので、両方に依存して
 * よいこのファイルに置く(依存の向きは copilotInputBox ← copilotScreenActivity ← copilotPromptSend の一方向)
 */
export function isCopilotSubmitConfirmed(lines: readonly ViewportLine[]): boolean {
  return classifyCopilotScreen(lines) === 'working' || readCopilotInputState(lines) === 'empty'
}
