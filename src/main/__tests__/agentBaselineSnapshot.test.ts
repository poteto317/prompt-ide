import { describe, it, expect, expectTypeOf, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SimpleGit } from 'simple-git'
import {
  AGENT_BASELINE_EXCLUDE_FILE_BYTES,
  AGENT_BASELINE_MAX_UNTRACKED_BYTES,
  AGENT_BASELINE_MAX_UNTRACKED_FILES,
  copyIndexPreservingTimes,
  forceRemoveStdinInput,
  inspectUntracked,
  notRecordedPathsOf,
  parseWriteTreeOutput
} from '../agentBaselineSnapshot'
import { MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES } from '../gitService'

describe('記録の上限', () => {
  it('除外の閾値は diff の未追跡の上限と同じ値(片方だけ変わったら気づく)', () => {
    expect(AGENT_BASELINE_EXCLUDE_FILE_BYTES).toBe(MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES)
    expect(AGENT_BASELINE_EXCLUDE_FILE_BYTES).toBe(5 * 1024 * 1024)
  })

  it('未追跡の数と合計の大きさの上限', () => {
    expect(AGENT_BASELINE_MAX_UNTRACKED_FILES).toBe(5_000)
    expect(AGENT_BASELINE_MAX_UNTRACKED_BYTES).toBe(100 * 1024 * 1024)
  })
})

describe('copyIndexPreservingTimes', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir !== null) removeTempPathSync(dir)
    dir = null
  })
  const makeDir = (): string => {
    dir = mkdtempSync(join(tmpdir(), 'copy-index-'))
    return dir
  }

  it('写しの元を写し、更新時刻を引き継ぐ(racy-git の守りを写しの元と同じにする)', async () => {
    const root = makeDir()
    const source = join(root, 'source')
    const target = join(root, 'target')
    writeFileSync(source, 'index')
    const mtime = new Date('2020-01-02T03:04:05Z')
    utimesSync(source, mtime, mtime)
    await expect(copyIndexPreservingTimes(source, target, { required: true })).resolves.toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('index')
    expect(statSync(target).mtimeMs).toBe(statSync(source).mtimeMs)
  })

  it('写しの元が無く required でなければ false(空から始める)', async () => {
    const root = makeDir()
    await expect(
      copyIndexPreservingTimes(join(root, 'missing'), join(root, 'target'), { required: false })
    ).resolves.toBe(false)
  })

  it('写しの元が無く required なら例外(空から始めない。L-002)', async () => {
    const root = makeDir()
    await expect(
      copyIndexPreservingTimes(join(root, 'missing'), join(root, 'target'), { required: true })
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('写し先が既にあれば例外(COPYFILE_EXCL)', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'source'), 'a')
    writeFileSync(join(root, 'target'), 'b')
    await expect(
      copyIndexPreservingTimes(join(root, 'source'), join(root, 'target'), { required: false })
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })
})

describe('notRecordedPathsOf', () => {
  it('除外したファイルのパスと、入れ子のリポジトリの末尾の / を外したパスを並べる', () => {
    expect(
      notRecordedPathsOf({
        excluded: [{ path: 'big.bin', size: 1, mtimeMs: 1, dev: 1, ino: 1 }],
        skippedRepos: ['sub/', 'a b/']
      })
    ).toEqual(['big.bin', 'sub', 'a b'])
  })

  it('どちらも無ければ空', () => {
    expect(notRecordedPathsOf({ excluded: [], skippedRepos: [] })).toEqual([])
  })
})

describe('parseWriteTreeOutput', () => {
  it('末尾の改行を除いた SHA-1・SHA-256 の ID を返す', () => {
    const sha1 = 'a'.repeat(40)
    const sha256 = 'b'.repeat(64)
    expect(parseWriteTreeOutput(`${sha1}\n`)).toBe(sha1)
    expect(parseWriteTreeOutput(sha256)).toBe(sha256)
  })

  it('object の ID の形でなければ例外(空の出力・途中の長さ・大文字)', () => {
    expect(() => parseWriteTreeOutput('')).toThrow('write-tree の出力が不正です')
    expect(() => parseWriteTreeOutput('a'.repeat(41))).toThrow('write-tree の出力が不正です')
    expect(() => parseWriteTreeOutput('A'.repeat(40))).toThrow('write-tree の出力が不正です')
  })
})

// ローカルレビュー第 3 周の指摘 1。update-index --force-remove は外すたびに後ろのエントリを詰めるため、index の昇順に渡すと
// 件数の 2 乗の時間になる。index の並び(名前のバイト列の順)の降順に渡す
describe('forceRemoveStdinInput', () => {
  it('パスを index の並びの降順にし、NUL 区切りで末尾にも NUL を付ける', () => {
    expect(forceRemoveStdinInput(['deps/a.js', 'deps/b.js', 'a.txt', 'deps/a.js/x'])).toBe(
      'deps/b.js\0deps/a.js/x\0deps/a.js\0a.txt\0'
    )
  })

  it('並びは UTF-8 のバイト列の順で、UTF-16 の文字列の比較と違う非 ASCII の名前もバイト順に並べる', () => {
    // U+FF5A(EF BD 9A)と U+1F600(F0 9F 98 80)。UTF-16 では U+1F600(D83D …)の方が小さいが、バイト列では大きい
    const fullwidth = '\uFF5A.txt'
    const emoji = '\u{1F600}.txt'
    expect(emoji < fullwidth).toBe(true)
    expect(forceRemoveStdinInput([fullwidth, emoji, 'z.txt'])).toBe(
      `${emoji}\0${fullwidth}\0z.txt\0`
    )
  })

  it('空なら空文字列', () => {
    expect(forceRemoveStdinInput([])).toBe('')
  })
})

describe('inspectUntracked(未追跡の一覧の問い合わせと解釈の 1 か所)', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir !== null) removeTempPathSync(dir)
    dir = null
  })

  // 渡された git に問い合わせた引数を控え、NUL 区切りの一覧を返す偽の git
  const fakeGit = (paths: readonly string[]): SimpleGit & { raw: Mock } => {
    const raw = vi.fn(async () => paths.map((path) => `${path}\0`).join(''))
    return { raw } as unknown as SimpleGit & { raw: Mock }
  }

  it('渡された git に ls-files -z --others --exclude-standard を 1 回だけ問い合わせ、数が上限を超えたら too-many(ファイルを読まない)', async () => {
    const git = fakeGit(
      Array.from({ length: AGENT_BASELINE_MAX_UNTRACKED_FILES + 1 }, (_, i) => `f${i}.txt`)
    )
    await expect(inspectUntracked('/nonexistent-folder', git, {})).resolves.toEqual({
      kind: 'too-many',
      count: AGENT_BASELINE_MAX_UNTRACKED_FILES + 1,
      bytes: 0
    })
    expect(git.raw.mock.calls).toEqual([[['ls-files', '-z', '--others', '--exclude-standard']]])
  })

  it('一覧のファイルを数え、消えたファイルは飛ばして ok を返す', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inspect-untracked-'))
    writeFileSync(join(dir, 'a.txt'), 'hello')
    const git = fakeGit(['a.txt', 'gone.txt'])
    await expect(inspectUntracked(dir, git, {})).resolves.toEqual({
      kind: 'ok',
      excluded: [],
      skippedRepos: []
    })
  })
})

describe('inspectUntracked の選択肢の型', () => {
  it('打ち切りだけを受け取る(入れ子のリポジトリの HEAD は createRepoGit で問い合わせ、記録の環境変数・-c は付けない)', () => {
    type Options = Parameters<typeof inspectUntracked>[2]
    expectTypeOf<keyof Options>().toEqualTypeOf<'timeoutMs'>()
  })
})
