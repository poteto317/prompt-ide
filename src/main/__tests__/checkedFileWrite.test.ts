import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'node:path'

const mockRealpath = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({ default: { realpath: mockRealpath }, realpath: mockRealpath }))

import { FolderAccessManager } from '../folderAccessManager'
import { checkDiskUnchanged, writeFileChecked } from '../checkedFileWrite'
import type { CheckedFileWriteIo } from '../checkedFileWrite'

const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
const eexist = (): NodeJS.ErrnoException => Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
const eacces = (): NodeJS.ErrnoException => Object.assign(new Error('EACCES'), { code: 'EACCES' })
// U+FEFF(BOM)。ソースに実物の文字を書かない(エディタで見えないため)
const BOM = String.fromCharCode(0xfeff)
const fsError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

let folderAccess: FolderAccessManager
let io: {
  readFile: ReturnType<typeof vi.fn<CheckedFileWriteIo['readFile']>>
  writeFile: ReturnType<typeof vi.fn<CheckedFileWriteIo['writeFile']>>
  createFile: ReturnType<typeof vi.fn<CheckedFileWriteIo['createFile']>>
}

beforeEach(() => {
  vi.resetAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  folderAccess = new FolderAccessManager()
  io = {
    readFile: vi.fn<CheckedFileWriteIo['readFile']>(),
    writeFile: vi.fn<CheckedFileWriteIo['writeFile']>().mockResolvedValue(undefined),
    createFile: vi.fn<CheckedFileWriteIo['createFile']>().mockResolvedValue(undefined)
  }
})

// /work/a.ts を realpath で解決できない(削除された・ぶら下がったリンク)状態にする
const makeUnresolvable = (): void => {
  mockRealpath.mockImplementation((p: string) =>
    p === '/work/a.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
  )
}

const write = (
  baseContent: string | null,
  filePath = '/work/a.ts'
): ReturnType<typeof writeFileChecked> =>
  writeFileChecked(
    { folderAccess, allowedFolder: '/work', filePath, content: 'new', baseContent },
    io
  )

describe('writeFileChecked(解決できるパス)', () => {
  it('ディスクが基準と同じなら通常の書き込みで written', async () => {
    io.readFile.mockResolvedValueOnce('old')
    await expect(write('old')).resolves.toEqual({ kind: 'written' })
    expect(io.writeFile).toHaveBeenCalledWith('/work/a.ts', 'new')
    expect(io.createFile).not.toHaveBeenCalled()
  })

  it('ディスクが違えば書き込まずに modified', async () => {
    io.readFile.mockResolvedValueOnce('agent')
    await expect(write('old')).resolves.toEqual({ kind: 'conflict', reason: 'modified' })
    expect(io.writeFile).not.toHaveBeenCalled()
    expect(io.createFile).not.toHaveBeenCalled()
  })

  it('基準が null なら照合せずに通常の書き込みで上書きする', async () => {
    await expect(write(null)).resolves.toEqual({ kind: 'written' })
    expect(io.readFile).not.toHaveBeenCalled()
    expect(io.writeFile).toHaveBeenCalledWith('/work/a.ts', 'new')
    expect(io.createFile).not.toHaveBeenCalled()
  })
})

describe('writeFileChecked(解決できないパス)', () => {
  it('基準があり、ディスクにも無ければ書き込まずに deleted', async () => {
    makeUnresolvable()
    io.readFile.mockRejectedValueOnce(enoent())
    await expect(write('old')).resolves.toEqual({ kind: 'conflict', reason: 'deleted' })
    expect(io.writeFile).not.toHaveBeenCalled()
    expect(io.createFile).not.toHaveBeenCalled()
  })

  it('基準が null なら排他的作成で書く(ぶら下がったリンクを辿らない)', async () => {
    makeUnresolvable()
    await expect(write(null)).resolves.toEqual({ kind: 'written' })
    expect(io.readFile).not.toHaveBeenCalled()
    expect(io.createFile).toHaveBeenCalledWith('/work/a.ts', 'new')
    expect(io.writeFile).not.toHaveBeenCalled()
  })

  it('照合が一致しても(読めた内容が基準と同じ)排他的作成で書く', async () => {
    makeUnresolvable()
    io.readFile.mockResolvedValueOnce('old')
    await expect(write('old')).resolves.toEqual({ kind: 'written' })
    expect(io.createFile).toHaveBeenCalledWith('/work/a.ts', 'new')
    expect(io.writeFile).not.toHaveBeenCalled()
  })

  it('排他的作成が EEXIST なら modified(照合と書き込みの間に復活した)', async () => {
    makeUnresolvable()
    io.createFile.mockRejectedValueOnce(eexist())
    await expect(write(null)).resolves.toEqual({ kind: 'conflict', reason: 'modified' })
    expect(io.writeFile).not.toHaveBeenCalled()
  })

  it('排他的作成の EEXIST 以外の失敗は投げる', async () => {
    makeUnresolvable()
    io.createFile.mockRejectedValueOnce(eacces())
    await expect(write(null)).rejects.toThrow('EACCES')
  })
})

describe('writeFileChecked(許可の確認)', () => {
  it('許可の範囲外は書き込まずに投げる', async () => {
    await expect(write(null, '/etc/passwd')).rejects.toThrow('Access denied')
    expect(io.writeFile).not.toHaveBeenCalled()
    expect(io.createFile).not.toHaveBeenCalled()
  })

  it('解決できない範囲外のパスは、親フォルダの確認で投げる', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/etc/new.txt' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    await expect(write(null, '/etc/new.txt')).rejects.toThrow('Access denied')
    expect(io.createFile).not.toHaveBeenCalled()
  })

  it('realpath の存在しない以外の失敗は親フォルダへ倒さずに投げる', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/a.ts' ? Promise.reject(eacces()) : Promise.resolve(resolvePath(p))
    )
    await expect(write(null)).rejects.toThrow('EACCES')
    expect(io.writeFile).not.toHaveBeenCalled()
    expect(io.createFile).not.toHaveBeenCalled()
  })
})

// 保存の直前の照合(設計書「保存の直前の照合」。fileChangeGuard.ts から統合した)
describe('checkDiskUnchanged', () => {
  it('ディスクの内容が基準と同じなら unchanged', async () => {
    await expect(checkDiskUnchanged('/a', 'x', async () => 'x')).resolves.toEqual({
      kind: 'unchanged'
    })
  })
  it('違えば modified', async () => {
    await expect(checkDiskUnchanged('/a', 'x', async () => 'y')).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
  })
  it.each(['ENOENT', 'ENOTDIR'])('%s なら deleted', async (code) => {
    await expect(
      checkDiskUnchanged('/a', 'x', async () => {
        throw fsError(code)
      })
    ).resolves.toEqual({ kind: 'conflict', reason: 'deleted' })
  })
  it('ほかの読み込みの失敗(EACCES)は投げる', async () => {
    await expect(
      checkDiskUnchanged('/a', 'x', async () => {
        throw fsError('EACCES')
      })
    ).rejects.toThrow('EACCES')
  })
  it('BOM と CRLF も含めて文字列で比べる(読み方は fs:readFile と同じ)', async () => {
    const read = vi.fn(async () => '' + BOM + 'a\r\nb')
    await expect(checkDiskUnchanged('/a', '' + BOM + 'a\r\nb', read)).resolves.toEqual({
      kind: 'unchanged'
    })
    await expect(checkDiskUnchanged('/a', 'a\r\nb', read)).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
  })
})
