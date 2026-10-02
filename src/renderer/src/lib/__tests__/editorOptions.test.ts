import { describe, it, expect } from 'vitest'
import { editorOptions } from '../editorOptions'

describe('editorOptions', () => {
  it('Monaco Editor の基本表示設定が正しく定義されている', () => {
    expect(editorOptions.fontSize).toBe(14)
    expect(editorOptions.fontFamily).toContain('monospace')
    expect(editorOptions.minimap).toEqual({ enabled: false })
    expect(editorOptions.tabSize).toBe(2)
    expect(editorOptions.lineNumbers).toBe('on')
    expect(editorOptions.automaticLayout).toBe(true)
  })
})
