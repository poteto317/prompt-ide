import { describe, it, expect } from 'vitest'
import { EXT_LANGUAGE, detectLanguage } from '../languageDetector'

describe('detectLanguage', () => {
  it.each(Object.entries(EXT_LANGUAGE))('".%s" → "%s"', (ext, expectedLang) => {
    expect(detectLanguage(`file.${ext}`)).toBe(expectedLang)
  })

  it('未知の拡張子は plaintext を返す', () => {
    expect(detectLanguage('archive.tar')).toBe('plaintext')
    expect(detectLanguage('Makefile')).toBe('plaintext')
  })

  it('拡張子なしのファイルは plaintext を返す', () => {
    expect(detectLanguage('Dockerfile')).toBe('plaintext')
  })

  it('拡張子の大文字・小文字を区別しない', () => {
    expect(detectLanguage('index.TS')).toBe('typescript')
    expect(detectLanguage('style.CSS')).toBe('css')
  })
})
