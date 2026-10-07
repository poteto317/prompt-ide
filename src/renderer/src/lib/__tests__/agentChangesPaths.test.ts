import { describe, it, expect } from 'vitest'
import { agentChangeAbsolutePath, isEntrySavedInApp, isSavedInApp } from '../agentChangesPaths'

describe('agentChangeAbsolutePath', () => {
  it('フォルダを開いていないときは null', () => {
    expect(agentChangeAbsolutePath(null, 'a.txt')).toBeNull()
  })

  it('ファイルの行はフォルダと結合する', () => {
    expect(agentChangeAbsolutePath('/repo', 'src/a.txt')).toBe('/repo/src/a.txt')
  })

  it('フォルダの行は末尾の / を落として結合する', () => {
    expect(agentChangeAbsolutePath('/repo', 'new-dir/')).toBe('/repo/new-dir')
  })
})

describe('isSavedInApp', () => {
  it('保存したパスと同じなら true', () => {
    expect(isSavedInApp(new Set(['/repo/a.txt']), '/repo/a.txt')).toBe(true)
  })

  it('保存したパスがフォルダの配下にあれば true', () => {
    expect(isSavedInApp(new Set(['/repo/new-dir/a.txt']), '/repo/new-dir')).toBe(true)
  })

  it('別のフォルダの配下なら false', () => {
    expect(isSavedInApp(new Set(['/repo/other/a.txt']), '/repo/new-dir')).toBe(false)
  })

  it('名前の前方一致だけのフォルダは配下ではない', () => {
    expect(isSavedInApp(new Set(['/repo/new-dir2/a.txt']), '/repo/new-dir')).toBe(false)
  })

  it('保存したパスが無ければ false', () => {
    expect(isSavedInApp(new Set(), '/repo/a.txt')).toBe(false)
  })
})

describe('isEntrySavedInApp', () => {
  it('フォルダを開いていなければ false', () => {
    expect(isEntrySavedInApp(null, new Set(['/repo/a.txt']), 'a.txt')).toBe(false)
  })

  it('ファイルの行は保存したパスと同じなら true', () => {
    expect(isEntrySavedInApp('/repo', new Set(['/repo/src/a.txt']), 'src/a.txt')).toBe(true)
  })

  it('保存したパスが無ければ false', () => {
    expect(isEntrySavedInApp('/repo', new Set(), 'src/a.txt')).toBe(false)
  })

  it('フォルダの行は配下の保存で true', () => {
    expect(isEntrySavedInApp('/repo', new Set(['/repo/new-dir/a.txt']), 'new-dir/')).toBe(true)
  })

  it('前方一致だけの別フォルダの保存は false', () => {
    expect(isEntrySavedInApp('/repo', new Set(['/repo/new-dir2/a.txt']), 'new-dir/')).toBe(false)
  })
})
