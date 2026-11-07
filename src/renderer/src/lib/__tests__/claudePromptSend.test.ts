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
// 貼り付けで本文を入れ、Enter で入力欄の文字列を送信する(submitted に記録して空にする)。書き込みはすべて記録する。
// readScreen は表示中の行と同じ画面を返す(screen を上書きしたときだけ別の画面)。reads には記録しない
interface FakeClaude extends AgentSendTarget {
  writes: string[]
  /** 各書き込みの時刻(options.clock を渡したとき。writes と同じ順) */
  writeTimes: number[]
  /** 各読み取りの時刻と、その時点の入力欄が空の画面か(options.clock を渡したとき) */
  reads: Array<{ at: number; empty: boolean }>
  submitted: string[]
  input: string
  /** 画面の末尾(readScreen)を表示中の行と別の画面にするとき。null なら表示中の行と同じ画面 */
  screen: ViewportLine[] | null
  /** readScreen を読んだ回数(reads には記録しない) */
  screenReads: number
  /** 'noBox' は入力欄の無い行だけの画面(上へスクロールした表示・描き直しの途中の形。判定は unknown) */
  mode: 'prompt' | 'shell' | 'dialog' | 'noBox'
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
    /** readScreen を読むたびに(画面を返す前に)呼ぶ。screenReads はこの呼び出しの前に数える */
    onReadScreen?: (fake: FakeClaude) => void
  } = {}
): FakeClaude {
  const border = makeLine('─'.repeat(60))
  const ghostActive = (): boolean =>
    options.ghostSuggestion !== undefined && fake.mode === 'prompt' && fake.input.length === 1
  const render = (): ViewportLine[] => {
    if (fake.mode === 'dialog') return agentScreen('trust').lines
    if (fake.mode === 'noBox') return [makeLine('history'), makeLine('1'), makeLine('2')]
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
  }
  const fake: FakeClaude = {
    writes: [],
    writeTimes: [],
    reads: [],
    submitted: [],
    input: options.input ?? '',
    mode: options.mode ?? 'prompt',
    screen: null,
    screenReads: 0,
    bracketed: true,
    isBracketedPasteEnabled: () => fake.bracketed,
    getCols: () => 60,
    readScreen: (): ViewportLine[] => {
      fake.screenReads += 1
      options.onReadScreen?.(fake)
      return fake.screen ?? render()
    },
    readViewport: (): ViewportLine[] => {
      if (options.clock !== undefined)
        fake.reads.push({
          at: options.clock.now(),
          empty: fake.mode === 'prompt' && fake.input === ''
        })
      return render()
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

  it('確認待ちの画面なら(フォルダの信頼)何も送らず screen-confirm', async () => {
    const fake = makeFakeClaude({ mode: 'dialog' })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'screen-confirm'
    })
    expect(fake.writes).toEqual([])
  })

  it('消している途中で確認待ちの画面になったら止めて screen-confirm', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'dialog'
      }
    })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'screen-confirm'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })

  it('入力欄も確認も無い画面(判定は unknown)なら何も送らず input-not-found', async () => {
    const fake = makeFakeClaude({ mode: 'noBox' })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([])
  })

  it('画面の末尾は入力待ちでも、表示中の行に入力欄が無ければ(上へスクロール)何も送らず input-not-found', async () => {
    const fake = makeFakeClaude({ mode: 'noBox' })
    fake.screen = agentScreen('empty').lines
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([])
  })

  it('消している途中で入力欄も確認も無い画面になったら止めて input-not-found', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'noBox'
      }
    })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })

  it('消している途中で表示中の行から入力欄が消えても、末尾が入力待ちなら止めて input-not-found', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'noBox'
        f.screen = agentScreen('empty').lines
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

  describe('画面の末尾が許可待ち・確認待ちなら止める(設計書 2026-11-07)', () => {
    it.each([
      ['permission', 'screen-permission'],
      ['permissionAfterClear', 'screen-permission'],
      ['trust', 'screen-confirm'],
      ['fullscreen', 'screen-confirm']
    ] as const)(
      '表示中の行は空の入力欄のままでも(上へスクロールしている形)、最初から末尾が %s の画面なら何も書かず %s',
      async (name, reason) => {
        // 表示中の行(readViewport)は既定の空の入力欄で、画面の末尾(readScreen)だけが選択の画面
        const fake = makeFakeClaude()
        fake.screen = agentScreen(name).lines
        await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
          kind: 'failed',
          reason
        })
        expect(fake.writes).toEqual([])
        expect(fake.submitted).toEqual([])
      }
    )

    it('bracketed paste が無効でも、許可待ちの理由を先に返す', async () => {
      const fake = makeFakeClaude()
      fake.bracketed = false
      fake.screen = agentScreen('permission').lines
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([])
    })

    it('消去を 1 回書いた後に許可待ちになったら、消去の 1 件だけで止める', async () => {
      const fake = makeFakeClaude({
        input: 'abcdefgh',
        clearPerChunk: 2,
        onWrite: (f) => {
          f.screen = agentScreen('permission').lines
        }
      })
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
    })

    it('空の確認の 2 回目(貼り付けの直前)で許可待ちになったら、貼り付けを書かずに止める', async () => {
      // readScreen は 1 回目が手順の最初、2 回目が空の確認の 1 回目、3 回目が空の確認の 2 回目
      const fake = makeFakeClaude({
        onReadScreen: (f) => {
          if (f.screenReads === 3) f.screen = agentScreen('permission').lines
        }
      })
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
    })

    it('貼り付けを書いた後に許可待ちが 2 回続いたら、時間切れを待たずに止めて Enter を書かない', async () => {
      const clock = makeClock()
      const fake = makeFakeClaude({
        clock,
        onWrite: (f, data) => {
          if (data.startsWith('\x1b[200~')) f.screen = agentScreen('permission').lines
        }
      })
      await expect(sendClaudePrompt(fake, 'hello', clock)).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~'])
      expect(fake.submitted).toEqual([])
      // 1 回目の止める判定では止めず、次の読み取りで 2 回続いたことを確かめてから止める
      expect(clock.elapsed() - fake.writeTimes[1]).toBe(AGENT_ECHO_POLL_MS * 2)
    })

    it('貼り付けの後に止める判定が 1 回だけ出ても(描き直しの途中)、次の読み取りで戻れば送って Enter を書く', async () => {
      // 貼り付けの後の最初の読み取りだけ、画面の末尾を確認待ち(フォルダの信頼)にし、次の読み取りで元に戻す
      const seen: { readsAfterPaste: number | null; writesAtBlocked: string[] | null } = {
        readsAfterPaste: null,
        writesAtBlocked: null
      }
      const fake = makeFakeClaude({
        onWrite: (f, data) => {
          if (data.startsWith('\x1b[200~')) {
            seen.readsAfterPaste = 0
            f.screen = agentScreen('trust').lines
          }
        },
        onReadScreen: (f) => {
          if (seen.readsAfterPaste === null) return
          seen.readsAfterPaste += 1
          if (seen.readsAfterPaste === 1) seen.writesAtBlocked = [...f.writes]
          if (seen.readsAfterPaste === 2) f.screen = null
        }
      })
      await expect(sendClaudePrompt(fake, 'hello', makeClock())).resolves.toEqual({
        kind: 'sent',
        clearedDraft: false
      })
      // 止める判定の回には Enter を書いていない
      expect(seen.writesAtBlocked).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~'])
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
      expect(fake.submitted).toEqual(['hello'])
    })

    it('貼り付けの後に許可待ちが 2 回続いたら screen-permission で止め、どちらの回にも Enter を書かない', async () => {
      const writesAtScreenReads: string[][] = []
      let pasted = false
      const fake = makeFakeClaude({
        onWrite: (f, data) => {
          if (data.startsWith('\x1b[200~')) {
            pasted = true
            f.screen = agentScreen('permission').lines
          }
        },
        onReadScreen: (f) => {
          if (pasted) writesAtScreenReads.push([...f.writes])
        }
      })
      await expect(sendClaudePrompt(fake, 'hello', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(writesAtScreenReads).toHaveLength(2)
      for (const writes of writesAtScreenReads) expect(writes).not.toContain('\r')
      expect(fake.writes).not.toContain('\r')
      expect(fake.submitted).toEqual([])
    })

    it('貼り付けの後の止める判定は、間に止めない判定が入ると数え直す(交互なら時間切れまで止めず、時間切れの回が止める判定ならその理由)', async () => {
      // 貼り付けの後は、止める判定(許可待ち)と止めない判定(本文の現れない入力欄)を交互に返す。本文は現れない
      const seen = { pasted: false, readsAfterPaste: 0 }
      const clock = makeClock()
      const fake = makeFakeClaude({
        clock,
        echo: false,
        onWrite: (_f, data) => {
          if (data.startsWith('\x1b[200~')) seen.pasted = true
        },
        onReadScreen: (f) => {
          if (!seen.pasted) return
          seen.readsAfterPaste += 1
          f.screen = seen.readsAfterPaste % 2 === 1 ? agentScreen('permission').lines : null
        }
      })
      const outcome = await sendClaudePrompt(fake, 'hello', clock)
      expect(fake.writes).not.toContain('\r')
      // 2 回続かないので時間切れまで読み続ける(止める判定が通算 2 回になっても止めない)
      expect(seen.readsAfterPaste).toBeGreaterThan(3)
      expect(clock.elapsed() - fake.writeTimes[1]).toBeGreaterThanOrEqual(AGENT_ECHO_TIMEOUT_MS)
      // 16ms ごとに読み、63 回目(1,008ms)で時間切れ。その回は止める判定(奇数回)なので、not-echoed ではなくその理由を返す
      expect(seen.readsAfterPaste).toBe(Math.ceil(AGENT_ECHO_TIMEOUT_MS / AGENT_ECHO_POLL_MS))
      expect(seen.readsAfterPaste % 2).toBe(1)
      expect(outcome).toEqual({ kind: 'failed', reason: 'screen-permission' })
    })

    it('止める判定と止めない判定が交互に続き、時間切れの回が止めない判定なら、前の止める判定の理由ではなく not-echoed', async () => {
      // 上の交互のテストと組を逆にする(奇数回は止めない判定、偶数回は許可待ち)。本文は現れない
      const seen = { pasted: false, readsAfterPaste: 0 }
      const clock = makeClock()
      const fake = makeFakeClaude({
        clock,
        echo: false,
        onWrite: (_f, data) => {
          if (data.startsWith('\x1b[200~')) seen.pasted = true
        },
        onReadScreen: (f) => {
          if (!seen.pasted) return
          seen.readsAfterPaste += 1
          f.screen = seen.readsAfterPaste % 2 === 0 ? agentScreen('permission').lines : null
        }
      })
      const outcome = await sendClaudePrompt(fake, 'hello', clock)
      expect(fake.writes).not.toContain('\r')
      // 63 回目(1,008ms)で時間切れ。その回は止めない判定(奇数回)
      expect(seen.readsAfterPaste).toBe(Math.ceil(AGENT_ECHO_TIMEOUT_MS / AGENT_ECHO_POLL_MS))
      expect(seen.readsAfterPaste % 2).toBe(1)
      expect(outcome).toEqual({ kind: 'failed', reason: 'not-echoed' })
    })

    it('止める判定を 1 回返した後にシェルのモード(!)になったら、前の止める判定の理由ではなく not-echoed', async () => {
      const seen = { pasted: false, readsAfterPaste: 0 }
      const fake = makeFakeClaude({
        echo: false,
        onWrite: (f, data) => {
          if (data.startsWith('\x1b[200~')) {
            seen.pasted = true
            f.screen = agentScreen('permission').lines
          }
        },
        onReadScreen: (f) => {
          if (!seen.pasted) return
          seen.readsAfterPaste += 1
          // 1 回目は許可待ちのまま返し、2 回目からは表示中の行と同じ画面(シェルのモードの入力欄)
          if (seen.readsAfterPaste === 2) {
            f.screen = null
            f.mode = 'shell'
          }
        }
      })
      await expect(sendClaudePrompt(fake, 'hello', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'not-echoed'
      })
      expect(seen.readsAfterPaste).toBe(2)
      expect(fake.writes).not.toContain('\r')
    })

    it.each(['working', 'queuedEmpty', 'tallTyped'] as const)(
      '画面の末尾が %s(作業中・判定できない)なら、今までどおり送る',
      async (name) => {
        const fake = makeFakeClaude()
        fake.screen = agentScreen(name).lines
        await expect(sendClaudePrompt(fake, 'hello', makeClock())).resolves.toEqual({
          kind: 'sent',
          clearedDraft: false
        })
        expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
      }
    )
  })
})
