import { describe, it, expect, vi } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { assertRestorable, assertStashable, hasInProgressOperation } from '../gitStashGuards'

const STATUS_ARGS = [
  'status',
  '--porcelain',
  '-z',
  '--untracked-files=all',
  '--ignore-submodules=all'
]

type Responses = {
  head?: string
  unmerged?: string
  inProgress?: string
  status?: string
  lsFiles?: string
}

// raw だけを持つスタブ。呼び出しを種類で振り分ける。
// rev-parse --verify -q は ref が無いと空文字で resolve する(実 git で確認済み)
const createGit = (r: Responses = {}): { git: SimpleGit; raw: ReturnType<typeof vi.fn> } => {
  const raw = vi.fn(async (args: string[]) => {
    if (args[0] === 'rev-parse') {
      const ref = args[args.length - 1]
      if (ref === 'HEAD') return r.head ?? 'abc123\n'
      return ref === r.inProgress ? 'def456\n' : ''
    }
    if (args[0] === 'ls-files' && args[1] === '-u') return r.unmerged ?? ''
    if (args[0] === 'ls-files' && args[1] === '-v') return r.lsFiles ?? 'H a.txt\0'
    if (args[0] === 'status') return r.status ?? ''
    throw new Error(`unexpected raw: ${args.join(' ')}`)
  })
  return { git: { raw } as unknown as SimpleGit, raw }
}

const callsOf = (raw: ReturnType<typeof vi.fn>): string[][] =>
  raw.mock.calls.map((call) => call[0] as string[])

describe('hasInProgressOperation', () => {
  it.each(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'])('%s があれば true', async (ref) => {
    const { git } = createGit({ inProgress: ref })
    await expect(hasInProgressOperation(git)).resolves.toBe(true)
  })

  it('どれも無ければ true にならない', async () => {
    const { git, raw } = createGit()
    await expect(hasInProgressOperation(git)).resolves.toBe(false)
    expect(callsOf(raw)).toEqual([
      ['rev-parse', '--verify', '-q', 'MERGE_HEAD'],
      ['rev-parse', '--verify', '-q', 'CHERRY_PICK_HEAD'],
      ['rev-parse', '--verify', '-q', 'REVERT_HEAD']
    ])
  })
})

describe('assertStashable', () => {
  it('HEAD が無ければ「コミットが無いため stash できません」で、後続の git を呼ばない', async () => {
    const { git, raw } = createGit({ head: '' })
    await expect(assertStashable(git)).rejects.toThrow('コミットが無いため stash できません')
    expect(callsOf(raw)).toEqual([['rev-parse', '--verify', '-q', 'HEAD']])
  })

  it('未解決ファイルがあれば「コンフリクト中のため stash できません」で、途中操作・status を呼ばない', async () => {
    const { git, raw } = createGit({ unmerged: '100644 abc 1\ta.txt\0', status: ' M a.txt\0' })
    await expect(assertStashable(git)).rejects.toThrow('コンフリクト中のため stash できません')
    expect(callsOf(raw)).toEqual([
      ['rev-parse', '--verify', '-q', 'HEAD'],
      ['ls-files', '-u', '-z']
    ])
  })

  it.each(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'])(
    '%s があれば途中操作として拒否し、status を呼ばない',
    async (ref) => {
      const { git, raw } = createGit({ inProgress: ref, status: ' M a.txt\0' })
      await expect(assertStashable(git)).rejects.toThrow(
        'マージ・cherry-pick・revert の途中のため stash できません'
      )
      expect(callsOf(raw).some((a) => a[0] === 'status')).toBe(false)
    }
  )

  it('変更が無ければ「stash する変更がありません」', async () => {
    const { git } = createGit({ status: '' })
    await expect(assertStashable(git)).rejects.toThrow('stash する変更がありません')
  })

  it('変更があれば通り、検証は HEAD → ls-files -u → 途中操作 → status の順', async () => {
    const { git, raw } = createGit({ status: ' M a.txt\0' })
    await expect(assertStashable(git)).resolves.toBeUndefined()
    expect(callsOf(raw)).toEqual([
      ['rev-parse', '--verify', '-q', 'HEAD'],
      ['ls-files', '-u', '-z'],
      ['rev-parse', '--verify', '-q', 'MERGE_HEAD'],
      ['rev-parse', '--verify', '-q', 'CHERRY_PICK_HEAD'],
      ['rev-parse', '--verify', '-q', 'REVERT_HEAD'],
      STATUS_ARGS
    ])
  })
})

describe('assertRestorable', () => {
  it('変更があれば「作業中の変更があるため戻せません…」で、ls-files -v を呼ばない', async () => {
    const { git, raw } = createGit({ status: ' M a.txt\0' })
    await expect(assertRestorable(git)).rejects.toThrow(
      '作業中の変更があるため戻せません。先にコミットまたは stash してください'
    )
    expect(callsOf(raw)).toEqual([STATUS_ARGS])
  })

  it.each(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'])(
    '%s があれば(status が空でも)途中操作として拒否し、ls-files を呼ばない',
    async (ref) => {
      const { git, raw } = createGit({ inProgress: ref })
      await expect(assertRestorable(git)).rejects.toThrow(
        'マージ・cherry-pick・revert の途中のため戻せません'
      )
      expect(callsOf(raw).some((a) => a[0] === 'ls-files')).toBe(false)
    }
  )

  it('assume-unchanged(小文字タグ)があれば拒否する', async () => {
    const { git } = createGit({ lsFiles: 'H a.txt\0h b.txt\0' })
    await expect(assertRestorable(git)).rejects.toThrow(
      'assume-unchanged を付けたファイルがあるため戻せません（失敗したときの巻き戻しでそのファイルの変更が失われるおそれがあります）'
    )
  })

  it('skip-worktree(S)は許可する', async () => {
    const { git } = createGit({ lsFiles: 'H a.txt\0S b.txt\0' })
    await expect(assertRestorable(git)).resolves.toBeUndefined()
  })

  it('パスに小文字で始まる文字列や空白があっても、先頭のタグだけで判定する', async () => {
    const { git } = createGit({ lsFiles: 'H abc def.txt\0H x h y.txt\0' })
    await expect(assertRestorable(git)).resolves.toBeUndefined()
  })

  it('きれいなら通り、status → 途中操作 → ls-files -v の順に呼ぶ', async () => {
    const { git, raw } = createGit()
    await expect(assertRestorable(git)).resolves.toBeUndefined()
    expect(callsOf(raw)).toEqual([
      STATUS_ARGS,
      ['rev-parse', '--verify', '-q', 'MERGE_HEAD'],
      ['rev-parse', '--verify', '-q', 'CHERRY_PICK_HEAD'],
      ['rev-parse', '--verify', '-q', 'REVERT_HEAD'],
      ['ls-files', '-v', '-z']
    ])
  })
})

describe('status の引数(push 側と pop 側で共通)', () => {
  it('assertStashable も assertRestorable も同じ引数列で status を呼ぶ', async () => {
    const stashable = createGit({ status: ' M a.txt\0' })
    await assertStashable(stashable.git)
    const restorable = createGit()
    await assertRestorable(restorable.git)
    const statusOf = (raw: ReturnType<typeof vi.fn>): string[][] =>
      callsOf(raw).filter((a) => a[0] === 'status')
    expect(statusOf(stashable.raw)).toEqual([STATUS_ARGS])
    expect(statusOf(restorable.raw)).toEqual([STATUS_ARGS])
  })
})
