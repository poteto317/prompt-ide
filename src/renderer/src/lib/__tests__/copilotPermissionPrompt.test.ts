import { describe, it, expect } from 'vitest'
import { readCopilotPermissionPrompt } from '../copilotPermissionPrompt'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import { findAgentPermissionOption } from '../agentPermissionPrompt'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'
import type { ViewportLine } from '../agentViewport'
import { makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import copilotScreensData from './fixtures/copilotScreens.json'

const NO_OPTION = 'No, and tell Copilot what to do differently (Esc to stop)'

/** 手書きの copilot の許可の画面(外枠の中に本文・問い・選択肢・案内)。右の枠は省く(読み取りは行末の枠と空白を除く) */
function copilotPrompt(
  optionRows: readonly string[],
  questionRows: readonly string[] = ['Do you want to run this command?']
): ViewportLine[] {
  return [
    '╭────────────────────────────────────────╮',
    '│ Run a command',
    '│ sleep 3',
    '│',
    ...questionRows.map((row) => `│ ${row}`),
    '│',
    ...optionRows.map((row) => `│ ${row}`),
    '│',
    '│ ↑/↓ to navigate · enter to select · esc to cancel',
    '╰────────────────────────────────────────╯'
  ].map((row) => makeLine(row))
}

const read = (lines: readonly ViewportLine[]): AgentPermissionPrompt => {
  expect(classifyCopilotScreen(lines)).toBe('permission')
  const prompt = readCopilotPermissionPrompt(lines)
  expect(prompt).not.toBeNull()
  return prompt as AgentPermissionPrompt
}

describe('readCopilotPermissionPrompt: 記録の画面(台帳での読み取りの期待)', () => {
  it.each([
    ['permission', 1, true],
    ['permissionDown', 2, false]
  ] as const)(
    '%s: 本文 2 行・2 つの選択肢・カーソル %d・番号キー %s・許可 1・拒否 2',
    (name, cursor, keys) => {
      const prompt = read(copilotScreen(name).lines)
      expect(prompt.body).toEqual(['Write a file', 'echo hi > out.txt'])
      expect(prompt.question).toEqual(['Do you want to run this command?'])
      expect(prompt.options).toEqual([
        { number: 1, text: 'Yes' },
        { number: 2, text: NO_OPTION }
      ])
      expect(prompt.cursorNumber).toBe(cursor)
      expect(prompt.numberKeysAccepted).toBe(keys)
      expect(findAgentPermissionOption(prompt, 'allow')?.number).toBe(1)
      expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(2)
    }
  )

  it('permission3: 本文 Wait a bit・sleep 8、3 つの選択肢、許可 1・拒否 3', () => {
    const prompt = read(copilotScreen('permission3').lines)
    expect(prompt.body).toEqual(['Wait a bit', 'sleep 8'])
    expect(prompt.options.map((option) => option.number)).toEqual([1, 2, 3])
    expect(prompt.options[1].text).toMatch(
      /^Yes, and don't ask again for `sleep` in this directory/
    )
    expect(prompt.options[2].text).toBe(NO_OPTION)
    expect(prompt.cursorNumber).toBe(1)
    expect(prompt.numberKeysAccepted).toBe(true)
    expect(findAgentPermissionOption(prompt, 'allow')?.number).toBe(1)
    expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(3)
  })

  it.each([
    ['srPermission', 1, true],
    ['srPermissionDown', 2, false]
  ] as const)(
    '%s(読み上げのモード): 本文は内側のコマンドの枠の中だけ・カーソル %d・番号キー %s',
    (name, cursor, keys) => {
      const prompt = read(copilotScreen(name).lines)
      expect(prompt.body).toEqual(['echo hi > out.txt'])
      expect(prompt.question).toEqual(['Do you want to run this command?'])
      expect(prompt.options).toEqual([
        { number: 1, text: 'Yes' },
        { number: 2, text: NO_OPTION }
      ])
      expect(prompt.cursorNumber).toBe(cursor)
      expect(prompt.numberKeysAccepted).toBe(keys)
      // 外枠が無く、内側のコマンドの枠の ╭ が本文の上の端になる
      expect(prompt.bodyStartVisible).toBe(true)
    }
  )

  it('台帳のどの画面でも、読み取れたなら本文の上の端(行頭の ╭)が画面にある', () => {
    const names = Object.keys(copilotScreensData.screens) as CopilotScreenName[]
    const readable = names.filter(
      (name) => readCopilotPermissionPrompt(copilotScreen(name).lines) !== null
    )
    expect(readable).toEqual(
      expect.arrayContaining([
        'permission',
        'permissionDown',
        'permission3',
        'srPermission',
        'srPermissionDown'
      ])
    )
    for (const name of readable) {
      expect(readCopilotPermissionPrompt(copilotScreen(name).lines)?.bodyStartVisible).toBe(true)
    }
  })

  it('許可待ちでない画面(入力待ち・作業中・フォルダの信頼の確認)は null', () => {
    expect(readCopilotPermissionPrompt(copilotScreen('idle').lines)).toBeNull()
    expect(readCopilotPermissionPrompt(copilotScreen('working250').lines)).toBeNull()
    expect(readCopilotPermissionPrompt(copilotScreen('trust').lines)).toBeNull()
  })
})

describe('readCopilotPermissionPrompt: 手書きの画面', () => {
  it('本文の上の端(行頭の ╭)が画面の上へ流れて無い → 画面の先頭からを本文として読み、bodyStartVisible は偽', () => {
    // ターミナルを低くした・本文が長いときの画面。外枠の上の角の行が流れ、本文の途中の行から画面が始まる
    const lines = copilotPrompt(['❯ 1. Yes', `  2. ${NO_OPTION}`]).slice(2)
    const prompt = read(lines)
    expect(prompt.body).toEqual(['sleep 3'])
    expect(prompt.bodyStartVisible).toBe(false)
  })

  it('行頭の ╭ がある手書きの画面は bodyStartVisible が真', () => {
    expect(read(copilotPrompt(['❯ 1. Yes', `  2. ${NO_OPTION}`])).bodyStartVisible).toBe(true)
  })

  it('選択肢の折り返しの行は、直前の選択肢の文言に半角空白 1 つでつなぐ', () => {
    const prompt = read(
      copilotPrompt([
        '❯ 1. Yes',
        '  2. No, and tell Copilot what to do',
        '     differently (Esc to stop)'
      ])
    )
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes' },
      { number: 2, text: NO_OPTION }
    ])
    expect(prompt.body).toEqual(['Run a command', 'sleep 3'])
  })

  it('途中の選択肢の折り返しの行は、その選択肢の文言につなぎ、次の選択肢の行で次の選択肢を始める', () => {
    const prompt = read(
      copilotPrompt([
        '❯ 1. Yes, and run it',
        '     right away',
        `  2. ${NO_OPTION}`,
        '  3. Something else'
      ])
    )
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes, and run it right away' },
      { number: 2, text: NO_OPTION },
      { number: 3, text: 'Something else' }
    ])
  })

  it('読み上げのモードの印(Current selection: )の行がカーソルの行', () => {
    const prompt = read(copilotPrompt(['  1. Yes', `Current selection: 2. ${NO_OPTION}`]))
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('最初の選択肢の行より前の、選択肢でない行は問いの折り返し', () => {
    const prompt = read(
      copilotPrompt(['❯ 1. Yes', `  2. ${NO_OPTION}`], ['Do you want to run this', 'long command?'])
    )
    expect(prompt.question).toEqual(['Do you want to run this', 'long command?'])
  })

  it('カーソルが最後でも 1 番でもない選択肢(3 つのうち 2) → 番号キーが効く・拒否 3', () => {
    const prompt = read(
      copilotPrompt([
        '  1. Yes',
        "❯ 2. Yes, and don't ask again for `sleep` in this directory",
        `  3. ${NO_OPTION}`
      ])
    )
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(true)
    expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(3)
  })

  it('入力欄に文を入れた最後の選択肢(文言が No で始まらない) → 拒否は null・番号キーが効かない', () => {
    const prompt = read(copilotPrompt(['  1. Yes', '❯ 2. Do nothing and stop']))
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(false)
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })

  it('カーソルの行が無い → null', () => {
    expect(readCopilotPermissionPrompt(copilotPrompt(['  1. Yes', `  2. ${NO_OPTION}`]))).toBeNull()
  })
})
