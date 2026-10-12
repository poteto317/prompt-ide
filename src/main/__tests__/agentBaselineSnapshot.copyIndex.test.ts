import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 写しの最中に写しの元(利用者の .git/index)が書き直される場面を作るため、copyFile の後に写しの元の更新時刻を進める
const afterCopy = vi.hoisted(() => ({ hook: null as ((source: string) => void) | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const copyFile = async (...args: Parameters<typeof actual.copyFile>): Promise<void> => {
    await actual.copyFile(...args)
    afterCopy.hook?.(String(args[0]))
  }
  return { ...actual, copyFile, default: { ...actual, copyFile } }
})

import { copyIndexPreservingTimes } from '../agentBaselineSnapshot'

describe('copyIndexPreservingTimes(写しの元が写しの直後に書き直されたとき)', () => {
  let dir: string | null = null
  afterEach(() => {
    afterCopy.hook = null
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
    afterCopy.hook = (path) => utimesSync(path, rewritten, rewritten)
    await expect(copyIndexPreservingTimes(source, target, { required: true })).resolves.toBe(true)
    // 写しの直後に写しの元が書き直された(場面が作れている)
    expect(statSync(source).mtimeMs).toBe(rewritten.getTime())
    expect(statSync(target).mtimeMs).toBe(before.getTime())
  })
})
