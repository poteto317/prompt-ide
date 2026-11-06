import type { AgentPermissionOption, AgentPermissionPrompt } from './agentPermissionPrompt'
import { isWellFormedAgentPermissionOptions } from './agentPermissionPrompt'
import type { ViewportLine } from './agentViewport'
import { copilotScreenTexts } from './copilotInputBox'
import {
  DIALOG_TOP,
  FRAME_PREFIX,
  classifyCopilotScreen,
  locateCopilotPermissionQuestion
} from './copilotScreenActivity'

// copilot の許可の確認の読み取り(設計書 2026-11-06「copilot」)。GitHub Copilot CLI 1.0.87 の画面で記録した(copilotScreens.json)。
// 位置の特定は判定と同じ locateCopilotPermissionQuestion。判定が permission の画面だけ読む。各行は行頭の枠と空白(FRAME_PREFIX)と
// 行末の枠と空白(FRAME_SUFFIX)を除いてから見る。claude の規則とは共有しない(L-041)。例外は投げない

/** 行末の枠の縦線と空白 */
const FRAME_SUFFIX = /[\s│┃]+$/
/** 選択肢の行。印(`❯ ` か、読み上げのモードの `Current selection: `)のある行がカーソルの行 */
const OPTION_LINE = /^(?:(❯|Current selection:) )?(\d+)\. (.*)$/
/** 枠の文字と空白だけの行(外枠の中の区切りの ───・内側のコマンドの枠の角の行)。本文から除く */
const FRAME_ONLY = /^[─━│┃╭╮╰╯\s]*$/

const stripFrame = (text: string): string =>
  text.replace(FRAME_PREFIX, '').replace(FRAME_SUFFIX, '')

interface OptionDraft {
  number: number
  parts: string[]
}

interface ReadBody {
  body: string[]
  /** 本文の上の端(行頭の ╭)を画面の中で見つけたか */
  startVisible: boolean
}

/**
 * questionRow から上へ、行頭が ╭ の行の直後から問いの手前まで(無ければ画面の先頭から。そのとき startVisible は偽)。
 * 読み上げのモード(外枠が無い)では内側のコマンドの枠の ╭ が当たる。枠だけの行と空の行は除く
 */
function readBody(texts: readonly string[], questionRow: number): ReadBody {
  let start = 0
  let startVisible = false
  for (let y = questionRow - 1; y >= 0; y--) {
    if (DIALOG_TOP.test(texts[y])) {
      start = y + 1
      startVisible = true
      break
    }
  }
  const body = texts
    .slice(start, questionRow)
    .map(stripFrame)
    .filter((text) => !FRAME_ONLY.test(text))
  return { body, startVisible }
}

export function readCopilotPermissionPrompt(
  lines: readonly ViewportLine[]
): AgentPermissionPrompt | null {
  if (classifyCopilotScreen(lines) !== 'permission') return null
  const texts = copilotScreenTexts(lines)
  const located = locateCopilotPermissionQuestion(texts)
  if (located === null) return null
  const { hintRow, questionRow } = located
  const question = [stripFrame(texts[questionRow])]
  const drafts: OptionDraft[] = []
  const cursorNumbers: number[] = []
  // 選択肢の並びは問いの次の行から案内の行の手前まで(終わりは案内の行で決まり、選択肢でない行では終えない)。枠を除いて空の行は飛ばす
  for (let y = questionRow + 1; y < hintRow; y++) {
    const text = stripFrame(texts[y])
    if (text === '') continue
    const match = OPTION_LINE.exec(text)
    if (match !== null) {
      const number = Number(match[2])
      drafts.push({ number, parts: [match[3].trim()] })
      if (match[1] !== undefined) cursorNumbers.push(number)
      continue
    }
    // 当たらない行は、最初の選択肢の行より前なら問いの折り返し、後なら(最後の選択肢と案内の行の間も)直前の選択肢の折り返し。字下げは見ない
    const last = drafts[drafts.length - 1]
    if (last === undefined) question.push(text)
    else last.parts.push(text)
  }
  const options: AgentPermissionOption[] = drafts.map(({ number, parts }) => ({
    number,
    text: parts.join(' ')
  }))
  if (!isWellFormedAgentPermissionOptions(options, cursorNumbers)) return null
  const cursorNumber = cursorNumbers[0]
  const { body, startVisible } = readBody(texts, questionRow)
  return {
    body,
    question,
    options,
    cursorNumber,
    // 最後の選択肢は「代わりにしてほしいこと」の入力欄になる選択肢。カーソルがそこにある間は数字が入力欄へ文字として入る
    numberKeysAccepted: cursorNumber !== options[options.length - 1].number,
    bodyStartVisible: startVisible
  }
}
