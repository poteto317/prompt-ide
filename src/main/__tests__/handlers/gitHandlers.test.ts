import { describe, it, expect, vi, beforeEach } from 'vitest'
import { relative, sep } from 'node:path'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetGitStatus = vi.hoisted(() => vi.fn())
const mockStageFile = vi.hoisted(() => vi.fn())
const mockUnstageFile = vi.hoisted(() => vi.fn())
const mockDiscardFileChanges = vi.hoisted(() => vi.fn())
const mockDiscardHunk = vi.hoisted(() => vi.fn())
const mockDiscardAllChanges = vi.hoisted(() => vi.fn())
const mockMoveToTrash = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockGetDiff = vi.hoisted(() => vi.fn())
const mockStageHunk = vi.hoisted(() => vi.fn())
const mockUnstageHunk = vi.hoisted(() => vi.fn())
const mockGetLog = vi.hoisted(() => vi.fn())
const mockGetHeadCommitMessage = vi.hoisted(() => vi.fn())
const mockGetBranches = vi.hoisted(() => vi.fn())
const mockGetTags = vi.hoisted(() => vi.fn())
const mockAmendCommit = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())
const mockPull = vi.hoisted(() => vi.fn())
const mockFetchRemote = vi.hoisted(() => vi.fn())
const mockCheckoutBranch = vi.hoisted(() => vi.fn())
const mockCreateBranch = vi.hoisted(() => vi.fn())
const mockDeleteBranch = vi.hoisted(() => vi.fn())
const mockMergeBranch = vi.hoisted(() => vi.fn())
const mockGetStashes = vi.hoisted(() => vi.fn())
const mockStashPush = vi.hoisted(() => vi.fn())
const mockStashPop = vi.hoisted(() => vi.fn())
const mockStashDrop = vi.hoisted(() => vi.fn())
const mockCreateTag = vi.hoisted(() => vi.fn())
const mockInitRepository = vi.hoisted(() => vi.fn())
const mockAddOrigin = vi.hoisted(() => vi.fn())
const mockPushSetUpstream = vi.hoisted(() => vi.fn())
const mockConflict = vi.hoisted(() => ({
  getConflictFile: vi.fn(),
  resolveConflictBlocks: vi.fn(),
  resolveConflictWholeFile: vi.fn(),
  keepConflictFile: vi.fn(),
  removeConflictFile: vi.fn(),
  markConflictResolved: vi.fn(),
  completeMerge: vi.fn(),
  abortMerge: vi.fn()
}))
const mockToGitRelativePath = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('../../gitService', () => ({
  getGitStatus: mockGetGitStatus,
  stageFile: mockStageFile,
  unstageFile: mockUnstageFile,
  commit: mockCommit,
  getDiff: mockGetDiff,
  getLog: mockGetLog,
  getHeadCommitMessage: mockGetHeadCommitMessage,
  getBranches: mockGetBranches,
  getTags: mockGetTags,
  amendCommit: mockAmendCommit,
  push: mockPush,
  pull: mockPull,
  fetchRemote: mockFetchRemote,
  checkoutBranch: mockCheckoutBranch,
  createBranch: mockCreateBranch,
  deleteBranch: mockDeleteBranch,
  mergeBranch: mockMergeBranch,
  // gitHandlers.ts と gitService.ts が同じ条件を共有するために切り出した実体を
  // そのまま使う(モックで別ロジックを持つと、本番の判定とテストの前提がずれる)
  isStagedRenameDiff: (staged: boolean, renamedFrom: string | undefined): renamedFrom is string =>
    staged && renamedFrom !== undefined
}))

vi.mock('../../gitDiscardService', () => ({
  discardFileChanges: mockDiscardFileChanges,
  discardHunk: mockDiscardHunk,
  discardAllChanges: mockDiscardAllChanges
}))

vi.mock('../../gitConflictService', () => mockConflict)

vi.mock('../../gitStashService', () => ({
  getStashes: mockGetStashes,
  stashPush: mockStashPush,
  stashPop: mockStashPop,
  stashDrop: mockStashDrop
}))

vi.mock('../../gitTagService', () => ({ createTag: mockCreateTag }))

vi.mock('../../gitRemoteSetupService', () => ({
  initRepository: mockInitRepository,
  addOrigin: mockAddOrigin,
  pushSetUpstream: mockPushSetUpstream
}))

vi.mock('../../gitApply', () => ({
  stageHunk: mockStageHunk,
  unstageHunk: mockUnstageHunk
}))

vi.mock('../../trash', () => ({ moveToTrash: mockMoveToTrash }))

vi.mock('../../pathNormalize', () => ({
  toGitRelativePath: mockToGitRelativePath
}))

vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath
}))

import { registerGitHandlers } from '../../handlers/gitHandlers'

const mockIpcMain = { handle: mockHandle } as never

function makeFolderAccess(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn(),
    ...overrides
  } as unknown as FolderAccessManager
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  // 既存の git:getDiff テストは実際の相対パス変換と同じ結果を返すデフォルト実装で扱う。
  // 正規化そのものの振る舞いは pathNormalize.test.ts で検証する
  mockToGitRelativePath.mockImplementation((folder: string, absolutePath: string) =>
    relative(folder, absolutePath).split(sep).join('/')
  )
  // 既定はシンボリックリンクを含まないパス(realpath = 入力そのもの)
  mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
})

const GIT_CHANNELS = [
  'git:abortMerge',
  'git:addOrigin',
  'git:amendCommit',
  'git:checkoutBranch',
  'git:commit',
  'git:completeMerge',
  'git:createBranch',
  'git:createTag',
  'git:deleteBranch',
  'git:discardAll',
  'git:discardChanges',
  'git:discardHunk',
  'git:fetch',
  'git:getBranches',
  'git:getConflictFile',
  'git:getDiff',
  'git:getHeadCommitMessage',
  'git:getLog',
  'git:getStashes',
  'git:getStatus',
  'git:getTags',
  'git:init',
  'git:keepConflictFile',
  'git:markConflictResolved',
  'git:mergeBranch',
  'git:pull',
  'git:push',
  'git:pushSetUpstream',
  'git:removeConflictFile',
  'git:resolveConflictBlocks',
  'git:resolveConflictWholeFile',
  'git:stage',
  'git:stageHunk',
  'git:stashDrop',
  'git:stashPop',
  'git:stashPush',
  'git:unstage',
  'git:unstageHunk'
]

describe('registerGitHandlers', () => {
  it('登録されるチャンネルが 37 件の一覧と過不足なく一致し、重複しない', () => {
    registerGitHandlers(mockIpcMain, makeFolderAccess())
    const channels = mockHandle.mock.calls.map(([ch]) => ch as string)
    expect(new Set(channels).size).toBe(channels.length)
    expect([...channels].sort()).toEqual([...GIT_CHANNELS].sort())
  })

  describe('git:getStatus', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getStatus')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder を引数に getGitStatus を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      const mockResult = {
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
      mockGetGitStatus.mockResolvedValue(mockResult)
      const result = await getRegisteredHandler('git:getStatus')(makeEvent(1))
      expect(mockGetGitStatus).toHaveBeenCalledWith('/project')
      expect(result).toEqual(mockResult)
    })

    it('getGitStatus が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetGitStatus.mockRejectedValue(new Error('git error'))
      await expect(getRegisteredHandler('git:getStatus')(makeEvent(1))).rejects.toThrow('git error')
    })
  })

  describe('git:stage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')).rejects.toThrow(
        'No folder open'
      )
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、stageFile にはリポジトリ相対パスで呼ぶ', async () => {
      // 絶対パスのまま stageFile(git add)に渡すと、失敗時の GitError に
      // pathspec として OS 絶対パス(ユーザー名やディレクトリ構造を含む)が
      // そのまま乗り、レンダラーへ伝播してしまう。git:getDiff/stageHunk/
      // unstageHunk と同じ理由で相対パス化する
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', 'src/index.ts')
    })

    it('assertWithinFolder が throw した場合、stageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockStageFile).not.toHaveBeenCalled()
    })

    it('相対パスの filePath を allowedFolder 基準の絶対パスに解決してから assertWithinFolder を呼び、stageFile にはリポジトリ相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', 'src/index.ts')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから stageFile を相対パスで呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), 'deleted.ts')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockStageFile).toHaveBeenCalledWith('/project', 'deleted.ts')
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、assertParentWithinFolder にフォールバックせずエラーを伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
      const assertParentWithinFolder = vi.fn()
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '../outside/deleted.ts')
      ).rejects.toThrow('Access denied')
      expect(assertParentWithinFolder).not.toHaveBeenCalled()
      expect(mockStageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:discardHunk', () => {
    it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:discardHunk')(makeEvent(1), 'src/a.ts', 123)
      ).rejects.toThrow('No folder open')
      expect(mockDiscardHunk).not.toHaveBeenCalled()
    })

    it.each([null, undefined, 123, {}, ['x']])(
      'patch が文字列でない(%s)と discardHunk を呼ばずに拒否する',
      async (bad) => {
        const folderAccess = makeFolderAccess({
          get: vi.fn().mockReturnValue('/project'),
          assertWithinFolder: vi.fn().mockResolvedValue(undefined)
        })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(
          getRegisteredHandler('git:discardHunk')(makeEvent(1), 'src/a.ts', bad)
        ).rejects.toThrow('Invalid patch')
        expect(mockDiscardHunk).not.toHaveBeenCalled()
      }
    )

    it('境界チェック後、リポジトリ相対パスと patch を渡して discardHunk を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockDiscardHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:discardHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockDiscardHunk).toHaveBeenCalledWith('/project', 'src/index.ts', 'PATCH')
    })

    it('フォルダ外のパスは discardHunk を呼ばずに Access denied を伝播する', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied'))
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:discardHunk')(makeEvent(1), '/outside/file.ts', 'PATCH')
      ).rejects.toThrow('Access denied')
      expect(mockDiscardHunk).not.toHaveBeenCalled()
    })
  })

  describe('git:discardAll', () => {
    it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:discardAll')(makeEvent(1), 'x')).rejects.toThrow(
        'No folder open'
      )
      expect(mockDiscardAllChanges).not.toHaveBeenCalled()
    })

    it.each([
      ['3'],
      [3],
      [null],
      [undefined],
      [{}],
      [['a.txt']],
      [[null]],
      [[{ path: 'a.txt' }]],
      [[{ status: ' M' }]],
      [[{ path: 1, status: ' M' }]],
      [[{ path: 'a.txt', status: 1 }]],
      [[{ path: 'a.txt', status: ' ' }]],
      [[{ path: 'a.txt', status: ' MM' }]],
      [[{ path: 'a.txt', status: ' M' }, 'x']]
    ])(
      '一覧が {path, status(2 文字)} の配列でない(%j)と discardAllChanges を呼ばずに拒否する',
      async (bad) => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(getRegisteredHandler('git:discardAll')(makeEvent(1), bad)).rejects.toThrow(
          'Invalid entries'
        )
        expect(mockDiscardAllChanges).not.toHaveBeenCalled()
      }
    )

    it.each([
      [[]],
      [
        [
          { path: 'a.txt', status: ' M' },
          { path: 'sub/', status: '??' }
        ]
      ]
    ])('一覧 %j のとき moveToTrash を渡して discardAllChanges を呼ぶ', async (entries) => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockDiscardAllChanges.mockResolvedValue({ status: 'done' })
      await getRegisteredHandler('git:discardAll')(makeEvent(1), entries)
      expect(mockDiscardAllChanges).toHaveBeenCalledWith('/project', entries, mockMoveToTrash)
    })

    it.each([
      { status: 'done' },
      {
        status: 'partial',
        message: '一括の取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: x'
      }
    ])('discardAllChanges の結果(%o)をそのまま返す', async (result) => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockDiscardAllChanges.mockResolvedValue(result)
      await expect(getRegisteredHandler('git:discardAll')(makeEvent(1), [])).resolves.toEqual(
        result
      )
    })
  })

  describe('git:discardChanges', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:discardChanges')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    // stage と同じく、失敗時のエラーに OS 絶対パスが乗らないよう相対パスで渡す。
    // ゴミ箱への移動は Electron に依存するため main/trash.ts の関数を注入する
    it('境界チェック後、リポジトリ相対パスと moveToTrash を渡して discardFileChanges を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockDiscardFileChanges.mockResolvedValue(undefined)
      await getRegisteredHandler('git:discardChanges')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockDiscardFileChanges).toHaveBeenCalledWith(
        '/project',
        'src/index.ts',
        mockMoveToTrash
      )
    })

    it('フォルダ外のパスは discardFileChanges を呼ばずにエラーを伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:discardChanges')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockDiscardFileChanges).not.toHaveBeenCalled()
    })

    // git status は未追跡ディレクトリを 'newdir/' の形で返す
    it('末尾が / の未追跡ディレクトリも相対パスへ変換して渡す', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockDiscardFileChanges.mockResolvedValue(undefined)
      await getRegisteredHandler('git:discardChanges')(makeEvent(1), 'newdir/')
      expect(mockDiscardFileChanges).toHaveBeenCalledWith('/project', 'newdir', mockMoveToTrash)
    })

    // discard は git status のパス(index の表記)のまま渡す。親を realpath してディスク上の
    // 表記に作り直すと、NFD の日本語ディレクトリ名や大文字小文字だけ違うディレクトリ名で
    // index と一致しなくなり、追跡済みの変更ファイルがゴミ箱へ移っていた(PR レビュー指摘)
    describe('パスの表記', () => {
      const setupDiscard = (): void => {
        const folderAccess = makeFolderAccess({
          get: vi.fn().mockReturnValue('/project'),
          assertWithinFolder: vi.fn().mockResolvedValue(undefined)
        })
        registerGitHandlers(mockIpcMain, folderAccess)
        mockDiscardFileChanges.mockResolvedValue(undefined)
      }

      it('親の realpath が大文字小文字だけ違う表記を返しても、status の表記のまま渡す', async () => {
        setupDiscard()
        mockRealpath.mockImplementation((p: string) =>
          Promise.resolve(p === '/project/Src' ? '/project/src' : p)
        )
        await getRegisteredHandler('git:discardChanges')(makeEvent(1), 'Src/a.ts')
        expect(mockDiscardFileChanges).toHaveBeenCalledWith('/project', 'Src/a.ts', mockMoveToTrash)
      })

      it('親の realpath が NFD を返しても、NFC(status の表記)のまま渡す', async () => {
        setupDiscard()
        const nfc = 'プロンプト'.normalize('NFC')
        const nfd = nfc.normalize('NFD')
        mockRealpath.mockImplementation((p: string) =>
          Promise.resolve(p === `/project/${nfc}` ? `/project/${nfd}` : p)
        )
        await getRegisteredHandler('git:discardChanges')(makeEvent(1), `${nfc}/a.md`)
        expect(mockDiscardFileChanges).toHaveBeenCalledWith(
          '/project',
          `${nfc}/a.md`,
          mockMoveToTrash
        )
      })

      // 以前は realpath で 'd/t.txt' に作り直していた(ls-files が空で未追跡と誤判定され、
      // 実体の d/t.txt がゴミ箱へ移るのを防ぐため)。現在は discardFileChanges が未追跡を
      // ls-files --others で肯定的に確かめ、'linkd/t.txt' は判定不能として拒否する
      // (gitDiscardService.integration.test.ts で実 git により固定)
      it('シンボリックリンクの祖先ディレクトリを経由したパスも、そのまま渡す', async () => {
        setupDiscard()
        mockRealpath.mockImplementation((p: string) =>
          Promise.resolve(p === '/project/linkd' ? '/project/d' : p)
        )
        await getRegisteredHandler('git:discardChanges')(makeEvent(1), 'linkd/t.txt')
        expect(mockDiscardFileChanges).toHaveBeenCalledWith(
          '/project',
          'linkd/t.txt',
          mockMoveToTrash
        )
      })

      // 境界チェックが通っても、相対パスが許可フォルダの外を指すなら git へ渡さない(fail-safe)
      it('相対パスが許可フォルダの外を指すなら discardFileChanges を呼ばずに拒否する', async () => {
        setupDiscard()
        await expect(
          getRegisteredHandler('git:discardChanges')(makeEvent(1), '../outside.txt')
        ).rejects.toThrow('Access denied')
        expect(mockDiscardFileChanges).not.toHaveBeenCalled()
      })

      it("'..' で始まる名前のファイル('..env' 等)はフォルダ外とみなさずに渡す", async () => {
        setupDiscard()
        await getRegisteredHandler('git:discardChanges')(makeEvent(1), '..env')
        expect(mockDiscardFileChanges).toHaveBeenCalledWith('/project', '..env', mockMoveToTrash)
      })
    })
  })

  describe('git:unstage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、unstageFile にはリポジトリ相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'src/index.ts', undefined)
    })

    it('assertWithinFolder が throw した場合、unstageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })

    it('相対パスの filePath を allowedFolder 基準の絶対パスに解決してから assertWithinFolder を呼び、unstageFile にはリポジトリ相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'src/index.ts', undefined)
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから unstageFile を相対パスで呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'deleted.ts')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'deleted.ts', undefined)
    })

    it('renamedFrom が渡された場合、境界チェックした上で unstageFile の第3引数(旧パス)へリポジトリ相対パスで渡す', async () => {
      // 新パスだけを reset すると、旧パスの削除だけが index に残ったまま
      // (D old.txt / ?? new.txt)になり、アンステージのつもりが壊れた状態を
      // 作ってしまう(実機で再現確認済み)。旧パスも境界チェック・相対パス化
      // した上で unstageFile へ渡す必要がある
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'new.txt', 'old.txt')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/new.txt')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/old.txt')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'new.txt', 'old.txt')
    })

    it('renamedFrom を省略した場合、unstageFile は第3引数無しで呼ばれる', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'src/index.ts', undefined)
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、assertParentWithinFolder にフォールバックせずエラーを伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
      const assertParentWithinFolder = vi.fn()
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '../outside/deleted.ts')
      ).rejects.toThrow('Access denied')
      expect(assertParentWithinFolder).not.toHaveBeenCalled()
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:commit', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と message を引数に commit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:commit')(makeEvent(1), 'feat: 新機能')
      expect(mockCommit).toHaveBeenCalledWith('/project', 'feat: 新機能')
    })

    it('commit が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockRejectedValue(new Error('commit failed'))
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'commit failed'
      )
    })
  })

  describe('git:getDiff', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:getDiff')(makeEvent(1), 'src/index.ts', false, false)
      ).rejects.toThrow('No folder open')
    })

    it('対象自体がシンボリックリンクの場合、リンク名を保ったまま相対パス化する(リンク先の実体名に化けさせない)', async () => {
      // git はシンボリックリンクをリンク自体として追跡する(git status は
      // "?? link.txt" を返す)。realpath は最終コンポーネントのリンクまで
      // 解決してしまうため、そのまま使うと相対パスがリンク先の実体名に化け、
      // .gitignore には無関係な実ファイル名が書かれ、diff タブにはリンク先の
      // 内容が表示される。親ディレクトリだけを解決し、最終要素は保つ必要がある
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/proj'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      // /tmp → /private/tmp のリンク解決に加え、link.txt → real.txt も解決される
      mockRealpath.mockImplementation((p: string) => {
        const resolved = p.replace(/^\/tmp\//, '/private/tmp/')
        return Promise.resolve(resolved.replace(/\/link\.txt$/, '/real.txt'))
      })
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/tmp/proj/link.txt', false, false)

      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/proj',
        'link.txt',
        false,
        false,
        undefined
      )
    })

    it('シンボリックリンク経由のパスは realpath 解決後の絶対パスを基準に相対パス化する', async () => {
      // allowedFolder は dialog:openFolder が realpath 済みの値を保持する一方、
      // renderer が持つ node.path は未解決のまま(readDirRecursive が生の
      // folderPath を join するため)。両者がずれると relative() が
      // "../../../tmp/..." のような外へ出るパスを返し、.gitignore には
      // 「何も無視しない壊れた行」が書かれる(macOS の /tmp 配下で実際に再現)。
      // 境界チェック自体は内部で realpath するため通ってしまい、エラーも出ない
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/qtest'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      // /tmp は /private/tmp へのシンボリックリンク(macOS)
      mockRealpath.mockImplementation((p: string) =>
        Promise.resolve(p.replace(/^\/tmp\//, '/private/tmp/'))
      )
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/tmp/qtest/notes.txt', false, false)

      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/qtest',
        'notes.txt',
        false,
        false,
        undefined
      )
    })

    it('staged: false の場合、renamedFrom を渡されても境界チェックしない(gitService 側で使われないため)', async () => {
      // gitService.getDiff は `staged && renamedFrom !== undefined` のときだけ
      // renamedFrom を実際に使う。renderer(useDiffOperations.ts)は staged の
      // 値に関わらず gitStatusFiles の from を常に渡すため、staged: false でも
      // renamedFrom の境界チェックを律儀に行うと、その旧パスの位置にたまたま
      // 許可フォルダ外を指す実体があった場合、gitService 側では使われもしない
      // 値のチェック失敗によって、本来成功するはずの未ステージ diff の取得
      // ごと失敗してしまう
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'new.txt', false, false, 'old.txt')

      // new.txt の境界チェックのみ行われ、old.txt(renamedFrom)は一切解決・
      // 検証されない
      expect(assertWithinFolder).toHaveBeenCalledTimes(1)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/new.txt')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', false, false, undefined)
    })

    it('staged: true の場合は renamedFrom も境界チェックして gitService へ渡す', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'new.txt', true, false, 'old.txt')

      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/new.txt')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/old.txt')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', true, false, 'old.txt')
    })

    it('staged: true の場合、filePath と renamedFrom の境界チェックを並行実行する(逐次待ちで無駄な往復を増やさない)', async () => {
      // filePath(new.txt)と renamedFrom(old.txt)の境界チェックは互いに依存しない
      // 独立した非同期処理のため、await で直列に待つと診断タブを開く/更新する
      // たびに不要な待ち時間が1回分増える。両方が「開始済み」の状態を経てから
      // 解決させることで、並行実行されていることを検証する
      const started: string[] = []
      let resolveNew: (() => void) | undefined
      let resolveOld: (() => void) | undefined
      const assertWithinFolder = vi.fn().mockImplementation((_allowed: string, path: string) => {
        started.push(path)
        return new Promise<void>((resolve) => {
          if (path.endsWith('new.txt')) resolveNew = resolve
          else resolveOld = resolve
        })
      })
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      const promise = getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        'new.txt',
        true,
        false,
        'old.txt'
      )
      // イベントループを1周させ、両方の境界チェックが「開始済み」になっているか確認する。
      // 逐次 await のままだと、この時点では new.txt の境界チェックしか開始していない
      await Promise.resolve()
      await Promise.resolve()
      expect(started).toEqual(expect.arrayContaining(['/project/new.txt', '/project/old.txt']))
      expect(started).toHaveLength(2)

      resolveNew!()
      resolveOld!()
      await promise
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', true, false, 'old.txt')
    })

    it('直近の親だけでなく祖先ディレクトリごと削除されている場合も、実在する祖先まで遡って realpath する', async () => {
      // 直近の親(dirname)だけ realpath を試みてダメなら未解決のまま
      // フォールバックする実装だと、sub/deep ごと削除された場合
      // (dirname である sub/deep 自体が存在しない)、フォールバックした
      // 未解決パスが allowedFolder(realpath 済み)と表記の基準が食い違い、
      // relative() が "../../../tmp/..." のような許可フォルダ外を指す壊れた
      // 相対パスを返す(/tmp → /private/tmp のような symlink 境界をまたぐ
      // 場合に実機で再現確認済み)。fileAccessGuard.assertFileWithinFolder と
      // 同様に、実在する祖先が見つかるまで遡る必要がある
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/proj'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException
      enoent.code = 'ENOENT'
      // sub/deep(削除済み)は ENOENT、その親の /tmp/proj は実在し
      // /private/tmp/proj へ解決できる
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/tmp/proj/sub/deep') return Promise.reject(enoent)
        if (p === '/tmp/proj') return Promise.resolve('/private/tmp/proj')
        return Promise.reject(enoent)
      })
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        '/tmp/proj/sub/deep/file.txt',
        false,
        false
      )

      // 実在する祖先(/private/tmp/proj)を基準に、削除された中間ディレクトリ名を
      // そのまま結合した相対パスになるべき("../../../tmp/proj/..." のような
      // 壊れたパスにならない)
      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/proj',
        'sub/deep/file.txt',
        false,
        false,
        undefined
      )
    })

    it('直近の親が ENOTDIR(ディレクトリだった箇所が同名ファイルに置き換わった)場合も、実在する祖先まで遡って realpath する', async () => {
      // git checkout 等でディレクトリだった箇所が同名ファイルに置き換わった場合、
      // realpath は ENOENT ではなく ENOTDIR を投げる。ENOENT だけを見ていると、
      // このケースが祖先遡りのフォールバックをすり抜けて即座に rethrow され、
      // 意図した「.gitignore が見つかりません」的な変換済みメッセージではなく
      // 未変換の ENOTDIR がそのままユーザーに見えてしまう
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/proj'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      const enotdir = new Error('ENOTDIR') as NodeJS.ErrnoException
      enotdir.code = 'ENOTDIR'
      // sub(ディレクトリだったが同名ファイルに置き換わった)配下への realpath は
      // ENOTDIR、その親の /tmp/proj は実在し /private/tmp/proj へ解決できる
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/tmp/proj/sub') return Promise.reject(enotdir)
        if (p === '/tmp/proj') return Promise.resolve('/private/tmp/proj')
        return Promise.reject(enotdir)
      })
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        '/tmp/proj/sub/file.txt',
        false,
        false
      )

      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/proj',
        'sub/file.txt',
        false,
        false,
        undefined
      )
    })

    it('realpath が ENOENT(削除済みファイル)でも、解決前のパスで相対パス化して続行する', async () => {
      // エクスプローラーのツリーが未更新のまま削除済みファイルに対して
      // 呼ばれる経路(assertFileWithinFolder の ENOENT フォールバック)を塞がない
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException
      enoent.code = 'ENOENT'
      mockRealpath.mockRejectedValue(enoent)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'deleted.txt', false, false)

      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'deleted.txt', false, false, undefined)
    })

    it('境界チェックは解決済みの絶対パスで行うが、getDiff には相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      const result = await getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        'src/index.ts',
        true,
        false
      )
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'src/index.ts', true, false, undefined)
      expect(result).toBe('DIFF_TEXT')
    })

    it('絶対パスの filePath が渡っても、getDiff には allowedFolder 基準の相対パスで呼ぶ', async () => {
      // isUntracked は renderer 側の gitStatusFiles(リポジトリルートからの相対パス)
      // 由来のため、filePath 自体も相対パスへ揃えないと main プロセス側(git apply 等)
      // との整合が取れなくなる
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/project/src/index.ts', false, true)
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'src/index.ts', false, true, undefined)
    })

    it('ネストした相対パスも allowedFolder 基準の相対パスのまま getDiff に渡る', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'sub/dir/file.ts', true, false)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/sub/dir/file.ts')
      expect(mockGetDiff).toHaveBeenCalledWith(
        '/project',
        'sub/dir/file.ts',
        true,
        false,
        undefined
      )
    })

    it('folderPath と絶対パスを toGitRelativePath に通してから getDiff に渡す（Windows のバックスラッシュ区切りを正規化するため）', async () => {
      // path.relative は Windows では \ 区切りの文字列を返すが、simple-git の相対パス
      // 表現は常に / 区切りのため、toGitRelativePath による正規化を経由することを
      // 統合的に検証する。正規化関数自体の変換ロジックは pathNormalize.test.ts で
      // 単体テストする(実行環境自体を Windows にできないため、ここでは
      // toGitRelativePath が実際に呼び出され、その戻り値が getDiff に渡ることのみ確認する)
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      mockToGitRelativePath.mockReturnValue('NORMALIZED_PATH')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'sub/dir/file.ts', false, false)

      expect(mockToGitRelativePath).toHaveBeenCalledWith('/project', '/project/sub/dir/file.ts')
      expect(mockGetDiff).toHaveBeenCalledWith(
        '/project',
        'NORMALIZED_PATH',
        false,
        false,
        undefined
      )
    })

    it('isUntracked をそのまま getDiff の第4引数として渡す', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'new.txt', false, true)
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', false, true, undefined)
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから getDiff を呼ぶ', async () => {
      // assertFileWithinFolder の多段階フォールバック自体は fileAccessGuard.test.ts で
      // 単体テスト済みだが、git:getDiff/stageHunk/unstageHunk がこの関数を正しく
      // 経由しているかは別途確認しないと、呼び出し側の配線ミスを検出できない
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'deleted.ts', false, false)
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'deleted.ts', false, false, undefined)
    })
  })

  describe('git:stageHunk', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      ).rejects.toThrow('No folder open')
    })

    it('境界チェック後、stageHunk をリポジトリ相対パスと patch 引数で呼ぶ', async () => {
      // 絶対パスのまま渡すと、失敗時のエラーメッセージ(gitApply.ts)に
      // OS絶対パス(ローカルファイルシステム構造)が露出してしまう。
      // getDiff と同じくリポジトリ相対パスへ変換してから渡す
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageHunk).toHaveBeenCalledWith('/project', 'src/index.ts', 'PATCH')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから stageHunk を呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stageHunk')(makeEvent(1), 'deleted.ts', 'PATCH')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockStageHunk).toHaveBeenCalledWith('/project', 'deleted.ts', 'PATCH')
    })
  })

  describe('git:unstageHunk', () => {
    it('境界チェック後、unstageHunk をリポジトリ相対パスと patch 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageHunk).toHaveBeenCalledWith('/project', 'src/index.ts', 'PATCH')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから unstageHunk を呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstageHunk')(makeEvent(1), 'deleted.ts', 'PATCH')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockUnstageHunk).toHaveBeenCalledWith('/project', 'deleted.ts', 'PATCH')
    })
  })

  describe('git:getLog', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と limit/skip を引数に getLog を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetLog.mockResolvedValue([])
      await getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)
      expect(mockGetLog).toHaveBeenCalledWith('/project', 20, 0)
    })
  })

  describe('git:getHeadCommitMessage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getHeadCommitMessage')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder を引数に getHeadCommitMessage を呼び、結果を返す', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetHeadCommitMessage.mockResolvedValue('feat: x')
      await expect(getRegisteredHandler('git:getHeadCommitMessage')(makeEvent(1))).resolves.toBe(
        'feat: x'
      )
      expect(mockGetHeadCommitMessage).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:getBranches', () => {
    it('folderAccess の allowedFolder を引数に getBranches を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetBranches.mockResolvedValue([])
      await getRegisteredHandler('git:getBranches')(makeEvent(1))
      expect(mockGetBranches).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:getTags', () => {
    it('folderAccess の allowedFolder を引数に getTags を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetTags.mockResolvedValue([])
      await getRegisteredHandler('git:getTags')(makeEvent(1))
      expect(mockGetTags).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:amendCommit', () => {
    it('folderAccess の allowedFolder と message を引数に amendCommit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockAmendCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:amendCommit')(makeEvent(1), 'feat: 修正後')
      expect(mockAmendCommit).toHaveBeenCalledWith('/project', 'feat: 修正後')
    })
  })

  describe('git:push', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:push')(makeEvent(1))).rejects.toThrow('No folder open')
    })

    it('folderAccess の allowedFolder を引数に push を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPush.mockResolvedValue(undefined)
      await getRegisteredHandler('git:push')(makeEvent(1))
      expect(mockPush).toHaveBeenCalledWith('/project')
    })

    it('push が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPush.mockRejectedValue(new Error('push failed'))
      await expect(getRegisteredHandler('git:push')(makeEvent(1))).rejects.toThrow('push failed')
    })
  })

  describe('git:pull', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:pull')(makeEvent(1))).rejects.toThrow('No folder open')
    })

    it('folderAccess の allowedFolder を引数に pull を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPull.mockResolvedValue({ conflicted: false })
      await getRegisteredHandler('git:pull')(makeEvent(1))
      expect(mockPull).toHaveBeenCalledWith('/project')
    })

    it('pull の結果をそのまま返す', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPull.mockResolvedValue({ conflicted: true })
      await expect(getRegisteredHandler('git:pull')(makeEvent(1))).resolves.toEqual({
        conflicted: true
      })
    })

    it('pull が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPull.mockRejectedValue(new Error('pull failed'))
      await expect(getRegisteredHandler('git:pull')(makeEvent(1))).rejects.toThrow('pull failed')
    })
  })

  describe('git:fetch', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:fetch')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder を引数に fetchRemote を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockFetchRemote.mockResolvedValue(undefined)
      await getRegisteredHandler('git:fetch')(makeEvent(1))
      expect(mockFetchRemote).toHaveBeenCalledWith('/project')
    })

    it('fetchRemote が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockFetchRemote.mockRejectedValue(new Error('fetch failed'))
      await expect(getRegisteredHandler('git:fetch')(makeEvent(1))).rejects.toThrow('fetch failed')
    })
  })

  describe('git:checkoutBranch', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:checkoutBranch')(makeEvent(1), 'feature/x')
      ).rejects.toThrow('No folder open')
    })

    it('folderAccess の allowedFolder と branchName を引数に checkoutBranch を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCheckoutBranch.mockResolvedValue(undefined)
      await getRegisteredHandler('git:checkoutBranch')(makeEvent(1), 'feature/x')
      expect(mockCheckoutBranch).toHaveBeenCalledWith('/project', 'feature/x')
    })

    it('checkoutBranch が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCheckoutBranch.mockRejectedValue(new Error('checkout failed'))
      await expect(
        getRegisteredHandler('git:checkoutBranch')(makeEvent(1), 'feature/x')
      ).rejects.toThrow('checkout failed')
    })
  })

  describe('git:createBranch', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:createBranch')(makeEvent(1), 'feature/new')
      ).rejects.toThrow('No folder open')
    })

    it('allowedFolder と branchName を引数に createBranch を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCreateBranch.mockResolvedValue(undefined)
      await getRegisteredHandler('git:createBranch')(makeEvent(1), 'feature/new')
      expect(mockCreateBranch).toHaveBeenCalledWith('/project', 'feature/new')
    })

    // IPC 境界は任意の値を受け付けるため、service の startsWith 等が TypeError で
    // 落ちる前に型を検証する
    it('branchName が文字列でなければ createBranch を呼ばずに拒否する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:createBranch')(makeEvent(1), 123)).rejects.toThrow(
        'Invalid branch name'
      )
      expect(mockCreateBranch).not.toHaveBeenCalled()
    })

    // 引数の渡し忘れ(undefined)やオブジェクト等も同様に弾く
    it.each([undefined, null, { name: 'x' }, ['x']])(
      'branchName が %s のとき createBranch を呼ばずに拒否する',
      async (branchName) => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(
          getRegisteredHandler('git:createBranch')(makeEvent(1), branchName)
        ).rejects.toThrow('Invalid branch name')
        expect(mockCreateBranch).not.toHaveBeenCalled()
      }
    )
  })

  describe('git:deleteBranch', () => {
    it('allowedFolder・branchName・force を引数に deleteBranch を呼び、結果を返す', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockDeleteBranch.mockResolvedValue({ deleted: false, reason: 'not-fully-merged' })
      await expect(
        getRegisteredHandler('git:deleteBranch')(makeEvent(1), 'feature/x', false)
      ).resolves.toEqual({ deleted: false, reason: 'not-fully-merged' })
      expect(mockDeleteBranch).toHaveBeenCalledWith('/project', 'feature/x', false)
    })

    // force は真偽値だけを受け付ける。'true' 等の truthy な値で意図せず強制削除
    // されるのを防ぐ
    it('force が boolean でなければ deleteBranch を呼ばずに拒否する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:deleteBranch')(makeEvent(1), 'feature/x', 'true')
      ).rejects.toThrow('Invalid force flag')
      expect(mockDeleteBranch).not.toHaveBeenCalled()
    })

    // 省略(undefined)や 0/1 のような truthy/falsy な値も強制削除の指定として扱わない
    it.each([undefined, 1, 0, null])(
      'force が %s のとき deleteBranch を呼ばずに拒否する',
      async (force) => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(
          getRegisteredHandler('git:deleteBranch')(makeEvent(1), 'feature/x', force)
        ).rejects.toThrow('Invalid force flag')
        expect(mockDeleteBranch).not.toHaveBeenCalled()
      }
    )

    // 型検証より先にフォルダの許可を確認する(フォルダ未設定なら型に関わらず同じエラー)
    it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:deleteBranch')(makeEvent(1), 123, 'true')
      ).rejects.toThrow('No folder open')
    })

    it('branchName が文字列でなければ deleteBranch を呼ばずに拒否する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:deleteBranch')(makeEvent(1), null, false)
      ).rejects.toThrow('Invalid branch name')
      expect(mockDeleteBranch).not.toHaveBeenCalled()
    })
  })

  describe('git:mergeBranch', () => {
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
      'allowedFolder と branchName を引数に mergeBranch を呼び、%s の結果をそのまま返す',
      async (_label, result) => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
        registerGitHandlers(mockIpcMain, folderAccess)
        mockMergeBranch.mockResolvedValue(result)
        await expect(
          getRegisteredHandler('git:mergeBranch')(makeEvent(1), 'feature/x')
        ).resolves.toBe(result)
        expect(mockMergeBranch).toHaveBeenCalledWith('/project', 'feature/x')
      }
    )

    it('branchName が文字列でなければ mergeBranch を呼ばずに拒否する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:mergeBranch')(makeEvent(1), null)).rejects.toThrow(
        'Invalid branch name'
      )
      expect(mockMergeBranch).not.toHaveBeenCalled()
    })

    // 型検証より先にフォルダの許可を確認する(フォルダ未設定なら型に関わらず同じエラー)
    it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:mergeBranch')(makeEvent(1), 123)).rejects.toThrow(
        'No folder open'
      )
    })
  })

  describe('git:getStashes', () => {
    it('allowedFolder を引数に getStashes を呼び、結果を返す', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetStashes.mockResolvedValue([{ sha: 'a'.repeat(40) }])
      await expect(getRegisteredHandler('git:getStashes')(makeEvent(1))).resolves.toEqual([
        { sha: 'a'.repeat(40) }
      ])
      expect(mockGetStashes).toHaveBeenCalledWith('/project')
    })
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getStashes')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })
  })

  describe('git:stashPush', () => {
    it('allowedFolder とメッセージを引数に stashPush を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStashPush.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stashPush')(makeEvent(1), 'msg')
      expect(mockStashPush).toHaveBeenCalledWith('/project', 'msg')
    })
    it.each([null, undefined, 123, {}])(
      'メッセージが文字列でない(%s)と stashPush を呼ばずに拒否する',
      async (bad) => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(getRegisteredHandler('git:stashPush')(makeEvent(1), bad)).rejects.toThrow(
          'Invalid stash message'
        )
        expect(mockStashPush).not.toHaveBeenCalled()
      }
    )
    // 型検証より先にフォルダの許可を確認する
    it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:stashPush')(makeEvent(1), 123)).rejects.toThrow(
        'No folder open'
      )
    })
  })

  describe('git:createTag', () => {
    const request = { name: 'v1.0.0', kind: 'annotated', message: 'リリース' }

    // 型検証より先にフォルダの許可を確認する
    it('folderAccess が未設定のとき、引数に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:createTag')(makeEvent(1), 123)).rejects.toThrow(
        'No folder open'
      )
      expect(mockCreateTag).not.toHaveBeenCalled()
    })

    it('allowedFolder と要求を引数に createTag を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCreateTag.mockResolvedValue(undefined)
      await getRegisteredHandler('git:createTag')(makeEvent(1), request)
      expect(mockCreateTag).toHaveBeenCalledWith('/project', request)
    })

    // 余分なキーは service に渡さない(name・kind・message の 3 つだけを詰め直す)
    it('余分なキーは無視して、name・kind・message だけを渡す', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCreateTag.mockResolvedValue(undefined)
      await getRegisteredHandler('git:createTag')(makeEvent(1), {
        ...request,
        force: true,
        sign: true
      })
      expect(mockCreateTag.mock.calls[0][1]).toStrictEqual(request)
    })

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['文字列', 'v1'],
      ['配列', ['v1']],
      ['name が無い', { kind: 'lightweight', message: '' }],
      ['name が文字列でない', { name: 1, kind: 'lightweight', message: '' }],
      ['kind が列挙外', { name: 'v1', kind: 'signed', message: '' }],
      ['kind が無い', { name: 'v1', message: '' }],
      ['message が文字列でない', { name: 'v1', kind: 'annotated', message: null }],
      ['message が無い', { name: 'v1', kind: 'lightweight' }]
    ])('要求が不正(%s)なら createTag を呼ばずに拒否する', async (_label, bad) => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:createTag')(makeEvent(1), bad)).rejects.toThrow(
        'Invalid tag request'
      )
      expect(mockCreateTag).not.toHaveBeenCalled()
    })

    it('createTag の失敗をそのまま伝える', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCreateTag.mockRejectedValue(new Error('同じ名前のタグが既に存在します: v1.0.0'))
      await expect(getRegisteredHandler('git:createTag')(makeEvent(1), request)).rejects.toThrow(
        '同じ名前のタグが既に存在します: v1.0.0'
      )
    })
  })

  // service は第 3 引数以降にテスト用の値(打ち切りの時間・windowsPaths)を取る。renderer から届いた余分な引数を
  // そこへ渡さない(許可フォルダと値の 2 つだけで呼ぶ)
  describe.each([
    ['git:init', () => mockInitRepository, 'main', 'Invalid branch name'],
    ['git:addOrigin', () => mockAddOrigin, 'https://github.com/a/b.git', 'Invalid remote url']
  ] as const)('%s', (channel, getMock, value, invalidMessage) => {
    // 型検証より先にフォルダの許可を確認する
    it('folderAccess が未設定のとき、引数に関わらず "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler(channel)(makeEvent(1), 123)).rejects.toThrow(
        'No folder open'
      )
      expect(getMock()).not.toHaveBeenCalled()
    })

    it('allowedFolder と値だけで service を呼ぶ(余分な引数は渡さない)', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      getMock().mockResolvedValue(undefined)
      await getRegisteredHandler(channel)(makeEvent(1), value, 1, true)
      expect(getMock().mock.calls[0]).toStrictEqual(['/project', value])
    })

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['数値', 1],
      ['配列', [value]],
      ['オブジェクト', { value }]
    ])('値が文字列でない(%s)なら service を呼ばずに拒否する', async (_label, bad) => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler(channel)(makeEvent(1), bad)).rejects.toThrow(invalidMessage)
      expect(getMock()).not.toHaveBeenCalled()
    })

    it('service の失敗をそのまま伝える', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      getMock().mockRejectedValue(new Error('リモート origin は既に設定されています'))
      await expect(getRegisteredHandler(channel)(makeEvent(1), value)).rejects.toThrow(
        'リモート origin は既に設定されています'
      )
    })
  })

  describe('git:pushSetUpstream', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:pushSetUpstream')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
      expect(mockPushSetUpstream).not.toHaveBeenCalled()
    })

    // 第 2 引数(打ち切りの時間)に renderer の値が渡ると、打ち切りを無効にできてしまう
    it('allowedFolder だけで pushSetUpstream を呼ぶ(余分な引数は渡さない)', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPushSetUpstream.mockResolvedValue(undefined)
      await getRegisteredHandler('git:pushSetUpstream')(makeEvent(1), 999_999)
      expect(mockPushSetUpstream.mock.calls[0]).toStrictEqual(['/project'])
    })

    it('pushSetUpstream の失敗をそのまま伝える', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPushSetUpstream.mockRejectedValue(
        new Error('コミットが無いため、初回 push できません。先にコミットしてください')
      )
      await expect(getRegisteredHandler('git:pushSetUpstream')(makeEvent(1))).rejects.toThrow(
        'コミットが無いため、初回 push できません。先にコミットしてください'
      )
    })
  })

  describe('git:stashPop の戻り値', () => {
    it('service の結果をそのまま返す(dropFailed / rollbackFailed の警告も落とさない)', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      const result = { status: 'dropFailed', message: 'm' }
      mockStashPop.mockResolvedValue(result)
      await expect(
        getRegisteredHandler('git:stashPop')(makeEvent(1), 'a'.repeat(40))
      ).resolves.toBe(result)
    })
  })

  describe.each([
    ['git:stashPop', () => mockStashPop],
    ['git:stashDrop', () => mockStashDrop]
  ] as const)('%s', (channel, getMock) => {
    it('allowedFolder と SHA を引数に service を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      getMock().mockResolvedValue(undefined)
      await getRegisteredHandler(channel)(makeEvent(1), 'a'.repeat(40))
      expect(getMock()).toHaveBeenCalledWith('/project', 'a'.repeat(40))
    })
    it.each([null, undefined, 123, {}])(
      'SHA が文字列でない(%s)と service を呼ばずに拒否する',
      async (bad) => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(getRegisteredHandler(channel)(makeEvent(1), bad)).rejects.toThrow(
          'Invalid stash id'
        )
        expect(getMock()).not.toHaveBeenCalled()
      }
    )
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler(channel)(makeEvent(1), 123)).rejects.toThrow(
        'No folder open'
      )
    })
  })

  describe('コンフリクトの解決', () => {
    const DIGEST = 'a'.repeat(40)

    function allowedAccess(): FolderAccessManager {
      return makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
    }

    const pathChannels = [
      ['git:getConflictFile', 'getConflictFile', []],
      ['git:resolveConflictBlocks', 'resolveConflictBlocks', [[DIGEST], { 0: 'ours' }]],
      ['git:resolveConflictWholeFile', 'resolveConflictWholeFile', ['ours']],
      ['git:keepConflictFile', 'keepConflictFile', []],
      ['git:removeConflictFile', 'removeConflictFile', []],
      ['git:markConflictResolved', 'markConflictResolved', []]
    ] as const

    describe.each(pathChannels)('%s', (channel, fn, extra) => {
      it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(
          getRegisteredHandler(channel)(makeEvent(1), 'a.txt', ...extra.map(() => 123))
        ).rejects.toThrow('No folder open')
        expect(mockConflict[fn]).not.toHaveBeenCalled()
      })

      it('フォルダ外のパスは service を呼ばずに Access denied を伝播する', async () => {
        const folderAccess = makeFolderAccess({
          get: vi.fn().mockReturnValue('/project'),
          assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied'))
        })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(
          getRegisteredHandler(channel)(makeEvent(1), '/outside/a.txt', ...extra)
        ).rejects.toThrow('Access denied')
        expect(mockConflict[fn]).not.toHaveBeenCalled()
      })

      it('境界チェック後、絶対パスをリポジトリ相対パスにして引数とともに service を呼ぶ', async () => {
        registerGitHandlers(mockIpcMain, allowedAccess())
        mockConflict[fn].mockResolvedValue(undefined)
        await getRegisteredHandler(channel)(makeEvent(1), '/project/src/a.txt', ...extra)
        expect(mockConflict[fn]).toHaveBeenCalledWith('/project', 'src/a.txt', ...extra)
      })
    })

    it('git:getConflictFile は service の結果をそのまま返す', async () => {
      registerGitHandlers(mockIpcMain, allowedAccess())
      const file = { status: 'unparsable' }
      mockConflict.getConflictFile.mockResolvedValue(file)
      await expect(
        getRegisteredHandler('git:getConflictFile')(makeEvent(1), 'a.txt')
      ).resolves.toBe(file)
    })

    describe('git:resolveConflictBlocks の型検証', () => {
      it.each([
        ['配列でない', 'x'],
        ['null', null],
        ['要素が文字列でない', [1]],
        ['長さ 40 でない', ['abc']],
        ['16 進でない', ['g'.repeat(40)]],
        ['1001 件', Array.from({ length: 1001 }, () => DIGEST)]
      ])('expectedDigests が不正(%s)だと Invalid digests で拒否する', async (_n, bad) => {
        registerGitHandlers(mockIpcMain, allowedAccess())
        await expect(
          getRegisteredHandler('git:resolveConflictBlocks')(makeEvent(1), 'a.txt', bad, {})
        ).rejects.toThrow('Invalid digests')
        expect(mockConflict.resolveConflictBlocks).not.toHaveBeenCalled()
      })

      it('digests の検証は choices より先、パス解決より先に行う', async () => {
        const folderAccess = makeFolderAccess({
          get: vi.fn().mockReturnValue('/project'),
          assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied'))
        })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(
          getRegisteredHandler('git:resolveConflictBlocks')(makeEvent(1), '/x', 'bad', 'bad')
        ).rejects.toThrow('Invalid digests')
      })

      const tooMany = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i, 'ours']))
      it.each([
        ['null', null],
        ['配列', ['ours']],
        ['文字列', 'ours'],
        ['列挙外の値', { 0: 'mine' }],
        ['値が文字列でない', { 0: 1 }],
        ['整数でないキー', { a: 'ours' }],
        ['小数のキー', { '1.5': 'ours' }],
        ['負数のキー', { '-1': 'ours' }],
        ['先頭ゼロのキー', { '01': 'ours' }],
        ['巨大な数のキー', { '9007199254740993': 'ours' }],
        ['constructor', { constructor: 'ours' }],
        ['prototype', { prototype: 'ours' }],
        ['__proto__(own)', JSON.parse('{"__proto__":"ours"}')],
        ['1001 件', tooMany]
      ])('choices が不正(%s)だと Invalid choices で拒否する', async (_n, bad) => {
        registerGitHandlers(mockIpcMain, allowedAccess())
        await expect(
          getRegisteredHandler('git:resolveConflictBlocks')(makeEvent(1), 'a.txt', [DIGEST], bad)
        ).rejects.toThrow('Invalid choices')
        expect(mockConflict.resolveConflictBlocks).not.toHaveBeenCalled()
      })

      it('空の choices と 1000 件ちょうどの digests は受け付ける', async () => {
        registerGitHandlers(mockIpcMain, allowedAccess())
        mockConflict.resolveConflictBlocks.mockResolvedValue(undefined)
        const digests = Array.from({ length: 1000 }, () => DIGEST)
        await getRegisteredHandler('git:resolveConflictBlocks')(makeEvent(1), 'a.txt', digests, {})
        expect(mockConflict.resolveConflictBlocks).toHaveBeenCalledWith(
          '/project',
          'a.txt',
          digests,
          {}
        )
      })
    })

    describe('git:resolveConflictWholeFile の型検証', () => {
      it.each([['both'], [null], [undefined], [1], ['OURS']])(
        'side が不正(%s)だと Invalid side で拒否する',
        async (bad) => {
          registerGitHandlers(mockIpcMain, allowedAccess())
          await expect(
            getRegisteredHandler('git:resolveConflictWholeFile')(makeEvent(1), 'a.txt', bad)
          ).rejects.toThrow('Invalid side')
          expect(mockConflict.resolveConflictWholeFile).not.toHaveBeenCalled()
        }
      )
    })

    describe.each([
      ['git:completeMerge', 'completeMerge'],
      ['git:abortMerge', 'abortMerge']
    ] as const)('%s', (channel, fn) => {
      it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
        const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
        registerGitHandlers(mockIpcMain, folderAccess)
        await expect(getRegisteredHandler(channel)(makeEvent(1))).rejects.toThrow('No folder open')
        expect(mockConflict[fn]).not.toHaveBeenCalled()
      })

      it('許可フォルダだけを渡して service を呼ぶ', async () => {
        registerGitHandlers(mockIpcMain, allowedAccess())
        mockConflict[fn].mockResolvedValue(undefined)
        await getRegisteredHandler(channel)(makeEvent(1))
        expect(mockConflict[fn]).toHaveBeenCalledWith('/project')
      })
    })
  })
})
