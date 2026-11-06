import { describe, it, expect } from 'vitest'
import { classifyCopilotScreen, locateCopilotPermissionQuestion } from '../copilotScreenActivity'
import type { AgentActivity } from '../agentActivity'
import { lineText } from '../agentViewport'
import type { ViewportLine } from '../agentViewport'
import { makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import data from './fixtures/copilotScreens.json'
import { copilotScreenTexts } from '../copilotInputBox'

// 記録済みの画面(GitHub Copilot CLI 1.0.87。設計書 2026-10-21「実装の最初に確かめること」4)ごとの期待。台帳に画面が増えたら、
// ここに足さないと最後のテストが落ちる
const EXPECTED: Record<AgentActivity, readonly CopilotScreenName[]> = {
  working: [
    'working250',
    'working3000',
    'beforeFirstToken',
    'reasoning',
    'workingDraft',
    'afterEscWorking',
    'afterEscWorking1500',
    'toolRunning',
    'afterEscToolRunning',
    // キューの指示がある作業中と、中断の後にキューの指示が送られて作業中に戻った画面(既知の制約)
    'pending',
    'ctrlqQueued',
    'interruptedPendingSent',
    'working80',
    'resized60',
    'working40',
    'srWorking',
    'srAfterEsc'
  ],
  idle: [
    'idle',
    'idleDraft',
    'interrupted',
    'interruptedDraft',
    'done',
    'reasoningDone',
    'toolDone',
    'afterEscPermission',
    'afterEscEscPermission',
    'interruptedToolRunning',
    'draftEsc',
    'rewindHint',
    'help',
    'ctrlcWorking',
    'ctrlcDraft',
    'paste12',
    'multiline',
    'shellMode',
    'slashList',
    'idle80',
    'idle40',
    'srIdleDraft'
  ],
  permission: ['permission', 'permissionDown', 'permission3', 'srPermission', 'srPermissionDown'],
  confirm: ['trust', 'rewindPicker', 'srTrust'],
  unknown: ['exited']
}

const RULE = '─'.repeat(100)
const HINT = '↑/↓ to navigate · enter to select · esc to cancel'
const IDLE_BAND =
  ' ← open sidebar · / commands · ? help · tab next tab                                gpt-4o · Medium'
const WORKING_BAND = ' ◎ Working · 18 B esc interrupt'
const FRAME_TOP = `╭${'─'.repeat(98)}╮`
const FRAME_BOTTOM = `╰${'─'.repeat(98)}╯`

/** 会話(above)・入力欄の中(input)・帯(band)から、入力欄のある手書きの画面を作る */
const boxScreen = (
  above: readonly string[],
  input: readonly string[],
  band: readonly string[]
): ViewportLine[] => [...above, RULE, ...input, RULE, ...band].map((text) => makeLine(text))

/** 入力欄の無い手書きの画面 */
const plainScreen = (texts: readonly string[]): ViewportLine[] =>
  texts.map((text) => makeLine(text))

/** 台帳の画面の各行を列の数まで空白で埋める(アプリの画面の lineText と同じ形) */
const padded = (name: CopilotScreenName): ViewportLine[] => {
  const { cols, lines } = copilotScreen(name)
  return lines.map((line) => makeLine(lineText(line).padEnd(cols, ' ')))
}

describe('classifyCopilotScreen(記録した画面)', () => {
  for (const [activity, names] of Object.entries(EXPECTED) as [
    AgentActivity,
    readonly CopilotScreenName[]
  ][]) {
    it.each(names)(`${activity}: %s`, (name) => {
      expect(classifyCopilotScreen(copilotScreen(name).lines)).toBe(activity)
    })
  }

  it('台帳のすべての画面が、どれかの期待に入っている', () => {
    const listed = Object.values(EXPECTED).flat()
    expect([...listed].sort()).toEqual(Object.keys(data.screens).sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('各行を列の数まで空白で埋めても判定が変わらない(作業中・入力待ち)', () => {
    expect(classifyCopilotScreen(padded('working3000'))).toBe('working')
    expect(classifyCopilotScreen(padded('idle'))).toBe('idle')
  })

  it('空の画面・すべて空白の画面は unknown(例外を投げない)', () => {
    expect(classifyCopilotScreen([])).toBe('unknown')
    expect(
      classifyCopilotScreen(plainScreen(Array.from({ length: 5 }, () => ' '.repeat(40))))
    ).toBe('unknown')
  })
})

describe('classifyCopilotScreen(手書きの画面。分からない画面の扱い)', () => {
  it('帯の中断の案内が 2 行に折り返されても(◎ Working · 18 B esc / interrupt)、つないで working', () => {
    expect(
      classifyCopilotScreen(
        boxScreen([' ● word0'], ['❯'], [' ◎ Working · 18 B esc', ' interrupt', ' gpt-4o · Medium'])
      )
    ).toBe('working')
  })

  it('罫線が列の数より短い画面(広げた直後で描き直す前)を列の数まで空白で埋めても、入力欄を見つけて判定する', () => {
    const narrowRule = '─'.repeat(60)
    const screen = [' ● word0', narrowRule, '❯', narrowRule, WORKING_BAND].map((text) =>
      makeLine(text.padEnd(100, ' '))
    )
    expect(classifyCopilotScreen(screen)).toBe('working')
  })

  it('帯の中断の案内の語の間に空白が続いても(esc    interrupt)、1 つにつないで working', () => {
    expect(
      classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], [' ◎ Working · 18 B esc    interrupt']))
    ).toBe('working')
  })

  it('帯がスピナーで始まり中断の案内が無ければ unknown(入力待ちにしない)', () => {
    expect(
      classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], [' ◎ Thinking · 18 B         gpt-4o']))
    ).toBe('unknown')
  })

  it('--screen-reader の形(スピナーが空白)で中断の案内が無ければ idle(既知の制約の固定)', () => {
    expect(
      classifyCopilotScreen(
        boxScreen(['  word0'], ['Start of Prompt Indicator'], ['  Thinking · 18 B         gpt-4o'])
      )
    ).toBe('idle')
  })

  it.each([
    ' ● The band shows esc interrupt while working',
    ' ● Then esc again to interrupt appears'
  ])('入力欄の上の会話に中断の案内と同じ文字(%s)があっても、帯が入力待ちなら idle', (line) => {
    expect(classifyCopilotScreen(boxScreen([line], ['❯'], [IDLE_BAND]))).toBe('idle')
  })

  it('入力欄が無く、会話に全幅の罫線と esc interrupt があっても working にしない(unknown)', () => {
    expect(
      classifyCopilotScreen(plainScreen([' ● output', RULE, ' ● esc interrupt', ' ● more']))
    ).toBe('unknown')
  })

  it('会話の 2 本の全幅の罫線の間が入力欄の記号の行で始まらなければ入力欄とみなさず、下の esc interrupt で working にしない(unknown)', () => {
    expect(
      classifyCopilotScreen(plainScreen([RULE, ' ● table row', RULE, ' ● esc interrupt']))
    ).toBe('unknown')
  })

  it('2 本の全幅の罫線の間の 2 行目以降が字下げの続きの行でなければ入力欄とみなさず、下の esc interrupt で working にしない(unknown)', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([RULE, '❯ fix the parser', ' ● output', RULE, WORKING_BAND])
      )
    ).toBe('unknown')
  })

  it('シェル以外の許可の見込みの画面(枠の中の Do you want to edit this file? と選択の案内)は permission', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([
          FRAME_TOP,
          '│ Edit file',
          '│ Do you want to edit this file?',
          '│ ❯ 1. Yes',
          '│   2. No',
          `│ ${HINT}`,
          FRAME_BOTTOM
        ])
      )
    ).toBe('permission')
  })

  it('問いの無い選択の画面は confirm', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([FRAME_TOP, '│ Pick one', '│ ❯ 1. A', `│ ${HINT}`, FRAME_BOTTOM])
      )
    ).toBe('confirm')
  })

  it('選択の案内の上に Do you want to があっても、間に行頭の ╭ の行があれば(別の枠・会話の中の問い)confirm', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([
          '│ Do you want to edit this file?',
          FRAME_BOTTOM,
          FRAME_TOP,
          '│ Pick one',
          '│ ❯ 1. A',
          `│ ${HINT}`,
          FRAME_BOTTOM
        ])
      )
    ).toBe('confirm')
  })

  it('行頭の ╭ の無い選択の画面(--screen-reader の形)では、離れた上の会話の Do you want to も問いとして拾い permission(既知の制約の固定)', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([
          ' ● I can rename the function.',
          '  Do you want to keep the old name as an alias?',
          '',
          ' ● Renamed it.',
          '',
          ' ● Which file should I open next?',
          '',
          'Pick one',
          '❯ 1. A',
          '  2. B',
          HINT
        ])
      )
    ).toBe('permission')
  })

  it('入力欄があり、その上に選択の案内がある画面は confirm', () => {
    expect(
      classifyCopilotScreen(boxScreen(['│ Pick one', '│ ❯ 1. A', `│ ${HINT}`], ['❯'], [IDLE_BAND]))
    ).toBe('confirm')
  })

  it('選択の案内が下の罫線より下(帯の領域)にある画面は confirm', () => {
    expect(
      classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], [' Pick one: ❯ 1. A', ` ${HINT}`]))
    ).toBe('confirm')
  })

  it('入力欄があり、その上に Do you want to …? の問いと選択の案内があっても permission にしない(confirm)', () => {
    expect(
      classifyCopilotScreen(
        boxScreen(
          ['│ Do you want to edit this file?', '│ ❯ 1. Yes', `│ ${HINT}`],
          ['❯'],
          [IDLE_BAND]
        )
      )
    ).toBe('confirm')
  })

  it('帯が空の画面(描き直しの途中)は unknown', () => {
    expect(classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], []))).toBe('unknown')
  })

  it('上の罫線が見えない画面(入力欄が画面の高さを超えた書きかけ)は unknown', () => {
    expect(
      classifyCopilotScreen(plainScreen(['  more draft', '  more draft', RULE, IDLE_BAND]))
    ).toBe('unknown')
  })

  it('入力欄の上の会話に選択の案内の文字があれば、帯に esc interrupt があっても confirm(既知の制約の固定)', () => {
    expect(
      classifyCopilotScreen(boxScreen([` ● The dialog says ${HINT}`], ['❯'], [WORKING_BAND]))
    ).toBe('confirm')
  })

  it('書きかけ(入力欄の中)の選択の案内の文字は見ない: 帯が入力待ちなら idle、帯に esc interrupt があれば working', () => {
    const draft = [`❯ copy this: ${HINT}`, `  ${HINT}`]
    expect(classifyCopilotScreen(boxScreen([' ● word0'], draft, [' @ files · # issues']))).toBe(
      'idle'
    )
    expect(
      classifyCopilotScreen(
        boxScreen([' ● word0'], draft, [' ◎ Working · 18 B esc interrupt · ctrl+q enqueue'])
      )
    ).toBe('working')
  })
})

describe('locateCopilotPermissionQuestion', () => {
  it('記録の permission の画面で、案内の行と問いの行を返す', () => {
    expect(
      locateCopilotPermissionQuestion(copilotScreenTexts(copilotScreen('permission').lines))
    ).toEqual({ hintRow: 28, questionRow: 23 })
  })

  it('入力待ちの画面では null', () => {
    expect(
      locateCopilotPermissionQuestion(copilotScreenTexts(copilotScreen('idle').lines))
    ).toBeNull()
  })

  it('問いの無い選択の画面が上にあっても、下の許可の確認を返す', () => {
    const real = copilotScreenTexts(copilotScreen('permission').lines)
    const texts = ['╭──', '│ Pick one', '↑↓ to navigate · enter to select', ...real]
    expect(locateCopilotPermissionQuestion(texts)).toEqual({ hintRow: 31, questionRow: 26 })
  })
})
