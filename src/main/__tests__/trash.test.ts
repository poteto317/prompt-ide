import { describe, it, expect, vi } from 'vitest'

const mockTrashItem = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { trashItem: mockTrashItem } }))

import { moveToTrash } from '../trash'

describe('moveToTrash', () => {
  it('shell.trashItem に絶対パスをそのまま渡す', async () => {
    mockTrashItem.mockResolvedValue(undefined)
    await moveToTrash('/project/new.txt')
    expect(mockTrashItem).toHaveBeenCalledWith('/project/new.txt')
  })

  it('shell.trashItem の失敗を伝播する', async () => {
    mockTrashItem.mockRejectedValue(new Error('trash unavailable'))
    await expect(moveToTrash('/project/new.txt')).rejects.toThrow('trash unavailable')
  })
})
