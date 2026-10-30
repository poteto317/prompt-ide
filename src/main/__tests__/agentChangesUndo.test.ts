import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { link } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_CHANGES_UNDO_MAX_BYTES,
  AGENT_UNDO_WRITE_TEMP_PREFIX,
  startAgentChangesUndoRecorder,
  executeAgentChangesUndo
} from '../agentChangesUndo'
import type { AgentChangesUndoTarget } from '../agentChangesUndo'
import type { AgentChangesUndo, AgentChangesUndoCapture } from '../agentChangesUndoModel'
import { createFakeTrash } from './helpers/agentBaselineFixtures'

let root: string
let folder: string
let tempRoot: string
const abs = (path: string): string => join(folder, path)
const write = (path: string, content: string | Buffer, mode = 0o644): void => {
  mkdirSync(join(abs(path), '..'), { recursive: true })
  writeFileSync(abs(path), content)
  chmodSync(abs(path), mode)
}
const sha = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')
// root(uid 0)では権限の拒否が起きないため、権限のテストを飛ばす
const isRoot = process.getuid?.() === 0
const isWindows = process.platform === 'win32'

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-undo-')))
  folder = join(root, 'repo')
  tempRoot = join(root, 'temp')
  mkdirSync(folder)
  mkdirSync(tempRoot)
})

afterEach(() => {
  // 権限を落としたディレクトリも消せるように戻す
  for (const dir of [folder, join(folder, 'sub')]) {
    if (existsSync(dir)) chmodSync(dir, 0o755)
  }
  removeTempPathSync(root)
})

// 戻す操作の流れ(控えの準備 → 適用 → 1 件ごとの after → 結果)を再現する
async function capture(
  targets: AgentChangesUndoTarget[],
  apply: () => void,
  maxBytes = AGENT_CHANGES_UNDO_MAX_BYTES
): Promise<AgentChangesUndoCapture> {
  const recorder = await startAgentChangesUndoRecorder(folder, targets, { tempRoot, maxBytes })
  apply()
  for (const target of targets) await recorder.recordAfter(target.path)
  return recorder.finish()
}

const fileTarget = (path: string): AgentChangesUndoTarget => ({ path, isDirectory: false })

function undoOf(result: AgentChangesUndoCapture): AgentChangesUndo {
  if (result.kind !== 'saved') throw new Error(`控えが取れなかった: ${JSON.stringify(result)}`)
  return { undoId: 1, operation: 'file', dir: result.dir, items: result.items }
}

const leftoverTemps = (dir = folder): string[] =>
  readdirSync(dir).filter((name) => name.startsWith(AGENT_UNDO_WRITE_TEMP_PREFIX))

// 1 の形: エージェントが変えたファイルを実行前の内容(base)へ書き戻した
async function captureRewrite(path: string): Promise<AgentChangesUndo> {
  write(path, 'agent')
  return undoOf(await capture([fileTarget(path)], () => writeFileSync(abs(path), 'base')))
}

// 2 の形: エージェントが追加したファイルをゴミ箱へ移した
async function captureRecreate(path: string, mode = 0o755): Promise<AgentChangesUndo> {
  write(path, 'z', mode)
  return undoOf(await capture([fileTarget(path)], () => unlinkSync(abs(path))))
}

// 3 の形: エージェントが消したファイルを作り直した
async function captureTrash(path: string): Promise<AgentChangesUndo> {
  return undoOf(await capture([fileTarget(path)], () => write(path, 'base')))
}

// 4 の形: エージェントが作ったリンクを実行前のファイルへ書き戻した
async function captureSymlink(path: string): Promise<AgentChangesUndo> {
  symlinkSync('x', abs(path))
  return undoOf(
    await capture([fileTarget(path)], () => {
      unlinkSync(abs(path))
      writeFileSync(abs(path), 'base')
    })
  )
}

// 5 の形: エージェントが変えたファイルを実行前のリンクへ書き戻した(戻した直後の指紋がリンク)
async function captureToSymlink(path: string, target = 'base'): Promise<AgentChangesUndo> {
  write(path, 'agent')
  return undoOf(
    await capture([fileTarget(path)], () => {
      unlinkSync(abs(path))
      symlinkSync(target, abs(path))
    })
  )
}

// パスの今の状態(取り消しが何も書かなかったことを確かめる)
function stateOf(path: string): string {
  if (!existsSync(abs(path)) && !isSymlink(path)) return 'absent'
  const stat = lstatSync(abs(path))
  if (stat.isSymbolicLink()) return `symlink:${readlinkSync(abs(path))}`
  if (stat.isDirectory()) return 'directory'
  return `file:${(stat.mode & 0o777).toString(8)}:${readFileSync(abs(path), 'utf8')}`
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(abs(path)).isSymbolicLink()
  } catch {
    return false
  }
}

describe('startAgentChangesUndoRecorder(控え)', () => {
  it('変更を書き戻す前の中身と権限を 0700 の一時ディレクトリへ控え、戻した後の指紋を控える', async () => {
    write('a.txt', 'agent')
    const result = await capture([fileTarget('a.txt')], () => writeFileSync(abs('a.txt'), 'base'))
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect(result.items).toEqual([
      {
        path: 'a.txt',
        before: { kind: 'file', savedName: '0', mode: 0o644 },
        after: { kind: 'file', size: 4, sha256: sha('base'), mode: 0o644 }
      }
    ])
    expect(join(result.dir, '..')).toBe(tempRoot)
    expect(result.dir.slice(tempRoot.length + 1).startsWith('prompt-ide-agent-undo-')).toBe(true)
    expect(statSync(result.dir).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(result.dir, '0'), 'utf8')).toBe('agent')
    expect(statSync(join(result.dir, '0')).mode & 0o777).toBe(0o600)
  })

  it('追加のファイルをゴミ箱へ移すと、前は権限付きのファイル・後は無い', async () => {
    const undo = await captureRecreate('z.txt')
    expect(undo.items).toEqual([
      {
        path: 'z.txt',
        before: { kind: 'file', savedName: '0', mode: 0o755 },
        after: { kind: 'absent' }
      }
    ])
  })

  it('削除を作り直すと、前は無い・後はファイル', async () => {
    const undo = await captureTrash('d.txt')
    expect(undo.items).toEqual([
      {
        path: 'd.txt',
        before: { kind: 'absent' },
        after: { kind: 'file', size: 4, sha256: sha('base'), mode: 0o644 }
      }
    ])
  })

  it('リンクは指す先を控える', async () => {
    const undo = await captureSymlink('l')
    expect(undo.items[0].before).toEqual({ kind: 'symlink', target: 'x' })
  })

  it('対象を逆順に渡しても、控えの項目はパスの昇順', async () => {
    write('b.txt', 'agent')
    write('z.txt', 'z', 0o755)
    const result = await capture(
      [fileTarget('z.txt'), fileTarget('d.txt'), fileTarget('b.txt')],
      () => {
        writeFileSync(abs('b.txt'), 'base')
        unlinkSync(abs('z.txt'))
        write('d.txt', 'base')
      }
    )
    if (result.kind !== 'saved') throw new Error('控えが取れなかった')
    expect(result.items.map((item) => item.path)).toEqual(['b.txt', 'd.txt', 'z.txt'])
  })

  it('追加されたフォルダを含むと directory で、一時ディレクトリを作らない', async () => {
    write('a.txt', 'agent')
    const result = await capture([fileTarget('a.txt'), { path: 'nd', isDirectory: true }], () => {})
    expect(result).toEqual({ kind: 'unavailable', reason: 'directory' })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('パスがディレクトリなら unsupported-type', async () => {
    mkdirSync(abs('dir'))
    const result = await capture([fileTarget('dir')], () => {})
    expect(result).toEqual({ kind: 'unavailable', reason: 'unsupported-type' })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it.skipIf(isWindows)('パスが FIFO なら unsupported-type', async () => {
    execFileSync('mkfifo', [abs('fifo')])
    const result = await capture([fileTarget('fifo')], () => {})
    expect(result).toEqual({ kind: 'unavailable', reason: 'unsupported-type' })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('上限ちょうどは控える', async () => {
    write('ten.txt', '0123456789')
    expect((await capture([fileTarget('ten.txt')], () => {}, 10)).kind).toBe('saved')
  })

  it('上限を超えたら too-large で一時ディレクトリを作らない', async () => {
    write('eleven.txt', '0123456789A')
    expect(await capture([fileTarget('eleven.txt')], () => {}, 10)).toEqual({
      kind: 'unavailable',
      reason: 'too-large'
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('上限は中身の合計で比べる', async () => {
    write('six.txt', '012345')
    write('five.txt', '01234')
    expect(await capture([fileTarget('six.txt'), fileTarget('five.txt')], () => {}, 10)).toEqual({
      kind: 'unavailable',
      reason: 'too-large'
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  describe('戻した後の状態を控えられなければ capture-failed で一時ディレクトリを消す', () => {
    it('ディレクトリになった', async () => {
      write('a.txt', 'agent')
      const result = await capture([fileTarget('a.txt')], () => {
        unlinkSync(abs('a.txt'))
        mkdirSync(abs('a.txt'))
      })
      expect(result).toEqual({ kind: 'unavailable', reason: 'capture-failed' })
      expect(readdirSync(tempRoot)).toEqual([])
    })

    it.skipIf(isWindows)('FIFO になった', async () => {
      write('a.txt', 'agent')
      const result = await capture([fileTarget('a.txt')], () => {
        unlinkSync(abs('a.txt'))
        execFileSync('mkfifo', [abs('a.txt')])
      })
      expect(result).toEqual({ kind: 'unavailable', reason: 'capture-failed' })
      expect(readdirSync(tempRoot)).toEqual([])
    })

    it.skipIf(isRoot)('lstat に失敗した', async () => {
      write('sub/a.txt', 'agent')
      const result = await capture([fileTarget('sub/a.txt')], () => {
        chmodSync(join(folder, 'sub'), 0o600)
      })
      expect(result).toEqual({ kind: 'unavailable', reason: 'capture-failed' })
      expect(readdirSync(tempRoot)).toEqual([])
    })
  })

  it('前も後も無ければ(取り消すものが無い) capture-failed で一時ディレクトリを消す', async () => {
    const result = await capture([fileTarget('none.txt')], () => {})
    expect(result).toEqual({ kind: 'unavailable', reason: 'capture-failed' })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it.skipIf(isRoot)(
    '戻す前のファイルを読めなければ、一時ディレクトリを消して例外にする',
    async () => {
      write('a.txt', 'x')
      chmodSync(abs('a.txt'), 0o000)
      await expect(
        startAgentChangesUndoRecorder(folder, [fileTarget('a.txt')], {
          tempRoot,
          maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES
        })
      ).rejects.toThrow('取り消しの準備に失敗したため、戻すのを中止しました: a.txt')
      expect(readdirSync(tempRoot)).toEqual([])
    }
  )

  it('discard は作った一時ディレクトリを消す', async () => {
    write('a.txt', 'agent')
    const options = { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
    const discarded = await startAgentChangesUndoRecorder(folder, [fileTarget('a.txt')], options)
    expect(readdirSync(tempRoot)).toHaveLength(1)
    await discarded.discard()
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('finish の後の discard は saved の一時ディレクトリを消さない', async () => {
    write('a.txt', 'agent')
    const options = { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
    const kept = await startAgentChangesUndoRecorder(folder, [fileTarget('a.txt')], options)
    writeFileSync(abs('a.txt'), 'base')
    await kept.recordAfter('a.txt')
    const result = await kept.finish()
    await kept.discard()
    if (result.kind !== 'saved') throw new Error('控えが取れなかった')
    expect(existsSync(result.dir)).toBe(true)
  })
})

describe('executeAgentChangesUndo(取り消し)', () => {
  it('書き戻す: 戻す前の中身と権限に戻し、一時ファイルを残さない', async () => {
    const undo = await captureRewrite('a.txt')
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: []
    })
    expect(readFileSync(abs('a.txt'), 'utf8')).toBe('agent')
    expect(statSync(abs('a.txt')).mode & 0o777).toBe(0o644)
    expect(leftoverTemps()).toEqual([])
  })

  it('作り直す: 中身と権限を戻し、一時ファイルを残さない', async () => {
    const undo = await captureRecreate('z.txt', 0o755)
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'done',
      restoredPaths: ['z.txt'],
      trashedPaths: []
    })
    expect(readFileSync(abs('z.txt'), 'utf8')).toBe('z')
    expect(statSync(abs('z.txt')).mode & 0o777).toBe(0o755)
    expect(leftoverTemps()).toEqual([])
  })

  it('ゴミ箱へ移す: 戻すときに作り直したファイルをゴミ箱へ移す', async () => {
    const undo = await captureTrash('d.txt')
    const { trash, trashed } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'done',
      restoredPaths: [],
      trashedPaths: ['d.txt']
    })
    expect(trashed).toEqual([abs('d.txt')])
    expect(existsSync(abs('d.txt'))).toBe(false)
  })

  it('リンクを書き戻す', async () => {
    const rewritten = await captureSymlink('l')
    const { trash } = createFakeTrash()
    expect(
      (await executeAgentChangesUndo({ folderPath: folder, undo: rewritten, trash })).kind
    ).toBe('done')
    expect(readlinkSync(abs('l'))).toBe('x')
    expect(leftoverTemps()).toEqual([])
  })

  it('リンクへ戻したファイルを、指す先が戻した直後のままなら書き戻す', async () => {
    const undo = await captureToSymlink('m')
    expect(undo.items[0].after).toEqual({ kind: 'symlink', target: 'base' })
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'done',
      restoredPaths: ['m'],
      trashedPaths: []
    })
    expect(stateOf('m')).toBe('file:644:agent')
    expect(leftoverTemps()).toEqual([])
  })

  it('リンクを作り直す', async () => {
    const { trash } = createFakeTrash()
    symlinkSync('x', abs('k'))
    const recreated = undoOf(await capture([fileTarget('k')], () => unlinkSync(abs('k'))))
    expect(
      (await executeAgentChangesUndo({ folderPath: folder, undo: recreated, trash })).kind
    ).toBe('done')
    expect(readlinkSync(abs('k'))).toBe('x')
    expect(leftoverTemps()).toEqual([])
  })

  it('控えたバイト列のまま戻す(改行を変えない)', async () => {
    write('crlf.txt', Buffer.from('a\r\nb\r\n'))
    const undo = undoOf(
      await capture([fileTarget('crlf.txt')], () => writeFileSync(abs('crlf.txt'), 'a\nb\n'))
    )
    const { trash } = createFakeTrash()
    await executeAgentChangesUndo({ folderPath: folder, undo, trash })
    expect(readFileSync(abs('crlf.txt')).equals(Buffer.from('a\r\nb\r\n'))).toBe(true)
  })

  it('255 バイトの名前でも書き戻せる(一時の名前は元の名前によらない)', async () => {
    const name = 'x'.repeat(251) + '.txt'
    const undo = await captureRewrite(name)
    const { trash } = createFakeTrash()
    expect((await executeAgentChangesUndo({ folderPath: folder, undo, trash })).kind).toBe('done')
    expect(readFileSync(abs(name), 'utf8')).toBe('agent')
  })

  describe('戻した後に変わっていれば何も書かずに拒否して控えを捨てる', () => {
    it.each<[string, () => Promise<{ undo: AgentChangesUndo; path: string }>]>([
      [
        '中身だけ変わった(同じ大きさ)',
        async () => {
          const undo = await captureRewrite('a.txt')
          writeFileSync(abs('a.txt'), 'BASE')
          return { undo, path: 'a.txt' }
        }
      ],
      [
        '大きさが変わった',
        async () => {
          const undo = await captureRewrite('a.txt')
          writeFileSync(abs('a.txt'), 'base!!')
          return { undo, path: 'a.txt' }
        }
      ],
      [
        '権限が変わった',
        async () => {
          const undo = await captureRewrite('a.txt')
          chmodSync(abs('a.txt'), 0o600)
          return { undo, path: 'a.txt' }
        }
      ],
      [
        'リンクに置き換わった',
        async () => {
          const undo = await captureRewrite('a.txt')
          unlinkSync(abs('a.txt'))
          symlinkSync('base', abs('a.txt'))
          return { undo, path: 'a.txt' }
        }
      ],
      [
        'ディレクトリに置き換わった',
        async () => {
          const undo = await captureRewrite('a.txt')
          unlinkSync(abs('a.txt'))
          mkdirSync(abs('a.txt'))
          return { undo, path: 'a.txt' }
        }
      ],
      [
        'リンクからファイルへ戻したパスが、別の指す先のリンクに置き換わった',
        async () => {
          const undo = await captureSymlink('l')
          unlinkSync(abs('l'))
          symlinkSync('y', abs('l'))
          return { undo, path: 'l' }
        }
      ],
      [
        '戻した直後のリンクの指す先が変わった',
        async () => {
          const undo = await captureToSymlink('m')
          unlinkSync(abs('m'))
          symlinkSync('other', abs('m'))
          return { undo, path: 'm' }
        }
      ],
      [
        '戻した直後のリンクがファイルに置き換わった',
        async () => {
          const undo = await captureToSymlink('m')
          unlinkSync(abs('m'))
          writeFileSync(abs('m'), 'base')
          return { undo, path: 'm' }
        }
      ],
      [
        '無かったパスに現れた',
        async () => {
          const undo = await captureRecreate('z.txt')
          write('z.txt', 'other')
          return { undo, path: 'z.txt' }
        }
      ],
      [
        '親がリンクに置き換わった',
        async () => {
          const undo = await captureRewrite('sub/a.txt')
          renameSync(join(folder, 'sub'), join(folder, 'sub2'))
          symlinkSync('sub2', join(folder, 'sub'))
          return { undo, path: 'sub/a.txt' }
        }
      ],
      [
        '親が無い',
        async () => {
          const undo = await captureRecreate('sub/z.txt')
          removeTempPathSync(join(folder, 'sub'))
          return { undo, path: 'sub/z.txt' }
        }
      ]
    ])('%s', async (_label, prepare) => {
      const { undo, path } = await prepare()
      const before = stateOf(path)
      const { trash, trashed } = createFakeTrash()
      expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
        kind: 'rejected',
        keepUndo: false,
        message: `戻した後に変わったファイルがあるため、取り消せません（${path}）`
      })
      expect(stateOf(path)).toBe(before)
      expect(trashed).toEqual([])
      expect(leftoverTemps()).toEqual([])
    })
  })

  it('不一致が 6 件ならメッセージは 5 件と残りの件数', async () => {
    const paths = ['a1.txt', 'a2.txt', 'a3.txt', 'a4.txt', 'a5.txt', 'a6.txt']
    for (const path of paths) write(path, 'agent')
    const undo = undoOf(
      await capture(paths.map(fileTarget), () => {
        for (const path of paths) writeFileSync(abs(path), 'base')
      })
    )
    for (const path of paths) writeFileSync(abs(path), 'BASE')
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'rejected',
      keepUndo: false,
      message:
        '戻した後に変わったファイルがあるため、取り消せません（a1.txt、a2.txt、a3.txt、a4.txt、a5.txt、ほか 1 件）'
    })
  })

  it.skipIf(isRoot)('不一致と読み込みの失敗が混ざれば、不一致で控えを捨てる', async () => {
    write('a.txt', 'agent')
    write('sub/b.txt', 'agent')
    const undo = undoOf(
      await capture([fileTarget('a.txt'), fileTarget('sub/b.txt')], () => {
        writeFileSync(abs('a.txt'), 'base')
        writeFileSync(abs('sub/b.txt'), 'base')
      })
    )
    writeFileSync(abs('a.txt'), 'BASE')
    chmodSync(join(folder, 'sub'), 0o600)
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'rejected',
      keepUndo: false,
      message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）'
    })
  })

  it('控えたファイルが一時ディレクトリから消えていれば、何も書かずに拒否して控えを捨てる', async () => {
    write('b.txt', 'agent')
    const undo = undoOf(
      await capture([fileTarget('a.txt'), fileTarget('b.txt')], () => {
        write('a.txt', 'base')
        writeFileSync(abs('b.txt'), 'base')
      })
    )
    const saved = undo.items.find((item) => item.path === 'b.txt')?.before
    if (saved?.kind !== 'file') throw new Error('b.txt の控えがファイルでない')
    // OS の一時ディレクトリの掃除で控えが消えた場面
    unlinkSync(join(undo.dir, saved.savedName))
    const { trash, trashed } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'rejected',
      keepUndo: false,
      message: '取り消しの控えが見つからないため、取り消せません（b.txt）'
    })
    expect(trashed).toEqual([])
    expect(stateOf('a.txt')).toBe('file:644:base')
    expect(stateOf('b.txt')).toBe('file:644:base')
    expect(leftoverTemps()).toEqual([])
  })

  it.skipIf(isRoot)('読み込みの失敗だけなら、何も書かずに拒否して控えを残す', async () => {
    const undo = await captureRewrite('sub/a.txt')
    chmodSync(join(folder, 'sub'), 0o600)
    const { trash } = createFakeTrash()
    const result = await executeAgentChangesUndo({ folderPath: folder, undo, trash })
    expect(result).toMatchObject({ kind: 'rejected', keepUndo: true })
    if (result.kind !== 'rejected') return
    expect(result.message.startsWith('取り消しの対象を読み込めませんでした（sub/a.txt）: ')).toBe(
      true
    )
    // 読めるように戻して、何も書いていないことを確かめる
    chmodSync(join(folder, 'sub'), 0o755)
    expect(stateOf('sub/a.txt')).toBe('file:644:base')
    expect(leftoverTemps(join(folder, 'sub'))).toEqual([])
  })

  it.each(['EPERM', 'ENOTSUP', 'EXDEV'])(
    'link が %s で失敗したら、目的の名前に直接書いて作り直す',
    async (code) => {
      const undo = await captureRecreate('z.txt', 0o755)
      const { trash } = createFakeTrash()
      const result = await executeAgentChangesUndo({
        folderPath: folder,
        undo,
        trash,
        fs: {
          link: async () => {
            throw Object.assign(new Error('not supported'), { code })
          }
        }
      })
      expect(result).toEqual({ kind: 'done', restoredPaths: ['z.txt'], trashedPaths: [] })
      expect(readFileSync(abs('z.txt'), 'utf8')).toBe('z')
      expect(statSync(abs('z.txt')).mode & 0o777).toBe(0o755)
      expect(leftoverTemps()).toEqual([])
    }
  )

  it('作り直しは、書く間に現れたものを上書きしない', async () => {
    const undo = await captureRecreate('z.txt')
    const { trash } = createFakeTrash()
    const result = await executeAgentChangesUndo({
      folderPath: folder,
      undo,
      trash,
      fs: {
        link: async (existing, target) => {
          writeFileSync(target, 'other')
          await link(existing, target)
        }
      }
    })
    expect(result).toMatchObject({ kind: 'failed', keepUndo: true })
    if (result.kind !== 'failed') return
    expect(result.message.startsWith('取り消しに失敗しました: z.txt: ')).toBe(true)
    expect(result.message).toContain('EEXIST')
    expect(readFileSync(abs('z.txt'), 'utf8')).toBe('other')
    expect(leftoverTemps()).toEqual([])
  })

  it.skipIf(isRoot)(
    '書き換えに失敗した: 0 件なら控えを残す failed で、直ればもう一度取り消せる',
    async () => {
      const undo = await captureRewrite('sub/a.txt')
      chmodSync(join(folder, 'sub'), 0o555)
      const { trash } = createFakeTrash()
      const result = await executeAgentChangesUndo({ folderPath: folder, undo, trash })
      expect(result).toMatchObject({ kind: 'failed', keepUndo: true })
      if (result.kind !== 'failed') return
      expect(result.message.startsWith('取り消しに失敗しました: sub/a.txt: ')).toBe(true)
      expect(readFileSync(abs('sub/a.txt'), 'utf8')).toBe('base')
      chmodSync(join(folder, 'sub'), 0o755)
      expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
        kind: 'done',
        restoredPaths: ['sub/a.txt'],
        trashedPaths: []
      })
      expect(readFileSync(abs('sub/a.txt'), 'utf8')).toBe('agent')
    }
  )

  it.skipIf(isRoot)('書き換えに失敗した: 1 件済みなら partial', async () => {
    write('a.txt', 'agent')
    write('sub/b.txt', 'agent')
    const undo = undoOf(
      await capture([fileTarget('a.txt'), fileTarget('sub/b.txt')], () => {
        writeFileSync(abs('a.txt'), 'base')
        writeFileSync(abs('sub/b.txt'), 'base')
      })
    )
    chmodSync(join(folder, 'sub'), 0o555)
    const { trash } = createFakeTrash()
    const result = await executeAgentChangesUndo({ folderPath: folder, undo, trash })
    expect(result).toMatchObject({ kind: 'partial', restoredPaths: ['a.txt'], trashedPaths: [] })
    if (result.kind !== 'partial') return
    expect(result.message).toMatch(
      /^取り消しが途中で失敗しました（1 \/ 2 件を取り消し済み）: sub\/b\.txt: /
    )
    expect(readFileSync(abs('a.txt'), 'utf8')).toBe('agent')
    expect(readFileSync(abs('sub/b.txt'), 'utf8')).toBe('base')
  })

  it('書く直前の照合が合わなければそこで止める(1 件済み)', async () => {
    write('b.txt', 'agent')
    const result = await capture([fileTarget('a.txt'), fileTarget('b.txt')], () => {
      write('a.txt', 'base')
      writeFileSync(abs('b.txt'), 'base')
    })
    const undo = undoOf(result)
    const trashed: string[] = []
    const trash = async (absolutePath: string): Promise<void> => {
      trashed.push(absolutePath)
      rmSync(absolutePath, { force: true })
      writeFileSync(abs('b.txt'), 'CHANGED')
    }
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'partial',
      message:
        '取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: b.txt が戻した後に変わりました',
      restoredPaths: [],
      trashedPaths: ['a.txt']
    })
    expect(trashed).toEqual([abs('a.txt')])
    expect(readFileSync(abs('b.txt'), 'utf8')).toBe('CHANGED')
  })

  it('ゴミ箱へ移せなければ、0 件なら控えを残す failed で、移せるようになればもう一度取り消せる', async () => {
    const undo = await captureTrash('d.txt')
    const failingTrash = async (): Promise<void> => {
      throw new Error('trash failed')
    }
    expect(
      await executeAgentChangesUndo({ folderPath: folder, undo, trash: failingTrash })
    ).toEqual({
      kind: 'failed',
      message: '取り消しに失敗しました: d.txt: ゴミ箱へ移動できませんでした',
      keepUndo: true
    })
    expect(existsSync(abs('d.txt'))).toBe(true)
    const { trash } = createFakeTrash()
    expect(await executeAgentChangesUndo({ folderPath: folder, undo, trash })).toEqual({
      kind: 'done',
      restoredPaths: [],
      trashedPaths: ['d.txt']
    })
    expect(existsSync(abs('d.txt'))).toBe(false)
  })
})
