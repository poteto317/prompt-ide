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

  it('空文字列ファイル名は plaintext を返す', () => {
    expect(detectLanguage('')).toBe('plaintext')
  })

  it('ドットで終わるファイル名（拡張子なし）は plaintext を返す', () => {
    // 'file.'.split('.').pop() === '' → EXT_LANGUAGE[''] は undefined → 'plaintext'
    expect(detectLanguage('file.')).toBe('plaintext')
  })
})
