import { describe, it, expect } from 'vitest'
import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_PROMPT_MAX_LENGTH,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '../agentPasteText'

describe('normalizeAgentPrompt', () => {
  it.each([
    ['\\r\\n を \\n にする', 'a\r\nb', 'a\nb'],
    ['単独の \\r を \\n にする', 'a\rb', 'a\nb'],
    ['\\n と \\t は残す', 'a\n\tb', 'a\n\tb'],
    ['ESC を取り除く(ESC[201~ の囲みの終わりを無効にする)', 'a\x1b[201~\rb', 'a[201~\nb'],
    ['C0 制御文字を取り除く', 'a\x00\x07\x08\x0b\x0c\x1fb', 'ab'],
    ['DEL を取り除く', 'a\x7fb', 'ab'],
    ['C1 制御文字(U+0080〜U+009F)を取り除く', 'a\x80\x9bb\x9f', 'ab'],
    ['U+00A0 は残す(C1 の範囲の外)', 'a\xa0b', 'a\xa0b'],
    ['日本語とサロゲートペアは残す', '日本語😀', '日本語😀'],
    ['先頭が空白の「!」は通す', ' !echo', ' !echo'],
    ['先頭が改行の「!」は通す', '\n!echo', '\n!echo'],
    ['先頭が「/」は通す', '/help', '/help']
  ])('%s', (_label, raw, expected) => {
    expect(normalizeAgentPrompt(raw)).toEqual({ kind: 'ok', text: expected })
  })

  it.each([
    ['空文字列', ''],
    ['空白と改行だけ', ' \n\t\r\n '],
    ['制御文字を除くと空白だけ', '\x1b\x07 ']
  ])('%s は empty で拒否する', (_label, raw) => {
    expect(normalizeAgentPrompt(raw)).toEqual({ kind: 'rejected', reason: 'empty' })
  })

  it('上限ちょうどは通し、1 文字超えると too-long で拒否する', () => {
    expect(normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH)).kind).toBe('ok')
    expect(normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH + 1))).toEqual({
      kind: 'rejected',
      reason: 'too-long'
    })
  })

  it('上限は正規化の後の長さで数える(\\r\\n は 1 文字になる)', () => {
    const raw = 'a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n'
    expect(normalizeAgentPrompt(raw).kind).toBe('ok')
  })

  it('1 文字目が「!」なら leading-bang で拒否する', () => {
    expect(normalizeAgentPrompt('!echo hi')).toEqual({ kind: 'rejected', reason: 'leading-bang' })
  })

  it('制御文字を除いた後の 1 文字目が「!」でも拒否する', () => {
    expect(normalizeAgentPrompt('\x1b!rm')).toEqual({ kind: 'rejected', reason: 'leading-bang' })
  })
})

describe('buildAgentPasteBytes', () => {
  it('本文を ESC[200~ と ESC[201~ で囲む', () => {
    expect(buildAgentPasteBytes('a\nb')).toBe('\x1b[200~a\nb\x1b[201~')
  })
})

describe('送るキーの定数', () => {
  it('消去は Ctrl+K × 12 + Ctrl+U × 12 の 24 バイト', () => {
    expect(AGENT_CLEAR_INPUT_CHUNK).toBe('\x0b'.repeat(12) + '\x15'.repeat(12))
    expect(AGENT_CLEAR_INPUT_CHUNK).toHaveLength(24)
  })

  it('送信は \\r', () => {
    expect(AGENT_SUBMIT_KEY).toBe('\r')
  })
})
