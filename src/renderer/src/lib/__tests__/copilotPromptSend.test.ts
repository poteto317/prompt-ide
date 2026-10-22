import { afterEach, describe, it, expect, vi } from 'vitest'
import { buildAgentPasteBytes } from '@shared/agentPasteText'
import {
  COPILOT_ECHO_TIMEOUT_MS,
  COPILOT_INPUT_STATE_TIMEOUT_MS,
  COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS,
  buildCopilotPasteText,
  checkCopilotInputBeforePaste,
  checkCopilotPasteEcho,
  sendCopilotPrompt
} from '../copilotPromptSend'
import type { CopilotPrePasteCheck } from '../copilotPromptSend'
import type { AgentSendClock, AgentSendFailure, AgentSendTarget } from '../agentPromptSend'
import type { ViewportLine } from '../agentViewport'
import { copilotScreen } from './fixtures/copilotScreens'
import {
  copilotInputScreen,
  copilotInputSequence,
  screenFromTexts
} from './fixtures/copilotInputScreens'
import type { CopilotInputScreenName } from './fixtures/copilotInputScreens'

/** 仮想の時計の安全弁: 経過がこれを超えたら sleep が throw する(上限の判定が外れた実装を無限ループではなく失敗にする) */
const CLOCK_SAFETY_LIMIT_MS = 60_000

function makeClock(): AgentSendClock {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
      if (now > CLOCK_SAFETY_LIMIT_MS) throw new Error(`仮想の時計が ${now}ms を超えた`)
    }
  }
}

/** 画面を選ぶ関数。読み取りの時刻・それまでの書き込み・最後の書き込みの時刻を受け取る */
type ScreenAt = (state: {
  now: number
  writes: readonly string[]
  lastWriteAt: number | null
}) => ViewportLine[]

// copilot を真似る偽の送り先。画面は screenAt が時刻と書き込みから選ぶ。書き込みと読み取りの時刻をすべて記録する
interface FakeCopilot extends AgentSendTarget {
  writes: string[]
  writeTimes: number[]
  readTimes: number[]
  bracketed: boolean
}

function makeFakeCopilot(clock: AgentSendClock, screenAt: ScreenAt): FakeCopilot {
  let lastWriteAt: number | null = null
  const fake: FakeCopilot = {
    writes: [],
    writeTimes: [],
    readTimes: [],
    bracketed: true,
    isBracketedPasteEnabled: () => fake.bracketed,
    readViewport: (): ViewportLine[] => {
      throw new Error('copilot の手順は readViewport を読まない(readScreen を読む)')
    },
    readScreen: (): ViewportLine[] => {
      fake.readTimes.push(clock.now())
      return screenAt({ now: clock.now(), writes: fake.writes, lastWriteAt })
    },
    getCols: () => 100,
    write: (data) => {
      fake.writes.push(data)
      fake.writeTimes.push(clock.now())
      lastWriteAt = clock.now()
    }
  }
  return fake
}

const input = (name: CopilotInputScreenName): ViewportLine[] => copilotInputScreen(name).lines

/** 書き込みの数で画面を選ぶ(貼り付けの前・貼り付けの後・Enter の後) */
const byWrites =
  (beforePaste: ViewportLine[], afterPaste: ViewportLine[], afterEnter: ViewportLine[]): ScreenAt =>
  ({ writes }) =>
    [beforePaste, afterPaste, afterEnter][Math.min(writes.length, 2)]

const RULE = '─'.repeat(100)
const DRAFT_BAND =
  ' @ files · # issues                                                                 gpt-4o'

/** 貼った本文が入力欄に入った画面(copilot と同じく、末尾の空白を除いて 1 行目に ❯、2 行目以降に 2 桁の字下げ) */
const echoScreenOf = (pasted: string): ViewportLine[] => {
  const [first, ...rest] = pasted.trimEnd().split('\n')
  return screenFromTexts([
    ' ● 前の応答',
    RULE,
    `❯ ${first}`,
    ...rest.map((row) => `  ${row}`),
    RULE,
    DRAFT_BAND
  ])
}

/** 送れる流れ(空 → 貼った本文の echo → 空)。echo の画面は実際に貼った本文から作る */
const sendableFlow: ScreenAt = ({ writes }) => {
  if (writes.length === 0) return input('empty')
  if (writes.length === 1) return echoScreenOf(writes[0].slice(6, -6))
  return input('aeInstantEnd')
}

const MULTI = 'first line\nsecond line\nthird line'

describe('sendCopilotPrompt: 送れる流れ', () => {
  it('空の入力欄を 2 回確かめ、貼り付け → echo → 別の書き込みの \\r → 空に戻って sent。書いた列は貼り付けと \\r の 2 回だけ', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('multiPasted'), input('aeInstantEnd'))
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI), '\r'])
    // 0ms と 50ms の 2 回の空を確かめてから貼る
    expect(fake.writeTimes[0]).toBe(50)
  })

  it('Enter の後に帯が作業中(段階 2a の台帳の beforeFirstToken)になれば sent', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('multiPasted'), copilotScreen('beforeFirstToken').lines)
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI), '\r'])
  })
})

describe('sendCopilotPrompt: 押した時点の画面で送らない(何も書かない)', () => {
  const noBand = screenFromTexts([' ● 前の応答', RULE, '❯', RULE])
  const noInputBox = screenFromTexts([' ● 前の応答', '', ''])
  it.each<[string, ViewportLine[], AgentSendFailure]>([
    ['書きかけ(afterTurn1char)', input('afterTurn1char'), 'draft-present'],
    ['空白だけの書きかけ(spacesPasted)', input('spacesPasted'), 'draft-present'],
    ['シェルのモード(shellEmpty)', input('shellEmpty'), 'shell-mode'],
    ['作業中(working3000)', copilotScreen('working3000').lines, 'screen-working'],
    ['許可待ち(permission)', copilotScreen('permission').lines, 'screen-permission'],
    ['確認待ち(trust)', copilotScreen('trust').lines, 'screen-confirm'],
    ['判定できない(帯が空の手書き)', noBand, 'screen-unknown'],
    // 入力欄が無い画面は idle にならないので、input-not-found ではなく screen-unknown
    ['入力欄が無い(描き直しの途中の手書き)', noInputBox, 'screen-unknown']
  ])('%s → %s', async (_label, screen, reason) => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => screen)
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason
    })
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: 空か書きかけかを決められない間の保留(50ms ごと・上限 2,500ms)', () => {
  it('一時的な帯(spacesEsc1 の形。入力欄は空)が続いた後に空になれば、空を 2 回確かめて送る', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) => {
      if (writes.length === 0) return now < 600 ? input('spacesEsc1') : input('empty')
      return sendableFlow({ now, writes, lastWriteAt: null })
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[0]).toBe(650)
  })

  it('記録の列 escRewindBand(帯 esc again to rewind から約 500ms で戻る)でも、戻った後に送る', async () => {
    const frames = copilotInputSequence('escRewindBand')
    // 帯が出た列(71ms)を時刻 0 にする
    const offset = frames[1].dt
    const frameAt = (now: number): ViewportLine[] => {
      let current = frames[0].lines
      for (const frame of frames) if (frame.dt - offset <= now) current = frame.lines
      return current
    }
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) =>
      writes.length === 0 ? frameAt(now) : sendableFlow({ now, writes, lastWriteAt: null })
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    // 戻るのは 570 - 71 = 499ms。500ms と 550ms の 2 回の空を確かめて貼る
    expect(fake.writeTimes[0]).toBe(550)
  })

  it('上限の直前の読み取り(2,450ms)で空になれば、続く 2,500ms の読み取りで 2 回目の空を確かめて送る', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) => {
      if (writes.length === 0) return now < 2_450 ? input('spacesEsc1') : input('empty')
      return sendableFlow({ now, writes, lastWriteAt: null })
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[0]).toBe(COPILOT_INPUT_STATE_TIMEOUT_MS)
  })

  it('上限の時点(2,500ms)の読み取りでも決められなければ input-undetermined で、何も書かない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('spacesEsc1'))
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'input-undetermined'
    })
    expect(fake.writes).toEqual([])
    expect(fake.readTimes[fake.readTimes.length - 1]).toBe(COPILOT_INPUT_STATE_TIMEOUT_MS)
  })

  it('上限の時点(2,500ms)の読み取りで初めて空になっても、2 回目を確かめられないので input-undetermined', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now }) =>
      now < COPILOT_INPUT_STATE_TIMEOUT_MS ? input('spacesEsc1') : input('empty')
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'input-undetermined'
    })
    expect(fake.writes).toEqual([])
  })

  it('空が 1 回だけで次が決められなければ、空の回数を数え直す(0・100・150ms の空で、150ms に貼る)', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) => {
      if (writes.length === 0) return now === 50 ? input('spacesEsc1') : input('empty')
      return sendableFlow({ now, writes, lastWriteAt: null })
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[0]).toBe(150)
  })

  it('保留の間に作業中の画面に変わったら screen-working で、何も書かない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now }) =>
      now < 100 ? input('spacesEsc1') : copilotScreen('working3000').lines
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'screen-working'
    })
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: echo の確かめ(16ms ごと・上限 1,500ms)', () => {
  it('上限まで echo が現れなければ not-echoed で、書いた列は貼り付けだけ(Enter を送らない)', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('empty'))
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI)])
  })

  it('貼り付けから 1,500ms の時点で現れれば、上限を過ぎた最初の読み取り(1,504ms)で確かめて送る', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes, lastWriteAt }) => {
      if (writes.length === 0) return input('empty')
      if (writes.length === 1) {
        const pastedAt = lastWriteAt ?? 0
        return now - pastedAt >= COPILOT_ECHO_TIMEOUT_MS ? input('multiPasted') : input('empty')
      }
      return input('aeInstantEnd')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[1] - fake.writeTimes[0]).toBe(1_504)
  })

  it('上限を過ぎた最初の読み取り(1,504ms)でも現れなければ not-echoed', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes, lastWriteAt }) => {
      if (writes.length === 0) return input('empty')
      const pastedAt = lastWriteAt ?? 0
      return now - pastedAt >= 1_505 ? input('multiPasted') : input('empty')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI)])
  })

  it('echo の画面で記号が「!」(シェルのモード)なら、上限を待たずに shell-mode-after-paste(not-echoed の「送るか消して」を出さない)', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('shellDraft'), input('empty'))
    )
    await expect(sendCopilotPrompt(fake, 'echo hi', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'shell-mode-after-paste'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes('echo hi')])
    // 貼り付け(50ms)の後の最初の読み取り(66ms)で止める
    expect(fake.readTimes[fake.readTimes.length - 1]).toBe(66)
  })
})

describe('sendCopilotPrompt: 送れたことの確かめ(16ms ごと・上限 2,000ms)', () => {
  it.each<[string, string, CopilotInputScreenName, CopilotInputScreenName]>([
    ['look at @file(Enter が補完の確定に取られた atEnter)', 'look at @file', 'atPaste', 'atEnter'],
    [
      'アプリの参照の添付の形(atref1hEnter1)',
      '本文\n\n参照:\n- @file.txt',
      'atref1hPaste',
      'atref1hEnter1'
    ]
  ])(
    '%s: Enter の後に入力欄が書き換わったままなら 2,000ms で not-confirmed で、\\r を送り直さない',
    async (_label, text, echo, afterEnter) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, byWrites(input('empty'), input(echo), input(afterEnter)))
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toEqual({
        kind: 'failed',
        reason: 'not-confirmed'
      })
      expect(fake.writes).toEqual([buildAgentPasteBytes(buildCopilotPasteText(text)), '\r'])
      expect(fake.readTimes[fake.readTimes.length - 1] - fake.writeTimes[1]).toBe(
        COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS
      )
    }
  )

  it('Enter から 2,000ms ちょうどに空になれば sent', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes, lastWriteAt }) => {
      if (writes.length === 0) return input('empty')
      if (writes.length === 1) return input('atPaste')
      const enteredAt = lastWriteAt ?? 0
      return now - enteredAt >= COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS
        ? input('aeInstantEnd')
        : input('atEnter')
    })
    await expect(sendCopilotPrompt(fake, 'look at @file', clock)).resolves.toMatchObject({
      kind: 'sent'
    })
    expect(fake.writes).toHaveLength(2)
  })
})

describe('sendCopilotPrompt: 画面の読み取りの例外', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Enter の後に画面を読めなくなったら reject せず not-confirmed で、\\r を送り直さない(送れていることがあり、送り直させない)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ writes }) => {
      if (writes.length === 0) return input('empty')
      if (writes.length === 1) return input('multiPasted')
      throw new Error('画面を読めない')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-confirmed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI), '\r'])
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('貼り付けの後、echo を待つ間に画面を読めなくなったら reject せず not-echoed で、Enter を送らず console.error に残す(本文は入力欄に残りうる)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ writes }) => {
      if (writes.length === 0) return input('empty')
      throw new Error('画面を読めない')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI)])
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('Enter の前に画面を読めなければ reject する(何も送っていないので、呼び出し側が例外の文言にする)', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => {
      throw new Error('画面を読めない')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).rejects.toThrow('画面を読めない')
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: 本文と bracketed paste', () => {
  it.each<[string, AgentSendFailure]>([
    ['/help', 'leading-slash'],
    ['!ls', 'leading-bang']
  ])('断る本文 %j は画面を読まず、何も書かない(%s)', async (text, reason) => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('empty'))
    await expect(sendCopilotPrompt(fake, text, clock)).resolves.toEqual({ kind: 'failed', reason })
    expect(fake.readTimes).toEqual([])
    expect(fake.writes).toEqual([])
  })

  it('bracketed paste が無効なら not-accepting で、画面を読まず何も書かない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('empty'))
    fake.bracketed = false
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-accepting'
    })
    expect(fake.readTimes).toEqual([])
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: 末尾の @ の語(末尾に空白を 1 つ足して貼る。L-414)', () => {
  it.each(['look at @file', '本文\n\n参照:\n- @src/app.ts', 'look at @file\n', 'look at @file  '])(
    '%j は、末尾の空白を除いて空白を 1 つ足した本文を貼る',
    async (text) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, sendableFlow)
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toMatchObject({ kind: 'sent' })
      expect(fake.writes).toEqual([buildAgentPasteBytes(`${text.trimEnd()} `), '\r'])
    }
  )

  it.each(['mail a@b.com', '@file then explain', 'fix #12'])(
    '末尾の語が @ で始まらない %j は空白を足さない',
    async (text) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, sendableFlow)
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toMatchObject({ kind: 'sent' })
      expect(fake.writes).toEqual([buildAgentPasteBytes(text), '\r'])
    }
  )

  it.each<[string, string, CopilotInputScreenName, CopilotInputScreenName]>([
    ['参照 1 つ(atref2)', '本文\n\n- @file.txt', 'atref2Paste', 'atref2Enter1'],
    ['参照 2 つ(atref8)', '本文\n\n- @file.txt\n- @file2.txt', 'atref8Paste', 'atref8Enter1']
  ])(
    '記録の列(空白を足して貼った形): %s は \\r を 1 回送って sent',
    async (_label, text, echo, afterEnter) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, byWrites(input('empty'), input(echo), input(afterEnter)))
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toEqual({
        kind: 'sent',
        clearedDraft: false
      })
      expect(fake.writes).toEqual([buildAgentPasteBytes(`${text} `), '\r'])
    }
  )

  it('記録の列(空白を足さずに貼った形 atref1Paste → atref1Enter1。Enter が補完に取られた)は 2,000ms で not-confirmed で、\\r を送り直さない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('atref1Paste'), input('atref1Enter1'))
    )
    await expect(sendCopilotPrompt(fake, '本文\n\n- @file.txt', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-confirmed'
    })
    expect(fake.writes.filter((data) => data === '\r')).toHaveLength(1)
  })
})

describe('buildCopilotPasteText', () => {
  it.each([
    ['look at @file', 'look at @file '],
    ['本文\n\n参照:\n- @src/app.ts', '本文\n\n参照:\n- @src/app.ts '],
    ['look at @file\n', 'look at @file '],
    ['look at @file  ', 'look at @file '],
    // 末尾が @ だけ
    ['@', '@ '],
    // 末尾の @ の語の前が改行・タブ
    ['以下を見て\n@src/app.ts', '以下を見て\n@src/app.ts '],
    ['見て\t@a.ts', '見て\t@a.ts '],
    // 参照が 2 つ
    ['- @a.ts\n- @b.ts', '- @a.ts\n- @b.ts '],
    // 本文の途中だけに @ の語がある
    ['see @a.ts and explain', 'see @a.ts and explain'],
    ['mail a@b.com', 'mail a@b.com'],
    ['@file then explain', '@file then explain'],
    ['fix #12', 'fix #12']
  ])('%j → %j', (text, expected) => {
    expect(buildCopilotPasteText(text)).toBe(expected)
  })
})

// 1 回の読み取りの判定(純粋関数)。待ちの関数(読み直しの間隔・上限)とは別に、画面だけから決まることを確かめる
describe('checkCopilotInputBeforePaste', () => {
  const noInputBox = screenFromTexts([' ● 前の応答', '', ''])
  it.each<[string, ViewportLine[], CopilotPrePasteCheck]>([
    ['空(empty)', input('empty'), { kind: 'empty' }],
    ['一時的な帯(spacesEsc1)', input('spacesEsc1'), { kind: 'undetermined' }],
    [
      '書きかけ(afterTurn1char)',
      input('afterTurn1char'),
      { kind: 'blocked', reason: 'draft-present' }
    ],
    ['シェルのモード(shellEmpty)', input('shellEmpty'), { kind: 'blocked', reason: 'shell-mode' }],
    [
      '作業中(working3000)',
      copilotScreen('working3000').lines,
      { kind: 'blocked', reason: 'screen-working' }
    ],
    [
      '許可待ち(permission)',
      copilotScreen('permission').lines,
      { kind: 'blocked', reason: 'screen-permission' }
    ],
    [
      '確認待ち(trust)',
      copilotScreen('trust').lines,
      { kind: 'blocked', reason: 'screen-confirm' }
    ],
    // 入力欄が無い画面は idle にならないので、活動の判定で止まる
    ['入力欄が無い(手書き)', noInputBox, { kind: 'blocked', reason: 'screen-unknown' }]
  ])('%s → %j', (_label, screen, expected) => {
    expect(checkCopilotInputBeforePaste(screen)).toEqual(expected)
  })
})

describe('checkCopilotPasteEcho', () => {
  it('貼った本文が入力欄に現れた画面は echoed', () => {
    expect(checkCopilotPasteEcho(echoScreenOf(MULTI), MULTI)).toBe('echoed')
  })

  it('入力欄が空のまま(まだ現れていない)は pending', () => {
    expect(checkCopilotPasteEcho(input('empty'), MULTI)).toBe('pending')
  })

  it('シェルのモードに入った画面は shell(Enter を送らない側)', () => {
    expect(checkCopilotPasteEcho(input('shellDraft'), MULTI)).toBe('shell')
  })

  it('入力欄が無い画面は pending(読み直す。上限は待ちの関数が決める)', () => {
    expect(checkCopilotPasteEcho(screenFromTexts([' ● 前の応答', '', '']), MULTI)).toBe('pending')
  })
})
