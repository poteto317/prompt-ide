import type { AgentPermissionOption, AgentPermissionPrompt } from './agentPermissionPrompt'
import { isWellFormedAgentPermissionOptions } from './agentPermissionPrompt'
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'
import {
  NUMBERED_LINE,
  PERMISSION_CURSOR_OPTION,
  RULE_LINE,
  classifyClaudeScreen,
  indentOf,
  locateClaudePermissionPrompt
} from './claudeScreenActivity'

// claude の許可の確認の読み取り(設計書 2026-11-06「claude」)。claude 2.1.288 の画面で記録した(agentScreens.json)。
// 位置の特定は判定と同じ locateClaudePermissionPrompt(規則の定数は claudeScreenActivity.ts の 1 か所)。判定が permission の画面だけ読む
// (入力欄のある画面を許可待ちとしない規則も判定に任せる)。例外は投げない

/** 選択肢の行の番号と文言(カーソルの印は飛ばす) */
const OPTION_TEXT = /^\s*(?:❯\s*)?(\d+)\.\s*(.*)$/
/**
 * 本文の上の端: 許可の画面の上の全幅の罫線(字下げの無い、─ だけの行。texts は末尾の空白を除いた値なので trim せずに当てる)。
 * 字下げした ─ だけの行(heredoc の Markdown の区切りなど)と ╌ の区切りは本文の中の行
 */
const FULL_WIDTH_RULE = /^─+$/
/** 番号キーが選択肢の選択として効く画面の案内(カーソルが Yes・No にあり、まだ入力の形でないときだけ出る) */
const AMEND_HINT = 'Tab to amend'
/**
 * claude がカーソルの位置に応じて AMEND_HINT を出す選択肢(`Yes` と、`No` そのものか `No,` で始まる選択肢。claude 2.1.288 の画面の規則)。
 * 帯の 許可・拒否 に使う選択肢の規則(findAgentPermissionOption。アプリの方針)とは分けて持ち、方針を変えても番号キーの読み取りが変わらないようにする。
 * どちらも画面にちょうど 1 つのときだけ当てる
 */
const AMENDABLE_OPTION_RULES: readonly ((text: string) => boolean)[] = [
  (text) => text === 'Yes',
  (text) => /^No(?:,|$)/.test(text)
]

interface OptionDraft {
  number: number
  parts: string[]
}

interface ReadBody {
  body: string[]
  /** 本文の上の端(全幅の罫線)を画面の中で見つけたか */
  startVisible: boolean
}

/**
 * questionFirst から上へ、最初の全幅の罫線の直後から問いの手前まで(罫線が無ければ画面の先頭から。そのとき startVisible は偽)。
 * 空の行と罫線だけの行は除く
 */
function readBody(texts: readonly string[], questionFirst: number): ReadBody {
  let start = 0
  let startVisible = false
  for (let y = questionFirst - 1; y >= 0; y--) {
    if (FULL_WIDTH_RULE.test(texts[y])) {
      start = y + 1
      startVisible = true
      break
    }
  }
  const body = texts
    .slice(start, questionFirst)
    .filter((text) => text.trim() !== '' && !RULE_LINE.test(text))
    .map((text) => text.trim())
  return { body, startVisible }
}

interface ReadOptions {
  options: AgentPermissionOption[]
  /** カーソルの印のある選択肢の番号(形の確かめに使う。ちょうど 1 つのはず) */
  cursorNumbers: number[]
  /** 選択肢の並びの次の行(案内の行を探し始める行) */
  end: number
}

/**
 * start(問いの次の行)から下へ選択肢を読む。問いと最初の選択肢の間の空行は飛ばし、選択肢が始まった後の空行・番号の桁より深くない
 * 字下げの、選択肢でない行(浅い行と、番号の桁と同じ字下げで番号の無い行)で終える。番号の桁より深い字下げの行は直前の選択肢の折り返し。
 * 選択肢の行なのに番号と文言に分けられなければ null
 */
function readOptions(
  texts: readonly string[],
  start: number,
  numberColumn: number
): ReadOptions | null {
  const drafts: OptionDraft[] = []
  const cursorNumbers: number[] = []
  let y = start
  // 問いと最初の選択肢の間の空行は飛ばす
  while (y < texts.length && texts[y] === '') y++
  for (; y < texts.length; y++) {
    const text = texts[y]
    // 選択肢が始まった後の空行で終える
    if (text === '') break
    const cursor = PERMISSION_CURSOR_OPTION.exec(text)
    const isCursor = cursor !== null && cursor[1].length === numberColumn
    if (isCursor || (NUMBERED_LINE.test(text) && indentOf(text) === numberColumn)) {
      const match = OPTION_TEXT.exec(text)
      if (match === null) return null
      const number = Number(match[1])
      drafts.push({ number, parts: [match[2].trim()] })
      if (isCursor) cursorNumbers.push(number)
      continue
    }
    // 番号の桁より深い字下げの行は、直前の選択肢の折り返し(台帳の permission の 2 番)
    const last = drafts[drafts.length - 1]
    if (last !== undefined && indentOf(text) > numberColumn) {
      last.parts.push(text.trim())
      continue
    }
    break
  }
  const options = drafts.map(({ number, parts }) => ({ number, text: parts.join(' ') }))
  return { options, cursorNumbers, end: y }
}

/**
 * 番号キーが選択肢の選択として効くか: 選択肢の後の最初の空でない行(案内の行)に `Tab to amend` があり、カーソルが Yes・No の
 * 選択肢にあるときだけ真
 */
function acceptsNumberKeys(
  texts: readonly string[],
  optionsEnd: number,
  options: readonly AgentPermissionOption[],
  cursorNumber: number
): boolean {
  const hint = texts.slice(optionsEnd).find((text) => text.trim() !== '') ?? ''
  const cursorOnAnswer = AMENDABLE_OPTION_RULES.some((rule) => {
    const matched = options.filter((option) => rule(option.text))
    return matched.length === 1 && matched[0].number === cursorNumber
  })
  return hint.includes(AMEND_HINT) && cursorOnAnswer
}

export function readClaudePermissionPrompt(
  lines: readonly ViewportLine[]
): AgentPermissionPrompt | null {
  if (classifyClaudeScreen(lines) !== 'permission') return null
  // アプリの画面の行は列の数まで空白で埋まるので末尾の空白を除く(字下げは残す)
  const texts = lines.map((line) => lineText(line).trimEnd())
  const located = locateClaudePermissionPrompt(texts)
  if (located === null) return null
  const { numberColumn, questionFirst, questionLast } = located
  const read = readOptions(texts, questionLast + 1, numberColumn)
  if (read === null) return null
  const { options, cursorNumbers, end } = read
  if (!isWellFormedAgentPermissionOptions(options, cursorNumbers)) return null
  const cursorNumber = cursorNumbers[0]
  const { body, startVisible } = readBody(texts, questionFirst)
  return {
    body,
    question: texts.slice(questionFirst, questionLast + 1).map((text) => text.trim()),
    options,
    cursorNumber,
    numberKeysAccepted: acceptsNumberKeys(texts, end, options, cursorNumber),
    bodyStartVisible: startVisible
  }
}
