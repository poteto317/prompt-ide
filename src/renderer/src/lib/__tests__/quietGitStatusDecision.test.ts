import { describe, it, expect } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { decideQuietGitStatus } from '../quietGitStatusDecision'
import type { QuietGitStatusContext } from '../quietGitStatusDecision'

const status = (branch = 'main'): GitStatusResult => ({
  isRepo: true,
  branch,
  ahead: 0,
  behind: 0,
  files: [{ path: 'a.txt', index: ' ', workingDir: 'M' }],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
})

const context = (overrides: Partial<QuietGitStatusContext> = {}): QuietGitStatusContext => ({
  latestStatus: status(),
  inheritsLoud: false,
  scanPending: false,
  ...overrides
})

describe('decideQuietGitStatus', () => {
  it('成功で内容が違う → 受け入れて置き換える', () => {
    const result = status('feature')
    expect(decideQuietGitStatus({ ok: true, result }, context())).toEqual({
      accepted: true,
      status: result,
      replace: true,
      quiet: true
    })
  })

  it('成功で内容が同じ → 受け入れるが置き換えない', () => {
    const decision = decideQuietGitStatus({ ok: true, result: status() }, context())
    expect(decision).toMatchObject({ accepted: true, replace: false })
  })

  it('通常の取得を引き継いだ成功で内容が同じ → 置き換え、通常の取得として置く(一覧の取り直しの合図を失わない)', () => {
    const decision = decideQuietGitStatus(
      { ok: true, result: status() },
      context({ inheritsLoud: true })
    )
    expect(decision).toMatchObject({ accepted: true, replace: true, quiet: false })
  })

  it('通常の取得を引き継いだ成功で内容が違う → 置き換え、通常の取得として置く', () => {
    const decision = decideQuietGitStatus(
      { ok: true, result: status('feature') },
      context({ inheritsLoud: true })
    )
    expect(decision).toMatchObject({ accepted: true, replace: true, quiet: false })
  })

  it('前の status が無い成功 → 置き換える', () => {
    const decision = decideQuietGitStatus(
      { ok: true, result: status() },
      context({ latestStatus: null })
    )
    expect(decision).toMatchObject({ accepted: true, replace: true })
  })

  it('失敗(通常の取得を引き継いでいない) → 受け入れず、失敗も出さない', () => {
    expect(decideQuietGitStatus({ ok: false, error: new Error('x') }, context())).toEqual({
      accepted: false,
      error: null
    })
  })

  it('失敗(通常の取得を引き継いだ) → Error に揃えて出す', () => {
    const decision = decideQuietGitStatus(
      { ok: false, error: 'boom' },
      context({ inheritsLoud: true })
    )
    expect(decision.accepted).toBe(false)
    if (decision.accepted) return
    expect(decision.error).toBeInstanceOf(Error)
    expect(decision.error?.message).toBe('boom')
  })

  it('走査中 → 成功でも失敗でも受け入れず、何も出さない', () => {
    const scanning = context({ scanPending: true, inheritsLoud: true })
    expect(decideQuietGitStatus({ ok: true, result: status('feature') }, scanning)).toEqual({
      accepted: false,
      error: null
    })
    expect(decideQuietGitStatus({ ok: false, error: new Error('x') }, scanning)).toEqual({
      accepted: false,
      error: null
    })
  })
})
