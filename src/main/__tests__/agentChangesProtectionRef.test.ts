import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isOwnProtectionTreeListing,
  isProcessAliveOnThisMachine,
  parseBatchCheckOutput,
  parseProtectionRefListing,
  prepareAgentChangesNoHooksDir
} from '../agentChangesProtectionRef'

const T1 = 'a'.repeat(40)
const T2 = 'b'.repeat(40)
// ls-tree -z の 1 行
const lsEntry = (type: string, name: string, sha = T1): string =>
  `${type === 'tree' ? '040000' : '100644'} ${type} ${sha}\t${name}\0`

afterEach(() => vi.restoreAllMocks())

describe('parseBatchCheckOutput', () => {
  const entries = [
    { name: 'baseline', tree: T1 },
    { name: 'run-2', tree: T2 }
  ]
  it('tree と答えた項目だけを残す(missing・tree 以外は除く)', () => {
    expect(parseBatchCheckOutput(`${T1} tree 40\n${T2} missing\n`, entries)).toEqual([entries[0]])
    expect(parseBatchCheckOutput(`${T1} blob 3\n${T2} tree 9\n`, entries)).toEqual([entries[1]])
  })
  it('行の数・ID が入力と合わなければ例外(空の出力を「無い」と読まない。L-002)', () => {
    expect(() => parseBatchCheckOutput('', entries)).toThrow()
    expect(() => parseBatchCheckOutput(`${T2} tree 9\n${T1} tree 40\n`, entries)).toThrow()
  })
})

describe('parseProtectionRefListing', () => {
  it('1 行を名前・値・種類に分け、形の違う行は飛ばす', () => {
    const output = `refs/prompt-ide/agent-changes/1-00000000/1\0${T1}\0tree\nbroken-line\n`
    expect(parseProtectionRefListing(output)).toEqual([
      { refName: 'refs/prompt-ide/agent-changes/1-00000000/1', value: T1, objectType: 'tree' }
    ])
    expect(parseProtectionRefListing('')).toEqual([])
  })
})

describe('isOwnProtectionTreeListing', () => {
  it.each([
    ['baseline と run', lsEntry('tree', 'baseline') + lsEntry('tree', 'run-3'), true],
    ['run だけ(gc で始点が消えた後の値)', lsEntry('tree', 'run-3'), true],
    ['空', '', false],
    ['baseline が 2 つ', lsEntry('tree', 'baseline') + lsEntry('tree', 'baseline', T2), false],
    ['子の名前が違う', lsEntry('tree', 'other'), false],
    ['run の番号が 0 始まり', lsEntry('tree', 'run-01'), false],
    ['子が blob', lsEntry('blob', 'run-1'), false]
  ])('%s → %s', (_label, output, expected) => {
    expect(isOwnProtectionTreeListing(output)).toBe(expected)
  })
})

describe('isProcessAliveOnThisMachine', () => {
  it('自分の pid は生きている', () => {
    expect(isProcessAliveOnThisMachine(process.pid)).toBe(true)
  })
  it('ESRCH だけを死んでいるとみなす(EPERM は生きているとみなす)', () => {
    const kill = vi.spyOn(process, 'kill')
    kill.mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    expect(isProcessAliveOnThisMachine(99999)).toBe(false)
    kill.mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    })
    expect(isProcessAliveOnThisMachine(1)).toBe(true)
  })
})

describe('prepareAgentChangesNoHooksDir', () => {
  it('userData の下に 0700 の空のディレクトリを作り、そのパスを返す', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-nohooks-'))
    try {
      const dir = prepareAgentChangesNoHooksDir(root)
      expect(dir).toBe(join(root, 'agent-changes-no-hooks'))
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      // 2 回目(起動のたび)も例外にしない
      expect(prepareAgentChangesNoHooksDir(root)).toBe(dir)
    } finally {
      removeTempPathSync(root)
    }
  })
  it('作れなくても例外にせずパスを返す(存在しない hooksPath でも hook は動かない。確認の結果 5)', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-nohooks-'))
    try {
      const file = join(root, 'file')
      writeFileSync(file, 'x')
      expect(prepareAgentChangesNoHooksDir(file)).toBe(join(file, 'agent-changes-no-hooks'))
    } finally {
      removeTempPathSync(root)
    }
  })
})
