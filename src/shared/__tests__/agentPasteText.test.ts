import { describe, it, expect } from 'vitest'
import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_PROMPT_MAX_LENGTH,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  cleanAgentPromptText,
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
    expect(normalizeAgentPrompt(raw, 'claude')).toEqual({ kind: 'ok', text: expected })
  })

  it.each([
    ['空文字列', ''],
    ['空白と改行だけ', ' \n\t\r\n '],
    ['制御文字を除くと空白だけ', '\x1b\x07 ']
  ])('%s は empty で拒否する', (_label, raw) => {
    expect(normalizeAgentPrompt(raw, 'claude')).toEqual({ kind: 'rejected', reason: 'empty' })
  })

  it('上限ちょうどは通し、1 文字超えると too-long で拒否する', () => {
    expect(normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH), 'claude').kind).toBe('ok')
    expect(normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH + 1), 'claude')).toEqual({
      kind: 'rejected',
      reason: 'too-long'
    })
  })

  it('上限は正規化の後の長さで数える(\\r\\n は 1 文字になる)', () => {
    const raw = 'a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n'
    expect(normalizeAgentPrompt(raw, 'claude').kind).toBe('ok')
  })

  it('1 文字目が「!」なら leading-bang で拒否する', () => {
    expect(normalizeAgentPrompt('!echo hi', 'claude')).toEqual({
      kind: 'rejected',
      reason: 'leading-bang'
    })
  })

  it('制御文字を除いた後の 1 文字目が「!」でも拒否する', () => {
    expect(normalizeAgentPrompt('\x1b!rm', 'claude')).toEqual({
      kind: 'rejected',
      reason: 'leading-bang'
    })
  })
})

describe('normalizeAgentPrompt(種類ごとの規則。AGENT_PROMPT_TEXT_RULES)', () => {
  it.each([
    ['先頭が「!」', '!ls', 'leading-bang'],
    ['先頭が「/」', '/help', 'leading-slash'],
    ['先頭の空白の後の「!」', '  !ls', 'leading-bang'],
    ['先頭の空白の後の「/」', '  /help', 'leading-slash'],
    // 先頭の改行・タブも空白として除く(記録していない形は送る側に倒さない)
    ['先頭の改行・タブの後の「/」', '\n\t/help', 'leading-slash'],
    ['先頭の改行の後の「!」', '\n!ls', 'leading-bang'],
    ['制御文字を除いた後に先頭へ来る「!」(L-083)', '\x1b!ls', 'leading-bang']
  ] as const)('copilot: %s は断る', (_label, raw, reason) => {
    expect(normalizeAgentPrompt(raw, 'copilot')).toEqual({ kind: 'rejected', reason })
  })

  it.each([
    'x!ls',
    'run /help',
    '?why',
    '# heading',
    'fix #12',
    'say hi!',
    'look at @file',
    '@',
    '本文\n\n参照:\n- @src/app.ts'
  ])('copilot: %j は通す(行の途中の !・/、末尾の @ の語は断らない)', (raw) => {
    expect(normalizeAgentPrompt(raw, 'copilot')).toEqual({ kind: 'ok', text: raw })
  })

  it('claude は今までどおり 1 文字目の「!」だけを断り、「/」・先頭の空白の後の「!」は通す', () => {
    expect(normalizeAgentPrompt('/help', 'claude')).toEqual({ kind: 'ok', text: '/help' })
    expect(normalizeAgentPrompt('  !ls', 'claude')).toEqual({ kind: 'ok', text: '  !ls' })
    expect(normalizeAgentPrompt('!ls', 'claude')).toEqual({
      kind: 'rejected',
      reason: 'leading-bang'
    })
  })

  it('判定の順は 空 → 長すぎる → 種類の規則(先頭が「/」でも空白だけ・長すぎるならそちら)', () => {
    expect(normalizeAgentPrompt('  \n', 'copilot')).toEqual({ kind: 'rejected', reason: 'empty' })
    expect(normalizeAgentPrompt('/' + 'a'.repeat(AGENT_PROMPT_MAX_LENGTH), 'copilot')).toEqual({
      kind: 'rejected',
      reason: 'too-long'
    })
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

describe('cleanAgentPromptText', () => {
  it('改行を \\n にそろえ、改行・タブ以外の制御文字を除く(拒否の判定はしない)', () => {
    expect(cleanAgentPromptText('!a\r\nb\rc\td\x1b[201~\x7f')).toBe('!a\nb\nc\td[201~')
  })

  it('normalizeAgentPrompt が ok のときの text と同じ', () => {
    const raw = 'line1\r\nline2\x07'
    expect(normalizeAgentPrompt(raw, 'claude')).toEqual({
      kind: 'ok',
      text: cleanAgentPromptText(raw)
    })
  })
})
