import { describe, it, expect, vi } from 'vitest'
import { registerSaveCommand } from '../editorShortcuts'

describe('registerSaveCommand', () => {
  it('Cmd/Ctrl+S のキーバインドで addCommand を呼ぶ', () => {
    const addCommand = vi.fn()
    const editorInstance = { addCommand } as unknown as Parameters<typeof registerSaveCommand>[0]
    const monaco = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { KeyS: 49 }
    } as unknown as Parameters<typeof registerSaveCommand>[1]
    const onSave = vi.fn()

    registerSaveCommand(editorInstance, monaco, onSave)

    expect(addCommand).toHaveBeenCalledWith(2048 | 49, onSave)
  })
})
