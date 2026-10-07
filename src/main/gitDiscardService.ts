import { join } from 'path'
import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { DiscardAllEntry, DiscardAllResult } from '@shared/types'
import { applyInOrder, assertSameEntries, listPathsForMessage } from './discardBatch'
import { discardHunkPatch } from './gitApply'
import { verifyHunkPatch } from './gitHunkPatchVerifier'
import { parseUnstagedStatusEntries, toLiteralPathspec } from './gitPathParsing'
import {
  assertDiscardable,
  classifyDiscardTarget,
  isApplicableDiscardKind
} from './gitDiscardClassifier'
import type { ApplicableDiscardKind } from './gitDiscardClassifier'

// 状態ごとの取り消しの実行。拒否する状態(conflicted / unknown / overlaps-untracked)は
// 呼び出し側が assertDiscardable で先に弾く。状態ごとの手段とその理由:
// - 未追跡は git の履歴に内容が無く、完全に削除すると復元できないため、OS のゴミ箱へ移す
// - intent-to-add は restore --worktree がファイルを空にするだけで ' A' のまま残り、
//   履歴の無い内容が失われる(git 2.50.1 の実機で確認)。先に index から外してから
//   ゴミ箱へ移す(ゴミ箱への移動が失敗しても、ゴミ箱にあるファイルを指す宙ぶらりんの
//   index エントリではなく、通常の未追跡ファイルが残るようにする)
// - 追跡済みは restore --worktree で index の内容へ戻す(ステージ済みの内容は残る)
export async function applyDiscard(
  git: SimpleGit,
  folderPath: string,
  kind: ApplicableDiscardKind,
  filePath: string,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const pathspec = toLiteralPathspec(filePath)
  const moveToTrash = async (): Promise<void> => {
    try {
      await trash(join(folderPath, filePath))
    } catch {
      throw new Error(`ゴミ箱へ移動できませんでした: ${filePath}`)
    }
  }
  switch (kind) {
    case 'untracked':
      await moveToTrash()
      return
    case 'intent-to-add':
      await git.raw(['rm', '--cached', '-q', '--', pathspec])
      await moveToTrash()
      return
    case 'tracked':
      await git.raw(['restore', '--worktree', '--', pathspec])
      return
  }
}

// 「変更」セクションのファイル単位の取り消し。filePath はリポジトリ相対パス。
// 分類(classifyDiscardTarget)→ 拒否(assertDiscardable)→ 実行(applyDiscard)の順に進める。
export async function discardFileChanges(
  folderPath: string,
  filePath: string,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const git = simpleGit(folderPath)
  const kind = await classifyDiscardTarget(git, filePath)
  assertDiscardable(kind, filePath)
  await applyDiscard(git, folderPath, kind, filePath, trash)
}

// 「変更」セクションのハンク単位の取り消し。作業ツリーだけへパッチを逆適用する(index は変わらない)。
// - 分類はファイル単位と同じ classifyDiscardTarget を使う。ハンクで扱えるのは追跡済みだけ
//   (未追跡・intent-to-add はファイルごとゴミ箱へ移す対象で、ハンクの粒度では取り消せない)
// - パッチの検査は verifyHunkPatch(gitHunkPatchVerifier)
export async function discardHunk(
  folderPath: string,
  filePath: string,
  patch: string
): Promise<void> {
  const git = simpleGit(folderPath)
  const kind = await classifyDiscardTarget(git, filePath)
  assertDiscardable(kind, filePath)
  if (kind === 'untracked' || kind === 'intent-to-add') {
    throw new Error(`ゴミ箱へ移す対象のため、ハンクでは取り消せません: ${filePath}`)
  }
  const contentPatch = await verifyHunkPatch(folderPath, filePath, patch)
  try {
    await discardHunkPatch(folderPath, filePath, contentPatch)
  } catch (error) {
    throw new Error(
      'ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください',
      { cause: error }
    )
  }
}

// 「変更」セクションの一括の取り消し(照合と順の実行の共通の手順は discardBatch)。
// - renderer が持つ一覧は信用せず、実行時の status から対象を作り直す。確認ダイアログで見せた一覧
//   (パス + 2 文字のステータス)と完全一致しなければ、見せていない取り消しを実行してしまうため中止する
//   (状態は確認と実行の間に変わりうる)。件数だけを比べていたときは、中身が入れ替わっても通り、確認して
//   いないファイルの編集が復元できない形で消えた(このPRで修正)。ステータスも含めるのは、同じパスで
//   ?? → AM のように「ゴミ箱へ移す」から「restore で消す」へ変わるのを止めるため
// - 全ファイルを先に分類し、1 件でも取り消せなければ何も変えずに全体を拒否する
// - 実行中の失敗は元に戻せないため、そこで中断し済んだ件数を文言に含める。1 件以上済んでいれば作業ツリーが
//   変わっているので例外ではなく partial で返す(renderer がタブ・ツリーを再読込できるように。パターン52)。
//   1 件目で失敗したなら何も変わっていないので例外
export async function discardAllChanges(
  folderPath: string,
  expected: DiscardAllEntry[],
  trash: (absolutePath: string) => Promise<void>
): Promise<DiscardAllResult> {
  const git = simpleGit(folderPath)
  const entries = parseUnstagedStatusEntries(
    await git.raw(['status', '--porcelain', '-z', '--untracked-files=all'])
  )
  // renderer の path は simple-git の表記(行の末尾の空白だけを削る。先頭は残る)なので、生のパスも trimEnd して比べる
  // (ネストした git リポジトリは 'sub/'、末尾空白は trim 済み)
  assertSameEntries(
    entries.map((e) => ({ status: e.status, path: e.rawPath.trimEnd() })),
    expected,
    '変更の状態が変わったため取り消しを中止しました。もう一度操作してください'
  )
  const paths = entries.map((e) => e.path)
  const targets: { path: string; kind: ApplicableDiscardKind }[] = []
  const blocked: string[] = []
  for (const path of paths) {
    const kind = await classifyDiscardTarget(git, path)
    if (isApplicableDiscardKind(kind)) targets.push({ path, kind })
    else blocked.push(path)
  }
  if (blocked.length > 0) {
    throw new Error(
      `取り消せないファイルがあるため、何も取り消しませんでした（${listPathsForMessage(blocked)}）`
    )
  }
  return applyInOrder(
    targets,
    ({ path, kind }) => applyDiscard(git, folderPath, kind, path, trash),
    (done, total, reason) =>
      `一括の取り消しが途中で失敗しました（${done} / ${total} 件を取り消し済み）: ${reason}`
  )
}
