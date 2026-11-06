import { describe, it, expect } from 'vitest'
import { readClaudePermissionPrompt } from '../claudePermissionPrompt'
import { classifyClaudeScreen } from '../claudeScreenActivity'
import { findAgentPermissionOption } from '../agentPermissionPrompt'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'
import type { ViewportLine } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'
import agentScreensData from './fixtures/agentScreens.json'

const linesOf = (rows: readonly string[]): ViewportLine[] => rows.map((row) => makeLine(row))

interface HandScreenOptions {
  question?: readonly string[]
  hint?: string
}

/**
 * 手書きの claude の許可の画面。1 行目の全幅の罫線より下が許可の画面(入力欄の罫線の組にならないよう罫線は 1 本だけ)。
 * 既定は記録の画面と同じく案内が ` Esc to cancel · Tab to amend`
 */
function claudePrompt(
  options: readonly string[],
  {
    question = [' Do you want to proceed?'],
    hint = ' Esc to cancel · Tab to amend'
  }: HandScreenOptions = {}
): ViewportLine[] {
  return linesOf([
    '─'.repeat(60),
    ' Bash command',
    ' sleep 3',
    '',
    ...question,
    ...options,
    '',
    hint
  ])
}

const read = (lines: readonly ViewportLine[]): AgentPermissionPrompt => {
  // 手書きの画面が許可待ちの画面であることを先に確かめる(読み取りは判定が permission のときだけ値を返す)
  expect(classifyClaudeScreen(lines)).toBe('permission')
  const prompt = readClaudePermissionPrompt(lines)
  expect(prompt).not.toBeNull()
  return prompt as AgentPermissionPrompt
}

describe('readClaudePermissionPrompt: 記録の画面(台帳での読み取りの期待)', () => {
  it.each(['permission', 'permissionAfterClear'] as const)(
    '%s: 本文・問い・4 つの選択肢・カーソル 1・番号キーが効く・許可 1・拒否 4',
    (name) => {
      const prompt = read(agentScreen(name).lines)
      expect(prompt.body).toEqual([
        'Bash command',
        'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
        'fake',
        'echo hi > out.txt'
      ])
      expect(prompt.question).toEqual(['Do you want to proceed?'])
      expect(prompt.options.map((option) => option.number)).toEqual([1, 2, 3, 4])
      expect(prompt.options[0].text).toBe('Yes')
      // 2 番は 2 行に折り返した文言を、字下げを除いて半角空白 1 つでつなぐ
      expect(prompt.options[1].text).toMatch(
        /^Yes, and always allow access to \S+ \S+ from this project$/
      )
      expect(prompt.options[2].text).toBe(
        'Yes, and switch to auto mode · auto mode handles these prompts for you'
      )
      expect(prompt.options[3].text).toBe('No')
      expect(prompt.cursorNumber).toBe(1)
      expect(prompt.numberKeysAccepted).toBe(true)
      expect(prompt.bodyStartVisible).toBe(true)
      expect(findAgentPermissionOption(prompt, 'allow')?.number).toBe(1)
      expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(4)
    }
  )

  it('台帳のどの画面でも、読み取れたなら本文の上の端(全幅の罫線)が画面にある', () => {
    const names = Object.keys(agentScreensData.screens) as AgentScreenName[]
    const readable = names.filter(
      (name) => readClaudePermissionPrompt(agentScreen(name).lines) !== null
    )
    expect(readable).toEqual(['permission', 'permissionAfterClear'])
    for (const name of readable) {
      expect(readClaudePermissionPrompt(agentScreen(name).lines)?.bodyStartVisible).toBe(true)
    }
  })

  it('許可待ちでない画面(入力待ち・作業中・確認待ち)は null', () => {
    expect(readClaudePermissionPrompt(agentScreen('empty').lines)).toBeNull()
    expect(readClaudePermissionPrompt(agentScreen('working').lines)).toBeNull()
    expect(readClaudePermissionPrompt(agentScreen('trust').lines)).toBeNull()
  })
})

describe('readClaudePermissionPrompt: 手書きの画面', () => {
  it('本文の上の端(全幅の罫線)が画面の上へ流れて無い → 画面の先頭からを本文として読み、bodyStartVisible は偽', () => {
    // ターミナルを低くした・本文が長いときの画面。罫線が流れ、本文の途中の行から画面が始まる
    const prompt = read(
      linesOf([
        ' cat <<EOF > script.sh',
        ' rm -rf build',
        '',
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   2. No',
        '',
        ' Esc to cancel · Tab to amend'
      ])
    )
    expect(prompt.body).toEqual(['cat <<EOF > script.sh', 'rm -rf build'])
    expect(prompt.bodyStartVisible).toBe(false)
  })

  it('上の罫線が流れ、本文の中に字下げした ─ だけの行がある → その行を端とせず、画面の先頭から本文として読み、bodyStartVisible は偽', () => {
    // heredoc で書く Markdown の区切り(` ────────`)は本文の行。上の端は字下げの無い全幅の罫線だけ
    const prompt = read(
      linesOf([
        ' rm -rf ~/important',
        " cat > notes.md <<'EOF'",
        ' # Title',
        ' ────────',
        ' body',
        ' EOF',
        '╌'.repeat(60),
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   2. No',
        '',
        ' Esc to cancel · Tab to amend'
      ])
    )
    expect(prompt.body).toEqual([
      'rm -rf ~/important',
      "cat > notes.md <<'EOF'",
      '# Title',
      'body',
      'EOF'
    ])
    expect(prompt.bodyStartVisible).toBe(false)
  })

  it('全部見えていて本文の中に字下げした ─ だけの行がある → 上の罫線の下から本文を全部読み、bodyStartVisible は真', () => {
    const prompt = read(
      linesOf([
        '─'.repeat(60),
        ' Bash command',
        ' rm -rf ~/important',
        " cat > notes.md <<'EOF'",
        ' ────────',
        ' body',
        ' EOF',
        '',
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   2. No',
        '',
        ' Esc to cancel · Tab to amend'
      ])
    )
    expect(prompt.body).toEqual([
      'Bash command',
      'rm -rf ~/important',
      "cat > notes.md <<'EOF'",
      'body',
      'EOF'
    ])
    expect(prompt.bodyStartVisible).toBe(true)
  })

  it('全幅の罫線がある手書きの画面は bodyStartVisible が真', () => {
    expect(read(claudePrompt([' ❯ 1. Yes', '   2. No'])).bodyStartVisible).toBe(true)
  })

  it('問いが 2 行に折り返しても、問いの行を 2 つ読む', () => {
    const prompt = read(
      claudePrompt([' ❯ 1. Yes', '   2. No'], {
        question: [' Do you want to make this edit to', ' a-very-long-file-name-for-wrapping.md?']
      })
    )
    expect(prompt.question).toEqual([
      'Do you want to make this edit to',
      'a-very-long-file-name-for-wrapping.md?'
    ])
    expect(prompt.body).toEqual(['Bash command', 'sleep 3'])
  })

  it('カーソルが 2 番(Yes・No 以外)で Tab to amend が無い → 番号キーが効かない', () => {
    const prompt = read(
      claudePrompt(['   1. Yes', " ❯ 2. Yes, and don't ask again for: sleep", '   3. No'], {
        hint: ' Esc to cancel'
      })
    )
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが 2 番(Yes・No 以外)なら、Tab to amend があっても番号キーが効かない', () => {
    const prompt = read(
      claudePrompt(['   1. Yes', " ❯ 2. Yes, and don't ask again for: sleep", '   3. No'])
    )
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが 1 番でも Tab to amend が無い(入力の形・読み上げのモード) → 番号キーが効かない', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. No'], { hint: ' Esc to cancel' }))
    expect(prompt.cursorNumber).toBe(1)
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが No にあって Tab to amend がある → 番号キーが効く', () => {
    const prompt = read(claudePrompt(['   1. Yes', ' ❯ 2. No']))
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(true)
  })

  it('カーソルが `No, and tell Claude …` にあって Tab to amend がある → 番号キーが効く', () => {
    const prompt = read(
      claudePrompt(['   1. Yes', ' ❯ 2. No, and tell Claude what to do differently (esc)'])
    )
    expect(prompt.numberKeysAccepted).toBe(true)
  })

  it('Yes が 2 つでカーソルがその 1 つにある → 番号キーが効かない(Yes・No がちょうど 1 つのときだけ当てる)', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. Yes', '   3. No']))
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが Not now にある → 番号キーが効かない(`No` の規則は `No,` か `No` そのものだけ)', () => {
    const prompt = read(claudePrompt(['   1. Yes', ' ❯ 2. Not now']))
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('選択肢が 10 ある → null(1 桁の番号で即決しない)', () => {
    const options = Array.from({ length: 10 }, (_, index) =>
      index === 0 ? ' ❯ 1. Yes' : `   ${index + 1}. Option ${index + 1}`
    )
    expect(readClaudePermissionPrompt(claudePrompt(options))).toBeNull()
  })

  it('番号が欠ける(1・3) → null', () => {
    expect(readClaudePermissionPrompt(claudePrompt([' ❯ 1. Yes', '   3. No']))).toBeNull()
  })

  it('カーソルの行が 2 つ → null', () => {
    expect(readClaudePermissionPrompt(claudePrompt([' ❯ 1. Yes', ' ❯ 2. No']))).toBeNull()
  })

  it('Yes が 2 つ → 許可の選択肢は null、拒否は 3 番', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. Yes', '   3. No']))
    expect(findAgentPermissionOption(prompt, 'allow')).toBeNull()
    expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(3)
  })

  it('No が無い → 拒否の選択肢は null', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', "   2. Yes, and don't ask again for: sleep"]))
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })

  it('Nothing で始まる選択肢は拒否にしない', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. Nothing to do']))
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })

  it('選択肢の文言が深い字下げで折り返したら、直前の選択肢の文言に半角空白でつなぐ', () => {
    const prompt = read(
      claudePrompt([
        ' ❯ 1. Yes',
        "   2. Yes, and don't ask again for",
        '      sleep commands',
        '   3. No'
      ])
    )
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes' },
      { number: 2, text: "Yes, and don't ask again for sleep commands" },
      { number: 3, text: 'No' }
    ])
  })

  it('選択肢の後の番号の桁より浅い行で選択肢の並びを終え、その行を案内の行として見る', () => {
    // 空行を挟まずに案内の行が続く画面。案内の行は選択肢にも折り返しにもならない
    const prompt = read(
      linesOf([
        '─'.repeat(60),
        ' Bash command',
        ' sleep 3',
        '',
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   2. No',
        ' Esc to cancel · Tab to amend'
      ])
    )
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes' },
      { number: 2, text: 'No' }
    ])
    expect(prompt.numberKeysAccepted).toBe(true)
  })

  it('番号の桁と同じ字下げの、番号の無い行でも選択肢の並びを終え、その行を案内の行として見る', () => {
    // 番号の桁(' ❯ ' の 3 桁)と同じ字下げの行は、折り返し(番号の桁より深い行)にならない
    const prompt = read(
      linesOf([
        '─'.repeat(60),
        ' Bash command',
        ' sleep 3',
        '',
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   2. No',
        '   Esc to cancel · Tab to amend'
      ])
    )
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes' },
      { number: 2, text: 'No' }
    ])
    expect(prompt.numberKeysAccepted).toBe(true)
  })
})
