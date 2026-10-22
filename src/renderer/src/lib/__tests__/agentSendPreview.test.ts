import { describe, it, expect } from 'vitest'
import { AGENT_PROMPT_MAX_LENGTH } from '@shared/agentPasteText'
import { agentSendFailureMessage } from '../agentSendMessages'
import { buildAgentSendPreview } from '../agentSendPreview'

describe('buildAgentSendPreview', () => {
  it('正規化した後の本文と長さを返し、送れる(理由は null)', () => {
    expect(buildAgentSendPreview('a\r\nb\x1b', 'claude')).toEqual({
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
    expect(buildAgentSendPreview(raw, 'claude').rejection).toBe(
      agentSendFailureMessage(reason, 'claude')
    )
  })

  it('先頭が「!」でも、正規化した後の本文と長さを返す', () => {
    const preview = buildAgentSendPreview('!ls\r\n', 'claude')
    expect(preview.text).toBe('!ls\n')
    expect(preview.length).toBe(4)
  })

  it('正規化した後の長さが上限ちょうどなら送れる(\\r\\n は 1 文字に数える)', () => {
    const preview = buildAgentSendPreview(
      'a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n',
      'claude'
    )
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH)
    expect(preview.rejection).toBeNull()
  })

  it('正規化した後の長さが上限を超えたら長すぎる(長さも返す)', () => {
    const preview = buildAgentSendPreview('a'.repeat(AGENT_PROMPT_MAX_LENGTH) + '\r\n', 'claude')
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH + 1)
    expect(preview.rejection).toBe(agentSendFailureMessage('too-long', 'claude'))
  })
})

describe('buildAgentSendPreview(送り先が copilot)', () => {
  it.each([
    ['/help', 'leading-slash'],
    ['  /help', 'leading-slash'],
    ['!ls', 'leading-bang']
  ] as const)('%j は copilot の理由を出す', (raw, reason) => {
    expect(buildAgentSendPreview(raw, 'copilot').rejection).toBe(
      agentSendFailureMessage(reason, 'copilot')
    )
  })

  it.each(['look at @file', '本文\n\n参照:\n- @src/app.ts'])(
    '%j は理由を出さない(末尾の @ の語は送れる)',
    (raw) => {
      expect(buildAgentSendPreview(raw, 'copilot').rejection).toBeNull()
    }
  )

  // 末尾の @ の語の後ろに足す空白は貼るバイト列だけ(copilotPromptSend の buildCopilotPasteText)。確認に出す本文と文字数は
  // 利用者の本文のまま(設計書 2026-10-22「末尾の @ の語」)
  it.each(['look at @file', '本文\n\n参照:\n- @src/app.ts'])(
    '%j の本文と文字数は利用者の本文のまま(末尾に空白を足さない)',
    (raw) => {
      expect(buildAgentSendPreview(raw, 'copilot')).toEqual({
        text: raw,
        length: raw.length,
        rejection: null
      })
    }
  )

  it('claude の送り先なら /help は今までどおり送れる', () => {
    expect(buildAgentSendPreview('/help', 'claude').rejection).toBeNull()
  })
})
