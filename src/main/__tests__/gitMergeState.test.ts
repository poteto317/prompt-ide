import { describe, it, expect, vi } from 'vitest'
import type { SimpleGit } from 'simple-git'
import {
  getUnmergedStages,
  hasMergeInProgress,
  hasUnmergedFiles,
  isUnmergedPath,
  listUnresolvedFiles
} from '../gitMergeState'

// ls-files -u -z の 1 エントリ(stage: 1=共通祖先 2=自分 3=相手)
const entry = (stage: number, path: string): string =>
  `100644 ${'a'.repeat(40)} ${stage}\t${path}\0`

const makeGit = (output: string): { git: SimpleGit; raw: ReturnType<typeof vi.fn> } => {
  const raw = vi.fn().mockResolvedValue(output)
  return { git: { raw } as unknown as SimpleGit, raw }
}

describe('getUnmergedStages', () => {
  it.each([
    ['両側あり(UU)', entry(1, 'a.txt') + entry(2, 'a.txt') + entry(3, 'a.txt'), [1, 2, 3]],
    ['自分だけ(DU)', entry(1, 'a.txt') + entry(2, 'a.txt'), [1, 2]],
    ['相手だけ(UD)', entry(1, 'a.txt') + entry(3, 'a.txt'), [1, 3]],
    ['AA(共通祖先なし)', entry(2, 'a.txt') + entry(3, 'a.txt'), [2, 3]],
    ['エントリ無し', '', []]
  ])('%s: ステージ番号を取り出す', async (_name, output, expected) => {
    const { git } = makeGit(output)
    expect(await getUnmergedStages(git, 'a.txt')).toEqual(expected)
  })

  it('literal pathspec で問い合わせる', async () => {
    const { git, raw } = makeGit('')
    await getUnmergedStages(git, 'a[1].txt')
    expect(raw).toHaveBeenCalledWith(['ls-files', '-u', '-z', '--', ':(literal)a[1].txt'])
  })

  it('別パスのエントリは数えない(前方一致・グロブを取り違えない)', async () => {
    const { git } = makeGit(
      entry(2, 'a.txt.bak') + entry(3, 'a.txt.bak') + entry(2, 'a.txt') + entry(2, 'sub/a.txt')
    )
    expect(await getUnmergedStages(git, 'a.txt')).toEqual([2])
    expect(await getUnmergedStages(git, 'a.tx')).toEqual([])
    expect(await getUnmergedStages(git, '*.txt')).toEqual([])
  })

  it('パスの先頭の空白は削らずに照合する', async () => {
    const { git } = makeGit(entry(2, ' a.txt'))
    expect(await getUnmergedStages(git, 'a.txt')).toEqual([])
    expect(await getUnmergedStages(git, ' a.txt')).toEqual([2])
  })
})

describe('isUnmergedPath', () => {
  it('完全一致するエントリがあれば true', async () => {
    expect(await isUnmergedPath(makeGit(entry(2, 'a.txt')).git, 'a.txt')).toBe(true)
  })

  it('エントリが無い・別パスだけなら false', async () => {
    expect(await isUnmergedPath(makeGit('').git, 'a.txt')).toBe(false)
    expect(await isUnmergedPath(makeGit(entry(2, 'a.txt.bak')).git, 'a.txt')).toBe(false)
  })
})

describe('hasUnmergedFiles', () => {
  it('パスを絞らずに ls-files -u -z を問い合わせ、出力があれば true', async () => {
    const { git, raw } = makeGit(entry(2, 'a.txt'))
    expect(await hasUnmergedFiles(git)).toBe(true)
    expect(raw).toHaveBeenCalledWith(['ls-files', '-u', '-z'])
  })

  it('出力が空なら false', async () => {
    expect(await hasUnmergedFiles(makeGit('').git)).toBe(false)
  })
})

describe('hasMergeInProgress', () => {
  it('MERGE_HEAD の出力があれば true、空文字(ref が無い。reject しない)なら false', async () => {
    const { git, raw } = makeGit('abc123\n')
    expect(await hasMergeInProgress(git)).toBe(true)
    expect(raw).toHaveBeenCalledWith(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(await hasMergeInProgress(makeGit('').git)).toBe(false)
  })

  it('raw が reject したら、マージ中ではないとみなさずそのまま throw する', async () => {
    const raw = vi.fn().mockRejectedValue(new Error('git が失敗'))
    await expect(hasMergeInProgress({ raw } as unknown as SimpleGit)).rejects.toThrow('git が失敗')
  })
})

describe('listUnresolvedFiles', () => {
  it('diff --diff-filter=U の NUL 区切りの出力をパスの配列にする', async () => {
    const { git, raw } = makeGit('a.txt\0sub/b c.txt\0')
    expect(await listUnresolvedFiles(git)).toEqual(['a.txt', 'sub/b c.txt'])
    expect(raw).toHaveBeenCalledWith(['diff', '--name-only', '-z', '--diff-filter=U'])
  })

  it('未解決のファイルが無ければ空配列', async () => {
    const { git } = makeGit('')
    expect(await listUnresolvedFiles(git)).toEqual([])
  })

  it('git の失敗は握りつぶさずに投げる', async () => {
    const raw = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(listUnresolvedFiles({ raw } as unknown as SimpleGit)).rejects.toThrow('boom')
  })
})
