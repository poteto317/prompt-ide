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

import { loadTasks, saveTasks } from '../progressStore'
import type { Task } from '@shared/types'

const sampleTask: Task = {
  id: 't1',
  title: 'タスク',
  createdAt: 1000,
  updatedAt: 2000,
  currentStageId: 'plan',
  stages: [{ id: 'plan', status: 'done', events: [{ id: 'e1', occurredAt: 500 }] }]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('loadTasks', () => {
  it('ファイルが存在しない場合は空配列を返す', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    expect(await loadTasks()).toEqual([])
  })

  it('正常な JSON 配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([sampleTask]))
    expect(await loadTasks()).toEqual([sampleTask])
  })

  it('JSON が配列でない場合は空配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ not: 'array' }))
    expect(await loadTasks()).toEqual([])
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    mockReadFile.mockRejectedValue(err)
    await expect(loadTasks()).rejects.toThrow('EPERM')
  })

  it('正しいパスのファイルを読み込む', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    await loadTasks()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/progress.json', 'utf-8')
  })

  it('不正な要素を除外する', async () => {
    const invalid = { id: 1, title: 'bad' }
    mockReadFile.mockResolvedValue(JSON.stringify([sampleTask, invalid]))
    const result = await loadTasks()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('余分なプロパティを除去する', async () => {
    const withExtra = { ...sampleTask, extra: 'x' }
    mockReadFile.mockResolvedValue(JSON.stringify([withExtra]))
    const result = await loadTasks()
    expect((result[0] as Record<string, unknown>).extra).toBeUndefined()
  })
})

describe('saveTasks', () => {
  it('JSON 文字列化してファイルに書き込む', async () => {
    await saveTasks([sampleTask])
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/progress.json',
      JSON.stringify([sampleTask]),
      'utf-8'
    )
  })

  it('空配列を書き込める', async () => {
    await saveTasks([])
    expect(mockWriteFile).toHaveBeenCalledWith('/mock/userData/progress.json', '[]', 'utf-8')
  })

  it('writeFile の前に userData ディレクトリを再帰的に作成する', async () => {
    await saveTasks([sampleTask])
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })

  describe('書き込みキュー（直列化）', () => {
    it('連続した save は呼び出し順に書き込まれる', async () => {
      const invocationOrder: string[] = []
      mockWriteFile.mockImplementation((_path: string, content: string) => {
        invocationOrder.push(content)
        return Promise.resolve()
      })

      await Promise.all([saveTasks([sampleTask]), saveTasks([])])

      expect(invocationOrder).toEqual([JSON.stringify([sampleTask]), '[]'])
    })

    it('先行 save が完了するまで後続 save の writeFile は呼ばれない', async () => {
      let resolveFirst!: () => void
      mockWriteFile
        .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
        .mockResolvedValue(undefined)

      const p1 = saveTasks([sampleTask])
      const p2 = saveTasks([])

      await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalledTimes(1))
      expect(mockWriteFile.mock.calls[0][1]).toBe(JSON.stringify([sampleTask]))

      resolveFirst()
      await Promise.all([p1, p2])

      expect(mockWriteFile).toHaveBeenCalledTimes(2)
      expect(mockWriteFile.mock.calls[1][1]).toBe('[]')
    })
  })
})
