import { describe, it, expect } from 'vitest'
import { parseModelSettingsPayload } from '../../handlers/settingsPayloadParser'

describe('parseModelSettingsPayload', () => {
  it('正常な payload をそのまま返す', () => {
    const result = parseModelSettingsPayload({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
    expect(result).toEqual({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
  })

  it('payload が null のとき例外をスロー', () => {
    expect(() => parseModelSettingsPayload(null)).toThrow('引数はオブジェクトである必要があります')
  })

  it('payload が配列のとき例外をスロー', () => {
    expect(() => parseModelSettingsPayload([])).toThrow('引数はオブジェクトである必要があります')
  })

  it('modelId が文字列でないとき例外をスロー', () => {
    expect(() => parseModelSettingsPayload({ modelId: 123, maxTokens: 100 })).toThrow(
      'modelId は文字列である必要があります'
    )
  })

  it('modelId が未知の値のとき例外をスロー', () => {
    expect(() => parseModelSettingsPayload({ modelId: 'unknown-model', maxTokens: 100 })).toThrow(
      'modelId は'
    )
  })

  it('modelId が未知の値のときエラーメッセージの括弧は全角で統一されている(半角・全角混在の表記ゆれ防止)', () => {
    expect(() => parseModelSettingsPayload({ modelId: 'unknown-model', maxTokens: 100 })).toThrow(
      '（受け取った値: unknown-model）'
    )
  })

  it('maxTokens が数値でないとき例外をスロー', () => {
    expect(() =>
      parseModelSettingsPayload({ modelId: 'claude-haiku-4-5', maxTokens: '100' })
    ).toThrow('maxTokens は整数である必要があります')
  })

  it('maxTokens が整数でないとき例外をスロー', () => {
    expect(() =>
      parseModelSettingsPayload({ modelId: 'claude-haiku-4-5', maxTokens: 1.5 })
    ).toThrow('maxTokens は整数である必要があります')
  })
})
