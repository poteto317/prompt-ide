import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// fs/promises の readFile・lstat・chmod を包む(実物を呼ぶ前に差し込みを呼ぶ)
const hooks = vi.hoisted(() => ({
  readFilePaths: [] as string[],
  beforeLstat: null as ((path: string) => void) | null,
  failChmodFor: null as string | null
}))
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
      if (hooks.failChmodFor === String(args[0])) {
        throw Object.assign(new Error('EIO: i/o error, chmod'), { code: 'EIO' })
      }
      return actual.chmod(...args)
    }) as typeof actual.chmod
  }
  return { ...wrapped, default: wrapped }
})

import {
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
  hooks.beforeLstat = null
  hooks.failChmodFor = null
})

afterEach(() => {
  hooks.beforeLstat = null
  hooks.failChmodFor = null
  rmSync(root, { recursive: true, force: true })
})

// a.txt の書き戻しの控え(agent → 戻して base)
async function captureRewrite(): Promise<AgentChangesUndo> {
  writeFileSync(join(folder, 'a.txt'), 'agent')
  const recorder = await startAgentChangesUndoRecorder(
    folder,
    [{ path: 'a.txt', isDirectory: false }],
    { tempRoot, maxBytes: 100 }
  )
  writeFileSync(join(folder, 'a.txt'), 'base')
  await recorder.recordAfter('a.txt')
  const result = await recorder.finish()
  if (result.kind !== 'saved') throw new Error('控えが取れなかった')
  return { undoId: 1, operation: 'file', dir: result.dir, items: result.items }
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
    const recorder = await startAgentChangesUndoRecorder(
      folder,
      [{ path: 'z.txt', isDirectory: false }],
      { tempRoot, maxBytes: 100 }
    )
    rmSync(join(folder, 'z.txt'))
    await recorder.recordAfter('z.txt')
    const captured = await recorder.finish()
    if (captured.kind !== 'saved') throw new Error('控えが取れなかった')
    const recreateUndo: AgentChangesUndo = {
      undoId: 2,
      operation: 'file',
      dir: captured.dir,
      items: captured.items
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
