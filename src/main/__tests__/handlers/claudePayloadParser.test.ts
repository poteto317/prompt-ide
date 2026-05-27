import { describe, it, expect } from 'vitest'
import { parseClaudePayload } from '../../handlers/claudePayloadParser'

describe('parseClaudePayload', () => {
  describe('正常系', () => {
    it('promptContent と fileContent が文字列のとき正常に返す', () => {
      const result = parseClaudePayload({ promptContent: 'hello', fileContent: 'code content' })
      expect(result.promptContent).toBe('hello')
      expect(result.fileContent).toBe('code content')
    })

    it('fileContent が null のとき正常に返す', () => {
      const result = parseClaudePayload({ promptContent: 'hello', fileContent: null })
      expect(result.promptContent).toBe('hello')
      expect(result.fileContent).toBeNull()
    })

    it('余分なプロパティがあっても promptContent と fileContent を返す', () => {
      const result = parseClaudePayload({
        promptContent: 'hi',
        fileContent: null,
        extra: 'ignored',
      })
      expect(result).toEqual({ promptContent: 'hi', fileContent: null })
    })
  })

  describe('異常系 — payload 型', () => {
    it('payload が null のとき例外をスロー', () => {
      expect(() => parseClaudePayload(null)).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が undefined のとき例外をスロー', () => {
      expect(() => parseClaudePayload(undefined)).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が文字列のとき例外をスロー', () => {
      expect(() => parseClaudePayload('string payload')).toThrow(
        '引数はオブジェクトである必要があります'
      )
    })

    it('payload が数値のとき例外をスロー', () => {
      expect(() => parseClaudePayload(42)).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が配列のとき例外をスロー', () => {
      expect(() => parseClaudePayload([])).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が要素入り配列のとき例外をスロー', () => {
      expect(() => parseClaudePayload([{ promptContent: 'hi', fileContent: null }])).toThrow(
        '引数はオブジェクトである必要があります'
      )
    })
  })

  describe('異常系 — promptContent', () => {
    it('promptContent が数値のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ promptContent: 123, fileContent: null })).toThrow(
        'promptContent は文字列である必要があります'
      )
    })

    it('promptContent が undefined（存在しない）のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ fileContent: null })).toThrow(
        'promptContent は文字列である必要があります'
      )
    })

    it('promptContent が null のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ promptContent: null, fileContent: null })).toThrow(
        'promptContent は文字列である必要があります'
      )
    })
  })

  describe('異常系 — fileContent', () => {
    it('fileContent が数値のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ promptContent: 'hello', fileContent: 42 })).toThrow(
        'fileContent は文字列または null である必要があります'
      )
    })

    it('fileContent が配列のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ promptContent: 'hello', fileContent: [] })).toThrow(
        'fileContent は文字列または null である必要があります'
      )
    })

    it('fileContent が true のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ promptContent: 'hello', fileContent: true })).toThrow(
        'fileContent は文字列または null である必要があります'
      )
    })

    it('fileContent が省略された（undefined）のとき例外をスロー', () => {
      expect(() => parseClaudePayload({ promptContent: 'hello' })).toThrow(
        'fileContent は文字列または null である必要があります'
      )
    })
  })
})
