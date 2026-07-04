import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileEditing } from '../useFileEditing'

const mockWriteFileContent = vi.mocked(fileSystemApi.writeFileContent)

const cleanFile: OpenFile = {
  path: '/project/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  savedContent: 'const x = 1',
  language: 'typescript'
}

const dirtyFile: OpenFile = { ...cleanFile, content: 'const x = 2' }

const otherFile: OpenFile = {
  path: '/project/other.ts',
  name: 'other.ts',
  content: 'other content',
  savedContent: 'other content',
  language: 'typescript'
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isDirty', () => {
  it('openFile が null のとき false', () => {
    const { result } = renderHook(() => useFileEditing(null, vi.fn()))
    expect(result.current.isDirty).toBe(false)
  })

  it('content と savedContent が一致するとき false', () => {
    const { result } = renderHook(() => useFileEditing(cleanFile, vi.fn()))
    expect(result.current.isDirty).toBe(false)
  })

  it('content と savedContent が異なるとき true', () => {
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn()))
    expect(result.current.isDirty).toBe(true)
  })
})

describe('updateFileContent', () => {
  it('setOpenFile に content を更新する updater を渡す', () => {
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(cleanFile, setOpenFile))

    result.current.updateFileContent('new content')

    expect(setOpenFile).toHaveBeenCalledOnce()
    const updater = setOpenFile.mock.calls[0][0]
    expect(updater(cleanFile)).toEqual({ ...cleanFile, content: 'new content' })
  })

  it('openFile が null のとき updater は null を素通しする', () => {
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(null, setOpenFile))

    result.current.updateFileContent('new content')

    const updater = setOpenFile.mock.calls[0][0]
    expect(updater(null)).toBeNull()
  })
})

describe('saveFile', () => {
  it('openFile が null のとき何もしない', async () => {
    const { result } = renderHook(() => useFileEditing(null, vi.fn()))
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('成功時: writeFileContent を呼び、savedContent を content に更新する updater を setOpenFile に渡す', async () => {
    mockWriteFileContent.mockResolvedValue(undefined)
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).toHaveBeenCalledWith(dirtyFile.path, dirtyFile.content)
    expect(result.current.saveError).toBeNull()
    const updater = setOpenFile.mock.calls[0][0]
    expect(updater(dirtyFile).savedContent).toBe(dirtyFile.content)
  })

  it('失敗時: saveError にセットし setOpenFile は呼ばない', async () => {
    mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    await act(async () => {
      await result.current.saveFile()
    })

    expect(result.current.saveError).toBeInstanceOf(Error)
    expect(result.current.saveError?.message).toBe('EACCES')
    expect(setOpenFile).not.toHaveBeenCalled()
  })

  it('保存中にさらに編集されても、savedContent には実際に書き込んだ内容だけが反映される（レース条件対策）', async () => {
    mockWriteFileContent.mockResolvedValue(undefined)
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    await act(async () => {
      await result.current.saveFile()
    })

    // saveFile 呼び出し時点の dirtyFile.content('const x = 2') が書き込まれた後、
    // ユーザーがさらに編集して content が変わった状態を想定した updater の入力。
    const furtherEditedFile: OpenFile = { ...dirtyFile, content: 'const x = 3' }
    const updater = setOpenFile.mock.calls[0][0]
    const updated = updater(furtherEditedFile)

    expect(updated.savedContent).toBe(dirtyFile.content)
    expect(updated.content).toBe('const x = 3')
  })

  it('保存中に別ファイルへ切り替わっていた場合、updater は無関係な openFile を変更しない', async () => {
    mockWriteFileContent.mockResolvedValue(undefined)
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    await act(async () => {
      await result.current.saveFile()
    })

    const updater = setOpenFile.mock.calls[0][0]
    expect(updater(otherFile)).toBe(otherFile)
  })
})

describe('isSaving', () => {
  it('保存開始で true になり、完了で false に戻る', async () => {
    let resolveWrite: () => void = () => {}
    mockWriteFileContent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn()))

    let savePromise: Promise<void> = Promise.resolve()
    act(() => {
      savePromise = result.current.saveFile()
    })
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      resolveWrite()
      await savePromise
    })
    expect(result.current.isSaving).toBe(false)
  })

  it('保存中に再度 saveFile を呼んでも writeFileContent は多重に呼ばれない（多重保存ガード）', async () => {
    let resolveWrite: () => void = () => {}
    mockWriteFileContent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn()))

    let firstSave: Promise<void> = Promise.resolve()
    act(() => {
      firstSave = result.current.saveFile()
    })
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteFileContent).toHaveBeenCalledOnce()

    await act(async () => {
      resolveWrite()
      await firstSave
    })
    expect(result.current.isSaving).toBe(false)
  })
})

describe('ファイル切り替え時の saveError', () => {
  it('保存失敗後に別ファイルへ切り替わると saveError がクリアされる', async () => {
    mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, vi.fn()), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })

    await act(async () => {
      await result.current.saveFile()
    })
    expect(result.current.saveError?.message).toBe('EACCES')

    rerender({ file: otherFile })
    expect(result.current.saveError).toBeNull()
  })

  it('保存中に別ファイルへ切り替わっていた場合、後から保存が失敗しても saveError はセットされない', async () => {
    let rejectWrite: (err: Error) => void = () => {}
    mockWriteFileContent.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject
        })
    )
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, vi.fn()), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })

    let savePromise: Promise<void> = Promise.resolve()
    act(() => {
      savePromise = result.current.saveFile()
    })

    rerender({ file: otherFile })

    await act(async () => {
      rejectWrite(new Error('EACCES'))
      await savePromise
    })

    expect(result.current.saveError).toBeNull()
  })

  it('同じファイルのまま再レンダーされても saveError はクリアされない（path が変化しない限り消えない）', async () => {
    mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, vi.fn()), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })

    await act(async () => {
      await result.current.saveFile()
    })
    expect(result.current.saveError?.message).toBe('EACCES')

    // path は同じまま content だけ変わった再レンダー（ユーザーが編集を続けているケース）
    const furtherEditedSameFile: OpenFile = { ...dirtyFile, content: 'const x = 3' }
    rerender({ file: furtherEditedSameFile })

    expect(result.current.saveError?.message).toBe('EACCES')
  })
})

describe('confirmDiscardIfDirty', () => {
  it('isDirty が false のとき true を返し onConfirm を呼ばない', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useFileEditing(cleanFile, vi.fn(), { onConfirm }))

    expect(result.current.confirmDiscardIfDirty()).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('isDirty のとき onConfirm を呼び、true が返ればそのまま true を返す', () => {
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn(), { onConfirm }))

    expect(result.current.confirmDiscardIfDirty()).toBe(true)
    expect(onConfirm).toHaveBeenCalledWith(expect.any(String))
  })

  it('isDirty のとき onConfirm が false を返せば false を返す', () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn(), { onConfirm }))

    expect(result.current.confirmDiscardIfDirty()).toBe(false)
  })
})
