import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import type { AgentChangesUndoOperation } from '@shared/types'
import { getAgentChangeDiff } from '../agentChangeDiff'
import {
  AGENT_CHANGES_STALE_MESSAGE,
  AGENT_REVERT_HUNK_FAILED_MESSAGE,
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { AgentRevertContext, AgentRevertOutcome } from '../agentChangesRevert'
import {
  AGENT_CHANGES_UNDO_MAX_BYTES,
  AGENT_CHANGES_UNDO_TEMP_PREFIX,
  executeAgentChangesUndo
} from '../agentChangesUndo'
import type { AgentChangesUndoExecution } from '../agentChangesUndoModel'
import { commitAll, runGit, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeTrash,
  disposeAgentBaselineRepo,
  recordBaseline,
  userRepoState
} from './helpers/agentBaselineFixtures'
import type { FakeTrash } from './helpers/agentBaselineFixtures'

// 戻す 3 関数が取った控えで取り消す往復(実 git)。registry を通さず、戻す関数の結果の控えを executeAgentChangesUndo へ渡す

const isRoot = process.getuid?.() === 0

let repo: string
let home: string
let tempRoot: string
let trash: FakeTrash['trash']
let trashed: string[]
// 権限を落としたフォルダ(afterEach の後始末の前に戻す)
const lockedDirs: string[] = []
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)
const bytes = (path: string): Buffer => readFileSync(join(repo, path))
const modeOf = (path: string): number => statSync(join(repo, path)).mode & 0o777
// 控えの一時ディレクトリ(tempRoot の直下の接頭辞の名前)
const undoDirs = (): string[] =>
  readdirSync(tempRoot).filter((name) => name.startsWith(AGENT_CHANGES_UNDO_TEMP_PREFIX))

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-undo-'))
  ;({ trash, trashed } = createFakeTrash())
})

afterEach(() => {
  for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o755)
  disposeAgentBaselineRepo({ repo, home, tempRoot })
})

const record = async (maxBytes = AGENT_CHANGES_UNDO_MAX_BYTES): Promise<AgentRevertContext> => ({
  snapshot: await recordBaseline(repo, tempRoot),
  trash,
  undoCapture: { tempRoot, maxBytes },
  attributeEntries: async (entries) => entries
})

// 戻した結果の控えで取り消す(registry を通さず、関数どうしをつなぐ)
async function undoFrom(
  outcome: AgentRevertOutcome,
  operation: AgentChangesUndoOperation = 'file'
): Promise<AgentChangesUndoExecution> {
  if (outcome.capture.kind !== 'saved') {
    throw new Error(`控えが取れなかった: ${JSON.stringify(outcome.capture)}`)
  }
  return executeAgentChangesUndo({
    folderPath: repo,
    undo: { undoId: 1, operation, dir: outcome.capture.dir, items: outcome.capture.items },
    trash
  })
}

const lines = (n: number, replace: Record<number, string> = {}): string =>
  Array.from({ length: n }, (_, i) => replace[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
// diff の 1 つ目のハンクだけのパッチ
const firstHunk = (diff: string): string => {
  const parts = diff.split(/(?=^@@ )/m)
  return parts[0] + parts[1]
}

// a.txt の変更(利用者の未ステージの変更の上にエージェントの追記と権限の変更)を戻す
async function revertModified(): Promise<AgentRevertOutcome> {
  write('a.txt', 'a\n')
  commitAll(repo, 'init')
  write('a.txt', 'a\nuser\n')
  const context = await record()
  write('a.txt', 'a\nuser\nagent\n')
  chmodSync(join(repo, 'a.txt'), 0o755)
  return revertAgentChange(context, 'a.txt')
}

describe('戻す → 取り消す(実 git)', () => {
  it('変更(M): 戻す前の内容と権限へ書き戻す', async () => {
    const outcome = await revertModified()
    expect(outcome).toMatchObject({ applied: 1, capture: { kind: 'saved' } })
    if (outcome.capture.kind !== 'saved') throw new Error('unreachable')
    expect(outcome.capture.items[0].before.kind).toBe('file')
    expect(bytes('a.txt').toString()).toBe('a\nuser\n')
    expect(await undoFrom(outcome)).toEqual({
      kind: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: []
    })
    expect(bytes('a.txt').toString()).toBe('a\nuser\nagent\n')
    expect(modeOf('a.txt')).toBe(0o755)
  })

  it('削除(D): 戻すときに作り直したファイルをゴミ箱へ移す', async () => {
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    const context = await record()
    unlinkSync(join(repo, 'c.txt'))
    const outcome = await revertAgentChange(context, 'c.txt')
    expect(bytes('c.txt').toString()).toBe('c\n')
    expect(await undoFrom(outcome)).toEqual({
      kind: 'done',
      restoredPaths: [],
      trashedPaths: ['c.txt']
    })
    expect(trashed).toEqual([join(repo, 'c.txt')])
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
  })

  it('追加(A)のファイル: ゴミ箱へ移したファイルを中身と権限ごと作り直す', async () => {
    write('base.txt', 'b\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    chmodSync(join(repo, 'new.txt'), 0o755)
    const outcome = await revertAgentChange(context, 'new.txt')
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    expect(await undoFrom(outcome)).toEqual({
      kind: 'done',
      restoredPaths: ['new.txt'],
      trashedPaths: []
    })
    expect(bytes('new.txt').toString()).toBe('n\n')
    expect(modeOf('new.txt')).toBe(0o755)
    // OS のゴミ箱には戻す操作の 1 件だけ(取り消しはゴミ箱から取り出さずに作り直す)
    expect(trashed).toEqual([join(repo, 'new.txt')])
  })

  it('種類の変更(T): ファイルに戻したものをリンクへ戻す', async () => {
    write('l.txt', 'l\n')
    commitAll(repo, 'init')
    const context = await record()
    unlinkSync(join(repo, 'l.txt'))
    symlinkSync('target', join(repo, 'l.txt'))
    const outcome = await revertAgentChange(context, 'l.txt')
    expect(statSync(join(repo, 'l.txt')).isFile()).toBe(true)
    expect(await undoFrom(outcome)).toMatchObject({ kind: 'done', restoredPaths: ['l.txt'] })
    expect(readlinkSync(join(repo, 'l.txt'))).toBe('target')
  })

  it('ハンク: 戻したハンクを含む戻す前の内容へ書き戻す', async () => {
    write('d.txt', lines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', lines(20, { 2: 'A2', 18: 'A18' }))
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    const outcome = await revertAgentChangeHunk(context, 'd.txt', firstHunk(diff))
    expect(outcome).toMatchObject({ applied: 1, capture: { kind: 'saved' } })
    expect(bytes('d.txt').toString()).toBe(lines(20, { 18: 'A18' }))
    expect(await undoFrom(outcome, 'hunk')).toMatchObject({
      kind: 'done',
      restoredPaths: ['d.txt']
    })
    expect(bytes('d.txt').toString()).toBe(lines(20, { 2: 'A2', 18: 'A18' }))
  })

  // すべて戻す: 変更・削除・追加を同時に作る
  async function setupAll(): Promise<AgentRevertContext> {
    write('a.txt', 'a\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nuser\n')
    const context = await record()
    write('a.txt', 'a\nuser\nagent\n')
    unlinkSync(join(repo, 'c.txt'))
    write('new.txt', 'n\n')
    return context
  }

  it('すべて: 3 件を戻した控えで 3 件とも戻す前の状態にする', async () => {
    const context = await setupAll()
    const outcome = await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'c.txt', status: 'D' },
      { path: 'new.txt', status: 'A' }
    ])
    expect(outcome).toMatchObject({ status: 'done', applied: 3, capture: { kind: 'saved' } })
    if (outcome.capture.kind !== 'saved') throw new Error('unreachable')
    expect(outcome.capture.items.map((item) => item.path)).toEqual(['a.txt', 'c.txt', 'new.txt'])
    expect(await undoFrom(outcome, 'all')).toEqual({
      kind: 'done',
      restoredPaths: ['a.txt', 'new.txt'],
      trashedPaths: ['c.txt']
    })
    expect(bytes('a.txt').toString()).toBe('a\nuser\nagent\n')
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
    expect(bytes('new.txt').toString()).toBe('n\n')
  })

  it.skipIf(isRoot)('すべて の partial: 適用した項目だけを控える', async () => {
    write('a.txt', 'a\n')
    write('zz/m.txt', 'm\n')
    commitAll(repo, 'init')
    const context = await record()
    write('a.txt', 'a\nagent\n')
    write('zz/m.txt', 'm\nagent\n')
    chmodSync(join(repo, 'zz'), 0o555)
    lockedDirs.push(join(repo, 'zz'))
    const outcome = await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'zz/m.txt', status: 'M' }
    ])
    expect(outcome).toMatchObject({ status: 'partial', applied: 1, capture: { kind: 'saved' } })
    if (outcome.capture.kind !== 'saved') throw new Error('unreachable')
    expect(outcome.capture.items.map((item) => item.path)).toEqual(['a.txt'])
  })

  it('改行の変換: 取り消しは控えたバイト列のまま書き戻す(git のフィルタ・改行の変換を通さない)', async () => {
    runGit(repo, 'config', 'core.autocrlf', 'true')
    write('.gitattributes', '* text=auto\n')
    commitAll(repo, 'attributes')
    write('crlf.txt', 'a\r\nb\r\n')
    commitAll(repo, 'crlf')
    const context = await record()
    write('crlf.txt', 'a\r\nb\r\nc\r\n')
    const outcome = await revertAgentChange(context, 'crlf.txt')
    expect(await undoFrom(outcome)).toMatchObject({ kind: 'done', restoredPaths: ['crlf.txt'] })
    expect(bytes('crlf.txt').equals(Buffer.from('a\r\nb\r\nc\r\n'))).toBe(true)
  })

  it('戻した後に変わったファイルがあれば、何も書かずに拒否する', async () => {
    const outcome = await revertModified()
    write('a.txt', 'a\nuser\nlater\n')
    expect(await undoFrom(outcome)).toEqual({
      kind: 'rejected',
      keepUndo: false,
      message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）'
    })
    expect(bytes('a.txt').toString()).toBe('a\nuser\nlater\n')
  })

  it('取り消しは利用者の index・stash・ref・HEAD を変えない', async () => {
    const outcome = await revertModified()
    const before = userRepoState(repo)
    await undoFrom(outcome)
    expect(userRepoState(repo)).toEqual(before)
  })

  it('上限を超える中身は控えずに戻す(too-large)。追加されたフォルダは控えない(directory)', async () => {
    write('base.txt', 'b\n')
    commitAll(repo, 'init')
    const context = await record(10)
    write('big.txt', '12345678901')
    expect(await revertAgentChange(context, 'big.txt')).toEqual({
      applied: 1,
      capture: { kind: 'unavailable', reason: 'too-large' }
    })
    expect(trashed).toEqual([join(repo, 'big.txt')])
    expect(undoDirs()).toEqual([])
    write('nd/a.txt', 'a\n')
    expect(await revertAgentChange(context, 'nd')).toEqual({
      applied: 1,
      capture: { kind: 'unavailable', reason: 'directory' }
    })
    expect(undoDirs()).toEqual([])
  })

  it('戻す操作が例外で終わったら控えを残さない', async () => {
    write('a.txt', lines(5))
    write('b.txt', lines(5))
    write('d.txt', lines(20))
    commitAll(repo, 'init')
    const context = await record()
    // 一覧に無いパス(控えを始める前に拒否する)
    await expect(revertAgentChange(context, 'none.txt')).rejects.toThrow(
      AGENT_CHANGES_STALE_MESSAGE
    )
    expect(undoDirs()).toEqual([])
    // パッチの検査で拒否する(控えを始める前)
    write('a.txt', lines(5, { 2: 'A' }))
    write('b.txt', lines(5, { 2: 'B' }))
    const bDiff = await getAgentChangeDiff(context.snapshot, 'b.txt')
    await expect(revertAgentChangeHunk(context, 'a.txt', bDiff)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(undoDirs()).toEqual([])
    // パッチの適用の失敗(控えを始めた後。作った控えを消す)
    write('d.txt', lines(20, { 2: 'A2' }))
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    write('d.txt', lines(20, { 2: 'A2', 3: 'later' }))
    await expect(revertAgentChangeHunk(context, 'd.txt', diff)).rejects.toThrow(
      AGENT_REVERT_HUNK_FAILED_MESSAGE
    )
    expect(undoDirs()).toEqual([])
  })

  it('適用(ゴミ箱へ移す)の失敗で例外になったら控えを残さない(ファイル単位・すべて戻すの 0 件目)', async () => {
    write('base.txt', 'b\n')
    commitAll(repo, 'init')
    const context = await record()
    context.trash = async () => {
      throw new Error('trash failed')
    }
    write('new.txt', 'n\n')
    await expect(revertAgentChange(context, 'new.txt')).rejects.toThrow(
      'ゴミ箱へ移動できませんでした'
    )
    expect(undoDirs()).toEqual([])
    await expect(
      revertAllAgentChanges(context, [{ path: 'new.txt', status: 'A' }])
    ).rejects.toThrow('すべて戻すが途中で失敗しました（0 / 1 件を戻し済み）')
    expect(undoDirs()).toEqual([])
  })
})
