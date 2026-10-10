import { describe, it, expect } from 'vitest'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import {
  parseAgentNotificationBadgeRequest,
  parseAgentNotificationDismissRequest,
  parseAgentNotificationShowRequest
} from '../../handlers/agentNotificationPayloadParser'

const valid = { slotId: 'slot-1', tabNumber: 2, kind: 'permission' }

describe('parseAgentNotificationShowRequest', () => {
  it('検証を通った値だけを返す(余分なフィールドは捨てる)', () => {
    expect(parseAgentNotificationShowRequest({ ...valid, title: 'x' })).toEqual(valid)
  })
  it.each(['permission', 'confirm', 'done'])('kind %s を受ける', (kind) => {
    expect(parseAgentNotificationShowRequest({ ...valid, kind }).kind).toBe(kind)
  })
  it.each([1, AGENT_MAX_SESSIONS_PER_WINDOW])('tabNumber %s を受ける', (tabNumber) => {
    expect(parseAgentNotificationShowRequest({ ...valid, tabNumber }).tabNumber).toBe(tabNumber)
  })
  it.each([
    ['オブジェクトでない', null, '引数はオブジェクトである必要があります'],
    ['slotId が形式に合わない', { ...valid, slotId: 'a b' }, 'slotId は英数字とハイフン'],
    ['slotId が文字列でない', { ...valid, slotId: 1 }, 'slotId は英数字とハイフン'],
    ['tabNumber が 0', { ...valid, tabNumber: 0 }, 'tabNumber は 1〜'],
    [
      'tabNumber が上限を超える',
      { ...valid, tabNumber: AGENT_MAX_SESSIONS_PER_WINDOW + 1 },
      'tabNumber は 1〜'
    ],
    ['tabNumber が整数でない', { ...valid, tabNumber: 1.5 }, 'tabNumber は 1〜'],
    ['tabNumber が文字列', { ...valid, tabNumber: '1' }, 'tabNumber は 1〜'],
    ['kind が 3 つのどれでもない', { ...valid, kind: 'working' }, 'kind は'],
    ['kind が無い', { slotId: 'slot-1', tabNumber: 1 }, 'kind は']
  ])('%s なら投げる', (_label, payload, message) => {
    expect(() => parseAgentNotificationShowRequest(payload)).toThrow(message)
  })
})

describe('parseAgentNotificationBadgeRequest', () => {
  it.each([0, 1, AGENT_MAX_SESSIONS_PER_WINDOW])('count %s を受ける', (count) => {
    expect(parseAgentNotificationBadgeRequest({ count })).toEqual({ count })
  })
  it.each([
    ['オブジェクトでない', 3],
    ['負の数', { count: -1 }],
    ['上限を超える', { count: AGENT_MAX_SESSIONS_PER_WINDOW + 1 }],
    ['整数でない', { count: 0.5 }],
    ['文字列', { count: '1' }]
  ])('%s なら投げる', (_label, payload) => {
    expect(() => parseAgentNotificationBadgeRequest(payload)).toThrow()
  })
})

describe('parseAgentNotificationDismissRequest', () => {
  it('検証を通った slotId だけを返す(余分なフィールドは捨てる)', () => {
    expect(parseAgentNotificationDismissRequest({ slotId: 'slot-1', tabNumber: 1 })).toEqual({
      slotId: 'slot-1'
    })
  })
  it.each([
    ['オブジェクトでない', 'slot-1', '引数はオブジェクトである必要があります'],
    ['slotId が形式に合わない', { slotId: 'a b' }, 'slotId は英数字とハイフン'],
    ['slotId が無い', {}, 'slotId は英数字とハイフン']
  ])('%s なら投げる', (_label, payload, message) => {
    expect(() => parseAgentNotificationDismissRequest(payload)).toThrow(message)
  })
})
