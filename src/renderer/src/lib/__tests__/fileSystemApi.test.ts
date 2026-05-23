import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'
import { openFolder, readDirectory, readFileContent } from '../fileSystemApi'

const mockApi = {
  openFolder: vi.fn(),
  readDirectory: vi.fn(),
  readFile: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

const mockTree: FileTreeNode[] = [
  { name: 'src', path: '/p/src', type: 'directory', children: [] },
]

describe('openFolder', () => {
  it('window.api.openFolder を呼び出す', async () => {
    mockApi.openFolder.mockResolvedValue('/project')
    const result = await openFolder()
    expect(mockApi.openFolder).toHaveBeenCalledOnce()
    expect(result).toBe('/project')
  })

  it('キャンセル時は null を返す', async () => {
    mockApi.openFolder.mockResolvedValue(null)
    const result = await openFolder()
    expect(result).toBeNull()
  })
})

describe('readDirectory', () => {
  it('window.api.readDirectory をパスを引数に呼び出す', async () => {
    mockApi.readDirectory.mockResolvedValue(mockTree)
    const result = await readDirectory('/project')
    expect(mockApi.readDirectory).toHaveBeenCalledWith('/project')
    expect(result).toEqual(mockTree)
  })
})

describe('readFileContent', () => {
  it('window.api.readFile をパスを引数に呼び出す', async () => {
    mockApi.readFile.mockResolvedValue('const x = 1')
    const result = await readFileContent('/project/src/index.ts')
    expect(mockApi.readFile).toHaveBeenCalledWith('/project/src/index.ts')
    expect(result).toBe('const x = 1')
  })
})
