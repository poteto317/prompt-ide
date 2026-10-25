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
    cliKind: 'claude',
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
      { claudeSessionId: 'abc', cliKind: 'claude', tabLabel: 'claude 1', folderPath: '/w' }
    ],
    [
      'claudeSessionId が - 始まり',
      { claudeSessionId: '--resume', cliKind: 'claude', tabLabel: 'claude 1', folderPath: '/w' }
    ],
    [
      'tabLabel が空',
      {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        cliKind: 'claude',
        tabLabel: '',
        folderPath: '/w'
      }
    ],
    [
      'folderPath が空',
      {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        cliKind: 'claude',
        tabLabel: 'claude 1',
        folderPath: ''
      }
    ],
    [
      'tabLabel が文字列でない',
      {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        cliKind: 'claude',
        tabLabel: 1,
        folderPath: '/w'
      }
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

describe('agent.cliKind(段階 3a。履歴への CLI の種類)', () => {
  // 段階 3a より前のエージェントのエントリ(agent に cliKind が無い)
  const legacyAgentEntry = (): Record<string, unknown> => {
    const agent: Record<string, unknown> = { ...agentEntry.agent }
    delete agent.cliKind
    return { ...agentEntry, agent }
  }
  const withCliKind = (cliKind: unknown): Record<string, unknown> => ({
    ...agentEntry,
    agent: { ...agentEntry.agent, cliKind }
  })

  it('種類の無い古いエントリは有効で、保存の正規化で claude を補う(ID・時刻・ほかの欄は作り直さない。L-456)', () => {
    const legacy = legacyAgentEntry()
    expect(isValidHistoryEntry(legacy)).toBe(true)
    const sanitized = sanitizeHistoryEntry(legacy as HistoryEntry)
    expect(sanitized).toEqual(agentEntry)
    expect(sanitized.id).toBe(agentEntry.id)
    expect(sanitized.executedAt).toBe(agentEntry.executedAt)
    expect(sanitized.agent?.claudeSessionId).toBe(agentEntry.agent?.claudeSessionId)
  })

  it.each(['copilot', 'gemini'])(
    '%s の種類は読み込み(検証と正規化)と保存の往復で値を保つ(L-015・L-459)',
    (cliKind) => {
      const entry = withCliKind(cliKind)
      expect(isValidHistoryEntry(entry)).toBe(true)
      const once = sanitizeHistoryEntry(entry as HistoryEntry)
      expect(once.agent?.cliKind).toBe(cliKind)
      expect(isValidHistoryEntry(once)).toBe(true)
      expect(sanitizeHistoryEntry(once)).toEqual(once)
    }
  )

  it.each<[string, unknown]>([
    ['数', 1],
    ['空', ''],
    ['大文字を含む', 'Gemini'],
    ['33 文字', `a${'b'.repeat(32)}`],
    ['null', null]
  ])(
    '形の不正な cliKind(%s)のエントリは捨てる(既定の claude に読み替えない。L-044)',
    (_label, cliKind) => {
      expect(isValidHistoryEntry(withCliKind(cliKind))).toBe(false)
    }
  )

  it('agent の中の知らない欄は今どおり落とし、種類は保つ', () => {
    const entry = { ...agentEntry, agent: { ...agentEntry.agent, cliKind: 'gemini', extra: 'x' } }
    const sanitized = sanitizeHistoryEntry(entry as HistoryEntry)
    expect(sanitized.agent).toEqual({ ...agentEntry.agent, cliKind: 'gemini' })
    expect(sanitized.agent).not.toHaveProperty('extra')
  })
})
