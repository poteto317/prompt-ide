import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'
import {
  openFolder,
  readDirectory,
  readFileContent,
  writeFileContent,
  createFile,
  createDirectory,
  renameEntry,
  deleteEntry,
  addToGitignore,
  writeFileContentChecked,
  setWatchedFiles,
  onExternalFileChange,
  setFolderWatch,
  onFolderChange
} from '../fileSystemApi'

const mockApi = {
  openFolder: vi.fn(),
  readDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  renameEntry: vi.fn(),
  deleteEntry: vi.fn(),
  addToGitignore: vi.fn(),
  writeFileChecked: vi.fn(),
  setWatchedFiles: vi.fn(),
  onExternalFileChange: vi.fn(),
  setFolderWatch: vi.fn(),
  onFolderChange: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

const mockTree: FileTreeNode[] = [{ name: 'src', path: '/p/src', type: 'directory', children: [] }]

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

describe('writeFileContent', () => {
  it('window.api.writeFile をパスと内容を引数に呼び出す', async () => {
    mockApi.writeFile.mockResolvedValue(undefined)
    await writeFileContent('/project/src/index.ts', 'const x = 2')
    expect(mockApi.writeFile).toHaveBeenCalledWith('/project/src/index.ts', 'const x = 2')
  })
})

describe('createFile', () => {
  it('window.api.createFile を parentPath と name を引数に呼び出す', async () => {
    mockApi.createFile.mockResolvedValue(undefined)
    await createFile('/project', 'a.txt')
    expect(mockApi.createFile).toHaveBeenCalledWith('/project', 'a.txt')
  })
})

describe('createDirectory', () => {
  it('window.api.createDirectory を parentPath と name を引数に呼び出す', async () => {
    mockApi.createDirectory.mockResolvedValue(undefined)
    await createDirectory('/project', 'sub')
    expect(mockApi.createDirectory).toHaveBeenCalledWith('/project', 'sub')
  })
})

describe('renameEntry', () => {
  it('window.api.renameEntry を path と newName を引数に呼び出す', async () => {
    mockApi.renameEntry.mockResolvedValue(undefined)
    await renameEntry('/project/a.txt', 'b.txt')
    expect(mockApi.renameEntry).toHaveBeenCalledWith('/project/a.txt', 'b.txt')
  })
})

describe('deleteEntry', () => {
  it('window.api.deleteEntry を path を引数に呼び出す', async () => {
    mockApi.deleteEntry.mockResolvedValue(undefined)
    await deleteEntry('/project/a.txt')
    expect(mockApi.deleteEntry).toHaveBeenCalledWith('/project/a.txt')
  })
})

describe('addToGitignore', () => {
  it('window.api.addToGitignore を targetPath で呼ぶ', async () => {
    await addToGitignore('/project/dist')
    expect(mockApi.addToGitignore).toHaveBeenCalledWith('/project/dist')
  })
})

describe('外部変更の検知', () => {
  it('writeFileContentChecked は window.api.writeFileChecked に path・content・baseContent を渡し、結果を返す', async () => {
    mockApi.writeFileChecked.mockResolvedValue({ kind: 'conflict', reason: 'modified' })
    await expect(writeFileContentChecked('/p/a', 'new', 'old')).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
    expect(mockApi.writeFileChecked).toHaveBeenCalledWith('/p/a', 'new', 'old')
  })

  it('setWatchedFiles・onExternalFileChange は window.api に委譲する', async () => {
    const unsubscribe = vi.fn()
    mockApi.onExternalFileChange.mockReturnValue(unsubscribe)
    await setWatchedFiles(['/p/a'])
    const listener = vi.fn()
    expect(onExternalFileChange(listener)).toBe(unsubscribe)
    expect(mockApi.setWatchedFiles).toHaveBeenCalledWith(['/p/a'])
    expect(mockApi.onExternalFileChange).toHaveBeenCalledWith(listener)
  })

  it('setFolderWatch・onFolderChange は window.api に委譲する', async () => {
    const unsubscribe = vi.fn()
    mockApi.onFolderChange.mockReturnValue(unsubscribe)
    await setFolderWatch(false)
    const listener = vi.fn()
    expect(onFolderChange(listener)).toBe(unsubscribe)
    expect(mockApi.setFolderWatch).toHaveBeenCalledWith(false)
    expect(mockApi.onFolderChange).toHaveBeenCalledWith(listener)
  })
})
