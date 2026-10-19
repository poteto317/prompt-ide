import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  default: { spawn: mockSpawn, spawnSync: vi.fn() },
  spawn: mockSpawn,
  spawnSync: vi.fn()
}))

import { applyHunkRevert } from '../agentChangesRevert'
import type { AgentRevertContext } from '../agentChangesRevert'
import { DISCARD_HUNK_APPLY_ARGS } from '../gitApply'

// 隠れた git の記録のハンクの逆適用は、リポジトリの方式(gitApply の runGitApply)と同じ打ち切りの規則で動かす
// (ローカルレビュー第 9 周の指摘 1)。git apply は古いファイルを消してから新しいファイルを作るため、すぐ SIGKILL すると
// ファイルが無いまま残りうる。30 秒で SIGTERM、5 秒の猶予の後に SIGKILL。隠れた git の環境(GIT_DIR・GIT_WORK_TREE)と
// -c の守り(core.hooksPath・core.fsmonitor)は引き続き付ける

type FakeProcess = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  const stdin = new EventEmitter() as FakeProcess['stdin']
  stdin.write = vi.fn()
  stdin.end = vi.fn()
  proc.stdin = stdin
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  return proc
}

const hiddenContext = {
  snapshot: {
    folderPath: '/folder',
    indexPath: '/tmp/record/index',
    gitDir: '/tmp/record/git'
  },
  // 記録の git の打ち切り(既定 10 秒)を短くしても、逆適用は gitApply の打ち切りで動く
  gitOptions: { timeoutMs: 1_000, env: { PATH: '/usr/bin', GIT_DIR: '/other/.git' } }
} as unknown as AgentRevertContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('applyHunkRevert(隠れた git の記録)', () => {
  it('隠れた git の環境と -c の守りを付けて git apply --reverse を動かす', async () => {
    const proc = createFakeProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = applyHunkRevert(hiddenContext, 'a.txt', 'PATCH')
    proc.emit('close', 0)
    await promise
    const [command, args, options] = mockSpawn.mock.calls[0]
    expect(command).toBe('git')
    expect(args).toEqual([
      '-c',
      'core.splitIndex=false',
      '-c',
      'core.hooksPath=/tmp/record/git/no-hooks',
      '-c',
      'core.fsmonitor=false',
      ...DISCARD_HUNK_APPLY_ARGS
    ])
    expect(options).toMatchObject({
      cwd: '/folder',
      env: {
        PATH: '/usr/bin',
        GIT_DIR: '/tmp/record/git',
        GIT_WORK_TREE: '/folder',
        GIT_INDEX_FILE: '/tmp/record/index'
      }
    })
    expect(proc.stdin.write).toHaveBeenCalledWith('PATCH')
  })

  it('打ち切りはリポジトリの方式と同じ: 30 秒までは止めず、30 秒で SIGTERM、5 秒の猶予の後に SIGKILL', async () => {
    const proc = createFakeProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = applyHunkRevert(hiddenContext, 'a.txt', 'PATCH')
    const assertion = expect(promise).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(proc.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(proc.kill.mock.calls).toEqual([[]])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(proc.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(proc.kill.mock.calls).toEqual([[], ['SIGKILL']])
  })
})

describe('applyHunkRevert(リポジトリの方式の記録)', () => {
  it('環境も -c も付けず、今までどおりフォルダを cwd にして git apply --reverse を動かす', async () => {
    const proc = createFakeProcess()
    mockSpawn.mockReturnValue(proc)
    const repositoryContext = {
      snapshot: { folderPath: '/repo', indexPath: '/tmp/record/index', gitDir: null },
      gitOptions: { timeoutMs: 1_000, env: { PATH: '/usr/bin' } }
    } as unknown as AgentRevertContext
    const promise = applyHunkRevert(repositoryContext, 'a.txt', 'PATCH')
    proc.emit('close', 0)
    await promise
    expect(mockSpawn.mock.calls).toEqual([['git', [...DISCARD_HUNK_APPLY_ARGS], { cwd: '/repo' }]])
    expect(proc.stdin.write).toHaveBeenCalledWith('PATCH')
  })
})
