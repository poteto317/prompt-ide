import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReaddir = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())
const mockRename = vi.hoisted(() => vi.fn())
const mockRm = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())
const mockLstat = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: mockReaddir,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    rename: mockRename,
    rm: mockRm,
    stat: mockStat,
    lstat: mockLstat
  },
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  rename: mockRename,
  rm: mockRm,
  stat: mockStat,
  lstat: mockLstat
}))

import { SKIP_DIRS } from '../traversalPolicy'
import {
  readDirRecursive,
  readFileContent,
  readFileBuffer,
  writeFileContent,
  isExecutableFile,
  isSymbolicLink,
  getFileSize,
  createFile,
  createDirectory,
  renameEntry,
  deleteEntry
} from '../fileSystem'

type MockDirent = {
  name: string
  isDirectory: () => boolean
}

function makeDirent(name: string, isDir: boolean): MockDirent {
  return { name, isDirectory: () => isDir }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('readDirRecursive', () => {
  it('ディレクトリがファイルより先にソートされる', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('index.ts', false),
      makeDirent('src', true),
      makeDirent('README.md', false)
    ])

    const result = await readDirRecursive('/project')

    expect(result[0].type).toBe('directory')
    expect(result[0].name).toBe('src')
    expect(result[1].name).toBe('index.ts')
    expect(result[2].name).toBe('README.md')
  })

  it('同種のエントリはアルファベット順にソートされる', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('z.ts', false),
      makeDirent('a.ts', false),
      makeDirent('m.ts', false)
    ])

    const result = await readDirRecursive('/project')

    expect(result.map((n) => n.name)).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })

  it.each([...SKIP_DIRS])('SKIP_DIRS: %s ディレクトリはスキップされる', async (skipDir) => {
    mockReaddir.mockResolvedValue([
      makeDirent(skipDir, true),
      makeDirent('src', true),
      makeDirent('index.ts', false)
    ])

    const result = await readDirRecursive('/project')

    expect(result.find((n) => n.name === skipDir)).toBeUndefined()
    expect(result.find((n) => n.name === 'src')).toBeDefined()
  })

  it('depth > 5 のとき空配列を返す（深さ制限）', async () => {
    const result = await readDirRecursive('/project', 6)
    expect(result).toEqual([])
    expect(mockReaddir).not.toHaveBeenCalled()
  })

  it('depth = 5 のとき読み取りが実行される（境界値）', async () => {
    mockReaddir.mockResolvedValue([makeDirent('file.ts', false)])
    const result = await readDirRecursive('/project', 5)
    expect(result).toHaveLength(1)
  })

  it('ディレクトリには再帰的に children がセットされる', async () => {
    mockReaddir
      .mockResolvedValueOnce([makeDirent('src', true)])
      .mockResolvedValueOnce([makeDirent('index.ts', false)])

    const result = await readDirRecursive('/project')

    expect(result[0].type).toBe('directory')
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children?.[0].name).toBe('index.ts')
    expect(result[0].children?.[0].type).toBe('file')
  })

  it('ファイルの path が dirPath と name を結合した値になる', async () => {
    mockReaddir.mockResolvedValue([makeDirent('index.ts', false)])
    const result = await readDirRecursive('/project')
    expect(result[0].path).toContain('index.ts')
    expect(result[0].path).toContain('project')
  })
})

describe('readFileContent', () => {
  it('ファイル内容を文字列で返す', async () => {
    mockReadFile.mockResolvedValue('const x = 1')
    const result = await readFileContent('/project/src/index.ts')
    expect(result).toBe('const x = 1')
  })

  it('readFile を utf-8 エンコーディングで呼び出す', async () => {
    mockReadFile.mockResolvedValue('')
    await readFileContent('/project/src/index.ts')
    expect(mockReadFile).toHaveBeenCalledWith('/project/src/index.ts', 'utf-8')
  })
})

describe('readFileBuffer', () => {
  it('エンコーディング指定なしで readFile を呼び、生のバッファを返す', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockReadFile.mockResolvedValue(buf)
    const result = await readFileBuffer('/project/image.png')
    expect(mockReadFile).toHaveBeenCalledWith('/project/image.png')
    expect(result).toBe(buf)
  })
})

describe('writeFileContent', () => {
  it('writeFile を utf-8 エンコーディングで呼び出す', async () => {
    mockWriteFile.mockResolvedValue(undefined)
    await writeFileContent('/project/src/index.ts', 'const x = 1')
    expect(mockWriteFile).toHaveBeenCalledWith('/project/src/index.ts', 'const x = 1', 'utf-8')
  })
})

describe('isExecutableFile', () => {
  it('実行可能ビットが立っているファイルは true を返す', async () => {
    mockStat.mockResolvedValue({ mode: 0o100755 })
    expect(await isExecutableFile('/project/run.sh')).toBe(true)
  })

  it('実行可能ビットが立っていないファイルは false を返す', async () => {
    mockStat.mockResolvedValue({ mode: 0o100644 })
    expect(await isExecutableFile('/project/new.txt')).toBe(false)
  })

  it('所有者の実行ビットが立っていない場合、グループ/その他の実行ビットが立っていても false を返す(git 自身の判定基準に合わせる)', async () => {
    // git の ce_mode_from_stat は所有者の実行ビット(S_IXUSR, 0o100)のみを見て
    // 実行可能ファイルかどうかを判定し、グループ/その他の実行ビットは無視する。
    // owner/group/other のいずれかで判定すると、共有ディレクトリで
    // グループ実行ビットだけが立っているようなファイルを実際の git add とは
    // 異なる mode(100755)で index に記録してしまう
    mockStat.mockResolvedValue({ mode: 0o100610 })
    expect(await isExecutableFile('/project/group-exec.sh')).toBe(false)
  })

  it('Windows(win32)では mode の実行ビットに意味が無いため、常に false を返す', async () => {
    // Node/libuv は Windows(NTFS)上で POSIX 相当の実行ビットを報告できず、
    // 多くの環境で全ファイルの mode に実行ビットが立って見える。これをそのまま
    // 使うと、Windows で新規作成した通常のテキストファイルまで疑似diffの
    // file mode が 100755 になり、stage 時に誤った実行ビットが index に記録される
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockStat.mockResolvedValue({ mode: 0o100755 })
      expect(await isExecutableFile('/project/run.sh')).toBe(false)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })
})

describe('isSymbolicLink', () => {
  it('シンボリックリンクなら true を返す', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => true })
    expect(await isSymbolicLink('/project/link.txt')).toBe(true)
  })

  it('通常ファイルなら false を返す', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false })
    expect(await isSymbolicLink('/project/real.txt')).toBe(false)
  })
})

describe('getFileSize', () => {
  it('stat の size を返す', async () => {
    mockStat.mockResolvedValue({ size: 1234 })
    expect(await getFileSize('/project/big.log')).toBe(1234)
  })
})

describe('createFile', () => {
  it('flag wx で空ファイルを作成する(既存を上書きしない)', async () => {
    mockWriteFile.mockResolvedValue(undefined)
    await createFile('/project/new.ts')
    expect(mockWriteFile).toHaveBeenCalledWith('/project/new.ts', '', { flag: 'wx' })
  })

  it('既存ファイルがあるとき EEXIST が伝播する', async () => {
    const err = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    mockWriteFile.mockRejectedValue(err)
    await expect(createFile('/project/new.ts')).rejects.toThrow('EEXIST')
  })
})

describe('createDirectory', () => {
  it('recursive なしで mkdir を呼ぶ', async () => {
    mockMkdir.mockResolvedValue(undefined)
    await createDirectory('/project/newdir')
    expect(mockMkdir).toHaveBeenCalledWith('/project/newdir')
  })
})

describe('renameEntry', () => {
  it('リネーム先が存在しないとき rename を呼ぶ', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mockRename.mockResolvedValue(undefined)
    await renameEntry('/project/old.ts', '/project/new.ts')
    expect(mockRename).toHaveBeenCalledWith('/project/old.ts', '/project/new.ts')
  })

  it('リネーム先が既に存在するとき EEXIST エラーを投げ rename を呼ばない(暗黙上書き防止)', async () => {
    // 別エンティティ(inoが異なる)が存在するケース
    mockStat.mockImplementation((path: string) =>
      Promise.resolve(path === '/project/existing.ts' ? { dev: 1, ino: 100 } : { dev: 1, ino: 200 })
    )
    await expect(renameEntry('/project/old.ts', '/project/existing.ts')).rejects.toMatchObject({
      code: 'EEXIST'
    })
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('大文字小文字のみ変更するリネームは EEXIST とせず rename を呼ぶ(大文字小文字非区別FS対応)', async () => {
    // 大文字小文字を区別しないFSでは newPath の stat が oldPath 自身(同一 dev+ino)にヒットする
    mockStat.mockResolvedValue({ dev: 1, ino: 100 })
    mockRename.mockResolvedValue(undefined)
    await renameEntry('/project/readme.md', '/project/README.md')
    expect(mockRename).toHaveBeenCalledWith('/project/readme.md', '/project/README.md')
  })

  it('リネーム元が存在しないとき rename の ENOENT が伝播する', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mockRename.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await expect(renameEntry('/project/missing.ts', '/project/new.ts')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('存在チェックが EACCES 等 ENOENT 以外で失敗したとき、存在しないと誤判定せず伝播し rename を呼ばない', async () => {
    // newPath の存在有無を確認できないため、暗黙上書き防止のガードが機能しない状態で
    // rename() に進むのは危険 — ENOENT 以外は握り潰さず伝播すべき
    mockStat.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    await expect(renameEntry('/project/old.ts', '/project/new.ts')).rejects.toMatchObject({
      code: 'EACCES'
    })
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('newPath は存在するが oldPath の存在確認が ENOENT 以外で失敗したときも伝播し rename を呼ばない', async () => {
    // newPath の stat は成功(既存の別エンティティ)、その後の oldPath の stat が権限エラーになるケース
    mockStat.mockImplementation((path: string) => {
      if (path === '/project/new.ts') {
        return Promise.resolve({ dev: 1, ino: 999 })
      }
      return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    })
    await expect(renameEntry('/project/old.ts', '/project/new.ts')).rejects.toMatchObject({
      code: 'EACCES'
    })
    expect(mockRename).not.toHaveBeenCalled()
  })
})

describe('deleteEntry', () => {
  it('rm を recursive オプション付きで呼ぶ(ディレクトリも削除可能)', async () => {
    mockRm.mockResolvedValue(undefined)
    await deleteEntry('/project/dir')
    expect(mockRm).toHaveBeenCalledWith('/project/dir', { recursive: true })
  })

  it('対象が存在しないとき ENOENT が伝播する', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockRm.mockRejectedValue(err)
    await expect(deleteEntry('/project/gone')).rejects.toThrow('ENOENT')
  })
})
