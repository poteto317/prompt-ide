import { describe, it, expect } from 'vitest'
import { AGENT_NOTIFICATION_KINDS, isAgentNotificationKind } from '@shared/types'

describe('isAgentNotificationKind', () => {
  it.each(AGENT_NOTIFICATION_KINDS)('%s は出来事', (kind) => {
    expect(isAgentNotificationKind(kind)).toBe(true)
  })
  it.each(['working', 'idle', '', null, 1, undefined])('%s は出来事でない', (value) => {
    expect(isAgentNotificationKind(value)).toBe(false)
  })
  it('出来事は 3 つ', () => {
    expect(AGENT_NOTIFICATION_KINDS).toEqual(['permission', 'confirm', 'done'])
  })
})
