import { describe, it, expect } from 'vitest'
import { AGENT_PROMPT_MAX_LENGTH } from '@shared/agentPasteText'
import { AGENT_SEND_FAILURE_MESSAGES } from '../agentSendMessages'
import { buildAgentSendPreview } from '../agentSendPreview'

describe('buildAgentSendPreview', () => {
  it('正規化した後の本文と長さを返し、送れる(理由は null)', () => {
    expect(buildAgentSendPreview('a\r\nb\x1b')).toEqual({
      text: 'a\nb',
      length: 3,
      rejection: null
    })
  })

  it.each([
    ['空', '', 'empty'],
    ['空白と改行だけ', '  \n\t', 'empty'],
    ['先頭が「!」', '!ls', 'leading-bang'],
    ['制御文字を除くと先頭が「!」', '\x1b!rm', 'leading-bang']
  ] as const)('%s なら、既存の文言を理由にする', (_label, raw, reason) => {
    expect(buildAgentSendPreview(raw).rejection).toBe(AGENT_SEND_FAILURE_MESSAGES[reason])
  })

  it('先頭が「!」でも、正規化した後の本文と長さを返す', () => {
    const preview = buildAgentSendPreview('!ls\r\n')
    expect(preview.text).toBe('!ls\n')
    expect(preview.length).toBe(4)
  })

  it('正規化した後の長さが上限ちょうどなら送れる(\\r\\n は 1 文字に数える)', () => {
    const preview = buildAgentSendPreview('a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n')
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH)
    expect(preview.rejection).toBeNull()
  })

  it('正規化した後の長さが上限を超えたら長すぎる(長さも返す)', () => {
    const preview = buildAgentSendPreview('a'.repeat(AGENT_PROMPT_MAX_LENGTH) + '\r\n')
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH + 1)
    expect(preview.rejection).toBe(AGENT_SEND_FAILURE_MESSAGES['too-long'])
  })
})
