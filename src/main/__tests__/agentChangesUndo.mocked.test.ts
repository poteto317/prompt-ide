import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// fs/promises の readFile・lstat・chmod・mkdtemp・rename・readlink を包む(実物を呼ぶ前に差し込みを呼ぶ)
const hooks = vi.hoisted(() => ({
  readFilePaths: [] as string[],
  beforeLstat: null as ((path: string) => void) | null,
  failChmodFor: null as string | null,
  failMkdtemp: false,
  failRenameTo: null as string | null,
  failReadlinkFor: null as string | null
}))
const eio = (syscall: string): Error =>
  Object.assign(new Error(`EIO: i/o error, ${syscall}`), { code: 'EIO' })
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const wrapped = {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      hooks.readFilePaths.push(String(args[0]))
      return actual.readFile(...args)
    }) as typeof actual.readFile,
    lstat: (async (...args: Parameters<typeof actual.lstat>) => {
      hooks.beforeLstat?.(String(args[0]))
      return actual.lstat(...args)
    }) as typeof actual.lstat,
    chmod: (async (...args: Parameters<typeof actual.chmod>) => {
      if (hooks.failChmodFor === String(args[0])) throw eio('chmod')
      return actual.chmod(...args)
    }) as typeof actual.chmod,
    mkdtemp: (async (...args: Parameters<typeof actual.mkdtemp>) => {
      if (hooks.failMkdtemp) throw eio('mkdtemp')
      return actual.mkdtemp(...args)
    }) as typeof actual.mkdtemp,
    rename: (async (...args: Parameters<typeof actual.rename>) => {
      if (hooks.failRenameTo === String(args[1])) throw eio('rename')
      return actual.rename(...args)
    }) as typeof actual.rename,
    readlink: (async (...args: Parameters<typeof actual.readlink>) => {
      if (hooks.failReadlinkFor === String(args[0])) throw eio('readlink')
      return actual.readlink(...args)
    }) as typeof actual.readlink
  }
  return { ...wrapped, default: wrapped }
})

import {
  AGENT_UNDO_WRITE_TEMP_PREFIX,
  startAgentChangesUndoRecorder,
  executeAgentChangesUndo,
  copyFileExclusive
} from '../agentChangesUndo'
import type { AgentChangesUndo } from '../agentChangesUndoModel'
import { createFakeTrash } from './helpers/agentBaselineFixtures'

let root: string
let folder: string
let tempRoot: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-undo-mocked-')))
  folder = join(root, 'repo')
  tempRoot = join(root, 'temp')
  mkdirSync(folder)
  mkdirSync(tempRoot)
  hooks.readFilePaths = []
  resetFailureHooks()
})

afterEach(() => {
  resetFailureHooks()
  removeTempPathSync(root)
})

function resetFailureHooks(): void {
  hooks.beforeLstat = null
  hooks.failChmodFor = null
  hooks.failMkdtemp = false
  hooks.failRenameTo = null
  hooks.failReadlinkFor = null
}

// 控えの一時ディレクトリ(tempRoot の下)の一覧
const undoTempDirs = (): string[] => readdirSync(tempRoot)
// 書き戻しの一時の名前(folder の下)の一覧
const writeTemps = (): string[] =>
  readdirSync(folder).filter((name) => name.startsWith(AGENT_UNDO_WRITE_TEMP_PREFIX))

// path の 1 件を戻す操作(apply)の控えを取る(控えの準備 → 適用 → after → 結果)。控えが取れなければ投げる
async function captureUndo(path: string, apply: () => void): Promise<AgentChangesUndo> {
  const recorder = await startAgentChangesUndoRecorder(folder, [{ path, isDirectory: false }], {
    tempRoot,
    maxBytes: 100
  })
  apply()
  await recorder.recordAfter(path)
  const result = await recorder.finish()
  if (result.kind !== 'saved') throw new Error('控えが取れなかった')
  return { undoId: 1, operation: 'file', dir: result.dir, items: result.items }
}

// a.txt の書き戻しの控え(agent → 戻して base)
async function captureRewrite(): Promise<AgentChangesUndo> {
  writeFileSync(join(folder, 'a.txt'), 'agent')
  return captureUndo('a.txt', () => writeFileSync(join(folder, 'a.txt'), 'base'))
}

// a.txt の n 回目の lstat の前に action を呼ぶ
function onNthLstatOfA(n: number, action: () => void): void {
  let count = 0
  hooks.beforeLstat = (path) => {
    if (path !== join(folder, 'a.txt')) return
    count++
    if (count === n) action()
  }
}

describe('agentChangesUndo(fs を包んだ偽物)', () => {
  it('戻した後の指紋はストリームで計算し、上限の対象外の大きなファイルを全体で読まない', async () => {
    const content = Buffer.alloc(3 * 1024 * 1024, 7)
    const recorder = await startAgentChangesUndoRecorder(
      folder,
      [{ path: 'big.bin', isDirectory: false }],
      { tempRoot, maxBytes: 10 }
    )
    writeFileSync(join(folder, 'big.bin'), content)
    await recorder.recordAfter('big.bin')
    const result = await recorder.finish()
    if (result.kind !== 'saved') throw new Error('控えが取れなかった')
    expect(result.items[0].after).toMatchObject({
      kind: 'file',
      sha256: createHash('sha256').update(content).digest('hex')
    })
    expect(hooks.readFilePaths).not.toContain(join(folder, 'big.bin'))
  })

  it('書く直前の照合が合わなければ、0 件で止めて控えを捨てる failed', async () => {
    const undo = await captureRewrite()
    // 1 回目は全件の照合、2 回目は書く直前の照合
    onNthLstatOfA(2, () => writeFileSync(join(folder, 'a.txt'), 'BASE'))
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'failed',
      message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）',
      keepUndo: false
    })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('BASE')
  })

  it('書く直前の照合で読み込めなければ、0 件で止めて控えを残す failed', async () => {
    const undo = await captureRewrite()
    onNthLstatOfA(2, () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'failed',
      message: '取り消しに失敗しました: a.txt を読み込めませんでした: EACCES: permission denied',
      keepUndo: true
    })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('base')
  })

  it('写しの権限を変えられなければ自分が作ったファイルだけを消し、既にあるファイルは EEXIST で上書きしない', async () => {
    const source = join(folder, 'src.txt')
    writeFileSync(source, 'x')
    const created = join(folder, 'new.txt')
    hooks.failChmodFor = created
    await expect(copyFileExclusive(source, created, 0o644)).rejects.toThrow('EIO')
    expect(existsSync(created)).toBe(false)

    const existing = join(folder, 'old.txt')
    writeFileSync(existing, 'keep')
    hooks.failChmodFor = existing
    await expect(copyFileExclusive(source, existing, 0o644)).rejects.toThrow('EEXIST')
    expect(readFileSync(existing, 'utf8')).toBe('keep')
  })

  // 控えの保存・書き戻し・作り直し(link と直接書く代替)は copyFile で写し、中身を main のメモリに読まない
  it('控えの保存・書き戻し・作り直しで readFile を使わない', async () => {
    const undo = await captureRewrite()
    writeFileSync(join(folder, 'z.txt'), 'gone')
    const recreateUndo: AgentChangesUndo = {
      ...(await captureUndo('z.txt', () => rmSync(join(folder, 'z.txt')))),
      undoId: 2
    }
    const { trash } = createFakeTrash()
    await expect(executeAgentChangesUndo({ folderPath: folder, undo, trash })).resolves.toEqual({
      kind: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: []
    })
    // link を作れないファイルシステムの代替(目的の名前に直接写す)も通す
    const exdev = async (): Promise<void> => {
      throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    }
    await expect(
      executeAgentChangesUndo({
        folderPath: folder,
        undo: recreateUndo,
        trash,
        fs: { link: exdev }
      })
    ).resolves.toEqual({ kind: 'done', restoredPaths: ['z.txt'], trashedPaths: [] })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('agent')
    expect(readFileSync(join(folder, 'z.txt'), 'utf8')).toBe('gone')
    expect(hooks.readFilePaths).toEqual([])
  })
})

describe('agentChangesUndo のエラー経路(fs を包んだ偽物)', () => {
  const failLstatOf = (target: string, code: string): void => {
    hooks.beforeLstat = (path) => {
      if (path === target) {
        throw Object.assign(new Error(`${code}: permission denied, lstat`), { code })
      }
    }
  }

  describe('startAgentChangesUndoRecorder(控えの準備)', () => {
    it('戻す前の状態を ENOENT 以外の理由で調べられなければ、パスを添えて中止し、一時ディレクトリを作らない', async () => {
      writeFileSync(join(folder, 'a.txt'), 'agent')
      failLstatOf(join(folder, 'a.txt'), 'EACCES')
      const started = startAgentChangesUndoRecorder(
        folder,
        [{ path: 'a.txt', isDirectory: false }],
        { tempRoot, maxBytes: 100 }
      )
      await expect(started).rejects.toThrow(
        '取り消しの準備に失敗したため、戻すのを中止しました: a.txt'
      )
      await expect(started).rejects.toMatchObject({ cause: { code: 'EACCES' } })
      expect(undoTempDirs()).toEqual([])
    })

    it('控えの一時ディレクトリを作れなければ、先頭の対象のパスを添えて中止する', async () => {
      writeFileSync(join(folder, 'a.txt'), 'agent')
      writeFileSync(join(folder, 'b.txt'), 'agent')
      hooks.failMkdtemp = true
      const started = startAgentChangesUndoRecorder(
        folder,
        [
          { path: 'a.txt', isDirectory: false },
          { path: 'b.txt', isDirectory: false }
        ],
        { tempRoot, maxBytes: 100 }
      )
      await expect(started).rejects.toThrow(
        '取り消しの準備に失敗したため、戻すのを中止しました: a.txt'
      )
      await expect(started).rejects.toMatchObject({ cause: { code: 'EIO' } })
    })

    it('戻した直後のリンクの指す先を読めなければ capture-failed で、一時ディレクトリを消す', async () => {
      writeFileSync(join(folder, 'a.txt'), 'agent')
      const recorder = await startAgentChangesUndoRecorder(
        folder,
        [{ path: 'a.txt', isDirectory: false }],
        { tempRoot, maxBytes: 100 }
      )
      expect(undoTempDirs()).toHaveLength(1)
      rmSync(join(folder, 'a.txt'))
      symlinkSync('base', join(folder, 'a.txt'))
      hooks.failReadlinkFor = join(folder, 'a.txt')
      await recorder.recordAfter('a.txt')
      expect(await recorder.finish()).toEqual({ kind: 'unavailable', reason: 'capture-failed' })
      expect(undoTempDirs()).toEqual([])
    })
  })

  describe('executeAgentChangesUndo(取り消し)', () => {
    it('全件の照合で親のフォルダを調べられなければ、何も書かずに拒否して控えを残す', async () => {
      mkdirSync(join(folder, 'sub'))
      writeFileSync(join(folder, 'sub', 'a.txt'), 'agent')
      const undo = await captureUndo('sub/a.txt', () =>
        writeFileSync(join(folder, 'sub', 'a.txt'), 'base')
      )
      failLstatOf(join(folder, 'sub'), 'EACCES')
      const { trash } = createFakeTrash()
      expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
        kind: 'rejected',
        keepUndo: true,
        message:
          '取り消しの対象を読み込めませんでした（sub/a.txt）: EACCES: permission denied, lstat'
      })
      expect(readFileSync(join(folder, 'sub', 'a.txt'), 'utf8')).toBe('base')
    })

    it('全件の照合で戻した直後のリンクの指す先を読めなければ、何も書かずに拒否して控えを残す', async () => {
      writeFileSync(join(folder, 'a.txt'), 'agent')
      const undo = await captureUndo('a.txt', () => {
        rmSync(join(folder, 'a.txt'))
        symlinkSync('base', join(folder, 'a.txt'))
      })
      hooks.failReadlinkFor = join(folder, 'a.txt')
      const { trash } = createFakeTrash()
      expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
        kind: 'rejected',
        keepUndo: true,
        message: '取り消しの対象を読み込めませんでした（a.txt）: EIO: i/o error, readlink'
      })
    })

    it('書き戻しの rename に失敗したら、一時の名前を消し、元のファイルを変えずに控えを残す failed', async () => {
      const undo = await captureRewrite()
      hooks.failRenameTo = join(folder, 'a.txt')
      const { trash } = createFakeTrash()
      expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
        kind: 'failed',
        message: '取り消しに失敗しました: a.txt: EIO: i/o error, rename',
        keepUndo: true
      })
      expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('base')
      expect(writeTemps()).toEqual([])
    })

    it('作り直しの link が代替の対象外の理由で失敗したら、直接写さずに一時の名前を消して failed', async () => {
      writeFileSync(join(folder, 'z.txt'), 'gone')
      const undo = await captureUndo('z.txt', () => rmSync(join(folder, 'z.txt')))
      const failingLink = async (): Promise<void> => {
        throw eio('link')
      }
      const { trash } = createFakeTrash()
      expect(
        await executeAgentChangesUndo({
          folderPath: folder,
          undo,
          trash,
          fs: { link: failingLink }
        })
      ).toEqual({
        kind: 'failed',
        message: '取り消しに失敗しました: z.txt: EIO: i/o error, link',
        keepUndo: true
      })
      expect(existsSync(join(folder, 'z.txt'))).toBe(false)
      expect(writeTemps()).toEqual([])
    })
  })
})
