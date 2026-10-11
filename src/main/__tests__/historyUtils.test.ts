import { describe, it, expect } from 'vitest'
import { isValidHistoryEntry, sanitizeHistoryEntry } from '../historyUtils'
import type { HistoryEntry } from '@shared/types'

const validEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'タイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 1000,
  agent: null
}

const agentEntry: HistoryEntry = {
  ...validEntry,
  id: 'h-agent',
  toolId: 'claude',
  status: 'sent',
  resultText: null,
  agent: {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 2',
    folderPath: '/work'
  }
}
// agent の無い古い形式の値(保存済みの古い history.json の要素)
const withoutAgent = (entry: HistoryEntry): Record<string, unknown> => {
  const legacy: Record<string, unknown> = { ...entry }
  delete legacy.agent
  return legacy
}

describe('isValidHistoryEntry', () => {
  it('正しい形式は true', () => {
    expect(isValidHistoryEntry(validEntry)).toBe(true)
  })

  it('null / オブジェクトでない値は false', () => {
    expect(isValidHistoryEntry(null)).toBe(false)
    expect(isValidHistoryEntry('string')).toBe(false)
    expect(isValidHistoryEntry(123)).toBe(false)
  })

  it('id が string でない場合は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, id: 1 })).toBe(false)
  })

  it('promptId が null または string 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, promptId: 123 })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, promptId: null })).toBe(true)
    expect(isValidHistoryEntry({ ...validEntry, promptId: 'p2' })).toBe(true)
  })

  it('未知の toolId は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'unknown' })).toBe(false)
  })

  it('claude / copilot / api はすべて有効な toolId', () => {
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'claude' })).toBe(true)
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'copilot' })).toBe(true)
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'api' })).toBe(true)
  })

  it('status が success / error 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, status: 'pending' })).toBe(false)
  })

  it('resultText / errorMessage が null または string 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, resultText: 123 })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, errorMessage: 123 })).toBe(false)
  })

  it('fileContent が null または string 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, fileContent: 123 })).toBe(false)
  })

  it('executedAt が number でない、または非有限値なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, executedAt: '1000' })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, executedAt: NaN })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, executedAt: Infinity })).toBe(false)
  })

  it('promptTitle が string でない場合は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, promptTitle: 123 })).toBe(false)
  })

  it('promptContent が string でない場合は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, promptContent: 123 })).toBe(false)
  })
})

describe('sanitizeHistoryEntry', () => {
  const entryWithFileContent: HistoryEntry = { ...validEntry, fileContent: 'ファイル内容' }

  it('既知のフィールドはそのまま保持する', () => {
    const result = sanitizeHistoryEntry(entryWithFileContent)
    expect(result).toEqual(entryWithFileContent)
  })

  it('余分なプロパティを除去する', () => {
    const withExtra = { ...validEntry, extra: 'x' } as HistoryEntry & { extra: string }
    const result = sanitizeHistoryEntry(withExtra)
    expect((result as Record<string, unknown>).extra).toBeUndefined()
    expect(result.id).toBe('h1')
  })

  it('promptId: null を保持する', () => {
    const entry = { ...validEntry, promptId: null }
    expect(sanitizeHistoryEntry(entry).promptId).toBeNull()
  })

  it('fileContent: null を保持する', () => {
    const entry = { ...validEntry, fileContent: null }
    expect(sanitizeHistoryEntry(entry).fileContent).toBeNull()
  })

  it('エラー時の resultText: null / errorMessage を保持する', () => {
    const entry: HistoryEntry = {
      ...validEntry,
      status: 'error',
      resultText: null,
      errorMessage: 'エラー内容'
    }
    const result = sanitizeHistoryEntry(entry)
    expect(result.resultText).toBeNull()
    expect(result.errorMessage).toBe('エラー内容')
  })
})

describe('isValidHistoryEntry: エージェントのエントリ(agent・sent)', () => {
  it('agent の無い古い形式は有効(sanitize で agent: null になる)', () => {
    const legacy = withoutAgent(validEntry)
    expect(isValidHistoryEntry(legacy)).toBe(true)
    expect(sanitizeHistoryEntry(legacy as HistoryEntry).agent).toBeNull()
  })

  it('正しい形のエージェントのエントリは有効', () => {
    expect(isValidHistoryEntry(agentEntry)).toBe(true)
  })

  it('agent があるのに status が sent でなければ不正(従来のエントリへ読み替えない。L-044)', () => {
    expect(isValidHistoryEntry({ ...agentEntry, status: 'success' })).toBe(false)
    expect(isValidHistoryEntry({ ...agentEntry, status: 'error' })).toBe(false)
  })

  it('status が sent なのに agent が無い・null なら不正', () => {
    expect(isValidHistoryEntry({ ...validEntry, status: 'sent' })).toBe(false)
    expect(isValidHistoryEntry({ ...withoutAgent(validEntry), status: 'sent' })).toBe(false)
  })

  it.each([
    ['オブジェクトでない', 'x'],
    ['配列', []],
    [
      'claudeSessionId が UUID の形式でない',
      { claudeSessionId: 'abc', tabLabel: 'claude 1', folderPath: '/w' }
    ],
    [
      'claudeSessionId が - 始まり',
      { claudeSessionId: '--resume', tabLabel: 'claude 1', folderPath: '/w' }
    ],
    [
      'tabLabel が空',
      { claudeSessionId: '11111111-1111-4111-8111-111111111111', tabLabel: '', folderPath: '/w' }
    ],
    [
      'folderPath が空',
      {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        tabLabel: 'claude 1',
        folderPath: ''
      }
    ],
    [
      'tabLabel が文字列でない',
      { claudeSessionId: '11111111-1111-4111-8111-111111111111', tabLabel: 1, folderPath: '/w' }
    ]
  ])('agent が %s なら不正', (_label, agent) => {
    expect(isValidHistoryEntry({ ...agentEntry, agent })).toBe(false)
  })
})

describe('sanitizeHistoryEntry: agent', () => {
  it('agent を残し、agent の中の余分なキーを落とす(保存で黙って消えない。L-015)', () => {
    const withExtra = {
      ...agentEntry,
      agent: { ...agentEntry.agent, extra: 'x' }
    } as HistoryEntry
    expect(sanitizeHistoryEntry(withExtra)).toEqual(agentEntry)
    expect(sanitizeHistoryEntry(withExtra).agent).not.toHaveProperty('extra')
  })

  it('agent: null を保持する', () => {
    expect(sanitizeHistoryEntry(validEntry).agent).toBeNull()
  })
})
