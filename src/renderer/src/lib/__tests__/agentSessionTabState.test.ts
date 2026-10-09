import { describe, it, expect } from 'vitest'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import {
  AGENT_ADD_TAB_DISABLED_LIMIT,
  AGENT_START_DISABLED_NO_FOLDER
} from '../agentSessionMessages'
import {
  AGENT_EXITED_SOON_MS,
  INITIAL_AGENT_TAB_SESSION_FIELDS,
  agentAddTabDisabledReason,
  agentStartDisabledReason,
  agentTabSessionFieldsOf,
  findAgentSlotBySessionId,
  isActiveAgentSessionStatus,
  isAgentExitedSoon,
  isAnyAgentSessionActive,
  isAnyAgentSessionStarting
} from '../agentSessionTabState'

describe('isActiveAgentSessionStatus', () => {
  it('starting と running を動いているとみなす', () => {
    expect(isActiveAgentSessionStatus('starting')).toBe(true)
    expect(isActiveAgentSessionStatus('running')).toBe(true)
  })

  it('none と exited は動いていない', () => {
    expect(isActiveAgentSessionStatus('none')).toBe(false)
    expect(isActiveAgentSessionStatus('exited')).toBe(false)
  })
})

describe('isAnyAgentSessionActive・isAnyAgentSessionStarting', () => {
  it('starting か running のタブがあれば動いている。starting のタブがあれば起動中', () => {
    expect(isAnyAgentSessionActive([{ status: 'none' }, { status: 'running' }])).toBe(true)
    expect(isAnyAgentSessionStarting([{ status: 'none' }, { status: 'running' }])).toBe(false)
    expect(isAnyAgentSessionStarting([{ status: 'exited' }, { status: 'starting' }])).toBe(true)
  })

  it('none と exited だけなら、どちらも false', () => {
    const tabs = [{ status: 'none' as const }, { status: 'exited' as const }]
    expect(isAnyAgentSessionActive(tabs)).toBe(false)
    expect(isAnyAgentSessionStarting(tabs)).toBe(false)
  })
})

describe('agentStartDisabledReason', () => {
  it('フォルダが無ければその理由、あれば null', () => {
    expect(agentStartDisabledReason(null)).toBe(AGENT_START_DISABLED_NO_FOLDER)
    expect(agentStartDisabledReason('/p')).toBeNull()
  })

  it('起動を受け付けない理由があればそれを返し、フォルダ無しを優先する', () => {
    expect(agentStartDisabledReason('/p', '切り替え中')).toBe('切り替え中')
    expect(agentStartDisabledReason(null, '切り替え中')).toBe(AGENT_START_DISABLED_NO_FOLDER)
  })
})

describe('agentTabSessionFieldsOf', () => {
  it('状態が無いタブは初期値を返す', () => {
    expect(agentTabSessionFieldsOf(new Map(), 'a')).toBe(INITIAL_AGENT_TAB_SESSION_FIELDS)
  })

  it('状態があるタブはその値を返す', () => {
    const fields = { status: 'running' as const, exit: null, error: null }
    expect(agentTabSessionFieldsOf(new Map([['a', fields]]), 'a')).toBe(fields)
  })
})

describe('isAgentExitedSoon', () => {
  const startedAt = 1_000

  it('起動の直後に 0 以外で終わったら true', () => {
    expect(isAgentExitedSoon({ exitCode: 1, reason: 'exited' }, startedAt, startedAt + 10)).toBe(
      true
    )
  })

  it('終了コード 0 なら false', () => {
    expect(isAgentExitedSoon({ exitCode: 0, reason: 'exited' }, startedAt, startedAt + 10)).toBe(
      false
    )
  })

  it('終了コードが null(シグナル)なら直後でも true', () => {
    expect(isAgentExitedSoon({ exitCode: null, reason: 'exited' }, startedAt, startedAt + 10)).toBe(
      true
    )
  })

  it('止めた終了(stopped)なら false', () => {
    expect(isAgentExitedSoon({ exitCode: 1, reason: 'stopped' }, startedAt, startedAt + 10)).toBe(
      false
    )
  })

  it('起動から AGENT_EXITED_SOON_MS 経っていれば false', () => {
    expect(
      isAgentExitedSoon(
        { exitCode: 1, reason: 'exited' },
        startedAt,
        startedAt + AGENT_EXITED_SOON_MS
      )
    ).toBe(false)
  })

  it('起動の時刻が無ければ 0 から数える', () => {
    expect(isAgentExitedSoon({ exitCode: 1, reason: 'exited' }, undefined, 10)).toBe(true)
    expect(
      isAgentExitedSoon({ exitCode: 1, reason: 'exited' }, undefined, AGENT_EXITED_SOON_MS)
    ).toBe(false)
  })
})

describe('agentAddTabDisabledReason', () => {
  it('フォルダが無ければフォルダ無しの理由', () => {
    expect(agentAddTabDisabledReason(null, 1)).toBe(AGENT_START_DISABLED_NO_FOLDER)
  })

  it('フォルダが無ければ上限でもフォルダ無しの理由を優先する', () => {
    expect(agentAddTabDisabledReason(null, AGENT_MAX_SESSIONS_PER_WINDOW)).toBe(
      AGENT_START_DISABLED_NO_FOLDER
    )
  })

  it('起動を受け付けない理由があれば、上限より優先してそれを返す', () => {
    expect(agentAddTabDisabledReason('/repo', 1, '切り替え中')).toBe('切り替え中')
    expect(agentAddTabDisabledReason('/repo', AGENT_MAX_SESSIONS_PER_WINDOW, '切り替え中')).toBe(
      '切り替え中'
    )
  })

  it('タブが上限に達していれば上限の理由', () => {
    expect(agentAddTabDisabledReason('/repo', AGENT_MAX_SESSIONS_PER_WINDOW)).toBe(
      AGENT_ADD_TAB_DISABLED_LIMIT
    )
  })

  it('上限未満なら null', () => {
    expect(agentAddTabDisabledReason('/repo', AGENT_MAX_SESSIONS_PER_WINDOW - 1)).toBeNull()
  })
})

describe('findAgentSlotBySessionId', () => {
  it('sessionId を持つタブの slotId を返す', () => {
    const map = new Map([
      ['a', 's1'],
      ['b', 's2']
    ])
    expect(findAgentSlotBySessionId(map, 's2')).toBe('b')
  })

  it('一致するタブが無ければ undefined', () => {
    expect(findAgentSlotBySessionId(new Map([['a', 's1']]), 'x')).toBeUndefined()
  })
})
