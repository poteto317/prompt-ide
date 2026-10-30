import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lstatSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { AGENT_CHANGES_LIST_LIMIT } from '@shared/types'
import type { AgentChangeEntry } from '@shared/types'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import {
  collectAgentChangeEntries,
  collectAgentChangeEntriesBetween,
  listAgentChanges,
  listAgentChangesBetween
} from '../agentChangesQuery'
import { readRecordHead } from '../agentBaselineGit'

// git の実行はモックにして、出力の解釈(状態の文字・フォルダの展開・除外ファイルの照合・範囲の差分)だけを確かめる。
// 実 git での振る舞いは agentChangesQuery.integration.test.ts が持つ
const mocks = vi.hoisted(() => ({
  raw: vi.fn<(args: string[]) => Promise<string>>(),
  readRecordHead: vi.fn<() => Promise<string | null>>()
}))
vi.mock('../agentBaselineGit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agentBaselineGit')>()
  return {
    ...actual,
    createBaselineGit: vi.fn(() => ({ raw: mocks.raw })),
    readRecordHead: mocks.readRecordHead
  }
})

let folder: string
let snapshot: BaselineSnapshot

// NUL 区切りの出力
const nul = (...parts: string[]): string => parts.map((p) => `${p}\0`).join('')

function makeSnapshot(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  return {
    folderPath: folder,
    tempDir: folder,
    indexPath: join(folder, 'index'),
    gitDir: null,
    startedAt: 0,
    head: 'head-1',
    tree: 'tree-start',
    excluded: [],
    skippedRepos: [],
    ignoredAtBaseline: [],
    ...overrides
  }
}

// 'path' → 'status:isDirectory:notRecorded' の表(並びの確認は別に行う)
const summarize = (entries: AgentChangeEntry[]): Record<string, string> =>
  Object.fromEntries(entries.map((e) => [e.path, `${e.status}:${e.isDirectory}:${e.notRecorded}`]))

// git の出力を呼び出しの形ごとに返す
function stubGit(outputs: {
  diff?: string
  others?: string
  ignoredInside?: (pathspec: string) => string
  expand?: (pathspec: string) => string
  diffTree?: string
}): void {
  mocks.raw.mockImplementation(async (args) => {
    if (args[0] === 'diff') return outputs.diff ?? ''
    if (args[0] === 'diff-tree') return outputs.diffTree ?? ''
    const pathspec = args[args.length - 1]
    if (args.includes('--ignored')) return outputs.ignoredInside?.(pathspec) ?? ''
    if (args.includes('--directory')) return outputs.others ?? ''
    return outputs.expand?.(pathspec) ?? ''
  })
}

beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-query-unit-')))
  // 記録のインデックス(assertBaselineRecord が通常のファイルを要求する)
  writeFileSync(join(folder, 'index'), '')
  snapshot = makeSnapshot()
  mocks.raw.mockReset()
  mocks.readRecordHead.mockReset()
})

afterEach(() => removeTempPathSync(folder))

describe('collectAgentChangeEntries(出力の解釈)', () => {
  it('name-status の文字は D・T・A をそのまま、未知の文字は M にする', async () => {
    stubGit({ diff: nul('D', 'd.txt', 'T', 't.txt', 'A', 'a.txt', 'X', 'x.txt', 'M', 'm.txt') })
    const entries = await collectAgentChangeEntries(snapshot)
    expect(summarize(entries)).toEqual({
      'a.txt': 'A:false:false',
      'd.txt': 'D:false:false',
      'm.txt': 'M:false:false',
      't.txt': 'T:false:false',
      'x.txt': 'M:false:false'
    })
    // パスの順
    expect(entries.map((e) => e.path)).toEqual(['a.txt', 'd.txt', 'm.txt', 't.txt', 'x.txt'])
  })

  it('name-status の途中に空のトークンがあれば、そこで読むのをやめる(出力が空なら 0 件)', async () => {
    stubGit({ diff: `M\0a.txt\0\0M\0after-empty.txt\0` })
    expect(summarize(await collectAgentChangeEntries(snapshot))).toEqual({
      'a.txt': 'M:false:false'
    })
    stubGit({ diff: '' })
    expect(await collectAgentChangeEntries(snapshot)).toEqual([])
  })

  it('同じパスが追跡の行と未追跡の行に重なっても(並び替えの比較が 0 を返す)、2 行とも残す', async () => {
    stubGit({ diff: nul('M', 'dup.txt'), others: nul('dup.txt') })
    const entries = await collectAgentChangeEntries(snapshot)
    expect(entries.map((e) => `${e.path}:${e.status}`)).toEqual(['dup.txt:M', 'dup.txt:A'])
  })

  it('git の diff が「unable to read」で失敗したら、分かる文言の例外に置き換える', async () => {
    mocks.raw.mockRejectedValue(new Error('fatal: unable to read abcdef1234'))
    await expect(collectAgentChangeEntries(snapshot)).rejects.toThrow(
      '実行前の内容が見つかりません'
    )
  })

  it('記録のインデックスが無ければ git を呼ばずに「記録が見つかりません」で失敗する', async () => {
    await expect(
      collectAgentChangeEntries(makeSnapshot({ indexPath: join(folder, 'missing') }))
    ).rejects.toThrow('記録が見つかりません')
    expect(mocks.raw).not.toHaveBeenCalled()
  })

  describe('新しいフォルダの行の展開', () => {
    it('中身に記録の前からあったものがあるフォルダだけ、ファイル 1 行ずつに展開し、ignore 済みフォルダの中は 1 行にまとめ直す', async () => {
      snapshot = makeSnapshot({
        skippedRepos: ['skipped/'],
        // pre/ign/ は pre/ の中のフォルダごと ignore、ignd/ はフォルダごと ignore
        ignoredAtBaseline: ['ign.env', 'ignd/', 'pre/ign/']
      })
      stubGit({
        others: nul('skipped/', 'ignd/', 'plain/', 'pre/', 'hi/', 'keep.txt', 'ign.env'),
        // hi/ だけ、中に ignore されたファイルがある(記録の索引には無く、git に問い合わせて分かる)
        ignoredInside: (pathspec) => (pathspec.endsWith('hi/') ? nul('hi/secret.env') : ''),
        expand: (pathspec) => {
          if (pathspec.endsWith('pre/')) {
            // pre/ign/ の中は 2 ファイルあるが、フォルダの 1 行にまとめ直す
            return nul('pre/a.txt', 'pre/ign/x', 'pre/ign/y')
          }
          if (pathspec.endsWith('hi/')) return nul('hi/f.txt')
          return ''
        }
      })
      const entries = await collectAgentChangeEntries(snapshot)
      expect(summarize(entries)).toEqual({
        // 入れ子のリポジトリ・記録の時点に ignore されていたフォルダは展開せず、戻せない 1 行
        'skipped/': 'A:true:true',
        'ignd/': 'A:true:true',
        // 記録の前からあったものを含まないフォルダは、まとめたまま
        'plain/': 'A:true:false',
        // 展開した中身
        'pre/a.txt': 'A:false:false',
        'pre/ign/': 'A:true:true',
        'hi/f.txt': 'A:false:false',
        'keep.txt': 'A:false:false',
        // 記録の時点に ignore されていたファイルは戻せない
        'ign.env': 'A:false:true'
      })
      // 展開で ignore 済みフォルダの中のファイルは別の行にならない
      expect(entries.map((e) => e.path)).not.toContain('pre/ign/x')
      // 展開の問い合わせは、フォルダごとにちょうど 1 回(plain/ は展開しない)
      const expandCalls = mocks.raw.mock.calls.filter(
        ([args]) => args[0] === 'ls-files' && !args.includes('--directory')
      )
      expect(expandCalls).toHaveLength(2)
    })
  })

  describe('記録から除外した(大きすぎる)ファイル', () => {
    it('変わっていなければ出さず、変わったら M・消えたら D(どちらも戻せない)にする', async () => {
      writeFileSync(join(folder, 'same.bin'), 'aaaa')
      writeFileSync(join(folder, 'mod.bin'), 'bbbbbb')
      const same = lstatSync(join(folder, 'same.bin'))
      const mod = lstatSync(join(folder, 'mod.bin'))
      snapshot = makeSnapshot({
        excluded: [
          {
            path: 'same.bin',
            size: same.size,
            mtimeMs: same.mtimeMs,
            dev: same.dev,
            ino: same.ino
          },
          // 大きさが違う → 変わった
          { path: 'mod.bin', size: mod.size + 1, mtimeMs: mod.mtimeMs, dev: mod.dev, ino: mod.ino },
          // 一覧にも作業ツリーにも無い → 消えた
          { path: 'gone.bin', size: 1, mtimeMs: 1, dev: 1, ino: 1 },
          // 一覧には現れず、作業ツリーにはある → 出さない(ignore された・追跡に変わった)
          { path: 'still.bin', size: 1, mtimeMs: 1, dev: 1, ino: 1 }
        ]
      })
      writeFileSync(join(folder, 'still.bin'), 'x')
      stubGit({ others: nul('same.bin', 'mod.bin') })
      expect(summarize(await collectAgentChangeEntries(snapshot))).toEqual({
        'mod.bin': 'M:false:true',
        'gone.bin': 'D:false:true'
      })
    })

    it('除外のファイルが消えて同じ inode の追加の行があれば、その追加の行を戻せない行にする', async () => {
      writeFileSync(join(folder, 'moved.bin'), 'm')
      writeFileSync(join(folder, 'other.bin'), 'o')
      const moved = lstatSync(join(folder, 'moved.bin'))
      snapshot = makeSnapshot({
        excluded: [
          { path: 'big.bin', size: 9, mtimeMs: 1, dev: moved.dev, ino: moved.ino },
          // 追加の行が無い(=調べる相手が無い)除外のファイルは、消えていても何も起こさない
          { path: 'big2.bin', size: 9, mtimeMs: 1, dev: moved.dev, ino: moved.ino + 100000 }
        ]
      })
      stubGit({
        // moved.bin は inode が一致、other.bin は別の inode、ghost.txt は作業ツリーに無い、m.txt は追加ではない
        diff: nul('A', 'moved.bin', 'A', 'other.bin', 'A', 'ghost.txt', 'M', 'm.txt'),
        // newdir/ は追加のフォルダ(調べない)
        others: nul('newdir/')
      })
      expect(summarize(await collectAgentChangeEntries(snapshot))).toEqual({
        'big.bin': 'D:false:true',
        'big2.bin': 'D:false:true',
        'moved.bin': 'A:false:true',
        'other.bin': 'A:false:false',
        'ghost.txt': 'A:false:false',
        'm.txt': 'M:false:false',
        'newdir/': 'A:true:false'
      })
    })

    it('消えた除外のファイルが無ければ、追加の行の inode を調べない(通常のファイルでないものも変わりなし)', async () => {
      writeFileSync(join(folder, 'added.txt'), 'x')
      const added = lstatSync(join(folder, 'added.txt'))
      snapshot = makeSnapshot({
        // 消えていない(=存在する)除外のファイル。inode が追加の行と同じでも、消えていないので印は付かない
        excluded: [{ path: 'present.bin', size: 1, mtimeMs: 1, dev: added.dev, ino: added.ino }]
      })
      writeFileSync(join(folder, 'present.bin'), 'pp')
      stubGit({ diff: nul('A', 'added.txt'), others: nul('present.bin') })
      const summary = summarize(await collectAgentChangeEntries(snapshot))
      expect(summary['added.txt']).toBe('A:false:false')
    })
  })
})

describe('listAgentChanges', () => {
  it('一覧の上限で打ち切り、全件数と打ち切りを添える。HEAD が記録と違えば headChanged', async () => {
    const files = Array.from(
      { length: AGENT_CHANGES_LIST_LIMIT + 3 },
      (_, i) => `f${String(i).padStart(4, '0')}.txt`
    )
    stubGit({ others: nul(...files) })
    mocks.readRecordHead.mockResolvedValue('head-2')
    const list = await listAgentChanges(snapshot)
    expect(list.entries).toHaveLength(AGENT_CHANGES_LIST_LIMIT)
    expect(list.totalCount).toBe(AGENT_CHANGES_LIST_LIMIT + 3)
    expect(list.truncated).toBe(true)
    expect(list.headChanged).toBe(true)
    expect(readRecordHead).toHaveBeenCalledTimes(1)
  })

  it('上限以内で HEAD が同じなら、打ち切りも headChanged も false', async () => {
    stubGit({ others: nul('a.txt') })
    mocks.readRecordHead.mockResolvedValue('head-1')
    const list = await listAgentChanges(snapshot)
    expect(list).toMatchObject({ totalCount: 1, truncated: false, headChanged: false })
  })
})

describe('collectAgentChangeEntriesBetween(途中の実行の差分)', () => {
  const file = (
    path: string,
    size: number,
    mtimeMs: number
  ): BaselineSnapshot['excluded'][number] => ({
    path,
    size,
    mtimeMs,
    dev: 1,
    ino: 1
  })

  it('隠れた git の場所が消えていたら、git を呼ばずに「記録が見つかりません」で失敗する', async () => {
    const start = makeSnapshot({ gitDir: join(folder, 'no-such-dir') })
    await expect(collectAgentChangeEntriesBetween(start, makeSnapshot())).rejects.toThrow(
      '記録が見つかりません'
    )
    expect(mocks.raw).not.toHaveBeenCalled()
  })

  it('diff-tree が「bad object」で失敗したら、分かる文言の例外に置き換える', async () => {
    mocks.raw.mockRejectedValue(new Error('fatal: bad object abcdef1234'))
    await expect(collectAgentChangeEntriesBetween(makeSnapshot(), makeSnapshot())).rejects.toThrow(
      '実行前の内容が見つかりません'
    )
  })

  it('tree の差分の行は、どちらかの端で記録しなかったパスだけ M の戻せない行にし、ほかはそのまま出す', async () => {
    const start = makeSnapshot({ excluded: [file('big.bin', 1, 1)] })
    const end = makeSnapshot({ ignoredAtBaseline: ['end-ignored.txt'] })
    stubGit({
      diffTree: nul('A', 'new.txt', 'D', 'old.txt', 'A', 'big.bin', 'D', 'end-ignored.txt')
    })
    expect(summarize(await collectAgentChangeEntriesBetween(start, end))).toEqual({
      'new.txt': 'A:false:false',
      'old.txt': 'D:false:false',
      'big.bin': 'M:false:true',
      'end-ignored.txt': 'M:false:true'
    })
    // tree どうしを比べる(start.tree → end.tree)
    expect(mocks.raw.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['diff-tree', 'tree-start', end.tree])
    )
  })

  describe('除外したファイルの変化', () => {
    it('両端にあれば大きさか更新時刻が違うときだけ M、同じなら出さない', async () => {
      const start = makeSnapshot({
        excluded: [file('size.bin', 1, 1), file('time.bin', 1, 1), file('same.bin', 1, 1)]
      })
      const end = makeSnapshot({
        excluded: [file('size.bin', 2, 1), file('time.bin', 1, 2), file('same.bin', 1, 1)]
      })
      stubGit({})
      expect(summarize(await collectAgentChangeEntriesBetween(start, end))).toEqual({
        'size.bin': 'M:false:true',
        'time.bin': 'M:false:true'
      })
    })

    it('終わりにだけあれば A、始まりにだけあれば D。もう片方の端で別の理由により記録していなければ出さない', async () => {
      const start = makeSnapshot({
        excluded: [file('gone.bin', 1, 1), file('gone-ignored.bin', 1, 1)],
        // 始まりでは ignore 済みだった → 終わりで現れても出現と言えない
        ignoredAtBaseline: ['appeared-ignored.bin']
      })
      const end = makeSnapshot({
        excluded: [file('appeared.bin', 1, 1), file('appeared-ignored.bin', 1, 1)],
        // 終わりでは ignore 済み → 消えたと言えない
        ignoredAtBaseline: ['gone-ignored.bin']
      })
      stubGit({})
      expect(summarize(await collectAgentChangeEntriesBetween(start, end))).toEqual({
        'appeared.bin': 'A:false:true',
        'gone.bin': 'D:false:true'
      })
    })

    it('tree の差分に既にあるパスは、除外の変化として重ねて出さない', async () => {
      const start = makeSnapshot({ excluded: [file('big.bin', 1, 1)] })
      const end = makeSnapshot()
      stubGit({ diffTree: nul('M', 'big.bin') })
      const entries = await collectAgentChangeEntriesBetween(start, end)
      expect(entries.map((e) => `${e.path}:${e.status}`)).toEqual(['big.bin:M'])
    })
  })

  describe('コミットの無い入れ子のリポジトリの出現・削除', () => {
    it('終わりにだけあれば A、始まりにだけあれば D(フォルダの行)。両端にあれば出さない', async () => {
      const start = makeSnapshot({ skippedRepos: ['both/', 'removed/'] })
      const end = makeSnapshot({ skippedRepos: ['both/', 'added/'] })
      stubGit({})
      expect(summarize(await collectAgentChangeEntriesBetween(start, end))).toEqual({
        'added/': 'A:true:true',
        'removed/': 'D:true:true'
      })
    })

    it('もう片方の端で ignore 済みなどで記録していなければ、有無が分からないため出さない', async () => {
      const start = makeSnapshot({
        skippedRepos: ['removed/'],
        ignoredAtBaseline: ['added/']
      })
      const end = makeSnapshot({
        skippedRepos: ['added/'],
        ignoredAtBaseline: ['removed/']
      })
      stubGit({})
      expect(await collectAgentChangeEntriesBetween(start, end)).toEqual([])
    })
  })

  it('結果はパスの順に並ぶ', async () => {
    const start = makeSnapshot({ skippedRepos: [] })
    const end = makeSnapshot({ skippedRepos: ['a-repo/'] })
    stubGit({ diffTree: nul('A', 'z.txt', 'A', 'b.txt') })
    expect((await collectAgentChangeEntriesBetween(start, end)).map((e) => e.path)).toEqual([
      'a-repo/',
      'b.txt',
      'z.txt'
    ])
  })
})

describe('listAgentChangesBetween', () => {
  it('上限で打ち切り、始まりと終わりの HEAD が違えば headChanged', async () => {
    const files = Array.from(
      { length: AGENT_CHANGES_LIST_LIMIT + 1 },
      (_, i) => `f${String(i).padStart(4, '0')}.txt`
    )
    stubGit({ diffTree: files.map((f) => nul('A', f)).join('') })
    const list = await listAgentChangesBetween(makeSnapshot(), makeSnapshot({ head: 'head-2' }))
    expect(list.entries).toHaveLength(AGENT_CHANGES_LIST_LIMIT)
    expect(list).toMatchObject({
      totalCount: AGENT_CHANGES_LIST_LIMIT + 1,
      truncated: true,
      headChanged: true
    })
  })

  it('HEAD が同じで上限以内なら、headChanged も truncated も false', async () => {
    stubGit({ diffTree: nul('A', 'a.txt') })
    const list = await listAgentChangesBetween(makeSnapshot(), makeSnapshot())
    expect(list).toMatchObject({ totalCount: 1, truncated: false, headChanged: false })
  })
})
