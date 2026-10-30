import { describe, it, expect, afterEach } from 'vitest'
import { Terminal } from '@xterm/headless'
import { findInputBox, headWithinColumns, isInputBoxEmpty, isPasteEchoed } from '../agentInputBox'
import { lineText, readViewportLines } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'

const boxOf = (name: AgentScreenName): ReturnType<typeof findInputBox> =>
  findInputBox(agentScreen(name).lines)

// @xterm/headless に SGR(\x1b[7m 反転・\x1b[2m dim)付きで「罫線・記号の行・罫線」を書き、入力欄を読む(合成した画面)
let terminal: Terminal | null = null

afterEach(() => {
  terminal?.dispose()
  terminal = null
})

const BORDER = '─'.repeat(40)
const NBSP = '\xa0'

async function boxOfWritten(symbolLine: string): Promise<ReturnType<typeof findInputBox>> {
  terminal = new Terminal({ cols: 40, rows: 4, allowProposedApi: true })
  const term = terminal
  await new Promise<void>((resolve) =>
    term.write(`${BORDER}\r\n${symbolLine}\r\n${BORDER}`, resolve)
  )
  return findInputBox(readViewportLines(term.buffer.active, 4))
}

describe('findInputBox(claude 2.1.288 の記録した画面)', () => {
  it.each<[AgentScreenName, 'prompt' | 'shell' | null, number]>([
    ['empty', 'prompt', 1],
    ['narrowEmpty', 'prompt', 1],
    ['single', 'prompt', 1],
    ['multiTyped', 'prompt', 3],
    ['long', 'prompt', 4],
    ['pasted40', 'prompt', 1],
    ['mixed', 'prompt', 1],
    ['shellEmpty', 'shell', 1],
    ['shellText', 'shell', 1],
    ['slash', 'prompt', 1],
    ['echoLeadingNewline', 'prompt', 3],
    ['working', 'prompt', 1],
    ['workingDraft', 'prompt', 1],
    ['queuedEmpty', 'prompt', 1],
    ['streamingDraft', 'prompt', 1],
    ['toolrunDraft', 'prompt', 1],
    ['tallTyped', null, 9]
  ])('%s: 記号 %s・%i 行', (name, symbol, lineCount) => {
    const box = boxOf(name)
    expect(box?.symbol).toBe(symbol)
    expect(box?.lines).toHaveLength(lineCount)
  })

  it.each<AgentScreenName>(['trust', 'fullscreen', 'permission', 'permissionAfterClear'])(
    '確認画面(%s)では見つからない',
    (name) => {
      expect(boxOf(name)).toBeNull()
    }
  )

  it('会話の履歴の「❯ hello」の行(罫線の外)は入力欄にしない', () => {
    const box = boxOf('working')
    expect(lineText(box?.lines[0] ?? []).startsWith('❯\xa0')).toBe(true)
  })

  it('下の罫線が見えない画面では見つからない', () => {
    expect(findInputBox([makeLine('❯\xa0abc'), makeLine('  more')])).toBeNull()
  })

  it('罫線の間の 2 行目が字下げでなければ入力欄にしない', () => {
    const border = makeLine('─'.repeat(40))
    expect(findInputBox([border, makeLine('❯\xa0a'), makeLine('x'), border])).toBeNull()
  })

  it('罫線が 20 文字未満なら罫線とみなさない', () => {
    const short = makeLine('─'.repeat(19))
    expect(findInputBox([short, makeLine('❯\xa0 ', [], [[2, 3]]), short])).toBeNull()
  })

  it('画面の上端まで字下げが続いても、空白だけなら入力欄にしない', () => {
    expect(findInputBox([makeLine('   '), makeLine('─'.repeat(30))])).toBeNull()
  })
})

describe('isInputBoxEmpty', () => {
  it.each<[AgentScreenName, boolean]>([
    ['empty', true],
    ['narrowEmpty', true],
    ['working', true],
    ['queuedEmpty', true],
    ['streamingAfterClear', true],
    ['toolrunAfterClear', true],
    ['single', false],
    ['singleCurMid', false],
    ['multiTyped', false],
    ['pasted40', false],
    ['mixed', false],
    ['shellEmpty', false],
    ['shellText', false],
    ['slash', false],
    ['workingDraft', false],
    ['echoLeadingNewline', false]
  ])('%s → %s', (name, expected) => {
    const box = boxOf(name)
    expect(box).not.toBeNull()
    expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(expected)
  })

  it('入力欄の行が画面を超えた(記号が見えない)ときは空ではない', () => {
    const box = boxOf('tallTyped')
    expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(false)
  })

  it('反転のカーソルが記号の直後に無ければ空ではない', () => {
    expect(isInputBoxEmpty({ symbol: 'prompt', lines: [makeLine('❯\xa0  ', [], [[3, 4]])] })).toBe(
      false
    )
  })

  it('dim でない案内の文字があれば空ではない(dim の判定を外す変異を落とす)', () => {
    expect(
      isInputBoxEmpty({ symbol: 'prompt', lines: [makeLine('❯\xa0Press up', [], [[2, 3]])] })
    ).toBe(false)
  })

  // 1 文字の書きかけでカーソルを先頭に戻すと(← や Ctrl+A)、カーソルはその文字の反転で描かれる(singleCurMid と同じ描き方)。
  // 空と誤判定すると消去を飛ばし、書きかけを混ぜた本文を送ってしまうので、送らない側(空ではない)に倒す
  it('1 文字の書きかけにカーソルが乗っていれば空ではない', () => {
    expect(
      isInputBoxEmpty({
        symbol: 'prompt',
        lines: [makeLine('❯\xa0a' + ' '.repeat(30), [], [[2, 3]])]
      })
    ).toBe(false)
  })

  it('全角 1 文字の書きかけにカーソルが乗っていれば空ではない', () => {
    expect(isInputBoxEmpty({ symbol: 'prompt', lines: [makeLine('❯\xa0日', [], [[2, 3]])] })).toBe(
      false
    )
  })

  it('案内の文字の先頭にカーソルが乗り、続く文字が dim なら空', () => {
    expect(
      isInputBoxEmpty({
        symbol: 'prompt',
        lines: [
          makeLine(
            '❯\xa0Press up',
            [
              [3, 7],
              [8, 10]
            ],
            [[2, 3]]
          )
        ]
      })
    ).toBe(true)
  })

  it('案内の文字の先頭にカーソルが乗っていても、2 行以上なら空ではない', () => {
    expect(
      isInputBoxEmpty({
        symbol: 'prompt',
        lines: [
          makeLine(
            '❯\xa0Press up',
            [
              [3, 7],
              [8, 10]
            ],
            [[2, 3]]
          ),
          makeLine('  more')
        ]
      })
    ).toBe(false)
  })
})

describe('isInputBoxEmpty(@xterm/headless に SGR 付きで書いて合成した画面)', () => {
  it.each<[string, boolean, string]>([
    ['空(反転の空白のカーソル)', true, `❯${NBSP}\x1b[7m \x1b[27m`],
    ['案内の先頭にカーソル・続きが dim', true, `❯${NBSP}\x1b[7mP\x1b[27m\x1b[2mress up\x1b[22m`],
    ['a を打って ←', false, `❯${NBSP}\x1b[7ma\x1b[27m`],
    ['全角 1 文字を打って ←', false, `❯${NBSP}\x1b[7m日\x1b[27m`],
    ['案内の先頭にカーソル・続きが dim でない', false, `❯${NBSP}\x1b[7mP\x1b[27mress up`],
    // claude は端末のフォーカスが外れるとカーソルを描かない(?1004h。実行のボタンを押すとターミナルからフォーカスが外れる)
    ['フォーカスが外れた空(カーソルなし)', true, `❯${NBSP}`],
    ['フォーカスが外れた空(案内はすべて dim)', true, `❯${NBSP}\x1b[2mTry "fix lint"\x1b[22m`],
    ['フォーカスが外れた書きかけ', false, `❯${NBSP}hello`],
    ['フォーカスが外れた、dim でない案内', false, `❯${NBSP}Try "fix lint"`]
  ])('%s → %s', async (_label, expected, symbolLine) => {
    const box = await boxOfWritten(symbolLine)
    expect(box?.symbol).toBe('prompt')
    expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(expected)
  })
})

describe('isInputBoxEmpty の既知の限界(@xterm/headless で合成した画面)', () => {
  // 画面のセルの属性だけでは書きかけと区別できない形。true になることを固定し、呼び出し側(送信の手順)が
  // 空と判定されても消去を最低 1 回送る前提を落とさないようにする
  it.each<[string, string]>([
    [
      'a + dim の候補 + ←(反転の a + dim の続き。queuedEmpty と同じ属性)',
      `❯${NBSP}\x1b[7ma\x1b[27m\x1b[2mbc def\x1b[22m`
    ],
    ['空白 1 文字 + ←(空の入力欄と同じ画面)', `❯${NBSP}\x1b[7m \x1b[27m`]
  ])(
    '既知の限界: 呼び出し側が消去を省略しない前提 — %s は空と判定する',
    async (_label, symbolLine) => {
      const box = await boxOfWritten(symbolLine)
      expect(box?.symbol).toBe('prompt')
      expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(true)
    }
  )
})

describe('headWithinColumns', () => {
  it('半角は 1 桁、全角は 2 桁で数える', () => {
    expect(headWithinColumns('abcdef', 4)).toBe('abcd')
    expect(headWithinColumns('日本語テキスト', 5)).toBe('日本')
    expect(headWithinColumns('a😀b', 3)).toBe('a😀')
  })
})

describe('isPasteEchoed', () => {
  const cols = 100
  it('1 行目が本文の最初の行で始まれば true', () => {
    const box = boxOf('echoShort')
    expect(
      isPasteEchoed(box as NonNullable<typeof box>, 'first line of prompt\nsecond line', cols)
    ).toBe(true)
  })

  it('別の本文なら false', () => {
    const box = boxOf('echoShort')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'other text', cols)).toBe(false)
  })

  it('[Pasted text #N で始まれば true', () => {
    const box = boxOf('pasted40')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'pasted line 0\n…', cols)).toBe(true)
  })

  it('先頭が改行の本文は、1 行目が空白だけで 2 行目以降に最初の空でない行が現れれば true', () => {
    const box = boxOf('echoLeadingNewline')
    expect(isPasteEchoed(box as NonNullable<typeof box>, '\nafter blank line\nthird', cols)).toBe(
      true
    )
    expect(isPasteEchoed(box as NonNullable<typeof box>, '\nsomething else', cols)).toBe(false)
  })

  it('先頭の空白とタブ(空白 4 つで表示される)を保って比べる', () => {
    const box = boxOf('echoIndented')
    expect(isPasteEchoed(box as NonNullable<typeof box>, '  indented line\tTAB\n2nd', cols)).toBe(
      true
    )
  })

  it('日本語の本文を比べる', () => {
    const box = boxOf('echoJapanese')
    expect(isPasteEchoed(box as NonNullable<typeof box>, '日本語のプロンプト\n二行目', cols)).toBe(
      true
    )
  })

  it('長い 1 行は先頭の 24 桁だけで比べる(折り返しに依らない)', () => {
    const box = boxOf('echoLongLine')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'X'.repeat(150), cols)).toBe(true)
  })

  it('桁数が少ないときは桁数 − 4 までで比べる', () => {
    const box = { symbol: 'prompt' as const, lines: [makeLine('❯\xa0abcdef'), makeLine('  ghij')] }
    expect(isPasteEchoed(box, 'abcdefghij', 10)).toBe(true)
    expect(isPasteEchoed(box, 'abcdefXXXX', 10)).toBe(true)
    expect(isPasteEchoed(box, 'abcdeXXXXX', 10)).toBe(false)
  })

  it('シェルのモード(!)に入っていたら false', () => {
    const box = boxOf('shellText')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'ls -la', cols)).toBe(false)
  })

  it('記号が見えない(画面を超えた)入力欄では false', () => {
    const box = boxOf('tallTyped')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'typed line 5', cols)).toBe(false)
  })
})
