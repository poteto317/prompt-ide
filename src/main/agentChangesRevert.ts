import type { SimpleGit } from 'simple-git'
import type { AgentChangeEntry, AgentRevertAllEntry, DiscardAllResult } from '@shared/types'
import {
  AGENT_CHANGES_LIST_LIMIT,
  isAgentRevertAllTarget,
  toAgentChangeRelativePath
} from '@shared/types'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE, hasIgnoredInside } from './agentBaselineCoverage'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { collectAgentChangeEntries } from './agentChangesQuery'
import type {
  AgentChangesUndoCaptureOptions,
  AgentChangesUndoRecorder,
  AgentChangesUndoTarget
} from './agentChangesUndo'
import type { AgentChangesUndoCapture } from './agentChangesUndoModel'
import { startAgentChangesUndoRecorder } from './agentChangesUndo'
import { hasFilterAttribute } from './agentFilterAttribute'
import { applyInOrder, assertSameEntries, listPathsForMessage } from './discardBatch'
import { discardHunkPatch } from './gitApply'
import { assertDiscardable, classifyDiscardTarget } from './gitDiscardClassifier'
import { applyDiscard } from './gitDiscardService'
import { verifyHunkPatch } from './gitHunkPatchVerifier'
import { isUnmergedPath } from './gitMergeState'
import { toLiteralPathspec } from './gitPathParsing'

// エージェントの変更を、記録の時点(実行の前)の内容へ戻す(設計書「変更を戻す」)。既存の取り消しの部品(分類・重なりの検査・
// applyDiscard・パッチの検査)を、記録のインデックスで問い合わせる git で呼ぶ(確認の結果 7・8・10)。戻すのは作業ツリーだけで、
// 利用者の index・stash・HEAD は変えない。コンフリクトの判定だけは利用者の index で行う
// 戻す 3 関数は、検査の後・作業ツリーを変える前に取り消しの控えを取り(控えの準備に失敗したら中止。L-003。フォルダ・ファイルとリンク以外・
// 上限を超える内容は控えずに戻す)、1 件を適用するたびに戻した後の指紋を控える(agentChangesUndo.ts)

export const AGENT_CHANGES_STALE_MESSAGE = '変更の状態が変わりました。一覧を更新してください'
export const AGENT_REVERT_HUNK_FAILED_MESSAGE =
  'ハンクを戻せませんでした。ファイルが変更された可能性があります。diff を開き直してください'
export const AGENT_REVERT_ALL_MISMATCH_MESSAGE =
  '変更の状態が変わったため、戻すのを中止しました。もう一度操作してください'
export const AGENT_REVERT_ALL_TOO_MANY_MESSAGE =
  '変更が多すぎるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'
export const AGENT_REVERT_FILTER_MESSAGE =
  '.gitattributes のフィルタ(filter)が設定されているため戻せません。ファイルごとにターミナルで操作してください'

export interface AgentRevertContext {
  snapshot: BaselineSnapshot
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash)。テストで偽物を注入する */
  trash: (absolutePath: string) => Promise<void>
  gitOptions?: BaselineGitOptions
  /** 取り消しの控えの置き場所と上限(控えは毎回取る) */
  undoCapture: AgentChangesUndoCaptureOptions
  /**
   * 一覧の行に author を付ける(registry の attributeEntries を handler が所有者と記録で包んだもの。必須。L-060)。すべて戻すの対象の
   * 絞り込みにだけ使い、行の ↶・ハンクは使わない(利用者の変更も個別に戻せる)
   */
  attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>
}

/** 戻す操作の結果。applied は作業ツリーに適用した件数、capture は取り消しの控え(取れなかったら理由) */
export interface AgentRevertOutcome {
  applied: number
  capture: AgentChangesUndoCapture
}

type RevertKind = 'tracked' | 'untracked'
/** すべて戻すの 1 件(戻し方と、控えでフォルダを見分けるための isDirectory) */
type RevertAllTarget = { path: string; kind: RevertKind; isDirectory: boolean }
type Assessment = { ok: true; path: string; kind: RevertKind } | { ok: false; reason: string }

// 記録のインデックスのエントリ(モードと blob)。パスと完全一致するものだけ
async function readBaselineEntry(
  git: SimpleGit,
  filePath: string
): Promise<{ mode: string; sha: string } | null> {
  const output = await git.raw(['ls-files', '-s', '-z', '--', toLiteralPathspec(filePath)])
  for (const record of output.split('\0')) {
    const tab = record.indexOf('\t')
    if (tab === -1 || record.slice(tab + 1) !== filePath) continue
    const [mode, sha] = record.slice(0, tab).split(' ')
    return { mode, sha }
  }
  return null
}

// 1 件を戻せるかを調べる(何も変えない)。手順は設計書「戻す手順」の 3〜6
async function assess(
  gits: { baseline: SimpleGit; repo: SimpleGit },
  entry: AgentChangeEntry
): Promise<Assessment> {
  const path = toAgentChangeRelativePath(entry.path)
  if (entry.notRecorded) {
    return { ok: false, reason: `実行前の内容を記録していないため戻せません: ${path}` }
  }
  // コンフリクトは利用者の index の状態(記録のインデックスには未解決のエントリが無い)
  if (await isUnmergedPath(gits.repo, path)) {
    return { ok: false, reason: `コンフリクト中のファイルは戻せません: ${path}` }
  }
  const baselineEntry = await readBaselineEntry(gits.baseline, path)
  if (baselineEntry?.mode === '160000') {
    return {
      ok: false,
      reason: `サブモジュール・入れ子のリポジトリの変更は戻せません。ターミナルで操作してください: ${path}`
    }
  }
  // 一覧はまとめる前に ignore されたファイルの有無を見るが、一覧を取った後に置かれたものはここで止める(Task 6 レビュー I1)。
  // フォルダごとゴミ箱へ移すと、ignore されたファイル(一覧にも確認にも出ない)も移る
  if (entry.isDirectory && (await hasIgnoredInside(gits.baseline, path))) {
    return {
      ok: false,
      reason: `ignore されたファイルを含むため、フォルダごとは戻せません: ${path}`
    }
  }
  const kind = await classifyDiscardTarget(gits.baseline, path)
  try {
    assertDiscardable(kind, path)
    // 記録のインデックスは intent-to-add を持たない(add -A が実体を入れる)。現れたら判定を誤っているため拒否する
    if (kind === 'intent-to-add') assertDiscardable('unknown', path)
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
  if (kind === 'tracked') {
    // 記録の `git add -A` は clean filter を通した後の内容を blob にし、restore は smudge をかけて書き戻す。clean が情報を
    // 落とすフィルタ(nbstripout など)だと、記録の時点の作業ツリーの内容が失われる(コードレビュー ループ 1 の I1)。
    // LFS(filter=lfs)も拒否するが、データを失わない側に倒れるので許容する。記録の時点と今の作業ツリーの両方の属性を見る
    if (await hasFilterAttribute(gits.baseline, path)) {
      return { ok: false, reason: `${AGENT_REVERT_FILTER_MESSAGE}: ${path}` }
    }
    // 記録の blob が gc で消えていると、restore は復元できずに削除だけを行う(確認の結果 12)。戻す前に確かめる。
    // `cat-file -e` は無いときに stderr 空・終了コード 1 で終わり、simple-git は reject しない(空文字で resolve)ため使えない。
    // `cat-file -t` は無いと fatal で reject する
    const exists =
      baselineEntry !== null &&
      (await gits.repo
        .raw(['cat-file', '-t', baselineEntry.sha])
        .then((type) => type.trim() === 'blob')
        .catch(() => false))
    if (!exists) {
      return { ok: false, reason: `${AGENT_BASELINE_BLOB_MISSING_MESSAGE}: ${path}` }
    }
  }
  return { ok: true, path, kind: kind === 'tracked' ? 'tracked' : 'untracked' }
}

function gitsFor(context: AgentRevertContext): { baseline: SimpleGit; repo: SimpleGit } {
  const { folderPath, indexPath } = context.snapshot
  return {
    baseline: createBaselineGit(folderPath, indexPath, context.gitOptions),
    repo: createRepoGit(folderPath, context.gitOptions)
  }
}

// いまの一覧から、パス(末尾の '/' を除いて比べる)の行を探す。一覧に無いパスは戻さない
async function findCurrentEntry(
  context: AgentRevertContext,
  filePath: string
): Promise<AgentChangeEntry> {
  const entries = await collectAgentChangeEntries(context.snapshot, context.gitOptions)
  const entry = entries.find((e) => toAgentChangeRelativePath(e.path) === filePath)
  if (entry === undefined) throw new Error(AGENT_CHANGES_STALE_MESSAGE)
  return entry
}

/**
 * 作業ツリーを変える前に取り消しの控えを始め(控えの準備に失敗したら例外で中止。L-003。フォルダ・ファイルとリンク以外・上限を
 * 超える内容は控えずに apply を行い、控えの結果を unavailable にする)、apply を行う。apply が投げたら作った控えを捨てて
 * 投げ直し、解決したら apply の結果と控えの結果を返す(控えの一時ディレクトリの持ち主は呼び出し側に移る)
 */
async function withUndoRecorder<T>(
  context: AgentRevertContext,
  targets: readonly AgentChangesUndoTarget[],
  apply: (recorder: AgentChangesUndoRecorder) => Promise<T>
): Promise<{ result: T; capture: AgentChangesUndoCapture }> {
  const recorder = await startAgentChangesUndoRecorder(
    context.snapshot.folderPath,
    targets,
    context.undoCapture
  )
  let result: T
  try {
    result = await apply(recorder)
  } catch (error) {
    await recorder.discard()
    throw error
  }
  return { result, capture: await recorder.finish() }
}

/**
 * すべて戻すの対象を全件調べる。1 件でも戻せなければ何も戻さずに例外。同じパスの行は 1 度だけ戻す(一覧は git の出力から
 * パスごとに 1 行で作るため通常は起きないが、2 度控えると控えの合計を 2 度数え、同じパスの項目が 2 つになって取り消しが partial になる)
 */
async function assessRevertAllTargets(
  gits: { baseline: SimpleGit; repo: SimpleGit },
  entries: readonly AgentChangeEntry[]
): Promise<RevertAllTarget[]> {
  const targets: RevertAllTarget[] = []
  const blocked: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const path = toAgentChangeRelativePath(entry.path)
    if (seen.has(path)) continue
    seen.add(path)
    const assessment = await assess(gits, entry)
    if (assessment.ok) {
      targets.push({ path: assessment.path, kind: assessment.kind, isDirectory: entry.isDirectory })
    } else blocked.push(path)
  }
  if (blocked.length > 0) {
    throw new Error(
      `戻せないファイルがあるため、何も戻しませんでした（${listPathsForMessage(blocked)}）`
    )
  }
  return targets
}

/** ファイル単位で戻す。変更・削除・種類の変更は記録の時点の内容へ、追加(ファイル・フォルダ)はゴミ箱へ */
export async function revertAgentChange(
  context: AgentRevertContext,
  filePath: string
): Promise<AgentRevertOutcome> {
  const entry = await findCurrentEntry(context, filePath)
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  const { folderPath } = context.snapshot
  const { capture } = await withUndoRecorder(
    context,
    [{ path: assessment.path, isDirectory: entry.isDirectory }],
    async (recorder) => {
      await applyDiscard(gits.baseline, folderPath, assessment.kind, assessment.path, context.trash)
      await recorder.recordAfter(assessment.path)
    }
  )
  return { applied: 1, capture }
}

/**
 * 一覧の行の状態だけで、ハンクで戻せない行を拒否する(git を呼ばない)。追加・削除・フォルダ・種類の変更はファイルごとに戻す
 */
export function assertHunkRevertableEntry(
  entry: Pick<AgentChangeEntry, 'status' | 'isDirectory'>,
  filePath: string
): void {
  // 新規ファイルのパッチの逆適用はファイルを(ゴミ箱を経由せずに)消す(確認の結果 8)
  if (entry.status === 'A' || entry.status === 'D' || entry.isDirectory) {
    throw new Error(
      `追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: ${filePath}`
    )
  }
  // 種類の変更(ファイル → リンクなど)の逆適用は、リンクの指す先などを書き換えうる。renderer も canRevertHunk=false にするが、
  // main でも拒否する(最終レビュー A の M2)
  if (entry.status === 'T') {
    throw new Error(
      `種類が変わったファイルはハンクでは戻せません。ファイルごと戻してください: ${filePath}`
    )
  }
}

/**
 * ハンク単位で戻す(作業ツリーへの逆適用。index は使わない)。追加・削除・フォルダ・種類の変更の行と、ゴミ箱へ移す対象の行は
 * 拒否する(ファイル単位で戻す)
 */
export async function revertAgentChangeHunk(
  context: AgentRevertContext,
  filePath: string,
  patch: string
): Promise<AgentRevertOutcome> {
  const entry = await findCurrentEntry(context, filePath)
  assertHunkRevertableEntry(entry, filePath)
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  if (assessment.kind !== 'tracked') {
    throw new Error(`ゴミ箱へ移す対象のため、ハンクでは戻せません: ${filePath}`)
  }
  const { folderPath } = context.snapshot
  const contentPatch = await verifyHunkPatch(folderPath, filePath, patch)
  // パッチの検査を通った後に控えを取る(検査で拒否したら控えを作らない)
  const { capture } = await withUndoRecorder(
    context,
    [{ path: filePath, isDirectory: false }],
    async (recorder) => {
      try {
        await discardHunkPatch(folderPath, filePath, contentPatch)
      } catch (error) {
        throw new Error(AGENT_REVERT_HUNK_FAILED_MESSAGE, { cause: error })
      }
      await recorder.recordAfter(filePath)
    }
  )
  return { applied: 1, capture }
}

/**
 * すべて戻す(L-063 の 1 つの流れ)。実行時の一覧 → 件数の上限の検査(除く前の件数。打ち切った一覧では使えない) → author を付ける →
 * 利用者の変更・利用者の変更を含む行を除く(isAgentRevertAllTarget。確認の一覧と同じ定義。L-036・L-058) → 確認のときに見せた一覧
 * (expected)と完全一致で照合し、違えば何も変えない(パターン 62) → 全件を先に調べ、1 件でも戻せなければ何もしない → 控えと適用。
 * 途中で失敗したら、1 件以上済んでいれば partial(パターン 52)。対象が 0 件で確認の一覧も空なら何も変えずに applied: 0
 */
export async function revertAllAgentChanges(
  context: AgentRevertContext,
  expected: AgentRevertAllEntry[]
): Promise<DiscardAllResult & AgentRevertOutcome> {
  const entries = await collectAgentChangeEntries(context.snapshot, context.gitOptions)
  if (entries.length > AGENT_CHANGES_LIST_LIMIT) throw new Error(AGENT_REVERT_ALL_TOO_MANY_MESSAGE)
  const targetEntries = (await context.attributeEntries(entries)).filter(isAgentRevertAllTarget)
  assertSameEntries(targetEntries, expected, AGENT_REVERT_ALL_MISMATCH_MESSAGE)
  const gits = gitsFor(context)
  const targets = await assessRevertAllTargets(gits, targetEntries)
  const { folderPath } = context.snapshot
  let applied = 0
  const { result, capture } = await withUndoRecorder(
    context,
    targets.map(({ path, isDirectory }) => ({ path, isDirectory })),
    (recorder) =>
      applyInOrder(
        targets,
        async ({ path, kind }) => {
          await applyDiscard(gits.baseline, folderPath, kind, path, context.trash)
          applied += 1
          // partial では適用した項目だけを控える(recordAfter は投げない)
          await recorder.recordAfter(path)
        },
        (done, total, reason) =>
          `すべて戻すが途中で失敗しました（${done} / ${total} 件を戻し済み）: ${reason}`
      )
  )
  return { ...result, applied, capture }
}
