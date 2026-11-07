import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 段階 2b で copilot も送信に対応したため、送信に対応しない種類の理由は能力の表を差し替えて確かめる
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
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
  capabilityOverrides.promptSendUnsupportedKinds.clear()
})
import type { PromptExecutionMode } from '@shared/types'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import type { AgentActivity } from '../agentActivity'
import { AGENT_PROMPT_SEND_SPECS } from '../agentPromptSendSpecs'
import {
  RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE,
  RERUN_DISABLED_AGENT_MODE,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_INTERRUPTING,
  RUN_DISABLED_LOADING_MODE,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING,
  agentPromptSendUnsupportedReason,
  agentSendBlockedByActivityReason,
  rerunDisabledAgentEntryFolderMismatch
} from '../agentSendMessages'
import {
  getHistoryRerunAvailability,
  getPromptRunAvailability,
  getRerunAvailability
} from '../promptRunAvailability'

describe('getPromptRunAvailability', () => {
  const base = {
    cliKind: 'claude' as const,
    activity: 'idle' as const,
    isInterrupting: false,
    isExecuting: false,
    isSessionRunning: false,
    isSessionClosing: false,
    isSending: false
  }
  it.each([
    ['読み込み中', { ...base, mode: null }, { disabled: true, reason: RUN_DISABLED_LOADING_MODE }],
    ['従来の方式・実行中でない', { ...base, mode: 'legacy' }, { disabled: false, reason: null }],
    [
      '従来の方式・実行中(理由は出さない)',
      { ...base, mode: 'legacy', isExecuting: true },
      { disabled: true, reason: null }
    ],
    [
      'エージェント・セッションなし',
      { ...base, mode: 'agent-cli' },
      { disabled: true, reason: RUN_DISABLED_NO_SESSION }
    ],
    [
      'エージェント・送信中',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isSending: true },
      { disabled: true, reason: RUN_DISABLED_SENDING }
    ],
    [
      'エージェント・送り先のタブが閉じる途中(running でも送らない)',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isSessionClosing: true },
      { disabled: true, reason: RUN_DISABLED_CLOSING }
    ],
    [
      '従来の方式は閉じる途中を見ない',
      { ...base, mode: 'legacy', isSessionClosing: true },
      { disabled: false, reason: null }
    ],
    [
      'エージェント・送れる',
      { ...base, mode: 'agent-cli', isSessionRunning: true },
      { disabled: false, reason: null }
    ],
    [
      'エージェント・従来の実行中フラグは見ない(C13)',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isExecuting: true },
      { disabled: false, reason: null }
    ]
  ] as const)('%s', (_label, params, expected) => {
    expect(getPromptRunAvailability(params)).toEqual(expected)
  })
})

describe('getRerunAvailability', () => {
  it.each([
    [
      { mode: null, isExecuting: false },
      { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
    ],
    [
      { mode: 'agent-cli', isExecuting: false },
      { disabled: true, reason: RERUN_DISABLED_AGENT_MODE }
    ],
    [
      { mode: 'legacy', isExecuting: true },
      { disabled: true, reason: null }
    ],
    [
      { mode: 'legacy', isExecuting: false },
      { disabled: false, reason: null }
    ]
  ] as const)('%o', (params, expected) => {
    expect(getRerunAvailability(params)).toEqual(expected)
  })
})

describe('getHistoryRerunAvailability(履歴のエントリごとの 再実行)', () => {
  const base = {
    cliKind: 'claude' as const,
    activity: 'idle' as const,
    isInterrupting: false,
    isExecuting: false,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false,
    folderPath: '/repo'
  }

  it('従来のエントリは今のまま(エージェント CLI 方式では押せない)', () => {
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: null, mode: 'agent-cli' })
    ).toEqual({
      disabled: true,
      reason: RERUN_DISABLED_AGENT_MODE
    })
    expect(
      getHistoryRerunAvailability({
        ...base,
        recordedFolderPath: null,
        mode: 'legacy',
        isExecuting: true
      })
    ).toEqual({ disabled: true, reason: null })
  })

  it('エージェントのエントリは、従来の方式では押せず、読み込み中は読み込みの理由', () => {
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: '/repo', mode: 'legacy' })
    ).toEqual({
      disabled: true,
      reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE
    })
    expect(RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE).toBe(
      'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'
    )
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: '/repo', mode: null })
    ).toEqual({
      disabled: true,
      reason: RUN_DISABLED_LOADING_MODE
    })
  })

  it('エージェントのエントリは、未知の方式(方式を足したとき)をエージェント CLI 方式として押せるようにしない', () => {
    // 型の外の値(方式の列挙を足したときに、この関数を直し忘れた場合)
    const unknownMode = 'remote' as unknown as PromptExecutionMode
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: '/repo', mode: unknownMode })
    ).toEqual({ disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE })
  })

  it('エージェントのエントリは、エージェント CLI 方式では一覧の 実行 と同じ条件(L-048)', () => {
    const agent = { ...base, recordedFolderPath: '/repo', mode: 'agent-cli' as const }
    expect(getHistoryRerunAvailability(agent)).toEqual({ disabled: false, reason: null })
    expect(getHistoryRerunAvailability({ ...agent, isSessionRunning: false })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_NO_SESSION
    })
    expect(getHistoryRerunAvailability({ ...agent, isSessionClosing: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_CLOSING
    })
    expect(getHistoryRerunAvailability({ ...agent, isSending: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_SENDING
    })
  })

  it('エージェントのエントリは、記録したフォルダと違うフォルダ・フォルダを開いていないときは押せない(全文の @相対パス が別のファイルを指すため)', () => {
    const agent = { ...base, recordedFolderPath: '/repo', mode: 'agent-cli' as const }
    const mismatch = { disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/repo') }
    expect(getHistoryRerunAvailability({ ...agent, folderPath: '/other' })).toEqual(mismatch)
    expect(getHistoryRerunAvailability({ ...agent, folderPath: null })).toEqual(mismatch)
    // セッションが無いときもフォルダ違いを先に出す(フォルダを開き直さないと直らないため。このセッションで再開 と同じ順)
    expect(
      getHistoryRerunAvailability({ ...agent, folderPath: '/other', isSessionRunning: false })
    ).toEqual(mismatch)
    expect(rerunDisabledAgentEntryFolderMismatch('/repo')).toBe(
      '記録したフォルダ（/repo）を開いているときだけ再実行できます'
    )
  })

  it('従来のエントリはフォルダに関係なく今のまま', () => {
    expect(
      getHistoryRerunAvailability({
        ...base,
        recordedFolderPath: null,
        mode: 'legacy',
        folderPath: null
      })
    ).toEqual({ disabled: false, reason: null })
  })
})

describe('送信の入口の CLI の種類(送り先のタブの cliKind)', () => {
  // 送信に対応しない種類の扱い(段階 1 の守り)を、能力の表で copilot の送信を偽にして確かめる
  beforeEach(() => {
    capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
  })

  const COPILOT = agentPromptSendUnsupportedReason('copilot')
  const running = {
    mode: 'agent-cli' as const,
    isExecuting: false,
    cliKind: 'copilot' as const,
    activity: 'idle' as const,
    isInterrupting: false,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false
  }

  it('送り先が copilot なら押せず、理由を出す', () => {
    expect(getPromptRunAvailability(running)).toEqual({ disabled: true, reason: COPILOT })
  })

  it('copilot の理由は、閉じる途中・未起動・送信中より先(起動しても送れないため)', () => {
    for (const patch of [
      { isSessionClosing: true },
      { isSessionRunning: false },
      { isSending: true }
    ]) {
      expect(getPromptRunAvailability({ ...running, ...patch })).toEqual({
        disabled: true,
        reason: COPILOT
      })
    }
  })

  it('読み込み中・従来の方式は種類を見ない(従来の方式の判定の直後に見る)', () => {
    expect(getPromptRunAvailability({ ...running, mode: null })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_LOADING_MODE
    })
    expect(getPromptRunAvailability({ ...running, mode: 'legacy' })).toEqual({
      disabled: false,
      reason: null
    })
  })

  it('履歴の再実行(エージェントのエントリ)も同じ理由(getPromptRunAvailability を通る)', () => {
    expect(
      getHistoryRerunAvailability({ ...running, recordedFolderPath: '/repo', folderPath: '/repo' })
    ).toEqual({ disabled: true, reason: COPILOT })
  })
})

describe('押せる条件の活動と中断の流れ(許可待ち・確認待ちはどの種類でも、作業中・不明・中断の流れは requiresIdle の種類だけが見る)', () => {
  const copilotIdle = {
    mode: 'agent-cli' as const,
    isExecuting: false,
    cliKind: 'copilot' as const,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false,
    activity: 'idle' as const,
    isInterrupting: false
  }

  it('copilot が入力待ちで中断の流れの外なら押せる', () => {
    expect(getPromptRunAvailability(copilotIdle)).toEqual({ disabled: false, reason: null })
  })

  it.each(['working', 'permission', 'confirm', 'unknown'] as const)(
    'copilot の活動が %s なら押せず、活動の理由を出す',
    (activity) => {
      expect(getPromptRunAvailability({ ...copilotIdle, activity })).toEqual({
        disabled: true,
        reason: agentSendBlockedByActivityReason(activity, 'copilot')
      })
    }
  )

  it('copilot が中断の流れの間なら RUN_DISABLED_INTERRUPTING(活動の理由より先)', () => {
    expect(getPromptRunAvailability({ ...copilotIdle, isInterrupting: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_INTERRUPTING
    })
    expect(
      getPromptRunAvailability({ ...copilotIdle, activity: 'working', isInterrupting: true })
    ).toEqual({ disabled: true, reason: RUN_DISABLED_INTERRUPTING })
  })

  it.each(['permission', 'confirm'] as const)(
    'copilot が中断の流れの間なら、%s でも RUN_DISABLED_INTERRUPTING(理由の順は 中断の流れ → 活動)',
    (activity) => {
      expect(getPromptRunAvailability({ ...copilotIdle, activity, isInterrupting: true })).toEqual({
        disabled: true,
        reason: RUN_DISABLED_INTERRUPTING
      })
    }
  )

  it('閉じる途中・動いていない・送信中の理由は、中断の流れと活動の理由より先', () => {
    const busy = { ...copilotIdle, activity: 'working' as const, isInterrupting: true }
    expect(getPromptRunAvailability({ ...busy, isSessionClosing: true }).reason).toBe(
      RUN_DISABLED_CLOSING
    )
    expect(getPromptRunAvailability({ ...busy, isSessionRunning: false }).reason).toBe(
      RUN_DISABLED_NO_SESSION
    )
    expect(getPromptRunAvailability({ ...busy, isSending: true }).reason).toBe(RUN_DISABLED_SENDING)
  })

  it.each(['working', 'unknown', 'idle'] as const)(
    'claude は活動が %s なら、中断の流れに関わらず今と同じく押せる',
    (activity) => {
      for (const isInterrupting of [false, true]) {
        expect(
          getPromptRunAvailability({ ...copilotIdle, cliKind: 'claude', activity, isInterrupting })
        ).toEqual({ disabled: false, reason: null })
      }
    }
  )

  it.each(['permission', 'confirm'] as const)(
    'claude の活動が %s なら、中断の流れに関わらず押せず、活動の理由を出す',
    (activity) => {
      for (const isInterrupting of [false, true]) {
        expect(
          getPromptRunAvailability({ ...copilotIdle, cliKind: 'claude', activity, isInterrupting })
        ).toEqual({
          disabled: true,
          reason: agentSendBlockedByActivityReason(activity, 'claude')
        })
      }
    }
  )

  it('claude の閉じる途中・動いていない・送信中の理由は、許可待ちの理由より先', () => {
    const waiting = { ...copilotIdle, cliKind: 'claude' as const, activity: 'permission' as const }
    expect(getPromptRunAvailability({ ...waiting, isSessionClosing: true }).reason).toBe(
      RUN_DISABLED_CLOSING
    )
    expect(getPromptRunAvailability({ ...waiting, isSessionRunning: false }).reason).toBe(
      RUN_DISABLED_NO_SESSION
    )
    expect(getPromptRunAvailability({ ...waiting, isSending: true }).reason).toBe(
      RUN_DISABLED_SENDING
    )
  })

  it('claude の履歴の再実行も同じ(記録したフォルダの理由が先)', () => {
    const entry = {
      ...copilotIdle,
      cliKind: 'claude' as const,
      recordedFolderPath: '/repo',
      folderPath: '/repo'
    }
    expect(getHistoryRerunAvailability({ ...entry, activity: 'permission' })).toEqual({
      disabled: true,
      reason: agentSendBlockedByActivityReason('permission', 'claude')
    })
    expect(
      getHistoryRerunAvailability({ ...entry, folderPath: '/other', activity: 'permission' })
    ).toEqual({ disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/repo') })
    expect(getHistoryRerunAvailability({ ...entry, activity: 'working' })).toEqual({
      disabled: false,
      reason: null
    })
  })

  it('履歴の再実行も同じ(記録したフォルダの理由が先)', () => {
    const entry = { ...copilotIdle, recordedFolderPath: '/repo', folderPath: '/repo' }
    expect(getHistoryRerunAvailability({ ...entry, activity: 'working' })).toEqual({
      disabled: true,
      reason: agentSendBlockedByActivityReason('working', 'copilot')
    })
    expect(getHistoryRerunAvailability({ ...entry, isInterrupting: true }).reason).toBe(
      RUN_DISABLED_INTERRUPTING
    )
    expect(
      getHistoryRerunAvailability({ ...entry, folderPath: '/other', activity: 'working' })
    ).toEqual({ disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/repo') })
    expect(getHistoryRerunAvailability(entry)).toEqual({ disabled: false, reason: null })
  })

  it.each(AGENT_CLI_KINDS)(
    '%s の活動と中断の流れを見るかは、送信の手順の表の requiresIdle で決まる',
    (cliKind) => {
      const { requiresIdle } = AGENT_PROMPT_SEND_SPECS[cliKind]
      const busy = { ...copilotIdle, cliKind, activity: 'working' as const }
      expect(getPromptRunAvailability(busy).disabled).toBe(requiresIdle)
      expect(
        getPromptRunAvailability({ ...copilotIdle, cliKind, isInterrupting: true }).disabled
      ).toBe(requiresIdle)
    }
  )

  it.each(AGENT_CLI_KINDS)(
    '%s は、利用者の操作を待っている活動ではいつも押せず、作業中・不明では requiresIdle のときだけ押せない',
    (cliKind) => {
      const { requiresIdle } = AGENT_PROMPT_SEND_SPECS[cliKind]
      const expected: Record<AgentActivity, boolean> = {
        idle: false,
        permission: true,
        confirm: true,
        working: requiresIdle,
        unknown: requiresIdle
      }
      for (const activity of Object.keys(expected) as AgentActivity[]) {
        expect(getPromptRunAvailability({ ...copilotIdle, cliKind, activity }).disabled).toBe(
          expected[activity]
        )
      }
    }
  )
})
