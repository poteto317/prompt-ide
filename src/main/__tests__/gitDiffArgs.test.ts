import { describe, it, expect } from 'vitest'
import { PATCH_FORMAT_ARGS } from '../gitDiffArgs'

describe('PATCH_FORMAT_ARGS', () => {
  it('外部 diff・textconv・色を打ち消し、a/ b/ の接頭辞を固定する', () => {
    expect(PATCH_FORMAT_ARGS).toEqual([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/'
    ])
  })
})
