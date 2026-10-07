import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SimpleGit } from 'simple-git'
import {
  AGENT_BASELINE_BLOB_MISSING_MESSAGE,
  assertBaselineIndex,
  containsNotRecorded,
  hasIgnoredInside,
  isNotRecordedPath,
  toBaselineQueryError
} from '../agentBaselineCoverage'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const snapshotWith = (excluded: string[], skippedRepos: string[] = []): BaselineSnapshot =>
  makeBaselineSnapshot({
    excluded: excluded.map((path) => ({ path, size: 1, mtimeMs: 0 })),
    skippedRepos
  })

describe('containsNotRecorded', () => {
  it('除外したファイルが配下にあれば true', () => {
    expect(containsNotRecorded(snapshotWith(['a/b/big.bin']), 'a/')).toBe(true)
  })

  it('記録から外した入れ子のリポジトリが配下にあれば true', () => {
    expect(containsNotRecorded(snapshotWith([], ['a/sub/']), 'a/')).toBe(true)
  })

  it('フォルダそのものが入れ子のリポジトリでも true(前方一致)', () => {
    expect(containsNotRecorded(snapshotWith([], ['a/']), 'a/')).toBe(true)
  })

  it('名前の前方が同じ別のフォルダ(ab/)の中身は a/ に含めない', () => {
    expect(containsNotRecorded(snapshotWith(['ab/big.bin'], ['ab/sub/']), 'a/')).toBe(false)
  })

  it('何も除外していなければ false', () => {
    expect(containsNotRecorded(snapshotWith([]), 'a/')).toBe(false)
  })
})

describe('isNotRecordedPath', () => {
  it('除外したファイルと完全一致なら true', () => {
    expect(isNotRecordedPath(snapshotWith(['a/big.bin']), 'a/big.bin')).toBe(true)
  })

  it('除外したファイルの親フォルダ・前方が同じ別名は false(完全一致だけ)', () => {
    const snapshot = snapshotWith(['a/big.bin'])
    expect(isNotRecordedPath(snapshot, 'a')).toBe(false)
    expect(isNotRecordedPath(snapshot, 'a/big')).toBe(false)
  })

  it("入れ子のリポジトリ('sub/')は末尾の '/' を落とした 'sub' で一致する", () => {
    expect(isNotRecordedPath(snapshotWith([], ['sub/']), 'sub')).toBe(true)
  })

  it("入れ子のリポジトリに 'sub/' を渡しても一致しない('sub//' と比べる)", () => {
    expect(isNotRecordedPath(snapshotWith([], ['sub/']), 'sub/')).toBe(false)
  })

  it('入れ子のリポジトリの中のファイルは false', () => {
    expect(isNotRecordedPath(snapshotWith([], ['sub/']), 'sub/file.txt')).toBe(false)
  })
})

describe('toBaselineQueryError', () => {
  it('unable to read <sha> を blob 欠落の文言に置き換え、元のエラーを cause に保つ', () => {
    const original = new Error('fatal: unable to read 0123456789abcdef')
    const converted = toBaselineQueryError(original)
    expect(converted).toBeInstanceOf(Error)
    expect((converted as Error).message).toBe(AGENT_BASELINE_BLOB_MISSING_MESSAGE)
    expect((converted as Error).cause).toBe(original)
  })

  it('sha が短すぎる(7 桁未満)ものは置き換えない', () => {
    const original = new Error('fatal: unable to read abc12')
    expect(toBaselineQueryError(original)).toBe(original)
  })

  it('それ以外のエラーはそのまま返す', () => {
    const original = new Error('fatal: something else')
    expect(toBaselineQueryError(original)).toBe(original)
  })

  it('Error でない値はそのまま返す', () => {
    expect(toBaselineQueryError('unable to read 0123456789abcdef')).toBe(
      'unable to read 0123456789abcdef'
    )
  })
})

describe('assertBaselineIndex', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-baseline-coverage-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('ファイルがあれば解決する', async () => {
    const indexPath = join(dir, 'index')
    writeFileSync(indexPath, '')
    await expect(assertBaselineIndex(indexPath)).resolves.toBeUndefined()
  })

  it('無ければ「記録が見つかりません」で拒否する', async () => {
    await expect(assertBaselineIndex(join(dir, 'missing'))).rejects.toThrow('記録が見つかりません')
  })

  it('ファイルでなければ(フォルダ)拒否する', async () => {
    const indexPath = join(dir, 'index')
    mkdirSync(indexPath)
    await expect(assertBaselineIndex(indexPath)).rejects.toThrow('記録が見つかりません')
  })
})

describe('hasIgnoredInside', () => {
  const gitReturning = (output: string): { git: SimpleGit; raw: ReturnType<typeof vi.fn> } => {
    const raw = vi.fn().mockResolvedValue(output)
    return { git: { raw } as unknown as SimpleGit, raw }
  }

  it("ignore されたものがあれば true。フォルダは '/' を補ってリテラルの pathspec で問い合わせる", async () => {
    const { git, raw } = gitReturning('a/.env\0')
    await expect(hasIgnoredInside(git, 'a')).resolves.toBe(true)
    expect(raw).toHaveBeenCalledWith([
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '--',
      ':(literal)a/'
    ])
  })

  it("末尾に '/' があれば重ねない", async () => {
    const { git, raw } = gitReturning('')
    await expect(hasIgnoredInside(git, 'a/')).resolves.toBe(false)
    expect(raw.mock.calls[0][0].at(-1)).toBe(':(literal)a/')
  })
})
