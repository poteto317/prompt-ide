import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenFileWatcher } from '../openFileWatcher'
import { createTestTimers } from './helpers/processProbe'

// 実物の fs.watch で、その場の書き込み・rename での置き換え・削除が通知されることを確かめる(確認の結果 11)
const timers = createTestTimers()
let dir: string
let watcher: OpenFileWatcher
let notified: string[][]

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-file-watcher-')))
  writeFileSync(join(dir, 'a.txt'), 'one')
  notified = []
  watcher = new OpenFileWatcher({
    watch,
    notify: (_owner, paths) => notified.push(paths),
    debounceMs: 30
  })
})

afterEach(() => {
  watcher.clear(1)
  timers.clearAll()
  removeTempPathSync(dir)
})

async function waitForNotification(path: string): Promise<boolean> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (notified.some((paths) => paths.includes(path))) return true
    await timers.delay(20)
  }
  return false
}

describe('OpenFileWatcher(実物の fs.watch)', () => {
  it.each([
    ['その場の書き込み', (file: string) => writeFileSync(file, 'two')],
    [
      'rename での置き換え',
      (file: string) => {
        writeFileSync(`${file}.tmp`, 'three')
        renameSync(`${file}.tmp`, file)
      }
    ],
    [
      '取り消しの書き戻し(同じフォルダの一時の名前 + rename)',
      (file: string) => {
        const temp = join(dir, '.prompt-ide-undo-0123456789abcdef')
        writeFileSync(temp, 'four')
        renameSync(temp, file)
      }
    ],
    ['削除', (file: string) => unlinkSync(file)]
  ])('%s を通知する', async (_label, change) => {
    const file = join(dir, 'a.txt')
    watcher.setWatchedFiles(1, [file])
    // 監視を始めた直後に、始める前の書き込みのイベントが届くことがあるため、落ち着くのを待ってから数える
    await timers.delay(200)
    notified = []
    change(file)
    expect(await waitForNotification(file)).toBe(true)
  })
})
