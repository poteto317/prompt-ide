import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import {
  getGitStatus,
  stageFile,
  unstageFile,
  discardChanges,
  commitChanges,
  getDiff,
  stageHunk,
  unstageHunk,
  getLog,
  getHeadCommitMessage,
  getBranches,
  getTags,
  amendCommit,
  push,
  pull,
  fetchRemote,
  checkoutBranch,
  createBranch,
  deleteBranch,
  stashPop,
  getStashes,
  stashPush,
  stashDrop,
  createTag,
  initRepository,
  cloneRepository,
  cancelCloneRepository,
  addOrigin,
  pushSetUpstream,
  mergeBranch,
  discardHunk,
  discardAll,
  getConflictFile,
  resolveConflictBlocks,
  resolveConflictWholeFile,
  keepConflictFile,
  removeConflictFile,
  markConflictResolved,
  completeMerge,
  abortMerge
} from '../gitApi'

const mockApi = {
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  discardChanges: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(),
  getHeadCommitMessage: vi.fn(),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  amendCommit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  fetchRemote: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  stashPop: vi.fn(),
  getStashes: vi.fn(),
  stashPush: vi.fn(),
  stashDrop: vi.fn(),
  createTag: vi.fn(),
  initRepository: vi.fn(),
  cloneRepository: vi.fn(),
  cancelCloneRepository: vi.fn(),
  addOrigin: vi.fn(),
  pushSetUpstream: vi.fn(),
  mergeBranch: vi.fn(),
  discardHunk: vi.fn(),
  discardAll: vi.fn(),
  getConflictFile: vi.fn(),
  resolveConflictBlocks: vi.fn(),
  resolveConflictWholeFile: vi.fn(),
  keepConflictFile: vi.fn(),
  removeConflictFile: vi.fn(),
  markConflictResolved: vi.fn(),
  completeMerge: vi.fn(),
  abortMerge: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

const mockResult: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

describe('getGitStatus', () => {
  it('window.api.getGitStatus を呼び出す', async () => {
    mockApi.getGitStatus.mockResolvedValue(mockResult)
    const result = await getGitStatus()
    expect(mockApi.getGitStatus).toHaveBeenCalledOnce()
    expect(result).toEqual(mockResult)
  })

  it('isRepo: false の結果もそのまま返す', async () => {
    const notRepo: GitStatusResult = {
      isRepo: false,
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: []
    }
    mockApi.getGitStatus.mockResolvedValue(notRepo)
    const result = await getGitStatus()
    expect(result).toEqual(notRepo)
  })
})

describe('stageFile', () => {
  it('window.api.stageFile を filePath で呼び出す', async () => {
    mockApi.stageFile.mockResolvedValue(undefined)
    await stageFile('src/index.ts')
    expect(mockApi.stageFile).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('unstageFile', () => {
  it('window.api.unstageFile を filePath で呼び出す', async () => {
    mockApi.unstageFile.mockResolvedValue(undefined)
    await unstageFile('src/index.ts')
    expect(mockApi.unstageFile).toHaveBeenCalledWith('src/index.ts', undefined)
  })

  it('renamedFrom を渡すと window.api.unstageFile の第2引数にそのまま渡す', async () => {
    mockApi.unstageFile.mockResolvedValue(undefined)
    await unstageFile('new.txt', 'old.txt')
    expect(mockApi.unstageFile).toHaveBeenCalledWith('new.txt', 'old.txt')
  })
})

describe('discardChanges', () => {
  it('window.api.discardChanges を filePath で呼び出す', async () => {
    mockApi.discardChanges.mockResolvedValue(undefined)
    await discardChanges('src/index.ts')
    expect(mockApi.discardChanges).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('commitChanges', () => {
  it('window.api.commitChanges を message で呼び出す', async () => {
    mockApi.commitChanges.mockResolvedValue(undefined)
    await commitChanges('feat: 新機能')
    expect(mockApi.commitChanges).toHaveBeenCalledWith('feat: 新機能')
  })
})

describe('getDiff', () => {
  it('window.api.getDiff を filePath/staged/isUntracked で呼ぶ', async () => {
    ;(mockApi.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue('DIFF')
    const result = await getDiff('src/index.ts', true, false)
    expect(mockApi.getDiff).toHaveBeenCalledWith('src/index.ts', true, false, undefined)
    expect(result).toBe('DIFF')
  })
})

describe('stageHunk', () => {
  it('window.api.stageHunk を filePath/patch で呼ぶ', async () => {
    await stageHunk('src/index.ts', 'PATCH')
    expect(mockApi.stageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH')
  })
})

describe('unstageHunk', () => {
  it('window.api.unstageHunk を filePath/patch で呼ぶ', async () => {
    await unstageHunk('src/index.ts', 'PATCH')
    expect(mockApi.unstageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH')
  })
})

describe('getLog', () => {
  it('window.api.getLog を limit/skip で呼ぶ', async () => {
    ;(mockApi.getLog as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const result = await getLog(20, 0)
    expect(mockApi.getLog).toHaveBeenCalledWith(20, 0)
    expect(result).toEqual([])
  })
})

describe('getHeadCommitMessage', () => {
  it('window.api.getHeadCommitMessage を呼ぶ', async () => {
    ;(mockApi.getHeadCommitMessage as ReturnType<typeof vi.fn>).mockResolvedValue('feat: x')
    await expect(getHeadCommitMessage()).resolves.toBe('feat: x')
    expect(mockApi.getHeadCommitMessage).toHaveBeenCalledWith()
  })
})

describe('getBranches', () => {
  it('window.api.getBranches を呼ぶ', async () => {
    ;(mockApi.getBranches as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await getBranches()
    expect(mockApi.getBranches).toHaveBeenCalled()
  })
})

describe('getTags', () => {
  it('window.api.getTags を呼ぶ', async () => {
    ;(mockApi.getTags as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await getTags()
    expect(mockApi.getTags).toHaveBeenCalled()
  })
})

describe('amendCommit', () => {
  it('window.api.amendCommit を message で呼ぶ', async () => {
    await amendCommit('feat: 修正後')
    expect(mockApi.amendCommit).toHaveBeenCalledWith('feat: 修正後')
  })
})

describe('push / pull / fetchRemote', () => {
  it('push は引数なしで window.api.push を呼ぶ', async () => {
    mockApi.push.mockResolvedValue(undefined)
    await push()
    expect(mockApi.push).toHaveBeenCalledWith()
  })

  it('pull は引数なしで window.api.pull を呼ぶ', async () => {
    mockApi.pull.mockResolvedValue({ conflicted: false })
    await pull()
    expect(mockApi.pull).toHaveBeenCalledWith()
  })

  it('pull は window.api.pull の結果を返す', async () => {
    mockApi.pull.mockResolvedValue({ conflicted: true })
    await expect(pull()).resolves.toEqual({ conflicted: true })
  })

  it('fetchRemote は引数なしで window.api.fetchRemote を呼ぶ', async () => {
    mockApi.fetchRemote.mockResolvedValue(undefined)
    await fetchRemote()
    expect(mockApi.fetchRemote).toHaveBeenCalledWith()
  })
})

describe('checkoutBranch / createBranch / deleteBranch', () => {
  it('checkoutBranch はブランチ名を渡す', async () => {
    mockApi.checkoutBranch.mockResolvedValue(undefined)
    await checkoutBranch('feature/foo')
    expect(mockApi.checkoutBranch).toHaveBeenCalledWith('feature/foo')
  })

  it('createBranch はブランチ名を渡す', async () => {
    mockApi.createBranch.mockResolvedValue(undefined)
    await createBranch('feature/bar')
    expect(mockApi.createBranch).toHaveBeenCalledWith('feature/bar')
  })

  it('deleteBranch はブランチ名と force フラグを渡し、結果をそのまま返す', async () => {
    const result = { status: 'deleted' }
    mockApi.deleteBranch.mockResolvedValue(result)
    await expect(deleteBranch('feature/baz', false)).resolves.toBe(result)
    expect(mockApi.deleteBranch).toHaveBeenCalledWith('feature/baz', false)
  })

  it('deleteBranch は force=true も渡せる', async () => {
    const result = { status: 'deleted' }
    mockApi.deleteBranch.mockResolvedValue(result)
    await deleteBranch('feature/baz', true)
    expect(mockApi.deleteBranch).toHaveBeenCalledWith('feature/baz', true)
  })
})

describe('getStashes / stashPush / stashDrop', () => {
  it('getStashes は window.api.getStashes を呼び、配列をそのまま返す', async () => {
    const stashes = [{ sha: 'abc', message: 'WIP' }]
    mockApi.getStashes.mockResolvedValue(stashes)
    await expect(getStashes()).resolves.toBe(stashes)
    expect(mockApi.getStashes).toHaveBeenCalledWith()
  })

  it('stashPush はメッセージを渡す', async () => {
    mockApi.stashPush.mockResolvedValue(undefined)
    await stashPush('作業中')
    expect(mockApi.stashPush).toHaveBeenCalledWith('作業中')
  })

  it('stashDrop は SHA を渡す', async () => {
    mockApi.stashDrop.mockResolvedValue(undefined)
    await stashDrop('a'.repeat(40))
    expect(mockApi.stashDrop).toHaveBeenCalledWith('a'.repeat(40))
  })
})

describe('stashPop', () => {
  it('window.api.stashPop を SHA で呼び、結果をそのまま返す', async () => {
    const result = { status: 'rollbackFailed', message: 'm' }
    mockApi.stashPop.mockResolvedValue(result)
    await expect(stashPop('a'.repeat(40))).resolves.toBe(result)
    expect(mockApi.stashPop).toHaveBeenCalledWith('a'.repeat(40))
  })
})

describe('mergeBranch', () => {
  it.each([
    ['merged', { status: 'merged' }],
    [
      'conflict',
      {
        status: 'conflict',
        message: 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
      }
    ]
  ])(
    'window.api.mergeBranch をブランチ名で呼び、%s の結果をそのまま返す',
    async (_label, result) => {
      mockApi.mergeBranch.mockResolvedValue(result)
      await expect(mergeBranch('feature/x')).resolves.toBe(result)
      expect(mockApi.mergeBranch).toHaveBeenCalledWith('feature/x')
    }
  )
})

describe('discardHunk', () => {
  it('window.api.discardHunk に filePath と patch をそのまま渡す', async () => {
    mockApi.discardHunk.mockResolvedValue(undefined)
    await discardHunk('src/a.ts', 'PATCH')
    expect(mockApi.discardHunk).toHaveBeenCalledWith('src/a.ts', 'PATCH')
  })
})

describe('discardAll', () => {
  it('window.api.discardAll に確認時の一覧をそのまま渡す', async () => {
    mockApi.discardAll.mockResolvedValue({ status: 'done' })
    const entries = [{ path: 'a.txt', status: ' M' }]
    await discardAll(entries)
    expect(mockApi.discardAll).toHaveBeenCalledWith(entries)
  })

  it.each([{ status: 'done' }, { status: 'partial', message: '途中で失敗しました' }] as const)(
    '結果(%o)をそのまま返す',
    async (result) => {
      mockApi.discardAll.mockResolvedValue(result)
      await expect(discardAll([])).resolves.toEqual(result)
    }
  )
})

describe('コンフリクトの解決', () => {
  it('getConflictFile は filePath を渡し、結果をそのまま返す', async () => {
    const file = { status: 'unparsable' }
    mockApi.getConflictFile.mockResolvedValue(file)
    await expect(getConflictFile('a.txt')).resolves.toBe(file)
    expect(mockApi.getConflictFile).toHaveBeenCalledWith('a.txt')
  })

  it('resolveConflictBlocks は filePath・digests・choices をそのまま渡す', async () => {
    mockApi.resolveConflictBlocks.mockResolvedValue(undefined)
    await resolveConflictBlocks('a.txt', ['d'], { 0: 'both' })
    expect(mockApi.resolveConflictBlocks).toHaveBeenCalledWith('a.txt', ['d'], { 0: 'both' })
  })

  it('resolveConflictWholeFile は filePath と side をそのまま渡す', async () => {
    mockApi.resolveConflictWholeFile.mockResolvedValue(undefined)
    await resolveConflictWholeFile('a.txt', 'ours')
    expect(mockApi.resolveConflictWholeFile).toHaveBeenCalledWith('a.txt', 'ours')
  })

  it.each([
    ['keepConflictFile', keepConflictFile],
    ['removeConflictFile', removeConflictFile],
    ['markConflictResolved', markConflictResolved]
  ] as const)('%s は filePath をそのまま渡す', async (name, fn) => {
    mockApi[name].mockResolvedValue(undefined)
    await fn('a.txt')
    expect(mockApi[name]).toHaveBeenCalledWith('a.txt')
  })

  it.each([
    ['completeMerge', completeMerge],
    ['abortMerge', abortMerge]
  ] as const)('%s は引数なしで呼ぶ', async (name, fn) => {
    mockApi[name].mockResolvedValue(undefined)
    await fn()
    expect(mockApi[name]).toHaveBeenCalledWith()
  })
})

describe('createTag', () => {
  it('window.api.createTag を要求で呼ぶ', async () => {
    mockApi.createTag.mockResolvedValue(undefined)
    const request = { name: 'v1', kind: 'lightweight' as const, message: '' }
    await createTag(request)
    expect(mockApi.createTag).toHaveBeenCalledWith(request)
  })

  it('失敗をそのまま伝える', async () => {
    mockApi.createTag.mockRejectedValue(new Error('コミットが無いため、タグを作成できません'))
    await expect(createTag({ name: 'v1', kind: 'lightweight', message: '' })).rejects.toThrow(
      'コミットが無いため、タグを作成できません'
    )
  })
})

describe('initRepository / addOrigin / pushSetUpstream', () => {
  it('window.api の同名の関数を値で呼ぶ', async () => {
    mockApi.initRepository.mockResolvedValue(undefined)
    mockApi.addOrigin.mockResolvedValue(undefined)
    mockApi.pushSetUpstream.mockResolvedValue(undefined)
    await initRepository('main')
    await addOrigin('https://github.com/a/b.git')
    await pushSetUpstream()
    expect(mockApi.initRepository).toHaveBeenCalledWith('main')
    expect(mockApi.addOrigin).toHaveBeenCalledWith('https://github.com/a/b.git')
    expect(mockApi.pushSetUpstream).toHaveBeenCalledWith()
  })

  it('失敗をそのまま伝える', async () => {
    mockApi.pushSetUpstream.mockRejectedValue(
      new Error('リモート origin が未設定のため、初回 push できません')
    )
    await expect(pushSetUpstream()).rejects.toThrow(
      'リモート origin が未設定のため、初回 push できません'
    )
  })
})

describe('cloneRepository / cancelCloneRepository', () => {
  it('window.api の同名の関数を呼び、結果をそのまま返す', async () => {
    mockApi.cloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    mockApi.cancelCloneRepository.mockResolvedValueOnce(undefined)
    await expect(cloneRepository('https://github.com/a/b.git', 'b')).resolves.toEqual({
      status: 'cloned',
      path: '/parent/b'
    })
    await cancelCloneRepository()
    expect(mockApi.cloneRepository).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    expect(mockApi.cancelCloneRepository).toHaveBeenCalledWith()
  })

  it('失敗をそのまま伝える', async () => {
    mockApi.cloneRepository.mockRejectedValueOnce(new Error('既に clone を実行中です'))
    await expect(cloneRepository('https://github.com/a/b.git', 'b')).rejects.toThrow(
      '既に clone を実行中です'
    )
  })
})
