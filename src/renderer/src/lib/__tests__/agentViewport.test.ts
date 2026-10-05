import { describe, it, expect, afterEach } from 'vitest'
import { Terminal } from '@xterm/headless'
import { lineText, readViewportLines } from '../agentViewport'

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
