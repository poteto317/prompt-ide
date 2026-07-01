import { describe, it, expect } from 'vitest'
import { buildPromptContent } from '../promptUtils'

describe('buildPromptContent', () => {
  it('fileContent が null のとき promptContent をそのまま返す', () => {
    expect(buildPromptContent('プロンプト', null)).toBe('プロンプト')
  })

  it('fileContent が文字列のとき --- セパレーターで結合する', () => {
    expect(buildPromptContent('プロンプト', 'ファイル内容')).toBe('プロンプト\n\n---\n\nファイル内容')
  })

  it('fileContent が空文字のときも結合する', () => {
    expect(buildPromptContent('プロンプト', '')).toBe('プロンプト\n\n---\n\n')
  })

  it('promptContent が空文字でも正しく結合する', () => {
    expect(buildPromptContent('', 'ファイル内容')).toBe('\n\n---\n\nファイル内容')
  })
})
