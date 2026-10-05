import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FolderAccessManager } from '../../folderAccessManager'
import { OpenFileWatcher } from '../../openFileWatcher'
import { registerExternalChangeHandlers } from '../../handlers/externalChangeHandlers'

// 実物のファイルシステムで、照合付きの保存がフォルダの外へ書き込まないことを確かめる(モックでは
// シンボリックリンクを辿る書き込みを再現できない)
type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const event = { sender: { id: 1 } }

let root: string
let work: string
let out: string

beforeEach(() => {
  handles.clear()
  root = realpathSync(mkdtempSync(join(tmpdir(), 'write-file-checked-')))
  work = join(root, 'work')
  out = join(root, 'out')
  mkdirSync(work)
  mkdirSync(out)
  const folderAccess = new FolderAccessManager()
  folderAccess.set(1, work)
  const watcher = new OpenFileWatcher({ watch: vi.fn(), notify: vi.fn() })
  registerExternalChangeHandlers(ipcMain as never, folderAccess, watcher)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const writeChecked = (path: string, content: string, base: string | null): Promise<unknown> =>
  handles.get('fs:writeFileChecked')?.(event, path, content, base) as Promise<unknown>

describe('fs:writeFileChecked(実物のファイルシステム)', () => {
  it('フォルダ外の存在しないパスを指すシンボリックリンクを辿って外へ書き込まない', async () => {
    const outside = join(out, 'new.txt')
    const link = join(work, 'a.ts')
    symlinkSync(outside, link)
    await expect(writeChecked(link, 'escaped', null)).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
    expect(existsSync(outside)).toBe(false)
  })

  it('削除されたファイルは作り直せる', async () => {
    const file = join(work, 'a.ts')
    await expect(writeChecked(file, 'again', null)).resolves.toEqual({ kind: 'written' })
    expect(readFileSync(file, 'utf8')).toBe('again')
  })

  it('存在するファイルは基準が null なら上書きする', async () => {
    const file = join(work, 'a.ts')
    writeFileSync(file, 'agent')
    await expect(writeChecked(file, 'mine', null)).resolves.toEqual({ kind: 'written' })
    expect(readFileSync(file, 'utf8')).toBe('mine')
  })
})
