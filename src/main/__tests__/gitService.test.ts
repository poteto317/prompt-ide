import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockStatus = vi.hoisted(() => vi.fn())
const mockAdd = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockDiff = vi.hoisted(() => vi.fn())
const mockRaw = vi.hoisted(() => vi.fn())
const mockBranchLocal = vi.hoisted(() => vi.fn())
const mockTags = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({
    checkIsRepo: mockCheckIsRepo,
    status: mockStatus,
    add: mockAdd,
    reset: mockReset,
    commit: mockCommit,
    diff: mockDiff,
    raw: mockRaw,
    branchLocal: mockBranchLocal,
    tags: mockTags,
  }))
)

const mockReadFile = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('simple-git', () => ({ default: mockSimpleGit }))
vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile,
}))
vi.mock('node:child_process', () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}))

import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  stageHunk,
  unstageHunk,
  getLog,
  getBranches,
  getTags,
  amendCommit,
} from '../gitService'

beforeEach(() => {
  vi.clearAllMocks()
})

const baseStatusResult = {
  current: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  not_added: [],
  conflicted: [],
  created: [],
  deleted: [],
  modified: [],
  renamed: [],
  staged: [],
  isClean: () => true,
  detached: false,
  tracking: null,
}

describe('getGitStatus', () => {
  it('simpleGit を folderPath を引数に呼ぶ', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    await getGitStatus('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
  })

  it('Git リポジトリでない場合 isRepo: false を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    const result = await getGitStatus('/project')
    expect(result).toEqual({ isRepo: false, branch: null, ahead: 0, behind: 0, files: [] })
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('正常系: isRepo: true でブランチ名・ahead/behind が含まれる', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({ ...baseStatusResult, current: 'feature/foo', ahead: 2, behind: 1, files: [] })
    const result = await getGitStatus('/project')
    expect(result.isRepo).toBe(true)
    expect(result.branch).toBe('feature/foo')
    expect(result.ahead).toBe(2)
    expect(result.behind).toBe(1)
  })

  it('files が正しく変換される（working_dir → workingDir）', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({
      ...baseStatusResult,
      files: [
        { path: 'src/index.ts', index: 'M', working_dir: ' ' },
        { path: 'README.md', index: '?', working_dir: '?' },
      ],
    })
    const result = await getGitStatus('/project')
    expect(result.files).toEqual([
      { path: 'src/index.ts', index: 'M', workingDir: ' ' },
      { path: 'README.md', index: '?', workingDir: '?' },
    ])
  })

  it('branch が null のとき null をそのまま返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({ ...baseStatusResult, current: null })
    const result = await getGitStatus('/project')
    expect(result.branch).toBeNull()
  })

  it('status() が throw した場合エラーが伝播する', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockRejectedValue(new Error('git error'))
    await expect(getGitStatus('/project')).rejects.toThrow('git error')
  })
})

describe('stageFile', () => {
  it('simpleGit を folderPath で呼び、add を filePath で呼ぶ', async () => {
    mockAdd.mockResolvedValue(undefined)
    await stageFile('/project', 'src/index.ts')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockAdd).toHaveBeenCalledWith('src/index.ts')
  })

  it('add が throw した場合エラーが伝播する', async () => {
    mockAdd.mockRejectedValue(new Error('add failed'))
    await expect(stageFile('/project', 'src/index.ts')).rejects.toThrow('add failed')
  })
})

describe('unstageFile', () => {
  it('simpleGit を folderPath で呼び、reset を ["--", filePath] で呼ぶ', async () => {
    mockReset.mockResolvedValue(undefined)
    await unstageFile('/project', 'src/index.ts')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockReset).toHaveBeenCalledWith(['--', 'src/index.ts'])
  })

  it('reset が throw した場合エラーが伝播する', async () => {
    mockReset.mockRejectedValue(new Error('reset failed'))
    await expect(unstageFile('/project', 'src/index.ts')).rejects.toThrow('reset failed')
  })
})

describe('commit', () => {
  it('simpleGit を folderPath で呼び、commit を message で呼ぶ', async () => {
    mockCommit.mockResolvedValue(undefined)
    await commit('/project', 'feat: 新機能を追加する')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCommit).toHaveBeenCalledWith('feat: 新機能を追加する')
  })

  it('commit が throw した場合エラーが伝播する', async () => {
    mockCommit.mockRejectedValue(new Error('commit failed'))
    await expect(commit('/project', 'msg')).rejects.toThrow('commit failed')
  })
})

describe('getDiff', () => {
  it('未ステージの変更を simpleGit を folderPath で呼び、diff を [\'-U3\', \'--\', filePath] で呼ぶ', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'src/index.ts', index: 'M', working_dir: 'M' }] })
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', false)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockDiff).toHaveBeenCalledWith(['-U3', '--', 'src/index.ts'])
    expect(result).toBe('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
  })

  it('ステージ済みの変更を diff を [\'--cached\', \'-U3\', \'--\', filePath] で呼ぶ', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'src/index.ts', index: 'M', working_dir: ' ' }] })
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', true)
    expect(mockDiff).toHaveBeenCalledWith(['--cached', '-U3', '--', 'src/index.ts'])
    expect(result).toBe('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
  })

  it('未追跡ファイル(index === "?")の場合、diff を呼ばずファイル内容から疑似diffを組み立てる', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'new.txt', index: '?', working_dir: '?' }] })
    mockReadFile.mockResolvedValue('line1\nline2\n')
    const result = await getDiff('/project', 'new.txt', false)
    expect(mockDiff).not.toHaveBeenCalled()
    expect(mockReadFile).toHaveBeenCalledWith('/project/new.txt', 'utf-8')
    expect(result).toContain('--- /dev/null')
    expect(result).toContain('+++ b/new.txt')
    expect(result).toContain('+line1')
    expect(result).toContain('+line2')
  })

  it('diff が throw した場合エラーが伝播する', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'src/index.ts', index: 'M', working_dir: 'M' }] })
    mockDiff.mockRejectedValue(new Error('diff failed'))
    await expect(getDiff('/project', 'src/index.ts', false)).rejects.toThrow('diff failed')
  })
})

import { EventEmitter } from 'node:events'

function createMockProcess(): {
  proc: EventEmitter & { stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }; stderr: EventEmitter }
  emitClose: (code: number) => void
  emitStderr: (data: string) => void
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    stderr: EventEmitter
  }
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  proc.stderr = new EventEmitter()
  return {
    proc,
    emitClose: (code: number) => proc.emit('close', code),
    emitStderr: (data: string) => proc.stderr.emit('data', Buffer.from(data)),
  }
}

describe('stageHunk', () => {
  it('git apply --cached を実行し、patch を stdin に書き込む', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitClose(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('git', ['apply', '--cached', '--whitespace=nowarn', '-'], {
      cwd: '/project',
    })
    expect(proc.stdin.write).toHaveBeenCalledWith('PATCH_TEXT')
    expect(proc.stdin.end).toHaveBeenCalled()
  })

  it('プロセスが非ゼロ終了コードの場合、stderr を含むエラーで reject する', async () => {
    const { proc, emitClose, emitStderr } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitStderr('patch does not apply')
    emitClose(1)
    await expect(promise).rejects.toThrow(/patch does not apply/)
  })
})

describe('unstageHunk', () => {
  it('git apply --cached --reverse を実行する', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = unstageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitClose(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
      { cwd: '/project' }
    )
  })
})

describe('getLog', () => {
  it('git log を --max-count/--skip/--pretty オプションで呼び、レコードをパースして返す', async () => {
    const record =
      'abc123\x1ffeat: 新機能\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e' +
      'def456\x1ffix: バグ修正\x1f2026-09-02T10:00:00+09:00\x1fBob\x1e'
    mockRaw.mockResolvedValue(record)
    const result = await getLog('/project', 20, 0)
    expect(mockRaw).toHaveBeenCalledWith([
      'log',
      '--max-count=20',
      '--skip=0',
      '--pretty=format:%H%x1f%s%x1f%aI%x1f%an%x1e',
    ])
    expect(result).toEqual([
      { hash: 'abc123', message: 'feat: 新機能', date: '2026-09-03T10:00:00+09:00', authorName: 'Alice' },
      { hash: 'def456', message: 'fix: バグ修正', date: '2026-09-02T10:00:00+09:00', authorName: 'Bob' },
    ])
  })

  it('コミットが無いリポジトリで raw が throw した場合、空配列を返す', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: your current branch does not have any commits yet'))
    const result = await getLog('/project', 20, 0)
    expect(result).toEqual([])
  })
})

describe('getBranches', () => {
  it('branchLocal の結果を GitBranch[] に変換する', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    const result = await getBranches('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(result).toEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
    ])
  })
})

describe('getTags', () => {
  it('tags の結果を string[] で返す', async () => {
    mockTags.mockResolvedValue({ all: ['v1.0.0', 'v1.1.0'] })
    const result = await getTags('/project')
    expect(result).toEqual(['v1.0.0', 'v1.1.0'])
  })
})

describe('amendCommit', () => {
  it('simpleGit を folderPath で呼び、commit を [\'--amend\'] オプション付きで呼ぶ', async () => {
    mockCommit.mockResolvedValue(undefined)
    await amendCommit('/project', 'feat: 修正後のメッセージ')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCommit).toHaveBeenCalledWith('feat: 修正後のメッセージ', ['--amend'])
  })

  it('commit が throw した場合エラーが伝播する', async () => {
    mockCommit.mockRejectedValue(new Error('amend failed'))
    await expect(amendCommit('/project', 'msg')).rejects.toThrow('amend failed')
  })
})
