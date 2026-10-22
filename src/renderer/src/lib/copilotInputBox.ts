import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'

// copilot の入力欄の特定と読み取り(設計書 2026-10-22「入力欄の特定と読み取り」)。入力欄の特定(locateCopilotInputBox と規則の
// 定数)は段階 2a の copilotScreenActivity.ts から中身を変えずに移し、記号と入力欄の行を足した。活動の判定(classifyCopilotScreen)と
// 送信の手順(copilotPromptSend.ts)が使う。GitHub Copilot CLI 1.0.87 の画面で記録した(copilotScreens.json・copilotInputScreens.json)。
// 規則の定数はこのファイルに閉じ、claude の agentInputBox.ts の定数とは共有しない(copilot の画面に反転のカーソルは無いので、
// claude の isInputBoxEmpty の規則は使わない)。入力欄の罫線からの相対位置(入力欄の中の行と、下の罫線より下の帯)だけで見て、
// 会話や補完の候補の一覧(上の罫線より上)の同じ文字を見ない(L-398)。根拠が足りなければ undetermined を返し、送らない側に倒す(L-041)。
// dim・反転の属性は使わない。例外は投げない

/** 全幅の罫線の行(行全体が ─ で 20 文字以上)。枠の中の `│ ─── │` は行頭が │ なので当たらない */
const BORDER = /^─{20,}$/
/** 入力欄の記号の行(`❯ `・`! `・--screen-reader の `Start of Prompt Indicator`)。末尾の空白を除くと、空の入力欄は `❯` だけになる */
const SYMBOL_LINE = /^(?:❯(?:[ \xa0]|$)|! |Start of Prompt Indicator)/
/** 入力欄の 2 行目以降(2 桁の字下げ)か空行 */
const CONTINUATION = /^ {2}|^\s*$/

/** 入力欄の記号の種類(❯ は通常、! はシェルのモード、Start of Prompt Indicator は画面読み上げのモード) */
export type CopilotInputSymbol = 'prompt' | 'shell' | 'screen-reader'

/** 記号の行から除く、記号と区切り(記号の種類ごと。U+00A0 の区切りも除く) */
const SYMBOL_PREFIXES: Record<CopilotInputSymbol, RegExp> = {
  prompt: /^❯[ \xa0]?/,
  shell: /^! /,
  'screen-reader': /^Start of Prompt Indicator/
}
/** 入力欄の 2 行目以降の字下げ */
const CONTINUATION_INDENT = /^ {2}/
/**
 * 帯: 空の入力欄(`← open sidebar · / commands · ? help · tab next tab`。右にモデル名)。帯をつないだ文字列(band)にかける。60 列では
 * 2 行に折り返し、40 列では段組みで `← open     · / commands · ? help · tab` / `sidebar       next tab` に折り返す(段階 2a の台帳の idle40)ので、
 * `sidebar` の位置に依らない形にする
 */
const EMPTY_BAND = /^← open\b.*\/ commands\b/
/** 帯: 書きかけ(`@ files · # issues`)。帯をつないだ文字列(band)にかける */
const DRAFT_BAND = /^@ files · # issues/
/** 入力欄の 1 行目の畳みの形(11 行以上・20,480 バイト超) */
const FOLDED_PASTE = /^\[Paste #\d+ - \d+ lines\]/
const SAVED_PASTE = /^\[Saved pasted content to workspace \(/

/** 入力欄の位置・記号・行と帯 */
export interface CopilotInputBox {
  /** 上の罫線の行 */
  top: number
  /** 下の罫線の行 */
  bottom: number
  /** 記号の行の形(`❯ `・`! `・`Start of Prompt Indicator`) */
  symbol: CopilotInputSymbol
  /** 入力欄の各行の本文(記号の行は記号と区切りの後ろ、2 行目以降は 2 桁の字下げの後ろ。末尾の空白は除いてある) */
  rows: string[]
  /** 帯(下の罫線より下の行)の、前後の空白を除いた空でない行を空白 1 つでつないだ文字列(連続する空白は 1 つ)。40 列などで
   *  折り返した案内(`esc` / `interrupt`)も 1 つの文字列で見る */
  band: string
  /** 帯の空でない最初の行(前後の空白を除く)。帯が空なら null */
  bandHead: string | null
}

/**
 * 画面の行を、規則をかける文字列にする。アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてある。どちらでも
 * 同じ結果にするため末尾の空白を除く(BORDER などの `$` は末尾の空白があると当たらない)
 */
export function copilotScreenTexts(lines: readonly ViewportLine[]): string[] {
  return lines.map((line) => lineText(line).trimEnd())
}

/** from から上へ、最初の全幅の罫線の行。無ければ null */
function findBorderAbove(texts: readonly string[], from: number): number | null {
  for (let y = from; y >= 0; y--) {
    if (BORDER.test(texts[y])) return y
  }
  return null
}

/** 記号の行(SYMBOL_LINE に当たる行)の記号の種類。SYMBOL_PREFIXES を順に試し、どれにも当たらなければ prompt */
function symbolOf(symbolLine: string): CopilotInputSymbol {
  if (SYMBOL_PREFIXES.shell.test(symbolLine)) return 'shell'
  if (SYMBOL_PREFIXES['screen-reader'].test(symbolLine)) return 'screen-reader'
  return 'prompt'
}

/**
 * 画面の下から入力欄(上の罫線・記号の行・続きの行・下の罫線)を探す。上の罫線が見えない(入力欄が画面の高さを超えた)・
 * 罫線の間に行が無い・記号の行や続きの行の形が違う画面は、入力欄なし(null)
 */
export function locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null {
  const bottom = findBorderAbove(texts, texts.length - 1)
  if (bottom === null) return null
  const top = findBorderAbove(texts, bottom - 1)
  if (top === null || bottom - top < 2) return null
  if (!SYMBOL_LINE.test(texts[top + 1])) return null
  for (let y = top + 2; y < bottom; y++) {
    if (!CONTINUATION.test(texts[y])) return null
  }
  const symbol = symbolOf(texts[top + 1])
  const rows = [
    texts[top + 1].replace(SYMBOL_PREFIXES[symbol], ''),
    ...texts.slice(top + 2, bottom).map((text) => text.replace(CONTINUATION_INDENT, ''))
  ]
  const bandLines = texts
    .slice(bottom + 1)
    .map((text) => text.trim())
    .filter((text) => text !== '')
  return {
    top,
    bottom,
    symbol,
    rows,
    band: bandLines.join(' ').replace(/\s+/g, ' '),
    bandHead: bandLines[0] ?? null
  }
}

/**
 * 入力欄の状態。empty は送ってよい空、draft は書きかけ(空白だけ・改行だけを含む)、shell はシェルのモード、undetermined は
 * 空か書きかけかを決められない(一時的な帯など)、not-found は入力欄が無い
 */
export type CopilotInputState = 'empty' | 'draft' | 'shell' | 'undetermined' | 'not-found'

/** 入力欄の状態を読む(上から順に、最初に当てはまったもの。設計書「入力欄の特定と読み取り」の表) */
export function readCopilotInputState(lines: readonly ViewportLine[]): CopilotInputState {
  const box = locateCopilotInputBox(copilotScreenTexts(lines))
  // 確認・選択の画面・描き直しの途中
  if (box === null) return 'not-found'
  // シェルのモード(空は `! Execute shell command`、書きかけは `! echo hi`。記録の 5)
  if (box.symbol === 'shell') return 'shell'
  // 書きかけ(複数行・畳み・`/` の一覧の候補 `/add-dir` を含む)。一時的な帯の間でも文字は見える
  if (box.rows.some((row) => /\S/.test(row))) return 'draft'
  // 空白だけの書きかけ・改行だけの書きかけ(`❯` と帯 `@ files · # issues`。記録の 5)
  if (DRAFT_BAND.test(box.band)) return 'draft'
  // 空の入力欄(記録の 5。送った後・中断の後の入力欄も同じ)
  if (box.rows.length === 1 && EMPTY_BAND.test(box.band)) return 'empty'
  // 一時的な帯(記録の 6)・帯が空・入力欄が 2 行以上で文字が無いのに帯が書きかけの形でない、など
  return 'undetermined'
}

/** 前後の空白を除き、連続する空白(タブを含む)を 1 つにする */
const squeezeSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * 貼り付けた本文(text は実際に貼った本文。末尾の @ の語の後ろに足した空白を含む)が入力欄に現れたか。入力欄の 1 行目が畳みの形なら
 * 現れたとし、そうでなければ入力欄の空でない最後の行が本文のどれかの行に含まれれば現れたとする。最後の行で見るのは、入力欄の高さに
 * 上限があり、超えると先頭が見えなくなるため(記録の 7。最後の行は貼り付けの後のカーソルの行なので常に見える)。copilot は文字の
 * 単位で折り返すので、見えている行は本文の行の部分の文字列になる。送る直前に入力欄が空であることを確かめ、送る間は利用者の
 * キー入力を溜めているので、入力欄に現れた文字は貼り付けたものだけ(「最後の行が本文の一部」で足りる)
 */
export function isCopilotPasteEchoed(lines: readonly ViewportLine[], text: string): boolean {
  const box = locateCopilotInputBox(copilotScreenTexts(lines))
  if (box === null || box.symbol === 'shell') return false
  if (FOLDED_PASTE.test(box.rows[0]) || SAVED_PASTE.test(box.rows[0])) return true
  const lastRow = [...box.rows]
    .reverse()
    .map(squeezeSpaces)
    .find((row) => row !== '')
  if (lastRow === undefined) return false
  return text.split('\n').some((line) => squeezeSpaces(line).includes(lastRow))
}
