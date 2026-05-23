import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockShowOpenDialog = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mockShowOpenDialog },
}))

import { openFolderDialog } from '../dialogService'

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
