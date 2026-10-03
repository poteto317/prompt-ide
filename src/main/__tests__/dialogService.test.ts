import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockShowOpenDialog = vi.hoisted(() => vi.fn())
const mockShowSaveDialog = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mockShowOpenDialog, showSaveDialog: mockShowSaveDialog }
}))

import type { BrowserWindow } from 'electron'
import {
  chooseCloneParentDialog,
  openFolderDialog,
  openJsonDialog,
  saveJsonDialog
} from '../dialogService'

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
  // 親ウィンドウ無しのダイアログは独立したウィンドウになり、表示中も画面を操作できる(clone を押せてしまう)。
  // ウィンドウを渡せばそのウィンドウのモーダル(macOS はシート)にする
  it('ウィンドウを渡すと、そのウィンドウのモーダルとして showOpenDialog(window, options) を呼ぶ', async () => {
    const window = { id: 'window' } as unknown as BrowserWindow
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/project'] })
    expect(await openFolderDialog(window)).toBe('/project')
    expect(mockShowOpenDialog).toHaveBeenCalledWith(window, { properties: ['openDirectory'] })
  })

  it('ウィンドウが null なら、従来どおり options だけで呼ぶ', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await openFolderDialog(null)
    expect(mockShowOpenDialog.mock.calls[0]).toEqual([{ properties: ['openDirectory'] }])
  })
})

describe('saveJsonDialog', () => {
  it('defaultPath と JSON フィルタを指定して showSaveDialog を呼ぶ', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    await saveJsonDialog('prompts.json')
    expect(mockShowSaveDialog).toHaveBeenCalledWith({
      defaultPath: 'prompts.json',
      filters: JSON_FILTERS
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
      filters: JSON_FILTERS
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

describe('chooseCloneParentDialog', () => {
  const options = {
    title: 'clone の保存先（親フォルダ）を選択',
    buttonLabel: 'ここに clone',
    properties: ['openDirectory', 'createDirectory']
  }

  it('ウィンドウがあれば、そのウィンドウのモーダルとしてフォルダの作成を許可して開く', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/parent'] })
    const window = { id: 1 } as unknown as BrowserWindow
    expect(await chooseCloneParentDialog(window)).toBe('/parent')
    expect(mockShowOpenDialog).toHaveBeenCalledWith(window, options)
  })

  it('ウィンドウが無ければ、親を指定せずに開く', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/parent'] })
    expect(await chooseCloneParentDialog(null)).toBe('/parent')
    expect(mockShowOpenDialog).toHaveBeenCalledWith(options)
  })

  it('取り消し・空の選択は null', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/parent'] })
    expect(await chooseCloneParentDialog(null)).toBeNull()
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await chooseCloneParentDialog(null)).toBeNull()
  })
})
