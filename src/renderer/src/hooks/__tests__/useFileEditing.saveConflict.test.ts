import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import type { OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import {
  SAVE_CONFLICT_DELETED_MESSAGE,
  SAVE_CONFLICT_MODIFIED_MESSAGE,
  SAVE_CONFLICT_OVERWRITE_FAILED_MESSAGE,
  saveConflictMessage,
  useFileEditing
} from '../useFileEditing'

const mockWriteChecked = vi.mocked(fileSystemApi.writeFileContentChecked)

const dirty: OpenFile = {
  path: '/project/a.ts',
  name: 'a.ts',
  content: 'mine',
  savedContent: 'base',
  language: 'typescript'
}

// setOpenFile の更新関数を current に当てる最小の入れ物(saveFile は関数形の更新を使う)
function holder(initial: OpenFile): {
  current: OpenFile | null
  set: Dispatch<SetStateAction<OpenFile | null>>
} {
  const box = {
    current: initial as OpenFile | null,
    set: ((next: SetStateAction<OpenFile | null>) => {
      box.current = typeof next === 'function' ? next(box.current) : next
    }) as Dispatch<SetStateAction<OpenFile | null>>
  }
  return box
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('saveFile の保存の直前の照合', () => {
  it('タブが最後にディスクと一致した内容(savedContent)を基準に照合して書き込む', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'written' })
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, { getOpenFile: () => file.current })
    )
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteChecked).toHaveBeenCalledExactlyOnceWith('/project/a.ts', 'mine', 'base')
    expect(file.current?.savedContent).toBe('mine')
  })

  it('ロックの解除を待つ間にタブの savedContent が変わったら(ディスクの内容の再読込)、その最新の内容を基準に照合する', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'written' })
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, { getOpenFile: () => file.current })
    )
    // 同じフォルダでの作成などの、無効化を伴わないロック(保存は解除まで待つ)
    let release: () => void = () => undefined
    await act(async () => {
      release = await result.current.lockPathForFileOperation('/project', {
        invalidatesPaths: null
      })
    })
    let saving: Promise<void> = Promise.resolve()
    await act(async () => {
      saving = result.current.saveFile()
      await Promise.resolve()
    })
    expect(mockWriteChecked).not.toHaveBeenCalled()
    // 待っている間に、タブが最後にディスクと一致した内容が変わった
    file.current = { ...dirty, savedContent: 'reloaded' }
    await act(async () => {
      release()
      await saving
    })
    // 保存を始めた時点の savedContent('base')で照合すると、自分の再読込を外部変更と誤認する
    expect(mockWriteChecked).toHaveBeenCalledExactlyOnceWith('/project/a.ts', 'mine', 'reloaded')
  })

  it.each([
    ['modified', SAVE_CONFLICT_MODIFIED_MESSAGE],
    ['deleted', SAVE_CONFLICT_DELETED_MESSAGE]
  ] as const)(
    '%s のとき確認を出し、OK なら照合せずに書き込んで savedContent を更新する',
    async (reason, message) => {
      mockWriteChecked
        .mockResolvedValueOnce({ kind: 'conflict', reason })
        .mockResolvedValueOnce({ kind: 'written' })
      const onConfirm = vi.fn(() => true)
      const onSaveConflict = vi.fn()
      const file = holder(dirty)
      const { result } = renderHook(() =>
        useFileEditing(file.current, file.set, {
          getOpenFile: () => file.current,
          onConfirm,
          onSaveConflict
        })
      )
      await act(async () => {
        await result.current.saveFile()
      })
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(message)
      expect(mockWriteChecked).toHaveBeenNthCalledWith(2, '/project/a.ts', 'mine', null)
      expect(file.current?.savedContent).toBe('mine')
      expect(onSaveConflict).not.toHaveBeenCalled()
    }
  )

  it('キャンセルなら書き込まず、savedContent を変えず、外部変更の印を付ける', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'conflict', reason: 'modified' })
    const onSaveConflict = vi.fn()
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, {
        getOpenFile: () => file.current,
        onConfirm: () => false,
        onSaveConflict
      })
    )
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteChecked).toHaveBeenCalledTimes(1)
    expect(file.current?.savedContent).toBe('base')
    expect(onSaveConflict).toHaveBeenCalledExactlyOnceWith('/project/a.ts', 'modified')
    expect(result.current.saveError).toBeNull()
  })

  it('確認の間にタブが開き直されたら(世代が変わったら)書き込まない', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'conflict', reason: 'modified' })
    const file = holder(dirty)
    const ref: { reset: (path: string) => void } = { reset: () => undefined }
    const onConfirm = vi.fn(() => {
      ref.reset('/project/a.ts')
      return true
    })
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, { getOpenFile: () => file.current, onConfirm })
    )
    ref.reset = result.current.resetForFileChange
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteChecked).toHaveBeenCalledTimes(1)
    expect(file.current?.savedContent).toBe('base')
  })

  // ぶら下がったシンボリックリンクのパスでは、照合しない書き込み(基準 null)も main が毎回 conflict(modified)を返す
  // (排他的作成が EEXIST になる。リンクを辿ってフォルダの外へ作らないための安全側)。確認を繰り返さず、理由を示して止める
  it('OK の後の照合しない書き込みも conflict なら、確認を繰り返さず、保存できなかった理由を示して止める', async () => {
    mockWriteChecked
      .mockResolvedValueOnce({ kind: 'conflict', reason: 'deleted' })
      .mockResolvedValueOnce({ kind: 'conflict', reason: 'modified' })
    const onConfirm = vi.fn(() => true)
    const onSaveConflict = vi.fn()
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, {
        getOpenFile: () => file.current,
        onConfirm,
        onSaveConflict
      })
    )
    await act(async () => {
      await result.current.saveFile()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(mockWriteChecked).toHaveBeenCalledTimes(2)
    expect(file.current?.savedContent).toBe('base')
    expect(result.current.saveError?.message).toBe(SAVE_CONFLICT_OVERWRITE_FAILED_MESSAGE)
    expect(onSaveConflict).not.toHaveBeenCalled()
  })

  // 保存できたらディスクはタブの内容と同じなので、外部変更の印を消せる(監視に届かないシンボリックリンクのタブでも)
  it.each([
    ['照合が通った', true, [{ kind: 'written' }]],
    [
      '確認で OK して上書きした',
      true,
      [{ kind: 'conflict', reason: 'modified' }, { kind: 'written' }]
    ],
    ['確認でキャンセルした', false, [{ kind: 'conflict', reason: 'modified' }]],
    [
      'OK の後の書き込みも conflict だった',
      false,
      [
        { kind: 'conflict', reason: 'deleted' },
        { kind: 'conflict', reason: 'modified' }
      ]
    ]
  ] as const)(
    '%s とき、保存の成功の通知(onSaveSucceeded)を呼ぶか: %s',
    async (_label, succeeded, results) => {
      for (const r of results) mockWriteChecked.mockResolvedValueOnce(r)
      const onSaveSucceeded = vi.fn()
      const file = holder(dirty)
      const { result } = renderHook(() =>
        useFileEditing(file.current, file.set, {
          getOpenFile: () => file.current,
          onConfirm: () => results.length > 1,
          onSaveSucceeded
        })
      )
      await act(async () => {
        await result.current.saveFile()
      })
      expect(onSaveSucceeded.mock.calls).toEqual(succeeded ? [['/project/a.ts']] : [])
    }
  )

  it('書き込みの間にタブが開き直されたら(世代が変わったら)、保存の成功の通知を呼ばない', async () => {
    let finishWrite: (value: { kind: 'written' }) => void = () => undefined
    mockWriteChecked.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWrite = resolve
        })
    )
    const onSaveSucceeded = vi.fn()
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, { getOpenFile: () => file.current, onSaveSucceeded })
    )
    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = result.current.saveFile()
    })
    await act(async () => {
      result.current.resetForFileChange('/project/a.ts')
      finishWrite({ kind: 'written' })
      await saving
    })
    expect(onSaveSucceeded).not.toHaveBeenCalled()
  })
})

describe('saveConflictMessage', () => {
  it('ディスクで変更されていたら、上書きの確認の文言', () => {
    expect(saveConflictMessage('modified')).toBe(
      'このファイルは、最後に読み込んだ後にディスク上で変更されています（エージェントなどによる変更）。上書きして保存すると、その変更は失われます。上書きして保存しますか？'
    )
  })

  it('ディスクから削除されていたら、作成し直す確認の文言', () => {
    expect(saveConflictMessage('deleted')).toBe(
      'このファイルは、ディスク上で削除されています。保存すると、もう一度作成されます。保存しますか？'
    )
  })
})
