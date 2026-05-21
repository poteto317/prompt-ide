import { describe, it, expect } from 'vitest'
import { truncatePreview } from '../promptUtils'
import { PREVIEW_MAX } from '../../config/promptConfig'

describe('truncatePreview', () => {
  it('50文字未満のコンテンツはそのまま返す', () => {
    const content = 'a'.repeat(49)
    expect(truncatePreview(content)).toBe(content)
  })

  it('50文字ちょうどはそのまま返す', () => {
    const content = 'x'.repeat(50)
    expect(truncatePreview(content)).toBe(content)
  })

  it('51文字以上は50文字 + … に切り詰める', () => {
    const content = 'a'.repeat(51)
    expect(truncatePreview(content)).toBe('a'.repeat(50) + '…')
  })

  it('100文字のコンテンツは50文字 + … に切り詰める', () => {
    const content = 'b'.repeat(100)
    expect(truncatePreview(content)).toBe('b'.repeat(50) + '…')
  })

  it('空文字列は空文字列を返す', () => {
    expect(truncatePreview('')).toBe('')
  })

  it(`PREVIEW_MAX(${PREVIEW_MAX})文字の ASCII + 絵文字 = ${PREVIEW_MAX}グラフェムは切り詰めない`, () => {
    // ASCII 49文字 + 絵文字 1グラフェム = 50グラフェム（UTF-16 では51コードユニット）
    // slice ベースの実装では length > 50 となり誤って切り詰めてしまう
    const content = 'a'.repeat(PREVIEW_MAX - 1) + '👋'
    expect(truncatePreview(content)).toBe(content)
  })

  it('境界をまたぐ絵文字（サロゲートペア）を分断せず切り詰める', () => {
    // ASCII 49文字 + 絵文字 + ASCII 1文字 = 51グラフェム → 先頭50グラフェムに切り詰め
    // slice ベースでは slice(0,50) により絵文字の前半サロゲートだけ残り文字化けする
    const content = 'a'.repeat(PREVIEW_MAX - 1) + '👋' + 'b'
    const result = truncatePreview(content)
    expect(result).toBe('a'.repeat(PREVIEW_MAX - 1) + '👋' + '…')
  })

  it('ZWJ結合絵文字（複数コードポイントで1グラフェム）を分断せず切り詰める', () => {
    // '👨‍👩‍👧‍👦' は複数コードポイント + ZWJ で 1グラフェムクラスタ
    // ASCII 49文字 + ZWJ絵文字 + ASCII 1文字 = 51グラフェム → 先頭50グラフェムに切り詰め
    const family = '👨‍👩‍👧‍👦'
    const content = 'a'.repeat(PREVIEW_MAX - 1) + family + 'b'
    const result = truncatePreview(content)
    expect(result).toBe('a'.repeat(PREVIEW_MAX - 1) + family + '…')
  })

  it('日本語文字列（マルチバイト）を正しく切り詰める', () => {
    // 日本語文字は UTF-16 で1コードユニット（BMP内）なので slice でも動作するが念のため確認
    const content = 'あ'.repeat(51)
    expect(truncatePreview(content)).toBe('あ'.repeat(50) + '…')
  })
})

