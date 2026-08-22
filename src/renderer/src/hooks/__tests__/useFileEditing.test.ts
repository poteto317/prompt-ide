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

// otherFile は content === savedContent（未変更）のため、saveFile() を呼んでも
// 実際に writeFileContent が発火することを期待するテストではこちらを使う。
const dirtyOtherFile: OpenFile = { ...otherFile, content: 'edited other content' }

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

  it('未変更(content === savedContent)のとき、Cmd/Ctrl+S 経由で呼ばれても writeFileContent は呼ばれない', async () => {
    const setOpenFile = vi.fn()
    const { result } = renderHook(() => useFileEditing(cleanFile, setOpenFile))

    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
    expect(setOpenFile).not.toHaveBeenCalled()
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

  it('同一レンダー内で連続して呼ばれても writeFileContent は一度しか呼ばれない（同期的な多重保存ガード）', async () => {
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn()))

    await act(async () => {
      const p1 = result.current.saveFile()
      const p2 = result.current.saveFile()
      await Promise.all([p1, p2])
    })

    expect(mockWriteFileContent).toHaveBeenCalledOnce()
  })
})

describe('isSaving は path 単位でスコープされる', () => {
  it('別ファイルの保存中でも、今表示しているファイルの isSaving はブロックされず保存できる', async () => {
    let resolveFirstWrite: () => void = () => {}
    mockWriteFileContent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstWrite = resolve
        })
    )
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, vi.fn()), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })

    let firstSave: Promise<void> = Promise.resolve()
    act(() => {
      firstSave = result.current.saveFile()
    })
    expect(result.current.isSaving).toBe(true)

    // dirtyFile の保存がまだ pending のまま、別ファイル（未保存の変更あり）へ切り替える
    rerender({ file: dirtyOtherFile })
    expect(result.current.isSaving).toBe(false)

    mockWriteFileContent.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).toHaveBeenCalledWith(dirtyOtherFile.path, dirtyOtherFile.content)
    expect(result.current.saveError).toBeNull()

    await act(async () => {
      resolveFirstWrite()
      await firstSave
    })
  })

  it('file A 保存中に file B の保存が始まっても、A へ戻ったときの多重保存防止は失われない', async () => {
    let resolveA: () => void = () => {}
    let resolveB: () => void = () => {}
    mockWriteFileContent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveA = resolve
        })
    )
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, vi.fn()), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })

    // file A (dirtyFile) の保存を開始（pending のまま）
    let saveA: Promise<void> = Promise.resolve()
    act(() => {
      saveA = result.current.saveFile()
    })

    // file B (dirtyOtherFile) へ切り替えて保存を開始（こちらも pending のまま）
    rerender({ file: dirtyOtherFile })
    mockWriteFileContent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveB = resolve
        })
    )
    let saveB: Promise<void> = Promise.resolve()
    act(() => {
      saveB = result.current.saveFile()
    })

    // file A へ戻る。A の最初の保存はまだ pending のままのはず。
    rerender({ file: dirtyFile })
    expect(result.current.isSaving).toBe(true)

    // この状態で再度 saveFile を呼んでも、A への writeFileContent は追加で発火しない
    // （最初の保存が既に in-flight であるため多重保存としてブロックされる）。
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteFileContent).toHaveBeenCalledTimes(2) // A の最初の1回 + B の1回のみ

    await act(async () => {
      resolveA()
      resolveB()
      await Promise.all([saveA, saveB])
    })
  })
})

describe('resetForFileChange', () => {
  it('呼ぶと saveError がクリアされる', async () => {
    mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
    const { result } = renderHook(() => useFileEditing(dirtyFile, vi.fn()))

    await act(async () => {
      await result.current.saveFile()
    })
    expect(result.current.saveError?.message).toBe('EACCES')

    act(() => {
      result.current.resetForFileChange()
    })
    expect(result.current.saveError).toBeNull()
  })

  it('呼ばずに openFile が別ファイルへ変わっただけでは saveError は自動でクリアされない（呼び出し側が明示的に呼ぶ責務）', async () => {
    mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, vi.fn()), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })
    await act(async () => {
      await result.current.saveFile()
    })
    expect(result.current.saveError?.message).toBe('EACCES')

    rerender({ file: otherFile })
    expect(result.current.saveError?.message).toBe('EACCES')
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

    // useFileSystem.ts の selectFile/openFolder は setOpenFile 成功後に必ず
    // resetForFileChange() も呼ぶため、その実際の呼び出しパターンを再現する。
    rerender({ file: otherFile })
    act(() => {
      result.current.resetForFileChange()
    })

    await act(async () => {
      rejectWrite(new Error('EACCES'))
      await savePromise
    })

    expect(result.current.saveError).toBeNull()
  })

  it('保存中に同じファイルを開き直した(resetForFileChangeで世代が変わった)場合、遅れて届いた古い保存成功は反映されない', async () => {
    let resolveWrite: () => void = () => {}
    mockWriteFileContent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )
    const setOpenFile = vi.fn()
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, setOpenFile), {
      initialProps: { file: dirtyFile as OpenFile | null }
    })

    let savePromise: Promise<void> = Promise.resolve()
    act(() => {
      savePromise = result.current.saveFile()
    })

    // ユーザーが破棄確認の上で同じ path のファイルを開き直した想定
    // （selectFile が新しい OpenFile オブジェクトを生成し resetForFileChange を呼ぶ）
    const reloadedSameFile: OpenFile = { ...dirtyFile, content: dirtyFile.savedContent }
    rerender({ file: reloadedSameFile })
    act(() => {
      result.current.resetForFileChange()
    })

    await act(async () => {
      resolveWrite()
      await savePromise
    })

    const updater = setOpenFile.mock.calls[0][0]
    expect(updater(reloadedSameFile)).toBe(reloadedSameFile)
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

describe('FS 操作のロックと saveFile', () => {
  it('親ディレクトリがロックされている間は書き込まず、解放後に書き込む', async () => {
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    // 同じフォルダにファイルを作る、兄弟をリネームするといった操作は
    // 親ディレクトリをロックする
    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project', {
        invalidatesPaths: null
      })
    })

    let savePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      savePromise = result.current.saveFile()
      await Promise.resolve()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
    // 保存が捨てられたのではなく待っていることが、画面からも分かる
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      release()
      await savePromise
    })

    expect(mockWriteFileContent).toHaveBeenCalledWith(dirtyFile.path, dirtyFile.content)
    expect(result.current.isSaving).toBe(false)
  })

  it('getOpenFile が渡されていれば、同じ tick で確定した内容を書き込む', async () => {
    // useLatestRef は layout effect で更新されるため、同じ tick に入った編集を
    // 取りこぼす。useFileSystem は同期ミラーを持っているので、それを読む
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    let mirror: OpenFile = dirtyFile
    const { result } = renderHook(() =>
      useFileEditing(dirtyFile, setOpenFile, { getOpenFile: () => mirror })
    )

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project', {
        invalidatesPaths: null
      })
    })

    let savePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      savePromise = result.current.saveFile()
      await Promise.resolve()
    })

    // React のコミットを待たずにミラーだけが進んだ状態
    mirror = { ...dirtyFile, content: 'const x = 4' }

    await act(async () => {
      release()
      await savePromise
    })

    expect(mockWriteFileContent).toHaveBeenCalledWith(dirtyFile.path, 'const x = 4')
  })

  it('リネーム・削除のロック中は saveError で理由を伝える', async () => {
    // 黙って捨てると、ユーザーには dirty マークしか見えない
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    await act(async () => {
      await result.current.lockPathForFileOperation('/project/', {
        invalidatesPaths: [dirtyFile.path]
      })
    })

    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
    expect(result.current.saveError).toBeInstanceOf(Error)
  })

  it('リネーム・削除のロック中は待たずに書き込まない', async () => {
    // 待って書き込むと、消えた/付け替わった旧パスを再作成してしまう
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project')
    })

    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)

    await act(async () => {
      release()
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('同じフォルダの別ファイルをリネームしている間は、待ってから書き込む', async () => {
    // リネームは親ディレクトリをロックするが、無効化されるのはリネーム対象自身。
    // 兄弟の保存まで捨てると、Cmd+S が無反応に見えて内容が失われる
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project/', {
        invalidatesPaths: ['/project/other.ts', '/project/renamed.ts']
      })
    })

    let savePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      savePromise = result.current.saveFile()
      await Promise.resolve()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      release()
      await savePromise
    })

    expect(mockWriteFileContent).toHaveBeenCalledWith(dirtyFile.path, dirtyFile.content)
  })

  it('開いているファイル自身のリネーム中は書き込まず、保存の完了として数えない', async () => {
    // 数えてしまうと、読み込み側が「保存と競合した」と誤検出して読み直しを繰り返す
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    await act(async () => {
      await result.current.lockPathForFileOperation('/project/', {
        invalidatesPaths: [dirtyFile.path]
      })
    })

    const before = result.current.saveCompletionsFor(dirtyFile.path)
    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
    expect(result.current.saveCompletionsFor(dirtyFile.path)).toBe(before)
  })

  it('リネームの移行先を開いているバッファの保存は書き込まない', async () => {
    // 削除したがバッファを残したファイルと同じ名前へ別のファイルをリネームすると、
    // 待ってから書き込む扱いでは、リネームしてきた内容をバッファで上書きしてしまう
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project/', {
        // /project/other.ts を dirtyFile.path（/project/index.ts）へリネームする
        invalidatesPaths: ['/project/other.ts', dirtyFile.path]
      })
    })

    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()

    await act(async () => {
      release()
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('ロックを待っている間に編集された内容を書き込む', async () => {
    // 待機中の 2 回目の Cmd+S は多重保存ガードで no-op になる。待つ前に捕まえた
    // 内容をそのまま書くと、ユーザーの 2 回目の保存要求が捨てられる
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result, rerender } = renderHook(({ file }) => useFileEditing(file, setOpenFile), {
      initialProps: { file: dirtyFile }
    })

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project', {
        invalidatesPaths: null
      })
    })

    let savePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      savePromise = result.current.saveFile()
      await Promise.resolve()
    })

    // 待っている間にさらに編集した
    rerender({ file: { ...dirtyFile, content: 'const x = 3' } })

    await act(async () => {
      release()
      await savePromise
    })

    expect(mockWriteFileContent).toHaveBeenCalledWith(dirtyFile.path, 'const x = 3')
  })

  it('作成のロックでも、作られるパスを開いているバッファの保存は書き込まない', async () => {
    // 削除してバッファだけ残したファイルと同じ名前で作り直すと、待って書き込む
    // 扱いでは、作られたばかりのファイルを古いバッファで上書きしてしまう
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project', {
        invalidatesPaths: [dirtyFile.path]
      })
    })

    await act(async () => {
      await result.current.saveFile()
      release()
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('ロックを待っている間にファイルが切り替わったら書き込まない', async () => {
    const setOpenFile = vi.fn()
    mockWriteFileContent.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileEditing(dirtyFile, setOpenFile))

    let release: () => void = () => {}
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project', {
        invalidatesPaths: null
      })
    })

    let savePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      savePromise = result.current.saveFile()
      await Promise.resolve()
    })

    await act(async () => {
      // 別のファイルを開いた（開き直した）
      result.current.resetForFileChange()
      release()
      await savePromise
    })

    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })
})
