import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'

// 画面の末尾から、copilot の活動の状態を判定する純粋関数(設計書 2026-10-21「copilot の判定」)。GitHub Copilot CLI 1.0.87 の
// 画面で記録した(copilotScreens.json)。規則の定数(文言)はこのファイルに閉じ、claude の規則(claudeScreenActivity.ts の
// `esc to interrupt`・スピナーの記号・`Enter to confirm` など)とは共有しない。分からない画面は、作業中でないのに working・
// 利用者の操作を待っているのに idle にならない側(unknown・confirm)に倒す(L-041)。判定は上から順に、最初に当てはまったもの。
// dim・反転の属性は使わない(--screen-reader でも同じ文言が出るため)。例外は投げない

/** 全幅の罫線の行(行全体が ─ で 20 文字以上)。枠の中の `│ ─── │` は行頭が │ なので当たらない */
const BORDER = /^─{20,}$/
/** 入力欄の記号の行(`❯ `・`! `・--screen-reader の `Start of Prompt Indicator`)。末尾の空白を除くと、空の入力欄は `❯` だけになる */
const SYMBOL_LINE = /^(?:❯(?:[ \xa0]|$)|! |Start of Prompt Indicator)/
/** 入力欄の 2 行目以降(2 桁の字下げ)か空行 */
const CONTINUATION = /^ {2}|^\s*$/
/** 作業中の案内(帯だけで見る) */
const INTERRUPT_HINTS = ['esc interrupt', 'esc again to interrupt'] as const
/** 帯の先頭のスピナー(作業中の補助の手がかり。案内が見えなくても入力待ちとしない) */
const BAND_SPINNER = /^[○◎◉●] \S/
/** 選択の画面の案内(`↑/↓ to navigate · enter to select · esc to cancel`・`↑↓ Navigate · Enter Select · Esc Cancel`) */
const SELECTION_HINT = /navigate\s*·\s*enter (?:to )?select/i
/** 許可の問い(枠の │・┃ と空白を除いた行頭) */
const PERMISSION_QUESTION = /^Do you want to /
/** 問いの前に除く、枠の縦線と空白 */
const FRAME_PREFIX = /^[│┃\s]+/
/** 選択の画面の外枠の上端(行頭の ╭)。問いを探すのはこの行より下だけ */
const DIALOG_TOP = /^╭/

/** 入力欄の位置と帯(段階 2b で送信に使うときに copilotInputBox.ts へ切り出す) */
interface CopilotInputBox {
  /** 上の罫線の行 */
  top: number
  /** 下の罫線の行 */
  bottom: number
  /** 帯(下の罫線より下の行)の、前後の空白を除いた空でない行を空白 1 つでつないだ文字列(連続する空白は 1 つ)。40 列などで
   *  折り返した案内(`esc` / `interrupt`)も 1 つの文字列で見る */
  band: string
  /** 帯の空でない最初の行(前後の空白を除く)。帯が空なら null */
  bandHead: string | null
}

/** from から上へ、最初の全幅の罫線の行。無ければ null */
function findBorderAbove(texts: readonly string[], from: number): number | null {
  for (let y = from; y >= 0; y--) {
    if (BORDER.test(texts[y])) return y
  }
  return null
}

/**
 * 画面の下から入力欄(上の罫線・記号の行・続きの行・下の罫線)を探す。上の罫線が見えない(入力欄が画面の高さを超えた)・
 * 罫線の間に行が無い・記号の行や続きの行の形が違う画面は、入力欄なし(null)
 */
function locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null {
  const bottom = findBorderAbove(texts, texts.length - 1)
  if (bottom === null) return null
  const top = findBorderAbove(texts, bottom - 1)
  if (top === null || bottom - top < 2) return null
  if (!SYMBOL_LINE.test(texts[top + 1])) return null
  for (let y = top + 2; y < bottom; y++) {
    if (!CONTINUATION.test(texts[y])) return null
  }
  const bandLines = texts
    .slice(bottom + 1)
    .map((text) => text.trim())
    .filter((text) => text !== '')
  return {
    top,
    bottom,
    band: bandLines.join(' ').replace(/\s+/g, ' '),
    bandHead: bandLines[0] ?? null
  }
}

/** 選択の案内の行から上へ、外枠の上端(行頭の ╭)に当たるまでの間に、枠の縦線と空白を除くと許可の問いで始まる行があるか */
function hasPermissionQuestion(texts: readonly string[]): boolean {
  return texts.some((text, y) => {
    if (!SELECTION_HINT.test(text)) return false
    for (let above = y - 1; above >= 0; above--) {
      if (DIALOG_TOP.test(texts[above])) return false
      if (PERMISSION_QUESTION.test(texts[above].replace(FRAME_PREFIX, ''))) return true
    }
    return false
  })
}

export function classifyCopilotScreen(lines: readonly ViewportLine[]): AgentActivity {
  // アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてある。どちらでも同じ判定にするため末尾の空白を除く
  // (BORDER などの `$` は末尾の空白があると当たらない)
  const texts = lines.map((line) => lineText(line).trimEnd())
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
