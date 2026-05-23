import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReaddir = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  default: { readdir: mockReaddir, readFile: mockReadFile },
  readdir: mockReaddir,
  readFile: mockReadFile,
}))

import { SKIP_DIRS } from '../traversalPolicy'
import { readDirRecursive, readFileContent } from '../fileSystem'

type MockDirent = {
  name: string
  isDirectory: () => boolean
}

function makeDirent(name: string, isDir: boolean): MockDirent {
  return { name, isDirectory: () => isDir }
}

beforeEach(() => {
  mockReaddir.mockReset()
  mockReadFile.mockReset()
})

describe('readDirRecursive', () => {
  it('ディレクトリがファイルより先にソートされる', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('index.ts', false),
      makeDirent('src', true),
      makeDirent('README.md', false),
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
      makeDirent('m.ts', false),
    ])

    const result = await readDirRecursive('/project')

    expect(result.map((n) => n.name)).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })

  it.each([...SKIP_DIRS])('SKIP_DIRS: %s ディレクトリはスキップされる', async (skipDir) => {
    mockReaddir.mockResolvedValue([
      makeDirent(skipDir, true),
      makeDirent('src', true),
      makeDirent('index.ts', false),
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
