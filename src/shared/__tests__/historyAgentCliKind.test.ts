import { describe, it, expect } from 'vitest'
import {
  HISTORY_AGENT_CLI_KIND_PATTERN,
  LEGACY_AGENT_HISTORY_CLI_KIND,
  isHistoryAgentCliKindValue,
  knownAgentCliKindOf
} from '../historyAgentCliKind'

describe('isHistoryAgentCliKindValue(履歴に保てる種類の値)', () => {
  it.each(['claude', 'copilot', 'gemini', 'a', `a${'b'.repeat(31)}`, 'gemini-2', 'x1'])(
    '%s は形が正しい(知らない種類も保つ)',
    (value) => {
      expect(isHistoryAgentCliKindValue(value)).toBe(true)
    }
  )

  it.each<[string, unknown]>([
    ['空', ''],
    ['大文字を含む', 'Gemini'],
    ['数字で始まる', '1abc'],
    ['ハイフンで始まる', '-gemini'],
    ['33 文字', `a${'b'.repeat(32)}`],
    ['空白を含む', 'gem ini'],
    ['下線を含む', 'gem_ini'],
    ['数', 1],
    ['null', null],
    ['undefined', undefined]
  ])('%s は形が正しくない', (_label, value) => {
    expect(isHistoryAgentCliKindValue(value)).toBe(false)
  })

  it('形の規則は英小文字で始まる 1〜32 文字の英小文字・数字・ハイフン', () => {
    expect(HISTORY_AGENT_CLI_KIND_PATTERN.source).toBe('^[a-z][a-z0-9-]{0,31}$')
  })
})

describe('knownAgentCliKindOf(この版が知っている種類として読む)', () => {
  it('claude・copilot はその値、知らない種類(gemini)は null', () => {
    expect(knownAgentCliKindOf({ cliKind: 'claude' })).toBe('claude')
    expect(knownAgentCliKindOf({ cliKind: 'copilot' })).toBe('copilot')
    expect(knownAgentCliKindOf({ cliKind: 'gemini' })).toBeNull()
  })
})

describe('LEGACY_AGENT_HISTORY_CLI_KIND(種類の無い古いエントリに補う種類)', () => {
  it('段階 3a より前のエントリの種類は claude(当時は claude だけが記録された)', () => {
    expect(LEGACY_AGENT_HISTORY_CLI_KIND).toBe('claude')
  })
})
