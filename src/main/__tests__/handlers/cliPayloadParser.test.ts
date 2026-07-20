import { describe, it, expect } from 'vitest'
import { parseCliPayload } from '../../handlers/cliPayloadParser'

describe('parseCliPayload', () => {
  describe('正常系', () => {
    it('toolId と promptContent が文字列のとき正常に返す', () => {
      const result = parseCliPayload({
        requestId: 'req-1',
        toolId: 'claude',
        promptContent: 'テスト'
      })
      expect(result.requestId).toBe('req-1')
      expect(result.toolId).toBe('claude')
      expect(result.promptContent).toBe('テスト')
    })

    it('余分なプロパティがあっても toolId と promptContent を返す', () => {
      const result = parseCliPayload({
        requestId: 'req-1',
        toolId: 'copilot',
        promptContent: 'テスト',
        extra: 'ignored'
      })
      expect(result).toEqual({ requestId: 'req-1', toolId: 'copilot', promptContent: 'テスト' })
    })
  })

  describe('異常系 — payload 型', () => {
    it('payload が null のとき例外をスロー', () => {
      expect(() => parseCliPayload(null)).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が undefined のとき例外をスロー', () => {
      expect(() => parseCliPayload(undefined)).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が文字列のとき例外をスロー', () => {
      expect(() => parseCliPayload('string payload')).toThrow(
        '引数はオブジェクトである必要があります'
      )
    })

    it('payload が数値のとき例外をスロー', () => {
      expect(() => parseCliPayload(42)).toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が配列のとき例外をスロー', () => {
      expect(() => parseCliPayload([])).toThrow('引数はオブジェクトである必要があります')
    })
  })

  describe('異常系 — requestId', () => {
    it('requestId が省略されたとき例外をスロー', () => {
      expect(() => parseCliPayload({ toolId: 'claude', promptContent: 'テスト' })).toThrow(
        'requestId は空でない文字列である必要があります'
      )
    })

    it('requestId が数値のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 123, toolId: 'claude', promptContent: 'テスト' })
      ).toThrow('requestId は空でない文字列である必要があります')
    })

    it('requestId が空白のみのとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: '   ', toolId: 'claude', promptContent: 'テスト' })
      ).toThrow('requestId は空でない文字列である必要があります')
    })
  })

  describe('異常系 — toolId', () => {
    it('toolId が数値のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 123, promptContent: 'テスト' })
      ).toThrow('toolId は文字列である必要があります')
    })

    it('toolId が undefined（存在しない）のとき例外をスロー', () => {
      expect(() => parseCliPayload({ requestId: 'req-1', promptContent: 'テスト' })).toThrow(
        'toolId は文字列である必要があります'
      )
    })

    it('toolId が null のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: null, promptContent: 'テスト' })
      ).toThrow('toolId は文字列である必要があります')
    })

    it("toolId が 'api' のとき例外をスロー（CLI ハンドラーでは無効な値）", () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 'api', promptContent: 'テスト' })
      ).toThrow("toolId は 'claude' または 'copilot' である必要があります（受け取った値: api）")
    })

    it('不明な文字列 toolId のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 'unknown-tool', promptContent: 'テスト' })
      ).toThrow(
        "toolId は 'claude' または 'copilot' である必要があります（受け取った値: unknown-tool）"
      )
    })
  })

  describe('異常系 — promptContent', () => {
    it('promptContent が数値のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 'claude', promptContent: 123 })
      ).toThrow('promptContent は文字列である必要があります')
    })

    it('promptContent が undefined（存在しない）のとき例外をスロー', () => {
      expect(() => parseCliPayload({ requestId: 'req-1', toolId: 'claude' })).toThrow(
        'promptContent は文字列である必要があります'
      )
    })

    it('promptContent が null のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 'claude', promptContent: null })
      ).toThrow('promptContent は文字列である必要があります')
    })

    it('promptContent が空文字列のとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 'claude', promptContent: '' })
      ).toThrow('promptContent は空文字列にできません')
    })

    it('promptContent が空白のみのとき例外をスロー', () => {
      expect(() =>
        parseCliPayload({ requestId: 'req-1', toolId: 'claude', promptContent: '   ' })
      ).toThrow('promptContent は空文字列にできません')
    })
  })
})
