// src/renderer/src/lib/__tests__/agentPermissionAnswer.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Terminal } from '@xterm/headless'
import {
  AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS,
  AGENT_PERMISSION_ANSWER_COOLDOWN_MS,
  checkAgentPermissionAnswerAtPress,
  getAgentPermissionAnswerAvailability,
  isAgentPermissionAnswerVisible
} from '../agentPermissionAnswer'
import type { AgentPermissionAnswerAvailabilityInput } from '../agentPermissionAnswer'
import type { AgentPermissionChoice, AgentPermissionPrompt } from '../agentPermissionPrompt'
import { isViewportAtBottom, lineText, readScreenLines } from '../agentViewport'
import { readAgentPermissionPromptOrThrow } from '../../__tests__/readAgentPermissionPromptOrThrow'
import type { AgentActivity } from '../agentActivity'
import type { AgentSessionStatus } from '../agentSessionTabState'
import type { ViewportLine } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT,
  AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED,
  AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED,
  AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNotPermissionReason,
  agentPermissionAnswerNotRunningReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerOptionMissingReason,
  agentPermissionAnswerUnsupportedReason
} from '../agentPermissionAnswerMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 能力が無い種類の理由を確かめるため、能力の表を種類ごとに差し替える
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    permissionAnswerUnsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

afterEach(() => {
  capabilityOverrides.unsupportedKinds.clear()
  capabilityOverrides.permissionAnswerUnsupportedKinds?.clear()
})

const rowOf = (lines: readonly ViewportLine[], text: string): number => {
  const y = lines.findIndex((line) => lineText(line).includes(text))
  if (y < 0) throw new Error(`行が見つかりません: ${text}`)
  return y
}
const withRow = (lines: readonly ViewportLine[], y: number, text: string): ViewportLine[] =>
  lines.map((line, index) => (index === y ? makeLine(text) : line))

const CLAUDE_SCREEN = agentScreen('permission').lines
const CLAUDE_PROMPT = readAgentPermissionPromptOrThrow('claude', CLAUDE_SCREEN)
const COPILOT_SCREEN = copilotScreen('permission').lines
const COPILOT_PROMPT = readAgentPermissionPromptOrThrow('copilot', COPILOT_SCREEN)
// claude で Tab を押して Yes を入力の形にした画面(文言が変わり Tab to amend が消える)
const CLAUDE_AMENDED_SCREEN = withRow(
  withRow(CLAUDE_SCREEN, 18, ' ❯ 1. Yes, '),
  24,
  ' Esc to cancel'
)

const READY: AgentPermissionAnswerAvailabilityInput = {
  status: 'running',
  cliKind: 'claude',
  isClosing: false,
  activity: 'permission',
  isSending: false,
  isSendConfirmOpen: false,
  isInterrupting: false,
  isAnswering: false,
  isJustAppeared: false,
  isPanelOpen: true,
  isScrolledToBottom: true,
  prompt: CLAUDE_PROMPT
}

const STATUSES: readonly AgentSessionStatus[] = ['none', 'starting', 'running', 'exited']
const ACTIVITIES: readonly AgentActivity[] = ['working', 'idle', 'permission', 'confirm', 'unknown']
// 設計書「押せない理由の文言」の表の順(閉じる途中 → 送信中 → 確認の表示中 → 中断の流れ → 答えた直後)。確認が出た直後は
// 読み取りに依る理由より後(それさえ無ければ押せるときだけ出す理由)なので、ここには入れない
const FLAGS = [
  'isClosing',
  'isSending',
  'isSendConfirmOpen',
  'isInterrupting',
  'isAnswering'
] as const
type Flag = (typeof FLAGS)[number]
const FLAG_REASONS: Record<Flag, string> = {
  isClosing: AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  isSending: AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  isSendConfirmOpen: AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  isInterrupting: AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  isAnswering: AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN
}
// copilot で 拒否 の後に入力欄が開き、文字を打った画面の読み取り(最後の選択肢の文言が打った文字に替わる。番号キーが効かない)
const COPILOT_INPUT_OPEN_PROMPT: AgentPermissionPrompt = (() => {
  const prompt = readAgentPermissionPromptOrThrow('copilot', copilotScreen('permissionDown').lines)
  const last = prompt.options[prompt.options.length - 1]
  return {
    ...prompt,
    numberKeysAccepted: false,
    options: [...prompt.options.slice(0, -1), { ...last, text: 'Do nothing and stop' }]
  }
})()

describe('AGENT_PERMISSION_ANSWER_COOLDOWN_MS', () => {
  it('押してから押せない間は 1,000ms(中断と同じ)', () => {
    expect(AGENT_PERMISSION_ANSWER_COOLDOWN_MS).toBe(1_000)
  })
})

describe('AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS', () => {
  it('許可の確認が出てから押せない間は 1,000ms', () => {
    expect(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS).toBe(1_000)
  })
})

describe('isAgentPermissionAnswerVisible', () => {
  it('running・能力あり・permission のときだけ真', () => {
    expect(isAgentPermissionAnswerVisible(READY)).toBe(true)
    expect(isAgentPermissionAnswerVisible({ ...READY, cliKind: 'copilot' })).toBe(true)
  })

  it.each(STATUSES.filter((status) => status !== 'running'))('%s のタブは偽', (status) => {
    expect(isAgentPermissionAnswerVisible({ ...READY, status })).toBe(false)
  })

  it.each(ACTIVITIES.filter((activity) => activity !== 'permission'))(
    '活動が %s なら偽',
    (activity) => {
      expect(isAgentPermissionAnswerVisible({ ...READY, activity })).toBe(false)
    }
  )

  it('能力の permissionAnswer が偽の種類は偽', () => {
    capabilityOverrides.permissionAnswerUnsupportedKinds?.add('claude')
    expect(isAgentPermissionAnswerVisible(READY)).toBe(false)
  })

  // 出す条件と読む条件を 1 か所で決める: 判定の visible と食い違わない(押せない理由・読み取りの値に依らない)
  it.each(STATUSES.flatMap((status) => ACTIVITIES.map((activity) => [status, activity] as const)))(
    '%s・%s: getAgentPermissionAnswerAvailability の visible と同じ',
    (status, activity) => {
      for (const flags of [{}, { isClosing: true, isAnswering: true, prompt: null }]) {
        const input = { ...READY, ...flags, status, activity }
        expect(isAgentPermissionAnswerVisible(input)).toBe(
          getAgentPermissionAnswerAvailability(input, 'allow').visible
        )
      }
    }
  )
})

describe('getAgentPermissionAnswerAvailability', () => {
  it('許可待ちで読み取れ、どの理由にも当たらなければ押せる。送る選択肢は返さない(送る番号は押した時点の判定の結果だけ。L-594)', () => {
    expect(getAgentPermissionAnswerAvailability(READY, 'allow')).toEqual({
      visible: true,
      reason: null
    })
    expect(getAgentPermissionAnswerAvailability(READY, 'deny')).toEqual({
      visible: true,
      reason: null
    })
  })

  // 状態(4)× 活動(5): running で permission のときだけ出す
  it.each(STATUSES.flatMap((status) => ACTIVITIES.map((activity) => [status, activity] as const)))(
    '%s・%s: running・permission のときだけ出し、出さないときは帯に出さない理由を持つ',
    (status, activity) => {
      const result = getAgentPermissionAnswerAvailability({ ...READY, status, activity }, 'allow')
      if (status !== 'running') {
        expect(result).toEqual({
          visible: false,
          reason: agentPermissionAnswerNotRunningReason('claude')
        })
        return
      }
      if (activity !== 'permission') {
        expect(result).toEqual({
          visible: false,
          reason: agentPermissionAnswerNotPermissionReason('claude')
        })
        return
      }
      expect(result.visible).toBe(true)
      expect(result.reason).toBeNull()
    }
  )

  it('能力が無い種類は出さず、能力が無い理由を持つ(動いていない の次・許可待ちでない より前)', () => {
    capabilityOverrides.unsupportedKinds.add('claude')
    expect(getAgentPermissionAnswerAvailability({ ...READY, activity: 'idle' }, 'allow')).toEqual({
      visible: false,
      reason: agentPermissionAnswerUnsupportedReason('claude')
    })
  })

  it('permissionAnswer だけが偽の種類(screenActivity は真)も、能力が無い理由を持つ(能力の項目を読んでいる)', () => {
    capabilityOverrides.permissionAnswerUnsupportedKinds?.add('claude')
    expect(getAgentPermissionAnswerAvailability({ ...READY, activity: 'idle' }, 'allow')).toEqual({
      visible: false,
      reason: agentPermissionAnswerUnsupportedReason('claude')
    })
  })

  it('順序: 閉じる途中でも許可待ちでなければ、帯に出さない理由が先(閉じる途中ではない)', () => {
    expect(
      getAgentPermissionAnswerAvailability(
        { ...READY, isClosing: true, activity: 'working' },
        'allow'
      )
    ).toEqual({
      visible: false,
      reason: agentPermissionAnswerNotPermissionReason('claude')
    })
  })

  it('順序: 動いていない が 能力が無い より先', () => {
    capabilityOverrides.unsupportedKinds.add('claude')
    expect(getAgentPermissionAnswerAvailability({ ...READY, status: 'exited' }, 'allow')).toEqual({
      visible: false,
      reason: agentPermissionAnswerNotRunningReason('claude')
    })
  })

  // 閉じる途中・送信中・確認の表示中・中断の流れ・答えた直後(32 の組)× 確認が出た直後の有無。最初に当たった理由。
  // 確認が出た直後は、ほかのどれにも当たらないときだけの理由
  it.each(
    Array.from({ length: 2 ** FLAGS.length }, (_, bits) =>
      [false, true].map((isJustAppeared) => ({
        flags: FLAGS.filter((_flag, index) => (bits & (1 << index)) !== 0),
        isJustAppeared
      }))
    ).flat()
  )(
    '当たる理由 $flags(確認が出た直後: $isJustAppeared)の順',
    ({ flags, isJustAppeared }: { flags: Flag[]; isJustAppeared: boolean }) => {
      const input: AgentPermissionAnswerAvailabilityInput = { ...READY, isJustAppeared }
      for (const flag of flags) input[flag] = true
      const expected = FLAGS.find((flag) => flags.includes(flag))
      const result = getAgentPermissionAnswerAvailability(input, 'allow')
      expect(result.visible).toBe(true)
      const fallback = isJustAppeared ? AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED : null
      expect(result.reason).toBe(expected === undefined ? fallback : FLAG_REASONS[expected])
    }
  )

  it('答えた直後(読み直し待ちで prompt が null)は「読み取れない」ではなく「答えを押した直後です」', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...READY, isAnswering: true, prompt: null }, 'allow')
        .reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
  })

  it('確認が出た直後は、読み取れない・番号キーが効かない・その選択肢が無い より後(待っても押せない理由を隠さない)', () => {
    expect(
      getAgentPermissionAnswerAvailability(
        { ...READY, isJustAppeared: true, prompt: null },
        'allow'
      ).reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE)
    const noYes = { ...CLAUDE_PROMPT, options: [{ number: 1, text: 'No' }] }
    expect(
      getAgentPermissionAnswerAvailability(
        { ...READY, isJustAppeared: true, prompt: noYes },
        'allow'
      ).reason
    ).toBe(agentPermissionAnswerOptionMissingReason('allow'))
  })

  it.each<AgentPermissionChoice>(['allow', 'deny'])(
    'copilot の入力欄が開いた読み取り(番号キーが効かない)で確認が出た直後でも、%s は番号キーが効かない理由(文字を打つたびに猶予が始め直されても隠れない)',
    (choice) => {
      expect(COPILOT_INPUT_OPEN_PROMPT.numberKeysAccepted).toBe(false)
      expect(
        getAgentPermissionAnswerAvailability(
          { ...READY, cliKind: 'copilot', isJustAppeared: true, prompt: COPILOT_INPUT_OPEN_PROMPT },
          choice
        ).reason
      ).toBe(agentPermissionAnswerNumberKeysRejectedReason('copilot'))
    }
  )

  it('読み取れない → 番号キーが効かない → その選択肢が無い の順', () => {
    expect(getAgentPermissionAnswerAvailability({ ...READY, prompt: null }, 'allow').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    )
    const rejected = { ...CLAUDE_PROMPT, numberKeysAccepted: false, options: [] }
    expect(
      getAgentPermissionAnswerAvailability({ ...READY, prompt: rejected }, 'allow').reason
    ).toBe(agentPermissionAnswerNumberKeysRejectedReason('claude'))
    const noYes = { ...CLAUDE_PROMPT, options: [{ number: 1, text: 'No' }] }
    expect(getAgentPermissionAnswerAvailability({ ...READY, prompt: noYes }, 'allow').reason).toBe(
      agentPermissionAnswerOptionMissingReason('allow')
    )
    expect(
      getAgentPermissionAnswerAvailability({ ...READY, prompt: noYes }, 'deny').reason
    ).toBeNull()
  })

  it('copilot の permissionDown(カーソルが最後の選択肢)は、copilot の番号キーの理由', () => {
    const prompt = readAgentPermissionPromptOrThrow(
      'copilot',
      copilotScreen('permissionDown').lines
    )
    expect(
      getAgentPermissionAnswerAvailability({ ...READY, cliKind: 'copilot', prompt }, 'allow').reason
    ).toBe(agentPermissionAnswerNumberKeysRejectedReason('copilot'))
  })
})

describe('getAgentPermissionAnswerAvailability: パネルを閉じている間', () => {
  const CLOSED: AgentPermissionAnswerAvailabilityInput = { ...READY, isPanelOpen: false }

  it('許可 だけが押せず、パネルを閉じている理由を持つ。拒否 は押せる(実行されない側)。どちらも帯には出す', () => {
    expect(getAgentPermissionAnswerAvailability(CLOSED, 'allow')).toEqual({
      visible: true,
      reason: AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED
    })
    expect(getAgentPermissionAnswerAvailability(CLOSED, 'deny')).toEqual({
      visible: true,
      reason: null
    })
  })

  it.each(FLAGS)('順序: %s はパネルを閉じている理由より先', (flag) => {
    expect(getAgentPermissionAnswerAvailability({ ...CLOSED, [flag]: true }, 'allow').reason).toBe(
      FLAG_REASONS[flag]
    )
  })

  it('順序: 読み取れない・番号キーが効かない・その選択肢が無い はパネルを閉じている理由より先(開いても押せない理由を隠さない)', () => {
    expect(getAgentPermissionAnswerAvailability({ ...CLOSED, prompt: null }, 'allow').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    )
    const rejected = { ...CLAUDE_PROMPT, numberKeysAccepted: false }
    expect(
      getAgentPermissionAnswerAvailability({ ...CLOSED, prompt: rejected }, 'allow').reason
    ).toBe(agentPermissionAnswerNumberKeysRejectedReason('claude'))
    const noYes = { ...CLAUDE_PROMPT, options: [{ number: 1, text: 'No' }] }
    expect(getAgentPermissionAnswerAvailability({ ...CLOSED, prompt: noYes }, 'allow').reason).toBe(
      agentPermissionAnswerOptionMissingReason('allow')
    )
  })

  it('順序: パネルを閉じている理由は確認が出た直後より先(待っても押せない)。拒否 は確認が出た直後の理由', () => {
    const input = { ...CLOSED, isJustAppeared: true }
    expect(getAgentPermissionAnswerAvailability(input, 'allow').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED
    )
    expect(getAgentPermissionAnswerAvailability(input, 'deny').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED
    )
  })

  it('帯に出さない理由はパネルを閉じている理由より先', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...CLOSED, activity: 'working' }, 'allow')
    ).toEqual({ visible: false, reason: agentPermissionAnswerNotPermissionReason('claude') })
  })
})

describe('getAgentPermissionAnswerAvailability: 本文の上の端が画面に無い間', () => {
  const CUT: AgentPermissionAnswerAvailabilityInput = {
    ...READY,
    prompt: { ...CLAUDE_PROMPT, bodyStartVisible: false }
  }

  it('許可 だけが押せず、本文が欠けている理由を持つ。拒否 は押せる(実行されない側)。どちらも帯には出す', () => {
    expect(getAgentPermissionAnswerAvailability(CUT, 'allow')).toEqual({
      visible: true,
      reason: AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT
    })
    expect(getAgentPermissionAnswerAvailability(CUT, 'deny')).toEqual({
      visible: true,
      reason: null
    })
  })

  it.each(FLAGS)('順序: %s は本文が欠けている理由より先', (flag) => {
    expect(getAgentPermissionAnswerAvailability({ ...CUT, [flag]: true }, 'allow').reason).toBe(
      FLAG_REASONS[flag]
    )
  })

  it('順序: 番号キーが効かない・その選択肢が無い は本文が欠けている理由より先', () => {
    const cut = { ...CLAUDE_PROMPT, bodyStartVisible: false }
    expect(
      getAgentPermissionAnswerAvailability(
        { ...CUT, prompt: { ...cut, numberKeysAccepted: false } },
        'allow'
      ).reason
    ).toBe(agentPermissionAnswerNumberKeysRejectedReason('claude'))
    expect(
      getAgentPermissionAnswerAvailability(
        { ...CUT, prompt: { ...cut, options: [{ number: 1, text: 'No' }] } },
        'allow'
      ).reason
    ).toBe(agentPermissionAnswerOptionMissingReason('allow'))
  })

  it('順序: パネルを閉じている理由は本文が欠けている理由より先(まず開いてもらう)', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...CUT, isPanelOpen: false }, 'allow').reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED)
  })

  it('順序: 本文が欠けている理由は確認が出た直後より先(待っても押せない)。拒否 は確認が出た直後の理由', () => {
    const input = { ...CUT, isJustAppeared: true }
    expect(getAgentPermissionAnswerAvailability(input, 'allow').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT
    )
    expect(getAgentPermissionAnswerAvailability(input, 'deny').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED
    )
  })
})

describe('getAgentPermissionAnswerAvailability: ターミナルを上へスクロールしている間', () => {
  const SCROLLED: AgentPermissionAnswerAvailabilityInput = { ...READY, isScrolledToBottom: false }

  it('許可 だけが押せず、スクロールしている理由を持つ。拒否 は押せる(実行されない側)。どちらも帯には出す', () => {
    expect(getAgentPermissionAnswerAvailability(SCROLLED, 'allow')).toEqual({
      visible: true,
      reason: AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    })
    expect(getAgentPermissionAnswerAvailability(SCROLLED, 'deny')).toEqual({
      visible: true,
      reason: null
    })
  })

  it.each(FLAGS)('順序: %s はスクロールしている理由より先', (flag) => {
    expect(
      getAgentPermissionAnswerAvailability({ ...SCROLLED, [flag]: true }, 'allow').reason
    ).toBe(FLAG_REASONS[flag])
  })

  it('順序: 読み取れない・番号キーが効かない・その選択肢が無い はスクロールしている理由より先', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...SCROLLED, prompt: null }, 'allow').reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE)
    expect(
      getAgentPermissionAnswerAvailability(
        { ...SCROLLED, prompt: { ...CLAUDE_PROMPT, numberKeysAccepted: false } },
        'allow'
      ).reason
    ).toBe(agentPermissionAnswerNumberKeysRejectedReason('claude'))
    expect(
      getAgentPermissionAnswerAvailability(
        { ...SCROLLED, prompt: { ...CLAUDE_PROMPT, options: [{ number: 1, text: 'No' }] } },
        'allow'
      ).reason
    ).toBe(agentPermissionAnswerOptionMissingReason('allow'))
  })

  it('順序: パネルを閉じている理由はスクロールしている理由より先(まず開いてもらう)', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...SCROLLED, isPanelOpen: false }, 'allow').reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED)
  })

  it('順序: スクロールしている理由は本文が欠けている理由より先(末尾へ戻した後の高さで決まる)', () => {
    expect(
      getAgentPermissionAnswerAvailability(
        { ...SCROLLED, prompt: { ...CLAUDE_PROMPT, bodyStartVisible: false } },
        'allow'
      ).reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP)
  })

  it('順序: スクロールしている理由は確認が出た直後より先(待っても押せない)。拒否 は確認が出た直後の理由', () => {
    const input = { ...SCROLLED, isJustAppeared: true }
    expect(getAgentPermissionAnswerAvailability(input, 'allow').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    )
    expect(getAgentPermissionAnswerAvailability(input, 'deny').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED
    )
  })

  it('帯に出さない理由はスクロールしている理由より先', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...SCROLLED, activity: 'working' }, 'allow')
    ).toEqual({ visible: false, reason: agentPermissionAnswerNotPermissionReason('claude') })
  })
})

describe('checkAgentPermissionAnswerAtPress: 実物の xterm のバッファ(@xterm/headless)でスクロールしたとき', () => {
  let terminal: Terminal | null = null
  afterEach(() => {
    terminal?.dispose()
    terminal = null
  })

  const write = (term: Terminal, data: string): Promise<void> =>
    new Promise((resolve) => term.write(data, resolve))
  /** 記録の行を、dim・反転の SGR 付きの書き込みにする */
  const toEscapes = (line: ViewportLine): string => {
    let out = ''
    let dim = false
    let inverse = false
    for (const cell of line) {
      if (cell.dim !== dim) out += cell.dim ? '\x1b[2m' : '\x1b[22m'
      if (cell.inverse !== inverse) out += cell.inverse ? '\x1b[7m' : '\x1b[27m'
      dim = cell.dim
      inverse = cell.inverse
      out += cell.char
    }
    return out + '\x1b[0m'
  }
  /** 前の出力(スクロールバック)の後に記録の画面を描く。alternate なら代替画面に描く(copilot) */
  const drawScreen = async (
    screen: { cols: number; rows: number; lines: ViewportLine[] },
    alternate: boolean
  ): Promise<Terminal> => {
    const term = new Terminal({ cols: screen.cols, rows: screen.rows, allowProposedApi: true })
    terminal = term
    await write(term, Array.from({ length: 40 }, (_, i) => `old output ${i}`).join('\r\n') + '\r\n')
    if (alternate) await write(term, '\x1b[?1049h\x1b[H')
    else await write(term, '\x1b[2J\x1b[H')
    await write(term, screen.lines.map(toEscapes).join('\r\n'))
    return term
  }
  const pressOn = (
    term: Terminal,
    base: AgentPermissionAnswerAvailabilityInput,
    choice: AgentPermissionChoice
  ): ReturnType<typeof checkAgentPermissionAnswerAtPress> =>
    checkAgentPermissionAnswerAtPress(
      { ...base, isScrolledToBottom: isViewportAtBottom(term.buffer.active) },
      choice,
      () => readScreenLines(term.buffer.active, term.rows)
    )

  it('claude: 上へスクロールした間は 許可 を送らず(画面の末尾は読める)、拒否 は送る。末尾へ戻すと 許可 も送る', async () => {
    const term = await drawScreen(agentScreen('permission'), false)
    const drawn = readAgentPermissionPromptOrThrow(
      'claude',
      readScreenLines(term.buffer.active, term.rows)
    )
    const input = { ...READY, prompt: drawn }
    term.scrollLines(-3)
    // 前提: スクロールで戻している(表示中の範囲と画面の末尾がずれている)
    expect(term.buffer.active.viewportY).toBeLessThan(term.buffer.active.baseY)
    expect(pressOn(term, input, 'allow')).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    })
    expect(pressOn(term, input, 'deny')).toEqual({ kind: 'send', optionNumber: 4 })
    term.scrollToBottom()
    expect(pressOn(term, input, 'allow')).toEqual({ kind: 'send', optionNumber: 1 })
  })

  it('copilot(代替画面)はスクロールバックが無く、上へスクロールしても末尾のままで 許可 を送る', async () => {
    const term = await drawScreen(copilotScreen('permission'), true)
    const drawn = readAgentPermissionPromptOrThrow(
      'copilot',
      readScreenLines(term.buffer.active, term.rows)
    )
    term.scrollLines(-3)
    expect(isViewportAtBottom(term.buffer.active)).toBe(true)
    expect(pressOn(term, { ...READY, cliKind: 'copilot', prompt: drawn }, 'allow')).toEqual({
      kind: 'send',
      optionNumber: 1
    })
  })
})

describe('checkAgentPermissionAnswerAtPress', () => {
  const readerOf = (
    lines: readonly ViewportLine[]
  ): ReturnType<typeof vi.fn<() => readonly ViewportLine[]>> =>
    vi.fn<() => readonly ViewportLine[]>(() => lines)

  it.each<[AgentPermissionChoice, number]>([
    ['allow', 1],
    ['deny', 4]
  ])(
    '押せて、押した時点の画面が描画と同じなら send(%s は %d 番)。画面は 1 回だけ読む',
    (choice, number) => {
      const readScreen = readerOf(CLAUDE_SCREEN)
      expect(checkAgentPermissionAnswerAtPress(READY, choice, readScreen)).toEqual({
        kind: 'send',
        optionNumber: number
      })
      expect(readScreen).toHaveBeenCalledOnce()
    }
  )

  it('パネルを閉じていても、拒否 は画面を読み直して send(4 番)', () => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(
      checkAgentPermissionAnswerAtPress({ ...READY, isPanelOpen: false }, 'deny', readScreen)
    ).toEqual({ kind: 'send', optionNumber: 4 })
    expect(readScreen).toHaveBeenCalledOnce()
  })

  it('ターミナルを上へスクロールしていても、拒否 は画面を読み直して send(4 番)', () => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(
      checkAgentPermissionAnswerAtPress({ ...READY, isScrolledToBottom: false }, 'deny', readScreen)
    ).toEqual({ kind: 'send', optionNumber: 4 })
    expect(readScreen).toHaveBeenCalledOnce()
  })

  it('copilot の拒否は 2 番', () => {
    expect(
      checkAgentPermissionAnswerAtPress(
        { ...READY, cliKind: 'copilot', prompt: COPILOT_PROMPT },
        'deny',
        readerOf(COPILOT_SCREEN)
      )
    ).toEqual({ kind: 'send', optionNumber: 2 })
  })

  it.each<[string, Partial<AgentPermissionAnswerAvailabilityInput>, string]>([
    ['送信中', { isSending: true }, AGENT_PERMISSION_ANSWER_DISABLED_SENDING],
    ['確認の表示中', { isSendConfirmOpen: true }, AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM],
    ['中断の流れの間', { isInterrupting: true }, AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING],
    ['答えた直後', { isAnswering: true }, AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN],
    ['確認が出た直後', { isJustAppeared: true }, AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED],
    ['パネルを閉じている', { isPanelOpen: false }, AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED],
    [
      'ターミナルを上へスクロールしている',
      { isScrolledToBottom: false },
      AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    ],
    [
      '描画の読み取りで本文の上の端が無い',
      { prompt: { ...CLAUDE_PROMPT, bodyStartVisible: false } },
      AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT
    ],
    ['許可待ちでない', { activity: 'working' }, agentPermissionAnswerNotPermissionReason('claude')]
  ])('段階 (a) %s で止まれば、画面を読まずに blocked', (_name, change, reason) => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(checkAgentPermissionAnswerAtPress({ ...READY, ...change }, 'allow', readScreen)).toEqual(
      {
        kind: 'blocked',
        reason
      }
    )
    expect(readScreen).not.toHaveBeenCalled()
  })

  it('段階 (a) copilot の入力欄が開いた読み取りで確認が出た直後は、番号キーが効かない理由で画面を読まずに blocked', () => {
    const readScreen = readerOf(COPILOT_SCREEN)
    expect(
      checkAgentPermissionAnswerAtPress(
        { ...READY, cliKind: 'copilot', isJustAppeared: true, prompt: COPILOT_INPUT_OPEN_PROMPT },
        'allow',
        readScreen
      )
    ).toEqual({ kind: 'blocked', reason: agentPermissionAnswerNumberKeysRejectedReason('copilot') })
    expect(readScreen).not.toHaveBeenCalled()
  })

  it('段階 (a): 閉じる途中は、画面を読まずに blocked', () => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(
      checkAgentPermissionAnswerAtPress({ ...READY, isClosing: true }, 'allow', readScreen)
    ).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_DISABLED_CLOSING
    })
    expect(readScreen).not.toHaveBeenCalled()
  })

  it('段階 (a): 描画時の prompt が null なら、画面を読まずに blocked(読み取れない)', () => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(
      checkAgentPermissionAnswerAtPress({ ...READY, prompt: null }, 'allow', readScreen)
    ).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    })
    expect(readScreen).not.toHaveBeenCalled()
  })

  it('段階 (b): 押した時点の画面が許可待ちでなければ blocked(許可待ちではなくなりました)', () => {
    expect(
      checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(agentScreen('empty').lines))
    ).toEqual({ kind: 'blocked', reason: agentPermissionAnswerNoLongerPermissionReason('claude') })
  })

  it('段階 (b): readScreen が投げたら unreadable', () => {
    const error = new Error('disposed')
    expect(
      checkAgentPermissionAnswerAtPress(READY, 'allow', () => {
        throw error
      })
    ).toEqual({ kind: 'unreadable', error })
  })

  it('段階 (d): 描画は permission、押した時点は permissionDown(copilot)なら番号キーの理由', () => {
    expect(
      checkAgentPermissionAnswerAtPress(
        { ...READY, cliKind: 'copilot', prompt: COPILOT_PROMPT },
        'allow',
        readerOf(copilotScreen('permissionDown').lines)
      )
    ).toEqual({ kind: 'blocked', reason: agentPermissionAnswerNumberKeysRejectedReason('copilot') })
  })

  // 列: 種類・描画に使った読み取り・押した時点の画面(番号キーが効かない形)
  it.each<[AgentCliKind, AgentPermissionPrompt, readonly ViewportLine[]]>([
    ['claude', CLAUDE_PROMPT, CLAUDE_AMENDED_SCREEN],
    ['copilot', COPILOT_PROMPT, copilotScreen('permissionDown').lines]
  ])(
    '段階 (d) の理由は、押した時点の画面を描画に使ったときの理由と同じ(番号キーの規則を 1 か所で決める): %s',
    (cliKind, prompt, pressedLines) => {
      const pressed = readAgentPermissionPromptOrThrow(cliKind, pressedLines)
      const input = { ...READY, cliKind, prompt }
      expect(checkAgentPermissionAnswerAtPress(input, 'allow', readerOf(pressedLines))).toEqual({
        kind: 'blocked',
        reason: getAgentPermissionAnswerAvailability({ ...input, prompt: pressed }, 'allow').reason
      })
    }
  )

  it('段階 (d) は (e) より先: claude で Tab を押して Yes を入力の形にした画面(文言が変わり Tab to amend が消える)は番号キーの理由', () => {
    expect(
      checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(CLAUDE_AMENDED_SCREEN))
    ).toEqual({
      kind: 'blocked',
      reason: agentPermissionAnswerNumberKeysRejectedReason('claude')
    })
  })

  it('段階 (e): 本文(コマンド)だけを変えた画面は、内容が変わった', () => {
    const changed = withRow(CLAUDE_SCREEN, 15, ' rm -rf build')
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(changed))).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_PROMPT_CHANGED
    })
  })

  it('段階 (e): 問いだけを変えた画面は、内容が変わった', () => {
    const changed = withRow(
      CLAUDE_SCREEN,
      rowOf(CLAUDE_SCREEN, 'Do you want to proceed?'),
      ' Do you want to continue?'
    )
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(changed))).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_PROMPT_CHANGED
    })
  })

  it('段階 (e): 選択肢の文言だけを変えた画面(件数は同じ)は、内容が変わった', () => {
    const changed = withRow(CLAUDE_SCREEN, rowOf(CLAUDE_SCREEN, '4. No'), '   4. Nope')
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(changed))).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_PROMPT_CHANGED
    })
  })

  describe('段階 (f) の後: 押した時点の読み取りで本文の上の端が無い', () => {
    // 全幅の罫線が 1 行目の画面と、1 行流れて罫線だけが画面から消えた画面。本文は同じなので照合(段階 (e))は通る
    const drawnLines = [
      '─'.repeat(60),
      ' Bash command',
      ' sleep 3',
      '',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      '',
      ' Esc to cancel · Tab to amend'
    ].map((row) => makeLine(row))
    const pressedLines = drawnLines.slice(1)
    const drawn = readAgentPermissionPromptOrThrow('claude', drawnLines)
    const input = { ...READY, prompt: drawn }

    it('許可 は送らず、本文が欠けている理由で blocked(押した時点で読み直した値を見る)', () => {
      expect(drawn.bodyStartVisible).toBe(true)
      expect(checkAgentPermissionAnswerAtPress(input, 'allow', readerOf(pressedLines))).toEqual({
        kind: 'blocked',
        reason: AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT
      })
    })

    it('拒否 は送る(2 番)', () => {
      expect(checkAgentPermissionAnswerAtPress(input, 'deny', readerOf(pressedLines))).toEqual({
        kind: 'send',
        optionNumber: 2
      })
    })

    it('本文の上の端が画面にあれば 許可 を送る(1 番)', () => {
      expect(checkAgentPermissionAnswerAtPress(input, 'allow', readerOf(drawnLines))).toEqual({
        kind: 'send',
        optionNumber: 1
      })
    })
  })

  it('段階 (c): 押した時点の画面の形が崩れていれば(カーソルの行が 2 つ)読み取れない', () => {
    const broken = withRow(CLAUDE_SCREEN, 22, ' ❯ 4. No')
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(broken))).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    })
  })
})
