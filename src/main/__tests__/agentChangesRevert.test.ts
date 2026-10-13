import { describe, it, expect } from 'vitest'
import { assertHunkRevertableEntry } from '../agentChangesRevert'

describe('assertHunkRevertableEntry(ハンクで戻せない行の拒否)', () => {
  it('変更(M)のファイルは通す', () => {
    expect(() =>
      assertHunkRevertableEntry({ status: 'M', isDirectory: false }, 'a.txt')
    ).not.toThrow()
  })

  it.each(['A', 'D'] as const)('%s はファイルごと戻すよう求めて拒否する', (status) => {
    expect(() => assertHunkRevertableEntry({ status, isDirectory: false }, 'a.txt')).toThrow(
      '追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: a.txt'
    )
  })

  it('フォルダの行は拒否する', () => {
    expect(() => assertHunkRevertableEntry({ status: 'M', isDirectory: true }, 'dir')).toThrow(
      '追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: dir'
    )
  })

  it('種類の変更(T)は拒否する', () => {
    expect(() => assertHunkRevertableEntry({ status: 'T', isDirectory: false }, 'a.txt')).toThrow(
      '種類が変わったファイルはハンクでは戻せません。ファイルごと戻してください: a.txt'
    )
  })
})
