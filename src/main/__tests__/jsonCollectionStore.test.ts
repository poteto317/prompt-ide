import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir
}))

import { createJsonCollectionStore } from '../jsonCollectionStore'

interface Item {
  id: string
}

function isValid(item: unknown): item is Item {
  return typeof item === 'object' && item !== null && typeof (item as Item).id === 'string'
}

const sanitize = (item: Item): Item => ({ id: item.id })

function makeStore() {
  return createJsonCollectionStore<Item>({ fileName: 'items.json', isValid, sanitize })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('load', () => {
  it('ファイルが存在しない場合は空配列を返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    expect(await makeStore().load()).toEqual([])
  })

  it('正常な JSON 配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'a' }]))
    expect(await makeStore().load()).toEqual([{ id: 'a' }])
  })

  it('JSON が配列でない場合は空配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ not: 'array' }))
    expect(await makeStore().load()).toEqual([])
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    await expect(makeStore().load()).rejects.toThrow('EPERM')
  })

  it('fileName から組み立てたパスを読み込む', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await makeStore().load()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/items.json', 'utf-8')
  })

  it('不正な要素を除外する', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'a' }, { id: 1 }, null]))
    expect(await makeStore().load()).toEqual([{ id: 'a' }])
  })

  it('各要素を sanitize する（余分なプロパティ除去）', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'a', extra: 'x' }]))
    const result = await makeStore().load()
    expect((result[0] as unknown as Record<string, unknown>).extra).toBeUndefined()
  })
})

describe('save', () => {
  it('JSON 文字列化してファイルに書き込む', async () => {
    await makeStore().save([{ id: 'a' }])
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/items.json',
      JSON.stringify([{ id: 'a' }]),
      'utf-8'
    )
  })

  it('空配列を書き込める', async () => {
    await makeStore().save([])
    expect(mockWriteFile).toHaveBeenCalledWith('/mock/userData/items.json', '[]', 'utf-8')
  })

  it('writeFile の前に userData ディレクトリを再帰的に作成する', async () => {
    await makeStore().save([{ id: 'a' }])
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })

  it('別インスタンスの save は独立して動作する', async () => {
    const storeA = createJsonCollectionStore<Item>({ fileName: 'a.json', isValid, sanitize })
    const storeB = createJsonCollectionStore<Item>({ fileName: 'b.json', isValid, sanitize })
    await Promise.all([storeA.save([{ id: 'a' }]), storeB.save([{ id: 'b' }])])
    expect(mockWriteFile).toHaveBeenCalledWith('/mock/userData/a.json', JSON.stringify([{ id: 'a' }]), 'utf-8')
    expect(mockWriteFile).toHaveBeenCalledWith('/mock/userData/b.json', JSON.stringify([{ id: 'b' }]), 'utf-8')
  })
})
