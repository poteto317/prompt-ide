import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 写しの最中に写しの元(利用者の .git/index)が書き直される・消える場面を作るため、copyFile の前後に手を入れる
const copyHooks = vi.hoisted(() => ({
  before: null as ((source: string) => void) | null,
  after: null as ((source: string) => void) | null
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const copyFile = async (...args: Parameters<typeof actual.copyFile>): Promise<void> => {
    copyHooks.before?.(String(args[0]))
    await actual.copyFile(...args)
    copyHooks.after?.(String(args[0]))
  }
  return { ...actual, copyFile, default: { ...actual, copyFile } }
})

import { copyIndexPreservingTimes } from '../agentBaselineSnapshot'

describe('copyIndexPreservingTimes(写しの最中に写しの元が書き直された・消えたとき)', () => {
  let dir: string | null = null
  afterEach(() => {
    copyHooks.before = null
    copyHooks.after = null
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('写す前の更新時刻を引き継ぐ(写しは古い中身のため、新しい時刻を付けて racy-git の守りを外さない)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'copy-index-race-'))
    const source = join(dir, 'source')
    const target = join(dir, 'target')
    writeFileSync(source, 'index')
    const before = new Date('2020-01-02T03:04:05Z')
    utimesSync(source, before, before)
    const rewritten = new Date('2020-01-02T03:04:09Z')
    copyHooks.after = (path) => utimesSync(path, rewritten, rewritten)
    await expect(copyIndexPreservingTimes(source, target, { required: true })).resolves.toBe(true)
    // 写しの直後に写しの元が書き直された(場面が作れている)
    expect(statSync(source).mtimeMs).toBe(rewritten.getTime())
    expect(statSync(target).mtimeMs).toBe(before.getTime())
  })

  it('更新時刻を読んだ後、写す前に写しの元が消えたら、required でなければ false(無いときと同じく空から始める)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'copy-index-race-'))
    const source = join(dir, 'source')
    writeFileSync(source, 'index')
    copyHooks.before = (path) => rmSync(path)
    await expect(
      copyIndexPreservingTimes(source, join(dir, 'target'), { required: false })
    ).resolves.toBe(false)
  })

  it('更新時刻を読んだ後、写す前に写しの元が消えたら、required なら例外(空から始めない)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'copy-index-race-'))
    const source = join(dir, 'source')
    writeFileSync(source, 'index')
    copyHooks.before = (path) => rmSync(path)
    await expect(
      copyIndexPreservingTimes(source, join(dir, 'target'), { required: true })
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
