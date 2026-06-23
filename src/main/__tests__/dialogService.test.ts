import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockShowOpenDialog = vi.hoisted(() => vi.fn())
const mockShowSaveDialog = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mockShowOpenDialog, showSaveDialog: mockShowSaveDialog },
}))

import { openFolderDialog, openJsonDialog, saveJsonDialog } from '../dialogService'

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openFolderDialog', () => {
  it('showOpenDialog を openDirectory プロパティで呼び出す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await openFolderDialog()
    expect(mockShowOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
  })

  it('canceled=true のとき null を返す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const result = await openFolderDialog()
    expect(result).toBeNull()
  })

  it('canceled=false のとき filePaths[0] を返す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/project'] })
    const result = await openFolderDialog()
    expect(result).toBe('/project')
  })

  it('複数パスが返っても最初の1つだけ返す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/project', '/other'] })
    const result = await openFolderDialog()
    expect(result).toBe('/project')
  })

  it('canceled=false でも filePaths が空のとき null を返す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    const result = await openFolderDialog()
    expect(result).toBeNull()
  })
})

describe('saveJsonDialog', () => {
  it('defaultPath と JSON フィルタを指定して showSaveDialog を呼ぶ', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    await saveJsonDialog('prompts.json')
    expect(mockShowSaveDialog).toHaveBeenCalledWith({
      defaultPath: 'prompts.json',
      filters: JSON_FILTERS,
    })
  })

  it('保存先 filePath を返す', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/prompts.json' })
    const result = await saveJsonDialog('prompts.json')
    expect(result).toBe('/out/prompts.json')
  })

  it('canceled で filePath が undefined のとき null を返す', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    const result = await saveJsonDialog('prompts.json')
    expect(result).toBeNull()
  })
})

describe('openJsonDialog', () => {
  it('openFile プロパティと JSON フィルタを指定して showOpenDialog を呼ぶ', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await openJsonDialog()
    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: JSON_FILTERS,
    })
  })

  it('選択された filePaths[0] を返す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/in/prompts.json'] })
    const result = await openJsonDialog()
    expect(result).toBe('/in/prompts.json')
  })

  it('filePaths が空のとき null を返す', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const result = await openJsonDialog()
    expect(result).toBeNull()
  })
})
