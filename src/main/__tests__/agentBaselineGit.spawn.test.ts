import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

// runBaselineGitWithInput の spawn と、同期の版 runBaselineGitWithInputSync の spawnSync の options を simple-git の経路
// (cwd・env・windowsHide: true)と揃えることを固定する(ローカルレビュー第 3 周の指摘 2。windowsHide が無いと Windows で
// console のウィンドウが一瞬開く)。同期の版は失敗を投げずに false を返すことも固定する
const spawnMock = vi.hoisted(() => vi.fn())
const spawnSyncMock = vi.hoisted(() => vi.fn())
// simple-git も node:child_process を読むため、spawn だけを差し替える
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: { ...actual, spawn: spawnMock, spawnSync: spawnSyncMock },
    spawn: spawnMock,
    spawnSync: spawnSyncMock
  }
})

import { runBaselineGitWithInput, runBaselineGitWithInputSync } from '../agentBaselineGit'

const fakeProcess = (): EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: () => void
} => {
  const proc = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  })
  proc.stdin.on('finish', () => setImmediate(() => proc.emit('close', 0)))
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => fakeProcess())
})

describe('runBaselineGitWithInput の spawn', () => {
  it('cwd・記録のインデックスの環境・windowsHide: true で git を起動する', async () => {
    await runBaselineGitWithInput('/repo', '/tmp/index', ['update-index', '--stdin'], 'a\0', {
      env: { PATH: '/bin' }
    })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(command).toBe('git')
    expect(args).toEqual(['-c', 'core.splitIndex=false', 'update-index', '--stdin'])
    expect(options).toEqual({
      cwd: '/repo',
      env: { PATH: '/bin', GIT_INDEX_FILE: '/tmp/index' },
      windowsHide: true
    })
  })
})

describe('runBaselineGitWithInputSync', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined })
  })

  it('cwd・記録のインデックスの環境・入力・打ち切り・windowsHide: true で同期で起動し、終了コード 0 なら true', () => {
    const ok = runBaselineGitWithInputSync(
      '/repo',
      '/tmp/index',
      ['update-ref', '-z', '--stdin'],
      'delete r\0v\0',
      {
        env: { PATH: '/bin' },
        timeoutMs: 2000,
        config: ['core.hooksPath=/nohooks']
      }
    )
    expect(ok).toBe(true)
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      [
        '-c',
        'core.splitIndex=false',
        '-c',
        'core.hooksPath=/nohooks',
        'update-ref',
        '-z',
        '--stdin'
      ],
      expect.objectContaining({
        cwd: '/repo',
        env: { PATH: '/bin', GIT_INDEX_FILE: '/tmp/index' },
        input: 'delete r\0v\0',
        timeout: 2000,
        windowsHide: true
      })
    )
  })

  it.each([
    ['終了コードが 0 でない', { status: 1, error: undefined }],
    ['打ち切り・起動の失敗(error がある)', { status: null, error: new Error('ETIMEDOUT') }]
  ])('%s なら false', (_label, result) => {
    spawnSyncMock.mockReturnValue(result)
    expect(runBaselineGitWithInputSync('/repo', '/tmp/index', ['x'], '')).toBe(false)
  })

  it('spawnSync が投げても false(アプリの終了の後始末を止めない)', () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(runBaselineGitWithInputSync('/repo', '/tmp/index', ['x'], '')).toBe(false)
  })
})
