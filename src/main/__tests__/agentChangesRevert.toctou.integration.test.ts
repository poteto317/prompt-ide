import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { revertAgentChange, revertAllAgentChanges } from '../agentChangesRevert'
import type { AgentRevertContext } from '../agentChangesRevert'
import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../agentChangesUndo'
import { commitAll, readRepoFile, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeTrash,
  disposeAgentBaselineRepo,
  recordBaseline
} from './helpers/agentBaselineFixtures'
import type { FakeTrash } from './helpers/agentBaselineFixtures'

// 一覧を取った直後(戻す前の検査の前)に作業ツリーを変える。一覧と戻すの間に置かれた ignore されたファイルを、
// 戻す側の検査(assess)が止めることを確かめる(Task 6 レビュー I1 の修正案 2)
// mapEntries は一覧の結果を差し替える(git の出力からは作れない一覧〈同じパスの行が 2 つ〉の再現)
const hooks = vi.hoisted(() => ({
  afterCollect: null as (() => void) | null,
  mapEntries: null as (<T>(entries: T[]) => T[]) | null
}))

vi.mock('../agentChangesQuery', async (importOriginal) => {
  const original = await importOriginal<typeof import('../agentChangesQuery')>()
  return {
    ...original,
    collectAgentChangeEntries: async (
      ...args: Parameters<typeof original.collectAgentChangeEntries>
    ) => {
      const entries = await original.collectAgentChangeEntries(...args)
      hooks.afterCollect?.()
      return hooks.mapEntries === null ? entries : hooks.mapEntries(entries)
    }
  }
})

let repo: string
let home: string
let tempRoot: string
let trash: FakeTrash['trash']
let trashed: string[]

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-toctou-'))
  ;({ trash, trashed } = createFakeTrash())
  hooks.afterCollect = null
  hooks.mapEntries = null
})

afterEach(() => {
  hooks.afterCollect = null
  hooks.mapEntries = null
  disposeAgentBaselineRepo({ repo, home, tempRoot })
})

const record = async (): Promise<AgentRevertContext> => ({
  snapshot: await recordBaseline(repo, tempRoot),
  trash,
  undoCapture: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES },
  attributeEntries: async (entries) => entries
})

describe('一覧の後に ignore されたファイルが置かれたフォルダ(実 git)', () => {
  const setup = async (): Promise<AgentRevertContext> => {
    write('.gitignore', '*.log\n')
    commitAll(repo, 'init')
    const context = await record()
    write('nd/a.txt', 'a\n')
    hooks.afterCollect = () => write('nd/user.log', 'keep\n')
    return context
  }
  const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

  it('ファイル単位: フォルダごとは戻さずに拒否する', async () => {
    const context = await setup()
    await expect(revertAgentChange(context, 'nd')).rejects.toThrow(
      'ignore されたファイルを含むため、フォルダごとは戻せません: nd'
    )
    expect(readRepoFile(repo, 'nd/user.log')).toBe('keep\n')
    expect(trashed).toEqual([])
  })

  it('すべて戻す: 何も戻さずに拒否する', async () => {
    const context = await setup()
    await expect(revertAllAgentChanges(context, [{ path: 'nd/', status: 'A' }])).rejects.toThrow(
      '戻せないファイルがあるため、何も戻しませんでした（nd）'
    )
    expect(readRepoFile(repo, 'nd/user.log')).toBe('keep\n')
    expect(trashed).toEqual([])
  })
})

describe('一覧に同じパスの行が 2 つあるとき(実 git)', () => {
  it('すべて戻すは同じパスを 1 度だけ戻して控え、取り消しの項目も 1 つにする', async () => {
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    writeRepoFile(repo, 'a.txt', 'a\nagent\n')
    hooks.mapEntries = (entries) => [...entries, ...entries]
    const outcome = await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'a.txt', status: 'M' }
    ])
    expect(outcome).toMatchObject({ status: 'done', applied: 1, capture: { kind: 'saved' } })
    if (outcome.capture.kind !== 'saved') throw new Error('unreachable')
    expect(outcome.capture.items.map((item) => item.path)).toEqual(['a.txt'])
    expect(readRepoFile(repo, 'a.txt')).toBe('a\n')
  })
})
