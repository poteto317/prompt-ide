import { describe, it, expect } from 'vitest'
import { editorOptions } from '../editorOptions'

describe('editorOptions', () => {
  it('エディタの文字サイズは 15px', () => {
    expect(editorOptions.fontSize).toBe(15)
  })
})
