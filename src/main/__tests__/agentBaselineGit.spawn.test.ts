import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

// runBaselineGitWithInput の spawn の options を simple-git の経路(cwd・env・windowsHide: true)と揃えることを固定する
// (ローカルレビュー第 3 周の指摘 2。windowsHide が無いと Windows で console のウィンドウが一瞬開く)
const spawnMock = vi.hoisted(() => vi.fn())
// simple-git も node:child_process を読むため、spawn だけを差し替える
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, default: { ...actual, spawn: spawnMock }, spawn: spawnMock }
})

import { runBaselineGitWithInput } from '../agentBaselineGit'

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
