import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { ORIGIN_REMOTE, hasOriginRemote, listRemoteNames } from '../gitRemoteNames'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  mockRaw.mockReset()
})

// getGitStatus の hasOrigin と、gitRemoteSetupService の追加・初回 push の検証が同じ判定を使う(パターン 88)
describe('hasOriginRemote', () => {
  it('アプリが扱うリモートの名前は origin', () => {
    expect(ORIGIN_REMOTE).toBe('origin')
  })

  it('git remote を引数どおりに呼び、origin の行があれば true', async () => {
    mockRaw.mockResolvedValue('upstream\norigin\n')
    await expect(hasOriginRemote(git)).resolves.toBe(true)
    expect(mockRaw).toHaveBeenCalledWith(['remote'])
  })

  // Windows の git は行末が \r\n になる(パターン 27)
  it('行末が \\r\\n でも true', async () => {
    mockRaw.mockResolvedValue('origin\r\n')
    await expect(hasOriginRemote(git)).resolves.toBe(true)
  })

  it.each([
    ['空', ''],
    ['origin 以外だけ', 'upstream\n'],
    ['前方一致・部分一致の別名', 'origin2\nmy-origin\n']
  ])('%s なら false', async (_label, output) => {
    mockRaw.mockResolvedValue(output)
    await expect(hasOriginRemote(git)).resolves.toBe(false)
  })

  it('git remote の失敗はそのまま投げる', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: bad config'))
    await expect(hasOriginRemote(git)).rejects.toThrow('fatal: bad config')
  })
})

// getGitStatus が git remote を 1 回だけ呼び、hasOrigin と hasRemote をこの一覧から決める
describe('listRemoteNames', () => {
  it('git remote を引数どおりに呼び、行ごとの名前を返す', async () => {
    mockRaw.mockResolvedValue('github\norigin\n')
    await expect(listRemoteNames(git)).resolves.toEqual(['github', 'origin'])
    expect(mockRaw).toHaveBeenCalledWith(['remote'])
  })

  // Windows の git は行末が \r\n になる(パターン 27)
  it('行末が \\r\\n でも名前だけを返す', async () => {
    mockRaw.mockResolvedValue('github\r\norigin\r\n')
    await expect(listRemoteNames(git)).resolves.toEqual(['github', 'origin'])
  })

  it.each([
    ['空', ''],
    ['改行だけ', '\n'],
    ['\\r\\n だけ', '\r\n']
  ])('%s なら空の配列', async (_label, output) => {
    mockRaw.mockResolvedValue(output)
    await expect(listRemoteNames(git)).resolves.toEqual([])
  })

  it('git remote の失敗はそのまま投げる', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: bad config'))
    await expect(listRemoteNames(git)).rejects.toThrow('fatal: bad config')
  })
})
