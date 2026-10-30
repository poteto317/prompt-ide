import type { ViewportCell, ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'

// claude の入力欄を画面から特定し、空か・貼り付けた本文が現れたかを判定する純粋関数(設計書「プロンプトの送信」5・6・10)。
// 入力欄は「罫線(行頭から ─ が 20 文字以上)・記号の行・罫線」で、記号の行は行頭の ❯(シェルのモードは !)に
// U+00A0(または空白)が続く。2 行目以降は 2 桁の字下げ。claude 2.1.288 の画面で記録した(agentScreens.json)。
// 確認画面(信頼・全画面の表示の案内・許可)は ❯ が行頭に無く、この並びも無い

export type InputBoxSymbol = 'prompt' | 'shell'

export interface InputBox {
  /** 記号。入力欄の行が画面の高さを超えて記号の行が見えないときは null */
  symbol: InputBoxSymbol | null
  /** 入力欄の行(記号の行から下の罫線の手前まで。記号の行が見えないときは見えている行だけ) */
  lines: ViewportLine[]
}

const BORDER = /^─{20,}/
const SYMBOL_LINE = /^([❯!])(?:[\xa0 ]|$)/
const CONTINUATION = /^ {2}/
/** 記号と、その後ろの区切り(U+00A0)の 2 文字の後ろから本文が始まる */
const TEXT_START = 2
/** 本文の先頭を比べる最大の桁数(設計書「プロンプトの送信」10) */
export const ECHO_HEAD_MAX_COLUMNS = 24

const isBorder = (line: ViewportLine): boolean => BORDER.test(lineText(line))
const isBlank = (line: ViewportLine): boolean => lineText(line).trim() === ''
const isContinuation = (line: ViewportLine): boolean =>
  CONTINUATION.test(lineText(line)) || isBlank(line)

/** 入力欄と、画面の中での罫線の位置(活動の判定がスピナーの行・案内の行を入力欄の上下だけで見るのに使う) */
export interface LocatedInputBox {
  box: InputBox
  /** 上の罫線の行番号。入力欄の行が画面の高さを超えて上の罫線が見えないときは null */
  top: number | null
  /** 下の罫線の行番号 */
  bottom: number
}

/** 画面の下から入力欄を探し、罫線の位置とともに返す。見つからなければ null */
export function locateInputBox(lines: readonly ViewportLine[]): LocatedInputBox | null {
  let bottom = -1
  for (let y = lines.length - 1; y >= 0; y--) {
    if (isBorder(lines[y])) {
      bottom = y
      break
    }
  }
  if (bottom <= 0) return null
  let top = -1
  for (let y = bottom - 1; y >= 0; y--) {
    if (isBorder(lines[y])) {
      top = y
      break
    }
  }
  if (top < 0) {
    // 入力欄の行が画面の高さを超えた: 下の罫線の上が画面の上端まですべて字下げの行なら、入力欄はあるが空ではない
    const visible = lines.slice(0, bottom)
    return visible.every(isContinuation) && visible.some((line) => !isBlank(line))
      ? { box: { symbol: null, lines: [...visible] }, top: null, bottom }
      : null
  }
  const body = lines.slice(top + 1, bottom)
  if (body.length === 0) return null
  const match = SYMBOL_LINE.exec(lineText(body[0]))
  if (match === null) return null
  if (!body.slice(1).every(isContinuation)) return null
  return { box: { symbol: match[1] === '❯' ? 'prompt' : 'shell', lines: [...body] }, top, bottom }
}

/** 画面の下から入力欄を探す。見つからなければ null(確認画面・選択の画面など。何も送らない) */
export function findInputBox(lines: readonly ViewportLine[]): InputBox | null {
  return locateInputBox(lines)?.box ?? null
}

/**
 * 入力欄が空か: 1 行で、記号が ❯(! はシェルのモードなので空ではない)、記号の後ろの文字がすべて空白か dim
 * (送信待ちの案内 `Press up to edit queued messages` など)で、反転表示のカーソルが記号の直後にある(確認の結果 21)。
 * カーソルのセルが空白でなければ、直後のセルが dim であること(案内の文字の先頭にカーソルが乗っている形)を求める。
 * 端末のフォーカスが外れると claude はカーソルを描かない(?1004h。実行のボタンを押すとターミナルからフォーカスが外れる)ので、
 * 行のどこにも反転が無いときは、カーソルの位置を問わず、記号の後ろの文字だけで判定する。
 *
 * 前提: この関数が true でも、書きかけを区別できない場合がある。カーソルが書きかけの 1 文字の上にあり続きが dim の
 * 候補・案内の形(`a` + dim の候補 + ←)は送信待ちの案内(queuedEmpty)とセルの属性が同じで、空白 1 文字 + ← は空の入力欄と
 * 同じ画面になる。呼び出し側は、空と判定されても消去を省略しないこと(送信の手順は消去を最低 1 回送ってから空を確認する)
 */
export function isInputBoxEmpty(box: InputBox): boolean {
  if (box.symbol !== 'prompt' || box.lines.length !== 1) return false
  const cells = box.lines[0]
  const isBlankOrDim = (cell: ViewportCell): boolean =>
    cell.char === ' ' || cell.char === '\xa0' || cell.dim
  if (!cells.some((cell) => cell.inverse)) return cells.slice(TEXT_START).every(isBlankOrDim)
  if (cells[TEXT_START]?.inverse !== true) return false
  // カーソルが文字の上にあるのは、案内の文字の先頭に乗っている形(直後が dim)だけを空とみなす。1 文字の書きかけで
  // カーソルを先頭に戻した入力欄(`a` + ←)もカーソルがその文字の反転で描かれるので、それ以外は空ではない(送らない側に倒す)
  const cursorChar = cells[TEXT_START].char
  if (cursorChar !== ' ' && cursorChar !== '\xa0' && cells[TEXT_START + 1]?.dim !== true) {
    return false
  }
  return cells.slice(TEXT_START + 1).every(isBlankOrDim)
}

// 全角の文字の幅(2 桁)の範囲。厳密な East Asian Width ではなく、ハングル・CJK・全角の記号・絵文字を 2 桁とみなす
const WIDE_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff]
]

const columnsOf = (char: string): number => {
  const codePoint = char.codePointAt(0) ?? 0
  return WIDE_CODE_POINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
    ? 2
    : 1
}

/** 行の先頭から、桁数が maxColumns を超えない範囲の文字列 */
export function headWithinColumns(text: string, maxColumns: number): string {
  let columns = 0
  let head = ''
  for (const char of text) {
    const width = columnsOf(char)
    if (columns + width > maxColumns) break
    columns += width
    head += char
  }
  return head
}

const textAfterSymbol = (line: ViewportLine): string =>
  lineText(line).slice(TEXT_START).replace(/\xa0/g, ' ')

/**
 * 貼り付けた本文が入力欄に現れたか(設計書「プロンプトの送信」10)。記号が ❯ で、入力欄の 1 行目が本文の最初の行の先頭
 * (最大 24 桁。桁数が少ないときは折り返しを考えて桁数 − 4 まで。タブは空白 4 つで表示される)で始まるか、
 * `[Pasted text #<数字>` で始まるとき true。本文の最初の行が空白だけのときは、1 行目が空白だけで、2 行目以降に
 * 最初の空でない行の先頭が現れることで確かめる。
 *
 * 前提: text は呼び出し側が貼り付けに使う正規化の後の本文(normalizeAgentPrompt が kind: 'ok' で返す text。buildAgentPasteBytes に渡すものと同じ)を渡す。正規化の前の本文を
 * 渡すと、入力欄に現れた本文と先頭が食い違いうる
 */
export function isPasteEchoed(box: InputBox, text: string, cols: number): boolean {
  if (box.symbol !== 'prompt' || box.lines.length === 0) return false
  const first = textAfterSymbol(box.lines[0])
  if (/^\[Pasted text #\d/.test(first)) return true
  const maxColumns = Math.max(1, Math.min(ECHO_HEAD_MAX_COLUMNS, cols - 4))
  const sourceLines = text.split('\n').map((line) => line.replace(/\t/g, '    '))
  const firstHead = headWithinColumns(sourceLines[0], maxColumns).trimEnd()
  if (firstHead !== '') return first.startsWith(firstHead)
  if (first.trim() !== '') return false
  const nextLine = sourceLines.slice(1).find((line) => line.trim() !== '')
  if (nextLine === undefined) return false
  const nextHead = headWithinColumns(nextLine, maxColumns).trimEnd()
  return box.lines.slice(1).some((line) => textAfterSymbol(line).startsWith(nextHead))
}
