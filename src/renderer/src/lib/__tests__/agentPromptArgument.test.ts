import { describe, it, expect } from 'vitest'
import { appendAgentPromptArgument } from '../agentPromptArgument'

describe('appendAgentPromptArgument', () => {
  it('引数が空なら本文を 1 文字も変えない', () => {
    expect(appendAgentPromptArgument('/review \n', '')).toBe('/review \n')
    expect(appendAgentPromptArgument('/review \n', '   ')).toBe('/review \n')
  })

  it('本文の直後へ半角空白 1 つで繋ぐ', () => {
    expect(appendAgentPromptArgument('/review', '123')).toBe('/review 123')
  })

  it('本文の末尾の空白・改行と、引数の前後の空白を除く', () => {
    expect(appendAgentPromptArgument('/review \n\n', '  123  ')).toBe('/review 123')
  })

  it('本文が空なら引数だけになる', () => {
    expect(appendAgentPromptArgument('', '123')).toBe('123')
    expect(appendAgentPromptArgument(' \n', '123')).toBe('123')
  })
})
