import { describe, it, expect } from 'vitest'
import {
  MAX_LISTED_CONFLICT_FILES,
  buildMergeAbortMessage,
  formatConflictFiles
} from '../gitMergeMessages'

const files = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i + 1}.txt`)

describe('formatConflictFiles', () => {
  it('上限は 5 件', () => {
    expect(MAX_LISTED_CONFLICT_FILES).toBe(5)
  })

  it('0 件は空文字', () => {
    expect(formatConflictFiles([])).toBe('')
  })

  it('1 件はそのまま', () => {
    expect(formatConflictFiles(files(1))).toBe('f1.txt')
  })

  it('5 件(上限ちょうど)は全件を並べ、「ほか」を付けない', () => {
    expect(formatConflictFiles(files(5))).toBe('f1.txt, f2.txt, f3.txt, f4.txt, f5.txt')
  })

  it('6 件は 5 件まで並べ「ほか 1 件」を付ける', () => {
    expect(formatConflictFiles(files(6))).toBe('f1.txt, f2.txt, f3.txt, f4.txt, f5.txt ほか 1 件')
  })

  it('7 件は「ほか 2 件」', () => {
    expect(formatConflictFiles(files(7))).toBe('f1.txt, f2.txt, f3.txt, f4.txt, f5.txt ほか 2 件')
  })
})

describe('buildMergeAbortMessage', () => {
  it('コンフリクトがあればファイル名を示す', () => {
    expect(buildMergeAbortMessage(['a.txt', 'b.txt'], '')).toBe(
      'コンフリクトしたため中止しました: a.txt, b.txt'
    )
  })

  it('コンフリクトがあれば detail は無視する', () => {
    expect(buildMergeAbortMessage(['a.txt'], 'hook failed')).toBe(
      'コンフリクトしたため中止しました: a.txt'
    )
  })

  it('コンフリクトが多ければ「ほか N 件」にまとめる', () => {
    expect(buildMergeAbortMessage(files(6), '')).toBe(
      'コンフリクトしたため中止しました: f1.txt, f2.txt, f3.txt, f4.txt, f5.txt ほか 1 件'
    )
  })

  it('コンフリクトが無く detail があれば添える', () => {
    expect(buildMergeAbortMessage([], 'hook failed')).toBe(
      'マージを完了できなかったため中止しました: hook failed'
    )
  })

  it('コンフリクトが無く detail も空なら詳細を添えない', () => {
    expect(buildMergeAbortMessage([], '')).toBe('マージを完了できなかったため中止しました')
  })

  it('ファイル名にカンマや空白が含まれても文言が崩れない', () => {
    expect(buildMergeAbortMessage(['a, b.txt', 'my file.txt'], '')).toBe(
      'コンフリクトしたため中止しました: a, b.txt, my file.txt'
    )
  })
})
