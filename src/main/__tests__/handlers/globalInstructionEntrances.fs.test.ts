import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  webContents: { fromId: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() }
}))

import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderAccessManager } from '../../folderAccessManager'
import { OpenFileWatcher } from '../../openFileWatcher'
import { resolveGlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'
import { registerFileSystemHandlers } from '../../handlers/fileSystemHandlers'
import { registerExternalChangeHandlers } from '../../handlers/externalChangeHandlers'

type Listener = (...args: unknown[]) => Promise<unknown>
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const event = { sender: { id: 1 } }
const call = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handles.get(channel)
  if (handler === undefined) throw new Error(`not registered: ${channel}`)
  return handler(event, ...args)
}

let root: string
let home: string
let project: string
let globalFile: string
let folderAccess: FolderAccessManager
let watcher: OpenFileWatcher

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  handles.clear()
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-entrances-')))
  home = join(root, 'home')
  project = join(root, 'project')
  await mkdir(join(home, '.claude'), { recursive: true })
  await mkdir(project)
  globalFile = join(home, '.claude', 'CLAUDE.md')
  await writeFile(globalFile, 'g')
  folderAccess = new FolderAccessManager()
  watcher = new OpenFileWatcher({
    watch: vi.fn(() => ({ close: vi.fn(), on: vi.fn() })),
    notify: vi.fn()
  })
  const globalInstructions = resolveGlobalAgentInstructionContext({ env: {}, homeDir: home })
  registerFileSystemHandlers(ipcMain as never, folderAccess, globalInstructions)
  registerExternalChangeHandlers(ipcMain as never, folderAccess, watcher, globalInstructions)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempPath(root)
})

describe('全体の指示ファイルの入口', () => {
  it('fs:readFile → フォルダを開いていなくても読める', async () => {
    await expect(call('fs:readFile', globalFile)).resolves.toBe('g')
  })

  it.each([
    ['fs:readFile', []],
    ['fs:writeFile', ['w']],
    ['fs:writeFileChecked', ['w', 'o']]
  ] as const)('%s → フォルダの外のほかのパスは今までどおり断る', async (channel, extra) => {
    folderAccess.set(1, project)
    const other = join(home, 'other.md')
    await writeFile(other, 'o')
    await expect(call(channel, other, ...extra)).rejects.toThrow('Access denied')
    expect(await readFile(other, 'utf-8')).toBe('o')
    // どの入口も、断った後に新しいファイルが作られていないことも確かめる
    const absent = join(home, 'absent.md')
    await expect(call(channel, absent, ...extra)).rejects.toThrow()
    await expect(readFile(absent, 'utf-8')).rejects.toThrow()
  })

  it('fs:readFile → 消えた全体の指示ファイルは、パスを含まない文言で拒否', async () => {
    const missing = join(home, '.copilot', 'copilot-instructions.md')
    await expect(call('fs:readFile', missing)).rejects.toThrow('全体の指示ファイルが見つかりません')
    await expect(call('fs:readFile', missing)).rejects.not.toThrow(root)
  })

  it('fs:writeFile → 全体の指示ファイルに書ける', async () => {
    await call('fs:writeFile', globalFile, 'w')
    expect(await readFile(globalFile, 'utf-8')).toBe('w')
  })

  it('fs:writeFileChecked → 照合して書ける', async () => {
    await expect(call('fs:writeFileChecked', globalFile, 'c', 'g')).resolves.toEqual({
      kind: 'written'
    })
    expect(await readFile(globalFile, 'utf-8')).toBe('c')
  })

  it('fs:setWatchedFiles → フォルダが無くても全体の指示ファイルだけを監視し、ほかのパスを除く', async () => {
    const setWatched = vi.spyOn(watcher, 'setWatchedFiles')
    const other = join(project, 'a.md')
    await writeFile(other, 'a')
    await call('fs:setWatchedFiles', [globalFile, other])
    expect(setWatched).toHaveBeenCalledWith(1, [globalFile])
  })

  it('fs:setWatchedFiles → フォルダを開いていれば、フォルダの中と全体の指示ファイルの両方を監視する', async () => {
    folderAccess.set(1, project)
    const setWatched = vi.spyOn(watcher, 'setWatchedFiles')
    const inside = join(project, 'a.md')
    await writeFile(inside, 'a')
    await call('fs:setWatchedFiles', [globalFile, inside])
    expect(setWatched).toHaveBeenCalledWith(1, [globalFile, inside])
  })

  it('fs:renameEntry・fs:deleteEntry → 全体の指示ファイルは断る(変えない入口)', async () => {
    folderAccess.set(1, project)
    await expect(call('fs:renameEntry', globalFile, 'x.md')).rejects.toThrow('Access denied')
    await expect(call('fs:deleteEntry', globalFile)).rejects.toThrow('Access denied')
    expect(await readFile(globalFile, 'utf-8')).toBe('g')
  })

  it.skipIf(process.platform === 'win32')(
    'fs:readFile・fs:writeFileChecked → ホームの外へのリンクは、パスを含まない文言で拒否',
    async () => {
      const outside = join(root, 'outside.md')
      await writeFile(outside, 's')
      const copilotFile = join(home, '.copilot', 'copilot-instructions.md')
      await mkdir(join(home, '.copilot'))
      await symlink(outside, copilotFile)
      const prefix = '全体の指示ファイルはホームフォルダの外を指しているため、'
      // 呼び出しはループの中で 1 つずつ始めて待つ。配列の中で同時に始めると、後ろの拒否に受け手が付く前に
      // 拒否され、Unhandled Rejection になる
      for (const [run, denied] of [
        [() => call('fs:readFile', copilotFile), `${prefix}開けません`],
        [() => call('fs:writeFileChecked', copilotFile, 'c', 's'), `${prefix}保存できません`]
      ] as const) {
        const err = await run().then(
          () => null,
          (e: unknown) => e as Error
        )
        expect(err?.message).toContain(denied)
        expect(err?.message).not.toContain(root)
        expect(err?.message).not.toContain(outside)
      }
      expect(await readFile(outside, 'utf-8')).toBe('s')
    }
  )
})
