import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepStaleBaselineTempDirs } from '../agentBaselineTempSweep'

// 起動時の掃除(設計書「記録の一時ディレクトリの名前と起動時の掃除」)を実 fs で試す。pid の生死は偽物(ALIVE だけが生きている)
const isRoot = process.getuid?.() === 0
const SELF = '300-0000beef'
const ALIVE = 200
const isProcessAlive = (pid: number): boolean => pid === ALIVE
const nameOf = (pid: number, hex = '0000abcd', suffix = 'Ab12Cd'): string =>
  `prompt-ide-agent-baseline-${pid}-${hex}-${suffix}`

describe('sweepStaleBaselineTempDirs(実 fs)', () => {
  let tempRoot: string
  let outside: string
  // 権限を落としたフォルダ(後始末の前に戻す)
  const lockedDirs: string[] = []

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'baseline-sweep-'))
    outside = mkdtempSync(join(tmpdir(), 'baseline-sweep-outside-'))
  })

  afterEach(() => {
    for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o700)
    for (const dir of [tempRoot, outside]) rmSync(dir, { recursive: true, force: true })
  })

  // 自分の形の名前の 0700 のディレクトリ(中に隠れた git の代わりのファイルを置く)
  const makeDir = (name: string, mode = 0o700): string => {
    const dir = join(tempRoot, name)
    mkdirSync(join(dir, 'git'), { recursive: true })
    writeFileSync(join(dir, 'git', 'HEAD'), 'ref: refs/heads/main\n')
    chmodSync(dir, mode)
    return dir
  }
  const sweep = (): Promise<number> =>
    sweepStaleBaselineTempDirs({ tempRoot, instanceId: SELF, isProcessAlive })

  it('pid のプロセスが無い自分の形の名前の 0700 のディレクトリを中身ごと消し、消した数を返す', async () => {
    makeDir(nameOf(100))
    await expect(sweep()).resolves.toBe(1)
    expect(readdirSync(tempRoot)).toEqual([])
  })

  // 残すものを 1 つずつ置き、消さずに 0 を返すことを確かめる(名前・持ち主の判定は agentBaselineTempSweep.test.ts。ここは実 fs の配線)
  it.each([
    ['生きている pid', (): string => makeDir(nameOf(ALIVE))],
    [
      '自分の instanceId(pid が無くても)',
      (): string => makeDir(`prompt-ide-agent-baseline-${SELF}-Zz99Yy`)
    ],
    ['古い形の名前', (): string => makeDir('prompt-ide-agent-baseline-Ab12Cd')],
    ['0777 のディレクトリ', (): string => makeDir(nameOf(101, '0000abcd', 'Perm77'), 0o777)],
    [
      'ファイル',
      (): string => {
        const file = join(tempRoot, nameOf(102))
        writeFileSync(file, 'not a dir')
        return file
      }
    ]
  ])('%s は残す', async (_label, prepare) => {
    const kept = prepare()
    await expect(sweep()).resolves.toBe(0)
    expect(existsSync(kept)).toBe(true)
  })

  it('自分の形の名前のシンボリックリンクは、リンクも指す先のディレクトリも消さない', async () => {
    const target = join(outside, 'target')
    mkdirSync(target, { mode: 0o700 })
    writeFileSync(join(target, 'keep.txt'), 'k\n')
    symlinkSync(target, join(tempRoot, nameOf(103)))
    await expect(sweep()).resolves.toBe(0)
    expect(existsSync(join(tempRoot, nameOf(103)))).toBe(true)
    expect(existsSync(join(target, 'keep.txt'))).toBe(true)
  })

  it.skipIf(isRoot)('1 つが消せなくても残りを試す(L-010)', async () => {
    const stuck = makeDir(nameOf(104, '0000abcd', 'Stuck1'))
    // 中のフォルダを書き込めなくすると、中身を消せずに rm が失敗する
    chmodSync(join(stuck, 'git'), 0o500)
    lockedDirs.push(join(stuck, 'git'))
    makeDir(nameOf(105, '0000abcd', 'Gone22'))
    await expect(sweep()).resolves.toBe(1)
    expect(existsSync(join(tempRoot, nameOf(105, '0000abcd', 'Gone22')))).toBe(false)
    expect(existsSync(stuck)).toBe(true)
  })

  it('一時ディレクトリの親を読めなければ 0 を返す(投げない)', async () => {
    await expect(
      sweepStaleBaselineTempDirs({
        tempRoot: join(tempRoot, 'missing'),
        instanceId: SELF,
        isProcessAlive
      })
    ).resolves.toBe(0)
  })
})
