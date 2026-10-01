import { describe, it, expect } from 'vitest'
import {
  MAX_LISTED_CONFLICT_FILES,
  buildMergeAbortMessage,
  buildMergeConflictMessage,
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
  it('detail があれば添える', () => {
    expect(buildMergeAbortMessage('hook failed')).toBe(
      'マージを完了できなかったため中止しました: hook failed'
    )
  })

  it('detail が空なら詳細を添えない', () => {
    expect(buildMergeAbortMessage('')).toBe('マージを完了できなかったため中止しました')
  })
})

describe('buildMergeConflictMessage', () => {
  it('1 件はそのままファイル名を示し、解決か中止を促す', () => {
    expect(buildMergeConflictMessage(['a.txt'])).toBe(
      'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
    )
  })

  it('複数件は ", " 区切りで並べる', () => {
    expect(buildMergeConflictMessage(['a.txt', 'b.txt'])).toBe(
      'コンフリクトしました（a.txt, b.txt）。解決するか、マージを中止してください'
    )
  })

  it('5 件を超えたら「ほか N 件」にまとめる', () => {
    expect(buildMergeConflictMessage(files(6))).toBe(
      'コンフリクトしました（f1.txt, f2.txt, f3.txt, f4.txt, f5.txt ほか 1 件）。解決するか、マージを中止してください'
    )
  })
})
