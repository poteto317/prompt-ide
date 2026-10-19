import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runBaselineGitWithInput, runBaselineGitWithInputSync } from './agentBaselineGit'
import type { BaselineGitLocation } from './agentBaselineGit'
import type { ProtectionRefListing, ProtectionTreeEntry } from './agentChangesProtectionRules'
import {
  AGENT_CHANGES_PROTECTION_REF_PREFIX,
  isObjectId,
  isSweepCandidate,
  parseProtectionRefName
} from './agentChangesProtectionRules'

// 記録の tree を gc から守る専用の ref(設計書「記録の blob を gc から守る」)。名前は main が作った形
// (refs/prompt-ide/agent-changes/<pid>-<16 進 8 桁>/<記録の番号>)だけを使い、名前と値は update-ref -z --stdin の標準入力で渡す
// (L-034)。更新・削除は前に書いた値との compare-and-swap(L-004)。git は記録の git と同じ環境(GIT_DIR などを除く)で、
// reference-transaction の hook を動かさない(core.hooksPath を hook の無いディレクトリにする。確認の結果 5)。
// simple-git は stderr が空で終了コードが 0 でないときに reject しない(2026-10-06 の確認の結果 21)ため使わず、
// runBaselineGitWithInput(終了コード 0 以外で reject)だけで実行する。「無い」と読むのは終了コード 0 で出力が空のときだけ(L-002)。
// 名前の形・掃除の候補・同期の書き込みの規則は agentChangesProtectionRules に置き、このファイルは保護の I/O(git の実行と出力の解析、
// 掃除で使うプロセスの有無の確認、hook の無いディレクトリの用意)を持つ

/** アプリの終了の同期の削除の打ち切り(1 つにつき) */
const AGENT_CHANGES_PROTECTION_SYNC_TIMEOUT_MS = 2_000
/** hook の無いディレクトリの名前(userData の下) */
const AGENT_CHANGES_NO_HOOKS_DIR_NAME = 'agent-changes-no-hooks'

const RUN_ENTRY_PATTERN = /^run-[1-9][0-9]*$/

/** 保護の git を実行する場所。indexPath は記録のインデックス(GIT_INDEX_FILE。ref の操作には使われない) */
export interface ProtectionGitContext {
  folderPath: string
  indexPath: string
  noHooksDir: string
}

export interface SweepProtectionRefsOptions {
  instanceId: string
  /** 残す番号。一覧を受け取った後に await を挟まずに呼ぶ(一覧の取得中に作られた ref を消さない) */
  keepSerials: () => ReadonlySet<number>
  isProcessAlive: (pid: number) => boolean
}

/** registry が使う保護の git の操作(テストで偽物に差し替える) */
export interface AgentChangesProtectionGit {
  filterExistingTrees(
    ctx: ProtectionGitContext,
    entries: readonly ProtectionTreeEntry[]
  ): Promise<ProtectionTreeEntry[]>
  makeTree(ctx: ProtectionGitContext, entries: readonly ProtectionTreeEntry[]): Promise<string>
  create(ctx: ProtectionGitContext, refName: string, value: string): Promise<void>
  update(ctx: ProtectionGitContext, refName: string, value: string, expected: string): Promise<void>
  remove(ctx: ProtectionGitContext, refName: string, expected: string): Promise<void>
  removeSync(ctx: ProtectionGitContext, refName: string, expected: string): boolean
  read(ctx: ProtectionGitContext, refName: string): Promise<string | null>
  sweep(ctx: ProtectionGitContext, options: SweepProtectionRefsOptions): Promise<void>
}

// 自分が作った形の名前だけを git に渡す(L-034)
function assertOwnRefName(refName: string): void {
  if (parseProtectionRefName(refName) === null) {
    throw new Error(`保護の ref の名前が不正です: ${refName}`)
  }
}

function assertObjectId(value: string): void {
  if (!isObjectId(value)) throw new Error(`object の ID が不正です: ${value}`)
}

const configOf = (ctx: ProtectionGitContext): string[] => [
  `core.hooksPath=${ctx.noHooksDir}`,
  'core.logAllRefUpdates=false'
]

// 保護の ref は リポジトリの方式の記録だけが作る(隠れた git の記録では registry が同期しない)。場所は gitDir null
const repositoryLocationOf = (ctx: ProtectionGitContext): BaselineGitLocation => ({
  folderPath: ctx.folderPath,
  indexPath: ctx.indexPath,
  gitDir: null
})

// ref の書き込みは名前と値を標準入力で渡す(L-034)
const UPDATE_REF_STDIN_ARGS = ['update-ref', '-z', '--stdin'] as const
// 前に書いた値(expected)のときだけ消す update-ref -z --stdin の入力(非同期・同期の削除で共有する)
const deleteRefInput = (refName: string, expected: string): string =>
  `delete ${refName}\0${expected}\0`

const runProtectionGit = (
  ctx: ProtectionGitContext,
  args: readonly string[],
  input = ''
): Promise<string> =>
  runBaselineGitWithInput(repositoryLocationOf(ctx), args, input, { config: configOf(ctx) })

/**
 * cat-file --batch-check の出力から、tree と答えた項目だけを返す(missing・tree 以外は除く)。
 * 行の数・ID が入力と合わなければ例外(空の出力を「全部無い」と読まない。L-002)
 */
export function parseBatchCheckOutput(
  output: string,
  entries: readonly ProtectionTreeEntry[]
): ProtectionTreeEntry[] {
  const lines = output.split('\n').filter((line) => line !== '')
  if (lines.length !== entries.length) {
    throw new Error('cat-file --batch-check の出力の行の数が合いません')
  }
  return entries.filter((entry, index) => {
    const [id, type] = lines[index].split(' ')
    if (id !== entry.tree) throw new Error('cat-file --batch-check の出力の ID が合いません')
    return type === 'tree'
  })
}

/** for-each-ref の `%(refname)%00%(objectname)%00%(objecttype)` の出力(1 行が 1 つ)。形の違う行は飛ばす */
export function parseProtectionRefListing(output: string): ProtectionRefListing[] {
  return output
    .split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      const parts = line.split('\0')
      if (parts.length !== 3) return []
      const [refName, value, objectType] = parts
      return [{ refName, value, objectType }]
    })
}

/**
 * ls-tree -z の出力が自分の書く形か: 子が 1 つ以上ですべて tree、baseline は 0 か 1 つ、ほかはすべて run-<整数>
 * (baseline が 0 の形は、gc で累積の始点の tree が消えた後に同期が run だけで作る値)
 */
export function isOwnProtectionTreeListing(lsTreeOutput: string): boolean {
  const records = lsTreeOutput.split('\0').filter((record) => record !== '')
  if (records.length === 0) return false
  let baselines = 0
  for (const record of records) {
    const tab = record.indexOf('\t')
    if (tab === -1) return false
    const [, type] = record.slice(0, tab).split(' ')
    const name = record.slice(tab + 1)
    if (type !== 'tree') return false
    if (name === 'baseline') baselines += 1
    else if (!RUN_ENTRY_PATTERN.test(name)) return false
  }
  return baselines <= 1
}

/** 項目の tree が object の DB にあるものだけを返す(stderr の文言では判定しない。L-002) */
export async function filterExistingProtectionTrees(
  ctx: ProtectionGitContext,
  entries: readonly ProtectionTreeEntry[]
): Promise<ProtectionTreeEntry[]> {
  if (entries.length === 0) return []
  entries.forEach((entry) => assertObjectId(entry.tree))
  const output = await runProtectionGit(
    ctx,
    ['cat-file', '--batch-check'],
    entries.map((entry) => `${entry.tree}\n`).join('')
  )
  return parseBatchCheckOutput(output, entries)
}

/** 項目を子に持つ tree を作る(mktree -z。項目の tree が無ければ git が失敗する) */
export async function makeProtectionTree(
  ctx: ProtectionGitContext,
  entries: readonly ProtectionTreeEntry[]
): Promise<string> {
  entries.forEach((entry) => assertObjectId(entry.tree))
  const input = entries.map((entry) => `040000 tree ${entry.tree}\t${entry.name}\0`).join('')
  const value = (await runProtectionGit(ctx, ['mktree', '-z'], input)).trim()
  assertObjectId(value)
  return value
}

/** 無いことを確かめて作る(既にあれば git が失敗する) */
export async function createProtectionRef(
  ctx: ProtectionGitContext,
  refName: string,
  value: string
): Promise<void> {
  assertOwnRefName(refName)
  assertObjectId(value)
  await runProtectionGit(ctx, UPDATE_REF_STDIN_ARGS, `create ${refName}\0${value}\0`)
}

/** 前に書いた値(expected)のときだけ置き換える */
export async function updateProtectionRef(
  ctx: ProtectionGitContext,
  refName: string,
  value: string,
  expected: string
): Promise<void> {
  assertOwnRefName(refName)
  assertObjectId(value)
  assertObjectId(expected)
  await runProtectionGit(ctx, UPDATE_REF_STDIN_ARGS, `update ${refName}\0${value}\0${expected}\0`)
}

/** 前に書いた値(expected)のときだけ消す */
export async function deleteProtectionRef(
  ctx: ProtectionGitContext,
  refName: string,
  expected: string
): Promise<void> {
  assertOwnRefName(refName)
  assertObjectId(expected)
  await runProtectionGit(ctx, UPDATE_REF_STDIN_ARGS, deleteRefInput(refName, expected))
}

/** アプリの終了で、待たずに消す(1 つにつき 2 秒の打ち切り)。消せたら true */
export function deleteProtectionRefSync(
  ctx: ProtectionGitContext,
  refName: string,
  expected: string
): boolean {
  if (parseProtectionRefName(refName) === null || !isObjectId(expected)) return false
  return runBaselineGitWithInputSync(
    repositoryLocationOf(ctx),
    UPDATE_REF_STDIN_ARGS,
    deleteRefInput(refName, expected),
    { config: configOf(ctx), timeoutMs: AGENT_CHANGES_PROTECTION_SYNC_TIMEOUT_MS }
  )
}

/** ref の今の値。終了コード 0 で出力が空のときだけ null(無い)。それ以外の失敗は reject(L-002) */
export async function readProtectionRef(
  ctx: ProtectionGitContext,
  refName: string
): Promise<string | null> {
  assertOwnRefName(refName)
  const output = await runProtectionGit(ctx, ['for-each-ref', '--format=%(objectname)', refName])
  const lines = output.split('\n').filter((line) => line !== '')
  if (lines.length === 0) return null
  if (lines.length !== 1 || !isObjectId(lines[0])) {
    throw new Error(`保護の ref の値を読めませんでした: ${refName}`)
  }
  return lines[0]
}

/** refs/prompt-ide/agent-changes/ の下の ref の一覧(for-each-ref には -z が無いため、行の中を %00 で分ける) */
async function listProtectionRefs(ctx: ProtectionGitContext): Promise<ProtectionRefListing[]> {
  const output = await runProtectionGit(ctx, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(objecttype)',
    AGENT_CHANGES_PROTECTION_REF_PREFIX
  ])
  return parseProtectionRefListing(output)
}

/** 値が自分の書く形の tree か(ls-tree が失敗したら reject。呼び出し側は消さない) */
async function isOwnProtectionTree(ctx: ProtectionGitContext, value: string): Promise<boolean> {
  assertObjectId(value)
  return isOwnProtectionTreeListing(await runProtectionGit(ctx, ['ls-tree', '-z', value]))
}

/**
 * 異常終了などで残った ref を消す(記録の ref を作る前に 1 回)。消すのは、自分のインスタンスで残す番号に無いもの・別のインスタンスで
 * その pid のプロセスが無いもののうち、一覧の種類が tree で値が自分の書く形のものだけ。一覧で読んだ値との compare-and-swap で消す。
 * 形の違う名前・形を確かめられない値・形の違う値には触らない(L-004)。失敗は握って次へ進む
 */
export async function sweepStaleProtectionRefs(
  ctx: ProtectionGitContext,
  options: SweepProtectionRefsOptions
): Promise<void> {
  let listings: ProtectionRefListing[]
  try {
    listings = await listProtectionRefs(ctx)
  } catch {
    return
  }
  // 一覧の結果を受け取った後に、await を挟まずに残す番号を作る
  const keep = options.keepSerials()
  for (const listing of listings) {
    if (!isSweepCandidate(listing, options.instanceId, keep, options.isProcessAlive)) continue
    try {
      if (!(await isOwnProtectionTree(ctx, listing.value))) continue
      await deleteProtectionRef(ctx, listing.refName, listing.value)
    } catch {
      // 形を確かめられない・消せないものは残し、次へ進む
    }
  }
}

/** このマシンにその pid のプロセスがあるか。ESRCH だけを「無い」とみなす(EPERM は別の利用者のプロセスとして残す) */
export function isProcessAliveOnThisMachine(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * hook の無いディレクトリ(userData の下。0700。消さない)を用意してパスを返す。起動のたびに呼ぶ。
 * 作れなくても握る(core.hooksPath が存在しないディレクトリを指しても hook は動かない。確認の結果 5)
 */
export function prepareAgentChangesNoHooksDir(userDataPath: string): string {
  const dir = join(userDataPath, AGENT_CHANGES_NO_HOOKS_DIR_NAME)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {
    // 用意できなくても保護は続ける
  }
  return dir
}

/** registry に渡す実物 */
export const protectionRefGit: AgentChangesProtectionGit = {
  filterExistingTrees: filterExistingProtectionTrees,
  makeTree: makeProtectionTree,
  create: createProtectionRef,
  update: updateProtectionRef,
  remove: deleteProtectionRef,
  removeSync: deleteProtectionRefSync,
  read: readProtectionRef,
  sweep: sweepStaleProtectionRefs
}
