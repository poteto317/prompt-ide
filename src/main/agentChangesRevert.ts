import type { SimpleGit } from 'simple-git'
import type { AgentChangeEntry, AgentRevertAllEntry, DiscardAllResult } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT, toAgentChangeRelativePath } from '@shared/types'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE, hasIgnoredInside } from './agentBaselineCoverage'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { collectAgentChangeEntries } from './agentChangesQuery'
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
}

type RevertKind = 'tracked' | 'untracked'
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

/** ファイル単位で戻す。変更・削除・種類の変更は記録の時点の内容へ、追加(ファイル・フォルダ)はゴミ箱へ */
export async function revertAgentChange(
  context: AgentRevertContext,
  filePath: string
): Promise<void> {
  const entry = await findCurrentEntry(context, filePath)
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  const { folderPath } = context.snapshot
  await applyDiscard(gits.baseline, folderPath, assessment.kind, assessment.path, context.trash)
}

/** ハンク単位で戻す(作業ツリーへの逆適用。index は使わない)。追加・削除されたファイルはファイル単位で戻す */
export async function revertAgentChangeHunk(
  context: AgentRevertContext,
  filePath: string,
  patch: string
): Promise<void> {
  const entry = await findCurrentEntry(context, filePath)
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
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  if (assessment.kind !== 'tracked') {
    throw new Error(`ゴミ箱へ移す対象のため、ハンクでは戻せません: ${filePath}`)
  }
  const { folderPath } = context.snapshot
  const contentPatch = await verifyHunkPatch(folderPath, filePath, patch)
  try {
    await discardHunkPatch(folderPath, filePath, contentPatch)
  } catch (error) {
    throw new Error(AGENT_REVERT_HUNK_FAILED_MESSAGE, { cause: error })
  }
}

/**
 * すべて戻す。確認のときに見せた一覧(expected)と実行時の一覧を完全一致で照合し、違えば何も変えない(パターン 62)。
 * 全件を先に調べ、1 件でも戻せなければ何もしない。途中で失敗したら、1 件以上済んでいれば partial(パターン 52)
 */
export async function revertAllAgentChanges(
  context: AgentRevertContext,
  expected: AgentRevertAllEntry[]
): Promise<DiscardAllResult> {
  const entries = await collectAgentChangeEntries(context.snapshot, context.gitOptions)
  if (entries.length > AGENT_CHANGES_LIST_LIMIT) throw new Error(AGENT_REVERT_ALL_TOO_MANY_MESSAGE)
  assertSameEntries(entries, expected, AGENT_REVERT_ALL_MISMATCH_MESSAGE)
  const gits = gitsFor(context)
  const targets: { path: string; kind: RevertKind }[] = []
  const blocked: string[] = []
  for (const entry of entries) {
    const assessment = await assess(gits, entry)
    if (assessment.ok) targets.push(assessment)
    else blocked.push(toAgentChangeRelativePath(entry.path))
  }
  if (blocked.length > 0) {
    throw new Error(
      `戻せないファイルがあるため、何も戻しませんでした（${listPathsForMessage(blocked)}）`
    )
  }
  return applyInOrder(
    targets,
    ({ path, kind }) =>
      applyDiscard(gits.baseline, context.snapshot.folderPath, kind, path, context.trash),
    (done, total, reason) =>
      `すべて戻すが途中で失敗しました（${done} / ${total} 件を戻し済み）: ${reason}`
  )
}
