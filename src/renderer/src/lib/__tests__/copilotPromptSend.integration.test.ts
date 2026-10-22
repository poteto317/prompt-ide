import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { Terminal } from '@xterm/headless'
import { sendCopilotPrompt } from '../copilotPromptSend'
import type { AgentSendTarget } from '../agentPromptSend'
import { readScreenLines, readViewportLines } from '../agentViewport'
import { readCopilotInputState } from '../copilotInputBox'

// 実物の node-pty と @xterm/headless で、偽の copilot(一時ディレクトリに書いた小さな node のスクリプト)へ sendCopilotPrompt を本物の
// 時計で送る(設計書 2026-10-22「テスト方針」の統合テスト。L-059)。画面の読み取り・書き込みの経路と待ちの確かめで、実物の
// copilot の挙動の確かめではない。実物の copilot は起動しない(L-596)

// String.raw の中ではテンプレートの ${} を使わない(偽の CLI のスクリプトはこの文字列のまま書き出す)
const FAKE_COPILOT = String.raw`
// 偽の copilot(copilotPromptSend.integration.test.ts が一時ディレクトリに書いて node-pty で起動する)。代替画面に copilot 1.0.87 と
// 同じ形の入力欄(罫線・❯・罫線)と帯を描く。括弧付きの貼り付けを受けると約 250ms 後に本文を入力欄に描き、\r を受けると
// (mode が ignore-enter でなければ)入力欄を空に戻して本文を記録する。受け取った読み取りの塊と \r の数もすべて記録する
const fs = require('node:fs')
const reportPath = process.argv[2]
const mode = process.argv[3]
const RULE = '─'.repeat(60)
const EMPTY_BAND = ' ← open sidebar · / commands · ? help · tab next tab'
const DRAFT_BAND = ' @ files · # issues'
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const report = { chunks: [], submitted: [], enterCount: 0 }
let input = ''
let buffer = ''
// 一時ファイルへ書いてから置き換える(テストが書きかけの JSON を読まないように)
function save() {
  fs.writeFileSync(reportPath + '.tmp', JSON.stringify(report))
  fs.renameSync(reportPath + '.tmp', reportPath)
}
function draw() {
  const rows = input === '' ? [''] : input.split('\n')
  const lines = [' fake copilot', RULE, ('❯ ' + rows[0]).trimEnd()]
  for (const row of rows.slice(1)) lines.push('  ' + row)
  lines.push(RULE, input === '' ? EMPTY_BAND : DRAFT_BAND)
  process.stdout.write('\x1b[2J\x1b[H' + lines.join('\r\n'))
}
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdout.write('\x1b[?1049h\x1b[?2004h')
draw()
save()
process.stdin.on('data', (chunk) => {
  report.chunks.push(chunk)
  buffer += chunk
  while (buffer !== '') {
    if (buffer.startsWith(PASTE_START)) {
      const end = buffer.indexOf(PASTE_END)
      if (end < 0) break
      const text = buffer.slice(PASTE_START.length, end)
      buffer = buffer.slice(end + PASTE_END.length)
      setTimeout(() => {
        input = text
        draw()
      }, 250)
    } else if (buffer.startsWith('\r')) {
      buffer = buffer.slice(1)
      report.enterCount += 1
      if (mode !== 'ignore-enter') {
        report.submitted.push(input)
        input = ''
        draw()
      }
    } else {
      buffer = buffer.slice(1)
    }
  }
  save()
})
`

interface FakeCopilotReport {
  /** 偽の CLI が受け取った読み取りの塊(pty の 1 回の data) */
  chunks: string[]
  /** \r で送られた本文 */
  submitted: string[]
  /** 受け取った \r の数 */
  enterCount: number
}

/**
 * 番兵の書き込み。送信の手順が返った後にテストから書き、偽の CLI の記録に現れるまで待つ(pty は書いた順に届けるので、現れたら
 * 手順の書き込みはすべて記録されている)。\r と貼り付けの始まりの印(ESC[200~)を含まない
 */
const FENCE = '@@fence@@'
/** 番兵が記録に現れたかを読む間隔と上限 */
const FENCE_POLL_MS = 20
const FENCE_TIMEOUT_MS = 5_000

let dir: string | null = null
let pty: IPty | null = null
let terminal: Terminal | null = null

afterEach(() => {
  pty?.kill()
  pty = null
  terminal?.dispose()
  terminal = null
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

/** 偽の copilot を起動し、入力待ち(空の入力欄と bracketed paste)になるまで待って、送り先と記録の読み出しを返す */
async function startFakeCopilot(
  mode: 'normal' | 'ignore-enter'
): Promise<{ target: AgentSendTarget; settledReport: () => Promise<FakeCopilotReport> }> {
  const workDir = mkdtempSync(join(tmpdir(), 'prompt-ide-fake-copilot-'))
  dir = workDir
  const script = join(workDir, 'fake-copilot.js')
  const reportPath = join(workDir, 'report.json')
  writeFileSync(script, FAKE_COPILOT)
  const term = new Terminal({ cols: 60, rows: 12, allowProposedApi: true })
  terminal = term
  const child = spawn(process.execPath, [script, reportPath, mode], {
    name: 'xterm-256color',
    cols: 60,
    rows: 12,
    cwd: workDir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  })
  pty = child
  child.onData((data) => term.write(data))
  const target: AgentSendTarget = {
    isBracketedPasteEnabled: () => term.modes.bracketedPasteMode,
    readViewport: () => readViewportLines(term.buffer.active, term.rows),
    readScreen: () => readScreenLines(term.buffer.active, term.rows),
    getCols: () => term.cols,
    write: (data) => child.write(data)
  }
  const startedAt = Date.now()
  while (
    !(term.modes.bracketedPasteMode && readCopilotInputState(target.readScreen()) === 'empty')
  ) {
    if (Date.now() - startedAt > 5_000) throw new Error('偽の copilot が入力待ちになりません')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const report = (): FakeCopilotReport => {
    const parsed: unknown = JSON.parse(readFileSync(reportPath, 'utf8'))
    return parsed as FakeCopilotReport
  }
  /** 番兵を書き、偽の CLI の記録に現れるまで待ってから記録を返す(手順が返った直後の書き込みも見落とさない) */
  const settledReport = async (): Promise<FakeCopilotReport> => {
    child.write(FENCE)
    const fencedAt = Date.now()
    for (;;) {
      const current = report()
      // 番兵は 1 回の読み取りで届くとは限らないので、つないで探す
      if (current.chunks.join('').includes(FENCE)) return current
      if (Date.now() - fencedAt > FENCE_TIMEOUT_MS)
        throw new Error('偽の copilot の記録に番兵が現れません')
      await new Promise((resolve) => setTimeout(resolve, FENCE_POLL_MS))
    }
  }
  return { target, settledReport }
}

describe.skipIf(process.platform === 'win32')(
  'sendCopilotPrompt(実物の node-pty と @xterm/headless・偽の copilot)',
  () => {
    it('貼り付け → echo → 別の読み取りの \\r で sent になり、偽の CLI が受け取った本文が送った本文と一致する', async () => {
      const { target, settledReport } = await startFakeCopilot('normal')
      const text = 'hello from the app\nsecond line'
      await expect(sendCopilotPrompt(target, text)).resolves.toEqual({
        kind: 'sent',
        clearedDraft: false
      })
      const received = await settledReport()
      expect(received.submitted).toEqual([text])
      expect(received.enterCount).toBe(1)
      // \r は貼り付けの終わりの印(ESC[201~)を含む塊より後の、別の読み取りで届いた
      const pasteEnd = received.chunks.findIndex((chunk) => chunk.includes('\x1b[201~'))
      // 後から書いた番兵が同じ塊に続くことはあるので、塊の先頭が \r であることで見る
      const enter = received.chunks.findIndex((chunk) => chunk.startsWith('\r'))
      expect(pasteEnd).toBeGreaterThanOrEqual(0)
      expect(enter).toBeGreaterThan(pasteEnd)
    }, 15_000)

    it('偽の CLI が \\r を無視すると not-confirmed になり、\\r は 1 回だけ届く(送り直さない)', async () => {
      const { target, settledReport } = await startFakeCopilot('ignore-enter')
      await expect(sendCopilotPrompt(target, 'hello from the app')).resolves.toEqual({
        kind: 'failed',
        reason: 'not-confirmed'
      })
      // 手順が返った直後の書き込み(送り直した \r など)も記録されてから確かめる
      const received = await settledReport()
      expect(received.enterCount).toBe(1)
      expect(received.submitted).toEqual([])
    }, 15_000)
  }
)
