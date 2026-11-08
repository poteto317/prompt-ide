import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FolderChangeEvent } from '@shared/types'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderChangeWatcher } from '../folderChangeWatcher'
import { createTestTimers } from './helpers/processProbe'

// 実物の fs.watch の recursive で、分類どおりに送る・送らないことを確かめる(設計書 1 章「実物で確かめたこと」)。
// Linux は監視を張らない(設計書 2 章の 5)ので確かめない
describe.skipIf(process.platform === 'linux')(
  'FolderChangeWatcher(実物の fs.watch の recursive)',
  () => {
    const timers = createTestTimers()
    let root: string
    let watcher: FolderChangeWatcher
    let notified: FolderChangeEvent[]

    beforeEach(async () => {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'folder-change-watcher-')))
      mkdirSync(join(root, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true })
      mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
      mkdirSync(join(root, '.git'))
      notified = []
      watcher = new FolderChangeWatcher({
        watch: (folder, listener) =>
          watch(folder, { recursive: true, persistent: false }, listener),
        getFolder: () => root,
        notify: (_ownerId, event) => notified.push(event),
        platform: process.platform,
        waitMs: 30,
        maxWaitMs: 100
      })
      watcher.enable(1)
      // 監視を張る前に作ったフォルダの通知が遅れて届くことがあるため、落ち着くのを待ってから数える
      await timers.delay(400)
      notified = []
    })

    afterEach(() => {
      watcher.disable(1)
      timers.clearAll()
      removeTempPathSync(root)
    })

    async function waitForNotification(): Promise<FolderChangeEvent | null> {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        if (notified.length > 0) return notified[0]
        await timers.delay(20)
      }
      return null
    }

    it('根の直下のファイルの作成 → treeChanged: true', async () => {
      writeFileSync(join(root, 'top.txt'), 'x')
      expect(await waitForNotification()).toEqual({ treeChanged: true })
    })

    it('7 段目のファイル → treeChanged: false', async () => {
      writeFileSync(join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'deep.txt'), 'x')
      expect(await waitForNotification()).toEqual({ treeChanged: false })
    })

    it('.git/index の書き込み → treeChanged: false', async () => {
      writeFileSync(join(root, '.git', 'index'), 'x')
      expect(await waitForNotification()).toEqual({ treeChanged: false })
    })

    it.each([
      ['node_modules/x/y.js', ['node_modules', 'x', 'y.js']],
      ['.git/index.lock', ['.git', 'index.lock']]
    ])('%s だけ → 送らない(続く根の直下の作成は送る)', async (_label, segments) => {
      writeFileSync(join(root, ...segments), 'x')
      await timers.delay(600)
      expect(notified).toEqual([])
      // 監視が生きていることを確かめる(送らないのが壊れた監視のせいでないこと。L-174)
      writeFileSync(join(root, 'after.txt'), 'x')
      expect(await waitForNotification()).toEqual({ treeChanged: true })
    })
  }
)
