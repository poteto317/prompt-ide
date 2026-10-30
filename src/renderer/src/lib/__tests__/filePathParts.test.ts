import { describe, it, expect } from 'vitest'
import { splitFilePath } from '../filePathParts'

describe('splitFilePath', () => {
  it('直下のファイルはフォルダが空になる', () => {
    expect(splitFilePath('README.md')).toEqual({ name: 'README.md', dir: '' })
  })

  it('フォルダの中のファイルは最後の / で分ける', () => {
    expect(splitFilePath('src/renderer/main.ts')).toEqual({
      name: 'main.ts',
      dir: 'src/renderer'
    })
  })

  it('日本語のパスも分ける', () => {
    expect(splitFilePath('資料/設計 書.md')).toEqual({ name: '設計 書.md', dir: '資料' })
  })

  // git status は未追跡のフォルダを末尾の / 付きで返す。名前が空にならず、フォルダと分かる形で残す
  it('末尾が / のパスは、最後のフォルダを / 付きの名前にする', () => {
    expect(splitFilePath('src/generated/')).toEqual({ name: 'generated/', dir: 'src' })
    expect(splitFilePath('dist/')).toEqual({ name: 'dist/', dir: '' })
  })

  it('空のパスは名前もフォルダも空になる', () => {
    expect(splitFilePath('')).toEqual({ name: '', dir: '' })
  })
})
