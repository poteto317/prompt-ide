import { describe, it, expect, vi } from 'vitest'
import type { AgentLaunchRequest } from '@shared/types'
import { selectCliSessionId } from '../cliSessionIdSelection'

const ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID = '22222222-2222-4222-9222-222222222222'
const FOLDER = '/work/project'

describe('selectCliSessionId', () => {
  it('new は振った ID を選び、記録は照合しない', () => {
    const has = vi.fn(() => false)
    const create = vi.fn(() => NEW_ID)
    expect(selectCliSessionId({ kind: 'new' }, FOLDER, { has }, create)).toEqual({
      kind: 'selected',
      cliSessionId: NEW_ID
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(has).not.toHaveBeenCalled()
  })

  it('resume は記録にある ID ならその ID を選び、新しい ID は振らない', () => {
    const has = vi.fn(() => true)
    const create = vi.fn(() => NEW_ID)
    expect(
      selectCliSessionId(
        { kind: 'resume', cliSessionId: ID, cliKind: 'claude' },
        FOLDER,
        { has },
        create
      )
    ).toEqual({ kind: 'selected', cliSessionId: ID })
    expect(has).toHaveBeenCalledWith(FOLDER, ID)
    expect(create).not.toHaveBeenCalled()
  })

  it('resume は記録に無い ID なら unknown-session で拒む', () => {
    const create = vi.fn(() => NEW_ID)
    expect(
      selectCliSessionId(
        { kind: 'resume', cliSessionId: ID, cliKind: 'claude' },
        FOLDER,
        { has: () => false },
        create
      )
    ).toEqual({ kind: 'rejected', result: { kind: 'error', error: 'unknown-session' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('未知の kind は記録に ID があっても受け付けず投げ、ID も振らない(既定の分岐へ流さない)', () => {
    const has = vi.fn(() => true)
    const create = vi.fn(() => NEW_ID)
    const unknownLaunch = { kind: 'fork', cliSessionId: ID } as unknown as AgentLaunchRequest
    expect(() => selectCliSessionId(unknownLaunch, FOLDER, { has }, create)).toThrow(
      '未知の起動の指定です'
    )
    expect(has).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
