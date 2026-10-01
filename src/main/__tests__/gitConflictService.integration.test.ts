import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  abortMerge,
  completeMerge,
  getConflictFile,
  keepConflictFile,
  markConflictResolved,
  removeConflictFile,
  resolveConflictBlocks,
  resolveConflictWholeFile
} from '../gitConflictService'
import { digestConflictBlocks, parseConflictFile } from '../gitConflictParser'
import {
  commitAll,
  initRepo,
  readRepoFile,
  runGit,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

let repo: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)
const read = (path: string): string => readRepoFile(repo, path)
const status = (): string[] => runGit(repo, 'status', '--porcelain').split('\n').filter(Boolean)

const lines = (...l: string[]): string => l.join('\n') + '\n'
// 2 つの変更がひとつのブロックにまとまらないよう、間に十分な行を置く
const MID = Array.from({ length: 10 }, (_, i) => `mid${i}`)
const BASE_F = lines('top', 'a1', ...MID, 'b1', 'bottom')
const binary = (marker: number): Buffer => Buffer.from([0x00, 0x01, marker, 0x00])

// main と feat で同じファイルを別々に変更してマージし、次の状態を同時に起こす:
// f.txt / g.txt = UU、del.txt = DU(自分が削除・相手が変更)、add.txt = AA、b.bin = UU(バイナリ)
function createConflicts(): void {
  write('f.txt', BASE_F)
  write('g.txt', lines('g-base'))
  write('del.txt', lines('del-base'))
  writeFileSync(join(repo, 'b.bin'), binary(0))
  commitAll(repo, 'base')

  runGit(repo, 'checkout', '-qb', 'feat')
  write('f.txt', lines('top', 'a-theirs', ...MID, 'b-theirs', 'bottom'))
  write('g.txt', lines('g-theirs'))
  write('del.txt', lines('del-theirs'))
  write('add.txt', lines('add-theirs'))
  writeFileSync(join(repo, 'b.bin'), binary(3))
  commitAll(repo, 'feat')

  runGit(repo, 'checkout', '-q', 'main')
  write('f.txt', lines('top', 'a-ours', ...MID, 'b-ours', 'bottom'))
  write('g.txt', lines('g-ours'))
  runGit(repo, 'rm', '-q', 'del.txt')
  write('add.txt', lines('add-ours'))
  writeFileSync(join(repo, 'b.bin'), binary(2))
  commitAll(repo, 'main')

  try {
    runGit(repo, 'merge', '--no-edit', 'feat')
  } catch {
    // コンフリクトで終了コード 1 になる(期待どおり)
  }
}

beforeEach(() => {
  stubIsolatedGitEnv()
  repo = mkdtempSync(join(tmpdir(), 'conflict-integration-'))
  initRepo(repo)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(repo, { recursive: true, force: true })
})

// 解決ビュー(ConflictResolver)と同じ順序: バイナリは「相手をすべて採用」→「解決済みにする」で解決する。
// checkout --theirs だけではステージ 1/2/3 が残り未解決のまま。解決済みにする(add)で初めて解決になる
describe('バイナリの AA を「相手をすべて採用」→「解決済みにする」で解決する(実 git)', () => {
  it('採用後も ls-files -u に残り、markConflictResolved で空になって completeMerge できる', async () => {
    write('base.txt', lines('base'))
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    writeFileSync(join(repo, 'new.bin'), binary(3))
    commitAll(repo, 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'new.bin'), binary(2))
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', '--no-edit', 'feat')
    } catch {
      // コンフリクトで終了コード 1 になる(期待どおり)
    }
    expect(status()).toContain('AA new.bin')
    const unmerged = (): string => runGit(repo, 'ls-files', '-u').trim()

    // 解決ビューの表示: バイナリで両側あり(→「すべて採用」と「解決済みにする」が出る)
    expect(await getConflictFile(repo, 'new.bin')).toEqual({
      status: 'unparsable',
      reason: 'binary',
      stages: { ours: true, theirs: true }
    })

    await resolveConflictWholeFile(repo, 'new.bin', 'theirs')
    expect(readFileSync(join(repo, 'new.bin'))).toEqual(binary(3))
    // 採用だけでは未解決のまま(ステージ 2/3 が残る)。完了もできない
    expect(unmerged()).not.toBe('')
    expect(await getConflictFile(repo, 'new.bin')).toMatchObject({
      status: 'unparsable',
      reason: 'binary'
    })
    await expect(completeMerge(repo)).rejects.toThrow('未解決のファイルがあるため完了できません')

    await markConflictResolved(repo, 'new.bin')
    expect(unmerged()).toBe('')

    await completeMerge(repo)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(readFileSync(join(repo, 'new.bin'))).toEqual(binary(3))
  })
})

describe('コンフリクトの作成(前提)', () => {
  it('UU / DU / AA / バイナリ UU が同時に起こる', () => {
    createConflicts()
    expect(status().sort()).toEqual([
      'AA add.txt',
      'DU del.txt',
      'UU b.bin',
      'UU f.txt',
      'UU g.txt'
    ])
  })
})

describe('getConflictFile(実 git)', () => {
  it('2 ブロックを解析し、ダイジェストも 2 つ返す', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'f.txt')
    expect(r.status).toBe('parsed')
    if (r.status !== 'parsed') return
    expect(r.digests).toHaveLength(2)
    expect(r.eol).toBe('\n')
    const conflicts = r.segments.filter((s) => s.kind === 'conflict')
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0]).toMatchObject({ ours: ['a-ours'], theirs: ['a-theirs'] })
  })

  it('未解決でないファイルは拒否する', async () => {
    createConflicts()
    write('other.txt', 'x')
    await expect(getConflictFile(repo, 'other.txt')).rejects.toThrow(
      'コンフリクト中のファイルではありません'
    )
  })

  it('バイナリの UU は unparsable(reason: binary)で、ステージ 2・3 が両方ある', async () => {
    createConflicts()
    expect(await getConflictFile(repo, 'b.bin')).toEqual({
      status: 'unparsable',
      reason: 'binary',
      stages: { ours: true, theirs: true }
    })
  })

  it('UU は stages が両方 true', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'f.txt')
    expect(r.stages).toEqual({ ours: true, theirs: true })
  })

  it('AA(両方が追加)は stages が両方 true', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'add.txt')
    expect(r.stages).toEqual({ ours: true, theirs: true })
  })

  it('DU(自分が削除・相手が変更)は stages が相手だけ true で、ブロックは無い', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'del.txt')
    expect(r.status).toBe('parsed')
    expect(r.stages).toEqual({ ours: false, theirs: true })
    if (r.status !== 'parsed') return
    expect(r.digests).toEqual([])
  })
})

describe('resolveConflictBlocks → markConflictResolved → completeMerge(実 git)', () => {
  it('1 つ目だけ ours にすると、もう一方のマーカーは残る', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'f.txt')
    if (r.status !== 'parsed') throw new Error('解析できません')
    await resolveConflictBlocks(repo, 'f.txt', r.digests, { 0: 'ours' })
    const text = read('f.txt')
    expect(text).toContain('a-ours')
    expect(text).not.toContain('a-theirs')
    expect(text).toContain('<<<<<<< HEAD')
    expect(text).toContain('b-theirs')
    // 一時ファイルは残らない
    expect(runGit(repo, 'ls-files', '--others').trim()).toBe('')
    // index は変わらない(未解決のまま)
    expect(status()).toContain('UU f.txt')
  })

  it('全部のブロックを選ぶとマーカーが無くなり、解決済み → 完了でマージコミットができる', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'f.txt')
    if (r.status !== 'parsed') throw new Error('解析できません')
    await resolveConflictBlocks(repo, 'f.txt', r.digests, { 0: 'ours', 1: 'both' })
    expect(read('f.txt')).toBe(lines('top', 'a-ours', ...MID, 'b-ours', 'b-theirs', 'bottom'))
    await markConflictResolved(repo, 'f.txt')
    await resolveConflictWholeFile(repo, 'g.txt', 'theirs')
    await markConflictResolved(repo, 'g.txt')
    await resolveConflictWholeFile(repo, 'add.txt', 'ours')
    await markConflictResolved(repo, 'add.txt')
    await resolveConflictWholeFile(repo, 'b.bin', 'theirs')
    await markConflictResolved(repo, 'b.bin')
    await removeConflictFile(repo, 'del.txt')

    await completeMerge(repo)

    expect(runGit(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(
      3
    )
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(runGit(repo, 'log', '-1', '--format=%s').trim()).toBe("Merge branch 'feat'")
    expect(read('g.txt')).toBe(lines('g-theirs'))
    expect(readFileSync(join(repo, 'b.bin'))).toEqual(binary(3))
    expect(existsSync(join(repo, 'del.txt'))).toBe(false)
  })

  it('確認時と構成が変わっていたら、何も書かない(ファイルは不変)', async () => {
    createConflicts()
    const r = await getConflictFile(repo, 'f.txt')
    if (r.status !== 'parsed') throw new Error('解析できません')
    // 確認後に、別の手段で 1 つ目のブロックの中身が変わった
    write('f.txt', read('f.txt').replace('a-ours', 'a-edited'))
    const before = read('f.txt')
    await expect(resolveConflictBlocks(repo, 'f.txt', r.digests, { 0: 'ours' })).rejects.toThrow(
      'ファイルが変更されたため中止しました。開き直してください'
    )
    expect(read('f.txt')).toBe(before)
  })

  it('手でマーカーを消した後の markConflictResolved は成功し、未解決でなくなる', async () => {
    createConflicts()
    write('f.txt', lines('top', 'handmade', 'bottom'))
    await markConflictResolved(repo, 'f.txt')
    expect(status()).toContain('M  f.txt')
  })

  it('マーカーが残っていると markConflictResolved は拒否し、git add されない', async () => {
    createConflicts()
    const before = runGit(repo, 'ls-files', '-u')
    await expect(markConflictResolved(repo, 'f.txt')).rejects.toThrow(
      'コンフリクトのマーカーが残っています'
    )
    expect(runGit(repo, 'ls-files', '-u')).toBe(before)
  })
})

describe('作業ツリーから消えたファイルの markConflictResolved(実 git)', () => {
  // git add は消えたファイルを削除としてステージして解決済みにしてしまうため、事前に拒否する
  it.each([
    ['UU', 'f.txt'],
    ['DU', 'del.txt']
  ])('%s のファイルが無いと拒否し、未解決のまま変わらない', async (_n, path) => {
    createConflicts()
    rmSync(join(repo, path), { force: true })
    const before = runGit(repo, 'ls-files', '-u')
    await expect(markConflictResolved(repo, path)).rejects.toThrow(
      'ファイルが存在しないため解決済みにできません'
    )
    expect(runGit(repo, 'ls-files', '-u')).toBe(before)
  })

  it('「削除する」(removeConflictFile)は、ファイルが無くても削除として解決できる', async () => {
    createConflicts()
    rmSync(join(repo, 'f.txt'), { force: true })
    await removeConflictFile(repo, 'f.txt')
    expect(runGit(repo, 'ls-files', '-u')).not.toContain('f.txt')
    expect(status()).toContain('D  f.txt')
  })
})

describe('resolveConflictWholeFile / keepConflictFile / removeConflictFile(実 git)', () => {
  it('UU: ours / theirs でそれぞれの内容になる', async () => {
    createConflicts()
    await resolveConflictWholeFile(repo, 'g.txt', 'ours')
    expect(read('g.txt')).toBe(lines('g-ours'))
    await resolveConflictWholeFile(repo, 'g.txt', 'theirs')
    expect(read('g.txt')).toBe(lines('g-theirs'))
  })

  it('AA: ours で自分の内容になる', async () => {
    createConflicts()
    await resolveConflictWholeFile(repo, 'add.txt', 'ours')
    expect(read('add.txt')).toBe(lines('add-ours'))
  })

  it('バイナリ UU: theirs で相手のバイト列になる', async () => {
    createConflicts()
    await resolveConflictWholeFile(repo, 'b.bin', 'theirs')
    expect(readFileSync(join(repo, 'b.bin'))).toEqual(binary(3))
  })

  it('DU: 自分(削除した側)は拒否され、相手は成功する', async () => {
    createConflicts()
    await expect(resolveConflictWholeFile(repo, 'del.txt', 'ours')).rejects.toThrow(
      'この側にはファイルがありません。「ファイルを残す」か「削除する」を選んでください'
    )
    expect(status()).toContain('DU del.txt')
    await resolveConflictWholeFile(repo, 'del.txt', 'theirs')
    expect(read('del.txt')).toBe(lines('del-theirs'))
  })

  it('DU: ファイルを残す(作業ツリーに相手の版が置かれており、add で解決)', async () => {
    createConflicts()
    await keepConflictFile(repo, 'del.txt')
    expect(status()).toContain('A  del.txt')
    expect(read('del.txt')).toBe(lines('del-theirs'))
  })

  it('DU: 作業ツリーから消えていても、ファイルを残すと相手の版で解決する', async () => {
    createConflicts()
    rmSync(join(repo, 'del.txt'))
    await keepConflictFile(repo, 'del.txt')
    expect(status()).toContain('A  del.txt')
    expect(read('del.txt')).toBe(lines('del-theirs'))
  })

  it('UU のファイルは「ファイルを残す」を拒否し、マーカー入りをステージしない', async () => {
    createConflicts()
    await expect(keepConflictFile(repo, 'g.txt')).rejects.toThrow('使えません')
    expect(status()).toContain('UU g.txt')
  })

  it('DU: 削除するとファイルが消えて解決する', async () => {
    createConflicts()
    await removeConflictFile(repo, 'del.txt')
    expect(existsSync(join(repo, 'del.txt'))).toBe(false)
    expect(status()).not.toContain('DU del.txt')
    expect(runGit(repo, 'ls-files', '-u', '--', 'del.txt')).toBe('')
  })
})

describe('completeMerge / abortMerge(実 git)', () => {
  it('未解決が残っていると完了を拒否し、MERGE_HEAD は残る', async () => {
    createConflicts()
    await expect(completeMerge(repo)).rejects.toThrow('未解決のファイルがあるため完了できません')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)
  })

  it('abortMerge でマージ前のコミットと作業ツリーに戻る', async () => {
    createConflicts()
    const head = runGit(repo, 'rev-parse', 'HEAD')
    await resolveConflictWholeFile(repo, 'g.txt', 'theirs')
    await markConflictResolved(repo, 'g.txt')
    await abortMerge(repo)
    expect(runGit(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(status()).toEqual([])
    expect(read('g.txt')).toBe(lines('g-ours'))
    expect(read('f.txt')).toBe(lines('top', 'a-ours', ...MID, 'b-ours', 'bottom'))
    expect(existsSync(join(repo, 'del.txt'))).toBe(false)
  })

  it('マージ中でないとき、完了も中止も拒否する', async () => {
    write('a.txt', 'a')
    commitAll(repo, 'init')
    await expect(completeMerge(repo)).rejects.toThrow('マージ中ではありません')
    await expect(abortMerge(repo)).rejects.toThrow('マージ中ではありません')
  })
})

describe('行ごとの改行コードの保持(実 git)', () => {
  it('CRLF の本文で最終行だけ LF のファイルを ours で解決しても、無関係な行の改行は変わらない', async () => {
    runGit(repo, 'config', 'core.autocrlf', 'false')
    write('crlf.txt', 'line1\r\nbase\r\nend\n')
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    write('crlf.txt', 'line1\r\ntheirs\r\nend\n')
    commitAll(repo, 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    write('crlf.txt', 'line1\r\nours\r\nend\n')
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', '--no-edit', 'feat')
    } catch {
      // コンフリクトで終了コード 1 になる(期待どおり)
    }
    const r = await getConflictFile(repo, 'crlf.txt')
    if (r.status !== 'parsed') throw new Error('解析できません')
    await resolveConflictBlocks(repo, 'crlf.txt', r.digests, { 0: 'ours' })
    expect(read('crlf.txt')).toBe('line1\r\nours\r\nend\n')
  })
})

// rebase 中(MERGE_HEAD が無い)は ours/theirs の意味がマージと逆になる(--ours が upstream 側)。
// 「自分を採用」でユーザー自身の変更を捨てないよう、解決ビューの操作はマージ中だけに限る
describe('CLI の rebase 中のコンフリクト(実 git)', () => {
  const NOT_MERGING = 'マージ中ではないため'

  function createRebaseConflict(): void {
    write('f.txt', lines('base'))
    write('del.txt', lines('del-base'))
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    write('f.txt', lines('feat'))
    write('del.txt', lines('del-feat'))
    commitAll(repo, 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    write('f.txt', lines('main'))
    runGit(repo, 'rm', '-q', 'del.txt')
    commitAll(repo, 'main')
    runGit(repo, 'checkout', '-q', 'feat')
    try {
      runGit(repo, 'rebase', 'main')
    } catch {
      // コンフリクトで止まる(期待どおり)
    }
  }

  it('前提: 未解決のファイルがあり、MERGE_HEAD は無い', () => {
    createRebaseConflict()
    expect(status().sort()).toEqual(['DU del.txt', 'UU f.txt'])
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  })

  it('getConflictFile と書き換える 5 操作を拒否し、作業ツリーと index を変えない', async () => {
    createRebaseConflict()
    const before = { f: read('f.txt'), del: read('del.txt'), u: runGit(repo, 'ls-files', '-u') }
    await expect(getConflictFile(repo, 'f.txt')).rejects.toThrow(NOT_MERGING)
    const parsed = parseConflictFile(before.f)
    const digests = parsed ? digestConflictBlocks(parsed.segments) : []
    expect(digests).toHaveLength(1)
    await expect(resolveConflictBlocks(repo, 'f.txt', digests, { 0: 'ours' })).rejects.toThrow(
      NOT_MERGING
    )
    await expect(resolveConflictWholeFile(repo, 'f.txt', 'ours')).rejects.toThrow(NOT_MERGING)
    await expect(keepConflictFile(repo, 'del.txt')).rejects.toThrow(NOT_MERGING)
    await expect(removeConflictFile(repo, 'del.txt')).rejects.toThrow(NOT_MERGING)
    write('f.txt', lines('hand-resolved'))
    await expect(markConflictResolved(repo, 'f.txt')).rejects.toThrow(NOT_MERGING)
    write('f.txt', before.f)
    expect(read('f.txt')).toBe(before.f)
    expect(read('del.txt')).toBe(before.del)
    expect(runGit(repo, 'ls-files', '-u')).toBe(before.u)
    expect(status().sort()).toEqual(['DU del.txt', 'UU f.txt'])
  })
})

describe('UTF-8 として不正なファイル(Shift_JIS)のマーカー検査(実 git)', () => {
  // 「あ」の Shift_JIS = 0x82 0xA0(UTF-8 としては不正)
  const sjisLine = (tail: string): Buffer =>
    Buffer.concat([Buffer.from([0x82, 0xa0]), Buffer.from(tail)])
  const createSjisConflict = (): void => {
    writeFileSync(join(repo, 's.txt'), sjisLine('base\n'))
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    writeFileSync(join(repo, 's.txt'), sjisLine('theirs\n'))
    commitAll(repo, 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 's.txt'), sjisLine('ours\n'))
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', '--no-edit', 'feat')
    } catch {
      // コンフリクト
    }
  }

  it('マーカーが残っていれば拒否し、手で消した後は成功する', async () => {
    createSjisConflict()
    expect(status()).toContain('UU s.txt')
    expect(await getConflictFile(repo, 's.txt')).toEqual({
      status: 'unparsable',
      reason: 'markers',
      stages: { ours: true, theirs: true }
    })
    await expect(markConflictResolved(repo, 's.txt')).rejects.toThrow(
      'コンフリクトのマーカーが残っています'
    )
    expect(status()).toContain('UU s.txt')
    writeFileSync(join(repo, 's.txt'), sjisLine('handmade\n'))
    await markConflictResolved(repo, 's.txt')
    expect(status()).toContain('M  s.txt')
  })
})

describe('diff3 の ||||||| の検査(実 git)', () => {
  it('<<<<<<< / ======= / >>>>>>> だけ消して ||||||| を残したファイルは拒否する', async () => {
    runGit(repo, 'config', 'merge.conflictStyle', 'diff3')
    createConflicts()
    const text = read('g.txt')
    expect(text).toContain('|||||||')
    write(
      'g.txt',
      text
        .split('\n')
        .filter((l) => !/^(<<<<<<<|=======|>>>>>>>)/.test(l))
        .join('\n')
    )
    await expect(markConflictResolved(repo, 'g.txt')).rejects.toThrow(
      'コンフリクトのマーカーが残っています'
    )
  })
})

describe('シンボリックリンクのコンフリクト(実 git)', () => {
  // link は両方が別内容で作り直す(自分側は f.txt へのリンク)ため UU になり、f.txt も UU
  const createLinkConflict = (): void => {
    write('f.txt', BASE_F)
    symlinkSync('base-target', join(repo, 'link'))
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    write('f.txt', lines('top', 'a-theirs', ...MID, 'b-theirs', 'bottom'))
    rmSync(join(repo, 'link'))
    symlinkSync('theirs-target', join(repo, 'link'))
    commitAll(repo, 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    write('f.txt', lines('top', 'a-ours', ...MID, 'b-ours', 'bottom'))
    rmSync(join(repo, 'link'))
    symlinkSync('f.txt', join(repo, 'link'))
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', '--no-edit', 'feat')
    } catch {
      // コンフリクト
    }
  }
  const linkMode = (): string => runGit(repo, 'ls-files', '-s', 'link').split(' ')[0]

  it('リンクの先(f.txt)を読まず、書き換えず、種類(120000)も保つ', async () => {
    createLinkConflict()
    expect(status()).toEqual(expect.arrayContaining(['UU f.txt', 'UU link']))
    expect(lstatSync(join(repo, 'link')).isSymbolicLink()).toBe(true)

    expect(await getConflictFile(repo, 'link')).toEqual({
      status: 'unparsable',
      reason: 'not-regular',
      stages: { ours: true, theirs: true }
    })
    const f = await getConflictFile(repo, 'f.txt')
    if (f.status !== 'parsed') throw new Error('解析できません')
    await expect(
      resolveConflictBlocks(repo, 'link', f.digests, { 0: 'ours', 1: 'ours' })
    ).rejects.toThrow('コンフリクトのマーカーを解析できません')
    expect(lstatSync(join(repo, 'link')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(repo, 'link'))).toBe('f.txt')
    expect(read('f.txt')).toContain('<<<<<<<')

    // マーカー入りの f.txt を指すリンクでも、リンクそのものを解決済みにできる(モードは 120000 のまま)
    expect(linkMode()).toBe('120000')
    await markConflictResolved(repo, 'link')
    expect(runGit(repo, 'ls-files', '-s', 'link').split(' ')[0]).toBe('120000')
    expect(status()).not.toContain('UU link')
  })
})

describe('Markdown の見出し下線(=======)を含むファイル(実 git)', () => {
  it('ブロックを解決すれば解決済みにでき、マージを完了できる', async () => {
    write('m.md', 'Title\n=======\n\nbase\n')
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    write('m.md', 'Title\n=======\n\ntheirs\n')
    commitAll(repo, 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    write('m.md', 'Title\n=======\n\nmine\n')
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', '--no-edit', 'feat')
    } catch {
      // コンフリクト
    }
    expect(status()).toContain('UU m.md')
    const r = await getConflictFile(repo, 'm.md')
    if (r.status !== 'parsed') throw new Error('解析できません')
    await resolveConflictBlocks(repo, 'm.md', r.digests, { 0: 'ours' })
    expect(read('m.md')).toBe('Title\n=======\n\nmine\n')
    await markConflictResolved(repo, 'm.md')
    expect(status()).not.toContain('UU m.md')
    await completeMerge(repo)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(runGit(repo, 'show', 'HEAD:m.md')).toBe('Title\n=======\n\nmine\n')
  })
})

describe('サブモジュール(gitlink)のコンフリクト(実 git)', () => {
  const SUBMODULE_MESSAGE = 'サブモジュールのコンフリクトはターミナルで解決してください'
  let subSource: string

  // サブモジュールの参照先(コミットを 3 つ: 共通祖先・自分・相手)を作り、main と feat で
  // 別のコミットを指してマージする。sub = UU(ステージ 1/2/3 がすべて mode 160000)
  function createSubmoduleConflict(): void {
    subSource = mkdtempSync(join(tmpdir(), 'conflict-submodule-src-'))
    initRepo(subSource)
    const commit = (message: string): string => {
      runGit(subSource, 'commit', '-q', '--allow-empty', '-m', message)
      return runGit(subSource, 'rev-parse', 'HEAD').trim()
    }
    const base = commit('s-base')
    const ours = commit('s-ours')
    runGit(subSource, 'checkout', '-q', '-b', 'alt', base)
    const theirs = commit('s-theirs')

    const pointSubTo = (sha: string): void => {
      runGit(join(repo, 'sub'), 'checkout', '-q', sha)
      runGit(repo, 'add', 'sub')
    }
    runGit(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSource, 'sub')
    pointSubTo(base)
    runGit(repo, 'commit', '-qm', 'base')
    runGit(repo, 'checkout', '-qb', 'feat')
    pointSubTo(theirs)
    runGit(repo, 'commit', '-qm', 'feat')
    runGit(repo, 'checkout', '-q', 'main')
    pointSubTo(ours)
    runGit(repo, 'commit', '-qm', 'main')
    try {
      runGit(repo, 'merge', '--no-edit', 'feat')
    } catch {
      // コンフリクト
    }
  }

  afterEach(() => {
    rmSync(subSource, { recursive: true, force: true })
  })

  it('前提: sub は UU で、すべてのステージが mode 160000', () => {
    createSubmoduleConflict()
    expect(status()).toEqual(['UU sub'])
    const modes = runGit(repo, 'ls-files', '-u')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(' ')[0])
    expect(modes).toEqual(['160000', '160000', '160000'])
  })

  it('getConflictFile は reason: submodule を返す', async () => {
    createSubmoduleConflict()
    expect(await getConflictFile(repo, 'sub')).toEqual({
      status: 'unparsable',
      reason: 'submodule',
      stages: { ours: true, theirs: true }
    })
  })

  it('書き換える操作をすべて拒否し、index・.gitmodules・作業ツリーを変えない', async () => {
    createSubmoduleConflict()
    const subHead = (): string => runGit(join(repo, 'sub'), 'rev-parse', 'HEAD')
    const before = {
      u: runGit(repo, 'ls-files', '-u'),
      s: runGit(repo, 'ls-files', '-s'),
      gitmodules: read('.gitmodules'),
      subHead: subHead()
    }
    await expect(resolveConflictWholeFile(repo, 'sub', 'ours')).rejects.toThrow(SUBMODULE_MESSAGE)
    await expect(resolveConflictWholeFile(repo, 'sub', 'theirs')).rejects.toThrow(SUBMODULE_MESSAGE)
    await expect(markConflictResolved(repo, 'sub')).rejects.toThrow(SUBMODULE_MESSAGE)
    await expect(keepConflictFile(repo, 'sub')).rejects.toThrow(SUBMODULE_MESSAGE)
    // git rm はサブモジュールの作業ツリーを消し、.gitmodules からも外してしまう
    await expect(removeConflictFile(repo, 'sub')).rejects.toThrow(SUBMODULE_MESSAGE)
    await expect(resolveConflictBlocks(repo, 'sub', [], {})).rejects.toThrow(SUBMODULE_MESSAGE)
    expect(runGit(repo, 'ls-files', '-u')).toBe(before.u)
    expect(runGit(repo, 'ls-files', '-s')).toBe(before.s)
    expect(read('.gitmodules')).toBe(before.gitmodules)
    expect(subHead()).toBe(before.subHead)
    expect(status()).toEqual(['UU sub'])
  })
})
