import { describe, it, expect, afterEach } from 'vitest'
import { Terminal } from '@xterm/headless'
import { isViewportAtBottom, lineText, readScreenLines, readViewportLines } from '../agentViewport'

// 実物の xterm のバッファ(@xterm/headless)で、dim・反転・全角・スクロールの読み取りを確かめる
let terminal: Terminal | null = null

afterEach(() => {
  terminal?.dispose()
  terminal = null
})

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('readViewportLines', () => {
  it('セルの文字・dim・反転を読み、空のセルは空白にする', async () => {
    terminal = new Terminal({ cols: 12, rows: 3, allowProposedApi: true })
    await write(terminal, 'a\x1b[2mb\x1b[22m\x1b[7mc\x1b[27m')
    const [first] = readViewportLines(terminal.buffer.active, 3)
    expect(lineText(first)).toBe('abc' + ' '.repeat(9))
    expect(first.slice(0, 3).map((cell) => [cell.dim, cell.inverse])).toEqual([
      [false, false],
      [true, false],
      [false, true]
    ])
  })

  it('全角の文字の右半分(幅 0 のセル)を除く', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, '日本x')
    const [first] = readViewportLines(terminal.buffer.active, 2)
    expect(lineText(first).startsWith('日本x')).toBe(true)
  })

  it('表示中の rows 行(スクロールした後は画面に見えている範囲)を読む', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, 'l1\r\nl2\r\nl3')
    const lines = readViewportLines(terminal.buffer.active, 2)
    expect(lines.map((line) => lineText(line).trimEnd())).toEqual(['l2', 'l3'])
  })
})

describe('readScreenLines', () => {
  it('利用者がスクロールで戻していても、baseY から rows 行(現在の画面)を読む', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, 'l1\r\nl2\r\nl3')
    terminal.scrollToTop()
    // 前提: スクロールで戻している(表示中の範囲と画面の末尾がずれている)
    expect(terminal.buffer.active.viewportY).toBe(0)
    expect(terminal.buffer.active.baseY).toBe(1)
    const lines = readScreenLines(terminal.buffer.active, 2)
    expect(lines.map((line) => lineText(line).trimEnd())).toEqual(['l2', 'l3'])
  })

  it('バッファに無い行(読めない行)は例外にせず空の行にする(判定には空の行として渡る)', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, 'l1')
    // 前提: 画面の末尾から 4 行を読むと、後ろの 2 行はバッファに無い
    expect(terminal.buffer.active.getLine(3)).toBeUndefined()
    const lines = readScreenLines(terminal.buffer.active, 4)
    expect(lines.slice(2)).toEqual([[], []])
    expect(lines.map((line) => lineText(line).trimEnd())).toEqual(['l1', '', '', ''])
  })
})

describe('isViewportAtBottom', () => {
  it('表示が画面の末尾なら真、上へスクロールしている間は偽、末尾へ戻すと真', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, 'l1\r\nl2\r\nl3\r\nl4')
    expect(isViewportAtBottom(terminal.buffer.active)).toBe(true)
    terminal.scrollLines(-1)
    expect(isViewportAtBottom(terminal.buffer.active)).toBe(false)
    // スクロールしている間に出力が増えても、表示は戻した位置のまま(偽のまま)
    await write(terminal, '\r\nl5')
    expect(isViewportAtBottom(terminal.buffer.active)).toBe(false)
    terminal.scrollToBottom()
    expect(isViewportAtBottom(terminal.buffer.active)).toBe(true)
  })

  it('代替画面(スクロールバックが無い)では、上へスクロールしても真', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, 'l1\r\nl2\r\nl3\r\nl4\x1b[?1049hA\r\nB')
    terminal.scrollLines(-1)
    expect(isViewportAtBottom(terminal.buffer.active)).toBe(true)
  })
})
