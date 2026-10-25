import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'
import {
  getResumeEntryDisabledReason,
  getResumeLastDisabledReason
} from '../agentResumeAvailability'
import type { AgentResumeTab } from '../agentResumeAvailability'
import {
  agentResumeEntryCliMismatch,
  agentResumeEntryUnknownCli,
  agentResumeEntryUnsupportedReason,
  agentResumeLastUnsupportedReason
} from '../agentSessionMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 設定の種類が再開に対応していない理由(agentResume*UnsupportedReason)を確かめるため、能力の表を種類ごとに差し替える
// (段階 3a で copilot も再開に対応し、今の表には該当する種類が無い)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>()
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

const ID = '11111111-1111-4111-8111-111111111111'
const tab = (overrides: Partial<AgentResumeTab> = {}): AgentResumeTab => ({
  label: 'claude 1',
  status: 'none',
  claudeSessionId: null,
  ...overrides
})

describe('getResumeLastDisabledReason(前回の続きから)', () => {
  it('起動の理由(フォルダ無し・方式の切り替えの途中)を最優先にする', () => {
    expect(
      getResumeLastDisabledReason({
        appCliKind: 'claude',
        startDisabledReason: 'フォルダを開いてください',
        lastSession: { kind: 'found', cliKind: 'claude', claudeSessionId: ID },
        tabs: [tab()]
      })
    ).toBe('フォルダを開いてください')
  })

  it('取得中・記録が無いの理由', () => {
    expect(
      getResumeLastDisabledReason({
        appCliKind: 'claude',
        startDisabledReason: null,
        lastSession: { kind: 'loading' },
        tabs: []
      })
    ).toBe('前回のセッションを確かめています')
    expect(
      getResumeLastDisabledReason({
        appCliKind: 'claude',
        startDisabledReason: null,
        lastSession: { kind: 'none' },
        tabs: []
      })
    ).toBe('このフォルダで前回起動したセッションの記録がありません')
  })

  it.each(['starting', 'running'] as const)(
    '同じ ID のタブが %s なら、そのタブの名前を出す',
    (status) => {
      expect(
        getResumeLastDisabledReason({
          appCliKind: 'claude',
          startDisabledReason: null,
          lastSession: { kind: 'found', cliKind: 'claude', claudeSessionId: ID },
          tabs: [tab(), tab({ label: 'claude 2', status, claudeSessionId: ID })]
        })
      ).toBe('前回のセッションは claude 2 で動いています')
    }
  )

  it('記録があり、同じ ID のタブが動いていなければ押せる(null)', () => {
    expect(
      getResumeLastDisabledReason({
        appCliKind: 'claude',
        startDisabledReason: null,
        lastSession: { kind: 'found', cliKind: 'claude', claudeSessionId: ID },
        tabs: [tab({ status: 'exited', claudeSessionId: null })]
      })
    ).toBeNull()
  })
})

describe('getResumeEntryDisabledReason(このセッションで再開)', () => {
  const recorded = {
    claudeSessionId: ID,
    cliKind: 'claude',
    tabLabel: 'claude 1',
    folderPath: '/work'
  }
  const ok = {
    mode: 'agent-cli' as const,
    appCliKind: 'claude' as const,
    folderPath: '/work',
    recorded,
    startDisabledReason: null,
    addDisabledReason: null,
    tabs: [tab()]
  }

  it('押せるなら null', () => {
    expect(getResumeEntryDisabledReason(ok)).toBeNull()
  })

  it('上から順に最初に当たった理由を 1 つ出す', () => {
    const all = {
      ...ok,
      folderPath: '/other',
      startDisabledReason: '実行方式を切り替えています',
      addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
      tabs: [tab({ label: 'claude 2', status: 'running' as const, claudeSessionId: ID })]
    }
    expect(getResumeEntryDisabledReason({ ...all, mode: null })).toBe('設定を読み込んでいます')
    expect(getResumeEntryDisabledReason({ ...all, mode: 'legacy' })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
    expect(getResumeEntryDisabledReason(all)).toBe(
      '記録したフォルダ（/work）を開いているときだけ再開できます'
    )
    expect(getResumeEntryDisabledReason({ ...all, folderPath: '/work' })).toBe(
      '実行方式を切り替えています'
    )
    expect(
      getResumeEntryDisabledReason({ ...all, folderPath: '/work', startDisabledReason: null })
    ).toBe('このセッションは claude 2 で動いています')
    expect(
      getResumeEntryDisabledReason({
        ...all,
        folderPath: '/work',
        startDisabledReason: null,
        tabs: [tab()]
      })
    ).toBe('タブは 4 つまでです（使わないタブを閉じると追加できます）')
  })

  it('未知の方式(方式を足したとき)をエージェント CLI 方式として押せるようにしない', () => {
    // 型の外の値(方式の列挙を足したときに、この関数を直し忘れた場合)
    const unknownMode = 'remote' as unknown as PromptExecutionMode
    expect(getResumeEntryDisabledReason({ ...ok, mode: unknownMode })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
  })

  it('フォルダを開いていなければ、記録したフォルダの理由', () => {
    expect(getResumeEntryDisabledReason({ ...ok, folderPath: null })).toBe(
      '記録したフォルダ（/work）を開いているときだけ再開できます'
    )
  })

  it('フォルダの比較は isSamePath(末尾の区切り・Windows の大文字小文字を無視する)', () => {
    expect(getResumeEntryDisabledReason({ ...ok, folderPath: '/work/' })).toBeNull()
    expect(
      getResumeEntryDisabledReason({
        ...ok,
        folderPath: 'c:\\work',
        recorded: { ...recorded, folderPath: 'C:\\Work' }
      })
    ).toBeNull()
  })
})

describe('再開の入口の CLI の種類(設定の種類が再開に対応しない種類。能力の表を差し替えた copilot)', () => {
  beforeEach(() => {
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
  })
  afterEach(() => {
    capabilityOverrides.sessionResumeUnsupportedKinds.clear()
  })

  const LAST = agentResumeLastUnsupportedReason('copilot')
  const ENTRY = agentResumeEntryUnsupportedReason('copilot')
  const recorded = {
    claudeSessionId: ID,
    cliKind: 'claude',
    tabLabel: 'claude 1',
    folderPath: '/work'
  }

  it('前回の続きから: 設定が copilot なら、取得中・記録なし・同じ ID のタブより先にその理由', () => {
    for (const lastSession of [
      { kind: 'loading' as const },
      { kind: 'none' as const },
      { kind: 'found' as const, cliKind: 'claude' as const, claudeSessionId: ID }
    ]) {
      expect(
        getResumeLastDisabledReason({
          startDisabledReason: null,
          appCliKind: 'copilot',
          lastSession,
          tabs: [tab({ status: 'running', claudeSessionId: ID })]
        })
      ).toBe(LAST)
    }
  })

  it('前回の続きから: 起動の理由(フォルダ無し・切り替えの途中)は copilot の理由より先', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: '使うエージェント CLI を切り替えています',
        appCliKind: 'copilot',
        lastSession: { kind: 'found', cliKind: 'claude', claudeSessionId: ID },
        tabs: []
      })
    ).toBe('使うエージェント CLI を切り替えています')
  })

  it('このセッションで再開: 設定が copilot なら、フォルダ・起動の理由・同じ ID・上限より先にその理由', () => {
    expect(
      getResumeEntryDisabledReason({
        mode: 'agent-cli',
        appCliKind: 'copilot',
        folderPath: '/other',
        recorded,
        startDisabledReason: 'フォルダを開いてください',
        addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
        tabs: [tab({ status: 'running', claudeSessionId: ID })]
      })
    ).toBe(ENTRY)
  })

  it('このセッションで再開: 読み込み中・従来の方式の理由は copilot の理由より先(判定の順は実行方式の直後)', () => {
    const base = {
      appCliKind: 'copilot' as const,
      folderPath: '/work',
      recorded,
      startDisabledReason: null,
      addDisabledReason: null,
      tabs: []
    }
    expect(getResumeEntryDisabledReason({ ...base, mode: null })).toBe('設定を読み込んでいます')
    expect(getResumeEntryDisabledReason({ ...base, mode: 'legacy' })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
  })
})

describe('再開の入口の CLI の種類(copilot も再開に対応する。段階 3a)', () => {
  it('前回の続きから: 設定が copilot で copilot の前回があれば押せる', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: null,
        appCliKind: 'copilot',
        lastSession: { kind: 'found', cliKind: 'copilot', claudeSessionId: ID },
        tabs: [tab({ label: 'copilot 1' })]
      })
    ).toBeNull()
  })
})

describe('getResumeEntryDisabledReason: エントリの種類(段階 3a)', () => {
  const recordedOf = (cliKind: string): AgentHistoryInfo => ({
    claudeSessionId: ID,
    cliKind,
    tabLabel: `${cliKind} 1`,
    folderPath: '/work'
  })
  const base = {
    mode: 'agent-cli' as const,
    appCliKind: 'copilot' as const,
    folderPath: '/work',
    startDisabledReason: null,
    addDisabledReason: null,
    tabs: [tab()]
  }

  it('エントリの種類と設定の種類が同じ(copilot)なら押せる', () => {
    expect(getResumeEntryDisabledReason({ ...base, recorded: recordedOf('copilot') })).toBeNull()
  })

  it('エントリの種類と設定の種類が違えば、切り替えれば再開できる理由', () => {
    expect(getResumeEntryDisabledReason({ ...base, recorded: recordedOf('claude') })).toBe(
      agentResumeEntryCliMismatch('claude', 'copilot')
    )
    expect(
      getResumeEntryDisabledReason({
        ...base,
        appCliKind: 'claude',
        recorded: recordedOf('copilot')
      })
    ).toBe(agentResumeEntryCliMismatch('copilot', 'claude'))
  })

  it('知らない種類(gemini)のエントリは、その種類の名前を出す理由(設定の種類に依らない)', () => {
    for (const appCliKind of ['claude', 'copilot'] as const) {
      expect(
        getResumeEntryDisabledReason({ ...base, appCliKind, recorded: recordedOf('gemini') })
      ).toBe(agentResumeEntryUnknownCli('gemini'))
    }
  })

  it('種類の理由は、フォルダ・起動を受け付けない間・同じ ID のタブ・上限の理由より先(フォルダを開き直しても押せないため)', () => {
    const blocked = {
      ...base,
      folderPath: '/other',
      startDisabledReason: '実行方式を切り替えています',
      addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
      tabs: [tab({ label: 'copilot 2', status: 'running', claudeSessionId: ID })]
    }
    expect(getResumeEntryDisabledReason({ ...blocked, recorded: recordedOf('gemini') })).toBe(
      agentResumeEntryUnknownCli('gemini')
    )
    expect(getResumeEntryDisabledReason({ ...blocked, recorded: recordedOf('claude') })).toBe(
      agentResumeEntryCliMismatch('claude', 'copilot')
    )
  })

  it('読み込み中・従来の方式・設定の種類が再開に対応しない理由は、種類の理由より先', () => {
    expect(
      getResumeEntryDisabledReason({ ...base, mode: null, recorded: recordedOf('gemini') })
    ).toBe('設定を読み込んでいます')
    expect(
      getResumeEntryDisabledReason({ ...base, mode: 'legacy', recorded: recordedOf('gemini') })
    ).toBe('エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）')
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    try {
      expect(getResumeEntryDisabledReason({ ...base, recorded: recordedOf('gemini') })).toBe(
        agentResumeEntryUnsupportedReason('copilot')
      )
    } finally {
      capabilityOverrides.sessionResumeUnsupportedKinds.clear()
    }
  })
})
