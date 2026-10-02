import { describe, it, expect, vi, beforeEach } from 'vitest'

const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
const MockGitPluginError = vi.hoisted(
  () =>
    class MockGitPluginError extends MockGitError {
      plugin?: string
      constructor(_task?: unknown, plugin?: string, message?: string) {
        super(message)
        this.plugin = plugin
      }
    }
)
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('simple-git', () => ({
  default: mockSimpleGit,
  GitError: MockGitError,
  GitPluginError: MockGitPluginError
}))

import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import {
  REMOTE_OPERATION_TIMEOUT_MESSAGE,
  simpleGitWithRemoteTimeout,
  toRemoteOperationError
} from '../gitRemoteTimeout'

beforeEach(() => {
  vi.clearAllMocks()
})

// push / pull / fetch(gitService)と初回 push(gitRemoteSetupService)が同じ打ち切りと文言を使う
describe('simpleGitWithRemoteTimeout', () => {
  // progress を渡さないと --progress が付かず、転送中でも stderr に何も流れずに誤って打ち切られる
  it('既定は GIT_REMOTE_TIMEOUT_MS の打ち切りと no-op の progress で作る', () => {
    simpleGitWithRemoteTimeout('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
  })

  it('timeoutMs を渡すとその値で打ち切る(テストで実時間を待たないため。パターン 84)', () => {
    simpleGitWithRemoteTimeout('/project', 500)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: 500 },
      progress: expect.any(Function)
    })
  })
})

// 打ち切りの判定そのもの(isGitTimeoutError)の網羅は gitStepErrors.test.ts で行う(パターン 55)
describe('toRemoteOperationError', () => {
  it('timeout プラグインの GitPluginError は、原因の推測を添えた日本語の Error にする', () => {
    const err = new MockGitPluginError(undefined, 'timeout', 'block timeout reached')
    const converted = toRemoteOperationError(err)
    expect(converted).toBeInstanceOf(Error)
    expect((converted as Error).message).toBe(REMOTE_OPERATION_TIMEOUT_MESSAGE)
    expect(REMOTE_OPERATION_TIMEOUT_MESSAGE).toBe(
      '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'
    )
  })

  it.each([
    ['timeout 以外のプラグイン', new MockGitPluginError(undefined, 'unsafe', 'x')],
    ['GitError', new MockGitError('fatal: x')],
    ['Error 以外', 'string']
  ])('%s はそのまま返す', (_label, err) => {
    expect(toRemoteOperationError(err)).toBe(err)
  })
})
