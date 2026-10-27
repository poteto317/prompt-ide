import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertInsideTempDir, removeTempPathSync } from './tempDirGuard'

// テストの再帰削除の安全装置。消してよいのは一時ディレクトリの中の絶対パスだけで、それ以外は消さずに投げる
// (2026-10-26 に「.」を消した事故の再発防止)

const workDirs: string[] = []

afterEach(() => {
  for (const dir of workDirs.splice(0)) removeTempPathSync(dir)
})

const makeWorkDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'temp-dir-guard-test-'))
  workDirs.push(dir)
  return dir
}

describe('assertInsideTempDir', () => {
  it.each<[string, string | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['空のパス', ''],
    ['「.」(dirname の結果)', '.'],
    ['相対のパス', 'tmp/x']
  ])('%s は投げる', (_label, target) => {
    expect(() => assertInsideTempDir(target)).toThrow(
      '一時ディレクトリの中の絶対パスではないので消しません'
    )
  })

  it.each<[string, string]>([
    ['一時ディレクトリそのもの', tmpdir()],
    ['一時ディレクトリの外(作業ディレクトリ)', process.cwd()],
    ['ルート', resolve('/')],
    ['.. で一時ディレクトリの外に出るパス', join(tmpdir(), '..', 'outside')]
  ])('%s は投げる', (_label, target) => {
    expect(() => assertInsideTempDir(target)).toThrow('一時ディレクトリの外なので消しません')
  })

  it('一時ディレクトリの中の絶対パスは、正規化したパスを返す', () => {
    const dir = makeWorkDir()
    expect(assertInsideTempDir(join(dir, 'a', '..', 'b'))).toBe(join(dir, 'b'))
  })

  it('一時ディレクトリの realpath の下のパスも中として扱う', () => {
    const dir = realpathSync(makeWorkDir())
    expect(assertInsideTempDir(dir)).toBe(dir)
  })
})

describe('removeTempPathSync', () => {
  it('一時ディレクトリの中のディレクトリを中身ごと消す', () => {
    const dir = makeWorkDir()
    const target = join(dir, 'nested')
    mkdirSync(join(target, 'deep'), { recursive: true })
    writeFileSync(join(target, 'deep', 'file.txt'), 'x')
    removeTempPathSync(target)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(dir)).toBe(true)
  })

  it('一時ディレクトリの外のパスは消さずに投げる', () => {
    // ガードが壊れていても何も消えないよう、存在しない外のパスで確かめる(作業ディレクトリなどは渡さない)
    const outside = resolve('/', 'prompt-ide-temp-dir-guard-test-missing')
    expect(() => removeTempPathSync(outside)).toThrow('一時ディレクトリの外なので消しません')
  })
})
