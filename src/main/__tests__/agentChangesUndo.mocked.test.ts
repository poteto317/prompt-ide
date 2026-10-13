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

// fs/promises の readFile・lstat・open を包む(実物を呼ぶ前に差し込みを呼ぶ)
const hooks = vi.hoisted(() => ({
  readFilePaths: [] as string[],
  beforeLstat: null as ((path: string) => void) | null,
  failWriteFor: null as string | null
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
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (hooks.failWriteFor !== String(args[0])) return handle
      return Object.assign(Object.create(Object.getPrototypeOf(handle)), handle, {
        writeFile: async () => {
          throw new Error('ENOSPC: no space left on device')
        },
        close: () => handle.close(),
        chmod: (mode: number) => handle.chmod(mode)
      })
    }) as typeof actual.open
  }
  return { ...wrapped, default: wrapped }
})

import {
  startAgentChangesUndoRecorder,
  executeAgentChangesUndo,
  writeFileExclusive
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
  hooks.failWriteFor = null
})

afterEach(() => {
  hooks.beforeLstat = null
  hooks.failWriteFor = null
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

  it('書く直前の照合が合わなければ、0 件で止めて failed', async () => {
    const undo = await captureRewrite()
    // 1 回目は全件の照合、2 回目は書く直前の照合
    onNthLstatOfA(2, () => writeFileSync(join(folder, 'a.txt'), 'BASE'))
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'failed',
      message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）'
    })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('BASE')
  })

  it('書く直前の照合で読み込めなければ、0 件で止めて failed', async () => {
    const undo = await captureRewrite()
    onNthLstatOfA(2, () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'failed',
      message: '取り消しに失敗しました: a.txt を読み込めませんでした: EACCES: permission denied'
    })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('base')
  })

  it('書き込みの途中で失敗したら自分が作ったファイルだけを消す', async () => {
    const created = join(folder, 'new.txt')
    hooks.failWriteFor = created
    await expect(writeFileExclusive(created, Buffer.from('x'), 0o644)).rejects.toThrow('ENOSPC')
    expect(existsSync(created)).toBe(false)

    const existing = join(folder, 'old.txt')
    writeFileSync(existing, 'keep')
    hooks.failWriteFor = existing
    await expect(writeFileExclusive(existing, Buffer.from('x'), 0o644)).rejects.toThrow('EEXIST')
    expect(readFileSync(existing, 'utf8')).toBe('keep')
  })
})
