import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockStatus = vi.hoisted(() => vi.fn())
const mockAdd = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockDiff = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({
    checkIsRepo: mockCheckIsRepo,
    status: mockStatus,
    add: mockAdd,
    reset: mockReset,
    commit: mockCommit,
    diff: mockDiff,
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

import { getGitStatus, stageFile, unstageFile, commit, getDiff, stageHunk, unstageHunk } from '../gitService'

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
