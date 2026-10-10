import { describe, it, expect } from 'vitest'
import { classifyAgentScreen, isAgentActivityWaitingForUser } from '../agentActivity'
import type { AgentActivity } from '../agentActivity'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'
import data from './fixtures/agentScreens.json'
import { lineText as lineTextOf } from '../agentViewport'
import type { ViewportLine } from '../agentViewport'

// 記録済みの画面(claude 2.1.288)ごとの期待。台帳に画面が増えたら、ここに足さないと最後のテストが落ちる
const EXPECTED: Record<AgentActivity, readonly AgentScreenName[]> = {
  idle: [
    'empty',
    'narrowEmpty',
    'single',
    'singleCurMid',
    'multiTyped',
    'long',
    'pasted40',
    'mixed',
    'shellEmpty',
    'shellText',
    'slash',
    'echoShort',
    'echoLeadingNewline',
    'echoLongLine',
    'echoIndented',
    'echoJapanese'
  ],
  working: [
    'working',
    'workingDraft',
    'queuedEmpty',
    'streamingDraft',
    'streamingAfterClear',
    'toolrunDraft',
    'toolrunAfterClear'
  ],
  permission: ['permission', 'permissionAfterClear'],
  confirm: ['trust', 'fullscreen'],
  unknown: ['tallTyped']
}

describe('classifyAgentScreen', () => {
  for (const [activity, names] of Object.entries(EXPECTED) as [
    AgentActivity,
    readonly AgentScreenName[]
  ][]) {
    it.each(names)(`${activity}: %s`, (name) => {
      expect(classifyAgentScreen(agentScreen(name).lines)).toBe(activity)
    })
  }

  it('すべて空白の行の画面は unknown', () => {
    const lines = Array.from({ length: 10 }, () => makeLine(' '.repeat(40)))
    expect(classifyAgentScreen(lines)).toBe('unknown')
    expect(classifyAgentScreen([])).toBe('unknown')
  })

  it('ヘッダーだけの画面は unknown', () => {
    const lines = [
      makeLine(' ▐▛███▜▌   Claude Code v2.1.288'),
      makeLine('▝▜█████▛▘  Opus'),
      ...Array.from({ length: 8 }, () => makeLine(''))
    ]
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  it('字下げのある箇条書きだけの画面は working にならない', () => {
    const lines = [makeLine('  · 箇条書きの項目'), makeLine('  · 次の項目')]
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  // claude は作業を終えた後に 1 桁目から要約の行(`✻ Worked for 1m 3s`)を出す。スピナーの行とはみなさない
  it.each(['✻ Worked for 1m 3s', '✻ Cooked for 12s', '✻ Brewed for 1h 2m 3s'])(
    '入力欄のある画面に要約の行 %s があっても idle',
    (summary) => {
      const lines = [...agentScreen('empty').lines]
      lines[4] = makeLine(summary)
      expect(classifyAgentScreen(lines)).toBe('idle')
    }
  )

  // スピナーの記号の集まりは、スピナーの行と要約の行の判定で同じものを使う(片方だけ記号を足すと要約の行を working と取り違える)
  it.each([...'·✢✳✶✻✽*'])('記号 %s は、スピナーの行なら working・要約の行なら idle', (glyph) => {
    const spinner = [...agentScreen('empty').lines]
    spinner[4] = makeLine(`${glyph} Ionizing… (2s)`)
    expect(classifyAgentScreen(spinner)).toBe('working')
    const summary = [...agentScreen('empty').lines]
    summary[4] = makeLine(`${glyph} Worked for 12s`)
    expect(classifyAgentScreen(summary)).toBe('idle')
  })

  it('要約の行だけがあり入力欄の無い画面は working にならない(unknown)', () => {
    const lines = [
      makeLine(' ▐▛███▜▌   Claude Code v2.1.288'),
      makeLine(''),
      makeLine('✻ Worked for 12s')
    ]
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  it('経過時間の後に続きのある行はスピナーの行のまま(working)', () => {
    const lines = [makeLine('✻ Worked for 12s · esc'), makeLine('✻ Ionizing… (2s · ↓ 27 tokens)')]
    expect(classifyAgentScreen([lines[0]])).toBe('working')
    expect(classifyAgentScreen([lines[1]])).toBe('working')
  })

  // 会話の履歴に残る利用者のプロンプトは 1 桁目から `❯ hello` と描かれる。選択肢の行(字下げのある `  ❯ …`)と取り違えない
  it('記録済みの working の画面から入力欄の行とスピナーの行を空白にした画面は confirm にならない(unknown)', () => {
    const lines = [...agentScreen('working').lines]
    for (const y of [7, 9, 10, 11, 12]) lines[y] = makeLine('')
    expect(lineTextOf(lines[5])).toBe('❯ hello')
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  it('1 桁目の `❯ hello` だけがある画面は confirm にならない', () => {
    expect(classifyAgentScreen([makeLine('❯ hello')])).not.toBe('confirm')
    expect(classifyAgentScreen([makeLine('❯ hello')])).toBe('unknown')
  })

  it('字下げのある選択肢の行があり入力欄の無い画面は confirm', () => {
    const lines = [makeLine('  Pick one'), makeLine('  ❯ Option'), makeLine('    Other')]
    expect(classifyAgentScreen(lines)).toBe('confirm')
  })

  // 入力欄のある画面では、スピナーの行は入力欄の上の罫線の直上の空でない最初の行だけ、`esc to interrupt` は入力欄の下の
  // 案内の行だけで見る。会話の履歴に残る同じ形の行(`/compact` の後の `✻ Conversation compacted …`・本文中の語)で作業中としない
  const withHistory = (history: readonly string[]): ViewportLine[] => {
    const lines = [...agentScreen('empty').lines]
    expect(lineTextOf(lines[5])).toMatch(/^─{20,}/)
    lines.splice(3, 0, ...history.map((text) => makeLine(text)))
    return lines
  }

  it('入力欄のある画面の履歴に `✻ Conversation compacted · ctrl+o for history` があっても idle', () => {
    const lines = withHistory([
      '✻ Conversation compacted · ctrl+o for history',
      '  ⎿  Read src/main.ts (12 lines)'
    ])
    expect(classifyAgentScreen(lines)).toBe('idle')
  })

  // `/compact` の後、圧縮の行が入力欄の直上(空でない最初の行)に来ることがある。要約の行と同じくスピナーの行とみなさない
  it.each([
    '✻ Conversation compacted · ctrl+o for history',
    '✻ Conversation compacted (ctrl+r for history)'
  ])('入力欄の直上に %s がある画面は idle', (compacted) => {
    const lines = withHistory([compacted])
    expect(classifyAgentScreen(lines)).toBe('idle')
  })

  it('入力欄のある画面の履歴に `esc to interrupt` を含む行があっても idle', () => {
    const lines = withHistory([
      '❯ what does esc to interrupt mean?',
      '',
      '⏺ It stops the current turn.'
    ])
    expect(classifyAgentScreen(lines)).toBe('idle')
  })

  // 作業中はスピナーの行と入力欄の間に字下げの行(TodoWrite の一覧・tip)が描かれることがある。書きかけがあると
  // 案内の `esc to interrupt` が消えるため、字下げの行を飛ばしてスピナーの行を見つけないと idle と取り違える
  const withBelowSpinner = (
    name: 'toolrunDraft' | 'workingDraft',
    below: readonly string[]
  ): ViewportLine[] => {
    const lines = [...agentScreen(name).lines]
    const spinnerY = name === 'toolrunDraft' ? 10 : 7
    expect(lineTextOf(lines[spinnerY])).toMatch(/^[✢✻] /)
    lines.splice(spinnerY + 1, 0, ...below.map((text) => makeLine(text)))
    return lines
  }

  it.each(['toolrunDraft', 'workingDraft'] as const)(
    '%s のスピナーの下に todo の一覧があっても working',
    (name) => {
      const lines = withBelowSpinner(name, ['  ⎿  ☐ Step 1', '     ☐ Step 2'])
      expect(classifyAgentScreen(lines)).toBe('working')
    }
  )

  it.each(['toolrunDraft', 'workingDraft'] as const)(
    '%s のスピナーの下に tip の行があっても working',
    (name) => {
      const lines = withBelowSpinner(name, ['  ⎿  Tip: Use /memory to view and update memories'])
      expect(classifyAgentScreen(lines)).toBe('working')
    }
  )

  it('入力欄の直上の字下げの行の上に要約の行があれば idle', () => {
    const lines = withHistory(['✻ Worked for 12s', '  ⎿  ☒ Step 1'])
    expect(classifyAgentScreen(lines)).toBe('idle')
  })

  it('入力欄の直上の字下げの行の上が本文の行(1 桁目が空白でない)なら、その上のスピナーの記号の行では working にしない', () => {
    const lines = withHistory(['✢ Sautéing… (1s)', '⏺ Done.', '  ⎿  detail'])
    expect(classifyAgentScreen(lines)).toBe('idle')
  })

  // 許可待ちは「字下げのある番号付きの選択肢の行(`❯` の付いた行)から上へ、選択肢の行と折り返しの行を飛ばした先の段落
  // (問いの折り返しを含む)が問い」の組で見る。会話の履歴に残る `❯ 1. …`(1 桁目のプロンプト)・応答の継続行の `  Do you want to …` で
  // 許可待ちとしない(ローカルレビュー第 11 周)
  it('履歴に `❯ 1. …` のプロンプトと `Do you want to …` の行が残る画面で番号付きの選択の画面を開くと confirm', () => {
    const lines = [
      '❯ 1. fix the parser',
      '⏺ I found two options.',
      '  Do you want to keep the old API?',
      '',
      ' Select model',
      '   1. Default',
      ' ❯ 2. Opus',
      ' Enter to confirm · Esc to exit'
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('confirm')
  })

  it('履歴に `❯ 1. …` のプロンプトと `Do you want to …` の行だけが残り入力欄の無い画面は unknown', () => {
    const lines = ['❯ 1. fix the parser', '⏺ Done.', '  Do you want to keep the old API?', ''].map(
      (text) => makeLine(text)
    )
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  // 記録済みの許可の画面: 17 行目が問い、18〜22 行目が選択肢(19・20 行目は 2 番目の選択肢の折り返し)
  const permissionWithCursorAt = (index: 2 | 3 | 4): ViewportLine[] => {
    const lines = [...agentScreen('permission').lines]
    expect(lineTextOf(lines[17])).toBe(' Do you want to proceed?')
    expect(lineTextOf(lines[18])).toBe(' ❯ 1. Yes')
    const optionY = { 2: 19, 3: 21, 4: 22 }[index]
    lines[18] = makeLine('   1. Yes')
    lines[optionY] = makeLine(lineTextOf(lines[optionY]).replace(/^ {3}/, ' ❯ '))
    return lines
  }

  it.each([2, 3, 4] as const)('カーソルが %i 番目にある許可の画面は permission', (index) => {
    expect(classifyAgentScreen(permissionWithCursorAt(index))).toBe('permission')
  })

  // 問いが画面の幅を超えると、claude は 1 行目と同じ字下げで折り返す。狭い幅で長いファイル名の編集を許可するときに起こる
  // (ローカルレビュー第 12 周)。17 行目の問いを 2 行にし、行の数を保つために先頭の行を 1 つ落とす
  it('問いが 2 行に折り返された許可の画面は permission', () => {
    const lines = [...agentScreen('permission').lines]
    expect(lineTextOf(lines[17])).toBe(' Do you want to proceed?')
    lines.splice(
      17,
      1,
      makeLine(' Do you want to make this edit to'),
      makeLine(' agentActivitySummary.ts?')
    )
    lines.shift()
    expect(classifyAgentScreen(lines)).toBe('permission')
  })

  it('問いが 3 行に折り返され、選択肢が 2 行に折り返されていても permission', () => {
    const lines = [
      '────────────────────────────────────────',
      ' Edit file',
      '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
      '  1 -const a = 1',
      '  1 +const a = 2',
      '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
      ' Do you want to make this edit to',
      ' src/renderer/src/lib/',
      ' agentActivitySummary.ts?',
      ' ❯ 1. Yes',
      '   2. Yes, allow all edits during this',
      '      session (shift+tab)',
      '   3. No',
      '',
      ' Esc to cancel · Tab to amend'
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('permission')
  })

  // 折り返した問いの 2 行目が数字 + `.` で始まっても、選択肢の行(番号の桁が深い)とは区別する(ローカルレビュー第 14 周)
  it.each([' 2.md?', ' 10.4-notes.md?'])(
    '折り返した問いの 2 行目が `%s` のように数字 + `.` で始まる編集の許可の画面は permission',
    (second) => {
      const lines = [
        '────────────────────────────────────────',
        ' Edit file',
        '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
        '  1 -const a = 1',
        '  1 +const a = 2',
        '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
        ' Do you want to make this edit to',
        second,
        ' ❯ 1. Yes',
        '   2. Yes, allow all edits during this',
        '      session (shift+tab)',
        '   3. No',
        '',
        ' Esc to cancel · Tab to amend'
      ].map((text) => makeLine(text))
      expect(classifyAgentScreen(lines)).toBe('permission')
    }
  )

  it('履歴の応答の継続行 `  Do you want to …` の次の行が本文で、その下に選択の画面があれば confirm', () => {
    const lines = [
      '⏺ I found two options.',
      '  Do you want to keep the old API?',
      ' Select model',
      '   1. Default',
      ' ❯ 2. Opus',
      ' Enter to confirm · Esc to exit'
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('confirm')
  })

  it('空行の後の `  Do you want to …` の行の直下に選択の画面の見出しがあっても confirm(段落の最後の行が `?` で終わらない)', () => {
    const lines = [
      '⏺ I found two options.',
      '',
      '  Do you want to keep the old API?',
      ' Select model',
      '   1. Default',
      ' ❯ 2. Opus',
      ' Enter to confirm · Esc to exit'
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('confirm')
  })

  // 入力欄が画面の高さを超えて上の罫線が見えない画面は、スピナーの行が画面の外にあり、書きかけがあると `esc to interrupt` も消える。
  // 作業中か入力待ちかを見分ける根拠が無いので unknown(ローカルレビュー第 15 周)
  it('作業中に書きかけて入力欄が画面の高さを超えた画面(上の罫線が見えず esc to interrupt も無い)は unknown', () => {
    const lines = [
      ...[2, 3, 4, 5, 6].map((n) => `  draft line ${n}`),
      '─'.repeat(60),
      '  ⏸ manual mode on   ◐ medium · /effort',
      ''
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  it('上の罫線が見えない画面でも下の案内に esc to interrupt があれば working', () => {
    const lines = [
      ...[2, 3, 4, 5, 6].map((n) => `  draft line ${n}`),
      '─'.repeat(60),
      '  esc to interrupt',
      ''
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('working')
  })

  // スピナーと入力欄の間の字下げの行(todo の一覧など)が画面の上端まで続くと、スピナーの行が画面の外にあり、書きかけがあると
  // `esc to interrupt` も消える。上の罫線は見えていても根拠が無いので unknown(ローカルレビュー第 18 周)
  const todoScreen = (first: string, hint: string): ViewportLine[] =>
    [
      first,
      ...[2, 3, 4, 5, 6, 7].map((n) => `     ☐ Step ${n}`),
      '',
      '─'.repeat(60),
      '❯ next prompt draft',
      '─'.repeat(60),
      hint
    ].map((text) => makeLine(text))

  it('入力欄の上が画面の上端まで字下げの行(todo の一覧)でスピナーの行が見えない画面は unknown', () => {
    expect(classifyAgentScreen(todoScreen('  ⎿  ☐ Step 1', '  ? for shortcuts'))).toBe('unknown')
  })

  it('字下げの行が画面の上端まで続く画面でも下の案内に esc to interrupt があれば working', () => {
    expect(classifyAgentScreen(todoScreen('  ⎿  ☐ Step 1', '  esc to interrupt'))).toBe('working')
  })

  it('字下げの行をたどった先の上端の行が本文の行(字下げなし)なら idle', () => {
    expect(classifyAgentScreen(todoScreen('Here is the plan:', '  ? for shortcuts'))).toBe('idle')
  })

  // 画面より長い応答を表示し終えて入力欄で待つ画面は、応答の継続行(字下げの行)が画面の上端まで続く。飛ばした行に `⎿` の枝の行
  // (todo の一覧・tip)が無ければスピナーと入力欄の間の行ではないので、入力待ち(idle)とする(ローカルレビュー第 19 周)
  const answerTailScreen = (body: readonly string[]): ViewportLine[] =>
    [...body, '', '─'.repeat(60), '❯ ', '─'.repeat(60), '  ? for shortcuts'].map((text) =>
      makeLine(text)
    )

  it('2 桁の字下げの応答の継続行が画面の上端まで続く空の入力欄の画面は idle', () => {
    const body = [1, 2, 3, 4, 5, 6, 7].map((n) => `  continuation of the answer line ${n}`)
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  it('応答の箇条書き(`  - item`)が画面の上端まで続く空の入力欄の画面は idle', () => {
    const body = [1, 2, 3, 4, 5, 6, 7].map((n) => `  - item ${n}`)
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  // 根拠なしとするのは todo の項目の記号を持つ行・tip の行だけ。ツールの結果・`!` のシェルのモードの出力・スラッシュコマンドの
  // 出力の `⎿` の行は、応答の継続行と同じく入力待ち(idle)とする(ローカルレビュー第 20 周)
  it('ツールの結果(`⎿` の行と深い字下げの差分の行)が画面の上端まで続く画面は idle', () => {
    const body = [
      '  ⎿  Updated a.txt with 1 addition',
      ...[1, 2, 3, 4, 5, 6].map((n) => `       ${n} + added line ${n}`)
    ]
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  it('`!` のシェルのモードの出力(`⎿` の行と深い字下げの行)が画面の上端まで続く空の入力欄の画面は idle', () => {
    const body = ['  ⎿  a1 first', ...[2, 3, 4, 5, 6, 7].map((n) => `     a${n} commit`)]
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  it('todo の一覧の 1 行目が画面の外にあり 2 行目以降(`     ☐ Step n`)だけが上端まで続く書きかけの画面は unknown', () => {
    expect(classifyAgentScreen(todoScreen('     ☐ Step 1', '  ? for shortcuts'))).toBe('unknown')
  })

  // `!` のシェルのモードで実行したテストランナー(node:test・mocha)の出力は、合格したテストの行の先頭に `✔` を描く。
  // 根拠なしとするのは入力欄の直上(空行を除いて最も近い)の字下げの行が todo の項目の行か tip の行のときだけで、
  // `✔` は todo の項目の記号に含めない(ローカルレビュー第 21 周)
  it('`! node --test` の出力(`✔ …` の行と要約の `ℹ …` の行)が画面の上端まで続く空の入力欄の画面は idle', () => {
    const body = [
      '  ⎿  ✔ adds (0.4ms)',
      ...[2, 3, 4, 5, 6].map((n) => `     ✔ case ${n} (0.1ms)`),
      '     ℹ tests 6',
      '     ℹ pass 6'
    ]
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  it('`! npx mocha` の出力(`✔ case n` の行と `n passing` の行)が画面の上端まで続く空の入力欄の画面は idle', () => {
    const body = [
      '  ⎿    math',
      ...[1, 2, 3, 4, 5].map((n) => `         ✔ case ${n}`),
      '',
      '       5 passing (4ms)'
    ]
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  // todo の項目・tip の本文は画面の幅を超えると折り返され、継続行は記号の後ろの本文の桁(5 桁以上)に揃えた字下げの行になる。
  // 最も近い字下げの行から上へ継続行を飛ばし、項目の先頭の行で判定する(ローカルレビュー第 22 周)
  it('最後の todo の項目が折り返された書きかけの画面(スピナーが画面の外)は unknown', () => {
    const lines = [
      '  ⎿  ☐ Step 1',
      ...[2, 3, 4].map((n) => `     ☐ Step ${n}`),
      '     ☐ Implement the parser for the new',
      '       configuration format',
      '',
      '─'.repeat(60),
      '❯ next prompt draft',
      '─'.repeat(60),
      '  ? for shortcuts'
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  it('折り返した tip が入力欄の直上にある書きかけの画面(スピナーが画面の外)は unknown', () => {
    const lines = [
      ...[3, 4, 5].map((n) => `     ☐ Step ${n}`),
      '  ⎿  Tip: Use /memory to edit your',
      '     CLAUDE.md files',
      '',
      '─'.repeat(60),
      '❯ next prompt draft',
      '─'.repeat(60),
      '  ? for shortcuts'
    ].map((text) => makeLine(text))
    expect(classifyAgentScreen(lines)).toBe('unknown')
  })

  it('途中に `☐` の行があっても、最も近い項目の先頭の行が todo の項目・tip の行でなければ idle', () => {
    const body = [
      '     ☐ Step 1',
      '     ☐ Step 2',
      '  ⎿  Updated a.txt with 1 addition',
      ...[1, 2, 3, 4].map((n) => `       ${n} + added line ${n}`)
    ]
    expect(classifyAgentScreen(answerTailScreen(body))).toBe('idle')
  })

  it('記録済みの全画面がいずれかの期待に含まれている', () => {
    const covered = new Set<string>(Object.values(EXPECTED).flat())
    expect(Object.keys(data.screens).sort()).toEqual([...covered].sort())
  })
})

describe('isAgentActivityWaitingForUser', () => {
  it('許可待ち・確認待ちだけが利用者の操作を待っている(ステータスバーの強調・通知・バッジが同じ集まりを使う)', () => {
    const activities: AgentActivity[] = ['working', 'idle', 'permission', 'confirm', 'unknown']
    expect(activities.filter(isAgentActivityWaitingForUser)).toEqual(['permission', 'confirm'])
  })
})
