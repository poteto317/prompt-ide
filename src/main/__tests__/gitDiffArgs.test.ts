import { describe, it, expect } from 'vitest'
import { PATCH_FORMAT_ARGS, PATCH_FORMAT_CONFIG } from '../gitDiffArgs'

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

describe('PATCH_FORMAT_CONFIG', () => {
  it('diff のオプションで打ち消せない diff.suppressBlankEmpty を -c で打ち消す', () => {
    expect(PATCH_FORMAT_CONFIG).toEqual(['diff.suppressBlankEmpty=false'])
  })
})
