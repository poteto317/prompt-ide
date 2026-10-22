import { describe, it, expect } from 'vitest'
import { AGENT_CLEAR_INPUT_CHUNK } from '@shared/agentPasteText'
import {
  sendClaudePrompt,
  AGENT_CLEAR_INTERVAL_MS,
  AGENT_CLEAR_TIMEOUT_MS,
  AGENT_ECHO_POLL_MS,
  AGENT_ECHO_TIMEOUT_MS,
  AGENT_EMPTY_CONFIRM_INTERVAL_MS
} from '../claudePromptSend'
import type { AgentSendClock, AgentSendTarget } from '../agentPromptSend'
import type { ViewportLine } from '../agentViewport'
import { findInputBox, isInputBoxEmpty } from '../agentInputBox'
import { agentScreen, makeLine } from './fixtures/agentScreens'

/** 仮想の時計の安全弁: 経過がこれを超えたら sleep が throw する(上限の判定が外れた実装を無限ループではなく失敗にする) */
const CLOCK_SAFETY_LIMIT_MS = 60_000

// 仮想の時計(sleep で時間を進めるだけ。実際のタイマーを使わない)
function makeClock(): AgentSendClock & { elapsed(): number } {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
      if (now > CLOCK_SAFETY_LIMIT_MS) throw new Error(`仮想の時計が ${now}ms を超えた`)
    },
    elapsed: () => now
  }
}

// claude の入力欄を真似る偽の送り先。入力欄の文字列を持ち、消去のキー 24 バイトごとに clearPerChunk 文字を消し、
// 貼り付けで本文を入れ、Enter で入力欄の文字列を送信する(submitted に記録して空にする)。書き込みはすべて記録する
interface FakeClaude extends AgentSendTarget {
  writes: string[]
  /** 各書き込みの時刻(options.clock を渡したとき。writes と同じ順) */
  writeTimes: number[]
  /** 各読み取りの時刻と、その時点の入力欄が空の画面か(options.clock を渡したとき) */
  reads: Array<{ at: number; empty: boolean }>
  submitted: string[]
  input: string
  mode: 'prompt' | 'shell' | 'dialog'
  bracketed: boolean
}

function makeFakeClaude(
  options: {
    input?: string
    clearPerChunk?: number
    mode?: FakeClaude['mode']
    echo?: boolean
    /**
     * 1 文字の書きかけを、カーソルを先頭に戻して dim の候補を続けた形で描く(反転の書きかけ + dim の候補)。
     * 送信待ちの案内(queuedEmpty)と同じ属性になり、isInputBoxEmpty は空と判定する(agentInputBox の既知の限界)。
     * カーソルが先頭にあるので、貼り付けは書きかけの前に入る
     */
    ghostSuggestion?: string
    /** 書き込み・読み取りの時刻を記録する時計 */
    clock?: AgentSendClock
    onWrite?: (fake: FakeClaude, data: string) => void
  } = {}
): FakeClaude {
  const border = makeLine('─'.repeat(60))
  const ghostActive = (): boolean =>
    options.ghostSuggestion !== undefined && fake.mode === 'prompt' && fake.input.length === 1
  const fake: FakeClaude = {
    writes: [],
    writeTimes: [],
    reads: [],
    submitted: [],
    input: options.input ?? '',
    mode: options.mode ?? 'prompt',
    bracketed: true,
    isBracketedPasteEnabled: () => fake.bracketed,
    getCols: () => 60,
    readScreen: (): ViewportLine[] => {
      throw new Error('claude の手順は readScreen を読まない(readViewport を読む)')
    },
    readViewport: (): ViewportLine[] => {
      if (options.clock !== undefined)
        fake.reads.push({
          at: options.clock.now(),
          empty: fake.mode === 'prompt' && fake.input === ''
        })
      if (fake.mode === 'dialog') return agentScreen('trust').lines
      if (ghostActive()) {
        const suggestion = options.ghostSuggestion ?? ''
        const line = makeLine(
          `❯\xa0${fake.input}${suggestion} `,
          [[3, 3 + suggestion.length]],
          [[2, 3]]
        )
        return [makeLine('history'), border, line, border, makeLine('  status')]
      }
      const symbol = fake.mode === 'shell' ? '!' : '❯'
      const [first, ...rest] = fake.input.split('\n')
      const cursorAt = 2 + (rest.length === 0 ? first.length : 0)
      const lines = [
        makeLine(`${symbol}\xa0${first} `, [], rest.length === 0 ? [[cursorAt, cursorAt + 1]] : [])
      ]
      for (const line of rest) lines.push(makeLine(`  ${line}`))
      return [makeLine('history'), border, ...lines, border, makeLine('  status')]
    },
    write: (data) => {
      fake.writes.push(data)
      if (options.clock !== undefined) fake.writeTimes.push(options.clock.now())
      if (data === AGENT_CLEAR_INPUT_CHUNK) {
        fake.input = fake.input.slice(
          0,
          Math.max(0, fake.input.length - (options.clearPerChunk ?? 1000))
        )
        if (fake.mode === 'shell' && fake.input === '') fake.mode = 'prompt'
      } else if (data.startsWith('\x1b[200~')) {
        if (options.echo !== false) {
          const pasted = data.slice(6, -6)
          // カーソルの位置に入る(先頭に戻した書きかけなら前、それ以外は後ろ)
          fake.input = ghostActive() ? pasted + fake.input : fake.input + pasted
        }
      } else if (data === '\r') {
        fake.submitted.push(fake.input)
        fake.input = ''
      }
      options.onWrite?.(fake, data)
    }
  }
  return fake
}

describe('sendClaudePrompt', () => {
  it('空の入力欄でも消去を 1 回送ってから、空を 2 回確かめて貼り付け、現れたら Enter を送る', async () => {
    const fake = makeFakeClaude()
    const clock = makeClock()
    await expect(sendClaudePrompt(fake, 'hello\nworld', clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\nworld\x1b[201~', '\r'])
    expect(fake.submitted).toEqual(['hello\nworld'])
  })

  it('消去の書き込みは 30ms 以上空け、空の確認の 2 回は 50ms 以上空けてから貼り付ける(消去とは別の書き込み)', async () => {
    const clock = makeClock()
    const fake = makeFakeClaude({ input: 'abcdefghij', clearPerChunk: 4, clock })
    await expect(sendClaudePrompt(fake, 'prompt', clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: true
    })
    const clearTimes = fake.writeTimes.filter((_, i) => fake.writes[i] === AGENT_CLEAR_INPUT_CHUNK)
    expect(clearTimes).toHaveLength(3)
    for (let i = 1; i < clearTimes.length; i++)
      expect(clearTimes[i] - clearTimes[i - 1]).toBeGreaterThanOrEqual(AGENT_CLEAR_INTERVAL_MS)
    const pasteIndex = fake.writes.findIndex((data) => data.startsWith('\x1b[200~'))
    expect(pasteIndex).toBe(3)
    // 貼り付けの直前の 2 回の読み取り(空の確認)は 50ms 以上離れている
    const readsBeforePaste = fake.reads.filter((read) => read.at <= fake.writeTimes[pasteIndex])
    const [confirm1, confirm2] = readsBeforePaste.slice(-2)
    expect(confirm1.empty && confirm2.empty).toBe(true)
    expect(confirm2.at - confirm1.at).toBeGreaterThanOrEqual(AGENT_EMPTY_CONFIRM_INTERVAL_MS)
    // 最後の消去から貼り付けまで: 消去の間隔 + 空の確認の間隔
    expect(fake.writeTimes[pasteIndex] - clearTimes[clearTimes.length - 1]).toBeGreaterThanOrEqual(
      AGENT_CLEAR_INTERVAL_MS + AGENT_EMPTY_CONFIRM_INTERVAL_MS
    )
  })

  it('空と判定される書きかけ(反転の 1 文字 + dim の候補)も、最初の消去で消してから送る', async () => {
    const fake = makeFakeClaude({ input: 'a', ghostSuggestion: 'bc def' })
    // 前提: この画面は isInputBoxEmpty が空と判定する(属性だけでは書きかけと区別できない)
    const box = findInputBox(fake.readViewport())
    expect(box).not.toBeNull()
    expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(true)

    await expect(sendClaudePrompt(fake, 'prompt', makeClock())).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    // 消去を省くと書きかけの a が本文に連結されて送信される(prompta ではなく prompt)
    expect(fake.submitted).toEqual(['prompt'])
    expect(fake.writes[0]).toBe(AGENT_CLEAR_INPUT_CHUNK)
  })

  it('書きかけがあれば 24 バイトずつ 30ms 空けて消し、空になったら止め、消去と貼り付けは別の書き込みにする', async () => {
    const fake = makeFakeClaude({ input: 'abcdefghij', clearPerChunk: 4 })
    const result = await sendClaudePrompt(fake, 'prompt', makeClock())
    expect(result).toEqual({ kind: 'sent', clearedDraft: true })
    const clears = fake.writes.filter((data) => data === AGENT_CLEAR_INPUT_CHUNK)
    expect(clears).toHaveLength(3)
    expect(
      fake.writes.every((data) => data === AGENT_CLEAR_INPUT_CHUNK || !data.includes('\x0b'))
    ).toBe(true)
    expect(fake.writes.slice(-2)).toEqual(['\x1b[200~prompt\x1b[201~', '\r'])
    expect(fake.submitted).toEqual(['prompt'])
  })

  it('1 回の書き込みが 24 バイトを超えない(消去)', async () => {
    const fake = makeFakeClaude({ input: 'x'.repeat(50), clearPerChunk: 5 })
    await sendClaudePrompt(fake, 'p', makeClock())
    for (const data of fake.writes.filter((d) => d.includes('\x0b')))
      expect(data.length).toBeLessThanOrEqual(24)
  })

  it('空にならなければ 3,000ms で止め、貼り付けも Enter も送らない', async () => {
    const fake = makeFakeClaude({ input: 'stuck', clearPerChunk: 0 })
    const clock = makeClock()
    await expect(sendClaudePrompt(fake, 'p', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'clear-failed'
    })
    expect(clock.elapsed()).toBeGreaterThanOrEqual(AGENT_CLEAR_TIMEOUT_MS)
    expect(clock.elapsed()).toBeLessThan(AGENT_CLEAR_TIMEOUT_MS + 100)
    expect(fake.writes.length).toBeGreaterThan(1)
    expect(fake.writes.every((data) => data === AGENT_CLEAR_INPUT_CHUNK)).toBe(true)
  })

  it('入力欄が見つからなければ(確認画面)何も送らない', async () => {
    const fake = makeFakeClaude({ mode: 'dialog' })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([])
  })

  it('消している途中で入力欄が見つからなくなったら止める', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'dialog'
      }
    })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })

  it('空が 2 回続くまで貼り付けない(1 回目の空の後に書きかけが戻ったら消し直す)', async () => {
    let reads = 0
    const fake = makeFakeClaude()
    const original = fake.readViewport
    fake.readViewport = () => {
      reads += 1
      // 読み取り 1 回目は消去の前、2 回目は最初の消去の後の 1 回目の空。3 回目(空の確認の 2 回目)の時点で
      // 利用者の打鍵が入っていた(描き直しの途中)
      if (reads === 3) fake.input = 'late'
      return original()
    }
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'sent',
      clearedDraft: true
    })
    expect(fake.writes).toEqual([
      AGENT_CLEAR_INPUT_CHUNK,
      AGENT_CLEAR_INPUT_CHUNK,
      '\x1b[200~p\x1b[201~',
      '\r'
    ])
    expect(fake.submitted).toEqual(['p'])
  })

  it('貼り付けた本文が 1,000ms 以内に現れなければ Enter を送らない', async () => {
    const fake = makeFakeClaude({ echo: false })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~p\x1b[201~'])
  })

  it('貼り付けでシェルのモード(!)に入ったら Enter を送らない', async () => {
    const fake = makeFakeClaude({
      onWrite: (f, data) => {
        if (data.startsWith('\x1b[200~')) f.mode = 'shell'
      }
    })
    const clock = makeClock()
    await expect(sendClaudePrompt(fake, ' x', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).not.toContain('\r')
    // 時間切れを待たず、シェルのモードを見た最初の確認で止める
    expect(clock.elapsed()).toBeLessThan(
      AGENT_CLEAR_INTERVAL_MS + AGENT_EMPTY_CONFIRM_INTERVAL_MS + AGENT_ECHO_TIMEOUT_MS
    )
    expect(clock.elapsed()).toBe(
      AGENT_CLEAR_INTERVAL_MS + AGENT_EMPTY_CONFIRM_INTERVAL_MS + AGENT_ECHO_POLL_MS
    )
  })

  it('シェルのモード(!)の書きかけは消して通常の入力欄に戻してから送る', async () => {
    const fake = makeFakeClaude({ input: 'ls', mode: 'shell', clearPerChunk: 10 })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'sent',
      clearedDraft: true
    })
    expect(fake.submitted).toEqual(['p'])
  })

  it.each([
    ['空白だけ', '  \n ', 'empty'],
    ['先頭が「!」', '!rm -rf', 'leading-bang'],
    ['長すぎる', 'a'.repeat(200_001), 'too-long']
  ])('%s の本文は何も送らない', async (_label, text, reason) => {
    const fake = makeFakeClaude()
    await expect(sendClaudePrompt(fake, text, makeClock())).resolves.toEqual({
      kind: 'failed',
      reason
    })
    expect(fake.writes).toEqual([])
  })

  it('bracketed paste が無効なら何も送らない', async () => {
    const fake = makeFakeClaude()
    fake.bracketed = false
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'not-accepting'
    })
    expect(fake.writes).toEqual([])
  })

  it('本文の ESC を取り除いて貼り付ける', async () => {
    const fake = makeFakeClaude()
    await sendClaudePrompt(fake, 'a\x1b[201~\rb', makeClock())
    expect(fake.writes[1]).toBe('\x1b[200~a[201~\nb\x1b[201~')
  })
})
