import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { runEditorSyncedOperation } from '../editorSyncedOperation'

const setup = (
  overrides: Partial<{
    confirm: () => boolean
    operation: () => Promise<boolean>
    reload: () => Promise<void>
  }> = {}
): {
  calls: string[]
  confirmDiscardAnyDirty: Mock<() => boolean>
  operation: Mock<() => Promise<boolean>>
  reloadOpenFiles: Mock<() => Promise<void>>
} => {
  const calls: string[] = []
  const confirmDiscardAnyDirty = vi.fn(
    overrides.confirm ??
      (() => {
        calls.push('confirm')
        return true
      })
  )
  const operation = vi.fn(
    overrides.operation ??
      (async () => {
        calls.push('operation')
        return true
      })
  )
  const reloadOpenFiles = vi.fn(
    overrides.reload ??
      (async () => {
        calls.push('reload')
      })
  )
  return { calls, confirmDiscardAnyDirty, operation, reloadOpenFiles }
}

describe('runEditorSyncedOperation', () => {
  it('破棄の確認が false なら operation も reloadOpenFiles も呼ばない', async () => {
    const s = setup({ confirm: () => false })
    await runEditorSyncedOperation(s)
    expect(s.operation).not.toHaveBeenCalled()
    expect(s.reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('確認が true で operation が true なら、operation の後に reloadOpenFiles を呼ぶ', async () => {
    const s = setup()
    await runEditorSyncedOperation(s)
    expect(s.calls).toEqual(['confirm', 'operation', 'reload'])
  })

  it('operation が false なら reloadOpenFiles を呼ばない', async () => {
    const s = setup({ operation: async () => false })
    await runEditorSyncedOperation(s)
    expect(s.operation).toHaveBeenCalledTimes(1)
    expect(s.reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('operation が reject したら例外は伝播し、reloadOpenFiles は呼ばれない', async () => {
    const s = setup({ operation: () => Promise.reject(new Error('boom')) })
    await expect(runEditorSyncedOperation(s)).rejects.toThrow('boom')
    expect(s.reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('reloadOpenFiles が reject したら例外は伝播する', async () => {
    const s = setup({ reload: () => Promise.reject(new Error('reload failed')) })
    await expect(runEditorSyncedOperation(s)).rejects.toThrow('reload failed')
  })
})
