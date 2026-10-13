import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  link as fsLink,
  lstat,
  mkdtemp,
  open,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentChangesUndoAction, AgentRevertUndoUnavailableReason } from '@shared/types'
import type {
  AgentChangesUndo,
  AgentChangesUndoAfter,
  AgentChangesUndoBefore,
  AgentChangesUndoCapture,
  AgentChangesUndoExecution,
  AgentChangesUndoItem,
  AgentChangesUndoPrecheck,
  AgentChangesUndoProgress
} from './agentChangesUndoModel'
import {
  AGENT_UNDO_TRASH_FAILED_MESSAGE,
  undoPrecheckRejection,
  undoPrepareFailedMessage,
  undoStopExecution
} from './agentChangesUndoModel'

// 戻した操作の取り消し(設計書「戻した操作の取り消し(main)」)。戻す操作が書き換える各パスについて、戻す直前の状態
// (無い・ファイルのバイト列と権限・リンクの指す先)を記録と同じアプリの一時ディレクトリへ控え、戻した直後の指紋(大きさ・SHA-256・
// 権限・リンクの指す先)を控える。取り消しは全件を指紋と照合してから(L-036・L-038)、同じフォルダの一時の名前 + rename・link で
// 書き戻す(L-014)。git は使わない(フィルタ・改行の変換がかからず、控えたバイト列のまま戻る)。パスは控えたリポジトリ相対のパスから
// join(folderPath, path) の 1 つの規則で求める(L-018)。renderer の値は undoId だけ(L-019)。控えの型・文言・結果の純粋な変換は
// agentChangesUndoModel に置き(止まった理由は AgentChangesUndoStop・準備の失敗はパスで渡し、文言を組み立てない)、このファイルはファイルの読み書きだけを持つ

/** 控えるファイルの中身の合計の上限(記録の未追跡のファイルの合計の上限と同じ値) */
export const AGENT_CHANGES_UNDO_MAX_BYTES = 100 * 1024 * 1024
export const AGENT_CHANGES_UNDO_TEMP_PREFIX = 'prompt-ide-agent-undo-'
/** 書き戻しの一時の名前の接頭辞(後ろに乱数 16 桁の 16 進。元の名前によらない) */
export const AGENT_UNDO_WRITE_TEMP_PREFIX = '.prompt-ide-undo-'

export interface AgentChangesUndoCaptureOptions {
  /** 控えの一時ディレクトリを作る場所(本番は os.tmpdir()) */
  tempRoot: string
  maxBytes: number
}

export interface AgentChangesUndoTarget {
  path: string
  /** 追加されたフォルダの行(ゴミ箱へ移す。控えない) */
  isDirectory: boolean
}

export interface AgentChangesUndoRecorder {
  /** 1 件を適用した後に呼ぶ(例外を投げない。控えられなければ capture-failed にして一時ディレクトリを消す) */
  recordAfter(path: string): Promise<void>
  /** 結果を返す。saved なら一時ディレクトリの持ち主は呼び出し側に移る */
  finish(): Promise<AgentChangesUndoCapture>
  /** 戻す操作が例外で終わるときに呼ぶ(作った一時ディレクトリを消す) */
  discard(): Promise<void>
}

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | null)?.code
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const removeDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true }).catch(() => undefined)
const comparePaths = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/** 中身の SHA-256(ストリームで計算し、ファイル全体をメモリに読まない) */
function hashFileSha256(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absolutePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 無いことを確かめて作り(wx。既にあれば EEXIST で作らない)、data を書いて権限を mode にする。書き込みの途中で失敗したら、
 * 自分が作ったそのファイルを消す(自分が作れなかったものは消さない。L-004)。作る間の権限は 0600
 */
export async function writeFileExclusive(path: string, data: Buffer, mode: number): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(data)
    await handle.chmod(mode)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(path).catch(() => undefined)
    throw error
  }
  try {
    await handle.close()
  } catch (error) {
    await unlink(path).catch(() => undefined)
    throw error
  }
}

const prepareFailed = (path: string, error: unknown): Error =>
  new Error(undoPrepareFailedMessage(path), { cause: error })

type PlannedBefore =
  | { path: string; kind: 'absent' }
  | { path: string; kind: 'file'; size: number; mode: number }
  | { path: string; kind: 'symlink' }

// 戻す前のパスの種類(読み込まない)。ファイル・リンク以外は null(控えない)。ENOENT は無い。それ以外の失敗は投げる
async function planBefore(folderPath: string, path: string): Promise<PlannedBefore | null> {
  let stat: Stats
  try {
    stat = await lstat(join(folderPath, path))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { path, kind: 'absent' }
    throw error
  }
  if (stat.isFile()) return { path, kind: 'file', size: stat.size, mode: stat.mode & 0o777 }
  if (stat.isSymbolicLink()) return { path, kind: 'symlink' }
  return null
}

async function saveBefore(
  folderPath: string,
  dir: string,
  index: number,
  plan: PlannedBefore
): Promise<AgentChangesUndoBefore> {
  const absolutePath = join(folderPath, plan.path)
  switch (plan.kind) {
    case 'absent':
      return { kind: 'absent' }
    case 'symlink':
      return { kind: 'symlink', target: await readlink(absolutePath) }
    case 'file': {
      const savedName = String(index)
      await writeFileExclusive(join(dir, savedName), await readFile(absolutePath), 0o600)
      return { kind: 'file', savedName, mode: plan.mode }
    }
  }
}

// 戻した直後の指紋。控えられない(lstat・読み込みの失敗、ディレクトリ・ファイルとリンク以外)なら null
async function captureAfter(absolutePath: string): Promise<AgentChangesUndoAfter | null> {
  let stat: Stats
  try {
    stat = await lstat(absolutePath)
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? { kind: 'absent' } : null
  }
  try {
    if (stat.isFile()) {
      return {
        kind: 'file',
        size: stat.size,
        sha256: await hashFileSha256(absolutePath),
        mode: stat.mode & 0o777
      }
    }
    if (stat.isSymbolicLink()) return { kind: 'symlink', target: await readlink(absolutePath) }
  } catch {
    return null
  }
  return null
}

function unavailableRecorder(reason: AgentRevertUndoUnavailableReason): AgentChangesUndoRecorder {
  return {
    recordAfter: async () => undefined,
    finish: async () => ({ kind: 'unavailable', reason }),
    discard: async () => undefined
  }
}

function capturingRecorder(
  folderPath: string,
  dir: string,
  befores: ReadonlyMap<string, AgentChangesUndoBefore>
): AgentChangesUndoRecorder {
  const items: AgentChangesUndoItem[] = []
  let failed = false
  // 一時ディレクトリをまだ持っているか(finish で saved を返したら持ち主が移る)
  let owned = true
  const drop = async (): Promise<void> => {
    if (!owned) return
    owned = false
    await removeDir(dir)
  }
  return {
    recordAfter: async (path) => {
      if (failed) return
      const before = befores.get(path)
      const after = before === undefined ? null : await captureAfter(join(folderPath, path))
      if (
        before === undefined ||
        after === null ||
        (before.kind === 'absent' && after.kind === 'absent')
      ) {
        // 戻す操作は成功のまま、控えを捨てる(作業ツリーを変えた後の失敗を、戻す操作の失敗にしない。L-001)
        failed = true
        await drop()
        return
      }
      items.push({ path, before, after })
    },
    finish: async () => {
      if (failed || items.length === 0) {
        await drop()
        return { kind: 'unavailable', reason: 'capture-failed' }
      }
      owned = false
      return { kind: 'saved', dir, items: [...items].sort(comparePaths) }
    },
    discard: drop
  }
}

/**
 * 戻す操作の控えを始める(作業ツリーを変える前に呼ぶ。L-003)。追加されたフォルダを含む → directory、ファイル・リンク以外 →
 * unsupported-type、ファイルの中身の合計が上限を超える → too-large(読み込まない)。どれでもなければ一時ディレクトリ(0700)に
 * 戻す前のファイルを写す。戻す前の状態を調べられない(lstat の ENOENT 以外の失敗)・一時ディレクトリを作れない・写せないなら
 * 例外(戻す操作を中止する。写す途中の失敗では作った一時ディレクトリを消してから投げる)
 */
export async function startAgentChangesUndoRecorder(
  folderPath: string,
  targets: readonly AgentChangesUndoTarget[],
  options: AgentChangesUndoCaptureOptions
): Promise<AgentChangesUndoRecorder> {
  if (targets.some((target) => target.isDirectory)) return unavailableRecorder('directory')
  const planned: PlannedBefore[] = []
  let totalBytes = 0
  for (const target of targets) {
    let plan: PlannedBefore | null
    try {
      plan = await planBefore(folderPath, target.path)
    } catch (error) {
      throw prepareFailed(target.path, error)
    }
    if (plan === null) return unavailableRecorder('unsupported-type')
    if (plan.kind === 'file') totalBytes += plan.size
    planned.push(plan)
  }
  if (totalBytes > options.maxBytes) return unavailableRecorder('too-large')
  let dir: string
  try {
    dir = await mkdtemp(join(options.tempRoot, AGENT_CHANGES_UNDO_TEMP_PREFIX))
  } catch (error) {
    throw prepareFailed(targets[0]?.path ?? '', error)
  }
  const befores = new Map<string, AgentChangesUndoBefore>()
  for (const [index, plan] of planned.entries()) {
    try {
      befores.set(plan.path, await saveBefore(folderPath, dir, index, plan))
    } catch (error) {
      await removeDir(dir)
      throw prepareFailed(plan.path, error)
    }
  }
  return capturingRecorder(folderPath, dir, befores)
}

type ItemCheck = { kind: 'match' } | { kind: 'mismatch' } | { kind: 'unreadable'; reason: string }
const MATCH: ItemCheck = { kind: 'match' }
const MISMATCH: ItemCheck = { kind: 'mismatch' }

// 親のフォルダの各段(許可のフォルダの直下から親まで)が本物のディレクトリか(リンク・無いは不一致)
async function checkParents(folderPath: string, path: string): Promise<ItemCheck> {
  const segments = path.split('/')
  for (let depth = 1; depth < segments.length; depth++) {
    try {
      const stat = await lstat(join(folderPath, ...segments.slice(0, depth)))
      if (!stat.isDirectory()) return MISMATCH
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return MISMATCH
      return { kind: 'unreadable', reason: messageOf(error) }
    }
  }
  return MATCH
}

// 今の状態が戻した直後の指紋と完全に一致するか(L-036。時刻ではなく中身で比べる。L-422)
async function checkItem(folderPath: string, item: AgentChangesUndoItem): Promise<ItemCheck> {
  const parents = await checkParents(folderPath, item.path)
  if (parents.kind !== 'match') return parents
  const absolutePath = join(folderPath, item.path)
  let stat: Stats
  try {
    stat = await lstat(absolutePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return item.after.kind === 'absent' ? MATCH : MISMATCH
    return { kind: 'unreadable', reason: messageOf(error) }
  }
  const after = item.after
  try {
    switch (after.kind) {
      case 'absent':
        // 戻した直後に無かったパスに何かが現れた(ディレクトリを含む。L-011)
        return MISMATCH
      case 'symlink':
        return stat.isSymbolicLink() && (await readlink(absolutePath)) === after.target
          ? MATCH
          : MISMATCH
      case 'file':
        // 大きさ・権限・種類を先に比べ、違えば読まない
        if (!stat.isFile() || stat.size !== after.size || (stat.mode & 0o777) !== after.mode) {
          return MISMATCH
        }
        return (await hashFileSha256(absolutePath)) === after.sha256 ? MATCH : MISMATCH
    }
  } catch (error) {
    return { kind: 'unreadable', reason: messageOf(error) }
  }
}

const writeTempName = (absolutePath: string): string =>
  join(dirname(absolutePath), `${AGENT_UNDO_WRITE_TEMP_PREFIX}${randomBytes(8).toString('hex')}`)

// 書き戻す: 同じフォルダの一時の名前に、ファイルなら書いて権限を before.mode にし、リンクなら指す先のリンクを作ってから、
// rename で置き換える(L-014)
async function rewrite(
  absolutePath: string,
  before: Exclude<AgentChangesUndoBefore, { kind: 'absent' }>,
  undoDir: string
): Promise<void> {
  const temp = writeTempName(absolutePath)
  if (before.kind === 'file') {
    await writeFileExclusive(temp, await readFile(join(undoDir, before.savedName)), before.mode)
  } else {
    await symlink(before.target, temp)
  }
  try {
    await rename(temp, absolutePath)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

// ハードリンクを作れないファイルシステムの link の失敗
const LINK_UNSUPPORTED_CODES = new Set(['EPERM', 'ENOTSUP', 'EXDEV'])

// 作り直す: リンクは目的の名前に直接作る(既にあれば EEXIST)。ファイルは一時の名前に書いて権限を before.mode にしてから
// link で目的の名前を作る(既にあれば EEXIST で止まる。L-011)。link を作れないファイルシステムでは、目的の名前に wx で直接書く
// (既にあれば EEXIST)
async function recreate(
  absolutePath: string,
  before: Exclude<AgentChangesUndoBefore, { kind: 'absent' }>,
  undoDir: string,
  linkFile: AgentChangesUndoFs['link']
): Promise<void> {
  if (before.kind === 'symlink') {
    await symlink(before.target, absolutePath)
    return
  }
  const data = await readFile(join(undoDir, before.savedName))
  const temp = writeTempName(absolutePath)
  await writeFileExclusive(temp, data, before.mode)
  try {
    await linkFile(temp, absolutePath)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    if (!LINK_UNSUPPORTED_CODES.has(errorCode(error) ?? '')) throw error
    await writeFileExclusive(absolutePath, data, before.mode)
    return
  }
  await unlink(temp).catch(() => undefined)
}

// 書き戻し・作り直しに使う控えのファイルが控えの一時ディレクトリにあるか(ファイルの中身を控えない項目は常に true)。
// lstat に失敗した・ファイルでないなら、控えを使えないものとして false
async function hasSavedFile(undoDir: string, before: AgentChangesUndoBefore): Promise<boolean> {
  if (before.kind !== 'file') return true
  try {
    return (await lstat(join(undoDir, before.savedName))).isFile()
  } catch {
    return false
  }
}

export interface AgentChangesUndoFs {
  link: (existingPath: string, newPath: string) => Promise<void>
}

export interface AgentChangesUndoContext {
  folderPath: string
  undo: AgentChangesUndo
  /** OS のゴミ箱へ移す(戻すときに作り直したファイルを消すとき。完全な削除をしない) */
  trash: (absolutePath: string) => Promise<void>
  /** テストで link を差し替える(ハードリンクを作れないファイルシステムの再現) */
  fs?: Partial<AgentChangesUndoFs>
}

// 全件を照合する(書き換えない)
async function precheckUndoItems(
  folderPath: string,
  undo: AgentChangesUndo
): Promise<AgentChangesUndoPrecheck> {
  const precheck: AgentChangesUndoPrecheck = { mismatched: [], unreadable: [], savedMissing: [] }
  for (const item of undo.items) {
    const check = await checkItem(folderPath, item)
    if (check.kind === 'mismatch') precheck.mismatched.push(item.path)
    else if (check.kind === 'unreadable') {
      precheck.unreadable.push({ path: item.path, reason: check.reason })
    }
    if (!(await hasSavedFile(undo.dir, item.before))) precheck.savedMissing.push(item.path)
  }
  return precheck
}

// 1 件を取り消す(undoActionOf と同じ規則で、ゴミ箱へ移す・作り直す・書き戻す)。失敗は投げる
async function applyUndoItem(
  absolutePath: string,
  item: AgentChangesUndoItem,
  undoDir: string,
  trash: AgentChangesUndoContext['trash'],
  linkFile: AgentChangesUndoFs['link']
): Promise<AgentChangesUndoAction> {
  if (item.before.kind === 'absent') {
    try {
      await trash(absolutePath)
    } catch (error) {
      throw new Error(AGENT_UNDO_TRASH_FAILED_MESSAGE, { cause: error })
    }
    return 'trash'
  }
  if (item.after.kind === 'absent') {
    await recreate(absolutePath, item.before, undoDir, linkFile)
    return 'recreate'
  }
  await rewrite(absolutePath, item.before, undoDir)
  return 'rewrite'
}

// 書く直前にもう一度照合する。合わない・読み込めないなら止まったときの結果(文言は agentChangesUndoModel)、合えば null
async function recheckBeforeWrite(
  folderPath: string,
  item: AgentChangesUndoItem,
  progress: AgentChangesUndoProgress
): Promise<ReturnType<typeof undoStopExecution> | null> {
  const check = await checkItem(folderPath, item)
  switch (check.kind) {
    case 'match':
      return null
    case 'mismatch':
      return undoStopExecution(progress, { kind: 'changed', path: item.path })
    case 'unreadable':
      return undoStopExecution(progress, {
        kind: 'unreadable',
        path: item.path,
        reason: check.reason
      })
  }
}

/**
 * 控えで取り消す(設計書「取り消しの流れ」3・4)。全件を照合してから判定し、不一致が 1 件でもあれば何も書かずに拒否して控えを捨てる。
 * 不一致が無く、控えのファイルが控えの一時ディレクトリから消えていれば、何も書かずに拒否して控えを捨てる。
 * どちらも無く読み込みの失敗だけなら、何も書かずに拒否して控えを残す。書き換えはパスの昇順で、各項目の直前にもう一度照合し、
 * 合わない・読み込めない・書き換えの失敗でそこで止める(1 件以上済んでいれば partial、0 件なら failed)。控えの扱いは呼び出し側
 * (registry)が結果で決める
 */
export async function executeAgentChangesUndo(
  context: AgentChangesUndoContext
): Promise<AgentChangesUndoExecution> {
  const { folderPath, undo, trash } = context
  const linkFile = context.fs?.link ?? fsLink
  const rejection = undoPrecheckRejection(await precheckUndoItems(folderPath, undo))
  if (rejection !== null) return rejection
  const progress: AgentChangesUndoProgress = {
    restoredPaths: [],
    trashedPaths: [],
    total: undo.items.length
  }
  for (const item of undo.items) {
    const stopped = await recheckBeforeWrite(folderPath, item, progress)
    if (stopped !== null) return stopped
    let action: AgentChangesUndoAction
    try {
      action = await applyUndoItem(join(folderPath, item.path), item, undo.dir, trash, linkFile)
    } catch (error) {
      return undoStopExecution(progress, {
        kind: 'write-failed',
        path: item.path,
        reason: messageOf(error)
      })
    }
    if (action === 'trash') progress.trashedPaths.push(item.path)
    else progress.restoredPaths.push(item.path)
  }
  return {
    kind: 'done',
    restoredPaths: progress.restoredPaths,
    trashedPaths: progress.trashedPaths
  }
}
