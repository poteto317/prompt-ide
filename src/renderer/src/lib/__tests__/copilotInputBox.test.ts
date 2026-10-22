import { describe, it, expect } from 'vitest'
import {
  copilotScreenTexts,
  isCopilotPasteEchoed,
  locateCopilotInputBox,
  readCopilotInputState
} from '../copilotInputBox'
import type { CopilotInputState } from '../copilotInputBox'
// isCopilotSubmitConfirmed は送れたことの確かめ(copilotPromptSend.ts の手順 7 が使う判定そのもの)
import { classifyCopilotScreen, isCopilotSubmitConfirmed } from '../copilotScreenActivity'
import type { AgentActivity } from '../agentActivity'
import { lineText } from '../agentViewport'
import type { ViewportLine } from '../agentViewport'
import { makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import {
  copilotInputScreen,
  copilotInputSequence,
  screenFromTexts
} from './fixtures/copilotInputScreens'
import type {
  CopilotInputScreenName,
  CopilotInputSequenceName
} from './fixtures/copilotInputScreens'
import data from './fixtures/copilotInputScreens.json'

// 記録済みの画面(GitHub Copilot CLI 1.0.87 の段階 2b の追加の記録。設計書 2026-10-22「実装の最初に確かめること」4)ごとの
// 活動(classifyCopilotScreen)と入力欄(readCopilotInputState)の期待。Record にしているので、台帳に画面が増えたら型エラーになる
const EXPECTED: Record<CopilotInputScreenName, readonly [AgentActivity, CopilotInputState]> = {
  empty: ['idle', 'empty'],
  spacesTyped: ['idle', 'draft'],
  spacesPasted: ['idle', 'draft'],
  spacesEsc1: ['idle', 'undetermined'],
  newlinesPasted: ['idle', 'draft'],
  multiPasted: ['idle', 'draft'],
  shellEmpty: ['idle', 'shell'],
  shellDraft: ['idle', 'shell'],
  // シェルのモードで空白だけを入力した画面は、記号の行が `!` だけになり入力欄として認められない(既知の制約。送らない側)
  shellSpaces: ['unknown', 'not-found'],
  afterTurnEmpty: ['idle', 'empty'],
  afterTurn1char: ['idle', 'draft'],
  fold10: ['idle', 'draft'],
  fold11: ['idle', 'draft'],
  long5000: ['idle', 'draft'],
  send11: ['idle', 'empty'],
  inline20480: ['idle', 'draft'],
  saved20481: ['idle', 'draft'],
  ja6800: ['idle', 'draft'],
  huge: ['idle', 'draft'],
  tallIdle: ['idle', 'empty'],
  tallPaste9: ['idle', 'draft'],
  tallPaste30: ['idle', 'draft'],
  tallPaste5000: ['idle', 'draft'],
  tallSent: ['idle', 'empty'],
  atPaste: ['idle', 'draft'],
  // Enter が補完の確定に取られ、本文が `look at @file.txt` に書き換わった入力欄(空に戻らない)
  atEnter: ['idle', 'draft'],
  ctrlcBandPaste: ['idle', 'draft'],
  helpOpen: ['idle', 'undetermined'],
  workingInterrupted: ['idle', 'empty'],
  aeInstantEnd: ['idle', 'empty'],
  // 補完の候補の一覧が上の罫線より上に開いても、入力欄の外の選択の案内が無いので入力待ち
  atref1Paste: ['idle', 'draft'],
  atref1Enter1: ['idle', 'draft'],
  atref1hPaste: ['idle', 'draft'],
  atref1hEnter1: ['idle', 'draft'],
  atref2Paste: ['idle', 'draft'],
  atref2Enter1: ['idle', 'empty'],
  atref3Paste: ['idle', 'draft'],
  atref4Paste: ['idle', 'draft'],
  atref4Enter1: ['idle', 'empty'],
  atref5Paste: ['idle', 'draft'],
  atref5Enter1: ['idle', 'draft'],
  atref6Esc: ['idle', 'draft'],
  atref7SameWriteCr: ['idle', 'empty'],
  atref8Paste: ['idle', 'draft'],
  atref8Enter1: ['idle', 'empty']
}

const RULE = '─'.repeat(100)
const IDLE_BAND =
  ' ← open sidebar · / commands · ? help · tab next tab                                gpt-4o · Medium'
const DRAFT_BAND =
  ' @ files · # issues                                                                 gpt-4o'

/** 会話(above)・入力欄の中(input)・帯(band)から、入力欄のある手書きの画面を作る */
const boxScreen = (
  above: readonly string[],
  input: readonly string[],
  band: readonly string[]
): ViewportLine[] => screenFromTexts([...above, RULE, ...input, RULE, ...band])

/** 台帳の画面の各行を列の数まで空白で埋める(アプリの画面の lineText と同じ形) */
const padded = (name: CopilotInputScreenName): ViewportLine[] => {
  const { cols, lines } = copilotInputScreen(name)
  return lines.map((line) => makeLine(lineText(line).padEnd(cols, ' ')))
}

const boxOf = (lines: readonly ViewportLine[]): ReturnType<typeof locateCopilotInputBox> =>
  locateCopilotInputBox(copilotScreenTexts(lines))

// 記録のスクリプト(scenarios2.js)で貼った本文
const numbered = (n: number, prefix: string): string =>
  Array.from({ length: n }, (_, k) => `${prefix}${k + 1}`).join('\n')
const tokens = (n: number): string => {
  let s = ''
  let k = 0
  while (s.length < n) s += 'T' + String(k++).padStart(5, '0') + '.'
  return s.slice(0, n - 4) + 'BEND'
}

describe('copilot の入力欄の台帳(記録した画面の活動と入力欄)', () => {
  it.each(Object.entries(EXPECTED))('%s', (name, [activity, state]) => {
    const { lines } = copilotInputScreen(name as CopilotInputScreenName)
    expect(classifyCopilotScreen(lines)).toBe(activity)
    expect(readCopilotInputState(lines)).toBe(state)
  })

  it('台帳のすべての画面が、活動と入力欄の両方の期待を持つ', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(data.screens).sort())
  })

  it('各行を列の数まで空白で埋めても結果が変わらない(empty・fold10)', () => {
    expect(readCopilotInputState(padded('empty'))).toBe('empty')
    expect(readCopilotInputState(padded('fold10'))).toBe('draft')
    expect(isCopilotPasteEchoed(padded('fold10'), numbered(10, 'L10-'))).toBe(true)
  })
})

describe('locateCopilotInputBox(記号と入力欄の行)', () => {
  it.each<[CopilotInputScreenName, string, string[]]>([
    ['empty', 'prompt', ['']],
    ['multiPasted', 'prompt', ['first line', 'second line', 'third line']],
    ['shellDraft', 'shell', ['echo hi']],
    ['shellEmpty', 'shell', ['Execute shell command']],
    // 入力欄の高さの上限を超えた分は入力欄の中でスクロールし、❯ は見えている最初の行に付く(記録の 7)
    ['tallPaste9', 'prompt', ['N6', 'N7', 'N8', 'N9']],
    ['fold11', 'prompt', ['[Paste #1 - 11 lines]']],
    ['newlinesPasted', 'prompt', ['', '']]
  ])('%s: 記号は %s、行は %j', (name, symbol, rows) => {
    expect(boxOf(copilotInputScreen(name).lines)).toMatchObject({ symbol, rows })
  })

  it('--screen-reader の記号の行(段階 2a の台帳の srIdleDraft)は screen-reader で、記号の後ろが行になる', () => {
    expect(boxOf(copilotScreen('srIdleDraft').lines)).toMatchObject({
      symbol: 'screen-reader',
      rows: ['hello there']
    })
  })

  it('入力欄が無い画面は null', () => {
    expect(boxOf(copilotInputScreen('shellSpaces').lines)).toBeNull()
    expect(boxOf([])).toBeNull()
  })
})

describe('送れたことの確かめに使う判定(Enter の後の列)', () => {
  it.each<CopilotInputSequenceName>(['aeInstant', 'aeFirst300', 'aeFirst2000'])(
    '%s: 最初の列(本文が残る)は偽、100ms までのどれかの列で真',
    (name) => {
      const frames = copilotInputSequence(name)
      expect(isCopilotSubmitConfirmed(frames[0].lines)).toBe(false)
      expect(frames.some((frame) => frame.dt <= 100 && isCopilotSubmitConfirmed(frame.lines))).toBe(
        true
      )
    }
  )

  it('aeStream: 最初の列(11ms)から真(入力欄は空、帯は作業中)', () => {
    const [first] = copilotInputSequence('aeStream')
    expect(first.dt).toBe(11)
    expect(classifyCopilotScreen(first.lines)).toBe('working')
    expect(isCopilotSubmitConfirmed(first.lines)).toBe(true)
  })

  it('Enter が補完の確定に取られた後の入力欄(atEnter・atref1Enter1・atref1hEnter1・atref5Enter1)は偽', () => {
    for (const name of ['atEnter', 'atref1Enter1', 'atref1hEnter1', 'atref5Enter1'] as const) {
      expect(isCopilotSubmitConfirmed(copilotInputScreen(name).lines)).toBe(false)
    }
  })
})

describe('一時的な帯の列(保留の上限 2,500ms より前に空に戻る)', () => {
  it.each<[CopilotInputSequenceName, string]>([
    ['escRewindBand', 'esc again to rewind'],
    ['ctrlcBand', 'ctrl+c again to exit']
  ])('%s: 帯が「%s」の列は undetermined、帯が戻った最後の列は empty', (name, band) => {
    const frames = copilotInputSequence(name)
    const transient = frames.filter((frame) =>
      frame.lines.some((line) => lineText(line).includes(band))
    )
    expect(transient.length).toBeGreaterThan(0)
    for (const frame of transient) expect(readCopilotInputState(frame.lines)).toBe('undetermined')
    const last = frames[frames.length - 1]
    expect(transient).not.toContain(last)
    expect(readCopilotInputState(last.lines)).toBe('empty')
    // copilotPromptSend.ts の COPILOT_INPUT_STATE_TIMEOUT_MS(2,500ms)
    expect(last.dt).toBeLessThan(2_500)
  })
})

describe('isCopilotPasteEchoed(記録した画面と、記録のスクリプトで貼った本文)', () => {
  it.each<[CopilotInputScreenName, string]>([
    ['multiPasted', 'first line\nsecond line\nthird line'],
    ['fold10', numbered(10, 'L10-')],
    ['fold11', numbered(11, 'L11-')],
    ['long5000', 'x'.repeat(4990) + 'ENDMARK'],
    ['inline20480', tokens(20480)],
    ['saved20481', tokens(20481)],
    ['ja6800', '漢'.repeat(6796) + 'JEND'],
    ['huge', 'h'.repeat(199995) + 'HEND'],
    // 入力欄の先頭の行が見えない(最後の行で見る)
    ['tallPaste9', numbered(9, 'N')],
    ['tallPaste30', numbered(30, 'P')],
    ['tallPaste5000', 'w'.repeat(4995) + 'WEND'],
    ['atref1Paste', '本文\n\n- @file.txt'],
    // アプリの参照の添付の形
    ['atref1hPaste', '本文\n\n参照:\n- @file.txt'],
    // 末尾に足した空白を含む本文でも、含まない本文でも真
    ['atref2Paste', '本文\n\n- @file.txt '],
    ['atref2Paste', '本文\n\n- @file.txt'],
    ['atref3Paste', '本文\n\n- @file.txt\n'],
    ['atref4Paste', '本文\n\n- @nofile.txt'],
    ['atref5Paste', '本文\n\n- @file.txt\n- @file2.txt'],
    ['atref8Paste', '本文\n\n- @file.txt\n- @file2.txt '],
    ['atref8Paste', '本文\n\n- @file.txt\n- @file2.txt']
  ])('%s に貼った本文は現れた(真)', (name, text) => {
    expect(isCopilotPasteEchoed(copilotInputScreen(name).lines, text)).toBe(true)
  })

  it.each<[CopilotInputScreenName, string]>([
    // 入力欄が空
    ['empty', 'first line\nsecond line\nthird line'],
    ['afterTurnEmpty', 'first line\nsecond line\nthird line'],
    // 記号が !(シェルのモード)
    ['shellDraft', 'echo hi'],
    // 入力欄の本文と違う本文
    ['multiPasted', 'another prompt']
  ])('%s に対して %j は現れていない(偽)', (name, text) => {
    expect(isCopilotPasteEchoed(copilotInputScreen(name).lines, text)).toBe(false)
  })
})

describe('手書きの画面(段階 2a・2b の台帳に無い形)', () => {
  it('--screen-reader の空の入力欄(Start of Prompt Indicator と空の入力欄の帯)は empty', () => {
    expect(readCopilotInputState(boxScreen([], ['Start of Prompt Indicator'], [IDLE_BAND]))).toBe(
      'empty'
    )
  })

  it('--screen-reader の書きかけ(Start of Prompt Indicatorhello)は draft で、本文 hello の echo は真', () => {
    const screen = boxScreen([], ['Start of Prompt Indicatorhello'], [DRAFT_BAND])
    expect(readCopilotInputState(screen)).toBe('draft')
    expect(isCopilotPasteEchoed(screen, 'hello')).toBe(true)
  })

  it('帯が空の入力欄の形なのに、入力欄が 2 行で文字が無い → undetermined', () => {
    expect(readCopilotInputState(boxScreen([], ['❯', ''], [IDLE_BAND]))).toBe('undetermined')
  })

  it('帯が空(描き直しの途中)→ undetermined', () => {
    expect(readCopilotInputState(boxScreen([], ['❯'], []))).toBe('undetermined')
  })

  it('入力欄の上の会話に本文と同じ文字があっても、入力欄が空なら echo は偽(入力欄の中だけで見る)', () => {
    const screen = boxScreen([' ❯ hello world'], ['❯'], [IDLE_BAND])
    expect(readCopilotInputState(screen)).toBe('empty')
    expect(isCopilotPasteEchoed(screen, 'hello world')).toBe(false)
  })

  // 入力欄の行と本文の行は、タブを空白にし、連続する空白を 1 つにし、前後の空白を除いてから比べる(設計書 2026-10-22
  // 「入力欄の特定と読み取り」の isCopilotPasteEchoed。端末はタブを空白の並びとして描く)
  it('本文の行のタブ・連続する空白は、入力欄の行の空白の並びと 1 つの空白として比べる(echo は真)', () => {
    const screen = boxScreen([], ['❯ first line', '  run    the   tests'], [DRAFT_BAND])
    expect(isCopilotPasteEchoed(screen, 'first line\nrun\tthe tests')).toBe(true)
    expect(isCopilotPasteEchoed(screen, 'first line\nrun the\t\ttests')).toBe(true)
    expect(isCopilotPasteEchoed(screen, 'first line\nrun the other tests')).toBe(false)
  })

  it('記号の行の末尾に空白が残る入力欄(❯ と空白。段階 0 の記録で Esc 2 回の後に見えた残骸)は empty', () => {
    const screen = [RULE, '❯    ', RULE, IDLE_BAND].map((text) => makeLine(text))
    expect(readCopilotInputState(screen)).toBe('empty')
  })

  it('空の画面・入力欄の無い画面は not-found で、echo は偽(例外を投げない)', () => {
    expect(readCopilotInputState([])).toBe('not-found')
    expect(isCopilotPasteEchoed([], 'hello')).toBe(false)
  })
})

describe('段階 2a の台帳の画面の入力欄', () => {
  it.each<[CopilotScreenName, CopilotInputState]>([
    ['idle', 'empty'],
    ['idle80', 'empty'],
    // 40 列の段組みで折り返した帯(`← open     · / commands · ? help · tab` / `sidebar       next tab`)
    ['idle40', 'empty'],
    // `esc again to clear input` の間でも、書きかけが見えていれば draft
    ['draftEsc', 'draft'],
    ['rewindHint', 'undetermined'],
    ['help', 'undetermined'],
    // `/` の一覧の候補(`/add-dir`)が入力欄に入っている
    ['slashList', 'draft'],
    ['shellMode', 'shell']
  ])('%s → %s', (name, state) => {
    expect(readCopilotInputState(copilotScreen(name).lines)).toBe(state)
  })

  it('idle40 は帯をつないだ文字列で空の入力欄の形に当たり、帯の 1 行目だけには sidebar が無い', () => {
    const box = boxOf(copilotScreen('idle40').lines)
    expect(box?.band).toMatch(/^← open\b.*\/ commands\b/)
    expect(box?.bandHead).not.toContain('sidebar')
  })
})
