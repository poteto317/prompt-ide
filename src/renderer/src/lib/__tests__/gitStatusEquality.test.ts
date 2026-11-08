import { describe, it, expect } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { isSameGitStatus } from '../gitStatusEquality'

const status = (): GitStatusResult => ({
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [
    { path: 'a.txt', index: ' ', workingDir: 'M' },
    { path: 'b.txt', index: 'R', workingDir: ' ', from: 'old.txt' }
  ],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
})

// 構造の比べの規則(null・undefined のキー・配列の順)そのものは plainDataEquality.test.ts で確かめる。
// ここでは、status の欄・ファイルの欄の違いを見落とさないことと、main の from の入れ方で同じに扱うことを確かめる
describe('isSameGitStatus', () => {
  it('中身が同じ別のオブジェクト → true', () => {
    expect(isSameGitStatus(status(), status())).toBe(true)
  })

  it('from が undefined の欄と、from が無いのは同じ(main は値があるときだけ from を入れる)', () => {
    const withUndefined: GitStatusResult = {
      ...status(),
      files: [{ path: 'a.txt', index: ' ', workingDir: 'M', from: undefined }, status().files[1]]
    }
    expect(isSameGitStatus(status(), withUndefined)).toBe(true)
  })

  it('両方 null → true、片方だけ null → false', () => {
    expect(isSameGitStatus(null, null)).toBe(true)
    expect(isSameGitStatus(status(), null)).toBe(false)
    expect(isSameGitStatus(null, status())).toBe(false)
  })

  it.each<[string, Partial<GitStatusResult>]>([
    ['isRepo', { isRepo: false }],
    ['branch', { branch: 'dev' }],
    ['ahead', { ahead: 1 }],
    ['behind', { behind: 2 }],
    ['mergeInProgress', { mergeInProgress: true }],
    ['hasOrigin', { hasOrigin: false }],
    ['hasRemote', { hasRemote: false }],
    ['upstream', { upstream: null }],
    ['detached', { detached: true }]
  ])('%s が違う → false', (_label, change) => {
    expect(isSameGitStatus(status(), { ...status(), ...change })).toBe(false)
  })

  it.each<[string, (s: GitStatusResult) => GitStatusResult]>([
    [
      'ファイルの文字(workingDir)',
      (s) => ({ ...s, files: [{ ...s.files[0], workingDir: 'D' }, s.files[1]] })
    ],
    [
      'ファイルの文字(index)',
      (s) => ({ ...s, files: [{ ...s.files[0], index: 'M' }, s.files[1]] })
    ],
    ['ファイルのパス', (s) => ({ ...s, files: [{ ...s.files[0], path: 'c.txt' }, s.files[1]] })],
    [
      'from の有無',
      (s) => ({ ...s, files: [s.files[0], { path: 'b.txt', index: 'R', workingDir: ' ' }] })
    ],
    [
      'from の値',
      (s) => ({
        ...s,
        files: [s.files[0], { path: 'b.txt', index: 'R', workingDir: ' ', from: 'older.txt' }]
      })
    ],
    ['ファイルの順', (s) => ({ ...s, files: [s.files[1], s.files[0]] })],
    ['ファイルの数', (s) => ({ ...s, files: [s.files[0]] })]
  ])('%s が違う → false', (_label, change) => {
    expect(isSameGitStatus(status(), change(status()))).toBe(false)
  })
})
