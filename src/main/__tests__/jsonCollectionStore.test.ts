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

function makeStore(): ReturnType<typeof createJsonCollectionStore<Item>> {
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

  it('壊れた JSON は空配列に読み替えず、SyntaxError として伝播する', async () => {
    mockReadFile.mockResolvedValue('[{"id": "a"')
    await expect(makeStore().load()).rejects.toBeInstanceOf(SyntaxError)
  })

  it.each([
    ['null', 'null'],
    ['数', '42'],
    ['文字列', '"items"']
  ])('JSON が配列でない値(%s)の場合も空配列を返す', async (_label, content) => {
    mockReadFile.mockResolvedValue(content)
    expect(await makeStore().load()).toEqual([])
  })

  it('code を持たない例外も伝播する', async () => {
    mockReadFile.mockRejectedValue(new Error('unexpected'))
    await expect(makeStore().load()).rejects.toThrow('unexpected')
  })

  it('保存の形(Stored)が結果の型と違っても、isValid で受け付けて sanitize で作り直す', async () => {
    // 古い形式は label が無い。isValid は緩い形を受け付け、sanitize が既定値を補う
    interface LabeledItem {
      id: string
      label: string
    }
    interface StoredLabeledItem {
      id: string
      label?: string
    }
    const isStored = (item: unknown): item is StoredLabeledItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as StoredLabeledItem).id === 'string'
    const store = createJsonCollectionStore<LabeledItem, StoredLabeledItem>({
      fileName: 'labeled.json',
      isValid: isStored,
      sanitize: (item) => ({ id: item.id, label: item.label ?? '(なし)' })
    })
    mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'old' }, { id: 'new', label: 'L' }]))
    expect(await store.load()).toEqual([
      { id: 'old', label: '(なし)' },
      { id: 'new', label: 'L' }
    ])
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

  describe('migrate オプション', () => {
    it('migrate が指定された場合、isValid の前に各要素を変換する', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([{ id: 1, extra: 'x' }]))
      // migrate で id を文字列に変換 → isValid を通過できるようにする
      const migrate = (item: unknown): unknown => {
        if (typeof item === 'object' && item !== null) {
          const t = item as Record<string, unknown>
          return { ...t, id: String(t.id) }
        }
        return item
      }
      const store = createJsonCollectionStore<Item>({
        fileName: 'items.json',
        isValid,
        sanitize,
        migrate
      })
      const result = await store.load()
      expect(result).toEqual([{ id: '1' }])
    })

    it('migrate が指定されない場合は従来どおり isValid でフィルタする', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'a' }, { id: 1 }]))
      expect(await makeStore().load()).toEqual([{ id: 'a' }])
    })

    it('migrate が非オブジェクトを返した場合でも isValid で除外される', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'a' }]))
      const migrate = (): unknown => null
      const store = createJsonCollectionStore<Item>({
        fileName: 'items.json',
        isValid,
        sanitize,
        migrate
      })
      expect(await store.load()).toEqual([])
    })

    it('migrate が単一要素で例外を throw しても他の要素はロードされる', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'a' }, { id: 'b' }]))
      let callCount = 0
      const migrate = (item: unknown): unknown => {
        callCount++
        if (callCount === 1) throw new Error('migrate 失敗')
        return item
      }
      const store = createJsonCollectionStore<Item>({
        fileName: 'items.json',
        isValid,
        sanitize,
        migrate
      })
      // 1件目は migrate が throw → 元の item にフォールバック（isValid を通過）
      // 2件目は正常に migrate
      const result = await store.load()
      expect(result).toEqual([{ id: 'a' }, { id: 'b' }])
    })
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

  it('ディレクトリの作成に失敗したら reject し、書き込まない', async () => {
    mockMkdir.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    await expect(makeStore().save([{ id: 'a' }])).rejects.toThrow('EACCES')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('書き込みに失敗したら reject する', async () => {
    mockWriteFile.mockRejectedValueOnce(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }))
    await expect(makeStore().save([{ id: 'a' }])).rejects.toThrow('ENOSPC')
  })

  it('先の save が失敗しても、同じストアの次の save は止まらずに書き込む', async () => {
    const store = makeStore()
    mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC'))
    const first = store.save([{ id: 'a' }])
    const second = store.save([{ id: 'b' }])
    await expect(first).rejects.toThrow('ENOSPC')
    await expect(second).resolves.toBeUndefined()
    expect(mockWriteFile).toHaveBeenLastCalledWith(
      '/mock/userData/items.json',
      JSON.stringify([{ id: 'b' }]),
      'utf-8'
    )
  })

  it('別インスタンスの save は独立して動作する', async () => {
    const storeA = createJsonCollectionStore<Item>({ fileName: 'a.json', isValid, sanitize })
    const storeB = createJsonCollectionStore<Item>({ fileName: 'b.json', isValid, sanitize })
    await Promise.all([storeA.save([{ id: 'a' }]), storeB.save([{ id: 'b' }])])
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/a.json',
      JSON.stringify([{ id: 'a' }]),
      'utf-8'
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/b.json',
      JSON.stringify([{ id: 'b' }]),
      'utf-8'
    )
  })
})
